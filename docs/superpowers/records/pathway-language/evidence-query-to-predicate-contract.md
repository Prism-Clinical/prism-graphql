# Evidence-query-to-predicate contract (draft)

**Status:** Proposed design draft. **Not** accepted, not finalized syntax, not a schema and not implemented. It contains no clinical content: the record type, enum values, codes, sources and permission below are fictional and illustrate language behavior only. They do not map to dysphagia, progression, urgency or any other clinical definition.

**Date:** 2026-10-03. **Revised:** 2026-10-03, nine times, 2026-10-04, once, and 2026-10-05, twice, after review. The third revision fixed three things:

- revision-chain boundaries: source-scoped identity, same-source corrections and one fully specified schematic authority rule;
- deterministic outcomes for malformed history;
- a coverage-combination rule over a declared finite source set, with a minimal fixture format and canonical ordering.

The fourth revision made three changes:

- Proven cross-boundary corrections and retractions are now rejected without changing their target. This keeps gap irrelevance consistent with S1.
- Payload identity for duplicate detection is defined.
- An unsupported justification about coverage attestations is removed.

The twelfth revision specifies the S3 `encounter` rule on its own (2.4, cases 101–104). This is so that one admissibility check can be implemented and tested in isolation.

- A malformed record encounter is `Invalid` (`FieldMalformed:encounter`).
- An unknown evaluation encounter keeps its own causes, even against a known record encounter.
- Out-of-domain possibilities are not evaluated.
- Two decisions stay open: encounter-identifier syntax beyond “a JSON string”, and how one rule’s mismatch combines with another rule’s unresolved outcome.

The eleventh revision settles S2’s input rules (2.3, cases 93–100). It came from review of the first S2 implementation, where an empty code was classified as established nonmembership.

- Absent concept information is `Missing`, with the field path as the reason.
- A present but malformed concept component is `Invalid`.
- Fictional identifiers must contain at least one non-whitespace character, and they are never trimmed.
- The same syntax binds the supplied expansion; a violation there is a configuration error, not patient evidence.

The tenth revision closes a gap in step 7. A step 5 fork can be suppressed by a defect that step 7 later makes historical, which left several heads with no cause. If several heads remain and no defect is current-affecting, step 7 now records a fork (cases 88–92).

The ninth revision corrects one condition from the eighth. An undeterminable correction stays active while its target remains a head, even after the correcting revision is retracted (cases 85–87).

The eighth revision resolves each S1 defect by its own condition against the final heads, rather than by whether any revision it involves survives. For example, a fork whose competing branch is validly retracted becomes historical (cases 81–84).

The seventh revision made three changes:

- History resolution is defined explicitly, with before/after and control fixtures (cases 76–80).
- Canonical bytes are verified with a maintained RFC 8785 implementation, and the Python helper is restricted to a documented subset.
- Pair comparison scopes are enforced by self-tests.

The sixth revision made three changes:

- S1 defects are scoped. A defect that no longer involves a possible current revision becomes a historical diagnostic, so a valid correction can resolve an earlier conflict.
- The canonicalizer conforms to RFC 8785, including numbers.
- Permutation pairs are validated on their whole expected output.

The fifth revision made five changes:

- Gap dimensions are now key-closed, so a gap proven irrelevant cannot affect the result at all.
- Conflicting payload variants under one `RevisionRef` remain conflicts and are never treated as boundary rejections.
- Payload equality is defined in [CANONICALIZATION.md](conformance/explicit-assertion-v0/CANONICALIZATION.md).
- `candidateEvidenceIds` and `CorrectRecord` emission are defined.
- Structured conformance fixtures are added under [conformance/explicit-assertion-v0/](conformance/explicit-assertion-v0/README.md).

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
- Cross-source correction and movement between subjects or record types are unsupported. When identity and the violation are both established, the violating item is rejected and kept as a diagnostic, and its target is unchanged (2.1). When identity or authority cannot be established, the record stays unresolved.

### 1.2 Per-record evidence

Records are instances of a record type declared in a pinned evidence-model library (here the fictional `demo-model@0.1`). A `DemoAssessment` revision has these fields:

| Field | Type | Notes |
|---|---|---|
| `key`, `revision` | `RecordKey`, revision ID | Together they form the `RevisionRef` |
| `recordType`, `subject` | type ID, `SubjectRef` | Required; immutable within a chain |
| `supersedes` | optional `RevisionRef` | A correction of the referenced revision |
| `episode`, `encounter` | `Field<EpisodeRef>`, `Field<EncounterRef>` | Absence is explicit, never defaulted |
| `concept` | `Code` (`system`, `code`) | Matched against a pinned value-set expansion (2.3) |
| `assertion` | `Field<AssertionValue>` | `Affirmed \| Denied \| Indeterminate` (fictional) |
| `assertionKind` | `AssertionKind` | Fictional: `ClinicianDocumented \| PatientReport` |
| `author` | `{ actor, permissions: Field<Set<Permission>> }` | Permissions are read only for corrections and retractions (1.3) |
| `provenance` | acquisition ID, source record reference | Retained in every trace |

`Field<T> = Present(T) | Absent`. In the fixture notation (7.1), an omitted optional field is `Absent`. A present value of the wrong type, or an enum code outside the pinned enum, is **malformed**.

**Payload equality.** Each row received is an *occurrence*. Whether two occurrences with the same `RevisionRef` are one revision (identical duplicates) or contradictory data (distinct *variants*, `Conflicting`) is semantic. [CANONICALIZATION.md](conformance/explicit-assertion-v0/CANONICALIZATION.md) defines it normatively. In summary:

- **Payload:** every declared field except `key`, `revision` and `provenance`.
- **Not payload:** acquisition provenance is occurrence metadata. Undeclared fields are kept with a diagnostic but are not payload.
- **Set fields:** `author.permissions` is compared as a set. Every other array is ordered.
- **Absent, `null`, malformed:** `Absent` is distinct from `null`, and both are distinct from other malformed values.
- **Strings:** compared exactly.
- **Digest:** a SHA-256 over RFC 8785 canonical bytes. It *identifies* variants; equality is defined first, and the digest never selects a winner.

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

The **input envelope** consists of the record type × the context subject × the declared sources, closed over keys. The snapshot must contain every revision and retraction of every `RecordKey` in a declared source that has at least one revision with this record type and subject. Revisions are not pre-filtered by concept, episode or encounter, because an authorized correction may change those. Revisions of an enveloped key that carry another subject or record type are included, so S1 can recognize and reject boundary violations.

Items from undeclared sources are outside the envelope and never enter evaluation.

### 1.5 Coverage, failures and snapshots

Every evaluation reads exactly one **current snapshot**. A snapshot may name the snapshot it replaces (`supersedesSnapshot`). That replacement is explicit and is the only form of supersession for coverage and failures: statements inside one snapshot never supersede one another, and input order never decides.

**Statement format** (all statements carry `appliesTo.snapshot`):

