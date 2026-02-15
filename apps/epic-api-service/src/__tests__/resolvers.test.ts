/**
 * Tests for the exported resolvers and helpers from index.ts.
 *
 * Mocks all external dependencies (FHIR client, extraction client, cache,
 * database) so we can exercise the actual resolver functions in isolation.
 *
 * Server startup code lives in server.ts, so no Apollo/PG/Redis mocks needed.
 */

// ---------------------------------------------------------------------------
// Mocks — must be declared before any imports that trigger module loading
// ---------------------------------------------------------------------------

jest.mock("../clients/logger", () => ({
  createLogger: () => ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  }),
}));

const mockGetPatient = jest.fn();
const mockGetObservations = jest.fn();
const mockGetLabObservations = jest.fn();
const mockGetMedicationRequests = jest.fn();
const mockGetConditions = jest.fn();
const mockGetMedication = jest.fn();
const mockHealthCheck = jest.fn();
const mockSearchPatients = jest.fn();

jest.mock("../clients", () => ({
  getFhirClient: () => ({
    getPatient: mockGetPatient,
    getObservations: mockGetObservations,
    getLabObservations: mockGetLabObservations,
    getMedicationRequests: mockGetMedicationRequests,
    getConditions: mockGetConditions,
    getMedication: mockGetMedication,
    healthCheck: mockHealthCheck,
    searchPatients: mockSearchPatients,
  }),
  getExtractionClient: () => ({
    extractVitalsWithFallback: jest.fn().mockResolvedValue({
      result: { vitals: [], warnings: [], observationsProcessed: 0, observationsSkipped: 0 },
      fromService: false,
    }),
  }),
  // Re-export types used by index.ts
  EpicFhirClient: jest.fn(),
  FHIRMedication: {},
  FHIRMedicationRequest: {},
  FHIRObservation: {},
  generateRequestId: () => "test-request-id",
}));

jest.mock("../clients/http-utils", () => ({
  generateRequestId: () => "test-request-id",
  ResilientHttpClient: jest.fn(),
  HttpError: class extends Error {},
  CircuitOpenError: class extends Error {},
  PayloadTooLargeError: class extends Error {},
}));

const mockGetCached = jest.fn().mockResolvedValue(null);
const mockSetCached = jest.fn().mockResolvedValue(undefined);
const mockGetCachedMedicationRef = jest.fn().mockResolvedValue(null);
const mockSetCachedMedicationRef = jest.fn().mockResolvedValue(undefined);
const mockInvalidatePatientCache = jest.fn().mockResolvedValue(undefined);

jest.mock("../services/cache", () => ({
  getCached: (...args: unknown[]) => mockGetCached(...args),
  setCached: (...args: unknown[]) => mockSetCached(...args),
  getCachedMedicationRef: (...args: unknown[]) => mockGetCachedMedicationRef(...args),
  setCachedMedicationRef: (...args: unknown[]) => mockSetCachedMedicationRef(...args),
  invalidatePatientCache: (...args: unknown[]) => mockInvalidatePatientCache(...args),
  initializeCache: jest.fn(),
  CACHE_TTL: { PATIENT: 600, VITALS: 300, LABS: 300, MEDICATIONS: 600, CONDITIONS: 600, MEDICATION_REF: 3600 },
}));

const mockCreateSnapshot = jest.fn();
const mockGetLatestSnapshot = jest.fn();
const mockGetSnapshotHistory = jest.fn();
const mockGetSnapshot = jest.fn();

jest.mock("../services/database", () => ({
  createSnapshot: (...args: unknown[]) => mockCreateSnapshot(...args),
  getLatestSnapshot: (...args: unknown[]) => mockGetLatestSnapshot(...args),
  getSnapshotHistory: (...args: unknown[]) => mockGetSnapshotHistory(...args),
  getSnapshot: (...args: unknown[]) => mockGetSnapshot(...args),
  initializeDatabase: jest.fn(),
}));

// ---------------------------------------------------------------------------
// Imports — after all mocks
// ---------------------------------------------------------------------------

