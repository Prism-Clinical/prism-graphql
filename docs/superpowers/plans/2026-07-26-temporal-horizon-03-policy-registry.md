# Temporal Horizon Plan 03 — Policy Registry + Cascade Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every gate condition a defined `(horizon, status)` policy by resolving `SYSTEM_DEFAULT → PATHWAY → NODE` against an immutable versioned registry, and load the pathway level from a new `temporal_defaults` column.

**Architecture:** Three pure modules plus one loader. `policy-registry.ts` holds frozen per-version constants (design §5) keyed by the version a session pins. `cascade.ts` resolves the three levels into a `PolicyTier`, converts that tier into Plan 01's `EffectivePolicy` using Plan 02's pinned clock, and sweeps a pathway's conditions for horizons that need an encounter anchor. `buildResolutionContext` reads the pathway level from `pathway_graph_index.temporal_defaults`. Nothing here evaluates a gate — Plan 04 consumes `resolveEffectivePolicy` and calls `selectFacts`.

**Tech Stack:** TypeScript 5, PostgreSQL 15, Jest + ts-jest.

## Global Constraints

- **Branch:** `feat/temporal-horizon-policy-registry`, worktree `/home/claude/workspace/features/feat-temporal-horizon-policy-registry/prism-graphql`. Branched from `origin/main` at `29a3844` (PR #49 — Plans 01+02 — is merged, so Plan 01 and Plan 02 code is in `main`).
- **All commands run from the worktree root** (`.../feat-temporal-horizon-policy-registry/prism-graphql`). Never chain `cd` with `&&`; if you must change directory, make it its own Bash call.
- **Typecheck (verified working 2026-08-03):**
  ```
  ./node_modules/.bin/tsc -p apps/pathway-service/tsconfig.json --noEmit
  ```
  The suite overview (`...-00-overview.md`) documents `cd apps/pathway-service` then `./node_modules/.bin/tsc` — **that is wrong**: this monorepo hoists binaries, there is no `apps/pathway-service/node_modules`. There is also no `typecheck` npm script, and bare `npx tsc` resolves to a decoy package that prints "This is not the tsc command you are looking for". Task 6 corrects the overview.
- **Tests (verified working 2026-08-03):**
  ```
  npm test --prefix apps/pathway-service -- --runInBand <path>
  ```
  Jest's `testRegex` is `/__tests__/.*.test.ts`, so a test file placed anywhere else (e.g. beside its source) is silently **not run**.
- **`tsconfig` is NOT full strict** — only `noImplicitAny` + `noImplicitReturns`, and it **excludes `src/__tests__`**. A required TypeScript parameter therefore enforces nothing against a test caller and nothing at runtime. Where an invariant matters, it needs a runtime throw *and* a test that fails without it (this is the root cause behind four separate review findings across Plans 01–02).
- **Suite baseline was 13 pre-existing failures** in `data-completeness-scorer`, `patient-match-scorer` and `ddi-multi-pathway`. The full suite has **never** been green. Never expect a clean pass; assert the count did not grow.
  - **Updated after execution (2026-08-03), both numbers measured directly:**
    - `origin/main` (unmodified checkout, `29a3844`): **13 failed / 727 passed, 3 suites** — `data-completeness-scorer`, `patient-match-scorer`, `ddi-multi-pathway`.
    - This branch: **9 failed / 805 passed, 2 suites** — the two scorers only.
    - Task 6's mock repair fixed `ddi-multi-pathway` outright: its `jest.mock` factory omitted `makeLlmGateEvaluator`, so the export was `undefined` at call time. That is the *same* root cause Plan 02 fixed in the sibling `multi-pathway-resolution.test.ts` — the second file was simply never checked.
    - **Measure the baseline on `main`, not on a copy of this branch.** A review of this work reported "9 across 2, both before and after"; that is what `main` looks like *after* the ddi fix is applied, not before it.
- **No live behavior change.** `legacy-v0` is the default version and defines no ENCOUNTER horizon, and no deployed pathway condition carries a `horizon` key (design §"Current Deployed State"). Plans 1–8 must not change live routing until the explicit `v1` flip.
- **Commit prefixes:** `feat:` / `fix:` / `test:` / `refactor:` / `docs:`. No `@anthropic.com`/`@claude.com` domains, no "Generated with" lines. End every commit message with:
  `Co-Authored-By: Claude Opus 5 (1M context) <noreply@example.com>`

## Decisions this plan locks

1. **`vitals` joins the registry.** Design §5's table omits it while `GateField` includes it, which would leave `resolveEffectivePolicy('vitals', …)` undefined. `legacy-v0` → `LIFETIME` (reproduces today, where every operator ignores time); `v1` → `ENCOUNTER` (design §10's fixed "Encounter" horizon for vitals). Decided with the user 2026-08-03.
2. **ENCOUNTER anchors are swept at session creation, not discovered mid-traversal.** `resolveHorizon` deliberately never substitutes `evaluationAsOf` for a missing `encounterStart` — it throws. Without a preflight, a pathway with one ENCOUNTER condition fails partway through a traversal that has already run LLM gates and written audit rows. Task 4 builds the sweep (this is what `requiresEncounterAnchor` was exported for); Task 6 wires it at the two session-creation sites.
3. **Bad stored data fails closed.** An unparseable `temporal_defaults` row, an unknown gate field, an out-of-range horizon, or a `status` on `labs`/`vitals` throws rather than being ignored. Plan 06's validator guards the write path; anything that reaches the read path anyway is corruption, and silently dropping an author's intent is worse than refusing to resolve.
4. **`status` applicability is derived, never listed twice.** `fieldHasClinicalState(field)` is computed from Plan 01's `FIELD_TO_KIND`, so labs/vitals are excluded by construction. A second hardcoded list would drift.
5. **The cascade does not read the clock.** `resolveEffectivePolicy` returns an unresolved `PolicyTier`; `toEffectivePolicy(tier, ctx)` applies Plan 02's `resolveHorizon`. Splitting them keeps the cascade unit-testable without a clock and keeps the single-wall-clock-read invariant intact.

## Deliberately out of scope

These are design §5/§7 requirements that belong to a neighboring plan — listed so a
reviewer does not read their absence as a gap:

- **`horizon`/`status` as typed fields on `CodedCondition`** (`resolution/types.ts`) and
  the validated `GateCondition → FactSelectionCondition` adapter — **Plan 04**. This plan
  reads those keys defensively off untyped AGE node properties, and its own
  `ConditionTemporalOverride` is the temporal-owned shape, exactly as Plan 01 owns
  `FactSelectionCondition`.
- **`PathwayMetadata.default_horizons`/`default_statuses`, the import round-trip, and
  GraphQL exposure of `Pathway.temporalDefaults`** (§7.1, §7.3) — **Plan 06**. This plan
  creates the column and the read path; nothing yet writes it, so every pathway loads
  `{}` until Plan 06 lands.
- **Calling `resolveEffectivePolicy` during gate evaluation** — **Plan 04**. Nothing in
  this plan is on the evaluation path yet apart from the session-creation preflight.

## Known gap — attribute conditions bypass temporal policy entirely

Raised in review of this plan, verified, and **deliberately not fixed here.**

`VALID_ATTRIBUTE_NAMESPACES` is `['lab', 'vitals', 'allergy', 'patient']`
(`attribute-registry.ts:27`). Only `patient.*` is genuinely encounter-derived; the
other three read the same clinical arrays a coded condition does — `lab.*` does
`ctx.labResults.find(...)`, `vitals.*` walks `ctx.vitalSigns`, `allergy.*` scans
`ctx.allergies`. None of them go through `selectFacts`, and Plan 04 rewrites only
`evaluateGate`'s coded branches, so **none of them will honor a horizon or a status**.

The consequence, once `v1` is flipped on: a coded `labs` gate respects QUARTER while
an equivalent `lab.a1c > 9` attribute gate silently reads a result of any age. The
feature's guarantee holds for one authoring style and not the other.

The review proposed mapping attribute namespaces to `GateField` inside the anchor
sweep. That is the wrong lever — it would reject sessions over gates that never
resolve a horizon (a false rejection), while leaving the actual hole, that those gates
ignore horizons at evaluation time, wide open. Closing it properly means routing
`lab.*`/`vitals.*`/`allergy.*` attribute resolution through the kernel, which
contradicts design §10 ("attribute conditions get no horizon control") and belongs to
a design revision plus Plan 04 — **not to this plan.**

A second instance of the same class, found while restricting the sweep to `Gate` nodes:
`satisfaction_check` on prerequisite nodes carries its own `lookback_days`
(`prerequisites.ts:131`), a temporal window that no cascade level, policy version or
horizon governs. It is not a gate condition and is out of scope here, but it is the
same feature being answered two different ways in two places.

**Decision (2026-08-03, design owner): parked until Plan 04.** No §10 revision is drafted
now. Plan 04 owns rewiring `evaluateGate` onto the kernel and is where the
attribute-condition path either joins it or is explicitly declared out of the feature's
guarantee. This remains a **release blocker for the `v1` flip** — `v1` must not be
activated while a coded `labs` gate honors QUARTER and an equivalent `lab.a1c > 9`
attribute gate does not.

---

### Task 1: Policy registry

**Files:**
- Create: `apps/pathway-service/src/services/resolution/temporal/policy-registry.ts`
- Modify: `apps/pathway-service/src/services/resolution/temporal/evaluation-context.ts` (add one `TemporalContextErrorCode` member)
- Test: `apps/pathway-service/src/__tests__/temporal/policy-registry.test.ts`

**Interfaces:**
- Consumes: `Horizon`, `TemporalContextError`, `TemporalContextErrorCode` from `./evaluation-context` (Plan 02); `GateField`, `fieldToKind` from `./contract` (Plan 01).
- Produces: `TemporalStatus`, `FieldPolicy`, `TemporalPolicySet`, `TEMPORAL_POLICIES`, `KNOWN_TEMPORAL_POLICY_VERSIONS`, `getTemporalPolicy(version)`, `systemDefaultFor(field, version)`, `fieldHasClinicalState(field)`.

- [ ] **Step 1: Write the failing test**

Create `apps/pathway-service/src/__tests__/temporal/policy-registry.test.ts`:

