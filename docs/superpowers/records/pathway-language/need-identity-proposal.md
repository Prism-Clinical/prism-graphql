# Contract digest and structured Need key (I7 identity proposal)

**Status:** Decisions O1–O5 were reviewed on 2026-11-12 (section 5): O1 and O4 were revised, O2 and O5 kept, O3 settled at the identity boundary. Sections 1–4 under those decisions are **implemented experimentally** (2026-11-13, section 7); I7 as a whole is not implemented. The open items of section 5 and the interpretations in 7.4 are not accepted. This is a design record for the first sub-slice of [I7 Needs generation](first-program-implementation-contract.md) (section 8, “Needs generation (I7)”, gap G2). Its implementation (section 7) does not decide whether a Need exists, or change any contract semantics, fixture expectation or story status. All content is fictional and nonclinical. **Date:** 2026-11-11. **Revised:** 2026-11-12, applying the review of O1–O5; 2026-11-13, recording the experimental implementation (section 7).

**Problem statement.** Given a complete compiled evidence-query contract and resolved subject, episode and encounter bindings, define a deterministic contract digest and a structured Need key. Under explicitly defined equivalence rules, equivalent contracts produce the same digest. A change to executable meaning must not accidentally reuse a Need identity. The key is the existing one: (query ID, contract digest, subject, episode binding, encounter binding). This record defines that identity boundary only.

**Settled already (not changed here):**
- the key's five components (the query component is represented package-qualified, section 3, O4);
- the cause is not part of it (evidence-query contract §6.2);
- K1 persists across snapshots 1–4, and a new digest or encounter gives a new key (§6.3);
- the authored `assertionKind` set is covered by the digest (§2.6, cases 115a/b use `d-ak1`);
- holes never produce Needs (§6.1);
- an unresolved key binding means no evidence Need and no dependent obligation (§6.2, cases 12, 102, 103, 113a/b);
- keys use versioned requirement, scope and anchor identities, never a random ID or evaluation revision (Stage A §7);
- RFC 8785 canonical bytes and SHA-256 identify variants ([CANONICALIZATION.md](conformance/explicit-assertion-v0/CANONICALIZATION.md) §7);
- a changed meaning must never reuse an old identifier (Stage A §12.1).

Everything marked **Proposed** below is a recommendation; items marked **Reviewed** record the 2026-11-12 decisions.

## 1. Inputs and output

**Inputs.**
- One `EvidenceQuery` declaration of a compiled package (`CompiledPackage` or `PreviewPackage`, `compile/types.ts`), taken from that package's own `declarations`. A caller-supplied object resembling a declaration is not accepted. This is the same ownership rule the query binding already enforces.
- That package's `packageId`, `languageVersion`, `capabilityProfileVersion` and `valueSets`.
- The evaluation context's `subject` and its `episode` and `encounter` bindings (`{known}` or `{unknown}`, `s3/types.ts`).

Raw program source is never digested. Only the compiled contract is.

**Output (Proposed).** One of:
- `{ key: NeedKey }`: every component is defined;
- `{ noContractIdentity: { holes } }`: the contract is incomplete (`explicit-assertion-v0-incomplete`) or a whole-contract hole;
- `{ unresolvedBindings: [...] }`: the contract is complete, but `episode` and/or `encounter` is `{unknown}`. Every unresolved binding is listed, in key order (`episode`, then `encounter`), each once (O3). The digest is still computable.

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
- **Already in the key or runtime data:** package namespace, query ID, subject, episode, encounter, snapshot, records, coverage, failures, evaluation clock and `mode`.
- **Non-executable:** `cites`, `location`s, the frozen `contract.source` copy, package `state` and `nonclinical`, `references`, `holes`, `markers`, `inspectable`, labels and headings.
- **Unrelated:** other declarations, value sets the query does not pin, and `dependencyEdges`.
- **The disjointness obligation:** every complete contract must prove it to compile. It gates publication, not evaluation, so it adds nothing to a complete contract's meaning.
- **The `experimental` tag and compiler or runtime build identity:** these are implementation identities, kept separate in Stage A §12.1 and recorded with each evaluation instead (Rule B). Including them would change every key on every rebuild.

### 2.2 Pins that do not bind content (Reviewed rules)

A version string does not prove content identity. This subset has two kinds of pins.

