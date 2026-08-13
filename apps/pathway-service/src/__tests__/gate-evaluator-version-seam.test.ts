/**
 * Plan 04 Task 3 — the version seam.
 *
 * `evaluateGate` takes one `GateEvaluationDeps` object instead of eight
 * positional arguments, has no `Date.now()` fallback left, and dispatches
 * condition evaluation on `temporalContext.temporalPolicyVersion`.
 *
 * At this task the fork is deliberately a no-op: `evaluateConditionKernel`
 * delegates to `evaluateConditionLegacy` and `factStore` is always empty. So
 * routing CANNOT be proven behaviorally here (P1-16) — it is proven with spies
 * on the dispatch table, which is exactly the seam Tasks 4–8 will change.
 */

import {
  evaluateGate,
  CONDITION_EVALUATORS,
} from '../services/resolution/gate-evaluator';
import type { GateEvaluationDeps } from '../services/resolution/gate-evaluator';
import {
  GateProperties,
  GateAnswer,
  NodeResult,
  GateType,
  DefaultBehavior,
  AnswerType,
} from '../services/resolution/types';
import { makeEvaluationTemporalContext } from '../services/resolution/temporal/evaluation-context';
import type { PatientContext } from '../services/confidence/types';

const AS_OF = '2026-06-27T00:00:00.000Z';

function patient(overrides: Partial<PatientContext> = {}): PatientContext {
  return {
    patientId: 'p',
    conditionCodes: [{ code: 'I10', system: 'ICD-10' }],
    medications: [],
    labResults: [],
    allergies: [],
    ...overrides,
  };
}

const CODED_GATE: GateProperties = {
  title: 'has I10',
  gate_type: GateType.PATIENT_ATTRIBUTE,
  default_behavior: DefaultBehavior.SKIP,
  condition: { field: 'conditions', operator: 'includes_code', value: 'I10', system: 'ICD-10' },
};

