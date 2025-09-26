import { Resolvers } from "../__generated__/resolvers-types";
import { recommendationItemsSource } from "../datasources/recommendationItemsSource";

export const Query: Resolvers = {
  Query: {
    recommendationItem(_parent, { id }, _context) {
      const item = recommendationItemsSource.find((i) => String(i.id) === String(id));
      return item ? { ...item } : null;
    },
    recommendationItems(_parent, _args, _context) {
      return recommendationItemsSource
        .filter((i) => i.isActive)
        .map((i) => ({ ...i }));
    },
    itemsByType(_parent, { type }, _context) {
      return recommendationItemsSource
        .filter((i) => i.type === type && i.isActive)
        .map((i) => ({ ...i }));
    },
    itemsByCategory(_parent, { category }, _context) {
      return recommendationItemsSource
        .filter((i) => i.category.toLowerCase().includes(category.toLowerCase()) && i.isActive)
        .map((i) => ({ ...i }));
    },
    itemsByEvidenceLevel(_parent, { evidenceLevel }, _context) {
      return recommendationItemsSource
        .filter((i) => i.evidenceLevel === evidenceLevel && i.isActive)
        .map((i) => ({ ...i }));
    },
    searchRecommendationItems(_parent, { searchTerm }, _context) {
      const term = searchTerm.toLowerCase();
      return recommendationItemsSource
        .filter((i) => 
          i.isActive && (
            i.title.toLowerCase().includes(term) ||
            i.description.toLowerCase().includes(term) ||
            i.category.toLowerCase().includes(term)
          )
        )
        .map((i) => ({ ...i }));
    },
  },
  RecommendationItem: {
    __resolveReference(reference) {
      const item = recommendationItemsSource.find((i) => i.id === reference.id);
      return item ? { ...item } : null;
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
