# @prism/pathway-language (experimental, nonclinical)

**Status:** an implementation experiment. It covers **two stages and one rule** of the *proposed* [evidence-query-to-predicate contract](../../docs/superpowers/records/pathway-language/evidence-query-to-predicate-contract.md): S1 revision history, S2 candidate identification, and the S3 same-encounter rule on its own. It also has the **first PPL compiler subset** (increment I1 of the [first-program implementation contract](../../docs/superpowers/records/pathway-language/first-program-implementation-contract.md)). It is not the PPL evaluator and is not clinically approved; compiling a program confers no clinical approval. It must not be used for patient care. The RFC, Stage A, the contract and the delivery plans keep their existing statuses; nothing here completes a delivery story.

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

**Package** (`src/compile/types.ts`). `CompiledPackage` and `PreviewPackage` share `CompiledProgram`, with different `kind` tags, so later code cannot mistake a preview for an executable package. `CompiledProgram` holds:

- `packageId` and the language and profile versions;
- `applicabilityId`;
- `declarations`: validated, in a deterministic topological order (dependencies first, ties by identifier);
- `references`: citation shapes only;
- `valueSets`: validated with S2’s own `expansionProblem`;
- `dependencyEdges`: `{reader, read, locations}`, deduplicated, with every authoring `ref` pointer kept;
- `holes`: `{id, type, explains, cites, location}`.

Each declaration keeps its source JSON Pointer:

- **Predicate** (with `applicability: true` for the top-level one): `expr`, a tree of `ref`, `evidenceValue`, `all` and `hole`, each node with its location.
- **EvidenceQuery**: `contract` is either a hole or a validated `explicit-assertion-v0` contract. That contract has the record type, sources, value set, authority rule, the recognized admissible rules, `establishes`/`refutes` as `{field, enumType, value}`, and a frozen copy of the authored contract (`source`) for S1–S3 reuse.
- **Finding**: `status`, `label`, `heading`, an `urgency` hole and `cites`.

`PreviewPackage` adds `markers` and the inspectable Finding attributes `<id>.label`, `<id>.heading` and `<id>.cites`.

**Supported subset.**

- Declarations: `EvidenceReference`, the required applicability `Predicate`, `EvidenceQuery`, `Predicate` and `Finding`.
- Program expressions: `ref` (declarations only), `evidenceValue` (in Predicate expressions), n-ary `all` (`all()` is True and is never a default), and typed holes. Holes are allowed only as a whole applicability expression (`Decision`), a whole query contract (`EvidenceSelectionContract<Boolean>`) or a Finding `urgency` (`UrgencyRequirement`).
- Query contracts: exactly the explicit-assertion-v0 structure:
  - `demo-model@0.1` records, authority `demo-policy/same-source-amend@1`;
  - `admissible` episode and encounter recognized by exact shape, with `ctx.episode` / `ctx.encounter` only at those two positions;
  - `assertionKind` as `in` over `AssertionKind`;
  - criteria `eq(c.<enum field>, <Enum>.<value>)`, type-checked;
  - `disjoint(establishes, refutes)`, proved for equalities on one field. Equal literals give `EXCLUSIVE_BRANCH_OVERLAP`; anything else gives `UNSUPPORTED_PROOF_FRAGMENT`.
- Everything else is rejected with a named code (`UNSUPPORTED_CONSTRUCT`, `UNKNOWN_EXECUTABLE_PROPERTY`, …). There is no general expression evaluator or theorem prover.

**Preview markers** (§7). An output is marked if and only if it contains a hole or references a marked output; its marker is the union of the contributing hole IDs. Output names:

- `<id>` for applicability, Predicate and EvidenceQuery;
- `<id>.status` for a Finding;
- `<id>.urgency` for an urgency hole, which marks only that attribute and never the status.

Markers are computed statically from references, so no Boolean simplification can remove one. They are never patient causes or data requests.

**Mechanical checks, compilation and execution are different things.**

- `programs/check.py` checks JSON, quotations, digests and links without compiling anything.
- This compiler validates and types programs and derives dependencies, but executes nothing.
- No evaluator exists yet (increments I2–I6), so no program has been executed.

