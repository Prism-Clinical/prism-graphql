import { ResolvedHorizon } from './overlap';
import { instantEpoch } from './interval';
import {
  CalendarDate,
  calendarDateAt,
  formatCalendarDate,
  mostRecentOccurrence,
  normalizeCalendarDate,
  parseMonthDay,
  startOfDateMs,
} from './calendar';
// Type-only: anchored-window imports this module's values, not the reverse.
import type { TherapyStartEvent } from './anchored-window';

// ─── Horizon ──────────────────────────────────────────────────────────

export type NamedHorizon =
  | 'LIFETIME'
  | 'YEAR'
  | 'QUARTER'
  | 'MONTH'
  | 'WEEK'
  | 'DAY'
  | 'ENCOUNTER'
  | 'PREGNANCY';

export interface CustomHorizon {
  days: number;
}

/**
 * "Since the most recent <month-day>" — a season's opening date, authored
 * (`{ "since": "07-01" }`), never hard-coded. See `sinceWindowFrom`.
 */
export interface SinceHorizon {
  /** `MM-DD`. */
  since: string;
}

export type Horizon = NamedHorizon | CustomHorizon | SinceHorizon;

/**
 * Day-count sugar (design §2). Plain day arithmetic back from
 * `evaluationAsOf` — deliberately NOT calendar months/years, so a horizon
 * has one fixed width no matter when it is evaluated.
 */
export const NAMED_HORIZON_DAYS: Record<'YEAR' | 'QUARTER' | 'MONTH' | 'WEEK' | 'DAY', number> = {
  YEAR: 365,
  QUARTER: 90,
  MONTH: 30,
  WEEK: 7,
  DAY: 1,
};

/**
 * Upper bound for `{days:N}` (design §13: "a finite positive integer with an
 * agreed maximum"). 100 Julian years — a window wider than a human lifespan is
 * `LIFETIME`, which is already an unbounded tier, so a larger day count is an
 * authoring mistake rather than a use case.
 *
 * Exported because Plan 06's import validator must reject an out-of-range
 * horizon at AUTHORING time using the same number this function enforces at
 * evaluation time. Two copies of the limit would drift.
 */
export const MAX_CUSTOM_HORIZON_DAYS = 36_525;

/** ECMAScript's maximum time value (ES2024 §21.4.1.1). */
const MAX_TIME_VALUE = 8.64e15;

const MS_PER_DAY = 86_400_000;

const NAMED: readonly string[] = [
  'LIFETIME', 'YEAR', 'QUARTER', 'MONTH', 'WEEK', 'DAY', 'ENCOUNTER', 'PREGNANCY',
];

export function isNamedHorizon(h: unknown): h is NamedHorizon {
  return typeof h === 'string' && NAMED.includes(h);
}

export function isCustomHorizon(h: unknown): h is CustomHorizon {
  return (
    typeof h === 'object' &&
    h !== null &&
    typeof (h as CustomHorizon).days === 'number'
  );
}

export function isSinceHorizon(h: unknown): h is SinceHorizon {
  return (
    typeof h === 'object' &&
    h !== null &&
    !Array.isArray(h) &&
    Object.prototype.hasOwnProperty.call(h, 'since')
  );
}

/** Only ENCOUNTER needs `encounterStart`. Plan 03 sweeps effective horizons with this. */
export function requiresEncounterAnchor(h: Horizon): boolean {
  return h === 'ENCOUNTER';
}

// ─── PREGNANCY horizon ────────────────────────────────────────────────

/**
 * The patient datum the PREGNANCY horizon is anchored on. Gestational age is
 * dated from the last menstrual period, so `evaluationAsOf − weeks × 7 days`
 * is the LMP date — the first day of THIS pregnancy.
 *
 * One constant, read by the evaluator (the value), the escalation prompt (the
 * question), the compiler (what the gate reads) and reachability, so none of
 * them can name a different datum.
 */
export const PREGNANCY_HORIZON_ATTRIBUTE = 'patient.gestational_age_weeks';

