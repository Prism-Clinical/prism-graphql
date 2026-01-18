import { Resolvers, CaseStatus, CasePriority, Gender } from "../__generated__/resolvers-types";
import { patientService, Patient } from "../services/database";

// Helper function to convert database patient to GraphQL patient
function convertToGraphQLPatient(dbPatient: Patient) {
  return {
    ...dbPatient,
    mrn: dbPatient.medicalRecordNumber,
    gender: dbPatient.gender ? (dbPatient.gender.toUpperCase() as Gender) : Gender.Unknown,
    cases: [] as any
  };
}

export const Query: Resolvers = {
  Query: {
    async patient(_parent, { id }, _context) {
      try {
        const patient = await patientService.getPatientById(id);
        return patient ? convertToGraphQLPatient(patient) : null;
      } catch (error) {
        console.error('Error fetching patient:', error);
        return null;
      }
    },
    async patientByMrn(_parent, { mrn }, _context) {
      try {
        // For now, we'll search by medical record number - this could be optimized with a specific query
        const patients = await patientService.getAllPatients(1000, 0);
        const patient = patients.find((p) => p.medicalRecordNumber === mrn);
        return patient ? convertToGraphQLPatient(patient) : null;
      } catch (error) {
        console.error('Error fetching patient by MRN:', error);
        return null;
      }
    },
    async patients(_parent, { limit = 50, offset = 0 }, _context) {
      try {
        const patients = await patientService.getAllPatients(limit, offset);
        return patients.map(convertToGraphQLPatient);
      } catch (error) {
        console.error('Error fetching patients:', error);
        return [];
      }
    },
    case(_parent, { id }, _context) {
      // Mock case data for now
      if (id === "case-1") {
        return {
          id: "case-1",
          patientId: "patient-1", 
          title: "Annual Physical Case",
          description: "Annual physical examination case",
          status: CaseStatus.Open,
          priority: CasePriority.Medium,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          closedAt: null as any
        };
      }
      return null;
    },
    casesForPatient(_parent, { patientId }, _context) {
      // Mock case data
      if (patientId === "patient-1") {
        return [{
          id: "case-1",
          patientId: "patient-1",
          title: "Annual Physical Case", 
          description: "Annual physical examination case",
          status: CaseStatus.Open,
          priority: CasePriority.Medium,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          closedAt: null as any
        }];
      }
      return [];
    },
    casesByStatus(_parent, { status }, _context) {
      // Mock case data
      return [{
        id: "case-1",
        patientId: "patient-1",
        title: "Annual Physical Case",
        description: "Annual physical examination case", 
        status: status,
        priority: CasePriority.Medium,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        closedAt: null as any
      }];
    },
  },
  Patient: {
    async __resolveReference(reference) {
      try {
        const patient = await patientService.getPatientById(reference.id);
        return patient ? convertToGraphQLPatient(patient) : null;
      } catch (error) {
        console.error('Error resolving patient reference:', error);
        return null;
      }
    },
    cases(parent) {
      // Mock case data linked to patient
      if (parent.id === "patient-1") {
        return [{
          id: "case-1",
          patientId: parent.id,
          title: "Annual Physical Case",
          description: "Annual physical examination case",
          status: CaseStatus.Open,
          priority: CasePriority.Medium, 
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          closedAt: null as any
        }];
      }
      return [];
    },
  },
  Case: {
    __resolveReference(reference) {
      // Mock case resolution for federation
      if (reference.id === "case-1") {
        return {
          id: "case-1",
          patientId: "patient-1",
          title: "Annual Physical Case", 
          description: "Annual physical examination case",
          status: CaseStatus.Open,
          priority: CasePriority.Medium,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          closedAt: null as any
        };
      }
      return null;
    },
  },
};
