import { Router, Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';
import type {
  CDSHookRequest,
  CDSHookResponse,
  CDSCard,
  CDSIndicator,
  CDSSuggestion,
  CDSAction,
  OrderReviewContext,
} from '../types';
import { createHookValidator } from '../middleware/validation';
import { buildHookContext, createPrefetchWarningCard, shouldAddPrefetchWarning } from '../services/prefetch';
import type { FHIRBundle, FHIRResource } from '../clients/fhir';
import { getConfig } from '../config';

const router = Router();

/**
 * FHIR resource types used in order-review
 */
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
}

interface FHIRServiceRequest {
  resourceType: 'ServiceRequest';
  id?: string;
  status?: string;
  intent?: string;
  code?: {
    coding?: Array<{
      system?: string;
      code?: string;
      display?: string;
    }>;
    text?: string;
  };
  category?: Array<{
    coding?: Array<{
      system?: string;
      code?: string;
      display?: string;
    }>;
  }>;
}

type FHIROrder = FHIRMedicationRequest | FHIRServiceRequest;

/**
 * Order validation issue
 */
interface OrderIssue {
  id: string;
  orderId: string;
  orderDisplay: string;
  type: 'duplicate' | 'missing-prerequisite' | 'conflict' | 'guideline-deviation' | 'allergy-concern';
  severity: 'critical' | 'warning' | 'info';
  title: string;
  description: string;
  rationale?: string;
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
 * Extract draft orders from context
 */
function extractDraftOrders(context: OrderReviewContext): FHIROrder[] {
  const orders: FHIROrder[] = [];

  if (!context.draftOrders?.entry) {
    return orders;
  }

  for (const entry of context.draftOrders.entry) {
    const resource = entry.resource as FHIRResource;
    if (resource?.resourceType === 'MedicationRequest' || resource?.resourceType === 'ServiceRequest') {
      orders.push(resource as FHIROrder);
    }
  }

  return orders;
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
 * Get display name for an order
 */
function getOrderDisplay(order: FHIROrder): string {
  if (order.resourceType === 'MedicationRequest') {
    return (
      order.medicationCodeableConcept?.text ||
      order.medicationCodeableConcept?.coding?.[0]?.display ||
      order.medicationReference?.display ||
      'Unknown medication'
    );
  }

  return order.code?.text || order.code?.coding?.[0]?.display || 'Unknown order';
}

/**
 * Get medication code from order
 */
function getMedicationCode(order: FHIRMedicationRequest): { system?: string; code?: string } | undefined {
  return order.medicationCodeableConcept?.coding?.[0];
}

/**
 * Check for duplicate orders
 */
function checkDuplicateOrders(
  draftOrders: FHIROrder[],
  activeMedications: FHIRMedicationRequest[]
): OrderIssue[] {
  const issues: OrderIssue[] = [];

  for (const order of draftOrders) {
    if (order.resourceType !== 'MedicationRequest') {
      continue;
    }

    const orderCode = getMedicationCode(order);
    if (!orderCode?.code) {
      continue;
    }

    // Check against active medications
    for (const activeMed of activeMedications) {
      const activeCode = getMedicationCode(activeMed);
      if (activeCode?.code === orderCode.code) {
        issues.push({
          id: uuidv4(),
          orderId: order.id || 'unknown',
          orderDisplay: getOrderDisplay(order),
          type: 'duplicate',
          severity: 'warning',
          title: `Duplicate Medication Order: ${getOrderDisplay(order)}`,
          description: `This medication is already active on the patient's medication list. Consider reviewing the existing order before adding a new one.`,
          rationale: 'Duplicate medication orders may lead to dosing errors or unintended polypharmacy.',
          suggestion: {
            label: 'Remove duplicate order',
            actions: [
              {
                type: 'delete',
                description: `Remove draft order for ${getOrderDisplay(order)}`,
                resourceId: order.id,
              },
            ],
          },
          source: {
            label: 'Prism Order Review',
          },
        });
        break;
      }
    }

    // Check for duplicates within draft orders
    const duplicatesInDraft = draftOrders.filter(o => {
      if (o.resourceType !== 'MedicationRequest' || o.id === order.id) {
        return false;
      }
      const oCode = getMedicationCode(o);
      return oCode?.code === orderCode.code;
    });

    if (duplicatesInDraft.length > 0 && order.id) {
      // Only add issue for the first occurrence to avoid duplicate warnings
      const firstDuplicate = duplicatesInDraft[0];
      if (firstDuplicate && (firstDuplicate.id ?? '') > (order.id ?? '')) {
        issues.push({
          id: uuidv4(),
          orderId: order.id,
          orderDisplay: getOrderDisplay(order),
          type: 'duplicate',
          severity: 'warning',
          title: `Duplicate Orders in Draft: ${getOrderDisplay(order)}`,
          description: `Multiple orders for the same medication are in the draft order set. Please review and consolidate.`,
          source: {
            label: 'Prism Order Review',
          },
        });
      }
    }
  }

  return issues;
}

/**
 * Common drug class cross-reactivity mappings
 */
const DRUG_CLASS_ALLERGY_MAP: Record<string, string[]> = {
  // Penicillins
  'penicillin': ['amoxicillin', 'ampicillin', 'augmentin', 'piperacillin'],
  'amoxicillin': ['penicillin', 'ampicillin', 'augmentin'],
  // Cephalosporins (cross-react with penicillins ~1-2%)
  'cephalexin': ['cefazolin', 'ceftriaxone'],
  // Sulfa drugs
  'sulfa': ['sulfamethoxazole', 'bactrim', 'septra', 'trimethoprim-sulfamethoxazole'],
  'sulfamethoxazole': ['sulfa', 'bactrim', 'septra'],
  // NSAIDs
  'aspirin': ['ibuprofen', 'naproxen', 'nsaid'],
  'ibuprofen': ['aspirin', 'naproxen', 'nsaid'],
  'nsaid': ['aspirin', 'ibuprofen', 'naproxen', 'meloxicam', 'diclofenac'],
  // ACE inhibitors (cough, angioedema)
  'lisinopril': ['enalapril', 'ramipril', 'ace inhibitor'],
  'ace inhibitor': ['lisinopril', 'enalapril', 'benazepril', 'ramipril'],
  // Statins (myopathy)
  'atorvastatin': ['simvastatin', 'rosuvastatin', 'statin'],
  'statin': ['atorvastatin', 'simvastatin', 'rosuvastatin', 'pravastatin'],
};

/**
 * Check for allergy-related concerns with orders
 */
function checkAllergyConflicts(
  draftOrders: FHIROrder[],
  allergies: FHIRAllergyIntolerance[]
): OrderIssue[] {
  const issues: OrderIssue[] = [];

  if (allergies.length === 0) {
    return issues;
  }

  // Build allergy lookup (normalized to lowercase)
  const allergyNames: Set<string> = new Set();
  for (const allergy of allergies) {
    const allergyDisplay = allergy.code?.text?.toLowerCase() ||
      allergy.code?.coding?.[0]?.display?.toLowerCase();
    if (allergyDisplay) {
      allergyNames.add(allergyDisplay);
      // Add cross-reactive drugs
      const crossReactive = DRUG_CLASS_ALLERGY_MAP[allergyDisplay];
      if (crossReactive) {
        crossReactive.forEach(drug => allergyNames.add(drug));
      }
    }
  }

  for (const order of draftOrders) {
    if (order.resourceType !== 'MedicationRequest') {
      continue;
    }

    const orderDisplay = getOrderDisplay(order).toLowerCase();

    // Check if order matches any allergy
    for (const allergyName of allergyNames) {
      if (orderDisplay.includes(allergyName) || allergyName.includes(orderDisplay)) {
        issues.push({
          id: uuidv4(),
          orderId: order.id || 'unknown',
          orderDisplay: getOrderDisplay(order),
          type: 'allergy-concern',
          severity: 'critical',
          title: `Potential Allergy Conflict: ${getOrderDisplay(order)}`,
          description: `Patient has a documented allergy that may conflict with this medication order. Please review the allergy history before proceeding.`,
          rationale: 'Ordering medications that conflict with documented allergies can cause adverse reactions.',
          suggestion: {
            label: 'Remove order with allergy concern',
            actions: [
              {
                type: 'delete',
                description: `Remove order for ${getOrderDisplay(order)} due to allergy concern`,
                resourceId: order.id,
              },
            ],
          },
          source: {
            label: 'Prism Order Review',
          },
        });
        break;
      }
    }
  }

  return issues;
}

/**
 * Lab prerequisites for common medications
 */
const LAB_PREREQUISITES: Record<string, { lab: string; description: string }[]> = {
  metformin: [
    { lab: 'creatinine', description: 'Check renal function (eGFR) before starting metformin' },
  ],
  lisinopril: [
    { lab: 'potassium', description: 'Check potassium level before starting ACE inhibitor' },
    { lab: 'creatinine', description: 'Check renal function before starting ACE inhibitor' },
  ],
  enalapril: [
    { lab: 'potassium', description: 'Check potassium level before starting ACE inhibitor' },
    { lab: 'creatinine', description: 'Check renal function before starting ACE inhibitor' },
  ],
  spironolactone: [
    { lab: 'potassium', description: 'Check potassium level before starting potassium-sparing diuretic' },
  ],
  warfarin: [
    { lab: 'inr', description: 'Check baseline INR before starting warfarin' },
    { lab: 'pt', description: 'Check PT/INR before starting warfarin' },
  ],
  digoxin: [
    { lab: 'potassium', description: 'Check potassium level before starting digoxin' },
    { lab: 'creatinine', description: 'Check renal function before starting digoxin' },
  ],
  vancomycin: [
    { lab: 'creatinine', description: 'Check renal function for vancomycin dosing' },
  ],
  gentamicin: [
    { lab: 'creatinine', description: 'Check renal function for aminoglycoside dosing' },
  ],
  lithium: [
    { lab: 'creatinine', description: 'Check renal function before starting lithium' },
    { lab: 'thyroid', description: 'Check thyroid function before starting lithium' },
  ],
};

/**
 * Check for missing prerequisites
 */
function checkMissingPrerequisites(draftOrders: FHIROrder[]): OrderIssue[] {
  const issues: OrderIssue[] = [];

  for (const order of draftOrders) {
    if (order.resourceType !== 'MedicationRequest') {
      continue;
    }

    const orderDisplay = getOrderDisplay(order).toLowerCase();

    // Check each known prerequisite medication
    for (const [medication, prerequisites] of Object.entries(LAB_PREREQUISITES)) {
      if (orderDisplay.includes(medication)) {
        // Check if there's an order for the prerequisite lab
        for (const prereq of prerequisites) {
          const hasLabOrder = draftOrders.some(o => {
            if (o.resourceType !== 'ServiceRequest') return false;
            const serviceDisplay = getOrderDisplay(o).toLowerCase();
            return serviceDisplay.includes(prereq.lab);
          });

          if (!hasLabOrder) {
            issues.push({
              id: uuidv4(),
              orderId: order.id || 'unknown',
              orderDisplay: getOrderDisplay(order),
              type: 'missing-prerequisite',
              severity: 'info',
              title: `Consider ${prereq.lab.toUpperCase()} Before ${getOrderDisplay(order)}`,
              description: prereq.description,
              rationale: 'Baseline lab values help ensure safe dosing and monitoring.',
              suggestion: {
                label: `Add ${prereq.lab.toUpperCase()} order`,
                actions: [
                  {
                    type: 'create',
                    description: `Add ${prereq.lab} lab order`,
                    resource: {
                      resourceType: 'ServiceRequest',
                      status: 'draft',
                      intent: 'order',
                      code: {
                        text: prereq.lab.toUpperCase(),
                      },
                    },
                  },
                ],
              },
              source: {
                label: 'Prism Order Review',
              },
            });
          }
        }
        break;
      }
    }
  }

  return issues;
}

/**
 * Condition-specific order conflicts
 */
const CONDITION_CONFLICTS: Record<string, { medications: string[]; reason: string }[]> = {
  // Kidney disease conflicts
  'N18': [
    { medications: ['metformin'], reason: 'Metformin may need dose adjustment or avoidance in CKD' },
    { medications: ['nsaid', 'ibuprofen', 'naproxen'], reason: 'NSAIDs can worsen kidney function' },
  ],
  // Heart failure conflicts
  'I50': [
    { medications: ['nsaid', 'ibuprofen', 'naproxen'], reason: 'NSAIDs can worsen heart failure' },
    { medications: ['verapamil', 'diltiazem'], reason: 'Non-dihydropyridine CCBs generally avoided in HFrEF' },
  ],
  // Asthma/COPD conflicts
  'J44': [
    { medications: ['propranolol', 'atenolol', 'metoprolol'], reason: 'Non-selective beta-blockers can worsen bronchospasm' },
  ],
  'J45': [
    { medications: ['propranolol', 'atenolol'], reason: 'Non-selective beta-blockers contraindicated in asthma' },
  ],
  // GI bleeding history
  'K92': [
    { medications: ['aspirin', 'nsaid', 'ibuprofen', 'naproxen'], reason: 'NSAIDs/aspirin increase GI bleeding risk' },
    { medications: ['warfarin'], reason: 'Anticoagulation increases GI bleeding risk' },
  ],
};

/**
 * Check for condition-based conflicts
 */
function checkConditionConflicts(
  draftOrders: FHIROrder[],
  conditions: FHIRCondition[]
): OrderIssue[] {
  const issues: OrderIssue[] = [];

  // Build set of active condition codes
  const conditionCodes: Set<string> = new Set();
  for (const condition of conditions) {
    const clinicalStatus = condition.clinicalStatus?.coding?.[0]?.code;
    if (clinicalStatus && clinicalStatus !== 'active') {
      continue;
    }

    const code = condition.code?.coding?.[0]?.code;
    if (code) {
      conditionCodes.add(code);
      // Also add the 3-character prefix for broader matching
      conditionCodes.add(code.substring(0, 3));
    }
  }

  for (const order of draftOrders) {
    if (order.resourceType !== 'MedicationRequest') {
      continue;
    }

    const orderDisplay = getOrderDisplay(order).toLowerCase();

    // Check each condition for potential conflicts
    for (const [conditionPrefix, conflicts] of Object.entries(CONDITION_CONFLICTS)) {
      if (!conditionCodes.has(conditionPrefix)) {
        continue;
      }

      for (const conflict of conflicts) {
        for (const medication of conflict.medications) {
          if (orderDisplay.includes(medication)) {
            const conditionDisplay = conditions.find(c =>
              c.code?.coding?.[0]?.code?.startsWith(conditionPrefix)
            )?.code?.text || conditions.find(c =>
              c.code?.coding?.[0]?.code?.startsWith(conditionPrefix)
            )?.code?.coding?.[0]?.display || 'condition';

            issues.push({
              id: uuidv4(),
              orderId: order.id || 'unknown',
              orderDisplay: getOrderDisplay(order),
              type: 'conflict',
              severity: 'warning',
              title: `Order May Conflict With ${conditionDisplay}`,
              description: conflict.reason,
              rationale: `This medication may be contraindicated or require special consideration given the patient's ${conditionDisplay}.`,
              source: {
                label: 'Prism Order Review',
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
 * Validate orders and generate issues
 */
async function validateOrders(
  draftOrders: FHIROrder[],
  activeMedications: FHIRMedicationRequest[],
  allergies: FHIRAllergyIntolerance[],
  conditions: FHIRCondition[],
  _context: OrderReviewContext
): Promise<OrderIssue[]> {
  const issues: OrderIssue[] = [];

  // Check for duplicate orders
  issues.push(...checkDuplicateOrders(draftOrders, activeMedications));

  // Check for allergy conflicts
  issues.push(...checkAllergyConflicts(draftOrders, allergies));

  // Check for missing prerequisites
  issues.push(...checkMissingPrerequisites(draftOrders));

  // Check for condition-based conflicts
  issues.push(...checkConditionConflicts(draftOrders, conditions));

  return issues;
}

/**
 * Map issue severity to CDS indicator
 */
function severityToIndicator(severity: OrderIssue['severity']): CDSIndicator {
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
 * Build CDS card from order issue
 */
function buildCard(issue: OrderIssue): CDSCard {
  const card: CDSCard = {
    uuid: issue.id,
    summary: issue.title,
    indicator: severityToIndicator(issue.severity),
    source: issue.source ?? {
      label: 'Prism Order Review',
    },
  };

  // Build detail markdown
  let detail = issue.description;

  if (issue.rationale) {
    detail += `\n\n**Rationale:** ${issue.rationale}`;
  }

  detail += `\n\n**Order:** ${issue.orderDisplay}`;

  card.detail = detail;

  // Add suggestion if present
  if (issue.suggestion) {
    const suggestion: CDSSuggestion = {
      label: issue.suggestion.label,
      uuid: uuidv4(),
      actions: issue.suggestion.actions,
    };
    card.suggestions = [suggestion];
  }

  return card;
}

/**
 * POST /cds-services/prism-order-review
 *
 * Order Review Hook Handler
 *
 * Triggered when a provider reviews pending orders before signing.
 * Validates orders against care plans, clinical guidelines, and safety checks.
 *
 * @see https://cds-hooks.hl7.org/2.0/#order-review
 */
router.post(
  '/',
  createHookValidator('order-review'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const hookRequest = req.body as CDSHookRequest;
      const context = hookRequest.context as OrderReviewContext;

      // Build hook context with resolved prefetch data
      const hookContext = await buildHookContext(hookRequest, 'prism-order-review');
      const { prefetch, warnings } = hookContext;

      // Extract data from prefetch and context
      const draftOrders = extractDraftOrders(context);
      const activeMedications = extractActiveMedications(prefetch);
      const allergies = extractAllergies(prefetch);
      const conditions = extractConditions(prefetch);

      // Validate orders
      const issues = await validateOrders(
        draftOrders,
        activeMedications,
        allergies,
        conditions,
        context
      );

      // Build response cards
      const cards: CDSCard[] = [];

      // Add warning card if prefetch issues
      if (shouldAddPrefetchWarning(hookContext)) {
        cards.push(createPrefetchWarningCard(warnings));
      }

      // Add issue cards
      for (const issue of issues) {
        cards.push(buildCard(issue));
      }

      // Sort cards by severity (critical > warning > info)
      cards.sort((a, b) => {
        const order: Record<CDSIndicator, number> = { critical: 0, warning: 1, info: 2 };
        return order[a.indicator] - order[b.indicator];
      });

      // Limit to 10 cards to avoid overwhelming the UI
      const limitedCards = cards.slice(0, 10);

      const response: CDSHookResponse = {
        cards: limitedCards,
      };

      res.status(200).json(response);
    } catch (error) {
      next(error);
    }
  }
);

export default router;
