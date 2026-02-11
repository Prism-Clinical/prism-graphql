/**
 * Visit Workflow Mutations
 *
 * Mutations for visit recording and care plan submission workflow.
 */

import { GraphQLError } from 'graphql';
import { v4 as uuidv4 } from 'uuid';
import { visitService } from '../../services/database';

/**
 * Context for resolvers
 */
interface ResolverContext {
  userId: string;
  userRole: string;
  redis: {
    setex: (key: string, seconds: number, value: string) => Promise<void>;
    get: (key: string) => Promise<string | null>;
    del: (key: string) => Promise<void>;
  };
  storageService: {
    generateSignedUploadUrl: (key: string, contentType: string, expiresIn: number) => Promise<string>;
  };
  pipelineQueue: {
    enqueue: (data: any) => Promise<{ requestId: string }>;
  };
  auditLogger: {
    logAccess: (entry: any) => Promise<void>;
  };
}

/**
 * Recording session type
 */
interface VisitRecordingSession {
  sessionId: string;
  visit: any;
  recordingUrl: string;
  startedAt: string;
}

/**
 * Start a visit recording session
 */
export async function startVisitWithRecording(
  _parent: unknown,
  args: { visitId: string },
  context: ResolverContext
): Promise<VisitRecordingSession> {
  const { visitId } = args;

  // Validate authentication
  if (!context.userId) {
    throw new GraphQLError('Authentication required', {
      extensions: { code: 'UNAUTHENTICATED' },
    });
  }

  // Validate user role
  const allowedRoles = ['PROVIDER'];
  if (!allowedRoles.includes(context.userRole)) {
    throw new GraphQLError('Only providers can start recording sessions', {
      extensions: { code: 'FORBIDDEN' },
    });
  }

  try {
    // Get visit
    const visit = await visitService.getVisitById(visitId);
    if (!visit) {
      throw new GraphQLError('Visit not found', {
        extensions: { code: 'NOT_FOUND' },
      });
    }

    // TODO: Verify provider owns this visit
    // if (visit.providerId !== context.userId) {
    //   throw new GraphQLError('Access denied', {
    //     extensions: { code: 'FORBIDDEN' },
    //   });
    // }

    // Check visit status
    if (visit.status !== 'SCHEDULED' && visit.status !== 'CHECKED_IN') {
      throw new GraphQLError('Visit must be scheduled or checked in to start recording', {
        extensions: { code: 'BAD_REQUEST' },
      });
    }

    // Generate session ID
    const sessionId = uuidv4();
    const uploadKey = `recordings/${visitId}/${sessionId}`;

    // Generate signed upload URL (expires in 1 hour)
    const recordingUrl = await context.storageService.generateSignedUploadUrl(
      uploadKey,
      'audio/webm',
      3600 // 1 hour
    );

    // Store session in Redis
    const sessionData = {
      sessionId,
      visitId,
      userId: context.userId,
      uploadKey,
      startedAt: new Date().toISOString(),
    };

    await context.redis.setex(
      `recording:session:${sessionId}`,
      3600, // 1 hour TTL
      JSON.stringify(sessionData)
    );

    // Update visit status to IN_PROGRESS
    await visitService.updateVisitStatus(visitId, 'IN_PROGRESS');

    // Log access
    await context.auditLogger.logAccess({
      eventType: 'RECORDING_STARTED',
      userId: context.userId,
      userRole: context.userRole,
      patientId: visit.patientId,
      resourceType: 'visit_recording',
      resourceId: sessionId,
      action: 'CREATE',
      outcome: 'SUCCESS',
    });

    return {
      sessionId,
      visit: {
        id: visit.id,
        patientId: visit.patientId,
        type: visit.type,
        status: 'IN_PROGRESS',
        scheduledAt: visit.scheduledAt,
        startedAt: new Date().toISOString(),
      },
      recordingUrl,
      startedAt: sessionData.startedAt,
    };
  } catch (error) {
    if (error instanceof GraphQLError) throw error;

    console.error('Start recording error:', error);
    throw new GraphQLError('Failed to start recording session', {
      extensions: { code: 'INTERNAL_SERVER_ERROR' },
    });
  }
}

/**
 * End a visit recording session
 */
export async function endVisitRecording(
  _parent: unknown,
  args: { sessionId: string },
  context: ResolverContext
): Promise<any> {
  const { sessionId } = args;

  // Validate authentication
  if (!context.userId) {
    throw new GraphQLError('Authentication required', {
      extensions: { code: 'UNAUTHENTICATED' },
    });
  }

  try {
    // Get session from Redis
    const sessionJson = await context.redis.get(`recording:session:${sessionId}`);
    if (!sessionJson) {
      throw new GraphQLError('Recording session not found or expired', {
        extensions: { code: 'NOT_FOUND' },
      });
    }

    const session = JSON.parse(sessionJson);

    // Verify user owns session
    if (session.userId !== context.userId) {
      throw new GraphQLError('Access denied', {
        extensions: { code: 'FORBIDDEN' },
      });
    }

    // Get visit
    const visit = await visitService.getVisitById(session.visitId);
    if (!visit) {
      throw new GraphQLError('Visit not found', {
        extensions: { code: 'NOT_FOUND' },
      });
    }

    // Update visit with recording info
    await visitService.updateVisit(session.visitId, {
      recordingKey: session.uploadKey,
      recordingEndedAt: new Date(),
    });

    // Clean up session
    await context.redis.del(`recording:session:${sessionId}`);

    // Log access
    await context.auditLogger.logAccess({
      eventType: 'RECORDING_ENDED',
      userId: context.userId,
      userRole: context.userRole,
      patientId: visit.patientId,
      resourceType: 'visit_recording',
      resourceId: sessionId,
      action: 'UPDATE',
      outcome: 'SUCCESS',
    });

    return {
      id: visit.id,
      patientId: visit.patientId,
      type: visit.type,
      status: visit.status,
      scheduledAt: visit.scheduledAt,
      startedAt: visit.startedAt,
      recordingKey: session.uploadKey,
    };
  } catch (error) {
    if (error instanceof GraphQLError) throw error;

    console.error('End recording error:', error);
    throw new GraphQLError('Failed to end recording session', {
      extensions: { code: 'INTERNAL_SERVER_ERROR' },
    });
  }
}

