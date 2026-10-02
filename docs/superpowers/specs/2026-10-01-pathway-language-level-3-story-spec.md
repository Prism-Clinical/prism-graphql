# Level 3: Single-story executable components

**Problem statement:** Given one refined slice with its prerequisites and contract decisions satisfied, produce a reviewable implementation increment with a single behavioral outcome, a small touch surface and independent acceptance evidence. Design stories produce precise reviewed decisions before their dependent implementation starts. No story below means “build the service” or “implement the whole node type.”

**Status:** Proposed language-definition and implementation decomposition, not implementation completion or clinical approval.

**Date:** 2026-10-01

**Last revised:** 2026-10-02 — add language definition before implementation.

**Authority:** [Accepted architecture](2026-09-28-pathway-language-rfc.md) and [Stage A contracts](2026-09-30-pathway-language-stage-a-spec.md). These documents organize delivery under the Stage A capability contracts. They do not independently promote deferred capabilities.

L00 defines one source-backed GERD example’s meaning and minimal source contract before implementation begins. The RFC fixes architectural boundaries, while Stage A remains a draft: neither supplies every exact language decision. L00 completion defines only this fragment, not the whole language. Later capability tracks must resolve their own contracts before implementation.

The F01–F07 slices establish a narrow source-to-reviewed-result loop. Follow-on tracks add the clinically justified capabilities; they are not prerequisites for a literal-only foundation demo. Completed implementation slices contribute evidence toward stages B/C/E; no single early slice claims full `ppl-core-v0` support or permission for clinical launch.

Intermediate artifacts declare only the implemented engineering subset and cannot claim the complete `ppl-core-v0` profile. Unsupported operations reject; test harness support must not weaken the clinical loader. The foundation finalization demonstration is sandbox-only until publication, safety and live-evidence boundaries are implemented and validated.

Clinical examples use frozen nonclinical fixtures. Real thresholds, medication definitions, date rules and expected clinical interpretations require named adjudicators under Stage A. Engineering contract decisions must also be fixed before their dependent story starts. Prototype work while Stage A is open remains explicitly nonclinical and cannot satisfy a clinical gate by itself.

No production database wipe, deployment, EHR transmission or new ingestion work is authorized by these plans. A story involving persistence uses an isolated new-system test schema. A trusted nonclinical harness may materialize sandbox plan artifacts using the shared domain/transaction logic; it cannot call clinical endpoints with synthetic evidence or expose a caller-selectable bypass. Clinical mode must reject synthetic/preview artifacts.

## Source for the first language-definition story

Use the supplied [GERD pregnancy pathway](../records/pathway-language/corpus/GERD-Pregnancy-Care-Pathway.txt), under “CLINICAL DIAGNOSIS” → “ALARM SYMPTOMS REQUIRING IMMEDIATE EVALUATION”, specifically the progressive-dysphagia bullet. The unchanged source is pinned by SHA-256 `937859b9b22f672e4d212cdd99b188f1e1d12b6cd4217459155d2c34a8f67032` in the [corpus manifest](../records/pathway-language/corpus/manifest.json).

L00.1.a defines only how evidence for this alarm relates to a proposed evaluation within an explicitly agreed scope. The source’s urgency wording is a requirement to interpret, not permission to invent a numerical deadline, diagnostic test or treatment. Preserve the distinction between progressive dysphagia in this passage and the broader dysphagia wording in the referral section. Other alarms, referral/endoscopy decisions, medication sequencing and the full C-01 scenario remain outside this first story.

Use constructed evidence cases for symptom present, explicitly assessed absent, and not assessed/unavailable. Establish what evidence can support each case; an empty chart is not an explicit negative. A negative for this one symptom cannot clear all alarms or imply that no evaluation is needed for another reason. Source documents are design inputs, not approved executable guidance. Drafting and extracting questions can begin now; a named clinical reviewer must adjudicate the intended scope, urgency and action meaning before the story closes. This update selects the source, but does not claim that adjudication or its outcome table is complete.

The later constant-only F01 validator fixture remains an engineering restriction of the reviewed representation, not an executable clinical version of this alarm rule. Evidence-dependent evaluation arrives later. L00 completion also does not close the larger C-01 packet.

## Story execution rules

- Each story is a candidate for one independently reviewable PR. L00 produces reviewed design documents and manually checked examples; it does not require code or automated tests. Implementation stories include implementation, fixtures and meaningful tests together. This is a scope target, not a duration promise. If a new operator, adapter or unresolved clinical policy is discovered, record it as a dependency or split a child story; do not silently expand the story.
- Start prerequisites require reviewed design outputs for L00 and usable implementation outputs with targeted boundary tests for implementation stories. They do not require every downstream integration check to finish before another story can begin. Integration/acceptance gates must pass before the affected story claims integrated capability or scenario acceptance; all prerequisite gates remain cumulative for publication. Both the start graph and the graph including acceptance gates are acyclic. A prototype cannot bypass a runtime or publication guard.
- DESIGN means reviewed specification examples and decisions, with no new package. Proposed implementation locations use `CORE` for the new `libs/pathway-language` package and `APP` for new-system seams in `apps/pathway-service`. Existing `services/resolution/session-store.ts`, `effective-context.ts` and `resolvers/mutations/resolution.ts` are reference points, not promises of legacy compatibility or instructions to reuse old semantics. UI refers to the separate `prism-admin-dashboard` repository: `src/components/graph/PathwayCanvas.tsx` and its PropertiesPanel are inspected reuse seams. Its current node-only validationErrors shape needs explicit relationship/field source mapping. The UI consumes the canonical AST and backend semantics. Each story chooses the smallest appropriate files after inspection.
- Every compiler/evaluator story uses a minimal authored-source fixture through the supported public pipeline when its compiler path exists. Application stories consume compiled artifacts. Do not validate a story solely by invoking the function being implemented without checking its boundary.
- Exact TypeScript names, error tokens and canonical schema shapes are fixed in Stage A/story contract review. Semantic outcomes below are normative acceptance expectations; example field labels are not permission to invent a second language model.
- Run targeted unit/conformance tests for core behavior; use independent golden/metamorphic cases where appropriate. Transaction stories require isolated real database integration. No application implementation or test execution is claimed by this documentation.

## Readiness codes

| Code | Required before starting the story | Current status |
|---|---|---|
| D | Prior design outputs are reviewed; engineering decisions have an owner; L00.1.a additionally requires named clinical review of the source interpretation before completion | Language decisions are open; this story produces the contract rather than requiring it to exist |
| E | Engineering owner has fixed the exact supported contract and expected nonclinical outputs in Stage A or the linked story decision | Contract-specific decisions remain open; do not treat this plan as completed Stage A |
| C1 | E plus named clinical review of the relevant C-01 assessment/follow-up behavior | Clinical owner/reviewers unassigned in Stage A |
| C2 | E plus actual reviewed medication definitions, safety requirements and C-02 expected outcomes | Clinical owner/reviewers unassigned; no invented drugs/doses |
| E1 | E plus adjudicated E-01 timing, completion, precedence, overlap or handoff assumptions used by this story | Clinical owner/reviewers unassigned |
| E2 | E plus adjudicated E-02 date basis, table contents, pairing/classification assumptions used by this story | Clinical owner/reviewers unassigned |

Technical prototypes can precede clinical adjudication only as nonclinical provisional evidence. They do not close a clinical story or fulfill a Stage A clinical packet. Assign responsible people in Stage A rather than fabricating owners here.

## Dependency audit

There are 17 outcomes, 44 refinements and 85 stories. The original 65-story implementation plan had a longest dependency chain of 34 stories. The subsequent 77-story plan had start depth 17 and acceptance depth 23 but omitted the prerequisite language-definition work. The current counts include that newly explicit design work. The revised start-prerequisite graph has depth 25; including integration/acceptance gates gives depth 31. Both have no dangling references or cycles. These are unit-weighted graph depths, not duration estimates or a promise of proportionate speedup; scope has also increased.

8 stories define language contracts (D); 47 implementation stories have engineering readiness code E; 30 require clinical adjudication (C1: 4, C2: 8, E1: 11, E2: 7). E does not mean immediately ready: prerequisites and unresolved engineering contracts still apply. Clinical owners remain unassigned and are required before clinical acceptance. D is a design-work code, not a clinical-review exemption: the source-backed L00.1.a requires clinical interpretation review, inherited by later L00 stories.

L00.1.a is the first story with no implementation predecessor; its unresolved questions are its work. After L00 and F01.1.a, F01.1.b, F01.2.a, F01.2.b and U01.1.a can start independently once their contract decisions are fixed. The previous plan was not literally serial for its first fifteen stories: it already had two successors after F01.1.a. Read the exact leaf prerequisites rather than inferring order from document position.

## L00 — Define the meaning and representation of one pathway

<a id="l00-1-a"></a>

### L00.1.a — Define one pathway’s intended meaning without syntax

**Problem statement:** Given the supplied GERD pregnancy pathway’s progressive-dysphagia alarm passage and explicitly scoped symptom evidence, produce a source-linked, clinically reviewed meaning table for present, explicitly absent and unavailable symptom evidence, with explanations.

