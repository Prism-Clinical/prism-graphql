# RFC: One typed, declarative language for Prism clinical pathways

**Status:** Proposed for review; not an approved implementation specification or a clinical validation claim.

**Date:** 2026-09-28

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

The current [compiler](../../../apps/pathway-service/src/services/compiler/compile.ts) validates a pathway and builds an immutable model. Its [kind catalogue](../../../apps/pathway-service/src/services/compiler/kinds.ts) and [model](../../../apps/pathway-service/src/services/compiler/model.ts) are useful migration inputs, not a final language definition.

The [evaluation environment](../../../apps/pathway-service/src/services/resolution/pipeline/load-env.ts) attaches compilation while the [evaluation pipeline](../../../apps/pathway-service/src/services/resolution/pipeline/evaluate.ts) still executes `TraversalEngine`. The replacement must close that gap: the accepted compiled representation becomes the only executable meaning for a migrated pathway.

Preserve the useful boundaries already present: explicit uncertainty, a pinned clock, immutable inputs, recorded external observations, shared evaluation, eligibility versus disposition, reviewed-result checks, and revision-controlled plan materialization. Reuse implementation only where it satisfies the new contracts.

The [recorded compiler corpus](../records/evaluation-interpreter/compiler-corpus.md) supplies migration fixtures. It is not proof that their clinical content is correct or that all active production content has been reviewed under this RFC.

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
- Replacing GraphQL, FHIR ingestion, the database, or the graph editor merely to introduce the language.
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

Defer generic regular expressions, arbitrary joins exposed to authors, unbounded collection generation, nonlinear numeric solvers, and trend/regression operators until a concrete pathway requires a separately specified contract. Migration must identify such unsupported constructs rather than approximate them.

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

## 8. Node contracts

Each built-in contract defines typed ports, cardinality, required properties, expression restrictions, outputs, trace shape, and permitted relationship roles. Authors may specialize through parameters and composition, but not redefine the contract.

| Node kind | Inputs and responsibility | Outputs |
|---|---|---|
| EvidenceQuery | Declared patient/source/temporal/terminology requirements; selection rule | Evidence<T>, coverage, acquisition needs |
| DerivedValue | Pure typed expression over explicit inputs | Evidence<T>, derivation trace |
| Predicate | Pure comparison or logical composition | Decision, supporting and unresolved dependencies |
| Recommendation | Explicit indications, prerequisites, exclusions, action definition | Base eligibility and ActionProposal; final disposition is a later output |
| Choice | Candidate base eligibility, declared cardinality, recorded selection | Selection state, alternatives, unmet choice need |
| Need | Typed missing measurement, attestation, clarification, or workflow requirement | Stable requirement identity and fulfillment status |
| EvidenceReference | Versioned citation or source reference | Provenance/review information |
| Group | Authoring organization and presentation | Membership; no implicit clinical execution |

Recommendation subclasses can carry medication, test, imaging, procedure, guidance, and follow-up payloads. Do not force all clinical actions into a medication-shaped schema. A follow-up proposal must carry its timing anchor, responsible role, and completion evidence requirement. Proposing an action does not prove that it was ordered, performed, or completed.

Quality metrics are derived outputs or separately declared checks. They cannot silently feed clinical eligibility unless connected through an explicit typed predicate. A legacy Criterion is migrated according to its actual role; its label alone does not determine whether it is evidence, a predicate, or presentation.

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
I = explicitly composed indication Decision
P = explicitly composed prerequisite Decision
X = explicitly composed exclusion Decision

