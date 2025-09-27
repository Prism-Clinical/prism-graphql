import { Resolvers } from "@institutions/__generated__/resolvers-types";
import { institutionsSource, hospitalsSource } from "@institutions/datasources/institutionsSource";

export const Query: Resolvers = {
  Query: {
    institution(_parent, { id }, _context) {
      const institution = institutionsSource.find((i) => String(i.id) === String(id));
      return institution ? { ...institution } : null;
    },
    institutions(_parent, { type }, _context) {
      let result = [...institutionsSource];
      
      if (type) {
        result = result.filter((i) => i.type === type);
      }
      
      return result.map((i) => ({ ...i }));
    },
    hospital(_parent, { id }, _context) {
      const hospital = hospitalsSource.find((h) => String(h.id) === String(id));
      if (!hospital) return null;
      
      return {
        ...hospital,
        visits: [] as any[] // Federation will resolve visits
      };
    },
    hospitals(_parent, { institutionId }, _context) {
      let result = [...hospitalsSource];
      
      if (institutionId) {
        result = result.filter((h) => h.institutionId === institutionId);
      }
      
      return result.map((h) => ({
        ...h,
        visits: [] as any[] // Federation will resolve visits
      }));
    },
  },
  Institution: {
    __resolveReference(reference) {
      const institution = institutionsSource.find((i) => i.id === reference.id);
      return institution ? { ...institution } : null;
    },
  },
  Hospital: {
    __resolveReference(reference) {
      const hospital = hospitalsSource.find((h) => h.id === reference.id);
      return hospital ? { ...hospital, visits: [] as any[] } : null;
    },
    institution(parent: any, _args: any, _context: any) {
      const institution = institutionsSource.find((i) => i.id === parent.institutionId);
      return institution ? { ...institution } : null;
    },
    visits(parent: any, _args: any, _context: any) {
      // Return empty array for now - visits will be resolved by federation
      return [];
    },
  },
};
