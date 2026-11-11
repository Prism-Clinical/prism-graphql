# Contract digest and structured Need key (I7 identity proposal)

**Status:** Proposed, not accepted. This is a design record for the first sub-slice of [I7 Needs generation](first-program-implementation-contract.md) (section 8, “Needs generation (I7)”, gap G2). It does not implement anything, decide whether a Need exists, or change any contract semantics, fixture expectation or story status. All content is fictional and nonclinical. **Date:** 2026-11-11.

**Problem statement.** Given a complete compiled evidence-query contract and resolved subject, episode and encounter bindings, define a deterministic contract digest and a structured Need key. Under explicitly defined equivalence rules, equivalent contracts produce the same digest. A change to executable meaning must not accidentally reuse a Need identity. The key is the existing one: (query ID, contract digest, subject, episode binding, encounter binding). This record defines that identity boundary only.

**Settled already (not changed here):**
- the key's five components;
- the cause is not part of it (evidence-query contract §6.2);
- K1 persists across snapshots 1–4, and a new digest or encounter gives a new key (§6.3);
- the authored `assertionKind` set is covered by the digest (§2.6, cases 115a/b use `d-ak1`);
- holes never produce Needs (§6.1);
- an unresolved key binding means no evidence Need and no dependent obligation (§6.2, cases 12, 102, 103, 113a/b);
- keys use versioned requirement, scope and anchor identities, never a random ID or evaluation revision (Stage A §7);
- RFC 8785 canonical bytes and SHA-256 identify variants ([CANONICALIZATION.md](conformance/explicit-assertion-v0/CANONICALIZATION.md) §7);
- a changed meaning must never reuse an old identifier (Stage A §12.1).

Everything marked **Proposed** below is a recommendation.

## 1. Inputs and output

**Inputs.**
- One `EvidenceQuery` declaration of a compiled package (`CompiledPackage` or `PreviewPackage`, `compile/types.ts`), taken from that package's own `declarations`. A caller-supplied object resembling a declaration is not accepted. This is the same ownership rule the query binding already enforces.
- That package's `languageVersion`, `capabilityProfileVersion` and `valueSets`.
- The evaluation context's `subject` and its `episode` and `encounter` bindings (`{known}` or `{unknown}`, `s3/types.ts`).

Raw program source is never digested. Only the compiled contract is.

**Output (Proposed).** One of:
- `{ key: NeedKey }`: every component is defined;
- `{ noContractIdentity: { holes } }`: the contract is incomplete (`explicit-assertion-v0-incomplete`) or a whole-contract hole;
- `{ unresolvedBindings: [...] }`: the contract is complete, but `episode` and/or `encounter` is `{unknown}`. The digest is still computable.

Whether any of these leads to a Need, a deferral record or nothing is decided by the emission slice, not here.

## 2. Digest projection and algorithm (Proposed)

### 2.1 Projection

The digest covers a projection of the compiled contract. It never covers the whole package. Each member has one source in the current representation.

| Member | Source | Why it is executable |
|---|---|---|
| `scheme` | constant `"ppl-query-contract-digest/0"` | Domain separation and the version of these rules |
| `languageVersion`, `capabilityProfileVersion` | `CompiledProgram` | Language and capability semantics (Stage A §12.1) |
| `declaration` = `{kind, subject, output}` | the `EvidenceQuery` declaration (`"EvidenceQuery"`, `"patient"`, `"Evidence<Boolean>"`) | Subject type and result type |
| `policy` | `contract.kind` (`"explicit-assertion-v0"`) | Evidence-resolution policy (S6 rules, §4) |
| `retrieve.recordType` | `contract.recordType` | Record model identity and version; compared with coverage statements in gap relevance |
| `retrieve.sources` | `contract.sources` | Retrieval envelope; defines the coverage cells and source-disjointness proofs |
| `retrieve.valueSet` = `{id, expansion, coveredSystems}` | `contract.valueSet` plus the package's `valueSets[contract.valueSet]` | S2 membership is decided by the supplied expansion content (`s2/identify.ts`) |
| `corrections.authority` | `contract.authorityRule` | S1 correction authority and source-disjointness proof (`s6/gaps.ts`) |
| `admissible.episode`, `admissible.encounter` | `contract.admissible.episode` / `.encounter` (verbatim JSON; the compiler admits only `eq(c.f, ctx.f)`) | S3 rules (§2.4, §2.5) |
| `admissible.assertionKind` | `contract.admissible.assertionKinds` | S3 rule (§2.6) |
| `establishes`, `refutes` = `{field, enumType, value}` | the `EnumCriterion`s, without `location` | S5 criteria (§3.5) |

