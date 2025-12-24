/**
 * Transcription Worker Entry Point
 *
 * Standalone worker process for processing transcription jobs.
 * Run with: npm run start:worker
 */

import { Pool } from 'pg';
import { Redis } from 'ioredis';
import { createTranscriptionWorker } from './transcription.worker';
import { MLClient } from './ml-client';

async function main() {
  console.log('Starting transcription worker...');

  // Initialize PostgreSQL connection
  const pool = new Pool({
    host: process.env.POSTGRES_HOST || 'localhost',
    port: parseInt(process.env.POSTGRES_PORT || '5432'),
    database: process.env.POSTGRES_DB || 'prism',
    user: process.env.POSTGRES_USER || 'prism',
    password: process.env.POSTGRES_PASSWORD || 'prism123',
    max: 10,
    idleTimeoutMillis: 30000,
  });

  // Test database connection
  try {
    await pool.query('SELECT 1');
    console.log('Connected to PostgreSQL');
  } catch (error) {
    console.error('Failed to connect to PostgreSQL:', error);
    process.exit(1);
  }

  // Initialize Redis connection
  const redis = new Redis({
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379'),
    password: process.env.REDIS_PASSWORD,
    maxRetriesPerRequest: null, // Required for BullMQ
  });

  redis.on('connect', () => {
    console.log('Connected to Redis');
  });

  redis.on('error', (err) => {
    console.error('Redis connection error:', err);
  });

  // Initialize ML client
  const mlServiceUrl = process.env.ML_SERVICE_URL || 'http://localhost:8080';
  const mlClient = new MLClient(mlServiceUrl);

  // Check ML service health
  try {
    const health = await mlClient.healthCheck();
    console.log(`ML service healthy: ${health.whisper_model} on ${health.whisper_device}`);
  } catch (error: any) {
    console.warn(`ML service not available: ${error.message}`);
    console.warn('Worker will retry jobs when ML service becomes available');
  }

  // Create and start worker
  const worker = createTranscriptionWorker(redis, pool, mlClient);

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    console.log(`\nReceived ${signal}. Shutting down gracefully...`);

    // Close worker (waits for active jobs to complete)
    await worker.close();
    console.log('Worker closed');

    // Close connections
    await redis.quit();
    await pool.end();

    console.log('Connections closed. Goodbye!');
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  console.log('Transcription worker running. Press Ctrl+C to stop.');
}

main().catch((error) => {
  console.error('Worker startup failed:', error);
  process.exit(1);
});
