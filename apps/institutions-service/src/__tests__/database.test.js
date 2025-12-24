"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const database_1 = require("@institutions/services/database");
const setup_1 = require("@test-utils/setup");
describe("Institutions Database Service", () => {
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
    describe("Institution Service", () => {
        describe("createInstitution", () => {
            it("creates a new institution in database", async () => {
                const institutionData = {
                    name: "Metropolitan Health System",
                    type: database_1.InstitutionType.HOSPITAL_SYSTEM,
                    address: {
                        street: "1000 Medical Center Blvd",
                        city: "Metro City",
                        state: "CA",
                        zipCode: "90210",
                        country: "USA"
                    },
                    phone: "(555) 123-4567",
                    email: "info@metro-health.com",
                    website: "https://metro-health.com",
                    accreditation: ["Joint Commission", "MAGNET"]
                };
                const result = await database_1.institutionService.createInstitution(institutionData);
                expect(result).toBeDefined();
                expect(result.id).toBeDefined();
                expect(result.name).toBe("Metropolitan Health System");
                expect(result.type).toBe(database_1.InstitutionType.HOSPITAL_SYSTEM);
                expect(result.address.street).toBe("1000 Medical Center Blvd");
                expect(result.address.city).toBe("Metro City");
                expect(result.phone).toBe("(555) 123-4567");
                expect(result.email).toBe("info@metro-health.com");
                expect(result.website).toBe("https://metro-health.com");
                expect(result.accreditation).toEqual(["Joint Commission", "MAGNET"]);
                expect(result.isActive).toBe(true);
                expect(result.createdAt).toBeDefined();
                expect(result.updatedAt).toBeDefined();
            });
            it("creates institution without optional fields", async () => {
                const institutionData = {
                    name: "Basic Medical Center",
                    type: database_1.InstitutionType.MEDICAL_CENTER,
                    address: {
                        street: "500 Healthcare Way",
                        city: "Basic City",
                        state: "NY",
                        zipCode: "10001",
                        country: "USA"
                    },
                    phone: "(555) 987-6543",
                    accreditation: ["Joint Commission"]
                };
                const result = await database_1.institutionService.createInstitution(institutionData);
                expect(result).toBeDefined();
                expect(result.name).toBe("Basic Medical Center");
                expect(result.type).toBe(database_1.InstitutionType.MEDICAL_CENTER);
                expect(result.email).toBeNull();
                expect(result.website).toBeNull();
                expect(result.isActive).toBe(true);
            });
            it("throws error for duplicate institution name", async () => {
                const institutionData = {
                    name: "Duplicate Health System",
                    type: database_1.InstitutionType.HOSPITAL_SYSTEM,
                    address: {
                        street: "100 Main St",
                        city: "Test City",
                        state: "CA",
                        zipCode: "90000",
                        country: "USA"
                    },
                    phone: "(555) 000-0000",
                    accreditation: []
                };
                await database_1.institutionService.createInstitution(institutionData);
                await expect(database_1.institutionService.createInstitution(institutionData))
                    .rejects.toThrow(/duplicate.*name/i);
            });
        });
        describe("getInstitutionById", () => {
            it("retrieves institution by ID", async () => {
                const testInstitution = await setup_1.testHelpers.insertInstitution(pool, {
                    name: "Test Medical Center",
                    type: "MEDICAL_CENTER",
                    phone: "(555) 123-0000",
                    address: { street: "123 Test St", city: "Test City", state: "CA", zip: "90000" }
                });
                const result = await database_1.institutionService.getInstitutionById(testInstitution.id);
                expect(result).toBeDefined();
                expect(result.id).toBe(testInstitution.id);
                expect(result.name).toBe("Test Medical Center");
                expect(result.type).toBe(database_1.InstitutionType.MEDICAL_CENTER);
            });
            it("returns null for non-existent institution", async () => {
                const result = await database_1.institutionService.getInstitutionById("non-existent-id");
                expect(result).toBeNull();
            });
            it("uses Redis cache for subsequent requests", async () => {
                const testInstitution = await setup_1.testHelpers.insertInstitution(pool, {
                    name: "Cache Test Institution",
                    type: "HOSPITAL_SYSTEM"
                });
                const result1 = await database_1.institutionService.getInstitutionById(testInstitution.id);
                expect(result1).toBeDefined();
                const cacheKey = `institution:${testInstitution.id}`;
                const cachedData = await redis.get(cacheKey);
                expect(cachedData).toBeDefined();
                const result2 = await database_1.institutionService.getInstitutionById(testInstitution.id);
                expect(result2).toBeDefined();
                expect(result2.id).toBe(testInstitution.id);
            });
        });
        describe("getInstitutions", () => {
            it("retrieves all institutions with default pagination", async () => {
                await setup_1.testHelpers.insertInstitution(pool, { name: "Institution 1", type: "HOSPITAL_SYSTEM" });
                await setup_1.testHelpers.insertInstitution(pool, { name: "Institution 2", type: "MEDICAL_CENTER" });
                await setup_1.testHelpers.insertInstitution(pool, { name: "Institution 3", type: "UNIVERSITY" });
                const result = await database_1.institutionService.getInstitutions();
                expect(Array.isArray(result)).toBe(true);
                expect(result.length).toBe(3);
            });
            it("filters by institution type", async () => {
                await setup_1.testHelpers.insertInstitution(pool, { name: "Hospital System 1", type: "HOSPITAL_SYSTEM" });
                await setup_1.testHelpers.insertInstitution(pool, { name: "Medical Center 1", type: "MEDICAL_CENTER" });
                await setup_1.testHelpers.insertInstitution(pool, { name: "Hospital System 2", type: "HOSPITAL_SYSTEM" });
                const result = await database_1.institutionService.getInstitutions({ type: database_1.InstitutionType.HOSPITAL_SYSTEM });
                expect(result.length).toBe(2);
                expect(result.every(i => i.type === database_1.InstitutionType.HOSPITAL_SYSTEM)).toBe(true);
            });
            it("respects limit and offset parameters", async () => {
                for (let i = 1; i <= 5; i++) {
                    await setup_1.testHelpers.insertInstitution(pool, {
                        name: `Institution ${i}`,
                        type: "MEDICAL_CENTER"
                    });
                }
                const result = await database_1.institutionService.getInstitutions({ limit: 2, offset: 1 });
                expect(result.length).toBe(2);
            });
            it("uses Redis cache for repeated queries", async () => {
                await setup_1.testHelpers.insertInstitution(pool, { name: "Cache Test", type: "CLINIC_NETWORK" });
                await database_1.institutionService.getInstitutions({ limit: 10, offset: 0 });
                const cacheKey = 'institutions:all:10:0:';
                const cachedData = await redis.get(cacheKey);
                expect(cachedData).toBeDefined();
            });
        });
        describe("updateInstitution", () => {
            it("updates institution information", async () => {
                const testInstitution = await setup_1.testHelpers.insertInstitution(pool, {
                    name: "Original Name",
                    type: "MEDICAL_CENTER",
                    phone: "(555) 000-0000",
                    email: "original@test.com"
                });
                const updates = {
                    name: "Updated Name",
                    phone: "(555) 111-1111",
                    email: "updated@test.com",
                    website: "https://updated.com"
                };
                const result = await database_1.institutionService.updateInstitution(testInstitution.id, updates);
                expect(result).toBeDefined();
                expect(result.name).toBe("Updated Name");
                expect(result.phone).toBe("(555) 111-1111");
                expect(result.email).toBe("updated@test.com");
                expect(result.website).toBe("https://updated.com");
                expect(result.updatedAt).toBeDefined();
            });
            it("returns null for non-existent institution", async () => {
                const result = await database_1.institutionService.updateInstitution("non-existent", {
                    name: "Updated"
                });
                expect(result).toBeNull();
            });
            it("invalidates cache after update", async () => {
                const testInstitution = await setup_1.testHelpers.insertInstitution(pool, {
                    name: "Cache Test Institution"
                });
                await database_1.institutionService.getInstitutionById(testInstitution.id);
                await database_1.institutionService.updateInstitution(testInstitution.id, {
                    name: "Updated Institution"
                });
                const cacheKey = `institution:${testInstitution.id}`;
                const cachedData = await redis.get(cacheKey);
                expect(cachedData).toBeNull();
            });
        });
        describe("deleteInstitution", () => {
            it("deletes institution from database", async () => {
                const testInstitution = await setup_1.testHelpers.insertInstitution(pool, {
                    name: "Delete Me"
                });
                const result = await database_1.institutionService.deleteInstitution(testInstitution.id);
                expect(result).toBe(true);
                const deletedInstitution = await database_1.institutionService.getInstitutionById(testInstitution.id);
                expect(deletedInstitution).toBeNull();
            });
            it("returns false for non-existent institution", async () => {
                const result = await database_1.institutionService.deleteInstitution("non-existent");
                expect(result).toBe(false);
            });
            it("handles cascade deletion of related hospitals", async () => {
                const testInstitution = await setup_1.testHelpers.insertInstitution(pool, {
                    name: "Parent Institution"
                });
                const result = await database_1.institutionService.deleteInstitution(testInstitution.id);
                expect(result).toBe(true);
            });
        });
    });
    describe("Hospital Service", () => {
        describe("createHospital", () => {
            it("creates a new hospital in database", async () => {
                const testInstitution = await setup_1.testHelpers.insertInstitution(pool, {
                    name: "Parent Health System"
                });
                const hospitalData = {
                    name: "Metropolitan General Hospital",
                    institutionId: testInstitution.id,
                    address: {
                        street: "1000 Medical Center Blvd",
                        city: "Metro City",
                        state: "CA",
                        zipCode: "90210",
                        country: "USA"
                    },
                    phone: "(555) 123-4567",
                    email: "info@metro-general.com",
                    website: "https://metro-general.com",
                    beds: 450,
                    departments: ["Emergency", "Cardiology", "Oncology"],
                    emergencyServices: true
                };
                const result = await database_1.hospitalService.createHospital(hospitalData);
                expect(result).toBeDefined();
                expect(result.id).toBeDefined();
                expect(result.name).toBe("Metropolitan General Hospital");
                expect(result.institutionId).toBe(testInstitution.id);
                expect(result.beds).toBe(450);
                expect(result.departments).toEqual(["Emergency", "Cardiology", "Oncology"]);
                expect(result.emergencyServices).toBe(true);
                expect(result.isActive).toBe(true);
                expect(result.createdAt).toBeDefined();
                expect(result.updatedAt).toBeDefined();
            });
            it("throws error for invalid institution reference", async () => {
                const hospitalData = {
                    name: "Test Hospital",
                    institutionId: "non-existent-institution",
                    address: {
                        street: "123 Test St",
                        city: "Test City",
                        state: "CA",
                        zipCode: "90000",
                        country: "USA"
                    },
                    phone: "(555) 000-0000",
                    departments: ["Emergency"],
                    emergencyServices: true
                };
                await expect(database_1.hospitalService.createHospital(hospitalData))
                    .rejects.toThrow(/foreign key constraint|invalid.*institution/i);
            });
        });
        describe("getHospitalById", () => {
            it("retrieves hospital by ID", async () => {
                const testInstitution = await setup_1.testHelpers.insertInstitution(pool, {});
                const hospitalData = {
                    name: "Test Hospital",
                    institutionId: testInstitution.id,
                    address: {
                        street: "123 Test St",
                        city: "Test City",
                        state: "CA",
                        zipCode: "90000",
                        country: "USA"
                    },
                    phone: "(555) 000-0000",
                    departments: ["Emergency"],
                    emergencyServices: true
                };
                const createdHospital = await database_1.hospitalService.createHospital(hospitalData);
                const result = await database_1.hospitalService.getHospitalById(createdHospital.id);
                expect(result).toBeDefined();
                expect(result.id).toBe(createdHospital.id);
                expect(result.name).toBe("Test Hospital");
                expect(result.institutionId).toBe(testInstitution.id);
            });
            it("returns null for non-existent hospital", async () => {
                const result = await database_1.hospitalService.getHospitalById("non-existent-id");
                expect(result).toBeNull();
            });
            it("uses Redis cache for subsequent requests", async () => {
                const testInstitution = await setup_1.testHelpers.insertInstitution(pool, {});
                const hospitalData = {
                    name: "Cache Test Hospital",
                    institutionId: testInstitution.id,
                    address: {
                        street: "123 Cache St",
                        city: "Cache City",
                        state: "CA",
                        zipCode: "90000",
                        country: "USA"
                    },
                    phone: "(555) 000-0000",
                    departments: ["Emergency"],
                    emergencyServices: true
                };
                const createdHospital = await database_1.hospitalService.createHospital(hospitalData);
                const result1 = await database_1.hospitalService.getHospitalById(createdHospital.id);
                expect(result1).toBeDefined();
                const cacheKey = `hospital:${createdHospital.id}`;
                const cachedData = await redis.get(cacheKey);
                expect(cachedData).toBeDefined();
                const result2 = await database_1.hospitalService.getHospitalById(createdHospital.id);
                expect(result2).toBeDefined();
                expect(result2.id).toBe(createdHospital.id);
            });
        });
        describe("getHospitalsByInstitution", () => {
            it("retrieves hospitals for a specific institution", async () => {
                const testInstitution = await setup_1.testHelpers.insertInstitution(pool, {});
                const otherInstitution = await setup_1.testHelpers.insertInstitution(pool, {});
                await database_1.hospitalService.createHospital({
                    name: "Hospital 1",
                    institutionId: testInstitution.id,
                    address: { street: "123 St", city: "City", state: "CA", zipCode: "90000", country: "USA" },
                    phone: "(555) 001-0000",
                    departments: ["Emergency"],
                    emergencyServices: true
                });
                await database_1.hospitalService.createHospital({
                    name: "Hospital 2",
                    institutionId: testInstitution.id,
                    address: { street: "456 St", city: "City", state: "CA", zipCode: "90000", country: "USA" },
                    phone: "(555) 002-0000",
                    departments: ["Emergency"],
                    emergencyServices: true
                });
                await database_1.hospitalService.createHospital({
                    name: "Other Hospital",
                    institutionId: otherInstitution.id,
                    address: { street: "789 St", city: "City", state: "CA", zipCode: "90000", country: "USA" },
                    phone: "(555) 003-0000",
                    departments: ["Emergency"],
                    emergencyServices: true
                });
                const result = await database_1.hospitalService.getHospitalsByInstitution(testInstitution.id);
                expect(result.length).toBe(2);
                expect(result.every(h => h.institutionId === testInstitution.id)).toBe(true);
                expect(result.map(h => h.name)).toEqual(expect.arrayContaining(["Hospital 1", "Hospital 2"]));
            });
            it("returns empty array for institution with no hospitals", async () => {
                const testInstitution = await setup_1.testHelpers.insertInstitution(pool, {});
                const result = await database_1.hospitalService.getHospitalsByInstitution(testInstitution.id);
                expect(Array.isArray(result)).toBe(true);
                expect(result.length).toBe(0);
            });
        });
        describe("updateHospital", () => {
            it("updates hospital information", async () => {
                const testInstitution = await setup_1.testHelpers.insertInstitution(pool, {});
                const hospital = await database_1.hospitalService.createHospital({
                    name: "Original Hospital",
                    institutionId: testInstitution.id,
                    address: { street: "123 St", city: "City", state: "CA", zipCode: "90000", country: "USA" },
                    phone: "(555) 000-0000",
                    departments: ["Emergency"],
                    emergencyServices: true
                });
                const updates = {
                    name: "Updated Hospital",
                    beds: 300,
                    departments: ["Emergency", "Cardiology", "Surgery"]
                };
                const result = await database_1.hospitalService.updateHospital(hospital.id, updates);
                expect(result).toBeDefined();
                expect(result.name).toBe("Updated Hospital");
                expect(result.beds).toBe(300);
                expect(result.departments).toEqual(["Emergency", "Cardiology", "Surgery"]);
                expect(result.updatedAt).toBeDefined();
            });
            it("returns null for non-existent hospital", async () => {
                const result = await database_1.hospitalService.updateHospital("non-existent", {
                    name: "Updated"
                });
                expect(result).toBeNull();
            });
        });
        describe("deleteHospital", () => {
            it("deletes hospital from database", async () => {
                const testInstitution = await setup_1.testHelpers.insertInstitution(pool, {});
                const hospital = await database_1.hospitalService.createHospital({
                    name: "Delete Me Hospital",
                    institutionId: testInstitution.id,
                    address: { street: "123 St", city: "City", state: "CA", zipCode: "90000", country: "USA" },
                    phone: "(555) 000-0000",
                    departments: ["Emergency"],
                    emergencyServices: true
                });
                const result = await database_1.hospitalService.deleteHospital(hospital.id);
                expect(result).toBe(true);
                const deletedHospital = await database_1.hospitalService.getHospitalById(hospital.id);
                expect(deletedHospital).toBeNull();
            });
            it("returns false for non-existent hospital", async () => {
                const result = await database_1.hospitalService.deleteHospital("non-existent");
                expect(result).toBe(false);
            });
        });
    });
    describe("Error handling", () => {
        it("handles database connection errors gracefully", async () => {
            const result = await database_1.institutionService.getInstitutions();
            expect(Array.isArray(result)).toBe(true);
        });
        it("handles invalid UUID format", async () => {
            const result = await database_1.institutionService.getInstitutionById("invalid-uuid");
            expect(result).toBeNull();
        });
    });
});
//# sourceMappingURL=database.test.js.map