/**
 * Tests for services/database.ts
 *
 * Mocks pg Pool to test snapshot CRUD operations without a real database.
 */

const mockQuery = jest.fn();
const mockRelease = jest.fn();
const mockConnect = jest.fn();

jest.mock("pg", () => ({
  Pool: jest.fn().mockImplementation(() => ({
    query: mockQuery,
    connect: mockConnect,
  })),
}));

jest.mock("../clients/logger", () => ({
  createLogger: () => ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  }),
}));

import { Pool } from "pg";
import {
  initializeDatabase,
  createSnapshot,
  getLatestSnapshot,
  getSnapshot,
  getSnapshotHistory,
  getEpicPatientIdByPatientId,
  getLatestSnapshotClinicalData,
} from "../services/database";
import type { PatientDemographicsOut, VitalOut, LabResultOut, MedicationOut, DiagnosisOut, AllergyOut } from "../services/transforms";

// Helper: create a mock PoolClient
function setupMockClient() {
  const clientQuery = jest.fn();
  const client = {
    query: clientQuery,
    release: mockRelease,
  };
  mockConnect.mockResolvedValue(client);
  return { client, clientQuery };
}

// Minimal test data
const mockDemographics: PatientDemographicsOut = {
  firstName: "Jane",
  lastName: "Doe",
  gender: "female",
  dateOfBirth: "1990-01-01",
  mrn: "MRN123",
  active: true,
  deceasedBoolean: null,
  deceasedDateTime: null,
  maritalStatus: null,
  raceEthnicity: null,
  identifiers: [],
  names: [],
  telecom: [],
  addresses: [],
  emergencyContacts: [],
  communications: [],
  generalPractitioner: [],
};

const mockVital: VitalOut = {
  type: "Heart rate",
  value: 72,
  unit: "beats/min",
  recordedDate: "2024-01-15",
  isNormalized: false,
  code: null,
  status: "final",
  category: "vital-signs",
  interpretation: [],
  referenceRange: [],
  bodySite: null,
  method: null,
  performer: [],
  encounter: null,
  issuedDate: null,
  components: [],
};

const mockLab: LabResultOut = {
  id: "lab-1",
  code: { coding: [{ system: null, code: "2345-7", display: "Glucose" }], text: "Glucose" },
  status: "final",
  category: "laboratory",
  effectiveDateTime: "2024-01-15",
  issuedDate: null,
  valueQuantity: 95,
  valueUnit: "mg/dL",
  valueString: null,
  valueCodeableConcept: null,
  interpretation: [],
  referenceRange: [],
  performer: [],
  encounter: null,
  specimen: null,
  bodySite: null,
  hasMember: [],
  components: [],
  notes: [],
};

const mockMedication: MedicationOut = {
  name: "Lisinopril",
  status: "active",
  dosage: "10mg daily",
  id: "med-1",
  medicationCode: null,
  medicationReference: null,
  intent: "order",
  category: [],
  priority: null,
  authoredOn: "2024-01-01",
  requester: null,
  encounter: null,
  reasonCode: [],
  reasonReference: [],
  dosageInstructions: [],
  dispenseRequest: null,
  substitution: null,
  courseOfTherapyType: null,
  notes: [],
};

const mockDiagnosis: DiagnosisOut = {
  code: "38341003",
  display: "Hypertension",
  recordedDate: "2024-01-01",
  id: "cond-1",
  clinicalStatus: null,
  verificationStatus: null,
  category: [],
  severity: null,
  codeDetail: null,
  bodySite: [],
  encounter: null,
  onsetDateTime: null,
  onsetAge: null,
  onsetString: null,
  abatementDateTime: null,
  abatementAge: null,
  abatementString: null,
  recorder: null,
  asserter: null,
  stage: [],
  evidence: [],
  notes: [],
};

