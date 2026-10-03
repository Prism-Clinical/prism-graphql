# Evidence-query-to-predicate contract (draft)

**Status:** Proposed design draft. **Not** accepted, not finalized syntax, not a schema and not implemented. It contains no clinical content: the record type, enum values, codes, sources and permission below are fictional and illustrate language behavior only. They do not map to dysphagia, progression, urgency or any other clinical definition.

**Date:** 2026-10-03. **Revised:** 2026-10-03, three times, after review. The third revision fixed three things:

- revision-chain boundaries: source-scoped identity, same-source corrections and one fully specified schematic authority rule;
- deterministic outcomes for malformed history;
- a coverage-combination rule over a declared finite source set, with a minimal fixture format and canonical ordering.

**Authority:** [RFC](../../specs/2026-09-28-pathway-language-rfc.md) (accepted architecture) and [Stage A](../../specs/2026-09-30-pathway-language-stage-a-spec.md) §§2–7 (draft contracts). This document builds on the [minimal GERD language model](gerd-minimal-language-model.md), including its settled behavior for an established alarm with unknown applicability (its §6.1). Where this draft and Stage A disagree, Stage A governs until amended (section 8).

**Problem:** Given a finite frozen evidence snapshot, coverage information, an explicit evaluation context and a declared query contract, specify how PPL produces `Evidence<Boolean>` and how a Predicate consumes it as a `Decision`. Every step that affects the answer must be inspectable and deterministic enough that independent implementations derive the same expected result.

## 1. Evidence entering the boundary

The core receives frozen inputs only (RFC §3; Stage A §4.8, §11.2). Retrieval, pagination, retries and terminology lookups happen in adapters and the orchestrator before evaluation. This section states what the inputs must contain, not how adapters obtain them.

### 1.1 Identity

| Concept | Definition |
|---|---|
| `RecordKey` | `(source, localId)`. Local identifiers are scoped to their source, so `(s1, r30)` and `(s2, r30)` are **unrelated records** |
| `RevisionRef` | `(source, localId, revision)`. All three parts are required. Revision identifiers are opaque: they carry no ordering or recency meaning |
| Revision chain | All revisions and retractions carrying the same `RecordKey` |

**Chain boundary for this demonstration policy:**

- Record type, subject and source are immutable within a chain.
- Corrections and retractions are same-source only: a `supersedes` or retraction target must name the item’s own `RecordKey`.
- An authorized correction may change concept, assertion, episode and encounter.
- Cross-source correction and movement between subjects or record types are unsupported (2.1).

### 1.2 Per-record evidence

Records are instances of a record type declared in a pinned evidence-model library (here the fictional `demo-model@0.1`). A `DemoAssessment` revision has these fields:

| Field | Type | Notes |
|---|---|---|
| `key`, `revision` | `RecordKey`, revision ID | Together they form the `RevisionRef` |
| `recordType`, `subject` | type ID, `SubjectRef` | Required; immutable within a chain |
| `supersedes` | optional `RevisionRef` | A correction of the referenced revision |
| `episode`, `encounter` | `Field<EpisodeRef>`, `Field<EncounterRef>` | Absence is explicit, never defaulted |
| `concept` | `Code` (`system`, `code`) | Matched against a pinned value-set expansion |
| `assertion` | `Field<AssertionValue>` | `Affirmed \| Denied \| Indeterminate` (fictional) |
| `assertionKind` | `AssertionKind` | Fictional: `ClinicianDocumented \| PatientReport` |
| `author` | `{ actor, permissions: Field<Set<Permission>> }` | Permissions are read only for corrections and retractions (1.3) |
| `provenance` | acquisition ID, source record reference | Retained in every trace |

`Field<T> = Present(T) | Absent`. In the fixture notation (7.1), an omitted optional field is `Absent`. A present value of the wrong type, or an enum code outside the pinned enum, is **malformed**.

Retractions are separate items: `Retraction { id, key, target: RevisionRef, author, provenance }`.

### 1.3 Schematic authority rule `demo-policy/same-source-amend@1`

This is a nonclinical demonstration permission, not a production authorization design. A correction or retraction must first pass the structural checks in 2.1, including that its target names its own `RecordKey`. Its authority is then judged from `author.permissions`:

| `author.permissions` | Outcome |
|---|---|
| `Present(set)` containing `demo.permission.amend-record` | **Authorized** |
| `Present(set)` not containing it (including the empty set) | **Unauthorized** (proven) |
| `Absent` | **Authority missing**: undeterminable, cause `Missing` |
| Present but not a set of permission codes | **Authority malformed**: undeterminable, cause `Invalid` |

Unknown permission codes inside a well-formed set are ignored; they neither grant nor block. `demo.permission.amend-record` is declared in `demo-model@0.1` as a fictional, nonclinical permission.

### 1.4 Input envelope

The query contract declares a **finite source set**; the fixture uses `sources: ["s1", "s2"]`. This is a schematic test boundary, not a claim of complete clinical coverage.

The **input envelope** consists of the record type × the context subject × the declared sources, closed over keys. The snapshot must contain every revision and retraction of every `RecordKey` in a declared source that has at least one revision with this record type and subject. Revisions are not pre-filtered by concept, episode or encounter, because an authorized correction may change those. Revisions of an enveloped key that carry another subject or record type are included, so S1 can detect boundary violations.

Items from undeclared sources are outside the envelope and never enter evaluation.

### 1.5 Coverage, failures and snapshots

Every evaluation reads exactly one **current snapshot**. A snapshot may name the snapshot it replaces (`supersedesSnapshot`). That replacement is explicit and is the only form of supersession for coverage and failures: statements inside one snapshot never supersede one another, and input order never decides.

**Statement format** (all statements carry `appliesTo.snapshot`):

| Item | Fields | Dimension semantics |
|---|---|---|
| Coverage statement | `id`, `appliesTo.snapshot`, `recordType`, `subject`, `sources` (nonempty array), `status ∈ {Complete, Incomplete, Unknown}`, `attestedBy` | An omitted or `null` dimension is **unstated (unknown)** |
| Acquisition failure | `id`, `attempt`, `appliesTo.snapshot`, `outcome ∈ {Failed, TimedOut, Refused}`; optional `recordType`, `subject`, `sources`, `valueSet`, `episode`, `encounter` | Omitted means unknown |
| Rejected item | `id`, `appliesTo.snapshot`, `reason`; optional `recordType`, `subject`, `sources` | Omitted means unknown |

A statement whose `appliesTo.snapshot` is not the current snapshot is **not current**: it is traced and ignored. A coverage statement with an unrecognized `status`, or otherwise malformed, is **malformed**: it is treated as `Unknown` for every cell it might affect, and it adds `Invalid`.

**Combination per cell.** Each declared source *s* defines a cell *c* = (record type, context subject, *s*).

- A current statement **establishes** *c* if its status is `Complete` and all three dimensions are stated and match *c*.
- A current statement **affects** *c* if its status is `Incomplete` or `Unknown` (or it is malformed) and no stated dimension excludes *c*.

