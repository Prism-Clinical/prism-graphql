# Evidence-query-to-predicate contract (draft)

**Status:** Proposed design draft. **Not** accepted, not finalized syntax, not a schema and not implemented. It contains no clinical content: the record type, enum values and codes below are fictional and illustrate language behavior only. They do not map to dysphagia, progression, urgency or any other clinical definition.

**Date:** 2026-10-03. **Revised:** 2026-10-03, twice, after review. The second revision made four sets of rule changes:

- **Gaps:** relevance is defined per dimension, gaps block positive and negative results symmetrically, and gap causes are kept even alongside an established conflict.
- **Correction history:** it is resolved over a broad input envelope before semantic filtering.
- **Needs:** identity is separated from changing causes, with a reevaluation sequence.
- **Causes:** underlying causes are preserved and accumulated.

**Authority:** [RFC](../../specs/2026-09-28-pathway-language-rfc.md) (accepted architecture) and [Stage A](../../specs/2026-09-30-pathway-language-stage-a-spec.md) §§2–7 (draft contracts). This document builds on the [minimal GERD language model](gerd-minimal-language-model.md), including its settled behavior for an established alarm with unknown applicability (its §6.1). Where this draft and Stage A disagree, Stage A governs until amended (section 8).

**Problem:** Given a frozen collection of typed evidence records, coverage information, an explicit evaluation context and a declared query contract, specify how PPL produces `Evidence<Boolean>` and how a Predicate consumes it as a `Decision`, with every step that affects the answer inspectable.

## 1. Evidence entering the boundary

The core receives frozen inputs only (RFC §3; Stage A §4.8, §11.2). Retrieval, pagination, retries and terminology lookups happen in adapters and the orchestrator before evaluation. This section states what the inputs must contain, not how adapters obtain them.

### 1.1 Per-record evidence

Records are instances of a record type declared in a pinned evidence-model library (here the fictional `demo-model@0.1`). The example type `DemoAssessment` has these fields:

| Field | Type | Notes |
|---|---|---|
| `id`, `revision` | `RecordId`, `RevisionId` | Stable identity |
| `supersedes` | optional `RevisionRef` | A correction: this revision replaces the referenced revision of the same `id`. Any field may change, including `concept`, `episode` and `encounter` |
| `subject` | `SubjectRef` | Required |
| `source` | `SourceRef` | Source system of this revision |
| `episode`, `encounter` | `Field<EpisodeRef>`, `Field<EncounterRef>` | May be absent; absence is explicit, never defaulted to the current episode or encounter |
| `concept` | `Code` | What was assessed; matched against a pinned value-set expansion |
| `assertion` | `Field<AssertionValue>` | `AssertionValue = Affirmed \| Denied \| Indeterminate` (fictional enum) |
| `assertionKind` | `AssertionKind` | Fictional enum, e.g. `ClinicianDocumented \| PatientReport` |
| `author` | `ActorRef` + `Field<Role>` | Assertion and correction authority |
| `provenance` | source record reference, acquisition ID | Retained in every trace |
| `effectiveTime`, `recordedTime` | `PartialDateTime` | Carried and traced; not used by the policy in section 4 |

`Field<T> = Present(T) | Absent`. A present value of the wrong type, or an enum code outside the pinned enum, is **malformed clinical data**. It produces a field-level `Invalid` diagnostic on that record and does not stop compilation or evaluation.

Retractions are separate items `Retraction { id, target: RevisionRef, author, source, provenance, recordedTime }`.

### 1.2 Input envelope and snapshot-level inputs

A query’s **input envelope** is its record type × the context subject × its declared source scope (`sources` in the contract; `all` in the example). The envelope is deliberately broader than the query’s value set, episode and encounter. A correction can move a record into or out of those, so the history needed to resolve it must be present (section 2, S1). The frozen snapshot must contain **every record revision and retraction in the envelope**. It is not pre-filtered by concept or scope.

| Input | Content | Not the same as |
|---|---|---|
| `coverage[]` | Statements over (record type, subject, source), each `Complete \| Incomplete \| Unknown`, attested by the adapter contract (Stage A §12), plus `synthetic_snapshot` provenance where applicable (§4.8). `Complete` means every record revision and retraction in that part of the envelope is present. A statement narrower than the envelope part it would need to cover (e.g. one value set) does not establish `Complete` for that part | An explicit negative assertion; a successful retrieval |
| `acquisitionFailures[]` | Outcome (`Failed \| TimedOut \| Refused`), attempt ID, and whichever of record type, subject, source, value set, episode and encounter the adapter can state. Unstated dimensions are unknown | Empty results |
| `rejectedItems[]` | Reason, and whichever dimensions are known, for items the adapter could not parse into a record with identity, subject and type version | Malformed fields inside an identified record (1.1) |

**Coverage states.** For each source in the query’s source scope, the envelope part (record type, subject, source) is:

| Coverage state | Meaning | Effect |
|---|---|---|
| `Complete` | A `Complete` statement covers this part | Not a gap |
| `Incomplete` | The adapter attests the part is not fully present | Gap, cause `InsufficientEvidence` |
| `Unknown` | The adapter attests that completeness is unknown | Gap, cause `InsufficientEvidence`; no more permissive than `Incomplete` |
| Absent | No statement covers this part | Treated exactly as `Unknown` |

If the set of sources itself is unknown, a `Complete` statement for `all` sources is required; otherwise the remainder is an `Unknown` gap.

**Acquisition completeness is not an explicit negative.** `Complete` coverage with no supporting or refuting record means only that nothing relevant was recorded in the envelope. Under this policy it yields `Unresolved{Missing}`, never `false` (section 4, rule 5).

### 1.3 Evaluation context

