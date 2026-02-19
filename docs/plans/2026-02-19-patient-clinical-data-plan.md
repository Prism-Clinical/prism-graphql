# Patient Clinical Data via Federation — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Show conditions, medications, and allergies on the patient detail page by extending the Patient type via Apollo Federation in epic-api-service.

**Architecture:** epic-api-service extends the `Patient` entity with `conditions`, `medications`, and `allergies` fields. When the gateway resolves a Patient, it calls epic-api-service's `__resolveReference`, which looks up `epic_patient_id` from the `patients` table, fetches the latest clinical snapshot, and maps snapshot data to simplified frontend-friendly types.

**Tech Stack:** TypeScript, Apollo Federation 2.10, PostgreSQL, Jest

---

### Task 1: Add clinical data mapping functions

**Files:**
- Create: `apps/epic-api-service/src/services/patient-clinical-mappers.ts`
- Test: `apps/epic-api-service/src/__tests__/patient-clinical-mappers.test.ts`

These pure functions convert snapshot DB rows (DiagnosisOut, MedicationOut, AllergyOut) into simplified types the frontend expects (PatientCondition, PatientMedication, PatientAllergy).

**Step 1: Write the test file**

```typescript
// apps/epic-api-service/src/__tests__/patient-clinical-mappers.test.ts

import {
  mapConditions,
  mapMedications,
  mapAllergies,
  type PatientCondition,
  type PatientMedication,
  type PatientAllergy,
} from "../services/patient-clinical-mappers";
import type { DiagnosisOut, MedicationOut, AllergyOut } from "../services/transforms";

describe("patient-clinical-mappers", () => {
  // =========================================================================
  // mapConditions
  // =========================================================================
  describe("mapConditions", () => {
    it("maps a diagnosis with clinical status 'active' to ACTIVE", () => {
      const diagnosis: DiagnosisOut = {
        code: "38341003",
        display: "Hypertension",
        recordedDate: "2024-01-01",
        id: "cond-1",
        clinicalStatus: {
          coding: [{ system: "http://terminology.hl7.org/CodeSystem/condition-clinical", code: "active", display: "Active" }],
          text: "Active",
        },
        verificationStatus: null,
        category: [],
        severity: null,
        codeDetail: {
          coding: [{ system: "http://snomed.info/sct", code: "38341003", display: "Hypertension" }],
          text: "Hypertension",
        },
        bodySite: [],
        encounter: null,
        onsetDateTime: "2023-06-15",
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

      const result = mapConditions([diagnosis]);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual<PatientCondition>({
        id: "cond-1",
        code: "38341003",
        codeSystem: "http://snomed.info/sct",
        name: "Hypertension",
        status: "ACTIVE",
        onsetDate: "2023-06-15",
      });
    });

    it("maps 'resolved' clinical status to RESOLVED", () => {
      const dx: DiagnosisOut = makeDiagnosis({
        clinicalStatus: {
          coding: [{ system: null, code: "resolved", display: "Resolved" }],
          text: "Resolved",
        },
      });
      expect(mapConditions([dx])[0].status).toBe("RESOLVED");
    });

    it("maps unknown/missing clinical status to INACTIVE", () => {
      const dx: DiagnosisOut = makeDiagnosis({ clinicalStatus: null });
      expect(mapConditions([dx])[0].status).toBe("INACTIVE");
    });

    it("generates fallback ID when condition_id is null", () => {
      const dx: DiagnosisOut = makeDiagnosis({ id: null });
      const result = mapConditions([dx]);
      expect(result[0].id).toBeTruthy();
      expect(result[0].id).toContain("condition-");
    });

    it("returns empty array for empty input", () => {
      expect(mapConditions([])).toEqual([]);
    });
  });

  // =========================================================================
  // mapMedications
  // =========================================================================
  describe("mapMedications", () => {
    it("maps medication with dosage instructions joined", () => {
      const med: MedicationOut = makeMedication({
        dosageInstructions: [
          { sequence: 1, text: "Take 1 tablet by mouth", timing: "Once daily", asNeeded: false, asNeededReason: null, route: null, method: null, site: null, doseQuantity: 1, doseUnit: "tablet", doseRangeLow: null, doseRangeHigh: null, rateQuantity: null, rateUnit: null, maxDosePerPeriod: null, maxDosePerAdministration: null, maxDosePerAdministrationUnit: null },
          { sequence: 2, text: "Take with food", timing: "As needed", asNeeded: true, asNeededReason: null, route: null, method: null, site: null, doseQuantity: null, doseUnit: null, doseRangeLow: null, doseRangeHigh: null, rateQuantity: null, rateUnit: null, maxDosePerPeriod: null, maxDosePerAdministration: null, maxDosePerAdministrationUnit: null },
        ],
      });

      const result = mapMedications([med]);

      expect(result[0].dosage).toBe("Take 1 tablet by mouth · Take with food");
      expect(result[0].frequency).toBe("Once daily · As needed");
    });

    it("maps 'active' status to ACTIVE", () => {
      const med = makeMedication({ status: "active" });
      expect(mapMedications([med])[0].status).toBe("ACTIVE");
    });

    it("maps non-active statuses to DISCONTINUED", () => {
      expect(mapMedications([makeMedication({ status: "completed" })])[0].status).toBe("DISCONTINUED");
      expect(mapMedications([makeMedication({ status: "stopped" })])[0].status).toBe("DISCONTINUED");
      expect(mapMedications([makeMedication({ status: "cancelled" })])[0].status).toBe("DISCONTINUED");
    });

    it("handles empty dosage instructions", () => {
      const med = makeMedication({ dosageInstructions: [] });
      const result = mapMedications([med]);
      expect(result[0].dosage).toBeNull();
      expect(result[0].frequency).toBeNull();
    });

    it("filters out null text/timing values when joining", () => {
      const med = makeMedication({
        dosageInstructions: [
          { sequence: 1, text: "Take 1 tablet", timing: null, asNeeded: false, asNeededReason: null, route: null, method: null, site: null, doseQuantity: null, doseUnit: null, doseRangeLow: null, doseRangeHigh: null, rateQuantity: null, rateUnit: null, maxDosePerPeriod: null, maxDosePerAdministration: null, maxDosePerAdministrationUnit: null },
          { sequence: 2, text: null, timing: "Twice daily", asNeeded: false, asNeededReason: null, route: null, method: null, site: null, doseQuantity: null, doseUnit: null, doseRangeLow: null, doseRangeHigh: null, rateQuantity: null, rateUnit: null, maxDosePerPeriod: null, maxDosePerAdministration: null, maxDosePerAdministrationUnit: null },
        ],
      });
      const result = mapMedications([med]);
      expect(result[0].dosage).toBe("Take 1 tablet");
      expect(result[0].frequency).toBe("Twice daily");
    });
  });

  // =========================================================================
  // mapAllergies
  // =========================================================================
  describe("mapAllergies", () => {
    it("maps allergy with code.text as allergen", () => {
      const allergy: AllergyOut = makeAllergy({
        code: {
          coding: [{ system: null, code: "7980", display: "Penicillin" }],
          text: "Penicillin allergy",
        },
      });

      const result = mapAllergies([allergy]);
      expect(result[0].allergen).toBe("Penicillin allergy");
    });

    it("falls back to joined coding displays when code.text is null", () => {
      const allergy: AllergyOut = makeAllergy({
        code: {
          coding: [
            { system: null, code: "7980", display: "Penicillin" },
            { system: null, code: "7981", display: "Amoxicillin" },
          ],
          text: null,
        },
      });

      const result = mapAllergies([allergy]);
      expect(result[0].allergen).toBe("Penicillin · Amoxicillin");
    });

    it("joins all manifestations across all reactions", () => {
      const allergy: AllergyOut = makeAllergy({
        reactions: [
          {
            substance: null,
            manifestations: [
              { coding: [], text: "Hives" },
              { coding: [], text: "Swelling" },
            ],
            description: null,
            onset: null,
            severity: null,
            exposureRoute: null,
          },
          {
            substance: null,
            manifestations: [
              { coding: [], text: "Anaphylaxis" },
            ],
            description: null,
            onset: null,
            severity: null,
            exposureRoute: null,
          },
        ],
      });

      const result = mapAllergies([allergy]);
      expect(result[0].reaction).toBe("Hives · Swelling · Anaphylaxis");
    });

    it("uses manifestation coding display when text is null", () => {
      const allergy: AllergyOut = makeAllergy({
        reactions: [
          {
            substance: null,
            manifestations: [
              { coding: [{ system: null, code: "1", display: "Rash" }], text: null },
            ],
            description: null,
            onset: null,
            severity: null,
            exposureRoute: null,
          },
        ],
      });

      const result = mapAllergies([allergy]);
      expect(result[0].reaction).toBe("Rash");
    });

    it("maps criticality to severity", () => {
      expect(mapAllergies([makeAllergy({ criticality: "high" })])[0].severity).toBe("SEVERE");
      expect(mapAllergies([makeAllergy({ criticality: "low" })])[0].severity).toBe("MILD");
      expect(mapAllergies([makeAllergy({ criticality: "unable-to-assess" })])[0].severity).toBe("MODERATE");
      expect(mapAllergies([makeAllergy({ criticality: null })])[0].severity).toBe("MODERATE");
    });

    it("returns null reaction when no reactions exist", () => {
      const allergy = makeAllergy({ reactions: [] });
      expect(mapAllergies([allergy])[0].reaction).toBeNull();
    });
  });
});

// =============================================================================
// Test helpers — minimal valid objects with overrides
// =============================================================================

function makeDiagnosis(overrides: Partial<DiagnosisOut> = {}): DiagnosisOut {
  return {
    code: "38341003",
    display: "Hypertension",
    recordedDate: "2024-01-01",
    id: "cond-1",
    clinicalStatus: {
      coding: [{ system: null, code: "active", display: "Active" }],
      text: "Active",
    },
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
    ...overrides,
  };
}

function makeMedication(overrides: Partial<MedicationOut> = {}): MedicationOut {
  return {
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
    ...overrides,
  };
}

function makeAllergy(overrides: Partial<AllergyOut> = {}): AllergyOut {
  return {
    id: "allergy-1",
    code: { coding: [{ system: null, code: "7980", display: "Penicillin" }], text: "Penicillin" },
    clinicalStatus: null,
    verificationStatus: null,
    type: null,
    categories: [],
    criticality: "high",
    onsetDateTime: null,
    onsetAge: null,
    onsetString: null,
    recordedDate: null,
    lastOccurrence: null,
    recorder: null,
    asserter: null,
    encounter: null,
    reactions: [],
    notes: [],
    ...overrides,
  };
}
```