| Item | Fields | Dimension semantics |
|---|---|---|
| Coverage statement | `id`, `appliesTo.snapshot`, `recordType`, `subject`, `sources` (nonempty array), `status ∈ {Complete, Incomplete, Unknown}`, `attestedBy` | An omitted or `null` dimension is **unstated (unknown)** |
| Acquisition failure | `id`, `attempt`, `appliesTo.snapshot`, `outcome ∈ {Failed, TimedOut, Refused}`; optional `recordType`, `subject`, `sources`, `valueSet`, `episode`, `encounter` | Omitted means unknown |
| Rejected item | `id`, `appliesTo.snapshot`, `reason`; optional `recordType`, `subject`, `sources` | Omitted means unknown |

**What a dimension describes (key-closed).** Gap and coverage dimensions describe **envelope membership**, not an occurrence’s own fields. Every occurrence of a `RecordKey` that has at least one revision with record type *T* and subject *P* in a declared source counts as content of (*T*, *P*, that source), whatever its own `recordType` or `subject` field says. This covers revisions, payload variants, out-of-envelope revisions and retractions alike.

A failure or rejected item stated for another record type or subject therefore asserts that it contains **no** occurrence of a key in this query’s envelope. An adapter that cannot establish that must leave the dimension unstated, which makes the item relevant (4.1).

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
| Field malformed | `assertion = "Maybe"`; a syntactically invalid code, e.g. empty or whitespace-only (2.3) | Patient evidence | `Invalid` |
| Terminology information unavailable | A well-formed code from a system the pinned expansion does not cover | Patient evidence | `Unavailable` (S2) |
| Malformed or contradictory revision history | Missing target, fork, self-supersession, cycle, undeterminable identity or authority | Patient evidence | Per 2.1 (`Missing`, `Conflicting`, `Invalid`) |
| Proven cross-boundary correction or retraction | Subject or record-type change; correction or retraction naming another key | Patient evidence | No cause: rejected, kept as a diagnostic, target unchanged (2.1) |
| Unparseable item or uninterpretable type version | No key; `demo-model@0.2` | Patient evidence (snapshot) | Rejected item; `Invalid` if relevant |
| Wrong-type expression, unknown field, executable-dependency cycle | Section 7, case 51 | **Invalid program** | Compilation fails |

A cycle in patient revision history is malformed *data*, handled in S1. A cycle in the authored executable dependency graph is a compile error (§6.3). No stage invents a default for missing patient information.

## 2. Processing boundaries

The stages follow Stage A §4.4’s order: identities and correction/retraction authority and history first, then concept and scope admissibility, then precedence and sufficiency. Authored criterion evaluation sits between selection and resolution. Every stage is a function of *sets* keyed by identity, and every item keeps a recorded stage and reason in the trace.

| # | Stage | Inputs | Outputs | Kind |
|---|---|---|---|---|
| S1 | Identity and revision history | The whole envelope (revisions and retractions), before any semantic filter; authority rule 1.3 | Per `RecordKey`: `Current(rev) \| Retracted \| NoRecord \| UnresolvedRevision(causes, possibleCurrent)`, plus rejected items with reasons (2.1) | Fixed behavior; authority is a versioned schematic rule |
| S2 | Candidate identification | S1; pinned value-set expansion | For each possible current revision: in domain, out of domain, or candidacy unresolved (`Unavailable` for an uncovered code system, `Invalid` for a malformed code). `excluded` stays excluded; `unknown` stays possible-in-domain. A key is a candidate if any possible current could be in domain (2.3) | Fixed behavior over pinned parameters |
| S3 | Admissibility | Candidates; context; authored rules (2.2) | Per candidate revision: `Admissible \| Inadmissible(reasons) \| UnresolvedAdmissibility(causes)` with origin causes | Fixed semantics over authored rules |
| S4 | Selection | S3 | `selected` = keys whose single current revision is `Admissible`; `unresolved` = keys with unresolved history, candidacy or admissibility; inadmissible keys retained | Policy `explicit-assertion-v0` |
| S5 | Criterion evaluation | `selected`, `unresolved`; `establishes`, `refutes` | Classification per revision (3.3); unresolved keys are classified only to judge materiality | Authored expressions; fixed rule |
| S6 | Sufficiency and resolution | S5; coverage cells; current failures; rejected items | `Evidence<Boolean>` (§4.1); Need state (6.3) | Policy `explicit-assertion-v0` |
| S7 | Projection | `Evidence<Boolean>` | `Decision` (5.2) | Fixed |

### 2.1 S1: revision history, deterministically

S1 runs per `RecordKey` over a finite graph and always terminates. Its cycle detection is a strongly-connected-component analysis bounded by the snapshot size limits of §11.3.

**Step 1 — occurrences and variants.** Group occurrences by `RevisionRef`. Within a group, occurrences with equal payloads (1.2) form one *variant*, which keeps every occurrence’s provenance.

- **One variant:** the group is an ordinary revision.
- **Two or more variants:** the group is a **conflicted revision**, and the key gets cause `Conflicting` (reason `PayloadConflict`). This is genuine contradictory data, **not** a boundary violation, even if variants differ in subject or record type.
  - Its in-envelope variants are its possible contents, and any out-of-envelope variant adds `excluded`.
  - Its own `supersedes` edges are not applied, because they are contradictory.
  - A valid correction that names its `RevisionRef` supersedes all its variants.
  - Variants are named `RevisionRef#digest`.

**Step 2 — out-of-envelope revisions.** Step 2 applies to ordinary (single-variant) revisions only.

- **Record type or subject present and different from the envelope’s:** the revision is not a node for this query. It is preserved with reason `OutOfEnvelopeRevision`, adds no cause and no addition, and cannot form a fork. It is still available as a *target* in step 3, so a correction of it is recognized as a boundary violation.
- **Record type or subject absent or malformed:** membership is **undeterminable**. The revision stays a node, the key gets `Missing` or `Invalid` (`EnvelopeFieldAbsent` / `EnvelopeFieldMalformed`), and the addition `excluded` is recorded. A correction edge *from* it is treated as undeterminable: it is ignored, and both its target and the revision remain possible.

**Step 3 — correction edges.** Each node with `supersedes` produces an edge; out-of-envelope revisions (step 2) produce none. Each edge is classified by the first row that matches:

| Edge condition | Classification | Effect |
|---|---|---|
| `supersedes` absent fields (e.g. no `source`) | Defective, `Missing` | Edge ignored; the correcting revision stays a node |
| `supersedes` malformed | Defective, `Invalid` | Edge ignored |
| Names another `RecordKey` (cross-source or other local ID), with all `RevisionRef` fields present | Proven cross-boundary | The correcting revision is rejected and preserved (`CrossKeyCorrection`) and is no longer a node of its own key. No cause. The target key is **unchanged**; the diagnostic is also attached to its trace |
| Target is an ordinary revision present in the snapshot with a different record type or subject | Proven cross-boundary | The correcting revision is rejected and preserved (`SubjectChanged` / `RecordTypeChanged`). No cause. The target is unchanged |
| Target is a conflicted revision whose variants disagree on record type or subject | Undeterminable, `Conflicting` (`CorrectionBoundaryUndeterminable`) | Edge ignored; both remain possible |
| Names itself | Defective, `Invalid` | Edge ignored |
| Target revision absent from the snapshot | Defective, `Missing` | Edge ignored; addition `unknown` (the unseen chain could hold anything) |
| Authority unauthorized (1.3) | Proven unauthorized | The correcting revision is rejected and preserved (`Unauthorized`); no cause; the target is unaffected |
| Authority missing / malformed (1.3) | Undeterminable, `Missing` / `Invalid` | Edge ignored; both target and correction remain possible |
| Otherwise | **Valid** | Target is superseded |

