/**
 * Generate Care Plan Resolver
 *
 * Handles the generateCarePlanFromVisit mutation.
 */

import { GraphQLError } from 'graphql';
import { v4 as uuidv4 } from 'uuid';
import { Pool } from 'pg';
import {
  PipelineOrchestrator,
  PipelineInput,
  PipelineOutput,
  createRequestId,
} from '../../orchestration';
import { RequestTracker } from '../../jobs/request-tracker';
import { carePlanService } from '../../services/database';

/**
 * Context for the resolver
 */
interface ResolverContext {
  userId: string;
  userRole: string;
  pool: Pool;
  requestTracker: RequestTracker;
  pipelineOrchestrator?: PipelineOrchestrator;
  auditLogger?: {
    logAccess: (entry: any) => Promise<void>;
  };
}

/**
 * Input for generate care plan mutation
 */
interface GenerateCarePlanInput {
  visitId: string;
  patientId: string;
  transcriptText?: string;
  audioUrl?: string;
  conditionCodes: string[];
  generateDraft?: boolean;
  preferredTemplateIds?: string[];
  idempotencyKey: string;
}

/**
 * Generate care plan resolver
 */
export async function generateCarePlanFromVisit(
  _parent: unknown,
  args: { input: GenerateCarePlanInput },
  context: ResolverContext
): Promise<{
  requestId: string;
  recommendations: any[];
  draftCarePlan: any;
  extractedEntities: any;
  redFlags: any[];
  processingTime: number;
  cacheHit: boolean;
  degradedServices: string[];
  requiresManualReview: boolean;
}> {
  const { input } = args;
  const correlationId = uuidv4();

  // Validate user is authenticated
  if (!context.userId) {
    throw new GraphQLError('Authentication required', {
      extensions: { code: 'UNAUTHENTICATED' },
    });
  }

  // Validate user role
  const allowedRoles = ['PROVIDER', 'CARE_COORDINATOR', 'ADMIN'];
  if (!allowedRoles.includes(context.userRole)) {
    throw new GraphQLError('Insufficient permissions', {
      extensions: { code: 'FORBIDDEN' },
    });
  }

  // Validate input
  if (!input.visitId || !input.patientId) {
    throw new GraphQLError('visitId and patientId are required', {
      extensions: { code: 'BAD_USER_INPUT' },
    });
  }

  if (!input.conditionCodes || input.conditionCodes.length === 0) {
    throw new GraphQLError('At least one condition code is required', {
      extensions: { code: 'BAD_USER_INPUT' },
    });
  }

  if (!input.idempotencyKey) {
    throw new GraphQLError('idempotencyKey is required', {
      extensions: { code: 'BAD_USER_INPUT' },
    });
  }

  // Validate ICD-10 code format
  const icd10Pattern = /^[A-Z]\d{2}(\.\d{1,4})?$/;
  for (const code of input.conditionCodes) {
    if (!icd10Pattern.test(code)) {
      throw new GraphQLError(`Invalid ICD-10 code format: ${code}`, {
        extensions: { code: 'BAD_USER_INPUT' },
      });
    }
  }

  // TODO: In production, verify user has access to this patient
  // await verifyPatientAccess(context.userId, input.patientId);

  // Build pipeline input (outside try so correlationId/requestId are available in catch)
  const pipelineInput: PipelineInput = {
      visitId: input.visitId,
      patientId: input.patientId,
      transcriptText: input.transcriptText,
      audioUrl: input.audioUrl,
      conditionCodes: input.conditionCodes,
      idempotencyKey: input.idempotencyKey,
      correlationId,
      generateDraft: input.generateDraft,
      preferredTemplateIds: input.preferredTemplateIds,
      userId: context.userId,
      userRole: context.userRole,
    };

  // Create pipeline request record before execution
  const requestId = await context.requestTracker.createRequest({
    visitId: input.visitId,
    patientId: input.patientId,
    userId: context.userId,
    idempotencyKey: input.idempotencyKey,
    pipelineInput,
  });

  try {
    // Update status to in-progress
    await context.requestTracker.updateStatus(requestId, 'IN_PROGRESS');

    let result: PipelineOutput;

    if (context.pipelineOrchestrator) {
      // Execute full ML pipeline
      result = await context.pipelineOrchestrator.process(pipelineInput);
    } else {
      // No orchestrator available — return empty result for dev/testing
      result = {
        requestId,
        extractedEntities: undefined,
        recommendations: [],
        draftCarePlan: undefined,
        redFlags: [],
        processingMetadata: {
          requestId,
          correlationId,
          totalDurationMs: 0,
          stageResults: [],
          cacheHit: false,
          modelVersions: [],
          processedAt: new Date(),
        },
        degradedServices: [],
        requiresManualReview: false,
      };
    }

    // Store completed result
    result.requestId = requestId;
    await context.requestTracker.complete(requestId, result);

    // Map result to GraphQL response
    return {
      requestId,
      recommendations: result.recommendations.map((r) => ({
        templateId: r.templateId,
        title: r.title,
        confidence: r.confidence,
        matchedConditions: r.matchedConditions,
        reasoning: r.reasoning,
        guidelineSource: r.guidelineSource,
        evidenceGrade: r.evidenceGrade,
      })),
      draftCarePlan: result.draftCarePlan
        ? {
            id: result.draftCarePlan.id,
            title: result.draftCarePlan.title,
            conditionCodes: result.draftCarePlan.conditionCodes,
            templateId: result.draftCarePlan.templateId,
            goals: result.draftCarePlan.goals.map((g) => ({
              description: g.description,
              targetValue: g.targetValue,
              targetDate: g.targetDate?.toISOString(),
              priority: g.priority,
              guidelineReference: g.guidelineReference,
            })),
            interventions: result.draftCarePlan.interventions.map((i) => ({
              type: i.type,
              description: i.description,
              medicationCode: i.medicationCode,
              dosage: i.dosage,
              frequency: i.frequency,
              procedureCode: i.procedureCode,
              scheduledDate: i.scheduledDate?.toISOString(),
              patientInstructions: i.patientInstructions,
              guidelineReference: i.guidelineReference,
            })),
            generatedAt: result.draftCarePlan.generatedAt.toISOString(),
            confidence: result.draftCarePlan.confidence,
            requiresReview: result.draftCarePlan.requiresReview,
          }
        : null,
      extractedEntities: result.extractedEntities
        ? {
            symptoms: result.extractedEntities.symptoms,
            medications: result.extractedEntities.medications,
            vitals: result.extractedEntities.vitals,
            procedures: result.extractedEntities.procedures,
            diagnoses: result.extractedEntities.diagnoses,
            allergies: result.extractedEntities.allergies,
            extractedAt: result.extractedEntities.extractedAt.toISOString(),
            modelVersion: result.extractedEntities.modelVersion,
          }
        : null,
      redFlags: result.redFlags.map((f) => ({
        severity: f.severity,
        description: f.description,
        sourceText: f.sourceText,
        recommendedAction: f.recommendedAction,
        category: f.category,
        confidence: f.confidence,
      })),
      processingTime: result.processingMetadata.totalDurationMs,
      cacheHit: result.processingMetadata.cacheHit,
      degradedServices: result.degradedServices,
      requiresManualReview: result.requiresManualReview,
    };
  } catch (error) {
    const err = error as Error;

    // Mark pipeline request as failed
    await context.requestTracker.fail(requestId, {
      message: err.message,
      code: 'PIPELINE_ERROR',
    }).catch(() => {}); // Don't mask original error

    // Log error (without PHI)
    console.error(JSON.stringify({
      service: 'careplan-service',
      message: 'Pipeline error',
      correlationId,
      visitId: input.visitId,
      error: err.message,
    }));

    // Throw appropriate GraphQL error
    if (err.message.includes('already in progress')) {
      throw new GraphQLError('A request with this idempotency key is already in progress', {
        extensions: { code: 'CONFLICT' },
      });
    }

    if (err.message.includes('Validation failed')) {
      throw new GraphQLError('Invalid input data', {
        extensions: { code: 'BAD_USER_INPUT' },
      });
    }

    throw new GraphQLError('Failed to generate care plan', {
      extensions: {
        code: 'INTERNAL_SERVER_ERROR',
        correlationId,
      },
    });
  }
}

