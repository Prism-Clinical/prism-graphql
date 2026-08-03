# Temporal Horizon — Plan 01: Normalized Fact Model + `selectFacts` Kernel

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the pure, dependency-free foundation of the temporal-horizon feature — a temporal-owned condition contract, the normalized fact types (with an observation subtype covering labs *and* vitals), strict FHIR partial-date parsing to epoch ranges, possible/established three-valued interval overlap, the FHIR→state/validity mapping, and the `selectFacts` kernel returning a discriminated `SelectionOutcome` — all as unit-tested pure functions with no I/O, no clock, and no wiring into the evaluator.

**Architecture:** New code under `apps/pathway-service/src/services/resolution/temporal/`. Every function is pure: no DB, no `Date.now()`, no GraphQL. This layer defines its **own** operator/condition contract (`TemporalOperator`, `FactSelectionCondition`) so it imports nothing from `resolution/types.ts` — it is a genuine leaf. Plan 04 owns the validated `GateCondition → FactSelectionCondition` adapter. Horizons arrive pre-resolved as instants (the clock is Plan 02), so this layer never reads a clock. Nothing here is imported by the live evaluator yet.

**Tech Stack:** TypeScript 5, Jest + ts-jest.

**Revision (round 2 of plan review):** replaces the collapse-to-single-span overlap with possible/established reasoning; replaces permissive `Date.parse` with strict FHIR grammar + calendar validation; adds the temporal-owned contract, the field→kind matrix, the observation (lab+vital) subtype, the `SelectionOutcome` discriminated result, deterministic epoch ordering with definite-latest-or-`INDETERMINATE`, and reconciled state/validity policy. Commands corrected; the `strict`-mode claim corrected.

## Global Constraints

- **Working directory for every command is the `prism-graphql` repo root.** Paths below are relative to it.
- The app's tsconfig enables `noImplicitAny` + `noImplicitReturns` (it does **not** enable full `strict`). Keep new code clean under those two flags; do not rely on `strictNullChecks` being on — guard nullables explicitly.
- **Run one test file:** `npm test --prefix apps/pathway-service -- --runInBand <relative-path-from-pathway-service>`
- **Typecheck (no `typecheck` npm script exists):** `npx tsc -p apps/pathway-service/tsconfig.json --noEmit`
- This plan touches **only** files under `apps/pathway-service/src/services/resolution/temporal/` and their tests. It must not modify `gate-evaluator.ts`, `snapshot-context.ts`, or any resolver — later plans do that. Live routing is unchanged.
- Commit prefixes `feat:`/`test:`. Per project policy (CLAUDE.md) end every commit message with `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@example.com>`.
- Design reference: `docs/superpowers/specs/2026-07-21-pathway-temporal-horizon-design.md` §2, §3, §4 (committed on this branch).

---

### Task 0: Temporal contract, field/kind matrix, and selection outcome

Defines the vocabulary the rest of the plan (and Plans 02–08) consume. No behavior yet — types, a field/kind matrix, an operator classifier that **rejects unknown operators**, and the discriminated `SelectionOutcome`.

**Files:**
- Create: `apps/pathway-service/src/services/resolution/temporal/contract.ts`
- Test: `apps/pathway-service/src/__tests__/temporal/contract.test.ts`

**Interfaces:**
- Consumes: nothing (leaf).
- Produces: `TemporalOperator`, `OperatorClass`, `operatorClass()`, `FactKind`, `FIELD_TO_KIND`, `fieldToKind()`, `FactSelectionCondition`, `UncertaintyReason`, `SelectionOutcome`, `EffectivePolicy` (re-exported from here for downstream plans).

- [ ] **Step 1: Write the failing test**

```ts
// apps/pathway-service/src/__tests__/temporal/contract.test.ts
import { operatorClass, fieldToKind, isTemporalOperator } from '../../services/resolution/temporal/contract';

test('operatorClass: equals is membership, not scalar', () => {
  expect(operatorClass('equals')).toBe('membership');
  expect(operatorClass('includes_code')).toBe('membership');
  expect(operatorClass('exists')).toBe('membership');
  expect(operatorClass('greater_than')).toBe('scalar');
  expect(operatorClass('less_than')).toBe('scalar');
  expect(operatorClass('count_in_window')).toBe('aggregate');
  expect(operatorClass('trend_up')).toBe('aggregate');
});

test('unknown operators are rejected, not silently classified', () => {
  expect(isTemporalOperator('frobnicate')).toBe(false);
  expect(() => operatorClass('frobnicate' as never)).toThrow(/unknown temporal operator/i);
});

test('fieldToKind maps every gate field, vitals included', () => {
  expect(fieldToKind('conditions')).toBe('condition');
  expect(fieldToKind('medications')).toBe('medication_order');
  expect(fieldToKind('allergies')).toBe('allergy');
  expect(fieldToKind('labs')).toBe('lab');
  expect(fieldToKind('vitals')).toBe('vital');
  expect(() => fieldToKind('nonsense' as never)).toThrow(/unknown gate field/i);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test --prefix apps/pathway-service -- --runInBand src/__tests__/temporal/contract.test.ts`
Expected: FAIL — cannot find module `contract`.

- [ ] **Step 3: Write minimal implementation**

```ts
// apps/pathway-service/src/services/resolution/temporal/contract.ts

export type TemporalOperator =
  | 'includes_code' | 'equals' | 'exists'
  | 'greater_than' | 'less_than'
  | 'count_in_window' | 'trend_up' | 'trend_down' | 'delta_from_baseline';

const MEMBERSHIP = new Set<TemporalOperator>(['includes_code', 'equals', 'exists']);
const SCALAR = new Set<TemporalOperator>(['greater_than', 'less_than']);
const AGGREGATE = new Set<TemporalOperator>(['count_in_window', 'trend_up', 'trend_down', 'delta_from_baseline']);
const ALL_OPS = new Set<string>([...MEMBERSHIP, ...SCALAR, ...AGGREGATE]);

export type OperatorClass = 'membership' | 'scalar' | 'aggregate';

export function isTemporalOperator(op: string): op is TemporalOperator {
  return ALL_OPS.has(op);
}
export function operatorClass(op: TemporalOperator): OperatorClass {
  if (MEMBERSHIP.has(op)) return 'membership';
  if (SCALAR.has(op)) return 'scalar';
  if (AGGREGATE.has(op)) return 'aggregate';
  throw new Error(`unknown temporal operator: ${op}`);
}

export type GateField = 'conditions' | 'medications' | 'allergies' | 'labs' | 'vitals';
export type FactKind = 'condition' | 'medication_order' | 'allergy' | 'lab' | 'vital';

export const FIELD_TO_KIND: Record<GateField, FactKind> = {
  conditions: 'condition', medications: 'medication_order', allergies: 'allergy',
  labs: 'lab', vitals: 'vital',
};
export function fieldToKind(field: GateField): FactKind {
  const k = FIELD_TO_KIND[field];
  if (!k) throw new Error(`unknown gate field: ${field}`);
  return k;
}

/** Temporal-owned condition shape. Plan 04 adapts the repo's GateCondition into this. */
export interface FactSelectionCondition {
  field: GateField;
  operator: TemporalOperator;
  value: string;          // membership: the code/pattern to look for; scalar/aggregate: the observation code/key
  system?: string;        // optional code-system filter
}

export type UncertaintyReason =
  | 'TEMPORAL_UNKNOWN' | 'STATE_UNKNOWN' | 'VALIDITY_UNKNOWN' | 'AMBIGUOUS_LATEST';

// selected/decisions typing is completed in Task 5 (imports NormalizedFact/FactDecision).
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test --prefix apps/pathway-service -- --runInBand src/__tests__/temporal/contract.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git -C apps/pathway-service add src/services/resolution/temporal/contract.ts src/__tests__/temporal/contract.test.ts
git commit -m "feat: temporal-owned operator/field contract with unknown-op rejection

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@example.com>"
```

---

### Task 1: Fact-model types and guards

