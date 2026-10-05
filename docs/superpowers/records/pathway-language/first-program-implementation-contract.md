# First PPL program: minimal implementation contract

**Status:** Proposed. **Not** accepted, not a schema, not implemented. It specifies the first compiler and evaluator for the two programs in [programs/](programs/README.md), and nothing more. No clinical question is answered, and the RFC, Stage A, the contract, the GERD drafts and every delivery story keep their statuses.

**Date:** 2026-10-05. **Authority:** [RFC](../../specs/2026-09-28-pathway-language-rfc.md) and [Stage A](../../specs/2026-09-30-pathway-language-stage-a-spec.md) (§2.2–2.3, §4.1–4.5, §5, §6.3, §10–11). It also builds on the [minimal GERD language model](gerd-minimal-language-model.md) and the [evidence-query contract](evidence-query-to-predicate-contract.md). Section 9 lists where this document has to choose between them.

**Language direction.** PPL is one language, written as a typed JSON source model. It borrows CQL-inspired typed pure expressions over explicitly retrieved evidence, and restricted acyclic Datalog-style derivation: one defining rule per declaration over explicit references. It embeds no CQL or Soufflé program and uses neither runtime.

## 1. Problem

**Given:**

- a program source: [`gerd-progressive-dysphagia.ppl.json`](programs/gerd-progressive-dysphagia.ppl.json) or [`schematic-demo-finding.ppl.json`](programs/schematic-demo-finding.ppl.json), with an example’s `patch` applied;
- the pinned catalogues the program names: `demo-model@0.1` (fields per [CANONICALIZATION.md](conformance/explicit-assertion-v0/CANONICALIZATION.md)), the program’s `valueSets`, authority rule `demo-policy/same-source-amend@1` and policy `explicit-assertion-v0`;
- for evaluation, a frozen snapshot and an evaluation context in the explicit-assertion-v0 fixture `input` format.

**Produce** exactly the `expected` block of each [acceptance example](programs/examples/), from these entry points (Stage A §11.2):

```text
compile(source)                    -> CompileFailure{diagnostics} | CompiledPackage
compilePreview(source)             -> CompileFailure{diagnostics} | PreviewPackage{markers}
evaluate(package, input)           -> per-declaration outputs, causeAttribution, evidenceNeed, trace
evaluatePreview(preview, input)    -> the same, with incomplete-authoring markers
```

## 2. Declarations and expression forms required

Only what the two programs use. Any other executable property or kind is a compile error (Stage A §2.2). `sourceStatus`, `rationale`, `quote`, `label` and `heading` are non-executable text.

| Declaration | Required fields | Output type |
|---|---|---|
| `EvidenceReference` | `id`, `file`, `sha256`, `lines`, `quote` | none (provenance only; never affects a result) |
| applicability (`Predicate`, exactly one, top-level `applicability`) | `id`, `expr` (Decision) | `Decision` |
| `EvidenceQuery` | `id`, `subject: "patient"`, `output: "Evidence<Boolean>"`, `contract` | `Evidence<Boolean>` |
| `Predicate` | `id`, `expr` | `Decision` |
| `Finding` (proposed kind, minimal model §1.1 item 3) | `id`, `status` (Decision), `label`; optional `heading`, `urgency`, `cites` | `status: Decision`; attributes |

| Expression form | Allowed position | Operands | Result |
|---|---|---|---|
| `{"ref": id}` | Any Decision or Evidence position | `applicability`, a Predicate or an EvidenceQuery. A Finding is not referenceable in this slice | The target’s output type |
| `{"evidenceValue": E}` | `Predicate.expr` | `E : Evidence<Boolean>` | `Decision` |
| `{"all": [D₁ … Dₙ]}`, *n* ≥ 0 | applicability, `Predicate.expr`, `Finding.status` | each `Dᵢ : Decision` | `Decision` |
| `{"hole": {"id", "type", "explains", "cites"?}}` | applicability `expr` (`Decision`), `EvidenceQuery.contract` (`EvidenceSelectionContract<Boolean>`), `Finding.urgency` (`UrgencyRequirement`) | — | The declared `type`, which must equal the position’s type |

**Inside an explicit-assertion-v0 contract only:** the contract has exactly the structure of [`q.demo.json`](conformance/explicit-assertion-v0/query/q.demo.json), and its fragment is the contract’s (§3.1, §2.2).

- Expression forms: `{"field": ["c", f]}`, `{"enum": "T.v"}`, `{"eq": [a, b]}`, `{"in": [...]}` and `{"ref": "ctx.x"}`.
- `admissible` rules are **recognized by exact shape**, as the S3 encounter check already does: `encounter` and `episode` are `eq(c.f, ctx.f)`, and `assertionKind` is `in` over `AssertionKind` values.
- `establishes` and `refutes` are type-checked as `eq(c.assertion, AssertionValue.v)`. A cross-enum comparison fails (EA-051a).
- `disjoint(establishes, refutes)` holds for two such equalities with different literals.
- Any other form in these positions is unsupported in this slice and fails compilation explicitly.

