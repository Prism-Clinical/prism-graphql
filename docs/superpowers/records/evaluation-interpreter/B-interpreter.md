# B — Interpreter core: writers, scheduling, semantics, dependencies, overrides

Code: `prism-graphql` main @ `d377465` (= live). Paths below are relative to
`apps/pathway-service/src/services/resolution/` unless stated. `TE` = `traversal-engine.ts`,
`GE` = `gate-evaluator.ts`.

**Evidence levels.** **[PROBE n]** = reproduced by running the live-built engine
(`/home/claude/workspace/prism-graphql/apps/pathway-service/dist`, built from d377465) in a
scratch script: `probes/probeB.js`, `probeB3.js`, `probeB4.js`. Those scripts are
read-only, touch no DB and write nothing to the repo. Anemia probes use the exported graph
`probes/graphs/a1774566-….json` with its export edge order. That order may differ
from the live loader's order, which is **unverified**. The live `after.txt` record agrees with
the probe on every node checked. **[CODE]** = read from source only. **[TEST]** = asserted by an
existing test. **[SPEC]** = stated in a design doc.

---

## 0. Top-line findings

1. **Multi-parent nodes defeat gating (confirmed, live).** A Stage's `HAS_STEP` enqueues every
   Step unconditionally. So a Step that is also a gate's `BRANCHES_TO` target is written
   INCLUDED by whichever arrival is disposed first, and a later closing sweep skips it.
   - Anemia 1.4 with Hb 9.4: `gate-severe-anemia=GATED_OUT`, `step-3-3=INCLUDED`,
     `proc-1=INCLUDED`, parent `stage-3` [PROBE 1a; live `after.txt:48`].
   - Moving the stage's `HAS_GATE` edge ahead of the `HAS_STEP` edges gives
     `step-3-3=GATED_OUT` [PROBE 1b]. The result depends on edge order.
   - The same pattern nullifies both anemia threshold gates (`step-2-2` stays INCLUDED at
     Hb 12.5 [PROBE 1d]) and the dp-1 fork (§3.2).
2. **Order dependence through eager `prior_node_result` (confirmed).** A gate that reads a
   dependency before the dependency's real guard closes sees the provisional INCLUDED. It
   routes on that, and its decision is never revisited.
   - Same graph, root edge order swapped: `gate-dep` flips between INCLUDED and GATED_OUT, and
     its medication with it [PROBE 2].
   - The existing `eager-reachability.test.ts:108` only asserts that the gate is "defined".
3. **Overrides on routing nodes open every arm (confirmed).** Held-arrival (`TE:527-537`) enqueues
   ALL outgoing edges.
   - INCLUDE on a `one_of` DecisionPoint opens both arms, with no pending question and no red
     flag [PROBE 3b].
   - **EXCLUDE** on a DP or a multi-branch gate also opens both arms: the node is EXCLUDED but
     its children are INCLUDED [PROBE 3c/3e].
4. **"First-writer-wins" means first WRITE, not first arrival.** Queue entries are not writes,
   so a closing gate at the same BFS depth wins [PROBE 4/4c]. Only a strictly shallower open
   path (or an earlier FIFO position) keeps the node INCLUDED [PROBE 4d]. Diamonds are resolved
   by queue position.
5. **Eager evaluation leaks side effects.**
   - Duplicate pending questions [PROBE 6].
   - Stale PENDING arms plus a pending question for a DecisionPoint that was later swept
     GATED_OUT [PROBE 8].
   - Provisional nodes are never cleaned up when unreached [PROBE 7].
   - Cycle verdicts are erased by re-disposition [PROBE 10].
6. **Other confirmed defects:**
   - A DP's unchosen-arm write overwrites a held override and erases `providerOverride`
     [PROBE 18].
   - A pending DP drops its non-branch children from state (`crit-1a/1b` and
     `gate-iron-deficient` are absent live) [PROBE 1c/14].
   - An unknown `branch_mode` fails OPEN to any_of [PROBE 15].
   - Default-traverse on a multi-branch gate opens all arms with no flag [PROBE 5].
   - A null-padded question answer reads as "no" [PROBE 12].

---

## 1. Every writer of node status

The engine is the only writer during traversal. After traversal, `pipeline/disposition.ts:36-50`
(`applyDisposition`) rewrites `status` for safety-suppressed INCLUDED Medications and splits
`eligibility` from `disposition`. `session-store.ts:39` only deserializes. Nothing else writes
[CODE: grep of `resolutionState.set` across `src/`].

