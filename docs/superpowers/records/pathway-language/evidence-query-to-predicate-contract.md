# Evidence-query-to-predicate contract (draft)

**Status:** Proposed design draft. **Not** accepted, not finalized syntax, not a schema and not implemented. It contains no clinical content: the record type, enum values and codes below are fictional and illustrate language behavior only. They do not map to dysphagia, progression, urgency or any other clinical definition.

**Date:** 2026-10-03

**Authority:** [RFC](../../specs/2026-09-28-pathway-language-rfc.md) (accepted architecture) and [Stage A](../../specs/2026-09-30-pathway-language-stage-a-spec.md) §§2–7 (draft contracts). This document builds on the [minimal GERD language model](gerd-minimal-language-model.md), including its settled behavior for an established alarm with unknown applicability (its §6.1). Where this draft and Stage A disagree, Stage A governs until amended (section 8).

**Problem:** Given a frozen collection of typed evidence records, coverage information, an explicit evaluation context and a declared query contract, specify how PPL produces `Evidence<Boolean>` and how a Predicate consumes it as a `Decision`, with every step that affects the answer inspectable.

## 1. Evidence entering the boundary

The core receives frozen inputs only (RFC §3; Stage A §4.8, §11.2). Retrieval, pagination, retries and terminology lookups happen in adapters and the orchestrator before evaluation.

### 1.1 Per-record evidence

Records are instances of a record type declared in a pinned evidence-model library (here the fictional `demo-model@0.1`). The example type `DemoAssessment` has these fields:

| Field | Type | Notes |
|---|---|---|
| `id`, `revision` | `RecordId`, `RevisionId` | Stable identity. Equal `(id, revision)` pairs are one record, however many rows carry them |
| `supersedes` | optional `RevisionRef` | A correction: this revision replaces the referenced revision of the same `id` |
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
| `coverage[]` | Per domain (record type + value set), subject, source scope and episode: `Complete \| Incomplete \| Unknown`, attested by the adapter contract (Stage A §12), plus `synthetic_snapshot` provenance where applicable (§4.8) | A successful retrieval; an explicit negative |
| `acquisitionFailures[]` | Domain, source, outcome (`Failed \| TimedOut \| Refused`), attempt ID | Empty results |
| `rejectedItems[]` | Items the adapter could not parse into a record with identity and subject | Malformed fields inside an identified record (1.1) |

### 1.3 Evaluation context

`subject`, `episode: Known(EpisodeRef) | Unknown(causes)`, `encounter: Known(EncounterRef) | Unknown(causes)`, the pinned evaluation clock and the execution mode (`clinical | preview | nonclinical`). The orchestrator supplies these inputs and records them in the session revision.

The `episode` binding may itself come from an evaluated declaration rather than the orchestrator, for example from pregnancy-episode evidence. In that case the query depends on that declaration through an explicit reference. The reference must stay acyclic, so the referenced declaration cannot read this query. Pathway applicability *A* is a separate `Decision`. The query reads scope inputs, never *A*’s truth value, unless the author writes an explicit reference and *A* does not depend on the query.

### 1.4 Data problems versus program problems

| Problem | Example | Class | Effect |
|---|---|---|---|
| Field absent | `assertion` missing | Patient evidence | `Unknown(Missing)` for that candidate (section 3.4) |
| Field malformed | `assertion = "Maybe"` | Patient evidence | `Unknown(Invalid)` for that candidate |
| Unparseable item | No `id` or `subject` | Patient evidence (snapshot) | Listed in `rejectedItems`; treated as a gap in the domain (section 4) |
| Record type version the release cannot interpret | `demo-model@0.2` record | Patient evidence (snapshot) | Listed in `rejectedItems` as a known gap (`Invalid`); unrelated results still evaluate (§12) |
| Wrong-type expression, unknown field, cycle | Section 7, case 10 | Invalid program | Compilation fails |

No stage invents a default for missing patient information: no assumed encounter, no assumed `Denied`, no assumed latest.

