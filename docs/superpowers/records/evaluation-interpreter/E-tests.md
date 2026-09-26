# E — Test catalog: interpreter semantics (pathway-service)

Worktree: `/home/claude/workspace/features/docs-evaluation-interpreter-design/prism-graphql` @ `d377465`.
All paths below are relative to `apps/pathway-service/src/__tests__/`. Engine is `services/resolution/traversal-engine.ts` (1345 lines).
Read-only; nothing was edited.

## 0. Test run

**Not run.** The worktree has no `node_modules` (not in `apps/pathway-service`, the `prism-graphql` root, or any ancestor). Per instructions I did not install. So the pass/fail counts for `traversal-engine eager-reachability pipeline-traversal-overrides pipeline-properties branch-mode prerequisites` are **unknown**. Where I say a status is "inferred" below, it comes from reading `traversal-engine.ts`, not from executing anything.

`pipeline-postgres.test.ts` is opt-in anyway: `describePg = RUN_PIPELINE_PG_TESTS==='1' ? describe : describe.skip` (:37).

## 1. Common harness shape

- **TraversalEngine suites** (`traversal-engine`, `branch-*`, `eager-*`, `escalate-*`, `indeterminate-surface`, `pipeline-traversal-overrides`, `anemia-pathway-e2e`, `temporal/clock-pinning`) build the engine directly: `new TraversalEngine(mockConfidence, {auto .85, suggest .6}, makeEvaluationTemporalContext({... 'legacy-v0'|'v1'}), {}, factStore, codeMap[, llmEvaluator])`.
  - Confidence is mocked, and it is the only lever for DecisionPoint branch qualification.
  - Almost all of these are `legacy-v0`. Only `escalate-on-unresolved` and `indeterminate-surface` use `v1` with an assembled fact store.
- **Pipeline suites** (`pipeline-*`, `temporal/v1-traversal-behavior`) use `fixtures/pipeline-env.ts` (`makeEnv`/`makeInputs`) and `evaluate(inputs, env, observations, 'ROOT'|'CONTRIBUTION')`.
  - Suites that run through the resolvers use `fixtures/resolver-harness.ts`, which mocks session-store, run-store, load-env and lattice.
  - **The `edge()` default in `pipeline-env.ts:15` is `HAS_CHILD`.** Many pipeline fixtures wire gates with plain `HAS_CHILD` rather than `HAS_GATE`/`BRANCHES_TO`: `pipeline-properties`, `pipeline-sequence-vs-fresh` PROPERTY_ENV/NESTED, `pipeline-acceptance-a1/a2`, `pipeline-traversal-overrides`, `v1-traversal-behavior`. So the gate edge semantics are exercised mostly through the generic "enqueue all outgoing" path.

## 2. Per-file catalog

### Traversal core
| File | What it pins |
|---|---|
| `traversal-engine.test.ts` (325) | Basics: linear walk all INCLUDED (:65). Action below suggest threshold → EXCLUDED (:96). An unsatisfied patient_attribute gate → gate + subtree GATED_OUT, with the parent stage still INCLUDED (:141). An unanswered question → gate + subtree PENDING_QUESTION, `affectedSubtreeSize` 2 (:179). prior_node_result on a sibling INCLUDED step → gate + child INCLUDED (:215). An all-below-threshold DP → `all_branches_excluded` red flag (:244; DP has no `branch_mode`, so it defaults to one_of). Criterion/Evidence informational at confidence 1 (:291). No root → degraded (:314). |
| `anemia-pathway-e2e.test.ts` (202) | `legacy-v0` gate firing on the canonical anemia fixture: severe/T2 fire for Hb 6.2 and T1T3 does not (:111). `in [1,3]` array op; ferritin gate (:145). `delta_from_baseline` on a dated rising series (:172). Missing trimester → GATED_OUT (:184). Missing data is treated as a definite false (no ferritin → GATED_OUT, :136-137; undated single Hb → delta GATED_OUT). |
| `temporal/v1-traversal-behavior.test.ts` (114) | v1 horizon cascade through the resolvers: a pathway YEAR default admits a 200-day lab (:60); no default → GATED_OUT "No numeric value found" (:66); legacy ignores horizons (:74). `addPatientContext` flips a GATED_OUT gate and its subtree to INCLUDED (:88); an out-of-horizon lab does not flip it (:106). |
| `temporal/clock-pinning.test.ts` | Moving the wall clock does not change a gate outcome (:93). |