In the table, "Guard" is what prevents overwriting an existing entry.
- *entry* = only reached when the node is not already in state: main loop `TE:541`, eager
  `TE:1328`.
- *P* = provisional (written by eager evaluation).
- *H* = held (a provider override).

| # | Site | Condition | Status written | Guard | Provisional handling |
|---|---|---|---|---|---|
| W1 | `TE:472` override pre-seed | Every override whose node exists | INCLUDED / EXCLUDED per `action`; `confidence=originalConfidence`, `depth 0`, no parent | none; runs before the walk | adds to H |
| W2 | `TE:497` delete | Walk pops a P node | deletes the entry, then re-disposes it | — | removes from P |
| W3 | `TE:509` timeout | `Date.now()-start > 10 000ms` at pop | TIMEOUT for the popped id and every queued id | skips if in state (P and H entries are kept as they are) | none |
| W4 | `TE:530-531` held arrival | Walk pops an H node | mutates `parentNodeId`/`depth` only; enqueues ALL children | — | removes from H |
| W5 | `TE:629` gate cycle | `prior_node_result` dep found in `evaluationStack` | `UNKNOWN` (default traverse) or `GATED_OUT` (anything else) | entry | — |
| W6 | `TE:643` markSubtree | cycle + skip | GATED_OUT subtree | see W16 | — |
| W7 | `TE:687` gate open | `satisfied` OR (multi-branch AND decision≠null) | INCLUDED, conf 1 | entry | — |
| W8 | `TE:764` markBranchNotSelected | multi-branch gate, arm not in `selected` (all arms if unroutable) | EXCLUDED arm + subtree | see W17 | — |
| W9 | `TE:782` + `TE:799` | question gate, no answer | PENDING_QUESTION gate + subtree | entry / W16 | — |
| W10 | `TE:821` + `TE:839` | unsatisfied, and `unresolvedAsk` ≠ null (indeterminate/dataUnavailable, `on_unresolved`≠'default', askable condition) | PENDING_QUESTION gate + subtree | entry / W16 | — |
| W11 | `TE:878` + `TE:892` | unsatisfied, not asking, `String(default_behavior).toLowerCase() !== 'traverse'` | GATED_OUT gate + subtree | entry / W16 | — |
| W12 | `TE:896` | unsatisfied, default traverse | INCLUDED, **conf 0**, enqueues ALL children | entry | — |
| W13 | `TE:1069` + `TE:1091` + `TE:1104` | DP `one_of`, and (>1 qualifier or stale choice), and not (stale with no alternative) | PENDING_QUESTION DP, each arm, and each arm's subtree | arms: skipped if `resolutionState.has` (so P and H arms are **not** overwritten) | — |
| W14 | `TE:1125` | every other DP outcome | INCLUDED, conf 1 | entry | — |
| W15 | `TE:1148` + `TE:1162` | DP arm not in `includedBranches` | EXCLUDED arm (conf = score, reason) + subtree | `enqueueable`: absent, P **or H** → **overwrites a held override** (D-9) | — |
| W16 | `TE:264` `markSubtree` | callers above | given status, `confidence 0`, reason, `parentNodeId` = the sweeping node | skip if already marked; skip if in state and not P/H; H → no write, but descends through it | removes from P; BFS; returns the marked set |
| W17 | `TE:157` `markBranchNotSelected` | caller W8 | EXCLUDED + reason naming the gate | `TE:141` same as W16; H → no write, sweeps its children | removes from P |
| W18 | `TE:1202` | Stage / Step / Pathway | INCLUDED, conf = score; enqueues ALL children | entry | — |
| W19 | `TE:1241` | action types `Medication, LabTest, Imaging, Procedure, Guidance, Monitoring, Lifestyle, Referral` (`types.ts:572`) | INCLUDED if `mandated` or score ≥ `suggestThreshold`, else EXCLUDED; enqueues ALL children | entry | — |
| W20 | `TE:1280` | every other type: Criterion, CodeEntry, EvidenceCitation, **Schedule, QualityMetric**, and unknown types | INCLUDED, conf 1; enqueues ALL children | entry | — |
| W21 | `TE:1341-1342` `evaluateNodeEagerly` | `prior_node_result` dep absent from state | whatever `disposeNode` writes, using a throwaway queue; then the root is marked P | `has` → return; timeout → return (dep stays absent) | the **root only** is added to P |
| W22 | `pipeline/disposition.ts:44-48` | INCLUDED Medication with a SUPPRESS finding | `status` EXCLUDED, `withheldBy: 'safety'` | post-traversal | not visible to `prior_node_result` (spec C2) |

