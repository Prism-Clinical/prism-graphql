# Conformance fixtures: `explicit-assertion-v0`

**Status:** Proposed, like the [contract](../../evidence-query-to-predicate-contract.md) they test. They are not accepted, implemented or clinically approved, and they complete no delivery story. All records, codes, sources and permissions are fictional and nonclinical.

The expected outputs were written by hand from the contract (§§1–7) and [CANONICALIZATION.md](CANONICALIZATION.md). No evaluator produced them. `validate.py` checks structure, references, ordering and canonicalization only.

## Layout

| Path | Content |
|---|---|
| `query/q.demo.json` | The query contract (contract §7.1), predicate `p.demo` and pinned value-set expansion. Symbolic contract digest `d1` |
| `fixtures/EA-*.json` | Evaluation, partial-stage, preview and compilation fixtures |
| `fixtures/CAN-*.json` | Canonicalization fixtures |
| `index.json` | Contract case number (1–136) → fixture IDs; pairs (with their comparison mode); history-resolution groups; contrasts |
| `validate.py` | Structural validator and pair self-tests (`python3 validate.py --self-test`) |
| `check-canonical.cjs` | Canonical bytes, digests and variant IDs, verified with the RFC 8785 library `canonicalize@5.1.0` (see “Canonicalization checks”) |

## Expansion

Every fixture is **fully expanded**: its `input` lists the complete context, records, retractions, coverage, failures and rejected items. Nothing is inherited at load time.

- Evaluation fixtures reference the shared query by `query.file` and `query.contractDigest`, except where a case needs a different contract (cases 115a/b: another authored `assertionKind` set). Those carry the full modified query inline (`query.inline`) with their own symbolic contract digest (`d-ak1`), which their Need keys use (contract §2.6, §6.2).
- Preview and compilation fixtures carry their full, modified query inline (`query.inline`). A hole in an inline query uses the program hole syntax (first-program contract §2, P6): `id`, `type`, a nonblank `explains`, optional `cites`, and nothing else. EA-052a and EA-052b were corrected to it on 2026-10-29 (`over` removed, `explains` added), and so was EA-050’s whole-contract hole (`explains` added); expected outcomes are unchanged.

The contract’s defaults (§7.2, D0) were applied when the fixtures were written and are visible in each file.

Each evaluation and preview fixture requests output `p.demo`. The query output is therefore material (contract §6.2), and an `Unresolved` result emits Needs unless a key binding is unresolved.

## Fixture fields

| Field | Meaning |
|---|---|
| `id`, `title`, `contractCases` | Identity and the contract §7.4 case numbers covered |
| `kind` | `evaluation`, `stage` (partial-stage: S1–S3, S1–S4, S1–S5 with S5 limited to `criterion`, `classification` and `possibleClasses` facts, or S1–S6 with S6 limited to gap relevance: `cell`, `gap`, `notCurrent`), `preview`, `compilation` or `canonicalization` |
| `policy`, `evidenceModel` | `explicit-assertion-v0`, `demo-model@0.1` |
| `comparison` | Which comparison rule set below applies |
| `input` | Snapshot (`snapshot`, `supersedesSnapshot`, `context`, `records`, `retractions`, `coverage`, `failures`, `rejectedItems`), or `rawOccurrences` for canonicalization |
| `expected.evidence` | `{"status":"Known","value":bool,"supportingEvidenceIds":[…]}` or `{"status":"Unresolved","causes":[…],"candidateEvidenceIds":[…]}` (contract §5.1) |
| `expected.decision` | The projection (contract §5.2) |
| `expected.causeAttribution` | Entries `{cause, origin, stage, reason, refs?}`. Empty for `Known` |
| `expected.needs` | `evidence` (Need key and state causes, or `null`), `deferred` (`{"binding":…}` when a key binding is unresolved, else `null`) and `obligations` (`ResolveConflict` / `CorrectRecord` emissions only; fulfillment is deferred) |
| `expected.stages` | `stage` fixtures only: `["S1", "S2", "S3"]` or `["S1", "S2", "S3", "S4"]`, the stages whose facts the fixture asserts |
| `expected.traceAssertions` | Required trace facts; see the vocabulary below. **Partial**: a conforming trace may contain more |

## Identifier notation