```ts
import {
  TEMPORAL_POLICIES,
  KNOWN_TEMPORAL_POLICY_VERSIONS,
  getTemporalPolicy,
  assertKnownPolicyVersion,
  systemDefaultFor,
  fieldHasClinicalState,
} from '../../services/resolution/temporal/policy-registry';
import { TemporalContextError } from '../../services/resolution/temporal/evaluation-context';
import { GateField, FIELD_TO_KIND } from '../../services/resolution/temporal/contract';

const ALL_FIELDS = Object.keys(FIELD_TO_KIND) as GateField[];

describe('TEMPORAL_POLICIES', () => {
  it('legacy-v0 reproduces today: every field is LIFETIME', () => {
    const p = getTemporalPolicy('legacy-v0');
    for (const field of ALL_FIELDS) {
      expect(p[field].horizon).toBe('LIFETIME');
    }
  });

  it('v1 narrows labs to QUARTER and pins vitals to ENCOUNTER', () => {
    const p = getTemporalPolicy('v1');
    expect(p.labs.horizon).toBe('QUARTER');
    expect(p.vitals.horizon).toBe('ENCOUNTER');
  });

  it('v1 leaves conditions, medications and allergies at LIFETIME/active', () => {
    const p = getTemporalPolicy('v1');
    for (const field of ['conditions', 'medications', 'allergies'] as GateField[]) {
      expect(p[field]).toEqual({ horizon: 'LIFETIME', status: 'active' });
    }
  });

  it('covers every GateField in every version — a missing field is an undefined policy', () => {
    for (const version of KNOWN_TEMPORAL_POLICY_VERSIONS) {
      for (const field of ALL_FIELDS) {
        expect(TEMPORAL_POLICIES[version][field]).toBeDefined();
      }
    }
  });

  it('gives no status to observation fields in any version', () => {
    for (const version of KNOWN_TEMPORAL_POLICY_VERSIONS) {
      expect(TEMPORAL_POLICIES[version].labs.status).toBeUndefined();
      expect(TEMPORAL_POLICIES[version].vitals.status).toBeUndefined();
    }
  });

  it('is frozen at every level — a version must never be mutated in place', () => {
    expect(() => {
      (TEMPORAL_POLICIES as Record<string, unknown>).v2 = {};
    }).toThrow(TypeError);
    expect(() => {
      (TEMPORAL_POLICIES.v1 as Record<string, unknown>).labs = { horizon: 'DAY' };
    }).toThrow(TypeError);
    expect(() => {
      (TEMPORAL_POLICIES.v1.labs as { horizon: string }).horizon = 'DAY';
    }).toThrow(TypeError);
  });
});

describe('getTemporalPolicy', () => {
  it('rejects an unknown version instead of falling back to latest', () => {
    expect(() => getTemporalPolicy('v99')).toThrow(TemporalContextError);
    try {
      getTemporalPolicy('v99');
    } catch (e) {
      expect((e as TemporalContextError).code).toBe('UNKNOWN_POLICY_VERSION');
      expect((e as Error).message).toContain('legacy-v0');
    }
  });

  it('rejects a prototype key that is not a real version', () => {
    expect(() => getTemporalPolicy('constructor')).toThrow(TemporalContextError);
    expect(() => getTemporalPolicy('toString')).toThrow(TemporalContextError);
  });
});

describe('assertKnownPolicyVersion', () => {
  it('passes for a known version and throws for an unknown one', () => {
    expect(() => assertKnownPolicyVersion('legacy-v0')).not.toThrow();
    expect(() => assertKnownPolicyVersion('v1')).not.toThrow();
    expect(() => assertKnownPolicyVersion('v99')).toThrow(TemporalContextError);
  });
});

describe('systemDefaultFor', () => {
  it('returns the per-field policy for the given version', () => {
    expect(systemDefaultFor('labs', 'legacy-v0')).toEqual({ horizon: 'LIFETIME' });
    expect(systemDefaultFor('labs', 'v1')).toEqual({ horizon: 'QUARTER' });
  });

  it('rejects an unknown field', () => {
    expect(() => systemDefaultFor('labz' as GateField, 'v1')).toThrow(TemporalContextError);
  });
});

describe('fieldHasClinicalState', () => {
  it('is derived from the fact kind, not a second hardcoded list', () => {
    expect(fieldHasClinicalState('conditions')).toBe(true);
    expect(fieldHasClinicalState('medications')).toBe(true);
    expect(fieldHasClinicalState('allergies')).toBe(true);
    expect(fieldHasClinicalState('labs')).toBe(false);
    expect(fieldHasClinicalState('vitals')).toBe(false);
  });

  it('agrees with the registry: exactly the stateful fields carry a status', () => {
    for (const version of KNOWN_TEMPORAL_POLICY_VERSIONS) {
      for (const field of ALL_FIELDS) {
        const hasStatus = TEMPORAL_POLICIES[version][field].status !== undefined;
        expect(hasStatus).toBe(fieldHasClinicalState(field));
      }
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test --prefix apps/pathway-service -- --runInBand src/__tests__/temporal/policy-registry.test.ts`
Expected: FAIL — `Cannot find module '../../services/resolution/temporal/policy-registry'`.

- [ ] **Step 3: Add the error code**

In `apps/pathway-service/src/services/resolution/temporal/evaluation-context.ts`, extend the existing union (leave every other member as-is):

```ts
export type TemporalContextErrorCode =
  | 'MISSING_ENCOUNTER_ANCHOR'
  | 'INVALID_HORIZON'
  | 'INVALID_CLOCK'
  | 'SESSION_NOT_RETRAVERSABLE'
  /** A session pinned a temporalPolicyVersion the registry does not define (§5). */
  | 'UNKNOWN_POLICY_VERSION'
  /** A pathway-level or condition-level policy value is structurally invalid. */
  | 'INVALID_TEMPORAL_DEFAULTS';
```

(`INVALID_TEMPORAL_DEFAULTS` is unused until Task 2 — add both members here so `evaluation-context.ts` is touched exactly once by this plan.)

- [ ] **Step 4: Write the registry**

Create `apps/pathway-service/src/services/resolution/temporal/policy-registry.ts`:

```ts
import { Horizon, TemporalContextError } from './evaluation-context';
import { GateField, FIELD_TO_KIND, fieldToKind } from './contract';

/** Author-selectable clinical state filter (design §3). */
export type TemporalStatus = 'active' | 'inactive' | 'any';

export interface FieldPolicy {
  horizon: Horizon;
  /**
   * Absent for observation fields — labs and vitals carry no clinical state
   * (`stateMatch: NOT_APPLICABLE`), so a status here would be meaningless.
   */
  status?: TemporalStatus;
}

export type TemporalPolicySet = Readonly<Record<GateField, FieldPolicy>>;

/**
 * Does this gate field's fact kind carry a clinical state?
 *
 * Derived from Plan 01's FIELD_TO_KIND rather than restated as its own list:
 * the fact model already decides which kinds are stateful (StatefulFact vs
 * ObservationFact), and a second copy of that decision would drift the first
 * time a field is added.
 */
export function fieldHasClinicalState(field: GateField): boolean {
  const kind = fieldToKind(field); // throws on an unknown field
  return kind !== 'lab' && kind !== 'vital';
}

/**
 * Immutable, versioned platform defaults (design §5).
 *
 * Rules, in force for every future edit:
 *   - NEVER change what an existing version means — add a new one.
 *   - An unknown version is a hard error, never "use the latest".
 *   - Every rolling-deployment pod must understand every still-active
 *     session's version, so a version is only removed once no session pins it.
 *
 * `legacy-v0` reproduces today's *effective* semantics: every operator
 * currently ignores time, so every field is LIFETIME. It is NOT replayable
 * through the new kernel (§5) — it is the default until the v1 flip, not a
 * time machine.
 */
export const TEMPORAL_POLICIES: Readonly<Record<string, TemporalPolicySet>> = Object.freeze({
  'legacy-v0': Object.freeze({
    conditions: Object.freeze({ horizon: 'LIFETIME', status: 'active' }),
    medications: Object.freeze({ horizon: 'LIFETIME', status: 'active' }),
    allergies: Object.freeze({ horizon: 'LIFETIME', status: 'active' }),
    labs: Object.freeze({ horizon: 'LIFETIME' }),
    vitals: Object.freeze({ horizon: 'LIFETIME' }),
  }) as TemporalPolicySet,
  v1: Object.freeze({
    conditions: Object.freeze({ horizon: 'LIFETIME', status: 'active' }),
    medications: Object.freeze({ horizon: 'LIFETIME', status: 'active' }),
    allergies: Object.freeze({ horizon: 'LIFETIME', status: 'active' }),
    // A lifetime of lab results is not "the patient's A1c" — 90 days is.
    // This is a deliberate, versioned behavior change (§Compatibility).
    labs: Object.freeze({ horizon: 'QUARTER' }),
    // Vitals are encounter-scoped (§10). This hard-requires an encounterStart
    // on any session whose pathway reads vitals — see collectEncounterAnchor-
    // Requirements, which rejects such a session up front rather than
    // throwing partway through a traversal.
    vitals: Object.freeze({ horizon: 'ENCOUNTER' }),
  }) as TemporalPolicySet,
});

export const KNOWN_TEMPORAL_POLICY_VERSIONS: readonly string[] = Object.freeze(
  Object.keys(TEMPORAL_POLICIES),
);

export function getTemporalPolicy(version: string): TemporalPolicySet {
  // Own-property check: a plain `TEMPORAL_POLICIES[version]` lookup would
  // resolve 'constructor'/'toString' off Object.prototype and hand back a
  // function as if it were a policy set.
  if (!Object.prototype.hasOwnProperty.call(TEMPORAL_POLICIES, version)) {
    throw new TemporalContextError(
      `unknown temporalPolicyVersion "${version}" ` +
        `(known: ${KNOWN_TEMPORAL_POLICY_VERSIONS.join(', ')})`,
      'UNKNOWN_POLICY_VERSION',
    );
  }
  return TEMPORAL_POLICIES[version];
}

/**
 * Assert a version exists, for call sites that only want the check.
 *
 * Exists so the resolver boundary reads as an assertion rather than a
 * discarded lookup — the two mutations call this immediately after creating
 * the clock, covering paths where no condition is ever swept (zero matched
 * pathways, every graph empty).
 */
export function assertKnownPolicyVersion(version: string): void {
  getTemporalPolicy(version);
}

export function systemDefaultFor(field: GateField, version: string): FieldPolicy {
  const set = getTemporalPolicy(version);
  if (!Object.prototype.hasOwnProperty.call(FIELD_TO_KIND, field)) {
    throw new TemporalContextError(
      `unknown gate field "${field}"`,
      'UNKNOWN_POLICY_VERSION',
    );
  }
  return set[field];
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm test --prefix apps/pathway-service -- --runInBand src/__tests__/temporal/policy-registry.test.ts`
Expected: PASS, 13 tests.

- [ ] **Step 6: Typecheck**

Run: `./node_modules/.bin/tsc -p apps/pathway-service/tsconfig.json --noEmit`
Expected: exit 0, no output.

- [ ] **Step 7: Commit**

```bash
git add apps/pathway-service/src/services/resolution/temporal/policy-registry.ts apps/pathway-service/src/services/resolution/temporal/evaluation-context.ts apps/pathway-service/src/__tests__/temporal/policy-registry.test.ts
git commit -m "feat: immutable versioned registry of platform temporal defaults

legacy-v0 is every field at LIFETIME — today's effective semantics, since
no operator currently reads time. v1 narrows labs to QUARTER and pins
vitals to ENCOUNTER (design §5, §10); vitals were missing from the design
table entirely while GateField includes them, which would have left
resolveEffectivePolicy('vitals') undefined.

An unknown version throws rather than falling back to latest, and the
lookup is an own-property check so 'constructor' cannot resolve a
function off the prototype as if it were a policy set.

Status applicability is derived from Plan 01's FIELD_TO_KIND rather than
restated, so labs/vitals are excluded by construction.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@example.com>"
```

---

### Task 2: Parse the pathway-level defaults

**Files:**
- Create: `apps/pathway-service/src/services/resolution/temporal/cascade.ts`
- Test: `apps/pathway-service/src/__tests__/temporal/cascade-parse.test.ts`

**Interfaces:**
- Consumes: Task 1's `TemporalStatus`, `fieldHasClinicalState`; `Horizon`, `isNamedHorizon`, `isCustomHorizon`, `MAX_CUSTOM_HORIZON_DAYS`, `TemporalContextError` from `./evaluation-context`; `GateField`, `FIELD_TO_KIND` from `./contract`.
- Produces: `PathwayTemporalDefaults`, `parsePathwayTemporalDefaults(raw)`, `parseHorizonValue(raw, where)`.

The stored JSONB uses the **pathway JSON header key names** (`default_horizons` / `default_statuses`, design §7.1) so the column round-trips the author's document verbatim. The parser converts that wire shape into the internal one.

- [ ] **Step 1: Write the failing test**

Create `apps/pathway-service/src/__tests__/temporal/cascade-parse.test.ts`:

