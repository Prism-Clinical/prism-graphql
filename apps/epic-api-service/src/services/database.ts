/**
 * Clinical Snapshot Database Service
 *
 * Manages immutable clinical data snapshots in PostgreSQL.
 * Follows the initializeDatabase() singleton pattern from careplan-service.
 */

import { Pool, PoolClient } from "pg";
import { createLogger } from "../clients/logger";
import type {
  PatientDemographicsOut,
  VitalOut,
  LabResultOut,
  MedicationOut,
  DiagnosisOut,
  AllergyOut,
} from "./transforms";

const logger = createLogger("epic-database");

let pool: Pool | null = null;

export function initializeDatabase(pgPool: Pool): void {
  pool = pgPool;
  logger.info("Database initialized");
}

function ensureInitialized(): Pool {
  if (!pool) {
    throw new Error(
      "Database not initialized. Call initializeDatabase() first."
    );
  }
  return pool;
}

// =============================================================================
// Types
// =============================================================================

export interface SnapshotData {
  demographics: PatientDemographicsOut | null;
  vitals: VitalOut[];
  labs: LabResultOut[];
  medications: MedicationOut[];
  diagnoses: DiagnosisOut[];
  allergies: AllergyOut[];
}

export interface ClinicalSnapshotFull extends SnapshotData {
  id: string;
  epicPatientId: string;
  snapshotVersion: number;
  triggerEvent: string;
  createdAt: string;
}

export interface SnapshotSummary {
  id: string;
  epicPatientId: string;
  snapshotVersion: number;
  triggerEvent: string;
  createdAt: string;
  vitalCount: number;
  labCount: number;
  medicationCount: number;
  diagnosisCount: number;
  allergyCount: number;
}

// =============================================================================
// createSnapshot
// =============================================================================

