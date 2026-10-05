# First PPL programs: GERD progressive-dysphagia alarm and its schematic companion

**Status:** Proposed. These are proposed source syntax and hand-derived expectations, the acceptance inputs for the first PPL compiler and evaluator. Neither of those exists yet, so nothing here has been compiled or executed.

- The GERD program is structurally checkable in the planned preview mode. It is **not publishable and not clinically executable** while its holes remain.
- No clinical question is answered. The [interpretation draft](../gerd-progressive-dysphagia-interpretation-draft.md) and the [Q1–Q3 review packet](../gerd-progressive-dysphagia-q1-q3-review.md) keep their statuses: not clinically adjudicated, and L00.1.a remains open.
- The schematic companion is nonclinical.

The implementation contract for these artifacts is [first-program-implementation-contract.md](../first-program-implementation-contract.md).

## Layout

| Path | Content |
|---|---|
| `gerd-progressive-dysphagia.ppl.json` | GERD-based program: applicability, evidence query, predicate and finding, with three typed holes |
| `schematic-demo-finding.ppl.json` | **Nonclinical** companion with the same constructs. Its query is the explicit-assertion-v0 contract, unchanged |
| `examples/PPL-01.json` … `PPL-05b.json` | Hand-derived acceptance examples (below) |
| `check.py` | Mechanical checks (JSON, references, quotations, digests, fixture links). It is **not** a compiler or a language-conformance test |

## The two programs

Both programs are written in the same source form. Edges are derived from `ref` only; no edge list is stored.

```text
GERD (proposed; holes marked ⟨…⟩)
  applicability : Decision          = ⟨H-SCOPE : Decision⟩
  q.pd          : Evidence<Boolean> = EvidenceQuery(contract = ⟨H-EVIDENCE : EvidenceSelectionContract<Boolean>⟩)
  p.alarm       : Decision          = evidenceValue(ref q.pd)
  f.alarm       : Finding           status  = all(ref applicability, ref p.alarm)
                                    label   = "Progressive dysphagia (particularly solids before liquids)"   (line 86)
                                    heading = "ALARM SYMPTOMS REQUIRING IMMEDIATE EVALUATION"                (line 85)
                                    urgency = ⟨H-URGENCY : UrgencyRequirement⟩
  edges: p.alarm → q.pd;  f.alarm → applicability;  f.alarm → p.alarm      (acyclic)

Schematic (nonclinical; no holes)
  applicability : Decision          = all()                                   -- True, written explicitly
  q.demo        : Evidence<Boolean> = EvidenceQuery(contract = explicit-assertion-v0 over demo-model@0.1:
                                        establishes = c.assertion == AssertionValue.Affirmed
                                        refutes     = c.assertion == AssertionValue.Denied
                                        retrieve demo-vs/item-x@1, sources {s1, s2}, admissibility on episode,
                                        encounter and assertionKind)
  p.demo        : Decision          = evidenceValue(ref q.demo)
  f.demo        : Finding           status = all(ref applicability, ref p.demo)
  edges: p.demo → q.demo;  f.demo → applicability;  f.demo → p.demo
```

## GERD program: how each declaration maps

Source: [corpus/GERD-Pregnancy-Care-Pathway.txt](../corpus/GERD-Pregnancy-Care-Pathway.txt), SHA-256 `937859b9…a8f67032`. The digest matches the [manifest](../corpus/manifest.json), whose status is “Design inputs; not approved clinical guidance”. Line 85 is `ALARM SYMPTOMS REQUIRING IMMEDIATE EVALUATION:` and line 86 is `• Progressive dysphagia (particularly solids before liquids)`. `check.py` verifies both lines and the digest.

