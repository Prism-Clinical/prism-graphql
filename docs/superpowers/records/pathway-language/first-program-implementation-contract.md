# First PPL program: minimal implementation contract

**Status:** Proposed implementation contract for the first compiler subset and the evaluation increments that follow it. Increment I1, the compiler and preview compiler, is implemented experimentally in [libs/pathway-language](../../../../libs/pathway-language/README.md). No evaluator exists yet, so nothing has been executed. The language-structure decisions P1–P8 (section 9) were approved by the user on 2026-10-05 for this subset and are reflected in Stage A and the minimal model. That approval leaves the broader documents’ status unchanged. No clinical question is answered, and the RFC, Stage A, the evidence-query contract, the GERD drafts and every delivery story keep their statuses.

**Date:** 2026-10-05. **Revised:** 2026-10-05, resolving P1–P8. Need generation is deferred, and the evaluator roadmap is split into bounded increments.

**Authority:**

- [RFC](../../specs/2026-09-28-pathway-language-rfc.md);
- [Stage A](../../specs/2026-09-30-pathway-language-stage-a-spec.md) §2.2–2.3, §4.1–4.5, §5, §6.3 and §10–11, amended 2026-10-05 for P1–P8;
- [minimal GERD language model](gerd-minimal-language-model.md);
- [evidence-query contract](evidence-query-to-predicate-contract.md), whose semantics, including Needs, are unchanged.

**Language direction.** PPL is one language, written as a typed JSON source model. It borrows CQL-inspired typed pure expressions over explicitly retrieved evidence, and restricted acyclic Datalog-style derivation: one defining rule per declaration over explicit references. It embeds no CQL or Soufflé program and uses neither runtime.

## 1. Problem

**Given:**

- a program source: [`gerd-progressive-dysphagia.ppl.json`](programs/gerd-progressive-dysphagia.ppl.json) or [`schematic-demo-finding.ppl.json`](programs/schematic-demo-finding.ppl.json), with an example’s `patch` applied;
- the pinned catalogues the program names: `demo-model@0.1` (fields per [CANONICALIZATION.md](conformance/explicit-assertion-v0/CANONICALIZATION.md)), the program’s `valueSets`, authority rule `demo-policy/same-source-amend@1` and policy `explicit-assertion-v0`;
- for evaluation, a frozen snapshot and an evaluation context in the explicit-assertion-v0 fixture `input` format.

**Produce** exactly the `expected` block of each [acceptance example](programs/examples/), from these entry points (Stage A §11.2):

```text
compile(source)                    -> CompileFailure{diagnostics} | CompiledPackage   (source: a parsed JSON value)
compilePreview(source)             -> CompileFailure{diagnostics} | PreviewPackage{markers}
evaluate(package, input)           -> per-declaration outputs, causeAttribution, trace
evaluatePreview(preview, input)    -> the same, with incomplete-authoring markers
```

## 2. Declarations, expression forms and context

Only what the two programs use. Anything else fails compilation with a named code (section 5). `sourceStatus`, `rationale`, `quote`, `label`, `heading` and `explains` are non-executable text.

| Declaration | Required fields | Output type |
|---|---|---|
| `EvidenceReference` | `id`, `file`, `sha256`, `lines`, `quote` | None. Provenance only; never affects a result and never creates an executable dependency |
| applicability (`Predicate`; the required top-level `applicability`) | `id`, `expr` (Decision) | `Decision`. A missing applicability is `SOURCE_INVALID` and is never defaulted |
| `EvidenceQuery` | `id`, `subject: "patient"` (the evaluation context’s subject), `output: "Evidence<Boolean>"`, `contract` | `Evidence<Boolean>` |
| `Predicate` | `id`, `expr` | `Decision` |
| `Finding` (Stage A §5, P4) | `id`, `status` (Decision), `label`; optional `heading`, `urgency`, `cites` | `status: Decision`; attributes |

Identifiers are unique strings. They must not start with `ctx.`; a violation is `INVALID_DECLARATION_ID`.

