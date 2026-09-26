# D — Downstream consumers of the interpreter's per-node result

Scope: everything after (or feeding numbers into) traversal: scoring, findings, safety and disposition, readiness, hashes, multi-pathway composition, care-plan projection and materialization. Code: `features/docs-evaluation-interpreter-design/prism-graphql` @ d377465 (= live). Paths below are relative to `apps/pathway-service/src/` unless stated.

Evidence levels: **[code]** read directly in source. **[graph]** checked against the pathway graph exports in `probes/graphs/` (9 exports, 3 logical pathways: anemia-in-pregnancy v1.1–1.7, chronic-htn-pregnancy 1.0, gestational-hypertension-preeclampsia 1). **[unverified]** inferred, not executed. The live DB read (row counts for DDI tables, thresholds, weights) was refused by the permission classifier, so every live-data count below is unverified.

---

## 0. Pipeline order (single evaluation)

`services/resolution/pipeline/evaluate.ts:30-106`:

| # | Stage | Inputs | Output | File |
|---|---|---|---|---|
| 1 | Context | `initialPatientContext` + `additionalContext`, `temporalContext` | effective `patient`, `factStore` | evaluate.ts:42-44 |
| 2 | **Scores**, run once over the whole graph, **before** traversal | `env.scoring` (ScoringConfig), all nodes and edges, signals, `patient` | `Map<nodeId, NodeConfidenceResult>` | evaluate.ts:47-54 |
| 3 | Traverse → eligibility | scores (through an adapter), `rctx.thresholds`, answers, overrides, observations | `resolutionState`, pendingQuestions, redFlags, dependencyMap, isDegraded | evaluate.ts:57-66 |
| 4 | Findings | state, patient, graph | `catchUpItems`, `gateContextFields` | evaluate.ts:69-70, findings.ts |
| 5 | Patient safety | INCLUDED Medication nodes, patient meds and allergies, `env.safety` | findings, suppressed, unavailable | safety.ts:19-71 |
| 6 | Pair safety (ROOT only) | candidates not suppressed by stage 5 | findings, suppressed | safety.ts:74-96 |
| 5–6 | `applyDisposition` | state + all findings | state with eligibility/disposition layers | disposition.ts:33-55 |
| 7 | Readiness | disposed state, pendingQuestions, redFlags, unavailable, scope, isDegraded | ready, blockers, ACTIVE/DEGRADED | readiness.ts:7-64 |
| — | Hash | the result minus the hash | `resultHash` | evaluate.ts:114-136 |

A run (`pipeline/run.ts:111-152`) runs stages 1–5 and 7 for each child at `CONTRIBUTION` scope, then `composeRun` (`pipeline/compose.ts:80-223`) does projection, merge, conflict selection, root patient safety (write-ins only), pair safety and root readiness.

---

## 1. Confidence scoring

### 1.1 When it runs and what it reads

- **Timing.** Scoring runs once per evaluation, **before traversal**, over `rctx.graphContext.allNodes` and every edge (evaluate.ts:47-53). Its only input is the static effective patient. It never sees traversal state, gate outcomes, answers or overrides. Traversal reads the precomputed score through `computeNodeConfidence: async n => scores.get(id) ?? unscored(n)` (evaluate.ts:58). `unscored` returns confidence 0 (evaluate.ts:22-23), but every graph node is scored, so the fallback is dead in practice. [code]
- **Config.** `ScoringConfig` is loaded inside the C4 snapshot (`load-env.ts:82-91` → `confidence-engine.ts:79-128`). It contains `confidence_admin_evidence` for the pathway, a weight matrix from `WeightCascadeResolver.resolveAllWeights`, `confidence_node_weights` (node weight + `propagation_overrides`), and thresholds.
- **Thresholds are resolved twice.**
  - `buildResolutionContext` → `rctx.thresholds` (`resolvers/helpers/resolution-context.ts:301-308`). Traversal uses these.
  - `loadScoringConfig` → `scoring.thresholds`. `scorePathway` uses these for `resolutionType`.
  - Both use the same query in the same snapshot, so the values are identical. Both are hashed into `envFingerprint`. [code]
  - Neither call passes `nodeIdentifier`, so the resolver appends `AND node_identifier IS NULL` (`weight-cascade-resolver.ts` ~l.95-105). **Node-scoped thresholds are never applied.**
  - Defaults when no row exists: auto 0.85, suggest 0.60 (`weight-cascade-resolver.ts:114-118`).
