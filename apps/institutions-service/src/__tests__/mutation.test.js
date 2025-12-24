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
describe("Product Mutation", () => {
    const server = new server_1.ApolloServer({
        schema: (0, subgraph_1.buildSubgraphSchema)({
            typeDefs: (0, graphql_tag_1.default)((0, fs_1.readFileSync)("schema.graphql", {
                encoding: "utf-8",
            })),
            resolvers: resolvers_1.default,
        }),
    });
    it("creates a new product", async () => {
        const mutation = `
      mutation CreateProduct($input: CreateProductInput!) {
        createProduct(input: $input) {
          id
          name
          description
        }
      }
    `;
        const variables = {
            input: { name: "Test Product", description: "A test product" },
        };
        const res = await server.executeOperation({ query: mutation, variables });
        expect(res.body.kind).toBe("single");
        const data = res.body.singleResult.data.createProduct;
        expect(data.name).toBe("Test Product");
        expect(data.description).toBe("A test product");
        expect(typeof data.id).toBe("string");
    });
    it("rejects empty product name", async () => {
        const mutation = `
      mutation CreateProduct($input: CreateProductInput!) {
        createProduct(input: $input) {
          id
        }
      }
    `;
        const variables = { input: { name: "", description: "desc" } };
        const res = await server.executeOperation({ query: mutation, variables });
        expect(res.body.kind).toBe("single");
        expect(res.body.singleResult.errors[0].message).toMatch(/name is required/i);
    });
    it("rejects duplicate product name", async () => {
        const mutation = `
      mutation CreateProduct($input: CreateProductInput!) {
        createProduct(input: $input) {
          id
        }
      }
    `;
        const variables = { input: { name: "Test Product", description: "desc" } };
        const res = await server.executeOperation({ query: mutation, variables });
        expect(res.body.kind).toBe("single");
        expect(res.body.singleResult.errors[0].message).toMatch(/already exists/i);
    });
});
//# sourceMappingURL=mutation.test.js.map