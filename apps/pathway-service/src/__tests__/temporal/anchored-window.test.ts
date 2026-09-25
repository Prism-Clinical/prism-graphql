/**
 * Anchored trend windows (`window_from`) — anchor resolution and the kernel.
 *
 * Resolution order: clinician date → earliest care-plan recommendation →
 * earliest dated medication order of the class → unresolved (indeterminate,
 * never a fallback window). Pinned to `v1` throughout: the kernel is the only
 * path that resolves anchors, and `legacy-v0` refuses the key.
 */

import {
  resolveWindowAnchor,
  withTherapyStarts,
  anchorKeyFor,
  parseWindowFrom,
  TherapyStartEvent,
} from '../../services/resolution/temporal/anchored-window';
import {
  makeEvaluationTemporalContext,
  TemporalContextError,
} from '../../services/resolution/temporal/evaluation-context';
import { resolveEffectivePolicy, toEffectivePolicy } from '../../services/resolution/temporal/cascade';
import { parseConditionOverride } from '../../services/resolution/temporal/condition-adapter';
import { assembleContext } from '../../services/resolution/temporal/context-assembler';
import { evaluateGate } from '../../services/resolution/gate-evaluator';
import type { GateEvaluationDeps } from '../../services/resolution/gate-evaluator';
import {
  GateType,
  DefaultBehavior,
  GateProperties,
  GateAnswer,
} from '../../services/resolution/types';
import type { PatientContext } from '../../services/confidence/types';

const AS_OF = '2026-09-01T12:00:00.000Z';
const HGB = '718-7';

// Three interchangeable oral irons — the class. Placeholder codes: the test is
// about class membership, not about which RxCUI a product has.
const SULFATE = { system: 'RXNORM', code: 'RX-FE-SULFATE' };
const GLUCONATE = { system: 'RXNORM', code: 'RX-FE-GLUCONATE' };
const FUMARATE = { system: 'RXNORM', code: 'RX-FE-FUMARATE' };

const ORAL_IRON_RAW = {
  event: 'medication_start',
  clinical_role: 'oral-iron-repletion',
  label: 'oral iron',
  codes: [SULFATE, GLUCONATE, FUMARATE],
};
const ORAL_IRON = parseWindowFrom(ORAL_IRON_RAW, 'test');
const KEY = anchorKeyFor(ORAL_IRON);

function carePlanStart(date: string, carePlanId: string, nodeId = 'med-1'): TherapyStartEvent {
  return {
    clinicalRole: 'oral-iron-repletion',
    date,
    source: { carePlanId, interventionId: `i-${carePlanId}`, pathwayId: 'pw-anemia', nodeId },
  };
}

function patient(opts: {
  labs?: Array<{ date?: string; value: number }>;
  medications?: Array<{ code: string; system: string; date?: string; display?: string; recordValidity?: string }>;
}): PatientContext {
  return {
    patientId: 'pt-1',
    conditionCodes: [],
    medications: opts.medications ?? [],
    allergies: [],
    labResults: (opts.labs ?? []).map((l) => ({
      code: HGB, system: 'LOINC', value: l.value, ...(l.date ? { date: l.date } : {}),
    })),
  } as unknown as PatientContext;
}

function context(therapyStarts: TherapyStartEvent[] = [], version = 'v1') {
  return withTherapyStarts(
    makeEvaluationTemporalContext({ evaluationAsOf: AS_OF, temporalPolicyVersion: version }),
    therapyStarts,
  );
}

function deps(
  pc: PatientContext,
  opts: { therapyStarts?: TherapyStartEvent[]; answers?: Map<string, GateAnswer>; version?: string } = {},
): GateEvaluationDeps {
  const temporalContext = context(opts.therapyStarts ?? [], opts.version ?? 'v1');
  return {
    temporalContext,
    pathwayDefaults: {},
    factStore:
      (opts.version ?? 'v1') === 'v1'
        ? assembleContext({ mode: 'SYNTHETIC', patientContext: pc } as never, temporalContext)
        : [],
    patientContext: pc,
    resolutionState: new Map(),
    gateAnswers: opts.answers ?? new Map(),
    codeMap: new Map(),
  };
}

const TREND_UP = {
  field: 'labs' as const,
  operator: 'trend_up' as const,
  value: HGB,
  system: 'LOINC',
  display: 'Hemoglobin (g/dL)',
  slope_threshold: 0.015,
  min_points: 2,
  window_from: ORAL_IRON_RAW,
};

