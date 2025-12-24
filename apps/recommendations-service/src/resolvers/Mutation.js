"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Mutation = void 0;
const database_1 = require("@recommendations/services/database");
const apollo_server_errors_1 = require("apollo-server-errors");
exports.Mutation = {
    Mutation: {
        async createRecommendation(_parent, { input }, _context) {
            if (!input.title || input.title.trim() === "") {
                throw new apollo_server_errors_1.ApolloError("Recommendation title is required.", "BAD_USER_INPUT");
            }
            if (!input.description || input.description.trim() === "") {
                throw new apollo_server_errors_1.ApolloError("Recommendation description is required.", "BAD_USER_INPUT");
            }
            if (!input.patientId) {
                throw new apollo_server_errors_1.ApolloError("Patient ID is required.", "BAD_USER_INPUT");
            }
            if (!input.providerId) {
                throw new apollo_server_errors_1.ApolloError("Provider ID is required.", "BAD_USER_INPUT");
            }
            try {
                return await database_1.recommendationService.createRecommendation({
                    patientId: input.patientId,
                    providerId: input.providerId,
                    title: input.title,
                    description: input.description,
                    priority: input.priority
                });
            }
            catch (error) {
                if (error.message.includes('Foreign key constraint')) {
                    throw new apollo_server_errors_1.ApolloError("Invalid patient or provider reference.", "BAD_USER_INPUT");
                }
                throw new apollo_server_errors_1.ApolloError("Failed to create recommendation.", "INTERNAL_ERROR");
            }
        },
        async updateRecommendationStatus(_parent, { id, status }, _context) {
            try {
                const recommendation = await database_1.recommendationService.updateRecommendationStatus(id, status);
                if (!recommendation) {
                    throw new apollo_server_errors_1.ApolloError("Recommendation not found.", "NOT_FOUND");
                }
                return recommendation;
            }
            catch (error) {
                if (error.message.includes('not found')) {
                    throw new apollo_server_errors_1.ApolloError("Recommendation not found.", "NOT_FOUND");
                }
                throw new apollo_server_errors_1.ApolloError("Failed to update recommendation status.", "INTERNAL_ERROR");
            }
        },
    },
};
//# sourceMappingURL=Mutation.js.map