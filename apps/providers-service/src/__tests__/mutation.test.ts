import { buildSubgraphSchema } from "@apollo/subgraph";
import { ApolloServer } from "@apollo/server";
import { readFileSync } from "fs";
import gql from "graphql-tag";
import resolvers from "@providers/resolvers";
import { setupTestDatabase, cleanupTestDatabase, closeTestConnections, testHelpers } from "@test-utils/setup";
import { Pool } from 'pg';

describe("Providers Service Mutations", () => {
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

  it("creates a new provider", async () => {
    // First create an institution for the provider
    const testInstitution = await testHelpers.insertInstitution(pool, {
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
      expect(res.body.singleResult.errors![0].message).toMatch(/required|missing/i);
    }
  });

  it("updates provider information", async () => {
    const testProvider = await testHelpers.insertProvider(pool, {
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
    const testProvider = await testHelpers.insertProvider(pool, {
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

    // Verify provider is deleted
    const queryRes = await pool.query('SELECT * FROM providers WHERE id = $1', [testProvider.id]);
    expect(queryRes.rows.length).toBe(0);
  });
});