/** Only PREGNANCY needs the patient's gestational age. */
export function requiresPregnancyAnchor(h: Horizon): boolean {
  return h === 'PREGNANCY';
}

/** The PREGNANCY horizon's window, resolved for one evaluation. */
export interface PregnancyWindow {
  /** ISO instant: 00:00 UTC on the LMP date, so a fact dated that day counts. */
  lowerBound: string;
  /** `YYYY-MM-DD` — the LMP date. */
  lmpDate: string;
  /** The gestational age the window was derived from. */
  weeks: number;
}

/**
 * Is this value a gestational age a window can be derived from? A positive
 * finite NUMBER — a string "28" is not coerced, for the reason `compareScalar`
 * does not coerce one — and no wider than the engine's widest bounded window
 * (`MAX_CUSTOM_HORIZON_DAYS`), which also keeps the LMP date representable.
 */
export function isUsableGestationalAge(weeks: unknown): weeks is number {
  return (
    typeof weeks === 'number' &&
    Number.isFinite(weeks) &&
    weeks > 0 &&
    weeks * 7 <= MAX_CUSTOM_HORIZON_DAYS
  );
}

/**
 * Derive the PREGNANCY window from a gestational age and the session clock, or
 * `null` when the age is missing or unusable.
 *
 * `null` is the caller's signal to report the condition as UNRESOLVED for
 * missing data — never to fall back to LIFETIME (which would count a screen
 * from a previous pregnancy) or to a zero-width window (which would count
 * nothing). It never throws for a bad age: the age is patient data, and
 * patient data must not be able to abort a traversal.
 *
 * NOT pinned on the session context, unlike `encounterStart`: gestational age
 * can be supplied or corrected mid-session, so the window is derived at every
 * evaluation from the patient the evaluation actually sees.
 *
 * Fractional weeks are honoured (28.5 weeks is 199.5 days), then the bound is
 * floored to the start of that UTC day.
 */
export function pregnancyWindowFrom(
  gestationalAgeWeeks: unknown,
  ctx: EvaluationTemporalContext,
): PregnancyWindow | null {
  if (!isUsableGestationalAge(gestationalAgeWeeks)) return null;
  const upperMs = clockEpoch('evaluationAsOf', ctx.evaluationAsOf);
  const lmpMs = upperMs - gestationalAgeWeeks * 7 * MS_PER_DAY;
  const dayStartMs = Math.floor(lmpMs / MS_PER_DAY) * MS_PER_DAY;
  if (!Number.isFinite(dayStartMs) || Math.abs(dayStartMs) > MAX_TIME_VALUE) return null;
  const lowerBound = new Date(dayStartMs).toISOString();
  try {
    // Outside the FHIR year range (a very low-year clock): unusable, not fatal.
    instantEpoch(lowerBound);
  } catch {
    return null;
  }
  return { lowerBound, lmpDate: lowerBound.slice(0, 10), weeks: gestationalAgeWeeks };
}

// ─── The session's calendar date, and the `since` horizon ─────────────

/**
 * The calendar date of the SESSION CLOCK in the session's timezone.
 *
 * `ctx.timezone` is `'UTC'` for every context `makeEvaluationTemporalContext`
 * builds today; the lookup goes through the field anyway, so a context that
 * one day carries an IANA zone gets that zone's date with no change here. A
 * zone the runtime cannot resolve is a wiring bug and throws `INVALID_CLOCK`.
 */
export function sessionCalendarDate(ctx: EvaluationTemporalContext): CalendarDate {
  const ms = clockEpoch('evaluationAsOf', ctx.evaluationAsOf);
  try {
    return calendarDateAt(ms, sessionTimezone(ctx));
  } catch {
    throw new TemporalContextError(
      `the session timezone "${String(ctx.timezone)}" is not a timezone this runtime can resolve`,
      'INVALID_CLOCK',
    );
  }
}

function sessionTimezone(ctx: EvaluationTemporalContext): string {
  const tz: unknown = ctx.timezone;
  return typeof tz === 'string' && tz !== '' ? tz : 'UTC';
}

