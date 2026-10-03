# Evidence-query-to-predicate contract (draft)

**Status:** Proposed design draft. **Not** accepted, not finalized syntax, not a schema and not implemented. It contains no clinical content: the record type, enum values and codes below are fictional and illustrate language behavior only. They do not map to dysphagia, progression, urgency or any other clinical definition.

**Date:** 2026-10-03. **Revised:** 2026-10-03 after review, with four changes:

- acquisition and coverage gaps block both results symmetrically, and `Unknown` coverage counts as a gap;
- correction history is resolved before the concept filter;
- Need identity excludes the cause;
- underlying causes are preserved and accumulated.

**Authority:** [RFC](../../specs/2026-09-28-pathway-language-rfc.md) (accepted architecture) and [Stage A](../../specs/2026-09-30-pathway-language-stage-a-spec.md) §§2–7 (draft contracts). This document builds on the [minimal GERD language model](gerd-minimal-language-model.md), including its settled behavior for an established alarm with unknown applicability (its §6.1). Where this draft and Stage A disagree, Stage A governs until amended (section 8).

**Problem:** Given a frozen collection of typed evidence records, coverage information, an explicit evaluation context and a declared query contract, specify how PPL produces `Evidence<Boolean>` and how a Predicate consumes it as a `Decision`, with every step that affects the answer inspectable.

## 1. Evidence entering the boundary

The core receives frozen inputs only (RFC §3; Stage A §4.8, §11.2). Retrieval, pagination, retries and terminology lookups happen in adapters and the orchestrator before evaluation.

### 1.1 Per-record evidence

Records are instances of a record type declared in a pinned evidence-model library (here the fictional `demo-model@0.1`). The example type `DemoAssessment` has these fields:

| Field | Type | Notes |
|---|---|---|
| `id`, `revision` | `RecordId`, `RevisionId` | Stable identity. Equal `(id, revision)` pairs are one record, however many rows carry them |
| `supersedes` | optional `RevisionRef` | A correction: this revision replaces the referenced revision of the same `id`. Any field may change, including `concept` |
| `subject` | `SubjectRef` | Required |
| `episode`, `encounter` | `Field<EpisodeRef>`, `Field<EncounterRef>` | May be absent; absence is explicit, never defaulted to the current episode or encounter |
| `concept` | `Code` | What was assessed; matched against a pinned value-set expansion |
| `assertion` | `Field<AssertionValue>` | `AssertionValue = Affirmed \| Denied \| Indeterminate` (fictional enum) |
| `assertionKind` | `AssertionKind` | Fictional enum, e.g. `ClinicianDocumented \| PatientReport` |
| `author` | `ActorRef` + `Role` | Assertion authority |
| `provenance` | source system, source record reference, acquisition ID | Retained in every trace |
| `effectiveTime`, `recordedTime` | `PartialDateTime` | Carried and traced; not used by the policy in section 4 |

`Field<T> = Present(T) | Absent`. A present value of the wrong type, or an enum code outside the pinned enum, is **malformed clinical data**. It produces a field-level `Invalid` diagnostic on that record and does not stop compilation or evaluation.

Retractions are separate items `Retraction { id, target: RevisionRef, author, provenance, recordedTime }`.

### 1.2 Snapshot-level inputs

| Input | Content | Not the same as |
|---|---|---|
| `coverage[]` | Per domain (record type + value set), subject, source scope and episode: `Complete \| Incomplete \| Unknown`, attested by the adapter contract (Stage A §12), plus `synthetic_snapshot` provenance where applicable (§4.8). No attestation for a domain means `Unknown`. `Complete` includes every revision and retraction of any record ID that has a revision in the domain | A successful retrieval; an explicit negative |
| `acquisitionFailures[]` | Domain, source, outcome (`Failed \| TimedOut \| Refused`), attempt ID | Empty results |
| `rejectedItems[]` | Domain (where known) and reason, for items the adapter could not parse into a record with identity and subject | Malformed fields inside an identified record (1.1) |

### 1.3 Evaluation context