- **Scorers** (registered at `resolution-context.ts:252-258`). Seeded weights (migration `039_seed_confidence_signals.sql`): data_completeness 0.30, evidence_strength 0.25, match_quality 0.25, risk_magnitude 0.20.
  - `patient-match-quality.ts`
    - Criterion: best code match against the patient's condition, medication and lab codes, with prefix matching.
    - Medication with RxNorm CodeEntry: **1.0 if the patient already takes the drug, else 0.0** (l.90-104).
    - Medication without CodeEntry: 1.0 on a name match, else 0.5.
    - LabTest with LOINC: 1.0 if the patient has that lab, else 0.0.
  - `data-completeness.ts`: for a Medication, counts "patient already on it" and "has any allergies" as the available inputs (l.110-158).
  - `risk-magnitude.ts`
    - Uses `base_rate`/`risk_value`.
    - Otherwise, for a Medication, **compares the node's RxNorm codes to the patient's allergy codes** (l.88-101), then falls back to `skipped`.
  - `evidence-strength.ts`: `evidence_level` on the node or its citations.
  - `custom-rules.ts`.
  - **None of these read the fact store, temporal windows, active-context filtering or the gate condition adapter.** They read raw `patientContext.conditionCodes/medications/labResults/allergies`. [code]
- **Name-match bug** [code]. Both name fallbacks use `medName.includes(m.display?.toLowerCase() || '')`, which is true whenever a patient medication has no `display`. Any display-less patient medication therefore "matches" every uncoded Medication node (`patient-match-quality.ts:~112`, `data-completeness.ts:~143`).

### 1.2 Aggregation, propagation, cycles

- **Per-node confidence** is the weighted mean of non-skipped signals. It is 0 when no weight is present (`confidence-engine.ts:201-239`). The breakdown only includes signals that have both a score and a weight entry.
- **Propagation** (`applyPropagation`, l.330-429) runs over a Kahn topological sort of **all** nodes and **all** edges (l.431-472). Edge types are not filtered at sort time: REQUIRES, CITES_EVIDENCE and HAS_CODE all count.
  - On a cycle, the whole pass is skipped with a `console.warn` and raw scores are used (l.340-346).
  - Propagated scores can only **lower** a node's signal score, taking the minimum (l.177-196).
- **Live cycle evidence** [graph]. `gestational-hypertension-preeclampsia` (9ee949c9) has 6 cycles, all closed by `REQUIRES` back-edges, e.g. `step-1-1 -HAS_GATE-> gate-aspirin-indicated -BRANCHES_TO-> step-1-3 -REQUIRES-> step-1-1`.
  - As a result, **propagation is silently off for that whole pathway** and on for the other two (acyclic).
  - Confidence semantics therefore depend on whether an author drew a REQUIRES edge.
  - This replaces the old "1 node, 99 edges" false cycle the spec described (spec §2 "Known behaviour change").
- **`resolutionType`** (AUTO_RESOLVED / SYSTEM_SUGGESTED / PROVIDER_DECIDED / FORCED_MANUAL, l.241-251 and 310-328) **is computed and never consumed** by traversal, disposition, readiness or generation. `grep` finds no reader outside the engine.
  - `autoResolveThreshold` is passed to `TraversalEngine` (`traversal-engine.ts:360`) and never read.
  - `auto_resolve_eligible: false` (FORCED_MANUAL) has no effect on traversal: a DecisionPoint marked non-auto-resolvable still auto-routes when exactly one branch qualifies. [code] No live node sets the flag [graph].

### 1.3 How traversal consumes scores (the score *is* a decision)

Only `suggestThreshold` is used:

| Consumer | Rule | Location |
|---|---|---|
| DecisionPoint branch qualification | target node confidence ≥ suggest → qualifies; >1 qualifying on `one_of` → PENDING_QUESTION; 0 → `all_branches_excluded` red flag | traversal-engine.ts:946-975, 1102-1183 |
| `all_of` fork | every branch included; weak ones → `all_of_branch_unsupported` red flag; targets `mandated` | :980-1011 |
| Action node inclusion (Medication, LabTest, Imaging, Procedure, Guidance, Monitoring, Lifestyle, Referral) | confidence ≥ suggest or mandated → INCLUDED, else EXCLUDED "Confidence x below suggest threshold y" | :1222-1251 |
| `missing_critical_data` red flag | `properties.critical === true` and data_completeness score 0 | :1253-1268 |
| Stage/Step/Pathway | always INCLUDED; confidence recorded only | :1196-1219 |
| Other types (Criterion, CodeEntry, **Schedule, QualityMetric**, EvidenceCitation, Gate handled elsewhere) | INCLUDED with confidence 1 | :1273-1290 |

**Competing evaluator.** For every action node and every DecisionPoint branch, the inclusion decision comes from the scorer ensemble, not from any gate the author wrote. The scorers are a second clinical-logic engine with their own patient-data semantics: no temporal horizon, prefix code matching, and "already on the drug" treated as match and completeness. Two consequences:

- A Medication with RxNorm codes that the patient does **not** already take scores 0 on match_quality and ≤0.5 on data_completeness. That structurally depresses **new**-drug recommendations toward EXCLUDED. [code; per-patient numbers unverified]
- The confidence-driven red flags (`all_branches_excluded`, `all_of_branch_unsupported`, `missing_critical_data`) become `UNRESOLVED_RED_FLAG` blockers. `acknowledged` is never set anywhere in production code (only read at `readiness.ts:39`), so **a scoring outcome can permanently block generation** with no provider remedy other than overriding nodes. [code]

**Second scoring path.** Query `pathwayConfidence` (`resolvers/Query.ts:510-558`) calls `computePathwayConfidence` with a hand-built `PatientContext`: no `buildEffectivePatientContext`, and the accepted `institutionId`/`organizationId` args are ignored. Displayed confidences can differ from the ones traversal used. [code]

---

## 2. Findings: catch-up items, gateContextFields

- **`catchUpItemsFor`** (`pipeline/findings.ts:7-23`):
  - For every INCLUDED Stage/Step, in nodeId order, it calls `findUnmetPrerequisites` (`prerequisites.ts`) along outgoing `REQUIRES` edges, deduplicated by prerequisite nodeId (first dependent wins).
  - It reads eligibility-era `status`. It runs before disposition, but Stage/Step are never withheld, so this is equivalent.
- **Competing evaluator** [code]. The satisfaction check is its own code matcher:
  - `patientHasCode` does an exact code+system match over conditions, meds, allergies and labs.
  - `lookback_days` is parsed and **ignored**.
  - It **does not consult `resolutionState`**, so a prerequisite the same evaluation INCLUDED is still reported as unmet.
  - With no `satisfaction_check`, the reason is `no-satisfaction-check` (unconditionally unmet). **No live node carries `satisfaction_check`** [graph: 0 occurrences], so every REQUIRES target of an included Stage/Step is a catch-up item. Only preeclampsia has REQUIRES edges (6) [graph].
- **Consumers:**
  - Single result: stored (`session-store.ts:98`) and in `resultHash`.
  - Run: carried into `MergedCarePlan.catchUpItems` (merge dedup by `sourcePathwayId::nodeId`, `care-plan-merge.ts:517-527`), included in the run hash via `plan`.
  - **Neither materializer writes them.** Non-blocking.
- **`gateContextFieldsOf`** (findings.ts:26-28): the dependency map's `gateContextFields` as sorted arrays. It is the only part of `DependencyMap` that survives.
  - Consumers: stored, and the run projection's `evidenceTrail.fieldsRead` / `dataGapHints.fieldsRead` (`compose.ts:88` via `setsOf`).
  - **Excluded from `resultHashOf`.** The single path never builds evidenceTrail or dataGapHints: `projectResolutionToCarePlan` is only called from `composeRun`. [code]

---

## 3. Safety and disposition

### 3.1 Candidates

- `medicationCandidates` (`disposition.ts:11-19`) takes Medication nodes with `status === INCLUDED`. The name is `properties.name ?? properties.title ?? nodeIdentifier` (`load-env.ts:51-53`). No system/code is passed, so normalization is by text only.
- Provider-overridden INCLUDE nodes are candidates (spec D4).
- **Role is ignored.** A `role: 'contraindicated'` or `'avoid'` node that traversal INCLUDED is safety-checked as if it were being prescribed. [code]
- The candidate universe for the snapshot is every Medication node in the graph(s) + the patient's meds + run write-ins (`load-env.ts:94-100`).

### 3.2 Patient safety (`safety.ts:19-71`)

- A patient medication that cannot be normalized → `unavailable{source:'PATIENT_MEDICATION'}` (no nodeId).
- A candidate that cannot be normalized → `unavailable{source:'CANDIDATE', nodeId}` and `continue`, so it gets no allergy check either.
- **Drug–drug.** `interactionBetween` (`safety-reference.ts:107-133`): pair row first, else the most severe ATC class rule.
  - `buildDrugDrugFinding` (`ddi-pass.ts:191-214`) maps CONTRAINDICATED/SEVERE → SUPPRESS, MODERATE → WARN, MINOR → dropped.
- **Allergy.** Only patient allergies with `system === 'SNOMED'` are considered (safety.ts:25). Other systems are **silently ignored**.
  - Mapping is SNOMED → ATC prefix via `allergy_class_mappings`. Every hit is severity SEVERE → SUPPRESS (`ddi-engine.ts:175-195`).

### 3.3 Pair safety (`safety.ts:74-96`)

