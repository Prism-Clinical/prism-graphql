# @prism/pathway-language (experimental, nonclinical)

**Status:** an implementation experiment for **one stage (S1)** of the *proposed* [evidence-query-to-predicate contract](../../docs/superpowers/records/pathway-language/evidence-query-to-predicate-contract.md). It is not the PPL evaluator, not a compiler and not clinically approved. It must not be used for patient care. The RFC, Stage A, the contract and the delivery plans keep their existing statuses; nothing here completes a delivery story.

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

## Running

```bash
npm install --prefix libs/pathway-language
npm run --prefix libs/pathway-language typecheck   # strict, noUncheckedIndexedAccess
npm run --prefix libs/pathway-language build       # tsc → dist/ (gitignored)
npm test --prefix libs/pathway-language            # independent S1 tests + fixture S1 runner
```

This package has its own Jest configuration and is not part of the root Jest roots, which require the Docker test stack.

## Tests and fixture coverage

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
- **`src/__tests__/s1-fixtures.test.ts`** runs the committed [explicit-assertion-v0 fixtures](../../docs/superpowers/records/pathway-language/conformance/explicit-assertion-v0/README.md) and checks **only** their S1 assertions. It never reports a fixture as passing as a whole. On the current fixtures it reports:
  - **164 S1 assertions checked, 164 passing.** That is 89 trace facts (`keyResult`, `variants`, `occurrences`, `rejected`, `outOfEnvelope`, `outsideEnvelope`, and the `HistoricalDefect`, `CrossKeyCorrection` and `UndeclaredField` diagnostics) plus 75 canonicalization checks (bytes, digests, variant partition, undeclared fields).
  - **32 S1-stage cause attributions checked one way:** each must be an active S1 defect. The absence of an attribution proves nothing, because attribution also depends on S5/S6 materiality.
  - **451 expected fields and trace facts out of S1 scope,** not checked: evidence, decision, Needs, candidacy, admissibility, classification, cells, gaps and so on.
  - **3 fixtures not run by S1:** EA-050 (whole-contract hole) and EA-051a/b (compilation).
  - **32 evaluation/preview fixtures with no S1 expectation at all,** listed by the test. Their S1 behavior is exercised but not asserted.

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

## Fork fallback (contract §2.1 step 7)

Step 5 records a fork only when no other defect exists. If that other defect later becomes historical, several heads can remain with no active defect. Example: `s1/r1@1` has two payloads, and the authorized `@2a` and `@2b` both supersede it. Step 7 then records a fork over the remaining heads, with cause `Conflicting` (cases 88–92). The fallback applies only when no defect is active. It is not a general test of whether an active defect “explains” the heads.

## Limitations

- S1 only: no candidacy (S2), admissibility (S3), selection, criteria, resolution, Needs, coverage or preview markers.
- One schematic authority rule and one fictional evidence model (`demo-model@0.1`). No clinical definitions.
- The fixtures assert S1 results only for some keys of some fixtures (see coverage above). No fixture asserts the retraction trace; it is covered by the independent tests only.
- **Asymmetry left by the concrete fallback.** With retraction authority missing on one of two heads, a fork recorded at step 5 stays active (EA-083: `Missing`, `Conflicting`). If the fork was suppressed by a now-historical conflict, only `Missing` remains (EA-092), because the fallback requires that no defect be active. Both results are unresolved with the same possible currents. Whether EA-092 should also be `Conflicting` would require a general rule for whether a defect explains multiple heads. That rule is deliberately not defined here. This is a known limitation of the narrow fallback, not an implementation error (review, 2026-10-05). Cause completeness must be revisited before building any behavior driven by causes, such as acquisition or conflict resolution.