`subject`, `episode: Known(EpisodeRef) | Unknown(causes)`, `encounter: Known(EncounterRef) | Unknown(causes)`, the pinned evaluation clock and the execution mode (`clinical | preview | nonclinical`). The orchestrator supplies these inputs and records them in the session revision.

The `episode` binding may itself come from an evaluated declaration rather than the orchestrator, for example from pregnancy-episode evidence. In that case the query depends on that declaration through an explicit reference, and its `Unknown` causes (e.g. `Conflicting`) carry through unchanged. The reference must stay acyclic, so the referenced declaration cannot read this query. Pathway applicability *A* is a separate `Decision`. The query reads scope inputs, never *A*’s truth value, unless the author writes an explicit reference and *A* does not depend on the query.

### 1.4 Data problems versus program problems

| Problem | Example | Class | Effect |
|---|---|---|---|
| Field absent | `assertion` missing | Patient evidence | `Unknown(Missing)` for that candidate (3.4) |
| Field malformed | `assertion = "Maybe"`; a syntactically invalid code | Patient evidence | `Unknown(Invalid)` for that candidate |
| Terminology information unavailable | A well-formed code from a system the pinned expansion does not cover | Patient evidence | Candidacy unresolved, cause `Unavailable` (S2) |
| Correction target absent | `supersedes` or a retraction names a revision that is not in the snapshot | Patient evidence | Revision history unresolved, cause `Missing` (S1) |
| Unparseable item, or a record type version the release cannot interpret | No `id`; `demo-model@0.2` | Patient evidence (snapshot) | `rejectedItems`, a gap with cause `Invalid` (section 4); unrelated results still evaluate (§12) |
| Wrong-type expression, unknown field, cycle | Section 7, case 10 | Invalid program | Compilation fails |

No stage invents a default for missing patient information: no assumed encounter, no assumed `Denied`, no assumed latest revision.

## 2. Processing boundaries

These stages follow Stage A §4.4’s order:

1. identities and correction/retraction authority, then revision history;
2. concept, subject/episode, scope and admissibility;
3. precedence and sufficiency.

Authored criterion evaluation sits between selection and resolution. Every stage writes trace records keyed by record identity, and no record disappears without a recorded stage and reason.

| # | Stage | Inputs | Outputs | Kind of behavior |
|---|---|---|---|---|
| S1 | Identity and correction history | All records and retractions of the retrieve’s record type for the context subject, **before** any concept filter; correction-authority policy | Per `id`: `Current(revision) \| Retracted \| UnresolvedRevision(causes)`. Unauthorized corrections and retractions are rejected with reasons, and the earlier revision stands. Two current revisions where neither supersedes the other give `Conflicting`. An absent correction or retraction target gives `Missing`, because the chain and its authority cannot be checked. Superseded revisions are retained | Fixed behavior; authority rule is a versioned policy |
| S2 | Candidate identification | S1 results; retrieve value set (pinned expansion) | A **current** revision is a candidate if its `concept` is in the expansion. A **retracted** ID is not a candidate; the trace records it if any revision matched. If a revision matched but the current one does not, the trace records “corrected out of domain”. An **unresolved** ID is an *unresolved candidate* (with S1 causes) if any of its revisions match. A code outside the expansion’s systems makes candidacy unresolved (`Unavailable`); a malformed code makes it unresolved (`Invalid`) | Fixed behavior over authored, pinned parameters |
| S3 | Admissibility | Candidates; context; authored admissibility rules | Each candidate: `Admissible \| Inadmissible(reasons) \| UnresolvedAdmissibility(causes)` (§4.6), with causes preserved from their origin | Fixed comparison semantics over authored rules |
| S4 | Selection/precedence | S3 results | `selected` = all `Admissible` candidates, deduplicated by `(id, revision)`. `unresolved` = every unresolved candidate from S1–S3. Inadmissible candidates are kept with reasons | Versioned policy `explicit-assertion-v0` (section 4) |
| S5 | Criterion evaluation | `selected` and `unresolved`; authored `establishes` and `refutes` expressions | Each candidate classified `Supporting \| Refuting \| NonInformative \| Unclassified(causes)` (3.3). Unresolved candidates are also classified, to judge materiality; they are never counted as selected. For an unresolved revision, every possible current revision is classified | Authored expressions; fixed classification rule |
| S6 | Sufficiency and resolution | S5 classifications; coverage; acquisition failures; rejected items | `Evidence<Boolean>`: `Known(value, supportingEvidenceIds, provenance)` or `Unresolved(causes, candidateEvidenceIds)` (§4.1); Need state (6.3) | Versioned policy `explicit-assertion-v0` |
| S7 | Projection to Decision | `Evidence<Boolean>` | `Decision` (5.2) | Fixed language behavior |