## Running

```bash
npm install --prefix libs/pathway-language
npm run --prefix libs/pathway-language typecheck   # strict, noUncheckedIndexedAccess
npm run --prefix libs/pathway-language build       # tsc → dist/ (gitignored)
npm test --prefix libs/pathway-language            # independent tests + fixture runners (S1/S2/encounter; I1 compile/preview)
```

This package has its own Jest configuration and is not part of the root Jest roots, which require the Docker test stack.

## Tests and fixture coverage

- **`src/__tests__/compile.test.ts`** has 36 independent I1 tests. Programs are built in the test with their own identifiers, and expected codes and pointers are derived from contract §5. They cover:
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
  - a deep-frozen source.

  Targeted mutation checks found no surviving mutation. Each of these breaks at least one test: urgency marking the status, no transitive marking, the wrong cycle pointer, holes compiling normally, no cross-enum check, no overlap check, and a misplaced `ctx.` being accepted.
- **`src/__tests__/program-examples.test.ts`** runs the six [first-program examples](../../docs/superpowers/records/pathway-language/programs/README.md). It applies each patch in the harness, which is input preparation and not a language feature, and checks **only** the `compile` and `preview` blocks. It also checks `state` where compilation alone decides it (`InvalidProgram`, `IncompleteAuthoring`); for compiled programs it only confirms the state is an evaluation state.
  - **PPL-01, -02, -03:** 5/5 checks each.
  - **PPL-04:** 9/9.
  - **PPL-05a, -05b:** 6/6 each.
  - `outputs`, `causeAttribution`, `trace` and evaluated `state` values are reported as outside I1 scope. No example is executed.
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
- **`src/__tests__/fixtures.test.ts`** runs the committed [explicit-assertion-v0 fixtures](../../docs/superpowers/records/pathway-language/conformance/explicit-assertion-v0/README.md) and checks **only** their S1, S2 and encounter-check assertions. It never reports a fixture as passing as a whole, because the rest of S3 and S4–S7 are not implemented. On the current fixtures it reports:
  - **167 S1 assertions checked, 167 passing.** That is 92 trace facts (`keyResult`, `variants`, `occurrences`, `rejected`, `outOfEnvelope`, `outsideEnvelope`, and the `HistoricalDefect`, `CrossKeyCorrection` and `UndeclaredField` diagnostics) plus 75 canonicalization checks (bytes, digests, variant partition, undeclared fields). EA-104 adds two.
  - **16 S2 assertions checked, 16 passing:** every `candidacy` trace fact (EA-013, EA-014, EA-024, three in EA-033, and EA-093 to EA-100).
  - **9 encounter-check assertions checked, 9 passing:** every `encounterScope` trace fact (EA-101 to EA-103, both variants of EA-104, EA-105, EA-106a/b and EA-107).
  - **One-way checks**, which can fail but cannot prove completeness:
    - 33 S1-stage cause attributions, each of which must be an active S1 defect;
    - 12 S2-stage cause attributions (EA-013, EA-014, EA-093 to EA-099), each of which must be an S2 finding on that revision;
    - 102 `candidateEvidenceIds` entries, each of which must have S2 candidacy `InDomain` or `Unresolved` (contract §5.1). The field is an S6 output, and its converse is not checked;
    - 12 encounter outcomes implied by complete S3 expectations. `admissibility: Admissible` implies `Matches` (EA-052a). `Inadmissible` with reason `OtherEncounter` implies `DoesNotMatch` (EA-009, EA-025, EA-107). An S3 attribution with an encounter reason must be a finding of the check (EA-010, EA-015, EA-101 to EA-103, EA-105, EA-106a/b). The `admissibility` facts themselves stay outside the implemented scope.

    The absence of an attribution proves nothing, because attribution also depends on S5/S6 materiality.
  - **527 expected fields and trace facts outside the implemented scope,** not checked: evidence, decision, Needs, complete admissibility, classification, cells, gaps and so on.
  - **3 fixtures not run:** EA-050 (whole-contract hole) and EA-051a/b (compilation).
  - **10 evaluation/preview fixtures with no applicable S1/S2/encounter-check assertion,** listed by the test: EA-001, -002, -005, -011, -043, -045, -046, -047, -052b and -053. Their behavior in these stages is exercised but not asserted.

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

