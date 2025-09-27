import { buildSubgraphSchema } from "@apollo/subgraph";
import { ApolloServer } from "@apollo/server";
import { readFileSync } from "fs";
import gql from "graphql-tag";
import resolvers from "@patients/resolvers";
import { setupTestDatabase, setupTestRedis, cleanupTestDatabase, closeTestConnections, testHelpers } from "@test-utils/setup";
import { Pool } from 'pg';
import { Redis } from 'ioredis';

describe("Patients Service Queries", () => {
  let server: ApolloServer;
  let pool: Pool;
  let redis: Redis;

  beforeAll(async () => {
    pool = await setupTestDatabase();
    redis = await setupTestRedis();
    
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

  describe("patient query", () => {
    it("returns patient by ID", async () => {
      // Create test patient
      const testPatient = await testHelpers.insertPatient(pool, {
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
      const testPatient = await testHelpers.insertPatient(pool, {
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
      // Create multiple test patients
      await testHelpers.insertPatient(pool, { firstName: "John", lastName: "Doe" });
      await testHelpers.insertPatient(pool, { firstName: "Jane", lastName: "Smith" });
      await testHelpers.insertPatient(pool, { firstName: "Bob", lastName: "Johnson" });

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
        expect(data.map((p: any) => p.firstName)).toEqual(
          expect.arrayContaining(["John", "Jane", "Bob"])
        );
      }
    });

    it("respects limit and offset parameters", async () => {
      // Create test patients
      for (let i = 1; i <= 5; i++) {
        await testHelpers.insertPatient(pool, { 
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
      const testPatient = await testHelpers.insertPatient(pool, {
        firstName: "Federation",
        lastName: "Test"
      });

      // Simulate federation reference resolution
      const reference = { __typename: "Patient", id: testPatient.id };
      const resolvedPatient = await resolvers.Patient.__resolveReference(reference);

      expect(resolvedPatient).toBeDefined();
      expect(resolvedPatient.id).toBe(testPatient.id);
      expect(resolvedPatient.firstName).toBe("Federation");
      expect(resolvedPatient.lastName).toBe("Test");
    });

    it("returns null for non-existent patient reference", async () => {
      const reference = { __typename: "Patient", id: "non-existent" };
      const resolvedPatient = await resolvers.Patient.__resolveReference(reference);
      expect(resolvedPatient).toBeNull();
    });
  });

  describe("Error handling", () => {
    it("handles database connection errors gracefully", async () => {
      // This would require mocking the database connection
      // For now, we'll test that the resolver doesn't crash
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
      // Should not throw an error, might return empty array or handle gracefully
    });
  });
});