## 2. Processing boundaries

These stages follow Stage A §4.4’s order: identity, correction history, scope and admissibility, then precedence and sufficiency. Authored criterion evaluation sits between selection and resolution. Every stage writes trace records keyed by candidate identity, and no candidate disappears without a recorded reason.

| # | Stage | Inputs | Outputs | Kind of behavior |
|---|---|---|---|---|
| S1 | Candidate identification | Snapshot records; query `retrieve` (record type, pinned value set) | Candidates: records of that type whose `concept` is in the pinned expansion. A record whose code system the expansion does not cover becomes an *unresolved candidate* (cause `Missing`, reason “membership unknown”) | Fixed language behavior over authored, pinned retrieve parameters |
| S2 | Correction/retraction | Candidates; retractions; correction-authority policy | Per `id`: `Current(revision) \| Retracted \| Unresolved(Conflicting)`. Unauthorized corrections and retractions are rejected with reasons, and the earlier revision stands. Two current revisions where neither supersedes the other are `Unresolved(Conflicting)`. Superseded revisions are retained in the trace | Fixed behavior; authority rule is a versioned policy |
| S3 | Admissibility | Effective candidates; context; authored admissibility rules | Each candidate: `Admissible \| Inadmissible(reasons) \| UnresolvedAdmissibility(causes)` (§4.6) | Fixed comparison semantics over authored rules |
| S4 | Selection/precedence | S3 results | `selected` = all `Admissible` candidates, deduplicated by `(id, revision)`. `unresolved` = every candidate from S1–S3 with unresolved candidacy, revision or admissibility. Inadmissible candidates are kept with reasons | Versioned policy `explicit-assertion-v0` (section 4) |
| S5 | Criterion evaluation | `selected` and `unresolved`; authored `establishes` and `refutes` expressions | Each candidate classified `Supporting \| Refuting \| NonInformative \| Unclassified(causes)` (3.3). Unresolved candidates are also classified, to judge materiality; they are never counted as selected. A selected `Unclassified` candidate enters the materiality check (section 4) | Authored expressions; fixed classification rule |
| S6 | Sufficiency and resolution | S5 classifications; coverage; acquisition failures; rejected items | `Evidence<Boolean>`: `Known(value, supportingEvidenceIds, provenance)` or `Unresolved(causes, candidateEvidenceIds)` (§4.1), plus Need descriptors (6.3) | Versioned policy `explicit-assertion-v0` |
| S7 | Projection to Decision | `Evidence<Boolean>` | `Decision` (5.2) | Fixed language behavior |

Any candidate whose unresolved status could change the S6 result stays in the computation (section 4, *materiality*). Unresolved candidates are dropped only when they are provably immaterial, and even then they remain in the trace.

### 2.1 S3 admissibility rules in this example

The author sets these rules in the contract. Their comparison semantics are fixed by the language.

- `subject` equals the context subject. A mismatch is `Inadmissible(WrongSubject)`.
- `episode` equals the context episode, with no prior-episode history (§4.7). If the record’s field is absent, or the context episode is `Unknown`, the result is `UnresolvedAdmissibility(Missing)`. A different known episode is `Inadmissible(OtherEpisode)`.
- `encounter` equals the context encounter: the same rule, with reason `OtherEncounter`. This identity rule stands in for “stale”; the example uses no duration windows.
- `assertionKind` must be in the authored allowed set. Otherwise the result is `Inadmissible(AssertionKindNotAllowed)`.

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

**Compiler-visible dependencies.** The query’s data requirement is its `retrieve` plus the union of field read sets from its admissibility rules, both criteria and every called library expression. This is the CQL idea that data requirements are inspectable from the retrieve, extended to the fields read after retrieval. A criterion that reads an undeclared field fails compilation.

### 3.3 Classification rule (S5)

| `establishes(c)` | `refutes(c)` | Classification |
|---|---|---|
| True | False | `Supporting` |
| False | True | `Refuting` |
| False | False | `NonInformative` |
| Unknown (either) | — | `Unclassified(causes)` |
| True | True | Prevented by a compile-time obligation (below) |

