/**
 * Plan 04 Task 6 — aggregate operators on the `selectFacts` kernel.
 *
 * `count_in_window`, `trend_up`, `trend_down` and `delta_from_baseline` are the
 * third operator class whose `v1` branch stops reading `patientContext` and
 * reads the normalized `factStore` instead. Only **selection** moves: the count,
 * the linear-regression slope and the baseline/current delta stay in the
 * evaluator, byte-identical to `legacy-v0`'s, including their reason strings.
 *
 * **These proofs live at the unit level deliberately.** `deps.factStore` is
 * still `[]` at every resolver — the assembler that fills it is not wired until
 * Task 9 — so a traversal-level or end-to-end test could not exercise `v1`
 * aggregates at all and would pass no matter what this task did (P1-16). The
 * store is therefore constructed directly and handed to `evaluateGate`.
 *
 * Every "disclosed delta" case asserts BOTH versions against the same clinical
 * reality, expressed twice: as `patientContext` (what `legacy-v0` reads) and as
 * `factStore` (what `v1` reads). Locked decision #2 requires each delta to be
 * pinned, not merely introduced.
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
const D_JUN = '2026-06-01';
const D_JUL = '2026-07-01';
const D_AUG = '2026-08-01';
const D_OLD = '2026-01-05'; // ~218 days back — outside both QUARTER and a 90-day window
const D_FUTURE = '2026-09-01';

const HGB = '4548-4';

// ─── Fixture builders ─────────────────────────────────────────────────

/** A dated lab: a POINT fact (KNOWN end equal to the start bound). */
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
 * An undated lab, exactly as `assembleLabs` builds one: no `start`, end
 * `OPEN(evaluationAsOf)` (context-assembler.ts:185-189). `SyntheticLabResult.date`
 * is optional, so this is ordinary input rather than a contrived fixture.
 */
function undatedLabFact(factId: string, code: string, value: number): NormalizedFact {
  return {
    kind: 'lab',
    factId,
    code,
    system: 'LOINC',
    value,
    interval: { end: { kind: 'OPEN', assertedCurrentAt: AS_OF } },
    recordValidity: 'VALID',
    validityBasis: 'SYNTHETIC_DEFAULT',
    provenance: { sourceType: 'SYNTHETIC' },
  } as NormalizedFact;
}

/**
 * A dated, still-active condition — exactly what `assembleStateful` produces for
 * an entry with a `date` and no `endDate`: `OPEN(evaluationAsOf)`.
 */
function conditionFact(
  factId: string,
  code: string,
  day: string | undefined,
  overrides: Partial<NormalizedFact> = {},
): NormalizedFact {
  return {
    kind: 'condition',
    factId,
    code,
    system: 'ICD-10',
    interval: {
      ...(day ? { start: { value: day, precision: 'day' } } : {}),
      end: { kind: 'OPEN', assertedCurrentAt: AS_OF },
    },
    recordValidity: 'VALID',
    validityBasis: 'SYNTHETIC_DEFAULT',
    provenance: { sourceType: 'SYNTHETIC' },
    clinicalState: 'ACTIVE',
    stateAsOf: AS_OF,
    stateBasis: 'SYNTHETIC',
    ...overrides,
  } as NormalizedFact;
}

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
    title: 'aggregate gate',
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
    ...overrides,
  };
}

/** A lab as `PatientContext` carries it — the legacy view of the same reality. */
function labEntry(code: string, value: number, date?: string) {
  return date === undefined
    ? { code, system: 'LOINC', value }
    : { code, system: 'LOINC', value, date };
}

// ─── count_in_window ──────────────────────────────────────────────────

