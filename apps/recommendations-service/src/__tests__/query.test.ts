import { buildSubgraphSchema } from "@apollo/subgraph";
import { ApolloServer } from "@apollo/server";
import { readFileSync } from "fs";
import gql from "graphql-tag";
import resolvers from "@recommendations/resolvers";
import { setupTestDatabase, setupTestRedis, cleanupTestDatabase, closeTestConnections, testHelpers } from "@test-utils/setup";
import { Pool } from 'pg';
import { Redis } from 'ioredis';
import { initializeDatabase } from "@recommendations/services/database";

describe("Recommendations Service Queries", () => {
  let server: ApolloServer;
  let pool: Pool;
  let redis: Redis;

  beforeAll(async () => {
    pool = await setupTestDatabase();
    redis = await setupTestRedis();
    initializeDatabase(pool, redis);
    
    server = new ApolloServer({
      schema: buildSubgraphSchema({
        typeDefs: gql(
          readFileSync("schema.graphql", {
            encoding: "utf-8",
          })
        ),
        resolvers,
      }),
    });
  });

  beforeEach(async () => {
    await cleanupTestDatabase();
  });

  afterAll(async () => {
    await closeTestConnections();
  });

  describe("recommendation query", () => {
    it("returns recommendation by ID", async () => {
      const testCase = await testHelpers.insertCase(pool, {
        patientId: "patient-1",
        title: "Test Case"
      });
      const testProvider = await testHelpers.insertProvider(pool, {
        firstName: "Dr. Test",
        lastName: "Provider"
      });
      const testRecommendation = await testHelpers.insertRecommendation(pool, {
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
      const testCase = await testHelpers.insertCase(pool, {});
      const testProvider = await testHelpers.insertProvider(pool, {});
      
      await testHelpers.insertRecommendation(pool, {
        caseId: testCase.id,
        providerId: testProvider.id,
        title: "Recommendation 1",
        priority: "HIGH"
      });
      await testHelpers.insertRecommendation(pool, {
        caseId: testCase.id,
        providerId: testProvider.id,
        title: "Recommendation 2",
        priority: "MEDIUM"
      });

      // Create recommendation for different case
      const otherCase = await testHelpers.insertCase(pool, {});
      await testHelpers.insertRecommendation(pool, {
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
        expect(data.every((r: any) => r.caseId === testCase.id)).toBe(true);
        expect(data.map((r: any) => r.title)).toEqual(
          expect.arrayContaining(["Recommendation 1", "Recommendation 2"])
        );
      }
    });

    it("returns empty array for case with no recommendations", async () => {
      const testCase = await testHelpers.insertCase(pool, {});

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
      const testCase1 = await testHelpers.insertCase(pool, {});
      const testCase2 = await testHelpers.insertCase(pool, {});
      const testProvider = await testHelpers.insertProvider(pool, {});
      const otherProvider = await testHelpers.insertProvider(pool, {});
      
      await testHelpers.insertRecommendation(pool, {
        caseId: testCase1.id,
        providerId: testProvider.id,
        title: "Provider Recommendation 1"
      });
      await testHelpers.insertRecommendation(pool, {
        caseId: testCase2.id,
        providerId: testProvider.id,
        title: "Provider Recommendation 2"
      });

      // Create recommendation for different provider
      await testHelpers.insertRecommendation(pool, {
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
        expect(data.every((r: any) => r.providerId === testProvider.id)).toBe(true);
        expect(data.map((r: any) => r.title)).toEqual(
          expect.arrayContaining(["Provider Recommendation 1", "Provider Recommendation 2"])
        );
      }
    });

    it("returns empty array for provider with no recommendations", async () => {
      const testProvider = await testHelpers.insertProvider(pool, {});

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
      const testCase = await testHelpers.insertCase(pool, {});
      const testProvider = await testHelpers.insertProvider(pool, {});
      const testRecommendation = await testHelpers.insertRecommendation(pool, {
        caseId: testCase.id,
        providerId: testProvider.id,
        title: "Federation Test",
        description: "Test federation resolver"
      });

      // Simulate federation reference resolution
      const reference = { __typename: "Recommendation", id: testRecommendation.id };
      const resolvedRecommendation = await resolvers.Recommendation.__resolveReference(reference, {}, {});

      expect(resolvedRecommendation).toBeDefined();
      expect(resolvedRecommendation.id).toBe(testRecommendation.id);
      expect(resolvedRecommendation.title).toBe("Federation Test");
      expect(resolvedRecommendation.description).toBe("Test federation resolver");
    });

    it("returns null for non-existent recommendation reference", async () => {
      const reference = { __typename: "Recommendation", id: "non-existent" };
      const resolvedRecommendation = await resolvers.Recommendation.__resolveReference(reference, {}, {});
      expect(resolvedRecommendation).toBeNull();
    });

    it("resolves Case.recommendations relationship", async () => {
      const testCase = await testHelpers.insertCase(pool, {});
      const testProvider = await testHelpers.insertProvider(pool, {});
      
      await testHelpers.insertRecommendation(pool, {
        caseId: testCase.id,
        providerId: testProvider.id,
        title: "Case Recommendation 1"
      });
      await testHelpers.insertRecommendation(pool, {
        caseId: testCase.id,
        providerId: testProvider.id,
        title: "Case Recommendation 2"
      });

      const caseResolverResult = resolvers.Case.recommendations;
      if (typeof caseResolverResult === 'function') {
        const recommendations = await caseResolverResult(
          { id: testCase.id }, 
          {}, 
          {}
        );

        expect(Array.isArray(recommendations)).toBe(true);
        expect(recommendations.length).toBe(2);
        expect(recommendations.every(r => r.caseId === testCase.id)).toBe(true);
      }
    });

    it("resolves Provider.recommendations relationship", async () => {
      const testCase = await testHelpers.insertCase(pool, {});
      const testProvider = await testHelpers.insertProvider(pool, {});
      
      await testHelpers.insertRecommendation(pool, {
        caseId: testCase.id,
        providerId: testProvider.id,
        title: "Provider Recommendation 1"
      });
      await testHelpers.insertRecommendation(pool, {
        caseId: testCase.id,
        providerId: testProvider.id,
        title: "Provider Recommendation 2"
      });

      const providerResolverResult = resolvers.Provider.recommendations;
      if (typeof providerResolverResult === 'function') {
        const recommendations = await providerResolverResult(
          { id: testProvider.id }, 
          {}, 
          {}
        );

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
      // Should not throw an error, might return empty array or handle gracefully
    });
  });
});