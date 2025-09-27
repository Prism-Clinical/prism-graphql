import { Resolvers, MutationCreateRecommendationItemArgs, MutationUpdateRecommendationItemArgs, MutationDeleteRecommendationItemArgs } from "@recommendation-items/__generated__/resolvers-types";
import { recommendationItemService } from "@recommendation-items/services/database";
import { ApolloError } from "apollo-server-errors";

export const Mutation: Resolvers = {
  Mutation: {
    async createRecommendationItem(
      _parent,
      { input }: MutationCreateRecommendationItemArgs,
      _context
    ) {
      if (!input.title || input.title.trim() === "") {
        throw new ApolloError("Item title is required.", "BAD_USER_INPUT");
      }
      if (!input.description || input.description.trim() === "") {
        throw new ApolloError("Item description is required.", "BAD_USER_INPUT");
      }
      if (!input.type) {
        throw new ApolloError("Item type is required.", "BAD_USER_INPUT");
      }
      if (!input.category || input.category.trim() === "") {
        throw new ApolloError("Item category is required.", "BAD_USER_INPUT");
      }
      
      return await recommendationItemService.createRecommendationItem(input);
    },
    
    async updateRecommendationItem(
      _parent,
      { id, input }: MutationUpdateRecommendationItemArgs,
      _context
    ) {
      const updatedItem = await recommendationItemService.updateRecommendationItem(id, input);
      if (!updatedItem) {
        throw new ApolloError("Recommendation item not found.", "NOT_FOUND");
      }
      
      return updatedItem;
    },
    
    async deleteRecommendationItem(
      _parent,
      { id }: MutationDeleteRecommendationItemArgs,
      _context
    ) {
      const success = await recommendationItemService.deleteRecommendationItem(id);
      if (!success) {
        throw new ApolloError("Recommendation item not found.", "NOT_FOUND");
      }
      
      return true;
    },
  },
};
