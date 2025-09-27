import { Resolvers, MutationCreateRecommendationItemArgs, MutationUpdateRecommendationItemArgs, MutationDeleteRecommendationItemArgs } from "@recommendation-items/__generated__/resolvers-types";
import { recommendationItemsSource } from "@recommendation-items/datasources/recommendationItemsSource";
import { ApolloError } from "apollo-server-errors";

export const Mutation: Resolvers = {
  Mutation: {
    createRecommendationItem(
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
      
      const newId =
        recommendationItemsSource.length > 0
          ? `item-${Math.max(...recommendationItemsSource.map((i) => Number(i.id.split('-')[1]) || 0)) + 1}`
          : "item-1";
          
      const newItem = {
        id: newId,
        type: input.type,
        title: input.title,
        description: input.description,
        instructions: input.instructions || undefined,
        evidenceLevel: input.evidenceLevel,
        studyReferences: input.studyReferences || [],
        guidelines: input.guidelines || [],
        contraindications: input.contraindications || [],
        sideEffects: input.sideEffects || [],
        category: input.category,
        isActive: true,
      };
      
      recommendationItemsSource.push({ ...newItem });
      return { ...newItem };
    },
    
    updateRecommendationItem(
      _parent,
      { id, input }: MutationUpdateRecommendationItemArgs,
      _context
    ) {
      const item = recommendationItemsSource.find((i) => i.id === id);
      if (!item) {
        throw new ApolloError("Recommendation item not found.", "NOT_FOUND");
      }
      
      if (input.type !== undefined) item.type = input.type;
      if (input.title !== undefined) item.title = input.title;
      if (input.description !== undefined) item.description = input.description;
      if (input.instructions !== undefined) item.instructions = input.instructions;
      if (input.evidenceLevel !== undefined) item.evidenceLevel = input.evidenceLevel;
      if (input.studyReferences !== undefined) item.studyReferences = input.studyReferences;
      if (input.guidelines !== undefined) item.guidelines = input.guidelines;
      if (input.contraindications !== undefined) item.contraindications = input.contraindications;
      if (input.sideEffects !== undefined) item.sideEffects = input.sideEffects;
      if (input.category !== undefined) item.category = input.category;
      if (input.isActive !== undefined) item.isActive = input.isActive;
      
      return { ...item };
    },
    
    deleteRecommendationItem(
      _parent,
      { id }: MutationDeleteRecommendationItemArgs,
      _context
    ) {
      const index = recommendationItemsSource.findIndex((i) => i.id === id);
      if (index === -1) {
        throw new ApolloError("Recommendation item not found.", "NOT_FOUND");
      }
      
      recommendationItemsSource.splice(index, 1);
      return true;
    },
  },
};
