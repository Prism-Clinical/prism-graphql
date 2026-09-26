# E — Interpreter semantics from the design docs (specs / plans / records)

Root: `/home/claude/workspace/features/docs-evaluation-pipeline-design/prism-graphql/docs/superpowers/`
Abbrev: **DS** = `specs/2026-08-30-decision-semantics-design.md`; **EP** = `specs/2026-09-13-evaluation-pipeline-design.md`; **TH** = `specs/2026-07-21-pathway-temporal-horizon-design.md`; **GC** = `specs/2026-07-11-gate-condition-field-attribute-model-design.md`; **RD** = `specs/2026-03-25-pathway-resolution-design.md`; **TH04** = `plans/2026-07-26-temporal-horizon-04-evaluator-kernel.md`; **TH00** = `plans/2026-07-26-temporal-horizon-00-overview.md`; **DS0n** = `plans/2026-08-3x-decision-semantics-0n-*.md`; **EP0n** = `plans/2026-09-1x/22-evaluation-pipeline-0n-*.md`; **GSR** = `plans/2026-08-12-gate-subtree-retraversal.md`; **RSG** = `plans/2026-08-12-resolution-subsystem-gaps.md`; **REC** = `records/evaluation-pipeline-05/`.

Precedence note: EP says "Everything in §1–§4 is an implementation of these four contracts … the contract wins" (EP:84-85). EP supersedes RD's incremental retraversal (RD §4) and multi-branch DecisionPoint semantics (RD:74,86) are superseded by DS W3.

---

## 1. Intended semantics & guarantees (numbered decisions)

### 1a. Evaluation pipeline — invariant, contracts C1–C4

| id | paraphrase | quote | ref |
|---|---|---|---|
| INV | Plan is a pure function of inputs/env/observations, path-independent | "the same inputs, environment and recorded observations produce the same plan, however they were arrived at." | EP:40-41 |
| C1 | `evaluate(inputs, env, observations)` does no I/O; LLM verdicts are observations keyed by semantic request; UNAVAILABLE → tentative safe default, never clinical false | "`evaluate` performs no I/O of its own." / "`UNAVAILABLE` is never evaluated as a clinical false." | EP:87-128 (93,111) |
| C1-key | Observation key = sha256(gateId, prompt, branches, inputAttribute, narrative, model); threshold excluded | "`confidence_threshold` is **not** part of the key; it is applied to the verdict after acquisition." | EP:98-103 |
| C1-guar | Replay determinism incl. hash | "frozen `inputs` + `env` + observations (`replay`) → identical `EvaluationResult`, including `resultHash`." | EP:127-128 |
| C2 | Two layers per node: eligibility (traversal/override) vs disposition (safety/conflict); nothing after traversal feeds back | "Traversal writes only `eligibility`. … Nothing after traversal feeds back into traversal." | EP:130-163 (149-151) |
| C2-dep | `prior_node_result` reads eligibility; `depends_on` may not target Medication | "`prior_node_result` gates read `eligibility.status`." | EP:152-159 |
| C2-read | Findings from eligibility; EMPTY_PLAN & materialized plan from disposition | "`EMPTY_PLAN` and the materialized plan derive from disposition." | EP:160-163 |
| C3 | ROOT vs CONTRIBUTION scope; completeness blockers propagate, output blockers root-only; pair safety root-only after conflict selection | "Set \| Candidate pairs \| **Root only**, over the final candidate set, after conflict selection" | EP:165-187 (184) |
| C4 | One REPEATABLE READ snapshot per mutation; envFingerprint; every run mutation re-evaluates every child | "No cached child result is ever combined with a result from a different snapshot." | EP:189-206 |

§1 rules (EP:245-290): R2 no incremental path (`resolveIncrementally`, `promote`, `DependencyMap` deleted) EP:248-252; **R3 overrides** "An override sets that node's `eligibility` (`decidedBy: 'override'`), and a gate's sweep still descends *through* it." EP:253-255; R5 10s timeout → DEGRADED + `INCOMPLETE_RESOLUTION` EP:257-259; R6 `SESSION_GRAPH_CHANGED` EP:260-262; R8 resultHash contents/exclusions EP:264-290.