| Expression form | Allowed position | Operands | Result |
|---|---|---|---|
| `{"ref": id}` | Any Decision or Evidence position | `applicability`, a Predicate or an EvidenceQuery. A Finding is not referenceable in this subset | The target’s output type |
| `{"evidenceValue": E}` (P1) | `Predicate.expr` | `E : Evidence<Boolean>` | `Decision` |
| `{"all": [D₁ … Dₙ]}`, *n* ≥ 0 (P2) | applicability, `Predicate.expr`, `Finding.status` | each `Dᵢ : Decision` | `Decision` |
| `{"hole": {"id", "type", "explains", "cites"?}}` (P6) | applicability `expr` (`Decision`), `EvidenceQuery.contract` (`EvidenceSelectionContract<Boolean>`), `Finding.urgency` (`UrgencyRequirement`) | — | The declared `type`, which must equal the position’s type (else `TYPE_MISMATCH`). A missing or empty `explains` is `SOURCE_INVALID` |

**Inside an explicit-assertion-v0 contract only:** the contract has exactly the structure of [`q.demo.json`](conformance/explicit-assertion-v0/query/q.demo.json), and its fragment is the contract’s (§3.1, §2.2).

- Expression forms: `{"field": ["c", f]}`, `{"enum": "T.v"}`, `{"eq": [a, b]}` and `{"in": [...]}`.
- `admissible` rules are recognized by exact shape, as the S3 encounter check already does with `SAME_ENCOUNTER_RULE`: `encounter` and `episode` are `eq(c.f, ctx.f)`, and `assertionKind` is `in` over `AssertionKind` values.
- `establishes` and `refutes` are type-checked as `eq(c.assertion, AssertionValue.v)`; a cross-enum comparison is `TYPE_MISMATCH`.
- `disjoint(establishes, refutes)` holds for two such equalities with different literals. Equal literals give `EXCLUSIVE_BRANCH_OVERLAP`; any other form gives `UNSUPPORTED_PROOF_FRAGMENT`.
- Any other form in these positions is `UNSUPPORTED_CONSTRUCT`.

**Context bindings (P3).** `ctx.` is reserved for evaluation-context bindings.

| Context name | Type | Supported position in this subset |
|---|---|---|
| `ctx.episode` | `Known(EpisodeRef) \| Unknown(NonEmptySet<Cause>)` (contract §1.6) | Second operand of `contract.admissible.episode` |
| `ctx.encounter` | `Known(EncounterRef) \| Unknown(NonEmptySet<Cause>)` (contract §1.6, §2.4) | Second operand of `contract.admissible.encounter` |

Any other `ctx.` name, or a supported name in any other position, is `UNSUPPORTED_CONTEXT_REFERENCE`. The positional restriction is a capability limit of this subset, not a permanent rule of the language (Stage A §2.2).

`UrgencyRequirement` has no defined shape. In this subset its only legal value is a hole, and any other value is `UNSUPPORTED_CONSTRUCT`.

## 3. Semantics

**Dependencies and order (P5).** Authored references are the only executable dependencies (Stage A §2.2).

- Each `{"ref": id}` to a declaration is one edge, reader → read. `ctx.*` references are context bindings, not edges. `cites` are non-executable.
- There is no stored edge list, and an editor edits the references themselves.
- The derived graph must be acyclic, else `CYCLIC_EXECUTION_DEPENDENCY`. Evaluation follows any topological order, and no result may depend on tie-breaking.
- The examples state the derived edges (`dependencyEdges`), not an order.

**Expressions.**

- `evidenceValue` (contract §5.2):
  - `Known(true, ids)` → `True` with `supportingEvidenceIds = ids`;
  - `Known(false, ids)` → `False` with `ids`;
  - `Unresolved(C, cids)` → `Unknown(C)` with `candidateEvidenceIds = cids`.
- `all` (P2; Stage A §4.3):
  - any `False` operand gives `False`, supported by the union of the `False` operands’ supports;
  - else, any `Unknown` gives `Unknown` with the union of those operands’ causes and candidate IDs;
  - else `True`, supported by the union of all supports;
  - `all()` is `True` with empty support;
  - every operand’s trace is kept even when one operand decides.
- `Finding` (P4): its status is the value of `status`. Attributes are reported verbatim, and an attribute hole marks only that attribute.

**EvidenceQuery.** S1 → S2 → S3 → S4 → S5 → S6 of the evidence-query contract (§2) produce `Evidence<Boolean>`. S7 is the `evidenceValue` in the Predicate.

