import { Resolvers } from "../__generated__/resolvers-types";
import { transcriptionService, TranscriptionWithResults } from "../services/database";

// Helper to create cursor from transcription
function createCursor(transcription: TranscriptionWithResults): string {
  return Buffer.from(`${transcription.createdAt.toISOString()}|${transcription.id}`).toString('base64');
}

export const Query: Resolvers = {
  Query: {
    async transcription(_parent, { id }, _context) {
      const result = await transcriptionService.getTranscriptionById(id);
      if (!result) return null;

      return {
        ...result,
        patient: { __typename: 'Patient' as const, id: result.patientId },
      } as any;
    },

    async transcriptions(_parent, { filter, pagination }, _context) {
      const result = await transcriptionService.getTranscriptions(
        {
          patientId: filter?.patientId || undefined,
          encounterId: filter?.encounterId || undefined,
          status: filter?.status as any || undefined,
          createdAfter: filter?.createdAfter ? new Date(filter.createdAfter) : undefined,
          createdBefore: filter?.createdBefore ? new Date(filter.createdBefore) : undefined,
        },
        {
          first: pagination?.first || undefined,
          after: pagination?.after || undefined,
        }
      );

      const edges = result.transcriptions.map(t => ({
        node: {
          ...t,
          patient: { __typename: 'Patient' as const, id: t.patientId },
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
      } as any;
    },

    async transcriptionsForPatient(_parent, { patientId, status, pagination }, _context) {
      const result = await transcriptionService.getTranscriptionsForPatient(
        patientId,
        {
          status: status as any || undefined,
          first: pagination?.first || undefined,
          after: pagination?.after || undefined,
        }
      );

      const edges = result.transcriptions.map(t => ({
        node: {
          ...t,
          patient: { __typename: 'Patient' as const, id: t.patientId },
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
      } as any;
    },

    async transcriptionsForEncounter(_parent, { encounterId }, _context) {
      const transcriptions = await transcriptionService.getTranscriptionsForEncounter(encounterId);
      return transcriptions.map(t => ({
        ...t,
        patient: { __typename: 'Patient' as const, id: t.patientId },
      })) as any;
    },
  },

  Transcription: {
    async __resolveReference(reference) {
      const result = await transcriptionService.getTranscriptionById(reference.id);
      if (!result) return null;

      return {
        ...result,
        patient: { __typename: 'Patient' as const, id: result.patientId },
      } as any;
    },
  },

  Patient: {
    async transcriptions(parent, { status, pagination }) {
      const result = await transcriptionService.getTranscriptionsForPatient(
        parent.id,
        {
          status: status as any || undefined,
          first: pagination?.first || undefined,
          after: pagination?.after || undefined,
        }
      );

      const edges = result.transcriptions.map(t => ({
        node: {
          ...t,
          patient: { __typename: 'Patient' as const, id: t.patientId },
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
      } as any;
    },
  },
};