**Files:**
- Create: `apps/pathway-service/src/services/resolution/temporal/fact-model.ts`
- Test: `apps/pathway-service/src/__tests__/temporal/fact-model.test.ts`

**Interfaces:**
- Consumes: `FactKind` from `contract.ts`.
- Produces: `TemporalBound`, `TemporalEnd`, `FactBase`, `ClinicalState`, `StateBasis`, `StatefulFact`, `ObservationFact` (kind `lab`|`vital`), `NormalizedFact`, `FactStore`, `isObservationFact`, `isStatefulFact`.

- [ ] **Step 1: Write the failing test**

```ts
// apps/pathway-service/src/__tests__/temporal/fact-model.test.ts
import { isObservationFact, isStatefulFact, NormalizedFact } from '../../services/resolution/temporal/fact-model';

const lab: NormalizedFact = {
  kind: 'lab', factId: 'f1', code: '718-7', system: 'LOINC', value: 10.2, unit: 'g/dL', observationStatus: 'final',
  interval: { start: { value: '2026-01-01', precision: 'day' }, end: { kind: 'KNOWN', bound: { value: '2026-01-01', precision: 'day' } } },
  recordValidity: 'VALID', validityBasis: 'observation:final', provenance: { sourceType: 'SYNTHETIC' },
};
const vital: NormalizedFact = {
  kind: 'vital', factId: 'v1', code: 'systolic_bp', system: 'vitals', value: 128,
  interval: { start: undefined, end: { kind: 'OPEN', assertedCurrentAt: '2026-07-26T00:00:00.000Z' } },
  recordValidity: 'VALID', validityBasis: 'vital:present', provenance: { sourceType: 'SYNTHETIC' },
};
const cond: NormalizedFact = {
  kind: 'condition', factId: 'c1', code: 'E11.9', system: 'ICD-10',
  interval: { start: { value: '2020', precision: 'year' }, end: { kind: 'OPEN', assertedCurrentAt: '2026-07-01T00:00:00.000Z' } },
  recordValidity: 'VALID', validityBasis: 'verification:confirmed', provenance: { sourceType: 'SYNTHETIC' },
  clinicalState: 'ACTIVE', stateBasis: 'FHIR_STATUS',
};

test('guards discriminate observation (lab+vital) vs stateful', () => {
  expect(isObservationFact(lab)).toBe(true);
  expect(isObservationFact(vital)).toBe(true);
  expect(isObservationFact(cond)).toBe(false);
  expect(isStatefulFact(cond)).toBe(true);
  expect(isStatefulFact(lab)).toBe(false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test --prefix apps/pathway-service -- --runInBand src/__tests__/temporal/fact-model.test.ts`
Expected: FAIL — cannot find module `fact-model`.

- [ ] **Step 3: Write minimal implementation**

```ts
// apps/pathway-service/src/services/resolution/temporal/fact-model.ts
import { FactKind } from './contract';

export interface TemporalBound {
  value: string; // FHIR: YYYY | YYYY-MM | YYYY-MM-DD | full instant with timezone
  precision: 'year' | 'month' | 'day' | 'instant';
}

export type TemporalEnd =
  | { kind: 'KNOWN'; bound: TemporalBound }        // a real end (abatement, resolution, stop)
  | { kind: 'OPEN'; assertedCurrentAt: string }    // ongoing, known-current only as of this instant
  | { kind: 'UNKNOWN' };                           // no usable end signal — never invent one

export interface FactBase {
  factId: string;              // assigned + persisted at ingestion; never a lossy hash (Plan 05)
  code: string;
  system: string;
  display?: string;
  interval: { start?: TemporalBound; end: TemporalEnd };
  recordValidity: 'VALID' | 'INVALID' | 'UNKNOWN'; // tri-state: see state-mapping (Task 4)
  validityBasis: string;
  provenance: { sourceType: 'FHIR' | 'SYNTHETIC'; sourceId?: string; snapshotId?: string };
}

export type ClinicalState = 'ACTIVE' | 'INACTIVE' | 'ON_HOLD' | 'UNKNOWN' | 'CONFLICT';
export type StateBasis =
  | 'FHIR_STATUS' | 'ABATEMENT' | 'SNAPSHOT_ASSERTION' | 'SYNTHETIC' | 'MISSING_STATUS_FAIL_OPEN';

export interface StatefulFact extends FactBase {
  kind: Extract<FactKind, 'condition' | 'medication_order' | 'allergy'>;
  clinicalState: ClinicalState;
  stateAsOf?: string;
  stateBasis: StateBasis;
}

export interface ObservationFact extends FactBase {
  kind: Extract<FactKind, 'lab' | 'vital'>;
  value?: number;
  unit?: string;
  observationStatus?: string; // labs only; vitals typically have none
  issuedAt?: string;
}

export type NormalizedFact = StatefulFact | ObservationFact;
export type FactStore = ReadonlyArray<NormalizedFact>;

export function isObservationFact(f: NormalizedFact): f is ObservationFact {
  return f.kind === 'lab' || f.kind === 'vital';
}
export function isStatefulFact(f: NormalizedFact): f is StatefulFact {
  return !isObservationFact(f);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test --prefix apps/pathway-service -- --runInBand src/__tests__/temporal/fact-model.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git -C apps/pathway-service add src/services/resolution/temporal/fact-model.ts src/__tests__/temporal/fact-model.test.ts
git commit -m "feat: normalized fact model (stateful + observation subtypes)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@example.com>"
```

---

### Task 2: Strict FHIR date parsing → epoch ranges

**Files:**
- Create: `apps/pathway-service/src/services/resolution/temporal/interval.ts`
- Test: `apps/pathway-service/src/__tests__/temporal/interval.test.ts`

**Interfaces:**
- Consumes: `TemporalBound` (`fact-model.ts`).
- Produces:
  - `parseFhirDate(s: string | null | undefined): TemporalBound | null` — strict FHIR grammar + calendar validation (rejects `2026-13`, `2026-02-31`, timezone-less date-times, whitespace, and `Date.parse`-only locale strings).
  - `boundEpochRange(b: TemporalBound): { loMs: number; hiMs: number }` — inclusive epoch-ms span of the bound's precision; throws on an invalid bound.
  - `instantEpoch(s: string): number` — a full instant string → epoch ms; throws if not a valid instant.

- [ ] **Step 1: Write the failing test**

```ts
// apps/pathway-service/src/__tests__/temporal/interval.test.ts
import { parseFhirDate, boundEpochRange, instantEpoch } from '../../services/resolution/temporal/interval';

test('accepts each valid FHIR precision', () => {
  expect(parseFhirDate('2026')).toEqual({ value: '2026', precision: 'year' });
  expect(parseFhirDate('2026-03')).toEqual({ value: '2026-03', precision: 'month' });
  expect(parseFhirDate('2026-03-14')).toEqual({ value: '2026-03-14', precision: 'day' });
  expect(parseFhirDate('2026-03-14T09:30:00Z')).toEqual({ value: '2026-03-14T09:30:00Z', precision: 'instant' });
  expect(parseFhirDate('2026-03-14T09:30:00+02:00')).toEqual({ value: '2026-03-14T09:30:00+02:00', precision: 'instant' });
});

test('rejects impossible calendar values', () => {
  expect(parseFhirDate('2026-13')).toBeNull();
  expect(parseFhirDate('2026-00')).toBeNull();
  expect(parseFhirDate('2026-02-31')).toBeNull();
  expect(parseFhirDate('2025-02-29')).toBeNull(); // not a leap year
  expect(parseFhirDate('2024-02-29')).toEqual({ value: '2024-02-29', precision: 'day' }); // leap year OK
});

test('rejects non-FHIR forms', () => {
  expect(parseFhirDate('2026-03-14T09:30:00')).toBeNull(); // no timezone
  expect(parseFhirDate(' 2026-03-14 ')).toBeNull();        // whitespace
  expect(parseFhirDate('03/14/2026')).toBeNull();          // locale form
  expect(parseFhirDate(null)).toBeNull();
  expect(parseFhirDate('')).toBeNull();
});

test('boundEpochRange spans precision inclusively', () => {
  const y = boundEpochRange({ value: '2026', precision: 'year' });
  expect(y.loMs).toBe(Date.UTC(2026, 0, 1, 0, 0, 0, 0));
  expect(y.hiMs).toBe(Date.UTC(2026, 11, 31, 23, 59, 59, 999));
  const feb = boundEpochRange({ value: '2024-02', precision: 'month' });
  expect(feb.hiMs).toBe(Date.UTC(2024, 1, 29, 23, 59, 59, 999)); // leap Feb → 29 days
  const day = boundEpochRange({ value: '2026-03-14', precision: 'day' });
  expect(day.loMs).toBe(Date.UTC(2026, 2, 14, 0, 0, 0, 0));
  expect(day.hiMs).toBe(Date.UTC(2026, 2, 14, 23, 59, 59, 999));
});

test('boundEpochRange throws on an invalid hand-built bound', () => {
  expect(() => boundEpochRange({ value: '2026-13', precision: 'month' })).toThrow();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test --prefix apps/pathway-service -- --runInBand src/__tests__/temporal/interval.test.ts`
