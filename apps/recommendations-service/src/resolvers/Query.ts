import { Resolvers } from "@recommendations/__generated__/resolvers-types";
import { recommendationService } from "@recommendations/services/database";

export const Query: Resolvers = {
  Query: {
    async recommendation(_parent, { id }, _context) {
      return await recommendationService.getRecommendationById(id);
    },
    async recommendationsForPatient(_parent, { patientId }, _context) {
      return await recommendationService.getRecommendationsForPatient(patientId);
    },
    async recommendationsByProvider(_parent, { providerId }, _context) {
      return await recommendationService.getRecommendationsByProvider(providerId);
    },
  },
  Recommendation: {
    async __resolveReference(reference) {
      return await recommendationService.getRecommendationById(reference.id);
    },
  },
  Patient: {
    async recommendations(parent) {
      return await recommendationService.getRecommendationsForPatient(parent.id);
    },
  },
  Provider: {
    async recommendations(parent) {
      return await recommendationService.getRecommendationsByProvider(parent.id);
    },
  },
};