describe('count_in_window under v1', () => {
  const COUNT_90: GateCondition = {
    field: 'labs',
    operator: 'count_in_window',
    value: HGB,
    system: 'LOINC',
    window_days: 90,
  };

  it('filters to the window via the translated NODE horizon (D2)', async () => {
    // Three occurrences, one of them ~218 days old, window_days: 90 ⇒ count 2.
    // The COUNT is asserted through the reason string, not merely satisfaction:
    // at threshold 2 a regression to 3 would still satisfy and hide the bug.
    const shared = {
      patientContext: patient({
        labResults: [labEntry(HGB, 7, D_JUN), labEntry(HGB, 8, D_JUL), labEntry(HGB, 9, D_OLD)],
      }),
      factStore: [
        labFact('l1', HGB, D_JUN, 7),
        labFact('l2', HGB, D_JUL, 8),
        labFact('l3', HGB, D_OLD, 9),
      ],
    };
    const expected = `Found 2 matching ${HGB} in labs within last 90 days (≥2)`;

    const legacy = await evaluateGate(gateFor(COUNT_90), deps('legacy-v0', shared));
    const v1 = await evaluateGate(gateFor(COUNT_90), deps('v1', shared));

    expect(legacy.satisfied).toBe(true);
    expect(legacy.reason).toBe(expected);
    expect(v1.satisfied).toBe(true);
    // Byte-identical where the outcome matches — otherwise every version diff is
    // noise instead of signal.
    expect(v1.reason).toBe(expected);
    expect(v1.indeterminate).toBe(false);
    expect(v1.contextFieldsRead).toEqual(['labs']);
  });

  it('honours count_threshold at its exact boundary', async () => {
    const shared = {
      patientContext: patient({
        labResults: [labEntry(HGB, 7, D_JUN), labEntry(HGB, 8, D_JUL), labEntry(HGB, 9, D_OLD)],
      }),
      factStore: [
        labFact('l1', HGB, D_JUN, 7),
        labFact('l2', HGB, D_JUL, 8),
        labFact('l3', HGB, D_OLD, 9),
      ],
    };
    // Two in-window matches: satisfied at a threshold of 2, unsatisfied at 3.
    const at = await evaluateGate(
      gateFor({ ...COUNT_90, count_threshold: 2 }),
      deps('v1', shared),
    );
    expect(at.satisfied).toBe(true);
    expect(at.reason).toBe(`Found 2 matching ${HGB} in labs within last 90 days (≥2)`);

    const above = await evaluateGate(
      gateFor({ ...COUNT_90, count_threshold: 3 }),
      deps('v1', shared),
    );
    expect(above.satisfied).toBe(false);
    expect(above.reason).toBe(`Found 2 matching ${HGB} in labs within last 90 days (<3)`);
  });

  it('defaults count_threshold to 2 — one occurrence is not a recurrence', async () => {
    const one = await evaluateGate(
      gateFor(COUNT_90),
      deps('v1', { factStore: [labFact('l1', HGB, D_JUN, 7)] }),
    );
    expect(one.satisfied).toBe(false);
    expect(one.reason).toBe(`Found 1 matching ${HGB} in labs within last 90 days (<2)`);
  });

  it('counts distinct occurrences of the same code on different dates', async () => {
    // No window_days: the v1 lab horizon (QUARTER) governs, and both dates are
    // inside it. The reason names the window that was actually applied.
    const r = await evaluateGate(
      gateFor({ field: 'labs', operator: 'count_in_window', value: HGB, system: 'LOINC' }),
      deps('v1', {
        factStore: [labFact('l1', HGB, D_JUN, 7), labFact('l2', HGB, D_JUL, 8)],
      }),
    );
    expect(r.satisfied).toBe(true);
    expect(r.reason).toBe(`Found 2 matching ${HGB} in labs within last 90 days (≥2)`);
  });

  it('matches a trailing-wildcard code pattern, as legacy-v0 does', async () => {
    const shared = {
      patientContext: patient({
        labResults: [labEntry('4548-4', 7, D_JUN), labEntry('4548-9', 8, D_JUL)],
      }),
      factStore: [labFact('l1', '4548-4', D_JUN, 7), labFact('l2', '4548-9', D_JUL, 8)],
    };
    const gate = gateFor({ ...COUNT_90, value: '4548.*' });
    // '4548.*' is the trailing-wildcard spelling both implementations accept.
    const legacy = await evaluateGate(gate, deps('legacy-v0', shared));
    const v1 = await evaluateGate(gate, deps('v1', shared));
    expect(legacy.satisfied).toBe(true);
    expect(v1.satisfied).toBe(true);
    expect(v1.reason).toBe(legacy.reason);
  });

  it('respects an explicit system filter', async () => {
    const r = await evaluateGate(
      gateFor(COUNT_90),
      deps('v1', {
        factStore: [
          labFact('l1', HGB, D_JUN, 7, { system: 'SNOMED' }),
          labFact('l2', HGB, D_JUL, 8, { system: 'SNOMED' }),
        ],
      }),
    );
    expect(r.satisfied).toBe(false);
    expect(r.reason).toBe(`Found 0 matching ${HGB} in labs within last 90 days (<2)`);
  });
});

describe('disclosed v1 deltas — count_in_window', () => {
  it('excludes future-dated entries that legacy-v0 counts (upperBound = evaluationAsOf)', async () => {
    // A LIFETIME node horizon isolates the upper bound: legacy's isWithinWindow
    // short-circuits to `true` whenever window_days is absent, so it never
    // reaches its own future check and counts a result dated after the clock.
    const gate = gateFor({
      field: 'labs',
      operator: 'count_in_window',
      value: HGB,
      system: 'LOINC',
      horizon: 'LIFETIME',
    });
    const shared = {
      patientContext: patient({
        labResults: [labEntry(HGB, 7, D_OLD), labEntry(HGB, 8, D_JUL), labEntry(HGB, 9, D_FUTURE)],
      }),
      factStore: [
        labFact('l1', HGB, D_OLD, 7),
        labFact('l2', HGB, D_JUL, 8),
        labFact('l3', HGB, D_FUTURE, 9),
      ],
    };
    const legacy = await evaluateGate(gate, deps('legacy-v0', shared));
    const v1 = await evaluateGate(gate, deps('v1', shared));
    expect(legacy.reason).toBe(`Found 3 matching ${HGB} in labs within lifetime (≥2)`);
    expect(v1.reason).toBe(`Found 2 matching ${HGB} in labs within lifetime (≥2)`);
  });

});

