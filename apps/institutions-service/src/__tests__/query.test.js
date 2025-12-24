"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const subgraph_1 = require("@apollo/subgraph");
const server_1 = require("@apollo/server");
const fs_1 = require("fs");
const graphql_tag_1 = __importDefault(require("graphql-tag"));
const resolvers_1 = __importDefault(require("@institutions/resolvers"));
const setup_1 = require("@test-utils/setup");
const database_1 = require("@institutions/services/database");
describe("Institutions Service Queries", () => {
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
    describe("institution query", () => {
        it("returns institution by ID", async () => {
            const testInstitution = await setup_1.testHelpers.insertInstitution(pool, {
                name: "Metropolitan Health System",
                type: "HOSPITAL_SYSTEM",
                phone: "(555) 123-4567",
                email: "info@metro-health.com",
                address: {
                    street: "1000 Medical Center Blvd",
                    city: "Metro City",
                    state: "CA",
                    zip: "90210"
                }
            });
            const query = `
        query GetInstitution($id: ID!) {
          institution(id: $id) {
            id
            name
            type
            address {
              street
              city
              state
              zipCode
              country
            }
            phone
            email
            website
            accreditation
            isActive
          }
        }
      `;
            const variables = { id: testInstitution.id };
            const res = await server.executeOperation({ query, variables });
            expect(res.body.kind).toBe("single");
            if ('singleResult' in res.body) {
                const data = res.body.singleResult.data?.institution;
                expect(data.id).toBe(testInstitution.id);
                expect(data.name).toBe("Metropolitan Health System");
                expect(data.type).toBe("HOSPITAL_SYSTEM");
                expect(data.phone).toBe("(555) 123-4567");
                expect(data.email).toBe("info@metro-health.com");
                expect(data.address.street).toBe("1000 Medical Center Blvd");
                expect(data.address.city).toBe("Metro City");
            }
        });
        it("returns null for non-existent institution", async () => {
            const query = `
        query GetInstitution($id: ID!) {
          institution(id: $id) {
            id
            name
          }
        }
      `;
            const variables = { id: "non-existent-id" };
            const res = await server.executeOperation({ query, variables });
            expect(res.body.kind).toBe("single");
            if ('singleResult' in res.body) {
                expect(res.body.singleResult.data?.institution).toBeNull();
            }
        });
    });
    describe("institutions query", () => {
        it("returns list of all institutions", async () => {
            await setup_1.testHelpers.insertInstitution(pool, { name: "Institution 1", type: "HOSPITAL_SYSTEM" });
            await setup_1.testHelpers.insertInstitution(pool, { name: "Institution 2", type: "MEDICAL_CENTER" });
            await setup_1.testHelpers.insertInstitution(pool, { name: "Institution 3", type: "UNIVERSITY" });
            const query = `
        query GetInstitutions {
          institutions {
            id
            name
            type
          }
        }
      `;
            const res = await server.executeOperation({ query });
            expect(res.body.kind).toBe("single");
            if ('singleResult' in res.body) {
                const data = res.body.singleResult.data?.institutions;
                expect(Array.isArray(data)).toBe(true);
                expect(data.length).toBe(3);
                expect(data.map((i) => i.name)).toEqual(expect.arrayContaining(["Institution 1", "Institution 2", "Institution 3"]));
            }
        });
        it("filters institutions by type", async () => {
            await setup_1.testHelpers.insertInstitution(pool, { name: "Hospital System 1", type: "HOSPITAL_SYSTEM" });
            await setup_1.testHelpers.insertInstitution(pool, { name: "Medical Center 1", type: "MEDICAL_CENTER" });
            await setup_1.testHelpers.insertInstitution(pool, { name: "Hospital System 2", type: "HOSPITAL_SYSTEM" });
            const query = `
        query GetInstitutionsByType($type: InstitutionType) {
          institutions(type: $type) {
            id
            name
            type
          }
        }
      `;
            const variables = { type: "HOSPITAL_SYSTEM" };
            const res = await server.executeOperation({ query, variables });
            expect(res.body.kind).toBe("single");
            if ('singleResult' in res.body) {
                const data = res.body.singleResult.data?.institutions;
                expect(Array.isArray(data)).toBe(true);
                expect(data.length).toBe(2);
                expect(data.every((i) => i.type === "HOSPITAL_SYSTEM")).toBe(true);
            }
        });
        it("returns empty array when no institutions match type", async () => {
            await setup_1.testHelpers.insertInstitution(pool, { type: "HOSPITAL_SYSTEM" });
            const query = `
        query GetInstitutionsByType($type: InstitutionType) {
          institutions(type: $type) {
            id
            type
          }
        }
      `;
            const variables = { type: "RESEARCH_INSTITUTE" };
            const res = await server.executeOperation({ query, variables });
            expect(res.body.kind).toBe("single");
            if ('singleResult' in res.body) {
                const data = res.body.singleResult.data?.institutions;
                expect(Array.isArray(data)).toBe(true);
                expect(data.length).toBe(0);
            }
        });
    });
    describe("hospital query", () => {
        it("returns hospital by ID", async () => {
            const testInstitution = await setup_1.testHelpers.insertInstitution(pool, {
                name: "Parent Health System"
            });
            const query = `
        query GetHospital($id: ID!) {
          hospital(id: $id) {
            id
            name
            institutionId
            address {
              street
              city
              state
              zipCode
              country
            }
            phone
            email
            beds
            departments
            emergencyServices
            isActive
          }
        }
      `;
            const variables = { id: "test-hospital-id" };
            const res = await server.executeOperation({ query, variables });
            expect(res.body.kind).toBe("single");
        });
    });
    describe("hospitals query", () => {
        it("returns list of all hospitals", async () => {
            const testInstitution = await setup_1.testHelpers.insertInstitution(pool, {});
            const query = `
        query GetHospitals {
          hospitals {
            id
            name
            institutionId
          }
        }
      `;
            const res = await server.executeOperation({ query });
            expect(res.body.kind).toBe("single");
            if ('singleResult' in res.body) {
                const data = res.body.singleResult.data?.hospitals;
                expect(Array.isArray(data)).toBe(true);
            }
        });
        it("filters hospitals by institution", async () => {
            const testInstitution = await setup_1.testHelpers.insertInstitution(pool, {});
            const query = `
        query GetHospitalsByInstitution($institutionId: ID) {
          hospitals(institutionId: $institutionId) {
            id
            name
            institutionId
          }
        }
      `;
            const variables = { institutionId: testInstitution.id };
            const res = await server.executeOperation({ query, variables });
            expect(res.body.kind).toBe("single");
            if ('singleResult' in res.body) {
                const data = res.body.singleResult.data?.hospitals;
                expect(Array.isArray(data)).toBe(true);
            }
        });
    });
    describe("hospitalsByInstitution query", () => {
        it("returns hospitals for a specific institution", async () => {
            const testInstitution = await setup_1.testHelpers.insertInstitution(pool, {});
            const query = `
        query GetHospitalsByInstitution($institutionId: ID!) {
          hospitalsByInstitution(institutionId: $institutionId) {
            id
            name
            institutionId
          }
        }
      `;
            const variables = { institutionId: testInstitution.id };
            const res = await server.executeOperation({ query, variables });
            expect(res.body.kind).toBe("single");
            if ('singleResult' in res.body) {
                const data = res.body.singleResult.data?.hospitalsByInstitution;
                expect(Array.isArray(data)).toBe(true);
            }
        });
    });
    describe("Federation resolvers", () => {
        it("resolves Institution.__resolveReference", async () => {
            const testInstitution = await setup_1.testHelpers.insertInstitution(pool, {
                name: "Federation Test Institution",
                type: "MEDICAL_CENTER"
            });
            const reference = { __typename: "Institution", id: testInstitution.id };
            const resolvedInstitution = await resolvers_1.default.Institution.__resolveReference(reference, {}, {});
            expect(resolvedInstitution).toBeDefined();
            expect(resolvedInstitution.id).toBe(testInstitution.id);
            expect(resolvedInstitution.name).toBe("Federation Test Institution");
        });
        it("returns null for non-existent institution reference", async () => {
            const reference = { __typename: "Institution", id: "non-existent" };
            const resolvedInstitution = await resolvers_1.default.Institution.__resolveReference(reference, {}, {});
            expect(resolvedInstitution).toBeNull();
        });
        it("resolves Hospital.__resolveReference", async () => {
            const reference = { __typename: "Hospital", id: "test-hospital-id" };
            const resolvedHospital = await resolvers_1.default.Hospital.__resolveReference(reference, {}, {});
            expect(resolvedHospital).toBeNull();
        });
        it("resolves Hospital.institution relationship", async () => {
            const testInstitution = await setup_1.testHelpers.insertInstitution(pool, {
                name: "Parent Institution"
            });
            const hospitalResolverResult = resolvers_1.default.Hospital.institution;
            if (typeof hospitalResolverResult === 'function') {
                const institution = await hospitalResolverResult({ institutionId: testInstitution.id }, {}, {});
                expect(institution).toBeDefined();
                expect(institution.id).toBe(testInstitution.id);
                expect(institution.name).toBe("Parent Institution");
            }
        });
        it("resolves Hospital.visits relationship", async () => {
            const visitsResolverResult = resolvers_1.default.Hospital.visits;
            if (typeof visitsResolverResult === 'function') {
                const visits = await visitsResolverResult({ id: "test-hospital-id" }, {}, {});
                expect(Array.isArray(visits)).toBe(true);
            }
        });
    });
    describe("Error handling", () => {
        it("handles database connection errors gracefully", async () => {
            const query = `
        query GetInstitutions {
          institutions {
            id
            name
          }
        }
      `;
            const res = await server.executeOperation({ query });
            expect(res.body.kind).toBe("single");
        });
    });
});
//# sourceMappingURL=query.test.js.map