Notes:
- **Only the eager root is provisional.** Sweeps performed *during* an eager disposition
  (W6, W8, W9–W11, W13, W15) write **permanent** entries. That is the root cause of D-5 and D-6.
- **Not provisional-aware:** W13's arm guard is `has()`, so a P arm keeps its eager status under
  a pending DP. W3 also keeps P entries.
- `mandated` (`TE:992`) is add-only, including from an eager disposition.

---

## 2. Scheduling algorithm (exact)

**Entry.** `pipeline/evaluate.ts:57-66` is the **only** caller. Every mutation re-runs a full
traversal. There is no incremental path left (spec 2026-09-13 §1 rule 2). Confidence is
precomputed for the whole graph (`evaluate.ts:45-52`), so `computeNodeConfidence` is a pure
lookup, and scoring is order-independent.

**Root.** The root is the first node with `nodeType === 'Pathway'` in `allNodes` (`TE:450`).
With no root, the result is empty and `isDegraded` [TEST `traversal-engine.test.ts:314`].

**Queue.** One FIFO array of `{nodeIdentifier, parentNodeId, depth}`, starting as
`[root, depth 0]` (`TE:464`). There is no visited set on the queue: a node can be enqueued
several times. What stops it being disposed twice is memoization on `resolutionState`.

**Per pop** (`TE:487-552`):
1. If the node is P: delete its state entry and clear the flag (W2).
2. Timeout check (W3). Uses `Date.now()` against `TRAVERSAL_TIMEOUT_MS = 10_000`
   (`types.ts:562`). On timeout, every queued id is stamped TIMEOUT with the popped
   entry's `parentNodeId`/`depth`, which is wrong for all but one of them [CODE]. Then
   `break`. Nodes never enqueued stay absent. Readiness still blocks, via `isDegraded`
   (`pipeline/readiness.ts:28-30`). The check runs only between pops, never during a long
   `await` such as an LLM gate [CODE].
3. If the node is H: record its parent and depth, and enqueue each child that is absent, P or H
   (W4). **No routing is applied**, whatever the node type.
4. If `resolutionState.has(id)`: skip. This is the "first-writer-wins" comment at `TE:540`.
5. Otherwise `disposeNode`.

**Enqueue predicate** (`TE:600`): `enqueueable(id) = !has(id) || P.has(id) || H.has(id)`.

**Children followed, by disposing node type.** The engine never inspects `edgeType`, except
`BRANCHES_TO` (and `HAS_CRITERION`/`SELECTS_BRANCH` for DP wording).

| Disposer | Edges followed |
|---|---|
| Pathway / Stage / Step (W18) | ALL outgoing edges |
| Action node (W19), even when EXCLUDED | ALL. So `HAS_CODE`, `ESCALATES_TO` and `CITES_EVIDENCE` children are disposed on their own account. Live: `code-rxnorm-310965` is INCLUDED under EXCLUDED `med-1` (`after.txt`). `ESCALATES_TO` has no escalation semantics: `med-2` is scored like any sibling [CODE]. |
| Other (W20) | ALL |
| Gate, open, `routes=false` (≤1 `BRANCHES_TO`) | ALL |
| Gate, open/decided, `routes=true` | the selected `BRANCHES_TO` arm (exactly one match, else none) plus ALL non-`BRANCHES_TO` edges [TEST `branch-routing.test.ts:122`] |
| Gate, default traverse (W12) or cycle+traverse | ALL, **including every `BRANCHES_TO` arm** (D-7) |
| Gate, closed / pending | none; subtree swept instead |
| DP, INCLUDED (W14) | included arms, then ALL non-`BRANCHES_TO` edges (`TE:1185-1191`) |
| DP, PENDING (W13) | **none**, and non-branch children are neither enqueued nor swept (D-8) |

**Order.** BFS by depth. Within a depth, order is the order the parents were popped, then each
parent's `outgoingEdges()` array order. That array order is the loader's, which is not sorted
by anything the engine controls [CODE, **unverified** for the live loader]. Sweeps
(`markSubtree`) run synchronously inside a disposition, so a sweep "happens" at the sweeping
gate's queue position and overtakes any queued-but-undisposed entry below it.

