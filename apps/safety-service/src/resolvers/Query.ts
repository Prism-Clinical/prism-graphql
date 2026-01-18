import { Resolvers } from "../__generated__/resolvers-types";
import { safetyCheckService, reviewQueueService, SafetyCheck, ReviewQueueItem } from "../services/database";

function createCursor(item: { createdAt: Date; id: string }): string {
  return Buffer.from(`${item.createdAt.toISOString()}|${item.id}`).toString('base64');
}

function isOverdue(item: ReviewQueueItem): boolean {
  return new Date(item.slaDeadline) < new Date() &&
    (item.status === 'PENDING_REVIEW' || item.status === 'IN_REVIEW');
}

export const Query: Resolvers = {
  Query: {
    async safetyCheck(_parent, { id }, _context) {
      const check = await safetyCheckService.getSafetyCheckById(id);
      if (!check) return null;

      return {
        ...check,
        patient: { __typename: 'Patient' as const, id: check.patientId },
        overrideInfo: null as any,
      } as any;
    },

    async safetyChecks(_parent, { filter, pagination }, _context) {
      const result = await safetyCheckService.getSafetyChecks(
        {
          patientId: filter?.patientId || undefined,
          encounterId: filter?.encounterId || undefined,
          checkType: filter?.checkType as any || undefined,
          status: filter?.status as any || undefined,
          severity: filter?.severity as any || undefined,
        },
        {
          first: pagination?.first || undefined,
          after: pagination?.after || undefined,
        }
      );

      const edges = result.checks.map(c => ({
        node: {
          ...c,
          patient: { __typename: 'Patient' as const, id: c.patientId },
          overrideInfo: null as any,
        },
        cursor: createCursor(c),
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

    async safetyChecksForPatient(_parent, { patientId, status, severity, pagination }, _context) {
      const result = await safetyCheckService.getSafetyChecks(
        {
          patientId,
          status: status as any || undefined,
          severity: severity as any || undefined,
        },
        {
          first: pagination?.first || undefined,
          after: pagination?.after || undefined,
        }
      );

      const edges = result.checks.map(c => ({
        node: {
          ...c,
          patient: { __typename: 'Patient' as const, id: c.patientId },
          overrideInfo: null as any,
        },
        cursor: createCursor(c),
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

    async reviewQueueItem(_parent, { id }, _context) {
      const item = await reviewQueueService.getReviewQueueItemById(id);
      if (!item) return null;

      const safetyCheck = await safetyCheckService.getSafetyCheckById(item.safetyCheckId);

      return {
        ...item,
        patient: { __typename: 'Patient' as const, id: item.patientId },
        safetyCheck: safetyCheck ? {
          ...safetyCheck,
          patient: { __typename: 'Patient' as const, id: safetyCheck.patientId },
          overrideInfo: null as any,
        } : null,
        isOverdue: isOverdue(item),
        resolution: null,
      } as any;
    },

    async reviewQueue(_parent, { filter, pagination }, _context) {
      const result = await reviewQueueService.getReviewQueue(
        {
          patientId: filter?.patientId || undefined,
          assignedTo: filter?.assignedTo || undefined,
          status: filter?.status as any || undefined,
          priority: filter?.priority as any || undefined,
          isOverdue: filter?.isOverdue || undefined,
        },
        {
          first: pagination?.first || undefined,
          after: pagination?.after || undefined,
        }
      );

      const edges = await Promise.all(result.items.map(async item => {
        const safetyCheck = await safetyCheckService.getSafetyCheckById(item.safetyCheckId);
        return {
          node: {
            ...item,
            patient: { __typename: 'Patient' as const, id: item.patientId },
            safetyCheck: safetyCheck ? {
              ...safetyCheck,
              patient: { __typename: 'Patient' as const, id: safetyCheck.patientId },
              overrideInfo: null as any,
            } : null,
            isOverdue: isOverdue(item),
            resolution: null as any,
          },
          cursor: createCursor(item),
        };
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

    async myReviewQueue(_parent, { status, pagination }, _context) {
      const userId = 'current-user'; // TODO: Get from auth context
      const result = await reviewQueueService.getReviewQueue(
        {
          assignedTo: userId,
          status: status as any || undefined,
        },
        {
          first: pagination?.first || undefined,
          after: pagination?.after || undefined,
        }
      );

      const edges = await Promise.all(result.items.map(async item => {
        const safetyCheck = await safetyCheckService.getSafetyCheckById(item.safetyCheckId);
        return {
          node: {
            ...item,
            patient: { __typename: 'Patient' as const, id: item.patientId },
            safetyCheck: safetyCheck ? {
              ...safetyCheck,
              patient: { __typename: 'Patient' as const, id: safetyCheck.patientId },
              overrideInfo: null as any,
            } : null,
            isOverdue: isOverdue(item),
            resolution: null as any,
          },
          cursor: createCursor(item),
        };
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

    async overdueReviews(_parent, { pagination }, _context) {
      const result = await reviewQueueService.getReviewQueue(
        { isOverdue: true },
        {
          first: pagination?.first || undefined,
          after: pagination?.after || undefined,
        }
      );

      const edges = await Promise.all(result.items.map(async item => {
        const safetyCheck = await safetyCheckService.getSafetyCheckById(item.safetyCheckId);
        return {
          node: {
            ...item,
            patient: { __typename: 'Patient' as const, id: item.patientId },
            safetyCheck: safetyCheck ? {
              ...safetyCheck,
              patient: { __typename: 'Patient' as const, id: safetyCheck.patientId },
              overrideInfo: null as any,
            } : null,
            isOverdue: true,
            resolution: null as any,
          },
          cursor: createCursor(item),
        };
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

  SafetyCheck: {
    async __resolveReference(reference) {
      const check = await safetyCheckService.getSafetyCheckById(reference.id);
      if (!check) return null;

      return {
        ...check,
        patient: { __typename: 'Patient' as const, id: check.patientId },
        overrideInfo: null as any,
      } as any;
    },
  },

  ReviewQueueItem: {
    async __resolveReference(reference) {
      const item = await reviewQueueService.getReviewQueueItemById(reference.id);
      if (!item) return null;

      const safetyCheck = await safetyCheckService.getSafetyCheckById(item.safetyCheckId);

      return {
        ...item,
        patient: { __typename: 'Patient' as const, id: item.patientId },
        safetyCheck: safetyCheck ? {
          ...safetyCheck,
          patient: { __typename: 'Patient' as const, id: safetyCheck.patientId },
          overrideInfo: null as any,
        } : null,
        isOverdue: isOverdue(item),
        resolution: null,
      } as any;
    },
  },

  Patient: {
    async safetyChecks(parent, { status, severity, pagination }) {
      const result = await safetyCheckService.getSafetyChecks(
        {
          patientId: parent.id,
          status: status as any || undefined,
          severity: severity as any || undefined,
        },
        {
          first: pagination?.first || undefined,
          after: pagination?.after || undefined,
        }
      );

      const edges = result.checks.map(c => ({
        node: {
          ...c,
          patient: { __typename: 'Patient' as const, id: c.patientId },
          overrideInfo: null as any,
        },
        cursor: createCursor(c),
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

    async activeSafetyAlerts(parent) {
      const alerts = await safetyCheckService.getActiveSafetyAlerts(parent.id);
      return alerts.map(a => ({
        ...a,
        patient: { __typename: 'Patient' as const, id: a.patientId },
        overrideInfo: null as any,
        relatedMedications: a.relatedMedications || [],
        relatedConditions: a.relatedConditions || [],
        relatedAllergies: a.relatedAllergies || [],
        guidelineReferences: a.guidelineReferences || [],
      })) as any;
    },
  },
};
