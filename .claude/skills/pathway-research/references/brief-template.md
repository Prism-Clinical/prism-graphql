# Pathway Research Brief — Template

<!-- The stamp line below is machine-read (check-brief-sync.ts). The brief is the source of
     truth and the JSON is derived from it: keep exactly one stamp in the header, above the
     first "## ". A new brief says "(not built)"; once pathway-json-builder builds the JSON
     it becomes "JSON: pathways/json/<logical_id>.json @ version <version>", with <version>
     equal to the JSON's pathway.version and to §1's Version. Any later change to the JSON
     updates this brief (and the stamp, if the version moves) in the same commit. -->
JSON: (not built)

Fill every numbered section. The brief maps 1:1 onto the Prism pathway JSON (see
`.claude/skills/pathway-json-builder/references/pathway-json-format.md`) so the builder can
convert it deterministically. Write for the reviewing physician first: rationale in prose,
machine-facing details in the labeled fields. Mark anything uncertain `[GAP]`,
`[FALLBACK SOURCE]`, or `[OLDER SOURCE]` rather than papering over it.

---

## 1. Pathway metadata

- **Logical ID**: `<kebab-case-slug>` (stable across versions)
- **Title**:
- **Version**: 1 (plain numerals — the dashboard prepends "v"; increment if a revision; must equal the header stamp once built)
- **Category**: one of CHRONIC_DISEASE | ACUTE_CARE | PREVENTIVE_CARE | POST_PROCEDURE | MEDICATION_MANAGEMENT | LIFESTYLE_MODIFICATION | MENTAL_HEALTH | PEDIATRIC | GERIATRIC | OBSTETRIC
- **Scope** (care setting):
- **Target population**:
- **Condition codes** (trigger codes; OR semantics unless 1b used):

| Code | System | Description | Usage note | Grouping |
|---|---|---|---|---|
| | | | | |

## 1b. Code sets

"None." — or, for a comorbidity-combination pathway that must only fire when multiple codes
co-occur, one block per set:

- **CS-1**: `<label>` — scope: EXACT | EXACT_AND_DESCENDANTS | DESCENDANTS_OK; entry node: `<node id or none>`
  - Required codes (ALL must be present): `E11` (ICD-10, scope_override: DESCENDANTS_OK), `I10` (ICD-10)

## 2. Stages

One per top-level phase, numbered:

- **Stage 1 — `<title>`**: `<1–2 sentence rationale + what it covers>`
- **Stage 2 — …**
- Note any stage reached **only** by branching (it gets no root edge): "Stage N is branch-entry only, from `<gate/dp>`."

## 3. Steps

Under their parent stage, with display numbers:

- **Step 1.1 — `<title>`**: `<description — what the clinician does>`
- **Step 1.2 — …**

## 4. Decision points

Descriptive branches requiring clinical judgment that is *not* machine-evaluable. (If the
decision can be resolved from structured data or a single provider answer, it belongs in 4b
as a Gate instead. When it has a concrete numeric/boolean/coded basis, prefer a Gate.)

- **DP-1 — `<title>`** (after Step X.Y) — branch_mode: one_of | all_of | any_of
  - Criterion 1a: `<description>` → branches to `<Step/Stage>`
  - Criterion 1b: `<description>` → branches to `<Step/Stage>`
  - `<prose rationale + source>`

Every criterion gets an explicit target (becomes SELECTS_BRANCH); every DP's targets
together become its BRANCHES_TO set. `all_of` = sequencing fan-out (all branches happen);
`any_of` = optional add-ons.

## 4b. Gates

> **Use the data the chart gives.** For every gate say how each state of its data is used: a
> current value, an **old** value (decide on the most recent; a recheck gate handles
> staleness), an **undated** value, and **no** value. For every treatment or test the pathway
> starts, say what happens when the chart already holds it. A bounded window on a threshold
> needs `[WINDOW — <gate-id>: <why>]`; a pathway that recommends medications without reading
> the medication list needs `[NO MEDICATION CHECK — <why>]`. For every response-to-treatment
> check add the state **due, nothing drawn since the treatment started**: it opens a step that
> orders the recheck (name the tests and what they decide) and asks for nothing; the response
> gates sit behind "one or more since the start". A response check without that route needs
> `[NO RECHECK ROUTE — <clinical_role>: <why>]`.

