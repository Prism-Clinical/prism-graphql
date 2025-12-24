"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Mutation = void 0;
const database_1 = require("@safety/services/database");
const apollo_server_errors_1 = require("apollo-server-errors");
exports.Mutation = {
    Mutation: {
        async validateSafety(_parent, { input }, _context) {
            if (!input.patientId) {
                throw new apollo_server_errors_1.ApolloError("Patient ID is required.", "BAD_USER_INPUT");
            }
            try {
                const result = await database_1.safetyCheckService.validateSafety({
                    patientId: input.patientId,
                    encounterId: input.encounterId || undefined,
                    medicationCodes: input.medicationCodes || undefined,
                    conditionCodes: input.conditionCodes || undefined,
                    checkTypes: input.checkTypes || undefined,
                });
                return {
                    isValid: result.blockers.length === 0,
                    checks: result.checks.map(c => ({
                        ...c,
                        patient: { __typename: 'Patient', id: c.patientId },
                        overrideInfo: null,
                    })),
                    blockers: result.blockers.map(c => ({
                        ...c,
                        patient: { __typename: 'Patient', id: c.patientId },
                        overrideInfo: null,
                    })),
                    warnings: result.warnings.map(c => ({
                        ...c,
                        patient: { __typename: 'Patient', id: c.patientId },
                        overrideInfo: null,
                    })),
                    requiresReview: result.blockers.length > 0 || result.warnings.some(w => w.severity === 'CRITICAL'),
                    reviewQueueItem: null,
                };
            }
            catch (error) {
                throw new apollo_server_errors_1.ApolloError("Failed to validate safety.", "INTERNAL_ERROR");
            }
        },
        async overrideSafetyCheck(_parent, { input }, _context) {
            if (!input.safetyCheckId) {
                throw new apollo_server_errors_1.ApolloError("Safety check ID is required.", "BAD_USER_INPUT");
            }
            if (!input.reason) {
                throw new apollo_server_errors_1.ApolloError("Override reason is required.", "BAD_USER_INPUT");
            }
            if (!input.justification || input.justification.trim().length < 10) {
                throw new apollo_server_errors_1.ApolloError("Justification must be at least 10 characters.", "BAD_USER_INPUT");
            }
            try {
                const check = await database_1.safetyCheckService.overrideSafetyCheck(input.safetyCheckId, {
                    reason: input.reason,
                    justification: input.justification,
                    expiresInHours: input.expiresInHours || undefined,
                    overriddenBy: 'system',
                });
                if (!check) {
                    throw new apollo_server_errors_1.ApolloError("Safety check not found.", "NOT_FOUND");
                }
                return {
                    ...check,
                    patient: { __typename: 'Patient', id: check.patientId },
                    overrideInfo: {
                        overriddenBy: 'system',
                        overriddenAt: new Date(),
                        reason: input.reason,
                        justification: input.justification,
                        expiresAt: input.expiresInHours
                            ? new Date(Date.now() + input.expiresInHours * 60 * 60 * 1000)
                            : null,
                    },
                };
            }
            catch (error) {
                if (error.extensions?.code === 'NOT_FOUND') {
                    throw error;
                }
                throw new apollo_server_errors_1.ApolloError("Failed to override safety check.", "INTERNAL_ERROR");
            }
        },
        async assignReview(_parent, { input }, _context) {
            if (!input.reviewQueueItemId) {
                throw new apollo_server_errors_1.ApolloError("Review queue item ID is required.", "BAD_USER_INPUT");
            }
            if (!input.assignTo) {
                throw new apollo_server_errors_1.ApolloError("Assignee is required.", "BAD_USER_INPUT");
            }
            try {
                const item = await database_1.reviewQueueService.assignReview(input.reviewQueueItemId, input.assignTo);
                if (!item) {
                    throw new apollo_server_errors_1.ApolloError("Review queue item not found.", "NOT_FOUND");
                }
                const safetyCheck = await database_1.safetyCheckService.getSafetyCheckById(item.safetyCheckId);
                return {
                    ...item,
                    patient: { __typename: 'Patient', id: item.patientId },
                    safetyCheck: safetyCheck ? {
                        ...safetyCheck,
                        patient: { __typename: 'Patient', id: safetyCheck.patientId },
                        overrideInfo: null,
                    } : null,
                    isOverdue: new Date(item.slaDeadline) < new Date(),
                    resolution: null,
                };
            }
            catch (error) {
                if (error.extensions?.code === 'NOT_FOUND') {
                    throw error;
                }
                throw new apollo_server_errors_1.ApolloError("Failed to assign review.", "INTERNAL_ERROR");
            }
        },
        async resolveReview(_parent, { input }, _context) {
            if (!input.reviewQueueItemId) {
                throw new apollo_server_errors_1.ApolloError("Review queue item ID is required.", "BAD_USER_INPUT");
            }
            if (!input.decision) {
                throw new apollo_server_errors_1.ApolloError("Decision is required.", "BAD_USER_INPUT");
            }
            try {
                const item = await database_1.reviewQueueService.resolveReview(input.reviewQueueItemId, {
                    decision: input.decision,
                    notes: input.notes || undefined,
                    escalationReason: input.escalationReason || undefined,
                    resolvedBy: 'system',
                });
                if (!item) {
                    throw new apollo_server_errors_1.ApolloError("Review queue item not found.", "NOT_FOUND");
                }
                const safetyCheck = await database_1.safetyCheckService.getSafetyCheckById(item.safetyCheckId);
                return {
                    ...item,
                    patient: { __typename: 'Patient', id: item.patientId },
                    safetyCheck: safetyCheck ? {
                        ...safetyCheck,
                        patient: { __typename: 'Patient', id: safetyCheck.patientId },
                        overrideInfo: null,
                    } : null,
                    isOverdue: new Date(item.slaDeadline) < new Date(),
                    resolution: {
                        resolvedBy: 'system',
                        resolvedAt: new Date(),
                        decision: input.decision,
                        notes: input.notes || null,
                        escalationReason: input.escalationReason || null,
                    },
                };
            }
            catch (error) {
                if (error.extensions?.code === 'NOT_FOUND') {
                    throw error;
                }
                throw new apollo_server_errors_1.ApolloError("Failed to resolve review.", "INTERNAL_ERROR");
            }
        },
        async escalateReview(_parent, { reviewQueueItemId, reason }, _context) {
            if (!reviewQueueItemId) {
                throw new apollo_server_errors_1.ApolloError("Review queue item ID is required.", "BAD_USER_INPUT");
            }
            if (!reason || reason.trim().length < 10) {
                throw new apollo_server_errors_1.ApolloError("Escalation reason must be at least 10 characters.", "BAD_USER_INPUT");
            }
            try {
                const item = await database_1.reviewQueueService.resolveReview(reviewQueueItemId, {
                    decision: 'ESCALATED',
                    escalationReason: reason,
                    resolvedBy: 'system',
                });
                if (!item) {
                    throw new apollo_server_errors_1.ApolloError("Review queue item not found.", "NOT_FOUND");
                }
                const safetyCheck = await database_1.safetyCheckService.getSafetyCheckById(item.safetyCheckId);
                return {
                    ...item,
                    patient: { __typename: 'Patient', id: item.patientId },
                    safetyCheck: safetyCheck ? {
                        ...safetyCheck,
                        patient: { __typename: 'Patient', id: safetyCheck.patientId },
                        overrideInfo: null,
                    } : null,
                    isOverdue: new Date(item.slaDeadline) < new Date(),
                    resolution: {
                        resolvedBy: 'system',
                        resolvedAt: new Date(),
                        decision: 'ESCALATED',
                        notes: null,
                        escalationReason: reason,
                    },
                };
            }
            catch (error) {
                if (error.extensions?.code === 'NOT_FOUND') {
                    throw error;
                }
                throw new apollo_server_errors_1.ApolloError("Failed to escalate review.", "INTERNAL_ERROR");
            }
        },
    },
};
//# sourceMappingURL=Mutation.js.map