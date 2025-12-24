"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Query = void 0;
const database_1 = require("@rag/services/database");
function createCursor(item) {
    return Buffer.from(`${item.createdAt.toISOString()}|${item.id}`).toString('base64');
}
exports.Query = {
    Query: {
        async guideline(_parent, { id }, _context) {
            return await database_1.guidelineService.getGuidelineById(id);
        },
        async guidelines(_parent, { filter, pagination }, _context) {
            const result = await database_1.guidelineService.getGuidelines({
                source: filter?.source || undefined,
                category: filter?.category || undefined,
                evidenceGrade: filter?.evidenceGrade || undefined,
                conditionCode: filter?.conditionCode || undefined,
                medicationCode: filter?.medicationCode || undefined,
            }, {
                first: pagination?.first || undefined,
                after: pagination?.after || undefined,
            });
            const edges = result.guidelines.map(g => ({
                node: { ...g, citations: [] },
                cursor: createCursor(g),
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
        async guidelinesForPatient(_parent, { patientId, category, pagination }, _context) {
            const result = await database_1.guidelineService.getGuidelinesForPatient(patientId, {
                category: category || undefined,
                first: pagination?.first || undefined,
                after: pagination?.after || undefined,
            });
            const edges = result.guidelines.map(g => ({
                node: { ...g, citations: [] },
                cursor: createCursor(g),
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
        async ragSynthesis(_parent, { id }, _context) {
            const synthesis = await database_1.ragSynthesisService.getSynthesisById(id);
            if (!synthesis)
                return null;
            return {
                ...synthesis,
                patient: { __typename: 'Patient', id: synthesis.patientId },
                relevantGuidelines: [],
                synthesizedRecommendations: [],
            };
        },
        async ragSynthesesForPatient(_parent, { patientId, pagination }, _context) {
            const syntheses = await database_1.ragSynthesisService.getSynthesesForPatient(patientId, { first: pagination?.first || undefined, after: pagination?.after || undefined });
            return syntheses.map(s => ({
                ...s,
                patient: { __typename: 'Patient', id: s.patientId },
                relevantGuidelines: [],
                synthesizedRecommendations: [],
            }));
        },
    },
    Guideline: {
        async __resolveReference(reference) {
            return await database_1.guidelineService.getGuidelineById(reference.id);
        },
        citations: () => [],
    },
    RAGSynthesis: {
        async __resolveReference(reference) {
            const synthesis = await database_1.ragSynthesisService.getSynthesisById(reference.id);
            if (!synthesis)
                return null;
            return {
                ...synthesis,
                patient: { __typename: 'Patient', id: synthesis.patientId },
                relevantGuidelines: [],
                synthesizedRecommendations: [],
            };
        },
    },
    Patient: {
        async applicableGuidelines(parent, { category, pagination }) {
            const result = await database_1.guidelineService.getGuidelinesForPatient(parent.id, {
                category: category || undefined,
                first: pagination?.first || undefined,
                after: pagination?.after || undefined,
            });
            const edges = result.guidelines.map(g => ({
                node: { ...g, citations: [] },
                cursor: createCursor(g),
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
        async ragSyntheses(parent, { pagination }) {
            const syntheses = await database_1.ragSynthesisService.getSynthesesForPatient(parent.id, { first: pagination?.first || undefined, after: pagination?.after || undefined });
            return syntheses.map(s => ({
                ...s,
                patient: { __typename: 'Patient', id: s.patientId },
                relevantGuidelines: [],
                synthesizedRecommendations: [],
            }));
        },
    },
};
//# sourceMappingURL=Query.js.map