| Notation | Meaning |
|---|---|
| `s1/r1` | `RecordKey` (source, localId) |
| `s1/r1@1` | `RevisionRef` |
| `s1/r1@1#<64 hex>` | Payload variant (CANONICALIZATION.md §7) |
| `s2:x60` | Retraction identity (`key.source`:`id`) |
| `cell:s2` | Coverage cell for a declared source |
| `f1`, `covA` | Failure and statement IDs |
| `context.episode` | Evaluation-context binding |
| `query` | Policy-level origin (rule-5 base causes, rule-1 conflict) |
| `excluded`, `unknown` | Possible-current markers (contract §2.1 step 7) |

## Comparison rules

**`evaluation-v1`**

- `evidence.status`, `value` and `decision` compare exactly.
- `causes`, `supportingEvidenceIds` and `candidateEvidenceIds` compare as sets. Each is also written in canonical order (contract §5.3), so an implementation emitting canonical order can compare them exactly.
- `causeAttribution` compares as a set of entries (all fields), canonically ordered by cause, then origin, then reason.
- `needs` compares exactly: Need key, state causes as a set, `deferred`, and obligations as a set.
- `traceAssertions`: every listed fact must hold in the implementation’s trace. List-valued facts (`variants`, `possibleCurrent`, `possibleClasses`, `stagesRun`) compare as sets, and are written in canonical order. Facts not listed are not asserted.

**`preview-v1`**

- `outcome` must be `PreviewOnly`.
- `markers` compares as a set of `{output, holes}`.
- `evidence` must be `null`, meaning no patient-evidence result is reported for a holed query.
- `needs` compares exactly; it is always empty for holes.
- `publication` must be `Blocked`.
- `traceAssertions` follow the `evaluation-v1` rules.

**`stage-v1`** (partial-stage)

- Used where the downstream outcome is outside what the contract or the implementation currently specifies: group K (a revision that is `Inadmissible` while another rule is unresolved) group L (S4 selection, whose S5–S6 consequences are not implemented) group M (per-revision S5 criterion values), group N (per-revision classification) and group O (key-level possible classes, without materiality) and group P (S6 gap relevance, without base result, materiality or cause attribution). The fixture states no `evidence`, `decision`, `causeAttribution` or `needs`, and is never evidence that a downstream result is right or wrong.
- `expected` holds exactly `stages` and `traceAssertions`. With stages S1–S3, facts are restricted to `keyResult`, `variants`, `occurrences`, `rejected`, `outOfEnvelope`, `outsideEnvelope`, `diagnostic`, `candidacy`, `encounterScope`, `episodeScope`, `assertionKindScope` and `admissibility`. With stages S1–S4, `selection` and `disposition` are also allowed. With stages S1–S5, `criterion`, per-record `classification` and key-level `possibleClasses` are also allowed; `material` is not, so an S1–S5 stage fixture never states materiality or an evidence result. With stages S1–S6 (vocabulary extension, 2026-10-29), `cell`, `gap` and `notCurrent` are also allowed, and nothing else of S6: no `material`, `rule`, cause attribution or evidence result, so an S1–S6 stage fixture states gap relevance only. Facts compare as for `evaluation-v1`.
- The query is referenced or inlined as for evaluation fixtures.

**`compilation-v1`**

- `outcome` must be `CompileFailure`, with a diagnostic at each listed `location` (a JSON Pointer into the inline query).
- `code: null` means any diagnostic code. Stage A §10.4 does not yet fix one for these errors.
- No preview and no Needs.

**`canonicalization-v1`**

- `rawOccurrences` are JSON *texts*, so their key order is preserved.
- Each expected variant lists the occurrence indices it contains, its exact `canonicalBytes` and its `digest`, all compared exactly.
- `undeclaredFields` lists dotted paths per occurrence.

## Trace-assertion vocabulary

