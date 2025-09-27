import { Resolvers } from "@recommendation-items/__generated__/resolvers-types";
import { recommendationItemService } from "@recommendation-items/services/database";

export const Query: Resolvers = {
  Query: {
    async recommendationItem(_parent, { id }, _context) {
      return await recommendationItemService.getRecommendationItem(id);
    },
    async recommendationItems(_parent, _args, _context) {
      return await recommendationItemService.getAllRecommendationItems();
    },
    async itemsByType(_parent, { type }, _context) {
      return await recommendationItemService.getRecommendationItemsByType(type);
    },
    async itemsByCategory(_parent, { category }, _context) {
      return await recommendationItemService.getRecommendationItemsByCategory(category);
    },
    async itemsByEvidenceLevel(_parent, { evidenceLevel }, _context) {
      return await recommendationItemService.getRecommendationItemsByEvidenceLevel(evidenceLevel);
    },
    async searchRecommendationItems(_parent, { searchTerm }, _context) {
      return await recommendationItemService.searchRecommendationItems(searchTerm);
    },
  },
  RecommendationItem: {
    async __resolveReference(reference) {
      return await recommendationItemService.getRecommendationItem(reference.id);
    },
  },
  Recommendation: {
    items(parent) {
      // This will be used by federation to resolve items for recommendations
      // For now, return empty array as this service is agnostic of recommendations
      return [];
    },
  },
};
