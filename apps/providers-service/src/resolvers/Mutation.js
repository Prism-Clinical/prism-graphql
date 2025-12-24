"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Mutation = void 0;
const providersSource_1 = require("@providers/datasources/providersSource");
const apollo_server_errors_1 = require("apollo-server-errors");
exports.Mutation = {
    Mutation: {
        createProvider(_parent, { input }, _context) {
            if (!input.npi || input.npi.trim() === "") {
                throw new apollo_server_errors_1.ApolloError("NPI is required.", "BAD_USER_INPUT");
            }
            if (!input.firstName || input.firstName.trim() === "") {
                throw new apollo_server_errors_1.ApolloError("First name is required.", "BAD_USER_INPUT");
            }
            if (!input.lastName || input.lastName.trim() === "") {
                throw new apollo_server_errors_1.ApolloError("Last name is required.", "BAD_USER_INPUT");
            }
            if (!input.specialty || input.specialty.trim() === "") {
                throw new apollo_server_errors_1.ApolloError("Specialty is required.", "BAD_USER_INPUT");
            }
            if (!input.email || input.email.trim() === "") {
                throw new apollo_server_errors_1.ApolloError("Email is required.", "BAD_USER_INPUT");
            }
            if (providersSource_1.providersSource.some((p) => p.npi === input.npi)) {
                throw new apollo_server_errors_1.ApolloError("A provider with this NPI already exists.", "BAD_USER_INPUT");
            }
            if (input.facilityId && !providersSource_1.facilitiesSource.some((f) => f.id === input.facilityId)) {
                throw new apollo_server_errors_1.ApolloError("Facility not found.", "BAD_USER_INPUT");
            }
            const newId = providersSource_1.providersSource.length > 0
                ? `provider-${Math.max(...providersSource_1.providersSource.map((p) => Number(p.id.split('-')[1]) || 0)) + 1}`
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
            providersSource_1.providersSource.push({ ...newProvider });
            return { ...newProvider, visits: [] };
        },
        updateProvider(_parent, { id, input }, _context) {
            const provider = providersSource_1.providersSource.find((p) => p.id === id);
            if (!provider) {
                throw new apollo_server_errors_1.ApolloError("Provider not found.", "NOT_FOUND");
            }
            if (input.facilityId && !providersSource_1.facilitiesSource.some((f) => f.id === input.facilityId)) {
                throw new apollo_server_errors_1.ApolloError("Facility not found.", "BAD_USER_INPUT");
            }
            if (input.firstName !== undefined)
                provider.firstName = input.firstName;
            if (input.lastName !== undefined)
                provider.lastName = input.lastName;
            if (input.specialty !== undefined)
                provider.specialty = input.specialty;
            if (input.credentials !== undefined)
                provider.credentials = input.credentials;
            if (input.email !== undefined)
                provider.email = input.email;
            if (input.phone !== undefined)
                provider.phone = input.phone;
            if (input.facilityId !== undefined)
                provider.facilityId = input.facilityId;
            return { ...provider, visits: [] };
        },
        createFacility(_parent, { input }, _context) {
            if (!input.name || input.name.trim() === "") {
                throw new apollo_server_errors_1.ApolloError("Facility name is required.", "BAD_USER_INPUT");
            }
            if (!input.address) {
                throw new apollo_server_errors_1.ApolloError("Facility address is required.", "BAD_USER_INPUT");
            }
            if (!input.phone || input.phone.trim() === "") {
                throw new apollo_server_errors_1.ApolloError("Facility phone is required.", "BAD_USER_INPUT");
            }
            const newId = providersSource_1.facilitiesSource.length > 0
                ? `facility-${Math.max(...providersSource_1.facilitiesSource.map((f) => Number(f.id.split('-')[1]) || 0)) + 1}`
                : "facility-1";
            const newFacility = {
                id: newId,
                name: input.name,
                address: input.address,
                phone: input.phone,
            };
            providersSource_1.facilitiesSource.push({ ...newFacility });
            return { ...newFacility };
        },
    },
};
//# sourceMappingURL=Mutation.js.map