```ts
import {
  parsePathwayTemporalDefaults,
  parseHorizonValue,
} from '../../services/resolution/temporal/cascade';
import { TemporalContextError } from '../../services/resolution/temporal/evaluation-context';

describe('parsePathwayTemporalDefaults', () => {
  it('treats an absent column as no pathway-level opinion', () => {
    expect(parsePathwayTemporalDefaults(null)).toEqual({});
    expect(parsePathwayTemporalDefaults(undefined)).toEqual({});
    expect(parsePathwayTemporalDefaults({})).toEqual({});
  });

  it('reads the pathway JSON header key names', () => {
    expect(
      parsePathwayTemporalDefaults({
        default_horizons: { labs: 'YEAR', conditions: { days: 45 } },
        default_statuses: { conditions: 'any' },
      }),
    ).toEqual({
      horizons: { labs: 'YEAR', conditions: { days: 45 } },
      statuses: { conditions: 'any' },
    });
  });

  it('accepts a JSON string, as node-postgres may hand back either', () => {
    expect(parsePathwayTemporalDefaults('{"default_horizons":{"labs":"WEEK"}}')).toEqual({
      horizons: { labs: 'WEEK' },
    });
  });

  it('rejects an unknown gate field rather than silently dropping it', () => {
    expect(() =>
      parsePathwayTemporalDefaults({ default_horizons: { labz: 'YEAR' } }),
    ).toThrow(TemporalContextError);
  });

  it('rejects a status on a field that has no clinical state', () => {
    expect(() =>
      parsePathwayTemporalDefaults({ default_statuses: { labs: 'active' } }),
    ).toThrow(/labs/);
    expect(() =>
      parsePathwayTemporalDefaults({ default_statuses: { vitals: 'active' } }),
    ).toThrow(/vitals/);
  });

  it('rejects a bad status value', () => {
    expect(() =>
      parsePathwayTemporalDefaults({ default_statuses: { conditions: 'ACTIVE' } }),
    ).toThrow(TemporalContextError);
  });

  it('rejects an unknown root key — a typo must not silently erase the override', () => {
    // The singular typo is the realistic one, and it is the dangerous one:
    // ignoring it resolves every gate against system defaults while the
    // author believes their pathway-level horizon is in force.
    expect(() =>
      parsePathwayTemporalDefaults({ default_horizon: { labs: 'YEAR' } }),
    ).toThrow(/default_horizon\b/);
    expect(() =>
      parsePathwayTemporalDefaults({ default_horizons: { labs: 'YEAR' }, extra: 1 }),
    ).toThrow(/extra/);
  });

  it('rejects a non-object column value', () => {
    expect(() => parsePathwayTemporalDefaults(42)).toThrow(TemporalContextError);
    expect(() => parsePathwayTemporalDefaults([])).toThrow(TemporalContextError);
    expect(() => parsePathwayTemporalDefaults('not json')).toThrow(TemporalContextError);
  });

  it('names the offending key in the message — this fires on a live pathway', () => {
    try {
      parsePathwayTemporalDefaults({ default_horizons: { labs: 'FORTNIGHT' } });
      throw new Error('expected a throw');
    } catch (e) {
      expect((e as Error).message).toContain('default_horizons.labs');
    }
  });
});

describe('parseHorizonValue', () => {
  it('accepts every named tier', () => {
    for (const h of ['LIFETIME', 'YEAR', 'QUARTER', 'MONTH', 'WEEK', 'DAY', 'ENCOUNTER']) {
      expect(parseHorizonValue(h, 'x')).toBe(h);
    }
  });

  it('accepts a custom day count and normalizes away extra keys', () => {
    expect(parseHorizonValue({ days: 45 }, 'x')).toEqual({ days: 45 });
    expect(parseHorizonValue({ days: 45, note: 'hi' }, 'x')).toEqual({ days: 45 });
  });

  it('rejects a day count that resolveHorizon would reject at evaluation time', () => {
    expect(() => parseHorizonValue({ days: 0 }, 'x')).toThrow(TemporalContextError);
    expect(() => parseHorizonValue({ days: -1 }, 'x')).toThrow(TemporalContextError);
    expect(() => parseHorizonValue({ days: 1.5 }, 'x')).toThrow(TemporalContextError);
    expect(() => parseHorizonValue({ days: 36_526 }, 'x')).toThrow(TemporalContextError);
  });

  it('rejects garbage', () => {
    expect(() => parseHorizonValue('lifetime', 'x')).toThrow(TemporalContextError);
    expect(() => parseHorizonValue(null, 'x')).toThrow(TemporalContextError);
    expect(() => parseHorizonValue(90, 'x')).toThrow(TemporalContextError);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test --prefix apps/pathway-service -- --runInBand src/__tests__/temporal/cascade-parse.test.ts`
Expected: FAIL — `Cannot find module '../../services/resolution/temporal/cascade'`.

- [ ] **Step 3: Write the parser**

Create `apps/pathway-service/src/services/resolution/temporal/cascade.ts`:

```ts
import {
  Horizon,
  isNamedHorizon,
  isCustomHorizon,
  MAX_CUSTOM_HORIZON_DAYS,
  TemporalContextError,
} from './evaluation-context';
import { GateField, FIELD_TO_KIND } from './contract';
import { TemporalStatus, fieldHasClinicalState } from './policy-registry';

/** The PATHWAY level of the cascade, as loaded from `temporal_defaults`. */
export interface PathwayTemporalDefaults {
  horizons?: Partial<Record<GateField, Horizon>>;
  statuses?: Partial<Record<GateField, TemporalStatus>>;
}

const STATUSES: readonly string[] = ['active', 'inactive', 'any'];

function isGateField(k: string): k is GateField {
  return Object.prototype.hasOwnProperty.call(FIELD_TO_KIND, k);
}

/**
 * Validate one horizon value from stored or authored JSON.
 *
 * Enforces exactly what `resolveHorizon` enforces at evaluation time — same
 * named tiers, same integer day bounds, same maximum — so an invalid horizon
 * is caught once at load with a message naming the key, instead of throwing
 * from `overlap()` on every fact halfway through a traversal.
 *
 * `where` is the dotted key path, used only for the error message.
 */
export function parseHorizonValue(raw: unknown, where: string): Horizon {
  if (isNamedHorizon(raw)) return raw;

  if (isCustomHorizon(raw)) {
    const { days } = raw;
    if (!Number.isInteger(days) || days <= 0 || days > MAX_CUSTOM_HORIZON_DAYS) {
      throw new TemporalContextError(
        `${where}: horizon day count must be an integer in 1..${MAX_CUSTOM_HORIZON_DAYS} (got: ${days})`,
        'INVALID_HORIZON',
      );
    }
    // Normalize: keep only `days`, so an authoring decoration cannot ride
    // along into the evaluation path or a persisted policy.
    return { days };
  }

  throw new TemporalContextError(
    `${where}: not a horizon (got: ${JSON.stringify(raw)})`,
    'INVALID_HORIZON',
  );
}

function parseStatusValue(raw: unknown, where: string): TemporalStatus {
  if (typeof raw === 'string' && STATUSES.includes(raw)) return raw as TemporalStatus;
  throw new TemporalContextError(
    `${where}: status must be one of ${STATUSES.join(' | ')} (got: ${JSON.stringify(raw)})`,
    'INVALID_TEMPORAL_DEFAULTS',
  );
}

function asRecord(raw: unknown, where: string): Record<string, unknown> {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new TemporalContextError(
      `${where}: expected an object (got: ${JSON.stringify(raw)})`,
      'INVALID_TEMPORAL_DEFAULTS',
    );
  }
  return raw as Record<string, unknown>;
}

/**
 * Turn the stored `pathway_graph_index.temporal_defaults` value into the
 * PATHWAY cascade level.
 *
 * Fails closed. Plan 06's import validator guards the write path, so anything
 * malformed reaching here is corruption — and silently discarding an author's
 * horizon would resolve gates against a window they never chose, invisibly.
 */
export function parsePathwayTemporalDefaults(raw: unknown): PathwayTemporalDefaults {
  if (raw === null || raw === undefined) return {};

  // node-postgres returns JSONB already parsed, but a text column, a driver
  // change, or a hand-written fixture can hand back the string form.
  let value: unknown = raw;
  if (typeof raw === 'string') {
    try {
      value = JSON.parse(raw);
    } catch {
      throw new TemporalContextError(
        `temporal_defaults: not valid JSON (got: ${raw})`,
        'INVALID_TEMPORAL_DEFAULTS',
      );
    }
  }

  const root = asRecord(value, 'temporal_defaults');

  // Allowlist the root keys. Without this a typo — `default_horizon`,
  // singular — parses to `{}` and the author's override is silently replaced
  // by the system defaults, which is exactly the failure the fail-closed
  // contract exists to prevent. Ignoring an unknown key is indistinguishable
  // from ignoring the author.
  for (const key of Object.keys(root)) {
    if (key !== 'default_horizons' && key !== 'default_statuses') {
      throw new TemporalContextError(
        `temporal_defaults.${key}: unknown key ` +
          `(expected default_horizons or default_statuses)`,
        'INVALID_TEMPORAL_DEFAULTS',
      );
    }
  }

  const out: PathwayTemporalDefaults = {};

  if (root.default_horizons !== undefined && root.default_horizons !== null) {
    const src = asRecord(root.default_horizons, 'temporal_defaults.default_horizons');
    const horizons: Partial<Record<GateField, Horizon>> = {};
    for (const [key, val] of Object.entries(src)) {
      if (!isGateField(key)) {
        throw new TemporalContextError(
          `default_horizons.${key}: unknown gate field`,
          'INVALID_TEMPORAL_DEFAULTS',
        );
      }
      horizons[key] = parseHorizonValue(val, `default_horizons.${key}`);
    }
    if (Object.keys(horizons).length > 0) out.horizons = horizons;
  }

  if (root.default_statuses !== undefined && root.default_statuses !== null) {
    const src = asRecord(root.default_statuses, 'temporal_defaults.default_statuses');
    const statuses: Partial<Record<GateField, TemporalStatus>> = {};
    for (const [key, val] of Object.entries(src)) {
      if (!isGateField(key)) {
        throw new TemporalContextError(
          `default_statuses.${key}: unknown gate field`,
          'INVALID_TEMPORAL_DEFAULTS',
        );
      }
      if (!fieldHasClinicalState(key)) {
        throw new TemporalContextError(
          `default_statuses.${key}: ${key} have no clinical state, so a status is meaningless`,
          'INVALID_TEMPORAL_DEFAULTS',
        );
      }
      statuses[key] = parseStatusValue(val, `default_statuses.${key}`);
    }
    if (Object.keys(statuses).length > 0) out.statuses = statuses;
  }

  return out;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test --prefix apps/pathway-service -- --runInBand src/__tests__/temporal/cascade-parse.test.ts`
Expected: PASS, 13 tests.

- [ ] **Step 5: Typecheck**

Run: `./node_modules/.bin/tsc -p apps/pathway-service/tsconfig.json --noEmit`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add apps/pathway-service/src/services/resolution/temporal/cascade.ts apps/pathway-service/src/__tests__/temporal/cascade-parse.test.ts
git commit -m "feat: parse pathway-level temporal defaults, failing closed

The stored JSONB keeps the pathway JSON header names (default_horizons /
default_statuses) so the column round-trips the author's document; the
parser converts that wire shape into the cascade's PATHWAY level.

parseHorizonValue enforces exactly what resolveHorizon enforces at
evaluation time, so a bad value is caught once at load with the offending
key named, rather than throwing from overlap() on every fact midway
through a traversal.

