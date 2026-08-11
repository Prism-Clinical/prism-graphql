# Temporal Horizon Plan 04 — Evaluator and Reachability on the `selectFacts` Kernel

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (recommended — this plan is larger than 05) or superpowers:subagent-driven-development to implement task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `selectFacts` the only path by which a gate condition reads clinical data, so horizon, clinical status, and record validity govern every gate — while `legacy-v0` continues to decide exactly what today's evaluator decides.

**Architecture:** A new `temporal/condition-adapter.ts` translates a `GateCondition` into the kernel's `FactSelectionCondition` plus a NODE-level `ConditionTemporalOverride`, rejecting operators and fields the kernel does not model. `temporal/gate-policy.ts` composes the plan-03 cascade with the plan-02 clock to produce one `EffectivePolicy` per (condition, field). `gate-evaluator.ts` then loses its three private data-access helpers — `getCodeEntries`, `getNumericValue`, `collectLabSeries` — and every operator branch reads `selectFacts(...)` output instead. `reachability.ts` calls the same kernel with a request-scoped clock. Finally the resolvers call plan 05's `assembleContext`, which until now has no callers at all.

**Tech Stack:** TypeScript 5, Apollo Server 4 + Federation 2.10, Jest + ts-jest.

## Revision history

- **v1 (2026-08-11, this document)** — first draft, written from the merged state of plans 01/02/03/05 (`main` @ `d6f51fd`). Not yet reviewed.

---

## Open decisions — review these

This draft was written unattended. Six decisions had no unambiguous prior answer; each is implemented below as stated, with the reasoning that produced it. **These are the things to push back on.** Everything else follows from the design doc or the locked interface contract.

**D1 — `horizon` / `status` become typed fields on `CodedCondition` in this plan, not plan 06.**
`resolution-context.ts:542` says "Plan 06 adds them," and plan 03's anchor sweep therefore reads them defensively off untyped AGE JSON. But this plan's adapter must read the same two keys to build the NODE tier, and a second defensive read would let the sweep and the evaluator disagree about what an override *is* — precisely the drift the anchor preflight exists to prevent. Plan 06 still owns canonicalization, `conditionId`, and `temporal_defaults` round-trip; it does not need to own the evaluator-facing type. *If you disagree, the alternative is that both readers share one parser function and neither uses the type — say so and Task 1 changes shape.*

**D2 — `window_days` is translated by the adapter into a NODE-level `{days:N}` horizon; it is not ignored, and canonicalization stays in plan 06.**
This is the largest compatibility call in the plan. Today `count_in_window` / `trend_*` / `delta_from_baseline` filter on `window_days` directly (`isWithinWindow`, `collectLabSeries`). Under `legacy-v0` labs default to LIFETIME, so an adapter that read only the cascade would silently widen every windowed gate from "last 90 days" to "ever" — a behavior change in the version whose entire purpose is reproducing today. Translating `window_days: 90` into a NODE override of `{days: 90}` preserves the current result exactly while routing it through the governed path. When a condition carries **both** `window_days` and an explicit `horizon`, `horizon` wins (explicit author intent over the legacy key) and the adapter records a warning for plan 06's canonicalizer to surface at publish time. Design §6 says "`horizon` supersedes `window_days`" — this is that rule, applied at read time because the JSON rewrite is plan 06's job.

**D3 — Attribute conditions route through the kernel for the `lab`, `vitals`, and `allergy` namespaces; `patient.*` stays on `resolveAttribute`.**
Memory records a 2026-08-03 decision to route attribute conditions through the kernel in plan 04, overriding design §10; the contemporaneous code comment at `resolution-context.ts:595-600` calls it "a known gap, parked on Plan 04" and notes only coded branches were expected to move. This draft honors the routing decision with a principled carve-out: `lab.*`, `vitals.*`, and `allergy.*` resolve through `codeMap` to a real `(field, code, system)` triple and read the same clinical data a coded condition reads, so leaving them unfiltered means `lab.a1c > 9` and `{field: labs, operator: greater_than}` disagree about the same lab. `patient.*` is demographics (age, sex) with no `FactKind`, no interval, and no clinical state — there is nothing for a horizon to filter, so forcing it through the kernel would be ceremony. **The attribute operator set does not need to change the locked contract:** `not_equals`, `greater_or_equal`, `less_or_equal`, and `in` are absent from `TemporalOperator`, but `selectFacts` only *selects*; the comparison stays in `compareScalar`. The adapter maps each attribute operator to the temporal operator **of the same `OperatorClass`** for selection purposes only.