The contract declares a `disjoint(establishes, refutes)` obligation. With enum-equality criteria it is decided by the v0 finite-enum disjointness analysis (§6.5). If that analysis cannot prove it (`INCONCLUSIVE`), publication is blocked. If both criteria are nonetheless True at runtime, the run fails as an engine invariant violation. It is never treated as patient conflict.

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

`explicit-assertion-v0` is the selection (S4) and resolution (S6) policy for this contract. The author selects it by name and version. It is platform-versioned language-catalogue behavior, specified here, not authored code.

**Selection.** Every admissible candidate counts equally. There is no “latest wins”, no source or author precedence and no frequency weighting. Rows sharing `(id, revision)` count once.

**Resolution.** Write *S* for the supporting candidates and *R* for the refuting ones, both among `selected`. A **known gap** is any acquisition failure, `Incomplete` coverage or rejected item in the query’s domain and scope.

1. *S* and *R* both nonempty: `Unresolved{Conflicting}`, listing every member of *S* and *R*.
2. *S* nonempty, *R* empty: `Known(true, S)`. Known gaps do **not** block this result, because positive existence can be known from sufficient admissible evidence while another source is unavailable (§4.2). Gaps are retained as diagnostics.
3. *R* nonempty, *S* empty, no known gap: `Known(false, R)`.
4. *R* nonempty, *S* empty, with a known gap: `Unresolved{Unavailable}` (or `{Invalid}` for rejected items). The asymmetry with rule 2 is deliberate. Concluding falsity with an unread domain risks the omission hazard (missed indicated actions) that Stage A §16.5 asks to measure. §4.2 permits a negative from an explicit assertion, and this policy chooses to be stricter.
5. *S* and *R* both empty: `Unresolved`, with causes drawn from what was seen:
   - `Missing` when no effective candidate remains: none retrieved (including an empty snapshot, even under `Complete` coverage) or all retracted;
   - `Inadmissible` when only inadmissible candidates were seen;
   - `InsufficientEvidence` when only non-informative candidates were seen;
   - `Unavailable` or `Invalid` for known gaps.

   This policy never derives `false` from absence. A successful empty retrieval and complete coverage are recorded, but they do not establish a negative. Scoped absence from complete coverage (§4.2) needs a different policy.

**Materiality of unresolved candidates.** Here *unresolved candidates* means the S4 `unresolved` set plus any selected candidate classified `Unclassified`. Rules 1–5 are first applied with all of them excluded, giving the *base result*. Each unresolved candidate *u* then has a set of possible classifications:

- `{excluded, its S5 classification}` if S5 classified it;
- `{excluded, Supporting, Refuting, NonInformative}` if it is `Unclassified`.

*u* is **immaterial** if, given the base result, no member of that set could change the result:

- base `Known(true)`: possible classes ⊆ {excluded, Supporting, NonInformative};
- base `Known(false)`: possible classes ⊆ {excluded, Refuting, NonInformative};
- base `Unresolved{Conflicting}`: always immaterial, because conflict cannot be undone by adding candidates under this policy;
- base `Unresolved` otherwise: immaterial only if its possible classes ⊆ {excluded, NonInformative}.

If any *u* is material, the result is `Unresolved`, with that candidate’s causes attributed to it. Its causes come from S1–S3, plus the S5 causes if it is `Unclassified`. This check is per candidate and linear in their number. It is sound for this policy because each rule depends only on whether *S* and *R* are empty.

**Cases the policy answers:**

| Situation | Result |
|---|---|
| One supporting assertion | `Known(true)` |
| One explicit negative, no known gap | `Known(false)` |
| Repeated consistent assertions | `Known` with every distinct supporting (or refuting) ID; count adds no weight |
| Contradictory admissible assertions | `Unresolved{Conflicting}` |
| No sufficient evidence | `Unresolved` with the causes in rule 5 |
| Material unresolved candidate | `Unresolved` with its causes |
| Source failure | Blocks negatives (rule 4); retained but non-blocking for positives (rule 2) |

