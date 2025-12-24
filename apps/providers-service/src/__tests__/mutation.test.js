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
describe("Providers Service Mutations", () => {
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
    it("creates a new provider", async () => {
        const testInstitution = await setup_1.testHelpers.insertInstitution(pool, {
            name: "Test Hospital"
        });
        const mutation = `
      mutation CreateProvider($input: CreateProviderInput!) {
        createProvider(input: $input) {
          id
          firstName
          lastName
          specialty
          email
          institutionId
        }
      }
    `;
        const variables = {
            input: {
                firstName: "Dr. John",
                lastName: "Smith",
                specialty: "Cardiology",
                email: "dr.smith@test.com",
                institutionId: testInstitution.id
            },
        };
        const res = await server.executeOperation({ query: mutation, variables });
        expect(res.body.kind).toBe("single");
        if ('singleResult' in res.body) {
            const data = res.body.singleResult.data?.createProvider;
            expect(data.firstName).toBe("Dr. John");
            expect(data.lastName).toBe("Smith");
            expect(data.specialty).toBe("Cardiology");
            expect(data.email).toBe("dr.smith@test.com");
            expect(data.institutionId).toBe(testInstitution.id);
            expect(typeof data.id).toBe("string");
        }
    });
    it("rejects provider with missing required fields", async () => {
        const mutation = `
      mutation CreateProvider($input: CreateProviderInput!) {
        createProvider(input: $input) {
          id
        }
      }
    `;
        const variables = { input: { firstName: "", lastName: "Smith" } };
        const res = await server.executeOperation({ query: mutation, variables });
        expect(res.body.kind).toBe("single");
        if ('singleResult' in res.body) {
            expect(res.body.singleResult.errors).toBeDefined();
            expect(res.body.singleResult.errors[0].message).toMatch(/required|missing/i);
        }
    });
    it("updates provider information", async () => {
        const testProvider = await setup_1.testHelpers.insertProvider(pool, {
            firstName: "Dr. Jane",
            lastName: "Doe",
            specialty: "Internal Medicine",
            email: "jane.doe@test.com"
        });
        const mutation = `
      mutation UpdateProvider($id: ID!, $input: UpdateProviderInput!) {
        updateProvider(id: $id, input: $input) {
          id
          firstName
          lastName
          specialty
          email
        }
      }
    `;
        const variables = {
            id: testProvider.id,
            input: {
                specialty: "Family Medicine",
                email: "jane.smith@test.com"
            }
        };
        const res = await server.executeOperation({ query: mutation, variables });
        expect(res.body.kind).toBe("single");
        if ('singleResult' in res.body) {
            const data = res.body.singleResult.data?.updateProvider;
            expect(data.firstName).toBe("Dr. Jane");
            expect(data.lastName).toBe("Doe");
            expect(data.specialty).toBe("Family Medicine");
            expect(data.email).toBe("jane.smith@test.com");
        }
    });
    it("deletes a provider", async () => {
        const testProvider = await setup_1.testHelpers.insertProvider(pool, {
            firstName: "Delete",
            lastName: "Me"
        });
        const mutation = `
      mutation DeleteProvider($id: ID!) {
        deleteProvider(id: $id)
      }
    `;
        const variables = { id: testProvider.id };
        const res = await server.executeOperation({ query: mutation, variables });
        expect(res.body.kind).toBe("single");
        if ('singleResult' in res.body) {
            expect(res.body.singleResult.data?.deleteProvider).toBe(true);
        }
        const queryRes = await pool.query('SELECT * FROM providers WHERE id = $1', [testProvider.id]);
        expect(queryRes.rows.length).toBe(0);
    });
});
//# sourceMappingURL=mutation.test.js.map