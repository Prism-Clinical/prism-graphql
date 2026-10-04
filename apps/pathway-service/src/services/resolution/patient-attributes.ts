type Primitive = number | string | boolean;

function isPrimitive(v: unknown): v is Primitive {
  return typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean';
}

/** Trimester from gestational age in weeks: 1 (<14), 2 (14–27), 3 (>=28). */
function trimesterFromWeeks(weeks: number): number {
  if (weeks < 14) return 1;
  if (weeks < 28) return 2;
  return 3;
}

// ─── Rh type, read tolerantly ─────────────────────────────────────────
//
// Josh, 2026-10-04: "Accept common spellings". A pathway compares
// `patient.rh_factor` as an exact string (`not_equals "positive"` flags
// anything not clearly positive), so a chart that writes "Rh+", "POS" or
// "Positive" flagged every patient. The value is normalised to ONE vocabulary
// wherever patient attributes enter an evaluation — the chart, a typed answer,
// a remembered answer — and pathways compare against the canonical words.

/** What a pathway compares `patient.rh_factor` against. */
export const RH_FACTOR_VALUES = ['positive', 'negative', 'weak D', 'partial D'] as const;
export type RhFactor = (typeof RH_FACTOR_VALUES)[number];

/**
 * Every spelling read as each canonical value, in the KEY form `rhFactorKey`
 * produces (lower case; spaces, brackets, dots and joining hyphens removed —
 * so "Rh(D) Positive", "rh d positive" and "RH-D-POSITIVE" are all
 * `rhdpositive`). A trailing "+" or "-" is kept: it is the sign.
 *
 * Weak D and partial D are their own values, never folded into positive: both
 * are managed as Rh-negative for Rh immune globulin until genotyped, which is
 * exactly the patient a "not clearly positive" flag exists to catch.
 */
export const RH_FACTOR_SPELLINGS: Readonly<Record<RhFactor, readonly string[]>> = Object.freeze({
  positive: [
    'positive', 'pos', '+', 'rh+', 'rhpositive', 'rhpos',
    'rhd+', 'rhdpositive', 'rhdpos', 'd+', 'dpositive', 'dpos', 'rhesuspositive',
  ],
  negative: [
    'negative', 'neg', '-', 'rh-', 'rhnegative', 'rhneg',
    'rhd-', 'rhdnegative', 'rhdneg', 'd-', 'dnegative', 'dneg', 'rhesusnegative',
  ],
  'weak D': ['weakd', 'du', 'weakpositive', 'weaklypositive', 'weak', 'weakdpositive'],
  'partial D': ['partiald'],
});

const RH_BY_KEY: ReadonlyMap<string, RhFactor> = new Map(
  (Object.entries(RH_FACTOR_SPELLINGS) as Array<[RhFactor, readonly string[]]>).flatMap(
    ([canonical, spellings]) => spellings.map((s) => [s, canonical] as [string, RhFactor]),
  ),
);

/** The comparison key for an Rh spelling: case, spacing and punctuation removed; the sign kept. */
export function rhFactorKey(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[\u2212\u2013\u2014]/g, '-') // typographic minus / dashes
    .replace(/[\s().,_:]/g, '')
    // A hyphen JOINING two words ("rh-positive") is punctuation; one at the
    // end ("rh-") or alone is the sign.
    .replace(/-(?=[a-z])/g, '');
}

/**
 * The canonical Rh value for a chart spelling, or the value AS WRITTEN when it
 * is not one of the recognised spellings.
 *
 * Unrecognised is deliberately left alone, not mapped to "unknown": a pathway
 * that flags "anything not clearly positive" then still flags it, and the
 * provider sees the chart's own words. Guessing is the one thing this must
 * not do — reading "O neg" as positive would withhold Rh immune globulin.
 * Idempotent: a canonical value normalises to itself.
 */
export function normalizeRhFactor(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  return RH_BY_KEY.get(rhFactorKey(value)) ?? value;
}

/**
 * Why an authored `patient.rh_factor` comparand can never match, or `null`.
 *
 * The chart value is normalised before a gate compares it, and the comparison
 * is exact — so a comparand written "Positive" or "Rh+" is a recognised
 * spelling that no normalised value will ever equal. Refused at import, where
 * the author can fix it, instead of flagging (or missing) every patient.
 */
export function rhFactorComparandError(value: unknown): string | null {
  for (const v of Array.isArray(value) ? value : [value]) {
    const canonical = normalizeRhFactor(v);
    if (canonical !== v) {
      return (
        `patient.rh_factor is compared exactly against the normalised chart value, so ` +
        `${JSON.stringify(v)} can never match — write ${JSON.stringify(canonical)} ` +
        `(canonical values: ${RH_FACTOR_VALUES.join(', ')})`
      );
    }
  }
  return null;
}

/**
 * Per-attribute value normalisers, keyed by the `patient.*` attribute name.
 * Deliberately tiny: one entry. An attribute belongs here only when charts
 * genuinely spell one clinical value many ways AND pathways compare it exactly.
 */
export const PATIENT_ATTRIBUTE_NORMALIZERS: Readonly<Record<string, (value: unknown) => unknown>> = Object.freeze({
  rh_factor: normalizeRhFactor,
});

/** Apply the value normalisers to a bag of patient attributes. Idempotent; other keys untouched. */
export function normalizeAttributeValues<T extends Record<string, unknown>>(attributes: T): T {
  let out: Record<string, unknown> | null = null;
  for (const [name, normalize] of Object.entries(PATIENT_ATTRIBUTE_NORMALIZERS)) {
    if (!Object.prototype.hasOwnProperty.call(attributes, name)) continue;
    const next = normalize(attributes[name]);
    if (next !== attributes[name]) (out ??= { ...attributes })[name] = next;
  }
  return (out ?? attributes) as T;
}

export function normalizePatientAttributes(raw: unknown): Record<string, Primitive> | undefined {
  if (raw == null || typeof raw !== 'object') return undefined;
  const out: Record<string, Primitive> = {};
  for (const [k, v] of Object.entries(normalizeAttributeValues(raw as Record<string, unknown>))) {
    if (isPrimitive(v)) out[k] = v;
  }
  const ga = out.gestational_age_weeks;
  if (typeof ga === 'number' && Number.isFinite(ga) && out.trimester === undefined) {
    out.trimester = trimesterFromWeeks(ga);
  }
  return Object.keys(out).length > 0 ? out : undefined;
}
