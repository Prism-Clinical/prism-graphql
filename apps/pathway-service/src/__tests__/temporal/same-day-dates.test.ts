/**
 * Same-day, date-only facts — a result dated on the evaluation clock's day.
 *
 * The bug (reproduced live on josh-dev): a lab with a date-only value
 * (`LabResultInput.date: "2026-09-25"`, day precision) dated on the SAME UTC
 * day as the session clock was read as TEMPORAL_UNKNOWN. Its range
 * [09-25 00:00, 09-25 23:59:59.999] runs past the clock, so "on or before the
 * clock?" was indeterminate, and a gate like "MCV < 80" pended with
 * "Indeterminate numeric value for labs:787-2 (TEMPORAL_UNKNOWN)" — asking for
 * a value the chart already held. Undated values, yesterday's date and a full
 * timestamp an hour earlier all worked.
 *
 * The fix (`boundEpochRangeAsOf`): a calendar-precision bound whose range
 * CONTAINS the clock is read as [range start, clock]. A result recorded today
 * is not a future result. Only the upper edge moves, so a date after the
 * clock's day is still future, two same-day results are still unordered, and a
 * range straddling a horizon's LOWER bound is still UNKNOWN.
 *
 * Interpretation: a date-only value is a UTC calendar day (the context's
 * `timezone: 'UTC'`); no ±1-day tolerance. Boundaries are pinned below.
 */

import { boundEpochRange, boundEpochRangeAsOf, instantEpoch } from '../../services/resolution/temporal/interval';
import { overlap, ResolvedHorizon } from '../../services/resolution/temporal/overlap';
import { selectFacts } from '../../services/resolution/temporal/select-facts';
import type { FactBase, NormalizedFact } from '../../services/resolution/temporal/fact-model';
import { makeEvaluationTemporalContext } from '../../services/resolution/temporal/evaluation-context';
import { anchorKeyFor, parseWindowFrom } from '../../services/resolution/temporal/anchored-window';
import { assembleContext } from '../../services/resolution/temporal/context-assembler';
import { evaluateGate } from '../../services/resolution/gate-evaluator';
import type { GateEvaluationDeps } from '../../services/resolution/gate-evaluator';
import { GateType, DefaultBehavior, GateProperties, GateCondition } from '../../services/resolution/types';
import type { PatientContext } from '../../services/confidence/types';

const CLOCK = '2026-09-25T15:00:00.000Z';
const TODAY = '2026-09-25';
const YESTERDAY = '2026-09-24';
const TOMORROW = '2026-09-26';
const MCV = '787-2';
const HGB = '718-7';

// ─── Harness ──────────────────────────────────────────────────────────

interface LabIn { code?: string; date?: string; value: number; providerAsserted?: boolean }
interface MedIn { code: string; system: string; date?: string; display?: string }

function patient(labs: LabIn[], medications: MedIn[] = []): PatientContext {
  return {
    patientId: 'pt-1',
    conditionCodes: [],
    medications,
    allergies: [],
    labResults: labs.map((l) => ({
      code: l.code ?? MCV,
      system: 'LOINC',
      value: l.value,
      ...(l.date !== undefined ? { date: l.date } : {}),
    })),
  } as unknown as PatientContext;
}

function deps(
  pc: PatientContext,
  opts: { clock?: string; encounterStart?: string } = {},
): GateEvaluationDeps {
  const temporalContext = makeEvaluationTemporalContext({
    evaluationAsOf: opts.clock ?? CLOCK,
    temporalPolicyVersion: 'v1',
    ...(opts.encounterStart ? { encounterStart: opts.encounterStart } : {}),
  });
  return {
    temporalContext,
    pathwayDefaults: {},
    // Assembled exactly as a SYNTHETIC (simulator) session is, from the
    // composer's `LabResultInput.date` strings.
    factStore: assembleContext({ mode: 'SYNTHETIC', patientContext: pc } as never, temporalContext),
    patientContext: pc,
    resolutionState: new Map(),
    gateAnswers: new Map(),
    codeMap: new Map(),
  };
}

