"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Mutation = void 0;
const database_1 = require("@institutions/services/database");
const graphql_1 = require("graphql");
exports.Mutation = {
    Mutation: {
        async createInstitution(_parent, { input }, _context) {
            if (!input.name || input.name.trim() === "") {
                throw new graphql_1.GraphQLError("Institution name is required.");
            }
            if (!input.type) {
                throw new graphql_1.GraphQLError("Institution type is required.");
            }
            if (!input.address) {
                throw new graphql_1.GraphQLError("Institution address is required.");
            }
            if (!input.phone || input.phone.trim() === "") {
                throw new graphql_1.GraphQLError("Institution phone is required.");
            }
            try {
                return await database_1.institutionService.createInstitution({
                    name: input.name,
                    type: input.type,
                    address: input.address,
                    phone: input.phone,
                    email: input.email,
                    website: input.website,
                    accreditation: input.accreditation || []
                });
            }
            catch (error) {
                if (error.message.includes('Duplicate name')) {
                    throw new graphql_1.GraphQLError("Institution with this name already exists.");
                }
                throw new graphql_1.GraphQLError("Failed to create institution.");
            }
        },
        async updateInstitution(_parent, { id, input }, _context) {
            try {
                const institution = await database_1.institutionService.updateInstitution(id, input);
                if (!institution) {
                    throw new graphql_1.GraphQLError("Institution not found.");
                }
                return institution;
            }
            catch (error) {
                if (error.message.includes('not found')) {
                    throw new graphql_1.GraphQLError("Institution not found.");
                }
                throw new graphql_1.GraphQLError("Failed to update institution.");
            }
        },
        async createHospital(_parent, { input }, _context) {
            if (!input.name || input.name.trim() === "") {
                throw new graphql_1.GraphQLError("Hospital name is required.");
            }
            if (!input.institutionId || input.institutionId.trim() === "") {
                throw new graphql_1.GraphQLError("Institution ID is required.");
            }
            if (!input.address) {
                throw new graphql_1.GraphQLError("Hospital address is required.");
            }
            if (!input.phone || input.phone.trim() === "") {
                throw new graphql_1.GraphQLError("Hospital phone is required.");
            }
            try {
                const hospital = await database_1.hospitalService.createHospital({
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
                return { ...hospital, visits: [] };
            }
            catch (error) {
                if (error.message.includes('Invalid institution reference')) {
                    throw new graphql_1.GraphQLError("Institution not found.");
                }
                throw new graphql_1.GraphQLError("Failed to create hospital.");
            }
        },
        async updateHospital(_parent, { id, input }, _context) {
            try {
                const hospital = await database_1.hospitalService.updateHospital(id, input);
                if (!hospital) {
                    throw new graphql_1.GraphQLError("Hospital not found.");
                }
                return { ...hospital, visits: [] };
            }
            catch (error) {
                if (error.message.includes('not found')) {
                    throw new graphql_1.GraphQLError("Hospital not found.");
                }
                throw new graphql_1.GraphQLError("Failed to update hospital.");
            }
        },
    },
};
//# sourceMappingURL=Mutation.js.map