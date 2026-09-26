# E: Evidence corpus for interpreter worked examples and intended semantics

Code: `prism-graphql` @ `d377465`. The worktree `features/docs-evaluation-interpreter-design` has no `node_modules`, so everything was executed against the main checkout `/home/claude/workspace/prism-graphql`. That checkout is at the same commit `d377465` with a clean tree, and it has the compiled `dist/` that pm2 serves.
Docs: `features/docs-evaluation-pipeline-design/prism-graphql/docs/superpowers/`.

Companion files in the same scratch dir (full detail; this report condenses them):
- `E-tests.md`: per-file test catalog with line refs.
- `E-specs.md`: every decision, deferral and review finding with file:line.
- `graphs/*.json`: live graphs pulled via the `pathwayGraph` query.
- `analyze.js`, `tree.js`: structure dumps.
- `run.js` plus `s1`–`s6.js`: a scratch harness that runs the **deployed** `dist` TraversalEngine on the live graphs and on small synthetic graphs.

**Harness caveats:**
- Confidence is mocked to a uniform 0.9 unless stated. The real engine scores the whole graph, which moves action nodes across the 0.6 threshold.
- Policy is `v1` (the production default), and `pathwayDefaults={}`.
- The codeMap holds only `lab.hemoglobin` and `lab.ferritin`.
- All DB access was SELECT-only. No repo file was touched.

Tests executed read-only in the main checkout: traversal-engine, eager-reachability, eager-disposition-parity, pipeline-traversal-overrides, pipeline-properties, branch-mode, branch-routing(+validation), prerequisites, pipeline-sequence-vs-fresh, anemia-pathway-e2e, pipeline-acceptance-a1 and pipeline-depends-on-medication. Result: **13 suites / 121 tests, all PASS.** Several of them pin the defects listed below.

---

## 1. Live pathway catalog (`pathway_graph_index`)

| logical_id | version | status | is_active | index id | shape family |
|---|---|---|---|---|---|
| anemia-in-pregnancy-v1 | 1.0 | SUPERSEDED | f | 5966c0d5… | — |
| anemia-in-pregnancy-v1 | 1.1 | DRAFT | f | 100c5909… | A-legacy (`attribute`/`LT`/`IN "1,3"` conditions) |
| anemia-in-pregnancy-v1 | 1.2 | DRAFT | f | f7ee81f5… | A-legacy |
| anemia-in-pregnancy-v1 | 1.3 | DRAFT | f | bfe262e8… | A-legacy |
| **anemia-in-pregnancy-v1** | **1.4** | **ACTIVE** | **t** | **a1774566…** | **A (canonical `field`/`less_than`)** |
| anemia-in-pregnancy-v1 | 1.5 | DRAFT | f | 1af0c208… | A (structurally identical to 1.4) |
| anemia-in-pregnancy-v1 | 1.6 | DRAFT | f | b97bafeb… | A (identical) |
| anemia-in-pregnancy-v1 | 1.7 | DRAFT | f | 60843dab… | A (identical) |
| anemia-pregnancy-v1 | 1.0 | ARCHIVED | f | a9600763… | — |
| chronic-htn-pregnancy-v1 | 1.0 | DRAFT | f | 8d7fbfc6… | C (6 DPs, no gates) |
| gestational-hypertension-preeclampsia | 1 | DRAFT | f | 9ee949c9… | H (8 gates, REQUIRES, nested) |
| routine-prenatal-care-v1 / vaginal-discharge-pregnancy-v1 / vaginitis-in-pregnancy-v1 | 1.0 | ARCHIVED | f | — | not analysed |

- `temporal_defaults` is NULL for every row.
- Anemia 1.4–1.7 differ only in `pathway_version` (verified: the analyzer diff with the version stripped is 0 lines).
- 1.1–1.3 differ from 1.4 only in condition spelling (12 diff lines, all gate conditions). That is the "gate condition schema mismatch" family from MEMORY.
- Live sessions: `pathway_resolution_sessions` has 2 ACTIVE and 2 ABANDONED on 1.4, and 2 ACTIVE on each other anemia version. `llm_gate_evaluations` has 0 rows.

### 1a. Shape A: anemia-in-pregnancy-v1 1.4 (ACTIVE). 52 nodes / 99 edges, acyclic