function gateFor(condition: Record<string, unknown>): GateProperties {
  return {
    title: 'gate',
    gate_type: GateType.PATIENT_ATTRIBUTE,
    default_behavior: DefaultBehavior.SKIP,
    condition: condition as unknown as GateCondition,
  } as GateProperties;
}

/** The reported gate: MCV < 80, on v1's default lab horizon (QUARTER = 90 days). */
const MCV_LT_80 = { field: 'labs', operator: 'less_than', value: MCV, system: 'LOINC', threshold: 80 };

// ─── The helper ───────────────────────────────────────────────────────

describe('boundEpochRangeAsOf', () => {
  const clockMs = instantEpoch(CLOCK);
  const day = (v: string) => ({ value: v, precision: 'day' as const });

  it('clamps the upper edge of a day that contains the clock to the clock', () => {
    const raw = boundEpochRange(day(TODAY));
    expect(boundEpochRangeAsOf(day(TODAY), clockMs)).toEqual({ loMs: raw.loMs, hiMs: clockMs });
  });

  it('leaves yesterday, tomorrow and every instant untouched', () => {
    expect(boundEpochRangeAsOf(day(YESTERDAY), clockMs)).toEqual(boundEpochRange(day(YESTERDAY)));
    expect(boundEpochRangeAsOf(day(TOMORROW), clockMs)).toEqual(boundEpochRange(day(TOMORROW)));
    const later = { value: '2026-09-25T18:00:00.000Z', precision: 'instant' as const };
    expect(boundEpochRangeAsOf(later, clockMs)).toEqual(boundEpochRange(later));
  });

  it('clamps month and year precision the same way', () => {
    expect(boundEpochRangeAsOf({ value: '2026-09', precision: 'month' }, clockMs)).toEqual({
      loMs: instantEpoch('2026-09-01T00:00:00.000Z'), hiMs: clockMs,
    });
    expect(boundEpochRangeAsOf({ value: '2026', precision: 'year' }, clockMs)).toEqual({
      loMs: instantEpoch('2026-01-01T00:00:00.000Z'), hiMs: clockMs,
    });
  });
});

// ─── The reported gate, end to end ────────────────────────────────────

describe('scalar: MCV < 80 with a date-only result', () => {
  it('a result dated TODAY satisfies the gate — no TEMPORAL_UNKNOWN, nothing asked', async () => {
    const r = await evaluateGate(gateFor(MCV_LT_80), deps(patient([{ date: TODAY, value: 72 }])));
    expect(r.indeterminate).toBe(false);
    expect(r.uncertainty).toEqual([]);
    expect(r.satisfied).toBe(true);
    expect(r.reason).not.toContain('TEMPORAL_UNKNOWN');
  });

  it('and is a definite NO when today\'s value is above the threshold', async () => {
    const r = await evaluateGate(gateFor(MCV_LT_80), deps(patient([{ date: TODAY, value: 91 }])));
    expect(r.indeterminate).toBe(false);
    expect(r.satisfied).toBe(false);
  });

  it('the same with an explicit 90-day horizon', async () => {
    const r = await evaluateGate(
      gateFor({ ...MCV_LT_80, horizon: { days: 90 } }),
      deps(patient([{ date: TODAY, value: 72 }])),
    );
    expect(r.indeterminate).toBe(false);
    expect(r.satisfied).toBe(true);
  });

  it('yesterday is unchanged — satisfies', async () => {
    const r = await evaluateGate(gateFor(MCV_LT_80), deps(patient([{ date: YESTERDAY, value: 72 }])));
    expect(r.indeterminate).toBe(false);
    expect(r.satisfied).toBe(true);
  });

  it('TOMORROW is still future: excluded, read exactly as if no result were on file', async () => {
    const future = await evaluateGate(gateFor(MCV_LT_80), deps(patient([{ date: TOMORROW, value: 72 }])));
    const none = await evaluateGate(gateFor(MCV_LT_80), deps(patient([])));
    expect(future.satisfied).toBe(false);
    expect({ ...future, contextFieldsRead: undefined }).toEqual({ ...none, contextFieldsRead: undefined });
    const d = deps(patient([{ date: TOMORROW, value: 72 }]));
    const out = selectFacts(
      { field: 'labs', operator: 'less_than', value: MCV, system: 'LOINC' },
      d.factStore,
      { horizon: { lowerBound: '2026-06-27T15:00:00.000Z', upperBound: CLOCK } },
    );
    expect(out.decisions[0].temporalMatch).toBe('NO_MATCH');
  });

  it('today\'s date-only result beats yesterday\'s as the latest', async () => {
    const r = await evaluateGate(
      gateFor(MCV_LT_80),
      deps(patient([{ date: YESTERDAY, value: 91 }, { date: TODAY, value: 72 }])),
    );
    expect(r.indeterminate).toBe(false);
    expect(r.satisfied).toBe(true);
  });

  it('a date-only result and a timestamped one from the SAME day stay unordered (AMBIGUOUS_LATEST)', async () => {
    // Today's date-only value is [today 00:00, clock]; a 10:00 draw sits inside
    // it. Neither is provably later — the clamp must not invent an order.
    const r = await evaluateGate(
      gateFor(MCV_LT_80),
      deps(patient([{ date: TODAY, value: 72 }, { date: '2026-09-25T10:00:00.000Z', value: 91 }])),
    );
    expect(r.indeterminate).toBe(true);
    expect(r.uncertainty).toEqual(['AMBIGUOUS_LATEST']);
  });
});

