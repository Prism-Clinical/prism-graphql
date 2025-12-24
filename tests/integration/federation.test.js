"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const server_1 = require("@apollo/server");
const gateway_1 = require("@apollo/gateway");
const graphql_tag_1 = __importDefault(require("graphql-tag"));
const setup_1 = require("@test-utils/setup");
describe("Healthcare Federation Integration Tests", () => {
    let gateway;
    let server;
    let pool;
    let redis;
    const serviceList = [
        { name: 'patients', url: 'http://localhost:4002' },
        { name: 'providers', url: 'http://localhost:4003' },
        { name: 'recommendations', url: 'http://localhost:4001' },
        { name: 'recommendation-items', url: 'http://localhost:4004' },
        { name: 'institutions', url: 'http://localhost:4005' },
        { name: 'epic-api', url: 'http://localhost:4006' }
    ];
    beforeAll(async () => {
        pool = await (0, setup_1.setupTestDatabase)();
        redis = await (0, setup_1.setupTestRedis)();
        gateway = new gateway_1.ApolloGateway({
            supergraphSdl: new gateway_1.IntrospectAndCompose({
                subgraphs: serviceList,
            }),
        });
        server = new server_1.ApolloServer({
            gateway,
        });
    });
    beforeEach(async () => {
        await (0, setup_1.cleanupTestDatabase)();
    });
    afterAll(async () => {
        await server?.stop();
        await gateway?.stop();
        await (0, setup_1.closeTestConnections)();
    });
    describe("Cross-service queries", () => {
        it("fetches patient with related data from multiple services", async () => {
            const testPatient = await setup_1.testHelpers.insertPatient(pool, {
                firstName: "John",
                lastName: "Doe",
                email: "john.doe@test.com"
            });
            const testProvider = await setup_1.testHelpers.insertProvider(pool, {
                firstName: "Dr. Sarah",
                lastName: "Smith",
                specialty: "Cardiology"
            });
            const testRecommendation = await setup_1.testHelpers.insertRecommendation(pool, {
                patientId: testPatient.id,
                providerId: testProvider.id,
                title: "Follow-up appointment",
                description: "Schedule cardiology follow-up"
            });
            const query = (0, graphql_tag_1.default) `
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
                expect(patient.cases).toBeDefined();
            }
        });
        it("fetches provider with institution and patient data", async () => {
            const testInstitution = await setup_1.testHelpers.insertInstitution(pool, {
                name: "General Hospital",
                type: "hospital"
            });
            const testProvider = await setup_1.testHelpers.insertProvider(pool, {
                firstName: "Dr. Sarah",
                lastName: "Smith",
                specialty: "Cardiology",
                institutionId: testInstitution.id
            });
            const query = (0, graphql_tag_1.default) `
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
            const mutation = (0, graphql_tag_1.default) `
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
            const query = (0, graphql_tag_1.default) `
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
            const testPatient = await setup_1.testHelpers.insertPatient(pool, {
                firstName: "Complex",
                lastName: "Case"
            });
            const testProvider = await setup_1.testHelpers.insertProvider(pool, {
                firstName: "Dr. Expert",
                lastName: "Physician"
            });
            const testRecommendation = await setup_1.testHelpers.insertRecommendation(pool, {
                patientId: testPatient.id,
                providerId: testProvider.id,
                title: "Complex Treatment Plan"
            });
            const testItem1 = await setup_1.testHelpers.insertRecommendationItem(pool, {
                recommendationId: testRecommendation.id,
                title: "Lab Work",
                evidenceLevel: "A"
            });
            const testItem2 = await setup_1.testHelpers.insertRecommendationItem(pool, {
                recommendationId: testRecommendation.id,
                title: "Follow-up",
                evidenceLevel: "B"
            });
            const query = (0, graphql_tag_1.default) `
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
                const labItem = recommendation.items.find((item) => item.title === "Lab Work");
                expect(labItem.evidenceLevel).toBe("A");
            }
        });
        it("searches across multiple entity types", async () => {
            await setup_1.testHelpers.insertPatient(pool, {
                firstName: "Search",
                lastName: "Patient",
                email: "search@test.com"
            });
            await setup_1.testHelpers.insertProvider(pool, {
                firstName: "Dr. Search",
                lastName: "Provider",
                specialty: "Search Medicine"
            });
            await setup_1.testHelpers.insertInstitution(pool, {
                name: "Search Hospital"
            });
            const query = (0, graphql_tag_1.default) `
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
                const patientResults = searchResults.filter((r) => r.__typename === 'Patient');
                const providerResults = searchResults.filter((r) => r.__typename === 'Provider');
                const institutionResults = searchResults.filter((r) => r.__typename === 'Institution');
                expect(patientResults.length).toBeGreaterThan(0);
                expect(providerResults.length).toBeGreaterThan(0);
                expect(institutionResults.length).toBeGreaterThan(0);
            }
        });
    });
    describe("Error handling and resilience", () => {
        it("handles partial service failures gracefully", async () => {
            const testPatient = await setup_1.testHelpers.insertPatient(pool, {
                firstName: "Resilient",
                lastName: "Patient"
            });
            const query = (0, graphql_tag_1.default) `
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
            expect(result.body.kind).toBe('single');
            if ('singleResult' in result.body) {
                const patient = result.body.singleResult.data?.patient;
                expect(patient.firstName).toBe("Resilient");
                expect(patient.lastName).toBe("Patient");
            }
        });
        it("validates input across federated mutations", async () => {
            const mutation = (0, graphql_tag_1.default) `
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
                    firstName: "",
                    lastName: "Test"
                },
                recommendationInput: {
                    title: "Test Recommendation",
                    patientId: "non-existent"
                }
            };
            const result = await server.executeOperation({ query: mutation, variables });
            expect(result.body.kind).toBe('single');
            if ('singleResult' in result.body) {
                expect(result.body.singleResult.errors).toBeDefined();
                expect(result.body.singleResult.errors.length).toBeGreaterThan(0);
            }
        });
    });
    describe("Performance and caching", () => {
        it("caches data appropriately across services", async () => {
            const testPatient = await setup_1.testHelpers.insertPatient(pool, {
                firstName: "Cache",
                lastName: "Test"
            });
            const query = (0, graphql_tag_1.default) `
        query GetPatientCached($patientId: ID!) {
          patient(id: $patientId) {
            id
            firstName
            lastName
          }
        }
      `;
            const variables = { patientId: testPatient.id };
            const startTime1 = Date.now();
            const result1 = await server.executeOperation({ query, variables });
            const duration1 = Date.now() - startTime1;
            const startTime2 = Date.now();
            const result2 = await server.executeOperation({ query, variables });
            const duration2 = Date.now() - startTime2;
            expect(result1.body.kind).toBe('single');
            expect(result2.body.kind).toBe('single');
            if ('singleResult' in result1.body && 'singleResult' in result2.body) {
                expect(result1.body.singleResult.data?.patient.firstName).toBe("Cache");
                expect(result2.body.singleResult.data?.patient.firstName).toBe("Cache");
                expect(duration2).toBeLessThan(duration1);
            }
        });
        it("handles concurrent requests efficiently", async () => {
            const testPatients = await Promise.all([
                setup_1.testHelpers.insertPatient(pool, { firstName: "Concurrent1", lastName: "Test" }),
                setup_1.testHelpers.insertPatient(pool, { firstName: "Concurrent2", lastName: "Test" }),
                setup_1.testHelpers.insertPatient(pool, { firstName: "Concurrent3", lastName: "Test" })
            ]);
            const query = (0, graphql_tag_1.default) `
        query GetPatientConcurrent($patientId: ID!) {
          patient(id: $patientId) {
            id
            firstName
            lastName
          }
        }
      `;
            const promises = testPatients.map(patient => server.executeOperation({
                query,
                variables: { patientId: patient.id }
            }));
            const results = await Promise.all(promises);
            results.forEach((result, index) => {
                expect(result.body.kind).toBe('single');
                if ('singleResult' in result.body) {
                    expect(result.body.singleResult.data?.patient.firstName).toBe(`Concurrent${index + 1}`);
                }
            });
        });
    });
});
//# sourceMappingURL=federation.test.js.map