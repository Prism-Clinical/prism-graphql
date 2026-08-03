# Temporal Horizon — Plan 02: Pinned Evaluation Clock

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every resolution session one pinned, persisted evaluation clock
(`EvaluationTemporalContext`) so that retraversing or replaying a session with
identical data produces an identical result regardless of when it runs.

**Architecture:** A new pure module `temporal/evaluation-context.ts` defines the
`Horizon` value type, the `EvaluationTemporalContext`, and `resolveHorizon()`
(which turns a horizon into the `ResolvedHorizon` that Plan 01's `overlap()`
already consumes). `Date.now()` is read in exactly **one** place —
`makeEvaluationTemporalContext()`, called at session creation. The context is
threaded as a **required constructor argument** into `TraversalEngine` and
`RetraversalEngine`, persisted in a new `temporal_context JSONB` column, and read
back on every retraversal. Gate evaluation's internal clock parameter loses its
`Date.now()` default so the compiler enforces that a clock is supplied.

**Tech Stack:** TypeScript 5, Jest + ts-jest, PostgreSQL 15 (raw `pg` `Pool`).

**Design source:** `docs/superpowers/specs/2026-07-21-pathway-temporal-horizon-design.md`
§1 (pinned clock), §2 (Horizon tiers), §11 (persistence surfaces), §12
(reachability clock ownership), §13 (acceptance criteria).

**Suite index:** `2026-07-26-temporal-horizon-00-overview.md`. This is Plan 02 of 9.

## Global Constraints

- **Branch:** `feat/pathway-temporal-horizon`, already checked out at
  `features/feat-pathway-temporal-horizon/prism-graphql`. All paths below are
  relative to that repo root.
- **Never chain `cd` with `&&`.** Use `--prefix` / `-C`, or run `cd` as its own
  command. (Project rule; chained forms get denied.)
- **Typecheck:** there is no `typecheck` npm script. Run:
  `./node_modules/.bin/tsc -p tsconfig.json --noEmit` from
  `apps/pathway-service` (that directory holds its own `node_modules/.bin/tsc`;
  the repo root does not, and `npx tsc` resolves to an unrelated package).
- **Tests:** `npm test --prefix apps/pathway-service -- --runInBand <path>`.
  Jest `testRegex` is `/__tests__/.*.test.ts` — a test file **must** live under
  `src/__tests__/` or Jest will not see it (a path-based filter like
  `src/services/.../temporal` matches zero tests).
- **tsconfig is NOT full strict** — only `noImplicitAny` + `noImplicitReturns`.
  Do not assume `strictNullChecks` will catch a missing null guard; write the
  guard.
- **Commit prefixes:** `feat:` / `fix:` / `test:` / `refactor:` / `docs:`. No
  `@anthropic.com` / `@claude.com` addresses, no "Generated with" lines. End each
  commit message with:
  `Co-Authored-By: Claude Opus 5 (1M context) <noreply@example.com>`
- **No behavior activation.** Plans 01–08 must not change live gate outcomes
  until the `v1` flip (§Rollout). This plan is a pure plumbing change: with
  `temporalPolicyVersion = 'legacy-v0'` and the clock pinned to "now", every
  existing gate must evaluate exactly as it does today. Every pre-existing test
  must still pass unchanged in behavior.
- **`timezone` is the literal `'UTC'`** everywhere. Do not introduce a timezone
  library or a second zone.

## Scope Boundaries (read before starting)

Three things that look in-scope but are **not**, because a later plan owns them:

1. **The pathway-wide pre-traversal ENCOUNTER check.** §1 requires rejecting
   session creation when *any effective gate horizon* resolves to `ENCOUNTER`
   without an `encounterStart`. "Effective" requires the cascade
   (system default → pathway default → node), which **Plan 03** builds. This plan
   ships the mechanism only: `resolveHorizon()` throws
   `TemporalContextError('MISSING_ENCOUNTER_ANCHOR')`, and
   `requiresEncounterAnchor()` is exported for Plan 03's sweep. Do not attempt a
   pathway-wide sweep here — there is no effective-policy resolver to sweep yet.
2. **Reachability.** §12 gives reachability a *request-scoped* clock, and Plan 04
   moves reachability onto the `selectFacts` kernel. `reachability.ts` has no
   clock today and gets none in this plan. Leave it alone.
3. **GraphQL exposure** of the session temporal context (§11 bullet 2) belongs to
   **Plan 08**, which touches `schema.graphql` + the `Query.ts` formatter
   together with evidence. This plan persists the column and plumbs the type; it
   adds no SDL.

One thing that looks out-of-scope but **is** in scope: the `Horizon` type itself.
Plan 03 consumes it for the cascade and Plan 06 validates it at import, so it
must be defined here, alongside `resolveHorizon()`, which is its only consumer in
this plan.

## What is already landed (Plan 01) — consume, do not redefine

Verified present at `apps/pathway-service/src/services/resolution/temporal/`:

```ts
// overlap.ts
export type ThreeValued = 'MATCH' | 'NO_MATCH' | 'UNKNOWN';
export interface ResolvedHorizon { lowerBound: string | null; upperBound: string }
export function overlap(interval: FactBase['interval'], horizon: ResolvedHorizon): ThreeValued;

// interval.ts
export function parseFhirDate(s: string | null | undefined): TemporalBound | null;
export function instantEpoch(s: string): number;   // THROWS unless s is a full FHIR instant
export function boundEpochRange(b: TemporalBound): { loMs: number; hiMs: number };
```

Two facts that shape this plan:

- **`instantEpoch()` throws** (`not a valid FHIR instant: <s>`) for anything that
  is not a full `YYYY-MM-DDThh:mm:ss[.sss](Z|±hh:mm)` string. A bare date such as
  `2026-07-30` is **not** accepted. So `evaluationAsOf` / `encounterStart` must
  always be full instants, and `resolveHorizon` must produce `lowerBound` values
  that satisfy the same regex. `new Date(ms).toISOString()` does — it emits
  `.000Z` — so build bounds that way, never by string slicing.
- `ResolvedHorizon.upperBound` **is** `evaluationAsOf` by definition, and
  `lowerBound: null` means LIFETIME / no lower bound.

## File Structure

**Create:**
- `apps/pathway-service/src/services/resolution/temporal/evaluation-context.ts` —
  the `Horizon` value type, `EvaluationTemporalContext`, `TemporalContextError`,
  `makeEvaluationTemporalContext()` (the sole `Date.now()` reader),
  `resolveHorizon()`, `requiresEncounterAnchor()`. Pure: no DB, no I/O.
- `apps/pathway-service/src/__tests__/temporal/evaluation-context.test.ts`
- `apps/pathway-service/src/__tests__/temporal/clock-pinning.test.ts` — the
  wall-clock-immunity regression test (§13 "Reproducibility").
- `shared/data-layer/migrations/063_add_temporal_context_to_sessions.sql`

**Modify:**
- `apps/pathway-service/src/services/resolution/gate-evaluator.ts` — drop the
  `= Date.now()` defaults on the three internal evaluators (`:184`, `:435`,
  `:559`); keep the exported `evaluateGate`'s optional `now` (`:743`) for the
  ~50 existing unit-test call sites.
- `apps/pathway-service/src/services/resolution/traversal-engine.ts` — new 3rd
  constructor parameter; pass `evaluationAsOf` at both `evaluateGate` call sites
  (`:271`, `:664`, which pass `undefined` today).
- `apps/pathway-service/src/services/resolution/retraversal-engine.ts` — same,
  call site `:151`.
- `apps/pathway-service/src/services/resolution/types.ts` — add
  `temporalContext` to `ResolutionSession` (`:268`).
- `apps/pathway-service/src/services/resolution/session-store.ts` — write the
  column in `createSession` (`:98`), read it in `getSession` (`:144`).
- `apps/pathway-service/src/services/resolution/multi-pathway-session-store.ts` —
  write/read the column in `createMultiPathwaySession` (`:60`) + `rowToSession`.
- `apps/pathway-service/src/resolvers/mutations/resolution.ts` — stamp the
  context in `startResolution` (`:47`); read it back at the three
  `RetraversalEngine` sites (`:232`, `:390`, `:566`).
- `apps/pathway-service/src/resolvers/mutations/multi-pathway-resolution.ts` —
  stamp once in `startMultiPathwayResolution` (`:129`) and thread it down:
  both `createMultiPathwaySession` calls (`:160` zero-match, `:185` normal), a
  new required parameter on `resolveAndPersistAll` (`:668`), then the engine
  (`:687`) and `createSession` (`:731`) inside it.
- Test constructor call sites (mechanical, 3 of them):
  `__tests__/traversal-engine.test.ts:46`,
  `__tests__/retraversal-engine.test.ts:29`,
  `__tests__/anemia-pathway-e2e.test.ts:39`.
- `__tests__/resolution-retraversal-context.test.ts` — its `makeSession()`
  fixture (`:91`) needs a `temporalContext`. Also the reference harness: Task 6's
  new test must mirror its mock set exactly.
- `__tests__/multi-pathway-resolution.test.ts` — two new cases asserting the
  parent and contributing sessions share one clock (Task 6 Step 7).

---

### Task 1: `Horizon` type and `resolveHorizon()`

Pure value-type work. Produces the vocabulary Plans 03/06 consume.

**Files:**
- Create: `apps/pathway-service/src/services/resolution/temporal/evaluation-context.ts`
- Test: `apps/pathway-service/src/__tests__/temporal/evaluation-context.test.ts`

