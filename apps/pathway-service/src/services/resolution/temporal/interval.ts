import { TemporalBound } from './fact-model';

const YEAR = /^(\d{4})$/;
const MONTH = /^(\d{4})-(\d{2})$/;
const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;
// FHIR dateTime with mandatory timezone. The shape is matched here; every
// numeric component is range-checked explicitly below rather than being
// handed to Date.parse, which silently NORMALIZES out-of-range values
// (`T24:00:00Z` becomes the next day) instead of rejecting them.
const INSTANT = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d+)?(Z|([+-])(\d{2}):(\d{2}))$/;

/**
 * Build a UTC epoch without the `Date.UTC(year, ...)` / `new Date(year, ...)`
 * trap: those map years 0-99 to 1900+year, so FHIR's valid `0001`-`0099`
 * would land ~1900 years late. `setUTCFullYear` has no such remapping.
 */
export function utcEpoch(
  y: number, m1to12: number, d: number,
  h = 0, mi = 0, s = 0, ms = 0,
): number {
  const dt = new Date(0);
  dt.setUTCFullYear(y, m1to12 - 1, d);
  dt.setUTCHours(h, mi, s, ms);
  return dt.getTime();
}

function daysInMonth(y: number, m1to12: number): number {
  // Day 0 of the following month — via the safe constructor.
  return new Date(utcEpoch(y, m1to12 + 1, 0)).getUTCDate();
}

/** FHIR R4 allows years 0001-9999; year zero is not a valid instant. */
function validYear(y: number): boolean {
  return y >= 1 && y <= 9999;
}
function validYMD(y: number, m: number, d: number): boolean {
  return validYear(y) && m >= 1 && m <= 12 && d >= 1 && d <= daysInMonth(y, m);
}
/**
 * FHIR R4: hour 00-23, minute 00-59, second 00-60 — the 60 being a leap
 * second. We deliberately reject :60, a documented narrowing of the FHIR
 * grammar: ECMAScript has no representation for a leap second
 * (`Date.parse('...T12:00:60Z')` is NaN), so the only ways to accept it
 * would be to clamp to :59 or roll to the next minute. Both are exactly the
 * silent normalization this parser exists to prevent — better to reject a
 * value we cannot represent than to store a different instant than we were
 * given. Leap seconds do not appear in Epic FHIR data.
 */
function validTime(h: number, mi: number, s: number): boolean {
  return h >= 0 && h <= 23 && mi >= 0 && mi <= 59 && s >= 0 && s <= 59;
}
/** FHIR R4 bounds timezone offsets to ±14:00. */
function validOffset(hh: number, mm: number): boolean {
  if (mm < 0 || mm > 59) return false;
  if (hh < 0 || hh > 14) return false;
  return hh < 14 || mm === 0; // 14:00 is the maximum; 14:01+ is out of range
}

export function parseFhirDate(s: string | null | undefined): TemporalBound | null {
  if (typeof s !== 'string' || s.length === 0 || s !== s.trim()) return null;
  let mt = YEAR.exec(s);
  if (mt) return validYear(Number(mt[1])) ? { value: s, precision: 'year' } : null;
  mt = MONTH.exec(s);
  if (mt) {
    const y = Number(mt[1]);
    const m = Number(mt[2]);
    return validYear(y) && m >= 1 && m <= 12 ? { value: s, precision: 'month' } : null;
  }
  mt = DAY.exec(s);
  if (mt) {
    return validYMD(Number(mt[1]), Number(mt[2]), Number(mt[3])) ? { value: s, precision: 'day' } : null;
  }
  mt = INSTANT.exec(s);
  if (mt) {
    if (!validYMD(Number(mt[1]), Number(mt[2]), Number(mt[3]))) return null;
    if (!validTime(Number(mt[4]), Number(mt[5]), Number(mt[6]))) return null;
    // mt[8] is the whole zone; when it is not 'Z' the offset parts are 10/11.
    if (mt[8] !== 'Z' && !validOffset(Number(mt[10]), Number(mt[11]))) return null;
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
    return { loMs: utcEpoch(y, 1, 1, 0, 0, 0, 0), hiMs: utcEpoch(y, 12, 31, 23, 59, 59, 999) };
  }
  const m = Number(mS);
  if (b.precision === 'month') {
    return { loMs: utcEpoch(y, m, 1, 0, 0, 0, 0), hiMs: utcEpoch(y, m, daysInMonth(y, m), 23, 59, 59, 999) };
  }
  const d = Number(dS);
  return { loMs: utcEpoch(y, m, d, 0, 0, 0, 0), hiMs: utcEpoch(y, m, d, 23, 59, 59, 999) };
}
