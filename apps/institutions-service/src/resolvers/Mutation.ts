import { Resolvers, MutationCreateInstitutionArgs, MutationCreateHospitalArgs } from "../__generated__/resolvers-types";
import { institutionsSource, hospitalsSource } from "../datasources/institutionsSource";
import { GraphQLError } from "graphql";

export const Mutation: Resolvers = {
  Mutation: {
    createInstitution(
      _parent,
      { input }: MutationCreateInstitutionArgs,
      _context
    ) {
      if (!input.name || input.name.trim() === "") {
        throw new GraphQLError("Institution name is required.");
      }
      if (!input.type) {
        throw new GraphQLError("Institution type is required.");
      }
      if (!input.address) {
        throw new GraphQLError("Institution address is required.");
      }
      
      const newId =
        institutionsSource.length > 0
          ? `institution-${Math.max(...institutionsSource.map((i) => Number(i.id.split('-')[1]) || 0)) + 1}`
          : "institution-1";
          
      const newInstitution = {
        id: newId,
        name: input.name,
        type: input.type,
        address: input.address,
        phone: input.phone || "(555) 000-0000",
        email: input.email,
        website: input.website,
        accreditation: input.accreditation || [],
        isActive: true,
      };
      
      institutionsSource.push({ ...newInstitution });
      return { ...newInstitution };
    },
    
    createHospital(
      _parent,
      { input }: MutationCreateHospitalArgs,
      _context
    ) {
      if (!input.name || input.name.trim() === "") {
        throw new GraphQLError("Hospital name is required.");
      }
      if (!input.institutionId || input.institutionId.trim() === "") {
        throw new GraphQLError("Institution ID is required.");
      }
      if (!input.address) {
        throw new GraphQLError("Hospital address is required.");
      }
      
      // Validate institution exists
      if (!institutionsSource.some((i) => i.id === input.institutionId)) {
        throw new GraphQLError("Institution not found.");
      }
      
      const newId =
        hospitalsSource.length > 0
          ? `hospital-${Math.max(...hospitalsSource.map((h) => Number(h.id.split('-')[1]) || 0)) + 1}`
          : "hospital-1";
          
      const newHospital = {
        id: newId,
        name: input.name,
        institutionId: input.institutionId,
        address: input.address,
        phone: input.phone || "(555) 000-0000",
        email: input.email,
        website: input.website,
        beds: input.beds,
        departments: input.departments || [],
        emergencyServices: input.emergencyServices || false,
        isActive: true,
      };
      
      hospitalsSource.push({ ...newHospital });
      return { ...newHospital, visits: [] as any[] };
    },
  },
};