// ─── Month precision ──────────────────────────────────────────────────

describe('month precision containing the clock ("2026-09" read on 2026-09-25)', () => {
  // Decision: the same rule as a day. "2026-09" is [Sep 1, clock] — it cannot
  // be after the clock — so a window that holds all of that satisfies, and one
  // that starts inside the month still straddles it.
  it('a QUARTER (default) lab horizon holds it: the gate decides', async () => {
    const r = await evaluateGate(gateFor(MCV_LT_80), deps(patient([{ date: '2026-09', value: 72 }])));
    expect(r.indeterminate).toBe(false);
    expect(r.satisfied).toBe(true);
  });

  it('a WEEK horizon begins inside the month: still TEMPORAL_UNKNOWN (a real ambiguity)', async () => {
    const r = await evaluateGate(
      gateFor({ ...MCV_LT_80, horizon: 'WEEK' }),
      deps(patient([{ date: '2026-09', value: 72 }])),
    );
    expect(r.indeterminate).toBe(true);
    expect(r.uncertainty).toEqual(['TEMPORAL_UNKNOWN']);
  });
});

// ─── Timezone: a date-only value is a UTC calendar day ────────────────

describe('UTC day boundary', () => {
  const point = (d: string): FactBase['interval'] => ({
    start: { value: d, precision: 'day' },
    end: { kind: 'KNOWN', bound: { value: d, precision: 'day' } },
  });
  const upTo = (clock: string): ResolvedHorizon => ({ lowerBound: '2026-06-01T00:00:00.000Z', upperBound: clock });

  it('at the first instant of the UTC day, that day is already "today" — MATCH', () => {
    expect(overlap(point(TODAY), upTo('2026-09-25T00:00:00.000Z'))).toBe('MATCH');
  });

  it('at the last instant of the UTC day, it is still today — MATCH', () => {
    expect(overlap(point(TODAY), upTo('2026-09-25T23:59:59.999Z'))).toBe('MATCH');
  });

  it('one millisecond before the UTC day begins, that day is the future — NO_MATCH', () => {
    // No ±1-day tolerance: a clinician east of UTC whose local date has already
    // rolled over cannot enter tomorrow's UTC date as today. West of UTC (every
    // US zone) the local date is never ahead of the UTC date, and the admin
    // simulator's date inputs cap at the UTC date.
    expect(overlap(point(TODAY), upTo('2026-09-24T23:59:59.999Z'))).toBe('NO_MATCH');
  });
});

// ─── Trend / delta series ─────────────────────────────────────────────