Expected: FAIL — cannot find module `interval`.

- [ ] **Step 3: Write minimal implementation**

```ts
// apps/pathway-service/src/services/resolution/temporal/interval.ts
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
  let mt = YEAR.exec(s);
  if (mt) return { value: s, precision: 'year' };
  mt = MONTH.exec(s);
  if (mt) { const m = Number(mt[2]); return m >= 1 && m <= 12 ? { value: s, precision: 'month' } : null; }
  mt = DAY.exec(s);
  if (mt) { return validYMD(Number(mt[1]), Number(mt[2]), Number(mt[3])) ? { value: s, precision: 'day' } : null; }
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
  if (!parsed || parsed.precision !== b.precision) throw new Error(`invalid TemporalBound: ${b.value} @ ${b.precision}`);
  if (b.precision === 'instant') { const t = Date.parse(b.value); return { loMs: t, hiMs: t }; }
  const [yS, mS, dS] = b.value.split('-');
  const y = Number(yS);
  if (b.precision === 'year') return { loMs: Date.UTC(y, 0, 1, 0, 0, 0, 0), hiMs: Date.UTC(y, 11, 31, 23, 59, 59, 999) };
  const m = Number(mS);
  if (b.precision === 'month') return { loMs: Date.UTC(y, m - 1, 1, 0, 0, 0, 0), hiMs: Date.UTC(y, m - 1, daysInMonth(y, m), 23, 59, 59, 999) };
  const d = Number(dS);
  return { loMs: Date.UTC(y, m - 1, d, 0, 0, 0, 0), hiMs: Date.UTC(y, m - 1, d, 23, 59, 59, 999) };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test --prefix apps/pathway-service -- --runInBand src/__tests__/temporal/interval.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git -C apps/pathway-service add src/services/resolution/temporal/interval.ts src/__tests__/temporal/interval.test.ts
git commit -m "feat: strict FHIR date parsing to epoch ranges

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@example.com>"
```

---

### Task 3: Possible/established three-valued overlap

**Files:**
- Create: `apps/pathway-service/src/services/resolution/temporal/overlap.ts`
- Test: `apps/pathway-service/src/__tests__/temporal/overlap.test.ts`

**Interfaces:**
- Consumes: `FactBase`, `TemporalEnd`, `TemporalBound` (`fact-model.ts`); `boundEpochRange`, `instantEpoch` (`interval.ts`).
- Produces: `type ThreeValued = 'MATCH' | 'NO_MATCH' | 'UNKNOWN'`; `interface ResolvedHorizon { lowerBound: string | null; upperBound: string }` (instants; `lowerBound: null` = LIFETIME; `upperBound` = `evaluationAsOf`); `overlap(interval: FactBase['interval'], horizon: ResolvedHorizon): ThreeValued`. Throws on an inverted interval (known end before start).

**Algorithm (truth table):** Convert everything to epoch ms with `-Infinity`/`+Infinity` for open ends.
- **Point fact** (`start` present, `end.kind==='KNOWN'`, same bound as start — the lab/observation instant): let `[pLo,pHi]` be the bound range. `MATCH` if `[pLo,pHi] ⊆ horizon`; `NO_MATCH` if disjoint; else `UNKNOWN` (straddles a boundary).
- **Durational fact:** compute start range `[sLo,sHi]` (absent → `[-∞,+∞]`) and end range `[eLo,eHi]`:
  - `KNOWN(b)` → `[range.lo, range.hi]`.
  - `OPEN(a)` → `[epoch(a), +∞]`, **and clamp `sHi = min(sHi, epoch(a))`** (active-at-`a` ⇒ started by `a`).
  - `UNKNOWN` → `[sLo, +∞]` (ended at or after the earliest possible start; upper unknown).
  - Reject if `end.kind==='KNOWN'` and `sLo > eHi` (inverted).
  - `NO_MATCH` if no realization can overlap: `sLo > Hhi` or `eHi < Hlo`.
  - `MATCH` if **every** realization overlaps: `sHi ≤ Hhi` **and** `eLo ≥ Hlo`. (Because `S ≤ E` holds in every realization, these two independent bounds are sufficient — no separate `sHi ≤ eLo` check, which would wrongly demand a single common instant and miss e.g. a dated-start/UNKNOWN-end fact whose start is inside the horizon.)
  - else `UNKNOWN`.

- [ ] **Step 1: Write the failing test (table-driven truth table)**

```ts
// apps/pathway-service/src/__tests__/temporal/overlap.test.ts
import { overlap, ResolvedHorizon, ThreeValued } from '../../services/resolution/temporal/overlap';
import { FactBase, TemporalEnd } from '../../services/resolution/temporal/fact-model';

const Q: ResolvedHorizon = { lowerBound: '2026-04-27T00:00:00.000Z', upperBound: '2026-07-26T00:00:00.000Z' };
const LIFE: ResolvedHorizon = { lowerBound: null, upperBound: '2026-07-26T00:00:00.000Z' };
const day = (v: string): FactBase['interval']['start'] => ({ value: v, precision: 'day' });
const known = (v: string): TemporalEnd => ({ kind: 'KNOWN', bound: { value: v, precision: 'day' } });
const iv = (start: FactBase['interval']['start'], end: TemporalEnd): FactBase['interval'] => ({ start, end });

type Row = [string, FactBase['interval'], ResolvedHorizon, ThreeValued];
const rows: Row[] = [
  ['point lab inside window',            iv(day('2026-05-10'), known('2026-05-10')), Q, 'MATCH'],
  ['point lab before window',            iv(day('2026-01-10'), known('2026-01-10')), Q, 'NO_MATCH'],
  ['point lab after upperBound (future)',iv(day('2026-08-10'), known('2026-08-10')), Q, 'NO_MATCH'],
  ['month-precision point straddling lower bound', iv({ value: '2026-04', precision: 'month' }, { kind: 'KNOWN', bound: { value: '2026-04', precision: 'month' } }), Q, 'UNKNOWN'],
  ['durational OPEN asserted in window', iv(day('2019-01-01'), { kind: 'OPEN', assertedCurrentAt: '2026-06-01T00:00:00.000Z' }), Q, 'MATCH'],
  ['durational OPEN asserted before win',iv(day('2019-01-01'), { kind: 'OPEN', assertedCurrentAt: '2026-01-01T00:00:00.000Z' }), Q, 'UNKNOWN'],
  ['active no-onset OPEN in window',     iv(undefined,          { kind: 'OPEN', assertedCurrentAt: '2026-06-01T00:00:00.000Z' }), Q, 'MATCH'],
  ['dated start, UNKNOWN end, old',      iv(day('2020-01-01'),  { kind: 'UNKNOWN' }), Q, 'UNKNOWN'],
  ['undated start, UNKNOWN end',         iv(undefined,          { kind: 'UNKNOWN' }), Q, 'UNKNOWN'],
  ['resolved before window (known end)', iv(day('2018-01-01'),  known('2025-01-01')), Q, 'NO_MATCH'],
  ['everything overlaps LIFETIME',       iv(day('2001-01-01'),  { kind: 'UNKNOWN' }), LIFE, 'MATCH'],
];

test.each(rows)('overlap: %s', (_desc, interval, horizon, expected) => {
  expect(overlap(interval, horizon)).toBe(expected);
});

test('inverted interval (known end before start) throws', () => {
  expect(() => overlap(iv(day('2025-01-01'), known('2020-01-01')), Q)).toThrow(/inverted/i);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test --prefix apps/pathway-service -- --runInBand src/__tests__/temporal/overlap.test.ts`