function trendGate(condition: Record<string, unknown> = TREND_UP): GateProperties {
  return {
    title: 'Responding to oral iron?',
    gate_type: GateType.PATIENT_ATTRIBUTE,
    default_behavior: DefaultBehavior.SKIP,
    condition: condition as never,
  } as GateProperties;
}

// A textbook responder diagnosed mid-pregnancy: a normal early value, a drop
// to 8.2 when iron starts on 2026-06-01, then a climb. Over the whole history
// the early 12.8 drags the slope negative; from the start date it is positive.
const RESPONDER_LABS = [
  { date: '2026-03-01', value: 12.8 },
  { date: '2026-06-01', value: 8.2 },
  { date: '2026-07-01', value: 9.0 },
  { date: '2026-08-15', value: 9.9 },
];

// ─── Resolution order ────────────────────────────────────────────────

describe('resolveWindowAnchor', () => {
  const inputs = (
    pc: PatientContext,
    therapyStarts: TherapyStartEvent[] = [],
    answers = new Map<string, GateAnswer>(),
  ) => {
    const temporalContext = context(therapyStarts);
    return {
      gateAnswers: answers,
      factStore: assembleContext({ mode: 'SYNTHETIC', patientContext: pc } as never, temporalContext),
      temporalContext,
    };
  };

  it('anchors on the care-plan recommendation, EARLIEST across materializations', () => {
    // Three commits, three plans. Latest-wins would anchor on August and
    // shrink the window every visit.
    const r = resolveWindowAnchor(
      ORAL_IRON,
      inputs(patient({}), [
        carePlanStart('2026-07-10', 'cp-2'),
        carePlanStart('2026-06-01', 'cp-1'),
        carePlanStart('2026-08-20', 'cp-3', 'med-2'),
      ]),
    );
    expect(r).toMatchObject({
      status: 'RESOLVED', key: KEY, date: '2026-06-01', source: 'CARE_PLAN',
      lowerBound: '2026-06-01T00:00:00.000Z',
    });
    expect(r.status === 'RESOLVED' && r.detail).toContain('cp-1');
  });

  it('outranks a medication order with the care plan', () => {
    const r = resolveWindowAnchor(
      ORAL_IRON,
      inputs(
        patient({ medications: [{ ...GLUCONATE, date: '2026-05-01' }] }),
        [carePlanStart('2026-06-01', 'cp-1')],
      ),
    );
    expect(r).toMatchObject({ date: '2026-06-01', source: 'CARE_PLAN' });
  });

  it('falls to the earliest dated medication order of the class', () => {
    const r = resolveWindowAnchor(
      ORAL_IRON,
      inputs(
        patient({
          medications: [
            { ...GLUCONATE, date: '2026-07-02', display: 'Ferrous gluconate 324 mg' },
            { ...GLUCONATE, date: '2026-06-15', display: 'Ferrous gluconate 324 mg' },
          ],
        }),
      ),
    );
    expect(r).toMatchObject({ status: 'RESOLVED', date: '2026-06-15', source: 'MEDICATION_ORDER' });
    expect(r.status === 'RESOLVED' && r.detail).toContain('Ferrous gluconate');
  });

  it.each([
    ['sulfate', SULFATE],
    ['gluconate', GLUCONATE],
    ['fumarate', FUMARATE],
  ])('matches any member of the class — ferrous %s', (_name, code) => {
    const r = resolveWindowAnchor(
      ORAL_IRON,
      inputs(patient({ medications: [{ ...code, date: '2026-06-15' }] })),
    );
    expect(r).toMatchObject({ status: 'RESOLVED', date: '2026-06-15' });
  });

  it('compares the order system case-insensitively', () => {
    const r = resolveWindowAnchor(
      ORAL_IRON,
      inputs(patient({ medications: [{ system: 'RxNorm', code: SULFATE.code, date: '2026-06-15' }] })),
    );
    expect(r).toMatchObject({ status: 'RESOLVED', date: '2026-06-15' });
  });

  it('ignores orders outside the class, INVALID records, undated and month-precision starts', () => {
    const r = resolveWindowAnchor(
      ORAL_IRON,
      inputs(
        patient({
          medications: [
            { system: 'RXNORM', code: 'RX-IRON-SUCROSE', date: '2026-05-01' }, // IV — another class
            { ...SULFATE, date: '2026-05-02', recordValidity: 'INVALID' },
            { ...SULFATE }, // undated — every simulator medication
            { ...SULFATE, date: '2026-05' }, // which side of the window is May 1–31?
            { ...SULFATE, date: '2026-10-01' }, // after the clock
          ],
        }),
      ),
    );
    expect(r).toMatchObject({ status: 'UNRESOLVED', key: KEY });
  });

  it('the clinician date overrides both the care plan and the order', () => {
    const r = resolveWindowAnchor(
      ORAL_IRON,
      inputs(
        patient({ medications: [{ ...SULFATE, date: '2026-05-01' }] }),
        [carePlanStart('2026-06-01', 'cp-1')],
        new Map([[KEY, { dateValue: '2026-06-20' }]]),
      ),
    );
    expect(r).toMatchObject({ date: '2026-06-20', source: 'CLINICIAN', lowerBound: '2026-06-20T00:00:00.000Z' });
  });

  it('is UNRESOLVED with nothing to anchor on — never a fallback window', () => {
    const r = resolveWindowAnchor(ORAL_IRON, inputs(patient({})));
    expect(r.status).toBe('UNRESOLVED');
    expect(r.status === 'UNRESOLVED' && r.reason).toContain('no start date for oral iron');
  });

  it('refuses a stored clinician date that is not a calendar date on/before the clock', () => {
    expect(() =>
      resolveWindowAnchor(
        ORAL_IRON,
        inputs(patient({}), [], new Map([[KEY, { dateValue: '2026-12-01' }]])),
      ),
    ).toThrow(TemporalContextError);
  });
});

