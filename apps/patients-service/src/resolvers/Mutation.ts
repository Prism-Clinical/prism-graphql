import { Resolvers, MutationCreatePatientArgs, MutationUpdatePatientArgs, CaseStatus, CasePriority, Gender } from "../__generated__/resolvers-types";
import { patientService, Patient } from "../services/database";
import { GraphQLError } from "graphql";

// Helper function to convert database patient to GraphQL patient
function convertToGraphQLPatient(dbPatient: Patient) {
  return {
    ...dbPatient,
    mrn: dbPatient.medicalRecordNumber,
    gender: dbPatient.gender ? (dbPatient.gender.toUpperCase() as Gender) : Gender.Unknown,
    cases: [] as any
  };
}

export const Mutation: Resolvers = {
  Mutation: {
    async createPatient(
      _parent,
      { input }: MutationCreatePatientArgs,
      _context
    ) {
      try {
        if (!input.mrn || input.mrn.trim() === "") {
          throw new GraphQLError("Medical Record Number (MRN) is required.");
        }
        if (!input.firstName || input.firstName.trim() === "") {
          throw new GraphQLError("First name is required.");
        }
        if (!input.lastName || input.lastName.trim() === "") {
          throw new GraphQLError("Last name is required.");
        }
        if (!input.dateOfBirth) {
          throw new GraphQLError("Date of birth is required.");
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
          epicPatientId: undefined as string | undefined,
          emergencyContact: undefined as any,
          insuranceInfo: undefined as any
        };
        
        const newPatient = await patientService.createPatient(patientData);
        return convertToGraphQLPatient(newPatient);
      } catch (error) {
        console.error('Error creating patient:', error);
        if (error instanceof GraphQLError) {
          throw error;
        }
        throw new GraphQLError("Failed to create patient.");
      }
    },
    
    async updatePatient(
      _parent,
      { id, input }: MutationUpdatePatientArgs,
      _context
    ) {
      try {
        const updates: any = {};
        
        if (input.firstName !== undefined) updates.firstName = input.firstName;
        if (input.lastName !== undefined) updates.lastName = input.lastName;
        if (input.email !== undefined) updates.email = input.email;
        if (input.phone !== undefined) updates.phone = input.phone;
        if (input.address !== undefined) updates.address = input.address;
        
        const updatedPatient = await patientService.updatePatient(id, updates);
        
        if (!updatedPatient) {
          throw new GraphQLError("Patient not found.");
        }
        
        return convertToGraphQLPatient(updatedPatient);
      } catch (error) {
        console.error('Error updating patient:', error);
        if (error instanceof GraphQLError) {
          throw error;
        }
        throw new GraphQLError("Failed to update patient.");
      }
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