baseEligibility = all(I, P, not(X))
```

An indication is mandatory; an unconditional indication must be written explicitly. If the protocol has no prerequisites or no exclusions in scope, it must explicitly declare those empty groups, lowering respectively to `True` and `False`. Omitted required declarations are compile errors. An empty exclusion group does not waive separate platform safety checks.

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

## 11. Recommendation disposition, safety, and multi-pathway composition

Keep these outputs separate:

- **Base eligibility:** `True`, `False`, or `Unknown`, with indication/prerequisite/exclusion traces.
- **Selection:** selected, not selected, or unresolved under the relevant choice.
- **Safety assessment:** checked with declared coverage, finding present, or unresolved/unavailable.
- **Disposition:** proposed, not applicable, not selected, withheld, or unresolved, plus explicit reason identifiers.
- **Review/finalization readiness:** satisfied or blocked by named obligations.

Confidence, evidence grade, completeness, and model certainty remain separate fields. A ranking function may order eligible alternatives, but cannot silently select an exclusive branch or transform an unresolved clinical predicate into a known one. Any future validated prediction used by a pathway must enter as a typed, versioned observation with an explicit decision rule.

Use an explicit disposition reducer, retaining all established reasons rather than only the first one. For a recommendation with no engine failure: an established pathway exclusion produces `withheld`; otherwise false base eligibility produces `not applicable`, and unknown base eligibility produces `unresolved`. For true base eligibility, a definitively unselected option is `not selected`; an unresolved required choice is `unresolved`. A selected eligible proposal is `withheld` by a required safety hold, `unresolved` by an incomplete required safety assessment, and otherwise `proposed`. A recommendation outside a choice is selected by definition once eligible. Findings already established remain visible regardless of the primary disposition label.

This ordering controls disposition, not whether independently declared urgent findings must be surfaced. Safety work that is immaterial to a definitively unselected action need not block other selected actions. Required clinician review is a separate obligation: `proposed` does not mean approved or ordered.

### 11.1 Safety coverage

Safety queries carry scope and coverage: knowledge source/version, candidate universe, supported code mappings, reference freshness policy, and unresolved items. Unmapped allergies, unsupported medication identity, unavailable reference data, and unimplemented checks cannot appear as completed negative assessments.

Not every action requires every conceivable safety check. The package and platform declare which checks are required for each supported action class and clinical claim. A required unknown check blocks finalization of its affected action. A known exclusion or required safety hold is preserved as a withholding reason, not cleared by an unrelated score or acknowledgement.

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

A provider can request that an assertion take precedence where the approved policy permits it. The compiler checks that the pathway uses a supported resolution strategy; the orchestrator checks actual authority. Contradictory chart evidence remains visible. A clinical exception changes permitted disposition under a specific policy; it does not rewrite the original evidence or claim that the underlying predicate became true.

### 12.2 Bounded institutional variation

Institutions may set approved parameters, formularies, terminology mappings, evidence freshness requirements, required reviews, permitted assertion authorities, and acquisition/escalation workflows. A pathway can specialize only declared parameters within an allowed range or enum. Provider actions are typed inputs, not a third interpreter tier.

Resolve permitted policy precedence into an explicit, pinned effective configuration before evaluation. Record the source of each effective value. No hidden platform clinical default fills a missing required parameter; publication fails instead. Public language invariants remain platform-owned and non-overridable.

“Restrict-only” applies to compiler acceptance and publication authority: institutional rules cannot admit a malformed program. It is not a claim that removing recommended actions is always clinically safer. Clinical policy changes still require clinical review.

## 13. Compiler and verification model

### 13.1 Compiler stages

1. Parse and schema-validate canonical source; enforce size/depth limits.
2. Resolve pinned library, terminology, action-definition, and policy references.
3. Expand nonrecursive templates with source maps; resolve stable identities.
4. Type-check expressions, dimensions, ports, units, parameters, and collection bounds.
5. Validate relationship endpoints, cardinality, ownership and target reducers.
6. Construct the executable port graph; reject cycles, undefined reads and unsupported effects.
7. Check required decision declarations, choice modes, graph reachability, and evidence/acquisition contracts.
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

The IR contains typed opcodes, stable source identities, resolved constants and library references, evidence-query contracts, typed port bindings, target reducers, execution phases/order, action payloads, choice contracts, explanation descriptors, and capability/version requirements. Retain a source map from every executable operation to its node, relationship, or library definition.

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

`EvaluationResult` contains per-node values, separate eligibility/selection/safety/disposition, needs, review obligations, explanation records, semantic digests, and input/output revisions. It does not write a database, call an LLM, perform an EHR query, or materialize orders.

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

A session revision records its release manifest, patient/encounter binding, evidence snapshot and coverage, provider inputs, external observations, and evaluation clock. Use an append-only logical history with correction/retraction events. PHI retention, access controls, and required deletion policies still apply; append-only clinical history is not permission for unlimited retention.

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

Clinical correctness is established through evidence review and validation of encoded behavior, not by language design alone. Requirements must include omission hazards as well as inappropriate recommendations. Clinical reviewers should define expected outcomes independently of the implementation and adjudicate migration differences. Preserve the scenarios, expected rationale, reviewer identity, and reviewed artifact version.

## 17. Repository and application boundaries

Start with an internal package, provisionally `libs/pathway-language`, organized into public types, source schema, catalogue, compiler, IR, evaluator, diagnostics, and conformance fixtures. The package has no dependency on GraphQL resolver contexts, database pools, network clients, or application session stores. Concrete internal folder names can be finalized with the first implementation plan.

`pathway-service` owns adapters between graph storage/canonical source, patient evidence, session events, and the language package. GraphQL exposes authoring, compilation diagnostics, evaluation results, needs, and review/finalization operations. Existing graph storage can remain an authoring persistence mechanism; a graph database query must not define runtime clinical semantics.

The admin UI renders source-mapped errors on the canvas and shows before/after behavior for a proposed content change. Provider applications consume a stable result contract rather than recomputing readiness or eligibility from presentation fields. Legacy and new generation paths must converge on an authoritative finalization contract or be explicitly restricted before clinical rollout.

Extract a new repository only after the package boundary is stable and a separate consumer, ownership model, or release requirement justifies it. If extracted, publish immutable versioned artifacts and conformance fixtures; do not create a remote interpreter service merely because the code moved repositories.

## 18. Alternatives considered

| Alternative | Benefits | Costs / reason not selected initially |
|---|---|---|
| Keep extending current traversal | Least immediate migration work | Leaves meaning spread across traversal, confidence, gates and exceptions |
| Full CQL runtime plus separate pathway rule engine | Existing clinical expression tooling | Two semantic boundaries; pathway combination, needs, assertions and explanations still need a contract |
| Compile PPL to Soufflé | Existing relational evaluation, analysis tooling, native compilation | Needs a clinical type/evidence layer, integration/toolchain, source-mapped diagnostics and constrained feature subset |
| Fixed Soufflé interpreter with pathway definitions as facts | One reusable executable backend | Implements an interpreter inside another language; may add indirection without removing much code |
| CEL plus graph contracts | Bounded expression engine and type-checking tooling | Clinical quantities, temporal/evidence semantics and graph composition remain custom |
| General scripting or arbitrary node callbacks | Maximum flexibility | Hidden reads, side effects, inconsistent semantics and infeasible broad verification |
| Hard-coded individual pathways | Direct reference behavior and easy initial debugging | Duplication and engineering dependence for each content change |
| One restricted PPL IR and evaluator | One inspectable semantic boundary; close fit to the supported problem | Prism owns language maintenance, conformance tests and tooling |

The final row is the recommendation. It borrows established concepts without claiming inherited correctness. A small direct pathway implementation may be useful as an independent test reference, but is not the intended authoring system.

### 18.1 Soufflé decision

Keep Soufflé as an optional backend experiment, not an initial required dependency. If tested, use the same typed PPL IR and clinical acceptance cases. Compare total custom semantic code, explanation fidelity, update/retraction behavior, bounded execution, and latency. Ban nondeterministic choice and unbounded arithmetic recursion in any generated program. Native integration is available through its [C++ interface](https://souffle-lang.github.io/interface), but that adds a deployment boundary to the current TypeScript stack.

Adopt it only if it removes substantial relational inference machinery without relocating clinical semantics into opaque callbacks. Do not maintain two independently specified production meanings. A backend change must pass the same conformance corpus and preserve canonical results.

### 18.2 Standards boundary

CQL is a source of expression semantics, not a declaration that PPL is standard CQL. [FHIR R4 PlanDefinition](https://hl7.org/fhir/R4/plandefinition.html) is an interoperability reference for action definitions and applicability, not a replacement for the full PPL contract. Explicit adapters may be added when required, with supported/lossy mappings documented. GraphQL remains the application interface and is not the clinical rule language.

## 19. Migration from the existing pathway system

### 19.1 Map meaning, not just labels

| Existing construct | Migration approach |
|---|---|
| Stage / Step / containment | Group/display by default; explicitly recover any intended prerequisite semantics |
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

The translator emits a migration report with exact conversions, unsupported constructs, semantic differences, and items requiring author/clinical review. It cannot silently invent a clinical rule from a score or display edge.

### 19.2 Runtime transition

- Introduce a language-version discriminator and a separate compiled-artifact version.
- Keep unmigrated pathways on the existing engine with clear version identity.
- Initially require all pathways in one composed clinical run to use one engine family. Mixed-engine composition needs a later explicit equivalence contract; it is not an implicit fallback.
- Shadow-evaluate migrated pathways on the same frozen cases. Differences are expected and must be classified: fixed defect, intended clinical/content change, or regression.
- The old engine is a comparison baseline, not the clinical oracle.
- Activate only reviewed packages with retrievable artifacts. Rollback selects a previously approved release; it does not reinterpret old sessions under new code.
- Retire legacy evaluation paths after migration and historical replay requirements are satisfied. A failed new evaluation never silently retries under legacy semantics.

## 20. Implementation sequence and acceptance gates

| Stage | Deliverable | Exit criteria |
|---|---|---|
| A. Semantic nucleus | Catalogue, evidence model, truth tables, expression fragment, source schema and numeric/temporal capability decisions | Representative examples have unambiguous expected results; all remaining semantic choices identified |
| B. Compiler + reference evaluator | Typed IR, pure execution, diagnostics, structured explanations, no I/O | Type/dependency rejection cases and semantic conformance corpus pass; results invariant under irrelevant input ordering |
| C. Vertical pathway slice | One existing pathway translated with explicit needs, assertions, review and finalization | Independent clinical scenarios adjudicated; source-to-result trace complete; transaction/revision contract verified |
| D. Evidence and verification | Validated live adapter/replay bundle; targeted symbolic checks; acquisition policy | Adapter fidelity and coverage cases pass; replay reproduces artifacts; proof outcomes honestly distinguish inconclusive |
| E. Broader composition | A materially different pathway and multi-pathway interactions; institutional content variation | No hidden semantic switches; conflict, choice and safety cases pass; authoring burden assessed |
| F. Controlled rollout | Shadow comparison, approved migration, release/rollback/revocation procedure | Clinical owners approve intended use and risk-based acceptance criteria; required release controls and authority enforced |

Stages can overlap where contracts are stable. Do not defer uncertainty, quantities, or assertions until after the evaluator; they are language semantics. Do not require broad repairs to the old traversal before beginning A/B. Do not expose unvalidated new behavior clinically merely because B is complete.

Keep the first implementation deliberately small: canonical AST, minimal catalogue, exact typed comparisons, explicit decisions, a DAG evaluator, and one end-to-end example. Defer a polished textual parser, general solver, incremental evaluation, repository extraction and alternative backend until they solve demonstrated needs.

## 21. Validation strategy

### 21.1 Required automated evidence

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

Assume no choice group, a fixed protocol threshold/window, and a required clinician review. These are semantic examples, not clinical guidance.

| Evidence state | Expected result |
|---|---|
| Measurement definitively below threshold; assessment complete; exclusion definitively false; required safety coverage complete with no hold | Base eligibility true; disposition proposed; review still required |
| Equivalent measurement expressed in another supported unit | Same eligibility, disposition and clinical rationale after normalization; original unit retained in provenance |
| Measurement unavailable; other required predicates true/cleared | Eligibility unknown; measurement need with acquisition failure if applicable; no assumption that the threshold test is false |
| Measurement unavailable but assessment definitively incomplete | Base eligibility false; not applicable under this prerequisite; missing measurement remains a diagnostic but is not a blocker for this already-false result |
| Measurement below threshold; assessment complete; exclusion evidence unresolved | Eligibility unknown; exclusion clarification/coverage need; no clearance from absence of a record |
| Exclusion definitively true, with measurement unavailable | Base eligibility false; disposition withheld with exclusion reason; missing measurement does not erase that finding |
| Two non-superseded observations conflict and latest cannot be established | Affected measurement unresolved with conflicting/ambiguous evidence; no input-order winner |
| An authorized correction establishes a new value above threshold | New revision; predicate false; previous review invalidated if material; old evidence retained as superseded |
| Required medication safety mapping unavailable for an otherwise eligible selected action | Eligibility remains true; disposition unresolved; affected finalization blocked by incomplete safety assessment |
| IR unsupported, evaluation budget exhausted, or required historical artifact missing | Explicit execution/replay failure; never a successful empty plan |

Repeat the cases through the compiler, evaluator, adapter and finalization boundary as each becomes available. An unchanged inclusion flag with changed dose, timing or material evidence must still trigger review invalidation.

### 21.3 Clinical acceptance

Clinical owners define expected decisions, omissions, needs, urgency, and rationale before evaluating the implementation. Include typical cases, boundary cases, contradictions and plausible failures. Record disputed cases as unresolved requirements rather than tuning a confidence score until the test looks plausible.

Measure inappropriate recommendations and missed indicated actions separately; also measure review burden, unresolved needs, explanation usefulness, and authoring/approval effort. Passing a finite corpus does not prove universal clinical safety. Acceptance criteria must be tied to intended use and hazard, not only aggregate agreement percentages.

### 21.4 Release checks

Required tests/type checks must fail the release on failure. Run database-backed activation, revision and materialization checks in isolated infrastructure. Verify authenticated roles, patient/institution scope and preview separation. These are clinical-release obligations that accompany the replacement; they are not evidence that the language design must wait for unrelated legacy cleanup.

## 22. Risks and mitigations

| Risk | Mitigation |
|---|---|
| A new language reproduces old hidden behavior | One opcode/reducer catalogue, explicit dependency reads, source-mapped conformance cases |
| Borrowed semantics conflict | Operator ledger; one evidence model; explicit deviations from CQL and closed-world Datalog |
| Custom runtime becomes another large framework | Small acyclic fragment; no callbacks/recursion/plugins; expand only for demonstrated clinical requirements |
| Authors cannot understand composition | Explicit all/any/choice displays, scenario previews, precise diagnostics and before/after review |
| Formal checks create false confidence | Named obligations, assumptions and inconclusive results; clinical approval remains separate |
| Migration silently changes care | Per-construct migration reports, independent clinical cases, shadow runs and reviewed release selection |
| Pinned artifacts preserve obsolete recommendations | Separate replay from current use; revocation/freshness checks and explicit reviewed upgrades |
| External data is incomplete or wrong | Coverage/provenance contracts, typed evidence diagnostics, validated adapters and visible unresolved needs |
| Need acquisition never terminates | Attempt/deadline budgets and explicit unavailable outcomes |

## 23. Decisions resolved here and follow-up questions

Recommended architectural decisions: one PPL; fixed semantics; CQL/Datalog inspiration rather than two embedded languages; typed node/relationship contracts; explicit evidence uncertainty; an acyclic executable port graph; one pure evaluator; no confidence-based implicit eligibility; targeted rather than universal proofs; internal package first; new language work begins without waiting for a broad legacy rewrite.

Before implementing the semantic nucleus, resolve and document:

1. Exact initial node/relationship vocabulary after walking two representative pathways.
2. Numeric capability limits and conversion implementation, with boundary fixtures.
3. The supported temporal/operator subset and an explicit CQL comparison ledger.
4. Evidence completeness/negative-assertion requirements for each initial clinical query.
5. Which provider assertion and exception authorities the first institution requires.
6. Which proof obligations are mandatory for the first publication policy, and whether any require a solver immediately.
7. Canonical source and IR schemas, stable identifiers, source-map shape, and GraphQL result evolution.

These questions refine the chosen architecture. They do not reopen institution-defined interpreters or authorize arbitrary embedded code.

## 24. Success criterion

The language succeeds when an approved clinical rule can be expressed, checked, executed, explained and changed through the same explicit model, with less hidden evaluator behavior than today. A second substantially different pathway should reuse the core without introducing special traversal cases or institution-specific truth rules.

The investment is justified by trustworthy clinical behavior and maintainable validation. Language expressiveness, graph size, number of configurable options, and solver coverage are not success metrics by themselves.