**Not in this slice: Need generation.** The first program reports unresolved patient evidence through:

- the query’s `Unresolved` causes;
- `causeAttribution`;
- the resulting predicate and finding states;
- the trace.

It does **not** generate Needs or any other acquisition request. The evidence-query contract’s Need and materiality semantics (§4.2 step B, §6.2) are unchanged and remain unimplemented. No simplified substitute is defined. Authoring holes never become patient-data requests in any mode (Stage A §2.3).

## 4. Output shape promised by the examples

| Field | Content | Comparison |
|---|---|---|
| `state` | `InvalidProgram`, `IncompleteAuthoring`, `UnresolvedPatientEvidence`, `EstablishedFalse` or `EstablishedTrue` (below) | Exact |
| `compile` | `outcome` (`Compiled` / `CompileFailure`), `wellFormed`, `diagnostics`, `dependencyEdges` | Outcome and `wellFormed` exact; diagnostics per section 5; edges as a set |
| `preview` | `null`, or `outcome`, `publication: "Blocked"`, `markers` (`{output, holes}`) and `inspectable` attributes | Exact; markers and holes as sets |
| `outputs` | Per declaration: `decision` / `evidence` (contract §5.1–5.2 shapes), or `marker: {holes}`, with `supportingEvidenceIds` / `candidateEvidenceIds`. A Finding has `status` and attribute entries | Exact; ID lists as sets, written in canonical order |
| `causeAttribution` | Contract format (`cause`, `origin`, `stage`, `reason`) | As a set |
| `trace` | One entry per evaluated output: `output`, `source` (JSON Pointer), `result`, `because` | `output`, `source`, `result` exact; `because` informative |

| `state` | Defined by | Consequences |
|---|---|---|
| **InvalidProgram** | Any structural diagnostic (section 5, every code except `UNRESOLVED_AUTHORING_HOLE`) | `compile` and `compilePreview` both fail; no outputs |
| **IncompleteAuthoring** | Well-formed with at least one hole | `compile` fails with `UNRESOLVED_AUTHORING_HOLE` only, one per hole, with `wellFormed: true`. `compilePreview` succeeds, dependents carry markers, and publication and clinical execution are blocked. Never a patient cause or a data request |
| **UnresolvedPatientEvidence** | Compiled; Finding status `Unknown(causes)` | Causes and attribution reported |
| **EstablishedFalse** | Compiled; Finding status `False` | Under explicit-assertion-v0 this needs an explicit refuting record and no relevant gap. Absence of records never yields it (PPL-03) |
| **EstablishedTrue** | Compiled; Finding status `True` | Supporting evidence IDs reported |

Successful compilation confers no clinical approval (P8).

## 5. Diagnostic contract (P7)

Each diagnostic has `code`, `location` (a JSON Pointer into the authored source, to the offending value), optional `hole` (for `UNRESOLVED_AUTHORING_HOLE`) and optional `message`. Machine comparison uses `code`, `location` and `hole`. `message` is explanatory prose and is never compared.

| Code | Source | Meaning | Location |
|---|---|---|---|
| `SOURCE_INVALID` | Added | Missing required field or top-level section (including `applicability`); a field of the wrong JSON shape; unsupported `languageVersion` or capability profile; hole without `explains` | The missing or malformed member (its parent for a missing one) |
| `UNKNOWN_EXECUTABLE_PROPERTY` | Added (Stage A §2.2 rule) | Unknown declaration kind, executable property or expression form | That property or form |
| `INVALID_DECLARATION_ID` | Added | Duplicate identifier, or one starting with `ctx.` | The `id` value |
| `UNDEFINED_REFERENCE` | Added | A `ref` or `cites` entry names no declaration or reference | The `ref` value or `cites` element |
| `TYPE_MISMATCH` | Added | An operand, hole or referenced output has the wrong type for its position (including cross-enum equality) | The operand or hole |
| `UNSUPPORTED_CONTEXT_REFERENCE` | Added | Unknown `ctx.` name, or a supported name outside its supported position (section 2) | The `ref` value |
| `UNSUPPORTED_CONSTRUCT` | Added | A recognized language construct outside this subset (e.g. another admissible-rule shape, or non-hole urgency) | The construct |
| `CYCLIC_EXECUTION_DEPENDENCY` | Stage A §10.4 | The derived dependency graph has a cycle | One `ref` on the cycle (the one with the smallest JSON Pointer) |
| `EXCLUSIVE_BRANCH_OVERLAP` | Stage A §10.4 | `disjoint(establishes, refutes)` has a witness (equal literals) | The `obligations` element |
| `UNSUPPORTED_PROOF_FRAGMENT` | Stage A §10.4 | `disjoint` cannot be analyzed for the written criteria | The `obligations` element |
| `UNRESOLVED_AUTHORING_HOLE` | Stage A §10.4 | A hole remains. Normal compilation only; not structural | The `hole` member |

