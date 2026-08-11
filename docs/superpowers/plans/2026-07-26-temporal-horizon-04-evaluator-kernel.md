# Temporal Horizon Plan 04 — Evaluator and Reachability on the `selectFacts` Kernel

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (recommended — this plan is larger than 05) or superpowers:subagent-driven-development to implement task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a **`v1` evaluation path** in which `selectFacts` is the only way a gate condition reads clinical data, so horizon, clinical status, and record validity govern every gate — while `legacy-v0` keeps executing today's code, untouched, as the shadow baseline.

**Architecture:** `evaluateGate` gains a **version seam**: it dispatches on `temporalContext.temporalPolicyVersion`. `legacy-v0` runs `evaluateConditionLegacy` — today's function, byte-for-byte, including `getCodeEntries` / `getNumericValue` / `collectLabSeries`. `v1` runs `evaluateConditionKernel`, built across Tasks 4–8. A new `temporal/condition-adapter.ts` translates a `GateCondition` into the kernel's `FactSelectionCondition` plus a NODE-level `ConditionTemporalOverride`, and owns the attribute-namespace→field mapping the anchor sweep also needs; `temporal/gate-policy.ts` composes the plan-03 cascade with the plan-02 clock into one `EffectivePolicy` per condition. Under `v1` only, the resolvers call plan 05's `assembleContext` at **all five** engine entry points — it has no callers at all today.

**Tech Stack:** TypeScript 5, Apollo Server 4 + Federation 2.10, Jest + ts-jest.

## Revision history

- **v1 (2026-08-11, `a6b0c65`)** — first draft, written unattended from `main` @ `d6f51fd`.
- **v2 (2026-08-11, `907a674`)** — rewritten after review round 1. Seven findings (4×P1), all verified, all accepted. Central premise inverted: the kernel became the `v1` path and the legacy evaluator was retained as the shadow baseline.
- **v3 (2026-08-11, `8e7cab1`)** — revised after review round 2. Six findings (4×P1), all verified, all accepted. Round 2 found that the v2 rewrite *introduced* three new defects while fixing round 1's: the attribute routing bypassed the anchor sweep, assembly was wired unconditionally and so leaked validation into `legacy-v0`, and Tasks 6 and 8 stated contradictory uncertainty contracts.
- **v4 (this document)** — revised after review round 3. Four findings (3×P1), all verified, all accepted. Round 3 is mostly about *sequencing and scope*: the policy selector was given a shape the multi-pathway resolver cannot supply, two tests were placed at tasks where they could not fail, and v3's own `legacy-v0` compatibility fix was itself a behavior change in the opposite direction. **Applied as targeted edits, not a rewrite** — the v2→v3 full rewrite introduced three defects, and this document is now stable enough that surgical change is the lower-risk operation.

---

## Review dispositions — round 3

**[P1-14] The policy selector cannot take a `ResolutionContext` — ACCEPTED.**
`multi-pathway-resolution.ts:214` stamps the shared clock **before** `getMatchedPathways`, and the zero-match branch (`:222-237`) creates a parent session and returns without ever building a `ResolutionContext`. A selector taking `rctx` is unbuildable on that path and would have to be invented per-child afterwards, which also breaks "one clock, one version for the whole run" (§1). The selector is **request/deployment-scoped**, called once immediately before `makeEvaluationTemporalContext`. The file already establishes this position: `assertKnownPolicyVersion` sits at `:219`, before the branch, with a comment giving exactly this reasoning.

**[P1-15] Ignoring malformed overrides is itself a `legacy-v0` behavior change — ACCEPTED, and v3 had it backwards.**
v3's D1 assumed today's sweep tolerates a malformed `horizon`. It does not. `sweepableConditions` copies the raw value (`resolution-context.ts:604-606`) and `collectEncounterAnchorRequirements` → `resolveEffectivePolicy` → `parseHorizonValue` validates it — so a malformed override **already rejects session creation today**, conditionally: `assertEncounterAnchor` returns early when `encounterStart` is present (`:638`), so validation fires only when the anchor is absent. Catching and ignoring parser errors would turn requests that are rejected today into successes — a `legacy-v0` change in the opposite direction from the one v3 was trying to avoid. The legacy extraction path is preserved **exactly**, including its conditionality and its coded-only scope; strict shared parsing applies to `v1` alone.

**[P1-16] Two tests were placed at tasks where they cannot fail — ACCEPTED.**
Task 3 ends with `evaluateConditionKernel` delegating to the legacy evaluator and `factStore: []`; no kernel operator or assembler is active until Tasks 4–9. So Task 3's "pathway `YEAR` admits a 200-day-old lab" traversal test would pass with `pathwayDefaults` dropped entirely — the legacy path never consults them. It moves to Task 9; Task 3 instead asserts, with constructor spies, that **every** engine construction site receives `rctx.temporalDefaults`. For the same reason Task 1's anchor-sweep test cannot go through a start mutation — the activation seam does not exist until Task 9 — so it becomes a direct unit test on `assertEncounterAnchor`.

**[P2-17] The SDL guard forbids output exposure, not caller selection — ACCEPTED.**
`/temporalPolicyVersion\s*:/` matches the identifier anywhere in the schema, including the **planned** read-only exposure on session output types (design §606: "GraphQL exposure of the session temporal context and `temporalPolicyVersion`"). The guard would fail plan 08 for doing something legitimate. It now inspects only the argument definitions of the two start mutations.

---

## Review dispositions — round 2

Verified against the code before acceptance. None rejected.

**[P1-8] Clinical attribute gates bypass the encounter-anchor sweep — ACCEPTED.**
D3 routes `vitals.*` through `v1` policy, whose system default for vitals is **ENCOUNTER** (plan 03 decision; design §590 fixes vitals to Encounter in the UI too). The sweep skips every attribute condition by construction — `resolution-context.ts:589-601` returns early when `field` is not a string, with a comment reasoning that attribute conditions "never resolve a horizon." **That reasoning was true when v1 of this plan was written and D3 falsified it.** A `v1` `vitals.systolic_bp` gate with no `encounterStart` now passes preflight and throws mid-traversal — the exact failure `collectEncounterAnchorRequirements` exists to prevent, and the same preflight/evaluation divergence class as P1-10. Task 1 moves the namespace→field mapping into the adapter so the sweep and `adaptAttributeCondition` derive the field from one source.

