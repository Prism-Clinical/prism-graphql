import { Resolvers } from "../__generated__/resolvers-types";
import { recommendationService } from "../services/database";

export const Query: Resolvers = {
  Query: {
    async recommendation(_parent, { id }, _context) {
      return await recommendationService.getRecommendationById(id) as any;
    },
    async recommendationsForPatient(_parent, { patientId }, _context) {
      return await recommendationService.getRecommendationsForPatient(patientId) as any;
    },
    async recommendationsByProvider(_parent, { providerId }, _context) {
      return await recommendationService.getRecommendationsByProvider(providerId) as any;
    },
  },
  Recommendation: {
    async __resolveReference(reference) {
      return await recommendationService.getRecommendationById(reference.id) as any;
    },
  },
  Patient: {
    async recommendations(parent) {
      return await recommendationService.getRecommendationsForPatient(parent.id) as any;
    },
  },
  Provider: {
    async recommendations(parent) {
      return await recommendationService.getRecommendationsByProvider(parent.id) as any;
    },
  },
};