These codes apply to authored first-program sources. The legacy explicit-assertion-v0 compilation fixtures (EA-051a/b, `code: null`) are not rewritten in this task.

## 6. Compilation versus evaluation

| Check | Phase |
|---|---|
| Required sections and fields, shapes, versions, `explains` present | Compile (`SOURCE_INVALID`). The compiler takes a parsed JSON value; text-level parsing, such as duplicate member names, is outside this subset |
| Known kinds, properties and forms; supported subset | Compile (`UNKNOWN_EXECUTABLE_PROPERTY`, `UNSUPPORTED_CONSTRUCT`) |
| Identifiers; `ref` and `cites` resolve; context names and positions | Compile (`INVALID_DECLARATION_ID`, `UNDEFINED_REFERENCE`, `UNSUPPORTED_CONTEXT_REFERENCE`) |
| Types, hole types, contract fragment, `disjoint` | Compile (`TYPE_MISMATCH`, `EXCLUSIVE_BRANCH_OVERLAP`, `UNSUPPORTED_PROOF_FRAGMENT`) |
| Acyclic derived edges | Compile (`CYCLIC_EXECUTION_DEPENDENCY`) |
| Holes | Compile: `UNRESOLVED_AUTHORING_HOLE` in normal mode, markers in preview mode |
| Citation digests and quotations against pinned files | Not in this compiler subset. `programs/check.py` checks them mechanically for now |
| Revision history, candidacy, admissibility, selection, criteria, sufficiency | Evaluate |
| `evidenceValue`, `all`, Finding status | Evaluate |
| Malformed patient data | Evaluate: patient evidence, never a compile error |

## 7. Preview (P8)

- `compilePreview` accepts structurally valid, correctly typed holes. Any structural diagnostic fails it, exactly as in normal compilation.
- An output is **marked** if and only if its defining expression contains a hole or references a marked output; its marker lists the union of those holes. Kleene composition never removes a marker (`all(False, marked)` stays marked).
- An attribute hole marks only that attribute (`f.alarm.urgency`).
- A marked EvidenceQuery runs no evidence stage (EA-050) and produces no patient cause.
- Unmarked outputs evaluate with ordinary patient-evidence semantics. Static attributes (`label`, `heading`, `cites`) stay inspectable.
- Markers are never patient uncertainty. Publication and clinical execution stay blocked whenever any hole exists.

## 8. Implementation sequence

Each increment is pure library code in `libs/pathway-language`. No increment hard-codes acceptance fixture IDs. Behavior outside an increment fails explicitly as unsupported and is reported as such, never as passing. A happy-path subset is never described as conformance to the full explicit-assertion-v0 policy.

