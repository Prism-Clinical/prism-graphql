/**
 * Plan 04 Task 8 — compound gates propagate uncertainty.
 *
 * `ConditionOutcome` already carries `indeterminate` and `uncertainty` (widened
 * at Task 4, populated by Tasks 4–7), and a SINGLE-condition gate already copies
 * them onto its result. The compound boundary dropped both. This suite pins the
 * normative truth table for `indeterminate` and the union rule for
 * `uncertainty`.
 *
 * **D5 is the specification, and the two signals are INDEPENDENT.** `selectFacts`
 * deliberately returns an aggregate as `READY` — not `INDETERMINATE` — after
 * excluding uncertain facts, so **a definite outcome carrying non-empty
 * `uncertainty` is the normal case, not an edge case**. Nothing here asserts
 * that `uncertainty` is empty whenever `indeterminate` is false; the P1-11
 * review finding was exactly that coupling.
 *
 * **These proofs live at the unit level deliberately.** `deps.factStore` is `[]`
 * at every resolver until Task 9 wires the assembler, so a traversal-level or
 * end-to-end `v1` test could not exercise the kernel at all and would pass no
 * matter what this task did (P1-16). The store is built here and handed to
 * `evaluateGate`.
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
// v1 pins vitals to ENCOUNTER, and the anchor must PRECEDE the clock.
const ENCOUNTER_START = '2026-08-10T08:00:00.000Z';
// v1's lab horizon is QUARTER = 90 days, so the boundary sits at 2026-05-13.
const INSIDE_QUARTER = '2026-07-01';

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
      end: { kind: 'OPEN', assertedCurrentAt: AS_OF },
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
 * One store, six independent selections. Every condition below keys on its own
 * code, so a gate can be assembled from any mix of them without the fixtures
 * interfering.
 */
const STORE: NormalizedFact[] = [
  // Definite TRUE: valid, active, lifetime horizon.
  conditionFact('f-dm', 'E11.9'),
  // Definite TRUE carrying doubt: membership FAILS OPEN on an unverified
  // record, so the answer is certain and the evidence is not (D5, P1-11).
  conditionFact('f-htn', 'I10', {
    recordValidity: 'UNKNOWN',
    validityBasis: 'verification:unconfirmed',
  } as Partial<NormalizedFact>),
  // INDETERMINATE: scalar FAILS CLOSED on the same kind of doubt.
  labFact('f-a1c', '4548-4', INSIDE_QUARTER, 9, {
    recordValidity: 'UNKNOWN',
    validityBasis: 'observation:preliminary',
  } as Partial<NormalizedFact>),
  // Definite FALSE carrying doubt: the aggregate class excludes the uncertain
  // fact and reports a definite count of zero, with the doubt retained.
  labFact('f-crp', '1988-5', INSIDE_QUARTER, 12, {
    recordValidity: 'UNKNOWN',
    validityBasis: 'observation:preliminary',
  } as Partial<NormalizedFact>),
  // INDETERMINATE for a reason that exists ONLY on the outcome: two results
  // that cannot be ordered. No per-fact decision is uncertain here.
  labFact('f-hgb-a', '718-7', INSIDE_QUARTER, 8),
  labFact('f-hgb-b', '718-7', INSIDE_QUARTER, 14),
];

// ─── The six condition building blocks ────────────────────────────────

/** Definite `true`, no uncertainty. */
const TRUE_CLEAN: GateCondition = { field: 'conditions', operator: 'includes_code', value: 'E11.9' };
/** A second definite `true`, so an all-true row needs no uncertain fixture. */
const TRUE_CLEAN_2: GateCondition = { field: 'conditions', operator: 'equals', value: 'E11.9' };
/** Definite `false`, no uncertainty — nothing matches the code at all. */
const FALSE_CLEAN: GateCondition = { field: 'conditions', operator: 'includes_code', value: 'Z99.9' };
/** A second definite `false`. */
const FALSE_CLEAN_2: GateCondition = { field: 'conditions', operator: 'equals', value: 'Q00.0' };
/** Indeterminate: scalar fails closed on an unverified record. */
const INDET: GateCondition = {
  field: 'labs',
  operator: 'greater_than',
  value: '4548-4',
  system: 'LOINC',
  threshold: 7,
};
/** Indeterminate for an OUTCOME-level reason: AMBIGUOUS_LATEST. */
const INDET_AMBIGUOUS: GateCondition = {
  field: 'labs',
  operator: 'greater_than',
  value: '718-7',
  system: 'LOINC',
  threshold: 5,
};
/** Definite `true` that carries doubt (membership fails open). */
const TRUE_UNCERTAIN: GateCondition = {
  field: 'conditions',
  operator: 'includes_code',
  value: 'I10',
};
/** Definite `false` that carries doubt (aggregate fails closed, count is 0). */
const FALSE_UNCERTAIN: GateCondition = {
  field: 'labs',
  operator: 'count_in_window',
  value: '1988-5',
  system: 'LOINC',
  count_threshold: 2,
};