/** The `{ since }` horizon's window, resolved against one session clock. */
export interface SinceWindow {
  /** ISO instant: 00:00 on `date` in the session's timezone. */
  lowerBound: string;
  /** `YYYY-MM-DD` — the day the window opened, in the session's timezone. */
  date: string;
}

/**
 * Resolve `{ "since": "MM-DD" }`: the window opens at 00:00 (session timezone)
 * on the most recent occurrence of that month-day ON OR BEFORE the session
 * clock — this year's when the clock has reached it, last year's otherwise.
 *
 * A function of the pinned context alone: no patient data, nothing to ask for,
 * nothing that can be missing, and the same answer on every replay. `02-29` in
 * a year that has none opens on Mar 1.
 */
export function sinceWindowFrom(h: SinceHorizon, ctx: EvaluationTemporalContext): SinceWindow {
  const md = parseMonthDay(h.since);
  if ('problem' in md) {
    throw new TemporalContextError(`horizon.since ${md.problem}`, 'INVALID_HORIZON');
  }
  const today = sessionCalendarDate(ctx);
  const opened = normalizeCalendarDate(mostRecentOccurrence(md, today));
  const lowerMs = startOfDateMs(opened, sessionTimezone(ctx));
  let lowerBound: string;
  try {
    lowerBound = new Date(lowerMs).toISOString();
    instantEpoch(lowerBound);
  } catch {
    throw new TemporalContextError(
      `horizon since ${h.since} is not representable as a date from ${ctx.evaluationAsOf}`,
      'INVALID_HORIZON',
    );
  }
  return { lowerBound, date: formatCalendarDate(opened) };
}

// ─── Evaluation context ───────────────────────────────────────────────

export interface EvaluationTemporalContext {
  /** ISO instant — the clock for ALL relative computation in a session. */
  evaluationAsOf: string;
  /** Anchor for the ENCOUNTER horizon. */
  encounterStart?: string;
  /** Pinned clinical snapshot, when LIVE mode. */
  snapshotId?: string;
  /** When that snapshot was captured — bounds OPEN-ended facts (§2). */
  snapshotCapturedAt?: string;
  timezone: 'UTC';
  /** Selects the immutable policy constants (§5). Plan 03 validates it. */
  temporalPolicyVersion: string;
  /**
   * Care-plan therapy starts — the anchors a `window_from` condition resolves
   * from its second source (see `anchored-window.ts`). Pinned at session
   * creation, like `encounterStart`, so a retraversal or replay anchors on the
   * set the session was created with rather than on whatever plans exist by
   * then. Set only through `withTherapyStarts`; absent when there are none.
   */
  therapyStarts?: TherapyStartEvent[];
}

export type TemporalContextErrorCode =
  | 'MISSING_ENCOUNTER_ANCHOR'
  /**
   * A PREGNANCY horizon reached resolution without its derived lower bound.
   * A wiring bug, never a patient-data outcome: the evaluator reports a
   * missing gestational age as an unresolved condition before it gets here.
   */
  | 'MISSING_PREGNANCY_ANCHOR'
  | 'INVALID_HORIZON'
  | 'INVALID_CLOCK'
  | 'SESSION_NOT_RETRAVERSABLE'
  /** A session pinned a temporalPolicyVersion the registry does not define (§5). */
  | 'UNKNOWN_POLICY_VERSION'
  /** A pathway-level or condition-level policy value is structurally invalid. */
  | 'INVALID_TEMPORAL_DEFAULTS'
  /** Resolution input violated its trust mode or failed validation (§8). */
  | 'INVALID_RESOLUTION_INPUT';

export class TemporalContextError extends Error {
  constructor(
    message: string,
    readonly code: TemporalContextErrorCode,
  ) {
    super(message);
    this.name = 'TemporalContextError';
  }
}

// ─── resolveHorizon ───────────────────────────────────────────────────

