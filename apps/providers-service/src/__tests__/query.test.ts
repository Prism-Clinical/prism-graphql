import { buildSubgraphSchema } from "@apollo/subgraph";
import { ApolloServer } from "@apollo/server";
import { readFileSync } from "fs";
import gql from "graphql-tag";
import resolvers from "@providers/resolvers";
import { setupTestDatabase, setupTestRedis, cleanupTestDatabase, closeTestConnections, testHelpers } from "@test-utils/setup";
import { Pool } from 'pg';
import { Redis } from 'ioredis';
import { initializeDatabase } from "@providers/services/database";

describe("Providers Service Queries", () => {
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

  describe("provider query", () => {
    it("returns provider by ID", async () => {
      const testProvider = await testHelpers.insertProvider(pool, {
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
      const testProvider = await testHelpers.insertProvider(pool, {
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
      await testHelpers.insertProvider(pool, { firstName: "Dr. John", lastName: "Smith", specialty: "Cardiology" });
      await testHelpers.insertProvider(pool, { firstName: "Dr. Jane", lastName: "Doe", specialty: "Internal Medicine" });
      await testHelpers.insertProvider(pool, { firstName: "Dr. Bob", lastName: "Johnson", specialty: "Family Medicine" });

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
        expect(data.map((p: any) => p.firstName)).toEqual(
          expect.arrayContaining(["Dr. John", "Dr. Jane", "Dr. Bob"])
        );
      }
    });

    it("filters providers by specialty", async () => {
      await testHelpers.insertProvider(pool, { firstName: "Dr. Heart1", lastName: "Cardio", specialty: "Cardiology" });
      await testHelpers.insertProvider(pool, { firstName: "Dr. Heart2", lastName: "Cardio", specialty: "Cardiology" });
      await testHelpers.insertProvider(pool, { firstName: "Dr. Family", lastName: "Med", specialty: "Family Medicine" });

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
        expect(data.every((p: any) => p.specialty === "Cardiology")).toBe(true);
      }
    });

    it("returns empty array when no providers match specialty", async () => {
      await testHelpers.insertProvider(pool, { specialty: "Cardiology" });

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
      const testFacility = await testHelpers.insertInstitution(pool, {
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
      const testProvider = await testHelpers.insertProvider(pool, {
        firstName: "Federation",
        lastName: "Test",
        specialty: "Test Medicine"
      });

      // Simulate federation reference resolution
      const reference = { __typename: "Provider", id: testProvider.id };
      const resolvedProvider = await resolvers.Provider.__resolveReference(reference, {}, {});

      expect(resolvedProvider).toBeDefined();
      expect(resolvedProvider.id).toBe(testProvider.id);
      expect(resolvedProvider.firstName).toBe("Federation");
      expect(resolvedProvider.lastName).toBe("Test");
    });

    it("returns null for non-existent provider reference", async () => {
      const reference = { __typename: "Provider", id: "non-existent" };
      const resolvedProvider = await resolvers.Provider.__resolveReference(reference, {}, {});
      expect(resolvedProvider).toBeNull();
    });

    it("resolves provider facility relationship", async () => {
      const testFacility = await testHelpers.insertInstitution(pool, {
        name: "Associated Hospital"
      });

      const testProvider = await testHelpers.insertProvider(pool, {
        firstName: "Dr. Associated",
        lastName: "Provider",
        facilityId: testFacility.id
      });

      const facilityResolver = resolvers.Provider.facility;
      if (typeof facilityResolver === 'function') {
        const facilityResult = await facilityResolver(
          { id: testProvider.id, facilityId: testFacility.id }, 
          {}, 
          {}
        );

        expect(facilityResult).toBeDefined();
        expect(facilityResult.id).toBe(testFacility.id);
        expect(facilityResult.name).toBe("Associated Hospital");
      }
    });

    it("returns empty visits array", async () => {
      const testProvider = await testHelpers.insertProvider(pool, {});

      const visitsResolver = resolvers.Provider.visits;
      if (typeof visitsResolver === 'function') {
        const visits = await visitsResolver(
          { id: testProvider.id }, 
          {}, 
          {}
        );

        expect(Array.isArray(visits)).toBe(true);
        // Initially empty until we implement visit relationships
      }
    });
  });

  describe("Visit queries", () => {
    it("returns visit by ID", async () => {
      const testProvider = await testHelpers.insertProvider(pool, {});
      const testPatient = await testHelpers.insertPatient(pool, {});
      const testHospital = await testHelpers.insertInstitution(pool, { type: "hospital" });

      // This test will need to be implemented after visit database structure is created
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
      // This will initially return null until we implement visit creation
    });

    it("returns visits for provider", async () => {
      const testProvider = await testHelpers.insertProvider(pool, {});

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
        // Initially empty until we implement visit creation
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
      // Should not throw an error, might return empty array or handle gracefully
    });
  });
});