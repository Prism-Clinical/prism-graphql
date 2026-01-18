import { Resolvers } from "../__generated__/resolvers-types";
import { institutionService, hospitalService } from "../services/database";

export const Query: Resolvers = {
  Query: {
    async institution(_parent, { id }, _context) {
      return await institutionService.getInstitutionById(id) as any;
    },
    async institutions(_parent, { type }, _context) {
      return await institutionService.getInstitutions({ type: type as any }) as any;
    },
    async hospital(_parent, { id }, _context) {
      const hospital = await hospitalService.getHospitalById(id);
      if (!hospital) return null;
      
      return {
        ...hospital,
        visits: [] as any[] // Federation will resolve visits
      };
    },
    async hospitals(_parent, { institutionId }, _context) {
      if (institutionId) {
        const hospitals = await hospitalService.getHospitalsByInstitution(institutionId);
        return hospitals.map((h) => ({
          ...h,
          visits: [] as any[] // Federation will resolve visits
        }));
      }
      
      // For now, return empty array when no institutionId provided
      // Could implement getAllHospitals method if needed
      return [];
    },
    async hospitalsByInstitution(_parent, { institutionId }, _context) {
      const hospitals = await hospitalService.getHospitalsByInstitution(institutionId);
      return hospitals.map((h) => ({
        ...h,
        visits: [] as any[] // Federation will resolve visits
      }));
    },
  },
  Institution: {
    async __resolveReference(reference) {
      return await institutionService.getInstitutionById(reference.id) as any;
    },
  },
  Hospital: {
    async __resolveReference(reference) {
      const hospital = await hospitalService.getHospitalById(reference.id);
      return hospital ? { ...hospital, visits: [] as any[] } : null;
    },
    async institution(parent: any, _args: any, _context: any) {
      return await institutionService.getInstitutionById(parent.institutionId) as any;
    },
    visits(parent: any, _args: any, _context: any) {
      // Return empty array for now - visits will be resolved by federation
      return [];
    },
  },
};
