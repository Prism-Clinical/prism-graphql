"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Query = void 0;
const database_1 = require("@recommendation-items/services/database");
exports.Query = {
    Query: {
        async recommendationItem(_parent, { id }, _context) {
            return await database_1.recommendationItemService.getRecommendationItem(id);
        },
        async recommendationItems(_parent, _args, _context) {
            return await database_1.recommendationItemService.getAllRecommendationItems();
        },
        async itemsByType(_parent, { type }, _context) {
            return await database_1.recommendationItemService.getRecommendationItemsByType(type);
        },
        async itemsByCategory(_parent, { category }, _context) {
            return await database_1.recommendationItemService.getRecommendationItemsByCategory(category);
        },
        async itemsByEvidenceLevel(_parent, { evidenceLevel }, _context) {
            return await database_1.recommendationItemService.getRecommendationItemsByEvidenceLevel(evidenceLevel);
        },
        async searchRecommendationItems(_parent, { searchTerm }, _context) {
            return await database_1.recommendationItemService.searchRecommendationItems(searchTerm);
        },
    },
    RecommendationItem: {
        async __resolveReference(reference) {
            return await database_1.recommendationItemService.getRecommendationItem(reference.id);
        },
    },
    Recommendation: {
        items(parent) {
            return [];
        },
    },
};
//# sourceMappingURL=Query.js.map