### Gates (`gate-evaluator*`, which unit-test `evaluateGate` with no traversal)
| File | What it pins |
|---|---|
| `gate-evaluator.test.ts` (483) | patient_attribute includes_code exact/wildcard/meds (:62-116). Empty field/missing condition → unsatisfied (:133,:149). Vitals flat/dotted/missing → unsatisfied (:163-259). **prior_node_result**: expected status → satisfied (:279); wrong status → unsatisfied (:296); **dependency not in state → unsatisfied, reason NOT_FOUND** (:314). question: true → sat, false → unsat, unanswered → unsat, *any* numeric or select answer → sat (:333-395). compound AND/OR (:416-468). |
| `gate-evaluator-compound-uncertainty.test.ts` (623) | Normative 3-valued truth table for AND/OR indeterminate: a definite false dominates in AND, a definite true dominates in OR (:291-364). Uncertainty is a union (:375). `dataUnavailable` / `unresolvedConditions` name the missing condition (:555-619). legacy-v0 shape unchanged (:428). |
| `gate-evaluator-scalar-kernel.test.ts` (539) | v1 scalar: exact code only; latest value, not array order (:261-284); horizon/validity/encounter drops (:298-334). Indeterminate fails closed and is recorded (:354-415). Cascade errors throw (:455). Coded and attribute spellings agree on `dataUnavailable` (:504). |
| `gate-evaluator-membership-kernel.test.ts` (467) | v1 membership: wildcard/system/equals/exists (:154-244). **Fails open on validity-UNKNOWN (satisfied=true, never indeterminate)** (:283-330). Disclosed v1 deltas (:332-398). |
| `gate-evaluator-aggregate-kernel.test.ts` (1017) | count_in_window, trend_up/down and delta_from_baseline under v1: windows, min_points, D7 undated handling (fails closed on LIFETIME series), D8 occurrence semantics. Aggregate excludes uncertain facts (:533). Errors propagate (:950). |
| `gate-evaluator-count-in-window.test.ts`, `-trend.test.ts` | legacy-v0 aggregate operators: thresholds, window edges, future-dated ignored, slope/delta thresholds. |
| `gate-evaluator-attribute.test.ts`, `-codemap-threading.test.ts` | Attribute path (`lab.hemoglobin`) fires/doesn't. An empty codeMap cannot resolve `lab.*`. |
| `gate-evaluator-version-seam.test.ts` (306) | An explicit clock/defaults are required. Dispatch is by policy version; unknown version rejected; the evaluator table is frozen. |

