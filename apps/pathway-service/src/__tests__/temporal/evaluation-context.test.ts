import {
  resolveHorizon,
  requiresEncounterAnchor,
  isCustomHorizon,
  isNamedHorizon,
  makeEvaluationTemporalContext,
  MAX_CUSTOM_HORIZON_DAYS,
  DEFAULT_TEMPORAL_POLICY_VERSION,
  TemporalContextError,
  EvaluationTemporalContext,
} from '../../services/resolution/temporal/evaluation-context';
import { instantEpoch } from '../../services/resolution/temporal/interval';

const AS_OF = '2026-07-30T12:00:00.000Z';

function ctx(over: Partial<EvaluationTemporalContext> = {}): EvaluationTemporalContext {
  return {
    evaluationAsOf: AS_OF,
    timezone: 'UTC',
    temporalPolicyVersion: 'legacy-v0',
    ...over,
  };
}

describe('resolveHorizon', () => {
  it('LIFETIME has no lower bound and upperBound === evaluationAsOf', () => {
    expect(resolveHorizon('LIFETIME', ctx())).toEqual({ lowerBound: null, upperBound: AS_OF });
  });

  it('named tiers are day-count sugar measured back from evaluationAsOf', () => {
    expect(resolveHorizon('DAY', ctx()).lowerBound).toBe('2026-07-29T12:00:00.000Z');
    expect(resolveHorizon('WEEK', ctx()).lowerBound).toBe('2026-07-23T12:00:00.000Z');
    expect(resolveHorizon('MONTH', ctx()).lowerBound).toBe('2026-06-30T12:00:00.000Z');
    expect(resolveHorizon('QUARTER', ctx()).lowerBound).toBe('2026-05-01T12:00:00.000Z');
    expect(resolveHorizon('YEAR', ctx()).lowerBound).toBe('2025-07-30T12:00:00.000Z');
  });

  it('every resolved bound is a parseable FHIR instant (feeds instantEpoch)', () => {
    const { lowerBound, upperBound } = resolveHorizon({ days: 45 }, ctx());
    // overlap() calls instantEpoch on both; it throws on non-instants.
    expect(() => instantEpoch(lowerBound as string)).not.toThrow();
    expect(() => instantEpoch(upperBound)).not.toThrow();
  });

  it('custom day counts are honored', () => {
    expect(resolveHorizon({ days: 45 }, ctx()).lowerBound).toBe('2026-06-15T12:00:00.000Z');
  });

  it('ENCOUNTER runs from encounterStart', () => {
    const started = '2026-07-30T09:15:00.000Z';
    expect(resolveHorizon('ENCOUNTER', ctx({ encounterStart: started }))).toEqual({
      lowerBound: started,
      upperBound: AS_OF,
    });
  });

  it('ENCOUNTER without an anchor throws MISSING_ENCOUNTER_ANCHOR — never substitutes evaluationAsOf', () => {
    try {
      resolveHorizon('ENCOUNTER', ctx());
      throw new Error('expected resolveHorizon to throw');
    } catch (e) {
      expect(e).toBeInstanceOf(TemporalContextError);
      expect((e as TemporalContextError).code).toBe('MISSING_ENCOUNTER_ANCHOR');
    }
  });

  it('rejects an encounterStart after evaluationAsOf', () => {
    expect(() => resolveHorizon('ENCOUNTER', ctx({ encounterStart: '2026-08-01T00:00:00.000Z' })))
      .toThrow(/INVALID_CLOCK|after/i);
  });

  it('rejects a non-instant evaluationAsOf', () => {
    expect(() => resolveHorizon('DAY', ctx({ evaluationAsOf: '2026-07-30' }))).toThrow();
  });

  it.each([0, -1, 1.5, NaN, Infinity])('rejects a non-positive-integer day count: %p', (days) => {
    try {
      resolveHorizon({ days } as { days: number }, ctx());
      throw new Error('expected resolveHorizon to throw');
    } catch (e) {
      expect(e).toBeInstanceOf(TemporalContextError);
      expect((e as TemporalContextError).code).toBe('INVALID_HORIZON');
    }
  });

  it('accepts exactly MAX_CUSTOM_HORIZON_DAYS', () => {
    const out = resolveHorizon({ days: MAX_CUSTOM_HORIZON_DAYS }, ctx());
    expect(out.upperBound).toBe(AS_OF);
    expect(out.lowerBound).toBe('1926-07-30T12:00:00.000Z'); // 36_525 days before AS_OF
    expect(() => instantEpoch(out.lowerBound as string)).not.toThrow();
  });

  it('rejects MAX_CUSTOM_HORIZON_DAYS + 1', () => {
    try {
      resolveHorizon({ days: MAX_CUSTOM_HORIZON_DAYS + 1 }, ctx());
      throw new Error('expected resolveHorizon to throw');
    } catch (e) {
      expect(e).toBeInstanceOf(TemporalContextError);
      expect((e as TemporalContextError).code).toBe('INVALID_HORIZON');
    }
  });

  it('rejects a horizon that underflows the FHIR year range from an early clock', () => {
    // Regression: the day cap alone does not make the lower bound valid. From
    // a legal FHIR clock in year 0050, 36_525 days back lands in year -50,
    // which toISOString() emits as "-000050-01-01T00:00:00.000Z" — inside
    // Date's range, outside FHIR's. Must be INVALID_HORIZON here, not an
    // opaque parser throw later.
    try {
      resolveHorizon({ days: MAX_CUSTOM_HORIZON_DAYS }, ctx({ evaluationAsOf: '0050-01-01T00:00:00.000Z' }));
      throw new Error('expected resolveHorizon to throw');
    } catch (e) {
      expect(e).toBeInstanceOf(TemporalContextError);
      expect((e as TemporalContextError).code).toBe('INVALID_HORIZON');
    }
  });

  it('accepts a horizon that stays inside the FHIR year range from an early clock', () => {
    // The complement of the case above — an early clock is not itself an
    // error, only one whose lower bound underflows year 0001.
    const out = resolveHorizon({ days: 365 }, ctx({ evaluationAsOf: '0050-01-01T00:00:00.000Z' }));
    expect(out.lowerBound).toBe('0049-01-01T00:00:00.000Z');
    expect(() => instantEpoch(out.lowerBound as string)).not.toThrow();
  });

  it('a day count large enough to overflow Date throws TemporalContextError, never RangeError', () => {
    // Guards the failure mode the cap exists to prevent: without it this
    // reaches `new Date(...).toISOString()` out of range and throws a bare,
    // untyped RangeError that no caller is written to handle.
    try {
      resolveHorizon({ days: 1e15 }, ctx());
      throw new Error('expected resolveHorizon to throw');
    } catch (e) {
      expect(e).toBeInstanceOf(TemporalContextError);
      expect(e).not.toBeInstanceOf(RangeError);
      expect((e as TemporalContextError).code).toBe('INVALID_HORIZON');
    }
  });

  it('rejects an unrecognized horizon value', () => {
    expect(() => resolveHorizon('FORTNIGHT' as never, ctx())).toThrow(TemporalContextError);
  });
});