**Multi-parent nodes.** A node is decided by whichever comes first: (a) its own queue entry
being popped, or (b) a sweep from any parent. Everything after is skipped (`TE:541`, `TE:247`,
`TE:141`). There is no join or meet over parents. Consequences:
- **Open parent reaches first → INCLUDED despite a closed gate parent.** Live `step-3-3`
  [PROBE 1a], `step-2-2` [PROBE 1d], `step-2-3`/`step-3-1` under a pending or decided dp-1
  (§3.2), and a medication reached by both a Step and a pending question gate [PROBE 17].
- **Closing gate at equal depth, earlier FIFO → GATED_OUT, even though the open path
  "reached" it first** [PROBE 4, 4c]. The comment "the first path to evaluate it determines
  its status" (`TE:242-244`) is accurate only if "evaluate" means *write*.
- Spec 2026-09-13 does not specify join semantics for multi-parent nodes. No test covers a
  Stage-HAS_STEP plus gate-BRANCHES_TO node. **Classification:** defect in effect (a clinical
  gate is nullified). The code comment calls it "design", so it is intended-as-implemented but
  never reasoned about for this shape.

**Depth / parent.** Taken from the first writer. Sweeps stamp `parentNodeId` = the sweeping
node and a BFS depth relative to it. `care-plan-projection.ts:200-213` relies on the sweep's
`parentNodeId` for gate attribution [CODE].

---

## 3. Semantics as implemented

### 3.1 Gate (`TE:604-916`, `GE:1721-1753`)

**Evaluation per `gate_type`.** `evaluateGate` asserts deps and the policy version, then
switches:

| gate_type | `satisfied` | Other outputs | Notes |
|---|---|---|---|
| `patient_attribute` (`GE:1194`) | the condition evaluator (legacy-v0 or kernel, per `temporalPolicyVersion`) | `indeterminate`, `uncertainty`, `dataUnavailable` under the `v1` kernel only | no condition → false |
| `question` (`GE:1225`) | boolean → `=== true`; numeric → **any** non-null value → true; select → any option → true; else false | — | Checks `!== undefined`, so an explicit `booleanValue: null` counts as "answered no" and never reaches the select check. `decisionValueOf` (`decision-value.ts:37`) skips null. The two diverge (D-12). |
| `prior_node_result` (`GE:1283`) | every `depends_on[i]`: `state.get(node_id).status === status`, compared as strings | none | absent → `NOT_FOUND` → false. A PENDING dep → false, so default_behavior applies, not pending [PROBE 9]. Reads pre-disposition status, consistent with spec C2. |
| `compound` (`GE:1385`) | AND=`every`, OR=`some` | `indeterminate` / `dataUnavailable` per the D5 truth table (`GE:1317-1383`); `unresolvedConditions` | `operator` defaults to AND |
| `llm_text_analysis` (`GE:1518`) | **always true** when branches exist | `tentative` when there is no evaluator, the call failed, or confidence < `confidence_threshold` (default 0.75); `chosenBranch` = the safe default when tentative | no branches → false |
| unknown | false | — | then default_behavior |

**Routing (`TE:671-774`).**
- `decision = decisionValueOf(answer, chosenBranch)`. Precedence: boolean → finite numeric →
  non-empty select → LLM `chosenBranch`. A provider answer beats the LLM
  [TEST `branch-routing.test.ts:304-386`].
- `routes = count(BRANCHES_TO) > 1`. `decided = routes && decision !== null`.
- A gate opens (W7) if `satisfied || decided`. So a multi-branch "no" routes to its
  `{equals:false}` arm [TEST `branch-routing.test.ts:173`].
- Arm selection: `parseBranchWhen(edge.properties.when)` plus `decisionSelects`. Equality is
  kind-matched and ranges are half-open `[gte, lt)`.
- Exactly one match → take it. Zero or ≥2 → take **no** arm and raise the red flag
  `unroutable_decision`. That includes a satisfied `patient_attribute` gate with multiple arms
  and no decision [TEST `branch-routing.test.ts:198-234`, `:387-433`].
- **Unselected arms** go through `markBranchNotSelected` (W17). They are EXCLUDED only if not
  already written. So an arm already INCLUDED via another parent stays INCLUDED.
- **Single-target gates:** everything is enqueued. `when` is ignored
  [TEST `branch-routing.test.ts:280`].

**Not satisfied, not decided** (`TE:775-913`). The branches below are checked in order:
1. **Question with no answer** → PENDING gate and subtree, plus a `PendingQuestion` with
   `answerType = answer_type ?? BOOLEAN`. No dedup [TEST `traversal-engine.test.ts:179`].
