# @prism/pathway-language (experimental, nonclinical)

**Status:** an implementation experiment. It covers **S1–S5** of the *proposed* [evidence-query-to-predicate contract](../../docs/superpowers/records/pathway-language/evidence-query-to-predicate-contract.md): S1 revision history, S2 candidate identification, the S3 same-encounter, same-episode and `assertionKind` rules, their combination into one admissibility result per possible revision (increment I3), S4 selection, S5 criterion evaluation and classification **for one record at a time**, S5 **key-level possible classes**, and **query-bound preview evaluation** of whole-criterion holes (increment I4). Every acceptance item of I4 is now checked and passes, including EA-052a’s two preview `criterion` facts (case 52), so I4 is complete **as an experimental increment** only. Of S6 (I5), only **gap relevance** exists: coverage cells and the relevance of each gap. Base results, materiality of unresolved records, cause attribution and the final evidence result do not, so no query result is computed and I5 is not complete. It also has the **first PPL compiler subset** and **isolated program-expression execution** over supplied query results (increments I1 and I2 of the [first-program implementation contract](../../docs/superpowers/records/pathway-language/first-program-implementation-contract.md)). It is not an end-to-end PPL evaluator and is not clinically approved; compiling or executing a program confers no clinical approval. It must not be used for patient care. The RFC, Stage A, the contract and the delivery plans keep their existing statuses; nothing here completes a delivery story.

This package is the isolated `libs/pathway-language` boundary named in RFC §10. It has no imports from applications, resolvers, databases or the network; `src/` imports only Node’s `crypto` and one RFC 8785 library.

## Public boundary

```ts
import { experimentalResolveRevisionHistory, DEMO_AUTHORITY_RULE } from '@prism/pathway-language';

const result = experimentalResolveRevisionHistory({
  envelope: { recordType: 'demo-model/DemoAssessment@0.1', subject: 'P1', sources: ['s1', 's2'] },
  authorityRule: DEMO_AUTHORITY_RULE, // the only supported rule: demo-policy/same-source-amend@1
  revisions,   // raw revision occurrences (JSON), exactly as in the fixtures' `input.records`
  retractions, // raw retraction occurrences (JSON)
});
```

The function is pure: no I/O, no clock and no input mutation. For each record key in the envelope it returns a `KeyResolution` (`src/s1/types.ts`):

| Field | Meaning |
|---|---|
| `status` | `Current`, `Retracted`, `NoRecord` or `UnresolvedRevision` |
| `current` | The current `NodeRef`, for `Current` only |
| `causes` | Active S1 causes in Stage A order, for `UnresolvedRevision` only |
| `possibleCurrent` | *H* ∪ *X*: nodes (with a variant digest for a conflicted revision), `excluded`, `unknown` |
| `activeDefects` / `historicalDefects` | Defects with cause, reason, subject, involved revisions and active additions. Historical defects are trace diagnostics (`HistoricalDefect`), never causes. A step 7 fallback fork (contract §2.1) is an active `Fork` whose subject is the key and whose `involves` are the remaining heads |
| `revisions` | Every revision with its state (`head`, `superseded`, `retracted`, `rejected`, `outOfEnvelope`) and its variants: digest, RFC 8785 canonical payload, membership, and occurrences. Each occurrence has its provenance, `undeclaredPaths` and `undeclaredFields` (path and verbatim value) |
| `diagnostics` | Target-side traces (`CrossKeyCorrection`, `CrossKeyRetraction`, retractions of out-of-envelope, rejected or superseded revisions) |

The `S1Result` also lists:

- `retractions`: one `RetractionInfo` per retraction identity from a declared source (below);
- `rejections` (unauthorized and cross-boundary items);
- `outsideEnvelope`;
- `unidentified` occurrences, which lack identity or are not RFC 8785 representable;
- `unattributableRetractions`.

**Retraction trace.** Each `RetractionInfo` (`src/s1/types.ts`) has:

| Field | Meaning |
|---|---|
| `ref` | Retraction identity (`key.source`, `id`) |
| `key` | The retraction’s own `key` when every variant names the same one, else `Disagreed`. `key` is payload, so no single occurrence speaks for the group |
| `variants` | Each distinct payload: the `key` it names, `digest`, `canonicalPayload` (`key`, `target`, `author`), `target` as received (`RevisionRef`, or `Absent` / `Malformed`; never inferred) and every `occurrence` with provenance and undeclared fields |
| `authority` | `Authorized`, `Unauthorized`, `Missing` or `Malformed` (contract §1.3), or `NotEvaluated` when an earlier step 6 row (conflict, unattributable target, cross-key, target outside the envelope, out-of-envelope, rejected or absent target) decided the effect |
| `effect` | `Removed`; `NoEffect` (`TargetSuperseded`, `TargetRejected`, `TargetOutOfEnvelope`, `TargetKeyOutsideEnvelope`); `Rejected` (`Unauthorized`, `CrossKeyRetraction`); `Defect` (cause and reason: `RetractionTargetAbsent`, `RetractionAuthorityMissing`, `RetractionAuthorityMalformed`, `RetractionConflict`); or `Unattributable` (`Missing` / `Invalid`) |

A `Defect` effect says only that the defect was recorded. Whether it is still active is in the target key’s `activeDefects` / `historicalDefects`, under subject `{kind: 'retraction', ref}`. Retractions from undeclared sources are not traced here; like revisions, they appear only in `outsideEnvelope` and are never evaluated. Their content is auditable only from the original frozen snapshot, which callers must retain.

Identity tuples (`RecordKey`, `RevisionRef`, `RetractionRef`, `NodeRef`) are objects. Display strings exist only in the tests, for comparing with the fixtures’ notation.

**Determinism.** Every decision is taken over sets keyed by identity. Input order, revision-ID order and timestamps never choose a revision. Output lists are sorted canonically (contract §5.3) for representation only. Occurrences with identical provenance are ordered by their remaining content. The only field that follows input positions is `Occurrence.inputIndex`, which is kept for traceability.

**Undeclared fields.** Declared fields are looked up in a `Map`, never with `in` or indexing on an object literal, so a JSON property named `constructor`, `__proto__`, `toString` and so on is an ordinary undeclared field. It is excluded from the payload and digest, reported in `undeclaredPaths`, and kept verbatim in `undeclaredFields`.