The cell status is the first rule that applies:

1. Any affecting `Incomplete`: **Incomplete**.
2. Otherwise, any affecting `Unknown` or malformed statement: **Unknown**.
3. Otherwise, any establishing statement: **Complete**.
4. Otherwise: **Absent**, treated exactly as `Unknown`.

A `Complete` statement therefore never overrides a contradiction or a known gap. When rules 1 or 2 apply while an establishing statement also exists, the trace records a **contradictory-attestation** diagnostic. A `Complete` statement with an unstated dimension establishes nothing and is traced as insufficiently scoped.

| Combination for one source | Cell status |
|---|---|
| `Complete` + `Incomplete` | Incomplete (contradiction traced) |
| `Complete` + `Unknown` | Unknown (contradiction traced) |
| Broad `Complete {s1, s2}` + narrower `Incomplete {s2}` | s1 Complete, s2 Incomplete |
| Narrower `Complete {s1}` + broad `Unknown {s1, s2}` | s1 Unknown, s2 Unknown |
| Declared source with no statement | Absent (= Unknown) |
| `Complete` + current failure for that source | Cell Complete, but the failure is its own gap (4.1) |

**Current gaps versus attempt history.** Only failures listed in the current snapshot are current gaps. A failure from an earlier snapshot is **attempt history**. It is retained in the earlier session revision and in the Need state (6.3) and is never deleted, but it is not a gap in a later snapshot that supersedes it. A failure stops representing a current gap only when a new snapshot replaces the one that listed it; a later `Complete` statement alone does not remove it.

**Acquisition completeness is not an explicit negative.** Cells being `Complete` with no supporting or refuting record means only that nothing relevant was recorded. Under this policy that yields `Unresolved{Missing}`, never `false` (4.2, rule 5).

### 1.6 Evaluation context

`subject`, `episode: Known(EpisodeRef) | Unknown(causes)`, `encounter: Known(EncounterRef) | Unknown(causes)`, the pinned evaluation clock and the execution mode (`clinical | preview | nonclinical`), supplied by the orchestrator and recorded in the session revision.

An `episode` may come from an evaluated declaration through an explicit, acyclic reference. In that case its `Unknown` causes, e.g. `Conflicting`, carry through unchanged. Pathway applicability *A* is a separate `Decision`. The query never reads *A* unless the author writes an explicit reference and *A* does not depend on the query.

### 1.7 Data problems versus program problems

| Problem | Example | Class | Cause |
|---|---|---|---|
| Field absent | `assertion` missing | Patient evidence | `Missing` (3.4) |
| Field malformed | `assertion = "Maybe"`; a syntactically invalid code | Patient evidence | `Invalid` |
| Terminology information unavailable | A well-formed code from a system the pinned expansion does not cover | Patient evidence | `Unavailable` (S2) |
| Malformed or contradictory revision history | Missing target, fork, self-supersession, cycle, boundary violation, undeterminable authority | Patient evidence | Per 2.1 (`Missing`, `Conflicting`, `Invalid`) |
| Unparseable item or uninterpretable type version | No key; `demo-model@0.2` | Patient evidence (snapshot) | Rejected item; `Invalid` if relevant |
| Wrong-type expression, unknown field, executable-dependency cycle | Section 7, case 51 | **Invalid program** | Compilation fails |

A cycle in patient revision history is malformed *data*, handled in S1. A cycle in the authored executable dependency graph is a compile error (§6.3). No stage invents a default for missing patient information.

## 2. Processing boundaries

The stages follow Stage A §4.4’s order: identities and correction/retraction authority and history first, then concept and scope admissibility, then precedence and sufficiency. Authored criterion evaluation sits between selection and resolution. Every stage is a function of *sets* keyed by identity, and every item keeps a recorded stage and reason in the trace.

| # | Stage | Inputs | Outputs | Kind |
|---|---|---|---|---|
| S1 | Identity and revision history | The whole envelope (revisions and retractions), before any semantic filter; authority rule 1.3 | Per `RecordKey`: `Current(rev) \| Retracted \| NoRecord \| UnresolvedRevision(causes, possibleCurrent)`, plus rejected items with reasons (2.1) | Fixed behavior; authority is a versioned schematic rule |
| S2 | Candidate identification | S1; pinned value-set expansion | For each possible current revision: in domain, out of domain, or candidacy unresolved (`Unavailable` for an uncovered code system, `Invalid` for a malformed code). `excluded` stays excluded; `unknown` stays possible-in-domain. A key is a candidate if any possible current could be in domain | Fixed behavior over pinned parameters |
| S3 | Admissibility | Candidates; context; authored rules (2.2) | Per candidate revision: `Admissible \| Inadmissible(reasons) \| UnresolvedAdmissibility(causes)` with origin causes | Fixed semantics over authored rules |
| S4 | Selection | S3 | `selected` = keys whose single current revision is `Admissible`; `unresolved` = keys with unresolved history, candidacy or admissibility; inadmissible keys retained | Policy `explicit-assertion-v0` |
| S5 | Criterion evaluation | `selected`, `unresolved`; `establishes`, `refutes` | Classification per revision (3.3); unresolved keys are classified only to judge materiality | Authored expressions; fixed rule |
| S6 | Sufficiency and resolution | S5; coverage cells; current failures; rejected items | `Evidence<Boolean>` (§4.1); Need state (6.3) | Policy `explicit-assertion-v0` |
| S7 | Projection | `Evidence<Boolean>` | `Decision` (5.2) | Fixed |

### 2.1 S1: revision history, deterministically

S1 runs per `RecordKey` over a finite graph and always terminates. Its cycle detection is a strongly-connected-component analysis bounded by the snapshot size limits of §11.3.

**Step 1 — nodes.** Rows with the same `RevisionRef` and identical payload form one node. Rows with the same `RevisionRef` and different payloads become separate nodes, and the key gets cause `Conflicting`.

**Step 2 — boundary check.** If any revision of the key has a record type or subject different from the envelope’s, the key gets cause `Invalid`. Those revisions are rejected and preserved with reason `SubjectChanged` or `RecordTypeChanged`, and the addition `excluded` is recorded. The key’s true owner is unknown, so it might not belong in this query.

**Step 3 — correction edges.** Each non-rejected revision with `supersedes` produces an edge; revisions rejected in step 2 produce none. Each edge is classified by the first row that matches:

| Edge condition | Classification | Effect |
|---|---|---|
| `supersedes` absent fields (e.g. no `source`) | Defective, `Missing` | Edge ignored; the correcting revision stays a node |
| `supersedes` malformed | Defective, `Invalid` | Edge ignored |
| Names another `RecordKey` (cross-source or other local ID) | Proven invalid (cross-boundary), `Invalid` | The correcting revision is rejected and preserved (`CrossKeyCorrection`). Target key, if in the envelope, gets `Invalid` and addition `excluded`. The correcting revision is not a node of its own key |
| Names itself | Defective, `Invalid` | Edge ignored |
| Target revision absent from the snapshot | Defective, `Missing` | Edge ignored; addition `unknown` (the unseen chain could hold anything) |
| Authority unauthorized (1.3) | Proven unauthorized | The correcting revision is rejected and preserved (`Unauthorized`); no cause; the target is unaffected |
| Authority missing / malformed (1.3) | Undeterminable, `Missing` / `Invalid` | Edge ignored; both target and correction remain possible |
| Otherwise | **Valid** | Target is superseded |