**Step 4 — cycles.** Valid edges lying on a cycle, i.e. inside a strongly connected component with more than one node, are reclassified as defective, `Invalid`, and ignored.

**Step 5 — heads.** Heads are the non-rejected nodes not superseded by any valid edge. More than one head without any other defect means a fork, with cause `Conflicting`. If another defect suppresses the fork here, step 7 may still record one (fork fallback).

**Step 6 — retractions.** Retraction occurrences are grouped by (`key.source`, `id`), and their payload is `key`, `target` and `author` (CANONICALIZATION.md).

- If a group has two or more variants, the retraction is **conflicted**: each in-envelope key that any variant targets gets `Conflicting` (`RetractionConflict`) plus `excluded`.
- Otherwise, each retraction is judged against the same checks:

| Retraction condition | Effect |
|---|---|
| Target fields absent / malformed | The retraction cannot be attributed; it is a rejected item (`Missing` / `Invalid` gap) whose dimensions are its known fields |
| Target in another key than the retraction’s own `key` (all fields present) | Proven cross-boundary. Rejected and preserved (`CrossKeyRetraction`); no cause; target unchanged, diagnostic attached |
| Target is an out-of-envelope revision (step 2) | No effect on this query; traced |
| Target is a rejected revision (unauthorized or cross-boundary, step 3) | No effect; traced |
| Target key not in the envelope | Traced only |
| Target revision absent | `Missing` + `excluded` |
| Unauthorized | Rejected, preserved, no effect |
| Authority missing / malformed | `Missing` / `Invalid` + `excluded` |
| Valid, target is a head | That head is removed (no reinstatement of earlier revisions) |
| Valid, target is superseded | No effect; traced |

**Step 7 — scope defects, then decide the result.** Write *H* for the heads remaining after steps 5 and 6. Each defect recorded in steps 1–6 (a cause and any addition `excluded`/`unknown`) is **current-affecting** while its own ambiguity can still affect which revision is current. That is judged against *H*:

| Defect | Current-affecting while… |
|---|---|
| `PayloadConflict` | The conflicted revision is in *H* |
| Fork (recorded at step 5) | At least two of the fork’s branch heads are still in *H* |
| Fork (fork fallback, below) | Always: it is recorded only when it holds |
| Undeterminable correction edge (authority or boundary undeterminable) | Its **target** is in *H* (computed with this edge ignored). The open question is whether the target was superseded, and removing the source does not answer it: if the correction was valid, the target stays superseded even after the source is retracted, because a retraction never reinstates. If the source was removed by a valid retraction, the defect also adds `excluded`, for the branch in which the target was superseded and nothing remains. If the source was superseded by a valid later correction, that successor is already in *H* |
| Correction edge whose target cannot be identified (absent or malformed reference) or is absent from the snapshot (`unknown`) | Its source is in *H* |
| Self-supersession | The revision is in *H* |
| Cycle | Any revision of the cycle is in *H*. Which member superseded which is unknown, and a retraction never reinstates, so one surviving member is still ambiguous |
| Undeterminable envelope membership | The revision is in *H* |
| Undeterminable or conflicted retraction | Its target is in *H* (for an absent target: any revision of the key is in *H*) |

Otherwise a defect is **historical**: it stays in the trace as a diagnostic (`HistoricalDefect`, with its original cause and reason) but adds no cause and no addition.

*H* depends only on **valid** edges and valid retractions (steps 3–6). A defect therefore becomes historical only when an explicit, authorized, boundary-valid correction or retraction removes the condition above. A later revision alone never resolves anything.

| Situation | Effect on an earlier defect | Case |
|---|---|---|
| Valid, unambiguous correction supersedes the conflicted `RevisionRef` (all variants share subject, type and source) | Historical; the result can be `Current` | 72 (before: 76) |
| Correction with undeterminable authority | Still active: both revisions remain heads | 73 |
| Valid correction resolves the conflict, but another defect involves the new head (e.g. a retraction of it with missing authority) | The conflict is historical; the other defect stays active | 77 |
| Later revision without a valid `supersedes` | Still active: the conflicted revision stays a head | 78 |
| Correction of a conflicted revision whose variants disagree on subject (ownership) | Still active: the edge is undeterminable (step 3), so the existing ownership behavior is unchanged | 79 |
| Authorized retraction of the conflicted `RevisionRef` | Historical; the key is `Retracted` | 80 |
| Fork (`Affirmed` vs `Denied` branches); authorized retraction removes the `Denied` branch | The fork is historical: one branch head remains, so the result can be `Current` | 81 (before: 84) |
| As 81, but the retraction is unauthorized | Still active: the retraction is rejected and both branches remain | 82 |
| As 81, but the retraction’s authority is missing | Still active: both branches remain, and the retraction defect is active too | 83 |
| Correction with unknown authority; the correcting revision is then validly retracted | Still active: if the correction was authorized, the target stays superseded (no reinstatement); if not, the target is current. Possible {target, excluded} | 85 |
| As 85, but the correction is known to be authorized | No defect: the target was superseded and its successor retracted, so the key is `Retracted` | 86 |
| As 85, but the correction is known to be unauthorized | No defect: the correction is rejected (and its retraction has no effect), so the target is `Current` | 87 |
| Conflicted revision superseded by two authorized corrections (no fork at step 5) | `PayloadConflict` historical; the two heads are a fallback fork | 88 |
| As 88, plus an authorized retraction of one head | Both historical: one head remains, so the result can be `Current` | 89 |
| As 88, plus authorized retractions of both heads | Both historical; the key is `Retracted` (the conflicted revision is not reinstated) | 90 |
| As 89, but the retraction is unauthorized | The fallback fork stays: the retraction is rejected and both heads remain | 91 |
| As 89, but the retraction’s authority is missing | The retraction defect is active, so no fallback fork is recorded | 92 |

Historical defects remain in the trace as `HistoricalDefect` diagnostics, with their variants, original cause and reason. They are never listed among the result’s causes or attributions.

**Fork fallback.** If, after scoping, |*H*| > 1 and no defect is current-affecting, record a fork over *H* with cause `Conflicting` (reason `Fork`). It is current-affecting. This happens only when a step 5 fork was suppressed by a defect that is now historical (case 88). The fallback is not applied while any defect is current-affecting, even one that does not concern the heads’ multiplicity (case 92). It never replaces a recorded step 5 fork, which is still current-affecting whenever |*H*| > 1.

Write *C* for the causes and *X* for the additions of current-affecting defects only, including a fallback fork. After the fallback, *C* and *X* cannot both be empty while |*H*| > 1, so the table below always yields a result with a nonempty cause set when unresolved.

