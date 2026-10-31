# Level 2: Refined behavioral slices

**Problem statement:** Given a Level 1 outcome, produce a dependency-bounded set of smaller behaviors whose combined outputs establish that outcome without hidden work. Each refinement identifies an observable boundary and delegates implementation to explicit stories.

**Status:** Proposed language-definition and implementation decomposition, not implementation completion or clinical approval.

**Date:** 2026-10-01

**Last revised:** 2026-10-02 — add language definition before implementation.

**Authority:** [Accepted architecture](2026-09-28-pathway-language-rfc.md) and [Stage A contracts](2026-09-30-pathway-language-stage-a-spec.md). These documents organize delivery under the Stage A capability contracts. They do not independently promote deferred capabilities.

See [Level 1](2026-10-01-pathway-language-level-1-behavioral-slices.md) for overall scope and [Level 3](2026-10-01-pathway-language-level-3-story-spec.md) for story dependencies/readiness. L00 child stories produce reviewed decisions and examples. Other child stories include implementation and its meaningful verification; source, compiler, runtime and test chores are not separate horizontal milestones.

## Source for the first language-definition story

Use the supplied [GERD pregnancy pathway](../records/pathway-language/corpus/GERD-Pregnancy-Care-Pathway.txt), under “CLINICAL DIAGNOSIS” → “ALARM SYMPTOMS REQUIRING IMMEDIATE EVALUATION”, specifically the progressive-dysphagia bullet. The unchanged source is pinned by SHA-256 `937859b9b22f672e4d212cdd99b188f1e1d12b6cd4217459155d2c34a8f67032` in the [corpus manifest](../records/pathway-language/corpus/manifest.json).

L00.1.a defines only how evidence for this alarm relates to a proposed evaluation within an explicitly agreed scope. The source’s urgency wording is a requirement to interpret, not permission to invent a numerical deadline, diagnostic test or treatment. Preserve the distinction between progressive dysphagia in this passage and the broader dysphagia wording in the referral section. Other alarms, referral/endoscopy decisions, medication sequencing and the full C-01 scenario remain outside this first story.

