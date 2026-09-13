# Evaluation Pipeline — Design

**Date:** 2026-09-13
**Status:** Draft — awaiting review
**Repos:** `prism-graphql` (pathway-service), `prism-admin-dashboard`
**Baseline:** `main` @ `2454130` (merge of decision-semantics). Every `file:line` below refers to that commit.
**Source review:** `docs/reviews/2026-09-13-engine-architecture/review.md` on branch
`review/engine-architecture-2026-09-13` (11 findings; 8 reproduced by tests, all 11 verified).

## Why

The engine produces a care plan that depends on the **order in which things happened**, not
only on the facts. The review's findings share three root causes:

1. **Two copies of the same logic that drifted apart.** Full `traverse()` versus
   `resolveIncrementally()`. Single-pathway versus multi-pathway generation. Whole-graph scoring
   versus the one-node-at-a-time scoring traversal actually does.
2. **A node's status does not say who decided it.** An ancestor gate, a provider override and the
   DDI pass all write the same `status` field.
3. **Changes applied after a check never re-run the check.** Conflict choices are applied after
   DDI; stored merged plans are treated as current after a child session changes.

Examples of path-dependence reproduced on `main`:

- **Nested gates (#1).** Answer "no" to an outer gate, then update a lab, and the medication
  becomes INCLUDED again. Evaluating the same final facts from scratch leaves it excluded.
- **Conflict choices (#6).** Choose A, then B, and the plan holds A *and* B. Choosing B directly
  holds only B.
- **Merged plans (#2).** Answering a child gate with or without a client-side re-merge produces
  different plans.

Fixing these one by one has been tried for several review rounds. Each round's fix was correct
and each round found new instances, because the structure keeps producing them. This spec removes
the structure.

**The invariant this design establishes:** *the same inputs produce the same plan, however they
were arrived at.*

## Constraints

- **No users.** No compatibility seams, deprecation windows or dual paths. Existing sessions are
  purged. Authored pathways are untouched. (Carried from the decision-semantics spec.)
- **Scope is the pipeline core.** This spec targets review findings **#1, #2, #3, #6, #7**.
  Its persistence protocol also closes **#4** and **#8**, because every write goes through it.
- **Configuration is not pinned.** Weights, thresholds, the code map, DDI tables and the
  medication normalisation cache are read live at each evaluation. Pinning them is the review's
  architectural direction #4 and is out of scope. The determinism guarantee is therefore:
  *same inputs + same graph + same configuration → same result.*
- **One spec, several plans.** This design is implemented as a sequence of sub-plans, each
  independently mergeable with the suite green. The first sub-plan's first task is the
  performance gate (§5.6); nothing else starts until it passes.
- **ACTIVE pathway graphs are immutable.** DRAFT_UPDATE rewrites a draft's graph in place under
  the same `pathwayId` (`services/import/relational-writer.ts:173`). Activation is only possible
  from DRAFT (`resolvers/mutations/import.ts:74`).

## Decisions

| # | Decision | Rationale |
|---|---|---|
| D1 | **Recompute from recorded inputs** (not incremental + equivalence test, not event sourcing) | Removes the incremental path, the source of #1 and most prior review findings. Event sourcing adds versioning and snapshots that `pathway_resolution_events` already makes unnecessary. |
| D2 | **LLM verdicts are recorded and reused**, keyed by gate + sha256 of the text read | Otherwise recomputation calls the model again and the plan can change with no change in patient facts. |
| D3 | **Readiness blocks on every open pending question, tentative LLM verdicts included** | Today a tentative LLM gate is INCLUDED with only a `pendingQuestions` entry (`traversal-engine.ts:1087-1112`), and `validateForGeneration` checks node statuses only (`care-plan-generator.ts:107`), so a plan can be generated on an unconfirmed LLM guess. Because of D3, failed LLM calls need not be recorded: they cannot reach a plan unconfirmed. |
| D4 | **Safety outranks provider overrides** (today's behaviour, now explicit) | `applyDdiToResolutionState` suppresses any INCLUDED medication, overridden or not (`ddi-pass-single-pathway.ts:55`). Letting an override acknowledge a finding is a clinical decision deferred beyond this spec. |
| D5 | **In a multi-pathway run, the parent owns patient facts** | Today an escalated datum answered on child A lands only in A's `additionalContext`, invisible to B's gates. Gate answers, decision-point choices and overrides stay on the child, because they name pathway-local nodes. |
| D6 | **A multi-pathway run has one lock: the parent's `revision`** | Every write in a run leaves every cache fresh in one transaction, so there is no stale-read case to design. Cost: rapid answers on different children now conflict and retry. |
| D7 | **Generation requires `reviewedResultHash`** and returns `PLAN_CHANGED_SINCE_REVIEW` on mismatch | Configuration is live (see Constraints). The plan a provider reviewed must be the plan that is materialized. |
| D8 | **Purge all resolution sessions** in the migration | No users. The sessions carry neither graph fingerprints nor overrides-as-inputs. |
| D9 | **Three server-side retries** on revision conflict, then `CONFLICT` | Replaces the client's text-matching retry (`PendingGatesPanel.tsx:208-221`) and today's retry loop, which only one mutation has (`resolution.ts:551`). |

---

## §1 Session inputs and the `evaluate()` contract

A session stores **only what a person or the outside world told it**, plus a revision. Everything
else is derived and stored only as a read cache.

```ts
interface SessionInputs {
  pathwayId: string;
  graphFingerprint: string;                     // NEW — sha256 of canonical nodes + edges at start
  temporalContext: EvaluationTemporalContext;   // existing — pinned clock + policy version
  initialPatientContext: PatientContext;        // existing (parent-owned in a run, D5)
  additionalContext: AdditionalContextInput;    // existing, validated at the boundary (parent-owned in a run)
  gateAnswers: Map<NodeId, GateAnswer>;         // existing — questions, DecisionPoint choices,
                                                //   confirmations of tentative LLM gates
  providerOverrides: Map<NodeId, Override>;     // NEW — moved out of resolutionState
  llmVerdicts: Map<VerdictKey, LlmVerdict>;     // NEW — successful calls only (D2)
  revision: number;                             // NEW — integer; replaces updated_at locking
}

type VerdictKey = `${NodeId}::${string}`;       // gateId :: sha256(narrative)

evaluate(inputs: SessionInputs, env: EvaluationEnv, deps: EvaluationDeps): EvaluationResult

interface EvaluationResult {
  resolutionState: ResolutionState;             // includes safety dispositions (§2 stage 5)
  pendingQuestions: PendingQuestion[];
  redFlags: RedFlag[];
  safetyFindings: DdiFinding[];
  catchUpItems: CatchUpItem[];
  gateContextFields: Map<NodeId, string[]>;     // feeds evidence trail + data-gap hints
  readiness: { ready: boolean; blockers: Blocker[] };
  status: 'ACTIVE' | 'DEGRADED';
  newLlmVerdicts: Map<VerdictKey, LlmVerdict>;  // the caller records these as inputs
  resultHash: string;                           // see rule 8
}
```

Rules:

1. **Same `inputs` + same `env` → same result**, including `resultHash`.
2. **No incremental path.** `resolveIncrementally`, `promote` and `DependencyMap` (except
   `gateContextFields`, which becomes an output) are deleted. The event log's `statusChanges` is
   a diff of the previous cached `resolutionState` against the new one.
3. **Overrides keep today's meaning.** An override pins that one node's status, and a gate's
   sweep still descends *through* it (the existing `held` mechanism, which `traverse()` must now
   accept; see §2 stage 3).
4. **LLM verdicts.** A recorded verdict is reused whenever the gate reads the same text. New text
   causes a new call. A failed call is not recorded; it yields a tentative safe default, blocks
   readiness (D3) and is retried on the next evaluation.
5. **Timeouts.** The existing 10-second budget (`types.ts:552`) stays. A timed-out evaluation is
   cached as DEGRADED and blocks readiness. Inputs are untouched, so the next mutation recovers.
6. **Graph guard.** If `env.graphFingerprint !== inputs.graphFingerprint`, evaluation throws
   `SESSION_GRAPH_CHANGED`. This only occurs for draft pathways edited during a preview.
7. **Stated limitation.** Configuration is read live (see Constraints).
8. **`resultHash` covers exactly what a provider reviews.** It is sha256 over canonical JSON
   (object keys sorted, arrays in stable order) of:
   - for each node, sorted by `nodeId`: `{ nodeId, status, excludeReason, providerOverride.action,
     safety disposition }`;
   - `pendingQuestions` sorted by `gateId`; `redFlags` sorted by `(nodeId, type)`;
   - `safetyFindings` sorted by `(recommendationId, category, source)`;
   - `catchUpItems` sorted by `nodeId`;
   - `readiness.blockers` sorted by `(type, relatedNodeIds)`.

   **Excluded:** confidence values, durations, timestamps, LLM reasoning text and `revision`.
   A confidence change that alters a status is captured through the status itself.
   For a multi-pathway run, `RunResult.resultHash` covers the merged plan's recommendations,
   suppressions, conflicts with their derived resolutions, and the run's readiness blockers, plus
   every child's `resultHash` in `contributing_session_ids` order.

---

## §2 Pipeline stages

```
services/resolution/pipeline/
  load-env.ts       loadEvaluationEnv(pool, pathwayId) → EvaluationEnv  // every graph/config read, once
  evaluate.ts       evaluate(inputs, env, deps) → EvaluationResult      // runs stages 1–6 in order
  scores.ts         stage 2
  llm-verdicts.ts   verdict-backed LLM evaluator
  findings.ts       stage 4
  final-safety.ts   stage 5
  readiness.ts      stage 6
```

**`EvaluationEnv`** is plain data, loaded once: graph nodes and edges, the graph fingerprint,
signal definitions, thresholds, code map, temporal defaults, admin evidence entries, the weight
matrix, node weights and propagation overrides.

**`EvaluationDeps`** holds the only side-effecting clients: the LLM client, and the DDI and
normalisation functions. Those need `pool` and may call RxNav on a normalisation-cache miss.

| # | Stage | Behaviour | Replaces |
|---|---|---|---|
| 1 | **Context** | `buildEffectivePatientContext(initial, additional)`; fact store; `assertEncounterAnchor` | Six hand-built copies across the mutations |
| 2 | **Scores** | **One** `computePathwayConfidence` call over **all** nodes, passing the evidence and weights from `env`, producing a `ScoreMap`. | `makeTraversalAdapter` (`resolution-context.ts:337`), the `contextNodes` parameter, and four queries per scored node |
| 3 | **Traverse** | `traverse(graph, context, { scores, gateAnswers, overrides, llm })`. Overrides pre-seed `held`. The held-arrival handling that exists only in the incremental path (`traversal-engine.ts:831-847`) moves into the main loop, otherwise the existing-state skip at `:566` would freeze a pre-seeded override's subtree. The LLM evaluator reads `inputs.llmVerdicts` first and collects new successful verdicts. | `resolveIncrementally`, the adapter |
| 4 | **Findings** | Pending questions and red flags straight from traversal. Catch-up items for every INCLUDED Stage/Step via `findUnmetPrerequisites` (deduplicated). Emit `gateContextFields`. | `findings-reconciliation.ts`; catch-up computed only at multi start (`multi-pathway-resolution.ts:832-858`) |
| 5 | **Final safety** | Candidates: every INCLUDED Medication, **including provider-overridden ones** (D4). Check each against the patient's medications and allergies, and **check every candidate pair** (no same-pathway skip). A SUPPRESS finding sets the node EXCLUDED with the DDI reason and records a `safety` disposition, so the owner of the exclusion is explicit. | `refreshSessionDdi` (six call sites), in-place `applyDdiToResolutionState` |
| 6 | **Readiness** | Blockers: `EMPTY_PLAN` (after safety); `UNRESOLVED_RED_FLAG` (any red flag); `PENDING_GATE` (any PENDING_QUESTION node **or any `pendingQuestions` entry**, tentative included); `INCOMPLETE_RESOLUTION` (any TIMEOUT or UNKNOWN node). Derives `status`. | Both `validateForGeneration`s (`care-plan-generator.ts:107`, `multi-pathway-resolution.ts:1040`); `derivedSessionStatus` (`resolution.ts:168`); the DEGRADED check (`resolution.ts:1225`) |

**Known behaviour change at stage 2.** Confidence propagation never runs during traversal today.
Each node is scored alone, and `topologicalSort` (`confidence-engine.ts:406`) counts an incoming
edge from an unscored parent that it never decrements, so it reports a cycle and skips
propagation. This is the source of the live log's repeated "Cycle detected… 1 nodes, 99 edges"
warnings. Whole-graph scoring turns propagation on, so **confidences and auto-included actions
will change on existing pathways.** The review's fixture shows the size of the effect: 0.90 → 0.24.

**Errors.**

- **Throws and persists nothing:** `env` load failure, `SESSION_GRAPH_CHANGED`, database or RxNav
  failure during DDI.
- **Tentative, not an error:** LLM call failure.
- **Persisted as a DEGRADED cache:** timeout.

**Deleted as dead code.** All of `services/resolution/safety.ts`: nothing imports it except the
barrel (`services/resolution/index.ts:5`), so nothing produces `CASCADE_LIMIT`. The enum value
remains in the API.

---

## §3 Multi-pathway as composition

**Every write in a run leaves every cache fresh, in one transaction. Reads never recompute and
never write.**

### Data

- **Child sessions** gain `parent_session_id`. A child in a run stores only node-local inputs:
  `gateAnswers`, `providerOverrides`, `llmVerdicts`. It holds no patient facts (D5).
- **The parent** owns `initialPatientContext`, `additionalContext`, `temporalContext`,
  `conflict_resolutions` and the run's single `revision` (D6).
- **Derived, no longer stored:** `mergedPlan.conflicts[].resolution`.
- **Status.** The parent's `status` stays lifecycle-only (ACTIVE, COMPLETED, ABANDONED; the
  existing CHECK is unchanged). Incompleteness in a run is expressed through readiness blockers,
  not a DEGRADED parent status.
- **Child lifecycle follows the parent**, in the same transaction:
  - parent generation marks every child COMPLETED with the parent's `care_plan_id`;
  - abandoning the parent marks every child ABANDONED;
  - child-level `abandonSession` on a child in a run is rejected with
    `CHILD_OF_MULTI_PATHWAY_SESSION`.

### `composeRun(childResults, parentInputs, env, deps) → RunResult`

1. **Project** each child result, including catch-up items, `gateContextFields`, and the child's
   stage-5 suppressions as `suppressed` entries.
2. **Merge** with `mergeResolvedCarePlans`.
3. **Apply conflict decisions, derived rather than appended.** Start from the base merge and apply
   `conflict_resolutions`.
   - A decision whose chosen pathway is no longer a candidate becomes a
     `STALE_CONFLICT_DECISION` blocker. Today it is a `TypeError` at
     `multi-pathway-resolution.ts:989-991`.
   - A decision for a conflict that no longer exists is inert.
4. **Final safety** over the final medication set: provider write-ins, ACCEPT_BOTH additions and
   every pair, checked against the parent's effective context.
5. **Readiness:**
   - every child's blockers, tagged with their pathway;
   - `UNRESOLVED_CONFLICT`, a new type replacing the misused `PENDING_GATE` at
     `multi-pathway-resolution.ts:1047`;
   - `STALE_CONFLICT_DECISION`;
   - `EMPTY_PLAN`.

### Mutations

All of these hold the parent's revision lock.

| Mutation | Behaviour |
|---|---|
| `startMultiPathwayResolution` | Create the parent and children, evaluate each child, `composeRun`, persist everything. Zero matches takes the same path with no children. |
| `answerPendingDecision` / `overrideNode` on a child in a run | Record the input on the child; re-evaluate that child; `composeRun`; persist the child and parent. |
| `addPatientContext`, or an escalated-datum answer, on a child in a run | **Write the fact to the parent**; re-evaluate every child; `composeRun`; persist. |
| `resolveConflict` | Record the decision; `composeRun` (children unchanged); persist. |
| `generateMergedCarePlan` | Re-evaluate every child; `composeRun`; apply the D7 check; materialize (§4). |
| `generateCarePlanFromResolution` on a child in a run | Rejected with `CHILD_OF_MULTI_PATHWAY_SESSION`. |

### Removed

- `reMergeMultiPathwaySession` (resolver, SDL, admin callers).
- `buildResolvedPlansFromSessions`.
- Multi's `validateForGeneration`.
- `runMergePipeline` stage 1: the pre-merge DDI, now covered by child stage 5.

The admin UI keeps its existing parent refetch after an answer
(`prism-admin-dashboard/src/app/encounter/page.tsx:392`).

### Out of scope, stated

- Empty-plan detection keeps today's medications/labs/procedures definition (review #11).
- Recommendation identities remain pathway-local (review #5; Follow-up F1). **Until F1 lands,
  step 4's cross-pathway pair check can alias two different drugs that share a node id.**

---

## §4 Mutation and persistence protocol

### One write path: `commitEvaluation`

```
for attempt in 1..3:
  load inputs + revision                  (the parent's, for a multi-pathway run)
  inputs' = applyChange(inputs)           // boundary validation; BAD_USER_INPUT is not retried
  result  = evaluate(...) | composeRun(...)   // outside the transaction (LLM, DDI I/O)
  BEGIN
    UPDATE … SET <inputs'>, <cache>, result_hash, revision = revision + 1
      WHERE id = $id AND revision = $r    // 0 rows → ROLLBACK, next attempt
    child rows (runs); events (statusChanges = diff); LLM audit rows
  COMMIT → return
throw CONFLICT
```

- A retry re-evaluates, which is cheap because verdicts recorded by the earlier attempt are reused.
- **Kept unchanged at the boundary:**
  - `firstTrustAssertion` and `normalizeContextEntryNulls` (`resolution.ts:1017-1028`);
  - `validateAnswerAgainstGate`;
  - the DecisionPoint candidate check (`:584-594`);
  - the escalated `numericValue` check (`:721-727`);
  - `assertKnownPolicyVersion`.
- `abandonSession` uses this path and gains a status guard. Today a COMPLETED session can be
  abandoned (`resolution.ts:1441-1457`).

### Generation

```
result = evaluate(...) | composeRun(...)
if result.resultHash ≠ args.reviewedResultHash → persist fresh cache; return PLAN_CHANGED_SINCE_REVIEW
if result.readiness.blockers non-empty → persist cache if changed; return blockers
BEGIN
  UPDATE session SET status = 'COMPLETED', revision = revision + 1
    WHERE id = $id AND revision = $r AND status IN ('ACTIVE','DEGRADED')   // claim first
  INSERT care plan rows; UPDATE session SET care_plan_id
COMMIT
```

- **The claim precedes the inserts**, so a failure rolls back both. This closes #8 and removes
  the non-truncated timestamp predicate of #4 (`resolution.ts:1385`).
- **Idempotent:** generation on a COMPLETED session returns its existing `carePlanId` as success.
- The claimable statuses are `('ACTIVE','DEGRADED')` for `pathway_resolution_sessions` and
  `('ACTIVE')` for `multi_pathway_resolution_sessions`. Readiness has already refused a degraded
  result by this point; DEGRADED is listed only so a stale cached status never causes a spurious
  claim failure.
- Single-pathway and multi-pathway generation both follow this sequence. Materialization itself
  (`generateCarePlan`, `materializeCarePlan`) is unchanged apart from running inside the claimed
  transaction.

### Migration `067_evaluation_inputs.sql`

No migration numbered 067 or above exists on any branch as of this spec.

1. **Purge (D8).**
   - `DELETE FROM multi_pathway_resolution_sessions; DELETE FROM pathway_resolution_sessions;`
   - Cascades to events (042), decisions (038), analytics (043) and LLM evaluations (057).
   - Generated care plans have no foreign key to sessions and are untouched.
2. **`pathway_resolution_sessions`:**
   - Add `revision INT NOT NULL DEFAULT 0`, `provider_overrides JSONB NOT NULL DEFAULT '{}'`,
     `llm_verdicts JSONB NOT NULL DEFAULT '{}'`, `graph_fingerprint TEXT NOT NULL`,
     `result_hash TEXT NOT NULL`, `readiness JSONB NOT NULL`,
     `gate_context_fields JSONB NOT NULL DEFAULT '{}'`,
     `catch_up_items JSONB NOT NULL DEFAULT '[]'`.
   - Add `parent_session_id UUID REFERENCES multi_pathway_resolution_sessions(id) ON DELETE
     CASCADE`, indexed.
   - `DROP COLUMN dependency_map`. `ALTER COLUMN temporal_context SET NOT NULL`.
   - `CHECK (parent_session_id IS NULL OR additional_context = '{}'::jsonb)`.
3. **`multi_pathway_resolution_sessions`:**
   - Add `revision INT NOT NULL DEFAULT 0`,
     `additional_context JSONB NOT NULL DEFAULT '{}'`, `result_hash TEXT NOT NULL`,
     `readiness JSONB NOT NULL`.
   - `ALTER COLUMN temporal_context SET NOT NULL`.
   - `contributing_*` arrays are written once, at start.
4. **`pathway_resolution_events`:** extend the `event_type` CHECK (042:46-50) with
   `'BRANCH_CHOSEN'` and `'PROVIDER_ASSERTED_DATUM'`, unless the separate fix in *Live defects*
   ships first.

### API changes (admin dashboard is the only client)

- `BlockerType` gains `UNRESOLVED_CONFLICT`, `STALE_CONFLICT_DECISION`,
  `PLAN_CHANGED_SINCE_REVIEW`.
- `ResolutionSession` and `MultiPathwayResolutionSession` expose `revision: Int!` and
  `resultHash: String!`.
- `generateCarePlanFromResolution` and `generateMergedCarePlan` take
  `reviewedResultHash: String!`.
- **Removed:** `reMergeMultiPathwaySession`, and the `answerGateQuestion` alias (no callers in any
  client).
- **Error codes:** `CONFLICT`, `SESSION_GRAPH_CHANGED`, `CHILD_OF_MULTI_PATHWAY_SESSION`.

### Deployment

- Breaking API change: the backend and admin dashboard deploy together.
- Apply 067 through the documented manual psql workflow (the migrator CLI is broken).
- Preview sessions open at deploy time are lost.

---

## §5 Testing

1. **Acceptance: the review's reproductions.** Port `reproductions.patch` to the new API (input
   sequences through `commitEvaluation` against an in-memory store).
   - **Must pass:** #1 nested gates, #3 scoring, #2 merged generation readiness, #6 conflict
     replacement, #7 custom-override DDI.
   - **Kept as pinned, documented defect tests** so the suite stays green: #10 vital answer round
     trip, #5 drug-id aliasing (F1), #9 shared downstream action.
2. **Path-independence properties.** Add `fast-check` as a pathway-service devDependency (it is
   imported by `tests/property-based/security-properties.test.ts` but not installed).
   - **Generators:**
     - valid graphs mixing nested gates, DecisionPoints, reconverging branches and medications,
       with a deterministic scorer stub;
     - edit sequences: answer, re-answer, override, add fact, conflict choice, change choice.
   - **Properties:**
     - (a) applying edits one at a time equals `evaluate(finalInputs)`;
     - (b) independent edits in any order give equal results;
     - (c) `evaluate` twice → deep-equal results and identical `resultHash`.
3. **Stage tests.**
   - **Scores:** whole-graph propagation gives 0.24 on the existing fixture.
   - **LLM verdicts:** reuse on the same text, a call on new text, a failed call not recorded.
   - **Final safety:** an overridden medication can be suppressed; same-pathway pairs are checked;
     write-ins are checked.
   - **Readiness:** tentative LLM, TIMEOUT and a stale conflict decision each block.
   - **`composeRun`:**
     - a changed choice replaces the old one;
     - a fact supplied on child A reaches child B;
     - a stale decision yields a blocker and does not throw.
4. **Retired-test conversion.** About 85 tests in about 14 files chiefly exercise deleted code
   (see *What this removes*).
   - **Mapping table:** the implementation plan carries one row per retired test, pointing to its
     replacement sequence-vs-fresh test or giving a written reason for dropping it.
   - **Assert the positive, then revert the fix and watch the test fail.**
   - Test files are not typechecked (ts-jest `diagnostics: false`), so every invariant also needs
     a runtime throw.
5. **Real Postgres, opt-in** (`*.pg.test.ts`, gated by an env var, required before merge).
   - **Revision lock:** two concurrent writes, one wins and one retries.
   - **Generation:** two concurrent generations yield exactly one care plan.
   - **Idempotency:** generation on a COMPLETED session returns its existing id.
   - **Migration 067:** applied to a database copy; purge cascade; the child-facts CHECK.
6. **Performance gate — first task of the plan.** Import `chronic_htn_pregnancy_care_pathway.json`
   (admin repo `docs/`; 108 nodes, 113 edges) into a test database. Stub the LLM.
   - **Budget:** p95 `evaluate` **< 2 s** for a single-pathway mutation, and **< 5 s** for a fact
     submitted to a 5-child run.
   - **If the budget fails,** stop and revisit D1 before further work.
7. **Before/after record.** Extend `baseline-capture.test.ts` to record anemia-in-pregnancy v1.4
   before and after.
   - **Expected differences:** confidence propagation, the new readiness blockers, same-pathway
     DDI findings.
   - **Anything else is a defect.**
8. **Suite invariant.** The nine pre-existing `patient-match-scorer` / `data-completeness-scorer`
   failures remain the only failures.
9. **Admin dashboard** (no test suite): a manual smoke test in the encounter simulator and pathway
   preview.
   - Answering refreshes without re-merge.
   - The `PLAN_CHANGED_SINCE_REVIEW` flow.
   - Changing a conflict choice.
   - A fact supplied on one pathway resolves another's gate.

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
- All of `safety.ts`.
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
- **`runCrossRecommendationDdi`:** the same-pathway skip.
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

- **The `held` and `provisional` mechanisms.** `provisional` is used by full traversal.
  `held` moves into it.
- **`gateContextFields`**, which becomes a pipeline output feeding
  `care-plan-projection.ts:211`, `:280`.
- **Boundary validation** (listed in §4).
- **Audit logging:** `logEvent`, `logNodeOverride`, `logGateAnswer`, `flushAudits`.
- **The GraphQL fields `statusChanges` and `nodesRecomputed`.**
- **`pendingGateQuestions`**, which carries the child `sessionId` that answers are routed to.

## Defects this design fixes by construction

These are beyond the review's findings, found while verifying it.

- **Re-merge drops catch-up items** (`multi-pathway-resolution.ts:758` passes `[]`).
- **Multi-start children get no DDI pass** (`:864-878`). Later suppressions then vanish without
  a `suppressed` entry.
- **DecisionPoint answers build the engine without the LLM evaluator** (`resolution.ts:621-628`),
  so LLM gates under a chosen branch fall back to their safe default.
- **Re-merge crash:** re-merge replays a stale conflict choice into a non-null assertion
  (`multi-pathway-resolution.ts:989-991`), throws, and the session can never re-merge again.
- **Merged generation ignores child state:** it reads the stored merged plan and never checks
  children's readiness.
- **An override of a gate or step does not re-dispose its subtree:** `influences` only records
  `prior_node_result` readers and DecisionPoint branches.

## Live defects not fixed by this design (separate small fixes)

- **`BRANCH_CHOSEN` and `PROVIDER_ASSERTED_DATUM` violate the `event_type` CHECK** (042:46-50;
  verified from migrations, not the live database).
  - A branch choice logs after persisting (`resolution.ts:692`), so the request likely errors
    after its state is saved.
  - An escalated-datum answer logs before persisting (`:745`), so it likely fails before
    anything is saved.
- **`abandonSession` has no status guard** (`resolution.ts:1441`). §4 also fixes this; listed
  here in case it is patched earlier.

## Trade-offs accepted

| Cost | Mitigation |
|---|---|
| Every mutation runs a full evaluation (a fact in a run: N children) | Performance gate (§5.6); whole-graph scoring removes about 4 queries per node; verdict reuse removes repeat LLM calls |
| Saved answers and overrides re-apply when their gate becomes reachable again, without re-asking | Follow-up F4 |
| Providers must confirm every tentative LLM verdict before generating (D3); an LLM outage blocks generation until gates are answered by hand | A provider can always answer the gate |
| Editing a draft ends its preview sessions (`SESSION_GRAPH_CHANGED`) | Follow-up F3 |
| A verdict is reused if the model configuration changes but the text is the same | Follow-up F2 |
| A configuration change can alter the whole plan at the next mutation | D7 check at generation; pinning is review direction #4 |
| About 85 retired tests; 15 files mock the traversal adapter | §5.4 mapping table; scenarios preserved as sequence-vs-fresh tests |
| One lock per run; rapid answers across children conflict | Three server retries (D9) |
| Checking same-pathway medication pairs surfaces new findings in intended combinations | Expected and recorded in the §5.7 before/after record; authors informed |
| Confidences change once propagation runs (§2) | §5.7 before/after record |

## Follow-ups after the core architecture lands

- **F1 — Pathway-qualified recommendation identity (review #5).** Use a
  `pathwayId/version/nodeId` identity everywhere a recommendation crosses pathway boundaries:
  normaliser maps, suppression sets, attribution, conflict candidates. **Required for §3 step 4's
  cross-pathway safety check to be sound.**
- **F2 — Model in the LLM verdict key.** A change of model configuration with unchanged input text
  currently reuses the old model's verdict.
- **F3 — Automatic preview restart on draft edit**, carrying over answers, overrides and verdicts
  whose node ids still exist, instead of `SESSION_GRAPH_CHANGED`.
- **F4 — Re-ask stale answers.** Decide whether an answer to a gate that was unreachable for a
  period should be re-asked when the gate becomes reachable again, rather than silently
  re-applied.

## Out of scope

- **#9 reconverging branches.** First-writer-wins stays and is now deterministic. It is pinned by
  a documented defect test.
- **#10 attribute address round trip** (`vitals.*` answers written under the wrong key).
- **#11 exhaustive persistence of imaging, guidance, schedules and quality metrics.**
- **Pinning configuration** (review direction #4).
- **Letting overrides acknowledge safety findings** (D4).
- **Red-flag acknowledgement.** `acknowledged` is never set in production code; readiness treats
  every red flag as blocking.