import { resolvers, extractErrorMessage, extractErrorCode, validateResourceId } from "../index";
import { AxiosError, type InternalAxiosRequestConfig } from "axios";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("epicPatientData resolver", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetCached.mockResolvedValue(null);
  });

  it("returns cached data when all resources are cached", async () => {
    const cachedDemo = { firstName: "Cached", lastName: "Patient" };
    const cachedVitals = [{ type: "HR", value: 72 }];
    const cachedLabs = [{ id: "lab-1" }];
    const cachedMeds = [{ name: "Aspirin" }];
    const cachedDx = [{ code: "123" }];

    mockGetCached
      .mockResolvedValueOnce(cachedDemo)    // patient
      .mockResolvedValueOnce(cachedVitals)  // vitals
      .mockResolvedValueOnce(cachedLabs)    // labs
      .mockResolvedValueOnce(cachedMeds)    // medications
      .mockResolvedValueOnce(cachedDx);     // conditions

    const result = await resolvers.Query.epicPatientData(
      {},
      { epicPatientId: "epic-123" }
    );

    expect(result.demographics).toEqual(cachedDemo);
    expect(result.vitals).toEqual(cachedVitals);
    expect(result.labs).toEqual(cachedLabs);
    expect(result.medications).toEqual(cachedMeds);
    expect(result.diagnoses).toEqual(cachedDx);
    expect(result.errors).toEqual([]);

    // No FHIR calls should have been made
    expect(mockGetPatient).not.toHaveBeenCalled();
    expect(mockGetObservations).not.toHaveBeenCalled();
  });

  it("fetches from FHIR and caches on cache miss", async () => {
    // All cache misses
    mockGetCached.mockResolvedValue(null);

    mockGetPatient.mockResolvedValue({
      data: { name: [{ given: ["Jane"], family: "Doe" }], gender: "female", birthDate: "1990-01-01" },
    });
    mockGetObservations.mockResolvedValue({ data: { entry: [] } });
    mockGetLabObservations.mockResolvedValue({ data: { entry: [] } });
    mockGetMedicationRequests.mockResolvedValue({ data: { entry: [] } });
    mockGetConditions.mockResolvedValue({ data: { entry: [] } });

    const result = await resolvers.Query.epicPatientData(
      {},
      { epicPatientId: "epic-456" }
    );

    expect(result.demographics?.firstName).toBe("Jane");
    expect(result.demographics?.lastName).toBe("Doe");
    expect(result.vitals).toEqual([]);
    expect(result.errors).toEqual([]);

    // Should have cached the transformed data
    expect(mockSetCached).toHaveBeenCalledWith("patient", "epic-456", expect.any(Object));
    expect(mockSetCached).toHaveBeenCalledWith("vitals", "epic-456", expect.any(Array));
  });

  it("captures errors per data type when FHIR calls fail", async () => {
    mockGetCached.mockResolvedValue(null);

    mockGetPatient.mockRejectedValue(new Error("Patient API down"));
    mockGetObservations.mockResolvedValue({ data: { entry: [] } });
    mockGetLabObservations.mockRejectedValue(new Error("Labs timeout"));
    mockGetMedicationRequests.mockResolvedValue({ data: { entry: [] } });
    mockGetConditions.mockResolvedValue({ data: { entry: [] } });

    const result = await resolvers.Query.epicPatientData(
      {},
      { epicPatientId: "epic-err" }
    );

    expect(result.demographics).toBeNull();
    expect(result.errors).toHaveLength(2);
    expect(result.errors.map((e: { dataType: string }) => e.dataType).sort()).toEqual(
      ["DEMOGRAPHICS", "LABS"]
    );
  });

  it("resolves medication references from FHIR", async () => {
    mockGetCached.mockResolvedValue(null);

    mockGetPatient.mockResolvedValue({
      data: { name: [{ given: ["Test"], family: "User" }] },
    });
    mockGetObservations.mockResolvedValue({ data: { entry: [] } });
    mockGetLabObservations.mockResolvedValue({ data: { entry: [] } });
    mockGetMedicationRequests.mockResolvedValue({
      data: {
        entry: [
          {
            resource: {
              id: "med-1",
              status: "active",
              intent: "order",
              medicationReference: { reference: "Medication/abc" },
            },
          },
        ],
      },
    });
    mockGetMedication.mockResolvedValue({
      data: { code: { coding: [{ display: "Resolved Med" }], text: "Resolved Med" } },
    });
    mockGetConditions.mockResolvedValue({ data: { entry: [] } });

    const result = await resolvers.Query.epicPatientData(
      {},
      { epicPatientId: "epic-med" }
    );

    expect(result.medications).toHaveLength(1);
    expect(result.medications[0].name).toBe("Resolved Med");
    expect(mockSetCachedMedicationRef).toHaveBeenCalledWith("Medication/abc", expect.any(Object));
  });
});

describe("latestSnapshot resolver", () => {
  it("delegates to getLatestSnapshot", async () => {
    const mockSnapshot = { id: "snap-1", epicPatientId: "epic-123" };
    mockGetLatestSnapshot.mockResolvedValue(mockSnapshot);

    const result = await resolvers.Query.latestSnapshot(
      {},
      { epicPatientId: "epic-123" }
    );

    expect(result).toEqual(mockSnapshot);
    expect(mockGetLatestSnapshot).toHaveBeenCalledWith("epic-123");
  });
});