/**
 * Accept care plan draft resolver
 */
export async function acceptCarePlanDraft(
  _parent: unknown,
  args: { requestId: string; edits?: Array<{ field: string; value: string }> },
  context: ResolverContext
): Promise<any> {
  if (!context.userId) {
    throw new GraphQLError('Authentication required', {
      extensions: { code: 'UNAUTHENTICATED' },
    });
  }

  // Fetch the pipeline request and decrypt result
  const pipelineResult = await context.requestTracker.getDecryptedResult(args.requestId);
  if (!pipelineResult) {
    throw new GraphQLError('Pipeline request not found or result unavailable', {
      extensions: { code: 'NOT_FOUND' },
    });
  }

  const request = await context.requestTracker.getById(args.requestId);
  if (!request || request.status !== 'COMPLETED') {
    throw new GraphQLError('Pipeline request is not in COMPLETED status', {
      extensions: { code: 'BAD_USER_INPUT' },
    });
  }

  const draft = pipelineResult.draftCarePlan;
  if (!draft) {
    throw new GraphQLError('No draft care plan in pipeline result', {
      extensions: { code: 'BAD_USER_INPUT' },
    });
  }

  // Apply edits to the draft title if provided
  let title = draft.title;
  if (args.edits) {
    for (const edit of args.edits) {
      if (edit.field === 'title') {
        title = edit.value;
      }
    }
  }

  // Create the real care plan
  const carePlan = await carePlanService.createCarePlan({
    patientId: request.patientId,
    title,
    conditionCodes: draft.conditionCodes,
    startDate: new Date(),
    templateId: draft.templateId,
    createdBy: context.userId,
  });

  // Add goals from draft
  const goals = [];
  for (const draftGoal of draft.goals) {
    const goal = await carePlanService.addGoal({
      carePlanId: carePlan.id,
      description: draftGoal.description,
      targetValue: draftGoal.targetValue,
      targetDate: draftGoal.targetDate ? new Date(draftGoal.targetDate) : undefined,
      priority: draftGoal.priority as any,
      guidelineReference: draftGoal.guidelineReference,
    });
    goals.push(goal);
  }

  // Add interventions from draft
  const interventions = [];
  for (const draftIntervention of draft.interventions) {
    const intervention = await carePlanService.addIntervention({
      carePlanId: carePlan.id,
      type: draftIntervention.type as any,
      description: draftIntervention.description,
      medicationCode: draftIntervention.medicationCode,
      dosage: draftIntervention.dosage,
      frequency: draftIntervention.frequency,
      procedureCode: draftIntervention.procedureCode,
      scheduledDate: draftIntervention.scheduledDate ? new Date(draftIntervention.scheduledDate) : undefined,
      patientInstructions: draftIntervention.patientInstructions,
      guidelineReference: draftIntervention.guidelineReference,
    });
    interventions.push(intervention);
  }

  // Mark pipeline request as accepted
  await context.requestTracker.markAccepted(args.requestId, carePlan.id, context.userId);

  return {
    ...carePlan,
    goals,
    interventions,
    patient: { __typename: 'Patient' as const, id: request.patientId },
  };
}

