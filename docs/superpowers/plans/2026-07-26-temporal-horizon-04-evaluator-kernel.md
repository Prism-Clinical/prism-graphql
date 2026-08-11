# Temporal Horizon Plan 04 — Evaluator and Reachability on the `selectFacts` Kernel

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (recommended — this plan is larger than 05) or superpowers:subagent-driven-development to implement task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a **`v1` evaluation path** in which `selectFacts` is the only way a gate condition reads clinical data, so horizon, clinical status, and record validity govern every gate — while `legacy-v0` keeps executing today's code, untouched, as the shadow baseline.

**Architecture:** `evaluateGate` gains a **version seam**: it dispatches on `temporalContext.temporalPolicyVersion`. `legacy-v0` runs `evaluateConditionLegacy` — today's function, byte-for-byte, including `getCodeEntries` / `getNumericValue` / `collectLabSeries`. `v1` runs `evaluateConditionKernel`, built across Tasks 4–8. A new `temporal/condition-adapter.ts` translates a `GateCondition` into the kernel's `FactSelectionCondition` plus a NODE-level `ConditionTemporalOverride`; `temporal/gate-policy.ts` composes the plan-03 cascade with the plan-02 clock into one `EffectivePolicy` per condition. Finally the resolvers call plan 05's `assembleContext` at **all five** engine entry points, which until now has no callers at all.

**Tech Stack:** TypeScript 5, Apollo Server 4 + Federation 2.10, Jest + ts-jest.

## Revision history

- **v1 (2026-08-11, `a6b0c65`)** — first draft, written unattended from `main` @ `d6f51fd`.
- **v2 (this document)** — rewritten after review. Seven findings (4×P1, 3×P2), all verified against the code and all accepted. The central premise was wrong: v1 asserted that `legacy-v0` could be reproduced *through* the kernel and deleted the legacy data-access helpers to prove it. The normative design already rules that out. Details under "Review dispositions".

---

## Review dispositions

Every finding was checked against the code before acceptance. None were rejected.

**[P1-1] `legacy-v0` cannot be reproduced through the kernel — ACCEPTED, architecture inverted.**
Design §381–398 is explicit: *"a session pinned to `legacy-v0` but run through the **new** kernel would not reproduce today's behavior, and `legacy-v0` must not be advertised as replayable through it,"* and it already chose the remedy — *"the current evaluator itself is the shadow baseline … the new `v1` path is diffed against the legacy code path, not against an in-kernel `legacy-v0`."* v1 of this plan asserted the opposite in its Global Constraints and locked decisions #1/#2. Verified unversioned deltas: `.find()`-first vs latest-dated lab selection, equal-time ambiguity, future-date exclusion, `INVALID` filtering, and — most concretely — `getCodeEntries` returns `[]` for `vitals`, so membership and `count_in_window` gates on vitals are unsatisfiable today but start firing once the assembler emits vitals as `ObservationFact`s. **`select-facts.ts:58` carries the same false claim** ("so `legacy-v0` is genuinely behavior-preserving"); Task 10 corrects that comment and the overview's plan-01 contract.

**[P1-2] Retraversal would run on stale or absent facts — ACCEPTED.**
Three `new RetraversalEngine(...)` sites exist (`resolution.ts:347`, `:510`, `:697` — `overrideNode`, `answerGateQuestion`, `addPatientContext`), and v1's Task 6 assembled only in the two start mutations. Normalized facts are not persisted (plan 05b), so every retraversal entry point must **re-assemble** from `buildEffectivePatientContext(...)` under the session's stored temporal context. `addPatientContext` is the sharp case: it changes the effective context by design. Task 9 covers all five sites and adds the flip test.

**[P1-3] The attribute→operator-class mapping cannot preserve semantics — ACCEPTED, redesigned.**
Three independent breakages, all verified:
- `select-facts.ts:75` — `exists` returns true for **any** fact of the kind, ignoring code and system. `lab.a1c exists` would match any lab.
- `select-facts.ts:92` — the scalar branch requires `hasFiniteValue`. Allergies are `StatefulFact`s with no numeric value, so mapping `equals`/`not_equals`/`in` on `allergy.*` to the scalar class rejects every candidate.
- `attribute-registry.ts` — `vitals` resolves via `numericPath(ctx.vitalSigns, rest)` with **no codeMap row**. D3 claimed all three namespaces resolve through `codeMap`.

Selection is now chosen by **namespace and value type**, not by comparison operator. See D3 below.

**[P1-4] Reachability lacks the inputs to run the kernel — ACCEPTED, deferred to plan 07.**
`computePathwayReachability(pool, pathwayRelationalId, patient)` (`reachability-loader.ts:26`) loads the graph and `codeMap` and nothing else — no `temporal_defaults`, no `FactStore`, no policy version, no request clock. The snapshot loader also discards validity and most state/date information the kernel needs, and the LIVE mapper is plan 07. Building a parallel snapshot→fact path here would duplicate plan 07 and then be thrown away. Since the kernel is now `v1`-only and nothing routes to `v1` until the rollout flip, **reachability correctly stays on today's classifier for this plan.** Task 10 documents the gap and moves governed reachability to plan 07.