describe("snapshotHistory resolver", () => {
  it("delegates to getSnapshotHistory with default limit", async () => {
    mockGetSnapshotHistory.mockResolvedValue([]);

    await resolvers.Query.snapshotHistory(
      {},
      { epicPatientId: "epic-123" }
    );

    expect(mockGetSnapshotHistory).toHaveBeenCalledWith("epic-123", 20);
  });

  it("passes custom limit", async () => {
    mockGetSnapshotHistory.mockResolvedValue([]);

    await resolvers.Query.snapshotHistory(
      {},
      { epicPatientId: "epic-123", limit: 5 }
    );

    expect(mockGetSnapshotHistory).toHaveBeenCalledWith("epic-123", 5);
  });
});

describe("createClinicalSnapshot resolver", () => {
  it("fetches all data, creates snapshot, and invalidates cache", async () => {
    mockGetPatient.mockResolvedValue({
      data: { name: [{ given: ["Snap"], family: "Patient" }] },
    });
    mockGetObservations.mockResolvedValue({ data: { entry: [] } });
    mockGetLabObservations.mockResolvedValue({ data: { entry: [] } });
    mockGetMedicationRequests.mockResolvedValue({ data: { entry: [] } });
    mockGetConditions.mockResolvedValue({ data: { entry: [] } });

    mockCreateSnapshot.mockResolvedValue({
      id: "snap-uuid",
      epicPatientId: "epic-snap",
      snapshotVersion: 1,
      triggerEvent: "VISIT",
      createdAt: "2024-01-15",
    });

    const result = await resolvers.Mutation.createClinicalSnapshot(
      {},
      { epicPatientId: "epic-snap", trigger: "VISIT" }
    );

    expect(result.isNew).toBe(true);
    expect(result.snapshot.id).toBe("snap-uuid");
    expect(mockCreateSnapshot).toHaveBeenCalledWith(
      "epic-snap",
      "VISIT",
      expect.objectContaining({
        demographics: expect.any(Object),
        vitals: expect.any(Array),
        labs: expect.any(Array),
        medications: expect.any(Array),
        diagnoses: expect.any(Array),
      })
    );
    // Verify cache was updated with fresh data
    expect(mockSetCached).toHaveBeenCalledWith("patient", "epic-snap", expect.any(Object));
  });
});

describe("extractErrorMessage", () => {
  it("extracts HTTP status from AxiosError with response", () => {
    const error = new AxiosError("fail", "ERR_BAD_REQUEST", undefined, undefined, {
      status: 404,
      statusText: "Not Found",
      data: {},
      headers: {},
      config: {} as InternalAxiosRequestConfig,
    });

    expect(extractErrorMessage(error)).toBe("HTTP 404: Not Found");
  });

  it("handles ECONNREFUSED", () => {
    const error = new AxiosError("fail");
    error.code = "ECONNREFUSED";

    expect(extractErrorMessage(error)).toBe("Connection refused - service may be down");
  });

  it("handles ETIMEDOUT", () => {
    const error = new AxiosError("fail");
    error.code = "ETIMEDOUT";

    expect(extractErrorMessage(error)).toBe("Request timed out");
  });

  it("handles generic AxiosError", () => {
    const error = new AxiosError("Network Error");
    expect(extractErrorMessage(error)).toBe("Network Error");
  });

  it("handles generic Error", () => {
    expect(extractErrorMessage(new Error("Something broke"))).toBe("Something broke");
  });

  it("handles unknown error types", () => {
    expect(extractErrorMessage("string error")).toBe("Unknown error");
    expect(extractErrorMessage(42)).toBe("Unknown error");
  });
});

describe("extractErrorCode", () => {
  it("extracts HTTP status code from AxiosError", () => {
    const error = new AxiosError("fail", "ERR_BAD_REQUEST", undefined, undefined, {
      status: 500,
      statusText: "Internal Server Error",
      data: {},
      headers: {},
      config: {} as InternalAxiosRequestConfig,
    });

    expect(extractErrorCode(error)).toBe("HTTP_500");
  });

  it("extracts error code from AxiosError without response", () => {
    const error = new AxiosError("fail");
    error.code = "ECONNREFUSED";

    expect(extractErrorCode(error)).toBe("ECONNREFUSED");
  });

  it("returns undefined for non-Axios errors", () => {
    expect(extractErrorCode(new Error("fail"))).toBeUndefined();
    expect(extractErrorCode("string")).toBeUndefined();
  });
});

