# Stage A specification: Prism Pathway Language v0

**Status:** Draft implementation specification. The architecture is accepted; this specification is not yet a completed Stage A exit or clinical approval.

**Date:** 2026-09-30

**Last revised:** 2026-10-01 — Need/acquisition traceability, precedence, positive handoffs, composition/finalization scope, refusal/consent cases and version identities.

**Architecture authority:** [Accepted pathway-language RFC](2026-09-28-pathway-language-rfc.md).

**Design inputs:** [Reviewable corpus and provenance](../records/pathway-language/corpus/README.md).

**Implementation decomposition:** [Level 1 — behavioral outcomes](2026-10-01-pathway-language-level-1-behavioral-slices.md), [Level 2 — refined slices](2026-10-01-pathway-language-level-2-refined-slices.md), and [Level 3 — single-story components](2026-10-01-pathway-language-level-3-story-spec.md). These proposed delivery plans inherit this specification; story completion does not replace Stage A or clinical acceptance.

## 1. Ownership and acceptance rule

This specification owns detailed source/IR contracts, the initial capability profile, conformance cases, clinical integration scenarios and implementation decisions. It extracts detail from RFC revision `c0b7f7c`; the accompanying revision narrows v0 and adds explicit traceability. The RFC owns architectural invariants. Detail can evolve here without reopening those invariants, but changes to truth semantics or clinical meaning require a versioned specification and review rather than an implementation-only reinterpretation.

Every v0 capability must have a Stage B conformance case and at least one named Stage C/E acceptance scenario in section 14. Clinical features require a meaningful clinical integration scenario. Authoring and protective features require an authoring/publication/rejection scenario; a successful clinical execution is neither necessary nor appropriate for those controls. A capability without both mappings moves to section 13. A broad mention of a document or an “interaction scenario” is not a mapping.

The matrix specifies required evidence, not evidence that tests have already passed. Before Stage A exits, resolve section 17, finalize operator signatures and numeric/temporal profiles, and have clinical owners adjudicate the scenario packages and expected outputs. Stage B must not fill unspecified clinical contracts with defaults. Stage C/E must exercise the declared compiled-source path, explanations and relevant review/finalization boundaries; production-use readiness additionally requires Stage D adapter validation.

The v0 table is the authoritative implementation boundary. The broader contract catalogue below includes explicitly deferred operations so their exclusion is intelligible. Unsupported operations fail compilation; they do not acquire approximate semantics.

## 2. Language layers and authoring representation

### 2.1 Three declaration levels

1. **Language catalogue:** platform-maintained primitive types, operators, node contracts, relationship contracts, composition rules, and proof obligations. It is versioned and tested with the engine.
2. **Reusable clinical libraries:** typed functions and node templates composed only from supported primitives. Libraries cannot add an opcode, perform I/O, redefine truth tables, or replace a relationship reducer. Recursive templates and cyclic imports are rejected.
3. **Pathway instances:** nodes, relationships, parameters, terminology references, evidence citations, and publication metadata for a specific clinical package.

This permits reusable authored abstractions without giving every pathway its own interpreter. A genuinely new primitive requires a language-version change and conformance tests.

### 2.2 One canonical source model

Make a typed, versioned JSON AST the initial canonical source format. Expressions are structured trees, not executable strings. Include schema/language versions, stable node and edge identifiers, imports, parameter definitions, typed nodes/ports, relationships, source references, and metadata. Reject unknown executable properties rather than silently ignoring them.

The graph editor edits this AST. A textual syntax is a readable projection that parses into it; exact spelling is deferred to an authoring specification. Layout, colors, coordinates, and other presentation data live in a separate namespaced section and cannot affect execution.

Bindings written in textual expressions and connections drawn in the editor lower to the same canonical edges. A graphical edge plus an expression reference must not accidentally apply a predicate twice. Conflicting declarations for one binding are errors.

### 2.3 Draft holes and clinical rationale

The canonical AST supports a typed authoring hole with stable identity, expected type/dimension, AST location, explanation and optional citation references. For example, an unresolved quantity threshold can declare its dimension without inventing a value. A hole is well-formed draft syntax and participates in surrounding type checks; it is not a resolved clinical rule. Wrong types, cycles and unsupported operations remain errors.

An explicit preview compilation mode may lower holes to typed incomplete-authoring markers in a preview-only artifact. Dependent preview outputs retain those markers and authoring diagnostics, separately from patient evidence uncertainty; unaffected outputs can be inspected. Boolean simplification or an unvisited branch cannot make a package containing a hole publishable. Publication rejects all unresolved holes. A hole never becomes a patient-data Need or a field a provider can fill during a clinical encounter. Proofs depending on holes are inconclusive.

Every executable declaration can carry clinical rationale and citation references. Publication policy can require them for designated declarations. The reviewed interpretation participates in review digests; changing it requires review under the change contract even when executable output is unchanged. Package-level approval is sufficient; per-declaration approval states are not required.

A hole preserves an unresolved interpretation. Contradictory explicit numeric constraints instead require a validation diagnostic where the supported analysis can establish the contradiction. No compiler is expected to discover every conflict left only in narrative instructions.

### 2.4 Example

The following is illustrative syntax, not an implemented grammar or a clinical recommendation. Parameters and codes belong to a separately reviewed protocol; no treatment threshold is prescribed here.

```text
pathway ExampleAssessment version "1.0" language "ppl-1" capabilities "ppl-core-v0" {
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

The `.value` notation illustrates a lifted evidence expression, not an unsafe unwrap: if the evidence is unresolved, the containing expression follows section 4. The source AST must preserve that distinction. A Boolean evidence output projects to the same Decision domain used by Predicate nodes.

## 3. Types and expression fragment

This section describes the intended language catalogue. Section 12 defines the smaller v0 implementation profile; listing a type or operation here does not authorize its execution before the corresponding capability and conformance cases exist.

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

### 3.1 Numeric and terminology requirements

Use a deterministic decimal/rational implementation with a published numeric capability profile; do not evaluate clinical quantities as unqualified JavaScript `number`s. The first implementation specification must fix precision, range, division/rounding behavior, conversion tables, and overflow behavior before the kernel is accepted. This specification fixes the policy: comparisons do not silently round across a threshold, unsupported conversion is unresolved with a diagnostic, and overflow is an explicit evaluation error. Numeric capability versions are part of the release bundle.

Accept only approved dimension-preserving conversions. Do not infer equivalence from display strings or from identical code text in different systems. An unresolved terminology mapping is explicit. Code-set expansions are immutable inputs to evaluation; a live terminology lookup belongs to acquisition.

### 3.2 Broader operation catalogue

- Typed equality/ordering, Boolean composition, explicit case expressions, and enum membership.
- Quantity comparisons and a small approved arithmetic subset.
- Code/value-set membership with known mapping and coverage.
- Interval containment/overlap, explicit window construction, and definite temporal ordering.
- Bounded filtering, existence, count bounds, and definite-latest selection.
- Nonrecursive reusable expressions with declared signatures and reads.

Defer generic regular expressions, arbitrary joins exposed to authors, unbounded collection generation, nonlinear numeric solvers, and trend/regression operators until a concrete pathway requires a separately specified contract. Authoring validation and compilation must identify such unsupported constructs rather than approximate them.

Time is an input. Distinguish a 24-hour duration from a calendar day in a specified timezone. Partial dates represent uncertainty; they do not acquire invented midnight timestamps. A latest selection succeeds only when the winner is established by the declared time and correction policy. A tie between distinct observations is unresolved unless an approved rule resolves it; input order is never the tie-breaker.

### 3.3 Composable temporal context

Compose three levels with ordinary typed expressions: a fixed query window; an optional versioned contextual lookup; and an optional DerivedValue feeding that lookup. A lookup is a compiler-visible clinical library/table, not a pluggable callback. Window selection and reference-range selection remain independent expressions even when both depend on the same context. Decision aids remain separately versioned observations or supported expressions.

Every temporal expression names its time role: specimen collection, administration, treatment change, completion, delivery, discharge, result availability, recorded time, or evaluation time. A query must not silently substitute record-entry time for the relevant clinical timestamp. Predicted events, hypothetical planning events and actual events are distinct. All comparisons use explicit units, bounds and precision policies within the pinned evaluation revision.

Pregnancy age is a day count at a dated clinical reference point, bound to a pregnancy episode, dating source and interpretation version. V0 supports exact day-count advancement between known dates under a declared clinical date basis; it must not equate this to elapsed UTC hours across timezone changes or invent precision for partial dates. This narrow date operation does not imply general calendar-period arithmetic. Trimester definitions are approved clinical-library content, not interpreter constants. An expression distinguishes context at evaluation from context at specimen collection. Updated dating evidence can alter current interpretation and proposed schedules in a new revision; historical replay uses the old dating evidence. Changes to established schedules require the lifecycle/review contract, not silent historical rewriting.

V0 supports identity-distinct qualifying earlier/later observations, named selection rules and minimum/maximum separation, exercised by E-02. Baseline/current differences and two-point rates are deferred: no initial clinical integration scenario requires them. For the later difference/rate capability, the baseline may lie outside the current observation window only when expressly declared. Zero or unresolved elapsed time cannot produce a rate. A two-point rate is not a claim about a multipoint trajectory. Arbitrary joins, regression and generic trend programs remain deferred. Relevant interventions within the selected interval are explicit event-query dependencies; whether they disqualify or change an interpretation is a reviewed clinical rule, not inferred causation.

## 4. Evidence and uncertainty semantics

### 4.1 Evidence values

Use a tagged result with a **set of causes**, since absence, retrieval failure, and conflict can coexist:

```text
Evidence<T> =
  Known(value: T, supportingEvidenceIds, provenance)
  | Unresolved(causes: NonEmptySet<Cause>, candidateEvidenceIds)

