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

describe('the version seam dispatches on the session policy version', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('routes legacy-v0 to the legacy evaluator', async () => {
    const legacy = jest.spyOn(CONDITION_EVALUATORS, 'legacy-v0');
    const kernel = jest.spyOn(CONDITION_EVALUATORS, 'v1');

    await evaluateGate(CODED_GATE, deps('legacy-v0'));

    expect(legacy).toHaveBeenCalledTimes(1);
    expect(kernel).not.toHaveBeenCalled();
  });

  it('routes v1 to the kernel evaluator', async () => {
    const legacy = jest.spyOn(CONDITION_EVALUATORS, 'legacy-v0');
    const kernel = jest.spyOn(CONDITION_EVALUATORS, 'v1');

    await evaluateGate(CODED_GATE, deps('v1'));

    expect(kernel).toHaveBeenCalledTimes(1);
    expect(legacy).not.toHaveBeenCalled();
  });

  it('routes every condition of a compound gate through the same evaluator', async () => {
    // Sibling conditions must never resolve against different versions.
    const kernel = jest.spyOn(CONDITION_EVALUATORS, 'v1');
    const compound: GateProperties = {
      title: 'compound',
      gate_type: GateType.COMPOUND,
      default_behavior: DefaultBehavior.SKIP,
      operator: 'AND',
      conditions: [
        { field: 'conditions', operator: 'includes_code', value: 'I10', system: 'ICD-10' },
        { field: 'medications', operator: 'includes_code', value: '7052', system: 'RXNORM' },
      ],
    };

    await evaluateGate(compound, deps('v1'));

    expect(kernel).toHaveBeenCalledTimes(2);
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

// ─── The fork is no longer a no-op ────────────────────────────────────
//
// Task 3's "decides identically under legacy-v0 and v1 for a membership gate"
// was DELETED at Task 4 — that is where the paths diverge, so the test became
// false by design. The membership deltas are pinned, both versions asserted, in
// gate-evaluator-membership-kernel.test.ts.
