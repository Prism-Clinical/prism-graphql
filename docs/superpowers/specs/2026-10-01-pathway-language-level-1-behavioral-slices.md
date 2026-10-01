# Level 1: Behavioral delivery slices

**Problem statement:** Given an authored pathway and explicitly scoped evidence, produce a deterministic, explainable result that can request missing evidence, accept authorized fulfillment, and be reviewed/finalized only within its declared scope. Deliver this through small observable increments rather than building a whole compiler or evaluator at once.

**Status:** Proposed implementation decomposition, not implementation completion or clinical approval.

**Date:** 2026-10-01

**Authority:** [Accepted architecture](2026-09-28-pathway-language-rfc.md) and [Stage A contracts](2026-09-30-pathway-language-stage-a-spec.md). These documents organize delivery under the Stage A capability contracts. They do not independently promote deferred capabilities.

The first seven slices establish a narrow source-to-reviewed-result loop. Follow-on tracks add the clinically justified capabilities; they are not prerequisites for a literal-only foundation demo. Completed implementation slices contribute evidence toward stages B/C/E; no single early slice claims full `ppl-core-v0` support or permission for clinical launch.

Intermediate artifacts declare only the implemented engineering subset and cannot claim the complete `ppl-core-v0` profile. Unsupported operations reject; test harness support must not weaken the clinical loader. The foundation finalization demonstration is sandbox-only until publication, safety and live-evidence boundaries are implemented and validated.

Clinical examples use frozen nonclinical fixtures. Real thresholds, medication definitions, date rules and expected clinical interpretations require named adjudicators under Stage A. Engineering contract decisions must also be fixed before their dependent story starts. Prototype work while Stage A is open remains explicitly nonclinical and cannot satisfy a clinical gate by itself.

No production database wipe, deployment, EHR transmission or new ingestion work is authorized by these plans. A story involving persistence uses an isolated new-system test schema. A trusted nonclinical harness may materialize sandbox plan artifacts using the shared domain/transaction logic; it cannot call clinical endpoints with synthetic evidence or expose a caller-selectable bypass. Clinical mode must reject synthetic/preview artifacts.

## How the three levels fit

- This document owns the observable outcomes and delivery sequence.
- [Level 2](2026-10-01-pathway-language-level-2-refined-slices.md) refines each outcome into bounded behaviors.
- [Level 3](2026-10-01-pathway-language-level-3-story-spec.md) specifies executable single-story units, exact dependencies and acceptance examples.

The hierarchy is a foundation or extension outcome → numbered refinement → lettered story. IDs are stable references, not estimates or claims that tickets already exist. `F` denotes foundation; extension prefixes name tracks rather than runtime modules.

## Initial delivery sequence

F01–F07 describe the foundation outcomes, not a serial implementation schedule. Leaf start prerequisites are authoritative. Once the compiled-artifact/evaluator contracts exist, evidence and Needs, fingerprint/review, preview holes, and timing can advance independently where their inputs permit. Medication work also needs its reviewed clinical content. Authoring display begins after the AST contract; structural analysis begins after the relevant typed dependencies.

## Dependency audit

There are 16 outcomes, 40 refinements and 77 stories. The previous 65-story plan had a longest dependency chain of 34 stories. The revised start-prerequisite graph has depth 17; including integration/acceptance gates gives depth 23. Both have no dangling references or cycles. These are unit-weighted graph depths, not duration estimates or a promise of proportionate speedup; scope has also increased.

47 stories have engineering readiness code E; 30 require clinical adjudication (C1: 4, C2: 8, E1: 11, E2: 7). E does not mean immediately ready: prerequisites and unresolved engineering contracts still apply. Clinical owners remain unassigned and are required before clinical acceptance.

After F01.1.a, F01.1.b, F01.2.a, F01.2.b and U01.1.a can start independently once their contract decisions are fixed. The previous plan was not literally serial for its first fifteen stories: it already had two successors after F01.1.a. Read the exact leaf prerequisites rather than inferring order from document position.

## Scenario acceptance owners