| `fact` | Fields | Asserts |
|---|---|---|
| `keyResult` | `ref` (key), `value` ∈ `Current`/`Retracted`/`NoRecord`/`UnresolvedRevision`, `current?`, `causes?`, `possibleCurrent?` | S1 result for the key |
| `variants` | `ref` (`RevisionRef`), `value` | Variant IDs under one `RevisionRef` |
| `occurrences` | `ref`, `count` | Occurrences merged into one variant |
| `rejected` | `ref`, `reason` | A rejected correction or retraction (`Unauthorized`, `CrossKeyCorrection`, `CrossKeyRetraction`, `SubjectChanged`, `RecordTypeChanged`) |
| `outOfEnvelope` | `ref` | Out-of-envelope revision (S1 step 2) |
| `outsideEnvelope` | `ref` | Item from an undeclared source; never evaluated |
| `candidacy` | `ref`, `value` ∈ `InDomain`/`OutOfDomain`/`Unresolved` | S2 |
| `admissibility` | `ref`, `value` ∈ `Admissible`/`Inadmissible`/`UnresolvedAdmissibility`, `reason?` or `reasons?`, `causes?` | Combined S3 for one revision or variant (contract §2.7). `reason` (one) or `reasons` (several, code point order) is the **complete** set of mismatch reasons. `causes` is the set of the revision’s unresolved findings’ causes, for any value; under `Inadmissible` these are the findings kept beside the mismatch |
| `encounterScope` | `ref` (revision or variant), `value` ∈ `Matches`/`DoesNotMatch`/`Unresolved`/`NotEvaluated`, `causes?` | The S3 same-encounter rule alone (contract §2.4). Not an admissibility result |
| `episodeScope` | `ref` (revision or variant), `value` ∈ `Matches`/`DoesNotMatch`/`Unresolved`/`NotEvaluated`, `causes?` | The S3 same-episode rule alone (contract §2.5). Not an admissibility result |
| `assertionKindScope` | `ref` (revision or variant), `value` ∈ `Matches`/`DoesNotMatch`/`Unresolved`/`NotEvaluated`, `causes?` | The S3 `assertionKind` rule alone (contract §2.6). `DoesNotMatch` means a recognized kind outside the authored set (`AssertionKindNotAllowed`); an unrecognized value is `Unresolved{Invalid}`. Not an admissibility result |
| `selection` | `ref` (key), `value` ∈ `Selected`/`Unresolved`/`Inadmissible`/`OutOfDomain`/`Retracted`/`NoRecord`, `selected?` (the revision, with `Selected` only), `unresolvedBy?` (with `Unresolved` only; code point order) | S4 key status (contract §2.8). Not a materiality or evidence result |
| `disposition` | `ref` (revision or variant), `value` ∈ `Selected`/`NotSelected`, `blockers?` (with `NotSelected` only; code point order) | S4 disposition of one possibility (contract §2.8) |
| `classification` | `ref` (revision or variant), `value` ∈ `Supporting`/`Refuting`/`NonInformative`/`Unclassified`, `causes?` (with `Unclassified`; required in a stage fixture) | Per-record S5 classification of one possibility (contract §3.3, §3.6). Not possible classes |
| `criterion` | `ref` (revision or variant), `criterion` ∈ `establishes`/`refutes`, `value` ∈ `True`/`False`/`Unknown`/`Marker` (`Marker` in preview only), `causes?` (with `Unknown`; required in a stage fixture) | One criterion’s result over one possibility (contract §3.5). Not a classification |
| `possibleClasses` | `ref` (key), `value` (distinct classes from `Supporting`, `Refuting`, `NonInformative`, `excluded`, in that order; empty for a key with no possibilities) | What the key’s possible current could contribute: step B of contract §4.2, per §3.7. Not materiality |
| `material` | `ref` (key), `value` | Materiality |
| `cell` | `source`, `value` ∈ `Complete`/`Incomplete`/`Unknown`/`Absent` | Combined coverage cell |
| `gap` | `ref`, `relevant`, `provenBy?` | Gap relevance (contract §4.1). `provenBy` names one dimension that proves irrelevance (`recordType`, `subject` or `sources`). `ref` is a cell (`cell:s2`), a failure or rejected item ID, or a retraction identity (`s2:x60`) for an unattributable retraction. It is a display label: it must name exactly one gap of the result, whose structured identity (kind, origin, original ID, digest) is what implementations compare |
| `notCurrent` | `ref` | Statement or failure for another snapshot |
| `diagnostic` | `code`, `ref`, `path?`, `cause?`, `reason?` | `ContradictoryAttestation`, `InsufficientlyScopedStatement`, `CrossKeyCorrection` (on the target), `UndeclaredField`, `HistoricalDefect` (an S1 defect no longer involving a possible current revision; contract §2.1 step 7) |
| `rule` | `value` | Contract §4.2 rule applied |
| `needDeferred` | `binding` | No evidence Need, because a key binding is unresolved |
| `stagesRun` | `value` | Stages executed in preview |

## Attribution reasons

