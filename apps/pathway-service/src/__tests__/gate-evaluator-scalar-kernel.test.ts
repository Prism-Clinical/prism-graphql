/**
 * Plan 04 Task 5 — scalar operators on the `selectFacts` kernel.
 *
 * `greater_than` and `less_than` are the second operator class whose `v1`
 * branch stops reading `patientContext` and reads the normalized `factStore`
 * instead. Selection moves to `selectFacts` — **latest** valid, in-window,
 * definitely-ordered result — while the numeric comparison and its reason
 * strings stay in the evaluator, byte-identical to `legacy-v0`'s.
 *
 * **These proofs live at the unit level deliberately.** `deps.factStore` is
 * still `[]` at every resolver — the assembler that fills it is not wired until
 * Task 9 — so a traversal-level or end-to-end test could not exercise `v1`
 * scalars at all and would pass no matter what this task did (P1-16). The store
 * is therefore constructed directly and handed to `evaluateGate`.
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
import { VITALS_SYSTEM } from '../services/resolution/temporal/context-assembler';
import type { NormalizedFact } from '../services/resolution/temporal/fact-model';
import type { PatientContext } from '../services/confidence/types';

const AS_OF = '2026-08-11T00:00:00.000Z';
const ENCOUNTER_START = '2026-08-10T08:00:00.000Z';
// v1's lab horizon is QUARTER = 90 days, so the boundary sits at 2026-05-13.
const NEWER_IN_QUARTER = '2026-07-01';
const OLDER_IN_QUARTER = '2026-06-01';
const OUTSIDE_QUARTER = '2026-01-05';

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

/**
 * A vital exactly as the assembler builds it: no `start` at all, end
 * `OPEN(evaluationAsOf)`. The vitalSigns bag carries no dates anywhere
 * (context-assembler.ts:248), so this is the ONLY vital shape production
 * produces — which is why the plan flags it: `overlap()` must report MATCH
 * against any horizon containing the clock, not UNKNOWN.
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

/** A vital pinned to a real instant — used only to prove the ENCOUNTER window. */
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
    title: 'scalar gate',
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

const HGB_GT_7: GateCondition = {
  field: 'labs',
  operator: 'greater_than',
  value: '4548-4',
  system: 'LOINC',
  threshold: 7,
};

// ─── Selection under v1 ───────────────────────────────────────────────