**Excluded:**
- **Already in the key or runtime data:** query ID, subject, episode, encounter, snapshot, records, coverage, failures, evaluation clock and `mode`.
- **Non-executable:** `cites`, `location`s, the frozen `contract.source` copy, package `id`, `state` and `nonclinical`, `references`, `holes`, `markers`, `inspectable`, labels and headings.
- **Unrelated:** other declarations, value sets the query does not pin, and `dependencyEdges`.
- **The disjointness obligation:** every complete contract must prove it to compile. It gates publication, not evaluation, so it adds nothing to a complete contract's meaning.
- **The `experimental` tag and compiler or runtime build identity:** these are implementation identities, kept separate in Stage A §12.1. Including them would change every key on every rebuild.

### 2.2 Pins that do not bind content (Proposed rules)

A version string does not prove content identity. This subset has two kinds of pins.

- **Pins whose content is package data: the value set.** The package supplies the expansion itself, and the compiler accepts any well-formed expansion under any ID. Two packages can pin `demo-vs/item-x@1` with different codes. **Rule V:** the digest includes the expansion and covered systems, not only the ID. It also keeps the ID, conservatively, because the ID is the declared pin S2 checks and traces.
- **Pins whose content is built into the implementation:** `recordType` (fields, enums and payload canonicalization of `demo-model@0.1`), `authorityRule`, `policy`, `languageVersion` and `capabilityProfileVersion`. Their meaning is prose contract text plus code, not data in the package. The digest can bind only the identifier. **Rule B:** a built-in identifier names exactly one executable meaning. Any change to that meaning, including a bug fix that changes a fixture outcome, ships under a new identifier. This applies Stage A §12.1's "no reuse of an old identifier with different behavior" to Need identity.

  The evidence that an implementation realizes an identifier is conformance against its fixtures, not the digest. Without Rule B, a changed built-in would silently reuse old keys. That gap is exposed here, not closed by the digest (open decision O1).

### 2.3 Semantic normalization, then canonical serialization

Normalization (the only equivalences this subset recognizes):

| Member | Kind | Normalization | Justification |
|---|---|---|---|
| Every object | Members unordered | None; RFC 8785 orders members | Member order is not meaning (CANONICALIZATION.md §6) |
| `retrieve.sources` | Set | Sort | Used only as a set (`scope.sources` is sorted, membership tests in `s6/gaps.ts`). Duplicates are a compile error, so none remain |
| `admissible.assertionKind` | Set | Remove duplicates, then sort | §2.6 "authored set"; S3 tests membership only. The compiler accepts duplicates |
| `retrieve.valueSet.coveredSystems` | Set | Remove duplicates, then sort | Membership test only (`includes`) |
| `retrieve.valueSet.expansion` | Set of `{system, code}` | Remove exact duplicates, then sort by `system`, then `code` | Membership test only (`some(x => …)`), exact comparison |
| Admissible rule expressions (`eq` operands) | Ordered | None | Arrays are ordered by default (CANONICALIZATION.md §5) |
| Strings | — | None: no case folding, trimming or Unicode normalization | CANONICALIZATION.md §4 |

Sorting compares UTF-16 code units, the rule CANONICALIZATION.md §5 uses for its one set field and RFC 8785 uses for member names. No other array is reordered. The projection contains no numbers.

**Conservative cases: equivalent meaning, different digest.** This subset does not attempt general semantic equivalence.
- The same expansion under a different value-set ID.
- Two authority-rule or record-type identifiers with identical behavior.
- An expansion that differs only in codes no record will ever carry.
- An `assertionKind` set that lists every enum value. This is not equivalent to "no rule", which this subset cannot express anyway.
- A future expression form that rewrites a criterion into an equivalent one.