**[P1-9] Unconditional assembly breaks the "legacy-v0 is untouched" guarantee — ACCEPTED.**
`assembleContext` validates: `parseClinicalState`, `parseRecordValidity`, `parseSyntheticDate`, and `assertOrdered` (`context-assembler.ts:80-113`) all throw. Task 9 called it at all five entry points unconditionally, so a `legacy-v0` request carrying a malformed date or an inverted interval — which today's evaluator tolerates or ignores — would be **rejected before the version seam ever runs**, for a fact store that the legacy path never reads. Assembly is now `v1`-only; `legacy-v0` passes an empty store and never invokes the assembler.

The same finding kills v2's single helper: `factStoreForSession(session, additions)` cannot serve the start mutations, because at `startResolution` **no session exists yet** — there is only the resolution input and a freshly-stamped clock. Two helpers over one shared core (Task 9).

It also catches a boundary change v2 introduced silently: Task 1 made `sweepableConditions` *reject* malformed overrides that today are ignored. That is a new session-creation failure under `legacy-v0`. See D1.

**[P1-10] Pathway temporal defaults are optional and never threaded — ACCEPTED.**
`GateEvaluationDeps.pathwayDefaults?` was optional and no task said to add `rctx.temporalDefaults` to the engine constructors or the five construction sites. Omitted, the cascade silently collapses to system defaults — while the anchor sweep *does* use pathway defaults, so preflight and evaluation disagree about the same pathway. `pathwayDefaults` becomes **required**, threaded through both engines, with a traversal-level test where a pathway `YEAR` lab default overrides `v1`'s `QUARTER`.

**[P1-11] Tasks 6 and 8 defined incompatible uncertainty contracts — ACCEPTED.**
Task 6 required a definite aggregate to carry non-empty `uncertainty` (a count that is a lower bound); Task 8 required `uncertainty` to be empty whenever `indeterminate` is false. `selectFacts` deliberately returns aggregate `READY` — not `INDETERMINATE` — after excluding uncertain facts (`select-facts.ts:188-190`), so a definite aggregate with real uncertainty is the *normal* case, and the two rules cannot both hold. The concepts are now independent. See D5.

**[P2-12] The `v1` wiring tests have no activation seam — ACCEPTED.**
Global Constraints say nothing routes to `v1`, yet Task 9 asked to "start a `v1` session." Start mutations always receive `DEFAULT_TEMPORAL_POLICY_VERSION` (`legacy-v0`), so that scenario was unwritable without brittle module mocking. Task 9 adds a **trusted server-side selector**, `resolveTemporalPolicyVersion(rctx)`, defaulting to `legacy-v0` and injectable in tests. **Not** a caller-controlled GraphQL input — that would hand an unauthenticated caller (AD-1) the choice of evaluation semantics.

**[P2-13] The reconciliation task leaves design §10 stale — ACCEPTED.**
§589 states "**Attribute conditions** get no horizon control (encounter-derived, no timeline)." D3 governs `lab.*`, `vitals.*`, and `allergy.*`. Task 10 now revises §10, enumerates the attribute-specific `v1` deltas, and states plainly that **retaining the baseline function is not shadow execution** — running both paths and diffing them is the rollout change's job, not this plan's.

---

## Open decisions — settled across two review rounds

