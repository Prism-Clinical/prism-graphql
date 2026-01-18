import { Resolvers } from "../__generated__/resolvers-types";
import { guidelineService, ragSynthesisService, Guideline } from "../services/database";

function createCursor(item: { createdAt: Date; id: string }): string {
  return Buffer.from(`${item.createdAt.toISOString()}|${item.id}`).toString('base64');
}

export const Query: Resolvers = {
  Query: {
    async guideline(_parent, { id }, _context) {
      return await guidelineService.getGuidelineById(id) as any;
    },

    async guidelines(_parent, { filter, pagination }, _context) {
      const result = await guidelineService.getGuidelines(
        {
          source: filter?.source as any || undefined,
          category: filter?.category as any || undefined,
          evidenceGrade: filter?.evidenceGrade || undefined,
          conditionCode: filter?.conditionCode || undefined,
          medicationCode: filter?.medicationCode || undefined,
        },
        {
          first: pagination?.first || undefined,
          after: pagination?.after || undefined,
        }
      );

      const edges = result.guidelines.map(g => ({
        node: { ...g, citations: [] as any[] },
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
      } as any;
    },

    async guidelinesForPatient(_parent, { patientId, category, pagination }, _context) {
      const result = await guidelineService.getGuidelinesForPatient(
        patientId,
        {
          category: category as any || undefined,
          first: pagination?.first || undefined,
          after: pagination?.after || undefined,
        }
      );

      const edges = result.guidelines.map(g => ({
        node: { ...g, citations: [] as any[] },
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
      } as any;
    },

    async ragSynthesis(_parent, { id }, _context) {
      const synthesis = await ragSynthesisService.getSynthesisById(id);
      if (!synthesis) return null;

      return {
        ...synthesis,
        patient: { __typename: 'Patient' as const, id: synthesis.patientId },
        relevantGuidelines: [] as any[],
        synthesizedRecommendations: [] as any[],
      } as any;
    },

    async ragSynthesesForPatient(_parent, { patientId, pagination }, _context) {
      const syntheses = await ragSynthesisService.getSynthesesForPatient(
        patientId,
        { first: pagination?.first || undefined, after: pagination?.after || undefined }
      );

      return syntheses.map(s => ({
        ...s,
        patient: { __typename: 'Patient' as const, id: s.patientId },
        relevantGuidelines: [] as any[],
        synthesizedRecommendations: [] as any[],
      })) as any;
    },
  },

  Guideline: {
    async __resolveReference(reference) {
      return await guidelineService.getGuidelineById(reference.id) as any;
    },
    citations: () => [],
  },

  RAGSynthesis: {
    async __resolveReference(reference) {
      const synthesis = await ragSynthesisService.getSynthesisById(reference.id);
      if (!synthesis) return null;

      return {
        ...synthesis,
        patient: { __typename: 'Patient' as const, id: synthesis.patientId },
        relevantGuidelines: [] as any[],
        synthesizedRecommendations: [] as any[],
      } as any;
    },
  },

  Patient: {
    async applicableGuidelines(parent, { category, pagination }) {
      const result = await guidelineService.getGuidelinesForPatient(
        parent.id,
        {
          category: category as any || undefined,
          first: pagination?.first || undefined,
          after: pagination?.after || undefined,
        }
      );

      const edges = result.guidelines.map(g => ({
        node: { ...g, citations: [] as any[] },
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
      } as any;
    },

    async ragSyntheses(parent, { pagination }) {
      const syntheses = await ragSynthesisService.getSynthesesForPatient(
        parent.id,
        { first: pagination?.first || undefined, after: pagination?.after || undefined }
      );

      return syntheses.map(s => ({
        ...s,
        patient: { __typename: 'Patient' as const, id: s.patientId },
        relevantGuidelines: [] as any[],
        synthesizedRecommendations: [] as any[],
      })) as any;
    },
  },
};