Unknown fields, statuses on labs/vitals, and non-object values throw
instead of being dropped: Plan 06 guards the write path, so anything
malformed that reaches the read path is corruption, and silently
discarding an author's horizon resolves gates against a window they
never chose.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@example.com>"
```

---

### Task 3: The three-level cascade

**Files:**
- Modify: `apps/pathway-service/src/services/resolution/temporal/cascade.ts` (append)
- Test: `apps/pathway-service/src/__tests__/temporal/cascade-resolve.test.ts`

**Interfaces:**
- Consumes: Task 1's `systemDefaultFor`, `fieldHasClinicalState`, `FieldPolicy`, `TemporalStatus`; Task 2's `PathwayTemporalDefaults`; `EvaluationTemporalContext`, `resolveHorizon` from `./evaluation-context`; `EffectivePolicy` from `./select-facts`.
- Produces: `ConditionTemporalOverride`, `PolicyTier`, `PolicyLevel`, `resolveEffectivePolicy(field, version, pathwayDefaults, condition?)`, `toEffectivePolicy(tier, ctx)`. **Plan 04 consumes both** to build the `EffectivePolicy` it hands `selectFacts`.

- [ ] **Step 1: Write the failing test**

Create `apps/pathway-service/src/__tests__/temporal/cascade-resolve.test.ts`:

```ts
import {
  resolveEffectivePolicy,
  toEffectivePolicy,
  PathwayTemporalDefaults,
} from '../../services/resolution/temporal/cascade';
import {
  EvaluationTemporalContext,
  TemporalContextError,
} from '../../services/resolution/temporal/evaluation-context';
import { GateField } from '../../services/resolution/temporal/contract';

const AS_OF = '2026-08-03T12:00:00.000Z';

function ctx(over: Partial<EvaluationTemporalContext> = {}): EvaluationTemporalContext {
  return { evaluationAsOf: AS_OF, timezone: 'UTC', temporalPolicyVersion: 'v1', ...over };
}

describe('resolveEffectivePolicy — precedence', () => {
  const defaults: PathwayTemporalDefaults = {
    horizons: { labs: 'YEAR' },
    statuses: { conditions: 'any' },
  };

  it('falls back to the system default when nothing overrides', () => {
    expect(resolveEffectivePolicy('conditions', 'v1', {})).toEqual({
      horizon: 'LIFETIME',
      status: 'active',
      horizonLevel: 'SYSTEM_DEFAULT',
      statusLevel: 'SYSTEM_DEFAULT',
    });
  });

  it('pathway beats system', () => {
    expect(resolveEffectivePolicy('labs', 'v1', defaults).horizon).toBe('YEAR');
    expect(resolveEffectivePolicy('labs', 'v1', defaults).horizonLevel).toBe('PATHWAY');
  });

  it('node beats pathway', () => {
    const r = resolveEffectivePolicy('labs', 'v1', defaults, { horizon: 'WEEK' });
    expect(r.horizon).toBe('WEEK');
    expect(r.horizonLevel).toBe('NODE');
  });

  it('resolves the two axes independently — a status override keeps the inherited horizon', () => {
    const r = resolveEffectivePolicy('conditions', 'v1', defaults, { status: 'inactive' });
    expect(r).toEqual({
      horizon: 'LIFETIME',
      status: 'inactive',
      horizonLevel: 'SYSTEM_DEFAULT',
      statusLevel: 'NODE',
    });
  });

  it('a horizon override does not disturb an inherited pathway status', () => {
    const r = resolveEffectivePolicy('conditions', 'v1', defaults, { horizon: 'MONTH' });
    expect(r.status).toBe('any');
    expect(r.statusLevel).toBe('PATHWAY');
  });

  it('version selects the system default it falls back to', () => {
    expect(resolveEffectivePolicy('labs', 'legacy-v0', {}).horizon).toBe('LIFETIME');
    expect(resolveEffectivePolicy('labs', 'v1', {}).horizon).toBe('QUARTER');
    expect(resolveEffectivePolicy('vitals', 'legacy-v0', {}).horizon).toBe('LIFETIME');
    expect(resolveEffectivePolicy('vitals', 'v1', {}).horizon).toBe('ENCOUNTER');
  });

  it('propagates an unknown version instead of defaulting', () => {
    expect(() => resolveEffectivePolicy('labs', 'v99', {})).toThrow(TemporalContextError);
  });
});

describe('resolveEffectivePolicy — status applicability', () => {
  it('never returns a status for an observation field', () => {
    for (const field of ['labs', 'vitals'] as GateField[]) {
      const r = resolveEffectivePolicy(field, 'v1', {});
      expect(r.status).toBeUndefined();
      expect(r.statusLevel).toBeUndefined();
    }
  });

  it('rejects a node-level status on an observation field', () => {
    expect(() =>
      resolveEffectivePolicy('labs', 'v1', {}, { status: 'active' }),
    ).toThrow(/labs/);
  });

  it('validates a node-level horizon with the same rules as storage', () => {
    expect(() =>
      resolveEffectivePolicy('labs', 'v1', {}, { horizon: { days: 0 } }),
    ).toThrow(TemporalContextError);
    expect(() =>
      resolveEffectivePolicy('labs', 'v1', {}, { horizon: 'FORTNIGHT' as never }),
    ).toThrow(TemporalContextError);
  });

  it('normalizes a node-level custom horizon down to days', () => {
    const r = resolveEffectivePolicy('labs', 'v1', {}, {
      horizon: { days: 30, note: 'author scratch' } as never,
    });
    expect(r.horizon).toEqual({ days: 30 });
  });
});