/**
 * A scalar comparison with NO fact on file at all — the missing-measurement
 * case, and the common one. Distinct from INDET, where candidates exist but
 * cannot be ordered.
 */
const NO_DATUM: GateCondition = {
  field: 'labs',
  operator: 'less_than',
  value: '30313-1',
  system: 'LOINC',
  threshold: 11,
};

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

function compound(op: 'AND' | 'OR', conditions: GateCondition[]): GateProperties {
  return {
    title: 'compound gate',
    gate_type: GateType.COMPOUND,
    default_behavior: DefaultBehavior.SKIP,
    operator: op,
    conditions,
  };
}

function single(condition: GateCondition): GateProperties {
  return {
    title: 'single gate',
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
    factStore: version === 'v1' ? STORE : [],
    // Required from review finding 3 on (R11-4). Empty: these gates evaluate no
    // attribute condition, and an empty registry is a legitimate deployment.
    codeMap: new Map(),
    patientContext: patient(),
    resolutionState: new Map<string, NodeResult>(),
    gateAnswers: new Map<string, GateAnswer>(),
    ...overrides,
  };
}

// ─── The inputs, pinned before the table is asserted over them ─────────

describe('the truth table inputs are what they claim to be', () => {
  // A truth-table row asserted over a mis-built fixture proves nothing. Each
  // building block is checked as a single-condition gate first, where the
  // propagation already worked before this task.
  it('TRUE_CLEAN is a definite true with no uncertainty', async () => {
    const r = await evaluateGate(single(TRUE_CLEAN), deps('v1'));
    expect(r.satisfied).toBe(true);
    expect(r.indeterminate).toBe(false);
    expect(r.uncertainty).toEqual([]);
  });

  it('TRUE_CLEAN_2 is a definite true with no uncertainty', async () => {
    const r = await evaluateGate(single(TRUE_CLEAN_2), deps('v1'));
    expect(r.satisfied).toBe(true);
    expect(r.indeterminate).toBe(false);
    expect(r.uncertainty).toEqual([]);
  });

  it('FALSE_CLEAN and FALSE_CLEAN_2 are definite falses with no uncertainty', async () => {
    for (const c of [FALSE_CLEAN, FALSE_CLEAN_2]) {
      const r = await evaluateGate(single(c), deps('v1'));
      expect(r.satisfied).toBe(false);
      expect(r.indeterminate).toBe(false);
      expect(r.uncertainty).toEqual([]);
    }
  });

  it('INDET is indeterminate, carrying a per-fact reason', async () => {
    const r = await evaluateGate(single(INDET), deps('v1'));
    expect(r.satisfied).toBe(false);
    expect(r.indeterminate).toBe(true);
    expect(r.uncertainty).toEqual(['VALIDITY_UNKNOWN']);
  });

  it('INDET_AMBIGUOUS is indeterminate for an OUTCOME-level reason only', async () => {
    // No per-fact decision is uncertain: the two results are individually
    // certain and merely cannot be ordered against each other.
    const r = await evaluateGate(single(INDET_AMBIGUOUS), deps('v1'));
    expect(r.satisfied).toBe(false);
    expect(r.indeterminate).toBe(true);
    expect(r.uncertainty).toEqual(['AMBIGUOUS_LATEST']);
  });

  it('TRUE_UNCERTAIN is a DEFINITE true that still carries uncertainty (D5)', async () => {
    const r = await evaluateGate(single(TRUE_UNCERTAIN), deps('v1'));
    expect(r.satisfied).toBe(true);
    expect(r.indeterminate).toBe(false);
    expect(r.uncertainty).toEqual(['VALIDITY_UNKNOWN']);
  });

  it('FALSE_UNCERTAIN is a DEFINITE false that still carries uncertainty (D5)', async () => {
    const r = await evaluateGate(single(FALSE_UNCERTAIN), deps('v1'));
    expect(r.satisfied).toBe(false);
    expect(r.indeterminate).toBe(false);
    expect(r.uncertainty).toEqual(['VALIDITY_UNKNOWN']);
  });
});