### Decision points and routing
| File | What it pins |
|---|---|
| `branch-mode.test.ts` (468) | **one_of**: auto-select when one branch qualifies (:90); PENDING at DP when two qualify (:102); SELECT question listing candidates (:112); absent `branch_mode` = one_of (:130). **Chosen branch** closes unchosen branches and their subtrees, leaving nothing pending (:158). The choice survives re-eval (:187). A stale choice re-pends rather than switching (:217). No qualifier → red flag, no question (:234-247). **all_of**: every branch INCLUDED even below threshold, flagged `all_of_branch_unsupported` (:262-287); the mandate covers action targets (:330) but not grandchildren (:351). **any_of**: all qualifiers (:384). SELECTS_BRANCH criterion text used in excludeReason (:396-467). |
| `branch-routing.test.ts` (437) | Gate `BRANCHES_TO.when` routing: SELECT → one arm (:101); non-branch child (evidence) still traversed (:122). BOOLEAN true/false arms, with `false` routing to its arm and the gate INCLUDED (:155-179); unanswered → pending (:181). A multi-target patient_attribute gate → no arm + `unroutable_decision` (:226). NUMERIC half-open ranges (:260-277). Single-target gate unaffected (:283). LLM `chosenBranch` routes (:354); **below threshold → safe default INCLUDED + tentative question** (:363). Cardinality: duplicate/zero match → no arm + flag (:411-436). |
| `branch-routing-validation.test.ts` (299) | Import-time `parseBranchWhen`, numeric cover (gap/overlap/tail), SELECT/BOOLEAN/NUMERIC/LLM mapping completeness; rejects multi-branch routing on patient_attribute (:188). |
| `decision-value.test.ts` (88) | `decisionValueOf`: false is a decision; 0 is not falsy; provider answer beats LLM; field precedence boolean>numeric>select; NaN refused. `decisionSelects`: kind-strict, half-open ranges. |
| `escalate-on-unresolved.test.ts` (274, v1) | Scalar gate with no value → gate+subtree PENDING_QUESTION with datumKey/askTarget (:104). Authored prompt wins (:120). `on_unresolved:'default'` → GATED_OUT (:131). Definite "no" → GATED_OUT, no question (:141). Membership no-code → GATED_OUT (:152). Aggregate → no question (:165). Dedupe by datum (:182). Compound asks for the missing datum (:240-273). |
| `indeterminate-surface.test.ts` (244, v1) | `indeterminate`/`dataUnavailable` flags reach the NodeResult (:156-243). With `on_unresolved:'default'`, **indeterminate and absent-datum gates are GATED_OUT** (:169, :186). |
| `lattice-collapse.test.ts` (291) | Multi-pathway matching (not traversal): subset and ICD-10 ancestor domination, cross-system isolation, order preserved. Counts and ids only. |

### Eager reachability and dependencies
| File | What it pins |
|---|---|
| `eager-reachability.test.ts` (113) | `gate-dep` (prior_node_result on `step-hidden`) is visited before `gate-closed`, which guards `step-hidden`. Asserts gate-closed GATED_OUT and step-hidden/med-hidden **not INCLUDED** (:88-104). |
| `eager-disposition-parity.test.ts` (188) | The same node disposes identically via walk or eager path: TRAVERSE default → INCLUDED (:113); unanswered question pends and asks (:123-137); eager subtree still traversed (:145). An unreadable `default_behavior` fails closed (:166); TRAVERSE is case-insensitive (:179). |
| `reachability.test.ts` (701) | *Static* data-availability scorer (`scoreReachability`/`hasDataForCondition`), not walk reachability. It classifies gates ALWAYS_EVALUABLE/DATA_AVAILABLE/DATA_BLOCKED/QUESTION/INDETERMINATE and computes `autoResolvableScore`. It is a flat gate list that ignores graph position (a gate behind a closed gate still counts). |
| `matched-pathway-reachability-resolver.test.ts` (145) | Resolver wiring only: memoised patient-context loader, delegation, empty fallback. Mocks throughout. |
| `prerequisites.test.ts` (209) | `findUnmetPrerequisites` over REQUIRES edges. Checks satisfaction against the **patient snapshot only**, never resolution state. No check → unmet; code check across any bucket (a CPT code in `labResults` counts, :89); transitive; **recursion stops at the first satisfied prereq** (:127); cycle-safe; attestation always unmet. |
| `pipeline-depends-on-medication.test.ts` (29) | Validator: depends_on may not target a Medication (bare or canonical form); a Step is allowed. |

### Overrides, observations, properties
| File | What it pins |
|---|---|
| `pipeline-traversal-overrides.test.ts` (58) | INCLUDE on a below-threshold med → INCLUDED and its child traversed (:25). **Held Step under a closing gate stays INCLUDED while its child is GATED_OUT** (:37). Empty overrides = no overrides (:51). |
| `pipeline-observations.test.ts` (78) | LLM observation key composition (the threshold is excluded), replay, session/request reuse; a failure returns UNAVAILABLE and records nothing. No traversal. |
| `pipeline-acceptance-a1.test.ts` (60) | Replay determinism. **An UNAVAILABLE LLM verdict → gate INCLUDED via safe default, tentative question, PENDING_GATE blocker** (:36). Graph-fingerprint refusal. |
| `pipeline-acceptance-a2.test.ts` (72) | Eligibility vs disposition: allergy withholds but eligibility stays INCLUDED; a prior_node_result on the parent step is unaffected by suppression (:36); unnormalised → SAFETY_DATA_UNAVAILABLE; pair safety at ROOT only. |
| `pipeline-properties.test.ts` (136) | fast-check (100 runs): (c) determinism (hash/canonical JSON equal); (b) input **Map insertion order** independence. Positive controls: override honoured (:198) and the pinned examples reach catch-up/tied-DDI paths (:204). |

