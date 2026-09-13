# Evaluation Pipeline — Design

**Date:** 2026-09-13
**Status:** Revised after architecture review — awaiting approval
**Repos:** `prism-graphql` (pathway-service), `prism-admin-dashboard`
**Baseline:** `main` @ `2454130` (merge of decision-semantics). Every `file:line` below refers to
that commit.
**Source review:** `docs/reviews/2026-09-13-engine-architecture/review.md` on branch
`review/engine-architecture-2026-09-13` (11 findings; 8 reproduced by tests, all 11 verified).
**Architecture review of this spec:** `docs/reviews/2026-09-13-evaluation-pipeline/architecture-review.md`
(this branch, `209a083`). Its four boundary adjustments are adopted as contracts C1–C4 and
decisions D10–D13; its persistence clarifications are folded into §4.

## Why

The engine produces a care plan that depends on the **order in which things happened**, not
only on the facts. The review's findings share three root causes.

1. **Two copies of the same logic that drifted apart.** Full `traverse()` versus
   `resolveIncrementally()`. Single-pathway versus multi-pathway generation. Whole-graph scoring
   versus the one-node-at-a-time scoring that traversal actually does.
2. **A node's status does not say who decided it.** An ancestor gate, a provider override and
   the DDI pass all write the same `status` field.
3. **Changes applied after a check never re-run the check.** Conflict choices are applied after
   DDI; stored merged plans are treated as current after a child session changes.

Path-dependence reproduced on `main`:

