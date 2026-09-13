# prism-graphql engine architecture review — 2026-09-13

Reviewed **main at 2454130** (merge of decision-semantics), fetched on September 13. This is a review, not an implementation change.

**Assessment:** the shared traversal evaluator is an improvement, and eight retained engine reproductions from the earlier reviews now pass. The remaining risks are concentrated in authority over node state, the relationship between scoring and traversal, and the different single-/multi-pathway mutation pipelines. I found **11 actionable findings**, including eight demonstrated by targeted tests. The remaining findings are identified explicitly as code-path or SQL analysis, not claimed as live-system reproductions.

## Findings

### 1. [P1] Nested gates can reopen treatments under a closed ancestor

**Evidence: failing engine reproduction.** The incremental `promote` function treats a Gate or DecisionPoint as the author of its own status. But an outer gate's subtree sweep also writes the status of inner gates. It is therefore impossible to infer who made the decision from node type alone.

Reproduction: `outer question → Step → inner lab gate → Medication`. Open the outer gate, close it, then update the lab read by the inner gate. The inner gate is seeded directly; promotion stops at that gate because it is a “decider,” and its immediate parent is a Step. The medication becomes INCLUDED while the outer question remains GATED_OUT. This uses the dependency map the normal context-update path consults.

Record the source of each disposition and the active routing constraints, or compute reachability from the root before independently disposing an affected region. Extending a list of special-case ancestor types will not establish the invariant.