describe('toEffectivePolicy', () => {
  it('resolves the tier against the pinned clock and carries the status through', () => {
    const tier = resolveEffectivePolicy('conditions', 'v1', {}, { status: 'any' });
    expect(toEffectivePolicy(tier, ctx())).toEqual({
      horizon: { lowerBound: null, upperBound: AS_OF },
      status: 'any',
    });
  });

  it('omits status entirely for an observation field', () => {
    const tier = resolveEffectivePolicy('labs', 'v1', {});
    const policy = toEffectivePolicy(tier, ctx());
    expect(policy.status).toBeUndefined();
    expect(policy.horizon.lowerBound).toBe('2026-05-05T12:00:00.000Z'); // 90 days back
  });

  it('reads the clock only from the context it is given', () => {
    const tier = resolveEffectivePolicy('labs', 'v1', {});
    const other = toEffectivePolicy(tier, ctx({ evaluationAsOf: '2020-01-01T00:00:00.000Z' }));
    expect(other.horizon.upperBound).toBe('2020-01-01T00:00:00.000Z');
  });

  it('surfaces a missing encounter anchor as MISSING_ENCOUNTER_ANCHOR', () => {
    const tier = resolveEffectivePolicy('vitals', 'v1', {});
    try {
      toEffectivePolicy(tier, ctx());
      throw new Error('expected a throw');
    } catch (e) {
      expect((e as TemporalContextError).code).toBe('MISSING_ENCOUNTER_ANCHOR');
    }
  });

  it('resolves ENCOUNTER when the anchor is present', () => {
    const tier = resolveEffectivePolicy('vitals', 'v1', {});
    const policy = toEffectivePolicy(
      tier,
      ctx({ encounterStart: '2026-08-03T09:00:00.000Z' }),
    );
    expect(policy.horizon).toEqual({
      lowerBound: '2026-08-03T09:00:00.000Z',
      upperBound: AS_OF,
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test --prefix apps/pathway-service -- --runInBand src/__tests__/temporal/cascade-resolve.test.ts`
Expected: FAIL — `resolveEffectivePolicy is not a function`.

- [ ] **Step 3: Append the cascade**

Add to `apps/pathway-service/src/services/resolution/temporal/cascade.ts`. Extend the existing imports first — the `./evaluation-context` import gains `EvaluationTemporalContext` and `resolveHorizon`, the `./policy-registry` import gains `FieldPolicy` and `systemDefaultFor`, and one new line is added:

```ts
import { EffectivePolicy } from './select-facts';
```

```ts
/** Which cascade level supplied a resolved value — surfaced in evidence (Plan 08). */
export type PolicyLevel = 'SYSTEM_DEFAULT' | 'PATHWAY' | 'NODE';

/** The NODE level: the author's per-condition overrides. */
export interface ConditionTemporalOverride {
  horizon?: Horizon;
  status?: TemporalStatus;
}

/**
 * A resolved policy that has NOT yet been anchored to a clock. Horizon is
 * still a tier (`'QUARTER'`, `{days:45}`), not a date range — resolving it
 * requires the session's pinned context, and keeping that separate is what
 * lets the cascade be tested without a clock and keeps `evaluationAsOf` the
 * single wall-clock read.
 */
export interface PolicyTier {
  horizon: Horizon;
  status?: TemporalStatus;
  horizonLevel: PolicyLevel;
  statusLevel?: PolicyLevel;
}

/**
 * Resolve SYSTEM_DEFAULT → PATHWAY → NODE for one (field, condition) pair
 * (design §5).
 *
 * The two axes resolve independently: a condition that overrides only
 * `status` keeps whatever horizon it inherits, and vice versa. Folding them
 * into one "the node has an opinion" check would silently reset the other.
 *
 * Observation fields never carry a status at any level.
 */
export function resolveEffectivePolicy(
  field: GateField,
  version: string,
  pathwayDefaults: PathwayTemporalDefaults,
  condition?: ConditionTemporalOverride,
): PolicyTier {
  const system: FieldPolicy = systemDefaultFor(field, version);

  let horizon: Horizon = system.horizon;
  let horizonLevel: PolicyLevel = 'SYSTEM_DEFAULT';

  const fromPathway = pathwayDefaults.horizons?.[field];
  if (fromPathway !== undefined) {
    horizon = parseHorizonValue(fromPathway, `default_horizons.${field}`);
    horizonLevel = 'PATHWAY';
  }
  if (condition?.horizon !== undefined) {
    horizon = parseHorizonValue(condition.horizon, `condition.horizon (${field})`);
    horizonLevel = 'NODE';
  }

  if (!fieldHasClinicalState(field)) {
    if (condition?.status !== undefined) {
      throw new TemporalContextError(
        `condition.status (${field}): ${field} have no clinical state, so a status is meaningless`,
        'INVALID_TEMPORAL_DEFAULTS',
      );
    }
    return { horizon, horizonLevel };
  }

  let status: TemporalStatus | undefined = system.status;
  let statusLevel: PolicyLevel | undefined = status === undefined ? undefined : 'SYSTEM_DEFAULT';

  const statusFromPathway = pathwayDefaults.statuses?.[field];
  if (statusFromPathway !== undefined) {
    status = parseStatusValue(statusFromPathway, `default_statuses.${field}`);
    statusLevel = 'PATHWAY';
  }
  if (condition?.status !== undefined) {
    status = parseStatusValue(condition.status, `condition.status (${field})`);
    statusLevel = 'NODE';
  }

  const tier: PolicyTier = { horizon, horizonLevel };
  if (status !== undefined) {
    tier.status = status;
    tier.statusLevel = statusLevel;
  }
  return tier;
}

/**
 * Anchor a resolved tier to the session's pinned clock, producing the
 * `EffectivePolicy` Plan 01's `selectFacts` consumes.
 *
 * Throws `MISSING_ENCOUNTER_ANCHOR` when an ENCOUNTER horizon has no
 * `encounterStart` — `resolveHorizon` never substitutes `evaluationAsOf`,
 * which would silently narrow the window to zero width. Call
 * `collectEncounterAnchorRequirements` at session creation so this surfaces
 * before a traversal starts rather than partway through one.
 */
export function toEffectivePolicy(
  tier: PolicyTier,
  ctx: EvaluationTemporalContext,
): EffectivePolicy {
  const policy: EffectivePolicy = { horizon: resolveHorizon(tier.horizon, ctx) };
  if (tier.status !== undefined) policy.status = tier.status;
  return policy;
}
```

Note: `parseStatusValue` is currently module-private from Task 2 — no export change is needed, both functions live in this file.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test --prefix apps/pathway-service -- --runInBand src/__tests__/temporal/cascade-resolve.test.ts`
Expected: PASS, 16 tests.

- [ ] **Step 5: Run the whole temporal directory — Plans 01/02 must be untouched**

Run: `npm test --prefix apps/pathway-service -- --runInBand src/__tests__/temporal`
Expected: PASS, all suites.

- [ ] **Step 6: Typecheck**

Run: `./node_modules/.bin/tsc -p apps/pathway-service/tsconfig.json --noEmit`
Expected: exit 0.

- [ ] **Step 7: Commit**

```bash
git add apps/pathway-service/src/services/resolution/temporal/cascade.ts apps/pathway-service/src/__tests__/temporal/cascade-resolve.test.ts
git commit -m "feat: resolve SYSTEM_DEFAULT then PATHWAY then NODE per gate condition

Horizon and status resolve as independent axes, each carrying the level
that supplied it (Plan 08 evidence needs to show the author which level
won). Collapsing them into one 'the node has an opinion' check would
reset the axis the author did not touch.

The cascade stops at a tier — 'QUARTER', not a date range. Anchoring is
toEffectivePolicy(tier, ctx), so the cascade is testable without a clock
and evaluationAsOf stays the single wall-clock read.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@example.com>"
```

---

### Task 4: ENCOUNTER anchor preflight sweep

**Files:**
- Modify: `apps/pathway-service/src/services/resolution/temporal/cascade.ts` (append)
- Test: `apps/pathway-service/src/__tests__/temporal/encounter-anchor-sweep.test.ts`

**Interfaces:**
- Consumes: Task 3's `resolveEffectivePolicy`, `PolicyLevel`, `ConditionTemporalOverride`; `requiresEncounterAnchor` from `./evaluation-context`.
- Produces: `SweepableCondition`, `EncounterAnchorRequirement`, `collectEncounterAnchorRequirements(conditions, version, pathwayDefaults)`. **Task 6 and Plan 05 consume this.**

This is the function `requiresEncounterAnchor` was exported for. It answers one question before a session exists: *does any condition in this pathway resolve to a horizon that needs `encounterStart`?*

- [ ] **Step 1: Write the failing test**

Create `apps/pathway-service/src/__tests__/temporal/encounter-anchor-sweep.test.ts`:

```ts
import {
  collectEncounterAnchorRequirements,
  SweepableCondition,
} from '../../services/resolution/temporal/cascade';

const vitalsGate: SweepableCondition = { label: 'gate g-bp / condition 0', field: 'vitals' };
const labsGate: SweepableCondition = { label: 'gate g-a1c / condition 0', field: 'labs' };

describe('collectEncounterAnchorRequirements', () => {
  it('finds nothing under legacy-v0 — no field defaults to ENCOUNTER', () => {
    expect(collectEncounterAnchorRequirements([vitalsGate, labsGate], 'legacy-v0', {}))
      .toEqual([]);
  });

  it('flags a vitals condition under v1, where the system default is ENCOUNTER', () => {
    const reqs = collectEncounterAnchorRequirements([vitalsGate, labsGate], 'v1', {});
    expect(reqs).toEqual([
      { label: 'gate g-bp / condition 0', field: 'vitals', level: 'SYSTEM_DEFAULT' },
    ]);
  });

  it('flags an explicitly authored ENCOUNTER horizon even under legacy-v0', () => {
    const reqs = collectEncounterAnchorRequirements(
      [{ ...labsGate, override: { horizon: 'ENCOUNTER' } }],
      'legacy-v0',
      {},
    );
    expect(reqs).toEqual([
      { label: 'gate g-a1c / condition 0', field: 'labs', level: 'NODE' },
    ]);
  });

  it('flags a pathway-level ENCOUNTER default', () => {
    const reqs = collectEncounterAnchorRequirements([labsGate], 'legacy-v0', {
      horizons: { labs: 'ENCOUNTER' },
    });
    expect(reqs[0].level).toBe('PATHWAY');
  });

  it('does NOT flag a condition whose node override escapes an ENCOUNTER default', () => {
    const reqs = collectEncounterAnchorRequirements(
      [{ ...vitalsGate, override: { horizon: 'YEAR' } }],
      'v1',
      {},
    );
    expect(reqs).toEqual([]);
  });

  it('reports every offender, not just the first — the author fixes them in one pass', () => {
    const reqs = collectEncounterAnchorRequirements(
      [vitalsGate, { label: 'gate g-hr / condition 1', field: 'vitals' }],
      'v1',
      {},
    );
    expect(reqs).toHaveLength(2);
    expect(reqs.map((r) => r.label)).toEqual([
      'gate g-bp / condition 0',
      'gate g-hr / condition 1',
    ]);
  });

  it('is empty for an empty pathway', () => {
    expect(collectEncounterAnchorRequirements([], 'v1', {})).toEqual([]);
  });

  it('propagates an unknown version rather than reporting "no anchors needed"', () => {
    expect(() => collectEncounterAnchorRequirements([vitalsGate], 'v99', {})).toThrow();
  });

  it('rejects an unknown version even when there is nothing to sweep', () => {
    // Regression: validating inside the loop meant an empty pathway reported
    // "no anchors needed" for a version that does not exist.
    expect(() => collectEncounterAnchorRequirements([], 'v99', {})).toThrow(
      /unknown temporalPolicyVersion/,
    );
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test --prefix apps/pathway-service -- --runInBand src/__tests__/temporal/encounter-anchor-sweep.test.ts`
Expected: FAIL — `collectEncounterAnchorRequirements is not a function`.

- [ ] **Step 3: Append the sweep**

Add to `apps/pathway-service/src/services/resolution/temporal/cascade.ts` (add `requiresEncounterAnchor` to the `./evaluation-context` import and `getTemporalPolicy` to the `./policy-registry` import):

```ts
/** One gate condition, reduced to what the anchor sweep needs. */
export interface SweepableCondition {
  /** Human-readable location, used verbatim in the rejection message. */
  label: string;
  field: GateField;
  override?: ConditionTemporalOverride;
}

export interface EncounterAnchorRequirement {
  label: string;
  field: GateField;
  /** Which cascade level introduced the ENCOUNTER horizon. */
  level: PolicyLevel;
}

/**
 * Every condition in a pathway whose effective horizon needs an
 * `encounterStart`, resolved through the same cascade evaluation uses.
 *
 * Run this at session creation. `resolveHorizon` refuses to invent an anchor,
 * so without a preflight the first ENCOUNTER condition throws mid-traversal —
 * after LLM gates have already been called and audit rows written, and with a
 * message that names no gate. Sweeping first turns that into one up-front
 * rejection listing every offending condition.
 *
 * Reports ALL offenders rather than short-circuiting on the first: an author
 * fixing a pathway wants the whole list in one pass.
 */
export function collectEncounterAnchorRequirements(
  conditions: readonly SweepableCondition[],
  version: string,
  pathwayDefaults: PathwayTemporalDefaults,
): EncounterAnchorRequirement[] {
  // Validate the version BEFORE the loop. Left to the loop, an empty or
  // attribute-only pathway would sweep zero conditions, never touch the
  // registry, and report "no anchors needed" for a version that does not
  // exist — the session would then be created pinned to a version nothing
  // can evaluate.
  getTemporalPolicy(version);

  const out: EncounterAnchorRequirement[] = [];
  for (const c of conditions) {
    const tier = resolveEffectivePolicy(c.field, version, pathwayDefaults, c.override);
    if (requiresEncounterAnchor(tier.horizon)) {
      out.push({ label: c.label, field: c.field, level: tier.horizonLevel });
    }
  }
  return out;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test --prefix apps/pathway-service -- --runInBand src/__tests__/temporal/encounter-anchor-sweep.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5: Typecheck**

Run: `./node_modules/.bin/tsc -p apps/pathway-service/tsconfig.json --noEmit`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add apps/pathway-service/src/services/resolution/temporal/cascade.ts apps/pathway-service/src/__tests__/temporal/encounter-anchor-sweep.test.ts
git commit -m "feat: sweep a pathway for horizons that need an encounter anchor

resolveHorizon refuses to substitute evaluationAsOf for a missing
encounterStart, so without a preflight the first ENCOUNTER condition
throws partway through a traversal — after LLM gates have run and audit
rows are written, naming no gate.

The sweep resolves the same cascade evaluation uses and returns every
offender with the level that introduced it, so one rejection lists the
whole list. Under legacy-v0 it finds nothing unless an author asked for
ENCOUNTER explicitly.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@example.com>"
```

---

### Task 5: `temporal_defaults` column and loader

**Files:**
- Create: `shared/data-layer/migrations/064_add_temporal_defaults_to_pathway_graph_index.sql`
- Modify: `apps/pathway-service/src/resolvers/helpers/resolution-context.ts` (the `ResolutionContext` interface and `buildResolutionContext`, currently lines 219–261)
- Test: `apps/pathway-service/src/__tests__/temporal/resolution-context-defaults.test.ts`

**Interfaces:**
- Consumes: Task 2's `PathwayTemporalDefaults`, `parsePathwayTemporalDefaults`.
- Produces: `ResolutionContext.temporalDefaults: PathwayTemporalDefaults`. **Plans 04–07 read it from here.**

- [ ] **Step 1: Write the migration**

Create `shared/data-layer/migrations/064_add_temporal_defaults_to_pathway_graph_index.sql`:

```sql
-- Migration 064: pathway-level temporal defaults
--
-- Temporal horizon work (design §5, §7). The PATHWAY level of the
-- SYSTEM_DEFAULT → PATHWAY → NODE cascade. The pathway JSON header carries
-- `default_horizons` / `default_statuses`, but import decomposes the header
-- and only known fields survive — PathwayMetadata has no temporal fields and
-- root creation serializes a fixed list — so the header alone cannot
-- round-trip.
--
-- The relational index is the SINGLE source: there is deliberately no copy on
-- the AGE root node. Import reconstruction reads it back from here; graph root
-- creation ignores it (§7.4).
--
-- Nullable: NULL and '{}' both mean "this pathway states no opinion, inherit
-- the platform defaults for the session's pinned policy version".

BEGIN;

ALTER TABLE pathway_graph_index
  ADD COLUMN temporal_defaults JSONB;

COMMENT ON COLUMN pathway_graph_index.temporal_defaults IS
    'Pathway-level temporal cascade defaults, in pathway-JSON header shape: {"default_horizons":{<gate field>:<horizon>},"default_statuses":{<gate field>:active|inactive|any}}. NULL = no pathway-level opinion. Single source of truth — not mirrored onto the AGE root node.';

COMMIT;
```

- [ ] **Step 2: Write the failing test**

Create `apps/pathway-service/src/__tests__/temporal/resolution-context-defaults.test.ts`:

```ts
/**
 * buildResolutionContext must load the PATHWAY cascade level alongside the
 * graph. Today it selects only age_node_id (design §7.5).
 *
 * fetchGraphFromAGE, the signal query, thresholds and the code map are all
 * stubbed — this test is about the pathway row and nothing else.
 */
jest.mock('../../services/age-client', () => ({
  executeCypher: jest.fn().mockResolvedValue({ rows: [] }),
}));
// resolution-context imports hydrateSignalDefinition from the Query resolver,
// which pulls in most of the service at module load. Stub it — this test must
// not depend on anything Query.ts touches on import.
jest.mock('../../resolvers/Query', () => ({
  hydrateSignalDefinition: (row: unknown) => row,
}));
jest.mock('../../services/resolution/attribute-code-map', () => ({
  loadAttributeCodeMap: jest.fn().mockResolvedValue(new Map()),
}));
jest.mock('../../services/confidence/weight-cascade-resolver', () => ({
  WeightCascadeResolver: class {
    resolveThresholds = jest
      .fn()
      .mockResolvedValue({ autoResolveThreshold: 0.8, suggestThreshold: 0.5 });
  },
}));

import { buildResolutionContext } from '../../resolvers/helpers/resolution-context';
import { TemporalContextError } from '../../services/resolution/temporal/evaluation-context';

function poolReturning(temporalDefaults: unknown) {
  const query = jest.fn(async (sql: string) => {
    if (sql.includes('pathway_graph_index')) {
      return { rows: [{ age_node_id: '123', temporal_defaults: temporalDefaults }] };
    }
    return { rows: [] };
  });
  return { query } as unknown as import('pg').Pool & { query: jest.Mock };
}

describe('buildResolutionContext — temporal defaults', () => {
  it('selects temporal_defaults from the pathway row', async () => {
    const pool = poolReturning(null);
    await buildResolutionContext(pool, 'pathway-1');
    const sql = (pool.query as jest.Mock).mock.calls[0][0] as string;
    expect(sql).toContain('temporal_defaults');
    expect(sql).toContain('pathway_graph_index');
  });

  it('exposes an empty PATHWAY level when the column is NULL', async () => {
    const ctx = await buildResolutionContext(poolReturning(null), 'pathway-1');
    expect(ctx.temporalDefaults).toEqual({});
  });

  it('parses a stored value into the cascade shape', async () => {
    const ctx = await buildResolutionContext(
      poolReturning({ default_horizons: { labs: 'YEAR' } }),
      'pathway-1',
    );
    expect(ctx.temporalDefaults).toEqual({ horizons: { labs: 'YEAR' } });
  });

  it('refuses to resolve a pathway whose stored defaults are corrupt', async () => {
    await expect(
      buildResolutionContext(poolReturning({ default_horizons: { labs: 'FORTNIGHT' } }), 'pathway-1'),
    ).rejects.toThrow(TemporalContextError);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npm test --prefix apps/pathway-service -- --runInBand src/__tests__/temporal/resolution-context-defaults.test.ts`
Expected: FAIL — the first test fails because the SELECT does not contain `temporal_defaults`.

- [ ] **Step 4: Load it**

In `apps/pathway-service/src/resolvers/helpers/resolution-context.ts`:

Add the import beside the existing service imports:

```ts
import {
  PathwayTemporalDefaults,
  parsePathwayTemporalDefaults,
} from '../../services/resolution/temporal/cascade';
```

Extend the interface:

```ts
export interface ResolutionContext {
  graphContext: GraphContext;
  edges: GraphEdge[];
  signals: SignalDefinition[];
  thresholds: { autoResolveThreshold: number; suggestThreshold: number };
  confidenceEngine: ConfidenceEngine;
  codeMap: AttributeCodeMap;
  /**
   * The PATHWAY level of the temporal cascade (§7.5), read from the
   * relational index. `{}` when the pathway states no opinion.
   */
  temporalDefaults: PathwayTemporalDefaults;
}
```

Change the pathway row query and the return value:

```ts
  // Fetch AGE node ID and the pathway-level temporal cascade defaults
  const pathwayRow = await pool.query(
    'SELECT age_node_id, temporal_defaults FROM pathway_graph_index WHERE id = $1',
    [pathwayId],
  );
  const ageNodeId = pathwayRow.rows[0]?.age_node_id;
  if (!ageNodeId) {
    throw new GraphQLError('Pathway has no graph data (missing AGE node ID)', {
      extensions: { code: 'INTERNAL_SERVER_ERROR' },
    });
  }
  // Parsed before any traversal work starts: a corrupt policy must stop the
  // session, not resolve gates against a window the author never chose.
  const temporalDefaults = parsePathwayTemporalDefaults(pathwayRow.rows[0]?.temporal_defaults);
```

and

```ts
  return {
    graphContext,
    edges,
    signals,
    thresholds,
    confidenceEngine,
    codeMap,
    temporalDefaults,
  };
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm test --prefix apps/pathway-service -- --runInBand src/__tests__/temporal/resolution-context-defaults.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 6: Typecheck**

Run: `./node_modules/.bin/tsc -p apps/pathway-service/tsconfig.json --noEmit`
Expected: exit 0.

- [ ] **Step 7: Commit**

```bash
git add shared/data-layer/migrations/064_add_temporal_defaults_to_pathway_graph_index.sql apps/pathway-service/src/resolvers/helpers/resolution-context.ts apps/pathway-service/src/__tests__/temporal/resolution-context-defaults.test.ts
git commit -m "feat: store and load pathway-level temporal defaults

buildResolutionContext selected only age_node_id, so the PATHWAY level of
the cascade had nowhere to come from (design §7.5). It now reads
temporal_defaults from the relational index — the single source, with no
copy on the AGE root node — and parses it before any traversal work
starts, so a corrupt policy stops the session instead of resolving gates
against a window the author never chose.

Nullable column: NULL means the pathway states no opinion and inherits
the platform defaults for the session's pinned version.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@example.com>"
```

---

### Task 6: Reject a session that cannot anchor its horizons

**Files:**
- Modify: `apps/pathway-service/src/resolvers/helpers/resolution-context.ts` (append the wrapper)
- Modify: `apps/pathway-service/src/resolvers/mutations/resolution.ts` (one call, after the `makeEvaluationTemporalContext()` at ~line 122)
- Modify: `apps/pathway-service/src/resolvers/mutations/multi-pathway-resolution.ts` (one call, after the `buildResolutionContext` at ~line 702)
- Modify: `docs/superpowers/plans/2026-07-26-temporal-horizon-00-overview.md` (contract + commands)
- Test: `apps/pathway-service/src/__tests__/temporal/encounter-anchor-guard.test.ts`

**Interfaces:**
- Consumes: Task 4's `collectEncounterAnchorRequirements`; Task 5's `ResolutionContext.temporalDefaults`; `EvaluationTemporalContext` from `./evaluation-context`.
- Produces: `assertEncounterAnchor(rctx, temporalCtx)` from `resolvers/helpers/resolution-context`.

Only the two **session-creating** call sites need this. The four retraversal sites reuse an existing session's clock, and that session already passed the sweep at creation.

- [ ] **Step 1: Write the failing test**

Create `apps/pathway-service/src/__tests__/temporal/encounter-anchor-guard.test.ts`:

```ts
// Same reason as the Task 5 test: importing the real resolution-context pulls
// in the Query resolver at module load.
jest.mock('../../resolvers/Query', () => ({
  hydrateSignalDefinition: (row: unknown) => row,
}));

import {
  assertEncounterAnchor,
  ResolutionContext,
} from '../../resolvers/helpers/resolution-context';
import {
  EvaluationTemporalContext,
  TemporalContextError,
} from '../../services/resolution/temporal/evaluation-context';
import { GraphNode } from '../../services/confidence/types';

const AS_OF = '2026-08-03T12:00:00.000Z';

function ctx(over: Partial<EvaluationTemporalContext> = {}): EvaluationTemporalContext {
  return { evaluationAsOf: AS_OF, timezone: 'UTC', temporalPolicyVersion: 'v1', ...over };
}

function gate(nodeId: string, properties: Record<string, unknown>): GraphNode {
  return { id: nodeId, nodeIdentifier: nodeId, nodeType: 'Gate', properties };
}

function rctx(nodes: GraphNode[], defaults = {}): ResolutionContext {
  return {
    graphContext: {
      allNodes: nodes,
      allEdges: [],
      incomingEdges: () => [],
      outgoingEdges: () => [],
      getNode: () => undefined,
      linkedNodes: () => [],
    },
    edges: [],
    signals: [],
    thresholds: { autoResolveThreshold: 0.8, suggestThreshold: 0.5 },
    confidenceEngine: {} as ResolutionContext['confidenceEngine'],
    codeMap: new Map(),
    temporalDefaults: defaults,
  };
}

const vitalsGate = gate('g-bp', {
  title: 'BP check',
  gate_type: 'coded',
  default_behavior: 'skip',
  condition: { field: 'vitals', operator: 'greater_than', value: '8480-6' },
});

describe('assertEncounterAnchor', () => {
  it('passes under legacy-v0 — nothing resolves to ENCOUNTER', () => {
    expect(() =>
      assertEncounterAnchor(rctx([vitalsGate]), ctx({ temporalPolicyVersion: 'legacy-v0' })),
    ).not.toThrow();
  });

  it('rejects a v1 session whose pathway reads vitals with no encounterStart', () => {
    try {
      assertEncounterAnchor(rctx([vitalsGate]), ctx());
      throw new Error('expected a throw');
    } catch (e) {
      expect(e).toBeInstanceOf(TemporalContextError);
      expect((e as TemporalContextError).code).toBe('MISSING_ENCOUNTER_ANCHOR');
      expect((e as Error).message).toContain('g-bp');
    }
  });

  it('passes once the anchor is supplied', () => {
    expect(() =>
      assertEncounterAnchor(rctx([vitalsGate]), ctx({ encounterStart: '2026-08-03T09:00:00.000Z' })),
    ).not.toThrow();
  });

  it('walks compound gates — conditions[], not just condition', () => {
    const compound = gate('g-compound', {
      title: 'compound',
      gate_type: 'compound',
      default_behavior: 'skip',
      operator: 'AND',
      conditions: [
        { field: 'conditions', operator: 'includes_code', value: 'E11.9' },
        { field: 'vitals', operator: 'greater_than', value: '8480-6' },
      ],
    });
    expect(() => assertEncounterAnchor(rctx([compound]), ctx())).toThrow(/g-compound/);
  });

  it('ignores attribute conditions — they never resolve a horizon (see "Known gap")', () => {
    const attrGate = gate('g-age', {
      title: 'age',
      gate_type: 'attribute',
      default_behavior: 'skip',
      condition: { attribute: 'age', operator: 'greater_than', value: 18 },
    });
    expect(() => assertEncounterAnchor(rctx([attrGate]), ctx())).not.toThrow();
  });

  it('ignores a gate with no condition', () => {
    const plain = gate('g-empty', { title: 'no condition' });
    expect(() => assertEncounterAnchor(rctx([plain]), ctx())).not.toThrow();
  });

  it('ignores a NON-Gate node even when it carries a condition-shaped property', () => {
    // Must not use the gate() helper — that sets nodeType 'Gate', so the
    // test would pass with or without the nodeType check and prove nothing.
    const step: GraphNode = {
      id: 'n-step',
      nodeIdentifier: 'n-step',
      nodeType: 'Step',
      properties: {
        title: 'Order vitals',
        // Condition-shaped, but nothing ever evaluates it on a Step node.
        condition: { field: 'vitals', operator: 'greater_than', value: '8480-6' },
      },
    };
    expect(() => assertEncounterAnchor(rctx([step]), ctx())).not.toThrow();
  });

  it('ignores a satisfaction_check, which is not a gate condition', () => {
    const step: GraphNode = {
      id: 'n-prereq',
      nodeIdentifier: 'n-prereq',
      nodeType: 'Step',
      properties: {
        title: 'A1c drawn',
        satisfaction_check: { type: 'code', code: '4548-4', system: 'http://loinc.org', lookback_days: 90 },
      },
    };
    expect(() => assertEncounterAnchor(rctx([step]), ctx())).not.toThrow();
  });

  it('honors a pathway-level ENCOUNTER default on an ordinary field', () => {
    const labsGate = gate('g-a1c', {
      title: 'A1c',
      gate_type: 'coded',
      default_behavior: 'skip',
      condition: { field: 'labs', operator: 'greater_than', value: '4548-4' },
    });
    expect(() =>
      assertEncounterAnchor(
        rctx([labsGate], { horizons: { labs: 'ENCOUNTER' } }),
        ctx({ temporalPolicyVersion: 'legacy-v0' }),
      ),
    ).toThrow(/g-a1c/);
  });

  it('rejects an unknown policy version even when an anchor is present', () => {
    // Regression: behind the encounterStart early return, a bad version
    // sailed through whenever an anchor happened to be supplied.
    expect(() =>
      assertEncounterAnchor(
        rctx([vitalsGate]),
        ctx({ temporalPolicyVersion: 'v99', encounterStart: '2026-08-03T09:00:00.000Z' }),
      ),
    ).toThrow(/unknown temporalPolicyVersion/);
  });

  it('rejects an unknown policy version on a pathway with nothing to sweep', () => {
    expect(() =>
      assertEncounterAnchor(rctx([]), ctx({ temporalPolicyVersion: 'v99' })),
    ).toThrow(/unknown temporalPolicyVersion/);
  });

  it('lists every offending gate in one message', () => {
    try {
      assertEncounterAnchor(rctx([vitalsGate, gate('g-hr', {
        title: 'HR',
        gate_type: 'coded',
        default_behavior: 'skip',
        condition: { field: 'vitals', operator: 'greater_than', value: '8867-4' },
      })]), ctx());
      throw new Error('expected a throw');
    } catch (e) {
      expect((e as Error).message).toContain('g-bp');
      expect((e as Error).message).toContain('g-hr');
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test --prefix apps/pathway-service -- --runInBand src/__tests__/temporal/encounter-anchor-guard.test.ts`
Expected: FAIL — `assertEncounterAnchor is not a function`.

- [ ] **Step 3: Write the guard**

Append to `apps/pathway-service/src/resolvers/helpers/resolution-context.ts`. Extend the imports: the `temporal/cascade` import gains `collectEncounterAnchorRequirements`, `SweepableCondition` and `ConditionTemporalOverride`, plus three new lines:

```ts
import {
  EvaluationTemporalContext,
  TemporalContextError,
} from '../../services/resolution/temporal/evaluation-context';
import { GateField, FIELD_TO_KIND } from '../../services/resolution/temporal/contract';
import { getTemporalPolicy } from '../../services/resolution/temporal/policy-registry';
```

```ts
// ─── ENCOUNTER anchor preflight ─────────────────────────────────────

/**
 * Pull the sweepable temporal conditions out of a loaded graph.
 *
 * Reads node properties defensively rather than through `GateProperties`:
 * these come straight from AGE as untyped JSON, `horizon`/`status` are not on
 * `CodedCondition` yet (Plan 06 adds them), and a malformed node must not
 * crash the preflight — Plan 04's adapter is where a bad condition is
 * rejected properly.
 */
function sweepableConditions(nodes: readonly GraphNode[]): SweepableCondition[] {
  const out: SweepableCondition[] = [];

  for (const node of nodes) {
    // Only Gate nodes carry evaluable conditions: `condition`/`conditions` are
    // read exclusively from GateProperties (gate-evaluator.ts:439/563,
    // reachability.ts:153/177). Without this check, any imported node that
    // happens to carry a condition-shaped property would trigger a false
    // missing-anchor rejection for a gate that is never evaluated.
    //
    // `satisfaction_check` on Stage/Step prerequisite nodes is a different
    // shape ({type, code, system, lookback_days}) with no `field` key, so it
    // is already excluded below — see "Known gap" for its own untracked
    // temporal window.
    if (node.nodeType !== 'Gate') continue;

    const props = node.properties as Record<string, unknown> | undefined;
    if (!props) continue;

    const raw: unknown[] = [];
    if (props.condition) raw.push(props.condition);
    if (Array.isArray(props.conditions)) raw.push(...props.conditions);

    raw.forEach((c, i) => {
      if (!c || typeof c !== 'object') return;
      const cond = c as Record<string, unknown>;
      const field = cond.field;
      // Attribute conditions have `attribute`, not `field`, and are not swept
      // because they never resolve a horizon: `resolveAttribute` reads the
      // PatientContext arrays directly and Plan 04 rewrites only the coded
      // branches onto the kernel. Sweeping them would reject sessions for
      // gates that cannot need an anchor.
      //
      // NOTE — this is NOT because attribute conditions are timeless. The
      // registry's namespaces are lab / vitals / allergy / patient
      // (attribute-registry.ts:27), so only `patient.*` is genuinely
      // encounter-derived; a `lab.a1c > 9` attribute gate reads the same
      // clinical data a coded labs gate does, with no temporal filtering at
      // all. That inconsistency is real and is tracked in "Known gap" below —
      // it is a design-scope question, not something the sweep can fix.
      if (typeof field !== 'string') return;
      if (!Object.prototype.hasOwnProperty.call(FIELD_TO_KIND, field)) return;

      const override: ConditionTemporalOverride = {};
      if (cond.horizon !== undefined) override.horizon = cond.horizon as never;
      if (cond.status !== undefined) override.status = cond.status as never;

      const entry: SweepableCondition = {
        label: `${node.nodeIdentifier} / condition ${i}`,
        field: field as GateField,
      };
      if (Object.keys(override).length > 0) entry.override = override;
      out.push(entry);
    });
  }

  return out;
}

/**
 * Refuse to start a session whose pathway resolves an ENCOUNTER horizon when
 * the context carries no `encounterStart`.
 *
 * Called at session CREATION only. Retraversal reuses the clock its session
 * was created with, and that session already passed this check — re-running it
 * there would reject a session that is by construction still valid.
 */
export function assertEncounterAnchor(
  rctx: ResolutionContext,
  temporalCtx: EvaluationTemporalContext,
): void {
  // Unconditionally, before any early return: a session must never be created
  // pinned to a policy version nothing can evaluate. Behind the encounterStart
  // check, an unknown version would sail through whenever an anchor happened
  // to be present.
  getTemporalPolicy(temporalCtx.temporalPolicyVersion);

  if (temporalCtx.encounterStart) return;

  const required = collectEncounterAnchorRequirements(
    sweepableConditions(rctx.graphContext.allNodes),
    temporalCtx.temporalPolicyVersion,
    rctx.temporalDefaults,
  );
  if (required.length === 0) return;

  const detail = required
    .map((r) => `${r.label} (${r.field}, from ${r.level})`)
    .join('; ');
  throw new TemporalContextError(
    `this pathway resolves an ENCOUNTER horizon but the session has no encounterStart: ${detail}`,
    'MISSING_ENCOUNTER_ANCHOR',
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test --prefix apps/pathway-service -- --runInBand src/__tests__/temporal/encounter-anchor-guard.test.ts`
Expected: PASS, 12 tests.

- [ ] **Step 5: Wire the single-pathway site**

In `apps/pathway-service/src/resolvers/mutations/resolution.ts`, add `assertEncounterAnchor` to the existing `buildResolutionContext` import block, and add:

```ts
import { assertKnownPolicyVersion } from '../../services/resolution/temporal/policy-registry';
```

Insert both calls immediately after the `const temporalContext = makeEvaluationTemporalContext();` line (~122), before `makeLlmGateEvaluator`:

```ts
    // The version gates everything downstream, so it is checked at the
    // boundary — not left to the sweep, which never runs on a pathway with
    // nothing to sweep.
    assertKnownPolicyVersion(temporalContext.temporalPolicyVersion);

    // Refuse up front rather than throwing partway through: an ENCOUNTER
    // horizon with no anchor is unresolvable, and by the time the first
    // such gate is reached the traversal has already called LLM gates.
    assertEncounterAnchor(rctx, temporalContext);
```

- [ ] **Step 6: Wire the multi-pathway site**

In `apps/pathway-service/src/resolvers/mutations/multi-pathway-resolution.ts`, add `assertEncounterAnchor` to the existing import from `../helpers/resolution-context`, and add:

```ts
import { assertKnownPolicyVersion } from '../../services/resolution/temporal/policy-registry';
```

**First, the version check at the outer boundary.** `startMultiPathwayResolution` has two exits that never reach `resolveAndPersistAll` — the zero-match branch returns after creating a parent session (~line 164), and a run where every matched pathway has an empty graph sweeps nothing. Both would otherwise persist a parent session pinned to a version nothing can evaluate. Insert immediately after `const temporalContext = makeEvaluationTemporalContext();` (~line 161), **before** `getMatchedPathways`:

```ts
    // Before the zero-match branch: that path creates a parent session and
    // returns without ever entering resolveAndPersistAll, so a version
    // validated only during the sweep would never be checked at all.
    assertKnownPolicyVersion(temporalContext.temporalPolicyVersion);
```

**Then the two-pass split inside `resolveAndPersistAll`.**

`resolveAndPersistAll` currently loads, traverses and persists each pathway in **one** loop (`for (const m of pathways)`, ~line 701; `createSession` at ~751). Validating inside that loop is not a preflight: if pathway B lacks an anchor, pathway A has already created a child session and flushed its LLM audit rows, and the mutation then throws — leaving orphaned sessions behind and no parent session to reference them.

Split it into two passes. The clock arrives as `resolveAndPersistAll`'s 5th parameter, named `temporalContext` (verified 2026-08-03).

**Pass 1 — load and validate everything, mutate nothing:**

```ts
  // Load every pathway's context and validate the whole set BEFORE any
  // traversal. Nothing here writes: a rejection must leave no child sessions
  // and no audit rows behind.
  const loaded: Array<{ m: MatchedPathway; rctx: ResolutionContext }> = [];
  for (const m of pathways) {
    const rctx = await buildResolutionContext(pool, m.pathway.id);
    if (rctx.graphContext.allNodes.length === 0) continue;
    assertEncounterAnchor(rctx, temporalContext);
    loaded.push({ m, rctx });
  }
```

**Pass 2 — the existing loop body, now iterating the validated set.** Change the loop header and drop the two lines Pass 1 took over:

```ts
  for (const { m, rctx } of loaded) {
    const llmBundle = makeLlmGateEvaluator(pool, m.pathway.id);
    // ...the rest of the body is unchanged...
```

`ResolutionContext` is already imported in this file only as a type via the helpers import — add it to that import if it is not already there. `MatchedPathway` is already imported.

Note this rejects the **whole multi-pathway run**, not just the offending pathway. That is deliberate: the alternative is silently dropping a matched pathway from a merged care plan, which is exactly the class of invisible omission this feature exists to prevent.

- [ ] **Step 7: Update the two existing mocks that replace this module**

Both multi-pathway test files mock `resolution-context` with a **factory**, which replaces the entire module — any export not listed is `undefined` at call time. `resolveAndPersistAll` now calls `assertEncounterAnchor`, so both must declare it or every normal-path test dies with "assertEncounterAnchor is not a function". This is the same failure mode that cost two tests in Plan 02 (`makeLlmGateEvaluator` omitted from this exact mock).

In `apps/pathway-service/src/__tests__/multi-pathway-resolution.test.ts`, add to the existing `jest.mock('../resolvers/helpers/resolution-context', …)` factory (~line 32):

```ts
  // Same reason as makeLlmGateEvaluator above: a factory mock replaces the
  // whole module, so an unlisted export is undefined at call time.
  // resolveAndPersistAll's preflight calls this on every run.
  assertEncounterAnchor: jest.fn(),
```

In `apps/pathway-service/src/__tests__/ddi-multi-pathway.test.ts`, add the same line to its factory (~line 22). This suite is one of the three documented baseline failures — without the no-op guard it would fail with a *new, earlier* exception, masking the failures the baseline is supposed to be tracking.

- [ ] **Step 8: Prove the two-pass guarantee with a regression test**

The mock added in Step 7 makes `assertEncounterAnchor` a permanent no-op, so on its own it would **not** catch someone moving validation back inside the traversal loop. The no-side-effects guarantee needs a test that fails when the passes are merged.

Add to `apps/pathway-service/src/__tests__/multi-pathway-resolution.test.ts`. Adjust the imported mock handles to whatever the file already binds (`createSession` from the session-store mock, the `TraversalEngine` constructor mock, `makeLlmGateEvaluator`):

```ts
describe('resolveAndPersistAll — validation is a preflight', () => {
  it('writes nothing when a later pathway fails validation', async () => {
    // Two pathways, both with non-empty graphs. The FIRST passes validation,
    // the SECOND throws. If validation still ran inside the traversal loop,
    // pathway one would already have been traversed and persisted by the
    // time pathway two was rejected — which is exactly the orphaned-session
    // state the two-pass split exists to prevent.
    const flushAudits = jest.fn();
    (makeLlmGateEvaluator as jest.Mock).mockReturnValue({
      evaluator: jest.fn(),
      flushAudits,
    });
    (buildResolutionContext as jest.Mock).mockResolvedValue({
      graphContext: { allNodes: [{ nodeIdentifier: 'n1' }], allEdges: [] },
      edges: [],
      signals: [],
      thresholds: { autoResolveThreshold: 0.8, suggestThreshold: 0.5 },
      confidenceEngine: {},
      codeMap: new Map(),
      temporalDefaults: {},
    });
    (assertEncounterAnchor as jest.Mock)
      .mockImplementationOnce(() => undefined)
      .mockImplementationOnce(() => {
        throw new Error('MISSING_ENCOUNTER_ANCHOR');
      });

    await expect(
      resolveAndPersistAll(
        pool,
        [matchedPathway('p1'), matchedPathway('p2')],
        patientContext,
        'provider-1',
        temporalContext,
      ),
    ).rejects.toThrow('MISSING_ENCOUNTER_ANCHOR');

    // The three things that must NOT have happened.
    expect(TraversalEngine).not.toHaveBeenCalled();
    expect(createSession).not.toHaveBeenCalled();
    expect(flushAudits).not.toHaveBeenCalled();
  });
});
```

Also add a boundary test for the version check on the zero-match path. `makeEvaluationTemporalContext` currently takes no arguments and always yields `legacy-v0`, so an unknown version is not reachable through the resolver until Plan 05 wires the input contract — mock the factory to inject one:

```ts
jest.mock('../services/resolution/temporal/evaluation-context', () => {
  const actual = jest.requireActual('../services/resolution/temporal/evaluation-context');
  return { ...actual, makeEvaluationTemporalContext: jest.fn(actual.makeEvaluationTemporalContext) };
});

it('rejects an unknown policy version before creating a zero-match parent session', async () => {
  (makeEvaluationTemporalContext as jest.Mock).mockReturnValueOnce({
    evaluationAsOf: '2026-08-03T12:00:00.000Z',
    timezone: 'UTC',
    temporalPolicyVersion: 'v99',
  });
  (getMatchedPathways as jest.Mock).mockResolvedValue([]); // zero-match exit

  await expect(startMultiPathwayResolution(...)).rejects.toThrow(/unknown temporalPolicyVersion/);
  expect(createMultiPathwaySession).not.toHaveBeenCalled();
});
```

Repeat the second test with `getMatchedPathways` returning one pathway whose `buildResolutionContext` yields `allNodes: []` — the all-empty path, which also sweeps nothing.

- [ ] **Step 9: Verify both multi-pathway suites behave as documented**

Run: `npm test --prefix apps/pathway-service -- --runInBand src/__tests__/multi-pathway-resolution.test.ts src/__tests__/ddi-multi-pathway.test.ts`
Expected: `multi-pathway-resolution` passes in full. `ddi-multi-pathway` still fails with **its own documented baseline failures** — confirm the failure messages match the pre-existing ones and are not `assertEncounterAnchor is not a function`.

- [ ] **Step 10: Typecheck**

Run: `./node_modules/.bin/tsc -p apps/pathway-service/tsconfig.json --noEmit`
Expected: exit 0.

- [ ] **Step 11: Update the suite overview**

In `docs/superpowers/plans/2026-07-26-temporal-horizon-00-overview.md`:

1. Replace the wrong typecheck command in **Global Constraints** with:
   ```
   - Typecheck (from the repo root): `./node_modules/.bin/tsc -p apps/pathway-service/tsconfig.json --noEmit`.
     There is no `typecheck` npm script, no `apps/pathway-service/node_modules`
     (binaries hoist to the root), and bare `npx tsc` resolves to a decoy package.
   ```
2. Replace the **Plan 03 — Produces** line with:
   ```
   ### Plan 03 — Produces `TEMPORAL_POLICIES` + `getTemporalPolicy(version)` (unknown version = hard error);
   `fieldHasClinicalState(field)`; `PathwayTemporalDefaults` + `parsePathwayTemporalDefaults(raw)`;
   `PolicyTier`/`PolicyLevel`/`ConditionTemporalOverride`; `resolveEffectivePolicy(field, version, pathwayDefaults, condition?)`
   returning an unresolved tier; `toEffectivePolicy(tier, ctx)` producing Plan 01's `EffectivePolicy`;
   `collectEncounterAnchorRequirements(...)` + `assertEncounterAnchor(rctx, temporalCtx)`;
   `temporal_defaults` column (migration 064) + `ResolutionContext.temporalDefaults`. Consumes 01–02.
   ```
3. In the decomposition table, correct Plan 03's file list to
   `temporal/policy-registry.ts`, `temporal/cascade.ts`, migration `064_add_temporal_defaults_to_pathway_graph_index.sql`, `resolvers/helpers/resolution-context.ts`, plus one-line guard calls in `resolvers/mutations/resolution.ts` and `multi-pathway-resolution.ts`.
4. Record the vitals decision under Plan 03: `legacy-v0` vitals = LIFETIME, `v1` vitals = ENCOUNTER (design §5's table omitted vitals; §10 fixes them to Encounter).

- [ ] **Step 12: Run the full suite and compare against the baseline**

Run: `npm test --prefix apps/pathway-service -- --runInBand 2>&1 | tail -30`
Expected: **13 failed** across `data-completeness-scorer`, `patient-match-scorer`, `ddi-multi-pathway` — the documented pre-existing baseline. Any new failure, or any failure in a fourth suite, belongs to this plan. Record the exact passed/failed counts for the commit message.

- [ ] **Step 13: Commit**

```bash
git add apps/pathway-service/src/resolvers/helpers/resolution-context.ts apps/pathway-service/src/resolvers/mutations/resolution.ts apps/pathway-service/src/resolvers/mutations/multi-pathway-resolution.ts apps/pathway-service/src/__tests__/temporal/encounter-anchor-guard.test.ts apps/pathway-service/src/__tests__/multi-pathway-resolution.test.ts apps/pathway-service/src/__tests__/ddi-multi-pathway.test.ts docs/superpowers/plans/2026-07-26-temporal-horizon-00-overview.md
git commit -m "feat: reject a session that cannot anchor its ENCOUNTER horizons

Both session-creating mutations now sweep the loaded pathway before any
traversal work. The four retraversal sites deliberately do not: they
reuse the clock their session was created with, and that session already
passed this check at creation.

resolveAndPersistAll is split into two passes — load and validate every
pathway, then traverse and persist. Validating inside the single loop
was not a preflight: a rejection on pathway B would leave pathway A's
child session and flushed LLM audit rows behind, with no parent session
to reference them.

Both multi-pathway test files mock this module with a factory, which
replaces the whole module, so both now declare the new export. Without
that, ddi-multi-pathway would fail with a new earlier exception that
masks the baseline failures it is meant to track.

Conditions are read defensively from AGE node properties rather than
through GateProperties — horizon/status are not on CodedCondition until
Plan 06, and a malformed node must not crash the preflight. Attribute
conditions are skipped: encounter-derived, no timeline.

No live behavior change: legacy-v0 is the default version and defines no
ENCOUNTER horizon, and no deployed condition carries a horizon key.

Also corrects the suite overview's typecheck command, which named a
per-app node_modules that does not exist in this hoisted monorepo.

Suite <passed> passed / 13 failed — the same three unrelated baseline
suites.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@example.com>"
```

---

## Acceptance criteria

- [ ] `getTemporalPolicy('v99')` throws `UNKNOWN_POLICY_VERSION`; there is no "use latest" path anywhere in the module.
- [ ] An unknown policy version is rejected **unconditionally** at session creation — including when `encounterStart` is present, when the pathway has nothing to sweep, when zero pathways match, and when every matched pathway has an empty graph.
- [ ] The anchor sweep inspects **only `Gate` nodes**; a `Step`/`Criterion` carrying a condition-shaped property or a `satisfaction_check` never triggers a rejection, proven by fixtures that are not built with the `gate()` helper.
- [ ] An unknown root key in `temporal_defaults` (e.g. the singular `default_horizon`) throws rather than resolving to `{}`.
- [ ] A multi-pathway run rejected for a missing anchor creates **no** child sessions and flushes **no** LLM audit rows — validation completes before any traversal begins. Proven by a two-pathway test (first passes, second throws) that **fails if the two passes are merged back together**; the no-op mock alone does not prove this.
- [ ] Every `GateField` resolves to a defined `FieldPolicy` in every known version.
- [ ] `resolveEffectivePolicy` resolves horizon and status as independent axes, each reporting the level that supplied it.
- [ ] `labs` and `vitals` never carry a status, at any cascade level, in any version.
- [ ] A corrupt `temporal_defaults` row stops session creation instead of being silently ignored.
- [ ] Creating a session on a pathway that resolves an ENCOUNTER horizon without an `encounterStart` is rejected before traversal, with every offending gate named.
- [ ] **Under `legacy-v0`, nothing in this plan changes any resolution outcome** — the sweep finds nothing and every default matches today's effective LIFETIME behavior.
- [ ] `./node_modules/.bin/tsc -p apps/pathway-service/tsconfig.json --noEmit` exits 0.
- [ ] Full suite failure count is still 13, in the same three suites.

## Deployment notes — NOT plan steps

Migration 064 is **additive and nullable**, and no running process selects the column, so an unmerged branch cannot break the live host. Apply it only when deploying, using the documented workaround (the migrator CLI is still broken) — note the `sed` that strips pm2's ANSI colouring, without which `psql` fails with "password authentication failed":

```bash
export PGPASSWORD=$(pm2 env 0 | sed 's/\x1b\[[0-9;]*m//g' | awk -F': ' '/^POSTGRES_PASSWORD/{print $2}')
MIG=/home/claude/workspace/prism-graphql/shared/data-layer/migrations
f=064_add_temporal_defaults_to_pathway_graph_index.sql
id="${f%.sql}"
checksum=$(node -e "console.log(require('crypto').createHash('sha256').update(require('fs').readFileSync('${MIG}/${f}','utf-8').trim()).digest('hex'))")
psql -h localhost -U prism -d prism_db -v ON_ERROR_STOP=1 -f "${MIG}/${f}"
psql -h localhost -U prism -d prism_db -c \
  "INSERT INTO migration_history (migration_id, name, checksum) VALUES ('$id', '$id', '$checksum');"
```

The **55 pre-existing sessions with `temporal_context NULL`** (41 single + 14 multi-pathway) remain non-retraversable once Plan 02 deploys. That decision is still open and is not this plan's to make.
