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
describe("Patients Service Mutations", () => {
    let server;
    let pool;
    beforeAll(async () => {
        pool = await (0, setup_1.setupTestDatabase)();
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
    it("creates a new patient", async () => {
        const mutation = `
      mutation CreatePatient($input: CreatePatientInput!) {
        createPatient(input: $input) {
          id
          firstName
          lastName
          email
          mrn
        }
      }
    `;
        const variables = {
            input: {
                firstName: "John",
                lastName: "Doe",
                email: "john.doe@test.com",
                dateOfBirth: "1985-05-15",
                gender: "MALE"
            },
        };
        const res = await server.executeOperation({ query: mutation, variables });
        expect(res.body.kind).toBe("single");
        if ('singleResult' in res.body) {
            const data = res.body.singleResult.data?.createPatient;
            expect(data.firstName).toBe("John");
            expect(data.lastName).toBe("Doe");
            expect(data.email).toBe("john.doe@test.com");
            expect(typeof data.id).toBe("string");
            expect(typeof data.mrn).toBe("string");
        }
    });
    it("rejects patient with missing required fields", async () => {
        const mutation = `
      mutation CreatePatient($input: CreatePatientInput!) {
        createPatient(input: $input) {
          id
        }
      }
    `;
        const variables = { input: { firstName: "", lastName: "Doe" } };
        const res = await server.executeOperation({ query: mutation, variables });
        expect(res.body.kind).toBe("single");
        if ('singleResult' in res.body) {
            expect(res.body.singleResult.errors).toBeDefined();
            expect(res.body.singleResult.errors[0].message).toMatch(/required|missing/i);
        }
    });
    it("updates patient information", async () => {
        const testPatient = await setup_1.testHelpers.insertPatient(pool, {
            firstName: "Jane",
            lastName: "Smith",
            email: "jane.smith@test.com"
        });
        const mutation = `
      mutation UpdatePatient($id: ID!, $input: UpdatePatientInput!) {
        updatePatient(id: $id, input: $input) {
          id
          firstName
          lastName
          email
        }
      }
    `;
        const variables = {
            id: testPatient.id,
            input: {
                firstName: "Janet",
                email: "janet.smith@test.com"
            }
        };
        const res = await server.executeOperation({ query: mutation, variables });
        expect(res.body.kind).toBe("single");
        if ('singleResult' in res.body) {
            const data = res.body.singleResult.data?.updatePatient;
            expect(data.firstName).toBe("Janet");
            expect(data.lastName).toBe("Smith");
            expect(data.email).toBe("janet.smith@test.com");
        }
    });
    it("deletes a patient", async () => {
        const testPatient = await setup_1.testHelpers.insertPatient(pool, {
            firstName: "Delete",
            lastName: "Me"
        });
        const mutation = `
      mutation DeletePatient($id: ID!) {
        deletePatient(id: $id)
      }
    `;
        const variables = { id: testPatient.id };
        const res = await server.executeOperation({ query: mutation, variables });
        expect(res.body.kind).toBe("single");
        if ('singleResult' in res.body) {
            expect(res.body.singleResult.data?.deletePatient).toBe(true);
        }
        const queryRes = await pool.query('SELECT * FROM patients WHERE id = $1', [testPatient.id]);
        expect(queryRes.rows.length).toBe(0);
    });
});
//# sourceMappingURL=mutation.test.js.map