/**
 * Review finding 1 — the numeric CONTROLS on a coded condition had no domain.
 *
 * The import validator checked condition keys, operators and fields, and the
 * runtime adapter checked field/operator/override grammar. Neither checked what
 * the aggregate controls actually CONTAIN, and the evaluator reads them raw:
 *
 *   - `slope_threshold` is compared as `slope < -slopeFloor` for `trend_down`
 *     (`gate-evaluator.ts:388` legacy, `:891` kernel). A NEGATIVE floor flips
 *     the comparison's sense — `slope_threshold: -1` turns `trend_down` into
 *     `slope < 1`, so a RISING series satisfies "trending down". That is a
 *     clinical decision reversed by a sign, and it imported cleanly.
 *   - `count_threshold: 0` makes an empty count succeed.
 *   - `min_points: 'three'` reaches `Math.max(2, ...)` as NaN, and every
 *     `length < NaN` comparison is false, so the series-length guard vanishes.
 *
 * The fix follows the **D9 precedent** exactly: ONE exported predicate
 * (`conditionControlDomainError`) that returns a message, pushed onto `errors`
 * by the import validator and thrown by the adapter. One source of truth, two
 * error protocols — the authoring boundary rejects precisely what preflight and
 * evaluation would (locked decision #7).
 *
 * **`window_days` is deliberately NOT checked here.** Its domain — a finite
 * positive integer within the cap — belongs to `parseHorizonValue`, reached via
 * `parseConditionOverride`, and duplicating it would give authors two places to
 * disagree with (the same reasoning that keeps `horizon`/`status` VALUES out of
 * the validator). A test below pins that it is still the parser, not this
 * predicate, that rejects a malformed `window_days`.
 */

import { evaluateGate } from '../../services/resolution/gate-evaluator';
import type { GateEvaluationDeps } from '../../services/resolution/gate-evaluator';
import {
  GateProperties,
  GateAnswer,
  NodeResult,
  GateType,
  DefaultBehavior,
  GateCondition,
  CodedCondition,
} from '../../services/resolution/types';
import { makeEvaluationTemporalContext } from '../../services/resolution/temporal/evaluation-context';
import {
  adaptCodedCondition,
  conditionControlDomainError,
} from '../../services/resolution/temporal/condition-adapter';
import type { NormalizedFact } from '../../services/resolution/temporal/fact-model';
import type { PatientContext } from '../../services/confidence/types';
import { validatePathwayJson } from '../../services/import/validator';
import { REFERENCE_PATHWAY, clonePathway } from '../fixtures/reference-pathway';

const AS_OF = '2026-08-11T00:00:00.000Z';
const ENCOUNTER_START = '2026-08-10T08:00:00.000Z';

const D_JUN = '2026-06-01';
const D_JUL = '2026-07-01';
const D_AUG = '2026-08-01';

const HGB = '4548-4';

function labFact(factId: string, day: string, value: number): NormalizedFact {
  return {
    kind: 'lab',
    factId,
    code: HGB,
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
    title: 'control-domain gate',
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
    codeMap: new Map(),
    patientContext: patient(),
    resolutionState: new Map<string, NodeResult>(),
    gateAnswers: new Map<string, GateAnswer>(),
    ...overrides,
  };
}

function addGateWithCondition(
  pw: ReturnType<typeof clonePathway>,
  condition: Record<string, unknown>,
): void {
  pw.nodes.push({
    id: 'gate-cond',
    type: 'Gate' as any,
    properties: {
      title: 'Condition test gate',
      gate_type: 'patient_attribute',
      default_behavior: 'skip',
      condition: condition as any,
    },
  });
  pw.edges.push({ from: 'step-1-1', to: 'gate-cond', type: 'HAS_GATE' as any });
  pw.edges.push({ from: 'gate-cond', to: 'step-1-2', type: 'BRANCHES_TO' as any });
}

// ─── The reproduction: a rising series satisfies `trend_down` ──────────