function clockEpoch(label: string, iso: string): number {
  try {
    return instantEpoch(iso);
  } catch {
    throw new TemporalContextError(
      `${label} must be a full FHIR instant (got: ${iso})`,
      'INVALID_CLOCK',
    );
  }
}

/**
 * Turn a `Horizon` into the `{ lowerBound, upperBound }` pair Plan 01's
 * `overlap()` consumes. `upperBound` is always `evaluationAsOf`; a null
 * `lowerBound` means LIFETIME (no lower bound).
 *
 * Never substitutes `evaluationAsOf` for a missing `encounterStart` (§1) —
 * that would silently narrow an ENCOUNTER horizon to a zero-width window.
 *
 * `pregnancyLowerBound` is the PREGNANCY horizon's lower bound, derived per
 * evaluation by `pregnancyWindowFrom` and passed in — it is patient data, so
 * it is not on the pinned context. PREGNANCY without it throws rather than
 * falling back to any other window.
 */
export function resolveHorizon(
  h: Horizon,
  ctx: EvaluationTemporalContext,
  pregnancyLowerBound?: string,
): ResolvedHorizon {
  const upperBound = ctx.evaluationAsOf;
  const upperMs = clockEpoch('evaluationAsOf', upperBound);

  if (h === 'LIFETIME') {
    return { lowerBound: null, upperBound };
  }

  if (h === 'ENCOUNTER') {
    if (!ctx.encounterStart) {
      throw new TemporalContextError(
        'ENCOUNTER horizon requires encounterStart on the evaluation context',
        'MISSING_ENCOUNTER_ANCHOR',
      );
    }
    const startMs = clockEpoch('encounterStart', ctx.encounterStart);
    if (startMs > upperMs) {
      throw new TemporalContextError(
        `encounterStart (${ctx.encounterStart}) is after evaluationAsOf (${upperBound})`,
        'INVALID_CLOCK',
      );
    }
    return { lowerBound: ctx.encounterStart, upperBound };
  }

  if (h === 'PREGNANCY') {
    if (pregnancyLowerBound === undefined) {
      throw new TemporalContextError(
        'PREGNANCY horizon requires a lower bound derived from the patient\'s gestational age ' +
          '(pregnancyWindowFrom) — it is never resolved from the session context alone',
        'MISSING_PREGNANCY_ANCHOR',
      );
    }
    const startMs = clockEpoch('pregnancy lower bound', pregnancyLowerBound);
    if (startMs > upperMs) {
      throw new TemporalContextError(
        `pregnancy lower bound (${pregnancyLowerBound}) is after evaluationAsOf (${upperBound})`,
        'INVALID_CLOCK',
      );
    }
    return { lowerBound: pregnancyLowerBound, upperBound };
  }

  if (isSinceHorizon(h)) {
    return { lowerBound: sinceWindowFrom(h, ctx).lowerBound, upperBound };
  }

  let days: number;
  if (isCustomHorizon(h)) {
    days = h.days;
  } else if (isNamedHorizon(h)) {
    days = NAMED_HORIZON_DAYS[h as 'YEAR' | 'QUARTER' | 'MONTH' | 'WEEK' | 'DAY'];
  } else {
    throw new TemporalContextError(
      `unrecognized horizon: ${JSON.stringify(h)}`,
      'INVALID_HORIZON',
    );
  }

  if (!Number.isInteger(days) || days <= 0 || days > MAX_CUSTOM_HORIZON_DAYS) {
    throw new TemporalContextError(
      `horizon day count must be an integer in 1..${MAX_CUSTOM_HORIZON_DAYS} (got: ${days})`,
      'INVALID_HORIZON',
    );
  }

  const lowerMs = upperMs - days * MS_PER_DAY;

  // Guard 1 — representable as a Date at all. `new Date(x).toISOString()`
  // throws a bare RangeError otherwise, and no caller of resolveHorizon is
  // typed to catch that. A plain Number.isFinite check is NOT sufficient: the
  // overflowed product is finite (1e15 days before AS_OF gives ≈ -8.6e22),
  // just outside Date's range.
  if (!Number.isFinite(lowerMs) || Math.abs(lowerMs) > MAX_TIME_VALUE) {
    throw new TemporalContextError(
      `horizon of ${days} days is not representable as a date from ${upperBound}`,
      'INVALID_HORIZON',
    );
  }

  const lowerBound = new Date(lowerMs).toISOString();

  // Guard 2 — representable as a FHIR instant, which is strictly narrower.
  // Date's range is ±273,790 years but FHIR allows years 0001–9999 only, and
  // toISOString() emits the ISO extended format outside that: from a valid
  // clock of 0050-01-01T00:00:00.000Z, a 36_525-day horizon yields
  // "-000050-01-01T00:00:00.000Z". Guard 1 accepts it (well inside Date's
  // range) and Plan 01's parser then rejects it — so without this check the
  // failure surfaces later, as an opaque throw from overlap() on every fact
  // rather than an INVALID_HORIZON here. The cap alone cannot prevent this:
  // any cap large enough to be useful can still underflow a low-year clock.
  try {
    instantEpoch(lowerBound);
  } catch {
    throw new TemporalContextError(
      `horizon of ${days} days from ${upperBound} falls outside the FHIR year range ` +
        `(computed: ${lowerBound})`,
      'INVALID_HORIZON',
    );
  }

  return { lowerBound, upperBound };
}

