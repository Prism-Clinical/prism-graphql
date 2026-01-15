import { Resolvers } from "../__generated__/resolvers-types";
import {
  userService,
  medicationService,
  safetyRuleService,
  auditLogService,
  importJobService,
  UserStatus,
  AuditAction,
  AuditEntityType,
} from "../services/database";

export const Mutation: Resolvers = {
  Mutation: {
    // User management
    async createUser(_parent, { input }, _context) {
      const user = await userService.createUser({
        email: input.email,
        firstName: input.firstName,
        lastName: input.lastName,
        role: input.role as any,
      });

      // Log audit event
      await auditLogService.createAuditLog({
        action: AuditAction.CREATE,
        entityType: AuditEntityType.USER,
        entityId: user.id,
        changes: JSON.stringify(input),
      });

      return user as any;
    },

    async updateUser(_parent, { id, input }, _context) {
      const user = await userService.updateUser(id, {
        firstName: input.firstName || undefined,
        lastName: input.lastName || undefined,
        role: input.role as any || undefined,
        status: input.status as any || undefined,
      });

      if (user) {
        await auditLogService.createAuditLog({
          action: AuditAction.UPDATE,
          entityType: AuditEntityType.USER,
          entityId: id,
          changes: JSON.stringify(input),
        });
      }

      return user as any;
    },

    async deleteUser(_parent, { id }, _context) {
      const success = await userService.deleteUser(id);

      if (success) {
        await auditLogService.createAuditLog({
          action: AuditAction.DELETE,
          entityType: AuditEntityType.USER,
          entityId: id,
        });
      }

      return success;
    },

    async activateUser(_parent, { id }, _context) {
      const user = await userService.updateUser(id, { status: UserStatus.ACTIVE });

      if (user) {
        await auditLogService.createAuditLog({
          action: AuditAction.UPDATE,
          entityType: AuditEntityType.USER,
          entityId: id,
          changes: JSON.stringify({ status: 'ACTIVE' }),
        });
      }

      return user as any;
    },

    async suspendUser(_parent, { id }, _context) {
      const user = await userService.updateUser(id, { status: UserStatus.SUSPENDED });

      if (user) {
        await auditLogService.createAuditLog({
          action: AuditAction.UPDATE,
          entityType: AuditEntityType.USER,
          entityId: id,
          changes: JSON.stringify({ status: 'SUSPENDED' }),
        });
      }

      return user as any;
    },

    // Medication management
    async createMedicationDefinition(_parent, { input }, _context) {
      const medication = await medicationService.createMedication({
        code: input.code,
        name: input.name,
        genericName: input.genericName || undefined,
        drugClass: input.drugClass || undefined,
        description: input.description || undefined,
        contraindications: input.contraindications || undefined,
      });

      await auditLogService.createAuditLog({
        action: AuditAction.CREATE,
        entityType: AuditEntityType.MEDICATION,
        entityId: medication.code,
        changes: JSON.stringify(input),
      });

      return { ...medication, interactions: [] } as any;
    },

    async updateMedicationDefinition(_parent, { code, input }, _context) {
      // Note: This would need implementation in the medication service
      // For now, return null
      await auditLogService.createAuditLog({
        action: AuditAction.UPDATE,
        entityType: AuditEntityType.MEDICATION,
        entityId: code,
        changes: JSON.stringify(input),
      });

      return null as any;
    },

    async deleteMedicationDefinition(_parent, { code }, _context) {
      // Note: This would need implementation in the medication service
      await auditLogService.createAuditLog({
        action: AuditAction.DELETE,
        entityType: AuditEntityType.MEDICATION,
        entityId: code,
      });

      return true;
    },

    async addDrugInteraction(_parent, { input }, _context) {
      // Note: This would need implementation in the medication service
      await auditLogService.createAuditLog({
        action: AuditAction.CREATE,
        entityType: AuditEntityType.MEDICATION,
        entityId: input.medicationCode,
        changes: JSON.stringify(input),
      });

      return {
        id: 'temp-id',
        interactingDrugCode: input.interactingDrugCode,
        interactingDrugName: input.interactingDrugCode,
        severity: input.severity,
        description: input.description,
        clinicalEffect: input.clinicalEffect,
        managementRecommendation: input.managementRecommendation,
      } as any;
    },

    async removeDrugInteraction(_parent, { id }, _context) {
      return true;
    },

    // Safety rules
    async createSafetyRule(_parent, { input }, _context) {
      const rule = await safetyRuleService.createSafetyRule({
        name: input.name,
        ruleType: input.ruleType as any,
        severity: input.severity as any,
        description: input.description,
        alertMessage: input.alertMessage,
        triggerConditions: input.triggerConditions,
        createdBy: 'system', // Would come from context in real implementation
      });

      await auditLogService.createAuditLog({
        action: AuditAction.CREATE,
        entityType: AuditEntityType.SAFETY_RULE,
        entityId: rule.id,
        changes: JSON.stringify(input),
      });

      return rule as any;
    },

    async updateSafetyRule(_parent, { id, input }, _context) {
      const rule = await safetyRuleService.updateSafetyRule(id, {
        name: input.name || undefined,
        severity: input.severity as any || undefined,
        description: input.description || undefined,
        alertMessage: input.alertMessage || undefined,
        triggerConditions: input.triggerConditions || undefined,
        isActive: input.isActive ?? undefined,
      });

      if (rule) {
        await auditLogService.createAuditLog({
          action: AuditAction.UPDATE,
          entityType: AuditEntityType.SAFETY_RULE,
          entityId: id,
          changes: JSON.stringify(input),
        });
      }

      return rule as any;
    },

    async deleteSafetyRule(_parent, { id }, _context) {
      const success = await safetyRuleService.deleteSafetyRule(id);

      if (success) {
        await auditLogService.createAuditLog({
          action: AuditAction.DELETE,
          entityType: AuditEntityType.SAFETY_RULE,
          entityId: id,
        });
      }

      return success;
    },

    async activateSafetyRule(_parent, { id }, _context) {
      const rule = await safetyRuleService.updateSafetyRule(id, { isActive: true });

      if (rule) {
        await auditLogService.createAuditLog({
          action: AuditAction.UPDATE,
          entityType: AuditEntityType.SAFETY_RULE,
          entityId: id,
          changes: JSON.stringify({ isActive: true }),
        });
      }

      return rule as any;
    },

    async deactivateSafetyRule(_parent, { id }, _context) {
      const rule = await safetyRuleService.updateSafetyRule(id, { isActive: false });

      if (rule) {
        await auditLogService.createAuditLog({
          action: AuditAction.UPDATE,
          entityType: AuditEntityType.SAFETY_RULE,
          entityId: id,
          changes: JSON.stringify({ isActive: false }),
        });
      }

      return rule as any;
    },

    async restoreSafetyRuleVersion(_parent, { id, historyId }, _context) {
      const rule = await safetyRuleService.restoreSafetyRuleVersion(id, historyId);

      if (rule) {
        await auditLogService.createAuditLog({
          action: AuditAction.UPDATE,
          entityType: AuditEntityType.SAFETY_RULE,
          entityId: id,
          changes: JSON.stringify({ action: 'RESTORE_VERSION', historyId }),
        });
      }

      return rule as any;
    },

    // Import jobs
    async createImportJob(_parent, { type, fileName }, _context) {
      const job = await importJobService.createImportJob({
        type: type as any,
        fileName,
        createdBy: 'system', // Would come from context in real implementation
      });

      await auditLogService.createAuditLog({
        action: AuditAction.IMPORT,
        entityType: AuditEntityType.IMPORT_JOB,
        entityId: job.id,
        changes: JSON.stringify({ type, fileName }),
      });

      return job as any;
    },

    async cancelImportJob(_parent, { id }, _context) {
      // Note: This would need implementation in the import job service
      const job = await importJobService.getImportJobById(id);

      if (job) {
        await auditLogService.createAuditLog({
          action: AuditAction.UPDATE,
          entityType: AuditEntityType.IMPORT_JOB,
          entityId: id,
          changes: JSON.stringify({ status: 'CANCELLED' }),
        });
      }

      return job as any;
    },

    // Audit logging
    async logAuditEvent(_parent, { action, entityType, entityId, changes }, _context) {
      return await auditLogService.createAuditLog({
        action: action as any,
        entityType: entityType as any,
        entityId,
        changes: changes || undefined,
      }) as any;
    },
  },
};