// ─── D8: the aggregate class selects on the START bound ────────────────

/**
 * *** These two tests were INVERTED by the D8 decision. ***
 *
 * Task 6 wrote them as `disclosed v1 deltas`, pinning a defect it had found and
 * deliberately not fixed: `selectFacts` applied `overlap` to every operator
 * class, so a `count_in_window` counted any fact that was TRUE AT SOME POINT
 * inside the window rather than one that OCCURRED inside it. Because
 * `assembleStateful` gives every still-active entry `OPEN(evaluationAsOf)`
 * (context-assembler.ts:85), such a fact overlapped every horizon the resolver
 * can produce, and `window_days` was inert on conditions / medications /
 * allergies — the operator's own documented use case — with `v1` diverging from
 * `legacy-v0` in the PERMISSIVE direction on a recurrence gate.
 *
 * D8 settled it: the aggregate class gets occurrence semantics — in-window iff
 * `interval.start` is inside the horizon, with an undated fact excluded under a
 * bounded horizon and admitted under LIFETIME, faithfully translating legacy's
 * `isWithinWindow`. Membership and scalar keep `overlap`.
 *
 * They are kept, not deleted: the pinning is the point. What each pins is now
 * a CONVERGENCE with `legacy-v0` rather than a divergence from it, so a
 * regression to overlap-for-aggregates fails here exactly as loudly.
 */
describe('D8 — a count is over occurrences, so window_days discriminates again', () => {
  it('drops an UNDATED lab from a bounded window, exactly as legacy-v0 does', async () => {
    // legacy: `isWithinWindow(undefined, 90, now)` is false — a date-aware gate
    // cannot reason about un-dated history, so the entry is dropped.
    // v1 before D8: the assembler models an undated lab as OPEN(evaluationAsOf),
    // which overlapped every horizon containing the clock, so it counted.
    // v1 after D8: no `interval.start` and a bounded horizon ⇒ excluded, and
    // DEFINITELY so — this is not a fail-closed exclusion carrying doubt.
    const shared = {
      patientContext: patient({
        labResults: [labEntry(HGB, 7, D_JUL), labEntry(HGB, 8)],
      }),
      factStore: [labFact('l1', HGB, D_JUL, 7), undatedLabFact('l2', HGB, 8)],
    };
    const gate = gateFor({
      field: 'labs',
      operator: 'count_in_window',
      value: HGB,
      system: 'LOINC',
      window_days: 90,
    });
    const legacy = await evaluateGate(gate, deps('legacy-v0', shared));
    const v1 = await evaluateGate(gate, deps('v1', shared));
    expect(legacy.satisfied).toBe(false);
    expect(legacy.reason).toBe(`Found 1 matching ${HGB} in labs within last 90 days (<2)`);
    expect(v1.satisfied).toBe(false);
    expect(v1.reason).toBe(legacy.reason);
    expect(v1.indeterminate).toBe(false);
    expect(v1.uncertainty).toEqual([]);
  });

  it('does NOT count an ONGOING condition whose onset is outside the window', async () => {
    // `count_in_window` exists for recurrence — "3 UTIs in 12 months"
    // (select-facts.ts). legacy-v0 filters on the ENTRY DATE, so an onset 218
    // days ago falls outside a 90-day window. v1 now asks the same question of
    // the START bound, so the still-open end no longer drags the fact into
    // every horizon. Both versions count 1.
    const gate = gateFor({
      field: 'conditions',
      operator: 'count_in_window',
      value: 'N39.0',
      system: 'ICD-10',
      window_days: 90,
    });
    const shared = {
      patientContext: patient({
        conditionCodes: [
          { code: 'N39.0', system: 'ICD-10', date: D_JUL },
          { code: 'N39.0', system: 'ICD-10', date: D_OLD },
        ],
      }),
      factStore: [conditionFact('c1', 'N39.0', D_JUL), conditionFact('c2', 'N39.0', D_OLD)],
    };
    const legacy = await evaluateGate(gate, deps('legacy-v0', shared));
    const v1 = await evaluateGate(gate, deps('v1', shared));
    expect(legacy.satisfied).toBe(false);
    expect(legacy.reason).toBe('Found 1 matching N39.0 in conditions within last 90 days (<2)');
    expect(v1.satisfied).toBe(false);
    expect(v1.reason).toBe(legacy.reason);
    expect(v1.indeterminate).toBe(false);
    expect(v1.uncertainty).toEqual([]);
  });

  it('an UNDATED fact is still counted under LIFETIME, where legacy also counts it', async () => {
    // The other half of the translation: legacy's `windowDays === undefined`
    // branch returns true without looking at the date, so LIFETIME admits an
    // undated fact. A bounded horizon and LIFETIME must not answer alike, or
    // "exclude the undated" would just be "drop the undated".
    const shared = {
      patientContext: patient({
        labResults: [labEntry(HGB, 7, D_JUL), labEntry(HGB, 8)],
      }),
      factStore: [labFact('l1', HGB, D_JUL, 7), undatedLabFact('l2', HGB, 8)],
    };
    const gate = gateFor({
      field: 'labs',
      operator: 'count_in_window',
      value: HGB,
      system: 'LOINC',
      horizon: 'LIFETIME',
    });
    const legacy = await evaluateGate(gate, deps('legacy-v0', shared));
    const v1 = await evaluateGate(gate, deps('v1', shared));
    expect(legacy.reason).toBe(`Found 2 matching ${HGB} in labs within lifetime (≥2)`);
    expect(v1.satisfied).toBe(true);
    expect(v1.reason).toBe(legacy.reason);
  });

  it('membership over the SAME ongoing condition is unaffected — it keeps overlap', async () => {
    // The scope boundary, asserted rather than asserted-about. "Does the patient
    // have an active UTI during the window?" is a genuine overlap question and
    // its answer must not move when the count's does.
    const gate = gateFor({
      field: 'conditions',
      operator: 'includes_code',
      value: 'N39.0',
      system: 'ICD-10',
      window_days: 90,
    });
    const shared = { factStore: [conditionFact('c2', 'N39.0', D_OLD)] };
    const v1 = await evaluateGate(gate, deps('v1', shared));
    expect(v1.satisfied).toBe(true);
  });
});