**Step 4 — cycles.** Valid edges lying on a cycle, i.e. inside a strongly connected component with more than one node, are reclassified as defective, `Invalid`, and ignored.

**Step 5 — heads.** Heads are the non-rejected nodes not superseded by any valid edge. More than one head without any other defect means a fork, with cause `Conflicting`.

**Step 6 — retractions.** Each retraction is judged against the same checks:

| Retraction condition | Effect |
|---|---|
| Target fields absent / malformed | The retraction cannot be attributed; it is a rejected item (`Missing` / `Invalid` gap) whose dimensions are its known fields |
| Target in another key than the retraction’s own `key` | Proven invalid (cross-boundary). Preserved; target key, if in the envelope, gets `Invalid` + `excluded` |
| Target key not in the envelope | Traced only |
| Target revision absent | `Missing` + `excluded` |
| Unauthorized | Rejected, preserved, no effect |
| Authority missing / malformed | `Missing` / `Invalid` + `excluded` |
| Valid, target is a head | That head is removed (no reinstatement of earlier revisions) |
| Valid, target is superseded | No effect; traced |

**Step 7 — result.** Write *H* for the remaining heads, *X* for the additions and *C* for the accumulated causes.

| Condition | Result |
|---|---|
| No non-rejected node, *C* empty, *X* empty (e.g. the key’s only revision was a rejected cross-key correction) | **No record**: not a candidate; traced only |
| *C* empty, *X* empty, \|*H*\| = 1 | `Current(h)` |
| *C* empty, *X* empty, nodes exist, *H* empty (all heads retracted) | `Retracted` |
| Otherwise | `UnresolvedRevision(C, possibleCurrent = H ∪ X)` |

`excluded` means “possibly not a current record for this query”; `unknown` means “possibly a current revision with any content”. No current revision is ever chosen by input order, revision-ID order or recency.

Rejected and superseded revisions are kept in the trace with reasons. A `Complete` cell claim alongside a missing target in that cell is also traced as a contradictory attestation.

### 2.2 S3 admissibility rules in this example

- `subject` equals the context subject, else `Inadmissible(WrongSubject)`. This cannot arise after S1’s boundary check, but the rule is kept for completeness.
- `episode` equals the context episode, with no prior-episode history (§4.7).
  - The record’s field is absent: `UnresolvedAdmissibility(Missing)`.
  - The context episode is `Unknown(causes)`: `UnresolvedAdmissibility(causes)`.
  - A different known episode: `Inadmissible(OtherEpisode)`.
- `encounter`: the same rule, with reason `OtherEncounter`.
- `assertionKind` must be in the authored set, else `Inadmissible(AssertionKindNotAllowed)`.

Causes from several unresolved rules accumulate. “Unresolved admissibility” is a stage outcome; the causes stay those of the underlying input.

## 3. Where the clinical expression lives

### 3.1 Criteria are expressions in source

The contract carries two authored criteria, each a `Decision` over one candidate revision:

- `establishes(c)`: the revision is positive evidence.
- `refutes(c)`: the revision is an explicit negative.

Both are typed expression trees in the canonical source (Stage A §2.2). Prose, callbacks and opaque classifiers are compile errors. The supported fragment for this contract is typed field access `c.f`, enum literals, `==` between the same enum type (§6.5, §12), `all`/`any`/`not` (§4.3), and `call` of a pinned library expression.

### 3.2 Binding environment and result type

| Name | Type | Source |
|---|---|---|
| `c` | `DemoAssessment` (read-only) | The candidate revision |
| Enum literals | e.g. `AssertionValue.Affirmed` | Pinned evidence-model library |
| Library expressions | Declared signature, e.g. `(DemoAssessment) → Decision` | Pinned library version |

The criteria cannot read the context, other candidates, other queries or *A*. Result type: `Decision`.

**Library references.** `{ "call": "lib.demo.isAffirmed", "version": "1.2.0", "args": [{ "var": "c" }] }` resolves at compile time to a non-recursive declaration (§2.1) with a declared signature and *read set*. The manifest pins its version and digest (§12.1). Traces name both the call site and the definition. A version change changes the reviewed artifact identity.

**Compiler-visible dependencies.** The query’s data requirement is the envelope plus the union of field read sets of S1 (`key`, `revision`, `supersedes`, `recordType`, `subject`, `author.permissions`), the admissibility rules, both criteria and every called library expression. A criterion that reads an undeclared field fails compilation.

### 3.3 Classification rule (S5)

| `establishes(c)` | `refutes(c)` | Classification |
|---|---|---|
| True | False | `Supporting` |
| False | True | `Refuting` |
| False | False | `NonInformative` |
| Unknown (either) | — | `Unclassified(causes)` |
| True | True | Prevented by a compile-time obligation |

For this policy only, the contract declares `disjoint(establishes, refutes)`. With enum-equality criteria it is decided by the v0 finite-enum disjointness analysis (§6.5). An `INCONCLUSIVE` result blocks publication, and a runtime overlap is an engine invariant violation, never patient conflict. This obligation is not proposed as a universal requirement for future evidence contracts.

### 3.4 Absent fields versus false comparisons

| `assertion` | `== Affirmed` | `== Denied` | Classification |
|---|---|---|---|
| `Present(Affirmed)` | True | False | Supporting |
| `Present(Denied)` | False | True | Refuting |
| `Present(Indeterminate)` | False | False | NonInformative |
| `Absent` | Unknown(Missing) | Unknown(Missing) | Unclassified(Missing) |
| Malformed | Unknown(Invalid) | Unknown(Invalid) | Unclassified(Invalid) |

**Failing the positive criterion is not a negative.** `not(c.assertion == Affirmed)` is True for `Indeterminate` and Unknown for `Absent`. An explicit negative is therefore authored separately as `refutes`, and only `Refuting` contributes to `Known(false)`.

## 4. One strict demonstration policy: `explicit-assertion-v0`

`explicit-assertion-v0` is **one strict demonstration policy**. It is not the default for clinical queries, and other queries may need other, separately specified policies.

**Question it answers:** do the admissible assertions in scope establish a value *without contradiction*? It is not an existence query. It has no authority precedence and no authoritative-assertion exception; those would need a separate policy.

**Selection.** Every admissible candidate counts equally. There is no “latest wins”, no source or author precedence and no frequency weighting.

### 4.1 Gaps and relevance

**Gaps** are:

- every envelope cell whose combined status is not `Complete` (1.5): `InsufficientEvidence`, plus `Invalid` if a malformed statement contributed;
- every current acquisition failure: `Unavailable`;
- every current rejected item, including unattributable retractions: `Invalid`, or `Missing` for an unattributable retraction with absent target fields.

