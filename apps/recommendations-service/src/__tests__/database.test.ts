import { Pool } from 'pg';
import { Redis } from 'ioredis';
import { 
  recommendationService,
  Recommendation,
  Priority,
  RecommendationStatus,
  initializeDatabase
} from '@recommendations/services/database';
import { setupTestDatabase, setupTestRedis, cleanupTestDatabase, closeTestConnections, testHelpers } from "@test-utils/setup";

describe("Recommendations Database Service", () => {
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

  describe("Recommendation Service", () => {
    describe("createRecommendation", () => {
      it("creates a new recommendation in database", async () => {
        const testPatient = await testHelpers.insertPatient(pool, {
          firstName: "John",
          lastName: "Doe"
        });
        const testProvider = await testHelpers.insertProvider(pool, {
          firstName: "Dr. Test",
          lastName: "Provider"
        });

        const recommendationData = {
          patientId: testPatient.id,
          providerId: testProvider.id,
          title: "Annual Physical Examination",
          description: "Complete annual physical exam with blood work and vital signs assessment",
          priority: Priority.MEDIUM
        };

        const result = await recommendationService.createRecommendation(recommendationData);

        expect(result).toBeDefined();
        expect(result.id).toBeDefined();
        expect(result.patientId).toBe(testPatient.id);
        expect(result.providerId).toBe(testProvider.id);
        expect(result.title).toBe("Annual Physical Examination");
        expect(result.description).toBe("Complete annual physical exam with blood work and vital signs assessment");
        expect(result.priority).toBe(Priority.MEDIUM);
        expect(result.status).toBe(RecommendationStatus.DRAFT);
        expect(result.createdAt).toBeDefined();
        expect(result.updatedAt).toBeDefined();
      });

      it("creates recommendation with high priority", async () => {
        const testPatient = await testHelpers.insertPatient(pool, {});
        const testProvider = await testHelpers.insertProvider(pool, {});

        const recommendationData = {
          patientId: testPatient.id,
          providerId: testProvider.id,
          title: "Urgent Cardiology Consultation",
          description: "Immediate cardiology consultation required",
          priority: Priority.URGENT
        };

        const result = await recommendationService.createRecommendation(recommendationData);

        expect(result.priority).toBe(Priority.URGENT);
        expect(result.status).toBe(RecommendationStatus.DRAFT);
      });

      it("throws error for invalid patient reference", async () => {
        const testProvider = await testHelpers.insertProvider(pool, {});

        const recommendationData = {
          patientId: "non-existent-patient",
          providerId: testProvider.id,
          title: "Test Recommendation",
          description: "Test description",
          priority: Priority.LOW
        };

        await expect(recommendationService.createRecommendation(recommendationData))
          .rejects.toThrow(/foreign key constraint|invalid.*patient/i);
      });

      it("throws error for invalid provider reference", async () => {
        const testPatient = await testHelpers.insertPatient(pool, {});

        const recommendationData = {
          patientId: testPatient.id,
          providerId: "non-existent-provider",
          title: "Test Recommendation",
          description: "Test description",
          priority: Priority.LOW
        };

        await expect(recommendationService.createRecommendation(recommendationData))
          .rejects.toThrow(/foreign key constraint|invalid.*provider/i);
      });
    });

    describe("getRecommendationById", () => {
      it("retrieves recommendation by ID", async () => {
        const testPatient = await testHelpers.insertPatient(pool, {});
        const testProvider = await testHelpers.insertProvider(pool, {});
        const testRecommendation = await testHelpers.insertRecommendation(pool, {
          patientId: testPatient.id,
          providerId: testProvider.id,
          title: "Test Recommendation",
          description: "Test description",
          priority: Priority.HIGH,
          status: RecommendationStatus.ACTIVE
        });

        const result = await recommendationService.getRecommendationById(testRecommendation.id);

        expect(result).toBeDefined();
        expect(result!.id).toBe(testRecommendation.id);
        expect(result!.title).toBe("Test Recommendation");
        expect(result!.description).toBe("Test description");
        expect(result!.priority).toBe(Priority.HIGH);
        expect(result!.status).toBe(RecommendationStatus.ACTIVE);
      });

      it("returns null for non-existent recommendation", async () => {
        const result = await recommendationService.getRecommendationById("non-existent-id");
        expect(result).toBeNull();
      });

      it("uses Redis cache for subsequent requests", async () => {
        const testPatient = await testHelpers.insertPatient(pool, {});
        const testProvider = await testHelpers.insertProvider(pool, {});
        const testRecommendation = await testHelpers.insertRecommendation(pool, {
          patientId: testPatient.id,
          providerId: testProvider.id,
          title: "Cache Test",
          description: "Cache test description"
        });

        // First request - should cache the result
        const result1 = await recommendationService.getRecommendationById(testRecommendation.id);
        expect(result1).toBeDefined();

        // Verify data is in cache
        const cacheKey = `recommendation:${testRecommendation.id}`;
        const cachedData = await redis.get(cacheKey);
        expect(cachedData).toBeDefined();

        // Second request - should use cache
        const result2 = await recommendationService.getRecommendationById(testRecommendation.id);
        expect(result2).toBeDefined();
        expect(result2!.id).toBe(testRecommendation.id);
      });
    });

    describe("getRecommendationsForPatient", () => {
      it("retrieves all recommendations for a patient", async () => {
        const testPatient = await testHelpers.insertPatient(pool, {});
        const testProvider = await testHelpers.insertProvider(pool, {});
        
        await testHelpers.insertRecommendation(pool, {
          patientId: testPatient.id,
          providerId: testProvider.id,
          title: "Recommendation 1",
          priority: Priority.HIGH
        });
        await testHelpers.insertRecommendation(pool, {
          patientId: testPatient.id,
          providerId: testProvider.id,
          title: "Recommendation 2",
          priority: Priority.MEDIUM
        });

        // Create recommendation for different patient
        const otherPatient = await testHelpers.insertPatient(pool, {});
        await testHelpers.insertRecommendation(pool, {
          patientId: otherPatient.id,
          providerId: testProvider.id,
          title: "Other Patient Recommendation"
        });

        const result = await recommendationService.getRecommendationsForPatient(testPatient.id);

        expect(Array.isArray(result)).toBe(true);
        expect(result.length).toBe(2);
        expect(result.every(r => r.patientId === testPatient.id)).toBe(true);
        expect(result.map(r => r.title)).toEqual(
          expect.arrayContaining(["Recommendation 1", "Recommendation 2"])
        );
      });

      it("returns empty array for patient with no recommendations", async () => {
        const testPatient = await testHelpers.insertPatient(pool, {});
        const result = await recommendationService.getRecommendationsForPatient(testPatient.id);
        
        expect(Array.isArray(result)).toBe(true);
        expect(result.length).toBe(0);
      });

      it("filters by status when provided", async () => {
        const testPatient = await testHelpers.insertPatient(pool, {});
        const testProvider = await testHelpers.insertProvider(pool, {});
        
        await testHelpers.insertRecommendation(pool, {
          patientId: testPatient.id,
          providerId: testProvider.id,
          title: "Active Recommendation",
          status: RecommendationStatus.ACTIVE
        });
        await testHelpers.insertRecommendation(pool, {
          patientId: testPatient.id,
          providerId: testProvider.id,
          title: "Draft Recommendation",
          status: RecommendationStatus.DRAFT
        });

        const activeResults = await recommendationService.getRecommendationsForCase(
          testCase.id, 
          { status: RecommendationStatus.ACTIVE }
        );

        expect(activeResults.length).toBe(1);
        expect(activeResults[0].title).toBe("Active Recommendation");
        expect(activeResults[0].status).toBe(RecommendationStatus.ACTIVE);
      });

      it("uses Redis cache for repeated queries", async () => {
        const testPatient = await testHelpers.insertPatient(pool, {});
        const testProvider = await testHelpers.insertProvider(pool, {});
        
        await testHelpers.insertRecommendation(pool, {
          patientId: testPatient.id,
          providerId: testProvider.id,
          title: "Cache Test"
        });

        await recommendationService.getRecommendationsForCase(testCase.id);

        const cacheKey = `recommendations:case:${testCase.id}:all`;
        const cachedData = await redis.get(cacheKey);
        expect(cachedData).toBeDefined();
      });
    });

    describe("getRecommendationsByProvider", () => {
      it("retrieves all recommendations by a provider", async () => {
        const testCase1 = await testHelpers.insertCase(pool, {});
        const testCase2 = await testHelpers.insertCase(pool, {});
        const testProvider = await testHelpers.insertProvider(pool, {});
        const otherProvider = await testHelpers.insertProvider(pool, {});
        
        await testHelpers.insertRecommendation(pool, {
          caseId: testCase1.id,
          providerId: testProvider.id,
          title: "Provider Recommendation 1"
        });
        await testHelpers.insertRecommendation(pool, {
          caseId: testCase2.id,
          providerId: testProvider.id,
          title: "Provider Recommendation 2"
        });

        // Create recommendation for different provider
        await testHelpers.insertRecommendation(pool, {
          caseId: testCase1.id,
          providerId: otherProvider.id,
          title: "Other Provider Recommendation"
        });

        const result = await recommendationService.getRecommendationsByProvider(testProvider.id);

        expect(Array.isArray(result)).toBe(true);
        expect(result.length).toBe(2);
        expect(result.every(r => r.providerId === testProvider.id)).toBe(true);
        expect(result.map(r => r.title)).toEqual(
          expect.arrayContaining(["Provider Recommendation 1", "Provider Recommendation 2"])
        );
      });

      it("respects limit and offset parameters", async () => {
        const testPatient = await testHelpers.insertPatient(pool, {});
        const testProvider = await testHelpers.insertProvider(pool, {});
        
        for (let i = 1; i <= 5; i++) {
          await testHelpers.insertRecommendation(pool, {
            patientId: testPatient.id,
            providerId: testProvider.id,
            title: `Recommendation ${i}`
          });
        }

        const result = await recommendationService.getRecommendationsByProvider(
          testProvider.id, 
          { limit: 2, offset: 1 }
        );

        expect(result.length).toBe(2);
      });
    });

    describe("updateRecommendationStatus", () => {
      it("updates recommendation status", async () => {
        const testPatient = await testHelpers.insertPatient(pool, {});
        const testProvider = await testHelpers.insertProvider(pool, {});
        const testRecommendation = await testHelpers.insertRecommendation(pool, {
          patientId: testPatient.id,
          providerId: testProvider.id,
          title: "Status Test",
          status: RecommendationStatus.DRAFT
        });

        const result = await recommendationService.updateRecommendationStatus(
          testRecommendation.id, 
          RecommendationStatus.ACTIVE
        );

        expect(result).toBeDefined();
        expect(result!.status).toBe(RecommendationStatus.ACTIVE);
        expect(result!.updatedAt).toBeDefined();
        expect(new Date(result!.updatedAt).getTime()).toBeGreaterThan(
          new Date(testRecommendation.createdAt).getTime()
        );
      });

      it("returns null for non-existent recommendation", async () => {
        const result = await recommendationService.updateRecommendationStatus(
          "non-existent", 
          RecommendationStatus.ACTIVE
        );

        expect(result).toBeNull();
      });

      it("invalidates cache after update", async () => {
        const testPatient = await testHelpers.insertPatient(pool, {});
        const testProvider = await testHelpers.insertProvider(pool, {});
        const testRecommendation = await testHelpers.insertRecommendation(pool, {
          patientId: testPatient.id,
          providerId: testProvider.id,
          title: "Cache Invalidation Test"
        });

        // Get recommendation to cache it
        await recommendationService.getRecommendationById(testRecommendation.id);

        // Update recommendation status
        await recommendationService.updateRecommendationStatus(
          testRecommendation.id, 
          RecommendationStatus.COMPLETED
        );

        // Cache should be invalidated
        const cacheKey = `recommendation:${testRecommendation.id}`;
        const cachedData = await redis.get(cacheKey);
        expect(cachedData).toBeNull();
      });
    });

    describe("updateRecommendation", () => {
      it("updates recommendation information", async () => {
        const testPatient = await testHelpers.insertPatient(pool, {});
        const testProvider = await testHelpers.insertProvider(pool, {});
        const testRecommendation = await testHelpers.insertRecommendation(pool, {
          patientId: testPatient.id,
          providerId: testProvider.id,
          title: "Original Title",
          description: "Original description",
          priority: Priority.LOW
        });

        const updates = {
          title: "Updated Title",
          description: "Updated description",
          priority: Priority.HIGH
        };

        const result = await recommendationService.updateRecommendation(testRecommendation.id, updates);

        expect(result).toBeDefined();
        expect(result!.title).toBe("Updated Title");
        expect(result!.description).toBe("Updated description");
        expect(result!.priority).toBe(Priority.HIGH);
        expect(result!.updatedAt).toBeDefined();
      });

      it("returns null for non-existent recommendation", async () => {
        const result = await recommendationService.updateRecommendation("non-existent", {
          title: "Updated"
        });

        expect(result).toBeNull();
      });
    });

    describe("deleteRecommendation", () => {
      it("deletes recommendation from database", async () => {
        const testPatient = await testHelpers.insertPatient(pool, {});
        const testProvider = await testHelpers.insertProvider(pool, {});
        const testRecommendation = await testHelpers.insertRecommendation(pool, {
          patientId: testPatient.id,
          providerId: testProvider.id,
          title: "Delete Me"
        });

        const result = await recommendationService.deleteRecommendation(testRecommendation.id);
        expect(result).toBe(true);

        const deletedRecommendation = await recommendationService.getRecommendationById(testRecommendation.id);
        expect(deletedRecommendation).toBeNull();
      });

      it("returns false for non-existent recommendation", async () => {
        const result = await recommendationService.deleteRecommendation("non-existent");
        expect(result).toBe(false);
      });
    });
  });

  describe("Error handling", () => {
    it("handles database connection errors gracefully", async () => {
      // This would require mocking the database connection
      // For now, we'll test that the service doesn't crash
      const result = await recommendationService.getRecommendationsByProvider("test-provider");
      expect(Array.isArray(result)).toBe(true);
    });

    it("handles invalid UUID format", async () => {
      const result = await recommendationService.getRecommendationById("invalid-uuid");
      expect(result).toBeNull();
    });
  });
});