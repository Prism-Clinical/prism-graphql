// FHIR R4 condition-clinical ValueSet codes that count as "currently active"
// for purposes of pathway matching and reachability scoring. The remaining
// codes from the ValueSet (resolved, inactive, remission) cause us to drop
// the condition from the patient's effective code set.
const ACTIVE_CLINICAL_STATUS_CODES: ReadonlySet<string> = new Set([
  'active',
  'recurrence',
  'relapse',
]);

interface FhirCoding {
  system?: string;
  code?: string;
  display?: string;
}

interface FhirCodeableConcept {
  coding?: FhirCoding[];
  text?: string;
}

interface ConditionStatusRow {
  clinical_status: unknown;
  abatement_date_time: string | null | undefined;
}

/**
 * Decide whether a snapshot_conditions row should be treated as "currently
 * active" for clinical decision-making.
 *
 * Rules:
 *   1. Any non-null `abatement_date_time` → inactive (condition has ended).
 *   2. Otherwise inspect FHIR `clinical_status.coding[]` — active if ANY
 *      coding entry has a code in {active, recurrence, relapse}.
 *   3. Fail-safe: if `clinical_status` is missing, malformed, or has an empty
 *      coding array, treat as active. Better to over-include than to silently
 *      drop conditions we can't classify.
 *
 * Mirrored exactly by `activeConditionPredicate` for in-SQL filtering.
 */
export function isConditionActive(row: ConditionStatusRow): boolean {
  if (row.abatement_date_time) return false;

  const status = row.clinical_status as FhirCodeableConcept | null | undefined;
  if (!status || typeof status !== 'object') return true;

  const coding = Array.isArray(status.coding) ? status.coding : null;
  if (!coding || coding.length === 0) return true;

  return coding.some(
    (c) => typeof c?.code === 'string' && ACTIVE_CLINICAL_STATUS_CODES.has(c.code),
  );
}

const SAFE_ALIAS_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

/**
 * SQL WHERE-clause fragment that matches `isConditionActive` for in-database
 * filtering. The fragment is intended to be AND-combined with other predicates
 * in a query that reads `snapshot_conditions` aliased as `alias`.
 *
 * Example: `WHERE sc.code IS NOT NULL AND ${activeConditionPredicate('sc')}`.
 *
 * The alias is validated against a strict identifier pattern to prevent SQL
 * injection — only callers in this codebase pass it, and they pass literals,
 * but the validation is cheap insurance.
 */
export function activeConditionPredicate(alias: string): string {
  if (!SAFE_ALIAS_PATTERN.test(alias)) {
    throw new Error(`activeConditionPredicate: invalid SQL alias "${alias}"`);
  }
  return `
    ${alias}.abatement_date_time IS NULL
    AND (
      ${alias}.clinical_status IS NULL
      OR jsonb_typeof(${alias}.clinical_status->'coding') IS DISTINCT FROM 'array'
      OR jsonb_array_length(${alias}.clinical_status->'coding') = 0
      OR EXISTS (
        SELECT 1 FROM jsonb_array_elements(${alias}.clinical_status->'coding') AS c
        WHERE c->>'code' IN ('active', 'recurrence', 'relapse')
      )
    )
  `.trim();
}