describe('withTherapyStarts', () => {
  it('keeps the earliest per class and drops starts after the clock', () => {
    const ctx = context([
      carePlanStart('2026-07-10', 'cp-2'),
      carePlanStart('2026-06-01', 'cp-1'),
      carePlanStart('2026-10-01', 'cp-future'),
    ]);
    expect(ctx.therapyStarts).toEqual([carePlanStart('2026-06-01', 'cp-1')]);
  });

  it('adds no key at all when nothing survives, so the persisted context is unchanged', () => {
    const base = makeEvaluationTemporalContext({ evaluationAsOf: AS_OF, temporalPolicyVersion: 'v1' });
    expect(withTherapyStarts(base, [])).toBe(base);
    expect('therapyStarts' in withTherapyStarts(base, [carePlanStart('2026-10-01', 'x')])).toBe(false);
  });

  it('rejects a malformed date', () => {
    const base = makeEvaluationTemporalContext({ evaluationAsOf: AS_OF, temporalPolicyVersion: 'v1' });
    expect(() => withTherapyStarts(base, [carePlanStart('June 1', 'x')])).toThrow(TemporalContextError);
  });
});

// ─── The cascade refuses an anchored tier without an anchor ──────────

describe('cascade', () => {
  it('an anchored tier needs no encounter anchor at preflight, and refuses evaluation without an anchor', () => {
    const override = parseConditionOverride(TREND_UP, 'c');
    const tier = resolveEffectivePolicy('labs', 'v1', { horizons: { labs: 'ENCOUNTER' } }, override);
    // The pathway's ENCOUNTER default does not leak into an anchored condition.
    expect(tier.horizon).toBe('LIFETIME');
    expect(tier.horizonLevel).toBe('NODE');
    const ctx = context();
    expect(() => toEffectivePolicy(tier, ctx)).toThrow(/without a resolved anchor/);
    expect(toEffectivePolicy(tier, ctx, '2026-06-01T00:00:00.000Z')).toEqual({
      horizon: { lowerBound: '2026-06-01T00:00:00.000Z', upperBound: AS_OF },
    });
  });

  it('refuses an anchor for a condition without window_from', () => {
    const tier = resolveEffectivePolicy('labs', 'v1', {}, { horizon: 'QUARTER' });
    expect(() => toEffectivePolicy(tier, context(), '2026-06-01T00:00:00.000Z')).toThrow(
      /without window_from/,
    );
  });
});

// ─── The kernel ───────────────────────────────────────────────────────

