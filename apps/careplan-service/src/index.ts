import { readFileSync } from "fs";
import gql from "graphql-tag";
import { buildSubgraphSchema } from "@apollo/subgraph";
import { ApolloServer } from "@apollo/server";
import {
  startStandaloneServer,
} from "@apollo/server/standalone";
import { Pool } from 'pg';
import { Redis } from 'ioredis';
import crypto from 'crypto';
import resolvers from "./resolvers";
import { initializeDatabase } from "./services/database";
import { RequestTracker } from "./jobs/request-tracker";
import { createPipelineOrchestrator } from "./orchestration";
import { createMLClientFactory, createMLConfigFromEnv } from '@prism/service-clients';

const port = process.env.PORT || "4010";
const subgraphName = "careplan";

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
  });

  // Initialize services with database connections
  initializeDatabase(pool, redis);

  // Initialize request tracker for pipeline request persistence
  const encryptionKey = process.env.PIPELINE_ENCRYPTION_KEY
    ? Buffer.from(process.env.PIPELINE_ENCRYPTION_KEY, 'hex')
    : crypto.randomBytes(32); // Dev fallback — not stable across restarts

  const requestTracker = new RequestTracker({
    pool,
    encryptionKey,
  });

  // Initialize ML client factory and pipeline orchestrator
  const mlConfig = createMLConfigFromEnv();
  const mlClientFactory = createMLClientFactory(mlConfig);
  mlClientFactory.setRedisClient(redis as any);

  const pipelineOrchestrator = createPipelineOrchestrator({
    mlClientFactory,
    redis,
    pool,
    auditLogger: {
      async logPHIAccess(entry) {
        console.log(JSON.stringify({ service: subgraphName, audit: 'PHI_ACCESS', ...entry }));
      },
      async logMLServiceCall(entry) {
        console.log(JSON.stringify({ service: subgraphName, audit: 'ML_CALL', ...entry }));
      },
      async logDataSharing(entry) {
        console.log(JSON.stringify({ service: subgraphName, audit: 'DATA_SHARING', ...entry }));
      },
    },
    cacheEncryptionKey: encryptionKey,
    enableCaching: true,
    enableIdempotency: true,
  });

  // Load both schema files
  const baseSchema = readFileSync("schema.graphql", { encoding: "utf-8" });
  const pipelineSchema = readFileSync("schema-pipeline.graphql", { encoding: "utf-8" });
  const typeDefs = gql(baseSchema + "\n" + pipelineSchema);

  const server = new ApolloServer({
    schema: buildSubgraphSchema({ typeDefs, resolvers }),
  });
  const { url } = await startStandaloneServer(server, {
    listen: { port: Number.parseInt(port) },
    context: async ({ req }) => {
      // TODO: Extract userId/userRole from auth token in request headers
      // For now, use dev provider UUID as fallback
      const DEV_PROVIDER_ID = '00000000-0000-4000-a000-000000000002';
      const userId = req.headers['x-user-id'] as string || DEV_PROVIDER_ID;
      const userRole = req.headers['x-user-role'] as string || 'PROVIDER';
      return {
        pool,
        redis,
        requestTracker,
        pipelineOrchestrator,
        userId,
        userRole,
      };
    },
  });

  // Log ML service configuration on startup
  console.log(`🔧  ML services configured:`, JSON.stringify(mlConfig.urls, null, 2));
  console.log(`🔧  Fallbacks: ${mlConfig.enableFallbacks ? 'enabled' : 'disabled'}`);
  console.log(`🚀  Subgraph ${subgraphName} ready at ${url}`);
}

main().catch(console.error);