### Composition and runs
| File | What it pins |
|---|---|
| `pipeline-compose.test.ts` (292) | `composeRun`: an empty child doesn't block; a child's pending gate blocks, tagged with its pathway (:80). Cross-child conflicts: undecided blocks; CONFIRM/ACCEPT_BOTH/REJECT; allergy persists; ids don't alias; write-ins are safety-checked; run hash stable under override order; a contraindicated/avoid role in one pathway withholds all proposers, but **the constraint node itself stays INCLUDED** (:284). |
| `pipeline-run-mutations.test.ts` (324) | Start run (one child per pathway, zero-match EMPTY_PLAN, failure writes nothing). Child answer/override recomposes the run; a fact on one child reaches others; resolveConflict; abandon; env-change A4. |
| `pipeline-run-commit.test.ts` (201) | evaluateRun under one snapshot; commitRun revision lock/retry/CONFLICT; refusals. |
| `pipeline-run-generation.test.ts` (185) | Merged plan generation: reviewed-hash check, pending child blocks, conflict blocks, idempotent claim/rollback. |
| `pipeline-run-sequence-vs-fresh.test.ts` (261) | fast-check: mutations one at a time == `evaluateRun(final inputs)` (hash); independent edits commute (hash). Review repros #2/#5/#6/#7. |
| `pipeline-sequence-vs-fresh.test.ts` (270) | Single-session (a) property (hash). **#1** nested gate can't reopen under a closed ancestor (:160). #3 whole-graph confidence propagation. **#9 PINNED DEFECT** reconvergence (:223). **#10 PINNED DEFECT** vital answer key mismatch (:247). |
| `pipeline-postgres.test.ts` (251, opt-in) | Migrations 067/068 shape, revision locks, single care plan under concurrency, override audit row. No interpreter semantics. |

### temporal/* (34 files)
Almost entirely kernel/unit level, with no traversal statuses:
- cascade-parse/resolve, gate-policy, policy-registry/capabilities/default
- evaluation-context, interval, overlap, select-facts, state-mapping, fact-model, fact-identity
- context-assembler-*, condition-adapter, condition-control-domains, attribute-condition-*
- encounter-anchor-*, sweep-attribute-codemap, codemap-required, trust-mode, synthetic-values
- resolution-input-contract, resolution-fact-store-wiring, resolution-context-defaults, session-temporal-context, evaluator-selected-by-capability, assembler-preserves-today, contract

Only `clock-pinning` and `v1-traversal-behavior` assert node statuses from a traversal. `state-mapping` pins fail-open defaults: condition missing status → active; allergy missing → active; med missing → UNKNOWN.

## 3. Fixture shapes

### `fixtures/reference-pathway-with-gates.ts` — ORPHANED
**Nothing imports it** (grep across `src/`). It is a PathwayJson built by cloning `REFERENCE_PATHWAY` and adding:

| Gate | Type | Condition | Parent (HAS_GATE) | BRANCHES_TO |
|---|---|---|---|---|
| `gate-transplant-screen` | patient_attribute, skip | `{field:'conditions', operator:'includes_code', value:'Z94.*', system:'ICD-10'}` | stage-3 | step-immunosuppression (stage_number 3) |
| `gate-prior-cesarean` | question BOOLEAN, skip | prompt "Was the prior uterine surgery a cesarean delivery?" | stage-2 | step-cesarean-specific (stage_number 2) |
| `gate-med-monitoring` | prior_node_result, skip | `depends_on:[{node_id:'step-3-1', status:'INCLUDED'}]` | stage-3 | step-med-monitoring (stage_number 3) |