// ─── Context construction — the ONLY wall-clock read ──────────────────

/**
 * Default policy version. `v1` is the kernel path: it is the only mode that
 * computes `indeterminate` / `uncertainty`, which the escalation semantics in
 * the decision-semantics work are built on. Under `legacy-v0` those fields are
 * never set, so everything downstream of them is inert.
 *
 * `legacy-v0` remains in the registry as a differential-test fixture and is
 * still pinnable per deployment via TEMPORAL_POLICY_VERSION, or per call via
 * `TemporalContextInput.temporalPolicyVersion`. Suites asserting pre-kernel
 * behaviour pin it explicitly rather than inheriting it from here.
 */
export const DEFAULT_TEMPORAL_POLICY_VERSION = 'v1';

export interface TemporalContextInput {
  evaluationAsOf?: string;
  encounterStart?: string;
  snapshotId?: string;
  snapshotCapturedAt?: string;
  temporalPolicyVersion?: string;
}

/**
 * Build the one context a session is pinned to. This is the ONLY place the
 * wall clock is read for temporal evaluation — every downstream computation
 * takes `evaluationAsOf` from the returned object, so a session retraversed
 * next week resolves the same horizons it did when it was created.
 *
 * (Wall-clock reads for *timeouts* — traversal-engine.ts, retraversal-engine.ts,
 * safety.ts — are unrelated and must stay as they are.)
 */
export function makeEvaluationTemporalContext(
  input: TemporalContextInput = {},
): EvaluationTemporalContext {
  const evaluationAsOf = input.evaluationAsOf ?? new Date(Date.now()).toISOString();
  const upperMs = clockEpoch('evaluationAsOf', evaluationAsOf);

  const ctx: EvaluationTemporalContext = {
    evaluationAsOf,
    timezone: 'UTC',
    temporalPolicyVersion: input.temporalPolicyVersion ?? DEFAULT_TEMPORAL_POLICY_VERSION,
  };

  if (input.encounterStart !== undefined) {
    const startMs = clockEpoch('encounterStart', input.encounterStart);
    if (startMs > upperMs) {
      throw new TemporalContextError(
        `encounterStart (${input.encounterStart}) is after evaluationAsOf (${evaluationAsOf})`,
        'INVALID_CLOCK',
      );
    }
    ctx.encounterStart = input.encounterStart;
  }
  if (input.snapshotId !== undefined) ctx.snapshotId = input.snapshotId;
  if (input.snapshotCapturedAt !== undefined) {
    clockEpoch('snapshotCapturedAt', input.snapshotCapturedAt);
    ctx.snapshotCapturedAt = input.snapshotCapturedAt;
  }

  return ctx;
}