// ─── The normative truth table, one test per row ──────────────────────

describe('indeterminate — the normative truth table, row by row', () => {
  // Row 1 — AND, any definite false.
  it('AND / any definite false ⇒ satisfied false, indeterminate FALSE', async () => {
    const r = await evaluateGate(compound('AND', [TRUE_CLEAN, FALSE_CLEAN]), deps('v1'));
    expect(r.satisfied).toBe(false);
    expect(r.indeterminate).toBe(false);
  });

  it('AND / a definite false DOMINATES an indeterminate sibling', async () => {
    // The load-bearing half of row 1: the gate's answer is certain even though
    // one of its conditions could not be decided.
    const r = await evaluateGate(compound('AND', [FALSE_CLEAN, INDET]), deps('v1'));
    expect(r.satisfied).toBe(false);
    expect(r.indeterminate).toBe(false);
  });

  // Row 2 — AND, all true except ≥1 indeterminate.
  it('AND / all true except ≥1 indeterminate ⇒ satisfied false, indeterminate TRUE', async () => {
    const r = await evaluateGate(compound('AND', [TRUE_CLEAN, INDET]), deps('v1'));
    expect(r.satisfied).toBe(false);
    expect(r.indeterminate).toBe(true);
  });

  // Row 3 — AND, all definite true.
  it('AND / all definite true ⇒ satisfied true, indeterminate FALSE', async () => {
    const r = await evaluateGate(compound('AND', [TRUE_CLEAN, TRUE_CLEAN_2]), deps('v1'));
    expect(r.satisfied).toBe(true);
    expect(r.indeterminate).toBe(false);
  });

  // Row 4 — OR, any definite true.
  it('OR / any definite true ⇒ satisfied true, indeterminate FALSE', async () => {
    const r = await evaluateGate(compound('OR', [FALSE_CLEAN, TRUE_CLEAN]), deps('v1'));
    expect(r.satisfied).toBe(true);
    expect(r.indeterminate).toBe(false);
  });

  it('OR / a definite true DOMINATES an indeterminate sibling', async () => {
    const r = await evaluateGate(compound('OR', [INDET, TRUE_CLEAN]), deps('v1'));
    expect(r.satisfied).toBe(true);
    expect(r.indeterminate).toBe(false);
  });

  // Row 5 — OR, all false except ≥1 indeterminate.
  it('OR / all false except ≥1 indeterminate ⇒ satisfied false, indeterminate TRUE', async () => {
    const r = await evaluateGate(compound('OR', [FALSE_CLEAN, INDET]), deps('v1'));
    expect(r.satisfied).toBe(false);
    expect(r.indeterminate).toBe(true);
  });

  // Row 6 — OR, all definite false.
  it('OR / all definite false ⇒ satisfied false, indeterminate FALSE', async () => {
    const r = await evaluateGate(compound('OR', [FALSE_CLEAN, FALSE_CLEAN_2]), deps('v1'));
    expect(r.satisfied).toBe(false);
    expect(r.indeterminate).toBe(false);
  });

  // Row 7 — EITHER operator, all indeterminate.
  it('AND / all indeterminate ⇒ satisfied false, indeterminate TRUE', async () => {
    const r = await evaluateGate(compound('AND', [INDET, INDET_AMBIGUOUS]), deps('v1'));
    expect(r.satisfied).toBe(false);
    expect(r.indeterminate).toBe(true);
  });

  it('OR / all indeterminate ⇒ satisfied false, indeterminate TRUE', async () => {
    // Row 7 is written "either" in the plan, so BOTH operators are asserted —
    // an OR whose only conditions are indeterminate has no definite true to
    // dominate it.
    const r = await evaluateGate(compound('OR', [INDET, INDET_AMBIGUOUS]), deps('v1'));
    expect(r.satisfied).toBe(false);
    expect(r.indeterminate).toBe(true);
  });

  it('a single indeterminate condition is enough on its own, either operator', async () => {
    for (const op of ['AND', 'OR'] as const) {
      const r = await evaluateGate(compound(op, [INDET]), deps('v1'));
      expect(r.satisfied).toBe(false);
      expect(r.indeterminate).toBe(true);
    }
  });
});