[Incremental promotion](../../../apps/pathway-service/src/services/resolution/traversal-engine.ts#L692)

### 2. [P1] Multi-pathway generation bypasses child-session safety and freshness

**Evidence: failing resolver reproduction and call-path inspection.** `generateMergedCarePlan` validates only unresolved merge conflicts and whether three recommendation arrays are empty. It does not load contributing sessions or check their pending questions, red flags, DEGRADED state, TIMEOUT nodes, or changed revisions. A stored merged plan is treated as authoritative even after a child changes.

The reproduction supplies a parent with one medication and a child with a pending gate, red flag, and DEGRADED status. Generation returns success without reading the child. Likewise, answering a child gate and calling generation without the separate UI-driven re-merge can materialize the old treatment selection.

Use the same generation-readiness policy for single and multi-pathway requests, evaluated over a current, consistent set of child revisions. Either rebuild the projection server-side or reject a stale projection. Client sequencing must not be the freshness guarantee.

[Merged generation](../../../apps/pathway-service/src/resolvers/mutations/multi-pathway-resolution.ts#L331); [Separate validator](../../../apps/pathway-service/src/resolvers/mutations/multi-pathway-resolution.ts#L1040)

### 3. [P1] Traversal confidence does not implement configured graph propagation

**Evidence: failing confidence reproduction.** The traversal adapter passes one node as `nodes`, the full edge list, and the full graph as `contextNodes`. The wider context fixes linked-code lookup but not propagation: scoring and propagation still operate only on `nodes`. Incoming edges from absent scored nodes also cause the topological sorter to misdiagnose a simple chain as a cycle and skip propagation.

Using the existing propagation fixture, full-graph evaluation gives the downstream node confidence **0.24**; the production one-node call shape gives **0.90**. At a 0.60 inclusion threshold these paths disagree on whether the same action belongs in the plan.

Compute graph scores once per evaluation context, then let traversal consume them, or implement dependency-aware incremental scoring over the necessary subgraph. The dependencies must include propagated inputs, not only the target's direct scorer inputs. This would also remove the repeated weight, threshold, and evidence queries performed per node.

[Traversal adapter](../../../apps/pathway-service/src/resolvers/helpers/resolution-context.ts#L337); [Propagation](../../../apps/pathway-service/src/services/confidence/confidence-engine.ts#L304)

### 4. [P1] Single-pathway completion can reject an unchanged session due to timestamp precision

**Evidence: real pg parser demonstration plus SQL inspection; no live database execution.** Ordinary `updateSession` explicitly handles PostgreSQL microseconds versus JavaScript Date milliseconds by truncating the comparison. The generation transaction instead uses exact `updated_at = $6` with `session.updatedAt`, which is the parsed Date.

The installed pg parser turns `2026-09-13 12:00:00.123456+00` into `2026-09-13T12:00:00.123Z`. Those instants are not equal under the exact SQL predicate. For a row with a sub-millisecond timestamp, completion reports a conflict and rolls back despite no concurrent edit; reloading the same row does not repair the precision loss.

Use a shared integer revision/CAS mechanism across all mutations and completion. Keeping the raw database timestamp is another option; duplicating subtly different timestamp guards is the immediate inconsistency.

[Completion predicate](../../../apps/pathway-service/src/resolvers/mutations/resolution.ts#L1381); [Existing precision handling](../../../apps/pathway-service/src/services/resolution/session-store.ts#L279)

### 5. [P1] Cross-pathway drug checking aliases pathway-local node IDs

**Evidence: failing DDI reproduction.** The merge pipeline prefers `sourceNodeId` alone as the cross-plan recommendation ID. Node identifiers are local to a pathway, so two different drugs can both be named `med-1`. `normalizeCandidates` stores normalized drugs in a Map keyed by that ID, overwriting the first drug with the second. Both sides then resolve to the same ingredient; the interaction engine deliberately ignores self-interactions.

The reproduction checks two different synthetic drugs with a configured severe interaction: qualified IDs yield two findings, while the current unqualified IDs yield zero. Suppression lookup uses the same ambiguous identity and can also attribute or remove the wrong recommendation.

Use a composite pathway/version/node identity everywhere a recommendation crosses pathway boundaries, including normalizer maps, suppression sets, attribution, and conflict choices.

[Cross-plan candidate IDs](../../../apps/pathway-service/src/resolvers/mutations/multi-pathway-resolution.ts#L691); [Normalization Map](../../../apps/pathway-service/src/services/medications/ddi-pass.ts#L210)

### 6. [P1] Changing a conflict choice retains the previously selected medication

**Evidence: failing pure-function reproduction; resolver accepts repeated choices.** `applyResolution` copies the existing medication list and appends the current selection. It never removes the previous contribution of that conflict. Choose A, then choose B: the list contains A and B while the conflict records only B. REJECT_BOTH after a selection similarly leaves the old medication, and retrying the same choice can duplicate it.

Derive the medication list from the base merged plan plus the latest decision map, or attach explicit conflict ownership and replace that conflict's contribution. A choice must replace the previous choice and be idempotent.

[Conflict application](../../../apps/pathway-service/src/resolvers/mutations/multi-pathway-resolution.ts#L977); [Mutation entry point](../../../apps/pathway-service/src/resolvers/mutations/multi-pathway-resolution.ts#L293)

### 7. [P1] Drug safety does not run over the final medication set

**Evidence: failing boundary test plus DDI call-path inspection.** Conflict selection and CUSTOM_OVERRIDE add medications after the merge's DDI pass. `resolveConflict` persists those additions without DDI, re-merge replays prior choices after DDI, and merged generation performs no final DDI pass. The boundary test verifies a write-in medication is accepted without invoking patient-context DDI. Drug pairs involving conflict candidates can therefore enter the final plan without ever being checked together.

There is a second coverage gap: single-pathway DDI compares recommendations with the patient's medications, and cross-recommendation DDI explicitly skips pairs sharing a pathway. The comment assumes such pairs were checked during authoring, but the inspected import/validation path has no such check. Dynamically selected combinations are not guaranteed safe by that assumption.

Run one final-plan safety pass after all selections and overrides, against the effective patient context and every included medication pair. Re-merges currently use the parent's initial context, so context revision ownership must also be explicit.

[Conflict mutation](../../../apps/pathway-service/src/resolvers/mutations/multi-pathway-resolution.ts#L314); [Re-merge replay](../../../apps/pathway-service/src/resolvers/mutations/multi-pathway-resolution.ts#L433); [Same-pathway skip](../../../apps/pathway-service/src/services/medications/ddi-pass.ts#L174)

### 8. [P1] Multi-pathway materialization and session completion are not atomic

**Evidence: transaction/control-flow inspection; concurrency not exercised against a live database.** `materializeCarePlan` commits the care-plan transaction before `generateMergedCarePlan` separately marks the parent session COMPLETED. There is no revision predicate on that status update. A failure between these writes leaves a persisted plan and an ACTIVE session; retrying can create another plan. Two requests that both read ACTIVE can also commit independent plans, with the last status write replacing the parent reference.

The update path for merged plans similarly has no optimistic guard, so a re-merge and a conflict choice can overwrite one another. “Single provider” does not exclude concurrent browser requests or retries.

Commit the plan and session completion in one transaction, claim a specific revision/status, and make generation idempotent. Apply the same revision protocol to conflict edits, child updates, and re-merging.

[Generate then mark completed](../../../apps/pathway-service/src/resolvers/mutations/multi-pathway-resolution.ts#L350); [Materializer commit](../../../apps/pathway-service/src/resolvers/mutations/multi-pathway-resolution.ts#L1160); [Unguarded updates](../../../apps/pathway-service/src/services/resolution/multi-pathway-session-store.ts#L174)

### 9. [P2] Reconverging branches cannot reliably represent shared downstream actions

**Evidence: failing diamond-graph reproduction.** Subtree exclusion uses node-global, first-writer-wins state. For `question → A/B`, where A and B both lead to a shared Medication, selecting A still excludes the shared medication: excluding B sweeps its descendants before the queued selected arm reaches them. The selected route remains valid, but its common downstream action is removed.

The code explicitly calls first-writer-wins a design decision; that makes this an architectural limitation, not an accidental missing condition. Supported graph shapes and execution semantics disagree. Model reachability on edges and combine incoming route states before disposing shared nodes. If reconvergence is intentionally unsupported, reject it at import instead of accepting a graph whose clinical meaning changes during traversal.

[First-writer subtree marking](../../../apps/pathway-service/src/services/resolution/traversal-engine.ts#L252)

### 10. [P2] Vital-attribute answers cannot resolve the question that requested them

**Evidence: failing resolver reproduction with a pinned encounter anchor.** For `vitals.systolic_bp`, `askFor` retains the namespace in the vital target path. The resolver writes a flat `vitalSigns["vitals.systolic_bp"]` key, but evaluation selects the vital code `systolic_bp`. Answering 180 to the escalated `vitals.systolic_bp > 160` gate leaves it PENDING_QUESTION. Nested custom vital paths also require consistent construction of the context bag.

Use one typed attribute-address conversion for reading, prompting, and writing: strip the namespace, construct nested paths consistently, and test the full answer round trip rather than only the generated target.

[Vital target](../../../apps/pathway-service/src/services/resolution/unresolved-prompt.ts#L71); [Context fragment construction](../../../apps/pathway-service/src/resolvers/mutations/resolution.ts#L729)

### 11. [P2] Merged-plan persistence drops supported recommendation categories

**Evidence: projection and materializer inspection.** The projected/merged plan supports imaging, guidance, schedules, quality metrics, and catch-up items. The materializer writes only medications, labs, and procedures; its emptiness validator checks only those three arrays. An imaging-only or guidance-only plan is rejected as empty, and a mixed plan can complete while silently dropping those recommendations. Single-pathway and merged generation also use different mapping models.

Define one explicit, exhaustive output contract between resolution and persistence. Each supported clinical action needs a persistence mapping, or an explicit validation error if it cannot yet be materialized. It should not disappear after the provider has reviewed the richer preview.

[Empty-plan validation](../../../apps/pathway-service/src/resolvers/mutations/multi-pathway-resolution.ts#L1053); [Materialization](../../../apps/pathway-service/src/resolvers/mutations/multi-pathway-resolution.ts#L1075)

## Architectural direction

1. **Make the owner of a decision explicit.** A node status alone cannot encode whether a gate decided it, an ancestor suppressed it, a provider overrode it, or DDI removed it. Separate route reachability, local evaluation, override intent, and safety disposition. This addresses both nested-gate resurrection and shared-descendant exclusion.
2. **Create one resolution pipeline used by every mutation.** Assemble effective context; compute required graph scores; resolve routes and findings; apply provider choices; run final-plan safety; validate readiness; persist. Single/multi entry points should compose this pipeline rather than maintain different versions of its invariants.
3. **Treat merged plans as revisioned projections.** Store the contributing session revisions and invalidate the projection when a child changes. Persist plans, decisions, and completion under an atomic revision claim. Use globally qualified recommendation identities.
4. **Pin all inputs required for reproducibility.** The evaluation clock and temporal policy are pinned, but graph/configuration and scorer inputs are loaded afresh. Thresholds, weights, pathway defaults, code mappings, and LLM configuration also influence the outcome. A reproducible replay needs immutable versions or recorded inputs for these, not only a clock.
5. **Unify semantic contracts at boundaries.** Attribute reads and answer writes should use the same typed address; graph scoring and traversal should share the same confidence result; preview and persistence should use an exhaustive action model.

`LIVE` and `REPLAY` are explicitly rejected by the current context assembler pending their mapper/fact-persistence work. This is a documented unfinished capability, not a newly discovered regression. It is relevant to any plan to use this engine with live clinical snapshots or deterministic replay.

## Validation and limits

- TypeScript: `node_modules/.bin/tsc --noEmit -p apps/pathway-service/tsconfig.json` **passed**.
- Unmodified pathway-service suite: **1,645 passed, 9 failed, 1 skipped**; 128 suites passed, two failed, one skipped. The nine failures remain in patient-match and data-completeness scorer tests and were already verified on the earlier main baseline. The skipped behavioural baseline was not represented as coverage.
- Targeted review suites: **8 failing reproductions, 41 passing assertions/tests** across five suites. Failures cover nested-gate resurrection, shared-descendant exclusion, scoring divergence, merged generation ignoring child readiness, replacement conflict choices, missing DDI on custom choices, vital answer routing, and cross-pathway medication identity.
- Eight retained engine regression cases from the prior reviews passed on this main.
- The installed pg parser was exercised to verify microsecond loss. No live PostgreSQL transaction, AGE migration, external LLM, or clinical interaction database was exercised. DDI test drugs and interaction responses are synthetic fixtures; they establish the software identity/control-flow defect, not a medical claim about named drugs.
- Supplemental tests ran in an isolated source snapshot. This branch contains documentation, evidence logs, and an opt-in reproduction patch; production source and active test suites are unchanged.

## Reproduction artifacts

The [reproduction patch](evidence/reproductions.patch) preserves the review tests. The [targeted test output](evidence/prism-architecture-final-reproductions.log) and [baseline suite output](evidence/prism-main-engine-suite.log) preserve the results. Apply the patch in a disposable checkout of this review branch (based on `2454130663a0a7c348e5d8ddd3f6d4ea20652e5b`), with the project test dependencies installed. It adds two test files and extends three existing suites. Eight expected failures demonstrate the findings; this is diagnostic evidence, not a proposed fix:

```sh
git apply --check docs/reviews/2026-09-13-engine-architecture/evidence/reproductions.patch
git apply docs/reviews/2026-09-13-engine-architecture/evidence/reproductions.patch
node_modules/.bin/jest --config apps/pathway-service/package.json --runInBand --runTestsByPath \
  apps/pathway-service/src/__tests__/architecture-review.test.ts \
  apps/pathway-service/src/__tests__/confidence-engine.test.ts \
  apps/pathway-service/src/__tests__/multi-pathway-resolution.test.ts \
  apps/pathway-service/src/__tests__/escalated-answer-injection.test.ts \
  apps/pathway-service/src/__tests__/architecture-ddi-identity.test.ts
```
