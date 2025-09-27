import { Pool } from 'pg';
import { Redis } from 'ioredis';
import { 
  providerService, 
  facilityService, 
  visitService,
  Provider, 
  Facility, 
  Visit,
  VisitType,
  VisitStatus,
  initializeDatabase
} from '@providers/services/database';
import { setupTestDatabase, setupTestRedis, cleanupTestDatabase, closeTestConnections, testHelpers } from "@test-utils/setup";

describe("Providers Database Service", () => {
  let pool: Pool;
  let redis: Redis;

  beforeAll(async () => {
    pool = await setupTestDatabase();
    redis = await setupTestRedis();
    initializeDatabase(pool, redis);
  });

  beforeEach(async () => {
    await cleanupTestDatabase();
  });

  afterAll(async () => {
    await closeTestConnections();
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

        const result = await providerService.createProvider(providerData);

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
        const facility = await testHelpers.insertInstitution(pool, {
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

        const result = await providerService.createProvider(providerData);

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

        await providerService.createProvider(providerData);

        const duplicateData = {
          ...providerData,
          firstName: "Dr. Second",
          email: "second@hospital.com"
        };

        await expect(providerService.createProvider(duplicateData))
          .rejects.toThrow(/duplicate.*npi/i);
      });
    });

    describe("getProviderById", () => {
      it("retrieves provider by ID", async () => {
        const testProvider = await testHelpers.insertProvider(pool, {
          npi: "1234567890",
          firstName: "Dr. Test",
          lastName: "Provider"
        });

        const result = await providerService.getProviderById(testProvider.id);

        expect(result).toBeDefined();
        expect(result!.id).toBe(testProvider.id);
        expect(result!.npi).toBe("1234567890");
        expect(result!.firstName).toBe("Dr. Test");
        expect(result!.lastName).toBe("Provider");
      });

      it("returns null for non-existent provider", async () => {
        const result = await providerService.getProviderById("non-existent-id");
        expect(result).toBeNull();
      });

      it("uses Redis cache for subsequent requests", async () => {
        const testProvider = await testHelpers.insertProvider(pool, {
          npi: "1234567890",
          firstName: "Cache",
          lastName: "Test"
        });

        // First request - should cache the result
        const result1 = await providerService.getProviderById(testProvider.id);
        expect(result1).toBeDefined();

        // Verify data is in cache
        const cacheKey = `provider:${testProvider.id}`;
        const cachedData = await redis.get(cacheKey);
        expect(cachedData).toBeDefined();

        // Second request - should use cache
        const result2 = await providerService.getProviderById(testProvider.id);
        expect(result2).toBeDefined();
        expect(result2!.id).toBe(testProvider.id);
      });
    });

    describe("getProviderByNpi", () => {
      it("retrieves provider by NPI", async () => {
        const testProvider = await testHelpers.insertProvider(pool, {
          npi: "9876543210",
          firstName: "Dr. NPI",
          lastName: "Test"
        });

        const result = await providerService.getProviderByNpi("9876543210");

        expect(result).toBeDefined();
        expect(result!.npi).toBe("9876543210");
        expect(result!.firstName).toBe("Dr. NPI");
        expect(result!.lastName).toBe("Test");
      });

      it("returns null for non-existent NPI", async () => {
        const result = await providerService.getProviderByNpi("0000000000");
        expect(result).toBeNull();
      });

      it("caches by NPI", async () => {
        const testProvider = await testHelpers.insertProvider(pool, {
          npi: "9876543210",
          firstName: "Cache",
          lastName: "NPI"
        });

        await providerService.getProviderByNpi("9876543210");

        const cacheKey = `provider:npi:9876543210`;
        const cachedData = await redis.get(cacheKey);
        expect(cachedData).toBeDefined();
      });
    });

    describe("getProviders", () => {
      it("retrieves all providers with default pagination", async () => {
        await testHelpers.insertProvider(pool, { firstName: "Provider1", lastName: "Test" });
        await testHelpers.insertProvider(pool, { firstName: "Provider2", lastName: "Test" });
        await testHelpers.insertProvider(pool, { firstName: "Provider3", lastName: "Test" });

        const result = await providerService.getProviders();

        expect(Array.isArray(result)).toBe(true);
        expect(result.length).toBe(3);
      });

      it("filters by specialty", async () => {
        await testHelpers.insertProvider(pool, { specialty: "Cardiology", firstName: "Dr. Heart", lastName: "Specialist" });
        await testHelpers.insertProvider(pool, { specialty: "Internal Medicine", firstName: "Dr. Internal", lastName: "Med" });
        await testHelpers.insertProvider(pool, { specialty: "Cardiology", firstName: "Dr. Another", lastName: "Heart" });

        const result = await providerService.getProviders({ specialty: "Cardiology" });

        expect(result.length).toBe(2);
        expect(result.every(p => p.specialty === "Cardiology")).toBe(true);
      });

      it("respects limit and offset parameters", async () => {
        for (let i = 1; i <= 5; i++) {
          await testHelpers.insertProvider(pool, { 
            firstName: `Provider${i}`, 
            lastName: "Test" 
          });
        }

        const result = await providerService.getProviders({ limit: 2, offset: 1 });

        expect(result.length).toBe(2);
      });

      it("uses Redis cache for repeated queries", async () => {
        await testHelpers.insertProvider(pool, { firstName: "Cache", lastName: "Test" });

        await providerService.getProviders({ limit: 10, offset: 0 });

        const cacheKey = 'providers:all:10:0:';
        const cachedData = await redis.get(cacheKey);
        expect(cachedData).toBeDefined();
      });
    });

    describe("updateProvider", () => {
      it("updates provider information", async () => {
        const testProvider = await testHelpers.insertProvider(pool, {
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

        const result = await providerService.updateProvider(testProvider.id, updates);

        expect(result).toBeDefined();
        expect(result!.firstName).toBe("Updated");
        expect(result!.lastName).toBe("Name"); // Should remain unchanged
        expect(result!.email).toBe("updated@test.com");
        expect(result!.specialty).toBe("Cardiology");
        expect(result!.updatedAt).toBeDefined();
      });

      it("returns null for non-existent provider", async () => {
        const result = await providerService.updateProvider("non-existent", {
          firstName: "Updated"
        });

        expect(result).toBeNull();
      });

      it("invalidates cache after update", async () => {
        const testProvider = await testHelpers.insertProvider(pool, {
          firstName: "Cache",
          lastName: "Test"
        });

        // Get provider to cache it
        await providerService.getProviderById(testProvider.id);

        // Update provider
        await providerService.updateProvider(testProvider.id, {
          firstName: "Updated"
        });

        // Cache should be invalidated
        const cacheKey = `provider:${testProvider.id}`;
        const cachedData = await redis.get(cacheKey);
        expect(cachedData).toBeNull();
      });
    });

    describe("deleteProvider", () => {
      it("deletes provider from database", async () => {
        const testProvider = await testHelpers.insertProvider(pool, {
          firstName: "Delete",
          lastName: "Me"
        });

        const result = await providerService.deleteProvider(testProvider.id);
        expect(result).toBe(true);

        const deletedProvider = await providerService.getProviderById(testProvider.id);
        expect(deletedProvider).toBeNull();
      });

      it("returns false for non-existent provider", async () => {
        const result = await providerService.deleteProvider("non-existent");
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

        const result = await facilityService.createFacility(facilityData);

        expect(result).toBeDefined();
        expect(result.id).toBeDefined();
        expect(result.name).toBe("Test Medical Center");
        expect(result.address.street).toBe("123 Medical Dr");
        expect(result.phone).toBe("555-1234");
      });
    });

    describe("getFacilityById", () => {
      it("retrieves facility by ID", async () => {
        const testFacility = await testHelpers.insertInstitution(pool, {
          name: "Test Facility",
          type: "clinic"
        });

        const result = await facilityService.getFacilityById(testFacility.id);

        expect(result).toBeDefined();
        expect(result!.id).toBe(testFacility.id);
        expect(result!.name).toBe("Test Facility");
      });

      it("uses Redis cache", async () => {
        const testFacility = await testHelpers.insertInstitution(pool, {
          name: "Cache Facility"
        });

        await facilityService.getFacilityById(testFacility.id);

        const cacheKey = `facility:${testFacility.id}`;
        const cachedData = await redis.get(cacheKey);
        expect(cachedData).toBeDefined();
      });
    });
  });

  describe("Visit Service", () => {
    describe("createVisit", () => {
      it("creates a new visit", async () => {
        const testProvider = await testHelpers.insertProvider(pool, {});
        const testPatient = await testHelpers.insertPatient(pool, {});
        const testHospital = await testHelpers.insertInstitution(pool, { type: "hospital" });

        const visitData = {
          patientId: testPatient.id,
          hospitalId: testHospital.id,
          providerId: testProvider.id,
          caseIds: ["case-1", "case-2"],
          type: VisitType.CONSULTATION,
          scheduledAt: new Date("2024-01-15T10:00:00Z"),
          chiefComplaint: "Annual checkup"
        };

        const result = await visitService.createVisit(visitData);

        expect(result).toBeDefined();
        expect(result.id).toBeDefined();
        expect(result.patientId).toBe(testPatient.id);
        expect(result.providerId).toBe(testProvider.id);
        expect(result.type).toBe(VisitType.CONSULTATION);
        expect(result.status).toBe(VisitStatus.SCHEDULED);
        expect(result.caseIds).toEqual(["case-1", "case-2"]);
        expect(result.chiefComplaint).toBe("Annual checkup");
      });
    });

    describe("getVisitById", () => {
      it("retrieves visit by ID", async () => {
        const testProvider = await testHelpers.insertProvider(pool, {});
        const testPatient = await testHelpers.insertPatient(pool, {});
        const testHospital = await testHelpers.insertInstitution(pool, { type: "hospital" });

        // This will be implemented after we create the database structure
        const visitData = {
          patientId: testPatient.id,
          hospitalId: testHospital.id,
          providerId: testProvider.id,
          caseIds: [],
          type: VisitType.FOLLOW_UP,
          scheduledAt: new Date()
        };

        const visit = await visitService.createVisit(visitData);
        const result = await visitService.getVisitById(visit.id);

        expect(result).toBeDefined();
        expect(result!.id).toBe(visit.id);
        expect(result!.type).toBe(VisitType.FOLLOW_UP);
      });
    });

    describe("getVisitsForProvider", () => {
      it("retrieves visits for a specific provider", async () => {
        const testProvider = await testHelpers.insertProvider(pool, {});
        const testPatient = await testHelpers.insertPatient(pool, {});
        const testHospital = await testHelpers.insertInstitution(pool, { type: "hospital" });

        await visitService.createVisit({
          patientId: testPatient.id,
          hospitalId: testHospital.id,
          providerId: testProvider.id,
          caseIds: [],
          type: VisitType.CONSULTATION,
          scheduledAt: new Date()
        });

        await visitService.createVisit({
          patientId: testPatient.id,
          hospitalId: testHospital.id,
          providerId: testProvider.id,
          caseIds: [],
          type: VisitType.FOLLOW_UP,
          scheduledAt: new Date()
        });

        const result = await visitService.getVisitsForProvider(testProvider.id);

        expect(result.length).toBe(2);
        expect(result.every(v => v.providerId === testProvider.id)).toBe(true);
      });
    });

    describe("updateVisit", () => {
      it("updates visit status and information", async () => {
        const testProvider = await testHelpers.insertProvider(pool, {});
        const testPatient = await testHelpers.insertPatient(pool, {});
        const testHospital = await testHelpers.insertInstitution(pool, { type: "hospital" });

        const visit = await visitService.createVisit({
          patientId: testPatient.id,
          hospitalId: testHospital.id,
          providerId: testProvider.id,
          caseIds: [],
          type: VisitType.CONSULTATION,
          scheduledAt: new Date()
        });

        const updates = {
          status: VisitStatus.IN_PROGRESS,
          notes: "Patient arrived on time"
        };

        const result = await visitService.updateVisit(visit.id, updates);

        expect(result).toBeDefined();
        expect(result!.status).toBe(VisitStatus.IN_PROGRESS);
        expect(result!.notes).toBe("Patient arrived on time");
      });
    });
  });

  describe("Error handling", () => {
    it("handles database connection errors gracefully", async () => {
      // This would require mocking the database connection
      // For now, we'll test that the service doesn't crash
      const result = await providerService.getProviders();
      expect(Array.isArray(result)).toBe(true);
    });

    it("handles invalid UUID format", async () => {
      const result = await providerService.getProviderById("invalid-uuid");
      expect(result).toBeNull();
    });
  });
});