- Every unordered pair of **normalized** candidates. Unnormalized ones are dropped silently here; they were already reported by stage 5.
- Each pair yields two directional findings (fA, fB) with `source.kind: 'OTHER_RECOMMENDATION'`.
- **Both sides are suppressed** on SUPPRESS: no preference or ordering, so a severe pair loses both drugs. [code]
- Single ROOT: candidates are those not suppressed by patient safety (evaluate.ts:75-77).

### 3.4 `applyDisposition` (`disposition.ts:33-55`)

- Writes `eligibility = {status, reason: excludeReason, decidedBy: override|traversal}`.
- Only an INCLUDED node with a SUPPRESS finding is withheld: `disposition = {EXCLUDED, withheldBy:'safety', findingIds (sorted findingId strings), reason}`. `status` and `excludeReason` are overwritten from disposition.
- Reason priority: ALLERGY > DDI_CONTRAINDICATED > DDI_SEVERE (`ddiSuppressionReason`, l.62-73).
- **Nothing is re-decided about eligibility.** Disposition is additive. Traversal is not re-run and `prior_node_result` reads eligibility (per spec C2; interpreter side not re-verified here).

### 3.5 Empty or partial safety reference is not surfaced — confirmed [code]

- `loadSafetyReference` (`safety-reference.ts:37-100`) reads `drug_interactions`, the **whole** `drug_class_interactions`, and `allergy_class_mappings`.
- Migration `051_create_drug_interaction_tables.sql` creates the tables empty. The only inserts are in `shared/data-layer/seed/drug-interactions-example.sql` (an example seed).
- If any of the three tables is empty or lacks a row, every check returns null and **no finding, blocker or status says the check had nothing to check against**.
- `SAFETY_DATA_UNAVAILABLE` covers only per-drug normalization (the D14 path). The envFingerprint hashes the reference, but nothing inspects it.
- Also silent: non-SNOMED allergies; SNOMED allergies with no mapping row; a normalized drug with empty `atc_classes` (class rules and allergy matching skip it, `safety-reference.ts:115`, `ddi-engine.ts:179`).
- Live row counts: **unverified** (DB read refused).

---

## 4. Readiness — every blocker type and its source

| Blocker | Scope | Source | Where |
|---|---|---|---|
| `PENDING_GATE` | COMPLETENESS | node `PENDING_QUESTION` with type Gate or DecisionPoint | readiness.ts:19-22 |
| `PENDING_GATE` | COMPLETENESS | a `pendingQuestions` entry whose gate was not already counted (tentative LLM gate INCLUDED on its safe default, D3) | :33-37 |
| `INCOMPLETE_RESOLUTION` | COMPLETENESS | any node TIMEOUT / CASCADE_LIMIT / UNKNOWN (one per node) | :23-25 |
| `INCOMPLETE_RESOLUTION` | COMPLETENESS | `isDegraded` with no per-node one already present (relatedNodeIds []) | :29-31 |
| `UNRESOLVED_RED_FLAG` | COMPLETENESS | every red flag not `acknowledged`; **nothing ever sets acknowledged**. Types: `unroutable_decision` (:743), `all_of_branch_unsupported` (:998), `all_branches_excluded` (:1173), `missing_critical_data` (:1264) | :38-41 |
| `SAFETY_DATA_UNAVAILABLE` | COMPLETENESS | stage-5 `unavailable`, grouped by `source|drugName`, all nodeIds sorted | :44-53 |
| `EMPTY_PLAN` | OUTPUT, ROOT only | no node with type in `ACTION_NODE_TYPES` (types.ts:572: Medication, LabTest, Imaging, Procedure, Guidance, Monitoring, Lifestyle, Referral) and `status === INCLUDED` (disposition) | :55-60 |
| run: child blockers | as child | every contribution's blockers, tagged `pathwayId` | compose.ts:139 |
| `UNRESOLVED_CONFLICT` | OUTPUT | conflict with no decision | compose.ts:241-247 |
| `STALE_CONFLICT_DECISION` | OUTPUT | CONFIRM_PATHWAY naming a pathway not among `candidates[].sourcePathwayId` | :249-255 |
| run `SAFETY_DATA_UNAVAILABLE` | COMPLETENESS | root patient safety over write-ins, `source === 'CANDIDATE'` (relatedNodeIds []) | :142-147 |
| run `EMPTY_PLAN` | OUTPUT | `medications + labs + procedures` of the merged plan = 0 | :158-165 |
| `PLAN_CHANGED_SINCE_REVIEW` | OUTPUT | synthesized at generation when `resultHash !== reviewedResultHash`; replaces all other blockers in the response | resolution.ts:550-564; multi-pathway-resolution.ts:365-372 |

`status` is DEGRADED iff `isDegraded` or any INCOMPLETE node (readiness.ts:62). The session status is derived by `statusOf` (`pipeline/commit.ts:34`).

