/**
 * Plan 04 Task 7 — clinical attribute conditions on the `selectFacts` kernel (D3).
 *
 * `lab.*`, `vitals.*` and `allergy.*` stop reading `patientContext` under `v1`
 * and read the normalized `factStore` instead. `patient.*` is demographics —
 * no `FactKind`, no interval, no clinical state — and stays on
 * `resolveAttribute` forever.
 *
 * **Selection is chosen by NAMESPACE, never by the operator.** An attribute
 * `exists` must not reach the kernel's `exists` operator, which ignores code and
 * system by design (`select-facts.ts:106`); and an attribute `equals` on a lab
 * must not reach the kernel's membership `equals`, which would hand back every
 * matching lab in array order instead of the definite latest. Both traps are
 * pinned below.
 *
 * **These proofs live at the unit level deliberately.** `deps.factStore` is `[]`
 * at every resolver until Task 9 wires the assembler, so a traversal-level or
 * end-to-end `v1` test could not exercise this task at all and would pass no
 * matter what it did (P1-16). The store is built directly and handed to
 * `evaluateGate`.
 *
 * Every disclosed delta asserts BOTH versions against the same clinical reality,
 * expressed twice — as `patientContext` (what `legacy-v0` reads) and as
 * `factStore` (what `v1` reads). Asserting only the new behavior would let the
 * baseline drift unnoticed, and locked decision #2 requires each delta pinned.
 */

// Importing the real resolution-context pulls in the Query resolver at module
// load; the anchor-sweep suites mock it the same way.
jest.mock('../../resolvers/Query', () => ({
  hydrateSignalDefinition: (row: unknown) => row,
}));

import { evaluateGate } from '../../services/resolution/gate-evaluator';
import type { GateEvaluationDeps } from '../../services/resolution/gate-evaluator';
import {
  GateProperties,
  GateAnswer,
  NodeResult,
  GateType,
  DefaultBehavior,
  GateCondition,
  AttributeCondition,
  AttributeCodeMap,
} from '../../services/resolution/types';
import { makeEvaluationTemporalContext } from '../../services/resolution/temporal/evaluation-context';
import { VITALS_SYSTEM } from '../../services/resolution/temporal/context-assembler';
import { adaptAttributeCondition } from '../../services/resolution/temporal/condition-adapter';
import { effectivePolicyFor } from '../../services/resolution/temporal/gate-policy';
import {
  resolveEffectivePolicy,
  toEffectivePolicy,
} from '../../services/resolution/temporal/cascade';
import { sweepableConditions } from '../../resolvers/helpers/resolution-context';
import type { NormalizedFact } from '../../services/resolution/temporal/fact-model';
import type { PatientContext, GraphNode } from '../../services/confidence/types';

const AS_OF = '2026-08-11T00:00:00.000Z';
const ENCOUNTER_START = '2026-08-10T08:00:00.000Z';
// v1's lab horizon is QUARTER = 90 days, so the boundary sits at 2026-05-13.
const NEWER_IN_QUARTER = '2026-07-01';
const OLDER_IN_QUARTER = '2026-06-01';
// 200 days back: inside YEAR, outside QUARTER.
const OUTSIDE_QUARTER = '2026-01-23';

const A1C_CODE = '4548-4';
const PENICILLIN_CODE = '7980';

const CODE_MAP: AttributeCodeMap = new Map([
  [
    'lab.a1c',
    {
      attributeName: 'lab.a1c',
      namespace: 'lab',
      system: 'LOINC',
      code: A1C_CODE,
      valueType: 'number' as const,
    },
  ],
  [
    'allergy.penicillin',
    {
      attributeName: 'allergy.penicillin',
      namespace: 'allergy',
      system: 'RXNORM',
      code: PENICILLIN_CODE,
      valueType: 'boolean' as const,
    },
  ],
]);

// ─── Fixture builders ─────────────────────────────────────────────────

function labFact(
  factId: string,
  code: string,
  day: string,
  value: number,
  overrides: Partial<NormalizedFact> = {},
): NormalizedFact {
  return {
    kind: 'lab',
    factId,
    code,
    system: 'LOINC',
    value,
    unit: '%',
    observationStatus: 'final',
    interval: {
      start: { value: day, precision: 'day' },
      end: { kind: 'KNOWN', bound: { value: day, precision: 'day' } },
    },
    recordValidity: 'VALID',
    validityBasis: 'observation:final',
    provenance: { sourceType: 'SYNTHETIC' },
    ...overrides,
  } as NormalizedFact;
}