Coverage-cell gaps lie inside the envelope and are always relevant. A failure or rejected item is **irrelevant** only if a stated dimension proves it disjoint from the envelope:

| Dimension | Proves irrelevance when… |
|---|---|
| Record type | Stated and different (record type is immutable within a chain) |
| Subject | Stated and different (subject is immutable; the envelope is key-closed) |
| Sources | Stated and disjoint from the declared source set (corrections are same-source only) |
| Value set, episode, encounter | **Never**: an authorized correction may move a record across them |

An unstated dimension proves nothing. Everything not proven irrelevant is relevant, and irrelevant items are traced only.

### 4.2 Resolution

*S* and *R* are the `Supporting` and `Refuting` revisions among `selected`, and *G* is the set of relevant gaps. **Unresolved records** are the S4 `unresolved` keys plus any selected key classified `Unclassified`.

**Step A — base result.** Unresolved records are excluded from *S* and *R*, but they count as seen.

1. *S* and *R* both nonempty: `Unresolved{Conflicting}`.
2. *S* nonempty, *R* empty, *G* empty: `Known(true, S)`.
3. *R* nonempty, *S* empty, *G* empty: `Known(false, R)`.
4. Exactly one of *S*, *R* nonempty, and *G* nonempty: `Unresolved` (causes from step C).
5. *S* and *R* both empty: `Unresolved`, with base causes:
   - `Missing` if no in-domain record was seen at all: no current or possible-current revision in domain. This covers an empty snapshot, everything retracted and everything corrected out of domain.
   - `Inadmissible` if an inadmissible candidate was seen.
   - `InsufficientEvidence` if a non-informative record was seen, or an unresolved record that could only be non-informative or excluded.

**Step B — unresolved records.** A record *u*’s possible classes are:

- `excluded`, if a possible current is out of domain, inadmissible, rejected or `excluded`;
- the S5 class of each possible current that could be selected;
- every class, if any possible current is `unknown` or `Unclassified`.

| Base result | *u* is material when its possible classes include… | Effect |
|---|---|---|
| `Known(true)` | `Refuting` | Result becomes `Unresolved` |
| `Known(false)` | `Supporting` | Result becomes `Unresolved` |
| `Unresolved` (including `Conflicting`) | `Supporting` or `Refuting` | Stays `Unresolved`; *u*’s causes added |

**Step C — causes.** An `Unresolved` result’s cause set is the union of:

- the base causes;
- every relevant gap’s causes;
- every material *u*’s origin causes, attributed to its record and stage.

An established conflict stays `Conflicting`, with the other causes added. Immaterial records and irrelevant gaps add nothing and stay in the trace.

**Why symmetric.** An unread relevant source could hold the opposing assertion and turn either result into `Conflicting`. So a relevant gap blocks both `Known(true)` and `Known(false)`. Stage A §4.2’s statement about positive existence describes existence queries and is not used here. For negatives, this policy requires an explicit `Refuting` record **and** no relevant gap, which is within §4.2’s requirement of sufficient coverage or an authorized explicit negative.

Consequence: a `Known` result requires every declared source’s cell to be `Complete` and no relevant failure or rejected item.

**Determinism.** Every rule reads sets keyed by identity, classifications, cell statuses and stated gap dimensions. No rule reads input order or revision-ID order. Section 7.4 lists the invariance checks.

### 4.3 Cases the policy answers

| Situation | Result |
|---|---|
| One supporting assertion, no relevant gap | `Known(true)` |
| One explicit negative, no relevant gap | `Known(false)` |
| Repeated consistent assertions | `Known` with every distinct ID; count adds no weight |
| Contradictory admissible assertions | `Unresolved{Conflicting}` plus other relevant causes |
| No supporting or refuting assertion, even with `Complete` coverage | `Unresolved` (rule 5), never `false` |
| Material unresolved record (including malformed history) | `Unresolved` with its origin causes |
| Relevant gap | Blocks either `Known` result |
| Proven-irrelevant gap or out-of-envelope item | No effect |

**Unsupported by this policy** (rejected at compile time if requested): temporal windows and freshness; latest selection; source or authority tiers; decisive authoritative assertions; provider precedence requests (§4.4); tie rules; counts over multiple assertions; scoped absence from coverage; cross-source corrections; subject or record-type moves; terminology mapping beyond the pinned expansion; partial dates; pairing; related subjects; model-extracted observations.

## 5. Typed outputs and traces

### 5.1 `Evidence<Boolean>` (Stage A §4.1, unchanged)

`Known(value, supportingEvidenceIds, provenance) | Unresolved(causes, candidateEvidenceIds)`. No new cause is introduced. Each cause is attributed in the trace to its origin: a revision, key, cell, failure, rejected item or context input, together with the stage and reason. The trace records:

- the envelope, retrieve parameters and pinned versions;
- per key: nodes, edges and their classification, rejections, heads, additions and the S1 result;
- per revision: candidacy, admissibility and reasons, selection, criterion values with sub-expressions, classification, possible classes and materiality;
- per cell: contributing statements, combined status and contradiction diagnostics;
- every failure and rejected item, with its relevance decision and the proving dimension;
- the rule applied.

### 5.2 Projection to `Decision` (S7)

| `Evidence<Boolean>` | `Decision` |
|---|---|
| `Known(true, ids, prov)` | `True`, supported by `ids` |
| `Known(false, ids, prov)` | `False`, supported by `ids` |
| `Unresolved(causes, ids)` | `Unknown(causes)`, with `ids` and the same attribution |

`p = evidenceValue(ref q)` adds and removes nothing. Composition such as `finding = all(A, p)` keeps `p`’s value, causes and trace (§4.3; minimal model §6.1).

### 5.3 Canonical ordering (representation only)

These orderings exist only so expected traces and lists compare byte-for-byte. They never influence candidacy, selection, classification or resolution.

| Item | Order |
|---|---|
| `RecordKey` | `(source, localId)`, by Unicode code point |
| `RevisionRef` | `(source, localId, revision)`, by code point. Revision order is **not** recency |
| Causes | Stage A §4.1 order: `Missing`, `Conflicting`, `Unavailable`, `Invalid`, `Inadmissible`, `InsufficientEvidence` |
| Attribution entries | By cause order, then origin reference |
| Gaps | Coverage cells (by source), then failures (by `id`), then rejected items (by `id`) |
| Trace records | By stage (S1–S7), then by key or revision reference |

## 6. Authoring holes versus patient uncertainty

### 6.1 By boundary