**EMPTY_PLAN differs between the two paths** [code]:

- A single plan containing only a contraindicated Medication (role ignored), only Guidance, or only Imaging is "non-empty".
- A run whose merged plan has only imaging, guidance, schedules or quality metrics is `EMPTY_PLAN`.
- Schedule and QualityMetric never count in the single path. They are not in `ACTION_NODE_TYPES`.

`UNKNOWN` nodes block as INCOMPLETE_RESOLUTION. Whether indeterminate gates land as UNKNOWN is interpreter territory (not re-verified here).

---

## 5. Result hash and envFingerprint

**`hashOf`** = sha256 of `canonicalJson` (`pipeline/canonical.ts`): keys sorted at every depth, Maps become sorted entry arrays, Sets become sorted arrays, `undefined` is dropped, and **arrays keep their order**.

**Single `resultHashOf`** (`evaluate.ts:114-136`) covers:

- Per node `{nodeId, eligibility.status, disposition.status, withheldBy, excludeReason, override.action}`, sorted by nodeId.
- pendingQuestions without `tentativeReasoning` / `tentativeConfidence`.
- redFlags (whole objects).
- safetyFindings without `meta`.
- catchUpItems.
- blockers (description excluded from the sort key but included in the content).

**Spec rule 8 ("no confidences") is violated** [code] in two places:

- `excludeReason` is hashed and contains numbers, e.g. `"Confidence 0.42 below suggest threshold 0.6"` (traversal-engine.ts:962, 1238).
- redFlags are hashed whole, including `branches[].confidence` for `all_branches_excluded` / `all_of_branch_unsupported` (:1004-1006, 1178).

So a scoring or config change that moves a number without flipping any status still changes `resultHash` and returns `PLAN_CHANGED_SINCE_REVIEW`.

**Not hashed:** `gateContextFields`, `observationsUsed`, confidences on nodes, `safetyUnavailable` (it appears only as blockers), `findingIds`, `status`.

**Run `runHashOf`** (`compose.ts:296-319`):

- `mergedPlan` minus evidenceTrail, dataGapHints and conflicts. It still includes medications, labs, imaging, procedures, guidance, schedules, qualityMetrics, suppressed (with `original.evidenceGateIds`) and catchUpItems.
- Conflicts reduced to `{conflictId, candidate keys, decision kind/chosen/custom}`.
- Root safetyFindings sorted by canonical JSON.
- Blockers sorted by a key that **includes description**.
- Each child's `resultHash` in contributing order.
- A child's hash is the **contribution's own**, computed before root withholding. The stored child `resolution_state` contains root withholdings that its own hash does not cover. They are covered only through `mergedPlan` in the run hash. [code]

**`envFingerprint`** (`load-env.ts:111-125`) = hash{graphFingerprint, signals, thresholds, codeMap, temporalDefaults, scoring (admin evidence, weight matrix, node weights, propagation overrides, thresholds), **entire** safety reference, llmModel}.

- A run's fingerprint = hash of sorted `[pathwayId, childEnvFingerprint]` (`runEnvOf`, l.168-175). Every child carries the one shared run safety reference (l.153).
- Not covered: scorer and engine **code** versions, and temporal policy version (the latter is in inputs via `temporalContext`).
- The fingerprint is recorded for diagnosis. **Nothing compares it.** Graph drift is caught separately by `graphFingerprint` → `SESSION_GRAPH_CHANGED` (evaluate.ts:36-38).

---

## 6. Multi-pathway

### 6.1 Which pathways (start only)

`startMultiPathwayResolution` (`resolvers/mutations/multi-pathway-resolution.ts:227-252`) runs:

1. `getMatchedPathways` (`session-store.ts:448+`).
   - A pathway matches when some `pathway_code_sets` set is fully covered by the patient's codes ∪ ICD-10 ancestors.
   - Real patients read codes from `snapshot_conditions` (latest snapshot, active predicate, system forced to `'ICD-10'`).
   - Synthetic patients read the codes supplied in the request.
   - Status ACTIVE && is_active, or DRAFT when the caller asks for drafts.
2. `collapseLattice` (`lattice-collapse.ts`), which drops pathways whose most-specific set is strictly covered by another's.

**Competing evaluator and snapshot gap** [code]:

- For real patients, matching reads DB condition rows, **not** the `patientContext` that evaluation then uses.
- It runs **outside** the C4 snapshot (before `loadRunEnv`).
- The matched set is frozen into the run's children at start. Later `addPatientContext` never re-matches.
- Lattice domination skips already-dominated `b` (l.~60-70), so the result may depend on input order (title) when domination chains exist. [unverified]

With zero matches, no children are created, and the run stores `EMPTY_PLAN`. With `pinGraphs`, a child whose graph is empty is dropped (run.ts:130).

