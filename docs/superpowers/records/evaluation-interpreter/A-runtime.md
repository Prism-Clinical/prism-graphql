# A — Runtime flows and persistence (discovery items 1, 7)

Code: `prism-graphql` main @ d377465 (= live), service `apps/pathway-service/src` (paths below are relative to it unless prefixed). Admin: `prism-admin-dashboard` master @ bc6ba48. I read everything below directly. Items I did not verify are marked **[unverified]**.

Abbreviations: `P/` = `services/resolution/pipeline/`, `SS` = `services/resolution/session-store.ts`, `MS` = `services/resolution/multi-pathway-session-store.ts`, `RES` = `resolvers/mutations/resolution.ts`, `MPR` = `resolvers/mutations/multi-pathway-resolution.ts`.

---

## 0. Shared machinery (every flow uses this)

### 0.1 Request object and observation reuse
- `EvaluationRequest = { requestObservations: Map<key, LlmObservation>, audits: LlmAuditRow[] }`, created once per GraphQL request by `newRequest()` (P/request.ts:17-23). It lives **outside** the retry loop, so it survives retries (D9).
- A run uses `RunRequest = Map<pathwayId, EvaluationRequest>` (P/run.ts:78-89, `requestFor`). Audit rows are kept per child because they are filed under the child's session id.
- `liveObservations(session, request, client, model)` (P/observations.ts:65-107) is the LLM evaluator that the TraversalEngine calls:
  1. It computes `key = observationKey(gate, gateId, narrative, model)` (:31-40). The key is `sha256(canonicalJson({gateId, prompt ?? title, branches[{name,description}], inputAttribute, narrative, model}))`. `confidence_threshold` is deliberately left out (D10). `narrative` = `resolveDottedPath(patient, gate.input_attribute)` if that is a string, else `''` (:22-25). `model` = `env.llmModel` = `loadLLMGateConfig()?.model ?? ''`, which comes from config/env vars, not from the response.
  2. If the session map or the request map has the key, it returns that observation and adds the key to `used` (:79-83). No call is made.
  3. If there is no client, or this key already failed **in this attempt**, it returns UNAVAILABLE (`failed:true`, the gate takes its safe default tentatively, D3) (:84). `failedThisAttempt` is scoped to one provider, which is one attempt, so a later retry calls the LLM again.
  4. Otherwise it calls the LLM. On success it does `request.set(key, obs)` and `used.add(key)`. The stored `obs.model` is the **response's** `out.model`, while the key uses the configured model (:94-98).
- `replayObservations(frozen, model)` (:51-63) is the deterministic replay provider. No production caller uses it; only tests do **[unverified: grep only on non-test src]**.
- **Persistence of observations:** `persistedObservations(inputs, request, result)` (P/request.ts:60-71) = **all** of the session's existing observations plus the request observations whose key is in `result.observationsUsed`. The session's observation map only grows: stale keys are never pruned. `observationsUsed` is sorted and is **not** part of `resultHash`.

### 0.2 When the LLM is called relative to transactions
`evaluateSession` (P/request.ts:39-57) runs in this order:
1. `buildEffectivePatientContext`
2. `loadEvaluationEnv`: a snapshot transaction, **opened and closed** (§0.3)
3. `prewarmInBackground` (not awaited)
4. `auditingLlmClient` + `liveObservations`
5. `evaluateAs` → `evaluate`, where the LLM calls happen

So LLM calls happen with **no DB transaction or pooled client held**, after the snapshot closes and before the write transaction opens. The same is true for runs (`evaluateRun`, P/run.ts:111-152). There, children are evaluated **sequentially** (`for … await`, :128-142), so their LLM latencies add up.

### 0.3 Snapshot (load-env) and fingerprints
- `inSnapshot` (P/load-env.ts:67-80) runs `BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY` on one pooled client and commits before returning.
- `loadEvaluationEnv(pool, pathwayId, {patient, writeIns?})` (:127-135) reads the following:
  - `readPathway` → `buildResolutionContext` (`resolvers/helpers/resolution-context.ts:281-321`): `pathway_graph_index.age_node_id, temporal_defaults`, AGE graph (`fetchGraphFromAGE`), active `confidence_signal_definitions`, thresholds via `sharedCascadeResolver.resolveThresholds`, and `loadAttributeCodeMap`.
  - `confidenceEngine.loadScoringConfig`: admin evidence, node weights, overrides (confidence-engine.ts:88-121).
  - `loadSafetyReference`: `medication_normalization_cache` and `drug_interactions` for the candidate universe, which is every Medication node + patient meds + write-ins (:94-100).
