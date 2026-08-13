# Retraversal fidelity — the fixes that gate the `v1` flip

**Status:** spec / stub. Not a task plan. Enough to pick up cold; the task
decomposition is the first job of whoever takes it.

**Found by:** review of plan 04 (`2026-07-26-temporal-horizon-04-evaluator-kernel.md`),
recorded there as **P1-A** (defect 1) and in round 14 as **R14-3 / R14-4**
(defects 2 and 3).

**Blocks:** the `v1` rollout flip. **Does not block** merging plan 04.

---

## 0. Scope — why these are one plan

Retitled from "Gate-subtree retraversal" when the round-14 review added two more.
All three are the **same defect family**: *retraversal produces a different, or
less complete, result than initial traversal would have produced from the same
facts.* `TraversalEngine` and `RetraversalEngine` are two implementations of one
semantics, and nothing holds them to each other.

| # | Defect | Divergence |
|---|---|---|
| 1 | A gate flipping `GATED_OUT → INCLUDED` does not re-resolve its subtree | incomplete: the subtree keeps a status and a reason from a decision no longer in force |
| 2 | Answering an opening question DELETES its guarded subtree | destructive: nodes initial traversal created vanish from the session |
| 3 | Retraversal ignores `default_behavior` | contradictory: the same gate, on the same facts, means different things depending on WHEN it was evaluated |

All three are **pre-existing and version-independent** — see §2 of each. Plan 04
touches `traversal-engine.ts`, `retraversal-engine.ts` and
`resolvers/mutations/resolution.ts`, but only to thread the temporal deps: new
constructor parameters, a `gateDeps()` helper, and collapsing `evaluateGate`'s
positional arguments into the D6 options object. Every decisive line below is
byte-identical on `main`.

A fix should consider whether the durable answer is **one traversal
implementation with an incremental entry point**, rather than three separate
patches to the second implementation. That is a bigger question than any one
defect and is deliberately left open here.

---

## 1. Defect 1 — a flipped gate does not re-resolve its subtree

When a gate flips from `GATED_OUT` to `INCLUDED` during retraversal, **only the
gate row is updated.** The subtree that gate guards stays `GATED_OUT`, and the
gate itself keeps the `excludeReason` and `confidence` it was given while it was
out.

Concretely, for a pathway `root -> gate-1 -> step-1` where `gate-1` reads a lab
the session started without:

| | before `addPatientContext` | after | correct |
|---|---|---|---|
| `gate-1.status` | `GATED_OUT` | `INCLUDED` | `INCLUDED` |
| `gate-1.excludeReason` | `No numeric value found for labs:718-7` | *unchanged* | cleared |
| `gate-1.confidence` | `0` | *unchanged* | recomputed |
| `step-1.status` | `GATED_OUT` | *unchanged* | re-resolved |
| `step-1.excludeReason` | `Gated out by gate-1: No numeric value found for labs:718-7` | *unchanged* | cleared |

The session therefore reports a satisfied gate guarding a subtree that is still
excluded, for a reason that names a gate decision no longer in force.

### Evidence

- **`services/resolution/types.ts:65-75`** — `DependencyMap` declares
  `influences` and `influencedBy`; `createEmptyDependencyMap` initialises both
  to empty maps.
- **`services/resolution/traversal-engine.ts:127-133`** — `recordInfluence` is
  the *only* writer of `influences`. It has exactly two call sites:
  - **`:347`** — a gate's explicit `depends_on` entries
    (`dependedOnNodes`, produced at `gate-evaluator.ts:1211-1231`), recorded as
    *depended-on node → gate*.
  - **`:537`** — a `DecisionPoint` → each of its `BRANCHES_TO` targets.

  **Neither records a gate → the `HAS_CHILD` subtree it gates out.** That
  relationship exists only in the graph, never in the dependency map.
- **`services/resolution/retraversal-engine.ts:266`** — `retraverse` propagates
  a status change by reading `dependencyMap.influences.get(nodeId)`. With no
  gate→subtree entry there is nothing to enqueue, so the cascade terminates at
  the gate.
- **`services/resolution/retraversal-engine.ts:259`** — `existing.status =
  newStatus` is assigned with no accompanying reset of `existing.excludeReason`.
  Gates take the `else` branch at `:237` (`newStatus = gateResult.satisfied ?
  INCLUDED : GATED_OUT`), which likewise sets no reason. Only the action-node
  branch (`:247-256`) recomputes `confidence`.