**D1 — `horizon`/`status` become typed fields on `CodedCondition` here; the `v1` sweep uses a strict shared parser; the `legacy-v0` sweep is preserved byte-for-byte.** *(Round 1: shared-parser amendment. Round 2: rejection narrowed. Round 3: corrected — v3 had today's behavior backwards, per P1-15.)*

Today's sweep is **not** lenient. It copies the raw value (`resolution-context.ts:604-606`) and the cascade validates it via `parseHorizonValue`, so a malformed `horizon` **already rejects session creation** — but only when `encounterStart` is absent, because `assertEncounterAnchor` returns early otherwise (`:638`). That conditional rejection is current behavior and must survive untouched.

So `sweepableConditions` takes the version and has two paths:

| | `legacy-v0` | `v1` |
|---|---|---|
| Conditions swept | coded only (today's `FIELD_TO_KIND` filter) | coded **+** `lab`/`vitals`/`allergy` attributes |
| Override extraction | raw copy, exactly as today | `parseConditionOverride` |
| Malformed override | rejects iff `encounterStart` absent — unchanged | rejects |

Neither path catches parser errors. Publish-time rejection of malformed authoring still belongs to plan 06's canonicalizer; this is only about not moving the runtime boundary in either direction.

**D2 — `window_days` is translated into a NODE-level `{days:N}` horizon; supplying both `window_days` and `horizon` is rejected.** *(Accepted, unchanged since v2.)* Matches design §419 and keeps read-time behavior identical before and after plan 06's rewrite.

**D3 — Attribute conditions route through the kernel for `lab`, `vitals`, and `allergy`; `patient.*` stays on `resolveAttribute`. Selection is chosen by namespace and value type, never by operator class.** *(Round 1: selection redesigned. Round 2: the mapping becomes shared with the sweep.)*

| Namespace | Resolves via | Sweep field | Kernel selection | Then |
|---|---|---|---|---|
| `lab.*` | `codeMap` → `(code, system)` | `labs` | **exact-code scalar** | `compareScalar(value, op, target)` |
| `vitals.*` | dotted path remainder → `code` = path, `system` = `VITALS_SYSTEM` | `vitals` | **exact-code scalar** | `compareScalar(...)` |
| `allergy.*` | `codeMap` → `(code, system)` | `allergies` | **exact-code membership** | boolean derivation, then `compareScalar` |
| `patient.*` | `resolveAttribute` | *(not swept)* | none — no `FactKind`, interval, or clinical state | unchanged |

The **Sweep field** column is the round-2 addition: `attributeNamespaceToField()` is exported from the adapter and consumed by both `adaptAttributeCondition` and `sweepableConditions`, so an attribute gate that needs an encounter anchor is caught at preflight.

`exists` is never routed to the kernel's `exists` operator for attributes — that operator ignores code and system by design. An attribute `exists` becomes an exact-code membership selection satisfied by a non-empty `selected`.

**D4 — `satisfaction_check.lookback_days` is out of scope; tracked as plan 04b.** *(Accepted unchanged.)*

**D5 — `indeterminate` and `uncertainty` are independent signals.** *(Round 1: recorded at all. Round 2: decoupled per P1-11.)*

- **`indeterminate: boolean`** — uncertainty *could have prevented a definitive outcome*. Governed by the compound truth table (Task 8). False whenever the gate's answer is certain.
- **`uncertainty: UncertaintyReason[]`** — relevant uncertainty *existed*, including excluded observations and counts that are lower bounds. **Retained even when the outcome is definite**, because a definite `true`/`false` dominating the logic does not make the doubt untrue — and plan 08's evidence has to show it.

`satisfied` is unchanged by either. An aggregate that excluded two uncertain facts and still cleared its threshold is `satisfied: true, indeterminate: false, uncertainty: ['TEMPORAL_UNKNOWN']`.

**D6 — `evaluateGate`'s positional parameters become an options object, and `pathwayDefaults` is required.** *(Round 1: accepted. Round 2: `pathwayDefaults` promoted from optional per P1-10.)* An optional cascade input is a silent-divergence generator: omitted at one of five call sites, that pathway evaluates against system defaults while its preflight used pathway defaults.

---

## Global Constraints

- **Branch:** `feat/temporal-horizon-evaluator-kernel`, worktree `/home/claude/workspace/features/feat-temporal-horizon-evaluator-kernel/prism-graphql`, from `origin/main` at `d6f51fd`.
- **All commands from the worktree root. Never chain `cd` with `&&`.**
- **Typecheck:** `./node_modules/.bin/tsc -p apps/pathway-service/tsconfig.json --noEmit`. There is no `typecheck` script, no `apps/pathway-service/node_modules` (binaries hoist to the root), and bare `npx tsc` resolves to a decoy that prints "This is not the tsc command you are looking for".
- **Tests:** `npm test --prefix apps/pathway-service -- --runInBand <path>`. `testRegex` is `/__tests__/.*.test.ts` — a test file placed beside its source is silently never run.
- **`tsconfig` is NOT full strict and excludes `src/__tests__`** (`diagnostics: false`). **Test files are never typechecked.** Every invariant needs a runtime throw plus a test that fails without it. A type alone enforces nothing.
- **Baseline: 9 failures / 2 suites** (`data-completeness-scorer`, `patient-match-scorer`) — **958 passed / 9 failed / 967 total, 84 of 86 suites green**, measured on `main` @ `d6f51fd` on 2026-08-11. Measure on `main`, never on a copy of this branch. The suite has never been green; do not chase these two.
- **`legacy-v0` executes no kernel code, and no code this plan adds.** Structural, not behavioral: the version seam (Task 3) routes `legacy-v0` to the untouched legacy function; the assembler is not called; override parsing does not reject (D1). Every pre-existing gate-evaluator and traversal test must pass with **unmodified assertions** — that is the proof.
- **No caller can select `v1`.** `resolveTemporalPolicyVersion()` is **request/deployment-scoped** — it takes no `ResolutionContext`, because the multi-pathway resolver stamps its clock before any pathway is matched and its zero-match path never builds one (P1-14). It defaults to `legacy-v0` and is injectable only from tests. Adding a GraphQL *argument* would let an unauthenticated caller (AD-1, `docs/AUTHORIZATION_DEBT.md`) choose evaluation semantics; a read-only *output* field is fine and is planned for plan 08 (design §606). The rollout flip changes the selector, not the schema.
- **`apps/pathway-service/src/__generated__/resolvers-types.ts` is now tracked** (PR #53). Do not delete it; if `npm run build` rewrites it, commit the change with the task that caused it.
- **Commit prefixes** `feat:`/`fix:`/`test:`/`refactor:`/`docs:`; no `@anthropic.com`/`@claude.com`, no "Generated with" lines. End each message with
  `Co-Authored-By: Claude Opus 5 (1M context) <noreply@example.com>`

## Decisions this plan locks

1. **Two paths coexist, separated by version.** `getCodeEntries`, `getNumericValue`, `collectLabSeries`, and `isWithinWindow` are **not deleted** — they are the `legacy-v0` implementation and the baseline the rollout diffs against. The rollout flip retires them.
2. **`v1` is where behavior moves, and every delta is disclosed.** A behavior change reachable under `legacy-v0` is a bug in the seam.
3. **Membership fails open; scalar and aggregate fail closed.** Already implemented in `selectFacts` (`select-facts.ts:184-190`); consumed here, not re-decided per operator.
4. **Reachability is untouched by this plan.** It has neither the inputs nor a fact source until plan 07's snapshot mapper. `ALWAYS_EVALUABLE` keeps its meaning.
5. **The assembler is wired at every entry point, under `v1` only.** Five sites: two start mutations, three retraversal constructions. `legacy-v0` gets an empty store and never calls it.
6. **The adapter is the single source for condition temporal keys *and* the attribute namespace→field mapping.** The evaluator, plan 03's anchor sweep, and the attribute router all read it.
7. **Preflight and evaluation must never disagree.** Both P1-8 and P1-10 are instances of one failure: a pathway that passes `collectEncounterAnchorRequirements` and then throws, or resolves against different defaults, mid-traversal. Any new cascade input must reach both.

## Deliberately out of scope

- **Per-condition evidence and its GraphQL surface** — plan 08. This plan records `indeterminate`/`uncertainty` but exposes nothing.
- **Canonicalization, the `window_days` → `horizon` JSON rewrite, and publish-time rejection of malformed overrides** — plan 06 (D1, D2).
- **Governed reachability** — plan 07, with the snapshot mapper that gives it facts.
- **The LIVE snapshot mapper** — plan 07. `assembleContext` still throws `NOT_IMPLEMENTED` for LIVE.
- **Normalized-fact persistence and REPLAY** — plan 05b.
- **`satisfaction_check.lookback_days`** — plan 04b (D4).
- **Shadow *execution* and retiring the legacy path** — the rollout change. Keeping the baseline function available is a precondition for shadowing; it is not shadowing. Nothing here runs both paths or diffs them.
- **Consumer projections** (`actionableMedications`, DDI, scorer projections). The fact store feeds the gate evaluator only.

---

### Task 1: The condition adapter, the shared parser, and the shared namespace map

**Files:**
- Create: `apps/pathway-service/src/services/resolution/temporal/condition-adapter.ts`
- Modify: `apps/pathway-service/src/services/resolution/types.ts` (add `horizon?`/`status?` to `CodedCondition`), `apps/pathway-service/src/resolvers/helpers/resolution-context.ts` (`sweepableConditions`)
- Test: `apps/pathway-service/src/__tests__/temporal/condition-adapter.test.ts`, and extend the plan-03 anchor-sweep suite

**Interfaces:**
- Produces: `toFactSelectionCondition`, `parseConditionOverride(raw, where)`, `nodeOverrideFor`, `attributeNamespaceToField(ns): GateField | null`.
- Consumes: `contract.ts`, `cascade.ts`, `evaluation-context.ts`.

**Why one parser and one namespace map (D1, D3, P1-8):** plan 03's sweep reads `horizon`/`status` off untyped AGE JSON and skips attribute conditions entirely. Once D3 gives `vitals.*` an ENCOUNTER horizon under `v1`, that skip is a preflight hole. Both the sweep and the attribute router must derive the field from the same function, or they will disagree.

- [ ] **Step 1: Write the failing test**

```ts
const base: CodedCondition = { field: 'labs', operator: 'greater_than', value: '718-7' };

describe('toFactSelectionCondition', () => {
  it('carries field, operator, value and system through unchanged', () => { /* ... */ });
  it('rejects an operator the kernel does not model', () => {
    // Runtime throw, not a type error: tsconfig excludes __tests__.
    expect(() => toFactSelectionCondition({ ...base, operator: 'sounds_like' as never }))
      .toThrow(TemporalContextError);
  });
  it('rejects a field with no fact kind', () => { /* ... */ });
});

describe('nodeOverrideFor — the NODE tier', () => {
  it('is undefined when the author set neither axis', () => { /* ... */ });
  it('carries the two axes independently', () => { /* ... */ });
});

describe('window_days (D2)', () => {
  it('is translated into a NODE-level custom horizon, never dropped', () => {
    expect(nodeOverrideFor({ ...base, operator: 'count_in_window', window_days: 90 }))
      .toEqual({ horizon: { days: 90 } });
  });
  it('REJECTS a condition supplying both window_days and horizon (design §419)', () => { /* ... */ });
  it('rejects a window_days that is not a finite positive integer (§13)', () => {
    for (const bad of [0, -5, 1.5, Number.NaN]) {
      expect(() => nodeOverrideFor({ ...base, window_days: bad })).toThrow(TemporalContextError);
    }
  });
});

describe('attributeNamespaceToField — one mapping, two consumers (P1-8)', () => {
  it('maps the three clinical namespaces to their gate fields', () => {
    expect(attributeNamespaceToField('lab')).toBe('labs');
    expect(attributeNamespaceToField('vitals')).toBe('vitals');
    expect(attributeNamespaceToField('allergy')).toBe('allergies');
  });
  it('returns null for patient demographics', () => {
    expect(attributeNamespaceToField('patient')).toBeNull();
  });
  it('returns null for an unknown namespace rather than throwing', () => {
    // The sweep must not reject a session over a namespace the evaluator will
    // simply fail to resolve.
    expect(attributeNamespaceToField('astrology')).toBeNull();
  });
});
```

And in the anchor-sweep suite — **called directly, not through a mutation** (P1-16: the activation seam that lets a request select `v1` does not exist until Task 9, so a mutation-level `v1` test here could not be written without mocking):

```ts
// assertEncounterAnchor(rctx, temporalCtx) takes both explicitly, so a v1
// preflight is testable at this task with no resolver involvement at all.
const v1NoAnchor = makeEvaluationTemporalContext({
  evaluationAsOf: '2026-08-11T00:00:00.000Z', temporalPolicyVersion: 'v1',
});

describe('the sweep covers clinical attribute conditions (P1-8)', () => {
  it('rejects a v1 pathway whose vitals.* attribute gate has no encounterStart', () => {
    // v1 vitals default is ENCOUNTER. Without this the gate passes preflight
    // and throws mid-traversal — after LLM gates have run and audit rows exist.
    expect(() => assertEncounterAnchor(rctxWithVitalsAttributeGate(), v1NoAnchor))
      .toThrow(/MISSING_ENCOUNTER_ANCHOR/);
  });
  it('accepts the same pathway when encounterStart is supplied', () => { /* ... */ });
  it('does NOT sweep patient.* demographics', () => { /* no anchor required */ });
  it('leaves legacy-v0 unaffected — vitals are LIFETIME there', () => { /* no throw */ });
});

describe('the legacy-v0 sweep is preserved exactly (D1, P1-15)', () => {
  it('still REJECTS a malformed horizon when encounterStart is absent', () => {
    // This is today's behavior: the raw value reaches parseHorizonValue via the
    // cascade. v3 wrongly assumed it was tolerated; ignoring it would turn a
    // current rejection into a success.
    expect(() => assertEncounterAnchor(rctxWithMalformedOverride(), legacyNoAnchor))
      .toThrow(TemporalContextError);
  });
  it('still IGNORES it when encounterStart is present', () => {
    // assertEncounterAnchor returns early (:638), so nothing is ever parsed.
    expect(() => assertEncounterAnchor(rctxWithMalformedOverride(), legacyWithAnchor))
      .not.toThrow();
  });
  it('does not sweep attribute conditions under legacy-v0', () => {
    // Coverage must not widen on the legacy path, or a pathway that starts
    // today stops starting.
    expect(() => assertEncounterAnchor(rctxWithVitalsAttributeGate(), legacyNoAnchor))
      .not.toThrow();
  });
});
```

- [ ] **Step 2: Run it, confirm it fails.**
- [ ] **Step 3: Implement the adapter.** Add `horizon?: Horizon` / `status?: TemporalStatus` to `CodedCondition`. `toFactSelectionCondition` guards with `isTemporalOperator` and `fieldToKind`; copy `system` only when present. `parseConditionOverride` rejects the `window_days`+`horizon` pair first, then validates and calls `parseHorizonValue`.
- [ ] **Step 4: Give `sweepableConditions` a version parameter and two paths (D1, P1-15).** Under `legacy-v0`, leave the body exactly as it is — coded conditions only, raw `as never` copy, cascade validates downstream. Under `v1`, additionally sweep attribute conditions whose namespace maps via `attributeNamespaceToField` (`null` ⇒ skip), and extract overrides with `parseConditionOverride`. **Neither path catches parser errors.** Update the comment at `:589-601`: it is still correct for `legacy-v0` and false for `v1`, so it must say which.
- [ ] **Step 5: Run both suites. Typecheck.**
- [ ] **Step 6: Commit** — `feat: adapt a coded condition onto the fact-selection contract`

---

### Task 2: One effective policy per gate condition

**Files:** create `temporal/gate-policy.ts`; test `__tests__/temporal/gate-policy.test.ts`

Produces `effectivePolicyForCondition(condition, ctx, pathwayDefaults): EffectivePolicy`. A thin seam, deliberately: the one place that reads `ctx.temporalPolicyVersion`, so no operator branch resolves against a different version than its siblings.

- [ ] **Step 1: Write the failing test**

```ts
const ctx = makeEvaluationTemporalContext({
  evaluationAsOf: '2026-08-11T00:00:00.000Z', temporalPolicyVersion: 'legacy-v0',
});

describe('effectivePolicyForCondition', () => {
  it('resolves labs to an unbounded lower bound under legacy-v0', () => {
    const p = effectivePolicyForCondition({ field: 'labs', operator: 'greater_than', value: '718-7' }, ctx, {});
    expect(p.horizon.lowerBound).toBeNull();
    expect(p.horizon.upperBound).toBe('2026-08-11T00:00:00.000Z');
    expect(p.status).toBeUndefined();
  });
  it('applies the legacy-v0 active default to conditions', () => { /* status === 'active' */ });
  it('lets a NODE horizon beat the pathway default', () => {
    const c: CodedCondition = { field: 'labs', operator: 'greater_than', value: '718-7', horizon: 'QUARTER' };
    expect(effectivePolicyForCondition(c, ctx, { horizons: { labs: 'YEAR' } }).horizon.lowerBound)
      .toBe('2026-05-13T00:00:00.000Z');   // 90 days, not 365
  });
  it('lets a PATHWAY default beat the system default (P1-10)', () => {
    const v1 = makeEvaluationTemporalContext({
      evaluationAsOf: '2026-08-11T00:00:00.000Z', temporalPolicyVersion: 'v1',
    });
    const c: CodedCondition = { field: 'labs', operator: 'greater_than', value: '718-7' };
    // v1 system default is QUARTER; the pathway says YEAR.
    expect(effectivePolicyForCondition(c, v1, { horizons: { labs: 'YEAR' } }).horizon.lowerBound)
      .toBe('2025-08-11T00:00:00.000Z');
  });
  it('resolves the version from the context, never from an argument', () => { /* ... */ });
});
```

- [ ] **Step 2: Run it, confirm it fails.**
- [ ] **Step 3: Implement.** Compose `resolveEffectivePolicy(field, ctx.temporalPolicyVersion, pathwayDefaults, nodeOverrideFor(condition))` then `toEffectivePolicy(tier, ctx)`. Do not catch `MISSING_ENCOUNTER_ANCHOR` — plan 03's sweep turns that into an up-front rejection, and swallowing it restores the mid-traversal throw the sweep exists to prevent.
- [ ] **Step 4: Test, typecheck.**
- [ ] **Step 5: Commit** — `feat: resolve one effective policy per gate condition`

---

### Task 3: The version seam — dispatch that changes nothing yet

**Files:** `gate-evaluator.ts`, `./types.ts` (`GateEvaluationResult` gains `indeterminate?`/`uncertainty?`), `traversal-engine.ts`, `retraversal-engine.ts`; test `gate-evaluator-version-seam.test.ts`

Load-bearing, and it must land **before** any operator moves. Introduces `GateEvaluationDeps` (D6), removes the `Date.now()` default, renames today's `evaluateCondition` → `evaluateConditionLegacy`, and adds `evaluateConditionKernel` which at the end of this task simply delegates to the legacy function.

A no-op fork sounds pointless. It is not: it proves the dispatch, the deps object, and every updated call site in isolation, so when Tasks 4–8 change the `v1` branch, a failure is attributable to the operator rewrite and not the plumbing.

- [ ] **Step 1: Write the failing test**

```ts
describe('evaluateGate requires an explicit clock (gate-evaluator.ts:745)', () => {
  it('throws rather than defaulting to Date.now() when temporalContext is absent', async () => {
    await expect(evaluateGate(gate, { factStore: [], patientContext: pc } as never))
      .rejects.toThrow(/temporalContext/i);
  });
  it('throws when pathwayDefaults is absent (P1-10)', async () => {
    // Required, not optional: an omitted cascade input silently collapses to
    // system defaults while the preflight used pathway defaults.
    await expect(evaluateGate(gate, depsWithout('pathwayDefaults'))).rejects.toThrow(/pathwayDefaults/i);
  });
});

describe('the version seam dispatches on the session policy version', () => {
  it('routes legacy-v0 to the legacy evaluator', async () => { /* ... */ });
  it('routes v1 to the kernel evaluator', async () => { /* ... */ });
  it('rejects an unknown version rather than falling back to legacy', async () => {
    await expect(evaluateGate(gate, deps('v99'))).rejects.toThrow(/v99/);
  });
});

describe('the fork is a no-op until Task 4', () => {
  it('decides identically under legacy-v0 and v1 for a membership gate', async () => {
    // DELETED in Task 4 — that is where the paths diverge.
  });
});
```

- [ ] **Step 2: Run it, confirm it fails.**
- [ ] **Step 3: Implement.** `evaluateGate(gate, deps)` with `GateEvaluationDeps = { temporalContext, pathwayDefaults, factStore, patientContext, resolutionState, gateAnswers, gateId?, llmEvaluator?, codeMap? }`. Throw on a missing `temporalContext` or `pathwayDefaults`. Rename `evaluateCondition` → `evaluateConditionLegacy` **without editing its body**.
- [ ] **Step 4: Thread `pathwayDefaults` through both engines.** Add it to the `TraversalEngine` and `RetraversalEngine` constructors beside the existing `temporalContext` (`traversal-engine.ts:152`, `retraversal-engine.ts:82`), and supply `rctx.temporalDefaults` at **all five** construction sites — `resolution.ts:347`, `:510`, `:697`, plus both start paths and `multi-pathway-resolution.ts`. Pass the `temporalContext` object, not the derived `now`. `factStore` is `[]` at this task; Task 9 fills it.
- [ ] **Step 5: Assert the plumbing with spies, not with behavior (P1-16).** At this task `evaluateConditionKernel` still delegates to the legacy evaluator and `factStore` is `[]`, so a behavioral cascade test **cannot fail** — the legacy path never reads `pathwayDefaults`, and the 200-day-old lab is admitted either way. Instead, spy on both engine constructors and assert every one of the five sites passes `rctx.temporalDefaults` by identity. The behavioral proof moves to Task 9, where the kernel and assembler are live.
- [ ] **Step 6: Run the FULL suite.** Broad mechanical churn in test call sites is expected. **Existing assertions must not be weakened** — only call shapes change. Compare against 958/9.
- [ ] **Step 7: Commit** — `refactor: give evaluateGate explicit dependencies and a version seam`

---

### Task 4: Membership operators on the kernel (`v1` branch)

**Files:** `gate-evaluator.ts`; test `gate-evaluator-membership-kernel.test.ts`

Covers `includes_code`, `equals`, `exists`. Delete Task 3's no-op-fork test — this is where the paths diverge.

> **`exists` is bucket existence.** `select-facts.ts:75` short-circuits it to match any fact of the kind, ignoring code and system — which is what today's `entries.length > 0` means. Reject a `system` or non-empty `value` supplied alongside `exists` in the adapter rather than silently ignoring it.

- [ ] **Step 1: Write the failing test**

```ts
describe('membership under v1 preserves the shape of today’s matching', () => {
  it('matches a trailing-wildcard code pattern (Z94.* matches Z94.0)', async () => { /* ... */ });
  it('respects an explicit system filter', async () => { /* ... */ });
  it('exists is satisfied by any admitted fact, unsatisfied when the field is empty', async () => { /* ... */ });
});

describe('membership fails open on uncertainty, and says so (D5)', () => {
  it('counts a validity-UNKNOWN fact as a match', async () => { /* ... */ });
  it('records uncertainty even though the outcome is definite', async () => {
    const r = await evaluateGate(gate, deps('v1'));
    expect(r.satisfied).toBe(true);
    expect(r.indeterminate).toBe(false);
    expect(r.uncertainty).toContain('VALIDITY_UNKNOWN');
  });
});

describe('disclosed v1 deltas — these MUST differ from legacy-v0', () => {
  it('drops a recordValidity INVALID fact that legacy-v0 matches', async () => {
    expect((await evaluateGate(gate, deps('legacy-v0'))).satisfied).toBe(true);
    expect((await evaluateGate(gate, deps('v1'))).satisfied).toBe(false);
  });
  it('drops a lab outside QUARTER that legacy-v0 admits under LIFETIME', async () => { /* ... */ });
  it('starts matching a vitals membership gate legacy-v0 cannot satisfy', async () => {
    // getCodeEntries returns [] for 'vitals', so this gate is unsatisfiable today.
    // The concrete example behind review finding P1-1.
  });
});
```

- [ ] **Step 2–5:** implement, test, typecheck, commit — `feat: evaluate membership operators through selectFacts under v1`

---

### Task 5: Scalar operators on the kernel (`v1` branch)

**Files:** `gate-evaluator.ts`; test `gate-evaluator-scalar-kernel.test.ts`

Covers `greater_than`, `less_than`. `selectFacts` returns the **definite latest** fact, or `INDETERMINATE` when no total order is provable. The comparison stays here; only selection moves.

> **This is where plan 05's `OPEN(evaluationAsOf)` modeling pays off.** An undated vital is `OPEN(asOf)`, which `overlap()` reports as MATCH against any horizon containing the clock. If these fail with `INDETERMINATE` on undated vitals, the assembler is not wired — check Task 9 before touching the kernel.

- [ ] **Step 1: Write the failing test**

```ts
describe('scalar selection under v1', () => {
  it('compares an undated vital (OPEN interval) rather than failing closed', async () => { /* ... */ });
  it('is unsatisfied when no fact matches the code', async () => { /* ... */ });
});

describe('disclosed v1 delta — latest, not first', () => {
  it('compares the latest of several dated labs where legacy-v0 takes array order', async () => {
    // getNumericValue uses .find(). Order the fixture so first !== latest and
    // assert BOTH paths, pinning the delta rather than just the fix.
  });
});

describe('scalar INDETERMINATE fails closed and is recorded (D5)', () => {
  it('is unsatisfied and indeterminate when two results tie with no provable order', async () => {
    const r = await evaluateGate(gate, deps('v1'));
    expect(r.satisfied).toBe(false);
    expect(r.indeterminate).toBe(true);
    expect(r.uncertainty).toContain('AMBIGUOUS_LATEST');
  });
  it('is not indeterminate on a definite decision', async () => { /* indeterminate === false */ });
});
```

- [ ] **Step 2–5:** implement, test, typecheck, commit — `feat: evaluate scalar operators through selectFacts under v1`

---

### Task 6: Aggregate operators on the kernel (`v1` branch)

**Files:** `gate-evaluator.ts`; test `gate-evaluator-aggregate-kernel.test.ts`

Covers `count_in_window`, `trend_up`, `trend_down`, `delta_from_baseline`. `linearSlope` stays — pure math over a series. The `v1` series comes from `selected`, sorted by effective time; `collectLabSeries` and `isWithinWindow` remain for `legacy-v0`.

> **`count_in_window` counts distinct `factId`** (design §4). Plan 05 decision 6 widened the `buildEffectivePatientContext` merge key for this reason. If a count reads 1 where 2 is expected, check the merge key before the kernel.

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

describe('a definite aggregate still reports its uncertainty (D5, P1-11)', () => {
  it('clears its threshold while recording that the count is a lower bound', async () => {
    // selectFacts returns READY (not INDETERMINATE) after excluding uncertain
    // facts, so this is the NORMAL case, not an edge case.
    const r = await evaluateGate(gate, deps('v1'));
    expect(r.satisfied).toBe(true);
    expect(r.indeterminate).toBe(false);      // the answer is certain
    expect(r.uncertainty.length).toBeGreaterThan(0);  // the doubt is still real
  });
});
```

- [ ] **Step 2–5:** implement, test, typecheck, commit — `feat: evaluate aggregate operators through selectFacts under v1`

---

### Task 7: Attribute conditions, selected by namespace (`v1` branch)

**Files:** `condition-adapter.ts` (attribute branch), `gate-evaluator.ts`; test `__tests__/temporal/attribute-condition-kernel.test.ts`

Implements D3. Selection is chosen by **namespace and value type** via `attributeNamespaceToField` (Task 1); the comparison stays in `compareScalar`. `patient.*` never reaches the kernel.

- [ ] **Step 1: Write the failing test**

```ts
describe('namespace determines selection, not the operator (P1-3)', () => {
  it('selects a lab by EXACT mapped code, not by any-lab existence', async () => {
    // codeMap: lab.a1c -> LOINC 4548-4. Store holds an unrelated lab only.
    // The kernel's own `exists` would match it, because it ignores code+system.
    expect((await evaluateGate(a1cExistsGate, deps('v1'))).satisfied).toBe(false);
  });
  it('selects an allergy by exact code as MEMBERSHIP, then derives a boolean', async () => {
    // Allergies are StatefulFacts with no numeric value; scalar selection would
    // reject every candidate via hasFiniteValue (select-facts.ts:92).
    expect((await evaluateGate(allergyEqualsGate, deps('v1'))).satisfied).toBe(true);
  });
  it('selects a vital by dotted path, with no codeMap row', async () => {
    // vitals.systolic_bp -> { field: 'vitals', code: 'systolic_bp', system: VITALS_SYSTEM }
  });
  it('resolves a nested custom vital path', async () => { /* custom.pain_score */ });
  it('leaves patient.* on resolveAttribute', async () => { /* demographics */ });
});

describe('attribute operators outside TemporalOperator still work', () => {
  for (const op of ['not_equals', 'greater_or_equal', 'less_or_equal', 'in']) {
    it(`applies ${op} via compareScalar after kernel selection`, async () => { /* ... */ });
  }
});

describe('absent target with an unrelated fact present', () => {
  it('is unsatisfied for every namespace rather than matching the unrelated fact', async () => { /* ... */ });
  it('is unsatisfied when the attribute has no codeMap row at all', async () => {
    // resolveAttribute returns undefined today; must stay unsatisfied, not throw.
  });
});
```

- [ ] **Step 2–5:** implement `adaptAttributeCondition(c, codeMap)` returning `{ selection, override } | null` (`null` ⇒ `patient.*`), test, typecheck, commit — `feat: route clinical attribute conditions through the kernel under v1`

---

### Task 8: Compound gates propagate uncertainty (P2-6, P1-11)

**Files:** `gate-evaluator.ts`; test `gate-evaluator-compound-uncertainty.test.ts`

`evaluateCondition*` returns `{satisfied, reason, fieldsRead}` today, so the D5 signals die at the compound boundary (`gate-evaluator.ts:557`). Widen the internal return and define propagation.

**`indeterminate` truth table, normative:**

| Operator | Conditions | `satisfied` | `indeterminate` |
|---|---|---|---|
| AND | any definite `false` | `false` | `false` — a definite false dominates; the outcome is certain |
| AND | all `true` except ≥1 indeterminate | `false` | `true` |
| AND | all definite `true` | `true` | `false` |
| OR | any definite `true` | `true` | `false` — a definite true dominates |
| OR | all `false` except ≥1 indeterminate | `false` | `true` |
| OR | all definite `false` | `false` | `false` |
| either | all indeterminate | `false` | `true` |

The principle for `indeterminate`: **report it only when uncertainty could have changed the answer.**

**`uncertainty` follows a different rule (P1-11):** it is the deduplicated union of every contributing condition's reasons, **retained regardless of `indeterminate`**. A definite `true` dominating an OR does not make the excluded uncertain facts imaginary, and plan 08's evidence must be able to show them. `uncertainty` is empty only when no condition reported any.

- [ ] **Step 1: Write the failing test** — one case per truth-table row, plus:

```ts
it('retains uncertainty from a dominated condition (P1-11)', async () => {
  // OR: condition A definite true, condition B uncertain.
  const r = await evaluateGate(orGate, deps('v1'));
  expect(r.satisfied).toBe(true);
  expect(r.indeterminate).toBe(false);
  expect(r.uncertainty.length).toBeGreaterThan(0);   // B's doubt survives
});
it('deduplicates identical reasons across conditions', async () => { /* ... */ });
it('leaves a legacy-v0 compound gate’s result shape unchanged', async () => { /* ... */ });
```

- [ ] **Step 2–5:** implement, test, typecheck, commit — `feat: propagate condition uncertainty through compound gates`

---

### Task 9: Wire the assembler at every entry point, under `v1` only (P1-2, P1-9, P2-12)

**Files:** `resolvers/mutations/resolution.ts` (start + `:347`, `:510`, `:697`), `resolvers/mutations/multi-pathway-resolution.ts`, `resolvers/helpers/resolution-context.ts` (policy selector); test `resolution-fact-store-wiring.test.ts`

Until this lands, `assembleContext` has no callers and Tasks 4–8 run only in unit tests. Facts are **not persisted** (plan 05b), so every entry point re-assembles from `buildEffectivePatientContext(initialPatientContext, additionalContext)` under the session's **stored** temporal context. Plan 05 decision 5 makes this sound: identical input yields identical `factId`s.

**Three constraints from round 2:**
1. **`v1` only (P1-9).** The assembler validates and throws. Under `legacy-v0` it is never called and the store is `[]`.
2. **Two helpers, not one (P1-9).** At `startResolution` there is no session — only resolution input and a fresh clock. `factStoreForInput(input, ctx, defaults)` and `factStoreForSession(session, additions)` share a lower-level core taking normalized context + clock.
3. **A request-scoped server-side selector (P2-12, corrected by P1-14).** `resolveTemporalPolicyVersion()` takes **no `ResolutionContext`** — `multi-pathway-resolution.ts:214` stamps the shared clock before `getMatchedPathways`, and its zero-match branch returns without ever building one. Call it once, immediately before `makeEvaluationTemporalContext`, in both start paths — the same position `assertKnownPolicyVersion` already occupies at `:219`, for the same reason. One call per request means every child session in a multi-pathway run shares one version, as §1 requires. Injectable in tests; no GraphQL argument, since AD-1 means callers are unauthenticated.

- [ ] **Step 1: Write the failing test**

```ts
describe('legacy-v0 never invokes the assembler (P1-9)', () => {
  it('starts a session whose context would fail assembly validation', async () => {
    // A malformed clinicalState / inverted interval that today's evaluator
    // ignores must not become a session-creation rejection.
    await expect(startResolution(withMalformedContext(), 'legacy-v0')).resolves.toBeDefined();
  });
  it('passes an empty fact store to the engine under legacy-v0', async () => { /* ... */ });
  it('rejects that same context under v1', async () => { /* assembler throws */ });
});

describe('every engine entry point assembles under v1', () => {
  it('startResolution builds facts from the SYNTHETIC payload', async () => { /* ... */ });
  it('startMultiPathwayResolution builds facts for each child session', async () => { /* ... */ });
  for (const entry of ['overrideNode', 'answerGateQuestion', 'addPatientContext']) {
    it(`${entry} re-assembles rather than passing an empty store`, async () => { /* ... */ });
  }
});

describe('addPatientContext changes what a gate decides (the P1-2 flip test)', () => {
  it('re-resolves a previously unsatisfied gate once the new fact arrives', async () => {
    // 1. start a v1 session (via the injected selector); a lab gate is unsatisfied
    // 2. addPatientContext supplies the matching lab
    // 3. the gate is now satisfied
    // With an empty or stale store this stays unsatisfied — the bug.
  });
});

describe('retraversal reuses the stored clock', () => {
  it('resolves the same horizons on re-run as at creation', async () => { /* ... */ });
});

describe('the policy selector is request-scoped and server-side (P2-12, P1-14)', () => {
  it('defaults to legacy-v0 with no injection', async () => { /* ... */ });

  it('is called before matching, so the zero-match path still stamps a version', async () => {
    // multi-pathway-resolution.ts:222-237 returns a parent session without ever
    // building a ResolutionContext. A selector taking rctx cannot run here.
    const s = await startMultiPathwayResolution(argsMatchingNothing());
    expect(s.temporalContext.temporalPolicyVersion).toBe('legacy-v0');
  });

  it('gives every child session in a run the same version', async () => {
    const s = await startMultiPathwayResolution(argsMatchingThreePathways(), inject('v1'));
    const versions = await childVersions(s.id);
    expect(new Set(versions).size).toBe(1);
  });

  it('is not selectable from either start mutation’s arguments', () => {
    // Narrowed from a whole-SDL regex (P2-17): that would also forbid the
    // read-only output field design §606 plans for plan 08.
    for (const m of ['startResolution', 'startMultiPathwayResolution']) {
      expect(argumentNamesOf(m)).not.toContain('temporalPolicyVersion');
    }
  });
});

describe('the pathway-default cascade, proven behaviorally (moved from Task 3, P1-16)', () => {
  it('admits a 200-day-old lab when the pathway default is YEAR and v1 says QUARTER', async () => {
    // Only meaningful here: the kernel and assembler are live from Task 9 on.
    // At Task 3 the legacy path admitted it regardless, so the test could not fail.
  });
  it('excludes the same lab when the pathway sets no default', async () => { /* ... */ });
});
```

- [ ] **Step 2: Run it, confirm it fails.**
- [ ] **Step 3: Implement.** Add the selector; gate assembly on `version === 'v1'`; build the two helpers over a shared core. Retraversal must not stamp a fresh clock — it reads `session.temporal_context`.
- [ ] **Step 4: Run the FULL suite.** Compare against 958/9.
- [ ] **Step 5: Commit** — `feat: assemble a fact store at every v1 resolution entry point`

---

### Task 10: Prove it, document the gaps, reconcile the suite

**Files:** `docs/superpowers/plans/2026-07-26-temporal-horizon-00-overview.md`, `docs/superpowers/specs/2026-07-21-pathway-temporal-horizon-design.md` (§6, §10, Compatibility), `temporal/select-facts.ts` (comment)

- [ ] **Step 1: Prove `legacy-v0` is untouched.** The evidence is that **every pre-existing gate-evaluator and traversal test passes with unmodified assertions** — only call shapes changed. Run the full suite, diff against 958/9. Any assertion that had to be weakened is a seam bug; fix the seam, not the test.
- [ ] **Step 2: Enumerate the `v1` deltas** in Compatibility, from the tests that pin them: validity filtering, latest-vs-first scalar selection, equal-time ambiguity, future-date exclusion, horizon filtering of membership, vitals membership/count becoming satisfiable, **and the attribute-specific deltas** — `lab.*`/`vitals.*`/`allergy.*` gaining horizon and validity filtering, and attribute `exists` becoming exact-code rather than any-fact.
- [ ] **Step 3: Revise design §10 (P2-13).** §589 says "Attribute conditions get no horizon control (encounter-derived, no timeline)." That is now false for the three clinical namespaces and true only for `patient.*`. Update it, and note that §590's fixed-Encounter vitals control is what makes the attribute anchor sweep (P1-8) mandatory.
- [ ] **Step 4: Correct `select-facts.ts:58`.** Its comment claims the candidate rules make `legacy-v0` "genuinely behavior-preserving." They mirror the current evaluator's *candidate* rules only; validity, ordering, and vitals bucketing still differ. Rewrite it to say what it actually guarantees.
- [ ] **Step 5: State the shadow boundary (P2-13).** Retaining `evaluateConditionLegacy` is a *precondition* for shadow evaluation, not shadow evaluation. Nothing in this plan runs both paths or diffs them; the rollout change owns that, along with retiring the legacy path.
- [ ] **Step 6: Update the overview.** Plan 04 Produces/Consumes; the corrected plan-01 claim; plan 04b (D4); governed reachability moved into plan 07 with its four open questions (request clock, policy version, `temporal_defaults` loading, snapshot→fact mapping); `ALWAYS_EVALUABLE` retains its meaning.
- [ ] **Step 7: Commit** — `docs: record the v1 deltas and reconcile the suite overview`

---

## Acceptance criteria

- [ ] `legacy-v0` executes no kernel code and never calls the assembler; its sweep rejects **exactly** what it rejects today — no more (widened coverage) and no less (swallowed parser errors); every pre-existing test passes with **unmodified assertions**.
- [ ] Full suite at 958 passed / 9 failed or better; the 9 are the two known scorer suites.
- [ ] `evaluateGate` has no `Date.now()` fallback and throws without `temporalContext` **or** `pathwayDefaults`.
- [ ] A pathway `YEAR` lab default beats `v1`'s `QUARTER` **through a real traversal at Task 9**, where the kernel is live; Task 3 proves the plumbing with constructor spies instead.
- [ ] A `v1` `vitals.*` attribute gate without `encounterStart` is rejected at **preflight**, not mid-traversal — proven by a direct `assertEncounterAnchor` call, since no activation seam exists at Task 1.
- [ ] `resolveTemporalPolicyVersion()` takes no `ResolutionContext`, runs before `getMatchedPathways`, and stamps a version on the zero-match path; every child of one multi-pathway run shares it.
- [ ] Neither start mutation accepts a `temporalPolicyVersion` **argument**, and the guard does not forbid the read-only output field design §606 plans.
- [ ] Under `v1`, no operator branch reads `patientContext.labResults`, `.conditionCodes`, `.medications`, `.allergies`, or `.vitalSigns` directly.
- [ ] A condition carrying both `window_days` and `horizon` is rejected; `window_days` alone still filters.
- [ ] `sweepableConditions` and the evaluator share one override parser and one namespace→field map.
- [ ] `lab.a1c exists` with only an unrelated lab present is unsatisfied; an `allergy.*` equality gate is satisfiable; a nested custom vital resolves.
- [ ] `addPatientContext` can flip a previously unsatisfied gate.
- [ ] A definite aggregate reports `indeterminate: false` with non-empty `uncertainty`; each truth-table row has a passing test.
- [ ] No GraphQL input selects `temporalPolicyVersion`, and a test guards against one being added.
- [ ] Reachability is unchanged, and the overview records why plus the four questions plan 07 must answer.