Cause = Missing | Conflicting | Unavailable | Invalid | Inadmissible | InsufficientEvidence
```

Malformed language/IR and violated engine invariants are evaluation errors, not ordinary missing patient evidence. An invalid incoming clinical observation can be represented as an evidence diagnostic, subject to the query's relevance and coverage contract.

Retain subject and episode/encounter binding, source/resource version, effective/valid time, recorded time, correction/supersession links, validation status, and acquisition provenance. Preserve specimen, assay/method, applicable reference-range context, sampling context and treatment linkage when required by a query. Derived attributes carry source evidence and a versioned derivation or an authorized attestation; unsourced scalar attributes are not established clinical facts. A record's absence from a query is not an assertion that the clinical condition is absent.

### 4.2 Query completeness

Evidence retrieval returns both items and coverage: queried domain, requested window, source scope, acquisition time, pagination/completeness status, and failures. A successful empty query may establish absence **within that declared scope**. It does not establish that the patient never had a condition or that every external chart was searched.

Positive existence may be known from one sufficient admissible observation even if another source is unavailable. Negative existence requires sufficient declared coverage or an authorized explicit negative assertion. `count` under incomplete coverage is a bound, not an exact zero. A comparison can be known when all values within the bound give the same answer; otherwise it is unknown. Count-bound inference is a later capability; v0 supports bounded existence and explicit observation pairing, not generic aggregation. An unsupported aggregate program fails compilation. Supported operations with insufficient patient evidence remain unresolved.

### 4.3 Decision composition

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

Distinct contradictory observations remain unresolved unless the evidence-selection contract legitimately resolves their precedence. Language version `ppl-1` does not attempt a general paraconsistent logic; it preserves the contradiction as evidence and gives the affected predicate an unknown result.

### 4.4 Evidence selection and assertion precedence

Every EvidenceQuery declares or imports a versioned selection contract. It specifies the concept/type queried, subject/episode/encounter scope, admissible source and assertion kinds, valid-time window, validity requirements, correction/supersession handling, permitted authority, precedence strategy, tie behavior, and coverage needed for a negative conclusion. Its reads and strategy are compiler-visible; no opaque callback or free-form instruction determines precedence.

Apply selection in a defined order: establish identities and validate correction/retraction authority; resolve the revision-specific correction history; check subject/episode, query scope/window and query-specific admissibility; apply the approved temporal and source-precedence strategy; then evaluate evidence sufficiency and resolve to a known value or an explicit unresolved result. Corrections to value or collection time must affect admissibility before selection. Preserve excluded/superseded candidates and the reasons they did not govern the result. Unresolved competing evidence is retained as such.

Source tiers are permitted only within that contract. A provider attestation can take precedence over chart evidence for an authorized concept and interval when the contract permits that specific assertion kind and authority. A generic “provider” tier cannot make a stale, wrong-subject, incompatible-unit, or differently scoped statement admissible. Equally ranked conflicting candidates remain unresolved unless a supported, clinically approved tie rule establishes precedence; insertion order and last-write-wins are not tie rules.

A provider's precedence request is a typed input referring to an allowed strategy and scope. The compiler checks the strategy and bindings; the boundary authenticates the actor, and runtime checks the assertion's actual authority and validity. The input cannot replace the query's selection contract. Different queries may legitimately select different evidence because their declared clinical scopes differ; the selection trace must explain the difference.

### 4.5 Pathway discovery and applicability

Each pathway declares a required applicability Decision. An unconditional scope must be explicit. Distinguish discovery (which pathways to consider), applicability (whether a considered pathway's approved population/context criteria hold), and recommendation indication (whether an action is indicated within that scope). Diagnosis-code matching can support discovery without establishing applicability.

For recommendations initiated by that pathway, the compiler binds applicability into effective indication as defined in section 6.2. This binding is visible in the IR and trace and cannot be omitted by a node author. The applicability expression may read evidence and produce material needs but cannot depend on dispositions that it governs.

False applicability prevents new ordinary recommendations from that pathway. Unknown applicability is unresolved, not false, and can emit needs for the invoked pathway where resolving them could affect its results. Discovery/invocation bounds which pathways are evaluated; the system must not interrogate the provider about every pathway in the catalogue.

Applicability for new recommendations is distinct from continued responsibility for an already-established follow-up instance. Leaving an enrollment scope does not silently cancel an outstanding obligation. The longitudinal contract in section 7.1 governs continuation, completion, transfer, and cancellation.

### 4.6 Query-specific admissibility and evidence sufficiency

An observation is a historical record, not a globally valid or expired clinical conclusion. Suitability belongs to the observation–query relationship. The same measurement may be admissible for one question and inadmissible for another. Each candidate receives `Admissible`, `Inadmissible(reasons)`, or `UnresolvedAdmissibility(causes)` under a versioned typed contract. Preserve candidates, reasons and dependencies in the trace. Exclusion from one query does not delete or globally invalidate the observation. An unresolved candidate cannot be silently discarded when it could change selection or the conclusion.

Admissibility may depend on multiple anchors. V0 exercises course-completion-relative collection timing and evaluation-time freshness in E-01. Specialized treatment-change/last-administration admissibility for therapeutic drug monitoring is deferred until a dedicated clinical scenario and contract are approved. Require matching treatment, subject and episode identities. Unknown anchor history stays unresolved; selecting the latest known event is not proof that an unrecorded later event did not occur. Freshness names an assessment time: now, a recorded event or a hypothetical planning context. A current assessment can resolve now while a future-event assessment remains conditional and must be reevaluated; a predicted event never impersonates an actual event.

A calculation declares required observations, sample identity, coverage window, sampling contexts, comparability and acceptable gaps. Retrieval completeness and clinical sampling adequacy are separate: a fully fetched sparse log is still sparse. Insufficient evidence yields an explicit unresolved result or a supported bound, not merely a lower confidence score attached to an otherwise executable number. Unit conversion alone does not establish assay comparability; the query must declare the approved compatibility rule. Susceptibility belongs to its culture/isolate, not an arbitrary historical result.

A supported rule can inspect declared query states such as pending, unavailable or expired and recommend a reviewed contingency. It retains the original uncertainty; it cannot generically coerce Unknown to False. A pending collection is not a negative result or proof of completed coverage. Rich pending-result acquisition/UI workflows can be deferred without losing that distinction. No admissible measurement means unresolved measurement evidence, not absence of the clinical condition.

Absolute-value and baseline-relative assessments are independent expressions. If no baseline exists, the latter remains unresolved while the former may resolve. A reviewed fallback is explicit in source; `skip`/`traverse` behavior cannot silently supply clinical meaning.

### 4.7 Episode, subject and operational scope

Episode identity governs queries; a pregnancy start-date cutoff alone is not sufficient. Queries explicitly permit or exclude prior-episode history and prepregnancy baselines. Unknown episode assignment remains visible. Historical diagnosis assertions retain effective time, recorded time and provenance; retaining an old assertion does not make it currently active forever. Exclusive and overlapping classifications are scoped clinical constraints, not universal graph XOR rules. Reassessment preserves the earlier revision while deriving the current classification.

Operational facts such as facility resources or current availability have their own subject/context, authorized source and freshness. Institutional policy states requirements; it does not establish that a resource is available now. Clinical eligibility, operational readiness, patient selection/refusal and documented consent remain distinguishable.

Every action and fact has an explicit subject binding. Maternal facts can support an authorized handoff requirement without creating orders for an unidentified infant. Automatic related-patient execution is outside v0; a later capability must define authorized relationships and recipient identity.

### 4.8 Synthetic evidence and live adapters

V0 provides a declared `synthetic_snapshot` coverage kind for non-clinical scenarios. Completeness is explicit only within named concepts, sources, episodes and windows; a composed test patient is not globally complete by default. The trusted execution boundary marks the run non-clinical and clinical execution rejects synthetic snapshots and derived artifacts, including mixed bundles. A caller-controlled label cannot confer clinical authority. These inputs let Stage B/C test definitive negatives without live acquisition.

Stage D adds bounded adapter support for per-item provenance, temporal context and justified scoped coverage. An adapter cannot manufacture source completeness by setting a field; pagination, unavailable sources, pending results and missing context must remain represented. Production inputs cannot use synthetic coverage to bypass those requirements.

## 5. Node contracts

Each built-in contract defines typed ports, cardinality, required properties, expression restrictions, outputs, trace shape, and permitted relationship roles. Authors may specialize through parameters and composition, but not redefine the contract.

| Node kind | Inputs and responsibility | Outputs |
|---|---|---|
| EvidenceQuery | Declared subject/source/temporal/terminology requirements; admissibility, selection and sufficiency rules | Evidence<T>, candidate assessments, coverage, acquisition needs |
| DerivedValue | Pure typed expression over explicit inputs | Evidence<T>, derivation trace |
| Predicate | Pure comparison or logical composition, including required pathway applicability | Decision, supporting and unresolved dependencies |
| Recommendation | Explicit indications, prerequisites, exclusions, action definition | Base eligibility and ActionProposal; final disposition is a later output |
| Choice | Candidate base eligibility, declared cardinality, recorded selection | Selection state, alternatives, unmet choice need |
| Need | Typed missing measurement, attestation, clarification, or workflow requirement | Stable requirement identity and fulfillment status |
| EvidenceReference | Versioned citation or source reference | Provenance/review information |
| Group | Authoring organization and presentation | Membership; no implicit clinical execution |

Recommendation subclasses can carry medication, test, imaging, procedure, guidance, and follow-up payloads. Do not force all clinical actions into a medication-shaped schema. A follow-up proposal must carry its timing anchor, responsible role, and completion evidence requirement. Proposing an action does not prove that it was ordered, performed, or completed.

Quality metrics are derived outputs or separately declared checks. They cannot silently feed clinical eligibility unless connected through an explicit typed predicate. If an existing Criterion is used as a design example, classify it according to its actual role; its label alone does not determine whether it is evidence, a predicate, or presentation.

## 6. Relationship contracts and graph composition

### 6.1 Catalogue

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

### 6.2 Composition at the target

Each recommendation declares:

```text
A = pathway applicability Decision
I_local = explicitly composed recommendation indication Decision
I = all(A, I_local)  // compiler-established, traceable scope dependency
P = explicitly composed prerequisite Decision
X = explicitly composed exclusion Decision

