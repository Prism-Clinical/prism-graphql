"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Mutation = void 0;
const database_1 = require("@rag/services/database");
const apollo_server_errors_1 = require("apollo-server-errors");
exports.Mutation = {
    Mutation: {
        async requestRAGSynthesis(_parent, { input }, _context) {
            if (!input.patientId) {
                throw new apollo_server_errors_1.ApolloError("Patient ID is required.", "BAD_USER_INPUT");
            }
            if (!input.queryType) {
                throw new apollo_server_errors_1.ApolloError("Query type is required.", "BAD_USER_INPUT");
            }
            try {
                const synthesis = await database_1.ragSynthesisService.requestSynthesis({
                    patientId: input.patientId,
                    queryType: input.queryType,
                    conditionCodes: input.conditionCodes || undefined,
                    medicationCodes: input.medicationCodes || undefined,
                    createdBy: 'system',
                });
                return {
                    ...synthesis,
                    patient: { __typename: 'Patient', id: synthesis.patientId },
                    relevantGuidelines: [],
                    synthesizedRecommendations: [],
                };
            }
            catch (error) {
                throw new apollo_server_errors_1.ApolloError("Failed to request RAG synthesis.", "INTERNAL_ERROR");
            }
        },
        async refreshGuidelineCache(_parent, { source }, _context) {
            console.log(`Refreshing guideline cache for source: ${source}`);
            return true;
        },
    },
};
//# sourceMappingURL=Mutation.js.map