- The gated steps have **no HAS_STEP edge**; they belong to a stage only via the `stage_number` property (which resolution never reads).
- The depends_on target `step-3-1` is a sibling under the same stage, reached via stage-3.
- Base `REFERENCE_PATHWAY` (also unused by any resolution test; only `graph-builder`/`validator`/`pipeline-depends-on-medication` use it):
  - `dp-1` DecisionPoint `branch_mode:'one_of'`, attached `step-2-1 -HAS_DECISION_POINT-> dp-1`.
  - It has **a single** `BRANCHES_TO stage-3` (label "TOLAC candidate", confidence_threshold 0.7) and criteria crit-1/crit-2 via HAS_CRITERION, with no SELECTS_BRANCH.
- **Multi-parent nodes:**
  - **stage-3** (root HAS_STAGE *and* dp-1 BRANCHES_TO). This is a reconvergence where the DP decision is bypassed by the root edge.
  - **med-2** (step-3-1 USES_MEDICATION *and* med-1 ESCALATES_TO).

### `fixtures/anemia-pathway-canonical.ts`
An in-memory GraphContext:
- `root -HAS_CHILD-> stage-1 -HAS_CHILD-> step-1`.
- step-1 HAS_GATEs all five gates; each gate BRANCHES_TO one distinct action.
- All gates are `default_behavior: skip`.
- No DecisionPoints, no depends_on, no multi-parent nodes, no `when`.

| Gate | Type | Condition(s) | Action |
|---|---|---|---|
| gate-severe-anemia | patient_attribute | `{field:'labs', operator:'less_than', value:'718-7', system:'LOINC', threshold:7}` | action-severe-anemia-transfusion (Medication) |
| gate-anemia-t2 | compound AND | `{attribute:'patient.trimester', operator:'equals', value:2}` + labs 718-7 `<10.5` | action-anemia-t2-oral-iron (Medication) |
| gate-anemia-t1t3 | compound AND | `patient.trimester in [1,3]` + labs 718-7 `<11` | action-anemia-t1t3-oral-iron (Medication) |
| gate-iron-deficient | patient_attribute | labs 2276-4 `<30` | action-iron-deficient-workup (LabTest) |
| gate-oral-iron-response | patient_attribute | labs 718-7 `delta_from_baseline`, delta_threshold 1, window_days 14 | action-oral-iron-response-recheck (LabTest) |

Parallel independent gates on one step: severe and T2 can both fire, and the test asserts both treatments INCLUDED together (:111-117).

### Other fixtures
- `reference-patient-context.ts`: REFERENCE/EMPTY/FULLY_MATCHED patients plus `makeGraphContext`.
- `pipeline-env.ts`: node/edge/makeEnv/makeInputs, with edge default HAS_CHILD.
- `resolver-harness.ts`: in-memory session/run stores and a pathway registry.
- Inline graphs in each test dominate. Real multi-parent/diamond graphs appear only in `pipeline-sequence-vs-fresh` #9 (`a→shared`, `b→shared`). Multi-branch DPs appear only in `branch-mode`.

## 4. FLAG (a) — assertions pinning behaviour believed defective

1. **Reconvergence is order-dependent (explicitly pinned).**
   - Where: `pipeline-sequence-vs-fresh.test.ts:242-243`: `expect(r.resolutionState.get('a')!.status).toBe(NodeStatus.INCLUDED); expect(r.resolutionState.get('shared')!.status).toBe(NodeStatus.EXCLUDED);`
   - Labelled "PINNED DEFECT" (:223-227): first-writer-wins; the not-selected arm b sweeps `shared` before the selected arm a reaches it. The engine comment "first-writer-wins for diamond graphs" is at traversal-engine.ts:~543.
2. **INCLUDED node downstream of a closed gate (override).**
   - Where: `pipeline-traversal-overrides.test.ts:44-48`. Gate `q` answered false: `expect(...get('q')!.status).toBe(NodeStatus.GATED_OUT); expect(...get('step')!.status).toBe(NodeStatus.INCLUDED); expect(...get('med')!.status).toBe(NodeStatus.GATED_OUT);`
   - A held INCLUDE override survives its guard closing. The result is an INCLUDED Step whose own child is GATED_OUT.
   - Mechanism: overrides are pre-seeded INCLUDED at depth 0 before the walk (traversal-engine.ts:469-483), so they stand even if the walk never legitimately reaches them.
