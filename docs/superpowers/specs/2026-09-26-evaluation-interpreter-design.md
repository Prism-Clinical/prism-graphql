# Evaluation Interpreter — Design

**Date:** 2026-09-26
**Status:** Draft for review. Discovery complete; the decisions in §11.2 need product/clinical sign-off before a plan is written.
**Repos:** `prism-graphql` (`apps/pathway-service`); `prism-admin-dashboard` is read for client contracts only.
**Baseline:** `main` @ `d377465` (live). Every `file:line` is relative to `apps/pathway-service/src/` at that commit.
**Builds on:** `docs/superpowers/specs/2026-09-13-evaluation-pipeline-design.md` ("EP", on branch
`docs/evaluation-pipeline-design`), `2026-08-30-decision-semantics-design.md` ("DS"),
`2026-07-21-pathway-temporal-horizon-design.md` ("TH"), `2026-07-11-gate-condition-field-attribute-model-design.md` ("GC").
EP's contracts C1–C4 and decisions D1–D14 remain in force unless §10.1 says otherwise.

**Evidence.** Five read-only discovery traces (runtime, interpreter core, fact access, downstream
stages, corpus) plus probe scripts that ran the deployed engine (`dist/` built from `d377465`)
against the live pathway graphs and against small synthetic graphs. Findings marked **[probe]**
were reproduced that way; **[code]** means read from source only; **[live]** means read-only SQL/AGE
against `prism_db` on 2026-09-26.

---

## 1. Goals, non-goals, evidence

### 1.1 The problem, stated precisely

EP consolidated *when* evaluation happens (one pipeline, recompute from recorded inputs, one
snapshot, one write path). It did not change *how a node is interpreted*. The interpreter is still a
breadth-first walk (`services/resolution/traversal-engine.ts`, 1345 lines) in which a node's status is
a side effect of the order in which it is reached:

- **17 separate sites write a node's status** (§2.2). Each guards itself with "skip if already in
  state". Each is locally reasonable; together, the result depends on which one runs first.
- **Edge types are not interpreted.** Every node type except Gate/DecisionPoint enqueues *all*
  outgoing edges (`TE:1214-1218`, `:1266-1270`, `:1286-1290`). A Stage's `HAS_STEP`, a gate's
  `BRANCHES_TO`, `REQUIRES` (which points *backwards*, dependent → prerequisite), `ESCALATES_TO` and
  `CITES_EVIDENCE` are all "a way to get here".
- **There is no join.** A node with several parents takes the status of whichever arrival is
  written first (`TE:541`, `:247`, `:141`). Nothing ever combines what all of a node's parents say.
- **Two condition evaluators disagree about "missing".** Under the `v1` kernel a missing lab is
  *unknown* and is asked for; `patient.*` attributes and unmapped `lab.*`/`allergy.*` attributes fall
  back to the legacy evaluator, where missing is a *definite no* (`condition-adapter.ts` returns
  `null` → `evaluateConditionLegacyAdapted`). Which one runs depends on how the author addressed the
  datum, not on the clinical situation.
- **Facts enter through five doors and are merged with a rule that drops data.** Coded arrays are
  deduplicated on `code|system|date|sourceId` with the *base* entry winning
  (`effective-context.ts`), vitals and attributes are deep-merged, and the read side addresses the
  same datum under different keys (`LOINC:718-7` vs `lab.hemoglobin`; `vitals.systolic_bp` written,
  `systolic_bp` read).

This is accidental complexity. The domain complexity is real — conditions over time-stamped facts,
three-valued outcomes, questions, exclusive decisions, LLM observations, overrides, safety — but none
of it requires walk-order-dependent state.

### 1.2 What it does to patients today (live)

The only ACTIVE pathway, `anemia-in-pregnancy-v1@1.4`, attaches every gated Step both to its Stage
(`HAS_STEP`) and to its gate or decision (`BRANCHES_TO`). The Stage edge is one hop shorter, so it
always wins:

- `gate-severe-anemia` is GATED_OUT ("labs value 9.4 >= 7") and **`step-3-3` "Blood transfusion" and
  `proc-1` are INCLUDED** — in all 4 live sessions on 1.4 **[live]**, in the deploy record
  (`records/evaluation-pipeline-05/after.txt:18,48`) and in a probe **[probe]**. Moving one edge in the
  export flips the step to GATED_OUT **[probe]**: the outcome depends on edge order.
- Where the provider chose `step-2-3` at the `one_of` decision `dp-1`, the other exclusive arm
  `step-3-1` (oral iron) is also INCLUDED **[live]**.
- A patient with no trimester recorded: `gate-anemia-t1t3` / `-t2` are compound AND gates of
  `patient.trimester` and haemoglobin. The missing trimester is a silent definite false, so the gate
  closes and the haemoglobin question is never asked **[probe; live sessions]**.

The before/after comparison of the evaluation-pipeline release could not see the first two: the
wrong statuses were identical before and after, so the diff was empty on those lines. A comparison
catches regressions, not pre-existing defects; §10.3 adds semantic invariants for that reason.

### 1.3 Goals

1. **A node's result is a function of its inputs, not of evaluation order.** Proven by construction
   (§3) and checked by an edge/node-permutation property (§10.3).
2. **Each semantic rule lives in one place.** Edge meaning, joins, gate outcomes, decision
   selection, missing-data handling and fact selection each have one implementation.
3. **Validation and normalization happen once**, in a compiler shared by import, activation and
   evaluation, so runtime code never re-interprets raw authored properties.
4. **One fact-access boundary** with one datum identity, one missing/unknown vocabulary and a fact
   ledger that never silently drops what a clinician entered.
5. **Keep every EP guarantee** (§1.5) and keep the GraphQL contract the admin depends on (§8).
6. **Correct the confirmed defects** listed in §10.1 as a consequence of the model, not as patches.

### 1.4 Non-goals

- A general workflow engine, plugin registry, or new authoring language.
- Putting scoring, multi-pathway composition or set-level safety into the graph walk. They stay
  separate stages with explicit inputs (§7).
- Changing *clinical* semantics silently. Every behaviour change is listed in §10 and every open
  policy question in §11.2.
- Redesigning confidence scoring, conflict detection, care-plan materialization or the admin UI.
  Their defects are catalogued (§7.6) because the interpreter's output feeds them, but fixing them is
  root cause 4 and needs its own spec.
- Historical configuration pinning (EP Constraints; still out of scope). Within one mutation, the snapshot already fixes configuration (EP C4).

### 1.5 Guarantees preserved

| Guarantee | Source | How this design keeps it |
|---|---|---|
| Recompute from authoritative recorded inputs | EP D1 | Unchanged: `evaluate(inputs, env, observations)` is still the only way a result is produced. |
| Determinism for fixed inputs, env, recorded observations | EP C1 | Strengthened: now also independent of node/edge order (§4.1, §10.3). |
| One environment snapshot per mutation | EP C4 | Unchanged, and the attribute code map (currently a process-wide cache, `attribute-code-map.ts:4-28`) moves inside the snapshot (§8). |
| Observations reused under semantic keys | EP C1/D2/D10 | Unchanged provider; LLM gates are consulted only when active (§5.5). |
| Eligibility separate from disposition | EP C2/D11 | Unchanged; the interpreter produces eligibility only. |
| Safety outranks overrides | EP D4 | Unchanged. |
| Parent-owned facts and one parent revision lock for runs | EP D5/D6 | Unchanged. |
| Atomic persistence and generation | EP §4 | Unchanged. |
| Reviewed-hash protection, idempotent completed generation | EP D7 | Unchanged; the hash stops including rendered confidence numbers (§7.5). |
| Explicit missing data, uncertainty, incomplete evaluation, failures | DS W1/W2, EP D3 | Made uniform: every condition kind reports the same states (§5.3); nothing collapses to a boolean. |

### 1.6 How success is assessed

- **Order independence:** results are byte-identical (canonical JSON) under every permutation of
  node and edge order, for every live graph and the synthetic corpus (§10.3).
- **Semantic invariants** hold on every generated case (§10.3), e.g. no ACTIVE node without an open
  applicability path; no pending question from an inactive node; every askable datum round-trips.
- **Differential run** against the current engine over the recorded corpus: every difference falls
  into an approved correction class in §10.1; anything else fails the gate (§10.2).
- **Deletion:** the code listed in §10.6 is removed, not wrapped.
- **Performance:** the EP mutation budgets (single < 2 s p95, run < 5 s p95) still pass on the
  live copy with the fixture safety references; today's p95s are 33–131 ms.

---

## 2. Discovery summary

### 2.1 Responsibility map (current)