/**
 * An allergy exactly as `assembleStateful` builds one: still-active, so
 * `end: OPEN(evaluationAsOf)`.
 */
function allergyFact(
  factId: string,
  code: string,
  overrides: Partial<NormalizedFact> = {},
): NormalizedFact {
  return {
    kind: 'allergy',
    factId,
    code,
    system: 'RXNORM',
    clinicalState: 'ACTIVE',
    stateBasis: 'SNAPSHOT_ASSERTION',
    interval: { end: { kind: 'OPEN', assertedCurrentAt: AS_OF } },
    recordValidity: 'VALID',
    validityBasis: 'SYNTHETIC_DEFAULT',
    provenance: { sourceType: 'SYNTHETIC' },
    ...overrides,
  } as NormalizedFact;
}

/**
 * A vital exactly as the assembler builds one: no `start` at all, end
 * `OPEN(evaluationAsOf)` — `PatientContext.vitalSigns` carries no dates
 * anywhere. `code` is the FLATTENED dotted path (context-assembler.ts:268),
 * which is what makes `vitals.custom.pain_score` resolvable with no codeMap row.
 */
function undatedVital(factId: string, code: string, value: number): NormalizedFact {
  return {
    kind: 'vital',
    factId,
    code,
    system: VITALS_SYSTEM,
    value,
    interval: { end: { kind: 'OPEN', assertedCurrentAt: AS_OF } },
    recordValidity: 'VALID',
    validityBasis: 'SYNTHETIC_DEFAULT',
    provenance: { sourceType: 'SYNTHETIC' },
  } as NormalizedFact;
}

function datedVital(factId: string, code: string, at: string, value: number): NormalizedFact {
  return {
    kind: 'vital',
    factId,
    code,
    system: VITALS_SYSTEM,
    value,
    interval: {
      start: { value: at, precision: 'instant' },
      end: { kind: 'KNOWN', bound: { value: at, precision: 'instant' } },
    },
    recordValidity: 'VALID',
    validityBasis: 'observation:final',
    provenance: { sourceType: 'SYNTHETIC' },
  } as NormalizedFact;
}

function patient(overrides: Partial<PatientContext> = {}): PatientContext {
  return {
    patientId: 'p',
    conditionCodes: [],
    medications: [],
    labResults: [],
    allergies: [],
    ...overrides,
  };
}

function gateFor(condition: GateCondition): GateProperties {
  return {
    title: 'attribute gate',
    gate_type: GateType.PATIENT_ATTRIBUTE,
    default_behavior: DefaultBehavior.SKIP,
    condition,
  };
}

function deps(version: string, overrides: Partial<GateEvaluationDeps> = {}): GateEvaluationDeps {
  return {
    temporalContext: makeEvaluationTemporalContext({
      evaluationAsOf: AS_OF,
      encounterStart: ENCOUNTER_START,
      temporalPolicyVersion: version,
    }),
    pathwayDefaults: {},
    factStore: [],
    patientContext: patient(),
    resolutionState: new Map<string, NodeResult>(),
    gateAnswers: new Map<string, GateAnswer>(),
    codeMap: CODE_MAP,
    ...overrides,
  };
}

// ─── Namespace, not operator, chooses the selection (D3, P1-3) ────────