Expected: FAIL — cannot find module `overlap`.

- [ ] **Step 3: Write minimal implementation**

```ts
// apps/pathway-service/src/services/resolution/temporal/overlap.ts
import { FactBase, TemporalBound } from './fact-model';
import { boundEpochRange, instantEpoch } from './interval';

export type ThreeValued = 'MATCH' | 'NO_MATCH' | 'UNKNOWN';
export interface ResolvedHorizon { lowerBound: string | null; upperBound: string; }

function sameBound(a: TemporalBound | undefined, b: TemporalBound): boolean {
  return !!a && a.value === b.value && a.precision === b.precision;
}

export function overlap(interval: FactBase['interval'], horizon: ResolvedHorizon): ThreeValued {
  const Hlo = horizon.lowerBound === null ? -Infinity : instantEpoch(horizon.lowerBound);
  const Hhi = instantEpoch(horizon.upperBound);
  const end = interval.end;

  // Point fact: a KNOWN end equal to the start bound (labs / instant observations).
  if (interval.start && end.kind === 'KNOWN' && sameBound(interval.start, end.bound)) {
    const { loMs: pLo, hiMs: pHi } = boundEpochRange(interval.start);
    if (pLo >= Hlo && pHi <= Hhi) return 'MATCH';
    if (pHi < Hlo || pLo > Hhi) return 'NO_MATCH';
    return 'UNKNOWN';
  }

  // Durational fact.
  let sLo = -Infinity, sHi = Infinity;
  if (interval.start) { const r = boundEpochRange(interval.start); sLo = r.loMs; sHi = r.hiMs; }

  let eLo: number, eHi: number;
  if (end.kind === 'KNOWN') {
    const r = boundEpochRange(end.bound);
    eLo = r.loMs; eHi = r.hiMs;
    if (sLo > eHi) throw new Error(`inverted interval: start after known end`);
  } else if (end.kind === 'OPEN') {
    const a = instantEpoch(end.assertedCurrentAt);
    eLo = a; eHi = Infinity;
    sHi = Math.min(sHi, a); // active at a ⇒ started by a
  } else { // UNKNOWN
    eLo = sLo; eHi = Infinity;
  }

  // No possible overlap → NO_MATCH.
  if (sLo > Hhi || eHi < Hlo) return 'NO_MATCH';
  // Established overlap: EVERY realization overlaps. Since S ≤ E in all
  // realizations, [S,E] meets [Hlo,Hhi] whenever sHi ≤ Hhi and eLo ≥ Hlo.
  if (sHi <= Hhi && eLo >= Hlo) return 'MATCH';
  return 'UNKNOWN';
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test --prefix apps/pathway-service -- --runInBand src/__tests__/temporal/overlap.test.ts`
Expected: PASS (all table rows + the inverted-interval throw). Note the `MATCH` check is `sHi <= Hhi && eLo >= Hlo` — deliberately **not** gated on `sHi <= eLo`, so a dated-start/UNKNOWN-end fact whose start lies in the horizon (e.g. an old diagnosis over LIFETIME) is correctly `MATCH`.

- [ ] **Step 5: Commit**

```bash
git -C apps/pathway-service add src/services/resolution/temporal/overlap.ts src/__tests__/temporal/overlap.test.ts
git commit -m "feat: possible/established three-valued interval overlap

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@example.com>"
```

---

### Task 4: FHIR → clinical-state and record-validity mapping

`recordValidity` is **tri-state**: `INVALID` = known-invalid (dropped), `VALID` = affirmatively confirmed/absent, `UNKNOWN` = uncertain (unconfirmed/provisional/differential/preliminary/missing-required). Downstream (Task 5) admits `UNKNOWN` with a marker under membership fail-open and excludes it under scalar/aggregate.

**Files:**
- Create: `apps/pathway-service/src/services/resolution/temporal/state-mapping.ts`
- Test: `apps/pathway-service/src/__tests__/temporal/state-mapping.test.ts`

**Interfaces:**
- Consumes: `ClinicalState`, `StateBasis` (`fact-model.ts`).
- Produces: `deriveConditionState`, `deriveMedicationState`, `deriveAllergyState`, `deriveValidity` (signatures below). Inputs are already-extracted lowercase code strings.

- [ ] **Step 1: Write the failing test**

```ts
// apps/pathway-service/src/__tests__/temporal/state-mapping.test.ts
import {
  deriveConditionState, deriveMedicationState, deriveAllergyState, deriveValidity,
} from '../../services/resolution/temporal/state-mapping';

test('condition: recurrence/relapse are active; missing → fail-open active', () => {
  expect(deriveConditionState({ clinicalStatus: 'relapse', hasAbatement: false }).clinicalState).toBe('ACTIVE');
  expect(deriveConditionState({ clinicalStatus: null, hasAbatement: false }))
    .toEqual({ clinicalState: 'ACTIVE', stateBasis: 'MISSING_STATUS_FAIL_OPEN' });
});
test('condition: abatement resolves; abatement + active status is CONFLICT', () => {
  expect(deriveConditionState({ clinicalStatus: 'resolved', hasAbatement: true }))
    .toEqual({ clinicalState: 'INACTIVE', stateBasis: 'ABATEMENT' });
  expect(deriveConditionState({ clinicalStatus: 'active', hasAbatement: true }).clinicalState).toBe('CONFLICT');
});
test('medication: on-hold/draft distinct; MISSING required status → UNKNOWN (not fail-open)', () => {
  expect(deriveMedicationState({ status: 'on-hold' }).clinicalState).toBe('ON_HOLD');
  expect(deriveMedicationState({ status: 'draft' }).clinicalState).toBe('UNKNOWN');
  expect(deriveMedicationState({ status: null }).clinicalState).toBe('UNKNOWN');
});
test('validity: refuted/entered-in-error → INVALID; uncertain verification → UNKNOWN; confirmed/absent → VALID', () => {
  expect(deriveValidity({ kind: 'condition', verificationStatus: 'refuted' }).recordValidity).toBe('INVALID');
  expect(deriveValidity({ kind: 'condition', verificationStatus: 'provisional' }).recordValidity).toBe('UNKNOWN');
  expect(deriveValidity({ kind: 'condition', verificationStatus: 'differential' }).recordValidity).toBe('UNKNOWN');
  expect(deriveValidity({ kind: 'condition', verificationStatus: 'confirmed' }).recordValidity).toBe('VALID');
  expect(deriveValidity({ kind: 'condition', verificationStatus: null }).recordValidity).toBe('VALID');
});
test('validity: observation status tri-state', () => {
  expect(deriveValidity({ kind: 'lab', observationStatus: 'entered-in-error' }).recordValidity).toBe('INVALID');
  expect(deriveValidity({ kind: 'lab', observationStatus: 'preliminary' }).recordValidity).toBe('UNKNOWN');
  expect(deriveValidity({ kind: 'lab', observationStatus: 'corrected' }).recordValidity).toBe('VALID');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test --prefix apps/pathway-service -- --runInBand src/__tests__/temporal/state-mapping.test.ts`
Expected: FAIL — cannot find module `state-mapping`.