**Interfaces:**
- Consumes: `ResolvedHorizon` from `./overlap`; `instantEpoch` from `./interval`.
- Produces:
  ```ts
  type NamedHorizon = 'LIFETIME'|'YEAR'|'QUARTER'|'MONTH'|'WEEK'|'DAY'|'ENCOUNTER';
  interface CustomHorizon { days: number }
  type Horizon = NamedHorizon | CustomHorizon;
  const NAMED_HORIZON_DAYS: Record<'YEAR'|'QUARTER'|'MONTH'|'WEEK'|'DAY', number>;
  const MAX_CUSTOM_HORIZON_DAYS: number;   // 36_525 — see below
  function isNamedHorizon(h: unknown): h is NamedHorizon;
  function isCustomHorizon(h: unknown): h is CustomHorizon;
  function requiresEncounterAnchor(h: Horizon): boolean;
  interface EvaluationTemporalContext {
    evaluationAsOf: string; encounterStart?: string; snapshotId?: string;
    snapshotCapturedAt?: string; timezone: 'UTC'; temporalPolicyVersion: string;
  }
  type TemporalContextErrorCode =
    'MISSING_ENCOUNTER_ANCHOR'|'INVALID_HORIZON'|'INVALID_CLOCK'|'SESSION_NOT_RETRAVERSABLE';
  class TemporalContextError extends Error { readonly code: TemporalContextErrorCode }
  function resolveHorizon(h: Horizon, ctx: EvaluationTemporalContext): ResolvedHorizon;
  ```

Day counts per §2: `YEAR`=365, `QUARTER`=90, `MONTH`=30, `WEEK`=7, `DAY`=1 —
plain day arithmetic back from `evaluationAsOf`, no calendar months, no DST.

**Custom-horizon maximum.** Design §13 mandates `{days:N}` be "a finite positive
integer with an agreed maximum" but leaves the number to the plan. This plan sets
`MAX_CUSTOM_HORIZON_DAYS = 36_525` (100 Julian years) and rejects anything above
it with `INVALID_HORIZON`. Rationale: a window wider than a human lifespan is
`LIFETIME`, which already exists as an unbounded tier and costs nothing — a
larger day count is an authoring mistake, not a use case. The cap is also what
keeps the arithmetic in range: without it, `{days: 1e15}` reaches
`new Date(...).toISOString()` with a time value past ECMAScript's ±8.64e15 limit
and throws a bare `RangeError` that no caller is typed to catch. Plan 06's
validator will reuse this constant so a bad value is rejected at authoring time,
not at evaluation time; exporting it here is what makes that possible.

- [ ] **Step 1: Write the failing test**

Create `apps/pathway-service/src/__tests__/temporal/evaluation-context.test.ts`:

```ts
import {
  resolveHorizon,
  requiresEncounterAnchor,
  isCustomHorizon,
  isNamedHorizon,
  MAX_CUSTOM_HORIZON_DAYS,
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test --prefix apps/pathway-service -- --runInBand src/__tests__/temporal/evaluation-context.test.ts`
Expected: FAIL — `Cannot find module '../../services/resolution/temporal/evaluation-context'`.

- [ ] **Step 3: Write minimal implementation**

Create `apps/pathway-service/src/services/resolution/temporal/evaluation-context.ts`:

```ts
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
  // Belt and braces. The cap above already keeps a well-formed call in range,
  // but `new Date(x).toISOString()` throws a bare RangeError when it does not,
  // and no caller of resolveHorizon is typed to catch that. Note a plain
  // Number.isFinite check is NOT sufficient: the overflowed product is finite
  // (1e15 days past AS_OF gives ≈ -8.6e22), just outside Date's range.
  if (!Number.isFinite(lowerMs) || Math.abs(lowerMs) > MAX_TIME_VALUE) {
    throw new TemporalContextError(
      `horizon of ${days} days is not representable as a date from ${upperBound}`,
      'INVALID_HORIZON',
    );
  }

  return {
    lowerBound: new Date(lowerMs).toISOString(),
    upperBound,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test --prefix apps/pathway-service -- --runInBand src/__tests__/temporal/evaluation-context.test.ts`
Expected: PASS (all cases).

If the named-tier assertions fail on an off-by-one, check that you subtracted
from `upperMs` (the epoch of `evaluationAsOf`) rather than from a truncated day.

- [ ] **Step 5: Commit**

```bash
git add apps/pathway-service/src/services/resolution/temporal/evaluation-context.ts \
        apps/pathway-service/src/__tests__/temporal/evaluation-context.test.ts
git commit -m "feat: Horizon value type and resolveHorizon

Co-Authored-By: Claude Opus 5 (1M context) <noreply@example.com>"
```

---

### Task 2: `makeEvaluationTemporalContext()` — the single wall-clock boundary

The whole point of the plan: `Date.now()` is read here and nowhere else in the
temporal path.

**Files:**
- Modify: `apps/pathway-service/src/services/resolution/temporal/evaluation-context.ts`
- Test: `apps/pathway-service/src/__tests__/temporal/evaluation-context.test.ts` (append)

**Interfaces:**
- Consumes: Task 1's `EvaluationTemporalContext`, `TemporalContextError`.
- Produces:
  ```ts
  const DEFAULT_TEMPORAL_POLICY_VERSION = 'legacy-v0';
  interface TemporalContextInput {
    evaluationAsOf?: string; encounterStart?: string; snapshotId?: string;
    snapshotCapturedAt?: string; temporalPolicyVersion?: string;
  }
  function makeEvaluationTemporalContext(input?: TemporalContextInput): EvaluationTemporalContext;
  ```

`legacy-v0` is the baseline that reproduces today's semantics (§5). Plan 03
replaces the free-string field with registry-validated lookup and will make an
unknown version a hard error; until then any string is accepted but the default
must be `legacy-v0` so no behavior changes.

**Note on the caller-supplied `evaluationAsOf`:** SYNTHETIC mode may supply it;
LIVE mode must not (§Trust boundary). Enforcing *that* is Plan 05's
`ResolutionMode`. Here the parameter is simply accepted and validated — do not add
a mode check.

- [ ] **Step 1: Write the failing test**

Append to `apps/pathway-service/src/__tests__/temporal/evaluation-context.test.ts`:

```ts
import {
  makeEvaluationTemporalContext,
  DEFAULT_TEMPORAL_POLICY_VERSION,
} from '../../services/resolution/temporal/evaluation-context';

describe('makeEvaluationTemporalContext', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('stamps evaluationAsOf from the wall clock when the caller supplies none', () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-07-30T12:00:00.000Z'));
    const ctx = makeEvaluationTemporalContext();
    expect(ctx.evaluationAsOf).toBe('2026-07-30T12:00:00.000Z');
    expect(ctx.timezone).toBe('UTC');
    expect(ctx.temporalPolicyVersion).toBe(DEFAULT_TEMPORAL_POLICY_VERSION);
    expect(DEFAULT_TEMPORAL_POLICY_VERSION).toBe('legacy-v0');
  });

  it('honors a caller-supplied evaluationAsOf verbatim and ignores the wall clock', () => {
    jest.useFakeTimers().setSystemTime(new Date('2030-01-01T00:00:00.000Z'));
    const ctx = makeEvaluationTemporalContext({ evaluationAsOf: '2026-07-30T12:00:00.000Z' });
    expect(ctx.evaluationAsOf).toBe('2026-07-30T12:00:00.000Z');
  });

  it('carries the optional anchors through', () => {
    const ctx = makeEvaluationTemporalContext({
      evaluationAsOf: '2026-07-30T12:00:00.000Z',
      encounterStart: '2026-07-30T09:00:00.000Z',
      snapshotId: 'snap-1',
      snapshotCapturedAt: '2026-07-30T08:00:00.000Z',
      temporalPolicyVersion: 'v1',
    });
    expect(ctx.encounterStart).toBe('2026-07-30T09:00:00.000Z');
    expect(ctx.snapshotId).toBe('snap-1');
    expect(ctx.snapshotCapturedAt).toBe('2026-07-30T08:00:00.000Z');
    expect(ctx.temporalPolicyVersion).toBe('v1');
  });

  it('omits absent optional fields rather than setting them undefined-in-JSON', () => {
    const ctx = makeEvaluationTemporalContext({ evaluationAsOf: '2026-07-30T12:00:00.000Z' });
    expect(Object.keys(JSON.parse(JSON.stringify(ctx))).sort()).toEqual([
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test --prefix apps/pathway-service -- --runInBand src/__tests__/temporal/evaluation-context.test.ts`
Expected: FAIL — `makeEvaluationTemporalContext is not a function`.

- [ ] **Step 3: Write minimal implementation**

Append to `apps/pathway-service/src/services/resolution/temporal/evaluation-context.ts`:

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test --prefix apps/pathway-service -- --runInBand src/__tests__/temporal/evaluation-context.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/pathway-service/src/services/resolution/temporal/evaluation-context.ts \
        apps/pathway-service/src/__tests__/temporal/evaluation-context.test.ts
git commit -m "feat: single wall-clock boundary for the evaluation context