describe('namespace determines selection, not the operator (P1-3)', () => {
  it('selects a lab by EXACT mapped code, not by any-lab existence', async () => {
    // The kernel's own `exists` operator ignores code AND system, so routing an
    // attribute `exists` to it would match the unrelated lab below.
    const gate = gateFor({ attribute: 'lab.a1c', operator: 'exists', value: '' });
    const r = await evaluateGate(
      gate,
      deps('v1', { factStore: [labFact('l1', '718-7', NEWER_IN_QUARTER, 12)] }),
    );
    expect(r.satisfied).toBe(false);
    expect(r.reason).toBe('attribute is absent');
  });

  it('is satisfied by an exists on the mapped code itself', async () => {
    const gate = gateFor({ attribute: 'lab.a1c', operator: 'exists', value: '' });
    const r = await evaluateGate(
      gate,
      deps('v1', { factStore: [labFact('l1', A1C_CODE, NEWER_IN_QUARTER, 9.2)] }),
    );
    expect(r.satisfied).toBe(true);
    expect(r.reason).toBe('attribute is present');
  });

  it('selects an allergy by exact code as MEMBERSHIP, then derives a boolean', async () => {
    // Allergies are StatefulFacts with no numeric value; a scalar selection
    // would reject every candidate via hasFiniteValue (select-facts.ts:50).
    const gate = gateFor({ attribute: 'allergy.penicillin', operator: 'equals', value: true });
    const r = await evaluateGate(
      gate,
      deps('v1', { factStore: [allergyFact('a1', PENICILLIN_CODE)] }),
    );
    expect(r.satisfied).toBe(true);
    expect(r.reason).toBe('true == true');
    expect(r.contextFieldsRead).toEqual(['allergy.penicillin']);
  });

  it('selects a vital by dotted path, with no codeMap row', async () => {
    const gate = gateFor({
      attribute: 'vitals.systolic_bp',
      operator: 'greater_than',
      value: 140,
    });
    const r = await evaluateGate(
      gate,
      deps('v1', { factStore: [undatedVital('v1f', 'systolic_bp', 148)] }),
    );
    expect(r.satisfied).toBe(true);
    expect(r.reason).toBe('148 greater_than 140 → true');
    expect(r.contextFieldsRead).toEqual(['vitals.systolic_bp']);
  });

  it('resolves a nested custom vital path', async () => {
    const gate = gateFor({
      attribute: 'vitals.custom.pain_score',
      operator: 'greater_or_equal',
      value: 7,
    });
    const r = await evaluateGate(
      gate,
      deps('v1', { factStore: [undatedVital('v1f', 'custom.pain_score', 7)] }),
    );
    expect(r.satisfied).toBe(true);
  });

  it('leaves patient.* on resolveAttribute', async () => {
    // Demographics have no FactKind, so the kernel must never see them — and
    // the absence of the two D5 keys is the proof: only the kernel sets them.
    const gate = gateFor({ attribute: 'patient.age', operator: 'greater_than', value: 60 });
    const r = await evaluateGate(
      gate,
      deps('v1', {
        patientContext: patient({ patientAttributes: { age: 65 } }),
        factStore: [],
      }),
    );
    expect(r.satisfied).toBe(true);
    expect(r.reason).toBe('65 greater_than 60 → true');
    expect(r.indeterminate).toBeUndefined();
    expect(r.uncertainty).toBeUndefined();
  });

  it('an attribute equals on a lab still selects the LATEST value, not the first match', async () => {
    // The discriminator between scalar and membership selection. Under
    // membership the selection is EVERY matching lab and `selected[0]` is array
    // order — here the older 9.5. Under scalar it is the definite latest, 7.
    const gate = gateFor({ attribute: 'lab.a1c', operator: 'equals', value: 7 });
    const r = await evaluateGate(
      gate,
      deps('v1', {
        factStore: [
          labFact('l-old', A1C_CODE, OLDER_IN_QUARTER, 9.5),
          labFact('l-new', A1C_CODE, NEWER_IN_QUARTER, 7),
        ],
      }),
    );
    expect(r.satisfied).toBe(true);
    expect(r.reason).toBe('7 == 7');
  });
});

// ─── Every attribute operator, including those with no temporal twin ──