describe('aggregate: series with a same-day result', () => {
  const DELTA = {
    field: 'labs', operator: 'delta_from_baseline', value: HGB, system: 'LOINC',
    display: 'Hemoglobin (g/dL)', delta_threshold: 1.0, delta_comparison: 'at_least',
    min_points: 2, window_days: 30,
  };

  it('baseline yesterday + recheck today: the delta is read and decides', async () => {
    const rise = await evaluateGate(
      gateFor(DELTA),
      deps(patient([{ code: HGB, date: YESTERDAY, value: 8.2 }, { code: HGB, date: TODAY, value: 9.4 }])),
    );
    expect(rise.indeterminate).toBe(false);
    expect(rise.uncertainty).toEqual([]);
    expect(rise.satisfied).toBe(true);

    const flat = await evaluateGate(
      gateFor(DELTA),
      deps(patient([{ code: HGB, date: YESTERDAY, value: 8.2 }, { code: HGB, date: TODAY, value: 8.4 }])),
    );
    expect(flat.indeterminate).toBe(false);
    expect(flat.satisfied).toBe(false);
  });

  it('trend_up over earlier values + today counts today\'s point', async () => {
    const r = await evaluateGate(
      gateFor({
        field: 'labs', operator: 'trend_up', value: HGB, system: 'LOINC',
        slope_threshold: 0.01, min_points: 3, window_days: 60,
      }),
      deps(patient([
        { code: HGB, date: '2026-08-20', value: 8.0 },
        { code: HGB, date: '2026-09-10', value: 8.6 },
        { code: HGB, date: TODAY, value: 9.3 },
      ])),
    );
    expect(r.indeterminate).toBe(false);
    expect(r.satisfied).toBe(true);
  });

  it('two date-only results on the same day remain unordered (AMBIGUOUS_SERIES_ORDER)', async () => {
    const r = await evaluateGate(
      gateFor(DELTA),
      deps(patient([{ code: HGB, date: TODAY, value: 8.2 }, { code: HGB, date: TODAY, value: 9.4 }])),
    );
    expect(r.indeterminate).toBe(true);
    expect(r.uncertainty).toContain('AMBIGUOUS_SERIES_ORDER');
  });

  it('two same-day results from YESTERDAY behave the same (unchanged)', async () => {
    const r = await evaluateGate(
      gateFor(DELTA),
      deps(patient([{ code: HGB, date: YESTERDAY, value: 8.2 }, { code: HGB, date: YESTERDAY, value: 9.4 }])),
    );
    expect(r.indeterminate).toBe(true);
    expect(r.uncertainty).toContain('AMBIGUOUS_SERIES_ORDER');
  });

  it('a result dated tomorrow is not counted', async () => {
    const r = await evaluateGate(
      gateFor({ field: 'labs', operator: 'count_in_window', value: HGB, system: 'LOINC', count_threshold: 1, window_days: 30 }),
      deps(patient([{ code: HGB, date: TOMORROW, value: 9 }])),
    );
    expect(r.satisfied).toBe(false);
  });
});

// ─── Anchored windows ─────────────────────────────────────────────────