/**
 * Submit visit for care plan generation
 */
export async function submitVisitForCarePlan(
  _parent: unknown,
  args: { visitId: string; idempotencyKey: string },
  context: ResolverContext
): Promise<{ requestId: string; status: string }> {
  const { visitId, idempotencyKey } = args;

  // Validate authentication
  if (!context.userId) {
    throw new GraphQLError('Authentication required', {
      extensions: { code: 'UNAUTHENTICATED' },
    });
  }

  // Validate user role
  const allowedRoles = ['PROVIDER', 'CARE_COORDINATOR'];
  if (!allowedRoles.includes(context.userRole)) {
    throw new GraphQLError('Insufficient permissions', {
      extensions: { code: 'FORBIDDEN' },
    });
  }

  // Validate idempotency key
  if (!idempotencyKey) {
    throw new GraphQLError('idempotencyKey is required', {
      extensions: { code: 'BAD_USER_INPUT' },
    });
  }

  try {
    // Get visit
    const visit = await visitService.getVisitById(visitId);
    if (!visit) {
      throw new GraphQLError('Visit not found', {
        extensions: { code: 'NOT_FOUND' },
      });
    }

    // TODO: Verify provider owns this visit

    // Check for existing request with same idempotency key
    const existingRequest = await context.redis.get(`careplan:idempotency:${idempotencyKey}`);
    if (existingRequest) {
      const parsed = JSON.parse(existingRequest);
      return {
        requestId: parsed.requestId,
        status: parsed.status,
      };
    }

    // Enqueue generation job
    const result = await context.pipelineQueue.enqueue({
      visitId,
      patientId: visit.patientId,
      conditionCodes: visit.conditionCodes || [],
      idempotencyKey,
      userId: context.userId,
      userRole: context.userRole,
      correlationId: uuidv4(),
    });

    // Store idempotency key
    await context.redis.setex(
      `careplan:idempotency:${idempotencyKey}`,
      86400, // 24 hours
      JSON.stringify({
        requestId: result.requestId,
        status: 'PENDING',
      })
    );

    // Update visit status
    await visitService.updateVisit(visitId, {
      carePlanRequestId: result.requestId,
      carePlanRequestedAt: new Date(),
    });

    // Log access
    await context.auditLogger.logAccess({
      eventType: 'CAREPLAN_REQUESTED',
      userId: context.userId,
      userRole: context.userRole,
      patientId: visit.patientId,
      resourceType: 'care_plan_request',
      resourceId: result.requestId,
      action: 'CREATE',
      outcome: 'SUCCESS',
    });

    return {
      requestId: result.requestId,
      status: 'PENDING',
    };
  } catch (error) {
    if (error instanceof GraphQLError) throw error;

    console.error('Submit for care plan error:', error);
    throw new GraphQLError('Failed to submit visit for care plan', {
      extensions: { code: 'INTERNAL_SERVER_ERROR' },
    });
  }
}

/**
 * Complete a visit
 */
export async function completeVisit(
  _parent: unknown,
  args: { visitId: string; notes?: string },
  context: ResolverContext
): Promise<any> {
  const { visitId, notes } = args;

  // Validate authentication
  if (!context.userId) {
    throw new GraphQLError('Authentication required', {
      extensions: { code: 'UNAUTHENTICATED' },
    });
  }

  try {
    // Get visit
    const visit = await visitService.getVisitById(visitId);
    if (!visit) {
      throw new GraphQLError('Visit not found', {
        extensions: { code: 'NOT_FOUND' },
      });
    }

    // Update visit
    const updated = await visitService.completeVisit(visitId, {
      notes,
      completedAt: new Date(),
      completedBy: context.userId,
    });

    // Log access
    await context.auditLogger.logAccess({
      eventType: 'VISIT_COMPLETED',
      userId: context.userId,
      userRole: context.userRole,
      patientId: visit.patientId,
      resourceType: 'visit',
      resourceId: visitId,
      action: 'UPDATE',
      outcome: 'SUCCESS',
    });

    return updated;
  } catch (error) {
    if (error instanceof GraphQLError) throw error;

    console.error('Complete visit error:', error);
    throw new GraphQLError('Failed to complete visit', {
      extensions: { code: 'INTERNAL_SERVER_ERROR' },
    });
  }
}
