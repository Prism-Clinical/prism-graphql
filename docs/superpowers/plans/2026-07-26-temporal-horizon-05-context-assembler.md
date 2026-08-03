# Temporal Horizon Plan 05 — Input Contract, Trust Modes, Context Assembler

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the resolver's `PatientContext` input into a `NormalizedFact[]` fact store under an explicit trust mode, so the gate evaluator can be rewired onto `selectFacts` without changing what today's gates decide.

**Architecture:** Two pure modules. `trust-mode.ts` defines `ResolutionMode` (LIVE / SYNTHETIC / REPLAY) and enforces which caller-supplied fields each mode may carry — LIVE derives validity, state and clock server-side and *rejects* them on input. `context-assembler.ts` maps each `PatientContext` array into Plan 01's discriminated `NormalizedFact` union, assigns a deterministic `factId`, and models undated facts as `OPEN(evaluationAsOf)`. Nothing here is on the evaluation path yet; Plan 04 wires it in.

**Tech Stack:** TypeScript 5, Apollo Server 4, Jest + ts-jest.

## Why this plan runs BEFORE plan 04

The suite overview orders these 04 → 05. **That order is wrong and this plan supersedes it** (decision 2026-08-03, verified by probe).

Plan 04 rewires `evaluateGate` onto `selectFacts`. `selectFacts` maps a scalar operator over an uncertain fact to `INDETERMINATE`, which Plan 04 maps to fail-closed. Probing `overlap()` directly:

```
undated fact, modeled naively  + LIFETIME = UNKNOWN   ⇒ scalar INDETERMINATE ⇒ gate fails
undated fact, modeled naively  + QUARTER  = UNKNOWN
undated fact, as OPEN(asOf)    + LIFETIME = MATCH     ⇒ preserves today
undated fact, as OPEN(asOf)    + QUARTER  = MATCH
```

`PatientContext.vitalSigns` is a `Record<string, unknown>` bag carrying **no dates at all**, and `LabResult.date` is optional. So without the `OPEN(evaluationAsOf)` modeling that this plan owns, Plan 04 would make every vitals `greater_than`/`less_than` gate — and every undated lab gate — stop being satisfied, under `legacy-v0`, which is supposed to reproduce today. That violates the Global Constraint that plans 1–8 must not change live routing before the `v1` flip.

Plan 05's listed "Consumes 01–04" was nominal: the assembler needs the fact model (01) and the clock (02), and nothing from the evaluator.

## Global Constraints