3. **LLM gate with no/low-confidence verdict is INCLUDED and routes its safe-default arm while still unresolved.**
   - `pipeline-acceptance-a1.test.ts:39`: `expect(r.resolutionState.get('gate-llm')!.status).toBe(NodeStatus.INCLUDED)`, alongside `tentative: true` pending (:41). This is an "unknown" gate opening its subtree; only readiness blocks.
   - `branch-routing.test.ts:369`: `expect(r.resolutionState.get('step-bacterial')!.status).toBe(NodeStatus.INCLUDED)` with `pendingQuestions[0].tentative === true` (:373-374).
4. **Unsatisfied gate with `default_behavior: traverse` → INCLUDED subtree.**
   - `eager-disposition-parity.test.ts:118`: `expect(direct.resolutionState.get('subject')!.status).toBe(NodeStatus.INCLUDED)`; also :185 for every casing.
   - Authored semantics, but it is by definition "included downstream of a closed gate". Decide whether the interpreter keeps TRAVERSE as a gate state or maps it to a distinct status.
5. **all_of mandates below-threshold branches INCLUDED.**
   - `branch-mode.test.ts:266`: `expect(r.resolutionState.get('step-b')!.status).toBe(NodeStatus.INCLUDED)` (score 0.2); :334 does the same for med-weak.
   - Flagged, not excluded. Design choice, but it is "included despite data".
6. **Unknown is treated as closed, silently, on legacy-v0 and on `on_unresolved:'default'`.**
   - `anemia-pathway-e2e.test.ts:136-137` (no ferritin → `GATED_OUT`), :180-181 (missing trimester → `GATED_OUT`).
   - `indeterminate-surface.test.ts:169` (indeterminate → `GATED_OUT`), :186 (absent datum → `GATED_OUT`).
   - `v1-traversal-behavior.test.ts:90-91` (no lab → gate and step `GATED_OUT`).
   - These pin "unknown ≡ false" wherever escalation is off. Not "included", but it merges UNKNOWN into CLOSED.
7. **Membership fails open on uncertain facts.**
   - `gate-evaluator-membership-kernel.test.ts:297-300`: validity-UNKNOWN fact → `expect(r.satisfied).toBe(true)`. An unknown fact opens the gate.
   - `temporal/state-mapping.test.ts` pins missing condition/allergy status → active (fail-open).
8. **Contraindication node INCLUDED.**
   - `pipeline-compose.test.ts:284`: `expect(node0(r, 1, 'b').status).toBe(NodeStatus.INCLUDED)` for a `role:'contraindicated'` Medication.
   - Semantically the "include" status on a node that means "never give".
9. **Prerequisites ignore traversal state.**
   - `prerequisites.test.ts:127-146` stops at the first satisfied prereq, so transitive prereqs are skipped.
   - :78-91 and :183 satisfy from any snapshot bucket, e.g. a CPT code in `labResults`. REQUIRES is never checked against whether the prereq node was reached or included.
10. **Override on a Gate/DecisionPoint opens ALL arms: untested, but the engine does it.**
    - On arrival at a held node, traversal-engine.ts:527-536 enqueues *every* outgoing edge, bypassing `when` routing and `branch_mode`.
    - No test overrides a Gate or DP. All override tests target Step/Medication: `pipeline-traversal-overrides`, `pipeline-properties:135`, `pipeline-*-sequence-vs-fresh`, `pipeline-compose:220`. So nothing pins it either way; it is an untested defect path.
11. **depends_on on an unreached/guarded node: likely satisfied, and masked by a weak test (see b1).**
    - The evaluator treats absent-from-state as unsatisfied (`gate-evaluator.test.ts:314-330`, `reason` contains `NOT_FOUND`).
    - But in traversal, eager evaluation disposes the dependency *in isolation*, ignoring its guard (traversal-engine.ts:1321-1343, throwaway queue). In `eager-reachability`, step-hidden is disposed INCLUDED (confidence 0.9, no guard context) → gate-dep reads INCLUDED → gate-dep INCLUDED. The guard later re-marks step-hidden GATED_OUT.
    - Inferred, not executed: `gate-dep` ends INCLUDED based on a status its dependency no longer has.

