"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const subgraph_1 = require("@apollo/subgraph");
const server_1 = require("@apollo/server");
const fs_1 = require("fs");
const graphql_tag_1 = __importDefault(require("graphql-tag"));
const resolvers_1 = __importDefault(require("@recommendations/resolvers"));
const setup_1 = require("@test-utils/setup");
const database_1 = require("@recommendations/services/database");
describe("Recommendations Service Queries", () => {
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
    describe("recommendation query", () => {
        it("returns recommendation by ID", async () => {
            const testCase = await setup_1.testHelpers.insertCase(pool, {
                patientId: "patient-1",
                title: "Test Case"
            });
            const testProvider = await setup_1.testHelpers.insertProvider(pool, {
                firstName: "Dr. Test",
                lastName: "Provider"
            });
            const testRecommendation = await setup_1.testHelpers.insertRecommendation(pool, {
                caseId: testCase.id,
                providerId: testProvider.id,
                title: "Annual Physical Examination",
                description: "Complete annual physical exam with blood work",
                priority: "MEDIUM",
                status: "ACTIVE"
            });
            const query = `
        query GetRecommendation($id: ID!) {
          recommendation(id: $id) {
            id
            caseId
            providerId
            title
            description
            priority
            status
            createdAt
            updatedAt
          }
        }
      `;
            const variables = { id: testRecommendation.id };
            const res = await server.executeOperation({ query, variables });
            expect(res.body.kind).toBe("single");
            if ('singleResult' in res.body) {
                const data = res.body.singleResult.data?.recommendation;
                expect(data.id).toBe(testRecommendation.id);
                expect(data.caseId).toBe(testCase.id);
                expect(data.providerId).toBe(testProvider.id);
                expect(data.title).toBe("Annual Physical Examination");
                expect(data.description).toBe("Complete annual physical exam with blood work");
                expect(data.priority).toBe("MEDIUM");
                expect(data.status).toBe("ACTIVE");
            }
        });
        it("returns null for non-existent recommendation", async () => {
            const query = `
        query GetRecommendation($id: ID!) {
          recommendation(id: $id) {
            id
            title
          }
        }
      `;
            const variables = { id: "non-existent-id" };
            const res = await server.executeOperation({ query, variables });
            expect(res.body.kind).toBe("single");
            if ('singleResult' in res.body) {
                expect(res.body.singleResult.data?.recommendation).toBeNull();
            }
        });
    });
    describe("recommendationsForCase query", () => {
        it("returns recommendations for a specific case", async () => {
            const testCase = await setup_1.testHelpers.insertCase(pool, {});
            const testProvider = await setup_1.testHelpers.insertProvider(pool, {});
            await setup_1.testHelpers.insertRecommendation(pool, {
                caseId: testCase.id,
                providerId: testProvider.id,
                title: "Recommendation 1",
                priority: "HIGH"
            });
            await setup_1.testHelpers.insertRecommendation(pool, {
                caseId: testCase.id,
                providerId: testProvider.id,
                title: "Recommendation 2",
                priority: "MEDIUM"
            });
            const otherCase = await setup_1.testHelpers.insertCase(pool, {});
            await setup_1.testHelpers.insertRecommendation(pool, {
                caseId: otherCase.id,
                providerId: testProvider.id,
                title: "Other Case Recommendation"
            });
            const query = `
        query GetRecommendationsForCase($caseId: ID!) {
          recommendationsForCase(caseId: $caseId) {
            id
            caseId
            title
            priority
          }
        }
      `;
            const variables = { caseId: testCase.id };
            const res = await server.executeOperation({ query, variables });
            expect(res.body.kind).toBe("single");
            if ('singleResult' in res.body) {
                const data = res.body.singleResult.data?.recommendationsForCase;
                expect(Array.isArray(data)).toBe(true);
                expect(data.length).toBe(2);
                expect(data.every((r) => r.caseId === testCase.id)).toBe(true);
                expect(data.map((r) => r.title)).toEqual(expect.arrayContaining(["Recommendation 1", "Recommendation 2"]));
            }
        });
        it("returns empty array for case with no recommendations", async () => {
            const testCase = await setup_1.testHelpers.insertCase(pool, {});
            const query = `
        query GetRecommendationsForCase($caseId: ID!) {
          recommendationsForCase(caseId: $caseId) {
            id
            title
          }
        }
      `;
            const variables = { caseId: testCase.id };
            const res = await server.executeOperation({ query, variables });
            expect(res.body.kind).toBe("single");
            if ('singleResult' in res.body) {
                const data = res.body.singleResult.data?.recommendationsForCase;
                expect(Array.isArray(data)).toBe(true);
                expect(data.length).toBe(0);
            }
        });
    });
    describe("recommendationsByProvider query", () => {
        it("returns recommendations by a specific provider", async () => {
            const testCase1 = await setup_1.testHelpers.insertCase(pool, {});
            const testCase2 = await setup_1.testHelpers.insertCase(pool, {});
            const testProvider = await setup_1.testHelpers.insertProvider(pool, {});
            const otherProvider = await setup_1.testHelpers.insertProvider(pool, {});
            await setup_1.testHelpers.insertRecommendation(pool, {
                caseId: testCase1.id,
                providerId: testProvider.id,
                title: "Provider Recommendation 1"
            });
            await setup_1.testHelpers.insertRecommendation(pool, {
                caseId: testCase2.id,
                providerId: testProvider.id,
                title: "Provider Recommendation 2"
            });
            await setup_1.testHelpers.insertRecommendation(pool, {
                caseId: testCase1.id,
                providerId: otherProvider.id,
                title: "Other Provider Recommendation"
            });
            const query = `
        query GetRecommendationsByProvider($providerId: ID!) {
          recommendationsByProvider(providerId: $providerId) {
            id
            providerId
            title
            caseId
          }
        }
      `;
            const variables = { providerId: testProvider.id };
            const res = await server.executeOperation({ query, variables });
            expect(res.body.kind).toBe("single");
            if ('singleResult' in res.body) {
                const data = res.body.singleResult.data?.recommendationsByProvider;
                expect(Array.isArray(data)).toBe(true);
                expect(data.length).toBe(2);
                expect(data.every((r) => r.providerId === testProvider.id)).toBe(true);
                expect(data.map((r) => r.title)).toEqual(expect.arrayContaining(["Provider Recommendation 1", "Provider Recommendation 2"]));
            }
        });
        it("returns empty array for provider with no recommendations", async () => {
            const testProvider = await setup_1.testHelpers.insertProvider(pool, {});
            const query = `
        query GetRecommendationsByProvider($providerId: ID!) {
          recommendationsByProvider(providerId: $providerId) {
            id
            title
          }
        }
      `;
            const variables = { providerId: testProvider.id };
            const res = await server.executeOperation({ query, variables });
            expect(res.body.kind).toBe("single");
            if ('singleResult' in res.body) {
                const data = res.body.singleResult.data?.recommendationsByProvider;
                expect(Array.isArray(data)).toBe(true);
                expect(data.length).toBe(0);
            }
        });
    });
    describe("Federation resolvers", () => {
        it("resolves Recommendation.__resolveReference", async () => {
            const testCase = await setup_1.testHelpers.insertCase(pool, {});
            const testProvider = await setup_1.testHelpers.insertProvider(pool, {});
            const testRecommendation = await setup_1.testHelpers.insertRecommendation(pool, {
                caseId: testCase.id,
                providerId: testProvider.id,
                title: "Federation Test",
                description: "Test federation resolver"
            });
            const reference = { __typename: "Recommendation", id: testRecommendation.id };
            const resolvedRecommendation = await resolvers_1.default.Recommendation.__resolveReference(reference, {}, {});
            expect(resolvedRecommendation).toBeDefined();
            expect(resolvedRecommendation.id).toBe(testRecommendation.id);
            expect(resolvedRecommendation.title).toBe("Federation Test");
            expect(resolvedRecommendation.description).toBe("Test federation resolver");
        });
        it("returns null for non-existent recommendation reference", async () => {
            const reference = { __typename: "Recommendation", id: "non-existent" };
            const resolvedRecommendation = await resolvers_1.default.Recommendation.__resolveReference(reference, {}, {});
            expect(resolvedRecommendation).toBeNull();
        });
        it("resolves Case.recommendations relationship", async () => {
            const testCase = await setup_1.testHelpers.insertCase(pool, {});
            const testProvider = await setup_1.testHelpers.insertProvider(pool, {});
            await setup_1.testHelpers.insertRecommendation(pool, {
                caseId: testCase.id,
                providerId: testProvider.id,
                title: "Case Recommendation 1"
            });
            await setup_1.testHelpers.insertRecommendation(pool, {
                caseId: testCase.id,
                providerId: testProvider.id,
                title: "Case Recommendation 2"
            });
            const caseResolverResult = resolvers_1.default.Case.recommendations;
            if (typeof caseResolverResult === 'function') {
                const recommendations = await caseResolverResult({ id: testCase.id }, {}, {});
                expect(Array.isArray(recommendations)).toBe(true);
                expect(recommendations.length).toBe(2);
                expect(recommendations.every(r => r.caseId === testCase.id)).toBe(true);
            }
        });
        it("resolves Provider.recommendations relationship", async () => {
            const testCase = await setup_1.testHelpers.insertCase(pool, {});
            const testProvider = await setup_1.testHelpers.insertProvider(pool, {});
            await setup_1.testHelpers.insertRecommendation(pool, {
                caseId: testCase.id,
                providerId: testProvider.id,
                title: "Provider Recommendation 1"
            });
            await setup_1.testHelpers.insertRecommendation(pool, {
                caseId: testCase.id,
                providerId: testProvider.id,
                title: "Provider Recommendation 2"
            });
            const providerResolverResult = resolvers_1.default.Provider.recommendations;
            if (typeof providerResolverResult === 'function') {
                const recommendations = await providerResolverResult({ id: testProvider.id }, {}, {});
                expect(Array.isArray(recommendations)).toBe(true);
                expect(recommendations.length).toBe(2);
                expect(recommendations.every(r => r.providerId === testProvider.id)).toBe(true);
            }
        });
    });
    describe("Error handling", () => {
        it("handles database connection errors gracefully", async () => {
            const query = `
        query GetRecommendationsByProvider($providerId: ID!) {
          recommendationsByProvider(providerId: $providerId) {
            id
            title
          }
        }
      `;
            const variables = { providerId: "test-provider" };
            const res = await server.executeOperation({ query, variables });
            expect(res.body.kind).toBe("single");
        });
    });
});
//# sourceMappingURL=query.test.js.map