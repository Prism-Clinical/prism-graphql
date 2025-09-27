# Healthcare Federation Testing Guide

This document provides comprehensive guidance on testing the Healthcare GraphQL Federation system.

## Overview

The testing suite includes:
- **Unit Tests**: Test individual service components, resolvers, and database operations
- **Integration Tests**: Test GraphQL federation, cross-service queries, and Epic integration
- **API Tests**: Test GraphQL operations and federation behavior
- **Database Tests**: Test database operations, caching, and data integrity

## Test Infrastructure

### Test Database Setup

Tests use a separate PostgreSQL database (`healthcare_federation_test`) to avoid interfering with development data:

```bash
# Database: healthcare_federation_test
# Redis DB: 1 (separate from development DB 0)
```

### Test Configuration

Key environment variables for testing:
```bash
NODE_ENV=test
TEST_DB_HOST=localhost
TEST_DB_PORT=5432
TEST_DB_NAME=healthcare_federation_test
TEST_DB_USER=postgres
TEST_DB_PASSWORD=postgres
TEST_REDIS_HOST=localhost
TEST_REDIS_PORT=6379
TEST_REDIS_DB=1
```

## Running Tests

### Quick Commands

```bash
# Run all tests
make test

# Run with coverage
make test-coverage

# Run unit tests only
make test-unit

# Run integration tests only
make test-integration

# Run tests in watch mode
make test-watch
```

### Service-Specific Tests

```bash
# Test individual services
make test-patients
make test-providers
make test-epic-api

# Or use npm directly
npm run test:patients
npm run test:providers
npm run test:epic-api
```

### Detailed Test Commands

```bash
# All tests with coverage
npm run test:coverage

# Unit tests (resolver and database logic)
npm run test:unit

# Integration tests (federation and cross-service)
npm run test:integration

# Watch mode for development
npm run test:watch
```

## Test Structure

### Unit Tests (`apps/*/src/__tests__/`)

Each service contains comprehensive unit tests:

1. **Mutation Tests** (`mutation.test.ts`)
   - CRUD operations
   - Input validation
   - Error handling
   - Database integration

2. **Query Tests** (`query.test.ts`)
   - Data retrieval
   - Pagination
   - Filtering
   - Federation resolvers

3. **Database Tests** (`database.test.ts`)
   - Service layer operations
   - Caching behavior
   - Transaction handling
   - Error scenarios

4. **Service-Specific Tests**
   - Epic API client tests
   - FHIR data transformation
   - Authentication handling

### Integration Tests (`tests/integration/`)

1. **Federation Tests** (`federation.test.ts`)
   - Cross-service queries
   - Complex federated operations
   - Epic integration workflows
   - Performance and caching

## Test Examples

### Unit Test Example

```typescript
describe("Patients Service Mutations", () => {
  let server: ApolloServer;
  let pool: Pool;

  beforeAll(async () => {
    pool = await setupTestDatabase();
    server = new ApolloServer({
      schema: buildSubgraphSchema({
        typeDefs: gql(readFileSync("schema.graphql", "utf-8")),
        resolvers,
      }),
    });
  });

  beforeEach(async () => {
    await cleanupTestDatabase();
  });

  it("creates a new patient", async () => {
    const mutation = `
      mutation CreatePatient($input: CreatePatientInput!) {
        createPatient(input: $input) {
          id
          firstName
          lastName
          email
        }
      }
    `;
    
    const variables = {
      input: {
        firstName: "John",
        lastName: "Doe",
        email: "john.doe@test.com"
      }
    };
    
    const result = await server.executeOperation({ query: mutation, variables });
    expect(result.body.kind).toBe("single");
    // ... assertions
  });
});
```

### Integration Test Example

```typescript
describe("Healthcare Federation Integration", () => {
  let gateway: ApolloGateway;
  let server: ApolloServer;

  beforeAll(async () => {
    gateway = new ApolloGateway({
      supergraphSdl: new IntrospectAndCompose({
        subgraphs: serviceList,
      }),
    });

    server = new ApolloServer({ gateway });
  });

  it("fetches patient with federated data", async () => {
    const query = gql`
      query GetPatientWithRecommendations($patientId: ID!) {
        patient(id: $patientId) {
          id
          firstName
          lastName
          cases {
            recommendations {
              title
              provider {
                firstName
                lastName
                specialty
              }
            }
          }
        }
      }
    `;
    
    const result = await server.executeOperation({ query, variables });
    // ... federated assertions
  });
});
```

## Database Testing

### Test Data Helpers

The shared test utilities provide data generators:

```typescript
import { testHelpers, testDataGenerators } from '../shared/test-utils/setup';

// Create test patient
const patient = await testHelpers.insertPatient(pool, {
  firstName: "Test",
  lastName: "Patient"
});

// Generate test data
const patientData = testDataGenerators.patient({
  firstName: "Custom",
  lastName: "Patient"
});
```

### Cache Testing

Redis caching is tested to ensure:
- Data is cached appropriately
- TTL values are correct
- Cache invalidation works
- Performance improvements