- **Snapshot leak:** `loadAttributeCodeMap` (services/resolution/attribute-code-map.ts:4-28) keeps a **process-wide cache that is never invalidated** (only a test hook clears it). After the first load, the code map does not come from the snapshot. It still feeds `envFingerprint`, so the fingerprint reflects the cached map, not the database.
- `graphFingerprint = sha256(sorted nodes{id,type,properties} + sorted edges{source,target,type,properties})` (:55-64).
- `envFingerprint` (single) = `sha256({graphFingerprint, signals, thresholds, codeMap, temporalDefaults, scoring, safety, llmModel})` (:111-125).
- Run `envFingerprint` = `sha256(sorted [pathwayId, childEnvFingerprint])` (`runEnvOf`, :168-175). Every child env shares one `SafetyReference` loaded over the whole run universe (:142-159). A child's own envFingerprint therefore covers the run-wide safety data.
- **Where fingerprints are compared:**
  - `graphFingerprint`: only in `evaluate` (P/evaluate.ts:36-38). A mismatch throws `EvaluationError('SESSION_GRAPH_CHANGED')`, which `evaluateAs` turns into a GraphQLError with that code (P/request.ts:74-88). This is **not retried**, and it makes the session permanently un-evaluable: every mutation and generation fails. Only abandon (no evaluation) still works. For a run, **any** child's graph change kills the whole run.
  - `envFingerprint`: **never compared anywhere**. It is only stored (`SS:104`, `MS:233`) and exposed (Query.ts:116, MPR:774). Grep confirmed.
- Graph pinning at start: the inputs carry `graphFingerprint: ''` and `{pinGraph:true}` replaces it with the snapshot's (P/request.ts:50; run: P/run.ts:131).

### 0.4 Hashes
- `resultHashOf` (P/evaluate.ts:114-136) is a sha256 of canonical JSON over:
  - sorted nodes `{nodeId, eligibility.status, disposition.status, withheldBy, excludeReason, override.action}`;
  - pendingQuestions sorted by gateId, minus `tentativeReasoning`/`tentativeConfidence`;
  - redFlags;
  - safetyFindings minus `meta`;
  - catchUpItems;
  - blockers.

  It excludes confidences, durations, envFingerprint, status and observationsUsed. `canonicalJson` (P/canonical.ts) sorts object keys, Map entries and Sets, and preserves array order.
- `runHashOf` (P/compose.ts:296-319) covers:
  - the merged plan without evidenceTrail, dataGapHints or conflicts;
  - the conflicts with their decisions (kind/chosenPathwayId/customMedication only, not resolvedBy/resolvedAt/reason);
  - the root safetyFindings minus meta;
  - the root blockers, including description;
  - the list of child `resultHash` in contributing order.
- **Child result_hash vs child resolution_state:** `RunChildResult.result` carries the root's withholding applied to `resolutionState` (`withholdAt`, P/compose.ts:206-210, 321-331), but `resultHash` "stays the contribution's own" (P/types.ts:84-89). The child row therefore stores a `result_hash` computed over the **pre-withholding** state next to a **post-withholding** `resolution_state`. The run hash consumes the child's pre-withholding hash. Root withholdings are covered separately, through the merged plan.

### 0.5 Write path, compare-and-set, retries, isolation
- `inTransaction(pool, fn)` (P/request.ts:116-129) issues a plain `BEGIN`, so **READ COMMITTED** (Postgres default). Every write transaction goes through it except `deletePreviewSession`, which uses its own BEGIN, also READ COMMITTED.
- **Compare-and-set, single session:** `writeEvaluation` (SS:153-166):

  `UPDATE pathway_resolution_sessions SET <evaluationColumns>, revision=revision+1, updated_at=NOW() WHERE id=$ AND revision=$expected AND status IN ('ACTIVE','DEGRADED')`

  It returns `rowCount===1`. Under READ COMMITTED a concurrent committed UPDATE triggers a re-check of the WHERE, so CAS is sound.
- `evaluationColumns` (SS:84-109):
  - inputs: `status, additional_context, gate_answers, provider_overrides, observations`;
  - cache: `resolution_state, pending_questions, red_flags, ddi_warnings (WARN findings only), readiness, gate_context_fields, catch_up_items, env_fingerprint, result_hash, total_nodes_evaluated, traversal_duration_ms`.
- **Compare-and-set, run:** `writeRunEvaluation` (MS:282-302) uses the same shape on `multi_pathway_resolution_sessions`, with `WHERE … AND revision=$ AND status='ACTIVE'`. Its columns (`runColumns`, MS:220-236) are `status, additional_context, conflict_resolutions, merged_plan, ddi_warnings, readiness, env_fingerprint, result_hash`.
- **Children are never compared-and-set.** `writeChildEvaluation` (SS:193-208) is an unconditional `UPDATE … revision=revision+1 WHERE id=$ AND parent_session_id IS NOT NULL`. It throws if rowCount≠1. The child always writes `additional_context={}` (D5; DB CHECK `pathway_resolution_sessions_child_has_no_facts`, migration 067). A child's `revision` is incremented but never read as a lock; `ChildInputs.revision` is carried and ignored.
- **Retry loop:** `MAX_ATTEMPTS = 3` (P/commit.ts:10). That is 3 **attempts** (2 retries), while the spec text for D9 says "three server-side retries". What is retried is the whole attempt:
  1. reload the session (`getSession` re-reads the row **and all events**);
  2. check it is not a child of a run and is mutable;
  3. re-run `applyChange` (boundary validation re-runs against the reloaded cache);
  4. take a new env snapshot and re-evaluate from scratch, reusing request observations whose keys match.

  Only `RevisionConflict` is retried (P/commit.ts:119-121). Boundary GraphQLErrors, SESSION_GRAPH_CHANGED and DB errors propagate. When attempts run out: `CONFLICT` ("Session changed concurrently on 3 attempts").