// ─── uncertainty — a different rule (P1-11) ───────────────────────────

describe('uncertainty is the union, retained regardless of indeterminate', () => {
  it('retains uncertainty from a dominated condition (P1-11)', async () => {
    // OR: A is a definite true, B is a definite false carrying doubt. A
    // dominates the logic; B's doubt is not thereby imaginary.
    const r = await evaluateGate(compound('OR', [TRUE_CLEAN, FALSE_UNCERTAIN]), deps('v1'));
    expect(r.satisfied).toBe(true);
    expect(r.indeterminate).toBe(false);
    expect(r.uncertainty).toEqual(['VALIDITY_UNKNOWN']);
  });

  it('retains uncertainty from a dominated condition under AND too', async () => {
    const r = await evaluateGate(compound('AND', [FALSE_CLEAN, TRUE_UNCERTAIN]), deps('v1'));
    expect(r.satisfied).toBe(false);
    expect(r.indeterminate).toBe(false);
    expect(r.uncertainty).toEqual(['VALIDITY_UNKNOWN']);
  });

  it('a satisfied AND retains the doubt of the conditions that satisfied it', async () => {
    const r = await evaluateGate(compound('AND', [TRUE_CLEAN, TRUE_UNCERTAIN]), deps('v1'));
    expect(r.satisfied).toBe(true);
    expect(r.indeterminate).toBe(false);
    expect(r.uncertainty).toEqual(['VALIDITY_UNKNOWN']);
  });

  it('deduplicates identical reasons across conditions', async () => {
    // Three conditions, three different operator classes, one shared reason.
    const r = await evaluateGate(
      compound('AND', [TRUE_UNCERTAIN, FALSE_UNCERTAIN, INDET]),
      deps('v1'),
    );
    expect(r.uncertainty).toEqual(['VALIDITY_UNKNOWN']);
  });

  it('unions OUTCOME-level reasons with per-fact ones', async () => {
    // AMBIGUOUS_LATEST exists only on the SelectionOutcome — no single fact is
    // uncertain when two of them merely cannot be ordered — so a union that
    // read per-fact decisions alone would silently drop it.
    const r = await evaluateGate(compound('AND', [INDET, INDET_AMBIGUOUS]), deps('v1'));
    expect(r.uncertainty).toEqual(
      expect.arrayContaining(['VALIDITY_UNKNOWN', 'AMBIGUOUS_LATEST']),
    );
    expect(r.uncertainty).toHaveLength(2);
  });

  it('is empty, not absent, when no condition reported any', async () => {
    const r = await evaluateGate(compound('AND', [TRUE_CLEAN, FALSE_CLEAN]), deps('v1'));
    expect(r.uncertainty).toEqual([]);
    expect(r.indeterminate).toBe(false);
  });
});

// ─── The legacy-v0 shape is byte-identical (locked decision #2) ────────