`subject`, `episode: Known(EpisodeRef) | Unknown(causes)`, `encounter: Known(EncounterRef) | Unknown(causes)`, the pinned evaluation clock and the execution mode (`clinical | preview | nonclinical`). The orchestrator supplies these inputs and records them in the session revision.

The `episode` binding may itself come from an evaluated declaration, for example from pregnancy-episode evidence. In that case the query depends on that declaration through an explicit reference, and its `Unknown` causes (e.g. `Conflicting`) carry through unchanged. The reference must stay acyclic, so the referenced declaration cannot read this query. Pathway applicability *A* is a separate `Decision`. The query reads scope inputs, never *A*’s truth value, unless the author writes an explicit reference and *A* does not depend on the query.

### 1.4 Data problems versus program problems

| Problem | Example | Class | Effect (cause) |
|---|---|---|---|
| Field absent | `assertion` missing | Patient evidence | `Missing` for that record (3.4) |
| Field malformed | `assertion = "Maybe"`; a syntactically invalid code | Patient evidence | `Invalid` for that record |
| Terminology information unavailable | A well-formed code from a system the pinned expansion does not cover | Patient evidence | `Unavailable` for that record’s candidacy (S2) |
| History incomplete | A correction or retraction target absent from the snapshot | Patient evidence | `Missing` for that record’s revision history (S1) |
| History contradictory | Competing revisions, or one `(id, revision)` with different payloads | Patient evidence | `Conflicting` for that record’s revision history (S1) |
| Unparseable item, or a type version the release cannot interpret | No `id`; `demo-model@0.2` | Patient evidence (snapshot) | `rejectedItems`; a gap with cause `Invalid` if relevant (section 4); unrelated results still evaluate (§12) |
| Wrong-type expression, unknown field, cycle | Section 7, case 32 | Invalid program | Compilation fails |

No stage invents a default for missing patient information: no assumed encounter, no assumed `Denied`, no assumed current revision.

## 2. Processing boundaries

These stages follow Stage A §4.4’s order:

1. identities and correction/retraction authority, then revision history;
2. concept, subject/episode, scope and admissibility;
3. precedence and sufficiency.

Authored criterion evaluation sits between selection and resolution. Every stage is a function of *sets* keyed by identity: no stage reads input order, and every record keeps a recorded stage and reason in the trace.

| # | Stage | Inputs | Outputs | Kind of behavior |
|---|---|---|---|---|
| S1 | Identity and correction history | All revisions and retractions in the envelope, before any concept or scope filter; correction-authority policy | Per `id`: `Current(revision) \| Retracted \| UnresolvedRevision(causes, possibleCurrent)` (2.1) | Fixed behavior; authority rule is a versioned policy |
| S2 | Candidate identification | S1 results; retrieve value set (pinned expansion) | For each `Current` revision, and for each possible current revision of an unresolved `id`: *in domain* if its `concept` is in the expansion, *out of domain* otherwise, *unresolved* (`Unavailable`) if its code system is not covered, *unresolved* (`Invalid`) if the code is malformed. An `id` is a candidate if any possible current revision could be in domain | Fixed behavior over authored, pinned parameters |
| S3 | Admissibility | Candidates; context; authored admissibility rules (2.2) | For each candidate revision: `Admissible \| Inadmissible(reasons) \| UnresolvedAdmissibility(causes)` (§4.6), with causes preserved from their origin | Fixed comparison semantics over authored rules |
| S4 | Selection/precedence | S3 results | `selected` = `ids` whose single current revision is `Admissible`. `unresolved` = every `id` with an unresolved revision, candidacy or admissibility. Inadmissible candidates are kept with reasons | Versioned policy `explicit-assertion-v0` (section 4) |
| S5 | Criterion evaluation | `selected` and `unresolved`; authored `establishes` and `refutes` expressions | Each revision classified `Supporting \| Refuting \| NonInformative \| Unclassified(causes)` (3.3). Unresolved records are classified only to judge materiality and are never counted as selected | Authored expressions; fixed classification rule |
| S6 | Sufficiency and resolution | S5; coverage; acquisition failures; rejected items | `Evidence<Boolean>`: `Known(value, supportingEvidenceIds, provenance)` or `Unresolved(causes, candidateEvidenceIds)` (§4.1); Need state (6.3) | Versioned policy `explicit-assertion-v0` |
| S7 | Projection to Decision | `Evidence<Boolean>` | `Decision` (5.2) | Fixed language behavior |

### 2.1 S1 rules: identity, correction and retraction

Apply these rules per `id`, as set operations:

1. **Duplicates.** Rows with the same `(id, revision)` and identical payloads are one revision. Rows with the same `(id, revision)` and *different* payloads give `UnresolvedRevision(Conflicting)`, with each payload as a possible current revision. Input order never chooses.
2. **Correction authority.** A revision with `supersedes` is accepted if its author satisfies the versioned correction-authority policy relative to the target. An unauthorized correction is rejected with a reason and ignored; the target stands. If authority cannot be determined (e.g. the author’s `Role` is absent), the result is `UnresolvedRevision(Missing)`, with the target and the correction both possible.
3. **Missing correction target.** If `supersedes` names a revision not in the snapshot, the chain and its authority cannot be checked, and the unknown revision could carry any content. The result is `UnresolvedRevision(Missing)`, with the unknown revision as a possible current revision; it is treated as classifiable as anything (S5).
4. **Competing revisions.** If two or more accepted revisions are both unsuperseded (a fork), the result is `UnresolvedRevision(Conflicting)`, with each head as a possible current revision.
5. **Retraction.**
   - An authorized retraction of the current revision makes the `id` `Retracted`. The earlier revision is not reinstated; reinstatement needs an explicit new revision.
   - A retraction of a superseded revision does not change the current revision, and it is traced.
   - An unauthorized retraction is rejected with a reason.
   - A retraction whose target revision is absent, but whose `id` is in the envelope, gives `UnresolvedRevision(Missing)`, because it might target an unseen newer revision.
   - A retraction for an `id` with no revision in the envelope is traced only. Missing whole records are a coverage matter, not an S1 matter.