describe('window_from on the v1 kernel', () => {
  it('computes the trend only over facts on/after the anchor', async () => {
    const pc = patient({ labs: RESPONDER_LABS });

    // Anchored on the care plan's 2026-06-01: 8.2 → 9.0 → 9.9 climbs.
    const anchored = await evaluateGate(
      trendGate(),
      deps(pc, { therapyStarts: [carePlanStart('2026-06-01', 'cp-1')] }),
    );
    expect(anchored.satisfied).toBe(true);
    expect(anchored.reason).toContain('[window from 2026-06-01: oral iron start, care plan');
    expect(anchored.windowAnchors).toEqual([
      expect.objectContaining({ key: KEY, date: '2026-06-01', source: 'CARE_PLAN', label: 'oral iron' }),
    ]);

    // The same series over a lookback long enough to include the early 12.8
    // reads as a NONresponder — the failure the anchor exists to prevent.
    const { window_from: _wf, ...unanchored } = TREND_UP;
    const lookback = await evaluateGate(
      trendGate({ ...unanchored, window_days: 300 }),
      deps(pc),
    );
    expect(lookback.satisfied).toBe(false);
  });

  it('includes a lab drawn on the anchor day itself (the treatment baseline)', async () => {
    // Anchored on 2026-07-01, only 9.0 (07-01) and 9.9 (08-15) remain: with
    // min_points 2 the anchor-day value must count or the series is too short.
    const r = await evaluateGate(
      trendGate(),
      deps(patient({ labs: RESPONDER_LABS }), { answers: new Map([[KEY, { dateValue: '2026-07-01' }]]) }),
    );
    expect(r.satisfied).toBe(true);
    expect(r.windowAnchors?.[0]).toMatchObject({ date: '2026-07-01', source: 'CLINICIAN' });
  });

  it('a later anchor excludes the values before it — too few points is UNRESOLVED, one short', async () => {
    const r = await evaluateGate(
      trendGate(),
      deps(patient({ labs: RESPONDER_LABS }), { answers: new Map([[KEY, { dateValue: '2026-08-01' }]]) }),
    );
    expect(r.satisfied).toBe(false);
    expect(r.indeterminate).toBe(true);
    expect(r.uncertainty).toEqual(['INSUFFICIENT_SERIES']);
    expect(r.reason).toContain('Need ≥2 dated values for 718-7; found 1');
    // One value short: askable, as "a result newer than" the one on file.
    expect(r.unresolvedSeries).toEqual([{ condition: expect.anything(), latestDate: '2026-08-15' }]);
    expect(r.unresolvedAnchorConditions).toBeUndefined();
  });

  it('is indeterminate — flagged as an unresolved anchor — when nothing anchors it', async () => {
    const r = await evaluateGate(trendGate(), deps(patient({ labs: RESPONDER_LABS })));
    expect(r.satisfied).toBe(false);
    expect(r.indeterminate).toBe(true);
    expect(r.uncertainty).toEqual(['ANCHOR_UNRESOLVED']);
    expect(r.unresolvedAnchorConditions).toHaveLength(1);
    // Reads the anchor key and medications, so an answer or a new order
    // re-evaluates it.
    expect(r.contextFieldsRead).toEqual(['labs', 'medications', KEY]);
  });

  it('an anchored series that cannot be ORDERED is indeterminate but asks for no date', async () => {
    const r = await evaluateGate(
      trendGate(),
      deps(
        patient({ labs: [{ date: '2026-07-01', value: 9 }, { date: '2026-07', value: 9.5 }] }),
        { therapyStarts: [carePlanStart('2026-06-01', 'cp-1')] },
      ),
    );
    expect(r.indeterminate).toBe(true);
    expect(r.uncertainty).toContain('AMBIGUOUS_SERIES_ORDER');
    expect(r.unresolvedAnchorConditions).toBeUndefined();
  });

  it('compound OR: a definite sibling decides it, and no date is asked', async () => {
    const gate: GateProperties = {
      title: 'At target or climbing',
      gate_type: GateType.COMPOUND,
      default_behavior: DefaultBehavior.SKIP,
      operator: 'OR',
      conditions: [
        { field: 'labs', operator: 'greater_than', value: HGB, system: 'LOINC', threshold: 10.9, horizon: { days: 90 } },
        TREND_UP,
      ] as never,
    } as GateProperties;
    const atTarget = await evaluateGate(gate, deps(patient({ labs: [{ date: '2026-08-15', value: 11.4 }] })));
    expect(atTarget.satisfied).toBe(true);
    expect(atTarget.indeterminate).toBe(false);
    expect(atTarget.unresolvedAnchorConditions).toBeUndefined();

    const below = await evaluateGate(gate, deps(patient({ labs: [{ date: '2026-08-15', value: 9.4 }] })));
    expect(below.satisfied).toBe(false);
    expect(below.indeterminate).toBe(true);
    expect(below.unresolvedAnchorConditions).toEqual([TREND_UP]);
  });

  it('count_in_window counts only occurrences since the anchor', async () => {
    const r = await evaluateGate(
      trendGate({
        field: 'labs', operator: 'count_in_window', value: HGB, system: 'LOINC',
        count_threshold: 3, window_from: ORAL_IRON_RAW,
      }),
      deps(patient({ labs: RESPONDER_LABS }), { answers: new Map([[KEY, { dateValue: '2026-06-01' }]]) }),
    );
    expect(r.satisfied).toBe(true);
    expect(r.reason).toContain('Found 3 matching 718-7');
  });

  it('legacy-v0 refuses window_from rather than evaluating over the whole history', async () => {
    const r = await evaluateGate(trendGate(), deps(patient({ labs: RESPONDER_LABS }), { version: 'legacy-v0' }));
    expect(r.satisfied).toBe(false);
    expect(r.reason).toContain('window_from requires the v1 temporal kernel');
  });
});

