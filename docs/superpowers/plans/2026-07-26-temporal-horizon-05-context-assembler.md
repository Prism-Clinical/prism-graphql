# Temporal Horizon Plan 05 — Input Contract, Trust Modes, Context Assembler

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn resolution input into a `NormalizedFact[]` fact store under an explicit, enforced trust mode, so the gate evaluator can be rewired onto `selectFacts` without changing what today's gates decide.

**Architecture:** `trust-mode.ts` defines `ResolutionInput` — a discriminated union where **the payload lives inside the variant**, so a LIVE resolution structurally cannot carry caller-supplied clinical facts. `synthetic-values.ts` parses the SYNTHETIC-only fields into their closed unions at runtime. `context-assembler.ts` maps a SYNTHETIC payload into Plan 01's `NormalizedFact` union, assigns per-kind fact IDs, and models undated facts as `OPEN(evaluationAsOf)`. Both mutations gain an explicit mode and temporal anchors. Nothing reaches the evaluator until Plan 04.

**Tech Stack:** TypeScript 5, Apollo Server 4 + Federation 2.10, Jest + ts-jest.

## Revision history

- **v1 (2026-08-03, `3a42a1b`)** — first draft.
- **v2 (this document)** — rewritten after review. Five P1/P2 findings, all confirmed and accepted; three smaller corrections accepted. The trust boundary was decorative (LIVE accepted caller facts), the mutations exposed synthetic fields with no mode and no `encounterStart` — which made every `v1` vitals pathway unstartable against Plan 03's guard — several accepted fields were ignored or unvalidated, `factId` renumbered across kinds, and the type expansion covered two inline shapes out of many. Details under each task.

## Why this plan runs BEFORE plan 04

The suite overview orders these 04 → 05. **That order is wrong and this plan supersedes it** (decision 2026-08-03, verified by probe).

Plan 04 rewires `evaluateGate` onto `selectFacts`, which maps an uncertain scalar to `INDETERMINATE`, and thence to fail-closed. Probing `overlap()` directly:

```
undated fact, end: UNKNOWN     + LIFETIME = UNKNOWN   ⇒ scalar INDETERMINATE ⇒ gate fails
undated fact, end: OPEN(asOf)  + LIFETIME = MATCH     ⇒ preserves today
```

`PatientContext.vitalSigns` is a `Record<string, unknown>` carrying **no dates anywhere**, and `LabResult.date` is optional. Without the `OPEN(evaluationAsOf)` modeling this plan owns, Plan 04 would stop every vitals and undated-lab scalar gate from being satisfied under `legacy-v0`, which exists to reproduce today. Plan 05's listed "Consumes 01–04" was nominal: the assembler needs the fact model (01) and the clock (02), nothing from the evaluator.

## Global Constraints

- **Branch:** `feat/temporal-horizon-context-assembler`, worktree `/home/claude/workspace/features/feat-temporal-horizon-context-assembler/prism-graphql`, from `origin/main` at `8abfda4`.
- **All commands from the worktree root.** Never chain `cd` with `&&`.
- **Typecheck:** `./node_modules/.bin/tsc -p apps/pathway-service/tsconfig.json --noEmit`. No `typecheck` script, no per-app `node_modules`, bare `npx tsc` hits a decoy.
- **Tests:** `npm test --prefix apps/pathway-service -- --runInBand <path>`. `testRegex` is `/__tests__/.*.test.ts`.
- **`tsconfig` is NOT full strict** and **excludes `src/__tests__`**. A type enforces nothing at runtime or against a test caller; invariants need a runtime throw plus a test that fails without it.
- **Baseline: 9 failures / 2 suites** (`data-completeness-scorer`, `patient-match-scorer`) — **805 passed / 9 failed**, measured on `main` @ `8abfda4`. Measure on `main`, never on a copy of this branch.
- **No live behavior change.** Additive schema, new modules, and a mode that defaults to today's behavior.
- **Commit prefixes** `feat:`/`fix:`/`test:`/`refactor:`/`docs:`; no `@anthropic.com`/`@claude.com`; end each message with
  `Co-Authored-By: Claude Opus 5 (1M context) <noreply@example.com>`

## Decisions this plan locks