**[P2-5] A finite horizon does not make a membership gate unresolvable — ACCEPTED.**
Membership fails open in the kernel, so a membership outcome is `READY` or `NO_MATCH`, never `INDETERMINATE`: an out-of-window membership gate has a deterministic `satisfied: false`. v1's locked decision #5 reclassified those as `DATA_BLOCKED`, conflating "no positive in-window evidence" with "cannot be evaluated" and depressing `autoResolvableScore` for gates that resolve fine. **`ALWAYS_EVALUABLE` keeps both its name and its meaning.** Folded into the plan-07 hand-off.

**[P2-6] Compound gates discard the uncertainty signal — ACCEPTED.**
`evaluateCondition` returns `{satisfied, reason, fieldsRead}` and `evaluateCompound` (`gate-evaluator.ts:557`) reduces on those alone, so D5's `indeterminate`/`uncertainty` would be dropped at the compound boundary. Task 8 defines AND/OR propagation explicitly and tests it.

**[P2-7] D2 contradicted the canonical contract — ACCEPTED.**
Design §419: the canonicalizer *"**rejects** a condition supplying both `window_days` and `horizon`"*, and §437 lists the conflict as a value-validation item. v1 made `horizon` win and emitted an `AdapterWarning` that no task consumed — different runtime behavior before and after plan 06, with no surface for the warning. The adapter now **rejects the pair**. The `window_days` → `{days:N}` translation shim stays.

---

## Open decisions — reviewed and settled

D1–D6 were drafted unattended in v1 and reviewed. All six were accepted; four were modified.

