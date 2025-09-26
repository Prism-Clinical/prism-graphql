import { Resolvers, MutationCreatePatientArgs, MutationUpdatePatientArgs, CaseStatus, CasePriority } from "../__generated__/resolvers-types";
import { patientsSource } from "../datasources/patientsSource";
import { ApolloError } from "apollo-server-errors";

export const Mutation: Resolvers = {
  Mutation: {
    createPatient(
      _parent,
      { input }: MutationCreatePatientArgs,
      _context
    ) {
      if (!input.mrn || input.mrn.trim() === "") {
        throw new ApolloError("Medical Record Number (MRN) is required.", "BAD_USER_INPUT");
      }
      if (!input.firstName || input.firstName.trim() === "") {
        throw new ApolloError("First name is required.", "BAD_USER_INPUT");
      }
      if (!input.lastName || input.lastName.trim() === "") {
        throw new ApolloError("Last name is required.", "BAD_USER_INPUT");
      }
      if (!input.dateOfBirth) {
        throw new ApolloError("Date of birth is required.", "BAD_USER_INPUT");
      }
      
      if (patientsSource.some((p) => p.mrn === input.mrn)) {
        throw new ApolloError("A patient with this MRN already exists.", "BAD_USER_INPUT");
      }
      
      const newId =
        patientsSource.length > 0
          ? `patient-${Math.max(...patientsSource.map((p) => Number(p.id.split('-')[1]) || 0)) + 1}`
          : "patient-1";
          
      const newPatient = {
        id: newId,
        mrn: input.mrn,
        firstName: input.firstName,
        lastName: input.lastName,
        dateOfBirth: input.dateOfBirth,
        gender: input.gender,
        email: input.email || undefined,
        phone: input.phone || undefined,
        address: input.address || undefined,
      };
      
      patientsSource.push({ ...newPatient });
      return { ...newPatient, cases: [] };
    },
    
    updatePatient(
      _parent,
      { id, input }: MutationUpdatePatientArgs,
      _context
    ) {
      const patient = patientsSource.find((p) => p.id === id);
      if (!patient) {
        throw new ApolloError("Patient not found.", "NOT_FOUND");
      }
      
      if (input.firstName !== undefined) patient.firstName = input.firstName;
      if (input.lastName !== undefined) patient.lastName = input.lastName;
      if (input.email !== undefined) patient.email = input.email;
      if (input.phone !== undefined) patient.phone = input.phone;
      if (input.address !== undefined) patient.address = input.address;
      
      return { ...patient, cases: [] };
    },
    
    createCase(_parent, { input }, _context) {
      const newCase = {
        id: `case-${Date.now()}`,
        patientId: input.patientId,
        title: input.title,
        description: input.description,
        status: CaseStatus.Open,
        priority: input.priority,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        closedAt: null as any
      };
      return newCase;
    },
    
    updateCase(_parent, { id, input }, _context) {
      // Mock update for now
      return {
        id,
        patientId: "patient-1",
        title: input.title || "Updated Case",
        description: input.description,
        status: input.status || CaseStatus.Open,
        priority: input.priority || CasePriority.Medium, 
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        closedAt: null as any
      };
    },
    
    closeCase(_parent, { id }, _context) {
      // Mock close for now
      return {
        id,
        patientId: "patient-1",
        title: "Closed Case",
        description: "This case has been closed",
        status: CaseStatus.Closed,
        priority: CasePriority.Medium,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        closedAt: new Date().toISOString()
      };
    },
  },
};