- **Audit rows:**
  - `auditingLlmClient` (P/llm-audit.ts:12-56) pushes one `LlmAuditRow` per **real** call, success or failure. The failure row has `tentative:true` and `errorMessage`. Success `tentative = confidence < (gate.confidence_threshold ?? 0.75)`.
  - Rows from **all** attempts are written in the winning transaction (P/commit.ts:117), then cleared (:123).
  - `withAudits` (P/commit.ts:63-76) writes any leftovers in a separate transaction on every other exit (CONFLICT, validation error, evaluation error). This is best effort and logged. Run analogue: `withRunAudits`/`flushRunAudits` (P/run-commit.ts:91-121).
  - Table: `llm_gate_evaluations` (session_id FK ON DELETE CASCADE, migration 057).

---

## 1. Single-pathway flows

### 1.1 startResolution — RES:379-466
1. `SELECT PATHWAY_COLUMNS FROM pathway_graph_index` (not in the snapshot). It rejects when not found or `status !== 'ACTIVE'`. `pathway.version` comes from this read, **outside** the snapshot (minor TOCTOU against the graph).
2. Boundary checks: `parseResolutionInput` → `assertAssemblableMode` (only SYNTHETIC) → `toPatientContext` → `resolveTemporalPolicyVersion(context)` → `makeEvaluationTemporalContext` (reads the wall clock once) → `assertKnownPolicyVersion` → `factStoreForInput` (validation only).
3. `evaluateSession(pool, newRequest(), {graphFingerprint:'', additionalContext:{}, gateAnswers/overrides/observations: empty, revision:0}, 'ROOT', {pinGraph:true})` (:425-436).
4. An empty graph throws INTERNAL_SERVER_ERROR. This check runs **after** evaluation (:437-439).
5. One `inTransaction` (:441-463):
   - `insertSession` (SS:126-146) inserts all columns: identity, `initial_patient_context, temporal_context, graph_fingerprint, parent_session_id=null`, plus evaluationColumns, `revision` DEFAULT 0;
   - `writeLlmAudits(id)`;
   - `logEvent('traversal_complete', statusChanges: [])`.

   There is **no retry and no CAS** because the row is new.
6. Response: `formatSessionForGraphQL(await loadSession(...))` (Query.ts:83-140). Nodes are bucketed by `status` into included/excluded/gatedOut, with `revision, resultHash, envFingerprint`, pendingQuestions, redFlags, events, ddiWarnings. **Readiness/blockers are not exposed** on `ResolutionSession` (schema.graphql:1026-1047). They only surface through generation.

### 1.2 answerPendingDecision / overrideNode / addPatientContext
- Resolvers:
  - `answerPendingDecision` (RES:480-487) → `commitSession(pool, id, s => answerChange(s,args))`
  - `overrideNode` (RES:468-474) → `overrideChange`
  - `addPatientContext` (RES:489-509) first runs `firstTrustAssertion` (reject) and `normalizeContextEntryNulls`, then `contextChange`.
- `commitSession` (RES:306-311): `loadSession` once to route. A standalone session goes to `commitEvaluation`. A child goes to `commitRun(parentId, r => childChange(r, id, build))` (§2.2).
- Change builders. All start from `inputsOf(session)` fresh copies (SS:263-278), and all validate against the **cached** result, not the fresh evaluation:
  - `answerChange` (RES:169-246) has three cases:
    - **DecisionPoint:** `selectedOption` must be in the cached `pendingQuestions[].options`. It sets `gateAnswers[nodeId]={selectedOption}`. Event `BRANCH_CHOSEN`.
    - **Escalated datum** (`pending.askTarget`): requires `numericValue`. It merges a fact into `additionalContext` (lab dated at `temporalContext.evaluationAsOf`, vital, or flat patientAttribute). Event `PROVIDER_ASSERTED_DATUM`.
    - **Question gate:** `validateAnswerAgainstGate`, then `gateAnswers.set`. Event `gate_answer`, and `record` → `logGateAnswer` into `pathway_gate_answers`, where `gateOpened` comes from the **new** result's node status.
  - `overrideChange` (RES:249-281): `originalStatus/Confidence` are taken from the prior override or the **cached** node, and `providerOverrides.set`. Event `override`. `record` → `logNodeOverride` into `pathway_node_overrides` (action lower-cased).
  - `contextChange` (RES:284-298): `mergeAdditionalContext` (facts accumulate). Event `context_update` with `addedContext` keys.