Tree (CITES_EVIDENCE, HAS_CODE and HAS_QUALITY_METRIC omitted):
```
root ─HAS_STAGE→ stage-1 ─HAS_STEP→ step-1-1 (lab-1 CBC, sched-1), step-1-2 (lab-1)
     ─HAS_STAGE→ stage-2 ─HAS_STEP→ step-2-1 ─HAS_GATE→ gate-anemia-t1t3 ─BRANCHES_TO→ step-2-2
                                              ─HAS_GATE→ gate-anemia-t2   ─BRANCHES_TO→ step-2-2
                        ─HAS_STEP→ step-2-2 (lab-2..4) ─HAS_DECISION_POINT→ dp-1 [one_of]
                                     dp-1 ─HAS_CRITERION→ crit-1a, crit-1b   (NO SELECTS_BRANCH)
                                     dp-1 ─BRANCHES_TO→ step-2-3, step-3-1   (no `when`)
                                     dp-1 ─HAS_GATE→ gate-iron-deficient ─BRANCHES_TO→ step-3-1
                        ─HAS_STEP→ step-2-3 (lab-5, lab-6)
     ─HAS_STAGE→ stage-3 ─HAS_STEP→ step-3-1 ─USES_MEDICATION→ med-1 ─ESCALATES_TO→ med-2
                        ─HAS_STEP→ step-3-2 ─USES_MEDICATION→ med-2 (IV iron)
                        ─HAS_STEP→ step-3-3 ─HAS_PROCEDURE→ proc-1 (PRBC transfusion)
                        ─HAS_STEP→ step-3-4 (med-3 B12, med-4 folate)
                        ─HAS_GATE→ gate-severe-anemia ─BRANCHES_TO→ step-3-3
     ─HAS_STAGE→ stage-4 ─HAS_STEP→ step-4-1 ─HAS_GATE→ gate-oral-iron-response ─BRANCHES_TO→ step-4-3
                        ─HAS_STEP→ step-4-2 ("if inadequate response", ungated), step-4-3
```

**Gates:**

| id | type | condition | default |
|---|---|---|---|
| gate-anemia-t1t3 | compound AND | `patient.trimester in [1,3]` ∧ labs LOINC 718-7 `less_than` 11 | skip |
| gate-anemia-t2 | compound AND | `patient.trimester equals 2` ∧ 718-7 < 10.5 | skip |
| gate-iron-deficient | patient_attribute | 2276-4 < 30 | skip |
| gate-severe-anemia | patient_attribute | 718-7 < 7 | skip |
| gate-oral-iron-response | patient_attribute | 718-7 `delta_from_baseline` window_days 14, delta_threshold 1 | **traverse** |

**Multi-parent nodes (the key structural fact):**

| node | parents (edge type) |
|---|---|
| step-2-2 | stage-2 **HAS_STEP**; gate-anemia-t1t3 BRANCHES_TO; gate-anemia-t2 BRANCHES_TO |
| step-2-3 | stage-2 **HAS_STEP**; dp-1 BRANCHES_TO |
| step-3-1 | stage-3 **HAS_STEP**; dp-1 BRANCHES_TO; gate-iron-deficient BRANCHES_TO |
| step-3-3 | stage-3 **HAS_STEP**; gate-severe-anemia BRANCHES_TO |
| step-4-3 | stage-4 **HAS_STEP**; gate-oral-iron-response BRANCHES_TO |
| lab-1 | step-1-1, step-1-2 (HAS_LAB_TEST) |
| med-2 | step-3-2 USES_MEDICATION; med-1 **ESCALATES_TO** |

- Every gated or branched Step is also a stage member via HAS_STEP. That is the "stage-included gated step" shape.
- `step-3-1` is a three-way reconvergence: structural, DP arm, and gate.
- `dp-1` has two BRANCHES_TO arms, no `when`, no SELECTS_BRANCH, and criteria that are text only.
- There are no REQUIRES edges, no depends_on, no LLM gates and no question gates.

### 1b. Shape C: chronic-htn-pregnancy-v1 1.0 (DRAFT). 109 nodes / 113 edges, acyclic, **zero Gates**

- Six DPs, all `one_of`: dp-ecg, dp-secondary-htn, dp-acei-arb, dp-bp-threshold, dp-preeclampsia, dp-delivery. Each has 2–6 Criterion children and no SELECTS_BRANCH.
- **Four of the six DPs have no BRANCHES_TO at all.** They are criteria-only prose, which the validator only warns on (SE5, validator.ts:721-727).
- dp-acei-arb BRANCHES_TO step-3-2, a single arm that is also stage-3 HAS_STEP.
- dp-preeclampsia BRANCHES_TO **stage-6**, a single arm that is also root HAS_STAGE. This is a DP arm reconverging with a structural edge at Stage level; it matches the orphaned `reference-pathway-with-gates` stage-3 shape.
- ESCALATES_TO: med-labetalol→med-methyldopa and med-nifedipine→med-hydralazine.
- step-7-2 uses med-pp-enalapril (an ACE-I, postpartum), while crit-acei-yes says "IMMEDIATE discontinuation". This is a candidate for a safety/role worked example (unverified clinically).

### 1c. Shape H: gestational-hypertension-preeclampsia 1 (DRAFT). 106 nodes / 194 edges

**Gates:**

