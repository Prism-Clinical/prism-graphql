import { Router, Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';
import type {
  CDSHookRequest,
  CDSHookResponse,
  CDSCard,
  CDSIndicator,
  PatientViewContext,
} from '../types';
import { createHookValidator } from '../middleware/validation';
import { buildHookContext, createPrefetchWarningCard, shouldAddPrefetchWarning } from '../services/prefetch';
import type { FHIRBundle, FHIRResource } from '../clients/fhir';
import { getConfig } from '../config';

const router = Router();

/**
 * FHIR Condition resource structure
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
  category?: Array<{
    coding?: Array<{
      system?: string;
      code?: string;
    }>;
  }>;
}

/**
 * FHIR Patient resource structure
 */
interface FHIRPatient {
  resourceType: 'Patient';
  id?: string;
  name?: Array<{
    given?: string[];
    family?: string;
  }>;
  birthDate?: string;
  gender?: string;
}

/**
 * FHIR Observation resource structure
 */
interface FHIRObservation {
  resourceType: 'Observation';
  id?: string;
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
 * Care plan recommendation from ML service
 */
interface CarePlanRecommendation {
  id: string;
  title: string;
  description: string;
  priority: 'critical' | 'warning' | 'info';
  conditionCode?: string;
  conditionDisplay?: string;
  rationale?: string;
  actions?: Array<{
    description: string;
    type: 'order' | 'referral' | 'education' | 'monitoring';
  }>;
  source?: {
    label: string;
    url?: string;
  };
}

/**
 * Map recommendation priority to CDS indicator
 */
function priorityToIndicator(priority: CarePlanRecommendation['priority']): CDSIndicator {
  switch (priority) {
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
 * Extract conditions from prefetch bundle
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
 * Extract patient from prefetch
 */
function extractPatient(prefetchData: Record<string, unknown>): FHIRPatient | undefined {
  const patient = prefetchData.patient as FHIRResource | undefined;

  if (patient?.resourceType === 'Patient') {
    return patient as FHIRPatient;
  }

  return undefined;
}

/**
 * Extract observations from prefetch bundle
 */
function extractObservations(prefetchData: Record<string, unknown>): FHIRObservation[] {
  const observationsBundle = prefetchData.observations as FHIRBundle | undefined;

  if (!observationsBundle?.entry) {
    return [];
  }

  const observations: FHIRObservation[] = [];

  for (const entry of observationsBundle.entry) {
    if (entry.resource?.resourceType === 'Observation') {
      observations.push(entry.resource as FHIRObservation);
    }
  }

  return observations;
}

/**
 * Generate care plan recommendations based on patient data
 *
 * In production, this would call the ML service at prism-ml-infra.
 * For now, we generate recommendations based on active conditions.
 */
async function generateRecommendations(
  patient: FHIRPatient | undefined,
  conditions: FHIRCondition[],
  observations: FHIRObservation[],
  _context: PatientViewContext
): Promise<CarePlanRecommendation[]> {
  const recommendations: CarePlanRecommendation[] = [];
  const config = getConfig();

  // In production, call ML service for intelligent recommendations
  // For now, generate basic recommendations based on conditions

  // Check for chronic conditions that need care plan recommendations
  for (const condition of conditions) {
    const conditionCode = condition.code?.coding?.[0];
    const conditionDisplay = conditionCode?.display || condition.code?.text || 'Unknown condition';

    // Check clinical status - only process active conditions
    const clinicalStatus = condition.clinicalStatus?.coding?.[0]?.code;
    if (clinicalStatus && clinicalStatus !== 'active') {
      continue;
    }

    // Generate recommendation based on condition type
    const recommendation = generateConditionRecommendation(conditionCode, conditionDisplay);
    if (recommendation) {
      recommendations.push(recommendation);
    }
  }

  // Check for missing vital signs
  if (observations.length === 0) {
    recommendations.push({
      id: uuidv4(),
      title: 'Missing Recent Vital Signs',
      description: 'No recent vital signs on record. Consider capturing vital signs for this patient.',
      priority: 'info',
      source: {
        label: 'Prism Care Plan',
        url: config.mlServiceUrl,
      },
    });
  }

  // Check for overdue screenings based on patient demographics
  if (patient) {
    const screeningRecommendation = checkScreeningRecommendations(patient);
    if (screeningRecommendation) {
      recommendations.push(screeningRecommendation);
    }
  }

  return recommendations;
}

/**
 * Generate a recommendation for a specific condition
 */
function generateConditionRecommendation(
  conditionCode: { system?: string; code?: string; display?: string } | undefined,
  conditionDisplay: string
): CarePlanRecommendation | null {
  if (!conditionCode) {
    return null;
  }

  const code = conditionCode.code;
  const system = conditionCode.system;

  // ICD-10-CM based recommendations
  if (system?.includes('icd-10') || system?.includes('icd10')) {
    // Diabetes mellitus (E10-E14)
    if (code?.startsWith('E1')) {
      return {
        id: uuidv4(),
        title: 'Diabetes Care Plan Review Recommended',
        description: `Patient has ${conditionDisplay}. Review care plan for A1C monitoring, foot exams, and eye exams.`,
        priority: 'info',
        conditionCode: code,
        conditionDisplay,
        rationale: 'ADA guidelines recommend quarterly A1C for uncontrolled diabetes and annual foot/eye exams.',
        actions: [
          { description: 'Order A1C if not done in last 3 months', type: 'order' },
          { description: 'Schedule annual diabetic eye exam', type: 'referral' },
          { description: 'Perform diabetic foot exam', type: 'monitoring' },
        ],
        source: {
          label: 'ADA Standards of Care',
          url: 'https://diabetesjournals.org/care',
        },
      };
    }

    // Hypertension (I10-I16)
    if (code?.startsWith('I1')) {
      return {
        id: uuidv4(),
        title: 'Hypertension Management Review',
        description: `Patient has ${conditionDisplay}. Review blood pressure control and medication adherence.`,
        priority: 'info',
        conditionCode: code,
        conditionDisplay,
        rationale: 'JNC guidelines recommend regular BP monitoring and lifestyle modifications.',
        actions: [
          { description: 'Review home BP logs', type: 'monitoring' },
          { description: 'Assess medication adherence', type: 'education' },
        ],
        source: {
          label: 'JNC Guidelines',
          url: 'https://www.heart.org',
        },
      };
    }

    // Heart failure (I50)
    if (code?.startsWith('I50')) {
      return {
        id: uuidv4(),
        title: 'Heart Failure Care Plan Attention Needed',
        description: `Patient has ${conditionDisplay}. Ensure guideline-directed medical therapy is optimized.`,
        priority: 'warning',
        conditionCode: code,
        conditionDisplay,
        rationale: 'ACC/AHA guidelines recommend GDMT optimization including ACEi/ARB/ARNI, beta-blocker, and MRA.',
        actions: [
          { description: 'Review current GDMT medications', type: 'monitoring' },
          { description: 'Check recent BNP/proBNP levels', type: 'order' },
          { description: 'Assess fluid status and weight', type: 'monitoring' },
        ],
        source: {
          label: 'ACC/AHA HF Guidelines',
          url: 'https://www.heart.org',
        },
      };
    }

    // COPD (J44)
    if (code?.startsWith('J44')) {
      return {
        id: uuidv4(),
        title: 'COPD Care Plan Review',
        description: `Patient has ${conditionDisplay}. Review inhaler technique and exacerbation history.`,
        priority: 'info',
        conditionCode: code,
        conditionDisplay,
        rationale: 'GOLD guidelines recommend annual spirometry and inhaler technique assessment.',
        actions: [
          { description: 'Assess inhaler technique', type: 'education' },
          { description: 'Review vaccination status', type: 'monitoring' },
          { description: 'Evaluate for pulmonary rehabilitation referral', type: 'referral' },
        ],
        source: {
          label: 'GOLD Guidelines',
          url: 'https://goldcopd.org',
        },
      };
    }

    // Chronic kidney disease (N18)
    if (code?.startsWith('N18')) {
      return {
        id: uuidv4(),
        title: 'CKD Monitoring Needed',
        description: `Patient has ${conditionDisplay}. Monitor kidney function and manage cardiovascular risk.`,
        priority: 'warning',
        conditionCode: code,
        conditionDisplay,
        rationale: 'KDIGO guidelines recommend regular monitoring of eGFR and UACR.',
        actions: [
          { description: 'Check recent eGFR and UACR', type: 'order' },
          { description: 'Review nephrotoxic medications', type: 'monitoring' },
          { description: 'Consider nephrology referral if eGFR declining', type: 'referral' },
        ],
        source: {
          label: 'KDIGO Guidelines',
          url: 'https://kdigo.org',
        },
      };
    }
  }

  // SNOMED-CT based recommendations
  if (system?.includes('snomed')) {
    // Asthma (195967001)
    if (code === '195967001') {
      return {
        id: uuidv4(),
        title: 'Asthma Control Assessment',
        description: `Patient has ${conditionDisplay}. Assess asthma control and review action plan.`,
        priority: 'info',
        conditionCode: code,
        conditionDisplay,
        actions: [
          { description: 'Review asthma action plan', type: 'education' },
          { description: 'Check rescue inhaler use frequency', type: 'monitoring' },
        ],
        source: {
          label: 'GINA Guidelines',
          url: 'https://ginasthma.org',
        },
      };
    }
  }

  return null;
}

/**
 * Check for age-appropriate screening recommendations
 */
function checkScreeningRecommendations(patient: FHIRPatient): CarePlanRecommendation | null {
  if (!patient.birthDate) {
    return null;
  }

  const birthDate = new Date(patient.birthDate);
  const today = new Date();
  const age = Math.floor((today.getTime() - birthDate.getTime()) / (365.25 * 24 * 60 * 60 * 1000));

  // Colorectal cancer screening (45-75)
  if (age >= 45 && age <= 75) {
    return {
      id: uuidv4(),
      title: 'Colorectal Cancer Screening',
      description: 'Patient is in the recommended age range for colorectal cancer screening. Review screening status.',
      priority: 'info',
      rationale: 'USPSTF recommends colorectal cancer screening for adults aged 45-75.',
      source: {
        label: 'USPSTF',
        url: 'https://www.uspreventiveservicestaskforce.org',
      },
    };
  }

  return null;
}

/**
 * Build CDS card from care plan recommendation
 */
function buildCard(recommendation: CarePlanRecommendation): CDSCard {
  const card: CDSCard = {
    uuid: recommendation.id,
    summary: recommendation.title,
    indicator: priorityToIndicator(recommendation.priority),
    source: recommendation.source ?? {
      label: 'Prism Care Plan',
    },
  };

  // Build detail markdown
  let detail = recommendation.description;

  if (recommendation.rationale) {
    detail += `\n\n**Rationale:** ${recommendation.rationale}`;
  }

  if (recommendation.actions && recommendation.actions.length > 0) {
    detail += '\n\n**Recommended Actions:**\n';
    recommendation.actions.forEach(action => {
      detail += `- ${action.description}\n`;
    });
  }

  card.detail = detail;

  return card;
}

/**
 * POST /cds-services/prism-patient-view
 *
 * Patient View Hook Handler
 *
 * Triggered when a patient's chart is opened.
 * Returns care plan recommendations and clinical decision support cards.
 *
 * @see https://cds-hooks.hl7.org/2.0/#calling-a-cds-service
 */
router.post(
  '/',
  createHookValidator('patient-view'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const hookRequest = req.body as CDSHookRequest;
      const context = hookRequest.context as PatientViewContext;

      // Build hook context with resolved prefetch data
      const hookContext = await buildHookContext(hookRequest, 'prism-patient-view');
      const { prefetch, warnings } = hookContext;

      // Extract patient data from prefetch
      const patient = extractPatient(prefetch);
      const conditions = extractConditions(prefetch);
      const observations = extractObservations(prefetch);

      // Generate care plan recommendations
      const recommendations = await generateRecommendations(
        patient,
        conditions,
        observations,
        context
      );

      // Build response cards
      const cards: CDSCard[] = [];

      // Add warning card if prefetch issues
      if (shouldAddPrefetchWarning(hookContext)) {
        cards.push(createPrefetchWarningCard(warnings));
      }

      // Add recommendation cards
      for (const recommendation of recommendations) {
        cards.push(buildCard(recommendation));
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
