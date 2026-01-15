import { readFileSync } from "fs";
import gql from "graphql-tag";
import { buildSubgraphSchema } from "@apollo/subgraph";
import { ApolloServer } from "@apollo/server";
import { startStandaloneServer } from "@apollo/server/standalone";
import { Pool } from "pg";
import { Redis } from "ioredis";
import resolvers from "./resolvers";
import { RecommenderClient } from "./clients/recommender-client";

const port = "4013";
const subgraphName = "careplan-recommender";

async function main() {
  // Initialize database connections
  const pool = new Pool({
    host: process.env.POSTGRES_HOST || "localhost",
    port: parseInt(process.env.POSTGRES_PORT || "5432"),
    database: process.env.POSTGRES_DB || "healthcare_federation",
    user: process.env.POSTGRES_USER || "postgres",
    password: process.env.POSTGRES_PASSWORD || "postgres",
    max: 10,
    idleTimeoutMillis: 30000,
  });

  const redis = new Redis({
    host: process.env.REDIS_HOST || "localhost",
    port: parseInt(process.env.REDIS_PORT || "6379"),
    password: process.env.REDIS_PASSWORD,
  });

  // Initialize ML recommender client
  const recommenderClient = new RecommenderClient(
    process.env.ML_RECOMMENDER_URL || "http://careplan-recommender-ml:8080"
  );

  // Store in context for resolvers
  const context = {
    pool,
    redis,
    recommenderClient,
  };

  const typeDefs = gql(
    readFileSync("schema.graphql", {
      encoding: "utf-8",
    })
  );

  const server = new ApolloServer({
    schema: buildSubgraphSchema({ typeDefs, resolvers }),
    introspection: true, // Required for federation gateway
  });

  const { url } = await startStandaloneServer(server, {
    listen: { port: Number.parseInt(port) },
    context: async () => context,
  });

  console.log(`🚀  Subgraph ${subgraphName} ready at ${url}`);
}

main().catch(console.error);
