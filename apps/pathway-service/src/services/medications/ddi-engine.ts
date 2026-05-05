/**
 * DDI engine — pure lookup against the three Phase-4 tables.
 *
 * Boundary contract: callers pass canonical ingredient-level RxCUIs (resolved
 * via `lookupNormalizedMedication` upstream) plus the drug's ATC classes
 * (also from the normalization cache). The engine never calls the normalizer
 * — that's the upstream layer's job. Keeps this module pure-DB-lookup.
 *
 * Lookup rules (locked in design phase):
 *   - drug↔drug: pair table first; if hit, return it. Pair always wins,
 *     even when a class rule would be more severe.
 *   - drug↔drug class fallback: union of cross-product (drug A's classes
 *     × drug B's classes), highest severity wins.
 *   - drug↔allergy: drug's ATC classes prefix-match any allergy_class_mappings
 *     row mapped from the patient's SNOMED allergens.
 */

import { Pool } from 'pg';

// ─── Shared types ─────────────────────────────────────────────────────

export type DdiSeverity = 'CONTRAINDICATED' | 'SEVERE' | 'MODERATE' | 'MINOR';

const SEVERITY_RANK: Record<DdiSeverity, number> = {
  CONTRAINDICATED: 1,
  SEVERE: 2,
  MODERATE: 3,
  MINOR: 4,
};

export interface InteractionResult {
  severity: DdiSeverity;
  mechanism: string | null;
  clinicalAdvice: string | null;
  matchType: 'PAIR' | 'CLASS';
  /** For class matches, the actual (a, b) ATC pair that fired. */
  matchedClasses: { atcClassA: string; atcClassB: string } | null;
}

export interface AllergyMatchResult {
  /** v1 treats every allergy hit as SEVERE — no graded allergy reactions yet. */
  severity: 'SEVERE';
  snomedCode: string;
  snomedDisplay: string;
  /** The ATC class on the allergy mapping (level 3-4 typically). */
  allergyAtcClass: string;
  /** The specific ATC class on the drug that prefix-matched the allergy. */
  matchedDrugAtcClass: string;
}

export interface PatientAllergyInput {
  /** SNOMED code; non-SNOMED allergies are ignored in v1. */
  snomedCode: string;
}

// ─── Drug ↔ drug ──────────────────────────────────────────────────────

/**
 * Check for a known interaction between two ingredient-level RxCUIs. Pair
 * table first; class fallback on miss. Returns null if no rule fires.
 *
 * Both `rxcuiA` and `rxcuiB` and their ATC class lists are inputs — caller
 * supplies them from the normalization cache. This keeps the engine off
 * RxNav and lets tests fixture-drive the data.
 */
export async function checkDrugDrugInteraction(
  pool: Pool,
  drugA: { rxcui: string; atcClasses: string[] },
  drugB: { rxcui: string; atcClasses: string[] },
): Promise<InteractionResult | null> {
  if (drugA.rxcui === drugB.rxcui) return null; // same drug, no self-interaction

  // Pair lookup (canonicalized at the SQL level via LEAST/GREATEST).
  const pair = await pool.query(
    `SELECT severity, mechanism, clinical_advice
       FROM drug_interactions
       WHERE rxcui_a = LEAST($1::text, $2::text)
         AND rxcui_b = GREATEST($1::text, $2::text)`,
    [drugA.rxcui, drugB.rxcui],
  );
  if (pair.rows.length > 0) {
    const row = pair.rows[0];
    return {
      severity: row.severity as DdiSeverity,
      mechanism: row.mechanism,
      clinicalAdvice: row.clinical_advice,
      matchType: 'PAIR',
      matchedClasses: null,
    };
  }

  // Class fallback. If either side has no ATC classes, no class match possible.
  if (drugA.atcClasses.length === 0 || drugB.atcClasses.length === 0) return null;

  // Class rules may be authored at any ATC level (e.g. 'J01C' for "any
  // penicillin"); a drug's ATC is typically level 5 ('J01CA04'). So matching
  // is prefix-based: the drug's class must start_with the rule's class.
  // Each row is checked in both orientations because we don't constrain
  // which drug is "A" — the rule's canonical (a < b) doesn't carry semantic
  // ordering, just dedup.
  const classHit = await pool.query(
    `SELECT atc_class_a, atc_class_b, severity, mechanism, clinical_advice
       FROM drug_class_interactions ci
       WHERE (
         EXISTS (SELECT 1 FROM unnest($1::text[]) a(code) WHERE a.code LIKE ci.atc_class_a || '%')
         AND
         EXISTS (SELECT 1 FROM unnest($2::text[]) b(code) WHERE b.code LIKE ci.atc_class_b || '%')
       ) OR (
         EXISTS (SELECT 1 FROM unnest($1::text[]) a(code) WHERE a.code LIKE ci.atc_class_b || '%')
         AND
         EXISTS (SELECT 1 FROM unnest($2::text[]) b(code) WHERE b.code LIKE ci.atc_class_a || '%')
       )
       ORDER BY CASE severity
         WHEN 'CONTRAINDICATED' THEN 1
         WHEN 'SEVERE'          THEN 2
         WHEN 'MODERATE'        THEN 3
         WHEN 'MINOR'           THEN 4
       END
       LIMIT 1`,
    [drugA.atcClasses, drugB.atcClasses],
  );
  if (classHit.rows.length === 0) return null;

  const row = classHit.rows[0];
  return {
    severity: row.severity as DdiSeverity,
    mechanism: row.mechanism,
    clinicalAdvice: row.clinical_advice,
    matchType: 'CLASS',
    matchedClasses: { atcClassA: row.atc_class_a, atcClassB: row.atc_class_b },
  };
}