describe('window_from anchored on a medication order dated today', () => {
  const SULFATE = { system: 'RXNORM', code: 'RX-FE-SULFATE' };
  const ORAL_IRON_RAW = {
    event: 'medication_start',
    clinical_role: 'oral-iron-repletion',
    label: 'oral iron',
    codes: [SULFATE],
  };
  const KEY = anchorKeyFor(parseWindowFrom(ORAL_IRON_RAW, 'test'));
  const orderToday: MedIn = { ...SULFATE, date: TODAY, display: 'Ferrous sulfate' };

  it('anchors on today, and today\'s date-only lab lands inside [today 00:00, clock]', async () => {
    const r = await evaluateGate(
      gateFor({
        field: 'labs', operator: 'count_in_window', value: HGB, system: 'LOINC',
        count_threshold: 1, window_from: ORAL_IRON_RAW,
      }),
      deps(patient([{ code: HGB, date: YESTERDAY, value: 8.2 }, { code: HGB, date: TODAY, value: 8.3 }], [orderToday])),
    );
    expect(r.windowAnchors?.[0]).toMatchObject({ key: KEY, date: TODAY, source: 'MEDICATION_ORDER' });
    expect(r.indeterminate).toBe(false);
    expect(r.uncertainty).toEqual([]);
    expect(r.satisfied).toBe(true);
    // Only today's result is on/after the anchor; yesterday's is before it.
    expect(r.reason).toContain('Found 1 matching 718-7');
  });

  it('a delta anchored today reads yesterday as the pre-treatment baseline and today as current', async () => {
    const r = await evaluateGate(
      gateFor({
        field: 'labs', operator: 'delta_from_baseline', value: HGB, system: 'LOINC',
        delta_threshold: 1.0, delta_comparison: 'less_than', min_points: 2,
        window_from: { ...ORAL_IRON_RAW, baseline_days: 28 },
      }),
      deps(patient([{ code: HGB, date: YESTERDAY, value: 8.2 }, { code: HGB, date: TODAY, value: 8.3 }], [orderToday])),
    );
    expect(r.windowAnchors?.[0]).toMatchObject({ date: TODAY, source: 'MEDICATION_ORDER' });
    expect(r.indeterminate).toBe(false);
    expect(r.satisfied).toBe(true);
  });
});

// ─── ENCOUNTER horizons ───────────────────────────────────────────────

describe('ENCOUNTER horizon', () => {
  const ENC = { ...MCV_LT_80, horizon: 'ENCOUNTER' };

  it('an encounter that began at the start of the UTC day holds a result dated today', async () => {
    const r = await evaluateGate(
      gateFor(ENC),
      deps(patient([{ date: TODAY, value: 72 }]), { encounterStart: '2026-09-25T00:00:00.000Z' }),
    );
    expect(r.indeterminate).toBe(false);
    expect(r.satisfied).toBe(true);
  });

  it('an encounter that began mid-day: a date-only result from today is genuinely ambiguous', async () => {
    // The clamp fixes only the UPPER side. Drawn before or during an encounter
    // that began at 14:00? A date cannot say, so the LOWER-bound straddle stays
    // TEMPORAL_UNKNOWN — deliberately. A timestamp inside the encounter decides.
    const unknown = await evaluateGate(
      gateFor(ENC),
      deps(patient([{ date: TODAY, value: 72 }]), { encounterStart: '2026-09-25T14:00:00.000Z' }),
    );
    expect(unknown.indeterminate).toBe(true);
    expect(unknown.uncertainty).toEqual(['TEMPORAL_UNKNOWN']);

    const timed = await evaluateGate(
      gateFor(ENC),
      deps(patient([{ date: '2026-09-25T14:30:00.000Z', value: 72 }]), { encounterStart: '2026-09-25T14:00:00.000Z' }),
    );
    expect(timed.indeterminate).toBe(false);
    expect(timed.satisfied).toBe(true);
  });
});

// ─── Durational (stateful) facts ──────────────────────────────────────

describe('stateful facts dated today', () => {
  it('an inactive condition with onset today (end unknown) began inside a QUARTER window', () => {
    const fact: NormalizedFact = {
      kind: 'condition', factId: 'c1', code: 'D50.9', system: 'ICD-10',
      interval: { start: { value: TODAY, precision: 'day' }, end: { kind: 'UNKNOWN' } },
      recordValidity: 'VALID', validityBasis: 'test', provenance: { sourceType: 'SYNTHETIC' },
      clinicalState: 'INACTIVE', stateBasis: 'SYNTHETIC',
    };
    const horizon = { lowerBound: '2026-06-27T15:00:00.000Z', upperBound: CLOCK };
    // count_in_window: the onset (today) is inside the window.
    const out = selectFacts(
      { field: 'conditions', operator: 'count_in_window', value: 'D50.9', system: 'ICD-10' },
      [fact],
      { horizon, status: 'any' },
    );
    expect(out.decisions[0].temporalMatch).toBe('MATCH');
  });
});
