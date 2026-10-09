# Minimal PPL model: GERD progressive-dysphagia alarm

**Status:** Proposed language-design draft. **Not** finalized syntax, not a schema, not an implementation and not clinical approval. No clinical question (Q1–Q14, A1–A3) is answered here. L00.1.a remains open.

**Date:** 2026-10-03. **Revised:** 2026-10-05, applying the user-approved first-program decisions P1, P4 and P5 ([first-program implementation contract](first-program-implementation-contract.md) §9). P1 sets the `evidenceValue` spelling, P4 accepts Finding as a declaration kind, and P5 makes references the authoritative dependencies. No clinical question is affected. Earlier: 2026-10-03, after two design reviews; the second settles the established-alarm/unknown-scope behavior (6.1). The first review’s changes: the evidence criterion must be a visible typed expression; holes may be whole or partial; the finding is its own declaration with explicit scope; each dependency has one authoritative representation; unresolved causes are preserved.

**Authority:** [RFC](../../specs/2026-09-28-pathway-language-rfc.md) (accepted architecture) and [Stage A](../../specs/2026-09-30-pathway-language-stage-a-spec.md) (draft contracts). Where this draft and Stage A disagree, Stage A governs until it is explicitly revised; disagreements are listed in section 7.

**Clinical inputs (unadjudicated):** [interpretation draft](gerd-progressive-dysphagia-interpretation-draft.md) and [Q1–Q3 review packet](gerd-progressive-dysphagia-q1-q3-review.md).

**Problem:** Given a source passage relating progressive dysphagia to immediate evaluation, define the smallest PPL fragment that represents the condition, its evidence requirements, the proposed action, their relationship and the unresolved authored meaning, without inventing clinical definitions.

## 0. Source

| Item | Value |
|---|---|
| File | [corpus/GERD-Pregnancy-Care-Pathway.txt](corpus/GERD-Pregnancy-Care-Pathway.txt) |
| SHA-256 | `937859b9b22f672e4d212cdd99b188f1e1d12b6cd4217459155d2c34a8f67032` ([manifest](corpus/manifest.json); recomputed 2026-10-03, matches) |
| Line 85 | `ALARM SYMPTOMS REQUIRING IMMEDIATE EVALUATION:` |
| Line 86 | `• Progressive dysphagia (particularly solids before liquids)` |
| Manifest status | “Design inputs; not approved clinical guidance” |

Related wording (lines 288 “dysphagia”, 298 “Refractory dysphagia”, 375–376 “progressive dysphagia to solids … urgent indication for endoscopy”) is context only. This model represents line 86 under the line 85 heading, nothing else.

## 1. Minimal declarations

Every declaration reuses a Stage A §5 node kind or a §4.5/§6.2 contract. The finding kind was proposed here and has since been accepted into Stage A §5 (2026-10-05). Section 1.1 justifies it and two other bounded changes.

| Declaration | Purpose | Inputs → outputs | Required information | May remain unresolved while drafting |
|---|---|---|---|---|
| **Pathway applicability** (Predicate, Stage A §4.5) | States the population/encounter scope in which this alarm rule applies | Declared evidence reads → `Decision` *A* | Must be declared; an unconditional scope must be written explicitly | The whole expression (A1, A2, Q14) as a hole of type `Decision` |
| **Symptom assessment** (EvidenceQuery, §4.4, §4.6) | Says which recorded evidence can establish that progressive dysphagia is present, or explicitly absent, for this question | Frozen evidence snapshot + coverage → `Evidence<Boolean>`, candidate assessments, acquisition Needs | Subject binding; output type; a selection contract (§4.4). Once written, the contract’s establishing criterion is a supported typed expression over the retrieved candidates, or a reference to a versioned library declaration (1.1) | The whole selection contract as one hole (today’s state, Q1–Q7, A2, A3), or a partly written contract with nested holes |
| **Alarm predicate** (Predicate, §5, §2.4) | Turns the assessment into the clinical condition used by the rule | `Evidence<Boolean>` → `Decision` (lifted projection, §2.4) | Exactly one input reference | Nothing. It is fully defined language behavior; its meaning depends on the query contract |
| **Alarm finding** (declaration kind accepted 2026-10-05; see 1.1) | Surfaces an established alarm independently of what happens to the proposal (§8.3), within the pathway’s scope | *A*, alarm `Decision` → finding status `Decision` + attributes (label, citation, urgency requirement) | Status expression `all(A, alarm)`; source label quoted verbatim; citation | The urgency attribute (Q12, Q13) as a hole. A hole in an attribute does not make the status incomplete |
| **Evaluation proposal** (Recommendation, §5, §6.2, §8) | Proposes the source’s “evaluation” for clinician review | *A* (compiler-bound), `I_local`, *P*, *X* → base eligibility, `ActionProposal`, disposition | Explicit indication; explicit prerequisite and exclusion groups (empty groups written); review requirement; action; §7.2 timing attributes | Action definition (Q8–Q10) and timing for “immediate” (Q11–Q12) as holes |
| **Source citation** (EvidenceReference, §5) | Pins the passage to each executable declaration | — → provenance and review obligations | File, SHA-256, line range | Nothing |

