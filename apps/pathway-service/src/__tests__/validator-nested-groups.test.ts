/**
 * Import validation of nested condition groups in compound gates.
 *
 * A group is `{ operator, conditions, display?, note? }`. Its leaves are held
 * to exactly the rules a top-level condition is (the same runtime parsers);
 * the group itself must be non-empty, AND/OR, inside a compound's
 * `conditions`, and at most MAX_CONDITION_NESTING (4) levels of AND/OR deep
 * counting the gate's own operator.
 */

import { validatePathwayJson } from '../services/import/validator';
import { clonePathway } from './fixtures/reference-pathway';
import { MAX_CONDITION_NESTING } from '../services/resolution/types';
import { RESPONDING_GATE, NONRESPONDING_GATE } from './fixtures/anemia-nested-response-gates';

const HAS_DM = { field: 'conditions', operator: 'includes_code', value: 'E11.9', system: 'ICD-10' };
const LOW_HGB = {
  field: 'labs', operator: 'less_than', value: '718-7', system: 'LOINC', threshold: 11, horizon: { days: 28 },
};

function withGate(props: Record<string, unknown>) {
  const pw = clonePathway();
  pw.nodes.push({ id: 'gate-x', type: 'Gate' as any, properties: { title: 'X', default_behavior: 'skip', ...props } });
  pw.edges.push({ from: 'step-1-1', to: 'gate-x', type: 'HAS_GATE' as any });
  pw.edges.push({ from: 'gate-x', to: 'step-1-2', type: 'BRANCHES_TO' as any });
  return validatePathwayJson(pw);
}

const compound = (conditions: unknown[], operator = 'OR') =>
  withGate({ gate_type: 'compound', operator, on_unresolved: 'ask', conditions });

/** A chain of `levels` nested AND groups ending in one leaf. */
function nestedTo(levels: number): unknown {
  let entry: unknown = HAS_DM;
  for (let i = 0; i < levels; i++) entry = { operator: 'AND', conditions: [entry] };
  return entry;
}

describe('nested condition groups — accepted', () => {
  it('AND inside OR, OR inside AND, mixed leaf kinds', () => {
    const r = compound([
      HAS_DM,
      { operator: 'AND', display: 'both', note: 'n', conditions: [LOW_HGB, { attribute: 'patient.trimester', operator: 'equals', value: 2 }] },
      { operator: 'or', conditions: [HAS_DM, { operator: 'And', conditions: [HAS_DM, LOW_HGB] }] },
    ]);
    expect(r.errors).toEqual([]);
    expect(r.valid).toBe(true);
  });

  it(`up to ${MAX_CONDITION_NESTING} levels counting the gate — 3 groups deep`, () => {
    expect(compound([nestedTo(MAX_CONDITION_NESTING - 1)]).errors).toEqual([]);
  });

  it('the anemia response gates import cleanly', () => {
    const pw = clonePathway();
    for (const [id, props] of [['gate-resp', RESPONDING_GATE], ['gate-nonresp', NONRESPONDING_GATE]] as const) {
      pw.nodes.push({ id, type: 'Gate' as any, properties: JSON.parse(JSON.stringify(props)) });
      pw.edges.push({ from: 'step-1-1', to: id, type: 'HAS_GATE' as any });
    }
    pw.edges.push({ from: 'gate-resp', to: 'step-1-2', type: 'BRANCHES_TO' as any });
    pw.edges.push({ from: 'gate-nonresp', to: 'step-2-1', type: 'BRANCHES_TO' as any });
    const r = validatePathwayJson(pw);
    expect(r.errors).toEqual([]);
    expect(r.valid).toBe(true);
    // The nested anchored delta is still seen by the window_from advice: this
    // fixture pathway has no oral-iron Medication node. Top-level position.
    expect(r.warnings).toContainEqual(expect.stringContaining(
      'Gate "gate-resp" condition[0].window_from: no Medication node in this pathway has clinical_role "oral-iron-repletion"',
    ));
  });
});