- **`resolvers/mutations/resolution.ts:355`** — `overrideNode` reads the same
  `influences` map to build its affected set, so it has the identical blind
  spot. A provider manually including a gated-out gate has never re-resolved
  that gate's subtree either.

### The pinning test

`apps/pathway-service/src/__tests__/temporal/v1-traversal-behavior.test.ts`,
in `addPatientContext changes what a gate decides (the P1-2 flip test)` →
`re-resolves a previously unsatisfied gate once the new fact arrives`.

The block comment there marks it a **pinned known defect** and points back at
this file. It asserts today's defective behaviour — `influences.size === 0`,
`step-1` still `GATED_OUT` with its derived reason, `gate-1`'s stale
`excludeReason` — in the style of the D8 (`gate-evaluator-aggregate-kernel.test.ts:336`)
and R13-1/D10 (`temporal/resolution-fact-store-wiring.test.ts:601`) pins.

**When this plan lands, those four assertions INVERT.** They were written to be
flipped, not rewritten. Treat "the pin still passes unchanged" as evidence the
fix did not take.

---

### Why it is pre-existing, and why plan 04 surfaced it

**Pre-existing.** The gate→subtree edge has never been recorded by
`recordInfluence`, in any version, under any policy. `overrideNode` has read
`influences` for as long as it has existed and has never been able to re-resolve
a gated subtree. Nothing in plan 04 touched `recordInfluence`, `DependencyMap`,
or `RetraversalEngine`'s propagation.

**Why plan 04 surfaced it.** Plan 04 made the flip *reachable*. Before it, a
mid-session fact arriving through `addPatientContext` could not change a gate's
decision under the paths exercised: the fact store was empty in production and
`legacy-v0`'s window handling admitted the fact either way, so gates rarely
changed status on retraversal. Under `v1`, horizon and clinical status govern
selection, so a newly supplied in-horizon lab genuinely moves a gate from
unsatisfied to satisfied — and the missing cascade becomes observable.

Plan 04's own P1-2 flip test then over-claimed: it asserted the gate became
satisfied and stopped, which reads as "the session re-resolved" but proves only
"the gate row was rewritten". That gap is now closed by the pin, not by a fix.

---

### What a fix requires

Honestly scoped: **this touches the retraversal engine and the dependency map,
neither of which plan 04 modified.** It is not a follow-on to plan 04's work; it
is adjacent work in code plan 04 deliberately left alone. Do not treat it as a
small patch to the `v1` path — the defect is version-independent and the fix
must be too.

Three pieces, in dependency order:

1. **Populate `influences` with the gate→descendant relationship.**
   `TraversalEngine` already knows the subtree when it gates one out — it calls
   `markSubtree` (`traversal-engine.ts:80`) from four sites, three of them on
   the gate path: `:325` and `:437` (`GATED_OUT`), `:411` (`PENDING_QUESTION`),
   and `:533` (`EXCLUDED`, the DecisionPoint path). Record the same set through
   `recordInfluence` so retraversal can reach it — and note that the
   `PENDING_QUESTION` site means "gate resolved" is not only satisfied/unsatisfied.
   Decide deliberately whether to record the gate's *immediate*
   children and let the cascade walk down, or the *transitive* subtree in one
   entry; the first is smaller and interacts with `MAX_CASCADE_DEPTH` (10,
   `types.ts:436`), the second is flatter but duplicates graph structure into
   the map. Note the map is persisted and rehydrated
   (`session-store.ts:80,90`), so its shape is a storage-format change for
   live sessions.

2. **Re-resolve the guarded subtree when a gate's status changes.**
   `retraverse`'s existing propagation (`:266`) does the enqueueing once the
   entries exist, but the *nodes* being enqueued are ones that were `GATED_OUT`
   and are now reachable — verify they take a sensible branch at `:186-257`
   rather than being no-ops, and that `markSubtree`'s reason strings get
   replaced rather than layered.

3. **Reset the gate's `excludeReason` and `confidence` instead of leaving the
   old ones.** At `:259`, a status transition must clear the reason that
   justified the previous status. Today only action nodes recompute confidence;
   a gate that flips keeps `confidence: 0` from its excluded state.

**Do not change reason strings** as part of this. The strings are asserted
across the suite and are settled; the bug is that a stale one *survives*, not
that it is wrong.