Each of these gets a new key. This can open a second Need for the same real requirement, but it never merges two different ones.

### 2.4 Hashing

- **Bytes:** UTF-8 of the RFC 8785 serialization of the normalized projection, as CANONICALIZATION.md §7 defines for payloads. The existing `canonicalJson` (`s1/payload.ts`) is the implementation to reuse.
- **Domain separation:** the `scheme` member is inside the hashed bytes. A projection under another scheme can never produce the same input as one under this scheme. Any change to sections 2.1–2.3 needs a new `scheme` value, and therefore new keys.
- **Algorithm and encoding:** SHA-256, 64 lower-case hex characters.
- **Digest value:** `{ "scheme": "ppl-query-contract-digest/0", "sha256": "<64 hex>" }`, a structured value, not a prefixed string.

**Unsupported or incomplete contracts get no digest.**
- `explicit-assertion-v0-incomplete`: `noContractIdentity` with its criterion-hole IDs.
- `hole`: `noContractIdentity` with the contract-hole ID.
- An uncompiled source or an unsupported construct: a compile failure, so nothing exists to digest.
- No default or guessed value ever fills a missing member.

A complete contract inside a `PreviewPackage` has the same projection and digest as in a `CompiledPackage`. Whether preview emits Needs is gap G1 (minimal-model open decision 5).

## 3. Structured Need key (Proposed)

```json
{
  "query": "q.demo",
  "contractDigest": { "scheme": "ppl-query-contract-digest/0", "sha256": "<64 hex>" },
  "subject": "P1",
  "episode": "E1",
  "encounter": "N1"
}
```

- `query`: the `EvidenceQuery` declaration ID, as the existing key and fixtures use it.
- `subject`: the context `subject` string.
- `episode`, `encounter`: the `known` values. These are already validated as `EpisodeRef` and `EncounterRef` (§2.4, §2.5); an invalid value is a configuration error, not a deferral.
- **Identity:** the RFC 8785 bytes of this object; two keys are equal if and only if those bytes are equal. This is the collision-safe pattern gap and attribution identities already use (§4.1, §4.2). No component is joined with a delimiter. The fixture tuple `(q.demo, d1, P1, E1, N1)` is a display label only. Fixtures keep `d1` and `d-ak1` as symbolic labels, mapped to computed digests as the conformance README directs.
- **Not part of the key:** snapshot IDs, evaluation revisions, causes, contributing records, gap diagnostics and acquisition attempts. These are Need state (§6.2).
- **Unresolved bindings:** if `episode` or `encounter` is `{unknown}`, no fully bound key is produced. There is no placeholder ID, `null` component or partial key, and no context-binding Need is defined here (gap G5). The fixtures' `deferred: {binding}` names one binding. How to record both being unresolved at once is left to the emission slice (O3).

## 4. Examples (hand-derived expectations)

Base: `q.demo` as in `query/q.demo.json`, context P1/E1/N1. Its normalized projection, serialized by hand under section 2:

```text
{"admissible":{"assertionKind":["ClinicianDocumented","PatientReport"],"encounter":{"eq":[{"field":["c","encounter"]},{"ref":"ctx.encounter"}]},"episode":{"eq":[{"field":["c","episode"]},{"ref":"ctx.episode"}]}},"capabilityProfileVersion":"ppl-core-v0","corrections":{"authority":"demo-policy/same-source-amend@1"},"declaration":{"kind":"EvidenceQuery","output":"Evidence<Boolean>","subject":"patient"},"establishes":{"enumType":"AssertionValue","field":"assertion","value":"Affirmed"},"languageVersion":"ppl-1","policy":"explicit-assertion-v0","refutes":{"enumType":"AssertionValue","field":"assertion","value":"Denied"},"retrieve":{"recordType":"demo-model/DemoAssessment@0.1","sources":["s1","s2"],"valueSet":{"coveredSystems":["demo-cs"],"expansion":[{"code":"item-x","system":"demo-cs"}],"id":"demo-vs/item-x@1"}},"scheme":"ppl-query-contract-digest/0"}
```

Each row compares a variant with the base. "Same digest" means identical projection bytes. No hash values are given: an implementation's output is not independent evidence.