`UrgencyRequirement` has no defined shape (minimal model §7, decision 3). In this slice its only legal value is a hole.

## 3. Semantics

**Dependencies and order.** Each `{"ref": id}` outside a query contract is one edge, reader → read. `ctx.*` references inside a contract are context bindings, not edges. There is no stored edge list.

- The graph must be acyclic; otherwise compilation fails with `CYCLIC_EXECUTION_DEPENDENCY` (Stage A §6.3, §10.4).
- Evaluation follows any topological order, and no result may depend on tie-breaking.
- The examples state the derived edges (`dependencyEdges`), not an order.

**Expressions.**

- `evidenceValue`, following contract §5.2:
  - `Known(true, ids)` → `True` with `supportingEvidenceIds = ids`;
  - `Known(false, ids)` → `False` with `ids`;
  - `Unresolved(C, cids)` → `Unknown(C)` with `candidateEvidenceIds = cids`.
- `all`, Kleene and n-ary (Stage A §4.3), with no short-circuit loss of traces:
  - any `False` operand gives `False`, supported by the union of the `False` operands’ supports;
  - else, any `Unknown` gives `Unknown` with the union of those operands’ causes and candidate IDs;
  - else `True`, supported by the union of all supports;
  - `all()` is `True` with empty support.
- `Finding`: its status is the value of `status`. `label` and `heading` are reported verbatim, and an attribute hole marks only that attribute.

**EvidenceQuery.** S1 → S2 → S3 → S4 → S5 → S6 of the contract (§2) produce `Evidence<Boolean>`. S7 is the `evidenceValue` in the Predicate.

**`evidenceNeed`.** It is `{query, causes}` when a complete query is `Unresolved` and a requested output depends on it; otherwise it is `null`. The Finding is the requested output in every example. A hole never produces one. The Need key and obligations of contract §6.2 are not promised by this slice.

## 4. Output shape promised by the examples

| Field | Content | Comparison |
|---|---|---|
| `state` | `InvalidProgram`, `IncompleteAuthoring`, `UnresolvedPatientEvidence`, `EstablishedFalse` or `EstablishedTrue` (below) | Exact |
| `compile` | `outcome` (`Compiled` / `CompileFailure`), `wellFormed`, `diagnostics` (`code`, `location` as a JSON Pointer into the program, plus `hole` or `violation`), `dependencyEdges` | Outcome, `wellFormed`, codes (`null` means any code), locations, hole IDs exact; diagnostics and edges as sets; `violation` text informative |
| `preview` | `null`, or `outcome`, `publication: "Blocked"`, `markers` (`{output, holes}`) and `inspectable` attributes | Exact; markers and holes as sets |
| `outputs` | Per declaration: `decision` / `evidence` (contract §5.1–5.2 shapes), or `marker: {holes}`, with `supportingEvidenceIds` / `candidateEvidenceIds`. A Finding has `status` and attribute entries | Exact; ID lists as sets, written in canonical order |
| `causeAttribution` | Contract format (`cause`, `origin`, `stage`, `reason`) | As a set |
| `evidenceNeed` | `{query, causes}` or `null` | Exact |
| `trace` | One entry per evaluated output: `output`, `source` (JSON Pointer), `result`, `because` | `output`, `source`, `result` exact; `because` informative |

| `state` | Defined by | Consequences |
|---|---|---|
| **InvalidProgram** | A structural error: undefined read, type mismatch, cycle, unsupported or unknown executable form | `compile` and `compilePreview` both fail; no outputs, no Needs |
| **IncompleteAuthoring** | Well-formed with at least one hole | `compile` fails only with `UNRESOLVED_AUTHORING_HOLE`, one per hole. `compilePreview` succeeds, dependents carry markers, and publication is blocked. Never a patient cause or a Need |
| **UnresolvedPatientEvidence** | Compiled; Finding status `Unknown(causes)` | Causes and attribution reported; `evidenceNeed` when material |
| **EstablishedFalse** | Compiled; Finding status `False` | Under explicit-assertion-v0 this needs an explicit refuting record and no relevant gap. Absence of records never yields it (PPL-03) |
| **EstablishedTrue** | Compiled; Finding status `True` | Supporting evidence IDs reported |

## 5. Reuse and gaps

**Reusable now** (`libs/pathway-language`):

- `experimentalResolveRevisionHistory` (S1);
- `experimentalIdentifyCandidates` (S2);
- `experimentalCheckEncounterScope` (the S3 encounter rule; it runs S2 on the supplied S1, so stages cannot mix snapshots);
- `retainedPayload`;
- the RFC 8785 library;
- the explicit-assertion-v0 fixtures and runner.

**Unimplemented:**

| Area | Missing |
|---|---|
| Compiler | Everything: parsing and schema checks, reference resolution, typing, edge derivation and cycle check, hole collection, preview lowering, package output |
| S3 | The `episode` and `assertionKind` rules, and combining rule outcomes. Only the defined combinations are in scope: all admissible; one rule unresolved; one rule inadmissible. One rule inadmissible while another is unresolved is deferred (contract §2.4), so it must fail explicitly as unsupported, never with a guessed result |
| S4–S6 | Selection; `establishes`/`refutes` evaluation; coverage cells, gaps and relevance; rules 1–5; materiality; `candidateEvidenceIds` |
| Program level | `evidenceValue`, `all`, Finding, markers, `evidenceNeed` |