**Step 2: Run tests to verify they fail**

Run: `cd /home/claude/workspace/prism-graphql && npx jest apps/epic-api-service/src/__tests__/patient-clinical-mappers.test.ts --no-cache`
Expected: FAIL — module `../services/patient-clinical-mappers` not found

**Step 3: Write the implementation**

```typescript
// apps/epic-api-service/src/services/patient-clinical-mappers.ts

import type { DiagnosisOut, MedicationOut, AllergyOut, CodeableConceptOut } from "./transforms";

// =============================================================================
// Output types (match frontend expectations)
// =============================================================================

export interface PatientCondition {
  id: string;
  code: string;
  codeSystem: string | null;
  name: string;
  status: "ACTIVE" | "RESOLVED" | "INACTIVE";
  onsetDate: string | null;
}

export interface PatientMedication {
  id: string;
  name: string;
  dosage: string | null;
  frequency: string | null;
  status: "ACTIVE" | "DISCONTINUED";
  prescribedDate: string | null;
}

export interface PatientAllergy {
  id: string;
  allergen: string;
  reaction: string | null;
  severity: "MILD" | "MODERATE" | "SEVERE";
}

// =============================================================================
// Mappers
// =============================================================================

export function mapConditions(diagnoses: DiagnosisOut[]): PatientCondition[] {
  return diagnoses.map((dx, i) => ({
    id: dx.id || `condition-${i}`,
    code: dx.code,
    codeSystem: dx.codeDetail?.coding?.[0]?.system ?? null,
    name: dx.display,
    status: mapConditionStatus(dx.clinicalStatus),
    onsetDate: dx.onsetDateTime ?? null,
  }));
}

export function mapMedications(medications: MedicationOut[]): PatientMedication[] {
  return medications.map((med, i) => ({
    id: med.id || `medication-${i}`,
    name: med.name,
    dosage: joinNonNull(med.dosageInstructions.map((d) => d.text)),
    frequency: joinNonNull(med.dosageInstructions.map((d) => d.timing)),
    status: med.status === "active" ? "ACTIVE" : "DISCONTINUED",
    prescribedDate: med.authoredOn ?? null,
  }));
}

export function mapAllergies(allergies: AllergyOut[]): PatientAllergy[] {
  return allergies.map((a, i) => ({
    id: a.id || `allergy-${i}`,
    allergen: extractAllergen(a.code),
    reaction: extractReactions(a.reactions),
    severity: mapCriticality(a.criticality),
  }));
}

// =============================================================================
// Helpers
// =============================================================================

function mapConditionStatus(clinicalStatus: CodeableConceptOut | null): "ACTIVE" | "RESOLVED" | "INACTIVE" {
  const code = clinicalStatus?.coding?.[0]?.code?.toLowerCase();
  if (code === "active") return "ACTIVE";
  if (code === "resolved") return "RESOLVED";
  return "INACTIVE";
}

function mapCriticality(criticality: string | null): "MILD" | "MODERATE" | "SEVERE" {
  switch (criticality?.toLowerCase()) {
    case "high": return "SEVERE";
    case "low": return "MILD";
    default: return "MODERATE";
  }
}

function extractAllergen(code: CodeableConceptOut | null): string {
  if (code?.text) return code.text;
  const displays = (code?.coding ?? []).map((c) => c.display).filter(Boolean) as string[];
  return displays.join(" \u00b7 ") || "Unknown allergen";
}

function extractReactions(reactions: AllergyOut["reactions"]): string | null {
  const allManifestations = reactions.flatMap((r) =>
    r.manifestations.map((m) => m.text ?? m.coding?.[0]?.display).filter(Boolean)
  ) as string[];
  return allManifestations.length > 0 ? allManifestations.join(" \u00b7 ") : null;
}

/** Join non-null/non-empty strings with ` · `, return null if none. */
function joinNonNull(values: (string | null | undefined)[]): string | null {
  const filtered = values.filter((v): v is string => v != null && v !== "");
  return filtered.length > 0 ? filtered.join(" \u00b7 ") : null;
}
```

