# Temporal Horizon — Plan 01: Normalized Fact Model + `selectFacts` Kernel

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the pure, dependency-free foundation of the temporal-horizon feature — the normalized fact types, FHIR partial-date parsing, three-valued interval overlap, the FHIR→clinical-state/validity mapping, and the `selectFacts` kernel that decides validity/state/temporal per fact and narrows to the operator's selection — all as unit-tested pure functions with no I/O, no clock, and no wiring into the evaluator.

**Architecture:** New code lives under `apps/pathway-service/src/services/resolution/temporal/`. Every function is pure: no DB, no `Date.now()`, no GraphQL. Horizons arrive pre-resolved as `{lowerBound, upperBound}` (the clock that resolves tiers is Plan 02), so this layer never reads a clock. Nothing here is imported by the live evaluator yet — Plan 04 does that wiring.

**Tech Stack:** TypeScript 5 strict, Jest + ts-jest.

## Global Constraints

- TypeScript strict (`noImplicitAny`, `noImplicitReturns`). Tests are `*.test.ts` under `src/__tests__/`. Run a single test file with `npx --prefix apps/pathway-service jest <relative-path>`.
- This plan touches **only** files under `apps/pathway-service/src/services/resolution/temporal/` and its tests. It must not modify `gate-evaluator.ts`, `snapshot-context.ts`, or any resolver — those are later plans. Live routing is unchanged.
- Commit prefixes `feat:`/`test:`; end messages with `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- Design reference: `docs/superpowers/specs/2026-07-21-pathway-temporal-horizon-design.md` §2, §3, §4.

---

### Task 1: Fact-model types and guards

**Files:**
- Create: `apps/pathway-service/src/services/resolution/temporal/fact-model.ts`
- Test: `apps/pathway-service/src/__tests__/temporal/fact-model.test.ts`

**Interfaces:**
- Consumes: nothing (leaf module).
- Produces: `TemporalBound`, `TemporalEnd`, `FactBase`, `StatefulFact`, `LabFact`, `NormalizedFact`, `FactStore`, `isLabFact`, `isStatefulFact`.

- [ ] **Step 1: Write the failing test**

```ts
// apps/pathway-service/src/__tests__/temporal/fact-model.test.ts
import { isLabFact, isStatefulFact, NormalizedFact } from '../../services/resolution/temporal/fact-model';

const lab: NormalizedFact = {
  kind: 'lab', factId: 'f1', code: '718-7', system: 'LOINC',
  interval: { start: { value: '2026-01-01', precision: 'day' }, end: { kind: 'KNOWN', bound: { value: '2026-01-01', precision: 'day' } } },
  recordValidity: 'VALID', validityBasis: 'observation:final',
  provenance: { sourceType: 'SYNTHETIC' }, value: 10.2, unit: 'g/dL', observationStatus: 'final',
};
const cond: NormalizedFact = {
  kind: 'condition', factId: 'f2', code: 'E11.9', system: 'ICD-10',
  interval: { start: { value: '2020', precision: 'year' }, end: { kind: 'OPEN', assertedCurrentAt: '2026-07-01' } },
  recordValidity: 'VALID', validityBasis: 'verification:confirmed',
  provenance: { sourceType: 'SYNTHETIC' }, clinicalState: 'ACTIVE', stateBasis: 'FHIR_STATUS',
};