baseEligibility = all(I, P, not(X))
```

Pathway applicability and a local indication are mandatory; unconditional values must be written explicitly. A recommendation that applies to everyone in the pathway writes `I_local = True` rather than omitting an indication. If the protocol has no prerequisites or no exclusions in scope, it must explicitly declare those empty groups, lowering respectively to `True` and `False`. Omitted required declarations are compile errors. An empty exclusion group does not waive checks required by the approved safety policy in section 8.1.

Preserve `I`, `P`, and `X` independently. A known exclusion is reported even if another operand makes base eligibility false. Unknown prerequisites do not become false. The UI can distinguish ineligible, unresolved, and excluded reasons without reverse-engineering a score.

Choice and safety are subsequent, explicit composition stages. A choice cannot retroactively change the clinical evidence that established eligibility. Safety constraints can withhold an eligible action; their absence does not establish eligibility.

### 6.3 Dependency graph

The **executable port/expression dependency graph** must be acyclic. It is distinct from the visible graph, which can contain citations, layout links, and relationships between different evaluation phases of the same node.

For example, Recommendation.baseEligibility → Choice.selection → Recommendation.disposition is legal: the later disposition does not feed base eligibility. Recommendation.disposition → its own eligibility is a cycle and is rejected. This distinction prevents choice handling from creating apparent or actual circular reasoning.

The compiler produces a stable topological order. Correctness must not depend on the tie-breaking order among independent expressions. Sequential execution is the initial implementation; parallelism is an optimization requiring equivalence tests.

### 6.4 Choices and alternatives

Support explicit `one_of`, `any_of`, and `all_of` selection cardinalities. Require the author to declare whether no selection is permissible. More than one eligible option in an exclusive automatic choice is an ambiguity, not permission to take the first. Unknown eligibility cannot be silently discarded to make an otherwise ambiguous automatic choice appear unique.

`one_of` selects exactly one candidate unless explicitly optional. `any_of` selects a declared nonempty subset unless explicitly optional; automatic mode includes every definitively eligible candidate and remains incomplete if relevant unknowns could change that set. `all_of` requires every declared candidate to be eligible and selected: an ineligible member produces an unsatisfied-group result, and an unknown member leaves the group unresolved. It never forces an ineligible action into the plan. Provider and automatic selection modes are explicit; a required group with no eligible selection emits a decision need, not a successful empty plan. Optional emptiness does not turn unresolved candidate eligibility into known absence.

Provider selection is a recorded input. An ineligible candidate is rejected as an ordinary selection; a permitted clinical exception uses the distinct exception mechanism in section 9. When an input change invalidates a prior selection, return a new choice need and invalidate the affected review.

A choice between coordinated bundles requires a separately specified bundle-selection capability: candidate membership, required versus optional actions, eligibility, completeness and review boundaries. Several independently indicated actions already fit ordinary Recommendation nodes; they need no implicit all-or-nothing bundle. V0 one-of over individual actions must not masquerade as selection of an entire surveillance regimen.

### 6.5 Relationship influence

Every relationship must have a declared role. Not every relationship must change action eligibility. Citations affect provenance; groups affect presentation; independently justified redundant constraints can be useful.

For executable dependencies, diagnose proven dead branches, ineffective guards, contradictory prerequisites, and unreachable actions where the supported analysis establishes them. A redundant constraint is initially a reviewable diagnostic, not a universal rejection. Required influence/coverage checks must be named obligations with defined scope and proof outcomes, not a blanket assertion that every edge matters for some clinically possible patient.

V0 requires a bounded, solver-free fragment: backward dependency tracing from executable results, Needs, explanations and declared exports; boolean constant propagation; ineffective-guard diagnostics within that fragment; and overlap analysis for literal/typed finite-enum equality conditions under an explicitly declared disjointness obligation. Finite-enum equality is type checked, rejects cross-domain comparisons and implicit string coercion, and lifts unknown operands to Unknown. Unsupported analysis reports “not analyzed”; it cannot claim a proof.

Unused local predicates/queries and provably constant-false candidates are reviewable diagnostics with source witnesses. Preserve legitimate provenance, exported definitions and independently meaningful findings as roots. Schema/type violations remain errors. Publication policy names any stronger required obligation and defines how counterexamples or inconclusive results block it. Overlap between eligible alternatives in a provider one-of choice is valid; v0 does not introduce automatic choice execution. No general patient-dependent reachability or clinical completeness claim follows from these checks.

## 7. Data acquisition, needs, and external models

EvidenceQuery nodes declare the evidence contract. They do not contain HTTP, SQL, GraphQL, or arbitrary adapter code. GraphQL remains an application API; FHIR and other source adapters operate outside evaluation.

A `Need` includes a stable key, subject/episode/encounter scope, requested type, code/value-set requirements, compatible units, temporal window, provenance/authority constraints, urgency, and affected outputs. Its key identifies the same unmet obligation across equivalent reevaluations, using the versioned requirement, scope and anchor identities rather than a random ID or evaluation revision. A materially changed requirement or scope gets a distinct identity. Deduplication preserves all affected outputs and reasons. Only material unresolved dependencies block their result, unless a separately declared review obligation applies. A fulfiller may query the chart, request a provider observation, or initiate an approved task. The workflow policy selects among permitted fulfillers; it cannot relax the evidence contract silently.

The acquisition loop is:

1. Evaluate a frozen input snapshot and emit unresolved needs.
2. An authorized orchestrator selects an allowed acquisition action.
3. Record success, failure, timeout, or explicit refusal as an event.
4. Normalize and validate returned evidence.
5. Evaluate a new revision; invalidate review if material inputs or outputs changed.

`fulfilled_by` validates subject, scope, type, units, time, provenance and authority against the requested evidence contract. Invalid, expired or wrongly scoped responses cannot close the Need. Accepted evidence triggers a new evaluation revision; acceptance of a response alone is not proof that every affected predicate is now known.

Need fulfillment is idempotent by request identity and bounded by attempt/deadline policy. A failed request stays unavailable. Repeated acquisition must not form an unbounded evaluate/fetch loop. An EHR query cannot conjure a measurement that has never been taken. An actual clinical order requires its own authorization and workflow; emitting a Need is not that authorization.

The core owns deterministic Need generation, materiality and fulfillment validation over recorded inputs. The orchestrator owns selecting ask-provider, EHR-query or a hybrid strategy under approved workflow policy, plus dispatch, retry/deadline enforcement and outcome persistence. Stage B tests the pure contracts; C-01 exercises a controlled fulfiller through the application loop, including failure and repeat requests; Stage D validates actual EHR/provider adapters and strategy selection. No Stage B test alone establishes a bounded real acquisition loop. Exhausted/refused attempts remain explicit and cannot restart endlessly merely because evaluation runs again.

LLMs can produce proposed extractions, classifications, or summaries as recorded external observations. Record model identifier/version as available, prompt/template digest, source material identifiers, acquisition parameters, result, and review status. Model confidence is metadata, not clinical truth. A high-impact predicate may consume such an observation only through an approved evidence contract, including attestation where required. No LLM execution occurs inside the pure core, and no LLM invents a missing fact to make a pathway resolve.

### 7.1 Longitudinal state and follow-up instances

Progress across encounters is derived from recorded clinical/workflow evidence, the approved protocol, and the explicit evaluation clock. A mutable “current step” pointer is not clinical truth. Materialized progress views are caches of that derivation and must be reproducible.

Give each established follow-up an action-instance identity distinct from its reusable pathway node ID. Record patient/episode binding, originating proposal and approval, protocol version, anchor event, timing rule, due window, responsible role, completion criteria, and authorized changes. Orders placed, actions performed, results received, cancellations, deferrals, transfers, and corrections are different events. An order alone does not establish completion. A historical completion cannot satisfy every recurrence of the same node; the completion contract binds it to an instance or explicitly permits reuse.

For a supported fixed-duration follow-up window `[dueStart, dueEnd]` whose end is a preferred deadline, an active, still-applicable, uncompleted instance is `not yet due` when the evaluation clock is before `dueStart`, `due` within the window, and `overdue` after `dueEnd`. Zero-width windows are permitted only when explicitly authored. Missing or ambiguous anchors/timing evidence yield `unresolved`, not an invented deadline. Completed, cancelled, deferred, and transferred states have their own event/authority rules; deferral preserves the old schedule and records the authorized new one. These progress states are separate from recommendation disposition and do not override clinical stop/reassessment rules (section 7.2).

Record valid/event time separately from recorded time. Historical replay uses what was known in that revision. A late-arriving completion or correction can change current progress in a new revision without rewriting the historical result. A retracted completion can reopen an obligation under the approved contract.

The orchestrator arranges time-based reevaluation where required, recording a clock advance even if no new chart data arrives. Evidence or dating corrections create new revisions and surface material changes to previously shown/reviewed results, including within the same encounter. Re-querying only at a future encounter is not a complete invalidation strategy. Queries and prior approvals remain pinned to their versions unless explicitly migrated. A change in pathway applicability cannot erase outstanding instances; any closure or transfer requires its own declared rule and supporting event.

### 7.2 Planning, performance and expiration

Do not overload one validity window with several clinical and operational meanings:

| Attribute | Meaning |
|---|---|
| Planning/ordering permission | Whether an action may be proposed, reviewed or ordered now |
| Performance window | When the action is intended to occur |
| Preferred deadline | When an unfinished action becomes overdue |
| Clinical applicability/stop condition | Whether the action remains appropriate; may require reassessment or cessation |
| External order expiration | Operational lifetime required by the receiving system's contract |

A proposal can be eligible for advance ordering while its performance is not yet due. The source explicitly distinguishes planning eligibility from performance readiness; the API/UI must not flatten them into one active flag. Passing a soft deadline does not automatically cancel an obligation. Conversely, no language invariant permits indefinite performance after every clinical window closes. Apply the authored stop/reassessment rule and preserve unresolved obligations and findings. An external order expiration is neither a clinical deadline nor authority to continue treatment; adapters record its mapping and renewal needs separately.

An encounter-relative offset binds to the originating encounter when the action instance is established. Later encounters do not reset it. Rescheduling requires a supported authorized event and review, retaining the previous schedule. A future stop event can define an event-ended schedule before it occurs, but current episode status still needs evidence; no delivery row is not proof of an ongoing pregnancy.

V0 supports a single fixed-duration performance window, separate planning permission and soft deadline, plus explicit current stop/reassessment predicates. General repeated/event-ended regimen scheduling is a later capability. That capability must define occurrence identities, bounded materialization, missed occurrences, late entry, corrections and closure. Clinical repetition across frozen revisions does not require graph recursion within an evaluation.

### 7.3 Treatment lifecycle proposals

Define typed intent to initiate, continue, modify, hold, resume or discontinue an identified treatment/obligation. A switch identifies what is replaced and the required transition conditions. These are reviewed proposals, not mutations or evidence that administration occurred. Withholding or omitting a new recommendation does not stop an existing treatment. Completion, cancellation and discontinuation are distinct recorded events.

The v0 execution profile supports initiation proposals and the single-instance completion/cancellation contract only. It rejects executable treatment modification, hold/resume, discontinuation and switch plans until their event/authority and conformance contracts exist. Required clinical behavior cannot be hidden in free text to claim support. Acute titration, cumulative-dose calculation and automatic repeated regimens are separately gated, and never imply autonomous administration.

## 8. Recommendation disposition, safety, and multi-pathway composition

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

### 8.1 Safety coverage

Safety queries carry scope and coverage: knowledge source/version, candidate universe, supported code mappings, reference freshness policy, and unresolved items. Unmapped allergies, unsupported medication identity, unavailable reference data, and unimplemented checks cannot appear as completed negative assessments.

Not every action requires every conceivable safety check. Required clinical checks come from an explicit, versioned, clinically approved safety-policy artifact adopted for the institution and intended use. The pathway may add requirements within that policy. The interpreter supplies typed capabilities, coverage states and enforcement; it does not invent hidden clinical requirements.

Clinical neutrality of the interpreter does not imply that the deployed product has no minimum supported-use policy. Prism's clinical governance and the institution may establish required checks for a supported action class or clinical claim. Those requirements must be visible, approved, and pinned rather than hard-coded as unexplained interpreter behavior. An institution cannot silently disable an adopted mandatory check by omitting it. Unsupported policy/capability combinations cannot be published for that intended use.

A required unknown check blocks finalization of its affected action and, in v0, the requested scope containing that required action; see section 8.3. A known exclusion or required safety hold is preserved as a finding and, where relevant, a withholding reason; an unrelated score or acknowledgement cannot clear it. Omission of a requirement and an explicitly approved statement that a check is outside scope are different configurations.

### 8.2 Composition across pathways

Namespaced node identities prevent collisions. Evaluate contributing pathways against the same evidence revision and release-bundle manifest. V0 action equivalence uses a versioned canonical key over subject/episode, action concept and intent, target/recipient, formulation/route/dose where applicable, timing/anchor/instance scope, and other decision-affecting payload fields. Stage A must enumerate those fields per supported action type. Display names and equal codes alone do not establish equivalent clinical intent.

Coalesce only proposals whose supported equivalence contract establishes the same action. Retain every contributing source, indication/disposition trace, evidence link and review/safety obligation; requirements accumulate rather than being erased by deduplication. An unresolved required contribution cannot be hidden behind a ready equivalent proposal. Canonical output is invariant to pathway order. Distinct nonconflicting actions remain distinct. When equivalence cannot be established, preserve separate proposals and expose the potential duplication/conflict; do not guess a merge.

Incompatible dose/timing/intent or conflicting supported constraints produce an explicit unresolved composition obligation, blocking finalization when required in the requested scope. V0 does not synthesize a compromise dose, choose a winning pathway or silently suppress one source. Known withheld/not-applicable outcomes remain distinguishable from unresolved composition; not every non-proposed action is itself a blocker. A resolved combined proposal remains subject to candidate-set safety and review.

Run candidate-set safety and conflict analysis over the complete relevant universe, including current patient therapies and provider-added proposals. Preselection candidate eligibility, selection, and final safety disposition are ordered stages. Do not repeatedly suppress alternatives and reselect until a convenient stable plan emerges; if a selected option is withheld, return a new decision need unless a separately specified fallback rule establishes a result without feedback cycles.

An individually valid pathway is not proof that its combination with another is valid. Cross-pathway contradiction and safety cases belong to the acceptance corpus. A write-in proposal enters the same validation, safety, review, and materialization boundary.

### 8.3 Partial results and clinical urgency

An unresolved component must not erase independently established findings, urgent flags, or needs. Return them with explicit incomplete status. Urgent findings cannot depend on completion of an unrelated routine branch. This guarantee applies to successfully evaluated findings, not to unexecuted work after an engine failure; a failed run cannot claim complete assessment or absence of urgency.

V0 finalization is atomic over the whole explicitly requested scope, including its required dependencies and contributing safety context. Required unresolved obligations anywhere in that scope block finalization; independently established findings still remain visible. Partial finalization of subgroups is unsupported and belongs in section 13. Pin the requested scope in the reviewed artifact; neither the UI nor orchestrator may silently shrink it to bypass an unresolved dependency. A deliberately changed scope requires a new evaluation and review and cannot omit dependencies needed for the retained actions.

Invariant violations and resource exhaustion block successful finalization. They do not return an empty list that could be mistaken for “nothing to do.” Engine failure is a workflow-visible failure; it is not a clinical recommendation to withhold care.

## 9. Provider assertions and institutional policy

### 9.1 Distinct input actions

| Action | Meaning |
|---|---|
| Observation | Adds a measured/reported fact with provenance and valid time |
| Correction | Supersedes a specific erroneous record while retaining its history |
| Attestation | Records a scoped statement by an authorized person |
| Choice | Selects among alternatives under a declared choice contract |
| Clinical exception | Records an authorized deviation from an established recommendation/hold |

Do not collapse these into a generic “override” that forces node status. Each has a subject, scope, author, reason where required, recorded time, effective interval, expiry/retraction rules, and source references. Expiry is evaluated against the pinned clock; advancing time creates a new revision.

A provider can request precedence only through the applicable EvidenceQuery's approved selection contract in section 4.4. This is an explicit authorized request to apply a permitted strategy, not a generic provider override of admissibility or the query contract. The compiler checks the permitted strategy and binding; the orchestrator verifies actor authority and runtime verifies scope/time validity. Contradictory chart evidence remains visible. A clinical exception changes permitted disposition under a specific policy; it does not rewrite the original evidence or claim that the underlying predicate became true.

### 9.2 Bounded institutional variation

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

### 9.3 Institution configuration binding

The orchestrator must resolve the institution from authenticated, authorized session context and bind an approved immutable configuration artifact before a clinical run. The release/session manifest records institution identity, policy version/digest, approval identity, and supported-use profile. Patient/encounter access must be authorized for that institution; a caller-supplied institution ID is not sufficient authority.

This contract does not require a deployed institutions microservice. A versioned database-backed configuration store or another authenticated artifact provider can implement it. Its storage/API and operational ownership belong in the orchestrator implementation specification. A missing or ambiguous institution binding blocks a clinical run; preview must use an explicitly identified test configuration and cannot silently substitute it for clinical policy.

## 10. Compiler and verification model

### 10.1 Compiler stages

1. Parse and schema-validate canonical source; enforce size/depth limits.
2. Resolve pinned library, terminology, action-definition, and policy references.
3. Expand nonrecursive templates with source maps; resolve stable identities.
4. Type-check expressions, dimensions, ports, units, parameters, and collection bounds.
5. Validate relationship endpoints, cardinality, ownership and target reducers.
6. Construct the executable port graph; reject cycles, undefined reads and unsupported effects.
7. Check required applicability/indication declarations, scope bindings, choice modes, graph reachability, evidence selection/precedence and acquisition contracts, and setting-specific policy composition.
8. Run supported symbolic analyses, producing named proof outcomes.
9. Emit immutable IR, required capabilities, dependency indices, diagnostics, source maps, and a compilation manifest, artifact execution mode and completeness diagnostics.

The editor may retain invalid drafts and display diagnostics; execution never accepts invalid programs. The narrowly defined hole-preview contract in section 2.3 accepts well-formed incomplete drafts only as preview artifacts, not clinical packages. Unsupported operations and language/capability versions fail explicitly in either mode. Publication checks completeness, required rationale, capability support and authority.

### 10.2 What can be established

| Verification layer | Example | Guarantee boundary |
|---|---|---|
| Schema and type checks | Numeric threshold has the right quantity dimension | Checks representation and operation compatibility, not clinical appropriateness |
| Structural analysis | Required input bound; executable dependency graph acyclic | Checks declared program structure |
| Symbolic analysis | Two exclusive branch predicates overlap | Conditional on the supported expression fragment and modeled input constraints |
| Scenario validation | Approved inputs yield expected actions and needs | Evidence over those cases, not all possible patients |
| Clinical review | Rule and action reflect applicable evidence and intended use | Human-governed approval, independent of compilation |
| Runtime validation | Actual evidence satisfies the declared contract | Depends on source fidelity, coverage, and retained provenance |

Use separate statuses: `wellFormed`, `analysisResults`, `clinicalApproval`, `publicationApproval`, and `runtimeReadiness`. Do not expose a single unqualified “verified” badge.

### 10.3 Symbolic fragment and outcomes

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

The solver is a development/publication tool, not a dependency for patient-time execution. Start with direct analyses and add a solver only for obligations that need it. Solver selection and its precise theory/encoding require a small follow-up specification; this specification does not select one prematurely.

### 10.4 Diagnostics

Diagnostics include stable codes, source span or AST path, node/edge identifiers, violated contract, relevant dependency path, and a concrete repair explanation. Examples:

- `UNIT_DIMENSION_MISMATCH`: threshold and measurement cannot be compared.
- `UNBOUND_REQUIRED_INPUT`: completion evidence has no declared source.
- `AMBIGUOUS_COMPOSITION`: several indications have no all/any expression.
- `CYCLIC_EXECUTION_DEPENDENCY`: a final disposition feeds its own eligibility.
- `UNSUPPORTED_NEGATIVE_EVIDENCE`: absence is used without a coverage contract.
- `EXCLUSIVE_BRANCH_OVERLAP`: witness satisfies both automatic alternatives.
- `UNSUPPORTED_PROOF_FRAGMENT`: requested obligation could not be analyzed.
- `UNRESOLVED_AUTHORING_HOLE`: draft definition is incomplete and cannot publish.
- `QUERY_ADMISSIBILITY_UNRESOLVED`: required sampling, timing or context evidence is unresolved for this query.
- `INSUFFICIENT_SAMPLING_EVIDENCE`: retrieved observations do not satisfy the supported calculation's evidence contract.
- `UNBOUND_TEMPORAL_ANCHOR`: authored timing has no explicit event/date binding.

Diagnostics must refer to authored concepts, not only generated IR indices.

## 11. IR, execution, and explanations

### 11.1 The authoritative IR

The IR contains typed opcodes, stable source identities, resolved constants and library references, evidence-query/admissibility/sufficiency/selection contracts, explicit event anchors and context-time bindings, typed port bindings, explicit applicability dependencies, target reducers, execution phases/order, action payloads, choice contracts, follow-up instance templates, effective policy and its provenance, explanation descriptors, and capability/version requirements. Retain a source map from every executable operation to its node, relationship, or library definition.

Raw AST and stored graph rows are not executable at runtime. Only successfully compiled, supported IR is accepted. Define a new, explicitly versioned IR/compiler contract for the fresh-start system. Compatibility with the phase-1 `CompiledPathway` and an adapter for legacy artifacts are not required.

The artifact loader validates schema, capabilities, digest, release identity and authorized provenance. Accepting a caller-supplied object that merely resembles IR is not a compilation boundary. Clinical runtime requires an approved complete release and rejects preview-only artifacts. Explicit preview uses a separately authorized execution context and tagged artifact type, including hole markers where supported. Preview output cannot be finalized as clinical orders or promoted merely by changing its label.

### 11.2 Pure interface

Conceptual API, not a final TypeScript signature:

```text
compile(source, pinnedCatalogues, effectivePolicy)
  -> CompileFailure | CompiledPackage