### 6.2 Per-child CONTRIBUTION evaluation

- All children read one snapshot and one safety reference (run.ts:117-121; load-env.ts:142-159).
- The parent owns facts and clock (`sessionInputsOf`, run.ts:40-45).
- Each child runs `evaluate(..., 'CONTRIBUTION')`: patient safety yes, pair safety no, no EMPTY_PLAN.

### 6.3 `composeRun` (compose.ts:80-223)

1. **Project** each child: `projectResolutionToCarePlan(inNodeOrder(state), meta, catchUpItems, gateContextFields)`.
   - Projection reads `status === INCLUDED` (the disposition), so patient-safety withholding is already applied.
2. **Proposers index.** Every Medication node of **any** status whose `projectMedication` is non-null, keyed by lower-case drug name, with the node's own `clinicalRole` (l.94-103).
3. **Contribution suppressions → `suppressed`** (l.107-115).
4. **`mergeResolvedCarePlans`** (`care-plan-merge.ts:413-574`):
   - Hard constraints: any pathway's `role` contraindicated/avoid suppresses the same-name drug everywhere, first flagger recorded.
   - Name dedup, with canonical = first item (`mapMergeBucket`, l.705-717).
   - `detectConflicts`, then key-dedup for the other sections, catch-up aggregation, and evidence and data-gap dedup by gate nodeId (first pathway wins).
5. **`selectConflicts`** (l.232-285) rebuilds the medications from the base merge on every evaluation.
6. **Root patient safety** over write-ins only (l.125-127).
7. **Pair safety** over the post-selection set, keyed `pathwayId|nodeId` (`recommendationKey`, l.50-51) (l.130-135).
8. **Root blockers** (§4), then EMPTY_PLAN on meds+labs+procedures.
9. **Withholding onto child nodes** (`withholdAt`, l.321-331; only INCLUDED nodes):
   - conflict losers: every proposer with the same drug name **and `p.clinicalRole === conflict.clinicalRole`**;
   - pair SUPPRESS: proposers of that drug in the recommendation's `sourcePathwayIds`;
   - PATHWAY hard-constraint suppressions: the proposing node, `withheldBy:'conflict'`.
   - The node stating the contraindication keeps its status.

### 6.4 Conflicts — confirmed defects

- **Conflict detection is not cross-pathway.** `detectConflicts` (care-plan-merge.ts:584-629) fires whenever at least 2 **distinct drug names** share a `clinical_role`, regardless of pathway. [code]

  Live graphs have exactly this inside one pathway [graph]:

  | Pathway | clinical_role | Drugs sharing it |
  |---|---|---|
  | anemia (all 7 versions) | `iron_repletion_in_pregnancy` | oral iron (first_line) and IV iron (second_line, reached via `ESCALATES_TO`) |
  | anemia (all 7 versions) | `cause_directed_anemia_therapy_in_pregnancy` | B12 and folic acid |
  | preeclampsia | `antihypertensive-primary` | labetalol and nifedipine ER, plus the contraindicated ACE/ARB class node |

  When both are INCLUDED in a run, even a one-pathway run gets `UNRESOLVED_CONFLICT`. A standalone single session of the same pathway, same patient, has **no conflict stage at all** and is ready. [code; inclusion per patient unverified]

- **CONFIRM_PATHWAY keeps every same-pathway candidate** (compose.ts:261-268, confirmed). The loop pushes every candidate whose `sourcePathwayId === chosen`.
  - An intra-pathway conflict (above) therefore resolves to "keep both" under CONFIRM_PATHWAY. The choice is a no-op.
  - Only REJECT_BOTH, ACCEPT_BOTH or CUSTOM_OVERRIDE change anything.
  - The same applies whenever the chosen pathway contributes two drugs to one role.
- **Candidate pathway is `g.sourcePathwayIds[0]` only** (care-plan-merge.ts:607-612). A name-group shared by pathways A and B is labelled A. Consequences:
  - `validateResolutionAgainstConflict` (multi-pathway-resolution.ts:669-681) rejects choosing B when B only co-proposes. (`selectConflicts` would instead emit STALE_CONFLICT_DECISION, compose.ts:249.)
  - If B has its own candidate and is chosen, the A-labelled shared drug is a loser, and it is withheld on B's node too (proposers match by name and role, l.170-172). [derived, unverified by test]
- **Role taken from the first group member** (confirmed).
  - `detectConflicts` reads `group.recommendation.clinicalRole`, and `recommendation` = `items[0]` (l.707-711). The doc comment claims "first non-empty".
  - An untagged first proposer hides a tagged second one, so no conflict is detected.
  - Withholding compares each proposer's **own** `clinicalRole` to the conflict's (compose.ts:171). A losing drug's node that is untagged or differently tagged in another pathway is **not** withheld: it stays INCLUDED in the child state while the merged plan omits it. Child disposition and the merged plan diverge.