describe('attribute operators outside TemporalOperator still work', () => {
  // `not_equals`, `greater_or_equal`, `less_or_equal` and `in` have no
  // TemporalOperator equivalent; they are mapped to the nearest operator of the
  // SAME selection class for selection only, and the real comparison stays in
  // compareScalar. Every one of the eight is exercised — a sketch that names a
  // set and tests a subset is the defect rounds 8, 9 and 10 each found.
  const cases: Array<[AttributeCondition['operator'], AttributeCondition['value'], string]> = [
    ['equals', 9.2, '9.2 == 9.2'],
    ['not_equals', 9, '9.2 != 9'],
    ['greater_than', 9, '9.2 greater_than 9 → true'],
    ['greater_or_equal', 9.2, '9.2 greater_or_equal 9.2 → true'],
    ['less_than', 10, '9.2 less_than 10 → true'],
    ['less_or_equal', 9.2, '9.2 less_or_equal 9.2 → true'],
    ['in', [9.2, 5], '9.2 in [9.2, 5]'],
    ['exists', '', 'attribute is present'],
  ];

  for (const [operator, value, reason] of cases) {
    it(`applies ${operator} via compareScalar after kernel selection`, async () => {
      const gate = gateFor({ attribute: 'lab.a1c', operator, value });
      const shared = {
        patientContext: patient({
          labResults: [{ code: A1C_CODE, system: 'LOINC', value: 9.2, date: NEWER_IN_QUARTER }],
        }),
        factStore: [labFact('l1', A1C_CODE, NEWER_IN_QUARTER, 9.2)],
      };
      const legacy = await evaluateGate(gate, deps('legacy-v0', shared));
      const v1 = await evaluateGate(gate, deps('v1', shared));
      expect(legacy.satisfied).toBe(true);
      expect(v1.satisfied).toBe(true);
      // Where the outcome matches legacy's, the sentence must match too.
      expect(v1.reason).toBe(legacy.reason);
      expect(v1.reason).toBe(reason);
    });
  }

  it('reports the unsatisfied side of each comparison exactly as legacy does', async () => {
    const gate = gateFor({ attribute: 'lab.a1c', operator: 'less_than', value: 5 });
    const shared = {
      patientContext: patient({
        labResults: [{ code: A1C_CODE, system: 'LOINC', value: 9.2, date: NEWER_IN_QUARTER }],
      }),
      factStore: [labFact('l1', A1C_CODE, NEWER_IN_QUARTER, 9.2)],
    };
    const legacy = await evaluateGate(gate, deps('legacy-v0', shared));
    const v1 = await evaluateGate(gate, deps('v1', shared));
    expect(legacy.satisfied).toBe(false);
    expect(v1.satisfied).toBe(false);
    expect(v1.reason).toBe(legacy.reason);
    expect(v1.reason).toBe('9.2 less_than 5 → false');
  });
});

// ─── Absent targets ───────────────────────────────────────────────────

describe('absent target with an unrelated fact present', () => {
  it('is unsatisfied for a lab rather than matching the unrelated fact', async () => {
    const gate = gateFor({ attribute: 'lab.a1c', operator: 'greater_than', value: 9 });
    const r = await evaluateGate(
      gate,
      deps('v1', { factStore: [labFact('l1', '718-7', NEWER_IN_QUARTER, 12)] }),
    );
    expect(r.satisfied).toBe(false);
    expect(r.reason).toBe('attribute has no value');
    expect(r.indeterminate).toBe(false);
  });

  it('is unsatisfied for a vital rather than matching the unrelated fact', async () => {
    const gate = gateFor({ attribute: 'vitals.systolic_bp', operator: 'greater_than', value: 140 });
    const r = await evaluateGate(
      gate,
      deps('v1', { factStore: [undatedVital('v1f', 'heart_rate', 190)] }),
    );
    expect(r.satisfied).toBe(false);
    expect(r.reason).toBe('attribute has no value');
  });

  it('is unsatisfied for an allergy rather than matching the unrelated fact', async () => {
    const gate = gateFor({ attribute: 'allergy.penicillin', operator: 'equals', value: true });
    const r = await evaluateGate(
      gate,
      deps('v1', { factStore: [allergyFact('a1', '1191')] }),
    );
    expect(r.satisfied).toBe(false);
    // Membership derivation yields a BOOLEAN even when nothing matched, exactly
    // as legacy's `allergies.some(...)` does — never `undefined`.
    expect(r.reason).toBe('false != true');
  });

  it('is unsatisfied when the attribute has no codeMap row at all', async () => {
    // resolveAttribute returns undefined today; this must stay unsatisfied and
    // must not throw. Without a row there is no code to select on, so the
    // condition is not kernel-routable and falls back — which reads no clinical
    // data either, because resolveAttribute bails on the missing row first.
    const gate = gateFor({ attribute: 'lab.unmapped', operator: 'greater_than', value: 1 });
    const r = await evaluateGate(
      gate,
      deps('v1', { factStore: [labFact('l1', A1C_CODE, NEWER_IN_QUARTER, 9.2)] }),
    );
    expect(r.satisfied).toBe(false);
    expect(r.reason).toBe('attribute has no value');
  });

  it('is unsatisfied for an unmapped allergy rather than throwing', async () => {
    const gate = gateFor({ attribute: 'allergy.unmapped', operator: 'equals', value: true });
    const r = await evaluateGate(
      gate,
      deps('v1', { factStore: [allergyFact('a1', PENICILLIN_CODE)] }),
    );
    expect(r.satisfied).toBe(false);
  });

  it('is unsatisfied for an unrecognised namespace rather than throwing', async () => {
    const gate = gateFor({ attribute: 'astrology.rising_sign', operator: 'exists', value: '' });
    const r = await evaluateGate(gate, deps('v1'));
    expect(r.satisfied).toBe(false);
  });
});

