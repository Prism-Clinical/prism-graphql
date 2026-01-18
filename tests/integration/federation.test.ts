import { ApolloServer } from '@apollo/server';
import { ApolloGateway, IntrospectAndCompose } from '@apollo/gateway';
import gql from 'graphql-tag';
import { setupTestDatabase, setupTestRedis, cleanupTestDatabase, closeTestConnections, testHelpers } from "@test-utils/setup";
import { Pool } from 'pg';
import { Redis } from 'ioredis';

describe("Healthcare Federation Integration Tests", () => {
  let gateway: ApolloGateway;
  let server: ApolloServer;
  let pool: Pool;
  let redis: Redis;

  // Service URLs for local testing
  const serviceList = [
    { name: 'patients', url: 'http://localhost:4002' },
    { name: 'providers', url: 'http://localhost:4003' },
    { name: 'recommendations', url: 'http://localhost:4001' },
    { name: 'recommendation-items', url: 'http://localhost:4004' },
    { name: 'institutions', url: 'http://localhost:4005' },
    { name: 'epic-api', url: 'http://localhost:4006' }
  ];

  beforeAll(async () => {
    pool = await setupTestDatabase();
    redis = await setupTestRedis();

    // Initialize Apollo Gateway
    gateway = new ApolloGateway({
      supergraphSdl: new IntrospectAndCompose({
        subgraphs: serviceList,
      }),
    });

    server = new ApolloServer({
      gateway,
    });
  });

  beforeEach(async () => {
    await cleanupTestDatabase();
  });

  afterAll(async () => {
    await server?.stop();
    await gateway?.stop();
    await closeTestConnections();
  });

  describe("Cross-service queries", () => {
    it("fetches patient with related data from multiple services", async () => {
      // Create test data
      const testPatient = await testHelpers.insertPatient(pool, {
        firstName: "John",
        lastName: "Doe",
        email: "john.doe@test.com"
      });

      const testProvider = await testHelpers.insertProvider(pool, {
        firstName: "Dr. Sarah",
        lastName: "Smith",
        specialty: "Cardiology"
      });

      const testRecommendation = await testHelpers.insertRecommendation(pool, {
        patientId: testPatient.id,
        providerId: testProvider.id,
        title: "Follow-up appointment",
        description: "Schedule cardiology follow-up"
      });

      const query = gql`
        query GetPatientWithRecommendations($patientId: ID!) {
          patient(id: $patientId) {
            id
            firstName
            lastName
            email
            cases {
              id
              title
              recommendations {
                id
                title
                description
                provider {
                  id
                  firstName
                  lastName
                  specialty
                }
              }
            }
          }
        }
      `;

      const variables = { patientId: testPatient.id };
      const result = await server.executeOperation({ query, variables });

      expect(result.body.kind).toBe('single');
      if ('singleResult' in result.body) {
        const patient = result.body.singleResult.data?.patient;
        expect(patient.firstName).toBe("John");
        expect(patient.lastName).toBe("Doe");
        expect(patient.email).toBe("john.doe@test.com");
        
        // Verify federated data
        expect(patient.cases).toBeDefined();
        // The exact structure depends on your resolver implementation
      }
    });

    it("fetches provider with institution and patient data", async () => {
      const testInstitution = await testHelpers.insertInstitution(pool, {
        name: "General Hospital",
        type: "hospital"
      });

      const testProvider = await testHelpers.insertProvider(pool, {
        firstName: "Dr. Sarah",
        lastName: "Smith",
        specialty: "Cardiology",
        institutionId: testInstitution.id
      });

      const query = gql`
        query GetProviderWithInstitution($providerId: ID!) {
          provider(id: $providerId) {
            id
            firstName
            lastName
            specialty
            institution {
              id
              name
              type
            }
            visits {
              id
              patient {
                id
                firstName
                lastName
              }
            }
          }
        }
      `;

      const variables = { providerId: testProvider.id };
      const result = await server.executeOperation({ query, variables });

      expect(result.body.kind).toBe('single');
      if ('singleResult' in result.body) {
        const provider = result.body.singleResult.data?.provider;
        expect(provider.firstName).toBe("Dr. Sarah");
        expect(provider.specialty).toBe("Cardiology");
        expect(provider.institution.name).toBe("General Hospital");
      }
    });
  });

  describe("Epic integration queries", () => {
    it("syncs patient data from Epic and queries federated results", async () => {
      const epicPatientId = "epic-123";

      const mutation = gql`
        mutation SyncEpicPatient($epicPatientId: String!) {
          syncEpicPatientData(epicPatientId: $epicPatientId) {
            success
            sessionId
            patient {
              id
              firstName
              lastName
              epicPatientId
            }
          }
        }
      `;

      const variables = { epicPatientId };
      const result = await server.executeOperation({ query: mutation, variables });

      expect(result.body.kind).toBe('single');
      if ('singleResult' in result.body) {
        const syncResult = result.body.singleResult.data?.syncEpicPatientData;
        expect(syncResult.success).toBe(true);
        expect(syncResult.sessionId).toBeDefined();
        expect(syncResult.patient.epicPatientId).toBe(epicPatientId);
      }
    });

    it("fetches Epic patient data with transformed format", async () => {
      const query = gql`
        query GetEpicPatientData($epicPatientId: String!) {
          epicPatientData(epicPatientId: $epicPatientId) {
            epicPatientId
            demographics {
              firstName
              lastName
              dateOfBirth
              gender
              email
            }
            vitals {
              type
              value
              unit
              recordedAt
            }
            medications {
              name
              status
              dosage
            }
          }
        }
      `;

      const variables = { epicPatientId: "epic-456" };
      const result = await server.executeOperation({ query, variables });

      expect(result.body.kind).toBe('single');
      if ('singleResult' in result.body) {
        const epicData = result.body.singleResult.data?.epicPatientData;
        expect(epicData.epicPatientId).toBe("epic-456");
        expect(epicData.demographics).toBeDefined();
        expect(Array.isArray(epicData.vitals)).toBe(true);
        expect(Array.isArray(epicData.medications)).toBe(true);
      }
    });
  });

  describe("Complex federation scenarios", () => {
    it("queries recommendations with items and evidence", async () => {
      const testPatient = await testHelpers.insertPatient(pool, {
        firstName: "Complex",
        lastName: "Case"
      });

      const testProvider = await testHelpers.insertProvider(pool, {
        firstName: "Dr. Expert",
        lastName: "Physician"
      });

      const testRecommendation = await testHelpers.insertRecommendation(pool, {
        patientId: testPatient.id,
        providerId: testProvider.id,
        title: "Complex Treatment Plan"
      });

      const testItem1 = await testHelpers.insertRecommendationItem(pool, {
        recommendationId: testRecommendation.id,
        title: "Lab Work",
        evidenceLevel: "A"
      });

      const testItem2 = await testHelpers.insertRecommendationItem(pool, {
        recommendationId: testRecommendation.id,
        title: "Follow-up",
        evidenceLevel: "B"
      });

      const query = gql`
        query GetComplexRecommendation($recommendationId: ID!) {
          recommendation(id: $recommendationId) {
            id
            title
            description
            patient {
              id
              firstName
              lastName
            }
            provider {
              id
              firstName
              lastName
              specialty
            }
            items {
              id
              title
              description
              evidenceLevel
              completed
            }
          }
        }
      `;

      const variables = { recommendationId: testRecommendation.id };
      const result = await server.executeOperation({ query, variables });

      expect(result.body.kind).toBe('single');
      if ('singleResult' in result.body) {
        const recommendation = result.body.singleResult.data?.recommendation;
        expect(recommendation.title).toBe("Complex Treatment Plan");
        expect(recommendation.patient.firstName).toBe("Complex");
        expect(recommendation.provider.firstName).toBe("Dr. Expert");
        expect(recommendation.items).toHaveLength(2);
        
        const labItem = recommendation.items.find((item: any) => item.title === "Lab Work");
        expect(labItem.evidenceLevel).toBe("A");
      }
    });

    it("searches across multiple entity types", async () => {
      // Create test data
      await testHelpers.insertPatient(pool, {
        firstName: "Search",
        lastName: "Patient",
        email: "search@test.com"
      });

      await testHelpers.insertProvider(pool, {
        firstName: "Dr. Search",
        lastName: "Provider",
        specialty: "Search Medicine"
      });

      await testHelpers.insertInstitution(pool, {
        name: "Search Hospital"
      });

      const query = gql`
        query SearchEntities($searchTerm: String!) {
          searchResults: search(term: $searchTerm) {
            ... on Patient {
              id
              firstName
              lastName
              email
              __typename
            }
            ... on Provider {
              id
              firstName
              lastName
              specialty
              __typename
            }
            ... on Institution {
              id
              name
              type
              __typename
            }
          }
        }
      `;

      const variables = { searchTerm: "Search" };
      const result = await server.executeOperation({ query, variables });

      expect(result.body.kind).toBe('single');
      if ('singleResult' in result.body) {
        const searchResults = result.body.singleResult.data?.searchResults;
        expect(Array.isArray(searchResults)).toBe(true);
        expect(searchResults.length).toBeGreaterThan(0);
        
        // Check for different entity types
        const patientResults = searchResults.filter((r: any) => r.__typename === 'Patient');
        const providerResults = searchResults.filter((r: any) => r.__typename === 'Provider');
        const institutionResults = searchResults.filter((r: any) => r.__typename === 'Institution');
        
        expect(patientResults.length).toBeGreaterThan(0);
        expect(providerResults.length).toBeGreaterThan(0);
        expect(institutionResults.length).toBeGreaterThan(0);
      }
    });
  });

  describe("Error handling and resilience", () => {
    it("handles partial service failures gracefully", async () => {
      const testPatient = await testHelpers.insertPatient(pool, {
        firstName: "Resilient",
        lastName: "Patient"
      });

      // Query that spans multiple services, some of which might fail
      const query = gql`
        query GetPatientResilient($patientId: ID!) {
          patient(id: $patientId) {
            id
            firstName
            lastName
            cases {
              id
              title
            }
          }
        }
      `;

      const variables = { patientId: testPatient.id };
      const result = await server.executeOperation({ query, variables });

      // Should still return patient data even if related services fail
      expect(result.body.kind).toBe('single');
      if ('singleResult' in result.body) {
        const patient = result.body.singleResult.data?.patient;
        expect(patient.firstName).toBe("Resilient");
        expect(patient.lastName).toBe("Patient");
        // Cases might be empty or have errors, but patient data should be present
      }
    });

    it("validates input across federated mutations", async () => {
      const mutation = gql`
        mutation CreatePatientWithRecommendation($patientInput: CreatePatientInput!, $recommendationInput: CreateRecommendationInput!) {
          createPatient(input: $patientInput) {
            id
            firstName
            lastName
          }
          createRecommendation(input: $recommendationInput) {
            id
            title
          }
        }
      `;

      const variables = {
        patientInput: {
          firstName: "",  // Invalid - empty name
          lastName: "Test"
        },
        recommendationInput: {
          title: "Test Recommendation",
          patientId: "non-existent"  // Invalid - non-existent patient
        }
      };

      const result = await server.executeOperation({ query: mutation, variables });

      expect(result.body.kind).toBe('single');
      if ('singleResult' in result.body) {
        expect(result.body.singleResult.errors).toBeDefined();
        expect(result.body.singleResult.errors!.length).toBeGreaterThan(0);
      }
    });
  });

  describe("Performance and caching", () => {
    it("caches data appropriately across services", async () => {
      const testPatient = await testHelpers.insertPatient(pool, {
        firstName: "Cache",
        lastName: "Test"
      });

      const query = gql`
        query GetPatientCached($patientId: ID!) {
          patient(id: $patientId) {
            id
            firstName
            lastName
          }
        }
      `;

      const variables = { patientId: testPatient.id };

      // First request
      const startTime1 = Date.now();
      const result1 = await server.executeOperation({ query, variables });
      const duration1 = Date.now() - startTime1;

      // Second request (should be faster due to caching)
      const startTime2 = Date.now();
      const result2 = await server.executeOperation({ query, variables });
      const duration2 = Date.now() - startTime2;

      expect(result1.body.kind).toBe('single');
      expect(result2.body.kind).toBe('single');
      
      if ('singleResult' in result1.body && 'singleResult' in result2.body) {
        expect(result1.body.singleResult.data?.patient.firstName).toBe("Cache");
        expect(result2.body.singleResult.data?.patient.firstName).toBe("Cache");
        
        // Second request should be faster (cached)
        expect(duration2).toBeLessThan(duration1);
      }
    });

    it("handles concurrent requests efficiently", async () => {
      const testPatients = await Promise.all([
        testHelpers.insertPatient(pool, { firstName: "Concurrent1", lastName: "Test" }),
        testHelpers.insertPatient(pool, { firstName: "Concurrent2", lastName: "Test" }),
        testHelpers.insertPatient(pool, { firstName: "Concurrent3", lastName: "Test" })
      ]);

      const query = gql`
        query GetPatientConcurrent($patientId: ID!) {
          patient(id: $patientId) {
            id
            firstName
            lastName
          }
        }
      `;

      // Execute multiple queries concurrently
      const promises = testPatients.map(patient => 
        server.executeOperation({ 
          query, 
          variables: { patientId: patient.id } 
        })
      );

      const results = await Promise.all(promises);

      // All requests should succeed
      results.forEach((result, index) => {
        expect(result.body.kind).toBe('single');
        if ('singleResult' in result.body) {
          expect(result.body.singleResult.data?.patient.firstName).toBe(`Concurrent${index + 1}`);
        }
      });
    });
  });
});