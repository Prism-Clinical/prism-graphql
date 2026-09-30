# RFC: One typed, declarative language for Prism clinical pathways

**Status:** Proposed for review; not an approved implementation specification or a clinical validation claim.

**Date:** 2026-09-28

**Last revised:** 2026-09-30 — fresh-start deployment, optional existing-content design fixtures, and acceptance of authored pathways through compilation, clinical validation, and evaluation; no production continuity or legacy-data migration requirement.

**Target branch:** `docs/pathway-language-direction`

**Implementation baseline inspected:** `b2f81f588cc3c465dd5779551d9e2cbdbaa75cc7`

**Working name:** Prism Pathway Language (PPL); the name is not a compatibility commitment.

## 1. Decision requested

Adopt a single, statically typed, declarative pathway language with:

1. **CQL-inspired clinical expressions:** quantities, terminology, temporal selection, and reusable typed expressions.
2. **Restricted Datalog-inspired relationships:** explicit dependencies and rules that derive conclusions from facts, without author-controlled execution order.
3. **Prism node and relationship contracts:** clinical evidence, predicates, recommendations, choices, data needs, provenance, and review requirements.
4. **One canonical source model, one typed intermediate representation (IR), and one evaluator.** The graphical editor and a future textual editor author the same language. They do not have separate semantics.
5. **Fixed, public language semantics.** Institutions configure approved clinical content, bounded parameters, acquisition workflows, and governance. They do not supply interpreters or redefine the meaning of missing evidence, conjunction, exclusion, or a relationship.

Implement an intentionally small reference evaluator over an acyclic dependency model first. Do not require a Soufflé runtime, a full CQL runtime, general recursive inference, or a solver on the runtime path. Use focused symbolic analysis for a supported compile-time fragment as it becomes justified.

This is a replacement for implicit evaluator behavior, not another policy layer over the existing traversal engine. The goal is to make the meaning of a pathway visible, checkable, executable, and explainable from the same definitions.

## 2. Context and relationship to prior direction

The [initial direction record](../records/pathway-language/2026-09-28-direction.md) establishes the need for explicit node/relationship meaning, determinism, pinned versions, data needs, and verification. Subsequent discussion retained those goals while rejecting institution-specific interpreter semantics.

This RFC proposes the following changes to that record. The original remains a historical record; this RFC is the recommended successor, pending acceptance.

| Earlier direction | Recommendation here |
|---|---|
| Institutions own semantics profiles | One language semantics; institutions own approved content and bounded workflow/governance policy |
| Every relationship must change its target's outcome for some patient | Obligations depend on relationship kind; executable influence analysis is distinct from provenance and display relationships |
| Solver-backed checking as a broad compiler foundation | Mandatory structural/type/dependency checks first; explicitly bounded symbolic checks with inconclusive results |
| Confidence becomes an institutional semantic option | Confidence cannot implicitly determine clinical eligibility; explicit predicates and independent evidence assessments replace that behavior |
| Begin in a new repository | Begin with a separate internal package and stable public boundary; extract only when ownership or real consumers justify it |
| Governance is a later sub-project | Define authority, publication states, provenance, and review contracts with the language; enforce them before clinical release |

The replacement need not wait for a broad cleanup of the evaluator it retires. Known defects and awkward cases should become requirements and acceptance examples for the replacement. Release controls, authenticated authority, and validated EHR integration remain necessary before clinical use, but are not prerequisites to writing the language and reference evaluator.

### 2.1 What exists today

The current [compiler](../../../apps/pathway-service/src/services/compiler/compile.ts) validates a pathway and builds an immutable model. Its [kind catalogue](../../../apps/pathway-service/src/services/compiler/kinds.ts) and [model](../../../apps/pathway-service/src/services/compiler/model.ts) are useful design references, not a final language definition.

The [evaluation environment](../../../apps/pathway-service/src/services/resolution/pipeline/load-env.ts) attaches compilation while the [evaluation pipeline](../../../apps/pathway-service/src/services/resolution/pipeline/evaluate.ts) still executes `TraversalEngine`. The replacement must close that gap: the accepted compiled representation becomes the only executable meaning for a newly published pathway.

Preserve the useful boundaries already present: explicit uncertainty, a pinned clock, immutable inputs, recorded external observations, shared evaluation, eligibility versus disposition, reviewed-result checks, and revision-controlled plan materialization. Reuse implementation only where it satisfies the new contracts.

The [recorded compiler corpus](../records/evaluation-interpreter/compiler-corpus.md) supplies optional design fixtures. It is not proof that their clinical content is correct or that all active production content has been reviewed under this RFC.

### 2.2 Review incorporated on 2026-09-29

This revision makes pathway applicability explicit; classifies Step content instead of converting every Step to guidance; corrects exclusion-first disposition labeling; separates clinical safety-policy ownership from interpreter enforcement; specifies query-level evidence precedence and setting-specific policy composition; defines progress across encounters; and bounds the initial implementation. It also names pinned design fixtures and makes the internal package boundary enforceable. The RFC remains proposed, not an implementation or clinical approval.

### 2.3 Fresh-start scope clarified on 2026-09-30

The project will start from a reset database. Pathway import/ingestion and patient-data intake redesign are outside this RFC’s scope. Production continuity, legacy-data preservation, and compatibility with old JSON/evaluator behavior are outside scope. Existing pathways are optional design examples; the acceptance target is authored pathway definitions validated against independently reviewed clinical scenarios. Correctness and lifecycle requirements apply to the new system from its launch onward.

## 3. Goals, non-goals, and invariants

### 3.1 Goals

- A reader can determine the meaning of a pathway without knowing traversal implementation details.
- Every node and connection has a type and a defined contribution to evaluation, workflow, provenance, or presentation.
- Invalid compositions are caught at authoring/publication time where possible.
- The same pinned semantic inputs produce the same decisions, needs, and canonical explanation records.
- Unknown, conflicting, unavailable, invalid, and negative evidence are not silently conflated.
- Clinical content can evolve without ordinary pathway changes requiring evaluator patches.
- Clinical reviewers can inspect expected behavior through scenarios and inspect actual decisions through evidence traces.
- Formal checks make bounded, accurately named claims; compiler success does not masquerade as clinical approval.

### 3.2 Non-goals for the initial release

- Full CQL, ELM, Datalog, or Soufflé source compatibility.
- Arbitrary institution-defined operators or interpreter plugins.
- General recursion, mutable graph execution, autonomous ordering/prescribing, or arbitrary code embedded in pathways.
- A universal theorem prover for clinical correctness or all conceivable patient states.
- Replacing GraphQL or the graph editor merely to introduce the language. A database reset is an accepted project assumption. Importing clinical documents or structured content into draft pathways, and redesigning patient-data intake, are outside scope. Existing patient-data adapters must satisfy the evidence contracts; this does not require replacing the intake pipeline.
- Preserving existing production records or sessions, uninterrupted service, backward compatibility with existing pathway JSON, or operating old and new evaluators together.
- A generic distributed workflow platform or arbitrary third-party fulfiller marketplace.

### 3.3 Language invariants

1. **Declared meaning:** all decision-affecting reads and dependencies are explicit in the IR.
2. **Pure evaluation:** external I/O, clocks, randomness, and persistent mutation are outside the core.
3. **Stable composition:** results do not depend on node, edge, fact, or collection insertion order. Ordered clinical series use declared ordering rules.
4. **Evidence preservation:** missing evidence is not false; lack of a safety finding is not proof of completed coverage.
5. **Typed comparison:** quantities require compatible dimensions and approved conversions; codes carry systems and relevant versions.
6. **No hidden compensation:** high confidence cannot compensate for a false prerequisite, an unresolved required check, or a known exclusion.
7. **Finite evaluation:** initial executable dependencies are acyclic, collections are bounded, and resource exhaustion returns an explicit failure, never a partial result labeled complete.
8. **Review integrity:** a change to the reviewed clinical artifact or its material basis requires renewed review before finalization.
9. **Version integrity:** a historical result is tied to retrievable content, engine, policy, evidence, and reference-data artifacts, not hashes alone.

## 4. Foundations: what to borrow and what to own

### 4.1 CQL contribution