**Step 4: Run tests to verify they pass**

Run: `cd /home/claude/workspace/prism-graphql && npx jest apps/epic-api-service/src/__tests__/patient-clinical-mappers.test.ts --no-cache`
Expected: All tests PASS

**Step 5: Commit**

```bash
cd /home/claude/workspace/prism-graphql
git add apps/epic-api-service/src/services/patient-clinical-mappers.ts apps/epic-api-service/src/__tests__/patient-clinical-mappers.test.ts
git commit -m "feat(epic-api): add clinical data mapping functions for Patient federation"
```

---

### Task 2: Add database functions for patient lookup and lightweight snapshot query

**Files:**
- Modify: `apps/epic-api-service/src/services/database.ts` — add two new exported functions
- Modify: `apps/epic-api-service/src/__tests__/database.test.ts` — add tests

**Step 1: Add tests to the existing database test file**

Append these test blocks to `database.test.ts`, after the existing `describe` blocks but inside the outer `describe("database service", ...)`:

```typescript
// At the top of the file, add to the imports:
import { getEpicPatientIdByPatientId, getLatestSnapshotClinicalData } from "../services/database";

// Add these describe blocks inside the outer describe:

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

      const result = await getEpicPatientIdByPatientId("nonexistent");
      expect(result).toBeNull();
    });
  });

  describe("getLatestSnapshotClinicalData", () => {
    it("returns conditions, medications, and allergies from latest snapshot", async () => {
      // Snapshot lookup
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: "snap-1" }],
      });
      // Conditions query
      mockQuery.mockResolvedValueOnce({
        rows: [{
          condition_id: "cond-1",
          code: "38341003",
          display: "Hypertension",
          code_detail: { coding: [{ system: "http://snomed.info/sct", code: "38341003", display: "Hypertension" }], text: null },
          clinical_status: { coding: [{ code: "active" }], text: "Active" },
          verification_status: null,
          category: [],
          severity: null,
          body_site: [],
          encounter: null,
          onset_date_time: "2023-06-15",
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
      });
      // Medications query
      mockQuery.mockResolvedValueOnce({
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
          dosage_instructions: [{ text: "10mg daily", timing: "Once daily" }],
          dispense_request: null,
          substitution: null,
          course_of_therapy_type: null,
          notes: [],
        }],
      });
      // Allergies query
      mockQuery.mockResolvedValueOnce({
        rows: [{
          allergy_intolerance_id: "allergy-1",
          code: { coding: [{ code: "7980", display: "Penicillin" }], text: "Penicillin" },
          clinical_status: null,
          verification_status: null,
          type: null,
          categories: [],
          criticality: "high",
          onset_date_time: null,
          onset_age: null,
          onset_string: null,
          recorded_date: null,
          last_occurrence: null,
          recorder: null,
          asserter: null,
          encounter: null,
          reactions: [{ substance: null, manifestations: [{ text: "Hives" }], description: null, onset: null, severity: null, exposureRoute: null }],
          notes: [],
        }],
      });

      const result = await getLatestSnapshotClinicalData("epic-123");

      expect(result).not.toBeNull();
      expect(result!.diagnoses).toHaveLength(1);
      expect(result!.diagnoses[0].code).toBe("38341003");
      expect(result!.medications).toHaveLength(1);
      expect(result!.medications[0].name).toBe("Lisinopril");
      expect(result!.allergies).toHaveLength(1);
    });

    it("returns null when no snapshot exists", async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const result = await getLatestSnapshotClinicalData("epic-999");
      expect(result).toBeNull();
    });
  });
```