describe("validateResourceId", () => {
  it("accepts valid FHIR resource IDs", () => {
    expect(() => validateResourceId("erXuFYUfucBZaryVksYEcMg3", "id")).not.toThrow();
    expect(() => validateResourceId("abc-123.def", "id")).not.toThrow();
    expect(() => validateResourceId("snap_uuid_1", "id")).not.toThrow();
  });

  it("rejects empty strings", () => {
    expect(() => validateResourceId("", "epicPatientId")).toThrow("epicPatientId is required");
  });

  it("rejects whitespace-only strings", () => {
    expect(() => validateResourceId("   ", "epicPatientId")).toThrow("epicPatientId is required");
  });

  it("rejects IDs exceeding max length", () => {
    const longId = "a".repeat(129);
    expect(() => validateResourceId(longId, "epicPatientId")).toThrow("exceeds maximum length");
  });

  it("rejects IDs with invalid characters", () => {
    expect(() => validateResourceId("id with spaces", "epicPatientId")).toThrow("contains invalid characters");
    expect(() => validateResourceId("id;DROP TABLE", "epicPatientId")).toThrow("contains invalid characters");
    expect(() => validateResourceId("id<script>", "epicPatientId")).toThrow("contains invalid characters");
    expect(() => validateResourceId("../etc/passwd", "epicPatientId")).toThrow("contains invalid characters");
  });

  it("rejects IDs used in resolver calls", async () => {
    await expect(
      resolvers.Query.epicPatientData({}, { epicPatientId: "" })
    ).rejects.toThrow("epicPatientId is required");

    await expect(
      resolvers.Query.epicPatientData({}, { epicPatientId: "id<script>" })
    ).rejects.toThrow("contains invalid characters");
  });
});

describe("searchEpicPatients resolver", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("transforms FHIR bundle to simplified search results", async () => {
    mockSearchPatients.mockResolvedValue({
      data: {
        entry: [
          {
            resource: {
              resourceType: "Patient",
              id: "patient-1",
              name: [{ use: "official", given: ["Sarah", "Marie"], family: "Johnson" }],
              gender: "female",
              birthDate: "1985-03-15",
              identifier: [
                { type: { coding: [{ code: "MR" }] }, value: "MRN-001" },
              ],
            },
          },
          {
            resource: {
              resourceType: "Patient",
              id: "patient-2",
              name: [{ use: "official", given: ["James"], family: "Wilson" }],
              gender: "male",
              birthDate: "1972-08-20",
              identifier: [
                { type: { coding: [{ code: "MR" }] }, value: "MRN-002" },
              ],
            },
          },
        ],
      },
    });

    const result = await resolvers.Query.searchEpicPatients(
      {},
      { input: { name: "test" } }
    );

    expect(result.results).toHaveLength(2);
    expect(result.results[0]).toEqual({
      epicPatientId: "patient-1",
      firstName: "Sarah",
      lastName: "Johnson",
      dateOfBirth: "1985-03-15",
      gender: "female",
      mrn: "MRN-001",
    });
    expect(result.results[1].epicPatientId).toBe("patient-2");
    expect(result.totalCount).toBe(2);
  });

  it("returns empty results when no patients match", async () => {
    mockSearchPatients.mockResolvedValue({
      data: {},
    });

    const result = await resolvers.Query.searchEpicPatients(
      {},
      { input: { name: "NoMatch" } }
    );

    expect(result.results).toEqual([]);
    expect(result.totalCount).toBe(0);
  });

  it("handles patients with missing optional fields", async () => {
    mockSearchPatients.mockResolvedValue({
      data: {
        entry: [
          {
            resource: {
              resourceType: "Patient",
              id: "patient-3",
              name: [{ family: "Minimal" }],
            },
          },
        ],
      },
    });

    const result = await resolvers.Query.searchEpicPatients(
      {},
      { input: { family: "Minimal" } }
    );

    expect(result.results).toHaveLength(1);
    expect(result.results[0]).toEqual({
      epicPatientId: "patient-3",
      firstName: null,
      lastName: "Minimal",
      dateOfBirth: null,
      gender: null,
      mrn: null,
    });
  });

  it("passes search params to FHIR client", async () => {
    mockSearchPatients.mockResolvedValue({ data: {} });

    await resolvers.Query.searchEpicPatients(
      {},
      { input: { family: "Smith", birthdate: "1990-01-01", gender: "female", _count: 10 } }
    );

    expect(mockSearchPatients).toHaveBeenCalledWith(
      { family: "Smith", birthdate: "1990-01-01", gender: "female", _count: 10 },
      "test-request-id"
    );
  });
});