**D4 — `satisfaction_check.lookback_days` is out of scope and gets a tracked gap, not a fix.**
`prerequisites.ts:139` is a second temporal filter no cascade level governs. It is a different evaluator (prerequisite satisfaction, not gate routing), a different property shape (`{type, code, system, lookback_days}` with no `field`), and it feeds `unmetPrerequisites`, not `NodeResult`. Folding it in here would mean designing a fourth cascade surface mid-plan. Task 8 adds it to the overview's gap list and files it as plan 04b.

**D5 — `INDETERMINATE` fails closed *and* is recorded on the result.**
Design §13 and the overview both fix scalar/aggregate `INDETERMINATE` to fail-closed, which matches today for scalars (a missing numeric value already returns `satisfied: false`). But a gate that fails because data is *uncertain* is not the same as one that fails because the patient's value is genuinely below threshold, and plan 08 has to tell them apart. `GateEvaluationResult` gains optional `indeterminate?: boolean` and `uncertainty?: UncertaintyReason[]`. `satisfied` is unchanged, so this is additive.

**D6 — `evaluateGate`'s positional parameter list is replaced by an options object.**
`gate-evaluator.ts:745` carries an explicit instruction to remove the `now: number = Date.now()` default in this plan. Removing it from a 7-position signature whose last three params are optional would silently break every test call site that passes `codeMap` positionally. The signature becomes `evaluateGate(gate, deps)` where `deps` carries `factStore`, `temporalContext`, `patientContext`, `resolutionState`, `gateAnswers`, `gateId`, `llmEvaluator`, `codeMap`, `pathwayDefaults`. This is a mechanical churn cost across ~4 production and many test call sites, paid once, and it makes the missing-clock failure a compile error instead of a silent `Date.now()`.

---

## Global Constraints

