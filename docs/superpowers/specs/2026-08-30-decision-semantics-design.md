# Decision Semantics — Design

**Date:** 2026-08-30
**Status:** Approved for planning
**Repos:** `prism-graphql` (pathway-service), `prism-admin-dashboard`

## Why

A review of the "One Decision Construct" proposal (Josh, 2026-08-16) found that most of
its diagnosis holds while its remedy does not. The memo argues that gates, questions, LLM
gates and DecisionPoints should collapse into one `Decision` node whose author declares an
ordered list of resolution sources. Verification against the engine showed:

- Three of the memo's four sharpest pieces of evidence were **defects, not architecture**.
  Two are fixed on `fix/gate-depends-on-strict-shape`: the canonical `depends_on` shape was
  unimportable (so authors used `REQUIRES` edges as a stand-in — the memo's §3c
  "split authoring"), and the preview composer hardcoded `patientAttributes: {}` (so
  attribute gates resolved "attribute has no value" — the memo's §3a "silent skip").
- The memo's §2 claim that missing data and "condition false" are indistinguishable is
  **more true than argued**. The kernel computes `indeterminate` / `uncertainty` per
  condition, but `traversal-engine.ts` reads only `satisfied` and discards them — and
  production runs `legacy-v0`, whose `legacy` evaluation mode never computes them at all.
- `branch_mode` and `SELECTS_BRANCH` are validated at import and **never read at
  resolution**. A `one_of` fork silently includes every branch clearing `suggestThreshold`.
  This is the memo's least-emphasised problem and its most serious: it can emit mutually
  exclusive treatment arms in a single plan.

This spec takes the diagnosis and declines the construct. Unifying *where an answer comes
from* is valuable; collapsing it with *how many branches may be taken* is not. Every change
here is additive to the existing taxonomy, and each one independently removes a defect the
memo correctly identified.

## Constraints

- **No users.** Decisions optimise for long-run platform health; short-term data weirdness
  is acceptable and fixable. No compatibility seams, no deprecation windows.
- **`one_of` is already the documented default** for DecisionPoints with criteria
  (migration `060_backfill_decisionpoint_branch_mode.sql`). This spec enforces existing
  documented intent rather than inventing semantics.
- Behaviour changes ship as the new default. No policy-version seam for decision semantics.

## Scope

Five workstreams. **W0 is a prerequisite for W1 and W2.** W3 and W4 are independent of W0
and of each other.

---

## W0 — Flip the evaluator to `v1`

**Problem.** `DEFAULT_TEMPORAL_POLICY_VERSION = 'legacy-v0'`, no `TEMPORAL_POLICY_VERSION`
override is set on the live process, and the registry maps `'legacy-v0' → evaluationMode:
'legacy'`. Only the `kernel` mode sets `indeterminate` / `uncertainty`. W1 and W2 are inert
until this flips.

**Change.** `DEFAULT_TEMPORAL_POLICY_VERSION = 'v1'`.

**Fallout to handle.**

- The 41 stored `ACTIVE` resolution sessions (newest `2026-07-13`) were created under
  `legacy-v0`. **Delete them** rather than build retraversal compatibility. They are stale
  test data and there are no users.
- Migration 064 (`add_temporal_defaults_to_pathway_graph_index`) is already applied —
  verified against `migration_history`. No migration work is required for the flip itself.
- The suite carries 9 pre-existing confidence-scorer failures. They are unrelated to this
  work and must not be "fixed" opportunistically inside it; they are the known baseline
  and the plan should assert the count rather than the suite being green.

**Non-goal.** Removing `legacy-v0` from the registry. It stays as a differential-test
fixture. Its retirement is separate cleanup.

---

## W1 — Carry `indeterminate` to the surface

**Problem.** The kernel distinguishes "condition is false" from "I could not tell", with a
normative truth table for compound gates (`compoundIndeterminate`). `traversal-engine.ts`
reads `gateResult.satisfied` only. The signal reaches the API solely as an aggregate count
on `ReachabilityScore.indeterminateGates` — never per-gate on an actual resolution.

**Change.**

- Add `indeterminate?: boolean` and `uncertaintyReason?: string` to `NodeResult`.
- Populate them in `traversal-engine.ts` from the `GateEvaluationResult`.
- Propagate onto `GateEvidence` and `DataGapHint`.
- Expose both on the corresponding GraphQL types.

**Deliberately not a new `NodeStatus`.** Status is an *outcome* channel and W2 decides the
outcome. `indeterminate` is a *reason* channel that travels alongside whatever status W2
assigns. Conflating them would make "pending because unanswered question" and "pending
because data missing" the same value again, which is the bug being fixed.

**Compound gates.** The existing truth table is normative and must not be re-derived here.
`indeterminate` is reported only when uncertainty could have changed the answer.

---

## W2 — Escalate on indeterminate

**Problem.** A gate that cannot evaluate silently takes `default_behavior`. The system
knows exactly which datum it needed and never asks. (Memo §3a, §3b.)

**Change.** New Gate property `on_unresolved: 'ask' | 'default'`, **defaulting to `'ask'`**.

| `on_unresolved` | Behaviour when the gate is indeterminate |
|---|---|
| `'ask'` (default) | Emit a pending question; mark the gate and its subtree `PENDING_QUESTION`, exactly as an unanswered question gate does today |
| `'default'` | Apply `default_behavior` — today's behaviour |

A definite `false` never escalates. Only genuine indeterminacy does. This distinction is
the entire reason W1 must land first.

**Prompt generation.** Auto-generated from the condition, overridden by an authored
`prompt` when present. Generated text is strictly descriptive of the datum required —
`"Hemoglobin (LOINC 718-7) — most recent value?"` — and never offers clinical guidance or
implies what answer the pathway expects. `answer_type` derives from the condition: numeric
for scalar comparisons, boolean for `includes_code` / `exists`.

**Answers become facts, not verdicts.** This is the most consequential decision in the
spec. An answer to an escalated data gate is injected into the patient context as a
synthetic fact — answering "Hb = 9" adds a lab result the kernel then evaluates normally —
rather than short-circuiting the gate to satisfied/unsatisfied.

Rationale:

- Five gates on the anemia pathway read `718-7`. As a fact, the provider is asked **once**
  and all five resolve. As a verdict, they are asked five times and each answer is stranded
  at its own gate.
- The answer participates in horizon and status logic like any other fact, instead of
  bypassing the temporal kernel that was just built.
- It is the substrate a future source-chain (`resolve_from`) would need. Choosing verdicts
  now would have to be undone to get there.

The synthetic fact must be distinguishable from chart data in the audit trail — a provider
assertion is not an observation, and the evidence trail must not imply it was.

**Deduplication.** Two gates needing the same datum produce one pending question, keyed on
the datum rather than the gate. This falls out of the fact model and is a requirement, not
an optimisation. The datum key is the resolved identity of the thing being asked for:
`system + code` for a coded condition, the dotted path for an attribute or vital. Gates
reading the same datum under *different* operators still share one question — they need one
value, not one comparison each.

**Answers arrive through W3's generalised mutation.** An escalated data gate is answered by
the same `answerPendingDecision(sessionId, nodeId, answer)` call as a question gate or a
pending decision. There is one answer path, not one per pending kind.

---

## W3 — Enforce `branch_mode` and `SELECTS_BRANCH`

**Problem.** Both are validated at import and never read at resolution. Every DecisionPoint
that declares a mode declares `one_of` — 7 on the ACTIVE anemia pathway, 6 on chronic-htn,
1 on vaginitis — and none of them are enforced. Three DecisionPoints declare nothing.

**Change.**

- **`one_of`** — exactly one branch may be taken. One qualifier auto-selects, as today.
  **More than one qualifier pends for provider choice**: emit a pending decision listing the
  candidate branches with their confidences, and traverse none until answered. Do not
  auto-pick by highest confidence; on an exclusive clinical fork, "the data cleared the bar
  twice" means the data did not decide it.
- **`all_of`** — every branch is taken; a branch below threshold is a red flag, not an
  exclusion.
- **`any_of`** — current behaviour (all qualifying branches included).
- **`SELECTS_BRANCH`** — a satisfied Criterion selects its declared target. Under `one_of`,
  criterion routing takes precedence over raw confidence ranking.
- **Absent `branch_mode` becomes an import validation error**, preceded by a 060-style
  backfill migration for the three NULL DecisionPoints so existing pathways stay
  importable. The backfill reuses 060's documented heuristic: no `HAS_CRITERION` children →
  `all_of`, otherwise `one_of`.

**Mutation shape.** Answering a pending decision requires a DecisionPoint id, which
`answerGateQuestion(sessionId, gateId, answer)` cannot express. Generalise it to
`answerPendingDecision(sessionId, nodeId, answer)` and **drop the old name outright**. No
users means no deprecation window, and an alias is exactly the debt this work exists to
remove. `prism-admin-dashboard` call sites move with it.

---

## W4 — Per-branch routing for question gates

**Problem.** `evaluateQuestion` is presence-only for NUMERIC and SELECT: any value opens the
gate. A question can gate a subtree but cannot route between branches, so authors express
multi-way clinical questions as chains of boolean gates.

**Change.** Question gates adopt the LLM gate's existing `branches: [{name, target}]`
vocabulary plus an answer→branch map:

- BOOLEAN — two branches, mapped by true/false.
- SELECT — option→branch.
- NUMERIC — ordered, non-overlapping ranges→branch. The concrete range shape is a plan-level
  decision, but it must be **total**: every possible answer maps to exactly one branch, and
  import rejects a map with a gap or an overlap. A numeric answer that falls through to
  nothing is the presence-only bug in a new costume.

Presence-only semantics are retired. This reuses a shape already proven in the LLM gate
rather than inventing a third branching vocabulary, and it gives question and LLM gates one
branch concept — the defensible part of the memo's unification, taken incrementally.

---

## Testing

- **W0** — assert the 9 known scorer failures as the baseline, not suite-green. Prove `v1`
  is the default via the resolution context, not by reading the constant.
- **W1** — a gate whose datum is missing reports `indeterminate` with a reason; a gate whose
  condition is definitely false does not. This pair is the spec's central distinction and
  needs a direct test.
- **W2** — indeterminate + `'ask'` pends; indeterminate + `'default'` takes
  `default_behavior`; definite-false never escalates under either. Two gates on one datum
  produce one question. An injected answer resolves every gate reading that datum.
- **W3** — `one_of` with two qualifiers pends and traverses nothing; with one qualifier
  auto-selects. `SELECTS_BRANCH` beats confidence ranking. The backfill migration is
  idempotent.
- **W4** — each answer type routes to its mapped branch; an unmapped answer is a validation
  error at import, not a silent fallthrough.

Live-data proof for W2 and W3 uses `anemia-in-pregnancy-v1` v1.4, the only ACTIVE pathway.

## Risks

**Sparse-chart resolutions become substantially more interactive.** W2's escalate-by-default
and W3's pend-on-ambiguity are both intended, and both will look like regressions before
they look like fixes. The anemia pathway goes from near-silent to asking several questions.
Expect this and do not "fix" it by softening the defaults.

**W2 is the largest piece.** Synthetic-fact injection touches the patient-context assembly,
the temporal fact store, retraversal, and the audit trail. It should be its own plan and
probably its own review pass.

**W0 and W3 land behaviour changes on the same pathway.** The anemia pathway is both the v1
flip's main exercise and the holder of 7 `one_of` DecisionPoints. Sequence the plans so the
flip is proven before W3's enforcement is layered on it.

## Out of scope

- The `resolve_from` source chain and the unified `Decision` node.
- Removing `legacy-v0`.
- LOINC coding for the vaginitis lab nodes, and re-modelling its three `prior_node_result`
  diagnosis gates (tracked separately; requires clinical input).
- The 9 pre-existing confidence-scorer failures.