// ─── D5 / P1-11: a definite aggregate still reports its uncertainty ────

describe('a definite aggregate still reports its uncertainty (D5, P1-11)', () => {
  it('clears its threshold while recording that the count is a lower bound', async () => {
    // The aggregate class fails CLOSED: the validity-UNKNOWN result does not
    // count. `selectFacts` still returns READY (not INDETERMINATE) after
    // excluding it (select-facts.ts:196-201), so a definite aggregate carrying
    // real uncertainty is the NORMAL case, not an edge case.
    const r = await evaluateGate(
      gateFor({
        field: 'labs',
        operator: 'count_in_window',
        value: HGB,
        system: 'LOINC',
        window_days: 90,
      }),
      deps('v1', {
        factStore: [
          labFact('l1', HGB, D_JUN, 7),
          labFact('l2', HGB, D_JUL, 8),
          labFact('l3', HGB, D_AUG, 9, {
            recordValidity: 'UNKNOWN',
            validityBasis: 'observation:preliminary',
          }),
        ],
      }),
    );
    expect(r.satisfied).toBe(true);
    expect(r.indeterminate).toBe(false); // the answer is certain
    expect(r.uncertainty).toEqual(['VALIDITY_UNKNOWN']); // the doubt is still real
    // The count is a LOWER BOUND — three results matched, two were countable.
    expect(r.reason).toBe(`Found 2 matching ${HGB} in labs within last 90 days (≥2)`);
  });

  it('excludes the uncertain fact rather than failing open like membership', async () => {
    const r = await evaluateGate(
      gateFor({
        field: 'labs',
        operator: 'count_in_window',
        value: HGB,
        system: 'LOINC',
        window_days: 90,
      }),
      deps('v1', {
        factStore: [
          labFact('l1', HGB, D_JUN, 7),
          labFact('l2', HGB, D_JUL, 8, {
            recordValidity: 'UNKNOWN',
            validityBasis: 'observation:preliminary',
          }),
        ],
      }),
    );
    expect(r.satisfied).toBe(false);
    expect(r.indeterminate).toBe(false);
    expect(r.uncertainty).toEqual(['VALIDITY_UNKNOWN']);
    expect(r.reason).toBe(`Found 1 matching ${HGB} in labs within last 90 days (<2)`);
  });
});

// ─── trend_up / trend_down ────────────────────────────────────────────