Any record whose unresolved status could change the S6 result stays in the computation (section 4, *materiality*). Unresolved records are dropped from the result only when they are provably immaterial, and they always remain in the trace.

### 2.1 S3 admissibility rules in this example

The author sets these rules in the contract. Their comparison semantics are fixed by the language.

- `subject` equals the context subject. A mismatch is `Inadmissible(WrongSubject)`.
- `episode` equals the context episode, with no prior-episode history (§4.7).
  - The record’s field is absent: `UnresolvedAdmissibility(Missing)`.
  - The context episode is `Unknown(causes)`: `UnresolvedAdmissibility(causes)`. For example, a conflicting episode source stays `Conflicting`.
  - A different known episode: `Inadmissible(OtherEpisode)`.
- `encounter` equals the context encounter: the same rule, with reason `OtherEncounter`. This identity rule stands in for “stale”; the example uses no duration windows.
- `assertionKind` must be in the authored allowed set. Otherwise the result is `Inadmissible(AssertionKindNotAllowed)`.

If several rules are unresolved for one candidate, their causes accumulate.

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
| `c` | `DemoAssessment` (read-only) | The candidate being classified |
| Enum literals | e.g. `AssertionValue.Affirmed` | Pinned evidence-model library |
| Library expressions | Declared signature, e.g. `(DemoAssessment) → Decision` | Pinned library version |

The criteria cannot read the context, other candidates, other queries or *A*. Result type: `Decision`.

**Library references.** `{ "call": "lib.demo.isAffirmed", "version": "1.2.0", "args": [{ "var": "c" }] }` resolves at compile time to a non-recursive library declaration (§2.1) with a declared signature and *read set*, for example `{DemoAssessment.assertion}`. The package manifest pins its version and digest (§12.1). The compiler links it with a source map, so traces name both the call site and the library definition. Changing the library version changes the reviewed artifact identity.

**Compiler-visible dependencies.** The query’s data requirement is its `retrieve` (record type, value set and correction chains) plus the union of field read sets from its admissibility rules, both criteria and every called library expression. This is the CQL idea that data requirements are inspectable from the retrieve, extended to the fields read after retrieval. A criterion that reads an undeclared field fails compilation.

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

**Question this policy answers:** do the admissible assertions in scope establish a value *without contradiction*? It is platform-versioned language-catalogue behavior, specified here, and authors select it by name and version.

**Selection.** Every admissible candidate counts equally. There is no “latest wins”, no source or author precedence and no frequency weighting. Rows sharing `(id, revision)` count once.

**Gaps.** A **gap** is any of the following:

- an acquisition failure;
- coverage `Incomplete` or `Unknown` (including no attestation);
- a rejected item.

A gap **overlaps** the query when its domain and scope intersect the query’s record type, value set, subject and episode/encounter scope. An overlapping gap could conceal an assertion of either polarity. A non-overlapping gap is unrelated: it is recorded in the trace and blocks nothing. Gap causes are:

| Gap | Cause |
|---|---|
| Acquisition failure | `Unavailable` |
| Coverage `Incomplete` or `Unknown` | `InsufficientEvidence` |
| Rejected item | `Invalid` |

**Resolution.** Write *S* for the supporting candidates and *R* for the refuting ones, both among `selected`.