describe('the trend_down inversion a negative slope_threshold produces', () => {
  // Hgb 7 → 8 → 9 over two months: unambiguously RISING.
  const RISING_CONTEXT = {
    patientContext: patient({
      labResults: [
        { code: HGB, system: 'LOINC', value: 7, date: D_JUN },
        { code: HGB, system: 'LOINC', value: 8, date: D_JUL },
        { code: HGB, system: 'LOINC', value: 9, date: D_AUG },
      ],
    }),
    factStore: [labFact('l1', D_JUN, 7), labFact('l2', D_JUL, 8), labFact('l3', D_AUG, 9)],
  };

  const INVERTED: GateCondition = {
    field: 'labs',
    operator: 'trend_down',
    value: HGB,
    system: 'LOINC',
    min_points: 2,
    slope_threshold: -1,
  };

  it('is real: legacy-v0 answers "trending down" for a rising series', async () => {
    // The mechanism, pinned rather than reasoned about. `slope < -slopeFloor`
    // with slopeFloor = -1 is `slope < 1`, and the rising slope (~0.03/day) is
    // below 1. `legacy-v0` is frozen by locked decision #1, so this behavior
    // does NOT change — the fix is at the authoring boundary (no such pathway
    // can be imported again) and on the `v1` runtime.
    const legacy = await evaluateGate(gateFor(INVERTED), deps('legacy-v0', RISING_CONTEXT));
    expect(legacy.satisfied).toBe(true);
    expect(legacy.reason).toContain('satisfies trend_down');
  });

  it('is refused by the v1 runtime rather than answered', async () => {
    await expect(evaluateGate(gateFor(INVERTED), deps('v1', RISING_CONTEXT))).rejects.toThrow(
      /slope_threshold/,
    );
  });

  it('is refused at import, where the author can act on it', () => {
    const pw = clonePathway(REFERENCE_PATHWAY);
    addGateWithCondition(pw, {
      field: 'labs',
      operator: 'trend_down',
      value: HGB,
      system: 'LOINC',
      slope_threshold: -1,
    });
    const result = validatePathwayJson(pw);
    expect(result.valid).toBe(false);
    // Not reported as an unknown key — `slope_threshold` is a legitimate key
    // whose VALUE is out of domain.
    expect(result.errors).not.toContainEqual(expect.stringContaining('unknown key'));
    expect(result.errors).toContainEqual(expect.stringContaining('slope_threshold'));
  });

  it('leaves a non-negative slope_threshold answering exactly as before', async () => {
    // The confining assertion: the rule rejects the inverted sign and nothing
    // else. A rising series must still be unsatisfied for `trend_down`, and the
    // two versions must still agree.
    const ok: GateCondition = { ...(INVERTED as CodedCondition), slope_threshold: 1 };
    const legacy = await evaluateGate(gateFor(ok), deps('legacy-v0', RISING_CONTEXT));
    const v1 = await evaluateGate(gateFor(ok), deps('v1', RISING_CONTEXT));
    expect(legacy.satisfied).toBe(false);
    expect(v1.satisfied).toBe(false);
    expect(v1.reason).toBe(legacy.reason);
  });
});

// ─── The related domains ──────────────────────────────────────────────

describe('count_threshold and min_points domains', () => {
  it('refuses count_threshold: 0, which makes an empty count succeed', async () => {
    const zeroCount: GateCondition = {
      field: 'labs',
      operator: 'count_in_window',
      value: HGB,
      system: 'LOINC',
      count_threshold: 0,
    };
    // The defect it prevents, stated in the legacy answer: no labs at all, and
    // the gate opens.
    const legacy = await evaluateGate(gateFor(zeroCount), deps('legacy-v0'));
    expect(legacy.satisfied).toBe(true);

    await expect(evaluateGate(gateFor(zeroCount), deps('v1'))).rejects.toThrow(/count_threshold/);
    const pw = clonePathway(REFERENCE_PATHWAY);
    addGateWithCondition(pw, { ...zeroCount });
    expect(validatePathwayJson(pw).valid).toBe(false);
  });

  it('refuses a non-integer min_points, whose NaN silently removes the length guard', async () => {
    const nanPoints = {
      field: 'labs',
      operator: 'trend_up',
      value: HGB,
      system: 'LOINC',
      min_points: 'three',
    } as unknown as GateCondition;
    await expect(evaluateGate(gateFor(nanPoints), deps('v1'))).rejects.toThrow(/min_points/);
    const pw = clonePathway(REFERENCE_PATHWAY);
    addGateWithCondition(pw, nanPoints as unknown as Record<string, unknown>);
    expect(validatePathwayJson(pw).valid).toBe(false);
  });

  it('refuses a fractional min_points', () => {
    expect(conditionControlDomainError({ min_points: 2.5 })).toMatch(/min_points/);
    expect(conditionControlDomainError({ count_threshold: 1.5 })).toMatch(/count_threshold/);
  });
});