describe('trend_up and trend_down operate on the kernel-selected series', () => {
  const RISING = {
    patientContext: patient({
      labResults: [labEntry(HGB, 5, D_JUN), labEntry(HGB, 7, D_JUL), labEntry(HGB, 9, D_AUG)],
    }),
    factStore: [
      labFact('l1', HGB, D_JUN, 5),
      labFact('l2', HGB, D_JUL, 7),
      labFact('l3', HGB, D_AUG, 9),
    ],
  };
  const FALLING = {
    patientContext: patient({
      labResults: [labEntry(HGB, 9, D_JUN), labEntry(HGB, 7, D_JUL), labEntry(HGB, 5, D_AUG)],
    }),
    factStore: [
      labFact('l1', HGB, D_JUN, 9),
      labFact('l2', HGB, D_JUL, 7),
      labFact('l3', HGB, D_AUG, 5),
    ],
  };
  const trend = (op: 'trend_up' | 'trend_down', extra = {}): GateCondition => ({
    field: 'labs',
    operator: op,
    value: HGB,
    system: 'LOINC',
    ...extra,
  });

  it('satisfies trend_up on a rising series, with legacy-v0’s reason verbatim', async () => {
    const legacy = await evaluateGate(gateFor(trend('trend_up')), deps('legacy-v0', RISING));
    const v1 = await evaluateGate(gateFor(trend('trend_up')), deps('v1', RISING));
    expect(legacy.satisfied).toBe(true);
    expect(v1.satisfied).toBe(true);
    expect(v1.reason).toBe(legacy.reason);
    expect(v1.reason).toMatch(/^4548-4 slope 0\.\d+ value\/day satisfies trend_up$/);
    expect(v1.indeterminate).toBe(false);
  });

  it('does NOT satisfy trend_down on that same rising series', async () => {
    const v1 = await evaluateGate(gateFor(trend('trend_down')), deps('v1', RISING));
    expect(v1.satisfied).toBe(false);
    expect(v1.reason).toMatch(/does not satisfy trend_down$/);
  });

  it('satisfies trend_down on a falling series, with legacy-v0’s reason verbatim', async () => {
    const legacy = await evaluateGate(gateFor(trend('trend_down')), deps('legacy-v0', FALLING));
    const v1 = await evaluateGate(gateFor(trend('trend_down')), deps('v1', FALLING));
    expect(legacy.satisfied).toBe(true);
    expect(v1.satisfied).toBe(true);
    expect(v1.reason).toBe(legacy.reason);
    expect(v1.reason).toMatch(/^4548-4 slope -0\.\d+ value\/day satisfies trend_down$/);
  });

  it('does NOT satisfy trend_up on that same falling series', async () => {
    const v1 = await evaluateGate(gateFor(trend('trend_up')), deps('v1', FALLING));
    expect(v1.satisfied).toBe(false);
    expect(v1.reason).toMatch(/does not satisfy trend_up$/);
  });

  it('needs min_points dated values inside the horizon — default 3 for a trend', async () => {
    const two = {
      patientContext: patient({
        labResults: [labEntry(HGB, 5, D_JUN), labEntry(HGB, 9, D_JUL)],
      }),
      factStore: [labFact('l1', HGB, D_JUN, 5), labFact('l2', HGB, D_JUL, 9)],
    };
    const legacy = await evaluateGate(gateFor(trend('trend_up')), deps('legacy-v0', two));
    const v1 = await evaluateGate(gateFor(trend('trend_up')), deps('v1', two));
    expect(legacy.reason).toBe(`Need ≥3 dated values for ${HGB}; found 2`);
    expect(v1.satisfied).toBe(false);
    expect(v1.reason).toBe(legacy.reason);
    expect(v1.indeterminate).toBe(false);
  });

  it('honours an explicit min_points', async () => {
    const two = {
      factStore: [labFact('l1', HGB, D_JUN, 5), labFact('l2', HGB, D_JUL, 9)],
    };
    expect(
      (await evaluateGate(gateFor(trend('trend_up', { min_points: 2 })), deps('v1', two)))
        .satisfied,
    ).toBe(true);
    expect(
      (await evaluateGate(gateFor(trend('trend_up', { min_points: 4 })), deps('v1', two))).reason,
    ).toBe(`Need ≥4 dated values for ${HGB}; found 2`);
  });

  it('honours slope_threshold as a magnitude floor', async () => {
    // The rising series climbs ~0.065 units/day; a floor of 1 is far above it.
    const steep = await evaluateGate(
      gateFor(trend('trend_up', { slope_threshold: 1 })),
      deps('v1', RISING),
    );
    expect(steep.satisfied).toBe(false);
    expect(steep.reason).toMatch(/does not satisfy trend_up$/);

    const gentle = await evaluateGate(
      gateFor(trend('trend_up', { slope_threshold: 0.01 })),
      deps('v1', RISING),
    );
    expect(gentle.satisfied).toBe(true);
    expect(gentle.reason).toMatch(/satisfies trend_up \(\|slope\| > 0\.01\)$/);
  });

  it('drops a lab outside the QUARTER horizon that legacy-v0 admits under LIFETIME', async () => {
    const straddling = {
      patientContext: patient({
        labResults: [labEntry(HGB, 1, D_OLD), labEntry(HGB, 5, D_JUN), labEntry(HGB, 9, D_JUL)],
      }),
      factStore: [
        labFact('l0', HGB, D_OLD, 1),
        labFact('l1', HGB, D_JUN, 5),
        labFact('l2', HGB, D_JUL, 9),
      ],
    };
    const legacy = await evaluateGate(gateFor(trend('trend_up')), deps('legacy-v0', straddling));
    expect(legacy.satisfied).toBe(true);

    const v1 = await evaluateGate(gateFor(trend('trend_up')), deps('v1', straddling));
    expect(v1.satisfied).toBe(false);
    expect(v1.reason).toBe(`Need ≥3 dated values for ${HGB}; found 2`);
  });

  it('rejects a non-labs field exactly as legacy-v0 does', async () => {
    const gate = gateFor({
      field: 'conditions',
      operator: 'trend_up',
      value: 'N39.0',
      system: 'ICD-10',
    });
    const shared = { factStore: [conditionFact('c1', 'N39.0', D_JUL)] };
    const legacy = await evaluateGate(gate, deps('legacy-v0', shared));
    const v1 = await evaluateGate(gate, deps('v1', shared));
    expect(legacy.reason).toBe('trend_up only supports field=labs (got "conditions")');
    expect(v1.satisfied).toBe(false);
    expect(v1.reason).toBe(legacy.reason);
  });
});

