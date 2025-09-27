import { Resolvers, MutationCreateRecommendationArgs, MutationUpdateRecommendationStatusArgs } from "@recommendations/__generated__/resolvers-types";
import { recommendationService } from "@recommendations/services/database";
import { ApolloError } from "apollo-server-errors";

export const Mutation: Resolvers = {
  Mutation: {
    async createRecommendation(
      _parent,
      { input }: MutationCreateRecommendationArgs,
      _context
    ) {
      if (!input.title || input.title.trim() === "") {
        throw new ApolloError("Recommendation title is required.", "BAD_USER_INPUT");
      }
      if (!input.description || input.description.trim() === "") {
        throw new ApolloError("Recommendation description is required.", "BAD_USER_INPUT");
      }
      if (!input.patientId) {
        throw new ApolloError("Patient ID is required.", "BAD_USER_INPUT");
      }
      if (!input.providerId) {
        throw new ApolloError("Provider ID is required.", "BAD_USER_INPUT");
      }
      
      try {
        return await recommendationService.createRecommendation({
          patientId: input.patientId,
          providerId: input.providerId,
          title: input.title,
          description: input.description,
          priority: input.priority
        });
      } catch (error: any) {
        if (error.message.includes('Foreign key constraint')) {
          throw new ApolloError("Invalid patient or provider reference.", "BAD_USER_INPUT");
        }
        throw new ApolloError("Failed to create recommendation.", "INTERNAL_ERROR");
      }
    },
    
    async updateRecommendationStatus(
      _parent,
      { id, status }: MutationUpdateRecommendationStatusArgs,
      _context
    ) {
      try {
        const recommendation = await recommendationService.updateRecommendationStatus(id, status);
        if (!recommendation) {
          throw new ApolloError("Recommendation not found.", "NOT_FOUND");
        }
        return recommendation;
      } catch (error: any) {
        if (error.message.includes('not found')) {
          throw new ApolloError("Recommendation not found.", "NOT_FOUND");
        }
        throw new ApolloError("Failed to update recommendation status.", "INTERNAL_ERROR");
      }
    },
  },
};