**Step 2: Run tests to verify the new ones fail**

Run: `cd /home/claude/workspace/prism-graphql && npx jest apps/epic-api-service/src/__tests__/database.test.ts --no-cache`
Expected: FAIL — `getEpicPatientIdByPatientId` and `getLatestSnapshotClinicalData` are not exported

**Step 3: Implement the database functions**

Add to `apps/epic-api-service/src/services/database.ts`, before the `// Helpers: Insert` section:

```typescript
// =============================================================================
// getEpicPatientIdByPatientId
// =============================================================================

export async function getEpicPatientIdByPatientId(
  patientId: string
): Promise<string | null> {
  const db = ensureInitialized();
  const result = await db.query(
    `SELECT epic_patient_id FROM patients WHERE id = $1`,
    [patientId]
  );
  if (result.rows.length === 0) return null;
  return (result.rows[0].epic_patient_id as string) || null;
}

// =============================================================================
// getLatestSnapshotClinicalData (lightweight — conditions/meds/allergies only)
// =============================================================================

export interface SnapshotClinicalData {
  diagnoses: DiagnosisOut[];
  medications: MedicationOut[];
  allergies: AllergyOut[];
}

export async function getLatestSnapshotClinicalData(
  epicPatientId: string
): Promise<SnapshotClinicalData | null> {
  const db = ensureInitialized();

  const snapshotResult = await db.query(
    `SELECT id FROM patient_clinical_snapshots
     WHERE epic_patient_id = $1
     ORDER BY snapshot_version DESC LIMIT 1`,
    [epicPatientId]
  );

  if (snapshotResult.rows.length === 0) return null;
  const snapshotId = snapshotResult.rows[0].id as string;

  const [conditionsResult, medsResult, allergiesResult] = await Promise.all([
    db.query(
      `SELECT condition_id, code, display, code_detail, clinical_status,
              verification_status, category, severity, body_site, encounter,
              onset_date_time, onset_age, onset_string, abatement_date_time,
              abatement_age, abatement_string, recorded_date, recorder,
              asserter, stage, evidence, notes
       FROM snapshot_conditions WHERE snapshot_id = $1 ORDER BY code`,
      [snapshotId]
    ),
    db.query(
      `SELECT medication_request_id, name, status, intent, category, priority,
              medication_code, medication_reference, authored_on, requester,
              encounter, reason_code, reason_reference, dosage_instructions,
              dispense_request, substitution, course_of_therapy_type, notes
       FROM snapshot_medications WHERE snapshot_id = $1 ORDER BY name`,
      [snapshotId]
    ),
    db.query(
      `SELECT allergy_intolerance_id, code, clinical_status, verification_status,
              type, categories, criticality, onset_date_time, onset_age,
              onset_string, recorded_date, last_occurrence, recorder,
              asserter, encounter, reactions, notes
       FROM snapshot_allergies WHERE snapshot_id = $1 ORDER BY allergy_intolerance_id`,
      [snapshotId]
    ),
  ]);

  // Reuse the same row-mapping logic from loadSnapshotDetails
  return {
    diagnoses: conditionsResult.rows.map((r: Record<string, unknown>) => ({
      code: (r.code as string) || "",
      display: (r.display as string) || "",
      recordedDate: (r.recorded_date as string) || "",
      id: r.condition_id as string | null,
      clinicalStatus: r.clinical_status as DiagnosisOut["clinicalStatus"],
      verificationStatus: r.verification_status as DiagnosisOut["verificationStatus"],
      category: (r.category || []) as DiagnosisOut["category"],
      severity: r.severity as DiagnosisOut["severity"],
      codeDetail: r.code_detail as DiagnosisOut["codeDetail"],
      bodySite: (r.body_site || []) as DiagnosisOut["bodySite"],
      encounter: r.encounter as DiagnosisOut["encounter"],
      onsetDateTime: r.onset_date_time as string | null,
      onsetAge: r.onset_age ? parseFloat(r.onset_age as string) : null,
      onsetString: r.onset_string as string | null,
      abatementDateTime: r.abatement_date_time as string | null,
      abatementAge: r.abatement_age ? parseFloat(r.abatement_age as string) : null,
      abatementString: r.abatement_string as string | null,
      recorder: r.recorder as DiagnosisOut["recorder"],
      asserter: r.asserter as DiagnosisOut["asserter"],
      stage: (r.stage || []) as DiagnosisOut["stage"],
      evidence: (r.evidence || []) as DiagnosisOut["evidence"],
      notes: (r.notes || []) as string[],
    })),
    medications: medsResult.rows.map((r: Record<string, unknown>) => ({
      name: r.name as string,
      status: r.status as string,
      dosage: ((r.dosage_instructions as MedicationOut["dosageInstructions"])?.[0]?.text) || null,
      id: r.medication_request_id as string | null,
      medicationCode: r.medication_code as MedicationOut["medicationCode"],
      medicationReference: r.medication_reference as MedicationOut["medicationReference"],
      intent: r.intent as string | null,
      category: (r.category || []) as MedicationOut["category"],
      priority: r.priority as string | null,
      authoredOn: r.authored_on as string | null,
      requester: r.requester as MedicationOut["requester"],
      encounter: r.encounter as MedicationOut["encounter"],
      reasonCode: (r.reason_code || []) as MedicationOut["reasonCode"],
      reasonReference: (r.reason_reference || []) as MedicationOut["reasonReference"],
      dosageInstructions: (r.dosage_instructions || []) as MedicationOut["dosageInstructions"],
      dispenseRequest: r.dispense_request as MedicationOut["dispenseRequest"],
      substitution: r.substitution as MedicationOut["substitution"],
      courseOfTherapyType: r.course_of_therapy_type as MedicationOut["courseOfTherapyType"],
      notes: (r.notes || []) as string[],
    })),
    allergies: allergiesResult.rows.map((r: Record<string, unknown>) => ({
      id: r.allergy_intolerance_id as string | null,
      code: r.code as AllergyOut["code"],
      clinicalStatus: r.clinical_status as AllergyOut["clinicalStatus"],
      verificationStatus: r.verification_status as AllergyOut["verificationStatus"],
      type: r.type as string | null,
      categories: (r.categories || []) as string[],
      criticality: r.criticality as string | null,
      onsetDateTime: r.onset_date_time as string | null,
      onsetAge: r.onset_age ? parseFloat(r.onset_age as string) : null,
      onsetString: r.onset_string as string | null,
      recordedDate: r.recorded_date as string | null,
      lastOccurrence: r.last_occurrence as string | null,
      recorder: r.recorder as AllergyOut["recorder"],
      asserter: r.asserter as AllergyOut["asserter"],
      encounter: r.encounter as AllergyOut["encounter"],
      reactions: (r.reactions || []) as AllergyOut["reactions"],
      notes: (r.notes || []) as string[],
    })),
  };
}
```

