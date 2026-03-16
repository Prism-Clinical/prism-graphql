import { Pool, PoolClient } from 'pg';
import { Redis } from 'ioredis';

let pool: Pool;
let redis: Redis;

export function initializeDatabase(dbPool: Pool, redisClient: Redis): void {
  pool = dbPool;
  redis = redisClient;

  // Every new connection needs AGE loaded and ag_catalog in search_path.
  // shared_preload_libraries handles LOAD in the Docker image, but we also
  // LOAD explicitly as a safety net (idempotent — no-op if already loaded).
  pool.on('connect', (client: PoolClient) => {
    client.query("LOAD 'age'; SET search_path = ag_catalog, \"$user\", public;").catch((err) => {
      console.error('Failed to initialize AGE on new connection:', err);
    });
  });
}

export function getPool(): Pool {
  if (!pool) {
    throw new Error('Database not initialized. Call initializeDatabase() first.');
  }
  return pool;
}

export function getRedis(): Redis {
  if (!redis) {
    throw new Error('Database not initialized. Call initializeDatabase() first.');
  }
  return redis;
}