| id | type | detail | targets (BRANCHES_TO, **all `properties: null`**) |
|---|---|---|---|
| gate-aspirin-indicated | question BOOLEAN, **traverse** | long prompt | step-1-2 (baseline labs), step-1-3 (aspirin) |
| gate-bp-elevated | compound OR | 8480-6 > 139.9 **horizon 7d** ∨ 8462-4 > 89.9 **horizon 7d** | step-2-2 |
| gate-htn-confirmed | question BOOLEAN, skip | — | step-2-3, step-2-4 |
| gate-htn-diagnosed | compound OR | six `includes_code` ICD-10 O13.2/O13.3/O13.9/O14.0.*/O14.1.*/O14.9.*, **status active, horizon 300d** | **stage-3**, step-5-2, step-5-3 |
| gate-escalation-required | compound OR | SBP > 159.9 (1d) ∨ DBP > 109.9 (1d) ∨ platelets 777-3 < 100 ∨ creatinine 2160-0 > 1.1 ∨ O14.1.* active 300d | **stage-5** (escalation; med-6 role=`contraindicated`) |
| gate-severe-feature-symptoms | question BOOLEAN | — | step-3-2 |
| gate-no-severe-features | question BOOLEAN | — | **stage-4** |
| gate-gestational-htn | compound OR | O13.x active 300d | step-4-2 (HAS_GATE from stage-4) |

**Other structure:**
- Only stage-1 and stage-2 hang off root. Stages 3, 4 and 5 are reachable **only** through gate BRANCHES_TO.
- **Nested gates:** gate-bp-elevated → step-2-2 → gate-htn-confirmed → step-2-4 → gate-htn-diagnosed → stage-3 → step-3-1, which hosts three gates. That is 4 levels.
- **DP:** dp-1 `one_of`. crit-1a SELECTS_BRANCH step-2-3a and crit-1b SELECTS_BRANCH step-2-3b; dp-1 BRANCHES_TO both. This is the only live SELECTS_BRANCH usage.
- **REQUIRES (dependent → prerequisite):**

| dependent | prerequisite |
|---|---|
| step-1-3 | step-1-1 |
| step-2-2 | step-2-1 |
| step-2-4 | step-2-2 |
| step-3-1 | step-2-4 |
| step-4-1 | step-3-1 |
| step-5-2 | step-2-4 |

  Every REQUIRES target is a structural ancestor. The analyzer reports 6 "cycles", each closing through one REQUIRES back-edge. The REQUIRES subgraph itself is acyclic, as validator SE3b requires (validator.ts:699-707).
- **Multi-parent:** step-2-2 (gate BRANCHES_TO plus REQUIRES from step-2-4); step-2-4 (gate plus two REQUIRES); step-2-3a/b (dp BRANCHES_TO plus crit SELECTS_BRANCH); and lab-1..8, each shared by up to 3 steps.
- **Validity under today's rules:** three multi-target gates have no `when`. The validator requires `when` on every BRANCHES_TO when there is more than one target (validator.ts:273-299), so this DRAFT **would fail activation** (unverified by actually activating). At runtime the engine routes nothing (§4, H2).

No live pathway has `llm_text_analysis` gates, `prior_node_result` gates, depends_on, or `all_of`/`any_of` DPs. `E-specs` notes 4 depends_on entries existed only in an ARCHIVED pathway (EP:75).

---

## 2. Test corpus (condensed; full table in `E-tests.md`)

| area | files | what they pin |
|---|---|---|
| Traversal core | traversal-engine (325), anemia-pathway-e2e, temporal/v1-traversal-behavior, temporal/clock-pinning | BFS; closed gate → subtree GATED_OUT; unanswered question → PENDING_QUESTION; prior_node_result; DP red flag; horizon cascade |
| Gate evaluator | gate-evaluator{,-attribute,-codemap-threading,-compound-uncertainty,-scalar-kernel,-membership-kernel,-aggregate-kernel,-count-in-window,-trend,-version-seam} | Operator semantics; the compound 3-valued truth table; **membership fails OPEN on validity-UNKNOWN** (membership-kernel:297-300); prior_node_result on an absent node → unsatisfied, reason NOT_FOUND (gate-evaluator:314) |
| DP / routing | branch-mode (468), branch-routing (437), branch-routing-validation, decision-value, escalate-on-unresolved, indeterminate-surface, lattice-collapse | one_of pends at ≥2 qualifiers and auto-selects at 1; stored choice survives; stale choice re-pends; all_of mandates plus red flag; `when` routing incl. BOOLEAN false arm; unroutable → no arm plus flag; LLM tentative → safe default plus question; on_unresolved ask/default |
| Eager / deps | eager-reachability (113), eager-disposition-parity, prerequisites, pipeline-depends-on-medication, reachability (static scorer only) | Eager disposition equals walk disposition; REQUIRES catch-up is satisfied from the **snapshot only**, never from resolution state |
| Overrides | pipeline-traversal-overrides (58) | INCLUDE on a below-threshold med; **held Step under a closing gate stays INCLUDED while its child is GATED_OUT** (:44-48) |
| LLM | pipeline-observations, pipeline-acceptance-a1 | Observation key excludes threshold; **UNAVAILABLE → gate INCLUDED via safe default plus tentative question plus PENDING_GATE blocker** (a1:36-41) |
| Properties / MUT-SEQ | pipeline-properties, pipeline-sequence-vs-fresh, pipeline-run-sequence-vs-fresh | Hash determinism; Map-insertion-order independence; sequence == fresh; **#9 reconvergence PINNED DEFECT** (seq-vs-fresh:223-243); **#10 vital answer key PINNED DEFECT** (:247) |
| Composition | pipeline-compose, pipeline-run-{mutations,commit,generation}, acceptance-a2, pipeline-safety | Conflict select → root patient safety for write-ins → pair safety over final set; `contraindicated` role node stays INCLUDED (compose:284) |
| Postgres | pipeline-postgres (opt-in, `RUN_PIPELINE_PG_TESTS=1`) | Migrations 067/068, revision locks; no interpreter semantics |