Also add to the imports at the top of `database.ts`:
```typescript
import type { AllergyOut } from "./transforms";
```
(DiagnosisOut and MedicationOut are already imported via the existing imports.)

**Step 4: Run tests to verify they pass**

Run: `cd /home/claude/workspace/prism-graphql && npx jest apps/epic-api-service/src/__tests__/database.test.ts --no-cache`
Expected: All tests PASS

**Step 5: Commit**

```bash
cd /home/claude/workspace/prism-graphql
git add apps/epic-api-service/src/services/database.ts apps/epic-api-service/src/__tests__/database.test.ts
git commit -m "feat(epic-api): add patient lookup and lightweight snapshot query functions"
```

---

### Task 3: Add Patient Federation extension to schema and resolver

**Files:**
- Modify: `apps/epic-api-service/src/index.ts` — add types, extend Patient, add resolver
- Modify: `apps/epic-api-service/src/__tests__/resolvers.test.ts` — add test

**Step 1: Add test for Patient.__resolveReference**

Add to the existing mock setup at the top of `resolvers.test.ts`:

```typescript
// Add these mock functions (near the other mocks)
const mockGetEpicPatientIdByPatientId = jest.fn();
const mockGetLatestSnapshotClinicalData = jest.fn();

// Add to the existing jest.mock("../services/database", ...) or add new mock:
jest.mock("../services/database", () => ({
  createSnapshot: jest.fn(),
  getLatestSnapshot: jest.fn(),
  getSnapshot: jest.fn(),
  getSnapshotHistory: jest.fn(),
  initializeDatabase: jest.fn(),
  getEpicPatientIdByPatientId: (...args: unknown[]) => mockGetEpicPatientIdByPatientId(...args),
  getLatestSnapshotClinicalData: (...args: unknown[]) => mockGetLatestSnapshotClinicalData(...args),
}));
```

