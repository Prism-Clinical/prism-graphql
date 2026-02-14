/**
 * Tests for services/cache.ts
 *
 * Mocks ioredis to test cache behavior without a real Redis instance.
 */

const mockGet = jest.fn();
const mockSetex = jest.fn();
const mockDel = jest.fn();

jest.mock("ioredis", () => {
  return {
    Redis: jest.fn().mockImplementation(() => ({
      get: mockGet,
      setex: mockSetex,
      del: mockDel,
    })),
  };
});

jest.mock("../clients/logger", () => ({
  createLogger: () => ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  }),
}));

import { Redis } from "ioredis";
import {
  initializeCache,
  getCached,
  setCached,
  invalidatePatientCache,
  getCachedMedicationRef,
  setCachedMedicationRef,
  CACHE_TTL,
} from "../services/cache";

describe("cache service", () => {
  const mockRedis = new Redis() as jest.Mocked<Redis>;

  beforeAll(() => {
    initializeCache(mockRedis);
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ===========================================================================
  // getCached
  // ===========================================================================

  describe("getCached", () => {
    it("returns parsed data on cache hit", async () => {
      const data = { firstName: "John", lastName: "Doe" };
      mockGet.mockResolvedValue(JSON.stringify(data));

      const result = await getCached<typeof data>("patient", "epic-123");

      expect(result).toEqual(data);
      expect(mockGet).toHaveBeenCalledWith("epic:patient:epic-123");
    });

    it("returns null on cache miss", async () => {
      mockGet.mockResolvedValue(null);

      const result = await getCached("patient", "epic-123");

      expect(result).toBeNull();
    });

    it("returns null and logs warning on error", async () => {
      mockGet.mockRejectedValue(new Error("Connection lost"));

      const result = await getCached("patient", "epic-123");

      expect(result).toBeNull();
    });

    it("uses correct key format for each resource type", async () => {
      mockGet.mockResolvedValue(null);

      await getCached("patient", "abc");
      expect(mockGet).toHaveBeenCalledWith("epic:patient:abc");

      await getCached("vitals", "abc");
      expect(mockGet).toHaveBeenCalledWith("epic:vitals:abc");

      await getCached("labs", "abc");
      expect(mockGet).toHaveBeenCalledWith("epic:labs:abc");

      await getCached("medications", "abc");
      expect(mockGet).toHaveBeenCalledWith("epic:medications:abc");

      await getCached("conditions", "abc");
      expect(mockGet).toHaveBeenCalledWith("epic:conditions:abc");
    });
  });

  // ===========================================================================
  // setCached
  // ===========================================================================

  describe("setCached", () => {
    it("stores data with correct TTL for patient", async () => {
      mockSetex.mockResolvedValue("OK");

      await setCached("patient", "epic-123", { name: "test" });

      expect(mockSetex).toHaveBeenCalledWith(
        "epic:patient:epic-123",
        CACHE_TTL.PATIENT,
        JSON.stringify({ name: "test" })
      );
    });

    it("stores data with correct TTL for vitals", async () => {
      mockSetex.mockResolvedValue("OK");

      await setCached("vitals", "epic-123", []);

      expect(mockSetex).toHaveBeenCalledWith(
        "epic:vitals:epic-123",
        CACHE_TTL.VITALS,
        JSON.stringify([])
      );
    });

    it("stores data with correct TTL for labs", async () => {
      mockSetex.mockResolvedValue("OK");

      await setCached("labs", "epic-123", []);

      expect(mockSetex).toHaveBeenCalledWith(
        "epic:labs:epic-123",
        CACHE_TTL.LABS,
        JSON.stringify([])
      );
    });

    it("stores data with correct TTL for medications", async () => {
      mockSetex.mockResolvedValue("OK");

      await setCached("medications", "epic-123", []);

      expect(mockSetex).toHaveBeenCalledWith(
        "epic:medications:epic-123",
        CACHE_TTL.MEDICATIONS,
        JSON.stringify([])
      );
    });

    it("stores data with correct TTL for conditions", async () => {
      mockSetex.mockResolvedValue("OK");

      await setCached("conditions", "epic-123", []);

      expect(mockSetex).toHaveBeenCalledWith(
        "epic:conditions:epic-123",
        CACHE_TTL.CONDITIONS,
        JSON.stringify([])
      );
    });

    it("does not throw on write error", async () => {
      mockSetex.mockRejectedValue(new Error("Write failed"));

      await expect(setCached("patient", "epic-123", {})).resolves.not.toThrow();
    });
  });

  // ===========================================================================
  // invalidatePatientCache
  // ===========================================================================

  describe("invalidatePatientCache", () => {
    it("deletes all resource keys for a patient", async () => {
      mockDel.mockResolvedValue(5);

      await invalidatePatientCache("epic-123");

      expect(mockDel).toHaveBeenCalledWith(
        "epic:patient:epic-123",
        "epic:vitals:epic-123",
        "epic:labs:epic-123",
        "epic:medications:epic-123",
        "epic:conditions:epic-123"
      );
    });

    it("does not throw on deletion error", async () => {
      mockDel.mockRejectedValue(new Error("Del failed"));

      await expect(invalidatePatientCache("epic-123")).resolves.not.toThrow();
    });
  });

  // ===========================================================================
  // Medication reference cache
  // ===========================================================================

  describe("getCachedMedicationRef", () => {
    it("returns parsed medication data on hit", async () => {
      const med = { resourceType: "Medication", code: { text: "Aspirin" } };
      mockGet.mockResolvedValue(JSON.stringify(med));

      const result = await getCachedMedicationRef("Medication/abc");

      expect(result).toEqual(med);
      expect(mockGet).toHaveBeenCalledWith("epic:medication-ref:Medication/abc");
    });

    it("returns null on miss", async () => {
      mockGet.mockResolvedValue(null);

      const result = await getCachedMedicationRef("Medication/abc");
      expect(result).toBeNull();
    });

    it("returns null on error", async () => {
      mockGet.mockRejectedValue(new Error("fail"));

      const result = await getCachedMedicationRef("Medication/abc");
      expect(result).toBeNull();
    });
  });

  describe("setCachedMedicationRef", () => {
    it("stores medication with MEDICATION_REF TTL", async () => {
      mockSetex.mockResolvedValue("OK");

      await setCachedMedicationRef("Medication/abc", { code: { text: "Test" } });

      expect(mockSetex).toHaveBeenCalledWith(
        "epic:medication-ref:Medication/abc",
        CACHE_TTL.MEDICATION_REF,
        JSON.stringify({ code: { text: "Test" } })
      );
    });

    it("does not throw on write error", async () => {
      mockSetex.mockRejectedValue(new Error("fail"));

      await expect(setCachedMedicationRef("Medication/abc", {})).resolves.not.toThrow();
    });
  });

  // ===========================================================================
  // TTL constants
  // ===========================================================================

  describe("CACHE_TTL constants", () => {
    it("has expected values", () => {
      expect(CACHE_TTL.PATIENT).toBe(600);
      expect(CACHE_TTL.VITALS).toBe(300);
      expect(CACHE_TTL.LABS).toBe(300);
      expect(CACHE_TTL.MEDICATIONS).toBe(600);
      expect(CACHE_TTL.CONDITIONS).toBe(600);
      expect(CACHE_TTL.MEDICATION_REF).toBe(3600);
    });
  });
});
