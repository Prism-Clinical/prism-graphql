import { Pool } from 'pg';
import { canonicalKey } from './normalizer';
import { AllergyMapping, DdiSeverity, InteractionResult, fetchAllergyMappings } from './ddi-engine';
import { MedicationInput, NormalizedMedication } from './types';

export interface ClassRule {
  atcClassA: string;
  atcClassB: string;
  severity: DdiSeverity;
  mechanism: string | null;
  clinicalAdvice: string | null;
}

/**
 * Every row a safety pass reads, loaded once inside the evaluation snapshot
 * (spec C4). The pure functions below reproduce `checkDrugDrugInteraction`
 * and `lookupNormalizedMedication` over it, so evaluation makes no queries.
 */
export interface SafetyReference {
  /** `normalizedKey(input)` → normalised medication. Absent means not normalised. */
  normalized: Map<string, NormalizedMedication>;
  /** `pairKey(rxcuiA, rxcuiB)` → pair rule. */
  pairs: Map<string, InteractionResult>;
  classRules: ClassRule[];
  allergyMappings: AllergyMapping[];
}

const SEVERITY_RANK: Record<DdiSeverity, number> = { CONTRAINDICATED: 1, SEVERE: 2, MODERATE: 3, MINOR: 4 };

export function normalizedKey(input: MedicationInput): string {
  const k = canonicalKey(input);
  return `${k.text}|${k.system}|${k.code}`;
}

const pairKey = (a: string, b: string): string => (a < b ? `${a}|${b}` : `${b}|${a}`);

export async function loadSafetyReference(
  db: Pick<Pool, 'query'>,
  universe: { medications: MedicationInput[]; allergySnomedCodes: string[] },
): Promise<SafetyReference> {
  const keys = [...new Map(universe.medications.map((m) => [normalizedKey(m), canonicalKey(m)])).values()];

  const normalized = new Map<string, NormalizedMedication>();
  if (keys.length > 0) {
    const r = await db.query(
      `SELECT input_text, input_system, input_code, ingredient_rxcui, ingredient_name, atc_classes
         FROM medication_normalization_cache
        WHERE (input_text, input_system, input_code) IN (
          SELECT t, s, c FROM unnest($1::text[], $2::text[], $3::text[]) AS u(t, s, c))`,
      [keys.map((k) => k.text), keys.map((k) => k.system), keys.map((k) => k.code)],
    );
    for (const row of r.rows) {
      if (!row.ingredient_rxcui) continue; // cached NULL = tried and unmappable: still not normalised
      normalized.set(`${row.input_text}|${row.input_system}|${row.input_code}`, {
        ingredientRxcui: row.ingredient_rxcui,
        ingredientName: row.ingredient_name ?? row.input_text,
        atcClasses: row.atc_classes ?? [],
      });
    }
  }

  const rxcuis = [...new Set([...normalized.values()].map((n) => n.ingredientRxcui))];
  const pairs = new Map<string, InteractionResult>();
  if (rxcuis.length > 1) {
    const r = await db.query(
      `SELECT rxcui_a, rxcui_b, severity, mechanism, clinical_advice
         FROM drug_interactions
        WHERE rxcui_a = ANY($1::text[]) AND rxcui_b = ANY($1::text[])`,
      [rxcuis],
    );
    for (const row of r.rows) {
      pairs.set(pairKey(row.rxcui_a, row.rxcui_b), {
        severity: row.severity as DdiSeverity,
        mechanism: row.mechanism,
        clinicalAdvice: row.clinical_advice,
        matchType: 'PAIR',
        matchedClasses: null,
      });
    }
  }

  // ponytail: whole table — a small curated rule set. Filter by ATC prefix in SQL if it grows.
  const cr = await db.query(
    `SELECT atc_class_a, atc_class_b, severity, mechanism, clinical_advice FROM drug_class_interactions`,
  );
  const classRules: ClassRule[] = cr.rows.map((row) => ({
    atcClassA: row.atc_class_a,
    atcClassB: row.atc_class_b,
    severity: row.severity as DdiSeverity,
    mechanism: row.mechanism,
    clinicalAdvice: row.clinical_advice,
  }));

  const allergyMappings = await fetchAllergyMappings(
    db as Pool,
    universe.allergySnomedCodes.map((snomedCode) => ({ snomedCode })),
  );

  return { normalized, pairs, classRules, allergyMappings };
}

export function normalizedFor(ref: SafetyReference, input: MedicationInput): NormalizedMedication | null {
  return ref.normalized.get(normalizedKey(input)) ?? null;
}

/** Same rules as `checkDrugDrugInteraction`: pair first; else the most severe class rule, either orientation. */
export function interactionBetween(
  ref: SafetyReference,
  a: { rxcui: string; atcClasses: string[] },
  b: { rxcui: string; atcClasses: string[] },
): InteractionResult | null {
  if (a.rxcui === b.rxcui) return null;
  const pair = ref.pairs.get(pairKey(a.rxcui, b.rxcui));
  if (pair) return pair;
  if (a.atcClasses.length === 0 || b.atcClasses.length === 0) return null;

  const has = (codes: string[], cls: string) => codes.some((c) => c.startsWith(cls));
  let best: ClassRule | null = null;
  for (const rule of ref.classRules) {
    const fires =
      (has(a.atcClasses, rule.atcClassA) && has(b.atcClasses, rule.atcClassB)) ||
      (has(a.atcClasses, rule.atcClassB) && has(b.atcClasses, rule.atcClassA));
    if (fires && (!best || SEVERITY_RANK[rule.severity] < SEVERITY_RANK[best.severity])) best = rule;
  }
  if (!best) return null;
  return {
    severity: best.severity,
    mechanism: best.mechanism,
    clinicalAdvice: best.clinicalAdvice,
    matchType: 'CLASS',
    matchedClasses: { atcClassA: best.atcClassA, atcClassB: best.atcClassB },
  };
}