| Situation | S1–S2 | S3–S4 | S5 | S6–S7 | Preview | Need | Publication |
|---|---|---|---|---|---|---|---|
| Complete contract, missing patient evidence | Run | Run | Run | `Unresolved` → `Unknown` | Normal result | Yes, when material | Allowed |
| Whole-contract hole | — | — | — | Marker on `q` and dependents; independent outputs computed | Marker | None | Blocked |
| Nested criterion hole | Run | Run | `refutes` runs; `establishes` gives a marker | Marker, not `Unresolved` | S1–S4 and `refutes` traces inspectable | None | Blocked |
| Nested policy hole (e.g. the `episode` rule) | Run | Marker from S3 | Marker | Marker | S1–S2 traces inspectable | None | Blocked |
| Invalid binding or unsupported expression | — | — | — | — | No preview; located diagnostic | None | Blocked |

Holes propagate to dependents only (Stage A §2.3), and markers name their hole IDs. A partly authored query never reports patient uncertainty for its undefined part. A hole never becomes a Need or a provider-facing field.

### 6.2 Needs

**Identity.** The evidence Need for an `Unresolved` complete query has the key (query ID, contract digest, subject, episode binding, encounter binding). In this example the encounter binding is the anchor. The contract digest covers the envelope, declared sources, value-set version, authority rule, admissibility rules, criteria and policy version. The cause is **not** part of the key.

Causes, contributing records, gap diagnostics and the orchestrator’s recorded attempts and outcomes are the Need’s evolving state (Stage A §7). Attempt history from superseded snapshots stays in that state.

**Separate obligations exist only for a different fulfillment requirement.** The explicit example is conflict: a further assessment can never remove an established conflict under this policy, so fulfillment needs an authorized correction or retraction of an existing record. That is a `ResolveConflict` obligation (Need key + kind). `CorrectRecord` (Need key + kind + `RecordKey`) is emitted when a specific record’s own data or history blocks the result. Its fulfillment validation (`fulfilled_by`, §7) remains **deferred**: cases below verify only that it is emitted.

**Unresolved scope.** If a key binding is unresolved, as with a context episode `Unknown(Conflicting)`, no evidence Need is emitted. The scope’s source declaration emits its own Need, linked through the trace.

**Ownership.** The core emits Needs only where backward dependency tracing shows materiality (§4.3, §7). The orchestrator chooses the fulfiller, dispatches it, retries, enforces deadlines and records outcomes, and each outcome creates a new evaluation revision.

### 6.3 Reevaluation sequence

K1 = (`q.demo`, d1, P1, E1, N1).

| Revision | Snapshot | Result | K1 state | Other |
|---|---|---|---|---|
| 1 | snap-1: no records; no coverage statement | `Unresolved{Missing, InsufficientEvidence}` | Opened | — |
| 2 | snap-2 supersedes snap-1: failure f1 (attempt a1, DemoAssessment, P1, s2); still no statement | `Unresolved{Missing, Unavailable, InsufficientEvidence}` | **Same K1**; attempts [a1 Failed] | — |
| 3 | snap-3 supersedes snap-2: a2 succeeds; s1/r1 `Affirmed`, s2/r2 `Denied`; `Complete {s1, s2}`; f1 not listed | `Unresolved{Conflicting}` | **Same K1**; attempts [a1 Failed (history), a2 Succeeded] | `ResolveConflict` opened [s1/r1@1, s2/r2@1] |
| 4 | snap-4: authorized retraction of s2/r2@1 | `Known(true, [s1/r1@1])` | Satisfied | `ResolveConflict` satisfied |
| 5 | Package revised: contract digest d2 | Reevaluated | K1 not reused | A new Need would have key K2 = (`q.demo`, d2, P1, E1, N1) |
| 6 | Encounter N2 under d2 | — | — | Key K3 = (`q.demo`, d2, P1, E1, N2) |

## 7. Fixture format, traces and acceptance cases

### 7.1 Minimal fixture format (proposed notation, not a schema)

```jsonc
// Query contract
{
  "id": "q.demo", "kind": "EvidenceQuery", "output": "Evidence<Boolean>",
  "contract": {
    "retrieve":    { "type": "demo-model/DemoAssessment@0.1", "sources": ["s1", "s2"],
                     "valueSet": "demo-vs/item-x@1" },
    "corrections": { "authority": "demo-policy/same-source-amend@1" },
    "admissible": {
      "episode":   { "eq": [{ "field": ["c", "episode"] },   { "ref": "ctx.episode" }] },
      "encounter": { "eq": [{ "field": ["c", "encounter"] }, { "ref": "ctx.encounter" }] },
      "assertionKind": { "in": ["ClinicianDocumented", "PatientReport"] }
    },
    "policy":      "explicit-assertion-v0",
    "establishes": { "eq": [{ "field": ["c", "assertion"] }, { "enum": "AssertionValue.Affirmed" }] },
    "refutes":     { "eq": [{ "field": ["c", "assertion"] }, { "enum": "AssertionValue.Denied" }] },
    "obligations": [{ "disjoint": ["establishes", "refutes"] }]
  }
}
{ "id": "p.demo", "kind": "Predicate", "expr": { "evidenceValue": { "ref": "q.demo" } } }

// Snapshot fixture
{
  "snapshot": "snap-1", "supersedesSnapshot": null,
  "context": { "subject": "P1", "episode": { "known": "E1" }, "encounter": { "known": "N1" },
               "clock": "2026-01-01T00:00:00Z", "mode": "nonclinical" },
  "records": [{
    "key": { "source": "s1", "localId": "r1" }, "revision": "1",
    "recordType": "demo-model/DemoAssessment@0.1", "subject": "P1",
    "episode": "E1", "encounter": "N1",
    "concept": { "system": "demo-cs", "code": "item-x" },
    "assertion": "Affirmed", "assertionKind": "ClinicianDocumented",
    "author": { "actor": "u1", "permissions": [] },
    "provenance": { "acquisition": "a0" }
    // optional: "supersedes": { "source": "s1", "localId": "r1", "revision": "0" }
  }],
  "retractions": [],   // { "id", "key", "target": RevisionRef, "author", "provenance" }
  "coverage": [{ "id": "cov-all", "appliesTo": { "snapshot": "snap-1" },
                 "recordType": "demo-model/DemoAssessment@0.1", "subject": "P1",
                 "sources": ["s1", "s2"], "status": "Complete", "attestedBy": "demo-adapter@1" }],
  "failures": [],      // { "id", "attempt", "appliesTo", "outcome", ...stated dimensions }
  "rejectedItems": []  // { "id", "appliesTo", "reason", ...stated dimensions }
}
// Context unknowns: "episode": { "unknown": ["Conflicting"] }
```

Shorthand in the tables: `s1/r1@2` is `RevisionRef(s1, r1, 2)`. `+amend` means `permissions: ["demo.permission.amend-record"]`; `perm: []` means `Present({})`; `perm omitted` means `Absent`.

### 7.2 Fixture defaults (D0)

Unless a case says otherwise:

- the query and contract are as in 7.1 (digest d1);
- the context is P1/E1/N1, known, nonclinical, snapshot `snap-1`;
- coverage is **exactly** `cov-all` (`Complete`, DemoAssessment, P1, {s1, s2});
- there are no failures, rejected items or retractions;
- each listed record has source s1, revision `1`, type DemoAssessment, subject P1, E1/N1, concept `demo-cs#item-x`, `ClinicianDocumented`, `perm: []` and no `supersedes`;
- K1 = (`q.demo`, d1, P1, E1, N1).