// ─── "rose by less than t", and the pre-treatment baseline ───────────

const DELTA = (comparison: 'at_least' | 'less_than', windowFrom: Record<string, unknown> = ORAL_IRON_RAW) => ({
  field: 'labs' as const,
  operator: 'delta_from_baseline' as const,
  value: HGB,
  system: 'LOINC',
  display: 'Hemoglobin (g/dL)',
  delta_threshold: 1.0,
  delta_comparison: comparison,
  min_points: 2,
  window_from: windowFrom,
});

describe('delta_comparison', () => {
  const started = { answers: new Map([[KEY, { dateValue: '2026-06-01' }]]) };

  it.each<[string, number, boolean, boolean]>([
    ['a rise of exactly 1.0 is a response (Josh: "exactly 1.0 counts")', 9.2, true, false],
    ['a rise of 0.6 is not', 8.8, false, true],
    ['a fall is not', 7.9, false, true],
    ['a rise of 1.5 is', 9.7, true, false],
  ])('%s — at_least and less_than are exact complements', async (_label, recheck, atLeast, lessThan) => {
    const pc = patient({ labs: [{ date: '2026-06-01', value: 8.2 }, { date: '2026-06-29', value: recheck }] });
    const up = await evaluateGate(trendGate(DELTA('at_least')), deps(pc, started));
    const under = await evaluateGate(trendGate(DELTA('less_than')), deps(pc, started));
    expect(up.satisfied).toBe(atLeast);
    expect(under.satisfied).toBe(lessThan);
    expect(up.indeterminate).toBe(false);
    expect(under.indeterminate).toBe(false);
    expect(under.reason).toContain(lessThan ? 'satisfies < 1' : 'does not satisfy < 1');
  });

  it('an exact 1.0 rise is not lost to binary subtraction (8.2 − 7.2 = 0.9999999999999991)', async () => {
    const pc = patient({ labs: [{ date: '2026-06-01', value: 7.2 }, { date: '2026-06-29', value: 8.2 }] });
    expect((await evaluateGate(trendGate(DELTA('at_least')), deps(pc, started))).satisfied).toBe(true);
    expect((await evaluateGate(trendGate(DELTA('less_than')), deps(pc, started))).satisfied).toBe(false);
  });

  it('works without window_from too (a fixed lookback)', async () => {
    const { window_from: _wf, ...unanchored } = DELTA('less_than');
    const r = await evaluateGate(
      trendGate({ ...unanchored, window_days: 42 }),
      deps(patient({ labs: [{ date: '2026-08-01', value: 8.2 }, { date: '2026-08-29', value: 8.9 }] })),
    );
    expect(r.satisfied).toBe(true);
  });

  it('legacy-v0 refuses it — the sign rule would run "< 1.0" as ">= 1.0"', async () => {
    const r = await evaluateGate(
      trendGate({ ...DELTA('less_than'), window_from: undefined }),
      deps(patient({ labs: RESPONDER_LABS }), { version: 'legacy-v0' }),
    );
    expect(r.satisfied).toBe(false);
    expect(r.reason).toContain('delta_comparison requires the v1 temporal kernel');
  });

  it.each<[string, Record<string, unknown>, string]>([
    ['on a trend', { ...TREND_UP, delta_comparison: 'less_than' }, 'applies only to delta_from_baseline'],
    ['with an unknown comparison', { ...DELTA('at_least'), delta_comparison: 'at_most' }, 'must be "at_least" or "less_than"'],
  ])('is refused %s', async (_label, condition, fragment) => {
    await expect(evaluateGate(trendGate(condition), deps(patient({})))).rejects.toThrow(fragment);
  });
});