- **Write-ins** (CUSTOM_OVERRIDE):
  - `role:'first_line'`, `sourcePathwayId:'provider-override'`.
  - Patient-safety checked at the root. If suppressed, the write-in is removed from `medications`, recorded in `suppressed`, and blocks only when unnormalized (relatedNodeIds []).
  - A suppressed write-in is not reflected as any blocker or conflict re-open. The provider's choice is silently dropped, visible only in `suppressed`. [code]

### 6.5 Root safety and readiness

- Pair safety spans pathways and the same pathway (no same-pathway skip), after selection.
- Root patient safety covers write-ins only, so a contribution's patient findings are not recomputed. Findings are reused, not re-decided.
- Root `ready` = no blockers from children, selection, write-ins or EMPTY_PLAN (l.218).

---

## 7. Projection into care plans

### 7.1 Single path: `generateCarePlanFromResolution` → `generateCarePlan` → `insertCarePlanRows`

- `resolvers/mutations/resolution.ts:524-600`: re-evaluates at ROOT, applies the D7 hash check, requires readiness, then claims COMPLETED and inserts in one transaction.
- `care-plan-generator.ts:143-185`:
  - `conditionCodes` come from `properties.condition_codes` of INCLUDED nodes. **No live node has it** [graph], so `condition_codes` is always `[]` in practice.
  - Goals come from INCLUDED **Stage** nodes with an INCLUDED action descendant (parent-chain walk), priority HIGH.
  - Interventions come from INCLUDED `ACTION_NODE_TYPES` nodes. Type map (l.58-65): Medication → MEDICATION, LabTest → MONITORING, Procedure → PROCEDURE, Monitoring/Lifestyle/Referral map directly. **Imaging and Guidance fall back to `'MONITORING'`.**
  - Fields: title, `recommendationConfidence` (computed; **not written** by `insertCarePlanRows`), medicationCode, dosage, frequency, procedureCode, referralSpecialty, patient_instructions, guideline_reference. **route, duration, the Guidance `instructions`, Imaging modality and Lab code are dropped.**
  - Schedule and QualityMetric are **never** written (not action types).
  - **Role is ignored: a contraindicated or avoid Medication that traversal INCLUDED is written as a MEDICATION intervention (confirmed).** Live example [graph]: preeclampsia `med-6` "ACE inhibitors, ARBs, renin inhibitors and MRAs", `role: contraindicated`, is a `USES_MEDICATION` child of `step-5-1` ("Escalate to inpatient evaluation") alongside labetalol and nifedipine. It is scored like any action node, so it is INCLUDED whenever its confidence ≥ suggest. Nothing in single-path disposition, readiness or generation looks at `role`. [per-patient inclusion unverified]
  - No conflict detection and no contraindicated-role suppression (both are run-only).
- `insertCarePlanRows` (resolution.ts:314-383): the title comes from `pathway_graph_index.title`, and provenance is packed into `guideline_reference` (`pathway: node: session:`). Warnings are returned, not persisted to the plan.

### 7.2 Run path: `generateMergedCarePlan` → `materializeCarePlan`

- `multi-pathway-resolution.ts:341-400`: re-evaluates every child, applies the D7 check on the run hash, requires root readiness, claims COMPLETED for parent and children, inserts.
- `materializeCarePlan` (l.699-756) — **run projection drops sections and fields (confirmed):**
  - title is a constant `'Multi-Pathway Care Plan'`; `condition_codes` is `[]`;
  - goals are placeholders `"Goals from pathway <uuid>"`, one per `session.contributingPathwayIds` (the **pre-evaluation** parent row, not `ev.result`);
  - interventions only for `medications` (name, dose, frequency), `labs` (name, as MONITORING) and `procedures` (name, code);
  - **dropped:** imaging, guidance, schedules, qualityMetrics, catchUpItems, med route/duration/clinicalRole, lab code/system/specimen, procedure system, and all evidence and attribution;
  - no Stage goals, unlike the single path.
- The spec lists "#11 exhaustive persistence of imaging, guidance, schedules and quality metrics" as out of scope. The asymmetry with the single path (which writes Imaging and Guidance as MONITORING) is not stated there.

### 7.3 Projection helpers

`care-plan-projection.ts`:

