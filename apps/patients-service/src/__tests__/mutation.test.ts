import { buildSubgraphSchema } from "@apollo/subgraph";
import { ApolloServer } from "@apollo/server";
import { readFileSync } from "fs";
import gql from "graphql-tag";
import resolvers from "@patients/resolvers";
import { setupTestDatabase, cleanupTestDatabase, closeTestConnections, testHelpers } from "@test-utils/setup";
import { Pool } from 'pg';

describe("Patients Service Mutations", () => {
  let server: ApolloServer;
  let pool: Pool;

  beforeAll(async () => {
    pool = await setupTestDatabase();
    
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
      expect(res.body.singleResult.errors![0].message).toMatch(/required|missing/i);
    }
  });

  it("updates patient information", async () => {
    // First create a patient
    const testPatient = await testHelpers.insertPatient(pool, {
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
      expect(data.lastName).toBe("Smith"); // Should remain unchanged
      expect(data.email).toBe("janet.smith@test.com");
    }
  });

  it("deletes a patient", async () => {
    // First create a patient
    const testPatient = await testHelpers.insertPatient(pool, {
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

    // Verify patient is deleted
    const queryRes = await pool.query('SELECT * FROM patients WHERE id = $1', [testPatient.id]);
    expect(queryRes.rows.length).toBe(0);
  });
});