- **Pins whose content is package data: the value set.** The package supplies the expansion itself, and the compiler accepts any well-formed expansion under any ID. Two packages can pin `demo-vs/item-x@1` with different codes. **Rule V:** the digest includes the expansion and covered systems, not only the ID. It also keeps the ID, conservatively, because the ID is the declared pin S2 checks and traces.
- **Pins whose content is built into the implementation:** `recordType` (fields, enums and payload canonicalization of `demo-model@0.1`), `authorityRule`, `policy`, `languageVersion` and `capabilityProfileVersion`. Their meaning is prose contract text plus code, not data in the package. The digest can bind only the identifier. **Rule B** (revised on review, O1) separates two kinds of change:
  - **Specification change.** The specified meaning of a built-in identifier is immutable. The specification is its contract text and accepted cases. Changing either requires a new identifier, so the digest and every key change. This applies Stage A §12.1's "no reuse of an old identifier with different behavior" to Need identity.
  - **Implementation correction.** Code changed to conform to the *unchanged* specification keeps the identifier, the digest and the keys. The implementation version is recorded separately, with each evaluation, and never enters the digest or key. After such a correction, Needs produced under an affected implementation version are explicitly reevaluated. That reevaluation is a new evaluation revision under the same keys, and how affected Needs are found and reevaluated belongs to the I7 lifecycle sub-slice.
  - **Classification.** The review accepting the change decides which kind it is. If contract text and a fixture disagree, that review settles which one is the specification. A resolution that changes specified behavior is a specification change.

  The evidence that an implementation realizes an identifier is conformance against its accepted cases, not the digest. The digest binds the identifier; Rule B binds the identifier to one specified meaning.

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
  "query": { "package": "<package namespace>", "id": "q.demo" },
  "contractDigest": { "scheme": "ppl-query-contract-digest/0", "sha256": "<64 hex>" },
  "subject": "P1",
  "episode": "E1",
  "encounter": "N1"
}
```

- `query` (revised on review, O4): the package namespace and the `EvidenceQuery` declaration ID, as two members. The namespace is the compiled `packageId` (source `package.id`, e.g. `gerd-pregnancy.alarm.progressive-dysphagia`). It names the pathway across its revisions and carries no version, so revising a package keeps the namespace and only a changed contract changes the digest. Identical query contracts in two pathways therefore never share a key or Need lifecycle state. Renaming a package is a new namespace and gives new keys. The compiler checks only that the ID is a string; allocating namespaces so they stay stable and unique across authors and institutions is not specified here (section 5).
- `subject`: the context `subject` string.
- `episode`, `encounter`: the `known` values. These are already validated as `EpisodeRef` and `EncounterRef` (§2.4, §2.5); an invalid value is a configuration error, not a deferral.
- **Identity:** the RFC 8785 bytes of this object; two keys are equal if and only if those bytes are equal. This is the collision-safe pattern gap and attribution identities already use (§4.1, §4.2). No component is joined with a delimiter. The fixture tuple `(q.demo, d1, P1, E1, N1)` is a display label only. Fixtures keep `query: "q.demo"`, `d1` and `d-ak1` unchanged: a conformance run maps `q.demo` to one fixed test namespace, just as it maps `d1` and `d-ak1` to computed digests (conformance README, open item 1).
- **Not part of the key:** snapshot IDs, evaluation revisions, causes, contributing records, gap diagnostics and acquisition attempts. These are Need state (§6.2).
- **Unresolved bindings:** if `episode` or `encounter` is `{unknown}`, no fully bound key is produced. There is no placeholder ID, `null` component or partial key, and no context-binding Need is defined here (gap G5). The identity boundary returns every unresolved binding (O3). How Need emission records them, including the case where the fixtures' `deferred: {binding}` names only one, is left to the emission slice.

## 4. Examples (hand-derived expectations)

Base: `q.demo` as in `query/q.demo.json`, in a package with namespace `pkg.a`, context P1/E1/N1. Its normalized projection, serialized by hand under section 2:

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
| X17b | Episode and encounter both `{unknown}` | Same | None: `unresolvedBindings: ["episode", "encounter"]` |
| X18 | `establishes` is a criterion hole (EA-052a); or the contract is a whole hole (EA-050) | None: `noContractIdentity` | None |
| X19 | Compiler build or `experimental` tag changes; projection unchanged | Same | Same |
| X20 | Implementation correction: S1 code fixed to match the unchanged authority-rule specification, so a fixture outcome changes (Rule B) | Same | Same. The new implementation version is recorded with each evaluation, and affected Needs are explicitly reevaluated |
| X21 | Specification change: the authority rule's specified meaning changes, published under a new rule ID (Rule B) | Differs | Differs |
| X22 | The same `q.demo` contract declared in package `pkg.b` (O4) | Same | Differs: `query.package` differs |
| X23 | Package `pkg.a` revised elsewhere (another Finding, new citations); namespace kept | Same | Same |

## 5. Decisions (reviewed 2026-11-12)

- **O1. Built-in identifiers (revised).** Specified meaning is immutable, and a specification change needs a new identifier. An implementation correction keeps the identifier, digest and keys, with the implementation version recorded separately and affected Needs explicitly reevaluated (Rule B, 2.2). The 2026-11-11 version instead required a new identifier for any bug fix that changed a fixture outcome.
- **O2. Value-set content in the digest (kept).** The content is included inline (Rule V). Large expansions might later be referenced by their own content digest.
- **O3. Unresolved bindings (settled at the identity boundary).** All unresolved bindings are returned (section 1). Their Need-emission behavior is deferred to the emission slice.
- **O4. Package qualification (revised).** The query component is `{package, id}` (section 3), so identical contracts in two pathways do not share Need lifecycle state. The 2026-11-11 version left the query ID unqualified.
- **O5. Scheme versioning (kept).** The digest scheme is versioned whenever its definition changes. A canonical IR schema (Stage A §17 item 7) would introduce a new `scheme` and change every key once. Carrying Needs across schemes is deferred to the I7 lifecycle sub-slice.

**Still open, outside this proposal:**
- How package namespaces are allocated so they stay stable and unique across authors and institutions (O4). This is governance or registry work, not compiler behavior.
- Where the implementation version is recorded with an evaluation, and how affected Needs are selected for reevaluation (O1). Both belong to the lifecycle sub-slice.

## 6. Consistency notes

- The structured digest object and the package-qualified `query` replace the symbolic `d1`, `d-ak1` and bare `q.demo` only when computed. The fixtures, the README mapping and §6.3 stay as they are.
- §6.2 names the first key component "query ID". Representing it as `{package, id}` refines that representation without changing the component's role; §6.3's display tuples stay unchanged.
- §6.2 lists what the digest covers: the envelope, declared sources, value-set version, authority rule, admissibility rules, criteria and policy version. Each has a member in 2.1. This proposal adds value-set content, language/profile versions and the declaration signature, and states the exclusions.
- Nothing here changes S1–S7, the EA-083/EA-092 limitation, or any acceptance case.

## 7. Implementation (experimental, 2026-11-13)

Identity only. This section records what `libs/pathway-language` implements; it changes none of sections 1–6.

### 7.1 API and outcomes

`experimentalNeedIdentity({ package, query, subject, contextEpisode, contextEncounter })` (`src/identity.ts`) accepts exactly those five fields:
- `package` is an authentic `CompiledPackage` or `PreviewPackage`;
- `query` is the ID of one of its `EvidenceQuery` declarations;
- the bindings use the existing `{known}` / `{unknown: causes}` notation.

The package supplies every authored setting and the namespace; no digest, projection or namespace override is accepted. The result is detached, deep-frozen, and exactly one of the section 1 outputs:
- `{ key }` (section 3 shape, `contractDigest: { scheme, sha256 }`);
- `{ noContractIdentity: { holes } }`;
- `{ unresolvedBindings }` (`'episode'`, then `'encounter'`).

The projection, normalization and hashing are sections 2.1–2.4, using the existing `canonicalJson` and `node:crypto` SHA-256, with no new dependency. Malformed input throws `NeedIdentityConfigurationError`.

### 7.2 Validation order

All configuration checks precede every outcome:
1. input shape: a plain object, exactly the five fields, each read once as a data property;
2. package authenticity;
3. query ownership;
4. `subject`: a string without lone surrogates;
5. `contextEpisode`, then `contextEncounter`: captured once (no accessor, function or non-plain object), exactly one own member, the S3 syntax check of §2.5 / §2.4, and a `known` value without lone surrogates.

Then a hole gives `noContractIdentity`; else an `unknown` binding gives `unresolvedBindings`; else the key. Caller objects are never frozen, mutated or reread.

### 7.3 Evidence

`src/__tests__/identity.test.ts` holds 35 tests. The base bytes of section 4 are asserted verbatim, and the expected SHA-256 is computed in the test from those bytes, not from the production projection.
- **Through the public API:** examples X1–X8, X10–X14, X16–X18, X22 and X23.
- **Through the projection helper, with labelled internal fixtures:** X9, X21 and the other settings the compiler admits one value for.
- **Structural:** X15, X19 and X20. The API has no snapshot, build or implementation-version input.

A fault check, not committed, injected 13 faults. Each made at least one test fail:
- package qualification dropped;
- value-set ID without content;
- locations included;
- unrelated declarations included;
- an executable field omitted (`refutes`, `recordType`);
- each of the four normalizations skipped;
- a delimiter-joined key;
- a key for unresolved bindings;
- a key for an incomplete contract.

No test shows that a built-in identifier keeps one specified meaning across releases; that remains the Rule B versioning obligation. A specification change needs a new identifier. A code correction to match unchanged semantics keeps the key. Clarifying wording or adding a test needs neither. Recording the implementation version and reevaluating affected Needs belong to the lifecycle sub-slice.

### 7.4 Interpretations made, for review

1. **Configuration before outcome.** A malformed binding beside a contract hole or an unknown binding throws, never `noContractIdentity` or `unresolvedBindings`. Invalid input must never become an authoring or binding outcome.
2. **Hole before unresolved bindings.** Section 1 defines `unresolvedBindings` only for a complete contract. A holed query with unknown bindings therefore gives `noContractIdentity` and does not list the bindings.
3. **Subject syntax is unspecified.** Any string without lone surrogates is accepted, including `""`, as query-bound selection accepts any string.
4. **Lone surrogates are rejected in the subject and in `known` bindings,** per CANONICALIZATION.md. The S3 checks accept them, so an evaluation could succeed for a binding that has no identity. Aligning the two is not done here.
5. **`unresolvedBindings` lists binding names only.** It does not list their causes, as in section 1 and X17. Whether emission needs the causes is the emission slice's decision.