// ─── The shared policy seam (P1-20) ───────────────────────────────────

describe('attribute policy flows through the shared seam (P1-20)', () => {
  const staleA1c = gateFor({ attribute: 'lab.a1c', operator: 'greater_than', value: 9 });
  const staleStore = { factStore: [labFact('l1', A1C_CODE, OUTSIDE_QUARTER, 9.5)] };

  it('lets a pathway default change an attribute gate’s decision', async () => {
    const underQuarter = await evaluateGate(staleA1c, deps('v1', staleStore));
    expect(underQuarter.satisfied).toBe(false);

    const underYear = await evaluateGate(
      staleA1c,
      deps('v1', { ...staleStore, pathwayDefaults: { horizons: { labs: 'YEAR' } } }),
    );
    expect(underYear.satisfied).toBe(true);
    expect(underYear.reason).toBe('9.5 greater_than 9 → true');
  });

  it('lets a NODE horizon on the attribute condition beat the pathway default', async () => {
    const gate = gateFor({
      attribute: 'lab.a1c',
      operator: 'greater_than',
      value: 9,
      horizon: 'QUARTER',
    } as AttributeCondition);
    const r = await evaluateGate(
      gate,
      deps('v1', { ...staleStore, pathwayDefaults: { horizons: { labs: 'YEAR' } } }),
    );
    expect(r.satisfied).toBe(false);
  });

  it('agrees with what the anchor preflight computed for the same condition', async () => {
    // The same condition through sweepableConditions and through
    // adaptAttributeCondition must resolve the same tier. If these can disagree,
    // locked decision #7 is violated and a gate throws mid-traversal.
    const vitalsAttrCondition: AttributeCondition = {
      attribute: 'vitals.systolic_bp',
      operator: 'greater_than',
      value: 140,
      horizon: 'YEAR',
    } as AttributeCondition;
    const node: GraphNode = {
      id: 'g-bp',
      nodeIdentifier: 'g-bp',
      nodeType: 'Gate',
      properties: {
        title: 'BP',
        gate_type: GateType.PATIENT_ATTRIBUTE,
        default_behavior: DefaultBehavior.SKIP,
        condition: vitalsAttrCondition,
      },
    };

    const swept = sweepableConditions([node], 'v1')[0];
    const adapted = adaptAttributeCondition(vitalsAttrCondition, CODE_MAP)!;
    expect(adapted.selection.field).toBe(swept.field);
    expect(adapted.override).toEqual(swept.override);

    // Stronger than field+override equality: the policies they RESOLVE to must
    // be identical, which is what "preflight and evaluation never disagree"
    // actually means.
    const ctx = makeEvaluationTemporalContext({
      evaluationAsOf: AS_OF,
      encounterStart: ENCOUNTER_START,
      temporalPolicyVersion: 'v1',
    });
    expect(effectivePolicyFor(adapted, ctx, {})).toEqual(
      toEffectivePolicy(resolveEffectivePolicy(swept.field, 'v1', {}, swept.override), ctx),
    );
  });

  it('agrees for a lab attribute with no override too', async () => {
    const cond: AttributeCondition = { attribute: 'lab.a1c', operator: 'greater_than', value: 9 };
    const node: GraphNode = {
      id: 'g-a1c',
      nodeIdentifier: 'g-a1c',
      nodeType: 'Gate',
      properties: {
        title: 'A1c',
        gate_type: GateType.PATIENT_ATTRIBUTE,
        default_behavior: DefaultBehavior.SKIP,
        condition: cond,
      },
    };
    const swept = sweepableConditions([node], 'v1')[0];
    const adapted = adaptAttributeCondition(cond, CODE_MAP)!;
    expect(swept.field).toBe('labs');
    expect(adapted.selection.field).toBe('labs');
    expect(adapted.override).toBeUndefined();
    expect(swept.override).toBeUndefined();
  });

  it('does not sweep patient.*, and the adapter refuses it too', () => {
    const cond: AttributeCondition = { attribute: 'patient.age', operator: 'greater_than', value: 60 };
    const node: GraphNode = {
      id: 'g-age',
      nodeIdentifier: 'g-age',
      nodeType: 'Gate',
      properties: {
        title: 'age',
        gate_type: GateType.PATIENT_ATTRIBUTE,
        default_behavior: DefaultBehavior.SKIP,
        condition: cond,
      },
    };
    expect(sweepableConditions([node], 'v1')).toEqual([]);
    expect(adaptAttributeCondition(cond, CODE_MAP)).toBeNull();
  });

  it('throws MISSING_ENCOUNTER_ANCHOR for a v1 vitals attribute with no encounterStart', async () => {
    // The v1 sweep now covers attribute conditions (P1-8), so such a session is
    // rejected up front. Reaching evaluation means preflight was skipped —
    // swallowing the throw into `satisfied: false` would hide that.
    const gate = gateFor({ attribute: 'vitals.systolic_bp', operator: 'greater_than', value: 140 });
    const noAnchor: GateEvaluationDeps = {
      ...deps('v1'),
      temporalContext: makeEvaluationTemporalContext({
        evaluationAsOf: AS_OF,
        temporalPolicyVersion: 'v1',
      }),
      factStore: [undatedVital('v1f', 'systolic_bp', 148)],
    };
    await expect(evaluateGate(gate, noAnchor)).rejects.toMatchObject({
      code: 'MISSING_ENCOUNTER_ANCHOR',
    });
  });

  it('propagates a malformed horizon on an attribute condition rather than deciding', async () => {
    const gate = gateFor({
      attribute: 'lab.a1c',
      operator: 'greater_than',
      value: 9,
      horizon: 'FORTNIGHT',
    } as AttributeCondition);
    await expect(evaluateGate(gate, deps('v1'))).rejects.toThrow(/FORTNIGHT/);
  });

  it('rejects a malformed horizon on an UNMAPPED attribute too, exactly as the sweep does', async () => {
    // The sweep has no codeMap: it parses the override of every
    // clinical-namespace attribute condition, mapped or not. If the adapter
    // resolved the code first and bailed, this pathway would be rejected at
    // session creation and silently ignored at evaluation — one condition,
    // two answers.
    const cond = {
      attribute: 'lab.unmapped',
      operator: 'greater_than',
      value: 9,
      horizon: 'FORTNIGHT',
    } as AttributeCondition;
    const node: GraphNode = {
      id: 'g-bad',
      nodeIdentifier: 'g-bad',
      nodeType: 'Gate',
      properties: {
        title: 'bad',
        gate_type: GateType.PATIENT_ATTRIBUTE,
        default_behavior: DefaultBehavior.SKIP,
        condition: cond,
      },
    };
    expect(() => sweepableConditions([node], 'v1')).toThrow(/FORTNIGHT/);
    await expect(evaluateGate(gateFor(cond), deps('v1'))).rejects.toThrow(/FORTNIGHT/);
  });

  it('ignores a malformed horizon on patient.* on BOTH sides', async () => {
    // The mirror case. `patient.*` resolves no horizon, so neither the sweep
    // nor the adapter ever parses one — and neither may start.
    const cond = {
      attribute: 'patient.age',
      operator: 'greater_than',
      value: 60,
      horizon: 'FORTNIGHT',
    } as AttributeCondition;
    const node: GraphNode = {
      id: 'g-age',
      nodeIdentifier: 'g-age',
      nodeType: 'Gate',
      properties: {
        title: 'age',
        gate_type: GateType.PATIENT_ATTRIBUTE,
        default_behavior: DefaultBehavior.SKIP,
        condition: cond,
      },
    };
    expect(sweepableConditions([node], 'v1')).toEqual([]);
    const r = await evaluateGate(
      gateFor(cond),
      deps('v1', { patientContext: patient({ patientAttributes: { age: 65 } }) }),
    );
    expect(r.satisfied).toBe(true);
  });
});