2. **`unresolvedAsk`** (`TE:89-121`). Requires `indeterminate || dataUnavailable`, and
   `on_unresolved !== 'default'` (absent means ask), and `askFor(condition, codeMap)`
   non-null.
   - Result: PENDING gate and subtree. The question is deduped by `datumKey`, and later
     askers are appended to `askedByNodeIds` [TEST `escalate-on-unresolved.test.ts`].
   - Only the `v1` kernel emits these signals. Under `legacy-v0` this branch is dead [CODE].
3. **Default skip.** Any `default_behavior` other than the string `traverse`
   (case-insensitive) → GATED_OUT and subtree. This fails closed
   [TEST `eager-disposition-parity.test.ts:159`].
4. **Default traverse** → the gate is INCLUDED with **confidence 0**, and all children are
   enqueued. Live example: `gate-oral-iron-response INCLUDED conf=0.000`.
   - On a multi-branch gate this **opens every arm** with no red flag [PROBE 5] (D-7). This is
     the same case the satisfied path flags as `unroutable_decision`.

A question answered "no" on a **single-target** gate falls into step 3 or 4. So "no" plus
`default_behavior: traverse` opens the subtree [CODE]. **Ambiguous:** nothing documents what
"default" means for an answered question.

**Tentative LLM** (`TE:702-717`). The gate is INCLUDED and routed on the safe default. A SELECT
`PendingQuestion` is pushed with `tentative*` fields when the gate has no stored answer.
Readiness turns it into a blocker (`readiness.ts:32-36`).

**Cycle** (`TE:609-655`). When a `depends_on` id is absent from state:
- If the id is already in `evaluationStack`, that is a cycle. The gate writes W5: status
  **UNKNOWN** for traverse, which counts as INCOMPLETE for readiness, or GATED_OUT for skip.
- Otherwise the gate pushes itself onto the stack and eagerly evaluates the dependency (W21).

See D-6 for how the cycle verdict is lost.

### 3.2 DecisionPoint (`TE:919-1193`)

- **Scoring.** Each `BRANCHES_TO` target is scored. A branch qualifies if its score is ≥
  `suggestThreshold`. The exclusion reason is the author's `SELECTS_BRANCH` criterion
  descriptions if any, otherwise a confidence message [TEST `branch-mode.test.ts:396-460`].
  - `SELECTS_BRANCH` **does not select anything** (`TE:926-931`). Spec W3 says "a satisfied
    Criterion selects its declared target… takes precedence over raw confidence ranking"
    (2026-08-30 §W3). That is a **spec/impl divergence**; possibly an intentional deferral,
    since the code comment calls it a "capability". Criteria are never evaluated at all: they
    get W20 INCLUDED, conf 1.
- **`branch_mode`:**
  - Absent → `one_of` [TEST `branch-mode.test.ts:130`].
  - `all_of` (exact string) → every arm is included and added to `mandated`. Weak arms raise
    the `all_of_branch_unsupported` red flag. It never pends
    [TEST `branch-mode.test.ts:258-380`]. The mandate reaches only the direct target, not
    grandchildren [TEST `:351`].
  - **Any other value** (`any_of`, `ALL_OF`, typos) behaves as any_of: every qualifier is
    included, with no pending question [PROBE 15].
  - Import validation refuses invalid modes (`import/validator.ts:640-654`), but stored graphs
    are not re-checked here. Unknown values fail **open**, which is the opposite of gates
    (D-10).
- **Stored choice** (`gateAnswers.get(dpId).selectedOption`, a branch **target id**). Only
  honoured for `one_of`:
  - Choice qualifies → narrowed to it [TEST `:145-200`].
  - Choice no longer qualifies → "stale": re-pend with the remaining qualifiers
    [TEST `:217`, `:249`].
  - Stale with no alternative → no pend; all arms EXCLUDED plus `all_branches_excluded`
    [TEST `:234-248`].
- **Auto-resolve.** Exactly one qualifier → take it [TEST `:90`; PROBE 16]. There is no use of
  `autoResolveThreshold` anywhere in the engine: the threshold is only passed through [CODE].
- **Pending** (W13). The DP, each arm and each arm's subtree get PENDING. The question lists
  `options = includedBranches` (ids) and `optionLabels` (titles). Nothing is traversed.
  **Non-branch children are left absent** (D-8).
  - Live dp-1: `crit-1a`, `crit-1b` and `gate-iron-deficient` are missing from `after.txt`,
    and PROBE 1c/14 agree. This contradicts the invariant claimed at `TE:1084-1086`.