describe('conditionControlDomainError — the one predicate', () => {
  it('passes a condition that sets no controls at all', () => {
    expect(conditionControlDomainError({ field: 'labs', operator: 'exists', value: '' })).toBeNull();
  });

  it('passes every control at a legitimate value', () => {
    expect(
      conditionControlDomainError({
        threshold: 7.5,
        delta_threshold: -3,
        count_threshold: 1,
        min_points: 2,
        slope_threshold: 0,
      }),
    ).toBeNull();
  });

  it('keeps delta_threshold SIGNED — a negative delta means "fell by"', () => {
    // Unlike slope_threshold, whose sign is consumed by the evaluator's own
    // negation, delta_threshold's sign is the author's direction. Rejecting it
    // would break every "dropped by ≥3 g/dL" gate.
    expect(conditionControlDomainError({ delta_threshold: -10 })).toBeNull();
  });

  it('rejects non-finite numbers on the free-signed controls', () => {
    expect(conditionControlDomainError({ threshold: NaN })).toMatch(/threshold/);
    expect(conditionControlDomainError({ delta_threshold: Infinity })).toMatch(/delta_threshold/);
    expect(conditionControlDomainError({ threshold: '140' })).toMatch(/threshold/);
  });

  it('rejects zero and negative counts', () => {
    expect(conditionControlDomainError({ count_threshold: 0 })).toMatch(/count_threshold/);
    expect(conditionControlDomainError({ count_threshold: -2 })).toMatch(/count_threshold/);
    expect(conditionControlDomainError({ min_points: 0 })).toMatch(/min_points/);
  });

  it('rejects a negative slope_threshold and accepts zero', () => {
    expect(conditionControlDomainError({ slope_threshold: -0.001 })).toMatch(/slope_threshold/);
    expect(conditionControlDomainError({ slope_threshold: 0 })).toBeNull();
  });

  it('is the SAME message the validator reports and the adapter throws (D9 shape)', () => {
    const condition = { field: 'labs', operator: 'trend_down', value: HGB, slope_threshold: -1 };
    const message = conditionControlDomainError(condition);
    expect(message).not.toBeNull();

    // The adapter throws it...
    expect(() => adaptCodedCondition(condition as unknown as CodedCondition, 'here')).toThrow(
      message as string,
    );

    // ...and the validator pushes the identical text. Two spellings would be
    // two chances for authoring and evaluation to disagree.
    const pw = clonePathway(REFERENCE_PATHWAY);
    addGateWithCondition(pw, condition);
    expect(validatePathwayJson(pw).errors).toContainEqual(expect.stringContaining(message as string));
  });

  it('leaves window_days to parseConditionOverride, not to this predicate', () => {
    // The domain rule for `window_days` lives in `parseHorizonValue` (D2), and
    // duplicating it here is what locked decision #7 forbids. The predicate is
    // silent about it; the OVERRIDE PARSER is what rejects it, and it does so
    // from inside the same `adaptCodedCondition` call.
    expect(conditionControlDomainError({ window_days: -5 })).toBeNull();
    expect(() =>
      adaptCodedCondition(
        { field: 'labs', operator: 'count_in_window', value: HGB, window_days: -5 } as CodedCondition,
        'here',
      ),
    ).toThrow(/window_days/);
  });
});
