import { FactBase, TemporalBound } from './fact-model';
import { boundEpochRange, boundEpochRangeAsOf, instantEpoch } from './interval';

export type ThreeValued = 'MATCH' | 'NO_MATCH' | 'UNKNOWN';
export interface ResolvedHorizon {
  lowerBound: string | null; // null = LIFETIME (-∞)
  upperBound: string; // = evaluationAsOf
}

function sameBound(a: TemporalBound | undefined, b: TemporalBound): boolean {
  return !!a && a.value === b.value && a.precision === b.precision;
}

/**
 * Every fact bound is read AS OF the clock (`boundEpochRangeAsOf`): a
 * calendar-precision bound whose range contains the clock — a lab dated today —
 * is on or before it, not straddling it. The clock is the horizon's upper
 * bound, which is `evaluationAsOf` by construction.
 */
export function overlap(interval: FactBase['interval'], horizon: ResolvedHorizon): ThreeValued {
  const Hlo = horizon.lowerBound === null ? -Infinity : instantEpoch(horizon.lowerBound);
  const Hhi = instantEpoch(horizon.upperBound);
  const end = interval.end;

  // Point fact: a KNOWN end equal to the start bound (labs / instant observations).
  if (interval.start && end.kind === 'KNOWN' && sameBound(interval.start, end.bound)) {
    const { loMs: pLo, hiMs: pHi } = boundEpochRangeAsOf(interval.start, Hhi);
    if (pLo >= Hlo && pHi <= Hhi) return 'MATCH';
    if (pHi < Hlo || pLo > Hhi) return 'NO_MATCH';
    return 'UNKNOWN';
  }

  // Durational fact.
  let sLo = -Infinity;
  let sHi = Infinity;
  if (interval.start) {
    const r = boundEpochRangeAsOf(interval.start, Hhi);
    sLo = r.loMs;
    sHi = r.hiMs;
  }

  let eLo: number;
  let eHi: number;
  if (end.kind === 'KNOWN') {
    // The inversion check reads the RAW end: clamping it could invent one.
    if (sLo > boundEpochRange(end.bound).hiMs) throw new Error('inverted interval: start after known end');
    const r = boundEpochRangeAsOf(end.bound, Hhi);
    eLo = r.loMs;
    eHi = r.hiMs;
  } else if (end.kind === 'OPEN') {
    const a = instantEpoch(end.assertedCurrentAt);
    eLo = a;
    eHi = Infinity;
    sHi = Math.min(sHi, a); // active at a ⇒ started by a
  } else {
    // UNKNOWN end: ended at or after the earliest possible start; upper unknown.
    eLo = sLo;
    eHi = Infinity;
  }

  // No possible overlap → NO_MATCH.
  if (sLo > Hhi || eHi < Hlo) return 'NO_MATCH';
  // Established overlap: EVERY realization overlaps the horizon. Since S ≤ E in
  // all realizations, [S,E] meets [Hlo,Hhi] whenever the latest possible start is
  // within reach (sHi ≤ Hhi) and the earliest possible end has arrived (eLo ≥ Hlo).
  if (sHi <= Hhi && eLo >= Hlo) return 'MATCH';
  return 'UNKNOWN';
}
