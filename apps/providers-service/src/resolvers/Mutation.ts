import { Resolvers, MutationCreateProviderArgs, MutationUpdateProviderArgs, MutationCreateFacilityArgs } from "../__generated__/resolvers-types";
import { providersSource, facilitiesSource } from "../datasources/providersSource";
import { GraphQLError } from "graphql";
import { audioUploadResolvers } from "./mutations/audio-upload";

export const Mutation: Resolvers = {
  Mutation: {
    createProvider(
      _parent,
      { input }: MutationCreateProviderArgs,
      _context
    ) {
      if (!input.npi || input.npi.trim() === "") {
        throw new GraphQLError("NPI is required.");
      }
      if (!input.firstName || input.firstName.trim() === "") {
        throw new GraphQLError("First name is required.");
      }
      if (!input.lastName || input.lastName.trim() === "") {
        throw new GraphQLError("Last name is required.");
      }
      if (!input.specialty || input.specialty.trim() === "") {
        throw new GraphQLError("Specialty is required.");
      }
      if (!input.email || input.email.trim() === "") {
        throw new GraphQLError("Email is required.");
      }
      
      if (providersSource.some((p) => p.npi === input.npi)) {
        throw new GraphQLError("A provider with this NPI already exists.");
      }
      
      if (input.facilityId && !facilitiesSource.some((f) => f.id === input.facilityId)) {
        throw new GraphQLError("Facility not found.");
      }
      
      const newId =
        providersSource.length > 0
          ? `provider-${Math.max(...providersSource.map((p) => Number(p.id.split('-')[1]) || 0)) + 1}`
          : "provider-1";
          
      const newProvider = {
        id: newId,
        npi: input.npi,
        firstName: input.firstName,
        lastName: input.lastName,
        specialty: input.specialty,
        credentials: input.credentials,
        email: input.email,
        phone: input.phone,
        facilityId: input.facilityId || undefined,
      };
      
      providersSource.push({ ...newProvider });
      return { ...newProvider, visits: [] as any[] };
    },
    
    updateProvider(
      _parent,
      { id, input }: MutationUpdateProviderArgs,
      _context
    ) {
      const provider = providersSource.find((p) => p.id === id);
      if (!provider) {
        throw new GraphQLError("Provider not found.");
      }
      
      if (input.facilityId && !facilitiesSource.some((f) => f.id === input.facilityId)) {
        throw new GraphQLError("Facility not found.");
      }
      
      if (input.firstName !== undefined) provider.firstName = input.firstName;
      if (input.lastName !== undefined) provider.lastName = input.lastName;
      if (input.specialty !== undefined) provider.specialty = input.specialty;
      if (input.credentials !== undefined) provider.credentials = input.credentials;
      if (input.email !== undefined) provider.email = input.email;
      if (input.phone !== undefined) provider.phone = input.phone;
      if (input.facilityId !== undefined) provider.facilityId = input.facilityId;
      
      return { ...provider, visits: [] as any[] };
    },
    
    createFacility(
      _parent,
      { input }: MutationCreateFacilityArgs,
      _context
    ) {
      if (!input.name || input.name.trim() === "") {
        throw new GraphQLError("Facility name is required.");
      }
      if (!input.address) {
        throw new GraphQLError("Facility address is required.");
      }
      if (!input.phone || input.phone.trim() === "") {
        throw new GraphQLError("Facility phone is required.");
      }
      
      const newId =
        facilitiesSource.length > 0
          ? `facility-${Math.max(...facilitiesSource.map((f) => Number(f.id.split('-')[1]) || 0)) + 1}`
          : "facility-1";
          
      const newFacility = {
        id: newId,
        name: input.name,
        address: input.address,
        phone: input.phone,
      };
      
      facilitiesSource.push({ ...newFacility });
      return { ...newFacility };
    },

    getAudioUploadUrl: audioUploadResolvers.getAudioUploadUrl as any,
    updateVisitAudio: audioUploadResolvers.updateVisitAudio as any,
  },
};