**Unsupported by this policy** (rejected at compile time if requested): temporal windows and freshness durations; latest or definite-latest selection; source or authority tiers; provider precedence requests (§4.4); tie rules; counts or thresholds over multiple assertions; scoped absence from coverage; terminology mapping beyond the pinned expansion; partial-date reasoning; cross-record pairing; related subjects; model-extracted observations. Each would need its own reviewed contract.

## 5. Typed outputs and traces

### 5.1 `Evidence<Boolean>` (Stage A §4.1, reused unchanged)

`Known(value, supportingEvidenceIds, provenance) | Unresolved(causes: NonEmptySet<Cause>, candidateEvidenceIds)`. The query trace attached to it records:

- the retrieve parameters and pinned versions;
- every S1–S6 decision per candidate: identity, revision handling, admissibility result and reasons, selection membership, `establishes`/`refutes` values with their sub-expression results, classification and materiality;
- coverage and known gaps;
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
| Nested criterion hole (`establishes` is a hole; retrieve, admissibility and policy written) | Run | Run | `refutes` runs; `establishes` gives a marker | Marker, not `Unresolved` | Candidate, admissibility and selection traces and `refutes` results are inspectable; the result is a marker | None, even with no candidates | Blocked |
| Nested policy hole (e.g. admissibility `episode` rule is a hole) | Run | Marker from S3 | Marker | Marker | S1–S2 traces inspectable | None | Blocked |
| Invalid binding or unsupported expression | — | — | — | — | No preview; compile diagnostic with location | None | Blocked |

### 6.2 Rules

- Holes propagate to dependents only (Stage A §2.3). Each marker names its hole IDs. A preview is never replaced by one undifferentiated marker.
- A partly authored query never reports patient uncertainty for the undefined part. With a criterion hole and an empty snapshot, the result is the hole marker, not `Unresolved{Missing}`. The empty snapshot is still visible in the S1 trace.
- A hole never becomes a Need or a provider-facing field (§2.3). A Need key requires a complete contract (6.3).

### 6.3 When a complete query contributes a Need

A complete query’s `Unresolved` result produces Need descriptors keyed by the query contract digest, subject, episode and encounter binding, and the cause (Stage A §7):

| Cause | Need descriptor |
|---|---|
| `Missing`, `Inadmissible`, `InsufficientEvidence` | Request an assessment that satisfies the contract |
| `Conflicting` | Clarification, naming the conflicting candidates |
| `Missing` on a specific unresolved candidate (e.g. absent encounter) | Clarification of that record, or a new assessment |
| `Unavailable` | Records the failed acquisition |

The core emits a Need only if backward dependency tracing shows the query output is material to some requested output (§4.3, §7). The orchestrator chooses the fulfiller (ask the provider, an EHR query or a hybrid), dispatches it and applies retry and deadline policy. Fulfilment creates a new evaluation revision.

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

Compiler-visible data requirement: `DemoAssessment` in `demo-vs/item-x@1`, reading `{subject, episode, encounter, assertionKind, assertion, id, revision, supersedes}` and retractions, plus context inputs `{subject, episode, encounter}`.

### 7.2 Manual trace

**Context:** subject P1, episode E1, encounter N1, coverage `Complete`, no failures.

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
| S1 | Candidates r1, r2, r3, r4 (all codes in the expansion) |
| S2 | r1 → `Current(rev2)`, with rev1 retained as superseded; r3 → `Retracted`, by x3, author authorized |
| S3 | r1 rev2 `Admissible`; r2 `Inadmissible(OtherEncounter)`; r4 `UnresolvedAdmissibility(Missing @encounter)` |
| S4 | `selected` = {r1}; `unresolved` = {r4}; inadmissible {r2} retained |
| S5 | r1: `establishes` True, `refutes` False → Supporting. r4: Supporting |
| S6 | Base result, rule 2: `Known(true, [r1])`. r4’s possible classes are {excluded, Supporting}, so it is immaterial. Final result `Known(true, [r1])`, with r2 (reason), r3 (retraction) and r4 (immaterial unresolved) in the trace |
| S7 | `True`, supported by r1 |