compilePreview(draftSource, pinnedCatalogues, effectivePolicy)
  -> CompileFailure | PreviewPackage

evaluatePreview(previewPackage, frozenEvidence, recordedInputs, previewContext)
  -> EvaluationFailure | PreviewResult

evaluate(compiledPackage, frozenEvidence, recordedInputs, evaluationContext)
  -> EvaluationFailure | EvaluationResult
```

These entry points share one compiler and evaluator kernel with explicit mode/artifact checks. They do not introduce a second interpretation of clinical operators. Preview extends the result domain with incomplete-authoring markers; clinical execution accepts no such markers.

`EvaluationResult` contains per-node values, explicit applicability, candidate admissibility and sufficiency assessments, separate eligibility/selection/safety/disposition, planning and performance readiness, action-instance progress, needs, review obligations, explanation records, semantic digests, and input/output revisions. `PreviewResult` additionally carries incomplete-authoring markers and cannot satisfy clinical readiness. It does not write a database, call an LLM, perform an EHR query, or materialize orders.

The orchestrator owns acquisition, identity/authorization, event persistence, optimistic concurrency, review acknowledgements, and transactional materialization. It cannot substitute new clinical decisions after evaluation. Safety composition is part of the defined evaluation contract, even if implemented as a separate pure phase.

### 11.3 Determinism and resource behavior

Canonicalize unordered collections and trace records by stable identity; preserve clinically meaningful order explicitly. Avoid locale-dependent collation, implicit timezone conversion, map iteration as tie-breaking, and floating-point reduction order. Duplicate observations are reconciled by declared identity/version rules, not by accidental equal values.

Specify limits for source size, expanded nodes, facts per query, expression depth, collection operations, and evaluation work. A deterministic operation budget has defined failure behavior. A host timeout/crash is separately recorded as execution failure; it never produces a successful partial clinical result. Wall-clock duration and operational logs are excluded from semantic hashes.

Incremental evaluation is deferred. Reevaluate from frozen inputs first. Any later caching/incremental engine must be observationally equivalent to fresh evaluation, including needs and explanations, and must preserve the same language version.

### 11.4 Explanations

Produce structured records during execution: rule/relationship identifiers, input evidence identifiers, relevant values and units, candidate admissibility/rejection reasons, sampling sufficiency, timestamp roles and context versions, applied temporal selection, composition outcome, unresolved causes, and versioned policy sources. Distinguish “predicate false” from “not evaluated because of an engine failure” and from “eligibility established, later withheld.” Preview also distinguishes incomplete authoring from missing patient evidence.

Render human-readable explanations from these records. LLM wording may summarize, but cannot be the sole explanation or alter the recorded rationale. Preserve positive and negative reasons and all material unresolved dependencies. A minimal proof tree alone is not the complete clinical explanation contract; Soufflé's [provenance facility](https://souffle-lang.github.io/provenance) is useful inspiration, not a replacement for it.

## 12. Initial capability profile

`ppl-core-v0` is the initial implementation capability profile, not permission to reinterpret the full language. Published artifacts declare required language/capability versions. “Declared but unsupported” means the construct is recognized and rejected during compilation; it is not accepted for execution with approximate semantics. A future capability extension requires versioned conformance cases.

Stage A fixes only the contracts needed for the supported v0 column, including one numeric profile, rather than implementing the full semantic catalogue. Stage B enforces them. It must preserve uncertainty for real inputs outside that supported data fragment rather than falsely normalizing them into it.

| Capability | Stage B must implement and enforce | Declared but rejected or deferred |
|---|---|---|
| Source and graph | Canonical AST; typed bindings and draft holes; preview-only incomplete artifacts; rationale/citations; explicit applicability; all/any/not; typed finite-enum equality; acyclic dependencies; disposition reducer | Textual parser, executable recursion, custom opcodes/callbacks; publication of unresolved holes |
| Decisions and evidence | Known true/false and unknown; missing/conflicting/unavailable/invalid/inadmissible/insufficient-evidence causes; traces; no implicit absence-as-false | No deferral of uncertainty semantics |
| Clinical quantities | Published bounded decimal profile; exact comparisons; whitelisted conversions; no clinical difference/rate operator in v0 | Paired-value difference/two-point rate, general arithmetic, unsupported conversions, inferred assay equivalence and unqualified numeric coercion |
| Temporal evaluation | Pinned clock; explicit timestamp roles and actual event anchors; fixed-duration windows; known-date pregnancy day-count calculation; versioned context lookup; context at assessment versus collection; observation-pair separation and definite-latest | General calendar-period arithmetic, timezone-local recurrence, full partial-date interval reasoning, opaque reference-range resolvers |
| Admissibility and sufficiency | Query-specific admissible/inadmissible/unresolved assessment using supported expressions and multiple event anchors; sampling/comparability requirements; scoped evidence-status predicates; E-01 completion and assessment anchors | TDM-specific treatment-change/administration anchor checks, baseline-relative calculations, arbitrary clinical validity inference, dropping material uncertain candidates, confidence-based substitution for insufficient evidence |
| Needs and acquisition boundary | Stable Need identity/materiality; typed `fulfilled_by` checks; recorded attempt/outcome inputs and pure reevaluation contract | Core I/O or automatic ordering; live fulfiller selection/retries are orchestrator integration, validated in C/D |
| Composition across pathways | Canonical action equivalence, retained contributing provenance/obligations, explicit duplicate/conflict outcomes | Heuristic merges, pathway-priority winners, automatic compromise plans |
| Urgency and finalization scope | Preserve established urgent findings despite unrelated uncertainty; requested-scope readiness and atomic whole-scope finalization contract | Partial-group finalization, silent scope reduction, complete-assessment claims after engine failure |
| Coverage | Scoped complete/incomplete/unavailable contract; explicit non-clinical synthetic snapshots for B/C; coverage distinct from sampling adequacy; negative conclusions require sufficient evidence | Federation of coverage domains, synthetic coverage in clinical runs, automatic reconciliation of completeness claims |
| Collections | Bounded filtering, membership/existence, definite-latest and explicit identity-distinct observation pairing with declared selection contracts | Generic counts/percentages, regression/trends, arbitrary aggregation/joins; deducing persistence from duplicates |
| Assertions | One query-declared, versioned admissibility/precedence strategy per query; typed observations/attestations and explicit authorized correction/supersession; scope, expiry and conflict handling | Arbitrary precedence programs, undeclared runtime strategy changes, general clinical-exception workflows and dedicated provider observation-reliability adjudication workflows |
| Choices | Explicit recorded one-of selection over typed candidates with eligibility validation; an unselected required choice remains a Need | Automatic ranking-driven selection and any-of/all-of modes until their conformance cases are implemented |
| Policy | Typed parameter bounds, allowed setting levels, accumulated mandatory requirements, narrowed permissions, authenticated-context input contract | Generic policy scripting and clinician-created semantic profiles |
| Follow-up | One fixed-duration action instance; immutable originating anchor; planning permission, performance window and soft deadline distinct; current stop/reassessment predicates; ordered/completed/cancelled events; due state and completion identity | Repeated/event-ended regimen scheduling, calendar recurrence, automatic rescheduling, transfers/deferrals beyond supported events |
| Treatment and subjects | Initiation proposals; explicit subject/episode identity; authorized handoff recommendations; clinical versus operational readiness | Executable modify/hold/resume/discontinue/switch protocols, acute titration/cumulative-dose execution, automatic related-patient actions |
| Review and replay | Canonical semantic/review digests and pure replay from a supplied frozen artifact/input bundle; material changes invalidate review | Production artifact retention, live acquisition and transactional finalization are integrated in C/D, not simulated as complete in B |
| Verification | Schema, types, dimensions, binding/cardinality, required declarations, cycle rejection and deterministic-result conformance; bounded unused-dependency, constant-impossibility, ineffective-guard and literal/finite-enum disjointness diagnostics (section 6.5) | General or solver-based coverage/influence proofs and a universal clinical “verified” status |

Unsupported *program operations* fail compilation. Unsupported or incomplete *patient evidence* remains visible: a partial timestamp needed for selection, an unrecognized unit, missing mapping, or incomplete source coverage makes the affected query unresolved with a diagnostic/Need. Do not silently drop the evidence, claim full coverage, or reject all unrelated valid findings. Invalid/untrusted executable artifacts remain execution failures.

“Snapshot complete within scope” must be attested by the adapter against a named source/query contract, including pagination and failures. A successful API response or a stored snapshot row does not establish completeness of the patient's clinical history. V0 can represent scoped absence only for the question that contract can actually answer.

None of the eight clinical documents is claimed to be fully executable within v0, and a complete anemia pathway is not a v0 requirement. Stage C inventories the requirements of its selected source clinical content; unsupported operations either receive a separately specified capability extension or block publication for that intended use. A deliberately smaller validated scope is acceptable and must be labeled as such. Missing content cannot be presented as a complete clinical package; preserving every old pathway or JSON construct is not a requirement.

### 12.1 Version identities and compatibility

Use the following names consistently; these are distinct manifest fields, not competing names for one release:

| Identity | Meaning and required pinning |
|---|---|
| `languageVersion: "ppl-1"` | The versioned semantic contract: types, operators, composition and uncertainty. The example spelling is the canonical identifier for the initial language under specification; it is not a claim of a shipped implementation. |
| `capabilityProfileVersion: "ppl-core-v0"` | The initial supported subset and limits of `ppl-1`, plus its operator/numeric/temporal profile references. A profile cannot reinterpret its language version. |
| Compiler and runtime versions | Exact implementation builds plus source-schema/IR-format versions and conformance compatibility declarations; a build number alone does not imply support. |
| Clinical package version | The authored pathway/library content release, with immutable artifact digest and approvals; independent of engine versions. |

Manifests record exact identities and artifact digests. The loader checks an explicit supported combination of language, capability/profile references, IR schema and implementation; no inference from names or matching major-version digits is sufficient. Unsupported combinations fail before clinical evaluation. Content, profile and implementation upgrades have separate review/conformance obligations. Any change to semantic meaning requires the applicable versioned contract review, not reuse of an old identifier with different behavior. Stage A finalizes the registry/compatibility schema before exit.

## 13. Deferred capabilities

After the initial slices, specify and validate capabilities separately before enabling clinical packages that require them:

- Paired-value differences, baseline-relative assessments and two-point rates: separately specify baseline selection, units, elapsed-time and precision rules and add a meaningful clinical integration scenario before promotion.
- TDM-specific admissibility tied to treatment changes and last actual administration; ordinary explicit time predicates do not establish support for this workflow.
- Bounded episode counts and context-grouped percentages, including denominator, duplicate, missing-sample and coverage rules; coordinated bundle choices.
- Repeated/event-ended schedules with stable occurrence identities and closure, missed-occurrence and correction contracts.
- Treatment changes, hold/resume/discontinue/switch, acute sequencing and cumulative-dose constraints, with actual administration evidence and human execution authority.
- Dedicated provider reliability assertions with observation/query scope, reason, authority, effective time and correction/expiry; these never delete source observations or provide a generic bypass of mandatory evidence conditions.
- Authorized related-patient workflows beyond explicit handoff obligations.
- Independently finalizable partial groups: require explicit dependency/safety isolation, scope and review contracts before support; v0 finalizes the whole requested scope only.

These gates are not promises that every feature will be implemented before a scoped launch. A package either declares supported capabilities and an honestly bounded intended use, or publication is blocked. Repeated evaluation over recorded events preserves the acyclic core; it does not justify arbitrary execution loops.

## 14. Capability-to-scenario matrix

A row's B identifier names a required conformance family; it is not an existing test implementation. Each family must be expanded into concrete inputs/expected outputs in Stage A, then implemented and passed in B. Clinical C/E scenarios additionally pass through source compilation and the applicable application boundaries. Resource, authoring and security rows use C-03 rejection evidence rather than a fabricated clinical use.

| v0 capability / obligation | Why it is needed | Stage B conformance family | Required C/E scenario |
|---|---|---|---|
| Canonical AST, typed ports, source maps, acyclic graph | One inspected executable meaning | B-01: round-trip structure, duplicate/ambiguous bindings, type and cycle rejection | C-01, C-03 |
| Typed holes, rationale and preview mode | Author without inventing clinical rules | B-02: hole propagation, global publication rejection, rationale identity | C-03 |
| Applicability, all/any/not, eligibility/disposition | Explicit composition and uncertainty | B-03: truth tables, indication/exclusion/prerequisite reasons | C-01, C-02 |
| Evidence causes and material uncertainty | Missing data is not clinical falsity | B-04: missing/conflicting/unavailable/invalid/inadmissible/insufficient cases | E-01, C-02 |
| Typed quantities and approved conversions | Comparable threshold inputs | B-05: dimensions, equivalent units, bounds, overflow, unsupported conversions | E-02, C-02 |
| Fixed clock, event roles and duration windows | Completion-relative follow-up | B-06: anchor identity, inclusive boundaries, collection versus receipt, unknown precision | E-01 |
| Pregnancy day count | Interpreting episode-specific temporal context | B-07: dated reference, clinical-date basis, dating correction, boundary uncertainty | E-02 |
| Versioned contextual lookup | Explain which approved context rule was used | B-08: lookup key/version, missing/overlapping entries, collection versus current context | E-02 |
| Distinct observation pairing and separation | Repetition cannot be inferred from duplicate rows | B-09: identity, min/max separation, corrections, ordering invariance | E-02 |
| Query-specific admissibility with multiple ordinary anchors | Collection suitability and present relevance are different questions | B-10: completion/collection/assessment predicates, per-query reasons, unknown candidate | E-01 |
| Bounded filter, membership/existence, definite-latest | Select evidence without arbitrary aggregate programs | B-11: filter scope, existence under partial coverage, unresolved latest ties | E-01, E-02 |
| Coverage, sampling adequacy, query-state contingencies | Empty, pending and insufficient data differ | B-12: scoped negative, retrieval versus sampling, explicit unavailable/pending branch | E-01, C-02 |
| Method/specimen/reference context and episode binding | Similar-looking records can answer different questions | B-13: wrong context/episode/isolate, incompatible assay, missing metadata | E-01, E-02 |
| Synthetic snapshot isolation | Test negatives without inventing clinical completeness | B-14: scope validation and trusted non-clinical provenance | C-03; C-01/C-02 use valid synthetic inputs |
| Observations, attestations, corrections and precedence | Traceable authorized evidence updates | B-15: authorized precedence over chart evidence; refused expired/wrong-scope requests; retained conflict trace | E-01, E-02 |
| One-of selection over two alternatives | Choice, refusal and consent obligations are distinct from eligibility | B-16: none/one/multiple selections, explicit refusal, outstanding consent and invalidated selection | C-02 |
| Medication proposal and required allergy/interaction checks | Exercise the central safety/finalization path | B-17: mapped/unmapped findings, clear/incomplete coverage, hold/no auto-reselection | C-02 |
| Parameter specialization, mandatory requirements and permissions | Institutions configure content within fixed rules | B-18: bounded values, accumulating checks, intersecting authorities, authenticated binding | C-02, C-03 |
| Planning/performance/deadline/stop/expiration distinctions | Future work is not equivalent to active or indefinitely valid work | B-19: not-yet-due/due/overdue/reassessment and separate order expiry | C-01, E-01 |
| Single-instance initiation, completion/cancellation, stable anchors | Reevaluate without moving deadlines or fabricating completion | B-20: event identity, order versus completion, late events, fixed originating anchor | C-01, E-01 |
| Subject scope, operational readiness and handoff proposal | Handoff intent is not communication completion or recipient treatment | B-21: positive typed handoff, subject/role/authority binding, fulfillment evidence, no implicit related-patient order | E-01, C-01, C-03 |
| Pure deterministic results, explanations and frozen replay | Reproduce why an action was proposed or blocked | B-22: permutation/metamorphic cases, context versions, stable semantic traces | C-01, C-02, E-02 |
| Review identity and material-change invalidation | Stale review cannot authorize changed action | B-23: dose/evidence/rationale/context changes and review digests | C-02, C-03, E-01 |
| Artifact validation and failure boundaries | Invalid/unsupported execution cannot appear ready | B-24: unsupported language/profile/IR/build combination, tamper, budget failure, missing dependencies | C-03 |
| Public core boundary | Keep clinical semantics independent of application infrastructure | B-25: isolated build/import enforcement and public API harness | C-03 |
| Needs and fulfillment | Turn missing material evidence into a traceable obligation | B-26: stable keys, materiality/deduplication, `fulfilled_by` checks, idempotent outcomes and attempt-state reevaluation | C-01; C/D integration additionally verifies bounded acquisition and fulfiller policy |
| Cross-pathway action composition | Preserve meaning and safety when packages overlap | B-27: canonical equivalence, order-invariant coalescing, retained source obligations, unestablished equivalence and conflicts | E-01, E-02 |
| Independent urgency and requested-scope readiness | Expose urgent findings without falsely finalizing an incomplete plan | B-28: urgent findings with unrelated Unknown; whole-scope blockers; scope identity and failure status | C-01, E-02, C-03 |
| Bounded relationship analysis | Expose structural mistakes without asserting universal clinical validity | B-29: meaningful output roots, unused declarations, constant-false candidates, ineffective guards, typed enum equality and lifted Unknown, explicit disjointness witnesses, unsupported-analysis status and provider-choice overlap | C-03 |
| Minimal authoring surface | Review and change supported meaning without reading raw JSON | B-30: canonical graph/details projection, node/edge/field source navigation, revision-safe edit/recompile, structured preview and stale-response rejection | C-03; supports C-01/C-02/E-01/E-02 review |

B-30 covers pure projection/source-map and preview-response contracts in Stage B; actual canvas navigation, persistence, asynchronous response handling and editing are application/UI integration evidence in C-03. The core never imports the UI.

Transactional finalization and live acquisition are application integration obligations rather than pure Stage B operators: C-02 covers idempotency/concurrency/review, and Stage D covers the live adapters. Stage B supplies the pure result/review contracts those integrations consume. Every capability-profile row above has B and C/E coverage; finer operator signatures must inherit or add explicit case mappings before Stage A closes.

**Deferred for lack of a required initial integration scenario:** paired-value difference, baseline-relative calculation, two-point rate, and specialized treatment-change/last-administration admissibility. Observation pairing remains independently justified by E-02. Keeping a capability in the broader catalogue or corpus does not promote it into v0.


## 15. Required integration scenarios

The [Level 3 story plan](2026-10-01-pathway-language-level-3-story-spec.md) assigns complete packet assembly to I01.1.a (C-01), M01.4.b (C-02), I01.2.a (C-03), I01.1.b (E-01) and G01.2.b (E-02, including X01.2.b composition). Each owner records every required case and inherited acceptance gate, not just a happy path. Missing primitives become explicit dependencies rather than hidden work inside integration stories. Clinical reviewers remain required and unassigned until named in section 17.

All scenarios below are required, not completed tests. Stage A must select and record exact clinically reviewed content, source versions, parameters, candidate identities and expected outputs before exit. Symbolic labels such as Medication A/B are scenario requirements, not executable medication definitions or permission to invent treatment choices. Clinical owners may reject or narrow a proposed scenario; its capability mapping must then be revised or deferred. Use synthetic patients with explicit scoped coverage for C/E testing; Stage D must validate corresponding live-adapter behavior before clinical use.

Every clinical scenario runs authored canonical source through compilation, evaluation, explanation, review and the applicable finalization boundary. Patient uncertainty, authoring incompleteness and execution failure remain distinguishable. Relevant positive, negative, missing/conflicting and boundary cases are mandatory. Protective scenarios explicitly exercise rejection instead of successful clinical execution.

### 15.1 C-01 — GERD initial assessment and follow-up

Author a clinically adjudicated initial-assessment slice with applicability, alarm assessment, concurrent counseling, independently indicated escalation/referral and one follow-up. Exclude computed percentage response, treatment sequencing, endoscopy management and autonomous actions.

Acceptance variants:

- Alarm finding remains visible and drives its independent assessment/referral even if ordinary symptom treatment is not applicable or another branch is unresolved.
- Missing/refuted applicability and conditional counseling exercise the three-valued reducers; group layout cannot create eligibility.
- A missing material alarm-symptom attestation emits a stable Need. Reevaluate unchanged evidence and confirm the same key without duplicated acquisition. A controlled provider fulfiller returns an authorized scoped attestation; `fulfilled_by` validates it, records a new revision, reevaluates and requires the resulting review. Wrong-subject, expired or wrong-type responses do not close the Need. Verify an immaterial unknown does not create a blocking Need unless independently required.
- Exercise duplicate responses, refusal, unavailable acquisition, retry/deadline exhaustion and reevaluation after exhaustion through the orchestrator. No repeated evaluation restarts an unbounded acquisition loop. Stage D separately verifies ask-provider/EHR/hybrid strategy selection and real adapter behavior.
- An established urgent finding remains visible while an unrelated required Need blocks finalization of the requested scope. Reject subgroup finalization and silent scope reduction; do not suppress urgency merely because the complete plan is not ready.
- Follow-up planning permission can be established before its fixed performance window; soft deadline, clinical reassessment rule and external order expiration remain distinct. A later encounter does not move the originating anchor.
- Referral clinical indication can be established while destination availability is unresolved; record a scoped operational attestation and reevaluate. A requirement in institutional policy is not proof of availability. No automatic recipient-patient order is created.
- Cancellation/completion events have the supported identity and authority checks; proposal or order alone is not completion. Changed material evidence invalidates review; unchanged frozen input reproduces the result.

### 15.2 C-02 — One medication initiation with a two-candidate choice

Extend the initial-treatment assessment with one bounded, clinically reviewed medication-initiation decision. Author two actual candidate alternatives under an explicit required `one_of` choice. Specify each candidate's action identity, formulation/route, fixed reviewed dose, eligibility and safety requirements before Stage A exit. No computed dosing, titration, drug sequencing or automatic switch is in scope. If the GERD content cannot support the approved alternatives, select another bounded medication decision and document that scope explicitly; do not force clinical equivalence to preserve an example.

Required safety policy names allergy and interaction checks for the supported candidates/current-therapy universe, their knowledge/mapping versions, source coverage and freshness. A synthetic empty medication list is a scoped negative only when its coverage contract establishes that result. Both mapping and actual assessment results belong in the trace.

| Case | Expected acceptance outcome |
|---|---|
| Both candidates eligible, required safety checks complete, no choice recorded | Choice Need; no implicit first/default winner and no finalized medication |
| Patient explicitly declines the proposed treatment | Record scoped refusal, distinct from no response and from ineligibility; preserve clinical eligibility and any counseling/review obligation; no medication initiation or automatic alternative selection |
| Candidate selected but required documented consent is missing | Selection does not satisfy consent; consent/review obligation blocks initiation finalization |
| Authorized consent evidence supplied for the selected action and current scope | Reevaluate and satisfy only that obligation; required safety and review remain enforced; refusal never counts as consent |
| Provider selects A; required checks complete and clear | Only A proposed for medication initiation; explicit review still required |
| Known relevant allergy or interaction finding applies to selected A | A withheld; retain the established finding; B is not silently selected |
| Allergy is present but cannot be mapped | Safety assessment unresolved; affected medication finalization blocked, not treated as allergy-free |
| Allergy mapping succeeds but source coverage is incomplete | Unresolved required coverage cannot become a completed negative |
| Current-therapy/interaction coverage or required knowledge source is unavailable | Interaction assessment unresolved and affected finalization blocked |
| Allergy and interaction coverage complete with no findings | Clear assessment carries its declared scope/version, not universal safety assurance |
| Neither candidate is eligible | Unsatisfied required choice/decision Need, never a successful empty medication plan |
| Selection is invalidated by corrected clinical evidence | Prior selection/review invalidated; require explicit reconsideration |
| A is selected and reviewed, then required safety evidence changes | Reevaluate and require review as applicable; a withheld/unresolved A cannot finalize under the old review |
| Safety withholds A while B remains eligible | Return decision Need alongside A's reason; never auto-select B or retry selection to find a convenient outcome |
| Authorized later choice selects B | New recorded choice and required review; no implication that A was administered or discontinued |
| Repeated finalization or concurrent stale submission | Idempotent committed result or explicit revision conflict; no duplicate order/plan materialization |

### 15.3 E-01 — UTI follow-up after actual completion

Author a bounded follow-up slice anchored to recorded completion of an identified treatment course. The recommendation is a culture/follow-up action, not execution of recurrent treatment. Record specimen/culture identity, requested window, query-specific timing/admissibility, freshness assessment time, result state and supporting provenance.

- Order placed without qualifying completion cannot start a completion-relative window. Wrong-course completion cannot fulfill the anchor.
- Evaluate the declared course-completion-to-collection window and collection-to-assessment freshness independently in one query. Stage A records clinically reviewed bounds; these two-anchor tests do not claim therapeutic-drug-monitoring support.
- The same observation can be admissible for a historical query and inadmissible for a current-status query; retain both assessments and the original record. A material unresolved candidate cannot disappear from latest selection.
- A pending result, no admissible measurement, incomplete retrieval or unavailable mapping remains explicit. A reviewed pending/unavailable-state contingency does not coerce the clinical result to negative.
- Distinguish full retrieval from sufficient sampling. Corrected collection times, late results and scoped provider corrections/attestations produce new revisions and review effects.
- For the clinically approved treatment-completion query, supply conflicting chart information and an explicit provider precedence request with an authorized attestation about the same course and interval. When the contract permits that evidence kind and strategy and all admissibility checks pass, the attestation governs selection; retain the chart candidate and exact reason it did not govern. Reevaluate dependent timing and invalidate material review.
- Repeat with expired, wrong-subject, wrong-course/episode and unauthorized assertions. Reject their precedence/admissibility requests, retain rejection reasons, and evaluate admissible chart evidence or return unresolved if it is insufficient. A request cannot modify the query's contract or clear unrelated safety obligations.
- If an overlap scenario reads susceptibility, it must bind to the identified culture/isolate; an unrelated historical result cannot satisfy it. A typed unsupported/missing binding produces a visible unresolved result.
- Author only the reviewed UTI/GBS overlap needed to test preserved source-specific rationale and duplicate/conflicting recommendations. Equivalent canonical actions produce one combined proposal with both source traces and accumulated obligations, independent of package ordering. Unestablished equivalence preserves separate proposals with a visible duplication/conflict assessment; incompatible timing or intent blocks requested-scope finalization when unresolved. No intrapartum drug regimen is implied.
- A reviewed maternal finding positively produces an authorized newborn-care handoff proposal with originating maternal subject/episode, reason and source references, intended receiving role/service, timing and required fulfillment/acknowledgement evidence. An unidentified newborn can be referenced only as a handoff context under the declared contract, never as an order recipient. Proposal creation is not successful communication. A subsequent authorized acknowledgement can fulfill the communication obligation; missing or wrong-context acknowledgement cannot. No infant order, clinical action or completed handoff is inferred.

### 15.4 E-02 — Separated observations and pregnancy-context interpretation

Add a bounded hypertension assessment slice, not a full hypertension diagnosis/treatment protocol. It must actually execute each retained temporal capability, rather than merely display an interaction between pathway names.

- Select two identity-distinct qualifying measurements under an explicit minimum/maximum separation rule. Exercise exact time boundaries, reversed input order, equal-value distinct observations, duplicate source rows, a correction and an unresolved timestamp. Counting two rows is not sufficient.
- Compute pregnancy day count from a sourced dated reference point under the approved date basis. Exercise dates immediately before/at/after a reviewed clinical context boundary and a dating correction. Old replay remains unchanged.
- Invoke a pinned clinical context lookup table keyed by that derived day count and the declared clinical question. Exercise context at collection versus context at evaluation; use exact table content adjudicated in Stage A, not an invented universal trimester threshold.
- Combine the observation result with a scoped standing-condition assertion. Retain the historical assertion while applying current episode/effective-time constraints. Exercise both permitted overlap and incompatible current classification outcomes across the two hypertension packages.
- An independent urgent-assessment branch cannot be suppressed merely because the classification pair or standing-condition history is unresolved. Its finding is visible while any required unresolved dependency still blocks whole-requested-scope finalization.
- Evaluate the two hypertension packages in reversed order with equivalent, distinct and conflicting action payloads. Verify canonical action identity, retained provenance/obligations, and explicit conflict outcomes; no last-pathway-wins or display-name merge. Clinical classification history alone is not a sufficient action-composition test.
- No baseline-value difference, two-point rate, regression, acute dosing or automatic medication execution is part of this slice. If clinical adjudication finds the proposed lookup or pairing unnecessary, defer the unused capability rather than manufacture a clinical dependency.

### 15.5 C-03 — Authoring, publication and protective boundaries

Run through the authoring/API/compiler/publication and execution boundaries as appropriate:

- Load a supported canonical pathway into a readable graph/details view, navigate node/edge/field diagnostics, edit one supported literal property, save a new revision and recompile. Layout cannot change executable meaning; unsupported constructs remain visible. Stale saves/responses cannot overwrite or mislabel a newer revision.
- Preview a frozen nonclinical scenario through the shared backend and display disposition, findings, material Needs, rationale and incomplete-authoring state with source links. The frontend cannot supply its own clinical evaluator or promote preview to clinical execution.
- Diagnose unused local predicates/queries, constant-false indications/candidates and ineffective guards within the declared analysis fragment. A query feeding a Need or independent finding is retained. Check typed enum equality and explicit finite-domain disjointness with a witness; reject wrong enum types, preserve Unknown, and report unsupported analysis honestly. Eligible provider-choice alternatives may overlap without an error. Apply the declared diagnostic/publication severity policy.
- Well-typed holes yield preview-only incomplete artifacts, including when unreachable for the selected patient. They cannot publish, generate a patient-data Need for the hole, or finalize clinical actions.
- Wrong types/dimensions, unsupported operators, cycles, invalid cardinality, ambiguous bindings and unauthorized policy specialization fail at their declared boundary.
- Rationale-only changes alter reviewed artifact identity and trigger policy-required review. Safety requirements accumulate and permissions narrow; omission cannot disable an inherited requirement.
- Synthetic snapshots establish only explicit non-clinical scoped coverage. Clinical execution rejects them and mixed/derived synthetic artifacts; relabeling or bypassing preview UI cannot confer authority.
- Invalid/tampered/unsupported IR, exceeded resource budgets and missing replay dependencies produce explicit failures, not clinical-ready partial results. A failed run cannot claim that all urgent findings were assessed. Reject partial-group finalization and scope tampering even when a subset appears ready.
- Core build/import rules reject application/infrastructure dependencies. A compiled slice executes through public language exports without database/network access in the kernel.

Section 16 contains the fuller shared case catalogue. Deferred-feature cases are rejection/roadmap cases until the feature obtains a capability row, conformance IDs and a reviewed C/E scenario.


## 16. Validation strategy

### 16.1 Required automated evidence

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

### 16.2 Worked acceptance cases for the illustrative pathway

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

### 16.3 Longitudinal acceptance cases

Use a frozen approved timing rule and stable action-instance identities. These tests specify workflow semantics rather than clinical timing recommendations. Capabilities deferred by v0 remain compilation-rejection cases until implemented; they must not be simulated as successful workflows.

| Situation | Expected result |
|---|---|
| Active uncompleted follow-up, clock before `dueStart` | Not yet due; obligation retained |
| Clock at `dueStart`, within the window, or at `dueEnd` | Due; boundary semantics are inclusive |
| Clock after soft `dueEnd`, no qualifying completion, still applicable | Overdue; owning role and unresolved work visible; clinical stop rules still apply |
| Order placed but no qualifying completion/result | Not completed; due state still derives from the clock and contract |
| Clock advances with no new patient data | New evaluation revision can become due/overdue; no implicit clock read inside old revisions |
| Anchor missing or ambiguous | Unresolved timing; no fabricated due date |
| Completion arrives late | New revision derives progress from valid and recorded times; historical replay retains what was known then |
| Completion is corrected/retracted | Reevaluate the instance; reopen if the approved completion contract is no longer satisfied |
| Two recurring instances share a node template | A completion satisfies only its bound instance unless explicit reuse is permitted |
| Authorized deferral/cancellation | Preserve history and authority; apply the supported event contract rather than mutate a hidden progress pointer |
| Pathway no longer applicable for new actions | Outstanding instance remains tracked until a declared completion/closure/transfer rule applies |

### 16.4 Temporal, admissibility and authoring acceptance cases

Use synthetic, explicitly scoped evidence and reviewed expected outputs. These cases specify software semantics, not clinical threshold or treatment recommendations. Use compilation-rejection cases for deferred capabilities rather than silently exercising them in v0.

| Situation | Required behavior |
|---|---|
| One observation is admissible for query A but not query B | Retain the observation and separate query assessments; no global invalid flag |
| E-01 query uses course completion, collection and assessment time | Evaluate the declared windows independently; unknown anchor/coverage leaves material admissibility unresolved |
| An inadmissible candidate is excluded, leaving no usable measurement | Measurement unresolved; never infer a negative clinical condition |
| An unresolved candidate could change latest selection | Preserve uncertainty; do not select an older candidate as if the uncertain one did not exist |
| Specimen collected earlier than result receipt | Use the declared timestamp role; receipt/recorded time is not a silent substitute |
| A collection is pending | No negative result or false completeness; an explicit pending-state contingency may apply |
| All recorded readings retrieved, but expected sampling is sparse | Retrieval complete can coexist with insufficient evidence for the calculation; no low-confidence numeric substitute |
| Equivalent units but unestablished assay comparability | Conversion alone cannot authorize a longitudinal comparison |
| Susceptibility belongs to another culture/isolate | Cannot satisfy the selected culture's query contract |
| Baseline-relative calculation authored before its capability exists | V0 rejects it; later-capability acceptance must preserve missing-baseline uncertainty and independent absolute assessment |
| Baseline outside current window (deferred calculation capability) | Compile rejection in v0; later selection requires an explicit baseline scope |
| Two source rows identify the same observation | Cannot satisfy a two-distinct-observation requirement |
| Qualifying readings too close together, or elapsed time unknown | Pair cannot establish the required separation; no invented time. A rate operator is separately rejected in v0 |
| Intervention falls within the selected comparison interval | Apply the declared interpretation/admissibility rule; do not infer treatment effect automatically |
| Dating correction moves a measurement across a context boundary | New interpretation in a new revision; earlier replay unchanged; material schedule/review changes surfaced |
| Current and specimen-time contexts differ | Apply the context time expressly named by each query/lookup |
| Prior pregnancy contains a relevant-looking result | Exclude or include under explicit episode/history scope, not date proximity alone |
| Earlier diagnosis retained after reclassification | Historical assertion remains reproducible; current active classification follows effective-time rules |
| Facility policy requires a resource but current availability is unknown | Operational readiness unresolved; policy alone is not evidence of availability |
| Recommendation can be ordered before its performance window | Planning eligibility can be true while performance is not yet due |
| Soft deadline passes but clinical applicability remains established | Obligation becomes overdue; no automatic cancellation or perpetual permission beyond other stop conditions |
| Clinical stop/reassessment condition applies | Surface the required reassessment/closure workflow; overdue status cannot override it |
| External order expires | Apply adapter renewal/expiration handling separately from clinical eligibility and due state |
| A later encounter reevaluates a relative schedule | Original anchor remains fixed; deadline does not move without authorized rescheduling |
| Future event has not occurred | Current-time assessment can resolve; hypothetical/event-relative assessment remains conditional and is reevaluated when actual evidence arrives |
| Correction arrives after review in the same encounter | New revision and material-change notification/review invalidation; do not wait for a second encounter |
| Draft has a well-typed hole in a currently unvisited branch | Preview shows incompleteness; publication blocked globally; no patient-data Need is emitted for the hole |
| Hole is replaced by a wrong type, unsupported operation or cycle | Compilation fails; preview is not an escape from language invariants |
| Reviewed rationale changes without changing executable output | Reviewed artifact identity changes and applicable review is required |
| Complete synthetic snapshot yields a scoped negative | Permitted in the non-clinical scenario; clinical runs reject the snapshot and its derived artifacts |
| Maternal pathway requests a neonatal action without recipient binding | No order on the maternal subject; explicit supported handoff or unsupported-capability rejection |
| Existing treatment is absent from newly proposed actions | No implied discontinuation; an executable stop/switch requires its own supported lifecycle contract |

### 16.5 Clinical acceptance

Clinical owners define expected decisions, omissions, needs, urgency, and rationale before evaluating the implementation. Include typical cases, boundary cases, contradictions and plausible failures. Record disputed cases as unresolved requirements rather than tuning a confidence score until the test looks plausible.

Measure inappropriate recommendations and missed indicated actions separately; also measure review burden, unresolved needs, explanation usefulness, and authoring/approval effort. Passing a finite corpus does not prove universal clinical safety. Acceptance criteria must be tied to intended use and hazard, not only aggregate agreement percentages.

### 16.6 Release checks

Required tests/type checks must fail the release on failure. Run database-backed activation, revision and materialization checks in isolated infrastructure. Verify authenticated roles, patient/institution scope and preview separation. These are clinical-release obligations that accompany the replacement; they are not evidence that the language design must wait for unrelated legacy cleanup.

## 17. Stage A decisions and exit gate

Assign a named accountable clinical owner early, before treating clinical scenario decisions as settled. That owner assigns appropriately qualified named reviewers for each scenario packet, including medication-safety review for C-02. Record their review scope, decision authority, artifact version and adjudication outcome. A role label or an engineering author is not a substitute for actual reviewer identity.

**Current assignment status:** No clinical owner or reviewer identities have been supplied in this specification. Assignment is an open dependency, not approval implied by the accepted architecture. The project owner must populate this record; do not invent names.

| Required responsibility | Named person | Scope / status |
|---|---|---|
| Accountable clinical owner | Unassigned | Own intended use and adjudication decisions across C/E; blocks Stage A exit |
| C-01/C-02 clinical reviewers, including medication-safety expertise | Unassigned | Approve exact assessment, medication, refusal/consent and safety expectations |
| E-01/E-02 clinical reviewers | Unassigned | Approve follow-up, precedence, handoff, temporal and composition expectations |

One qualified person may cover multiple responsibilities under the project's governance. Schema design, operator contracts, harnesses and nonclinical conformance cases can proceed in parallel; unresolved clinical packets or missing reviewer identities prevent Stage A completion. This dependency is not a claim that all engineering must wait.

Before Stage A exits, resolve and document all of the following. None is implicitly answered by accepting the architecture:

1. Exact initial node/relationship vocabulary and bounded C-01/C-02/E-01/E-02 clinical slices after walking the design corpus in section 18.1 and optional fixtures in section 18.2, including applicability, instruction-versus-container classification and independent urgent assessment.
2. Numeric capability limits and approved conversion/comparability contracts, with boundary fixtures. Difference/rate operators remain deferred.
3. Exact operator signatures for the v0 capability cut in section 12 and an explicit CQL comparison ledger.
4. Query-specific admissibility, sampling sufficiency, scoped negative assertions, event-history coverage and synthetic/live evidence contracts; identify the bounded Stage D adapter changes.
5. The first institution's approved query-selection strategies, assertion authorities and required safety-policy artifact; general clinical exceptions remain outside v0.
6. Which proof obligations are mandatory for the first publication policy, and whether any require a solver immediately.
7. Canonical source and IR schemas, stable node/action-instance identifiers, source-map shape, and GraphQL result evolution.
8. Authenticated institution-configuration storage/resolution and the CI enforcement of the internal package boundary.
9. Pregnancy date basis, context-time rules, event/observation pairing selection and correction behavior; no implicit use of current context for historical measurements.
10. Preview-only artifact/hole schema, publication rejection and rationale review identity; planning versus performance/stop/expiration fields and stable schedule anchors.
11. Exact C-02 medication identities, reviewed fixed actions, required allergy/interaction sources and cases; no placeholder medication definition is accepted at Stage A exit.
12. Concrete operator-level case IDs beneath every B family, clinically adjudicated C/E input/expected-output packages, and a complete capability mapping; defer features whose scenarios are rejected or unnecessary.
13. Canonical action-equivalence keys and conflict contracts, requested-scope identity, stable Need-key inputs, permitted provider precedence strategies, handoff fields/fulfillment and the version-compatibility registry in section 12.1.

Record each decision with its owner, rationale and version. Required clinical scenario packets include intended use, cited source/version, exact source AST, scoped synthetic evidence, independently expected actions/omissions/needs, review/finalization outcomes and clinical reviewer identity. Stage A remains open while any required packet or contract is unresolved.

These questions refine the chosen architecture. They do not reopen institution-defined interpreters or authorize arbitrary embedded code.

## 18. Design evidence and optional fixtures

### 18.1 Reviewable clinical and temporal corpus

The [committed corpus](../records/pathway-language/corpus/README.md) contains all eight care documents and both temporal discussions, with original bytes and a machine-readable hash manifest. These inputs motivated capabilities, not clinical approval. Both files labeled care plans contain reusable conditional rules. The collection varies within obstetrics and includes overlapping hypertension content; it is not coverage of eight specialties or a clinical oracle.

| Source | Design requirements | Current disposition |
|---|---|---|
| GBS | Freshness, method/susceptibility, future stop events, related subjects | E-01 exercises scoped overlap; repeat regimens and related-patient execution deferred |
| Gestational diabetes | Sampling adequacy, counts/percentages, surveillance bundles | Context motivates contract; aggregation and bundles deferred |
| Hypertensive disorders | Distinct separated measurements, clinical context, acute sequences | E-02 exercises pairing and context; acute sequencing deferred |
| Prior uterine surgery | Consent/choice, advisory prediction, operational readiness | C-02 exercises choice, explicit refusal and a scoped consent prerequisite (not the full surgical consent workflow); C-01 exercises operational readiness; prediction execution deferred |
| Hyperthyroidism | Reference context, treatment transitions, administration-relative sampling | Context lookup tested in E-02; treatment transitions and TDM-specific admissibility deferred |
| Chronic hypertension | Initiation versus continuation, stop/switch, overlapping pathways | C-02 covers initiation only; E-02 covers scoped classification conflict; lifecycle changes deferred |
| GERD | Independent alarm assessment, counseling, response and follow-up | C-01/C-02 bounded slices; computed response and sequencing deferred |
| UTI | Completion-relative follow-up, culture/isolate identity, recurrent episodes | E-01 bounded slice; recurrence and suppression deferred |
| Temporal Logic in Prism’s Node Pathway | Context-time roles, stable anchors, separate action windows | C-01/E-01/E-02; no callback resolver or indefinite clinical validity |
| Time, Acuity, and the Reading of Data | Query-specific admissibility, baseline alternatives, multiple anchors | E-01/E-02; no global fact expiration or skip/traverse fallback |

An unresolved symptom-improvement scale, ambiguous scalar schedule anchors, and a dose/frequency range conflicting with a daily maximum are authoring-review examples from these sources. Preserve uncertainty or diagnose structurally represented contradictions; do not silently choose a clinical interpretation. C/E packages are authored independently and need adjudicated expectations rather than parity with the source prose.

### 18.2 Optional legacy engineering fixtures

The following stored exports, identified by file digest, are optional engineering examples for challenging the language. They are not required conversion targets, assertions of present live status, or clinically approved test oracles. Stages C/E may choose different source-grounded pathways with comparable complexity. Acceptance follows independently reviewed source clinical content and expected scenarios, not reproduction of these exports.

| Role | Pathway / stored fixture | SHA-256 of fixture bytes |
|---|---|---|
| Optional expression-design fixture | `anemia-in-pregnancy-v1@1.4`: [anemia-1.4.json](../../../apps/pathway-service/src/__tests__/fixtures/compiler-corpus/anemia-1.4.json) | `0041ee3be1fde50763eb518101f94344abb7c07d36a02fbd8c2c95394c4f1f46` |
| Optional routing-design fixture | `gestational-hypertension-preeclampsia@1`: [ghtn-1.json](../../../apps/pathway-service/src/__tests__/fixtures/compiler-corpus/ghtn-1.json) | `1e8026c9bf338e0896108ceb2fa062b0f227b511f40d1542a370bb2443e1e775` |
| Optional escalation design case | `chronic-htn-pregnancy-v1@1.0`: [chronic-htn-1.0.json](../../../apps/pathway-service/src/__tests__/fixtures/compiler-corpus/chronic-htn-1.0.json) | `3082e342c6bd36d60c710ef8c9a266b21a0301f683ca5b8ed5e664fda6856dec` |

The recorded corpus lists anemia 1.4 as ACTIVE at that historical inspection and documents gestational-hypertension routing defects. It identifies the unreachable `ESCALATES_TO` medication case in the chronic-hypertension fixture. Do not conflate these findings or infer that a fixture requires runtime recursion. Add explicit synthetic cycle rejection cases, and remodel any clinically recurrent workflow through event/action instances. Changes to a fixture require a new digest and a reviewed description of the changed clinical assumptions.


## 19. Application integration and release contracts

These are implementation obligations under the accepted architecture, exercised by C-02/C-03, Stage D and release acceptance. They do not add side effects to the pure kernel.

### 19.1 Replay and finalization contracts

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

Reviewed clinical rationale and citation bindings participate in review integrity even when executable semantics are unchanged. Preview mode, synthetic provenance, dating/reference-context versions, temporal anchor identities and admissibility/selection contracts are recorded in the relevant artifact/input digests. A rationale-only change need not change the executable semantic hash, but it must change the reviewed artifact identity and trigger the applicable review policy.

### 19.2 Publication and clinical authority

Use publication states such as Draft, Compiled, ClinicallyReviewed, Approved, Active, Superseded, and Revoked, with separate analysis details. A state transition checks authenticated authority and records the exact artifact approved. A new source, parameter, or library version invalidates approvals according to the change contract.

Require named clinical ownership, intended population/use, evidence citations, approval scope, limitations, and review policy. A newer publication may trigger reassessment; publication dates alone do not establish relevance or contradiction. Institutions can add publication obligations without weakening the base language rules.

Provider exceptions require a defined authorized scope and, where applicable, reason/additional review. An acknowledgement is not evidence that a contraindication disappeared. Preview/synthetic capabilities must be distinguishable from clinical sessions and cannot confer authority through caller-asserted headers.

Clinical correctness is established through evidence review and validation of encoded behavior, not by language design alone. Requirements must include omission hazards as well as inappropriate recommendations. Clinical reviewers should define expected outcomes independently of the implementation and adjudicate differences between the source clinical intent and encoded behavior. Preserve the scenarios, expected rationale, reviewer identity, and reviewed artifact version.