6. Otherwise the single unsuperseded accepted revision is `Current`.

Superseded, rejected and retracted revisions remain in the trace with their reasons. A `Complete` coverage claim that contradicts an absent target (rule 3) is also reported as an attestation inconsistency.

### 2.2 S3 admissibility rules in this example

The author sets these rules in the contract. Their comparison semantics are fixed by the language.

- `subject` equals the context subject. A mismatch is `Inadmissible(WrongSubject)`.
- `episode` equals the context episode, with no prior-episode history (§4.7).
  - The record’s field is absent: `UnresolvedAdmissibility(Missing)`.
  - The context episode is `Unknown(causes)`: `UnresolvedAdmissibility(causes)`. For example, a conflicting episode source stays `Conflicting`.
  - A different known episode: `Inadmissible(OtherEpisode)`.
- `encounter` equals the context encounter: the same rule, with reason `OtherEncounter`. This identity rule stands in for “stale”; the example uses no duration windows.
- `assertionKind` must be in the authored allowed set. Otherwise the result is `Inadmissible(AssertionKindNotAllowed)`.

If several rules are unresolved for one candidate, their causes accumulate. “Unresolved admissibility” is the stage outcome; the causes stay those of the underlying input.

## 3. Where the clinical expression lives

### 3.1 Criteria are expressions in source

The contract carries two authored criteria, each a `Decision` over one candidate:

- `establishes(c)`: the candidate is positive evidence.
- `refutes(c)`: the candidate is an explicit negative.

Both are typed expression trees in the canonical source (Stage A §2.2). Prose, callbacks and opaque classifiers are compile errors. The supported fragment for this contract is:

- typed field access `c.f`;
- enum literals;
- `==` between the same enum type (`ppl-core-v0` typed finite-enum equality, §6.5, §12);
- `all`, `any` and `not` (§4.3);
- `call` of a pinned library expression.

There are no quantities, temporal operators, string matching or collections.

### 3.2 Binding environment and result type

| Name | Type | Source |
|---|---|---|
| `c` | `DemoAssessment` (read-only) | The candidate revision being classified |
| Enum literals | e.g. `AssertionValue.Affirmed` | Pinned evidence-model library |
| Library expressions | Declared signature, e.g. `(DemoAssessment) → Decision` | Pinned library version |

The criteria cannot read the context, other candidates, other queries or *A*. Result type: `Decision`.

**Library references.** `{ "call": "lib.demo.isAffirmed", "version": "1.2.0", "args": [{ "var": "c" }] }` resolves at compile time to a non-recursive library declaration (§2.1) with a declared signature and *read set*, for example `{DemoAssessment.assertion}`. The package manifest pins its version and digest (§12.1). The compiler links it with a source map, so traces name both the call site and the library definition. Changing the library version changes the reviewed artifact identity.

**Compiler-visible dependencies.** The query’s data requirement is its input envelope (record type, subject, source scope, all revisions and retractions) plus the union of field read sets from S1’s authority rule, its admissibility rules, both criteria and every called library expression. This is the CQL idea that data requirements are inspectable from the retrieve, extended to the fields read after retrieval. A criterion that reads an undeclared field fails compilation.

### 3.3 Classification rule (S5)

| `establishes(c)` | `refutes(c)` | Classification |
|---|---|---|
| True | False | `Supporting` |
| False | True | `Refuting` |
| False | False | `NonInformative` |
| Unknown (either) | — | `Unclassified(causes)` |
| True | True | Prevented by a compile-time obligation (below) |

For this policy, the contract declares a `disjoint(establishes, refutes)` obligation. With enum-equality criteria it is decided by the v0 finite-enum disjointness analysis (§6.5). If that analysis cannot prove it (`INCONCLUSIVE`), publication is blocked. If both criteria are nonetheless True at runtime, the run fails as an engine invariant violation. It is never treated as patient conflict.

The obligation belongs to `explicit-assertion-v0`. It is not proposed as a universal requirement for every future evidence contract.

### 3.4 Absent fields versus false comparisons

| Record’s `assertion` | `c.assertion == Affirmed` | `c.assertion == Denied` | Classification |
|---|---|---|---|
| `Present(Affirmed)` | True | False | Supporting |
| `Present(Denied)` | False | True | Refuting |
| `Present(Indeterminate)` | False | False | NonInformative |
| `Absent` | Unknown(Missing @`assertion`) | Unknown(Missing) | Unclassified(Missing) |
| Malformed code | Unknown(Invalid) | Unknown(Invalid) | Unclassified(Invalid) |

Field access on `Absent` lifts to `Unknown`; a comparison is never False because a field is missing.

**Failing the positive criterion is not a negative.** `not(c.assertion == Affirmed)` is True for `Indeterminate`, which would wrongly count an indeterminate record as a negative, and Unknown for `Absent`. An explicit negative is therefore authored separately as `refutes`, here `c.assertion == Denied`. Only a `Refuting` classification can contribute to `Known(false)`.

## 4. One bounded policy: `explicit-assertion-v0`

**Question this policy answers:** do the admissible assertions in scope establish a value *without contradiction*? It is not an existence query. It is platform-versioned language-catalogue behavior, specified here, and authors select it by name and version. It has no authority precedence and no authoritative-assertion exception; those would need a separate policy.

**Selection.** Every admissible candidate counts equally. There is no “latest wins”, no source or author precedence and no frequency weighting.