| Responsibility | Where it lives today | Problem |
|---|---|---|
| Graph scheduling / reachability | `TE:429-552` BFS queue, `enqueueable` (`:600`), per-type "enqueue all children" | Reachability is walk order; edge types ignored |
| Condition evaluation | `GE` legacy evaluator + v1 kernel (`temporal/*`), chosen per condition by `condition-adapter` | Two semantics for "missing" |
| Temporal fact selection | `temporal/select-facts.ts`, `context-assembler.ts`, `cascade.ts` | Sound; only gates use it (scorers, catch-up, safety read raw arrays) |
| Confidence-based decisions | `pipeline/evaluate.ts:47-54` scores; `TE:946-975` DP qualification; `TE:1222-1251` action inclusion | A second decision engine with its own patient semantics (§7.2) |
| Gate routing | `TE:604-916` | Mixed with sweeping descendants and pushing questions |
| DecisionPoint routing | `TE:919-1193` | Mixed with sweeping arms; drops non-branch children when pending (`TE:1121`) |
| Provider answers | `resolvers/mutations/resolution.ts:169-246` (`answerChange`) | Answers-as-facts write under keys the readers don't use |
| Overrides | pre-seed `TE:469-483`, held arrival `TE:527-537` | Held arrival enqueues every edge: opens every arm |
| Missing-data questions | `TE:89-121` `unresolvedAsk`, `unresolved-prompt.ts:askFor` | Only v1 scalar paths can ask; some asks can never be satisfied |
| Recursive dependency evaluation | `TE:609-655`, `evaluateNodeEagerly` `TE:1322-1344` | Reads provisional status; side effects not provisional |
| Descendant propagation | `markSubtree` `TE:215-290`, `markBranchNotSelected` `TE:131-173` | Sweeps are writes; first writer wins |
| Projection, safety, readiness | `pipeline/disposition.ts`, `safety.ts`, `readiness.ts`, `compose.ts`, `care-plan-*` | Mostly sound (EP); see §7.6 for defects outside this spec |

### 2.2 Every writer of node status (current)

Condensed from discovery B. "Guard" is what stops a later write.

| # | Site | Writes | Guard |
|---|---|---|---|
| W1 | `TE:472` override pre-seed | INCLUDED/EXCLUDED | none (runs first) |
| W2 | `TE:497` provisional delete | removes entry | — |
| W3 | `TE:509` timeout | TIMEOUT for popped + all queued | skip if present |
| W4 | `TE:530` held arrival | parent/depth; enqueues **all** children | — |
| W5 | `TE:629` dependency cycle | UNKNOWN / GATED_OUT | entry |
| W6 | `TE:643` cycle sweep | GATED_OUT subtree | `markSubtree` |
| W7 | `TE:687` gate open | INCLUDED | entry |
| W8 | `TE:764` unselected arm | EXCLUDED subtree | `markBranchNotSelected` |
| W9 | `TE:782,799` unanswered question | PENDING gate + subtree | entry / sweep |
| W10 | `TE:821,839` unresolved datum | PENDING gate + subtree | entry / sweep |
| W11 | `TE:878,892` closed, default skip | GATED_OUT gate + subtree | entry / sweep |
| W12 | `TE:896` closed, default traverse | INCLUDED conf 0, **all** children | entry |
| W13 | `TE:1069-1104` DP pending | PENDING DP, arms, arm subtrees | `has()` |
| W14 | `TE:1125` DP decided | INCLUDED | entry |
| W15 | `TE:1148,1162` DP unchosen arm | EXCLUDED arm + subtree | `enqueueable` — **overwrites held overrides** |
| W16 | `TE:264` `markSubtree` | given status | skip if present and not provisional/held |
| W17 | `TE:157` `markBranchNotSelected` | EXCLUDED | as W16 |
| W18 | `TE:1202` Stage/Step/Pathway | INCLUDED, all children | entry |
| W19 | `TE:1241` action | INCLUDED/EXCLUDED by score, all children | entry |
| W20 | `TE:1280` everything else | INCLUDED conf 1, all children | entry |
| W21 | `TE:1341` eager dependency | whatever W5–W20 write; root marked provisional | `has()` |

After traversal, `pipeline/disposition.ts:44-48` writes disposition only (EP C2) — that one is fine.

### 2.3 Confirmed interpreter defects (all reproduced)