---

## 2. Defect 2 — answering an opening question DELETES its guarded subtree

*(Round 14, R14-3. Verified against the code, not reasoned about.)*

When an answer OPENS a question gate, `answerGateQuestion` deletes every
`PENDING_QUESTION` / `GATED_OUT` node it reached from that gate, then hands the
same IDs to `RetraversalEngine` — which skips any ID that is not in
`resolutionState`. The nodes are never recreated. They **disappear from the
session**: not gated out, not pending, absent.

This is the destructive member of the family. Defect 1 leaves a stale row;
this one leaves no row. The nodes it removes are exactly the ones initial
traversal created via `markSubtree` (`traversal-engine.ts:411`), so the observable
effect is that answering a question SHRINKS the pathway the session reports.

### Evidence

- **`resolvers/mutations/resolution.ts:506-542`**, inside `answerGateQuestion`
  (declared `:443`). A BFS from `args.gateId` fills `affectedNodes`, then:

  ```ts
  // :534  Remove stale subtree nodes so RetraversalEngine re-evaluates them
  for (const nodeId of affectedNodes) {
    if (nodeId !== args.gateId && session.resolutionState.has(nodeId)) {
      const existing = session.resolutionState.get(nodeId)!;
      if (existing.status === NodeStatus.PENDING_QUESTION ||
          existing.status === NodeStatus.GATED_OUT) {
        session.resolutionState.delete(nodeId);
      }
    }
  }
  ```

  The comment states the intent. The code does the opposite of it.
- **`retraversal-engine.ts:186-187`** — `const existing = resolutionState.get(nodeId); if (!existing) continue;`
  is the decisive line. `RetraversalEngine` **never inserts**: it has no
  `resolutionState.set(...)` anywhere, only `existing.status = newStatus`
  (`:259`). A deleted node is dequeued, skipped, and not even counted in
  `nodesRecomputed` (`:196`).
- **`resolvers/mutations/resolution.ts:608-614`** — the shrunken map is written
  back, `totalNodesEvaluated: session.resolutionState.size` (`:613`) shrinking
  with it. The loss is persisted, not per-request.
- **`TraversalEngine` — the only thing that creates rows — is instantiated
  solely in `startResolution` (`resolution.ts:236`).** Nothing else in the
  session's lifetime can put the nodes back.

**Three scoping facts the finding's original phrasing did not carry:**

1. The deletion runs **only in the `gateOpened` branch** (`:495-497`, `:526`).
   The `else` branch (`:581-604`) mutates in place and deletes nothing. It is
   specifically the *opening* answer that destroys.
2. The BFS at `:511` follows **all outgoing edge types**, not just `HAS_CHILD`.
   A diamond-shared node reachable from elsewhere in the graph is deleted too,
   which makes the blast radius wider than "the gate's subtree".
3. Descendants in any other status (`INCLUDED`, `EXCLUDED`, `UNKNOWN`) survive
   and are re-evaluated normally. Only the two statuses named are destroyed.

### Why it is pre-existing

`main`'s `resolution.ts` carries the same delete loop at `:499-504`, and `main`'s
`retraversal-engine.ts` carries the same `if (!existing) continue`. Plan 04's
diff to both files is temporal-deps threading only.

### Fix direction

Two shapes, and the choice is the plan's first real decision:

- **Keep the rows and recompute.** Do not delete; let retraversal re-evaluate
  them in place. Requires `RetraversalEngine` to handle a node arriving as
  `PENDING_QUESTION`/`GATED_OUT` and produce the status initial traversal would
  have — which is defect 3's problem, so the two are entangled.
- **Invoke traversal logic that can MATERIALIZE nodes.** The honest version of
  what the `:534` comment claims. This is the "one traversal implementation with
  an incremental entry point" answer from §0, and it closes defects 1–3 together.

Whichever is chosen, `totalNodesEvaluated` and the persisted map must end up
describing the same graph the session started with.

---

## 3. Defect 3 — retraversal ignores `default_behavior`

*(Round 14, R14-4. Verified; the finding as originally stated was too narrow in
one direction and too absolute in another — both corrections below.)*

Initial traversal INCLUDES an unsatisfied gate whose `default_behavior` is not
`SKIP`. Retraversal has no notion of `default_behavior` at all and converts the
unsatisfied gate to `GATED_OUT`. **The same gate, on the same facts, means
different things depending on whether it was evaluated at session start or after
context changed** — the purest statement of this plan's family.