| Condition | Result |
|---|---|
| No non-rejected node, *C* empty, *X* empty (e.g. the key’s only revision was a rejected cross-key correction) | **No record**: not a candidate; traced only |
| *C* empty, *X* empty, \|*H*\| = 1 | `Current(h)` |
| *C* empty, *X* empty, nodes exist, *H* empty (all heads retracted) | `Retracted` |
| Otherwise | `UnresolvedRevision(C, possibleCurrent = H ∪ X)` |

`excluded` means “possibly not a current record for this query”; `unknown` means “possibly a current revision with any content”. No current revision is ever chosen by input order, revision-ID order or recency.

Rejected and superseded revisions and historical defects are kept in the trace with reasons. A `Complete` cell claim alongside a missing target in that cell is also traced as a contradictory attestation.

### 2.2 S3 admissibility rules in this example

- `subject` equals the context subject, else `Inadmissible(WrongSubject)`. This cannot arise after S1 step 2 (out-of-envelope revisions), but the rule is kept for completeness.
- `episode` equals the context episode, with no prior-episode history (§4.7).
  - The record’s field is absent: `UnresolvedAdmissibility(Missing)`.
  - The context episode is `Unknown(causes)`: `UnresolvedAdmissibility(causes)`.
  - A different known episode: `Inadmissible(OtherEpisode)`.
- `encounter`: the same rule, with reason `OtherEncounter`. Section 2.4 specifies this rule on its own.
- `assertionKind` must be in the authored set, else `Inadmissible(AssertionKindNotAllowed)`.

Causes from several unresolved rules accumulate. “Unresolved admissibility” is a stage outcome; the causes stay those of the underlying input.

### 2.3 S2: concept presence, identifier syntax and membership

S2 classifies each possible current revision or variant from S1 (2.1). `Current(rev)` contributes its revision. `UnresolvedRevision` contributes every node in *H*, each conflicted variant separately. `Retracted` and no-record keys contribute nothing, which is not a negative conclusion. S2 never reconsiders superseded or rejected revisions and never chooses among possible currents.

**Identifier syntax (fictional, `demo-model@0.1` only).** A code-system identifier or code is **well-formed** if and only if it is a JSON string containing at least one character without the Unicode `White_Space` property. That property has been stable since Unicode 6.3.

- The empty string and whitespace-only strings (e.g. `"   "`, `"\u00a0\u2003"`) are malformed.
- No trimming, case folding or other normalization is applied. `" item-x"` is well-formed and is a different code from `item-x`.
- Code-system-specific syntax for real terminologies is out of scope.

**Concept rules.** Components are judged independently, and every resulting finding is kept:

| Input | Cause | Reason |
|---|---|---|
| `concept` absent | `Missing` | `FieldAbsent:concept` |
| `concept` present but not an object (including `null`) | `Invalid` | `CodeMalformed` |
| `concept.system` / `concept.code` absent | `Missing` | `FieldAbsent:concept.system` / `FieldAbsent:concept.code` |
| `concept.system` / `concept.code` present but not a well-formed identifier (non-string, `null`, empty, whitespace-only) | `Invalid` | `CodeMalformed` |

An absent component and a malformed one give both causes (case 97). Two malformed components give one `CodeMalformed` finding, since attribution entries form a set. Any finding makes candidacy unresolved. Undeclared members of `concept`, such as a display text, are not payload (CANONICALIZATION.md) and are never read.

**Membership.** Only when both components are well-formed:

| Condition | Candidacy |
|---|---|
| `system` not in the expansion’s covered systems | Unresolved: `Unavailable`, `TerminologyUnavailable` |
| (`system`, `code`) in the expansion, compared exactly | In domain |
| Otherwise | Out of domain: nonmembership established within declared coverage |

**Expansion binding.** The contract pins `retrieve.valueSet` (here `demo-vs/item-x@1`; the version is part of the identifier). The supplied expansion must carry exactly that identity, a list of codes and a list of covered systems. Every identifier in it must be well-formed under the syntax above, and every code’s system must be covered. Any violation, a missing expansion or a mismatched identity is an **invalid configuration**. Evaluation does not proceed, and the problem is never patient-evidence uncertainty or an empty expansion. An explicitly supplied empty code list is valid. There is no terminology lookup, version resolution or code-system conversion.

**Key-level candidacy.** A key is a candidate if any possible current is in domain, has unresolved candidacy, or is `unknown`. `excluded` never makes a key a candidate. Candidacy includes unresolved possibilities, so it does not mean membership is established. S2 discards no inherited S1 cause; materiality is decided in S6 (4.2).

### 2.4 S3: the `encounter` rule on its own

This section isolates one rule of 2.2, so it can be checked before the rest of S3 exists. Its result is **not** an admissibility result. A match says only that this rule is satisfied: the episode and `assertionKind` rules, and anything else S3 adds, still apply.

**The authored rule.** The check consumes the contract’s `admissible.encounter` exactly as written (7.1):

`{ "eq": [{ "field": ["c", "encounter"] }, { "ref": "ctx.encounter" }] }`

There is no implicit default. A query without this rule has no encounter check, and any other expression in that position is out of this section’s scope.

**What is checked.** Each S2 possibility (2.3):

- In domain, or with unresolved candidacy: checked. S2 findings stay attached and separate, and a match does not clear them.
- Out of domain: **not evaluated**. This is not a mismatch.
- `excluded` and `unknown`: carried unchanged.
- Keys that are `Retracted` or have no record contribute nothing.

S1 causes stay with the key.

**Comparison.** `EncounterRef` is a JSON string, compared exactly. The record field is `Field<EncounterRef>` (1.2), and the evaluation encounter is `Known(EncounterRef) | Unknown(causes)` (1.6).

| Record `encounter` | Evaluation encounter | Outcome | Findings (cause, origin, reason) |
|---|---|---|---|
| String *e* | `Known(e)` | **Matches** | — |
| String *e* | `Known(f)`, *f* ≠ *e* | **DoesNotMatch** | reason `OtherEncounter` (S3 makes this `Inadmissible`) |
| String | `Unknown(C)` | **Unresolved** | each *c* ∈ *C*, `context.encounter`, `ContextUnknown:encounter` |
| Absent | any | **Unresolved** | `Missing`, the record, `FieldAbsent:encounter`; plus the context findings if `Unknown` |
| Present, not a string (`null` included) | any | **Unresolved** | `Invalid`, the record, `FieldMalformed:encounter`; plus the context findings if `Unknown` |

A known record encounter never decides against an unknown evaluation encounter, and context causes are never relabelled. Record and context findings accumulate. 2.2 states accumulation across rules; this section applies the same principle to the two inputs of one rule, and is the source of that decision.

A malformed evaluation context, such as a `known` value that is not a string or an `Unknown` with no causes, is an invalid program input from the orchestrator. It is not patient uncertainty.

**Open decisions** (not resolved here):

1. **EncounterRef syntax.** Only the type is fixed. Whether `""` or a whitespace-only string is malformed is undefined. The S2 identifier syntax (2.3) covers terminology codes and is not borrowed. Smallest counterexample: record `encounter: ""` against `Known(N1)` is currently `DoesNotMatch`, so S3 would make it `Inadmissible`, not unresolved.
2. **Combining rule outcomes.** 2.2 says causes from several *unresolved* rules accumulate. It does not say whether one rule’s `Inadmissible` outcome decides the revision while another rule is unresolved. Example: encounter N0 with the episode field absent. This check does not need the answer; the full S3 result does.

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
| Record type | Stated and different |
| Subject | Stated and different |
| Sources | Stated and disjoint from the declared source set |
| Value set, episode, encounter | **Never**: an authorized correction may move a record across them |

