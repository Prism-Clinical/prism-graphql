// Main export for the healthcare federation data layer

// Database connections
import { db, getDatabaseConfig } from './db/connection';
import { redis, getRedisConfig } from './redis/connection';
import { Migrator } from './migrations/migrator';

export { db, getDatabaseConfig, redis, getRedisConfig, Migrator };

// Query modules
export { PatientSessionQueries } from './queries/patient-sessions';
export { ClinicalDataQueries } from './queries/clinical-data';
export { RecommendationJobQueries } from './queries/recommendation-jobs';

// Types
export * from './types';

// Utility functions
export async function initializeDataLayer(): Promise<void> {
  const dbConfig = getDatabaseConfig();
  const redisConfig = getRedisConfig();

  // Initialize database connection
  db.initialize(dbConfig);

  // Initialize Redis connection
  await redis.initialize(redisConfig);

  // Run migrations if needed
  const migrator = new Migrator();
  await migrator.initializeMigrationTable();

  console.log('Data layer initialized successfully');
}

export async function healthCheckDataLayer(): Promise<{
  database: boolean;
  redis: boolean;
  overall: boolean;
}> {
  const [dbHealth, redisHealth] = await Promise.all([
    db.healthCheck(),
    redis.healthCheck()
  ]);

  return {
    database: dbHealth,
    redis: redisHealth,
    overall: dbHealth && redisHealth
  };
}

export async function closeDataLayer(): Promise<void> {
  await Promise.all([
    db.close(),
    redis.close()
  ]);
  
  console.log('Data layer connections closed');
}