**Parent:** [L00.1](2026-10-01-pathway-language-level-2-refined-slices.md#l00-1). **Stage A trace:** Stage A sections 2, 3, 6, 8 and 17; prepares B-01, B-03, B-04, B-24; no conformance completion claimed.

**Start prerequisites:** No implementation predecessor.

**Integration/acceptance gates:** No additional story-specific gates; inherited gates and profile/scenario requirements still apply. **Readiness:** D.

**High-level work:** Read the named GERD passage and its surrounding context; state the intended pregnancy/encounter scope; distinguish progressive dysphagia from generic dysphagia; identify the symptom evidence and proposed evaluation; preserve the source urgency wording for adjudication; record unanswered questions without adding tests, treatments or deadlines.

**Expected touch surface:** DESIGN/GERD source passage, interpretation questions and outcome table (proposed; inspect existing seams before editing).

**Acceptance:** Each case traces to the pinned source and a named clinical reviewer’s interpretation; present, explicitly absent and unassessed evidence remain distinct; absence of this one trigger cannot establish absence of other alarms or overall safety; proposal is not execution; unresolved scope, urgency or action meaning blocks completion; record clinical and engineering review identities and revision.

**Out of this story:** No JSON fields, grammar, complete node catalogue, full GERD algorithm or unreviewed clinical interpretation. Stop when the stated outcome and its required review/verification pass; do not absorb the rest of the parent track.

<a id="l00-1-b"></a>

### L00.1.b — Define only the concepts needed by the example

**Problem statement:** Given the reviewed meaning table from L00.1.a, produce a small glossary of necessary concepts with one responsibility each.

**Parent:** [L00.1](2026-10-01-pathway-language-level-2-refined-slices.md#l00-1). **Stage A trace:** Stage A sections 2, 3, 6, 8 and 17; prepares B-01, B-03, B-04, B-24; no conformance completion claimed.

**Start prerequisites:** [L00.1.a](2026-10-01-pathway-language-level-3-story-spec.md#l00-1-a).

**Integration/acceptance gates:** No additional story-specific gates; inherited gates and profile/scenario requirements still apply. **Readiness:** D.

**High-level work:** Identify inputs, evidence state, authored condition, recommendation and result only where needed; relate definitions to Stage A terminology and list remaining ambiguities.

**Expected touch surface:** DESIGN/example glossary (proposed; inspect existing seams before editing).

**Acceptance:** Each concept points to a concrete part of the example; no two concepts have silently overlapping responsibilities; no software class or node catalogue is implied.

**Out of this story:** No JSON fields, grammar, complete node catalogue, full GERD algorithm or unreviewed clinical interpretation. Stop when the stated outcome and its required review/verification pass; do not absorb the rest of the parent track.

<a id="l00-2-a"></a>

### L00.2.a — Define the example’s relationships

**Problem statement:** Given the reviewed example and glossary, produce a small relation table stating endpoints, direction, cardinality and effect on meaning.

**Parent:** [L00.2](2026-10-01-pathway-language-level-2-refined-slices.md#l00-2). **Stage A trace:** Stage A sections 2, 3, 6, 8 and 17; prepares B-01, B-03, B-04, B-24; no conformance completion claimed.

**Start prerequisites:** [L00.1.b](2026-10-01-pathway-language-level-3-story-spec.md#l00-1-b).

**Integration/acceptance gates:** No additional story-specific gates; inherited gates and profile/scenario requirements still apply. **Readiness:** D.

**High-level work:** Describe how the fact supplies the condition and how the condition supports the proposal; distinguish dependency from presentation and execution order.

**Expected touch surface:** DESIGN/relation table (proposed; inspect existing seams before editing).

**Acceptance:** Each relationship has one explicit meaning; ambiguous or duplicate binding is identified as invalid where appropriate; two readers can reconstruct the example without inferring meaning from diagram layout.

**Out of this story:** No generic graph framework, all future operators or implementation schemas. Stop when the stated outcome and its required review/verification pass; do not absorb the rest of the parent track.

<a id="l00-2-b"></a>

### L00.2.b — Define the example’s types and unavailable evidence

**Problem statement:** Given the concepts and legal relation table, produce a minimal value-domain and compatibility table.

**Parent:** [L00.2](2026-10-01-pathway-language-level-2-refined-slices.md#l00-2). **Stage A trace:** Stage A sections 2, 3, 6, 8 and 17; prepares B-01, B-03, B-04, B-24; no conformance completion claimed.

**Start prerequisites:** [L00.2.a](2026-10-01-pathway-language-level-3-story-spec.md#l00-2-a).

**Integration/acceptance gates:** No additional story-specific gates; inherited gates and profile/scenario requirements still apply. **Readiness:** D.

**High-level work:** Define the boolean domain and distinct unresolved evidence state; specify allowed bindings and reject incompatible ones; keep missing patient evidence separate from malformed authored definitions.

**Expected touch surface:** DESIGN/types and compatibility examples (proposed; inspect existing seams before editing).

**Acceptance:** True, false and unavailable are distinguishable; wrong-type binding is an invalid definition; missing evidence is a valid input case; all domains needed by the example have explicit boundaries.

**Out of this story:** No generic graph framework, all future operators or implementation schemas. Stop when the stated outcome and its required review/verification pass; do not absorb the rest of the parent track.

<a id="l00-3-a"></a>

### L00.3.a — Define evaluation rules for the example

**Problem statement:** Given the typed model and original meaning table, produce a small rule table that reproduces the agreed outputs and explanations.

**Parent:** [L00.3](2026-10-01-pathway-language-level-2-refined-slices.md#l00-3). **Stage A trace:** Stage A sections 2, 3, 6, 8 and 17; prepares B-01, B-03, B-04, B-24; no conformance completion claimed.

**Start prerequisites:** [L00.2.b](2026-10-01-pathway-language-level-3-story-spec.md#l00-2-b).

**Integration/acceptance gates:** No additional story-specific gates; inherited gates and profile/scenario requirements still apply. **Readiness:** D.

**High-level work:** State fact resolution, condition result and proposal disposition separately; specify handling of unavailable evidence; distinguish language meaning from a future execution algorithm.

**Expected touch surface:** DESIGN/evaluation rule table (proposed; inspect existing seams before editing).

**Acceptance:** Walk every original case through the rules without inventing a default; no rule executes the proposal; disagreements with Stage A are recorded for explicit resolution rather than silently creating alternate semantics.

**Out of this story:** No evaluator code, full boolean algebra specification or patient-dependent proofs. Stop when the stated outcome and its required review/verification pass; do not absorb the rest of the parent track.

<a id="l00-3-b"></a>

### L00.3.b — Define invalid pathway examples

**Problem statement:** Given the reviewed relationships, types and evaluation rules, produce a small rejection catalogue with one reason and boundary per invalid definition.

**Parent:** [L00.3](2026-10-01-pathway-language-level-2-refined-slices.md#l00-3). **Stage A trace:** Stage A sections 2, 3, 6, 8 and 17; prepares B-01, B-03, B-04, B-24; no conformance completion claimed.

**Start prerequisites:** [L00.3.a](2026-10-01-pathway-language-level-3-story-spec.md#l00-3-a).

**Integration/acceptance gates:** No additional story-specific gates; inherited gates and profile/scenario requirements still apply. **Readiness:** D.

**High-level work:** Write minimal malformed or ambiguous definitions in prose; cover missing required meaning, incompatible binding and unsupported meaning; separate definition errors from unavailable evidence.

**Expected touch surface:** DESIGN/negative examples (proposed; inspect existing seams before editing).

**Acceptance:** Each invalid example violates a named rule; each valid control example remains valid; source-validation versus later semantic checking is explicitly assigned; no diagnostic code or field syntax is assumed yet.

**Out of this story:** No evaluator code, full boolean algebra specification or patient-dependent proofs. Stop when the stated outcome and its required review/verification pass; do not absorb the rest of the parent track.

<a id="l00-4-a"></a>

### L00.4.a — Choose the initial authoring representation

**Problem statement:** Given the reviewed meaning, relation, type and rejection examples, produce one documented representation for the tiny language fragment with tradeoffs and an example encoding.

**Parent:** [L00.4](2026-10-01-pathway-language-level-2-refined-slices.md#l00-4). **Stage A trace:** Stage A sections 2, 3, 6, 8 and 17; prepares B-01, B-03, B-04, B-24; no conformance completion claimed.

**Start prerequisites:** [L00.3.b](2026-10-01-pathway-language-level-3-story-spec.md#l00-3-b).

**Integration/acceptance gates:** No additional story-specific gates; inherited gates and profile/scenario requirements still apply. **Readiness:** D.

**High-level work:** Separate human authoring notation from canonical source; select the minimal initial encoding within the accepted AST architecture; map each encoded element back to its meaning; explicitly defer textual parser and UI decisions not needed here.

**Expected touch surface:** DESIGN/representation decision and example encoding (proposed; inspect existing seams before editing).

**Acceptance:** The example can be read back without changing meaning; representation introduces no implicit clinical defaults; record the choice, alternatives and owner; illustrate both evidence-driven meaning and the constant-only restriction used by F01.

**Out of this story:** No reopening the architecture silently, full textual language, compiler IR or validator implementation. Stop when the stated outcome and its required review/verification pass; do not absorb the rest of the parent track.

<a id="l00-4-b"></a>

### L00.4.b — Specify the smallest source-validation contract

**Problem statement:** Given the selected representation and reviewed positive/negative examples, produce exact input, normalized source output and diagnostic examples for the first validator.

**Parent:** [L00.4](2026-10-01-pathway-language-level-2-refined-slices.md#l00-4). **Stage A trace:** Stage A sections 2, 3, 6, 8 and 17; prepares B-01, B-03, B-04, B-24; no conformance completion claimed.

**Start prerequisites:** [L00.4.a](2026-10-01-pathway-language-level-3-story-spec.md#l00-4-a).

**Integration/acceptance gates:** No additional story-specific gates; inherited gates and profile/scenario requirements still apply. **Readiness:** D.

**High-level work:** Fix required fields, literal types, source identity, supported version pair and error locations; define the constant-only F01 subset separately from later evidence evaluation; record cases owned by later stories.

**Expected touch surface:** DESIGN/validator contract and acceptance fixtures (proposed; inspect existing seams before editing).

**Acceptance:** F01.1.a can be implemented without choosing language meaning or inventing fields; complete input passes, missing applicability and unknown executable property have exact rejection expectations; contract owner and reviewed revision are recorded.

**Out of this story:** No reopening the architecture silently, full textual language, compiler IR or validator implementation. Stop when the stated outcome and its required review/verification pass; do not absorb the rest of the parent track.

## F01 — Accept one explicit source definition

<a id="f01-1-a"></a>

### F01.1.a — Accept the smallest authored fixture

**Problem statement:** Given a fixture with all required literal fields and supported version pair, produce a normalized typed source through the core public export.

**Parent:** [F01.1](2026-10-01-pathway-language-level-2-refined-slices.md#f01-1). **Stage A trace:** B-01, B-24, B-25; C-03.

**Start prerequisites:** [L00.4.b](2026-10-01-pathway-language-level-3-story-spec.md#l00-4-b).

**Integration/acceptance gates:** No additional story-specific gates; inherited gates and profile/scenario requirements still apply. **Readiness:** E.

**High-level work:** Implement the reviewed L00.4.b contract in the smallest isolated core package and public export; return any missing language decision to L00 rather than choosing semantics in code.

**Expected touch surface:** CORE/source and package exports (proposed; inspect existing seams before editing).

**Acceptance:** A complete fixture succeeds; missing applicability and an unknown executable property fail with their AST locations.

**Out of this story:** No general node catalogue or hidden default conditions. Stop when the stated outcome and its required review/verification pass; do not absorb the rest of the parent track.

<a id="f01-1-b"></a>

### F01.1.b — Reject unsupported source versions

**Problem statement:** Given the same fixture with supported or unsupported language/profile pairs, produce a deterministic supported source or version diagnostic before lowering.

**Parent:** [F01.1](2026-10-01-pathway-language-level-2-refined-slices.md#f01-1). **Stage A trace:** B-01, B-24, B-25; C-03.

**Start prerequisites:** [F01.1.a](2026-10-01-pathway-language-level-3-story-spec.md#f01-1-a).

**Integration/acceptance gates:** No additional story-specific gates; inherited gates and profile/scenario requirements still apply. **Readiness:** E.

**High-level work:** Validate the explicit compatibility pair from the Stage A contract; keep compiler build identity separate.

**Expected touch surface:** CORE/source version validation (proposed; inspect existing seams before editing).

**Acceptance:** Supported pair passes; unsupported profile or language fails; version checking does not silently substitute another profile.

**Out of this story:** No general node catalogue or hidden default conditions. Stop when the stated outcome and its required review/verification pass; do not absorb the rest of the parent track.

<a id="f01-2-a"></a>

### F01.2.a — Report stable source diagnostics

**Problem statement:** Given malformed literal fields and duplicate source IDs, produce ordered diagnostic codes with exact AST paths.

**Parent:** [F01.2](2026-10-01-pathway-language-level-2-refined-slices.md#f01-2). **Stage A trace:** B-01, B-24, B-25; C-03.

**Start prerequisites:** [F01.1.a](2026-10-01-pathway-language-level-3-story-spec.md#f01-1-a).

**Integration/acceptance gates:** No additional story-specific gates; inherited gates and profile/scenario requirements still apply. **Readiness:** E.

**High-level work:** Add source identity indexing and stable error ordering; retain diagnostic schema in fixture expectations.

**Expected touch surface:** CORE/diagnostics (proposed; inspect existing seams before editing).

**Acceptance:** Wrong literal type and duplicate ID each point to the offending source; repeated runs produce equivalent diagnostics.

**Out of this story:** No broad developer tooling or application refactor. Stop when the stated outcome and its required review/verification pass; do not absorb the rest of the parent track.

<a id="f01-2-b"></a>

### F01.2.b — Prove the core import boundary

**Problem statement:** Given a public consumer fixture and an intentionally forbidden infrastructure import, produce successful isolated consumer build and a failing boundary check for forbidden dependencies.

**Parent:** [F01.2](2026-10-01-pathway-language-level-2-refined-slices.md#f01-2). **Stage A trace:** B-01, B-24, B-25; C-03.

**Start prerequisites:** [F01.1.a](2026-10-01-pathway-language-level-3-story-spec.md#f01-1-a).

**Integration/acceptance gates:** No additional story-specific gates; inherited gates and profile/scenario requirements still apply. **Readiness:** E.

**High-level work:** Add the core package build/configuration and targeted direct/transitive import check; do not reorganize unrelated services.

**Expected touch surface:** CORE/package boundary and CI (proposed; inspect existing seams before editing).

**Acceptance:** Public consumer builds without resolver/database/network imports; an injected forbidden dependency fails CI check.

**Out of this story:** No broad developer tooling or application refactor. Stop when the stated outcome and its required review/verification pass; do not absorb the rest of the parent track.

## F02 — Compile and execute the smallest pathway

<a id="f02-1-a"></a>

### F02.1.a — Lower the literal fixture

**Problem statement:** Given f01 validated source, produce iR with literal decisions, action payload and source mappings.

**Parent:** [F02.1](2026-10-01-pathway-language-level-2-refined-slices.md#f02-1). **Stage A trace:** B-01, B-03, B-22, B-24; C-01, C-03.

**Start prerequisites:** [F01.1.a](2026-10-01-pathway-language-level-3-story-spec.md#f01-1-a), [F01.2.a](2026-10-01-pathway-language-level-3-story-spec.md#f01-2-a).

**Integration/acceptance gates:** [F01.1.b](2026-10-01-pathway-language-level-3-story-spec.md#f01-1-b), [F01.2.b](2026-10-01-pathway-language-level-3-story-spec.md#f01-2-b). **Readiness:** E.

**High-level work:** Implement direct lowering for the one supported action and freeze/copy immutable structures.

**Expected touch surface:** CORE/compiler and IR (proposed; inspect existing seams before editing).

**Acceptance:** Each generated operation maps to source; explicit false remains false; unsupported source constructs reject rather than disappear.

**Out of this story:** No generic virtual machine or remote compiler. Stop when the stated outcome and its required review/verification pass; do not absorb the rest of the parent track.

<a id="f02-1-b"></a>

### F02.1.b — Load only a supported artifact

**Problem statement:** Given compiled literal artifact or structurally invalid/opcode-mismatched artifact, produce a validated execution input or explicit load failure.

**Parent:** [F02.1](2026-10-01-pathway-language-level-2-refined-slices.md#f02-1). **Stage A trace:** B-01, B-03, B-22, B-24; C-01, C-03.

**Start prerequisites:** [F02.1.a](2026-10-01-pathway-language-level-3-story-spec.md#f02-1-a), [F01.1.b](2026-10-01-pathway-language-level-3-story-spec.md#f01-1-b).

**Integration/acceptance gates:** No additional story-specific gates; inherited gates and profile/scenario requirements still apply. **Readiness:** E.

**High-level work:** Add IR schema/opcode/version checks; production approval/digest authorization comes in F06/A01.

**Expected touch surface:** CORE/artifact validation (proposed; inspect existing seams before editing).

**Acceptance:** Valid literal artifact loads; unknown opcode and missing source reference fail before execution.

**Out of this story:** No generic virtual machine or remote compiler. Stop when the stated outcome and its required review/verification pass; do not absorb the rest of the parent track.

<a id="f02-2-a"></a>

### F02.2.a — Evaluate constant indication and exclusion

**Problem statement:** Given a supported artifact with combinations of True/False applicability, indication, prerequisite and exclusion, produce expected proposed/not-applicable/withheld result with separate predicate values.

**Parent:** [F02.2](2026-10-01-pathway-language-level-2-refined-slices.md#f02-2). **Stage A trace:** B-01, B-03, B-22, B-24; C-01, C-03.

**Start prerequisites:** [F02.1.b](2026-10-01-pathway-language-level-3-story-spec.md#f02-1-b).

**Integration/acceptance gates:** No additional story-specific gates; inherited gates and profile/scenario requirements still apply. **Readiness:** E.

**High-level work:** Implement the boolean portion of the Stage A reducer and minimal structured trace.

**Expected touch surface:** CORE/evaluator reducer (proposed; inspect existing seams before editing).

**Acceptance:** False indication plus true exclusion preserves both; unmet prerequisite is distinguished from not indicated.

**Out of this story:** No clinical-ready medication or external side effects. Stop when the stated outcome and its required review/verification pass; do not absorb the rest of the parent track.

<a id="f02-2-b"></a>

### F02.2.b — Preserve results under irrelevant ordering

**Problem statement:** Given equivalent source/IR fixtures with reordered independent definitions, produce equivalent canonical result and source-linked explanation.

**Parent:** [F02.2](2026-10-01-pathway-language-level-2-refined-slices.md#f02-2). **Stage A trace:** B-01, B-03, B-22, B-24; C-01, C-03.

**Start prerequisites:** [F02.2.a](2026-10-01-pathway-language-level-3-story-spec.md#f02-2-a).

**Integration/acceptance gates:** No additional story-specific gates; inherited gates and profile/scenario requirements still apply. **Readiness:** E.

**High-level work:** Add deterministic trace ordering and a small direct metamorphic fixture.

**Expected touch surface:** CORE/evaluator determinism (proposed; inspect existing seams before editing).

**Acceptance:** Reordering independent source fields/definitions changes neither disposition nor semantic explanation; unsupported work budget returns failure.

**Out of this story:** No clinical-ready medication or external side effects. Stop when the stated outcome and its required review/verification pass; do not absorb the rest of the parent track.

## F03 — Interpret one known or missing observation

<a id="f03-1-a"></a>

### F03.1.a — Bind and resolve a known boolean observation

**Problem statement:** Given one query port and one same-subject/episode observation, produce known value with original evidence ID and source trace.

**Parent:** [F03.1](2026-10-01-pathway-language-level-2-refined-slices.md#f03-1). **Stage A trace:** B-01, B-03, B-04, B-13; C-01, E-01.

**Start prerequisites:** [F02.2.a](2026-10-01-pathway-language-level-3-story-spec.md#f02-2-a).

**Integration/acceptance gates:** [F02.2.b](2026-10-01-pathway-language-level-3-story-spec.md#f02-2-b). **Readiness:** E.

**High-level work:** Extend source/lowering with exactly one EvidenceQuery binding; reject incompatible port types.

**Expected touch surface:** CORE/binding and evidence resolution (proposed; inspect existing seams before editing).

**Acceptance:** Known False stays known false; wrong-subject observation cannot satisfy the binding; a wrong-type binding is a compile error.

**Out of this story:** No provenance ranking or query-completeness assertions. Stop when the stated outcome and its required review/verification pass; do not absorb the rest of the parent track.

<a id="f03-1-b"></a>

### F03.1.b — Represent absent and failed evidence distinctly

**Problem statement:** Given no matching item, an explicitly unavailable retrieval, or malformed relevant data, produce missing, Unavailable or Invalid evidence causes without a clinical negative.

**Parent:** [F03.1](2026-10-01-pathway-language-level-2-refined-slices.md#f03-1). **Stage A trace:** B-01, B-03, B-04, B-13; C-01, E-01.

**Start prerequisites:** [F03.1.a](2026-10-01-pathway-language-level-3-story-spec.md#f03-1-a).

**Integration/acceptance gates:** No additional story-specific gates; inherited gates and profile/scenario requirements still apply. **Readiness:** E.

**High-level work:** Add tagged evidence result and preserve relevant candidate diagnostics.

**Expected touch surface:** CORE/evidence results (proposed; inspect existing seams before editing).

**Acceptance:** An empty bag is Unknown/Missing, not False; unavailable and invalid remain distinguishable.

**Out of this story:** No provenance ranking or query-completeness assertions. Stop when the stated outcome and its required review/verification pass; do not absorb the rest of the parent track.

<a id="f03-2-a"></a>

### F03.2.a — Execute three-valued boolean composition

**Problem statement:** Given known True/False and Unknown operands bound in source, produce stage A all/any/not outcomes with retained reasons.

**Parent:** [F03.2](2026-10-01-pathway-language-level-2-refined-slices.md#f03-2). **Stage A trace:** B-01, B-03, B-04, B-13; C-01, E-01.

**Start prerequisites:** [F03.1.b](2026-10-01-pathway-language-level-3-story-spec.md#f03-1-b).

**Integration/acceptance gates:** No additional story-specific gates; inherited gates and profile/scenario requirements still apply. **Readiness:** E.

**High-level work:** Implement the operator truth tables through the same compiler/evaluator path.

**Expected touch surface:** CORE/boolean expressions (proposed; inspect existing seams before editing).

**Acceptance:** False AND Unknown resolves false while retaining uncertainty; True OR Unknown resolves true; NOT Unknown stays unknown.

**Out of this story:** No arbitrary expressions or confidence scoring. Stop when the stated outcome and its required review/verification pass; do not absorb the rest of the parent track.

<a id="f03-2-b"></a>

### F03.2.b — Reject invalid evidence dependency graphs

**Problem statement:** Given a source with duplicate scalar binding or evidence/predicate cycle, produce source-located compile rejection before execution.

**Parent:** [F03.2](2026-10-01-pathway-language-level-2-refined-slices.md#f03-2). **Stage A trace:** B-01, B-03, B-04, B-13; C-01, E-01.

**Start prerequisites:** [F03.1.a](2026-10-01-pathway-language-level-3-story-spec.md#f03-1-a).

**Integration/acceptance gates:** No additional story-specific gates; inherited gates and profile/scenario requirements still apply. **Readiness:** E.

**High-level work:** Extend graph validation for the new explicit reads and retain legal acyclic ordering.

**Expected touch surface:** CORE/dependency validation (proposed; inspect existing seams before editing).

**Acceptance:** A cycle and ambiguous binding fail; a reordered legal graph compiles and produces the same result.

**Out of this story:** No arbitrary expressions or confidence scoring. Stop when the stated outcome and its required review/verification pass; do not absorb the rest of the parent track.

## F04 — Turn material uncertainty into stable Needs

<a id="f04-1-a"></a>

### F04.1.a — Emit one scoped Need

**Problem statement:** Given one missing required fact and a declared evidence requirement, produce need containing stable key, scope, expected type and affected result.

**Parent:** [F04.1](2026-10-01-pathway-language-level-2-refined-slices.md#f04-1). **Stage A trace:** B-04, B-26, B-28; C-01.

**Start prerequisites:** [F03.1.b](2026-10-01-pathway-language-level-3-story-spec.md#f03-1-b).

**Integration/acceptance gates:** [F03.2.b](2026-10-01-pathway-language-level-3-story-spec.md#f03-2-b). **Readiness:** E.

**High-level work:** Implement the approved canonical key inputs and source link.

**Expected touch surface:** CORE/needs (proposed; inspect existing seams before editing).

**Acceptance:** Equivalent reevaluations share the key; changed requirement or episode gets a different key.

**Out of this story:** No arbitrary string concatenation contract or automatic retry. Stop when the stated outcome and its required review/verification pass; do not absorb the rest of the parent track.

<a id="f04-1-b"></a>

### F04.1.b — Deduplicate shared requirements

**Problem statement:** Given two recommendations reading the same unmet requirement, produce one Need with both affected output references and reasons.

**Parent:** [F04.1](2026-10-01-pathway-language-level-2-refined-slices.md#f04-1). **Stage A trace:** B-04, B-26, B-28; C-01.

**Start prerequisites:** [F04.1.a](2026-10-01-pathway-language-level-3-story-spec.md#f04-1-a).

**Integration/acceptance gates:** No additional story-specific gates; inherited gates and profile/scenario requirements still apply. **Readiness:** E.

**High-level work:** Combine only identical requirement identities; preserve per-result links.

**Expected touch surface:** CORE/need aggregation (proposed; inspect existing seams before editing).

**Acceptance:** Repeated/shared reads do not duplicate Needs; distinct scopes remain distinct.

**Out of this story:** No arbitrary string concatenation contract or automatic retry. Stop when the stated outcome and its required review/verification pass; do not absorb the rest of the parent track.

<a id="f04-2-a"></a>

### F04.2.a — Separate material and immaterial unknowns

**Problem statement:** Given false AND Unknown and otherwise-identical True AND Unknown fixtures, produce trace-only unknown in the first; blocking Need in the second.

**Parent:** [F04.2](2026-10-01-pathway-language-level-2-refined-slices.md#f04-2). **Stage A trace:** B-04, B-26, B-28; C-01.

**Start prerequisites:** [F04.1.a](2026-10-01-pathway-language-level-3-story-spec.md#f04-1-a), [F03.2.a](2026-10-01-pathway-language-level-3-story-spec.md#f03-2-a).

**Integration/acceptance gates:** No additional story-specific gates; inherited gates and profile/scenario requirements still apply. **Readiness:** E.

**High-level work:** Implement reducer-aware materiality propagation for supported boolean operations.

**Expected touch surface:** CORE/materiality (proposed; inspect existing seams before editing).

**Acceptance:** The false branch retains the unknown reason without an unnecessary blocker; the true branch emits the required Need.

**Out of this story:** No claim of completed whole-scope readiness before all required obligations settle. Stop when the stated outcome and its required review/verification pass; do not absorb the rest of the parent track.

<a id="f04-2-b"></a>

### F04.2.b — Preserve independent urgency and review needs

**Problem statement:** Given a known urgent finding and an unrelated unresolved requirement, produce visible urgent finding plus incomplete requested-scope readiness.

**Parent:** [F04.2](2026-10-01-pathway-language-level-2-refined-slices.md#f04-2). **Stage A trace:** B-04, B-26, B-28; C-01.

**Start prerequisites:** [F04.2.a](2026-10-01-pathway-language-level-3-story-spec.md#f04-2-a).

**Integration/acceptance gates:** No additional story-specific gates; inherited gates and profile/scenario requirements still apply. **Readiness:** E.

**High-level work:** Attach declared independent findings/review obligations outside ordinary eligibility suppression.

**Expected touch surface:** CORE/findings and readiness (proposed; inspect existing seams before editing).

**Acceptance:** Unrelated uncertainty cannot erase urgency; a required independent review remains even where clinical unknown is immaterial.

**Out of this story:** No claim of completed whole-scope readiness before all required obligations settle. Stop when the stated outcome and its required review/verification pass; do not absorb the rest of the parent track.

## F05 — Fulfill a Need and reevaluate a new revision

<a id="f05-1-a"></a>

### F05.1.a — Accept a valid provider attestation

**Problem statement:** Given a boolean Need and an authorized same-scope attestation, produce accepted observation with provenance and fulfillment link.

**Parent:** [F05.1](2026-10-01-pathway-language-level-2-refined-slices.md#f05-1). **Stage A trace:** B-15, B-26; C-01; Stage D later.

**Start prerequisites:** [F04.1.a](2026-10-01-pathway-language-level-3-story-spec.md#f04-1-a).

**Integration/acceptance gates:** [F04.2.a](2026-10-01-pathway-language-level-3-story-spec.md#f04-2-a), [F04.1.b](2026-10-01-pathway-language-level-3-story-spec.md#f04-1-b). **Readiness:** E.

**High-level work:** Implement the fulfilled_by contract for this one response type; trust actor identity only from the boundary.

**Expected touch surface:** CORE/fulfillment (proposed; inspect existing seams before editing).

**Acceptance:** Correct response is accepted; acceptance records origin and does not itself assert plan completion.

**Out of this story:** No clinical truth manufactured from response receipt. Stop when the stated outcome and its required review/verification pass; do not absorb the rest of the parent track.

<a id="f05-1-b"></a>

### F05.1.b — Reject mismatched fulfillment and duplicate effects

**Problem statement:** Given wrong-type/wrong-subject response or duplicate accepted event ID, produce rejected fulfillment or idempotent same evidence result.

**Parent:** [F05.1](2026-10-01-pathway-language-level-2-refined-slices.md#f05-1). **Stage A trace:** B-15, B-26; C-01; Stage D later.

**Start prerequisites:** [F05.1.a](2026-10-01-pathway-language-level-3-story-spec.md#f05-1-a).

**Integration/acceptance gates:** No additional story-specific gates; inherited gates and profile/scenario requirements still apply. **Readiness:** E.

**High-level work:** Add contract mismatch diagnostics and event-identity checks.

**Expected touch surface:** CORE/fulfillment validation (proposed; inspect existing seams before editing).

**Acceptance:** Wrong-scope evidence cannot close the Need; replaying one response does not create another observation.

**Out of this story:** No clinical truth manufactured from response receipt. Stop when the stated outcome and its required review/verification pass; do not absorb the rest of the parent track.

<a id="f05-2-a"></a>

### F05.2.a — Record response and evaluate revision n+1

**Problem statement:** Given a session at revision n and an accepted controlled-provider event, produce revision n+1 with the recomputed decision, Need state and history.

**Parent:** [F05.2](2026-10-01-pathway-language-level-2-refined-slices.md#f05-2). **Stage A trace:** B-15, B-26; C-01; Stage D later.

**Start prerequisites:** [F05.1.b](2026-10-01-pathway-language-level-3-story-spec.md#f05-1-b).

**Integration/acceptance gates:** [F03.2.b](2026-10-01-pathway-language-level-3-story-spec.md#f03-2-b). **Readiness:** E.

**High-level work:** Add one adapter path into versioned session persistence and use optimistic revision checks.

**Expected touch surface:** APP/session application boundary (proposed; inspect existing seams before editing).

**Acceptance:** Event creates one new revision; wrong session revision cannot overwrite current evidence; old evaluation remains inspectable.

**Out of this story:** No external EHR calls, broad UI redesign or endless retry. Stop when the stated outcome and its required review/verification pass; do not absorb the rest of the parent track.

<a id="f05-2-b"></a>

### F05.2.b — Bound attempts across reevaluation

**Problem statement:** Given a controlled fulfiller returning unavailable/refused responses and a bounded attempt policy, produce persistent attempt outcomes and eventual explicit exhaustion.

**Parent:** [F05.2](2026-10-01-pathway-language-level-2-refined-slices.md#f05-2). **Stage A trace:** B-15, B-26; C-01; Stage D later.

**Start prerequisites:** [F05.2.a](2026-10-01-pathway-language-level-3-story-spec.md#f05-2-a).

**Integration/acceptance gates:** No additional story-specific gates; inherited gates and profile/scenario requirements still apply. **Readiness:** E.

**High-level work:** Implement idempotent dispatch identity and attempt/deadline state outside the core; use an injected clock.

**Expected touch surface:** APP/acquisition coordinator (proposed; inspect existing seams before editing).

**Acceptance:** Duplicate dispatch has one effect; refusal/exhaustion survives reevaluation; no acquisition resets simply because evaluation reruns.

**Out of this story:** No external EHR calls, broad UI redesign or endless retry. Stop when the stated outcome and its required review/verification pass; do not absorb the rest of the parent track.

## F06 — Pin results and invalidate stale review

<a id="f06-1-a"></a>

### F06.1.a — Fingerprint a frozen bundle

**Problem statement:** Given equivalent canonical source/IR/evidence/clock/scope bundles, produce stable semantic identity; material input changes alter identity.

**Parent:** [F06.1](2026-10-01-pathway-language-level-2-refined-slices.md#f06-1). **Stage A trace:** B-22, B-23, B-24; C-01, C-02, C-03.

**Start prerequisites:** [F02.1.b](2026-10-01-pathway-language-level-3-story-spec.md#f02-1-b).

**Integration/acceptance gates:** [F01.2.b](2026-10-01-pathway-language-level-3-story-spec.md#f01-2-b). **Readiness:** E.

**High-level work:** Specify deterministic serialization for current supported fields and keep operational logs excluded.

**Expected touch surface:** CORE/canonical bundle identity (proposed; inspect existing seams before editing).

**Acceptance:** Permutation of unordered inputs preserves digest; changed fact, clock or requested scope changes it.

**Out of this story:** No incremental evaluator or remote artifact service. Stop when the stated outcome and its required review/verification pass; do not absorb the rest of the parent track.

<a id="f06-1-b"></a>

### F06.1.b — Replay retained supported artifacts

**Problem statement:** Given a retained bundle and a missing/tampered dependency variant, produce original result/trace or explicit replay failure.

**Parent:** [F06.1](2026-10-01-pathway-language-level-2-refined-slices.md#f06-1). **Stage A trace:** B-22, B-23, B-24; C-01, C-02, C-03.

**Start prerequisites:** [F06.1.a](2026-10-01-pathway-language-level-3-story-spec.md#f06-1-a), [F02.2.a](2026-10-01-pathway-language-level-3-story-spec.md#f02-2-a).

**Integration/acceptance gates:** No additional story-specific gates; inherited gates and profile/scenario requirements still apply. **Readiness:** E.

**High-level work:** Implement a small artifact repository interface with local test storage and verified load.

**Expected touch surface:** CORE/replay plus APP/test artifact store (proposed; inspect existing seams before editing).

**Acceptance:** Original result reproduces exactly under its clock; missing content or mismatched digest cannot return an empty ready plan.

**Out of this story:** No incremental evaluator or remote artifact service. Stop when the stated outcome and its required review/verification pass; do not absorb the rest of the parent track.

<a id="f06-2-a"></a>

### F06.2.a — Bind a review to one result revision

**Problem statement:** Given authorized review input and a canonical result/scope identity, produce review record tied to that revision and actor.

**Parent:** [F06.2](2026-10-01-pathway-language-level-2-refined-slices.md#f06-2). **Stage A trace:** B-22, B-23, B-24; C-01, C-02, C-03.

**Start prerequisites:** [F06.1.b](2026-10-01-pathway-language-level-3-story-spec.md#f06-1-b), [F05.2.a](2026-10-01-pathway-language-level-3-story-spec.md#f05-2-a).

**Integration/acceptance gates:** No additional story-specific gates; inherited gates and profile/scenario requirements still apply. **Readiness:** E.

**High-level work:** Persist review identity through the session API; do not let callers choose another institution context.

**Expected touch surface:** APP/review boundary (proposed; inspect existing seams before editing).

**Acceptance:** Correct-scope review is recorded; wrong actor/scope/revision is rejected.

**Out of this story:** No consent inference from clicking a generic acknowledgement. Stop when the stated outcome and its required review/verification pass; do not absorb the rest of the parent track.

<a id="f06-2-b"></a>

### F06.2.b — Invalidate review on material change

**Problem statement:** Given reviewed revision followed by corrected evidence or changed requested scope, produce review-required state with a source-linked change explanation.

**Parent:** [F06.2](2026-10-01-pathway-language-level-2-refined-slices.md#f06-2). **Stage A trace:** B-22, B-23, B-24; C-01, C-02, C-03.

**Start prerequisites:** [F06.2.a](2026-10-01-pathway-language-level-3-story-spec.md#f06-2-a), [F03.1.b](2026-10-01-pathway-language-level-3-story-spec.md#f03-1-b).

**Integration/acceptance gates:** No additional story-specific gates; inherited gates and profile/scenario requirements still apply. **Readiness:** E.

**High-level work:** Compare approved material identities; reuse the same evaluation path.

**Expected touch surface:** APP/review invalidation (proposed; inspect existing seams before editing).

**Acceptance:** Changed clinical input blocks reuse; identical frozen reevaluation does not invent a new clinical change.

**Out of this story:** No consent inference from clicking a generic acknowledgement. Stop when the stated outcome and its required review/verification pass; do not absorb the rest of the parent track.

## F07 — Finalize one reviewed scope without duplicate effects

<a id="f07-1-a"></a>

### F07.1.a — Reject unready or unauthorized finalization

**Problem statement:** Given reviewed/unreviewed and complete/incomplete scope requests against a test application store, produce a ready-to-commit authorization or explicit rejection without writes.

**Parent:** [F07.1](2026-10-01-pathway-language-level-2-refined-slices.md#f07-1). **Stage A trace:** B-23, B-24, B-28 contracts; C-02, C-03 application evidence.

**Start prerequisites:** [F06.2.a](2026-10-01-pathway-language-level-3-story-spec.md#f06-2-a), [F04.2.a](2026-10-01-pathway-language-level-3-story-spec.md#f04-2-a).

**Integration/acceptance gates:** [F06.2.b](2026-10-01-pathway-language-level-3-story-spec.md#f06-2-b), [A01.1.b](2026-10-01-pathway-language-level-3-story-spec.md#a01-1-b). **Readiness:** E.

**High-level work:** Create the narrow finalization validator over pinned input/review identity; include nonclinical mode checks and reject clinical requests until the separate publication/approval contracts are implemented.

**Expected touch surface:** APP/finalization validation (proposed; inspect existing seams before editing).

**Acceptance:** Unresolved required Need, mismatched scope or synthetic clinical request rejects; known findings remain queryable.

**Out of this story:** No silently dropping unresolved actions or bypassing publication. Stop when the stated outcome and its required review/verification pass; do not absorb the rest of the parent track.

<a id="f07-1-b"></a>

### F07.1.b — Commit one guidance result atomically

**Problem statement:** Given an eligible test-session result that passed validation, produce one materialized sandbox plan and matching completion record in one transaction.

**Parent:** [F07.1](2026-10-01-pathway-language-level-2-refined-slices.md#f07-1). **Stage A trace:** B-23, B-24, B-28 contracts; C-02, C-03 application evidence.

**Start prerequisites:** [F07.1.a](2026-10-01-pathway-language-level-3-story-spec.md#f07-1-a).

**Integration/acceptance gates:** No additional story-specific gates; inherited gates and profile/scenario requirements still apply. **Readiness:** E.

**High-level work:** Add the minimal new-system persistence schema/migration and transaction for supported guidance; test store failure rollback.

**Expected touch surface:** APP/persistence and database integration (proposed; inspect existing seams before editing).

**Acceptance:** Both plan and completion commit or neither does; injected write failure leaves no partial materialization.

**Out of this story:** No silently dropping unresolved actions or bypassing publication. Stop when the stated outcome and its required review/verification pass; do not absorb the rest of the parent track.

<a id="f07-2-a"></a>

### F07.2.a — Return one result for repeated submission

**Problem statement:** Given repeated same-idempotency-key request against the database fixture, produce the existing committed plan with no second materialization.

**Parent:** [F07.2](2026-10-01-pathway-language-level-2-refined-slices.md#f07-2). **Stage A trace:** B-23, B-24, B-28 contracts; C-02, C-03 application evidence.

**Start prerequisites:** [F07.1.b](2026-10-01-pathway-language-level-3-story-spec.md#f07-1-b).

**Integration/acceptance gates:** No additional story-specific gates; inherited gates and profile/scenario requirements still apply. **Readiness:** E.

**High-level work:** Bind idempotency to actor/scope/request identity and reject inconsistent key reuse.

**Expected touch surface:** APP/idempotency (proposed; inspect existing seams before editing).

**Acceptance:** Two repeated identical requests produce one plan; same key with a different payload is rejected.

**Out of this story:** No real clinical order side effects or distributed transaction platform. Stop when the stated outcome and its required review/verification pass; do not absorb the rest of the parent track.

<a id="f07-2-b"></a>

### F07.2.b — Reject stale and concurrent revisions

**Problem statement:** Given two racing reviewed submissions and an intervening evidence update, produce at most one valid commit, with stale/conflicting request explicitly rejected.

**Parent:** [F07.2](2026-10-01-pathway-language-level-2-refined-slices.md#f07-2). **Stage A trace:** B-23, B-24, B-28 contracts; C-02, C-03 application evidence.

**Start prerequisites:** [F07.2.a](2026-10-01-pathway-language-level-3-story-spec.md#f07-2-a), [F06.2.b](2026-10-01-pathway-language-level-3-story-spec.md#f06-2-b).

**Integration/acceptance gates:** No additional story-specific gates; inherited gates and profile/scenario requirements still apply. **Readiness:** E.

**High-level work:** Run barrier-controlled integration cases over real isolated persistence.

**Expected touch surface:** APP/concurrency tests and transaction guards (proposed; inspect existing seams before editing).

**Acceptance:** Concurrent requests never mix revision evidence or create duplicate plans; changed scope/evidence invalidates the stale transaction.

**Out of this story:** No real clinical order side effects or distributed transaction platform. Stop when the stated outcome and its required review/verification pass; do not absorb the rest of the parent track.

## A01 — Make incomplete authoring and policy visible

<a id="a01-1-a"></a>

### A01.1.a — Propagate a well-typed hole

**Problem statement:** Given one boolean draft hole used by the literal/expression fixture, produce typed incomplete-authoring result and source diagnostic.

**Parent:** [A01.1](2026-10-01-pathway-language-level-2-refined-slices.md#a01-1). **Stage A trace:** B-02, B-14, B-18, B-24; C-03.

**Start prerequisites:** [F02.2.a](2026-10-01-pathway-language-level-3-story-spec.md#f02-2-a).

**Integration/acceptance gates:** [F03.2.a](2026-10-01-pathway-language-level-3-story-spec.md#f03-2-a), [F04.1.a](2026-10-01-pathway-language-level-3-story-spec.md#f04-1-a). **Readiness:** E.

**High-level work:** Add the smallest hole node and preview artifact mode; retain unaffected outputs.

**Expected touch surface:** CORE/preview (proposed; inspect existing seams before editing).

**Acceptance:** Dependent preview shows a typed hole; a wrong-type hole rejects; integrated acceptance must distinguish the marker from patient Unknown and must not emit a patient Need for the hole.

**Out of this story:** No substituting patient Unknown for authoring incompleteness. Stop when the stated outcome and its required review/verification pass; do not absorb the rest of the parent track.

<a id="a01-1-b"></a>

### A01.1.b — Reject promotion of incomplete preview

**Problem statement:** Given a preview artifact with a hole on an unvisited branch, produce publication and clinical execution rejection.

**Parent:** [A01.1](2026-10-01-pathway-language-level-2-refined-slices.md#a01-1). **Stage A trace:** B-02, B-14, B-18, B-24; C-03.

**Start prerequisites:** [A01.1.a](2026-10-01-pathway-language-level-3-story-spec.md#a01-1-a), [F02.1.b](2026-10-01-pathway-language-level-3-story-spec.md#f02-1-b).

**Integration/acceptance gates:** No additional story-specific gates; inherited gates and profile/scenario requirements still apply. **Readiness:** E.

**High-level work:** Enforce whole-package completeness and trusted execution mode at publication/load boundaries.

**Expected touch surface:** APP/publication and CORE/loader (proposed; inspect existing seams before editing).

**Acceptance:** Unvisited hole still blocks publication; relabeling preview/synthetic context cannot authorize clinical finalization.

**Out of this story:** No substituting patient Unknown for authoring incompleteness. Stop when the stated outcome and its required review/verification pass; do not absorb the rest of the parent track.

<a id="a01-2-a"></a>

### A01.2.a — Track reviewed rationale independently of behavior

**Problem statement:** Given a package whose citation/rationale changes without changing executable output, produce changed reviewed artifact identity and required content review.

**Parent:** [A01.2](2026-10-01-pathway-language-level-2-refined-slices.md#a01-2). **Stage A trace:** B-02, B-14, B-18, B-24; C-03.

**Start prerequisites:** [A01.1.b](2026-10-01-pathway-language-level-3-story-spec.md#a01-1-b), [F06.1.a](2026-10-01-pathway-language-level-3-story-spec.md#f06-1-a).

**Integration/acceptance gates:** [F06.2.b](2026-10-01-pathway-language-level-3-story-spec.md#f06-2-b). **Readiness:** E.

**High-level work:** Store declaration rationale and bind it to content review identity separately from semantic result digest.

**Expected touch surface:** CORE/source metadata and APP/review (proposed; inspect existing seams before editing).

**Acceptance:** Executable hash may stay fixed; prior content approval cannot silently cover the changed rationale.

**Out of this story:** No policy scripting or full approval-management UI. Stop when the stated outcome and its required review/verification pass; do not absorb the rest of the parent track.

<a id="a01-2-b"></a>

### A01.2.b — Resolve one bounded policy artifact

**Problem statement:** Given authenticated institutional policy with one scalar bound, mandatory check and permission set, produce effective policy with provenance or explicit composition error.

**Parent:** [A01.2](2026-10-01-pathway-language-level-2-refined-slices.md#a01-2). **Stage A trace:** B-02, B-14, B-18, B-24; C-03.

**Start prerequisites:** [F01.1.a](2026-10-01-pathway-language-level-3-story-spec.md#f01-1-a), [F06.1.a](2026-10-01-pathway-language-level-3-story-spec.md#f06-1-a).

**Integration/acceptance gates:** [A01.1.b](2026-10-01-pathway-language-level-3-story-spec.md#a01-1-b). **Readiness:** E.

**High-level work:** Implement typed specialization rules and authenticated config binding; register approved artifact in a test store.

**Expected touch surface:** APP/policy binding and CORE/policy validation (proposed; inspect existing seams before editing).

**Acceptance:** Out-of-bound specialization fails; required check survives lower-tier omission; permissions cannot widen.

**Out of this story:** No policy scripting or full approval-management UI. Stop when the stated outcome and its required review/verification pass; do not absorb the rest of the parent track.

## M01 — Initiate one reviewed medication through choice and safety

<a id="m01-1-a"></a>

### M01.1.a — Represent one fixed medication proposal

**Problem statement:** Given one adjudicated medication identity/formulation/route/dose in authored source, produce typed action payload preserved through IR and explanation.

**Parent:** [M01.1](2026-10-01-pathway-language-level-2-refined-slices.md#m01-1). **Stage A trace:** B-05, B-16, B-17, B-18, B-23; C-02.

**Start prerequisites:** [F02.2.a](2026-10-01-pathway-language-level-3-story-spec.md#f02-2-a).

**Integration/acceptance gates:** [A01.2.b](2026-10-01-pathway-language-level-3-story-spec.md#a01-2-b), [F01.1.b](2026-10-01-pathway-language-level-3-story-spec.md#f01-1-b). **Readiness:** C2.

**High-level work:** Support the exact reviewed payload contract and bounded decimal representation; reject absent required fields.

**Expected touch surface:** CORE/action payload (proposed; inspect existing seams before editing).

**Acceptance:** Action identity survives round-trip; incompatible dose units or missing formulation required by the contract fail.

**Out of this story:** No knowledge-base integration or dose calculation. Stop when the stated outcome and its required review/verification pass; do not absorb the rest of the parent track.

<a id="m01-1-b"></a>

### M01.1.b — Apply clear versus incomplete allergy coverage

**Problem statement:** Given a medication proposal and recorded clear/unavailable/unmapped allergy assessment, produce clear safety or unresolved safety with whole-scope finalization blocked as required.

**Parent:** [M01.1](2026-10-01-pathway-language-level-2-refined-slices.md#m01-1). **Stage A trace:** B-05, B-16, B-17, B-18, B-23; C-02.

**Start prerequisites:** [M01.1.a](2026-10-01-pathway-language-level-3-story-spec.md#m01-1-a).

**Integration/acceptance gates:** No additional story-specific gates; inherited gates and profile/scenario requirements still apply. **Readiness:** C2.

**High-level work:** Implement the allergy assessment result contract without a live lookup; include coverage identity in trace.

**Expected touch surface:** CORE/safety assessment (proposed; inspect existing seams before editing).

**Acceptance:** Unmapped allergy is not clear; complete scoped negative is traceable; incomplete scope cannot finalize.

**Out of this story:** No knowledge-base integration or dose calculation. Stop when the stated outcome and its required review/verification pass; do not absorb the rest of the parent track.

<a id="m01-2-a"></a>

### M01.2.a — Withhold for an established required safety finding

**Problem statement:** Given a known relevant allergy finding on an eligible candidate, produce withheld disposition retaining the indication and finding.

**Parent:** [M01.2](2026-10-01-pathway-language-level-2-refined-slices.md#m01-2). **Stage A trace:** B-05, B-16, B-17, B-18, B-23; C-02.

**Start prerequisites:** [M01.1.b](2026-10-01-pathway-language-level-3-story-spec.md#m01-1-b).

**Integration/acceptance gates:** No additional story-specific gates; inherited gates and profile/scenario requirements still apply. **Readiness:** C2.

**High-level work:** Apply approved hold severity semantics and preserve required evidence references.

**Expected touch surface:** CORE/safety reducer (proposed; inspect existing seams before editing).

**Acceptance:** Known exclusion/hold stays visible even with unrelated unknown; acknowledgement alone cannot clear it.

**Out of this story:** No inferred safety from a medication name or missing chart rows. Stop when the stated outcome and its required review/verification pass; do not absorb the rest of the parent track.

<a id="m01-2-b"></a>

### M01.2.b — Require scoped interaction assessment

**Problem statement:** Given candidate plus current-therapy universe and clear/finding/unavailable interaction results, produce correct required interaction safety result for that universe.

**Parent:** [M01.2](2026-10-01-pathway-language-level-2-refined-slices.md#m01-2). **Stage A trace:** B-05, B-16, B-17, B-18, B-23; C-02.

**Start prerequisites:** [M01.1.b](2026-10-01-pathway-language-level-3-story-spec.md#m01-1-b).

**Integration/acceptance gates:** No additional story-specific gates; inherited gates and profile/scenario requirements still apply. **Readiness:** C2.

**High-level work:** Add typed interaction knowledge-version and coverage inputs; no external lookup in core.

**Expected touch surface:** CORE/interaction contract (proposed; inspect existing seams before editing).

**Acceptance:** An unavailable knowledge source or incomplete current-therapy coverage is unresolved; known finding is preserved.

**Out of this story:** No inferred safety from a medication name or missing chart rows. Stop when the stated outcome and its required review/verification pass; do not absorb the rest of the parent track.

<a id="m01-3-a"></a>

### M01.3.a — Select exactly one of two medication candidates

**Problem statement:** Given reviewed A/B candidates with none/one/multiple selections, produce choice Need, one selection, or cardinality rejection respectively.

**Parent:** [M01.3](2026-10-01-pathway-language-level-2-refined-slices.md#m01-3). **Stage A trace:** B-05, B-16, B-17, B-18, B-23; C-02.

**Start prerequisites:** [M01.1.a](2026-10-01-pathway-language-level-3-story-spec.md#m01-1-a), [F04.1.a](2026-10-01-pathway-language-level-3-story-spec.md#f04-1-a).

**Integration/acceptance gates:** No additional story-specific gates; inherited gates and profile/scenario requirements still apply. **Readiness:** C2.

**High-level work:** Compile the supported one_of and selection ports through normal IR.

**Expected touch surface:** CORE/choice (proposed; inspect existing seams before editing).

**Acceptance:** No selection yields Need; selecting ineligible candidate rejects; valid single selection does not erase the other candidate trace.

**Out of this story:** No bundle choices or automatically selected alternative. Stop when the stated outcome and its required review/verification pass; do not absorb the rest of the parent track.

<a id="m01-3-b"></a>

### M01.3.b — Distinguish refusal from consent and ineligibility

**Problem statement:** Given recorded refusal or selected action lacking required consent, produce preserved clinical eligibility and explicit outstanding obligations with no unauthorized initiation.

**Parent:** [M01.3](2026-10-01-pathway-language-level-2-refined-slices.md#m01-3). **Stage A trace:** B-05, B-16, B-17, B-18, B-23; C-02.

**Start prerequisites:** [M01.3.a](2026-10-01-pathway-language-level-3-story-spec.md#m01-3-a), [F05.1.b](2026-10-01-pathway-language-level-3-story-spec.md#f05-1-b).

**Integration/acceptance gates:** No additional story-specific gates; inherited gates and profile/scenario requirements still apply. **Readiness:** C2.

**High-level work:** Implement scoped refusal/consent evidence validation under the clinical contract.

**Expected touch surface:** CORE/consent and APP/recorded inputs (proposed; inspect existing seams before editing).

**Acceptance:** Refusal is not Unknown/no-response; it never satisfies consent or silently selects B; valid consent satisfies only its own requirement.

**Out of this story:** No bundle choices or automatically selected alternative. Stop when the stated outcome and its required review/verification pass; do not absorb the rest of the parent track.

<a id="m01-4-a"></a>

### M01.4.a — Do not reselect after a safety hold

**Problem statement:** Given selected A gains a hold while B remains eligible, produce a withheld, B unselected, explicit decision Need.

**Parent:** [M01.4](2026-10-01-pathway-language-level-2-refined-slices.md#m01-4). **Stage A trace:** B-05, B-16, B-17, B-18, B-23; C-02.

**Start prerequisites:** [M01.3.a](2026-10-01-pathway-language-level-3-story-spec.md#m01-3-a), [M01.2.a](2026-10-01-pathway-language-level-3-story-spec.md#m01-2-a), [M01.2.b](2026-10-01-pathway-language-level-3-story-spec.md#m01-2-b).

**Integration/acceptance gates:** No additional story-specific gates; inherited gates and profile/scenario requirements still apply. **Readiness:** C2.

**High-level work:** Connect final safety disposition to choice obligations without feedback execution.

**Expected touch surface:** CORE/choice-safety composition (proposed; inspect existing seams before editing).

**Acceptance:** B never becomes selected by evaluation; authorized later selection creates a new input/review cycle.

**Out of this story:** No automatic switch or second finalization mechanism. Stop when the stated outcome and its required review/verification pass; do not absorb the rest of the parent track.

<a id="m01-4-b"></a>

### M01.4.b — Run medication review through sandbox finalization

**Problem statement:** Given c-02 authored A/B package with clear and subsequently changed evidence, produce one reviewed sandbox initiation or stale-review/safety rejection.

**Parent:** [M01.4](2026-10-01-pathway-language-level-2-refined-slices.md#m01-4). **Stage A trace:** B-05, B-16, B-17, B-18, B-23; C-02.

**Start prerequisites:** [M01.4.a](2026-10-01-pathway-language-level-3-story-spec.md#m01-4-a), [M01.3.b](2026-10-01-pathway-language-level-3-story-spec.md#m01-3-b), [F07.2.b](2026-10-01-pathway-language-level-3-story-spec.md#f07-2-b), [F06.2.b](2026-10-01-pathway-language-level-3-story-spec.md#f06-2-b), [A01.2.b](2026-10-01-pathway-language-level-3-story-spec.md#a01-2-b).

**Integration/acceptance gates:** [U01.2.b](2026-10-01-pathway-language-level-3-story-spec.md#u01-2-b), [V01.1.b](2026-10-01-pathway-language-level-3-story-spec.md#v01-1-b), [A01.1.b](2026-10-01-pathway-language-level-3-story-spec.md#a01-1-b). **Readiness:** C2.

**High-level work:** Reuse F07 transaction path; carry full medication payload, scope and review IDs; own the full C-02 packet through the minimal authoring view once its acceptance gates pass, retaining independent clinical expectations.

**Expected touch surface:** APP/C-02 integration (proposed; inspect existing seams before editing).

**Acceptance:** Clear selected action commits once in test mode; changed safety blocks old review and leaves no partial scope write.

**Out of this story:** No automatic switch or second finalization mechanism. Stop when the stated outcome and its required review/verification pass; do not absorb the rest of the parent track.

## T01 — Use explicit time for one follow-up

<a id="t01-1-a"></a>

### T01.1.a — Evaluate one explicit fixed window

**Problem statement:** Given evaluation instant and one start/end interval from source, produce before/within/after result with inclusive boundary trace.

**Parent:** [T01.1](2026-10-01-pathway-language-level-2-refined-slices.md#t01-1). **Stage A trace:** B-06, B-10, B-12, B-13, B-19, B-20; C-01, E-01.

**Start prerequisites:** [F02.2.a](2026-10-01-pathway-language-level-3-story-spec.md#f02-2-a).

**Integration/acceptance gates:** [F06.1.b](2026-10-01-pathway-language-level-3-story-spec.md#f06-1-b). **Readiness:** E.

**High-level work:** Add supported instant parsing and duration comparison under a frozen clock.

**Expected touch surface:** CORE/time (proposed; inspect existing seams before editing).

**Acceptance:** Exact endpoints match contract; implicit wall-clock reads are absent; malformed/partial evidence stays explicit.

**Out of this story:** No fabricated precision for partial dates. Stop when the stated outcome and its required review/verification pass; do not absorb the rest of the parent track.

<a id="t01-1-b"></a>

### T01.1.b — Validate response expiry against the pinned clock

**Problem statement:** Given a scoped attestation and an authored validity interval, produce accepted or expired fulfillment under the evaluation revision.

**Parent:** [T01.1](2026-10-01-pathway-language-level-2-refined-slices.md#t01-1). **Stage A trace:** B-06, B-10, B-12, B-13, B-19, B-20; C-01, E-01.

**Start prerequisites:** [T01.1.a](2026-10-01-pathway-language-level-3-story-spec.md#t01-1-a), [F05.1.b](2026-10-01-pathway-language-level-3-story-spec.md#f05-1-b).

**Integration/acceptance gates:** No additional story-specific gates; inherited gates and profile/scenario requirements still apply. **Readiness:** E.

**High-level work:** Reuse the time predicate in F05 validation; do not mutate old responses.

**Expected touch surface:** CORE/temporal fulfillment (proposed; inspect existing seams before editing).

**Acceptance:** Boundary-valid response can fulfill; expired response cannot; old replay retains original clock result.

**Out of this story:** No fabricated precision for partial dates. Stop when the stated outcome and its required review/verification pass; do not absorb the rest of the parent track.

<a id="t01-2-a"></a>

### T01.2.a — Anchor a follow-up to actual completion

**Problem statement:** Given recorded completed course versus an order-only event, produce one completion-anchored instance or unresolved anchor.

**Parent:** [T01.2](2026-10-01-pathway-language-level-2-refined-slices.md#t01-2). **Stage A trace:** B-06, B-10, B-12, B-13, B-19, B-20; C-01, E-01.

**Start prerequisites:** [T01.1.a](2026-10-01-pathway-language-level-3-story-spec.md#t01-1-a), [F03.1.a](2026-10-01-pathway-language-level-3-story-spec.md#f03-1-a).

**Integration/acceptance gates:** No additional story-specific gates; inherited gates and profile/scenario requirements still apply. **Readiness:** E1.

**High-level work:** Bind same-subject/episode/course completion to the authored fixed follow-up rule.

**Expected touch surface:** CORE/follow-up anchors (proposed; inspect existing seams before editing).

**Acceptance:** Order alone cannot create completed anchor; wrong course rejects; valid completion creates source-linked deadline.

**Out of this story:** No repeated schedules or rescheduling implementation. Stop when the stated outcome and its required review/verification pass; do not absorb the rest of the parent track.

<a id="t01-2-b"></a>

### T01.2.b — Keep deadline fixed through new encounters

**Problem statement:** Given established instance with new encounter/clock revisions, produce not-yet-due/due/overdue state without a changed origin.

**Parent:** [T01.2](2026-10-01-pathway-language-level-2-refined-slices.md#t01-2). **Stage A trace:** B-06, B-10, B-12, B-13, B-19, B-20; C-01, E-01.

**Start prerequisites:** [T01.2.a](2026-10-01-pathway-language-level-3-story-spec.md#t01-2-a).

**Integration/acceptance gates:** No additional story-specific gates; inherited gates and profile/scenario requirements still apply. **Readiness:** E1.

**High-level work:** Derive progress from recorded instance and clock; retain cancellation/completion separately.

**Expected touch surface:** CORE/follow-up progress (proposed; inspect existing seams before editing).

**Acceptance:** Later encounter does not shift due date; completed/cancelled event changes progress only under its contract.

**Out of this story:** No repeated schedules or rescheduling implementation. Stop when the stated outcome and its required review/verification pass; do not absorb the rest of the parent track.

<a id="t01-3-a"></a>

### T01.3.a — Separate planning from performance

**Problem statement:** Given an action may be planned now but is due in a later window, produce eligible proposal with not-yet-due performance and explicit deadline.

**Parent:** [T01.3](2026-10-01-pathway-language-level-2-refined-slices.md#t01-3). **Stage A trace:** B-06, B-10, B-12, B-13, B-19, B-20; C-01, E-01.

**Start prerequisites:** [T01.2.b](2026-10-01-pathway-language-level-3-story-spec.md#t01-2-b), [F02.2.a](2026-10-01-pathway-language-level-3-story-spec.md#f02-2-a).

**Integration/acceptance gates:** [F07.1.a](2026-10-01-pathway-language-level-3-story-spec.md#f07-1-a). **Readiness:** C1.

**High-level work:** Add typed timing outputs without reusing disposition as a due flag.

**Expected touch surface:** CORE/action timing and APP/result contract (proposed; inspect existing seams before editing).

**Acceptance:** Advance proposal does not imply action performed; soft overdue does not suppress independently authored stop/reassessment.

**Out of this story:** No automatic EHR renewal or indefinite clinical permission. Stop when the stated outcome and its required review/verification pass; do not absorb the rest of the parent track.

<a id="t01-3-b"></a>

### T01.3.b — Separate external expiry from clinical stop

**Problem statement:** Given external order expiry and authored clinical reassessment predicates, produce distinct renewal/operational status and clinical readiness.

**Parent:** [T01.3](2026-10-01-pathway-language-level-2-refined-slices.md#t01-3). **Stage A trace:** B-06, B-10, B-12, B-13, B-19, B-20; C-01, E-01.

**Start prerequisites:** [T01.3.a](2026-10-01-pathway-language-level-3-story-spec.md#t01-3-a).

**Integration/acceptance gates:** No additional story-specific gates; inherited gates and profile/scenario requirements still apply. **Readiness:** C1.

**High-level work:** Map recorded external expiry into an adapter-facing field, preserving source contract.

**Expected touch surface:** APP/expiry mapping and CORE/readiness (proposed; inspect existing seams before editing).

**Acceptance:** Order expiry cannot silently change clinical eligibility; clinical stop prevents performance readiness despite a later external expiry.

**Out of this story:** No automatic EHR renewal or indefinite clinical permission. Stop when the stated outcome and its required review/verification pass; do not absorb the rest of the parent track.

<a id="t01-4-a"></a>

### T01.4.a — Use collection time and query freshness

**Problem statement:** Given one observation with different collection/receipt times and two query assessment contexts, produce different admissibility results with one preserved observation.

**Parent:** [T01.4](2026-10-01-pathway-language-level-2-refined-slices.md#t01-4). **Stage A trace:** B-06, B-10, B-12, B-13, B-19, B-20; C-01, E-01.

**Start prerequisites:** [T01.1.a](2026-10-01-pathway-language-level-3-story-spec.md#t01-1-a), [F03.1.a](2026-10-01-pathway-language-level-3-story-spec.md#f03-1-a).

**Integration/acceptance gates:** No additional story-specific gates; inherited gates and profile/scenario requirements still apply. **Readiness:** E1.

**High-level work:** Name timestamp role and freshness policy; retain unknown timing and rejected reason.

**Expected touch surface:** CORE/query admissibility (proposed; inspect existing seams before editing).

**Acceptance:** Receipt cannot replace collection; historical query can accept what current query excludes; no usable result stays unresolved.

**Out of this story:** No global expired flag or inferred negative result. Stop when the stated outcome and its required review/verification pass; do not absorb the rest of the parent track.

<a id="t01-4-b"></a>

### T01.4.b — Compose completion window with freshness

**Problem statement:** Given e-01 result has both completion-relative collection and present-freshness requirements, produce admissible only when both required timing predicates are established.

**Parent:** [T01.4](2026-10-01-pathway-language-level-2-refined-slices.md#t01-4). **Stage A trace:** B-06, B-10, B-12, B-13, B-19, B-20; C-01, E-01.

**Start prerequisites:** [T01.4.a](2026-10-01-pathway-language-level-3-story-spec.md#t01-4-a), [T01.2.a](2026-10-01-pathway-language-level-3-story-spec.md#t01-2-a), [F05.2.a](2026-10-01-pathway-language-level-3-story-spec.md#f05-2-a).

**Integration/acceptance gates:** No additional story-specific gates; inherited gates and profile/scenario requirements still apply. **Readiness:** E1.

**High-level work:** Apply independent anchors through existing boolean/evidence semantics and run one authored integration fixture.

**Expected touch surface:** CORE/E-01 evaluation plus APP/revision (proposed; inspect existing seams before editing).

**Acceptance:** Unknown anchor or stale result stays explicit; a reviewed unavailable contingency is distinct from clinical negative; corrected collection time produces a new revision.

**Out of this story:** No global expired flag or inferred negative result. Stop when the stated outcome and its required review/verification pass; do not absorb the rest of the parent track.

## O01 — Select comparable distinct observations

<a id="o01-1-a"></a>

### O01.1.a — Filter candidates by episode and measurement context

**Problem statement:** Given same-concept observations from different episodes/specimens/methods, produce candidate assessment set with scoped accepted/rejected reasons.

**Parent:** [O01.1](2026-10-01-pathway-language-level-2-refined-slices.md#o01-1). **Stage A trace:** B-05, B-09, B-11, B-12, B-13, B-15; E-01, E-02.

**Start prerequisites:** [F03.1.a](2026-10-01-pathway-language-level-3-story-spec.md#f03-1-a).

**Integration/acceptance gates:** No additional story-specific gates; inherited gates and profile/scenario requirements still apply. **Readiness:** E1.

**High-level work:** Implement declared identity/context predicates including optional culture/isolate link.

**Expected touch surface:** CORE/query identity (proposed; inspect existing seams before editing).

**Acceptance:** Wrong episode or isolate cannot satisfy query; missing required method stays unresolved rather than silently admissible.

**Out of this story:** No source precedence inferred from ingestion order. Stop when the stated outcome and its required review/verification pass; do not absorb the rest of the parent track.

<a id="o01-1-b"></a>

### O01.1.b — Select definite latest with corrections and ties

**Problem statement:** Given scoped candidates with corrected timestamp and equal-time competing values, produce definite winner or unresolved selection retaining candidates.

**Parent:** [O01.1](2026-10-01-pathway-language-level-2-refined-slices.md#o01-1). **Stage A trace:** B-05, B-09, B-11, B-12, B-13, B-15; E-01, E-02.

**Start prerequisites:** [O01.1.a](2026-10-01-pathway-language-level-3-story-spec.md#o01-1-a), [T01.1.a](2026-10-01-pathway-language-level-3-story-spec.md#t01-1-a), [F05.1.b](2026-10-01-pathway-language-level-3-story-spec.md#f05-1-b).

**Integration/acceptance gates:** No additional story-specific gates; inherited gates and profile/scenario requirements still apply. **Readiness:** E.

**High-level work:** Apply authorized correction history before time selection; declare identity ordering only for serialization.

**Expected touch surface:** CORE/evidence selection (proposed; inspect existing seams before editing).

**Acceptance:** Correction can change winner; equal-time conflicting candidates remain unresolved; input order does not decide.

**Out of this story:** No source precedence inferred from ingestion order. Stop when the stated outcome and its required review/verification pass; do not absorb the rest of the parent track.

<a id="o01-2-a"></a>

### O01.2.a — Normalize one approved quantity conversion

**Problem statement:** Given two observations in an approved equivalent unit pair and incompatible-unit/method variants, produce equivalent threshold decisions or explicit unsupported comparison.

**Parent:** [O01.2](2026-10-01-pathway-language-level-2-refined-slices.md#o01-2). **Stage A trace:** B-05, B-09, B-11, B-12, B-13, B-15; E-01, E-02.

**Start prerequisites:** [F03.1.a](2026-10-01-pathway-language-level-3-story-spec.md#f03-1-a).

**Integration/acceptance gates:** [F01.2.b](2026-10-01-pathway-language-level-3-story-spec.md#f01-2-b). **Readiness:** E2.

**High-level work:** Implement only reviewed whitelist conversions and decimal bounds; keep assay comparability separate.

**Expected touch surface:** CORE/quantities (proposed; inspect existing seams before editing).

**Acceptance:** Equivalent unit values compare identically; unsupported conversion or assay compatibility is unresolved with reason.

**Out of this story:** No inferencing that multiple duplicate rows establish persistence. Stop when the stated outcome and its required review/verification pass; do not absorb the rest of the parent track.

<a id="o01-2-b"></a>

### O01.2.b — Establish a separated observation pair

**Problem statement:** Given two identity-distinct qualifying readings under reviewed min/max separation, produce known pair-qualified predicate or explicit insufficient/unknown result.

**Parent:** [O01.2](2026-10-01-pathway-language-level-2-refined-slices.md#o01-2). **Stage A trace:** B-05, B-09, B-11, B-12, B-13, B-15; E-01, E-02.

**Start prerequisites:** [O01.1.b](2026-10-01-pathway-language-level-3-story-spec.md#o01-1-b), [O01.2.a](2026-10-01-pathway-language-level-3-story-spec.md#o01-2-a), [T01.1.a](2026-10-01-pathway-language-level-3-story-spec.md#t01-1-a).

**Integration/acceptance gates:** No additional story-specific gates; inherited gates and profile/scenario requirements still apply. **Readiness:** E2.

**High-level work:** Compile the bounded pairing contract and return selected evidence identities.

**Expected touch surface:** CORE/pair selection (proposed; inspect existing seams before editing).

**Acceptance:** Duplicate identity cannot count twice; exact interval boundaries and uncertain timestamps behave as reviewed; order permutation is invariant.

**Out of this story:** No inferencing that multiple duplicate rows establish persistence. Stop when the stated outcome and its required review/verification pass; do not absorb the rest of the parent track.

<a id="o01-3-a"></a>

### O01.3.a — Distinguish retrieval coverage from sampling sufficiency

**Problem statement:** Given complete/incomplete source snapshots with adequate/sparse required observations, produce scoped negatives only when justified, otherwise explicit insufficiency.

**Parent:** [O01.3](2026-10-01-pathway-language-level-2-refined-slices.md#o01-3). **Stage A trace:** B-05, B-09, B-11, B-12, B-13, B-15; E-01, E-02.

**Start prerequisites:** [O01.2.b](2026-10-01-pathway-language-level-3-story-spec.md#o01-2-b), [F03.1.b](2026-10-01-pathway-language-level-3-story-spec.md#f03-1-b).

**Integration/acceptance gates:** No additional story-specific gates; inherited gates and profile/scenario requirements still apply. **Readiness:** E.

**High-level work:** Implement supported presence/absence coverage and pair adequacy; no generic counts.

**Expected touch surface:** CORE/coverage and sufficiency (proposed; inspect existing seams before editing).

**Acceptance:** A complete sparse snapshot is still insufficient for pairing; one admissible positive may establish existence under incomplete coverage.

**Out of this story:** No generic provider override or synthetic clinical coverage. Stop when the stated outcome and its required review/verification pass; do not absorb the rest of the parent track.

<a id="o01-3-b"></a>

### O01.3.b — Apply permitted provider precedence and reject misuse

**Problem statement:** Given conflicting completion evidence and a permitted provider attestation/request, produce authorized attestation governs or request is rejected with chart evidence retained.

**Parent:** [O01.3](2026-10-01-pathway-language-level-2-refined-slices.md#o01-3). **Stage A trace:** B-05, B-09, B-11, B-12, B-13, B-15; E-01, E-02.

**Start prerequisites:** [O01.1.b](2026-10-01-pathway-language-level-3-story-spec.md#o01-1-b), [T01.1.b](2026-10-01-pathway-language-level-3-story-spec.md#t01-1-b), [F06.2.b](2026-10-01-pathway-language-level-3-story-spec.md#f06-2-b).

**Integration/acceptance gates:** [O01.3.a](2026-10-01-pathway-language-level-3-story-spec.md#o01-3-a). **Readiness:** E1.

**High-level work:** Apply declared strategy after scope/time/authority checks; use E-01 completion concept chosen by clinical reviewers.

**Expected touch surface:** CORE/precedence and APP/E-01 case (proposed; inspect existing seams before editing).

**Acceptance:** Valid same-course assertion can govern; expired/wrong-course/wrong-subject request cannot; changed result invalidates review.

**Out of this story:** No generic provider override or synthetic clinical coverage. Stop when the stated outcome and its required review/verification pass; do not absorb the rest of the parent track.

## G01 — Interpret measurements in an explicit pregnancy context

<a id="g01-1-a"></a>

### G01.1.a — Compute known-date day count

**Problem statement:** Given known reference date/day count and a target date in the same episode, produce exact derived day count and dating-source trace.

**Parent:** [G01.1](2026-10-01-pathway-language-level-2-refined-slices.md#g01-1). **Stage A trace:** B-07, B-08, B-09, B-13, B-22; E-02.

**Start prerequisites:** [T01.1.a](2026-10-01-pathway-language-level-3-story-spec.md#t01-1-a).

**Integration/acceptance gates:** No additional story-specific gates; inherited gates and profile/scenario requirements still apply. **Readiness:** E2.

**High-level work:** Implement the approved date basis and limits with independent boundary examples.

**Expected touch surface:** CORE/dating derivation (proposed; inspect existing seams before editing).

**Acceptance:** Day-before/at/after cases are exact; missing/partial reference remains unresolved; episode mismatch rejects.

**Out of this story:** No full calendar recurrence or implicit timezone conversion. Stop when the stated outcome and its required review/verification pass; do not absorb the rest of the parent track.

<a id="g01-1-b"></a>

### G01.1.b — Apply a dating correction without rewriting history

**Problem statement:** Given new authorized reference version for an existing frozen evaluation, produce new day count/current revision with old replay retained.

**Parent:** [G01.1](2026-10-01-pathway-language-level-2-refined-slices.md#g01-1). **Stage A trace:** B-07, B-08, B-09, B-13, B-22; E-02.

**Start prerequisites:** [G01.1.a](2026-10-01-pathway-language-level-3-story-spec.md#g01-1-a), [F06.2.b](2026-10-01-pathway-language-level-3-story-spec.md#f06-2-b).

**Integration/acceptance gates:** No additional story-specific gates; inherited gates and profile/scenario requirements still apply. **Readiness:** E2.

**High-level work:** Bind dating-reference version into evidence/result identity.

**Expected touch surface:** CORE/dating identity and APP/revision (proposed; inspect existing seams before editing).

**Acceptance:** Correction can cross a boundary in new result; replay of earlier bundle returns its earlier dating interpretation.

**Out of this story:** No full calendar recurrence or implicit timezone conversion. Stop when the stated outcome and its required review/verification pass; do not absorb the rest of the parent track.

<a id="g01-2-a"></a>

### G01.2.a — Resolve one versioned interval lookup

**Problem statement:** Given a reviewed nonoverlapping table and a typed day-count key, produce one entry plus table provenance or explicit unresolved/invalid lookup.

**Parent:** [G01.2](2026-10-01-pathway-language-level-2-refined-slices.md#g01-2). **Stage A trace:** B-07, B-08, B-09, B-13, B-22; E-02.

**Start prerequisites:** [G01.1.a](2026-10-01-pathway-language-level-3-story-spec.md#g01-1-a).

**Integration/acceptance gates:** No additional story-specific gates; inherited gates and profile/scenario requirements still apply. **Readiness:** E2.

**High-level work:** Validate coverage/overlap rules and lookup boundary conventions.

**Expected touch surface:** CORE/context lookup (proposed; inspect existing seams before editing).

**Acceptance:** Exact boundaries match approved entries; invalid overlapping table rejects; outside declared coverage stays explicit.

**Out of this story:** No unreviewed table values or forced clinical dependency for a demo. Stop when the stated outcome and its required review/verification pass; do not absorb the rest of the parent track.

<a id="g01-2-b"></a>

### G01.2.b — Run E-02 with collection and assessment context

**Problem statement:** Given authored separated-reading slice and corrected/uncorrected pregnancy evidence, produce expected interpreted pair/classification with context-time trace.

**Parent:** [G01.2](2026-10-01-pathway-language-level-2-refined-slices.md#g01-2). **Stage A trace:** B-07, B-08, B-09, B-13, B-22; E-02.

**Start prerequisites:** [G01.2.a](2026-10-01-pathway-language-level-3-story-spec.md#g01-2-a), [G01.1.b](2026-10-01-pathway-language-level-3-story-spec.md#g01-1-b), [O01.2.b](2026-10-01-pathway-language-level-3-story-spec.md#o01-2-b), [F04.2.b](2026-10-01-pathway-language-level-3-story-spec.md#f04-2-b).

**Integration/acceptance gates:** [U01.2.b](2026-10-01-pathway-language-level-3-story-spec.md#u01-2-b), [X01.2.b](2026-10-01-pathway-language-level-3-story-spec.md#x01-2-b), [V01.1.b](2026-10-01-pathway-language-level-3-story-spec.md#v01-1-b). **Readiness:** E2.

**High-level work:** Compose O01 pairing with G01 date/table operations and scoped standing-condition fact; own the full E-02 packet including composed hypertension scope once X01.2.b and the author-facing view pass their gates.

**Expected touch surface:** APP/E-02 fixture and CORE/composition (proposed; inspect existing seams before editing).

**Acceptance:** Collection-time and now-context variants can differ only as authored; an independent urgent finding stays visible; no rate/acute treatment is executed.

**Out of this story:** No unreviewed table values or forced clinical dependency for a demo. Stop when the stated outcome and its required review/verification pass; do not absorb the rest of the parent track.

## X01 — Compose pathways without hidden merging or scope changes

<a id="x01-1-a"></a>

### X01.1.a — Compute canonical action keys

**Problem statement:** Given supported action payloads differing by subject, intent, route/dose or timing, produce equal keys only for established equivalent actions.

**Parent:** [X01.1](2026-10-01-pathway-language-level-2-refined-slices.md#x01-1). **Stage A trace:** B-21, B-22, B-27, B-28; C-03, E-01, E-02.

**Start prerequisites:** [F02.1.a](2026-10-01-pathway-language-level-3-story-spec.md#f02-1-a), [M01.1.a](2026-10-01-pathway-language-level-3-story-spec.md#m01-1-a).

**Integration/acceptance gates:** [T01.3.b](2026-10-01-pathway-language-level-3-story-spec.md#t01-3-b). **Readiness:** E.

**High-level work:** Define canonical fields per supported action type and explicit unknown-key failure.

**Expected touch surface:** CORE/action identity (proposed; inspect existing seams before editing).

**Acceptance:** Same display text with different dose or timing does not merge; permutation of irrelevant fields preserves key.

**Out of this story:** No matching by display name or code alone. Stop when the stated outcome and its required review/verification pass; do not absorb the rest of the parent track.

<a id="x01-1-b"></a>

### X01.1.b — Coalesce exact equivalents with all obligations

**Problem statement:** Given equivalent proposals from two packages with distinct sources and review requirements, produce one combined proposal retaining both sources and accumulated obligations.

**Parent:** [X01.1](2026-10-01-pathway-language-level-2-refined-slices.md#x01-1). **Stage A trace:** B-21, B-22, B-27, B-28; C-03, E-01, E-02.

**Start prerequisites:** [X01.1.a](2026-10-01-pathway-language-level-3-story-spec.md#x01-1-a), [A01.2.b](2026-10-01-pathway-language-level-3-story-spec.md#a01-2-b).

**Integration/acceptance gates:** No additional story-specific gates; inherited gates and profile/scenario requirements still apply. **Readiness:** E1.

**High-level work:** Merge only established equivalents; retain contributing disposition and evidence traces.

**Expected touch surface:** CORE/action coalescing (proposed; inspect existing seams before editing).

**Acceptance:** Reversing package order changes nothing; unresolved required source cannot disappear behind the ready source.

**Out of this story:** No matching by display name or code alone. Stop when the stated outcome and its required review/verification pass; do not absorb the rest of the parent track.

<a id="x01-2-a"></a>

### X01.2.a — Surface unsupported equivalence and declared conflict

**Problem statement:** Given uTI/GBS or hypertension package fixtures with incompatible timing/intent, produce separate proposals and explicit required composition obligation.

**Parent:** [X01.2](2026-10-01-pathway-language-level-2-refined-slices.md#x01-2). **Stage A trace:** B-21, B-22, B-27, B-28; C-03, E-01, E-02.

**Start prerequisites:** [X01.1.b](2026-10-01-pathway-language-level-3-story-spec.md#x01-1-b).

**Integration/acceptance gates:** No additional story-specific gates; inherited gates and profile/scenario requirements still apply. **Readiness:** E1.

**High-level work:** Implement reviewed supported conflict predicates; retain all rationale.

**Expected touch surface:** CORE/composition conflict (proposed; inspect existing seams before editing).

**Acceptance:** Unknown equivalence is not guessed; conflicting required actions block readiness; known not-applicable findings remain distinct.

**Out of this story:** No universal medical interaction engine or partial finalization. Stop when the stated outcome and its required review/verification pass; do not absorb the rest of the parent track.

<a id="x01-2-b"></a>

### X01.2.b — Finalize the reviewed combined scope only

**Problem statement:** Given combined result with an urgent finding and unrelated required composition Need, produce urgent finding visible; no subgroup commit or silently reduced scope.

**Parent:** [X01.2](2026-10-01-pathway-language-level-2-refined-slices.md#x01-2). **Stage A trace:** B-21, B-22, B-27, B-28; C-03, E-01, E-02.

**Start prerequisites:** [X01.2.a](2026-10-01-pathway-language-level-3-story-spec.md#x01-2-a), [F07.2.b](2026-10-01-pathway-language-level-3-story-spec.md#f07-2-b), [F04.2.b](2026-10-01-pathway-language-level-3-story-spec.md#f04-2-b).

**Integration/acceptance gates:** [V01.1.b](2026-10-01-pathway-language-level-3-story-spec.md#v01-1-b). **Readiness:** E2.

**High-level work:** Feed combined canonical scope into F07 and reject tampering; test failure status separately.

**Expected touch surface:** APP/composed scope integration (proposed; inspect existing seams before editing).

**Acceptance:** No partial write when one required component unresolved; failed evaluator cannot claim exhaustive no-urgency assessment.

**Out of this story:** No universal medical interaction engine or partial finalization. Stop when the stated outcome and its required review/verification pass; do not absorb the rest of the parent track.

<a id="x01-3-a"></a>

### X01.3.a — Propose one typed handoff

**Problem statement:** Given e-01 reviewed maternal indication and authorized receiving role/service, produce handoff proposal with origin, reason, timing and fulfillment contract.

**Parent:** [X01.3](2026-10-01-pathway-language-level-2-refined-slices.md#x01-3). **Stage A trace:** B-21, B-22, B-27, B-28; C-03, E-01, E-02.

**Start prerequisites:** [F02.2.a](2026-10-01-pathway-language-level-3-story-spec.md#f02-2-a), [F04.1.a](2026-10-01-pathway-language-level-3-story-spec.md#f04-1-a).

**Integration/acceptance gates:** No additional story-specific gates; inherited gates and profile/scenario requirements still apply. **Readiness:** E1.

**High-level work:** Add supported handoff payload and source trace; bind subject and recipient context explicitly.

**Expected touch surface:** CORE/handoff proposal (proposed; inspect existing seams before editing).

**Acceptance:** Positive finding produces proposal; unknown recipient patient cannot become an order target; creating proposal is not communication.

**Out of this story:** No automated messaging, neonatal prescription or implicit completion. Stop when the stated outcome and its required review/verification pass; do not absorb the rest of the parent track.

<a id="x01-3-b"></a>

### X01.3.b — Fulfill only the handoff communication obligation

**Problem statement:** Given recorded authorized acknowledgment or wrong-context acknowledgment, produce completed communication obligation or explicit unfulfilled/rejected state.

**Parent:** [X01.3](2026-10-01-pathway-language-level-2-refined-slices.md#x01-3). **Stage A trace:** B-21, B-22, B-27, B-28; C-03, E-01, E-02.

**Start prerequisites:** [X01.3.a](2026-10-01-pathway-language-level-3-story-spec.md#x01-3-a), [F05.2.a](2026-10-01-pathway-language-level-3-story-spec.md#f05-2-a), [T01.1.b](2026-10-01-pathway-language-level-3-story-spec.md#t01-1-b).

**Integration/acceptance gates:** No additional story-specific gates; inherited gates and profile/scenario requirements still apply. **Readiness:** E1.

**High-level work:** Reuse fulfillment identity/authority mechanism for the handoff event.

**Expected touch surface:** APP/handoff acknowledgment (proposed; inspect existing seams before editing).

**Acceptance:** Correct acknowledgment fulfills communication only; wrong context does not; no neonatal action completion is inferred.

**Out of this story:** No automated messaging, neonatal prescription or implicit completion. Stop when the stated outcome and its required review/verification pass; do not absorb the rest of the parent track.

<a id="x01-4-a"></a>

### X01.4.a — Evaluate and fulfill a facility-readiness requirement

**Problem statement:** Given an indicated referral with unknown destination capability, then an authorized scoped resource attestation, produce persistent clinical indication with a readiness Need, followed by satisfied readiness in a new revision.

**Parent:** [X01.4](2026-10-01-pathway-language-level-2-refined-slices.md#x01-4). **Stage A trace:** B-21, B-22, B-27, B-28; C-03, E-01, E-02.

**Start prerequisites:** [A01.2.b](2026-10-01-pathway-language-level-3-story-spec.md#a01-2-b), [F05.2.a](2026-10-01-pathway-language-level-3-story-spec.md#f05-2-a), [T01.1.b](2026-10-01-pathway-language-level-3-story-spec.md#t01-1-b).

**Integration/acceptance gates:** No additional story-specific gates; inherited gates and profile/scenario requirements still apply. **Readiness:** C1.

**High-level work:** Add one operational evidence subject and authority contract, reusing fulfillment/review machinery.

**Expected touch surface:** CORE/operational query and APP/C-01 fixture (proposed; inspect existing seams before editing).

**Acceptance:** Institutional requirement alone is not availability; wrong-facility attestation rejects; valid evidence satisfies only readiness and does not mark referral delivered.

**Out of this story:** No live scheduling, institution microservice or assumption that policy proves availability. Stop when the stated outcome and its required review/verification pass; do not absorb the rest of the parent track.

## V01 — Explain ineffective or inconsistent relationships before execution

<a id="v01-1-a"></a>

### V01.1.a — Locate unused predicates and evidence queries

**Problem statement:** Given a graph containing used and disconnected query/predicate declarations, produce source-located unused-declaration diagnostics with traced output roots.

**Parent:** [V01.1](2026-10-01-pathway-language-level-2-refined-slices.md#v01-1). **Stage A trace:** B-01, B-03, B-29; C-03.

**Start prerequisites:** [F03.2.b](2026-10-01-pathway-language-level-3-story-spec.md#f03-2-b).

**Integration/acceptance gates:** No additional story-specific gates; inherited gates and profile/scenario requirements still apply. **Readiness:** E.

**High-level work:** Add backward dependency reachability from all declared meaningful outputs; account for public library exports and intentionally retained provenance.

**Expected touch surface:** CORE/compiler structural analysis (proposed; inspect existing seams before editing).

**Acceptance:** A query feeding a Need or independent finding is not falsely unused; an unreferenced local predicate is diagnosed; presentation-only roots do not invent eligibility.

**Out of this story:** No inference that every node must change eligibility. Stop when the stated outcome and its required review/verification pass; do not absorb the rest of the parent track.

<a id="v01-1-b"></a>

### V01.1.b — Diagnose constant-false indications and candidates

**Problem statement:** Given supported boolean expressions with a provably false indication or impossible candidate, produce a proof-scoped diagnostic identifying the decisive source expressions.

**Parent:** [V01.1](2026-10-01-pathway-language-level-2-refined-slices.md#v01-1). **Stage A trace:** B-01, B-03, B-29; C-03.

**Start prerequisites:** [F03.2.a](2026-10-01-pathway-language-level-3-story-spec.md#f03-2-a), [F01.2.a](2026-10-01-pathway-language-level-3-story-spec.md#f01-2-a).

**Integration/acceptance gates:** No additional story-specific gates; inherited gates and profile/scenario requirements still apply. **Readiness:** E.

**High-level work:** Reuse defined all/any/not semantics for static constant propagation without evaluating patient evidence.

**Expected touch surface:** CORE/compiler constant analysis (proposed; inspect existing seams before editing).

**Acceptance:** A constant-false branch is identified; a patient-dependent Unknown is not declared unreachable; severity follows the declared publication policy.

**Out of this story:** No inference that every node must change eligibility. Stop when the stated outcome and its required review/verification pass; do not absorb the rest of the parent track.

<a id="v01-2-a"></a>

### V01.2.a — Report a statically ineffective guard

**Problem statement:** Given a supported expression such as any(True, guard) and a control expression where guard matters, produce reviewable ineffective-guard diagnostic for the first only.

**Parent:** [V01.2](2026-10-01-pathway-language-level-2-refined-slices.md#v01-2). **Stage A trace:** B-01, B-03, B-29; C-03.

**Start prerequisites:** [V01.1.b](2026-10-01-pathway-language-level-3-story-spec.md#v01-1-b).

**Integration/acceptance gates:** No additional story-specific gates; inherited gates and profile/scenario requirements still apply. **Readiness:** E.

**High-level work:** Implement bounded simplification and source witnesses; preserve the authored AST rather than silently deleting the guard.

**Expected touch surface:** CORE/compiler influence diagnostics (proposed; inspect existing seams before editing).

**Acceptance:** Diagnostic points to the actual binding/expression; an independently useful finding/review output is retained; unsupported analysis is reported as not analyzed.

**Out of this story:** No global assertion that redundant clinical constraints are invalid. Stop when the stated outcome and its required review/verification pass; do not absorb the rest of the parent track.

<a id="v01-3-a"></a>

### V01.3.a — Compile and evaluate one typed finite-enum equality

**Problem statement:** Given a declared finite enum, typed literal and same-type operand from source, produce known equality result or lifted Unknown, with type-domain rejection.

**Parent:** [V01.3](2026-10-01-pathway-language-level-2-refined-slices.md#v01-3). **Stage A trace:** B-01, B-03, B-29; C-03.

**Start prerequisites:** [F03.2.a](2026-10-01-pathway-language-level-3-story-spec.md#f03-2-a).

**Integration/acceptance gates:** No additional story-specific gates; inherited gates and profile/scenario requirements still apply. **Readiness:** E.

**High-level work:** Add only enum equality through the canonical AST/IR/operator ledger and independent conformance fixtures.

**Expected touch surface:** CORE/finite-enum equality (proposed; inspect existing seams before editing).

**Acceptance:** Equal/different literals give True/False; wrong enum type rejects; unknown evidence stays Unknown; no implicit string coercion.

**Out of this story:** No solver dependency, numeric interval theory or ban on eligible alternatives in provider choices. Stop when the stated outcome and its required review/verification pass; do not absorb the rest of the parent track.

<a id="v01-3-b"></a>

### V01.3.b — Check explicitly required branch disjointness

**Problem statement:** Given two supported literal/enum branch conditions with a declared disjointness requirement, produce source-linked overlap witness or bounded disjointness diagnostic.

**Parent:** [V01.3](2026-10-01-pathway-language-level-2-refined-slices.md#v01-3). **Stage A trace:** B-01, B-03, B-29; C-03.

**Start prerequisites:** [V01.3.a](2026-10-01-pathway-language-level-3-story-spec.md#v01-3-a), [V01.1.b](2026-10-01-pathway-language-level-3-story-spec.md#v01-1-b).

**Integration/acceptance gates:** No additional story-specific gates; inherited gates and profile/scenario requirements still apply. **Readiness:** E.

**High-level work:** Analyze the finite declared domain and link both condition sources; unknown/unsupported expressions produce an explicit not-analyzed outcome.

**Expected touch surface:** CORE/compiler disjointness checks (proposed; inspect existing seams before editing).

**Acceptance:** Overlapping required-exclusive conditions trigger their declared publication obligation; ordinary provider one-of candidates may overlap without an error; findings never claim clinical completeness.

**Out of this story:** No solver dependency, numeric interval theory or ban on eligible alternatives in provider choices. Stop when the stated outcome and its required review/verification pass; do not absorb the rest of the parent track.

## U01 — Author and inspect a supported pathway without reading raw JSON

<a id="u01-1-a"></a>

### U01.1.a — Render one canonical pathway on the authoring surface

**Problem statement:** Given one supported AST with stable node/edge/field identities, produce readable graph and details showing indication, dependencies and action meaning.

**Parent:** [U01.1](2026-10-01-pathway-language-level-2-refined-slices.md#u01-1). **Stage A trace:** B-01, B-02, B-22, B-29, B-30; C-03; supports C-01/C-02/E-01/E-02 review.

**Start prerequisites:** [F01.1.a](2026-10-01-pathway-language-level-3-story-spec.md#f01-1-a).

**Integration/acceptance gates:** No additional story-specific gates; inherited gates and profile/scenario requirements still apply. **Readiness:** E.

**High-level work:** Inspect PathwayCanvas and PropertiesPanel in prism-admin-dashboard; implement a narrow AST projection or a small compatible view if the legacy model cannot preserve meaning.

**Expected touch surface:** UI/canonical AST projection and graph/details view (proposed; inspect existing seams before editing).

**Acceptance:** The displayed relationships round-trip to their source IDs; presentation layout changes no executable meaning; unsupported constructs are visible rather than silently dropped.

**Out of this story:** No assumption that old canvas data or edge meaning equals the new language. Stop when the stated outcome and its required review/verification pass; do not absorb the rest of the parent track.

<a id="u01-1-b"></a>

### U01.1.b — Navigate from compiler diagnostic to source

**Problem statement:** Given a compiled diagnostic with node/relationship/field path, produce selected/highlighted source element and readable diagnostic reason/severity.

**Parent:** [U01.1](2026-10-01-pathway-language-level-2-refined-slices.md#u01-1). **Stage A trace:** B-01, B-02, B-22, B-29, B-30; C-03; supports C-01/C-02/E-01/E-02 review.

**Start prerequisites:** [U01.1.a](2026-10-01-pathway-language-level-3-story-spec.md#u01-1-a), [F01.2.a](2026-10-01-pathway-language-level-3-story-spec.md#f01-2-a), [F02.1.a](2026-10-01-pathway-language-level-3-story-spec.md#f02-1-a).

**Integration/acceptance gates:** No additional story-specific gates; inherited gates and profile/scenario requirements still apply. **Readiness:** E.

**High-level work:** Consume structured backend source maps; extend beyond the canvas current node-only validationErrors shape; retain source revision identity.

**Expected touch surface:** UI/diagnostic navigation (proposed; inspect existing seams before editing).

**Acceptance:** Node, edge and field diagnostics each locate their source; stale/missing source mappings are explicitly indicated, not attached to another revision.

**Out of this story:** No assumption that old canvas data or edge meaning equals the new language. Stop when the stated outcome and its required review/verification pass; do not absorb the rest of the parent track.

<a id="u01-2-a"></a>

### U01.2.a — Edit one supported property and recompile

**Problem statement:** Given a loaded draft and changed boolean indication property, produce new draft revision, new diagnostics and reloadable canonical edit.

**Parent:** [U01.2](2026-10-01-pathway-language-level-2-refined-slices.md#u01-2). **Stage A trace:** B-01, B-02, B-22, B-29, B-30; C-03; supports C-01/C-02/E-01/E-02 review.

**Start prerequisites:** [U01.1.b](2026-10-01-pathway-language-level-3-story-spec.md#u01-1-b), [F02.1.b](2026-10-01-pathway-language-level-3-story-spec.md#f02-1-b).

**Integration/acceptance gates:** No additional story-specific gates; inherited gates and profile/scenario requirements still apply. **Readiness:** E.

**High-level work:** Implement the smallest draft-save/recompile boundary with revision checks; select one supported field, not a generic form framework.

**Expected touch surface:** UI/property edit plus APP/draft API (proposed; inspect existing seams before editing).

**Acceptance:** Editing the field changes the canonical source; a rejected/stale save cannot overwrite newer edits; saving/reloading preserves IDs and diagnostics map to the new revision.

**Out of this story:** No alternate frontend truth rules or clinical publication from preview. Stop when the stated outcome and its required review/verification pass; do not absorb the rest of the parent track.

<a id="u01-2-b"></a>

### U01.2.b — Preview one scenario with readable explanations

**Problem statement:** Given an authored draft and frozen nonclinical scenario selected in the view, produce visible disposition, findings, material Needs, rationale and incomplete-authoring state.

**Parent:** [U01.2](2026-10-01-pathway-language-level-2-refined-slices.md#u01-2). **Stage A trace:** B-01, B-02, B-22, B-29, B-30; C-03; supports C-01/C-02/E-01/E-02 review.

**Start prerequisites:** [U01.2.a](2026-10-01-pathway-language-level-3-story-spec.md#u01-2-a), [A01.1.a](2026-10-01-pathway-language-level-3-story-spec.md#a01-1-a), [F04.2.b](2026-10-01-pathway-language-level-3-story-spec.md#f04-2-b).

**Integration/acceptance gates:** [A01.1.b](2026-10-01-pathway-language-level-3-story-spec.md#a01-1-b). **Readiness:** E.

**High-level work:** Call the shared preview entry point; render structured outputs with source links; discard stale asynchronous responses by revision/scenario identity.

**Expected touch surface:** UI/preview and APP/preview API (proposed; inspect existing seams before editing).

**Acceptance:** A reviewer can follow a diagnostic, change the field, recompile and inspect changed output without reading JSON; a hole remains visibly incomplete; preview cannot finalize or activate clinical artifacts.

**Out of this story:** No alternate frontend truth rules or clinical publication from preview. Stop when the stated outcome and its required review/verification pass; do not absorb the rest of the parent track.

## I01 — Close named scenario acceptance through the assembled application

<a id="i01-1-a"></a>

### I01.1.a — Run the complete C-01 acceptance packet

**Problem statement:** Given adjudicated C-01 source/scenarios and implemented assessment, Need, follow-up and operational-readiness components, produce a recorded C-01 scenario result covering the entire required packet.

**Parent:** [I01.1](2026-10-01-pathway-language-level-2-refined-slices.md#i01-1). **Stage A trace:** B-01 through B-30 as applicable; C-01, C-03, E-01; ownership links for C-02/E-02.

**Start prerequisites:** [U01.2.b](2026-10-01-pathway-language-level-3-story-spec.md#u01-2-b), [F05.2.b](2026-10-01-pathway-language-level-3-story-spec.md#f05-2-b), [F06.2.b](2026-10-01-pathway-language-level-3-story-spec.md#f06-2-b), [F07.2.b](2026-10-01-pathway-language-level-3-story-spec.md#f07-2-b), [T01.3.b](2026-10-01-pathway-language-level-3-story-spec.md#t01-3-b), [X01.4.a](2026-10-01-pathway-language-level-3-story-spec.md#x01-4-a).

**Integration/acceptance gates:** [V01.1.a](2026-10-01-pathway-language-level-3-story-spec.md#v01-1-a), [V01.1.b](2026-10-01-pathway-language-level-3-story-spec.md#v01-1-b), [V01.2.a](2026-10-01-pathway-language-level-3-story-spec.md#v01-2-a). **Readiness:** C1.

**High-level work:** Run load/edit/compile/preview, missing-attestation Need, authorized fulfillment, new revision, review and sandbox whole-scope finalization; include retry and rejection variants.

**Expected touch surface:** APP and UI/C-01 integration harness (proposed; inspect existing seams before editing).

**Acceptance:** All C-01 expected findings/omissions/Needs/timing and failure cases are checked with concrete case IDs; a missing primitive becomes a new dependency, not hidden implementation in this story.

**Out of this story:** No replacing independent expected outcomes with evaluator-generated expectations. Stop when the stated outcome and its required review/verification pass; do not absorb the rest of the parent track.

<a id="i01-1-b"></a>

### I01.1.b — Run the complete E-01 acceptance packet

**Problem statement:** Given adjudicated E-01 package and implemented completion, admissibility, precedence, composition and handoff components, produce a recorded E-01 result covering follow-up through review/fulfillment/finalization boundaries.

**Parent:** [I01.1](2026-10-01-pathway-language-level-2-refined-slices.md#i01-1). **Stage A trace:** B-01 through B-30 as applicable; C-01, C-03, E-01; ownership links for C-02/E-02.

**Start prerequisites:** [U01.2.b](2026-10-01-pathway-language-level-3-story-spec.md#u01-2-b), [T01.4.b](2026-10-01-pathway-language-level-3-story-spec.md#t01-4-b), [O01.3.b](2026-10-01-pathway-language-level-3-story-spec.md#o01-3-b), [X01.2.a](2026-10-01-pathway-language-level-3-story-spec.md#x01-2-a), [X01.3.b](2026-10-01-pathway-language-level-3-story-spec.md#x01-3-b), [F05.2.b](2026-10-01-pathway-language-level-3-story-spec.md#f05-2-b), [F07.2.b](2026-10-01-pathway-language-level-3-story-spec.md#f07-2-b).

**Integration/acceptance gates:** [O01.3.a](2026-10-01-pathway-language-level-3-story-spec.md#o01-3-a), [V01.1.a](2026-10-01-pathway-language-level-3-story-spec.md#v01-1-a), [V01.1.b](2026-10-01-pathway-language-level-3-story-spec.md#v01-1-b). **Readiness:** E1.

**High-level work:** Run collection/completion/current-time cases, corrections, accepted/rejected precedence, UTI/GBS overlap and positive handoff through the same application path.

**Expected touch surface:** APP and UI/E-01 integration harness (proposed; inspect existing seams before editing).

**Acceptance:** Every E-01 acceptance case has independently expected output and concrete evidence; handoff acknowledgment is not neonatal treatment; unresolved scope cannot partially finalize.

**Out of this story:** No replacing independent expected outcomes with evaluator-generated expectations. Stop when the stated outcome and its required review/verification pass; do not absorb the rest of the parent track.

<a id="i01-2-a"></a>

### I01.2.a — Run the complete C-03 acceptance packet

**Problem statement:** Given c-03 invalid bindings/cycles, holes, unsupported profiles, synthetic evidence and stale/tampered scope fixtures, produce a recorded rejection/publication-boundary result for every C-03 obligation.

**Parent:** [I01.2](2026-10-01-pathway-language-level-2-refined-slices.md#i01-2). **Stage A trace:** B-01 through B-30 as applicable; C-01, C-03, E-01; ownership links for C-02/E-02.

**Start prerequisites:** [U01.2.b](2026-10-01-pathway-language-level-3-story-spec.md#u01-2-b), [A01.1.b](2026-10-01-pathway-language-level-3-story-spec.md#a01-1-b), [A01.2.a](2026-10-01-pathway-language-level-3-story-spec.md#a01-2-a), [A01.2.b](2026-10-01-pathway-language-level-3-story-spec.md#a01-2-b), [F01.2.b](2026-10-01-pathway-language-level-3-story-spec.md#f01-2-b), [F03.2.b](2026-10-01-pathway-language-level-3-story-spec.md#f03-2-b), [F02.2.b](2026-10-01-pathway-language-level-3-story-spec.md#f02-2-b), [F07.1.a](2026-10-01-pathway-language-level-3-story-spec.md#f07-1-a), [V01.2.a](2026-10-01-pathway-language-level-3-story-spec.md#v01-2-a), [V01.3.b](2026-10-01-pathway-language-level-3-story-spec.md#v01-3-b).

**Integration/acceptance gates:** [F06.2.b](2026-10-01-pathway-language-level-3-story-spec.md#f06-2-b). **Readiness:** E.

**High-level work:** Drive source diagnostics through the authoring view and direct API rejection tests; exercise actual loader, policy and finalization checks in isolated infrastructure.

**Expected touch surface:** UI, APP and CORE/C-03 acceptance harness (proposed; inspect existing seams before editing).

**Acceptance:** Visible diagnostics agree with API failures; bypassing the UI cannot publish incomplete artifacts or finalize synthetic clinical inputs; import-boundary checks and supported relationship-analysis cases are recorded.

**Out of this story:** No clinical adjudication bypass, rollout approval or new authorization subsystem. Stop when the stated outcome and its required review/verification pass; do not absorb the rest of the parent track.

## Traceability and completion record

Design stories prepare B/C/E contracts and close no implemented conformance family. Their evidence is reviewed decisions and manually checked examples, with unresolved questions recorded. Implementation stories inherit their parent's B/C/E references as context; it closes only its explicit acceptance assertions. During implementation, attach the exact concrete case IDs and test/PR evidence to the story. Do not mark an entire B family or C/E scenario complete because one child passes.

| Record for each story | Required evidence |
|---|---|
| Contract/readiness | Approved input/output contract and applicable clinical reviewer/version |
| Deliverable | Design document/review revision for L00; implementation PR/commit and actual touched boundaries otherwise |
| Verification | L00: independently reviewed expected examples and decision records; implementation: concrete case IDs, observed outputs and meaningful positive/rejection checks |
| Integration | L00: trace meaning through concepts, rules and representation; implementation: demonstrate authored source or the appropriate application boundary |
| Remaining work | Unimplemented parent assertions and next dependent story IDs |

A failed test, unresolved clinical rule, absent real adapter, or missing required authorization remains visible. No approval of these decomposition documents authorizes deployment or advances an incomplete Stage A/scenario gate.