- `commitEvaluation` (P/commit.ts:86-128), per attempt:
  1. `loadSession`, `parentSessionId` guard, `assertMutable` (ACTIVE|DEGRADED);
  2. `applyChange`;
  3. `evaluateSession(..., 'ROOT')`;
  4. `inTransaction`:
     - `writeEvaluation(expectedRevision=session.revision, observations=persistedObservations, status=statusOf(result))`; 0 rows → RevisionConflict;
     - `logEvent(change.event, nodesRecomputed=state.size, statusChanges=statusChangesBetween(cached, new))`;
     - `change.record(db, result)`;
     - `writeLlmAudits`.
- After commit: `loadSession` again, then `formatSessionForGraphQL`.

### 1.3 generateCarePlanFromResolution — RES:524-601
Own loop, `MAX_ATTEMPTS`, wrapped in `withAudits`. Per attempt:
1. `loadSession`. A child of a run → `CHILD_OF_MULTI_PATHWAY_SESSION`.
2. **Idempotent completed:** `status===COMPLETED` → `{success:true, carePlanId: session.carePlanId, warnings:[], blockers:[]}` (:537-539). No evaluation. The original warnings are **not** replayed.
3. `ABANDONED` → BAD_REQUEST. Then `assertMutable`.
4. `evaluateSession(inputsOf(session), 'ROOT')`. `planChanged = result.resultHash !== args.reviewedResultHash` (:550). **This is the reviewed-hash check.**
5. If `planChanged || !ready`:
   - `inTransaction`: `writeEvaluation(status=statusOf)` (CAS) and `writeLlmAudits`.
   - Return `success:false`, blockers = `[PLAN_CHANGED_SINCE_REVIEW]` if changed, else the readiness blockers.
   - It **always** writes, bumping the revision even when nothing changed. The spec says "commit cache if changed".
6. Otherwise:
   - `generateCarePlan(result.resolutionState, …)` is computed in memory.
   - Then one `inTransaction`:
     - **Claim first:** `writeEvaluation(status=COMPLETED)` (CAS, `status IN (ACTIVE,DEGRADED)`);
     - `insertCarePlanRows`: `patients` placeholder upsert, `patient_care_plans` ('DRAFT'), `patient_care_plan_goals`, `patient_care_plan_interventions` with provenance in `guideline_reference`;
     - `setCarePlanId`: unconditional UPDATE;
     - `writeLlmAudits`;
     - `logEvent('care_plan_generated')`.
7. Errors: RevisionConflict → `continue`. A GraphQLError is rethrown. Any other error is wrapped as INTERNAL_SERVER_ERROR, "transaction rolled back".

### 1.4 abandonSession — RES:604-634
- No evaluation. It loops `MAX_ATTEMPTS`: `loadSession`, child guard, `assertMutable`.
- `inTransaction`:
  - `writeLifecycleStatus(ABANDONED)` (SS:169-180): CAS on revision plus `status IN (ACTIVE,DEGRADED)`;
  - `logEvent('abandoned')`.
- Returns the reloaded session.

---

## 2. Multi-pathway flows

A run is a parent `multi_pathway_resolution_sessions` row plus child `pathway_resolution_sessions` rows (`parent_session_id` FK ON DELETE CASCADE, migration 067).

The parent owns the patient facts: `initial_patient_context`, `additional_context`, `temporal_context`, `conflict_resolutions` and the only lock `revision` (migration 068).

A child keeps a copy of the initial context, its own `gate_answers`, `provider_overrides`, `observations` and `graph_fingerprint`.

### 2.1 startMultiPathwayResolution — MPR:142-297
1. Boundary checks: `parseResolutionInput` → `assertAssemblableMode` → `toPatientContext` → the `syntheticPatient` must be SYNTHETIC guard → matcher options → `isPreview = syntheticPatient===true` (not role-gated) → policy version → clock → `assertKnownPolicyVersion` → `factStoreForInput`.
2. `getMatchedPathways` (SS:448-606, outside any snapshot) → `collapseLattice`.
3. `evaluateRun(pool, newRunRequest(), {conflictResolutions:{}, children: surviving.map(... graphFingerprint:'')}, {pinGraphs:true})` (:232-250):
   - one `loadRunEnv` snapshot over all pathways and `pathway_graph_index` metadata;
   - children with empty graphs are **dropped silently** (P/run.ts:130);
   - each child is evaluated at `CONTRIBUTION` scope with the parent's facts (`sessionInputsOf`);
   - then `composeRun`.
