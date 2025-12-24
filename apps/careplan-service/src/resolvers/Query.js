"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Query = void 0;
const database_1 = require("@careplan/services/database");
function createCursor(item) {
    return Buffer.from(`${item.createdAt.toISOString()}|${item.id}`).toString('base64');
}
async function enrichCarePlan(carePlan) {
    const goals = await database_1.carePlanService.getGoalsForCarePlan(carePlan.id);
    const interventions = await database_1.carePlanService.getInterventionsForCarePlan(carePlan.id);
    return {
        ...carePlan,
        patient: { __typename: 'Patient', id: carePlan.patientId },
        goals: goals.map(g => ({
            ...g,
            progressNotes: [],
        })),
        interventions,
    };
}
exports.Query = {
    Query: {
        async carePlan(_parent, { id }, _context) {
            const carePlan = await database_1.carePlanService.getCarePlanById(id);
            if (!carePlan)
                return null;
            return await enrichCarePlan(carePlan);
        },
        async carePlans(_parent, { filter, pagination }, _context) {
            const result = await database_1.carePlanService.getCarePlans({
                patientId: filter?.patientId || undefined,
                status: filter?.status || undefined,
                conditionCode: filter?.conditionCode || undefined,
                createdAfter: filter?.createdAfter ? new Date(filter.createdAfter) : undefined,
                createdBefore: filter?.createdBefore ? new Date(filter.createdBefore) : undefined,
            }, {
                first: pagination?.first || undefined,
                after: pagination?.after || undefined,
            });
            const edges = await Promise.all(result.carePlans.map(async (cp) => ({
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
            };
        },
        async carePlansForPatient(_parent, { patientId, status, pagination }, _context) {
            const result = await database_1.carePlanService.getCarePlans({
                patientId,
                status: status || undefined,
            }, {
                first: pagination?.first || undefined,
                after: pagination?.after || undefined,
            });
            const edges = await Promise.all(result.carePlans.map(async (cp) => ({
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
            };
        },
        async activeCarePlanForPatient(_parent, { patientId }, _context) {
            const carePlan = await database_1.carePlanService.getActiveCarePlanForPatient(patientId);
            if (!carePlan)
                return null;
            return await enrichCarePlan(carePlan);
        },
        async carePlanTemplate(_parent, { id }, _context) {
            const template = await database_1.carePlanTemplateService.getTemplateById(id);
            if (!template)
                return null;
            return {
                ...template,
                defaultGoals: [],
                defaultInterventions: [],
            };
        },
        async carePlanTemplates(_parent, { filter, pagination }, _context) {
            const result = await database_1.carePlanTemplateService.getTemplates({
                category: filter?.category || undefined,
                conditionCode: filter?.conditionCode || undefined,
                isActive: filter?.isActive ?? undefined,
            }, {
                first: pagination?.first || undefined,
                after: pagination?.after || undefined,
            });
            const edges = result.templates.map(t => ({
                node: {
                    ...t,
                    defaultGoals: [],
                    defaultInterventions: [],
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
        async templatesForConditions(_parent, { conditionCodes }, _context) {
            const templates = await database_1.carePlanTemplateService.getTemplatesForConditions(conditionCodes);
            return templates.map(t => ({
                ...t,
                defaultGoals: [],
                defaultInterventions: [],
            }));
        },
    },
    CarePlan: {
        async __resolveReference(reference) {
            const carePlan = await database_1.carePlanService.getCarePlanById(reference.id);
            if (!carePlan)
                return null;
            return await enrichCarePlan(carePlan);
        },
    },
    CarePlanTemplate: {
        async __resolveReference(reference) {
            const template = await database_1.carePlanTemplateService.getTemplateById(reference.id);
            if (!template)
                return null;
            return {
                ...template,
                defaultGoals: [],
                defaultInterventions: [],
            };
        },
    },
    Patient: {
        async carePlans(parent, { status, pagination }) {
            const result = await database_1.carePlanService.getCarePlans({
                patientId: parent.id,
                status: status || undefined,
            }, {
                first: pagination?.first || undefined,
                after: pagination?.after || undefined,
            });
            const edges = await Promise.all(result.carePlans.map(async (cp) => ({
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
            };
        },
        async activeCarePlan(parent) {
            const carePlan = await database_1.carePlanService.getActiveCarePlanForPatient(parent.id);
            if (!carePlan)
                return null;
            return await enrichCarePlan(carePlan);
        },
    },
};
//# sourceMappingURL=Query.js.map