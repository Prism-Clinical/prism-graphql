/**
 * Server entry point for Epic API Service.
 *
 * Starts the Apollo subgraph server with PostgreSQL and Redis connections.
 * This file is kept separate from index.ts so that resolver logic can be
 * imported and tested without triggering server startup.
 */

import { ApolloServer } from "@apollo/server";
import { startStandaloneServer } from "@apollo/server/standalone";
import { buildSubgraphSchema } from "@apollo/subgraph";
import { Pool } from "pg";
import { Redis } from "ioredis";
import { createLogger } from "./clients/logger";
import { initializeCache } from "./services/cache";
import { initializeDatabase } from "./services/database";
import { typeDefs, resolvers } from "./index";

const logger = createLogger("epic-api-service");

async function main(): Promise<void> {
  try {
    // Initialize PostgreSQL
    const pgPool = new Pool({
      connectionString:
        process.env.DATABASE_URL ||
        "postgresql://postgres:postgres@localhost:5432/prism",
      max: 10,
    });

    // Initialize Redis
    const redisClient = new Redis(
      process.env.REDIS_URL || "redis://localhost:6379",
      {
        maxRetriesPerRequest: 3,
        lazyConnect: true,
      }
    );
    await redisClient.connect();

    // Initialize services
    initializeDatabase(pgPool);
    initializeCache(redisClient);

    logger.info("Database and cache initialized");

    const server = new ApolloServer({
      schema: buildSubgraphSchema({
        typeDefs,
        resolvers,
      }),
    });

    const { url } = await startStandaloneServer(server, {
      listen: { port: parseInt(process.env.PORT || "4006") },
    });

    logger.info(`Epic API Service ready at ${url}`, {
      epicAuthEnabled: process.env.EPIC_AUTH_ENABLED === "true",
      epicBaseUrl: process.env.EPIC_BASE_URL || "http://epic-mock:8080",
    });
  } catch (error) {
    logger.error(
      "Failed to start Epic API service",
      error instanceof Error ? error : undefined
    );
    process.exit(1);
  }
}

main().catch((error) => {
  logger.error(
    "Failed to start Epic API service",
    error instanceof Error ? error : undefined
  );
  process.exit(1);
});
