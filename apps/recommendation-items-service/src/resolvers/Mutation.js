"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Mutation = void 0;
const database_1 = require("@recommendation-items/services/database");
const apollo_server_errors_1 = require("apollo-server-errors");
exports.Mutation = {
    Mutation: {
        async createRecommendationItem(_parent, { input }, _context) {
            if (!input.title || input.title.trim() === "") {
                throw new apollo_server_errors_1.ApolloError("Item title is required.", "BAD_USER_INPUT");
            }
            if (!input.description || input.description.trim() === "") {
                throw new apollo_server_errors_1.ApolloError("Item description is required.", "BAD_USER_INPUT");
            }
            if (!input.type) {
                throw new apollo_server_errors_1.ApolloError("Item type is required.", "BAD_USER_INPUT");
            }
            if (!input.category || input.category.trim() === "") {
                throw new apollo_server_errors_1.ApolloError("Item category is required.", "BAD_USER_INPUT");
            }
            return await database_1.recommendationItemService.createRecommendationItem(input);
        },
        async updateRecommendationItem(_parent, { id, input }, _context) {
            const updatedItem = await database_1.recommendationItemService.updateRecommendationItem(id, input);
            if (!updatedItem) {
                throw new apollo_server_errors_1.ApolloError("Recommendation item not found.", "NOT_FOUND");
            }
            return updatedItem;
        },
        async deleteRecommendationItem(_parent, { id }, _context) {
            const success = await database_1.recommendationItemService.deleteRecommendationItem(id);
            if (!success) {
                throw new apollo_server_errors_1.ApolloError("Recommendation item not found.", "NOT_FOUND");
            }
            return true;
        },
    },
};
//# sourceMappingURL=Mutation.js.map