| Declaration | Explicit source content | Earlier proposed structure | Unresolved clinical interpretation |
|---|---|---|---|
| `src.gerd.l85-86` (EvidenceReference) | Lines 85–86, quoted verbatim | Minimal model §1 (source citation); Stage A §5 | None. It is provenance only and never affects a result |
| `applicability` (Predicate) | Nothing: the passage states no population or encounter scope | Required by Stage A §4.5; minimal model §1, where the finding reads *A* explicitly | **H-SCOPE**: population and encounter scope (A1, A2, Q14). Neither unconditional scope nor same-encounter evidence is assumed |
| `q.pd` (EvidenceQuery) | Progressive dysphagia is listed as an alarm symptom | Minimal model §1, §5 (`Evidence<Boolean>`, whole-contract hole allowed, §1.1 item 1) | **H-EVIDENCE**: what establishes presence or explicit absence (Q1–Q3), acceptable sources (Q4), recency and encounter/episode scope (Q5, Q7, A2, A3) and conflicts (Q6). `Evidence<Boolean>` itself is a proposed interpretation (minimal model §7, decision 6) |
| `p.alarm` (Predicate) | — | Minimal model §1, §2: lifted projection of exactly one evidence input | None. It is fixed language behavior whose meaning comes entirely from `q.pd` |
| `f.alarm` (Finding, proposed kind) | Label is line 86 without its bullet; heading is line 85 without its colon | Minimal model §1.1 item 3: status `all(A, alarm)`; attributes separate from status | **H-URGENCY**: what “immediate” requires and whether the finding blocks finalization (Q11–Q13). It is not equated with “urgent” (lines 376, 449; Q12) |

**What the GERD program deliberately does not contain:**

- **A Recommendation for the “evaluation”.** This slice is evidence query → predicate → finding only. What the evaluation is, and its timing (Q8–Q11; minimal model holes H-ACTION and H-IMMEDIATE), stay unresolved and unencoded. The word “evaluation” appears only inside the quoted heading.
- **Partial contract refinements** (minimal model §5.1). No review answer justifies them yet, so the evidence contract stays one hole.
- **Lines 288, 298, 375–376, 487 and 582.** They are context only and are not encoded.

## Schematic companion

The companion is **not** an approved or proposed translation of GERD, and its label says it is nonclinical.

- Its query is the contract of [`q.demo.json`](../conformance/explicit-assertion-v0/query/q.demo.json), verbatim; `check.py` verifies the equality. Its records, codes, sources and permission are fictional.
- Its only extra assumption is the explicit unconditional applicability, `all()` (True), stated in its `rationale`.
- It has no urgency attribute and no citation, because it represents no source passage.
- The happy paths use one unambiguous current record. Coverage, context and provenance are supplied explicitly, because explicit-assertion-v0 needs them for a determinate result.

## Acceptance examples

| Example | Program | Entry points | State | Predicate | Finding status |
|---|---|---|---|---|---|
| PPL-01 | schematic | compile, evaluate | **EstablishedTrue** | `True` [s1/r1@1] | `True` |
| PPL-02 | schematic | compile, evaluate | **EstablishedFalse** (explicit Denied record, complete coverage) | `False` [s1/r2@1] | `False` |
| PPL-03 | schematic | compile, evaluate | **UnresolvedPatientEvidence** (no record; complete coverage is not a negative) | `Unknown(Missing)` | `Unknown(Missing)`; evidence Need for `q.demo` |
| PPL-04 | GERD | compile, compilePreview, evaluatePreview | **IncompleteAuthoring** | Marker [H-EVIDENCE] | Marker [H-EVIDENCE, H-SCOPE]; urgency marker [H-URGENCY]; no Need; publication blocked |
| PPL-05a | schematic + patch | compile, compilePreview | **InvalidProgram**: undefined reference | — | — |
| PPL-05b | schematic + patch | compile, compilePreview | **InvalidProgram**: enum literal as an `all` operand | — | — |

PPL-01 to PPL-03 reuse the inputs of EA-001, EA-002 and EA-005 verbatim. Their query evidence, predicate decision and attributions equal those fixtures’ expectations, and `check.py` verifies the equality. The applicability and finding values, supports, Needs and traces are new hand-derived expectations, traced in each file. The fields each example promises are defined in the implementation contract (§4).

## Running the checks

```bash
python3 docs/superpowers/records/pathway-language/programs/check.py
```

The script checks references, acyclicity, quotations, digests, patches, pointers, fixture links and the corpus manifest. Passing it does not mean a program compiles or that an expectation is correct under the language.