### 4.1 Gap relevance

A **gap** is any of the following:

- an envelope part (record type, subject, source) whose coverage is `Incomplete`, `Unknown` or absent;
- an acquisition failure;
- a rejected item.

A gap is **irrelevant** only if it is *proven* disjoint from the query on at least one of these dimensions:

| Dimension | Proves irrelevance when… |
|---|---|
| Record type | The gap’s record type is known and differs from the query’s |
| Subject | The gap’s subject is known and differs from the context subject |
| Source | The gap’s source is known, is outside the query’s source scope, **and** the correction-authority policy cannot accept a revision from that source for an `id` in the envelope |
| Value set, episode, encounter | **Never under this policy.** A correction can move a record into or out of them (S1), so a gap narrowed to another value set, episode or encounter could still hide a revision of an in-scope record |

A dimension the gap does not state is unknown and proves nothing. Every gap not proven irrelevant is **relevant**, so relevance is never assumed by default. Irrelevant gaps are recorded in the trace and affect nothing.

**Gap causes:**

| Gap | Cause |
|---|---|
| Acquisition failure | `Unavailable` |
| `Incomplete`, `Unknown` or absent coverage | `InsufficientEvidence` |
| Rejected item | `Invalid` |

A relevant gap could conceal an assertion of either polarity.

### 4.2 Resolution

Write *S* for the `Supporting` and *R* for the `Refuting` revisions among `selected`, and *G* for the set of relevant gaps.

**Unresolved records** are the S4 `unresolved` set plus any selected record classified `Unclassified`.

**Step A — base result** (unresolved records excluded from *S* and *R*, but counted as seen):

1. *S* and *R* both nonempty: `Unresolved{Conflicting}`.
2. *S* nonempty, *R* empty, *G* empty: `Known(true, S)`.
3. *R* nonempty, *S* empty, *G* empty: `Known(false, R)`.
4. Exactly one of *S*, *R* nonempty and *G* nonempty: `Unresolved`, with no base cause beyond the gap causes added in step C.
5. *S* and *R* both empty: `Unresolved`, with these base causes:
   - `Missing` if no in-domain record was seen at all, i.e. no current or possible-current revision in domain. This covers an empty snapshot, everything retracted and everything corrected out of domain.
   - `Inadmissible` if an inadmissible candidate was seen.
   - `InsufficientEvidence` if a non-informative record was seen, or an unresolved record that could only be non-informative or excluded.

**Step B — unresolved records.** Each unresolved record *u* has a set of **possible classes**:

- `excluded` if any possible current revision could be out of domain, inadmissible or retracted;
- the S5 classification of each possible current revision that could be selected;
- all of `Supporting`, `Refuting` and `NonInformative` if any possible revision is `Unclassified` or unknown (S1 rule 3).

| Base result | *u* is **material** when its possible classes include… | Effect |
|---|---|---|
| `Known(true)` | `Refuting` | The result becomes `Unresolved` |
| `Known(false)` | `Supporting` | The result becomes `Unresolved` |
| `Unresolved` (any, including `Conflicting`) | `Supporting` or `Refuting` | The result stays `Unresolved`; *u*’s causes are added |

**Step C — causes.** An `Unresolved` result’s cause set is the union of:

- the base causes;
- the causes of every relevant gap in *G*;
- the origin causes of every material *u*, each attributed to its record and stage.

An established conflict (rule 1) stays `Conflicting`, and gap and record causes are added to it. Resolving the conflict later would still leave those other blockers, so they are relevant to the requirement. Immaterial records and irrelevant gaps add no cause; they remain in the trace with stage and reason.

**Why symmetric.** An unread relevant source could hold the opposing assertion. A positive result could then really be `Conflicting`, and so could a negative one. So under this policy, neither `Known(true)` nor `Known(false)` is established while a relevant gap exists. Stage A §4.2 describes when *positive existence* can be known despite an unavailable source. That describes existence queries, not this policy’s question, so it is not used here. For negatives, §4.2 requires sufficient coverage or an authorized explicit negative; this policy requires an explicit `Refuting` record **and** no relevant gap.

Consequence: a `Known` result requires `Complete` coverage for every source in scope of the envelope. Until adapters provide that attestation (Stage D), live results will usually be `Unresolved`. That is the intended, honest outcome.

**Determinism.** Every rule depends only on sets keyed by identity, on classifications and on gap dimensions. It never depends on input order. Records outside the envelope never enter S1, and gaps proven irrelevant contribute nothing (section 7.4).

### 4.3 Cases the policy answers

| Situation | Result |
|---|---|
| One supporting assertion, no relevant gap | `Known(true)` |
| One explicit negative, no relevant gap | `Known(false)` |
| Repeated consistent assertions | `Known` with every distinct ID; count adds no weight |
| Contradictory admissible assertions | `Unresolved{Conflicting}` plus any relevant gap and record causes |
| No supporting or refuting assertion, even with `Complete` coverage | `Unresolved` (rule 5), never `false` |
| Material unresolved record | `Unresolved` with its origin causes |
| Relevant gap | Blocks either `Known` result |
| Proven-irrelevant gap | Blocks neither |

**Unsupported by this policy** (rejected at compile time if requested): temporal windows and freshness durations; latest or definite-latest selection; source or authority tiers, including decisive authoritative assertions; provider precedence requests (§4.4); tie rules; counts or thresholds over multiple assertions; scoped absence from coverage; terminology mapping beyond the pinned expansion; partial-date reasoning; cross-record pairing; related subjects; model-extracted observations. Each would need its own reviewed contract.

## 5. Typed outputs and traces

### 5.1 `Evidence<Boolean>` (Stage A §4.1, reused unchanged)

