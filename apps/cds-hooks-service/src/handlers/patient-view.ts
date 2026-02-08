import { Router, Request, Response, NextFunction } from 'express';
import type {
  CDSHookRequest,
  CDSIndicator,
  PatientViewContext,
} from '../types';
import { createHookValidator } from '../middleware/validation';
import { buildHookContext, createPrefetchWarningCard, shouldAddPrefetchWarning } from '../services/prefetch';
import type { FHIRBundle, FHIRResource } from '../clients/fhir';
import { CardBuilder } from '../builders/card';
import { ResponseAssembler } from '../assemblers/response';
import { SOURCE_LABELS } from '../constants';
import {
  generateAllRecommendations,
  type CarePlanRecommendation,
} from '../services/recommendation-engine';
import {
  isFHIRPatient,
  isFHIRCondition,
  isFHIRObservation,
  isFHIRBundle,
} from '../utils/type-guards';

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
 * Extract conditions from prefetch bundle using type guards
 */
function extractConditions(prefetchData: Record<string, unknown>): FHIRCondition[] {
  const conditionsBundle = prefetchData.conditions;

  if (!isFHIRBundle(conditionsBundle) || !conditionsBundle.entry) {
    return [];
  }

  const conditions: FHIRCondition[] = [];

  for (const entry of conditionsBundle.entry) {
    if (entry.resource && isFHIRCondition(entry.resource)) {
      conditions.push(entry.resource as FHIRCondition);
    }
  }

  return conditions;
}

/**
 * Extract patient from prefetch using type guards
 */
function extractPatient(prefetchData: Record<string, unknown>): FHIRPatient | undefined {
  const patient = prefetchData.patient;

  if (isFHIRPatient(patient)) {
    return patient as FHIRPatient;
  }

  return undefined;
}

/**
 * Extract observations from prefetch bundle using type guards
 */
function extractObservations(prefetchData: Record<string, unknown>): FHIRObservation[] {
  const observationsBundle = prefetchData.observations;

  if (!isFHIRBundle(observationsBundle) || !observationsBundle.entry) {
    return [];
  }

  const observations: FHIRObservation[] = [];

  for (const entry of observationsBundle.entry) {
    if (entry.resource && isFHIRObservation(entry.resource)) {
      observations.push(entry.resource as FHIRObservation);
    }
  }

  return observations;
}

/**
 * Build detail markdown from recommendation
 */
function buildRecommendationDetail(recommendation: CarePlanRecommendation): string {
  let detail = recommendation.description;

  if (recommendation.rationale) {
    detail += `\n\n**Rationale:** ${recommendation.rationale}`;
  }

  if (recommendation.actions && recommendation.actions.length > 0) {
    detail += '\n\n**Recommended Actions:**\n';
    recommendation.actions.forEach((action) => {
      detail += `- ${action.description}\n`;
    });
  }

  return detail;
}

/**
 * Build CDS card from care plan recommendation using CardBuilder
 */
function buildRecommendationCard(recommendation: CarePlanRecommendation) {
  return new CardBuilder()
    .withUuid(recommendation.id)
    .withSummary(recommendation.title)
    .withIndicator(priorityToIndicator(recommendation.priority))
    .withSource(recommendation.source ?? { label: SOURCE_LABELS.PRISM_CARE_PLAN })
    .withDetail(buildRecommendationDetail(recommendation))
    .build();
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

      // Build hook context with resolved prefetch data
      const hookContext = await buildHookContext(hookRequest, 'prism-patient-view');
      const { prefetch, warnings } = hookContext;

      // Extract patient data from prefetch
      const patient = extractPatient(prefetch);
      const conditions = extractConditions(prefetch);
      const observations = extractObservations(prefetch);

      // Generate care plan recommendations using the recommendation engine
      const recommendations = await generateAllRecommendations(
        patient,
        conditions,
        observations
      );

      // Build response using ResponseAssembler
      const assembler = new ResponseAssembler();

      // Add warning card if prefetch issues
      if (shouldAddPrefetchWarning(hookContext)) {
        assembler.addCard(createPrefetchWarningCard(warnings));
      }

      // Add recommendation cards
      for (const recommendation of recommendations) {
        assembler.addCard(buildRecommendationCard(recommendation));
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