describe('scalar selection under v1', () => {
  it('compares an undated vital (OPEN interval) rather than failing closed', async () => {
    // If this comes back INDETERMINATE the assembler's OPEN(evaluationAsOf)
    // modeling is not reaching overlap() — check Task 9 before the kernel.
    const gate = gateFor({
      field: 'vitals',
      operator: 'greater_than',
      value: 'systolic_bp',
      threshold: 140,
    });
    const r = await evaluateGate(
      gate,
      deps('v1', { factStore: [undatedVital('v1f', 'systolic_bp', 148)] }),
    );
    expect(r.satisfied).toBe(true);
    expect(r.indeterminate).toBe(false);
    expect(r.uncertainty).toEqual([]);
    expect(r.reason).toBe('vitals value 148 > 140');
  });

  it('is unsatisfied when no fact matches the code', async () => {
    const gate = gateFor({ ...HGB_GT_7, value: '718-7' });
    const r = await evaluateGate(
      gate,
      deps('v1', { factStore: [labFact('l1', '4548-4', NEWER_IN_QUARTER, 9)] }),
    );
    expect(r.satisfied).toBe(false);
    expect(r.indeterminate).toBe(false);
    // Byte-identical to legacy's no-value reason — a v1 outcome that MATCHES
    // legacy's must read identically, or every version diff is noise.
    expect(r.reason).toBe('No numeric value found for labs:718-7');
    expect(r.contextFieldsRead).toEqual(['labs']);
  });

  it('selects by EXACT code — a scalar never matches a wildcard pattern', async () => {
    // getNumericValue uses `===`, never matchesCodePattern; candidateMatches
    // mirrors that for the scalar class (select-facts.ts:98-100).
    const gate = gateFor({ ...HGB_GT_7, value: '4548-*' });
    const shared = {
      patientContext: patient({
        labResults: [{ code: '4548-4', system: 'LOINC', value: 9, date: NEWER_IN_QUARTER }],
      }),
      factStore: [labFact('l1', '4548-4', NEWER_IN_QUARTER, 9)],
    };
    expect((await evaluateGate(gate, deps('legacy-v0', shared))).satisfied).toBe(false);
    expect((await evaluateGate(gate, deps('v1', shared))).satisfied).toBe(false);
  });

  it('respects an explicit system filter', async () => {
    const r = await evaluateGate(
      gateFor(HGB_GT_7),
      deps('v1', {
        factStore: [labFact('l1', '4548-4', NEWER_IN_QUARTER, 9, { system: 'SNOMED' })],
      }),
    );
    expect(r.satisfied).toBe(false);
    expect(r.indeterminate).toBe(false);
  });

  it('keeps less_than’s comparison and reason strings identical to legacy-v0', async () => {
    const gate = gateFor({
      field: 'labs',
      operator: 'less_than',
      value: '4548-4',
      system: 'LOINC',
      threshold: 7,
    });
    const below = {
      patientContext: patient({
        labResults: [{ code: '4548-4', system: 'LOINC', value: 5, date: NEWER_IN_QUARTER }],
      }),
      factStore: [labFact('l1', '4548-4', NEWER_IN_QUARTER, 5)],
    };
    const legacyBelow = await evaluateGate(gate, deps('legacy-v0', below));
    const v1Below = await evaluateGate(gate, deps('v1', below));
    expect(legacyBelow.satisfied).toBe(true);
    expect(v1Below.satisfied).toBe(true);
    expect(v1Below.reason).toBe(legacyBelow.reason);
    expect(v1Below.reason).toBe('labs value 5 < 7');

    const above = {
      patientContext: patient({
        labResults: [{ code: '4548-4', system: 'LOINC', value: 9, date: NEWER_IN_QUARTER }],
      }),
      factStore: [labFact('l1', '4548-4', NEWER_IN_QUARTER, 9)],
    };
    const legacyAbove = await evaluateGate(gate, deps('legacy-v0', above));
    const v1Above = await evaluateGate(gate, deps('v1', above));
    expect(legacyAbove.satisfied).toBe(false);
    expect(v1Above.satisfied).toBe(false);
    expect(v1Above.reason).toBe(legacyAbove.reason);
    expect(v1Above.reason).toBe('labs value 9 >= 7');
  });
});

// ─── The disclosed deltas ─────────────────────────────────────────────

describe('disclosed v1 delta — latest, not first', () => {
  // The older result satisfies the gate, the newer one does not. legacy-v0's
  // getNumericValue takes `.find()` — array order — so it answers with whichever
  // the snapshot happened to list first.
  const older = { code: '4548-4', system: 'LOINC', value: 9, date: OLDER_IN_QUARTER };
  const newer = { code: '4548-4', system: 'LOINC', value: 5, date: NEWER_IN_QUARTER };
  const olderFact = labFact('l-old', '4548-4', OLDER_IN_QUARTER, 9);
  const newerFact = labFact('l-new', '4548-4', NEWER_IN_QUARTER, 5);

  it('compares the latest of several dated labs where legacy-v0 takes array order', async () => {
    const shared = {
      patientContext: patient({ labResults: [older, newer] }),
      factStore: [olderFact, newerFact],
    };
    // legacy: first element wins → 9 > 7.
    expect((await evaluateGate(gateFor(HGB_GT_7), deps('legacy-v0', shared))).satisfied).toBe(true);
    // v1: the definitely-latest fact wins → 5 > 7 is false.
    const v1 = await evaluateGate(gateFor(HGB_GT_7), deps('v1', shared));
    expect(v1.satisfied).toBe(false);
    expect(v1.reason).toBe('labs value 5 <= 7');
    expect(v1.indeterminate).toBe(false);
  });

  it('is order-independent where legacy-v0 flips with the array', async () => {
    // Same clinical reality, reversed order. legacy-v0's answer flips; v1's
    // does not — that is the point of moving selection into the kernel.
    const reversed = {
      patientContext: patient({ labResults: [newer, older] }),
      factStore: [newerFact, olderFact],
    };
    expect((await evaluateGate(gateFor(HGB_GT_7), deps('legacy-v0', reversed))).satisfied).toBe(
      false,
    );
    expect((await evaluateGate(gateFor(HGB_GT_7), deps('v1', reversed))).satisfied).toBe(false);
  });
});