## 6. Compilation versus evaluation

| Check | Phase |
|---|---|
| JSON parses; known declaration kinds and executable properties; exactly one applicability; unique IDs | Compile |
| Every `ref` resolves; `ctx.*` only inside a contract; citations resolve | Compile |
| Types: expression operands, hole type equals position type, contract fragment (incl. cross-enum `eq`), `disjoint` obligation | Compile |
| Acyclic derived edges | Compile |
| Holes: `UNRESOLVED_AUTHORING_HOLE` in `compile`; markers in `compilePreview` | Compile |
| Citation digest and quotation match | Compile (pinned-catalogue resolution, Stage A §10.1 step 2) |
| Revision history, candidacy, admissibility, selection, criteria, sufficiency | Evaluate |
| Kleene composition, Finding status, `evidenceNeed` | Evaluate |
| Malformed patient data | Evaluate: patient evidence, never a compile error |

## 7. Preview

This is this contract’s reading of Stage A §2.3.

- An output is **marked** if and only if its defining expression contains a hole or references a marked output. Its marker lists the union of those holes.
- Kleene composition never removes a marker. `all(False, marked)` stays marked, because a dependent preview output retains its markers.
- An attribute hole marks only that attribute (`f.alarm.urgency`), not the status.
- A marked EvidenceQuery runs no evidence stage (EA-050) and emits no Need.
- Unmarked outputs evaluate with ordinary patient-evidence semantics, and static attributes (`label`, `heading`, `cites`) stay inspectable.
- Publication is blocked whenever any hole exists, whether or not a scenario reaches it.

## 8. Next stories

**Compiler story (smallest).** Given a program source and an example patch, `compile` and `compilePreview` produce exactly the `compile` and `preview` blocks of PPL-01 to PPL-05b.

- Scope: sections 2, 3 (edges only), 6 (compile rows) and 7 (marker sets are static).
- Location: pure functions in `libs/pathway-language`, with no new dependency.
- Acceptance: the six example files, plus independent tests for a cycle, an unknown executable property, a hole of the wrong type, `ctx.*` outside a contract, and a second applicability.
- Out of scope: IR wire format, manifests and evaluation.

**Evaluator story (next).** Given the compiled schematic package and the inputs of PPL-01 to PPL-03, `evaluate` produces exactly their `outputs`, `causeAttribution`, `evidenceNeed` and trace `output`/`source`/`result`. Given PPL-04’s preview package and input, `evaluatePreview` produces its outputs.

- Scope: the rest of S3 (defined combinations only), S4–S6 for explicit-assertion-v0, `evidenceValue`, `all`, Finding and `evidenceNeed`.
- Regression: the fixture runner also compares `evidence`/`decision` for every explicit-assertion-v0 evaluation fixture. It lists any fixture the evaluator does not support as unsupported, never as passing.

## 9. Conflicts between documents, and proposed resolutions

Each item is a **proposal** for review. None silently replaces settled semantics.

| # | Conflict (concrete) | Proposed smallest resolution |
|---|---|---|
| P1 | The minimal model §5 writes `{"op": "evidenceValue", "arg": {"ref": "q.pd"}}`; contract §7.1 and its fixtures write `{"evidenceValue": {"ref": "q.demo"}}` | Use the contract form. Operator-as-key matches `all`, `eq`, `in` and `hole` |
| P2 | Stage A §4.3 gives binary truth tables; the minimal model §2 uses `all()` = True for empty groups | `all` is n-ary with `all()` = True. That is the extension the minimal model already uses; it gives explicit unconditional applicability without a new literal |
| P3 | `ref` names declarations (`q.demo`) and, inside contracts, context bindings (`ctx.episode`), with no stated namespace | `ctx.` is reserved: declaration IDs may not start with it, and `ctx.*` is legal only inside a query contract |
| P4 | Finding is not a Stage A §5 node kind; the minimal model proposes it | Use it as proposed, with status and attributes only. Still open: node versus attribute group, and the `UrgencyRequirement` shape |
| P5 | Stage A §2.2 lets drawn edges and textual bindings both lower to edges; the minimal model §1.1 item 4 makes `ref` the only authored form | Use `ref` only, as proposed. The Stage A amendment remains open |
| P6 | Stage A §2.3 requires a hole explanation; EA-050’s inline hole has none | Program source requires `explains`. Fixture holes are unchanged |
| P7 | Stage A §10.4 lists no code for an undefined read or an operand type mismatch | `code: null` with a located diagnostic, as EA-051 does. Codes are fixed later with §10.4 |
| P8 | Whether `compile` of a holed draft fails or yields an unpublishable package | It fails, with `wellFormed: true` and only `UNRESOLVED_AUTHORING_HOLE` diagnostics. Only `compilePreview` accepts holes (Stage A §10.1, §11.1) |
