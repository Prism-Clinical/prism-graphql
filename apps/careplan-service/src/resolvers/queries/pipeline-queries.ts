/**
 * Pipeline Query Resolvers
 *
 * Handles pipeline-related queries.
 */

import { GraphQLError } from 'graphql';

/**
 * Context for resolvers
 */
interface ResolverContext {
  userId: string;
  userRole: string;
  pipelineOrchestrator: {
    getCacheStats: () => Promise<any>;
    getCircuitStates: () => Record<string, string>;
  };
  mlClientFactory: {
    checkAllServices: () => Promise<any>;
  };
  pipelineRequestRepository: {
    getById: (id: string) => Promise<any>;
    getByVisitId: (visitId: string) => Promise<any>;
  };
  auditLogger: {
    logAccess: (entry: any) => Promise<void>;
  };
}

/**
 * Get pipeline request by ID
 */
export async function pipelineRequest(
  _parent: unknown,
  args: { requestId: string },
  context: ResolverContext
): Promise<any> {
  const { requestId } = args;

  // Validate authentication
  if (!context.userId) {
    throw new GraphQLError('Authentication required', {
      extensions: { code: 'UNAUTHENTICATED' },
    });
  }

  // Validate requestId format
  if (!requestId || !/^[a-f0-9-]{36}$/.test(requestId)) {
    throw new GraphQLError('Invalid requestId format', {
      extensions: { code: 'BAD_USER_INPUT' },
    });
  }

  try {
    const request = await context.pipelineRequestRepository.getById(requestId);

    if (!request) {
      return null;
    }

    // TODO: In production, verify user has access to this request
    // if (request.userId !== context.userId && context.userRole !== 'ADMIN') {
    //   throw new GraphQLError('Access denied', {
    //     extensions: { code: 'FORBIDDEN' },
    //   });
    // }

    return {
      requestId: request.id,
      status: request.status,
      createdAt: request.createdAt,
      startedAt: request.startedAt,
      completedAt: request.completedAt,
    };
  } catch (error) {
    console.error('Failed to fetch pipeline request:', error);
    throw new GraphQLError('Failed to fetch pipeline request', {
      extensions: { code: 'INTERNAL_SERVER_ERROR' },
    });
  }
}

/**
 * Get care plan review data
 */
export async function carePlanReview(
  _parent: unknown,
  args: { requestId: string },
  context: ResolverContext
): Promise<any> {
  const { requestId } = args;

  // Validate authentication
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

  try {
    const request = await context.pipelineRequestRepository.getById(requestId);

    if (!request) {
      return null;
    }

    // TODO: Verify access
    // TODO: Decrypt result

    // Log PHI access
    await context.auditLogger.logAccess({
      eventType: 'PHI_ACCESS',
      userId: context.userId,
      userRole: context.userRole,
      patientId: request.patientId,
      resourceType: 'pipeline_result',
      resourceId: requestId,
      action: 'READ',
      phiFields: ['extractedEntities', 'draftCarePlan'],
      outcome: 'SUCCESS',
    });

    // Return review data
    return {
      request: {
        requestId: request.id,
        status: request.status,
        createdAt: request.createdAt,
        startedAt: request.startedAt,
        completedAt: request.completedAt,
      },
      recommendations: request.result?.recommendations || [],
      draftCarePlan: request.result?.draftCarePlan || null,
      extractedEntities: request.result?.extractedEntities || null,
      redFlags: request.result?.redFlags || [],
      suggestedEdits: [], // TODO: Implement edit suggestions
      degradedServices: request.result?.degradedServices || [],
    };
  } catch (error) {
    console.error('Failed to fetch care plan review:', error);
    throw new GraphQLError('Failed to fetch care plan review', {
      extensions: { code: 'INTERNAL_SERVER_ERROR' },
    });
  }
}

/**
 * Get pipeline health status
 */
export async function pipelineHealth(
  _parent: unknown,
  _args: unknown,
  context: ResolverContext
): Promise<{
  overall: string;
  services: Array<{
    service: string;
    status: string;
    latencyMs: number;
    circuitState: string;
    lastError?: string;
    lastSuccess?: string;
  }>;
  degradedServices: string[];
  checkDurationMs: number;
}> {
  // Note: Health check doesn't require authentication for monitoring
  // But we should still log access
  const startTime = Date.now();

  try {
    // Get health from ML client factory
    const healthResult = await context.mlClientFactory.checkAllServices();

    // Get circuit states
    const circuitStates = context.pipelineOrchestrator.getCircuitStates();

    // Map services
    const services = healthResult.services.map((s: any) => ({
      service: s.service,
      status: s.status,
      latencyMs: s.latency || 0,
      circuitState: circuitStates[s.service] || 'CLOSED',
      lastError: s.lastError,
      lastSuccess: s.lastSuccess?.toISOString(),
    }));

    return {
      overall: healthResult.overall,
      services,
      degradedServices: healthResult.degradedServices,
      checkDurationMs: Date.now() - startTime,
    };
  } catch (error) {
    console.error('Failed to check pipeline health:', error);

    // Return degraded health on error
    return {
      overall: 'UNHEALTHY',
      services: [],
      degradedServices: ['health-check'],
      checkDurationMs: Date.now() - startTime,
    };
  }
}

/**
 * Get pending recommendations for a visit
 */
export async function pendingRecommendationsForVisit(
  _parent: unknown,
  args: { visitId: string },
  context: ResolverContext
): Promise<any[]> {
  const { visitId } = args;

  // Validate authentication
  if (!context.userId) {
    throw new GraphQLError('Authentication required', {
      extensions: { code: 'UNAUTHENTICATED' },
    });
  }

  // Validate visitId format
  if (!visitId || !/^[a-f0-9-]{36}$/.test(visitId)) {
    throw new GraphQLError('Invalid visitId format', {
      extensions: { code: 'BAD_USER_INPUT' },
    });
  }

  try {
    // Get latest pipeline request for this visit
    const requests = await context.pipelineRequestRepository.getByVisitId(visitId);

    if (!requests || requests.length === 0) {
      return [];
    }

    // Find completed request with recommendations
    const completedRequest = requests.find(
      (r: any) => r.status === 'COMPLETED' && r.result?.recommendations
    );

    if (!completedRequest) {
      return [];
    }

    // TODO: Verify user has access to this visit

    return completedRequest.result.recommendations || [];
  } catch (error) {
    console.error('Failed to fetch pending recommendations:', error);
    throw new GraphQLError('Failed to fetch pending recommendations', {
      extensions: { code: 'INTERNAL_SERVER_ERROR' },
    });
  }
}
