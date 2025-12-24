"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Query = void 0;
const database_1 = require("@providers/services/database");
exports.Query = {
    Query: {
        async provider(_parent, { id }, _context) {
            const provider = await database_1.providerService.getProviderById(id);
            return provider ? { ...provider, visits: [] } : null;
        },
        async providerByNpi(_parent, { npi }, _context) {
            const provider = await database_1.providerService.getProviderByNpi(npi);
            return provider ? { ...provider, visits: [] } : null;
        },
        async providers(_parent, { specialty }, _context) {
            const providers = await database_1.providerService.getProviders({ specialty });
            return providers.map((p) => ({ ...p, visits: [] }));
        },
        async facility(_parent, { id }, _context) {
            const facility = await database_1.facilityService.getFacilityById(id);
            return facility;
        },
        async visit(_parent, { id }, _context) {
            return await database_1.visitService.getVisitById(id);
        },
        async visitsForProvider(_parent, { providerId }, _context) {
            return await database_1.visitService.getVisitsForProvider(providerId);
        },
    },
    Provider: {
        async __resolveReference(reference) {
            const provider = await database_1.providerService.getProviderById(reference.id);
            return provider ? { ...provider, visits: [] } : null;
        },
        async facility(parent, _args, _context) {
            if (!parent.facilityId)
                return null;
            return await database_1.facilityService.getFacilityById(parent.facilityId);
        },
        async visits(parent, _args, _context) {
            return await database_1.visitService.getVisitsForProvider(parent.id);
        },
    },
};
//# sourceMappingURL=Query.js.map