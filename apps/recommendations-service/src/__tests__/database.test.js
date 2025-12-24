"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const database_1 = require("@recommendations/services/database");
const setup_1 = require("@test-utils/setup");
describe("Recommendations Database Service", () => {
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
    describe("Recommendation Service", () => {
        describe("createRecommendation", () => {
            it("creates a new recommendation in database", async () => {
                const testPatient = await setup_1.testHelpers.insertPatient(pool, {
                    firstName: "John",
                    lastName: "Doe"
                });
                const testProvider = await setup_1.testHelpers.insertProvider(pool, {
                    firstName: "Dr. Test",
                    lastName: "Provider"
                });
                const recommendationData = {
                    patientId: testPatient.id,
                    providerId: testProvider.id,
                    title: "Annual Physical Examination",
                    description: "Complete annual physical exam with blood work and vital signs assessment",
                    priority: database_1.Priority.MEDIUM
                };
                const result = await database_1.recommendationService.createRecommendation(recommendationData);
                expect(result).toBeDefined();
                expect(result.id).toBeDefined();
                expect(result.patientId).toBe(testPatient.id);
                expect(result.providerId).toBe(testProvider.id);
                expect(result.title).toBe("Annual Physical Examination");
                expect(result.description).toBe("Complete annual physical exam with blood work and vital signs assessment");
                expect(result.priority).toBe(database_1.Priority.MEDIUM);
                expect(result.status).toBe(database_1.RecommendationStatus.DRAFT);
                expect(result.createdAt).toBeDefined();
                expect(result.updatedAt).toBeDefined();
            });
            it("creates recommendation with high priority", async () => {
                const testPatient = await setup_1.testHelpers.insertPatient(pool, {});
                const testProvider = await setup_1.testHelpers.insertProvider(pool, {});
                const recommendationData = {
                    patientId: testPatient.id,
                    providerId: testProvider.id,
                    title: "Urgent Cardiology Consultation",
                    description: "Immediate cardiology consultation required",
                    priority: database_1.Priority.URGENT
                };
                const result = await database_1.recommendationService.createRecommendation(recommendationData);
                expect(result.priority).toBe(database_1.Priority.URGENT);
                expect(result.status).toBe(database_1.RecommendationStatus.DRAFT);
            });
            it("throws error for invalid patient reference", async () => {
                const testProvider = await setup_1.testHelpers.insertProvider(pool, {});
                const recommendationData = {
                    patientId: "non-existent-patient",
                    providerId: testProvider.id,
                    title: "Test Recommendation",
                    description: "Test description",
                    priority: database_1.Priority.LOW
                };
                await expect(database_1.recommendationService.createRecommendation(recommendationData))
                    .rejects.toThrow(/foreign key constraint|invalid.*patient/i);
            });
            it("throws error for invalid provider reference", async () => {
                const testPatient = await setup_1.testHelpers.insertPatient(pool, {});
                const recommendationData = {
                    patientId: testPatient.id,
                    providerId: "non-existent-provider",
                    title: "Test Recommendation",
                    description: "Test description",
                    priority: database_1.Priority.LOW
                };
                await expect(database_1.recommendationService.createRecommendation(recommendationData))
                    .rejects.toThrow(/foreign key constraint|invalid.*provider/i);
            });
        });
        describe("getRecommendationById", () => {
            it("retrieves recommendation by ID", async () => {
                const testPatient = await setup_1.testHelpers.insertPatient(pool, {});
                const testProvider = await setup_1.testHelpers.insertProvider(pool, {});
                const testRecommendation = await setup_1.testHelpers.insertRecommendation(pool, {
                    patientId: testPatient.id,
                    providerId: testProvider.id,
                    title: "Test Recommendation",
                    description: "Test description",
                    priority: database_1.Priority.HIGH,
                    status: database_1.RecommendationStatus.ACTIVE
                });
                const result = await database_1.recommendationService.getRecommendationById(testRecommendation.id);
                expect(result).toBeDefined();
                expect(result.id).toBe(testRecommendation.id);
                expect(result.title).toBe("Test Recommendation");
                expect(result.description).toBe("Test description");
                expect(result.priority).toBe(database_1.Priority.HIGH);
                expect(result.status).toBe(database_1.RecommendationStatus.ACTIVE);
            });
            it("returns null for non-existent recommendation", async () => {
                const result = await database_1.recommendationService.getRecommendationById("non-existent-id");
                expect(result).toBeNull();
            });
            it("uses Redis cache for subsequent requests", async () => {
                const testPatient = await setup_1.testHelpers.insertPatient(pool, {});
                const testProvider = await setup_1.testHelpers.insertProvider(pool, {});
                const testRecommendation = await setup_1.testHelpers.insertRecommendation(pool, {
                    patientId: testPatient.id,
                    providerId: testProvider.id,
                    title: "Cache Test",
                    description: "Cache test description"
                });
                const result1 = await database_1.recommendationService.getRecommendationById(testRecommendation.id);
                expect(result1).toBeDefined();
                const cacheKey = `recommendation:${testRecommendation.id}`;
                const cachedData = await redis.get(cacheKey);
                expect(cachedData).toBeDefined();
                const result2 = await database_1.recommendationService.getRecommendationById(testRecommendation.id);
                expect(result2).toBeDefined();
                expect(result2.id).toBe(testRecommendation.id);
            });
        });
        describe("getRecommendationsForPatient", () => {
            it("retrieves all recommendations for a patient", async () => {
                const testPatient = await setup_1.testHelpers.insertPatient(pool, {});
                const testProvider = await setup_1.testHelpers.insertProvider(pool, {});
                await setup_1.testHelpers.insertRecommendation(pool, {
                    patientId: testPatient.id,
                    providerId: testProvider.id,
                    title: "Recommendation 1",
                    priority: database_1.Priority.HIGH
                });
                await setup_1.testHelpers.insertRecommendation(pool, {
                    patientId: testPatient.id,
                    providerId: testProvider.id,
                    title: "Recommendation 2",
                    priority: database_1.Priority.MEDIUM
                });
                const otherPatient = await setup_1.testHelpers.insertPatient(pool, {});
                await setup_1.testHelpers.insertRecommendation(pool, {
                    patientId: otherPatient.id,
                    providerId: testProvider.id,
                    title: "Other Patient Recommendation"
                });
                const result = await database_1.recommendationService.getRecommendationsForPatient(testPatient.id);
                expect(Array.isArray(result)).toBe(true);
                expect(result.length).toBe(2);
                expect(result.every(r => r.patientId === testPatient.id)).toBe(true);
                expect(result.map(r => r.title)).toEqual(expect.arrayContaining(["Recommendation 1", "Recommendation 2"]));
            });
            it("returns empty array for patient with no recommendations", async () => {
                const testPatient = await setup_1.testHelpers.insertPatient(pool, {});
                const result = await database_1.recommendationService.getRecommendationsForPatient(testPatient.id);
                expect(Array.isArray(result)).toBe(true);
                expect(result.length).toBe(0);
            });
            it("filters by status when provided", async () => {
                const testPatient = await setup_1.testHelpers.insertPatient(pool, {});
                const testProvider = await setup_1.testHelpers.insertProvider(pool, {});
                await setup_1.testHelpers.insertRecommendation(pool, {
                    patientId: testPatient.id,
                    providerId: testProvider.id,
                    title: "Active Recommendation",
                    status: database_1.RecommendationStatus.ACTIVE
                });
                await setup_1.testHelpers.insertRecommendation(pool, {
                    patientId: testPatient.id,
                    providerId: testProvider.id,
                    title: "Draft Recommendation",
                    status: database_1.RecommendationStatus.DRAFT
                });
                const activeResults = await database_1.recommendationService.getRecommendationsForCase(testCase.id, { status: database_1.RecommendationStatus.ACTIVE });
                expect(activeResults.length).toBe(1);
                expect(activeResults[0].title).toBe("Active Recommendation");
                expect(activeResults[0].status).toBe(database_1.RecommendationStatus.ACTIVE);
            });
            it("uses Redis cache for repeated queries", async () => {
                const testPatient = await setup_1.testHelpers.insertPatient(pool, {});
                const testProvider = await setup_1.testHelpers.insertProvider(pool, {});
                await setup_1.testHelpers.insertRecommendation(pool, {
                    patientId: testPatient.id,
                    providerId: testProvider.id,
                    title: "Cache Test"
                });
                await database_1.recommendationService.getRecommendationsForCase(testCase.id);
                const cacheKey = `recommendations:case:${testCase.id}:all`;
                const cachedData = await redis.get(cacheKey);
                expect(cachedData).toBeDefined();
            });
        });
        describe("getRecommendationsByProvider", () => {
            it("retrieves all recommendations by a provider", async () => {
                const testCase1 = await setup_1.testHelpers.insertCase(pool, {});
                const testCase2 = await setup_1.testHelpers.insertCase(pool, {});
                const testProvider = await setup_1.testHelpers.insertProvider(pool, {});
                const otherProvider = await setup_1.testHelpers.insertProvider(pool, {});
                await setup_1.testHelpers.insertRecommendation(pool, {
                    caseId: testCase1.id,
                    providerId: testProvider.id,
                    title: "Provider Recommendation 1"
                });
                await setup_1.testHelpers.insertRecommendation(pool, {
                    caseId: testCase2.id,
                    providerId: testProvider.id,
                    title: "Provider Recommendation 2"
                });
                await setup_1.testHelpers.insertRecommendation(pool, {
                    caseId: testCase1.id,
                    providerId: otherProvider.id,
                    title: "Other Provider Recommendation"
                });
                const result = await database_1.recommendationService.getRecommendationsByProvider(testProvider.id);
                expect(Array.isArray(result)).toBe(true);
                expect(result.length).toBe(2);
                expect(result.every(r => r.providerId === testProvider.id)).toBe(true);
                expect(result.map(r => r.title)).toEqual(expect.arrayContaining(["Provider Recommendation 1", "Provider Recommendation 2"]));
            });
            it("respects limit and offset parameters", async () => {
                const testPatient = await setup_1.testHelpers.insertPatient(pool, {});
                const testProvider = await setup_1.testHelpers.insertProvider(pool, {});
                for (let i = 1; i <= 5; i++) {
                    await setup_1.testHelpers.insertRecommendation(pool, {
                        patientId: testPatient.id,
                        providerId: testProvider.id,
                        title: `Recommendation ${i}`
                    });
                }
                const result = await database_1.recommendationService.getRecommendationsByProvider(testProvider.id, { limit: 2, offset: 1 });
                expect(result.length).toBe(2);
            });
        });
        describe("updateRecommendationStatus", () => {
            it("updates recommendation status", async () => {
                const testPatient = await setup_1.testHelpers.insertPatient(pool, {});
                const testProvider = await setup_1.testHelpers.insertProvider(pool, {});
                const testRecommendation = await setup_1.testHelpers.insertRecommendation(pool, {
                    patientId: testPatient.id,
                    providerId: testProvider.id,
                    title: "Status Test",
                    status: database_1.RecommendationStatus.DRAFT
                });
                const result = await database_1.recommendationService.updateRecommendationStatus(testRecommendation.id, database_1.RecommendationStatus.ACTIVE);
                expect(result).toBeDefined();
                expect(result.status).toBe(database_1.RecommendationStatus.ACTIVE);
                expect(result.updatedAt).toBeDefined();
                expect(new Date(result.updatedAt).getTime()).toBeGreaterThan(new Date(testRecommendation.createdAt).getTime());
            });
            it("returns null for non-existent recommendation", async () => {
                const result = await database_1.recommendationService.updateRecommendationStatus("non-existent", database_1.RecommendationStatus.ACTIVE);
                expect(result).toBeNull();
            });
            it("invalidates cache after update", async () => {
                const testPatient = await setup_1.testHelpers.insertPatient(pool, {});
                const testProvider = await setup_1.testHelpers.insertProvider(pool, {});
                const testRecommendation = await setup_1.testHelpers.insertRecommendation(pool, {
                    patientId: testPatient.id,
                    providerId: testProvider.id,
                    title: "Cache Invalidation Test"
                });
                await database_1.recommendationService.getRecommendationById(testRecommendation.id);
                await database_1.recommendationService.updateRecommendationStatus(testRecommendation.id, database_1.RecommendationStatus.COMPLETED);
                const cacheKey = `recommendation:${testRecommendation.id}`;
                const cachedData = await redis.get(cacheKey);
                expect(cachedData).toBeNull();
            });
        });
        describe("updateRecommendation", () => {
            it("updates recommendation information", async () => {
                const testPatient = await setup_1.testHelpers.insertPatient(pool, {});
                const testProvider = await setup_1.testHelpers.insertProvider(pool, {});
                const testRecommendation = await setup_1.testHelpers.insertRecommendation(pool, {
                    patientId: testPatient.id,
                    providerId: testProvider.id,
                    title: "Original Title",
                    description: "Original description",
                    priority: database_1.Priority.LOW
                });
                const updates = {
                    title: "Updated Title",
                    description: "Updated description",
                    priority: database_1.Priority.HIGH
                };
                const result = await database_1.recommendationService.updateRecommendation(testRecommendation.id, updates);
                expect(result).toBeDefined();
                expect(result.title).toBe("Updated Title");
                expect(result.description).toBe("Updated description");
                expect(result.priority).toBe(database_1.Priority.HIGH);
                expect(result.updatedAt).toBeDefined();
            });
            it("returns null for non-existent recommendation", async () => {
                const result = await database_1.recommendationService.updateRecommendation("non-existent", {
                    title: "Updated"
                });
                expect(result).toBeNull();
            });
        });
        describe("deleteRecommendation", () => {
            it("deletes recommendation from database", async () => {
                const testPatient = await setup_1.testHelpers.insertPatient(pool, {});
                const testProvider = await setup_1.testHelpers.insertProvider(pool, {});
                const testRecommendation = await setup_1.testHelpers.insertRecommendation(pool, {
                    patientId: testPatient.id,
                    providerId: testProvider.id,
                    title: "Delete Me"
                });
                const result = await database_1.recommendationService.deleteRecommendation(testRecommendation.id);
                expect(result).toBe(true);
                const deletedRecommendation = await database_1.recommendationService.getRecommendationById(testRecommendation.id);
                expect(deletedRecommendation).toBeNull();
            });
            it("returns false for non-existent recommendation", async () => {
                const result = await database_1.recommendationService.deleteRecommendation("non-existent");
                expect(result).toBe(false);
            });
        });
    });
    describe("Error handling", () => {
        it("handles database connection errors gracefully", async () => {
            const result = await database_1.recommendationService.getRecommendationsByProvider("test-provider");
            expect(Array.isArray(result)).toBe(true);
        });
        it("handles invalid UUID format", async () => {
            const result = await database_1.recommendationService.getRecommendationById("invalid-uuid");
            expect(result).toBeNull();
        });
    });
});
//# sourceMappingURL=database.test.js.map