- [ ] **Step 3: Write minimal implementation**

```ts
// apps/pathway-service/src/services/resolution/temporal/state-mapping.ts
import { ClinicalState, StateBasis } from './fact-model';

type StateOut = { clinicalState: ClinicalState; stateBasis: StateBasis };
type ValidityOut = { recordValidity: 'VALID' | 'INVALID' | 'UNKNOWN'; validityBasis: string };

const COND_ACTIVE = new Set(['active', 'recurrence', 'relapse']);
const COND_INACTIVE = new Set(['inactive', 'remission', 'resolved']);

export function deriveConditionState(i: { clinicalStatus: string | null; hasAbatement: boolean }): StateOut {
  const s = i.clinicalStatus?.toLowerCase() ?? null;
  if (i.hasAbatement) {
    if (s && COND_ACTIVE.has(s)) return { clinicalState: 'CONFLICT', stateBasis: 'ABATEMENT' };
    return { clinicalState: 'INACTIVE', stateBasis: 'ABATEMENT' };
  }
  if (s === null) return { clinicalState: 'ACTIVE', stateBasis: 'MISSING_STATUS_FAIL_OPEN' };
  if (COND_ACTIVE.has(s)) return { clinicalState: 'ACTIVE', stateBasis: 'FHIR_STATUS' };
  if (COND_INACTIVE.has(s)) return { clinicalState: 'INACTIVE', stateBasis: 'FHIR_STATUS' };
  return { clinicalState: 'UNKNOWN', stateBasis: 'FHIR_STATUS' };
}

// MedicationRequest.status is REQUIRED in FHIR — a missing value is anomalous, not a fail-open case.
export function deriveMedicationState(i: { status: string | null }): StateOut {
  const s = i.status?.toLowerCase() ?? null;
  if (s === null) return { clinicalState: 'UNKNOWN', stateBasis: 'FHIR_STATUS' };
  if (s === 'active') return { clinicalState: 'ACTIVE', stateBasis: 'FHIR_STATUS' };
  if (s === 'on-hold') return { clinicalState: 'ON_HOLD', stateBasis: 'FHIR_STATUS' };
  if (s === 'stopped' || s === 'completed' || s === 'cancelled') return { clinicalState: 'INACTIVE', stateBasis: 'FHIR_STATUS' };
  return { clinicalState: 'UNKNOWN', stateBasis: 'FHIR_STATUS' }; // draft, unknown (entered-in-error dropped by validity)
}

export function deriveAllergyState(i: { clinicalStatus: string | null }): StateOut {
  const s = i.clinicalStatus?.toLowerCase() ?? null;
  if (s === null) return { clinicalState: 'ACTIVE', stateBasis: 'MISSING_STATUS_FAIL_OPEN' };
  if (s === 'active') return { clinicalState: 'ACTIVE', stateBasis: 'FHIR_STATUS' };
  if (s === 'inactive' || s === 'resolved') return { clinicalState: 'INACTIVE', stateBasis: 'FHIR_STATUS' };
  return { clinicalState: 'UNKNOWN', stateBasis: 'FHIR_STATUS' };
}

const VER_INVALID = new Set(['refuted', 'entered-in-error']);
const VER_VALID = new Set(['confirmed']);        // affirmatively confirmed
const VER_UNKNOWN = new Set(['unconfirmed', 'provisional', 'differential']);
const OBS_VALID = new Set(['final', 'amended', 'corrected']);
const OBS_INVALID = new Set(['cancelled', 'entered-in-error']);
const OBS_UNKNOWN = new Set(['registered', 'preliminary', 'unknown']);

export function deriveValidity(i: {
  kind: 'condition' | 'allergy' | 'medication_order' | 'lab' | 'vital';
  verificationStatus?: string | null; observationStatus?: string | null; medStatus?: string | null;
}): ValidityOut {
  if (i.kind === 'condition' || i.kind === 'allergy') {
    const v = i.verificationStatus?.toLowerCase() ?? null;
    if (v && VER_INVALID.has(v)) return { recordValidity: 'INVALID', validityBasis: `verification:${v}` };
    if (v && VER_UNKNOWN.has(v)) return { recordValidity: 'UNKNOWN', validityBasis: `verification:${v}` };
    if (v === null || VER_VALID.has(v)) return { recordValidity: 'VALID', validityBasis: v ? `verification:${v}` : 'verification:absent' };
    return { recordValidity: 'UNKNOWN', validityBasis: `verification:${v}` };
  }
  if (i.kind === 'medication_order') {
    const s = i.medStatus?.toLowerCase() ?? null;
    if (s === 'entered-in-error') return { recordValidity: 'INVALID', validityBasis: 'medication:entered-in-error' };
    if (s === null) return { recordValidity: 'UNKNOWN', validityBasis: 'medication:absent' };
    return { recordValidity: 'VALID', validityBasis: `medication:${s}` };
  }
  // lab / vital
  const o = i.observationStatus?.toLowerCase() ?? null;
  if (o && OBS_INVALID.has(o)) return { recordValidity: 'INVALID', validityBasis: `observation:${o}` };
  if (o && OBS_VALID.has(o)) return { recordValidity: 'VALID', validityBasis: `observation:${o}` };
  if (o && OBS_UNKNOWN.has(o)) return { recordValidity: 'UNKNOWN', validityBasis: `observation:${o}` };
  if (o === null && i.kind === 'vital') return { recordValidity: 'VALID', validityBasis: 'vital:present' };
  return { recordValidity: 'UNKNOWN', validityBasis: o ? `observation:${o}` : 'observation:absent' };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test --prefix apps/pathway-service -- --runInBand src/__tests__/temporal/state-mapping.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git -C apps/pathway-service add src/services/resolution/temporal/state-mapping.ts src/__tests__/temporal/state-mapping.test.ts
git commit -m "feat: reconciled FHIR clinical-state + tri-state validity mapping

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@example.com>"
```

---

### Task 5: The `selectFacts` kernel with a discriminated outcome

**Files:**
- Create: `apps/pathway-service/src/services/resolution/temporal/select-facts.ts`
- Test: `apps/pathway-service/src/__tests__/temporal/select-facts.test.ts`

**Interfaces:**
- Consumes: `FactSelectionCondition`, `operatorClass`, `fieldToKind`, `UncertaintyReason` (`contract.ts`); `NormalizedFact`, `FactStore`, `isObservationFact` (`fact-model.ts`); `overlap`, `ResolvedHorizon`, `ThreeValued` (`overlap.ts`); `boundEpochRange` (`interval.ts`).
- Produces:
```ts
interface EffectivePolicy { horizon: ResolvedHorizon; status?: 'active' | 'inactive' | 'any'; }
interface FactDecision {
  fact: NormalizedFact;
  validityDecision: 'ADMIT' | 'DROP_INVALID' | 'UNKNOWN';
  stateMatch: 'MATCH' | 'NO_MATCH' | 'UNKNOWN' | 'NOT_APPLICABLE';
  temporalMatch: ThreeValued;
  operatorDecision: 'INCLUDE' | 'EXCLUDE' | 'INDETERMINATE';
}
type SelectionOutcome =
  | { status: 'READY'; selected: NormalizedFact[]; decisions: FactDecision[];
      temporallyUnverified: boolean; stateUnverified: boolean; validityUnverified: boolean }
  | { status: 'NO_MATCH'; decisions: FactDecision[] }
  | { status: 'INDETERMINATE'; reasons: UncertaintyReason[]; decisions: FactDecision[] };
function selectFacts(condition: FactSelectionCondition, store: FactStore, policy: EffectivePolicy): SelectionOutcome;
```

