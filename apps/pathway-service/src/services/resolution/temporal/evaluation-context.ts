import { ResolvedHorizon } from './overlap';
import { instantEpoch } from './interval';

// ─── Horizon ──────────────────────────────────────────────────────────

export type NamedHorizon =
  | 'LIFETIME'
  | 'YEAR'
  | 'QUARTER'
  | 'MONTH'
  | 'WEEK'
  | 'DAY'
  | 'ENCOUNTER';

export interface CustomHorizon {
  days: number;
}

export type Horizon = NamedHorizon | CustomHorizon;

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

const NAMED: readonly string[] = [
  'LIFETIME', 'YEAR', 'QUARTER', 'MONTH', 'WEEK', 'DAY', 'ENCOUNTER',
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

/** Only ENCOUNTER needs `encounterStart`. Plan 03 sweeps effective horizons with this. */
export function requiresEncounterAnchor(h: Horizon): boolean {
  return h === 'ENCOUNTER';
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
}

export type TemporalContextErrorCode =
  | 'MISSING_ENCOUNTER_ANCHOR'
  | 'INVALID_HORIZON'
  | 'INVALID_CLOCK'
  | 'SESSION_NOT_RETRAVERSABLE';

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

const MS_PER_DAY = 86_400_000;

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
 */
export function resolveHorizon(h: Horizon, ctx: EvaluationTemporalContext): ResolvedHorizon {
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
 * Baseline policy version: reproduces today's effective semantics (§5).
 * Plan 03 introduces the registry and makes an unknown version a hard error.
 */
export const DEFAULT_TEMPORAL_POLICY_VERSION = 'legacy-v0';

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