1. **The payload lives inside the mode.** `ResolutionInput` is a discriminated union: SYNTHETIC carries a caller `PatientContext`; LIVE carries a `snapshotId` and server-loaded records; REPLAY carries a `sessionId` and persisted facts. A LIVE caller cannot supply clinical facts because there is nowhere in the type to put them. *(Review P1-1. The v1 draft took `PatientContext` alongside the mode, so LIVE could inject an assumed-active diagnosis and every fact was stamped `SYNTHETIC` regardless.)*
2. **LIVE and REPLAY are defined, not implemented, here.** Both throw `NOT_IMPLEMENTED`. LIVE needs Plan 07's snapshot mapper; REPLAY needs fact persistence (see decision 5). Defining them now is what makes the union enforceable; pretending to implement them would be worse than the gap.
3. **Undated ⇒ `OPEN(evaluationAsOf)` — except when the fact is inactive.** An undated *active* fact is asserted current at the clock. An undated fact whose supplied `clinicalState` is `INACTIVE` gets `{ kind: 'UNKNOWN' }`: asserting an inactive condition is current at the evaluation instant is simply false, and would let it match a narrow horizon. *(Review P1-3.)*
4. **Every SYNTHETIC value is parsed, never cast.** `clinicalState` and `recordValidity` are closed unions; the v1 draft cast arbitrary strings into them. They now go through runtime parsers backed by GraphQL enums, and `endDate` — declared but silently ignored in the draft — becomes a validated `KNOWN` end. *(Review P1-3.)*
5. **`factId` is per-kind and stable under input growth; persistence is deferred with a stated reason.** Ordinals are scoped per kind, so adding a condition no longer renumbers every medication, allergy and lab. Persisting normalized facts is genuinely required for REPLAY and is deferred to Plan 05b **because retraversal does not need it**: retraversal re-assembles from the stored `initialPatientContext` plus additions, and identical input yields identical IDs. If a reviewer disagrees that determinism-from-stored-input is sufficient for v1, that is the thing to push back on. *(Review P1-4, accepted in part with a stated boundary.)*
6. **Distinct occurrences must survive the merge.** `buildEffectivePatientContext` deduplicates on `code|system` alone (`effective-context.ts:18`), so a recurrence on a different date is discarded before assembly — `count_in_window` is broken upstream of everything this plan does. The merge key gains date and source id. *(Review P1-4. Pre-existing defect, but this plan's promises depend on it.)*
7. **Trust/input errors get their own code.** `INVALID_RESOLUTION_INPUT`, not `INVALID_TEMPORAL_DEFAULTS` — the latter means a pathway's stored policy is corrupt, which is a different operator response. *(Review, smaller correction.)*
8. **The SYNTHETIC authorization check is defence-in-depth, NOT a security boundary.** `userRole` is read from an unverified `x-user-role` header defaulting to `PROVIDER` (`index.ts:44`), so any caller can claim any role. The check belongs here and must be written, but the plan must not imply it secures anything until real authentication exists. Record it as a known limitation.

## Deliberately out of scope

- **Wiring the assembler into `evaluateGate`/reachability** — Plan 04.
- **The snapshot mapper (LIVE)** — Plan 07.
- **Normalized-fact persistence and REPLAY loading** — Plan 05b, per decision 5.
- **Consumer projections** (`actionableMedications`, scorer projections) — they matter once the widened store feeds consumers, which is Plan 04's wiring.

---

### Task 1: `ResolutionInput` — the payload inside the mode

**Files:**
- Create: `apps/pathway-service/src/services/resolution/temporal/trust-mode.ts`
- Modify: `apps/pathway-service/src/services/resolution/temporal/evaluation-context.ts` (add `INVALID_RESOLUTION_INPUT` to `TemporalContextErrorCode`)
- Test: `apps/pathway-service/src/__tests__/temporal/trust-mode.test.ts`

**Interfaces:**
- Produces: `ResolutionInput`, `ResolutionModeKind`, `SyntheticPatientContext`, `SyntheticCodeEntry`, `SyntheticLabResult`, `assertSyntheticAuthorized(role)`.

- [ ] **Step 1: Write the failing test**

```ts
import {
  ResolutionInput,
  assertSyntheticAuthorized,
} from '../../services/resolution/temporal/trust-mode';
import { TemporalContextError } from '../../services/resolution/temporal/evaluation-context';

describe('ResolutionInput — the type IS the boundary', () => {
  it('carries a caller patientContext only on the SYNTHETIC variant', () => {
    // Compile-time is the real assertion; this documents it at runtime.
    const synthetic: ResolutionInput = {
      mode: 'SYNTHETIC',
      patientContext: { patientId: 'p', conditionCodes: [], medications: [], labResults: [], allergies: [] },
    };
    const live: ResolutionInput = { mode: 'LIVE', snapshotId: 'snap-1' };
    const replay: ResolutionInput = { mode: 'REPLAY', sessionId: 'sess-1' };

    expect('patientContext' in synthetic).toBe(true);
    expect('patientContext' in live).toBe(false);
    expect('patientContext' in replay).toBe(false);
  });
});

describe('assertSyntheticAuthorized', () => {
  it('allows an admin to select SYNTHETIC', () => {
    expect(() => assertSyntheticAuthorized('ADMIN')).not.toThrow();
  });

  it('rejects a provider selecting SYNTHETIC', () => {
    expect(() => assertSyntheticAuthorized('PROVIDER')).toThrow(TemporalContextError);
  });

  it('rejects a missing role rather than defaulting to permitted', () => {
    expect(() => assertSyntheticAuthorized(undefined)).toThrow(/INVALID_RESOLUTION_INPUT|authorized/);
  });

  it('uses the dedicated input error code, not the pathway-policy one', () => {
    try {
      assertSyntheticAuthorized('PROVIDER');
      throw new Error('expected a throw');
    } catch (e) {
      expect((e as TemporalContextError).code).toBe('INVALID_RESOLUTION_INPUT');
    }
  });
});
```

- [ ] **Step 2: Run it, confirm it fails.**

- [ ] **Step 3: Add the error code** to `TemporalContextErrorCode` in `evaluation-context.ts`:

```ts
  /** Resolution input violated its trust mode or failed validation (§8). */
  | 'INVALID_RESOLUTION_INPUT'
```

- [ ] **Step 4: Implement `trust-mode.ts`**

```ts
import type { PatientContext, CodeEntry, LabResult } from '../../confidence/types';
import { TemporalContextError } from './evaluation-context';

export type ResolutionModeKind = 'LIVE' | 'SYNTHETIC' | 'REPLAY';

/** The SYNTHETIC-only fields an authorized simulator may assert. */
export interface SyntheticCodeEntry extends CodeEntry {
  endDate?: string;
  clinicalState?: string;
  recordValidity?: string;
  sourceId?: string;
}

export interface SyntheticLabResult extends LabResult {
  /** Labs carry no clinical state — supplying one is rejected, not ignored. */
  recordValidity?: string;
  sourceId?: string;
}

export interface SyntheticPatientContext extends Omit<PatientContext, 'conditionCodes' | 'medications' | 'allergies' | 'labResults'> {
  conditionCodes: SyntheticCodeEntry[];
  medications: SyntheticCodeEntry[];
  allergies: SyntheticCodeEntry[];
  labResults: SyntheticLabResult[];
}

/**
 * Exactly one mode per resolution, and the payload lives INSIDE the variant.
 *
 * This is the trust boundary. A LIVE resolution cannot carry caller-supplied
 * clinical facts because the type has nowhere to put them — which is stronger
 * than validating a shared payload after the fact, since validation can be
 * forgotten at a new call site and a missing union member cannot.
 */
export type ResolutionInput =
  | { mode: 'SYNTHETIC'; patientContext: SyntheticPatientContext }
  | { mode: 'LIVE'; snapshotId: string }
  | { mode: 'REPLAY'; sessionId: string };

/**
 * Only an admin may assert synthetic clinical facts.
 *
 * DEFENCE IN DEPTH ONLY — NOT a security boundary. `userRole` is read from an
 * unverified `x-user-role` header that defaults to PROVIDER (index.ts:44), so
 * any caller can claim any role. This check is correct and belongs here, and
 * it secures nothing until real authentication exists. Do not cite it as an
 * access control.
 */
export function assertSyntheticAuthorized(role: string | undefined): void {
  if (role !== 'ADMIN') {
    throw new TemporalContextError(
      `SYNTHETIC resolution requires an ADMIN role (got: ${role ?? 'none'})`,
      'INVALID_RESOLUTION_INPUT',
    );
  }
}
```

- [ ] **Step 5: Run the test** — PASS, 5 tests. **Step 6: Typecheck.** **Step 7: Commit.**

```bash
git commit -m "feat: resolution trust modes with the payload inside the mode

ResolutionInput is a discriminated union whose variants carry their own
payload, so a LIVE resolution structurally cannot hold caller-supplied
clinical facts. The previous shape took a PatientContext alongside the
mode and validated the extra fields afterwards, which left the core
payload wide open: a LIVE caller could inject an assumed-active,
assumed-valid diagnosis and every fact was stamped SYNTHETIC regardless.
A forgotten validation call is possible; a missing union member is not.

The SYNTHETIC authorization check is written but documented as defence in
depth only — userRole comes from an unverified header defaulting to
PROVIDER, so it secures nothing until real auth exists.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@example.com>"
```

---

### Task 2: Runtime parsers for the SYNTHETIC values

**Files:**
- Create: `apps/pathway-service/src/services/resolution/temporal/synthetic-values.ts`
- Test: `apps/pathway-service/src/__tests__/temporal/synthetic-values.test.ts`

**Interfaces:**
- Produces: `parseClinicalState`, `parseRecordValidity`, `parseSyntheticDate`, `CLINICAL_STATES`, `RECORD_VALIDITIES`.

The v1 draft wrote `entry.clinicalState as StatefulFact['clinicalState']` — an assertion that turns any string into a member of a closed union, so `clinicalState: "banana"` would flow into the kernel and be compared against `'ACTIVE'` forever unequal. Every value is now parsed.

- [ ] **Step 1: Write the failing test**

```ts
import {
  parseClinicalState,
  parseRecordValidity,
  parseSyntheticDate,
  CLINICAL_STATES,
  RECORD_VALIDITIES,
} from '../../services/resolution/temporal/synthetic-values';
import { TemporalContextError } from '../../services/resolution/temporal/evaluation-context';

describe('parseClinicalState', () => {
  it('accepts every member of the closed union', () => {
    for (const s of CLINICAL_STATES) expect(parseClinicalState(s, 'conditions[0]')).toBe(s);
  });
  it('rejects an unknown string instead of casting it in', () => {
    expect(() => parseClinicalState('banana', 'conditions[0]')).toThrow(TemporalContextError);
  });
  it('names the field path and the allowed values', () => {
    try {
      parseClinicalState('banana', 'medications[2]');
      throw new Error('expected a throw');
    } catch (e) {
      expect((e as Error).message).toContain('medications[2]');
      expect((e as Error).message).toContain('ACTIVE');
    }
  });
  it('is case sensitive — "active" is not ACTIVE', () => {
    expect(() => parseClinicalState('active', 'conditions[0]')).toThrow(TemporalContextError);
  });
});

describe('parseRecordValidity', () => {
  it('accepts every member', () => {
    for (const v of RECORD_VALIDITIES) expect(parseRecordValidity(v, 'labs[0]')).toBe(v);
  });
  it('rejects anything else', () => {
    expect(() => parseRecordValidity('MAYBE', 'labs[0]')).toThrow(TemporalContextError);
  });
});

describe('parseSyntheticDate', () => {
  it('returns a precision-carrying bound', () => {
    expect(parseSyntheticDate('2026-01-15', 'conditions[0].date')).toEqual({
      value: '2026-01-15', precision: 'day',
    });
  });
  it('rejects an unparseable date rather than dropping it', () => {
    expect(() => parseSyntheticDate('last tuesday', 'conditions[0].date')).toThrow(/conditions\[0\]\.date/);
  });
  it('uses the resolution-input error code', () => {
    try {
      parseSyntheticDate('nope', 'x');
      throw new Error('expected a throw');
    } catch (e) {
      expect((e as TemporalContextError).code).toBe('INVALID_RESOLUTION_INPUT');
    }
  });
});
```

- [ ] **Step 2: Run it, confirm it fails.**

- [ ] **Step 3: Implement.** `CLINICAL_STATES` must be exactly the members of `StatefulFact['clinicalState']` in `fact-model.ts` and `RECORD_VALIDITIES` exactly those of `FactBase['recordValidity']`; read both before writing them, and use `satisfies` so a drift in the fact model breaks the build here.

```ts
import { TemporalBound } from './fact-model';
import { parseFhirDate } from './interval';
import { TemporalContextError } from './evaluation-context';

export const CLINICAL_STATES = ['ACTIVE', 'INACTIVE', 'ON_HOLD', 'UNKNOWN', 'CONFLICT'] as const;
export const RECORD_VALIDITIES = ['VALID', 'INVALID', 'UNKNOWN'] as const;

export type SyntheticClinicalState = (typeof CLINICAL_STATES)[number];
export type SyntheticRecordValidity = (typeof RECORD_VALIDITIES)[number];

function reject(where: string, got: unknown, allowed: readonly string[]): never {
  throw new TemporalContextError(
    `${where}: ${JSON.stringify(got)} is not one of ${allowed.join(' | ')}`,
    'INVALID_RESOLUTION_INPUT',
  );
}

export function parseClinicalState(raw: unknown, where: string): SyntheticClinicalState {
  if (typeof raw === 'string' && (CLINICAL_STATES as readonly string[]).includes(raw)) {
    return raw as SyntheticClinicalState;
  }
  reject(where, raw, CLINICAL_STATES);
}

export function parseRecordValidity(raw: unknown, where: string): SyntheticRecordValidity {
  if (typeof raw === 'string' && (RECORD_VALIDITIES as readonly string[]).includes(raw)) {
    return raw as SyntheticRecordValidity;
  }
  reject(where, raw, RECORD_VALIDITIES);
}

export function parseSyntheticDate(raw: string, where: string): TemporalBound {
  const bound = parseFhirDate(raw);
  if (!bound) {
    throw new TemporalContextError(
      `${where}: "${raw}" is not a valid FHIR date`,
      'INVALID_RESOLUTION_INPUT',
    );
  }
  return bound;
}
```

- [ ] **Step 4–6: Run (PASS, 10 tests), typecheck, commit.**

---

### Task 3: Assemble stateful facts

**Files:**
- Create: `apps/pathway-service/src/services/resolution/temporal/context-assembler.ts`
- Test: `apps/pathway-service/src/__tests__/temporal/context-assembler-stateful.test.ts`

**Interfaces:**
- Produces: `assembleContext(input: ResolutionInput, ctx) → FactStore` (stateful kinds here; observations in Task 4).

**Interval rules — the table this task encodes:**

| Supplied | `interval.start` | `interval.end` |
|---|---|---|
| nothing | absent | `OPEN(evaluationAsOf)` |
| `date` | parsed bound | `OPEN(evaluationAsOf)` |
| `date` + `endDate` | parsed bound | `KNOWN(parsed endDate)` |
| `clinicalState: INACTIVE`, no `endDate` | as above | `{ kind: 'UNKNOWN' }` |

The last row is review finding P1-3: asserting an inactive condition is *current at the evaluation instant* is false, and would let it match a narrow horizon.

- [ ] **Step 1: Write the failing test.** Cover: kind mapping; no status ⇒ `ACTIVE`/`MISSING_STATUS_FAIL_OPEN`/`VALID`; undated active ⇒ `OPEN(asOf)`; `date` parsed with precision; `endDate` ⇒ `KNOWN` end; **`INACTIVE` with no `endDate` ⇒ `UNKNOWN` end, not OPEN**; supplied `clinicalState`/`recordValidity` honored with basis `SYNTHETIC`; `recordValidity: 'INVALID'` surviving onto the fact; unparseable date rejected naming the path; `sourceId` landing in `provenance.sourceId`; LIVE and REPLAY each throwing `NOT_IMPLEMENTED`.

- [ ] **Step 2: Run it, confirm it fails.**

- [ ] **Step 3: Implement.** Key fragments — the rest follows the table:

```ts
function endFor(
  entry: SyntheticCodeEntry,
  state: StatefulFact['clinicalState'],
  ctx: EvaluationTemporalContext,
  where: string,
): TemporalEnd {
  if (entry.endDate !== undefined) {
    return { kind: 'KNOWN', bound: parseSyntheticDate(entry.endDate, `${where}.endDate`) };
  }
  // An inactive fact with no known end is NOT current: OPEN(asOf) would assert
  // it is, and let it match a narrow horizon it has no business matching.
  if (state === 'INACTIVE' || state === 'CONFLICT') return { kind: 'UNKNOWN' };
  return { kind: 'OPEN', assertedCurrentAt: ctx.evaluationAsOf };
}
```

```ts
export function assembleContext(
  input: ResolutionInput,
  ctx: EvaluationTemporalContext,
): FactStore {
  if (input.mode === 'LIVE') {
    throw new TemporalContextError(
      'LIVE resolution requires the snapshot mapper (plan 07)',
      'INVALID_RESOLUTION_INPUT',
    );
  }
  if (input.mode === 'REPLAY') {
    throw new TemporalContextError(
      'REPLAY resolution requires persisted normalized facts (plan 05b)',
      'INVALID_RESOLUTION_INPUT',
    );
  }
  // ...SYNTHETIC assembly
}
```

Per-kind ordinals (review P1-4) — one counter per kind, never a shared one:

```ts
  const nextId = (() => {
    const counters: Record<string, number> = {};
    return (kind: string) => `${kind}:${(counters[kind] = (counters[kind] ?? 0) + 1) - 1}`;
  })();
```

- [ ] **Step 4–7: Run, run the whole temporal directory, typecheck, commit.**

---

### Task 4: Assemble observations

**Files:** modify `context-assembler.ts`; test `context-assembler-observations.test.ts`.

Labs must honor `recordValidity` and `sourceId` — the v1 draft accepted both in the SDL and hardcoded `VALID` with no source, so **an explicitly invalid lab became an admitted fact** (review P1-3). Labs must also *reject* `clinicalState`: observations carry none, and silently ignoring it hides an authoring error.

Vitals flatten to the keys the evaluator already resolves — root keys, and `custom.<key>` — because a different key means the gate silently finds nothing.

- [ ] **Step 1: Write the failing test.** Nine tests for labs (value/unit carried; dated ⇒ point fact; undated ⇒ `OPEN(asOf)`; valueless lab retained for `exists`; `recordValidity: 'INVALID'` carried onto the fact; `sourceId` in provenance; supplied `clinicalState` **rejected** naming the path) and six for vitals (one fact per numeric root key; `custom.<key>` flattening; always `OPEN(asOf)`; non-numeric skipped; no `clinicalState` property present; `system` set to the local vitals urn).
- [ ] **Steps 2–7:** fail → implement → run → temporal directory → typecheck → commit.

---

### Task 5: Fact identity and merge semantics

**Files:**
- Modify: `apps/pathway-service/src/services/resolution/effective-context.ts`
- Test: `apps/pathway-service/src/__tests__/temporal/fact-identity.test.ts`

Two defects, one of them pre-existing and more serious than anything else in this plan.

- [ ] **Step 1: Write the failing test**

```ts
describe('factId stability', () => {
  it('does not renumber other kinds when a condition is added', () => {
    // A shared ordinal counter meant inserting one condition shifted every
    // medication, allergy and lab id — so nothing downstream could reference
    // a fact across two assemblies of nearly-identical input.
    const base = { medications: [{ code: 'm1', system: 's' }], labResults: [{ code: 'l1', system: 's' }] };
    const before = assembleContext(synthetic(base), ctx);
    const after = assembleContext(synthetic({ ...base, conditionCodes: [{ code: 'c1', system: 's' }] }), ctx);
    const idOf = (store, kind) => store.filter((f) => f.kind === kind).map((f) => f.factId);
    expect(idOf(after, 'medication_order')).toEqual(idOf(before, 'medication_order'));
    expect(idOf(after, 'lab')).toEqual(idOf(before, 'lab'));
  });
});

describe('buildEffectivePatientContext — distinct occurrences survive', () => {
  it('keeps the same code on a DIFFERENT date', () => {
    // Deduplicating on code|system alone discarded recurrence entirely, so
    // count_in_window counted 1 no matter how many events occurred. This is
    // upstream of the assembler: no amount of fact-model correctness fixes it.
    const merged = buildEffectivePatientContext(
      pc({ conditionCodes: [{ code: 'N39.0', system: 'icd10', date: '2026-01-15' }] }),
      { conditionCodes: [{ code: 'N39.0', system: 'icd10', date: '2026-06-02' }] },
    );
    expect(merged.conditionCodes).toHaveLength(2);
  });

  it('keeps the same code and date under a different sourceId', () => {
    const merged = buildEffectivePatientContext(
      pc({ conditionCodes: [{ code: 'N39.0', system: 'icd10', date: '2026-01-15', sourceId: 'a' }] }),
      { conditionCodes: [{ code: 'N39.0', system: 'icd10', date: '2026-01-15', sourceId: 'b' }] },
    );
    expect(merged.conditionCodes).toHaveLength(2);
  });

  it('STILL collapses a genuine duplicate — same code, system, date and source', () => {
    const entry = { code: 'N39.0', system: 'icd10', date: '2026-01-15' };
    const merged = buildEffectivePatientContext(pc({ conditionCodes: [entry] }), { conditionCodes: [{ ...entry }] });
    expect(merged.conditionCodes).toHaveLength(1);
  });

  it('collapses undated duplicates, preserving today for the no-date case', () => {
    const entry = { code: 'E11.9', system: 'icd10' };
    const merged = buildEffectivePatientContext(pc({ conditionCodes: [entry] }), { conditionCodes: [{ ...entry }] });
    expect(merged.conditionCodes).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run, confirm the merge tests fail** (the identity test may already pass if Task 3 used per-kind counters — that is fine, it is a regression guard).
- [ ] **Step 3: Widen the merge key** in `effective-context.ts` from `` `${code}|${system}` `` to `` `${code}|${system}|${date ?? ''}|${sourceId ?? ''}` ``. Note in the code comment that undated entries still collapse, which is what preserves today's behavior for the common case.
- [ ] **Step 4: Run the retraversal suites** — `resolution-retraversal-context.test.ts` and anything else exercising `addPatientContext` — and confirm no count regressions.
- [ ] **Steps 5–6: Typecheck, commit.**

---

### Task 6: GraphQL — explicit mode, temporal anchors, and central types

**Files:**
- Modify: `apps/pathway-service/schema.graphql`
- Modify: `apps/pathway-service/src/services/confidence/types.ts` (extend `CodeEntry`/`LabResult` centrally)
- Modify: `apps/pathway-service/src/resolvers/mutations/resolution.ts`, `multi-pathway-resolution.ts`
- Test: `apps/pathway-service/src/__tests__/temporal/resolution-input-contract.test.ts`

Review P1-2 and P2. Two defects: the mutations exposed synthetic fields with **no mode input and no temporal anchors**, and the TypeScript expansion touched two inline shapes while `CodeInput`/`LabResultInput` are shared by `PatientContextInput` *and* `AdditionalContextInput` and several other consumers.

**The anchor gap is not cosmetic.** Both resolvers call `makeEvaluationTemporalContext()` with no arguments, so `encounterStart` is never set. Under `v1`, Plan 03 defaults vitals to `ENCOUNTER`, and Plan 03's guard rejects any session whose pathway resolves an ENCOUNTER horizon without an anchor. **Every `v1` pathway reading vitals would therefore be unstartable, with no way for a caller to supply the anchor.** This task closes that.

- [ ] **Step 1: Write the failing test** — assert against the SDL and the resolver behavior: `resolutionMode` exists on both mutations; `evaluationAsOf` and `encounterStart` are accepted and threaded into `makeEvaluationTemporalContext`; SYNTHETIC without ADMIN is rejected; a v1 vitals pathway with `encounterStart` supplied starts, and without it fails with `MISSING_ENCOUNTER_ANCHOR` (proving the anchor actually reaches the guard); every new SDL field is optional.
- [ ] **Step 2: Run, confirm it fails.**
- [ ] **Step 3: SDL.** Add a `ResolutionModeInput` enum (`LIVE`/`SYNTHETIC`/`REPLAY`), `snapshotId`, `sessionId`, `evaluationAsOf`, `encounterStart` to both mutations, and enums `ClinicalStateInput`/`RecordValidityInput` so invalid values are rejected at the GraphQL layer as well as by Task 2's parsers. Add the SYNTHETIC-only fields to `CodeInput`; add `recordValidity`/`sourceId` — **not** `clinicalState` — to `LabResultInput`. All optional.
- [ ] **Step 4: Runtime exactly-one validation.** GraphQL cannot express a discriminated input union, so the resolver validates: `SYNTHETIC` requires `patientContext` and forbids `snapshotId`/`sessionId`; `LIVE` requires `snapshotId`; `REPLAY` requires `sessionId`. Absent mode defaults to `SYNTHETIC` **only if** `patientContext` is present — preserving every existing caller — and that default is asserted by a test.
- [ ] **Step 5: Central types.** Add the optional fields to `CodeEntry` and `LabResult` in `confidence/types.ts` so the assembler needs no intersection casts, then update every consumer the compiler flags. Do not add per-call-site inline shapes.
- [ ] **Step 6: Compile-time fixtures** for the single-pathway, multi-pathway and additional-context paths, so a consumer missed during the widening fails the build rather than at runtime.
- [ ] **Steps 7–9: Run, `npm run build --prefix apps/pathway-service` (codegen + tsc), commit.**

---

### Task 7: Behavior-preservation proof, suite, and overview

**Files:** test `assembler-preserves-today.test.ts`; modify the suite overview.

- [ ] **Step 1: Write the proof.** Under `legacy-v0`: an undated condition satisfies `includes_code`; an **undated lab** resolves `READY` for a scalar comparison, not `INDETERMINATE`; a **vital** resolves `READY`; a dated lab inside the window resolves; a future-dated fact is `NO_MATCH`.
  Under `v1`, **assert both halves separately** — the v1 draft claimed to prove undated-still-resolves *and* two-year-old-does-not but only asserted the second (review, smaller correction):
  ```ts
  it('v1: an undated lab still resolves', () => { /* expect READY */ });
  it('v1: a two-year-old lab falls outside QUARTER', () => { /* expect NO_MATCH */ });
  ```
- [ ] **Step 2: Run it. If any case fails, STOP and report** — the interval modeling is wrong and Plan 04 must not be written against it.
- [ ] **Step 3: Full suite** — expect 9 failed / 2 suites, passing count risen. Any third failing suite belongs to this plan.
- [ ] **Step 4: Typecheck.**
- [ ] **Step 5: Overview.** Record that 05 runs before 04 and why; update Plan 05's Produces with the real names; set Plan 04's Consumes to `01–03, 05`; add Plan 05b (fact persistence + REPLAY).
- [ ] **Step 6: Commit** with the measured suite numbers.

---

## Acceptance criteria

- [ ] A LIVE or REPLAY resolution **cannot** carry caller-supplied clinical facts — enforced by the type, not by a validation call.
- [ ] LIVE and REPLAY throw `NOT_IMPLEMENTED`-style errors naming the plan that will implement them.
- [ ] `clinicalState`, `recordValidity` and both dates are **parsed**; no `as` cast turns a string into a closed-union member.
- [ ] `endDate` produces a `KNOWN` end; an `INACTIVE` fact with no end gets `UNKNOWN`, never `OPEN`.
- [ ] A lab marked `recordValidity: 'INVALID'` reaches the kernel as invalid; a `clinicalState` on a lab is rejected.
- [ ] Adding a fact of one kind does not renumber any other kind's `factId`.
- [ ] Two occurrences of the same code on different dates, or with different source ids, both survive the merge; genuine duplicates still collapse.
- [ ] A `v1` pathway reading vitals can be started by supplying `encounterStart`, and fails with `MISSING_ENCOUNTER_ANCHOR` without it.
- [ ] Every new SDL field is optional; existing callers that send no mode still work.
- [ ] Undated conditions, undated labs and vitals all resolve `READY` under `legacy-v0`.
- [ ] Full suite fails only the two scorer suites; `tsc --noEmit` exits 0.
- [ ] The SYNTHETIC authorization check is documented as defence-in-depth, not access control.