| Stage | Reasons |
|---|---|
| S1 | `PayloadConflict`, `Fork`, `CorrectionBoundaryUndeterminable`, `SelfSupersession`, `Cycle`, `CorrectionTargetAbsent`, `CorrectionRefIncomplete`, `CorrectionRefMalformed`, `CorrectionAuthorityMissing`, `CorrectionAuthorityMalformed`, `RetractionTargetAbsent`, `RetractionAuthorityMissing`, `RetractionAuthorityMalformed`, `RetractionConflict`, `EnvelopeFieldAbsent`, `EnvelopeFieldMalformed` |
| S2 | `TerminologyUnavailable`, `CodeMalformed`, `FieldAbsent:concept`, `FieldAbsent:concept.system`, `FieldAbsent:concept.code` (contract §2.3) |
| S3 | `FieldAbsent:<field>`, `FieldMalformed:<field>`, `ContextUnknown:<binding>` |
| S5 | `FieldAbsent:<field>`, `FieldMalformed:<field>` |
| S6 (origin `query`) | `AssertionConflict` (rule 1, with `refs`), `NoInDomainRecord`, `InadmissibleSeen`, `NonInformativeSeen` |
| `coverage` | `CellIncomplete`, `CellUnknown`, `CellAbsent`, `CellMalformedStatement` |
| `gap` | `AcquisitionFailed`, `ItemRejected` |

## Pairs and contrasts

`index.json` lists **pairs**, each with a `compare` mode:

- `result`: `evidence`, `decision` and `needs` must be identical, while diagnostics and trace assertions may legitimately differ. This applies to the before/after pairs 64/20, 64/21, 1/22 and 1/63, and to the irrelevant-gap pair 53/54.
- `wholeExpected`: the entire `expected` block must be identical, including cause attribution and trace assertions, and the two inputs must be permutations of each other without being identical. This applies to 70/71.

Within a compared field, ordering follows the `evaluation-v1` rules. Lists are written in canonical order. Implementations may compare them as sets, except where the fixture lists them in canonical order for an exact comparison.

**History resolution.** `historyResolution` names a before-state (EA-076, the revision-1 payload conflict), an after-state (EA-072, resolved by a valid correction) and four controls that must stay unresolved:

- EA-073: correction authority unresolved;
- EA-077: an independent active defect remains;
- EA-078: a later revision without `supersedes`;
- EA-079: ownership-conflicted variants.

A second group covers forks. Its before-state is EA-084 (`Affirmed` and `Denied` branches) and its after-state is EA-081, where an authorized retraction of the `Denied` branch leaves one head. Its two controls must stay unresolved: EA-082 (the retraction is unauthorized) and EA-083 (the retraction’s authority is unresolved).

A third group covers the step 7 fork fallback. Its before-state is EA-088: revision 1 is conflicted and two authorized corrections supersede it, so the conflict is historical and the two heads are a fallback fork. Its after-state is EA-089, where an authorized retraction of one head leaves the other. Its controls must stay unresolved: EA-091 (the retraction is unauthorized) and EA-092 (the retraction’s authority is missing; that defect stays active and no fallback fork is added). EA-090 retracts both heads, so the key is `Retracted`.

Resolved defects appear only as `HistoricalDefect` trace diagnostics, never in `causeAttribution`. Each defect is resolved by its own condition (contract §2.1 step 7).

**Self-test.** `python3 validate.py --self-test` mutates in-memory copies, never the committed files. It checks that:

- changing only EA-071’s cause attribution is rejected;
- changing only its trace assertions is rejected;
- adding a diagnostic to the before/after pair 1/22 is allowed;
- changing that pair’s result is rejected.

It also lists **contrasts** that keep proven-invalid boundary attempts distinguishable from undeterminable identity or authority, and from genuine payload conflicts. Three S2 contrasts (contract §2.3) keep an empty code apart from established nonmembership, a whitespace-only code apart from one with surrounding whitespace, and an absent component apart from a `null` one. Three encounter contrasts (contract §2.4) keep three pairs apart: a mismatch against a known evaluation encounter versus an unknown evaluation encounter; an absent record encounter versus a malformed one; and a whitespace-only encounter versus one with surrounding whitespace. Three episode contrasts (contract §2.5) keep an absent record episode apart from a `null` one, a whitespace-only episode apart from one with surrounding whitespace, and an unknown evaluation episode alone (EA-012) apart from one combined with an absent record episode (EA-113a). One selection contrast (contract §2.8) keeps unresolved history with an admissible alternative apart from unresolved history whose alternatives are all inadmissible: both stay `Unresolved` (EA-126, EA-127). Two combination contrasts (contract §2.7) keep a lone mismatch apart from a mismatch beside an unresolved rule (EA-107, EA-119), and a mismatch beside an unresolved rule apart from unresolved rules alone (EA-119, EA-122). Three `assertionKind` contrasts (contract §2.6) keep the same record under two authored sets apart (EA-114, EA-115a), a recognized-but-disallowed kind apart from an unrecognized string (EA-115a, EA-118a), and an absent kind apart from a `null` one (EA-116, EA-117).

