# RFC: One typed, declarative language for Prism clinical pathways

**Status:** Accepted as the project architecture on 2026-09-30 following owner review. This is not clinical approval, an implemented system, or approval of a complete v0 specification.

**Originally proposed:** 2026-09-28

**Last revised:** 2026-09-30 — architectural acceptance and separation of detailed implementation contracts into Stage A.

**Target branch:** `docs/pathway-language-direction`

**Working name:** Prism Pathway Language (PPL); the name is not a compatibility commitment.

**Implementation baseline originally inspected:** `b2f81f588cc3c465dd5779551d9e2cbdbaa75cc7`.

**Implementation specification:** [Stage A: language contracts, capabilities and acceptance evidence](2026-09-30-pathway-language-stage-a-spec.md).

## 1. Accepted decision

Adopt one statically typed, declarative pathway language combining CQL-inspired clinical expressions, restricted Datalog-inspired derivation, and Prism-owned node/relationship contracts. Use one canonical source model, one typed intermediate representation and one authoritative evaluator kernel. Graphical and future textual authoring share those semantics.

The language defines the meaning of evidence, expressions, node ports, relationships, recommendation composition and uncertainty. Institutions supply clinically approved content, bounded parameter values, acquisition workflows and governance policy. They do not install interpreters, arbitrary opcodes or callbacks that redefine clinical truth.

Implement the core as a small pure evaluator over acyclic executable dependencies. Do not require a Soufflé runtime, a full CQL runtime, general recursive inference or a solver during patient-time execution. Compile-time verification may use targeted symbolic analysis with explicit limits.

This replaces implicit traversal behavior; it is not a new policy layer over the old evaluator. The investment is justified only if authored clinical meaning becomes easier to inspect, validate, execute, explain and change.

## 2. Scope

Assume a fresh-start deployment with a reset database. Downtime and an initially incomplete catalogue are acceptable. Legacy record/session preservation, compatibility with existing pathway JSON, dual-engine operation and uninterrupted production service are not requirements. This records the design assumption; it does not instruct execution of a database deletion.

Pathway ingestion/import and patient-data intake redesign are outside scope. Acceptance begins with **authored pathway → compilation and clinical validation → evaluation against scenarios**. Bounded changes to existing evidence adapters for provenance, required context and justified coverage belong in Stage D. They do not constitute replacement of the intake pipeline.

The new system still requires correctness controls before clinical use. Missing content cannot be represented as comprehensive coverage. Versioning, frozen replay and longitudinal continuity apply to records created in the new system; no reconstruction of legacy history is required.

The [initial direction record](../records/pathway-language/2026-09-28-direction.md) remains historical. This RFC supersedes its institution-specific semantics profiles, confidence-mediated eligibility and broad solver-first approach. The replacement need not wait for unrelated legacy cleanup.

## 3. Architectural invariants

- All decision-affecting inputs and dependencies are explicit and typed.
- The core performs no external I/O, reads no implicit wall clock, and mutates no persistent state.
- The same pinned semantic inputs produce equivalent results and explanations regardless of irrelevant input ordering.
- Missing, conflicting, unavailable, invalid, inadmissible and insufficient evidence cannot silently become clinical falsity.
- High confidence cannot compensate for a false prerequisite, known exclusion or unresolved required safety assessment.
- Execution is finite and bounded; exhaustion, invalid artifacts and missing required dependencies cannot produce a successful partial result labeled ready.
- Material changes to a reviewed clinical artifact or its evidence require the applicable renewed review.
- Historical interpretation depends on retained versions and evidence, not hashes without retrievable artifacts.

## 4. Language and authoring architecture

Use a typed, versioned JSON AST as the initial canonical source. Graphical relationships and expression bindings lower to the same dependencies. Presentation layout cannot introduce clinical meaning. A textual syntax can be added as another projection of the same model.

Separate the platform-maintained language catalogue, reusable clinical libraries composed from supported primitives, and authored pathway packages. New primitives require versioned semantics and conformance cases; ordinary content changes do not require evaluator patches.