// ─── delta_from_baseline ──────────────────────────────────────────────

describe('delta_from_baseline operates on the kernel-selected series', () => {
  const delta = (extra = {}): GateCondition => ({
    field: 'labs',
    operator: 'delta_from_baseline',
    value: HGB,
    system: 'LOINC',
    ...extra,
  });
  const ROSE_BY_4 = {
    patientContext: patient({
      labResults: [labEntry(HGB, 5, D_JUN), labEntry(HGB, 9, D_JUL)],
    }),
    factStore: [labFact('l1', HGB, D_JUN, 5), labFact('l2', HGB, D_JUL, 9)],
  };

  it('compares newest minus oldest against a positive delta_threshold', async () => {
    const legacy = await evaluateGate(
      gateFor(delta({ delta_threshold: 3 })),
      deps('legacy-v0', ROSE_BY_4),
    );
    const v1 = await evaluateGate(gateFor(delta({ delta_threshold: 3 })), deps('v1', ROSE_BY_4));
    expect(legacy.satisfied).toBe(true);
    expect(v1.satisfied).toBe(true);
    expect(v1.reason).toBe(legacy.reason);
    expect(v1.reason).toBe(
      `${HGB} delta 4.0000 (baseline 5, current 9) satisfies threshold 3`,
    );
    expect(v1.indeterminate).toBe(false);
  });

  it('is unsatisfied when the rise falls short of delta_threshold', async () => {
    const v1 = await evaluateGate(gateFor(delta({ delta_threshold: 5 })), deps('v1', ROSE_BY_4));
    expect(v1.satisfied).toBe(false);
    expect(v1.reason).toBe(
      `${HGB} delta 4.0000 (baseline 5, current 9) does not satisfy threshold 5`,
    );
  });

  it('reads a NEGATIVE delta_threshold as a required drop', async () => {
    const fell = {
      factStore: [labFact('l1', HGB, D_JUN, 9), labFact('l2', HGB, D_JUL, 5)],
    };
    expect(
      (await evaluateGate(gateFor(delta({ delta_threshold: -3 })), deps('v1', fell))).satisfied,
    ).toBe(true);
    expect(
      (await evaluateGate(gateFor(delta({ delta_threshold: -5 })), deps('v1', fell))).satisfied,
    ).toBe(false);
  });

  it('orders the series by effective time, never by array order', async () => {
    // The same two results, listed newest-first. Baseline must still be the
    // OLDER value: order-independence is the point of moving selection into the
    // kernel.
    const reversed = {
      factStore: [labFact('l2', HGB, D_JUL, 9), labFact('l1', HGB, D_JUN, 5)],
    };
    const r = await evaluateGate(gateFor(delta({ delta_threshold: 3 })), deps('v1', reversed));
    expect(r.satisfied).toBe(true);
    expect(r.reason).toBe(`${HGB} delta 4.0000 (baseline 5, current 9) satisfies threshold 3`);
  });

  it('needs min_points dated values — default 2 for a delta', async () => {
    const one = { factStore: [labFact('l1', HGB, D_JUN, 5)] };
    const r = await evaluateGate(gateFor(delta({ delta_threshold: 3 })), deps('v1', one));
    expect(r.satisfied).toBe(false);
    expect(r.reason).toBe(`Need ≥2 dated values for ${HGB}; found 1`);
  });

  it('rejects a non-labs field exactly as legacy-v0 does', async () => {
    const gate = gateFor({
      field: 'medications',
      operator: 'delta_from_baseline',
      value: 'RX1',
      system: 'RXNORM',
    });
    const legacy = await evaluateGate(gate, deps('legacy-v0'));
    const v1 = await evaluateGate(gate, deps('v1'));
    expect(legacy.reason).toBe('delta_from_baseline only supports field=labs (got "medications")');
    expect(v1.reason).toBe(legacy.reason);
  });
});