| # | Change from the base | Digest | Key |
|---|---|---|---|
| X1 | `retrieve` written as `{valueSet, sources, type}`; `admissible` members reordered | Same | Same |
| X2 | `sources: ["s2","s1"]` | Same | Same |
| X3 | `assertionKind: {in: ["PatientReport","ClinicianDocumented","PatientReport"]}` | Same | Same |
| X4 | Expansion listed twice or reordered; `coveredSystems` reordered | Same | Same |
| X5 | Different `cites`; a Finding's `label` or `heading`; a hole's `explains`; package `state`; the query moved to another `nodes` position (all `location`s change) | Same | Same |
| X6 | Another Predicate, Finding or query added; an unpinned value set added | Same | Same |
| X7 | `establishes` becomes `AssertionValue.Indeterminate` (still disjoint from `refutes`) | Differs | Differs |
| X8 | `assertionKind: {in: ["ClinicianDocumented"]}` (case 115, `d-ak1`) | Differs | Differs |
| X9 | Another authority-rule ID. It is hypothetical, since this subset accepts one; an unsupported ID is a compile failure with no digest | Differs | Differs |
| X10 | Code `item-y` added to `demo-vs/item-x@1` under the **same** ID (Rule V) | Differs | Differs |
| X11 | Same expansion, value-set ID `demo-vs/item-x@2` (conservative) | Differs | Differs |
| X12 | `sources: ["s1","s2","s3"]` | Differs | Differs |
| X13 | Subject P2; episode E2; encounter N2 (§6.3 row 6) | Same | Differs |
| X14 | Query renamed `q.demo2`, contract unchanged | Same | Differs |
| X15 | snap-1 → snap-2 → snap-3 (§6.3 rows 1–3): attempts, causes and contributing records change | Same | Same |
| X16 | Key A: subject `P1,E1`, episode `N1`, encounter `N2`. Key B: subject `P1`, episode `E1,N1`, encounter `N2`. Joining with `,` would give `P1,E1,N1,N2` for both | Same | Differs: the RFC 8785 bytes differ |
| X17 | Context episode `{unknown: ["Conflicting"]}` (cases 12, 113a) | Same | None: `unresolvedBindings: ["episode"]` |
| X18 | `establishes` is a criterion hole (EA-052a); or the contract is a whole hole (EA-050) | None: `noContractIdentity` | None |
| X19 | Compiler build or `experimental` tag changes; projection unchanged | Same | Same. Rule B governs any change in meaning |

## 5. Open decisions (require review)

- **O1. Rule B, binding built-in identifiers.** Accept the rule that a built-in record type, authority rule, policy, language or profile identifier never changes meaning? The alternative is to digest an implementation or catalogue identity, at the cost of new keys on every rebuild. Recommendation: Rule B, with fixture conformance as the evidence.
- **O2. Rule V, value-set content in the digest.** Recommendation: include the content inline. Large expansions might later be referenced by their own content digest instead; this needs no change until such expansions exist.
- **O3. Both bindings unresolved.** The fixture shape `deferred: {binding}` has one binding, and no fixture has both unknown. This belongs to the emission slice, not identity.
- **O4. Package qualification of `query`.** The declaration ID is unique only within its package, and `package.id` carries no version. Two packages with the same query ID and the same digest would share a key. Because the digest covers the whole executable contract, that would merge only identical requirements. Recommendation: keep the existing key unchanged and revisit this with cross-query and cross-package deduplication (gap G7).
- **O5. Relation to Stage A §17 item 7.** This scheme is bounded to this subset's compiled contract. A canonical IR schema would get a new `scheme`, and every key would change once. Carrying Needs across that change is a lifecycle question (I7 lifecycle sub-slice).

## 6. Consistency notes

- The structured digest object replaces the symbolic strings `d1` and `d-ak1` only when computed. The fixtures, the README mapping and §6.3 stay as they are.
- §6.2 lists what the digest covers: the envelope, declared sources, value-set version, authority rule, admissibility rules, criteria and policy version. Each has a member in 2.1. This proposal adds value-set content, language/profile versions and the declaration signature, and states the exclusions.
- Nothing here changes S1–S7, the EA-083/EA-092 limitation, or any acceptance case.
