"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Query = void 0;
const database_1 = require("@transcription/services/database");
function createCursor(transcription) {
    return Buffer.from(`${transcription.createdAt.toISOString()}|${transcription.id}`).toString('base64');
}
exports.Query = {
    Query: {
        async transcription(_parent, { id }, _context) {
            const result = await database_1.transcriptionService.getTranscriptionById(id);
            if (!result)
                return null;
            return {
                ...result,
                patient: { __typename: 'Patient', id: result.patientId },
            };
        },
        async transcriptions(_parent, { filter, pagination }, _context) {
            const result = await database_1.transcriptionService.getTranscriptions({
                patientId: filter?.patientId || undefined,
                encounterId: filter?.encounterId || undefined,
                status: filter?.status || undefined,
                createdAfter: filter?.createdAfter ? new Date(filter.createdAfter) : undefined,
                createdBefore: filter?.createdBefore ? new Date(filter.createdBefore) : undefined,
            }, {
                first: pagination?.first || undefined,
                after: pagination?.after || undefined,
            });
            const edges = result.transcriptions.map(t => ({
                node: {
                    ...t,
                    patient: { __typename: 'Patient', id: t.patientId },
                },
                cursor: createCursor(t),
            }));
            return {
                edges,
                pageInfo: {
                    hasNextPage: result.hasNextPage,
                    hasPreviousPage: false,
                    startCursor: edges.length > 0 ? edges[0].cursor : null,
                    endCursor: edges.length > 0 ? edges[edges.length - 1].cursor : null,
                },
                totalCount: result.totalCount,
            };
        },
        async transcriptionsForPatient(_parent, { patientId, status, pagination }, _context) {
            const result = await database_1.transcriptionService.getTranscriptionsForPatient(patientId, {
                status: status || undefined,
                first: pagination?.first || undefined,
                after: pagination?.after || undefined,
            });
            const edges = result.transcriptions.map(t => ({
                node: {
                    ...t,
                    patient: { __typename: 'Patient', id: t.patientId },
                },
                cursor: createCursor(t),
            }));
            return {
                edges,
                pageInfo: {
                    hasNextPage: result.hasNextPage,
                    hasPreviousPage: false,
                    startCursor: edges.length > 0 ? edges[0].cursor : null,
                    endCursor: edges.length > 0 ? edges[edges.length - 1].cursor : null,
                },
                totalCount: result.totalCount,
            };
        },
        async transcriptionsForEncounter(_parent, { encounterId }, _context) {
            const transcriptions = await database_1.transcriptionService.getTranscriptionsForEncounter(encounterId);
            return transcriptions.map(t => ({
                ...t,
                patient: { __typename: 'Patient', id: t.patientId },
            }));
        },
    },
    Transcription: {
        async __resolveReference(reference) {
            const result = await database_1.transcriptionService.getTranscriptionById(reference.id);
            if (!result)
                return null;
            return {
                ...result,
                patient: { __typename: 'Patient', id: result.patientId },
            };
        },
    },
    Patient: {
        async transcriptions(parent, { status, pagination }) {
            const result = await database_1.transcriptionService.getTranscriptionsForPatient(parent.id, {
                status: status || undefined,
                first: pagination?.first || undefined,
                after: pagination?.after || undefined,
            });
            const edges = result.transcriptions.map(t => ({
                node: {
                    ...t,
                    patient: { __typename: 'Patient', id: t.patientId },
                },
                cursor: createCursor(t),
            }));
            return {
                edges,
                pageInfo: {
                    hasNextPage: result.hasNextPage,
                    hasPreviousPage: false,
                    startCursor: edges.length > 0 ? edges[0].cursor : null,
                    endCursor: edges.length > 0 ? edges[edges.length - 1].cursor : null,
                },
                totalCount: result.totalCount,
            };
        },
    },
};
//# sourceMappingURL=Query.js.map