Co-Authored-By: Claude Opus 5 (1M context) <noreply@example.com>"
```

---

### Task 3: Make the internal gate-evaluation clock required

`evaluateCondition`, `evaluatePatientAttribute`, and `evaluateCompound` each
default `now` to `Date.now()`. Those defaults are how the wall clock leaks into
evaluation. Removing them makes the compiler enforce that a clock is passed
inward.

**Files:**
- Modify: `apps/pathway-service/src/services/resolution/gate-evaluator.ts`
  (`:184`, `:435`, `:559`, and the doc comment at `:93-94`)

**Interfaces:**
- Consumes: nothing new.
- Produces: no signature change to the *exported* `evaluateGate` — its `now`
  parameter (`:743`) stays optional.

**Why `evaluateGate` keeps its default:** ~50 existing unit-test call sites pass
4 positional arguments and omit `now` (positional #7). Making it required is a
50-file mechanical churn with real chance of a transcription error, and Plan 04
rewrites this signature anyway when it routes evaluation through `selectFacts`.
The production path is made safe structurally instead: Task 4 gives both engines
a **required** context and has them always pass `evaluationAsOf`. Leave a comment
recording the residual footgun so Plan 04 closes it.

- [ ] **Step 1: Write the failing test**

There is no new behavior to test here — this is a type-level tightening, and the
compiler is the test. Assert it that way. Create nothing; instead confirm the
*current* state compiles and the *changed* state still compiles with all call
sites supplying a clock.

Run first, to record the baseline (must be clean before you touch anything):

```
cd /home/claude/workspace/features/feat-pathway-temporal-horizon/prism-graphql/apps/pathway-service
```
then
```
./node_modules/.bin/tsc -p tsconfig.json --noEmit
```
Expected: exit 0, no output.

- [ ] **Step 2: Remove the three internal defaults**

In `gate-evaluator.ts` make exactly these three edits:

```ts
// :184 — evaluateCondition
function evaluateCondition(
  condition: GateCondition,
  patientContext: PatientContext,
  now: number,                                    // was: now: number = Date.now()
  codeMap: AttributeCodeMap = new Map(),
): { satisfied: boolean; reason: string; fieldsRead: string[] } {
```

```ts
// :435 — evaluatePatientAttribute
function evaluatePatientAttribute(
  gate: GateProperties,
  patientContext: PatientContext,
  now: number,                                    // was: now: number = Date.now()
  codeMap: AttributeCodeMap = new Map(),
): GateEvaluationResult {
```

```ts
// :559 — evaluateCompound
function evaluateCompound(
  gate: GateProperties,
  patientContext: PatientContext,
  now: number,                                    // was: now: number = Date.now()
  codeMap: AttributeCodeMap = new Map(),
): GateEvaluationResult {
```

A default parameter before a defaulted one is legal TS, so `codeMap` keeping its
default is fine. Every internal caller of these three already passes `now`
positionally (from `evaluateGate`), so no further edits are needed inside the
file — the typecheck in Step 4 confirms it.

- [ ] **Step 3: Update the two stale comments**

The comment at `:93-94` says production callers pass `Date.now()`; that is what
this plan stops being true. Replace that sentence:

```ts
 * `now` is the session's pinned `evaluationAsOf` (see
 * temporal/evaluation-context.ts), supplied by the traversal boundary. Tests
 * pin it directly so window-boundary behavior is deterministic.
```

And on the exported `evaluateGate`'s `now` parameter (`:735-742`), replace the
"Production callers omit — defaults to Date.now()" sentence:

```ts
  /**
   * The session's pinned evaluation clock (`EvaluationTemporalContext
   * .evaluationAsOf`, as epoch ms). TraversalEngine and RetraversalEngine
   * always supply it. The `Date.now()` fallback exists only for the many
   * unit-test call sites that omit it positionally; Plan 04 removes the
   * fallback when this signature is reworked for `selectFacts`.
   */
```

- [ ] **Step 4: Typecheck to verify the tightening holds**

From `apps/pathway-service`:
```
./node_modules/.bin/tsc -p tsconfig.json --noEmit
```
Expected: exit 0. If you get `Argument of type 'undefined' is not assignable to
parameter of type 'number'`, an internal call site was relying on the removed
default — pass the `now` value that call site already has in scope; do **not**
re-add a `Date.now()` default.

- [ ] **Step 5: Run the gate-evaluator suites**

Run: `npm test --prefix apps/pathway-service -- --runInBand src/__tests__/gate-evaluator`
Expected: PASS, unchanged counts. These suites exercise the operators that
consume `now` (`count_in_window`, `trend_*`) and pin it explicitly, so they are
the real regression net for this task.

- [ ] **Step 6: Commit**

```bash
git add apps/pathway-service/src/services/resolution/gate-evaluator.ts
git commit -m "refactor: require an explicit clock in the internal gate evaluators

Co-Authored-By: Claude Opus 5 (1M context) <noreply@example.com>"
```

---

### Task 4: Thread the context through both engines

**Files:**
- Modify: `apps/pathway-service/src/services/resolution/traversal-engine.ts`
  (constructor `:140-145`; call sites `:271-274`, `:664-667`)
- Modify: `apps/pathway-service/src/services/resolution/retraversal-engine.ts`
  (constructor `:75-81`; call site `:151-160`)
- Modify: `__tests__/traversal-engine.test.ts:46`,
  `__tests__/retraversal-engine.test.ts:29`,
  `__tests__/anemia-pathway-e2e.test.ts:39`
- Test: `apps/pathway-service/src/__tests__/temporal/clock-pinning.test.ts` (create)

**Interfaces:**
- Consumes: `EvaluationTemporalContext`, `makeEvaluationTemporalContext` (Tasks 1–2).
- Produces:
  ```ts
  new TraversalEngine(confidenceEngine, thresholds, temporalContext, llmGateEvaluator?, codeMap?)
  new RetraversalEngine(confidenceEngine, thresholds, temporalContext, llmGateEvaluator?, codeMap?)
  ```

**Parameter position matters.** The context must be **required**, and TypeScript
forbids a required parameter after an optional one (`llmGateEvaluator?`). So it
goes in as the **3rd** parameter, before the optionals — not appended. There are
only 5 production construction sites and 3 test sites, all enumerated above.

- [ ] **Step 1: Write the failing test**

Create `apps/pathway-service/src/__tests__/temporal/clock-pinning.test.ts`. This
is the §13 "Reproducibility" criterion: same session, moved wall clock, identical
outcome.

```ts
import { TraversalEngine } from '../../services/resolution/traversal-engine';
import { makeEvaluationTemporalContext } from '../../services/resolution/temporal/evaluation-context';
import { NodeStatus, GateAnswer, GateType, PatientContext } from '../../services/resolution/types';
import { GraphNode, GraphEdge } from '../../services/confidence/types';
import { makeGraphContext } from '../fixtures/reference-patient-context';

function node(id: string, nodeType: string, properties: Record<string, unknown> = {}): GraphNode {
  return { id, nodeIdentifier: id, nodeType, properties: { title: id, ...properties } };
}
function edge(sourceId: string, targetId: string): GraphEdge {
  return { id: `${sourceId}->${targetId}`, edgeType: 'HAS_CHILD', sourceId, targetId, properties: {} };
}

const mockConfidenceEngine = {
  computeNodeConfidence: jest.fn().mockResolvedValue({
    confidence: 0.9,
    breakdown: [],
    resolutionType: 'AUTO_RESOLVED',
  }),
};
const thresholds = { autoResolveThreshold: 0.85, suggestThreshold: 0.6 };

// A count_in_window gate is the sharpest probe: it is one of the three
// operators that actually reads the clock, and a 30-day window puts the
// fact's date right at the boundary.
const PINNED = '2026-07-30T12:00:00.000Z';
const nodes = [
  node('root', 'Pathway'),
  node('gate-1', 'Gate', {
    gate_type: GateType.PATIENT_ATTRIBUTE,
    condition: {
      field: 'labs',
      operator: 'count_in_window',
      value: '718-7',
      window_days: 30,
      count_threshold: 2,
    },
  }),
  node('step-1', 'Step'),
];
const edges = [edge('root', 'gate-1'), edge('gate-1', 'step-1')];

// Two hemoglobin results 10 and 20 days before PINNED — inside a 30-day
// window measured from PINNED, but outside one measured from a wall clock
// six months later.
const patient: PatientContext = {
  patientId: 'p1',
  conditionCodes: [],
  medications: [],
  labResults: [
    { code: '718-7', system: 'LOINC', value: 9.1, unit: 'g/dL', date: '2026-07-20T00:00:00.000Z' },
    { code: '718-7', system: 'LOINC', value: 9.4, unit: 'g/dL', date: '2026-07-10T00:00:00.000Z' },
  ],
  allergies: [],
} as PatientContext;

async function traverseAtSystemTime(systemTime: string): Promise<NodeStatus | undefined> {
  jest.useFakeTimers().setSystemTime(new Date(systemTime));
  try {
    const engine = new TraversalEngine(
      mockConfidenceEngine,
      thresholds,
      makeEvaluationTemporalContext({ evaluationAsOf: PINNED }),
    );
    const result = await engine.traverse(
      makeGraphContext(nodes, edges),
      patient,
      new Map<string, GateAnswer>(),
    );
    return result.resolutionState.get('gate-1')?.status;
  } finally {
    jest.useRealTimers();
  }
}

describe('pinned evaluation clock', () => {
  it('a moved wall clock does not change gate outcome', async () => {
    const atCreation = await traverseAtSystemTime('2026-07-30T12:00:00.000Z');
    const sixMonthsLater = await traverseAtSystemTime('2027-01-30T12:00:00.000Z');

    expect(atCreation).toBe(NodeStatus.INCLUDED);
    expect(sixMonthsLater).toBe(atCreation);
  });
});
```

**Note on fake timers:** `jest.useFakeTimers()` also fakes the `Date.now()` the
traversal *timeout* logic reads. Because the timers never advance inside a
traversal, elapsed time reads as 0 and the timeout never trips — which is what we
want. Do not call `jest.advanceTimersByTime()` in this test.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test --prefix apps/pathway-service -- --runInBand src/__tests__/temporal/clock-pinning.test.ts`
Expected: FAIL — `TraversalEngine` takes the 3rd argument as `llmGateEvaluator`,
so it either type-errors under ts-jest or the second traversal returns
`GATED_OUT` (the labs fall outside a window measured from the moved wall clock).
Either failure is the correct starting point; a PASS here means the test is not
exercising the clock — check that `window_days` is being read.

- [ ] **Step 3: Add the constructor parameter to TraversalEngine**

In `traversal-engine.ts`, import the type and insert the parameter 3rd:

```ts
import { EvaluationTemporalContext } from './temporal/evaluation-context';
```

```ts
export class TraversalEngine {
  constructor(
    private confidenceEngine: TraversalConfidenceAdapter,
    private thresholds: { autoResolveThreshold: number; suggestThreshold: number },
    /**
     * The session's pinned clock. Required: every gate evaluation in this
     * traversal reads `evaluationAsOf` from here instead of the wall clock,
     * so a retraversal or replay reproduces this traversal exactly.
     */
    private temporalContext: EvaluationTemporalContext,
    private llmGateEvaluator?: LlmGateEvaluator,
    private codeMap: AttributeCodeMap = new Map(),
  ) {}
```

Add a private helper on the class so both call sites agree, and the epoch
conversion happens once per traversal rather than per gate:

```ts
  /** The pinned clock as epoch ms, for the operator implementations. */
  private evaluationNowMs(): number {
    return Date.parse(this.temporalContext.evaluationAsOf);
  }
```

- [ ] **Step 4: Pass the pinned clock at both `evaluateGate` call sites**

`traversal-engine.ts:271` — replace the `undefined`:

```ts
        const gateResult = await evaluateGate(
          gateProps, patientContext, resolutionState, gateAnswers, nodeIdentifier,
          this.llmGateEvaluator, this.evaluationNowMs(), this.codeMap,
        );
```

`traversal-engine.ts:664` — the same replacement:

```ts
      const gateResult = await evaluateGate(
        gateProps, patientContext, resolutionState, gateAnswers, nodeIdentifier,
        this.llmGateEvaluator, this.evaluationNowMs(), this.codeMap,
      );
```

- [ ] **Step 5: Do the same for RetraversalEngine**

In `retraversal-engine.ts`, add the same import, the same 3rd constructor
parameter, and the same `evaluationNowMs()` helper:

```ts
export class RetraversalEngine {
  constructor(
    private confidenceEngine: RetraversalConfidenceAdapter,
    private thresholds: { autoResolveThreshold: number; suggestThreshold: number },
    /** The pinned clock read back off the session — never re-stamped here. */
    private temporalContext: EvaluationTemporalContext,
    private llmGateEvaluator?: LlmGateEvaluator,
    private codeMap: AttributeCodeMap = new Map(),
  ) {}

  private evaluationNowMs(): number {
    return Date.parse(this.temporalContext.evaluationAsOf);
  }
```

and at `:151` replace the `undefined` argument:

```ts
          const gateResult = await evaluateGate(
            gateProps,
            patientContext,
            resolutionState,
            gateAnswers,
            nodeId,
            this.llmGateEvaluator,
            this.evaluationNowMs(),
            this.codeMap,
          );
```

- [ ] **Step 6: Fix the three test construction sites**

These are mechanical. Import `makeEvaluationTemporalContext` in each file and
insert a pinned context as the 3rd argument.

`__tests__/traversal-engine.test.ts:46`:
```ts
  return new TraversalEngine(
    mockConfidenceEngine,
    mockThresholds,
    makeEvaluationTemporalContext({ evaluationAsOf: '2026-07-30T12:00:00.000Z' }),
  );
```

`__tests__/retraversal-engine.test.ts:29`:
```ts
    engine = new RetraversalEngine(
      mockConfidenceEngine as any,
      mockThresholds,
      makeEvaluationTemporalContext({ evaluationAsOf: '2026-07-30T12:00:00.000Z' }),
    );
```

`__tests__/anemia-pathway-e2e.test.ts:39`:
```ts
  return new TraversalEngine(
    mockConfidenceEngine,
    mockThresholds,
    makeEvaluationTemporalContext({ evaluationAsOf: '2026-07-30T12:00:00.000Z' }),
    undefined,
    CODE_MAP,
  );
```

The import path from `__tests__/` is
`../services/resolution/temporal/evaluation-context`.

**Watch for a real behavior trap here:** these suites previously ran against the
wall clock. Any fixture whose dates are relative to "today" (e.g. a lab dated by
subtracting from `Date.now()`) will now be compared against a *fixed* 2026-07-30
clock and may fall outside its window. If a suite fails after this edit, do not
widen the window — set that suite's pinned `evaluationAsOf` to an instant
consistent with its fixture dates, and note it in the commit message.

- [ ] **Step 7: Fix the five production construction sites**

These are the sites the compiler will flag; Task 6 gives them their real
contexts. For now, insert `makeEvaluationTemporalContext()` (no argument — stamps
"now", preserving today's behavior exactly) as the 3rd argument at:

- `resolvers/mutations/resolution.ts:101` (TraversalEngine)
- `resolvers/mutations/resolution.ts:232`, `:390`, `:566` (RetraversalEngine)
- `resolvers/mutations/multi-pathway-resolution.ts:687` (TraversalEngine)

Add the import to both resolver files:
```ts
import { makeEvaluationTemporalContext } from '../../services/resolution/temporal/evaluation-context';
```

Leave a marker at each retraversal site so Task 6 finds them:
```ts
      // Task 6 replaces this with the context persisted on the session.
      makeEvaluationTemporalContext(),
```

- [ ] **Step 8: Typecheck and run the full suite**

From `apps/pathway-service`:
```
./node_modules/.bin/tsc -p tsconfig.json --noEmit
```
Expected: exit 0.

Then the whole service suite — this task changes shared constructors, so a
targeted run is not enough:
```
npm test --prefix apps/pathway-service -- --runInBand
```
Expected: PASS. Compare the totals against a pre-task baseline; the count must
not drop.

- [ ] **Step 9: Commit**

```bash
git add apps/pathway-service/src/services/resolution/traversal-engine.ts \
        apps/pathway-service/src/services/resolution/retraversal-engine.ts \
        apps/pathway-service/src/resolvers/mutations/resolution.ts \
        apps/pathway-service/src/resolvers/mutations/multi-pathway-resolution.ts \
        apps/pathway-service/src/__tests__/traversal-engine.test.ts \
        apps/pathway-service/src/__tests__/retraversal-engine.test.ts \
        apps/pathway-service/src/__tests__/anemia-pathway-e2e.test.ts \
        apps/pathway-service/src/__tests__/temporal/clock-pinning.test.ts
git commit -m "feat: thread the pinned evaluation clock through both engines

Co-Authored-By: Claude Opus 5 (1M context) <noreply@example.com>"
```

---

### Task 5: Persist `temporal_context` on both session tables

**Files:**
- Create: `shared/data-layer/migrations/063_add_temporal_context_to_sessions.sql`
- Modify: `apps/pathway-service/src/services/resolution/types.ts` (`:268`)
- Modify: `apps/pathway-service/src/services/resolution/session-store.ts`
  (`createSession` `:98`, `getSession` `:144`)
- Modify: `apps/pathway-service/src/services/resolution/multi-pathway-session-store.ts`
  (`createMultiPathwaySession` `:60`, `rowToSession`, the
  `MultiPathwayResolutionSession` interface `:18`)
- Test: `apps/pathway-service/src/__tests__/temporal/session-temporal-context.test.ts` (create)

**Interfaces:**
- Consumes: `EvaluationTemporalContext` (Task 1).
- Produces: `ResolutionSession.temporalContext?: EvaluationTemporalContext`;
  `createSession({ ..., temporalContext })`.

**Nullability decision:** the column is **nullable**, with no default. A null
means "session created before the temporal clock existed". Design §5 states such
sessions are non-retraversable; Task 6 makes that an explicit typed error rather
than a silent re-stamp. This is safe because the design's load-bearing premise is
that **no production sessions exist** on the host — verify that before relying on
it (`SELECT count(*) FROM pathway_resolution_sessions;`) and say so in the commit
message if any rows are found.

Migration number 063 — confirmed next free (062 is
`062_create_pathway_attribute_code_map.sql`). If another branch has taken 063 by
the time you run this, renumber to the next free number and keep the filename
suffix.

- [ ] **Step 1: Write the failing test**

Create `apps/pathway-service/src/__tests__/temporal/session-temporal-context.test.ts`.
Follow the existing unit-test pattern of a fake `Pool` rather than a live DB —
this asserts the column is written and read, not that Postgres works.

```ts
import { createSession, getSession } from '../../services/resolution/session-store';
import { makeEvaluationTemporalContext } from '../../services/resolution/temporal/evaluation-context';
import { createEmptyDependencyMap } from '../../services/resolution/types';

const TCTX = makeEvaluationTemporalContext({
  evaluationAsOf: '2026-07-30T12:00:00.000Z',
  encounterStart: '2026-07-30T09:00:00.000Z',
});

function fakePool(rows: Array<Record<string, unknown>>) {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const pool = {
    query: jest.fn(async (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
      return { rows: rows.shift() ? [rows[0]] : [{ id: 'session-1' }] };
    }),
  };
  return { pool, calls };
}

describe('session temporal_context persistence', () => {
  it('createSession writes the temporal context as JSON', async () => {
    const { pool, calls } = fakePool([]);
    await createSession(pool as never, {
      pathwayId: 'p', pathwayVersion: '1', patientId: 'pt', providerId: 'pr',
      status: 'ACTIVE',
      initialPatientContext: {},
      resolutionState: new Map(),
      dependencyMap: createEmptyDependencyMap(),
      pendingQuestions: [], redFlags: [],
      totalNodesEvaluated: 0, traversalDurationMs: 1,
      temporalContext: TCTX,
    });

    const insert = calls.find((c) => c.sql.includes('INSERT INTO pathway_resolution_sessions'))!;
    expect(insert.sql).toContain('temporal_context');
    expect(insert.params).toContain(JSON.stringify(TCTX));
  });

  it('getSession hydrates the temporal context from the row', async () => {
    const pool = {
      query: jest.fn()
        .mockResolvedValueOnce({
          rows: [{
            id: 'session-1', pathway_id: 'p', pathway_version: '1',
            patient_id: 'pt', provider_id: 'pr', status: 'ACTIVE',
            resolution_state: {}, dependency_map: {},
            initial_patient_context: {}, additional_context: {},
            pending_questions: [], red_flags: [], gate_answers: {},
            total_nodes_evaluated: 0, traversal_duration_ms: 1,
            ddi_warnings: [], temporal_context: TCTX,
            created_at: new Date(), updated_at: new Date(),
          }],
        })
        .mockResolvedValueOnce({ rows: [] }),
    };

    const session = await getSession(pool as never, 'session-1');
    expect(session!.temporalContext).toEqual(TCTX);
    expect(session!.temporalContext!.evaluationAsOf).toBe('2026-07-30T12:00:00.000Z');
  });

  it('getSession leaves temporalContext undefined for a pre-migration row', async () => {
    const pool = {
      query: jest.fn()
        .mockResolvedValueOnce({
          rows: [{
            id: 'session-1', pathway_id: 'p', pathway_version: '1',
            patient_id: 'pt', provider_id: 'pr', status: 'ACTIVE',
            resolution_state: {}, dependency_map: {},
            initial_patient_context: {}, additional_context: {},
            pending_questions: [], red_flags: [], gate_answers: {},
            total_nodes_evaluated: 0, traversal_duration_ms: 1,
            ddi_warnings: [], temporal_context: null,
            created_at: new Date(), updated_at: new Date(),
          }],
        })
        .mockResolvedValueOnce({ rows: [] }),
    };

    const session = await getSession(pool as never, 'session-1');
    expect(session!.temporalContext).toBeUndefined();
  });
});
```

`createEmptyDependencyMap` is exported from `types.ts:65` — verified; import it
rather than hand-rolling the four empty maps.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test --prefix apps/pathway-service -- --runInBand src/__tests__/temporal/session-temporal-context.test.ts`
Expected: FAIL — `temporalContext` is not a known property of the `createSession`
argument, and `session.temporalContext` is `undefined` in the hydrate test.

- [ ] **Step 3: Write the migration**

Create `shared/data-layer/migrations/063_add_temporal_context_to_sessions.sql`:

```sql
-- Migration 063: pin an evaluation clock to every resolution session
--
-- Temporal horizon work (design §1, §11). Each session stores the single
-- EvaluationTemporalContext it was created with — evaluationAsOf, the optional
-- encounterStart anchor, the pinned snapshot, and the temporal policy version —
-- so retraversal and replay resolve horizons against the same instant the
-- initial traversal did instead of re-reading the wall clock.
--
-- Nullable on purpose: a NULL marks a session created before this column
-- existed. Those sessions are not retraversable (design §5) and the service
-- raises SESSION_NOT_RETRAVERSABLE rather than silently re-stamping a clock.

BEGIN;

ALTER TABLE pathway_resolution_sessions
  ADD COLUMN temporal_context JSONB;

ALTER TABLE multi_pathway_resolution_sessions
  ADD COLUMN temporal_context JSONB;

COMMENT ON COLUMN pathway_resolution_sessions.temporal_context IS
    'Pinned EvaluationTemporalContext: evaluationAsOf, encounterStart, snapshotId, snapshotCapturedAt, timezone, temporalPolicyVersion. NULL = pre-temporal session, not retraversable.';

COMMENT ON COLUMN multi_pathway_resolution_sessions.temporal_context IS
    'Same context as pathway_resolution_sessions.temporal_context, stamped once and shared by every per-pathway traversal in the multi-pathway run.';

COMMIT;
```

- [ ] **Step 4: Add the field to the session type**

In `types.ts`, inside `ResolutionSession` (`:268`), after `ddiWarnings`:

```ts
  /**
   * The pinned evaluation clock this session was created with (§1).
   * Optional only for rows written before migration 063 — those sessions
   * are not retraversable.
   */
  temporalContext?: EvaluationTemporalContext;
```

and import the type at the top of `types.ts`:
```ts
import { EvaluationTemporalContext } from './temporal/evaluation-context';
```

Check for an import cycle: `temporal/evaluation-context.ts` imports only from
`./overlap` and `./interval`, and neither imports `types.ts`, so this is acyclic.
Keep it that way — do not import `types.ts` from the temporal module.

- [ ] **Step 5: Write and read the column in `session-store.ts`**

In `createSession`'s parameter object, add it as **required** (no `?`):
```ts
    temporalContext: EvaluationTemporalContext;
```

**Required on the way in, optional on the way out — this asymmetry is
deliberate.** The column is nullable and `ResolutionSession.temporalContext` is
optional because pre-migration rows genuinely have no clock. But every session
created from now on must have one, and making the creation parameter required
is what lets the compiler prove it: a new `createSession` call site that forgets
the clock becomes a build error instead of a session that silently cannot be
retraversed. There are only two `createSession` call sites (`resolution.ts:126`,
`multi-pathway-resolution.ts:731`) and Task 6 updates both, so the cost is nil.

Extend the INSERT to a 15th column and placeholder:
```ts
    `INSERT INTO pathway_resolution_sessions
     (pathway_id, pathway_version, patient_id, provider_id, status, initial_patient_context,
      resolution_state, dependency_map, pending_questions, red_flags, gate_answers,
      total_nodes_evaluated, traversal_duration_ms, ddi_warnings, temporal_context)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
     RETURNING id`,
```
and append to the parameter array, after `ddi_warnings`:
```ts
      session.temporalContext ? JSON.stringify(session.temporalContext) : null,
```

In `getSession`'s returned object, add:
```ts
    temporalContext: (row.temporal_context ?? undefined) as EvaluationTemporalContext | undefined,
```

`pg` parses a `JSONB` column into an object already — do **not** `JSON.parse`
`row.temporal_context`, and note the `?? undefined` is what turns a SQL NULL into
`undefined` rather than `null` (the type says optional, and `strictNullChecks` is
off, so nothing else will catch a stray `null`).

Import the type in `session-store.ts`:
```ts
import { EvaluationTemporalContext } from './temporal/evaluation-context';
```

- [ ] **Step 6: Do the same for the multi-pathway store**

In `multi-pathway-session-store.ts`:
- add `temporalContext?: EvaluationTemporalContext;` (optional) to the
  `MultiPathwayResolutionSession` interface (`:18`), and
  `temporalContext: EvaluationTemporalContext;` (**required**) to
  `createMultiPathwaySession`'s parameter object (`:60`) — same read-optional /
  write-required split as `createSession`, and for the same reason. Both
  `createMultiPathwaySession` call sites live in `startMultiPathwayResolution`
  and Task 6 Step 5 updates both, including the zero-match path;
- extend the INSERT to include `temporal_context` as a `$9::jsonb` placeholder
  and pass `s.temporalContext ? JSON.stringify(s.temporalContext) : null`;
- in `rowToSession`, map
  `temporalContext: (row.temporal_context ?? undefined)`.

Mind the existing placeholder numbering — the current statement ends at `$8` with
a literal `'{}'::jsonb` for `conflict_resolutions`; the new column becomes `$9`.

- [ ] **Step 7: Run the test and typecheck**

Run: `npm test --prefix apps/pathway-service -- --runInBand src/__tests__/temporal/session-temporal-context.test.ts`
Expected: PASS.

From `apps/pathway-service`:
```
./node_modules/.bin/tsc -p tsconfig.json --noEmit
```
Expected: exit 0.

- [ ] **Step 8: Apply the migration to the local DB**

The migrator CLI is broken (see CLAUDE.md "Migration workflow"), so apply it
directly and record the history row:

```bash
export PGPASSWORD=$(pm2 env 0 | awk -F': ' '/^POSTGRES_PASSWORD/{print $2}')
MIG=/home/claude/workspace/features/feat-pathway-temporal-horizon/prism-graphql/shared/data-layer/migrations
f=063_add_temporal_context_to_sessions.sql
checksum=$(node -e "console.log(require('crypto').createHash('sha256').update(require('fs').readFileSync('${MIG}/${f}','utf-8').trim()).digest('hex'))")
psql -h localhost -U prism -d prism_db -v ON_ERROR_STOP=1 -f "${MIG}/${f}"
psql -h localhost -U prism -d prism_db -c \
  "INSERT INTO migration_history (migration_id, name, checksum) VALUES ('063_add_temporal_context_to_sessions', '063_add_temporal_context_to_sessions', '$checksum');"
```

Verify:
```bash
psql -h localhost -U prism -d prism_db -c "\d+ pathway_resolution_sessions" | grep temporal_context
```
Expected: one row showing `temporal_context | jsonb`.

**This mutates the live host database.** The change is additive and nullable, so
it is safe against the running pm2 processes (they never SELECT the new column
until redeployed). Do not redeploy as part of this plan.

- [ ] **Step 9: Commit**

```bash
git add shared/data-layer/migrations/063_add_temporal_context_to_sessions.sql \
        apps/pathway-service/src/services/resolution/types.ts \
        apps/pathway-service/src/services/resolution/session-store.ts \
        apps/pathway-service/src/services/resolution/multi-pathway-session-store.ts \
        apps/pathway-service/src/__tests__/temporal/session-temporal-context.test.ts
git commit -m "feat: persist the pinned evaluation clock on resolution sessions

Co-Authored-By: Claude Opus 5 (1M context) <noreply@example.com>"
```

---

### Task 6: Wire the boundary — stamp once, read back on retraversal

The last task closes the loop: `startResolution` stamps the context, the session
row carries it, and every retraversal reuses it verbatim instead of stamping a
fresh one.

**Files:**
- Modify: `apps/pathway-service/src/resolvers/mutations/resolution.ts`
  (`startResolution` `:47`; the three `RetraversalEngine` sites `:232`, `:390`, `:566`)
- Modify: `apps/pathway-service/src/resolvers/mutations/multi-pathway-resolution.ts`
  — `startMultiPathwayResolution` (`:129`): create the context, and stamp it on
  **both** `createMultiPathwaySession` calls (`:160` zero-match, `:185` normal);
  `resolveAndPersistAll` (`:668`): new required parameter, `:687` engine,
  `:731` createSession
- Modify: `apps/pathway-service/src/__tests__/resolution-retraversal-context.test.ts`
  (`makeSession()` `:91`)
- Test: `apps/pathway-service/src/__tests__/temporal/retraversal-clock-reuse.test.ts` (create)

**Interfaces:**
- Consumes: everything from Tasks 1–5.
- Produces: no new exported API. The observable contract is: a session's
  `temporal_context` is written at creation and is the clock every later
  retraversal of that session uses.

- [ ] **Step 1: Write the failing test**

Create `apps/pathway-service/src/__tests__/temporal/retraversal-clock-reuse.test.ts`.

**Mirror `resolution-retraversal-context.test.ts` exactly** — read it before
writing this file. A partial mock does not fail loudly here: `overrideNode`
calls `makeRetraversalAdapter`, `makeLlmGateEvaluator` and `logNodeOverride` in
addition to `buildResolutionContext` and `getSession`, and `jest.mock` with a
factory replaces the **whole** module, so any export left out of the factory is
`undefined` at call time. The positive case then dies with
"`makeLlmGateEvaluator` is not a function" *before* it ever constructs the
engine, so `retraversalCtor` is never called and the assertion fails with a
confusing message.

The negative case hides this: `requireSessionTemporalContext` is hoisted above
the retraversal, so it throws before reaching any of those helpers and passes
whether or not the mocks are complete. Do not read one green test as evidence
the harness is sound — mock every export the resolver touches, not just the
ones this test asserts on.

```ts
const mockRetraverse = jest.fn().mockResolvedValue({
  statusChanges: [], newPendingQuestions: [], newRedFlags: [],
  nodesRecomputed: 0, isIncomplete: false,
});
const retraversalCtor = jest.fn();

// Every session-store export `resolution.ts` imports — see its import block.
jest.mock('../../services/resolution/session-store', () => ({
  createSession: jest.fn().mockResolvedValue('session-1'),
  getSession: jest.fn(),
  updateSession: jest.fn().mockResolvedValue(undefined),
  logEvent: jest.fn().mockResolvedValue(undefined),
  logNodeOverride: jest.fn().mockResolvedValue(undefined),
  logGateAnswer: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../services/resolution/retraversal-engine', () => ({
  RetraversalEngine: class {
    constructor(...args: unknown[]) { retraversalCtor(...args); }
    retraverse = mockRetraverse;
  },
}));

// All four resolution-context helpers, and the full graphContext shape the
// canonical test uses — a thinner stub breaks as soon as the resolver walks
// edges.
jest.mock('../../resolvers/helpers/resolution-context', () => ({
  buildResolutionContext: jest.fn().mockResolvedValue({
    graphContext: {
      allNodes: [],
      allEdges: [],
      incomingEdges: () => [],
      outgoingEdges: () => [],
      getNode: () => undefined,
      linkedNodes: () => [],
    },
    edges: [],
    signals: [],
    thresholds: { autoResolveThreshold: 0.85, suggestThreshold: 0.6 },
    confidenceEngine: {},
    codeMap: new Map(),
  }),
  makeTraversalAdapter: jest.fn(),
  makeRetraversalAdapter: jest.fn(() => ({ computeNodeConfidence: jest.fn() })),
  makeLlmGateEvaluator: jest.fn(() => null),
}));

import { getSession } from '../../services/resolution/session-store';
import { resolutionMutations } from '../../resolvers/mutations/resolution';
import { makeEvaluationTemporalContext, TemporalContextError }
  from '../../services/resolution/temporal/evaluation-context';
import { NodeStatus, OverrideAction } from '../../services/resolution/types';

const mockedGetSession = getSession as jest.MockedFunction<typeof getSession>;
const PINNED = '2026-01-15T08:30:00.000Z';

function sessionWith(temporalContext: unknown) {
  const resolutionState = new Map([
    ['node-1', { nodeId: 'node-1', nodeType: 'Step', title: 'n1', status: NodeStatus.INCLUDED, confidence: 1, confidenceBreakdown: [], depth: 1 }],
    ['node-2', { nodeId: 'node-2', nodeType: 'Step', title: 'n2', status: NodeStatus.INCLUDED, confidence: 1, confidenceBreakdown: [], depth: 2 }],
  ]);
  return {
    id: 'session-1', pathwayId: 'pathway-1', pathwayVersion: '1',
    patientId: 'pt', providerId: 'pr', status: 'ACTIVE',
    resolutionState,
    dependencyMap: {
      influencedBy: new Map(), influences: new Map([['node-1', new Set(['node-2'])]]),
      gateContextFields: new Map(), scorerInputs: new Map(),
    },
    initialPatientContext: { patientId: 'pt', conditionCodes: [], medications: [], labResults: [], allergies: [] },
    additionalContext: {}, pendingQuestions: [], redFlags: [], resolutionEvents: [],
    gateAnswers: new Map(), totalNodesEvaluated: 2, traversalDurationMs: 1,
    ddiWarnings: [], temporalContext,
    createdAt: new Date(), updatedAt: new Date(),
  };
}

describe('retraversal reuses the session clock', () => {
  beforeEach(() => { retraversalCtor.mockClear(); });

  it('constructs RetraversalEngine with the clock persisted on the session', async () => {
    mockedGetSession.mockResolvedValue(
      sessionWith(makeEvaluationTemporalContext({ evaluationAsOf: PINNED })) as never,
    );

    await resolutionMutations.overrideNode(
      undefined,
      { sessionId: 'session-1', nodeId: 'node-1', action: OverrideAction.EXCLUDE, reason: 'r' },
      { pool: { query: jest.fn().mockResolvedValue({ rows: [] }) }, userId: 'pr' } as never,
    );

    expect(retraversalCtor).toHaveBeenCalled();
    const thirdArg = retraversalCtor.mock.calls[0][2];
    expect(thirdArg).toMatchObject({ evaluationAsOf: PINNED, timezone: 'UTC' });
  });

  it('refuses to retraverse a pre-migration session with no pinned clock', async () => {
    mockedGetSession.mockResolvedValue(sessionWith(undefined) as never);

    await expect(
      resolutionMutations.overrideNode(
        undefined,
        { sessionId: 'session-1', nodeId: 'node-1', action: OverrideAction.EXCLUDE, reason: 'r' },
        { pool: { query: jest.fn().mockResolvedValue({ rows: [] }) }, userId: 'pr' } as never,
      ),
    ).rejects.toThrow(/SESSION_NOT_RETRAVERSABLE|pinned evaluation clock/i);

    expect(retraversalCtor).not.toHaveBeenCalled();
  });
});
```

Adjust the mocked module paths / argument shapes if `overrideNode`'s signature
differs from what you read at `resolution.ts:196`; read the resolver first and
match it exactly rather than forcing the resolver to match this test.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test --prefix apps/pathway-service -- --runInBand src/__tests__/temporal/retraversal-clock-reuse.test.ts`
Expected: FAIL — the 3rd constructor argument is a freshly-stamped context whose
`evaluationAsOf` is "now", not `PINNED`; and the second case does not throw.

- [ ] **Step 3: Stamp the context in `startResolution`**

In `resolution.ts`, inside `startResolution`, after the `patientContext` literal
is built (`:98`) and before the engine is constructed:

```ts
    // One clock for the whole session (§1). Read the wall clock exactly once,
    // here — every gate evaluation, retraversal, and replay uses this instant.
    const temporalContext = makeEvaluationTemporalContext();
```

Use it in the engine, replacing the Task 4 placeholder:
```ts
    const traversalEngine = new TraversalEngine(
      makeTraversalAdapter(rctx, pool, args.pathwayId, patientContext),
      rctx.thresholds,
      temporalContext,
      llmBundle?.evaluator,
      rctx.codeMap,
    );
```

and persist it in the `createSession` call (`:126`), alongside `ddiWarnings`:
```ts
      ddiWarnings,
      temporalContext,
```

**Do not** add an `evaluationAsOf` argument to the `startResolution` GraphQL
input. Accepting a caller-supplied clock is Plan 05's trust-mode work; adding it
now would let any caller move the clock with no mode check.

- [ ] **Step 4: Read the context back at the three retraversal sites**

Add a module-level helper in `resolution.ts`, near the other helpers:

```ts
/**
 * A retraversal must reuse the clock its session was created with — never
 * stamp a new one, or the same data could resolve differently than it did at
 * creation. Sessions written before migration 063 have no clock and are not
 * retraversable (§5).
 */
function requireSessionTemporalContext(session: ResolutionSession): EvaluationTemporalContext {
  if (!session.temporalContext) {
    throw new GraphQLError(
      'Session has no pinned evaluation clock and cannot be retraversed (created before temporal context was introduced)',
      { extensions: { code: 'SESSION_NOT_RETRAVERSABLE' } },
    );
  }
  return session.temporalContext;
}
```

**Two imports this helper needs, neither of which `resolution.ts` has today:**

1. `ResolutionSession`. The file currently imports only `GateAnswer` from the
   resolution types module:
   ```ts
   import { GateAnswer } from '../../services/resolution/types';
   ```
   Widen it to a type-only import for the added name, so the value import is
   untouched and nothing new lands in the emitted JS:
   ```ts
   import { GateAnswer } from '../../services/resolution/types';
   import type { ResolutionSession } from '../../services/resolution/types';
   ```
2. `EvaluationTemporalContext`, alongside `makeEvaluationTemporalContext` from
   `../../services/resolution/temporal/evaluation-context` — also a type-only
   use, so import it with `import type` unless it shares a line with the
   factory.

Without (1) the helper's signature references an undeclared name and the file
will not compile — a failure Task 6 Step 7's typecheck catches, but only after
you have written every other change in this task.

Then at each of the three `RetraversalEngine` constructions (`:232`, `:390`,
`:566`), replace the Task 4 placeholder with the session's clock. Each site
already has `session` in scope:

```ts
      const retraversalEngine = new RetraversalEngine(
        makeRetraversalAdapter(rctx, pool, session.pathwayId, patientCtx),
        rctx.thresholds,
        requireSessionTemporalContext(session),
        llmBundle?.evaluator,
        rctx.codeMap,
      );
```

Hoist the `requireSessionTemporalContext(session)` call to **before** the
`if (affectedNodes.size > 0)` guard in each resolver, so a clock-less session is
rejected consistently rather than only when a retraversal happens to be
triggered. At `:566` the local patient context variable is `updatedPc`, not
`patientCtx` — keep the existing name.

- [ ] **Step 5: Stamp once for the multi-pathway run**

**Stamp in `startMultiPathwayResolution`, not in `resolveAndPersistAll`.** The
clock has to be created at the outermost boundary of the run, because
`resolveAndPersistAll` is not that boundary:

- `startMultiPathwayResolution` (`:129`) calls `createMultiPathwaySession`
  **twice** — once on the zero-match early return (`:160`) and once on the
  normal path (`:185`) — and both are *outside* `resolveAndPersistAll`
  (`:668`).
- The zero-match branch returns before `resolveAndPersistAll` is ever called.
  A context created inside that function therefore cannot reach the parent
  session at all on that path, and on the normal path the parent would need the
  child's clock handed back out.

Creating it inside the callee gives the parent session either no clock or a
different clock from its own children — exactly the divergence the pinned clock
exists to prevent.

**5a. Create the context at the top of `startMultiPathwayResolution`**, before
`getMatchedPathways` (`:157`), so both branches below can see it:

```ts
    // One clock for the entire multi-pathway run (§1) — the parent session and
    // every contributing session resolve horizons against the same instant.
    // Created here, before the zero-match branch, so BOTH exits stamp it.
    const temporalContext = makeEvaluationTemporalContext();
```

**5b. Persist it on the zero-match `createMultiPathwaySession`** (`:160`),
alongside `isPreview`:
```ts
        mergedPlan: emptyMergedCarePlan(),
        isPreview,
        temporalContext,
```

An empty session still records *when* "no pathways matched" was decided — that
is the paper trail the existing comment there promises, and without a clock it
is not reproducible.

**5c. Thread it into `resolveAndPersistAll`** as a new required parameter rather
than letting the callee stamp its own. Its current signature (`:668`) is
`(pool, surviving, patientContext, userId)`; add the context last:

```ts
export async function resolveAndPersistAll(
  pool: Pool,
  pathways: MatchedPathway[],
  patientContext: PatientContext,
  providerId: string,
  temporalContext: EvaluationTemporalContext,
): Promise<...>
```

and update the single call site (`:172` in `startMultiPathwayResolution`):
```ts
      await resolveAndPersistAll(pool, surviving, patientContext, context.userId, temporalContext);
```

Import `EvaluationTemporalContext` in `multi-pathway-resolution.ts`. Keep the
parameter required — it is the whole point of this step that the callee cannot
invent its own clock.

**5d. Use it for every `TraversalEngine` in the loop** (`:687`, replacing the
Task 4 placeholder). The parameter is now in scope for every iteration, so all
contributing pathways in one run share one instant:
```ts
    const engine = new TraversalEngine(
      makeTraversalAdapter(rctx, pool, m.pathwayId, patientContext),
      rctx.thresholds,
      temporalContext,
      llmBundle?.evaluator,
      rctx.codeMap,
    );
```

**5e. Persist it on every contributing `createSession`** (`:731`):
```ts
      traversalDurationMs: traversalResult.traversalDurationMs,
      temporalContext,
```

**5f. Persist it on the normal-path `createMultiPathwaySession`** (`:185`),
alongside `ddiWarnings`:
```ts
      ddiWarnings,
      isPreview,
      temporalContext,
```

After this step the parent session and all of its contributing sessions carry
byte-identical `temporal_context` values. That is the invariant Step 7's
assertion checks.

- [ ] **Step 6: Update the existing retraversal-context test fixture**

`__tests__/resolution-retraversal-context.test.ts:91` — its `makeSession()`
returns a `ResolutionSession` that now needs a clock, or every test in the file
will hit the new `SESSION_NOT_RETRAVERSABLE` guard:

```ts
function makeSession(overrides: Partial<ResolutionSession> = {}): ResolutionSession {
  return {
    id: 'session-1',
    pathwayId: 'pathway-1',
    pathwayVersion: '1',
    // ... existing fields unchanged ...
    temporalContext: makeEvaluationTemporalContext({ evaluationAsOf: '2026-07-30T12:00:00.000Z' }),
    ...overrides,
  };
}
```

Put `temporalContext` **before** `...overrides` so a test can still override it.
Import from `../services/resolution/temporal/evaluation-context`.

- [ ] **Step 7: Run the new test, then the full suite**

Run: `npm test --prefix apps/pathway-service -- --runInBand src/__tests__/temporal/retraversal-clock-reuse.test.ts`
Expected: PASS.

Then check the multi-pathway invariant from Step 5 — that the parent session and
its contributing sessions share one clock, and that the zero-match parent gets
one at all. `multi-pathway-resolution.test.ts` already mocks both session stores
and has fixtures for the zero-match and two-pathway cases, so add to it rather
than building a second harness.

**First, repair that file's `resolution-context` mock — it is currently broken,
and two of its tests fail before you touch anything.** Its factory (`:32`) omits
`makeLlmGateEvaluator`, which `resolveAndPersistAll` calls at `:686`, so
`persists per-pathway sessions...` and `skips a pathway whose graph is empty...`
both die with `makeLlmGateEvaluator is not a function`. These are two of the 15
pre-existing failures in the repo baseline, and they are the same defect review
found in Task 6 Step 1's harness — the incomplete-mock trap is not hypothetical,
it is already live here. Both new cases below run through `resolveAndPersistAll`
and would fail the same way. Add the missing export:

```ts
jest.mock('../resolvers/helpers/resolution-context', () => ({
  buildResolutionContext: jest.fn(),
  makeTraversalAdapter: jest.fn(() => ({})),
  makeLlmGateEvaluator: jest.fn(() => null),   // ← was missing
}));
```

Expect the baseline to improve from 15 failures to 13. Say so in the commit
message — a *drop* in the failure count is as much a change in the suite's
behavior as a rise, and the next person comparing against the recorded baseline
needs to know why. Do not extend this to the other three failing suites; they
are unrelated and out of scope.

Then the two new cases:

```ts
it('stamps one clock across the parent and every contributing session', async () => {
  await multiPathwayResolutionMutations.startMultiPathwayResolution(undefined, args, ctx);

  const parent = (createMultiPathwaySession as jest.Mock).mock.calls[0][1];
  const children = (createSession as jest.Mock).mock.calls.map((c) => c[1]);

  expect(parent.temporalContext).toBeDefined();
  expect(children.length).toBeGreaterThan(0);
  for (const child of children) {
    // Identity, not just "both defined" — two clocks stamped microseconds
    // apart would satisfy a weaker assertion and still break replay.
    expect(child.temporalContext).toEqual(parent.temporalContext);
  }
});

it('stamps a clock on the zero-match parent session too', async () => {
  // getMatchedPathways mocked to return []
  await multiPathwayResolutionMutations.startMultiPathwayResolution(undefined, args, ctx);
  const parent = (createMultiPathwaySession as jest.Mock).mock.calls[0][1];
  expect(parent.temporalContext).toMatchObject({ timezone: 'UTC' });
  expect(parent.temporalContext.evaluationAsOf).toEqual(expect.any(String));
});
```

Match the file's existing mock/arg fixtures rather than the placeholder `args` /
`ctx` names above.

Then everything, plus a typecheck:
```
npm test --prefix apps/pathway-service -- --runInBand
```
Expected: no *new* failures versus the Task 4 baseline, and two *fewer* — the
repo carries 15 pre-existing failures across `data-completeness-scorer`,
`patient-match-scorer`, `ddi-multi-pathway` and `multi-pathway-resolution`; the
mock repair above clears the two in `multi-pathway-resolution`, leaving 13. The
other three suites are untouched by this plan.

From `apps/pathway-service`:
```
./node_modules/.bin/tsc -p tsconfig.json --noEmit
```
Expected: exit 0.

- [ ] **Step 8: Verify no stray wall-clock reads remain in the temporal path**

```bash
grep -rn "Date.now()" apps/pathway-service/src/services/resolution/ --include=*.ts | grep -v __tests__
```
Expected: exactly four hits, all timeout-related and all correct to leave:
`safety.ts:32`, `traversal-engine.ts` (startTime / elapsed checks),
`retraversal-engine.ts` (startTime / elapsed check) — plus the one deliberate
fallback on the exported `evaluateGate`. If you see a `Date.now()` inside an
operator implementation or a horizon computation, that is a bug from an earlier
task: fix it before committing.

```bash
grep -rn "Date.now()" apps/pathway-service/src/services/resolution/temporal/ --include=*.ts
```
Expected: exactly one hit — inside `makeEvaluationTemporalContext`.

- [ ] **Step 9: Commit**

```bash
git add apps/pathway-service/src/resolvers/mutations/resolution.ts \
        apps/pathway-service/src/resolvers/mutations/multi-pathway-resolution.ts \
        apps/pathway-service/src/__tests__/resolution-retraversal-context.test.ts \
        apps/pathway-service/src/__tests__/multi-pathway-resolution.test.ts \
        apps/pathway-service/src/__tests__/temporal/retraversal-clock-reuse.test.ts
git commit -m "feat: stamp the session clock at startResolution and reuse it on retraversal

Co-Authored-By: Claude Opus 5 (1M context) <noreply@example.com>"
```

---

## Acceptance Criteria

From design §13, the subset this plan is responsible for:

- **Reproducibility.** A traversal with a pinned `evaluationAsOf` produces an
  identical outcome when the system clock is moved six months forward
  (`clock-pinning.test.ts`). A retraversal uses the clock persisted on its
  session, not a fresh one (`retraversal-clock-reuse.test.ts`).
- **No `evaluationAsOf` substitution.** `ENCOUNTER` without an `encounterStart`
  throws `MISSING_ENCOUNTER_ANCHOR`; it never silently narrows to a zero-width
  window (`evaluation-context.test.ts`).
- **`{days:N}` bounds.** A finite positive integer no greater than
  `MAX_CUSTOM_HORIZON_DAYS` (36_525); the maximum is accepted, maximum-plus-one
  is rejected with `INVALID_HORIZON`, and an overflowing value raises
  `TemporalContextError` rather than a bare `RangeError`
  (`evaluation-context.test.ts`).
- **One clock per run.** Every contributing session in a multi-pathway
  resolution carries a `temporal_context` equal to its parent's, and the
  zero-match parent is stamped too (`multi-pathway-resolution.test.ts`).
- **Single wall-clock read.** Exactly one `Date.now()` in the temporal module,
  inside `makeEvaluationTemporalContext` (Task 6 Step 8 grep).
- **No behavior change.** The full pathway-service suite passes with unchanged
  counts, and `temporalPolicyVersion` defaults to `legacy-v0`.

Deferred by design, and **not** acceptance criteria here: the pathway-wide
ENCOUNTER pre-traversal sweep (Plan 03), GraphQL exposure of the context
(Plan 08), reachability's request-scoped clock (Plan 04), and trust-mode
enforcement of a caller-supplied clock (Plan 05).

## Self-Review

**Spec coverage (§1, §11-partial, §12-boundary):**
- §1 `EvaluationTemporalContext` shape → Task 1. All six fields present, `timezone`
  as the literal `'UTC'`.
- §1 "Date.now() read once at session creation, never at evaluation time" →
  Tasks 2, 3, 6 (+ the Step 8 grep as the enforcement check).
- §1 "evaluateGate / evaluateCompound receive evaluationAsOf from the traversal
  boundary" → Tasks 3–4.
- §1 `encounterStart` single contract (reject, never substitute) → Task 1
  mechanism; the pathway-wide sweep is explicitly deferred to Plan 03 with the
  reason stated (needs the cascade).
- §2 Horizon tiers + `{days:N}` → Task 1, including §13's "agreed maximum"
  (`MAX_CUSTOM_HORIZON_DAYS = 36_525`, exported for Plan 06's validator).
- §11 `temporal_context JSONB` on both session tables → Task 5. GraphQL exposure
  deferred to Plan 08 (§11 bullets 2–4 are Plan 08's, per the suite overview).
- §12 reachability → explicitly out of scope, with the reason.
- §5 non-retraversable legacy sessions → Task 5 nullable column + Task 6
  `SESSION_NOT_RETRAVERSABLE`.

**Placeholder scan:** no TBDs. Every code step carries the actual code; the two
non-code steps (Task 3's typecheck-as-test, Task 5's migration application) carry
exact commands and expected output.

**Type consistency:** `EvaluationTemporalContext` is defined once (Task 1) and
imported by name in Tasks 4, 5, 6. `resolveHorizon` returns Plan 01's landed
`ResolvedHorizon` (`{lowerBound: string|null; upperBound: string}`) — verified
against `overlap.ts:5`. `TemporalContextError.code` values are the same four
strings in Tasks 1, 2, and 6. Constructor argument order
`(confidenceEngine, thresholds, temporalContext, llmGateEvaluator?, codeMap?)` is
identical across Tasks 4 and 6 and both engines. Field name is `temporalContext`
in TypeScript and `temporal_context` in SQL throughout.

**Optionality is deliberately asymmetric,** and the three places it appears now
agree: the DB column is nullable (Task 5 Step 1), the read-side
`ResolutionSession.temporalContext` / `MultiPathwayResolutionSession.temporalContext`
are optional (Task 5 Steps 4, 6) because pre-migration rows have no clock, but
both *creation* parameters are required (Task 5 Steps 5, 6) so a new call site
cannot forget one. Task 6 updates all four call sites — two `createSession`, two
`createMultiPathwaySession`.

**Every import the new code needs is named explicitly,** after review found
`requireSessionTemporalContext` using a `ResolutionSession` that `resolution.ts`
does not currently import: Task 6 Step 4 now spells out both that type-only
import and `EvaluationTemporalContext`.

**Mock completeness:** Task 6 Step 1's harness mocks all six `session-store`
exports and all four `resolution-context` exports that `resolution.ts` imports,
matching `resolution-retraversal-context.test.ts`. This matters more than it
looks: the negative case in that test passes even with incomplete mocks, because
the clock guard throws before the resolver reaches the unmocked helpers.

Checking that finding against the repo turned up the same bug already live:
`multi-pathway-resolution.test.ts:32` omits `makeLlmGateEvaluator`, and two of
its tests fail today with `makeLlmGateEvaluator is not a function` — two of the
15 baseline failures, with a one-line cause. Step 7 repairs it, because the new
multi-pathway assertions run through the same code path and would fail
identically. This is a scope addition (a pre-existing failure, not something
this plan breaks), taken because the alternative is adding tests to a file that
cannot go green.

**One gap accepted deliberately:** the exported `evaluateGate` keeps a
`Date.now()` fallback, so a *new* call site could still omit the clock. Task 3
documents it in code and Plan 04 removes it. The alternative — making it required
now — is a ~50-site positional edit in test files for a signature Plan 04
rewrites anyway.

**The suite overview's broken commands are fixed** (commit `e0a8e32`) — it had
listed a `typecheck` npm script that does not exist and a bare `npx tsc` that
resolves to a decoy package. Both this plan and the overview now carry the
working versions.

**Where the clock is created is the load-bearing choice in Task 6,** and review
round 1 found it in the wrong place. `resolveAndPersistAll` looks like the
multi-pathway boundary but is not: `startMultiPathwayResolution` creates the
parent session on two separate paths, one of which (zero matches) returns before
`resolveAndPersistAll` is ever called. Stamping inside the callee left the parent
either unstamped or holding a clock its children did not share. Step 5 now
creates it once at the true entry point and threads it down as a required
parameter, and Step 7 asserts parent/child identity rather than mere presence —
two clocks stamped microseconds apart would satisfy a weaker check and still
break replay.
