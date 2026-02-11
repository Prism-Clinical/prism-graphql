/**
 * PDF Import Resolver
 *
 * Handles the importCarePlanFromPdfFile mutation.
 */

import { GraphQLError } from 'graphql';
import { v4 as uuidv4 } from 'uuid';

/**
 * Context for the resolver
 */
interface ResolverContext {
  userId: string;
  userRole: string;
  pdfParserClient: {
    parseFromKey: (fileKey: string) => Promise<any>;
    healthCheck: () => Promise<any>;
  };
  auditLogger: {
    logAccess: (entry: any) => Promise<void>;
  };
}

/**
 * PDF import result
 */
interface PdfImportResult {
  requestId: string;
  parsedCarePlan: {
    id: string;
    title: string;
    conditionCodes: string[];
    goals: Array<{
      description: string;
      targetValue?: string;
      targetDate?: string;
      priority: string;
      guidelineReference?: string;
    }>;
    interventions: Array<{
      type: string;
      description: string;
      medicationCode?: string;
      dosage?: string;
      frequency?: string;
      procedureCode?: string;
      scheduledDate?: string;
      patientInstructions?: string;
      guidelineReference?: string;
    }>;
    generatedAt: string;
    confidence: number;
    requiresReview: boolean;
  } | null;
  extractedCodes: Array<{
    code: string;
    codeSystem: string;
    display?: string;
    confidence: number;
  }>;
  validationResult: {
    valid: boolean;
    errors: string[];
    warnings: string[];
    fileSize: number;
    mimeType: string;
  };
}

/**
 * Import care plan from PDF file resolver
 */
export async function importCarePlanFromPdfFile(
  _parent: unknown,
  args: { patientId: string; fileKey: string },
  context: ResolverContext
): Promise<PdfImportResult> {
  const { patientId, fileKey } = args;
  const requestId = uuidv4();
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
  if (!patientId) {
    throw new GraphQLError('patientId is required', {
      extensions: { code: 'BAD_USER_INPUT' },
    });
  }

  if (!fileKey) {
    throw new GraphQLError('fileKey is required', {
      extensions: { code: 'BAD_USER_INPUT' },
    });
  }

  // Validate file key format (should be a secure reference)
  const fileKeyPattern = /^upload:[a-f0-9-]{36}$/;
  if (!fileKeyPattern.test(fileKey)) {
    throw new GraphQLError('Invalid file key format', {
      extensions: { code: 'BAD_USER_INPUT' },
    });
  }

  // TODO: In production, verify user has access to this patient
  // await verifyPatientAccess(context.userId, patientId);

  try {
    // Log PHI access
    await context.auditLogger.logAccess({
      eventType: 'PHI_ACCESS',
      userId: context.userId,
      userRole: context.userRole,
      patientId,
      resourceType: 'pdf_import',
      action: 'PROCESS',
      phiFields: ['file_content'],
      correlationId,
      requestId,
      outcome: 'SUCCESS',
    });

    // Call PDF parser service
    const parseResult = await context.pdfParserClient.parseFromKey(fileKey);

    // Map result to GraphQL response
    return {
      requestId,
      parsedCarePlan: parseResult.carePlan
        ? {
            id: uuidv4(),
            title: parseResult.carePlan.title || 'Imported Care Plan',
            conditionCodes: parseResult.carePlan.conditionCodes || [],
            goals:
              parseResult.carePlan.goals?.map((g: any) => ({
                description: g.description,
                targetValue: g.targetValue,
                targetDate: g.targetDate,
                priority: g.priority || 'MEDIUM',
                guidelineReference: g.guidelineReference,
              })) || [],
            interventions:
              parseResult.carePlan.interventions?.map((i: any) => ({
                type: i.type || 'EDUCATION',
                description: i.description,
                medicationCode: i.medicationCode,
                dosage: i.dosage,
                frequency: i.frequency,
                procedureCode: i.procedureCode,
                scheduledDate: i.scheduledDate,
                patientInstructions: i.patientInstructions,
                guidelineReference: i.guidelineReference,
              })) || [],
            generatedAt: new Date().toISOString(),
            confidence: parseResult.confidence || 0.7,
            requiresReview: true, // Always require review for imports
          }
        : null,
      extractedCodes:
        parseResult.codes?.map((c: any) => ({
          code: c.code,
          codeSystem: c.codeSystem || 'ICD-10',
          display: c.display,
          confidence: c.confidence || 0.8,
        })) || [],
      validationResult: {
        valid: parseResult.validation?.valid ?? true,
        errors: parseResult.validation?.errors || [],
        warnings: parseResult.validation?.warnings || [],
        fileSize: parseResult.validation?.fileSize || 0,
        mimeType: parseResult.validation?.mimeType || 'application/pdf',
      },
    };
  } catch (error) {
    const err = error as Error;

    // Log error (without PHI)
    console.error('PDF import error:', {
      correlationId,
      patientId: patientId.substring(0, 8) + '...', // Truncate for logging
      error: err.message,
    });

    // Handle specific error types
    if (err.message.includes('file not found')) {
      throw new GraphQLError('File not found or expired', {
        extensions: { code: 'NOT_FOUND' },
      });
    }

    if (err.message.includes('invalid pdf')) {
      throw new GraphQLError('Invalid PDF file', {
        extensions: { code: 'BAD_USER_INPUT' },
      });
    }

    if (err.message.includes('file too large')) {
      throw new GraphQLError('File exceeds maximum size limit', {
        extensions: { code: 'BAD_USER_INPUT' },
      });
    }

    if (err.message.includes('circuit')) {
      throw new GraphQLError('PDF parsing service temporarily unavailable', {
        extensions: { code: 'SERVICE_UNAVAILABLE' },
      });
    }

    throw new GraphQLError('Failed to import PDF', {
      extensions: {
        code: 'INTERNAL_SERVER_ERROR',
        correlationId,
      },
    });
  }
}