## 5. FLAG (b) — scenarios exercised without asserting the key status

1. `eager-reachability.test.ts:108-112`, "still lets the depending gate reach a verdict": only `expect(r.resolutionState.get('gate-dep')).toBeDefined()` and the same for step-hidden. **gate-dep's status is never asserted**, which is exactly where defect (a)11 would show. There is also no mirrored graph (gate-closed first) to prove order-independence.
2. `eager-reachability.test.ts:93, :103`: `not.toBe(INCLUDED)` only, with `med?.status` allowing `undefined`. PENDING/EXCLUDED/missing all pass.
3. `eager-disposition-parity.test.ts:145-148`: `expect(eager.resolutionState.has('step-1')).toBe(true)`, with no status. Lines :123-130 never assert the *dependent* gate's status when its dependency is PENDING.
4. Pervasive `not.toBe(NodeStatus.INCLUDED)` for "not taken" arms, which cannot tell EXCLUDED, GATED_OUT, PENDING and missing apart:
   - `branch-mode.test.ts:106-109, :224`
   - `branch-routing.test.ts:108-109, :184-185, :228-229, :268, :276, :360, :370, :415-416, :424`
   - `pipeline-sequence-vs-fresh.test.ts:186`
   - `v1-traversal-behavior.test.ts:63, :101` (`not.toBe(GATED_OUT)`)
   - `anemia-pathway-e2e.test.ts:180-181` (redundant with the next lines)
5. `escalate-on-unresolved.test.ts:165-178`: an aggregate gate with no data asserts only `pendingQuestions` length 0. **The gate and subtree status are unasserted**, and this is an unknown case. Lines :240-244 and :258-273 (compound escalation) likewise assert only question lists.
6. `pipeline-properties.test.ts`: both properties compare only `resultHash`/canonical JSON.
   - "Order independence" varies only *input Map insertion order*, never edge/visit order. It therefore cannot detect (a)1 or (a)11.
   - The generator has no diamonds or DPs, and gates are via HAS_CHILD.
   - There are no semantic invariants, e.g. "nothing INCLUDED under a GATED_OUT ancestor unless overridden".
7. `pipeline-run-sequence-vs-fresh.test.ts:154-221` and `pipeline-sequence-vs-fresh.test.ts:130-145`: hash equality only. Overrides may target meds under unanswered/false gates (`warf` behind `qa`), so (a)2 is exercised thousands of times and never asserted.
8. `pipeline-compose.test.ts:80-86` asserts the blocker but not that the med under the pending gate stays out of `mergedPlan`. :227-231 asserts only that the hash moved.
9. `traversal-engine.test.ts:215-240`: the dependency is satisfied only because `root→step-a` is listed before the HAS_GATE edge. The reversed order (the eager path) is not tested there.
10. `reachability.test.ts` / `matched-pathway-reachability-resolver.test.ts` / `lattice-collapse.test.ts`: counts, ids and mock-call assertions only. None involves node disposition, and `:682` `expect(() => …).not.toThrow()` is trivially true.
11. `pipeline-traversal-overrides.test.ts:51-57`: equality of two runs plus one status. Fine, but it is the only no-override control.
12. Orphan fixture `reference-pathway-with-gates.ts` is never exercised, so stage-attached gates, the multi-parent stage-3 (root + DP), and a single-branch one_of DP have **no traversal test on the reference pathway at all**.

## 6. Gaps worth a test in the interpreter design
- An override on a Gate and on a DecisionPoint (expect the chosen arm only, or rejection).
- depends_on on a node inside a closed/pending branch, in both visit orders, asserting the dependent gate's status.
- A diamond (reconvergence) where the arms disagree: the shared node's status must not depend on BFS order.
- A node reached both by a HAS_STAGE-like structural edge and a DP BRANCHES_TO (the reference-pathway stage-3 shape).
- Invariant property: no INCLUDED node without an INCLUDED/overridden path from root through open gates; UNKNOWN never collapses into INCLUDED.
- Stale comment: `v1-traversal-behavior.test.ts:28-29` says "without [skip] an unsatisfied gate is included anyway". This contradicts `eager-disposition-parity:166`, where an absent default fails closed.
