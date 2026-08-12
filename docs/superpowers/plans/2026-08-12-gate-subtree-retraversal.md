# Gate-subtree retraversal — the fix that gates the `v1` flip

**Status:** spec / stub. Not a task plan. Enough to pick up cold; the task
decomposition is the first job of whoever takes it.

**Found by:** review of plan 04 (`2026-07-26-temporal-horizon-04-evaluator-kernel.md`),
recorded there as **P1-A**.

**Blocks:** the `v1` rollout flip. **Does not block** merging plan 04.

---

## 1. The defect

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

## 2. Why it is pre-existing, and why plan 04 surfaced it

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

## 3. What a fix requires

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
the code path that makes this defect observable, and merging plan 04 changes
nothing about production behaviour.

**It does block the `v1` rollout flip.** Under `v1`, `addPatientContext` is the
mutation most likely to flip a gate mid-session — that is precisely what plan
04's kernel is for. Flipping the env var without this fix ships sessions whose
gate rows and subtree rows disagree, with stale exclusion reasons surfacing in
the admin dashboard's pathway view. Fix this **before** the flip, not with it.

---

## 5. Open questions the implementer must answer

These are genuinely undecided. Do not assume an answer from this document.

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
   plan 04.