- **Nested gates (#1).** Answer "no" to an outer gate, then update a lab, and the medication
  becomes INCLUDED again. Evaluating the same final facts from scratch leaves it excluded.
- **Conflict choices (#6).** Choose A, then B, and the plan holds A *and* B. Choosing B directly
  holds only B.
- **Merged plans (#2).** Answering a child gate with or without a client-side re-merge produces
  different plans.

Fixing these one by one has been tried for several review rounds. Each round's fix was correct
and each round found new instances, because the structure keeps producing them. This spec
removes the structure.

**The invariant this design establishes:** *the same inputs, environment and recorded
observations produce the same plan, however they were arrived at.*

## Constraints

- **No users.** No compatibility seams, deprecation windows or dual paths. Existing sessions are
  purged. Authored pathways are untouched. (Carried from the decision-semantics spec.)
- **Scope is the pipeline core.** This spec targets review findings **#1, #2, #3, #6, #7**.
  Its persistence protocol also closes **#4** and **#8**, because every write goes through it.
- **Configuration is not pinned across time.**
  - Weights, thresholds, the code map, DDI tables and the medication normalisation cache are
    read afresh by every mutation.
  - Within one mutation they are read from a **single consistent snapshot** (C4).
  - Historical pinning is the review's architectural direction #4 and is out of scope.
- **One spec, several plans.** This design is implemented as a sequence of sub-plans, each
  independently mergeable with the suite green. The first sub-plan's first task is the
  performance gate (§5.7); nothing else starts until it passes.
- **ACTIVE pathway graphs are immutable.** DRAFT_UPDATE rewrites a draft's graph in place under
  the same `pathwayId` (`services/import/relational-writer.ts:173`). Activation is only possible
  from DRAFT (`resolvers/mutations/import.ts:74`).

## Decisions

| # | Decision | Rationale |
|---|---|---|
| D1 | **Recompute from recorded inputs.** Not incremental plus an equivalence test, and not event sourcing. | Removes the incremental path, the source of #1 and most prior review findings. Event sourcing adds versioning and snapshots that `pathway_resolution_events` already makes unnecessary. |
| D2 | **LLM verdicts are recorded as observations and reused**, keyed by the semantic request (C1) | Otherwise recomputation calls the model again, and the plan can change with no change in patient facts. |
| D3 | **Readiness blocks on every open pending question, tentative LLM verdicts included** | Today a tentative LLM gate is INCLUDED with only a `pendingQuestions` entry (`traversal-engine.ts:1087-1112`), and `validateForGeneration` checks node statuses only (`care-plan-generator.ts:107`). So a plan can be generated on an unconfirmed LLM guess. Because of D3, unavailable observations need not be recorded: they cannot reach a plan unconfirmed. |
| D4 | **Safety outranks provider overrides** (today's behaviour, now explicit) | `applyDdiToResolutionState` suppresses any INCLUDED medication, overridden or not (`ddi-pass-single-pathway.ts:55`). Letting an override acknowledge a finding is a clinical decision deferred beyond this spec. |
| D5 | **In a multi-pathway run, the parent owns patient facts** | Today an escalated datum answered on child A lands only in A's `additionalContext`, where B's gates cannot see it. Gate answers, decision-point choices and overrides stay on the child, because they name pathway-local nodes. |
| D6 | **A multi-pathway run has one lock: the parent's `revision`** | Every write in a run produces a coherent result for the whole run in one transaction. Cost: rapid answers on different children conflict and retry. |
| D7 | **Generation requires `reviewedResultHash`** and returns `PLAN_CHANGED_SINCE_REVIEW` on mismatch | Configuration changes between mutations (see Constraints). The plan a provider reviewed must be the plan that is materialized. |
| D8 | **Purge all resolution sessions** in the migration | No users. The sessions carry neither graph fingerprints nor overrides-as-inputs. |
| D9 | **Three server-side retries** on revision conflict, then `CONFLICT`. Observations acquired during a request are reused across its retries. | Replaces the client's text-matching retry (`PendingGatesPanel.tsx:208-221`) and today's retry loop, which only one mutation has (`resolution.ts:551`). |
| D10 | **External observations cross an explicit provider boundary** in a single evaluation pass. The observation key includes prompt, branches, input attribute, narrative and model. | A pure `derive` with a replayable provider meets C1 without a discover-fetch-rerun loop. Including the model absorbs former follow-up F2. |
| D11 | **Eligibility and final disposition are separate. Graph dependencies read eligibility only. Import rejects `depends_on` targets of type Medication.** | A dependency on a medication's status is where suppression would leave a gate incorrectly satisfied, and reading eligibility there could withhold both A and its alternative. Live evidence (read-only query, 2026-09-13): the live graph holds 4 `depends_on` entries, **all targeting Step nodes, all in one ARCHIVED pathway** (`vaginitis-in-pregnancy-v1@1.0`). The rule invalidates nothing. |
| D12 | **Blockers and safety findings are scoped.** Completeness blockers propagate from children. Output blockers (including `EMPTY_PLAN`) exist only at the root. Patient-scoped safety runs everywhere; pair-scoped safety runs only at the root, over the final set. | A resolved child with nothing to add must not block a useful combined plan. A pair suppression is only meaningful against the set in which both actions remain. |
| D13 | **One environment snapshot per mutation. Every mutation on a run re-evaluates every child under it.** Each result records its `envFingerprint`. | The conservative invalidation policy: no composite can mix configuration versions. Fingerprint-based child reuse is a later optimisation (F5). |

---

## §0 Contracts (normative)

Everything in §1–§4 is an implementation of these four contracts. Where a later section appears
to disagree, the contract wins.

### C1 — Deterministic core, external observations

```ts
evaluate(inputs: SessionInputs, env: EvaluationEnv, observations: ObservationProvider): EvaluationResult
```

- **`evaluate` performs no I/O of its own.** `env` is plain data (C4). The only external
  information reaches it through `observations`.
- **An observation** is a record of information acquired from outside: in this spec, one LLM gate
  verdict. It carries its key, the verdict, the model, the acquisition timestamp and the audit row
  id.
- **The observation key identifies the semantic request:**
  `sha256(canonical{ gateId, prompt, branches[name, description], inputAttribute, narrative, model })`.
  - Changed patient context yields a different narrative and so a different key. An incompatible
    observation can never be reused.
  - `confidence_threshold` is **not** part of the key; it is applied to the verdict after
    acquisition.
- **The provider has two modes:**
  - **`replay(frozen)`** returns a frozen observation or `UNAVAILABLE`, and never calls out. Used by
    determinism tests and audits.
  - **`live(sessionObservations, requestObservations, llmClient)`** looks up the session's recorded
    observations first, then those acquired earlier in this request, then calls the client. A
    success is added to `requestObservations`. A failure returns `UNAVAILABLE` and is remembered
    for this attempt only.
- **`UNAVAILABLE` is never evaluated as a clinical false.** The gate takes its safe default with
  `tentative: true`. Readiness then reports `PENDING_GATE` (D3).
- **The result lists `observationsUsed`.** The commit persists exactly the successful observations
  the winning evaluation used (§4).
- **Medication normalisation and DDI reference data are environment, not observations.**
  - The candidate universe is known before traversal: every Medication node in the graph, plus
    the patient's medications and allergies.
  - Their normalisation and interaction rows are resolved and loaded into `env` before `evaluate`
    runs (C4).
  - A normalisation failure (RxNav unreachable on a cache miss) aborts the mutation. A plan is
    never evaluated without its safety data.

**Guarantee:** frozen `inputs` + `env` + observations (`replay`) → identical `EvaluationResult`,
including `resultHash`.

### C2 — Eligibility versus final disposition

Every node result carries two layers:

```ts
interface NodeResult {
  // ...existing identity fields
  eligibility: { status: NodeStatus; reason?: string; decidedBy: 'traversal' | 'override' };
  disposition: {
    status: NodeStatus;            // equals eligibility.status unless withheld below
    withheldBy?: 'safety' | 'conflict';
    findingIds?: string[];         // safety findings, or the conflictId
    reason?: string;
  };
  status: NodeStatus;              // = disposition.status  (public API unchanged)
  excludeReason?: string;          // = disposition.reason ?? eligibility.reason
}
```

- **Traversal writes only `eligibility`.** Stages after traversal (safety, conflict selection)
  write only `disposition`. Nothing after traversal feeds back into traversal. There is no
  reconciliation loop and no dependency cycle.
- **`prior_node_result` gates read `eligibility.status`.** Graph semantics are "the pathway
  considers this node applicable."
- **Import validation rejects** a `depends_on` entry whose target node type is **Medication**.
  - Medication is the only type a post-traversal stage can withhold. Safety only suppresses
    medications, and conflicts are medications-only in v1.
  - A dependency meaning "A will be part of this plan" is therefore unrepresentable rather than
    silently wrong.
  - If conflicts or safety ever extend to other node types, this rule extends with them.
- **What reads which layer:**
  - Explanations keep both layers: a suppressed medication still shows why the pathway proposed it.
  - Findings (pending questions, red flags, catch-up items) derive from eligibility.
  - `EMPTY_PLAN` and the materialized plan derive from disposition.

### C3 — Contribution versus root

Every evaluation runs at a **scope**:

- **`ROOT`** — a standalone single-pathway session, or the parent of a run.
- **`CONTRIBUTION`** — a child in a run.

**Blocker scope:**

| Scope | Blockers | Where computed |
|---|---|---|
| Completeness | `PENDING_GATE`, `INCOMPLETE_RESOLUTION`, `UNRESOLVED_RED_FLAG` | In each contribution and at the root; contributions' blockers propagate to the root, tagged with their pathway |
| Output | `EMPTY_PLAN`, `UNRESOLVED_CONFLICT`, `STALE_CONFLICT_DECISION`, `PLAN_CHANGED_SINCE_REVIEW` | Root only |

**Safety finding scope:**

| Scope | Check | Where it runs |
|---|---|---|
| Patient | Candidate against patient medications and allergies. It does not depend on which other actions are selected. | Contributions and the root; at the root it covers only candidates the root introduces (provider write-ins) |
| Set | Candidate pairs | **Root only**, over the final candidate set, after conflict selection |

A standalone session is a root, so it runs both scopes. No rule is needed to restore an action
suppressed by a pair that no longer exists: pair checks never run anywhere but the final set.

### C4 — One environment snapshot per mutation

- **`loadEvaluationEnv` runs in two steps:**
  1. Resolve normalisation-cache misses for the candidate universe. This may call RxNav and write
     `medication_normalization_cache`, outside any snapshot.
  2. In one `BEGIN READ ONLY ISOLATION LEVEL REPEATABLE READ` transaction, read every graph the
     mutation needs and all shared configuration: signals, thresholds, weight matrix, node weights,
     admin evidence, code map, temporal defaults, normalisation rows and the DDI/allergy rows for
     the candidate ingredients. The transaction is closed before evaluation begins, so no lock is
     held across LLM calls.
- **`envFingerprint`** = sha256 over the canonical content of that snapshot's shared configuration
  plus each graph fingerprint. It is stored with every result.
- **Run policy (D13):** a mutation on a run loads one snapshot and re-evaluates **every** child
  under it before composing. No cached child result is ever combined with a result from a
  different snapshot.

---

## §1 Session inputs and results

A session stores **only what a person or the outside world told it**, plus a revision.
Everything else is derived and stored only as a read cache.

```ts
interface SessionInputs {
  pathwayId: string;
  graphFingerprint: string;                        // sha256 of canonical nodes + edges at start
  temporalContext: EvaluationTemporalContext;      // existing: pinned clock + policy version
  initialPatientContext: PatientContext;           // existing (parent-owned in a run, D5)
  additionalContext: AdditionalContextInput;       // existing, boundary-validated (parent-owned in a run)
  gateAnswers: Map<NodeId, GateAnswer>;            // existing: questions, DecisionPoint choices,
                                                   //   confirmations of tentative LLM gates
  providerOverrides: Map<NodeId, Override>;        // NEW: moved out of resolutionState
  observations: Map<ObservationKey, LlmObservation>;  // NEW: successful, used observations only (C1)
  revision: number;                                // NEW: integer; replaces updated_at locking
}

interface EvaluationResult {
  scope: 'ROOT' | 'CONTRIBUTION';
  resolutionState: ResolutionState;                // eligibility + disposition per node (C2)
  pendingQuestions: PendingQuestion[];
  redFlags: RedFlag[];
  safetyFindings: DdiFinding[];                    // each tagged PATIENT or SET scope (C3)
  catchUpItems: CatchUpItem[];
  gateContextFields: Map<NodeId, string[]>;        // feeds evidence trail + data-gap hints
  readiness: { ready: boolean; blockers: ScopedBlocker[] };
  status: 'ACTIVE' | 'DEGRADED';
  observationsUsed: ObservationKey[];
  envFingerprint: string;
  resultHash: string;                              // rule 8
}
```

Rules:

1. **Determinism** as guaranteed by C1.
2. **No incremental path.**
   - `resolveIncrementally`, `promote` and `DependencyMap` are deleted, except
     `gateContextFields`, which becomes an output.
   - The event log's `statusChanges` is a diff of the previous cached `resolutionState` against
     the new one, on `status`.
3. **Overrides keep today's meaning.** An override sets that node's `eligibility`
   (`decidedBy: 'override'`), and a gate's sweep still descends *through* it. This uses the
   existing `held` mechanism, which `traverse()` must now accept (§2 stage 3).
4. **LLM gates** follow C1.
5. **Timeouts.** The existing 10-second budget (`types.ts:552`) stays. A timed-out evaluation is
   cached as DEGRADED and reports `INCOMPLETE_RESOLUTION`. Inputs are untouched, so the next
   mutation recovers.
6. **Graph guard.** If a loaded graph's fingerprint differs from `inputs.graphFingerprint`, the
   mutation throws `SESSION_GRAPH_CHANGED`. This only occurs for draft pathways edited during a
   preview.
7. **Configuration** follows C4.
8. **`resultHash` covers exactly what a provider reviews.** It is sha256 over canonical JSON
   (object keys sorted, arrays in stable order) of:
   - for each node, sorted by `nodeId`: `{ nodeId, eligibility.status, disposition.status,
     disposition.withheldBy, excludeReason, providerOverride.action }`;
   - `pendingQuestions` sorted by `gateId`;
   - `redFlags` sorted by `(nodeId, type)`;
   - `safetyFindings` sorted by `(recommendationId, category, source, scope)`;
   - `catchUpItems` sorted by `nodeId`;
   - `readiness.blockers` sorted by `(scope, type, relatedNodeIds)`.

   **Excluded:** confidence values, durations, timestamps, LLM reasoning text, `revision`,
   `envFingerprint`. A confidence change that alters a status is captured through that status.

   For a run, `RunResult.resultHash` covers:
   - the merged plan's recommendations with their dispositions;
   - suppressions;
   - conflicts with derived resolutions;
   - the root's blockers;
   - every child's `resultHash`, in `contributing_session_ids` order.

---

## §2 Pipeline stages

```
services/resolution/pipeline/
  load-env.ts        loadEvaluationEnv(pool, pathwayIds, candidateUniverse) → EvaluationEnv   (C4)
  observations.ts    ObservationProvider: replay | live                                        (C1)
  evaluate.ts        evaluate(inputs, env, observations, scope) → EvaluationResult
  scores.ts          stage 2
  findings.ts        stage 4
  safety.ts          stages 5–6 (replaces the dead file of the same name)
  readiness.ts       stage 7
  compose.ts         composeRun (§3)
```

| # | Stage | Behaviour | Replaces |
|---|---|---|---|
| 1 | **Context** | `buildEffectivePatientContext(initial, additional)`; fact store; `assertEncounterAnchor` | Six hand-built copies across the mutations |
| 2 | **Scores** | **One** `computePathwayConfidence` over **all** nodes, using evidence and weights from `env`. Produces a `ScoreMap`. | `makeTraversalAdapter` (`resolution-context.ts:337`), the `contextNodes` parameter, about four queries per scored node |
| 3 | **Traverse → eligibility** | `traverse(graph, context, { scores, gateAnswers, overrides, observations })`. Overrides pre-seed `held`. The held-arrival handling that exists only in the incremental path (`traversal-engine.ts:831-847`) moves into the main loop, otherwise the existing-state skip at `:566` would freeze a pre-seeded override's subtree. `prior_node_result` reads eligibility (C2). | `resolveIncrementally`, the adapter |
| 4 | **Findings** | Pending questions and red flags from traversal. Catch-up items for every eligible Stage/Step via `findUnmetPrerequisites` (deduplicated). Emits `gateContextFields`. | `findings-reconciliation.ts`; catch-up computed only at multi start (`multi-pathway-resolution.ts:832-858`) |
| 5 | **Patient safety → disposition** | Candidates: every eligible Medication, **including provider-overridden ones** (D4). Checked against patient medications and allergies. A SUPPRESS finding sets `disposition` to EXCLUDED, `withheldBy: 'safety'`. | `refreshSessionDdi` (six call sites), in-place `applyDdiToResolutionState` |
| 6 | **Set safety → disposition** (ROOT only) | Every pair of candidates still included after stage 5; for a run, after conflict selection (§3). | Cross-recommendation DDI with its same-pathway skip (`ddi-pass.ts:176`) |
| 7 | **Readiness** | Scoped blockers per C3. Completeness: any PENDING_QUESTION node or `pendingQuestions` entry, tentative included; any red flag; any TIMEOUT/UNKNOWN node. Output (ROOT only): `EMPTY_PLAN` on disposition. Derives `status`. | Both `validateForGeneration`s (`care-plan-generator.ts:107`, `multi-pathway-resolution.ts:1040`); `derivedSessionStatus` (`resolution.ts:168`); the DEGRADED check (`resolution.ts:1225`) |

A standalone session runs stages 1–7 at ROOT scope. A child in a run runs stages 1–5 and 7 at
CONTRIBUTION scope; `composeRun` performs stage 6 and the root part of stage 7.

**Import validation change.** `services/import/validator.ts` (the `depends_on` check at `:244`)
rejects a Medication target (C2).

**Known behaviour change at stage 2.** Confidence propagation never runs during traversal today.

- Each node is scored alone, and `topologicalSort` (`confidence-engine.ts:406`) counts an incoming
  edge from an unscored parent that it never decrements. It reports a cycle and skips propagation.
- This is the source of the live log's repeated "Cycle detected… 1 nodes, 99 edges" warnings.
- Whole-graph scoring turns propagation on, so **confidences and auto-included actions will change
  on existing pathways.** The review's fixture: 0.90 → 0.24.

**Errors:**

| Condition | Outcome |
|---|---|
| Normalisation failure; snapshot read failure; `SESSION_GRAPH_CHANGED` | Throw before evaluation; nothing persisted |
| Observation `UNAVAILABLE` | Tentative gate, not an error |
| Timeout | DEGRADED cache |

**Deleted as dead code:** the current `services/resolution/safety.ts`. Nothing imports it except
the barrel (`services/resolution/index.ts:5`), so nothing produces `CASCADE_LIMIT`. The enum value
remains in the API.

---

## §3 Multi-pathway as composition

Every write in a run produces a coherent result for the whole run under one environment
snapshot, in one transaction. **Reads never recompute and never write.**

### Data

- **Child sessions** gain `parent_session_id`. A child in a run stores only node-local inputs
  (`gateAnswers`, `providerOverrides`, `observations`) and no patient facts (D5).
- **The parent** owns `initialPatientContext`, `additionalContext`, `temporalContext`,
  `conflict_resolutions` and the run's single `revision` (D6).
- **Derived, no longer stored:** `mergedPlan.conflicts[].resolution`.
- **Status.** The parent's `status` stays lifecycle-only (ACTIVE, COMPLETED, ABANDONED; existing
  CHECK unchanged). Incompleteness in a run is expressed through blockers.
- **Child lifecycle follows the parent, in the same transaction:**
  - Parent generation marks every child COMPLETED with the parent's `care_plan_id`.
  - Abandoning the parent marks every child ABANDONED.
  - Child-level `abandonSession` and `generateCarePlanFromResolution` on a child in a run are
    rejected with `CHILD_OF_MULTI_PATHWAY_SESSION`.

### `composeRun(contributions, parentInputs, env, observations) → RunResult`

1. **Project** each contribution: eligible and disposed recommendations, patient-scoped findings,
   completeness blockers, catch-up items and `gateContextFields`.
2. **Merge** with `mergeResolvedCarePlans`.
3. **Select** using `conflict_resolutions`, derived from the base merge, never appended.
   - Losing candidates get `disposition.withheldBy: 'conflict'`, `findingIds: [conflictId]`.
   - A decision whose chosen pathway is no longer a candidate yields `STALE_CONFLICT_DECISION`.
     Today it is a `TypeError` at `multi-pathway-resolution.ts:989-991`.
   - A decision for a conflict that no longer exists is inert.
4. **Patient safety for root-introduced candidates:** provider write-ins (`CUSTOM_OVERRIDE`).
5. **Set safety** (stage 6) over the final candidate set.
6. **Readiness at the root:**
   - the contributions' completeness blockers, tagged with their pathway;
   - `UNRESOLVED_CONFLICT`, a new type replacing the misused `PENDING_GATE` at
     `multi-pathway-resolution.ts:1047`;
   - `STALE_CONFLICT_DECISION`;
   - `EMPTY_PLAN` on the final dispositions. A child with nothing to contribute does not block.

### Mutations

Every mutation on a run takes the same shape: load one snapshot (C4), apply the change,
re-evaluate every child, `composeRun`, persist under the parent's revision.

| Mutation | Change applied |
|---|---|
| `startMultiPathwayResolution` | Create the parent and children. Zero matches takes the same path with no children. |
| `answerPendingDecision` / `overrideNode` on a child in a run | Record the input on the child |
| `addPatientContext`, or an escalated-datum answer, on a child in a run | Record the fact on the **parent** |
| `resolveConflict` | Record the decision on the parent |
| `generateMergedCarePlan` | None; then the D7 check and materialization (§4) |

### Removed

- `reMergeMultiPathwaySession` (resolver, SDL, admin callers).
- `buildResolvedPlansFromSessions`.
- Multi's `validateForGeneration`.
- `runMergePipeline` stage 1: the pre-merge DDI, now contribution stage 5.

The admin UI keeps its existing parent refetch after an answer
(`prism-admin-dashboard/src/app/encounter/page.tsx:392`).

### Out of scope, stated

- **Empty-plan detection** keeps today's medications/labs/procedures definition (review #11).
- **Recommendation identities remain pathway-local** (review #5; F1). Until F1 lands, step 5's
  pair check can alias two different drugs that share a node id.

---

## §4 Mutation and persistence protocol

### One write path: `commitEvaluation`

```
requestObservations = new Map()                 // survives retries (D9, C1)
for attempt in 1..3:
  load inputs + revision + lifecycle status     (the parent's, for a run)
  assert lifecycle allows the mutation          // no evaluation if not
  inputs' = applyChange(inputs)                 // boundary validation; BAD_USER_INPUT is not retried
  env     = loadEvaluationEnv(...)              // C4; outside the write transaction
  result  = evaluate(...) | evaluate children + composeRun(...)
              with observations = live(inputs'.observations, requestObservations, llmClient)
  BEGIN
    UPDATE … SET <inputs'>,
                 observations = inputs'.observations ∪ requestObservations[result.observationsUsed],
                 <cache>, result_hash, env_fingerprint, revision = revision + 1
      WHERE id = $id AND revision = $r          // 0 rows → ROLLBACK, next attempt
    child rows (runs); events (statusChanges = diff)
  COMMIT → write LLM audit rows for every call this request made; return
on exhaustion: write LLM audit rows for every call this request made; throw CONFLICT
```

- **Observations.** A retry reuses `requestObservations` whose keys still match after the reload.
  A changed narrative produces a new key, so there is no reuse. Only observations the winning
  evaluation used are persisted to the session. The external normalisation cache is written
  independently (C4 step 1) and is never treated as a session observation.
- **Audit.** Audit rows record every external call a request made, whether or not an attempt won.
  They are written after the outcome is known, so failed attempts are auditable too.
- **Kept unchanged at the boundary:**
  - `firstTrustAssertion` + `normalizeContextEntryNulls` (`resolution.ts:1017-1028`);
  - `validateAnswerAgainstGate`;
  - the DecisionPoint candidate check (`:584-594`);
  - the escalated `numericValue` check (`:721-727`);
  - `assertKnownPolicyVersion`.

### Lifecycle-only operations (no evaluation)

- **`abandonSession` / `abandonMultiPathwaySession`.** Check the status is ACTIVE or DEGRADED
  (today a COMPLETED session can be abandoned, `resolution.ts:1441-1457`). Update the status with
  the revision check, cascading to children for a run, and write the event.
- **Generation on a COMPLETED session** returns its existing `carePlanId` as success, before any
  evaluation.

### Generation

```
load; if status = COMPLETED → return existing carePlanId
assert status allows generation
env = loadEvaluationEnv(...); result = evaluate(...) | evaluate children + composeRun(...)
if result.resultHash ≠ args.reviewedResultHash → commit fresh cache (as above); return PLAN_CHANGED_SINCE_REVIEW
if result.readiness.blockers non-empty → commit cache if changed; return blockers
BEGIN
  UPDATE session SET status = 'COMPLETED', <cache>, observations, env_fingerprint, revision = revision + 1
    WHERE id = $id AND revision = $r AND status IN (<claimable>)       // claim first
  INSERT care plan rows; UPDATE session SET care_plan_id; children → COMPLETED (runs)
COMMIT   // 0 rows at the claim → ROLLBACK → reload and retry per commitEvaluation
```

- **Claimable statuses:** `('ACTIVE','DEGRADED')` for `pathway_resolution_sessions`, `('ACTIVE')`
  for `multi_pathway_resolution_sessions`. Readiness has already refused a degraded result;
  DEGRADED is listed only so a stale cached status never causes a spurious claim failure.
- **The claim precedes the inserts**, so a failure rolls back both. This closes #8 and removes the
  non-truncated timestamp predicate of #4 (`resolution.ts:1385`).
- **Materialization itself** (`generateCarePlan`, `materializeCarePlan`) is unchanged, except that
  it reads `disposition` and runs inside the claimed transaction.

### Migration `067_evaluation_inputs.sql`

No migration numbered 067 or above exists on any branch as of this spec.

1. **Purge (D8).**
   - `DELETE FROM multi_pathway_resolution_sessions; DELETE FROM pathway_resolution_sessions;`
   - Cascades to events (042), decisions (038), analytics (043) and LLM evaluations (057).
   - Generated care plans have no foreign key to sessions and are untouched.
2. **`pathway_resolution_sessions`:**
   - Add `revision INT NOT NULL DEFAULT 0`, `provider_overrides JSONB NOT NULL DEFAULT '{}'`,
     `observations JSONB NOT NULL DEFAULT '{}'`, `graph_fingerprint TEXT NOT NULL`,
     `env_fingerprint TEXT NOT NULL`, `result_hash TEXT NOT NULL`, `readiness JSONB NOT NULL`,
     `gate_context_fields JSONB NOT NULL DEFAULT '{}'`,
     `catch_up_items JSONB NOT NULL DEFAULT '[]'`.
   - Add `parent_session_id UUID REFERENCES multi_pathway_resolution_sessions(id) ON DELETE
     CASCADE`, indexed.
   - `DROP COLUMN dependency_map`. `ALTER COLUMN temporal_context SET NOT NULL`.
   - `CHECK (parent_session_id IS NULL OR additional_context = '{}'::jsonb)`.
3. **`multi_pathway_resolution_sessions`:**
   - Add `revision INT NOT NULL DEFAULT 0`, `additional_context JSONB NOT NULL DEFAULT '{}'`,
     `env_fingerprint TEXT NOT NULL`, `result_hash TEXT NOT NULL`, `readiness JSONB NOT NULL`.
   - `ALTER COLUMN temporal_context SET NOT NULL`.
   - `contributing_*` arrays are written once, at start.
4. **`pathway_resolution_events`:** extend the `event_type` CHECK (042:46-50) with
   `'BRANCH_CHOSEN'` and `'PROVIDER_ASSERTED_DATUM'`, unless the separate fix in *Live defects*
   ships first.

### API changes (admin dashboard is the only client)

- **`BlockerType`** gains `UNRESOLVED_CONFLICT`, `STALE_CONFLICT_DECISION`,
  `PLAN_CHANGED_SINCE_REVIEW`. Blockers expose `scope: BlockerScope!`
  (`COMPLETENESS | OUTPUT`) and `pathwayId: ID` for propagated ones.
- **`ResolutionSession` and `MultiPathwayResolutionSession`** expose `revision: Int!`,
  `resultHash: String!`, `envFingerprint: String!`.
- **Node results** expose `eligibilityStatus: NodeStatus!` and `withheldBy: WithheldBy`
  (`SAFETY | CONFLICT`) alongside the existing `status`.
- **`generateCarePlanFromResolution` and `generateMergedCarePlan`** take
  `reviewedResultHash: String!`.
- **Removed:** `reMergeMultiPathwaySession`, and the `answerGateQuestion` alias (no callers in any
  client).
- **Error codes:** `CONFLICT`, `SESSION_GRAPH_CHANGED`, `CHILD_OF_MULTI_PATHWAY_SESSION`; import
  validation reports the new `depends_on` rule as a validation error.

### Deployment

- Breaking API change: the backend and admin dashboard deploy together.
- Apply 067 through the documented manual psql workflow.
- Preview sessions open at deploy time are lost.

---

## §5 Testing

1. **Architectural acceptance examples — written first, before broad implementation.**
   - **A1 Observations (C1).**
     - `replay` with frozen inputs, env and observations gives identical results and `resultHash`.
     - A request that loses one revision race calls the LLM client **once** across both attempts.
     - A changed narrative produces a new call.
     - `UNAVAILABLE` yields `PENDING_GATE`, never `GATED_OUT`.
   - **A2 Eligibility (C2).**
     - A medication suppressed by a patient allergy has `disposition` EXCLUDED and `eligibility`
       INCLUDED, with both reasons retained.
     - A `prior_node_result` gate on a Step is unaffected by any suppression.
     - Import rejects `depends_on` targeting a Medication.
   - **A3 Composition (C3).**
     - A child with no recommendations plus a child with a valid plan → the run is ready.
     - A child with a pending gate blocks the run.
     - A and B from different children interact. Choosing the conflict so B is withheld leaves A
       included and produces no pair finding.
     - A patient-allergy suppression of A persists regardless of the choice.
   - **A4 Environment (C4).**
     - Change a threshold between two mutations. An answer on child A then yields a composite
       equal to a fresh full evaluation of the run under the new snapshot.
     - `envFingerprint` changes.
2. **The review's reproductions.** Port `reproductions.patch` to the new API (input sequences
   through `commitEvaluation` against an in-memory store).
   - **Must pass:** #1 nested gates, #3 scoring, #2 merged generation readiness, #6 conflict
     replacement, #7 custom-override DDI.
   - **Pinned, documented defect tests** (suite stays green): #10 vital answer round trip, #5
     drug-id aliasing (F1), #9 shared downstream action.
3. **Path-independence properties.** Add `fast-check` as a pathway-service devDependency (it is
   imported by `tests/property-based/security-properties.test.ts` but not installed).
   - **Generators:**
     - valid graphs mixing nested gates, DecisionPoints, reconverging branches and medications,
       with a deterministic scorer stub and a `replay` provider;
     - edit sequences: answer, re-answer, override, add fact, conflict choice, change choice.
   - **Properties:**
     - (a) applying edits one at a time equals `evaluate(finalInputs)`;
     - (b) independent edits in any order give equal results;
     - (c) `evaluate` twice → deep-equal results and identical `resultHash`.
4. **Stage tests.**
   - **Scores:** whole-graph propagation gives 0.24 on the existing fixture.
   - **Observation keys:** a change of prompt, branches, input attribute or model each yields a new
     key; a change of `confidence_threshold` does not.
   - **Patient and set safety:**
     - an overridden medication can be suppressed;
     - same-pathway pairs are checked at root;
     - contributions run no pair checks;
     - write-ins get patient checks.
   - **Readiness:** tentative LLM, TIMEOUT and a stale conflict decision each block; blockers carry
     the correct scope.
   - **`composeRun`:**
     - a changed choice replaces the old one;
     - a fact supplied on child A reaches child B;
     - a stale decision yields a blocker and does not throw.
5. **Retired-test conversion.** About 85 tests in about 14 files chiefly exercise deleted code (see
   *What this removes*).
   - **Mapping table:** the implementation plan carries one row per retired test, pointing to its
     replacement sequence-vs-fresh test or giving a written reason for dropping it.
   - **Assert the positive, then revert the fix and watch the test fail.**
   - Test files are not typechecked (ts-jest `diagnostics: false`), so every invariant also needs a
     runtime throw.
6. **Real Postgres, opt-in** (`*.pg.test.ts`, gated by an env var, required before merge).
   - **Revision lock:** two concurrent writes, one wins and one retries.
   - **Generation:** two concurrent generations yield exactly one care plan.
   - **Idempotency:** generation on a COMPLETED session returns its existing id without evaluating.
   - **Snapshot:** the snapshot read is a single REPEATABLE READ transaction.
   - **Migration 067:** applied to a database copy; purge cascade; the child-facts CHECK.
7. **Performance gate — first task of the plan.** Import `chronic_htn_pregnancy_care_pathway.json`
   (admin repo `docs/`; 108 nodes, 113 edges) into a test database, and stub the LLM.
   - **Budget:** p95 **< 2 s** for a single-pathway mutation; **< 5 s** for an answer and for a fact
     submission on a 5-child run. Both re-evaluate every child (D13).
   - **Measured separately:** the snapshot load.
   - **If the budget fails,** stop and revisit D1/D13 before further work.
8. **Before/after record.** Extend `baseline-capture.test.ts` to record anemia-in-pregnancy v1.4
   before and after.
   - **Expected differences:** confidence propagation, the new readiness blockers, same-pathway
     DDI findings.
   - **Anything else is a defect.**
9. **Suite invariant.** The nine pre-existing `patient-match-scorer` / `data-completeness-scorer`
   failures remain the only failures.
10. **Admin dashboard** (no test suite): a manual smoke test in the encounter simulator and pathway
    preview.
    - Answering refreshes without re-merge.
    - The `PLAN_CHANGED_SINCE_REVIEW` flow.
    - Changing a conflict choice.
    - A fact supplied on one pathway resolves another's gate.
    - A suppressed medication shows both its pathway reason and its safety reason.

---

## What this removes

Approximate line counts, from a caller-verified inventory.

### Deleted

| Area | Items | ~Lines |
|---|---|---|
| Engine | `resolveIncrementally` incl. `promote`, region computation, held re-arrival, region TIMEOUT refill (`traversal-engine.ts:590-951`); `IncrementalResult` | 370 |
| Engine | `findings-reconciliation.ts` (whole file; sole caller `traversal-engine.ts:919-935`) | 289 |
| Engine | `scorer-context-inputs.ts`; `recordScorerInputs`; `recordInfluence`; `rewritten` sets; `contextInputs` plumbing; `dependedOnNodes` | ~180 |
| Mutations | Incremental blocks in `overrideNode` (`resolution.ts:403-459`), `answerPendingDecision` (`:794-884`) and `addPatientContext` (`:1044-1131`) | 235 |
| Mutations | `refreshSessionDdi` and generation's DDI pre-pass (`:176-201`, `:1200-1256`) | 64 |
| Storage | Dependency-map (de)serialisation; `dependencyContextKey` (`effective-context.ts:151-178`); LLM per-request cache (`resolution-context.ts:464`) | ~85 |
| Multi | `reMergeMultiPathwaySession` (`multi-pathway-resolution.ts:413-464`); `buildResolvedPlansFromSessions` (`:728-764`); SDL | ~98 |
| Admin UI | `RE_MERGE_MULTI_PATHWAY_SESSION`, its calls in the encounter page and preview panel, `isReMerging` props | ~55 |

### Already dead on `main` (deleted regardless)

- `makeRetraversalAdapter` (`resolution-context.ts:368`).
- `RETRAVERSAL_TIMEOUT_MS` and `RetraversalResult` (`types.ts:481`, `:553`).
- The current `safety.ts`.
- `requireSessionTemporalContext`: migration 065 purged clock-less rows, and `createSession`
  requires a clock.
- `buildPatientContext` (test-only caller).
- `emptyMergedCarePlan` (duplicate).
- `isRedFlagType`.
- The unused `_initialSessionId` parameter.
- The unused thresholds query inside `computePathwayConfidence` (`confidence-engine.ts:98`).

### Reduced

- **`updateSession`:** piecemeal derived-field SETs and the `date_trunc` lock become the revision
  write.
- **Retry loops:** the retry loop in `answerPendingDecision`, and the client's optimistic-lock
  retry.
- **`runCrossRecommendationDdi`:** becomes the root-only set check, without its same-pathway skip.
- **Columns:** `dependency_map` is dropped.

### Duplication folded into the pipeline

| Repeated today | Copies |
|---|---|
| `new TraversalEngine` + `buildResolutionContext` + fact store | 5 in `resolution.ts`, 1 in multi |
| DDI orchestration | 6 single + 2 multi, with differing suppression bookkeeping |
| Locked session writes | 6, only one with retry |
| Readiness validators | 2 (five rules vs two) |
| Child-plan builders | 2 (start computes catch-up; re-merge passes `[]` at `:758`) |

### Must stay

- **The `held` and `provisional` mechanisms.** `provisional` is used by full traversal; `held`
  moves into it.
- **`gateContextFields`**, which becomes a pipeline output feeding
  `care-plan-projection.ts:211`, `:280`.
- **Boundary validation** (listed in §4).
- **Audit logging:** `logEvent`, `logNodeOverride`, `logGateAnswer`, LLM audit rows.
- **The GraphQL fields `statusChanges` and `nodesRecomputed`.**
- **`pendingGateQuestions`**, which carries the child `sessionId` that answers are routed to.

## Defects this design fixes by construction

These are beyond the review's findings, found while verifying it.

- **Re-merge drops catch-up items** (`multi-pathway-resolution.ts:758` passes `[]`).
- **Multi-start children get no DDI pass** (`:864-878`). Later suppressions then vanish without a
  `suppressed` entry.
- **DecisionPoint answers build the engine without the LLM evaluator** (`resolution.ts:621-628`),
  so LLM gates under a chosen branch fall back to their safe default.
- **Re-merge crash:** re-merge replays a stale conflict choice into a non-null assertion
  (`multi-pathway-resolution.ts:989-991`), throws, and the session can never re-merge again.
- **Merged generation ignores child state:** it reads the stored merged plan and never checks
  children's readiness.
- **An override of a gate or step does not re-dispose its subtree:** `influences` only records
  `prior_node_result` readers and DecisionPoint branches.
- **Suppression is read by later partial updates:** a `prior_node_result` gate can read a
  DDI-mutated status in a later incremental update, but not in the traversal that first decided
  it (C2).

## Live defects not fixed by this design (separate small fixes)

- **`BRANCH_CHOSEN` and `PROVIDER_ASSERTED_DATUM` violate the `event_type` CHECK** (042:46-50;
  verified from migrations, not the live database).
  - A branch choice logs after persisting (`resolution.ts:692`), so the request likely errors
    after its state is saved.
  - An escalated-datum answer logs before persisting (`:745`), so it likely fails before anything
    is saved.
- **`abandonSession` has no status guard** (`resolution.ts:1441`). §4 also fixes this; listed here
  in case it is patched earlier.

## Trade-offs accepted

| Cost | Mitigation |
|---|---|
| Every mutation runs a full evaluation; every mutation on a run re-evaluates all N children (D13) | Performance gate (§5.7); whole-graph scoring removes about 4 queries per node; recorded observations remove repeat LLM calls; fingerprint-based child reuse is F5 |
| An observation provider, an environment snapshot and two disposition layers add orchestration code and model surface | They make the core replayable and every exclusion attributable; acceptance examples A1–A4 pin them |
| `depends_on` may no longer target a Medication | No live pathway is affected (D11 evidence); the rule extends with any future withholding stage |
| Saved answers and overrides re-apply when their gate becomes reachable again, without re-asking | Follow-up F4 |
| Providers must confirm every tentative LLM verdict before generating (D3); an LLM outage blocks generation until gates are answered by hand | A provider can always answer the gate |
| An RxNav outage on a normalisation-cache miss blocks the mutation | Same as today; safety data is never skipped |
| Editing a draft ends its preview sessions (`SESSION_GRAPH_CHANGED`) | Follow-up F3 |
| A configuration change can alter the whole plan at the next mutation | D7 check at generation; `envFingerprint` recorded for diagnosis; historical pinning is review direction #4 |
| About 85 retired tests; 15 files mock the traversal adapter | §5.5 mapping table; scenarios preserved as sequence-vs-fresh tests |
| One lock per run; rapid answers across children conflict | Three server retries with request-local observation reuse (D9) |
| Root-level pair checks surface new findings in intended same-pathway combinations | Expected; recorded in the §5.8 before/after record; authors informed |
| Confidences change once propagation runs (§2) | §5.8 before/after record |

## Follow-ups after the core architecture lands

- **F1 — Pathway-qualified recommendation identity (review #5).** Use a `pathwayId/version/nodeId`
  identity everywhere a recommendation crosses pathway boundaries: normaliser maps, suppression
  sets, attribution, conflict candidates, disposition `findingIds`. **Required for §3 step 5's
  cross-pathway set check to be sound.**
- **F2 — ~~Model in the LLM verdict key~~.** Absorbed into the core by D10 / C1.
- **F3 — Automatic preview restart on draft edit**, carrying over answers, overrides and
  observations whose node ids still exist, instead of `SESSION_GRAPH_CHANGED`.
- **F4 — Re-ask stale answers.** Decide whether an answer to a gate that was unreachable for a
  period should be re-asked when the gate becomes reachable again, rather than silently
  re-applied.
- **F5 — Fingerprint-based child reuse.** Skip re-evaluating a child whose inputs and
  `envFingerprint` dependencies are unchanged. This is an optimisation of D13, only if the
  performance gate or later measurement calls for it.

## Out of scope

- **#9 reconverging branches.** First-writer-wins stays, now deterministic; pinned by a documented
  defect test.
- **#10 attribute address round trip** (`vitals.*` answers written under the wrong key).
- **#11 exhaustive persistence** of imaging, guidance, schedules and quality metrics.
- **Historical configuration pinning** (review direction #4).
- **Letting overrides acknowledge safety findings** (D4).
- **Red-flag acknowledgement.** `acknowledged` is never set in production code, so readiness
  treats every red flag as blocking.
- **The bare-string `depends_on` shape** found in the archived vaginitis pathway.
  - `validator.ts:246-248` on `main` still accepts bare strings, while `evaluatePriorNodeResult`
    reads `dep.node_id`.
  - That mismatch is the subject of branch `fix/gate-depends-on-strict-shape`, not of this spec.
