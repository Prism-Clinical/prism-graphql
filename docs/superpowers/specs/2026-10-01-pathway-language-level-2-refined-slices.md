# Level 2: Refined behavioral slices

**Problem statement:** Given a Level 1 outcome, produce a dependency-bounded set of smaller behaviors whose combined outputs establish that outcome without hidden work. Each refinement identifies an observable boundary and delegates implementation to explicit stories.

**Status:** Proposed implementation decomposition, not implementation completion or clinical approval.

**Date:** 2026-10-01

**Authority:** [Accepted architecture](2026-09-28-pathway-language-rfc.md) and [Stage A contracts](2026-09-30-pathway-language-stage-a-spec.md). These documents organize delivery; they do not change language semantics or promote deferred capabilities.

See [Level 1](2026-10-01-pathway-language-level-1-behavioral-slices.md) for overall scope and [Level 3](2026-10-01-pathway-language-level-3-story-spec.md) for story dependencies/readiness. Child stories include implementation and its meaningful verification; source, compiler, runtime and test chores are not separate horizontal milestones.

## F01 — Accept one explicit source definition

Parent: [F01](2026-10-01-pathway-language-level-1-behavioral-slices.md#f01). Stage A trace: B-01, B-24, B-25; C-03.

<a id="f01-1"></a>

### F01.1 — Minimal source contract

**Problem statement:** Given a single recommendation fixture in the proposed canonical AST, return its typed source representation with explicit source identity.

**High-level work:** Limit the grammar to version headers, one guidance action, four literal decisions and stable IDs.

**Input prerequisites:** Approved minimal engineering source contract; no implementation predecessor.

**Boundary:** No general node catalogue or hidden default conditions.

**Completion evidence:** A complete fixture succeeds; missing applicability and an unknown executable property fail with their AST locations. Supported pair passes; unsupported profile or language fails; version checking does not silently substitute another profile.

**Executable components:** [F01.1.a Accept the smallest authored fixture](2026-10-01-pathway-language-level-3-story-spec.md#f01-1-a), [F01.1.b Reject unsupported source versions](2026-10-01-pathway-language-level-3-story-spec.md#f01-1-b).

<a id="f01-2"></a>

### F01.2 — Actionable diagnostics and isolation

**Problem statement:** Given malformed source and an application importing the language package, return stable diagnostics while preserving the core boundary.

**High-level work:** Use structured diagnostic objects and one independent consumer fixture.

**Input prerequisites:** [F01.1.a](2026-10-01-pathway-language-level-3-story-spec.md#f01-1-a), [F01.1.b](2026-10-01-pathway-language-level-3-story-spec.md#f01-1-b).

**Boundary:** No broad developer tooling or application refactor.

**Completion evidence:** Wrong literal type and duplicate ID each point to the offending source; repeated runs produce equivalent diagnostics. Public consumer builds without resolver/database/network imports; an injected forbidden dependency fails CI check.

**Executable components:** [F01.2.a Report stable source diagnostics](2026-10-01-pathway-language-level-3-story-spec.md#f01-2-a), [F01.2.b Prove the core import boundary](2026-10-01-pathway-language-level-3-story-spec.md#f01-2-b).

## F02 — Compile and execute the smallest pathway

Parent: [F02](2026-10-01-pathway-language-level-1-behavioral-slices.md#f02). Stage A trace: B-01, B-03, B-22, B-24; C-01, C-03.

<a id="f02-1"></a>

### F02.1 — Smallest IR and loader

**Problem statement:** Given validated source, produce and load a bounded immutable artifact tied to source IDs.

**High-level work:** Specify the literal opcode/action subset and source map, then reject unsupported artifacts.

**Input prerequisites:** [F01.2.b](2026-10-01-pathway-language-level-3-story-spec.md#f01-2-b).

**Boundary:** No generic virtual machine or remote compiler.

**Completion evidence:** Each generated operation maps to source; explicit false remains false; unsupported source constructs reject rather than disappear. Valid literal artifact loads; unknown opcode and missing source reference fail before execution.

**Executable components:** [F02.1.a Lower the literal fixture](2026-10-01-pathway-language-level-3-story-spec.md#f02-1-a), [F02.1.b Load only a supported artifact](2026-10-01-pathway-language-level-3-story-spec.md#f02-1-b).

<a id="f02-2"></a>

### F02.2 — Deterministic constant disposition

**Problem statement:** Given loaded constant predicates, produce the specified eligibility/disposition and explain why.

**High-level work:** Implement explicit reducer semantics for the narrow action and permutation invariance.

**Input prerequisites:** [F02.1.b](2026-10-01-pathway-language-level-3-story-spec.md#f02-1-b).

**Boundary:** No clinical-ready medication or external side effects.

**Completion evidence:** False indication plus true exclusion preserves both; unmet prerequisite is distinguished from not indicated. Reordering independent source fields/definitions changes neither disposition nor semantic explanation; unsupported work budget returns failure.

**Executable components:** [F02.2.a Evaluate constant indication and exclusion](2026-10-01-pathway-language-level-3-story-spec.md#f02-2-a), [F02.2.b Preserve results under irrelevant ordering](2026-10-01-pathway-language-level-3-story-spec.md#f02-2-b).

## F03 — Interpret one known or missing observation

Parent: [F03](2026-10-01-pathway-language-level-1-behavioral-slices.md#f03). Stage A trace: B-01, B-03, B-04, B-13; C-01, E-01.

<a id="f03-1"></a>

### F03.1 — Bind one fact without inventing absence

**Problem statement:** Given one declared query and a frozen patient/episode, resolve the matching fact or return explicit unresolved evidence.

**High-level work:** Use identity and exact scope before considering richer evidence selection.

**Input prerequisites:** [F02.2.b](2026-10-01-pathway-language-level-3-story-spec.md#f02-2-b).

**Boundary:** No provenance ranking or query-completeness assertions.

**Completion evidence:** Known False stays known false; wrong-subject observation cannot satisfy the binding; a wrong-type binding is a compile error. An empty bag is Unknown/Missing, not False; unavailable and invalid remain distinguishable.

**Executable components:** [F03.1.a Bind and resolve a known boolean observation](2026-10-01-pathway-language-level-3-story-spec.md#f03-1-a), [F03.1.b Represent absent and failed evidence distinctly](2026-10-01-pathway-language-level-3-story-spec.md#f03-1-b).

<a id="f03-2"></a>

### F03.2 — Propagate uncertainty through authored logic

**Problem statement:** Given known and unknown boolean dependencies, derive the specified decision and preserve material explanations.

**High-level work:** Add lifted all/any/not with supported dependency validation.

**Input prerequisites:** [F03.1.b](2026-10-01-pathway-language-level-3-story-spec.md#f03-1-b).

**Boundary:** No arbitrary expressions or confidence scoring.

**Completion evidence:** False AND Unknown resolves false while retaining uncertainty; True OR Unknown resolves true; NOT Unknown stays unknown. A cycle and ambiguous binding fail; a reordered legal graph compiles and produces the same result.

**Executable components:** [F03.2.a Execute three-valued boolean composition](2026-10-01-pathway-language-level-3-story-spec.md#f03-2-a), [F03.2.b Reject invalid evidence dependency graphs](2026-10-01-pathway-language-level-3-story-spec.md#f03-2-b).

## F04 — Turn material uncertainty into stable Needs

Parent: [F04](2026-10-01-pathway-language-level-1-behavioral-slices.md#f04). Stage A trace: B-04, B-26, B-28; C-01.

<a id="f04-1"></a>

### F04.1 — Stable requirement identity

**Problem statement:** Given the same unmet evidence contract across evaluations, emit the same Need identity and preserve affected outputs.

**High-level work:** Key by requirement/version, subject/episode and anchor scope, not evaluation revision.

**Input prerequisites:** [F03.2.b](2026-10-01-pathway-language-level-3-story-spec.md#f03-2-b).

**Boundary:** No arbitrary string concatenation contract or automatic retry.

**Completion evidence:** Equivalent reevaluations share the key; changed requirement or episode gets a different key. Repeated/shared reads do not duplicate Needs; distinct scopes remain distinct.

**Executable components:** [F04.1.a Emit one scoped Need](2026-10-01-pathway-language-level-3-story-spec.md#f04-1-a), [F04.1.b Deduplicate shared requirements](2026-10-01-pathway-language-level-3-story-spec.md#f04-1-b).

<a id="f04-2"></a>

### F04.2 — Materiality and independent obligations

**Problem statement:** Given unknown inputs on decisive and nondecisive branches, block only material results while preserving declared review obligations.

**High-level work:** Use explicit dependency results, not short-circuit deletion of traces.

**Input prerequisites:** [F04.1.b](2026-10-01-pathway-language-level-3-story-spec.md#f04-1-b).

**Boundary:** No claim of completed whole-scope readiness before all required obligations settle.

**Completion evidence:** The false branch retains the unknown reason without an unnecessary blocker; the true branch emits the required Need. Unrelated uncertainty cannot erase urgency; a required independent review remains even where clinical unknown is immaterial.

**Executable components:** [F04.2.a Separate material and immaterial unknowns](2026-10-01-pathway-language-level-3-story-spec.md#f04-2-a), [F04.2.b Preserve independent urgency and review needs](2026-10-01-pathway-language-level-3-story-spec.md#f04-2-b).

## F05 — Fulfill a Need and reevaluate a new revision

Parent: [F05](2026-10-01-pathway-language-level-1-behavioral-slices.md#f05). Stage A trace: B-15, B-26; C-01; Stage D later.

<a id="f05-1"></a>

### F05.1 — Pure typed fulfillment

**Problem statement:** Given a requirement and an authenticated recorded response, return accepted evidence or a reasoned rejection.

**High-level work:** Validate exact type, subject, scope and authorized response kind first; temporal expiry is added by T01.

**Input prerequisites:** [F04.2.b](2026-10-01-pathway-language-level-3-story-spec.md#f04-2-b).

**Boundary:** No clinical truth manufactured from response receipt.

**Completion evidence:** Correct response is accepted; acceptance records origin and does not itself assert plan completion. Wrong-scope evidence cannot close the Need; replaying one response does not create another observation.

**Executable components:** [F05.1.a Accept a valid provider attestation](2026-10-01-pathway-language-level-3-story-spec.md#f05-1-a), [F05.1.b Reject mismatched fulfillment and duplicate effects](2026-10-01-pathway-language-level-3-story-spec.md#f05-1-b).

<a id="f05-2"></a>

### F05.2 — Controlled acquisition loop

**Problem statement:** Given a missing fact exposed through an application session, request one allowed provider response and reevaluate its recorded result.

**High-level work:** Build a narrow in-process/test adapter using the real session boundary and pure core.

**Input prerequisites:** [F05.1.b](2026-10-01-pathway-language-level-3-story-spec.md#f05-1-b).

**Boundary:** No external EHR calls, broad UI redesign or endless retry.

**Completion evidence:** Event creates one new revision; wrong session revision cannot overwrite current evidence; old evaluation remains inspectable. Duplicate dispatch has one effect; refusal/exhaustion survives reevaluation; no acquisition resets simply because evaluation reruns.

**Executable components:** [F05.2.a Record response and evaluate revision n+1](2026-10-01-pathway-language-level-3-story-spec.md#f05-2-a), [F05.2.b Bound attempts across reevaluation](2026-10-01-pathway-language-level-3-story-spec.md#f05-2-b).

## F06 — Pin results and invalidate stale review

Parent: [F06](2026-10-01-pathway-language-level-1-behavioral-slices.md#f06). Stage A trace: B-22, B-23, B-24; C-01, C-02, C-03.

<a id="f06-1"></a>

### F06.1 — Canonical evaluation identity and replay

**Problem statement:** Given a complete supported evaluation bundle, derive a stable identity and reproduce its outcome.

**High-level work:** Retain versioned content and inputs alongside the digest, not only a hash.

**Input prerequisites:** [F05.2.a](2026-10-01-pathway-language-level-3-story-spec.md#f05-2-a).

**Boundary:** No incremental evaluator or remote artifact service.

**Completion evidence:** Permutation of unordered inputs preserves digest; changed fact, clock or requested scope changes it. Original result reproduces exactly under its clock; missing content or mismatched digest cannot return an empty ready plan.

**Executable components:** [F06.1.a Fingerprint a frozen bundle](2026-10-01-pathway-language-level-3-story-spec.md#f06-1-a), [F06.1.b Replay retained supported artifacts](2026-10-01-pathway-language-level-3-story-spec.md#f06-1-b).

<a id="f06-2"></a>

### F06.2 — Review acknowledgement binding

**Problem statement:** Given a reviewed result and a subsequent change, determine whether review still authorizes that exact requested scope.

**High-level work:** Keep clinical approval and runtime review separate.

**Input prerequisites:** [F05.2.b](2026-10-01-pathway-language-level-3-story-spec.md#f05-2-b), [F06.1.b](2026-10-01-pathway-language-level-3-story-spec.md#f06-1-b).

**Boundary:** No consent inference from clicking a generic acknowledgement.

**Completion evidence:** Correct-scope review is recorded; wrong actor/scope/revision is rejected. Changed clinical input blocks reuse; identical frozen reevaluation does not invent a new clinical change.

**Executable components:** [F06.2.a Bind a review to one result revision](2026-10-01-pathway-language-level-3-story-spec.md#f06-2-a), [F06.2.b Invalidate review on material change](2026-10-01-pathway-language-level-3-story-spec.md#f06-2-b).

## F07 — Finalize one reviewed scope without duplicate effects

Parent: [F07](2026-10-01-pathway-language-level-1-behavioral-slices.md#f07). Stage A trace: B-23, B-24, B-28 contracts; C-02, C-03 application evidence.

<a id="f07-1"></a>

### F07.1 — Requested-scope finalization boundary

**Problem statement:** Given a ready result and a requested-scope digest, commit only the reviewed supported scope.

**High-level work:** Validate readiness, actor authority and current revision inside the transaction.

**Input prerequisites:** [F06.2.b](2026-10-01-pathway-language-level-3-story-spec.md#f06-2-b).

**Boundary:** No silently dropping unresolved actions or bypassing publication.

**Completion evidence:** Unresolved required Need, mismatched scope or synthetic clinical request rejects; known findings remain queryable. Both plan and completion commit or neither does; injected write failure leaves no partial materialization.

**Executable components:** [F07.1.a Reject unready or unauthorized finalization](2026-10-01-pathway-language-level-3-story-spec.md#f07-1-a), [F07.1.b Commit one guidance result atomically](2026-10-01-pathway-language-level-3-story-spec.md#f07-1-b).

<a id="f07-2"></a>

### F07.2 — Concurrency and idempotency

**Problem statement:** Given retried or competing finalization requests, return the committed result once or a revision conflict.

**High-level work:** Use database-enforced identity and optimistic concurrency in the same transaction.

**Input prerequisites:** [F07.1.b](2026-10-01-pathway-language-level-3-story-spec.md#f07-1-b).

**Boundary:** No real clinical order side effects or distributed transaction platform.

**Completion evidence:** Two repeated identical requests produce one plan; same key with a different payload is rejected. Concurrent requests never mix revision evidence or create duplicate plans; changed scope/evidence invalidates the stale transaction.

**Executable components:** [F07.2.a Return one result for repeated submission](2026-10-01-pathway-language-level-3-story-spec.md#f07-2-a), [F07.2.b Reject stale and concurrent revisions](2026-10-01-pathway-language-level-3-story-spec.md#f07-2-b).

## A01 — Make incomplete authoring and policy visible

Parent: [A01](2026-10-01-pathway-language-level-1-behavioral-slices.md#a01). Stage A trace: B-02, B-14, B-18, B-24; C-03.

<a id="a01-1"></a>

### A01.1 — Typed holes and preview-only artifacts

**Problem statement:** Given a missing typed clinical constant in an otherwise valid source, preview incomplete outputs without publishing them.

**High-level work:** Extend the AST/result domain and share the evaluator kernel.

**Input prerequisites:** [F04.2.b](2026-10-01-pathway-language-level-3-story-spec.md#f04-2-b), [F07.1.a](2026-10-01-pathway-language-level-3-story-spec.md#f07-1-a).

**Boundary:** No substituting patient Unknown for authoring incompleteness.

**Completion evidence:** Dependent preview shows hole; a wrong-type hole rejects; no patient Need is emitted for the hole. Unvisited hole still blocks publication; relabeling preview/synthetic context cannot authorize clinical finalization.

**Executable components:** [A01.1.a Propagate a well-typed hole](2026-10-01-pathway-language-level-3-story-spec.md#a01-1-a), [A01.1.b Reject promotion of incomplete preview](2026-10-01-pathway-language-level-3-story-spec.md#a01-1-b).

<a id="a01-2"></a>

### A01.2 — Rationale and bounded policy

**Problem statement:** Given reviewed content or effective policy changes, invalidate affected review or reject unauthorized policy composition.

**High-level work:** Implement one scalar bound and mandatory-check/permission composition with tests.

**Input prerequisites:** [A01.1.b](2026-10-01-pathway-language-level-3-story-spec.md#a01-1-b), [F06.2.b](2026-10-01-pathway-language-level-3-story-spec.md#f06-2-b).

**Boundary:** No policy scripting or full approval-management UI.

**Completion evidence:** Executable hash may stay fixed; prior content approval cannot silently cover the changed rationale. Out-of-bound specialization fails; required check survives lower-tier omission; permissions cannot widen.

**Executable components:** [A01.2.a Track reviewed rationale independently of behavior](2026-10-01-pathway-language-level-3-story-spec.md#a01-2-a), [A01.2.b Resolve one bounded policy artifact](2026-10-01-pathway-language-level-3-story-spec.md#a01-2-b).

## M01 — Initiate one reviewed medication through choice and safety

Parent: [M01](2026-10-01-pathway-language-level-1-behavioral-slices.md#m01). Stage A trace: B-05, B-16, B-17, B-18, B-23; C-02.

<a id="m01-1"></a>

### M01.1 — Fixed medication payload and required safety result

**Problem statement:** Given a reviewed fixed action and recorded safety evidence, produce a typed proposal with a distinct safety state.

**High-level work:** Use synthetic safety inputs until validated adapters exist.

**Input prerequisites:** [A01.2.b](2026-10-01-pathway-language-level-3-story-spec.md#a01-2-b), [F07.2.b](2026-10-01-pathway-language-level-3-story-spec.md#f07-2-b).

**Boundary:** No knowledge-base integration or dose calculation.

**Completion evidence:** Action identity survives round-trip; incompatible dose units or missing formulation required by the contract fail. Unmapped allergy is not clear; complete scoped negative is traceable; incomplete scope cannot finalize.

**Executable components:** [M01.1.a Represent one fixed medication proposal](2026-10-01-pathway-language-level-3-story-spec.md#m01-1-a), [M01.1.b Apply clear versus incomplete allergy coverage](2026-10-01-pathway-language-level-3-story-spec.md#m01-1-b).

<a id="m01-2"></a>

### M01.2 — Known findings and interaction coverage

**Problem statement:** Given allergy/interaction findings for the supported candidate/current therapies, preserve holds and incomplete safety explanations.

**High-level work:** Add each required assessment independently, then compose required safety states.

**Input prerequisites:** [M01.1.b](2026-10-01-pathway-language-level-3-story-spec.md#m01-1-b).

**Boundary:** No inferred safety from a medication name or missing chart rows.

**Completion evidence:** Known exclusion/hold stays visible even with unrelated unknown; acknowledgement alone cannot clear it. An unavailable knowledge source or incomplete current-therapy coverage is unresolved; known finding is preserved.

**Executable components:** [M01.2.a Withhold for an established required safety finding](2026-10-01-pathway-language-level-3-story-spec.md#m01-2-a), [M01.2.b Require scoped interaction assessment](2026-10-01-pathway-language-level-3-story-spec.md#m01-2-b).

<a id="m01-3"></a>

### M01.3 — One-of selection, refusal and consent

**Problem statement:** Given two eligible candidates and recorded human inputs, separate selection, refusal, consent and readiness.

**High-level work:** Use explicit recorded inputs and no default winner.

**Input prerequisites:** [M01.2.b](2026-10-01-pathway-language-level-3-story-spec.md#m01-2-b).

**Boundary:** No bundle choices or automatically selected alternative.

**Completion evidence:** No selection yields Need; selecting ineligible candidate rejects; valid single selection does not erase the other candidate trace. Refusal is not Unknown/no-response; it never satisfies consent or silently selects B; valid consent satisfies only its own requirement.

**Executable components:** [M01.3.a Select exactly one of two medication candidates](2026-10-01-pathway-language-level-3-story-spec.md#m01-3-a), [M01.3.b Distinguish refusal from consent and ineligibility](2026-10-01-pathway-language-level-3-story-spec.md#m01-3-b).

<a id="m01-4"></a>

### M01.4 — Safety changes after selection and review

**Problem statement:** Given a selected/reviewed action with changed safety evidence, invalidate review and return the next explicit decision need.

**High-level work:** Integrate medication result into the existing finalization path.

**Input prerequisites:** [F07.2.b](2026-10-01-pathway-language-level-3-story-spec.md#f07-2-b), [M01.3.b](2026-10-01-pathway-language-level-3-story-spec.md#m01-3-b).

**Boundary:** No automatic switch or second finalization mechanism.

**Completion evidence:** B never becomes selected by evaluation; authorized later selection creates a new input/review cycle. Clear selected action commits once in test mode; changed safety blocks old review and leaves no partial scope write.

**Executable components:** [M01.4.a Do not reselect after a safety hold](2026-10-01-pathway-language-level-3-story-spec.md#m01-4-a), [M01.4.b Run medication review through sandbox finalization](2026-10-01-pathway-language-level-3-story-spec.md#m01-4-b).

## T01 — Use explicit time for one follow-up

Parent: [T01](2026-10-01-pathway-language-level-1-behavioral-slices.md#t01). Stage A trace: B-06, B-10, B-12, B-13, B-19, B-20; C-01, E-01.

<a id="t01-1"></a>

### T01.1 — Clock and one interval

**Problem statement:** Given known instants and declared endpoint semantics, evaluate a fixed time predicate deterministically.

**High-level work:** Normalize supported instants and preserve timestamp roles.

**Input prerequisites:** [F05.2.a](2026-10-01-pathway-language-level-3-story-spec.md#f05-2-a), [F06.1.b](2026-10-01-pathway-language-level-3-story-spec.md#f06-1-b).

**Boundary:** No fabricated precision for partial dates.

**Completion evidence:** Exact endpoints match contract; implicit wall-clock reads are absent; malformed/partial evidence stays explicit. Boundary-valid response can fulfill; expired response cannot; old replay retains original clock result.

**Executable components:** [T01.1.a Evaluate one explicit fixed window](2026-10-01-pathway-language-level-3-story-spec.md#t01-1-a), [T01.1.b Validate response expiry against the pinned clock](2026-10-01-pathway-language-level-3-story-spec.md#t01-1-b).

<a id="t01-2"></a>

### T01.2 — Completion anchors and stable due state

**Problem statement:** Given a specific course-completion event, establish one immutable follow-up instance and evaluate due status.

**High-level work:** Keep event identity, action identity and occurrence separate.

**Input prerequisites:** [F05.2.a](2026-10-01-pathway-language-level-3-story-spec.md#f05-2-a), [T01.1.a](2026-10-01-pathway-language-level-3-story-spec.md#t01-1-a).

**Boundary:** No repeated schedules or rescheduling implementation.

**Completion evidence:** Order alone cannot create completed anchor; wrong course rejects; valid completion creates source-linked deadline. Later encounter does not shift due date; completed/cancelled event changes progress only under its contract.

**Executable components:** [T01.2.a Anchor a follow-up to actual completion](2026-10-01-pathway-language-level-3-story-spec.md#t01-2-a), [T01.2.b Keep deadline fixed through new encounters](2026-10-01-pathway-language-level-3-story-spec.md#t01-2-b).

<a id="t01-3"></a>

### T01.3 — Planning versus performance and expiration

**Problem statement:** Given an established action with separate timing attributes, show advance planning permission without implying performance readiness.

**High-level work:** Expose distinct fields in result/API and review materiality.

**Input prerequisites:** [F07.1.a](2026-10-01-pathway-language-level-3-story-spec.md#f07-1-a), [T01.2.b](2026-10-01-pathway-language-level-3-story-spec.md#t01-2-b).

**Boundary:** No automatic EHR renewal or indefinite clinical permission.

**Completion evidence:** Advance proposal does not imply action performed; soft overdue does not suppress independently authored stop/reassessment. Order expiry cannot silently change clinical eligibility; clinical stop prevents performance readiness despite a later external expiry.

**Executable components:** [T01.3.a Separate planning from performance](2026-10-01-pathway-language-level-3-story-spec.md#t01-3-a), [T01.3.b Separate external expiry from clinical stop](2026-10-01-pathway-language-level-3-story-spec.md#t01-3-b).

<a id="t01-4"></a>

### T01.4 — Freshness and multi-anchor admissibility

**Problem statement:** Given a culture result with collection, completion and assessment times, evaluate query-specific suitability and preserve rejected candidates.

**High-level work:** Compose two existing time predicates; do not introduce a special interpreter.

**Input prerequisites:** [F03.2.b](2026-10-01-pathway-language-level-3-story-spec.md#f03-2-b), [T01.1.a](2026-10-01-pathway-language-level-3-story-spec.md#t01-1-a), [T01.1.b](2026-10-01-pathway-language-level-3-story-spec.md#t01-1-b), [T01.2.b](2026-10-01-pathway-language-level-3-story-spec.md#t01-2-b).

**Boundary:** No global expired flag or inferred negative result.

**Completion evidence:** Receipt cannot replace collection; historical query can accept what current query excludes; no usable result stays unresolved. Unknown anchor or stale result stays explicit; a reviewed unavailable contingency is distinct from clinical negative; corrected collection time produces a new revision.

**Executable components:** [T01.4.a Use collection time and query freshness](2026-10-01-pathway-language-level-3-story-spec.md#t01-4-a), [T01.4.b Compose completion window with freshness](2026-10-01-pathway-language-level-3-story-spec.md#t01-4-b).

## O01 — Select comparable distinct observations

Parent: [O01](2026-10-01-pathway-language-level-1-behavioral-slices.md#o01). Stage A trace: B-05, B-09, B-11, B-12, B-13, B-15; E-01, E-02.

<a id="o01-1"></a>

### O01.1 — Identity, filtering and latest selection

**Problem statement:** Given candidate observations, select by declared scope/time rules without row-order assumptions.

**High-level work:** Retain correction history and ambiguous candidates.

**Input prerequisites:** [T01.4.a](2026-10-01-pathway-language-level-3-story-spec.md#t01-4-a).

**Boundary:** No source precedence inferred from ingestion order.

**Completion evidence:** Wrong episode or isolate cannot satisfy query; missing required method stays unresolved rather than silently admissible. Correction can change winner; equal-time conflicting candidates remain unresolved; input order does not decide.

**Executable components:** [O01.1.a Filter candidates by episode and measurement context](2026-10-01-pathway-language-level-3-story-spec.md#o01-1-a), [O01.1.b Select definite latest with corrections and ties](2026-10-01-pathway-language-level-3-story-spec.md#o01-1-b).

<a id="o01-2"></a>

### O01.2 — Compatible values and distinct timed pair

**Problem statement:** Given candidate measurements under the approved numeric and timing profiles, evaluate comparable thresholds and the existence of a qualifying distinct pair.

**High-level work:** Reuse type/time operators with explicit pair identity.

**Input prerequisites:** [O01.1.b](2026-10-01-pathway-language-level-3-story-spec.md#o01-1-b), [T01.1.a](2026-10-01-pathway-language-level-3-story-spec.md#t01-1-a).

**Boundary:** No inferencing that multiple duplicate rows establish persistence.

**Completion evidence:** Equivalent unit values compare identically; unsupported conversion or assay compatibility is unresolved with reason. Duplicate identity cannot count twice; exact interval boundaries and uncertain timestamps behave as reviewed; order permutation is invariant.

**Executable components:** [O01.2.a Normalize one approved quantity conversion](2026-10-01-pathway-language-level-3-story-spec.md#o01-2-a), [O01.2.b Establish a separated observation pair](2026-10-01-pathway-language-level-3-story-spec.md#o01-2-b).

<a id="o01-3"></a>

### O01.3 — Coverage and explicit provider precedence

**Problem statement:** Given retrieved/attested evidence and query authority rules, distinguish sufficiency and legitimate precedence without overriding scope.

**High-level work:** Keep source completeness, sampling sufficiency and authority separate.

**Input prerequisites:** [F03.2.a](2026-10-01-pathway-language-level-3-story-spec.md#f03-2-a), [F06.2.b](2026-10-01-pathway-language-level-3-story-spec.md#f06-2-b), [O01.2.b](2026-10-01-pathway-language-level-3-story-spec.md#o01-2-b), [T01.1.b](2026-10-01-pathway-language-level-3-story-spec.md#t01-1-b).

**Boundary:** No generic provider override or synthetic clinical coverage.

**Completion evidence:** A complete sparse snapshot is still insufficient for pairing; one admissible positive may establish existence under incomplete coverage. Valid same-course assertion can govern; expired/wrong-course/wrong-subject request cannot; changed result invalidates review.

**Executable components:** [O01.3.a Distinguish retrieval coverage from sampling sufficiency](2026-10-01-pathway-language-level-3-story-spec.md#o01-3-a), [O01.3.b Apply permitted provider precedence and reject misuse](2026-10-01-pathway-language-level-3-story-spec.md#o01-3-b).

## G01 — Interpret measurements in an explicit pregnancy context

Parent: [G01](2026-10-01-pathway-language-level-1-behavioral-slices.md#g01). Stage A trace: B-07, B-08, B-09, B-13, B-22; E-02.

<a id="g01-1"></a>

### G01.1 — Sourced pregnancy day count

**Problem statement:** Given exact dated reference and approved clinical date basis, compute day count with trace or unresolved dating context.

**High-level work:** Implement date-domain arithmetic separately from elapsed UTC duration.

**Input prerequisites:** [F06.2.b](2026-10-01-pathway-language-level-3-story-spec.md#f06-2-b), [T01.1.a](2026-10-01-pathway-language-level-3-story-spec.md#t01-1-a).

**Boundary:** No full calendar recurrence or implicit timezone conversion.

**Completion evidence:** Day-before/at/after cases are exact; missing/partial reference remains unresolved; episode mismatch rejects. Correction can cross a boundary in new result; replay of earlier bundle returns its earlier dating interpretation.

**Executable components:** [G01.1.a Compute known-date day count](2026-10-01-pathway-language-level-3-story-spec.md#g01-1-a), [G01.1.b Apply a dating correction without rewriting history](2026-10-01-pathway-language-level-3-story-spec.md#g01-1-b).

<a id="g01-2"></a>

### G01.2 — Lookup and context time

**Problem statement:** Given a reviewed interval-keyed clinical table and derived context, select the right entry at collection or assessment time.

**High-level work:** Represent table data as a pinned typed library, never a callback.

**Input prerequisites:** [F04.2.b](2026-10-01-pathway-language-level-3-story-spec.md#f04-2-b), [G01.1.a](2026-10-01-pathway-language-level-3-story-spec.md#g01-1-a), [G01.1.b](2026-10-01-pathway-language-level-3-story-spec.md#g01-1-b), [O01.2.b](2026-10-01-pathway-language-level-3-story-spec.md#o01-2-b).

**Boundary:** No unreviewed table values or forced clinical dependency for a demo.

**Completion evidence:** Exact boundaries match approved entries; invalid overlapping table rejects; outside declared coverage stays explicit. Collection-time and now-context variants can differ only as authored; an independent urgent finding stays visible; no rate/acute treatment is executed.

**Executable components:** [G01.2.a Resolve one versioned interval lookup](2026-10-01-pathway-language-level-3-story-spec.md#g01-2-a), [G01.2.b Run E-02 with collection and assessment context](2026-10-01-pathway-language-level-3-story-spec.md#g01-2-b).

## X01 — Compose pathways without hidden merging or scope changes

Parent: [X01](2026-10-01-pathway-language-level-1-behavioral-slices.md#x01). Stage A trace: B-21, B-22, B-27, B-28; C-03, E-01, E-02.

<a id="x01-1"></a>

### X01.1 — Action identity and equivalent proposals

**Problem statement:** Given same-looking actions from different packages, establish equivalence only under the supported identity contract.

**High-level work:** Keep node identity and clinical action equivalence distinct.

**Input prerequisites:** [A01.2.b](2026-10-01-pathway-language-level-3-story-spec.md#a01-2-b), [M01.1.a](2026-10-01-pathway-language-level-3-story-spec.md#m01-1-a), [T01.3.b](2026-10-01-pathway-language-level-3-story-spec.md#t01-3-b).

**Boundary:** No matching by display name or code alone.

**Completion evidence:** Same display text with different dose or timing does not merge; permutation of irrelevant fields preserves key. Reversing package order changes nothing; unresolved required source cannot disappear behind the ready source.

**Executable components:** [X01.1.a Compute canonical action keys](2026-10-01-pathway-language-level-3-story-spec.md#x01-1-a), [X01.1.b Coalesce exact equivalents with all obligations](2026-10-01-pathway-language-level-3-story-spec.md#x01-1-b).

<a id="x01-2"></a>

### X01.2 — Conflicts and whole-scope finalization

**Problem statement:** Given incompatible or not-provably-equivalent proposals, preserve them with explicit conflict/duplication and prevent unjustified finalization.

**High-level work:** Add supported conflict rules without choosing a winning pathway.

**Input prerequisites:** [F07.2.b](2026-10-01-pathway-language-level-3-story-spec.md#f07-2-b), [G01.2.b](2026-10-01-pathway-language-level-3-story-spec.md#g01-2-b), [X01.1.b](2026-10-01-pathway-language-level-3-story-spec.md#x01-1-b).

**Boundary:** No universal medical interaction engine or partial finalization.

**Completion evidence:** Unknown equivalence is not guessed; conflicting required actions block readiness; known not-applicable findings remain distinct. No partial write when one required component unresolved; failed evaluator cannot claim exhaustive no-urgency assessment.

**Executable components:** [X01.2.a Surface unsupported equivalence and declared conflict](2026-10-01-pathway-language-level-3-story-spec.md#x01-2-a), [X01.2.b Finalize the reviewed combined scope only](2026-10-01-pathway-language-level-3-story-spec.md#x01-2-b).

<a id="x01-3"></a>

### X01.3 — Positive authorized handoff

**Problem statement:** Given a reviewed maternal finding requiring newborn-care communication, produce and track a typed handoff without a recipient-patient order.

**High-level work:** Treat role/service communication as an obligation with separate acknowledgment.

**Input prerequisites:** [F04.1.b](2026-10-01-pathway-language-level-3-story-spec.md#f04-1-b), [F05.2.a](2026-10-01-pathway-language-level-3-story-spec.md#f05-2-a), [T01.1.b](2026-10-01-pathway-language-level-3-story-spec.md#t01-1-b), [X01.1.a](2026-10-01-pathway-language-level-3-story-spec.md#x01-1-a).

**Boundary:** No automated messaging, neonatal prescription or implicit completion.

**Completion evidence:** Positive finding produces proposal; unknown recipient patient cannot become an order target; creating proposal is not communication. Correct acknowledgment fulfills communication only; wrong context does not; no neonatal action completion is inferred.

**Executable components:** [X01.3.a Propose one typed handoff](2026-10-01-pathway-language-level-3-story-spec.md#x01-3-a), [X01.3.b Fulfill only the handoff communication obligation](2026-10-01-pathway-language-level-3-story-spec.md#x01-3-b).

<a id="x01-4"></a>

### X01.4 — Operational readiness without changing clinical indication

**Problem statement:** Given an indicated referral and an institution-required receiving capability, return separate known or unresolved operational readiness.

**High-level work:** Resolve a scoped facility attestation through the existing evidence/Need contracts.

**Input prerequisites:** [A01.2.b](2026-10-01-pathway-language-level-3-story-spec.md#a01-2-b), [F05.2.a](2026-10-01-pathway-language-level-3-story-spec.md#f05-2-a), [T01.1.b](2026-10-01-pathway-language-level-3-story-spec.md#t01-1-b).

**Boundary:** No live scheduling, institution microservice or assumption that policy proves availability.

**Completion evidence:** Institutional requirement alone is not availability; wrong-facility attestation rejects; valid evidence satisfies only readiness and does not mark referral delivered.

**Executable components:** [X01.4.a Evaluate and fulfill a facility-readiness requirement](2026-10-01-pathway-language-level-3-story-spec.md#x01-4-a).