describe('horizon predicates', () => {
  it('classifies named vs custom', () => {
    expect(isNamedHorizon('QUARTER')).toBe(true);
    expect(isNamedHorizon('FORTNIGHT')).toBe(false);
    expect(isNamedHorizon({ days: 5 })).toBe(false);
    expect(isCustomHorizon({ days: 5 })).toBe(true);
    expect(isCustomHorizon({ days: '5' })).toBe(false);
    expect(isCustomHorizon('QUARTER')).toBe(false);
    expect(isCustomHorizon(null)).toBe(false);
  });

  it('only ENCOUNTER requires an anchor', () => {
    expect(requiresEncounterAnchor('ENCOUNTER')).toBe(true);
    expect(requiresEncounterAnchor('LIFETIME')).toBe(false);
    expect(requiresEncounterAnchor({ days: 30 })).toBe(false);
  });
});

describe('makeEvaluationTemporalContext', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('stamps evaluationAsOf from the wall clock when the caller supplies none', () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-07-30T12:00:00.000Z'));
    const c = makeEvaluationTemporalContext();
    expect(c.evaluationAsOf).toBe('2026-07-30T12:00:00.000Z');
    expect(c.timezone).toBe('UTC');
    expect(c.temporalPolicyVersion).toBe(DEFAULT_TEMPORAL_POLICY_VERSION);
    expect(DEFAULT_TEMPORAL_POLICY_VERSION).toBe('legacy-v0');
  });

  it('honors a caller-supplied evaluationAsOf verbatim and ignores the wall clock', () => {
    jest.useFakeTimers().setSystemTime(new Date('2030-01-01T00:00:00.000Z'));
    const c = makeEvaluationTemporalContext({ evaluationAsOf: '2026-07-30T12:00:00.000Z' });
    expect(c.evaluationAsOf).toBe('2026-07-30T12:00:00.000Z');
  });

  it('carries the optional anchors through', () => {
    const c = makeEvaluationTemporalContext({
      evaluationAsOf: '2026-07-30T12:00:00.000Z',
      encounterStart: '2026-07-30T09:00:00.000Z',
      snapshotId: 'snap-1',
      snapshotCapturedAt: '2026-07-30T08:00:00.000Z',
      temporalPolicyVersion: 'v1',
    });
    expect(c.encounterStart).toBe('2026-07-30T09:00:00.000Z');
    expect(c.snapshotId).toBe('snap-1');
    expect(c.snapshotCapturedAt).toBe('2026-07-30T08:00:00.000Z');
    expect(c.temporalPolicyVersion).toBe('v1');
  });

  it('omits absent optional fields rather than setting them undefined-in-JSON', () => {
    const c = makeEvaluationTemporalContext({ evaluationAsOf: '2026-07-30T12:00:00.000Z' });
    expect(Object.keys(JSON.parse(JSON.stringify(c))).sort()).toEqual([
      'evaluationAsOf', 'temporalPolicyVersion', 'timezone',
    ]);
  });

  it('rejects a malformed caller-supplied clock', () => {
    expect(() => makeEvaluationTemporalContext({ evaluationAsOf: '2026-07-30' }))
      .toThrow(/INVALID_CLOCK|instant/i);
    expect(() => makeEvaluationTemporalContext({ evaluationAsOf: 'not-a-date' }))
      .toThrow(/INVALID_CLOCK|instant/i);
  });

  it('rejects a malformed encounterStart, and one after evaluationAsOf', () => {
    expect(() => makeEvaluationTemporalContext({
      evaluationAsOf: '2026-07-30T12:00:00.000Z', encounterStart: 'nope',
    })).toThrow(/INVALID_CLOCK|instant/i);
    expect(() => makeEvaluationTemporalContext({
      evaluationAsOf: '2026-07-30T12:00:00.000Z', encounterStart: '2026-07-31T00:00:00.000Z',
    })).toThrow(/after/i);
  });
});