Coverage-group cases (C) **replace** the coverage list entirely; they never add to `cov-all`.

### 7.3 Manual traces

**Trace A — authorized correction plus an immaterial unresolved record (case 16 variant).**

Records:

| Record | Contents |
|---|---|
| s1/r1@1 | `Denied` |
| s1/r1@2 | `Affirmed`, supersedes s1/r1@1, `+amend` |
| s1/r4@1 | `Affirmed`, encounter omitted |

| Stage | Result |
|---|---|
| S1 | r1: one edge, valid, so `Current(@2)` with @1 superseded. r4: `Current(@1)` |
| S2 | Both in domain |
| S3 | r1@2 `Admissible`; r4@1 `UnresolvedAdmissibility(Missing)` |
| S4 | `selected` {r1}; `unresolved` {r4} |
| S5 | r1 Supporting; r4 possible {excluded, Supporting} |
| S6 | Cells s1 and s2 `Complete`; *G* = ∅. Rule 2 gives `Known(true, [s1/r1@2])`. r4 is immaterial |
| S7 | `True` |

**Trace B — cycle (case 30).**

Records:

| Record | Contents |
|---|---|
| s1/r41@1 | `Affirmed` |
| s1/r41@2 | `Denied`, supersedes @3, `+amend` |
| s1/r41@3 | `Affirmed`, supersedes @2, `+amend` |

| Stage | Result |
|---|---|
| S1 | Edges @2→@3 and @3→@2 pass step 3 but form an SCC, so both become defective (`Invalid`). Heads {@1, @2, @3}; result `UnresolvedRevision({Invalid}, {@1, @2, @3})` |
| S2–S3 | All in domain and admissible |
| S5 | Possible classes {Supporting, Refuting} |
| S6 | Base: no selected record and r41 seen, so rule 5 adds no base cause. r41 is relevant, adding `Invalid` |
| Result | `Unresolved{Invalid}` attributed to s1/r41 history; Decision `Unknown(Invalid)`; K1 plus `CorrectRecord` s1/r41 |

**Trace C — coverage contradiction (case 36).**

Coverage is exactly: `covA = Complete {s1, s2}` and `covB = Incomplete {s2}`. Record: s1/r1@1 `Affirmed`.

| Stage | Result |
|---|---|
| 1.5 | Cell s1: establishes covA, no affecting statement, so `Complete`. Cell s2: affected by covB `Incomplete`, so `Incomplete`, with a contradiction diagnostic against covA |
| S6 | *S* = {r1}; *G* = {cell s2}. Rule 4 gives `Unresolved{InsufficientEvidence}` attributed to cell s2 |

### 7.4 Acceptance cases

All cases start from D0. Every row was traced manually through 1.5, 2.1 and 4.

**A. Assertions and admissibility**

| # | Case | Records / changes | `Evidence<Boolean>` | `Decision` | Trace must show | Need |
|---|---|---|---|---|---|---|
| 1 | Affirmed | s1/r1 `Affirmed` | `Known(true, [s1/r1@1])` | True | Rule 2 | None |
| 2 | Denied | s1/r2 `Denied` | `Known(false, [s1/r2@1])` | False | Rule 3 | None |
| 3 | Repeated consistent + duplicate | s1/r1, s1/r6 `Affirmed`; an identical second row of s1/r1@1 | `Known(true, [s1/r1@1, s1/r6@1])` | True | One node for r1@1 | None |
| 4 | Missing assertion | s1/r3 `assertion` omitted | `Unresolved{Missing}` @s1/r3@1 | Unknown(Missing) | `Unclassified`; all classes | K1; `CorrectRecord` s1/r3 |
| 5 | Empty snapshot | none | `Unresolved{Missing}` | Unknown(Missing) | Coverage `Complete` ≠ negative | K1 |
| 6 | Only non-informative | s1/r7 `Indeterminate` | `Unresolved{InsufficientEvidence}` | Unknown | Rule 5 | K1 |
| 7 | Conflict | s1/r1 `Affirmed`, s2/r2 `Denied` | `Unresolved{Conflicting}` | Unknown(Conflicting) | Rule 1 | K1; `ResolveConflict` |
| 8 | Conflict + relevant failure | Case 7 + failure f1 (DemoAssessment, P1, sources omitted) | `Unresolved{Conflicting, Unavailable}` | Unknown | f1 relevant (sources unstated) | K1; `ResolveConflict` |
| 9 | Only inadmissible | s1/r5 `Denied`, encounter N0 | `Unresolved{Inadmissible}` | Unknown | `OtherEncounter` | K1 |
| 10 | Material unresolved admissibility | s1/r1 `Affirmed`; s1/r4 `Denied`, encounter omitted | `Unresolved{Missing}` @s1/r4@1 | Unknown(Missing) | r4 possible {excluded, Refuting} | K1; `CorrectRecord` s1/r4 |
| 11 | Immaterial unresolved | s1/r1 `Affirmed`; s1/r4 `Affirmed`, encounter omitted | `Known(true, [s1/r1@1])` | True | r4 immaterial | None |
| 12 | Context episode conflicting | s1/r1 `Affirmed`; context episode `{unknown: [Conflicting]}` | `Unresolved{Conflicting}` @context episode | Unknown(Conflicting) | Not rewritten as `Missing`; minimal model §6.1(b) | **No** evidence Need; the episode source’s Need is linked |
| 13 | Terminology unavailable | s1/r10 `Affirmed`, concept system `other-cs` | `Unresolved{Unavailable}` @s1/r10@1 | Unknown | Not `Invalid` | K1 |
| 14 | Malformed code | s1/r15 `Affirmed`, concept code malformed | `Unresolved{Invalid}` @s1/r15@1 | Unknown | Not `Unavailable` | K1; `CorrectRecord` s1/r15 |
| 15 | Multiple causes | Coverage exactly `Complete {s1}` + `Incomplete {s2}`; s1/r1 `Affirmed`; s1/r11 `assertion: "Maybe"`; s1/r4 `Denied`, encounter omitted | `Unresolved{Missing, Invalid, InsufficientEvidence}` | Unknown (same) | `InsufficientEvidence` @cell s2; `Invalid` @r11; `Missing` @r4 | K1; `CorrectRecord` s1/r4, s1/r11 |

**B. Revision history**

