import { setupTestRedis, cleanupTestDatabase, closeTestConnections } from "@test-utils/setup";
import { EpicClient } from "@epic-api/datasources/epic-client";
import { Redis } from 'ioredis';
import nock from 'nock';

describe("Epic Client", () => {
  let epicClient: EpicClient;
  let redis: Redis;
  const mockBaseUrl = 'http://localhost:8080';

  beforeAll(async () => {
    redis = await setupTestRedis();
    epicClient = new EpicClient(mockBaseUrl);
  });

  beforeEach(async () => {
    await cleanupTestDatabase();
    nock.cleanAll();
  });

  afterAll(async () => {
    await closeTestConnections();
    nock.cleanAll();
  });

  describe("fetchPatientDemographics", () => {
    it("fetches patient demographics from Epic FHIR API", async () => {
      const epicPatientId = "epic-123";
      const mockPatientData = {
        resourceType: "Patient",
        id: epicPatientId,
        name: [{
          given: ["John"],
          family: "Doe"
        }],
        birthDate: "1985-05-15",
        gender: "male",
        telecom: [{
          system: "email",
          value: "john.doe@example.com"
        }]
      };

      // Mock Epic API response
      nock(mockBaseUrl)
        .get(`/Patient/${epicPatientId}`)
        .reply(200, mockPatientData);

      const result = await epicClient.fetchPatientDemographics(epicPatientId);

      expect(result.success).toBe(true);
      expect(result.data).toEqual(mockPatientData);
      expect(result.responseTime).toBeGreaterThanOrEqual(0);
    });

    it("uses cached data when available", async () => {
      const epicPatientId = "epic-cached-123";
      const cachedData = {
        resourceType: "Patient",
        id: epicPatientId,
        name: [{ given: ["Cached"], family: "Patient" }]
      };

      // Pre-populate cache
      const cacheKey = `epic:patient:${epicPatientId}`;
      await redis.setex(cacheKey, 3600, JSON.stringify(cachedData));

      const result = await epicClient.fetchPatientDemographics(epicPatientId);

      expect(result.success).toBe(true);
      expect(result.data).toEqual(cachedData);
      expect(result.responseTime).toBe(0); // Should indicate cache hit
    });

    it("handles Epic API errors gracefully", async () => {
      const epicPatientId = "epic-error-123";

      // Mock Epic API error
      nock(mockBaseUrl)
        .get(`/Patient/${epicPatientId}`)
        .reply(404, { error: "Patient not found" });

      const result = await epicClient.fetchPatientDemographics(epicPatientId);

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.data).toBeUndefined();
    });

    it("handles network timeouts", async () => {
      const epicPatientId = "epic-timeout-123";

      // Mock timeout
      nock(mockBaseUrl)
        .get(`/Patient/${epicPatientId}`)
        .delay(6000) // Longer than timeout
        .reply(200, {});

      const result = await epicClient.fetchPatientDemographics(epicPatientId);

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/timeout/i);
    });
  });

  describe("fetchPatientVitals", () => {
    it("fetches patient vitals from Epic FHIR API", async () => {
      const epicPatientId = "epic-vitals-123";
      const mockVitalsData = {
        resourceType: "Bundle",
        entry: [
          {
            resource: {
              resourceType: "Observation",
              code: {
                coding: [{
                  system: "http://loinc.org",
                  code: "55284-4",
                  display: "Blood pressure"
                }]
              },
              valueQuantity: {
                value: 120,
                unit: "mmHg"
              },
              effectiveDateTime: "2024-01-15T10:30:00Z"
            }
          }
        ]
      };

      nock(mockBaseUrl)
        .get(`/Observation?patient=${epicPatientId}&category=vital-signs`)
        .reply(200, mockVitalsData);

      const result = await epicClient.fetchPatientVitals(epicPatientId);

      expect(result.success).toBe(true);
      expect(result.data).toEqual(mockVitalsData);
    });

    it("caches vitals data with shorter TTL", async () => {
      const epicPatientId = "epic-vitals-cache-123";
      const mockVitalsData = { resourceType: "Bundle", entry: [] };

      nock(mockBaseUrl)
        .get(`/Observation?patient=${epicPatientId}&category=vital-signs`)
        .reply(200, mockVitalsData);

      await epicClient.fetchPatientVitals(epicPatientId);

      // Check cache
      const cacheKey = `epic:vitals:${epicPatientId}`;
      const cachedData = await redis.get(cacheKey);
      expect(cachedData).toBeDefined();

      // Check TTL is set (should be 1 hour for vitals)
      const ttl = await redis.ttl(cacheKey);
      expect(ttl).toBeGreaterThan(0);
      expect(ttl).toBeLessThanOrEqual(3600); // 1 hour
    });
  });

  describe("fetchPatientMedications", () => {
    it("fetches patient medications from Epic FHIR API", async () => {
      const epicPatientId = "epic-meds-123";
      const mockMedicationsData = {
        resourceType: "Bundle",
        entry: [
          {
            resource: {
              resourceType: "MedicationRequest",
              medicationCodeableConcept: {
                text: "Lisinopril 10mg"
              },
              status: "active"
            }
          }
        ]
      };

      nock(mockBaseUrl)
        .get(`/MedicationRequest?patient=${epicPatientId}&status=active`)
        .reply(200, mockMedicationsData);

      const result = await epicClient.fetchPatientMedications(epicPatientId);

      expect(result.success).toBe(true);
      expect(result.data).toEqual(mockMedicationsData);
    });
  });

  describe("Rate limiting", () => {
    it("respects rate limits", async () => {
      const epicPatientId = "epic-rate-limit-123";

      // Mock rate limit response
      nock(mockBaseUrl)
        .get(`/Patient/${epicPatientId}`)
        .reply(429, { error: "Rate limit exceeded" }, {
          'Retry-After': '60'
        });

      const result = await epicClient.fetchPatientDemographics(epicPatientId);

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/rate limit/i);
    });
  });

  describe("Authentication", () => {
    it("includes proper authorization headers", async () => {
      const epicPatientId = "epic-auth-123";
      const mockPatientData = { resourceType: "Patient", id: epicPatientId };

      // Mock Epic API with auth check
      const scope = nock(mockBaseUrl)
        .get(`/Patient/${epicPatientId}`)
        .matchHeader('Authorization', /Bearer .+/)
        .reply(200, mockPatientData);

      await epicClient.fetchPatientDemographics(epicPatientId);

      expect(scope.isDone()).toBe(true);
    });

    it("handles authentication errors", async () => {
      const epicPatientId = "epic-unauth-123";

      nock(mockBaseUrl)
        .get(`/Patient/${epicPatientId}`)
        .reply(401, { error: "Unauthorized" });

      const result = await epicClient.fetchPatientDemographics(epicPatientId);

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/unauthorized|authentication/i);
    });
  });

  describe("Data transformation", () => {
    it("transforms FHIR patient data to internal format", async () => {
      const epicPatientId = "epic-transform-123";
      const fhirPatientData = {
        resourceType: "Patient",
        id: epicPatientId,
        name: [{
          given: ["John", "Robert"],
          family: "Doe"
        }],
        birthDate: "1985-05-15",
        gender: "male",
        telecom: [
          {
            system: "email",
            value: "john.doe@example.com"
          },
          {
            system: "phone",
            value: "555-1234"
          }
        ],
        address: [{
          line: ["123 Main St"],
          city: "Anytown",
          state: "CA",
          postalCode: "12345"
        }]
      };

      const expectedTransformed = {
        epicPatientId: epicPatientId,
        demographics: {
          firstName: "John",
          lastName: "Doe",
          dateOfBirth: "1985-05-15",
          gender: "male",
          email: "john.doe@example.com",
          phone: "555-1234",
          address: {
            street: "123 Main St",
            city: "Anytown",
            state: "CA",
            zip: "12345"
          }
        }
      };

      const transformed = epicClient.transformPatientData(fhirPatientData);
      expect(transformed).toEqual(expectedTransformed);
    });

    it("handles missing optional FHIR fields", async () => {
      const minimalFhirData = {
        resourceType: "Patient",
        id: "minimal-123",
        name: [{ family: "Minimal" }]
      };

      const transformed = epicClient.transformPatientData(minimalFhirData);

      expect(transformed.epicPatientId).toBe("minimal-123");
      expect(transformed.demographics.lastName).toBe("Minimal");
      expect(transformed.demographics.firstName).toBeUndefined();
      expect(transformed.demographics.email).toBeUndefined();
    });
  });

  describe("Cache invalidation", () => {
    it("invalidates cache on data refresh", async () => {
      const epicPatientId = "epic-refresh-123";
      const cacheKey = `epic:patient:${epicPatientId}`;

      // Pre-populate cache
      await redis.setex(cacheKey, 3600, JSON.stringify({ cached: true }));

      await epicClient.invalidateCache(epicPatientId);

      const cachedData = await redis.get(cacheKey);
      expect(cachedData).toBeNull();
    });

    it("clears all patient caches", async () => {
      const epicPatientId = "epic-clear-123";
      
      // Set multiple cache keys for the patient
      await redis.setex(`epic:patient:${epicPatientId}`, 3600, '{}');
      await redis.setex(`epic:vitals:${epicPatientId}`, 3600, '{}');
      await redis.setex(`epic:medications:${epicPatientId}`, 3600, '{}');

      await epicClient.clearPatientCache(epicPatientId);

      // All should be cleared
      expect(await redis.get(`epic:patient:${epicPatientId}`)).toBeNull();
      expect(await redis.get(`epic:vitals:${epicPatientId}`)).toBeNull();
      expect(await redis.get(`epic:medications:${epicPatientId}`)).toBeNull();
    });
  });
});