// ─── Disclosed v1 deltas ──────────────────────────────────────────────

describe('disclosed v1 deltas for attribute conditions', () => {
  const a1cGate = gateFor({ attribute: 'lab.a1c', operator: 'greater_than', value: 9 });

  it('drops a lab outside QUARTER that legacy-v0 admits under LIFETIME', async () => {
    const shared = {
      patientContext: patient({
        labResults: [{ code: A1C_CODE, system: 'LOINC', value: 9.5, date: OUTSIDE_QUARTER }],
      }),
      factStore: [labFact('l1', A1C_CODE, OUTSIDE_QUARTER, 9.5)],
    };
    expect((await evaluateGate(a1cGate, deps('legacy-v0', shared))).satisfied).toBe(true);
    const v1 = await evaluateGate(a1cGate, deps('v1', shared));
    expect(v1.satisfied).toBe(false);
    expect(v1.indeterminate).toBe(false);
  });

  it('compares the latest lab where legacy-v0 takes array order', async () => {
    // resolveAttribute uses `.find()` (attribute-registry.ts:34), so legacy
    // answers with whatever the snapshot listed first.
    const older = { code: A1C_CODE, system: 'LOINC', value: 9.5, date: OLDER_IN_QUARTER };
    const newer = { code: A1C_CODE, system: 'LOINC', value: 7, date: NEWER_IN_QUARTER };
    const shared = {
      patientContext: patient({ labResults: [older, newer] }),
      factStore: [
        labFact('l-old', A1C_CODE, OLDER_IN_QUARTER, 9.5),
        labFact('l-new', A1C_CODE, NEWER_IN_QUARTER, 7),
      ],
    };
    expect((await evaluateGate(a1cGate, deps('legacy-v0', shared))).satisfied).toBe(true);
    const v1 = await evaluateGate(a1cGate, deps('v1', shared));
    expect(v1.satisfied).toBe(false);
    expect(v1.reason).toBe('7 greater_than 9 → false');
  });

  it('drops a recordValidity INVALID lab that legacy-v0 compares', async () => {
    const shared = {
      patientContext: patient({
        labResults: [{ code: A1C_CODE, system: 'LOINC', value: 9.5, date: NEWER_IN_QUARTER }],
      }),
      factStore: [
        labFact('l1', A1C_CODE, NEWER_IN_QUARTER, 9.5, {
          recordValidity: 'INVALID',
          validityBasis: 'observation:entered-in-error',
        }),
      ],
    };
    expect((await evaluateGate(a1cGate, deps('legacy-v0', shared))).satisfied).toBe(true);
    expect((await evaluateGate(a1cGate, deps('v1', shared))).satisfied).toBe(false);
  });

  it('drops an INACTIVE allergy that legacy-v0 matches — v1 allergies are status:active', async () => {
    const gate = gateFor({ attribute: 'allergy.penicillin', operator: 'equals', value: true });
    const shared = {
      patientContext: patient({ allergies: [{ code: PENICILLIN_CODE, system: 'RXNORM' }] }),
      factStore: [
        allergyFact('a1', PENICILLIN_CODE, {
          clinicalState: 'INACTIVE',
          stateBasis: 'FHIR_STATUS',
        }),
      ],
    };
    // resolveAttribute's `allergies.some(...)` has no notion of clinical state.
    expect((await evaluateGate(gate, deps('legacy-v0', shared))).satisfied).toBe(true);
    expect((await evaluateGate(gate, deps('v1', shared))).satisfied).toBe(false);
  });

  it('drops a vital taken before the encounter began', async () => {
    const gate = gateFor({ attribute: 'vitals.systolic_bp', operator: 'greater_than', value: 140 });
    const shared = {
      patientContext: patient({ vitalSigns: { systolic_bp: 148 } }),
      factStore: [datedVital('v1f', 'systolic_bp', '2026-08-09T09:00:00.000Z', 148)],
    };
    expect((await evaluateGate(gate, deps('legacy-v0', shared))).satisfied).toBe(true);
    expect((await evaluateGate(gate, deps('v1', shared))).satisfied).toBe(false);
  });
});