/**
 * Reject care plan draft resolver
 */
export async function rejectCarePlanDraft(
  _parent: unknown,
  args: { requestId: string; reason: string },
  context: ResolverContext
): Promise<any> {
  if (!context.userId) {
    throw new GraphQLError('Authentication required', {
      extensions: { code: 'UNAUTHENTICATED' },
    });
  }

  if (!args.reason || args.reason.trim().length === 0) {
    throw new GraphQLError('Rejection reason is required', {
      extensions: { code: 'BAD_USER_INPUT' },
    });
  }

  const request = await context.requestTracker.getById(args.requestId);
  if (!request) {
    throw new GraphQLError('Pipeline request not found', {
      extensions: { code: 'NOT_FOUND' },
    });
  }

  if (request.status !== 'COMPLETED') {
    throw new GraphQLError('Pipeline request is not in COMPLETED status', {
      extensions: { code: 'BAD_USER_INPUT' },
    });
  }

  await context.requestTracker.markRejected(args.requestId, args.reason.trim(), context.userId);

  return {
    requestId: args.requestId,
    status: 'REJECTED',
    createdAt: request.createdAt,
    startedAt: request.startedAt,
    completedAt: request.completedAt,
  };
}

/**
 * Regenerate care plan resolver
 */
export async function regenerateCarePlan(
  _parent: unknown,
  args: {
    requestId: string;
    preferences: {
      excludeTemplateIds?: string[];
      preferredTemplateIds?: string[];
      focusConditions?: string[];
    };
  },
  context: ResolverContext
): Promise<any> {
  // Validate authentication
  if (!context.userId) {
    throw new GraphQLError('Authentication required', {
      extensions: { code: 'UNAUTHENTICATED' },
    });
  }

  // TODO: Implement regeneration
  // 1. Fetch original request
  // 2. Create new request with updated preferences
  // 3. Process with new constraints

  throw new GraphQLError('Not yet implemented', {
    extensions: { code: 'NOT_IMPLEMENTED' },
  });
}
