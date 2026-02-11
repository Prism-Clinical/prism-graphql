/**
 * Visit Reference Resolver
 *
 * Resolves Visit fields for federation.
 */

import { GraphQLError } from 'graphql';

/**
 * Context for resolvers
 */
export interface ResolverContext {
  userId: string;
  userRole: string;
  pipelineRequestRepository: {
    getByVisitId: (visitId: string) => Promise<any[]>;
    getActiveByVisitId: (visitId: string) => Promise<any>;
  };
  extractionCache: {
    getByVisitId: (visitId: string) => Promise<any>;
  };
  auditLogger: {
    logAccess: (entry: any) => Promise<void>;
  };
}

/**
 * Visit type resolver
 */
export const VisitResolver = {
  /**
   * Reference resolver for Visit entity
   */
  __resolveReference: async (
    reference: { id: string },
    _context: ResolverContext
  ) => {
    // Just return the reference - other fields are external
    return { id: reference.id };
  },

  /**
   * Resolve pending care plan recommendations for visit
   */
  pendingCarePlanRecommendations: async (
    parent: { id: string },
    _args: unknown,
    context: ResolverContext
  ): Promise<any[]> => {
    if (!context.userId) {
      throw new GraphQLError('Authentication required', {
        extensions: { code: 'UNAUTHENTICATED' },
      });
    }

    try {
      // Get completed pipeline requests for this visit
      const requests = await context.pipelineRequestRepository.getByVisitId(parent.id);

      if (!requests || requests.length === 0) {
        return [];
      }

      // Find most recent completed request with recommendations
      const completedRequest = requests
        .filter((r: any) => r.status === 'COMPLETED' && r.result?.recommendations)
        .sort((a: any, b: any) =>
          new Date(b.completedAt).getTime() - new Date(a.completedAt).getTime()
        )[0];

      if (!completedRequest) {
        return [];
      }

      return completedRequest.result.recommendations.map((r: any) => ({
        templateId: r.templateId,
        title: r.title,
        confidence: r.confidence,
        matchedConditions: r.matchedConditions,
        reasoning: r.reasoning,
        guidelineSource: r.guidelineSource,
        evidenceGrade: r.evidenceGrade,
      }));
    } catch (error) {
      console.error('Failed to fetch pending recommendations:', error);
      return [];
    }
  },

  /**
   * Resolve last extraction from visit's transcript
   */
  lastExtraction: async (
    parent: { id: string },
    _args: unknown,
    context: ResolverContext
  ): Promise<any | null> => {
    if (!context.userId) {
      throw new GraphQLError('Authentication required', {
        extensions: { code: 'UNAUTHENTICATED' },
      });
    }

    try {
      // Get cached extraction for this visit
      const extraction = await context.extractionCache.getByVisitId(parent.id);

      if (!extraction) {
        // Check pipeline requests for extraction
        const requests = await context.pipelineRequestRepository.getByVisitId(parent.id);

        const completedRequest = requests
          ?.filter((r: any) => r.status === 'COMPLETED' && r.result?.extractedEntities)
          .sort((a: any, b: any) =>
            new Date(b.completedAt).getTime() - new Date(a.completedAt).getTime()
          )[0];

        if (!completedRequest) {
          return null;
        }

        // Log PHI access
        await context.auditLogger.logAccess({
          eventType: 'PHI_ACCESS',
          userId: context.userId,
          userRole: context.userRole,
          resourceType: 'extracted_entities',
          resourceId: parent.id,
          action: 'READ',
          phiFields: ['symptoms', 'medications', 'diagnoses'],
          outcome: 'SUCCESS',
        });

        return completedRequest.result.extractedEntities;
      }

      // Log PHI access
      await context.auditLogger.logAccess({
        eventType: 'PHI_ACCESS',
        userId: context.userId,
        userRole: context.userRole,
        resourceType: 'extracted_entities',
        resourceId: parent.id,
        action: 'READ',
        phiFields: ['symptoms', 'medications', 'diagnoses'],
        outcome: 'SUCCESS',
      });

      return extraction;
    } catch (error) {
      console.error('Failed to fetch last extraction:', error);
      return null;
    }
  },

  /**
   * Check if visit has an active generation request
   */
  hasActiveGenerationRequest: async (
    parent: { id: string },
    _args: unknown,
    context: ResolverContext
  ): Promise<boolean> => {
    if (!context.userId) {
      return false;
    }

    try {
      const activeRequest = await context.pipelineRequestRepository.getActiveByVisitId(
        parent.id
      );

      return !!activeRequest;
    } catch (error) {
      console.error('Failed to check active generation request:', error);
      return false;
    }
  },
};