`Known(value, supportingEvidenceIds, provenance) | Unresolved(causes: NonEmptySet<Cause>, candidateEvidenceIds)`. No new cause is introduced. Each cause in the set is attributed in the trace to its origin: the record, gap or context input it came from, the stage, and the reason. The query trace records:

- the envelope, retrieve parameters and pinned versions;
- every S1–S6 decision per record: revision history (accepted, superseded, rejected, retracted, possible current), candidacy, admissibility result and reasons, selection membership, `establishes`/`refutes` values with sub-expression results, classification, possible classes and materiality;
- coverage per envelope part, every gap with its relevance decision and the dimension that proved irrelevance, and gap causes;
- the applied rule number from section 4.

### 5.2 Projection to `Decision` (S7)

| `Evidence<Boolean>` | `Decision` |
|---|---|
| `Known(true, ids, prov)` | `True`, supported by `ids` |
| `Known(false, ids, prov)` | `False`, supported by `ids` |
| `Unresolved(causes, ids)` | `Unknown(causes)`, with `ids` as unresolved dependencies and the same cause attribution |

The Predicate `p = evidenceValue(ref q)` adds nothing else and removes nothing. Its explanation links the query trace. Downstream composition, such as the GERD model’s `finding = all(A, p)`, keeps `p`’s value, causes and trace even when the composite differs (§4.3; minimal model §6.1).

## 6. Authoring holes versus patient uncertainty

### 6.1 By boundary

| Situation | S1–S2 | S3–S4 | S5 | S6–S7 | Preview | Need | Publication |
|---|---|---|---|---|---|---|---|
| Complete contract, missing patient evidence | Run | Run | Run | `Unresolved` → `Unknown(causes)` | Normal result | Yes, when material (6.3) | Allowed |
| Whole-contract hole | Not run | Not run | Not run | Query output and predicate carry the hole marker | Marker on `q` and dependents; outputs not depending on `q` are computed normally | None | Blocked |
| Nested criterion hole (`establishes` is a hole; envelope, admissibility and policy written) | Run | Run | `refutes` runs; `establishes` gives a marker | Marker, not `Unresolved` | Revision, candidacy, admissibility and selection traces and `refutes` results are inspectable; the result is a marker | None, even with no candidates | Blocked |
| Nested policy hole (e.g. the admissibility `episode` rule is a hole) | Run | Marker from S3 | Marker | Marker | S1–S2 traces inspectable | None | Blocked |
| Invalid binding or unsupported expression | — | — | — | — | No preview; compile diagnostic with location | None | Blocked |

### 6.2 Rules

- Holes propagate to dependents only (Stage A §2.3). Each marker names its hole IDs. A preview is never replaced by one undifferentiated marker.
- A partly authored query never reports patient uncertainty for the undefined part. With a criterion hole and an empty snapshot, the result is the hole marker, not `Unresolved{Missing}`. The empty snapshot is still visible in the S1–S2 trace.
- A hole never becomes a Need or a provider-facing field (§2.3). Need identity requires a complete contract (6.3).

### 6.3 Needs

**Identity.** The evidence Need for an `Unresolved` complete query is keyed by its semantic requirement and bindings:

- the query declaration ID and its versioned contract digest (envelope, value-set version, admissibility rules, criteria, policy name and version);
- the subject;
- the episode binding;
- the encounter binding, which is the anchor in this example.

The cause is **not** part of the key. Causes, contributing records, gap diagnostics and the orchestrator’s recorded acquisition attempts and outcomes are the Need’s evolving **state** (Stage A §7). A change of cause updates that state; it does not create a new Need. This prevents duplicate requests and keeps attempt and deadline tracking continuous.

**Separate obligations exist only for a different fulfillment requirement.** The explicit example is conflict. Under this policy, a further assessment can never remove an established conflict, because every admissible assertion counts. Fulfillment therefore requires an authorized correction or retraction of an existing record. That is a `ResolveConflict` obligation, keyed by the evidence Need key plus the kind `ResolveConflict`, with the conflicting records as state. The same reasoning gives a `CorrectRecord` obligation (key + kind + record ID) when one specific record’s own data blocks the result (e.g. an absent encounter, a malformed assertion or missing history). No other cause creates a separate obligation.

**Unresolved scope.** If a binding needed for the key is unresolved, the evidence Need is **not emitted**, because inventing a scope value or using an unstable placeholder key is forbidden. An example is a context episode `Unknown(Conflicting)`. The query result still reports its causes. The scope’s own source declaration emits its Need, linked through the trace. Once the binding resolves, a reevaluation emits the evidence Need with the resolved key.

**Ownership.** The core emits Needs only when backward dependency tracing shows the query output is material to some requested output (§4.3, §7). The orchestrator chooses the fulfiller (ask the provider, an EHR query or a hybrid), dispatches it, retries, enforces deadlines and records outcomes. Each fulfillment or outcome creates a new evaluation revision.

### 6.4 Reevaluation sequence (same requirement, then a changed one)

Context P1/E1/N1. Key K1 = (`q.demo`, contract digest d1, P1, E1, N1).

