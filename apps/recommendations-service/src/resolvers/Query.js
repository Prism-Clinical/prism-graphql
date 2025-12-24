"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Query = void 0;
const database_1 = require("@recommendations/services/database");
exports.Query = {
    Query: {
        async recommendation(_parent, { id }, _context) {
            return await database_1.recommendationService.getRecommendationById(id);
        },
        async recommendationsForPatient(_parent, { patientId }, _context) {
            return await database_1.recommendationService.getRecommendationsForPatient(patientId);
        },
        async recommendationsByProvider(_parent, { providerId }, _context) {
            return await database_1.recommendationService.getRecommendationsByProvider(providerId);
        },
    },
    Recommendation: {
        async __resolveReference(reference) {
            return await database_1.recommendationService.getRecommendationById(reference.id);
        },
    },
    Patient: {
        async recommendations(parent) {
            return await database_1.recommendationService.getRecommendationsForPatient(parent.id);
        },
    },
    Provider: {
        async recommendations(parent) {
            return await database_1.recommendationService.getRecommendationsByProvider(parent.id);
        },
    },
};
//# sourceMappingURL=Query.js.map