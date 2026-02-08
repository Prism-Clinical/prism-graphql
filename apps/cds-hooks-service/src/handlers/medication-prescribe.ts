import { Router, Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';
import type {
  CDSHookRequest,
  CDSIndicator,
  CDSAction,
  MedicationPrescribeContext,
} from '../types';
import { createHookValidator } from '../middleware/validation';
import { buildHookContext, createPrefetchWarningCard, shouldAddPrefetchWarning } from '../services/prefetch';
import type { FHIRBundle, FHIRResource } from '../clients/fhir';
import { CardBuilder } from '../builders/card';
import { SuggestionBuilder } from '../builders/suggestion';
import { ResponseAssembler } from '../assemblers/response';
import { SOURCE_LABELS } from '../constants';

const router = Router();

/**
 * FHIR resource types used in medication-prescribe
 */
interface FHIRAllergyIntolerance {
  resourceType: 'AllergyIntolerance';
  id?: string;
  clinicalStatus?: {
    coding?: Array<{
      system?: string;
      code?: string;
    }>;
  };
  code?: {
    coding?: Array<{
      system?: string;
      code?: string;
      display?: string;
    }>;
    text?: string;
  };
  reaction?: Array<{
    manifestation?: Array<{
      coding?: Array<{
        display?: string;
      }>;
      text?: string;
    }>;
    severity?: string;
  }>;
}

interface FHIRMedicationRequest {
  resourceType: 'MedicationRequest';
  id?: string;
  status?: string;
  intent?: string;
  medicationCodeableConcept?: {
    coding?: Array<{
      system?: string;
      code?: string;
      display?: string;
    }>;
    text?: string;
  };
  medicationReference?: {
    reference?: string;
    display?: string;
  };
  dosageInstruction?: Array<{
    text?: string;
    doseAndRate?: Array<{
      doseQuantity?: {
        value?: number;
        unit?: string;
      };
    }>;
  }>;
}

interface FHIRCondition {
  resourceType: 'Condition';
  id?: string;
  clinicalStatus?: {
    coding?: Array<{
      system?: string;
      code?: string;
    }>;
  };
  code?: {
    coding?: Array<{
      system?: string;
      code?: string;
      display?: string;
    }>;
    text?: string;
  };
}

interface FHIRObservation {
  resourceType: 'Observation';
  id?: string;
  status?: string;
  code?: {
    coding?: Array<{
      system?: string;
      code?: string;
      display?: string;
    }>;
    text?: string;
  };
  valueQuantity?: {
    value?: number;
    unit?: string;
  };
  effectiveDateTime?: string;
}

/**
 * Medication safety issue types
 */
interface MedicationSafetyIssue {
  id: string;
  medicationId: string;
  medicationDisplay: string;
  type: 'allergy' | 'interaction' | 'contraindication' | 'duplicate' | 'renal-caution' | 'hepatic-caution';
  severity: 'critical' | 'warning' | 'info';
  title: string;
  description: string;
  rationale?: string;
  interactingMedication?: string;
  suggestion?: {
    label: string;
    actions: CDSAction[];
  };
  source?: {
    label: string;
    url?: string;
  };
}

/**
 * Extract medications being prescribed from context
 */
function extractPrescribedMedications(context: MedicationPrescribeContext): FHIRMedicationRequest[] {
  const medications: FHIRMedicationRequest[] = [];

  if (!context.medications?.entry) {
    return medications;
  }

  for (const entry of context.medications.entry) {
    const resource = entry.resource as FHIRResource;
    if (resource?.resourceType === 'MedicationRequest') {
      medications.push(resource as FHIRMedicationRequest);
    }
  }

  return medications;
}

/**
 * Extract active medications from prefetch
 */
function extractActiveMedications(prefetchData: Record<string, unknown>): FHIRMedicationRequest[] {
  const medsBundle = prefetchData.medications as FHIRBundle | undefined;

  if (!medsBundle?.entry) {
    return [];
  }

  const medications: FHIRMedicationRequest[] = [];

  for (const entry of medsBundle.entry) {
    if (entry.resource?.resourceType === 'MedicationRequest') {
      medications.push(entry.resource as FHIRMedicationRequest);
    }
  }

  return medications;
}

/**
 * Extract allergies from prefetch
 */
function extractAllergies(prefetchData: Record<string, unknown>): FHIRAllergyIntolerance[] {
  const allergiesBundle = prefetchData.allergies as FHIRBundle | undefined;

  if (!allergiesBundle?.entry) {
    return [];
  }

  const allergies: FHIRAllergyIntolerance[] = [];

  for (const entry of allergiesBundle.entry) {
    if (entry.resource?.resourceType === 'AllergyIntolerance') {
      allergies.push(entry.resource as FHIRAllergyIntolerance);
    }
  }

  return allergies;
}

/**
 * Extract conditions from prefetch
 */
function extractConditions(prefetchData: Record<string, unknown>): FHIRCondition[] {
  const conditionsBundle = prefetchData.conditions as FHIRBundle | undefined;

  if (!conditionsBundle?.entry) {
    return [];
  }

  const conditions: FHIRCondition[] = [];

  for (const entry of conditionsBundle.entry) {
    if (entry.resource?.resourceType === 'Condition') {
      conditions.push(entry.resource as FHIRCondition);
    }
  }

  return conditions;
}

/**
 * Extract lab results from prefetch
 */
function extractLabResults(prefetchData: Record<string, unknown>): FHIRObservation[] {
  const labsBundle = prefetchData.labResults as FHIRBundle | undefined;

  if (!labsBundle?.entry) {
    return [];
  }

  const labs: FHIRObservation[] = [];

  for (const entry of labsBundle.entry) {
    if (entry.resource?.resourceType === 'Observation') {
      labs.push(entry.resource as FHIRObservation);
    }
  }

  return labs;
}

/**
 * Get display name for a medication
 */
function getMedicationDisplay(medication: FHIRMedicationRequest): string {
  return (
    medication.medicationCodeableConcept?.text ||
    medication.medicationCodeableConcept?.coding?.[0]?.display ||
    medication.medicationReference?.display ||
    'Unknown medication'
  );
}

/**
 * Get medication code from order
 */
function getMedicationCode(medication: FHIRMedicationRequest): { system?: string; code?: string } | undefined {
  return medication.medicationCodeableConcept?.coding?.[0];
}

/**
 * Normalize medication name for matching
 */
function normalizeMedName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Drug class cross-reactivity mappings for allergy checking
 */
const DRUG_CLASS_ALLERGY_MAP: Record<string, string[]> = {
  // Penicillins
  penicillin: ['amoxicillin', 'ampicillin', 'augmentin', 'piperacillin', 'dicloxacillin', 'nafcillin'],
  amoxicillin: ['penicillin', 'ampicillin', 'augmentin'],
  ampicillin: ['penicillin', 'amoxicillin'],
  // Cephalosporins (cross-react with penicillins ~1-2%)
  cephalexin: ['cefazolin', 'ceftriaxone', 'cefdinir'],
  cephalosporin: ['cephalexin', 'cefazolin', 'ceftriaxone', 'cefdinir', 'cefepime'],
  // Sulfa drugs
  sulfa: ['sulfamethoxazole', 'bactrim', 'septra', 'sulfasalazine'],
  sulfamethoxazole: ['sulfa', 'bactrim', 'septra'],
  // NSAIDs
  aspirin: ['ibuprofen', 'naproxen', 'nsaid', 'meloxicam', 'diclofenac', 'ketorolac'],
  ibuprofen: ['aspirin', 'naproxen', 'nsaid', 'advil', 'motrin'],
  naproxen: ['aspirin', 'ibuprofen', 'nsaid', 'aleve'],
  nsaid: ['aspirin', 'ibuprofen', 'naproxen', 'meloxicam', 'diclofenac', 'ketorolac', 'indomethacin'],
  // ACE inhibitors (angioedema risk)
  lisinopril: ['enalapril', 'ramipril', 'benazepril', 'ace inhibitor', 'captopril'],
  'ace inhibitor': ['lisinopril', 'enalapril', 'benazepril', 'ramipril', 'captopril'],
  // Statins (myopathy)
  atorvastatin: ['simvastatin', 'rosuvastatin', 'statin', 'pravastatin', 'lovastatin'],
  statin: ['atorvastatin', 'simvastatin', 'rosuvastatin', 'pravastatin', 'lovastatin'],
  // Opioids
  codeine: ['morphine', 'hydrocodone', 'oxycodone', 'tramadol'],
  morphine: ['codeine', 'hydrocodone', 'oxycodone', 'hydromorphone'],
};

/**
 * Check for allergy conflicts with prescribed medication
 */
function checkAllergyConflicts(
  prescribedMedications: FHIRMedicationRequest[],
  allergies: FHIRAllergyIntolerance[]
): MedicationSafetyIssue[] {
  const issues: MedicationSafetyIssue[] = [];

  if (allergies.length === 0) {
    return issues;
  }

  // Build allergy lookup (normalized to lowercase)
  const allergyInfo: Array<{ name: string; crossReactive: string[] }> = [];

  for (const allergy of allergies) {
    const allergyDisplay =
      allergy.code?.text?.toLowerCase() ||
      allergy.code?.coding?.[0]?.display?.toLowerCase();

    if (allergyDisplay) {
      const normalized = normalizeMedName(allergyDisplay);
      const crossReactive = DRUG_CLASS_ALLERGY_MAP[normalized] || [];
      allergyInfo.push({ name: normalized, crossReactive });
    }
  }

  for (const medication of prescribedMedications) {
    const medDisplay = getMedicationDisplay(medication);
    const normalizedMed = normalizeMedName(medDisplay);

    for (const allergy of allergyInfo) {
      // Check direct match
      if (normalizedMed.includes(allergy.name) || allergy.name.includes(normalizedMed)) {
        issues.push({
          id: uuidv4(),
          medicationId: medication.id || 'unknown',
          medicationDisplay: medDisplay,
          type: 'allergy',
          severity: 'critical',
          title: `Allergy Alert: ${medDisplay}`,
          description: `Patient has a documented allergy to ${allergy.name}. This medication may cause an allergic reaction.`,
          rationale: 'Prescribing medications that directly match documented allergies can cause severe adverse reactions including anaphylaxis.',
          suggestion: {
            label: 'Remove medication with allergy concern',
            actions: [
              {
                type: 'delete',
                description: `Remove ${medDisplay} due to allergy`,
                resourceId: medication.id,
              },
            ],
          },
          source: {
            label: 'Prism Medication Safety',
          },
        });
        break;
      }

      // Check cross-reactive match
      for (const crossDrug of allergy.crossReactive) {
        if (normalizedMed.includes(crossDrug) || crossDrug.includes(normalizedMed)) {
          issues.push({
            id: uuidv4(),
            medicationId: medication.id || 'unknown',
            medicationDisplay: medDisplay,
            type: 'allergy',
            severity: 'critical',
            title: `Cross-Reactive Allergy Alert: ${medDisplay}`,
            description: `Patient has an allergy to ${allergy.name}. ${medDisplay} may have cross-reactivity and could cause an allergic reaction.`,
            rationale: 'Cross-reactive allergies can occur between medications in the same drug class.',
            suggestion: {
              label: 'Remove medication with cross-reactive allergy concern',
              actions: [
                {
                  type: 'delete',
                  description: `Remove ${medDisplay} due to cross-reactive allergy concern`,
                  resourceId: medication.id,
                },
              ],
            },
            source: {
              label: 'Prism Medication Safety',
            },
          });
          break;
        }
      }
    }
  }

  return issues;
}

/**
 * Drug-drug interaction data
 */
interface DrugInteraction {
  drugs: string[];
  severity: 'critical' | 'warning' | 'info';
  description: string;
  mechanism?: string;
}

const DRUG_INTERACTIONS: DrugInteraction[] = [
  // Warfarin interactions
  {
    drugs: ['warfarin', 'aspirin'],
    severity: 'critical',
    description: 'Increased bleeding risk with concurrent anticoagulant and antiplatelet therapy',
    mechanism: 'Additive anticoagulant effect',
  },
  {
    drugs: ['warfarin', 'ibuprofen'],
    severity: 'critical',
    description: 'NSAIDs increase bleeding risk and may affect warfarin metabolism',
    mechanism: 'NSAIDs inhibit platelet function and may displace warfarin from protein binding',
  },
  {
    drugs: ['warfarin', 'naproxen'],
    severity: 'critical',
    description: 'NSAIDs increase bleeding risk and may affect warfarin metabolism',
    mechanism: 'NSAIDs inhibit platelet function and may displace warfarin from protein binding',
  },
  {
    drugs: ['warfarin', 'fluconazole'],
    severity: 'critical',
    description: 'Fluconazole inhibits warfarin metabolism, significantly increasing INR',
    mechanism: 'CYP2C9 inhibition',
  },
  {
    drugs: ['warfarin', 'metronidazole'],
    severity: 'warning',
    description: 'Metronidazole may increase warfarin effect',
    mechanism: 'CYP inhibition',
  },
  // Statin interactions
  {
    drugs: ['simvastatin', 'amiodarone'],
    severity: 'critical',
    description: 'Increased risk of rhabdomyolysis. Simvastatin dose should not exceed 20mg daily.',
    mechanism: 'CYP3A4 inhibition increases simvastatin levels',
  },
  {
    drugs: ['atorvastatin', 'clarithromycin'],
    severity: 'warning',
    description: 'Macrolide antibiotics may increase statin levels and myopathy risk',
    mechanism: 'CYP3A4 inhibition',
  },
  {
    drugs: ['simvastatin', 'amlodipine'],
    severity: 'warning',
    description: 'Simvastatin dose should not exceed 20mg daily with amlodipine',
    mechanism: 'CYP3A4 inhibition',
  },
  // ACE inhibitor interactions
  {
    drugs: ['lisinopril', 'spironolactone'],
    severity: 'warning',
    description: 'Risk of hyperkalemia with concurrent ACE inhibitor and potassium-sparing diuretic',
    mechanism: 'Both medications can increase serum potassium',
  },
  {
    drugs: ['lisinopril', 'potassium'],
    severity: 'warning',
    description: 'Risk of hyperkalemia with concurrent ACE inhibitor and potassium supplementation',
    mechanism: 'Both medications can increase serum potassium',
  },
  // Metformin interactions
  {
    drugs: ['metformin', 'contrast'],
    severity: 'warning',
    description: 'Hold metformin before and after IV contrast procedures',
    mechanism: 'Risk of lactic acidosis with renal impairment from contrast',
  },
  // Digoxin interactions
  {
    drugs: ['digoxin', 'amiodarone'],
    severity: 'warning',
    description: 'Amiodarone increases digoxin levels. Consider 50% dose reduction.',
    mechanism: 'P-glycoprotein inhibition reduces digoxin clearance',
  },
  {
    drugs: ['digoxin', 'verapamil'],
    severity: 'warning',
    description: 'Verapamil increases digoxin levels and additive AV nodal blocking effect',
    mechanism: 'P-glycoprotein inhibition and pharmacodynamic interaction',
  },
  // Fluoroquinolone interactions
  {
    drugs: ['ciprofloxacin', 'theophylline'],
    severity: 'warning',
    description: 'Ciprofloxacin inhibits theophylline metabolism, risk of toxicity',
    mechanism: 'CYP1A2 inhibition',
  },
  {
    drugs: ['levofloxacin', 'antacid'],
    severity: 'info',
    description: 'Antacids reduce fluoroquinolone absorption. Separate doses by 2 hours.',
    mechanism: 'Chelation reduces absorption',
  },
  // Serotonin syndrome risk
  {
    drugs: ['ssri', 'tramadol'],
    severity: 'warning',
    description: 'Increased risk of serotonin syndrome with concurrent use',
    mechanism: 'Both medications increase serotonin activity',
  },
  {
    drugs: ['sertraline', 'tramadol'],
    severity: 'warning',
    description: 'Increased risk of serotonin syndrome with concurrent use',
    mechanism: 'Both medications increase serotonin activity',
  },
  // QT prolongation
  {
    drugs: ['azithromycin', 'amiodarone'],
    severity: 'critical',
    description: 'Additive QT prolongation risk. Consider alternative antibiotic.',
    mechanism: 'Both medications prolong QT interval',
  },
  {
    drugs: ['ciprofloxacin', 'amiodarone'],
    severity: 'critical',
    description: 'Additive QT prolongation risk. Consider alternative antibiotic.',
    mechanism: 'Both medications prolong QT interval',
  },
];

/**
 * Check for drug-drug interactions
 */
function checkDrugInteractions(
  prescribedMedications: FHIRMedicationRequest[],
  activeMedications: FHIRMedicationRequest[]
): MedicationSafetyIssue[] {
  const issues: MedicationSafetyIssue[] = [];

  // Combine all medications for interaction checking
  const allMeds = [...prescribedMedications, ...activeMedications];

  // Check each prescribed medication against all other medications
  for (const prescribed of prescribedMedications) {
    const prescribedName = normalizeMedName(getMedicationDisplay(prescribed));

    for (const other of allMeds) {
      // Skip self-comparison
      if (prescribed.id === other.id) continue;

      const otherName = normalizeMedName(getMedicationDisplay(other));

      // Check against known interactions
      for (const interaction of DRUG_INTERACTIONS) {
        const [drug1, drug2] = interaction.drugs;
        if (!drug1 || !drug2) continue;

        const matchesPrescribed =
          prescribedName.includes(drug1) || drug1.includes(prescribedName);
        const matchesOther = otherName.includes(drug2) || drug2.includes(otherName);

        const matchesPrescribedReverse =
          prescribedName.includes(drug2) || drug2.includes(prescribedName);
        const matchesOtherReverse = otherName.includes(drug1) || drug1.includes(otherName);

        if ((matchesPrescribed && matchesOther) || (matchesPrescribedReverse && matchesOtherReverse)) {
          // Avoid duplicate issues
          const existingIssue = issues.find(
            i =>
              i.medicationId === prescribed.id &&
              i.type === 'interaction' &&
              i.interactingMedication === getMedicationDisplay(other)
          );

          if (!existingIssue) {
            issues.push({
              id: uuidv4(),
              medicationId: prescribed.id || 'unknown',
              medicationDisplay: getMedicationDisplay(prescribed),
              type: 'interaction',
              severity: interaction.severity,
              title: `Drug Interaction: ${getMedicationDisplay(prescribed)} + ${getMedicationDisplay(other)}`,
              description: interaction.description,
              rationale: interaction.mechanism,
              interactingMedication: getMedicationDisplay(other),
              source: {
                label: 'Prism Medication Safety',
              },
            });
          }
        }
      }
    }
  }

  return issues;
}

/**
 * Medication contraindications by condition
 */
const CONDITION_CONTRAINDICATIONS: Record<string, { medications: string[]; severity: 'critical' | 'warning'; description: string }[]> = {
  // Kidney disease (N18.x)
  N18: [
    { medications: ['metformin'], severity: 'warning', description: 'Metformin contraindicated in severe renal impairment (eGFR <30)' },
    { medications: ['nsaid', 'ibuprofen', 'naproxen', 'ketorolac'], severity: 'warning', description: 'NSAIDs can worsen kidney function' },
    { medications: ['gadolinium'], severity: 'critical', description: 'Risk of nephrogenic systemic fibrosis' },
  ],
  // Heart failure (I50.x)
  I50: [
    { medications: ['nsaid', 'ibuprofen', 'naproxen', 'meloxicam'], severity: 'warning', description: 'NSAIDs can worsen heart failure and cause fluid retention' },
    { medications: ['verapamil', 'diltiazem'], severity: 'warning', description: 'Non-dihydropyridine CCBs may worsen heart failure' },
    { medications: ['thiazolidinedione', 'pioglitazone', 'rosiglitazone'], severity: 'critical', description: 'TZDs contraindicated in heart failure due to fluid retention' },
  ],
  // Asthma (J45.x)
  J45: [
    { medications: ['propranolol', 'atenolol', 'nadolol', 'timolol'], severity: 'critical', description: 'Non-selective beta-blockers can trigger bronchospasm in asthma' },
    { medications: ['aspirin'], severity: 'warning', description: 'Some asthma patients have aspirin-exacerbated respiratory disease' },
  ],
  // COPD (J44.x)
  J44: [
    { medications: ['propranolol', 'nadolol', 'timolol'], severity: 'warning', description: 'Non-selective beta-blockers may worsen bronchospasm' },
  ],
  // Cirrhosis/Liver disease (K74.x)
  K74: [
    { medications: ['acetaminophen', 'tylenol'], severity: 'warning', description: 'Limit acetaminophen to 2g/day in liver disease' },
    { medications: ['methotrexate'], severity: 'critical', description: 'Methotrexate hepatotoxic and contraindicated in significant liver disease' },
    { medications: ['statin', 'atorvastatin', 'simvastatin'], severity: 'warning', description: 'Statins may require dose adjustment in liver disease' },
  ],
  // GI bleeding history (K92.x)
  K92: [
    { medications: ['aspirin', 'nsaid', 'ibuprofen', 'naproxen'], severity: 'warning', description: 'NSAIDs/aspirin increase GI bleeding risk' },
    { medications: ['warfarin', 'apixaban', 'rivaroxaban'], severity: 'warning', description: 'Anticoagulants increase GI bleeding risk' },
  ],
  // Myasthenia gravis (G70.x)
  G70: [
    { medications: ['aminoglycoside', 'gentamicin', 'tobramycin'], severity: 'critical', description: 'Aminoglycosides can worsen myasthenia gravis' },
    { medications: ['fluoroquinolone', 'ciprofloxacin', 'levofloxacin'], severity: 'critical', description: 'Fluoroquinolones can worsen myasthenia gravis' },
    { medications: ['magnesium'], severity: 'warning', description: 'IV magnesium can worsen myasthenia' },
  ],
  // Seizure disorder (G40.x)
  G40: [
    { medications: ['bupropion', 'wellbutrin'], severity: 'warning', description: 'Bupropion lowers seizure threshold' },
    { medications: ['tramadol'], severity: 'warning', description: 'Tramadol lowers seizure threshold' },
  ],
  // Prolonged QT (I45.81)
  I45: [
    { medications: ['azithromycin', 'zithromax'], severity: 'warning', description: 'Azithromycin can prolong QT interval' },
    { medications: ['ondansetron', 'zofran'], severity: 'warning', description: 'Ondansetron can prolong QT interval' },
    { medications: ['haloperidol'], severity: 'warning', description: 'Haloperidol can prolong QT interval' },
  ],
};

/**
 * Check for condition-based contraindications
 */
function checkContraindications(
  prescribedMedications: FHIRMedicationRequest[],
  conditions: FHIRCondition[]
): MedicationSafetyIssue[] {
  const issues: MedicationSafetyIssue[] = [];

  // Build set of condition codes (use 3-character prefix for matching)
  const conditionPrefixes: Set<string> = new Set();
  const conditionDisplays: Record<string, string> = {};

  for (const condition of conditions) {
    const clinicalStatus = condition.clinicalStatus?.coding?.[0]?.code;
    if (clinicalStatus && clinicalStatus !== 'active') continue;

    const code = condition.code?.coding?.[0]?.code;
    if (code) {
      const prefix = code.substring(0, 3);
      conditionPrefixes.add(prefix);
      conditionDisplays[prefix] =
        condition.code?.text ||
        condition.code?.coding?.[0]?.display ||
        code;
    }
  }

  for (const medication of prescribedMedications) {
    const medName = normalizeMedName(getMedicationDisplay(medication));

    for (const [conditionPrefix, contraindications] of Object.entries(CONDITION_CONTRAINDICATIONS)) {
      if (!conditionPrefixes.has(conditionPrefix)) continue;

      for (const contraindication of contraindications) {
        for (const drug of contraindication.medications) {
          if (medName.includes(drug) || drug.includes(medName)) {
            issues.push({
              id: uuidv4(),
              medicationId: medication.id || 'unknown',
              medicationDisplay: getMedicationDisplay(medication),
              type: 'contraindication',
              severity: contraindication.severity,
              title: `Contraindication: ${getMedicationDisplay(medication)}`,
              description: `${contraindication.description}. Patient has ${conditionDisplays[conditionPrefix]}.`,
              rationale: 'This medication may be contraindicated or require dose adjustment given the patient\'s medical conditions.',
              source: {
                label: 'Prism Medication Safety',
              },
            });
            break;
          }
        }
      }
    }
  }

  return issues;
}

/**
 * Check for duplicate medications
 */
function checkDuplicateMedications(
  prescribedMedications: FHIRMedicationRequest[],
  activeMedications: FHIRMedicationRequest[]
): MedicationSafetyIssue[] {
  const issues: MedicationSafetyIssue[] = [];

  for (const prescribed of prescribedMedications) {
    const prescribedCode = getMedicationCode(prescribed);
    if (!prescribedCode?.code) continue;

    for (const active of activeMedications) {
      const activeCode = getMedicationCode(active);
      if (activeCode?.code === prescribedCode.code) {
        issues.push({
          id: uuidv4(),
          medicationId: prescribed.id || 'unknown',
          medicationDisplay: getMedicationDisplay(prescribed),
          type: 'duplicate',
          severity: 'warning',
          title: `Duplicate Medication: ${getMedicationDisplay(prescribed)}`,
          description: 'This medication is already on the patient\'s active medication list.',
          rationale: 'Prescribing duplicate medications may lead to dosing errors or unintended polypharmacy.',
          suggestion: {
            label: 'Remove duplicate prescription',
            actions: [
              {
                type: 'delete',
                description: `Remove duplicate prescription for ${getMedicationDisplay(prescribed)}`,
                resourceId: prescribed.id,
              },
            ],
          },
          source: {
            label: 'Prism Medication Safety',
          },
        });
        break;
      }
    }
  }

  return issues;
}

/**
 * Check for renal dosing considerations
 */
function checkRenalConsiderations(
  prescribedMedications: FHIRMedicationRequest[],
  labResults: FHIRObservation[]
): MedicationSafetyIssue[] {
  const issues: MedicationSafetyIssue[] = [];

  // Find most recent creatinine/eGFR
  const renalLabs = labResults.filter(
    lab =>
      lab.code?.coding?.some(c =>
        c.code === '2160-0' || // Creatinine
        c.code === '33914-3' || // eGFR
        c.display?.toLowerCase().includes('creatinine') ||
        c.display?.toLowerCase().includes('egfr')
      )
  );

  if (renalLabs.length === 0) return issues;

  // Check for elevated creatinine or low eGFR
  const hasRenalImpairment = renalLabs.some(lab => {
    const value = lab.valueQuantity?.value;
    if (!value) return false;

    const codeDisplay = lab.code?.coding?.[0]?.display?.toLowerCase() || '';

    // eGFR < 60 or Creatinine > 1.5 suggests impairment
    if (codeDisplay.includes('egfr') && value < 60) return true;
    if (codeDisplay.includes('creatinine') && value > 1.5) return true;

    return false;
  });

  if (!hasRenalImpairment) return issues;

  // Medications requiring renal dose adjustment
  const renalMedications = [
    'metformin',
    'gabapentin',
    'pregabalin',
    'vancomycin',
    'gentamicin',
    'enoxaparin',
    'dabigatran',
    'allopurinol',
    'baclofen',
    'acyclovir',
    'valacyclovir',
  ];

  for (const medication of prescribedMedications) {
    const medName = normalizeMedName(getMedicationDisplay(medication));

    for (const renalMed of renalMedications) {
      if (medName.includes(renalMed)) {
        issues.push({
          id: uuidv4(),
          medicationId: medication.id || 'unknown',
          medicationDisplay: getMedicationDisplay(medication),
          type: 'renal-caution',
          severity: 'warning',
          title: `Renal Dosing: ${getMedicationDisplay(medication)}`,
          description: `Patient has renal impairment. ${getMedicationDisplay(medication)} may require dose adjustment based on kidney function.`,
          rationale: 'Many medications are cleared by the kidneys and require dose adjustment in renal impairment to prevent toxicity.',
          source: {
            label: 'Prism Medication Safety',
          },
        });
        break;
      }
    }
  }

  return issues;
}

/**
 * Run all medication safety checks
 */
async function checkMedicationSafety(
  prescribedMedications: FHIRMedicationRequest[],
  activeMedications: FHIRMedicationRequest[],
  allergies: FHIRAllergyIntolerance[],
  conditions: FHIRCondition[],
  labResults: FHIRObservation[]
): Promise<MedicationSafetyIssue[]> {
  const issues: MedicationSafetyIssue[] = [];

  // Check allergies first (most critical)
  issues.push(...checkAllergyConflicts(prescribedMedications, allergies));

  // Check drug-drug interactions
  issues.push(...checkDrugInteractions(prescribedMedications, activeMedications));

  // Check condition-based contraindications
  issues.push(...checkContraindications(prescribedMedications, conditions));

  // Check for duplicates
  issues.push(...checkDuplicateMedications(prescribedMedications, activeMedications));

  // Check renal considerations
  issues.push(...checkRenalConsiderations(prescribedMedications, labResults));

  return issues;
}

/**
 * Map issue severity to CDS indicator
 */
function severityToIndicator(severity: MedicationSafetyIssue['severity']): CDSIndicator {
  switch (severity) {
    case 'critical':
      return 'critical';
    case 'warning':
      return 'warning';
    case 'info':
    default:
      return 'info';
  }
}

/**
 * Build detail markdown from medication safety issue
 */
function buildSafetyIssueDetail(issue: MedicationSafetyIssue): string {
  let detail = issue.description;

  if (issue.rationale) {
    detail += `\n\n**Rationale:** ${issue.rationale}`;
  }

  if (issue.interactingMedication) {
    detail += `\n\n**Interacting Medication:** ${issue.interactingMedication}`;
  }

  detail += `\n\n**Prescribed Medication:** ${issue.medicationDisplay}`;

  return detail;
}

/**
 * Build CDS card from medication safety issue using CardBuilder
 */
function buildSafetyIssueCard(issue: MedicationSafetyIssue) {
  const builder = new CardBuilder()
    .withUuid(issue.id)
    .withSummary(issue.title)
    .withIndicator(severityToIndicator(issue.severity))
    .withSource(issue.source ?? { label: SOURCE_LABELS.PRISM_MEDICATION_SAFETY })
    .withDetail(buildSafetyIssueDetail(issue));

  // Add suggestion if present
  if (issue.suggestion) {
    const suggestion = new SuggestionBuilder()
      .withLabel(issue.suggestion.label);

    for (const action of issue.suggestion.actions) {
      suggestion.addAction(action);
    }

    builder.addSuggestion(suggestion.build());
  }

  return builder.build();
}

/**
 * POST /cds-services/prism-medication-prescribe
 *
 * Medication Prescribe Hook Handler
 *
 * Triggered when prescribing a new medication.
 * Checks for drug-drug interactions, allergies, and contraindications.
 *
 * @see https://cds-hooks.hl7.org/2.0/#medication-prescribe
 */
router.post(
  '/',
  createHookValidator('medication-prescribe'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const hookRequest = req.body as CDSHookRequest;
      const context = hookRequest.context as MedicationPrescribeContext;

      // Build hook context with resolved prefetch data
      const hookContext = await buildHookContext(hookRequest, 'prism-medication-prescribe');
      const { prefetch, warnings } = hookContext;

      // Extract data from prefetch and context
      const prescribedMedications = extractPrescribedMedications(context);
      const activeMedications = extractActiveMedications(prefetch);
      const allergies = extractAllergies(prefetch);
      const conditions = extractConditions(prefetch);
      const labResults = extractLabResults(prefetch);

      // Run medication safety checks
      const issues = await checkMedicationSafety(
        prescribedMedications,
        activeMedications,
        allergies,
        conditions,
        labResults
      );

      // Build response using ResponseAssembler
      const assembler = new ResponseAssembler();

      // Add warning card if prefetch issues
      if (shouldAddPrefetchWarning(hookContext)) {
        assembler.addCard(createPrefetchWarningCard(warnings));
      }

      // Add issue cards
      for (const issue of issues) {
        assembler.addCard(buildSafetyIssueCard(issue));
      }

      // Build response (automatically sorts by severity and limits to 10)
      const response = assembler.build();

      res.status(200).json(response);
    } catch (error) {
      next(error);
    }
  }
);

export default router;