Use CQL as a semantic reference for typed clinical expressions, quantities, terminology, intervals, precision-aware timing, and library definitions. CQL also has a canonical Expression Logical Model. Pin the comparison baseline to **CQL 1.5.3** for the initial compatibility analysis; this is an explicit reference version, not a claim that it is the latest release. See the [author's guide](https://cql.hl7.org/N1A/02-authorsguide.html) and [language semantics](https://cql.hl7.org/N1A/05-languagesemantics.html).

Do not embed opaque CQL strings in nodes. PPL expressions are parsed into PPL's typed expression tree, with source locations and dependencies visible to the same compiler as relationships. Do not claim CQL conformance or export lossless ELM until a separately tested mapping establishes it.

Maintain an operator ledger with: PPL signature, reference behavior, adopted behavior, intentional differences, failure/uncertainty behavior, numeric limits, and conformance cases. The richer evidence model in section 7 is an intentional difference from treating every unknown as a null value.

### 4.2 Datalog contribution

Borrow declarative derivation, typed relations, explicit rule dependencies, and set-oriented reasoning. Soufflé demonstrates these ideas and supports stratified negation and aggregation, with restrictions. Its extensions also illustrate why unrestricted arithmetic recursion is outside this RFC's initial fragment. See the [Soufflé tutorial](https://souffle-lang.github.io/tutorial).

PPL v1 uses **nonrecursive, acyclic derivation**. A missing clinical fact is never converted to clinical falsity by negation-as-failure. Negation is an explicit operation on a decision value. Closed-world checks are allowed for complete structural metadata, such as whether a declared port has a binding, and for evidence queries whose completeness contract is satisfied.

This does not require Soufflé binaries or Datalog syntax. It is a deliberate restriction of the relational approach.

### 4.3 Prism-owned contribution

Neither foundation decides how a recommendation combines indications, prerequisites, exclusions, choices, safety coverage, and review obligations. PPL owns that contract, including the evidence states and relationship catalogue below. Those semantics are versioned platform behavior. Institutions choose clinical definitions within them.

There is one language even if its compiler contains several passes. No pass may independently reinterpret the same clinical expression under a different truth model.

## 5. Language layers and authoring representation

### 5.1 Three declaration levels

1. **Language catalogue:** platform-maintained primitive types, operators, node contracts, relationship contracts, composition rules, and proof obligations. It is versioned and tested with the engine.
2. **Reusable clinical libraries:** typed functions and node templates composed only from supported primitives. Libraries cannot add an opcode, perform I/O, redefine truth tables, or replace a relationship reducer. Recursive templates and cyclic imports are rejected.
3. **Pathway instances:** nodes, relationships, parameters, terminology references, evidence citations, and publication metadata for a specific clinical package.

This permits reusable authored abstractions without giving every pathway its own interpreter. A genuinely new primitive requires a language-version change and conformance tests.

### 5.2 One canonical source model

Make a typed, versioned JSON AST the initial canonical source format. Expressions are structured trees, not executable strings. Include schema/language versions, stable node and edge identifiers, imports, parameter definitions, typed nodes/ports, relationships, source references, and metadata. Reject unknown executable properties rather than silently ignoring them.

The graph editor edits this AST. A textual syntax is a readable projection that parses into it; exact spelling is deferred to an authoring specification. Layout, colors, coordinates, and other presentation data live in a separate namespaced section and cannot affect execution.

Bindings written in textual expressions and connections drawn in the editor lower to the same canonical edges. A graphical edge plus an expression reference must not accidentally apply a predicate twice. Conflicting declarations for one binding are errors.

### 5.3 Example

The following is illustrative syntax, not an implemented grammar or a clinical recommendation. Parameters and codes belong to a separately reviewed protocol; no treatment threshold is prescribed here.

```text
pathway ExampleAssessment version "1.0" language "ppl-1" {
  parameter threshold : Quantity<MassConcentration>
  parameter lookback  : Duration
  applicability Protocol.inScope(patient_evidence)

  node measurement : Evidence<Quantity<MassConcentration>> {
    require concept Protocol.requiredMeasurement
    select latest_definite within lookback at evaluation_time
    require validity final_or_corrected
    normalize using Units.mass_concentration
  }

  node below_threshold : Predicate {
    evaluate measurement.value < threshold
  }

  node assessment_complete : Evidence<Boolean> {
    require attestation Protocol.assessmentChecklist
  }

  node exclusion : Predicate {
    evaluate Protocol.exclusion(patient_evidence)
  }

  node proposed_action : Recommendation {
    action Protocol.actionDefinition
    indicated_when below_threshold
    requires assessment_complete.value
    excluded_when exclusion
    review clinician_required
  }

  workflow measurement {
    acquire chart_then_provider
  }
}
```

`patient_evidence` in this example is a declared typed input. The library signature must enumerate the fields/queries it can read; it is not an escape hatch to arbitrary context. A provider response satisfies the measurement only if its units, timing, authority, and provenance satisfy the same evidence contract.

The `.value` notation illustrates a lifted evidence expression, not an unsafe unwrap: if the evidence is unresolved, the containing expression follows section 7. The source AST must preserve that distinction. A Boolean evidence output projects to the same Decision domain used by Predicate nodes.

## 6. Types and expression fragment

This section describes the intended language catalogue. Section 20.1 defines the smaller v0 implementation profile; listing a type or operation here does not authorize its execution before the corresponding capability and conformance cases exist.

| Type family | Initial contract |
|---|---|
| Boolean, integer, decimal, enum, string | No implicit string/number/boolean coercion; numeric representation is canonical and bounded |
| Quantity<dimension> | Value plus canonical unit, original quantity, conversion provenance, and dimension |
| Code, ValueSetRef | Code system and code identity; version/expansion pinned where applicable; display text is not identity |
| Instant, PartialDateTime, Duration, CalendarPeriod, Interval | Precision, timezone where required, and open/closed boundaries are explicit |
| Record, bounded list, set | Stable identities; explicit ordered versus unordered semantics; no silently truncated collections |
| Evidence<T> | Known value or unresolved evidence with typed causes and provenance |
| Decision | True, false, or unknown with dependency and explanation records |
| Need, ActionProposal, ChoiceSelection, ReviewRequirement | Typed outputs, not side effects |

### 6.1 Numeric and terminology requirements

Use a deterministic decimal/rational implementation with a published numeric capability profile; do not evaluate clinical quantities as unqualified JavaScript `number`s. The first implementation specification must fix precision, range, division/rounding behavior, conversion tables, and overflow behavior before the kernel is accepted. This RFC fixes the policy: comparisons do not silently round across a threshold, unsupported conversion is unresolved with a diagnostic, and overflow is an explicit evaluation error. Numeric capability versions are part of the release bundle.

Accept only approved dimension-preserving conversions. Do not infer equivalence from display strings or from identical code text in different systems. An unresolved terminology mapping is explicit. Code-set expansions are immutable inputs to evaluation; a live terminology lookup belongs to acquisition.

### 6.2 Initial operations

- Typed equality/ordering, Boolean composition, explicit case expressions, and enum membership.
- Quantity comparisons and a small approved arithmetic subset.
- Code/value-set membership with known mapping and coverage.
- Interval containment/overlap, explicit window construction, and definite temporal ordering.
- Bounded filtering, existence, count bounds, and definite-latest selection.
- Nonrecursive reusable expressions with declared signatures and reads.

Defer generic regular expressions, arbitrary joins exposed to authors, unbounded collection generation, nonlinear numeric solvers, and trend/regression operators until a concrete pathway requires a separately specified contract. Authoring validation and compilation must identify such unsupported constructs rather than approximate them.

Time is an input. Distinguish a 24-hour duration from a calendar day in a specified timezone. Partial dates represent uncertainty; they do not acquire invented midnight timestamps. A latest selection succeeds only when the winner is established by the declared time and correction policy. A tie between distinct observations is unresolved unless an approved rule resolves it; input order is never the tie-breaker.

## 7. Evidence and uncertainty semantics

### 7.1 Evidence values

Use a tagged result with a **set of causes**, since absence, retrieval failure, and conflict can coexist:

```text
Evidence<T> =
  Known(value: T, supportingEvidenceIds, provenance)
  | Unresolved(causes: NonEmptySet<Cause>, candidateEvidenceIds)

Cause = Missing | Conflicting | Unavailable | Invalid
```

Malformed language/IR and violated engine invariants are evaluation errors, not ordinary missing patient evidence. An invalid incoming clinical observation can be represented as an evidence diagnostic, subject to the query's relevance and coverage contract.

Retain patient, encounter, source/resource version, effective/valid time, recorded time, correction/supersession links, validation status, and acquisition provenance. A record's absence from a query is not an assertion that the clinical condition is absent.

### 7.2 Query completeness

Evidence retrieval returns both items and coverage: queried domain, requested window, source scope, acquisition time, pagination/completeness status, and failures. A successful empty query may establish absence **within that declared scope**. It does not establish that the patient never had a condition or that every external chart was searched.

Positive existence may be known from one sufficient admissible observation even if another source is unavailable. Negative existence requires sufficient declared coverage or an authorized explicit negative assertion. `count` under incomplete coverage is a bound, not an exact zero. A comparison can be known when all values within the bound give the same answer; otherwise it is unknown. Start with simple count bounds; unsupported aggregate uncertainty is unresolved, never silently ignored.

### 7.3 Decision composition

Comparisons lift known compatible values to `True`/`False`; insufficient evidence gives `Unknown(causes)`. Use the following truth tables, with symmetric operands:

| A | B | all(A, B) | any(A, B) |
|---|---|---|---|
| True | True | True | True |
| True | False | False | True |
| True | Unknown | Unknown | True |
| False | False | False | False |
| False | Unknown | False | Unknown |
| Unknown | Unknown | Unknown | Unknown |

`not(True) = False`, `not(False) = True`, `not(Unknown) = Unknown`. This is negation of an explicit decision, not negation of database membership.

Preserve diagnostics and source traces even where a decisive operand settles the result. Distinguish uncertainty that affects the result from uncertainty that is presently immaterial. Only material unresolved dependencies generate blocking needs for that result, unless an independently declared review requirement applies. An engine error cannot be hidden by Boolean short-circuiting.

Distinct contradictory observations remain unresolved unless the evidence-selection contract legitimately resolves their precedence. PPL v1 does not attempt a general paraconsistent logic; it preserves the contradiction as evidence and gives the affected predicate an unknown result.

### 7.4 Evidence selection and assertion precedence

Every EvidenceQuery declares or imports a versioned selection contract. It specifies the concept/type queried, subject/episode/encounter scope, admissible source and assertion kinds, valid-time window, validity requirements, correction/supersession handling, permitted authority, precedence strategy, tie behavior, and coverage needed for a negative conclusion. Its reads and strategy are compiler-visible; no opaque callback or free-form instruction determines precedence.

Apply selection in a defined order: establish semantic identity and admissibility; apply authorized correction/retraction relationships; restrict candidates to the requested scope/window; apply the approved temporal and source-precedence strategy; then resolve to a known value or an explicit unresolved result. Preserve excluded/superseded candidates and the reasons they did not govern the result. Unresolved competing evidence is retained as such.

Source tiers are permitted only within that contract. A provider attestation can take precedence over chart evidence for an authorized concept and interval when the contract permits that specific assertion kind and authority. A generic “provider” tier cannot make a stale, wrong-subject, incompatible-unit, or differently scoped statement admissible. Equally ranked conflicting candidates remain unresolved unless a supported, clinically approved tie rule establishes precedence; insertion order and last-write-wins are not tie rules.

A provider's precedence request is a typed input referring to an allowed strategy and scope. The compiler checks the strategy and bindings; the boundary authenticates the actor, and runtime checks the assertion's actual authority and validity. The input cannot replace the query's selection contract. Different queries may legitimately select different evidence because their declared clinical scopes differ; the selection trace must explain the difference.

### 7.5 Pathway discovery and applicability

Each pathway declares a required applicability Decision. An unconditional scope must be explicit. Distinguish discovery (which pathways to consider), applicability (whether a considered pathway's approved population/context criteria hold), and recommendation indication (whether an action is indicated within that scope). Diagnosis-code matching can support discovery without establishing applicability.

For recommendations initiated by that pathway, the compiler binds applicability into effective indication as defined in section 9.2. This binding is visible in the IR and trace and cannot be omitted by a node author. The applicability expression may read evidence and produce material needs but cannot depend on dispositions that it governs.

False applicability prevents new ordinary recommendations from that pathway. Unknown applicability is unresolved, not false, and can emit needs for the invoked pathway where resolving them could affect its results. Discovery/invocation bounds which pathways are evaluated; the system must not interrogate the provider about every pathway in the catalogue.

Applicability for new recommendations is distinct from continued responsibility for an already-established follow-up instance. Leaving an enrollment scope does not silently cancel an outstanding obligation. The longitudinal contract in section 10.1 governs continuation, completion, transfer, and cancellation.

## 8. Node contracts

Each built-in contract defines typed ports, cardinality, required properties, expression restrictions, outputs, trace shape, and permitted relationship roles. Authors may specialize through parameters and composition, but not redefine the contract.

| Node kind | Inputs and responsibility | Outputs |
|---|---|---|
| EvidenceQuery | Declared patient/source/temporal/terminology requirements; selection rule | Evidence<T>, coverage, acquisition needs |
| DerivedValue | Pure typed expression over explicit inputs | Evidence<T>, derivation trace |
| Predicate | Pure comparison or logical composition, including required pathway applicability | Decision, supporting and unresolved dependencies |
| Recommendation | Explicit indications, prerequisites, exclusions, action definition | Base eligibility and ActionProposal; final disposition is a later output |
| Choice | Candidate base eligibility, declared cardinality, recorded selection | Selection state, alternatives, unmet choice need |
| Need | Typed missing measurement, attestation, clarification, or workflow requirement | Stable requirement identity and fulfillment status |
| EvidenceReference | Versioned citation or source reference | Provenance/review information |
| Group | Authoring organization and presentation | Membership; no implicit clinical execution |

Recommendation subclasses can carry medication, test, imaging, procedure, guidance, and follow-up payloads. Do not force all clinical actions into a medication-shaped schema. A follow-up proposal must carry its timing anchor, responsible role, and completion evidence requirement. Proposing an action does not prove that it was ordered, performed, or completed.

Quality metrics are derived outputs or separately declared checks. They cannot silently feed clinical eligibility unless connected through an explicit typed predicate. If an existing Criterion is used as a design example, classify it according to its actual role; its label alone does not determine whether it is evidence, a predicate, or presentation.

## 9. Relationship contracts and graph composition

### 9.1 Catalogue

| Relationship | Source → target | Meaning and checks |
|---|---|---|
| binds | Typed output → named input port | Exact compatible type; scalar port has exactly one binding unless a reducer is declared |
| indicates | Decision → Recommendation indication expression | Contributes under explicit all/any composition; no default based on arrival order |
| requires | Decision → Recommendation prerequisite expression | Required fact/completion predicate; does not execute the source action |
| excludes | Decision → Recommendation exclusion expression | Established exclusion prevents ordinary recommendation; unknown is not cleared |
| candidate_of | Recommendation base-eligibility port → Choice | Declares candidate membership; stable namespaced identity |
| selects | Choice selection port → Recommendation disposition port | Selection affects disposition, not the predicate that established base eligibility |
| fulfilled_by | Recorded evidence/event → Need | Binding checked against need type, scope, validity and authority; no automatic external action |
| cites | Node → EvidenceReference | Adds provenance/review obligations; never directly changes eligibility |
| groups / precedes_display | Presentation entities | Organizes the view; no clinical dependency or timing implication |

If an author means “perform B after A is completed,” they must reference a completion fact and a timing constraint. A display sequence or an eligible proposal for A does not satisfy that requirement.

Clinical parameters and expressions can be written inline or through connected Predicate nodes. They lower to the same typed expressions. Duplicate executable edge identities are errors; idempotent graph-set operations do not silently hide conflicting duplicate definitions.

### 9.2 Composition at the target

Each recommendation declares:

```text
A = pathway applicability Decision
I_local = explicitly composed recommendation indication Decision
I = all(A, I_local)  // compiler-established, traceable scope dependency
P = explicitly composed prerequisite Decision
X = explicitly composed exclusion Decision

baseEligibility = all(I, P, not(X))
```

Pathway applicability and a local indication are mandatory; unconditional values must be written explicitly. A recommendation that applies to everyone in the pathway writes `I_local = True` rather than omitting an indication. If the protocol has no prerequisites or no exclusions in scope, it must explicitly declare those empty groups, lowering respectively to `True` and `False`. Omitted required declarations are compile errors. An empty exclusion group does not waive checks required by the approved safety policy in section 11.1.

Preserve `I`, `P`, and `X` independently. A known exclusion is reported even if another operand makes base eligibility false. Unknown prerequisites do not become false. The UI can distinguish ineligible, unresolved, and excluded reasons without reverse-engineering a score.

Choice and safety are subsequent, explicit composition stages. A choice cannot retroactively change the clinical evidence that established eligibility. Safety constraints can withhold an eligible action; their absence does not establish eligibility.

### 9.3 Dependency graph

The **executable port/expression dependency graph** must be acyclic. It is distinct from the visible graph, which can contain citations, layout links, and relationships between different evaluation phases of the same node.

For example, Recommendation.baseEligibility → Choice.selection → Recommendation.disposition is legal: the later disposition does not feed base eligibility. Recommendation.disposition → its own eligibility is a cycle and is rejected. This distinction prevents choice handling from creating apparent or actual circular reasoning.

The compiler produces a stable topological order. Correctness must not depend on the tie-breaking order among independent expressions. Sequential execution is the initial implementation; parallelism is an optimization requiring equivalence tests.

### 9.4 Choices and alternatives

Support explicit `one_of`, `any_of`, and `all_of` selection cardinalities. Require the author to declare whether no selection is permissible. More than one eligible option in an exclusive automatic choice is an ambiguity, not permission to take the first. Unknown eligibility cannot be silently discarded to make an otherwise ambiguous automatic choice appear unique.

`one_of` selects exactly one candidate unless explicitly optional. `any_of` selects a declared nonempty subset unless explicitly optional; automatic mode includes every definitively eligible candidate and remains incomplete if relevant unknowns could change that set. `all_of` requires every declared candidate to be eligible and selected: an ineligible member produces an unsatisfied-group result, and an unknown member leaves the group unresolved. It never forces an ineligible action into the plan. Provider and automatic selection modes are explicit; a required group with no eligible selection emits a decision need, not a successful empty plan. Optional emptiness does not turn unresolved candidate eligibility into known absence.

Provider selection is a recorded input. An ineligible candidate is rejected as an ordinary selection; a permitted clinical exception uses the distinct exception mechanism in section 12. When an input change invalidates a prior selection, return a new choice need and invalidate the affected review.

### 9.5 Relationship influence

Every relationship must have a declared role. Not every relationship must change action eligibility. Citations affect provenance; groups affect presentation; independently justified redundant constraints can be useful.

For executable dependencies, diagnose proven dead branches, ineffective guards, contradictory prerequisites, and unreachable actions where the supported analysis establishes them. A redundant constraint is initially a reviewable diagnostic, not a universal rejection. Required influence/coverage checks must be named obligations with defined scope and proof outcomes, not a blanket assertion that every edge matters for some clinically possible patient.

## 10. Data acquisition, needs, and external models

EvidenceQuery nodes declare the evidence contract. They do not contain HTTP, SQL, GraphQL, or arbitrary adapter code. GraphQL remains an application API; FHIR and other source adapters operate outside evaluation.

A `Need` includes a stable key, subject/encounter scope, requested type, code/value-set requirements, compatible units, temporal window, provenance/authority constraints, urgency, and affected outputs. A fulfiller may query the chart, request a provider observation, or initiate an approved task. The workflow policy selects among permitted fulfillers; it cannot relax the evidence contract silently.

The acquisition loop is:

1. Evaluate a frozen input snapshot and emit unresolved needs.
2. An authorized orchestrator selects an allowed acquisition action.
3. Record success, failure, timeout, or explicit refusal as an event.
4. Normalize and validate returned evidence.
5. Evaluate a new revision; invalidate review if material inputs or outputs changed.

Need fulfillment is idempotent by request identity and bounded by attempt/deadline policy. A failed request stays unavailable. Repeated acquisition must not form an unbounded evaluate/fetch loop. An EHR query cannot conjure a measurement that has never been taken. An actual clinical order requires its own authorization and workflow; emitting a Need is not that authorization.

LLMs can produce proposed extractions, classifications, or summaries as recorded external observations. Record model identifier/version as available, prompt/template digest, source material identifiers, acquisition parameters, result, and review status. Model confidence is metadata, not clinical truth. A high-impact predicate may consume such an observation only through an approved evidence contract, including attestation where required. No LLM execution occurs inside the pure core, and no LLM invents a missing fact to make a pathway resolve.

### 10.1 Longitudinal state and follow-up instances

Progress across encounters is derived from recorded clinical/workflow evidence, the approved protocol, and the explicit evaluation clock. A mutable “current step” pointer is not clinical truth. Materialized progress views are caches of that derivation and must be reproducible.

Give each established follow-up an action-instance identity distinct from its reusable pathway node ID. Record patient/episode binding, originating proposal and approval, protocol version, anchor event, timing rule, due window, responsible role, completion criteria, and authorized changes. Orders placed, actions performed, results received, cancellations, deferrals, transfers, and corrections are different events. An order alone does not establish completion. A historical completion cannot satisfy every recurrence of the same node; the completion contract binds it to an instance or explicitly permits reuse.

For a supported fixed-duration follow-up window `[dueStart, dueEnd]`, an active uncompleted instance is `not yet due` when the evaluation clock is before `dueStart`, `due` within the window, and `overdue` after `dueEnd`. Zero-width windows are permitted only when explicitly authored. Missing or ambiguous anchors/timing evidence yield `unresolved`, not an invented deadline. Completed, cancelled, deferred, and transferred states have their own event/authority rules; deferral preserves the old schedule and records the authorized new one. These progress states are separate from recommendation disposition.

Record valid/event time separately from recorded time. Historical replay uses what was known in that revision. A late-arriving completion or correction can change current progress in a new revision without rewriting the historical result. A retracted completion can reopen an obligation under the approved contract.

The orchestrator arranges time-based reevaluation where required, recording a clock advance even if no new chart data arrives. Queries and prior approvals remain pinned to their versions unless explicitly migrated. A change in pathway applicability cannot erase outstanding instances; any closure or transfer requires its own declared rule and supporting event.

## 11. Recommendation disposition, safety, and multi-pathway composition

Keep these outputs separate:

- **Base eligibility:** `True`, `False`, or `Unknown`, with indication/prerequisite/exclusion traces.
- **Selection:** selected, not selected, or unresolved under the relevant choice.
- **Safety assessment:** checked with declared coverage, finding present, or unresolved/unavailable.
- **Disposition:** proposed, not applicable, not selected, withheld, or unresolved, plus explicit reason identifiers.
- **Review/finalization readiness:** satisfied or blocked by named obligations.

Confidence, evidence grade, completeness, and model certainty remain separate fields. A ranking function may order eligible alternatives, but cannot silently select an exclusive branch or transform an unresolved clinical predicate into a known one. Any future validated prediction used by a pathway must enter as a typed, versioned observation with an explicit decision rule.

Use an explicit disposition reducer and retain the separate values of effective indication `I`, prerequisites `P`, and exclusions `X`. For a recommendation with no engine failure, apply these rows in order:

| Condition | Primary disposition and required qualification |
|---|---|
| `I = False` | `not applicable`, reason `NOT_INDICATED`; retain any established exclusion separately |
| `I != False` and `X = True` | `withheld`, reason `EXCLUSION_ESTABLISHED`; if `I = Unknown`, explicitly show `INDICATION_UNRESOLVED` rather than imply that the action was otherwise indicated |
| `P = False` | `not applicable` under the current prerequisite, reason `PREREQUISITE_UNSATISFIED`; preserve indication true/unknown separately and any independently declared prerequisite-completion task |
| Remaining base eligibility is unknown | `unresolved`, with material evidence needs |
| Base eligibility true; definitively unselected | `not selected` |
| Base eligibility true; required choice unresolved | `unresolved`, with choice need |
| Eligible and selected; required safety hold established | `withheld`, with safety reason |
| Eligible and selected; required safety assessment incomplete | `unresolved`, with affected finalization blocked |
| Eligible and selected; required checks satisfied | `proposed`; review may still be required |

A recommendation outside a choice is selected by definition once eligible. The output always distinguishes “not indicated” from “indicated but prerequisite incomplete”; a UI may label the latter “prerequisite pending” but cannot flatten both to a bare false flag. Unknown prerequisites remain unknown. All established findings remain visible regardless of the primary label, including an exclusion on an action whose indication is false. “Withheld” is not evidence that a clinical indication was established.

This ordering controls disposition, not whether independently declared urgent findings must be surfaced. Safety work that is immaterial to a definitively unselected action need not block other selected actions. Required clinician review is a separate obligation: `proposed` does not mean approved or ordered.

### 11.1 Safety coverage

Safety queries carry scope and coverage: knowledge source/version, candidate universe, supported code mappings, reference freshness policy, and unresolved items. Unmapped allergies, unsupported medication identity, unavailable reference data, and unimplemented checks cannot appear as completed negative assessments.

Not every action requires every conceivable safety check. Required clinical checks come from an explicit, versioned, clinically approved safety-policy artifact adopted for the institution and intended use. The pathway may add requirements within that policy. The interpreter supplies typed capabilities, coverage states and enforcement; it does not invent hidden clinical requirements.

Clinical neutrality of the interpreter does not imply that the deployed product has no minimum supported-use policy. Prism's clinical governance and the institution may establish required checks for a supported action class or clinical claim. Those requirements must be visible, approved, and pinned rather than hard-coded as unexplained interpreter behavior. An institution cannot silently disable an adopted mandatory check by omitting it. Unsupported policy/capability combinations cannot be published for that intended use.

A required unknown check blocks finalization of its affected action. A known exclusion or required safety hold is preserved as a finding and, where relevant, a withholding reason; an unrelated score or acknowledgement cannot clear it. Omission of a requirement and an explicitly approved statement that a check is outside scope are different configurations.

### 11.2 Composition across pathways

Namespaced node identities prevent collisions. Evaluate contributing pathways against the same evidence revision and release-bundle manifest. Compose candidate actions using explicit action identity, dose/route/timing where applicable, evidence provenance, and conflict rules. Do not merge medications solely because their display names match.

Run candidate-set safety and conflict analysis over the complete relevant universe, including current patient therapies and provider-added proposals. Preselection candidate eligibility, selection, and final safety disposition are ordered stages. Do not repeatedly suppress alternatives and reselect until a convenient stable plan emerges; if a selected option is withheld, return a new decision need unless a separately specified fallback rule establishes a result without feedback cycles.

An individually valid pathway is not proof that its combination with another is valid. Cross-pathway contradiction and safety cases belong to the acceptance corpus. A write-in proposal enters the same validation, safety, review, and materialization boundary.

### 11.3 Partial results and clinical urgency

An unresolved component must not erase independently established findings, urgent flags, or needs. Return them with explicit incomplete status. Partial finalization is allowed only if the release declares independently finalizable groups and the compiler/runtime can show their required dependencies are satisfied. The default is that required unresolved obligations block finalization of the requested plan scope.

Invariant violations and resource exhaustion block successful finalization. They do not return an empty list that could be mistaken for “nothing to do.” Engine failure is a workflow-visible failure; it is not a clinical recommendation to withhold care.

## 12. Provider assertions and institutional policy

### 12.1 Distinct input actions

| Action | Meaning |
|---|---|
| Observation | Adds a measured/reported fact with provenance and valid time |
| Correction | Supersedes a specific erroneous record while retaining its history |
| Attestation | Records a scoped statement by an authorized person |
| Choice | Selects among alternatives under a declared choice contract |
| Clinical exception | Records an authorized deviation from an established recommendation/hold |

Do not collapse these into a generic “override” that forces node status. Each has a subject, scope, author, reason where required, recorded time, effective interval, expiry/retraction rules, and source references. Expiry is evaluated against the pinned clock; advancing time creates a new revision.

A provider can request precedence only through the applicable EvidenceQuery's approved selection contract in section 7.4. The compiler checks the permitted strategy and binding; the orchestrator verifies actor authority and runtime verifies scope/time validity. Contradictory chart evidence remains visible. A clinical exception changes permitted disposition under a specific policy; it does not rewrite the original evidence or claim that the underlying predicate became true.

### 12.2 Bounded institutional variation

Institutions may set approved parameters, formularies, terminology mappings, evidence freshness requirements, required reviews, permitted assertion authorities, and acquisition/escalation workflows. A pathway can specialize only declared parameters within an allowed range or enum. Provider actions are typed inputs, not a third interpreter tier.

The specialization order is **institution → pathway → node → authorized provider input**, within the adopted supported-use policy. This is not a universal last-writer-wins chain. Each setting declares which levels may set it and how values combine:

| Setting class | Combination and authority |
|---|---|
| Clinical scalar/enum parameter | Most specific authorized value within inherited bounds; narrower levels cannot expand those bounds |
| Required reviews and safety checks | Accumulate requirements; a lower tier cannot delete a mandatory requirement; inconsistent requirements are an error |
| Allowed capabilities/authorities/fulfillers | Intersect permissions or choose within the permitted set; empty required capability sets block publication |
| Evidence precedence | Use the approved query contract; a provider request is accepted only within its declared strategies and scope |
| Provider observation, choice, correction or exception | Validate a typed event under its specific authority contract; it does not overwrite general configuration |

Every configurable parameter declares its type, owner, allowed specialization levels, bounds/allowed values, combination rule, whether runtime specialization is permitted, and provenance requirements. Provider runtime parameter changes are allowed only when explicitly declared; otherwise the provider supplies evidence or a choice, not a new policy. Clinical exception authority is separate and cannot alter language invariants.

Resolve the static policy before publication and bind authorized runtime specializations to a new session revision before evaluation. Pin the effective configuration and record the source of every value and the contributing mandatory requirements. Ambiguous ownership, incompatible constraints, unauthorized specialization, or a missing required clinical value is an explicit error. No hidden platform clinical default fills the gap. Public language invariants remain platform-owned and non-overridable.

“Restrict-only” applies to compiler acceptance and publication authority: institutional rules cannot admit a malformed program. It is not a claim that removing recommended actions is always clinically safer. Clinical policy changes still require clinical review.

### 12.3 Institution configuration binding

The orchestrator must resolve the institution from authenticated, authorized session context and bind an approved immutable configuration artifact before a clinical run. The release/session manifest records institution identity, policy version/digest, approval identity, and supported-use profile. Patient/encounter access must be authorized for that institution; a caller-supplied institution ID is not sufficient authority.

This contract does not require a deployed institutions microservice. A versioned database-backed configuration store or another authenticated artifact provider can implement it. Its storage/API and operational ownership belong in the orchestrator implementation specification. A missing or ambiguous institution binding blocks a clinical run; preview must use an explicitly identified test configuration and cannot silently substitute it for clinical policy.

## 13. Compiler and verification model

### 13.1 Compiler stages

1. Parse and schema-validate canonical source; enforce size/depth limits.
2. Resolve pinned library, terminology, action-definition, and policy references.
3. Expand nonrecursive templates with source maps; resolve stable identities.
4. Type-check expressions, dimensions, ports, units, parameters, and collection bounds.
5. Validate relationship endpoints, cardinality, ownership and target reducers.
6. Construct the executable port graph; reject cycles, undefined reads and unsupported effects.
7. Check required applicability/indication declarations, scope bindings, choice modes, graph reachability, evidence selection/precedence and acquisition contracts, and setting-specific policy composition.
8. Run supported symbolic analyses, producing named proof outcomes.
9. Emit immutable IR, required capabilities, dependency indices, diagnostics, source maps, and a compilation manifest.

Preview may retain invalid drafts and display diagnostics, but the runtime does not execute invalid programs or silently fall back to the legacy evaluator. Unsupported language/capability versions fail explicitly.

### 13.2 What can be established

| Verification layer | Example | Guarantee boundary |
|---|---|---|
| Schema and type checks | Numeric threshold has the right quantity dimension | Checks representation and operation compatibility, not clinical appropriateness |
| Structural analysis | Required input bound; executable dependency graph acyclic | Checks declared program structure |
| Symbolic analysis | Two exclusive branch predicates overlap | Conditional on the supported expression fragment and modeled input constraints |
| Scenario validation | Approved inputs yield expected actions and needs | Evidence over those cases, not all possible patients |
| Clinical review | Rule and action reflect applicable evidence and intended use | Human-governed approval, independent of compilation |
| Runtime validation | Actual evidence satisfies the declared contract | Depends on source fidelity, coverage, and retained provenance |

Use separate statuses: `wellFormed`, `analysisResults`, `clinicalApproval`, `publicationApproval`, and `runtimeReadiness`. Do not expose a single unqualified “verified” badge.

### 13.3 Symbolic fragment and outcomes

Initially target Boolean expressions, finite enums, numeric comparisons against constants in canonical units, and bounded interval comparisons under explicit input assumptions. Exclude arbitrary model calls, external retrieval, unrestricted collection queries, and nonlinear arithmetic from proof claims. Quantity conversion and temporal lowering must match runtime semantics and be included in conformance tests.

Every analysis reports:

```text
analysisId, compilerVersion, solverVersion/configuration (if used),
programDigest, assumptionsDigest, supportedFragment,
outcome: PROVED | COUNTEREXAMPLE | INCONCLUSIVE,
witnessOrDiagnostic, resourceBudget
```

`PROVED` names the proposition proved, such as “these branches cannot both be true,” not “this pathway is correct.” `COUNTEREXAMPLE` includes an interpretable witness. A timeout or unsupported construct is `INCONCLUSIVE`, never success. A required publication obligation with an inconclusive result blocks publication under that policy; optional analyses warn. Waivers cannot bypass type errors or engine invariants.

Symbolic patients can be logically admissible but clinically implausible. Encode approved domain constraints and show them with the result. Feasibility of a relationship does not prove its benefit or clinical correctness. A contradictory or overrestrictive domain model must itself be tested for satisfiability.

The solver is a development/publication tool, not a dependency for patient-time execution. Start with direct analyses and add a solver only for obligations that need it. Solver selection and its precise theory/encoding require a small follow-up specification; this RFC does not select one prematurely.

### 13.4 Diagnostics

Diagnostics include stable codes, source span or AST path, node/edge identifiers, violated contract, relevant dependency path, and a concrete repair explanation. Examples:

- `UNIT_DIMENSION_MISMATCH`: threshold and measurement cannot be compared.
- `UNBOUND_REQUIRED_INPUT`: completion evidence has no declared source.
- `AMBIGUOUS_COMPOSITION`: several indications have no all/any expression.
- `CYCLIC_EXECUTION_DEPENDENCY`: a final disposition feeds its own eligibility.
- `UNSUPPORTED_NEGATIVE_EVIDENCE`: absence is used without a coverage contract.
- `EXCLUSIVE_BRANCH_OVERLAP`: witness satisfies both automatic alternatives.
- `UNSUPPORTED_PROOF_FRAGMENT`: requested obligation could not be analyzed.

Diagnostics must refer to authored concepts, not only generated IR indices.

## 14. IR, execution, and explanations

### 14.1 The authoritative IR

The IR contains typed opcodes, stable source identities, resolved constants and library references, evidence-query/selection contracts, typed port bindings, explicit applicability dependencies, target reducers, execution phases/order, action payloads, choice contracts, follow-up instance templates, effective policy and its provenance, explanation descriptors, and capability/version requirements. Retain a source map from every executable operation to its node, relationship, or library definition.

Raw AST and stored graph rows are not executable at runtime. Only successfully compiled, supported IR is accepted. The initial phase-1 `CompiledPathway` will need a new version and adapter; extending it silently under the same compiler identifier is not allowed.

The artifact loader validates schema, capabilities, digest, release identity and authorized provenance. Accepting a caller-supplied object that merely resembles IR is not a compilation boundary. Clinical runtime requires an approved release; explicit preview can execute a valid draft artifact under its separately authorized preview contract.

### 14.2 Pure interface

Conceptual API, not a final TypeScript signature:

```text
compile(source, pinnedCatalogues, effectivePolicy)
  -> CompileFailure | CompiledPackage

evaluate(compiledPackage, frozenEvidence, recordedInputs, evaluationContext)
  -> EvaluationFailure | EvaluationResult
```

`EvaluationResult` contains per-node values, explicit applicability, separate eligibility/selection/safety/disposition, action-instance progress, needs, review obligations, explanation records, semantic digests, and input/output revisions. It does not write a database, call an LLM, perform an EHR query, or materialize orders.

The orchestrator owns acquisition, identity/authorization, event persistence, optimistic concurrency, review acknowledgements, and transactional materialization. It cannot substitute new clinical decisions after evaluation. Safety composition is part of the defined evaluation contract, even if implemented as a separate pure phase.

### 14.3 Determinism and resource behavior

Canonicalize unordered collections and trace records by stable identity; preserve clinically meaningful order explicitly. Avoid locale-dependent collation, implicit timezone conversion, map iteration as tie-breaking, and floating-point reduction order. Duplicate observations are reconciled by declared identity/version rules, not by accidental equal values.

Specify limits for source size, expanded nodes, facts per query, expression depth, collection operations, and evaluation work. A deterministic operation budget has defined failure behavior. A host timeout/crash is separately recorded as execution failure; it never produces a successful partial clinical result. Wall-clock duration and operational logs are excluded from semantic hashes.

Incremental evaluation is deferred. Reevaluate from frozen inputs first. Any later caching/incremental engine must be observationally equivalent to fresh evaluation, including needs and explanations, and must preserve the same language version.

### 14.4 Explanations

Produce structured records during execution: rule/relationship identifiers, input evidence identifiers, relevant values and units, applied temporal selection, composition outcome, unresolved causes, and versioned policy sources. Distinguish “predicate false” from “not evaluated because of an engine failure” and from “eligibility established, later withheld.”

Render human-readable explanations from these records. LLM wording may summarize, but cannot be the sole explanation or alter the recorded rationale. Preserve positive and negative reasons and all material unresolved dependencies. A minimal proof tree alone is not the complete clinical explanation contract; Soufflé's [provenance facility](https://souffle-lang.github.io/provenance) is useful inspiration, not a replacement for it.

## 15. Versioning, replay, and review integrity

A published release manifest identifies source/IR hashes, language and compiler versions, runtime build, operator/numeric capability profile, clinical libraries, terminology/value-set expansions, conversion tables, evidence-selection policy, safety references, governance approvals, and effective institution configuration.

A session revision records its release manifest, patient/episode/encounter binding, evidence snapshot and coverage, provider inputs, external observations, established action instances and the workflow events known at that revision, and evaluation clock. It retains the protocol/configuration artifacts governing outstanding instances, including instances originating under an older release. Use an append-only logical history with correction/retraction events. PHI retention, access controls, and required deletion policies still apply; append-only clinical history is not permission for unlimited retention.

Distinguish:

- **Historical replay:** execute the original retained bundle and evidence under the original clock.
- **Current reevaluation:** use an explicitly chosen new clock, evidence revision, or release; present the differences and require review as appropriate.

A content hash without the underlying artifact cannot support replay. An unavailable historical dependency yields “replay unavailable,” not a substitution of current data.

Use separate digests for source/IR identity, evaluation identity, and the clinician review artifact. The review artifact includes action identity and clinically material payload (dose/route/timing where applicable), eligibility/disposition, needs, safety findings, material evidence/provenance, and review requirements. A changed treatment payload must invalidate review even if the same node remains included. Conservative invalidation is acceptable initially; relaxation needs explicit justification and tests.

At finalization, revalidate session revision, release status and evidence freshness rules, and the reviewed artifact. A changed result returns a review-required response. Claim completion and write the plan atomically. Concurrency conflicts retry from the newly committed revision; they do not combine inputs from different revisions. Repeat requests return the established result by idempotency identity.

If elapsed real time requires a freshness check beyond the session's pinned clock, the orchestrator creates an explicit clock-advance revision and reevaluates. The core never reads the wall clock to change an existing revision in place. Freshness policy must specify the permitted review interval and which evidence requires reacquisition.

Pinning does not mean ignoring newly known hazards. A release can be revoked for new use/finalization while remaining available for historical replay. Updates to copied institutional policies require provenance, reviewed diffs, and explicit adoption; silent inheritance and silent drift are both disallowed.

## 16. Governance and clinical validation

Use publication states such as Draft, Compiled, ClinicallyReviewed, Approved, Active, Superseded, and Revoked, with separate analysis details. A state transition checks authenticated authority and records the exact artifact approved. A new source, parameter, or library version invalidates approvals according to the change contract.

Require named clinical ownership, intended population/use, evidence citations, approval scope, limitations, and review policy. A newer publication may trigger reassessment; publication dates alone do not establish relevance or contradiction. Institutions can add publication obligations without weakening the base language rules.

Provider exceptions require a defined authorized scope and, where applicable, reason/additional review. An acknowledgement is not evidence that a contraindication disappeared. Preview/synthetic capabilities must be distinguishable from clinical sessions and cannot confer authority through caller-asserted headers.

Clinical correctness is established through evidence review and validation of encoded behavior, not by language design alone. Requirements must include omission hazards as well as inappropriate recommendations. Clinical reviewers should define expected outcomes independently of the implementation and adjudicate differences between the source clinical intent and encoded behavior. Preserve the scenarios, expected rationale, reviewer identity, and reviewed artifact version.

## 17. Repository and application boundaries

Start with an internal package, provisionally `libs/pathway-language`, organized into public types, source schema, catalogue, compiler, IR, evaluator, diagnostics, and conformance fixtures. The package has no dependency on GraphQL resolver contexts, database pools, network clients, or application session stores. Concrete internal folder names can be finalized with the first implementation plan.

Enforce this boundary with its own `package.json`, `tsconfig`, public exports, isolated build/type checks, and versioned conformance fixtures. CI must reject direct or transitive dependencies from the core into `apps/*` or infrastructure adapters and prohibit database, GraphQL-server and network-client dependencies in the core package. Application adapters depend on public language exports; the language package cannot import them back. A directory name alone is not an architectural boundary.

`pathway-service` owns adapters between graph storage/canonical source, patient evidence, session events, and the language package. GraphQL exposes authoring, compilation diagnostics, evaluation results, needs, and review/finalization operations. Existing graph storage can remain an authoring persistence mechanism; a graph database query must not define runtime clinical semantics.

The admin UI renders source-mapped errors on the canvas and shows before/after behavior for a proposed content change. Provider applications consume a stable result contract rather than recomputing readiness or eligibility from presentation fields. The new generation paths must use one authoritative finalization contract. Legacy generation paths can be removed without a coexistence period.

Extract a new repository only after the package boundary is stable and a separate consumer, ownership model, or release requirement justifies it. If extracted, publish immutable versioned artifacts and conformance fixtures; do not create a remote interpreter service merely because the code moved repositories.

## 18. Alternatives considered

| Alternative | Benefits | Costs / reason not selected initially |
|---|---|---|
| Keep extending current traversal | Least immediate implementation work | Leaves meaning spread across traversal, confidence, gates and exceptions |
| Full CQL runtime plus separate pathway rule engine | Existing clinical expression tooling | Two semantic boundaries; pathway combination, needs, assertions and explanations still need a contract |
| Compile PPL to Soufflé | Existing relational evaluation, analysis tooling, native compilation | Needs a clinical type/evidence layer, integration/toolchain, source-mapped diagnostics and constrained feature subset |
| Fixed Soufflé interpreter with pathway definitions as facts | One reusable executable backend | Implements an interpreter inside another language; may add indirection without removing much code |
| CEL plus graph contracts | Bounded expression engine and type-checking tooling | Clinical quantities, temporal/evidence semantics and graph composition remain custom |
| General scripting or arbitrary node callbacks | Maximum flexibility | Hidden reads, side effects, inconsistent semantics and infeasible broad verification |
| Hard-coded individual pathways | Direct reference behavior and easy initial debugging | Duplication and engineering dependence for each content change |
| One restricted PPL IR and evaluator | One inspectable semantic boundary; close fit to the supported problem | Prism owns language maintenance, conformance tests and tooling |

The final row is the recommendation. It borrows established concepts without claiming inherited correctness. A small direct pathway implementation may be useful as an independent test reference, but is not the intended authoring system.

### 18.1 Soufflé decision

Soufflé is an evaluated alternative, not an initial dependency or a parallel implementation workstream. Reconsider it only if relational inference outgrows the small evaluator and it demonstrably removes custom semantic code. Any future backend must consume the same typed IR, preserve canonical results/explanations, and restrict nondeterministic or unbounded constructs. Detailed backend experiments belong in a separate proposal; this brief record preserves why Soufflé was not selected initially.

### 18.2 Standards boundary

CQL is a source of expression semantics, not a declaration that PPL is standard CQL. [FHIR R4 PlanDefinition](https://hl7.org/fhir/R4/plandefinition.html) is an interoperability reference for action definitions and applicability, not a replacement for the full PPL contract. Explicit adapters may be added when required, with supported/lossy mappings documented. GraphQL remains the application interface and is not the clinical rule language.

## 19. Fresh-start authoring and pathway acceptance

### 19.1 Optional existing-content design exercises

| Existing construct, if used as an example | Candidate language representation |
|---|---|
| Pathway condition codes / scope | Discovery metadata plus an explicit reviewed applicability predicate; matching alone does not establish applicability |
| Stage / Step used only as heading or container | Group/display; preserve content and ordering without inventing an action |
| Step carrying a clinical instruction | Guidance Recommendation with reviewed local indication and inherited explicit applicability; recover branch/prerequisite conditions |
| Step with both container and instruction roles | Split into Group plus Guidance Recommendation with source links to the original Step |
| Ambiguous Step content / containment | Authoring diagnostic requiring review; no automatic conversion of every Step to an action |
| Gate with patient condition | Predicate plus typed bindings and explicit affected target expression |
| Question / gate answer | Evidence need or choice, based on whether the answer supplies a fact or selects an option |
| Prior-node-result gate | Explicit typed dependency; distinguish proposed, selected, ordered and completed states |
| DecisionPoint | Choice with explicit cardinality, candidate eligibility and selection rules |
| Medication / LabTest / Imaging / Procedure / Guidance | Typed Recommendation/action definition |
| Medication role “avoid” / “contraindicated” | Explicit exclusion or constraint with clinical applicability and scope, not an ordinary positive action |
| Criterion / EvidenceCitation / CodeEntry | Predicate, provenance, or terminology declaration according to actual meaning |
| REQUIRES / ESCALATES_TO | Resolve intended evidence/timing/alternative behavior explicitly; no mechanical guess |
| Confidence thresholds / propagated scores | Identify the clinical rule they approximated; retain scores only as explicitly non-authoritative metadata/ranking where appropriate |
| default_behavior skip/traverse | Replace with explicit unknown handling and approved workflow; never translate unknown to false silently |
| LLM gate | Recorded proposed observation plus an approved evidence/review contract |

A general JSON-to-language translator is not a deliverable or acceptance requirement. Optional manual translations or small fixture converters can expose gaps in expressiveness; document unsupported constructs, assumptions, and items requiring clinical review. Neither old JSON nor the old evaluator is the clinical oracle, and neither should constrain the new language design. Do not invent a clinical rule from a score or display edge.

The existing implementation marks reached structural Steps included during traversal but excludes structural nodes from action projection. That does not prove their authored content is nonclinical, nor does it justify converting them all to recommendations. Inspect each Step's actual content and graph context. Applicability alone is sufficient only for guidance explicitly intended for every applicable patient; conditional guidance retains its additional indication and prerequisite expressions.

The fixed composition model removes traversal-order and containment-versus-guard precedence as sources of differing results. It does not make omission of a necessary clinical predicate impossible: authors can still encode the wrong rule, which independent clinical acceptance cases must detect.

### 19.2 Authored-pathway acceptance path

The required vertical exercise is **authored pathway → compilation and clinical validation → evaluation against clinical scenarios**. Authoring creates the canonical language definition; compilation validates it and produces the executable representation; evaluation applies that representation to patient evidence. The choice of manual authoring, editor, or a separate future import tool does not change the language semantics and is not a prerequisite for this exercise.

Preserve clinical citations and reviewed interpretations that justify the authored rules. Ambiguous scope, conditions, timing, or action meaning must remain visible for review rather than becoming an approved executable rule by default. These are content validation requirements, not requirements to build a clinical-source ingestion pipeline.

Define expected clinical scenarios independently of the compiler and evaluator. Check applicability, indicated and contraindicated actions, missing evidence, follow-up obligations, and omissions against those expectations. Optional comparisons with old exports may reveal questions but are not parity gates. The new system may intentionally represent different content and behavior where the source and clinical review support it.

### 19.3 Fresh-start deployment and lifecycle boundary

Assume the existing production database will be wiped and initialized for the new system. Downtime and an initially incomplete catalogue/data set are acceptable. There is no requirement to transfer old pathways, patient/session records, approvals, action instances, or historical replay bundles; keep an old evaluator available; or support mixed-engine runs. This RFC records the design assumption, not an instruction to execute a database deletion.

Initialize the new schema and required configuration, author the selected pathways, and publish only packages that meet their declared intended-use acceptance criteria. An unavailable pathway or missing patient evidence stays explicitly unavailable/unresolved; an incomplete catalogue must not be presented as comprehensive coverage. Product availability may be reduced while this work proceeds.

Versioning, frozen replay, review integrity, longitudinal continuity, and artifact retention apply to records created in the new system. They do not require reconstructing legacy history. Once the new system is in clinical use, release changes must preserve the interpretation of its established sessions and action instances. Recovery can suspend clinical use or select a retrievable previously approved new-system release when one exists; there is no fallback to legacy semantics.

## 20. Implementation sequence and acceptance gates

| Stage | Deliverable | Exit criteria |
|---|---|---|
| A. Semantic nucleus | Catalogue, evidence model, truth tables, expression fragment, source schema and numeric/temporal capability decisions | Representative examples have unambiguous expected results; all remaining semantic choices identified |
| B. Compiler + reference evaluator | Typed IR, pure execution, diagnostics, structured explanations, no I/O | Type/dependency rejection cases and semantic conformance corpus pass; results invariant under irrelevant input ordering |
| C. Authoring-to-evaluation slice | One authored pathway with applicability, needs, assertions, review and finalization; anemia is a candidate | Independent clinical scenarios adjudicated; authored-definition-to-result trace complete with clinical rationale; unsupported constructs resolved explicitly; new-system transaction/revision contract verified |
| D. Evidence and verification | Validated live adapter/replay bundle; targeted symbolic checks; acquisition policy | Adapter fidelity and coverage cases pass; replay reproduces artifacts; proof outcomes honestly distinguish inconclusive |
| E. Broader composition | A second substantially different source-grounded pathway and multi-pathway interactions; institutional content variation; gestational hypertension is a candidate | No hidden semantic switches; conflict, choice and safety cases pass; unsupported cycles rejected/remodeled; authoring burden assessed |
| F. Fresh-start launch | Clean database initialization, approved authored pathway packages, and new-system release/revocation/recovery procedure | Clinical owners approve intended use and risk-based acceptance criteria; incomplete content is explicitly scoped or blocked; required release controls and authority enforced; no old-system parity gate |

Stages can overlap where contracts are stable. Do not defer uncertainty, quantities, or assertions until after the evaluator; they are language semantics. Do not require broad repairs to the old traversal before beginning A/B. Do not expose unvalidated new behavior clinically merely because B is complete.

Keep the first implementation deliberately small: canonical AST, minimal catalogue, exact typed comparisons, explicit decisions, a DAG evaluator, and one end-to-end example. Defer a polished textual parser, general solver, incremental evaluation, repository extraction and alternative backend until they solve demonstrated needs.

### 20.1 Explicit v0 capability cut

`ppl-core-v0` is the initial implementation capability profile, not permission to reinterpret the full language. Published artifacts declare required language/capability versions. “Declared but unsupported” means the construct is recognized and rejected during compilation; it is not accepted for execution with approximate semantics. A future capability extension requires versioned conformance cases.

Stage A fixes only the contracts needed for the supported v0 column, including one numeric profile, rather than implementing the full semantic catalogue. Stage B enforces them. It must preserve uncertainty for real inputs outside that supported data fragment rather than falsely normalizing them into it.

| Capability | Stage B must implement and enforce | Declared but rejected or deferred |
|---|---|---|
| Source and graph | Canonical AST; typed bindings; explicit applicability; all/any/not; acyclic port dependencies; explicit disposition reducer | Textual parser, executable recursion, custom opcodes/callbacks |
| Decisions and evidence | Known true/false and unknown; missing/conflicting/unavailable/invalid causes; traces; no implicit absence-as-false | No deferral of uncertainty semantics |
| Clinical quantities | One published bounded decimal profile; exact comparison; a pinned whitelist of dimension-preserving conversions sufficient for the initial examples | General arithmetic, unsupported conversion families, unqualified numeric coercion |
| Temporal evaluation | Explicit evaluation instant; known instants with explicit offsets normalized to UTC; fixed-duration windows; definite-latest with unresolved ties | Calendar-period calculations, timezone-local recurrence, and operators requiring full partial-date interval reasoning |
| Coverage | One scoped snapshot coverage contract with explicit complete/incomplete/unavailable status and adapter provenance; negative conclusions require sufficient declared coverage | Federation of multiple coverage domains and automatic reconciliation of their completeness claims |
| Collections | Bounded filtering, membership/existence, and definite-latest; positive evidence can establish existence without complete coverage | Count-bound inference, trend/regression, arbitrary aggregation and joins exposed to authors |
| Assertions | One query-declared, versioned admissibility/precedence strategy per query; typed observations/attestations and explicit authorized correction/supersession; scope, expiry and conflict handling | Arbitrary precedence programs, undeclared runtime strategy changes, general clinical-exception workflows |
| Choices | Explicit recorded one-of selection over typed candidates with eligibility validation; an unselected required choice remains a Need | Automatic ranking-driven selection and any-of/all-of modes until their conformance cases are implemented |
| Policy | Typed parameter bounds, allowed setting levels, accumulated mandatory requirements, narrowed permissions, authenticated-context input contract | Generic policy scripting and clinician-created semantic profiles |
| Follow-up | One anchored, fixed-duration action instance; separate ordered/completed/cancelled states; not-yet-due/due/overdue/unresolved derivation; completion identity | Automatic recurrence expansion, calendar schedules, transfers/deferrals beyond the supported event contract |
| Review and replay | Canonical semantic/review digests and pure replay from a supplied frozen artifact/input bundle; material changes invalidate review | Production artifact retention, live acquisition and transactional finalization are integrated in C/D, not simulated as complete in B |
| Verification | Schema, types, dimensions, binding/cardinality, required declarations, cycle rejection and deterministic-result conformance | Solver-based coverage/influence proofs and a universal clinical “verified” status |

Unsupported *program operations* fail compilation. Unsupported or incomplete *patient evidence* remains visible: a partial timestamp needed for selection, an unrecognized unit, missing mapping, or incomplete source coverage makes the affected query unresolved with a diagnostic/Need. Do not silently drop the evidence, claim full coverage, or reject all unrelated valid findings. Invalid/untrusted executable artifacts remain execution failures.

“Snapshot complete within scope” must be attested by the adapter against a named source/query contract, including pagination and failures. A successful API response or a stored snapshot row does not establish completeness of the patient's clinical history. V0 can represent scoped absence only for the question that contract can actually answer.

A complete anemia pathway is not automatically achievable within the v0 cut. Stage C inventories the requirements of its selected source clinical content; unsupported operations either receive a separately specified capability extension or block publication for that intended use. A deliberately smaller validated scope is acceptable and must be labeled as such. Missing content cannot be presented as a complete clinical package; preserving every old pathway or JSON construct is not a requirement.

### 20.2 Optional pinned design fixtures

The following stored exports, identified by file digest, are optional engineering examples for challenging the language. They are not required conversion targets, assertions of present live status, or clinically approved test oracles. Stages C/E may choose different source-grounded pathways with comparable complexity. Acceptance follows independently reviewed source clinical content and expected scenarios, not reproduction of these exports.

| Role | Pathway / stored fixture | SHA-256 of fixture bytes |
|---|---|---|
| Candidate for Stage C design exploration | `anemia-in-pregnancy-v1@1.4`: [anemia-1.4.json](../../../apps/pathway-service/src/__tests__/fixtures/compiler-corpus/anemia-1.4.json) | `0041ee3be1fde50763eb518101f94344abb7c07d36a02fbd8c2c95394c4f1f46` |
| Candidate for Stage E design exploration | `gestational-hypertension-preeclampsia@1`: [ghtn-1.json](../../../apps/pathway-service/src/__tests__/fixtures/compiler-corpus/ghtn-1.json) | `1e8026c9bf338e0896108ceb2fa062b0f227b511f40d1542a370bb2443e1e775` |
| Optional escalation design case | `chronic-htn-pregnancy-v1@1.0`: [chronic-htn-1.0.json](../../../apps/pathway-service/src/__tests__/fixtures/compiler-corpus/chronic-htn-1.0.json) | `3082e342c6bd36d60c710ef8c9a266b21a0301f683ca5b8ed5e664fda6856dec` |

The recorded corpus lists anemia 1.4 as ACTIVE at that historical inspection and documents gestational-hypertension routing defects. It identifies the unreachable `ESCALATES_TO` medication case in the chronic-hypertension fixture. Do not conflate these findings or infer that a fixture requires runtime recursion. Add explicit synthetic cycle rejection cases, and remodel any clinically recurrent workflow through event/action instances. Changes to a fixture require a new digest and a reviewed description of the changed clinical assumptions.

## 21. Validation strategy

### 21.1 Required automated evidence

Apply these checks to each published capability profile. Deferred program constructs require compilation-rejection tests; unsupported patient values require explicit uncertainty tests. V0 does not need to implement calendar arithmetic or partial-date interval reasoning to verify that it never invents precision or silently executes those operations.

- **Operator conformance:** exact boundaries, compatible/incompatible units, decimal limits, partial dates, timezone boundaries, known/unknown Boolean tables, and invalid operand behavior.
- **Graph composition:** multiple incoming relationships, dead/contradictory guards, alternative cardinality, duplicate bindings, phase-crossing dependencies and cycles.
- **Metamorphic properties:** reorder nodes/edges/facts; rename internal IDs consistently; convert equivalent units; replay identical inputs; add irrelevant evidence. Outcomes must remain equivalent under the declared assumptions. Adding relevant evidence is allowed to change outcomes and can reveal conflicts.
- **Evidence adapters:** partial retrieval, pagination, successful scoped absence, amended/retracted results, missing units, ambiguous terminology and stale observations.
- **Assertions and sessions:** expiry/retraction, authority rejection, correction provenance, invalidated choices, repeat acquisition, concurrent edits and stale review hashes.
- **Safety and composition:** unmapped allergies, incomplete reference coverage, candidate-set interactions, provider write-ins and conflicting pathways.
- **Resource failures:** deterministic budget exhaustion, host timeout, invalid artifacts and missing historical dependencies cannot yield ready results.
- **Compiler/runtime agreement:** execution accepts only validated IR; symbolic lowering and runtime operators agree on generated supported examples.

Use independent expected cases, property-based tests, and targeted mutation testing for clinically important predicates. Avoid an oracle that simply calls the same evaluator through a second wrapper.

### 21.2 Worked acceptance cases for the illustrative pathway

Assume pathway applicability true unless stated otherwise, no choice group, a fixed protocol threshold/window, and a required clinician review. These are semantic examples, not clinical guidance.

| Evidence state | Expected result |
|---|---|
| Measurement definitively below threshold; assessment complete; exclusion definitively false; required safety coverage complete with no hold | Base eligibility true; disposition proposed; review still required |
| Equivalent measurement expressed in another supported unit | Same eligibility, disposition and clinical rationale after normalization; original unit retained in provenance |
| Measurement unavailable; other required predicates true/cleared | Eligibility unknown; measurement need with acquisition failure if applicable; no assumption that the threshold test is false |
| Measurement unavailable but assessment definitively incomplete | Base eligibility false; `PREREQUISITE_UNSATISFIED`, distinct from not indicated; indication uncertainty and any independently declared completion task remain visible; missing measurement is not a blocker for this already-false result |
| Measurement below threshold; assessment complete; exclusion evidence unresolved | Eligibility unknown; exclusion clarification/coverage need; no clearance from absence of a record |
| Exclusion definitively true, with measurement unavailable | Base eligibility false; disposition withheld with `INDICATION_UNRESOLVED`; do not imply that indication is established; missing measurement does not erase the exclusion |
| Indication definitively false and exclusion definitively true | Not applicable / `NOT_INDICATED`; exclusion remains a visible finding, not a claim that an otherwise indicated action was withheld |
| Discovery code matches but applicability is unknown | Discovery does not establish scope; effective indication unresolved where material; scoped applicability need |
| Applicability false while the local indication is true | Effective indication false; no new ordinary proposal; do not cancel prior follow-up instances |
| Two non-superseded observations conflict and latest cannot be established | Affected measurement unresolved with conflicting/ambiguous evidence; no input-order winner |
| An authorized correction establishes a new value above threshold | New revision; predicate false; previous review invalidated if material; old evidence retained as superseded |
| Higher-tier provider assertion is expired or concerns another encounter | It cannot override admissible chart evidence; retain rejection/admissibility reasons |
| Equally ranked admissible assertions conflict | Affected query unresolved; no insertion-order or last-write-wins result |
| Lower policy tier omits a mandatory review or exceeds a numeric bound | Review requirement is retained; out-of-bound specialization rejected; no silent effective-policy change |
| Required policy asks for an unsupported safety capability | Publication blocked for that intended use; no completed-negative assessment |
| Required medication safety mapping unavailable for an otherwise eligible selected action | Eligibility remains true; disposition unresolved; affected finalization blocked by incomplete safety assessment |
| IR unsupported, evaluation budget exhausted, or required historical artifact missing | Explicit execution/replay failure; never a successful empty plan |

Repeat the cases through the compiler, evaluator, adapter and finalization boundary as each becomes available. An unchanged inclusion flag with changed dose, timing or material evidence must still trigger review invalidation.

### 21.3 Longitudinal acceptance cases

Use a frozen approved timing rule and stable action-instance identities. These tests specify workflow semantics rather than clinical timing recommendations. Capabilities deferred by v0 remain compilation-rejection cases until implemented; they must not be simulated as successful workflows.

| Situation | Expected result |
|---|---|
| Active uncompleted follow-up, clock before `dueStart` | Not yet due; obligation retained |
| Clock at `dueStart`, within the window, or at `dueEnd` | Due; boundary semantics are inclusive |
| Clock after `dueEnd`, no qualifying completion | Overdue; owning role and unresolved work visible |
| Order placed but no qualifying completion/result | Not completed; due state still derives from the clock and contract |
| Clock advances with no new patient data | New evaluation revision can become due/overdue; no implicit clock read inside old revisions |
| Anchor missing or ambiguous | Unresolved timing; no fabricated due date |
| Completion arrives late | New revision derives progress from valid and recorded times; historical replay retains what was known then |
| Completion is corrected/retracted | Reevaluate the instance; reopen if the approved completion contract is no longer satisfied |
| Two recurring instances share a node template | A completion satisfies only its bound instance unless explicit reuse is permitted |
| Authorized deferral/cancellation | Preserve history and authority; apply the supported event contract rather than mutate a hidden progress pointer |
| Pathway no longer applicable for new actions | Outstanding instance remains tracked until a declared completion/closure/transfer rule applies |

### 21.4 Clinical acceptance

Clinical owners define expected decisions, omissions, needs, urgency, and rationale before evaluating the implementation. Include typical cases, boundary cases, contradictions and plausible failures. Record disputed cases as unresolved requirements rather than tuning a confidence score until the test looks plausible.

Measure inappropriate recommendations and missed indicated actions separately; also measure review burden, unresolved needs, explanation usefulness, and authoring/approval effort. Passing a finite corpus does not prove universal clinical safety. Acceptance criteria must be tied to intended use and hazard, not only aggregate agreement percentages.

### 21.5 Release checks

Required tests/type checks must fail the release on failure. Run database-backed activation, revision and materialization checks in isolated infrastructure. Verify authenticated roles, patient/institution scope and preview separation. These are clinical-release obligations that accompany the replacement; they are not evidence that the language design must wait for unrelated legacy cleanup.

## 22. Risks and mitigations

| Risk | Mitigation |
|---|---|
| A new language reproduces old hidden behavior | One opcode/reducer catalogue, explicit dependency reads, source-mapped conformance cases |
| Borrowed semantics conflict | Operator ledger; one evidence model; explicit deviations from CQL and closed-world Datalog |
| Custom runtime becomes another large framework | Small acyclic fragment; no callbacks/recursion/plugins; expand only for demonstrated clinical requirements |
| Authors cannot understand composition | Explicit all/any/choice displays, scenario previews, precise diagnostics and before/after review |
| Formal checks create false confidence | Named obligations, assumptions and inconclusive results; clinical approval remains separate |
| Authored rules omit or misrepresent clinical intent | Clinical citations and rationale, explicit scope and unresolved diagnostics, independent clinical cases, and reviewed publication |
| Pinned artifacts preserve obsolete recommendations | Separate replay from current use; revocation/freshness checks and explicit reviewed upgrades |
| External data is incomplete or wrong | Coverage/provenance contracts, typed evidence diagnostics, validated adapters and visible unresolved needs |
| Need acquisition never terminates | Attempt/deadline budgets and explicit unavailable outcomes |

## 23. Decisions resolved here and follow-up questions

Recommended architectural decisions: one PPL; fixed semantics; CQL/Datalog inspiration rather than two embedded languages; typed node/relationship contracts; explicit evidence uncertainty; an acyclic executable port graph; one pure evaluator; no confidence-based implicit eligibility; targeted rather than universal proofs; internal package first; authored-pathway acceptance and fresh-start deployment with a database reset; no legacy continuity requirement.

Before implementing the semantic nucleus, resolve and document:

1. Exact initial node/relationship vocabulary after walking representative source clinical content and, optionally, the fixtures in section 20.2, including applicability and instruction-versus-container classification.
2. Numeric capability limits and conversion implementation, with boundary fixtures.
3. Exact operator signatures for the v0 capability cut in section 20.1 and an explicit CQL comparison ledger.
4. Evidence completeness/negative-assertion requirements for each initial clinical query.
5. The first institution's approved query-selection strategies, assertion authorities and required safety-policy artifact; general clinical exceptions remain outside v0.
6. Which proof obligations are mandatory for the first publication policy, and whether any require a solver immediately.
7. Canonical source and IR schemas, stable node/action-instance identifiers, source-map shape, and GraphQL result evolution.
8. Authenticated institution-configuration storage/resolution and the CI enforcement of the internal package boundary.

These questions refine the chosen architecture. They do not reopen institution-defined interpreters or authorize arbitrary embedded code.

## 24. Success criterion

The language succeeds when an approved clinical rule can be expressed, checked, executed, explained and changed through the same explicit model, with less hidden evaluator behavior than today. A second substantially different pathway should reuse the core without introducing special traversal cases or institution-specific truth rules.

The investment is justified by trustworthy clinical behavior and maintainable validation. Language expressiveness, graph size, number of configurable options, and solver coverage are not success metrics by themselves.