| Revision | New input | Result | Need K1 state | Other obligations |
|---|---|---|---|---|
| 1 | Empty snapshot; coverage `Unknown` | `Unresolved{Missing, InsufficientEvidence}` | Opened; causes {Missing, InsufficientEvidence}; no attempts | — |
| 2 | Orchestrator attempt a1 fails (recorded acquisition failure) | `Unresolved{Missing, InsufficientEvidence, Unavailable}` | **Same K1**; causes updated; attempts [a1 Failed] | — |
| 3 | Attempt a2 succeeds: r1 `Affirmed`, r2 `Denied`; coverage `Complete`; the new snapshot no longer lists a1’s failure, whose history stays in the Need state | `Unresolved{Conflicting}` | **Same K1**; causes {Conflicting}; attempts [a1 Failed, a2 Succeeded] | `ResolveConflict` (K1) opened, state [r1, r2] |
| 4 | Authorized retraction of r2 | `Known(true, [r1])` | K1 satisfied | `ResolveConflict` satisfied |
| 5 | Package revised: `assertionKind` allowed set changes, giving contract digest d2 | Reevaluated under d2 | K1 is not reused | Any new Need under d2 has key K2 = (`q.demo`, d2, P1, E1, N1) |
| 6 | A later encounter N2 is evaluated under d2 | Per evidence | — | Key K3 = (`q.demo`, d2, P1, E1, N2), distinct from K2 |

Revisions 1–4 show one requirement with changing causes. Revisions 5–6 show genuinely changed requirements receiving different identities.

## 7. Worked example and acceptance table

### 7.1 Representation (proposed notation, not finalized syntax)

```jsonc
{
  "id": "q.demo", "kind": "EvidenceQuery", "output": "Evidence<Boolean>",
  "contract": {
    "retrieve":   { "type": "demo-model/DemoAssessment@0.1", "sources": "all",
                    "valueSet": "demo-vs/item-x@1" },
    "corrections":{ "authority": "demo-policy/same-source-or-allowed-role@1" },
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
```

Compiler-visible data requirement:

- envelope: every `DemoAssessment` revision and retraction for the subject, from all sources;
- reads: `{id, revision, supersedes, source, author, concept, subject, episode, encounter, assertionKind, assertion}`;
- context inputs: `{subject, episode, encounter}`.

### 7.2 Manual traces

**Trace A — immaterial unresolved record.** Context P1/E1/N1. Coverage `Complete` for (`DemoAssessment`, P1, all sources). No failures.

Snapshot:

| Record | Contents |
|---|---|
| r1 rev1 | `Indeterminate`, N1 |
| r1 rev2 | `Affirmed`, supersedes rev1, same source |
| r2 | `Denied`, encounter N0 |
| r3 | `Affirmed`, N1; authorized retraction x3 targets it |
| r4 | `Affirmed`, `PatientReport`, encounter absent |

| Stage | Result |
|---|---|
| S1 | r1 `Current(rev2)`, rev1 superseded; r2 and r4 `Current`; r3 `Retracted` (x3, authorized) |
| S2 | r1, r2, r4 in domain; r3 traced as retracted |
| S3 | r1 `Admissible`; r2 `Inadmissible(OtherEncounter)`; r4 `UnresolvedAdmissibility(Missing @encounter)` |
| S4 | `selected` {r1}; `unresolved` {r4}; r2 retained |
| S5 | r1 Supporting; r4 Supporting (possible classes {excluded, Supporting}) |
| S6 | *G* empty. Rule 2 gives `Known(true, [r1])`. r4 is not material (no `Refuting`). Final result `Known(true, [r1])`, with r2, r3 and r4 traced |
| S7 | `True`, supported by r1 |

**Trace B — multiple simultaneous causes (case 26).** Same context. Coverage `Incomplete` for (`DemoAssessment`, P1, source s2).

Snapshot:

| Record | Contents |
|---|---|
| r1 | `Affirmed` |
| r11 | `assertion = "Maybe"` |
| r4 | `Denied`, encounter absent |

| Stage | Result |
|---|---|
| S1–S2 | All current and in domain |
| S3 | r1 and r11 `Admissible`; r4 `UnresolvedAdmissibility(Missing)` |
| S4 | `selected` {r1, r11}; `unresolved` {r4} |
| S5 | r1 Supporting; r11 `Unclassified(Invalid)`; r4 Refuting (possible {excluded, Refuting}) |
| S6 | *G* = {coverage gap s2}, relevant: same type, same subject, source s2 is in scope. Base: *S* = {r1}, *R* = ∅, *G* nonempty, so rule 4 gives `Unresolved`. r11 is relevant (all classes possible), adding `Invalid`; r4 is relevant (`Refuting`), adding `Missing`. Result `Unresolved{InsufficientEvidence @s2, Invalid @r11.assertion, Missing @r4.encounter}` |
| S7 | `Unknown` with those three attributed causes |

Need: K1, with state holding the three causes. Obligations: `CorrectRecord` for r11 and for r4.

### 7.3 Acceptance cases

**Defaults unless stated:**

- the contract in 7.1 is complete;
- the context P1/E1/N1 is known;
- coverage is `Complete` for (`DemoAssessment`, P1, all sources);
- there are no failures or rejected items;
- records are current, in-scope, authorized `ClinicianDocumented` records for P1/E1/N1;
- K1 = (`q.demo`, d1, P1, E1, N1).

“Trace” lists what must appear beyond the per-stage records.

