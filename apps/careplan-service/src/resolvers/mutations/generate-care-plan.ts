/**
 * Generate Care Plan Resolver
 *
 * Handles the generateCarePlanFromVisit mutation.
 */

import { GraphQLError } from 'graphql';
import { v4 as uuidv4 } from 'uuid';
import {
  PipelineOrchestrator,
  PipelineInput,
  PipelineOutput,
  createRequestId,
} from '../../orchestration';

/**
 * Context for the resolver
 */
interface ResolverContext {
  userId: string;
  userRole: string;
  pipelineOrchestrator: PipelineOrchestrator;
  auditLogger: {
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

  try {
    // Build pipeline input
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

    // Execute pipeline
    const result = await context.pipelineOrchestrator.process(pipelineInput);

    // Map result to GraphQL response
    return {
      requestId: result.requestId,
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

    // Log error (without PHI)
    console.error('Pipeline error:', {
      correlationId,
      visitId: input.visitId,
      error: err.message,
    });

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
  // Validate authentication
  if (!context.userId) {
    throw new GraphQLError('Authentication required', {
      extensions: { code: 'UNAUTHENTICATED' },
    });
  }

  // TODO: Implement draft acceptance
  // 1. Fetch the draft from pipeline request
  // 2. Apply any edits
  // 3. Create the actual care plan
  // 4. Store provider feedback for training
  // 5. Audit log the approval

  throw new GraphQLError('Not yet implemented', {
    extensions: { code: 'NOT_IMPLEMENTED' },
  });
}

/**
 * Reject care plan draft resolver
 */
export async function rejectCarePlanDraft(
  _parent: unknown,
  args: { requestId: string; reason: string },
  context: ResolverContext
): Promise<any> {
  // Validate authentication
  if (!context.userId) {
    throw new GraphQLError('Authentication required', {
      extensions: { code: 'UNAUTHENTICATED' },
    });
  }

  // TODO: Implement draft rejection
  // 1. Mark the pipeline request as rejected
  // 2. Store rejection reason for training
  // 3. Audit log the rejection

  throw new GraphQLError('Not yet implemented', {
    extensions: { code: 'NOT_IMPLEMENTED' },
  });
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
