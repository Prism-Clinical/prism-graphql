import { Resolvers } from "../__generated__/resolvers-types";
import { providerService, facilityService, visitService } from "../services/database";

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
      return await visitService.getVisitById(id) as any;
    },
    async visitsForProvider(_parent, { providerId }, _context) {
      return await visitService.getVisitsForProvider(providerId) as any;
    },
  },
  Provider: {
    async __resolveReference(reference) {
      const provider = await providerService.getProviderById(reference.id);
      return provider ? { ...provider, visits: [] as any[] } : null;
    },
    async facility(parent, _args, _context) {
      const facilityId = (parent as any).facilityId || (parent.facility as any)?.id;
      if (!facilityId) return null;
      return await facilityService.getFacilityById(facilityId);
    },
    async visits(parent, _args, _context) {
      return await visitService.getVisitsForProvider(parent.id) as any;
    },
  },
};
