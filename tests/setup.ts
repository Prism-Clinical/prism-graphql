import { setupTestDatabase, setupTestRedis } from '@test-utils/setup';

// Global test setup
beforeAll(async () => {
  // Ensure test environment variables are set
  process.env.NODE_ENV = 'test';
  process.env.TEST_DB_HOST = process.env.TEST_DB_HOST || 'localhost';
  process.env.TEST_DB_PORT = process.env.TEST_DB_PORT || '5432';
  process.env.TEST_DB_NAME = process.env.TEST_DB_NAME || 'healthcare_federation_test';
  process.env.TEST_DB_USER = process.env.TEST_DB_USER || 'postgres';
  process.env.TEST_DB_PASSWORD = process.env.TEST_DB_PASSWORD || 'postgres';
  process.env.TEST_REDIS_HOST = process.env.TEST_REDIS_HOST || 'localhost';
  process.env.TEST_REDIS_PORT = process.env.TEST_REDIS_PORT || '6379';
  process.env.TEST_REDIS_DB = process.env.TEST_REDIS_DB || '1';

  // Initialize test databases
  try {
    await setupTestDatabase();
    await setupTestRedis();
    console.log('✅ Test databases initialized');
  } catch (error) {
    console.error('❌ Failed to initialize test databases:', error);
    throw error;
  }
});

// Increase timeout for integration tests
jest.setTimeout(30000);