### Evidence

- **`traversal-engine.ts:422-450`** — `else if (gateProps.default_behavior === DefaultBehavior.SKIP)`
  … `else { /* Default traverse — include anyway */ … status: NodeStatus.INCLUDED }`.
- **`retraversal-engine.ts:236-238`** — `else { newStatus = gateResult.satisfied ? NodeStatus.INCLUDED : NodeStatus.GATED_OUT; }`.
- **`retraversal-engine.ts` never imports or mentions `DefaultBehavior`.**
  `traversal-engine.ts:13` does. That single asymmetry is the whole defect.

**Two corrections to the finding as filed:**

1. **"Retraversal ALWAYS converts an unsatisfied non-question gate to
   `GATED_OUT`" is false.** Two branches run first: a tentative LLM gate becomes
   `INCLUDED` at `:210-213`, and `:226` catches any gate carrying `prompt` and
   `answer_type`. Only a gate with neither reaches `:237`. The defect is real;
   its reach is narrower than stated.
2. **The traversal side is BROADER than `default_behavior: TRAVERSE`.** `:422`
   tests only for `SKIP`; everything else falls to the `else`. `DefaultBehavior`
   is `{ SKIP, TRAVERSE }` (`src/types/index.ts:178-181`), so a gate with a
   **missing or undefined** `default_behavior` is also INCLUDED initially and
   `GATED_OUT` on retraversal. The surface is "everything except `SKIP`".

**A fourth divergence found while verifying this one, and not previously
recorded:** the two engines decide *what a question is* differently. Initial
traversal tests `gateProps.gate_type === GateType.QUESTION`
(`traversal-engine.ts:389`); retraversal tests for the presence of `prompt` and
`answer_type` (`retraversal-engine.ts:226`). A gate can therefore be a question
to one engine and not to the other. This is the same root as the unenforced
answer contracts recorded in `2026-08-12-resolution-subsystem-gaps.md` §2 —
`answer_type` is load-bearing in one place and decorative in another — and a fix
should reconcile the two engines and that file's §1 in one pass rather than
twice.

**A fifth, adjacent:** traversal's non-`SKIP` path QUEUES the gate's children
(`:452-456`), while retraversal's `GATED_OUT` at `:237` propagates only through
`dependencyMap.influences` (`:266`) — which defect 1 establishes is empty for
gate→subtree. So the gate flips out and its subtree is not consistently gated
out either. Defects 1 and 3 meet here.

### Why it is pre-existing

`main`'s `retraversal-engine.ts` has the identical `newStatus = gateResult.satisfied ? INCLUDED : GATED_OUT`
at its `:196`, and the same absence of any `DefaultBehavior` import.

### Fix direction

Retraversal must apply the same gate-disposition rule as traversal, from **one**
function that both engines call, rather than a second implementation of it.
Include `gate_type` vs `prompt`/`answer_type` question-detection in that shared
rule — reproducing today's two answers in one function would just relocate the
divergence.

Note the live-session consequence: sessions created before the fix contain rows
whose status the new rule would not have produced. Same class of question as §5.4
and as the migration-064 decision open on plan 04.

---

## 4. The blocking relationship, precisely

**It does not block merging plan 04.** Nothing on that branch routes to `v1`:

- `resolveTemporalPolicyVersion` (`resolvers/helpers/resolution-context.ts:82`)
  returns `ctx.temporalPolicyVersion ?? DEFAULT_TEMPORAL_POLICY_VERSION`.
- `DEFAULT_TEMPORAL_POLICY_VERSION` is `'legacy-v0'`
  (`services/resolution/temporal/evaluation-context.ts:219`).
- The context field is populated once, in `index.ts:70`, from
  `process.env.TEMPORAL_POLICY_VERSION || DEFAULT_TEMPORAL_POLICY_VERSION`
  (`index.ts:29-30`).
- **Neither start mutation accepts a version argument.** `startResolution`
  (`schema.graphql:1527-1553`) and `startMultiPathwayResolution`
  (`:1564-1612`) expose no such field, so no client can opt a session into
  `v1`. Only a deployment-level env var can.

A deployment that never sets `TEMPORAL_POLICY_VERSION` therefore never executes
the code path that makes **defect 1** observable, and merging plan 04 changes
nothing about production behaviour.