| # | Case | Assumptions | `Evidence<Boolean>` | `Decision` | Trace must show | Need / obligation |
|---|---|---|---|---|---|---|
| 1 | Affirmed | r1 `Affirmed` | `Known(true, [r1])` | True | Rule 2 | None |
| 2 | Explicitly Denied | r2 `Denied` | `Known(false, [r2])` | False | Rule 3 | None |
| 3 | Repeated consistent, with identical duplicate | r1, r6 `Affirmed`; a second identical row of (r1, rev1) | `Known(true, [r1, r6])` | True | Duplicate merged | None |
| 4 | Missing assertion field | r3 `assertion` absent | `Unresolved{Missing}` @r3 | Unknown(Missing) | r3 `Unclassified`, all classes possible | K1; `CorrectRecord` r3 |
| 5 | Empty snapshot, `Complete` coverage | No records | `Unresolved{Missing}` | Unknown(Missing) | Rule 5; coverage `Complete` ≠ negative | K1 |
| 6 | Only non-informative | r7 `Indeterminate` | `Unresolved{InsufficientEvidence}` | Unknown | Rule 5 | K1 |
| 7 | Conflicting admissible assertions | r1 `Affirmed`, r2 `Denied` | `Unresolved{Conflicting}`, [r1, r2] | Unknown(Conflicting) | Rule 1 | K1; `ResolveConflict` [r1, r2] |
| 8 | Conflict plus relevant failure | Case 7 plus an acquisition failure (type `DemoAssessment`, subject P1, source unstated) | `Unresolved{Conflicting, Unavailable}` | Unknown | Conflict preserved; gap relevant (source unknown) | K1; `ResolveConflict` |
| 9 | Only inadmissible evidence | r5 `Denied` at encounter N0 | `Unresolved{Inadmissible}`, r5 | Unknown(Inadmissible) | `OtherEncounter` | K1 |
| 10 | Material unresolved admissibility | r1 `Affirmed`; r4 `Denied`, encounter absent | `Unresolved{Missing}` @r4 | Unknown(Missing) | r4 possible {excluded, Refuting} | K1; `CorrectRecord` r4 |
| 11 | Immaterial unresolved admissibility | r1 `Affirmed`; r4 `Affirmed`, encounter absent | `Known(true, [r1])` | True | r4 immaterial | None |
| 12 | Positive with relevant failure | r1 `Affirmed`; failure (`DemoAssessment`, P1, source s2) | `Unresolved{Unavailable}`, [r1] | Unknown(Unavailable) | Rule 4; s2 is in scope | K1, attempt recorded |
| 13 | Negative with relevant failure | r2 `Denied`; same failure | `Unresolved{Unavailable}`, [r2] | Unknown(Unavailable) | Rule 4 (symmetric) | K1 (same key as case 12) |
| 14 | Failure proven irrelevant | r1 `Affirmed`; failure for a different record type | `Known(true, [r1])` | True | Gap irrelevant by record type | None |
| 15 | Failure in another value set only | r1 `Affirmed`; failure (`DemoAssessment`, P1, value set `demo-vs/item-y`) | `Unresolved{Unavailable}` | Unknown | Value set cannot prove irrelevance (a correction could move records) | K1 |
| 16 | Failure with unstated subject | r1 `Affirmed`; failure (`DemoAssessment`, subject unstated) | `Unresolved{Unavailable}` | Unknown | Subject unknown, so relevance not disproved | K1 |
| 17 | Negative with `Incomplete` coverage | r2 `Denied`; coverage for source s2 `Incomplete` | `Unresolved{InsufficientEvidence}` | Unknown | Rule 4 | K1 |
| 18 | Negative with `Unknown` coverage | r2 `Denied`; s2 attested `Unknown` | `Unresolved{InsufficientEvidence}` | Unknown | Same as case 17 | K1 |
| 19 | Negative with absent coverage | r2 `Denied`; no statement for s2 | `Unresolved{InsufficientEvidence}` | Unknown | Absent = `Unknown` | K1 |
| 20 | Corrected to another concept | r8 rev1 `Affirmed`, concept in value set; r8 rev2 (authorized) supersedes it with a concept outside | `Unresolved{Missing}` | Unknown(Missing) | rev1 superseded; r8 “corrected out of domain”; rev1 is **not** positive evidence | K1 |
| 21 | Correction changes scope | r16 rev1 `Affirmed` N1; rev2 (authorized) supersedes it, `Affirmed`, encounter N0 | `Unresolved{Inadmissible}` | Unknown(Inadmissible) | rev1 superseded; rev2 `OtherEncounter` | K1 |
| 22 | Missing correction target | r9 rev2 `Affirmed`, supersedes rev1, which is absent | `Unresolved{Missing}` @r9 history | Unknown(Missing) | S1 rule 3; all classes possible; attestation inconsistency reported | K1; `CorrectRecord` r9 |
| 23 | Unauthorized correction | r13 rev1 `Affirmed`; rev2 `Denied` by an author outside the authority policy | `Known(true, [r13 rev1])` | True | rev2 rejected, with reason | None |
| 24 | Same identity, conflicting payloads | Two rows (r14, rev1): one `Affirmed`, one `Denied` | `Unresolved{Conflicting}` @r14 history | Unknown(Conflicting) | S1 rule 1; independent of row order | K1; `CorrectRecord` r14 |
| 25 | Competing revisions with conflicting scope | r12 rev1 `Affirmed` N1; rev2a (`Affirmed`, N1) and rev2b (`Affirmed`, N0) both supersede rev1, both authorized | `Unresolved{Conflicting}` @r12 history | Unknown(Conflicting) | Fork; possible {Supporting, excluded} | K1; `CorrectRecord` r12 |
| 26 | Multiple simultaneous causes | Trace B | `Unresolved{InsufficientEvidence, Invalid, Missing}` | Unknown (same causes) | Each cause attributed | K1; `CorrectRecord` r11, r4 |
| 27 | Context episode conflicting | r1 `Affirmed`; context episode `Unknown(Conflicting)` from its source declaration | `Unresolved{Conflicting}` @context episode via r1’s S3 result | Unknown(Conflicting) | Cause **not** rewritten as `Missing`; minimal model §6.1(b) | **No** evidence Need (unresolved key binding); the episode source’s Need is linked |
| 28 | Terminology information unavailable | r10 `Affirmed`, code from a system the expansion does not cover | `Unresolved{Unavailable}` @r10 candidacy | Unknown(Unavailable) | Not `Invalid` | K1 |
| 29 | Malformed code | r15 `Affirmed`, syntactically invalid code | `Unresolved{Invalid}` @r15 candidacy | Unknown(Invalid) | Not `Unavailable` | K1; `CorrectRecord` r15 |
| 30 | Whole-contract hole | `contract` is one hole | Preview marker (hole ID) | Marker | No stages run | None |
| 31 | Nested criterion hole | `establishes` is a hole; any snapshot | Preview marker | Marker | S1–S4 and `refutes` traces shown | None |
| 32 | Wrong-type reference | `establishes` is `c.assertion == AssertionKind.PatientReport`, or the predicate references an output that is not `Evidence<Boolean>` | — | — | Compile error: cross-enum equality or binding type mismatch (§6.5, §10.4) | None |
| 33 | Retracted only | r1 `Affirmed`; authorized retraction of its current revision | `Unresolved{Missing}` | Unknown | Retracted; no reinstatement | K1 |

