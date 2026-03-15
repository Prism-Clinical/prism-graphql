/**
 * SNOMED CT to ICD-10-CM Lookup
 *
 * Provides ICD-10 code resolution for conditions that arrive as SNOMED codes.
 * Two strategies:
 *   1. Extract ICD-10 from FHIR CodeableConcept coding[] array (primary)
 *   2. Query snomed_icd10_common_map table (fallback)
 */

import type { CodeableConceptOut } from "./transforms";

// Recognized ICD-10 system URIs from FHIR
const ICD10_SYSTEMS = [
  "http://hl7.org/fhir/sid/icd-10-cm",
  "http://hl7.org/fhir/sid/icd-10",
  "urn:oid:2.16.840.1.113883.6.90",
];

const ICD10_PATTERN = /^[A-Z]\d{2}(\.\d{1,4})?$/;

/**
 * Extract an ICD-10 code from a FHIR CodeableConcept's coding array.
 * Returns the first ICD-10 code found, or null.
 */
export function extractIcd10FromCoding(
  codeDetail: CodeableConceptOut | null
): string | null {
  if (!codeDetail) return null;

  for (const coding of codeDetail.coding) {
    if (!coding.system || !coding.code) continue;

    const systemLower = coding.system.toLowerCase();
    const isIcd10System = ICD10_SYSTEMS.some((s) => systemLower.includes(s.toLowerCase()));

    if (isIcd10System && ICD10_PATTERN.test(coding.code)) {
      return coding.code;
    }
  }

  return null;
}

// In-memory cache for the mapping table (loaded once, ~80 rows)
let mapCache: Map<string, string> | null = null;

/**
 * Load the snomed_icd10_common_map table into memory.
 * Called once on first lookup, then cached for the process lifetime.
 */
async function loadMap(
  query: (sql: string) => Promise<{ rows: Array<{ snomed_code: string; icd10_code: string }> }>
): Promise<Map<string, string>> {
  if (mapCache) return mapCache;

  const result = await query(
    "SELECT snomed_code, icd10_code FROM snomed_icd10_common_map"
  );

  mapCache = new Map(result.rows.map((r) => [r.snomed_code, r.icd10_code]));
  return mapCache;
}

/**
 * Look up an ICD-10 code for a SNOMED code from the fallback mapping table.
 * Returns null if no mapping exists.
 */
export async function lookupSnomedToIcd10(
  snomedCode: string,
  query: (sql: string) => Promise<{ rows: Array<{ snomed_code: string; icd10_code: string }> }>
): Promise<string | null> {
  const map = await loadMap(query);
  return map.get(snomedCode) ?? null;
}

/**
 * Reset the in-memory cache. Used in tests.
 */
export function resetMapCache(): void {
  mapCache = null;
}
