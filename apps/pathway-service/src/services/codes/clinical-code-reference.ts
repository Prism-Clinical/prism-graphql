import type { PoolClient } from 'pg';

export interface ClinicalCodeRef {
  code: string;
  system: string;
  description?: string;
  category?: string;
}

const ALLOWED_SYSTEMS = new Set(['ICD-10', 'SNOMED', 'LOINC', 'RXNORM', 'CPT']);

/**
 * Upsert codes into `clinical_code_reference` so they appear in the
 * `searchCodes` typeahead. Idempotent via ON CONFLICT.
 *
 * - Codes with unsupported systems are silently skipped (the table has a
 *   CHECK constraint and would otherwise abort the transaction).
 * - When a code already exists with a non-empty description, we keep the
 *   existing description (a curated canonical entry beats a pathway's
 *   author-supplied label).
 * - `is_common` defaults to false for pathway-imported codes.
 *
 * MUST run inside the same transaction as the pathway write so a failure
 * rolls back both.
 */
export async function ensureClinicalCodeReference(
  client: PoolClient,
  codes: ClinicalCodeRef[],
): Promise<void> {
  // Dedupe by (system, code) — the same code may appear in condition_codes
  // and in a CodeEntry node; only need to upsert once.
  const seen = new Set<string>();
  const filtered: ClinicalCodeRef[] = [];
  for (const c of codes) {
    if (!c.code || !c.system) continue;
    if (!ALLOWED_SYSTEMS.has(c.system)) continue;
    const key = `${c.system}\x00${c.code}`;
    if (seen.has(key)) continue;
    seen.add(key);
    filtered.push(c);
  }
  if (filtered.length === 0) return;

  for (const c of filtered) {
    const desc = c.description ?? AUTO_ADDED_PLACEHOLDER;
    await client.query(
      `INSERT INTO clinical_code_reference (code, system, description, category, is_common)
       VALUES ($1, $2, $3, $4, false)
       ON CONFLICT (code, system) DO UPDATE
         SET description = CASE
           WHEN clinical_code_reference.description IS NULL
             OR clinical_code_reference.description = ''
             OR clinical_code_reference.description = $5
             OR clinical_code_reference.description LIKE '<auto-added%'
           THEN EXCLUDED.description
           ELSE clinical_code_reference.description
         END,
         category = COALESCE(clinical_code_reference.category, EXCLUDED.category)`,
      [c.code, c.system, desc, c.category ?? null, AUTO_ADDED_PLACEHOLDER],
    );
  }
}

const AUTO_ADDED_PLACEHOLDER = '<auto-added from pathway upload>';
