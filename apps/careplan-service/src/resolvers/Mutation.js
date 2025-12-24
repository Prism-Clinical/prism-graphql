"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Mutation = void 0;
const database_1 = require("@careplan/services/database");
const apollo_server_errors_1 = require("apollo-server-errors");
exports.Mutation = {
    Mutation: {
        async createCarePlan(_parent, { input }, _context) {
            if (!input.patientId) {
                throw new apollo_server_errors_1.ApolloError("Patient ID is required.", "BAD_USER_INPUT");
            }
            if (!input.title || input.title.trim() === "") {
                throw new apollo_server_errors_1.ApolloError("Title is required.", "BAD_USER_INPUT");
            }
            if (!input.conditionCodes || input.conditionCodes.length === 0) {
                throw new apollo_server_errors_1.ApolloError("At least one condition code is required.", "BAD_USER_INPUT");
            }
            if (!input.startDate) {
                throw new apollo_server_errors_1.ApolloError("Start date is required.", "BAD_USER_INPUT");
            }
            try {
                const carePlan = await database_1.carePlanService.createCarePlan({
                    patientId: input.patientId,
                    title: input.title,
                    conditionCodes: input.conditionCodes,
                    startDate: new Date(input.startDate),
                    targetEndDate: input.targetEndDate ? new Date(input.targetEndDate) : undefined,
                    templateId: input.templateId || undefined,
                    sourceTranscriptionId: input.sourceTranscriptionId || undefined,
                    sourceRAGSynthesisId: input.sourceRAGSynthesisId || undefined,
                    createdBy: 'system',
                });
                return {
                    ...carePlan,
                    patient: { __typename: 'Patient', id: carePlan.patientId },
                    goals: [],
                    interventions: [],
                };
            }
            catch (error) {
                throw new apollo_server_errors_1.ApolloError("Failed to create care plan.", "INTERNAL_ERROR");
            }
        },
        async createCarePlanFromTemplate(_parent, { patientId, templateId, startDate }, _context) {
            if (!patientId) {
                throw new apollo_server_errors_1.ApolloError("Patient ID is required.", "BAD_USER_INPUT");
            }
            if (!templateId) {
                throw new apollo_server_errors_1.ApolloError("Template ID is required.", "BAD_USER_INPUT");
            }
            if (!startDate) {
                throw new apollo_server_errors_1.ApolloError("Start date is required.", "BAD_USER_INPUT");
            }
            try {
                const template = await database_1.carePlanTemplateService.getTemplateById(templateId);
                if (!template) {
                    throw new apollo_server_errors_1.ApolloError("Template not found.", "NOT_FOUND");
                }
                const carePlan = await database_1.carePlanService.createCarePlan({
                    patientId,
                    title: template.name,
                    conditionCodes: template.conditionCodes,
                    startDate: new Date(startDate),
                    templateId,
                    createdBy: 'system',
                });
                return {
                    ...carePlan,
                    patient: { __typename: 'Patient', id: carePlan.patientId },
                    goals: [],
                    interventions: [],
                };
            }
            catch (error) {
                if (error.extensions?.code === 'NOT_FOUND') {
                    throw error;
                }
                throw new apollo_server_errors_1.ApolloError("Failed to create care plan from template.", "INTERNAL_ERROR");
            }
        },
        async updateCarePlanStatus(_parent, { id, status }, _context) {
            if (!id) {
                throw new apollo_server_errors_1.ApolloError("Care plan ID is required.", "BAD_USER_INPUT");
            }
            if (!status) {
                throw new apollo_server_errors_1.ApolloError("Status is required.", "BAD_USER_INPUT");
            }
            try {
                const carePlan = await database_1.carePlanService.updateCarePlanStatus(id, status);
                if (!carePlan) {
                    throw new apollo_server_errors_1.ApolloError("Care plan not found.", "NOT_FOUND");
                }
                const goals = await database_1.carePlanService.getGoalsForCarePlan(id);
                const interventions = await database_1.carePlanService.getInterventionsForCarePlan(id);
                return {
                    ...carePlan,
                    patient: { __typename: 'Patient', id: carePlan.patientId },
                    goals: goals.map(g => ({ ...g, progressNotes: [] })),
                    interventions,
                };
            }
            catch (error) {
                if (error.extensions?.code === 'NOT_FOUND') {
                    throw error;
                }
                throw new apollo_server_errors_1.ApolloError("Failed to update care plan status.", "INTERNAL_ERROR");
            }
        },
        async addGoal(_parent, { input }, _context) {
            if (!input.carePlanId) {
                throw new apollo_server_errors_1.ApolloError("Care plan ID is required.", "BAD_USER_INPUT");
            }
            if (!input.description || input.description.trim() === "") {
                throw new apollo_server_errors_1.ApolloError("Goal description is required.", "BAD_USER_INPUT");
            }
            if (!input.priority) {
                throw new apollo_server_errors_1.ApolloError("Priority is required.", "BAD_USER_INPUT");
            }
            try {
                const goal = await database_1.carePlanService.addGoal({
                    carePlanId: input.carePlanId,
                    description: input.description,
                    targetValue: input.targetValue || undefined,
                    targetDate: input.targetDate ? new Date(input.targetDate) : undefined,
                    priority: input.priority,
                    guidelineReference: input.guidelineReference || undefined,
                });
                return {
                    ...goal,
                    progressNotes: [],
                };
            }
            catch (error) {
                throw new apollo_server_errors_1.ApolloError("Failed to add goal.", "INTERNAL_ERROR");
            }
        },
        async addIntervention(_parent, { input }, _context) {
            if (!input.carePlanId) {
                throw new apollo_server_errors_1.ApolloError("Care plan ID is required.", "BAD_USER_INPUT");
            }
            if (!input.type) {
                throw new apollo_server_errors_1.ApolloError("Intervention type is required.", "BAD_USER_INPUT");
            }
            if (!input.description || input.description.trim() === "") {
                throw new apollo_server_errors_1.ApolloError("Intervention description is required.", "BAD_USER_INPUT");
            }
            try {
                const intervention = await database_1.carePlanService.addIntervention({
                    carePlanId: input.carePlanId,
                    type: input.type,
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
                return intervention;
            }
            catch (error) {
                throw new apollo_server_errors_1.ApolloError("Failed to add intervention.", "INTERNAL_ERROR");
            }
        },
        async updateGoalStatus(_parent, { input }, _context) {
            throw new apollo_server_errors_1.ApolloError("Not implemented.", "NOT_IMPLEMENTED");
        },
        async updateInterventionStatus(_parent, { input }, _context) {
            throw new apollo_server_errors_1.ApolloError("Not implemented.", "NOT_IMPLEMENTED");
        },
        async linkGoalToInterventions(_parent, { goalId, interventionIds }, _context) {
            throw new apollo_server_errors_1.ApolloError("Not implemented.", "NOT_IMPLEMENTED");
        },
        async submitCarePlanForReview(_parent, { id }, _context) {
            return await exports.Mutation.Mutation.updateCarePlanStatus(_parent, { id, status: database_1.CarePlanStatus.PENDING_REVIEW }, _context);
        },
        async approveCarePlan(_parent, { id }, _context) {
            return await exports.Mutation.Mutation.updateCarePlanStatus(_parent, { id, status: database_1.CarePlanStatus.ACTIVE }, _context);
        },
    },
};
//# sourceMappingURL=Mutation.js.map