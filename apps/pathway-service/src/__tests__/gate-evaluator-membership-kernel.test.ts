/**
 * Plan 04 Task 4 — membership operators on the `selectFacts` kernel.
 *
 * `includes_code`, `equals` and `exists` are the first operators whose `v1`
 * branch stops reading `patientContext` and reads the normalized `factStore`
 * instead. This is where the fork stops being a no-op, which is why Task 3's
 * "decides identically under legacy-v0 and v1" test is deleted here.
 *
 * **These proofs live at the unit level deliberately.** `deps.factStore` is
 * still `[]` at every resolver — the assembler that fills it is not wired until
 * Task 9 — so a traversal-level or end-to-end test could not exercise `v1`
 * membership at all and would pass no matter what this task did (P1-16). The
 * store is therefore constructed directly and handed to `evaluateGate`.
 *
 * Every "disclosed delta" case asserts BOTH versions against the same clinical
 * reality, expressed twice: as `patientContext` (what `legacy-v0` reads) and as
 * `factStore` (what `v1` reads). Asserting only the new behavior would let the
 * legacy baseline drift unnoticed, and locked decision #2 requires each delta to
 * be pinned, not merely introduced.
 */

import { evaluateGate } from '../services/resolution/gate-evaluator';
import type { GateEvaluationDeps } from '../services/resolution/gate-evaluator';
import {
  GateProperties,
  GateAnswer,
  NodeResult,
  GateType,
  DefaultBehavior,
  GateCondition,
} from '../services/resolution/types';
import { makeEvaluationTemporalContext } from '../services/resolution/temporal/evaluation-context';
import type { NormalizedFact } from '../services/resolution/temporal/fact-model';
import type { PatientContext } from '../services/confidence/types';

const AS_OF = '2026-08-11T00:00:00.000Z';
const ENCOUNTER_START = '2026-08-10T08:00:00.000Z';
// v1's lab horizon is QUARTER = 90 days, so the boundary sits at 2026-05-13.
const INSIDE_QUARTER = '2026-07-01';
const OUTSIDE_QUARTER = '2026-01-05';

// ─── Fixture builders ─────────────────────────────────────────────────

function conditionFact(
  factId: string,
  code: string,
  overrides: Partial<NormalizedFact> = {},
): NormalizedFact {
  return {
    kind: 'condition',
    factId,
    code,
    system: 'ICD-10',
    interval: {
      start: { value: '2020', precision: 'year' },
      end: { kind: 'OPEN', assertedCurrentAt: '2026-06-01T00:00:00.000Z' },
    },
    recordValidity: 'VALID',
    validityBasis: 'verification:confirmed',
    provenance: { sourceType: 'SYNTHETIC' },
    clinicalState: 'ACTIVE',
    stateBasis: 'FHIR_STATUS',
    ...overrides,
  } as NormalizedFact;
}