describe('legacy-v0 compound gates are untouched', () => {
  it('leaves a legacy-v0 compound gate’s result shape unchanged', async () => {
    const r = await evaluateGate(compound('AND', [FALSE_CLEAN, FALSE_CLEAN_2]), deps('legacy-v0'));
    // Both keys ABSENT, not `undefined` — a new key on the legacy path is a
    // behavior change reachable under `legacy-v0`, which is a bug in the seam.
    expect('indeterminate' in r).toBe(false);
    expect('uncertainty' in r).toBe(false);
    expect(r).toEqual({
      satisfied: false,
      reason:
        'Unsatisfied conditions: No matching code Z99.9 found in patient conditions; ' +
        'No exact code Q00.0 found in patient conditions',
      contextFieldsRead: ['conditions'],
      dependedOnNodes: [],
    });
  });

  it('leaves a legacy-v0 OR compound gate’s result shape unchanged', async () => {
    const r = await evaluateGate(compound('OR', [FALSE_CLEAN, FALSE_CLEAN_2]), deps('legacy-v0'));
    expect(r).toEqual({
      satisfied: false,
      reason: 'No compound conditions satisfied',
      contextFieldsRead: ['conditions'],
      dependedOnNodes: [],
    });
  });

  it('leaves the empty-conditions guard unchanged under both versions', async () => {
    for (const version of ['legacy-v0', 'v1']) {
      const r = await evaluateGate(compound('AND', []), deps(version));
      expect(r).toEqual({
        satisfied: false,
        reason: 'Compound gate has no conditions',
        contextFieldsRead: [],
        dependedOnNodes: [],
      });
    }
  });
});

// ─── Conditions that report neither signal ────────────────────────────

describe('a condition that reports neither signal counts as definite', () => {
  it('treats a patient.* condition (legacy fallback under v1) as certain', async () => {
    // `patient.*` keeps `resolveAttribute` forever (D3), so under `v1` it
    // returns a bare legacy outcome with neither key. Absent must read as "no
    // doubt", not as "unknown" — otherwise every demographic condition would
    // make its compound gate indeterminate.
    const ctx = patient({ patientAttributes: { trimester: 2 } } as Partial<PatientContext>);
    const demographic: GateCondition = {
      attribute: 'patient.trimester',
      operator: 'equals',
      value: 2,
    } as GateCondition;

    const bothTrue = await evaluateGate(
      compound('AND', [demographic, TRUE_CLEAN]),
      deps('v1', { patientContext: ctx }),
    );
    expect(bothTrue.satisfied).toBe(true);
    expect(bothTrue.indeterminate).toBe(false);

    // And it does not dilute a sibling's doubt.
    const withDoubt = await evaluateGate(
      compound('AND', [demographic, INDET]),
      deps('v1', { patientContext: ctx }),
    );
    expect(withDoubt.satisfied).toBe(false);
    expect(withDoubt.indeterminate).toBe(true);
    expect(withDoubt.uncertainty).toEqual(['VALIDITY_UNKNOWN']);
  });

  it('reports NO keys when NO condition reported either — the all-legacy mix', async () => {
    // A `v1` compound made only of `patient.*` conditions runs entirely on the
    // legacy fallback, so there is nothing to propagate and the result must
    // keep today's shape rather than gain `indeterminate: false`.
    const ctx = patient({ patientAttributes: { trimester: 2 } } as Partial<PatientContext>);
    const demographic: GateCondition = {
      attribute: 'patient.trimester',
      operator: 'equals',
      value: 2,
    } as GateCondition;
    const r = await evaluateGate(
      compound('AND', [demographic]),
      deps('v1', { patientContext: ctx }),
    );
    expect(r.satisfied).toBe(true);
    expect('indeterminate' in r).toBe(false);
    expect('uncertainty' in r).toBe(false);
  });
});

// ─── The reason string does not move ──────────────────────────────────

describe('reason strings are unchanged by propagation', () => {
  it('names the indeterminate condition in an AND gate’s prose, as before', async () => {
    const r = await evaluateGate(compound('AND', [TRUE_CLEAN, INDET]), deps('v1'));
    expect(r.reason).toBe(
      'Unsatisfied conditions: Indeterminate numeric value for labs:4548-4 (VALIDITY_UNKNOWN)',
    );
  });

  it('keeps the OR prose exactly as it is when nothing is satisfied', async () => {
    // Pinned deliberately: the OR branch discards unsatisfied conditions'
    // reasons, so `indeterminate` is the ONLY carrier of the distinction
    // between "refused for uncertainty" and "the patient had none of these".
    const r = await evaluateGate(compound('OR', [FALSE_CLEAN, INDET]), deps('v1'));
    expect(r.reason).toBe('No compound conditions satisfied');
    expect(r.indeterminate).toBe(true);
  });

  it('keeps contextFieldsRead deduplicated across conditions, as before', async () => {
    const r = await evaluateGate(compound('AND', [TRUE_CLEAN, TRUE_CLEAN_2, INDET]), deps('v1'));
    expect(r.contextFieldsRead).toEqual(['conditions', 'labs']);
  });
});