**Fixtures:**
- `anemia-pathway-canonical.ts` is **not** the live shape. It hangs all 5 gates off one step via HAS_CHILD/HAS_GATE, each gate BRANCHES_TO a distinct action, with no HAS_STEP to gated steps, no DP, no multi-parent nodes and no `when`. So the e2e test cannot see the stage-inclusion defect.
- `reference-pathway-with-gates.ts` is **imported by no test**. It is the only fixture with a stage-attached gate, a DP arm reconverging with root HAS_STAGE (stage-3), a single-arm one_of DP, and med-1 ESCALATES_TO med-2.
- `pipeline-env.ts` defaults `edge()` to `HAS_CHILD`. Most pipeline fixtures therefore exercise gates through the generic "enqueue all outgoing edges" path.

**Tests pinning behaviour now believed defective:**

| # | assertion | ref |
|---|---|---|
| T1 | Reconvergence first-writer-wins: `shared` EXCLUDED although selected arm `a` reaches it | pipeline-sequence-vs-fresh.test.ts:242-243 (labelled PINNED DEFECT) |
| T2 | INCLUDE override on Step under a closed gate stays INCLUDED; child GATED_OUT | pipeline-traversal-overrides.test.ts:44-48 |
| T3 | Tentative/unavailable LLM gate INCLUDED and safe-default arm INCLUDED while unresolved | pipeline-acceptance-a1.test.ts:39; branch-routing.test.ts:369 |
| T4 | Unknown ≡ false on legacy-v0 / `on_unresolved:'default'` | anemia-pathway-e2e:136-137, 180-181; indeterminate-surface:169,186; v1-traversal-behavior:90-91 |
| T5 | Membership fails open on unknown validity | gate-evaluator-membership-kernel:297-300; temporal/state-mapping |
| T6 | `role:'contraindicated'` Medication INCLUDED | pipeline-compose.test.ts:284 |
| T7 | Prereq satisfaction from any snapshot bucket; recursion stops at first satisfied | prerequisites.test.ts:78-91,127-146 |

**Scenarios exercised without asserting the key status:**
- eager-reachability:108-112 asserts only `toBeDefined()` on gate-dep. That is exactly where defect F5 below shows.
- The `not.toBe(INCLUDED)` pattern cannot distinguish EXCLUDED, GATED_OUT, PENDING and absent: branch-mode:106-109,224; branch-routing:108-109,184-185,228-229,268,276,360,370,415-416,424; seq-vs-fresh:186.
- escalate-on-unresolved:165-178 (aggregate unknown) asserts only the question count.
- pipeline-properties and both sequence-vs-fresh suites compare hashes only, and vary only Map insertion order. They never vary edge or visit order and assert no semantic invariant.
- pipeline-compose:80-86 never asserts that the med under a pending gate is absent from mergedPlan.
- **No test at all covers:**
  - an override on a Gate or DP;
  - a node reachable via both HAS_STEP/HAS_STAGE and BRANCHES_TO;
  - ESCALATES_TO traversal;
  - REQUIRES edges during traversal.

---

## 3. Intended semantics, deferrals, recorded findings (condensed; quotes and refs in `E-specs.md`)

**Top-level contract (EP):**
- INV: "the same inputs, environment and recorded observations produce the same plan, however they were arrived at" (EP:40-41).
- C1: pure `evaluate`; LLM verdicts are observations, and "`UNAVAILABLE` is never evaluated as a clinical false" (EP:87-128).
- C2: eligibility vs disposition; "Traversal writes only `eligibility` … Nothing after traversal feeds back" (EP:149-151); prior_node_result reads eligibility (EP:152).
- C3: ROOT vs CONTRIBUTION scope; pair safety root-only after conflict selection (EP:184).
- C4: one snapshot per mutation.

**Rules and decisions:**
- **R3 overrides:** "An override sets that node's `eligibility` … and a gate's sweep still descends *through* it" (EP:253-255). DS03 #2: "respect the override on its own node, but cascade through it" (DS03:34).
- D1–D14 (EP:65-78). Key ones:
  - D3: readiness blocks on every open question, tentative LLM included.
  - D4: safety outranks overrides.
  - D11: dependencies read eligibility; no depends_on→Medication.
  - D14: fail closed on unnormalisable meds.