// ─── D7: an undated fact poisons the series ───────────────────────────

describe('D7 — an undated observation is admitted but not orderable', () => {
  it('fails closed on a LIFETIME series containing one undated lab, and says why', async () => {
    // Three perfectly dated, rising results plus ONE undated one. legacy-v0
    // drops the undated entry and sees a clean rising series. v1 admits it, but
    // `effectiveRange` gives it (-∞, +∞), so no strict total order exists and
    // the series is refused (select-facts.ts). Accepted and disclosed (D7); do
    // not "fix" it by inventing an ordering rule.
    //
    // **The explicit LIFETIME horizon is required by D8 and was not here
    // before.** `trend_*` is an aggregate operator, so under the default lab
    // horizon (QUARTER — bounded) the undated lab is now excluded outright and
    // the series is clean. D8's residual difference is exactly this: LIFETIME
    // admits an undated observation that legacy's `collectLabSeries` always
    // drops, and D7 then makes it poison the ordering. That is the surviving
    // reach of D7 in the aggregate class, so this is where it must be pinned.
    // The bounded-horizon case is pinned by the next test.
    const shared = {
      patientContext: patient({
        labResults: [
          labEntry(HGB, 5, D_JUN),
          labEntry(HGB, 7, D_JUL),
          labEntry(HGB, 9, D_AUG),
          labEntry(HGB, 3),
        ],
      }),
      factStore: [
        labFact('l1', HGB, D_JUN, 5),
        labFact('l2', HGB, D_JUL, 7),
        labFact('l3', HGB, D_AUG, 9),
        undatedLabFact('l4', HGB, 3),
      ],
    };
    const gate = gateFor({
      field: 'labs',
      operator: 'trend_up',
      value: HGB,
      system: 'LOINC',
      horizon: 'LIFETIME',
    });
    const legacy = await evaluateGate(gate, deps('legacy-v0', shared));
    expect(legacy.satisfied).toBe(true);

    const v1 = await evaluateGate(gate, deps('v1', shared));
    expect(v1.satisfied).toBe(false);
    expect(v1.indeterminate).toBe(true);
    expect(v1.uncertainty).toContain('AMBIGUOUS_SERIES_ORDER');
    // A fail-closed refusal must not read like an ordinary shortfall.
    expect(v1.reason).not.toMatch(/dated values/);
    expect(v1.reason).toMatch(/AMBIGUOUS_SERIES_ORDER/);
  });

  it('does NOT poison a BOUNDED-horizon series — D8 drops the undated lab first', async () => {
    // The same four results under the default QUARTER lab horizon. The undated
    // lab has no start bound, so the aggregate predicate excludes it before
    // ordering is ever attempted, and v1 converges on legacy-v0's clean rising
    // series. D7's reach is narrowed by D8, not removed: it survives at
    // LIFETIME, pinned by the test above.
    const shared = {
      patientContext: patient({
        labResults: [
          labEntry(HGB, 5, D_JUN),
          labEntry(HGB, 7, D_JUL),
          labEntry(HGB, 9, D_AUG),
          labEntry(HGB, 3),
        ],
      }),
      factStore: [
        labFact('l1', HGB, D_JUN, 5),
        labFact('l2', HGB, D_JUL, 7),
        labFact('l3', HGB, D_AUG, 9),
        undatedLabFact('l4', HGB, 3),
      ],
    };
    const gate = gateFor({ field: 'labs', operator: 'trend_up', value: HGB, system: 'LOINC' });
    const legacy = await evaluateGate(gate, deps('legacy-v0', shared));
    const v1 = await evaluateGate(gate, deps('v1', shared));
    expect(legacy.satisfied).toBe(true);
    expect(v1.satisfied).toBe(true);
    expect(v1.indeterminate).toBe(false);
    expect(v1.reason).toBe(legacy.reason);
  });

  it('refuses a delta over two results on the SAME day that legacy-v0 computes', async () => {
    // Day precision: both ranges span the same 24 hours, so neither is strictly
    // after the other. Same blind spot, reached without any undated fact.
    const shared = {
      patientContext: patient({
        labResults: [labEntry(HGB, 5, D_JUN), labEntry(HGB, 9, D_JUN)],
      }),
      factStore: [labFact('l1', HGB, D_JUN, 5), labFact('l2', HGB, D_JUN, 9)],
    };
    const gate = gateFor({
      field: 'labs',
      operator: 'delta_from_baseline',
      value: HGB,
      system: 'LOINC',
      delta_threshold: 3,
    });
    expect((await evaluateGate(gate, deps('legacy-v0', shared))).satisfied).toBe(true);

    const v1 = await evaluateGate(gate, deps('v1', shared));
    expect(v1.satisfied).toBe(false);
    expect(v1.indeterminate).toBe(true);
    expect(v1.uncertainty).toContain('AMBIGUOUS_SERIES_ORDER');
  });

  it('leaves a SINGLE undated lab as an ordinary min_points shortfall', async () => {
    // One candidate is trivially ordered, so the kernel says READY. The fact
    // still contributes no series point — it has no position in time — which is
    // exactly what legacy-v0 reports too.
    const shared = {
      patientContext: patient({ labResults: [labEntry(HGB, 3)] }),
      factStore: [undatedLabFact('l1', HGB, 3)],
    };
    const gate = gateFor({ field: 'labs', operator: 'trend_up', value: HGB, system: 'LOINC' });
    const legacy = await evaluateGate(gate, deps('legacy-v0', shared));
    const v1 = await evaluateGate(gate, deps('v1', shared));
    expect(legacy.reason).toBe(`Need ≥3 dated values for ${HGB}; found 0`);
    expect(v1.satisfied).toBe(false);
    expect(v1.indeterminate).toBe(false);
    expect(v1.reason).toBe(legacy.reason);
  });
});