```typescript
it("uses Redis cache for subsequent requests", async () => {
  // First request - populates cache
  const result1 = await patientService.getPatientById(testPatient.id);
  
  // Verify cache
  const cacheKey = `patient:${testPatient.id}`;
  const cachedData = await redis.get(cacheKey);
  expect(cachedData).toBeDefined();
  
  // Second request - uses cache
  const result2 = await patientService.getPatientById(testPatient.id);
  // ... cache assertions
});
```

## Epic API Testing

Epic integration tests use mock HTTP responses:

```typescript
import nock from 'nock';

describe("Epic Client", () => {
  beforeEach(() => {
    nock.cleanAll();
  });

  it("fetches patient data from Epic FHIR API", async () => {
    const mockPatientData = {
      resourceType: "Patient",
      id: "epic-123",
      name: [{ given: ["John"], family: "Doe" }]
    };

    nock('http://localhost:8080')
      .get('/Patient/epic-123')
      .reply(200, mockPatientData);

    const result = await epicClient.fetchPatientDemographics("epic-123");
    expect(result.success).toBe(true);
    expect(result.data).toEqual(mockPatientData);
  });
});
```

## Test Environment Setup

### Prerequisites

1. **PostgreSQL**: Test database server
2. **Redis**: Test cache server  
3. **Node.js**: Version 18+
4. **Docker**: For containerized testing

### Database Setup

```bash
# Create test database
createdb healthcare_federation_test

# Or using Docker
docker run --name postgres-test -e POSTGRES_DB=healthcare_federation_test -p 5432:5432 -d postgres:15
```

### Running Tests with Docker

```bash
# Start test infrastructure
docker compose -f docker-compose.test.yml up -d postgres redis

# Run tests
make test

# Cleanup
docker compose -f docker-compose.test.yml down
```

## Continuous Integration

### GitHub Actions Example

```yaml
name: Tests
on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    
    services:
      postgres:
        image: postgres:15
        env:
          POSTGRES_DB: healthcare_federation_test
          POSTGRES_PASSWORD: postgres
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5
      
      redis:
        image: redis:7
        options: >-
          --health-cmd "redis-cli ping"
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5

    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '18'
      
      - run: npm ci
      - run: npm run test:coverage
      
      - name: Upload coverage
        uses: codecov/codecov-action@v3
```

## Test Data Management

### Cleanup Strategy

Tests automatically clean up data between runs:

```typescript
beforeEach(async () => {
  await cleanupTestDatabase(); // Truncates all tables
  await redis.flushdb();       // Clears test Redis DB
});
```

### Data Isolation

- Each test uses fresh database state
- Tests run in sequence to avoid conflicts
- Separate Redis database for test cache

## Performance Testing

### Load Testing

```typescript
it("handles concurrent requests efficiently", async () => {
  const promises = testPatients.map(patient => 
    server.executeOperation({ 
      query, 
      variables: { patientId: patient.id } 
    })
  );

  const results = await Promise.all(promises);
  // All requests should succeed
  results.forEach(result => {
    expect(result.body.kind).toBe('single');
  });
});
```

### Cache Performance

```typescript
it("caches data appropriately for performance", async () => {
  const startTime1 = Date.now();
  const result1 = await server.executeOperation({ query, variables });
  const duration1 = Date.now() - startTime1;

  const startTime2 = Date.now();
  const result2 = await server.executeOperation({ query, variables });
  const duration2 = Date.now() - startTime2;

  // Second request should be faster (cached)
  expect(duration2).toBeLessThan(duration1);
});
```

## Debugging Tests

### Test Debugging

```bash
# Run single test file
npm test -- apps/patients-service/src/__tests__/query.test.ts

# Run with verbose output
npm test -- --verbose

# Debug mode
node --inspect-brk ./node_modules/.bin/jest --runInBand
```

### Database Inspection

```bash
# Check test database state
docker compose exec postgres psql -U postgres -d healthcare_federation_test

# View test cache
docker compose exec redis redis-cli -n 1 KEYS "*"
```

## Best Practices

1. **Test Isolation**: Each test should be independent
2. **Realistic Data**: Use realistic test data that matches production patterns
3. **Error Testing**: Test both success and failure scenarios
4. **Performance**: Include performance and load testing
5. **Documentation**: Document complex test scenarios
6. **Cleanup**: Always clean up test data
7. **Assertions**: Use specific assertions, avoid generic "toBeDefined"

## Troubleshooting

### Common Issues

1. **Database Connection**: Ensure test database is running and accessible
2. **Port Conflicts**: Check that test ports don't conflict with development
3. **Cache Issues**: Verify Redis is using separate test database
4. **Timeout Errors**: Increase Jest timeout for slow operations
5. **Federation Errors**: Ensure all services are running for integration tests

### Debug Commands

```bash
# Check test environment
npm run test -- --env-info

# Run tests with debug output
DEBUG=* npm test

# Check test database
make migrate-status
```

This comprehensive testing setup ensures the reliability, performance, and correctness of the Healthcare GraphQL Federation system.