| # | Case | Records / changes | `Evidence<Boolean>` | `Decision` | Trace must show | Need |
|---|---|---|---|---|---|---|
| 16 | Authorized same-source correction | s1/r1@1 `Denied`; s1/r1@2 `Affirmed`, supersedes @1, `+amend` | `Known(true, [s1/r1@2])` | True | @1 superseded | None |
| 17 | Proven unauthorized correction | s1/r1@1 `Affirmed`; s1/r1@2 `Denied`, supersedes @1, `perm: []` | `Known(true, [s1/r1@1])` | True | @2 rejected `Unauthorized` | None |
| 18 | Authority missing | As 17, but @2 `perm omitted` | `Unresolved{Missing}` @s1/r1 history | Unknown | Heads {@1, @2}; classes {Supporting, Refuting} | K1; `CorrectRecord` s1/r1 |
| 19 | Authority malformed | As 17, but @2 `permissions: "yes"` | `Unresolved{Invalid}` @s1/r1 history | Unknown | Undeterminable, not unauthorized | K1; `CorrectRecord` s1/r1 |
| 20 | Subject change attempted | s1/r20@1 `Affirmed`; s1/r20@2 supersedes @1, subject P2, `+amend` | `Unresolved{Invalid}` @s1/r20 | Unknown(Invalid) | @2 rejected `SubjectChanged`; possible {@1, excluded} | K1; `CorrectRecord` s1/r20 |
| 21 | Record-type change attempted | As 20, but @2 recordType `demo-model/OtherAssessment@0.1` | `Unresolved{Invalid}` @s1/r20 | Unknown(Invalid) | `RecordTypeChanged` | K1; `CorrectRecord` s1/r20 |
| 22 | Cross-source correction | s1/r1@1 `Affirmed`; s2/r21@1 supersedes s1/r1@1, `+amend` | `Unresolved{Invalid}` @s1/r1 | Unknown(Invalid) | s2/r21@1 rejected `CrossKeyCorrection` (key s2/r21: no record); s1/r1 possible {@1, excluded} | K1; `CorrectRecord` s1/r1 |
| 23 | Same local ID, different sources | s1/r30@1 `Affirmed`; s2/r30@1 `Indeterminate` | `Known(true, [s1/r30@1])` | True | Two unrelated keys; no duplicate or payload conflict | None |
| 24 | Corrected to another concept | s1/r8@1 `Affirmed`; s1/r8@2 supersedes @1, concept `item-y`, `+amend` | `Unresolved{Missing}` | Unknown(Missing) | r8 “corrected out of domain”; @1 is **not** evidence | K1 |
| 25 | Correction changes scope | s1/r16@1 `Affirmed`; s1/r16@2 supersedes @1, `Affirmed`, encounter N0, `+amend` | `Unresolved{Inadmissible}` | Unknown | @2 `OtherEncounter` | K1 |
| 26 | Missing correction target | s1/r9@2 `Affirmed`, supersedes s1/r9@1 (absent), `+amend` | `Unresolved{Missing}` @s1/r9 history | Unknown(Missing) | Addition `unknown`; contradictory attestation for cell s1 | K1; `CorrectRecord` s1/r9 |
| 27 | Same identity, conflicting payloads | Two rows s1/r14@1: `Affirmed` and `Denied` | `Unresolved{Conflicting}` @s1/r14 | Unknown(Conflicting) | Independent of row order | K1; `CorrectRecord` s1/r14 |
| 28 | Fork | s1/r12@1 `Affirmed`; @2a (`Affirmed`, N1) and @2b (`Affirmed`, N0) both supersede @1, both `+amend` | `Unresolved{Conflicting}` @s1/r12 | Unknown(Conflicting) | Heads {@2a, @2b}; possible {Supporting, excluded} | K1; `CorrectRecord` s1/r12 |
| 29 | Self-supersession | s1/r40@1 `Affirmed`, supersedes s1/r40@1, `+amend` | `Unresolved{Invalid}` @s1/r40 | Unknown(Invalid) | Edge defective; heads {@1}; not used as support | K1; `CorrectRecord` s1/r40 |
| 30 | Correction cycle | Trace B | `Unresolved{Invalid}` @s1/r41 | Unknown(Invalid) | SCC {@2, @3} | K1; `CorrectRecord` s1/r41 |
| 31 | Retraction authority unresolved | s1/r42@1 `Affirmed`; retraction x42 of @1, `perm omitted` | `Unresolved{Missing}` @s1/r42 | Unknown(Missing) | Possible {@1, excluded} | K1; `CorrectRecord` s1/r42 |
| 32 | Retracted only | s1/r1@1 `Affirmed`; retraction x1 of @1, `+amend` | `Unresolved{Missing}` | Unknown | `Retracted`; no reinstatement | K1 |
| 33 | Unrelated malformed history | s1/r1 `Affirmed`; s1/r43 @1/@2/@3 all concept `item-y`, with @2↔@3 cycle | `Known(true, [s1/r1@1])` | True | r43 `UnresolvedRevision(Invalid)`, every possible current out of domain, so not a candidate | None |
| 34 | Unrelated key in undeclared source | s1/r1 `Affirmed`; s3/r1@1 `Denied` | `Known(true, [s1/r1@1])` | True | s3 outside the envelope | None |

**C. Coverage and failures** (coverage listed exactly; snapshot `snap-1` unless stated)

| # | Case | Coverage / failures | Records | `Evidence<Boolean>` | Trace must show | Need |
|---|---|---|---|---|---|---|
| 35 | `Complete` + `Incomplete`, same source | covA `Complete {s1}`, covB `Complete {s2}`, covC `Incomplete {s2}` | s1/r1 `Affirmed` | `Unresolved{InsufficientEvidence}` @cell s2 | Cell s2 Incomplete; contradiction diagnostic | K1 |
| 36 | Broad `Complete` + narrower `Incomplete` | Trace C | s1/r1 `Affirmed` | `Unresolved{InsufficientEvidence}` @cell s2 | Cell s1 Complete | K1 |
| 37 | `Complete` + `Unknown`, same source | covA `Complete {s1, s2}`, covB `Unknown {s2}` | s1/r2 `Denied` | `Unresolved{InsufficientEvidence}` @cell s2 | Negative blocked symmetrically | K1 |
| 38 | Narrower `Complete` + broad `Unknown` | covA `Complete {s1}`, covB `Unknown {s1, s2}` | s1/r1 `Affirmed` | `Unresolved{InsufficientEvidence}` @cells s1, s2 | Both cells Unknown | K1 |
| 39 | Absent coverage for a declared source | covA `Complete {s1}` only | s1/r2 `Denied` | `Unresolved{InsufficientEvidence}` @cell s2 | s2 Absent (= Unknown) | K1 |
| 40 | `Complete` statement with unstated subject | covA `Complete {s1, s2}`, subject omitted | s1/r1 `Affirmed` | `Unresolved{InsufficientEvidence}` @cells s1, s2 | covA insufficiently scoped; both cells Absent | K1 |
| 41 | Failure alongside `Complete` | `cov-all`; failure f1 (DemoAssessment, P1, {s2}) | s1/r1 `Affirmed` | `Unresolved{Unavailable}` @f1 | Cell s2 Complete, but f1 is a current gap | K1, attempt recorded |
| 42 | Negative with relevant failure | As 41 | s1/r2 `Denied` | `Unresolved{Unavailable}` @f1 | Symmetric | K1 (same key as 41) |
| 43 | Historical failure, then success | snap-2 supersedes snap-1 (which listed f1); snap-2 has `cov-all` re-attested for snap-2 and no failures | s1/r1 `Affirmed` | `Known(true, [s1/r1@1])` | f1 is attempt history only | K1 (if previously open) satisfied; f1 retained in its state |
| 44 | Statement for a non-current snapshot | Current snap-2; only coverage statement has `appliesTo: snap-1` | s1/r1 `Affirmed` | `Unresolved{InsufficientEvidence}` @cells s1, s2 | Statement “not current”; cells Absent | K1 |
| 45 | Failure for an undeclared source | `cov-all`; failure (DemoAssessment, P1, {s3}) | s1/r1 `Affirmed` | `Known(true, [s1/r1@1])` | Irrelevant: sources disjoint | None |
| 46 | Failure for another record type | `cov-all`; failure (OtherAssessment, P1, {s1}) | s1/r1 `Affirmed` | `Known(true, [s1/r1@1])` | Irrelevant: record type | None |
| 47 | Failure for another subject | `cov-all`; failure (DemoAssessment, P2, {s1}) | s1/r1 `Affirmed` | `Known(true, [s1/r1@1])` | Irrelevant: subject | None |
| 48 | Failure narrowed to another value set | `cov-all`; failure (DemoAssessment, P1, {s1}, valueSet `item-y`) | s1/r1 `Affirmed` | `Unresolved{Unavailable}` | Value set cannot prove irrelevance | K1 |
| 49 | Failure with unstated subject | `cov-all`; failure (DemoAssessment, subject omitted, {s1}) | s1/r1 `Affirmed` | `Unresolved{Unavailable}` | Not disproved | K1 |