function labFact(
  factId: string,
  code: string,
  day: string,
  overrides: Partial<NormalizedFact> = {},
): NormalizedFact {
  return {
    kind: 'lab',
    factId,
    code,
    system: 'LOINC',
    value: 7,
    unit: 'g/dL',
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

function vitalFact(factId: string, code: string, at: string): NormalizedFact {
  return {
    kind: 'vital',
    factId,
    code,
    system: 'http://prism.health/vitals',
    value: 148,
    unit: 'mmHg',
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
    title: 'membership gate',
    gate_type: GateType.PATIENT_ATTRIBUTE,
    default_behavior: DefaultBehavior.SKIP,
    condition,
  };
}

function deps(
  version: string,
  overrides: Partial<GateEvaluationDeps> = {},
): GateEvaluationDeps {
  return {
    temporalContext: makeEvaluationTemporalContext({
      evaluationAsOf: AS_OF,
      encounterStart: ENCOUNTER_START,
      temporalPolicyVersion: version,
    }),
    pathwayDefaults: {},
    factStore: [],
    // Required from review finding 3 on (R11-4). Empty: these gates evaluate no
    // attribute condition, and an empty registry is a legitimate deployment.
    codeMap: new Map(),
    patientContext: patient(),
    resolutionState: new Map<string, NodeResult>(),
    gateAnswers: new Map<string, GateAnswer>(),
    ...overrides,
  };
}

// ─── Shape preservation ───────────────────────────────────────────────

describe('membership under v1 preserves the shape of today’s matching', () => {
  it('matches a trailing-wildcard code pattern (Z94.* matches Z94.0)', async () => {
    const gate = gateFor({
      field: 'conditions',
      operator: 'includes_code',
      value: 'Z94.*',
      system: 'ICD-10',
    });

    const hit = await evaluateGate(
      gate,
      deps('v1', { factStore: [conditionFact('c1', 'Z94.0')] }),
    );
    expect(hit.satisfied).toBe(true);
    expect(hit.contextFieldsRead).toEqual(['conditions']);

    const miss = await evaluateGate(
      gate,
      deps('v1', { factStore: [conditionFact('c1', 'Z95.0')] }),
    );
    expect(miss.satisfied).toBe(false);
  });

  it('respects an explicit system filter', async () => {
    const gate = gateFor({
      field: 'conditions',
      operator: 'includes_code',
      value: 'E11.9',
      system: 'ICD-10',
    });

    const wrongSystem = await evaluateGate(
      gate,
      deps('v1', { factStore: [conditionFact('c1', 'E11.9', { system: 'SNOMED' })] }),
    );
    expect(wrongSystem.satisfied).toBe(false);

    const rightSystem = await evaluateGate(
      gate,
      deps('v1', { factStore: [conditionFact('c1', 'E11.9')] }),
    );
    expect(rightSystem.satisfied).toBe(true);
  });

  it('equals matches an exact code and never a wildcard pattern', async () => {
    const exact = gateFor({
      field: 'conditions',
      operator: 'equals',
      value: 'Z94.0',
      system: 'ICD-10',
    });
    expect(
      (await evaluateGate(exact, deps('v1', { factStore: [conditionFact('c1', 'Z94.0')] })))
        .satisfied,
    ).toBe(true);

    // `equals` is exact by contract — the pattern is a literal code here, and a
    // fact spelled Z94.0 must NOT satisfy it. Same as legacy-v0's `===`.
    const pattern = gateFor({
      field: 'conditions',
      operator: 'equals',
      value: 'Z94.*',
      system: 'ICD-10',
    });
    expect(
      (await evaluateGate(pattern, deps('v1', { factStore: [conditionFact('c1', 'Z94.0')] })))
        .satisfied,
    ).toBe(false);
  });

  it('exists is satisfied by any admitted fact, unsatisfied when the field is empty', async () => {
    const gate = gateFor({ field: 'conditions', operator: 'exists', value: '' });

    const populated = await evaluateGate(
      gate,
      deps('v1', { factStore: [conditionFact('c1', 'E11.9')] }),
    );
    expect(populated.satisfied).toBe(true);

    // A fact of a DIFFERENT kind must not satisfy a conditions bucket.
    const otherKind = await evaluateGate(
      gate,
      deps('v1', { factStore: [labFact('l1', '4548-4', INSIDE_QUARTER)] }),
    );
    expect(otherKind.satisfied).toBe(false);

    const empty = await evaluateGate(gate, deps('v1', { factStore: [] }));
    expect(empty.satisfied).toBe(false);
  });

  it('ignores value and system on exists, exactly as legacy-v0 does', async () => {
    // Both spellings must decide identically: `value: ''` (the convention in
    // reachability.test.ts and select-facts.test.ts) and a real code (the merged
    // fixture at resolution-input-contract.test.ts:602). A 718-7 `exists` on a
    // patient whose only lab is 4548-4 is SATISFIED under both versions, and a
    // `system` that matches nothing does not narrow it.
    //
    // This test is the guard on plan 06's future authoring change: with the
    // behavior pinned here, changing it later is a deliberate, visible move
    // rather than a silent regression.
    const onlyLab = labFact('l1', '4548-4', INSIDE_QUARTER);
    const store = [onlyLab];
    const pc = patient({
      labResults: [{ code: '4548-4', system: 'LOINC', value: 7, date: INSIDE_QUARTER }],
    });

    const spellings: GateCondition[] = [
      { field: 'labs', operator: 'exists', value: '' },
      { field: 'labs', operator: 'exists', value: '718-7' },
      { field: 'labs', operator: 'exists', value: '718-7', system: 'SNOMED' },
    ];

    for (const condition of spellings) {
      const v1 = await evaluateGate(
        gateFor(condition),
        deps('v1', { factStore: store, patientContext: pc }),
      );
      const legacy = await evaluateGate(
        gateFor(condition),
        deps('legacy-v0', { factStore: store, patientContext: pc }),
      );
      expect(v1.satisfied).toBe(true);
      expect(legacy.satisfied).toBe(true);
    }
  });
});

// ─── D5: fail open, and say so ────────────────────────────────────────

describe('membership fails open on uncertainty, and says so (D5)', () => {
  const uncertainGate = gateFor({
    field: 'conditions',
    operator: 'includes_code',
    value: 'E11.9',
    system: 'ICD-10',
  });
  const uncertainStore = [
    conditionFact('c1', 'E11.9', {
      recordValidity: 'UNKNOWN',
      validityBasis: 'verification:unconfirmed',
    }),
  ];

  it('counts a validity-UNKNOWN fact as a match', async () => {
    const r = await evaluateGate(uncertainGate, deps('v1', { factStore: uncertainStore }));
    expect(r.satisfied).toBe(true);
  });

  it('records uncertainty even though the outcome is definite', async () => {
    const r = await evaluateGate(uncertainGate, deps('v1', { factStore: uncertainStore }));
    expect(r.satisfied).toBe(true);
    expect(r.indeterminate).toBe(false);
    expect(r.uncertainty).toContain('VALIDITY_UNKNOWN');
  });

  it('reports no uncertainty when every admitted fact was certain', async () => {
    // The complement: `uncertainty` must not become a constant non-empty array.
    const r = await evaluateGate(
      uncertainGate,
      deps('v1', { factStore: [conditionFact('c1', 'E11.9')] }),
    );
    expect(r.satisfied).toBe(true);
    expect(r.indeterminate).toBe(false);
    expect(r.uncertainty).toEqual([]);
  });

  it('is never indeterminate — membership fails open by construction', async () => {
    // Every membership outcome is definite: selectFacts resolves uncertainty to
    // INCLUDE for this operator class, so INDETERMINATE is unreachable here
    // (select-facts.ts:184-190). Consumed, not re-decided per operator.
    const r = await evaluateGate(uncertainGate, deps('v1', { factStore: [] }));
    expect(r.satisfied).toBe(false);
    expect(r.indeterminate).toBe(false);
  });
});

// ─── The disclosed deltas ─────────────────────────────────────────────

describe('disclosed v1 deltas — these MUST differ from legacy-v0', () => {
  it('drops a recordValidity INVALID fact that legacy-v0 matches', async () => {
    const gate = gateFor({
      field: 'conditions',
      operator: 'includes_code',
      value: 'E11.9',
      system: 'ICD-10',
    });
    const shared = {
      patientContext: patient({ conditionCodes: [{ code: 'E11.9', system: 'ICD-10' }] }),
      factStore: [
        conditionFact('c1', 'E11.9', {
          recordValidity: 'INVALID',
          validityBasis: 'verification:entered-in-error',
        }),
      ],
    };

    expect((await evaluateGate(gate, deps('legacy-v0', shared))).satisfied).toBe(true);
    expect((await evaluateGate(gate, deps('v1', shared))).satisfied).toBe(false);
  });

  it('drops a lab outside QUARTER that legacy-v0 admits under LIFETIME', async () => {
    const gate = gateFor({
      field: 'labs',
      operator: 'includes_code',
      value: '4548-4',
      system: 'LOINC',
    });
    const stale = {
      patientContext: patient({
        labResults: [{ code: '4548-4', system: 'LOINC', value: 7, date: OUTSIDE_QUARTER }],
      }),
      factStore: [labFact('l1', '4548-4', OUTSIDE_QUARTER)],
    };

    expect((await evaluateGate(gate, deps('legacy-v0', stale))).satisfied).toBe(true);
    expect((await evaluateGate(gate, deps('v1', stale))).satisfied).toBe(false);

    // The same lab inside the quarter is still admitted — the delta is the
    // horizon, not the field.
    const fresh = {
      patientContext: stale.patientContext,
      factStore: [labFact('l1', '4548-4', INSIDE_QUARTER)],
    };
    expect((await evaluateGate(gate, deps('v1', fresh))).satisfied).toBe(true);
  });

  it('starts matching a vitals membership gate legacy-v0 cannot satisfy', async () => {
    // getCodeEntries returns [] for 'vitals', so this gate is unsatisfiable
    // today no matter what the patient's vitals say. The concrete example
    // behind review finding P1-1.
    const gate = gateFor({
      field: 'vitals',
      operator: 'includes_code',
      value: 'systolic_bp',
    });
    const shared = {
      patientContext: patient({ vitalSigns: { systolic_bp: 148 } }),
      factStore: [vitalFact('v1f', 'systolic_bp', '2026-08-10T09:00:00.000Z')],
    };

    expect((await evaluateGate(gate, deps('legacy-v0', shared))).satisfied).toBe(false);
    expect((await evaluateGate(gate, deps('v1', shared))).satisfied).toBe(true);
  });

  it('drops a vital taken before the encounter began (v1 vitals are ENCOUNTER-scoped)', async () => {
    const gate = gateFor({
      field: 'vitals',
      operator: 'includes_code',
      value: 'systolic_bp',
    });
    const r = await evaluateGate(
      gate,
      deps('v1', {
        factStore: [vitalFact('v1f', 'systolic_bp', '2026-08-09T09:00:00.000Z')],
      }),
    );
    expect(r.satisfied).toBe(false);
  });
});

// ─── legacy-v0 is untouched ───────────────────────────────────────────

describe('legacy-v0 reads the patient context and never the fact store', () => {
  it('is unsatisfied when only the fact store carries the code', async () => {
    // Structural proof that no kernel code runs on the legacy path: the store
    // holds a perfectly admissible fact and legacy still says no.
    const gate = gateFor({
      field: 'conditions',
      operator: 'includes_code',
      value: 'E11.9',
      system: 'ICD-10',
    });
    const r = await evaluateGate(
      gate,
      deps('legacy-v0', { factStore: [conditionFact('c1', 'E11.9')] }),
    );
    expect(r.satisfied).toBe(false);
  });

  it('records neither indeterminate nor uncertainty', async () => {
    const gate = gateFor({
      field: 'conditions',
      operator: 'includes_code',
      value: 'E11.9',
      system: 'ICD-10',
    });
    const r = await evaluateGate(
      gate,
      deps('legacy-v0', {
        patientContext: patient({ conditionCodes: [{ code: 'E11.9', system: 'ICD-10' }] }),
      }),
    );
    expect(r.satisfied).toBe(true);
    expect(r.indeterminate).toBeUndefined();
    expect(r.uncertainty).toBeUndefined();
  });
});

// ─── Preflight and evaluation must not disagree (locked decision #7) ───

describe('an unmodellable coded condition throws rather than deciding', () => {
  it('rejects a field with no fact kind under v1', async () => {
    // The v1 anchor sweep runs the same adapter, so this pathway is rejected at
    // session creation. Reaching evaluation at all means preflight was skipped —
    // and a silent `false` here would hide that, which is the divergence class
    // locked decision #7 forbids.
    const gate = gateFor({
      field: 'horoscopes' as never,
      operator: 'includes_code',
      value: 'leo',
    });
    await expect(evaluateGate(gate, deps('v1'))).rejects.toThrow(/horoscopes/);
  });
});
