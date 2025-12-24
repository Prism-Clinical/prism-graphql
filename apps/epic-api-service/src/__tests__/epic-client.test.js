"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const setup_1 = require("@test-utils/setup");
const epic_client_1 = require("@epic-api/datasources/epic-client");
const nock_1 = __importDefault(require("nock"));
describe("Epic Client", () => {
    let epicClient;
    let redis;
    const mockBaseUrl = 'http://localhost:8080';
    beforeAll(async () => {
        redis = await (0, setup_1.setupTestRedis)();
        epicClient = new epic_client_1.EpicClient(mockBaseUrl);
    });
    beforeEach(async () => {
        await (0, setup_1.cleanupTestDatabase)();
        nock_1.default.cleanAll();
    });
    afterAll(async () => {
        await (0, setup_1.closeTestConnections)();
        nock_1.default.cleanAll();
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
            (0, nock_1.default)(mockBaseUrl)
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
            const cacheKey = `epic:patient:${epicPatientId}`;
            await redis.setex(cacheKey, 3600, JSON.stringify(cachedData));
            const result = await epicClient.fetchPatientDemographics(epicPatientId);
            expect(result.success).toBe(true);
            expect(result.data).toEqual(cachedData);
            expect(result.responseTime).toBe(0);
        });
        it("handles Epic API errors gracefully", async () => {
            const epicPatientId = "epic-error-123";
            (0, nock_1.default)(mockBaseUrl)
                .get(`/Patient/${epicPatientId}`)
                .reply(404, { error: "Patient not found" });
            const result = await epicClient.fetchPatientDemographics(epicPatientId);
            expect(result.success).toBe(false);
            expect(result.error).toBeDefined();
            expect(result.data).toBeUndefined();
        });
        it("handles network timeouts", async () => {
            const epicPatientId = "epic-timeout-123";
            (0, nock_1.default)(mockBaseUrl)
                .get(`/Patient/${epicPatientId}`)
                .delay(6000)
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
            (0, nock_1.default)(mockBaseUrl)
                .get(`/Observation?patient=${epicPatientId}&category=vital-signs`)
                .reply(200, mockVitalsData);
            const result = await epicClient.fetchPatientVitals(epicPatientId);
            expect(result.success).toBe(true);
            expect(result.data).toEqual(mockVitalsData);
        });
        it("caches vitals data with shorter TTL", async () => {
            const epicPatientId = "epic-vitals-cache-123";
            const mockVitalsData = { resourceType: "Bundle", entry: [] };
            (0, nock_1.default)(mockBaseUrl)
                .get(`/Observation?patient=${epicPatientId}&category=vital-signs`)
                .reply(200, mockVitalsData);
            await epicClient.fetchPatientVitals(epicPatientId);
            const cacheKey = `epic:vitals:${epicPatientId}`;
            const cachedData = await redis.get(cacheKey);
            expect(cachedData).toBeDefined();
            const ttl = await redis.ttl(cacheKey);
            expect(ttl).toBeGreaterThan(0);
            expect(ttl).toBeLessThanOrEqual(3600);
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
            (0, nock_1.default)(mockBaseUrl)
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
            (0, nock_1.default)(mockBaseUrl)
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
            const scope = (0, nock_1.default)(mockBaseUrl)
                .get(`/Patient/${epicPatientId}`)
                .matchHeader('Authorization', /Bearer .+/)
                .reply(200, mockPatientData);
            await epicClient.fetchPatientDemographics(epicPatientId);
            expect(scope.isDone()).toBe(true);
        });
        it("handles authentication errors", async () => {
            const epicPatientId = "epic-unauth-123";
            (0, nock_1.default)(mockBaseUrl)
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
            await redis.setex(cacheKey, 3600, JSON.stringify({ cached: true }));
            await epicClient.invalidateCache(epicPatientId);
            const cachedData = await redis.get(cacheKey);
            expect(cachedData).toBeNull();
        });
        it("clears all patient caches", async () => {
            const epicPatientId = "epic-clear-123";
            await redis.setex(`epic:patient:${epicPatientId}`, 3600, '{}');
            await redis.setex(`epic:vitals:${epicPatientId}`, 3600, '{}');
            await redis.setex(`epic:medications:${epicPatientId}`, 3600, '{}');
            await epicClient.clearPatientCache(epicPatientId);
            expect(await redis.get(`epic:patient:${epicPatientId}`)).toBeNull();
            expect(await redis.get(`epic:vitals:${epicPatientId}`)).toBeNull();
            expect(await redis.get(`epic:medications:${epicPatientId}`)).toBeNull();
        });
    });
});
//# sourceMappingURL=epic-client.test.js.map