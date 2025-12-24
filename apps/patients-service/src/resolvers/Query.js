"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Query = void 0;
const resolvers_types_1 = require("@patients/__generated__/resolvers-types");
const database_1 = require("@patients/services/database");
function convertToGraphQLPatient(dbPatient) {
    return {
        ...dbPatient,
        mrn: dbPatient.medicalRecordNumber,
        gender: dbPatient.gender ? dbPatient.gender.toUpperCase() : resolvers_types_1.Gender.Unknown,
        cases: []
    };
}
exports.Query = {
    Query: {
        async patient(_parent, { id }, _context) {
            try {
                const patient = await database_1.patientService.getPatientById(id);
                return patient ? convertToGraphQLPatient(patient) : null;
            }
            catch (error) {
                console.error('Error fetching patient:', error);
                return null;
            }
        },
        async patientByMrn(_parent, { mrn }, _context) {
            try {
                const patients = await database_1.patientService.getAllPatients(1000, 0);
                const patient = patients.find((p) => p.medicalRecordNumber === mrn);
                return patient ? convertToGraphQLPatient(patient) : null;
            }
            catch (error) {
                console.error('Error fetching patient by MRN:', error);
                return null;
            }
        },
        async patients(_parent, { limit = 50, offset = 0 }, _context) {
            try {
                const patients = await database_1.patientService.getAllPatients(limit, offset);
                return patients.map(convertToGraphQLPatient);
            }
            catch (error) {
                console.error('Error fetching patients:', error);
                return [];
            }
        },
        case(_parent, { id }, _context) {
            if (id === "case-1") {
                return {
                    id: "case-1",
                    patientId: "patient-1",
                    title: "Annual Physical Case",
                    description: "Annual physical examination case",
                    status: resolvers_types_1.CaseStatus.Open,
                    priority: resolvers_types_1.CasePriority.Medium,
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString(),
                    closedAt: null
                };
            }
            return null;
        },
        casesForPatient(_parent, { patientId }, _context) {
            if (patientId === "patient-1") {
                return [{
                        id: "case-1",
                        patientId: "patient-1",
                        title: "Annual Physical Case",
                        description: "Annual physical examination case",
                        status: resolvers_types_1.CaseStatus.Open,
                        priority: resolvers_types_1.CasePriority.Medium,
                        createdAt: new Date().toISOString(),
                        updatedAt: new Date().toISOString(),
                        closedAt: null
                    }];
            }
            return [];
        },
        casesByStatus(_parent, { status }, _context) {
            return [{
                    id: "case-1",
                    patientId: "patient-1",
                    title: "Annual Physical Case",
                    description: "Annual physical examination case",
                    status: status,
                    priority: resolvers_types_1.CasePriority.Medium,
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString(),
                    closedAt: null
                }];
        },
    },
    Patient: {
        async __resolveReference(reference) {
            try {
                const patient = await database_1.patientService.getPatientById(reference.id);
                return patient ? convertToGraphQLPatient(patient) : null;
            }
            catch (error) {
                console.error('Error resolving patient reference:', error);
                return null;
            }
        },
        cases(parent) {
            if (parent.id === "patient-1") {
                return [{
                        id: "case-1",
                        patientId: parent.id,
                        title: "Annual Physical Case",
                        description: "Annual physical examination case",
                        status: resolvers_types_1.CaseStatus.Open,
                        priority: resolvers_types_1.CasePriority.Medium,
                        createdAt: new Date().toISOString(),
                        updatedAt: new Date().toISOString(),
                        closedAt: null
                    }];
            }
            return [];
        },
    },
    Case: {
        __resolveReference(reference) {
            if (reference.id === "case-1") {
                return {
                    id: "case-1",
                    patientId: "patient-1",
                    title: "Annual Physical Case",
                    description: "Annual physical examination case",
                    status: resolvers_types_1.CaseStatus.Open,
                    priority: resolvers_types_1.CasePriority.Medium,
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString(),
                    closedAt: null
                };
            }
            return null;
        },
    },
};
//# sourceMappingURL=Query.js.map