// ─── D5: the two signals are independent ──────────────────────────────

describe('attribute conditions record uncertainty (D5)', () => {
  it('fails OPEN on an uncertain allergy and still records the doubt', async () => {
    const gate = gateFor({ attribute: 'allergy.penicillin', operator: 'equals', value: true });
    const r = await evaluateGate(
      gate,
      deps('v1', {
        factStore: [
          allergyFact('a1', PENICILLIN_CODE, {
            recordValidity: 'UNKNOWN',
            validityBasis: 'allergy:unconfirmed',
          }),
        ],
      }),
    );
    expect(r.satisfied).toBe(true);
    expect(r.indeterminate).toBe(false);
    expect(r.uncertainty).toContain('VALIDITY_UNKNOWN');
  });

  it('fails CLOSED on an uncertain lab and says so', async () => {
    const gate = gateFor({ attribute: 'lab.a1c', operator: 'greater_than', value: 9 });
    const r = await evaluateGate(
      gate,
      deps('v1', {
        factStore: [
          labFact('l1', A1C_CODE, NEWER_IN_QUARTER, 9.5, {
            recordValidity: 'UNKNOWN',
            validityBasis: 'observation:preliminary',
          }),
        ],
      }),
    );
    expect(r.satisfied).toBe(false);
    expect(r.indeterminate).toBe(true);
    expect(r.uncertainty).toContain('VALIDITY_UNKNOWN');
    // A fail-closed refusal must not read like an ordinary absent value.
    expect(r.reason).not.toBe('attribute has no value');
    expect(r.reason).toMatch(/VALIDITY_UNKNOWN/);
  });

  it('fails CLOSED when two lab results cannot be ordered', async () => {
    const gate = gateFor({ attribute: 'lab.a1c', operator: 'greater_than', value: 9 });
    const r = await evaluateGate(
      gate,
      deps('v1', {
        factStore: [
          labFact('l1', A1C_CODE, NEWER_IN_QUARTER, 9.5),
          labFact('l2', A1C_CODE, NEWER_IN_QUARTER, 7),
        ],
      }),
    );
    expect(r.satisfied).toBe(false);
    expect(r.indeterminate).toBe(true);
    expect(r.uncertainty).toContain('AMBIGUOUS_LATEST');
  });

  it('is neither indeterminate nor uncertain on a definite decision', async () => {
    const gate = gateFor({ attribute: 'lab.a1c', operator: 'greater_than', value: 9 });
    const r = await evaluateGate(
      gate,
      deps('v1', { factStore: [labFact('l1', A1C_CODE, NEWER_IN_QUARTER, 9.5)] }),
    );
    expect(r.satisfied).toBe(true);
    expect(r.indeterminate).toBe(false);
    expect(r.uncertainty).toEqual([]);
  });
});

