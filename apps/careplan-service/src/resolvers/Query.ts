import { Resolvers } from "../__generated__/resolvers-types";
import { carePlanService, carePlanTemplateService, CarePlan } from "../services/database";

function createCursor(item: { createdAt: Date; id: string }): string {
  return Buffer.from(`${item.createdAt.toISOString()}|${item.id}`).toString('base64');
}

async function enrichCarePlan(carePlan: CarePlan) {
  const goals = await carePlanService.getGoalsForCarePlan(carePlan.id);
  const interventions = await carePlanService.getInterventionsForCarePlan(carePlan.id);

  return {
    ...carePlan,
    patient: { __typename: 'Patient' as const, id: carePlan.patientId },
    goals: goals.map(g => ({
      ...g,
      progressNotes: [] as any[],
    })),
    interventions,
  };
}

export const Query: Resolvers = {
  Query: {
    async carePlan(_parent, { id }, _context) {
      const carePlan = await carePlanService.getCarePlanById(id);
      if (!carePlan) return null;

      return await enrichCarePlan(carePlan) as any;
    },

    async carePlans(_parent, { filter, pagination }, _context) {
      const result = await carePlanService.getCarePlans(
        {
          patientId: filter?.patientId || undefined,
          status: filter?.status as any || undefined,
          conditionCode: filter?.conditionCode || undefined,
          createdAfter: filter?.createdAfter ? new Date(filter.createdAfter) : undefined,
          createdBefore: filter?.createdBefore ? new Date(filter.createdBefore) : undefined,
        },
        {
          first: pagination?.first || undefined,
          after: pagination?.after || undefined,
        }
      );

      const edges = await Promise.all(result.carePlans.map(async cp => ({
        node: await enrichCarePlan(cp),
        cursor: createCursor(cp),
      })));

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

    async carePlansForPatient(_parent, { patientId, status, pagination }, _context) {
      const result = await carePlanService.getCarePlans(
        {
          patientId,
          status: status as any || undefined,
        },
        {
          first: pagination?.first || undefined,
          after: pagination?.after || undefined,
        }
      );

      const edges = await Promise.all(result.carePlans.map(async cp => ({
        node: await enrichCarePlan(cp),
        cursor: createCursor(cp),
      })));

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

    async activeCarePlanForPatient(_parent, { patientId }, _context) {
      const carePlan = await carePlanService.getActiveCarePlanForPatient(patientId);
      if (!carePlan) return null;

      return await enrichCarePlan(carePlan) as any;
    },

    async carePlanTemplate(_parent, { id }, _context) {
      const template = await carePlanTemplateService.getTemplateById(id);
      if (!template) return null;

      return {
        ...template,
        defaultGoals: [] as any[],
        defaultInterventions: [] as any[],
      } as any;
    },

    async carePlanTemplates(_parent, { filter, pagination }, _context) {
      const result = await carePlanTemplateService.getTemplates(
        {
          category: filter?.category as any || undefined,
          conditionCode: filter?.conditionCode || undefined,
          isActive: filter?.isActive ?? undefined,
        },
        {
          first: pagination?.first || undefined,
          after: pagination?.after || undefined,
        }
      );

      const edges = result.templates.map(t => ({
        node: {
          ...t,
          defaultGoals: [] as any[],
          defaultInterventions: [] as any[],
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

    async templatesForConditions(_parent, { conditionCodes }, _context) {
      const templates = await carePlanTemplateService.getTemplatesForConditions(conditionCodes);
      return templates.map(t => ({
        ...t,
        defaultGoals: [] as any[],
        defaultInterventions: [] as any[],
      })) as any;
    },
  },

  CarePlan: {
    async __resolveReference(reference) {
      const carePlan = await carePlanService.getCarePlanById(reference.id);
      if (!carePlan) return null;

      return await enrichCarePlan(carePlan) as any;
    },
  },

  CarePlanTemplate: {
    async __resolveReference(reference) {
      const template = await carePlanTemplateService.getTemplateById(reference.id);
      if (!template) return null;

      return {
        ...template,
        defaultGoals: [] as any[],
        defaultInterventions: [] as any[],
      } as any;
    },
  },

  Patient: {
    async carePlans(parent, { status, pagination }) {
      const result = await carePlanService.getCarePlans(
        {
          patientId: parent.id,
          status: status as any || undefined,
        },
        {
          first: pagination?.first || undefined,
          after: pagination?.after || undefined,
        }
      );

      const edges = await Promise.all(result.carePlans.map(async cp => ({
        node: await enrichCarePlan(cp),
        cursor: createCursor(cp),
      })));

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

    async activeCarePlan(parent) {
      const carePlan = await carePlanService.getActiveCarePlanForPatient(parent.id);
      if (!carePlan) return null;

      return await enrichCarePlan(carePlan) as any;
    },
  },
};