| # | Input | Observable output | Acceptance | Reuses |
|---|---|---|---|---|
| **I1. Compiler (next)** | Program source with an example’s patch applied | `compile` / `compilePreview` results: diagnostics, `wellFormed`, derived edges, preview markers | The `compile` and `preview` blocks of PPL-01 to PPL-05b, plus one independent test per section 5 code (cycle, unknown property, reserved or duplicate ID, wrongly typed hole, unknown or misplaced `ctx.` reference, missing applicability, missing `explains`, non-hole urgency, overlapping `disjoint`) | `SAME_ENCOUNTER_RULE` and `canonicalJson` for exact-shape recognition, as the encounter check does |
| **I2. Program-expression execution, isolated** | A compiled or preview package, plus a typed `Evidence<Boolean>` supplied directly for each EvidenceQuery | `evidenceValue`, `all` and Finding outputs, with markers and trace | Kleene and support/cause unit tests. PPL-04’s `evaluatePreview` outputs (complete, since a marked query reads no evidence). PPL-01 to PPL-03 applicability, predicate and finding outputs, given those examples’ expected query evidence. **Isolated tests, not end-to-end pathway runs** | I1 |
| **I3. S3 admissibility** | S1 result, S2 parameters, the contract’s three `admissible` rules, context | Per possibility: per-rule outcomes, and combined admissibility for the combinations contract §2.2 defines | The `admissibility` trace facts of explicit-assertion-v0 fixtures that fall within the defined combinations; independent tests. One rule inadmissible while another is unresolved is deferred (contract §2.4) and fails explicitly | S1, S2, the encounter check |
| **I4. S4–S5** | I3 output, `establishes`, `refutes` | Selection (selected / unresolved / inadmissible keys); per-revision criterion values and classification | The `criterion`, `classification` and `possibleClasses` facts of explicit-assertion-v0 fixtures | I3 |
| **I5. S6** | I4 output, coverage, failures, rejected items | `Evidence<Boolean>` and `causeAttribution` per contract §4 (no Needs) | The `evidence`, `cell`, `gap`, `rule` and `causeAttribution` expectations of explicit-assertion-v0 evaluation fixtures. Fixtures outside the implemented behavior are listed as unsupported | I4 |
| **I6. End-to-end** | Program source plus a raw synthetic snapshot and context | Complete example outputs | PPL-01 to PPL-03 from raw inputs: true, false and missing evidence. PPL-04 preview (holes and inspectable attributes preserved). PPL-05a/b failures | I1–I5 |

## 9. Resolved design decisions for this subset (user-approved 2026-10-05)

| # | Decision | Applied in |
|---|---|---|
| P1 | Expression spelling `{"evidenceValue": …}`, as in the evidence-query contract. The minimal model’s `{"op": …, "arg": …}` example is updated; behavior is unchanged | Section 2; minimal model §5 |
| P2 | `all` takes zero or more Decision operands. `all()` is `True`; a nonempty `all` follows Kleene semantics; traces stay inspectable when one operand decides. An empty `all` is explicitly authored, never a default for an omitted applicability | Sections 2–3; Stage A §4.3 |
| P3 | `ctx.` is reserved for context bindings: declaration IDs cannot use it, and supported names are typed. In this subset, context references are allowed only at the listed contract positions, as a capability limit; anything else is rejected with `UNSUPPORTED_CONTEXT_REFERENCE` | Section 2; Stage A §2.2 |
| P4 | Finding is an explicit declaration kind: stable ID, Decision-valued status, explanatory attributes, citations. It reports what the pathway establishes, independently of any Recommendation or action. An attribute hole does not invalidate an evaluable status. Urgency is supported only as a typed hole. Clinical urgency, finalization effects and actions are undefined | Sections 2–3; Stage A §5; minimal model §1.1 item 3, §7 decision 3 |
| P5 | Authored references are the only executable dependencies. Edges are derived from them, an editor may edit them, and there is no second authoritative edge list. Citations and other relationships are non-executable | Section 3; Stage A §2.2; minimal model §1.1 item 4, §7 decision 4 |
| P6 | Holes in authored source require `explains`, with identity, expected type and location preserved. An explanation records what is undecided and supplies no executable meaning. Lower-level fixtures with holes (e.g. EA-050’s inline hole) are not thereby complete authored programs, and no clinical interpretation was added to satisfy the requirement | Section 2; Stage A §2.3 |
| P7 | Stable named diagnostic codes, using Stage A’s where they exist and adding the smallest set (section 5). Prose is separate from compared codes. PPL-05a/b now use `UNDEFINED_REFERENCE` and `TYPE_MISMATCH`; legacy fixtures are unchanged | Section 5; Stage A §10.4 |
| P8 | Normal compilation rejects holes with `UNRESOLVED_AUTHORING_HOLE` while a hole-only program stays `wellFormed: true`. Preview accepts correctly typed holes with markers. Structural errors fail both modes. Markers are distinct from patient uncertainty. Unfinished programs stay blocked, and compilation confers no clinical approval | Sections 4, 7; Stage A §2.3 |

**Removed from the first-program scope:** `evidenceNeed`, which was an output keyed on “a requested output depends on the query”. That rule and the field are gone from this contract and from the examples (section 3).