If r4 had been `Denied`, its possible classes would be {excluded, Refuting}, which is material. The result would be `Unresolved{Missing}` attributed to r4, the Decision `Unknown`, and the Need a clarification of r4’s encounter or a new assessment. This is case 7 below.

### 7.3 Acceptance cases

**Defaults unless stated:** the contract in 7.1 is complete; context P1/E1/N1 is known; coverage is `Complete`; there are no failures; records are in-scope `ClinicianDocumented` records for P1/E1/N1.

| # | Case | Assumptions | `Evidence<Boolean>` | `Decision` | Need | Basis |
|---|---|---|---|---|---|---|
| 1 | Affirmed | r1 `Affirmed` | `Known(true, [r1])` | True | None | Rule 2 |
| 2 | Explicitly Denied | r2 `Denied` | `Known(false, [r2])` | False | None | Rule 3 |
| 3 | Missing assertion field | r3 with `assertion` absent | `Unresolved{Missing}`, r3 | Unknown(Missing) | Clarify r3 or a new assessment | 3.4; materiality (`Unclassified` is material) |
| 4 | Empty snapshot | No records; coverage `Complete` | `Unresolved{Missing}` | Unknown(Missing) | Assessment | Rule 5; coverage ≠ negative |
| 5 | Conflicting admissible assertions | r1 `Affirmed`, r2 `Denied` | `Unresolved{Conflicting}`, [r1, r2] | Unknown(Conflicting) | Clarification naming r1, r2 | Rule 1 |
| 6 | Only inadmissible evidence | r5 `Denied` at encounter N0 | `Unresolved{Inadmissible}`, r5 with reason | Unknown | Assessment for N1 | S3; rule 5 |
| 7 | Material unresolved admissibility | r1 `Affirmed`; r4 `Denied` with encounter absent | `Unresolved{Missing}`, attributed to r4; r1 listed | Unknown(Missing) | Clarify r4’s encounter, or a new assessment | Materiality |
| 8 | Whole-contract hole | `contract` is one hole | Preview marker (hole ID) | Marker | None | 6.1 |
| 9 | Nested criterion hole | `establishes` is a hole; any snapshot | Preview marker; S1–S4 and `refutes` traces shown | Marker | None | 6.1, 6.2 |
| 10 | Wrong-type reference | `establishes` is `c.assertion == AssertionKind.PatientReport`, or the predicate references an output that is not `Evidence<Boolean>` | — | — | — | Compile error: cross-enum equality or binding type mismatch (§6.5, §10.4) |
| 11 | Repeated consistent | r1 and r6 `Affirmed`; a duplicate row of r1 with the same revision | `Known(true, [r1, r6])` | True | None | Selection dedupe; rule 2 |
| 12 | Positive with source failure | r1 `Affirmed`; acquisition failure in the domain | `Known(true, [r1])`, failure retained | True | None | Rule 2 |
| 13 | Negative with source failure | r2 `Denied`; acquisition failure in the domain | `Unresolved{Unavailable}`, r2 listed | Unknown(Unavailable) | Records the failed acquisition | Rule 4 |
| 14 | Retracted only | r1 `Affirmed`, retracted with authority | `Unresolved{Missing}`, r1 retracted | Unknown | Assessment | S2; rule 5 |
| 15 | Indeterminate only | r7 `Indeterminate` | `Unresolved{InsufficientEvidence}` | Unknown | Assessment | 3.4; rule 5 |
| 16 | Context episode unknown | r1 `Affirmed`; context episode `Unknown` | `Unresolved{Missing}`; r1 unresolved, possibly supporting | Unknown | Scope Need from the episode source | S3; materiality; minimal model §6.1(b) |