Use constructed evidence cases for symptom present, explicitly assessed absent, and not assessed/unavailable. Establish what evidence can support each case; an empty chart is not an explicit negative. A negative for this one symptom cannot clear all alarms or imply that no evaluation is needed for another reason. Source documents are design inputs, not approved executable guidance. Drafting and extracting questions can begin now; a named clinical reviewer must adjudicate the intended scope, urgency and action meaning before the story closes. This update selects the source, but does not claim that adjudication or its outcome table is complete. Language modeling (L00.1.b–L00.4.b) does not wait for that adjudication: it starts from the recorded [interpretation draft](../records/pathway-language/gerd-progressive-dysphagia-interpretation-draft.md) and represents unresolved clinical meaning as typed holes, as in the [minimal language model draft](../records/pathway-language/gerd-minimal-language-model.md). Those stories cannot resolve a hole or claim clinical meaning. Adjudication remains required to close L00.1.a and before any executable clinical content for this alarm is approved; C-01 acceptance ([I01.1.a](2026-10-01-pathway-language-level-3-story-spec.md#i01-1-a)) is gated on L00.1.a.

The later constant-only F01 validator fixture remains an engineering restriction of the reviewed representation, not an executable clinical version of this alarm rule. Evidence-dependent evaluation arrives later. L00 completion also does not close the larger C-01 packet.

## L00 — Define the meaning and representation of one pathway

Parent: [L00](2026-10-01-pathway-language-level-1-behavioral-slices.md#l00). Stage A trace: Stage A sections 2, 3, 6, 8 and 17; prepares B-01, B-03, B-04, B-24; no conformance completion claimed.

<a id="l00-1"></a>

### L00.1 — Example meaning and necessary concepts

**Problem statement:** Given the GERD source passage relating progressive dysphagia to immediate evaluation, produce an agreed input/output example and definitions of only the concepts it needs.

**High-level work:** Separate agreement about behavior from choosing syntax or software structures.

**External start prerequisites:** Approved minimal engineering source contract; no implementation predecessor.

**External integration/acceptance gates:** No additional external gate beyond the child stories and profile/scenario requirements.

**Boundary:** No JSON fields, grammar, complete node catalogue, full GERD algorithm or unreviewed clinical interpretation.

**Completion evidence:** Each case traces to the pinned source and a named clinical reviewer’s interpretation; present, explicitly absent and unassessed evidence remain distinct; absence of this one trigger cannot establish absence of other alarms or overall safety; proposal is not execution; unresolved scope, urgency or action meaning blocks completion; record clinical and engineering review identities and revision. Each concept points to a concrete part of the example; no two concepts have silently overlapping responsibilities; no software class or node catalogue is implied.

**Executable components:** [L00.1.a Define one pathway’s intended meaning without syntax](2026-10-01-pathway-language-level-3-story-spec.md#l00-1-a), [L00.1.b Define only the concepts needed by the example](2026-10-01-pathway-language-level-3-story-spec.md#l00-1-b).

<a id="l00-2"></a>

### L00.2 — Relationships and value domains

**Problem statement:** Given the example glossary, produce explicit connection meaning and allowed values.

**High-level work:** Define legal relationships before selecting their serialization, then their value and binding constraints.

**External start prerequisites:** [L00.1.b](2026-10-01-pathway-language-level-3-story-spec.md#l00-1-b).

**External integration/acceptance gates:** No additional external gate beyond the child stories and profile/scenario requirements.

**Boundary:** No generic graph framework, all future operators or implementation schemas.

**Completion evidence:** Each relationship has one explicit meaning; ambiguous or duplicate binding is identified as invalid where appropriate; two readers can reconstruct the example without inferring meaning from diagram layout. True, false and unavailable are distinguishable; wrong-type binding is an invalid definition; missing evidence is a valid input case; all domains needed by the example have explicit boundaries.

**Executable components:** [L00.2.a Define the example’s relationships](2026-10-01-pathway-language-level-3-story-spec.md#l00-2-a), [L00.2.b Define the example’s types and unavailable evidence](2026-10-01-pathway-language-level-3-story-spec.md#l00-2-b).

<a id="l00-3"></a>

### L00.3 — Evaluation meaning and invalid definitions

**Problem statement:** Given typed relationships and agreed expected results, produce precise evaluation rules and independent rejection examples.

**High-level work:** Derive only the rules needed to reproduce the example and check them manually against the original expectations.

**External start prerequisites:** [L00.2.b](2026-10-01-pathway-language-level-3-story-spec.md#l00-2-b).

**External integration/acceptance gates:** No additional external gate beyond the child stories and profile/scenario requirements.

**Boundary:** No evaluator code, full boolean algebra specification or patient-dependent proofs.

**Completion evidence:** Walk every original case through the rules without inventing a default; no rule executes the proposal; disagreements with Stage A are recorded for explicit resolution rather than silently creating alternate semantics. Each invalid example violates a named rule; each valid control example remains valid; source-validation versus later semantic checking is explicitly assigned; no diagnostic code or field syntax is assumed yet.

**Executable components:** [L00.3.a Define evaluation rules for the example](2026-10-01-pathway-language-level-3-story-spec.md#l00-3-a), [L00.3.b Define invalid pathway examples](2026-10-01-pathway-language-level-3-story-spec.md#l00-3-b).

<a id="l00-4"></a>

### L00.4 — Representation and validator contract

**Problem statement:** Given reviewed semantic and invalid examples, produce a concrete minimal source representation and exact validator boundary.

**High-level work:** Choose a representation within the accepted canonical-source architecture, then document exact accepted input and returned output.

**External start prerequisites:** [L00.3.b](2026-10-01-pathway-language-level-3-story-spec.md#l00-3-b).

**External integration/acceptance gates:** No additional external gate beyond the child stories and profile/scenario requirements.

**Boundary:** No reopening the architecture silently, full textual language, compiler IR or validator implementation.

**Completion evidence:** The example can be read back without changing meaning; representation introduces no implicit clinical defaults; record the choice, alternatives and owner; illustrate both evidence-driven meaning and the constant-only restriction used by F01. F01.1.a can be implemented without choosing language meaning or inventing fields; complete input passes, missing applicability and unknown executable property have exact rejection expectations; contract owner and reviewed revision are recorded.

**Executable components:** [L00.4.a Choose the initial authoring representation](2026-10-01-pathway-language-level-3-story-spec.md#l00-4-a), [L00.4.b Specify the smallest source-validation contract](2026-10-01-pathway-language-level-3-story-spec.md#l00-4-b).

## F01 — Accept one explicit source definition

Parent: [F01](2026-10-01-pathway-language-level-1-behavioral-slices.md#f01). Stage A trace: B-01, B-24, B-25; C-03.

<a id="f01-1"></a>

### F01.1 — Minimal source contract

**Problem statement:** Given a single recommendation fixture in the proposed canonical AST, return its typed source representation with explicit source identity.

**High-level work:** Limit the grammar to version headers, one guidance action, four literal decisions and stable IDs.

**External start prerequisites:** [L00.4.b](2026-10-01-pathway-language-level-3-story-spec.md#l00-4-b).

**External integration/acceptance gates:** No additional external gate beyond the child stories and profile/scenario requirements.

**Boundary:** No general node catalogue or hidden default conditions.

**Completion evidence:** A complete fixture succeeds; missing applicability and an unknown executable property fail with their AST locations. Supported pair passes; unsupported profile or language fails; version checking does not silently substitute another profile.

**Executable components:** [F01.1.a Accept the smallest authored fixture](2026-10-01-pathway-language-level-3-story-spec.md#f01-1-a), [F01.1.b Reject unsupported source versions](2026-10-01-pathway-language-level-3-story-spec.md#f01-1-b).

<a id="f01-2"></a>

### F01.2 — Actionable diagnostics and isolation

**Problem statement:** Given malformed source and an application importing the language package, return stable diagnostics while preserving the core boundary.

**High-level work:** Use structured diagnostic objects and one independent consumer fixture.

**External start prerequisites:** [F01.1.a](2026-10-01-pathway-language-level-3-story-spec.md#f01-1-a).

**External integration/acceptance gates:** No additional external gate beyond the child stories and profile/scenario requirements.

**Boundary:** No broad developer tooling or application refactor.

**Completion evidence:** Wrong literal type and duplicate ID each point to the offending source; repeated runs produce equivalent diagnostics. Public consumer builds without resolver/database/network imports; an injected forbidden dependency fails CI check.

**Executable components:** [F01.2.a Report stable source diagnostics](2026-10-01-pathway-language-level-3-story-spec.md#f01-2-a), [F01.2.b Prove the core import boundary](2026-10-01-pathway-language-level-3-story-spec.md#f01-2-b).

## F02 — Compile and execute the smallest pathway

Parent: [F02](2026-10-01-pathway-language-level-1-behavioral-slices.md#f02). Stage A trace: B-01, B-03, B-22, B-24; C-01, C-03.

<a id="f02-1"></a>

### F02.1 — Smallest IR and loader

**Problem statement:** Given validated source, produce and load a bounded immutable artifact tied to source IDs.

**High-level work:** Specify the literal opcode/action subset and source map, then reject unsupported artifacts.

**External start prerequisites:** [F01.1.a](2026-10-01-pathway-language-level-3-story-spec.md#f01-1-a), [F01.1.b](2026-10-01-pathway-language-level-3-story-spec.md#f01-1-b), [F01.2.a](2026-10-01-pathway-language-level-3-story-spec.md#f01-2-a).

**External integration/acceptance gates:** [F01.1.b](2026-10-01-pathway-language-level-3-story-spec.md#f01-1-b), [F01.2.b](2026-10-01-pathway-language-level-3-story-spec.md#f01-2-b).

**Boundary:** No generic virtual machine or remote compiler.

**Completion evidence:** Each generated operation maps to source; explicit false remains false; unsupported source constructs reject rather than disappear. Valid literal artifact loads; unknown opcode and missing source reference fail before execution.

**Executable components:** [F02.1.a Lower the literal fixture](2026-10-01-pathway-language-level-3-story-spec.md#f02-1-a), [F02.1.b Load only a supported artifact](2026-10-01-pathway-language-level-3-story-spec.md#f02-1-b).

<a id="f02-2"></a>

### F02.2 — Deterministic constant disposition

**Problem statement:** Given loaded constant predicates, produce the specified eligibility/disposition and explain why.

**High-level work:** Implement explicit reducer semantics for the narrow action and permutation invariance.

**External start prerequisites:** [F02.1.b](2026-10-01-pathway-language-level-3-story-spec.md#f02-1-b).

**External integration/acceptance gates:** No additional external gate beyond the child stories and profile/scenario requirements.

**Boundary:** No clinical-ready medication or external side effects.

**Completion evidence:** False indication plus true exclusion preserves both; unmet prerequisite is distinguished from not indicated. Reordering independent source fields/definitions changes neither disposition nor semantic explanation; unsupported work budget returns failure.

**Executable components:** [F02.2.a Evaluate constant indication and exclusion](2026-10-01-pathway-language-level-3-story-spec.md#f02-2-a), [F02.2.b Preserve results under irrelevant ordering](2026-10-01-pathway-language-level-3-story-spec.md#f02-2-b).

## F03 — Interpret one known or missing observation

Parent: [F03](2026-10-01-pathway-language-level-1-behavioral-slices.md#f03). Stage A trace: B-01, B-03, B-04, B-13; C-01, E-01.

<a id="f03-1"></a>

### F03.1 — Bind one fact without inventing absence

**Problem statement:** Given one declared query and a frozen patient/episode, resolve the matching fact or return explicit unresolved evidence.

**High-level work:** Use identity and exact scope before considering richer evidence selection.

**External start prerequisites:** [F02.2.a](2026-10-01-pathway-language-level-3-story-spec.md#f02-2-a).

**External integration/acceptance gates:** [F02.2.b](2026-10-01-pathway-language-level-3-story-spec.md#f02-2-b).

**Boundary:** No provenance ranking or query-completeness assertions.

**Completion evidence:** Known False stays known false; wrong-subject observation cannot satisfy the binding; a wrong-type binding is a compile error. An empty bag is Unknown/Missing, not False; unavailable and invalid remain distinguishable.

**Executable components:** [F03.1.a Bind and resolve a known boolean observation](2026-10-01-pathway-language-level-3-story-spec.md#f03-1-a), [F03.1.b Represent absent and failed evidence distinctly](2026-10-01-pathway-language-level-3-story-spec.md#f03-1-b).

<a id="f03-2"></a>

### F03.2 — Propagate uncertainty through authored logic

**Problem statement:** Given known and unknown boolean dependencies, derive the specified decision and preserve material explanations.

**High-level work:** Add lifted all/any/not with supported dependency validation.

**External start prerequisites:** [F03.1.a](2026-10-01-pathway-language-level-3-story-spec.md#f03-1-a), [F03.1.b](2026-10-01-pathway-language-level-3-story-spec.md#f03-1-b).

**External integration/acceptance gates:** No additional external gate beyond the child stories and profile/scenario requirements.

**Boundary:** No arbitrary expressions or confidence scoring.

**Completion evidence:** False AND Unknown resolves false while retaining uncertainty; True OR Unknown resolves true; NOT Unknown stays unknown. A cycle and ambiguous binding fail; a reordered legal graph compiles and produces the same result.

**Executable components:** [F03.2.a Execute three-valued boolean composition](2026-10-01-pathway-language-level-3-story-spec.md#f03-2-a), [F03.2.b Reject invalid evidence dependency graphs](2026-10-01-pathway-language-level-3-story-spec.md#f03-2-b).

## F04 — Turn material uncertainty into stable Needs

Parent: [F04](2026-10-01-pathway-language-level-1-behavioral-slices.md#f04). Stage A trace: B-04, B-26, B-28; C-01.

<a id="f04-1"></a>

### F04.1 — Stable requirement identity

**Problem statement:** Given the same unmet evidence contract across evaluations, emit the same Need identity and preserve affected outputs.

**High-level work:** Key by requirement/version, subject/episode and anchor scope, not evaluation revision.

**External start prerequisites:** [F03.1.b](2026-10-01-pathway-language-level-3-story-spec.md#f03-1-b).

**External integration/acceptance gates:** [F03.2.b](2026-10-01-pathway-language-level-3-story-spec.md#f03-2-b).

**Boundary:** No arbitrary string concatenation contract or automatic retry.

**Completion evidence:** Equivalent reevaluations share the key; changed requirement or episode gets a different key. Repeated/shared reads do not duplicate Needs; distinct scopes remain distinct.

**Executable components:** [F04.1.a Emit one scoped Need](2026-10-01-pathway-language-level-3-story-spec.md#f04-1-a), [F04.1.b Deduplicate shared requirements](2026-10-01-pathway-language-level-3-story-spec.md#f04-1-b).

<a id="f04-2"></a>

### F04.2 — Materiality and independent obligations

**Problem statement:** Given unknown inputs on decisive and nondecisive branches, block only material results while preserving declared review obligations.

**High-level work:** Use explicit dependency results, not short-circuit deletion of traces.

**External start prerequisites:** [F03.2.a](2026-10-01-pathway-language-level-3-story-spec.md#f03-2-a), [F04.1.a](2026-10-01-pathway-language-level-3-story-spec.md#f04-1-a).

**External integration/acceptance gates:** No additional external gate beyond the child stories and profile/scenario requirements.

**Boundary:** No claim of completed whole-scope readiness before all required obligations settle.

**Completion evidence:** The false branch retains the unknown reason without an unnecessary blocker; the true branch emits the required Need. Unrelated uncertainty cannot erase urgency; a required independent review remains even where clinical unknown is immaterial.

**Executable components:** [F04.2.a Separate material and immaterial unknowns](2026-10-01-pathway-language-level-3-story-spec.md#f04-2-a), [F04.2.b Preserve independent urgency and review needs](2026-10-01-pathway-language-level-3-story-spec.md#f04-2-b).

## F05 — Fulfill a Need and reevaluate a new revision

Parent: [F05](2026-10-01-pathway-language-level-1-behavioral-slices.md#f05). Stage A trace: B-15, B-26; C-01; Stage D later.

<a id="f05-1"></a>

### F05.1 — Pure typed fulfillment

**Problem statement:** Given a requirement and an authenticated recorded response, return accepted evidence or a reasoned rejection.

**High-level work:** Validate exact type, subject, scope and authorized response kind first; temporal expiry is added by T01.

**External start prerequisites:** [F04.1.a](2026-10-01-pathway-language-level-3-story-spec.md#f04-1-a).

**External integration/acceptance gates:** [F04.1.b](2026-10-01-pathway-language-level-3-story-spec.md#f04-1-b), [F04.2.a](2026-10-01-pathway-language-level-3-story-spec.md#f04-2-a).

**Boundary:** No clinical truth manufactured from response receipt.

**Completion evidence:** Correct response is accepted; acceptance records origin and does not itself assert plan completion. Wrong-scope evidence cannot close the Need; replaying one response does not create another observation.

**Executable components:** [F05.1.a Accept a valid provider attestation](2026-10-01-pathway-language-level-3-story-spec.md#f05-1-a), [F05.1.b Reject mismatched fulfillment and duplicate effects](2026-10-01-pathway-language-level-3-story-spec.md#f05-1-b).

<a id="f05-2"></a>

### F05.2 — Controlled acquisition loop

**Problem statement:** Given a missing fact exposed through an application session, request one allowed provider response and reevaluate its recorded result.

**High-level work:** Build a narrow in-process/test adapter using the real session boundary and pure core.

**External start prerequisites:** [F05.1.b](2026-10-01-pathway-language-level-3-story-spec.md#f05-1-b).

**External integration/acceptance gates:** [F03.2.b](2026-10-01-pathway-language-level-3-story-spec.md#f03-2-b).

**Boundary:** No external EHR calls, broad UI redesign or endless retry.

**Completion evidence:** Event creates one new revision; wrong session revision cannot overwrite current evidence; old evaluation remains inspectable. Duplicate dispatch has one effect; refusal/exhaustion survives reevaluation; no acquisition resets simply because evaluation reruns.

**Executable components:** [F05.2.a Record response and evaluate revision n+1](2026-10-01-pathway-language-level-3-story-spec.md#f05-2-a), [F05.2.b Bound attempts across reevaluation](2026-10-01-pathway-language-level-3-story-spec.md#f05-2-b).

## F06 — Pin results and invalidate stale review

Parent: [F06](2026-10-01-pathway-language-level-1-behavioral-slices.md#f06). Stage A trace: B-22, B-23, B-24; C-01, C-02, C-03.

<a id="f06-1"></a>

### F06.1 — Canonical evaluation identity and replay

**Problem statement:** Given a complete supported evaluation bundle, derive a stable identity and reproduce its outcome.

**High-level work:** Retain versioned content and inputs alongside the digest, not only a hash.

**External start prerequisites:** [F02.1.b](2026-10-01-pathway-language-level-3-story-spec.md#f02-1-b), [F02.2.a](2026-10-01-pathway-language-level-3-story-spec.md#f02-2-a).

**External integration/acceptance gates:** [F01.2.b](2026-10-01-pathway-language-level-3-story-spec.md#f01-2-b).

**Boundary:** No incremental evaluator or remote artifact service.

**Completion evidence:** Permutation of unordered inputs preserves digest; changed fact, clock or requested scope changes it. Original result reproduces exactly under its clock; missing content or mismatched digest cannot return an empty ready plan.

**Executable components:** [F06.1.a Fingerprint a frozen bundle](2026-10-01-pathway-language-level-3-story-spec.md#f06-1-a), [F06.1.b Replay retained supported artifacts](2026-10-01-pathway-language-level-3-story-spec.md#f06-1-b).

<a id="f06-2"></a>

### F06.2 — Review acknowledgement binding

**Problem statement:** Given a reviewed result and a subsequent change, determine whether review still authorizes that exact requested scope.

**High-level work:** Keep clinical approval and runtime review separate.

**External start prerequisites:** [F03.1.b](2026-10-01-pathway-language-level-3-story-spec.md#f03-1-b), [F05.2.a](2026-10-01-pathway-language-level-3-story-spec.md#f05-2-a), [F06.1.b](2026-10-01-pathway-language-level-3-story-spec.md#f06-1-b).

**External integration/acceptance gates:** No additional external gate beyond the child stories and profile/scenario requirements.

**Boundary:** No consent inference from clicking a generic acknowledgement.

**Completion evidence:** Correct-scope review is recorded; wrong actor/scope/revision is rejected. Changed clinical input blocks reuse; identical frozen reevaluation does not invent a new clinical change.

**Executable components:** [F06.2.a Bind a review to one result revision](2026-10-01-pathway-language-level-3-story-spec.md#f06-2-a), [F06.2.b Invalidate review on material change](2026-10-01-pathway-language-level-3-story-spec.md#f06-2-b).

## F07 — Finalize one reviewed scope without duplicate effects

Parent: [F07](2026-10-01-pathway-language-level-1-behavioral-slices.md#f07). Stage A trace: B-23, B-24, B-28 contracts; C-02, C-03 application evidence.

<a id="f07-1"></a>

### F07.1 — Requested-scope finalization boundary

**Problem statement:** Given a ready result and a requested-scope digest, commit only the reviewed supported scope.

**High-level work:** Validate readiness, actor authority and current revision inside the transaction.

**External start prerequisites:** [F04.2.a](2026-10-01-pathway-language-level-3-story-spec.md#f04-2-a), [F06.2.a](2026-10-01-pathway-language-level-3-story-spec.md#f06-2-a).

**External integration/acceptance gates:** [A01.1.b](2026-10-01-pathway-language-level-3-story-spec.md#a01-1-b), [F06.2.b](2026-10-01-pathway-language-level-3-story-spec.md#f06-2-b).

**Boundary:** No silently dropping unresolved actions or bypassing publication.

**Completion evidence:** Unresolved required Need, mismatched scope or synthetic clinical request rejects; known findings remain queryable. Both plan and completion commit or neither does; injected write failure leaves no partial materialization.

**Executable components:** [F07.1.a Reject unready or unauthorized finalization](2026-10-01-pathway-language-level-3-story-spec.md#f07-1-a), [F07.1.b Commit one guidance result atomically](2026-10-01-pathway-language-level-3-story-spec.md#f07-1-b).

<a id="f07-2"></a>

### F07.2 — Concurrency and idempotency

**Problem statement:** Given retried or competing finalization requests, return the committed result once or a revision conflict.

**High-level work:** Use database-enforced identity and optimistic concurrency in the same transaction.

**External start prerequisites:** [F06.2.b](2026-10-01-pathway-language-level-3-story-spec.md#f06-2-b), [F07.1.b](2026-10-01-pathway-language-level-3-story-spec.md#f07-1-b).

**External integration/acceptance gates:** No additional external gate beyond the child stories and profile/scenario requirements.

**Boundary:** No real clinical order side effects or distributed transaction platform.

**Completion evidence:** Two repeated identical requests produce one plan; same key with a different payload is rejected. Concurrent requests never mix revision evidence or create duplicate plans; changed scope/evidence invalidates the stale transaction.

**Executable components:** [F07.2.a Return one result for repeated submission](2026-10-01-pathway-language-level-3-story-spec.md#f07-2-a), [F07.2.b Reject stale and concurrent revisions](2026-10-01-pathway-language-level-3-story-spec.md#f07-2-b).

## A01 — Make incomplete authoring and policy visible

Parent: [A01](2026-10-01-pathway-language-level-1-behavioral-slices.md#a01). Stage A trace: B-02, B-14, B-18, B-24; C-03.

<a id="a01-1"></a>

### A01.1 — Typed holes and preview-only artifacts

**Problem statement:** Given a missing typed clinical constant in an otherwise valid source, preview incomplete outputs without publishing them.

**High-level work:** Extend the AST/result domain and share the evaluator kernel.

**External start prerequisites:** [F02.1.b](2026-10-01-pathway-language-level-3-story-spec.md#f02-1-b), [F02.2.a](2026-10-01-pathway-language-level-3-story-spec.md#f02-2-a).

**External integration/acceptance gates:** [F03.2.a](2026-10-01-pathway-language-level-3-story-spec.md#f03-2-a), [F04.1.a](2026-10-01-pathway-language-level-3-story-spec.md#f04-1-a).

**Boundary:** No substituting patient Unknown for authoring incompleteness.

**Completion evidence:** Dependent preview shows a typed hole; a wrong-type hole rejects; integrated acceptance must distinguish the marker from patient Unknown and must not emit a patient Need for the hole. Unvisited hole still blocks publication; relabeling preview/synthetic context cannot authorize clinical finalization.

**Executable components:** [A01.1.a Propagate a well-typed hole](2026-10-01-pathway-language-level-3-story-spec.md#a01-1-a), [A01.1.b Reject promotion of incomplete preview](2026-10-01-pathway-language-level-3-story-spec.md#a01-1-b).

<a id="a01-2"></a>

### A01.2 — Rationale and bounded policy

**Problem statement:** Given reviewed content or effective policy changes, invalidate affected review or reject unauthorized policy composition.

**High-level work:** Implement one scalar bound and mandatory-check/permission composition with tests.

**External start prerequisites:** [A01.1.b](2026-10-01-pathway-language-level-3-story-spec.md#a01-1-b), [F01.1.a](2026-10-01-pathway-language-level-3-story-spec.md#f01-1-a), [F06.1.a](2026-10-01-pathway-language-level-3-story-spec.md#f06-1-a).

**External integration/acceptance gates:** [A01.1.b](2026-10-01-pathway-language-level-3-story-spec.md#a01-1-b), [F06.2.b](2026-10-01-pathway-language-level-3-story-spec.md#f06-2-b).

**Boundary:** No policy scripting or full approval-management UI.

**Completion evidence:** Executable hash may stay fixed; prior content approval cannot silently cover the changed rationale. Out-of-bound specialization fails; required check survives lower-tier omission; permissions cannot widen.

**Executable components:** [A01.2.a Track reviewed rationale independently of behavior](2026-10-01-pathway-language-level-3-story-spec.md#a01-2-a), [A01.2.b Resolve one bounded policy artifact](2026-10-01-pathway-language-level-3-story-spec.md#a01-2-b).

## M01 — Initiate one reviewed medication through choice and safety

Parent: [M01](2026-10-01-pathway-language-level-1-behavioral-slices.md#m01). Stage A trace: B-05, B-16, B-17, B-18, B-23; C-02.

<a id="m01-1"></a>

### M01.1 — Fixed medication payload and required safety result

**Problem statement:** Given a reviewed fixed action and recorded safety evidence, produce a typed proposal with a distinct safety state.

**High-level work:** Use synthetic safety inputs until validated adapters exist.

**External start prerequisites:** [F02.2.a](2026-10-01-pathway-language-level-3-story-spec.md#f02-2-a).

**External integration/acceptance gates:** [A01.2.b](2026-10-01-pathway-language-level-3-story-spec.md#a01-2-b), [F01.1.b](2026-10-01-pathway-language-level-3-story-spec.md#f01-1-b).

**Boundary:** No knowledge-base integration or dose calculation.

**Completion evidence:** Action identity survives round-trip; incompatible dose units or missing formulation required by the contract fail. Unmapped allergy is not clear; complete scoped negative is traceable; incomplete scope cannot finalize.

**Executable components:** [M01.1.a Represent one fixed medication proposal](2026-10-01-pathway-language-level-3-story-spec.md#m01-1-a), [M01.1.b Apply clear versus incomplete allergy coverage](2026-10-01-pathway-language-level-3-story-spec.md#m01-1-b).

<a id="m01-2"></a>

### M01.2 — Known findings and interaction coverage

**Problem statement:** Given allergy/interaction findings for the supported candidate/current therapies, preserve holds and incomplete safety explanations.

**High-level work:** Add each required assessment independently, then compose required safety states.

**External start prerequisites:** [M01.1.b](2026-10-01-pathway-language-level-3-story-spec.md#m01-1-b).

**External integration/acceptance gates:** No additional external gate beyond the child stories and profile/scenario requirements.

**Boundary:** No inferred safety from a medication name or missing chart rows.

**Completion evidence:** Known exclusion/hold stays visible even with unrelated unknown; acknowledgement alone cannot clear it. An unavailable knowledge source or incomplete current-therapy coverage is unresolved; known finding is preserved.

**Executable components:** [M01.2.a Withhold for an established required safety finding](2026-10-01-pathway-language-level-3-story-spec.md#m01-2-a), [M01.2.b Require scoped interaction assessment](2026-10-01-pathway-language-level-3-story-spec.md#m01-2-b).

<a id="m01-3"></a>

### M01.3 — One-of selection, refusal and consent

**Problem statement:** Given two eligible candidates and recorded human inputs, separate selection, refusal, consent and readiness.

**High-level work:** Use explicit recorded inputs and no default winner.

**External start prerequisites:** [F04.1.a](2026-10-01-pathway-language-level-3-story-spec.md#f04-1-a), [F05.1.b](2026-10-01-pathway-language-level-3-story-spec.md#f05-1-b), [M01.1.a](2026-10-01-pathway-language-level-3-story-spec.md#m01-1-a).

**External integration/acceptance gates:** No additional external gate beyond the child stories and profile/scenario requirements.

**Boundary:** No bundle choices or automatically selected alternative.

**Completion evidence:** No selection yields Need; selecting ineligible candidate rejects; valid single selection does not erase the other candidate trace. Refusal is not Unknown/no-response; it never satisfies consent or silently selects B; valid consent satisfies only its own requirement.

**Executable components:** [M01.3.a Select exactly one of two medication candidates](2026-10-01-pathway-language-level-3-story-spec.md#m01-3-a), [M01.3.b Distinguish refusal from consent and ineligibility](2026-10-01-pathway-language-level-3-story-spec.md#m01-3-b).

<a id="m01-4"></a>

### M01.4 — Safety changes after selection and review

**Problem statement:** Given a selected/reviewed action with changed safety evidence, invalidate review and return the next explicit decision need.

**High-level work:** Integrate medication result into the existing finalization path.

**External start prerequisites:** [A01.2.b](2026-10-01-pathway-language-level-3-story-spec.md#a01-2-b), [F06.2.b](2026-10-01-pathway-language-level-3-story-spec.md#f06-2-b), [F07.2.b](2026-10-01-pathway-language-level-3-story-spec.md#f07-2-b), [M01.2.a](2026-10-01-pathway-language-level-3-story-spec.md#m01-2-a), [M01.2.b](2026-10-01-pathway-language-level-3-story-spec.md#m01-2-b), [M01.3.a](2026-10-01-pathway-language-level-3-story-spec.md#m01-3-a), [M01.3.b](2026-10-01-pathway-language-level-3-story-spec.md#m01-3-b).

**External integration/acceptance gates:** [A01.1.b](2026-10-01-pathway-language-level-3-story-spec.md#a01-1-b), [U01.2.b](2026-10-01-pathway-language-level-3-story-spec.md#u01-2-b), [V01.1.b](2026-10-01-pathway-language-level-3-story-spec.md#v01-1-b).

**Boundary:** No automatic switch or second finalization mechanism.

**Completion evidence:** B never becomes selected by evaluation; authorized later selection creates a new input/review cycle. Clear selected action commits once in test mode; changed safety blocks old review and leaves no partial scope write.

**Executable components:** [M01.4.a Do not reselect after a safety hold](2026-10-01-pathway-language-level-3-story-spec.md#m01-4-a), [M01.4.b Run medication review through sandbox finalization](2026-10-01-pathway-language-level-3-story-spec.md#m01-4-b).

## T01 — Use explicit time for one follow-up

Parent: [T01](2026-10-01-pathway-language-level-1-behavioral-slices.md#t01). Stage A trace: B-06, B-10, B-12, B-13, B-19, B-20; C-01, E-01.

<a id="t01-1"></a>

### T01.1 — Clock and one interval

**Problem statement:** Given known instants and declared endpoint semantics, evaluate a fixed time predicate deterministically.

**High-level work:** Normalize supported instants and preserve timestamp roles.

**External start prerequisites:** [F02.2.a](2026-10-01-pathway-language-level-3-story-spec.md#f02-2-a), [F05.1.b](2026-10-01-pathway-language-level-3-story-spec.md#f05-1-b).

**External integration/acceptance gates:** [F06.1.b](2026-10-01-pathway-language-level-3-story-spec.md#f06-1-b).

**Boundary:** No fabricated precision for partial dates.

**Completion evidence:** Exact endpoints match contract; implicit wall-clock reads are absent; malformed/partial evidence stays explicit. Boundary-valid response can fulfill; expired response cannot; old replay retains original clock result.

**Executable components:** [T01.1.a Evaluate one explicit fixed window](2026-10-01-pathway-language-level-3-story-spec.md#t01-1-a), [T01.1.b Validate response expiry against the pinned clock](2026-10-01-pathway-language-level-3-story-spec.md#t01-1-b).

<a id="t01-2"></a>

### T01.2 — Completion anchors and stable due state

**Problem statement:** Given a specific course-completion event, establish one immutable follow-up instance and evaluate due status.

**High-level work:** Keep event identity, action identity and occurrence separate.

**External start prerequisites:** [F03.1.a](2026-10-01-pathway-language-level-3-story-spec.md#f03-1-a), [T01.1.a](2026-10-01-pathway-language-level-3-story-spec.md#t01-1-a).

**External integration/acceptance gates:** No additional external gate beyond the child stories and profile/scenario requirements.

**Boundary:** No repeated schedules or rescheduling implementation.

**Completion evidence:** Order alone cannot create completed anchor; wrong course rejects; valid completion creates source-linked deadline. Later encounter does not shift due date; completed/cancelled event changes progress only under its contract.

**Executable components:** [T01.2.a Anchor a follow-up to actual completion](2026-10-01-pathway-language-level-3-story-spec.md#t01-2-a), [T01.2.b Keep deadline fixed through new encounters](2026-10-01-pathway-language-level-3-story-spec.md#t01-2-b).

<a id="t01-3"></a>

### T01.3 — Planning versus performance and expiration

**Problem statement:** Given an established action with separate timing attributes, show advance planning permission without implying performance readiness.

**High-level work:** Expose distinct fields in result/API and review materiality.

**External start prerequisites:** [F02.2.a](2026-10-01-pathway-language-level-3-story-spec.md#f02-2-a), [T01.2.b](2026-10-01-pathway-language-level-3-story-spec.md#t01-2-b).

**External integration/acceptance gates:** [F07.1.a](2026-10-01-pathway-language-level-3-story-spec.md#f07-1-a).

**Boundary:** No automatic EHR renewal or indefinite clinical permission.

**Completion evidence:** Advance proposal does not imply action performed; soft overdue does not suppress independently authored stop/reassessment. Order expiry cannot silently change clinical eligibility; clinical stop prevents performance readiness despite a later external expiry.

**Executable components:** [T01.3.a Separate planning from performance](2026-10-01-pathway-language-level-3-story-spec.md#t01-3-a), [T01.3.b Separate external expiry from clinical stop](2026-10-01-pathway-language-level-3-story-spec.md#t01-3-b).

<a id="t01-4"></a>

### T01.4 — Freshness and multi-anchor admissibility

**Problem statement:** Given a culture result with collection, completion and assessment times, evaluate query-specific suitability and preserve rejected candidates.

**High-level work:** Compose two existing time predicates; do not introduce a special interpreter.

**External start prerequisites:** [F03.1.a](2026-10-01-pathway-language-level-3-story-spec.md#f03-1-a), [F05.2.a](2026-10-01-pathway-language-level-3-story-spec.md#f05-2-a), [T01.1.a](2026-10-01-pathway-language-level-3-story-spec.md#t01-1-a), [T01.2.a](2026-10-01-pathway-language-level-3-story-spec.md#t01-2-a).

**External integration/acceptance gates:** No additional external gate beyond the child stories and profile/scenario requirements.

**Boundary:** No global expired flag or inferred negative result.

**Completion evidence:** Receipt cannot replace collection; historical query can accept what current query excludes; no usable result stays unresolved. Unknown anchor or stale result stays explicit; a reviewed unavailable contingency is distinct from clinical negative; corrected collection time produces a new revision.

**Executable components:** [T01.4.a Use collection time and query freshness](2026-10-01-pathway-language-level-3-story-spec.md#t01-4-a), [T01.4.b Compose completion window with freshness](2026-10-01-pathway-language-level-3-story-spec.md#t01-4-b).

## O01 — Select comparable distinct observations

Parent: [O01](2026-10-01-pathway-language-level-1-behavioral-slices.md#o01). Stage A trace: B-05, B-09, B-11, B-12, B-13, B-15; E-01, E-02.

<a id="o01-1"></a>

### O01.1 — Identity, filtering and latest selection

**Problem statement:** Given candidate observations, select by declared scope/time rules without row-order assumptions.

**High-level work:** Retain correction history and ambiguous candidates.

**External start prerequisites:** [F03.1.a](2026-10-01-pathway-language-level-3-story-spec.md#f03-1-a), [F05.1.b](2026-10-01-pathway-language-level-3-story-spec.md#f05-1-b), [T01.1.a](2026-10-01-pathway-language-level-3-story-spec.md#t01-1-a).

**External integration/acceptance gates:** No additional external gate beyond the child stories and profile/scenario requirements.

**Boundary:** No source precedence inferred from ingestion order.

**Completion evidence:** Wrong episode or isolate cannot satisfy query; missing required method stays unresolved rather than silently admissible. Correction can change winner; equal-time conflicting candidates remain unresolved; input order does not decide.

**Executable components:** [O01.1.a Filter candidates by episode and measurement context](2026-10-01-pathway-language-level-3-story-spec.md#o01-1-a), [O01.1.b Select definite latest with corrections and ties](2026-10-01-pathway-language-level-3-story-spec.md#o01-1-b).

<a id="o01-2"></a>

### O01.2 — Compatible values and distinct timed pair

**Problem statement:** Given candidate measurements under the approved numeric and timing profiles, evaluate comparable thresholds and the existence of a qualifying distinct pair.

**High-level work:** Reuse type/time operators with explicit pair identity.

**External start prerequisites:** [F03.1.a](2026-10-01-pathway-language-level-3-story-spec.md#f03-1-a), [O01.1.b](2026-10-01-pathway-language-level-3-story-spec.md#o01-1-b), [T01.1.a](2026-10-01-pathway-language-level-3-story-spec.md#t01-1-a).

**External integration/acceptance gates:** [F01.2.b](2026-10-01-pathway-language-level-3-story-spec.md#f01-2-b).

**Boundary:** No inferencing that multiple duplicate rows establish persistence.

**Completion evidence:** Equivalent unit values compare identically; unsupported conversion or assay compatibility is unresolved with reason. Duplicate identity cannot count twice; exact interval boundaries and uncertain timestamps behave as reviewed; order permutation is invariant.

**Executable components:** [O01.2.a Normalize one approved quantity conversion](2026-10-01-pathway-language-level-3-story-spec.md#o01-2-a), [O01.2.b Establish a separated observation pair](2026-10-01-pathway-language-level-3-story-spec.md#o01-2-b).

<a id="o01-3"></a>

### O01.3 — Coverage and explicit provider precedence

**Problem statement:** Given retrieved/attested evidence and query authority rules, distinguish sufficiency and legitimate precedence without overriding scope.

**High-level work:** Keep source completeness, sampling sufficiency and authority separate.

**External start prerequisites:** [F03.1.b](2026-10-01-pathway-language-level-3-story-spec.md#f03-1-b), [F06.2.b](2026-10-01-pathway-language-level-3-story-spec.md#f06-2-b), [O01.1.b](2026-10-01-pathway-language-level-3-story-spec.md#o01-1-b), [O01.2.b](2026-10-01-pathway-language-level-3-story-spec.md#o01-2-b), [T01.1.b](2026-10-01-pathway-language-level-3-story-spec.md#t01-1-b).

**External integration/acceptance gates:** No additional external gate beyond the child stories and profile/scenario requirements.

**Boundary:** No generic provider override or synthetic clinical coverage.

**Completion evidence:** A complete sparse snapshot is still insufficient for pairing; one admissible positive may establish existence under incomplete coverage. Valid same-course assertion can govern; expired/wrong-course/wrong-subject request cannot; changed result invalidates review.

**Executable components:** [O01.3.a Distinguish retrieval coverage from sampling sufficiency](2026-10-01-pathway-language-level-3-story-spec.md#o01-3-a), [O01.3.b Apply permitted provider precedence and reject misuse](2026-10-01-pathway-language-level-3-story-spec.md#o01-3-b).

## G01 — Interpret measurements in an explicit pregnancy context

Parent: [G01](2026-10-01-pathway-language-level-1-behavioral-slices.md#g01). Stage A trace: B-07, B-08, B-09, B-13, B-22; E-02.

<a id="g01-1"></a>

### G01.1 — Sourced pregnancy day count

**Problem statement:** Given exact dated reference and approved clinical date basis, compute day count with trace or unresolved dating context.

**High-level work:** Implement date-domain arithmetic separately from elapsed UTC duration.

**External start prerequisites:** [F06.2.b](2026-10-01-pathway-language-level-3-story-spec.md#f06-2-b), [T01.1.a](2026-10-01-pathway-language-level-3-story-spec.md#t01-1-a).

**External integration/acceptance gates:** No additional external gate beyond the child stories and profile/scenario requirements.

**Boundary:** No full calendar recurrence or implicit timezone conversion.

**Completion evidence:** Day-before/at/after cases are exact; missing/partial reference remains unresolved; episode mismatch rejects. Correction can cross a boundary in new result; replay of earlier bundle returns its earlier dating interpretation.

**Executable components:** [G01.1.a Compute known-date day count](2026-10-01-pathway-language-level-3-story-spec.md#g01-1-a), [G01.1.b Apply a dating correction without rewriting history](2026-10-01-pathway-language-level-3-story-spec.md#g01-1-b).

<a id="g01-2"></a>

### G01.2 — Lookup and context time

**Problem statement:** Given a reviewed interval-keyed clinical table and derived context, select the right entry at collection or assessment time.

**High-level work:** Represent table data as a pinned typed library, never a callback.

**External start prerequisites:** [F04.2.b](2026-10-01-pathway-language-level-3-story-spec.md#f04-2-b), [G01.1.a](2026-10-01-pathway-language-level-3-story-spec.md#g01-1-a), [G01.1.b](2026-10-01-pathway-language-level-3-story-spec.md#g01-1-b), [O01.2.b](2026-10-01-pathway-language-level-3-story-spec.md#o01-2-b).

**External integration/acceptance gates:** [U01.2.b](2026-10-01-pathway-language-level-3-story-spec.md#u01-2-b), [V01.1.b](2026-10-01-pathway-language-level-3-story-spec.md#v01-1-b), [X01.2.b](2026-10-01-pathway-language-level-3-story-spec.md#x01-2-b).

**Boundary:** No unreviewed table values or forced clinical dependency for a demo.

**Completion evidence:** Exact boundaries match approved entries; invalid overlapping table rejects; outside declared coverage stays explicit. Collection-time and now-context variants can differ only as authored; an independent urgent finding stays visible; no rate/acute treatment is executed.

**Executable components:** [G01.2.a Resolve one versioned interval lookup](2026-10-01-pathway-language-level-3-story-spec.md#g01-2-a), [G01.2.b Run E-02 with collection and assessment context](2026-10-01-pathway-language-level-3-story-spec.md#g01-2-b).

## X01 — Compose pathways without hidden merging or scope changes

Parent: [X01](2026-10-01-pathway-language-level-1-behavioral-slices.md#x01). Stage A trace: B-21, B-22, B-27, B-28; C-03, E-01, E-02.

<a id="x01-1"></a>

### X01.1 — Action identity and equivalent proposals

**Problem statement:** Given same-looking actions from different packages, establish equivalence only under the supported identity contract.

**High-level work:** Keep node identity and clinical action equivalence distinct.

**External start prerequisites:** [A01.2.b](2026-10-01-pathway-language-level-3-story-spec.md#a01-2-b), [F02.1.a](2026-10-01-pathway-language-level-3-story-spec.md#f02-1-a), [M01.1.a](2026-10-01-pathway-language-level-3-story-spec.md#m01-1-a).

**External integration/acceptance gates:** [T01.3.b](2026-10-01-pathway-language-level-3-story-spec.md#t01-3-b).

**Boundary:** No matching by display name or code alone.

**Completion evidence:** Same display text with different dose or timing does not merge; permutation of irrelevant fields preserves key. Reversing package order changes nothing; unresolved required source cannot disappear behind the ready source.

**Executable components:** [X01.1.a Compute canonical action keys](2026-10-01-pathway-language-level-3-story-spec.md#x01-1-a), [X01.1.b Coalesce exact equivalents with all obligations](2026-10-01-pathway-language-level-3-story-spec.md#x01-1-b).

<a id="x01-2"></a>

### X01.2 — Conflicts and whole-scope finalization

**Problem statement:** Given incompatible or not-provably-equivalent proposals, preserve them with explicit conflict/duplication and prevent unjustified finalization.

**High-level work:** Add supported conflict rules without choosing a winning pathway.

**External start prerequisites:** [F04.2.b](2026-10-01-pathway-language-level-3-story-spec.md#f04-2-b), [F07.2.b](2026-10-01-pathway-language-level-3-story-spec.md#f07-2-b), [X01.1.b](2026-10-01-pathway-language-level-3-story-spec.md#x01-1-b).

**External integration/acceptance gates:** [V01.1.b](2026-10-01-pathway-language-level-3-story-spec.md#v01-1-b).

**Boundary:** No universal medical interaction engine or partial finalization.

**Completion evidence:** Unknown equivalence is not guessed; conflicting required actions block readiness; known not-applicable findings remain distinct. No partial write when one required component unresolved; failed evaluator cannot claim exhaustive no-urgency assessment.

**Executable components:** [X01.2.a Surface unsupported equivalence and declared conflict](2026-10-01-pathway-language-level-3-story-spec.md#x01-2-a), [X01.2.b Finalize the reviewed combined scope only](2026-10-01-pathway-language-level-3-story-spec.md#x01-2-b).

<a id="x01-3"></a>

### X01.3 — Positive authorized handoff

**Problem statement:** Given a reviewed maternal finding requiring newborn-care communication, produce and track a typed handoff without a recipient-patient order.

**High-level work:** Treat role/service communication as an obligation with separate acknowledgment.

**External start prerequisites:** [F02.2.a](2026-10-01-pathway-language-level-3-story-spec.md#f02-2-a), [F04.1.a](2026-10-01-pathway-language-level-3-story-spec.md#f04-1-a), [F05.2.a](2026-10-01-pathway-language-level-3-story-spec.md#f05-2-a), [T01.1.b](2026-10-01-pathway-language-level-3-story-spec.md#t01-1-b).

**External integration/acceptance gates:** No additional external gate beyond the child stories and profile/scenario requirements.

**Boundary:** No automated messaging, neonatal prescription or implicit completion.

**Completion evidence:** Positive finding produces proposal; unknown recipient patient cannot become an order target; creating proposal is not communication. Correct acknowledgment fulfills communication only; wrong context does not; no neonatal action completion is inferred.

**Executable components:** [X01.3.a Propose one typed handoff](2026-10-01-pathway-language-level-3-story-spec.md#x01-3-a), [X01.3.b Fulfill only the handoff communication obligation](2026-10-01-pathway-language-level-3-story-spec.md#x01-3-b).

<a id="x01-4"></a>

### X01.4 — Operational readiness without changing clinical indication

**Problem statement:** Given an indicated referral and an institution-required receiving capability, return separate known or unresolved operational readiness.

**High-level work:** Resolve a scoped facility attestation through the existing evidence/Need contracts.

**External start prerequisites:** [A01.2.b](2026-10-01-pathway-language-level-3-story-spec.md#a01-2-b), [F05.2.a](2026-10-01-pathway-language-level-3-story-spec.md#f05-2-a), [T01.1.b](2026-10-01-pathway-language-level-3-story-spec.md#t01-1-b).

**External integration/acceptance gates:** No additional external gate beyond the child stories and profile/scenario requirements.

**Boundary:** No live scheduling, institution microservice or assumption that policy proves availability.

**Completion evidence:** Institutional requirement alone is not availability; wrong-facility attestation rejects; valid evidence satisfies only readiness and does not mark referral delivered.

**Executable components:** [X01.4.a Evaluate and fulfill a facility-readiness requirement](2026-10-01-pathway-language-level-3-story-spec.md#x01-4-a).

## V01 — Explain ineffective or inconsistent relationships before execution

Parent: [V01](2026-10-01-pathway-language-level-1-behavioral-slices.md#v01). Stage A trace: B-01, B-03, B-29; C-03.

<a id="v01-1"></a>

### V01.1 — Unused dependencies and constant impossibility

**Problem statement:** Given an authored graph and declared output roots, identify disconnected expressions and provably impossible conditions.

**High-level work:** Trace executable, Need, explanation and explicitly declared output dependencies; analyze constants only.

**External start prerequisites:** [F01.2.a](2026-10-01-pathway-language-level-3-story-spec.md#f01-2-a), [F03.2.a](2026-10-01-pathway-language-level-3-story-spec.md#f03-2-a), [F03.2.b](2026-10-01-pathway-language-level-3-story-spec.md#f03-2-b).

**External integration/acceptance gates:** No additional external gate beyond the child stories and profile/scenario requirements.

**Boundary:** No inference that every node must change eligibility.

**Completion evidence:** A query feeding a Need or independent finding is not falsely unused; an unreferenced local predicate is diagnosed; presentation-only roots do not invent eligibility. A constant-false branch is identified; a patient-dependent Unknown is not declared unreachable; severity follows the declared publication policy.

**Executable components:** [V01.1.a Locate unused predicates and evidence queries](2026-10-01-pathway-language-level-3-story-spec.md#v01-1-a), [V01.1.b Diagnose constant-false indications and candidates](2026-10-01-pathway-language-level-3-story-spec.md#v01-1-b).

<a id="v01-2"></a>

### V01.2 — Ineffective guards within an explicit fragment

**Problem statement:** Given a constant/boolean expression fragment with a redundant guard, explain the guard that cannot affect the supported result.

**High-level work:** Compare supported simplified expressions and report the analyzed assumptions.

**External start prerequisites:** [V01.1.b](2026-10-01-pathway-language-level-3-story-spec.md#v01-1-b).

**External integration/acceptance gates:** No additional external gate beyond the child stories and profile/scenario requirements.

**Boundary:** No global assertion that redundant clinical constraints are invalid.

**Completion evidence:** Diagnostic points to the actual binding/expression; an independently useful finding/review output is retained; unsupported analysis is reported as not analyzed.

**Executable components:** [V01.2.a Report a statically ineffective guard](2026-10-01-pathway-language-level-3-story-spec.md#v01-2-a).

<a id="v01-3"></a>

### V01.3 — Finite-domain exclusive-condition checking

**Problem statement:** Given literal or typed finite-enum comparisons under a declared disjointness obligation, produce a witness for overlap or a bounded disjointness result.

**High-level work:** Implement the narrow equality primitive then its finite-domain analysis; do not enable automatic choice execution.

**External start prerequisites:** [F03.2.a](2026-10-01-pathway-language-level-3-story-spec.md#f03-2-a), [V01.1.b](2026-10-01-pathway-language-level-3-story-spec.md#v01-1-b).

**External integration/acceptance gates:** No additional external gate beyond the child stories and profile/scenario requirements.

**Boundary:** No solver dependency, numeric interval theory or ban on eligible alternatives in provider choices.

**Completion evidence:** Equal/different literals give True/False; wrong enum type rejects; unknown evidence stays Unknown; no implicit string coercion. Overlapping required-exclusive conditions trigger their declared publication obligation; ordinary provider one-of candidates may overlap without an error; findings never claim clinical completeness.

**Executable components:** [V01.3.a Compile and evaluate one typed finite-enum equality](2026-10-01-pathway-language-level-3-story-spec.md#v01-3-a), [V01.3.b Check explicitly required branch disjointness](2026-10-01-pathway-language-level-3-story-spec.md#v01-3-b).

## U01 — Author and inspect a supported pathway without reading raw JSON

Parent: [U01](2026-10-01-pathway-language-level-1-behavioral-slices.md#u01). Stage A trace: B-01, B-02, B-22, B-29, B-30; C-03; supports C-01/C-02/E-01/E-02 review.

<a id="u01-1"></a>

### U01.1 — Canonical graph display and diagnostic navigation

**Problem statement:** Given a canonical supported source definition and compiler diagnostics, render readable nodes/relationships and navigate to the exact authored source.

**High-level work:** Adapt only the reviewed subset of the existing canvas and property panel.

**External start prerequisites:** [F01.1.a](2026-10-01-pathway-language-level-3-story-spec.md#f01-1-a), [F01.2.a](2026-10-01-pathway-language-level-3-story-spec.md#f01-2-a), [F02.1.a](2026-10-01-pathway-language-level-3-story-spec.md#f02-1-a).

**External integration/acceptance gates:** No additional external gate beyond the child stories and profile/scenario requirements.

**Boundary:** No assumption that old canvas data or edge meaning equals the new language.

**Completion evidence:** The displayed relationships round-trip to their source IDs; presentation layout changes no executable meaning; unsupported constructs are visible rather than silently dropped. Node, edge and field diagnostics each locate their source; stale/missing source mappings are explicitly indicated, not attached to another revision.

**Executable components:** [U01.1.a Render one canonical pathway on the authoring surface](2026-10-01-pathway-language-level-3-story-spec.md#u01-1-a), [U01.1.b Navigate from compiler diagnostic to source](2026-10-01-pathway-language-level-3-story-spec.md#u01-1-b).

<a id="u01-2"></a>

### U01.2 — One property edit and scenario preview

**Problem statement:** Given a loaded draft and a scoped test scenario, recompile the edited source and display its resulting findings and Needs.

**High-level work:** Use one editable literal field and authoritative preview responses before broader authoring controls.

**External start prerequisites:** [A01.1.a](2026-10-01-pathway-language-level-3-story-spec.md#a01-1-a), [F02.1.b](2026-10-01-pathway-language-level-3-story-spec.md#f02-1-b), [F04.2.b](2026-10-01-pathway-language-level-3-story-spec.md#f04-2-b), [U01.1.b](2026-10-01-pathway-language-level-3-story-spec.md#u01-1-b).

**External integration/acceptance gates:** [A01.1.b](2026-10-01-pathway-language-level-3-story-spec.md#a01-1-b).

**Boundary:** No alternate frontend truth rules or clinical publication from preview.

**Completion evidence:** Editing the field changes the canonical source; a rejected/stale save cannot overwrite newer edits; saving/reloading preserves IDs and diagnostics map to the new revision. A reviewer can follow a diagnostic, change the field, recompile and inspect changed output without reading JSON; a hole remains visibly incomplete; preview cannot finalize or activate clinical artifacts.

**Executable components:** [U01.2.a Edit one supported property and recompile](2026-10-01-pathway-language-level-3-story-spec.md#u01-2-a), [U01.2.b Preview one scenario with readable explanations](2026-10-01-pathway-language-level-3-story-spec.md#u01-2-b).

## I01 — Close named scenario acceptance through the assembled application

Parent: [I01](2026-10-01-pathway-language-level-1-behavioral-slices.md#i01). Stage A trace: B-01 through B-30 as applicable; C-01, C-03, E-01; ownership links for C-02/E-02.

<a id="i01-1"></a>

### I01.1 — Clinical scenario assembly

**Problem statement:** Given completed story outputs for one named clinical slice, demonstrate its reviewed input/output packet through the real supported boundaries.

**High-level work:** Assemble the authored package, frozen evidence, authoring preview and application lifecycle in isolated infrastructure.

**External start prerequisites:** [F05.2.b](2026-10-01-pathway-language-level-3-story-spec.md#f05-2-b), [F06.2.b](2026-10-01-pathway-language-level-3-story-spec.md#f06-2-b), [F07.2.b](2026-10-01-pathway-language-level-3-story-spec.md#f07-2-b), [O01.3.b](2026-10-01-pathway-language-level-3-story-spec.md#o01-3-b), [T01.3.b](2026-10-01-pathway-language-level-3-story-spec.md#t01-3-b), [T01.4.b](2026-10-01-pathway-language-level-3-story-spec.md#t01-4-b), [U01.2.b](2026-10-01-pathway-language-level-3-story-spec.md#u01-2-b), [X01.2.a](2026-10-01-pathway-language-level-3-story-spec.md#x01-2-a), [X01.3.b](2026-10-01-pathway-language-level-3-story-spec.md#x01-3-b), [X01.4.a](2026-10-01-pathway-language-level-3-story-spec.md#x01-4-a).

**External integration/acceptance gates:** [O01.3.a](2026-10-01-pathway-language-level-3-story-spec.md#o01-3-a), [V01.1.a](2026-10-01-pathway-language-level-3-story-spec.md#v01-1-a), [V01.1.b](2026-10-01-pathway-language-level-3-story-spec.md#v01-1-b), [V01.2.a](2026-10-01-pathway-language-level-3-story-spec.md#v01-2-a), [L00.1.a](2026-10-01-pathway-language-level-3-story-spec.md#l00-1-a) (C-01 only).

**Boundary:** No replacing independent expected outcomes with evaluator-generated expectations.

**Completion evidence:** All C-01 expected findings/omissions/Needs/timing and failure cases are checked with concrete case IDs; a missing primitive becomes a new dependency, not hidden implementation in this story. Every E-01 acceptance case has independently expected output and concrete evidence; handoff acknowledgment is not neonatal treatment; unresolved scope cannot partially finalize.

**Executable components:** [I01.1.a Run the complete C-01 acceptance packet](2026-10-01-pathway-language-level-3-story-spec.md#i01-1-a), [I01.1.b Run the complete E-01 acceptance packet](2026-10-01-pathway-language-level-3-story-spec.md#i01-1-b).

<a id="i01-2"></a>

### I01.2 — Authoring and protective scenario closure

**Problem statement:** Given implemented guardrails and malformed/incomplete/adversarial fixture requests, demonstrate C-03 rejection behavior through authoring/publication/execution boundaries.

**High-level work:** Run a single acceptance packet rather than relying only on isolated component unit tests.

**External start prerequisites:** [A01.1.b](2026-10-01-pathway-language-level-3-story-spec.md#a01-1-b), [A01.2.a](2026-10-01-pathway-language-level-3-story-spec.md#a01-2-a), [A01.2.b](2026-10-01-pathway-language-level-3-story-spec.md#a01-2-b), [F01.2.b](2026-10-01-pathway-language-level-3-story-spec.md#f01-2-b), [F02.2.b](2026-10-01-pathway-language-level-3-story-spec.md#f02-2-b), [F03.2.b](2026-10-01-pathway-language-level-3-story-spec.md#f03-2-b), [F07.1.a](2026-10-01-pathway-language-level-3-story-spec.md#f07-1-a), [U01.2.b](2026-10-01-pathway-language-level-3-story-spec.md#u01-2-b), [V01.2.a](2026-10-01-pathway-language-level-3-story-spec.md#v01-2-a), [V01.3.b](2026-10-01-pathway-language-level-3-story-spec.md#v01-3-b).

**External integration/acceptance gates:** [F06.2.b](2026-10-01-pathway-language-level-3-story-spec.md#f06-2-b).

**Boundary:** No clinical adjudication bypass, rollout approval or new authorization subsystem.

**Completion evidence:** Visible diagnostics agree with API failures; bypassing the UI cannot publish incomplete artifacts or finalize synthetic clinical inputs; import-boundary checks and supported relationship-analysis cases are recorded.

**Executable components:** [I01.2.a Run the complete C-03 acceptance packet](2026-10-01-pathway-language-level-3-story-spec.md#i01-2-a).
