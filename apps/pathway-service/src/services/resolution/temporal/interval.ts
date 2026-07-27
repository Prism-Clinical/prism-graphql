import { TemporalBound } from './fact-model';

const YEAR = /^(\d{4})$/;
const MONTH = /^(\d{4})-(\d{2})$/;
const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;
// FHIR dateTime with mandatory timezone:
const INSTANT = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

function daysInMonth(y: number, m1to12: number): number {
  return new Date(Date.UTC(y, m1to12, 0)).getUTCDate(); // day 0 of next month
}
function validYMD(y: number, m: number, d: number): boolean {
  return m >= 1 && m <= 12 && d >= 1 && d <= daysInMonth(y, m);
}

export function parseFhirDate(s: string | null | undefined): TemporalBound | null {
  if (typeof s !== 'string' || s.length === 0 || s !== s.trim()) return null;
  if (YEAR.exec(s)) return { value: s, precision: 'year' };
  let mt = MONTH.exec(s);
  if (mt) {
    const m = Number(mt[2]);
    return m >= 1 && m <= 12 ? { value: s, precision: 'month' } : null;
  }
  mt = DAY.exec(s);
  if (mt) {
    return validYMD(Number(mt[1]), Number(mt[2]), Number(mt[3])) ? { value: s, precision: 'day' } : null;
  }
  mt = INSTANT.exec(s);
  if (mt) {
    if (!validYMD(Number(mt[1]), Number(mt[2]), Number(mt[3]))) return null;
    const t = Date.parse(s);
    return Number.isNaN(t) ? null : { value: s, precision: 'instant' };
  }
  return null;
}

export function instantEpoch(s: string): number {
  const b = parseFhirDate(s);
  if (!b || b.precision !== 'instant') throw new Error(`not a valid FHIR instant: ${s}`);
  return Date.parse(s);
}

export function boundEpochRange(b: TemporalBound): { loMs: number; hiMs: number } {
  const parsed = parseFhirDate(b.value);
  if (!parsed || parsed.precision !== b.precision) {
    throw new Error(`invalid TemporalBound: ${b.value} @ ${b.precision}`);
  }
  if (b.precision === 'instant') {
    const t = Date.parse(b.value);
    return { loMs: t, hiMs: t };
  }
  const [yS, mS, dS] = b.value.split('-');
  const y = Number(yS);
  if (b.precision === 'year') {
    return { loMs: Date.UTC(y, 0, 1, 0, 0, 0, 0), hiMs: Date.UTC(y, 11, 31, 23, 59, 59, 999) };
  }
  const m = Number(mS);
  if (b.precision === 'month') {
    return { loMs: Date.UTC(y, m - 1, 1, 0, 0, 0, 0), hiMs: Date.UTC(y, m - 1, daysInMonth(y, m), 23, 59, 59, 999) };
  }
  const d = Number(dS);
  return { loMs: Date.UTC(y, m - 1, d, 0, 0, 0, 0), hiMs: Date.UTC(y, m - 1, d, 23, 59, 59, 999) };
}
