# Temporal Horizon Plan 04 — Evaluator and Reachability on the `selectFacts` Kernel

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (recommended — this plan is larger than 05) or superpowers:subagent-driven-development to implement task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a **`v1` evaluation path** in which `selectFacts` is the only way a gate condition reads clinical data, so horizon, clinical status, and record validity govern every gate — while `legacy-v0` keeps executing today's code, untouched, as the shadow baseline.

**Architecture:** `evaluateGate` gains a **version seam**: it dispatches on `temporalContext.temporalPolicyVersion`. `legacy-v0` runs `evaluateConditionLegacy` — today's function, byte-for-byte, including `getCodeEntries` / `getNumericValue` / `collectLabSeries`. `v1` runs `evaluateConditionKernel`, built across Tasks 4–8. A new `temporal/condition-adapter.ts` translates a `GateCondition` into the kernel's `FactSelectionCondition` plus a NODE-level `ConditionTemporalOverride`, and owns the attribute-namespace→field mapping the anchor sweep also needs; `temporal/gate-policy.ts` composes the plan-03 cascade with the plan-02 clock into one `EffectivePolicy` per condition. Under `v1` only, the resolvers call plan 05's `assembleContext` at **all five** engine entry points — it has no callers at all today.

**Tech Stack:** TypeScript 5, Apollo Server 4 + Federation 2.10, Jest + ts-jest.

## Revision history

- **v1 (2026-08-11, `a6b0c65`)** — first draft, written unattended from `main` @ `d6f51fd`.
- **v2 (2026-08-11, `907a674`)** — rewritten after review round 1. Seven findings (4×P1), all verified, all accepted. Central premise inverted: the kernel became the `v1` path and the legacy evaluator was retained as the shadow baseline.
- **v3 (2026-08-11, `8e7cab1`)** — revised after review round 2. Six findings (4×P1), all verified, all accepted. Round 2 found that the v2 rewrite *introduced* three new defects while fixing round 1's: the attribute routing bypassed the anchor sweep, assembly was wired unconditionally and so leaked validation into `legacy-v0`, and Tasks 6 and 8 stated contradictory uncertainty contracts.
- **v4 (2026-08-11, `2f9a07f`)** — revised after review round 3. Four findings (3×P1), all verified, all accepted. Mostly *sequencing and scope*: the policy selector was given a shape the multi-pathway resolver cannot supply, two tests were placed at tasks where they could not fail, and v3's own `legacy-v0` compatibility fix was itself a behavior change in the opposite direction. Applied as targeted edits, not a rewrite.
- **v5 (2026-08-11, `83f9a38`)** — revised after review round 4. Three findings, all P1, all verified, all accepted. Two are **inherited-conditionality and vacuous-test defects that v4 itself introduced**, and one is an interface gap open since v3: attribute conditions never had a defined route into the policy seam. Targeted edits again.
- **v6 (2026-08-11, `45aca57`)** — revised after review round 5. Three findings (2×P1), all verified, all accepted. All three are **executability defects in the plan-as-instructions rather than errors in the design**: a Task 2 test calling a function Task 7 creates, a selector whose stated signature could not read its own stated injection seam, and a test calling a module-private helper no task exports. The design decisions they touch (P1-14's no-`ResolutionContext` rule, locked decision #7, D3's attribute routing) were all re-verified and none changed. Targeted edits.

  **Round-5 trend note.** Five rounds, 23 findings, none rejected. The defect *class* has shifted: rounds 1–3 found design errors, rounds 4–5 found plan-mechanics errors — tasks that cannot run in order, tests that cannot fail, interfaces that contradict their own injection. That is convergence, but it also says the remaining risk is concentrated in whether an executor can follow this document task-by-task, not in whether the architecture is right. **Before round 6, dry-run the task order rather than re-reading the prose:** for each task, check that every symbol its tests reference is produced by that task or an earlier one.
- **v7 (this document)** — revised after review round 6. One finding, P1, verified and accepted: coded `exists` was specified to *reject* a supplied `value`/`system` at runtime, which the import validator makes nearly unsatisfiable (it *requires* `value`), which fires after a preflight that cannot catch it, and which breaks a fixture merged on `main`. Now normalized to bucket semantics, with authoring rejection handed to plan 06.

  **Round-6 trend note.** The ordering check added in v6 worked — it found nothing new, and round 6 found nothing of that class. But it also would never have caught this one, because the defect was a **semantic** rule that no symbol-level check can see: an invariant asserted in one layer (the adapter) that a different layer (the validator) contradicts. **Round-8 addendum, found executing Task 4: the ordering check has a blind spot.** It checks that every *symbol* a task's tests reference is produced by that task or earlier. Task 4's specified test reads `r.indeterminate` / `r.uncertainty` — **fields on an interface**, not symbols — and the widening that creates them is claimed by Task 8. A field-level dependency is invisible to a symbol-level check. Extend it: for each task's tests, check the *properties* they read, not only the identifiers they import.

  **Before round 7, run the cross-layer check:** for every rule this plan adds at runtime, find the import validator rule and the existing fixtures governing the same field, and confirm all three agree. Rounds 1–3 were design, 4–5 were mechanics, 6 was cross-layer consistency — each round's check has to be *different* from the last one's, because a check that already ran is the least likely to find the next defect.

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

## Review dispositions — round 4

**[P1-18] The strict `v1` sweep is bypassed whenever `encounterStart` exists — ACCEPTED.**
`assertEncounterAnchor` returns at `:638` before ever calling `sweepableConditions`. v4 correctly preserved that early return for `legacy-v0` — and then **inherited it for `v1`**, which is wrong. Under `v1` the sweep does more than collect anchor requirements: it is the only preflight that parses overrides and catches the `window_days`/`horizon` conflict. Behind the early return, a pathway that supplies an anchor gets no validation at all, so a malformed `v1` override passes preflight and throws mid-traversal — the exact failure locked decision #7 forbids. This is the mirror image of P1-15: there I failed to preserve legacy conditionality, here I preserved it somewhere it does not belong. **Under `v1`, condition validation runs unconditionally; only the anchor-requirement *throw* stays behind the `encounterStart` check.**

**[P1-19] The selector tests pass without the selector working — ACCEPTED.**
Both were vacuous. The zero-match test asserts `legacy-v0`, which `makeEvaluationTemporalContext` already supplies by default — it passes if the selector is never called. The child test asserts only that all versions are *equal*, which three ignored injections all yielding `legacy-v0` also satisfy. And the assertion vehicle does not exist: `formatSessionForGraphQL` (`multi-pathway-resolution.ts:1150-1164`) returns no `temporalContext` — that exposure is plan 08's (design §606). The seam is now concrete (server-owned resolver context, never a request header), the tests **inject `v1`**, read the **persisted session rows** rather than the GraphQL payload, assert the exact version, and assert the selector ran exactly once per request.

**[P1-20] Attribute conditions have no defined route into the policy seam — ACCEPTED.**
Task 2's `effectivePolicyForCondition(condition, …)` reads `condition.field`; attribute conditions have no `field`. Task 7 produces `{selection, override}` but never says how it reaches the seam, so an implementer would plausibly resolve attribute policy inline — reintroducing preflight/evaluation divergence for exactly the conditions P1-8 just brought into the sweep. Both adapters now return one shape, `AdaptedCondition`, and the seam consumes `adapted.selection.field` plus `adapted.override`. An attribute condition and its swept counterpart therefore resolve through identical code.

---

## Open decisions — settled across four review rounds