Not declared: Choice (no alternatives), Group (no executable meaning), an authored Need node (Needs are generated by the query, §7), DerivedValue (no calculation), workflow/acquisition strategy (orchestrator-owned, §7).

### 1.1 Proposed changes and why this example needs them

1. **Holes in contract and action positions, at whatever granularity the author knows.** Stage A §2.3 illustrates a hole for an unresolved threshold. Here the unresolved meaning is *what evidence counts* (Q1–Q7) and *what the action is* (Q8–Q11). The proposal allows a hole wherever a typed contract or action is expected, keeping the §2.3 hole mechanism unchanged: identity, expected type, AST location, explanation and citations. An author may leave a whole selection contract as one hole and refine it later into a partly written contract with nested holes. Each hole stays visible and blocks publication, and nested holes must type-check against the contract structure. This draft does not fix a list of new slot types. The contract’s parts are whatever Stage A §17 item 4 fixes for §4.4 selection contracts.
2. **The evidence criterion stays visible.** A selection contract’s establishing criterion is not a named box that hides evaluator logic. Once written, it must be one of two things: a typed expression in the supported fragment, built from terminology membership, enum equality, `all`/`any`/`not` and bounded filtering over typed candidate fields, or a reference to a versioned library declaration built the same way (§2.1). Prose, callbacks and opaque classifiers are rejected. Until written, it is a hole of type `Decision` over one candidate, an existing type. This follows CQL’s boundary between data access and logic. In CQL, “the data requirements of a particular artifact can be clearly and accurately defined by inspecting only the Retrieve expressions defined within the artifact” ([Language Semantics](https://cql.hl7.org/N1A/05-languagesemantics.html)), and the conditions applied to retrieved data are ordinary expressions.
3. **A finding declaration, separate from its attributes and from disposition.** Stage A §8.3 and RFC §6 require established urgent findings to remain visible independently of disposition, and §6.5 treats “independently meaningful findings” as analysis roots. Stage A §5 had no declaration for one; Finding is now an accepted declaration kind (Stage A §5, amended 2026-10-05). The finding has a status expression and attributes. The status is `all(A, alarm)`. Independence from disposition is not independence from scope, so applicability is an explicit input. Holes in attributes (urgency, or the linked action) mark only those attributes, so an established finding stays inspectable while its urgency is still undefined. When the status is `Unknown` only because *A* is `Unknown`, the component results are not erased: the alarm’s `True` value with its supporting evidence and *A*’s `Unknown` with its reasons remain separate outputs (section 6.1). This needs no fourth truth value; it follows the existing rule to retain predicate values and traces when the combined result differs (Stage A §4.3, §5, §11.4).
4. **One authoritative representation per dependency.** References written inside expressions (`ref`) are the only editable definition of a dependency. The graph edges in section 2 are derived from them. Drawing a connection in the editor edits the reference, and deleting it removes the reference. Edges are not stored separately. Stage A §2.2 previously let drawn connections and textual bindings both lower to canonical edges and diagnosed conflicts between them. It is amended accordingly (2026-10-05): with one source of truth, that consistency check disappears for authored source.

None of these changes introduces quantities, temporal arithmetic, recursion or inference.

## 2. Minimal relationships

All rows except the compiler-bound applicability row are **derived** from references in the declarations; none is authored separately.

| Relationship (Stage A §6.1) | Derived from | Endpoints and direction | Meaning | Type / cardinality constraint |
|---|---|---|---|---|
| `binds` | `p.alarm.expr` → `ref q.pd` | Symptom assessment `.value` → alarm predicate input | The predicate reads exactly this evidence | `Evidence<Boolean>`; exactly one |
| `binds` | `f.alarm.status` → `ref applicability`, `ref p.alarm` | *A*, alarm `Decision` → finding status | The finding holds only within scope | `Decision`, `Decision`; one each |
| `indicates` | `r.evaluation.indication` → `ref p.alarm` | Alarm predicate → proposal `I_local` | The alarm is the local indication | `Decision`; composition written explicitly (`all` over one operand) |
| compiler-bound applicability (§4.5, §6.2) | Compiler | *A* → proposal *I* = `all(A, I_local)` | Scope dependency; not authorable or omittable | Exactly one per pathway; visible in IR and trace |
| `cites` | `cites` field of each declaration | Declaration → source citation | Provenance and review identity only | Never changes eligibility; changing it changes reviewed artifact identity (§2.3, §19.1) |

```text
frozen evidence ──► Symptom assessment ──binds──► Alarm predicate ──indicates──► Evaluation proposal
                         │ Evidence<Boolean>            │ Decision                    │ I = all(A, I_local)
                         └─► Needs (if material)        │                             │ P = all() = True
                                                        ▼                             │ X = any() = False
Applicability A ──────────────────────────────► Alarm finding = all(A, alarm)          │
          └──────────────────────(compiler-bound)─────────────────────────────────────┘
```

The executable dependency graph has five executable declarations and five edges, and it is acyclic (§6.3). The finding reads the predicate, not the proposal, so no disposition can affect it. No `requires`, `excludes`, `candidate_of`, `selects` or `fulfilled_by` edge is authored. `fulfilled_by` arises only at runtime, when recorded evidence answers a generated Need. Layout and grouping live in the presentation section and cannot create or reorder a dependency (§2.2). Evaluation order is the compiler’s topological order, not drawing order.

## 3. How the language foundations contribute

**CQL inspiration (pinned comparison baseline: CQL 1.5.3).** A PPL evidence query, like a CQL retrieve, is a declarative typed request for clinical data by terminology. It is the only point where the rule touches data, and the logic applied to the retrieved candidates stays an ordinary visible expression (1.1, item 2). The [CQL Author’s Guide](https://cql.hl7.org/N1A/02-authorsguide.html) notes that “because CQL uses three-valued logic, the result of evaluating any given boolean-valued condition may be unknown (null)”. The [CQL reference](https://cql.hl7.org/N1A/09-b-cqlreference.html) defines `and`, `or` and `not` with exactly the Kleene truth tables used by Stage A §4.3. CQL is “pure functional, meaning no operations are allowed to have side effects” ([Language Semantics](https://cql.hl7.org/N1A/05-languagesemantics.html)), matching the PPL purity invariant.

PPL deviates where CQL’s missing-information model is too coarse for Prism. CQL represents missing information as a single `null`. Its `exists` “returns true if the list contains any non-null elements. If the argument is null, the result is false”, so an empty retrieve yields `false`. In PPL, an empty query result is `Unresolved(Missing)` unless the query’s coverage contract establishes a scoped negative (Stage A §4.2). Unknown carries a typed cause set, not a bare null.

**Datalog inspiration (Soufflé as reference).** The [Soufflé tutorial](https://souffle-lang.github.io/tutorial) declares typed relations (`.decl edge(a:symbol, b:symbol)`; “a relation must be declared in order to be able to be used”) and derives facts with `head :- body` rules. PPL adopts typed declared relations for program structure: `binds`, `indicates` and `cites` are typed relations over declared ports, derived from references and checkable by the compiler. Each executable declaration is one non-recursive defining rule over its explicit inputs: `alarm(s) ⇐ assessment(s)`, `finding(s) ⇐ all(A(s), alarm(s))` and `I_local(proposal, s) ⇐ alarm(s)`.

PPL does not adopt two Soufflé features. First, recursive rules: Soufflé’s transitive-closure example derives `reachable` recursively, but PPL patient-time derivation is acyclic. Second, Soufflé negation `!Heritage(building)` tests that a tuple is not in a relation, and “rules involving negation must be stratifiable” ([Soufflé rules](https://souffle-lang.github.io/rules)). That is absence-as-negation. PPL `not` applies only to an explicit `Decision` value, so `not(Unknown) = Unknown`. Soufflé’s [provenance facility](https://souffle-lang.github.io/provenance) is a model for explanation traces, not their contract.

**Prism contracts.** Applicability is mandatory: the compiler binds it into indication (§4.5, §6.2), and the finding references it explicitly. Indication, prerequisite and exclusion stay separate, and the disposition reducer (§8) yields *proposed*, *not applicable* or *unresolved*, with review still required. Evidence uncertainty uses typed causes (§4.1). Needs come only from material unresolved patient evidence under a complete query contract (§7). Typed holes and preview mode express incomplete authoring (§2.3, §11.2). Neither CQL nor Datalog supplies these behaviors.

### 3.1 Adopt, adapt or Prism-specific

| Concept needed here | Reference-language concept | Adopted behavior | Restriction or deviation | Why needed |
|---|---|---|---|---|
| Typed symptom-evidence request | CQL retrieve `[Condition: code in "…"]` returning a list | Declarative, typed, terminology-based query; the only data-access point | **Adapt:** returns `Evidence<Boolean>` with coverage and causes, not a list; selection contract is explicit (§4.4) | A list cannot distinguish an empty chart from a documented negative |
| Establishing criterion | CQL expressions applied to retrieved data, separate from the retrieve | **Adopt** the boundary: the criterion is a visible typed expression or a versioned library reference | Supported fragment only; no prose, callbacks or classifiers (1.1, item 2) | Keeps clinical reasoning inspectable instead of hiding it in an abstraction |
| Alarm predicate result | CQL `and`/`or`/`not` truth tables | **Adopt** Kleene three-valued composition | Unknown carries `NonEmptySet<Cause>` and trace instead of `null` | “Not assessed” must stay distinct from “absent” |
| Unknown propagation | CQL null propagation (“operations are defined to result in null if any of their arguments are null”) | **Adopt** lifting through the projection | Causes preserved; no CQL nullological operators (`Coalesce`, `IsNull`) exposed in v0 | Prevents silent coercion of unknown to false |
| Explicit negative | CQL `exists` (false on empty or null) | — | **Deviate:** emptiness yields `Unresolved(Missing)` unless a scoped coverage or explicit-negative rule applies (§4.2, diagnostic `UNSUPPORTED_NEGATIVE_EVIDENCE`) | Source and draft require that an empty chart is not an explicit negative |
| Purity | CQL “pure functional” | **Adopt** | — | Determinism and replay |
| Declared connections | Soufflé `.decl` typed relations | **Adopt** typed, declared relations for edges and ports | Fixed relation catalogue (§6.1); edges derived from references; authors cannot declare relation kinds | Compiler-checkable endpoints and cardinality |
| Derivation of alarm, finding and indication | Soufflé `head :- body` rules | **Adapt:** one defining rule per declaration over explicit inputs | Non-recursive, acyclic, one definition per output; no recursion, although Soufflé supports it | Bounded, explainable evaluation |
| “Not established” | Soufflé `!R(x)` (membership negation, stratified) | — | **Deviate:** no negation-as-failure; `not` only over explicit `Decision` (RFC §5) | Missing fact ≠ clinical absence |
| Explanation | Soufflé provenance | Inspiration for proof-like traces | Explanations follow Stage A §11.4, not a minimal proof tree | Reviewable rationale |
| Applicability, indication, *P*, *X*, disposition | — | — | **Prism-specific** (§4.5, §6.2, §8) | Separates scope, indication and the “proposed ≠ ordered” rule |
| Uncertainty causes and Needs | — | — | **Prism-specific** (§4.1, §7) | Turns material missing evidence into a traceable request |
| Typed holes and preview | — | — | **Prism-specific** (§2.3), extended to contract and action positions at author-chosen granularity (1.1) | Represents open clinical meaning without inventing values |
| Finding with attributes | — | — | **Prism-specific** declaration kind, accepted 2026-10-05 (1.1, §8.3) | Alarm stays visible within scope, independently of disposition and of undefined attributes |

## 4. Failure and incompleteness states

| State | Example in this model | Validation | Preview | Patient-data Needs | Publication | Clinical execution |
|---|---|---|---|---|---|---|
| **Complete program, insufficient patient evidence** | All holes filled (hypothetically); no admissible assessment, retrieval failure, only inadmissible candidates, or conflict | Passes | Assessment `Unresolved(causes)` with the actual causes; alarm and finding `Unknown`; proposal *unresolved* | **Yes**, when material: a stable Need whose kind follows the cause (section 6, rows 3a–3d) | Not blocked by this state | Runs; result is a valid unresolved outcome; finalization of the requested scope is blocked by the material Need (§8.3) |
| **Authoring hole** | Today’s draft: whole selection contract, action, timing, urgency and applicability are holes | Well-formed draft; `UNRESOLVED_AUTHORING_HOLE` diagnostics with hole IDs | Only via `compilePreview`. Outputs that depend on a hole carry incomplete-authoring markers, even for patients whose chart looks positive. Outputs that do not depend on one remain inspectable (section 6, row 4) | **None for the hole.** A Need’s identity requires a defined evidence type, scope and window (§7), so a holed contract cannot request patient data, and no provider field is offered | Rejected (§2.3), including holes in branches that no scenario reaches | Impossible: no clinical package exists; preview artifacts are rejected by the clinical loader (§11.1) |
| **Structurally invalid program** | Section 6, row 6 (cycle); a wrong-type reference; missing applicability; an unknown executable property; prose where a criterion expression is required | Fails with a located diagnostic | None: `compilePreview` also fails (§10.1) | None | Rejected | Impossible |

The first and second rows must stay distinguishable in every output (§11.4). The first is a finished rule whose answer for *this patient* is not yet known. The second is an unfinished rule whose meaning is not yet known for *any* patient. Asking the provider about dysphagia cannot repair the second, and filling a hole cannot be done at the bedside.

## 5. Worked representation (proposed, not finalized syntax)

Illustrative canonical-AST fragment for today’s draft. Field names and nesting are placeholders for L00.4.a, not a schema. Dependencies appear only as `ref`; there is no separate edge list.

```jsonc
{
  "languageVersion": "ppl-1",
  "capabilityProfileVersion": "ppl-core-v0",
  "package": { "id": "gerd-pregnancy.alarm.progressive-dysphagia", "state": "Draft" },

  "references": [{
    "id": "src.l85-86", "kind": "EvidenceReference",
    "file": "corpus/GERD-Pregnancy-Care-Pathway.txt",
    "sha256": "937859b9b22f672e4d212cdd99b188f1e1d12b6cd4217459155d2c34a8f67032",
    "lines": [85, 86]
  }],

  "applicability": {
    "id": "applicability", "kind": "Predicate",
    "expr": { "hole": { "id": "H-SCOPE", "type": "Decision",
      "explains": "Population and encounter scope (draft A1, A2; Q14)" } }
  },

  "nodes": [
    { "id": "q.pd", "kind": "EvidenceQuery", "subject": "patient", "output": "Evidence<Boolean>",
      "contract": { "hole": { "id": "H-EVIDENCE", "type": "EvidenceSelectionContract<Boolean>",
        "explains": "What establishes presence or explicit absence, from which sources, in what scope and window, and how conflicts resolve (Q1–Q7; A2, A3)" } },
      "cites": ["src.l85-86"] },

    { "id": "p.alarm", "kind": "Predicate",
      "expr": { "evidenceValue": { "ref": "q.pd" } },
      "cites": ["src.l85-86"] },

    { "id": "f.alarm", "kind": "Finding",
      "status": { "all": [{ "ref": "applicability" }, { "ref": "p.alarm" }] },
      "label": "Progressive dysphagia (particularly solids before liquids)",
      "heading": "ALARM SYMPTOMS REQUIRING IMMEDIATE EVALUATION",
      "urgency": { "hole": { "id": "H-URGENCY", "type": "UrgencyRequirement",
                   "explains": "Display/finalization effect of this finding (Q12, Q13)" } },
      "cites": ["src.l85-86"] },

    { "id": "r.evaluation", "kind": "Recommendation", "intent": "propose",
      "action":   { "hole": { "id": "H-ACTION", "type": "ActionDefinition",
                    "explains": "What the source's 'evaluation' is (Q8–Q10)" } },
      "timing":   { "hole": { "id": "H-IMMEDIATE", "type": "ActionTiming",
                    "explains": "Meaning of 'immediate' in §7.2 terms, if any (Q11); not equated with 'urgent' (Q12)" } },
      "indication":    { "all": [{ "ref": "p.alarm" }] },
      "prerequisites": { "all": [] },
      "exclusions":    { "any": [] },
      "review": "clinician_required",
      "cites": ["src.l85-86"] }
  ],

  "presentation": { "layout": { "q.pd": [0, 0], "p.alarm": [240, 0], "f.alarm": [240, 120], "r.evaluation": [480, 0] } }
}
```

`EvidenceSelectionContract<Boolean>` names the Stage A §4.4 contract, and `ActionDefinition` names the §2.4/§5 action reference. `ActionTiming` stands for the §7.2 timing attributes, and `UrgencyRequirement` is the one genuinely new type; its shape is open (section 7).

### 5.1 Refining the evidence hole (illustrative)

When reviewers answer some questions, the author can replace `H-EVIDENCE` with a partly written contract. Every clinical part below remains a hole, because none is answered.

```jsonc
"contract": {
  "retrieve":   { "concept": { "hole": { "id": "H-CONCEPT",  "type": "ValueSetRef" } } },
  "establishes":{ "hole": { "id": "H-CRITERION", "type": "Decision",
                  "over": "candidate", "explains": "Q1–Q3; when written: typed expression or versioned library ref" } },
  "assertions": { "hole": { "id": "H-SOURCES",  "explains": "Q4" } },
  "scope":      { "hole": { "id": "H-WINDOW",   "explains": "Q5, Q7; A2, A3" } },
  "precedence": { "hole": { "id": "H-CONFLICT", "explains": "Q6" } },
  "negative":   { "hole": { "id": "H-NEGATIVE", "explains": "Q4, Q5" } }
}
```

The keys loosely follow Stage A §4.4’s list of contract contents. Their exact names and types are fixed by Stage A §17 item 4, not here. `H-CRITERION` is a hole of an existing type, a `Decision` over one candidate. Filling it with prose or a callback is a structural error.

### 5.2 Traceability

| Element | Classification | Basis |
|---|---|---|
| Alarm label, heading text, the word “immediate” | **Explicit source meaning** | Lines 85–86, quoted verbatim |
| Progressive dysphagia is a condition whose presence leads to a proposed evaluation | **Explicit source meaning** | Line 86 under line 85 heading |
| “Evaluation” is *proposed* for clinician review, not ordered or performed | **Proposed interpretation** (also RFC §7) | Draft §4; Stage A §5, §8 |
| Assessment output is `Evidence<Boolean>` (present / explicitly absent, else unresolved) | **Proposed interpretation** | Draft §4 three cases |
| `I_local` = alarm alone; empty *P* and *X* groups | **Proposed interpretation**: the source states no prerequisite or exclusion for this alarm. Clinical review must confirm it | Lines 85–86 |
| `review: clinician_required` | **Proposed interpretation** | Stage A §8 |
| Finding surfaced independently of disposition, within pathway scope | **Proposed interpretation** of “alarm” | Stage A §8.3; draft §4 Present row |
| H-SCOPE, H-EVIDENCE (or its refinements) | **Unresolved clinical meaning** | A1–A3, Q1–Q7 |
| H-ACTION, H-IMMEDIATE, H-URGENCY | **Unresolved clinical meaning** | Q8–Q13 |

Lines 288, 298 and 375–376 are not encoded. In particular, line 376’s “urgent” is not used to fill H-IMMEDIATE or H-URGENCY.

## 6. Behavior table

Rows 1–3 assume a *hypothetical* complete program **K**: every hole is replaced by some well-typed definition, applicability evaluates `True`, and required review and safety policy add no blocker. Row 4 completes only the evidence contract and applicability. These are schematic language examples, not claims about the clinical answers to Q1–Q14.

| # | Program state | Patient evidence | Assessment | Alarm | Finding | Proposal disposition | Needs | Must not be concluded |
|---|---|---|---|---|---|---|---|---|
| 1 | Complete (K) | Admissible in-scope evidence satisfies K’s criterion | `Known(true)` | `True` | Established; K’s urgency requirement applies | *proposed* (base eligibility `True`); clinician review still required | None from this query | That evaluation was ordered, scheduled or performed |
| 2 | Complete (K) | Admissible explicit negative satisfying K’s negative rule | `Known(false)` | `False` | Not established **for this alarm** | *not applicable*, `NOT_INDICATED` **on the basis of this alarm** | None from this query | That other alarms (lines 87–92) are absent; that the patient is “without alarm features” (line 72); that evaluation is unneeded for other reasons; overall safety; persistence beyond the assessed scope and time |
| 3 | Complete (K) | Evidence insufficient; see 3a–3d | `Unresolved(causes)` | `Unknown` | `Unknown`, showing the actual causes | *unresolved* | Per cause, below | Absence of the symptom; completion of alarm screening |
| 4 | Evidence contract and applicability complete; H-URGENCY, H-ACTION, H-IMMEDIATE still holes (preview only) | Admissible in-scope evidence satisfies the criterion | `Known(true)` | `True` | **Established and inspectable**; only the urgency attribute carries an incomplete-authoring marker | Indication `True`; action and timing carry markers, so there is no disposition | None (the evidence is resolved; holes never create Needs) | That urgency or the action is defined; that the package can publish or execute |
| 5 | Evidence contract incomplete (today’s draft) | Any, including a chart note that looks positive | Incomplete-authoring marker (H-EVIDENCE) | Marker | Marker | Marker; no disposition | **None** | That the patient lacks the alarm; that a provider must supply data; that the package can publish or execute |
| 6 | Invalid | — | — | — | — | — | — | Example: `p.alarm` references `r.evaluation`’s disposition (or the indication references the proposal itself), giving `CYCLIC_EXECUTION_DEPENDENCY` (§6.3, §10.4). Compilation and preview both fail, and no artifact is produced |

Row 3 causes stay distinct (Stage A §4.1). They can coexist; the trace keeps every one.

| Row | Patient evidence | Cause | Shown as | Need (when material) |
|---|---|---|---|---|
| 3a | No in-scope assessment, including an empty chart | `Missing` | Not assessed | Request an assessment that satisfies K |
| 3b | Retrieval failed or the source was unreachable | `Unavailable` | Source unavailable, with the failed acquisition | Re-acquisition under orchestrator attempt/deadline policy; the failure stays recorded |
| 3c | Only stale or out-of-scope candidates | `Inadmissible` | Evidence present but not admissible, with per-candidate reasons | Request an in-scope assessment; the rejected candidates are retained |
| 3d | In-scope candidates disagree and K’s precedence rule does not resolve them | `Conflicting` | Conflicting evidence, with every candidate | Clarification Need; no input-order winner |

### 6.1 Alarm established, scope unknown (settled language behavior)

Complete program K, except that applicability evaluates `Unknown` for this patient. Two sub-cases depend on whether K’s evidence contract itself needs the unresolved scope.

**(a) The contract does not need the unknown scope to establish admissibility**, and admissible evidence satisfies K’s criterion:

| Output | Result |
|---|---|
| Symptom assessment | `Known(true)`, with supporting evidence IDs |
| Alarm predicate | `True`, with supporting evidence |
| Pathway applicability *A* | `Unknown`, with its reasons and causes |
| Scoped finding `all(A, alarm)` | `Unknown` |
| Proposal | *I* = `all(A, True)` = `Unknown`; disposition *unresolved*, with a scoped applicability Need where material (§4.5) |
| Explanation | “Alarm condition established; pathway applicability unresolved.” |

The aggregate `Unknown` must not erase either input. Both component results, their evidence and the reasons stay in the result and the trace, and the explanation renders both facts.

**(b) The contract needs the unknown scope to decide admissibility.** For example, the query’s episode or encounter scope reads the same unresolved facts as *A*. The candidates’ admissibility is then `UnresolvedAdmissibility` (§4.6), the assessment stays `Unresolved`, and the alarm is `Unknown`, not `True`. The explanation says the alarm is unresolved because its evidence admissibility depends on unresolved scope. The alarm can be `True` only when its own evidence contract is satisfied. Any such scope dependency is a declared reference from the query, and it must stay acyclic: *A* cannot read the query.

The language behavior in (a) and (b) is settled here. Clinical review decides the applicability criteria (A1–A3, Q14) and which scope dependencies the evidence contract requires (Q5, Q7). It does not decide whether the language preserves established information.

## 7. Design assessment

**What the example demonstrates.** One small program connects a typed evidence query, a lifted three-valued predicate, a scoped finding and a Recommendation under compiler-bound applicability. Every dependency is written once as a reference, and the graph is derived from those references. The model separates three states, each with its own validation, preview, Need and publication consequences: unresolved clinical meaning (holes, whole or partial), unresolved patient evidence (`Unknown` with its actual causes) and invalid structure (errors). Holes mark only their dependents, so an established finding stays inspectable while its attributes are undefined. Likewise, an aggregate `Unknown` never erases an established component result (6.1). CQL supplies the retrieve/expression boundary and the truth tables, and Datalog supplies the relation and rule discipline. Prism contracts supply scope, absence, Needs, findings and disposition.

**Open language-design decisions.**

1. Approve hole placement in contract and action positions at author-chosen granularity (1.1, item 1), and fix the §4.4 selection-contract structure that refinements type-check against (Stage A §17 items 4 and 10).
2. The supported expression fragment for an establishing criterion over one candidate: which candidate fields are typed and readable, and how a library reference is versioned and pinned (1.1, item 2).
3. The finding declaration. **Resolved 2026-10-05:** Finding is a declaration kind (Stage A §5). Still open: the shape of `UrgencyRequirement`, including whether it can block finalization (§8.3) or only affects display; and how the component results in 6.1 are surfaced in the result contract (they are retained; their presentation is open). The language behavior for *A* = `Unknown` with alarm `True` is settled in 6.1.
4. Expression references as the only authored form of a dependency. **Resolved 2026-10-05:** Stage A §2.2 is amended (1.1, item 4). Still open: how the editor maps a drawn edge onto a reference with a non-trivial composition (`all` versus `any`).
5. Whether a request for patient data from a complete query is material in preview when every affected output except an independent finding carries a hole marker.
6. Whether a `Boolean` assessment is enough, or whether the answers to Q1–Q2 will need a finer evidence value (e.g. dysphagia recorded without the progression qualifier). This depends on Q1 and must not be decided by the language alone.
7. Whether empty *P*/*X* groups need their own rationale citation, so that “none stated in the source” is reviewable.

**Open clinical-content decisions.** All of Q1–Q14 and A1–A3, mapped to the holes in 5.2. Also open: confirming the empty prerequisite and exclusion groups and the `clinician_required` review; the applicability criteria; and which scope dependencies the evidence contract requires (6.1 b). Line 72 (“without alarm features”) cannot be represented by negating this one alarm: it would need every alarm with a complete negative contract, and that is out of scope here.

**Next smallest language-design task.** Define the §4.4 selection-contract structure for one `Evidence<Boolean>` symptom query, together with the expression fragment its establishing criterion may use (decisions 1–2). Items 5 and 6 depend on it, and it feeds L00.2.b. It needs no clinical answers. A proposed draft of this task, using a fictional record type rather than clinical content, is in [evidence-query-to-predicate-contract.md](evidence-query-to-predicate-contract.md); it is not accepted.