test('type guards discriminate on kind', () => {
  expect(isLabFact(lab)).toBe(true);
  expect(isStatefulFact(lab)).toBe(false);
  expect(isStatefulFact(cond)).toBe(true);
  expect(isLabFact(cond)).toBe(false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx --prefix apps/pathway-service jest src/__tests__/temporal/fact-model.test.ts`
Expected: FAIL — cannot find module `fact-model`.

- [ ] **Step 3: Write minimal implementation**

```ts
// apps/pathway-service/src/services/resolution/temporal/fact-model.ts

export interface TemporalBound {
  value: string; // FHIR date string: YYYY | YYYY-MM | YYYY-MM-DD | full instant
  precision: 'year' | 'month' | 'day' | 'instant';
}

export type TemporalEnd =
  | { kind: 'KNOWN'; bound: TemporalBound }        // a real end (abatement, resolution, stop)
  | { kind: 'OPEN'; assertedCurrentAt: string }    // ongoing, known-current only as of this instant
  | { kind: 'UNKNOWN' };                           // no usable end signal — never invent one

export interface FactBase {
  factId: string;              // assigned + persisted at ingestion; never a lossy hash
  code: string;
  system: string;
  display?: string;
  interval: { start?: TemporalBound; end: TemporalEnd };
  recordValidity: 'VALID' | 'INVALID' | 'UNKNOWN';
  validityBasis: string;
  provenance: { sourceType: 'FHIR' | 'SYNTHETIC'; sourceId?: string; snapshotId?: string };
}

export type ClinicalState = 'ACTIVE' | 'INACTIVE' | 'ON_HOLD' | 'UNKNOWN' | 'CONFLICT';
export type StateBasis =
  | 'FHIR_STATUS' | 'ABATEMENT' | 'SNAPSHOT_ASSERTION' | 'SYNTHETIC' | 'MISSING_STATUS_FAIL_OPEN';

export interface StatefulFact extends FactBase {
  kind: 'condition' | 'medication_order' | 'allergy';
  clinicalState: ClinicalState;
  stateAsOf?: string;
  stateBasis: StateBasis;
}

export interface LabFact extends FactBase {
  kind: 'lab';
  value?: number;
  unit?: string;
  observationStatus?: string;
  issuedAt?: string;
}

export type NormalizedFact = StatefulFact | LabFact;
export type FactStore = ReadonlyArray<NormalizedFact>;

export function isLabFact(f: NormalizedFact): f is LabFact {
  return f.kind === 'lab';
}
export function isStatefulFact(f: NormalizedFact): f is StatefulFact {
  return f.kind !== 'lab';
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx --prefix apps/pathway-service jest src/__tests__/temporal/fact-model.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git -C apps/pathway-service add src/services/resolution/temporal/fact-model.ts src/__tests__/temporal/fact-model.test.ts
git commit -m "feat: normalized temporal fact model types + guards

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: FHIR partial-date parsing → precision-aware ranges

**Files:**
- Create: `apps/pathway-service/src/services/resolution/temporal/interval.ts`
- Test: `apps/pathway-service/src/__tests__/temporal/interval.test.ts`

**Interfaces:**
- Consumes: `TemporalBound` from `fact-model.ts`.
- Produces: `parseFhirDate(s: string | null | undefined): TemporalBound | null`; `boundRange(b: TemporalBound): { lo: string; hi: string }` where `lo`/`hi` are ISO instants spanning the bound's precision (e.g. `2026` → `2026-01-01T00:00:00.000Z` … `2026-12-31T23:59:59.999Z`).

- [ ] **Step 1: Write the failing test**

```ts
// apps/pathway-service/src/__tests__/temporal/interval.test.ts
import { parseFhirDate, boundRange } from '../../services/resolution/temporal/interval';

test('parseFhirDate reads each FHIR precision', () => {
  expect(parseFhirDate('2026')).toEqual({ value: '2026', precision: 'year' });
  expect(parseFhirDate('2026-03')).toEqual({ value: '2026-03', precision: 'month' });
  expect(parseFhirDate('2026-03-14')).toEqual({ value: '2026-03-14', precision: 'day' });
  expect(parseFhirDate('2026-03-14T09:30:00Z')).toEqual({ value: '2026-03-14T09:30:00Z', precision: 'instant' });
});

test('parseFhirDate returns null for empty or malformed input', () => {
  expect(parseFhirDate(null)).toBeNull();
  expect(parseFhirDate(undefined)).toBeNull();
  expect(parseFhirDate('')).toBeNull();
  expect(parseFhirDate('not-a-date')).toBeNull();
});

test('boundRange expands precision to inclusive instant span', () => {
  expect(boundRange({ value: '2026', precision: 'year' })).toEqual({
    lo: '2026-01-01T00:00:00.000Z', hi: '2026-12-31T23:59:59.999Z',
  });
  expect(boundRange({ value: '2026-03', precision: 'month' })).toEqual({
    lo: '2026-03-01T00:00:00.000Z', hi: '2026-03-31T23:59:59.999Z',
  });
  const day = boundRange({ value: '2026-03-14', precision: 'day' });
  expect(day.lo).toBe('2026-03-14T00:00:00.000Z');
  expect(day.hi).toBe('2026-03-14T23:59:59.999Z');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx --prefix apps/pathway-service jest src/__tests__/temporal/interval.test.ts`
Expected: FAIL — cannot find module `interval`.

- [ ] **Step 3: Write minimal implementation**

```ts
// apps/pathway-service/src/services/resolution/temporal/interval.ts
import { TemporalBound } from './fact-model';

const YEAR = /^(\d{4})$/;
const MONTH = /^(\d{4})-(\d{2})$/;
const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

export function parseFhirDate(s: string | null | undefined): TemporalBound | null {
  if (!s || typeof s !== 'string') return null;
  const trimmed = s.trim();
  if (YEAR.test(trimmed)) return { value: trimmed, precision: 'year' };
  if (MONTH.test(trimmed)) return { value: trimmed, precision: 'month' };
  if (DAY.test(trimmed)) return { value: trimmed, precision: 'day' };
  const t = Date.parse(trimmed);
  if (!Number.isNaN(t)) return { value: trimmed, precision: 'instant' };
  return null;
}

function pad(n: number, w = 2): string { return String(n).padStart(w, '0'); }

export function boundRange(b: TemporalBound): { lo: string; hi: string } {
  if (b.precision === 'instant') {
    const iso = new Date(b.value).toISOString();
    return { lo: iso, hi: iso };
  }
  const [yStr, mStr, dStr] = b.value.split('-');
  const y = Number(yStr);
  if (b.precision === 'year') {
    return { lo: `${yStr}-01-01T00:00:00.000Z`, hi: `${yStr}-12-31T23:59:59.999Z` };
  }
  if (b.precision === 'month') {
    const m = Number(mStr);
    const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate(); // day 0 of next month = last of this
    return { lo: `${yStr}-${pad(m)}-01T00:00:00.000Z`, hi: `${yStr}-${pad(m)}-${pad(lastDay)}T23:59:59.999Z` };
  }
  // day
  return { lo: `${yStr}-${pad(Number(mStr))}-${pad(Number(dStr))}T00:00:00.000Z`,
           hi: `${yStr}-${pad(Number(mStr))}-${pad(Number(dStr))}T23:59:59.999Z` };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx --prefix apps/pathway-service jest src/__tests__/temporal/interval.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git -C apps/pathway-service add src/services/resolution/temporal/interval.ts src/__tests__/temporal/interval.test.ts
git commit -m "feat: FHIR partial-date parsing with precision-aware ranges

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Three-valued interval overlap

**Files:**
- Create: `apps/pathway-service/src/services/resolution/temporal/overlap.ts`
- Test: `apps/pathway-service/src/__tests__/temporal/overlap.test.ts`

**Interfaces:**
- Consumes: `FactBase`, `TemporalEnd` (`fact-model.ts`); `parseFhirDate`, `boundRange` (`interval.ts`).
- Produces: `type ThreeValued = 'MATCH' | 'NO_MATCH' | 'UNKNOWN'`; `interface ResolvedHorizon { lowerBound: string | null; upperBound: string }` (instants; `lowerBound: null` = LIFETIME; `upperBound` = `evaluationAsOf`); `overlap(interval: FactBase['interval'], horizon: ResolvedHorizon): ThreeValued`.

**Overlap rules (design §2):** the fact's known-active span is `[startLo, endHi]`. `MATCH` iff that span provably intersects `[lowerBound, upperBound]`. Future facts (start after `upperBound`) are `NO_MATCH`. Undated start (`start` missing) → span begins at `-∞`. `OPEN` end contributes coverage only to `assertedCurrentAt`; if the whole horizon lies after it → `UNKNOWN`. `UNKNOWN` end with a dated start covers only the start instant. A partial-date straddle of a bound → `UNKNOWN`.

- [ ] **Step 1: Write the failing test**

```ts
// apps/pathway-service/src/__tests__/temporal/overlap.test.ts
import { overlap, ResolvedHorizon } from '../../services/resolution/temporal/overlap';
import { FactBase } from '../../services/resolution/temporal/fact-model';

const Q: ResolvedHorizon = { lowerBound: '2026-04-27T00:00:00.000Z', upperBound: '2026-07-26T00:00:00.000Z' }; // ~QUARTER
const LIFE: ResolvedHorizon = { lowerBound: null, upperBound: '2026-07-26T00:00:00.000Z' };
const iv = (start: string | undefined, end: FactBase['interval']['end']): FactBase['interval'] =>
  ({ start: start ? { value: start, precision: start.length === 4 ? 'year' : 'day' } : undefined, end });

test('dated instant inside the window is MATCH', () => {
  expect(overlap(iv('2026-05-10', { kind: 'KNOWN', bound: { value: '2026-05-10', precision: 'day' } }), Q)).toBe('MATCH');
});
test('dated instant before the window is NO_MATCH', () => {
  expect(overlap(iv('2026-01-10', { kind: 'KNOWN', bound: { value: '2026-01-10', precision: 'day' } }), Q)).toBe('NO_MATCH');
});
test('future fact (after upperBound) is NO_MATCH', () => {
  expect(overlap(iv('2026-08-10', { kind: 'KNOWN', bound: { value: '2026-08-10', precision: 'day' } }), Q)).toBe('NO_MATCH');
});
test('OPEN end asserted inside the window is MATCH even with old start', () => {
  expect(overlap(iv('2019-01-01', { kind: 'OPEN', assertedCurrentAt: '2026-06-01T00:00:00.000Z' }), Q)).toBe('MATCH');
});
test('OPEN end asserted before the whole window is UNKNOWN', () => {
  expect(overlap(iv('2019-01-01', { kind: 'OPEN', assertedCurrentAt: '2026-01-01T00:00:00.000Z' }), Q)).toBe('UNKNOWN');
});
test('active fact with no onset but OPEN asserted in-window is MATCH', () => {
  expect(overlap(iv(undefined, { kind: 'OPEN', assertedCurrentAt: '2026-06-01T00:00:00.000Z' }), Q)).toBe('MATCH');
});
test('UNKNOWN end with dated start outside window is NO_MATCH', () => {
  expect(overlap(iv('2026-01-10', { kind: 'UNKNOWN' }), Q)).toBe('NO_MATCH');
});
test('year-precision start straddling the lower bound is UNKNOWN', () => {
  // 2026 spans Jan–Dec; lowerBound is 2026-04-27, so the year straddles it
  expect(overlap(iv('2026', { kind: 'UNKNOWN' }), Q)).toBe('UNKNOWN');
});
test('everything overlaps LIFETIME', () => {
  expect(overlap(iv('2001-01-01', { kind: 'UNKNOWN' }), LIFE)).toBe('MATCH');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx --prefix apps/pathway-service jest src/__tests__/temporal/overlap.test.ts`
Expected: FAIL — cannot find module `overlap`.

- [ ] **Step 3: Write minimal implementation**

```ts
// apps/pathway-service/src/services/resolution/temporal/overlap.ts
import { FactBase } from './fact-model';
import { boundRange } from './interval';

export type ThreeValued = 'MATCH' | 'NO_MATCH' | 'UNKNOWN';
export interface ResolvedHorizon { lowerBound: string | null; upperBound: string; }

// Coverage span of the fact as [lo, hi] instants, with straddle flags.
function span(interval: FactBase['interval']): { lo: string | null; hi: string | null; startStraddles: boolean } {
  const start = interval.start ? boundRange(interval.start) : null; // null start = -∞
  const lo = start ? start.lo : null;
  const startStraddles = start ? start.lo !== start.hi : false;

  let hi: string | null;
  switch (interval.end.kind) {
    case 'KNOWN': hi = boundRange(interval.end.bound).hi; break;
    case 'OPEN': hi = interval.end.assertedCurrentAt; break;
    case 'UNKNOWN': hi = start ? start.hi : null; break; // dated start → instant; undated → +∞ handled below
  }
  return { lo, hi, startStraddles };
}

export function overlap(interval: FactBase['interval'], horizon: ResolvedHorizon): ThreeValued {
  const { lo, hi, startStraddles } = span(interval);
  const hLo = horizon.lowerBound; // null = -∞
  const hUp = horizon.upperBound;

  // Future fact: known start after the horizon's upper bound.
  if (lo !== null && lo > hUp) return 'NO_MATCH';

  // Effective coverage hi: undated UNKNOWN end with no start = +∞ (LIFETIME-only match).
  const covHi = hi; // null means +∞
  const covLo = lo; // null means -∞

  // Does [covLo, covHi] provably intersect [hLo, hUp]?
  const startsAfterHorizon = covLo !== null && covLo > hUp;
  const endsBeforeHorizon = covHi !== null && hLo !== null && covHi < hLo;

  if (startsAfterHorizon || endsBeforeHorizon) {
    // For OPEN ends whose assertedCurrentAt precedes the window, we cannot prove NO_MATCH
    // (the fact may still be ongoing) — that is UNKNOWN, not NO_MATCH.
    if (interval.end.kind === 'OPEN' && endsBeforeHorizon) return 'UNKNOWN';
    return 'NO_MATCH';
  }

  // If the only thing standing between us and MATCH is an undated/partial ambiguity, return UNKNOWN.
  if (startStraddles && covLo !== null && hLo !== null && covLo <= hLo) {
    // year/month start whose range straddles the lower bound
    const startHi = interval.start ? boundRange(interval.start).hi : null;
    if (startHi !== null && startHi >= hLo && covLo < hLo) return 'UNKNOWN';
  }

  return 'MATCH';
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx --prefix apps/pathway-service jest src/__tests__/temporal/overlap.test.ts`
Expected: PASS. If the straddle case fails, verify `boundRange` hi for year precision is `2026-12-31T23:59:59.999Z` and that the `NO_MATCH`/`UNKNOWN` ordering matches the rules block above.

- [ ] **Step 5: Commit**

```bash
git -C apps/pathway-service add src/services/resolution/temporal/overlap.ts src/__tests__/temporal/overlap.test.ts
git commit -m "feat: three-valued interval overlap (MATCH/NO_MATCH/UNKNOWN)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: FHIR → clinical-state and record-validity mapping

**Files:**
- Create: `apps/pathway-service/src/services/resolution/temporal/state-mapping.ts`
- Test: `apps/pathway-service/src/__tests__/temporal/state-mapping.test.ts`

**Interfaces:**
- Consumes: `ClinicalState`, `StateBasis` (`fact-model.ts`).
- Produces:
  - `deriveConditionState(i: { clinicalStatus: string | null; hasAbatement: boolean }): { clinicalState: ClinicalState; stateBasis: StateBasis }`
  - `deriveMedicationState(i: { status: string | null }): { clinicalState: ClinicalState; stateBasis: StateBasis }`
  - `deriveAllergyState(i: { clinicalStatus: string | null }): { clinicalState: ClinicalState; stateBasis: StateBasis }`
  - `deriveValidity(i: { kind: 'condition' | 'allergy' | 'medication_order' | 'lab'; verificationStatus?: string | null; observationStatus?: string | null; medStatus?: string | null }): { recordValidity: 'VALID' | 'INVALID' | 'UNKNOWN'; validityBasis: string }`
- Inputs are already-extracted lowercase code strings; JSONB extraction is the caller's job (Plans 05/07).

- [ ] **Step 1: Write the failing test**

```ts
// apps/pathway-service/src/__tests__/temporal/state-mapping.test.ts
import {
  deriveConditionState, deriveMedicationState, deriveAllergyState, deriveValidity,
} from '../../services/resolution/temporal/state-mapping';

test('condition: active status, no abatement → ACTIVE/FHIR_STATUS', () => {
  expect(deriveConditionState({ clinicalStatus: 'active', hasAbatement: false }))
    .toEqual({ clinicalState: 'ACTIVE', stateBasis: 'FHIR_STATUS' });
});
test('condition: recurrence/relapse count as active', () => {
  expect(deriveConditionState({ clinicalStatus: 'relapse', hasAbatement: false }).clinicalState).toBe('ACTIVE');
});
test('condition: abatement + resolved → INACTIVE/ABATEMENT', () => {
  expect(deriveConditionState({ clinicalStatus: 'resolved', hasAbatement: true }))
    .toEqual({ clinicalState: 'INACTIVE', stateBasis: 'ABATEMENT' });
});
test('condition: abatement + active is contradictory → CONFLICT', () => {
  expect(deriveConditionState({ clinicalStatus: 'active', hasAbatement: true }).clinicalState).toBe('CONFLICT');
});
test('condition: missing status, no abatement → ACTIVE fail-open', () => {
  expect(deriveConditionState({ clinicalStatus: null, hasAbatement: false }))
    .toEqual({ clinicalState: 'ACTIVE', stateBasis: 'MISSING_STATUS_FAIL_OPEN' });
});
test('medication: on-hold and draft map distinctly', () => {
  expect(deriveMedicationState({ status: 'on-hold' }).clinicalState).toBe('ON_HOLD');
  expect(deriveMedicationState({ status: 'draft' }).clinicalState).toBe('UNKNOWN');
  expect(deriveMedicationState({ status: 'stopped' }).clinicalState).toBe('INACTIVE');
});
test('validity: refuted condition and cancelled observation are INVALID', () => {
  expect(deriveValidity({ kind: 'condition', verificationStatus: 'refuted' }).recordValidity).toBe('INVALID');
  expect(deriveValidity({ kind: 'lab', observationStatus: 'entered-in-error' }).recordValidity).toBe('INVALID');
});
test('validity: preliminary/registered observation is UNKNOWN; final is VALID', () => {
  expect(deriveValidity({ kind: 'lab', observationStatus: 'preliminary' }).recordValidity).toBe('UNKNOWN');
  expect(deriveValidity({ kind: 'lab', observationStatus: 'corrected' }).recordValidity).toBe('VALID');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx --prefix apps/pathway-service jest src/__tests__/temporal/state-mapping.test.ts`
Expected: FAIL — cannot find module `state-mapping`.

- [ ] **Step 3: Write minimal implementation**

```ts
// apps/pathway-service/src/services/resolution/temporal/state-mapping.ts
import { ClinicalState, StateBasis } from './fact-model';

const CONDITION_ACTIVE = new Set(['active', 'recurrence', 'relapse']);
const CONDITION_INACTIVE = new Set(['inactive', 'remission', 'resolved']);

export function deriveConditionState(
  i: { clinicalStatus: string | null; hasAbatement: boolean },
): { clinicalState: ClinicalState; stateBasis: StateBasis } {
  const s = i.clinicalStatus?.toLowerCase() ?? null;
  if (i.hasAbatement) {
    if (s && CONDITION_ACTIVE.has(s)) return { clinicalState: 'CONFLICT', stateBasis: 'ABATEMENT' };
    return { clinicalState: 'INACTIVE', stateBasis: 'ABATEMENT' };
  }
  if (s === null) return { clinicalState: 'ACTIVE', stateBasis: 'MISSING_STATUS_FAIL_OPEN' };
  if (CONDITION_ACTIVE.has(s)) return { clinicalState: 'ACTIVE', stateBasis: 'FHIR_STATUS' };
  if (CONDITION_INACTIVE.has(s)) return { clinicalState: 'INACTIVE', stateBasis: 'FHIR_STATUS' };
  return { clinicalState: 'UNKNOWN', stateBasis: 'FHIR_STATUS' };
}

export function deriveMedicationState(
  i: { status: string | null },
): { clinicalState: ClinicalState; stateBasis: StateBasis } {
  const s = i.status?.toLowerCase() ?? null;
  if (s === null) return { clinicalState: 'ACTIVE', stateBasis: 'MISSING_STATUS_FAIL_OPEN' };
  if (s === 'active') return { clinicalState: 'ACTIVE', stateBasis: 'FHIR_STATUS' };
  if (s === 'on-hold') return { clinicalState: 'ON_HOLD', stateBasis: 'FHIR_STATUS' };
  if (s === 'stopped' || s === 'completed' || s === 'cancelled') return { clinicalState: 'INACTIVE', stateBasis: 'FHIR_STATUS' };
  return { clinicalState: 'UNKNOWN', stateBasis: 'FHIR_STATUS' }; // draft, unknown, entered-in-error (validity drops it separately)
}

export function deriveAllergyState(
  i: { clinicalStatus: string | null },
): { clinicalState: ClinicalState; stateBasis: StateBasis } {
  const s = i.clinicalStatus?.toLowerCase() ?? null;
  if (s === null) return { clinicalState: 'ACTIVE', stateBasis: 'MISSING_STATUS_FAIL_OPEN' };
  if (s === 'active') return { clinicalState: 'ACTIVE', stateBasis: 'FHIR_STATUS' };
  if (s === 'inactive' || s === 'resolved') return { clinicalState: 'INACTIVE', stateBasis: 'FHIR_STATUS' };
  return { clinicalState: 'UNKNOWN', stateBasis: 'FHIR_STATUS' };
}

const OBS_VALID = new Set(['final', 'amended', 'corrected']);
const OBS_INVALID = new Set(['cancelled', 'entered-in-error']);
const OBS_UNKNOWN = new Set(['registered', 'preliminary', 'unknown']);

export function deriveValidity(
  i: { kind: 'condition' | 'allergy' | 'medication_order' | 'lab';
       verificationStatus?: string | null; observationStatus?: string | null; medStatus?: string | null },
): { recordValidity: 'VALID' | 'INVALID' | 'UNKNOWN'; validityBasis: string } {
  if (i.kind === 'condition' || i.kind === 'allergy') {
    const v = i.verificationStatus?.toLowerCase() ?? null;
    if (v === 'refuted' || v === 'entered-in-error') return { recordValidity: 'INVALID', validityBasis: `verification:${v}` };
    return { recordValidity: 'VALID', validityBasis: v ? `verification:${v}` : 'verification:absent' };
  }
  if (i.kind === 'medication_order') {
    const s = i.medStatus?.toLowerCase() ?? null;
    if (s === 'entered-in-error') return { recordValidity: 'INVALID', validityBasis: 'medication:entered-in-error' };
    return { recordValidity: 'VALID', validityBasis: s ? `medication:${s}` : 'medication:absent' };
  }
  // lab / vital
  const o = i.observationStatus?.toLowerCase() ?? null;
  if (o && OBS_INVALID.has(o)) return { recordValidity: 'INVALID', validityBasis: `observation:${o}` };
  if (o && OBS_VALID.has(o)) return { recordValidity: 'VALID', validityBasis: `observation:${o}` };
  if (o && OBS_UNKNOWN.has(o)) return { recordValidity: 'UNKNOWN', validityBasis: `observation:${o}` };
  return { recordValidity: 'UNKNOWN', validityBasis: o ? `observation:${o}` : 'observation:absent' };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx --prefix apps/pathway-service jest src/__tests__/temporal/state-mapping.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git -C apps/pathway-service add src/services/resolution/temporal/state-mapping.ts src/__tests__/temporal/state-mapping.test.ts
git commit -m "feat: FHIR clinical-state + record-validity mapping

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: The `selectFacts` kernel

**Files:**
- Create: `apps/pathway-service/src/services/resolution/temporal/select-facts.ts`
- Test: `apps/pathway-service/src/__tests__/temporal/select-facts.test.ts`

**Interfaces:**
- Consumes: `NormalizedFact`, `FactStore`, `isLabFact` (`fact-model.ts`); `overlap`, `ResolvedHorizon`, `ThreeValued` (`overlap.ts`); `CodedCondition`, `CodedOperator` (`resolution/types.ts`).
- Produces:
```ts
type OperatorClass = 'membership' | 'scalar' | 'aggregate';
function operatorClass(op: CodedOperator): OperatorClass;
interface EffectivePolicy { horizon: ResolvedHorizon; status?: 'active' | 'inactive' | 'any'; }
interface FactDecision {
  fact: NormalizedFact;
  validityDecision: 'ADMIT' | 'DROP_INVALID' | 'UNKNOWN';
  stateMatch: 'MATCH' | 'NO_MATCH' | 'UNKNOWN' | 'NOT_APPLICABLE';
  temporalMatch: ThreeValued;
  operatorDecision: 'INCLUDE' | 'EXCLUDE' | 'INDETERMINATE';
}
interface SelectionResult {
  decisions: FactDecision[];
  selected: NormalizedFact[];
  temporallyUnverified: boolean; stateUnverified: boolean; validityUnverified: boolean;
}
function selectFacts(condition: CodedCondition, store: FactStore, policy: EffectivePolicy): SelectionResult;
```

**Decision rules (design §3, §4):**
- Field filter: only facts whose `system`/`code` match the condition (`code` match applies to membership; scalar/aggregate match on `code` = the condition's `value`, which is the LOINC etc.).
- `validityDecision`: `INVALID` → `DROP_INVALID`; `UNKNOWN` → `UNKNOWN` (`validityUnverified`); else `ADMIT`.
- `stateMatch` (labs → `NOT_APPLICABLE`): `active` → MATCH iff `ACTIVE` (MATCH-but-`stateUnverified` if `MISSING_STATUS_FAIL_OPEN`); `inactive` → MATCH iff `INACTIVE`; `any` → MATCH for all; `UNKNOWN` state → `UNKNOWN`; `CONFLICT` under active/inactive → `NO_MATCH`.
- `temporalMatch`: `overlap(fact.interval, policy.horizon)`.
- `operatorDecision`: `DROP_INVALID` or any dimension `NO_MATCH` → `EXCLUDE`. All pass → `INCLUDE`. Otherwise some dimension `UNKNOWN`: membership → `INCLUDE` (fail-open); scalar/aggregate → `INDETERMINATE`.
- `selected`: membership → all `INCLUDE`. scalar → the single latest-dated `INCLUDE`. `count_in_window` → distinct-`factId` `INCLUDE`. trend/delta → `INCLUDE` sorted ascending by effective time.

- [ ] **Step 1: Write the failing test**

```ts
// apps/pathway-service/src/__tests__/temporal/select-facts.test.ts
import { selectFacts, operatorClass } from '../../services/resolution/temporal/select-facts';
import { NormalizedFact } from '../../services/resolution/temporal/fact-model';
import { ResolvedHorizon } from '../../services/resolution/temporal/overlap';

const Q: ResolvedHorizon = { lowerBound: '2026-04-27T00:00:00.000Z', upperBound: '2026-07-26T00:00:00.000Z' };
const LIFE: ResolvedHorizon = { lowerBound: null, upperBound: '2026-07-26T00:00:00.000Z' };

function lab(factId: string, day: string, value: number, valid = true): NormalizedFact {
  return { kind: 'lab', factId, code: '718-7', system: 'LOINC', value, unit: 'g/dL',
    observationStatus: valid ? 'final' : 'entered-in-error',
    interval: { start: { value: day, precision: 'day' }, end: { kind: 'KNOWN', bound: { value: day, precision: 'day' } } },
    recordValidity: valid ? 'VALID' : 'INVALID', validityBasis: valid ? 'observation:final' : 'observation:entered-in-error',
    provenance: { sourceType: 'SYNTHETIC' } };
}
function cond(factId: string, code: string, state: NormalizedFact extends infer T ? any : never): NormalizedFact {
  return { kind: 'condition', factId, code, system: 'ICD-10',
    interval: { start: { value: '2020', precision: 'year' }, end: { kind: 'OPEN', assertedCurrentAt: '2026-06-01T00:00:00.000Z' } },
    recordValidity: 'VALID', validityBasis: 'verification:confirmed', provenance: { sourceType: 'SYNTHETIC' },
    clinicalState: state, stateBasis: 'FHIR_STATUS' };
}

test('operatorClass taxonomy: equals is membership, not scalar', () => {
  expect(operatorClass('equals')).toBe('membership');
  expect(operatorClass('includes_code')).toBe('membership');
  expect(operatorClass('less_than')).toBe('scalar');
  expect(operatorClass('count_in_window')).toBe('aggregate');
});

test('scalar less_than selects the LATEST in-window valid lab, not array order', () => {
  const store = [lab('a', '2026-05-01', 10), lab('b', '2026-07-01', 12)];
  const res = selectFacts({ field: 'labs', operator: 'less_than', value: '718-7', system: 'LOINC', threshold: 11 }, store, { horizon: Q });
  expect(res.selected).toHaveLength(1);
  expect(res.selected[0].factId).toBe('b'); // 2026-07-01 is latest
});

test('invalid (entered-in-error) labs are dropped', () => {
  const store = [lab('a', '2026-07-01', 9, false)];
  const res = selectFacts({ field: 'labs', operator: 'less_than', value: '718-7', system: 'LOINC', threshold: 11 }, store, { horizon: Q });
  expect(res.selected).toHaveLength(0);
  expect(res.decisions[0].operatorDecision).toBe('EXCLUDE');
});

test('count_in_window counts distinct factIds', () => {
  const store = [lab('a', '2026-05-01', 10), lab('b', '2026-06-01', 10)];
  const res = selectFacts({ field: 'labs', operator: 'count_in_window', value: '718-7', system: 'LOINC' }, store, { horizon: Q });
  expect(res.selected.map(f => f.factId).sort()).toEqual(['a', 'b']);
});

test('membership includes an undated fact via temporal fail-open (temporallyUnverified)', () => {
  const undatedCond: NormalizedFact = { kind: 'condition', factId: 'c1', code: 'E11.9', system: 'ICD-10',
    interval: { start: undefined, end: { kind: 'UNKNOWN' } }, recordValidity: 'VALID', validityBasis: 'verification:absent',
    provenance: { sourceType: 'SYNTHETIC' }, clinicalState: 'ACTIVE', stateBasis: 'FHIR_STATUS' };
  const res = selectFacts({ field: 'conditions', operator: 'includes_code', value: 'E11.9', system: 'ICD-10' },
    [undatedCond], { horizon: Q, status: 'active' });
  expect(res.selected).toHaveLength(1);
  expect(res.temporallyUnverified).toBe(true);
});

test('CONFLICT state under status:active is excluded despite membership fail-open', () => {
  const store = [cond('c1', 'E11.9', 'CONFLICT')];
  const res = selectFacts({ field: 'conditions', operator: 'includes_code', value: 'E11.9', system: 'ICD-10' },
    store, { horizon: LIFE, status: 'active' });
  expect(res.selected).toHaveLength(0);
  expect(res.decisions[0].stateMatch).toBe('NO_MATCH');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx --prefix apps/pathway-service jest src/__tests__/temporal/select-facts.test.ts`
Expected: FAIL — cannot find module `select-facts`.

- [ ] **Step 3: Write minimal implementation**

```ts
// apps/pathway-service/src/services/resolution/temporal/select-facts.ts
import { NormalizedFact, FactStore, isLabFact } from './fact-model';
import { overlap, ResolvedHorizon, ThreeValued } from './overlap';
import { CodedCondition, CodedOperator } from '../types';

export type OperatorClass = 'membership' | 'scalar' | 'aggregate';
const MEMBERSHIP = new Set<CodedOperator>(['includes_code', 'equals', 'exists']);
const SCALAR = new Set<CodedOperator>(['greater_than', 'less_than']);

export function operatorClass(op: CodedOperator): OperatorClass {
  if (MEMBERSHIP.has(op)) return 'membership';
  if (SCALAR.has(op)) return 'scalar';
  return 'aggregate';
}

export interface EffectivePolicy { horizon: ResolvedHorizon; status?: 'active' | 'inactive' | 'any'; }
export interface FactDecision {
  fact: NormalizedFact;
  validityDecision: 'ADMIT' | 'DROP_INVALID' | 'UNKNOWN';
  stateMatch: 'MATCH' | 'NO_MATCH' | 'UNKNOWN' | 'NOT_APPLICABLE';
  temporalMatch: ThreeValued;
  operatorDecision: 'INCLUDE' | 'EXCLUDE' | 'INDETERMINATE';
}
export interface SelectionResult {
  decisions: FactDecision[];
  selected: NormalizedFact[];
  temporallyUnverified: boolean; stateUnverified: boolean; validityUnverified: boolean;
}

function matchesField(fact: NormalizedFact, condition: CodedCondition): boolean {
  if (condition.system && fact.system !== condition.system) return false;
  // For membership, code is the value being looked for. For scalar/aggregate, value is the LOINC/etc code.
  return fact.code === condition.value;
}

function stateMatchFor(fact: NormalizedFact, status: EffectivePolicy['status']):
    { result: FactDecision['stateMatch']; unverified: boolean } {
  if (isLabFact(fact)) return { result: 'NOT_APPLICABLE', unverified: false };
  const st = fact.clinicalState;
  const unverified = fact.stateBasis === 'MISSING_STATUS_FAIL_OPEN';
  if (status === 'any' || status === undefined) {
    return { result: st === 'UNKNOWN' || st === 'CONFLICT' ? 'UNKNOWN' : 'MATCH', unverified };
  }
  if (st === 'CONFLICT') return { result: 'NO_MATCH', unverified };
  if (st === 'UNKNOWN') return { result: 'UNKNOWN', unverified };
  if (status === 'active') return { result: st === 'ACTIVE' ? 'MATCH' : 'NO_MATCH', unverified };
  return { result: st === 'INACTIVE' ? 'MATCH' : 'NO_MATCH', unverified }; // inactive
}

function effectiveInstant(fact: NormalizedFact): string {
  return fact.interval.start?.value ?? '';
}

export function selectFacts(condition: CodedCondition, store: FactStore, policy: EffectivePolicy): SelectionResult {
  const klass = operatorClass(condition.operator);
  const decisions: FactDecision[] = [];
  let temporallyUnverified = false, stateUnverified = false, validityUnverified = false;

  for (const fact of store) {
    if (!matchesField(fact, condition)) continue;

    const validityDecision: FactDecision['validityDecision'] =
      fact.recordValidity === 'INVALID' ? 'DROP_INVALID'
      : fact.recordValidity === 'UNKNOWN' ? 'UNKNOWN' : 'ADMIT';
    const { result: stateMatch, unverified: sUnv } = stateMatchFor(fact, policy.status);
    const temporalMatch = overlap(fact.interval, policy.horizon);

    let operatorDecision: FactDecision['operatorDecision'];
    if (validityDecision === 'DROP_INVALID' || stateMatch === 'NO_MATCH' || temporalMatch === 'NO_MATCH') {
      operatorDecision = 'EXCLUDE';
    } else {
      const anyUnknown = validityDecision === 'UNKNOWN' || stateMatch === 'UNKNOWN' || temporalMatch === 'UNKNOWN';
      if (!anyUnknown) operatorDecision = 'INCLUDE';
      else operatorDecision = klass === 'membership' ? 'INCLUDE' : 'INDETERMINATE';
    }

    if (operatorDecision === 'INCLUDE') {
      if (temporalMatch === 'UNKNOWN') temporallyUnverified = true;
      if (stateMatch === 'UNKNOWN' || sUnv) stateUnverified = true;
      if (validityDecision === 'UNKNOWN') validityUnverified = true;
    }
    decisions.push({ fact, validityDecision, stateMatch, temporalMatch, operatorDecision });
  }

  const included = decisions.filter(d => d.operatorDecision === 'INCLUDE').map(d => d.fact);
  let selected: NormalizedFact[];
  if (klass === 'membership') {
    selected = included;
  } else if (klass === 'scalar') {
    selected = included.length === 0 ? []
      : [included.reduce((a, b) => (effectiveInstant(b) >= effectiveInstant(a) ? b : a))];
  } else if (condition.operator === 'count_in_window') {
    const seen = new Set<string>();
    selected = included.filter(f => (seen.has(f.factId) ? false : (seen.add(f.factId), true)));
  } else {
    selected = [...included].sort((a, b) => effectiveInstant(a).localeCompare(effectiveInstant(b)));
  }

  return { decisions, selected, temporallyUnverified, stateUnverified, validityUnverified };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx --prefix apps/pathway-service jest src/__tests__/temporal/select-facts.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck the whole temporal module**

Run: `npm run --prefix apps/pathway-service typecheck`
Expected: no errors introduced under `services/resolution/temporal/`. (Fix any strict-mode issues before committing.)

- [ ] **Step 6: Commit**

```bash
git -C apps/pathway-service add src/services/resolution/temporal/select-facts.ts src/__tests__/temporal/select-facts.test.ts
git commit -m "feat: selectFacts kernel — decoupled validity/state/temporal decisions

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review

- **Spec coverage:** §2 fact model + partial dates + three-valued overlap (Tasks 1–3); §3 state + validity mapping + decoupled dimensions (Tasks 4–5); §4 operator taxonomy + selection (Task 5). `equals` is membership (Task 5 test asserts it). No fabricated `end = start` — `TemporalEnd` is explicit (Task 1). `factId` is a field, never hashed here (assignment is Plan 05).
- **Deferred to later plans (correctly out of scope here):** resolving tiers→bounds via the clock (Plan 02); the policy/cascade that produces `EffectivePolicy` (Plan 03); calling `selectFacts` from the evaluator + doing the numeric `<`/`>` comparison on `selected` (Plan 04); building a `FactStore` from input/snapshot + `factId` assignment (Plans 05/07); evidence emission (Plan 08).
- **Type consistency:** `ResolvedHorizon`, `ThreeValued`, `FactDecision`, `SelectionResult`, `EffectivePolicy` names here are the exact ones the overview's contract lists for Plans 02–08 to consume.
- **Placeholder scan:** none — every step has runnable code and an exact command.

## Execution Handoff

Plan complete and saved. Recommended: **subagent-driven-development** (fresh subagent per task, review between tasks) — the five tasks are independently testable. Alternatively **executing-plans** inline. The remaining plans (02–09) will be written next, in order, each grounded in the code the previous plan lands.