Borrow typed quantities, terminology, precision-aware temporal expressions and clinical libraries from CQL. Pin the initial comparison baseline to CQL 1.5.3; this is not a claim to implement CQL or that the reference is the latest release. See the [CQL author's guide](https://cql.hl7.org/N1A/02-authorsguide.html) and [language semantics](https://cql.hl7.org/N1A/05-languagesemantics.html). Maintain an operator ledger documenting adopted behavior and deviations.

Borrow explicit relations, dependency analysis and declarative derivation from Datalog; the [Soufflé tutorial](https://souffle-lang.github.io/tutorial) is a reference. Restrict initial execution to acyclic derivation. Absence of a clinical fact is not negation-as-failure. Complete structural metadata and adequately scoped clinical coverage can support explicit negative conclusions.

Prism owns how indications, prerequisites, exclusions, choices, safety and review compose. That contract is versioned public language behavior rather than institutional interpreter configuration.

Authoring must permit unresolved clinical interpretation without invented values. Typed holes are draft-only, observable in preview and publication-blocking. Preview uses the same kernel with an explicit incomplete-authoring domain, not alternate clinical semantics. Clinical rationale and citations attach to executable declarations and participate in review integrity. Their schemas and detailed behavior live in [Stage A](2026-09-30-pathway-language-stage-a-spec.md#2-language-layers-and-authoring-representation).

## 5. Evidence and temporal interpretation

Separate the stored observation, its admissibility for a query, evidence selection/sufficiency, derived calculation and clinical predicate. A record may be useful for one question and unsuitable for another; neither a global valid flag nor a universal expiration date can express that distinction.

Queries declare subject/episode, sources, timestamp roles, selection and authority rules, comparability, completeness and sampling requirements. Preserve excluded observations and reasons. Complete retrieval is not necessarily adequate clinical sampling. Unit conversion alone is not proof of assay comparability. Scoped clinical contingencies for pending or unavailable evidence must not become generic Unknown-to-False coercion.

Temporal meaning uses explicit event anchors, context time, precision and a pinned evaluation clock. Context at collection may differ from context at assessment. Pregnancy age and trimester interpretation belong to sourced dating evidence and versioned clinical content, not hidden evaluator constants. Corrected evidence creates a new revision; historical replay retains the earlier interpretation.

Episodes, related subjects and operational resources have explicit bindings and authority. Institutional policy can require a resource but cannot establish its current availability. Historical diagnoses remain recorded without becoming permanently current assertions. Prior-episode evidence is admitted through declared scope, not date proximity alone.

Exact supported operators and temporal calculations belong to the [capability profile](2026-09-30-pathway-language-stage-a-spec.md#12-initial-capability-profile); describing a useful temporal concept here does not require it in v0.

## 6. Clinical composition and safety

Retain separate outputs for applicability, local indication, prerequisites, exclusions, eligibility, selection, safety, disposition and review/finalization readiness. A false indication is distinct from an indicated action withheld for a known exclusion. Findings remain visible even when another condition determines the primary disposition.

Applicability is explicitly bound into new recommendations. It cannot be omitted by an author. Presentation containment and traversal order do not contribute implicit eligibility. An action-completion dependency requires recorded completion evidence, not an earlier proposal or a display edge.

Provider selection is a recorded input. A required choice has declared candidates and cardinality. If safety withholds the selected alternative, return the reason and decision need; do not silently choose another candidate. Current therapies and provider-added proposals belong in the relevant safety universe.

Required safety checks come from explicit, clinically approved, versioned policy. The interpreter enforces declared coverage and supported capabilities; it does not invent clinical defaults. Institutions cannot remove an adopted mandatory check by omission. Unavailable mappings, unknown coverage or unavailable required references cannot look like a completed negative assessment.

Clinical urgency is an independently authored requirement. Unrelated uncertainty must not hide an established urgent finding, while partial results must not imply complete plan readiness. The detailed reducer, policy composition and acceptance outcomes are owned by [Stage A](2026-09-30-pathway-language-stage-a-spec.md#8-recommendation-disposition-safety-and-multi-pathway-composition).

## 7. Actions and longitudinal state

Evaluation proposes actions; it does not prescribe, order or administer them. Observation, correction, attestation, choice and clinical exception are distinct authorized inputs. An exception cannot rewrite the underlying evidence into a different fact.

Established actions have stable identities, subject/episode bindings, originating anchors, completion criteria and versioned rules. Their progress derives from recorded events and the explicit clock. Orders are not completion, and reevaluation does not reset deadlines. Leaving pathway scope does not silently erase an outstanding obligation.

Planning/ordering permission, performance window, preferred deadline, clinical stop/reassessment condition and external order expiration are different attributes. A soft deadline can make an action overdue; it does not establish indefinite clinical appropriateness. Adapter expiration requirements do not determine clinical meaning.

Initiate, continue, modify, hold, resume and discontinue are distinct intents. Withholding a new proposal does not stop an existing treatment. The capability profile chooses which lifecycle operations can execute; unsupported ones cannot be hidden in prose to claim support. Repeated care across recorded revisions does not require executable graph recursion within one evaluation.

## 8. Compiler, execution and verification boundaries

The compiler validates source, resolves pinned references, checks types and graph contracts, and emits immutable typed IR, diagnostics, source maps and capability requirements. Runtime accepts supported, authenticated artifacts, not caller-supplied objects that merely resemble IR. Clinical execution requires an approved complete release; preview artifacts and synthetic evidence cannot cross that boundary by relabeling.

The core emits structured explanations alongside outcomes. It does not delegate clinical meaning to an LLM-generated explanation. External models can contribute recorded observations only through an approved evidence and review contract.

Distinguish structural validity, bounded analysis results, clinical approval, publication approval and runtime readiness. A symbolic result names the property and assumptions, with proved/counterexample/inconclusive outcomes. A solver result is not universal clinical verification. Independent clinical scenarios remain necessary.

The orchestrator owns acquisition, authentication, event persistence, scheduling, concurrency, review acknowledgements and transactional finalization. It cannot substitute new clinical decisions after evaluation. Pure result/review contracts are tested in Stage B; actual finalization and adapters are tested at application boundaries.

## 9. Versioning, review and governance

Published packages pin source/IR, language/compiler/runtime versions, operator profiles, terminology, conversions, evidence policies, safety references, institutional configuration and approvals. Session revisions retain their clock, evidence, recorded inputs and established action-instance dependencies, including older artifacts still governing active instances.

Separate original frozen replay from current reevaluation. Corrections and clock advances create new revisions. Material changes within the same encounter or across encounters require visible explanation and applicable review invalidation. Rationale-only changes affect reviewed artifact identity even when executable behavior is unchanged.

Publication authority, institutional/patient scope, required reviews, release activation/revocation and finalization integrity are enforced before clinical use. Finalization revalidates the reviewed revision and commits atomically with idempotency; conflicting concurrent changes cannot combine evidence from different revisions.

Acceptance of this RFC approves these architectural boundaries only. It does not approve any supplied care document, medication, threshold, implementation or patient-care use. Clinical owners adjudicate authored packages and scenario expectations against their intended use.

## 10. Package and application boundaries

Start with an internal package, provisionally `libs/pathway-language`, containing public types, schema/catalogue, compiler, IR, evaluator, diagnostics and conformance fixtures. It has no dependency on GraphQL resolver contexts, database pools, network clients or session stores.

Enforce the boundary with its own package/build configuration, public exports, isolated checks and CI rejection of direct or transitive imports into application/infrastructure code. Application adapters use public language exports; the language core cannot import those adapters back.

`pathway-service` owns adapters between canonical source, evidence, session events and the core. GraphQL exposes authoring, diagnostics, results and review/finalization. Storage queries cannot define clinical semantics. Provider applications consume the authoritative result contract rather than recomputing eligibility from presentation fields.

Extract a separate repository only when another consumer, ownership model or release requirement justifies it. Repository separation does not require a remote interpreter service. Legacy generation paths can be removed without a coexistence period.

## 11. Delivery and acceptance

| Stage | Required evidence |
|---|---|
| A — Specification | Finalize capability contracts, operator profiles, provenance/coverage boundaries, matrix and independently adjudicated scenario expectations |
| B — Core | Implement and pass conformance cases for the supported compiler/evaluator capabilities |
| C — Vertical integration | C-01 bounded GERD assessment/follow-up; C-02 medication initiation with two alternatives and required safety checks; C-03 authoring/publication/protective boundaries |
| D — Live adapters | Validate bounded provenance, context, coverage and acquisition changes; reject synthetic evidence from clinical use |
| E — Temporal/composition integration | E-01 UTI completion-relative follow-up and scoped overlap; E-02 separated observations and pregnancy-context interpretation |
| F — Scoped launch | Approve intended use, content, authority and release controls; initialize the fresh system; no legacy parity gate |

Every v0 capability needs a Stage B conformance family and a named C/E acceptance scenario. Clinical features require meaningful clinical use; protective/authoring capabilities require corresponding rejection or publication-boundary evidence. Without both mappings, a capability is deferred. A source-document mention is not evidence of end-to-end coverage.

The [Stage A matrix](2026-09-30-pathway-language-stage-a-spec.md#14-capability-to-scenario-matrix) and [scenario contracts](2026-09-30-pathway-language-stage-a-spec.md#15-required-integration-scenarios) own the exact requirements. Observation pairing remains in scope through E-02. Paired-value differences, two-point rates and specialized therapeutic-drug-monitoring admissibility are deferred until separately justified by integration scenarios.

The medication scenario must exercise two real, clinically reviewed alternatives, explicit choice, known findings, unmapped allergies, complete/incomplete allergy and interaction coverage, no automatic reselection, and stale-review rejection. It does not include titration or sequencing. Stage A remains incomplete until its clinical content and expected outputs are adjudicated.

## 12. Alternatives and tradeoffs

| Alternative | Reason not selected initially |
|---|---|
| Continue extending traversal | Leaves clinical meaning distributed across implementation order, gates, confidence and exceptions |
| Full CQL plus separate pathway engine | Two semantic boundaries; graph composition, uncertainty, needs and workflow still require contracts |
| Compile to Soufflé or interpret pathway facts inside it | Useful relational tooling, but still needs clinical types, uncertainty, tracing and a constrained integration; no demonstrated need for the extra backend |
| General scripting or callbacks | Hidden dependencies and effects make determinism and verification harder |
| Hard-code each pathway | Useful independent references, but duplicates behavior and requires engineering for content changes |
| Restricted PPL | Best fit for one inspectable semantic boundary; Prism owns the cost of specification, conformance and tooling |

Soufflé remains a possible future analysis/backend experiment after the clinical semantics are fixed and independently tested. Neither it nor CQL supplies clinical correctness automatically. PPL initially makes no CQL, ELM or FHIR Clinical Reasoning conformance claim.

The material risk is replacing one complex evaluator with another framework. Keep capabilities tied to concrete scenarios, reject unsupported operations, and measure authoring effort and correctness rather than language size. Formal checks can create false confidence; their claims remain named and bounded.

## 13. Supporting specifications and change control

- [Stage A implementation specification](2026-09-30-pathway-language-stage-a-spec.md) is authoritative for detailed schemas, truth tables, operator signatures, capability cuts, acceptance cases and Stage A decisions. Its draft status is separate from this accepted architecture.
- [Design corpus](../records/pathway-language/corpus/README.md) preserves the eight care documents and two temporal discussions with provenance and hashes. Interpretations remain in the specification, not edits to those source documents.
- [Historical direction record](../records/pathway-language/2026-09-28-direction.md) explains earlier options; it is not an alternate implementation contract.

Detailed contracts formerly embedded in RFC revision `c0b7f7c` were moved into Stage A. Do not maintain duplicate normative tables in both documents. Changes within the accepted architecture update the specification and its versioned acceptance evidence. Changes to an architectural invariant require an explicit RFC amendment and owner decision. Clinical package approval and release approval remain separate.

## 14. Success criterion

An approved clinical rule can be authored, checked, executed, explained and changed through the same explicit model, with less hidden evaluator behavior. A substantially different pathway reuses the core without new traversal exceptions or institutional truth rules.

Measure inappropriate recommendations, missed indicated actions, unresolved needs, review burden, explanation usefulness and authoring effort against intended-use acceptance criteria. More operators, larger graphs or broader solver claims are not success measures.