export async function createSnapshot(
  epicPatientId: string,
  triggerEvent: string,
  data: SnapshotData
): Promise<ClinicalSnapshotFull> {
  const db = ensureInitialized();
  const client = await db.connect();

  try {
    await client.query("BEGIN");

    // Lock existing rows for this patient to prevent concurrent version conflicts,
    // then compute next version number.
    await client.query(
      `SELECT 1 FROM patient_clinical_snapshots WHERE epic_patient_id = $1 FOR UPDATE`,
      [epicPatientId]
    );
    const versionResult = await client.query(
      `SELECT COALESCE(MAX(snapshot_version), 0) + 1 AS next_version
       FROM patient_clinical_snapshots WHERE epic_patient_id = $1`,
      [epicPatientId]
    );
    const snapshotVersion: number = versionResult.rows[0].next_version;

    // Insert main snapshot
    const snapshotResult = await client.query(
      `INSERT INTO patient_clinical_snapshots (epic_patient_id, snapshot_version, trigger_event)
       VALUES ($1, $2, $3)
       RETURNING id, created_at`,
      [epicPatientId, snapshotVersion, triggerEvent]
    );
    const snapshotId: string = snapshotResult.rows[0].id;
    const createdAt: string = snapshotResult.rows[0].created_at;

    // Insert child data (batched for performance)
    if (data.demographics) {
      await insertDemographics(client, snapshotId, data.demographics);
    }
    if (data.vitals.length > 0) {
      await insertVitalsBatch(client, snapshotId, data.vitals);
    }
    if (data.labs.length > 0) {
      await insertLabsBatch(client, snapshotId, data.labs);
    }
    if (data.medications.length > 0) {
      await insertMedicationsBatch(client, snapshotId, data.medications);
    }
    if (data.diagnoses.length > 0) {
      await insertConditionsBatch(client, snapshotId, data.diagnoses);
    }
    if (data.allergies.length > 0) {
      await insertAllergiesBatch(client, snapshotId, data.allergies);
    }

    await client.query("COMMIT");

    logger.info("Clinical snapshot created", {
      epicPatientId,
      snapshotId,
      snapshotVersion,
      triggerEvent,
      vitalCount: data.vitals.length,
      labCount: data.labs.length,
      medicationCount: data.medications.length,
      diagnosisCount: data.diagnoses.length,
      allergyCount: data.allergies.length,
    });

    return {
      id: snapshotId,
      epicPatientId,
      snapshotVersion,
      triggerEvent,
      createdAt,
      ...data,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    logger.error(
      "Failed to create snapshot",
      error instanceof Error ? error : undefined
    );
    throw error;
  } finally {
    client.release();
  }
}

// =============================================================================
// getLatestSnapshot
// =============================================================================

export async function getLatestSnapshot(
  epicPatientId: string
): Promise<ClinicalSnapshotFull | null> {
  const db = ensureInitialized();

  const snapshotResult = await db.query(
    `SELECT id, epic_patient_id, snapshot_version, trigger_event, created_at
     FROM patient_clinical_snapshots
     WHERE epic_patient_id = $1
     ORDER BY snapshot_version DESC LIMIT 1`,
    [epicPatientId]
  );

  if (snapshotResult.rows.length === 0) return null;
  return loadSnapshotDetails(db, snapshotResult.rows[0]);
}

// =============================================================================
// getSnapshot (by ID)
// =============================================================================

export async function getSnapshot(
  snapshotId: string
): Promise<ClinicalSnapshotFull | null> {
  const db = ensureInitialized();

  const snapshotResult = await db.query(
    `SELECT id, epic_patient_id, snapshot_version, trigger_event, created_at
     FROM patient_clinical_snapshots WHERE id = $1`,
    [snapshotId]
  );

  if (snapshotResult.rows.length === 0) return null;
  return loadSnapshotDetails(db, snapshotResult.rows[0]);
}

// =============================================================================
// getSnapshotHistory
// =============================================================================

export async function getSnapshotHistory(
  epicPatientId: string,
  limit: number = 20
): Promise<SnapshotSummary[]> {
  const db = ensureInitialized();

  const result = await db.query(
    `SELECT
       s.id,
       s.epic_patient_id,
       s.snapshot_version,
       s.trigger_event,
       s.created_at,
       (SELECT COUNT(*) FROM snapshot_vitals v WHERE v.snapshot_id = s.id)::int AS vital_count,
       (SELECT COUNT(*) FROM snapshot_lab_results l WHERE l.snapshot_id = s.id)::int AS lab_count,
       (SELECT COUNT(*) FROM snapshot_medications m WHERE m.snapshot_id = s.id)::int AS medication_count,
       (SELECT COUNT(*) FROM snapshot_conditions c WHERE c.snapshot_id = s.id)::int AS diagnosis_count,
       (SELECT COUNT(*) FROM snapshot_allergies a WHERE a.snapshot_id = s.id)::int AS allergy_count
     FROM patient_clinical_snapshots s
     WHERE s.epic_patient_id = $1
     ORDER BY s.snapshot_version DESC
     LIMIT $2`,
    [epicPatientId, limit]
  );

  return result.rows.map((row: Record<string, unknown>) => ({
    id: row.id as string,
    epicPatientId: row.epic_patient_id as string,
    snapshotVersion: row.snapshot_version as number,
    triggerEvent: row.trigger_event as string,
    createdAt: row.created_at as string,
    vitalCount: row.vital_count as number,
    labCount: row.lab_count as number,
    medicationCount: row.medication_count as number,
    diagnosisCount: row.diagnosis_count as number,
    allergyCount: row.allergy_count as number,
  }));
}

// =============================================================================
// Helpers: Insert
// =============================================================================

async function insertDemographics(
  client: PoolClient,
  snapshotId: string,
  d: PatientDemographicsOut
): Promise<void> {
  await client.query(
    `INSERT INTO snapshot_demographics (
      snapshot_id, first_name, last_name, gender, date_of_birth, mrn,
      active, deceased_boolean, deceased_date_time, marital_status,
      race_ethnicity, identifiers, names, telecom, addresses,
      emergency_contacts, communications, general_practitioner
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
    [
      snapshotId,
      d.firstName,
      d.lastName,
      d.gender,
      d.dateOfBirth,
      d.mrn,
      d.active,
      d.deceasedBoolean,
      d.deceasedDateTime,
      JSON.stringify(d.maritalStatus),
      JSON.stringify(d.raceEthnicity),
      JSON.stringify(d.identifiers),
      JSON.stringify(d.names),
      JSON.stringify(d.telecom),
      JSON.stringify(d.addresses),
      JSON.stringify(d.emergencyContacts),
      JSON.stringify(d.communications),
      JSON.stringify(d.generalPractitioner),
    ]
  );
}

/**
 * Build a multi-row INSERT statement with parameterized placeholders.
 * Returns { text, values } for use with client.query().
 */
function buildBatchInsert(
  table: string,
  columns: string[],
  rows: unknown[][]
): { text: string; values: unknown[] } {
  const colsPerRow = columns.length;
  const valueClauses: string[] = [];
  const values: unknown[] = [];

  for (let i = 0; i < rows.length; i++) {
    const offset = i * colsPerRow;
    const placeholders = columns.map((_, j) => `$${offset + j + 1}`);
    valueClauses.push(`(${placeholders.join(",")})`);
    values.push(...rows[i]);
  }

  const text = `INSERT INTO ${table} (${columns.join(", ")}) VALUES ${valueClauses.join(", ")}`;
  return { text, values };
}

async function insertVitalsBatch(
  client: PoolClient,
  snapshotId: string,
  vitals: VitalOut[]
): Promise<void> {
  const columns = [
    "snapshot_id", "observation_type", "value", "unit", "recorded_date", "status",
    "category", "code", "interpretation", "reference_range", "body_site",
    "performer", "encounter", "issued_date", "components", "is_normalized",
  ];
  const rows = vitals.map((v) => [
    snapshotId, v.type, v.value, v.unit, v.recordedDate, v.status,
    v.category, JSON.stringify(v.code), JSON.stringify(v.interpretation),
    JSON.stringify(v.referenceRange), JSON.stringify(v.bodySite),
    JSON.stringify(v.performer), JSON.stringify(v.encounter), v.issuedDate,
    JSON.stringify(v.components), v.isNormalized,
  ]);
  const { text, values } = buildBatchInsert("snapshot_vitals", columns, rows);
  await client.query(text, values);
}

async function insertLabsBatch(
  client: PoolClient,
  snapshotId: string,
  labs: LabResultOut[]
): Promise<void> {
  const columns = [
    "snapshot_id", "observation_id", "code", "status", "category", "effective_date_time",
    "issued_date", "value_quantity", "value_unit", "value_string", "value_codeable_concept",
    "interpretation", "reference_range", "performer", "encounter", "specimen",
    "body_site", "has_member", "components", "notes",
  ];
  const rows = labs.map((lab) => [
    snapshotId, lab.id, JSON.stringify(lab.code), lab.status, lab.category,
    lab.effectiveDateTime, lab.issuedDate, lab.valueQuantity, lab.valueUnit,
    lab.valueString, JSON.stringify(lab.valueCodeableConcept),
    JSON.stringify(lab.interpretation), JSON.stringify(lab.referenceRange),
    JSON.stringify(lab.performer), JSON.stringify(lab.encounter),
    JSON.stringify(lab.specimen), JSON.stringify(lab.bodySite),
    JSON.stringify(lab.hasMember), JSON.stringify(lab.components), lab.notes,
  ]);
  const { text, values } = buildBatchInsert("snapshot_lab_results", columns, rows);
  await client.query(text, values);
}

async function insertMedicationsBatch(
  client: PoolClient,
  snapshotId: string,
  medications: MedicationOut[]
): Promise<void> {
  const columns = [
    "snapshot_id", "medication_request_id", "name", "status", "intent", "category",
    "priority", "medication_code", "medication_reference", "authored_on",
    "requester", "encounter", "reason_code", "reason_reference", "dosage_instructions",
    "dispense_request", "substitution", "course_of_therapy_type", "notes",
  ];
  const rows = medications.map((med) => [
    snapshotId, med.id, med.name, med.status, med.intent,
    JSON.stringify(med.category), med.priority, JSON.stringify(med.medicationCode),
    JSON.stringify(med.medicationReference), med.authoredOn,
    JSON.stringify(med.requester), JSON.stringify(med.encounter),
    JSON.stringify(med.reasonCode), JSON.stringify(med.reasonReference),
    JSON.stringify(med.dosageInstructions), JSON.stringify(med.dispenseRequest),
    JSON.stringify(med.substitution), JSON.stringify(med.courseOfTherapyType),
    med.notes,
  ]);
  const { text, values } = buildBatchInsert("snapshot_medications", columns, rows);
  await client.query(text, values);
}

async function insertConditionsBatch(
  client: PoolClient,
  snapshotId: string,
  diagnoses: DiagnosisOut[]
): Promise<void> {
  const columns = [
    "snapshot_id", "condition_id", "code", "display", "code_detail", "clinical_status",
    "verification_status", "category", "severity", "body_site", "encounter",
    "onset_date_time", "onset_age", "onset_string", "abatement_date_time",
    "abatement_age", "abatement_string", "recorded_date", "recorder", "asserter",
    "stage", "evidence", "notes",
  ];
  const rows = diagnoses.map((dx) => [
    snapshotId, dx.id, dx.code, dx.display, JSON.stringify(dx.codeDetail),
    JSON.stringify(dx.clinicalStatus), JSON.stringify(dx.verificationStatus),
    JSON.stringify(dx.category), JSON.stringify(dx.severity),
    JSON.stringify(dx.bodySite), JSON.stringify(dx.encounter),
    dx.onsetDateTime, dx.onsetAge, dx.onsetString, dx.abatementDateTime,
    dx.abatementAge, dx.abatementString, dx.recordedDate,
    JSON.stringify(dx.recorder), JSON.stringify(dx.asserter),
    JSON.stringify(dx.stage), JSON.stringify(dx.evidence), dx.notes,
  ]);
  const { text, values } = buildBatchInsert("snapshot_conditions", columns, rows);
  await client.query(text, values);
}

async function insertAllergiesBatch(
  client: PoolClient,
  snapshotId: string,
  allergies: AllergyOut[]
): Promise<void> {
  const columns = [
    "snapshot_id", "allergy_intolerance_id", "code", "clinical_status",
    "verification_status", "type", "categories", "criticality",
    "onset_date_time", "onset_age", "onset_string", "recorded_date",
    "last_occurrence", "recorder", "asserter", "encounter", "reactions", "notes",
  ];
  const rows = allergies.map((a) => [
    snapshotId, a.id, JSON.stringify(a.code), JSON.stringify(a.clinicalStatus),
    JSON.stringify(a.verificationStatus), a.type, a.categories, a.criticality,
    a.onsetDateTime, a.onsetAge, a.onsetString, a.recordedDate,
    a.lastOccurrence, JSON.stringify(a.recorder), JSON.stringify(a.asserter),
    JSON.stringify(a.encounter), JSON.stringify(a.reactions), a.notes,
  ]);
  const { text, values } = buildBatchInsert("snapshot_allergies", columns, rows);
  await client.query(text, values);
}

// =============================================================================
// Helper: Load full snapshot details from DB
// =============================================================================

async function loadSnapshotDetails(
  db: Pool,
  row: {
    id: string;
    epic_patient_id: string;
    snapshot_version: number;
    trigger_event: string;
    created_at: string;
  }
): Promise<ClinicalSnapshotFull> {
  const [demoResult, vitalsResult, labsResult, medsResult, conditionsResult, allergiesResult] =
    await Promise.all([
      db.query(
        `SELECT first_name, last_name, gender, date_of_birth, mrn, active,
                deceased_boolean, deceased_date_time, marital_status, race_ethnicity,
                identifiers, names, telecom, addresses, emergency_contacts,
                communications, general_practitioner
         FROM snapshot_demographics WHERE snapshot_id = $1`,
        [row.id]
      ),
      db.query(
        `SELECT observation_type, value, unit, recorded_date, status, category,
                code, interpretation, reference_range, body_site, performer,
                encounter, issued_date, components, is_normalized
         FROM snapshot_vitals WHERE snapshot_id = $1 ORDER BY recorded_date`,
        [row.id]
      ),
      db.query(
        `SELECT observation_id, code, status, category, effective_date_time,
                issued_date, value_quantity, value_unit, value_string,
                value_codeable_concept, interpretation, reference_range,
                performer, encounter, specimen, body_site, has_member,
                components, notes
         FROM snapshot_lab_results WHERE snapshot_id = $1 ORDER BY effective_date_time`,
        [row.id]
      ),
      db.query(
        `SELECT medication_request_id, name, status, intent, category, priority,
                medication_code, medication_reference, authored_on, requester,
                encounter, reason_code, reason_reference, dosage_instructions,
                dispense_request, substitution, course_of_therapy_type, notes
         FROM snapshot_medications WHERE snapshot_id = $1 ORDER BY name`,
        [row.id]
      ),
      db.query(
        `SELECT condition_id, code, display, code_detail, clinical_status,
                verification_status, category, severity, body_site, encounter,
                onset_date_time, onset_age, onset_string, abatement_date_time,
                abatement_age, abatement_string, recorded_date, recorder,
                asserter, stage, evidence, notes
         FROM snapshot_conditions WHERE snapshot_id = $1 ORDER BY code`,
        [row.id]
      ),
      db.query(
        `SELECT allergy_intolerance_id, code, clinical_status, verification_status,
                type, categories, criticality, onset_date_time, onset_age,
                onset_string, recorded_date, last_occurrence, recorder,
                asserter, encounter, reactions, notes
         FROM snapshot_allergies WHERE snapshot_id = $1 ORDER BY allergy_intolerance_id`,
        [row.id]
      ),
    ]);

  const demo = demoResult.rows[0] || null;

  return {
    id: row.id,
    epicPatientId: row.epic_patient_id,
    snapshotVersion: row.snapshot_version,
    triggerEvent: row.trigger_event,
    createdAt: row.created_at,
    demographics: demo
      ? {
          firstName: demo.first_name || "",
          lastName: demo.last_name || "",
          gender: demo.gender || "",
          dateOfBirth: demo.date_of_birth || "",
          mrn: demo.mrn || "",
          active: demo.active,
          deceasedBoolean: demo.deceased_boolean,
          deceasedDateTime: demo.deceased_date_time,
          maritalStatus: demo.marital_status,
          raceEthnicity: demo.race_ethnicity,
          identifiers: demo.identifiers || [],
          names: demo.names || [],
          telecom: demo.telecom || [],
          addresses: demo.addresses || [],
          emergencyContacts: demo.emergency_contacts || [],
          communications: demo.communications || [],
          generalPractitioner: demo.general_practitioner || [],
        }
      : null,
    vitals: vitalsResult.rows.map((r: Record<string, unknown>) => ({
      type: r.observation_type as string,
      value: parseFloat(r.value as string),
      unit: (r.unit as string) || "",
      recordedDate: (r.recorded_date as string) || "",
      isNormalized: (r.is_normalized as boolean) || false,
      code: r.code as VitalOut["code"],
      status: r.status as string | null,
      category: r.category as string | null,
      interpretation: (r.interpretation || []) as VitalOut["interpretation"],
      referenceRange: (r.reference_range || []) as VitalOut["referenceRange"],
      bodySite: r.body_site as VitalOut["bodySite"],
      method: null as VitalOut["method"],
      performer: (r.performer || []) as VitalOut["performer"],
      encounter: r.encounter as VitalOut["encounter"],
      issuedDate: r.issued_date as string | null,
      components: (r.components || []) as VitalOut["components"],
    })),
    labs: labsResult.rows.map((r: Record<string, unknown>) => ({
      id: r.observation_id as string | null,
      code: r.code as LabResultOut["code"],
      status: r.status as string,
      category: r.category as string | null,
      effectiveDateTime: r.effective_date_time as string | null,
      issuedDate: r.issued_date as string | null,
      valueQuantity: r.value_quantity ? parseFloat(r.value_quantity as string) : null,
      valueUnit: r.value_unit as string | null,
      valueString: r.value_string as string | null,
      valueCodeableConcept: r.value_codeable_concept as LabResultOut["valueCodeableConcept"],
      interpretation: (r.interpretation || []) as LabResultOut["interpretation"],
      referenceRange: (r.reference_range || []) as LabResultOut["referenceRange"],
      performer: (r.performer || []) as LabResultOut["performer"],
      encounter: r.encounter as LabResultOut["encounter"],
      specimen: r.specimen as LabResultOut["specimen"],
      bodySite: r.body_site as LabResultOut["bodySite"],
      hasMember: (r.has_member || []) as LabResultOut["hasMember"],
      components: (r.components || []) as LabResultOut["components"],
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
