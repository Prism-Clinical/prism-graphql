/**
 * Anemia in pregnancy — the oral-iron response check as two nested compound
 * gates (Josh's rule):
 *
 *   responding    = Hgb rise ≥ 1 g/dL since oral iron started
 *                   OR Hgb at target, target ≥ 11 g/dL in trimesters 1/3 and
 *                   ≥ 10.5 g/dL in trimester 2
 *   nonresponding = the exact complement
 *
 * `nonresponding` is the leaf-wise De Morgan negation of `responding`, not a
 * re-derivation: every leaf is replaced by its exact complement (`at_least` ↔
 * `less_than` on one delta threshold, `greater_than` ↔ `less_than` on one Hgb
 * threshold, trimester {1,3} ↔ {2}) and every AND ↔ OR. Negation commutes with
 * the three-valued (Kleene) connectives, so the two gates are complements in
 * every state, including an unknown trimester — both decided with exactly one
 * open, or both unresolved together.
 *
 * Coded lab conditions compare strictly, so "≥ 11" is `greater_than 10.95`
 * and "< 11" is `less_than 10.95` — the midpoint between two 0.1 g/dL steps,
 * exact at the precision Hgb is reported to. `patient.trimester` (derived from
 * `gestational_age_weeks` at 14/28 weeks when only GA is known) keeps each arm
 * one leaf, where GA would need a nested range per arm.
 */

export const ORAL_IRON_WINDOW = {
  event: 'medication_start',
  clinical_role: 'oral-iron-repletion',
  label: 'oral iron',
  codes: [
    { system: 'RXNORM', code: '310325' },
    { system: 'RXNORM', code: '198630' },
    { system: 'RXNORM', code: '284202' },
  ],
  baseline_days: 28,
  min_days_since_anchor: 14,
};

const delta = (comparison: 'at_least' | 'less_than') => ({
  field: 'labs', operator: 'delta_from_baseline', value: '718-7', system: 'LOINC',
  display: 'Hemoglobin (g/dL)', delta_threshold: 1.0, delta_comparison: comparison, min_points: 2,
  window_from: ORAL_IRON_WINDOW,
});

const hgb = (operator: 'greater_than' | 'less_than', threshold: number) => ({
  field: 'labs', operator, value: '718-7', system: 'LOINC',
  display: 'Hemoglobin (g/dL)', threshold, horizon: { days: 28 },
});

const TRIMESTER_1_OR_3 = { attribute: 'patient.trimester', operator: 'in', value: [1, 3] };
const TRIMESTER_2 = { attribute: 'patient.trimester', operator: 'equals', value: 2 };

export const RESPONDING_GATE = {
  title: 'Responding to oral iron (Hgb +≥1 g/dL since start, or at trimester target)',
  gate_type: 'compound',
  default_behavior: 'skip',
  on_unresolved: 'ask',
  operator: 'OR',
  conditions: [
    delta('at_least'),
    { operator: 'AND', display: 'At target, trimester 1 or 3 (Hgb ≥ 11)', conditions: [TRIMESTER_1_OR_3, hgb('greater_than', 10.95)] },
    { operator: 'AND', display: 'At target, trimester 2 (Hgb ≥ 10.5)', conditions: [TRIMESTER_2, hgb('greater_than', 10.45)] },
  ],
};

export const NONRESPONDING_GATE = {
  title: 'Not responding to oral iron (Hgb +<1 g/dL since start, and below trimester target)',
  gate_type: 'compound',
  default_behavior: 'skip',
  on_unresolved: 'ask',
  operator: 'AND',
  conditions: [
    delta('less_than'),
    { operator: 'OR', display: 'Not at target unless trimester 2 (Hgb < 11)', conditions: [TRIMESTER_2, hgb('less_than', 10.95)] },
    { operator: 'OR', display: 'Not at target unless trimester 1/3 (Hgb < 10.5)', conditions: [TRIMESTER_1_OR_3, hgb('less_than', 10.45)] },
  ],
};

/**
 * The same rule with the at-target arm reordered — `OR(Hgb ≥ 11, AND(T2,
 * Hgb ≥ 10.5))` — and its De Morgan complement. Equivalent to the gates above
 * whenever the trimester is known; with it unknown, it never asks for the
 * trimester unless Hgb is in [10.5, 11), the only band where the trimester
 * decides. Not the shipped shape: offered for Josh to choose.
 */
export const RESPONDING_GATE_REORDERED = {
  ...RESPONDING_GATE,
  conditions: [
    delta('at_least'),
    hgb('greater_than', 10.95),
    { operator: 'AND', conditions: [TRIMESTER_2, hgb('greater_than', 10.45)] },
  ],
};

export const NONRESPONDING_GATE_REORDERED = {
  ...NONRESPONDING_GATE,
  conditions: [
    delta('less_than'),
    hgb('less_than', 10.95),
    { operator: 'OR', conditions: [TRIMESTER_1_OR_3, hgb('less_than', 10.45)] },
  ],
};