Add a test describe block:

```typescript
  describe("Patient.__resolveReference", () => {
    it("returns conditions, medications, allergies from latest snapshot", async () => {
      mockGetEpicPatientIdByPatientId.mockResolvedValue("epic-123");
      mockGetLatestSnapshotClinicalData.mockResolvedValue({
        diagnoses: [{
          code: "38341003",
          display: "Hypertension",
          recordedDate: "2024-01-01",
          id: "cond-1",
          clinicalStatus: { coding: [{ code: "active" }], text: "Active" },
          verificationStatus: null,
          category: [],
          severity: null,
          codeDetail: { coding: [{ system: "http://snomed.info/sct", code: "38341003", display: "Hypertension" }], text: null },
          bodySite: [],
          encounter: null,
          onsetDateTime: "2023-06-15",
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
        }],
        medications: [{
          name: "Lisinopril",
          status: "active",
          dosage: "10mg",
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
          dosageInstructions: [{ text: "Take 10mg daily", timing: "Once daily", sequence: 1, asNeeded: false, asNeededReason: null, route: null, method: null, site: null, doseQuantity: null, doseUnit: null, doseRangeLow: null, doseRangeHigh: null, rateQuantity: null, rateUnit: null, maxDosePerPeriod: null, maxDosePerAdministration: null, maxDosePerAdministrationUnit: null }],
          dispenseRequest: null,
          substitution: null,
          courseOfTherapyType: null,
          notes: [],
        }],
        allergies: [{
          id: "allergy-1",
          code: { coding: [{ system: null, code: "7980", display: "Penicillin" }], text: "Penicillin" },
          clinicalStatus: null,
          verificationStatus: null,
          type: null,
          categories: [],
          criticality: "high",
          onsetDateTime: null,
          onsetAge: null,
          onsetString: null,
          recordedDate: null,
          lastOccurrence: null,
          recorder: null,
          asserter: null,
          encounter: null,
          reactions: [],
          notes: [],
        }],
      });

      const ref = { __typename: "Patient", id: "patient-uuid-1" };
      const result = await resolvers.Patient.__resolveReference(ref);

      expect(result.id).toBe("patient-uuid-1");
      expect(result.conditions).toHaveLength(1);
      expect(result.conditions[0].name).toBe("Hypertension");
      expect(result.conditions[0].status).toBe("ACTIVE");
      expect(result.medications).toHaveLength(1);
      expect(result.medications[0].name).toBe("Lisinopril");
      expect(result.medications[0].dosage).toBe("Take 10mg daily");
      expect(result.allergies).toHaveLength(1);
      expect(result.allergies[0].allergen).toBe("Penicillin");
      expect(result.allergies[0].severity).toBe("SEVERE");
    });

    it("returns empty arrays when patient has no epic_patient_id", async () => {
      mockGetEpicPatientIdByPatientId.mockResolvedValue(null);

      const ref = { __typename: "Patient", id: "patient-no-epic" };
      const result = await resolvers.Patient.__resolveReference(ref);

      expect(result.id).toBe("patient-no-epic");
      expect(result.conditions).toEqual([]);
      expect(result.medications).toEqual([]);
      expect(result.allergies).toEqual([]);
    });

    it("returns empty arrays when no snapshot exists", async () => {
      mockGetEpicPatientIdByPatientId.mockResolvedValue("epic-999");
      mockGetLatestSnapshotClinicalData.mockResolvedValue(null);

      const ref = { __typename: "Patient", id: "patient-uuid-2" };
      const result = await resolvers.Patient.__resolveReference(ref);

      expect(result.conditions).toEqual([]);
      expect(result.medications).toEqual([]);
      expect(result.allergies).toEqual([]);
    });
  });
```

