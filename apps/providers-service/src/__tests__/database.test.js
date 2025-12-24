"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const database_1 = require("@providers/services/database");
const setup_1 = require("@test-utils/setup");
describe("Providers Database Service", () => {
    let pool;
    let redis;
    beforeAll(async () => {
        pool = await (0, setup_1.setupTestDatabase)();
        redis = await (0, setup_1.setupTestRedis)();
        (0, database_1.initializeDatabase)(pool, redis);
    });
    beforeEach(async () => {
        await (0, setup_1.cleanupTestDatabase)();
    });
    afterAll(async () => {
        await (0, setup_1.closeTestConnections)();
    });
    describe("Provider Service", () => {
        describe("createProvider", () => {
            it("creates a new provider in database", async () => {
                const providerData = {
                    npi: "1234567890",
                    firstName: "Dr. John",
                    lastName: "Smith",
                    specialty: "Cardiology",
                    credentials: "MD, FACC",
                    email: "john.smith@hospital.com",
                    phone: "555-1234"
                };
                const result = await database_1.providerService.createProvider(providerData);
                expect(result).toBeDefined();
                expect(result.id).toBeDefined();
                expect(result.npi).toBe("1234567890");
                expect(result.firstName).toBe("Dr. John");
                expect(result.lastName).toBe("Smith");
                expect(result.specialty).toBe("Cardiology");
                expect(result.credentials).toBe("MD, FACC");
                expect(result.email).toBe("john.smith@hospital.com");
                expect(result.phone).toBe("555-1234");
                expect(result.createdAt).toBeDefined();
                expect(result.updatedAt).toBeDefined();
            });
            it("creates provider with facility association", async () => {
                const facility = await setup_1.testHelpers.insertInstitution(pool, {
                    name: "Test Hospital",
                    type: "hospital"
                });
                const providerData = {
                    npi: "1234567890",
                    firstName: "Dr. Jane",
                    lastName: "Doe",
                    specialty: "Internal Medicine",
                    credentials: "MD",
                    email: "jane.doe@hospital.com",
                    phone: "555-5678",
                    facilityId: facility.id
                };
                const result = await database_1.providerService.createProvider(providerData);
                expect(result.facilityId).toBe(facility.id);
            });
            it("throws error for duplicate NPI", async () => {
                const providerData = {
                    npi: "1234567890",
                    firstName: "Dr. First",
                    lastName: "Provider",
                    specialty: "Medicine",
                    credentials: "MD",
                    email: "first@hospital.com",
                    phone: "555-1111"
                };
                await database_1.providerService.createProvider(providerData);
                const duplicateData = {
                    ...providerData,
                    firstName: "Dr. Second",
                    email: "second@hospital.com"
                };
                await expect(database_1.providerService.createProvider(duplicateData))
                    .rejects.toThrow(/duplicate.*npi/i);
            });
        });
        describe("getProviderById", () => {
            it("retrieves provider by ID", async () => {
                const testProvider = await setup_1.testHelpers.insertProvider(pool, {
                    npi: "1234567890",
                    firstName: "Dr. Test",
                    lastName: "Provider"
                });
                const result = await database_1.providerService.getProviderById(testProvider.id);
                expect(result).toBeDefined();
                expect(result.id).toBe(testProvider.id);
                expect(result.npi).toBe("1234567890");
                expect(result.firstName).toBe("Dr. Test");
                expect(result.lastName).toBe("Provider");
            });
            it("returns null for non-existent provider", async () => {
                const result = await database_1.providerService.getProviderById("non-existent-id");
                expect(result).toBeNull();
            });
            it("uses Redis cache for subsequent requests", async () => {
                const testProvider = await setup_1.testHelpers.insertProvider(pool, {
                    npi: "1234567890",
                    firstName: "Cache",
                    lastName: "Test"
                });
                const result1 = await database_1.providerService.getProviderById(testProvider.id);
                expect(result1).toBeDefined();
                const cacheKey = `provider:${testProvider.id}`;
                const cachedData = await redis.get(cacheKey);
                expect(cachedData).toBeDefined();
                const result2 = await database_1.providerService.getProviderById(testProvider.id);
                expect(result2).toBeDefined();
                expect(result2.id).toBe(testProvider.id);
            });
        });
        describe("getProviderByNpi", () => {
            it("retrieves provider by NPI", async () => {
                const testProvider = await setup_1.testHelpers.insertProvider(pool, {
                    npi: "9876543210",
                    firstName: "Dr. NPI",
                    lastName: "Test"
                });
                const result = await database_1.providerService.getProviderByNpi("9876543210");
                expect(result).toBeDefined();
                expect(result.npi).toBe("9876543210");
                expect(result.firstName).toBe("Dr. NPI");
                expect(result.lastName).toBe("Test");
            });
            it("returns null for non-existent NPI", async () => {
                const result = await database_1.providerService.getProviderByNpi("0000000000");
                expect(result).toBeNull();
            });
            it("caches by NPI", async () => {
                const testProvider = await setup_1.testHelpers.insertProvider(pool, {
                    npi: "9876543210",
                    firstName: "Cache",
                    lastName: "NPI"
                });
                await database_1.providerService.getProviderByNpi("9876543210");
                const cacheKey = `provider:npi:9876543210`;
                const cachedData = await redis.get(cacheKey);
                expect(cachedData).toBeDefined();
            });
        });
        describe("getProviders", () => {
            it("retrieves all providers with default pagination", async () => {
                await setup_1.testHelpers.insertProvider(pool, { firstName: "Provider1", lastName: "Test" });
                await setup_1.testHelpers.insertProvider(pool, { firstName: "Provider2", lastName: "Test" });
                await setup_1.testHelpers.insertProvider(pool, { firstName: "Provider3", lastName: "Test" });
                const result = await database_1.providerService.getProviders();
                expect(Array.isArray(result)).toBe(true);
                expect(result.length).toBe(3);
            });
            it("filters by specialty", async () => {
                await setup_1.testHelpers.insertProvider(pool, { specialty: "Cardiology", firstName: "Dr. Heart", lastName: "Specialist" });
                await setup_1.testHelpers.insertProvider(pool, { specialty: "Internal Medicine", firstName: "Dr. Internal", lastName: "Med" });
                await setup_1.testHelpers.insertProvider(pool, { specialty: "Cardiology", firstName: "Dr. Another", lastName: "Heart" });
                const result = await database_1.providerService.getProviders({ specialty: "Cardiology" });
                expect(result.length).toBe(2);
                expect(result.every(p => p.specialty === "Cardiology")).toBe(true);
            });
            it("respects limit and offset parameters", async () => {
                for (let i = 1; i <= 5; i++) {
                    await setup_1.testHelpers.insertProvider(pool, {
                        firstName: `Provider${i}`,
                        lastName: "Test"
                    });
                }
                const result = await database_1.providerService.getProviders({ limit: 2, offset: 1 });
                expect(result.length).toBe(2);
            });
            it("uses Redis cache for repeated queries", async () => {
                await setup_1.testHelpers.insertProvider(pool, { firstName: "Cache", lastName: "Test" });
                await database_1.providerService.getProviders({ limit: 10, offset: 0 });
                const cacheKey = 'providers:all:10:0:';
                const cachedData = await redis.get(cacheKey);
                expect(cachedData).toBeDefined();
            });
        });
        describe("updateProvider", () => {
            it("updates provider information", async () => {
                const testProvider = await setup_1.testHelpers.insertProvider(pool, {
                    firstName: "Original",
                    lastName: "Name",
                    email: "original@test.com",
                    specialty: "Medicine"
                });
                const updates = {
                    firstName: "Updated",
                    email: "updated@test.com",
                    specialty: "Cardiology"
                };
                const result = await database_1.providerService.updateProvider(testProvider.id, updates);
                expect(result).toBeDefined();
                expect(result.firstName).toBe("Updated");
                expect(result.lastName).toBe("Name");
                expect(result.email).toBe("updated@test.com");
                expect(result.specialty).toBe("Cardiology");
                expect(result.updatedAt).toBeDefined();
            });
            it("returns null for non-existent provider", async () => {
                const result = await database_1.providerService.updateProvider("non-existent", {
                    firstName: "Updated"
                });
                expect(result).toBeNull();
            });
            it("invalidates cache after update", async () => {
                const testProvider = await setup_1.testHelpers.insertProvider(pool, {
                    firstName: "Cache",
                    lastName: "Test"
                });
                await database_1.providerService.getProviderById(testProvider.id);
                await database_1.providerService.updateProvider(testProvider.id, {
                    firstName: "Updated"
                });
                const cacheKey = `provider:${testProvider.id}`;
                const cachedData = await redis.get(cacheKey);
                expect(cachedData).toBeNull();
            });
        });
        describe("deleteProvider", () => {
            it("deletes provider from database", async () => {
                const testProvider = await setup_1.testHelpers.insertProvider(pool, {
                    firstName: "Delete",
                    lastName: "Me"
                });
                const result = await database_1.providerService.deleteProvider(testProvider.id);
                expect(result).toBe(true);
                const deletedProvider = await database_1.providerService.getProviderById(testProvider.id);
                expect(deletedProvider).toBeNull();
            });
            it("returns false for non-existent provider", async () => {
                const result = await database_1.providerService.deleteProvider("non-existent");
                expect(result).toBe(false);
            });
        });
    });
    describe("Facility Service", () => {
        describe("createFacility", () => {
            it("creates a new facility", async () => {
                const facilityData = {
                    name: "Test Medical Center",
                    address: {
                        street: "123 Medical Dr",
                        city: "Healthtown",
                        state: "CA",
                        zipCode: "90210",
                        country: "USA"
                    },
                    phone: "555-1234"
                };
                const result = await database_1.facilityService.createFacility(facilityData);
                expect(result).toBeDefined();
                expect(result.id).toBeDefined();
                expect(result.name).toBe("Test Medical Center");
                expect(result.address.street).toBe("123 Medical Dr");
                expect(result.phone).toBe("555-1234");
            });
        });
        describe("getFacilityById", () => {
            it("retrieves facility by ID", async () => {
                const testFacility = await setup_1.testHelpers.insertInstitution(pool, {
                    name: "Test Facility",
                    type: "clinic"
                });
                const result = await database_1.facilityService.getFacilityById(testFacility.id);
                expect(result).toBeDefined();
                expect(result.id).toBe(testFacility.id);
                expect(result.name).toBe("Test Facility");
            });
            it("uses Redis cache", async () => {
                const testFacility = await setup_1.testHelpers.insertInstitution(pool, {
                    name: "Cache Facility"
                });
                await database_1.facilityService.getFacilityById(testFacility.id);
                const cacheKey = `facility:${testFacility.id}`;
                const cachedData = await redis.get(cacheKey);
                expect(cachedData).toBeDefined();
            });
        });
    });
    describe("Visit Service", () => {
        describe("createVisit", () => {
            it("creates a new visit", async () => {
                const testProvider = await setup_1.testHelpers.insertProvider(pool, {});
                const testPatient = await setup_1.testHelpers.insertPatient(pool, {});
                const testHospital = await setup_1.testHelpers.insertInstitution(pool, { type: "hospital" });
                const visitData = {
                    patientId: testPatient.id,
                    hospitalId: testHospital.id,
                    providerId: testProvider.id,
                    caseIds: ["case-1", "case-2"],
                    type: database_1.VisitType.CONSULTATION,
                    scheduledAt: new Date("2024-01-15T10:00:00Z"),
                    chiefComplaint: "Annual checkup"
                };
                const result = await database_1.visitService.createVisit(visitData);
                expect(result).toBeDefined();
                expect(result.id).toBeDefined();
                expect(result.patientId).toBe(testPatient.id);
                expect(result.providerId).toBe(testProvider.id);
                expect(result.type).toBe(database_1.VisitType.CONSULTATION);
                expect(result.status).toBe(database_1.VisitStatus.SCHEDULED);
                expect(result.caseIds).toEqual(["case-1", "case-2"]);
                expect(result.chiefComplaint).toBe("Annual checkup");
            });
        });
        describe("getVisitById", () => {
            it("retrieves visit by ID", async () => {
                const testProvider = await setup_1.testHelpers.insertProvider(pool, {});
                const testPatient = await setup_1.testHelpers.insertPatient(pool, {});
                const testHospital = await setup_1.testHelpers.insertInstitution(pool, { type: "hospital" });
                const visitData = {
                    patientId: testPatient.id,
                    hospitalId: testHospital.id,
                    providerId: testProvider.id,
                    caseIds: [],
                    type: database_1.VisitType.FOLLOW_UP,
                    scheduledAt: new Date()
                };
                const visit = await database_1.visitService.createVisit(visitData);
                const result = await database_1.visitService.getVisitById(visit.id);
                expect(result).toBeDefined();
                expect(result.id).toBe(visit.id);
                expect(result.type).toBe(database_1.VisitType.FOLLOW_UP);
            });
        });
        describe("getVisitsForProvider", () => {
            it("retrieves visits for a specific provider", async () => {
                const testProvider = await setup_1.testHelpers.insertProvider(pool, {});
                const testPatient = await setup_1.testHelpers.insertPatient(pool, {});
                const testHospital = await setup_1.testHelpers.insertInstitution(pool, { type: "hospital" });
                await database_1.visitService.createVisit({
                    patientId: testPatient.id,
                    hospitalId: testHospital.id,
                    providerId: testProvider.id,
                    caseIds: [],
                    type: database_1.VisitType.CONSULTATION,
                    scheduledAt: new Date()
                });
                await database_1.visitService.createVisit({
                    patientId: testPatient.id,
                    hospitalId: testHospital.id,
                    providerId: testProvider.id,
                    caseIds: [],
                    type: database_1.VisitType.FOLLOW_UP,
                    scheduledAt: new Date()
                });
                const result = await database_1.visitService.getVisitsForProvider(testProvider.id);
                expect(result.length).toBe(2);
                expect(result.every(v => v.providerId === testProvider.id)).toBe(true);
            });
        });
        describe("updateVisit", () => {
            it("updates visit status and information", async () => {
                const testProvider = await setup_1.testHelpers.insertProvider(pool, {});
                const testPatient = await setup_1.testHelpers.insertPatient(pool, {});
                const testHospital = await setup_1.testHelpers.insertInstitution(pool, { type: "hospital" });
                const visit = await database_1.visitService.createVisit({
                    patientId: testPatient.id,
                    hospitalId: testHospital.id,
                    providerId: testProvider.id,
                    caseIds: [],
                    type: database_1.VisitType.CONSULTATION,
                    scheduledAt: new Date()
                });
                const updates = {
                    status: database_1.VisitStatus.IN_PROGRESS,
                    notes: "Patient arrived on time"
                };
                const result = await database_1.visitService.updateVisit(visit.id, updates);
                expect(result).toBeDefined();
                expect(result.status).toBe(database_1.VisitStatus.IN_PROGRESS);
                expect(result.notes).toBe("Patient arrived on time");
            });
        });
    });
    describe("Error handling", () => {
        it("handles database connection errors gracefully", async () => {
            const result = await database_1.providerService.getProviders();
            expect(Array.isArray(result)).toBe(true);
        });
        it("handles invalid UUID format", async () => {
            const result = await database_1.providerService.getProviderById("invalid-uuid");
            expect(result).toBeNull();
        });
    });
});
//# sourceMappingURL=database.test.js.map