- **Excluded arms** (W15) are written only if enqueueable, which also means **a held arm is
  overwritten** (D-9).
- **Arms reached via another parent ignore the DP entirely.** Live anemia (both routes
  [PROBE 13/13b]):
  - `step-2-3` and `step-3-1` hang off Stage `HAS_STEP` edges, so both arms are INCLUDED while
    dp-1 is PENDING [PROBE 1c].
  - Choosing `step-2-3` still leaves `step-3-1 → med-1 → med-2` (the oral-iron arm) INCLUDED
    [PROBE 13b].
  - Spec W3 promised "traverse none until answered" and "exactly one branch may be taken".
    That holds only for arms with no other parent. **This is a defect** (same class as D-1).
- **Red flag `all_branches_excluded`** when there are branches but zero were included
  [TEST `traversal-engine.test.ts:244`].

### 3.3 Structural nodes

Pathway, Stage and Step (`STRUCTURAL_NODE_TYPES = {Stage, Step}`, plus `Pathway`) are always
INCLUDED if disposed, with the aggregate score as confidence, and **all children are
enqueued**. They are the reason the D-1 bypass exists: a Stage cannot not-open a Step.

### 3.4 Action nodes

The action types (`types.ts:572`) are Medication, LabTest, Imaging, Procedure, Guidance, plus
the forward-looking Monitoring, Lifestyle and Referral.
- Status is INCLUDED if mandated or score ≥ `suggestThreshold`, else EXCLUDED
  [TEST `traversal-engine.test.ts:96`].
- `critical: true` with `data_completeness` = 0 raises the red flag `missing_critical_data`.
- Children are always enqueued, even from an EXCLUDED node (§2).
- **Schedule and QualityMetric are NOT action types.** They take the W20 path: INCLUDED at
  conf 1 whenever reached (live `sched-*`, `qm-*`). Readiness's `EMPTY_PLAN` check also
  ignores them (`readiness.ts:54`). **Ambiguous:** probably intentional (they are
  informational), but not documented.

### 3.5 Criterion, EvidenceCitation, CodeEntry and other types

These take W20: INCLUDED at conf 1, with all children enqueued
[TEST `traversal-engine.test.ts:291`]. Their status says only "reached". A CodeEntry under an
EXCLUDED action is INCLUDED (live `code-cpt-82728` under `lab-2`). The care-plan projection
must not read CodeEntry status as eligibility **(unverified whether it does)**.

---

## 4. Dependencies, eager evaluation, provisional state

**Mechanism** (`TE:1322-1344`, W21).
- A `prior_node_result` gate eagerly disposes each absent dependency through the same
  `disposeNode` [TEST `eager-disposition-parity.test.ts`].
- It uses a **throwaway queue**, so the dependency's children are not opened, and marks only
  the dependency root as P.
- When the walk arrives, the P node is deleted and re-disposed with the real queue
  [TEST `eager-disposition-parity.test.ts:145`].
- A closing sweep may overwrite a P node [TEST `eager-reachability.test.ts:88-106`].

**Defects:**

- **D-2: order dependence (confirmed).**
  - Graph: `root → {gate-dep, gate-closed}`, where `gate-dep` depends on `step-hidden`
    INCLUDED and `gate-closed` guards `step-hidden`.
  - Result [PROBE 2]:
    - dep-first: `gate-dep=INCLUDED, med-dep=INCLUDED, step-hidden=GATED_OUT`.
    - closed-first: `gate-dep=GATED_OUT, med-dep=GATED_OUT`.
  - The gate's verdict is based on a provisional status that is later overwritten, and is
    never re-evaluated.
  - The existing test (`eager-reachability.test.ts:108-111`) asserts only `toBeDefined`, so it
    passes for the wrong reason.
  - Root cause: eager evaluation answers "what would this node be if reached?", while
    `prior_node_result` needs the final eligibility. There is no fixpoint or second pass.