**It does block the `v1` rollout flip.** Under `v1`, `addPatientContext` is the
mutation most likely to flip a gate mid-session — that is precisely what plan
04's kernel is for. Flipping the env var without this fix ships sessions whose
gate rows and subtree rows disagree, with stale exclusion reasons surfacing in
the admin dashboard's pathway view. Fix this **before** the flip, not with it.

**Defects 2 and 3 are live TODAY, and the argument above does not cover them.**
*(Round 14 — the reasoning in this section was written for defect 1 and is
version-specific; the two new defects are not.)* Neither needs `v1`, an assembled
fact store, or a temporal policy of any kind:

- **Defect 2** fires on any `answerGateQuestion` whose answer opens a gate. Under
  `legacy-v0`, on the current deployment.
- **Defect 3** fires on any retraversal that re-evaluates a non-`SKIP` gate.
  Likewise.

`v1` makes defect 3 *more frequent* — a mid-session fact genuinely moves gates —
but it does not create it. **Do not read this section as "the whole file is
blocked on the flip."** Defects 2 and 3 are ordinary production bugs that should
be prioritized on their own severity, and defect 2 is destructive and persisted.

---

## 5. Open questions the implementer must answer

These are genuinely undecided. Do not assume an answer from this document.
Questions 1–4 predate the round-14 additions and are defect-1 shaped; 5 and 6
come from defects 2 and 3, and 6 is the one that decides the shape of the whole
plan.

1. **Does the mirror direction need the same treatment?** A gate flipping
   `INCLUDED → GATED_OUT` mid-session must gate out a subtree that is currently
   included. Is that already handled (via `markSubtree` on some path), or is it
   the same hole in the other direction? If it is the same hole, it is arguably
   the more dangerous one: a subtree that *should* now be excluded staying
   included is a clinical over-recommendation, whereas the flip direction is an
   under-recommendation.

2. **What happens to provider overrides on descendants set while the subtree
   was gated out?** `retraverse` skips any node carrying a `providerOverride`
   outright (`retraversal-engine.ts:190-193`). So a descendant a provider
   touched while it was gated out will be skipped by the new cascade too — is
   that correct (respect the human) or wrong (the override was made against a
   pathway state that no longer holds)? Note `overrideNode` records
   `originalStatus`/`originalConfidence`, so the information to make this
   decision is present.

3. **Is re-resolution bounded to the subtree, or does confidence propagation
   force a wider recompute?** Descendants that become included get confidence
   scores, and those scores may feed nodes outside the subtree. If so, the
   cascade is not subtree-local and `MAX_CASCADE_DEPTH` / `RETRAVERSAL_TIMEOUT_MS`
   (`types.ts:435-436`) become live constraints rather than theoretical ones.
   Measure before choosing a bound.

4. **What happens to existing live sessions?** The dependency map is persisted
   per session (`session-store.ts:80,90`). Sessions created before the fix have
   maps with no gate→subtree entries. On retraversal after deploy they will
   behave as they do today. Decide whether that is acceptable, whether the map
   is rebuilt on load, or whether such sessions are marked non-retraversable —
   the same class of decision as the migration-064 question already open on
   plan 04. **Defects 2 and 3 widen this question rather than adding a new
   one:** sessions already exist that are missing nodes defect 2 deleted, and
   that carry statuses defect 3's rule would not have produced. One answer has
   to cover all three.

5. **Do the deleted nodes need to come back for sessions that already lost
   them?** Defect 2's fix stops the loss going forward. A session that has
   already answered an opening question is short those rows permanently, and no
   retraversal can recreate them — only a full re-traversal from
   `TraversalEngine` can, which would discard every provider override on the
   session. Decide: leave them, rebuild-and-reapply-overrides, or mark such
   sessions non-retraversable.

6. **Is the answer one traversal implementation, or three patches?** All three
   defects are `RetraversalEngine` reimplementing — or failing to reimplement —
   what `TraversalEngine` does. Defect 2's honest fix needs node
   materialization, which only `TraversalEngine` has; defect 3's needs the same
   gate-disposition rule both engines apply; defect 1's needs traversal's
   knowledge of the subtree it gated out. Patching the second implementation
   three more times leaves the two free to diverge a fourth. **Answer this
   before decomposing into tasks** — it decides whether this is one refactor or
   three fixes.
