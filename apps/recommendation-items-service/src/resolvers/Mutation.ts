import { Resolvers, MutationCreateRecommendationItemArgs, MutationUpdateRecommendationItemArgs, MutationDeleteRecommendationItemArgs } from "../__generated__/resolvers-types";
import { recommendationItemService } from "../services/database";
import { GraphQLError } from "graphql";

export const Mutation: Resolvers = {
  Mutation: {
    async createRecommendationItem(
      _parent,
      { input }: MutationCreateRecommendationItemArgs,
      _context
    ) {
      if (!input.title || input.title.trim() === "") {
        throw new GraphQLError("Item title is required.");
      }
      if (!input.description || input.description.trim() === "") {
        throw new GraphQLError("Item description is required.");
      }
      if (!input.type) {
        throw new GraphQLError("Item type is required.");
      }
      if (!input.category || input.category.trim() === "") {
        throw new GraphQLError("Item category is required.");
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
        throw new GraphQLError("Recommendation item not found.");
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
        throw new GraphQLError("Recommendation item not found.");
      }

      return true;
    },
  },
};