describe('nested condition groups — refused', () => {
  it(`deeper than ${MAX_CONDITION_NESTING} levels`, () => {
    const r = compound([nestedTo(MAX_CONDITION_NESTING)]);
    expect(r.valid).toBe(false);
    expect(r.errors).toEqual([
      expect.stringContaining(
        `Gate "gate-x" condition[0].conditions[0].conditions[0].conditions[0]: condition groups nest at most ` +
          `${MAX_CONDITION_NESTING} levels of AND/OR deep, counting the gate's own operator — this group would be level 5`,
      ),
    ]);
  });

  it('an empty group — hard, even in draft', () => {
    const pw = clonePathway();
    pw.nodes.push({
      id: 'gate-x', type: 'Gate' as any,
      properties: { title: 'X', default_behavior: 'skip', gate_type: 'compound', operator: 'OR', conditions: [HAS_DM, { operator: 'AND', conditions: [] }] },
    });
    pw.edges.push({ from: 'step-1-1', to: 'gate-x', type: 'HAS_GATE' as any });
    for (const draftMode of [false, true]) {
      const r = validatePathwayJson(pw, { draftMode } as never);
      expect(r.errors).toContainEqual(
        'Gate "gate-x" condition[1]: condition group has no conditions — an empty group cannot be evaluated.',
      );
    }
  });

  it('a missing or unknown group operator', () => {
    expect(compound([{ conditions: [HAS_DM] }]).errors).toEqual([
      'Gate "gate-x" condition[0]: condition group requires an "operator" (AND or OR).',
    ]);
    expect(compound([{ operator: 'XOR', conditions: [HAS_DM] }]).errors).toEqual([
      'Gate "gate-x" condition[0]: condition group operator "XOR" is not one of AND, OR.',
    ]);
  });

  it('a group that is also a condition, and an unknown key', () => {
    const r = compound([{ operator: 'AND', conditions: [HAS_DM], field: 'labs', weight: 2 }]);
    expect(r.errors).toEqual([
      expect.stringContaining('Gate "gate-x" condition[0]: a condition group ("conditions" array) cannot also be a condition'),
      'Gate "gate-x" condition[0]: unknown key "weight" on condition group.',
    ]);
  });

  it('a group as a patient_attribute gate\'s single `condition`', () => {
    const r = withGate({ gate_type: 'patient_attribute', on_unresolved: 'ask', condition: { operator: 'AND', conditions: [HAS_DM] } });
    expect(r.errors).toEqual([
      expect.stringContaining('Gate "gate-x" condition[0]: a condition group is only allowed inside a compound gate\'s "conditions"'),
    ]);
  });

  it('nested leaves are held to the top-level rules, with their path', () => {
    const r = compound([
      HAS_DM,
      { operator: 'AND', conditions: [
        HAS_DM,
        { operator: 'OR', conditions: [
          { field: 'labs', operator: 'bigger_than', value: '718-7', system: 'LOINC' },
          { field: 'conditions', operator: 'includes_code', value: 'G82.2*', system: 'ICD-10' },
          { ...LOW_HGB, horizon: 'FOREVER' },
          { attribute: 'nonsense.x', operator: 'equals', value: 1 },
        ] },
      ] },
    ]);
    const at = 'Gate "gate-x" condition[1].conditions[1].conditions';
    expect(r.errors).toEqual(expect.arrayContaining([
      `${at}[0]: operator "bigger_than" is not a valid coded operator.`,
      expect.stringMatching(new RegExp(`^${at.replace(/[[\]().]/g, '\\$&')}\\[1\\]: code pattern "G82\\.2\\*"`)),
      expect.stringMatching(new RegExp(`^${at.replace(/[[\]().]/g, '\\$&')}\\[2\\]: .*horizon`)),
      `${at}[3]: attribute namespace "nonsense" is not registered.`,
    ]));
    expect(r.errors).toHaveLength(4);
  });

  it('a nested window_from gets the runtime parser\'s errors and the import advice, at its path', () => {
    const bad = compound([
      { operator: 'AND', conditions: [
        HAS_DM,
        { field: 'labs', operator: 'delta_from_baseline', value: '718-7', system: 'LOINC', delta_threshold: 1,
          window_from: { event: 'medication_start', clinical_role: 'oral-iron-repletion', min_days_since_anchor: 0 } },
      ] },
    ]);
    expect(bad.errors).toEqual([
      expect.stringMatching(/^Gate "gate-x" condition\[0\]\.conditions\[1\]: .*min_days_since_anchor/),
    ]);
    const noCodes = compound([
      { operator: 'AND', conditions: [
        HAS_DM,
        { field: 'labs', operator: 'delta_from_baseline', value: '718-7', system: 'LOINC', delta_threshold: 1,
          window_from: { event: 'medication_start', clinical_role: 'oral-iron-repletion' } },
      ] },
    ]);
    expect(noCodes.errors).toEqual([]);
    expect(noCodes.warnings).toContainEqual(
      expect.stringMatching(/^Gate "gate-x" condition\[0\]\.conditions\[1\]\.window_from: no "codes"/),
    );
  });

  it('flat conditions keep their existing messages byte-for-byte', () => {
    const r = compound([HAS_DM, { field: 'labs', operator: 'bigger_than', value: '718-7', system: 'LOINC' }]);
    expect(r.errors).toEqual(['Gate "gate-x" condition[1]: operator "bigger_than" is not a valid coded operator.']);
  });
});