function deps(
  version = 'legacy-v0',
  overrides: Partial<GateEvaluationDeps> = {},
): GateEvaluationDeps {
  return {
    temporalContext: makeEvaluationTemporalContext({
      evaluationAsOf: AS_OF,
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

/** Drop one required key, the way a stale positional call site would. */
function depsWithout(key: keyof GateEvaluationDeps): GateEvaluationDeps {
  const d = deps();
  delete d[key];
  return d;
}

// ─── D6: required dependencies, no implicit clock ─────────────────────

describe('evaluateGate requires an explicit clock', () => {
  it('throws rather than defaulting to Date.now() when temporalContext is absent', async () => {
    await expect(evaluateGate(CODED_GATE, depsWithout('temporalContext'))).rejects.toThrow(
      /temporalContext/i,
    );
  });

  it('throws when pathwayDefaults is absent (P1-10)', async () => {
    // Required, not optional: an omitted cascade input silently collapses to
    // system defaults while the preflight used pathway defaults.
    await expect(evaluateGate(CODED_GATE, depsWithout('pathwayDefaults'))).rejects.toThrow(
      /pathwayDefaults/i,
    );
  });

  it('throws when no dependencies are supplied at all', async () => {
    await expect(evaluateGate(CODED_GATE, undefined as never)).rejects.toThrow(
      /temporalContext/i,
    );
  });

  it('reads the evaluation clock from temporalContext, never from the wall clock', async () => {
    // A single occurrence dated 26 days before AS_OF, with a 30-day window and
    // a threshold of 1. Inside the window when the clock is the session's
    // pinned instant; far outside it when the clock is the real wall clock
    // (this suite runs long after 2026-06-27, and a Date.now() fallback would
    // make this fail).
    const gate: GateProperties = {
      title: 'recent flare',
      gate_type: GateType.PATIENT_ATTRIBUTE,
      default_behavior: DefaultBehavior.SKIP,
      condition: {
        field: 'conditions',
        operator: 'count_in_window',
        value: 'N39.0',
        system: 'ICD-10',
        window_days: 30,
        count_threshold: 1,
      },
    };
    const pc = patient({
      conditionCodes: [
        { code: 'N39.0', system: 'ICD-10', date: '2026-06-01T00:00:00.000Z' },
      ],
    });

    const pinned = await evaluateGate(gate, deps('legacy-v0', { patientContext: pc }));
    expect(pinned.satisfied).toBe(true);

    const later = await evaluateGate(
      gate,
      deps('legacy-v0', {
        patientContext: pc,
        temporalContext: makeEvaluationTemporalContext({
          evaluationAsOf: '2027-06-27T00:00:00.000Z',
        }),
      }),
    );
    expect(later.satisfied).toBe(false);
  });
});

// ─── The seam itself ──────────────────────────────────────────────────

/**
 * These three were SPY tests until the dispatch table was frozen.
 *
 * Task 3 wrote them with `jest.spyOn(CONDITION_EVALUATORS, ...)` and said so in
 * the header: at that task the two branches decided identically by
 * construction, so a spy on the table entry was the only honest proof that a
 * version routed where it claimed (P1-16). **That rationale expired at Task 4**,
 * where the paths diverged — the note at the bottom of this file records the
 * membership test that was deleted for exactly that reason.
 *
 * Freezing the table (the load-time coverage assertion otherwise proves only
 * what was true at module load) makes `jest.spyOn` impossible: it replaces the
 * property via `defineProperty`, which throws on a frozen object. So the proof
 * moves to behavior, which is now available and is strictly stronger — it shows
 * the routing has semantic CONSEQUENCE, not merely that a table slot was
 * touched.
 *
 * The discriminator: `factStore` is `[]` here while `patientContext` carries the
 * codes. `legacy-v0` reads the patient context, so a coded gate is satisfied;
 * `v1`'s kernel reads only the fact store, so the same gate is not. One input,
 * two answers, no mocking of production state.
 */
describe('the version seam dispatches on the session policy version', () => {
  it('routes legacy-v0 to the legacy evaluator, which reads the patient context', async () => {
    const result = await evaluateGate(CODED_GATE, deps('legacy-v0'));
    // Satisfied from `patientContext.conditionCodes` — only the legacy
    // evaluator looks there.
    expect(result.satisfied).toBe(true);
  });

  it('routes v1 to the kernel evaluator, which reads only the fact store', async () => {
    const result = await evaluateGate(CODED_GATE, deps('v1'));
    // Identical inputs, opposite answer: the kernel ignores `patientContext`
    // and the store is empty. If `v1` had fallen back to legacy this would be
    // `true`.
    expect(result.satisfied).toBe(false);
  });

  it('routes every condition of a compound gate through the same evaluator', async () => {
    // Sibling conditions must never resolve against different versions.
    //
    // OR, not AND, and the patient satisfies BOTH conditions under legacy.
    // That is what makes the assertion discriminating: under AND a single
    // condition escaping to the other version is invisible, because AND is
    // false either way. Under OR, `false` is only reachable if NEITHER sibling
    // reached the legacy evaluator.
    const compound: GateProperties = {
      title: 'compound',
      gate_type: GateType.COMPOUND,
      default_behavior: DefaultBehavior.SKIP,
      operator: 'OR',
      conditions: [
        { field: 'conditions', operator: 'includes_code', value: 'I10', system: 'ICD-10' },
        { field: 'medications', operator: 'includes_code', value: '7052', system: 'RXNORM' },
      ],
    };
    const pc = patient({
      conditionCodes: [{ code: 'I10', system: 'ICD-10' }],
      medications: [{ code: '7052', system: 'RXNORM' }],
    });

    // Baseline: under legacy both siblings are satisfiable, so OR is true.
    const legacy = await evaluateGate(compound, deps('legacy-v0', { patientContext: pc }));
    expect(legacy.satisfied).toBe(true);

    // Under v1 the whole gate must be false — one sibling on the legacy
    // evaluator would make OR true.
    const kernel = await evaluateGate(compound, deps('v1', { patientContext: pc }));
    expect(kernel.satisfied).toBe(false);
  });

  it('rejects an unknown version rather than falling back to legacy', async () => {
    await expect(evaluateGate(CODED_GATE, deps('v99'))).rejects.toThrow(/v99/);
  });

  it('rejects an unknown version even for a gate that reads no conditions', async () => {
    // The version check belongs at the seam, not lazily inside the condition
    // evaluator: a question gate must not quietly succeed on a session pinned
    // to a version the registry cannot resolve.
    const question: GateProperties = {
      title: 'Prior cesarean?',
      gate_type: GateType.QUESTION,
      default_behavior: DefaultBehavior.SKIP,
      prompt: 'Prior cesarean?',
      answer_type: AnswerType.BOOLEAN,
    };
    const answers = new Map<string, GateAnswer>([['q1', { booleanValue: true }]]);

    await expect(
      evaluateGate(question, deps('v99', { gateAnswers: answers, gateId: 'q1' })),
    ).rejects.toThrow(/v99/);
  });
});

// ─── The routing table is frozen ──────────────────────────────────────

/**
 * `assertConditionEvaluatorCoverage(CONDITION_EVALUATORS)` runs at module load.
 * While the table was mutable that proved only what was true AT load: any
 * importer could delete or replace an entry afterwards and the check would
 * never run again — the failure surfacing mid-traversal, on a session already
 * persisted, which is the exact failure the load-time check exists to prevent.
 *
 * Freezing turns the load-time proof into a permanent one. `TEMPORAL_POLICY_CAPABILITIES`
 * already had this treatment (`policy-registry.ts:143`, via `deepFreeze`); this
 * closes the matching hole in the evaluator table.
 *
 * The `!evaluator` guard in `conditionEvaluatorFor` stays and is still correct
 * defence: `assertKnownPolicyVersion` validates against the POLICY registry,
 * and the `version as TemporalPolicyVersion` cast that follows is unchecked at
 * the type level. Freezing stops the table from drifting; the guard is what
 * turns any remaining miss into a named error rather than "evaluator is not a
 * function" deep inside a gate.
 */
describe('the condition evaluator table cannot be mutated after load', () => {
  // Keyed on the evaluation MODE since R14-2, not on the policy version — the
  // version-keyed table was a second source of routing truth that could
  // disagree with the version's own capability row.
  it('refuses to replace a registered evaluator', () => {
    const replacement = jest.fn();
    expect(() => {
      (CONDITION_EVALUATORS as Record<string, unknown>)['legacy'] = replacement;
    }).toThrow(TypeError);
    // And the real evaluator is still in place.
    expect(CONDITION_EVALUATORS['legacy']).not.toBe(replacement);
  });

  it('refuses to delete a registered evaluator', () => {
    expect(() => {
      delete (CONDITION_EVALUATORS as Record<string, unknown>)['kernel'];
    }).toThrow(TypeError);
    expect(typeof CONDITION_EVALUATORS['kernel']).toBe('function');
  });

  it('refuses to add an unregistered mode', () => {
    expect(() => {
      (CONDITION_EVALUATORS as Record<string, unknown>)['shadow'] = jest.fn();
    }).toThrow(TypeError);
    expect((CONDITION_EVALUATORS as Record<string, unknown>)['shadow']).toBeUndefined();
  });

  it('holds no per-VERSION entry at all — there is nothing to disagree with', () => {
    // The R14-2 property, structurally: a table keyed on the version is what
    // made `evaluationMode: 'kernel'` + the legacy evaluator representable.
    expect((CONDITION_EVALUATORS as Record<string, unknown>)['legacy-v0']).toBeUndefined();
    expect((CONDITION_EVALUATORS as Record<string, unknown>)['v1']).toBeUndefined();
  });

  it('reports itself frozen', () => {
    expect(Object.isFrozen(CONDITION_EVALUATORS)).toBe(true);
  });
});

// ─── The fork is no longer a no-op ────────────────────────────────────
//
// Task 3's "decides identically under legacy-v0 and v1 for a membership gate"
// was DELETED at Task 4 — that is where the paths diverge, so the test became
// false by design. The membership deltas are pinned, both versions asserted, in
// gate-evaluator-membership-kernel.test.ts.