§2 stages (EP:308-319): 1 context; 2 **whole-graph** scores (propagation now runs; "confidences and auto-included actions will change" EP:324-330); 3 traverse→eligibility, overrides pre-seed `held`, held-arrival moved into main loop EP:312; 4 findings, catch-up for every eligible Stage/Step EP:313; 5 patient safety→disposition incl. overridden meds EP:314; 6 set safety ROOT only EP:315; 7 readiness EP:316. Child runs 1–5,7; `composeRun` does 6 + root 7 (EP:318-319).

### 1b. Evaluation pipeline D1–D14 (EP:63-78)

| id | paraphrase | quote | ref |
|---|---|---|---|
| D1 | Recompute from recorded inputs (no incremental, no event sourcing) | "**Recompute from recorded inputs.** Not incremental plus an equivalence test, and not event sourcing." | EP:65 |
| D2 | LLM verdicts recorded as observations and reused | "**LLM verdicts are recorded as observations and reused**, keyed by the semantic request (C1)" | EP:66 |
| D3 | Readiness blocks on every open pending question incl. tentative LLM | "**Readiness blocks on every open pending question, tentative LLM verdicts included**" | EP:67 |
| D4 | Safety outranks overrides | "**Safety outranks provider overrides** (today's behaviour, now explicit)" | EP:68 |
| D5 | Parent owns patient facts in multi-pathway run; answers/overrides stay on child | "Gate answers, decision-point choices and overrides stay on the child, because they name pathway-local nodes." | EP:69 |
| D6 | One lock per run (parent revision) | "**A multi-pathway run has one lock: the parent's `revision`**" | EP:70 |
| D7 | Generation requires `reviewedResultHash` | "returns `PLAN_CHANGED_SINCE_REVIEW` on mismatch" | EP:71 |
| D8 | Purge all sessions | "**Purge all resolution sessions** in the migration" | EP:72 |
| D9 | 3 server retries then CONFLICT; observations reused across retries | "**Three server-side retries** on revision conflict, then `CONFLICT`." | EP:73 |
| D10 | Observations cross explicit provider boundary; key includes model | "**External observations cross an explicit provider boundary** in a single evaluation pass." | EP:74 |
| D11 | Eligibility vs disposition; deps read eligibility; no `depends_on`→Medication | "Graph dependencies read eligibility only. Import rejects `depends_on` targets of type Medication." | EP:75 |
| D12 | Blockers & safety scoped; resolved empty child doesn't block | "A resolved child with nothing to add must not block a useful combined plan." | EP:76 |
| D13 | One env snapshot per mutation; re-evaluate every child | "**Every mutation on a run re-evaluates every child under it.**" | EP:77 |
| D14 | Fail closed on unnormalisable meds (`SAFETY_DATA_UNAVAILABLE`); eval never calls RxNav | "**Fail closed on medications that cannot be normalised**" | EP:78 |

Plan-level decisions (selected, interpreter-relevant): P3-6 `nodesRecomputed` = evaluated count (EP03:78); **P3-8 "`PENDING_GATE` is raised for Gate and DecisionPoint nodes only"** (EP03:80); P4-2 root dispositions written onto children's cached nodes (EP04:79); **P4-3 composeRun identity pathway-qualified `pathwayId|nodeId`** so review #5 passes (EP04:80); **P4-4 composeRun projects children in nodeId order** because merge "keep[s] first-seen entries" (EP04:81); P4-8 EMPTY_PLAN keeps meds/labs/procedures definition (EP04:85); P4-15 patient-med SAFETY_DATA_UNAVAILABLE reported per contribution (EP04:92); P5-9 extra property sequences with conflict decisions (EP05:115).

