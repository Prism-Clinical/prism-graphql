"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Mutation = void 0;
const resolvers_types_1 = require("@patients/__generated__/resolvers-types");
const database_1 = require("@patients/services/database");
const apollo_server_errors_1 = require("apollo-server-errors");
function convertToGraphQLPatient(dbPatient) {
    return {
        ...dbPatient,
        mrn: dbPatient.medicalRecordNumber,
        gender: dbPatient.gender ? dbPatient.gender.toUpperCase() : resolvers_types_1.Gender.Unknown,
        cases: []
    };
}
exports.Mutation = {
    Mutation: {
        async createPatient(_parent, { input }, _context) {
            try {
                if (!input.mrn || input.mrn.trim() === "") {
                    throw new apollo_server_errors_1.ApolloError("Medical Record Number (MRN) is required.", "BAD_USER_INPUT");
                }
                if (!input.firstName || input.firstName.trim() === "") {
                    throw new apollo_server_errors_1.ApolloError("First name is required.", "BAD_USER_INPUT");
                }
                if (!input.lastName || input.lastName.trim() === "") {
                    throw new apollo_server_errors_1.ApolloError("Last name is required.", "BAD_USER_INPUT");
                }
                if (!input.dateOfBirth) {
                    throw new apollo_server_errors_1.ApolloError("Date of birth is required.", "BAD_USER_INPUT");
                }
                const patientData = {
                    firstName: input.firstName,
                    lastName: input.lastName,
                    dateOfBirth: input.dateOfBirth,
                    gender: input.gender?.toLowerCase() || undefined,
                    email: input.email || undefined,
                    phone: input.phone || undefined,
                    address: input.address || undefined,
                    medicalRecordNumber: input.mrn,
                    epicPatientId: undefined,
                    emergencyContact: undefined,
                    insuranceInfo: undefined
                };
                const newPatient = await database_1.patientService.createPatient(patientData);
                return convertToGraphQLPatient(newPatient);
            }
            catch (error) {
                console.error('Error creating patient:', error);
                if (error instanceof apollo_server_errors_1.ApolloError) {
                    throw error;
                }
                throw new apollo_server_errors_1.ApolloError("Failed to create patient.", "INTERNAL_ERROR");
            }
        },
        async updatePatient(_parent, { id, input }, _context) {
            try {
                const updates = {};
                if (input.firstName !== undefined)
                    updates.firstName = input.firstName;
                if (input.lastName !== undefined)
                    updates.lastName = input.lastName;
                if (input.email !== undefined)
                    updates.email = input.email;
                if (input.phone !== undefined)
                    updates.phone = input.phone;
                if (input.address !== undefined)
                    updates.address = input.address;
                const updatedPatient = await database_1.patientService.updatePatient(id, updates);
                if (!updatedPatient) {
                    throw new apollo_server_errors_1.ApolloError("Patient not found.", "NOT_FOUND");
                }
                return convertToGraphQLPatient(updatedPatient);
            }
            catch (error) {
                console.error('Error updating patient:', error);
                if (error instanceof apollo_server_errors_1.ApolloError) {
                    throw error;
                }
                throw new apollo_server_errors_1.ApolloError("Failed to update patient.", "INTERNAL_ERROR");
            }
        },
        createCase(_parent, { input }, _context) {
            const newCase = {
                id: `case-${Date.now()}`,
                patientId: input.patientId,
                title: input.title,
                description: input.description,
                status: resolvers_types_1.CaseStatus.Open,
                priority: input.priority,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                closedAt: null
            };
            return newCase;
        },
        updateCase(_parent, { id, input }, _context) {
            return {
                id,
                patientId: "patient-1",
                title: input.title || "Updated Case",
                description: input.description,
                status: input.status || resolvers_types_1.CaseStatus.Open,
                priority: input.priority || resolvers_types_1.CasePriority.Medium,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                closedAt: null
            };
        },
        closeCase(_parent, { id }, _context) {
            return {
                id,
                patientId: "patient-1",
                title: "Closed Case",
                description: "This case has been closed",
                status: resolvers_types_1.CaseStatus.Closed,
                priority: resolvers_types_1.CasePriority.Medium,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                closedAt: new Date().toISOString()
            };
        },
    },
};
//# sourceMappingURL=Mutation.js.map