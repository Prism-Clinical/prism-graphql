/**
 * Jest Test Setup
 *
 * This file runs before all tests. For integration tests, we assume
 * Docker services are already running (docker compose up).
 */

// Increase timeout for integration tests
jest.setTimeout(30000);

// Global test setup
beforeAll(async () => {
  // Ensure test environment variables are set
  process.env.NODE_ENV = 'test';

  // Verify services are accessible by checking the gateway
  const gatewayUrl = process.env.TEST_GATEWAY_URL || 'http://localhost:4000';

  try {
    const response = await fetch(gatewayUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: '{ __typename }' }),
    });

    if (!response.ok) {
      console.warn('⚠️ Gateway returned non-OK status:', response.status);
    } else {
      const result = await response.json();
      if (result.data?.__typename === 'Query') {
        console.log('✅ Gateway is accessible at', gatewayUrl);
      }
    }
  } catch (error) {
    console.warn('⚠️ Could not connect to gateway. Integration tests may fail.');
    console.warn('   Make sure Docker services are running: docker compose up');
  }
});

// Global teardown
afterAll(async () => {
  // Cleanup if needed
});