An unstated dimension proves nothing. Everything not proven irrelevant is relevant, and irrelevant items are traced only.

**Why this is consistent with S1.** Dimensions are key-closed (1.5). A gap proven irrelevant by record type, subject or source therefore contains no occurrence of any key in the envelope. Its content cannot change any S1 result, candidate, admissibility or classification, so it **cannot change the result** (cases 53 and 47).

Occurrences that *are* envelope content but cross a boundary are handled separately by S1. A correction or retraction naming another key, or one targeting a revision of another subject or type, is rejected without changing its target (steps 3 and 6). An out-of-envelope revision of an enveloped key is ignored (step 2). A proven boundary attempt therefore never changes its valid target, whether it arrives through a relevant gap or is present from the start (pairs 64/20, 64/21, 1/22, 1/63, 53/54). Undeterminable identity, target or authority stays unresolved and goes through materiality (cases 18, 58, 65).

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
- every material *u*’s origin causes, attributed to its record and stage. These are its S1 causes plus the S2, S3 and S5 causes of each of its possible current revisions or variants.

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

`Known(value, supportingEvidenceIds, provenance) | Unresolved(causes, candidateEvidenceIds)`. No new cause is introduced.

- `supportingEvidenceIds` is *S* for `Known(true)` and *R* for `Known(false)`.
- `candidateEvidenceIds` is the set of every current or possible-current revision or variant ID, of every key seen in S2–S4 (selected, unresolved or inadmissible), whose candidacy is in domain or unresolved. Markers `excluded` and `unknown`, out-of-domain revisions and retracted keys are not listed. Each cause is attributed in the trace to its origin: a revision, key, cell, failure, rejected item or context input, together with the stage and reason. The trace records:

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

These orderings exist only so expected traces and lists compare byte-for-byte. They never influence candidacy, selection, classification or resolution, and no variant is ever preferred because of its digest or lexical position.

| Item | Order |
|---|---|
| `RecordKey` | `(source, localId)`, by Unicode code point |
| `RevisionRef` | `(source, localId, revision)`, by code point. Revision order is **not** recency |
| Payload variants | `RevisionRef#digest` (1.2), ordered by `RevisionRef` then digest |
| Occurrences within a variant | By `provenance.acquisition`, then `provenance.sourceRecordRef`, by code point |
| Causes | Stage A §4.1 order: `Missing`, `Conflicting`, `Unavailable`, `Invalid`, `Inadmissible`, `InsufficientEvidence` |
| Attribution entries | By cause order, then origin reference, then reason |
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

**Separate obligations exist only for a different fulfillment requirement.** The explicit example is conflict: a further assessment can never remove an established conflict under this policy, so fulfillment needs an authorized correction or retraction of an existing record. That is a `ResolveConflict` obligation (Need key + kind). `CorrectRecord` (Need key + kind + `RecordKey`) is emitted for each material unresolved record whose attributed causes include one from that record’s own data or history. That means an S1 cause, or `FieldAbsent`, `FieldMalformed` or `CodeMalformed` on one of its revisions. It is *not* emitted for `TerminologyUnavailable`, `ContextUnknown`, an inadmissible record or a gap. Its fulfillment validation (`fulfilled_by`, §7) remains **deferred**: cases below verify only that it is emitted.

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

The machine-readable, fully expanded fixtures for every case below are in [conformance/explicit-assertion-v0/](conformance/explicit-assertion-v0/README.md). This section shows the notation they use.

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
| 20 | Subject change attempted | s1/r20@1 `Affirmed`; s1/r20@2 supersedes @1, subject P2, `+amend` | `Known(true, [s1/r20@1])` | True | @2 `OutOfEnvelopeRevision`, diagnostic on s1/r20; @1 unchanged | None |
| 21 | Record-type change attempted | As 20, but @2 recordType `demo-model/OtherAssessment@0.1` | `Known(true, [s1/r20@1])` | True | @2 `OutOfEnvelopeRevision`; @1 unchanged | None |
| 22 | Cross-source correction | s1/r1@1 `Affirmed`; s2/r21@1 supersedes s1/r1@1, `+amend` | `Known(true, [s1/r1@1])` | True | s2/r21@1 rejected `CrossKeyCorrection` (key s2/r21: no record); diagnostic on s1/r1; s1/r1 unchanged | None |
| 23 | Same local ID, different sources | s1/r30@1 `Affirmed`; s2/r30@1 `Indeterminate` | `Known(true, [s1/r30@1])` | True | Two unrelated keys; no duplicate or payload conflict | None |
| 24 | Corrected to another concept | s1/r8@1 `Affirmed`; s1/r8@2 supersedes @1, concept `item-y`, `+amend` | `Unresolved{Missing}` | Unknown(Missing) | r8 “corrected out of domain”; @1 is **not** evidence | K1 |
| 25 | Correction changes scope | s1/r16@1 `Affirmed`; s1/r16@2 supersedes @1, `Affirmed`, encounter N0, `+amend` | `Unresolved{Inadmissible}` | Unknown | @2 `OtherEncounter` | K1 |
| 26 | Missing correction target | s1/r9@2 `Affirmed`, supersedes s1/r9@1 (absent), `+amend` | `Unresolved{Missing}` @s1/r9 history | Unknown(Missing) | Addition `unknown`; contradictory attestation for cell s1 | K1; `CorrectRecord` s1/r9 |
| 27 | Same identity, conflicting payloads | Two rows s1/r14@1: `Affirmed` and `Denied` | `Unresolved{Conflicting}` @s1/r14 | Unknown(Conflicting) | Nodes `s1/r14@1#<digest>` ×2; independent of row order | K1; `CorrectRecord` s1/r14 |
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

**E. Boundary consistency and payload identity** (D0 unless stated)