1. *S* and *R* both nonempty: `Unresolved{Conflicting}`, listing every member of *S* and *R*.
2. *S* nonempty, *R* empty, no overlapping gap: `Known(true, S)`.
3. *R* nonempty, *S* empty, no overlapping gap: `Known(false, R)`.
4. Exactly one of *S* and *R* nonempty, with an overlapping gap: `Unresolved`, with the gap causes, listing the candidates. The rule is symmetric. An unread source could hold the opposing assertion and turn either result into `Conflicting`, so neither result is established.
5. *S* and *R* both empty: `Unresolved`, with every applicable cause accumulated:
   - `Missing` when no effective candidate remains: none retrieved (including an empty snapshot, even under `Complete` coverage) or all retracted or corrected out of domain;
   - `Inadmissible` when inadmissible candidates were seen;
   - `InsufficientEvidence` when non-informative candidates were seen;
   - the causes of every overlapping gap.

   A successful empty retrieval and complete coverage are recorded, but they never establish a negative under this policy. Scoped absence from complete coverage (§4.2) would be a different policy.

**Why symmetric.** Stage A §4.2 *permits* positive existence despite incomplete coverage, and it does not say an explicit negative always suffices. Whether either is sufficient depends on the evidence contract. This policy’s question requires that no opposing assertion could be hidden, so a material gap blocks both results. A policy in which an authoritative supporting assertion stays decisive despite unavailable sources is a different contract: it needs its own declared authority and sufficiency rule, and it is not specified here.

The practical consequence is that a `Known` result requires attested `Complete` coverage for the query’s domain and scope. Until adapters provide that attestation (Stage D), live results will usually be `Unresolved`. That is the intended, honest outcome.

**Materiality and cause accumulation.** Here *unresolved records* means the S4 `unresolved` set plus any selected candidate classified `Unclassified`. Rules 1–5 are first applied with all of them excluded from *S* and *R*, giving the *base result*. They still count as records seen, so rule 5’s `Missing` there means that no record at all remains, not that only unresolved ones do. Each unresolved record *u* then has a set of possible classifications:

- `{excluded}` plus its S5 classification(s), if S5 classified it (for an unresolved revision, all possible current revisions);
- `{excluded, Supporting, Refuting, NonInformative}` if it is `Unclassified`.

Materiality, and which causes are added, depends on the base result:

| Base result | An unresolved record *u* is material when… | Overlapping gaps |
|---|---|---|
| `Known(true)` | Its possible classes include `Refuting` | Already handled by rule 4 |
| `Known(false)` | Its possible classes include `Supporting` | Already handled by rule 4 |
| `Unresolved{Conflicting}` | Never: conflict cannot be undone by adding candidates under this policy | Not added; trace only |
| Other `Unresolved` | Its possible classes include `Supporting` or `Refuting` | Causes added |

If any *u* is material, the result is `Unresolved`. Its cause set is the union of:

- the base causes;
- every material *u*’s own causes, kept as they arose, from S1–S3 and from S5 if it is `Unclassified` (e.g. `Conflicting` for a conflicting episode source, `Unavailable` for terminology information, `Invalid` for malformed data, `Missing` for an absent field or correction target);
- every relevant gap cause.

Causes accumulate even when one cause alone already makes the result unresolved. Immaterial records and gaps stay in the trace with the stage and reason, but they add no cause. This check is per record and linear in their number. It is sound for this policy because each rule depends only on whether *S* and *R* are empty and on overlapping gaps.

**Cases the policy answers:**

| Situation | Result |
|---|---|
| One supporting assertion, no overlapping gap | `Known(true)` |
| One explicit negative, no overlapping gap | `Known(false)` |
| Repeated consistent assertions | `Known` with every distinct ID; count adds no weight |
| Contradictory admissible assertions | `Unresolved{Conflicting}` |
| No sufficient evidence | `Unresolved` with the accumulated causes in rule 5 |
| Material unresolved record | `Unresolved` with its own causes |
| Overlapping gap | Blocks either result (rule 4) |
| Unrelated gap | Blocks neither |

**Unsupported by this policy** (rejected at compile time if requested): temporal windows and freshness durations; latest or definite-latest selection; source or authority tiers, including decisive authoritative assertions; provider precedence requests (§4.4); tie rules; counts or thresholds over multiple assertions; scoped absence from coverage; terminology mapping beyond the pinned expansion; partial-date reasoning; cross-record pairing; related subjects; model-extracted observations. Each would need its own reviewed contract.

