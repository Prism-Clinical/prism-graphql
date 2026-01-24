import { readFileSync } from "fs";
import gql from "graphql-tag";
import { buildSubgraphSchema } from "@apollo/subgraph";
import { ApolloServer } from "@apollo/server";
import { expressMiddleware } from "@apollo/server/express4";
import { ApolloServerPluginLandingPageLocalDefault } from "@apollo/server/plugin/landingPage/default";
import express from "express";
import cors from "cors";
import http from "http";
import { Pool } from "pg";
import { Redis } from "ioredis";
import resolvers from "./resolvers";
import { initializeDatabase } from "./services/database";

const port = parseInt(process.env.PORT || "4013");
const subgraphName = "admin";

async function main() {
  // Initialize PostgreSQL connection
  const pool = new Pool({
    host: process.env.POSTGRES_HOST || 'localhost',
    port: parseInt(process.env.POSTGRES_PORT || '5432'),
    database: process.env.POSTGRES_DB || 'healthcare_federation',
    user: process.env.POSTGRES_USER || 'postgres',
    password: process.env.POSTGRES_PASSWORD || 'postgres',
    max: 10,
    idleTimeoutMillis: 30000,
  });

  // Initialize Redis connection
  const redis = new Redis({
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379'),
    password: process.env.REDIS_PASSWORD,
    retryStrategy: (times) => Math.min(times * 50, 2000),
  });

  // Initialize database services
  initializeDatabase(pool, redis);

  // Load GraphQL schema
  const typeDefs = gql(readFileSync("schema.graphql", {
    encoding: "utf-8",
  }));

  // Create Express app
  const app = express();
  const httpServer = http.createServer(app);

  // Create Apollo Server
  const server = new ApolloServer({
    schema: buildSubgraphSchema({ typeDefs, resolvers }),
    plugins: [
      ApolloServerPluginLandingPageLocalDefault({ embed: false }),
    ],
    introspection: true,
  });

  await server.start();

  // Health check endpoint
  app.get('/.well-known/apollo/server-health', (_req, res) => {
    res.status(200).json({ status: 'pass' });
  });

  // GraphQL endpoint
  app.use(
    '/graphql',
    cors(),
    express.json(),
    expressMiddleware(server)
  );

  // Also serve GraphQL at root for federation
  app.use(
    '/',
    cors(),
    express.json(),
    expressMiddleware(server)
  );

  await new Promise<void>((resolve) => httpServer.listen({ port }, resolve));
  console.log(`🚀  Subgraph ${subgraphName} ready at http://localhost:${port}/`);
}

main().catch(console.error);