| # | Case | Records / changes | `Evidence<Boolean>` | `Decision` | Trace must show | Need |
|---|---|---|---|---|---|---|
| 53 | Subject-labelled gap, revision absent | s1/r1@1 `Affirmed` (P1); failure f1 (DemoAssessment, P2, {s1}) | `Known(true, [s1/r1@1])` | True | f1 irrelevant (subject) | None |
| 54 | The same gap’s revision present | s1/r1@1 `Affirmed` (P1); s1/r1@2 supersedes @1, subject P2, `+amend` | `Known(true, [s1/r1@1])` | True | @2 `OutOfEnvelopeRevision`. Same result as case 53: the irrelevance claim holds | None |
| 55 | Missing target, then found out of envelope | s1/r9@2 `Affirmed` (P1), supersedes s1/r9@1, which is absent; s1/r1@1 `Affirmed`; failure (DemoAssessment, P2, {s1}). Variant 55b: s1/r9@1 present with subject P2 | 55: `Unresolved{Missing}` @s1/r9 history. 55b: `Known(true, [s1/r1@1])` | 55: Unknown; 55b: True | The P2 failure is irrelevant in both. s1/r9@1 is envelope content (key-closed), so it was never inside that failure. 55b: @1 `OutOfEnvelopeRevision`; @2 rejected `SubjectChanged`; s1/r9 no record | 55: K1, `CorrectRecord` s1/r9 |
| 56 | Other-subject original in the same key | s1/r50@1 `Affirmed` (P1); s1/r50@x original (no `supersedes`), subject P2, `Denied` | `Known(true, [s1/r50@1])` | True | @x `OutOfEnvelopeRevision`; no fork | None |
| 57 | Cross-source retraction | s1/r1@1 `Affirmed`; retraction (key s2/r60) targeting s1/r1@1, `+amend` | `Known(true, [s1/r1@1])` | True | `CrossKeyRetraction`; target unchanged | None |
| 58 | Correction identity undeterminable | s1/r1@1 `Affirmed`; s1/r1@2 `Denied`, `supersedes` with `source` omitted, `+amend` | `Unresolved{Missing}` @s1/r1 history | Unknown(Missing) | Edge defective; heads {@1, @2}; not treated as cross-boundary | K1; `CorrectRecord` s1/r1 |
| 59 | Duplicate rows differing only in acquisition provenance | Two rows s1/r1@1 `Affirmed`, acquisitions a1 and a2 | `Known(true, [s1/r1@1])` | True | One node; both provenances retained | None |
| 60 | Same identity, payloads differ only in `author.permissions` | Two rows s1/r1@1 `Affirmed`: `perm: []` and `+amend` | `Unresolved{Conflicting}` @s1/r1 | Unknown(Conflicting) | Two digests; `author` participates in payload identity | K1; `CorrectRecord` s1/r1 |
| 61 | Same identity, permissions in different order or repeated | Two rows s1/r1@1 `Affirmed`: permissions `[p, amend]` and `[amend, p, amend]` | `Known(true, [s1/r1@1])` | True | Same digest after set canonicalization | None |

**F. Variants, undeterminable membership, pairs and canonicalization** (D0 unless stated)

| # | Case | Records / changes | `Evidence<Boolean>` | `Decision` | Trace must show | Need |
|---|---|---|---|---|---|---|
| 62 | Conflicting variants differing in subject | Two occurrences of s1/r1@1, both `Affirmed`: one P1, one P2 | `Unresolved{Conflicting}` @s1/r1 | Unknown(Conflicting) | Conflicted revision, **not** a boundary rejection; possible {P1 variant, excluded} | K1; `CorrectRecord` s1/r1 |
| 63 | Cross-local-ID correction, same source | s1/r1@1 `Affirmed`; s1/r70@1 supersedes s1/r1@1, `+amend` | `Known(true, [s1/r1@1])` | True | s1/r70@1 rejected `CrossKeyCorrection`; s1/r70 no record; s1/r1 unchanged | None |
| 64 | Before-state for cases 20 and 21 | s1/r20@1 `Affirmed` only | `Known(true, [s1/r20@1])` | True | No diagnostic on s1/r20. Paired with 20/21: same result, trace differs only by the rejection | None |
| 65 | Subject undeterminable | s1/r1@1 `Affirmed`; s1/r1@2 `Denied`, supersedes @1, `subject` omitted, `+amend` | `Unresolved{Missing}` @s1/r1 | Unknown(Missing) | `EnvelopeFieldAbsent`; possible {@1, @2, excluded}; contrast with proven case 20 | K1; `CorrectRecord` s1/r1 |
| 66 | Conflicting retraction occurrences | s1/r1@1 `Affirmed`; retraction x1 targeting @1 received twice, once `+amend` and once `perm: []` | `Unresolved{Conflicting}` @s1/r1 | Unknown(Conflicting) | `RetractionConflict`; possible {@1, excluded} | K1; `CorrectRecord` s1/r1 |
| 67 | Same payload, different object-key order | Canonicalization only | — | — | Equal payloads, one digest | — |
| 68 | Absent versus `null` | Two occurrences of s1/r1@1: `assertion` omitted, and `assertion: null` | `Unresolved{Missing, Conflicting, Invalid}` @s1/r1 | Unknown (same) | Two variants; `FieldAbsent` vs `FieldMalformed` | K1; `CorrectRecord` s1/r1 |
| 69 | Undeclared field | Two occurrences of s1/r1@1 `Affirmed`; one adds an undeclared `note` | `Known(true, [s1/r1@1])` | True | One variant; `UndeclaredField` diagnostic | None |
| 70 | Three variants, order A,B,C | s1/r14@1 as `Affirmed`, `Denied`, `Indeterminate` | `Unresolved{Conflicting}` @s1/r14 | Unknown(Conflicting) | Three variant IDs | K1; `CorrectRecord` s1/r14 |
| 71 | Case 70 permuted (C,A,B) | Same occurrences, different order | Identical to case 70, including variant IDs and order | Same | Same | Same |
| 72 | Conflict resolved by a valid correction | Two occurrences of s1/r1@1 (`Affirmed`, `Denied`); s1/r1@2 `Affirmed`, supersedes @1, `+amend` | `Known(true, [s1/r1@2])` | True | s1/r1 `Current(@2)`; `PayloadConflict` at s1/r1@1 is a historical diagnostic | None |
| 73 | Conflict with an undeterminable correction | As 72, but @2 `perm omitted` | `Unresolved{Missing, Conflicting}` @s1/r1 | Unknown | Heads {@1 variants, @2}; both defects current-affecting | K1; `CorrectRecord` s1/r1 |
| 74 | Numeric malformed values equal under RFC 8785 | Two occurrences of s1/r1@1, `assertion: 1` and `assertion: 1.0` | `Unresolved{Invalid}` @s1/r1@1 | Unknown(Invalid) | One variant (identical canonical bytes); `FieldMalformed:assertion` | K1; `CorrectRecord` s1/r1 |
| 75 | Numeric canonicalization | Canonicalization only. Equal: `1`/`1.0`/`1E0`; `0`/`-0.0`; `1e21`/`1000000000000000000000`. Distinct: `1`/`2`; `999999999999999900000`/`1e21`; `1e23`/`9.999999999999997e+22`; `1`/`"1"` | — | — | Equal or distinct exactly as listed (RFC 8785 Appendix B values) | — |
| 76 | Before-state for case 72 | Two occurrences of s1/r1@1 (`Affirmed`, `Denied`) | `Unresolved{Conflicting}` @s1/r1 | Unknown(Conflicting) | Conflicted revision | K1; `CorrectRecord` s1/r1 |
| 77 | Conflict resolved, independent defect remains | As 72, plus retraction x2 of s1/r1@2 with `perm omitted` | `Unresolved{Missing}` @s1/r1 | Unknown(Missing) | `PayloadConflict` historical; possible {@2, excluded} | K1; `CorrectRecord` s1/r1 |
| 78 | Later revision without `supersedes` | Two occurrences of s1/r1@1 (`Affirmed`, `Denied`); s1/r1@2 `Affirmed` with no `supersedes` | `Unresolved{Conflicting}` @s1/r1 | Unknown(Conflicting) | Heads {@1 variants, @2}; conflict active | K1; `CorrectRecord` s1/r1 |
| 79 | Correction of an ownership-conflicted revision | Case 62’s variants (P1, P2) plus s1/r1@2 `Affirmed`, supersedes @1, `+amend` | `Unresolved{Conflicting}` @s1/r1 | Unknown(Conflicting) | Edge undeterminable (`CorrectionBoundaryUndeterminable`); possible {P1 variant, @2, excluded} | K1; `CorrectRecord` s1/r1 |
| 80 | Conflict removed by an authorized retraction | Two occurrences of s1/r1@1 (`Affirmed`, `Denied`); retraction x1 of s1/r1@1, `+amend` | `Unresolved{Missing}` | Unknown(Missing) | Key `Retracted`; `PayloadConflict` historical | K1 |
| 81 | Fork resolved by an authorized retraction | s1/r1@1 `Affirmed`; @2a `Affirmed` and @2b `Denied` both supersede @1, `+amend`; retraction x1 of @2b, `+amend` | `Known(true, [s1/r1@2a])` | True | s1/r1 `Current(@2a)`; `Fork` is a historical diagnostic | None |
| 82 | Fork with an unauthorized retraction | As 81, but x1 `perm: []` | `Unresolved{Conflicting}` @s1/r1 | Unknown(Conflicting) | x1 rejected `Unauthorized`; heads {@2a, @2b}; `Fork` active | K1; `CorrectRecord` s1/r1 |
| 83 | Fork with retraction authority missing | As 81, but x1 `perm omitted` | `Unresolved{Missing, Conflicting}` @s1/r1 | Unknown | `Fork` and `RetractionAuthorityMissing` both active; possible {@2a, @2b, excluded} | K1; `CorrectRecord` s1/r1 |
| 84 | Before-state for case 81 | As 81 without the retraction | `Unresolved{Conflicting}` @s1/r1 | Unknown(Conflicting) | `Fork`; possible classes {Supporting, Refuting} | K1; `CorrectRecord` s1/r1 |
| 85 | Retracted correction with unknown authority | s1/r1@1 `Affirmed`; s1/r1@2 `Denied`, supersedes @1, `perm omitted`; retraction x2 of @2, `+amend` | `Unresolved{Missing}` @s1/r1 | Unknown(Missing) | `CorrectionAuthorityMissing` active; possible {@1, excluded}. **Not** `Known(true)` | K1; `CorrectRecord` s1/r1 |
| 86 | Control: known-authorized correction, then retracted | As 85, but @2 `+amend` | `Unresolved{Missing}` | Unknown(Missing) | @1 superseded; @2 retracted; key `Retracted`; no reinstatement | K1 |
| 87 | Control: known-unauthorized correction, then retracted | As 85, but @2 `perm: []` | `Known(true, [s1/r1@1])` | True | @2 rejected `Unauthorized`; x2 has no effect | None |
| 88 | Fork fallback after a historical conflict | Two occurrences of s1/r1@1 (`Affirmed`, `Denied`); @2a `Affirmed` and @2b `Denied` both supersede @1, `+amend` | `Unresolved{Conflicting}` @s1/r1 | Unknown(Conflicting) | `Fork` active over {@2a, @2b}; `PayloadConflict` at s1/r1@1 historical | K1; `CorrectRecord` s1/r1 |
| 89 | Fork fallback resolved by an authorized retraction | As 88, plus retraction x1 of @2b, `+amend` | `Known(true, [s1/r1@2a])` | True | s1/r1 `Current(@2a)`; `PayloadConflict` historical; no fork | None |
| 90 | Both surviving heads retracted | As 88, plus retractions x1 of @2b and x2 of @2a, both `+amend` | `Unresolved{Missing}` | Unknown(Missing) | Key `Retracted`; @1 not reinstated | K1 |
| 91 | Fork fallback with an unauthorized retraction | As 89, but x1 `perm: []` | `Unresolved{Conflicting}` @s1/r1 | Unknown(Conflicting) | x1 rejected `Unauthorized`; fallback `Fork` active | K1; `CorrectRecord` s1/r1 |
| 92 | Retraction authority missing after a historical conflict | As 89, but x1 `perm omitted` | `Unresolved{Missing}` @s1/r1 | Unknown(Missing) | `RetractionAuthorityMissing` active; no fallback fork; possible {@2a, @2b, excluded} | K1; `CorrectRecord` s1/r1 |