One block per machine-evaluable decision. Common fields for every gate:

- **Gate `gate-<slug>` — `<title>`**
  - Attached to: `<Stage/Step/DP id>` · Branches to: `<ONE Step/Stage id>` — a chart gate
    (patient_attribute/compound) has exactly one target (Rule 3). To open several things on
    "yes": same-stage → name a branch-entry-only Stage that holds them (list it in §2,
    with a unique stage number just after its parent's, e.g. 1.5);
    cross-stage → write one gate block per target with identical conditions. A question gate
    may route yes → A / no → B only if you say which answer takes which target.
  - Exclusively gated: yes | no — the branch target must be content the pathway should
    NOT reach when this gate misses. If the target is also a normal step in its stage's
    flow, or another gate/criterion also targets it, the gate excludes nothing. Say which
    step is being removed from the plain stage flow to make this gate real. The same holds
    for everything under the target: a med escalated to from an ungated med, or a lab also
    ordered by a step outside the gate, walks past the gate — list such a lab under each
    host separately, and route escalation into gated content through the gated step.
  - Type: patient_attribute | question | compound | llm_text_analysis
  - Default behavior: **skip** — what happens to the target when the gate is not satisfied,
    **including a definite "no"**. `traverse` includes the target even on "no", so a
    single-target gate with `traverse` excludes nothing and is rejected by the builder.
    Missing-data behaviour is the next field, not this one.
  - On unresolved: **ask** for any gate with a numeric condition (a lab or vital
    threshold, or a `lab.*`/`vitals.*`/`patient.*` attribute other than `exists`) — this
    is **decided, not a per-gate question** (Josh, 2026-09-24): a missing value holds the
    subtree and asks the provider for it. Do not list it as an open decision. Only if a
    missing value must instead be treated as "no" (e.g. an optional add-on where missing
    honestly means "not applicable"), write `default` **and** a line carrying
    `[ON-UNRESOLVED DEFAULT — gate-<slug>]` with the clinical reason — the builder's lint
    fails a numeric gate set to `default` without that marker. Gates with only
    code/history conditions: write "n/a — default".
  - Trajectory gates only — Physiologic drift: `<does the value move on its own? e.g.
    "Hgb falls through pregnancy (hemodilution)" | "none">` · Absolute target:
    `<e.g. "normal 11; goal >10 at delivery" | "none">` · Expected response rate:
    `<e.g. "~1 g/dL per 4 weeks">`
  - Rationale & source: `<why this threshold/logic, cite ref #>`

> **One target per chart gate; fan out with a branch-entry Stage or identical copies.**
> A patient_attribute/compound gate with two targets is rejected by main's import, and a
> question gate with two targets routes to exactly one of them by answer — it never opens
> both. Never duplicate a question gate to fan out: the provider would be asked twice.
>
> **Two gates may never share a branch target.** Gates do not OR: the first to miss claims
> the target and a later satisfied gate cannot rescue it. Mutually exclusive alternatives
> (e.g. trimester-specific thresholds) must be one gate on a merged condition, or separate
> targets. A chart gate has no negative arm — "if NOT X" needs its own gate whose condition
> is the negative case, or the step stays unconditional. A question gate may route "no" to
> its own target: name both targets and which answer takes each.

Plus type-specific fields:

**patient_attribute / compound** — give each condition in exactly one of the two forms:
- *Attribute form*: attribute `<lab|vitals|allergy|patient>.<name>`, operator (equals | not_equals | greater_than | greater_or_equal | less_than | less_or_equal | in | exists), value, unit.
  - Only namespaces `lab`, `vitals`, `allergy`, `patient` exist. Every `lab.*`/`allergy.*` attribute used must also appear in §14.
- *Code system is fixed by field* (what the simulator and chart feed send): conditions →
  ICD-10, medications → RXNORM, allergies → **SNOMED**, labs → LOINC, vitals → none. An
  allergy documented both ways (SNOMED allergy finding; ICD-10 Z88.x status code) is an OR
  of `allergies`/SNOMED and `conditions`/ICD-10 conditions. Blood pressure and temperature
  are **vitals** (`systolic_bp`, `diastolic_bp`, `temperature_f` in °F), not LOINC labs.
- *Coded form*: field (conditions | medications | allergies | labs | vitals), operator (includes_code | equals | exists | greater_than | less_than | count_in_window | trend_up | trend_down | delta_from_baseline), value (code; wildcard **only** as a trailing `.*` — `G82.2.*`, never `G82.2*`, which is a literal that matches nothing; or vitals key), system (**never on vitals** — hard import error), and the operator's params:
  - greater_than/less_than → `threshold` (always explicit, finite number)
  - count_in_window → `count_threshold` (positive integer), `window_days` (always give it: omitted means the field's default — LIFETIME for conditions/meds/allergies, but 90 days for labs — and a bounded window never counts undated entries, which is every simulator entry)
  - trend_up/trend_down (labs only) → `window_days`, `min_points` (positive integer), `slope_threshold` (units/day, **non-negative magnitude** — the engine applies the sign)
  - delta_from_baseline (labs only) → `window_days`, `min_points`, `delta_threshold` (signed)
- *Temporal scoping (either form)*: optional `horizon` — LIFETIME | YEAR | QUARTER | MONTH | WEEK | DAY | ENCOUNTER or `{days: N}` (1..36525) — and `status` — active | inactive | any. **A condition takes `window_days` OR `horizon`, never both.** **Every `vitals` condition needs a horizon** (`DAY` unless there is a reason; never `ENCOUNTER`) — without one it inherits ENCOUNTER and the simulator session is rejected. Give every clinically-scoped condition an explicit horizon/status with a one-line rationale; summarize all assignments in §17.
- compound only: operator AND | OR across the listed conditions. Note: a missing or
  unorderable value makes the gate *unresolved* (an OR with nothing true and one unknown
  is unresolved) — it then follows "On unresolved" (ask, for numeric gates), not the
  default behavior.
- *Lab display*: give every lab condition a readable label with the unit the threshold
  assumes, e.g. `Platelets (x10^9/L)` — it is the text of the missing-value question.

**question** — prompt text; answer_type BOOLEAN | NUMERIC | SELECT (uppercase); options list
if SELECT. Symptom presence → BOOLEAN; severity → SELECT (mild/moderate/severe) or NUMERIC
for a validated scale. Never encode severity as an invented ordinal attribute.

**llm_text_analysis** — input_attribute (dotted path into freeformData); branches (name +
description, exactly one marked SAFE DEFAULT); confidence_threshold (default 0.75). Only
for decisions that genuinely live in narrative text.

**prior_node_result** — currently import-blocked (validator bug). If the clinically right
design depends on a prior node's outcome, write it here with `[BLOCKED — prior_node_result]`,
specify the intended depends_on (`node id` + status INCLUDED/EXCLUDED/…), AND specify the
fallback the builder should emit today (REQUIRES edge, compound gate, or DecisionPoint).

## 5. Medications

- **Med-1 — `<name>`** (on Step X.Y)
  - Role: first_line | second_line | alternative | preferred | acceptable | avoid | contraindicated
  - Clinical role: `<lane tag, e.g. uti-first-line-abx>` — or "n/a (non-conflicting adjunct)"
  - Dose / frequency / duration / route:
  - Escalates to: `<Med-N or none>`
  - Notes (renal dosing, contraindications, pregnancy):
  - Source: ref #

Assign a clinical_role to every drug in a recognizable lane (it drives cross-pathway
conflict detection); say explicitly when omitting one.

## 6. Lab tests

- **Lab-1 — `<name>`** (on Step X.Y): code `<LOINC>`, specimen, purpose, source ref #

## 7. Imaging

- **Img-1 — `<name>`** (on Step X.Y): modality `<XR|CT|MRI|US|…>`, body_region, code (CPT/LOINC), indication, source ref #

## 8. Procedures

- **Proc-1 — `<name>`** (on Step X.Y): code `<CPT/SNOMED>`, purpose, source ref #

## 9. Guidance

Counseling / education / lifestyle content:

- **Guid-1 — topic `<topic>`** (on Step X.Y): instructions `<the actual counseling text>`, category `<education|lifestyle|safety-netting|…>`, source ref #

## 10. Quality metrics

- **QM-1 — `<name>`** (on Step X.Y): measure `<definition incl. numerator/denominator if standard>`, steward (CMS/NCQA/society), source ref #

## 11. Schedules

- **Sched-1** (on Step X.Y): interval `<e.g. "every 3 months">`, description `<what happens and what triggers escalation>`, source ref #

## 12. Prerequisites (REQUIRES)

"None." — or dependent → prerequisite pairs among Stages/Steps (Y must be done before X;
powers catch-up when a patient arrives mid-pathway). Chains must be acyclic.

- `<Step/Stage X>` REQUIRES `<Step/Stage Y>` — `<why>`

## 13. Code entries

Codes to attach to specific nodes (allowed hosts: Step, Criterion, Medication, LabTest,
Imaging, Procedure — never Gate, Guidance, Stage, or DecisionPoint; a symptom code captured
by a gate attaches to the gate's branch-target Step):

| Code | System | Description | Attached to |
|---|---|---|---|
| | | | |

## 14. Attribute-map registrations

Every `lab.*` / `allergy.*` attribute referenced in §4b, for seeding
`pathway_attribute_code_map` (unregistered attributes silently resolve undefined at runtime):

| attribute_name | namespace | system | code | value_type |
|---|---|---|---|---|
| `lab.hba1c` | lab | LOINC | 4548-4 | number |

"None." if no lab/allergy attribute gates.

## 15. Evidence citations

Real, verifiable sources only — every entry found and confirmed during research:

- **[1]** `<title>` — `<authors/org>`, `<source/journal>`, `<year>`, evidence level `<A|B|C|Level A|Level B|Level C|Expert Consensus>`, `<URL>`
- **[2]** …

## 16. Citation map

Which reference(s) support which nodes. Cover every Stage, Step, DecisionPoint, Criterion,
Medication, LabTest, Imaging, Procedure, and Guidance node (those are the types that can
carry CITES_EVIDENCE). Gates, CodeEntries, QualityMetrics, and Schedules cannot cite —
their evidence attaches to the parent/host Step; note that here explicitly.

- Stage 1: [1]
- Step 1.1: [1], [3]
- Gate gate-a1c-7 → evidence on parent Step 2.1: [2]
- …

## 17. Temporal horizon & status summary (EMITTED — review carefully)

One row per condition carrying temporal scoping. The builder emits these directly into the
gate conditions, so this table is the reviewer's single place to audit time semantics:

| Gate | Condition on | horizon | status | window_days | Rationale |
|---|---|---|---|---|---|
| gate-`<slug>` | `<code/attribute>` | YEAR / {days: N} / — | active / inactive / any / — | — or N | `<why this scoping>` |

Rules: horizon XOR window_days per condition; named horizons are fixed day-widths
(YEAR=365, QUARTER=90, MONTH=30, WEEK=7, DAY=1) back from the session clock. **Give every
condition a row** — an omitted horizon is not "lifetime": it is LIFETIME for conditions/
medications/allergies, QUARTER (90 d) for labs, and ENCOUNTER for vitals (which rejects
simulator sessions — use DAY). Omitted status on conditions/medications/allergies means
**"active"** (not "any"); never give labs or vitals a status. Mark any trend/delta/count
gate "simulator-untestable" — the simulator sends no dates.

## 18. Gaps & fallbacks

Every `[GAP]`, `[FALLBACK SOURCE]`, `[OLDER SOURCE]`, and `[BLOCKED — prior_node_result]`
marker in one list, with what would resolve it.