Cases 24, 25 and 27 cover conflicting scope or identity evidence; case 26 covers multiple simultaneous causes.

### 7.4 Invariance checks

These must hold for every case above:

| Check | Expected |
|---|---|
| Permute snapshot rows, coverage statements, failures or retractions | Identical result, causes, attribution and canonical trace |
| Add a record of another record type or another subject | Unchanged; it never enters the envelope |
| Add a failure proven irrelevant (another record type or subject, both stated) | Unchanged result; one more irrelevant-gap trace entry |
| Add an identical duplicate row of an existing `(id, revision)` | Unchanged |
| Add a failure whose type or subject is unstated | **May** change a `Known` result to `Unresolved` (cases 15, 16). Correct: relevance was not disproved |

## 8. Decisions and remaining work

**Existing Stage A requirements applied.**

| Requirement | Stage A |
|---|---|
| Frozen inputs, no core I/O | §11.2 |
| Selection order: identity and correction before scope | §4.4 |
| Per-query admissibility with unresolved candidates kept | §4.6 |
| Absence is not falsity; negatives need sufficient coverage or explicit negatives | §4.1, §4.2 |
| Cause sets and Kleene composition | §4.1, §4.3 |
| No input-order winners | §4.4 |
| Typed holes, preview-only, no Need from a hole | §2.3 |
| Typed finite-enum equality and disjointness analysis | §6.5 |
| Stable Need identity across reevaluation, attempts as outcomes, orchestrator ownership | §7 |
| Pinned library versions | §12.1 |

**Decisions proposed here.**

1. Explicit `Field<T>` presence: absent lifts to `Unknown(Missing)` and malformed to `Unknown(Invalid)`.
2. Two authored criteria, `establishes` and `refutes`. A negative comes only from `refutes`. The disjointness obligation applies to this policy only.
3. A criterion-only binding environment with declared read sets; data requirements, including the envelope, are compiler-visible.
4. Input envelope = record type × subject × source scope, with full revision and retraction history. S1 resolves identity, duplicates, authority, forks, missing targets and retractions before any semantic filter. No current revision is invented.
5. `explicit-assertion-v0`:
   - every admissible assertion counts and there is no precedence;
   - gap relevance is decided per dimension, value set/episode/encounter never prove irrelevance, and unproven relevance counts as relevant;
   - relevant gaps block both results;
   - `Incomplete`, `Unknown` and absent coverage are equivalent gaps;
   - conflict persists with added causes;
   - per-record materiality uses origin-preserving, accumulated causes.
6. Need identity = query, contract digest, subject and scope/anchor bindings; causes and attempts are state. `ResolveConflict` and `CorrectRecord` exist only because their fulfillment differs. There is no evidence Need while a key binding is unresolved.
7. A nested hole yields a marker, not patient uncertainty, while upstream stage traces stay inspectable.
8. No new cause names; attribution lives in the trace.

**Possible conflicts needing a Stage A amendment.** None found. Two items need explicit confirmation:

- (a) The `disjoint` obligation makes a runtime overlap of both criteria an invariant failure. That relies on §6.5’s enum analysis being mandatory for contracts using this policy.
- (b) The use of `ref` for every dependency follows the minimal model’s proposed narrowing of §2.2, which is not yet accepted.

**Is the query/predicate split worth it?** The query carries the reasoning: revisions, candidacy, admissibility, both criteria and resolution, all traced. A Predicate whose whole expression is `evidenceValue(ref q)` is optional naming and composition structure, useful when a condition is referenced in several places, as `p.alarm` is in the GERD model. No node kind is added or removed.

**Remaining ambiguity before conformance fixtures.**

1. **Source scope and correction authority.** The source-dimension irrelevance rule depends on the correction-authority policy’s exact content. `demo-policy/same-source-or-allowed-role@1` needs a concrete rule, e.g. allowed roles and whether a cross-source correction is possible, before source-scoped gap cases can have fixed expectations. With `sources: all`, no source gap is irrelevant, so the cases above do not depend on it.
2. **Coverage-statement shape.** Fixtures need a concrete format for coverage statements and failure dimensions (Stage A §17 item 4). This draft fixes only their semantics.
3. **Fork and duplicate canonicalization.** Canonical trace ordering, for the permutation check, needs an agreed identity ordering of revisions. Any total order on IDs works, but it must be fixed.
4. **`CorrectRecord` fulfillment validation (`fulfilled_by`, §7).** What makes a new revision acceptable as fulfilling it (authority, same `id`) belongs to the Need contract, not this policy.

None of these blocks the policy semantics, but items 1–3 must be fixed for byte-exact fixtures.

**Next smallest task.** Write the conformance case table for `explicit-assertion-v0` alone, in the style of Stage B families B-04, B-11 and B-12. Turn sections 4 and 7.3–7.4 into input/expected-output fixtures once items 1–3 are fixed.
