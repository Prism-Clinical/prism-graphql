import { Resolvers, CaseStatus, CasePriority } from "../__generated__/resolvers-types";
import { patientsSource } from "../datasources/patientsSource";

export const Query: Resolvers = {
  Query: {
    patient(_parent, { id }, _context) {
      const patient = patientsSource.find((p) => String(p.id) === String(id));
      return patient ? { ...patient, cases: [] } : null;
    },
    patientByMrn(_parent, { mrn }, _context) {
      const patient = patientsSource.find((p) => p.mrn === mrn);
      return patient ? { ...patient, cases: [] } : null;
    },
    patients(_parent, { limit, offset }, _context) {
      let result = [...patientsSource];
      
      if (offset) {
        result = result.slice(offset);
      }
      if (limit) {
        result = result.slice(0, limit);
      }
      
      return result.map((p) => ({ ...p, cases: [] as any }));
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
    __resolveReference(reference) {
      const patient = patientsSource.find((p) => p.id === reference.id);
      return patient ? { ...patient, cases: [] } : null;
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