**Step 2: Run tests to verify they fail**

Run: `cd /home/claude/workspace/prism-graphql && npx jest apps/epic-api-service/src/__tests__/resolvers.test.ts --no-cache`
Expected: FAIL — `resolvers.Patient` is undefined

**Step 3: Add schema types and Patient extension to `index.ts`**

In `apps/epic-api-service/src/index.ts`, add these type definitions to the `typeDefs` template literal, before the `# Main types` section:

```graphql
  # =========================================================================
  # Patient Federation Extension (simplified clinical data)
  # =========================================================================

  enum PatientConditionStatus {
    ACTIVE
    RESOLVED
    INACTIVE
  }

  enum PatientMedicationStatus {
    ACTIVE
    DISCONTINUED
  }

  enum AllergySeverity {
    MILD
    MODERATE
    SEVERE
  }

  type PatientCondition {
    id: ID!
    code: String!
    codeSystem: String
    name: String!
    status: PatientConditionStatus!
    onsetDate: String
  }

  type PatientMedication {
    id: ID!
    name: String!
    dosage: String
    frequency: String
    status: PatientMedicationStatus!
    prescribedDate: String
  }

  type PatientAllergy {
    id: ID!
    allergen: String!
    reaction: String
    severity: AllergySeverity!
  }

  extend type Patient @key(fields: "id") {
    id: ID! @external
    conditions: [PatientCondition!]!
    medications: [PatientMedication!]!
    allergies: [PatientAllergy!]!
  }
```

