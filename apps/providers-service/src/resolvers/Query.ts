import { Resolvers } from "@providers/__generated__/resolvers-types";
import { providerService, facilityService, visitService } from "@providers/services/database";

export const Query: Resolvers = {
  Query: {
    async provider(_parent, { id }, _context) {
      const provider = await providerService.getProviderById(id);
      return provider ? { ...provider, visits: [] as any[] } : null;
    },
    async providerByNpi(_parent, { npi }, _context) {
      const provider = await providerService.getProviderByNpi(npi);
      return provider ? { ...provider, visits: [] as any[] } : null;
    },
    async providers(_parent, { specialty }, _context) {
      const providers = await providerService.getProviders({ specialty });
      return providers.map((p) => ({ ...p, visits: [] as any[] }));
    },
    async facility(_parent, { id }, _context) {
      const facility = await facilityService.getFacilityById(id);
      return facility;
    },
    async visit(_parent, { id }, _context) {
      return await visitService.getVisitById(id);
    },
    async visitsForProvider(_parent, { providerId }, _context) {
      return await visitService.getVisitsForProvider(providerId);
    },
  },
  Provider: {
    async __resolveReference(reference) {
      const provider = await providerService.getProviderById(reference.id);
      return provider ? { ...provider, visits: [] as any[] } : null;
    },
    async facility(parent, _args, _context) {
      if (!parent.facilityId) return null;
      return await facilityService.getFacilityById(parent.facilityId);
    },
    async visits(parent, _args, _context) {
      return await visitService.getVisitsForProvider(parent.id);
    },
  },
};