- **Branch:** `feat/temporal-horizon-evaluator-kernel`, worktree `/home/claude/workspace/features/feat-temporal-horizon-evaluator-kernel/prism-graphql`, from `origin/main` at `d6f51fd`.
- **All commands from the worktree root. Never chain `cd` with `&&`.**
- **Typecheck:** `./node_modules/.bin/tsc -p apps/pathway-service/tsconfig.json --noEmit`. There is no `typecheck` script, no `apps/pathway-service/node_modules` (binaries hoist to the root), and bare `npx tsc` resolves to a decoy that prints "This is not the tsc command you are looking for".
- **Tests:** `npm test --prefix apps/pathway-service -- --runInBand <path>`. `testRegex` is `/__tests__/.*.test.ts` — a test file placed beside its source is silently never run.
- **`tsconfig` is NOT full strict and excludes `src/__tests__`** (`diagnostics: false`). **Test files are never typechecked.** Every invariant needs a runtime throw plus a test that fails without it. A type alone enforces nothing.
- **Baseline: 9 failures / 2 suites** (`data-completeness-scorer`, `patient-match-scorer`) — **958 passed / 9 failed / 967 total, 84 of 86 suites green**, measured on `main` @ `d6f51fd` on 2026-08-11. Measure on `main`, never on a copy of this branch. The suite has never been green; do not chase these two.
- **No live behavior change under `legacy-v0`.** That is this plan's central claim and Task 8 is where it is proven, not asserted.
- **`apps/pathway-service/src/__generated__/resolvers-types.ts` is now tracked** (it became so in PR #53). Do not delete it; if `npm run build` rewrites it, commit the change with the task that caused it.
- **Commit prefixes** `feat:`/`fix:`/`test:`/`refactor:`/`docs:`; no `@anthropic.com`/`@claude.com`, no "Generated with" lines. End each message with
  `Co-Authored-By: Claude Opus 5 (1M context) <noreply@example.com>`

## Decisions this plan locks

1. **The kernel is the only data path for gate conditions.** When this plan lands, `getCodeEntries`, `getNumericValue`, and `collectLabSeries` are deleted from `gate-evaluator.ts`. If any operator branch still reads `patientContext.labResults` directly, the plan is not done — that is the drift the whole suite exists to remove.
2. **`legacy-v0` reproduces today; `v1` is where behavior moves.** Every behavior change in this plan must be attributable to a policy version, not to the rewrite. A `legacy-v0` diff is a bug.
3. **Membership fails open, scalar and aggregate fail closed.** Already implemented in `selectFacts` (`select-facts.ts:184-190`); this plan consumes that policy rather than re-deciding it per operator.
4. **Reachability is advisory and recomputes nothing authoritative.** Per design §12 it takes a request-scoped `evaluationAsOf` (it runs before a session exists, via `matchedPathways(patientId)`), runs the same kernel, and its verdict never binds resolution.
5. **`ALWAYS_EVALUABLE` keeps its name but narrows its meaning.** Once membership operators are horizon-filtered, "always evaluable" is false for a `QUARTER` condition. The classification stays in the enum (it is a GraphQL surface) but is reserved for conditions whose *effective horizon is LIFETIME*. Under `legacy-v0` everything is LIFETIME, so the reported score is unchanged; under `v1` a lab membership gate correctly becomes data-dependent.
6. **The assembler gets wired here or the plan is inert.** `assembleContext` currently has zero callers outside its own module (verified 2026-08-11). Plan 05 built the input contract; this plan is what makes it load-bearing.

## Deliberately out of scope

- **Per-condition evidence and its GraphQL surface** — plan 08. This plan records `indeterminate`/`uncertainty` on the result (D5) but exposes nothing.
- **Canonicalization and the `window_days` → `horizon` JSON rewrite** — plan 06. The adapter shims at read time (D2).
- **The LIVE snapshot mapper** — plan 07. `assembleContext` still throws `NOT_IMPLEMENTED` for LIVE.
- **Normalized-fact persistence and REPLAY** — plan 05b.
- **`satisfaction_check.lookback_days`** — plan 04b (D4).
- **Consumer projections** (`actionableMedications`, DDI, scorer projections). The fact store feeds the gate evaluator only. DDI and the scorers keep reading `PatientContext` exactly as they do today, so no consumer is silently contaminated by the widening (design §8). Moving them is a separate, disclosed change.

---

### Task 1: The condition adapter — and the NODE override that feeds the cascade

**Files:**
- Create: `apps/pathway-service/src/services/resolution/temporal/condition-adapter.ts`
- Modify: `apps/pathway-service/src/services/resolution/types.ts` (add `horizon?`/`status?` to `CodedCondition`)
- Test: `apps/pathway-service/src/__tests__/temporal/condition-adapter.test.ts`

**Interfaces:**
- Produces: `toFactSelectionCondition(c: CodedCondition): FactSelectionCondition`, `nodeOverrideFor(c: CodedCondition): ConditionTemporalOverride | undefined`, `AdapterWarning`, `adaptCodedCondition(c): { selection, override, warnings }`.
- Consumes: `contract.ts` (`isTemporalOperator`, `fieldToKind`, `GateField`), `cascade.ts` (`ConditionTemporalOverride`), `evaluation-context.ts` (`TemporalContextError`).

**Why an adapter at all:** `CodedCondition.operator` is a `CodedOperator` and `FactSelectionCondition.operator` is a `TemporalOperator`. They are currently identical string unions defined in two places, which is exactly the situation where a later edit to one silently diverges. The adapter is the single place that proves the mapping and throws when it fails.

- [ ] **Step 1: Write the failing test**

```ts
import {
  adaptCodedCondition,
  toFactSelectionCondition,
  nodeOverrideFor,
} from '../../services/resolution/temporal/condition-adapter';
import { TemporalContextError } from '../../services/resolution/temporal/evaluation-context';
import { CodedCondition } from '../../services/resolution/types';

const base: CodedCondition = { field: 'labs', operator: 'greater_than', value: '718-7' };

describe('toFactSelectionCondition', () => {
  it('carries field, operator, value and system through unchanged', () => {
    const out = toFactSelectionCondition({ ...base, system: 'http://loinc.org' });
    expect(out).toEqual({
      field: 'labs', operator: 'greater_than', value: '718-7', system: 'http://loinc.org',
    });
  });

  it('rejects an operator the kernel does not model', () => {
    // Runtime throw, not a type error: tsconfig excludes __tests__, so a cast
    // here compiles and a missing guard would ship.
    expect(() => toFactSelectionCondition({ ...base, operator: 'sounds_like' as never }))
      .toThrow(TemporalContextError);
  });

  it('rejects a field with no fact kind', () => {
    expect(() => toFactSelectionCondition({ ...base, field: 'horoscope' as never }))
      .toThrow(/field/i);
  });
});

describe('nodeOverrideFor — the NODE tier of the cascade', () => {
  it('is undefined when the author set neither axis', () => {
    expect(nodeOverrideFor(base)).toBeUndefined();
  });

  it('carries an explicit horizon', () => {
    expect(nodeOverrideFor({ ...base, horizon: 'QUARTER' })).toEqual({ horizon: 'QUARTER' });
  });

  it('carries the two axes independently', () => {
    const c: CodedCondition = { ...base, field: 'conditions', operator: 'includes_code', status: 'any' };
    expect(nodeOverrideFor(c)).toEqual({ status: 'any' });
  });
});

describe('window_days is translated, never dropped (decision D2)', () => {
  it('becomes a NODE-level custom horizon so a legacy-v0 window still filters', () => {
    const c: CodedCondition = { ...base, operator: 'count_in_window', window_days: 90 };
    expect(nodeOverrideFor(c)).toEqual({ horizon: { days: 90 } });
  });

  it('yields to an explicit horizon and warns', () => {
    const c: CodedCondition = {
      ...base, operator: 'count_in_window', window_days: 90, horizon: 'YEAR',
    };
    const { override, warnings } = adaptCodedCondition(c);
    expect(override).toEqual({ horizon: 'YEAR' });
    expect(warnings).toEqual([
      expect.objectContaining({ code: 'WINDOW_DAYS_SUPERSEDED' }),
    ]);
  });

  it('rejects a window_days that is not a finite positive integer (design §13)', () => {
    expect(() => nodeOverrideFor({ ...base, window_days: 0 })).toThrow(TemporalContextError);
    expect(() => nodeOverrideFor({ ...base, window_days: -5 })).toThrow(TemporalContextError);
    expect(() => nodeOverrideFor({ ...base, window_days: 1.5 })).toThrow(TemporalContextError);
  });
});
```

- [ ] **Step 2: Run it, confirm it fails.**
- [ ] **Step 3: Implement.** Add `horizon?: Horizon` and `status?: TemporalStatus` to `CodedCondition`. `toFactSelectionCondition` guards with `isTemporalOperator` and `fieldToKind` (which already throws on unknown fields), and copies `system` only when present — `FactSelectionCondition.system` is optional and an explicit `undefined` key changes `toEqual` semantics. `nodeOverrideFor` reads `horizon` first, falls back to `window_days` via `parseHorizonValue({days: n})`, and validates the integer before constructing.
- [ ] **Step 4: Run tests, confirm they pass. Typecheck.**
- [ ] **Step 5: Commit** — `feat: adapt a coded condition onto the fact-selection contract`

---

### Task 2: One effective policy per gate condition

**Files:**
- Create: `apps/pathway-service/src/services/resolution/temporal/gate-policy.ts`
- Test: `apps/pathway-service/src/__tests__/temporal/gate-policy.test.ts`

**Interfaces:**
- Produces: `effectivePolicyForCondition(condition, ctx, pathwayDefaults): EffectivePolicy`, `GatePolicyInputs`.
- Consumes: `cascade.ts` (`resolveEffectivePolicy`, `toEffectivePolicy`), `evaluation-context.ts` (`EvaluationTemporalContext`), Task 1.

This is a thin seam, and it is deliberate: it is the one place that reads `ctx.temporalPolicyVersion`, so no operator branch can accidentally resolve a policy against a different version than its siblings.

- [ ] **Step 1: Write the failing test**

```ts
import { effectivePolicyForCondition } from '../../services/resolution/temporal/gate-policy';
import { makeEvaluationTemporalContext } from '../../services/resolution/temporal/evaluation-context';
import { CodedCondition } from '../../services/resolution/types';

const ctx = makeEvaluationTemporalContext({
  evaluationAsOf: '2026-08-11T00:00:00.000Z',
  temporalPolicyVersion: 'legacy-v0',
});

describe('effectivePolicyForCondition', () => {
  it('resolves labs to an unbounded lower bound under legacy-v0', () => {
    const c: CodedCondition = { field: 'labs', operator: 'greater_than', value: '718-7' };
    const p = effectivePolicyForCondition(c, ctx, {});
    expect(p.horizon.lowerBound).toBeNull();          // LIFETIME
    expect(p.horizon.upperBound).toBe('2026-08-11T00:00:00.000Z');
    expect(p.status).toBeUndefined();                 // observations have no clinical state
  });

  it('applies the legacy-v0 active default to conditions', () => {
    const c: CodedCondition = { field: 'conditions', operator: 'includes_code', value: 'E11.9' };
    expect(effectivePolicyForCondition(c, ctx, {}).status).toBe('active');
  });

  it('lets a NODE horizon beat the pathway default', () => {
    const c: CodedCondition = {
      field: 'labs', operator: 'greater_than', value: '718-7', horizon: 'QUARTER',
    };
    const p = effectivePolicyForCondition(c, ctx, { horizons: { labs: 'YEAR' } });
    // 90 days before the pinned clock, not 365.
    expect(p.horizon.lowerBound).toBe('2026-05-13T00:00:00.000Z');
  });

  it('resolves the version from the context, never from an argument', () => {
    const v1 = makeEvaluationTemporalContext({
      evaluationAsOf: '2026-08-11T00:00:00.000Z',
      temporalPolicyVersion: 'v1',
    });
    const c: CodedCondition = { field: 'labs', operator: 'greater_than', value: '718-7' };
    // v1 defaults labs to QUARTER; legacy-v0 to LIFETIME. Same condition, same call.
    expect(effectivePolicyForCondition(c, v1, {}).horizon.lowerBound).not.toBeNull();
    expect(effectivePolicyForCondition(c, ctx, {}).horizon.lowerBound).toBeNull();
  });
});
```

- [ ] **Step 2: Run it, confirm it fails.**
- [ ] **Step 3: Implement.** Compose `resolveEffectivePolicy(field, ctx.temporalPolicyVersion, pathwayDefaults, nodeOverrideFor(condition))` then `toEffectivePolicy(tier, ctx)`. Do not catch `MISSING_ENCOUNTER_ANCHOR` — plan 03's session-creation sweep is what turns that into an up-front rejection, and swallowing it here would restore the mid-traversal throw the sweep exists to prevent.
- [ ] **Step 4: Run tests, confirm they pass. Typecheck.**
- [ ] **Step 5: Commit** — `feat: resolve one effective policy per gate condition`

---

### Task 3: Membership operators read the kernel

**Files:**
- Modify: `apps/pathway-service/src/services/resolution/gate-evaluator.ts`
- Test: `apps/pathway-service/src/__tests__/gate-evaluator-membership-kernel.test.ts`

Covers `includes_code`, `equals`, `exists`. Today these call `getCodeEntries` and `.some(matchesCodePattern)`. Two behaviors must survive: **trailing-wildcard patterns** (`Z94.*`) and **`exists` meaning "the field is non-empty"**, which is not a code match at all.

> **`exists` needs care.** `selectFacts` filters by code. `exists` has no code to match — `condition.value` is empty or ignored. Route `exists` to a kernel call with a wildcard candidate match and treat `status: 'READY'` with a non-empty `selected` as satisfied. Do **not** special-case it back onto `patientContext`; that reintroduces the unfiltered read this plan removes, and under `v1` an `exists` gate must respect the horizon like any other.

- [ ] **Step 1: Write the failing test**

```ts
// Behavior-preservation first: these assertions must hold before AND after.
describe('membership operators under legacy-v0 decide what they decide today', () => {
  it('matches a trailing-wildcard code pattern', async () => { /* Z94.* matches Z94.0 */ });
  it('respects an explicit system filter', async () => { /* ... */ });
  it('exists is satisfied by any admitted fact in the field', async () => { /* ... */ });
  it('exists is unsatisfied when the field is empty', async () => { /* ... */ });
});

describe('membership fails open on uncertainty (kernel policy)', () => {
  it('counts a fact whose validity is UNKNOWN as a match', async () => { /* ... */ });
  it('counts a temporally UNKNOWN fact as a match', async () => { /* ... */ });
  it('does NOT count a fact whose recordValidity is INVALID', async () => {
    // The one deliberate legacy-v0 delta: a refuted/entered-in-error fact
    // matches today and must stop matching. Disclosed in Compatibility.
  });
});

describe('membership respects the horizon under v1', () => {
  it('drops a lab outside QUARTER that legacy-v0 admits', async () => { /* ... */ });
});
```

- [ ] **Step 2: Run it, confirm it fails.**
- [ ] **Step 3: Implement.** Replace the three branches. Keep the human-readable `reason` strings close to today's wording — they surface in the UI and several integration tests assert on them; changing them is churn this plan does not need.
- [ ] **Step 4: Run tests, confirm they pass. Typecheck.**
- [ ] **Step 5: Commit** — `feat: evaluate membership operators through selectFacts`

---

### Task 4: Scalar operators read the kernel

**Files:**
- Modify: `apps/pathway-service/src/services/resolution/gate-evaluator.ts`, `./types.ts` (`GateEvaluationResult` gains `indeterminate?`/`uncertainty?`)
- Test: `apps/pathway-service/src/__tests__/gate-evaluator-scalar-kernel.test.ts`

Covers `greater_than`, `less_than`. `selectFacts` returns the **definite latest** fact for the scalar class, or `INDETERMINATE` when no total order is provable. The numeric comparison stays here; only selection moves.

> **This is where plan 05's `OPEN(evaluationAsOf)` modeling pays off.** An undated vital is `OPEN(asOf)`, which `overlap()` reports as MATCH against LIFETIME — so a `legacy-v0` vitals gate still resolves. If these tests fail with `INDETERMINATE` on undated vitals, the assembler is not being used; check Task 6's wiring before touching the kernel.

- [ ] **Step 1: Write the failing test**

```ts
describe('scalar operators under legacy-v0 decide what they decide today', () => {
  it('compares an undated vital (OPEN interval) rather than failing closed', async () => { /* ... */ });
  it('compares the latest of several dated labs, not the first in array order', async () => {
    // Today's getNumericValue uses .find() — array order. This is a real bug fix,
    // and the assertion must be written so it FAILS against the old evaluator.
  });
  it('is unsatisfied when no fact matches the code', async () => { /* satisfied: false */ });
});

describe('scalar INDETERMINATE fails closed and is recorded (decision D5)', () => {
  it('is unsatisfied when two results tie with no provable order', async () => {
    const r = await evaluateGate(/* ... */);
    expect(r.satisfied).toBe(false);
    expect(r.indeterminate).toBe(true);
    expect(r.uncertainty).toContain('AMBIGUOUS_LATEST');
  });
  it('leaves indeterminate unset on a definite decision', async () => {
    expect((await evaluateGate(/* ... */)).indeterminate).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run it, confirm it fails.**
- [ ] **Step 3: Implement.** On `READY`, take the single selected fact's `value`; a fact with no numeric `value` is "no numeric value found" exactly as today. On `INDETERMINATE`, return unsatisfied with `indeterminate: true` and the kernel's `reasons`.
- [ ] **Step 4: Run tests, confirm they pass. Typecheck.**
- [ ] **Step 5: Commit** — `feat: evaluate scalar operators through selectFacts`

---

### Task 5: Aggregate operators read the kernel

**Files:**
- Modify: `apps/pathway-service/src/services/resolution/gate-evaluator.ts`
- Test: `apps/pathway-service/src/__tests__/gate-evaluator-aggregate-kernel.test.ts`

Covers `count_in_window`, `trend_up`, `trend_down`, `delta_from_baseline`. `linearSlope` stays — it is pure math over a series and has nothing to do with fact selection. `collectLabSeries` is deleted; the series comes from `selected`, sorted by effective time.

> **`count_in_window` counts distinct `factId`** (design §4). This is why plan 05 decision 6 widened the `buildEffectivePatientContext` merge key — without it two occurrences of the same code on different dates collapse to one before assembly, and the count is wrong upstream of anything this task does. If a count test fails at 1 where 2 is expected, check the merge key before the kernel.

- [ ] **Step 1: Write the failing test**

```ts
describe('count_in_window under legacy-v0', () => {
  it('still filters to window_days via the translated NODE horizon (D2)', async () => {
    // 3 occurrences, one 200 days old, window_days: 90 => count 2, threshold 2 => satisfied.
    // If D2's shim regressed, this counts 3 and the test still passes at threshold 2 —
    // so assert the count in the reason string, not just satisfaction.
  });
  it('counts distinct occurrences of the same code on different dates', async () => { /* ... */ });
  it('excludes future-dated entries', async () => { /* upperBound = evaluationAsOf */ });
});

describe('trend and delta operate on the kernel-selected series', () => {
  it('needs min_points dated values inside the horizon', async () => { /* ... */ });
  it('rejects a non-labs field as today', async () => { /* field !== labs => unsatisfied */ });
  it('orders the series by effective time, never array order', async () => { /* ... */ });
});

describe('aggregate uncertainty fails closed but is retained as evidence', () => {
  it('excludes an uncertain fact from the count', async () => { /* ... */ });
  it('records that the count is a lower bound', async () => {
    // FactDecision.uncertainty survives even when the operator policy resolved
    // to EXCLUDE — plan 08 needs it. Assert r.uncertainty is non-empty.
  });
});
```

- [ ] **Step 2: Run it, confirm it fails.**
- [ ] **Step 3: Implement.** Delete `collectLabSeries` and `isWithinWindow`. Sort `selected` by effective time ascending for the series operators; drop facts with no finite numeric value, as today.
- [ ] **Step 4: Run tests, confirm they pass. Typecheck.**
- [ ] **Step 5: Commit** — `feat: evaluate aggregate operators through selectFacts`

---

### Task 6: Thread the fact store, drop the wall clock, wire the assembler

**Files:**
- Modify: `gate-evaluator.ts` (signature), `traversal-engine.ts` (2 call sites, `:286`/`:679`), `retraversal-engine.ts` (1 call site, `:159`), `resolvers/mutations/resolution.ts`, `resolvers/mutations/multi-pathway-resolution.ts`
- Test: `apps/pathway-service/src/__tests__/gate-evaluator-deps.test.ts`

This is the task that makes the previous four reachable from a real request. Until it lands, `assembleContext` still has no callers and the rewritten operators only run in unit tests.

- [ ] **Step 1: Write the failing test**

```ts
describe('evaluateGate requires an explicit clock (gate-evaluator.ts:745)', () => {
  it('throws rather than defaulting to Date.now() when temporalContext is absent', async () => {
    await expect(evaluateGate(gate, { factStore: [], patientContext: pc } as never))
      .rejects.toThrow(/temporalContext/i);
    // Runtime throw required: __tests__ is excluded from typechecking, so the
    // type alone would not catch a call site that forgot it.
  });
});

describe('both engines supply their pinned context, not a fresh clock', () => {
  it('traversal passes the session temporalContext through to the kernel', async () => { /* ... */ });
  it('retraversal reuses the stored context so a re-run resolves the same horizons', async () => {
    // Pin evaluationAsOf in the past, assert a QUARTER lab that is in-window
    // relative to the STORED clock still matches when re-traversed today.
  });
});

describe('the resolvers assemble a fact store', () => {
  it('startResolution builds facts from the SYNTHETIC payload', async () => { /* ... */ });
  it('a gate decides from assembled facts, not from PatientContext arrays', async () => { /* ... */ });
});
```

- [ ] **Step 2: Run it, confirm it fails.**
- [ ] **Step 3: Implement.** Introduce `GateEvaluationDeps` (D6) and update all four production call sites. Both engines already hold `temporalContext` privately (`traversal-engine.ts:152`, `retraversal-engine.ts:82`) — pass the object, not the derived `now`. Call `assembleContext` in both start mutations and thread the resulting `FactStore` into the engine. Mechanical test-call-site churn is expected here and is the price of D6.
- [ ] **Step 4: Run the FULL suite.** This is the task most likely to break unrelated tests. Compare against the 958/9 baseline.
- [ ] **Step 5: Commit** — `refactor: give evaluateGate explicit dependencies and a real fact store`

---

### Task 7: Attribute conditions through the kernel

**Files:**
- Modify: `condition-adapter.ts` (attribute branch), `gate-evaluator.ts` (`evaluateCondition` attribute path), `attribute-registry.ts`
- Test: `apps/pathway-service/src/__tests__/temporal/attribute-condition-kernel.test.ts`

Implements D3. `lab.*`, `vitals.*`, `allergy.*` resolve through `codeMap` to `(field, code, system)` and go through the kernel; `patient.*` keeps calling `resolveAttribute`.

- [ ] **Step 1: Write the failing test**

```ts
describe('attribute namespaces that read clinical data are governed (D3)', () => {
  it('lab.a1c resolves the same fact a coded labs condition resolves', async () => {
    // The point of the whole task: these two must agree.
  });
  it('vitals.systolic_bp respects the effective horizon under v1', async () => { /* ... */ });
  it('allergy.penicillin drops a refuted allergy', async () => { /* ... */ });
  it('an unmapped attribute is unsatisfied, not a crash', async () => { /* codeMap miss */ });
});

describe('operator mapping preserves the comparison (D3)', () => {
  it('maps greater_or_equal to the scalar selection class and still compares >=', async () => {
    // value exactly equal to threshold => satisfied. Proves the comparison did
    // NOT degrade to greater_than when mapped onto the temporal operator set.
  });
  it('maps not_equals to scalar selection and compares !=', async () => { /* ... */ });
  it('maps in to scalar selection and tests membership of the value set', async () => { /* ... */ });
});

describe('patient.* stays off the kernel', () => {
  it('resolves demographics with no horizon filtering', async () => { /* patient.age */ });
  it('is not swept for an encounter anchor', () => { /* collectEncounterAnchorRequirements */ });
});
```

- [ ] **Step 2: Run it, confirm it fails.**
- [ ] **Step 3: Implement.** Add `attributeSelectionFor(attribute, codeMap)` returning `null` for `patient.*` and a `FactSelectionCondition` otherwise. Map the operator by `OperatorClass`: `exists` → membership; everything else → the scalar class. Keep `compareScalar` as the comparator so no attribute operator semantics change.
- [ ] **Step 4: Run tests, confirm they pass. Typecheck.**
- [ ] **Step 5: Update `sweepableConditions`.** The comment at `resolution-context.ts:589-600` explains attribute conditions are not swept because they never resolve a horizon. That is now false for three namespaces. Extend the sweep and update the comment, or a `v1` `vitals.*` attribute gate throws `MISSING_ENCOUNTER_ANCHOR` mid-traversal — the exact failure plan 03's preflight exists to prevent. **Add a test that fails without the sweep change.**
- [ ] **Step 6: Commit** — `feat: route clinical attribute conditions through the kernel`

---

### Task 8: Reachability, the behavior-preservation proof, and reconciliation

**Files:**
- Modify: `reachability.ts`, `docs/superpowers/plans/2026-07-26-temporal-horizon-00-overview.md`, `docs/superpowers/specs/2026-07-21-pathway-temporal-horizon-design.md` (§10 revision per D3)
- Test: `apps/pathway-service/src/__tests__/reachability-kernel.test.ts`, `apps/pathway-service/src/__tests__/temporal/legacy-v0-preservation.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
describe('reachability runs the same kernel with a request-scoped clock (§12)', () => {
  it('accepts an evaluationAsOf argument rather than reading the wall clock', () => { /* ... */ });
  it('classifies a lab membership gate as DATA_AVAILABLE under v1, not ALWAYS_EVALUABLE', () => {
    // Decision 5: the enum survives, its meaning narrows.
  });
  it('still reports ALWAYS_EVALUABLE under legacy-v0 where every horizon is LIFETIME', () => {
    // Guards the user-visible autoResolvableScore against an accidental v0 change.
  });
  it('reports DATA_BLOCKED when the only matching fact is outside the horizon', () => { /* ... */ });
});

describe('legacy-v0 preservation — the plan’s central claim', () => {
  // Table-driven over every operator × every field. For each case, assert the
  // kernel evaluator and the pre-plan-04 expectation agree.
  it.each(LEGACY_CASES)('$name decides identically under legacy-v0', async (c) => { /* ... */ });

  it('documents the two deliberate v1-only deltas', async () => {
    // (1) INVALID facts stop matching. (2) snapshot allergies gain a status
    // filter. Both are disclosed in design §Compatibility; assert them so a
    // future change cannot widen the delta set silently.
  });
});
```

- [ ] **Step 2: Run it, confirm it fails.**
- [ ] **Step 3: Implement reachability.** Thread `evaluationAsOf` from `Query.ts:549/813`. Replace `hasDataForCondition`'s hand-rolled lookups with a `selectFacts` call. `ALWAYS_EVALUABLE_OPERATORS` becomes a horizon check rather than an operator check (decision 5).
- [ ] **Step 4: Run the FULL suite** against the 958/9 baseline. Any new failure is this plan's, not a pre-existing one.
- [ ] **Step 5: Reconcile the overview.** Mark 04 executed; update Plan 04's Produces with the real names (`adaptCodedCondition`, `effectivePolicyForCondition`, `GateEvaluationDeps`, `attributeSelectionFor`); record D1 (the `CodedCondition` fields moved from 06 to 04) so plan 06 does not add them twice; record D2 so plan 06 knows the shim exists and must be removed when canonicalization lands; add plan 04b for `satisfaction_check.lookback_days` (D4).
- [ ] **Step 6: Revise design §10.** It states attribute conditions are outside temporal policy. D3 makes that false for three namespaces. The spec is the suite's source of truth and a stale §10 will mislead plan 09's UI work.
- [ ] **Step 7: Commit** — `feat: score reachability through the kernel` and `docs: reconcile the suite overview and design with plan 04`

---

## Acceptance criteria

- [ ] `gate-evaluator.ts` contains no direct read of `patientContext.conditionCodes`, `.medications`, `.allergies`, `.labResults`, or `.vitalSigns` on any coded or clinical-attribute path. `getCodeEntries`, `getNumericValue`, `collectLabSeries`, and `isWithinWindow` are deleted.
- [ ] `evaluateGate` has no `Date.now()` fallback and throws when given no `temporalContext`, proven by a test that fails without the throw.
- [ ] `assembleContext` has at least two production callers (both start mutations).
- [ ] Every operator in `VALID_CODED_OPERATORS` has a legacy-v0 preservation test asserting it decides what it decided before this plan.
- [ ] The only `legacy-v0` behavior changes are the two disclosed in design §Compatibility (INVALID facts dropped; allergy status filter). Any third is a bug.
- [ ] A `v1` lab scalar gate filters to QUARTER; the same gate under `legacy-v0` filters to LIFETIME. Same pathway, same patient, same code.
- [ ] `lab.a1c > 9` (attribute) and `{field: labs, operator: greater_than, value: <a1c code>}` (coded) select the same fact.
- [ ] A `v1` `vitals.*` attribute gate with no `encounterStart` is rejected at session creation by the anchor sweep, not mid-traversal.
- [ ] Reachability takes an explicit `evaluationAsOf` and reads no wall clock.
- [ ] Suite is at **958 passed / 9 failed** or better, with the same two pre-existing scorer suites failing and no others.
- [ ] `./node_modules/.bin/tsc -p apps/pathway-service/tsconfig.json --noEmit` is clean.
- [ ] The overview's Plan 04 entry is marked executed with its real Produces list, and design §10 no longer contradicts D3.
