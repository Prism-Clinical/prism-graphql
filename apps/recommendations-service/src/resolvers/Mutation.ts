import { Resolvers, MutationCreateRecommendationArgs, MutationUpdateRecommendationStatusArgs, RecommendationStatus } from "@recommendations/__generated__/resolvers-types";
import { recommendationsSource } from "@recommendations/datasources/recommendationsSource";
import { ApolloError } from "apollo-server-errors";

export const Mutation: Resolvers = {
  Mutation: {
    createRecommendation(
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
      if (!input.caseId) {
        throw new ApolloError("Case ID is required.", "BAD_USER_INPUT");
      }
      if (!input.providerId) {
        throw new ApolloError("Provider ID is required.", "BAD_USER_INPUT");
      }
      
      const newId =
        recommendationsSource.length > 0
          ? String(Math.max(...recommendationsSource.map((r) => Number(r.id))) + 1)
          : "1";
          
      const now = new Date().toISOString();
      const newRecommendation = {
        id: newId,
        caseId: input.caseId,
        providerId: input.providerId,
        title: input.title,
        description: input.description,
        priority: input.priority,
        status: RecommendationStatus.Draft,
        createdAt: now,
        updatedAt: now,
      };
      
      recommendationsSource.push({ ...newRecommendation });
      return { ...newRecommendation };
    },
    
    updateRecommendationStatus(
      _parent,
      { id, status }: MutationUpdateRecommendationStatusArgs,
      _context
    ) {
      const recommendation = recommendationsSource.find((r) => r.id === id);
      if (!recommendation) {
        throw new ApolloError("Recommendation not found.", "NOT_FOUND");
      }
      
      recommendation.status = status;
      recommendation.updatedAt = new Date().toISOString();
      
      return { ...recommendation };
    },
  },
};