**D1 — `horizon`/`status` become typed fields on `CodedCondition` here; the `v1` sweep uses a strict shared parser; the `legacy-v0` sweep is preserved byte-for-byte.** *(Round 1: shared-parser amendment. Round 2: rejection narrowed. Round 3: corrected — v3 had today's behavior backwards, per P1-15.)*

Today's sweep is **not** lenient. It copies the raw value (`resolution-context.ts:604-606`) and the cascade validates it via `parseHorizonValue`, so a malformed `horizon` **already rejects session creation** — but only when `encounterStart` is absent, because `assertEncounterAnchor` returns early otherwise (`:638`). That conditional rejection is current behavior and must survive untouched.

So `sweepableConditions` takes the version and has two paths:

| | `legacy-v0` | `v1` |
|---|---|---|
| Conditions swept | coded only (today's `FIELD_TO_KIND` filter) | coded **+** `lab`/`vitals`/`allergy` attributes |
| Override extraction | raw copy, exactly as today | `parseConditionOverride` |
| When validation runs | only when `encounterStart` is absent — unchanged | **always** (P1-18) |
| Malformed override | rejects iff `encounterStart` absent | rejects |

Neither path catches parser errors. Publish-time rejection of malformed authoring still belongs to plan 06's canonicalizer; this is only about not moving the runtime boundary in either direction.

**The `encounterStart` early return applies to the anchor *throw*, not to `v1` validation (P1-18).** Under `v1` the sweep is the only preflight that parses overrides and catches the `window_days`/`horizon` conflict, so leaving it behind `assertEncounterAnchor`'s early return means a pathway that supplies an anchor is never validated at all. Preserving that conditionality for `legacy-v0` is required; inheriting it for `v1` is the bug.

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

**D7 — an undated observation is admitted but NOT orderable; scalar and series gates over it fail closed, and that is disclosed rather than fixed.** *(Round 9, found executing Task 5. Decision taken 2026-08-11.)*

`OPEN(assertedCurrentAt: asOf)` fixes **admission**, not **ordering**. `effectiveRange` (`select-facts.ts:143`) reads `interval.start` only and returns `(-Inf, +Inf)` without one, so an undated fact has no position in time. One undated fact alone is `READY`; an undated fact **plus any other candidate** is `AMBIGUOUS_LATEST` and fails closed. `context-assembler.ts` previously claimed `OPEN(asOf)` prevented exactly this — it does not, and that comment is corrected.

**Consulting `interval.end` does not fix it** and was checked: the undated fact becomes `(-Inf, asOf]`, which still overlaps a dated point, so `definiteLatest` still finds no strict winner. The ambiguity is genuine, not a coding slip.

**Accepted, because failing closed beats legacy's arbitrary `.find()` on the first array element** for a scalar clinical comparison. Consequences that MUST be carried:
- **Task 6 inherits this identically** through `AMBIGUOUS_SERIES_ORDER` — one undated lab poisons every `trend_*` / `delta_from_baseline` series over that code. Same decision applies; do not re-litigate it there.
- **Task 10 must disclose it** as a `v1` delta. It is currently undisclosed, which locked decision #2 forbids.
- **Plan 09's authoring UI should require a date on lab input**, and `SyntheticLabResult.date` being optional is the reason this is ordinary input rather than an edge case.

**D8 — ~~OPEN, NOT DECIDED~~ SUPERSEDED by the settled D8 below, and now IMPLEMENTED. `count_in_window` asks the wrong temporal question for stateful facts, and under `v1` its window stops discriminating on them.** *(Round 10, found executing Task 6. Pinned by test, then decided and fixed in the D8 follow-up to Task 6 — retained for the finding's provenance; read the settled D8 below for the rule that is in force.)*

`selectFacts` has exactly one temporal predicate, `overlap(fact.interval, horizon)` — "was this fact true at some point inside the window". That is the right question for **membership** ("does the patient have X?") and, via `definiteLatest`, workable for **scalar**. It is the **wrong question for `count_in_window`**, whose entire purpose is *recurrence*: three UTIs in twelve months, repeat ED visits — the examples `select-facts.ts:60-62` names itself.

The mechanism, confirmed by running it, not reasoned about. `assembleStateful` gives every entry with no `endDate` and a non-INACTIVE state `end: OPEN(evaluationAsOf)` (`context-assembler.ts:84-85`), and the default state for an entry that omits `clinicalState` is `ACTIVE` (`:98-101`). Such an interval therefore reaches the clock, so `overlap` returns MATCH against **every** horizon that contains the clock — which is every horizon `resolveHorizon` can produce, since `upperBound` is always `evaluationAsOf`. Consequences on `conditions` / `medications` / `allergies`:

- `window_days` has **no effect at all** on a count over those buckets. A UTI with an onset 218 days ago counts inside a 90-day window.
- `legacy-v0` filters on the **entry date** (`isWithinWindow` reads `entry.date`), so it excludes it. The two versions therefore disagree in the **permissive** direction on the operator's primary use case: a recurrence gate fires where it did not.
- Labs are unaffected: `assembleLabs` models a dated lab as a POINT (`start === end`), so a dated lab outside the window is correctly NO_MATCH.

**Not fixed here, for the same reason D7 was not fixed at Task 5**: the fix is a kernel-semantics judgement in plan 01/05 territory — either `count_in_window` selects on the **start bound** (occurrence semantics) rather than on interval overlap, or the overlap answer is accepted and disclosed as "count of matching facts *present during* the window". Inventing either inside an evaluator task would be writing kernel semantics from the wrong layer. **Task 6 pinned the current behavior with a test** (`counts an ONGOING condition whose onset is outside the window`) so it cannot change silently, and **Task 10 must disclose it** as a `v1` delta, which locked decision #2 requires.

**Defect-class note.** Locked decision #3 assigns each operator class an *uncertainty* policy (membership fails open, scalar and aggregate fail closed) — and nothing in this plan or plan 01 ever assigned each class a *temporal predicate*. The three classes were given one, `overlap`, by default. That gap is a new class: not design, mechanics, cross-layer, pseudocode, field-level dependency, or cross-plan intent, but **a shared primitive silently generalized to a case it does not model**. *Before round 11, for each shared kernel primitive, enumerate every operator that consumes it and state what question that operator is actually asking — then check the primitive answers that question, not a neighbouring one.*

**D8 — the AGGREGATE class gets occurrence semantics: it selects on the fact's START bound, not interval overlap. Membership and scalar keep overlap.** *(Round 10, found executing Task 6. Decision taken 2026-08-11.)*

`selectFacts` had exactly one temporal predicate — `overlap(fact.interval, horizon)` — and all three operator classes inherited it. Locked decision #3 gave each class its own **uncertainty** policy but never gave each class a **temporal predicate**; `overlap` was generalized by default to a case it does not model.

For `count_in_window` that is wrong. The operator counts **recurrence**, and `assembleStateful` gives any entry with no `endDate` and a non-INACTIVE state `end: OPEN(evaluationAsOf)` (`context-assembler.ts:85`), with a missing `clinicalState` failing open to active. Such an interval reaches the clock and therefore overlaps **every** horizon. Proven: a condition with onset 218 days ago is counted inside a 90-day window. **`window_days` was silently inert on `conditions` / `medications` / `allergies`** — the operator's own documented use case — and `v1` diverged from `legacy-v0` in the **permissive** direction on a recurrence gate.

**The rule.** For the aggregate class, a fact is in-window iff its `interval.start` falls inside the resolved horizon. Faithful translation of legacy's `isWithinWindow`:
- **Horizon with a lower bound** ⇒ require a `start` inside it. An undated fact is excluded — matching `isWithinWindow(undefined, N, now) === false`.
- **LIFETIME (`lowerBound === null`)** ⇒ include undated facts, matching legacy's `windowDays === undefined` branch, which returns `true` regardless of date.

**SCOPE BOUNDARY — DO NOT WIDEN THIS TO SCALAR.** It looks like the same bug and is not. `PatientContext.vitalSigns` carries **no dates anywhere**, so every vital is assembled undated; under start-bound selection every vitals scalar gate would select nothing and fail closed. That is the exact failure plan 05 was reordered before plan 04 to prevent. Membership likewise keeps `overlap`: "was this condition active during the window" is a genuine overlap question. **Aggregate only.**

**Residual difference, disclose rather than fix:** legacy's `collectLabSeries` excludes an undated lab from a `trend_*` / `delta_from_baseline` series **always**, even with no window, whereas the LIFETIME rule above admits it — where D7 then makes it poison the ordering. Left as a disclosed `v1` delta; do not invent a fourth predicate for series.

**Carried:** Task 6's D8 pinning tests flip from documenting the defect to documenting the fix. Task 10 discloses what remains.

**Implemented** in the D8 follow-up to Task 6 (`select-facts.ts`, `startsWithin`). Four things the decision text did not anticipate, settled in execution:
- **A start bound is a RANGE, and whole-range containment is the rule.** `startsWithin` reuses the containment test `overlap` already applies to a POINT fact (`overlap.ts:20-25`): MATCH when the whole range is inside, NO_MATCH when it is wholly outside, UNKNOWN when it straddles a boundary — which the aggregate class then fails closed on, recording `TEMPORAL_UNKNOWN`. Keying on the range's lower edge alone would match legacy's `Date.parse` byte-for-byte but would silently pick one side of an imprecise bound. Reusing the point-fact rule is also what CONFINES the change: for a dated observation the two predicates are the identical formula, so every dated-lab aggregate answers exactly as before D8 and only stateful/undated facts move.
- **D7's reach in the aggregate class narrows to LIFETIME, and the Task 6 test had to move with it.** `trend_*` is an aggregate operator, so under the default bounded QUARTER lab horizon an undated lab is now excluded before ordering is attempted and the series is clean. The D7 pinning test (`fails closed on a series containing one undated lab`) therefore needed an explicit `horizon: 'LIFETIME'` to keep reproducing — exactly the residual difference recorded above. Its assertions are unchanged; a companion test pins the bounded-horizon convergence.
- **A `vitals` count is now always ZERO under `v1`, and Task 10's delta list is stale because of it.** *(Found executing the D8 follow-up; not anticipated by the decision.)* `PatientContext.vitalSigns` carries no dates anywhere, so every vital is assembled undated, and the vitals horizon is ENCOUNTER — always bounded. Undated + bounded ⇒ excluded, so `count_in_window` over `vitals` counts 0 whatever the context holds, reported as a DEFINITE zero with no `TEMPORAL_UNKNOWN`. This is the AGGREGATE analogue of the hazard D8's scope boundary names for scalar, and it is what D8's rule literally requires: `isWithinWindow(undefined, N, now)` is false, and `legacy-v0` could not satisfy a vitals count either — carving vitals out would mean the fourth predicate D8 forbids. **Disclosed, pinned by test, not fixed.** Task 10 step 2 currently lists "vitals membership/count becoming satisfiable" as a `v1` delta; that is now half true — membership still becomes satisfiable, count does not.
- **`overlap`'s inverted-interval throw is carried into `startsWithin`.** A start-only predicate cannot notice `start > known end`, so the check is explicit. The assembler already rejects these with a coded error; this is the kernel's second line of defence against a hand-built store, and it is pinned by a test.

---

## Round 11 — findings from executing Task 7

Six findings. Two are defects in work already landed, one was self-found and fixed inside this task, three are risks to carry forward.

**[R11-1] P1 — a coded `vitals` scalar condition carrying a `system` is satisfiable under `legacy-v0` and UNSATISFIABLE under `v1`. Undisclosed delta from Task 5.** Confirmed by running both paths against one clinical reality, not reasoned about. `getNumericValue` reads `condition.system` on the `labs` branch and **never on the `vitals` branch** (`gate-evaluator.ts:84-93`) — vitals resolve by dotted path through the bag, which has no system concept at all. `evaluateScalarKernel` goes through `adaptCodedCondition`, which copies `system` when present, and `candidateMatches` then rejects every vital whose system is not the assembler's `urn:prism:vitals` (`select-facts.ts:108`). So `{field:'vitals', operator:'greater_than', value:'systolic_bp', system:'LOINC', threshold:140}` against `vitalSigns:{systolic_bp:148}` answers `satisfied: true / "vitals value 148 > 140"` under `legacy-v0` and `satisfied: false / "No numeric value found for vitals:systolic_bp"` under `v1`. `system` is in `CODED_KEYS`, so this is authorable and passes import. Not fixed at Task 7 — it is a Task 5 semantic question (does a vitals gate's `system` mean anything at all, or should the adapter drop it for `vitals` the way it drops `value`/`system` for `exists`?) and D7/D8 set the precedent that an evaluator task does not decide one from the wrong layer. **Task 10 must either disclose it or Task 5 must fix it; leaving it silent is what locked decision #2 forbids.**

**[R11-2] ~~P1 — Task 1 Step 4's instruction that Task 7 would replace the sweep's inline attribute branch with `adaptAttributeCondition` is structurally impossible.~~ WRONG, AND THE DEFECT IT LEFT BEHIND IS FIXED (review finding 2, 2026-08-12).**

The "structurally impossible" claim rests on "the sweep has no attribute registry in scope". **It has.** `ResolutionContext.codeMap` is a declared field (`resolution-context.ts:283`), loaded by `buildResolutionContext` via `loadAttributeCodeMap` for every resolution, and `assertEncounterAnchor` already receives the whole `rctx`. The map was one field away from the sweep the entire time; the finding checked the CALL SITE's local scope and stopped there.

What the wrong claim cost: judging an attribute condition kernel-routable from its NAMESPACE alone, when `adaptAttributeCondition` also returns `null` for an attribute with **no `codeMap` row**. So `lab.unmapped` with `horizon: ENCOUNTER` threw `MISSING_ENCOUNTER_ANCHOR` at session creation and evaluated as an ordinary unsatisfied gate — preflight and evaluation disagreeing about one condition, which is locked decision #7, the thing this plan has been corrected for four times. Reproduced by test, then fixed: `sweepableConditions` now takes a required `codeMap` and calls the real adapter, exactly as its coded branch calls `adaptCodedCondition`.

A `null` adaptation is NOT the P1-8 hole reopening, which was the reasoning's other error: it is the sweep agreeing with the evaluator that the condition is not routable. A **mapped** `lab.*` still sweeps — that is the case P1-8 was about — and P1-18 survives because the adapter parses the NODE override BEFORE the code lookup, pinned by test rather than assumed.

*(Class, corrected: not "an instruction whose precondition a later task creates" but **a structural-impossibility claim asserted from the call site's local scope without checking the caller's**. The symbol existed, the data existed, and one parameter connected them. Before asserting that something cannot be threaded, enumerate what the CALLER already holds — not what the callee currently receives.)*

The original finding text, retained for provenance: The sweep reads pathway JSON off AGE inside `assertEncounterAnchor`, which has **no attribute registry in scope**; `adaptAttributeCondition` needs a `codeMap` to turn `lab.a1c` into a `(code, system)` pair. Calling it with an empty map would make every `lab.*` / `allergy.*` condition adapt to `null` and vanish from the sweep — reopening exactly the preflight hole P1-8 closed, one task after closing it. What preflight actually needs is the cascade key and the NODE tier, and both already come from the shared `attributeNamespaceToField` + `parseConditionOverride` (locked decision #6). Resolved by leaving the sweep's branch in place, correcting the comment that promised otherwise, and asserting the agreement by test rather than assuming it from shared code. *(Class: an instruction whose precondition is created by a LATER task than the one that states it — the symbol-level and property-level ordering checks both pass, because every symbol and field exists; what does not exist is the DATA the symbol needs.)*

**[R11-3] Self-found and fixed inside Task 7 — the adapter's parse/lookup ordering was a preflight/evaluation asymmetry in the permissive direction.** First cut resolved the `codeMap` row before parsing the NODE override, so `{attribute:'lab.unmapped', horizon:'FORTNIGHT'}` was rejected at session creation by the sweep (which parses every clinical-namespace condition and has no codeMap) and silently ignored at evaluation. Reordered: the namespace check first (so `patient.*` is ignored by both sides), then `parseConditionOverride`, then the code. Pinned by a test that asserts the sweep and `evaluateGate` throw for the same condition, plus its mirror for `patient.*` where neither may.

**[R11-4] ~~P2~~ CLOSED (review finding 3, 2026-08-12) — `codeMap` is now required in `GateEvaluationDeps` and at both engine constructors, positioned before the optional `llmGateEvaluator`, with a shared `assertEngineCodeMap` runtime throw (`instanceof Map`, so an EMPTY map stays legitimate) alongside the existing `factStore` assertion. Original finding:**

**[R11-4] P2 — `codeMap` is still an optional constructor parameter defaulting to an empty `Map` at both engines** (`traversal-engine.ts:166`, `retraversal-engine.ts:95`), and Task 7 makes it load-bearing for the `v1` kernel path. All five construction sites do pass `rctx.codeMap` today, so nothing is broken — but this is precisely the shape P1-10 promoted `pathwayDefaults` out of: omitted at one site, every `lab.*` / `allergy.*` attribute gate silently adapts to `null`, falls back to `resolveAttribute` with an empty map, and answers a quiet `false` — while the anchor preflight, which needs no codeMap, resolved policy for those same conditions. Consider promoting it to required alongside `pathwayDefaults`.

**[R11-5] Task 10's `v1` delta list gains four attribute-route entries, one of which nothing in this plan anticipated.** The expected three: an attribute-targeted lab is now horizon-bounded (QUARTER), validity-governed, and compared **latest-first** rather than `.find()`-first (`attribute-registry.ts:34`). The unanticipated one: **an INACTIVE allergy stops matching.** `v1` gives `allergies` `status: 'active'`, while `resolveAttribute`'s `allergies.some(...)` has no notion of clinical state — so `allergy.penicillin == true` flips from satisfied to unsatisfied for a resolved allergy. This is the first delta in the plan that comes from the **status** axis rather than the horizon axis, and D3's table does not mention status at all.

**[R11-6] Forward risk — the attribute route hardcodes `VITALS_SYSTEM`, coupling it to the SYNTHETIC assembler.** D3 specifies it and Task 7 implements it, so this is not a deviation. But `resolveAttribute` has no system concept for vitals, and the only reason the hardcoded urn matches is that `assembleVitals` stamps the same constant on every vital (`context-assembler.ts:269`). Plan 07's LIVE snapshot mapper, which will produce vitals from FHIR with real LOINC codes, would make every `vitals.*` attribute gate select nothing. Related to R11-1 from the other side: one route ignores `system` and the other invents one.

**Defect-class note.** Rounds 1–3 design, 4–5 mechanics, 6 cross-layer, 7 pseudocode, 8 field-level dependency, 9 cross-plan intent, 10 a shared primitive generalized past its model. R11-1 is none of those: it is a **legacy function whose per-branch inconsistency the kernel silently regularizes**. `getNumericValue` honours `system` for labs and ignores it for vitals — an asymmetry nobody wrote down because nothing depended on it — and the kernel, being uniform by design, made the asymmetry observable as a behavior change in one direction only. *Before round 12, take each `legacy-v0` function the kernel replaces and enumerate the condition fields it reads **per branch**, not per function. Any field read on one branch and ignored on another is a `v1` delta the uniform kernel will introduce, and none of them are currently disclosed.*

**D9 — a coded `vitals` condition may not carry a `system`; it is rejected at authoring, in the adapter AND in the import validator.** *(Round 11, found executing Task 7. Decision taken 2026-08-12.)*

Legacy's `getNumericValue` honours `condition.system` on its **labs** branch and ignores it entirely on its **vitals** branch (`gate-evaluator.ts`). The kernel applies `system` uniformly, so the same condition is satisfiable under `legacy-v0` and unsatisfiable under `v1`.

It is not "the filter now works". `assembleVitals` stamps every vital with `VITALS_SYSTEM` (`urn:prism:vitals`), which no real terminology system equals — so **any** author-supplied `system` on a vitals condition makes that gate permanently unsatisfiable. `system` is in `CODED_KEYS`, so it imports cleanly and passes preflight today.

**Rejected at authoring rather than ignored or disclosed**, following the round-7 P1-22 precedent: the validator is taught to reject what evaluation cannot satisfy, so the author sees it where they can fix it. Ignoring it silently discards what the author wrote — the failure mode that produced the round-6 `exists` confusion. Disclosing it leaves a gate that imports cleanly, passes preflight, and can never fire.

**Nothing stored or fixtured uses this pattern** (verified: zero coded `vitals` conditions carrying a `system`), so there is no migration and no compatibility break.

**Implemented** (2026-08-12), before Task 8. Both layers read ONE exported
predicate, `codedVitalsSystemError(field, system)` in `condition-adapter.ts`,
which returns a message rather than throwing: the adapter wraps it in a
`TemporalContextError`, the import validator pushes it onto `errors`. One
source of truth, two error protocols — a second spelling in the validator would
be a second chance to disagree (locked decision #7).

Three things the decision text did not settle, resolved in execution:
- **The guard fires for `exists` as well**, and is placed BEFORE that operator's
  early return. `exists` drops `system` rather than selecting on it, so the
  unsatisfiability argument does not apply to it — but the rule is keyed on the
  FIELD, and discarding an author's `system` in silence is precisely the round-6
  failure mode D9 rejects. An operator-qualified rule would also force the
  validator to re-derive the kernel's operator classification.
- **`system: "urn:prism:vitals"` is rejected too**, not accepted as the correct
  spelling. It would in fact select, which makes it the most dangerous value: it
  teaches an author that a vitals `system` is meaningful and couples the pathway
  to the SYNTHETIC assembler, which is R11-6 from the authoring side.
- **`system: null` is admitted**, because the predicate keys on `!== undefined`
  and both layers share it. A JSON `null` behaves as "any system" in
  `candidateMatches` exactly as an absent one does; the point is that preflight
  and authoring cannot disagree about it.

The adapter guard is `v1`-only by construction (nothing on the `legacy-v0` path
calls the adapter). The **validator** guard is version-independent, so a stored
pathway carrying the pattern would fail re-import under either version — which
is what "nothing stored or fixtured uses this pattern" was verified for.

**Class note.** R11-1 is a distinct defect class: **a legacy function whose PER-BRANCH inconsistency a uniform kernel silently regularizes.** The round-12 check follows from it — enumerate the condition fields each `legacy-v0` *branch* reads, not each function. Any field honoured on one branch and ignored on another is a `v1` delta the kernel will introduce, and none are currently disclosed.

---

## Round 12 — findings from executing Task 8

Four findings. Two are a single defect seen from both ends; none are in the truth table itself, which went in as specified.

**[R12-1] P1 — nothing above the gate evaluator reads `indeterminate` or `uncertainty`.** Both signals are now produced on every `v1` gate result, single-condition and compound, and the traversal engine drops them whole. `traversal-engine.ts` reads `satisfied`, `reason`, `contextFieldsRead`, `dependedOnNodes`, `tentative`, `chosenBranch`, `llmConfidence`, `llmReasoning` (`:318-360`, `:711-722`) and never the two new keys; the retraversal engine is the same. The GraphQL surface is explicitly plan 08's, so *exposing* nothing is in scope — but the consequence is not: after Task 9 the ONLY trace of an indeterminate gate in anything persisted is `excludeReason`, i.e. the reason **prose**. Deciding this is fine requires reading R12-2 first.

**[R12-2] P1 — and that prose carrier is asymmetric per compound operator, so OR loses the distinction entirely.** `evaluateCompound`'s AND branch joins every unsatisfied condition's reason into `Unsatisfied conditions: …`, so `Indeterminate numeric value for labs:4548-4 (VALIDITY_UNKNOWN)` reaches the audit row. The OR branch discards unsatisfied reasons and emits the literal `'No compound conditions satisfied'`. **An OR compound gate refused for uncertainty is therefore recorded byte-identically to one where the patient simply had none of the codes** — and with R12-1 there is no other carrier. Pinned by test (`keeps the OR prose exactly as it is when nothing is satisfied`) rather than fixed: changing the prose is a reason-string change, and the plan requires reasons byte-identical to legacy's wherever the outcome matches. Task 10 must disclose it, or plan 08 must read the flag.

*(Class: a per-branch inconsistency in the function that CONSUMES the kernel, rather than one the kernel replaces — the mirror image of R11-1. Round 11's prescribed check enumerates the fields each legacy branch READS on the way in; this one is on the way out, and no round has looked there.)*

**[R12-3] P2 — `GateEvaluationResult` now carries two unrelated uncertainty vocabularies and nothing names the relationship.** `tentative` means "an LLM answered below its authored confidence threshold and traversal took the safe-default branch"; `indeterminate` means "temporal doubt could have changed the answer". No gate can carry both today — an `llm_text_analysis` gate has no `conditions` — but a plan-08 consumer that renders certainty as `!indeterminate` will label a below-threshold LLM fallback *certain*. Decide whether they are one axis or two before either is exposed.

**[R12-4] Risk — `satisfied: true` together with `indeterminate: true` is unmodelled.** The truth table has no row for a condition that is both, and it is unreachable from every kernel branch today because INDETERMINATE always fails closed. `compoundIndeterminate` classifies it as a dominator of neither operator (so the gate goes indeterminate), which is the conservative reading, and the predicates are written positively rather than as `!indeterminate` shorthands so the choice is visible. If a future operator class ever reports a satisfied-but-doubtful outcome, the table needs a row — not the code a patch.

**Defect-class note.** Rounds 1–3 design, 4–5 mechanics, 6 cross-layer, 7 pseudocode, 8 field-level dependency, 9 cross-plan intent, 10 a shared primitive generalized past its model, 11 a legacy function whose per-branch inconsistency the kernel regularized. Round 12 is **a signal with no reader**: the work was correct, complete, and tested, and its output is discarded one layer up — which no check has looked for, because every previous check examined what the kernel consumes rather than what consumes the kernel. *Before round 13, take each value this plan PRODUCES and follow it upward to the nearest layer that persists or renders anything. A signal no consumer reads is indistinguishable at runtime from one that was never computed.*

---

## Round 13 — findings from executing Task 9

Four findings. One is P1 and is a defect class no round has looked at; the other three are consequences of `v1` becoming reachable for the first time.

**[R13-1] P1 — the trust boundary is enforced at `startResolution` and absent at `addPatientContext`, and Task 9 makes that difference load-bearing.** `parseResolutionInput` classifies `endDate` / `clinicalState` / `recordValidity` / `sourceId` as privileged assertions about clinical TRUTH: refused outright in implicit mode, ADMIN-only in explicit SYNTHETIC (`firstAssertion`, `trust-mode.ts:109-134`). `addPatientContext` runs **no trust parsing at all**, and its `AdditionalContextInput` reuses the very same `CodeInput` / `LabResultInput` SDL types (`schema.graphql:1107-1190`) — so all four fields are authorable there by any caller, with no mode and no role. Before Task 9 that was inert, because `legacy-v0` reads code/system/value/date only. Wiring `factStoreForSession` makes them govern selection under `v1`: verified by test that `recordValidity: 'INVALID'` supplied through `addPatientContext` reaches the fact with `validityBasis: 'SYNTHETIC_ASSERTION'`, which removes it from selection entirely; `clinicalState: 'INACTIVE'` flips it out of every `status: 'active'` gate. **A caller who is refused these at session creation can assert them mid-session and suppress a clinical fact from evaluation.** Not fixed, following the R11-1 → D9 precedent: the policy (reject like `startResolution` / strip silently / require ADMIN) lives in plan 05's trust-mode module, and an evaluator task does not decide it from the wrong layer. Pinned in both directions — `v1` honours it, `legacy-v0` is provably unaffected — so a fix has a failing test to flip. **Needs a decision; Task 10 must disclose it if the decision has not landed.** *(Class: a validation boundary enforced at ONE of several entry points that feed the same primitive. Every previous round examined what a layer reads or produces; none asked whether all the doors into a layer are guarded the same way. Note that this is the mirror of the plan's own P1-9 care: the plan reasoned very carefully about `legacy-v0` NOT reaching the assembler, and not at all about which callers reach it under `v1`.)*

**[R13-2] R12-1/R12-2 stop being theoretical.** Until this task the `v1` path was unreachable in production, so "nothing above the gate evaluator reads `indeterminate`/`uncertainty`" described a signal that was never actually produced outside unit tests. From Task 9 on it is produced on every `v1` gate result on every real request and dropped whole by both engines. The disposition is unchanged (Task 10 discloses, plan 08 reads the flag) but the priority is not: an OR compound refused for uncertainty is now recorded, in a live audit row, byte-identically to one where the patient had none of the codes.

**[R13-3] Retraversal determinism rests on `toPatientContext` copying entry arrays BY REFERENCE, which nothing names as a contract.** Facts are not persisted (plan 05b), so a retraversal reproduces the creating traversal's store only if `initial_patient_context` still carries the SYNTHETIC-only fields. It does — `toPatientContext` assigns `pc.conditionCodes` straight through, so `clinicalState` / `recordValidity` / `endDate` / `sourceId` ride along into the JSONB column even though the declared type (`CodeEntry`) has no such fields. A future "tidy-up" that mapped the entries field-by-field to `CodeEntry` would compile, pass every existing test, and silently make every retraversal assemble a *different* store than its creation — `stateBasis` flipping from `SYNTHETIC` to `MISSING_STATUS_FAIL_OPEN`, an INACTIVE condition becoming ACTIVE. Pinned indirectly by the `resolves the same factIds on re-run as at creation` test, which would NOT catch it: `factId`s are positional and would still match. Documented in `fact-store.ts:toSyntheticContext`; a direct test belongs with plan 05b.

**[R13-4] `assembleContext` needs no `encounterStart`, but `selectFacts` does — and only the latter is preflighted.** A `v1` session over a `vitals` gate is rejected at preflight without an anchor (`collectEncounterAnchorRequirements`), yet assembly of vitals facts succeeds regardless. That is correct and deliberate — an assembler that demanded an anchor would make every anchor-less `v1` session unstartable even when no gate reads vitals — but it means the store is routinely a superset of what any gate can select, which is worth stating before someone "optimizes" assembly to skip kinds the pathway does not read. Pinned by `a v1 session created with no encounterStart still assembles vitals facts`.

**Defect-class note.** Rounds 1–3 design, 4–5 plan mechanics, 6 cross-layer, 7 pseudocode, 8 field-level dependency, 9 cross-plan intent, 10 a shared primitive generalized past its model, 11 a legacy function whose per-branch inconsistency the kernel regularized, 12 a signal with no reader. Round 13 is **a primitive with more than one door, only one of which is guarded**. *Before round 14: for every validating function this plan relies on, enumerate ALL the call paths that reach the data it validates — not the call paths that reach the function. `assembleContext` was reasoned about exhaustively from the version axis and not at all from the caller axis, and the hole was in the second.*

**D10 — `addPatientContext` must run the same trust parsing as `startResolution`.** *(Round 13, found executing Task 9. Decision taken 2026-08-12.)*

`parseResolutionInput` treats `endDate` / `clinicalState` / `recordValidity` / `sourceId` as privileged assertions about clinical truth — refused outright in implicit mode, ADMIN-only in explicit SYNTHETIC. It is called **once**, at `resolution.ts:191` (`startResolution`). `addPatientContext` runs no trust parsing at all, and `AdditionalContextInput` reuses the same `CodeInput` / `LabResultInput` SDL types, so all four fields are authorable there with no mode and no role.

Before Task 9 this was inert — `legacy-v0` reads code/system/value/date only. Wiring `factStoreForSession` makes them govern selection under `v1`: `recordValidity: 'INVALID'` removes a fact from selection entirely, `clinicalState: 'INACTIVE'` flips it out of every `status: 'active'` gate. **A caller refused these at session creation can assert them mid-session and silently suppress a clinical fact from evaluation.**

**This is NOT a security fix and must not be described as one.** Under AD-1 `userRole` is read from an unverified `x-user-role` header defaulting to `PROVIDER`, so a role check secures nothing and that was already accepted (2026-08-10). The defect is that **the same request is accepted or refused depending on which mutation carries it** — locked decision #7's shape, one layer up: two paths into one primitive that do not agree.

**Both doors run the same parsing, whatever the rule is.** Zero breakage verified: nothing calls `addPatientContext` today, and the admin dashboard does not reference it.

**Class note.** *A primitive with more than one door, only one of which is guarded.* The plan reasoned exhaustively about `legacy-v0` **not** reaching the assembler and not at all about **which callers** reach it under `v1`. Round-14 check: for every validating function, enumerate the call paths that reach the **data** it validates, not the call paths that reach the function.

**Implemented** (2026-08-12), before Task 10. The rule lives in ONE exported
predicate, `firstTrustAssertion(pc)` in `trust-mode.ts`, which returns the path
of the first privileged assertion rather than throwing: `parseResolutionInput`
wraps it in its existing `INVALID_RESOLUTION_INPUT` rejection, `addPatientContext`
wraps it in a `GraphQLError` with the same code. One source of truth, two error
protocols — the D9 shape. Four things the decision text did not settle:

- **The guard is version-INDEPENDENT**, because `parseResolutionInput` is:
  `startResolution` runs it before the policy version is even resolved. A
  `v1`-only guard at the second door would have left the two doors disagreeing
  under `legacy-v0`, which is the defect and not a narrower fix. **This is the
  one `legacy-v0` boundary move in the plan**, and it is confined to a request
  carrying one of the four fields: nothing calls `addPatientContext` today
  (verified, including the admin dashboard), and a `legacy-v0` addition without
  them still runs and still receives an empty store.
- **`addPatientContext` refuses outright rather than admitting an ADMIN**, the
  way explicit SYNTHETIC does at the first door. It carries no `resolutionMode`
  argument, so every request through it is the *implicit* case, and the implicit
  case refuses. Adding a mode argument would be handing a caller-selectable
  trust escalation to an unauthenticated caller (AD-1) — the P2-12 mistake.
- **Null-vs-omitted had to be shared too, and this was NOT anticipated.** Found
  by running the flipped tests: `stripNulls` ran only inside
  `normalizeSynthetic`, so `recordValidity: null` — which a client sends simply
  by binding an unset form field — started a session cleanly through
  `startResolution` and, through `addPatientContext`, reached
  `parseRecordValidity` and threw `null is not one of VALID | INVALID | UNKNOWN`
  mid-session under `v1`. That is the SAME defect one value further along:
  sharing the predicate without sharing the normalization would have left the
  doors still disagreeing about the same request. Both now run
  `normalizeContextEntryNulls`, which leaves an ABSENT array absent —
  `addPatientContext` keys its affected-node scan on exactly that difference.
- **The guard reads the newly supplied payload, never `merged`.** Checking the
  accumulated bag would make a session whose stored context already carries an
  assertion permanently un-addable-to, and the boundary is what arrives at the
  door.

---

## Round 14 — external review

Eight findings. Two land in this plan's own code and are fixed below; five are
**pre-existing defects in the resolution subsystem that this branch never
touched** and are queued rather than fixed (two into
`2026-08-12-gate-subtree-retraversal.md`, three into
`2026-08-12-resolution-subsystem-gaps.md`); one is a carry-forward recorded at
the end of this file.

**[R14-1] P1 — an ABSENT allergy satisfied an attribute `exists` gate. FIXED.**
D3 routes `allergy.*` as exact-code **membership**, and `evaluateAttributeKernel`
derived a boolean from the selection before handing it to `compareScalar`.
`compareScalar` defines `exists` as `resolved !== undefined`
(`scalar-compare.ts:11-13`), so a derived `false` read as PRESENT:
`allergy.peanut exists` fired for a patient with no peanut allergy — a false
positive on an allergy, and a violation of D3's own text, which says an attribute
`exists` is "satisfied by a **non-empty** `selected`".

The fix is **operator-aware at the derivation site**, not in `compareScalar` and
not a blanket `undefined`: a membership `NO_MATCH` becomes `undefined` for
`exists` and stays `false` for every other operator, because
`allergy.peanut equals false` means "the patient does NOT have this allergy" and
legitimately needs the boolean. It keys on the AUTHOR's operator — the selection
operator is `includes_code` for every membership attribute and carries no trace
of what the author asked.

`lab.*` and `vitals.*` were **checked rather than assumed**: both derive a
number, `undefined` already flows on `NO_MATCH`, and both directions are now
pinned so the shape cannot regress into them.

**Two things the review's framing got wrong, both verified against the code:**

1. **It is not confined to this branch.** `resolveAttribute`'s allergy resolver
   returns `ctx.allergies.some(...)` — a boolean, never `undefined`
   (`attribute-registry.ts:39-46`) — and `attribute-registry.ts` and
   `scalar-compare.ts` are **unmodified by this branch**. So `legacy-v0`, and
   `main`, satisfy `allergy.X exists` for a patient with no such allergy today.
   The kernel route reproduced a pre-existing defect; it did not introduce one.
2. **The fix therefore CREATES a `v1` delta**, and the live behaviour is the
   unfixed one, because nothing routes to `v1` yet. Fixing
   `attribute-registry.ts` was rejected: it would change `legacy-v0`, which this
   plan preserves byte-for-byte and whose preservation is the branch's headline
   evidence. The legacy half is queued in
   `2026-08-12-resolution-subsystem-gaps.md` and pinned here in both directions
   (`is a DISCLOSED v1 delta: legacy-v0 still reports the absent allergy as
   present`), so the divergence is deliberate and visible rather than discovered
   at the flip. **Task 10's delta list gains it.**

**[R14-2] P2 — the evaluator was still selected from a parallel version-keyed
table. FIXED.** See the `CONDITION_EVALUATORS` note at Task 3.

**Class note.** R14-1 is a new class: **a derived value that is faithful to the
legacy path and wrong at the boundary that consumes it.** Every previous round
asked whether `v1` matched `legacy-v0`; none asked whether the thing both agreed
on was correct. The plan's own comment at the derivation site *stated* the defect
as an intended property ("so `exists` on an allergy stays satisfied whether or
not the allergy is present") and no round read it as a bug, because parity was
the only test being applied. *Before round 15: for every place `v1` deliberately
reproduces a `legacy-v0` answer, state what the answer MEANS clinically and check
that separately from whether it matches.*

---

## Global Constraints

- **Branch:** `feat/temporal-horizon-evaluator-kernel`, worktree `/home/claude/workspace/features/feat-temporal-horizon-evaluator-kernel/prism-graphql`, from `origin/main` at `d6f51fd`.
- **All commands from the worktree root. Never chain `cd` with `&&`.**
- **Typecheck:** `./node_modules/.bin/tsc -p apps/pathway-service/tsconfig.json --noEmit`. There is no `typecheck` script, no `apps/pathway-service/node_modules` (binaries hoist to the root), and bare `npx tsc` resolves to a decoy that prints "This is not the tsc command you are looking for".
- **Tests:** `npm test --prefix apps/pathway-service -- --runInBand <path>`. `testRegex` is `/__tests__/.*.test.ts` — a test file placed beside its source is silently never run.
- **`tsconfig` is NOT full strict and excludes `src/__tests__`** (`diagnostics: false`). **Test files are never typechecked.** Every invariant needs a runtime throw plus a test that fails without it. A type alone enforces nothing.
- **Baseline: the INVARIANT is 9 failures / 2 suites** (`data-completeness-scorer`, `patient-match-scorer`). Those two have never passed; never fix, chase, or count them. The pass COUNT is a moving number and every task must compare against the previous task's, not against `main`.

  | After | Passed | Failed | Total | Suites |
  |---|---|---|---|---|
  | `main` @ `d6f51fd` (pre-execution) | 958 | 9 | 967 | 84 / 86 |
  | Task 1 (`b28ab0c`) | 991 | 9 | 1000 | 85 / 87 |
  | Task 2 (`df23141`) | 1000 | 9 | 1009 | 86 / 88 |
  | Round-7 fixes (`4083ef4`) | 1008 | 9 | 1017 | 86 / 88 |
  | Task 3 (`8c98e03`) | 1024 | 9 | 1033 | 88 / 90 |
  | Task 4 (`88ce6bb`) | 1039 | 9 | 1048 | 89 / 91 |
  | Task 5 (`8fd537d`) | 1057 | 9 | 1066 | 90 / 92 |
  | Task 6 (`af9fd17`) | 1092 | 9 | 1101 | 91 / 93 |
  | D8 follow-up (`611bcb8`) | 1110 | 9 | 1119 | 91 / 93 |
  | Task 7 (`db86a72`) | 1153 | 9 | 1162 | 92 / 94 |
  | D9 (`4ec24b2`) | 1163 | 9 | 1172 | 92 / 94 |
  | Task 8 (`ab2f3b6`) | 1195 | 9 | 1204 | 93 / 95 |
  | Task 9 (`2d185f7`) | 1227 | 9 | 1236 | 95 / 97 |
  | D10 (`401a394`) | 1236 | 9 | 1245 | 95 / 97 |
  | Task 10 (`7190e05`) — docs only, must not move | 1236 | 9 | 1245 | 95 / 97 |
  | Review finding 1 — control domains | 1251 | 9 | 1260 | 96 / 98 |
  | Review finding 2 — codeMap in the sweep (R11-2 corrected) | 1269 | 9 | 1278 | 97 / 99 |
  | Review finding 3 — codeMap required (R11-4 closed) | 1280 | 9 | 1289 | 98 / 100 |
  | Review finding 4 — policy capabilities | 1296 | 9 | 1305 | 99 / 101 |
  | Review finding 5 — AttributeCondition temporal fields | 1302 | 9 | 1311 | 100 / 102 |
  | P1-A pinned (stale subtree) — assertions only, must not move | 1302 | 9 | 1311 | 100 / 102 |
  | `CONDITION_EVALUATORS` frozen | 1306 | 9 | 1315 | 100 / 102 |
  | R14-1 — absent allergy vs attribute `exists` | 1314 | 9 | 1323 | 100 / 102 |

  R14-1's delta is +8 passed / +8 total / no suite change: **8 added**, all in
  the new `an absent membership attribute does not satisfy exists` block of
  `attribute-condition-kernel.test.ts` — the reproduction, its `equals
  false`/`equals true` companions, the present-allergy direction, the
  `legacy-v0` divergence pin, and the three `lab.*`/`vitals.*` pins that show
  the numeric namespaces never had the defect. **No `expect(` removed and no
  test modified** — one COMMENT was corrected in an adjacent test, whose
  assertions are untouched.

  The freeze delta is +4 passed / +4 total, all in the new "the condition
  evaluator table cannot be mutated after load" block. No suite added. The
  three routing tests in `gate-evaluator-version-seam.test.ts` changed
  MECHANISM, not strength: `jest.spyOn` cannot patch a frozen object, so they
  moved from spying on the table entry to the behavioral discriminator that
  Task 4 made available (empty `factStore` + populated `patientContext`:
  `legacy-v0` satisfies a coded gate, `v1` does not). The compound-gate test
  switched `AND` to `OR` for the same reason it now proves more — under `AND` a
  sibling escaping to the other version is invisible. That file goes 12 -> 18
  `expect(` calls; no assertion was removed or weakened.

  Task 4's delta is +15 passed / +15 total: **16 added** in the new
  `gate-evaluator-membership-kernel.test.ts`, **1 deleted** — Task 3's no-op-fork
  test, whose deletion this task mandates because the paths now diverge.

  Task 5's delta is +18 passed / +18 total / +1 suite: **18 added**, all in the
  new `gate-evaluator-scalar-kernel.test.ts`, **none deleted and none modified**.
  No pre-existing assertion changed — the scalar branch is additive, so unlike
  Task 3 there was no call-site churn at all.

  Task 6's delta is +35 passed / +35 total / +1 suite: **35 added**, all in the
  new `gate-evaluator-aggregate-kernel.test.ts`, **none deleted and none
  modified**. Additive again; the only non-test file touched is
  `gate-evaluator.ts`.

  The D8 follow-up's delta is +18 passed / +18 total / no suite change: **14
  added** in `temporal/select-facts.test.ts` and **4 added** in
  `gate-evaluator-aggregate-kernel.test.ts`, **none deleted**. **Three
  modified**, each accounted for: the two D8 pinning tests inverted as the
  decision requires (`counts an UNDATED lab…` and `counts an ONGOING
  condition…`, both now asserting convergence with `legacy-v0`), and the D7
  series test, which keeps every assertion but gains an explicit
  `horizon: 'LIFETIME'` — see the D8 implementation notes above.

  Task 8's delta is +32 passed / +32 total / +1 suite: **32 added**, all in the
  new `gate-evaluator-compound-uncertainty.test.ts`, **none deleted and none
  modified** — not one pre-existing test file is touched, so the `expect(`
  churn in pre-existing suites is zero. The only non-test file changed is
  `gate-evaluator.ts`. Seven of the 32 pin the truth table's INPUTS as
  single-condition gates before any row is asserted over them: a row asserted
  against a mis-built fixture proves nothing, and three earlier tasks shipped a
  sketch that skipped a named case.

  Task 9's delta is +32 passed / +32 total / +2 suites: **32 added**, **none
  deleted and none modified** — the `expect(` churn in pre-existing test files
  is zero, and in fact those files gained lines only. 26 are in the new
  `temporal/resolution-fact-store-wiring.test.ts` (engine constructors spied,
  assembler spied directly) and 6 in the new
  `temporal/v1-traversal-behavior.test.ts` (real engines, the two deferred
  behavioral proofs). Seven pre-existing test files changed by **call shape
  only**: five engine/`resolveAndPersistAll` construction sites gained the new
  required `factStore` argument, and two module-factory mocks gained
  `resolveTemporalPolicyVersion` (kept REAL via `requireActual` — a `jest.fn()`
  returning `undefined` would silently re-enable the legacy default the
  selector exists to control). Non-test files touched: `types/index.ts`,
  `index.ts`, `resolvers/helpers/resolution-context.ts`, both resolution
  mutation modules, both engines, `gate-evaluator.ts` (one guard), and the new
  `temporal/fact-store.ts`.

  The D10 implementation's delta is +9 passed / +9 total / no suite change:
  **6 added** in `temporal/trust-mode.test.ts` (the shared predicate on its own)
  and **3 added** in `temporal/resolution-fact-store-wiring.test.ts`, **none
  deleted**. **Two modified** — the two Task 9 tests that pinned the R13-1 gap,
  inverted as D10 requires and carrying a comment saying so. Four `expect(`
  lines were removed across the two: the pair asserting the asserted fact
  reached the store (`lab.recordValidity` / `lab.validityBasis`), which is the
  gap itself; `expect(storeAt(retraversalCtor)).toEqual([])` from the legacy
  test, whose legacy-v0 empty-store coverage is unchanged in `passes an empty
  fact store on every retraversal entry point under legacy-v0`; and
  `expect(mockedAssemble).not.toHaveBeenCalled()`, which is re-added verbatim in
  the flipped test and is a diff artifact rather than a deletion. Non-test files
  touched: `temporal/trust-mode.ts` and `resolvers/mutations/resolution.ts`.

  The D9 implementation's delta is +10 passed / +10 total / no suite change:
  **6 added** in `temporal/condition-adapter.test.ts` and **4 added** in
  `validator.test.ts`, **none deleted and none modified**. The non-test files
  touched are `condition-adapter.ts` (the shared `codedVitalsSystemError`
  predicate + the adapter throw) and `services/import/validator.ts` (the same
  predicate, pushed as an import error).

  Task 7's delta is +43 passed / +43 total / +1 suite: **43 added**, all in the
  new `temporal/attribute-condition-kernel.test.ts`, **none deleted and none
  modified**. Additive; the non-test files touched are `condition-adapter.ts`,
  `gate-evaluator.ts`, and one comment in `resolution-context.ts`.

  Review finding 1's delta is +15 passed / +15 total / +1 suite: **15 added**,
  all in the new `temporal/condition-control-domains.test.ts`, **none deleted
  and none modified**. The non-test files touched are `condition-adapter.ts`
  (the shared `conditionControlDomainError` predicate + the adapter throw) and
  `services/import/validator.ts` (the same predicate, pushed as an import
  error) — the D9 shape exactly.

  Review finding 2's delta is +18 passed / +18 total / +1 suite: **18 added**,
  all in the new `temporal/sweep-attribute-codemap.test.ts`, **none deleted**.
  **One pre-existing test file changed by CALL SHAPE only** —
  `temporal/attribute-condition-kernel.test.ts`'s five `sweepableConditions`
  calls gained the now-required `codeMap` argument; its `expect(` count is 86
  before and 86 after, and the three `expect(` lines the raw diff shows as
  removed are each re-added verbatim with the extra argument. Non-test files
  touched: `resolvers/helpers/resolution-context.ts` and one doc comment in
  `condition-adapter.ts`.

  Review finding 3's delta is +11 passed / +11 total / +1 suite: **11 added**,
  all in the new `temporal/codemap-required.test.ts`, **none deleted**. **Eleven
  pre-existing test files changed by CALL SHAPE only** — eight `deps()` builders
  gained `codeMap: new Map()`, three engine construction sites gained the
  argument, and `anemia-pathway-e2e.test.ts`'s existing `CODE_MAP` moved ahead of
  the now-trailing optional `llmGateEvaluator`. **Zero `expect(` lines removed
  across all of them.** Non-test files touched: `gate-evaluator.ts` (the type,
  the shared `assertEngineCodeMap`, and dropping the two `?? new Map()`
  fallbacks), both engines, and both resolution mutation modules.

  Review finding 4's delta is +16 passed / +16 total / +1 suite: **16 added**,
  all in the new `temporal/policy-capabilities.test.ts`, **none deleted and none
  modified** — the `expect(` churn in pre-existing test files is zero. Non-test
  files touched: `temporal/policy-registry.ts` (the derived
  `TemporalPolicyVersion` union, the capability table and its module-load
  check), `gate-evaluator.ts` (the evaluator table keyed on that union plus
  `assertConditionEvaluatorCoverage`), `temporal/fact-store.ts` and
  `resolvers/helpers/resolution-context.ts` (the three `=== DEFAULT` tests
  become capability lookups).

  **The rollout property is now pinned directly.** Five of the sixteen re-require
  the whole routing module graph with `DEFAULT_TEMPORAL_POLICY_VERSION` flipped
  to `v1` and assert every routing decision is unmoved. Against the pre-fix code
  those five fail and their `legacy-v0`-default twins pass — which is the finding
  exactly: today's identity test agrees with the capability by accident, and
  stops agreeing on the one config change this plan exists to enable.

  Review finding 5's delta is +6 passed / +6 total / +1 suite: **6 added**, all
  in the new `temporal/attribute-condition-temporal-fields.test.ts`, **none
  deleted and none modified** in any pre-existing file. Non-test file touched:
  `services/resolution/types.ts` (two declarations).

  **Its reproduction is a TYPECHECK failure, not a test run** — `tsconfig`
  excludes `src/__tests__` with `diagnostics: false`, so no probe placed in a
  test file could have gone red. Reproduced with a temporary module under
  `src/services` (`error TS2353: 'horizon' does not exist in type
  'AttributeCondition'`), deleted once the declaration cleared it. The six tests
  are the runtime half: every condition in them is declared `AttributeCondition`
  with NO cast, which is what the missing fields used to force.

  **Append a row per task.** *(Round 8, self-found during Task 3: every "compare against 958/9" instruction below was stale the moment Task 1 landed, and an executor following it literally would either think they had broken 50 tests or would fail to notice breaking some. The count is only meaningful as a delta whose additions are each accounted for.)*
- **`legacy-v0` executes no kernel code, and no code this plan adds.** Structural, not behavioral: the version seam (Task 3) routes `legacy-v0` to the untouched legacy function; the assembler is not called; override parsing does not reject (D1). Every pre-existing gate-evaluator and traversal test must pass with **unmodified assertions** — that is the proof.
- **No caller can select `v1`.** `resolveTemporalPolicyVersion(ctx: DataSourceContext): string` reads a **server-owned field on the GraphQL context** — `temporalPolicyVersion?: string` on `DataSourceContext` (`types/index.ts:5`), populated in `index.ts` from deployment config and never from a request header (AD-1). It applies the `legacy-v0` default and calls `assertKnownPolicyVersion`. It takes the **GraphQL** context and explicitly **not** a `ResolutionContext`: the multi-pathway resolver stamps its clock before any pathway is matched, and its zero-match path never builds one (P1-14). *(Round 5: v5 said "takes no `ResolutionContext`" and then wrote the call as zero-argument, which cannot read a per-request value without the module-level global this plan forbids. The P1-14 reasoning was right; only the signature was wrong.)* Adding a GraphQL *argument* would let an unauthenticated caller (AD-1, `docs/AUTHORIZATION_DEBT.md`) choose evaluation semantics; a read-only *output* field is fine and is planned for plan 08 (design §606). The rollout flip changes deployment config, not the schema.
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
- Modify: `apps/pathway-service/src/services/resolution/types.ts` (add `horizon?`/`status?` to `CodedCondition`), `apps/pathway-service/src/resolvers/helpers/resolution-context.ts` (`sweepableConditions`), `apps/pathway-service/src/services/import/validator.ts` (`CODED_KEYS` + `ATTRIBUTE_KEYS` gain `horizon`/`status`)
- Test: `apps/pathway-service/src/__tests__/temporal/condition-adapter.test.ts`, and extend the plan-03 anchor-sweep suite

**Interfaces:**
- Produces: `AdaptedCondition`, `adaptCodedCondition(c): AdaptedCondition`, `toFactSelectionCondition`, `parseConditionOverride(raw, where)`, `nodeOverrideFor`, `attributeNamespaceToField(ns): GateField | null`.
- Also **exports `sweepableConditions`** from `resolution-context.ts`, which is module-private today (`:546`). Locked decision #7 — preflight and evaluation must never disagree — is only testable by comparing the swept field/override against the adapter's for the same condition, and `assertEncounterAnchor` exposes neither: it returns `void` and throws only when an anchor is missing. Export it with a comment saying it is exported for that agreement test, not for production callers outside this module.
- Consumes: `contract.ts`, `cascade.ts`, `evaluation-context.ts`.

**One adapted shape for both condition kinds (P1-20):**

```ts
export interface AdaptedCondition {
  selection: FactSelectionCondition;          // carries `field` — the cascade key
  override?: ConditionTemporalOverride;       // the NODE tier
}
```

`adaptCodedCondition` (Task 1) and `adaptAttributeCondition` (Task 7) both return this. **The policy seam consumes only this shape**, never a raw condition — an `AttributeCondition` has no `field`, so a seam typed on the raw condition forces the attribute path to resolve policy inline, and inline resolution is how preflight and evaluation drift apart (locked decision #7).

**The import validator must learn the two new keys, or the NODE tier is unauthorable (round 6, self-found).** `CODED_KEYS` (`validator.ts:27-31`) lists every key a coded condition may carry and the validator errors on anything else — `unknown key "${k}" on coded condition` (`:290`). It does not contain `horizon` or `status`, and `ATTRIBUTE_KEYS` (`:32`) does not either. This task adds both to `CodedCondition`, so **without a matching validator change every pathway authored with a per-condition horizon fails import** — and the NODE tier, the whole point of this feature, would be reachable only from hand-built `GraphNode` fixtures that bypass authoring. That is the same weakness already recorded against plan 05 ("proven at the guard boundary, not end-to-end"), and it would make Task 2's "a NODE horizon beats the pathway default" criterion unprovable through the real path.

Neither this plan nor plan 06 claimed this: plan 06 owns `temporal_defaults`, which is the **PATHWAY** tier, on the pathway header. The NODE tier belongs to whoever adds the fields, which is this task. Add both keys to both sets; the *values* are still validated by `parseConditionOverride` at preflight, so the validator change is a key-allowlist change only. Add an import test that a condition carrying `horizon` round-trips instead of erroring.

*(Found by the cross-layer check this round prescribes, not by review. It is the identical shape to round 6's `exists` finding — a rule asserted in one layer that a different layer contradicts — which is why that check now runs before every round.)*

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

describe('v1 validation is not behind the encounterStart early return (P1-18)', () => {
  it('rejects a malformed v1 override even when an anchor IS supplied', () => {
    // The whole point: assertEncounterAnchor returns at :638 when an anchor
    // exists, so without the restructure this pathway reaches traversal and
    // throws there instead — after LLM gates and audit rows.
    expect(() => assertEncounterAnchor(rctxWithMalformedOverride(), v1WithAnchor))
      .toThrow(TemporalContextError);
  });

  it('rejects a window_days/horizon conflict when an anchor IS supplied', () => {
    expect(() => assertEncounterAnchor(rctxWithConflictingKeys(), v1WithAnchor))
      .toThrow(/window_days.*horizon|horizon.*window_days/i);
  });

  it('still short-circuits the ANCHOR requirement when an anchor is supplied', () => {
    // Validation runs; the anchor throw does not.
    expect(() => assertEncounterAnchor(rctxWithVitalsAttributeGate(), v1WithAnchor))
      .not.toThrow();
  });

  it('leaves legacy-v0 conditional exactly as today', () => {
    // The mirror case: legacy must NOT gain validation it lacks today.
    expect(() => assertEncounterAnchor(rctxWithMalformedOverride(), legacyWithAnchor))
      .not.toThrow();
  });
});
```

- [ ] **Step 2: Run it, confirm it fails.**
- [ ] **Step 3: Implement the adapter.** Add `horizon?: Horizon` / `status?: TemporalStatus` to `CodedCondition`. `toFactSelectionCondition` guards with `isTemporalOperator` and `fieldToKind`; copy `system` only when present. `parseConditionOverride` rejects the `window_days`+`horizon` pair first, then validates and calls `parseHorizonValue`.
- [ ] **Step 4: Give `sweepableConditions` a version parameter and two paths (D1, P1-15).** Under `legacy-v0`, leave the body exactly as it is — coded conditions only, an unknown field silently skipped, raw `as never` copy, cascade validates downstream. Under `v1`, run a **coded condition through `adaptCodedCondition(cond, label)` — the same adapter evaluation uses** (round 7, P1-22): skipping an unknown field here while `toFactSelectionCondition` throws on it is a preflight/evaluation divergence in the other direction, so an imported `{ field: 'horoscopes' }` passed import and preflight and died mid-traversal. One adapter call validates field, operator and override together; two validators are two chances to disagree. Attribute conditions still resolve their field via `attributeNamespaceToField` (`null` ⇒ skip) and their override via `parseConditionOverride`, until Task 7 gives them their own adapter. **Neither path catches parser errors.** Update the comment at `:589-601`: it is still correct for `legacy-v0` and false for `v1`, so it must say which. **Add `export` to the declaration** (it is module-private at `:546`) so Task 7's preflight/evaluation agreement test can call it; note in a comment that the export exists for that test.
- [ ] **Step 5: Restructure `assertEncounterAnchor` so `v1` validation escapes the early return (P1-18).** Today the function returns at `:638` whenever `encounterStart` is present, which under `v1` would skip override parsing and the `window_days`/`horizon` conflict check entirely. New shape:

```ts
export function assertEncounterAnchor(rctx, temporalCtx): void {
  getTemporalPolicy(temporalCtx.temporalPolicyVersion);   // unchanged, still first

  const version = temporalCtx.temporalPolicyVersion;

  if (version === 'legacy-v0') {
    // EXACTLY today's flow. The early return must stay ahead of the sweep, or a
    // malformed override starts rejecting sessions that succeed today.
    if (temporalCtx.encounterStart) return;
    throwIfAnchorsRequired(sweepableConditions(rctx.graphContext.allNodes, version), ...);
    return;
  }

  // v1: validate AND RESOLVE every condition regardless of the anchor. Parsing
  // proves the horizon grammar; only resolution enforces the rest of the
  // cascade. Errors propagate from here.
  const required = collectEncounterAnchorRequirements(
    sweepableConditions(rctx.graphContext.allNodes, version), version, rctx.temporalDefaults);
  if (temporalCtx.encounterStart) return;      // ONLY the anchor throw is suppressed
  throwIfAnchorsMissing(required);
}
```

> **Round 7, P1-21 — this pseudocode was wrong in v7 and is corrected here.** It
> returned *before* `throwIfAnchorsRequired`, and that helper was what called
> `collectEncounterAnchorRequirements` → `resolveEffectivePolicy`. So with an
> anchor present, nothing resolved: `{ field: 'labs', status: 'active' }` passed
> preflight and threw at evaluation, because "observation fields have no
> clinical state" lives in `resolveEffectivePolicy` (`cascade.ts:228`), not in
> the parser. The prose above it — *"only the anchor-requirement throw stays
> behind the `encounterStart` check"* — was right all along; the code block
> contradicted it, and the implementation followed the code block. **Resolution
> must happen unconditionally; only the throw is skippable.** Note the helper
> shape matters: one that both resolves and throws can only be called where its
> side effect is skippable, so `throwIfAnchorsMissing` takes already-resolved
> requirements.
- [ ] **Step 5: Run both suites. Typecheck.**
- [ ] **Step 6: Commit** — `feat: adapt a coded condition onto the fact-selection contract`

---

### Task 2: One effective policy per gate condition

**Files:** create `temporal/gate-policy.ts`; test `__tests__/temporal/gate-policy.test.ts`

Produces `effectivePolicyFor(adapted: AdaptedCondition, ctx, pathwayDefaults): EffectivePolicy`. A thin seam, deliberately: the one place that reads `ctx.temporalPolicyVersion`, so no operator branch resolves against a different version than its siblings.

**It takes an `AdaptedCondition`, not a condition (P1-20).** The cascade key is `adapted.selection.field` and the NODE tier is `adapted.override`. Coded and attribute conditions therefore reach the cascade through byte-identical code, which is what keeps an attribute gate's evaluation agreeing with the anchor preflight that now sweeps it.

- [ ] **Step 1: Write the failing test**

```ts
const ctx = makeEvaluationTemporalContext({
  evaluationAsOf: '2026-08-11T00:00:00.000Z', temporalPolicyVersion: 'legacy-v0',
});

// The seam takes an AdaptedCondition, never a raw condition (P1-20).
const adaptLab = (extra = {}) =>
  adaptCodedCondition({ field: 'labs', operator: 'greater_than', value: '718-7', ...extra });

describe('effectivePolicyFor', () => {
  it('resolves labs to an unbounded lower bound under legacy-v0', () => {
    const p = effectivePolicyFor(adaptLab(), ctx, {});
    expect(p.horizon.lowerBound).toBeNull();
    expect(p.horizon.upperBound).toBe('2026-08-11T00:00:00.000Z');
    expect(p.status).toBeUndefined();
  });
  it('applies the legacy-v0 active default to conditions', () => { /* status === 'active' */ });
  it('lets a NODE horizon beat the pathway default', () => {
    expect(effectivePolicyFor(adaptLab({ horizon: 'QUARTER' }), ctx, { horizons: { labs: 'YEAR' } })
      .horizon.lowerBound).toBe('2026-05-13T00:00:00.000Z');   // 90 days, not 365
  });
  it('lets a PATHWAY default beat the system default (P1-10)', () => {
    const v1 = makeEvaluationTemporalContext({
      evaluationAsOf: '2026-08-11T00:00:00.000Z', temporalPolicyVersion: 'v1',
    });
    // v1 system default is QUARTER; the pathway says YEAR.
    expect(effectivePolicyFor(adaptLab(), v1, { horizons: { labs: 'YEAR' } }).horizon.lowerBound)
      .toBe('2025-08-11T00:00:00.000Z');
  });
  it('resolves the version from the context, never from an argument', () => { /* ... */ });

  it('resolves an ADAPTED attribute condition through the same path (P1-20)', () => {
    // A LITERAL AdaptedCondition, not adaptAttributeCondition(...) — that
    // function is Task 7's deliverable and does not exist yet, so calling it
    // here would leave Task 2 unable to finish green. This is also the better
    // unit: the claim under test is that the seam is keyed on the ADAPTED
    // SHAPE, not on the condition kind, and a literal proves exactly that
    // without coupling to the attribute adapter. Task 7 adds the integration
    // assertion that the real adapter produces this shape.
    //
    // Stand-in for `vitals.systolic_bp`. Under v1 the vitals system default
    // is ENCOUNTER — the same tier the anchor sweep computes for it.
    const adapted: AdaptedCondition = {
      selection: { field: 'vitals', operator: 'greater_than', value: 'systolic_bp' },
    };
    expect(effectivePolicyFor(adapted, v1WithAnchor, {}).horizon.lowerBound)
      .toBe(v1WithAnchor.encounterStart);
  });
});
```

- [ ] **Step 2: Run it, confirm it fails.**
- [ ] **Step 3: Implement.** Compose `resolveEffectivePolicy(adapted.selection.field, ctx.temporalPolicyVersion, pathwayDefaults, adapted.override)` then `toEffectivePolicy(tier, ctx)`. Do not catch `MISSING_ENCOUNTER_ANCHOR` — plan 03's sweep turns that into an up-front rejection, and swallowing it restores the mid-traversal throw the sweep exists to prevent.
- [ ] **Step 4: Test, typecheck.**
- [ ] **Step 5: Commit** — `feat: resolve one effective policy per gate condition`

---

### Task 3: The version seam — dispatch that changes nothing yet

**Files:** `gate-evaluator.ts`, `./types.ts` (`GateEvaluationResult` gains `indeterminate?`/`uncertainty?`), `traversal-engine.ts`, `retraversal-engine.ts`; test `gate-evaluator-version-seam.test.ts`

Load-bearing, and it must land **before** any operator moves. Introduces `GateEvaluationDeps` (D6), removes the `Date.now()` default, renames today's `evaluateCondition` → `evaluateConditionLegacy`, and adds `evaluateConditionKernel` which at the end of this task simply delegates to the legacy function.

A no-op fork sounds pointless. It is not: it proves the dispatch, the deps object, and every updated call site in isolation, so when Tasks 4–8 change the `v1` branch, a failure is attributable to the operator rewrite and not the plumbing.

> **Round 8, found during execution: the routing tests below are unobservable as written.** Step 1 asks for "routes `legacy-v0` to the legacy evaluator" and "routes `v1` to the kernel evaluator", while the task also requires both branches to decide **identically**. With the two functions module-private behind a `switch`, no assertion can distinguish them — this is exactly the defect P1-16 diagnosed for the cascade test, one level down, and round 3 did not notice it applied here too. Resolved in execution by giving the dispatch an observable seam: an exported `CONDITION_EVALUATORS` table keyed by version, with `conditionEvaluatorFor` reading `temporalPolicyVersion` **once** per gate so sibling conditions of a compound gate cannot resolve against different semantics. `assertKnownPolicyVersion` runs at the top of `evaluateGate` rather than inside the condition evaluator, so a question or `prior_node_result` gate on a session pinned to an unknown version also rejects instead of quietly succeeding through a path that reads no condition. Tasks 4–8 still only replace `evaluateConditionKernel`'s body.

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
- [ ] **Step 4: Thread `pathwayDefaults` through both engines.** Add it to the `TraversalEngine` and `RetraversalEngine` constructors beside the existing `temporalContext` (`traversal-engine.ts:152`, `retraversal-engine.ts:82`), and supply `rctx.temporalDefaults` at **all five** construction sites — `resolution.ts` `:210` (startResolution), `:347`, `:510`, `:697`, and `multi-pathway-resolution.ts` `:772`. *(Round 8: the old phrasing, "plus both start paths and multi-pathway-resolution.ts", read as six — one of the "start paths" IS the multi-pathway file.)* Pass the `temporalContext` object, not the derived `now`. `factStore` is `[]` at this task; Task 9 fills it.
- [ ] **Step 5: Assert the plumbing with spies, not with behavior (P1-16).** At this task `evaluateConditionKernel` still delegates to the legacy evaluator and `factStore` is `[]`, so a behavioral cascade test **cannot fail** — the legacy path never reads `pathwayDefaults`, and the 200-day-old lab is admitted either way. Instead, spy on both engine constructors and assert every one of the five sites passes `rctx.temporalDefaults` by identity. The behavioral proof moves to Task 9, where the kernel and assembler are live.
- [ ] **Step 6: Run the FULL suite.** Broad mechanical churn in test call sites is expected. **Existing assertions must not be weakened** — only call shapes change. Compare against the previous row of the baseline table, and account for every added test.
- [ ] **Step 7: Commit** — `refactor: give evaluateGate explicit dependencies and a version seam`

---

### Task 4: Membership operators on the kernel (`v1` branch)

**Files:** `gate-evaluator.ts`; test `gate-evaluator-membership-kernel.test.ts`

Covers `includes_code`, `equals`, `exists`. Delete Task 3's no-op-fork test — this is where the paths diverge.

> **Round 8, found executing this task — three corrections to what follows.**
>
> **1. The `ConditionOutcome` widening happens HERE, not at Task 8.** Task 8's text claims it, but Step 1 below asserts `r.indeterminate` / `r.uncertainty` off `evaluateGate`, which is unsatisfiable without it. Widen with **optional** fields and propagate through the **single-condition path only**; the compound boundary is genuinely Task 8's. Copy the two fields onto the result **only when present** — adding them unconditionally stamps `indeterminate: undefined` on every `legacy-v0` result and breaks byte-identity with today's object. Derive `indeterminate` from the selection outcome; never hard-code `false`.
>
> **2. Step 1's block never exercises `equals`,** though the task covers it. Add a case: an exact match, plus a literal `Z94.*` that must **not** match `Z94.0` — otherwise the `equals` candidate rule and its reason string are uncovered.
>
> **3. The vitals membership case needs an `encounterStart`.** Under `v1`, vitals pin to `ENCOUNTER`, so `toEffectivePolicy` throws `MISSING_ENCOUNTER_ANCHOR` before any comparison happens. The sketch below does not supply one. Supply it, and add a companion case pinning that a vital taken *before* the encounter is dropped.
>
> **Open question deferred to plan 08 — do NOT guess it here.** `stateUnverified` is not folded into `uncertainty`. Under `status: 'any'`, `selectFacts` deliberately reports that doubt through the separate `stateUnverified` flag rather than as a `STATE_UNKNOWN` reason (`select-facts.ts:120-133`), and no `UncertaintyReason` exists for it. D5's prose arguably covers it, but inventing a reason code here would contradict the kernel. Plan 08 owns evidence and should decide.

> **`exists` is bucket existence, and the adapter NORMALIZES rather than rejects.** `select-facts.ts:75` short-circuits it to match any fact of the kind, ignoring code and system — which is what today's `entries.length > 0` means. The adapter therefore **drops `value` and `system` for `exists`**, so `value: ''` and `value: '718-7'` behave identically, exactly as they do today. Coded `exists` has **no `v1` delta**.
>
> *(Round 6, P1 — accepted. v6 said "reject a `system` or non-empty `value` supplied alongside `exists`." Three things were wrong with it. **One:** the import validator **requires** `value` on every coded condition (`validator.ts:289`), so an author following the import contract produces precisely the condition the adapter would reject — only the undocumented `value: ''` satisfies both, and the repo is already split between that spelling and a real code. **Two:** the rejection fires in the adapter at **evaluation**, while the `v1` preflight sweep runs only `parseConditionOverride` (Task 1 Step 4), so such a pathway passes preflight and throws mid-traversal — precisely what locked decision #7 forbids, and the same divergence class as P1-8, P1-10 and P1-18. **Three:** a merged fixture already carries `{ field: 'labs', operator: 'exists', value: '718-7' }` (`resolution-input-contract.test.ts:602`), so the rejection would break a test that passes on `main` today. Authoring-time rejection is worth doing — an author writing `exists` with a code probably means `includes_code` — but it belongs to **plan 06**, which owns the validator and canonicalization and can warn and migrate rather than throw.)*
>
> **Also correct the comment at `select-facts.ts:73-75`**, which claims "Plan 04's adapter rejects a system/value supplied alongside `exists` at the authoring boundary." That becomes false here, and it already conflates the runtime adapter with the authoring boundary — the conflation that produced this defect.

- [ ] **Step 1: Write the failing test**

```ts
describe('membership under v1 preserves the shape of today’s matching', () => {
  it('matches a trailing-wildcard code pattern (Z94.* matches Z94.0)', async () => { /* ... */ });
  it('respects an explicit system filter', async () => { /* ... */ });
  it('exists is satisfied by any admitted fact, unsatisfied when the field is empty', async () => { /* ... */ });
  it('ignores value and system on exists, exactly as legacy-v0 does', async () => {
    // Both spellings must decide identically: `value: ''` (the convention in
    // reachability.test.ts and select-facts.test.ts) and a real code (the
    // merged fixture at resolution-input-contract.test.ts:602). A 718-7
    // `exists` on a patient whose only lab is 4548-4 is SATISFIED under both
    // versions, and a `system` that matches nothing does not narrow it.
    //
    // This test is the guard on plan 06's future authoring change: with the
    // behavior pinned here, changing it later is a deliberate, visible move
    // rather than a silent regression.
  });
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

> **Round 9, found executing this task — three corrections.**
>
> **1. `OPEN(asOf)` fixes admission but NOT ordering, and there is an undisclosed `v1` delta hiding in the gap.** Verified against the code, not reasoned about. `overlap()` does admit an undated observation — the paragraph above is right. But `definiteLatest` does not order by `overlap`; it orders by `effectiveRange` (`select-facts.ts:143-146`), which reads `interval.start` **only** and returns `(-∞, +∞)` when there is none. It never looks at `interval.end`, so an `OPEN(asOf)` fact — which is precisely a fact anchored to `asOf` — is treated as total temporal ignorance. Consequences, all confirmed by running `selectFacts` directly:
>   - one undated lab alone → `READY` (the `every` in `definiteLatest` is vacuous for a single candidate), so the happy path hides this;
>   - **two labs of the same code where at least one is undated → `INDETERMINATE`/`AMBIGUOUS_LATEST`**, even when the other is precisely dated. The gate fails closed while `legacy-v0` `.find()`s the first and decides.
>
>   This directly defeats the assembler's stated intent: `context-assembler.ts:167-169` chooses `OPEN(asOf)` for an undated lab *because* "otherwise every scalar gate reading it would fail closed" — and the gate fails closed anyway, one layer further down, for a reason the comment does not anticipate. `SyntheticLabResult.date` is optional, so a `labResults` array with a repeated code and one missing date is ordinary input, not a contrived fixture. **This is a real behavior delta that no task discloses**, and locked decision #2 requires every `v1` delta to be disclosed and pinned. Task 5 did not fix or pin it: the fix is a judgement call in plan 01/05 territory (either `effectiveRange` consults `interval.end`, or `AMBIGUOUS_LATEST` on an undated-vs-dated pair is accepted and *disclosed*), and guessing it here would be inventing kernel semantics inside an evaluator task. **Decide it before Task 6**, which inherits the identical blind spot through `AMBIGUOUS_SERIES_ORDER` (`select-facts.ts:267-273`, the same `effectiveRange`) — there a single undated lab poisons every `trend_*`/`delta_from_baseline` series.
>
>   *Defect class note: rounds 1–3 were design, 4–5 plan mechanics, 6 cross-layer consistency, 7 pseudocode, 8 field-level dependencies. This one is none of those — it is a **cross-plan intent** defect: layer A (the assembler) documents a guarantee it believes it is providing, and layer B (the kernel's ordering helper) silently does not honor it. Neither layer is wrong read on its own, which is why five rounds of reading them separately never surfaced it. **Before round 10, check every comment that asserts what ANOTHER module will do with the value being constructed, and verify that module actually does it.***
>
> **2. Step 1's block never exercises `less_than`,** though the task covers it — the exact defect round 8 recorded against Task 4's `equals`, recurring here because that fix was applied locally instead of swept across the remaining tasks. Add a `less_than` case: its comparison direction AND its distinct reason strings (`<` / `>=`) are otherwise wholly uncovered. **Task 6 has the same hole**: its sketch names four operators and exercises `count_in_window` and "trend and delta" generically, so `trend_down` and the `trend_up`/`delta_from_baseline` split are uncovered there too. When a round finds a class of defect, sweep the class.
>
> **3. The diagnostic hint above ("check Task 9 before touching the kernel") cannot be acted on at this task.** `factStore` is `[]` at every resolver until Task 9, so these tests build the store by hand and the assembler is not involved at all — an executor whose undated-vital case failed would go read Task 9 and find nothing. The hint belongs at Task 9. Mild, but it is the P1-16 class inverted: not a test that cannot fail, a debugging instruction that cannot help.
>
> **Also: `threshold` is never mentioned.** The comparison keeps legacy's `condition.threshold ?? parseFloat(condition.value)`, where `value` is the observation *code* — so an authored `greater_than` with no `threshold` compares against `parseFloat('718-7') === 718`. Preserved deliberately (this task moves selection, not comparison), but it is a live authoring trap that plan 06 should reject rather than a behavior worth inheriting forever.

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

### Task 6: Aggregate operators on the kernel

> **Round 9, two things before you start.**
>
> **1. D7 applies here unchanged.** One undated fact poisons every `trend_*` / `delta_from_baseline` series over that code, via `AMBIGUOUS_SERIES_ORDER` and the same `effectiveRange` blind spot. That is accepted and disclosed — implement it, do not re-litigate it, and do not invent an ordering rule to work around it.
>
> **2. Test every operator this task NAMES.** It covers four — `count_in_window`, `trend_up`, `trend_down`, `delta_from_baseline` — but the sketch tests "trend and delta" generically, leaving `trend_down` and the `trend_up`/`delta_from_baseline` split uncovered. Task 4 had this hole for `equals` and Task 5 for `less_than`; the fix was applied locally each time instead of swept. **When a round finds a class, sweep the class.** (`v1` branch)

**Files:** `gate-evaluator.ts`; test `gate-evaluator-aggregate-kernel.test.ts`

Covers `count_in_window`, `trend_up`, `trend_down`, `delta_from_baseline`. `linearSlope` stays — pure math over a series. The `v1` series comes from `selected`, sorted by effective time; `collectLabSeries` and `isWithinWindow` remain for `legacy-v0`.

> **`count_in_window` counts distinct `factId`** (design §4). Plan 05 decision 6 widened the `buildEffectivePatientContext` merge key for this reason. If a count reads 1 where 2 is expected, check the merge key before the kernel. *(Round 10: verified, and it holds — the key is `code|system|date|sourceId` (`effective-context.ts:53-56`) and `makeIdFactory` assigns one id per kind per entry, so two same-code labs on different dates survive the merge and get distinct `factId`s. This is the one cross-plan claim in this task that checked out.)*

> **Round 10, found executing this task — three findings. Read them before writing the count branch.**
>
> **1. `count_in_window` loses its window entirely on `conditions` / `medications` / `allergies` under `v1`. See D8 — SETTLED AND FIXED.** Every still-active entry is `OPEN(evaluationAsOf)`, so `overlap` matched every horizon and `window_days` stopped discriminating on exactly the buckets the operator exists for. Pinned by test at Task 6, then fixed in the D8 follow-up: the aggregate class selects on the start bound. The pinning test is inverted, not deleted. **No longer a `v1` delta** — Task 10 must record it as a defect found and closed, not disclose it as behaviour.
>
> **2. An UNDATED observation is counted inside a window `legacy-v0` drops** — `isWithinWindow(undefined, 90, now)` is `false`, while `OPEN(asOf)` matched. The admission half of D7 surfacing in the aggregate class, again in the permissive direction. Pinned by test at Task 6; ordinary input, because `SyntheticLabResult.date` is optional. **Also closed by D8** for a BOUNDED horizon; it survives under LIFETIME, where legacy also admits by date-blind short-circuit for a count but where legacy's `collectLabSeries` still drops the undated point from a `trend_*` series. That last sliver is D8's disclosed residual and is what Task 10 must carry.
>
> **3. `select-facts.ts:55-68` overstates its own candidate rules.** It says each rule "mirrors what the current evaluator does, so `legacy-v0` is genuinely behavior-preserving", and for `trend_*` / `delta_from_baseline` cites `collectLabSeries`'s wildcard match and finite-value requirement — but omits that `collectLabSeries` **also requires a parseable date** (`gate-evaluator.ts:145-147`). `candidateMatches` has no such requirement, which is precisely how an undated lab enters a series and triggers `AMBIGUOUS_SERIES_ORDER`. The comment should say so; the behavior is D7's and stays.
>
> **4. The reason string cannot be keyed on `condition.window_days`.** Legacy derives its `windowDesc` from `window_days` alone, so under `v1` a labs count with no `window_days` would print "within lifetime" while in fact looking back only a QUARTER. Implemented instead as a function of the **resolved horizon**, which renders `{days:90}` and `QUARTER` identically as "last 90 days" and LIFETIME as "lifetime" — byte-identical wherever the outcome matches legacy's, and honest where it does not.
>
> **Also settled in execution: the policy is resolved BEFORE the labs-only check.** Legacy short-circuits `field !== 'labs'` first. Inheriting that order would let a `vitals` trend gate answer a quiet `false` at evaluation while the `v1` anchor sweep rejects the whole session for the same condition — locked decision #7. A test pins the ordering.

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

describe('attribute policy flows through the shared seam (P1-20)', () => {
  it('lets a pathway default change an attribute gate’s decision', async () => {
    // temporal_defaults { horizons: { labs: 'YEAR' } } against a 200-day-old
    // A1c, targeted by `lab.a1c > 9`. Unsatisfied under v1's QUARTER default,
    // satisfied under the pathway's YEAR. Proves the attribute path reaches the
    // cascade rather than resolving policy inline.
  });

  it('agrees with what the anchor preflight computed for the same condition', async () => {
    // The same vitals.* condition, through sweepableConditions and through
    // effectivePolicyFor, must resolve the same tier. If these can disagree,
    // locked decision #7 is violated and a gate throws mid-traversal.
    const swept = sweepableConditions([vitalsAttrGateNode], 'v1')[0];
    const adapted = adaptAttributeCondition(vitalsAttrCondition, codeMap)!;
    expect(adapted.selection.field).toBe(swept.field);
    expect(adapted.override).toEqual(swept.override);
  });
});
```

- [ ] **Step 2–5:** implement `adaptAttributeCondition(c, codeMap): AdaptedCondition | null` (`null` ⇒ `patient.*`), returning the **same shape as `adaptCodedCondition`** so the policy seam is shared, test, typecheck, commit — `feat: route clinical attribute conditions through the kernel under v1`

---

### Task 8: Compound gates propagate uncertainty

> **Round 8: the `ConditionOutcome` widening this task claims already happened at Task 4** — Task 4's own specified test reads `r.indeterminate`/`r.uncertainty` and cannot pass without it. What remains here is genuinely this task's: propagating both signals across the **compound** boundary, which Task 4 deliberately left dropping them. (P2-6, P1-11)

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

**Files:** `resolvers/mutations/resolution.ts` (start + `:347`, `:510`, `:697`), `resolvers/mutations/multi-pathway-resolution.ts`, `resolvers/helpers/resolution-context.ts` (policy selector), `types/index.ts` (`DataSourceContext` gains `temporalPolicyVersion?: string`), `index.ts` (populate it from deployment config); test `resolution-fact-store-wiring.test.ts`

Until this lands, `assembleContext` has no callers and Tasks 4–8 run only in unit tests. Facts are **not persisted** (plan 05b), so every entry point re-assembles from `buildEffectivePatientContext(initialPatientContext, additionalContext)` under the session's **stored** temporal context. Plan 05 decision 5 makes this sound: identical input yields identical `factId`s.

**Three constraints from round 2:**
1. **`v1` only (P1-9).** The assembler validates and throws. Under `legacy-v0` it is never called and the store is `[]`.
2. **Two helpers, not one (P1-9).** At `startResolution` there is no session — only resolution input and a fresh clock. `factStoreForInput(input, ctx, defaults)` and `factStoreForSession(session, additions)` share a lower-level core taking normalized context + clock.
3. **A request-scoped server-side selector (P2-12, corrected by P1-14, P1-19, and round 5).** `resolveTemporalPolicyVersion(ctx: DataSourceContext): string` takes the **GraphQL** context and **not** a `ResolutionContext` — `multi-pathway-resolution.ts:214` stamps the shared clock before `getMatchedPathways`, and its zero-match branch returns without ever building one. Call it immediately before `makeEvaluationTemporalContext` in both start paths — the same position `assertKnownPolicyVersion` already occupies at `:219`, for the same reason. Reading one context field per request is what gives every child session in a multi-pathway run the same version, as §1 requires.

   **The injection seam is a plain string field, not a callback:** `temporalPolicyVersion?: string` on `DataSourceContext` (`types/index.ts:5`), populated in `index.ts` from deployment config and never read from a request header (AD-1). Tests construct the context object directly, the way they already do for `userId` — no module mocking and no mutable global. Assertions must read the **persisted `temporal_context`**, because `formatSessionForGraphQL` (`:1150-1164`) does not return it and will not until plan 08.

   **There is deliberately no call-count assertion.** v5 asserted the selector ran exactly once via a `selectorCalls` array that nothing populated — an unimplementable test of the *mechanism* rather than the property. For a string field, reading it once or three times is not a behavioral difference; the property that matters is that every child carries the same injected value, which the child-session test below asserts directly.

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

describe('the policy selector is request-scoped and server-side (P2-12, P1-14, P1-19)', () => {
  // The seam: a plain server-owned string field on the GraphQL context,
  // populated in index.ts from deployment config and NEVER from a request
  // header (AD-1). Tests build the context directly — no module mocking,
  // no globals, no callback.
  const ctxWith = (v) => ({ ...baseContext, temporalPolicyVersion: v });

  // Every assertion below reads the PERSISTED session row, not the GraphQL
  // payload: formatSessionForGraphQL (:1150-1164) returns no temporalContext,
  // and that exposure belongs to plan 08 (design §606).
  const persistedVersion = async (id) =>
    (await pool.query('SELECT temporal_context FROM ... WHERE id = $1', [id]))
      .rows[0].temporal_context.temporalPolicyVersion;

  it('defaults to legacy-v0 when the deployment sets nothing', async () => {
    const s = await startResolution(args(), baseContext);
    expect(await persistedVersion(s.id)).toBe('legacy-v0');
  });

  it('stamps the INJECTED version on the zero-match path', async () => {
    // Asserting v1, not legacy-v0: makeEvaluationTemporalContext already
    // defaults to legacy-v0, so the previous version of this test passed
    // whether or not the selector ran at all.
    const s = await startMultiPathwayResolution(argsMatchingNothing(), ctxWith('v1'));
    expect(await persistedVersion(s.id)).toBe('v1');
  });

  it('gives every child session the injected version, not merely equal ones', async () => {
    // Asserting the VALUE, not just uniformity: three ignored injections all
    // yielding legacy-v0 are also uniform.
    const s = await startMultiPathwayResolution(argsMatchingThreePathways(), ctxWith('v1'));
    const versions = await Promise.all((await childIds(s.id)).map(persistedVersion));
    expect(versions).toHaveLength(3);
    expect(versions.every((v) => v === 'v1')).toBe(true);
  });

  // No call-count test: see Task 9 constraint 3. The property v5 tried to
  // reach through `selectorCalls` — one version shared across every child —
  // is what the preceding test asserts, against persisted rows.

  it('is not selectable from either start mutation’s arguments', () => {
    // Narrowed from a whole-SDL regex (P2-17): that would also forbid the
    // read-only output field design §606 plans for plan 08.
    for (const m of ['startResolution', 'startMultiPathwayResolution']) {
      expect(argumentNamesOf(m)).not.toContain('temporalPolicyVersion');
    }
  });

  it('ignores a temporalPolicyVersion supplied on the request', async () => {
    // The seam is server-owned. A caller-supplied value must not reach it.
    const s = await startResolution({ ...args(), temporalPolicyVersion: 'v1' }, baseContext);
    expect(await persistedVersion(s.id)).toBe('legacy-v0');
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

- [x] **Step 2: Run it, confirm it fails.**
- [x] **Step 3: Implement.** Add the selector; gate assembly on `version === 'v1'`; build the two helpers over a shared core. Retraversal must not stamp a fresh clock — it reads `session.temporal_context`.
- [x] **Step 4: Run the FULL suite.** Compare against the previous row of the baseline table, and account for every added test.
- [x] **Step 5: Commit** — `feat: assemble a fact store at every v1 resolution entry point`

**Executed 2026-08-12.** Three implementation choices the plan left open:

1. **`factStore` is a REQUIRED constructor parameter on both engines**, fifth —
   after `pathwayDefaults`, before the optional `llmGateEvaluator`. Not
   optional-with-a-default, because that is exactly the shape P1-10 promoted
   `pathwayDefaults` out of and R11-4 flags for `codeMap`, and `factStore` is
   the single most load-bearing `v1` input: omitted at one of the five sites,
   every `v1` gate selects from nothing and answers a quiet `false` while that
   pathway's preflight resolved policies for the conditions the gate can no
   longer see. Backed by a runtime `Array.isArray` guard in
   `assertRequiredDeps` — the type is not the guard (`src/__tests__` is
   excluded from typechecking), and the test is `Array.isArray` rather than
   truthiness because an EMPTY store is `legacy-v0` working as designed while
   an ABSENT one is a wiring bug. Cost: five call-shape edits in pre-existing
   tests, no assertion changes.
2. **The two start mutations order request-validation before pathway-preflight,
   identically.** `startMultiPathwayResolution` has no choice — its zero-match
   branch returns before any pathway is loaded, and whether a malformed context
   is rejected must not depend on how many pathways happened to match — so
   `startResolution` was matched to it rather than the reverse. Otherwise the
   same malformed context reports `INVALID_RESOLUTION_INPUT` through one
   mutation and `MISSING_ENCOUNTER_ANCHOR` through the other.
3. **`factStoreForInput(input, ctx)` takes two parameters, not the three named
   in the prose.** There is no third input: assembly reads the patient payload
   and the clock and nothing else — in particular it is pathway-independent,
   which is what lets a multi-pathway run assemble once and hand the same store
   to every child (asserted by identity, not equality). A `defaults` parameter
   would have had no consumer.

---

### Task 10: Prove it, document the gaps, reconcile the suite

**Files:** `docs/superpowers/plans/2026-07-26-temporal-horizon-00-overview.md`, `docs/superpowers/specs/2026-07-21-pathway-temporal-horizon-design.md` (§6, §10, Compatibility), `temporal/select-facts.ts` (comment)

- [ ] **Step 1: Prove `legacy-v0` is untouched.** The evidence is that **every pre-existing gate-evaluator and traversal test passes with unmodified assertions** — only call shapes changed. Run the full suite, diff against the last row of the baseline table. Any assertion that had to be weakened is a seam bug; fix the seam, not the test.
- [ ] **Step 2: Enumerate the `v1` deltas** in Compatibility, from the tests that pin them: validity filtering, latest-vs-first scalar selection, equal-time ambiguity, future-date exclusion, horizon filtering of membership, vitals membership becoming satisfiable — **but NOT vitals `count_in_window`, which D8 makes a permanent zero under `v1` because every vital is undated and the vitals horizon is always bounded; disclose that instead, pinned by `makes a VITALS count always zero under v1`** — **and the attribute-specific deltas** — `lab.*`/`vitals.*`/`allergy.*` gaining horizon and validity filtering, and attribute `exists` becoming exact-code rather than any-fact. **Add R14-1's delta:** an attribute `exists` on a MEMBERSHIP namespace (`allergy.*`) is now unsatisfied when the mapped allergy is absent, where `legacy-v0` reports it PRESENT — `resolveAttribute` returns `allergies.some(...)`, a boolean that is never `undefined`, and `compareScalar` reads `exists` as `resolved !== undefined`. The legacy half is a pre-existing defect, queued in `2026-08-12-resolution-subsystem-gaps.md` and deliberately not fixed here; `lab.*`/`vitals.*` are unaffected because they derive a number. **Record R12-1/R12-2 — the signals this plan produces have no reader.** `indeterminate` and `uncertainty` are produced on every `v1` gate result and dropped whole by both engines, so after Task 9 the only persisted trace of an indeterminate gate is `excludeReason` prose — and that carrier is asymmetric: AND joins the condition reasons, OR emits the literal `'No compound conditions satisfied'`. **An OR compound refused for uncertainty is recorded byte-identically to one where the patient had none of the codes.** Disposition: **both** halves apply — Task 10 discloses it here, AND plan 08 must read the flag rather than the prose, which is why it is produced. Plan 08 owns `GateEvaluationEvidence`; this is the evidence it exists to carry. Do NOT fix by changing the OR prose — reason strings stay byte-identical to legacy's. **Record the undated-observation delta (D7)**: a scalar or series gate over an undated fact plus any other candidate is `AMBIGUOUS_LATEST` and fails closed, where `legacy-v0` picked the first array element and decided. This is the delta most likely to surprise, because the simulator's lab `date` is optional. **Record coded `exists` explicitly as a NON-delta** — it keeps bucket semantics under `v1`, ignoring `value` and `system` exactly as today, with authoring-time rejection deferred to plan 06 (round 6, P1). An audit that lists only deltas hides the operator where a delta was proposed and deliberately rejected, which is how it would get reintroduced.
- [ ] **Step 3: Revise design §10 (P2-13).** §589 says "Attribute conditions get no horizon control (encounter-derived, no timeline)." That is now false for the three clinical namespaces and true only for `patient.*`. Update it, and note that §590's fixed-Encounter vitals control is what makes the attribute anchor sweep (P1-8) mandatory.
- [ ] **Step 4: Correct `select-facts.ts:58`.** Its comment claims the candidate rules make `legacy-v0` "genuinely behavior-preserving." They mirror the current evaluator's *candidate* rules only; validity, ordering, and vitals bucketing still differ. Rewrite it to say what it actually guarantees.
- [ ] **Step 5: State the shadow boundary (P2-13).** Retaining `evaluateConditionLegacy` is a *precondition* for shadow evaluation, not shadow evaluation. Nothing in this plan runs both paths or diffs them; the rollout change owns that, along with retiring the legacy path.
- [ ] **Step 6: Update the overview.** Plan 04 Produces/Consumes; the corrected plan-01 claim; plan 04b (D4); governed reachability moved into plan 07 with its four open questions (request clock, policy version, `temporal_defaults` loading, snapshot→fact mapping); `ALWAYS_EVALUABLE` retains its meaning.
- [ ] **Step 7: Commit** — `docs: record the v1 deltas and reconcile the suite overview`

---

## Acceptance criteria

- [ ] `legacy-v0` executes no kernel code and never calls the assembler; its sweep rejects **exactly** what it rejects today — no more (widened coverage) and no less (swallowed parser errors); every pre-existing test passes with **unmodified assertions**.
- [ ] Full suite failing exactly 9, in the two known scorer suites; the pass count equals the previous task's plus every test that task added, each accounted for.
- [ ] `evaluateGate` has no `Date.now()` fallback and throws without `temporalContext` **or** `pathwayDefaults`.
- [ ] A pathway `YEAR` lab default beats `v1`'s `QUARTER` **through a real traversal at Task 9**, where the kernel is live; Task 3 proves the plumbing with constructor spies instead.
- [ ] A `v1` `vitals.*` attribute gate without `encounterStart` is rejected at **preflight**, not mid-traversal — proven by a direct `assertEncounterAnchor` call, since no activation seam exists at Task 1.
- [ ] `resolveTemporalPolicyVersion(ctx: DataSourceContext)` takes the GraphQL context and no `ResolutionContext`, runs before `getMatchedPathways`, and stamps the **injected** version on the zero-match path; every child of one multi-pathway run carries that same value. Every such assertion reads the persisted `temporal_context`, never the GraphQL payload.
- [ ] Under `v1`, a malformed override or `window_days`/`horizon` conflict is rejected at preflight **even when `encounterStart` is supplied**; under `legacy-v0` that same pathway still starts.
- [ ] `effectivePolicyFor` takes an `AdaptedCondition`; a `vitals.*` attribute condition resolves the same field and override through `sweepableConditions` and through the adapter.
- [ ] Neither start mutation accepts a `temporalPolicyVersion` **argument**, and the guard does not forbid the read-only output field design §606 plans.
- [ ] Under `v1`, no operator branch reads `patientContext.labResults`, `.conditionCodes`, `.medications`, `.allergies`, or `.vitalSigns` directly.
- [ ] A condition carrying both `window_days` and `horizon` is rejected; `window_days` alone still filters.
- [ ] `sweepableConditions` and the evaluator share one override parser and one namespace→field map.
- [ ] Under `v1`, preflight rejects **everything the runtime adapter would reject** — an unknown field, an unknown operator, a malformed override, a `window_days`/`horizon` conflict, and a `status` on an observation field — **whether or not `encounterStart` is supplied**. Only the missing-anchor error is suppressed by an anchor (round 7, P1-21/P1-22).
- [ ] The import validator rejects a coded `field` outside `FIELD_TO_KIND`, so an unauthorable-at-runtime field cannot be stored in the first place.
- [ ] A pathway carrying a per-condition `horizon` **imports without a validation error** — `CODED_KEYS` and `ATTRIBUTE_KEYS` list `horizon` and `status`, so the NODE tier is reachable through the real authoring path and not only from hand-built fixtures (round 6, self-found).
- [ ] `lab.a1c exists` with only an unrelated lab present is unsatisfied; an `allergy.*` equality gate is satisfiable; a nested custom vital resolves.
- [ ] `addPatientContext` can flip a previously unsatisfied gate.
- [ ] A definite aggregate reports `indeterminate: false` with non-empty `uncertainty`; each truth-table row has a passing test.
- [ ] No GraphQL input selects `temporalPolicyVersion`, and a test guards against one being added.
- [ ] Reachability is unchanged, and the overview records why plus the four questions plan 07 must answer.


---

## Task 10 — execution results (2026-08-12)

### `legacy-v0` is untouched — the measurement, not the assertion

The plan's central compatibility claim is that `legacy-v0` executes today's code and
that every pre-existing test passes with **unmodified assertions**. That is checkable,
and here is the check:

```
git diff --name-status main..HEAD -- 'apps/pathway-service/src/__tests__/*'
# then, for each file marked M:
git diff main..HEAD -- <file> | grep '^-' | grep 'expect('
```

**Result: 15 pre-existing test files were modified across the whole branch, and ZERO
removed `expect(` lines among them.** They changed by pure insertion — call-shape
edits added arguments to `evaluateGate` and the engine constructors; no assertion was
deleted, reworded or loosened.

All **9** `expect(` removals anywhere on the branch occurred inside test files the
branch itself **created**, and each is accounted for:

| # | Where | Why |
|---|---|---|
| 1 | `gate-evaluator-version-seam.test.ts` (Task 3's file) | Task 4 deleted the no-op-fork test — the paths diverge there by design |
| 3 | `gate-evaluator-aggregate-kernel.test.ts` (Task 6's file) | D8 pinning flips: tests that documented the defect now document the fix |
| 4 | `resolution-fact-store-wiring.test.ts` (Task 9's file) | D10 inversions: the R13-1 pins Task 9 wrote to document the gap |
| 1 | same | a relocation, assertions byte-identical |

**The precise claim: no assertion that existed on `main` was removed or weakened
anywhere in this branch. Every removal was the branch editing its own new files.**
Two of those groups are deliberate inversions with a comment on each recording which
decision inverted it, so the history is readable from the tests themselves.

### The shadow boundary — what this plan did NOT do

Retaining `evaluateConditionLegacy` is a **precondition** for shadow evaluation, not
shadow evaluation. **Nothing in this plan runs both paths or diffs them.** No request
executes `legacy-v0` and `v1` together; no output is compared; no divergence is
recorded anywhere at runtime. The version seam makes such a comparison *possible* —
that is its whole purpose — but building it, and retiring the legacy path afterwards,
belongs to the rollout change.

Nor does anything route to `v1`. `resolveTemporalPolicyVersion` reads a server-owned
deployment field that defaults to `legacy-v0`, and neither start mutation accepts a
version argument. **Every `v1` behaviour in this branch is reachable only from tests.**
The rollout flip changes deployment config, not the schema.

### What later plans now owe

Carried forward explicitly so none of it is lost when this branch merges:

- **Plan 05b** — normalized-fact persistence and REPLAY. `assembleContext` still
  refuses REPLAY by name.
- **Plan 06** — canonicalization; authoring-time rejection of an `exists` carrying a
  code (deliberately NOT done here, see the NON-delta note); `conditionId`.
- **Plan 07** — the LIVE snapshot mapper. **Warning (R11-6):** it will emit vitals
  with real LOINC codes, and every `vitals.*` attribute gate currently assumes the
  assembler's `VITALS_SYSTEM` urn. That mapping has to be reconciled or every such
  gate silently selects nothing. Reachability also moves here, unchanged by plan 04,
  with its four open questions: request clock, policy version, `temporal_defaults`
  loading, and snapshot→fact mapping.
- **Plan 08** — `GateEvaluationEvidence`. **It must read the `indeterminate` /
  `uncertainty` flags rather than the reason prose (R12).** The flags are produced on
  every `v1` gate result today and read by nothing; the prose carrier is asymmetric,
  so an OR compound refused for uncertainty is currently indistinguishable from one
  where the patient had none of the codes.
- **Plan 09** — authoring UI. Should require a date on lab input (D7, otherwise
  scalar and series gates fail closed) and reject a `system` on a vitals condition
  (D9, already rejected server-side — the UI should not let an author get there).
- **A data sweep of stored pathways, before the `v1` flip.** The import validator now rejects out-of-domain control values and `v1` refuses them at runtime, but **pathways already in AGE are unreachable by either.** A stored `slope_threshold: -1` still makes a RISING series satisfy `trend_down` under `legacy-v0`, because the evaluator computes `slope < -slopeFloor`. Fixing that in the evaluator would be a behaviour change reachable under `legacy-v0` — a bug in the seam by locked decision #2 — so the instrument is a one-off audit, not an evaluator edit. Audit for `slope_threshold < 0`, `count_threshold < 1`, non-integer `min_points`, and non-finite `threshold` / `delta_threshold`.
- **`window_days` has no authoring-time domain (→ plan 06).** `-5` imports cleanly. `v1` rejects it at session creation via `parseConditionOverride` → `parseHorizonValue`; `legacy-v0` never validates it at all, because the legacy sweep does not put `window_days` in the override. Deliberately **not** added to `conditionControlDomainError`: `parseHorizonValue` owns that rule, and a second copy at the import boundary is the two-places-to-disagree shape locked decision #7 forbids. The canonicalizer can warn and migrate instead of throwing.
- **Plan 04b** — `satisfaction_check.lookback_days` (`prerequisites.ts`), the second
  temporal filter no cascade level governs. Out of scope here (D4), still unowned.