// ─── Drug ↔ allergy ───────────────────────────────────────────────────

/**
 * Pre-resolved allergy mapping. Produced once per patient by
 * `fetchAllergyMappings`, then re-used by `matchDrugAllergyAgainstMappings`
 * for every candidate drug — so checking a list of meds against a patient's
 * allergies is one SQL query, not N.
 */
export interface AllergyMapping {
  snomedCode: string;
  snomedDisplay: string;
  atcClass: string;
}

/**
 * Resolve each SNOMED allergen to its ATC class via `allergy_class_mappings`.
 * Allergens with no mapping are silently dropped — they can't fire any check.
 */
export async function fetchAllergyMappings(
  pool: Pool,
  allergies: PatientAllergyInput[],
): Promise<AllergyMapping[]> {
  if (allergies.length === 0) return [];
  const r = await pool.query(
    `SELECT snomed_code, snomed_display, atc_class
       FROM allergy_class_mappings
       WHERE snomed_code = ANY($1::text[])`,
    [allergies.map((a) => a.snomedCode)],
  );
  return r.rows.map((row) => ({
    snomedCode: row.snomed_code,
    snomedDisplay: row.snomed_display,
    atcClass: row.atc_class,
  }));
}

/**
 * Pure prefix-match: does any of the drug's ATC classes start with any
 * allergy mapping's ATC class? Each fired (drug-class, allergy) pair
 * produces one result — caller dedupes by snomedCode if desired.
 */
export function matchDrugAllergyAgainstMappings(
  drug: { atcClasses: string[] },
  mappings: AllergyMapping[],
): AllergyMatchResult[] {
  if (drug.atcClasses.length === 0 || mappings.length === 0) return [];
  const results: AllergyMatchResult[] = [];
  for (const m of mappings) {
    for (const drugAtc of drug.atcClasses) {
      if (drugAtc.startsWith(m.atcClass)) {
        results.push({
          severity: 'SEVERE',
          snomedCode: m.snomedCode,
          snomedDisplay: m.snomedDisplay,
          allergyAtcClass: m.atcClass,
          matchedDrugAtcClass: drugAtc,
        });
      }
    }
  }
  return results;
}

/**
 * Convenience: fetch + match in one async call. Equivalent to the original
 * one-shot signature; preserved so consumers that don't need the per-patient
 * memoization can stay simple.
 */
export async function checkDrugAllergy(
  pool: Pool,
  drug: { rxcui: string; atcClasses: string[] },
  allergies: PatientAllergyInput[],
): Promise<AllergyMatchResult[]> {
  if (drug.atcClasses.length === 0 || allergies.length === 0) return [];
  const mappings = await fetchAllergyMappings(pool, allergies);
  return matchDrugAllergyAgainstMappings(drug, mappings);
}

// ─── Helpers ──────────────────────────────────────────────────────────

/**
 * Order two interaction results by severity (lowest rank first =
 * most severe). Useful when consolidating multiple findings into one
 * representative hit per pair.
 */
export function moreSevere(
  a: InteractionResult | null,
  b: InteractionResult | null,
): InteractionResult | null {
  if (!a) return b;
  if (!b) return a;
  return SEVERITY_RANK[a.severity] <= SEVERITY_RANK[b.severity] ? a : b;
}