4. One `inTransaction` (:256-294):
   - `insertRun` (MS:250-265) writes identity, inputs and runColumns with status ACTIVE;
   - per child:
     - `insertSession(parentSessionId=id, additionalContext:{}, observations=persistedObservations(child))`;
     - `writeLlmAudits(childId, req.audits)`;
     - `logEvent(child,'traversal_complete')`;
   - `setContributingSessions(ids, pathwayIds)`.

   There is no CAS or retry because the rows are new. **Zero matches** still stores a run: no children, with `EMPTY_PLAN` at the root.
5. Response: `formatSessionForGraphQL(getMultiPathwaySession)` (MPR:766-784). Readiness is **not** exposed.

### 2.2 Child answer / override / fact via the run
- The same resolvers as §1.2 route to `commitRun(parentId, r => childChange(r, childId, build))` (RES:309-310).
- `childChange` (P/run-commit.ts:178-203):
  - It builds a **view** of the child with the parent's facts and clock, then runs the single-pathway builder on it. Validation therefore reads the child's cached post-withholding state and pendingQuestions.
  - `inputs = runInputsOf(run)`. The parent's `additionalContext` is replaced with the builder's. The target child gets the new `gateAnswers`/`providerOverrides`.
  - Events: if `canonicalJson(additionalContext)` changed (a fact), the event is logged on **every** child. Otherwise it is logged only on the target child.
  - `record` is re-bound to the target child's composed result.
- `commitRun` (P/run-commit.ts:131-169), `withRunAudits`, per attempt (`MAX_ATTEMPTS`):
  1. `loadRun`: the parent row, then each child via `getSession`. These are separate, non-transactional reads. The children are always as new as or newer than the parent, so the parent CAS catches any skew.
  2. `assertRunMutable` (parent ACTIVE), then `applyChange`.
  3. `evaluateRun(...)` re-evaluates **every** child under one new snapshot (D13).
  4. `inTransaction`:
     - `writeRun(db, run, ev, request, 'ACTIVE')` (:64-88): `writeRunEvaluation` is the parent CAS; 0 rows → RevisionConflict. Then for each child: `writeChildEvaluation(status=statusOf(child))` + `writeLlmAudits(child)`;
     - events per `change.events` (statusChanges = cached child state vs composed child state);
     - `change.record`.
- Response: the child's `ResolutionSession` from the reloaded run (RES:310), formatted as a single session. The admin selects only `{ id }`.

### 2.3 resolveConflict — MPR:305-326
- `buildResolution(choice, userId)` runs **once, outside retries**. `resolvedAt` is the time of the decision.
- `commitRun` with a change that:
  - finds the conflict in the **cached** `r.parent.mergedPlan.conflicts` (else NOT_FOUND);
  - calls `validateResolutionAgainstConflict` (CONFIRM_PATHWAY must name a candidate);
  - sets `inputs.conflictResolutions[conflictId] = decision`;
  - uses `events: []`.
- **No event row is written for a conflict decision.** Its only trace is the `conflict_resolutions` JSON with `resolvedBy/resolvedAt/reason`.
- Composition re-derives the whole selection from the base merge (`selectConflicts`, P/compose.ts:232-285). A decision naming a pathway that is no longer a candidate becomes a `STALE_CONFLICT_DECISION` blocker. A decision for a conflict that no longer exists is inert.
- CUSTOM_OVERRIDE write-ins join the candidate universe for safety (`writeInsOf`, P/run.ts:70-71).

### 2.4 generateMergedCarePlan — MPR:341-406
`withRunAudits` and a `MAX_ATTEMPTS` loop:
1. `loadRun`. COMPLETED → idempotent `{success:true, carePlanId}`. ABANDONED → BAD_REQUEST. There is no explicit `assertRunMutable`; with only 3 statuses it is equivalent.
2. `evaluateRun(runInputsOf(run))`. `planChanged = ev.result.resultHash !== reviewedResultHash`. `warnings = warningsOf(ev.result.ddiWarnings)`.
3. If changed or not ready: `inTransaction(writeRun(...,'ACTIVE'))`, which always writes. Return PLAN_CHANGED or the blockers, now with `pathwayId`.
4. Otherwise, one `inTransaction`:
   - `writeRun(...,'COMPLETED')`: parent CAS to COMPLETED; every child gets `writeChildEvaluation(status=COMPLETED)`;
   - `materializeCarePlan`: `patients` upsert, `patient_care_plans` ('Multi-Pathway Care Plan', empty condition_codes), one goal per contributing pathway, interventions for meds/labs(→MONITORING)/procedures;
   - `setRunCarePlanId`;
   - `writeChildrenLifecycle(COMPLETED, carePlanId)`: a second child UPDATE that bumps each child's revision again;
   - `logEvent('care_plan_generated')` per child.

### 2.5 abandonMultiPathwaySession — MPR:409-441
- No evaluation. It loops `MAX_ATTEMPTS`: `loadRun`, `assertRunMutable`.
- `inTransaction`:
  - `writeRunLifecycle(ABANDONED)` (CAS, `status='ACTIVE'`, MS:305-316);
  - `writeChildrenLifecycle(ABANDONED)`: unconditional UPDATE by parent_session_id;
  - `logEvent('abandoned')` per child.

