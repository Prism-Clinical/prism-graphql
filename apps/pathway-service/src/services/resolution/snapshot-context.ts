import { Pool } from 'pg';
import { PatientContext, CodeEntry, LabResult } from '../confidence/types';
import { isConditionActive } from '../snapshot/active-context-filter';

interface FhirCoding {
  code?: string;
  system?: string;
  display?: string;
}

interface FhirCodeableConcept {
  coding?: FhirCoding[];
  text?: string;
}

function pickFirstCoding(value: unknown): FhirCoding | null {
  if (!value || typeof value !== 'object') return null;
  const concept = value as FhirCodeableConcept;
  return concept.coding?.[0] ?? null;
}

function normalizeSystem(system: string | undefined): string {
  if (!system) return '';
  if (system.includes('icd-10') || system.includes('ICD-10')) return 'ICD-10';
  if (system.includes('snomed') || system.includes('SNOMED')) return 'SNOMED';
  if (system.includes('loinc') || system.includes('LOINC')) return 'LOINC';
  if (system.includes('rxnorm') || system.includes('RxNorm') || system.includes('RXNORM')) return 'RXNORM';
  if (system.includes('cpt') || system.includes('CPT')) return 'CPT';
  return system;
}

/**
 * Load the latest clinical snapshot for a patient and shape it into a
 * PatientContext. Returns an empty context (with the patientId) if the patient
 * has no snapshots — caller should treat that as "no data available."
 */
export async function loadPatientContextFromSnapshot(
  pool: Pool,
  patientId: string,
): Promise<PatientContext> {
  const snapshotResult = await pool.query(
    `SELECT pcs.id
       FROM patient_clinical_snapshots pcs
       JOIN patients p ON pcs.epic_patient_id = p.epic_patient_id
      WHERE p.id = $1
      ORDER BY pcs.snapshot_version DESC
      LIMIT 1`,
    [patientId],
  );

  const snapshotId = snapshotResult.rows[0]?.id;
  if (!snapshotId) {
    return {
      patientId,
      conditionCodes: [],
      medications: [],
      labResults: [],
      allergies: [],
    };
  }

  const [conditionsRes, medicationsRes, labsRes, allergiesRes, vitalsRes] = await Promise.all([
    pool.query(
      `SELECT code, code_detail, display, clinical_status, abatement_date_time
         FROM snapshot_conditions
        WHERE snapshot_id = $1 AND code IS NOT NULL`,
      [snapshotId],
    ),
    pool.query(
      `SELECT name, medication_code FROM snapshot_medications WHERE snapshot_id = $1 AND status = 'active'`,
      [snapshotId],
    ),
    pool.query(
      `SELECT code, value_quantity, value_unit, effective_date_time FROM snapshot_lab_results WHERE snapshot_id = $1`,
      [snapshotId],
    ),
    pool.query(
      `SELECT code FROM snapshot_allergies WHERE snapshot_id = $1`,
      [snapshotId],
    ),
    pool.query(
      `SELECT observation_type, value FROM snapshot_vitals WHERE snapshot_id = $1 AND value IS NOT NULL`,
      [snapshotId],
    ),
  ]);

  const conditionCodes: CodeEntry[] = conditionsRes.rows
    .filter((row) => isConditionActive(row))
    .map((row): CodeEntry | null => {
      if (!row.code) return null;
      const coding = pickFirstCoding(row.code_detail);
      return {
        code: row.code,
        system: normalizeSystem(coding?.system) || 'ICD-10',
        display: row.display ?? coding?.display,
      };
    })
    .filter((entry): entry is CodeEntry => entry !== null);

  const medications: CodeEntry[] = medicationsRes.rows
    .map((row): CodeEntry | null => {
      const coding = pickFirstCoding(row.medication_code);
      if (!coding?.code) return null;
      return {
        code: coding.code,
        system: normalizeSystem(coding.system) || 'RXNORM',
        display: coding.display ?? row.name,
      };
    })
    .filter((entry): entry is CodeEntry => entry !== null);

  const labResults: LabResult[] = labsRes.rows
    .map((row): LabResult | null => {
      const coding = pickFirstCoding(row.code);
      if (!coding?.code) return null;
      return {
        code: coding.code,
        system: normalizeSystem(coding.system) || 'LOINC',
        value: row.value_quantity != null ? Number(row.value_quantity) : undefined,
        unit: row.value_unit ?? undefined,
        date: row.effective_date_time ?? undefined,
        display: coding.display,
      };
    })
    .filter((entry): entry is LabResult => entry !== null);

  const allergies: CodeEntry[] = allergiesRes.rows
    .map((row): CodeEntry | null => {
      const coding = pickFirstCoding(row.code);
      if (!coding?.code) return null;
      return {
        code: coding.code,
        system: normalizeSystem(coding.system) || 'RXNORM',
        display: coding.display,
      };
    })
    .filter((entry): entry is CodeEntry => entry !== null);

  const vitalSigns: Record<string, unknown> = {};
  for (const row of vitalsRes.rows) {
    if (typeof row.observation_type === 'string' && row.value != null) {
      vitalSigns[row.observation_type] = Number(row.value);
    }
  }

  return {
    patientId,
    conditionCodes,
    medications,
    labResults,
    allergies,
    vitalSigns: Object.keys(vitalSigns).length > 0 ? vitalSigns : undefined,
  };
}

/**
 * Lazy, memoized loader for a patient's snapshot context. Returns a function
 * that loads on first call and reuses the same promise on subsequent calls.
 * Used to share the snapshot read across multiple field resolvers within one
 * GraphQL request without loading eagerly when no field needs it.
 */
export function createPatientContextLoader(
  pool: Pool,
  patientId: string,
): () => Promise<PatientContext> {
  let cached: Promise<PatientContext> | null = null;
  return () => {
    if (!cached) cached = loadPatientContextFromSnapshot(pool, patientId);
    return cached;
  };
}