- **D-5: eager side effects are not provisional (confirmed).**
  - Every `pendingQuestions.push`, `redFlags.push` and `mandated.add` during an eager
    disposition is kept. So is every sweep, whose written nodes are *not* provisional.
  - (a) An eagerly-disposed unanswered question is pushed twice: `pendingQuestions` gateIds =
    `['q','q']` [PROBE 6]. Datum-keyed asks dedup but append the same id twice to
    `askedByNodeIds` [CODE]. The same applies to tentative LLM questions and DP red flags
    [CODE]. `resultHash` sorts but does not dedup (`evaluate.ts:122-127`).
  - (b) A DP eagerly pended, then swept GATED_OUT by its real guard, leaves:
    `dp=GATED_OUT`, arms `a`/`b`/`ma` still PENDING_QUESTION, and a pending question for `dp`
    [PROBE 8]. `readiness.ts:32-36` then blocks on an unreachable decision. The arms stay
    PENDING because `markSubtree` skips non-P entries.
  - (c) An LLM gate eagerly disposed then re-disposed calls the evaluator twice. Whether
    `observations.evaluator` memoizes per gate is **unverified** (area of the pipeline agent).
- **D-6: cycle verdict erased (confirmed).**
  - Case: `ga ↔ gb` with default traverse.
  - `gb` (eager) gets cycle UNKNOWN. `ga` reads UNKNOWN, is unsatisfied, and takes the
    default: INCLUDED. The walk then re-disposes `gb`, which sees `ga` INCLUDED, no cycle, so
    INCLUDED. Final: both INCLUDED, no reason, no UNKNOWN, no DEGRADED [PROBE 10].
  - The detected cycle leaves no trace. Which gate "wins" depends on BFS order.
- **D-11: unreached dependency stays provisional (confirmed).**
  - A dependency never reached nor swept (an orphan, or below a node the walk never
    disposes) keeps its eager status in the final result [PROBE 7: `orphan=INCLUDED`].
  - The result does not expose P, and nothing strips P entries at the end of `traverse`.
  - Its parent/depth are also the *gate's* (`TE:620` passes the gate's `parentNodeId`/`depth`)
    [CODE].
- **Dependency pending.** A dependency that is PENDING_QUESTION makes the depending gate take
  `default_behavior` (GATED_OUT under skip), with reason "Unmet dependencies…" [PROBE 9].
  It does not pend itself. **Ambiguous:** probably wrong (it answers "no" to "not yet known"),
  and `unresolvedAsk` cannot fire because `prior_node_result` never sets
  `indeterminate`/`dataUnavailable`.
- **Eager timeout.** When the budget is spent, `evaluateNodeEagerly` returns early. The gate
  then reads NOT_FOUND → unsatisfied → default_behavior [CODE].
- **Eager sweeps are permanent.** If an eager disposition closes (sweeping its subtree
  permanently) and the walk-time re-disposition would open, the children are not enqueueable
  and stay closed. This is reachable only when the dependency's own inputs differ between the
  two dispositions (e.g. via D-6). It was **not probed**.

---

## 5. Overrides

Pre-seeding and held handling are W1 and W4. Spec: "overrides keep today's meaning… a gate's
sweep still descends *through* it" (2026-09-13 §1 rule 3; §2 stage 3 at `:312`).

| Case | Behaviour | Classification |
|---|---|---|
| INCLUDE on an action / Step | pinned INCLUDED; children traverse [TEST `pipeline-traversal-overrides.test.ts:25`] | intended |
| INCLUDE on a node under a closed gate | node stays INCLUDED, subtree GATED_OUT [TEST `:37`]. A leaf med under a closed gate is INCLUDED with `parentNodeId` undefined, depth 0 [PROBE 11] | intended (override beats reachability). The missing parent is a projection hazard (**unverified** impact). |
| INCLUDE on a `one_of` DP | all arms INCLUDED; no pending question, no red flag [PROBE 3b] | **defect D-3**: violates W3's "exactly one" |
| INCLUDE on a multi-branch Gate | all arms INCLUDED [PROBE 3d] | **defect D-3** |
| EXCLUDE on a DP / Gate / Step | node EXCLUDED, **children still walked and INCLUDED** [PROBE 3c, 3e] | spec rule 3 says the override is about the node only, so "as designed". Clinically inverted for routing nodes: excluding a gate *opens* its arms. **Defect-in-effect, needs a decision.** |
| Override on an unchosen DP arm | W15 overwrites it with EXCLUDED; `providerOverride` is lost [PROBE 18] | **defect D-9**. `markBranchNotSelected` (W17) preserves held nodes; the DP path does not. |
| Held node never reached | stays at its W1 seed (depth 0, no parent). Counted in `totalNodesEvaluated`. | intended per rule 3 |
| `originalStatus` / `originalConfidence` | `originalConfidence` becomes the node's confidence (W1). `originalStatus` is carried on `providerOverride` only; the engine never reads it. The resolver keeps the pathway's first verdict across re-overrides (`resolvers/mutations/resolution.ts:249-257`). | intended |
| After safety | `applyDisposition` can still suppress an overridden INCLUDED medication (spec D4) | intended |