// ─── legacy-v0 is untouched ───────────────────────────────────────────

describe('legacy-v0 reads the patient context and never the fact store', () => {
  const COUNT: GateCondition = {
    field: 'labs',
    operator: 'count_in_window',
    value: HGB,
    system: 'LOINC',
    window_days: 90,
  };

  it('is unsatisfied when only the fact store carries the occurrences', async () => {
    const r = await evaluateGate(
      gateFor(COUNT),
      deps('legacy-v0', {
        factStore: [labFact('l1', HGB, D_JUN, 7), labFact('l2', HGB, D_JUL, 8)],
      }),
    );
    expect(r.satisfied).toBe(false);
  });

  it('records neither indeterminate nor uncertainty on an aggregate gate', async () => {
    const r = await evaluateGate(
      gateFor(COUNT),
      deps('legacy-v0', {
        patientContext: patient({
          labResults: [labEntry(HGB, 7, D_JUN), labEntry(HGB, 8, D_JUL)],
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
  it('throws MISSING_ENCOUNTER_ANCHOR for a v1 vitals aggregate with no encounterStart', async () => {
    const gate = gateFor({
      field: 'vitals',
      operator: 'count_in_window',
      value: 'systolic_bp',
    });
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

  it('resolves policy BEFORE the labs-only check, so a vitals trend also rejects', async () => {
    // The ordering matters. legacy-v0 short-circuits `field !== 'labs'` before
    // reading anything temporal; if v1 inherited that order, a vitals trend gate
    // would pass evaluation quietly while the v1 anchor sweep rejected the whole
    // session for the very same condition — the divergence locked decision #7
    // forbids.
    const gate = gateFor({ field: 'vitals', operator: 'trend_up', value: 'systolic_bp' });
    const noAnchor: GateEvaluationDeps = {
      ...deps('v1'),
      temporalContext: makeEvaluationTemporalContext({
        evaluationAsOf: AS_OF,
        temporalPolicyVersion: 'v1',
      }),
    };
    await expect(evaluateGate(gate, noAnchor)).rejects.toMatchObject({
      code: 'MISSING_ENCOUNTER_ANCHOR',
    });
    // legacy-v0 keeps its short-circuit, untouched.
    const legacy = await evaluateGate(gate, {
      ...deps('legacy-v0'),
      temporalContext: makeEvaluationTemporalContext({
        evaluationAsOf: AS_OF,
        temporalPolicyVersion: 'legacy-v0',
      }),
    });
    expect(legacy.reason).toBe('trend_up only supports field=labs (got "vitals")');
  });

  it('rejects an aggregate field with no fact kind under v1', async () => {
    const gate = gateFor({
      field: 'horoscopes' as never,
      operator: 'count_in_window',
      value: 'leo',
    });
    await expect(evaluateGate(gate, deps('v1'))).rejects.toThrow(/horoscopes/);
  });

  it('rejects a condition supplying both window_days and horizon (D2)', async () => {
    const gate = gateFor({
      field: 'labs',
      operator: 'count_in_window',
      value: HGB,
      window_days: 90,
      horizon: 'YEAR',
    });
    await expect(evaluateGate(gate, deps('v1'))).rejects.toThrow(/window_days|horizon/);
  });
});