**Rules:** field→kind isolation first (a `labs` gate never matches a `condition` fact). Then per-operator candidate match: `exists` = kind only; `includes_code` = wildcard code (`Z94.*`); `equals` = exact code; scalar/aggregate = observation kind + code + finite numeric value. Per candidate compute validity/state/temporal, combine per operator class (membership fail-open on any `UNKNOWN`; scalar/aggregate → `INDETERMINATE` on any `UNKNOWN`; a `CONFLICT`/`NO_MATCH` state always `EXCLUDE`). Then build the outcome: membership → `READY` with all `INCLUDE` (or `NO_MATCH` if none and none indeterminate); scalar → definite-latest among `INCLUDE` (`INDETERMINATE` if ambiguous or any candidate is indeterminate); `count_in_window` → `READY` with distinct-`factId` `INCLUDE`; trend/delta → `READY` with `INCLUDE` sorted by epoch.

- [ ] **Step 1: Write the failing test**

```ts
// apps/pathway-service/src/__tests__/temporal/select-facts.test.ts
import { selectFacts } from '../../services/resolution/temporal/select-facts';
import { NormalizedFact } from '../../services/resolution/temporal/fact-model';
import { ResolvedHorizon } from '../../services/resolution/temporal/overlap';

const Q: ResolvedHorizon = { lowerBound: '2026-04-27T00:00:00.000Z', upperBound: '2026-07-26T00:00:00.000Z' };
const LIFE: ResolvedHorizon = { lowerBound: null, upperBound: '2026-07-26T00:00:00.000Z' };

const lab = (factId: string, d: string, value: number, valid = true): NormalizedFact => ({
  kind: 'lab', factId, code: '718-7', system: 'LOINC', value, unit: 'g/dL',
  observationStatus: valid ? 'final' : 'entered-in-error',
  interval: { start: { value: d, precision: 'day' }, end: { kind: 'KNOWN', bound: { value: d, precision: 'day' } } },
  recordValidity: valid ? 'VALID' : 'INVALID', validityBasis: valid ? 'observation:final' : 'observation:entered-in-error',
  provenance: { sourceType: 'SYNTHETIC' },
});
const cond = (factId: string, code: string, state: 'ACTIVE' | 'CONFLICT'): NormalizedFact => ({
  kind: 'condition', factId, code, system: 'ICD-10',
  interval: { start: { value: '2020', precision: 'year' }, end: { kind: 'OPEN', assertedCurrentAt: '2026-06-01T00:00:00.000Z' } },
  recordValidity: 'VALID', validityBasis: 'verification:confirmed', provenance: { sourceType: 'SYNTHETIC' },
  clinicalState: state, stateBasis: 'FHIR_STATUS',
});

test('field/kind isolation: a lab fact never satisfies a conditions gate', () => {
  const out = selectFacts({ field: 'conditions', operator: 'includes_code', value: '718-7' }, [lab('a', '2026-05-01', 10)], { horizon: Q, status: 'active' });
  expect(out.status).toBe('NO_MATCH');
});

test('includes_code supports trailing wildcard', () => {
  const c = cond('c1', 'Z94.0', 'ACTIVE');
  const out = selectFacts({ field: 'conditions', operator: 'includes_code', value: 'Z94.*', system: 'ICD-10' }, [c], { horizon: LIFE, status: 'active' });
  expect(out.status).toBe('READY');
  if (out.status === 'READY') expect(out.selected.map(f => f.factId)).toEqual(['c1']);
});

test('exists ignores value and matches on field/kind', () => {
  const out = selectFacts({ field: 'conditions', operator: 'exists', value: '' }, [cond('c1', 'E11.9', 'ACTIVE')], { horizon: LIFE, status: 'active' });
  expect(out.status).toBe('READY');
});

test('scalar less_than selects the definite-latest valid lab', () => {
  const out = selectFacts({ field: 'labs', operator: 'less_than', value: '718-7', system: 'LOINC' }, [lab('a', '2026-05-01', 10), lab('b', '2026-07-01', 12)], { horizon: Q });
  expect(out.status).toBe('READY');
  if (out.status === 'READY') { expect(out.selected).toHaveLength(1); expect(out.selected[0].factId).toBe('b'); }
});

test('scalar with two labs on the SAME day is INDETERMINATE (no definite latest)', () => {
  const out = selectFacts({ field: 'labs', operator: 'less_than', value: '718-7', system: 'LOINC' }, [lab('a', '2026-05-01', 10), lab('b', '2026-05-01', 12)], { horizon: Q });
  expect(out.status).toBe('INDETERMINATE');
});

test('invalid labs drop; if all candidates invalid → NO_MATCH', () => {
  const out = selectFacts({ field: 'labs', operator: 'less_than', value: '718-7', system: 'LOINC' }, [lab('a', '2026-07-01', 9, false)], { horizon: Q });
  expect(out.status).toBe('NO_MATCH');
});

test('count_in_window counts distinct factIds', () => {
  const out = selectFacts({ field: 'labs', operator: 'count_in_window', value: '718-7', system: 'LOINC' }, [lab('a', '2026-05-01', 10), lab('b', '2026-06-01', 10)], { horizon: Q });
  expect(out.status).toBe('READY');
  if (out.status === 'READY') expect(out.selected.map(f => f.factId).sort()).toEqual(['a', 'b']);
});

test('membership admits an undated fact via temporal fail-open (temporallyUnverified)', () => {
  const undated: NormalizedFact = { kind: 'condition', factId: 'c1', code: 'E11.9', system: 'ICD-10',
    interval: { start: undefined, end: { kind: 'UNKNOWN' } }, recordValidity: 'VALID', validityBasis: 'verification:absent',
    provenance: { sourceType: 'SYNTHETIC' }, clinicalState: 'ACTIVE', stateBasis: 'FHIR_STATUS' };
  const out = selectFacts({ field: 'conditions', operator: 'includes_code', value: 'E11.9', system: 'ICD-10' }, [undated], { horizon: Q, status: 'active' });
  expect(out.status).toBe('READY');
  if (out.status === 'READY') { expect(out.selected).toHaveLength(1); expect(out.temporallyUnverified).toBe(true); }
});

test('CONFLICT state under status:active is excluded despite membership fail-open', () => {
  const out = selectFacts({ field: 'conditions', operator: 'includes_code', value: 'E11.9', system: 'ICD-10' }, [cond('c1', 'E11.9', 'CONFLICT')], { horizon: LIFE, status: 'active' });
  expect(out.status).toBe('NO_MATCH');
  expect(out.decisions[0].stateMatch).toBe('NO_MATCH');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test --prefix apps/pathway-service -- --runInBand src/__tests__/temporal/select-facts.test.ts`
Expected: FAIL — cannot find module `select-facts`.

- [ ] **Step 3: Write minimal implementation**

