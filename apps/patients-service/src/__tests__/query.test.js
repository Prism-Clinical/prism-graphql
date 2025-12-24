"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const subgraph_1 = require("@apollo/subgraph");
const server_1 = require("@apollo/server");
const fs_1 = require("fs");
const graphql_tag_1 = __importDefault(require("graphql-tag"));
const resolvers_1 = __importDefault(require("@patients/resolvers"));
const setup_1 = require("@test-utils/setup");
describe("Patients Service Queries", () => {
    let server;
    let pool;
    let redis;
    beforeAll(async () => {
        pool = await (0, setup_1.setupTestDatabase)();
        redis = await (0, setup_1.setupTestRedis)();
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
    describe("patient query", () => {
        it("returns patient by ID", async () => {
            const testPatient = await setup_1.testHelpers.insertPatient(pool, {
                firstName: "John",
                lastName: "Doe",
                email: "john.doe@test.com"
            });
            const query = `
        query GetPatient($id: ID!) {
          patient(id: $id) {
            id
            firstName
            lastName
            email
            mrn
            gender
          }
        }
      `;
            const variables = { id: testPatient.id };
            const res = await server.executeOperation({ query, variables });
            expect(res.body.kind).toBe("single");
            if ('singleResult' in res.body) {
                const data = res.body.singleResult.data?.patient;
                expect(data.id).toBe(testPatient.id);
                expect(data.firstName).toBe("John");
                expect(data.lastName).toBe("Doe");
                expect(data.email).toBe("john.doe@test.com");
                expect(data.mrn).toBe(testPatient.medical_record_number);
            }
        });
        it("returns null for non-existent patient", async () => {
            const query = `
        query GetPatient($id: ID!) {
          patient(id: $id) {
            id
            firstName
          }
        }
      `;
            const variables = { id: "non-existent-id" };
            const res = await server.executeOperation({ query, variables });
            expect(res.body.kind).toBe("single");
            if ('singleResult' in res.body) {
                expect(res.body.singleResult.data?.patient).toBeNull();
            }
        });
    });
    describe("patientByMrn query", () => {
        it("returns patient by medical record number", async () => {
            const testPatient = await setup_1.testHelpers.insertPatient(pool, {
                firstName: "Jane",
                lastName: "Smith",
                medicalRecordNumber: "MRN-12345"
            });
            const query = `
        query GetPatientByMrn($mrn: String!) {
          patientByMrn(mrn: $mrn) {
            id
            firstName
            lastName
            mrn
          }
        }
      `;
            const variables = { mrn: "MRN-12345" };
            const res = await server.executeOperation({ query, variables });
            expect(res.body.kind).toBe("single");
            if ('singleResult' in res.body) {
                const data = res.body.singleResult.data?.patientByMrn;
                expect(data.id).toBe(testPatient.id);
                expect(data.firstName).toBe("Jane");
                expect(data.lastName).toBe("Smith");
                expect(data.mrn).toBe("MRN-12345");
            }
        });
    });
    describe("patients query", () => {
        it("returns list of patients with default pagination", async () => {
            await setup_1.testHelpers.insertPatient(pool, { firstName: "John", lastName: "Doe" });
            await setup_1.testHelpers.insertPatient(pool, { firstName: "Jane", lastName: "Smith" });
            await setup_1.testHelpers.insertPatient(pool, { firstName: "Bob", lastName: "Johnson" });
            const query = `
        query GetPatients {
          patients {
            id
            firstName
            lastName
          }
        }
      `;
            const res = await server.executeOperation({ query });
            expect(res.body.kind).toBe("single");
            if ('singleResult' in res.body) {
                const data = res.body.singleResult.data?.patients;
                expect(Array.isArray(data)).toBe(true);
                expect(data.length).toBe(3);
                expect(data.map((p) => p.firstName)).toEqual(expect.arrayContaining(["John", "Jane", "Bob"]));
            }
        });
        it("respects limit and offset parameters", async () => {
            for (let i = 1; i <= 5; i++) {
                await setup_1.testHelpers.insertPatient(pool, {
                    firstName: `Patient${i}`,
                    lastName: "Test"
                });
            }
            const query = `
        query GetPatients($limit: Int, $offset: Int) {
          patients(limit: $limit, offset: $offset) {
            id
            firstName
          }
        }
      `;
            const variables = { limit: 2, offset: 1 };
            const res = await server.executeOperation({ query, variables });
            expect(res.body.kind).toBe("single");
            if ('singleResult' in res.body) {
                const data = res.body.singleResult.data?.patients;
                expect(Array.isArray(data)).toBe(true);
                expect(data.length).toBe(2);
            }
        });
        it("returns empty array when no patients exist", async () => {
            const query = `
        query GetPatients {
          patients {
            id
            firstName
          }
        }
      `;
            const res = await server.executeOperation({ query });
            expect(res.body.kind).toBe("single");
            if ('singleResult' in res.body) {
                const data = res.body.singleResult.data?.patients;
                expect(Array.isArray(data)).toBe(true);
                expect(data.length).toBe(0);
            }
        });
    });
    describe("Federation resolvers", () => {
        it("resolves Patient.__resolveReference", async () => {
            const testPatient = await setup_1.testHelpers.insertPatient(pool, {
                firstName: "Federation",
                lastName: "Test"
            });
            const reference = { __typename: "Patient", id: testPatient.id };
            const resolvedPatient = await resolvers_1.default.Patient.__resolveReference(reference);
            expect(resolvedPatient).toBeDefined();
            expect(resolvedPatient.id).toBe(testPatient.id);
            expect(resolvedPatient.firstName).toBe("Federation");
            expect(resolvedPatient.lastName).toBe("Test");
        });
        it("returns null for non-existent patient reference", async () => {
            const reference = { __typename: "Patient", id: "non-existent" };
            const resolvedPatient = await resolvers_1.default.Patient.__resolveReference(reference);
            expect(resolvedPatient).toBeNull();
        });
    });
    describe("Error handling", () => {
        it("handles database connection errors gracefully", async () => {
            const query = `
        query GetPatients {
          patients {
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