**Step 4: Add the resolver to `index.ts`**

Add to the imports at the top:

```typescript
import { getEpicPatientIdByPatientId, getLatestSnapshotClinicalData } from "./services/database";
import { mapConditions, mapMedications, mapAllergies } from "./services/patient-clinical-mappers";
```

Add `Patient` resolver block to the `resolvers` object (alongside `Query` and `Mutation`):

```typescript
  Patient: {
    async __resolveReference(ref: { id: string }) {
      const epicPatientId = await getEpicPatientIdByPatientId(ref.id);

      if (!epicPatientId) {
        return { id: ref.id, conditions: [], medications: [], allergies: [] };
      }

      const clinicalData = await getLatestSnapshotClinicalData(epicPatientId);

      if (!clinicalData) {
        return { id: ref.id, conditions: [], medications: [], allergies: [] };
      }

      return {
        id: ref.id,
        conditions: mapConditions(clinicalData.diagnoses),
        medications: mapMedications(clinicalData.medications),
        allergies: mapAllergies(clinicalData.allergies),
      };
    },
  },
```

**Step 5: Run tests to verify they pass**

Run: `cd /home/claude/workspace/prism-graphql && npx jest apps/epic-api-service/src/__tests__/resolvers.test.ts --no-cache`
Expected: All tests PASS

**Step 6: Run the full epic-api-service test suite**

Run: `cd /home/claude/workspace/prism-graphql && npx jest apps/epic-api-service/ --no-cache`
Expected: All tests PASS

**Step 7: Commit**

```bash
cd /home/claude/workspace/prism-graphql
git add apps/epic-api-service/src/index.ts apps/epic-api-service/src/__tests__/resolvers.test.ts
git commit -m "feat(epic-api): extend Patient type with conditions, medications, allergies via Federation"
```

---

### Task 4: Uncomment frontend GraphQL query fields

**Files:**
- Modify: `prism-provider-front-end/src/lib/graphql/queries/patients.ts` — uncomment fields

**Step 1: Uncomment the fields**

Replace the commented-out block in `GET_PATIENT` query with:

```graphql
query GetPatient($id: ID!) {
  patient(id: $id) {
    id
    mrn
    firstName
    lastName
    dateOfBirth
    gender
    email
    phone
    address {
      street
      city
      state
      zipCode
    }
    conditions {
      id
      code
      codeSystem
      name
      status
      onsetDate
    }
    medications {
      id
      name
      dosage
      frequency
      status
      prescribedDate
    }
    allergies {
      id
      allergen
      reaction
      severity
    }
  }
}
```

**Step 2: Verify frontend types match**

Check `prism-provider-front-end/src/types/index.ts`. The `Patient` interface already has:
- `conditions: Condition[]` where `Condition` has `{ id, code, codeSystem, name, status, onsetDate }`
- `medications: Medication[]` where `Medication` has `{ id, name, dosage, frequency, status, prescribedDate }`
- `allergies: Allergy[]` where `Allergy` has `{ id, allergen, reaction, severity }`

These match the schema types exactly. No frontend type changes needed.

**Step 3: Verify the frontend builds**

Run: `cd /home/claude/workspace/prism-provider-front-end && npx next build`
Expected: Build succeeds

**Step 4: Commit**

```bash
cd /home/claude/workspace/prism-provider-front-end
git add src/lib/graphql/queries/patients.ts
git commit -m "feat(frontend): enable conditions, medications, allergies in patient query"
```

---

### Task 5: Verify end-to-end with running stack

**Step 1: Start the stack**

Run: `cd /home/claude/workspace/prism-graphql && make compose-up`

**Step 2: Seed patient data and clinical snapshots**

Run: `cd /home/claude/workspace/prism-graphql && make seed-epic-data`

**Step 3: Test the federated query via curl**

```bash
curl -s http://localhost:4000/graphql \
  -H 'Content-Type: application/json' \
  -d '{"query":"{ patients(limit: 1) { id mrn firstName lastName conditions { id code name status } medications { id name dosage frequency status } allergies { id allergen reaction severity } } }"}' | jq .
```

Expected: Patient with populated conditions, medications, and allergies arrays.

**Step 4: Start frontend and verify visually**

Run: `cd /home/claude/workspace/prism-provider-front-end && npm run dev`

Open `http://localhost:3000/patients`, click a patient. Verify:
- Conditions card shows active conditions with name, code, and status badge
- Medications card shows active meds with dosage and frequency
- Allergies card shows allergies with reaction details and severity badge
