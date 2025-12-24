"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Query = void 0;
const database_1 = require("@safety/services/database");
function createCursor(item) {
    return Buffer.from(`${item.createdAt.toISOString()}|${item.id}`).toString('base64');
}
function isOverdue(item) {
    return new Date(item.slaDeadline) < new Date() &&
        (item.status === 'PENDING_REVIEW' || item.status === 'IN_REVIEW');
}
exports.Query = {
    Query: {
        async safetyCheck(_parent, { id }, _context) {
            const check = await database_1.safetyCheckService.getSafetyCheckById(id);
            if (!check)
                return null;
            return {
                ...check,
                patient: { __typename: 'Patient', id: check.patientId },
                overrideInfo: null,
            };
        },
        async safetyChecks(_parent, { filter, pagination }, _context) {
            const result = await database_1.safetyCheckService.getSafetyChecks({
                patientId: filter?.patientId || undefined,
                encounterId: filter?.encounterId || undefined,
                checkType: filter?.checkType || undefined,
                status: filter?.status || undefined,
                severity: filter?.severity || undefined,
            }, {
                first: pagination?.first || undefined,
                after: pagination?.after || undefined,
            });
            const edges = result.checks.map(c => ({
                node: {
                    ...c,
                    patient: { __typename: 'Patient', id: c.patientId },
                    overrideInfo: null,
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
            };
        },
        async safetyChecksForPatient(_parent, { patientId, status, severity, pagination }, _context) {
            const result = await database_1.safetyCheckService.getSafetyChecks({
                patientId,
                status: status || undefined,
                severity: severity || undefined,
            }, {
                first: pagination?.first || undefined,
                after: pagination?.after || undefined,
            });
            const edges = result.checks.map(c => ({
                node: {
                    ...c,
                    patient: { __typename: 'Patient', id: c.patientId },
                    overrideInfo: null,
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
            };
        },
        async reviewQueueItem(_parent, { id }, _context) {
            const item = await database_1.reviewQueueService.getReviewQueueItemById(id);
            if (!item)
                return null;
            const safetyCheck = await database_1.safetyCheckService.getSafetyCheckById(item.safetyCheckId);
            return {
                ...item,
                patient: { __typename: 'Patient', id: item.patientId },
                safetyCheck: safetyCheck ? {
                    ...safetyCheck,
                    patient: { __typename: 'Patient', id: safetyCheck.patientId },
                    overrideInfo: null,
                } : null,
                isOverdue: isOverdue(item),
                resolution: null,
            };
        },
        async reviewQueue(_parent, { filter, pagination }, _context) {
            const result = await database_1.reviewQueueService.getReviewQueue({
                patientId: filter?.patientId || undefined,
                assignedTo: filter?.assignedTo || undefined,
                status: filter?.status || undefined,
                priority: filter?.priority || undefined,
                isOverdue: filter?.isOverdue || undefined,
            }, {
                first: pagination?.first || undefined,
                after: pagination?.after || undefined,
            });
            const edges = await Promise.all(result.items.map(async (item) => {
                const safetyCheck = await database_1.safetyCheckService.getSafetyCheckById(item.safetyCheckId);
                return {
                    node: {
                        ...item,
                        patient: { __typename: 'Patient', id: item.patientId },
                        safetyCheck: safetyCheck ? {
                            ...safetyCheck,
                            patient: { __typename: 'Patient', id: safetyCheck.patientId },
                            overrideInfo: null,
                        } : null,
                        isOverdue: isOverdue(item),
                        resolution: null,
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
            };
        },
        async myReviewQueue(_parent, { status, pagination }, _context) {
            const userId = 'current-user';
            const result = await database_1.reviewQueueService.getReviewQueue({
                assignedTo: userId,
                status: status || undefined,
            }, {
                first: pagination?.first || undefined,
                after: pagination?.after || undefined,
            });
            const edges = await Promise.all(result.items.map(async (item) => {
                const safetyCheck = await database_1.safetyCheckService.getSafetyCheckById(item.safetyCheckId);
                return {
                    node: {
                        ...item,
                        patient: { __typename: 'Patient', id: item.patientId },
                        safetyCheck: safetyCheck ? {
                            ...safetyCheck,
                            patient: { __typename: 'Patient', id: safetyCheck.patientId },
                            overrideInfo: null,
                        } : null,
                        isOverdue: isOverdue(item),
                        resolution: null,
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
            };
        },
        async overdueReviews(_parent, { pagination }, _context) {
            const result = await database_1.reviewQueueService.getReviewQueue({ isOverdue: true }, {
                first: pagination?.first || undefined,
                after: pagination?.after || undefined,
            });
            const edges = await Promise.all(result.items.map(async (item) => {
                const safetyCheck = await database_1.safetyCheckService.getSafetyCheckById(item.safetyCheckId);
                return {
                    node: {
                        ...item,
                        patient: { __typename: 'Patient', id: item.patientId },
                        safetyCheck: safetyCheck ? {
                            ...safetyCheck,
                            patient: { __typename: 'Patient', id: safetyCheck.patientId },
                            overrideInfo: null,
                        } : null,
                        isOverdue: true,
                        resolution: null,
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
            };
        },
    },
    SafetyCheck: {
        async __resolveReference(reference) {
            const check = await database_1.safetyCheckService.getSafetyCheckById(reference.id);
            if (!check)
                return null;
            return {
                ...check,
                patient: { __typename: 'Patient', id: check.patientId },
                overrideInfo: null,
            };
        },
    },
    ReviewQueueItem: {
        async __resolveReference(reference) {
            const item = await database_1.reviewQueueService.getReviewQueueItemById(reference.id);
            if (!item)
                return null;
            const safetyCheck = await database_1.safetyCheckService.getSafetyCheckById(item.safetyCheckId);
            return {
                ...item,
                patient: { __typename: 'Patient', id: item.patientId },
                safetyCheck: safetyCheck ? {
                    ...safetyCheck,
                    patient: { __typename: 'Patient', id: safetyCheck.patientId },
                    overrideInfo: null,
                } : null,
                isOverdue: isOverdue(item),
                resolution: null,
            };
        },
    },
    Patient: {
        async safetyChecks(parent, { status, severity, pagination }) {
            const result = await database_1.safetyCheckService.getSafetyChecks({
                patientId: parent.id,
                status: status || undefined,
                severity: severity || undefined,
            }, {
                first: pagination?.first || undefined,
                after: pagination?.after || undefined,
            });
            const edges = result.checks.map(c => ({
                node: {
                    ...c,
                    patient: { __typename: 'Patient', id: c.patientId },
                    overrideInfo: null,
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
            };
        },
        async activeSafetyAlerts(parent) {
            const alerts = await database_1.safetyCheckService.getActiveSafetyAlerts(parent.id);
            return alerts.map(a => ({
                ...a,
                patient: { __typename: 'Patient', id: a.patientId },
                overrideInfo: null,
                relatedMedications: a.relatedMedications || [],
                relatedConditions: a.relatedConditions || [],
                relatedAllergies: a.relatedAllergies || [],
                guidelineReferences: a.guidelineReferences || [],
            }));
        },
    },
};
//# sourceMappingURL=Query.js.map