**Decision semantics (DS):**
- W1: `indeterminate`/`dataUnavailable` are reason channels, "Deliberately not a new `NodeStatus`" (DS:121-124). Zero candidates = NO_MATCH, a definite answer (DS:84-86).
- W2: `on_unresolved` defaults to `'ask'`, and "A definite `false` never escalates" (DS:164-178). Answers become facts, deduped per datum.
- W3: one_of with ≥2 qualifiers pends and "traverse[s] none until answered" (DS:225-229). all_of red-flags weak branches rather than excluding them. SELECTS_BRANCH is display/lineage only (DS05 #5, narrowing DS:233-234).
- W4/DS06: `when` on BRANCHES_TO, which "must be **total**" (DS:254-278); "One routing mechanism for every gate type", including LLM `chosenBranch` (DS06:49-58). A tentative LLM verdict routes safe-default AND raises a question (DS06:266).

**Temporal (TH, TH04):**
- The clock is pinned once (TH:110-111).
- Three-valued overlap (TH:205-220).
- Operator-class UNKNOWN policy: membership include (fail-open), scalar exclude, aggregate exclude (TH:229-233).
- Scalar = latest valid dated in-window (TH:329).
- D1–D10 (TH04:88-284). For example: D7 undated + any other fact → AMBIGUOUS_LATEST fail-closed; D8 aggregates select on START bound.
- Normative compound indeterminate truth table (TH04:1252-1264).

**Original design (RD, largely superseded):**
- "Structural nodes pass through -- Stages and Steps are organizational; always traversed" (RD:88).
- Lazy evaluation of depends_on with memoization (RD:89).
- A cycle yields `unknown` plus default_behavior (RD:410-418).
- Generation maps "**Only included nodes**" (RD:353-356).

**Explicitly deferred:**

| item | ref |
|---|---|
| #9 reconverging branches: "First-writer-wins stays, now deterministic; pinned by a documented defect test" | EP:773-774 |
| #10 vital answer key | EP:775 |
| EMPTY_PLAN definition | EP:411,776 |
| Override acknowledging safety | EP:68,778 |
| Red-flag acknowledgement never set | EP:779-780 |
| Bare-string depends_on | EP:781-784 |
| F4 re-ask stale answers | EP:762-769 |
| Unified Decision node / `resolve_from` | DS:321 |
| Removing legacy-v0 | DS:322 |
| Aggregate escalation | DS04:31 |
| SELECTS_BRANCH criterion evaluation | DS05:43 |
| LLM branch `target` | DS06:346 |
| Reachability as plan 07 (advisory, never binding) | TH:630-633; TH00:217 |
| Temporal non-goals | TH:74-82, 865-868 |

**Recorded review findings still open:**
- #9 and #10 (pinned).
- R12-3: `tentative` vs `indeterminate` unnamed (TH04:262).
- **R12-4: satisfied ∧ indeterminate has no truth-table row** (TH04:264).
- Accepted trade-off: "Saved answers and overrides re-apply when their gate becomes reachable again, without re-asking" (EP:745).
- The release record claims "Every changed line is in an expected class; no defect" (records/…-05/before-after.md:5), yet the same `after.txt` shows gate-severe-anemia GATED_OUT (after.txt:18) with proc-1 transfusion INCLUDED (:29) and step-3-3 INCLUDED (:48). That line was unchanged between before and after, so the before/after diff could not surface it.

**What the docs never state (gaps):**
- Whether a Step reached by HAS_STEP *and* by a gate or DP BRANCHES_TO is gated.
- What an override on a Gate or DP does to its arms. EP02:1263-1276 implements "enqueue every outgoing edge", and no doc addresses its interaction with `when` or one_of.
- The result of depends_on on a never-reached node under the pipeline.
- **ESCALATES_TO does not appear in any doc.**
- REQUIRES edges are enqueued as traversal children.

---

## 4. Findings from running the engine (what the current interpreter outputs)

Engine facts (traversal-engine.ts @ d377465):
- **BFS, memoised, first-writer-wins** (:541).
- Structural, action and "other" nodes enqueue **every** outgoing edge regardless of type (:1214-1218, :1266-1270, :1286-1290). That includes HAS_STEP, BRANCHES_TO targets reached structurally, **ESCALATES_TO, REQUIRES (backwards, dependent→prereq)** and CITES_EVIDENCE.
- A closing gate's `markSubtree` skips any node already in the state (:246).
- Overrides are pre-seeded at depth 0 and, on arrival, enqueue every outgoing edge (:469-483, :527-536).
- `evaluateNodeEagerly` disposes a depends_on target with a throwaway queue and marks it provisional (:1322-1343).

| # | finding | evidence (scenario → output) |
|---|---|---|
| **F1** | **Stage-included gated steps: a closed gate does not close a Step that is also a stage member.** BFS reaches step-X at depth 2 via HAS_STEP before its gate (depth 3) sweeps it. | s1, anemia 1.4, non-anemic T2 (Hb 12.5, ferritin 80): all three anemia gates GATED_OUT, yet step-2-2, step-3-1, step-3-3, step-4-3 INCLUDED; **med-1 (oral iron), med-2 (IV iron), proc-1 (transfusion) INCLUDED**; dp-1 PENDING asking the provider to choose an etiology. **Live:** session `4e4c95eb…` has gate-severe-anemia GATED_OUT with proc-1 INCLUDED; `d61024eb…` has it PENDING_QUESTION with proc-1 INCLUDED. Record after.txt:18/29. |
| **F2** | **A DP choice does not exclude a structurally reachable arm.** The one_of choice narrows only `includedBranches`; exclusion is skipped for already-present nodes (`enqueueable` false). | A4: dp-1 answered `step-2-3` (alternative etiology) → step-3-1 (oral iron) still INCLUDED. Live sessions `d61024eb…`/`4e4c95eb…` have `gate_answers {"dp-1":{"selectedOption":"step-2-3"}}` with step-3-1 INCLUDED. A10 (conf 0.3): dp-1 `all_branches_excluded` red flag, but both arms stay INCLUDED. |
| **F3** | **Pending DP silently drops non-branch children.** When one_of pends, the method returns before enqueuing HAS_GATE/HAS_CRITERION children, so gate-iron-deficient and crit-1a/1b are **absent** from the state. This contradicts the plan-03 "node set complete" invariant cited in the code comment (:1085-1087). | s1/A2/A3: no gate-iron-deficient row while dp-1 is PENDING. |
| **F4** | **Override opens all arms, and EXCLUDE on a gate does not close it.** | H7: INCLUDE on gate-htn-confirmed → both step-2-3 and step-2-4 INCLUDED. L2 (synthetic LLM gate with total `when`, LLM chose `routine` at 0.95) + INCLUDE override → step-urgent, step-routine **and med-a** all INCLUDED. A11: INCLUDE on dp-1 → no pend, both arms plus gate-iron-deficient. **H8: EXCLUDE on gate-bp-elevated → gate EXCLUDED but step-2-2 INCLUDED** and the nested question still asked. |
| **F5** | **depends_on resolution is visit-order dependent (eager claims reachability).** | s5 `dep-order`: gate-dep evaluated before gate-closed. step-hidden is eagerly disposed INCLUDED, so gate-dep INCLUDED → step-after, med-x INCLUDED. gate-closed then sweeps step-hidden to GATED_OUT. **Final state: dependency GATED_OUT, dependent gate and med INCLUDED.** Same graph with the stages in the other order (s4) → gate-dep GATED_OUT, "Unmet dependencies: step-hidden expected INCLUDED, got GATED_OUT". Test eager-reachability:108-112 asserts only `toBeDefined`. |
| **F6** | **depends_on on an unreachable node counts as satisfied.** | s4 `dep-orphan`: step-orphan has no incoming edge. Eager disposition marks it INCLUDED (parent=step-b, **left in the final state**), and gate-dep INCLUDED. By contrast, the pure evaluator on an absent node → unsatisfied NOT_FOUND (gate-evaluator.test:314). |
| **F7** | **Reconvergence status depends on BFS dequeue order, not on "any open path" or "all paths".** | s5 `reconv`/`reconv2`: step-r reachable via a closed gate and via an open structural path. When the gate is dequeued first, step-r and med-r are GATED_OUT; in anemia (F1) the structural path wins. A8: dp-1 chose step-3-1 while gate-iron-deficient GATED_OUT (ferritin 80) → step-3-1 INCLUDED. Pinned as defect #9 (seq-vs-fresh:242). |
| **F8** | **ESCALATES_TO auto-includes second-line drugs.** | C1: chronic HTN, empty patient → med-methyldopa INCLUDED (parent=med-labetalol) and med-hydralazine INCLUDED (parent=med-nifedipine). Synthetic `esc`: med-2 INCLUDED under med-1. Anemia med-2 is reached the same way. No doc or test covers it. |
| **F9** | **Multi-target gates without `when` route nothing (GHTN is dead past its first question).** | H2b: aspirin=true and htn-confirmed=true → both arms of each EXCLUDED "Not selected by the answer", `unroutable_decision` red flags, and the whole of stages 3–5 EXCLUDED. H4: also giving an O13.9 dx changes nothing. H2c: aspirin=false → same. |
| **F10** | **Answer shape pitfalls.** A malformed answer (`{value:true}`) on a question gate → "Question answer has no value". On a `traverse` gate that opens every arm; on a `skip` gate it GATED_OUTs the subtree. | H2 (first attempt). GateAnswer is `{booleanValue|numericValue|selectedOption}` (types.ts:269-273). |
| **F11** | **A tentative LLM verdict (no evaluator, failed, or conf < threshold) routes the safe default and INCLUDEs that arm's subtree**, plus a pending question. This matches DS06:266 and D3, but a care-plan consumer sees INCLUDED. | s4 LLM: no evaluator, failed, or 0.5 → step-routine INCLUDED, step-urgent+med-a EXCLUDED, PENDING gate-llm. 0.9 → step-urgent+med-a INCLUDED. |
| **F12** | **Temporal horizon works as "missing", and v1 escalates.** | A7: Hb 6 dated 400 days ago → gate-severe-anemia PENDING_QUESTION "No numeric value found" (but proc-1 stays INCLUDED per F1). H3: BP 150/95 10 days old with a 7d horizon → gate-bp-elevated PENDING (asks for LOINC 8480-6); the whole nested chain is swept PENDING (H1 shows 30+ PENDING nodes under one datum). |
| **F13** | **Missing facts:** v1 `ask` escalates scalars, but compound gates with `patient.*` + labs went **GATED_OUT**, not PENDING. The reason reads "attribute has no value; No numeric value found". | A3 (no labs, no trimester): gate-anemia-t1t3/t2 GATED_OUT while gate-severe-anemia (pure scalar) is PENDING. Recorded in after.txt:70-73. This looks inconsistent with W2 "escalate on dataUnavailable" for compounds (escalate-on-unresolved:240-273 covers compounds). Unverified whether a trimester datum ask is intended to be suppressed. |
| **F14** | **INCLUDE override on a node under a closed ancestor gives an INCLUDED node with GATED_OUT children and parent=''** (the walk never arrived). | H5 (gate-htn-confirmed under closed gate-bp-elevated), H6 (step-2-4). A9: EXCLUDE on step-3-1 leaves med-1 INCLUDED beneath it (the override is about that node only, per R3). |

---

## 5. Candidate worked-example scenarios

| scenario | best source | current engine output | intended (from docs) |
|---|---|---|---|
| **Dependency on an unreached node** | Synthetic `dep-orphan` (s4) and `dep-order` (s5); test eager-reachability.test.ts (graph gate-dep → step-hidden behind gate-closed; status of gate-dep unasserted :108-112); fixture reference-pathway-with-gates `gate-med-monitoring depends_on step-3-1` (orphaned). No live pathway has depends_on; live REQUIRES in GHTN (step-3-1 REQUIRES step-2-4). | Orphan dep → INCLUDED, and the provisional node is left INCLUDED. Order-dependent: dep gate first → dependent INCLUDED while dependency is finally GATED_OUT (F5/F6). REQUIRES: traversal enqueues prereqs as children; catch-up ignores reachability (prerequisites.test:78-146). | C2/D11: prior_node_result reads eligibility. Behaviour for never-reached targets is unspecified. RD:89 had lazy evaluation. INV requires path-independence, which F5 violates. |
| **Closed ancestor with an override** | pipeline-traversal-overrides.test.ts:37-48 (held Step under closing q); live GHTN H5/H6/H8; anemia A9. | Overridden node keeps its status with parent=''. Its children are swept GATED_OUT (INCLUDE override) or stay INCLUDED (EXCLUDE override on a gate, H8; EXCLUDE on step, A9). | R3/DS03#2: override is about that node, the sweep descends through it. D4: safety outranks. The docs don't define what a gate EXCLUDE override means for its arms. |
| **Override on a multi-arm gate / one_of DP** | Live GHTN gate-htn-confirmed (H7), anemia dp-1 (A11), synthetic LLM (L2). No test. | Opens **all** arms, bypassing `when`/one_of/LLM choice (F4). | DS06 "One routing mechanism for every gate type"; W3 one_of never multi-arm. Contradiction not addressed in the docs. |
| **Reconverging branch** | Live anemia step-3-1 (stage-3 HAS_STEP + dp-1 arm + gate-iron-deficient arm), step-2-2 (two gates + HAS_STEP); chronic-htn stage-6 (root + dp-preeclampsia); GHTN step-2-3a (DP arm + SELECTS_BRANCH). Test seq-vs-fresh #9 (:223-243, pinned defect). Synthetic `reconv`. | First-writer-wins by BFS dequeue order (F7). Live anemia: the structural path wins, so everything is INCLUDED (F1/F2). | EP:773-774: first-writer-wins stays, "deterministic"; correctness deferred. RD:88: structural nodes "always traversed". |
| **Conflict choice followed by safety** | pipeline-compose.test.ts (CONFIRM/ACCEPT_BOTH/REJECT, write-ins safety-checked, allergy persists, `contraindicated` role :284); pipeline-run-mutations `resolveConflict`; acceptance-a2 (allergy withholds, eligibility stays INCLUDED). Live candidate: chronic-htn med-pp-enalapril vs crit-acei-yes; GHTN med-6 role `contraindicated` under stage-5. | compose.ts:119-130: select conflicts → root patient safety on write-ins → pair safety on the final set. Losers `withheldBy:'conflict'`, the contraindicated node stays INCLUDED (not run here; test-pinned). Live DDI/allergy tables are empty (before-after.md), so live examples produce no findings. | EP:367-384, C3 (pair safety root-only, after selection), D4, D14. |
| **Nested gates** | Live GHTN chain gate-bp-elevated → gate-htn-confirmed → gate-htn-diagnosed → gate-escalation-required / gate-no-severe-features → gate-gestational-htn. Test seq-vs-fresh #1 (:160, nested can't reopen under a closed ancestor). | H1: one missing BP datum sweeps 30+ nested nodes PENDING. H2b: F9 unroutable kills the chain. H4: diagnosis facts downstream are irrelevant. | Review #1 "Must pass" (EP:575). |
| **Multi-branch decision** | Live anemia dp-1 (2 arms, no `when`, criteria text-only); GHTN dp-1 (SELECTS_BRANCH); chronic-htn DPs with no arms. Tests branch-mode (one_of/all_of/any_of), branch-routing (`when`). | one_of with 2 qualifiers → PENDING SELECT (correct per W3), but arms already INCLUDED structurally (F1/F2) and HAS_GATE child dropped (F3). The choice does not exclude the other arm. | W3 / DS05 rule table (DS05:67-73): 2+ → pend, "exclude nothing, traverse nothing"; choice closes unchosen arms (branch-mode:158). |
| **Missing facts** | Live anemia A3; the after.txt noHaemoglobin patient (:70-113); tests escalate-on-unresolved, indeterminate-surface, anemia-e2e:136 (legacy). | Scalar → PENDING_QUESTION with datumKey. Compound with a missing `patient.*` → GATED_OUT (F13). Membership fails open. Subtree stage-included nodes stay INCLUDED (F1). | W1/W2 (ask by default; dataUnavailable is scalar-only), TH:229-233 class policy, GC:222. |
| **Temporal condition** | Live GHTN gate-bp-elevated (7d), gate-escalation-required (1d BP, 300d dx), gate-htn-diagnosed (status active, 300d); anemia gate-oral-iron-response (`delta_from_baseline` window 14). Tests: v1-traversal-behavior, clock-pinning, the scalar/aggregate kernels. | H3: a 10-day-old BP → treated as absent → PENDING ask. A7: a 400-day-old Hb → PENDING. gate-oral-iron-response has no baseline series → INCLUDED via `traverse` default (s1). | TH D1–D10; scalar = latest valid in-window (TH:329); pinned clock (TH:110). |
| **LLM gate** | No live LLM gates; synthetic `syn-llm` (s4/s6); tests branch-routing:354-374, acceptance-a1:36-41, pipeline-observations. | Covered in F11; with an override, see F4. | C1/D2/D3/D10; DS06:266. R12-3 (tentative vs indeterminate) open. |
| **Escalation (ESCALATES_TO)** | Live anemia med-1→med-2; chronic-htn labetalol→methyldopa, nifedipine→hydralazine; orphan fixture med-1→med-2. | Second-line INCLUDED whenever first-line is reached (F8). | **Undocumented.** |

---

## 6. Five findings to carry into the spec

1. **The ACTIVE live pathway recommends treatment regardless of its gates (F1/F2).** Every gated or branched Step in anemia 1.4 is also a stage member, and BFS first-writer-wins lets the structural HAS_STEP path win. Transfusion (proc-1) and the oral-iron step are INCLUDED for non-anemic patients and against the provider's dp-1 choice. This is visible in two live ACTIVE sessions and in the release record's after.txt:18/29, which the record calls "no defect". No test uses this shape: the canonical anemia fixture omits HAS_STEP to gated steps.
2. **Overrides are all-arms and asymmetric (F4/F14).** An INCLUDE on a gate or DP opens every arm, bypassing `when`, one_of and the LLM choice. An EXCLUDE on a gate leaves its subtree open. No test covers either. The docs say only "cascade through".
3. **Dependency semantics are visit-order dependent (F5/F6).** Eager disposition treats an unreached or guarded dependency as reached. The final state can show the dependency GATED_OUT with its dependent INCLUDED, which violates INV path-independence. The corresponding test asserts only `toBeDefined`, and the property tests never vary edge order.
4. **Edge types are not distinguished during the walk.** REQUIRES (backwards), ESCALATES_TO (second-line auto-included, F8) and CITES_EVIDENCE are all "enqueue children". Reconvergence is first-writer-wins (explicitly deferred as #9). The spec needs an edge-kind table: structural vs guarded vs dependency vs escalation.
5. **The DRAFT GHTN pathway is the richest example corpus but is un-routable today (F9).** It has nested gates, horizons, a question chain, SELECTS_BRANCH and REQUIRES, but its multi-target gates have no `when`, so every answer excludes all arms. Chronic-HTN has four arm-less DPs. Worked examples built on live data need either a corrected copy (unverified: would it pass validation) or synthetic graphs like those in `graphs/syn-*.json`.