**G. Concept presence and identifier syntax (2.3)** (D0 unless stated; each record `Affirmed`)

| # | Case | Records / changes | `Evidence<Boolean>` | `Decision` | Trace must show | Need |
|---|---|---|---|---|---|---|
| 93 | Concept absent | s1/r93, `concept` omitted | `Unresolved{Missing}` @s1/r93@1 (`FieldAbsent:concept`) | Unknown(Missing) | Candidacy unresolved | K1; `CorrectRecord` s1/r93 |
| 94 | System absent | s1/r94, concept `{code: item-x}` | `Unresolved{Missing}` @s1/r94@1 (`FieldAbsent:concept.system`) | Unknown(Missing) | Candidacy unresolved | K1; `CorrectRecord` s1/r94 |
| 95 | Code absent | s1/r95, concept `{system: demo-cs}` | `Unresolved{Missing}` @s1/r95@1 (`FieldAbsent:concept.code`) | Unknown(Missing) | Candidacy unresolved | K1; `CorrectRecord` s1/r95 |
| 96 | Component `null` | s1/r96, concept `{system: null, code: item-x}` | `Unresolved{Invalid}` @s1/r96@1 (`CodeMalformed`) | Unknown(Invalid) | `null` is malformed, not absent | K1; `CorrectRecord` s1/r96 |
| 97 | Absent and malformed components | s1/r97, concept `{code: 7}` | `Unresolved{Missing, Invalid}` @s1/r97@1 (`FieldAbsent:concept.system`, `CodeMalformed`) | Unknown (same) | Both causes kept | K1; `CorrectRecord` s1/r97 |
| 98 | Empty identifier | (a) s1/r98, code `""`; (b) s1/r98, system `""` | `Unresolved{Invalid}` @s1/r98@1 (`CodeMalformed`) | Unknown(Invalid) | **Not** out of domain | K1; `CorrectRecord` s1/r98 |
| 99 | Whitespace-only identifier | (a) s1/r99, code `"   "`; (b) code `"\u00a0\u2003"` | `Unresolved{Invalid}` @s1/r99@1 (`CodeMalformed`) | Unknown(Invalid) | Unicode `White_Space`, not only ASCII | K1; `CorrectRecord` s1/r99 |
| 100 | Surrounding whitespace is not trimmed | s1/r100, code `" item-x"` | `Unresolved{Missing}` | Unknown(Missing) | Well-formed; out of domain; base cause `NoInDomainRecord` | K1 |

In cases 93–99 the record is admissible and `Supporting` if selected, so it is material. Its S2 causes are attributed, and its own-data reason emits `CorrectRecord` (6.2). Invalid expansions are configuration errors (2.3). They have no evaluation fixture, because the fixture format has no configuration-failure kind.

**H. The `encounter` rule on its own (2.4)** (D0 unless stated; each record `Affirmed`)

