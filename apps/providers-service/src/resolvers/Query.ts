import { Resolvers } from "../__generated__/resolvers-types";
import { providersSource, facilitiesSource, providerFacilityMapping } from "../datasources/providersSource";

export const Query: Resolvers = {
  Query: {
    provider(_parent, { id }, _context) {
      const provider = providersSource.find((p) => String(p.id) === String(id));
      return provider ? { ...provider, visits: [] as any[] } : null;
    },
    providerByNpi(_parent, { npi }, _context) {
      const provider = providersSource.find((p) => p.npi === npi);
      return provider ? { ...provider, visits: [] as any[] } : null;
    },
    providers(_parent, { specialty }, _context) {
      let result = [...providersSource];
      
      if (specialty) {
        result = result.filter((p) => p.specialty.toLowerCase().includes(specialty.toLowerCase()));
      }
      
      return result.map((p) => ({ ...p, visits: [] as any[] }));
    },
    facility(_parent, { id }, _context) {
      const facility = facilitiesSource.find((f) => String(f.id) === String(id));
      return facility ? { ...facility } : null;
    },
  },
  Provider: {
    __resolveReference(reference) {
      const provider = providersSource.find((p) => p.id === reference.id);
      return provider ? { ...provider, visits: [] as any[] } : null;
    },
    facility(parent, _args, _context) {
      const facilityId = providerFacilityMapping[parent.id];
      if (!facilityId) return null;
      const facility = facilitiesSource.find((f) => f.id === facilityId);
      return facility ? { ...facility } : null;
    },
    visits(parent, _args, _context) {
      // Return empty array for now - visits will be resolved by federation
      return [];
    },
  },
};