## 5. Typed outputs and traces

### 5.1 `Evidence<Boolean>` (Stage A §4.1, reused unchanged)

`Known(value, supportingEvidenceIds, provenance) | Unresolved(causes: NonEmptySet<Cause>, candidateEvidenceIds)`. No new cause is introduced. Where a cause arose (stage, record or context input, reason) lives in the trace, not in new cause names. The query trace attached to the result records:

- the retrieve parameters and pinned versions;
- every S1–S6 decision per record: revision history, candidacy, admissibility result and reasons, selection membership, `establishes`/`refutes` values with their sub-expression results, classification and materiality;
- coverage, gaps (overlapping or unrelated) and their causes;
- the applied rule number from section 4.

### 5.2 Projection to `Decision` (S7)

| `Evidence<Boolean>` | `Decision` |
|---|---|
| `Known(true, ids, prov)` | `True`, supported by `ids` |
| `Known(false, ids, prov)` | `False`, supported by `ids` |
| `Unresolved(causes, ids)` | `Unknown(causes)`, with `ids` as unresolved dependencies |

The Predicate `p = evidenceValue(ref q)` adds nothing else and removes nothing. Its explanation links the query trace. Downstream composition, such as the GERD model’s `finding = all(A, p)`, keeps `p`’s value and trace even when the composite differs (§4.3; minimal model §6.1). An established `True` here and an `Unknown` applicability are both reported.

## 6. Authoring holes versus patient uncertainty

### 6.1 By boundary

| Situation | S1–S2 | S3–S4 | S5 | S6–S7 | Preview | Need | Publication |
|---|---|---|---|---|---|---|---|
| Complete contract, missing patient evidence | Run | Run | Run | `Unresolved` → `Unknown(causes)` | Normal result | Yes, when material (6.3) | Allowed |
| Whole-contract hole | Not run | Not run | Not run | Query output and predicate carry the hole marker | Marker on `q` and dependents; outputs not depending on `q` are computed normally | None | Blocked |
| Nested criterion hole (`establishes` is a hole; retrieve, admissibility and policy written) | Run | Run | `refutes` runs; `establishes` gives a marker | Marker, not `Unresolved` | Revision, candidacy, admissibility and selection traces and `refutes` results are inspectable; the result is a marker | None, even with no candidates | Blocked |
| Nested policy hole (e.g. the admissibility `episode` rule is a hole) | Run | Marker from S3 | Marker | Marker | S1–S2 traces inspectable | None | Blocked |
| Invalid binding or unsupported expression | — | — | — | — | No preview; compile diagnostic with location | None | Blocked |

### 6.2 Rules

- Holes propagate to dependents only (Stage A §2.3). Each marker names its hole IDs. A preview is never replaced by one undifferentiated marker.
- A partly authored query never reports patient uncertainty for the undefined part. With a criterion hole and an empty snapshot, the result is the hole marker, not `Unresolved{Missing}`. The empty snapshot is still visible in the S1–S2 trace.
- A hole never becomes a Need or a provider-facing field (§2.3). Need identity requires a complete contract (6.3).

### 6.3 When a complete query contributes a Need

**Identity.** The evidence Need for an `Unresolved` complete query is keyed by the **semantic requirement and its scope**: the query contract digest, subject, episode binding and encounter binding (Stage A §7). The cause is **not** part of the key. The same unmet requirement may move from `Missing` to `Unavailable` after a failed attempt, then to `Conflicting` when new evidence arrives. It stays one Need whose state records:

- the current cause set;
- contributing records;
- the orchestrator’s recorded acquisition attempts and outcomes.

This avoids duplicate requests and keeps attempt and deadline tracking continuous (§7).

**Separate obligations exist only for a genuinely different fulfillment:**