**D. Authoring**

| # | Case | Expected |
|---|---|---|
| 50 | Whole-contract hole | Preview marker on `q.demo` and `p.demo`; no stage runs; no Need; publication blocked |
| 51 | Wrong-type reference: `establishes` is `c.assertion == AssertionKind.PatientReport`, or the predicate references a non-`Evidence<Boolean>` output | Compile error (cross-enum equality or binding type mismatch; §6.5, §10.4); no preview |
| 52 | Nested criterion hole (`establishes` is a hole) | Preview marker; S1–S4 and `refutes` traces shown; no Need even with an empty snapshot; publication blocked |

### 7.5 Invariance checks

These must hold for every case:

| Change | Expected |
|---|---|
| Permute records, retractions, coverage statements, failures or rejected items | Identical result, causes, attribution and canonical trace (5.3) |
| Add an identical duplicate row of an existing `RevisionRef` | Unchanged |
| Add a row with an existing `RevisionRef` but a different payload | **Changes** that key to `Conflicting` (case 27). Correct: it is new contradictory data, not a duplicate |
| Add records of an undeclared source, another subject (not key-linked) or another record type | Unchanged; outside the envelope |
| Add a failure proven irrelevant by a stated dimension | Unchanged result; one more irrelevant-gap trace entry |
| Add a key whose every possible current is out of domain, even with malformed history | Unchanged result (case 33) |
| Rename revision IDs consistently within a key | Unchanged result; only the canonical order may differ |
| Add a failure or statement with an unstated dimension inside the envelope | **May** block a `Known` result (cases 8, 40, 49). Correct: relevance or completeness is not established |

## 8. Decisions and remaining work

**Existing Stage A requirements applied.**

| Requirement | Stage A |
|---|---|
| Frozen inputs, no core I/O | §11.2 |
| Selection order: identity and correction history before scope | §4.4 |
| Per-query admissibility, with unresolved candidates kept | §4.6 |
| Absence is not falsity; negatives need sufficient coverage or explicit negatives | §4.1, §4.2 |
| Cause sets and Kleene composition | §4.1, §4.3 |
| No input-order winners | §4.4 |
| Bounded execution | §11.3 |
| Typed holes, preview-only, no Need from a hole | §2.3 |
| Typed finite-enum equality and disjointness | §6.5 |
| Stable Need identity, attempts as state, orchestrator ownership | §7 |
| Executable-graph cycles are compile errors | §6.3 |
| Pinned versions | §12.1 |

**Decisions proposed here.**

1. Source-scoped identity: `RecordKey` = (source, localId); `RevisionRef` = (source, localId, revision), with opaque revision IDs.
2. Chain boundary for this policy: type, subject and source are immutable; corrections and retractions are same-source only. Violations are proven-invalid malformed history (`Invalid` + `excluded`) and never silently supersede.
3. The schematic authority rule `demo-policy/same-source-amend@1`, distinguishing authorized, proven unauthorized (rejected, no effect) and undeterminable authority (missing → `Missing`, malformed → `Invalid`, both outcomes possible).
4. Deterministic S1: duplicate and payload-conflict handling, edge classification, cycle detection by strongly connected component, heads, retractions, and possible currents `H ∪ {excluded, unknown}`. No current revision is invented.
5. A key-closed input envelope over a declared finite source set.
6. Coverage combination per cell (`Incomplete` > `Unknown`/malformed > `Complete` > Absent = Unknown), with no intra-snapshot supersession, explicit snapshot replacement, and current gaps distinct from attempt history.
7. Gap relevance: record type, subject or a disjoint source can prove irrelevance; value set, episode and encounter never do; unstated dimensions never do.
8. `explicit-assertion-v0` as one strict demonstration policy, with symmetric gap blocking and the materiality and cause-accumulation rules.
9. Need identity, the `ResolveConflict` example, deferred `CorrectRecord` fulfillment and no Need under unresolved scope.
10. Canonical ordering for representation only.

**Possible conflicts needing a Stage A amendment.** None found. Items to confirm:

- (a) The disjointness obligation relies on §6.5’s enum analysis being mandatory for this policy.
- (b) Using `ref` for every dependency follows the minimal model’s proposed narrowing of §2.2, which is not yet accepted.
- (c) Contradictory coverage attestations add `InsufficientEvidence`, not `Conflicting`, because Stage A uses `Conflicting` for contradictory clinical evidence and attestations are not patient observations. The contradiction is visible as a diagnostic. If reviewers want `Conflicting` here, that is a cause-vocabulary decision for Stage A.

**Query/predicate split.** The query carries the reasoning. A projection-only Predicate is optional naming and composition structure. No node kind is added or removed.

**Remaining semantic ambiguity before conformance fixtures.** The policy semantics now define an outcome for every listed history and coverage combination. Three items remain:

1. **Revision node identity for conflicting payloads.** Case 27 has two nodes sharing one `RevisionRef`. Fixtures need a canonical way to name them in traces, e.g. a payload digest suffix; this is representation, not semantics.
2. **Payload-digest canonicalization.** “Identical payload” needs a defined canonical JSON form (key order, number formatting) so independent implementations agree on duplicate detection.
3. **`CorrectRecord` fulfillment (`fulfilled_by`, §7)** remains deferred. Cases verify emission only.

**Next smallest task.** Fix items 1–2 as a short canonicalization note, then write the conformance fixtures for `explicit-assertion-v0` from sections 7.1–7.5.