- Its **own `ACTION_NODE_TYPES`** (l.136-144: Medication, LabTest, Imaging, Procedure, Guidance, Schedule, QualityMetric) differs from `types.ts:572`. It omits Monitoring/Lifestyle/Referral and adds Schedule/QualityMetric. That makes three different action-type sets across traversal and readiness, projection, and run EMPTY_PLAN.
- Projection returns `null` (a silent drop) for a Medication without `role`, Imaging without `modality`, Guidance without `instructions`, Schedule without `interval`+`description`, and QualityMetric without `measure`. These nodes still count as "action" for single-path EMPTY_PLAN when in `types.ACTION_NODE_TYPES`.
- `computeAttribution` walks the parent chain and attributes non-EXCLUDED Gate/DP siblings.
- `collectDataGapHints` covers GATED_OUT / PENDING / UNKNOWN gates with action nodes whose `parentNodeId` is the gate.
- These run in the **run path only**.

---

## 8. Re-decisions, competing evaluators, duplication

### 8.1 Stages that decide something the interpreter did not

| Stage | Re-decides / competes? |
|---|---|
| Scoring (pre-traversal) | **Yes, it is an input decision.** It decides action inclusion and DP routing via suggestThreshold, with scorer-private patient semantics (no temporal, "already on drug" = match). |
| Catch-up | Competing satisfaction matcher; ignores the resolution state and `lookback_days`. |
| Patient and pair safety | Additive disposition only (C2). Ignores `role`. |
| risk_magnitude allergy fallback | Duplicate allergy logic (RxNorm-to-allergy-code equality) vs safety's SNOMED→ATC. The two can disagree; one lowers confidence, the other suppresses. |
| Merge hard constraints | New decision (`role` contraindicated/avoid), **run only**. |
| Conflict selection | New decision (clinical_role), **run only**. Intra-pathway and first-member-role defects. |
| getMatchedPathways | Separate evaluator over DB snapshot rows, outside C4, frozen at start. |
| Readiness | No re-decision. Red flags are permanent blockers. |

### 8.2 Single vs run duplication or divergence

| Concern | Single | Run |
|---|---|---|
| Pair-safety identity | nodeId | `pathwayId|nodeId` |
| Contraindicated/avoid role | ignored, written | suppresses same-name drugs |
| Conflicts | none | clinical_role, even intra-pathway |
| EMPTY_PLAN | `types.ACTION_NODE_TYPES` INCLUDED | meds+labs+procedures |
| Written sections | Stage goals + all action types (Imaging/Guidance as MONITORING) | meds, labs, procedures; placeholder goals |
| Evidence trail / data gaps | never computed | computed, not hashed, not written |
| Warnings | `warningsOf(result.safetyFindings)` | `warningsOf(ddiWarnings)` (child and root WARN) |
| Hash | node layers + findings + blockers | merged plan + conflicts + root findings + blockers (with descriptions) + child hashes |

---

## 9. Confirmed defects (task list) and additional findings

**The five listed by the caller:**

1. **CONFIRM_PATHWAY keeps all same-pathway candidates** — compose.ts:261-268. Combined with intra-pathway conflict detection (care-plan-merge.ts:597-599) and live same-role pairs in anemia and preeclampsia, the choice can be a no-op.
2. **Role from first group member** — care-plan-merge.ts:590-591 with `mapMergeBucket` l.709. Withholding requires a per-proposer role match (compose.ts:171), so the merged plan and child dispositions diverge.
3. **Run projection drops sections and fields** — multi-pathway-resolution.ts:699-756.
4. **Single path writes contraindicated nodes** — care-plan-generator.ts:178-182. Live candidate: preeclampsia `med-6`.
5. **Empty safety reference not surfaced** — safety-reference.ts:37-100; migration 051 creates the tables empty. Non-SNOMED allergies, unmapped allergies and ATC-less drugs are also silent.

**Additional:**

6. **Confidence leaks into `resultHash`** via `excludeReason` text and red-flag `branches[].confidence`, violating spec rule 8. Config drift therefore causes PLAN_CHANGED without a status change.
7. **`resolutionType`, `autoResolveThreshold` and `auto_resolve_eligible` are dead.** Node-scoped thresholds are never resolved.
8. **Propagation is silently disabled per pathway by REQUIRES back-edges** (preeclampsia: 6 cycles).
9. **Confidence red flags are unacknowledgeable permanent blockers** (`acknowledged` is never set).
10. **Medication scorers penalize drugs the patient is not already taking.** The name-match treats an empty display as matching everything.
11. **Catch-up flags every REQUIRES target**: no live `satisfaction_check`, the resolution state is ignored, and `lookback_days` is ignored.
12. **Three divergent action-type sets**, and two EMPTY_PLAN definitions.
13. **Matching** reads `snapshot_conditions`, not the evaluated context, outside the snapshot, frozen at start.
14. **A suppressed write-in** is silently dropped with no blocker.
15. **The `pathwayConfidence` query** uses a different patient-context construction than evaluation.