### 1c. Decision semantics (DS) — workstreams W0–W4 + plan decisions

| id | paraphrase | quote | ref |
|---|---|---|---|
| W0 | Default evaluator `v1`; legacy-v0 kept as fixture | "`DEFAULT_TEMPORAL_POLICY_VERSION = 'v1'`." | DS:56, non-goal DS:69-70 |
| W1 | Two reason signals: `indeterminate` (can't order/trust candidates) and `dataUnavailable` (scalar had no value) | "**Zero candidate facts returns `NO_MATCH`, a definite decision**" / "`dataUnavailable` is **scalar-only**, and that restriction is the clinical point." | DS:81-104 |
| W1-nostatus | Reason channel, not a NodeStatus | "**Deliberately not a new `NodeStatus`.**" | DS:121-124 |
| W1-compound | Normative truth table; report indeterminate only if it could change answer | "`indeterminate` is reported only when uncertainty could have changed the answer." | DS:126-127 |
| W1b | Retraversal fidelity: unify engines (defects 1–3) | "Fixed by unifying the two engines rather than patching the second" | DS:131-155 |
| W2 | `on_unresolved: 'ask'\|'default'`, default `'ask'`; ask → PENDING_QUESTION on gate and subtree | "**defaulting to `'ask'`**" | DS:164-169 |
| W2-key | Escalate on indeterminate OR dataUnavailable; definite false never escalates | "A definite `false` never escalates" | DS:171-178 |
| W2-fact | Answers injected as synthetic facts, not verdicts; distinguishable in audit | "**Answers become facts, not verdicts.**" | DS:186-202 |
| W2-dedup | One pending question per datum (system+code / dotted path), across operators | "keyed on the datum rather than the gate" | DS:204-209 |
| W2-path | One answer mutation for all pending kinds | "There is one answer path, not one per pending kind." | DS:211-213 |
| W3 one_of | ≥2 qualifiers pend, traverse none; no auto-pick | "**More than one qualifier pends for provider choice**" … "traverse none until answered" | DS:225-229 |
| W3 all_of/any_of | all_of takes every branch (below-threshold = red flag); any_of = old behaviour | "a branch below threshold is a red flag, not an exclusion." | DS:230-232 |
| W3 SELECTS_BRANCH | Criterion routing beats confidence under one_of | "criterion routing takes precedence over raw confidence ranking." | DS:233-234 |
| W3 absent mode | Import error after backfill (no HAS_CRITERION → all_of, else one_of) | "**Absent `branch_mode` becomes an import validation error**" | DS:235-238 |
| W4 | Per-branch routing via `when` on BRANCHES_TO; mapping must be total | "it must be **total**: every possible answer maps to exactly one branch" | DS:254-278 |

DS plan decisions: DS03 #1 mirror direction in scope; **#2 "respect the override on its own node, but cascade through it"**; #3 measure then bound cascade; #6 one implementation (DS03:31-38). DS04: aggregates not escalatable ("There is no honest single answer to inject as a fact") DS04:31; #2 escalated answer must NOT land in `gateAnswers` DS04:39; membership never indeterminate ("`selectFacts` fails OPEN for this class") DS04:26. DS05: #1 one_of pends; #4 branch chosen by node id in `selectedOption`; **#5 "`SELECTS_BRANCH` is consumed for exclusion lineage and display only. No criterion evaluation"** (DS05:39-43; note this narrows DS:233-234). DS05 rule table: 0 qualifiers → `all_branches_excluded` red flag; 1 → auto-select; 2+ → pend, "exclude nothing, traverse nothing" (DS05:67-73); all_of red-flag type `all_of_branch_unsupported` (DS05:186-220). DS06: `when` is edge property; required only for >1 targets; total; **#4 "One routing mechanism for every gate type"** incl. LLM `chosenBranch`; never infer mapping from array order (DS06:49-58); validation table (DS06:90-96); tentative LLM routes safe-default AND raises question (DS06:266).

### 1d. Temporal horizon — spec + plan-04 D1–D10

Spec-level: pinned `EvaluationTemporalContext`, "`Date.now()` is read once … and never again at evaluation time" (TH:110-111); ENCOUNTER without anchor → "reject session creation" (TH:119-128); three-valued overlap MATCH/NO_MATCH/UNKNOWN (TH:205-220); operator class UNKNOWN policy: membership include (fail-open), scalar exclude, aggregate exclude (TH:229-233); scalar selects "**latest** valid, dated, in-window result" (TH:329); lab ties deterministic corrected>amended>final then factId (TH:648-650); reachability advisory, "never treated as binding" (TH:630-633); upper bound = evaluationAsOf, future facts never match (TH:644-645).

| id | paraphrase | quote | ref |
|---|---|---|---|
| D1 | horizon/status typed on CodedCondition; strict v1 parser; legacy-v0 sweep byte-for-byte | "the `legacy-v0` sweep is preserved byte-for-byte." | TH04:88 |
| D2 | `window_days` → NODE `{days:N}`; both supplied rejected | "supplying both `window_days` and `horizon` is rejected." | TH04:105 |
| D3 | Attribute lab/vitals/allergy through kernel; patient.* on resolveAttribute; selection by namespace not operator | "Selection is chosen by namespace and value type, never by operator class." | TH04:107-118 |
| D4 | `satisfaction_check.lookback_days` out of scope (plan 04b) | "tracked as plan 04b." | TH04:120 |
| D5 | `indeterminate` and `uncertainty` independent; uncertainty retained when definite | "**Retained even when the outcome is definite**" | TH04:122-127 |
| D6 | evaluateGate options object; `pathwayDefaults` required | "An optional cascade input is a silent-divergence generator" | TH04:129 |
| D7 | Undated obs admitted but not orderable; undated + any other → AMBIGUOUS_LATEST fail-closed | "an undated fact **plus any other candidate** is `AMBIGUOUS_LATEST` and fails closed." | TH04:131-140; TH:697-702 |
| D8 | Aggregate class selects on START bound; bounded horizon excludes undated; vitals count always 0 | "it selects on the fact's START bound, not interval overlap." | TH04:156-172; TH:704-715 |
| D9 | Coded vitals may not carry `system` | "rejected at authoring, in the adapter AND in the import validator." | TH04:210; TH:717-721 |
| D10 | addPatientContext runs same trust parsing as startResolution | "the same request must not be accepted or refused depending on which mutation carries it." | TH04:284; TH:723-729 |

Compound `indeterminate` truth table (normative, TH04:1252-1264): AND any definite false → false/¬indet; AND all true but ≥1 indet → false/indet; OR any definite true → true/¬indet; OR all false but ≥1 indet → false/indet; all indet → false/indet. Principle: "report it only when uncertainty could have changed the answer" (TH04:1264).

### 1e. Earlier designs still relevant

- **GC:** condition = discriminated union `field` xor `attribute` (GC:78-119); decorators never drive evaluation (GC:124); "Unknown namespace/attribute or missing `patientAttributes` → `undefined` → gate unsatisfied." (GC:222); malformed caught at import "never at runtime" (GC:223).
- **RD (largely superseded):** BFS algorithm (RD:61-82); "Structural nodes pass through -- Stages and Steps are organizational; always traversed" (RD:88); lazy evaluation of `depends_on` targets with memoization (RD:89); cycle → `unknown` + default_behavior (RD:410-418); generation "**Only included nodes** are mapped" and Goal omitted if Stage has no included actions (RD:353-356); red flags must be acknowledged (RD:450).

---

## 2. Explicitly deferred / out of scope / non-goals

| item | quote | ref |
|---|---|---|
| Unified Decision node / `resolve_from` source chain | "The `resolve_from` source chain and the unified `Decision` node." | DS:321 |
| Removing legacy-v0 | "Removing `legacy-v0`." | DS:69-70, 322 |
| Vaginitis LOINC + 3 `prior_node_result` diagnosis gates | "requires clinical input" | DS:323-324 |
| Aggregate escalation | "**Aggregates are deliberately out of scope.**" | DS04:31 |
| SELECTS_BRANCH criterion evaluation | "No criterion evaluation, now or in this plan." | DS05:43 |
| LLM branch spec `target` | "Give `LlmGateBranchSpec` a `target`." (not done) | DS06:346 |
| Question satisfied semantics unchanged | "A question gate still opens on any answer; what changes is *which branch*" | DS06:347 |
| Historical config pinning | "Historical pinning is the review's architectural direction #4 and is out of scope." | EP:53 |
| **#9 reconverging branches** | "First-writer-wins stays, now deterministic; pinned by a documented defect test." | EP:773-774 |
| #10 vital answer address round trip | "(`vitals.*` answers written under the wrong key)" | EP:775 |
| #11 exhaustive persistence; EMPTY_PLAN definition | "keeps today's medications/labs/procedures definition" | EP:411, 776 |
| Overrides acknowledging safety | "Letting an override acknowledge a finding is a clinical decision deferred beyond this spec." | EP:68, 778 |
| Red-flag acknowledgement | "`acknowledged` is never set in production code, so readiness treats every red flag as blocking." | EP:779-780 |
| Bare-string depends_on | "That mismatch is the subject of branch `fix/gate-depends-on-strict-shape`" | EP:781-784 |
| Recommendation identity pathway-local (F1) | "Until F1 lands, step 5's pair check can alias two different drugs that share a node id." | EP:412-413 (partly done P4-3) |
| F3 preview restart; **F4 re-ask stale answers**; F5 child reuse | "Decide whether an answer to a gate that was unreachable for a period should be re-asked" | EP:762-769 |
| Temporal non-goals | windowed ops in UI; per-institution; vitals horizons; entry criteria; "Patient currently taking" | TH:74-82 |
| Temporal deferred | "institution/organization cascade levels; vitals as a dated series; … full `EvaluationSemantics` versioning" | TH:865-868 |
| Entry criteria temporal | "v1 applies temporal/state policy **only after** selection" | TH:758-762 |
| `value_equals` | "introduced later as a **distinct `value_equals`**" | TH:235-236 |
| Coded `exists` authoring rejection | "Authoring-time rejection is deferred to plan 06." | TH:750-756 |
| Plans 04b/05b/06/07/08/09 outstanding; reachability → plan 07 | "04b, 05b, 06, 07, 08, 09 outstanding." | TH00:97, 217, 221-228 |
| GC non-goals | unit conversion; universal selector | GC:47-52 |
| RD | multi-pathway composition out of scope (later done by EP) | RD:845 |
| EP05 | archived-pathway meds normalisation; unmapped-med triage is the user's | EP05:1794-1802 |

---

## 3. Review findings / defects / open items (status)

| finding | quote | ref | status |
|---|---|---|---|
| branch_mode/SELECTS_BRANCH never read | "A `one_of` fork silently includes every branch clearing `suggestThreshold`." | DS:23-26 | Resolved by DS05 (merged PR #55) |
| Presence-only question routing (gate-etiology opens all 5 arms) | "answering any one of them opens all five." | DS:267-268; DS06:31 | Mechanism resolved (DS06); gate-etiology itself not backfilled (DS06:53) |
| LLM `chosenBranch` never routes | "**It never routes.**" | DS06:40 | Resolved by DS06 Task 3 |
| Retraversal defects 1–3 (flip not re-resolved; answer deletes subtree; ignores default_behavior) | "Answering an opening question **deletes** its guarded subtree" | GSR:365-423; DS03:21-27 | Resolved (DS03), then incremental engine deleted (EP R2) |
| GSR open Qs 1–6 | "These are genuinely undecided." | GSR:365-423 | Answered in DS03:31-38 |
| R12-1 signals with no reader; R12-2 OR compound prose loses distinction | "An OR compound gate refused for uncertainty is recorded byte-identically to one where the patient simply had none" | TH04:254-260; TH:739-748 | R12-1 resolved by DS02 (W1); OR prose "deliberately unchanged" |
| R12-3 two uncertainty vocabularies (tentative vs indeterminate) | "nothing names the relationship" | TH04:262 | Open/disclosed |
| **R12-4 satisfied ∧ indeterminate unmodelled** | "If a future operator class ever reports a satisfied-but-doubtful outcome, the table needs a row" | TH04:264 | Open risk |
| RSG §1 red flags never reconciled; no ack path | "blocks care-plan generation for that session **permanently**" | RSG:39-151 | Reconciliation fixed by construction (EP recompute); ack still out of scope (EP:779) |
| RSG §2 answer contracts unenforced (`gate_type==='select'`, evaluateQuestion ignores answer_type, gateOpened heuristic) | "Two validators are two chances to disagree; today there are three" | RSG:154-261 | Partly: EP keeps `validateAnswerAgainstGate` at boundary (EP:455); not confirmed fixed in these docs |
| RSG §3 orphan child sessions | "leaves earlier children `ACTIVE` with nothing referencing them" | RSG:265-342 | Resolved by EP §3/§4 (one transaction) |
| RSG §4 `allergy.* exists` satisfied by absent allergy (legacy-v0) | "a false positive on an allergy, the worst direction" | RSG:346-389 | Fixed in kernel (v1); legacy-v0 pinned |
| Review #1 nested gates, #3 scoring, #2, #6, #7 | "Must pass" | EP:575-576 | Pass (EP03/EP04) |
| **Review #9 shared downstream action** | "excluding arm b sweeps the shared medication before arm a reaches it" | EP03:4619-4640 | **Pinned defect, open** |
| Review #10 vital answer round trip | "stores the answer under the namespaced key and leaves the gate pending" | EP03:4643-4660 | Pinned defect, open |
| Review #5 drug-id aliasing | — | EP04:80 | Passes within composeRun (P4-3); F1 remainder open (EP04:6147) |
| Confidence propagation never ran ("Cycle detected… 1 nodes, 99 edges") | "counts an incoming edge from an unscored parent that it never decrements" | EP:324-330 | Resolved (whole-graph scoring); REC before-after shows lab-2..6 flipped INCLUDED→EXCLUDED (REC/before-after.md:11,24) |
| Defects fixed by construction (8 items incl. override not re-disposing subtree, DP answers without LLM evaluator, suppression read by later partial updates) | "An override of a gate or step does not re-dispose its subtree" | EP:706-725 | Resolved by design |
| `BRANCH_CHOSEN`/`PROVIDER_ASSERTED_DATUM` violate event_type CHECK | — | EP:729-734; 067 step 4 EP:514-516 | Addressed in 067 |
| logNodeOverride enum case vs CHECK | "every override rolled back" | REC/rehearsal.md:75-78 | Fixed `0dfa4ee` |
| Numeric answers to lab questions dropped (merged as dup of undated valueless lab) | "answer was merged as a duplicate of an undated, valueless lab" | REC/deploy.md:28-36 | Fixed `44f071e` (PR #62) |
| Temporal defect-class notes (rounds 1–13, each needs a new check) | "each round's check has to be *different* from the last one's" | TH04:14-25,154,208,266,282 | Process note |
| Migration-064 / legacy sessions undecided | "Backfill-vs-accept is still undecided" | TH00:59-65 | Mooted by purges (DS W0 DS:60-62; D8) |
| EP03 P3-10 LLM calls before session row not audited | — | EP03:82 | Accepted limitation |
| Trade-off: saved answers/overrides re-apply when gate reachable again without re-asking | "Saved answers and overrides re-apply when their gate becomes reachable again, without re-asking" | EP:745 | Accepted; F4 open |
| DS risks: sparse charts become interactive | "do not 'fix' it by softening the defaults." | DS:306-309 | Accepted |

---

## 4. Topic-by-topic

**Gated steps included in stage / care plan.** RD: Stages/Steps "always traversed"; confidence "informational, not gating" (RD:88); generation maps only INCLUDED nodes, Goal omitted if Stage has no included actions (RD:353-356). EP: catch-up items "for every eligible Stage/Step" (EP:313); materialized plan and EMPTY_PLAN derive from **disposition** (EP:163), EMPTY_PLAN counts meds/labs/procedures only (EP:411; P4-8). Readiness: PENDING_GATE only for Gate/DP nodes; "Nodes swept PENDING beneath them" do not add blockers (EP03:80; EP02:1778-1816). Docs do not say whether a Stage containing only gated-out Steps still renders as a Goal beyond RD:356.

**Overrides — one arm or all?** Spec: override sets eligibility, "a gate's sweep still descends *through* it" (EP:253-255); DS03 #2 "respect the override on its own node, but cascade through it" (DS03:34). Implementation per EP02 Task 4: on arrival at a held override the walk enqueues **every** outgoing edge — `for (const e of graphContext.outgoingEdges(nodeIdentifier))` … `continue` (EP02:1263-1276), independent of `action` and without consulting `when`/`branch_mode`. **Implication (not stated anywhere):** an INCLUDE override on a multi-target gate or a one_of DecisionPoint opens all arms, bypassing DS06 totality routing and DS05 one_of; and an EXCLUDE override on a Step still enqueues its children (test: closing gate sweeps past held Step, children stay GATED_OUT, EP02:1189-1201). No doc addresses override × `when`/one_of. Safety still suppresses overridden meds (D4, EP:314). EP05:792-793 expects "INCLUDE overrides on unreachable Medication nodes" to make them candidates. Overrides re-apply silently when node becomes reachable again (EP:745, F4).

**depends_on on unreached nodes.** RD's original intent: lazy on-the-spot evaluation + memoization (RD:89) with evaluation-stack cycle detection (RD:410-418; plan4 line 1518). EP: `prior_node_result` reads eligibility (EP:152); `depends_on` may not target Medication (D11). **No doc in scope states the result of a `depends_on` whose target was never reached/evaluated** (absent from resolutionState) under the pipeline; nor whether lazy evaluation survived. Live evidence: 4 depends_on entries, all to Steps, all in one ARCHIVED pathway (EP:75). Shape: canonical `[{node_id,status}]` (RD:129-131; EP:781-784).

**Reconverging branches / multi-parent nodes (BRANCHES_TO vs HAS_*).** Out of scope #9: "First-writer-wins stays, now deterministic" (EP:773-774). Pinned test: gate q `BRANCHES_TO` a/b with `when`; a→shared, b→shared; answering a leaves `shared` EXCLUDED because non-selected branch is `markSubtree(...EXCLUDED)` first (EP03:4619-4640; mechanism DS06:200-212). Property generators include "reconverging branches" (EP:582), yet determinism, not correctness, is the guarantee. P4-4: merge keeps first-seen entries → nodeId-order projection (EP04:81). RD graph shape: `Step --HAS_GATE--> Gate --BRANCHES_TO--> [gated subtree]` (RD:150-152). `when` applies only to `BRANCHES_TO` edges from gates (DS06:90-100); `HAS_CRITERION` presence drives one_of/all_of backfill (DS:237-238); `SELECTS_BRANCH` criterion→target mapping, display-only (DS05:21-43, zero edges live DS05:35). No doc distinguishes HAS_* (structural) vs BRANCHES_TO semantics for a node reachable via both.

**ESCALATES_TO.** **Not mentioned in any doc in scope** (grep of `docs/` returned zero hits). DS "escalation" means `on_unresolved: 'ask'`, not an edge type.

**Cycles.** RD: logical cycles via `prior_node_result` → node status `unknown`, gate uses default_behavior, `cycle_detected` warning; import static analysis (RD:410-418). EP: C2 removes post-traversal feedback, so "no dependency cycle" between stages (EP:149-151); the "Cycle detected" log came from topologicalSort bug, fixed by whole-graph scoring (EP:326-328; EP01:445). Readiness blocks on TIMEOUT/UNKNOWN nodes (EP:316). `safety.ts` (cycle/cascade) deleted as dead; `CASCADE_LIMIT` enum remains but nothing produces it (EP:341-343).

**LLM gates / observations.** C1/D2/D3/D10 (above). Tentative LLM gate is INCLUDED on safe default with a pendingQuestions entry, and readiness blocks (EP:67, EP02:1786-1790). DS06: LLM `chosenBranch` routes via `when`; tentative routes safe-default and raises question (DS06:253-271). Zero `llm_text_analysis` gates in live graph (DS:258; DS06:41). R12-3: `tentative` vs `indeterminate` relationship unnamed (TH04:262). Audit guarantees EP:445-452; pre-session calls unaudited (P3-10).

**Conflict resolution then safety.** Order: contribution patient safety (stage 5) → merge → conflict **select** (derived from base merge, never appended; losers `withheldBy: 'conflict'`; stale decision → `STALE_CONFLICT_DECISION`) → root patient safety for write-ins → **set safety over final set** → root readiness (EP:367-384). "pair checks never run anywhere but the final set" (EP:186-187). A3: choosing B withheld leaves A included, no pair finding; allergy suppression persists regardless of choice (EP:566-568). Safety outranks override (D4). Conflicts medications-only in v1 (EP:155-156).

**Missing facts / unknown / indeterminate (three-valued).** Fact level: MATCH/NO_MATCH/UNKNOWN overlap (TH:205-220); operator-class policy (TH:229-233); selectFacts outcome READY/NO_MATCH/INDETERMINATE (TH00:200-205). Gate level: `satisfied` stays two-valued; `indeterminate` + `dataUnavailable` are reason channels (DS:93-124); zero candidates = NO_MATCH definite (DS:84-86); membership never indeterminate (DS04:26); compound truth table (TH04:1252-1264). Routing: escalate on indeterminate ∨ dataUnavailable if `on_unresolved:'ask'` (default), else default_behavior (DS:164-178). Attribute route: unknown namespace/missing → undefined → unsatisfied (GC:222); `patient.*` can be indeterminate but not dataUnavailable (DS04:28). ENCOUNTER anchor missing → reject session, not indeterminate (TH:119-128). Aggregates keep default_behavior (DS04:31).

**Eager reachability.** No spec defines "eager reachability"; only test file names `eager-reachability.test.ts` / `eager-disposition-parity.test.ts` appear in EP02:1282. Reachability (`MatchedPathway.reachability`) is advisory, request-scoped clock, never binding, runs same `selectFacts` kernel (TH:623-636); unchanged by TH04 and moved to plan 07 (outstanding) with four open questions (TH00:217). DS: `indeterminate` previously reached API only as aggregate `ReachabilityScore.indeterminateGates` (DS:78-79).

**Sequence-vs-fresh (MUT/SEQ) equivalence.** Required properties: "(a) applying edits one at a time equals `evaluate(finalInputs)`; (b) independent edits in any order give equal results; (c) `evaluate` twice → deep-equal results and identical `resultHash`" (EP:585-588); edit alphabet: answer, re-answer, override, add fact, conflict choice, change choice (EP:584). (b)/(c) in EP02; (a) in EP03 `pipeline-sequence-vs-fresh.test.ts` with falsifications (EP03:4662-4671); runs in EP04; P5-9 adds conflict-heavy sequences (EP05:115). Retired tests mapped to "sequence-vs-fresh" replacements (EP:608-614; EP03 App. A; EP04 App. B). Known asymmetries accepted: answers/overrides re-apply on re-reachability without re-asking (EP:745; F4); #9 and #10 pinned.