describe('insufficient series is UNRESOLVED, not "no"', () => {
  it('one value short records the latest date so the question can ask for a newer draw', async () => {
    const r = await evaluateGate(
      trendGate(DELTA('less_than')),
      deps(patient({ labs: [{ date: '2026-06-03', value: 8.4 }] }), {
        answers: new Map([[KEY, { dateValue: '2026-06-01' }]]),
      }),
    );
    expect(r).toMatchObject({ satisfied: false, indeterminate: true, uncertainty: ['INSUFFICIENT_SERIES'] });
    expect(r.unresolvedSeries).toEqual([{ condition: expect.anything(), latestDate: '2026-06-03' }]);
  });

  it('two or more short asks nothing (no single answer completes it)', async () => {
    const r = await evaluateGate(
      trendGate({ ...DELTA('less_than'), min_points: 3 }),
      deps(patient({ labs: [{ date: '2026-06-03', value: 8.4 }] }), {
        answers: new Map([[KEY, { dateValue: '2026-06-01' }]]),
      }),
    );
    expect(r.indeterminate).toBe(true);
    expect(r.unresolvedSeries).toBeUndefined();
  });

  it('count_in_window is unchanged: a count of zero is an answer', async () => {
    const r = await evaluateGate(
      trendGate({ field: 'labs', operator: 'count_in_window', value: HGB, system: 'LOINC', window_days: 30 }),
      deps(patient({})),
    );
    expect(r).toMatchObject({ satisfied: false, indeterminate: false });
  });
});

describe('window_from.baseline_days — the pre-treatment baseline', () => {
  // The diagnostic CBC is drawn BEFORE the prescription. Iron starts 06-01.
  const LABS = [
    { date: '2026-05-01', value: 9.6 }, // an older pre-treatment value — not the baseline
    { date: '2026-05-29', value: 8.2 }, // the diagnostic Hgb, 3 days before iron
    { date: '2026-06-26', value: 9.3 }, // the recheck
  ];
  const started = { answers: new Map([[KEY, { dateValue: '2026-06-01' }]]) };

  it('uses the LATEST value within baseline_days before the anchor as the baseline', async () => {
    const r = await evaluateGate(
      trendGate(DELTA('at_least', { ...ORAL_IRON_RAW, baseline_days: 28 })),
      deps(patient({ labs: LABS }), started),
    );
    expect(r.satisfied).toBe(true);
    expect(r.reason).toContain('(baseline 8.2, current 9.3)');
    expect(r.reason).toContain('latest baseline up to 28 d before');
  });

  it('without it, the pre-treatment value is outside the window — one value short, asked, not decided', async () => {
    // The false-nonresponder trap: asked "most recent value?", a clinician
    // re-enters the 9.3 on file; injected at the session clock it reads as a
    // second, unchanged result — delta 0, "not responding". The question
    // therefore names the date the new draw must follow.
    const r = await evaluateGate(trendGate(DELTA('less_than')), deps(patient({ labs: LABS }), started));
    expect(r.indeterminate).toBe(true);
    expect(r.unresolvedSeries?.[0].latestDate).toBe('2026-06-26');
  });

  it('is refused on a count, and must be a positive whole number of days', () => {
    expect(() =>
      parseConditionOverride(
        { field: 'labs', operator: 'count_in_window', value: HGB, window_from: { ...ORAL_IRON_RAW, baseline_days: 14 } },
        'c',
      ),
    ).toThrow('a count has no baseline');
    expect(() =>
      parseConditionOverride({ ...DELTA('at_least', { ...ORAL_IRON_RAW, baseline_days: 0 }) }, 'c'),
    ).toThrow('"baseline_days" must be an integer');
  });
});
