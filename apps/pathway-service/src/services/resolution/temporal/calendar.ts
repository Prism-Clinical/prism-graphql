/**
 * Calendar arithmetic on the SESSION CLOCK — never the wall clock.
 *
 * Two authoring features read the calendar date of `evaluationAsOf`:
 *
 *  - `in_season` on `encounter.date` — "is today inside Sept 1 – Jan 31?";
 *  - the `{ "since": "MM-DD" }` horizon — "since the most recent July 1".
 *
 * Everything here is a pure function of an instant and a timezone name, so a
 * session pinned to a past clock answers the same on every replay. This module
 * imports nothing from the rest of the kernel: the month-day grammar has ONE
 * parser (`parseMonthDay`), and the import validator, the session preflight
 * and the evaluator all reach it.
 */

/** A calendar month-day, as authored: `MM-DD`. */
export interface MonthDay {
  /** 1–12. */
  month: number;
  /** 1–31, valid for the month; February allows 29. */
  day: number;
}

/** A calendar date in some timezone. */
export interface CalendarDate extends MonthDay {
  year: number;
}

/** Feb is 29: a month-day names a day that exists in SOME year. */
const DAYS_IN_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/**
 * Parse `MM-DD`, or say why it is not one. Strict: exactly two digits each
 * (`"9-1"` is refused — a grammar with two spellings of one date is a grammar
 * where a typo parses), month 01–12, and a day that month can have (`"02-30"`
 * is refused; `"02-29"` is a real date).
 */
export function parseMonthDay(raw: unknown): MonthDay | { problem: string } {
  if (typeof raw !== 'string') {
    return { problem: `must be a month-day string "MM-DD" (got ${JSON.stringify(raw)})` };
  }
  const m = /^(\d{2})-(\d{2})$/.exec(raw);
  if (!m) return { problem: `must be "MM-DD" with two digits each, e.g. "09-01" (got "${raw}")` };
  const month = Number(m[1]);
  const day = Number(m[2]);
  if (month < 1 || month > 12) return { problem: `month must be 01–12 (got "${raw}")` };
  if (day < 1 || day > DAYS_IN_MONTH[month - 1]) {
    return { problem: `day must be 01–${DAYS_IN_MONTH[month - 1]} for month ${m[1]} (got "${raw}")` };
  }
  return { month, day };
}

const pad = (n: number, width = 2): string => String(n).padStart(width, '0');

export function formatMonthDay(md: MonthDay): string {
  return `${pad(md.month)}-${pad(md.day)}`;
}

export function formatCalendarDate(d: CalendarDate): string {
  return `${pad(d.year, 4)}-${pad(d.month)}-${pad(d.day)}`;
}

const isUtc = (timezone: string): boolean => timezone === 'UTC' || timezone === 'Etc/UTC';

/** The wall-clock fields an instant has in `timezone`, as if they were UTC. */
function zonedAsUtcMs(epochMs: number, timezone: string): number {
  // `hourCycle: 'h23'` — without it midnight can format as "24".
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hourCycle: 'h23',
    year: 'numeric', month: 'numeric', day: 'numeric',
    hour: 'numeric', minute: 'numeric', second: 'numeric',
  }).formatToParts(new Date(epochMs));
  const get = (type: string): number => Number(parts.find((p) => p.type === type)?.value);
  return Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
}

/**
 * The calendar date an instant falls on in `timezone`.
 *
 * `UTC` is plain arithmetic. Any other IANA zone goes through `Intl`; an
 * unknown zone throws `RangeError` (the caller turns it into a context error —
 * a session pinned to a zone nothing can resolve is a wiring bug, not data).
 */
export function calendarDateAt(epochMs: number, timezone: string): CalendarDate {
  const d = new Date(isUtc(timezone) ? epochMs : zonedAsUtcMs(epochMs, timezone));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

/**
 * The instant at which `date` begins (00:00) in `timezone`.
 *
 * A month-day that does not exist in that year — Feb 29 in a non-leap year —
 * rolls to the next day (Mar 1), by `Date.UTC`'s own overflow rule.
 */
export function startOfDateMs(date: CalendarDate, timezone: string): number {
  const asUtc = Date.UTC(date.year, date.month - 1, date.day);
  // `Date.UTC` maps years 0–99 to 1900–1999; keep the year the caller gave.
  const naive = date.year >= 0 && date.year < 100 ? new Date(asUtc).setUTCFullYear(date.year) : asUtc;
  if (isUtc(timezone)) return naive;
  // Two passes: the offset at the guess, then the offset at the corrected
  // instant, which differs only when a DST change sits between them.
  const offsetAt = (ms: number): number => zonedAsUtcMs(ms, timezone) - ms;
  const first = naive - offsetAt(naive);
  return naive - offsetAt(first);
}

const ordinal = (md: MonthDay): number => md.month * 100 + md.day;

/**
 * Is `today` inside the season `from`…`to`, BOTH BOUNDS INCLUSIVE?
 *
 * `from` after `to` wraps the year end: `09-01`…`01-31` is September through
 * January. `from` equal to `to` is that single day. A bound of `02-29` in a
 * non-leap year needs no special case — the comparison is on (month, day), so
 * `to: "02-29"` ends on Feb 28 and `from: "02-29"` starts on Mar 1.
 */
export function inSeason(today: MonthDay, from: MonthDay, to: MonthDay): boolean {
  const t = ordinal(today);
  const f = ordinal(from);
  const e = ordinal(to);
  return f <= e ? t >= f && t <= e : t >= f || t <= e;
}

/**
 * The most recent occurrence of `since` on or before `today`: this year's when
 * today is on or after it, last year's otherwise.
 */
export function mostRecentOccurrence(since: MonthDay, today: CalendarDate): CalendarDate {
  const year = ordinal(today) >= ordinal(since) ? today.year : today.year - 1;
  return { year, month: since.month, day: since.day };
}

/** Normalize a possibly-overflowed date (Feb 29 of a non-leap year → Mar 1). */
export function normalizeCalendarDate(date: CalendarDate): CalendarDate {
  return calendarDateAt(startOfDateMs(date, 'UTC'), 'UTC');
}
