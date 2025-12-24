"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const database_1 = require("@patients/services/database");
const setup_1 = require("@test-utils/setup");
describe("Patient Database Service", () => {
    let pool;
    let redis;
    beforeAll(async () => {
        pool = await (0, setup_1.setupTestDatabase)();
        redis = await (0, setup_1.setupTestRedis)();
    });
    beforeEach(async () => {
        await (0, setup_1.cleanupTestDatabase)();
    });
    afterAll(async () => {
        await (0, setup_1.closeTestConnections)();
    });
    describe("createPatient", () => {
        it("creates a new patient in database", async () => {
            const patientData = {
                firstName: "John",
                lastName: "Doe",
                dateOfBirth: "1985-05-15",
                gender: "male",
                email: "john.doe@test.com",
                phone: "555-1234"
            };
            const result = await database_1.patientService.createPatient(patientData);
            expect(result).toBeDefined();
            expect(result.id).toBeDefined();
            expect(result.firstName).toBe("John");
            expect(result.lastName).toBe("Doe");
            expect(result.email).toBe("john.doe@test.com");
            expect(result.medicalRecordNumber).toBeDefined();
            expect(result.createdAt).toBeDefined();
        });
        it("generates unique medical record numbers", async () => {
            const patient1 = await database_1.patientService.createPatient({
                firstName: "John",
                lastName: "Doe",
                dateOfBirth: "1985-05-15"
            });
            const patient2 = await database_1.patientService.createPatient({
                firstName: "Jane",
                lastName: "Smith",
                dateOfBirth: "1990-10-20"
            });
            expect(patient1.medicalRecordNumber).toBeDefined();
            expect(patient2.medicalRecordNumber).toBeDefined();
            expect(patient1.medicalRecordNumber).not.toBe(patient2.medicalRecordNumber);
        });
        it("handles optional fields correctly", async () => {
            const result = await database_1.patientService.createPatient({
                firstName: "Minimal",
                lastName: "Patient",
                dateOfBirth: "1995-01-01"
            });
            expect(result.firstName).toBe("Minimal");
            expect(result.lastName).toBe("Patient");
            expect(result.email).toBeNull();
            expect(result.phone).toBeNull();
        });
    });
    describe("getPatientById", () => {
        it("retrieves patient by ID", async () => {
            const testPatient = await setup_1.testHelpers.insertPatient(pool, {
                firstName: "Retrieve",
                lastName: "Me"
            });
            const result = await database_1.patientService.getPatientById(testPatient.id);
            expect(result).toBeDefined();
            expect(result.id).toBe(testPatient.id);
            expect(result.firstName).toBe("Retrieve");
            expect(result.lastName).toBe("Me");
        });
        it("returns null for non-existent patient", async () => {
            const result = await database_1.patientService.getPatientById("non-existent-id");
            expect(result).toBeNull();
        });
        it("uses Redis cache for subsequent requests", async () => {
            const testPatient = await setup_1.testHelpers.insertPatient(pool, {
                firstName: "Cache",
                lastName: "Test"
            });
            const result1 = await database_1.patientService.getPatientById(testPatient.id);
            expect(result1).toBeDefined();
            const cacheKey = `patient:${testPatient.id}`;
            const cachedData = await redis.get(cacheKey);
            expect(cachedData).toBeDefined();
            const result2 = await database_1.patientService.getPatientById(testPatient.id);
            expect(result2).toBeDefined();
            expect(result2.id).toBe(testPatient.id);
        });
    });
    describe("getAllPatients", () => {
        it("retrieves all patients with default pagination", async () => {
            await setup_1.testHelpers.insertPatient(pool, { firstName: "Patient1", lastName: "Test" });
            await setup_1.testHelpers.insertPatient(pool, { firstName: "Patient2", lastName: "Test" });
            await setup_1.testHelpers.insertPatient(pool, { firstName: "Patient3", lastName: "Test" });
            const result = await database_1.patientService.getAllPatients();
            expect(Array.isArray(result)).toBe(true);
            expect(result.length).toBe(3);
        });
        it("respects limit parameter", async () => {
            for (let i = 1; i <= 5; i++) {
                await setup_1.testHelpers.insertPatient(pool, {
                    firstName: `Patient${i}`,
                    lastName: "Test"
                });
            }
            const result = await database_1.patientService.getAllPatients(3, 0);
            expect(result.length).toBe(3);
        });
        it("respects offset parameter", async () => {
            for (let i = 1; i <= 5; i++) {
                await setup_1.testHelpers.insertPatient(pool, {
                    firstName: `Patient${i}`,
                    lastName: "Test"
                });
            }
            const result = await database_1.patientService.getAllPatients(2, 2);
            expect(result.length).toBe(2);
        });
        it("uses Redis cache for repeated queries", async () => {
            await setup_1.testHelpers.insertPatient(pool, { firstName: "Cache", lastName: "Test" });
            const result1 = await database_1.patientService.getAllPatients(10, 0);
            expect(result1.length).toBe(1);
            const cacheKey = 'patients:all:10:0';
            const cachedData = await redis.get(cacheKey);
            expect(cachedData).toBeDefined();
            const result2 = await database_1.patientService.getAllPatients(10, 0);
            expect(result2.length).toBe(1);
        });
    });
    describe("updatePatient", () => {
        it("updates patient information", async () => {
            const testPatient = await setup_1.testHelpers.insertPatient(pool, {
                firstName: "Original",
                lastName: "Name",
                email: "original@test.com"
            });
            const updates = {
                firstName: "Updated",
                email: "updated@test.com"
            };
            const result = await database_1.patientService.updatePatient(testPatient.id, updates);
            expect(result).toBeDefined();
            expect(result.firstName).toBe("Updated");
            expect(result.lastName).toBe("Name");
            expect(result.email).toBe("updated@test.com");
            expect(result.updatedAt).toBeDefined();
        });
        it("returns null for non-existent patient", async () => {
            const result = await database_1.patientService.updatePatient("non-existent", {
                firstName: "Updated"
            });
            expect(result).toBeNull();
        });
        it("invalidates cache after update", async () => {
            const testPatient = await setup_1.testHelpers.insertPatient(pool, {
                firstName: "Cache",
                lastName: "Test"
            });
            await database_1.patientService.getPatientById(testPatient.id);
            const cacheKey = `patient:${testPatient.id}`;
            let cachedData = await redis.get(cacheKey);
            expect(cachedData).toBeDefined();
            await database_1.patientService.updatePatient(testPatient.id, {
                firstName: "Updated"
            });
            cachedData = await redis.get(cacheKey);
            expect(cachedData).toBeNull();
        });
    });
    describe("deletePatient", () => {
        it("deletes patient from database", async () => {
            const testPatient = await setup_1.testHelpers.insertPatient(pool, {
                firstName: "Delete",
                lastName: "Me"
            });
            const result = await database_1.patientService.deletePatient(testPatient.id);
            expect(result).toBe(true);
            const deletedPatient = await database_1.patientService.getPatientById(testPatient.id);
            expect(deletedPatient).toBeNull();
        });
        it("returns false for non-existent patient", async () => {
            const result = await database_1.patientService.deletePatient("non-existent");
            expect(result).toBe(false);
        });
        it("invalidates cache after deletion", async () => {
            const testPatient = await setup_1.testHelpers.insertPatient(pool, {
                firstName: "Cache",
                lastName: "Delete"
            });
            await database_1.patientService.getPatientById(testPatient.id);
            const cacheKey = `patient:${testPatient.id}`;
            let cachedData = await redis.get(cacheKey);
            expect(cachedData).toBeDefined();
            await database_1.patientService.deletePatient(testPatient.id);
            cachedData = await redis.get(cacheKey);
            expect(cachedData).toBeNull();
        });
    });
    describe("Error handling", () => {
        it("handles database constraint violations", async () => {
            await setup_1.testHelpers.insertPatient(pool, {
                medicalRecordNumber: "UNIQUE-MRN-123"
            });
            try {
                await pool.query(`
          INSERT INTO patients (first_name, last_name, date_of_birth, medical_record_number)
          VALUES ($1, $2, $3, $4)
        `, ["Test", "Duplicate", "1990-01-01", "UNIQUE-MRN-123"]);
                fail("Should have thrown constraint violation error");
            }
            catch (error) {
                expect(error).toBeDefined();
            }
        });
        it("handles invalid UUID format", async () => {
            const result = await database_1.patientService.getPatientById("invalid-uuid");
            expect(result).toBeNull();
        });
    });
});
//# sourceMappingURL=database.test.js.map