- **Branch:** `feat/temporal-horizon-context-assembler`, worktree `/home/claude/workspace/features/feat-temporal-horizon-context-assembler/prism-graphql`, branched from `origin/main` at `8abfda4` (PR #51 — plan 03 — merged).
- **All commands run from the worktree root.** Never chain `cd` with `&&`.
- **Typecheck:** `./node_modules/.bin/tsc -p apps/pathway-service/tsconfig.json --noEmit`. No `typecheck` script, no `apps/pathway-service/node_modules`, and bare `npx tsc` hits a decoy package.
- **Tests:** `npm test --prefix apps/pathway-service -- --runInBand <path>`. `testRegex` is `/__tests__/.*.test.ts` — a file placed anywhere else is silently not run.
- **`tsconfig` is NOT full strict** (`noImplicitAny` + `noImplicitReturns` only) and **excludes `src/__tests__`**. A required parameter enforces nothing against a test caller and nothing at runtime; invariants need a runtime throw *and* a test that fails without it.
- **Suite baseline: 9 failures across 2 suites** (`data-completeness-scorer`, `patient-match-scorer`), measured on `main` at `8abfda4` — **805 passed / 9 failed**. Measure the baseline on `main`, never on a copy of this branch.
- **No live behavior change.** This plan adds modules and additive schema fields; nothing it produces reaches the evaluator until Plan 04.
- **Commit prefixes** `feat:`/`fix:`/`test:`/`refactor:`/`docs:`; no `@anthropic.com`/`@claude.com`; end every message with
  `Co-Authored-By: Claude Opus 5 (1M context) <noreply@example.com>`

## Decisions this plan locks

1. **Undated ⇒ `OPEN(evaluationAsOf)`, not `UNKNOWN` end.** An undated entry in the resolver's input means "asserted current as of now" — that is what the encounter simulator is expressing when it composes a vitals bag. Modeling it as an unknown end would silently fail-close every scalar gate over it. Recorded on the fact as `stateBasis`/provenance so evidence can show the assumption.
2. **`vitals` are always undated by construction.** The bag has no date field anywhere in the input schema, so every vital gets `OPEN(evaluationAsOf)`. This is the single biggest behavior-preservation dependency in the suite.
3. **`factId` is assigned, never a lossy hash of content.** Plan 01's review found a content hash collided for same-code/same-date facts and broke `count_in_window`. The assembler assigns `<kind>:<ordinal>` within a run, deterministic for a given input ordering, and carries any source identifier in `provenance.sourceId`.
4. **LIVE rejects caller-supplied validity/state/clock; SYNTHETIC accepts them.** v1 is effectively SYNTHETIC-only (all `snapshot_*` tables are empty), but LIVE is defined now so it is safe by construction when Plan 07 wires the snapshot mapper.
5. **Extended `CodeInput` fields are additive and SYNTHETIC-only.** Adding them cannot change any existing query, and supplying them under LIVE is an error rather than a silent ignore.

## Deliberately out of scope

- **Wiring the assembler into `evaluateGate`/reachability** — Plan 04. This plan ships pure modules plus schema; it is a leaf, exactly as Plan 01 was.
- **The snapshot mapper** (`snapshot-context.ts` → `NormalizedFact[]`) — Plan 07.
- **Consumer projections** (`actionableMedications`, scorer projections) — design §8 assigns them here, but they only matter once the widened store feeds consumers, which is Plan 04's wiring. Deferred with the wiring so this plan stays a leaf.

---

### Task 1: Trust modes

**Files:**
- Create: `apps/pathway-service/src/services/resolution/temporal/trust-mode.ts`
- Test: `apps/pathway-service/src/__tests__/temporal/trust-mode.test.ts`

**Interfaces:**
- Consumes: `TemporalContextError` from `./evaluation-context`.
- Produces: `ResolutionMode`, `ResolutionModeKind`, `SyntheticFactInput`, `assertModeAllows(mode, input, where)`.

- [ ] **Step 1: Write the failing test**

```ts
import {
  assertModeAllows,
  ResolutionMode,
} from '../../services/resolution/temporal/trust-mode';
import { TemporalContextError } from '../../services/resolution/temporal/evaluation-context';

const LIVE: ResolutionMode = { mode: 'LIVE', snapshotId: 'snap-1' };
const SYNTHETIC: ResolutionMode = { mode: 'SYNTHETIC' };
const REPLAY: ResolutionMode = { mode: 'REPLAY', sessionId: 'sess-1' };

describe('assertModeAllows', () => {
  it('lets plain code/system/display through in every mode', () => {
    for (const mode of [LIVE, SYNTHETIC, REPLAY]) {
      expect(() =>
        assertModeAllows(mode, { code: 'E11.9', system: 'icd10', display: 'T2DM' }, 'conditions[0]'),
      ).not.toThrow();
    }
  });

  it('rejects caller-supplied clinical state under LIVE', () => {
    expect(() =>
      assertModeAllows(LIVE, { code: 'E11.9', system: 'icd10', clinicalState: 'ACTIVE' }, 'conditions[0]'),
    ).toThrow(TemporalContextError);
  });

  it('rejects caller-supplied record validity under LIVE', () => {
    expect(() =>
      assertModeAllows(LIVE, { code: 'E11.9', system: 'icd10', recordValidity: 'VALID' }, 'conditions[0]'),
    ).toThrow(/recordValidity/);
  });

  it('names the offending field AND the path — this surfaces to an API caller', () => {
    try {
      assertModeAllows(LIVE, { code: 'x', system: 'y', clinicalState: 'ACTIVE' }, 'medications[2]');
      throw new Error('expected a throw');
    } catch (e) {
      expect((e as Error).message).toContain('medications[2]');
      expect((e as Error).message).toContain('clinicalState');
    }
  });

  it('reports every offending field at once, not just the first', () => {
    try {
      assertModeAllows(
        LIVE,
        { code: 'x', system: 'y', clinicalState: 'ACTIVE', recordValidity: 'VALID', date: '2026-01-01' },
        'conditions[0]',
      );
      throw new Error('expected a throw');
    } catch (e) {
      const msg = (e as Error).message;
      expect(msg).toContain('clinicalState');
      expect(msg).toContain('recordValidity');
      expect(msg).toContain('date');
    }
  });

  it('accepts all of them under SYNTHETIC', () => {
    expect(() =>
      assertModeAllows(
        SYNTHETIC,
        {
          code: 'x',
          system: 'y',
          date: '2026-01-01',
          clinicalState: 'INACTIVE',
          recordValidity: 'UNKNOWN',
          sourceId: 'sim-1',
        },
        'conditions[0]',
      ),
    ).not.toThrow();
  });

  it('rejects them under REPLAY — a replay re-reads facts, it does not accept new ones', () => {
    expect(() =>
      assertModeAllows(REPLAY, { code: 'x', system: 'y', clinicalState: 'ACTIVE' }, 'conditions[0]'),
    ).toThrow(TemporalContextError);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails** — `Cannot find module '.../trust-mode'`.

- [ ] **Step 3: Implement**

```ts
import { TemporalContextError } from './evaluation-context';

export type ResolutionModeKind = 'LIVE' | 'SYNTHETIC' | 'REPLAY';

/**
 * Exactly one mode per resolution, always explicit — never inferred from
 * whether an optional `patientContext` happens to be present (design §8, P1-4).
 */
export type ResolutionMode =
  | { mode: 'LIVE'; snapshotId: string }
  | { mode: 'SYNTHETIC' }
  | { mode: 'REPLAY'; sessionId: string };

/** The fields only an authorized SYNTHETIC caller may supply. */
export interface SyntheticFactInput {
  code: string;
  system: string;
  display?: string;
  date?: string;
  endDate?: string;
  clinicalState?: string;
  recordValidity?: string;
  sourceId?: string;
}

/** Everything beyond code/system/display is server-derived outside SYNTHETIC. */
const TRUSTED_ONLY_FIELDS = [
  'date',
  'endDate',
  'clinicalState',
  'recordValidity',
  'sourceId',
] as const;

/**
 * Reject caller-supplied fields the mode does not permit.
 *
 * Under LIVE the server derives `recordValidity` and `clinicalState` from the
 * source record and stamps the clock itself; accepting them from the caller
 * would let a client bypass the validity filter or spoof the clinical clock.
 * REPLAY re-reads persisted facts, so it accepts none of them either.
 *
 * Reports EVERY offending field, not just the first — an API caller fixing a
 * request wants the whole list in one response.
 */
export function assertModeAllows(
  mode: ResolutionMode,
  input: Record<string, unknown>,
  where: string,
): void {
  if (mode.mode === 'SYNTHETIC') return;

  const offending = TRUSTED_ONLY_FIELDS.filter((f) => input[f] !== undefined);
  if (offending.length === 0) return;

  throw new TemporalContextError(
    `${where}: ${offending.join(', ')} may only be supplied in SYNTHETIC mode ` +
      `(this resolution is ${mode.mode}; the server derives these)`,
    'INVALID_TEMPORAL_DEFAULTS',
  );
}
```

- [ ] **Step 4: Run the test** — expect PASS, 7 tests.
- [ ] **Step 5: Typecheck** — `./node_modules/.bin/tsc -p apps/pathway-service/tsconfig.json --noEmit`, exit 0.
- [ ] **Step 6: Commit**

```bash
git add apps/pathway-service/src/services/resolution/temporal/trust-mode.ts apps/pathway-service/src/__tests__/temporal/trust-mode.test.ts
git commit -m "feat: explicit resolution trust modes

One mode per resolution, always explicit — never inferred from whether
an optional patientContext is present (design §8, P1-4). LIVE derives
validity, state and the clock server-side and rejects them on input,
closing the 'caller bypasses the validity filter or spoofs the clinical
clock' hole. REPLAY re-reads persisted facts and accepts none either.

Every offending field is reported at once: a caller fixing a request
wants the whole list, not one field per round trip.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@example.com>"
```

---

### Task 2: Assemble stateful facts (conditions, medications, allergies)

**Files:**
- Create: `apps/pathway-service/src/services/resolution/temporal/context-assembler.ts`
- Test: `apps/pathway-service/src/__tests__/temporal/context-assembler-stateful.test.ts`

**Interfaces:**
- Consumes: `NormalizedFact`, `StatefulFact`, `TemporalBound`, `TemporalEnd` from `./fact-model`; `parseFhirDate` from `./interval`; `EvaluationTemporalContext` from `./evaluation-context`; Task 1's `ResolutionMode`, `assertModeAllows`; `PatientContext`, `CodeEntry` from `../../confidence/types`.
- Produces: `assembleContext(mode, patientContext, ctx) → FactStore` (stateful kinds in this task; observations added in Task 3).

**The behavior-preservation rules this task encodes** (design §3, and they must not drift):

| Input | `clinicalState` | `stateBasis` | `recordValidity` |
|---|---|---|---|
| no status supplied (all current input) | `ACTIVE` | `MISSING_STATUS_FAIL_OPEN` | `VALID` |
| SYNTHETIC `clinicalState: 'INACTIVE'` | `INACTIVE` | `SYNTHETIC` | `VALID` |
| SYNTHETIC `recordValidity: 'INVALID'` | as above | as above | `INVALID` |

Today's `PatientContext` carries no status at all, so **every** fact from the live path takes row 1 — `ACTIVE` with `MISSING_STATUS_FAIL_OPEN`. That is what preserves today's fail-safe, and `stateUnverified` in the evidence is how the doubt still surfaces.

- [ ] **Step 1: Write the failing test**

```ts
import { assembleContext } from '../../services/resolution/temporal/context-assembler';
import { ResolutionMode } from '../../services/resolution/temporal/trust-mode';
import { EvaluationTemporalContext } from '../../services/resolution/temporal/evaluation-context';
import { PatientContext } from '../../services/confidence/types';
import { isStatefulFact } from '../../services/resolution/temporal/fact-model';

const AS_OF = '2026-08-03T12:00:00.000Z';
const ctx: EvaluationTemporalContext = {
  evaluationAsOf: AS_OF,
  timezone: 'UTC',
  temporalPolicyVersion: 'legacy-v0',
};
const SYNTHETIC: ResolutionMode = { mode: 'SYNTHETIC' };

function pc(over: Partial<PatientContext> = {}): PatientContext {
  return {
    patientId: 'pat-1',
    conditionCodes: [],
    medications: [],
    labResults: [],
    allergies: [],
    ...over,
  };
}

describe('assembleContext — stateful kinds', () => {
  it('maps each array to its fact kind', () => {
    const store = assembleContext(SYNTHETIC, pc({
      conditionCodes: [{ code: 'E11.9', system: 'icd10' }],
      medications: [{ code: '860975', system: 'rxnorm' }],
      allergies: [{ code: '7980', system: 'rxnorm' }],
    }), ctx);
    expect(store.map((f) => f.kind).sort()).toEqual(['allergy', 'condition', 'medication_order']);
  });

  it('preserves today: no supplied status means ACTIVE by failing open', () => {
    const [fact] = assembleContext(SYNTHETIC, pc({
      conditionCodes: [{ code: 'E11.9', system: 'icd10' }],
    }), ctx);
    expect(isStatefulFact(fact)).toBe(true);
    if (!isStatefulFact(fact)) throw new Error('expected a stateful fact');
    expect(fact.clinicalState).toBe('ACTIVE');
    expect(fact.stateBasis).toBe('MISSING_STATUS_FAIL_OPEN');
    expect(fact.recordValidity).toBe('VALID');
  });

  it('models an undated fact as OPEN at the pinned clock, never an UNKNOWN end', () => {
    // The single most important rule in this plan: an UNKNOWN end makes
    // overlap() return UNKNOWN even under LIFETIME, which fails scalar gates
    // closed once plan 04 lands.
    const [fact] = assembleContext(SYNTHETIC, pc({
      conditionCodes: [{ code: 'E11.9', system: 'icd10' }],
    }), ctx);
    expect(fact.interval.start).toBeUndefined();
    expect(fact.interval.end).toEqual({ kind: 'OPEN', assertedCurrentAt: AS_OF });
  });

  it('parses a supplied date into a precision-carrying start bound', () => {
    const [fact] = assembleContext(SYNTHETIC, pc({
      conditionCodes: [{ code: 'E11.9', system: 'icd10', date: '2026-01-15' }],
    }), ctx);
    expect(fact.interval.start).toEqual({ value: '2026-01-15', precision: 'day' });
  });

  it('rejects an unparseable date rather than silently dropping it', () => {
    expect(() =>
      assembleContext(SYNTHETIC, pc({
        conditionCodes: [{ code: 'E11.9', system: 'icd10', date: 'last tuesday' }],
      }), ctx),
    ).toThrow(/conditions\[0\]/);
  });

  it('assigns a unique factId per fact, never a content hash', () => {
    // Two identical codes on the same date are a real clinical pattern
    // (recurrence) and count_in_window counts DISTINCT factIds — a content
    // hash collided here and broke the count.
    const store = assembleContext(SYNTHETIC, pc({
      conditionCodes: [
        { code: 'N39.0', system: 'icd10', date: '2026-01-15' },
        { code: 'N39.0', system: 'icd10', date: '2026-01-15' },
      ],
    }), ctx);
    expect(store).toHaveLength(2);
    expect(new Set(store.map((f) => f.factId)).size).toBe(2);
  });

  it('is deterministic for a given input ordering', () => {
    const input = pc({ conditionCodes: [{ code: 'E11.9', system: 'icd10' }] });
    const a = assembleContext(SYNTHETIC, input, ctx);
    const b = assembleContext(SYNTHETIC, input, ctx);
    expect(a.map((f) => f.factId)).toEqual(b.map((f) => f.factId));
  });

  it('records provenance so evidence can show where a fact came from', () => {
    const [fact] = assembleContext(SYNTHETIC, pc({
      conditionCodes: [{ code: 'E11.9', system: 'icd10' }],
    }), ctx);
    expect(fact.provenance.sourceType).toBe('SYNTHETIC');
  });

  it('enforces the trust mode on every entry, not just the first', () => {
    const LIVE: ResolutionMode = { mode: 'LIVE', snapshotId: 'snap-1' };
    expect(() =>
      assembleContext(LIVE, pc({
        conditionCodes: [
          { code: 'E11.9', system: 'icd10' },
          { code: 'I10', system: 'icd10', date: '2026-01-01' },
        ],
      }), ctx),
    ).toThrow(/conditions\[1\]/);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails.**

- [ ] **Step 3: Implement** (observation kinds are added in Task 3 — this task returns stateful facts only)

```ts
import { PatientContext, CodeEntry } from '../../confidence/types';
import {
  NormalizedFact,
  StatefulFact,
  FactStore,
  TemporalBound,
  TemporalEnd,
} from './fact-model';
import { parseFhirDate } from './interval';
import { EvaluationTemporalContext, TemporalContextError } from './evaluation-context';
import { ResolutionMode, assertModeAllows } from './trust-mode';

/**
 * An entry with no date is "asserted current as of the evaluation clock" —
 * which is exactly what the encounter simulator means when it composes a
 * context without dates.
 *
 * It must NOT become `{ kind: 'UNKNOWN' }`. An unknown end makes `overlap()`
 * return UNKNOWN even against a LIFETIME horizon, and `selectFacts` turns an
 * uncertain scalar into INDETERMINATE — so once plan 04 maps INDETERMINATE to
 * fail-closed, every undated lab and every vital (the vitals bag has no date
 * field at all) would stop satisfying the gate it satisfies today.
 */
function openAt(ctx: EvaluationTemporalContext): TemporalEnd {
  return { kind: 'OPEN', assertedCurrentAt: ctx.evaluationAsOf };
}

function parseStart(raw: string | undefined, where: string): TemporalBound | undefined {
  if (raw === undefined) return undefined;
  const bound = parseFhirDate(raw);
  if (!bound) {
    throw new TemporalContextError(
      `${where}: "${raw}" is not a valid FHIR date`,
      'INVALID_TEMPORAL_DEFAULTS',
    );
  }
  return bound;
}

function statefulFrom(
  entry: CodeEntry & Record<string, unknown>,
  kind: StatefulFact['kind'],
  factId: string,
  ctx: EvaluationTemporalContext,
  where: string,
): StatefulFact {
  const start = parseStart(entry.date, where);
  const suppliedState = entry.clinicalState as StatefulFact['clinicalState'] | undefined;
  const suppliedValidity = entry.recordValidity as StatefulFact['recordValidity'] | undefined;

  const fact: StatefulFact = {
    factId,
    kind,
    code: entry.code,
    system: entry.system,
    interval: { end: openAt(ctx) },
    // No status in the input means ACTIVE by failing open — this is what
    // preserves today's fail-safe. The doubt is not lost: stateBasis marks it
    // and selectFacts surfaces it as stateUnverified.
    clinicalState: suppliedState ?? 'ACTIVE',
    stateBasis: suppliedState ? 'SYNTHETIC' : 'MISSING_STATUS_FAIL_OPEN',
    recordValidity: suppliedValidity ?? 'VALID',
    validityBasis: suppliedValidity ? 'SYNTHETIC' : 'ASSUMED_VALID_NO_SOURCE_STATUS',
    provenance: { sourceType: 'SYNTHETIC' },
  };
  if (entry.display !== undefined) fact.display = entry.display;
  if (start) fact.interval.start = start;
  if (typeof entry.sourceId === 'string') fact.provenance.sourceId = entry.sourceId;
  return fact;
}

/**
 * Build the fact store the gate kernel consumes.
 *
 * `factId` is ASSIGNED here, never hashed from content: two identical codes on
 * the same date are a real clinical pattern (recurrence), `count_in_window`
 * counts distinct factIds, and a content hash collided on exactly that case.
 * Ordinals are stable for a given input ordering, which is what replay needs.
 */
export function assembleContext(
  mode: ResolutionMode,
  patientContext: PatientContext,
  ctx: EvaluationTemporalContext,
): FactStore {
  const out: NormalizedFact[] = [];
  let ordinal = 0;

  const addStateful = (
    entries: readonly CodeEntry[] | undefined,
    kind: StatefulFact['kind'],
    label: string,
  ): void => {
    (entries ?? []).forEach((entry, i) => {
      const where = `${label}[${i}]`;
      assertModeAllows(mode, entry as unknown as Record<string, unknown>, where);
      out.push(
        statefulFrom(entry as CodeEntry & Record<string, unknown>, kind, `${kind}:${ordinal++}`, ctx, where),
      );
    });
  };

  addStateful(patientContext.conditionCodes, 'condition', 'conditions');
  addStateful(patientContext.medications, 'medication_order', 'medications');
  addStateful(patientContext.allergies, 'allergy', 'allergies');

  return out;
}
```

`validityBasis` is a free-form `string` on `FactBase` (`fact-model.ts:20`), not a closed union — `ASSUMED_VALID_NO_SOURCE_STATUS` is a new value and needs no type change. `stateBasis` **is** a closed union (`StateBasis`, `fact-model.ts:32`); `SYNTHETIC` and `MISSING_STATUS_FAIL_OPEN` are both existing members, so it needs no change either.

- [ ] **Step 4: Run the test** — expect PASS, 9 tests.
- [ ] **Step 5: Typecheck** — exit 0.
- [ ] **Step 6: Commit**

```bash
git add apps/pathway-service/src/services/resolution/temporal/context-assembler.ts apps/pathway-service/src/__tests__/temporal/context-assembler-stateful.test.ts
git commit -m "feat: assemble conditions, medications and allergies into facts

An entry with no date becomes OPEN(evaluationAsOf), not an UNKNOWN end.
This is the load-bearing rule of the plan: an UNKNOWN end makes overlap()
return UNKNOWN even against LIFETIME, and selectFacts turns an uncertain
scalar into INDETERMINATE — so with plan 04's fail-closed mapping every
undated fact would stop satisfying the gate it satisfies today.

No supplied status means ACTIVE via MISSING_STATUS_FAIL_OPEN, preserving
today's fail-safe; the doubt survives as stateUnverified in evidence.

factId is assigned, never hashed from content: two identical codes on one
date are recurrence, count_in_window counts distinct ids, and a content
hash collided on exactly that case during plan 01.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@example.com>"
```

---

### Task 3: Assemble observations (labs and vitals)

**Files:**
- Modify: `apps/pathway-service/src/services/resolution/temporal/context-assembler.ts`
- Test: `apps/pathway-service/src/__tests__/temporal/context-assembler-observations.test.ts`

**Interfaces:**
- Consumes: Task 2's internals; `ObservationFact` from `./fact-model`; `LabResult` from `../../confidence/types`.
- Produces: labs and vitals in the same `assembleContext` return.

Vitals need a shape decision the other kinds do not. `vitalSigns` is `Record<string, unknown>` where fixed vitals live at the root (`systolic_bp`, `heart_rate`) and custom ones nest under `custom.<key>` — the existing evaluator resolves either with a single string key (`gate-evaluator.ts`, `getNumericValue`). The assembler must produce one `ObservationFact` per numeric leaf, keyed the same way, or vitals gates silently find nothing.

- [ ] **Step 1: Write the failing test**

```ts
import { assembleContext } from '../../services/resolution/temporal/context-assembler';
import { ResolutionMode } from '../../services/resolution/temporal/trust-mode';
import { EvaluationTemporalContext } from '../../services/resolution/temporal/evaluation-context';
import { PatientContext } from '../../services/confidence/types';
import { isObservationFact } from '../../services/resolution/temporal/fact-model';

const AS_OF = '2026-08-03T12:00:00.000Z';
const ctx: EvaluationTemporalContext = {
  evaluationAsOf: AS_OF,
  timezone: 'UTC',
  temporalPolicyVersion: 'legacy-v0',
};
const SYNTHETIC: ResolutionMode = { mode: 'SYNTHETIC' };

function pc(over: Partial<PatientContext> = {}): PatientContext {
  return { patientId: 'p', conditionCodes: [], medications: [], labResults: [], allergies: [], ...over };
}

describe('assembleContext — labs', () => {
  it('carries the numeric value and unit onto the fact', () => {
    const [fact] = assembleContext(SYNTHETIC, pc({
      labResults: [{ code: '4548-4', system: 'loinc', value: 9.1, unit: '%', date: '2026-06-01' }],
    }), ctx);
    expect(isObservationFact(fact)).toBe(true);
    if (!isObservationFact(fact)) throw new Error('expected an observation');
    expect(fact.kind).toBe('lab');
    expect(fact.value).toBe(9.1);
    expect(fact.unit).toBe('%');
  });

  it('models a DATED lab as a point fact — start and end at the same bound', () => {
    const [fact] = assembleContext(SYNTHETIC, pc({
      labResults: [{ code: '4548-4', system: 'loinc', value: 9.1, date: '2026-06-01' }],
    }), ctx);
    expect(fact.interval.start).toEqual({ value: '2026-06-01', precision: 'day' });
    expect(fact.interval.end).toEqual({ kind: 'KNOWN', bound: { value: '2026-06-01', precision: 'day' } });
  });

  it('models an UNDATED lab as OPEN at the clock, preserving today', () => {
    const [fact] = assembleContext(SYNTHETIC, pc({
      labResults: [{ code: '4548-4', system: 'loinc', value: 9.1 }],
    }), ctx);
    expect(fact.interval.start).toBeUndefined();
    expect(fact.interval.end).toEqual({ kind: 'OPEN', assertedCurrentAt: AS_OF });
  });

  it('keeps a lab with no value — exists/includes_code still need the bucket', () => {
    const store = assembleContext(SYNTHETIC, pc({
      labResults: [{ code: '4548-4', system: 'loinc' }],
    }), ctx);
    expect(store).toHaveLength(1);
    if (!isObservationFact(store[0])) throw new Error('expected an observation');
    expect(store[0].value).toBeUndefined();
  });
});

describe('assembleContext — vitals', () => {
  it('emits one fact per numeric root key, coded by that key', () => {
    const store = assembleContext(SYNTHETIC, pc({
      vitalSigns: { systolic_bp: 148, heart_rate: 88 },
    }), ctx);
    expect(store).toHaveLength(2);
    expect(store.map((f) => f.code).sort()).toEqual(['heart_rate', 'systolic_bp']);
  });

  it('flattens custom.<key> to the same dotted key the evaluator looks up', () => {
    const store = assembleContext(SYNTHETIC, pc({
      vitalSigns: { custom: { peak_flow: 320 } },
    }), ctx);
    expect(store.map((f) => f.code)).toEqual(['custom.peak_flow']);
  });

  it('is ALWAYS OPEN at the clock — the vitals bag carries no dates anywhere', () => {
    const [fact] = assembleContext(SYNTHETIC, pc({ vitalSigns: { systolic_bp: 148 } }), ctx);
    expect(fact.interval.start).toBeUndefined();
    expect(fact.interval.end).toEqual({ kind: 'OPEN', assertedCurrentAt: AS_OF });
  });

  it('skips non-numeric entries rather than emitting a valueless vital', () => {
    const store = assembleContext(SYNTHETIC, pc({
      vitalSigns: { systolic_bp: 148, comment: 'patient anxious', bp_cuff: null },
    }), ctx);
    expect(store.map((f) => f.code)).toEqual(['systolic_bp']);
  });

  it('gives every observation NOT_APPLICABLE state by carrying no clinical state', () => {
    const [fact] = assembleContext(SYNTHETIC, pc({ vitalSigns: { systolic_bp: 148 } }), ctx);
    expect('clinicalState' in fact).toBe(false);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails.**

- [ ] **Step 3: Implement** — add to `context-assembler.ts` and call both from `assembleContext` after the stateful kinds:

```ts
/**
 * A DATED observation is a point fact: start and end at the same bound, which
 * is what `overlap()` recognises as a point and matches strictly inside the
 * horizon. An UNDATED one takes the OPEN(clock) rule like everything else.
 */
function observationInterval(
  start: TemporalBound | undefined,
  ctx: EvaluationTemporalContext,
): NormalizedFact['interval'] {
  if (!start) return { end: openAt(ctx) };
  return { start, end: { kind: 'KNOWN', bound: start } };
}

/**
 * Flatten the vitals bag to the keys the evaluator already resolves: fixed
 * vitals at the root, custom ones as `custom.<key>`. Anything non-numeric is
 * skipped — a valueless vital would sit in the store as a candidate that no
 * scalar operator can use.
 */
function flattenVitals(bag: Record<string, unknown>): Array<{ key: string; value: number }> {
  const out: Array<{ key: string; value: number }> = [];
  for (const [key, raw] of Object.entries(bag)) {
    if (key === 'custom' && raw !== null && typeof raw === 'object') {
      for (const [ck, cv] of Object.entries(raw as Record<string, unknown>)) {
        if (typeof cv === 'number' && Number.isFinite(cv)) out.push({ key: `custom.${ck}`, value: cv });
      }
      continue;
    }
    if (typeof raw === 'number' && Number.isFinite(raw)) out.push({ key, value: raw });
  }
  return out;
}
```

Inside `assembleContext`, after the stateful kinds:

```ts
  (patientContext.labResults ?? []).forEach((lab, i) => {
    const where = `labs[${i}]`;
    assertModeAllows(mode, lab as unknown as Record<string, unknown>, where);
    const start = parseStart(lab.date, where);
    const fact: ObservationFact = {
      factId: `lab:${ordinal++}`,
      kind: 'lab',
      code: lab.code,
      system: lab.system,
      interval: observationInterval(start, ctx),
      recordValidity: 'VALID',
      validityBasis: 'ASSUMED_VALID_NO_SOURCE_STATUS',
      provenance: { sourceType: 'SYNTHETIC' },
    };
    if (lab.display !== undefined) fact.display = lab.display;
    if (typeof lab.value === 'number') fact.value = lab.value;
    if (lab.unit !== undefined) fact.unit = lab.unit;
    out.push(fact);
  });

  // Vitals carry no dates anywhere in the input schema, so every one of them
  // takes the OPEN(clock) rule. This is the case that would break loudest
  // without it — every vitals scalar gate fails closed.
  for (const { key, value } of flattenVitals(patientContext.vitalSigns ?? {})) {
    out.push({
      factId: `vital:${ordinal++}`,
      kind: 'vital',
      code: key,
      // The bag is keyed by name, not by a terminology. Plan 07 maps real
      // LOINC-coded vitals from the snapshot; the simulator's bag is local.
      system: 'urn:prism:vitals',
      interval: { end: openAt(ctx) },
      value,
      recordValidity: 'VALID',
      validityBasis: 'ASSUMED_VALID_NO_SOURCE_STATUS',
      provenance: { sourceType: 'SYNTHETIC' },
    });
  }
```

- [ ] **Step 4: Run the test** — expect PASS, 10 tests.
- [ ] **Step 5: Run the whole temporal directory** — plans 01–03 must be untouched.
- [ ] **Step 6: Typecheck** — exit 0.
- [ ] **Step 7: Commit**

```bash
git add apps/pathway-service/src/services/resolution/temporal/context-assembler.ts apps/pathway-service/src/__tests__/temporal/context-assembler-observations.test.ts
git commit -m "feat: assemble labs and vitals into observation facts

A dated observation is a point fact (start == end), which overlap()
matches strictly inside the horizon. An undated one takes the OPEN(clock)
rule.

Vitals are the reason this plan runs before plan 04: the bag carries no
date field anywhere in the input schema, so every vital is undated by
construction and every vitals scalar gate would fail closed without the
OPEN(clock) rule. They are flattened to the same keys the evaluator
already resolves — fixed at the root, custom as custom.<key> — because a
different key means the gate silently finds nothing.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@example.com>"
```

---

### Task 4: Extend `CodeInput` with the SYNTHETIC-only fields

**Files:**
- Modify: `apps/pathway-service/schema.graphql` (`CodeInput` at ~1130, `LabResultInput` at ~1136)
- Modify: `apps/pathway-service/src/resolvers/mutations/resolution.ts` (the inline arg types at ~46 and ~79)
- Test: `apps/pathway-service/src/__tests__/temporal/synthetic-input-contract.test.ts`

**Interfaces:**
- Produces: `date`, `endDate`, `clinicalState`, `recordValidity`, `sourceId` on `CodeInput`; `clinicalState`/`recordValidity`/`sourceId` on `LabResultInput`.

Every field is **optional and additive** — no existing query changes shape. `LabResultInput` already has `date`.

- [ ] **Step 1: Write the failing test** — assert the SDL exposes the fields, so a schema edit that misses one is caught:

```ts
import { readFileSync } from 'fs';
import { join } from 'path';

const sdl = readFileSync(join(__dirname, '../../../schema.graphql'), 'utf-8');

function inputBlock(name: string): string {
  const start = sdl.indexOf(`input ${name} {`);
  if (start === -1) throw new Error(`no input ${name} in the SDL`);
  return sdl.slice(start, sdl.indexOf('}', start));
}

describe('SYNTHETIC input contract', () => {
  it('CodeInput carries the trusted-only fields', () => {
    const block = inputBlock('CodeInput');
    for (const field of ['date', 'endDate', 'clinicalState', 'recordValidity', 'sourceId']) {
      expect(block).toContain(field);
    }
  });

  it('keeps every trusted-only field OPTIONAL — additive, so no existing query breaks', () => {
    const block = inputBlock('CodeInput');
    for (const line of block.split('\n')) {
      const m = line.match(/^\s*(date|endDate|clinicalState|recordValidity|sourceId):\s*(\S+)/);
      if (m) expect(m[2]).not.toContain('!');
    }
  });

  it('leaves code and system required', () => {
    const block = inputBlock('CodeInput');
    expect(block).toMatch(/code:\s*String!/);
    expect(block).toMatch(/system:\s*String!/);
  });

  it('LabResultInput carries validity and provenance too', () => {
    const block = inputBlock('LabResultInput');
    for (const field of ['clinicalState', 'recordValidity', 'sourceId']) {
      expect(block).toContain(field);
    }
  });
});
```

- [ ] **Step 2: Run it and confirm it fails** on the missing fields.

- [ ] **Step 3: Edit the SDL**

```graphql
input CodeInput {
  code: String!
  system: String!
  display: String
  """
  SYNTHETIC-only. Rejected under LIVE and REPLAY, where the server derives
  these from the source record — see ResolutionMode (design §8).
  """
  date: String
  endDate: String
  clinicalState: String
  recordValidity: String
  sourceId: String
}
```

Add `clinicalState`, `recordValidity` and `sourceId` to `LabResultInput` the same way; it already has `date`.

- [ ] **Step 4: Widen the resolver's inline arg types** in `resolution.ts` so the new fields survive to the assembler. The `CodeInput`-shaped literals appear twice (~46 and ~79). Extend **both** — TypeScript will not warn that one was missed, because dropping a field is a silent narrowing, not an error:

```ts
        conditionCodes?: Array<{
          code: string;
          system: string;
          display?: string;
          // SYNTHETIC-only; assertModeAllows rejects them under LIVE/REPLAY.
          date?: string;
          endDate?: string;
          clinicalState?: string;
          recordValidity?: string;
          sourceId?: string;
        }>;
```

Apply the same five fields to the `medications` and `allergies` literals, and add `clinicalState`/`recordValidity`/`sourceId` to the `labResults` literal (it already declares `date`).

- [ ] **Step 5: Run the test** — expect PASS, 4 tests.
- [ ] **Step 6: Typecheck** — exit 0.
- [ ] **Step 7: Regenerate types if the build does so** — `npm run build --prefix apps/pathway-service` runs `graphql-codegen` before `tsc`. Run it and confirm it succeeds; commit any regenerated output it produces under `src/__generated__/`.
- [ ] **Step 8: Commit**

```bash
git add apps/pathway-service/schema.graphql apps/pathway-service/src/resolvers/mutations/resolution.ts apps/pathway-service/src/__tests__/temporal/synthetic-input-contract.test.ts
git commit -m "feat: SYNTHETIC-only fields on the coded input types

date, endDate, clinicalState, recordValidity and sourceId are how an
authorized simulator expresses a fact the server cannot derive — all
optional and additive, so no existing query changes shape, and all
rejected under LIVE and REPLAY by assertModeAllows.

The test reads the SDL directly: a schema edit that misses a field, or
makes one required, fails rather than surfacing as a runtime shape
mismatch later.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@example.com>"
```

---

### Task 5: Behavior-preservation proof against the kernel

**Files:**
- Test: `apps/pathway-service/src/__tests__/temporal/assembler-preserves-today.test.ts`

This task adds no production code. It exists because the whole plan is a bet — that assembling today's `PatientContext` and running it through `selectFacts` under `legacy-v0` selects the same facts today's evaluator does. If that bet is wrong, Plan 04 cannot land, and it is far cheaper to learn it here.

- [ ] **Step 1: Write the test**

```ts
import { assembleContext } from '../../services/resolution/temporal/context-assembler';
import { selectFacts } from '../../services/resolution/temporal/select-facts';
import { resolveEffectivePolicy, toEffectivePolicy } from '../../services/resolution/temporal/cascade';
import { EvaluationTemporalContext } from '../../services/resolution/temporal/evaluation-context';
import { ResolutionMode } from '../../services/resolution/temporal/trust-mode';
import { PatientContext } from '../../services/confidence/types';

const AS_OF = '2026-08-03T12:00:00.000Z';
const ctx: EvaluationTemporalContext = {
  evaluationAsOf: AS_OF,
  timezone: 'UTC',
  temporalPolicyVersion: 'legacy-v0',
};
const SYNTHETIC: ResolutionMode = { mode: 'SYNTHETIC' };

function pc(over: Partial<PatientContext> = {}): PatientContext {
  return { patientId: 'p', conditionCodes: [], medications: [], labResults: [], allergies: [], ...over };
}

function run(patientContext: PatientContext, field: string, operator: string, value: string) {
  const store = assembleContext(SYNTHETIC, patientContext, ctx);
  const tier = resolveEffectivePolicy(field as never, 'legacy-v0', {});
  const policy = toEffectivePolicy(tier, ctx);
  return selectFacts({ field, operator, value } as never, store, policy);
}

describe('legacy-v0 through the kernel reproduces today', () => {
  it('an UNDATED condition still satisfies includes_code', () => {
    const out = run(pc({ conditionCodes: [{ code: 'E11.9', system: 'icd10' }] }), 'conditions', 'includes_code', 'E11.9');
    expect(out.status).toBe('READY');
  });

  it('an UNDATED lab still resolves for a scalar comparison — NOT indeterminate', () => {
    // This is the assertion the whole plan ordering exists for. If the
    // assembler ever stops modelling undated facts as OPEN(clock), this goes
    // INDETERMINATE and plan 04's fail-closed mapping silently breaks every
    // undated lab gate.
    const out = run(pc({ labResults: [{ code: '4548-4', system: 'loinc', value: 9.1 }] }), 'labs', 'greater_than', '4548-4');
    expect(out.status).toBe('READY');
    if (out.status !== 'READY') throw new Error('unreachable');
    expect(out.selected).toHaveLength(1);
  });

  it('a VITAL resolves for a scalar comparison — vitals are always undated', () => {
    const out = run(pc({ vitalSigns: { systolic_bp: 148 } }), 'vitals', 'greater_than', 'systolic_bp');
    expect(out.status).toBe('READY');
  });

  it('a dated lab inside the lifetime window still resolves', () => {
    const out = run(pc({ labResults: [{ code: '4548-4', system: 'loinc', value: 9.1, date: '2020-01-01' }] }), 'labs', 'greater_than', '4548-4');
    expect(out.status).toBe('READY');
  });

  it('a FUTURE-dated fact does not match — the horizon upper bound is the clock', () => {
    const out = run(pc({ labResults: [{ code: '4548-4', system: 'loinc', value: 9.1, date: '2099-01-01' }] }), 'labs', 'greater_than', '4548-4');
    expect(out.status).toBe('NO_MATCH');
  });

  it('under v1 the same undated lab still resolves, but a 2-year-old one does not', () => {
    const v1ctx = { ...ctx, temporalPolicyVersion: 'v1' };
    const store = assembleContext(SYNTHETIC, pc({
      labResults: [{ code: '4548-4', system: 'loinc', value: 9.1, date: '2024-01-01' }],
    }), v1ctx);
    const policy = toEffectivePolicy(resolveEffectivePolicy('labs', 'v1', {}), v1ctx);
    expect(selectFacts({ field: 'labs', operator: 'greater_than', value: '4548-4' } as never, store, policy).status)
      .toBe('NO_MATCH');
  });
});
```

- [ ] **Step 2: Run it.** Every case must pass. **If any fails, stop and report** — a failure here means the assembler's interval modeling is wrong, and Plan 04 must not be written against it.
- [ ] **Step 3: Commit**

```bash
git add apps/pathway-service/src/__tests__/temporal/assembler-preserves-today.test.ts
git commit -m "test: prove legacy-v0 through the kernel reproduces today

The plan's central bet, asserted rather than assumed: today's
PatientContext, assembled and run through selectFacts under legacy-v0,
selects the facts the current evaluator selects. Undated conditions,
undated labs and vitals all resolve READY rather than INDETERMINATE;
future-dated facts do not match; and under v1 the same undated lab still
resolves while a two-year-old one falls outside QUARTER.

If the OPEN(clock) modelling ever regresses, this fails here instead of
silently breaking every undated gate when plan 04 maps INDETERMINATE to
fail-closed.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@example.com>"
```

---

### Task 6: Suite check and overview reconciliation

**Files:**
- Modify: `docs/superpowers/plans/2026-07-26-temporal-horizon-00-overview.md`

- [ ] **Step 1: Full suite** — `npm test --prefix apps/pathway-service -- --runInBand`
  Expected: **9 failed / 2 suites** (`data-completeness-scorer`, `patient-match-scorer`), passing count risen by the tests this plan added. Any third failing suite belongs to this plan.
- [ ] **Step 2: Typecheck** — exit 0.
- [ ] **Step 3: Record the order swap in the overview.** Under the decomposition table, state that **05 executes before 04**, with the one-line reason (04 needs a `FactStore`; only 05 produces one; undated facts otherwise fail scalar gates closed under `legacy-v0`). Update Plan 05's Produces line with the real exported names: `ResolutionMode`, `assertModeAllows`, `SyntheticFactInput`, `assembleContext(mode, patientContext, ctx)`, and the extended `CodeInput`/`LabResultInput` fields. Update Plan 04's Consumes to `01–03, 05`.
- [ ] **Step 4: Commit** the overview edit with the measured suite numbers in the message.

---

## Acceptance criteria

- [ ] An undated condition, an undated lab and any vital all resolve `READY` — never `INDETERMINATE` — under `legacy-v0`, proven by Task 5.
- [ ] A future-dated fact never matches, at any horizon.
- [ ] `factId` is unique across facts, including two identical codes on the same date, and stable for a given input ordering.
- [ ] LIVE and REPLAY reject every trusted-only field, naming all offenders and the input path.
- [ ] Every new `CodeInput`/`LabResultInput` field is optional in the SDL.
- [ ] Vitals flatten to exactly the keys the current evaluator resolves (root, and `custom.<key>`).
- [ ] Full suite still fails only the two scorer suites; `tsc --noEmit` exits 0.
- [ ] Nothing in this plan is reachable from `evaluateGate` or reachability yet.