```ts
// apps/pathway-service/src/services/resolution/temporal/select-facts.ts
import { FactSelectionCondition, operatorClass, fieldToKind, UncertaintyReason } from './contract';
import { NormalizedFact, FactStore, isObservationFact } from './fact-model';
import { overlap, ResolvedHorizon, ThreeValued } from './overlap';
import { boundEpochRange } from './interval';

export interface EffectivePolicy { horizon: ResolvedHorizon; status?: 'active' | 'inactive' | 'any'; }
export interface FactDecision {
  fact: NormalizedFact;
  validityDecision: 'ADMIT' | 'DROP_INVALID' | 'UNKNOWN';
  stateMatch: 'MATCH' | 'NO_MATCH' | 'UNKNOWN' | 'NOT_APPLICABLE';
  temporalMatch: ThreeValued;
  operatorDecision: 'INCLUDE' | 'EXCLUDE' | 'INDETERMINATE';
}
export type SelectionOutcome =
  | { status: 'READY'; selected: NormalizedFact[]; decisions: FactDecision[];
      temporallyUnverified: boolean; stateUnverified: boolean; validityUnverified: boolean }
  | { status: 'NO_MATCH'; decisions: FactDecision[] }
  | { status: 'INDETERMINATE'; reasons: UncertaintyReason[]; decisions: FactDecision[] };

function codeMatches(factCode: string, pattern: string): boolean {
  if (pattern.endsWith('.*')) return factCode.startsWith(pattern.slice(0, -2));
  return factCode === pattern;
}

function candidateMatches(fact: NormalizedFact, cond: FactSelectionCondition): boolean {
  if (fact.kind !== fieldToKind(cond.field)) return false;
  if (cond.system && fact.system !== cond.system) return false;
  const klass = operatorClass(cond.operator);
  if (cond.operator === 'exists') return true;
  if (klass === 'membership') {
    return cond.operator === 'includes_code' ? codeMatches(fact.code, cond.value) : fact.code === cond.value;
  }
  // scalar / aggregate: observation with a finite numeric value on the requested code
  return isObservationFact(fact) && fact.code === cond.value && typeof fact.value === 'number' && Number.isFinite(fact.value);
}

function stateMatchFor(fact: NormalizedFact, status: EffectivePolicy['status']):
    { result: FactDecision['stateMatch']; unverified: boolean } {
  if (isObservationFact(fact)) return { result: 'NOT_APPLICABLE', unverified: false };
  const st = fact.clinicalState;
  const unverified = fact.stateBasis === 'MISSING_STATUS_FAIL_OPEN';
  if (status === undefined || status === 'any') {
    return { result: st === 'UNKNOWN' || st === 'CONFLICT' ? 'UNKNOWN' : 'MATCH', unverified };
  }
  if (st === 'CONFLICT') return { result: 'NO_MATCH', unverified };
  if (st === 'UNKNOWN') return { result: 'UNKNOWN', unverified };
  if (status === 'active') return { result: st === 'ACTIVE' ? 'MATCH' : 'NO_MATCH', unverified };
  return { result: st === 'INACTIVE' ? 'MATCH' : 'NO_MATCH', unverified };
}

function effectiveRange(fact: NormalizedFact): { loMs: number; hiMs: number } {
  if (fact.interval.start) return boundEpochRange(fact.interval.start);
  return { loMs: -Infinity, hiMs: Infinity };
}

// definite-latest: a fact whose earliest possible time is >= every other's latest possible time.
function definiteLatest(facts: NormalizedFact[]): NormalizedFact | null {
  for (const f of facts) {
    const fr = effectiveRange(f);
    if (facts.every(g => g === f || fr.loMs >= effectiveRange(g).hiMs)) return f;
  }
  return null;
}

export function selectFacts(condition: FactSelectionCondition, store: FactStore, policy: EffectivePolicy): SelectionOutcome {
  const klass = operatorClass(condition.operator);
  const decisions: FactDecision[] = [];

  for (const fact of store) {
    if (!candidateMatches(fact, condition)) continue;
    const validityDecision: FactDecision['validityDecision'] =
      fact.recordValidity === 'INVALID' ? 'DROP_INVALID' : fact.recordValidity === 'UNKNOWN' ? 'UNKNOWN' : 'ADMIT';
    const { result: stateMatch } = stateMatchFor(fact, policy.status);
    const temporalMatch = overlap(fact.interval, policy.horizon);

    let operatorDecision: FactDecision['operatorDecision'];
    if (validityDecision === 'DROP_INVALID' || stateMatch === 'NO_MATCH' || temporalMatch === 'NO_MATCH') {
      operatorDecision = 'EXCLUDE';
    } else {
      const anyUnknown = validityDecision === 'UNKNOWN' || stateMatch === 'UNKNOWN' || temporalMatch === 'UNKNOWN';
      operatorDecision = !anyUnknown ? 'INCLUDE' : (klass === 'membership' ? 'INCLUDE' : 'INDETERMINATE');
    }
    decisions.push({ fact, validityDecision, stateMatch, temporalMatch, operatorDecision });
  }

  const included = decisions.filter(d => d.operatorDecision === 'INCLUDE');
  const indeterminate = decisions.filter(d => d.operatorDecision === 'INDETERMINATE');

  const flags = (subset: FactDecision[]) => ({
    temporallyUnverified: subset.some(d => d.temporalMatch === 'UNKNOWN'),
    stateUnverified: subset.some(d => d.stateMatch === 'UNKNOWN' || (d.fact.kind !== 'lab' && d.fact.kind !== 'vital' && (d.fact as { stateBasis?: string }).stateBasis === 'MISSING_STATUS_FAIL_OPEN')),
    validityUnverified: subset.some(d => d.validityDecision === 'UNKNOWN'),
  });

  if (klass === 'membership') {
    if (included.length === 0) return { status: 'NO_MATCH', decisions };
    return { status: 'READY', selected: included.map(d => d.fact), decisions, ...flags(included) };
  }

  if (klass === 'scalar') {
    if (indeterminate.length > 0) {
      return { status: 'INDETERMINATE', reasons: ['TEMPORAL_UNKNOWN'], decisions };
    }
    if (included.length === 0) return { status: 'NO_MATCH', decisions };
    const winner = definiteLatest(included.map(d => d.fact));
    if (!winner) return { status: 'INDETERMINATE', reasons: ['AMBIGUOUS_LATEST'], decisions };
    return { status: 'READY', selected: [winner], decisions, ...flags(included) };
  }

  // aggregate
  if (included.length === 0 && indeterminate.length === 0) return { status: 'NO_MATCH', decisions };
  let selected: NormalizedFact[];
  if (condition.operator === 'count_in_window') {
    const seen = new Set<string>();
    selected = included.map(d => d.fact).filter(f => (seen.has(f.factId) ? false : (seen.add(f.factId), true)));
  } else {
    selected = [...included].sort((a, b) => effectiveRange(a.fact).loMs - effectiveRange(b.fact).loMs).map(d => d.fact);
  }
  return { status: 'READY', selected, decisions, ...flags(included) };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test --prefix apps/pathway-service -- --runInBand src/__tests__/temporal/select-facts.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck the temporal module**

Run: `npx tsc -p apps/pathway-service/tsconfig.json --noEmit`
Expected: no new errors under `services/resolution/temporal/`. Fix any `noImplicitAny`/`noImplicitReturns` issues before committing.

- [ ] **Step 6: Commit**

```bash
git -C apps/pathway-service add src/services/resolution/temporal/select-facts.ts src/__tests__/temporal/select-facts.test.ts
git commit -m "feat: selectFacts kernel with discriminated SelectionOutcome

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@example.com>"
```

---

## Self-Review

- **Spec coverage:** §2 fact model + strict partial dates + possible/established overlap (Tasks 1–3); §3 reconciled state + tri-state validity + decoupled dimensions (Tasks 4–5); §4 taxonomy (`equals` = membership) + operator-specific selection + deterministic latest (Tasks 0, 5). No fabricated `end = start`; `TemporalEnd` explicit. `factId` is a field, never hashed here (Plan 05 assigns it).
- **Accepted review corrections, mapped:** #1 overlap → Task 3 possible/established truth table (undated → UNKNOWN, 2020/unknown-end → UNKNOWN, and the Task-5 undated test now consistently sets `temporallyUnverified`); #2 → Task 0 temporal-owned contract, unknown-op rejection, no import from `resolution/types.ts`; #3 → Task 0 field→kind matrix + Task 5 operator-specific `candidateMatches` (wildcard `includes_code`, value-less `exists`, observation-only scalar, vitals kind); #4 → Task 5 discriminated `SelectionOutcome`; #5 → Task 2 strict parsing; #6 → Task 5 `definiteLatest` + epoch ordering; #7 → Task 4 (missing med status → UNKNOWN, uncertain verification → UNKNOWN, abatement+active → CONFLICT per round-3 design); #8 → corrected commands, `strict` claim, retained mandated trailer.
- **Deferred to later plans (correctly out of scope):** tier→bounds resolution via the clock (Plan 02); the cascade producing `EffectivePolicy` (Plan 03); the `GateCondition → FactSelectionCondition` adapter + numeric `<`/`>` on `selected` + interpreting `INDETERMINATE` as fail-closed (Plan 04); building a `FactStore` + `factId` assignment + vital always-current interval construction (Plans 05/07); evidence emission (Plan 08).
- **Type consistency:** `ResolvedHorizon`, `ThreeValued`, `FactDecision`, `SelectionOutcome`, `EffectivePolicy`, `FactSelectionCondition`, `NormalizedFact` are the exact names the overview's contract lists for Plans 02–08.
- **Placeholder scan:** none — every step has runnable code and an exact command.

## Execution Handoff

Plan complete and saved. Recommended: **subagent-driven-development** (fresh subagent per task, review between tasks) — the six tasks are independently testable. Alternatively **executing-plans** inline. Plans 02–09 will be written next, each grounded in the code this plan lands.

---

## Post-execution corrections (review round 4)

This plan was executed in full (commits `15b2f3e`…`0720e3d`, reconciled by
`3adb8a9`). A subsequent review of the **landed code** found six defects that
originate in this plan's Task 2 and Task 5 code blocks. They are fixed in
`d41f73f` and `e0b1b37`. The code blocks above are left as originally written —
this section is the authoritative delta, and anyone re-reading Tasks 2/5 should
apply it.

**Task 2 (`interval.ts`) — the "strict" parser was not strict.**
The instant regex matched a shape and delegated component validation to
`Date.parse`, which *normalizes* rather than rejects. Confirmed accepted by
probe: year `0000`, `2026-01-01T24:00:00Z` (silently rolled to Jan 2), and
offsets `+15:00` / `+14:01`. Every numeric component is now range-checked
explicitly: year 0001-9999, hour 00-23, minute 00-59, second 00-59, offset
bounded to ±14:00 per the FHIR R4 grammar.

Separately, `boundEpochRange` used `Date.UTC(y, ...)`, which maps years 0-99 to
1900+y — FHIR years `0001`-`0099` landed ~1900 years late. All bounds now build
through a `utcEpoch()` helper using `setUTCFullYear`.

**Deliberate narrowing:** FHIR permits `:60` (leap second); we reject it.
ECMAScript cannot represent a leap second, so accepting it would mean clamping
to `:59` or rolling the minute — the silent normalization this parser exists to
prevent.

**Task 5 (`select-facts.ts`) — four defects.**

1. **Candidate rules must be per-OPERATOR, not per-operator-class.** The landed
   `candidateMatches` required a finite-valued observation for the entire
   aggregate class, which broke `count_in_window` for conditions, medications,
   and allergies (returning `NO_MATCH` with zero decisions), wrongly required a
   numeric value on counted labs, and dropped wildcard support. The three
   aggregate operators do not share a rule. Correct rules, each mirroring the
   current evaluator so `legacy-v0` stays behavior-preserving:
   - `count_in_window` — any fact kind, trailing wildcard, **no** value
     requirement (`gate-evaluator.ts` walks every code bucket, not just labs).
   - `trend_*` / `delta_from_baseline` — observation, wildcard, finite value
     (`collectLabSeries` uses `matchesCodePattern`).
   - `greater_than` / `less_than` — observation, **exact** code, finite value
     (`getNumericValue` uses `===`).

2. **`definiteLatest` must compare strictly.** The landed `>=` meant two facts
   at the same exact instant each satisfied the predicate against the other, so
   the first array element won — the input-order dependence this kernel exists
   to remove. Now strictly after; equal instants → `AMBIGUOUS_LATEST`. The
   original test only covered two day-precision bounds, whose ranges overlap but
   are not zero-width, so it missed this.

3. **Aggregate uncertainty was labeled and then discarded.** Uncertain facts got
   `INDETERMINATE`, but the aggregate branch selected only from `included` and
   computed flags over `included`, so one uncertain lab returned `READY` with an
   empty selection and `validityUnverified: false`. Aggregates now fail
   **closed** per design §13, with the reasons retained on
   `FactDecision.uncertainty` (a new required field) and aggregate flags
   computed over included ∪ uncertain-excluded.

   Boundary decision not specified by the review: for aggregates, `NO_MATCH` now
   means "nothing matched the candidate rule at all". Candidates that matched
   but did not survive are a legitimate answer of zero — `READY` with an empty
   selection plus flags — rather than being conflated with "no such facts".

4. **Trend/delta series ordering must be proven, not merely sorted.** Sorting by
   lower bound alone left facts with equal or overlapping ranges (two
   month-precision results in the same month) in input order, which can invert
   baseline vs current in `delta_from_baseline`. The order is now proven
   pairwise (`prev.hiMs < next.loMs`), else `AMBIGUOUS_SERIES_ORDER` — a new
   `UncertaintyReason` added to Task 0's contract.

5. **`exists` applied the system filter before the existence check** (P2), so an
   `exists` condition carrying a different system returned `NO_MATCH`. It is
   bucket existence only, matching the current evaluator; Plan 04's adapter
   rejects a stray system/value at the authoring boundary.

6. **Scalar `INDETERMINATE` always reported `TEMPORAL_UNKNOWN`** (P2), even for a
   fact whose only uncertainty was validity. Reasons are now derived from the
   decisions and deduplicated.

**Verification after fixes:** temporal suite 57/57 pass (was 37); full
pathway-service suite 679 passed / 15 failed, the same 15 pre-existing failures
in `data-completeness-scorer`, `patient-match-scorer`, `ddi-multi-pathway`, and
`multi-pathway-resolution` that fail independently of this work (Plan 01 added
only new files — `git diff --stat 00e19c9..3adb8a9 -- apps/` is 12 files, all
insertions). Typecheck clean.

## Post-execution corrections (review round 5)

Two findings against `6da5012`'s parent. Both confirmed; both fixed.

**1. [P1] `status: any` did not actually bypass state filtering.** Task 5's
`stateMatchFor` mapped `UNKNOWN` and `CONFLICT` to `stateMatch: 'UNKNOWN'` even
under `any`. The round-4 aggregate policy (fail-closed on uncertainty) then
excluded those facts, so a valid, in-window condition with an `UNKNOWN` state
under `count_in_window` + `status: any` returned `READY` with an empty
selection — the bypass did the opposite of what it promised. RFC §3 is explicit:
`any` "admits every state including `UNKNOWN` and `CONFLICT`, each still marked
in evidence."

Under `any`, `stateMatchFor` now returns `MATCH` unconditionally. The doubt is
not discarded — it moves to a new `FactDecision.stateUnverified: boolean`, which
feeds the evidence flag and nothing else. This is the general shape of the fix:
**`uncertainty` drives operator decisions; `stateUnverified` only reports.**
Collapsing them is what caused the bug, because it let a bypassed filter's doubt
reach the operator policy.

`status: active` / `inactive` are unchanged and now have regression tests:
`CONFLICT` still excludes (a temporal fail-open must not silently resolve a
clinical-state conflict, per §3) and `UNKNOWN` is still uncertain.

`flags()` no longer recomputes state doubt from `stateBasis`; it reads
`d.stateUnverified`, so `stateMatchFor` is the single source of truth. Note this
makes `stateUnverified` true in one case where it previously was not: an
`UNKNOWN` clinical state under `status: active` (previously only
`MISSING_STATUS_FAIL_OPEN` set it). That is the correct reading of "state not
established."

**2. [P2] The suite overview's locked contract had gone stale.** Round 4 added
`FactDecision.uncertainty` and `AMBIGUOUS_SERIES_ORDER`; this round adds
`FactDecision.stateUnverified`. None had been published in the overview's
cross-plan contract, which later plans treat as their locked interface — Plan 08
in particular would have built evidence surfaces that omit all three. The
overview now carries them plus a normative note that execution-time contract
changes must be published in the same commit.

Also corrected in the overview while there: the Global Constraints' commands
(no `typecheck` script; `npx tsc` hits a decoy package; Jest's `testRegex`
requires `src/__tests__/`), and the `Co-Authored-By` trailer, which specified an
`@anthropic.com` address two lines after forbidding exactly that.

**Verification:** temporal suite 63/63 (was 57). Full pathway-service suite 685
passed / 15 failed — the same pre-existing 15 across the same four suites.
Typecheck clean; `git diff --check` clean.
