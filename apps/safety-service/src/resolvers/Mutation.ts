import { Resolvers } from "../__generated__/resolvers-types";
import { safetyCheckService, reviewQueueService } from "../services/database";
import { GraphQLError } from "graphql";

export const Mutation: Resolvers = {
  Mutation: {
    async validateSafety(_parent, { input }, _context) {
      if (!input.patientId) {
        throw new GraphQLError("Patient ID is required.");
      }

      try {
        const result = await safetyCheckService.validateSafety({
          patientId: input.patientId,
          encounterId: input.encounterId || undefined,
          medicationCodes: input.medicationCodes || undefined,
          conditionCodes: input.conditionCodes || undefined,
          checkTypes: (input.checkTypes || undefined) as any,
        });

        return {
          isValid: result.blockers.length === 0,
          checks: result.checks.map(c => ({
            ...c,
            patient: { __typename: 'Patient' as const, id: c.patientId },
            overrideInfo: null as any,
          })),
          blockers: result.blockers.map(c => ({
            ...c,
            patient: { __typename: 'Patient' as const, id: c.patientId },
            overrideInfo: null as any,
          })),
          warnings: result.warnings.map(c => ({
            ...c,
            patient: { __typename: 'Patient' as const, id: c.patientId },
            overrideInfo: null as any,
          })),
          requiresReview: result.blockers.length > 0 || result.warnings.some(w => w.severity === 'CRITICAL'),
          reviewQueueItem: null as any,
        } as any;
      } catch (error: any) {
        throw new GraphQLError("Failed to validate safety.");
      }
    },

    async overrideSafetyCheck(_parent, { input }, _context) {
      if (!input.safetyCheckId) {
        throw new GraphQLError("Safety check ID is required.");
      }
      if (!input.reason) {
        throw new GraphQLError("Override reason is required.");
      }
      if (!input.justification || input.justification.trim().length < 10) {
        throw new GraphQLError("Justification must be at least 10 characters.");
      }

      try {
        const check = await safetyCheckService.overrideSafetyCheck(
          input.safetyCheckId,
          {
            reason: input.reason as any,
            justification: input.justification,
            expiresInHours: input.expiresInHours || undefined,
            overriddenBy: 'system', // TODO: Get from auth context
          }
        );

        if (!check) {
          throw new GraphQLError("Safety check not found.");
        }

        return {
          ...check,
          patient: { __typename: 'Patient' as const, id: check.patientId },
          overrideInfo: {
            overriddenBy: 'system',
            overriddenAt: new Date(),
            reason: input.reason,
            justification: input.justification,
            expiresAt: input.expiresInHours
              ? new Date(Date.now() + input.expiresInHours * 60 * 60 * 1000)
              : null,
          },
        } as any;
      } catch (error: any) {
        if (error.extensions?.code === 'NOT_FOUND') {
          throw error;
        }
        throw new GraphQLError("Failed to override safety check.");
      }
    },

    async assignReview(_parent, { input }, _context) {
      if (!input.reviewQueueItemId) {
        throw new GraphQLError("Review queue item ID is required.");
      }
      if (!input.assignTo) {
        throw new GraphQLError("Assignee is required.");
      }

      try {
        const item = await reviewQueueService.assignReview(input.reviewQueueItemId, input.assignTo);

        if (!item) {
          throw new GraphQLError("Review queue item not found.");
        }

        const safetyCheck = await safetyCheckService.getSafetyCheckById(item.safetyCheckId);

        return {
          ...item,
          patient: { __typename: 'Patient' as const, id: item.patientId },
          safetyCheck: safetyCheck ? {
            ...safetyCheck,
            patient: { __typename: 'Patient' as const, id: safetyCheck.patientId },
            overrideInfo: null as any,
          } : null,
          isOverdue: new Date(item.slaDeadline) < new Date(),
          resolution: null as any,
        } as any;
      } catch (error: any) {
        if (error.extensions?.code === 'NOT_FOUND') {
          throw error;
        }
        throw new GraphQLError("Failed to assign review.");
      }
    },

    async resolveReview(_parent, { input }, _context) {
      if (!input.reviewQueueItemId) {
        throw new GraphQLError("Review queue item ID is required.");
      }
      if (!input.decision) {
        throw new GraphQLError("Decision is required.");
      }

      try {
        const item = await reviewQueueService.resolveReview(input.reviewQueueItemId, {
          decision: input.decision as any,
          notes: input.notes || undefined,
          escalationReason: input.escalationReason || undefined,
          resolvedBy: 'system', // TODO: Get from auth context
        });

        if (!item) {
          throw new GraphQLError("Review queue item not found.");
        }

        const safetyCheck = await safetyCheckService.getSafetyCheckById(item.safetyCheckId);

        return {
          ...item,
          patient: { __typename: 'Patient' as const, id: item.patientId },
          safetyCheck: safetyCheck ? {
            ...safetyCheck,
            patient: { __typename: 'Patient' as const, id: safetyCheck.patientId },
            overrideInfo: null as any,
          } : null,
          isOverdue: new Date(item.slaDeadline) < new Date(),
          resolution: {
            resolvedBy: 'system',
            resolvedAt: new Date(),
            decision: input.decision,
            notes: input.notes || null,
            escalationReason: input.escalationReason || null,
          },
        } as any;
      } catch (error: any) {
        if (error.extensions?.code === 'NOT_FOUND') {
          throw error;
        }
        throw new GraphQLError("Failed to resolve review.");
      }
    },

    async escalateReview(_parent, { reviewQueueItemId, reason }, _context) {
      if (!reviewQueueItemId) {
        throw new GraphQLError("Review queue item ID is required.");
      }
      if (!reason || reason.trim().length < 10) {
        throw new GraphQLError("Escalation reason must be at least 10 characters.");
      }

      try {
        const item = await reviewQueueService.resolveReview(reviewQueueItemId, {
          decision: 'ESCALATED' as any,
          escalationReason: reason,
          resolvedBy: 'system', // TODO: Get from auth context
        });

        if (!item) {
          throw new GraphQLError("Review queue item not found.");
        }

        const safetyCheck = await safetyCheckService.getSafetyCheckById(item.safetyCheckId);

        return {
          ...item,
          patient: { __typename: 'Patient' as const, id: item.patientId },
          safetyCheck: safetyCheck ? {
            ...safetyCheck,
            patient: { __typename: 'Patient' as const, id: safetyCheck.patientId },
            overrideInfo: null as any,
          } : null,
          isOverdue: new Date(item.slaDeadline) < new Date(),
          resolution: {
            resolvedBy: 'system',
            resolvedAt: new Date(),
            decision: 'ESCALATED' as any,
            notes: null,
            escalationReason: reason,
          },
        } as any;
      } catch (error: any) {
        if (error.extensions?.code === 'NOT_FOUND') {
          throw error;
        }
        throw new GraphQLError("Failed to escalate review.");
      }
    },
  },
};