// ─── legacy-v0 is untouched ───────────────────────────────────────────

describe('legacy-v0 attribute conditions read the patient context only', () => {
  const gate = gateFor({ attribute: 'lab.a1c', operator: 'greater_than', value: 9 });

  it('is unsatisfied when only the fact store carries the value', async () => {
    const r = await evaluateGate(
      gate,
      deps('legacy-v0', { factStore: [labFact('l1', A1C_CODE, NEWER_IN_QUARTER, 9.5)] }),
    );
    expect(r.satisfied).toBe(false);
  });

  it('records neither indeterminate nor uncertainty', async () => {
    const r = await evaluateGate(
      gate,
      deps('legacy-v0', {
        patientContext: patient({
          labResults: [{ code: A1C_CODE, system: 'LOINC', value: 9.5, date: NEWER_IN_QUARTER }],
        }),
      }),
    );
    expect(r.satisfied).toBe(true);
    expect(r.indeterminate).toBeUndefined();
    expect(r.uncertainty).toBeUndefined();
  });

  it('still resolves vitals with no encounterStart — legacy vitals are LIFETIME', async () => {
    const vitalsGate = gateFor({
      attribute: 'vitals.systolic_bp',
      operator: 'greater_than',
      value: 140,
    });
    const legacyNoAnchor: GateEvaluationDeps = {
      ...deps('legacy-v0'),
      temporalContext: makeEvaluationTemporalContext({
        evaluationAsOf: AS_OF,
        temporalPolicyVersion: 'legacy-v0',
      }),
      patientContext: patient({ vitalSigns: { systolic_bp: 148 } }),
    };
    const r = await evaluateGate(vitalsGate, legacyNoAnchor);
    expect(r.satisfied).toBe(true);
  });
});
