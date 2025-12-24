"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Mutation = void 0;
const database_1 = require("@transcription/services/database");
const apollo_server_errors_1 = require("apollo-server-errors");
exports.Mutation = {
    Mutation: {
        async submitTranscription(_parent, { input }, _context) {
            if (!input.patientId) {
                throw new apollo_server_errors_1.ApolloError("Patient ID is required.", "BAD_USER_INPUT");
            }
            if (!input.audioUri) {
                throw new apollo_server_errors_1.ApolloError("Audio URI is required.", "BAD_USER_INPUT");
            }
            try {
                new URL(input.audioUri);
            }
            catch {
                if (!input.audioUri.startsWith('gs://') && !input.audioUri.startsWith('s3://')) {
                    throw new apollo_server_errors_1.ApolloError("Audio URI must be a valid URL or cloud storage URI.", "BAD_USER_INPUT");
                }
            }
            try {
                const transcription = await database_1.transcriptionService.submitTranscription({
                    patientId: input.patientId,
                    encounterId: input.encounterId || undefined,
                    audioUri: input.audioUri,
                    speakerCount: input.speakerCount || undefined,
                    vocabularyHints: input.vocabularyHints || undefined,
                    createdBy: 'system',
                });
                return {
                    ...transcription,
                    patient: { __typename: 'Patient', id: transcription.patientId },
                    entities: [],
                };
            }
            catch (error) {
                if (error.message.includes('Foreign key constraint')) {
                    throw new apollo_server_errors_1.ApolloError("Invalid patient reference.", "BAD_USER_INPUT");
                }
                throw new apollo_server_errors_1.ApolloError("Failed to submit transcription.", "INTERNAL_ERROR");
            }
        },
        async cancelTranscription(_parent, { id }, _context) {
            if (!id) {
                throw new apollo_server_errors_1.ApolloError("Transcription ID is required.", "BAD_USER_INPUT");
            }
            try {
                const transcription = await database_1.transcriptionService.cancelTranscription(id);
                if (!transcription) {
                    throw new apollo_server_errors_1.ApolloError("Transcription not found or cannot be cancelled (only PENDING or PROCESSING transcriptions can be cancelled).", "NOT_FOUND");
                }
                return {
                    ...transcription,
                    patient: { __typename: 'Patient', id: transcription.patientId },
                    entities: [],
                };
            }
            catch (error) {
                if (error.extensions?.code === 'NOT_FOUND') {
                    throw error;
                }
                throw new apollo_server_errors_1.ApolloError("Failed to cancel transcription.", "INTERNAL_ERROR");
            }
        },
        async retryTranscription(_parent, { id }, _context) {
            if (!id) {
                throw new apollo_server_errors_1.ApolloError("Transcription ID is required.", "BAD_USER_INPUT");
            }
            try {
                const transcription = await database_1.transcriptionService.retryTranscription(id);
                if (!transcription) {
                    throw new apollo_server_errors_1.ApolloError("Transcription not found or cannot be retried (only FAILED transcriptions can be retried).", "NOT_FOUND");
                }
                return {
                    ...transcription,
                    patient: { __typename: 'Patient', id: transcription.patientId },
                    entities: [],
                };
            }
            catch (error) {
                if (error.extensions?.code === 'NOT_FOUND') {
                    throw error;
                }
                throw new apollo_server_errors_1.ApolloError("Failed to retry transcription.", "INTERNAL_ERROR");
            }
        },
    },
};
//# sourceMappingURL=Mutation.js.map