describe('disclosed v1 deltas — horizon and validity govern the scalar too', () => {
  it('drops a lab outside QUARTER that legacy-v0 admits under LIFETIME', async () => {
    const stale = {
      patientContext: patient({
        labResults: [{ code: '4548-4', system: 'LOINC', value: 9, date: OUTSIDE_QUARTER }],
      }),
      factStore: [labFact('l1', '4548-4', OUTSIDE_QUARTER, 9)],
    };
    expect((await evaluateGate(gateFor(HGB_GT_7), deps('legacy-v0', stale))).satisfied).toBe(true);

    const v1 = await evaluateGate(gateFor(HGB_GT_7), deps('v1', stale));
    expect(v1.satisfied).toBe(false);
    // Out of window is a genuine "no value", not a fail-closed indeterminate.
    expect(v1.indeterminate).toBe(false);
    expect(v1.reason).toBe('No numeric value found for labs:4548-4');
  });

  it('drops a recordValidity INVALID lab that legacy-v0 compares', async () => {
    const shared = {
      patientContext: patient({
        labResults: [{ code: '4548-4', system: 'LOINC', value: 9, date: NEWER_IN_QUARTER }],
      }),
      factStore: [
        labFact('l1', '4548-4', NEWER_IN_QUARTER, 9, {
          recordValidity: 'INVALID',
          validityBasis: 'observation:entered-in-error',
        }),
      ],
    };
    expect((await evaluateGate(gateFor(HGB_GT_7), deps('legacy-v0', shared))).satisfied).toBe(true);

    const v1 = await evaluateGate(gateFor(HGB_GT_7), deps('v1', shared));
    expect(v1.satisfied).toBe(false);
    expect(v1.indeterminate).toBe(false);
  });

  it('drops a vital taken before the encounter began (v1 vitals are ENCOUNTER-scoped)', async () => {
    const gate = gateFor({
      field: 'vitals',
      operator: 'greater_than',
      value: 'systolic_bp',
      threshold: 140,
    });
    const r = await evaluateGate(
      gate,
      deps('v1', {
        factStore: [datedVital('v1f', 'systolic_bp', '2026-08-09T09:00:00.000Z', 148)],
      }),
    );
    expect(r.satisfied).toBe(false);
    expect(r.indeterminate).toBe(false);
  });
});

// ─── D5: fail closed, and say so ──────────────────────────────────────

describe('scalar INDETERMINATE fails closed and is recorded (D5)', () => {
  it('is unsatisfied and indeterminate when two results tie with no provable order', async () => {
    // Two day-precision results on the SAME day: neither range is strictly
    // after the other, so there is no provable latest (select-facts.ts:160).
    const gate = gateFor(HGB_GT_7);
    const r = await evaluateGate(
      gate,
      deps('v1', {
        factStore: [
          labFact('l1', '4548-4', NEWER_IN_QUARTER, 9),
          labFact('l2', '4548-4', NEWER_IN_QUARTER, 5),
        ],
      }),
    );
    expect(r.satisfied).toBe(false);
    expect(r.indeterminate).toBe(true);
    expect(r.uncertainty).toContain('AMBIGUOUS_LATEST');
  });

  it('does not let a fail-closed outcome read like an ordinary no-match', async () => {
    // Both outcomes are `satisfied: false`; only the reason and `indeterminate`
    // separate "there was no value" from "the value could not be trusted".
    const gate = gateFor(HGB_GT_7);
    const tie = await evaluateGate(
      gate,
      deps('v1', {
        factStore: [
          labFact('l1', '4548-4', NEWER_IN_QUARTER, 9),
          labFact('l2', '4548-4', NEWER_IN_QUARTER, 5),
        ],
      }),
    );
    const absent = await evaluateGate(gate, deps('v1', { factStore: [] }));
    expect(absent.reason).toBe('No numeric value found for labs:4548-4');
    expect(tie.reason).not.toBe(absent.reason);
    expect(tie.reason).toMatch(/AMBIGUOUS_LATEST/);
  });

  it('fails closed on an uncertain value that legacy-v0 happily compares', async () => {
    // One uncertain value poisons the comparison (select-facts.ts:194-195):
    // the number is there and would satisfy the gate, but its record validity
    // is unknown, so v1 refuses to decide instead of deciding wrongly.
    const shared = {
      patientContext: patient({
        labResults: [{ code: '4548-4', system: 'LOINC', value: 9, date: NEWER_IN_QUARTER }],
      }),
      factStore: [
        labFact('l1', '4548-4', NEWER_IN_QUARTER, 9, {
          recordValidity: 'UNKNOWN',
          validityBasis: 'observation:preliminary',
        }),
      ],
    };
    expect((await evaluateGate(gateFor(HGB_GT_7), deps('legacy-v0', shared))).satisfied).toBe(true);

    const v1 = await evaluateGate(gateFor(HGB_GT_7), deps('v1', shared));
    expect(v1.satisfied).toBe(false);
    expect(v1.indeterminate).toBe(true);
    expect(v1.uncertainty).toContain('VALIDITY_UNKNOWN');
  });

  it('is not indeterminate on a definite decision', async () => {
    const r = await evaluateGate(
      gateFor(HGB_GT_7),
      deps('v1', { factStore: [labFact('l1', '4548-4', NEWER_IN_QUARTER, 9)] }),
    );
    expect(r.satisfied).toBe(true);
    expect(r.indeterminate).toBe(false);
    expect(r.uncertainty).toEqual([]);
    expect(r.reason).toBe('labs value 9 > 7');
  });
});