| Packet | Story owning complete assembly and recorded acceptance |
|---|---|
| C-01 | [I01.1.a](2026-10-01-pathway-language-level-3-story-spec.md#i01-1-a) |
| C-02 | [M01.4.b](2026-10-01-pathway-language-level-3-story-spec.md#m01-4-b) |
| C-03 | [I01.2.a](2026-10-01-pathway-language-level-3-story-spec.md#i01-2-a) |
| E-01 | [I01.1.b](2026-10-01-pathway-language-level-3-story-spec.md#i01-1-b) |
| E-02 | [G01.2.b](2026-10-01-pathway-language-level-3-story-spec.md#g01-2-b) (including composed scope through X01.2.b) |

<a id="f01"></a>

## F01 — Accept one explicit source definition

**Problem statement:** Given one authored nonclinical guidance recommendation with explicit constant applicability, indication, prerequisites and exclusions, produce a validated source object or an exact source-located rejection.

**High-level work:** Exercise a public core entry point with a tiny fixture; establish schema/version and package boundaries through that behavior.

**Demonstrable completion:** All child behaviors have their declared positive/rejection acceptance evidence; the output is reachable through authored input, not a direct test-only call that skips compilation. Application-only boundaries are tested using compiled results.

**Scope boundary:** No evidence retrieval, expressions beyond literals, graph editor, text parser or clinical publication.

**Stage A trace:** B-01, B-24, B-25; C-03.

**Refinement:** [F01.1 Minimal source contract](2026-10-01-pathway-language-level-2-refined-slices.md#f01-1), [F01.2 Actionable diagnostics and isolation](2026-10-01-pathway-language-level-2-refined-slices.md#f01-2).

<a id="f02"></a>

## F02 — Compile and execute the smallest pathway

**Problem statement:** Given valid constant-only source from F01, produce typed IR and a deterministic recommendation disposition with a source trace.

**High-level work:** Lower only the supported subset, then execute explicit constant clinical contracts.

**Demonstrable completion:** All child behaviors have their declared positive/rejection acceptance evidence; the output is reachable through authored input, not a direct test-only call that skips compilation. Application-only boundaries are tested using compiled results.

**Scope boundary:** No choices, medication safety, variable evidence or full publication workflow.

**Stage A trace:** B-01, B-03, B-22, B-24; C-01, C-03.

**Refinement:** [F02.1 Smallest IR and loader](2026-10-01-pathway-language-level-2-refined-slices.md#f02-1), [F02.2 Deterministic constant disposition](2026-10-01-pathway-language-level-2-refined-slices.md#f02-2).

<a id="f03"></a>

## F03 — Interpret one known or missing observation

**Problem statement:** Given a scoped frozen observation bag and a pathway that reads one typed boolean fact, produce Known/Unknown evidence and the correct downstream decision.

**High-level work:** Introduce explicit binding, query result and lifted boolean composition without live acquisition.

**Demonstrable completion:** All child behaviors have their declared positive/rejection acceptance evidence; the output is reachable through authored input, not a direct test-only call that skips compilation. Application-only boundaries are tested using compiled results.

**Scope boundary:** No thresholds, latest-selection heuristics, aggregates or implicit absence-as-false.

**Stage A trace:** B-01, B-03, B-04, B-13; C-01, E-01.

**Refinement:** [F03.1 Bind one fact without inventing absence](2026-10-01-pathway-language-level-2-refined-slices.md#f03-1), [F03.2 Propagate uncertainty through authored logic](2026-10-01-pathway-language-level-2-refined-slices.md#f03-2).

<a id="f04"></a>

## F04 — Turn material uncertainty into stable Needs

**Problem statement:** Given unresolved evidence affecting a requested recommendation, produce an identifiable unmet obligation with affected outputs.

**High-level work:** Separate evidence causes from actionable requirements and declared materiality.

**Demonstrable completion:** All child behaviors have their declared positive/rejection acceptance evidence; the output is reachable through authored input, not a direct test-only call that skips compilation. Application-only boundaries are tested using compiled results.

**Scope boundary:** No fulfiller selection or external requests.

**Stage A trace:** B-04, B-26, B-28; C-01.

**Refinement:** [F04.1 Stable requirement identity](2026-10-01-pathway-language-level-2-refined-slices.md#f04-1), [F04.2 Materiality and independent obligations](2026-10-01-pathway-language-level-2-refined-slices.md#f04-2).

<a id="f05"></a>

## F05 — Fulfill a Need and reevaluate a new revision

**Problem statement:** Given a pending Need and a recorded provider response, accept only matching authorized evidence and produce a newly evaluated revision.

**High-level work:** Separate pure fulfillment validation from the controlled application fulfiller.

**Demonstrable completion:** All child behaviors have their declared positive/rejection acceptance evidence; the output is reachable through authored input, not a direct test-only call that skips compilation. Application-only boundaries are tested using compiled results.

**Scope boundary:** No live EHR integration, generic provider override or implicit approval.

**Stage A trace:** B-15, B-26; C-01; Stage D later.

**Refinement:** [F05.1 Pure typed fulfillment](2026-10-01-pathway-language-level-2-refined-slices.md#f05-1), [F05.2 Controlled acquisition loop](2026-10-01-pathway-language-level-2-refined-slices.md#f05-2).

<a id="f06"></a>

## F06 — Pin results and invalidate stale review

**Problem statement:** Given frozen inputs, compiled content and a provider review record, replay the same result or require new review after a material change.

**High-level work:** Canonical identities bind evidence, content, result and requested scope.

**Demonstrable completion:** All child behaviors have their declared positive/rejection acceptance evidence; the output is reachable through authored input, not a direct test-only call that skips compilation. Application-only boundaries are tested using compiled results.

**Scope boundary:** No historical legacy reconstruction or production artifact-retention system.

**Stage A trace:** B-22, B-23, B-24; C-01, C-02, C-03.

**Refinement:** [F06.1 Canonical evaluation identity and replay](2026-10-01-pathway-language-level-2-refined-slices.md#f06-1), [F06.2 Review acknowledgement binding](2026-10-01-pathway-language-level-2-refined-slices.md#f06-2).

<a id="f07"></a>

## F07 — Finalize one reviewed scope without duplicate effects

**Problem statement:** Given an authenticated request for a reviewed, ready result, atomically materialize that exact whole scope or reject it.

**High-level work:** Use one isolated database-backed integration seam, not a whole service rewrite.

**Demonstrable completion:** All child behaviors have their declared positive/rejection acceptance evidence; the output is reachable through authored input, not a direct test-only call that skips compilation. Application-only boundaries are tested using compiled results.

**Scope boundary:** No production deployment, real EHR order transmission or partial finalization.

**Stage A trace:** B-23, B-24, B-28 contracts; C-02, C-03 application evidence.

**Refinement:** [F07.1 Requested-scope finalization boundary](2026-10-01-pathway-language-level-2-refined-slices.md#f07-1), [F07.2 Concurrency and idempotency](2026-10-01-pathway-language-level-2-refined-slices.md#f07-2).

<a id="a01"></a>

## A01 — Make incomplete authoring and policy visible

**Problem statement:** Given an authored package with a hole, rationale or institutional policy, produce honest preview and enforce publication/authority boundaries.

**High-level work:** Add draft incompleteness and publication checks without alternate clinical semantics.

**Demonstrable completion:** All child behaviors have their declared positive/rejection acceptance evidence; the output is reachable through authored input, not a direct test-only call that skips compilation. Application-only boundaries are tested using compiled results.

**Scope boundary:** No textual editor, custom interpreter, solver or ingestion.

**Stage A trace:** B-02, B-14, B-18, B-24; C-03.

**Refinement:** [A01.1 Typed holes and preview-only artifacts](2026-10-01-pathway-language-level-2-refined-slices.md#a01-1), [A01.2 Rationale and bounded policy](2026-10-01-pathway-language-level-2-refined-slices.md#a01-2).

<a id="m01"></a>

## M01 — Initiate one reviewed medication through choice and safety

**Problem statement:** Given two reviewed fixed medication alternatives and scoped evidence, propose only an explicitly selected eligible alternative with complete required checks.

**High-level work:** Build medication payload, safety outcomes and choice separately, then integrate C-02.

**Demonstrable completion:** All child behaviors have their declared positive/rejection acceptance evidence; the output is reachable through authored input, not a direct test-only call that skips compilation. Application-only boundaries are tested using compiled results.

**Scope boundary:** No titration, calculated dosing, substitution, drug sequencing or real prescribing.

**Stage A trace:** B-05, B-16, B-17, B-18, B-23; C-02.

**Refinement:** [M01.1 Fixed medication payload and required safety result](2026-10-01-pathway-language-level-2-refined-slices.md#m01-1), [M01.2 Known findings and interaction coverage](2026-10-01-pathway-language-level-2-refined-slices.md#m01-2), [M01.3 One-of selection, refusal and consent](2026-10-01-pathway-language-level-2-refined-slices.md#m01-3), [M01.4 Safety changes after selection and review](2026-10-01-pathway-language-level-2-refined-slices.md#m01-4).

<a id="t01"></a>

## T01 — Use explicit time for one follow-up

**Problem statement:** Given recorded completion, collection and evaluation times, derive the intended due/admissibility state without moving anchors.

**High-level work:** Introduce one clock and one fixed interval at a time before multi-anchor composition.

**Demonstrable completion:** All child behaviors have their declared positive/rejection acceptance evidence; the output is reachable through authored input, not a direct test-only call that skips compilation. Application-only boundaries are tested using compiled results.

**Scope boundary:** No calendar recurrence, event-ended regimens or therapeutic-drug-monitoring workflow.

**Stage A trace:** B-06, B-10, B-12, B-13, B-19, B-20; C-01, E-01.

**Refinement:** [T01.1 Clock and one interval](2026-10-01-pathway-language-level-2-refined-slices.md#t01-1), [T01.2 Completion anchors and stable due state](2026-10-01-pathway-language-level-2-refined-slices.md#t01-2), [T01.3 Planning versus performance and expiration](2026-10-01-pathway-language-level-2-refined-slices.md#t01-3), [T01.4 Freshness and multi-anchor admissibility](2026-10-01-pathway-language-level-2-refined-slices.md#t01-4).

<a id="o01"></a>

## O01 — Select comparable distinct observations

**Problem statement:** Given a bounded observation collection and an explicit selection contract, return an unambiguous matching observation/pair or explain insufficiency.

**High-level work:** Build identity, filtering and pairing without implementing general counts/trends.

**Demonstrable completion:** All child behaviors have their declared positive/rejection acceptance evidence; the output is reachable through authored input, not a direct test-only call that skips compilation. Application-only boundaries are tested using compiled results.

**Scope boundary:** No value differences, two-point rate, regression or arbitrary joins.

**Stage A trace:** B-05, B-09, B-11, B-12, B-13, B-15; E-01, E-02.

**Refinement:** [O01.1 Identity, filtering and latest selection](2026-10-01-pathway-language-level-2-refined-slices.md#o01-1), [O01.2 Compatible values and distinct timed pair](2026-10-01-pathway-language-level-2-refined-slices.md#o01-2), [O01.3 Coverage and explicit provider precedence](2026-10-01-pathway-language-level-2-refined-slices.md#o01-3).

<a id="g01"></a>

## G01 — Interpret measurements in an explicit pregnancy context

**Problem statement:** Given a dated clinical reference, episode and measurement time, derive the reviewed context and apply a versioned lookup.

**High-level work:** Use day count and lookup separately before integrating clinical interpretation.

**Demonstrable completion:** All child behaviors have their declared positive/rejection acceptance evidence; the output is reachable through authored input, not a direct test-only call that skips compilation. Application-only boundaries are tested using compiled results.

**Scope boundary:** No inferred trimester constants, fuzzy date precision or universal clinical thresholds.

**Stage A trace:** B-07, B-08, B-09, B-13, B-22; E-02.

**Refinement:** [G01.1 Sourced pregnancy day count](2026-10-01-pathway-language-level-2-refined-slices.md#g01-1), [G01.2 Lookup and context time](2026-10-01-pathway-language-level-2-refined-slices.md#g01-2).

<a id="x01"></a>

## X01 — Compose pathways without hidden merging or scope changes

**Problem statement:** Given multiple compiled packages evaluated against the same snapshot, produce deterministic combined proposals, preserved findings and honest whole-scope readiness.

**High-level work:** Introduce semantic action identity before coalescing, conflict checks and positive handoff.

**Demonstrable completion:** All child behaviors have their declared positive/rejection acceptance evidence; the output is reachable through authored input, not a direct test-only call that skips compilation. Application-only boundaries are tested using compiled results.

**Scope boundary:** No heuristic merging, compromise treatment or partial-group finalization.

**Stage A trace:** B-21, B-22, B-27, B-28; C-03, E-01, E-02.

**Refinement:** [X01.1 Action identity and equivalent proposals](2026-10-01-pathway-language-level-2-refined-slices.md#x01-1), [X01.2 Conflicts and whole-scope finalization](2026-10-01-pathway-language-level-2-refined-slices.md#x01-2), [X01.3 Positive authorized handoff](2026-10-01-pathway-language-level-2-refined-slices.md#x01-3), [X01.4 Operational readiness without changing clinical indication](2026-10-01-pathway-language-level-2-refined-slices.md#x01-4).

<a id="v01"></a>

## V01 — Explain ineffective or inconsistent relationships before execution

**Problem statement:** Given a valid authored graph within a bounded analysis fragment, produce source-linked structural diagnostics with explicit severity and analysis limits.

**High-level work:** Use dependency tracing, constant folding and finite-domain comparison before considering a solver.

**Demonstrable completion:** All child behaviors have their declared positive/rejection acceptance evidence; the output is reachable through authored input, not a direct test-only call that skips compilation. Application-only boundaries are tested using compiled results.

**Scope boundary:** No universal reachability proof, automatic clinical-rule repair or rejection of legitimate provider-choice overlap.

**Stage A trace:** B-01, B-03, B-29; C-03.

**Refinement:** [V01.1 Unused dependencies and constant impossibility](2026-10-01-pathway-language-level-2-refined-slices.md#v01-1), [V01.2 Ineffective guards within an explicit fragment](2026-10-01-pathway-language-level-2-refined-slices.md#v01-2), [V01.3 Finite-domain exclusive-condition checking](2026-10-01-pathway-language-level-2-refined-slices.md#v01-3).

<a id="u01"></a>

## U01 — Author and inspect a supported pathway without reading raw JSON

**Problem statement:** Given a canonical pathway and supported scenario, show editable meaning, source-mapped diagnostics and preview outputs on a readable authoring surface.

**High-level work:** Reuse a narrow existing canvas/details seam where suitable; keep the backend authoritative.

**Demonstrable completion:** All child behaviors have their declared positive/rejection acceptance evidence; the output is reachable through authored input, not a direct test-only call that skips compilation. Application-only boundaries are tested using compiled results.

**Scope boundary:** No full editor rewrite, ingestion, text parser, production activation UI or client-side clinical evaluator.

**Stage A trace:** B-01, B-02, B-22, B-29, B-30; C-03; supports C-01/C-02/E-01/E-02 review.

**Refinement:** [U01.1 Canonical graph display and diagnostic navigation](2026-10-01-pathway-language-level-2-refined-slices.md#u01-1), [U01.2 One property edit and scenario preview](2026-10-01-pathway-language-level-2-refined-slices.md#u01-2).

<a id="i01"></a>

## I01 — Close named scenario acceptance through the assembled application

**Problem statement:** Given the adjudicated scenario packets and implemented component contracts, produce one recorded end-to-end acceptance result per owned scenario.

**High-level work:** Assign a concrete integration story for C-01, E-01 and C-03 and explicit completion ownership for existing C-02/E-02 stories.

**Demonstrable completion:** All child behaviors have their declared positive/rejection acceptance evidence; the output is reachable through authored input, not a direct test-only call that skips compilation. Application-only boundaries are tested using compiled results.

**Scope boundary:** No new clinical rules, catch-all feature development, live EHR evidence or declaration of production readiness.

**Stage A trace:** B-01 through B-30 as applicable; C-01, C-03, E-01; ownership links for C-02/E-02.

**Refinement:** [I01.1 Clinical scenario assembly](2026-10-01-pathway-language-level-2-refined-slices.md#i01-1), [I01.2 Authoring and protective scenario closure](2026-10-01-pathway-language-level-2-refined-slices.md#i01-2).

## Foundation walkthrough

Use an explicitly nonclinical fixture: one guidance recommendation with applicability true and indication bound to a scoped boolean `assessment_confirmed` fact. Prerequisites/exclusions are explicitly declared; no drug or clinical threshold is implied.

| Incremental input | Required observable output |
|---|---|
| Complete constant-only source / missing required source field | Valid source / source-located rejection (F01) |
| Constant indication true with no exclusion | Proposed guidance with its predicate trace (F02) |
| Indication reads an absent `assessment_confirmed` fact | Unknown indication rather than false (F03) |
| Same unresolved fact still material on reevaluation | One stable Need, not another duplicate request (F04) |
| Authorized scoped attestation supplies true | New evaluated revision proposes guidance; prior revision remains available (F05) |
| Result is reviewed, then the fact is corrected to false | Original replay is unchanged; current result is not indicated and old review is stale (F06) |
| Ready reviewed sandbox scope is submitted twice | One committed sandbox plan; same result on retry, no second materialization (F07) |

These are engineering expectations. They do not prescribe a clinical rule or replace C-01 adjudication.

## Milestone completion and remaining work

Run B/C/E evidence incrementally; do not build the entire Stage B kernel before trying a compiled application scenario. A story contributes only the assertions it actually tests. Whole C-01/C-02/C-03/E-01/E-02 acceptance requires assembling the relevant stories and the adjudicated scenario packet from Stage A.

Stage D live EHR acquisition, real safety/reference adapters, production retention and Stage F release operations remain separate integration/release planning work. These three documents do not claim to break down the entire production launch. New adapters must use the proven contracts; a synthetic result is never evidence that a live integration works. General counts, rates, recurrence, bundles, treatment changes and related-patient execution remain deferred as stated in Stage A.

Use a scoped release only after its required capability/scenario, clinical and operational gates pass. Completing the foundation spine alone does not satisfy the full v0 profile.