### 2.6 deletePreviewSession — MPR:450-471 → MS:146-201
- Its own `BEGIN`: `SELECT is_preview, contributing_session_ids … FOR UPDATE`.
- Refusals: not found → NOT_FOUND. Not preview → FORBIDDEN.
- Otherwise it deletes children by id array, then the parent. This happens **with no revision check and no status check**, so COMPLETED preview runs are deletable too.
- Child deletes cascade to events, gate answers, node overrides, decisions and `llm_gate_evaluations` (FK CASCADE, migrations 038/042/043/057). The explicit child delete is now redundant, because `parent_session_id … ON DELETE CASCADE` (067) would remove them anyway.
- Interaction with an in-flight `commitRun`: the parent CAS blocks on the row lock, then sees 0 rows → RevisionConflict → retry → `loadRun` NOT_FOUND. Audits flush into the deleted child ids, where the FK fails and the error is only logged **[unverified at runtime; inferred from code]**.
- Generated care plans have no FK to sessions and survive.

---

## 3. Operation → functions → tables

| Operation | Resolver → helpers | Env / evaluate | Tables written (tx) | Events / audits | CAS / retry |
|---|---|---|---|---|---|
| startResolution | RES:379 → evaluateSession(pinGraph) → inTransaction | loadEvaluationEnv; evaluate ROOT | INSERT `pathway_resolution_sessions` | `pathway_resolution_events` traversal_complete; `llm_gate_evaluations` | none (new row), 1 attempt |
| answerPendingDecision | RES:480 → commitSession → commitEvaluation(answerChange) | per attempt: snapshot + evaluate ROOT | UPDATE sessions (inputs+cache); INSERT `pathway_gate_answers` (question gate only) | event gate_answer / BRANCH_CHOSEN / PROVIDER_ASSERTED_DATUM; audits | revision CAS, 3 attempts |
| overrideNode | RES:468 → commitSession → commitEvaluation(overrideChange) | same | UPDATE sessions; INSERT `pathway_node_overrides` | event override; audits | same |
| addPatientContext | RES:489 → commitSession → commitEvaluation(contextChange) | same | UPDATE sessions (additional_context) | event context_update; audits | same |
| generateCarePlanFromResolution | RES:524 own loop, withAudits | evaluate ROOT; hash vs reviewed | not ready: UPDATE sessions. Ready: UPDATE sessions→COMPLETED (claim) + INSERT `patients`?, `patient_care_plans`, `_goals`, `_interventions` + UPDATE care_plan_id | care_plan_generated; audits | CAS, 3 attempts; COMPLETED short-circuit |
| abandonSession | RES:604 own loop | none | UPDATE sessions status | abandoned | CAS, 3 attempts |
| startMultiPathwayResolution | MPR:142 → getMatchedPathways → collapseLattice → evaluateRun(pinGraphs) → inTransaction | loadRunEnv; evaluate each child CONTRIBUTION; composeRun | INSERT `multi_pathway_resolution_sessions`; INSERT child sessions; UPDATE parent contributing_* | traversal_complete per child; audits per child | none, 1 attempt |
| child answer/override/fact | RES → commitSession → commitRun(childChange) | loadRunEnv; all children; composeRun | UPDATE parent (CAS) + UPDATE every child; gate_answers/node_overrides rows | event on target child (answer/override) or all children (fact); audits per child | parent revision CAS, 3 attempts |
| resolveConflict | MPR:305 → commitRun | same | UPDATE parent (conflict_resolutions + cache) + every child | **no event**; audits | parent CAS, 3 attempts |
| generateMergedCarePlan | MPR:341 own loop, withRunAudits | same; runHash vs reviewed | not ready: writeRun ACTIVE. Ready: writeRun COMPLETED + care plan rows + setRunCarePlanId + writeChildrenLifecycle | care_plan_generated per child; audits | parent CAS, 3 attempts; COMPLETED short-circuit |
| abandonMultiPathwaySession | MPR:409 own loop | none | UPDATE parent status (CAS); UPDATE children status | abandoned per child | parent CAS, 3 attempts |
| deletePreviewSession | MPR:450 → MS:146 | none | DELETE children, DELETE parent (FOR UPDATE) | cascades delete events/audits | no CAS, no retry |

---

## 4. Admin client dependencies (prism-admin-dashboard master)

Apollo defaults (`src/lib/apollo-client.ts:45-56`):
- `query: cache-first`
- `watchQuery: cache-and-network`
- `mutate: errorPolicy 'all'`, so GraphQL errors arrive on `result.error` and are not thrown.

### 4.1 Operations used
Documents are in `src/lib/graphql/mutations/resolution.ts` and `src/lib/graphql/queries/resolution.ts`:
- **START_MULTI_PATHWAY_RESOLUTION**
  - Variables: `patientId, patientContext, includeDraftPathways, syntheticPatient`.
  - Does **not** send `resolutionMode`, `evaluationAsOf` or `encounterStart`.
  - Selects `SESSION_FIELDS`.