| ID | Defect | Evidence |
|---|---|---|
| I-1 | A structural parent defeats a gate or decision on a multi-parent node (transfusion, oral iron above). | [probe] 1a/1b/1d/13; [live] 4 sessions |
| I-2 | `prior_node_result` reads a dependency's *provisional* status and is never re-evaluated → order-dependent. | [probe] 2; `eager-reachability.test.ts:108` asserts only `toBeDefined` |
| I-3 | INCLUDE **or EXCLUDE** override on a Gate or DecisionPoint opens every arm (bypasses `when`, `one_of`, LLM choice). | [probe] 3b–3e; no test |
| I-4 | Diamonds are decided by queue position (review #9, pinned as a defect in `pipeline-sequence-vs-fresh.test.ts:223-243`). | [probe] 4/4c/4d |
| I-5 | Eager side effects are permanent: duplicate pending questions; a pending DP later swept GATED_OUT still blocks readiness. | [probe] 6, 8 |
| I-6 | A detected dependency cycle leaves no trace (UNKNOWN erased on re-disposition). | [probe] 10 |
| I-7 | Default `traverse` on a multi-arm gate opens every arm with no red flag. | [probe] 5 |
| I-8 | A pending DP drops its non-branch children from the result (`crit-1a/1b`, `gate-iron-deficient` absent live). | [probe] 1c/14; [live] `after.txt` |
| I-9 | A DP's unchosen-arm write clobbers a provider override. | [probe] 18 |
| I-10 | Unknown/miscased `branch_mode` fails open to any_of (gates fail closed). | [probe] 15 |
| I-11 | An unreached provisional dependency stays in the final result (`orphan=INCLUDED`). | [probe] 7 |
| I-12 | `ESCALATES_TO` is traversed like a child: second-line drugs are included whenever the first-line node is reached. | [probe] C1; undocumented anywhere |
| I-13 | `REQUIRES` (dependent → prerequisite) is traversed forwards as a child; it also creates the "cycles" that switch confidence propagation off for a whole pathway. | [code]; `gestational-hypertension-preeclampsia` has 6 |

### 2.4 Confirmed fact-access defects

| ID | Defect | Evidence |
|---|---|---|
| F-1 | Missing `patient.*` (and unmapped `lab.*`/`allergy.*`) is a silent definite false; in a compound AND it suppresses the question for the sibling datum. | [probe]; ACTIVE anemia 1.4 shape |
| F-2 | A `vitals.*` attribute answer is written as `vitalSigns['vitals.systolic_bp']`; the gate reads code `systolic_bp`; asked forever. | [probe]; pinned review #10 |
| F-3 | Undated value + any other value for the same scalar → `AMBIGUOUS_LATEST`; a provider answer can never resolve it. | [probe] |
| F-4 | Second answer for the same datum at the same pinned clock has the same dedup key → dropped; the audit event still records it. | [probe] H/G |
| F-5 | A lab dated today at day precision is `TEMPORAL_UNKNOWN` and poisons the scalar; answering cannot fix it. | [probe] C |
| F-6 | One datum, two question keys: coded `LOINC:718-7` vs attribute `lab.hemoglobin`. | [code] `unresolved-prompt.ts` |
| F-7 | Legacy-dialect conditions (`LT`, `IN "1,3"`) survive in DRAFT 1.1–1.3 and archived graphs and evaluate to a silent false; `activatePathway` does not validate. | [live]; `resolvers/mutations/import.ts:66-90` |
| F-8 | Lowercase compound `operator: "and"` passes validation and runs as OR. | [code] `GE:1397` |
| F-9 | `lab.rh_factor` (string) escalates as a NUMERIC question that can never match. | [probe] |

Previously fixed and kept fixed: the undated provider-answer shadowed by an undated valueless lab
(PR #62, `44f071e`).

---

## 3. Execution model

### 3.1 Why a compilation step

Today the same authored properties are interpreted in four places that disagree:
- the import validator (`services/import/validator.ts`);
- the runtime condition adapter, which re-validates and sometimes falls back to legacy (`temporal/condition-adapter.ts`);
- the v1 anchor sweep at session start (`resolvers/helpers/resolution-context.ts:sweepableConditions`);
- activation, which checks nothing (`resolvers/mutations/import.ts:66-90`).

The engine then casts raw properties at use (`TE:213`, `:661`), lower-cases `default_behavior` in one
place and not another (`TE:875` vs `:627`), and treats unknown edge types as children.

A compiler removes that: **authored graph + attribute code map → `CompiledPathway`**, a typed, validated,
normalized, immutable value. It is:

- **pure** — a function of the snapshot's graph and code map;
- **the only validator** — import, activation and evaluation all call it; import may still *store* a draft
  that does not compile, but such a draft cannot be previewed, activated or evaluated;
- **cheap and derived** — never persisted. `loadEvaluationEnv` compiles inside the snapshot and caches the
  result in-process keyed by `(graphFingerprint, codeMapFingerprint, COMPILER_VERSION)`. A 100-node graph
  compiles in single-digit milliseconds;
- **the end of raw-property access** — evaluators receive compiled nodes only.

### 3.2 Node kinds

| Compiled kind | Authored node types | Has its own decision? |
|---|---|---|
| `root` | Pathway | no |
| `container` | Stage, Step | no |
| `gate` | Gate | yes: arm states for its `BRANCHES_TO` arms |
| `choice` | DecisionPoint | yes: arm states for its `BRANCHES_TO` arms |
| `action` | Medication (role not `contraindicated`/`avoid`), LabTest, Imaging, Procedure, Guidance | yes: include/exclude |
| `constraint` | Medication with role `contraindicated` or `avoid` | no; never a safety candidate, never projected as an intervention (§7.6) |
| `item` | Schedule, QualityMetric | no; plan content whose status is its activation |
| `annotation` | Criterion, EvidenceCitation, CodeEntry | no; carries its owner's activation for display |

`Monitoring`, `Lifestyle` and `Referral` appear in `types.ts:572` but in no authored node type
(`services/import/types.ts`); they are dropped from the model.

### 3.3 Edge kinds

Every authored edge type maps to exactly one compiled kind. An unknown type is a compile error.

| Authored edge | Compiled kind | Meaning |
|---|---|---|
| `HAS_STAGE`, `HAS_STEP`, `HAS_GATE`, `HAS_DECISION_POINT`, `USES_MEDICATION`, `HAS_LAB_TEST`, `HAS_IMAGING`, `HAS_PROCEDURE`, `HAS_GUIDANCE`, `HAS_SCHEDULE`, `HAS_QUALITY_METRIC` | `contains` | **Where** the child lives: it is in scope when its container is. |
| `BRANCHES_TO` (from Gate or DecisionPoint) | `guards` (one *arm* per edge, carrying its `when`) | **When** the target applies: only if that arm is open. |
| `HAS_CRITERION`, `SELECTS_BRANCH`, `CITES_EVIDENCE`, `HAS_CODE` | `annotates` | Metadata. Never affects scope. |
| `REQUIRES` | `prerequisite` | Consumed by catch-up findings only (`pipeline/findings.ts`). Never affects scope. Fixes I-13. |
| `ESCALATES_TO` | `alternative` | Recorded relation "use B if A is unsuitable". Never affects scope (§11.2 Q7). Fixes I-12. |
| Gate property `depends_on` | `data` | The gate reads the target's **eligibility** (EP C2). Ordering only. |

`HAS_CHILD` exists only in test fixtures (`__tests__/fixtures/pipeline-env.ts:15`); fixtures move to real
edge types.

### 3.4 Activation: the join rule

Each node has an **activation**: is it in scope for this patient? It has three states, ordered for
joining as `ACTIVE > PENDING > INACTIVE`:

- `ACTIVE` — in scope.
- `PENDING` — cannot be decided until something is answered.
- `INACTIVE` — out of scope, with a `cause` naming the node and reason that closed it.

Let `C(n)` be the activations of n's containers and `G(n)` the states of the arms that guard n
(`OPEN → ACTIVE`, `PENDING → PENDING`, `CLOSED → INACTIVE`).

```
any(xs)  = the highest state in xs            (ACTIVE if any ACTIVE, else PENDING if any PENDING, else INACTIVE)
all(xs)  = the lowest state in xs             (INACTIVE if any INACTIVE, else PENDING if any PENDING, else ACTIVE)

activation(root) = ACTIVE
activation(n)    = all([ any(C(n)) if C(n) non-empty,
                         any(G(n)) if G(n) non-empty ])
```

In words: **a node is in scope when at least one of its containers is in scope and — if anything guards
it — at least one of its guards is open.** Containment says where a node lives; guards say when it
applies. This is recommended decision Q1 (guards decide applicability) with Q2 (several guards combine
as *any*), §11.2.

- `step-3-3` (transfusion): `C = {stage-3: ACTIVE}`, `G = {gate-severe-anemia arm: CLOSED}` → `INACTIVE`,
  cause `gate-severe-anemia`. Fixes I-1.
- `step-2-2`: guarded by `gate-anemia-t1t3` and `gate-anemia-t2` — trimester 1/3 with Hb < 11, or
  trimester 2 with Hb < 10.5. Either suffices: `any`.
- A node reached only through arms (GHTN stages 3–5) has `C` empty: `activation = any(G)`.
- A diamond whose two containers disagree (review #9, `shared` under arms `a` and `b`) is `ACTIVE` if
  either container is. Fixes I-4.

Both operators are commutative, associative and idempotent, so the result cannot depend on the order in
which parents are listed or visited.

**Inactive cause → public status.** `NodeStatus` is unchanged on the API:

| Situation | `eligibility.status` |
|---|---|
| ACTIVE container, item, annotation, root | `INCLUDED` |
| ACTIVE gate/choice/action | from its own decision (§6) |
| PENDING (anything) | `PENDING_QUESTION` |
| INACTIVE because a gate closed | `GATED_OUT` |
| INACTIVE because an arm was not selected (choice or routed gate) | `EXCLUDED` ("Not selected by …") |
| INACTIVE inherited from a container | the container's inactive status |
| INACTIVE with several closed guards | `GATED_OUT` if any cause is a closed gate, else `EXCLUDED`; all causes are listed, sorted by nodeId |

`TIMEOUT`, `CASCADE_LIMIT` and `UNKNOWN` are no longer produced (§4.6); the enum values stay for the API.

### 3.5 Normalizations and validation rules

The compiler rejects (error) or normalizes (N). All errors name the node and field.

| # | Rule | Fixes |
|---|---|---|
| V1 | Edge types and endpoints per `VALID_EDGE_ENDPOINTS` (`services/import/types.ts`) | — |
| V2 | Exactly one root; every non-root node is reachable from it through `contains ∪ guards` (annotations through their owner) | orphans (I-11) |
| V3 | `contains ∪ guards ∪ data` is acyclic. `prerequisite` and `alternative` are excluded, so the GHTN "cycles" disappear | I-6, I-13 |
| V4 | `gate_type`, `branch_mode ∈ {one_of, all_of, any_of}` exact; `default_behavior ∈ {skip, traverse}` (N: case-folded); `on_unresolved ∈ {ask, default}`; compound `operator` (N: upper-cased) | I-10, F-8 |
| V5 | A gate or choice with more than one arm needs a total `when` mapping (DS06 rules, unchanged); a gate with more than one arm may not use `default_behavior: traverse` | I-7 |
| V6 | Conditions parse into the condition IR (§5.2). Only the canonical vocabularies (`VALID_CODED_OPERATORS`, `VALID_ATTRIBUTE_OPERATORS`) are accepted; the legacy dialect is an error | F-7 |
| V7 | `lab.*`/`allergy.*` attributes need a code-map row; `patient.*` must be in `KNOWN_PATIENT_ATTRIBUTES`; each resolves to a `DatumRef` (§5.1) | F-1, F-6 |
| V8 | `depends_on` is `[{node_id, status}]` with `status` in the `NodeStatus` vocabulary exactly; targets exist and are not Medication (EP D11) | bare-string `depends_on` |
| V9 | Temporal overrides (`horizon`, `status`, `window_days`) parse under the pathway's policy; the model records whether it needs `encounterStart` | today checked only at session start |
| V10 | Medication `role` decides `action` vs `constraint` | §7.6 |

What the compiler produces:

```ts
interface CompiledPathway {
  pathwayId: string;
  graphFingerprint: string;
  compilerVersion: string;
  order: NodeId[];                          // topological over contains ∪ guards ∪ data; ties by nodeId
  nodes: ReadonlyMap<NodeId, CompiledNode>;
  containers: ReadonlyMap<NodeId, NodeId[]>;   // C(n)
  guards: ReadonlyMap<NodeId, ArmRef[]>;       // G(n): {controller, armId}
  datums: ReadonlyMap<DatumKey, DatumSpec>;    // every datum any condition reads
  requiresEncounterAnchor: boolean;
}

type CompiledNode =
  | { kind: 'root' | 'container' | 'item'; id: NodeId; props: DisplayProps }
  | { kind: 'annotation'; id: NodeId; owner: NodeId; props: DisplayProps }
  | { kind: 'gate'; id: NodeId; gate: CompiledGate; arms: Arm[] }
  | { kind: 'choice'; id: NodeId; mode: 'one_of' | 'all_of' | 'any_of'; arms: Arm[] }
  | { kind: 'action' | 'constraint'; id: NodeId; actionType: ActionType; props: ActionProps };

type CompiledGate =
  | { type: 'condition'; condition: ConditionIR; onUnresolved: 'ask' | 'default'; defaultBehavior: 'skip' | 'traverse' }
  | { type: 'question'; answerType: AnswerType; options?: string[] }
  | { type: 'prior_result'; dependsOn: { nodeId: NodeId; status: NodeStatus }[]; defaultBehavior: 'skip' | 'traverse' }
  | { type: 'llm'; request: LlmRequestSpec; threshold: number; safeDefaultArm: ArmId };

interface Arm { id: ArmId; target: NodeId; when?: BranchWhen }   // `when` required iff arms.length > 1
```

`patient_attribute` and `compound` gates both compile to `type: 'condition'`; a compound is a
`ConditionIR` node (§5.2).

---

## 4. Scheduler

### 4.1 Strategy: evaluate once, in topological order

The compiler fixes `order`, a topological order of `contains ∪ guards ∪ data`, breaking ties by nodeId.
The scheduler visits each node exactly once in that order:

```ts
function interpret(model: CompiledPathway, inputs: InterpreterInputs, facts: FactAccess,
                   observations: ObservationProvider, scores: ScoreTable): Interpretation {
  const results = new Map<NodeId, NodeResult>();
  for (const id of model.order) {
    const node = model.nodes.get(id)!;
    const activation = activationOf(id, model, results);          // §3.4, reads parents only
    const outcome = activation.state === 'ACTIVE'
      ? evaluatorFor(node).evaluate(node, contextFor(id, results, inputs, facts, observations, scores))
      : inactiveOrPendingOutcome(node, activation, inputs);        // no evaluation, no question, no LLM call;
                                                                    // an action's override still applies (§6.5)
    results.set(id, resultOf(node, activation, outcome));          // the only write
  }
  return collect(results);   // questions, red flags, observationsUsed — gathered from results
}
```

- **One writer.** `results.set` is the only write, once per node, after everything the node reads is
  already final. W1–W21 (§2.2) all disappear.
- **Reachability and data dependencies are different edges with the same scheduling rule.** Reachability
  (`contains`, `guards`) feeds `activationOf`. Data dependencies (`data`) are read by the evaluator
  through `ctx.resultOf(depId)`, which may only name declared dependencies. Both are ordering edges, so
  both are final when read.
- **Laziness is by activation, not by walk.** Inactive gates are not evaluated, ask nothing and call no
  model. Every node still gets a result, so the node set is complete (fixes I-8).

### 4.2 Why not BFS, and why not a fixpoint

- BFS has no join: a node is decided by its first arrival. Adding a join to BFS means waiting for all
  parents, which *is* topological order.
- A fixpoint (iterate until nothing changes) is only needed when dependencies can be cyclic. V3 rejects
  cycles. The live corpus has none once `REQUIRES` is excluded: anemia and chronic-htn are acyclic, and
  GHTN's 6 cycles all close through `REQUIRES` back-edges [discovery D §1.2]. The only live `depends_on`
  entries are in one ARCHIVED pathway (EP D11 evidence).

### 4.3 Joins and reconvergence

Handled entirely by §3.4. The scheduler never special-cases them.

### 4.4 Dependencies on unreached nodes

A `data` target always has a final result when the gate runs, because it precedes the gate in `order`.
If the target is INACTIVE, the gate reads its inactive eligibility (`GATED_OUT` or `EXCLUDED`), which is a
definite mismatch against `INCLUDED`. There is no eager evaluation and no provisional status. Fixes I-2,
I-5, I-11. A target that is PENDING makes the dependent gate PENDING without a question of its own (§6.2).

### 4.5 Cycles

Rejected at compile (V3). Runtime cycle detection (`evaluationStack`, `TE:609-655`) is deleted.

### 4.6 Timeouts and cancellation

- The interpretation pass performs no I/O except through `ObservationProvider`, and is O(nodes + edges).
  It has no timeout. `TRAVERSAL_TIMEOUT_MS` and TIMEOUT stamping are deleted.
- Observation acquisition gets a **per-evaluation budget** (initially 20 s, config). Past the budget, the
  provider returns `UNAVAILABLE` for new requests. That is the existing tentative path (EP C1, D3): the
  gate takes its safe default and readiness blocks on the tentative question. Per-call timeout stays
  (`LLM_GATE_TIMEOUT_MS`).
- Cancellation: evaluation holds no transaction and writes nothing (EP §4), so an aborted request simply
  never commits.

`DEGRADED` and `INCOMPLETE_RESOLUTION` then have no producer: the interpreter either returns a complete
result or refuses (a graph that does not compile is refused at the mutation with `PATHWAY_NOT_EVALUABLE`,
§8). The enum values stay in the API.

### 4.7 Cost

One pass over ≤ 400 nodes (the largest live run) with map lookups. The EP gate measured today's p95 at
33 ms single / 131 ms run including persistence; the pass itself was 3–10 ms of that
(`records/evaluation-pipeline-05/rehearsal.md`). The new pass should be no slower; §10.4 keeps the gate.

---

## 5. Fact access and external observations

### 5.1 One datum identity

`DatumRef` names what a condition reads and what an answer writes:

| Datum | Key |
|---|---|
| Lab (coded `labs` condition, or `lab.*` attribute via its code-map row) | `lab:<system>:<code>`, e.g. `lab:LOINC:718-7` |
| Vital (coded `vitals`, or `vitals.*` attribute) | `vital:<path>`, e.g. `vital:systolic_bp` |
| Condition / medication / allergy code | `condition:<system>:<code>` etc. (wildcards stay a query, not a datum) |
| Patient attribute | `attribute:<name>`, e.g. `attribute:trimester` |

The compiler resolves every condition's datum. A question's `datumKey` is the DatumRef key, and an answer
is written against the DatumRef. Coded `718-7` and attribute `lab.hemoglobin` become one question
(fixes F-6); a vital answer lands where the vital is read (fixes F-2).

### 5.2 One condition IR, one evaluator

```ts
type ConditionIR =
  | { op: 'and' | 'or'; of: ConditionIR[] }
  | { op: 'member'; query: MembershipQuery; policy: TemporalPolicy }               // includes_code, equals, exists
  | { op: 'compare'; datum: DatumRef; cmp: Comparator; operand: Scalar | Scalar[]; policy: TemporalPolicy }
  | { op: 'aggregate'; datum: DatumRef; fn: 'count' | 'trend_up' | 'trend_down' | 'delta'; params: AggregateParams; policy: TemporalPolicy };

type Truth =
  | { v: 'T' | 'F'; reasons: Reason[]; uncertainty: Uncertainty[] }
  | { v: 'U'; unknown: UnknownReason; reasons: Reason[]; uncertainty: Uncertainty[] };

interface UnknownReason {
  kind: 'missing' | 'ambiguous' | 'temporal' | 'validity' | 'insufficient_series' | 'awaiting';
  datum?: DatumRef;
  askable: boolean;      // true only if an answer at `datum` provably resolves it (§5.4)
}
```

- Coded and attribute conditions compile to the same IR. `patient.*` goes through the same `compare`
  as a lab. There is no legacy fallback, so "missing" means the same thing everywhere (fixes F-1).
- Compound truth follows the normative TH04 table (`plans/2026-07-26-temporal-horizon-04-evaluator-kernel.md:1252-1264`)
  with `U` for "indeterminate or unavailable": in AND a definite F dominates; in OR a definite T
  dominates; otherwise any U makes the result U, with the first askable unknown as the reason.
- `legacy-v0` is removed (§11.2 Q9). All 16 live sessions run `v1` [live].

### 5.3 The fact-access boundary

```ts
interface FactAccess {
  /** Latest value by the selection rule (§5.4), or why there isn't one. */
  scalar(datum: DatumRef, policy: TemporalPolicy): Known<Scalar> | Unknown;
  /** Absence is a definite answer (DS W1); uncertain facts follow TH's membership policy. */
  member(query: MembershipQuery, policy: TemporalPolicy): Known<boolean>;
  series(datum: DatumRef, policy: TemporalPolicy): Known<SeriesPoint[]> | Unknown;
}
type Known<T> = { state: 'known'; value: T; provenance: Provenance[]; uncertainty: Uncertainty[] };
type Unknown  = { state: 'unknown'; reason: UnknownReason };
```

`FactAccess` wraps the existing temporal kernel (`select-facts.ts`, `overlap.ts`, `cascade.ts`); those
modules stay. It is built once per evaluation from the **fact ledger**, the pinned clock and the pathway's
temporal defaults, and it performs no I/O.

**The fact ledger** replaces the dedup merge in `effective-context.ts`:

- `initialPatientContext` entries (source `chart`), then `additionalContext` entries (source `context`),
  in recorded order;
- then **provider assertions**, appended with a strictly increasing `seq`. They are stored in the parent's
  `additional_context` JSON as `providerAssertions: [{ datum, value, seq, assertedAt }]` (no migration:
  the column is JSONB);
- nothing is dropped. Two entries identical in every field collapse; any difference keeps both.

### 5.4 Selection rule for provider assertions (§11.2 Q6)

For `scalar(datum)`:
1. If there is a provider assertion for the datum, the one with the highest `seq` is the value
   (provenance `provider`, `assertedAt = evaluationAsOf`).
2. Otherwise the existing TH/TH04 selection applies unchanged: latest valid, dated, in-horizon; undated
   plus any other candidate is `ambiguous`; a day-precision fact straddling the clock is `temporal`.

A clinician answering "what is the current haemoglobin?" is asserting the current value. Rule 1 makes that
answer decisive. It ends the three deadlocks where an answer could not resolve the question it answered
(F-3, F-5) and makes a correction take effect (F-4). The audit trail distinguishes the assertion from
chart data, as DS W2 requires.

**Askability** is then decidable at compile time. An unknown is `askable` iff it has a `DatumRef` whose
value type is numeric or boolean, and whose read goes through `scalar` (rule 1 guarantees the round trip).
Membership never produces unknown; aggregates are non-askable (DS04: "no honest single answer"); a
string-valued datum is non-askable in this version (fixes F-9's unanswerable NUMERIC question).

### 5.5 External observations

`ObservationProvider` and the observation key are unchanged (EP C1, D2, D10). Three changes:

1. It is consulted only for ACTIVE `llm` gates (inactive gates are never evaluated).
2. It is not consulted when the gate has a provider answer. The answer already wins routing
   (`decision-value.ts`); today the model is still called on every evaluation [discovery C §5.1].
3. Acquisition runs under the per-evaluation budget (§4.6).

Recording (only successful observations the result used), reuse across retries, and replay are unchanged.
`replayObservations` stays test/audit-only; production uses the live provider, as today.

### 5.6 Other consumers of facts

Confidence scorers, catch-up prerequisites and the safety candidate universe read raw arrays today with
different semantics [discovery C §3.1]. This spec gives them the same ledger (so they see provider
assertions) via an `effectivePatientContext` projection. It does **not** move them onto `FactAccess`:
that changes clinical scoring and is part of Q8.

---

## 6. Decision semantics

### 6.1 Precedence

For a node, in order:

1. **Activation.** INACTIVE or PENDING nodes are not evaluated (§3.4).
2. **Provider override** — action nodes only (§11.2 Q3). INCLUDE → `INCLUDED`, EXCLUDE → `EXCLUDED`,
   `decidedBy: 'override'`, whatever the activation, as today for actions
   (`pipeline-traversal-overrides.test.ts:25`, `:37`). Overrides on Gate, DecisionPoint or container
   nodes are rejected at the mutation. Fixes I-3, I-9.
3. **Provider answer** — question gates, DecisionPoint choices, LLM gates.
4. **Recorded observation** — LLM gates.
5. **Condition value** from facts.
6. **Unknown handling** — ask, or `default_behavior`.
7. **Confidence** — DecisionPoint arm qualification and action inclusion (unchanged; §11.2 Q8).

Safety and conflict selection come after eligibility, as disposition (EP C2, D4).

### 6.2 Gate outcome

For an ACTIVE gate with arms `A` (one arm, or several with `when`):

| Gate type | Input state | Arms | Gate status | Question |
|---|---|---|---|---|
| condition | T | single: OPEN. multi: route (§6.4) | INCLUDED | — |
| condition | F | all CLOSED | GATED_OUT | — |
| condition | U, askable, `on_unresolved: ask` | all PENDING | PENDING_QUESTION | one per DatumRef |
| condition | U, otherwise | `skip`: all CLOSED. `traverse` (single arm only, V5): OPEN, flagged `opened_by_default` | GATED_OUT / INCLUDED | — |
| question | no answer | all PENDING | PENDING_QUESTION | the gate's own |
| question | answered | single: BOOLEAN true → OPEN, false → CLOSED; NUMERIC/SELECT any value → OPEN (DS06:347, unchanged). multi: route | INCLUDED / GATED_OUT | — |
| prior_result | every dependency matches | OPEN | INCLUDED | — |
| prior_result | a dependency definitely mismatches | CLOSED (`default_behavior` does not apply to a definite mismatch) | GATED_OUT | — |
| prior_result | no mismatch, some dependency PENDING | all PENDING | PENDING_QUESTION | none of its own (`awaiting`) |
| llm | answered | route the answer | INCLUDED | — |
| llm | observation ≥ threshold | route `chosenBranch` | INCLUDED | — |
| llm | observation below threshold, or UNAVAILABLE | safe-default arm OPEN, others CLOSED | INCLUDED, `tentative` | tentative SELECT (EP D3, DS06:266, unchanged) |

Changes from today, each listed in §10.1:
- **A definite F always closes** (§11.2 Q4). Today `default_behavior: traverse` also applies to a definite
  false (`TE:874-907`). DS W2 says `default_behavior` governs "indeterminate"; it now does exactly that.
  The live `gate-oral-iron-response` keeps its outcome: its insufficient series becomes
  `U: insufficient_series` (non-askable) → `traverse` → OPEN, as today.
- **A pending dependency pends** instead of reading as "no" (D-15 in discovery B).
- An answered LLM gate makes no model call.

### 6.3 Choice (DecisionPoint) outcome

Qualification is unchanged: an arm qualifies when its target's confidence ≥ `suggestThreshold`.
`SELECTS_BRANCH` stays display/lineage only (DS05 #5).

| Mode | State | Arms | Choice status | Question |
|---|---|---|---|---|
| one_of | valid stored choice | chosen OPEN, others CLOSED (not selected) | INCLUDED | — |
| one_of | stale choice, alternatives exist | qualifiers PENDING, others CLOSED | PENDING_QUESTION | re-pend |
| one_of | stale choice, no alternative; or 0 qualifiers | all CLOSED | INCLUDED + red flag `all_branches_excluded` | — |
| one_of | 1 qualifier | it OPEN, others CLOSED | INCLUDED | — |
| one_of | ≥ 2 qualifiers | qualifiers PENDING, others CLOSED | PENDING_QUESTION | SELECT over qualifiers |
| all_of | — | all OPEN; weak arms red-flagged `all_of_branch_unsupported` | INCLUDED | — |
| any_of | — | qualifiers OPEN, others CLOSED | INCLUDED | — |

A choice's arm states govern its **arm targets only**. Its non-arm children (hosted gates, criteria) are
`contains`/`annotates` children and follow the choice's *activation*, not its decision. So
`gate-iron-deficient` is evaluated while `dp-1` is pending (fixes I-8). A choice with no arms (4 of 6 in
chronic-htn) is display-only, as today.

`all_of` "mandates" today only reach the arm target (`branch-mode.test.ts:351`), and arm targets are
always containers, which have no threshold. The mandate therefore has no effect on real graphs and is
removed; the red flag stays.

### 6.4 Routing a multi-arm gate

Unchanged from DS06: the decision value (answer, else observation) selects the arm whose `when`
matches. Exactly one match → that arm OPEN, the others CLOSED (not selected). Zero or several → all CLOSED
plus red flag `unroutable_decision`. Because V5 requires a total `when` mapping, and multi-arm routing on a
condition gate is already rejected at import (`branch-routing-validation.test.ts:188`), zero or several
matches cannot occur in a compiled model; the red flag stays as a defensive check.

### 6.5 Action outcome

| Activation | Override | Result |
|---|---|---|
| any | INCLUDE / EXCLUDE | as overridden, `decidedBy: 'override'` |
| ACTIVE | none | `INCLUDED` if confidence ≥ `suggestThreshold`, else `EXCLUDED` (unchanged) |
| PENDING | none | `PENDING_QUESTION` |
| INACTIVE | none | inactive status (§3.4) |

`critical: true` with zero data-completeness still raises `missing_critical_data` (unchanged).

### 6.6 What is intentionally not a boolean

`Truth` keeps `U` with a reason; gates keep PENDING distinct from GATED_OUT; activation keeps PENDING
distinct from INACTIVE; tentative LLM routing keeps its `tentative` flag and question. Nothing unknown is
ever rendered as a clinical false, except where the author chose `default_behavior: skip` for a
non-askable unknown.

---

## 7. Results and downstream stages

### 7.1 Node result

EP C2's two layers are unchanged. The interpreter adds what it now knows explicitly:

```ts
interface NodeResult {
  nodeId: NodeId; nodeType: string; kind: CompiledKind;
  activation: { state: 'ACTIVE' | 'PENDING' | 'INACTIVE'; causes?: Cause[] };   // new
  arms?: Record<ArmId, 'OPEN' | 'CLOSED' | 'PENDING'>;                           // new: gates and choices
  truth?: Truth;                                                                  // new: condition gates (§5.2)
  eligibility: { status: NodeStatus; reasonCode: ReasonCode; reason?: string; decidedBy: 'pathway' | 'override' };
  disposition: { status: NodeStatus; withheldBy?: 'safety' | 'conflict'; findingIds?: string[]; reason?: string }; // EP C2
  confidence?: number;
  tentative?: boolean;
  status: NodeStatus;          // = disposition.status (public API unchanged)
  excludeReason?: string;      // = disposition.reason ?? eligibility.reason
}

interface Interpretation {
  results: ReadonlyMap<NodeId, NodeResult>;
  pendingQuestions: PendingQuestion[];   // collected from results: one per gate/choice, one per DatumRef
  redFlags: RedFlag[];                   // collected from results
  observationsUsed: string[];
}
```

`reasonCode` is a closed enum (`GATE_CLOSED`, `ARM_NOT_SELECTED`, `BELOW_SUGGEST_THRESHOLD`,
`OPENED_BY_DEFAULT`, `AWAITING_ANSWER`, `OVERRIDE`, …). `reason` is rendered text for display only.

Evaluators return outcomes for **their own node**: status, arm states, a question, red flags. They never
write another node, never enqueue anything and never read a node they did not declare.

### 7.2 Scoring

Unchanged as a stage: it runs once before interpretation (`pipeline/evaluate.ts:47-54`), and the
interpreter reads scores only in §6.3 (arm qualification) and §6.5 (action inclusion). One change: the
scoring engine's topological sort runs over the compiled `contains ∪ guards` graph instead of all edges.
`REQUIRES` and `CITES_EVIDENCE` no longer form cycles, so propagation runs for every pathway (today it is
silently off for GHTN; discovery D §1.2). This changes GHTN confidences and is listed as C9.

### 7.3 Findings

Catch-up items use the `prerequisite` edges of ACTIVE containers, as today (`pipeline/findings.ts`).
`gateContextFields` come from the condition IR's datums instead of the dependency map.

### 7.4 Safety and disposition

Unchanged (EP C2, C3, D4, D14). Candidates are INCLUDED `action` nodes of type Medication; `constraint`
nodes are never candidates.

### 7.5 Readiness and hashing

Readiness reads the interpretation:

| Blocker | Source |
|---|---|
| `PENDING_GATE` | every pending question. They come from ACTIVE gates and choices only, deduplicated by construction, so the I-5 duplicates cannot occur |
| `UNRESOLVED_RED_FLAG` | every red flag (acknowledgement still deferred, EP) |
| `SAFETY_DATA_UNAVAILABLE` | unchanged (EP D14) |
| `EMPTY_PLAN` (root) | no `action` node whose disposition is INCLUDED (EP C2). `constraint`, `item` and `annotation` nodes do not count |

`resultHash` covers, per node, `{nodeId, eligibility.status, eligibility.reasonCode, disposition.status,
withheldBy, decidedBy}`, plus questions without tentative fields, red flags as `{type, nodeId, armIds}`,
safety findings without `meta`, catch-up items and blockers without descriptions. Rendered text and
confidence numbers are excluded. Today they leak in through `excludeReason` ("Confidence 0.42 below…")
and red-flag branch confidences, violating EP's own rule 8 [discovery D §5]. So a configuration change
that moves a number without changing any status no longer forces `PLAN_CHANGED_SINCE_REVIEW` (C14).

### 7.6 Multi-pathway composition, and what this spec does not fix

Each child is interpreted at `CONTRIBUTION` scope under the run's one snapshot. `composeRun` is unchanged.

Discovery found downstream defects that are root cause 4 (plan assembly), not the interpreter. They need
their own spec and are recorded here so they are not lost:

- **Conflicts fire inside one pathway.** They are grouped by `clinical_role` with no cross-pathway requirement
  (`care-plan-merge.ts:584-629`), and `CONFIRM_PATHWAY` keeps every same-pathway candidate
  (`compose.ts:261-268`). Live: anemia oral/IV iron; preeclampsia labetalol/nifedipine.
- **The role comes from the group's first member** (`care-plan-merge.ts:603`), and withholding compares each
  proposer's own role (`compose.ts:171`).
- **The run materialization drops sections and fields,** and the two paths use different action-type sets
  and `EMPTY_PLAN` definitions.
- **An empty safety reference or an uncheckable allergy is not surfaced.**
- **Scorers have private patient semantics.** For example, "already taking the drug" scores as match
  (`patient-match-quality.ts:90-104`).
- **Catch-up has its own code matcher** that ignores the result and `lookback_days`.

The `constraint` kind (V10) is the only part of this taken here. It is a classification the compiler
must make anyway, and it stops the single-path generator writing a contraindicated drug as an order.

---

## 8. Persistence and API boundaries

**Unchanged:**
- tables and columns;
- revision compare-and-set and retries;
- transaction boundaries;
- observation persistence and audits;
- generation and its reviewed-hash check;
- events;
- `composeRun`;
- the GraphQL schema types the admin selects.

The interpreter replaces `TraversalEngine` behind `evaluate()`. Nothing above `pipeline/` calls the
engine directly (discovery A §0).

| Change | Where | Why |
|---|---|---|
| `resolution_state` values gain `activation`, `arms`, `truth`, `eligibility.reasonCode` | JSONB, no migration | §7.1 |
| `additional_context` gains `providerAssertions` | JSONB, no migration | §5.3 |
| `answerChange` writes a provider assertion by `DatumRef` for escalated data questions | `resolvers/mutations/resolution.ts:193-217` | replaces the lab/vital/attribute fragments (F-2, F-4) |
| `overrideNode` rejects nodes whose kind is not `action` (`BAD_USER_INPUT`) | `resolution.ts:249` | Q3. The admin never calls `overrideNode` (discovery A §4.1) |
| `activatePathway` / `reactivatePathway` compile the stored graph and refuse on errors | `resolvers/mutations/import.ts` | closes the activation gap |
| Start mutations refuse a pathway that does not compile, with new code `PATHWAY_NOT_EVALUABLE` and the compile errors | `resolution.ts:379`, `multi-pathway-resolution.ts:142` | a silent partial result becomes an explicit refusal |
| `loadEvaluationEnv` reads the attribute code map inside the snapshot and compiles | `pipeline/load-env.ts`, `attribute-code-map.ts` | EP C4, which the process-wide cache violates today |
| `datumKey` values become DatumRef keys | pending questions | the admin passes `datumKey` through; the plan must confirm it is not parsed |

**Stored sessions.** Live has 16 session rows under 3 preview runs, 0 overrides and 0 care plans [live].
Under EP's "no users" constraint (EP D8) they are purged at deploy. No compatibility code is written.

**Client behaviour** (admin, no code change required):
- gated steps and unchosen arms now show as GATED_OUT or EXCLUDED;
- the arms of a pending choice show PENDING, not INCLUDED;
- no duplicate questions;
- a missing trimester is now asked for;
- previewing a draft that does not compile shows the compile errors. Today that affects anemia 1.1–1.3
  (legacy dialect) and GHTN (multi-arm gates without `when`).

**No clinical logic moves into resolvers or clients.** Resolvers keep boundary validation only (the answer is
of the right type for the question), as EP §4 specifies.

---

## 9. Worked examples

Each example states the compiled order, the intermediate results in that order, and why no other order
could differ. The general argument is in §3.4 and §4.1: every node is computed once, from parents that are
already final, by commutative joins. So any topological order gives the same map, and the compiler's order
is only one of them.

### 9.1 A dependency on a node its guard never opens

Synthetic graph: the `eager-reachability.test.ts` shape.

```
root ─contains→ stage-a ─contains→ gate-closed (condition: conditions includes ICD-10 D50.9) ─guards→ step-hidden ─contains→ med-hidden
                        ─contains→ gate-dep (prior_result: step-hidden INCLUDED, skip)        ─guards→ step-dep    ─contains→ med-dep
Patient: no D50.9.
```

`data` edge: `step-hidden → gate-dep`. The order is `root, stage-a, gate-closed, step-hidden, med-hidden,
gate-dep, step-dep, med-dep`. `gate-dep` cannot precede `step-hidden`, whatever nodeIds or edge order.

| Node | Activation | Outcome |
|---|---|---|
| gate-closed | ACTIVE | membership F (no code) → arm CLOSED → GATED_OUT |
| step-hidden | no container; its only guard is CLOSED → INACTIVE, cause gate-closed | GATED_OUT |
| med-hidden | container INACTIVE | GATED_OUT |
| gate-dep | ACTIVE | reads `step-hidden` = GATED_OUT ≠ INCLUDED → definite mismatch → arm CLOSED → GATED_OUT |
| step-dep, med-dep | INACTIVE | GATED_OUT |

**Today:** with `gate-dep` listed first, the eager path disposes `step-hidden` in isolation (INCLUDED),
`gate-dep` opens, and `med-dep` is INCLUDED while `step-hidden` ends GATED_OUT. With `gate-closed` first,
`med-dep` is GATED_OUT [probe 2].

### 9.2 A closed ancestor, with and without an override (live anemia 1.4)

Patient: Hb 9.4 (dated), trimester 2, ferritin 80.

| Node | Activation | Outcome |
|---|---|---|
| stage-3 | ACTIVE | INCLUDED |
| gate-severe-anemia (host stage-3) | ACTIVE | compare `lab:LOINC:718-7 < 7` → 9.4 → F → arm CLOSED → GATED_OUT |
| step-3-3 "Blood transfusion" | all(any(C={stage-3 ACTIVE}), any(G={CLOSED})) = INACTIVE, cause gate-severe-anemia | GATED_OUT |
| proc-1 (PRBC transfusion) | container INACTIVE | GATED_OUT |

**Provider overrides `proc-1` INCLUDE:** `proc-1` becomes INCLUDED, `decidedBy: 'override'`, and its
`activation` still records `INACTIVE, cause gate-severe-anemia (9.4 ≥ 7)`. The explanation shows both: the
provider included it, and the pathway would not have. It is not a Medication, so safety does not apply.

**Provider tries to override `gate-severe-anemia` INCLUDE:** refused at the mutation
(`BAD_USER_INPUT`: "overrides apply to actions; answer the gate's question or add the missing fact
instead"). Today that override opens every arm [probe 3b].

**Today, without any override:** `step-3-3` and `proc-1` are INCLUDED, because the `HAS_STEP` arrival is
written before the gate's sweep [live, probe 1a].

### 9.3 A reconverging branch (live anemia 1.4, `step-3-1`)

`step-3-1` (oral iron; contains `med-1`, which has `alternative → med-2`) has three parents:
- `contains` from stage-3;
- an arm of `dp-1` (`one_of`, arms `step-2-3` | `step-3-1`);
- the arm of `gate-iron-deficient` (ferritin < 30), whose host is `dp-1`.

Assume both `dp-1` arms qualify on confidence, as in the live sessions.

| Scenario | dp-1 arms | gate-iron-deficient | step-3-1 = all(ACTIVE, any(dp arm, gate arm)) | med-1 |
|---|---|---|---|---|
| A. No choice, no ferritin | both PENDING (≥2 qualifiers) | ferritin missing → U askable → PENDING; asks `lab:LOINC:2276-4` | PENDING | PENDING |
| B. Chose `step-2-3`; ferritin 80 | `step-3-1` CLOSED (not selected) | F → CLOSED | INACTIVE → GATED_OUT (a gate cause is present) | GATED_OUT |
| C. Chose `step-2-3`; ferritin 20 | `step-3-1` CLOSED | T → OPEN | ACTIVE | by confidence |

In A, `gate-iron-deficient` is evaluated even though `dp-1` is pending. It is contained by `dp-1`, and
`dp-1` is ACTIVE; only its *decision* is pending. **Today** in A, `step-3-1`, `step-2-3` and `med-1` are
INCLUDED and `gate-iron-deficient` is absent from the result (I-1, I-8). In B, **today** `step-3-1` stays
INCLUDED against the provider's choice [live].

C is the case Q2 asks about. Under `any`, iron deficiency proven by ferritin 20 opens oral iron even
though the provider chose to evaluate other causes. Under `all`, the choice would win. §11.2 recommends
`any` for consistency with `step-2-2`, and asks the author to confirm for `step-3-1`.

The review #9 diamond (`q` routes `a`|`b`; `shared` is contained by both) comes out `shared` ACTIVE when
`a` is chosen, whichever arm is listed first. Today it is EXCLUDED when `b`'s sweep is written first
(`pipeline-sequence-vs-fresh.test.ts:242`).

### 9.4 A conflict choice followed by safety checking

Synthetic run. Pathway A proposes `Ferrous sulfate` (role `iron_repletion`). Pathway B proposes `Iron sucrose`
(same role) and `Levothyroxine`. The run's safety reference holds one MODERATE pair rule:
ferrous sulfate × levothyroxine.

1. **Interpretation, per child (CONTRIBUTION).** All three Medication nodes are ACTIVE and INCLUDED on
   eligibility. Patient-scope safety finds nothing. Conflict and pair safety are root concerns (EP C3),
   so nothing here depends on them.
2. **composeRun, no decision.** The role `iron_repletion` has two names → conflict →
   `UNRESOLVED_CONFLICT` (root, output). The run is not ready.
3. **Provider chooses `CONFIRM_PATHWAY A`.** This is an input change and the whole run is re-evaluated
   (EP D13). Interpretation is identical to step 1: **eligibility never depends on conflicts or safety**
   (EP C2). Selection keeps ferrous sulfate (`provider-confirmed`), and iron sucrose's node gets
   disposition `EXCLUDED, withheldBy: 'conflict'`.
4. **Pair safety over the final set** {ferrous sulfate, levothyroxine}: MODERATE → WARN, not suppress.
   It goes to `ddiWarnings`. Had the provider chosen B, the final set {iron sucrose, levothyroxine}
   would produce no finding. Safety always runs after selection, so it only ever judges the set that will
   be generated.
5. **Hash.** The run hash covers the decision and the warning, so the reviewed plan is exactly what
   generation will write (EP D7).

Order cannot matter. Interpretation does not read the conflict decision, and composition is a function
of all children's results plus the decisions (`composeRun` rebuilds selection from the base merge every
time, `compose.ts:232-285`).

### 9.5 A missing demographic in a compound gate (live anemia 1.4)

Patient: Hb 9.4, no trimester. `gate-anemia-t2 = AND(attribute:trimester equals 2, lab:LOINC:718-7 < 10.5)`.

- `trimester` → `U{missing, datum attribute:trimester, askable}`. Hb → T. AND(U, T) = U, askable → gate
  PENDING, and one question for `attribute:trimester`. `gate-anemia-t1t3` asks for the same datum, and the
  question is deduplicated.
- `step-2-2` = all(ACTIVE, any(PENDING, PENDING)) = PENDING.
- The provider answers 2: `t1t3` F → CLOSED, `t2` T → OPEN, so `step-2-2` is ACTIVE.

**Today:** the missing trimester is a silent definite F, both gates are GATED_OUT, and nothing is asked
(F-1). Because of I-1, `step-2-2` is INCLUDED anyway.

### 9.6 Correcting an answer

The provider answers Hb = 7 (meant 17), then 17. The ledger holds assertions `seq 1: 7` and `seq 2: 17`.
`scalar(lab:LOINC:718-7)` returns 17 (rule 1, §5.4). Every gate reading Hb re-evaluates with 17.

**Today:** the second answer has the same dedup key and is dropped, while the event log records 17 (F-4).

---

## 10. Migration and validation

### 10.1 Behaviour changes (the approved correction classes)

Every difference between the current engine and the new interpreter must fall into one of these classes.
The differential harness (§10.2) classifies each difference automatically, and an unclassified difference
fails the phase.

| Class | Change | Fixes | Live effect |
|---|---|---|---|
| C1 | Guards decide applicability; containment decides location (§3.4) | I-1 | anemia 1.4: `step-2-2`, `step-3-1`, `step-3-3`, `step-4-3` and their actions follow their gates/choice |
| C2 | Order independence: single pass, final inputs only | I-2, I-4, I-5, I-6, I-11 | review #9 diamond resolves by the join |
| C3 | Overrides only on `action` nodes | I-3, I-9 | none (0 live overrides) |
| C4 | `default_behavior` applies only to unknown; a definite false closes (Q4) | review finding F10 | none on live graphs (`gate-oral-iron-response` unchanged, §6.2) |
| C5 | Missing `patient.*` / unmapped attribute is unknown, not false; one condition evaluator (Q5, Q9) | F-1 | anemia sparse charts ask for trimester |
| C6 | Provider assertions are decisive for their datum; corrections apply (Q6) | F-3, F-4, F-5 | live sessions pending on Hb resolve on one answer |
| C7 | One datum identity for questions and answers | F-2, F-6 | none on live graphs (no vitals; one form per datum) |
| C8 | `ESCALATES_TO` is not traversed (Q7) | I-12 | chronic-htn (DRAFT): methyldopa/hydralazine no longer auto-included; anemia `med-2` still reached via `step-3-2` |
| C9 | `REQUIRES` is not traversed; scoring propagates over `contains ∪ guards` | I-13 | GHTN (DRAFT) confidences change |
| C10 | Invalid graphs are refused at compile, not evaluated to a silent false | F-7, F-8, I-7, I-10 | anemia 1.1–1.3 and GHTN (DRAFTs) cannot be previewed until fixed |
| C11 | A pending choice keeps its non-arm children | I-8 | `gate-iron-deficient`, `crit-1a/1b` appear while `dp-1` pends |
| C12 | A pending dependency pends | discovery B D-15 | none (no live `depends_on`) |
| C13 | No model call for an answered LLM gate; an observation budget replaces the traversal timeout | discovery C §5 | none (no live LLM gates) |
| C14 | `resultHash` excludes confidence numbers and rendered text | EP rule 8 | fewer spurious `PLAN_CHANGED_SINCE_REVIEW` |
| C15 | `constraint` kind: contraindicated/avoid medications are not candidates, not counted for `EMPTY_PLAN`, not written | discovery D #4 | GHTN (DRAFT) `med-6` |
| C16 | `all_of` mandate removed (it only reached containers) | — | none |
| C17 | `legacy-v0` removed (Q9) | — | none (all 16 live sessions are `v1`) |

### 10.2 Differential harness

The harness runs the current pipeline and the new one over the same corpus and compares
`eligibility.status` per node, plus the pending-question sets.

**Corpus:**
- every stored graph: anemia 1.0–1.7, chronic-htn, GHTN, and the archived pathways, which are compiled
  where possible and otherwise reported;
- the synthetic graphs written during discovery (`graphs/syn-*`, the probe shapes);
- the existing test fixtures;
- patients from three sources: the fixture patients, the 16 recorded live session inputs, and generated
  patients (fast-check over the datums each graph reads, including missing, undated and conflicting
  values).

**Classification:** each difference is tested against a detector per class. For example, a C1 difference is
one where the node has a closed guard and an active container. The report lists counts per class and every
unclassified difference in full. It is reviewed at each phase gate. The harness is a test utility that is
deleted with the old engine in phase 3.

### 10.3 Properties and invariants

Tests are added with fast-check, over generated graphs (diamonds, multi-guard nodes, nested gates,
dependencies, choices of every mode) and generated patients.

- **P1 — permutation invariance.** Shuffle the authored node array and edge array → the canonical result
  and `resultHash` are identical. Today's properties only permute input *Maps*
  (`pipeline-properties.test.ts`), which cannot detect I-1, I-2 or I-4.
- **P2 — sequence equals fresh.** The existing property, with its edit alphabet extended by corrections and
  provider assertions.
- **P3 — semantic invariants** on every result:
  1. a node is INCLUDED without an override ⇒ its activation is ACTIVE;
  2. activation ACTIVE ⇒ some container is ACTIVE (or none exist), and some guard is OPEN (or none exist);
  3. every pending question comes from an ACTIVE gate or choice, and there is at most one per DatumRef;
  4. a `one_of` choice has at most one OPEN arm;
  5. every compiled node has exactly one result;
  6. **round trip:** answering any askable question with a valid value removes that question on the next
     evaluation.
- **Rewritten pinned tests:** the tests that pin defects assert the corrected behaviour instead —
  `pipeline-sequence-vs-fresh.test.ts` #9/#10, `pipeline-traversal-overrides.test.ts:37-48`,
  `eager-reachability.test.ts:108`. New tests cover an override on a gate or choice (refused),
  multi-parent `contains` + `guards` nodes, and `ESCALATES_TO`/`REQUIRES` not traversed.

A before/after diff cannot find a defect that is present in both (§1.2). P3 is what would have caught
the transfusion step, so the release capture (phase 5) checks P3 on the live result as well as the diff.

### 10.4 Performance

The EP mutation gate (`__tests__/evaluation-mutation-gate.test.ts`, both passes) must pass on a migrated,
backfilled scratch copy of live, with p95 budgets of single < 2 s and run < 5 s. The stage benchmark stays
as a diagnostic.

### 10.5 Phases

Each phase merges with the suite green (the 9 known scorer failures excepted, as in every EP plan).

| Phase | Scope | Acceptance |
|---|---|---|
| 1. Compiler | `CompiledPathway`, V1–V10, DatumRef resolution. Wired into import (report), activation/reactivation (enforce) and `loadEvaluationEnv` (compile + cache; code map read in the snapshot). The runtime still uses `TraversalEngine`. | Every stored graph compiles or has listed errors; activating a legacy-dialect draft is refused; code-map change visible without restart; compile time recorded |
| 2. Facts and conditions | Fact ledger, `FactAccess`, condition IR, one evaluator; `legacy-v0` removed; questions keyed by DatumRef; `answerChange` writes assertions. Wired into the *existing* engine's gate evaluation. | F-1…F-9 tests RED→GREEN; differential shows only C5, C6, C7, C17 |
| 3. Interpreter | Scheduler, activation join, gate/choice/action evaluators; `TraversalEngine` deleted. | Differential shows only §10.1 classes; P1–P3 green; perf gate |
| 4. Boundaries | Override restriction, `PATHWAY_NOT_EVALUABLE`, hash change (C14), `constraint` kind (C15), scoring graph (C9), observation budget (C13). | EP suites green with updated expectations; admin flows exercised against a local stack |
| 5. Release | Rehearsal on a full copy of live; purge preview sessions; deploy per the runbook; before/after capture **plus P3 on the live result**. | P3 holds on live; every before/after difference is in §10.1 |

Phases 1 and 2 are independently useful. Phase 1 alone closes the activation gap and the code-map snapshot
hole.

### 10.6 Code removed or replaced

| Removed | Replaced by |
|---|---|
| `services/resolution/traversal-engine.ts` (all 1345 lines: BFS queue, `markSubtree`, `markBranchNotSelected`, `evaluateNodeEagerly`, held-override arrival, timeout stamping, cycle stack) | `interpreter/scheduler.ts`, `interpreter/activation.ts`, `interpreter/evaluators/{gate,choice,action}.ts` |
| Legacy condition evaluator in `gate-evaluator.ts` (`evaluateConditionLegacy`, `getNumericValue`, `getCodeEntries`, `collectLabSeries`, `isWithinWindow`), `evaluateConditionLegacyAdapted`, the `CONDITION_EVALUATORS` mode table | condition IR evaluator over `FactAccess` (the kernel modules in `temporal/` stay) |
| `attribute-registry.ts:resolveAttribute`; the `condition-adapter.ts` null fallback | DatumRef resolution at compile |
| Dedup merge in `effective-context.ts` | fact ledger |
| `unresolved-prompt.ts:askFor` | askability from `UnknownReason` + DatumRef |
| `resolution-context.ts:sweepableConditions` / `assertEncounterAnchor` session-start sweep | compile (V9) |
| Process-wide cache in `attribute-code-map.ts` | snapshot read |
| Tests `eager-reachability`, `eager-disposition-parity`, the legacy gate-evaluator suites, `gate-evaluator-version-seam` | P1–P3 and interpreter unit tests |

What stays: `pipeline/*` except `evaluate.ts`'s traversal call, `temporal/select-facts`, `overlap`,
`cascade`, `interval`, `observations.ts`, `safety*`, `compose.ts`, persistence, resolvers (with the §8
changes).

---

## 11. Alternatives and unresolved decisions

### 11.1 Alternatives considered

**A. A smaller refactor of the existing interpreter.** Patch the BFS:
1. don't enqueue a `contains` child that has `BRANCHES_TO` parents;
2. re-run `prior_node_result` gates in a second pass;
3. refuse overrides on gates and choices;
4. add missing-data signals to the legacy `patient.*` path;
5. fix the vital key;
6. add assertion precedence.

- *For:* smaller diff now. Items 1 and 3 could ship within days as a stopgap for the live transfusion
  step.
- *Against:* the 17 writers and first-writer-wins stay, so each patch interacts with visit order:
  - with (1), a gated step's status depends on its gate's sweep reaching it before any other arrival;
  - a pending choice still drops its children;
  - eager side effects still leak;
  - order independence remains something tests sample rather than something the structure guarantees.

  EP's own history is the argument: "Each round's fix was correct and each round found new instances,
  because the structure keeps producing them."
- *Recommendation:* ship A.1 and A.3 as a **stopgap** only if the live anemia pathway must be corrected
  before phase 3 lands (a product decision); otherwise go straight to the design.

**B. A generic dataflow/workflow engine or plugin registry.** There are three evaluator kinds with closed
vocabularies. A registry adds indirection and keeps the coupling (evaluators would still need to know
about each other's sweeps). Rejected.

**C. A fixpoint / Datalog-style solver.** Only needed for cyclic dependencies, which V3 rejects and the
corpus does not contain. Rejected.

**D. Persist the compiled model at import.** It is derived, cheap, and would need versioning and
invalidation when the compiler or code map changes. Compiling in the snapshot with an in-process cache
gives the same benefit. Rejected.

**E. Leave `legacy-v0` in place (DS kept it as a fixture).** It is the second evaluator that makes
"missing" mean two things, it has no live user, and removing it removes the version dispatch. Recommended
to remove (Q9).

### 11.2 Decisions required

The recommended option is first. "Clinical" means it changes what a patient's plan contains and needs
clinical sign-off. "Product" means it changes what an author or provider can do.

| # | Decision | Recommendation and evidence | If decided the other way |
|---|---|---|---|
| **Q1** (clinical) | When a node has a container and a guard, which decides whether it applies? | **The guard** (§3.4). Every gated step in the only ACTIVE pathway is also stage-contained; the author evidently meant the gate to decide (why else draw it?). | Keep containment winning: gates on stage-contained steps are decorative, and the transfusion step stays in every plan. |
| **Q2** (clinical) | Several guards on one node combine as… | **any** (one open guard suffices). `step-2-2` (trimester-specific Hb thresholds) needs `any`. `step-3-1` (dp-1 arm + iron-deficiency gate) is the case to confirm: under `any`, proven iron deficiency opens oral iron even if the provider chose "other causes" (§10.3 C). | `all`: `step-2-2` becomes unreachable for everyone. A per-node `guard_join` authoring property would be needed; not proposed unless `step-3-1` requires it. |
| **Q3** (product) | Where can a provider override? | **Action nodes only.** To change a gate's outcome, answer it or add the fact. The admin never calls `overrideNode`; there are 0 live overrides. | Allow gate/choice overrides: they must then mean "force this arm" and need an arm parameter; override × `when` × `one_of` semantics would have to be specified. |
| **Q4** (clinical) | Does `default_behavior: traverse` apply to a definite "no"? | **No — only to unknown.** DS W2 defines `default_behavior` for the indeterminate case; a definite false is an answer. No live graph changes. | Keep: a question answered "No" on a `traverse` gate opens its subtree (review F10). |
| **Q5** (clinical) | A missing `patient.*` attribute is… | **Unknown, and asked for** (numeric/boolean). Today it is a silent "no", which suppresses the haemoglobin question in the ACTIVE pathway's compound gates. | Keep silent false: sparse charts continue to skip the anemia work-up. |
| **Q6** (clinical) | Does a provider's answer override chart values for that datum? | **Yes — the latest assertion is the value** (§5.4). The clinician is asserting the current value; otherwise some questions can never be resolved and corrections are dropped. | Treat answers as ordinary dated facts: F-3/F-4/F-5 remain, and those questions need another resolution path. |
| **Q7** (clinical) | What does `ESCALATES_TO` mean? | **"Alternative if the first-line is unsuitable" — never auto-included.** Recorded on the result for display. Automatic substitution (for example when first-line is withheld by safety) is a follow-up. | Keep traversing: second-line drugs are proposed alongside first-line whenever first-line is reached. |
| **Q8** (clinical, **outside this spec**) | Should confidence decide whether an action is included, and with which patient semantics? | Not changed here. But note: scorers rate a drug the patient is *not already taking* at 0 on match quality, so all four anemia medications are EXCLUDED at 0.30–0.45 in every live session. As scored, the active pathway can never recommend a new medication. | — (needs its own decision; blocks nothing here) |
| **Q9** (product) | Remove `legacy-v0`? | **Yes** (§11.1 E). | Keep: the condition IR needs a legacy adapter and the two "missing" semantics survive for that version. |
| **Q10** (product) | Drafts that do not compile (anemia 1.1–1.3 legacy dialect; GHTN multi-arm gates without `when`) | **Refuse preview and activation until re-authored**; archive 1.1–1.3 (1.4–1.7 supersede them). | Keep evaluating them: every legacy condition is a silent false. |
| **Q11** (clinical, confirm) | A tentative LLM verdict opens its safe-default arm while the question is pending | **Keep** (EP D3, DS06:266). Readiness blocks until confirmed. | Pend the whole gate instead: nothing downstream shows until confirmed. |
| **Q12** (confirm) | `SELECTS_BRANCH` stays display-only | **Keep** (DS05 #5). The DS W3 text promising criterion routing was narrowed by DS05. | Criterion evaluation is a separate feature. |

### 11.3 Blockers to implementation

- **Q1, Q2 (with the `step-3-1` confirmation), Q4, Q5, Q6, Q7** need clinical sign-off before phase 3
  (Q5/Q6 before phase 2).
- **Q3, Q9, Q10** are product decisions and can be decided now.
- **Q8** does not block this design. But until it is decided, the corrected interpreter will still produce
  anemia plans without medications, so it should be scheduled next.
- **Stopgap (§11.1 A):** decide whether the live transfusion/oral-iron inclusion is corrected before
  phase 3.
