import { Resolvers } from "../__generated__/resolvers-types";
import { carePlanService, carePlanTemplateService, CarePlanStatus } from "../services/database";
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
  },
};
