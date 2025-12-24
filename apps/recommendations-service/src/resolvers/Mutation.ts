import { Resolvers, MutationCreateRecommendationArgs, MutationUpdateRecommendationStatusArgs } from "../__generated__/resolvers-types";
import { recommendationService, Priority } from "../services/database";
import { GraphQLError } from "graphql";

export const Mutation: Resolvers = {
  Mutation: {
    async createRecommendation(
      _parent,
      { input }: MutationCreateRecommendationArgs,
      _context
    ) {
      if (!input.title || input.title.trim() === "") {
        throw new GraphQLError("Recommendation title is required.");
      }
      if (!input.description || input.description.trim() === "") {
        throw new GraphQLError("Recommendation description is required.");
      }
      if (!input.patientId) {
        throw new GraphQLError("Patient ID is required.");
      }
      if (!input.providerId) {
        throw new GraphQLError("Provider ID is required.");
      }

      try {
        return await recommendationService.createRecommendation({
          patientId: input.patientId,
          providerId: input.providerId,
          title: input.title,
          description: input.description,
          priority: input.priority as unknown as Priority
        }) as any;
      } catch (error: any) {
        if (error.message.includes('Foreign key constraint')) {
          throw new GraphQLError("Invalid patient or provider reference.");
        }
        throw new GraphQLError("Failed to create recommendation.");
      }
    },

    async updateRecommendationStatus(
      _parent,
      { id, status }: MutationUpdateRecommendationStatusArgs,
      _context
    ) {
      try {
        const recommendation = await recommendationService.updateRecommendationStatus(id, status as any);
        if (!recommendation) {
          throw new GraphQLError("Recommendation not found.");
        }
        return recommendation as any;
      } catch (error: any) {
        if (error.message.includes('not found')) {
          throw new GraphQLError("Recommendation not found.");
        }
        throw new GraphQLError("Failed to update recommendation status.");
      }
    },
  },
};