- **RESOLVE_CONFLICT** (`sessionId, conflictId, choice`) → `SESSION_FIELDS`.
- **GENERATE_MERGED_CARE_PLAN** (`sessionId, reviewedResultHash`) → `success carePlanId warnings blockers{scope type description relatedNodeIds pathwayId}`.
- **DELETE_PREVIEW_SESSION** → `sessionId contributingSessionsDeleted`.
- **GET_MULTI_PATHWAY_RESOLUTION_SESSION** selects the same fields as SESSION_FIELDS (the fields are repeated inline).
- **GET_LLM_GATE_EVALUATIONS** (`sessionId, gateId`) → `id sessionId gateId pathwayId inputAttribute inputText prompt branches model chosenBranch confidence reasoning tentative errorMessage latencyMs createdAt`.
- **ANSWER_PENDING_DECISION** is defined inline twice: `components/encounter-simulator/PendingGatesPanel.tsx:45` and `components/pathway-preview/PreviewResolutionPanel.tsx:58`. It selects only `{ id }` of the child `ResolutionSession`.

The `SESSION_FIELDS` selection:
- scalars: `id patientId providerId status revision resultHash envFingerprint isPreview contributingSessionIds contributingPathwayIds carePlanId createdAt updatedAt`
- `contributingPathways{id logicalId title version category conditionCodes}`
- `ddiWarnings{recommendationId drugName category severity mechanism clinicalAdvice source{kind rxcui name snomedCode snomedDisplay recommendationId}}`
- `pendingGateQuestions{sessionId pathwayId pathwayTitle gateId prompt answerType options affectedSubtreeSize estimatedImpact tentative tentativeBranch tentativeConfidence tentativeReasoning datumKey optionLabels}`
- `mergedPlan{…}`: every list with `recommendation{…}` + `sourcePathwayIds state`; `suppressed{type name reason suppressedBy* sourcePathwayId}`; `conflicts{conflictId type clinicalRole candidates{recommendation sourcePathwayId sourcePathwayTitle} resolution{kind resolvedBy resolvedAt reason chosenPathwayId customMedication{name dose frequency duration route note}}}`; `catchUpItems{…}`; `evidenceTrail{…}`; `dataGapHints{… unlockedRecommendations{…}}`

**Not used by the admin at all:**
- `startResolution`, `overrideNode`, `addPatientContext`, `abandonSession`, `abandonMultiPathwaySession`, `generateCarePlanFromResolution`;
- the `resolutionSession`, `pendingQuestions`, `redFlags` and `patient*Sessions` queries.

The single-pathway surface is exercised only through `answerPendingDecision` on children. `envFingerprint` is selected but never read in UI logic **[grep-level]**.

### 4.2 Refresh after mutations
- **Encounter page** (`src/app/encounter/page.tsx`):
  - The session is read with `useQuery(GET_MULTI…, network-only)` keyed by `?sessionId=` (:60-66).
  - After start it calls `router.replace` to that URL (:130-132). The displayed session prefers the query over the start mutation data (:183-186, the P4-13 fix).
  - `resolveConflict` relies on the Apollo normalized-cache update by `id` (:194-197).
  - Commit sends `reviewedResultHash: session.resultHash`, then always `refetchSession()` (:211-222).
  - Gate answers go through PendingGatesPanel `onAnswered` → `refetchSession()` (:388).
- **PendingGatesPanel** (`PendingGatesPanel.tsx:169-196`) sends the answer with `gate.sessionId`, which is the child id taken from `pendingGateQuestions`. It has no client retry (the server handles D9), then awaits `onAnswered()`. The LLM audit is loaded lazily by `(sessionId=child, gateId)` (:346-372).
- **PreviewResolutionPanel**:
  - It starts a preview run and does **not** publish it yet.
  - It applies composer pre-answers sequentially via `answerPendingDecision`, each a whole-run re-evaluation. It publishes after one `fetchRun` (network-only).
  - Later answers go through `createRunRefresher` (`src/lib/run-refresher.ts:19-46`): one read in flight at a time, plus a trailing read. A response is dropped if the run id changed or `next.revision < shown.revision`. **This is the only client consumer of `revision`.**
  - A superseded or unmounted preview is reaped with `deletePreviewSession` (:129-149, 236).
  - `usePreviewMergedPlan.ts` does start + delete the same way.

---

## 5. Places that mutate evaluation state outside the pipeline

Every UPDATE/INSERT/DELETE on session tables lives in SS / MS. There are no leftover incremental re-traversal paths: grep for retraverse/incremental/recompute finds only comments, and `traversal-engine.ts` exposes only `traverse`. The writes and state changes that bypass `commitEvaluation`/`commitRun` or change the result under a session:

1. **`setCarePlanId`** (SS:183) / **`setRunCarePlanId`** (MS:319): unconditional UPDATE with no CAS, and no revision bump for single sessions. They are only called inside a claimed generation transaction.
2. **`writeChildrenLifecycle`** (SS:211-218): unconditional status/care_plan_id/revision UPDATE for all children of a parent. It is used by run generation and abandon.
3. **`writeChildEvaluation`** (SS:193-208): child UPDATE with no CAS. It is safe only because the caller holds the parent CAS in the same transaction.
4. **`setContributingSessions`** (MS:268-275): unconditional parent UPDATE, start transaction only.
5. **`deletePreviewSession`** (MS:146-201): DELETE with no revision or status check.
6. **`writeLifecycleStatus` / `writeRunLifecycle`**: CAS, but no evaluation, so the cache stays as last evaluated.
7. **Environment changes that alter the next evaluation without touching sessions.** Reads never recompute, so stored `result_hash`/cache go stale until the next mutation. The only defence is PLAN_CHANGED at generation.
   - `importPathway` DRAFT_UPDATE rewrites a pathway row in place (`services/import/relational-writer.ts:173-190`) plus its AGE graph → `SESSION_GRAPH_CHANGED` for any session on that draft. Preview runs use `includeDraftPathways`. **[graph replacement semantics unverified in detail]**
   - `activate/archive/reactivatePathway` (resolvers/mutations/import.ts). Activation also calls `prewarmPathwayInBackground`.
   - The confidence mutations (signals, weights, thresholds, node weights, admin evidence; resolvers/mutations/confidence.ts) change `envFingerprint` and possibly `resultHash`.
   - `manuallyResolveMedicationNormalization` (resolvers/mutations/medication-admin.ts:29) and background `prewarmMedications` (P/request.ts:100-105) write `medication_normalization_cache`. Those are env inputs, written outside any request transaction, by design (C4).
   - `pathway_attribute_code_map` changes are **invisible until process restart** (process-wide cache, §0.3).
   - `scripts/cleanup-age-orphans.ts:202` runs AGE `DETACH DELETE` on orphan nodes. It could change a live graph fingerprint only if it misclassified a node **[unverified]**.
8. **Migrations 065/067/068** purge all sessions (DELETE). This is historical: the live DB has passed it.
9. `__tests__/pipeline-postgres.test.ts` contains direct UPDATEs. It is test-only.

---

## 6. Findings relevant to the interpreter spec

1. **Graph change is terminal.** `graphFingerprint` is the only fingerprint that is compared. A mismatch → `SESSION_GRAPH_CHANGED` on every later evaluation, including generation, with no retry and no re-pin. `envFingerprint` is stored and exposed but **never compared**. A config drift surfaces only indirectly as PLAN_CHANGED_SINCE_REVIEW.
2. **The snapshot has a hole.** The attribute code map is cached for the life of the process and never re-read, contradicting C4 "code map … in one snapshot". Separately, `pathway.version` (single start) and `getMatchedPathways` (multi start) are read outside the snapshot.
3. **Boundary validation reads the cache, not the fresh result.**
   - Candidate checks (DecisionPoint options, askTarget, override originalStatus, conflict existence) use the stored `pending_questions`/`resolution_state`/`merged_plan` from the reload.
   - For run children, the view is the **post-withholding** composed state.
   - An interpreter that changes node/pending shapes must keep the cache and validation consistent, or validate against fresh evaluation.
4. **A child row's `result_hash` is the pre-withholding contribution hash, but its `resolution_state` is post-withholding.** The two stored columns describe different states. The run hash depends on the child hashes, not on the child states.
5. **Retry budget is 3 attempts, not 3 retries.** Every attempt reloads the session with **all events** (`getSession`), takes a fresh snapshot, and re-evaluates every child of a run sequentially. Failed LLM calls are re-attempted on each attempt. Successful ones are reused by key.
6. **Observations only accumulate.** Persisted observations = all prior + used new, so unused and stale keys persist forever. The key includes the **configured** model name, and the stored `model` is the response's.
7. **Generation always writes on the not-ready/changed path,** bumping the revision even when the cache is unchanged, which diverges from the spec's "if changed". Idempotent COMPLETED returns `warnings: []`.
8. **resolveConflict writes no event,** and run generation increments child revisions twice. Child revisions are never used as locks.
9. **Readiness/blockers are not exposed on `ResolutionSession` or `MultiPathwayResolutionSession`** in GraphQL. Clients learn blockers only from generation.
10. **Admin dependency surface is small:** only the multi-pathway ops, `answerPendingDecision → {id}`, `llmGateEvaluations` and `deletePreviewSession`. Load-bearing fields:
    - `resultHash`, echoed back as `reviewedResultHash`;
    - `revision`, for refresh ordering;
    - `pendingGateQuestions[].sessionId`, the child id the answer routes to;
    - `mergedPlan.conflicts[].conflictId`;
    - the `mergedPlan` shapes listed in §4.1.
