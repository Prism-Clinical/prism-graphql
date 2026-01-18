import { Resolvers, MutationRequestRagSynthesisArgs } from "../__generated__/resolvers-types";
import { ragSynthesisService } from "../services/database";
import { GraphQLError } from "graphql";

export const Mutation: Resolvers = {
  Mutation: {
    async requestRAGSynthesis(
      _parent,
      { input }: MutationRequestRagSynthesisArgs,
      _context
    ) {
      if (!input.patientId) {
        throw new GraphQLError("Patient ID is required.");
      }
      if (!input.queryType) {
        throw new GraphQLError("Query type is required.");
      }

      try {
        const synthesis = await ragSynthesisService.requestSynthesis({
          patientId: input.patientId,
          queryType: input.queryType as any,
          conditionCodes: input.conditionCodes || undefined,
          medicationCodes: input.medicationCodes || undefined,
          createdBy: 'system', // TODO: Get from auth context
        });

        return {
          ...synthesis,
          patient: { __typename: 'Patient' as const, id: synthesis.patientId },
          relevantGuidelines: [] as any[],
          synthesizedRecommendations: [] as any[],
        } as any;
      } catch (error: any) {
        throw new GraphQLError("Failed to request RAG synthesis.");
      }
    },

    async refreshGuidelineCache(
      _parent,
      { source },
      _context
    ) {
      // Stub implementation - would trigger guideline refresh from source
      console.log(`Refreshing guideline cache for source: ${source}`);
      return true;
    },
  },
};
