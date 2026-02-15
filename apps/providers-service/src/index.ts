import { readFileSync } from "fs";
import gql from "graphql-tag";
import { buildSubgraphSchema } from "@apollo/subgraph";
import { ApolloServer } from "@apollo/server";
import {
  startStandaloneServer,
} from "@apollo/server/standalone";
import { Pool } from 'pg';
import { Redis } from 'ioredis';
import resolvers from "./resolvers";
import { initializeDatabase } from "./services/database";
import { initializeStorageService } from "./services/storage";

const port = process.env.PORT || "4006";
const subgraphName = "providers";

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

  // Initialize GCS storage service for audio uploads
  const gcsBucket = process.env.GCS_BUCKET_NAME;
  const gcpProject = process.env.GCP_PROJECT_ID;
  if (gcsBucket && gcpProject) {
    initializeStorageService(gcsBucket, gcpProject);
    console.log(`GCS storage initialized: bucket=${gcsBucket}`);
  } else {
    console.warn('GCS_BUCKET_NAME or GCP_PROJECT_ID not set — audio upload disabled');
  }

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