**D1 — `horizon`/`status` become typed fields on `CodedCondition` here, *and* both readers share one parser.** *(Accepted with the reviewer's amendment.)* v1 moved the types and left plan 03's anchor sweep on its own defensive read. TypeScript fields validate nothing against untyped AGE JSON, so the sweep and the evaluator could still disagree about what an override *is*. Task 1 produces `parseConditionOverride(raw, where)`; `sweepableConditions` (`resolution-context.ts:546`) is rewritten to call it. Plan 06 still owns canonicalization, `conditionId`, and `temporal_defaults` round-trip.

**D2 — `window_days` is translated into a NODE-level `{days:N}` horizon; supplying both `window_days` and `horizon` is rejected.** *(Accepted with P2-7's correction.)* Translation preserves today's windowed-gate behavior when the cascade would otherwise widen a 90-day window to LIFETIME. Rejecting the conflicting pair matches design §419 and keeps read-time behavior identical before and after plan 06's rewrite. No warning channel is invented.

**D3 — Attribute conditions route through the kernel for `lab`, `vitals`, and `allergy`; `patient.*` stays on `resolveAttribute`. Selection is chosen by namespace and value type, never by operator class.** *(Accepted; selection redesigned per P1-3.)*

| Namespace | Resolves via | Kernel selection | Then |
|---|---|---|---|
| `lab.*` | `codeMap` → `(code, system)` | **exact-code scalar** (`greater_than` candidate rule) | `compareScalar(value, op, target)` |
| `vitals.*` | dotted path remainder → `code` = path, `system` = `VITALS_SYSTEM` | **exact-code scalar** | `compareScalar(...)` |
| `allergy.*` | `codeMap` → `(code, system)` | **exact-code membership** (`equals` candidate rule) | boolean derivation, then `compareScalar` |
| `patient.*` | `resolveAttribute` | none — demographics have no `FactKind`, interval, or clinical state | unchanged |

`exists` is never routed to the kernel's `exists` operator for attributes, because that operator ignores code and system by design. An attribute `exists` becomes an exact-code membership selection and is satisfied by a non-empty `selected`.

**D4 — `satisfaction_check.lookback_days` is out of scope; tracked as plan 04b.** *(Accepted unchanged.)* `prerequisites.ts:139` is a different evaluator, a different property shape, and feeds `unmetPrerequisites` rather than `NodeResult`.

**D5 — `INDETERMINATE` fails closed *and* is recorded, with explicit compound propagation.** *(Accepted with P2-6's amendment.)* `GateEvaluationResult` gains optional `indeterminate?: boolean` and `uncertainty?: UncertaintyReason[]`; `satisfied` is unchanged. Task 8 defines how the signal survives AND/OR.

**D6 — `evaluateGate`'s positional parameters become an options object.** *(Accepted unchanged.)* `gate-evaluator.ts:745` instructs this plan to remove the `now: number = Date.now()` default; doing so in a 7-position signature whose last three params are optional would silently break every call site passing `codeMap` positionally. The seam also needs `temporalContext` as a first-class dependency for version dispatch.

---

## Global Constraints

- **Branch:** `feat/temporal-horizon-evaluator-kernel`, worktree `/home/claude/workspace/features/feat-temporal-horizon-evaluator-kernel/prism-graphql`, from `origin/main` at `d6f51fd`.
- **All commands from the worktree root. Never chain `cd` with `&&`.**
- **Typecheck:** `./node_modules/.bin/tsc -p apps/pathway-service/tsconfig.json --noEmit`. There is no `typecheck` script, no `apps/pathway-service/node_modules` (binaries hoist to the root), and bare `npx tsc` resolves to a decoy that prints "This is not the tsc command you are looking for".
- **Tests:** `npm test --prefix apps/pathway-service -- --runInBand <path>`. `testRegex` is `/__tests__/.*.test.ts` — a test file placed beside its source is silently never run.
- **`tsconfig` is NOT full strict and excludes `src/__tests__`** (`diagnostics: false`). **Test files are never typechecked.** Every invariant needs a runtime throw plus a test that fails without it. A type alone enforces nothing.
- **Baseline: 9 failures / 2 suites** (`data-completeness-scorer`, `patient-match-scorer`) — **958 passed / 9 failed / 967 total, 84 of 86 suites green**, measured on `main` @ `d6f51fd` on 2026-08-11. Measure on `main`, never on a copy of this branch. The suite has never been green; do not chase these two.
- **`legacy-v0` executes no kernel code.** This is now a *structural* guarantee rather than a behavioral claim: the version seam (Task 3) routes `legacy-v0` to the untouched legacy function. Existing gate-evaluator tests must pass **unmodified** — that is the proof, and Task 10 states it as such.
- **Nothing routes to `v1` in this plan.** No SDL input selects `temporalPolicyVersion` (a known gap since plan 05), so `v1` is reachable only from tests until the rollout flip. That is deliberate: it is what makes this plan safe to merge.
- **`apps/pathway-service/src/__generated__/resolvers-types.ts` is now tracked** (it became so in PR #53). Do not delete it; if `npm run build` rewrites it, commit the change with the task that caused it.
- **Commit prefixes** `feat:`/`fix:`/`test:`/`refactor:`/`docs:`; no `@anthropic.com`/`@claude.com`, no "Generated with" lines. End each message with
  `Co-Authored-By: Claude Opus 5 (1M context) <noreply@example.com>`

## Decisions this plan locks

1. **Two paths coexist, separated by version.** `getCodeEntries`, `getNumericValue`, `collectLabSeries`, and `isWithinWindow` are **not deleted** — they are the `legacy-v0` implementation and the shadow baseline the rollout diffs against. They are retired by the rollout flip, in a later change, once `v1` is proven.
2. **`v1` is where behavior moves, and every delta is disclosed.** A behavior change reachable under `legacy-v0` is a bug in the seam. A behavior change under `v1` is expected and must appear in the Compatibility list.
3. **Membership fails open; scalar and aggregate fail closed.** Already implemented in `selectFacts` (`select-facts.ts:184-190`); this plan consumes that policy rather than re-deciding it per operator.
4. **Reachability is untouched by this plan.** It has neither the inputs nor a fact source until plan 07's snapshot mapper (P1-4). `ALWAYS_EVALUABLE` keeps its meaning (P2-5).
5. **The assembler gets wired at every engine entry point or the plan is inert.** `assembleContext` currently has zero callers outside its own module (verified 2026-08-11). Five sites: two start mutations, three retraversal constructions.
6. **The adapter is the single validation boundary for condition temporal keys.** Both the evaluator and plan 03's anchor sweep parse overrides through it (D1).

## Deliberately out of scope

- **Per-condition evidence and its GraphQL surface** — plan 08. This plan records `indeterminate`/`uncertainty` on the result (D5) but exposes nothing.
- **Canonicalization and the `window_days` → `horizon` JSON rewrite** — plan 06. The adapter shims at read time and rejects the conflicting pair (D2).
- **Governed reachability** — plan 07, with the snapshot mapper that gives it facts (P1-4).
- **The LIVE snapshot mapper** — plan 07. `assembleContext` still throws `NOT_IMPLEMENTED` for LIVE.
- **Normalized-fact persistence and REPLAY** — plan 05b.
- **`satisfaction_check.lookback_days`** — plan 04b (D4).
- **Retiring the legacy path** — the rollout flip. Deleting it here is what P1-1 rejected.
- **Consumer projections** (`actionableMedications`, DDI, scorer projections). The fact store feeds the gate evaluator only; DDI and the scorers keep reading `PatientContext` exactly as today.

---

### Task 1: The condition adapter, and the parser both readers share

**Files:**
- Create: `apps/pathway-service/src/services/resolution/temporal/condition-adapter.ts`
- Modify: `apps/pathway-service/src/services/resolution/types.ts` (add `horizon?`/`status?` to `CodedCondition`), `apps/pathway-service/src/resolvers/helpers/resolution-context.ts` (`sweepableConditions` calls the shared parser)
- Test: `apps/pathway-service/src/__tests__/temporal/condition-adapter.test.ts`

**Interfaces:**
- Produces: `toFactSelectionCondition(c: CodedCondition): FactSelectionCondition`, `parseConditionOverride(raw: unknown, where: string): ConditionTemporalOverride | undefined`, `nodeOverrideFor(c: CodedCondition): ConditionTemporalOverride | undefined`.
- Consumes: `contract.ts` (`isTemporalOperator`, `fieldToKind`, `GateField`), `cascade.ts` (`ConditionTemporalOverride`, `parseHorizonValue`), `evaluation-context.ts` (`TemporalContextError`).

**Why an adapter at all:** `CodedCondition.operator` is a `CodedOperator` and `FactSelectionCondition.operator` is a `TemporalOperator`. They are currently identical string unions defined in two places — exactly the situation where a later edit to one silently diverges. The adapter proves the mapping and throws when it fails.

**Why one parser (D1):** plan 03's sweep reads `horizon`/`status` defensively off untyped AGE JSON (`resolution-context.ts:604-606`). Adding TypeScript fields does not validate that JSON. If the sweep and the evaluator parse overrides differently, a pathway can pass the anchor preflight and then throw mid-traversal — the exact failure the preflight exists to prevent.

- [ ] **Step 1: Write the failing test**

```ts
import {
  toFactSelectionCondition,
  nodeOverrideFor,
  parseConditionOverride,
} from '../../services/resolution/temporal/condition-adapter';
import { TemporalContextError } from '../../services/resolution/temporal/evaluation-context';
import { CodedCondition } from '../../services/resolution/types';

const base: CodedCondition = { field: 'labs', operator: 'greater_than', value: '718-7' };

describe('toFactSelectionCondition', () => {
  it('carries field, operator, value and system through unchanged', () => {
    expect(toFactSelectionCondition({ ...base, system: 'http://loinc.org' })).toEqual({
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
    expect(() => toFactSelectionCondition({ ...base, field: 'horoscope' as never })).toThrow(/field/i);
  });
});

describe('nodeOverrideFor — the NODE tier of the cascade', () => {
  it('is undefined when the author set neither axis', () => {
    expect(nodeOverrideFor(base)).toBeUndefined();
  });

  it('carries the two axes independently', () => {
    expect(nodeOverrideFor({ ...base, horizon: 'QUARTER' })).toEqual({ horizon: 'QUARTER' });
    const c: CodedCondition = { field: 'conditions', operator: 'includes_code', value: 'E11.9', status: 'any' };
    expect(nodeOverrideFor(c)).toEqual({ status: 'any' });
  });
});

describe('window_days (decision D2)', () => {
  it('is translated into a NODE-level custom horizon, never dropped', () => {
    const c: CodedCondition = { ...base, operator: 'count_in_window', window_days: 90 };
    expect(nodeOverrideFor(c)).toEqual({ horizon: { days: 90 } });
  });

  it('REJECTS a condition supplying both window_days and horizon (design §419)', () => {
    const c: CodedCondition = { ...base, operator: 'count_in_window', window_days: 90, horizon: 'YEAR' };
    expect(() => nodeOverrideFor(c)).toThrow(TemporalContextError);
    expect(() => nodeOverrideFor(c)).toThrow(/window_days.*horizon|horizon.*window_days/i);
  });

  it('rejects a window_days that is not a finite positive integer (design §13)', () => {
    for (const bad of [0, -5, 1.5, Number.NaN]) {
      expect(() => nodeOverrideFor({ ...base, window_days: bad })).toThrow(TemporalContextError);
    }
  });
});

describe('parseConditionOverride — the shared boundary (D1)', () => {
  it('parses the same keys the evaluator reads, from untyped JSON', () => {
    expect(parseConditionOverride({ horizon: 'QUARTER' }, 'gate-1 / condition 0'))
      .toEqual({ horizon: 'QUARTER' });
  });

  it('rejects a malformed horizon rather than passing it through as never', () => {
    expect(() => parseConditionOverride({ horizon: { days: 'ninety' } }, 'gate-1 / condition 0'))
      .toThrow(TemporalContextError);
  });

  it('names the location in the message so a sweep rejection is actionable', () => {
    expect(() => parseConditionOverride({ status: 'purple' }, 'gate-7 / condition 2'))
      .toThrow(/gate-7 \/ condition 2/);
  });
});
```

- [ ] **Step 2: Run it, confirm it fails.**
- [ ] **Step 3: Implement.** Add `horizon?: Horizon` and `status?: TemporalStatus` to `CodedCondition`. `toFactSelectionCondition` guards with `isTemporalOperator` and `fieldToKind` (which already throws on unknown fields) and copies `system` only when present — `FactSelectionCondition.system` is optional and an explicit `undefined` key changes `toEqual` semantics. `nodeOverrideFor` delegates to `parseConditionOverride`, which rejects the `window_days`+`horizon` pair before anything else, then validates the integer and calls `parseHorizonValue`.
- [ ] **Step 4: Rewrite `sweepableConditions`** to call `parseConditionOverride(cond, label)` instead of its two `as never` casts. A malformed override now fails the session-creation preflight with a located message instead of reaching the evaluator.
- [ ] **Step 5: Run tests, confirm they pass. Run the plan-03 anchor-sweep suite specifically — this step changes its behavior from "silently ignore garbage" to "reject". Typecheck.**
- [ ] **Step 6: Commit** — `feat: adapt a coded condition onto the fact-selection contract`

---

### Task 2: One effective policy per gate condition

**Files:**
- Create: `apps/pathway-service/src/services/resolution/temporal/gate-policy.ts`
- Test: `apps/pathway-service/src/__tests__/temporal/gate-policy.test.ts`

**Interfaces:**
- Produces: `effectivePolicyForCondition(condition, ctx, pathwayDefaults): EffectivePolicy`.
- Consumes: `cascade.ts` (`resolveEffectivePolicy`, `toEffectivePolicy`), `evaluation-context.ts` (`EvaluationTemporalContext`), Task 1.

A thin seam, deliberately: it is the one place that reads `ctx.temporalPolicyVersion`, so no operator branch can resolve a policy against a different version than its siblings.

- [ ] **Step 1: Write the failing test**

```ts
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
    const c: CodedCondition = { field: 'labs', operator: 'greater_than', value: '718-7', horizon: 'QUARTER' };
    const p = effectivePolicyForCondition(c, ctx, { horizons: { labs: 'YEAR' } });
    expect(p.horizon.lowerBound).toBe('2026-05-13T00:00:00.000Z');   // 90 days, not 365
  });

  it('resolves the version from the context, never from an argument', () => {
    const v1 = makeEvaluationTemporalContext({
      evaluationAsOf: '2026-08-11T00:00:00.000Z', temporalPolicyVersion: 'v1',
    });
    const c: CodedCondition = { field: 'labs', operator: 'greater_than', value: '718-7' };
    expect(effectivePolicyForCondition(c, v1, {}).horizon.lowerBound).not.toBeNull();  // QUARTER
    expect(effectivePolicyForCondition(c, ctx, {}).horizon.lowerBound).toBeNull();     // LIFETIME
  });
});
```

- [ ] **Step 2: Run it, confirm it fails.**
- [ ] **Step 3: Implement.** Compose `resolveEffectivePolicy(field, ctx.temporalPolicyVersion, pathwayDefaults, nodeOverrideFor(condition))` then `toEffectivePolicy(tier, ctx)`. Do not catch `MISSING_ENCOUNTER_ANCHOR` — plan 03's session-creation sweep turns that into an up-front rejection, and swallowing it here restores the mid-traversal throw the sweep exists to prevent.
- [ ] **Step 4: Run tests, confirm they pass. Typecheck.**
- [ ] **Step 5: Commit** — `feat: resolve one effective policy per gate condition`

---

### Task 3: The version seam — dispatch that changes nothing yet

**Files:**
- Modify: `apps/pathway-service/src/services/resolution/gate-evaluator.ts`, `./types.ts` (`GateEvaluationResult` gains `indeterminate?`/`uncertainty?`)
- Test: `apps/pathway-service/src/__tests__/gate-evaluator-version-seam.test.ts`

This is the load-bearing task and it must land **before** any operator moves. It introduces `GateEvaluationDeps` (D6), removes the `Date.now()` default, renames today's `evaluateCondition` to `evaluateConditionLegacy`, and adds `evaluateConditionKernel` which — **at the end of this task** — simply delegates to the legacy function.

A no-op fork sounds pointless. It is not: it proves the dispatch, the deps object, and every updated call site in isolation, so that when Tasks 4–8 change the `v1` branch, any failure is attributable to the operator rewrite and not to the plumbing.

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

describe('the version seam dispatches on the session policy version', () => {
  it('routes legacy-v0 to the legacy evaluator', async () => { /* spy or behavioral probe */ });
  it('routes v1 to the kernel evaluator', async () => { /* ... */ });
  it('rejects an unknown version rather than falling back to legacy', async () => {
    // assertKnownPolicyVersion already throws; prove the seam does not swallow it.
    await expect(evaluateGate(gate, depsWithVersion('v99'))).rejects.toThrow(/v99/);
  });
});

describe('the fork is a no-op until Task 4', () => {
  it('decides identically under legacy-v0 and v1 for a membership gate', async () => {
    const a = await evaluateGate(gate, deps('legacy-v0'));
    const b = await evaluateGate(gate, deps('v1'));
    expect(b.satisfied).toBe(a.satisfied);
    // This test is DELETED in Task 4, which is the point where the paths diverge.
  });
});
```

- [ ] **Step 2: Run it, confirm it fails.**
- [ ] **Step 3: Implement.** `evaluateGate(gate, deps)` where `GateEvaluationDeps = { temporalContext, factStore, patientContext, resolutionState, gateAnswers, gateId?, llmEvaluator?, codeMap?, pathwayDefaults? }`. Throw a `TemporalContextError` when `temporalContext` is missing. Rename `evaluateCondition` → `evaluateConditionLegacy` **without editing its body**; add `evaluateConditionKernel` delegating to it. `evaluatePatientAttribute` and `evaluateCompound` take the deps and dispatch per condition.
- [ ] **Step 4: Update all four production call sites** — `traversal-engine.ts:286`/`:679`, `retraversal-engine.ts:159`. Both engines already hold `temporalContext` privately (`traversal-engine.ts:152`, `retraversal-engine.ts:82`); pass the object, not the derived `now`. `factStore` is `[]` at this task — Task 9 fills it.
- [ ] **Step 5: Run the FULL suite.** Expect broad mechanical churn in test call sites. **Existing gate-evaluator assertions must not be weakened** — only their call shape changes. Compare against 958/9.
- [ ] **Step 6: Commit** — `refactor: give evaluateGate explicit dependencies and a version seam`

---

### Task 4: Membership operators on the kernel (`v1` branch)

**Files:**
- Modify: `gate-evaluator.ts` (`evaluateConditionKernel`)
- Test: `apps/pathway-service/src/__tests__/gate-evaluator-membership-kernel.test.ts`

Covers `includes_code`, `equals`, `exists`. Delete Task 3's no-op-fork test here; this is where the paths diverge.

> **`exists` is bucket existence.** `select-facts.ts:75` short-circuits `exists` to match any fact of the kind, ignoring code and system — which is what today's `entries.length > 0` means. Reject a `system` or non-empty `value` supplied alongside `exists` in the adapter rather than silently ignoring it.

- [ ] **Step 1: Write the failing test**

```ts
describe('membership under v1 preserves the shape of today’s matching', () => {
  it('matches a trailing-wildcard code pattern (Z94.* matches Z94.0)', async () => { /* ... */ });
  it('respects an explicit system filter', async () => { /* ... */ });
  it('exists is satisfied by any admitted fact in the field, and unsatisfied when empty', async () => { /* ... */ });
});

describe('membership fails open on uncertainty (kernel policy)', () => {
  it('counts a validity-UNKNOWN fact as a match', async () => { /* ... */ });
  it('counts a temporally UNKNOWN fact as a match', async () => { /* ... */ });
});

describe('disclosed v1 deltas — these MUST differ from legacy-v0', () => {
  it('drops a recordValidity INVALID fact that legacy-v0 matches', async () => {
    const legacy = await evaluateGate(gate, deps('legacy-v0'));
    const v1 = await evaluateGate(gate, deps('v1'));
    expect(legacy.satisfied).toBe(true);
    expect(v1.satisfied).toBe(false);
  });

  it('drops a lab outside QUARTER that legacy-v0 admits under LIFETIME', async () => { /* ... */ });

  it('starts matching a vitals membership gate that legacy-v0 cannot satisfy', async () => {
    // getCodeEntries returns [] for 'vitals', so this gate is unsatisfiable today.
    // The assembler emits vitals as ObservationFacts, so v1 resolves it.
    // This is the concrete example from review finding P1-1.
  });
});
```

- [ ] **Step 2: Run it, confirm it fails.**
- [ ] **Step 3: Implement** the three branches in `evaluateConditionKernel`. Keep `reason` wording close to today's — it surfaces in the UI and several integration tests assert on it.
- [ ] **Step 4: Run tests, confirm they pass. Typecheck.**
- [ ] **Step 5: Commit** — `feat: evaluate membership operators through selectFacts under v1`

---

### Task 5: Scalar operators on the kernel (`v1` branch)

**Files:** `gate-evaluator.ts`; test `gate-evaluator-scalar-kernel.test.ts`

Covers `greater_than`, `less_than`. `selectFacts` returns the **definite latest** fact for the scalar class, or `INDETERMINATE` when no total order is provable. The numeric comparison stays here; only selection moves.

> **This is where plan 05's `OPEN(evaluationAsOf)` modeling pays off.** An undated vital is `OPEN(asOf)`, which `overlap()` reports as MATCH against any horizon containing the clock. If these tests fail with `INDETERMINATE` on undated vitals, the assembler is not wired — check Task 9 before touching the kernel.

- [ ] **Step 1: Write the failing test**

```ts
describe('scalar selection under v1', () => {
  it('compares an undated vital (OPEN interval) rather than failing closed', async () => { /* ... */ });
  it('is unsatisfied when no fact matches the code', async () => { /* satisfied: false */ });
});

describe('disclosed v1 delta — latest, not first', () => {
  it('compares the latest of several dated labs where legacy-v0 takes array order', async () => {
    // getNumericValue uses .find(). Order the fixture so first !== latest and the
    // two paths disagree; assert BOTH, so the delta is pinned, not just the fix.
  });
});

describe('scalar INDETERMINATE fails closed and is recorded (D5)', () => {
  it('is unsatisfied when two results tie with no provable order', async () => {
    const r = await evaluateGate(gate, deps('v1'));
    expect(r.satisfied).toBe(false);
    expect(r.indeterminate).toBe(true);
    expect(r.uncertainty).toContain('AMBIGUOUS_LATEST');
  });
  it('leaves indeterminate unset on a definite decision', async () => { /* undefined */ });
});
```

- [ ] **Step 2–5:** implement, test, typecheck, commit — `feat: evaluate scalar operators through selectFacts under v1`

---

### Task 6: Aggregate operators on the kernel (`v1` branch)

**Files:** `gate-evaluator.ts`; test `gate-evaluator-aggregate-kernel.test.ts`

Covers `count_in_window`, `trend_up`, `trend_down`, `delta_from_baseline`. `linearSlope` stays — pure math over a series, nothing to do with selection. The `v1` series comes from `selected`, sorted by effective time; `collectLabSeries` and `isWithinWindow` remain in place for `legacy-v0`.

> **`count_in_window` counts distinct `factId`** (design §4). Plan 05 decision 6 widened the `buildEffectivePatientContext` merge key for this reason — without it, two occurrences of the same code on different dates collapse before assembly. If a count test reads 1 where 2 is expected, check the merge key before the kernel.

- [ ] **Step 1: Write the failing test**

```ts
describe('count_in_window under v1', () => {
  it('filters to the window via the translated NODE horizon (D2)', async () => {
    // 3 occurrences, one 200 days old, window_days: 90 => count 2.
    // Assert the COUNT in the reason string, not just satisfaction: at
    // threshold 2 a regression to 3 would still satisfy and hide the bug.
  });
  it('counts distinct occurrences of the same code on different dates', async () => { /* ... */ });
  it('excludes future-dated entries (upperBound = evaluationAsOf)', async () => { /* ... */ });
});

describe('trend and delta operate on the kernel-selected series', () => {
  it('needs min_points dated values inside the horizon', async () => { /* ... */ });
  it('rejects a non-labs field as today', async () => { /* ... */ });
  it('orders the series by effective time, never array order', async () => { /* ... */ });
});

describe('aggregate uncertainty fails closed but is retained', () => {
  it('excludes an uncertain fact from the count and records it as a lower bound', async () => {
    // FactDecision.uncertainty survives even when the operator policy resolved to
    // EXCLUDE — plan 08 needs it. Assert r.uncertainty is non-empty.
  });
});
```

- [ ] **Step 2–5:** implement, test, typecheck, commit — `feat: evaluate aggregate operators through selectFacts under v1`

---

### Task 7: Attribute conditions, selected by namespace (`v1` branch)

**Files:**
- Modify: `condition-adapter.ts` (attribute branch), `gate-evaluator.ts` (attribute path in `evaluateConditionKernel`)
- Test: `apps/pathway-service/src/__tests__/temporal/attribute-condition-kernel.test.ts`

Implements D3 as redesigned by P1-3. Selection is chosen by **namespace and value type**; the comparison stays in `compareScalar`. `patient.*` never reaches the kernel.

- [ ] **Step 1: Write the failing test**

```ts
describe('namespace determines selection, not the operator (P1-3)', () => {
  it('selects a lab by EXACT mapped code, not by any-lab existence', async () => {
    // codeMap: lab.a1c -> LOINC 4548-4. Store holds an unrelated lab only.
    // `lab.a1c exists` must be UNSATISFIED — the kernel's own `exists` operator
    // would match the unrelated lab because it ignores code and system.
    expect((await evaluateGate(a1cExistsGate, deps('v1'))).satisfied).toBe(false);
  });

  it('selects an allergy by exact code as MEMBERSHIP, then derives a boolean', async () => {
    // Allergies are StatefulFacts with no numeric value. Scalar selection would
    // reject every candidate via hasFiniteValue (select-facts.ts:92).
    expect((await evaluateGate(allergyEqualsGate, deps('v1'))).satisfied).toBe(true);
  });

  it('selects a vital by dotted path, with no codeMap row', async () => {
    // attribute-registry resolves vitals via numericPath, NOT codeMap.
    // vitals.systolic_bp -> { field: 'vitals', code: 'systolic_bp', system: VITALS_SYSTEM }
  });

  it('resolves a nested custom vital path', async () => { /* custom.pain_score */ });

  it('leaves patient.* on resolveAttribute', async () => {
    // Demographics have no FactKind, interval, or clinical state.
  });
});

describe('attribute operators outside TemporalOperator still work', () => {
  for (const op of ['not_equals', 'greater_or_equal', 'less_or_equal', 'in']) {
    it(`applies ${op} via compareScalar after kernel selection`, async () => { /* ... */ });
  }
});

describe('absent target with an unrelated fact present', () => {
  it('is unsatisfied for every namespace rather than matching the unrelated fact', async () => { /* ... */ });
  it('is unsatisfied when the attribute has no codeMap row at all', async () => { /* ... */ });
});
```

- [ ] **Step 2: Run it, confirm it fails.**
- [ ] **Step 3: Implement.** Add `adaptAttributeCondition(c, codeMap)` returning `{ selection, override } | null` — `null` means `patient.*`, handled by `resolveAttribute`. Map namespaces per the D3 table. An attribute with no `codeMap` row resolves to `undefined` today and must stay unsatisfied, not throw.
- [ ] **Step 4: Run tests, confirm they pass. Typecheck.**
- [ ] **Step 5: Commit** — `feat: route clinical attribute conditions through the kernel under v1`

---

### Task 8: Compound gates propagate uncertainty (P2-6)

**Files:** `gate-evaluator.ts` (`evaluateCompound`, `evaluateConditionKernel` return shape); test `gate-evaluator-compound-uncertainty.test.ts`

`evaluateCondition*` returns `{satisfied, reason, fieldsRead}` today, so D5's signal dies at the compound boundary. Widen the internal return and define propagation. **Truth table, normative:**

| Operator | Conditions | `satisfied` | `indeterminate` |
|---|---|---|---|
| AND | any definite `false` | `false` | `false` — a definite false dominates; the gate's outcome is certain |
| AND | all `true` except ≥1 indeterminate | `false` | `true` |
| AND | all definite `true` | `true` | `false` |
| OR | any definite `true` | `true` | `false` — a definite true dominates |
| OR | all `false` except ≥1 indeterminate | `false` | `true` |
| OR | all definite `false` | `false` | `false` |
| either | all indeterminate | `false` | `true` |

The principle: **uncertainty is reported only when it could have changed the answer.** `uncertainty[]` is the deduplicated union of contributing conditions' reasons, and is empty whenever `indeterminate` is false.

- [ ] **Step 1: Write the failing test** — one case per truth-table row, plus: `it('leaves a legacy-v0 compound gate’s result shape unchanged')`.
- [ ] **Step 2–5:** implement, test, typecheck, commit — `feat: propagate condition uncertainty through compound gates`

---

### Task 9: Wire the assembler at every entry point (P1-2)

**Files:**
- Modify: `resolvers/mutations/resolution.ts` (start + **three** retraversal sites: `:347`, `:510`, `:697`), `resolvers/mutations/multi-pathway-resolution.ts`
- Test: `apps/pathway-service/src/__tests__/resolution-fact-store-wiring.test.ts`

Until this lands, `assembleContext` has no callers and Tasks 4–8 run only in unit tests. Facts are **not persisted** (plan 05b), so every entry point re-assembles from `buildEffectivePatientContext(initialPatientContext, additionalContext)` under the session's **stored** temporal context. Plan 05 decision 5 is what makes this sound: identical input yields identical `factId`s.

- [ ] **Step 1: Write the failing test**

```ts
describe('every engine entry point assembles a fact store', () => {
  it('startResolution builds facts from the SYNTHETIC payload', async () => { /* ... */ });
  it('startMultiPathwayResolution builds facts for each child session', async () => { /* ... */ });
  for (const entry of ['overrideNode', 'answerGateQuestion', 'addPatientContext']) {
    it(`${entry} re-assembles rather than passing an empty store`, async () => { /* ... */ });
  }
});

describe('addPatientContext changes what a gate decides (the P1-2 flip test)', () => {
  it('re-resolves a previously unsatisfied gate once the new fact arrives', async () => {
    // 1. start a v1 session; a lab gate is unsatisfied (no matching fact)
    // 2. addPatientContext supplies the matching lab
    // 3. the gate is now satisfied
    // With an empty or stale store this stays unsatisfied — which is the bug.
  });
});

describe('retraversal reuses the stored clock', () => {
  it('resolves the same horizons on re-run as at creation', async () => {
    // Pin evaluationAsOf in the past; a QUARTER lab in-window relative to the
    // STORED clock must still match when retraversed today.
  });
});
```

- [ ] **Step 2: Run it, confirm it fails.**
- [ ] **Step 3: Implement.** Factor one helper — `factStoreForSession(session, additions)` — and call it at all five sites rather than repeating the assembly. Retraversal must not stamp a fresh clock; it reads `session.temporal_context`.
- [ ] **Step 4: Run the FULL suite.** Compare against 958/9.
- [ ] **Step 5: Commit** — `feat: assemble a fact store at every resolution entry point`

---

### Task 10: Prove it, document the gaps, reconcile the suite

**Files:** `docs/superpowers/plans/2026-07-26-temporal-horizon-00-overview.md`, `docs/superpowers/specs/2026-07-21-pathway-temporal-horizon-design.md` (§6 note), `temporal/select-facts.ts` (comment correction)

- [ ] **Step 1: Prove `legacy-v0` is untouched.** The claim is structural, and the evidence is that **every pre-existing gate-evaluator and traversal test passes with its assertions unmodified** — only call shapes changed (Task 3). Run the full suite and diff against 958/9. Any assertion that had to be weakened is a seam bug; fix the seam, not the test.
- [ ] **Step 2: Enumerate the `v1` deltas** in the design doc's Compatibility section, from the tests that pin them: validity filtering, latest-vs-first scalar selection, equal-time ambiguity, future-date exclusion, horizon filtering of membership, and vitals membership/count becoming satisfiable.
- [ ] **Step 3: Correct `select-facts.ts:58`.** Its comment claims the candidate rules make `legacy-v0` "genuinely behavior-preserving". They mirror the current evaluator's *candidate* rules only; validity, ordering, and vitals bucketing still differ. Rewrite it to say what it actually guarantees.
- [ ] **Step 4: Update the overview.** Plan 04 Produces/Consumes; the corrected plan-01 claim; plan 04b (`satisfaction_check.lookback_days`, D4); governed reachability moved into plan 07 with its four open questions (request clock, policy version, `temporal_defaults` loading, snapshot→fact mapping); `ALWAYS_EVALUABLE` retains its meaning (P2-5).
- [ ] **Step 5: Commit** — `docs: record the v1 deltas and reconcile the suite overview`

---

## Acceptance criteria

- [ ] `legacy-v0` executes no kernel code, and every pre-existing test passes with **unmodified assertions**.
- [ ] Full suite at 958 passed / 9 failed or better; the 9 are the two known scorer suites.
- [ ] `evaluateGate` has no `Date.now()` fallback and throws without a `temporalContext`.
- [ ] Under `v1`, no operator branch reads `patientContext.labResults`, `.conditionCodes`, `.medications`, `.allergies`, or `.vitalSigns` directly — `grep` for those in `evaluateConditionKernel` returns nothing.
- [ ] A condition carrying both `window_days` and `horizon` is rejected; `window_days` alone still filters.
- [ ] `sweepableConditions` and the evaluator parse overrides through the same function.
- [ ] `lab.a1c exists` with only an unrelated lab present is unsatisfied; an `allergy.*` equality gate is satisfiable; a nested custom vital resolves.
- [ ] `addPatientContext` can flip a previously unsatisfied gate.
- [ ] Each truth-table row in Task 8 has a passing test.
- [ ] Reachability is unchanged, and the overview records why plus the four questions plan 07 must answer.
