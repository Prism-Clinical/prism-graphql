import { overlap, ResolvedHorizon, ThreeValued } from '../../services/resolution/temporal/overlap';
import { FactBase, TemporalEnd } from '../../services/resolution/temporal/fact-model';

const Q: ResolvedHorizon = { lowerBound: '2026-04-27T00:00:00.000Z', upperBound: '2026-07-26T00:00:00.000Z' };
const LIFE: ResolvedHorizon = { lowerBound: null, upperBound: '2026-07-26T00:00:00.000Z' };
const day = (v: string): FactBase['interval']['start'] => ({ value: v, precision: 'day' });
const known = (v: string): TemporalEnd => ({ kind: 'KNOWN', bound: { value: v, precision: 'day' } });
const iv = (start: FactBase['interval']['start'], end: TemporalEnd): FactBase['interval'] => ({ start, end });

type Row = [string, FactBase['interval'], ResolvedHorizon, ThreeValued];
const rows: Row[] = [
  ['point lab inside window', iv(day('2026-05-10'), known('2026-05-10')), Q, 'MATCH'],
  ['point lab before window', iv(day('2026-01-10'), known('2026-01-10')), Q, 'NO_MATCH'],
  ['point lab after upperBound (future)', iv(day('2026-08-10'), known('2026-08-10')), Q, 'NO_MATCH'],
  ['month-precision point straddling lower bound',
    iv({ value: '2026-04', precision: 'month' }, { kind: 'KNOWN', bound: { value: '2026-04', precision: 'month' } }), Q, 'UNKNOWN'],
  ['durational OPEN asserted in window', iv(day('2019-01-01'), { kind: 'OPEN', assertedCurrentAt: '2026-06-01T00:00:00.000Z' }), Q, 'MATCH'],
  ['durational OPEN asserted before window', iv(day('2019-01-01'), { kind: 'OPEN', assertedCurrentAt: '2026-01-01T00:00:00.000Z' }), Q, 'UNKNOWN'],
  ['active no-onset OPEN in window', iv(undefined, { kind: 'OPEN', assertedCurrentAt: '2026-06-01T00:00:00.000Z' }), Q, 'MATCH'],
  ['dated start, UNKNOWN end, old', iv(day('2020-01-01'), { kind: 'UNKNOWN' }), Q, 'UNKNOWN'],
  ['undated start, UNKNOWN end', iv(undefined, { kind: 'UNKNOWN' }), Q, 'UNKNOWN'],
  ['resolved before window (known end)', iv(day('2018-01-01'), known('2025-01-01')), Q, 'NO_MATCH'],
  ['everything overlaps LIFETIME', iv(day('2001-01-01'), { kind: 'UNKNOWN' }), LIFE, 'MATCH'],
];

test.each(rows)('overlap: %s', (_desc, interval, horizon, expected) => {
  expect(overlap(interval, horizon)).toBe(expected);
});

test('inverted interval (known end before start) throws', () => {
  expect(() => overlap(iv(day('2025-01-01'), known('2020-01-01')), Q)).toThrow(/inverted/i);
});