**Canonicalization.** Payload equality follows CANONICALIZATION.md. Serialization uses [`canonicalize`](https://www.npmjs.com/package/canonicalize) 2.1.0 (Apache-2.0, by S. Erdtman, an RFC 8785 author). It is the last CommonJS release, with no engine constraint, so it runs on the repository’s Node ≥ 18. Later releases are ES modules requiring Node ≥ 18 (3.x/4.x) or ≥ 22 (5.x).
- **Conformance test:** `src/__tests__/canonical-json.test.ts` checks it against all 24 RFC 8785 Appendix B number vectors and the §3.2.3 sample, with expected strings copied from the RFC. It also checks that members named `toJSON`, `__proto__` and `constructor` are ordinary: the library calls `toJSON` only when it is a function, which a JSON value never has.
- **Cross-check:** the fixture checker verifies the same digests with `canonicalize@5.1.0`. That is a different major version by the same author, so the cross-check is weaker than a fully independent implementation. `validate.py` checks the number-free subset in Python.
- **Lone surrogates:** 2.1.0 escapes them instead of rejecting them, so `payload.ts` rejects them explicitly.
- No RFC 8785 serialization is hand-written here.
- **History:** `json-canonicalize` 3.0.1, used until this change, serialized any object with a `toJSON` member through `JSON.stringify`, leaving its members unsorted. Two orderings of `{"toJSON":…,"b":…,"a":…}` inside a malformed value got different digests and a false `PayloadConflict`. CAN-12 now covers this.

## S2: candidate identification

S2 takes S1’s result and a pinned value-set expansion. For each possible current revision it decides whether the evidence *could concern* the queried concept (contract §2, row S2). It does not decide what the evidence establishes.

```ts
import { experimentalIdentifyCandidates, S2ConfigurationError } from '@prism/pathway-language';

const s2 = experimentalIdentifyCandidates({
  s1: result,                     // experimentalResolveRevisionHistory(...) output, used as is
  valueSet: 'demo-vs/item-x@1',   // the contract's retrieve.valueSet pin
  expansion: { id: 'demo-vs/item-x@1', expansion: [{ system: 'demo-cs', code: 'item-x' }], coveredSystems: ['demo-cs'] },
});
```

The expansion uses the format of the fixtures’ `query/q.demo.json` `valueSets` entry, plus its `id`. The `id` includes the version and must equal the pin exactly. The function is pure: no I/O, no clock, no input mutation, and no terminology lookup. It throws `S2ConfigurationError` for invalid *program or configuration* input, never for patient evidence:

- a missing or malformed pin;
- a missing expansion, or one whose `id` differs from the pin (for example `@2` for `@1`);
- a malformed code list or covered-system list, including any identifier that violates the syntax below;
- an expansion code in a system it does not cover;
- an input that is not an S1 result, or an S1 node with no unique retained variant.

An explicitly supplied empty expansion is honoured.

**Output** (`src/s2/types.ts`). `S2Result = { experimental, valueSet, keys: KeyCandidacy[] }`, one entry per S1 key in `RecordKey` order:

| `KeyCandidacy` field | Meaning |
|---|---|
| `s1Status` | S1 status, unchanged |
| `inheritedCauses`, `inheritedDefects` | S1’s active causes and defects, unchanged and still attributed to S1 |
| `possibilities` | `Current`: the current node. `UnresolvedRevision`: every entry of `possibleCurrent`, in S1 order, including each digest-qualified variant. `Retracted` / `NoRecord`: empty, which is no negative conclusion |
| `candidate` | True if **any** possibility could be in domain: `InDomain`, `Unresolved` or `unknown`. It includes unresolved possibilities and does **not** mean membership is established |
| `causes` | Inherited causes ∪ every possibility’s S2 causes, in Stage A order. No S5/S6 materiality filter is applied, so an out-of-domain possibility never discards an inherited defect |

Each possibility is one of:

| Possibility | When |
|---|---|
| `{kind:'node', node, candidacy:'InDomain', reason:'CodeInExpansion', code}` | `concept.system` is covered and (`system`, `code`) is in the expansion |
| `{kind:'node', node, candidacy:'OutOfDomain', reason:'CodeNotInExpansion', code}` | Well-formed code in a **covered** system, not in the expansion |
| `{kind:'node', node, candidacy:'Unresolved', findings}` | `Unavailable`/`TerminologyUnavailable`: well-formed code in an uncovered system. `Invalid`/`CodeMalformed`: `concept` not an object, or `system`/`code` present but not a well-formed identifier. `Missing`/`FieldAbsent:concept[.system\|.code]`: absent. Findings from different components accumulate |
| `{kind:'excluded'}` | Carried from S1: possibly not a current record. Never in domain |
| `{kind:'unknown'}` | Carried from S1: possibly a current revision with any content. Possibly in domain |

The expansion pin is on the result (`valueSet`). `node` is S1’s `NodeRef`, with `digest` for a variant.

**Identifier syntax** (contract §2.3). A system or code is well-formed if it is a string containing at least one character without the Unicode `White_Space` property. `""`, `"   "` and `"\u00a0\u2003"` are malformed. Nothing is trimmed or normalized, so `" item-x"` is well-formed and differs from `item-x`. The same rule applies to the expansion’s pin, codes and covered systems; a violation there is a configuration error.

**How payloads are read.** S2 reads each node’s concept from the variant S1 retained, by parsing the RFC 8785 bytes in `Variant.canonicalPayload`. A node without a digest must have exactly one variant, and a digest selects one. S2 never re-reads input rows, uses input positions, re-derives history or reconsiders superseded or rejected revisions. Undeclared concept members, such as `display`, are not payload, so they cannot affect membership. Comparison is exact on `system` and `code`: no normalization, case folding, synonyms or cross-system matching (Stage A §3.1).

**Worked example (S1 → S2).** `s1/r1@1` has concept `demo-cs#item-x`. `s1/r1@2` supersedes it with concept `demo-cs#item-y`, but its author’s permissions are absent (contract case 18, shape).

| Stage | Result |
|---|---|
| S1 | `UnresolvedRevision`, causes `[Missing]` (`CorrectionAuthorityMissing`), possible `[s1/r1@1, s1/r1@2]` |
| S2 | `@1 InDomain (CodeInExpansion)`, `@2 OutOfDomain (CodeNotInExpansion)`; `candidate: true`; `inheritedCauses: [Missing]`; `causes: [Missing]` |

S2 picks no winner. Whether the correction was authorized is still open, so the key stays a candidate and keeps its `Missing` defect. S5/S6 later decide whether it is material.

## S3: the same-encounter check (one admissibility rule)

This is **one rule** of S3 (contract §2.2), specified on its own in contract §2.4. It is not the S3 result. A match says only that this rule holds: episode, `assertionKind` and any other admissibility rules are not evaluated. No per-key admissibility decision, evidence result, clinical conclusion or Need is produced.

```ts
import { experimentalCheckEncounterScope, SAME_ENCOUNTER_RULE, EncounterCheckConfigurationError } from '@prism/pathway-language';

const enc = experimentalCheckEncounterScope({
  s1,                                   // experimentalResolveRevisionHistory(...) output
  valueSet: 'demo-vs/item-x@1',         // S2 parameters: S2 runs inside, on this s1
  expansion,
  rule: query.contract.admissible.encounter, // the authored rule, as written
  contextEncounter: { known: 'N1' },    // or { unknown: ['Conflicting'] } (contract §1.6)
});
```

**One snapshot, structurally.** There is no `s2` parameter. The check runs S2 on the supplied `s1`, so an S2 classification from another snapshot can never be combined with it. Review of b8eb6fe found that the earlier `{s1, s2}` signature compared only key sets. With an updated S1 (an authorized correction made revision 2 current, at N0) and an old S2, it checked the superseded revision 1 and returned `Matches` against N1. That call is now rejected: any unexpected input field, `s2` included, throws `EncounterCheckConfigurationError`. A bad pin or expansion throws S2’s `S2ConfigurationError`. Contract §2 now requires that all stages of one evaluation read one snapshot.

**The rule stays visible.** `rule` is the query’s authored `admissible.encounter` node, which must equal `SAME_ENCOUNTER_RULE`, `{eq: [{field: [c, encounter]}, {ref: ctx.encounter}]}`. The node is recognized, not interpreted, so there is no expression evaluator. The function throws `EncounterCheckConfigurationError` for any other node, including a missing one, so there is never an implicit default. It also throws for:

- a malformed evaluation encounter (a `known` that is not a well-formed `EncounterRef`; an empty, repeated or unrecognized `unknown` cause list);
- an input that is not an S1 result, or any unexpected input field.

A malformed **record** encounter is patient uncertainty, never an error.

**Output** (`src/s3/types.ts`). `EncounterCheckResult = { experimental, check: 'same-encounter', valueSet, contextEncounter, keys }`. Each `KeyEncounterScope` holds:

- `key` and `s1Status`;
- S2’s `candidate`;
- `inheritedS1Causes` and `inheritedS1Defects`, unchanged;
- `possibilities`, in S2/S1 order, one per possibility below.

| Possibility | `encounter` |
|---|---|
| node, candidacy `InDomain` or `Unresolved` (S2 findings kept in `s2Findings`) | `Matches` (`recordEncounter`) · `DoesNotMatch` (`OtherEncounter`, both identifiers) · `Unresolved` (`findings`) |
| node, candidacy `OutOfDomain` | `NotEvaluated` (`OutOfDomain`). Never a mismatch |
| `excluded` / `unknown` | carried unchanged |

Each finding is `{cause, origin, reason}`:

- `Missing`, origin `record`, reason `FieldAbsent:encounter`;
- `Invalid`, origin `record`, reason `FieldMalformed:encounter` (not a well-formed `EncounterRef`: non-string, `null`, empty or whitespace-only);
- each of the context’s own causes, origin `context.encounter`, reason `ContextUnknown:encounter`.

**EncounterRef syntax** (contract §2.4). A string with at least one character outside Unicode `White_Space`, never trimmed. It is defined for encounters on its own, with a separate predicate in `src/s3/encounter.ts`, and not imported from S2’s code syntax. `" N1"` is well-formed and does not match `N1`.

Record and context findings accumulate (confirmed in review). A known record encounter is never compared with an unknown evaluation encounter. Comparison is exact. Payloads come from S1’s retained variant bytes, through `retainedPayload`, which S2 also uses now.

**Worked example (S1 → S2 → encounter check).** The evaluation encounter is `Known(N1)`. `s1/r1@1` is `Affirmed`, in domain, with encounter N1. `s1/r1@2` supersedes it with encounter N0, and its author’s permissions are absent.

| Stage | Result for `s1/r1` |
|---|---|
| S1 | `UnresolvedRevision`, `[Missing]` (`CorrectionAuthorityMissing`), possible `[@1, @2]` |
| S2 | `@1 InDomain`, `@2 InDomain`, candidate |
| Encounter check | `@1 Matches`, `@2 DoesNotMatch (OtherEncounter: N0 vs N1)`; `inheritedS1Causes: [Missing]` |

The match on `@1` does not clear the unresolved history, and the mismatch on `@2` deletes nothing. Whether `@2` is current is still open, and S4–S6 decide what that means. With `contextEncounter: { unknown: ['Conflicting'] }`, both revisions would instead be `Unresolved[Conflicting @ context.encounter]`. `@2`’s known N0 would not be called a mismatch.

### Conditional language demonstration: GERD progressive-dysphagia alarm

> **Not an approved clinical requirement.** This shows only how the check *would* behave **if** a pathway author required the dysphagia assessment to come from the evaluation encounter. Nobody has decided that. Every encounter identifier and record below is a synthetic test value. None comes from the user-supplied GERD source document or from patient data.

The [interpretation draft](../../docs/superpowers/records/pathway-language/gerd-progressive-dysphagia-interpretation-draft.md), not clinically adjudicated, cites source lines 340, 343 and 582: alarm-symptom screening at the initial visit, at 2–4 weeks, and “at EACH encounter”. It leaves open which encounters count (A2) and whether an earlier assessment counts later (Q5).

Suppose an author did write `admissible.encounter` as above for the alarm-assessment query, with evaluation encounter `Known(N-visit-2)`. The synthetic records would then behave like this:

| Synthetic record | Encounter check |
|---|---|
| Assessment documented at `N-visit-2` | `Matches`, which says nothing about whether the assessment is admissible on other rules or what it establishes |
| Assessment documented at `N-visit-1` | `DoesNotMatch`. Under this hypothetical rule it is out of scope; the rule would make it inadmissible, not a negative |
| Assessment with no encounter recorded | `Unresolved{Missing}`, which is not treated as current-visit evidence |
| Evaluation encounter itself unresolved | `Unresolved` with the context’s causes for every assessment |

This demonstration decides none of the following:

- whether the GERD pathway requires same-encounter evidence (A2);
- whether earlier assessments remain usable (Q5);
- what establishes *progressive* dysphagia (Q1–Q3);
- any other open question or approval in the draft.

A pathway that accepted earlier assessments would author a different rule, which this slice does not implement.

## S3: the same-episode check (one more admissibility rule)

Like the encounter check, this is **one rule** of S3 (contract §2.2), specified on its own in contract §2.5 (cases 108–113). It is not the S3 result. A match says only that this rule holds. The encounter and `assertionKind` rules are not applied, rule outcomes are not combined, and there is no per-key admissibility decision, selection, evidence result, clinical conclusion or Need. Neither check consumes the other's result.

```ts
import { experimentalCheckEpisodeScope, SAME_EPISODE_RULE, EpisodeCheckConfigurationError } from '@prism/pathway-language';

const epi = experimentalCheckEpisodeScope({
  s1,                                   // experimentalResolveRevisionHistory(...) output
  valueSet: 'demo-vs/item-x@1',         // S2 parameters: S2 runs inside, on this s1
  expansion,
  rule: query.contract.admissible.episode, // the authored rule, as written
  contextEpisode: { known: 'E1' },      // or { unknown: ['Conflicting'] } (contract §1.6)
});
```

**Boundary.** The same as the encounter check, through the shared `src/s3/scope.ts`:

- There is no `s2` parameter. S2 runs on the supplied `s1`, so the two always read one snapshot. Any unexpected input field (`s2`, an encounter-check result, `contextEncounter`, …) throws `EpisodeCheckConfigurationError`.
- `rule` must equal `SAME_EPISODE_RULE`, `{eq: [{field: [c, episode]}, {ref: ctx.episode}]}`. It is recognized, not interpreted, and a missing rule is never defaulted.
- A bad pin or expansion throws S2's `S2ConfigurationError`.
- Configuration errors (contract §2.5): an evaluation episode that is not exactly one of `{known: …}` or `{unknown: …}`; a `known` that is not a well-formed `EpisodeRef` (non-string, empty or whitespace-only); an `unknown` list that is empty, repeated, sparse or has an unrecognized cause; a non-S1 input.
- **Unlike the encounter result**, the episode result is **detached and deep-frozen** (`detach`, as for compiler and I2 results). Later edits to the S1 result or to the context binding cannot reach it.

**Output** (`src/s3/types.ts`). `EpisodeCheckResult = { experimental, check: 'same-episode', valueSet, contextEpisode, keys }`. Each `KeyEpisodeScope` has the same fields as `KeyEncounterScope`, and each possibility carries `episode` in place of `encounter`:

| Possibility | `episode` |
|---|---|
| node, candidacy `InDomain` or `Unresolved` (S2 findings kept in `s2Findings`) | `Matches` (`recordEpisode`) · `DoesNotMatch` (`OtherEpisode`, both identifiers) · `Unresolved` (`findings`) |
| node, candidacy `OutOfDomain` | `NotEvaluated` (`OutOfDomain`). Never a mismatch |
| `excluded` / `unknown` | carried unchanged |

**EpisodeRef syntax** (contract §2.5). A string with at least one character outside Unicode `White_Space`, never trimmed. It is stated for episodes on their own, with its own predicate in `src/s3/episode.ts`; its content happens to equal the encounter rule. `" E1"` is well-formed and does not match `E1`.

| Record `episode` | Evaluation episode | Outcome | Findings (cause, origin, reason) | Case |
|---|---|---|---|---|
| Well-formed *e* | `Known(e)` | `Matches` | — | — |
| Well-formed *e* | `Known(f)`, *f* ≠ *e* | `DoesNotMatch` | reason `OtherEpisode` | 112 |
| Well-formed | `Unknown(C)` | `Unresolved` | each *c* ∈ *C*, `context.episode`, `ContextUnknown:episode` | 12 |
| Absent | any | `Unresolved` | `Missing`, `record`, `FieldAbsent:episode`; plus context findings if `Unknown` | 108, 113a |
| Present, not well-formed (non-string, `null`, empty, whitespace-only) | any | `Unresolved` | `Invalid`, `record`, `FieldMalformed:episode`; plus context findings if `Unknown` | 109–111, 113b |

- Identity is exact string equality, with no trimming, case folding or other normalization. No other field is consulted: episode membership is never inferred from dates, encounters or proximity.
- Record and context findings accumulate, as for encounters (§2.4). Context causes are kept in Stage A order and never relabelled. A known record episode never decides against an unknown evaluation episode.
- S1 causes and defects stay with the key, and S2 findings stay with the possibility. A match on one revision of an unresolved history neither resolves correction authority nor makes that revision current. A mismatch on another revision deletes nothing.

**History.** 507a8da shipped this check while `EpisodeRef` syntax was undefined, and stopped with a temporary `EpisodeRefSyntaxUnspecifiedError` on blank strings. Contract §2.5 now defines the syntax, the outcomes and the reason labels, and the exception is gone: blank record episodes are `Invalid`, and a blank known evaluation episode is a configuration error. EA-110, EA-111a/b and EA-113b make the 507a8da check throw, so the fixture run fails.

**Worked example.** The evaluation episode is `Known(E1)`. `s1/r1@1` has episode E1. `s1/r1@2` supersedes it with episode E0, and its author's permissions are absent (case 18 shape).

| Stage | Result for `s1/r1` |
|---|---|
| S1 | `UnresolvedRevision`, `[Missing]` (`CorrectionAuthorityMissing`), possible `[@1, @2]` |
| S2 | `@1 InDomain`, `@2 InDomain`, candidate |
| Episode check | `@1 Matches`, `@2 DoesNotMatch (OtherEpisode: E0 vs E1)`; `inheritedS1Causes: [Missing]` |

With `contextEpisode: { unknown: ['Conflicting'] }` (case 12), both revisions are `Unresolved[Conflicting @ context.episode]`.

## S3: the `assertionKind` check (one more admissibility rule)

This is **one rule** of S3 (contract §2.2), specified on its own in contract §2.6 (cases 114–118). It is not the S3 result, and it is not S5: it checks **what kind of assertion** a record makes, never whether that assertion supports or refutes anything. Rule outcomes are not combined with the encounter or episode checks, and there is no per-key admissibility decision, selection, evidence result or Need.

```ts
import { experimentalCheckAssertionKind, AssertionKindCheckConfigurationError } from '@prism/pathway-language';

const ak = experimentalCheckAssertionKind({
  s1,                                          // experimentalResolveRevisionHistory(...) output
  valueSet: 'demo-vs/item-x@1',                // S2 parameters: S2 runs inside, on this s1
  expansion,
  rule: query.contract.admissible.assertionKind, // the authored {in: [...]}, as written
});
```

**Boundary.** As for the other two checks, through `src/s3/scope.ts`: no `s2` parameter (S2 runs on the supplied `s1`), any extra input field is rejected, a bad pin or expansion throws `S2ConfigurationError`, and the result is detached and deep-frozen.

**The authored rule is validated against the pinned model.** `rule` must be an object whose only member is `in`, an array whose every element is exactly a pinned `AssertionKind` code (`ClinicianDocumented`, `PatientReport`; the list is the compiler’s own `ENUMS`, so the two cannot drift). Anything else throws `AssertionKindCheckConfigurationError`: a missing rule (never a default set), another shape, an unrecognized, differently cased or padded code, a non-string, `null` or `undefined` element, or a sparse array (checked with an index loop, so holes are not skipped). The set is not hard-coded: it comes from the authored rule. A repeated code has no effect, and an explicitly authored empty set allows no kind; the compiler accepts both, and a test checks that the two agree.

**Output** (`src/s3/types.ts`). `AssertionKindCheckResult = { experimental, check: 'assertion-kind', valueSet, allowedKinds, keys }`. `allowedKinds` is the authored list as written. Each `KeyAssertionKindScope` has the same fields as the other checks’ keys; each node possibility carries `assertionKind`:

| Record `assertionKind` | `assertionKind` outcome | Case |
|---|---|---|
| Recognized kind in the authored set | `Matches` (`recordKind`) | 114, 115b |
| Recognized kind not in the authored set | `DoesNotMatch` (`AssertionKindNotAllowed`, `recordKind`) | 115a |
| Absent | `Unresolved [Missing, record, FieldAbsent:assertionKind]` | 116 |
| Anything else: non-string, `null`, `""`, whitespace, different case or spacing, any other string | `Unresolved [Invalid, record, FieldMalformed:assertionKind]` | 117, 118a–d |
| Out-of-domain possibility | `NotEvaluated` (`OutOfDomain`) | — |

An unrecognized string is **never** `AssertionKindNotAllowed`: its true kind is unknown. There is no context binding, so findings come from the record only. S1 causes and defects stay with the key and S2 findings with the possibility; a match neither resolves history nor makes a revision current.

**Settled in contract §2.6** (none of these were inferred silently):

- `assertionKind` is now typed `Field<AssertionKind>` (§1.2). Before, its absence was unstated; absent is `Missing`, by the general rule in §1.7.
- Duplicate and empty authored sets were unspecified; §2.6 now follows the compiler, which already accepted both.
- The reason labels `FieldAbsent:assertionKind` and `FieldMalformed:assertionKind`.

## S3: combined admissibility per possible revision (I3)

This combines the three rules above into one S3 result **per possible revision or variant** (contract §2.7). It is all of I3 in the [first-program implementation contract](../../docs/superpowers/records/pathway-language/first-program-implementation-contract.md). It produces no key-level outcome, picks no current revision, decides no materiality and computes no evidence result (S4–S6).

```ts
import { experimentalCheckAdmissibility, AdmissibilityCheckConfigurationError } from '@prism/pathway-language';

const s3 = experimentalCheckAdmissibility({
  s1,                                   // experimentalResolveRevisionHistory(...) output
  valueSet: 'demo-vs/item-x@1',         // S2 parameters: S2 runs inside, on this s1
  expansion,
  admissible: query.contract.admissible, // the authored object, as written: encounter, episode, assertionKind
  contextEncounter: { known: 'N1' },
  contextEpisode: { known: 'E1' },
});
```

**Combination** (contract §2.7), within one possibility only:

| Rule outcomes | `admissibility` |
|---|---|
| All three `Matches` | `Admissible` |
| At least one `DoesNotMatch` | `Inadmissible`: `reasons` (every mismatch), plus the unresolved `findings` and `causes` of the other rules, kept and not relabelled |
| No `DoesNotMatch`, at least one `Unresolved` | `UnresolvedAdmissibility`: `findings` and `causes` |
| Out-of-domain possibility | `NotEvaluated` (`OutOfDomain`), never `Inadmissible` |

A mismatch decides only the combined admissibility of *that* revision. If one required condition definitely fails, resolving another cannot make that revision admissible.

**Boundary.**

- The three individual checks run on the same `s1`, S2 parameters and context. There is no way to supply S2 or an individual rule’s result, so results from different snapshots, contracts or contexts cannot be combined. Any extra input field throws `AdmissibilityCheckConfigurationError`.
- `admissible` must author exactly `encounter`, `episode` and `assertionKind`. A missing, extra or non-object rule set throws `AdmissibilityCheckConfigurationError`; no rule is supplied by default.
- Each rule’s own validation is unchanged and keeps its error class: `EncounterCheckConfigurationError`, `EpisodeCheckConfigurationError`, `AssertionKindCheckConfigurationError`, `S2ConfigurationError`. A configuration error throws even when every rule would mismatch on the data; it is never unresolved admissibility.
- The rule outcomes are joined on node identity (revision and digest), so one possibility’s outcome is never combined with another’s.
- The result is detached and deep-frozen; inputs are never mutated. The existing individual-check APIs are unchanged.

**Output** (`src/s3/types.ts`). `AdmissibilityCheckResult = { experimental, check: 'admissibility', valueSet, contextEncounter, contextEpisode, allowedKinds, keys }`. Each `KeyAdmissibility` has `key`, `s1Status`, `candidate`, `inheritedS1Causes`, `inheritedS1Defects` and `possibilities`, and **no** key-level admissibility. A checked node possibility holds:

- `node`, `candidacy` and `s2Findings` (S2’s findings, kept separate);
- `rules`: `{encounter, episode, assertionKind}`, each rule’s own outcome, unchanged;
- `admissibility`, as above.

Each finding is `{rule, cause, origin, reason}`. Ordering is fixed and never follows evaluation order:

- `reasons`: by code point;
- `findings`: by cause (Stage A order), then rule, origin and reason by code point;
- `causes`: Stage A order.

`excluded` and `unknown` possibilities are carried unchanged. `Retracted` and `NoRecord` keys have no possibilities. An `Admissible` possibility of an `UnresolvedRevision` key leaves the key’s S1 causes and defects in place: admissibility does not make a revision current.

**Worked example** (case 123). s1/r123@1 is D0. s1/r123@2 supersedes it with the author’s permissions absent, encounter N0 and no episode.

| | Result |
|---|---|
| Key | `UnresolvedRevision`, `inheritedS1Causes: [Missing]` (`CorrectionAuthorityMissing`) |
| @1 | `Admissible` |
| @2 | `Inadmissible`, `reasons: [OtherEncounter]`, finding `Missing` (episode rule, record, `FieldAbsent:episode`) kept |

Whether @1 or @2 is current is still open. What the query concludes is S4–S6’s decision, which is not implemented.

## S4: selection (half of I4)

S4 decides, per key, whether its record is **selected** for criterion evaluation (contract §2.8). It evaluates no criterion, decides no materiality and computes no evidence result. S5, the rest of I4, is below: per-record criterion evaluation and classification, and key-level possible classes. I4 is still not complete (EA-052a’s preview criterion facts; see the status above).

```ts
import { experimentalCheckAdmissibility, experimentalSelect, SelectionConfigurationError } from '@prism/pathway-language';

const s3 = experimentalCheckAdmissibility({ s1, valueSet, expansion, admissible, contextEncounter, contextEpisode });
const s4 = experimentalSelect({ s3 });
s4.selected;     // [{ key, node }]: keys whose single current revision is in domain and Admissible
s4.unresolved;   // RecordKey[]
s4.inadmissible; // RecordKey[]
```

**Input.** Only `{ s3 }`, where `s3` is a combined S3 result that `experimentalCheckAdmissibility` produced in this process (a private registry, as for compiled packages in I2). A structural copy, a relabelled or frozen copy, an S1 or S2 result, or any extra field (`s1`, `s2`, …) throws `SelectionConfigurationError`. So S4 always reads one snapshot’s S1–S3 decisions and never reconstructs them.

**Key status** (contract §2.8):

| S1 | Possibilities | `status` | `unresolvedBy` |
|---|---|---|---|
| `Current` | in domain, `Admissible` | `Selected` | — |
| `Current` | in domain, `UnresolvedAdmissibility` | `Unresolved` | `AdmissibilityUnresolved` |
| `Current` | in domain, `Inadmissible` (other rules’ findings stay attached) | `Inadmissible` | — |
| `Current` | candidacy unresolved, `Admissible` / `UnresolvedAdmissibility` | `Unresolved` | `CandidacyUnresolved` (+ `AdmissibilityUnresolved`) |
| `Current` | candidacy unresolved, `Inadmissible` | `Unresolved` (both facts kept; below) | `CandidacyUnresolved` |
| `Current` | out of domain | `OutOfDomain` | — |
| `UnresolvedRevision` | anything, including one admissible or all inadmissible | `Unresolved` | `HistoryUnresolved` |
| `Retracted` / no record | none | `Retracted` / `NoRecord` | — |

**Possibility disposition.** Each revision or variant gets `selection: {disposition: 'Selected'}` (only the current revision of a `Selected` key) or `{disposition: 'NotSelected', blockers}`. The blockers are every applicable one of `AdmissibilityUnresolved`, `CandidacyUnresolved`, `HistoryUnresolved`, `Inadmissible` and `OutOfDomain`, in code point order. `excluded` and `unknown` are carried unchanged.

**Output** (`src/s4/types.ts`). `SelectionResult = { experimental, stage: 'S4', valueSet, keys, selected, unresolved, inadmissible }`. Each `KeySelection` keeps the S3 key’s identity, S1 status, candidacy, inherited S1 causes and defects, and adds `status` and `unresolvedBy`. Each node possibility is the S3 possibility unchanged (`node`, `candidacy`, `s2Findings`, `rules`, `admissibility`) plus `selection`. The three lists summarize the statuses in `RecordKey` order. The result is detached and deep-frozen, and its input is never mutated.

**What it never does.** It never selects by position, order, digest or recency. It never combines possibilities. It never treats an admissible possibility as resolving history, and never resolves history because every possibility is inadmissible; S6 decides whether that uncertainty is material. It never turns an inadmissible revision’s retained unresolved findings into a blocker of their own.

**Unresolved candidacy beside inadmissibility** (confirmed on review). A current revision with unresolved candidacy that is also `Inadmissible` is `Unresolved` by `CandidacyUnresolved`. Its possibility keeps both blockers (`CandidacyUnresolved`, `Inadmissible`) and every S3 reason. Its definite mismatch prevents it from supplying `Supporting` or `Refuting` evidence. Unresolved selection alone does not establish materiality or block the query. Its exact effect on S6’s base causes is deferred to S6. Case 125 (r6) pins the outcome.

**What S5 needs.** S5 classifies `selected` revisions, and `unresolved` keys only to judge materiality (contract §2 pipeline row S5; §4.2 step B). It needs:

- every possibility of each unresolved key, with its S2 candidacy and S3 admissibility;
- `excluded` and `unknown`;
- the inherited S1 causes.

These are all in the S4 result. It also needs **each revision’s fields** (`c.assertion`), which the result does not carry. An earlier version of this README claimed S4 carried everything S5 needs. That was wrong: two snapshots differing only in `assertion` gave identical S4 results. The evidence handoff below closes the gap.

### Evidence handoff (S3 → S4 → S5; internal)

Mechanism: an **internal immutable association**, not payloads in the output (`src/handoff.ts`).

- **Binding in S3.** For each checked possibility, S3 binds a deep-frozen copy of the payload S1 retained for that exact revision, and for that exact digest when a revision is conflicted. It is parsed from the variant’s canonical bytes with the existing `retainedPayload`, while S3 reads the same `s1` as its rule checks. A private `WeakMap` keys it by the possibility object of the result that owns it.
- **Rebinding in S4.** `experimentalSelect` binds the same payloads to its own result’s possibility objects, position for position.
- **Reading it back.** S5 criterion evaluation (below) uses the internal accessor `selectionEvidence(s4, possibility)` (`src/s4/select.ts`); `admissibilityEvidence(s3, possibility)` is its S3 counterpart. Neither is exported from the package index.

Guarantees:

- **One snapshot.** There is no lookup by record identity and no snapshot parameter, so the binding is never reconstructed from IDs. An accessor accepts only a result its stage produced in this process, and only that result’s own possibility objects.
- **Exact revision and variant.** Distinct variants keep distinct payloads. A corrected key supplies its current revision’s payload.
- **Explicit failure.** A copy (`JSON.parse(JSON.stringify(r))`), a spread or a fabricated object, or a possibility of another result, even one with identical identity and content, throws `EvidenceHandoffError`. So does any missing binding. It is never patient uncertainty, and another payload is never substituted.
- **Scope.** Every checked possibility has a payload, including inadmissible ones and the alternatives of unresolved keys. `excluded`, `unknown` and out-of-domain possibilities have none. Reading a payload never changes a disposition.
- **Immutability.** Payloads are deep-frozen copies. Editing the original records, the S1 result or a returned payload changes nothing.
- **Unchanged output.** No result field or ordering changed, and serialized S3 and S4 results are exactly as before.

**Lifetime and serialization limit.** A binding lives as long as its in-process result object. Serializing a result drops it by design, so evidence cannot be read from a stored or transmitted result. S5 must run on the in-process result of the same evaluation, or evaluation must start again from the snapshot.

## S5: criterion evaluation for one record (part of I4)

`experimentalEvaluateCriteria` evaluates a compiled query’s `establishes` and `refutes` over **one** possibility of an S4 result (contract §3.5, cases 130–132). It does not classify the record (§3.3), compute possible classes or materiality (§4.2 step B), or resolve the query.

```ts
const r = experimentalEvaluateCriteria({ package: pkg, query: 'q.demo', s4, possibility: s4.keys[0].possibilities[0] });
// r.outcome === 'Evaluated': r.establishes / r.refutes = { criterion, source, result, trace }
```

**Input.** Exactly `{ package, query, s4, possibility }`; anything else throws `CriteriaConfigurationError`, which is never a criterion value.

- `package`: a `CompiledPackage` from `experimentalCompile` in this process, authenticated through the compiler’s private registry. A copy is rejected, and so is a `PreviewPackage`, so holes are never turned into `Missing` or `False`.
- `query`: the ID of an `EvidenceQuery` declaration in that package.
- `s4`: an S4 result `experimentalSelectForQuery` produced in this process for exactly this `package` object and `query` ID (below).
- `possibility`: one of that result’s own possibility objects, by identity. A copy, or an identical possibility of another result, is rejected.

The payload comes only from `selectionEvidence(s4, possibility)`. There is no payload or snapshot parameter.

**Query-to-evidence association: enforced** (contract §3.5). Criteria are evaluated only over a selection made for the same query:

```ts
const s4 = experimentalSelectForQuery({
  package: pkg, query: 'q.demo',                                 // all authored configuration comes from here
  subject: 'P1', revisions, retractions,                         // runtime inputs only
  contextEncounter: { known: 'N1' }, contextEpisode: { known: 'E1' },
});
```

- Record type, sources, correction authority, value-set pin and expansion, and the three admissibility rules all come from the compiled query. Any other input field (`valueSet`, `expansion`, `admissible`, `envelope`, `authorityRule`, `s1`, `s3`, …) throws `QuerySelectionConfigurationError`, so nothing authored can be overridden.
- **S1 is constructed, not verified.** An S1 result retains no envelope or authority provenance and S1 keeps no registry, so no S1 result could be checked against the query. The bound entry point resolves S1 itself from the query’s envelope and authority rule; it accepts no S1, S2 or S3 result.
- The S4 result is recorded privately (a `WeakMap`, `src/bound.ts`) against the exact package object and query ID. `experimentalEvaluateCriteria` throws `CriteriaConfigurationError` for an S4 result bound to another package (even one with the same `packageId`, or an identical recompilation), to another query of the same package, or not bound at all: a copy, a fabrication, or a result of the standalone `experimentalSelect`.
- The standalone stage functions are unchanged and remain for isolated tests; their results are never evaluated by S5.
- Optional `snapshot: { id, coverage, failures, rejectedItems }` (contract §1.5) attaches the current snapshot’s statements to this evaluation for gap relevance ([S6: gap relevance](#s6-gap-relevance-i5-first-slice)). It does not change the S4 result.

Before this, only the value-set pin was compared. A `ClinicianDocumented` record selected under a query that allows that kind then gave `establishes = True` for a second query with the same pin that allows no kind; it is now rejected, and the second query’s own selection makes the record `Inadmissible` (`NotEvaluated`).

**Supported expressions.** Only what the I1 compiler accepts in criterion position: `eq(c.assertion, AssertionValue.<v>)`. `all`, `any`, `not`, `call` and holes inside a criterion are compile errors. A hole replacing a whole criterion compiles only in preview, and preview packages are rejected here (they are evaluated only by `experimentalEvaluatePreviewQuery`, below). So the evaluator never receives any of them, and Boolean composition inside criteria is untested here. The evaluator reads `EnumCriterion` (field, enum type, literal) from the compiled package, not a raw expression tree.

**Eligibility** (by the S4 disposition, which is copied unchanged into the result):

| Possibility | Result |
|---|---|
| `Selected` | `Evaluated` |
| `NotSelected`, only `HistoryUnresolved` / `CandidacyUnresolved` / `AdmissibilityUnresolved` | `Evaluated`. Still `NotSelected`; nothing is selected, resolved or made material |
| Any `Inadmissible` blocker (also beside `CandidacyUnresolved`) | `NotEvaluated`, reason `Inadmissible` |
| Out of domain | `NotEvaluated`, reason `OutOfDomain` |
| `excluded` / `unknown` | `NotEvaluated`, reason `ExcludedMarker` / `UnknownMarker` |

`NotEvaluated` has no `establishes` or `refutes`: it is not `False` and not `Unknown`, and no payload is read.

**Values** (contract §3.4). Each criterion is evaluated independently, so `refutes` is never inferred from `establishes` (an `Indeterminate` record is `False`, `False`).

| `c.assertion` | Criterion value |
|---|---|
| Exactly `Affirmed`, `Denied` or `Indeterminate` | `True` if equal to the literal, else `False` |
| Absent | `Unknown`, finding `{ cause: 'Missing', origin: 'record', reason: 'FieldAbsent:assertion' }` |
| Anything else present (`null`, a number, boolean, object, array, `"affirmed"`, `"Affirmed "`, `""`) | `Unknown`, finding `{ cause: 'Invalid', origin: 'record', reason: 'FieldMalformed:assertion' }` |

**Trace.** Each criterion has three steps in evaluation order: `field` (pointer `…/eq/0`, `path: 'c.assertion'`, and `read`: `Present` with the code, `Absent`, or `Malformed` with the value verbatim), `enum` (pointer `…/eq/1`, the literal), and `eq` (the criterion’s pointer and its value). Pointers are into the package source, e.g. `/nodes/0/contract/establishes`. The result names the package, query, key, `node` (revision and digest) and the S4 `disposition`. It is detached and deep-frozen, and the inputs are not mutated.

## S5: classification for one record (part of I4)

`experimentalClassifyRecord` classifies **one** possibility of a query-bound S4 result (contract §3.3, §3.6, case 133). It never combines possibilities, computes possible classes (below) or materiality, or resolves the query.

```ts
const r = experimentalClassifyRecord({ package: pkg, query: 'q.demo', s4, possibility });
// r.outcome === 'Evaluated': r.classification = { class: 'Supporting' } | … | { class: 'Unclassified', causes: ['Missing'] }
```

**Input and ownership.** Exactly the input of `experimentalEvaluateCriteria`, which it calls: an authentic `CompiledPackage`, a query ID, an S4 result of `experimentalSelectForQuery` for that exact package object and query, and one of that result’s own possibilities. Every check is the evaluator’s (same `CriteriaConfigurationError`), and the payload still comes only from the handoff. There is no field for criterion values or results, so a caller cannot supply them.

**Table** (contract §3.3, meanings unchanged):

| `establishes` | `refutes` | Class | Through I1 compiled criteria |
|---|---|---|---|
| True | False | `Supporting` | reachable (`Affirmed`) |
| False | True | `Refuting` | reachable (`Denied`) |
| False | False | `NonInformative` | reachable (`Indeterminate`) |
| Unknown | Unknown | `Unclassified`, with causes | reachable (absent → `Missing`; malformed → `Invalid`) |
| Unknown | True/False, or the reverse | `Unclassified`, with the `Unknown` criterion’s causes | unreachable: both I1 criteria read `c.assertion` |
| True | True | throws `invariant: …` (an engine defect, not a class or patient conflict) | unreachable: the compiler rejects overlapping criteria (`EXCLUSIVE_BRANCH_OVERLAP`) |

`causes` are the deduplicated causes of every `Unknown` criterion, in Stage A order; the findings with origin and reason stay in the criterion results. The unreachable rows are tested on the internal table function only, never by fabricating a public criterion result.

**Result.** The criteria result unchanged (key, `node` with revision and digest, S4 `disposition`, `establishes` and `refutes` with their traces and findings), tagged `nonclinical-s5-classification-v0` / `one-possibility-classification`, plus `classification`. A `NotEvaluated` possibility keeps its reason (`Inadmissible`, `OutOfDomain`, `ExcludedMarker`, `UnknownMarker`) and has **no** `classification`: an excluded possibility is not `NonInformative`. A `Supporting` alternative of an unresolved key stays `NotSelected` and its key `Unresolved`. Detached and deep-frozen.

## S5: possible classes of one key (I4)

`experimentalPossibleClasses` says what **one** key of a query-bound S4 result could contribute (contract §4.2 step B, §3.7, case 134): a set of `Supporting`, `Refuting`, `NonInformative` and `excluded`, each explained. It does not decide whether that matters (materiality), compute base causes or an evidence result (S6), choose a current revision, or change a selection status.

```ts
const r = experimentalPossibleClasses({ package: pkg, query: 'q.demo', s4, key: s4.keys[0] });
// r.possibleClasses: e.g. ['Supporting', 'excluded']; r.possibilities[i].contributes: [{ class, basis }]
```

**Input and ownership.** Exactly `{ package, query, s4, key }`, with the same checks as criterion evaluation (authentic package, `EvidenceQuery`, S4 result bound to that exact package object and query), plus: `key` must be one of that result’s own key objects, by identity. The key check runs even when the key has no possibilities or only markers. Each possibility is classified through `experimentalClassifyRecord`; there is no field for classes, classifications, criterion values, possibilities or evidence. Failures throw `CriteriaConfigurationError`, never a class.

**Contribution table** (contract §3.7; canonical class order `Supporting`, `Refuting`, `NonInformative`, `excluded`):

| Possibility | Contributes | Basis |
|---|---|---|
| Classified `Supporting` / `Refuting` / `NonInformative` | that class | `Classified` |
| `Unclassified` (assertion absent or malformed) | `Supporting`, `Refuting`, `NonInformative`, **not** `excluded` (EA-004) | `Unclassified` |
| … with blocker `CandidacyUnresolved` | also `excluded` (confirmed on review) | `CandidacyUnresolved` |
| … with blocker `AdmissibilityUnresolved` | also `excluded` (EA-010, EA-011) | `AdmissibilityUnresolved` |
| Definitely inadmissible (also beside unresolved candidacy) | `excluded` only | `Inadmissible` |
| Out of domain | `excluded` | `OutOfDomain` |
| `excluded` marker | `excluded` | `ExcludedMarker` |
| `unknown` marker (“any content”, contract §2.1) | every class, **including** `excluded` (confirmed on review) | `UnknownMarker` |

`HistoryUnresolved` adds nothing: the key’s alternatives are its represented possibilities. The key’s set is the union, deduplicated; `Retracted` and `NoRecord` keys give `[]`. `Unclassified` and `unknown` differ deliberately: an `Unclassified` record exists and qualifies, only its assertion is unknown; an `unknown` possible current could hold anything, including content that does not qualify.

**Result.** The key, its S1 status, inherited S1 causes and defects, S4 `status` and `unresolvedBy` (all unchanged), `possibleClasses`, and per possibility in S4 order: the S4 possibility unchanged (candidacy, S2 findings, S3 rule outcomes and findings, disposition), its classification result (criteria, traces and findings, or `NotEvaluated` with its reason) and `contributes`, each `{ class, basis }`. So every class is traced to a revision, variant or marker and the uncertainty that added it, and S1, S2–S3 and S5 causes stay apart. A singleton set resolves nothing: an `Unresolved` key whose alternatives agree stays `Unresolved`, and `{Supporting, Refuting}` means either could be current, not that both occurred. Detached and deep-frozen.

## S5: preview evaluation of whole-criterion holes (I4)

`experimentalEvaluatePreviewQuery` evaluates **one** EvidenceQuery of a `PreviewPackage` over a raw snapshot (contract §3.5 Preview evaluation, §6.1; cases 50 and 52). It shows what the complete parts of an incomplete query do with the snapshot, and marks the incomplete parts as authoring holes. It never classifies, resolves, decides materiality, computes `Evidence<Boolean>` or emits a Need, and the query stays incomplete with publication blocked.

```ts
const r = experimentalEvaluatePreviewQuery({ package: preview, query: 'q.demo', subject: 'P1', revisions, retractions, contextEncounter, contextEpisode });
// r.contract: 'IncompleteCriteria' | 'WholeContractHole'; r.marker.holes; r.stagesRun
// r.keys[i].possibilities[j].record.establishes: { result: { value: 'Marker', hole: 'H-CRITERION' }, source: '…/establishes/hole', because: 'AuthoringHole' }
// r.keys[i].possibilities[j].record.refutes:     { result: { value: 'True' }, trace: [field, enum, eq] }
```

**Input and ownership.**

- Exactly the query-bound selection fields: `package`, `query`, `subject`, `revisions`, `retractions`, `contextEncounter`, `contextEpisode`. Any other field (a value set, expansion, rule, envelope, authority rule, criterion, payload, possibility or stage result) is rejected.
- `package` must be a `PreviewPackage` from `experimentalCompilePreview` in this process (compiler registry). A `CompiledPackage` is directed to the normal entry points; copies and fabrications are rejected.
- `query` must be an `EvidenceQuery` of that package.
- All authored settings come from the preview query. S1 is constructed from them, and S2–S4 run through the same internal code as `experimentalSelectForQuery`, so the S4 facts are identical to a complete twin query’s.
- The S4 result stays inside the call. Payloads are read only through the evidence handoff, from each possibility’s own binding, so record IDs shared across snapshots or digest-qualified variants cannot be confused. The output is plain data: its copied possibilities are rejected by the normal S5 entry points.
- Failures throw `PreviewEvaluationConfigurationError`, never a criterion value.

**By contract kind.**

| Query contract | Result |
|---|---|
| Whole-contract hole (EA-050) | `contract: 'WholeContractHole'`, the query marker, `stagesRun: []`. No stage runs, whatever the snapshot holds |
| `establishes` and/or `refutes` holed (EA-052a/b) | `contract: 'IncompleteCriteria'`, `stagesRun: [S1…S5]`, the query marker, `Pending` disjointness, which slot is a hole, S4’s summary lists, and per key and possibility the S4 facts unchanged plus a preview record |
| Complete query inside a `PreviewPackage` | Rejected, as a **scope restriction** of this slice (confirmed on review). Per-record preview of a complete query could be supported without S6; only its final query result needs S6. Until then, its per-record values need a normally compiled, hole-free program |

**Slots, per possibility.** Eligibility is the S5 table above, unchanged. An ineligible possibility is `NotEvaluated` with its reason and has **no** slot value, marker or otherwise. For an eligible one, `outcome: 'Evaluated'` means its slots were processed, not that patient evidence established anything; with both criteria holed it carries two markers and no patient value (confirmed on review). The marker values and `queryStatus: 'Incomplete'` keep that distinction:

| Slot | Result |
|---|---|
| Complete | Its §3.4 value and trace, exactly as `experimentalEvaluateCriteria` gives: `True`, `False`, or `Unknown` with `Missing` (absent) or `Invalid` (malformed) findings |
| Hole | `{ value: 'Marker', hole }`, the pointer of its `hole` member and `because: 'AuthoringHole'`. No trace, finding or cause |

**Query level.** `marker.holes` is the compiler’s marker for the query, shown with an empty snapshot and when nothing is eligible. `disjointness` stays the compiled `Pending` obligation: evaluating a sibling proves nothing.

**Not produced.** No `classification`, `possibleClasses`, contributions, materiality, evidence result or Needs; no field of that name occurs anywhere in the output. Detached and deep-frozen.

## S6: gap relevance (I5, first slice)

`experimentalGapRelevance` decides, for **one** query-bound evaluation, which gaps could affect the query (contract §1.5, §4.1 “Gap relevance boundary”). It produces coverage cells and, per gap, `Relevant` or `Irrelevant` with the checks behind it. It computes no base result, decides no materiality, attributes no final causes, produces no `Evidence<Boolean>` and emits no Need. A relevant gap is not itself `Missing` or `Conflicting`.

```ts
const s4 = experimentalSelectForQuery({ package: pkg, query: 'q.demo', subject: 'P1', revisions, retractions, contextEncounter, contextEpisode,
  snapshot: { id: 'snap-1', coverage, failures, rejectedItems } });
const r = experimentalGapRelevance({ package: pkg, query: 'q.demo', s4 });
// r.cells: [{ ref: 'cell:s1', status: 'Complete', establishedBy: ['cov-all'], affectedBy: [] }, …]
// r.gaps: [{ ref: 'f1', kind: 'AcquisitionFailure', relevant: false, provenBy: ['subject'], dimensions: [...], causes: ['Unavailable'], item }]
// r.relevant / r.irrelevant: gap references
```

**Ownership.**

- Coverage, failure and rejected-item statements enter through `experimentalSelectForQuery`’s optional `snapshot` field (contract §1.5 format; `id` is the current snapshot). Selection validates the structure, detaches the statements and records them privately against its own S4 result, with the subject and that run’s S1 result.
- `experimentalGapRelevance` takes exactly `{ package, query, s4 }`: the same authentic package object, query ID and bound S4 result as S5. It accepts no statement, subject or stage result, so a foreign, copied or standalone selection, another query’s selection, or one made without a snapshot is rejected (`GapRelevanceConfigurationError`). Nothing is reattached by matching identifiers.
- S1’s rejected items (unattributable retractions, unidentified occurrences) come from that same S1 run, never from S4 possibilities. Preview packages are outside this slice, and preview evaluation rejects a `snapshot`.
- Structural errors throw at selection: `snapshot` not an object, an omitted list (an empty list is fine, an omitted one is never read as “no gaps”), an entry that is not an object with a string `id`, or anything that is not a plain JSON value. The JSON check runs before canonicalization and deduplication (serialization is not validation): a sparse slot, an extra array member, an accessor, a symbol key, `undefined`, a non-finite number, a lone surrogate, a non-plain object or a cycle is rejected. Cycles are found on the current ancestor chain, with the path of both ends; an object shared by separate branches is accepted.

**Cells** (§1.5). One per declared source, for (query record type, evaluation subject, source):

| Current statements for the cell | Status |
|---|---|
| Any affecting `Incomplete` | `Incomplete` |
| Otherwise any affecting `Unknown` or malformed | `Unknown` (malformed adds `Invalid`) |
| Otherwise a fully scoped `Complete` naming it | `Complete` |
| Otherwise (no statement, or only statements for other cells) | `Absent` |

A statement *affects* a cell unless a stated, well-formed dimension excludes it. A `Complete` beside an affecting statement, or beside a missing correction/retraction target in that source, is traced as `ContradictoryAttestation`; a `Complete` with an unstated dimension establishes nothing (`InsufficientlyScopedStatement`). Statements for another snapshot are `notCurrent` and ignored. Every non-`Complete` cell is a **relevant** gap (`InsufficientEvidence`), `Incomplete`, `Unknown` and `Absent` alike, with its original status kept.

**Failures and rejected items** (§4.1). Each dimension gets a verdict; irrelevant only when one proves it:

| Dimension | Verdict | Proves |
|---|---|---|
| `recordType`, `subject` stated, equal / different | `Matches` / `Differs` | no / **yes** |
| `sources` sharing a declared source | `Overlaps` | no |
| `sources` disjoint, same-source correction rule (`demo-policy/same-source-amend@1`) | `Disjoint` | **yes** |
| `sources` disjoint, any other correction rule | `DisjointCorrectionPossible` | no |
| `valueSet`, `episode`, `encounter` stated | `NeverProves` | no |
| omitted or `null` / malformed | `Unstated` / `Malformed` (+`Invalid`) | no |

Causes: a failure `Unavailable`; a stated rejected item `Invalid`; an S1 unattributable retraction its S1 cause (`Missing` or `Invalid`), source stated only; an unidentified occurrence `Invalid`, nothing stated. S1 correction-history defects and proven boundary rejections are not gaps.

**Identity.** Every gap and statement reference is `{ identity, key, label }`. A statement’s identity is its list, original `id` and the SHA-256 of its RFC 8785 bytes; a gap’s identity is a cell’s source, a stated item’s statement identity, an S1 retraction’s `RetractionRef`, or an unidentified occurrence’s kind and input position. `key` is the identity’s own RFC 8785 bytes and never collides; `label` (`cell:s1`, `f1`, `f1#<digest>`, `s2:x60`) is for display and can coincide, e.g. for a failure named `cell:s1`.

**Result.** The envelope used, cells, gaps (cells, then failures, then rejected items; label, then key, within each) with `provenBy`, all dimension checks, malformed members, occurrence counts and the original item; the `relevant` and `irrelevant` reference sets; every received statement with currency and malformed members; `notCurrent`; and diagnostics. Identical duplicate statements merge (counted); the same `id` with different content stays as separate entries, each with its digest in its identity. Members outside the §1.5 format make a statement malformed (a coverage statement then counts as `Unknown`; a failure or rejected item adds `Invalid`); `attestedBy`, `attempt` and `reason` are the only designated metadata. Detached and deep-frozen.

**Clarifications** (contract §4.1), reviewed 2026-10-31: structure versus content, malformed failures and items, unreadable currency, duplicate IDs (with unambiguous identities), unidentified occurrences, the missing-target attestation and source disjointness under the correction rule are accepted; unrecognized members are rejected rather than ignored.

**Not implemented (rest of I5).** Base results (§4.2 step A), materiality of unresolved records (step B), cause attribution (step C), `rule` facts and the final `Evidence<Boolean>`.

## PPL compiler (I1): `experimentalCompile` and `experimentalCompilePreview`

The first compiler subset, specified by [first-program-implementation-contract.md](../../docs/superpowers/records/pathway-language/first-program-implementation-contract.md) §2, §5, §6 (compile rows), §7 and §8 (I1).

- It takes an **already-parsed JSON value**. Text parsing and duplicate-member detection are outside this subset.
- It **evaluates nothing**. No query runs, and no predicate or finding gets a value.

```ts
import { experimentalCompile, experimentalCompilePreview } from '@prism/pathway-language';

const program = JSON.parse(text);              // e.g. programs/schematic-demo-finding.ppl.json
const r = experimentalCompile(program);
if (r.outcome === 'Compiled') r.package;       // CompiledPackage: complete, ordinary
else r.diagnostics;                            // [{ code, location, hole?, message }]

const p = experimentalCompilePreview(program); // accepts correctly typed holes
if (p.outcome === 'PreviewPackage') p.package.markers; // [{ output: 'f.alarm.status', holes: [...] }]
```

| Entry point | Complete program | Well-formed, with typed holes | Structural error |
|---|---|---|---|
| `experimentalCompile` | `Compiled` + `CompiledPackage` | `CompileFailure`, `wellFormed: true`, one `UNRESOLVED_AUTHORING_HOLE` per hole (location `…/hole`, `hole` ID), `dependencyEdges` | `CompileFailure`, `wellFormed: false`, structural diagnostics |
| `experimentalCompilePreview` | `PreviewPackage` without markers | `PreviewPackage` with markers, `publication: 'Blocked'` | The same failure, with identical diagnostics |

**Package** (`src/compile/types.ts`). `CompiledPackage` and `PreviewPackage` share `CompiledProgram`, with different `kind` tags, so later code cannot mistake a preview for an executable package.

Every result, including failures, is a **detached, deep-frozen copy**: editing the source after compilation cannot change a package, and mutating a package throws. Every dictionary key is an own data property. So user-chosen identifiers such as `__proto__`, `constructor` or `toString`, as value-set or declaration IDs, survive enumeration and JSON serialization. `CompiledProgram` holds:

- `packageId` and the language and profile versions;
- `applicabilityId`;
- `declarations`: validated, in a deterministic topological order (dependencies first, ties by identifier);
- `references`: citation shapes only;
- `valueSets`: validated with S2’s own `expansionProblem`;
- `dependencyEdges`: `{reader, read, locations}`, deduplicated, with every authoring `ref` pointer kept;
- `holes`: `{id, type, explains, cites, location}`.

Each declaration keeps its source JSON Pointer:

- **Predicate** (with `applicability: true` for the top-level one): `expr`, a tree of `ref`, `evidenceValue`, `all` and `hole`, each node with its location.
- **EvidenceQuery**: `contract` is a whole-contract hole, a validated `explicit-assertion-v0` contract or, in a `PreviewPackage` only, an `explicit-assertion-v0-incomplete` contract.
  - **Complete contract.** It has the record type, sources, value set, authority rule, the recognized admissible rules, `establishes`/`refutes` as `{field, enumType, value}`, and a frozen copy of the authored contract (`source`) for S1–S3 reuse.
  - **Incomplete contract.** It has the same settings. Each criterion is `{kind: 'complete', criterion}` or `{kind: 'hole', hole, location}`, and `disjointness: {status: 'Pending', holes, locations}` (see below).
  - **Typing.** `CompiledPackage` is typed to hold complete contracts only, and `compile` checks this before producing one.
- **Finding**: `status`, `label`, `heading`, an `urgency` hole and `cites`.

`PreviewPackage` adds `markers` and the inspectable Finding attributes `<id>.label`, `<id>.heading` and `<id>.cites`.

**Supported subset.**

- Declarations: `EvidenceReference`, the required applicability `Predicate`, `EvidenceQuery`, `Predicate` and `Finding`.
- Program expressions: `ref` (declarations only), `evidenceValue` (in Predicate expressions), n-ary `all` (`all()` is True and is never a default), and typed holes. Holes are allowed only as a whole applicability expression (`Decision`), a whole query contract (`EvidenceSelectionContract<Boolean>`), a whole criterion (`Decision`, below) or a Finding `urgency` (`UrgencyRequirement`).
- Query contracts: exactly the explicit-assertion-v0 structure:
  - `demo-model@0.1` records, authority `demo-policy/same-source-amend@1`;
  - `admissible` episode and encounter recognized by exact shape, with `ctx.episode` / `ctx.encounter` only at those two positions;
  - `assertionKind` as `in` over `AssertionKind`;
  - criteria `eq(c.assertion, AssertionValue.<value>)` only, type-checked. Any other field is `UNSUPPORTED_CONSTRUCT`;
  - `disjoint(establishes, refutes)`, proved for two such equalities. Equal literals give `EXCLUSIVE_BRANCH_OVERLAP`; `UNSUPPORTED_PROOF_FRAGMENT` is kept for any other form but is unreachable under the restriction.
  - **Whole-criterion holes** (case 52). `establishes`, `refutes` or both may be `{"hole": {id, type: "Decision", explains, cites?}}`, replacing the whole criterion.
    - **Type.** `Decision`, the criterion’s type over the bound candidate `c`. The position fixes the binding, so there is no `over` member.
    - **Errors.** A wrong type is `TYPE_MISMATCH`, a missing `explains` is `SOURCE_INVALID`, and a hole inside a criterion is `UNSUPPORTED_CONSTRUCT`.
    - **Validation.** The sibling criterion and every other setting are validated exactly as in a complete contract.
    - **Normal compilation.** Fails, `wellFormed: true`, with one `UNRESOLVED_AUTHORING_HOLE` per hole at `…/<criterion>/hole`.
    - **Preview compilation.** Produces the incomplete contract above. Disjointness is `Pending`: not proved, not an overlap, and no value is assumed for the hole.
    - **Markers.** The query and its dependents are marked with the criterion holes.
    - **Rejection.** Every normal S4–S5 entry point and normal execution still reject the preview package.
    - **Preview evaluation.** `experimentalEvaluatePreviewQuery` (see [S5: preview evaluation](#s5-preview-evaluation-of-whole-criterion-holes-i4)).
- Everything else is rejected with a named code (`UNSUPPORTED_CONSTRUCT`, `UNKNOWN_EXECUTABLE_PROPERTY`, …). There is no general expression evaluator or theorem prover.

**Preview markers** (§7). An output is marked if and only if it contains a hole or references a marked output; its marker is the union of the contributing hole IDs. Output names:

- `<id>` for applicability, Predicate and EvidenceQuery;
- `<id>.status` for a Finding;
- `<id>.urgency` for an urgency hole, which marks only that attribute and never the status.

Markers are computed statically from references, so no Boolean simplification can remove one. They are never patient causes or data requests.

**Mechanical checks, compilation and execution are different things.**

- `programs/check.py` checks JSON, quotations, digests and links without compiling anything.
- This compiler validates and types programs and derives dependencies, but executes nothing.
- I2 (below) executes program expressions over **supplied** query results. I3, S4 and S5 (per-record criteria and classification, key-level possible classes; above) are computed, but no end-to-end evaluator exists yet (increments I5–I6), so no program has been evaluated from raw records.

## Isolated program-expression execution (I2)

This runs the compiled program’s expressions: `ref`, `evidenceValue`, n-ary `all`, Predicate outputs, Finding status and attributes, and preview markers, all with explanation traces. **Every EvidenceQuery result is supplied by the caller.** No query runs (S1–S6), no patient record is read, and no Need is generated. **This is not end-to-end clinical evaluation**, and the API names say so.

```ts
import { experimentalCompile, experimentalExecuteWithSuppliedQueryResults } from '@prism/pathway-language';

const c = experimentalCompile(program);                      // must be 'Compiled'
const r = experimentalExecuteWithSuppliedQueryResults(c.package, new Map([
  ['q.demo', { status: 'Known', value: false, supportingEvidenceIds: ['s1/r2@1'] }],  // supplied, not computed
]));
r.outputs['p.demo'];  // { decision: { value: 'False' }, supportingEvidenceIds: ['s1/r2@1'] }
r.outputs['f.demo'];  // { status:   { value: 'False' }, supportingEvidenceIds: ['s1/r2@1'] }
```

| Supplied `q.demo` (schematic program) | `p.demo` | `f.demo` status |
|---|---|---|
| `Known(true, [s1/r1@1])` | `True` [s1/r1@1] | `True` [s1/r1@1] |
| `Known(false, [s1/r2@1])` | `False` [s1/r2@1] | `False` [s1/r2@1]: only this finding is not established |
| `Unresolved{Missing}` | `Unknown(Missing)` | `Unknown(Missing)` |
| *(absent)* | — | `MISSING_QUERY_RESULT`: an input error, never `Unresolved{Missing}` |

**Boundary.**

- `experimentalExecuteWithSuppliedQueryResults` accepts only an I1 `CompiledPackage`. `experimentalExecutePreviewWithSuppliedQueryResults` accepts only a `PreviewPackage`. A package is accepted only if the I1 compiler produced that exact object in this process, as recorded in a private registry, and as the requested kind. Tags, shape and frozenness are not proof of compilation, so frozen fabrications, copies, relabelled packages and compile failures are all rejected.
- Query results are a `Map` keyed by EvidenceQuery ID, so IDs such as `__proto__` are ordinary keys. Each value is the settled `Evidence<Boolean>` fixture shape: `{status: 'Known', value, supportingEvidenceIds}` or `{status: 'Unresolved', causes (nonempty, Stage A causes), candidateEvidenceIds}`. Arrays are validated element by element: an `undefined` element or a sparse-array hole is malformed.

Evidence IDs use the fixture notation `source/localId@revision[#digest]`. This is the representation **this experimental boundary** supports, not a restriction on underlying record identities.
- Input errors are returned together, as `outcome: 'ExecutionInputError'`, never as patient uncertainty:
  - `INVALID_PACKAGE`;
  - `INVALID_QUERY_RESULTS` (not a `Map`);
  - `MISSING_QUERY_RESULT` (every complete query needs one);
  - `UNEXPECTED_QUERY_RESULT` (unknown or non-query ID);
  - `MALFORMED_QUERY_RESULT`;
  - `RESULT_FOR_HOLED_QUERY`: a result can never fill an authoring hole.

**Semantics** (contract §3, §7).

- `evidenceValue`: `Known(true|false, ids)` becomes `True|False` with those supporting IDs, and `Unresolved(C, ids)` becomes `Unknown(C)` with those candidate IDs.
- `all` (n-ary Kleene):
  - any `False` gives `False`, supported by the union of the False operands’ supports;
  - otherwise any `Unknown` gives `Unknown`, with the union of those operands’ causes and candidates;
  - otherwise `True`, supported by every operand;
  - `all()` is `True` with empty support.
- Every operand is evaluated and traced, even after a decisive one.
- IDs are deduplicated and ordered by `(source, localId, revision, digest)`; causes follow Stage A order.
- **Preview:** outputs that depend on a hole are markers (`{marker: {holes}}`), never `Unknown`. A marker survives an otherwise decisive `False`. An urgency hole marks only `urgency`. A holed query, whole-contract or criterion hole, outputs `{marker, stagesRun: []}`; no evidence stage runs in this isolated execution (S1–S4 and the sibling criterion run only in `experimentalEvaluatePreviewQuery`). Unmarked outputs evaluate normally. `publication: 'Blocked'`, the compiler’s `markers` and the `inspectable` attributes are carried through, and the computed markers are cross-checked against the compiler’s static markers.

**Result.** `{outcome: 'Executed', mode, scope: 'program-expressions-with-supplied-query-results', packageId, outputs, findingAttributes, trace}`.

- `outputs` is keyed by declaration ID. A query output is `{evidence, origin: 'supplied'}`, or a marker.
- Each `trace` entry has `output` (`<id>`, or `<id>.status` / `<id>.urgency` for a Finding), the authored `source` field pointer, `result`, `because`, and `steps`. Each step records `source`, `form`, `result`, the outputs, holes or supplied results it `uses`, and `because`.
- Results are detached and deep-frozen, like compiler results. Later edits to the supplied map, the evidence objects or the source never change a completed result.

**GERD preview (PPL-04).** It needs no patient evidence. The outputs are:

- `applicability` is `Marker[H-SCOPE]`;
- `q.pd` is `Marker[H-EVIDENCE]`, with no stage run;
- `p.alarm` is `Marker[H-EVIDENCE]`;
- `f.alarm` status is `Marker[H-EVIDENCE, H-SCOPE]`, and its urgency is `Marker[H-URGENCY]`.

The label, heading and citation stay inspectable, and publication is blocked. No clinical question is answered.

## Running

```bash
npm install --prefix libs/pathway-language
npm run --prefix libs/pathway-language typecheck   # strict, noUncheckedIndexedAccess
npm run --prefix libs/pathway-language build       # tsc → dist/ (gitignored)
npm test --prefix libs/pathway-language            # independent tests + fixture runners (S1/S2/encounter/episode/assertionKind; I1 compile/preview)
```

This package has its own Jest configuration and is not part of the root Jest roots, which require the Docker test stack.

## Tests and fixture coverage

- **`src/__tests__/compile.test.ts`** has 64 independent I1 tests (counting each parameterized case). Programs are built in the test with their own identifiers, and expected codes and pointers are derived from contract §5. They cover:
  - every diagnostic code;
  - changed identifiers and declaration order, and forward references;
  - edge deduplication with every location kept, and no edges from citations or context bindings;
  - duplicate (declaration, reference and hole) and reserved identifiers, with no cascades;
  - undefined references, citations and value-set pins;
  - wrong operand and hole types;
  - missing applicability; missing or blank `explains`;
  - unknown properties, forms and kinds;
  - unknown and misplaced `ctx.` references, with no shape cascade;
  - non-hole urgency; overlapping and unsupported disjointness;
  - two-node and self cycles;
  - transitive marker propagation; attribute-only holes;
  - structural errors in a holed program;
  - a deep-frozen source;
  - (whole-criterion holes) each placement, both criteria included:
    - preview keeps the hole metadata and the complete sibling, and marks the query and its dependents;
    - normal compilation is blocked per hole;
    - complete queries are unchanged;
    - wrong, malformed and nested holes are rejected;
    - an invalid sibling or unrelated setting is still reported beside a hole;
    - disjointness is pending, and an overlap of two complete criteria is still rejected;
    - results are detached and frozen;
    - I2 preview execution marks the query.
  - EA-052a’s query as a regression input:
    - its hole uses the program hole syntax (`explains`, no `over`), after the fixture correction of 2026-10-29; EA-052b’s query is identical;
    - as written, it preview-compiles to the fixture’s markers, keeping `refutes`;
    - its two `criterion` facts are evaluated by preview evaluation (below), not by the compiler;
    - every S4–S5 entry point and normal execution reject its preview package.
  - EA-050’s query exactly as written (after its `explains` correction): preview gives a whole-contract hole with the fixture’s markers, and normal compilation reports only `UNRESOLVED_AUTHORING_HOLE`. Restoring the fixture’s old hole without `explains` fails 5 tests.

  Deliberate faults, each breaking tests:

  | Fault | Tests failing |
  |---|---|
  | A criterion hole accepted as a complete criterion | 9 |
  | The sibling validated without keeping its diagnostics | 3 |
  | Pending disjointness dropped | 5 |
  - (review of 3ecd664) editing the source after normal and preview compilation, deep-frozen results that throw on mutation, the identifiers `__proto__`, `constructor`, `toString` and `hasOwnProperty` through compilation and serialization, and the `c.assertion`-only restriction. These tests fail against the 3ecd664 compiler.

  Targeted mutation checks found no surviving mutation. Each of these breaks at least one test: urgency marking the status, no transitive marking, the wrong cycle pointer, holes compiling normally, no cross-enum check, no overlap check, and a misplaced `ctx.` being accepted.
- **`src/__tests__/execute.test.ts`** has 44 independent I2 tests over programs compiled in the test, all with **supplied** query results. These are isolated tests, not end-to-end runs. They cover:
  - projection of Known true, Known false and Unresolved;
  - ID and cause deduplication and ordering;
  - the full two-operand Kleene table, `all` with zero, one and three operands, and False with Unknown;
  - support, cause and candidate unions;
  - nondecisive operand traces;
  - repeated and transitive references;
  - multiple supplied results, and map- and ID-order invariance;
  - missing, unexpected, malformed and non-`Map` results;
  - package-kind rejection;
  - holes versus `Unknown`, and results supplied for holed queries;
  - markers beside a decisive `False`;
  - attribute-only holes;
  - the IDs `__proto__`, `constructor` and `toString`;
  - frozen inputs, post-execution edits and deep-frozen results.

  Review of 51609c5 added malformed arrays (an `undefined` cause, sparse causes, an `undefined` supporting ID, sparse supporting IDs, a `null` candidate ID), plus frozen fabricated packages, deep-frozen copies and relabelled packages in both directions. Five of these fail against the 51609c5 code.

  Targeted mutations each fail tests: False support taken from every operand, a decisive `False` dropping a marker, a missing result not reported, a holed-query result accepted, no ID deduplication, and operand traces hidden after a decisive `False`.
- **`src/__tests__/program-examples.test.ts`** runs the six [first-program examples](../../docs/superpowers/records/pathway-language/programs/README.md). It reports I1 compiler checks, I2 isolated program-expression checks and I2 preview-output checks separately:

  | Example | Compiler | Isolated program-expression | Preview-output |
  |---|---|---|---|
  | PPL-01 to -03 | 5 each | 6 each (applicability, predicate and finding outputs and traces), with the query evidence supplied from the example itself | — |
  | PPL-04 | 9 | — | 9 (every output and trace entry) |
  | PPL-05a/b | 6 each | — | — |

  Supplied query outputs and traces, `causeAttribution` (S1–S6) and evaluated `state` values are reported as outside scope. It applies each patch in the harness, which is input preparation and not a language feature, and checks **only** the `compile` and `preview` blocks. It also checks `state` where compilation alone decides it (`InvalidProgram`, `IncompleteAuthoring`); for compiled programs it only confirms the state is an evaluation state.
  - **PPL-01, -02, -03:** 5/5 checks each.
  - **PPL-04:** 9/9.
  - **PPL-05a, -05b:** 6/6 each.
  - No example is evaluated from raw records.
- **`src/__tests__/canonical-json.test.ts`** has 28 tests of the RFC 8785 library (above).
- **`src/__tests__/s1.test.ts`** has 99 independent tests (counting each parameterized case) whose expectations are derived by hand from the contract. They cover:
  - identical versus conflicting payloads, RFC 8785 number equality, absent versus `null`, and set-valued permissions;
  - authorized, unauthorized and undeterminable corrections;
  - subject changes, out-of-envelope targets, cross-local-ID corrections and undeterminable membership;
  - incomplete, malformed and absent references, self-supersession, cycles and valid chains;
  - forks with authorized, unauthorized and unknown-authority retractions;
  - conflict resolution, including one defect resolved while another stays active;
  - cases 85–87, plus extra combinations no fixture covers: an unknown-authority correction superseded by a valid later one, an undeterminable-membership correction that is then retracted, a retraction of a superseded revision, an absent retraction target, and conflicting or unattributable retractions;
  - input-permutation and duplicate-occurrence invariance, and input immutability;
  - the step 7 fork fallback (cases 88–92), and that a step 5 fork is not duplicated;
  - undeclared fields named `constructor`, `__proto__`, `toString` and `hasOwnProperty`, with scalar and object values, at the top level and nested, on revisions and retractions. Inputs are built with `JSON.parse`, so `__proto__` is an own property;
  - the retraction trace: a valid removal, every step 6 row, identical duplicates, conflicting variants (including variants that name different keys, in both input orders), absent and malformed targets, and permutation invariance;
  - a malformed value with a `toJSON` member received in two member orders (one variant, `Current`).
- **`src/__tests__/s2.test.ts`** has 46 independent S2 tests (counting each parameterized case), with expectations derived by hand from the contract. They cover:
  - a current revision inside the expansion, outside it in a covered system, and in an uncovered system;
  - malformed concepts and codes, absent concept components (alone and combined with malformed ones), and empty, whitespace-only (ASCII and Unicode) and surrounding-whitespace identifiers;
  - exact comparison, including that undeclared `display` members are ignored;
  - an authorized correction from an included to an excluded concept (only the current revision is classified), and the reverse;
  - unresolved histories with in- and out-of-domain possibilities, with only out-of-domain possibilities (case 33: not a candidate, `Invalid` kept), and with `unknown` or `excluded`;
  - digest-qualified variants under one `RevisionRef`, and `Retracted` and `NoRecord` keys;
  - inherited S1 causes kept with their attribution alongside new S2 causes, including `Invalid` from both stages;
  - permutation, duplicate-occurrence and S1 key-order invariance, and deep-frozen inputs;
  - configuration validation, including the identifier syntax for the expansion.
- **`src/__tests__/s3-encounter.test.ts`** has 47 independent tests of the encounter check (counting each parameterized case), with expectations derived by hand from contract §§1.2, 1.6, 2.2 and 2.4. They cover:
  - matching, different (case-sensitive, untrimmed) and absent encounters;
  - malformed encounters (number, `null`, object, empty, ASCII and Unicode whitespace-only, line terminators);
  - one snapshot: an old S2 cannot be supplied with an S1 changed by a correction, a retraction, a replaced payload or a new payload variant. Each time the check reads the current S1 (the reviewer’s reproduction is the correction case);
  - an unresolved evaluation encounter with its causes kept, including against a known record encounter;
  - record and context problems together;
  - unresolved history with one matching and one nonmatching possibility;
  - variants with different encounters;
  - unresolved S2 candidacy alongside a decidable check;
  - out-of-domain `NotEvaluated`, with no `Missing` even when the encounter is absent;
  - `excluded` and `unknown`;
  - an authorized correction to another encounter;
  - `Retracted` and `NoRecord`;
  - permutation, duplicate and S1 key-order invariance, and deep-frozen inputs;
  - that the rule equals the pinned query’s `admissible.encounter`;
  - 15 rule and configuration errors (including an empty or whitespace-only known evaluation encounter and a precomputed `s2`), plus 2 S2 parameter errors, distinguished from a malformed record encounter.
- **`src/__tests__/s3-episode.test.ts`** has 58 independent tests of the episode check (counting each parameterized case), with expectations derived by hand from contract §§1.2, 1.6, 2, 2.2 and 2.5. They cover:
  - matching and different episodes, exact comparison, and no inference from the encounter field;
  - absent and malformed record episodes (`null`, number, boolean, object, array, empty, ASCII and Unicode whitespace-only, line terminators);
  - an unknown evaluation episode, alone and with several causes in either order, including against a known different record episode;
  - record and context problems together;
  - blank record episodes against known and unknown contexts (cases 113a/b), and a blank episode on an out-of-domain possibility (not evaluated);
  - unresolved correction history with one matching and one nonmatching alternative, and with two undecidable alternatives;
  - authorized corrections out of and into the episode;
  - variants with different episodes, `excluded` and `unknown`, unresolved S2 candidacy, out-of-domain `NotEvaluated`, and `Retracted` and `NoRecord` keys;
  - one snapshot: a precomputed S2 and an extra stage result are rejected;
  - permutation, duplicate and S1 key-order invariance, deep-frozen inputs, detachment from later edits to the S1 result and context binding, and a deep-frozen result;
  - 20 configuration errors (including empty and whitespace-only known episodes), 2 S2 parameter errors, and a malformed record episode distinguished from a configuration error.

  Targeted mutations each fail tests: a blank record episode compared as a string, a blank `known` accepted, `null` treated as absent, an absent episode as a mismatch, an unknown context deciding a mismatch, trimming, an undetached result, sparse cause lists accepted, and input-order context causes.
- **`src/__tests__/s3-assertion-kind.test.ts`** has 54 independent tests of the `assertionKind` check (counting each parameterized case), with expectations derived by hand from contract §§1.2, 1.7, 2, 2.2 and 2.6. Allowed sets are built in each test. They cover:
  - each recognized kind when included, a recognized kind excluded, and the same record under different authored sets;
  - absent, and 13 malformed or unrecognized values (`null`, number, boolean, object, array, empty, whitespace, two case variants, two whitespace variants, an unrecognized string, a code from another enum), each against three authored sets, so none can become `AssertionKindNotAllowed`;
  - an empty authored set, a repeated code, and agreement with the compiler on both;
  - authorized corrections that change the kind, unresolved history with matching and nonmatching alternatives and with absent and malformed alternatives, variants, unresolved S2 candidacy, out of domain, `excluded`, `unknown`, `Retracted` and `NoRecord`;
  - one snapshot, permutation, duplicate, S1 key-order and authored-set-order invariance, deep-frozen inputs, detachment and a deep-frozen result;
  - 19 configuration errors, including `undefined` elements and sparse arrays, 2 S2 parameter errors, and a malformed record kind distinguished from a configuration error.

  Targeted mutations each fail tests: every kind allowed, allowed and disallowed swapped, absent treated as not allowed (missing versus false), an unrecognized string treated as a disallowed kind (recognized-but-disallowed versus malformed), trimming, unchecked rule elements, skipped holes and `undefined` elements, and an undetached result.
- **`src/__tests__/s3-admissibility.test.ts`** has 60 independent tests of the combined result (counting each parameterized case). Every expected outcome, reason list and finding list is written out by hand. They cover:
  - all 27 combinations of `Matches`/`DoesNotMatch`/`Unresolved` across the three rules, each checking the combined result, its reasons and findings, every individual outcome (with mismatch identifiers) and the causes;
  - multiple mismatch reasons, multiple unresolved causes and origins (record and context), and a mismatch beside malformed and missing evidence and beside an unknown context;
  - possibilities with different outcomes, a case where each rule fails on a different revision (no cross-possibility join), variants, an authorized correction changing admissibility, and an unresolved history that stays unresolved beside an admissible possibility;
  - unresolved S2 candidacy, out of domain (never `Inadmissible`, even when every rule would mismatch), `excluded`, `unknown`, `Retracted` and `NoRecord`;
  - 17 configuration errors that throw even when every rule would mismatch, each with the right error class;
  - stale S2 and stale rule results rejected, permutation, duplicate, key-order and rule-order invariance, deep-frozen inputs, detachment and a deep-frozen result.

  Targeted mutations each fail tests: mismatch plus unresolved treated as unresolved, unresolved findings dropped under a mismatch, rules joined across possibilities, an admissible possibility clearing unresolved history, and findings left in evaluation order. Combining an out-of-domain possibility is prevented by the types, as it has no rule outcomes.
- **`src/__tests__/s4-select.test.ts`** has 22 independent S4 tests (counting each parameterized case). Every expected status, `unresolvedBy` and blocker list is taken from contract §2.8. They cover:
  - each current-revision row of the key table, including an inadmissible revision beside an unresolved rule and the confirmed candidacy-plus-inadmissible rule;
  - `Retracted` and `NoRecord`;
  - preservation of every S3 reason, finding and origin, and of S2 findings;
  - unresolved history with an admissible and an inadmissible alternative, with every alternative inadmissible, with every alternative out of domain, with variants, and with `excluded` and `unknown`;
  - an authorized correction resolving history;
  - summary lists, permutation, duplicate and key-order invariance;
  - rejection of anything but a combined S3 result produced in this process (structural and frozen copies, S1 and S2 results, extra fields);
  - immutability, detachment and deep freezing.

  Targeted mutations each fail tests:
  - one admissible possibility selecting the key (premature selection);
  - all-inadmissible history resolved, or the history blocker dropped (lost uncertainty);
  - inadmissibility taking precedence over unresolved candidacy;
  - one possibility’s blockers reused for the others (cross-revision mixing).

  The fixture run also catches the precedence flip (EA-125).
- **`src/__tests__/s4-handoff.test.ts`** has 14 tests of the evidence handoff, using the internal accessors directly, with no criterion evaluation. They cover:
  - two snapshots with the same identity, `Affirmed` and `Denied`: equal selections, each retrieving its own assertion. This holds even when the stages are interleaved (S3 of both snapshots before S4 of the first), and resolving the second snapshot leaves the first unchanged;
  - possibilities read through another result, JSON copies, spreads, fabricated objects and relabelled owners, all rejected;
  - separate S3 and S4 bindings;
  - variants each retrieving the payload of their own digest;
  - an authorized correction supplying the current payload;
  - unresolved-history alternatives with separate payloads and nothing selected;
  - inadmissible possibilities readable but not selected;
  - no payload for `excluded`, `unknown` or out-of-domain possibilities;
  - edits to original records and to the S1 result not reaching retained evidence;
  - deep-frozen payloads, and unchanged serialized output.

  Deliberate faults each fail a test: a global record-ID lookup (wrong snapshot, caught by the interleaved case), the first variant used for every digest (wrong variant), and an invented out-of-domain payload. The existing S4 tests and fixture expectations are unchanged.
- **`src/__tests__/s5-criteria.test.ts`** has 41 independent tests of per-record criterion evaluation (counting each parameterized case). Expected values and traces are written from contract §3.4–§3.5, never by calling the evaluator. They cover:
  - `Affirmed`, `Denied` and `Indeterminate` (one full result and trace); absent; `null`, number, boolean, object, array, undeclared, differently cased, padded and empty values;
  - swapped criteria and an `Indeterminate` literal (each criterion reads its own literal; the two are independent);
  - `all`/`any`/`not` in criterion position rejected by the compiler, so they never reach S5;
  - digest-qualified variants (expected values from S1’s own canonical payloads), a corrected key, and two snapshots with identical IDs, interleaved;
  - unresolved history, admissibility and candidacy evaluated with the S4 result unchanged; inadmissible (also beside unresolved candidacy, and as an alternative of unresolved history), out-of-domain and marker possibilities `NotEvaluated`;
  - preview, copied and spread packages; a non-query ID; extra `payload`/`snapshot` fields; copied S4 results; copied, foreign and fabricated possibilities;
  - the query binding: the same-pin, different-admissibility counterexample rejected; the bound query evaluating its own evidence; the second query’s own selection making the record `Inadmissible`; packages with the same `packageId` (and an identical recompilation) and two queries of one package unable to exchange results; caller-supplied value set, expansion, rules, envelope, sources, record type, authority rule, S1 or S3 rejected; records outside the query’s sources or subject acquiring no binding; an S4 result of the standalone stages over a foreign S1 rejected; interleaved evaluations under two packages keeping both their ownership and their payloads; copies, fabrications and standalone results rejected;
  - deep-frozen, detached output and repeatable trace order.

  Deliberate faults each fail at least one test: absent evidence evaluated as `False`; the first variant of a key used for every possibility (wrong variant); a payload cache keyed by record identity (wrong snapshot, caught by the interleaved case); `refutes` set to `True` whenever `establishes` is `False`; and inadmissible possibilities evaluated. The first four also fail fixture checks. Restoring the old value-set-pin-only check fails six binding tests, the counterexample included; checking the package but not the query ID fails the two-queries test.
- **`src/__tests__/s5-classify.test.ts`** has 29 independent tests of per-record classification (counting each parameterized case). Expected classes are written from the §3.3 table. They cover `Affirmed`/`Denied`/`Indeterminate` → `Supporting`/`Refuting`/`NonInformative`; absent and eight malformed values → `Unclassified` with the `Missing`/`Invalid` findings kept in both criteria; swapped criteria and an `Indeterminate` literal (classes follow the authored expressions); the compiler rejecting overlapping criteria; the five unreachable rows on the internal table function; unresolved-history alternatives and digest-qualified variants classified on their own payloads and staying `NotSelected`; unresolved admissibility and candidacy; inadmissible (also beside unresolved candidacy), out-of-domain and marker possibilities with no class; foreign packages, queries, possibilities and unbound selections rejected; caller-supplied criterion results rejected; interleaved snapshots with identical IDs; immutability and determinism.

  Deliberate faults each fail at least one test: `Unknown` treated as `False` (17 tests, and three fixture checks); `establishes = False` treated as `Refuting` (5, and two fixture checks); a `Supporting` alternative made `Selected` (2); `NotEvaluated` given `NonInformative` (1).
- **`src/__tests__/s5-possible-classes.test.ts`** has 26 independent tests of key-level possible classes (counting each parameterized case), with expected sets and bases written from the §3.7 table. They cover selected `Supporting`/`Refuting`/`NonInformative` records; absent and malformed assertions (`Unclassified` → every assertion class, no `excluded`); `Affirmed`/`Denied` alternatives under unresolved history; two alternatives with the same class (deduplicated, both explained, key still `Unresolved`, nothing selected); digest-qualified variants with different classes; an admissible alternative beside an inadmissible variant; all alternatives inadmissible or out of domain; unresolved candidacy, unresolved admissibility, both, and `Unclassified` with unresolved admissibility; unresolved candidacy beside a definite mismatch; inadmissible and out-of-domain current revisions; `excluded` and `unknown` markers; `Retracted` and `NoRecord` keys; input permutation; identical key IDs in two snapshots; foreign packages and queries, copied and unbound selections and foreign or copied keys, each for a key with a possibility, an empty key and an all-excluded key; caller-supplied classes and evidence; complete attribution (each entry equals S4’s possibility and the classifier’s result; S1, S3 and S5 causes kept apart) and immutability.

  Deliberate faults each fail tests: `Unclassified` contributing only `NonInformative` (4 tests, 1 fixture check); only the last alternative counting, which loses a `Refuting` alternative (14, 9); no deduplication (8, 3); `excluded` added for unresolved history (12, 6); `excluded` omitted for unresolved candidacy or admissibility (7, 3); a singleton set marking an unresolved key `Selected` (2).
- **`src/__tests__/preview-evaluate.test.ts`** has 26 independent tests of query-bound preview evaluation, with expected values written from the contract tables and the fixtures. They cover:
  - EA-052a, EA-052b and EA-050 exactly as written: `establishes` `Marker` and `refutes` True with its trace for s1/r2@1; an empty snapshot keeping the hole and inventing no record; a whole-contract hole running no stage although a record is present;
  - each placement: `establishes` holed, `refutes` holed, both holed;
  - the complete sibling giving `True`, `False` and `Unknown`, with `Missing` (absent) and `Invalid` (malformed, including `null`) findings kept apart, while the hole stays a `Marker` with no finding or trace;
  - inadmissible (also beside unresolved candidacy), out-of-domain, `excluded` and `unknown` possibilities getting no slot value while the query marker stays;
  - history, candidacy and admissibility uncertainty with dispositions unchanged; digest-qualified variants and interleaved snapshots with identical record IDs, each read from its own payload; an authorized correction;
  - S4 facts equal to `experimentalSelectForQuery` over a complete twin query;
  - no classification, possible classes, evidence, materiality or Need field anywhere; `Pending` disjointness and the package contract unchanged;
  - the normal entry points still rejecting preview packages; compiled, copied, spread and null packages; missing, non-query and foreign query IDs; a complete query inside a preview package; twelve override fields; copied output possibilities rejected by S5;
  - detached, deep-frozen output unaffected by later input or source edits; determinism.

  Deliberate faults, each applied alone (failures across this file and the fixture runner):

  | Fault | Tests failing |
  |---|---|
  | A hole reported as patient `Unknown{Missing}` | 11 |
  | A hole reported as `False` | 11 |
  | The complete sibling skipped because the other criterion is a hole | 10 |
  | The query marker and hole slot dropped for an empty snapshot | 3 |
  | Payloads looked up by record ID within one evaluation (wrong variant) | 1 |
  | Payloads looked up by record ID across evaluations (wrong snapshot) | 5 |
  | A whole-contract hole running evidence stages | 3 |
- **`src/__tests__/s6-gaps.test.ts`** has 39 independent tests of gap relevance, with expected values written from the §1.5 and §4.1 tables. They cover:
  - Complete coverage with no failure (no gap); same-scope `Incomplete`, `Unknown` and `Absent` cells; absent detection with no statement and with statements for other cells; insufficiently scoped and contradictory statements; malformed statements (never dropped or read as `Complete`); not-current statements; the missing-target attestation (case 26);
  - a failure despite `Complete` coverage; record type, subject and disjoint sources each proving irrelevance; partial source overlap; unstated and `null` dimensions; several dimensions; value set, episode and encounter never proving; malformed dimensions and members;
  - stated rejected items with definite and undetermined boundaries; S1 unattributable retractions (`Missing`, `Invalid`) and unidentified occurrences; S1 boundary rejections and history defects not being gaps;
  - simultaneous gaps and failures, input permutation, identical duplicates and same-ID conflicts;
  - foreign packages, queries and selections, standalone and copied selections, selections without a snapshot, twelve forbidden fields, structural snapshot errors, preview packages and preview evaluation rejecting `snapshot`; the snapshot not changing selection; interleaved evaluations; the subject taken from the evaluation;
  - no evidence, base result, materiality, Need or cause attribution field; immutability after input edits; deep freezing;
  - (review of 8e6c46f) sparse source arrays and lists, extra array members, accessors, non-plain objects, `undefined`, NaN, symbol keys and lone surrogates rejected at selection; `[]` beside another statement with the same `id` decided the same in either order; a failure named `cell:s1` distinct from the s1 cell; unique keys across gaps and statements, with relevant and irrelevant disjoint; same-`id` conflicts with digest identities; unrecognized members (in a statement or in `appliesTo`) making it malformed;
  - (review of 3e0f967) self, indirect and list-level cycles rejected with their path, and objects shared across branches accepted.

  Deliberate faults, each applied alone (failures across this file and the fixture runner):

  | Fault | Tests failing |
  |---|---|
  | Absent coverage treated as `Complete` | 8 |
  | An unstated dimension proving irrelevance | 19 |
  | A value set, episode or encounter mismatch proving irrelevance | 3 |
  | Every failure placed in the relevant set | 11 |
  | Only the first current failure kept | 5 |
  | Only the first non-`Complete` cell kept | 6 |
  | No JSON validation at selection (the 8e6c46f behaviour for sparse arrays) | 2 |
  | Gap key equal to its display label | 2 |
  | Unrecognized members ignored | 1 |
  | No cycle detection (stack overflow instead of a configuration error) | 1 |
  | A global visited set instead of the ancestor chain (rejects shared objects) | 1 |
- **`src/__tests__/fixtures.test.ts`** runs the committed [explicit-assertion-v0 fixtures](../../docs/superpowers/records/pathway-language/conformance/explicit-assertion-v0/README.md) and checks **only** their S1–S4 assertions, S5 `criterion`, `classification` and `possibleClasses` assertions, the preview expectations of preview fixtures, and S6 coverage-cell and gap-relevance facts, plus one-way implications from downstream expectations. It never reports a fixture as passing as a whole, because S6–S7 are not implemented. On the current fixtures it reports:
  - **180 S1 assertions checked, 180 passing.** That is 92 trace facts (`keyResult`, `variants`, `occurrences`, `rejected`, `outOfEnvelope`, `outsideEnvelope`, and the `HistoricalDefect`, `CrossKeyCorrection` and `UndeclaredField` diagnostics) plus 75 canonicalization checks (bytes, digests, variant partition, undeclared fields). EA-104 adds two; EA-123 and EA-124 add three; EA-126 to EA-129 add five; EA-132, EA-133, EA-134, EA-135 and EA-136 add one each.
  - **16 S2 assertions checked, 16 passing:** every `candidacy` trace fact (EA-013, EA-014, EA-024, three in EA-033, and EA-093 to EA-100).
  - **15 encounter-check assertions checked, 15 passing:** every `encounterScope` trace fact (EA-101 to EA-103, both variants of EA-104, EA-105, EA-106a/b, EA-107, EA-112, EA-115a and EA-119 to EA-122).
  - **13 episode-check assertions checked, 13 passing:** every `episodeScope` trace fact (EA-108 to EA-110, EA-111a/b, EA-112, EA-113a/b, EA-115a and EA-119 to EA-122).
  - **13 `assertionKind`-check assertions checked, 13 passing:** every `assertionKindScope` trace fact (EA-114, EA-115a/b, EA-116, EA-117, EA-118a–d and EA-119 to EA-122). EA-115a/b use an inline query with another authored set (digest `d-ak1`).
  - **37 combined S3 assertions checked, 37 passing:** every `admissibility` trace fact (contract §2.7): 28 in evaluation and preview fixtures written before §2.7, which agree with it, 8 in the partial-stage fixtures EA-119 to EA-124, and 1 in EA-125. Value, the complete set of mismatch reasons, and retained causes are compared.
  - **74 S4 assertions checked, 74 passing:** every `selection` and `disposition` trace fact, all in the partial-stage fixtures EA-125 to EA-134 (contract §2.8); EA-130 to EA-132 add 21, EA-133 and EA-134 13 each.
  - **22 S5 criterion assertions checked, 22 passing:** every `criterion` trace fact of a complete query, all in the partial-stage fixtures EA-130 to EA-132 (contract §3.5), with value and, for `Unknown`, causes. The fixture query is wrapped in a minimal program and compiled by `experimentalCompile`, and criteria are evaluated over `experimentalSelectForQuery`’s bound result, which the runner also requires to equal the standalone S1–S4 result for the same fixture. Preview `criterion` facts are counted separately below.
  - **2 preview criterion assertions evaluated, 2 passing:** EA-052a’s two `criterion` facts (`establishes` `Marker`, `refutes` True for s1/r2@1), checked directly against `experimentalEvaluatePreviewQuery` over the fixture query exactly as written, preview-compiled in a minimal program. A `Marker` must also name one of the query’s holes.
  - **18 preview compiler, marker and publication checks, 18 passing,** for EA-050, EA-052a and EA-052b (six each): `outcome: PreviewOnly` (preview compiles and normal compilation reports only holes), `markers` (equal to the compiler’s, with the query’s own marker in the evaluation result), `publication: Blocked` (package and result), `evidence: null` and empty `needs` (the result has no evidence or Needs field at all), and the `stagesRun` fact (`[]` for EA-050, S1–S5 for EA-052a/b). These check compilation and the absence of clinical outputs, not evidence semantics.
  - **10 S5 classification assertions checked, 10 passing:** every `classification` trace fact, checked directly with `experimentalClassifyRecord` over the bound result (contract §3.3, §3.6): `Unclassified` in EA-004 and EA-074 and `NonInformative` in EA-006 (evaluation fixtures, written before §3.6), and seven in the partial-stage fixture EA-133 (`Supporting`, `Refuting`, `NonInformative`, `Unclassified{Missing}`, `Unclassified{Invalid}`, and the two variants of an unresolved key). `possibleClasses` facts are not checked.
  - **18 S5 `possibleClasses` assertions checked, 18 passing:** every `possibleClasses` trace fact, checked directly with `experimentalPossibleClasses` over the bound result (contract §4.2 step B, §3.7). Twelve are in evaluation fixtures written before §3.7, unchanged: EA-004 (`Unclassified`), EA-010 and EA-011 (unresolved admissibility), EA-018, EA-030, EA-078, EA-084 and EA-088 (alternatives), EA-028 and EA-104 (an inadmissible alternative) and EA-062 and EA-085 (an `excluded` marker). Six are in the partial-stage fixture EA-134: unresolved candidacy, unresolved candidacy beside a mismatch, an `unknown` marker, deduplication, all alternatives excluded, and a retracted key. Materiality is not checked.

  Trace `causes` are compared as sets in Stage A order, for every check. EA-119 to EA-124 (S1–S3), EA-125 to EA-129 (S1–S4) and EA-130 to EA-134 (S1–S5: `criterion`, `classification`, `possibleClasses`) and EA-135 to EA-136 (S1–S6, gap relevance only: `cell`, `gap`, `notCurrent`) are `stage-v1` fixtures: they state no downstream result, and their assertions are partial-stage checks, not end-to-end conformance.
  - **One-way checks**, which can fail but cannot prove completeness:
    - 33 S1-stage cause attributions, each of which must be an active S1 defect;
    - 12 S2-stage cause attributions (EA-013, EA-014, EA-093 to EA-099), each of which must be an S2 finding on that revision;
    - 33 `supportingEvidenceIds` entries of `Known` results, each of which must be a revision S4 selected (contract §4.2 rules 2–3). None of the existing fixtures conflicts with §2.8;
    - 117 `candidateEvidenceIds` entries, each of which must have S2 candidacy `InDomain` or `Unresolved` (contract §5.1). The field is an S6 output, and its converse is not checked;
    - 16 encounter outcomes implied by combined S3 expectations (also EA-123, EA-124). `admissibility: Admissible` implies `Matches` (EA-052a, EA-114, EA-115b). `Inadmissible` with reason `OtherEncounter` implies `DoesNotMatch` (EA-009, EA-025, EA-107). An S3 attribution with an encounter reason must be a finding of the check (EA-010, EA-015, EA-101 to EA-103, EA-105, EA-106a/b).
    - 17 episode outcomes implied by combined S3 expectations (also EA-123, EA-124). `admissibility: Admissible` implies `Matches` (EA-052a, EA-114, EA-115b). `Inadmissible(OtherEpisode)` implies `DoesNotMatch` (EA-112). An S3 attribution with an episode reason must be a finding of the check (EA-012, EA-108 to EA-110, EA-111a/b, EA-113a/b).
    - 12 `assertionKind` outcomes implied by combined S3 expectations (also EA-123, EA-124). `admissibility: Admissible` implies `Matches` (EA-052a, EA-114, EA-115b). `Inadmissible(AssertionKindNotAllowed)` implies `DoesNotMatch` (EA-115a). An S3 attribution with an `assertionKind` reason must be a finding of the check (EA-116, EA-117, EA-118a–d).

    The absence of an attribution proves nothing, because attribution also depends on S5/S6 materiality.
  - **31 S6 coverage-state assertions checked, 31 passing:** every `cell` (21) and `notCurrent` (3) fact and every `ContradictoryAttestation` (6) and `InsufficientlyScopedStatement` (1) diagnostic, from `experimentalGapRelevance` over the bound selection with the fixture’s own snapshot statements. Evaluation fixtures EA-005, EA-015, EA-026, EA-035 to EA-041, EA-043 and EA-044, unchanged, and partial-stage EA-135 and EA-136.
  - **20 S6 gap-relevance assertions checked, 20 passing:** every `gap` fact, with `relevant` and, when stated, `provenBy`: EA-008, EA-041, EA-042, EA-045 to EA-049, EA-053, EA-055a/b (unchanged) and nine in EA-135 and EA-136 (stated rejected items, an unattributable retraction, simultaneous failures).
  - **48 one-way gap checks:** each of the 16 `coverage`/`gap` cause attributions must be a relevant gap with that cause and reason, and each of the 32 `Known` results must have no relevant gap. These do not check base results or attribution itself.
  - **517 expected fields and trace facts outside the implemented scope,** not checked: evidence, decision, Needs, `rule`, materiality, cause attribution beyond the one-way checks, and so on.
  - **2 fixtures not run:** EA-051a/b (compilation).
  - Every other fixture has at least one applicable assertion.

  None of this is end-to-end evidence conformance: no `Evidence<Boolean>`, Need or decision is computed or compared.

## Interpretations where the contract is silent

These are implementation choices for review. None changes a fixture expectation.

1. **Envelope membership of a key.** A key is in the envelope if any of its occurrences *could* belong: record type and subject each either match or are absent or malformed. A key whose every occurrence definitely mismatches is listed in `outsideEnvelope`.
2. **Edge from an undeterminable-membership revision** (step 2, “treated as undeterminable”):
   - The identity rows apply first: an incomplete or malformed reference, or a cross-key reference.
   - Then the structural facts apply: self-reference, or an absent target (`unknown`).
   - Otherwise the edge is an undeterminable correction edge under step 7. It inherits the membership defect’s cause and reason, so a later retraction of the source does not clear its supersession uncertainty.
3. **A conflicted revision’s variant with undeterminable membership** is a possible content and also adds `excluded`.
4. **Authority input shapes.** An absent `author` is `Missing`. An `author` that is not an object is `Invalid`. A `supersedes` of `null` or a non-object is a malformed reference.
5. **Rejection reason when both subject and record type differ:** `SubjectChanged`.
6. **A retraction whose target key is not in the envelope** is listed in `outsideEnvelope` (“traced only”).

## S2 input rules

Review of 4608f95 settled the three interpretations it listed. They are now specified in contract §2.3 (still a proposed draft), with fixtures EA-093 to EA-100:

1. An absent `concept`, `concept.system` or `concept.code` is `Missing`, with reason `FieldAbsent:<path>`. A present malformed component is `Invalid` (`CodeMalformed`). Findings from different components accumulate.
2. Identifier syntax for the fictional model is as above: nonempty, not whitespace-only, never normalized. Before this, `{system: "demo-cs", code: ""}` was classified `OutOfDomain`, with no candidate and no cause. That treated an empty code as established nonmembership. EA-098a/b and EA-099a/b fail against the earlier code.
3. The expansion is bound by the same syntax and raises `S2ConfigurationError` when it violates it. There is no fixture for this, because the fixture format has no configuration-failure kind; the independent tests cover it.

Remaining notes:

- `KeyCandidacy.causes` is a union, not an S6 result. Under contract §4.2 step C, only a material record’s origin causes are attributed.
- Production code-system syntax is out of scope.

## Encounter check: settled and deferred decisions

Review of b8eb6fe settled these:

1. **EncounterRef syntax** (contract §2.4, cases 105–107): nonempty, not whitespace-only, never trimmed. On a record a violation is `Invalid`; in a known evaluation encounter it is a configuration error. Before this, `encounter: ""` against `Known(N1)` was `DoesNotMatch`. EA-105 and EA-106a/b fail against the earlier rule.
2. **Accumulating record and context findings** within the rule is confirmed.
3. **One snapshot** (contract §2): enforced by the boundary above.

**Since settled:** how several admissibility rules combine, including one rule’s mismatch beside another’s unresolved outcome (contract §2.7; “combined admissibility” above).

## Fork fallback (contract §2.1 step 7)

Step 5 records a fork only when no other defect exists. If that other defect later becomes historical, several heads can remain with no active defect. Example: `s1/r1@1` has two payloads, and the authorized `@2a` and `@2b` both supersede it. Step 7 then records a fork over the remaining heads, with cause `Conflicting` (cases 88–92). The fallback applies only when no defect is active. It is not a general test of whether an active defect “explains” the heads.

## I1 compiler: interpretations where the contract is silent

Each item below is an implementation choice, not an accepted semantic. None changes an example expectation. Review of 3ecd664 accepted items 1, 2 and 4.

Two former items are now settled in the contract:

- `UNDEFINED_REFERENCE` also covers undeclared catalogue fields and enum values (§5).
- Criteria are restricted to `c.assertion` (§2).

1. **A structural failure omits hole diagnostics.** When any structural diagnostic exists, both modes return the same structural diagnostics only, matching the examples’ `sameDiagnostics` rule. The contract does not say whether `UNRESOLVED_AUTHORING_HOLE` should also be listed when holes coexist with a structural error. Smallest counterexample: the GERD program with one `ref` renamed to a missing ID.
2. **Identifier namespaces.** Declaration and EvidenceReference IDs share one namespace; hole IDs have their own, and must also be unique. A duplicate is reported at every occurrence, with `INVALID_DECLARATION_ID` also used for duplicate hole IDs.
3. **“Allowed position”** for an expression form means anywhere in that field’s expression tree. Holes are accepted only as the whole field.
4. **“Smallest JSON Pointer”** for a cycle is compared by Unicode code point.
5. **Declarations with an invalid kind** keep their ID, so references to them add no `UNDEFINED_REFERENCE`.
6. **Citation shapes.** `lines` is a `[first, last]` range, and `quote` keys must fall inside it. Files, digests and quotations are not read.

## I2: decisions (review of 51609c5)

1. **Finding trace naming.** A Finding’s status trace entry is `<id>.status`, and an attribute’s is `<id>.<attribute>`, following the compiler’s marker convention. PPL-01 to PPL-03 now say `f.demo.status`, and the runner asserts those entries like any other.
2. **Known with empty support** is accepted by this isolated typed-result executor. Accepting it does not establish that the evidence-query policy could legitimately produce such a result; under explicit-assertion-v0, S6 never does.
3. **Evidence-ID notation** is this boundary’s supported representation: `source/localId@revision[#64-hex digest]`, with no `/`, `@` or `#` inside a component. It exists so IDs can be ordered by the contract §5.3 tuple. It is not a new restriction on record identities.

## Limitations

- **I2 executes program expressions only, over supplied query results.** It computes no query result (S1–S6), reads no records, evaluates no coverage, and generates no Needs, acquisitions, recommendations or urgency behavior.

- **I1 compiles; I2 executes program expressions only.** No stable serialized IR, manifest, signing or persistence exists. The compiler supports only the first-program subset and one fictional evidence model.

- Evidence stages: S1, S2, S3 (three rules and their per-revision combination), S4 selection, per-record S5 criterion values and classification, and key-level possible classes. There is no materiality, base-cause, resolution, Needs or coverage evaluation (S6). S5 evaluates only S4 results of query-bound selection for the same compiled package and query (contract §3.5); query-bound selection runs S1–S4 for one query and stops there, so it is not end-to-end evaluation. The S4–S6 consequence of a revision that is `Inadmissible` beside an unresolved rule is unspecified; fixtures EA-119 to EA-124 are partial-stage for that reason.
- The encounter and episode checks each recognize exactly one authored rule shape, and the `assertionKind` check one shape (`in` over pinned codes). They do not evaluate expressions.
- S2 supports only the fixtures’ flat expansion format: no hierarchies, intensional definitions, terminology service, normalization, code-system conversion or version resolution.
- The fixtures assert S2 candidacy for 16 revisions. Variants, `excluded`/`unknown` propagation and configuration errors are covered by the independent tests only.
- One schematic authority rule and one fictional evidence model (`demo-model@0.1`). No clinical definitions.
- The fixtures assert S1 results only for some keys of some fixtures (see coverage above). No fixture asserts the retraction trace; it is covered by the independent tests only.
- **Asymmetry left by the concrete fallback.** With retraction authority missing on one of two heads, a fork recorded at step 5 stays active (EA-083: `Missing`, `Conflicting`). If the fork was suppressed by a now-historical conflict, only `Missing` remains (EA-092), because the fallback requires that no defect be active. Both results are unresolved with the same possible currents. Whether EA-092 should also be `Conflicting` would require a general rule for whether a defect explains multiple heads. That rule is deliberately not defined here. This is a known limitation of the narrow fallback, not an implementation error (review, 2026-10-05). Cause completeness must be revisited before building any behavior driven by causes, such as acquisition or conflict resolution.