describe("database service", () => {
  const pool = new Pool();

  beforeAll(() => {
    initializeDatabase(pool);
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ===========================================================================
  // createSnapshot
  // ===========================================================================

  describe("createSnapshot", () => {
    it("creates a snapshot with all child data in a transaction", async () => {
      const { clientQuery } = setupMockClient();

      // BEGIN
      clientQuery.mockResolvedValueOnce({});
      // lock query (SELECT 1 ... FOR UPDATE)
      clientQuery.mockResolvedValueOnce({ rows: [] });
      // version query
      clientQuery.mockResolvedValueOnce({ rows: [{ next_version: 1 }] });
      // snapshot insert
      clientQuery.mockResolvedValueOnce({
        rows: [{ id: "snap-uuid-1", created_at: "2024-01-15T10:00:00Z" }],
      });
      // demographics insert
      clientQuery.mockResolvedValueOnce({});
      // vital insert
      clientQuery.mockResolvedValueOnce({});
      // lab insert
      clientQuery.mockResolvedValueOnce({});
      // medication insert
      clientQuery.mockResolvedValueOnce({});
      // condition insert
      clientQuery.mockResolvedValueOnce({});
      // allergy insert
      clientQuery.mockResolvedValueOnce({});
      // COMMIT
      clientQuery.mockResolvedValueOnce({});

      const mockAllergy: AllergyOut = {
        id: "allergy-1",
        code: { coding: [{ system: null, code: "12345", display: "Penicillin" }], text: "Penicillin" },
        clinicalStatus: null,
        verificationStatus: null,
        type: "allergy",
        categories: ["medication"],
        criticality: "high",
        onsetDateTime: null,
        onsetAge: null,
        onsetString: null,
        recordedDate: "2024-01-01",
        lastOccurrence: null,
        recorder: null,
        asserter: null,
        encounter: null,
        reactions: [],
        notes: [],
      };

      const result = await createSnapshot("epic-123", "VISIT", {
        demographics: mockDemographics,
        vitals: [mockVital],
        labs: [mockLab],
        medications: [mockMedication],
        diagnoses: [mockDiagnosis],
        allergies: [mockAllergy],
      });

      expect(result.id).toBe("snap-uuid-1");
      expect(result.epicPatientId).toBe("epic-123");
      expect(result.snapshotVersion).toBe(1);
      expect(result.triggerEvent).toBe("VISIT");
      expect(result.createdAt).toBe("2024-01-15T10:00:00Z");
      expect(result.demographics).toEqual(mockDemographics);
      expect(result.vitals).toHaveLength(1);
      expect(result.labs).toHaveLength(1);
      expect(result.medications).toHaveLength(1);
      expect(result.diagnoses).toHaveLength(1);
      expect(result.allergies).toHaveLength(1);

      // Verify transaction
      expect(clientQuery.mock.calls[0][0]).toBe("BEGIN");
      expect(clientQuery.mock.calls[clientQuery.mock.calls.length - 1][0]).toBe("COMMIT");
      expect(mockRelease).toHaveBeenCalled();
    });

    it("increments version for existing patient", async () => {
      const { clientQuery } = setupMockClient();

      clientQuery.mockResolvedValueOnce({}); // BEGIN
      clientQuery.mockResolvedValueOnce({ rows: [] }); // lock query
      clientQuery.mockResolvedValueOnce({ rows: [{ next_version: 5 }] }); // version
      clientQuery.mockResolvedValueOnce({
        rows: [{ id: "snap-uuid-5", created_at: "2024-02-01" }],
      });
      clientQuery.mockResolvedValueOnce({}); // COMMIT

      const result = await createSnapshot("epic-123", "SCHEDULED", {
        demographics: null,
        vitals: [],
        labs: [],
        medications: [],
        diagnoses: [],
        allergies: [],
      });

      expect(result.snapshotVersion).toBe(5);
    });

    it("rolls back on error and re-throws", async () => {
      const { clientQuery } = setupMockClient();

      clientQuery.mockResolvedValueOnce({}); // BEGIN
      clientQuery.mockRejectedValueOnce(new Error("DB error")); // lock query fails

      await expect(
        createSnapshot("epic-123", "VISIT", {
          demographics: null,
          vitals: [],
          labs: [],
          medications: [],
          diagnoses: [],
          allergies: [],
        })
      ).rejects.toThrow("DB error");

      // Verify ROLLBACK was called
      const rollbackCall = clientQuery.mock.calls.find(
        (call) => call[0] === "ROLLBACK"
      );
      expect(rollbackCall).toBeDefined();
      expect(mockRelease).toHaveBeenCalled();
    });

    it("skips demographics insert when demographics is null", async () => {
      const { clientQuery } = setupMockClient();

      clientQuery.mockResolvedValueOnce({}); // BEGIN
      clientQuery.mockResolvedValueOnce({ rows: [] }); // lock query
      clientQuery.mockResolvedValueOnce({ rows: [{ next_version: 1 }] }); // version
      clientQuery.mockResolvedValueOnce({
        rows: [{ id: "snap-uuid", created_at: "2024-01-15" }],
      }); // snapshot insert
      clientQuery.mockResolvedValueOnce({}); // COMMIT

      await createSnapshot("epic-123", "VISIT", {
        demographics: null,
        vitals: [],
        labs: [],
        medications: [],
        diagnoses: [],
        allergies: [],
      });

      // Should only have BEGIN, lock, version, snapshot INSERT, COMMIT (5 calls)
      expect(clientQuery).toHaveBeenCalledTimes(5);
    });
  });

  // ===========================================================================
  // getLatestSnapshot
  // ===========================================================================

  describe("getLatestSnapshot", () => {
    it("returns null when no snapshots exist", async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const result = await getLatestSnapshot("epic-999");

      expect(result).toBeNull();
      expect(mockQuery).toHaveBeenCalledTimes(1);
    });

    it("returns the latest snapshot with all child data", async () => {
      // Main snapshot query
      mockQuery.mockResolvedValueOnce({
        rows: [{
          id: "snap-1",
          epic_patient_id: "epic-123",
          snapshot_version: 3,
          trigger_event: "VISIT",
          created_at: "2024-01-15",
        }],
      });

      // Child table queries (demographics, vitals, labs, meds, conditions, allergies)
      mockQuery
        .mockResolvedValueOnce({ rows: [{ first_name: "Jane", last_name: "Doe", gender: "female", date_of_birth: "1990-01-01", mrn: "MRN123", active: true, deceased_boolean: null, deceased_date_time: null, marital_status: null, race_ethnicity: null, identifiers: [], names: [], telecom: [], addresses: [], emergency_contacts: [], communications: [], general_practitioner: [] }] })
        .mockResolvedValueOnce({ rows: [] }) // vitals
        .mockResolvedValueOnce({ rows: [] }) // labs
        .mockResolvedValueOnce({ rows: [] }) // meds
        .mockResolvedValueOnce({ rows: [] }) // conditions
        .mockResolvedValueOnce({ rows: [] }); // allergies

      const result = await getLatestSnapshot("epic-123");

      expect(result).not.toBeNull();
      expect(result!.id).toBe("snap-1");
      expect(result!.snapshotVersion).toBe(3);
      expect(result!.demographics?.firstName).toBe("Jane");
    });
  });

  // ===========================================================================
  // getSnapshot (by ID)
  // ===========================================================================

  describe("getSnapshot", () => {
    it("returns null when snapshot does not exist", async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const result = await getSnapshot("nonexistent-uuid");

      expect(result).toBeNull();
    });

    it("queries by snapshot ID", async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{
          id: "snap-abc",
          epic_patient_id: "epic-456",
          snapshot_version: 1,
          trigger_event: "MANUAL_REFRESH",
          created_at: "2024-02-01",
        }],
      });

      // Child queries (demographics, vitals, labs, meds, conditions, allergies)
      mockQuery
        .mockResolvedValueOnce({ rows: [] }) // demographics
        .mockResolvedValueOnce({ rows: [] }) // vitals
        .mockResolvedValueOnce({ rows: [] }) // labs
        .mockResolvedValueOnce({ rows: [] }) // meds
        .mockResolvedValueOnce({ rows: [] }) // conditions
        .mockResolvedValueOnce({ rows: [] }); // allergies

      const result = await getSnapshot("snap-abc");

      expect(result).not.toBeNull();
      expect(result!.id).toBe("snap-abc");
      expect(result!.triggerEvent).toBe("MANUAL_REFRESH");
    });
  });

  // ===========================================================================
  // getSnapshotHistory
  // ===========================================================================

  describe("getSnapshotHistory", () => {
    it("returns summary list with counts", async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            id: "snap-1",
            epic_patient_id: "epic-123",
            snapshot_version: 2,
            trigger_event: "VISIT",
            created_at: "2024-02-01",
            vital_count: 5,
            lab_count: 10,
            medication_count: 3,
            diagnosis_count: 2,
          },
          {
            id: "snap-0",
            epic_patient_id: "epic-123",
            snapshot_version: 1,
            trigger_event: "CARE_PLAN_CREATION",
            created_at: "2024-01-01",
            vital_count: 4,
            lab_count: 8,
            medication_count: 3,
            diagnosis_count: 1,
          },
        ],
      });

      const result = await getSnapshotHistory("epic-123", 10);

      expect(result).toHaveLength(2);
      expect(result[0].snapshotVersion).toBe(2);
      expect(result[0].vitalCount).toBe(5);
      expect(result[0].labCount).toBe(10);
      expect(result[1].snapshotVersion).toBe(1);
      expect(result[1].triggerEvent).toBe("CARE_PLAN_CREATION");
    });

    it("returns empty array when no history", async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const result = await getSnapshotHistory("epic-999");

      expect(result).toEqual([]);
    });

    it("uses default limit of 20", async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      await getSnapshotHistory("epic-123");

      expect(mockQuery).toHaveBeenCalledWith(
        expect.any(String),
        ["epic-123", 20]
      );
    });
  });

  // ===========================================================================
  // getEpicPatientIdByPatientId
  // ===========================================================================

  describe("getEpicPatientIdByPatientId", () => {
    it("returns epic_patient_id when patient exists", async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ epic_patient_id: "erXuFYUfucBZaryVksYEcMg3" }],
      });

      const result = await getEpicPatientIdByPatientId("patient-uuid-1");

      expect(result).toBe("erXuFYUfucBZaryVksYEcMg3");
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining("FROM patients"),
        ["patient-uuid-1"]
      );
    });

    it("returns null when patient has no epic_patient_id", async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ epic_patient_id: null }],
      });

      const result = await getEpicPatientIdByPatientId("patient-uuid-2");

      expect(result).toBeNull();
    });

    it("returns null when patient does not exist", async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const result = await getEpicPatientIdByPatientId("nonexistent-uuid");

      expect(result).toBeNull();
    });
  });

  // ===========================================================================
  // getLatestSnapshotClinicalData
  // ===========================================================================

  describe("getLatestSnapshotClinicalData", () => {
    it("returns conditions, medications, and allergies from latest snapshot", async () => {
      // Snapshot lookup
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: "snap-1" }],
      });

      // Parallel queries: conditions, medications, allergies
      mockQuery
        .mockResolvedValueOnce({
          rows: [{
            condition_id: "cond-1",
            code: "38341003",
            display: "Hypertension",
            code_detail: null,
            clinical_status: null,
            verification_status: null,
            category: [],
            severity: null,
            body_site: [],
            encounter: null,
            onset_date_time: null,
            onset_age: null,
            onset_string: null,
            abatement_date_time: null,
            abatement_age: null,
            abatement_string: null,
            recorded_date: "2024-01-01",
            recorder: null,
            asserter: null,
            stage: [],
            evidence: [],
            notes: [],
          }],
        })
        .mockResolvedValueOnce({
          rows: [{
            medication_request_id: "med-1",
            name: "Lisinopril",
            status: "active",
            intent: "order",
            category: [],
            priority: null,
            medication_code: null,
            medication_reference: null,
            authored_on: "2024-01-01",
            requester: null,
            encounter: null,
            reason_code: [],
            reason_reference: [],
            dosage_instructions: [],
            dispense_request: null,
            substitution: null,
            course_of_therapy_type: null,
            notes: [],
          }],
        })
        .mockResolvedValueOnce({
          rows: [{
            allergy_intolerance_id: "allergy-1",
            code: { coding: [{ system: null, code: "12345", display: "Penicillin" }], text: "Penicillin" },
            clinical_status: null,
            verification_status: null,
            type: "allergy",
            categories: ["medication"],
            criticality: "high",
            onset_date_time: null,
            onset_age: null,
            onset_string: null,
            recorded_date: "2024-01-01",
            last_occurrence: null,
            recorder: null,
            asserter: null,
            encounter: null,
            reactions: [],
            notes: [],
          }],
        });

      const result = await getLatestSnapshotClinicalData("epic-123");

      expect(result).not.toBeNull();
      expect(result!.diagnoses).toHaveLength(1);
      expect(result!.diagnoses[0].code).toBe("38341003");
      expect(result!.diagnoses[0].display).toBe("Hypertension");
      expect(result!.medications).toHaveLength(1);
      expect(result!.medications[0].name).toBe("Lisinopril");
      expect(result!.allergies).toHaveLength(1);
      expect(result!.allergies[0].id).toBe("allergy-1");
      expect(result!.allergies[0].criticality).toBe("high");
    });

    it("returns null when no snapshot exists", async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const result = await getLatestSnapshotClinicalData("epic-999");

      expect(result).toBeNull();
      expect(mockQuery).toHaveBeenCalledTimes(1);
    });
  });
});
