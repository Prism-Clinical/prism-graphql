import { Resolvers } from "../__generated__/resolvers-types";
import {
  userService,
  medicationService,
  safetyRuleService,
  auditLogService,
  importJobService,
  statsService,
} from "../services/database";

function createCursor(item: { createdAt: Date; id?: string; code?: string }): string {
  const id = item.id || item.code || '';
  return Buffer.from(`${item.createdAt.toISOString()}|${id}`).toString('base64');
}

export const Query: Resolvers = {
  Query: {
    async adminStats(_parent, _args, _context) {
      return await statsService.getAdminStats();
    },

    async adminUser(_parent, { id }, _context) {
      return await userService.getUserById(id) as any;
    },

    async adminUsers(_parent, { filter, pagination }, _context) {
      const result = await userService.getUsers(
        {
          role: filter?.role as any || undefined,
          status: filter?.status as any || undefined,
          searchTerm: filter?.searchTerm || undefined,
        },
        {
          first: pagination?.first || undefined,
          after: pagination?.after || undefined,
        }
      );

      const edges = result.users.map(u => ({
        node: u,
        cursor: createCursor(u),
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

    async medicationDefinition(_parent, { code }, _context) {
      const medication = await medicationService.getMedicationByCode(code);
      if (!medication) return null;

      const interactions = await medicationService.getInteractionsForMedication(code);
      return {
        ...medication,
        interactions,
      } as any;
    },

    async medicationDefinitions(_parent, { filter, pagination }, _context) {
      const result = await medicationService.getMedications(
        {
          drugClass: filter?.drugClass || undefined,
          searchTerm: filter?.searchTerm || undefined,
          isActive: filter?.isActive ?? undefined,
        },
        {
          first: pagination?.first || undefined,
          after: pagination?.after || undefined,
        }
      );

      const edges = await Promise.all(result.medications.map(async m => {
        const interactions = await medicationService.getInteractionsForMedication(m.code);
        return {
          node: { ...m, interactions },
          cursor: createCursor(m),
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

    async safetyRule(_parent, { id }, _context) {
      return await safetyRuleService.getSafetyRuleById(id) as any;
    },

    async safetyRules(_parent, { filter, pagination }, _context) {
      const result = await safetyRuleService.getSafetyRules(
        {
          ruleType: filter?.ruleType as any || undefined,
          severity: filter?.severity as any || undefined,
          isActive: filter?.isActive ?? undefined,
          searchTerm: filter?.searchTerm || undefined,
        },
        {
          first: pagination?.first || undefined,
          after: pagination?.after || undefined,
        }
      );

      const edges = result.rules.map(r => ({
        node: r,
        cursor: createCursor(r),
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

    // Version history queries
    async safetyRuleHistory(_parent, { id }, _context) {
      return await safetyRuleService.getSafetyRuleHistory(id) as any;
    },

    async safetyRuleAtTime(_parent, { id, timestamp }, _context) {
      return await safetyRuleService.getSafetyRuleAtTime(id, new Date(timestamp)) as any;
    },

    async safetyRuleVersionCount(_parent, { id }, _context) {
      return await safetyRuleService.getSafetyRuleVersionCount(id);
    },

    async auditLog(_parent, { id }, _context) {
      return await auditLogService.getAuditLogById(id) as any;
    },

    async auditLogs(_parent, { filter, pagination }, _context) {
      const result = await auditLogService.getAuditLogs(
        {
          action: filter?.action as any || undefined,
          entityType: filter?.entityType as any || undefined,
          entityId: filter?.entityId || undefined,
          userId: filter?.userId || undefined,
          startDate: filter?.startDate ? new Date(filter.startDate) : undefined,
          endDate: filter?.endDate ? new Date(filter.endDate) : undefined,
        },
        {
          first: pagination?.first || undefined,
          after: pagination?.after || undefined,
        }
      );

      const edges = result.logs.map(l => ({
        node: l,
        cursor: Buffer.from(`${l.timestamp.toISOString()}|${l.id}`).toString('base64'),
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

    async importJob(_parent, { id }, _context) {
      return await importJobService.getImportJobById(id) as any;
    },

    async importJobs(_parent, { filter, pagination }, _context) {
      const result = await importJobService.getImportJobs(
        {
          type: filter?.type as any || undefined,
          status: filter?.status as any || undefined,
        },
        {
          first: pagination?.first || undefined,
          after: pagination?.after || undefined,
        }
      );

      const edges = result.jobs.map(j => ({
        node: j,
        cursor: createCursor(j),
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

  AdminUser: {
    async __resolveReference(reference) {
      return await userService.getUserById(reference.id) as any;
    },
  },

  MedicationDefinition: {
    async __resolveReference(reference) {
      const medication = await medicationService.getMedicationByCode(reference.code);
      if (!medication) return null;
      const interactions = await medicationService.getInteractionsForMedication(reference.code);
      return { ...medication, interactions } as any;
    },
  },

  SafetyRule: {
    async __resolveReference(reference) {
      return await safetyRuleService.getSafetyRuleById(reference.id) as any;
    },
    async versionCount(parent) {
      return await safetyRuleService.getSafetyRuleVersionCount(parent.id);
    },
    async history(parent) {
      return await safetyRuleService.getSafetyRuleHistory(parent.id) as any;
    },
  },

  AuditLog: {
    async __resolveReference(reference) {
      return await auditLogService.getAuditLogById(reference.id) as any;
    },
  },

  ImportJob: {
    async __resolveReference(reference) {
      return await importJobService.getImportJobById(reference.id) as any;
    },
  },
};