/**
 * `dataUnavailable` crosses the compound boundary.
 *
 * It did not, and that made the whole escalation workstream miss its main
 * case: one scalar condition of a compound with no measurement on file
 * reported nothing, so the gate silently took its default. Keying escalation
 * on `indeterminate` alone never fires there — `indeterminate` means
 * candidates EXIST but cannot be ordered, and a missing haemoglobin has no
 * candidates at all.
 *
 * The truth table is the same shape as `indeterminate`'s: an unanswerable
 * condition matters only when nothing else settles the compound.
 */
describe('compound dataUnavailable', () => {
  it('is true when an AND has no other verdict to go on', async () => {
    const r = await evaluateGate(compound('AND', [TRUE_CLEAN, NO_DATUM]), deps('v1'));
    expect(r.dataUnavailable).toBe(true);
  });

  // A real `false` settles an AND whatever its siblings did, so asking for the
  // missing datum could not change the outcome.
  it('is false when a definite false already settles the AND', async () => {
    const r = await evaluateGate(compound('AND', [FALSE_CLEAN, NO_DATUM]), deps('v1'));
    expect(r.dataUnavailable).toBe(false);
  });

  it('is false when a definite true already settles the OR', async () => {
    const r = await evaluateGate(compound('OR', [TRUE_CLEAN, NO_DATUM]), deps('v1'));
    expect(r.dataUnavailable).toBe(false);
  });

  it('is true when an OR has nothing satisfied to settle it', async () => {
    const r = await evaluateGate(compound('OR', [FALSE_CLEAN, NO_DATUM]), deps('v1'));
    expect(r.dataUnavailable).toBe(true);
  });

  // An unavailable condition is not a false one, so it must not dominate an
  // AND — reading `satisfied: false` as a real negative is the conflation this
  // whole signal exists to remove.
  it('does not let an unavailable condition settle the AND for indeterminate', async () => {
    const r = await evaluateGate(compound('AND', [NO_DATUM, INDET]), deps('v1'));
    expect(r.dataUnavailable).toBe(true);
    expect(r.indeterminate).toBe(true);
  });

  it('stays absent on legacy-v0, like the other kernel signals', async () => {
    const r = await evaluateGate(compound('AND', [TRUE_CLEAN, NO_DATUM]), deps('legacy-v0'));
    expect(r.dataUnavailable).toBeUndefined();
    expect(r.indeterminate).toBeUndefined();
  });
});

/**
 * Which condition could not be answered.
 *
 * The prompt used to ask for the first ASKABLE condition, which on a compound
 * can be one the engine already has a value for. The provider answers it, the
 * condition that actually blocked the decision is still blocked, and the gate
 * pends again — however many times they answer.
 */
describe('compound unresolvedConditions', () => {
  it('names the condition that could not be answered, not the first one', async () => {
    const r = await evaluateGate(compound('AND', [TRUE_CLEAN, NO_DATUM]), deps('v1'));
    expect(r.unresolvedConditions).toEqual([NO_DATUM]);
  });

  it('names every unresolved condition when several are', async () => {
    const r = await evaluateGate(compound('AND', [NO_DATUM, INDET]), deps('v1'));
    expect(r.unresolvedConditions).toHaveLength(2);
  });

  it('names nothing when the compound decided', async () => {
    const r = await evaluateGate(compound('AND', [TRUE_CLEAN, TRUE_CLEAN_2]), deps('v1'));
    expect(r.unresolvedConditions).toBeUndefined();
  });

  // Nothing to ask for: a settled compound must not prompt.
  it('names nothing when a definite false settles the AND', async () => {
    const r = await evaluateGate(compound('AND', [FALSE_CLEAN, NO_DATUM]), deps('v1'));
    expect(r.unresolvedConditions).toBeUndefined();
  });
});