---

## 6. Pending questions, red flags, degraded

**`PendingQuestion` producers:**
- `TE:705` tentative LLM
- `TE:802` unanswered question (no dedup)
- `TE:853` unresolved datum (deduped by `datumKey`)
- `TE:1108` DP choice

Readiness counts a PENDING Gate/DP node, plus any queued question whose gateId is not already
counted (`readiness.ts:19-36`). Duplicates from D-5 therefore don't add blockers, but they
still appear in the output and the hash.

**Red flags:**
- `unroutable_decision` (`TE:740`)
- `all_of_branch_unsupported` (`TE:995`)
- `all_branches_excluded` (`TE:1170`)
- `missing_critical_data` (`TE:1261`)

Every unacknowledged flag blocks readiness (`readiness.ts:37-40`). Nothing dedups them (D-5).

**Degraded:**
- No root → `isDegraded`.
- Timeout → `isDegraded` plus TIMEOUT stamps.
- A cycle-traverse UNKNOWN makes the result DEGRADED (`INCOMPLETE` in `readiness.ts:4`), but
  D-6 usually erases it.
- `CASCADE_LIMIT`/`MAX_CASCADE_DEPTH` (`types.ts:563`) are never written by the engine. They
  are vestigial [CODE: no writer].

---

## 7. Defect register

| ID | Defect | Where | Evidence | Status |
|---|---|---|---|---|
| D-1 | Multi-parent join = first write. A Stage `HAS_STEP` bypasses the gate/DP `BRANCHES_TO` guard. | `TE:541`, `:247`, `:141`, `:1214-1218` | PROBE 1a/1b/1d/13; live `after.txt` (step-3-3, step-2-2, step-2-3, step-3-1 INCLUDED) | **Confirmed**, known |
| D-2 | Eager `prior_node_result` reads a provisional status and is never re-evaluated → order dependence | `TE:609-623`, `:1322-1344` | PROBE 2 | **Confirmed**, known |
| D-3 | Held arrival opens all edges: an INCLUDE (or EXCLUDE) on a DP or multi-branch gate opens every arm | `TE:527-537` | PROBE 3b-3e | **Confirmed**, known (EXCLUDE variant is new) |
| D-4 | "First-writer-wins" is decided by queue position, not by arrival or by a meet | `TE:242-247` | PROBE 4/4c/4d | **Confirmed**, known |
| D-5 | Eager side effects are not provisional: duplicate questions and flags; stale pending DP and arms | `TE:1341` + push sites | PROBE 6, 8 | **Confirmed**, new |
| D-6 | Cycle verdict erased by re-disposition | `TE:625-653` + `:495-498` | PROBE 10 | **Confirmed**, new |
| D-7 | Default traverse on a multi-branch gate opens all arms, with no flag | `TE:894-912` | PROBE 5 | **Confirmed**, new |
| D-8 | A pending DP drops its non-branch children (absent, not PENDING) | `TE:1121` | PROBE 1c/14; live `after.txt` lacks crit-1a/1b and gate-iron-deficient | **Confirmed**, new |
| D-9 | A DP's excluded-arm write clobbers a held override | `TE:1147` (`enqueueable` includes H) | PROBE 18 | **Confirmed**, new |
| D-10 | Unknown/miscased `branch_mode` fails open (any_of) | `TE:977`, `:984`, `:1033` | PROBE 15 | **Confirmed**; import blocks new graphs |
| D-11 | Unreached provisional stays in the final result | no cleanup after `TE:552` | PROBE 7 | **Confirmed**, new |
| D-12 | Explicit-null `booleanValue` reads as "no" in `evaluateQuestion`, but is skipped by `decisionValueOf` | `GE:1245` vs `decision-value.ts:42` | PROBE 12 | Confirmed in the engine; **unverified** whether any client sends explicit nulls (validator `answer-validation.ts:25` allows it) |
| D-13 | `SELECTS_BRANCH` does not route; Criteria are never evaluated | `TE:926-944` | CODE vs spec 2026-08-30 W3 | Spec divergence; intent **ambiguous** |
| D-14 | Timeout stamps every queued node with the popped entry's parent/depth; no check during awaits | `TE:501-523` | CODE | Minor, confirmed by reading |
| D-15 | A pending dependency collapses to "no" in `prior_node_result` | `GE:1297-1303` | PROBE 9 | Ambiguous |
