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
| `status` | `Current`, `Retracted`, `NoRecord`, `UnresolvedRevision` or `ContractUndefined` (see “Contract discrepancy”) |
| `current` | The current `NodeRef`, for `Current` only |
| `causes` | Active S1 causes in Stage A order, for `UnresolvedRevision` only |
| `possibleCurrent` | *H* ∪ *X*: nodes (with a variant digest for a conflicted revision), `excluded`, `unknown` |
| `activeDefects` / `historicalDefects` | Defects with cause, reason, subject, involved revisions and active additions. Historical defects are trace diagnostics (`HistoricalDefect`), never causes |
| `revisions` | Every revision with its state (`head`, `superseded`, `retracted`, `rejected`, `outOfEnvelope`) and its variants: digest, RFC 8785 canonical payload, membership, and occurrences with provenance and undeclared fields |
| `diagnostics` | Target-side traces (`CrossKeyCorrection`, `CrossKeyRetraction`, retractions of out-of-envelope, rejected or superseded revisions) |

The `S1Result` also lists:

- `rejections` (unauthorized and cross-boundary items);
- `outsideEnvelope`;
- `unidentified` occurrences, which lack identity or are not RFC 8785 representable;
- `unattributableRetractions`.

Identity tuples (`RecordKey`, `RevisionRef`, `RetractionRef`, `NodeRef`) are objects. Display strings exist only in the tests, for comparing with the fixtures’ notation.

**Determinism.** Every decision is taken over sets keyed by identity. Input order, revision-ID order and timestamps never choose a revision. Output lists are sorted canonically (contract §5.3) for representation only. The only field that follows input positions is `Occurrence.inputIndex`, which is kept for traceability.

**Canonicalization.** Payload equality follows CANONICALIZATION.md. Serialization uses [`json-canonicalize`](https://www.npmjs.com/package/json-canonicalize) 3.0.1 (MIT; CommonJS-compatible; Node ≥ 8.5). Before adoption it was checked against all 24 RFC 8785 Appendix B number vectors and the RFC’s §3.2.3 sample, and the fixture checker independently verifies the same digests with a *different* library (`canonicalize`). `json-canonicalize` serializes lone surrogates instead of rejecting them, so `payload.ts` rejects them explicitly. No RFC 8785 serialization is hand-written here.

## Running

```bash
npm install --prefix libs/pathway-language
npm run --prefix libs/pathway-language typecheck   # strict, noUncheckedIndexedAccess
npm run --prefix libs/pathway-language build       # tsc → dist/ (gitignored)
npm test --prefix libs/pathway-language            # independent S1 tests + fixture S1 runner
```

This package has its own Jest configuration and is not part of the root Jest roots, which require the Docker test stack.

## Tests and fixture coverage

- **`src/__tests__/s1.test.ts`** has 44 independent tests whose expectations are derived by hand from the contract. They cover:
  - identical versus conflicting payloads, RFC 8785 number equality, absent versus `null`, and set-valued permissions;
  - authorized, unauthorized and undeterminable corrections;
  - subject changes, out-of-envelope targets, cross-local-ID corrections and undeterminable membership;
  - incomplete, malformed and absent references, self-supersession, cycles and valid chains;
  - forks with authorized, unauthorized and unknown-authority retractions;
  - conflict resolution, including one defect resolved while another stays active;
  - cases 85–87, plus extra combinations no fixture covers: an unknown-authority correction superseded by a valid later one, an undeterminable-membership correction that is then retracted, a retraction of a superseded revision, an absent retraction target, and conflicting or unattributable retractions;
  - input-permutation and duplicate-occurrence invariance, input immutability, and the contract gap below.
- **`src/__tests__/s1-fixtures.test.ts`** runs the committed [explicit-assertion-v0 fixtures](../../docs/superpowers/records/pathway-language/conformance/explicit-assertion-v0/README.md) and checks **only** their S1 assertions. It never reports a fixture as passing as a whole. On the current fixtures it reports:
  - **145 S1 assertions checked, 145 passing.** That is 77 trace facts (`keyResult`, `variants`, `occurrences`, `rejected`, `outOfEnvelope`, `outsideEnvelope`, and the `HistoricalDefect`, `CrossKeyCorrection` and `UndeclaredField` diagnostics) plus 68 canonicalization checks (bytes, digests, variant partition, undeclared fields).
  - **29 S1-stage cause attributions checked one way:** each must be an active S1 defect. The absence of an attribution proves nothing, because attribution also depends on S5/S6 materiality.
  - **430 expected fields and trace facts out of S1 scope,** not checked: evidence, decision, Needs, candidacy, admissibility, classification, cells, gaps and so on.
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

## Contract discrepancy (proposal, not applied)

**Smallest counterexample:**

- `s1/r1@1` is received with two different payloads, making it a conflicted revision.
- `@2a` and `@2b` both supersede `@1`, and both corrections are authorized.

**What the contract yields:**

1. Step 5 records no fork, because a defect (`PayloadConflict`) already exists.
2. Step 7 makes `PayloadConflict` historical, because `@1` is not in *H*.
3. That leaves two heads and no active defect.
4. The final table then maps this to `UnresolvedRevision` with an **empty** cause set, which Stage A §4.1 (`NonEmptySet<Cause>`) forbids.

No fixture covers this. The resolver returns `ContractUndefined` with an explanation, and does not invent a cause.

**Decision needed.** Two options:

- **(a)** In step 7, if no defect is active but more than one head remains, those heads form a fork (`Conflicting`, `Fork`). This changes no existing fixture.
- **(b)** Record forks at step 5 regardless of other defects. This would add `Fork` attributions to cases 73 and 78 and requires updating their fixtures.

Option (a) is the smaller change.

## Limitations

- S1 only: no candidacy (S2), admissibility (S3), selection, criteria, resolution, Needs, coverage or preview markers.
- One schematic authority rule and one fictional evidence model (`demo-model@0.1`). No clinical definitions.
- The fixtures assert S1 results only for some keys of some fixtures (see coverage above).