| # | Case | Records / changes | `Evidence<Boolean>` | `Decision` | Trace must show | Need |
|---|---|---|---|---|---|---|
| 101 | Malformed record encounter | s1/r101, `encounter: 7` | `Unresolved{Invalid}` @s1/r101@1 (S3, `FieldMalformed:encounter`) | Unknown(Invalid) | Encounter check unresolved (`Invalid`); admissibility unresolved | K1; `CorrectRecord` s1/r101 |
| 102 | Evaluation encounter unknown | s1/r102 (N1); context encounter `{unknown: [Conflicting]}` | `Unresolved{Conflicting}` @context encounter | Unknown(Conflicting) | Not rewritten as `Missing`; as case 12, for the encounter binding | **No** evidence Need; deferred (encounter) |
| 103 | Known record encounter, unknown evaluation encounter | As 102, but s1/r103 encounter N0 | `Unresolved{Conflicting}` @context encounter | Unknown(Conflicting) | Encounter check unresolved, **not** a mismatch; never `Inadmissible` | As 102 |
| 104 | Payload variants that differ in encounter | Two occurrences of s1/r104@1: N1 and N0 | `Unresolved{Conflicting}` @s1/r104 (`PayloadConflict`) | Unknown(Conflicting) | N1 variant matches, N0 variant does not; possible classes {Supporting, excluded}, as case 28 | K1; `CorrectRecord` s1/r104 |

In cases 101–103 the record is `Supporting` if admitted, so it is material. 104 follows cases 27 and 28: an inadmissible possibility of an unresolved key adds `excluded`, not a base `Inadmissible` cause.

### 7.5 Invariance checks

These must hold for every case:

| Change | Expected |
|---|---|
| Permute records, retractions, coverage statements, failures or rejected items | Identical result, causes, attribution and canonical trace (5.3) |
| Add an identical duplicate row of an existing `RevisionRef` | Unchanged |
| Add a row with an existing `RevisionRef` but a different payload | **Changes** that key to `Conflicting` (case 27). Correct: it is new contradictory data, not a duplicate |
| Add records of an undeclared source, another subject (not key-linked) or another record type | Unchanged; outside the envelope |
| Add a failure proven irrelevant by a stated dimension | Unchanged result; one more irrelevant-gap trace entry |
| Add the content of a gap proven irrelevant | Unchanged result: by the key-closed definition it holds no envelope occurrence (4.1) |
| Make a proven cross-boundary attempt available | Unchanged result; only the rejection diagnostic is added (pairs 64/20, 64/21, 1/22, 1/63) |
| Permute occurrences of a conflicted revision | Identical variant IDs, order and result (cases 70/71) |
| Add a duplicate row differing only in acquisition provenance | Unchanged result (case 59) |
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
2. Chain boundary for this policy: type, subject and source are immutable; corrections and retractions are same-source only. A proven violation is rejected without changing its target, keeps its diagnostic and adds no cause. Undeterminable identity or authority stays unresolved. Gap irrelevance by type, subject or source is consistent with S1, with the one residual effect stated in 4.1.
3. The schematic authority rule `demo-policy/same-source-amend@1`, distinguishing authorized, proven unauthorized (rejected, no effect) and undeterminable authority (missing → `Missing`, malformed → `Invalid`, both outcomes possible).
4. Deterministic S1: duplicate and payload-conflict handling, edge classification, cycle detection by strongly connected component, heads, retractions, and possible currents `H ∪ {excluded, unknown}`. No current revision is invented.
5. A key-closed input envelope over a declared finite source set.
6. Coverage combination per cell (`Incomplete` > `Unknown`/malformed > `Complete` > Absent = Unknown), with no intra-snapshot supersession, explicit snapshot replacement, and current gaps distinct from attempt history.
7. Gap relevance: record type, subject or a disjoint source can prove irrelevance; value set, episode and encounter never do; unstated dimensions never do.
8. `explicit-assertion-v0` as one strict demonstration policy, with symmetric gap blocking and the materiality and cause-accumulation rules.
9. Need identity, the `ResolveConflict` example, deferred `CorrectRecord` fulfillment and no Need under unresolved scope.
10. Canonical ordering for representation only.
11. Payload equality, normative in [CANONICALIZATION.md](conformance/explicit-assertion-v0/CANONICALIZATION.md). Equality is defined over normalized payload values. The SHA-256 digest of RFC 8785 bytes only identifies variants.
12. Key-closed gap dimensions, under which irrelevance is exact. Conflicted revisions stay conflicts, and undeterminable envelope membership stays unresolved.
13. S1 defect scoping: only defects involving a possible current revision affect the result; others are historical diagnostics.
14. Fork fallback: several remaining heads with no current-affecting defect are a fork (`Conflicting`), so an unresolved S1 result never has an empty cause set.
15. S2 input rules (2.3):
    - Absent concept information is `Missing`, with a field-path reason.
    - A malformed component is `Invalid` (`CodeMalformed`).
    - Findings from different components accumulate.
    - Fictional identifiers must contain a non-`White_Space` character and are never normalized.
    - The same syntax binds the supplied expansion, where a violation is an invalid configuration.
16. The `encounter` rule on its own (2.4):
    - Outcomes are Matches, DoesNotMatch or Unresolved per possibility, and out-of-domain possibilities are not evaluated.
    - A malformed record encounter is `Invalid` (`FieldMalformed:encounter`).
    - Context causes are kept unchanged, and record and context findings accumulate.
    - Open: encounter-identifier syntax, and how one rule’s mismatch combines with another rule’s unresolved outcome.

**Possible conflicts needing a Stage A amendment.** None found. Items to confirm:

- (a) The disjointness obligation relies on §6.5’s enum analysis being mandatory for this policy.
- (b) Using `ref` for every dependency follows the minimal model’s proposed narrowing of §2.2, which is not yet accepted.
- (c) Bounded policy choice: coverage status drives sufficiency. A cell that cannot be established `Complete`, including one with contradictory statements, is a gap with cause `InsufficientEvidence`. Contradictory statements remain explicit diagnostics. Underlying causes are retained where they apply (e.g. `Invalid` from a malformed statement). No new cause is introduced and Stage A semantics are not broadened.

**Query/predicate split.** The query carries the reasoning. A projection-only Predicate is optional naming and composition structure. No node kind is added or removed.

**Conformance fixtures.** [conformance/explicit-assertion-v0/](conformance/explicit-assertion-v0/README.md) holds machine-readable fixtures for cases 1–104, mapped by case number, with expected outputs written from this contract. They are proposed, like this document.

**Remaining items.**

1. **`CorrectRecord` fulfillment (`fulfilled_by`, §7)** remains deferred. Fixtures verify emission only.
2. **The contract digest `d1`** is a symbolic label. Computing a contract digest needs the canonical source/IR schema (Stage A §17 item 7).
3. **Numeric payload fields.** `DemoAssessment` has none. A future record type with numeric fields would need a numeric-equality rule beyond RFC 8785 serialization.
4. **The reevaluation sequence (6.3)** spans orchestrator attempt events, which have no fixture format yet. It is not part of the fixture set.

**Next smallest task.** Specify the minimal orchestrator-event format, so the 6.3 Need sequence can become a multi-revision fixture.
