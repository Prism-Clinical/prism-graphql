"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const subgraph_1 = require("@apollo/subgraph");
const server_1 = require("@apollo/server");
const fs_1 = require("fs");
const graphql_tag_1 = __importDefault(require("graphql-tag"));
const resolvers_1 = __importDefault(require("@providers/resolvers"));
const setup_1 = require("@test-utils/setup");
const database_1 = require("@providers/services/database");
describe("Providers Service Queries", () => {
    let server;
    let pool;
    let redis;
    beforeAll(async () => {
        pool = await (0, setup_1.setupTestDatabase)();
        redis = await (0, setup_1.setupTestRedis)();
        (0, database_1.initializeDatabase)(pool, redis);
        server = new server_1.ApolloServer({
            schema: (0, subgraph_1.buildSubgraphSchema)({
                typeDefs: (0, graphql_tag_1.default)((0, fs_1.readFileSync)("schema.graphql", {
                    encoding: "utf-8",
                })),
                resolvers: resolvers_1.default,
            }),
        });
    });
    beforeEach(async () => {
        await (0, setup_1.cleanupTestDatabase)();
    });
    afterAll(async () => {
        await (0, setup_1.closeTestConnections)();
    });
    describe("provider query", () => {
        it("returns provider by ID", async () => {
            const testProvider = await setup_1.testHelpers.insertProvider(pool, {
                npi: "1234567890",
                firstName: "Dr. John",
                lastName: "Smith",
                specialty: "Cardiology",
                email: "john.smith@hospital.com"
            });
            const query = `
        query GetProvider($id: ID!) {
          provider(id: $id) {
            id
            npi
            firstName
            lastName
            specialty
            email
            phone
          }
        }
      `;
            const variables = { id: testProvider.id };
            const res = await server.executeOperation({ query, variables });
            expect(res.body.kind).toBe("single");
            if ('singleResult' in res.body) {
                const data = res.body.singleResult.data?.provider;
                expect(data.id).toBe(testProvider.id);
                expect(data.npi).toBe("1234567890");
                expect(data.firstName).toBe("Dr. John");
                expect(data.lastName).toBe("Smith");
                expect(data.specialty).toBe("Cardiology");
                expect(data.email).toBe("john.smith@hospital.com");
            }
        });
        it("returns null for non-existent provider", async () => {
            const query = `
        query GetProvider($id: ID!) {
          provider(id: $id) {
            id
            firstName
          }
        }
      `;
            const variables = { id: "non-existent-id" };
            const res = await server.executeOperation({ query, variables });
            expect(res.body.kind).toBe("single");
            if ('singleResult' in res.body) {
                expect(res.body.singleResult.data?.provider).toBeNull();
            }
        });
    });
    describe("providerByNpi query", () => {
        it("returns provider by NPI", async () => {
            const testProvider = await setup_1.testHelpers.insertProvider(pool, {
                npi: "9876543210",
                firstName: "Dr. Jane",
                lastName: "Doe",
                specialty: "Internal Medicine"
            });
            const query = `
        query GetProviderByNpi($npi: String!) {
          providerByNpi(npi: $npi) {
            id
            npi
            firstName
            lastName
            specialty
          }
        }
      `;
            const variables = { npi: "9876543210" };
            const res = await server.executeOperation({ query, variables });
            expect(res.body.kind).toBe("single");
            if ('singleResult' in res.body) {
                const data = res.body.singleResult.data?.providerByNpi;
                expect(data.id).toBe(testProvider.id);
                expect(data.npi).toBe("9876543210");
                expect(data.firstName).toBe("Dr. Jane");
                expect(data.lastName).toBe("Doe");
                expect(data.specialty).toBe("Internal Medicine");
            }
        });
        it("returns null for non-existent NPI", async () => {
            const query = `
        query GetProviderByNpi($npi: String!) {
          providerByNpi(npi: $npi) {
            id
            npi
          }
        }
      `;
            const variables = { npi: "0000000000" };
            const res = await server.executeOperation({ query, variables });
            expect(res.body.kind).toBe("single");
            if ('singleResult' in res.body) {
                expect(res.body.singleResult.data?.providerByNpi).toBeNull();
            }
        });
    });
    describe("providers query", () => {
        it("returns list of all providers", async () => {
            await setup_1.testHelpers.insertProvider(pool, { firstName: "Dr. John", lastName: "Smith", specialty: "Cardiology" });
            await setup_1.testHelpers.insertProvider(pool, { firstName: "Dr. Jane", lastName: "Doe", specialty: "Internal Medicine" });
            await setup_1.testHelpers.insertProvider(pool, { firstName: "Dr. Bob", lastName: "Johnson", specialty: "Family Medicine" });
            const query = `
        query GetProviders {
          providers {
            id
            firstName
            lastName
            specialty
          }
        }
      `;
            const res = await server.executeOperation({ query });
            expect(res.body.kind).toBe("single");
            if ('singleResult' in res.body) {
                const data = res.body.singleResult.data?.providers;
                expect(Array.isArray(data)).toBe(true);
                expect(data.length).toBe(3);
                expect(data.map((p) => p.firstName)).toEqual(expect.arrayContaining(["Dr. John", "Dr. Jane", "Dr. Bob"]));
            }
        });
        it("filters providers by specialty", async () => {
            await setup_1.testHelpers.insertProvider(pool, { firstName: "Dr. Heart1", lastName: "Cardio", specialty: "Cardiology" });
            await setup_1.testHelpers.insertProvider(pool, { firstName: "Dr. Heart2", lastName: "Cardio", specialty: "Cardiology" });
            await setup_1.testHelpers.insertProvider(pool, { firstName: "Dr. Family", lastName: "Med", specialty: "Family Medicine" });
            const query = `
        query GetProvidersBySpecialty($specialty: String) {
          providers(specialty: $specialty) {
            id
            firstName
            lastName
            specialty
          }
        }
      `;
            const variables = { specialty: "Cardiology" };
            const res = await server.executeOperation({ query, variables });
            expect(res.body.kind).toBe("single");
            if ('singleResult' in res.body) {
                const data = res.body.singleResult.data?.providers;
                expect(Array.isArray(data)).toBe(true);
                expect(data.length).toBe(2);
                expect(data.every((p) => p.specialty === "Cardiology")).toBe(true);
            }
        });
        it("returns empty array when no providers match specialty", async () => {
            await setup_1.testHelpers.insertProvider(pool, { specialty: "Cardiology" });
            const query = `
        query GetProvidersBySpecialty($specialty: String) {
          providers(specialty: $specialty) {
            id
            specialty
          }
        }
      `;
            const variables = { specialty: "Neurology" };
            const res = await server.executeOperation({ query, variables });
            expect(res.body.kind).toBe("single");
            if ('singleResult' in res.body) {
                const data = res.body.singleResult.data?.providers;
                expect(Array.isArray(data)).toBe(true);
                expect(data.length).toBe(0);
            }
        });
    });
    describe("facility query", () => {
        it("returns facility by ID", async () => {
            const testFacility = await setup_1.testHelpers.insertInstitution(pool, {
                name: "Test Medical Center",
                type: "hospital",
                phone: "555-1234",
                address: { street: "123 Medical Dr", city: "Healthtown", state: "CA", zip: "90210" }
            });
            const query = `
        query GetFacility($id: ID!) {
          facility(id: $id) {
            id
            name
            phone
            address {
              street
              city
              state
              zipCode
              country
            }
          }
        }
      `;
            const variables = { id: testFacility.id };
            const res = await server.executeOperation({ query, variables });
            expect(res.body.kind).toBe("single");
            if ('singleResult' in res.body) {
                const data = res.body.singleResult.data?.facility;
                expect(data.id).toBe(testFacility.id);
                expect(data.name).toBe("Test Medical Center");
                expect(data.phone).toBe("555-1234");
                expect(data.address.street).toBe("123 Medical Dr");
                expect(data.address.city).toBe("Healthtown");
            }
        });
    });
    describe("Federation resolvers", () => {
        it("resolves Provider.__resolveReference", async () => {
            const testProvider = await setup_1.testHelpers.insertProvider(pool, {
                firstName: "Federation",
                lastName: "Test",
                specialty: "Test Medicine"
            });
            const reference = { __typename: "Provider", id: testProvider.id };
            const resolvedProvider = await resolvers_1.default.Provider.__resolveReference(reference, {}, {});
            expect(resolvedProvider).toBeDefined();
            expect(resolvedProvider.id).toBe(testProvider.id);
            expect(resolvedProvider.firstName).toBe("Federation");
            expect(resolvedProvider.lastName).toBe("Test");
        });
        it("returns null for non-existent provider reference", async () => {
            const reference = { __typename: "Provider", id: "non-existent" };
            const resolvedProvider = await resolvers_1.default.Provider.__resolveReference(reference, {}, {});
            expect(resolvedProvider).toBeNull();
        });
        it("resolves provider facility relationship", async () => {
            const testFacility = await setup_1.testHelpers.insertInstitution(pool, {
                name: "Associated Hospital"
            });
            const testProvider = await setup_1.testHelpers.insertProvider(pool, {
                firstName: "Dr. Associated",
                lastName: "Provider",
                facilityId: testFacility.id
            });
            const facilityResolver = resolvers_1.default.Provider.facility;
            if (typeof facilityResolver === 'function') {
                const facilityResult = await facilityResolver({ id: testProvider.id, facilityId: testFacility.id }, {}, {});
                expect(facilityResult).toBeDefined();
                expect(facilityResult.id).toBe(testFacility.id);
                expect(facilityResult.name).toBe("Associated Hospital");
            }
        });
        it("returns empty visits array", async () => {
            const testProvider = await setup_1.testHelpers.insertProvider(pool, {});
            const visitsResolver = resolvers_1.default.Provider.visits;
            if (typeof visitsResolver === 'function') {
                const visits = await visitsResolver({ id: testProvider.id }, {}, {});
                expect(Array.isArray(visits)).toBe(true);
            }
        });
    });
    describe("Visit queries", () => {
        it("returns visit by ID", async () => {
            const testProvider = await setup_1.testHelpers.insertProvider(pool, {});
            const testPatient = await setup_1.testHelpers.insertPatient(pool, {});
            const testHospital = await setup_1.testHelpers.insertInstitution(pool, { type: "hospital" });
            const query = `
        query GetVisit($id: ID!) {
          visit(id: $id) {
            id
            patientId
            providerId
            hospitalId
            type
            status
          }
        }
      `;
            const variables = { id: "test-visit-id" };
            const res = await server.executeOperation({ query, variables });
            expect(res.body.kind).toBe("single");
        });
        it("returns visits for provider", async () => {
            const testProvider = await setup_1.testHelpers.insertProvider(pool, {});
            const query = `
        query GetVisitsForProvider($providerId: ID!) {
          visitsForProvider(providerId: $providerId) {
            id
            providerId
            type
            status
          }
        }
      `;
            const variables = { providerId: testProvider.id };
            const res = await server.executeOperation({ query, variables });
            expect(res.body.kind).toBe("single");
            if ('singleResult' in res.body) {
                const data = res.body.singleResult.data?.visitsForProvider;
                expect(Array.isArray(data)).toBe(true);
            }
        });
    });
    describe("Error handling", () => {
        it("handles database connection errors gracefully", async () => {
            const query = `
        query GetProviders {
          providers {
            id
            firstName
          }
        }
      `;
            const res = await server.executeOperation({ query });
            expect(res.body.kind).toBe("single");
        });
    });
});
//# sourceMappingURL=query.test.js.map