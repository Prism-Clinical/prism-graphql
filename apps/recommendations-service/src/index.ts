import { readFileSync } from "fs";
import gql from "graphql-tag";
import { buildSubgraphSchema } from "@apollo/subgraph";
import { ApolloServer } from "@apollo/server";
import {
  startStandaloneServer,
} from "@apollo/server/standalone";
import { Pool } from 'pg';
import { Redis } from 'ioredis';
import resolvers from "@recommendations/resolvers";
import { initializeDatabase } from "@recommendations/services/database";

const port = "4001";
const subgraphName = "recommendations";

async function main() {
  // Initialize database connections
  const pool = new Pool({
    host: process.env.POSTGRES_HOST || 'localhost',
    port: parseInt(process.env.POSTGRES_PORT || '5432'),
    database: process.env.POSTGRES_DB || 'prism',
    user: process.env.POSTGRES_USER || 'prism',
    password: process.env.POSTGRES_PASSWORD || 'prism123',
    max: 10,
    idleTimeoutMillis: 30000,
  });

  const redis = new Redis({
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379'),
    password: process.env.REDIS_PASSWORD,
    retryDelayOnFailover: 100,
  });

  // Initialize services with database connections
  initializeDatabase(pool, redis);

  let typeDefs = gql(
    readFileSync("schema.graphql", {
      encoding: "utf-8",
    })
  );
  const server = new ApolloServer({
    schema: buildSubgraphSchema({ typeDefs, resolvers }),
  });
  const { url } = await startStandaloneServer(server, {
    listen: { port: Number.parseInt(port) },
  });

  console.log(`🚀  Subgraph ${subgraphName} ready at ${url}`);
}

main().catch(console.error);
