import { Resolvers } from "../__generated__/resolvers-types";
import { recommendationsSource } from "../datasources/recommendationsSource";

export const Query: Resolvers = {
  Query: {
    recommendation(_parent, { id }, _context) {
      const recommendation = recommendationsSource.find((r) => String(r.id) === String(id));
      return recommendation ? { ...recommendation } : null;
    },
    recommendationsForCase(_parent, { caseId }, _context) {
      return recommendationsSource
        .filter((r) => r.caseId === caseId)
        .map((r) => ({ ...r }));
    },
    recommendationsByProvider(_parent, { providerId }, _context) {
      return recommendationsSource
        .filter((r) => r.providerId === providerId)
        .map((r) => ({ ...r }));
    },
  },
  Recommendation: {
    __resolveReference(reference) {
      const recommendation = recommendationsSource.find((r) => r.id === reference.id);
      return recommendation ? { ...recommendation } : null;
    },
  },
  Case: {
    recommendations(parent) {
      return recommendationsSource
        .filter((r) => r.caseId === parent.id)
        .map((r) => ({ ...r }));
    },
  },
  Provider: {
    recommendations(parent) {
      return recommendationsSource
        .filter((r) => r.providerId === parent.id)
        .map((r) => ({ ...r }));
    },
  },
};