**Deferred to a separate slice:** how several admissibility rules combine. Contract §2.2 does not say whether one rule’s `Inadmissible` outcome decides a revision while another rule is unresolved.

## Fork fallback (contract §2.1 step 7)

Step 5 records a fork only when no other defect exists. If that other defect later becomes historical, several heads can remain with no active defect. Example: `s1/r1@1` has two payloads, and the authorized `@2a` and `@2b` both supersede it. Step 7 then records a fork over the remaining heads, with cause `Conflicting` (cases 88–92). The fallback applies only when no defect is active. It is not a general test of whether an active defect “explains” the heads.

## I1 compiler: interpretations where the contract is silent

Each item below is an implementation choice, not an accepted semantic. None changes an example expectation.

1. **A structural failure omits hole diagnostics.** When any structural diagnostic exists, both modes return the same structural diagnostics only, matching the examples’ `sameDiagnostics` rule. The contract does not say whether `UNRESOLVED_AUTHORING_HOLE` should also be listed when holes coexist with a structural error. Smallest counterexample: the GERD program with one `ref` renamed to a missing ID.
2. **Identifier namespaces.** Declaration and EvidenceReference IDs share one namespace; hole IDs have their own, and must also be unique. A duplicate is reported at every occurrence, with `INVALID_DECLARATION_ID` also used for duplicate hole IDs.
3. **“Allowed position”** for an expression form means anywhere in that field’s expression tree. Holes are accepted only as the whole field.
4. **Undeclared criterion field or enum value** gives `UNDEFINED_REFERENCE`. The contract’s §5 text names only `ref` and `cites`.
5. **Criteria on any enum field.** Criteria may compare any enum-typed `demo-model@0.1` field, not only `c.assertion`. Disjointness across different fields is then `UNSUPPORTED_PROOF_FRAGMENT`.
6. **“Smallest JSON Pointer”** for a cycle is compared by Unicode code point.
7. **Declarations with an invalid kind** keep their ID, so references to them add no `UNDEFINED_REFERENCE`.
8. **Citation shapes.** `lines` is a `[first, last]` range, and `quote` keys must fall inside it. Files, digests and quotations are not read.

## Limitations

- **I1 compiles; it does not evaluate.** No `evidenceValue`, `all` or Finding value is computed (I2), and no stable serialized IR, manifest, signing or persistence exists. The compiler supports only the first-program subset and one fictional evidence model.

- Evidence stages: S1, S2 and one S3 rule only. There is no episode or `assertionKind` rule, no complete admissibility, and no selection, criteria, materiality, resolution, Needs or coverage evaluation.
- The encounter check recognizes exactly one authored rule shape. It does not evaluate expressions.
- S2 supports only the fixtures’ flat expansion format: no hierarchies, intensional definitions, terminology service, normalization, code-system conversion or version resolution.
- The fixtures assert S2 candidacy for 16 revisions. Variants, `excluded`/`unknown` propagation and configuration errors are covered by the independent tests only.
- One schematic authority rule and one fictional evidence model (`demo-model@0.1`). No clinical definitions.
- The fixtures assert S1 results only for some keys of some fixtures (see coverage above). No fixture asserts the retraction trace; it is covered by the independent tests only.
- **Asymmetry left by the concrete fallback.** With retraction authority missing on one of two heads, a fork recorded at step 5 stays active (EA-083: `Missing`, `Conflicting`). If the fork was suppressed by a now-historical conflict, only `Missing` remains (EA-092), because the fallback requires that no defect be active. Both results are unresolved with the same possible currents. Whether EA-092 should also be `Conflicting` would require a general rule for whether a defect explains multiple heads. That rule is deliberately not defined here. This is a known limitation of the narrow fallback, not an implementation error (review, 2026-10-05). Cause completeness must be revisited before building any behavior driven by causes, such as acquisition or conflict resolution.
