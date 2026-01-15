import { Resolvers } from "../__generated__/resolvers-types";
import { carePlanService, carePlanTemplateService, CarePlanStatus, auditLogService, AuditAction, AuditEntityType } from "../services/database";
import { GraphQLError } from "graphql";

export const Mutation: Resolvers = {
  Mutation: {
    async createCarePlan(_parent, { input }, _context) {
      if (!input.patientId) {
        throw new GraphQLError("Patient ID is required.");
      }
      if (!input.title || input.title.trim() === "") {
        throw new GraphQLError("Title is required.");
      }
      if (!input.conditionCodes || input.conditionCodes.length === 0) {
        throw new GraphQLError("At least one condition code is required.");
      }
      if (!input.startDate) {
        throw new GraphQLError("Start date is required.");
      }

      try {
        const carePlan = await carePlanService.createCarePlan({
          patientId: input.patientId,
          title: input.title,
          conditionCodes: input.conditionCodes,
          startDate: new Date(input.startDate),
          targetEndDate: input.targetEndDate ? new Date(input.targetEndDate) : undefined,
          templateId: input.templateId || undefined,
          sourceTranscriptionId: input.sourceTranscriptionId || undefined,
          sourceRAGSynthesisId: input.sourceRAGSynthesisId || undefined,
          createdBy: 'system', // TODO: Get from auth context
        });

        // Log audit event
        await auditLogService.createAuditLog({
          action: AuditAction.CREATE,
          entityType: AuditEntityType.CARE_PLAN,
          entityId: carePlan.id,
          changes: JSON.stringify({ title: carePlan.title, patientId: carePlan.patientId }),
        });

        return {
          ...carePlan,
          patient: { __typename: 'Patient' as const, id: carePlan.patientId },
          goals: [] as any[],
          interventions: [] as any[],
        } as any;
      } catch (error: any) {
        throw new GraphQLError("Failed to create care plan.");
      }
    },

    async createCarePlanFromTemplate(_parent, { patientId, templateId, startDate }, _context) {
      if (!patientId) {
        throw new GraphQLError("Patient ID is required.");
      }
      if (!templateId) {
        throw new GraphQLError("Template ID is required.");
      }
      if (!startDate) {
        throw new GraphQLError("Start date is required.");
      }

      try {
        const template = await carePlanTemplateService.getTemplateById(templateId);
        if (!template) {
          throw new GraphQLError("Template not found.");
        }

        const carePlan = await carePlanService.createCarePlan({
          patientId,
          title: template.name,
          conditionCodes: template.conditionCodes,
          startDate: new Date(startDate),
          templateId,
          createdBy: 'system', // TODO: Get from auth context
        });

        // TODO: Copy goals and interventions from template

        return {
          ...carePlan,
          patient: { __typename: 'Patient' as const, id: carePlan.patientId },
          goals: [] as any[],
          interventions: [] as any[],
        } as any;
      } catch (error: any) {
        if (error.extensions?.code === 'NOT_FOUND') {
          throw error;
        }
        throw new GraphQLError("Failed to create care plan from template.");
      }
    },

    async updateCarePlanStatus(_parent, { id, status }, _context) {
      if (!id) {
        throw new GraphQLError("Care plan ID is required.");
      }
      if (!status) {
        throw new GraphQLError("Status is required.");
      }

      try {
        const carePlan = await carePlanService.updateCarePlanStatus(id, status as any);
        if (!carePlan) {
          throw new GraphQLError("Care plan not found.");
        }

        const goals = await carePlanService.getGoalsForCarePlan(id);
        const interventions = await carePlanService.getInterventionsForCarePlan(id);

        return {
          ...carePlan,
          patient: { __typename: 'Patient' as const, id: carePlan.patientId },
          goals: goals.map(g => ({ ...g, progressNotes: [] as any[] })),
          interventions,
        } as any;
      } catch (error: any) {
        if (error.extensions?.code === 'NOT_FOUND') {
          throw error;
        }
        throw new GraphQLError("Failed to update care plan status.");
      }
    },

    async addGoal(_parent, { input }, _context) {
      if (!input.carePlanId) {
        throw new GraphQLError("Care plan ID is required.");
      }
      if (!input.description || input.description.trim() === "") {
        throw new GraphQLError("Goal description is required.");
      }
      if (!input.priority) {
        throw new GraphQLError("Priority is required.");
      }

      try {
        const goal = await carePlanService.addGoal({
          carePlanId: input.carePlanId,
          description: input.description,
          targetValue: input.targetValue || undefined,
          targetDate: input.targetDate ? new Date(input.targetDate) : undefined,
          priority: input.priority as any,
          guidelineReference: input.guidelineReference || undefined,
        });

        return {
          ...goal,
          progressNotes: [] as any[],
        } as any;
      } catch (error: any) {
        throw new GraphQLError("Failed to add goal.");
      }
    },

    async addIntervention(_parent, { input }, _context) {
      if (!input.carePlanId) {
        throw new GraphQLError("Care plan ID is required.");
      }
      if (!input.type) {
        throw new GraphQLError("Intervention type is required.");
      }
      if (!input.description || input.description.trim() === "") {
        throw new GraphQLError("Intervention description is required.");
      }

      try {
        const intervention = await carePlanService.addIntervention({
          carePlanId: input.carePlanId,
          type: input.type as any,
          description: input.description,
          medicationCode: input.medicationCode || undefined,
          dosage: input.dosage || undefined,
          frequency: input.frequency || undefined,
          procedureCode: input.procedureCode || undefined,
          referralSpecialty: input.referralSpecialty || undefined,
          scheduledDate: input.scheduledDate ? new Date(input.scheduledDate) : undefined,
          patientInstructions: input.patientInstructions || undefined,
          guidelineReference: input.guidelineReference || undefined,
        });

        return intervention as any;
      } catch (error: any) {
        throw new GraphQLError("Failed to add intervention.");
      }
    },

    async updateGoalStatus(_parent, { input }, _context) {
      // Stub - would update goal in DB
      throw new GraphQLError("Not implemented.");
    },

    async updateInterventionStatus(_parent, { input }, _context) {
      // Stub - would update intervention in DB
      throw new GraphQLError("Not implemented.");
    },

    async linkGoalToInterventions(_parent, { goalId, interventionIds }, _context) {
      // Stub - would link goal to interventions in DB
      throw new GraphQLError("Not implemented.");
    },

    async submitCarePlanForReview(_parent, { id }, _context) {
      const carePlan = await carePlanService.updateCarePlanStatus(id, CarePlanStatus.PENDING_REVIEW);
      if (!carePlan) {
        throw new GraphQLError("Care plan not found.");
      }
      const goals = await carePlanService.getGoalsForCarePlan(id);
      const interventions = await carePlanService.getInterventionsForCarePlan(id);
      return {
        ...carePlan,
        patient: { __typename: 'Patient' as const, id: carePlan.patientId },
        goals: goals.map(g => ({ ...g, progressNotes: [] as any[] })),
        interventions,
      } as any;
    },

    async approveCarePlan(_parent, { id }, _context) {
      const carePlan = await carePlanService.updateCarePlanStatus(id, CarePlanStatus.ACTIVE);
      if (!carePlan) {
        throw new GraphQLError("Care plan not found.");
      }
      const goals = await carePlanService.getGoalsForCarePlan(id);
      const interventions = await carePlanService.getInterventionsForCarePlan(id);
      return {
        ...carePlan,
        patient: { __typename: 'Patient' as const, id: carePlan.patientId },
        goals: goals.map(g => ({ ...g, progressNotes: [] as any[] })),
        interventions,
      } as any;
    },

    // ==========================================================================
    // TEMPLATE CRUD MUTATIONS
    // ==========================================================================

    async createCarePlanTemplate(_parent, { input }, _context) {
      if (!input.name || input.name.trim() === "") {
        throw new GraphQLError("Template name is required.");
      }
      if (!input.category) {
        throw new GraphQLError("Category is required.");
      }
      if (!input.conditionCodes || input.conditionCodes.length === 0) {
        throw new GraphQLError("At least one condition code is required.");
      }

      try {
        const template = await carePlanTemplateService.createTemplate({
          name: input.name,
          description: input.description || undefined,
          category: input.category as any,
          conditionCodes: input.conditionCodes,
          guidelineSource: input.guidelineSource || undefined,
          evidenceGrade: input.evidenceGrade || undefined,
          goals: input.goals?.map(g => ({
            description: g.description,
            defaultTargetValue: g.defaultTargetValue || undefined,
            defaultTargetDays: g.defaultTargetDays || undefined,
            priority: g.priority as any,
          })),
          interventions: input.interventions?.map(i => ({
            type: i.type as any,
            description: i.description,
            medicationCode: i.medicationCode || undefined,
            procedureCode: i.procedureCode || undefined,
            defaultScheduleDays: i.defaultScheduleDays || undefined,
          })),
        });

        const goals = await carePlanTemplateService.getGoalsForTemplate(template.id);
        const interventions = await carePlanTemplateService.getInterventionsForTemplate(template.id);

        // Log audit event
        await auditLogService.createAuditLog({
          action: AuditAction.CREATE,
          entityType: AuditEntityType.CARE_PLAN_TEMPLATE,
          entityId: template.id,
          changes: JSON.stringify({ name: template.name, category: template.category }),
        });

        return {
          ...template,
          defaultGoals: goals.map(g => ({
            description: g.description,
            defaultTargetValue: g.defaultTargetValue,
            defaultTargetDays: g.defaultTargetDays,
            priority: g.priority,
          })),
          defaultInterventions: interventions.map(i => ({
            type: i.type,
            description: i.description,
            medicationCode: i.medicationCode,
            procedureCode: i.procedureCode,
            defaultScheduleDays: i.defaultScheduleDays,
          })),
        } as any;
      } catch (error: any) {
        throw new GraphQLError("Failed to create template.");
      }
    },

    async updateCarePlanTemplate(_parent, { id, input }, _context) {
      try {
        const template = await carePlanTemplateService.updateTemplate(id, {
          name: input.name || undefined,
          description: input.description || undefined,
          category: input.category as any || undefined,
          conditionCodes: input.conditionCodes || undefined,
          guidelineSource: input.guidelineSource || undefined,
          evidenceGrade: input.evidenceGrade || undefined,
          isActive: input.isActive ?? undefined,
        });

        if (!template) {
          throw new GraphQLError("Template not found.");
        }

        const goals = await carePlanTemplateService.getGoalsForTemplate(template.id);
        const interventions = await carePlanTemplateService.getInterventionsForTemplate(template.id);

        // Log audit event
        await auditLogService.createAuditLog({
          action: AuditAction.UPDATE,
          entityType: AuditEntityType.CARE_PLAN_TEMPLATE,
          entityId: template.id,
          changes: JSON.stringify(input),
        });

        return {
          ...template,
          defaultGoals: goals.map(g => ({
            description: g.description,
            defaultTargetValue: g.defaultTargetValue,
            defaultTargetDays: g.defaultTargetDays,
            priority: g.priority,
          })),
          defaultInterventions: interventions.map(i => ({
            type: i.type,
            description: i.description,
            medicationCode: i.medicationCode,
            procedureCode: i.procedureCode,
            defaultScheduleDays: i.defaultScheduleDays,
          })),
        } as any;
      } catch (error: any) {
        if (error.extensions?.code === 'NOT_FOUND') {
          throw error;
        }
        throw new GraphQLError("Failed to update template.");
      }
    },

    async deleteCarePlanTemplate(_parent, { id }, _context) {
      const result = await carePlanTemplateService.deleteTemplate(id);

      if (result) {
        // Log audit event
        await auditLogService.createAuditLog({
          action: AuditAction.DELETE,
          entityType: AuditEntityType.CARE_PLAN_TEMPLATE,
          entityId: id,
        });
      }

      return result;
    },

    // ==========================================================================
    // TRAINING CARE PLAN MUTATIONS
    // ==========================================================================

    async createTrainingCarePlan(_parent, { input }, _context) {
      if (!input.title || input.title.trim() === "") {
        throw new GraphQLError("Title is required.");
      }
      if (!input.conditionCodes || input.conditionCodes.length === 0) {
        throw new GraphQLError("At least one condition code is required.");
      }
      if (!input.startDate) {
        throw new GraphQLError("Start date is required.");
      }

      try {
        const carePlan = await carePlanService.createTrainingCarePlan({
          title: input.title,
          conditionCodes: input.conditionCodes,
          trainingDescription: input.trainingDescription || undefined,
          trainingTags: input.trainingTags || undefined,
          startDate: new Date(input.startDate),
          targetEndDate: input.targetEndDate ? new Date(input.targetEndDate) : undefined,
        });

        // Add goals if provided
        if (input.goals && input.goals.length > 0) {
          for (const goal of input.goals) {
            await carePlanService.addGoal({
              carePlanId: carePlan.id,
              description: goal.description,
              targetValue: goal.targetValue || undefined,
              targetDate: goal.targetDate ? new Date(goal.targetDate) : undefined,
              priority: goal.priority as any,
              guidelineReference: goal.guidelineReference || undefined,
            });
          }
        }

        // Add interventions if provided
        if (input.interventions && input.interventions.length > 0) {
          for (const intervention of input.interventions) {
            await carePlanService.addIntervention({
              carePlanId: carePlan.id,
              type: intervention.type as any,
              description: intervention.description,
              medicationCode: intervention.medicationCode || undefined,
              dosage: intervention.dosage || undefined,
              frequency: intervention.frequency || undefined,
              procedureCode: intervention.procedureCode || undefined,
              referralSpecialty: intervention.referralSpecialty || undefined,
              scheduledDate: intervention.scheduledDate ? new Date(intervention.scheduledDate) : undefined,
              patientInstructions: intervention.patientInstructions || undefined,
              guidelineReference: intervention.guidelineReference || undefined,
            });
          }
        }

        const goals = await carePlanService.getGoalsForCarePlan(carePlan.id);
        const interventions = await carePlanService.getInterventionsForCarePlan(carePlan.id);

        return {
          ...carePlan,
          patient: null,
          isTrainingExample: true,
          goals: goals.map(g => ({ ...g, progressNotes: [] as any[] })),
          interventions,
        } as any;
      } catch (error: any) {
        throw new GraphQLError("Failed to create training care plan.");
      }
    },

    async updateTrainingCarePlan(_parent, { id, input }, _context) {
      try {
        const carePlan = await carePlanService.updateTrainingCarePlan(id, {
          title: input.title || undefined,
          conditionCodes: input.conditionCodes || undefined,
          trainingDescription: input.trainingDescription || undefined,
          trainingTags: input.trainingTags || undefined,
          startDate: input.startDate ? new Date(input.startDate) : undefined,
          targetEndDate: input.targetEndDate ? new Date(input.targetEndDate) : undefined,
          status: input.status as any || undefined,
        });

        if (!carePlan) {
          throw new GraphQLError("Training care plan not found.");
        }

        const goals = await carePlanService.getGoalsForCarePlan(carePlan.id);
        const interventions = await carePlanService.getInterventionsForCarePlan(carePlan.id);

        return {
          ...carePlan,
          patient: null,
          isTrainingExample: true,
          goals: goals.map(g => ({ ...g, progressNotes: [] as any[] })),
          interventions,
        } as any;
      } catch (error: any) {
        if (error.extensions?.code === 'NOT_FOUND') {
          throw error;
        }
        throw new GraphQLError("Failed to update training care plan.");
      }
    },

    async deleteTrainingCarePlan(_parent, { id }, _context) {
      const result = await carePlanService.deleteTrainingCarePlan(id);
      return result;
    },

    async addTrainingGoal(_parent, { carePlanId, input }, _context) {
      if (!carePlanId) {
        throw new GraphQLError("Care plan ID is required.");
      }
      if (!input.description || input.description.trim() === "") {
        throw new GraphQLError("Goal description is required.");
      }

      try {
        await carePlanService.addGoal({
          carePlanId,
          description: input.description,
          targetValue: input.targetValue || undefined,
          targetDate: input.targetDate ? new Date(input.targetDate) : undefined,
          priority: input.priority as any,
          guidelineReference: input.guidelineReference || undefined,
        });

        const carePlan = await carePlanService.getTrainingCarePlanById(carePlanId);
        if (!carePlan) {
          throw new GraphQLError("Training care plan not found.");
        }

        const goals = await carePlanService.getGoalsForCarePlan(carePlanId);
        const interventions = await carePlanService.getInterventionsForCarePlan(carePlanId);

        return {
          ...carePlan,
          patient: null,
          isTrainingExample: true,
          goals: goals.map(g => ({ ...g, progressNotes: [] as any[] })),
          interventions,
        } as any;
      } catch (error: any) {
        throw new GraphQLError("Failed to add training goal.");
      }
    },

    async removeTrainingGoal(_parent, { goalId }, _context) {
      const result = await carePlanService.deleteGoal(goalId);
      return result;
    },

    async addTrainingIntervention(_parent, { carePlanId, input }, _context) {
      if (!carePlanId) {
        throw new GraphQLError("Care plan ID is required.");
      }
      if (!input.type) {
        throw new GraphQLError("Intervention type is required.");
      }
      if (!input.description || input.description.trim() === "") {
        throw new GraphQLError("Intervention description is required.");
      }

      try {
        await carePlanService.addIntervention({
          carePlanId,
          type: input.type as any,
          description: input.description,
          medicationCode: input.medicationCode || undefined,
          dosage: input.dosage || undefined,
          frequency: input.frequency || undefined,
          procedureCode: input.procedureCode || undefined,
          referralSpecialty: input.referralSpecialty || undefined,
          scheduledDate: input.scheduledDate ? new Date(input.scheduledDate) : undefined,
          patientInstructions: input.patientInstructions || undefined,
          guidelineReference: input.guidelineReference || undefined,
        });

        const carePlan = await carePlanService.getTrainingCarePlanById(carePlanId);
        if (!carePlan) {
          throw new GraphQLError("Training care plan not found.");
        }

        const goals = await carePlanService.getGoalsForCarePlan(carePlanId);
        const interventions = await carePlanService.getInterventionsForCarePlan(carePlanId);

        return {
          ...carePlan,
          patient: null,
          isTrainingExample: true,
          goals: goals.map(g => ({ ...g, progressNotes: [] as any[] })),
          interventions,
        } as any;
      } catch (error: any) {
        throw new GraphQLError("Failed to add training intervention.");
      }
    },

    async removeTrainingIntervention(_parent, { interventionId }, _context) {
      const result = await carePlanService.deleteIntervention(interventionId);
      return result;
    },

    // ==========================================================================
    // PDF IMPORT MUTATIONS
    // ==========================================================================

    async importCarePlanFromPdf(_parent, { input }, _context) {
      if (!input.title || input.title.trim() === "") {
        throw new GraphQLError("Title is required.");
      }
      if (!input.conditionCodes || input.conditionCodes.length === 0) {
        throw new GraphQLError("At least one condition code is required.");
      }
      if (!input.createTemplate && !input.createTrainingExample) {
        throw new GraphQLError("At least one of createTemplate or createTrainingExample must be true.");
      }

      let createdTemplate = null;
      let createdTrainingExample = null;
      let embeddingGenerated = false;

      try {
        // Create template if requested
        if (input.createTemplate) {
          const template = await carePlanTemplateService.createTemplate({
            name: input.title,
            description: input.description || undefined,
            category: input.category as any,
            conditionCodes: input.conditionCodes,
            goals: input.goals?.map(g => ({
              description: g.description,
              defaultTargetValue: g.defaultTargetValue || undefined,
              defaultTargetDays: g.defaultTargetDays || undefined,
              priority: g.priority as any,
            })),
            interventions: input.interventions?.map(i => ({
              type: i.type as any,
              description: i.description,
              medicationCode: i.medicationCode || undefined,
              procedureCode: i.procedureCode || undefined,
              defaultScheduleDays: i.defaultScheduleDays || undefined,
            })),
          });

          const goals = await carePlanTemplateService.getGoalsForTemplate(template.id);
          const interventions = await carePlanTemplateService.getInterventionsForTemplate(template.id);

          createdTemplate = {
            ...template,
            defaultGoals: goals.map(g => ({
              description: g.description,
              defaultTargetValue: g.defaultTargetValue,
              defaultTargetDays: g.defaultTargetDays,
              priority: g.priority,
            })),
            defaultInterventions: interventions.map(i => ({
              type: i.type,
              description: i.description,
              medicationCode: i.medicationCode,
              procedureCode: i.procedureCode,
              defaultScheduleDays: i.defaultScheduleDays,
            })),
          };
        }

        // Create training example if requested
        if (input.createTrainingExample) {
          const carePlan = await carePlanService.createTrainingCarePlan({
            title: input.title,
            conditionCodes: input.conditionCodes,
            trainingDescription: input.trainingDescription || input.rawText?.substring(0, 1000) || undefined,
            trainingTags: input.trainingTags || undefined,
            startDate: new Date(),
            templateId: createdTemplate?.id || undefined,
          });

          // Add goals if provided
          if (input.goals && input.goals.length > 0) {
            for (const goal of input.goals) {
              await carePlanService.addGoal({
                carePlanId: carePlan.id,
                description: goal.description,
                targetValue: goal.defaultTargetValue || undefined,
                priority: goal.priority as any,
              });
            }
          }

          // Add interventions if provided
          if (input.interventions && input.interventions.length > 0) {
            for (const intervention of input.interventions) {
              await carePlanService.addIntervention({
                carePlanId: carePlan.id,
                type: intervention.type as any,
                description: intervention.description,
                medicationCode: intervention.medicationCode || undefined,
                procedureCode: intervention.procedureCode || undefined,
              });
            }
          }

          // Try to generate embedding for the training example
          try {
            const embeddingsUrl = process.env.ML_EMBEDDINGS_URL || 'http://rag-embeddings:8080';

            // Build embedding text
            const embeddingParts = [
              `Care Plan: ${input.title}`,
              `Conditions: ${input.conditionCodes.join(', ')}`,
            ];
            if (input.trainingDescription) {
              embeddingParts.push(input.trainingDescription);
            }
            if (input.goals && input.goals.length > 0) {
              const goalsText = input.goals.map(g => g.description).join('; ');
              embeddingParts.push(`Goals: ${goalsText}`);
            }
            if (input.interventions && input.interventions.length > 0) {
              const interventionsText = input.interventions.map(i => i.description).join('; ');
              embeddingParts.push(`Interventions: ${interventionsText}`);
            }
            const embeddingText = embeddingParts.join('. ');

            const embeddingResponse = await fetch(`${embeddingsUrl}/embeddings/raw`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ text: embeddingText }),
            });

            if (embeddingResponse.ok) {
              const embeddingData = await embeddingResponse.json();
              // Update the care plan with the embedding
              await carePlanService.updateCarePlanEmbedding(carePlan.id, embeddingData.embedding);
              embeddingGenerated = true;
            }
          } catch (embeddingError) {
            console.error('Failed to generate embedding:', embeddingError);
            // Continue without embedding - it can be generated later
          }

          const goals = await carePlanService.getGoalsForCarePlan(carePlan.id);
          const interventions = await carePlanService.getInterventionsForCarePlan(carePlan.id);

          createdTrainingExample = {
            ...carePlan,
            patient: null,
            isTrainingExample: true,
            goals: goals.map(g => ({ ...g, progressNotes: [] as any[] })),
            interventions,
          };
        }

        // Log audit events for import
        if (createdTemplate) {
          await auditLogService.createAuditLog({
            action: AuditAction.IMPORT,
            entityType: AuditEntityType.CARE_PLAN_TEMPLATE,
            entityId: createdTemplate.id,
            changes: JSON.stringify({ title: input.title, source: 'PDF Import' }),
          });
        }
        if (createdTrainingExample) {
          await auditLogService.createAuditLog({
            action: AuditAction.IMPORT,
            entityType: AuditEntityType.TRAINING_EXAMPLE,
            entityId: createdTrainingExample.id,
            changes: JSON.stringify({ title: input.title, source: 'PDF Import' }),
          });
        }

        return {
          template: createdTemplate,
          trainingExample: createdTrainingExample,
          embeddingGenerated,
        } as any;
      } catch (error: any) {
        console.error('Failed to import care plan from PDF:', error);
        throw new GraphQLError("Failed to import care plan from PDF: " + (error.message || 'Unknown error'));
      }
    },
  },
};