// ─── legacy-v0 is untouched ───────────────────────────────────────────

describe('legacy-v0 reads the patient context and never the fact store', () => {
  it('is unsatisfied when only the fact store carries the value', async () => {
    const r = await evaluateGate(
      gateFor(HGB_GT_7),
      deps('legacy-v0', { factStore: [labFact('l1', '4548-4', NEWER_IN_QUARTER, 9)] }),
    );
    expect(r.satisfied).toBe(false);
  });

  it('records neither indeterminate nor uncertainty on a scalar gate', async () => {
    const r = await evaluateGate(
      gateFor(HGB_GT_7),
      deps('legacy-v0', {
        patientContext: patient({
          labResults: [{ code: '4548-4', system: 'LOINC', value: 9, date: NEWER_IN_QUARTER }],
        }),
      }),
    );
    expect(r.satisfied).toBe(true);
    expect(r.indeterminate).toBeUndefined();
    expect(r.uncertainty).toBeUndefined();
  });
});

// ─── Preflight and evaluation must not disagree (locked decision #7) ───

describe('the cascade’s errors propagate rather than becoming a quiet false', () => {
  it('throws MISSING_ENCOUNTER_ANCHOR for a v1 vitals scalar with no encounterStart', async () => {
    // The v1 anchor sweep rejects such a session up front. Reaching evaluation
    // means preflight was skipped — swallowing the throw into `satisfied: false`
    // would hide that, which is the divergence class locked decision #7 forbids.
    const gate = gateFor({
      field: 'vitals',
      operator: 'greater_than',
      value: 'systolic_bp',
      threshold: 140,
    });
    const noAnchor: GateEvaluationDeps = {
      ...deps('v1'),
      temporalContext: makeEvaluationTemporalContext({
        evaluationAsOf: AS_OF,
        temporalPolicyVersion: 'v1',
      }),
      factStore: [undatedVital('v1f', 'systolic_bp', 148)],
    };
    // Asserted on the CODE, not the prose: the code is the stable identifier
    // the sweep and the cascade both name this failure by.
    await expect(evaluateGate(gate, noAnchor)).rejects.toThrow(/requires encounterStart/);
    await expect(evaluateGate(gate, noAnchor)).rejects.toMatchObject({
      code: 'MISSING_ENCOUNTER_ANCHOR',
    });
  });

  it('rejects a scalar field with no fact kind under v1', async () => {
    const gate = gateFor({
      field: 'horoscopes' as never,
      operator: 'greater_than',
      value: 'leo',
      threshold: 1,
    });
    await expect(evaluateGate(gate, deps('v1'))).rejects.toThrow(/horoscopes/);
  });
});