| Situation | Obligation | Key | Why it is different |
|---|---|---|---|
| Evidence absent, inadmissible, non-informative, or hidden behind an overlapping gap | The evidence Need | Requirement + scope | Fulfilled by a new admissible assessment or by completing acquisition |
| `Conflicting` among admissible candidates | Conflict-resolution obligation, with the conflicting records as state | Requirement + scope + kind `ResolveConflict` | Under this policy a further assessment cannot remove a conflict. Fulfillment is an authorized correction or retraction of an existing record |
| A specific record whose own field blocks it (e.g. absent encounter on r4) | Record-correction obligation | Requirement + scope + kind `CorrectRecord` + record ID | Fulfilled by correcting that record, not by a new assessment |
| Context scope unresolved (e.g. episode `Unknown(Conflicting)`) | None from this query | — | The scope belongs to the declaration that supplies the episode, and its own Need is linked through the trace |

The core emits these only if backward dependency tracing shows the query output is material to some requested output (§4.3, §7). The orchestrator chooses the fulfiller (ask the provider, an EHR query or a hybrid), dispatches it and applies retry and deadline policy. Fulfillment creates a new evaluation revision.

## 7. Worked example and acceptance table

### 7.1 Representation (proposed notation, not finalized syntax)

```jsonc
{
  "id": "q.demo", "kind": "EvidenceQuery", "output": "Evidence<Boolean>",
  "contract": {
    "retrieve":   { "type": "demo-model/DemoAssessment@0.1", "valueSet": "demo-vs/item-x@1" },
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

- every `DemoAssessment` revision and retraction for the subject whose ID has any revision in `demo-vs/item-x@1`;
- reading `{id, revision, supersedes, concept, subject, episode, encounter, assertionKind, assertion}`;
- context inputs `{subject, episode, encounter}`.

### 7.2 Manual trace

**Context:** subject P1, episode E1, encounter N1. Coverage is `Complete` for the domain, P1, E1 and N1. There are no failures.

**Snapshot:**

| Record | Contents |
|---|---|
| r1 rev1 | `Indeterminate`, N1 |
| r1 rev2 | `Affirmed`, supersedes rev1, same source system |
| r2 | `Denied`, encounter N0 |
| r3 | `Affirmed`, N1; authorized retraction x3 targets it |
| r4 | `Affirmed`, `PatientReport`, encounter absent |

**Stages:**

| Stage | Result |
|---|---|
| S1 | r1 → `Current(rev2)`, with rev1 retained as superseded; r2 and r4 current; r3 → `Retracted`, by x3, author authorized |
| S2 | Candidates r1 rev2, r2, r4 (concepts in the expansion); r3 recorded as retracted |
| S3 | r1 rev2 `Admissible`; r2 `Inadmissible(OtherEncounter)`; r4 `UnresolvedAdmissibility(Missing @encounter)` |
| S4 | `selected` = {r1}; `unresolved` = {r4}; inadmissible {r2} retained |
| S5 | r1: `establishes` True, `refutes` False → Supporting. r4: Supporting |
| S6 | No overlapping gap. Base result, rule 2: `Known(true, [r1])`. r4’s possible classes are {excluded, Supporting}, so it is immaterial. Final result `Known(true, [r1])`, with r2 (reason), r3 (retraction) and r4 (immaterial) in the trace |
| S7 | `True`, supported by r1 |

If r4 had been `Denied`, its possible classes would be {excluded, Refuting}, which is material. The result would be `Unresolved{Missing}` attributed to r4, the Decision `Unknown`, and the obligation a `CorrectRecord` for r4 (case 7).

### 7.3 Acceptance cases

**Defaults unless stated:**

- the contract in 7.1 is complete;
- the context P1/E1/N1 is known;
- coverage is attested `Complete` for the domain and scope;
- there are no failures or rejected items;
- records are current, in-scope `ClinicianDocumented` records for P1/E1/N1.

“Evidence Need” means the one Need keyed by `(q.demo digest, P1, E1, N1)`.

| # | Case | Assumptions | `Evidence<Boolean>` | `Decision` | Need / obligation | Basis |
|---|---|---|---|---|---|---|
| 1 | Affirmed | r1 `Affirmed` | `Known(true, [r1])` | True | None | Rule 2 |
| 2 | Explicitly Denied | r2 `Denied` | `Known(false, [r2])` | False | None | Rule 3 |
| 3 | Missing assertion field | r3 with `assertion` absent | `Unresolved{Missing}`, r3 | Unknown(Missing) | Evidence Need; `CorrectRecord` r3 | 3.4; materiality |
| 4 | Empty snapshot | No records; coverage `Complete` | `Unresolved{Missing}` | Unknown(Missing) | Evidence Need | Rule 5; coverage ≠ negative |
| 5 | Conflicting admissible assertions | r1 `Affirmed`, r2 `Denied` | `Unresolved{Conflicting}`, [r1, r2] | Unknown(Conflicting) | `ResolveConflict`, state [r1, r2] | Rule 1 |
| 6 | Only inadmissible evidence | r5 `Denied` at encounter N0 | `Unresolved{Inadmissible}`, r5 with reason | Unknown(Inadmissible) | Evidence Need | S3; rule 5 |
| 7 | Material unresolved admissibility | r1 `Affirmed`; r4 `Denied` with encounter absent | `Unresolved{Missing}`, attributed to r4; r1 listed | Unknown(Missing) | Evidence Need; `CorrectRecord` r4 | Materiality |
| 8 | Whole-contract hole | `contract` is one hole | Preview marker (hole ID) | Marker | None | 6.1 |
| 9 | Nested criterion hole | `establishes` is a hole; any snapshot | Preview marker; S1–S4 and `refutes` traces shown | Marker | None | 6.1, 6.2 |
| 10 | Wrong-type reference | `establishes` is `c.assertion == AssertionKind.PatientReport`, or the predicate references an output that is not `Evidence<Boolean>` | — | — | — | Compile error: cross-enum equality or binding type mismatch (§6.5, §10.4) |
| 11 | Repeated consistent | r1 and r6 `Affirmed`; a duplicate row of r1 with the same revision | `Known(true, [r1, r6])` | True | None | Selection dedupe; rule 2 |
| 12 | Positive with overlapping failure | r1 `Affirmed`; acquisition failure for the domain and P1 | `Unresolved{Unavailable}`, r1 listed | Unknown(Unavailable) | Evidence Need; the failed attempt recorded in its state | Rule 4 (symmetric) |
| 13 | Negative with overlapping failure | r2 `Denied`; acquisition failure for the domain and P1 | `Unresolved{Unavailable}`, r2 listed | Unknown(Unavailable) | Same evidence Need key as case 12 | Rule 4 |
| 14 | Retracted only | r1 `Affirmed`, retracted with authority | `Unresolved{Missing}`, r1 retracted | Unknown | Evidence Need | S1; rule 5 |
| 15 | Indeterminate only | r7 `Indeterminate` | `Unresolved{InsufficientEvidence}` | Unknown | Evidence Need | 3.4; rule 5 |
| 16 | Context episode unknown | r1 `Affirmed`; context episode `Unknown(Conflicting)` from its source declaration | `Unresolved{Conflicting}`, attributed to the context episode via r1’s S3 result | Unknown(Conflicting) | None from this query; the episode source’s Need is linked | S3 cause preserved; materiality; minimal model §6.1(b) |
| 17 | Unrelated gap | r1 `Affirmed`; acquisition failure for a different record type | `Known(true, [r1])`, gap in trace | True | None | Non-overlapping gap |
| 18 | Negative with unknown coverage | r2 `Denied`; no coverage attestation for the domain | `Unresolved{InsufficientEvidence}`, r2 listed | Unknown | Evidence Need | Rule 4; `Unknown` coverage is a gap |
| 19 | Corrected out of domain | r8 rev1 `Affirmed`, concept in the value set; r8 rev2 supersedes rev1 (authorized) with a concept outside it | `Unresolved{Missing}`; r8 recorded “corrected out of domain” | Unknown(Missing) | Evidence Need | S1 before S2; rule 5. Filtering first would wrongly leave rev1 as `Known(true)` |
| 20 | Missing correction target | r9 rev2 `Affirmed`, supersedes rev1, which is absent from the snapshot | `Unresolved{Missing}`, attributed to r9’s revision history | Unknown(Missing) | Evidence Need; `CorrectRecord` r9 | S1 (chain and authority unverifiable); materiality |
| 21 | Terminology information unavailable | r10 `Affirmed`, code from a system outside the pinned expansion | `Unresolved{Unavailable}`, attributed to r10’s candidacy | Unknown(Unavailable) | Evidence Need | S2 (not `Invalid`); materiality |

In case 16 the alarm cannot be `True`, because its evidence contract needs the unresolved scope (minimal model §6.1(b)). The episode’s `Conflicting` cause is preserved, not rewritten as `Missing`.

## 8. Decisions and remaining work

**Existing Stage A requirements applied.**

| Requirement | Stage A |
|---|---|
| Frozen inputs, no core I/O | §11.2 |
| Selection order: identity and correction before scope | §4.4 |
| Per-query admissibility with unresolved candidates kept | §4.6 |
| Absence is not falsity | §4.1, §4.2 |
| Cause sets and Kleene composition | §4.1, §4.3 |
| No input-order winners | §4.4 |
| Typed holes, preview-only, no Need from a hole | §2.3 |
| Typed finite-enum equality and disjointness analysis | §6.5 |
| Stable Need identity across reevaluation, attempt tracking, orchestrator ownership | §7 |
| Pinned library versions | §12.1 |

**Decisions proposed here.**

1. Explicit `Field<T>` presence: absent lifts to `Unknown(Missing)` and malformed to `Unknown(Invalid)`.
2. Two authored criteria, `establishes` and `refutes`. A negative comes only from `refutes`. The disjointness obligation applies to this policy, not to all future contracts.
3. A criterion-only binding environment (`c`, enum literals, pinned library calls) with declared read sets; data requirements, including correction chains, are compiler-visible.
4. Correction and retraction are resolved before concept filtering. Absent targets stay explicit uncertainty.
5. The named platform policy `explicit-assertion-v0`:
   - unanimous admissible assertions with no precedence;
   - symmetric blocking by overlapping gaps, where `Unknown` coverage is a gap;
   - per-record materiality with accumulated, origin-preserving causes.
6. Unresolved records are classified in S5 to judge materiality but are never counted as selected.
7. A nested hole yields a marker, not patient uncertainty, while upstream stage traces stay inspectable.
8. Need identity is the requirement and scope; causes and attempts are state. Conflict and record-correction obligations are separate only because their fulfillment differs.
9. No new cause names: the trace carries stage, origin and reason.

**Possible conflicts needing a Stage A amendment.** None found. Two items need explicit confirmation:

- (a) The `disjoint` obligation makes a runtime overlap of both criteria an invariant failure. That relies on §6.5’s enum analysis being mandatory for contracts using this policy.
- (b) The use of `ref` for every dependency follows the minimal model’s proposed narrowing of §2.2, which is not yet accepted.

Rule 4 is now within §4.2: that section permits positive existence and explicit negatives without requiring either, and this policy declares its own sufficiency.

**Is the query/predicate split worth it?** The query carries the reasoning: revisions, candidacy, admissibility, both criteria and resolution, all traced. A Predicate whose whole expression is `evidenceValue(ref q)` adds no reasoning. It is optional naming and composition structure, useful when a condition is referenced in several places, as `p.alarm` is in the GERD model. No node kind is added or removed. Allowing `evidenceValue(ref q)` inline in any `Decision` position, so a one-use Predicate is optional, is proposed for confirmation.

**Remaining questions.**

1. What is the record-type registry and versioning for evidence-model libraries, and how are pinned enum expansions bound to `Field<T>`?
2. How should the coverage-domain key (record type + value set + scope, including correction chains) be matched against adapter attestations, and how is “overlap” computed when a gap’s scope is only partly known (Stage A §17 item 4)?
3. What is the enumerated set of obligation kinds beside the evidence Need (`ResolveConflict`, `CorrectRecord`), and their fulfillment validation (`fulfilled_by`, §7)?
4. Is a separate decisive-authority policy needed, and what declared authority and sufficiency would it require?

**Next smallest task.** Write the conformance case table for `explicit-assertion-v0` alone, in the style of Stage B families B-04, B-11 and B-12. Turn sections 4 and 7.3 into input/expected-output fixtures, including the materiality, gap-overlap and correction-order cases. This tests whether the policy is fully specified before another policy or a temporal window is added.
