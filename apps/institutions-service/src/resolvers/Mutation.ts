import { Resolvers, MutationCreateInstitutionArgs, MutationCreateHospitalArgs, MutationUpdateInstitutionArgs, MutationUpdateHospitalArgs } from "@institutions/__generated__/resolvers-types";
import { institutionService, hospitalService } from "@institutions/services/database";
import { GraphQLError } from "graphql";

export const Mutation: Resolvers = {
  Mutation: {
    async createInstitution(
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
      if (!input.phone || input.phone.trim() === "") {
        throw new GraphQLError("Institution phone is required.");
      }
      
      try {
        return await institutionService.createInstitution({
          name: input.name,
          type: input.type,
          address: input.address,
          phone: input.phone,
          email: input.email,
          website: input.website,
          accreditation: input.accreditation || []
        });
      } catch (error: any) {
        if (error.message.includes('Duplicate name')) {
          throw new GraphQLError("Institution with this name already exists.");
        }
        throw new GraphQLError("Failed to create institution.");
      }
    },
    
    async updateInstitution(
      _parent,
      { id, input }: MutationUpdateInstitutionArgs,
      _context
    ) {
      try {
        const institution = await institutionService.updateInstitution(id, input);
        if (!institution) {
          throw new GraphQLError("Institution not found.");
        }
        return institution;
      } catch (error: any) {
        if (error.message.includes('not found')) {
          throw new GraphQLError("Institution not found.");
        }
        throw new GraphQLError("Failed to update institution.");
      }
    },
    
    async createHospital(
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
      if (!input.phone || input.phone.trim() === "") {
        throw new GraphQLError("Hospital phone is required.");
      }
      
      try {
        const hospital = await hospitalService.createHospital({
          name: input.name,
          institutionId: input.institutionId,
          address: input.address,
          phone: input.phone,
          email: input.email,
          website: input.website,
          beds: input.beds,
          departments: input.departments || [],
          emergencyServices: input.emergencyServices
        });
        
        return { ...hospital, visits: [] as any[] };
      } catch (error: any) {
        if (error.message.includes('Invalid institution reference')) {
          throw new GraphQLError("Institution not found.");
        }
        throw new GraphQLError("Failed to create hospital.");
      }
    },
    
    async updateHospital(
      _parent,
      { id, input }: MutationUpdateHospitalArgs,
      _context
    ) {
      try {
        const hospital = await hospitalService.updateHospital(id, input);
        if (!hospital) {
          throw new GraphQLError("Hospital not found.");
        }
        return { ...hospital, visits: [] as any[] };
      } catch (error: any) {
        if (error.message.includes('not found')) {
          throw new GraphQLError("Hospital not found.");
        }
        throw new GraphQLError("Failed to update hospital.");
      }
    },
  },
};