## Canonicalization checks

Two helpers divide the work. Neither computes an expected evidence outcome.

- **`check-canonical.cjs`** uses a maintained RFC 8785 implementation, `canonicalize@5.1.0` from npm (by S. Erdtman). As in RFC 8785 Appendix A, it serializes primitives with ECMAScript `JSON.stringify`. The script first checks the library against the RFC’s Appendix B number vectors. It then verifies every canonicalization fixture’s bytes and digests, and every `variants` and `occurrences` assertion in the evaluation and partial-stage fixtures, numbers included. Run it without adding a repository dependency:

  ```bash
  TMP=$(mktemp -d) && npm install --no-save --prefix "$TMP" canonicalize@5.1.0 \
    && NODE_PATH="$TMP/node_modules" node check-canonical.cjs
  ```

  It requires Node ≥ 20.19, for `require()` of the ES-module package.
- **`validate.py`** handles a restricted subset: `null`, booleans, strings, arrays and objects. It uses RFC 8785 string escaping and member order on UTF-16 code units, parses strictly, and rejects duplicate member names, non-finite numbers and lone surrogates. It does **not** serialize numbers. Any payload containing a number is counted as *deferred to check-canonical.cjs* and is never reported as verified by `validate.py`.

## What `validate.py` checks

It checks that:

- every file parses, IDs are unique and match file names, and the index maps every case 1–136 to existing fixtures;
- expected lists and attributions are in canonical order;
- decisions are the projection of evidence, and Need causes equal result causes;
- a `stage` fixture expects exactly stages S1–S3, S1–S4, S1–S5 or S1–S6 and only facts of those stages (for S5, `criterion`, `classification` and `possibleClasses` only; for S6, `cell`, `gap` and `notCurrent` only), with no downstream expectation; a stage `cell` fact has one of the four statuses; a stage `gap` fact has a boolean `relevant` and `provenBy` (`recordType`, `subject` or `sources`) exactly when irrelevant; a stage `criterion` fact names `establishes` or `refutes`, has value `True`, `False` or `Unknown`, and has nonempty `causes` exactly when `Unknown`; a stage `classification` fact has one of the four classes and nonempty `causes` exactly when `Unclassified`; a stage `possibleClasses` fact lists distinct classes in canonical order; `reasons`, `causes`, `unresolvedBy` and `blockers` are in canonical order; `selected` appears only with `Selected`, `unresolvedBy` only with `Unresolved`, and `blockers` only with `NotSelected`;
- an inline evaluation query is a full query with its own contract digest, and every Need key and obligation key uses the fixture’s contract digest;
- every `variants` assertion matches the digests of the input occurrences (number-free payloads; numeric ones are deferred);
- each canonicalization fixture’s hand-written `canonicalBytes` are reproduced from its raw occurrences (number-free payloads; numeric ones are deferred), and its digest is the SHA-256 of those bytes;
- each pair satisfies its `compare` mode, and the history-resolution before-state and controls are `Unresolved` while the after-state is `Known`;
- no defect shown as `HistoricalDefect` also appears as an active attributed cause.

It computes **no** expected evidence result, cause, Need or trace fact.

## Open items

These do not block consumption, but an implementation must handle them explicitly:

1. **`d1` is symbolic.** Map it to your computed contract digest. The contract-digest algorithm depends on the canonical source/IR schema (Stage A §17 item 7).
2. **Compile diagnostic codes** for cases 51a/51b are unspecified (`code: null`).
3. **`CorrectRecord` fulfillment** is deferred; fixtures test emission only.
4. **The reevaluation sequence (contract §6.3)** has no fixture, because the orchestrator attempt-event format is unspecified.
5. **Trace assertions are partial.** No complete expected trace format is defined.
