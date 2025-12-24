"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Query = void 0;
const database_1 = require("@institutions/services/database");
exports.Query = {
    Query: {
        async institution(_parent, { id }, _context) {
            return await database_1.institutionService.getInstitutionById(id);
        },
        async institutions(_parent, { type }, _context) {
            return await database_1.institutionService.getInstitutions({ type });
        },
        async hospital(_parent, { id }, _context) {
            const hospital = await database_1.hospitalService.getHospitalById(id);
            if (!hospital)
                return null;
            return {
                ...hospital,
                visits: []
            };
        },
        async hospitals(_parent, { institutionId }, _context) {
            if (institutionId) {
                const hospitals = await database_1.hospitalService.getHospitalsByInstitution(institutionId);
                return hospitals.map((h) => ({
                    ...h,
                    visits: []
                }));
            }
            return [];
        },
        async hospitalsByInstitution(_parent, { institutionId }, _context) {
            const hospitals = await database_1.hospitalService.getHospitalsByInstitution(institutionId);
            return hospitals.map((h) => ({
                ...h,
                visits: []
            }));
        },
    },
    Institution: {
        async __resolveReference(reference) {
            return await database_1.institutionService.getInstitutionById(reference.id);
        },
    },
    Hospital: {
        async __resolveReference(reference) {
            const hospital = await database_1.hospitalService.getHospitalById(reference.id);
            return hospital ? { ...hospital, visits: [] } : null;
        },
        async institution(parent, _args, _context) {
            return await database_1.institutionService.getInstitutionById(parent.institutionId);
        },
        visits(parent, _args, _context) {
            return [];
        },
    },
};
//# sourceMappingURL=Query.js.map