In case 16 the alarm cannot be `True`, because its evidence contract needs the unknown scope. That is the settled §6.1(b) behavior, as opposed to §6.1(a), where only applicability is unknown.

## 8. Decisions and remaining work

**Existing Stage A requirements applied.**

| Requirement | Stage A |
|---|---|
| Frozen inputs, no core I/O | §11.2 |
| Selection order | §4.4 |
| Per-query admissibility with unresolved candidates kept | §4.6 |
| Positive existence despite unavailable sources | §4.2 |
| Absence is not falsity | §4.1, §4.2 |
| Cause sets and Kleene composition | §4.1, §4.3 |
| No input-order winners | §4.4 |
| Typed holes, preview-only, no Need from a hole | §2.3 |
| Typed finite-enum equality and disjointness analysis | §6.5 |
| Need identity and orchestrator ownership | §7 |
| Pinned library versions | §12.1 |

**Decisions proposed here.**

1. Explicit `Field<T>` presence: absent lifts to `Unknown(Missing)` and malformed to `Unknown(Invalid)`.
2. Two authored criteria, `establishes` and `refutes`, with a compile-time disjointness obligation. A negative comes only from `refutes`.
3. A criterion-only binding environment (`c`, enum literals, pinned library calls) with declared read sets; data requirements are compiler-visible.
4. The named platform policy `explicit-assertion-v0`: unanimous admissible assertions, no precedence, the materiality rule, and the positive/negative asymmetry for known gaps.
5. Unresolved candidates are classified in S5 to judge materiality but are never counted as selected.
6. A nested hole yields a marker, not patient uncertainty, while upstream stage traces stay inspectable.
7. Need descriptors are keyed by cause.

**Possible conflicts needing a Stage A amendment.** None found that requires one, but four items need explicit confirmation:

- (a) Rule 4 is stricter than §4.2’s “or an authorized explicit negative assertion”. It is presented as a policy choice inside a versioned selection contract, not a language rule. If Stage A means the explicit negative must always suffice, the policy needs revising.
- (b) §4.1’s cause set has no dedicated cause for “membership unknown” or “unresolved admissibility”. This draft maps them to the underlying `Missing` or `Invalid`, with the attribution kept in the trace. A dedicated cause would need an amendment.
- (c) The `disjoint` obligation makes a runtime overlap of both criteria an invariant failure. That relies on §6.5’s enum analysis being mandatory for this contract.
- (d) The use of `ref` for every dependency follows the minimal model’s proposed narrowing of §2.2, which is not yet accepted.

**Is the query/predicate split worth it?** The query carries the reasoning: candidates, revisions, admissibility, both criteria and resolution, all traced. The Predicate is a pure projection and adds no reasoning. A Predicate whose whole expression is `evidenceValue(ref q)` is a pass-through; it earns its place only when it names a clinical condition referenced in several places, as `p.alarm` is in the GERD model (finding and proposal). No node kind is added or removed here. One option for review: allow `evidenceValue(ref q)` inline in any `Decision` position, so a one-use Predicate becomes optional. Removing the Predicate kind is not proposed, because it also holds compositions and applicability.

**Remaining questions.**

1. Is the rule-4 asymmetry acceptable as the default for explicit-negative policies, or should known gaps not block an explicit negative?
2. What is the record-type registry and versioning for evidence-model libraries, and how are pinned enum expansions bound to `Field<T>`?
3. Should unresolved candidacy or admissibility get dedicated causes (8b)?
4. Should inline `evidenceValue` replace one-use Predicates?
5. How should the coverage-domain key (record type + value set + scope) be matched against adapter attestations (Stage A §17 item 4)?

**Next smallest task.** Write the conformance case table (Stage B family B-04/B-11/B-12 style) for `explicit-assertion-v0` alone. Turn sections 4 and 7.3 into input/expected-output fixtures, including the materiality cases. This tests whether the policy is fully specified before any other policy or temporal window is added.
