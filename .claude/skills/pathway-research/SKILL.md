---
name: pathway-research
description: >
  Deep-research a clinical condition using US society guidelines and produce a
  structured markdown research brief for a Prism clinical pathway, organized to
  match the current pathway JSON schema on main (Gates incl. time-shape and LLM
  gates, Imaging, Guidance, REQUIRES, code_sets, clinical_role). Use whenever
  the user asks to research, draft, build, or create a pathway for a single
  clinical condition — "pathway for [condition]", "create a pathway", "Prism
  pathway", "clinical pathway", or any request naming a clinical condition with
  a comprehensive care workflow. Also triggers on "run pathway-research on X".
  Produces a reviewable markdown brief, NOT JSON — after user review,
  pathway-json-builder converts it. Always run this before pathway-json-builder.
---

# Pathway Research Brief Builder

Produce a **structured research brief** for one clinical pathway: society-guideline-grade
clinical content, organized 1:1 against the Prism JSON schema, with real verified citations
and explicit gaps. The user (a physician) reviews and edits the brief; `pathway-json-builder`
then converts it deterministically. **This skill never produces JSON.**

Read both reference files before drafting:
- `references/research-standards.md` — source hierarchy, recency, verification rules.
- `references/brief-template.md` — the exact structure to fill.

Schema ground truth lives in `.claude/skills/pathway-json-builder/references/pathway-json-format.md`.
Skim its Gate section before designing gates — it reflects what the import validator and
resolution engine on main actually accept, which is stricter than older docs.

## Step 1 — Confirm scope

If not already clear from the conversation, ask once (one message): exact condition +
qualifiers, care setting, population, whether this is a single-condition or
comorbidity-combination pathway (determines `code_sets`), and version (new `v1` vs revision).
If the request already answers these, don't ask — state the assumed scope in the brief.

## Step 2 — Deep research (multi-agent fan-out)

**Landscape scan (inline, brief):** 2–3 web searches to identify the owning US societies and
the current guideline editions (names + years). This anchors the agent prompts.

**Wave 1 — parallel domain agents.** Launch four `general-purpose` agents **in a single
message** so they run concurrently. Each prompt must name the condition, scope, the specific
guidelines found in the landscape scan, and require: search + **fetch and read** actual
guideline text (never answer from snippets or memory), return structured markdown with a
full citation (title, org, year, URL) after every claim, record evidence grades and exact
numbers (doses, thresholds, intervals) with their source section, list candidate codes, and
mark anything unfindable as GAP rather than guessing.

- **Agent A — Diagnosis & stratification:** diagnostic criteria, required workup (labs,
  imaging, procedures), risk scores and decision thresholds. For every decision point,
  report whether it is resolvable from structured data (which lab/vital/code, exact
  threshold) or requires provider judgment/elicitation — this drives Gate design.
- **Agent B — Pharmacotherapy:** first-line/second-line/alternative/avoid/contraindicated
  agents with dose, frequency, duration, route; escalation triggers; renal/hepatic/pregnancy
  adjustments; drug-class lanes (for `clinical_role` tags); RxNorm RXCUI candidates.
- **Agent C — Non-pharm, counseling & special populations:** lifestyle and behavioral
  management, patient education and safety-netting content (verbatim enough to become
  Guidance node instructions), special-population branches (pregnancy, geriatric, renal)
  and whether each belongs in-pathway (gated) or scoped out.
- **Agent D — Monitoring, follow-up & quality:** monitoring cadence and what each visit
  checks, escalation/recheck triggers, relevant CMS/NCQA/society quality measures with
  measure definitions, prerequisite orderings (what must precede what — REQUIRES design).

**Wave 2 — verification agents** (after synthesis below identifies the final entities; run
both in one message):
- **Code verifier:** every ICD-10/SNOMED/LOINC/CPT/RxNorm code the draft uses, verified
  against authoritative lookups (CMS/CDC, LOINC search, RxNav; SNOMED via
  `https://tx.fhir.org/r4/CodeSystem/$lookup?system=http://snomed.info/sct&code=<code>`).
  Returns confirmed code, display name, and any corrections. **Also checks the system
  against the gate field**: conditions ICD-10, medications RXNORM, allergies SNOMED, labs
  LOINC, vitals none (keys `systolic_bp`, `diastolic_bp`, `temperature_f`, …). Never trust
  a code's label from the repo's own seed tables — several are wrong (e.g. seed
  `109081006` "Penicillin allergy" is actually "Metformin-containing product").
- **Citation checker:** fetch every cited URL; confirm title/org/year match and that the
  cited claims (thresholds, doses) actually appear. Returns per-citation pass/fail + fixes.

Fold wave-2 corrections into the brief. Anything failing verification becomes `[GAP]` or
gets the corrected value. If the Agent tool is unavailable, do the same work sequentially
inline with WebSearch/WebFetch — same standards, same structure.

## Step 3 — Draft the brief

Fill `references/brief-template.md` exactly, in order. Design rules:

**Gate vs DecisionPoint:** if the decision can be resolved from structured patient data or a
single provider answer, it's a **Gate**; descriptive clinical judgment stays a
**DecisionPoint + Criteria** (with branch_mode and per-criterion targets). When a decision
has a concrete numeric/boolean/coded basis, prefer the Gate.

**Gate targets — the rule that decides whether a gate works at all.** A gate only excludes
its target if it is the **sole route** to that target. Name each gate's branch target as
content that exists *only* behind that gate — a step the pathway should not reach at all
when the gate misses. If a step also belongs in the normal stage flow, it is not gateable:
either it is unconditional, or the gated version is a distinct step. Two consequences to
design around:

- **Never map two gates onto one target.** Gates do not OR — the first gate to miss claims
  the target and a later satisfied gate cannot rescue it. Mutually exclusive alternatives
  (e.g. trimester-specific hemoglobin thresholds) must be **one gate** on a merged
  condition, or **separate targets**. Compound gates cannot express `(A AND B) OR (C AND D)`
  either: `conditions` is a flat list under a single operator.
- **One target per chart gate.** A patient_attribute/compound gate names exactly one
  target (main rejects more). "On yes, do A and B" is fan-out: put A and B in a
  branch-entry-only Stage and target that (always, for question gates — never duplicate a
  question), or, across stages, write one identical-condition gate per target.
- **Negative arms: question gates yes, chart gates no.** A question gate can send "yes" to
  A and "no" to B (name both targets and which answer takes which). A chart gate expresses
  only its satisfied branch: if the brief needs "if NOT responding, escalate" from data,
  author a second gate whose condition *is* the negative case; do not assume the engine
  derives it. If the negative case isn't
  expressible from structured data (intolerance, non-adherence), make it a question gate or
  mark the step unconditional and say so.

**Choosing the gate type:**
- Value already recorded as structured data → `patient_attribute`:
  - Diagnosis/med/allergy history → *coded condition* (`field` + `includes_code`/…).
  - Lab or vital threshold → **coded condition** (`field: labs` + LOINC + explicit
    `threshold`, or `field: vitals` + a simulator vitals key such as `systolic_bp` or
    `temperature_f` (°F) + `horizon: DAY`; never `system` on vitals). Blood pressure and
    temperature are vitals, not labs — see the spec's "What the simulator sends" table.
    **Do not use attribute-form (`lab.*`) for these** until the platform catches up: the
    simulator's required-fields panel never renders attribute-form conditions, and their
    evaluation needs `pathway_attribute_code_map` rows that have no seeding path — coded
    form is visible, quick-fillable, and evaluates with zero DB setup (see the Wyeth
    findings memo, P1b–P1d).
  - Gestational age / trimester → **attribute gate on `patient.gestational_age_weeks`**
    (or `patient.trimester`), e.g. `greater_or_equal 14` for "beyond the first
    trimester", On unresolved **ask**. The engine now treats a missing `patient.*` value as
    missing data (it pends and asks for `patient.<attr>`), not a silent "no". The encounter
    simulator sends GA/trimester; the preview flow sends none, so there the gate asks.
    Do not re-ask gestational age as a BOOLEAN question.
  - **Trajectory/response gates: state the physiologic drift and the target.** If the
    measured value moves on its own irrespective of treatment (hemoglobin falls through
    pregnancy; weight, BP, creatinine all drift), say so in the gate's rationale, and give
    the absolute target if one exists ("normal 11; goal >10 at delivery"). The builder needs
    both: a single long trend window fits pre-treatment values from a different physiologic
    state and can invert the verdict, and a patient who has REACHED target has a flat slope
    that no trend condition catches. Also state the expected response RATE (e.g. "~1 g/dL
    per 4 weeks") — it sets the slope threshold.
  - Recurrence/trajectory ("≥2 UTIs in 6 months", "rising creatinine") → time-shape coded
    operators: `count_in_window`, `trend_up`/`trend_down`, `delta_from_baseline` (labs only
    for trend/delta) with `window_days` and their thresholds (`slope_threshold` is a
    non-negative magnitude — the engine applies the sign).
  - **Temporal scoping on any condition**: assign `horizon` (LIFETIME | YEAR | QUARTER |
    MONTH | WEEK | DAY | ENCOUNTER or `{days: N}`) and `status` (active | inactive | any)
    wherever fact-relevance has a clinical time bound — "diagnosis active within the past
    year", "labs from this pregnancy only". One condition takes `window_days` OR `horizon`,
    never both: `window_days` when the operator itself is windowed, `horizon` to scope
    which facts count at all. Summarize every assignment in brief §17 — it is emitted.
- Elicited at the encounter (symptom presence/severity, history question) → `question`
  (BOOLEAN / SELECT with options / NUMERIC — uppercase). Severity is always elicited; never
  an invented ordinal attribute.
- Multiple conditions jointly → `compound` (AND/OR, no nesting).
- Decision lives only in narrative text → `llm_text_analysis` (input_attribute into
  freeformData, named branches, exactly one safe default, confidence_threshold).
- Depends on a prior node's outcome → design it, but mark `[BLOCKED — prior_node_result]`
  and specify today's fallback (REQUIRES edge, compound gate, or DecisionPoint) — that gate
  type is import-blocked until the validator fix lands.

**Valid attribute namespaces are only** `lab`, `vitals`, `allergy`, `patient` — anything
else hard-fails import. Every `lab.*`/`allergy.*` attribute goes in §14 (attribute-map
registrations) with system/code/value_type. There is no `symptom.*`/`medication.*`/
`condition.*` namespace.

**Also design where clinically appropriate:** Guidance nodes (counseling content from Agent
C), Imaging nodes (modality required), REQUIRES prerequisite pairs (from Agent D, acyclic),
Schedules with intervals, QualityMetrics with measure definitions, ESCALATES_TO med chains,
`clinical_role` on every med in a recognizable lane, and `code_sets` only for
comorbidity-combination pathways. Summarize all horizon/status assignments in §17 (the
temporal-audit table — these are emitted into the JSON, not annotations).

## Step 3b — Use the data the chart gives

Josh, 2026-10-03: a pathway never ignores data it has been given; the question is *how* to
use it. Before validating, walk every gate and every action in the draft and answer, in the
brief (§4b for gates, §18 for anything left open):

- **Every lab the pathway reads:** what does a value mean when it is *old*? Decide on the most
  recent value, and author a separate recheck (interval from the guideline) rather than a short
  window that throws the value away. What when it is *undated*? What when there is *none*?
- **Every treatment the pathway starts or chooses:** what if she is already on it, or has
  already had it? Read the medication list first.
- **Every test the pathway orders:** what if a result is already on file?
- **Every question the pathway asks:** could the chart have answered it?

The format spec's section "Use the data the chart gives" has the patterns and the two brief
markers (`[WINDOW — …]`, `[NO MEDICATION CHECK — …]`).

## Step 4 — Validate the brief

- [ ] Every Stage/Step/DP/Criterion/Med/Lab/Imaging/Procedure/Guidance node has a citation
      in §16; Gate/CodeEntry/QM/Schedule evidence is mapped to its host Step.
- [ ] Every medication has a valid `role` and either a `clinical_role` or an explicit "n/a".
- [ ] Every gate: valid type, default_behavior with rationale, "On unresolved" **ask** on
      every gate with a numeric condition (decided rule — not an open question; `default`
      only with an `[ON-UNRESOLVED DEFAULT — gate-<slug>]` marker and its clinical reason),
      type-specific fields complete, attached-to + branches-to named; no
      `prior_node_result` without a fallback.
- [ ] Attribute conditions use only lab/vitals/allergy/patient; all lab.*/allergy.* in §14.
- [ ] Every trend/response gate names its physiologic drift, its absolute target (if any),
      and the expected response rate.
- [ ] Time-shape params present wherever windows/trends are claimed (window_days,
      thresholds); no condition sets both window_days and horizon; horizon/status values
      from the legal grammar; §17 table covers every temporally-scoped condition.
- [ ] Every criterion has an explicit branch target; every DP has a branch_mode.
- [ ] Every gate names a target reached **only** through that gate (not also a plain step in
      its stage's flow); no two gates share a target; every chart gate has exactly one
      target (fan-out via branch-entry Stage or identical copies); any "if not X" arm is
      authored as its own gate or explicitly left unconditional.
- [ ] Codes verified by the wave-2 agent; formats plausible per system.
- [ ] code_sets (if any): ≥1 required code each, valid scopes.
- [ ] Citations: real title/org/year/URL, all fetched, evidence levels from the allowed set.
- [ ] Category is a valid enum value; version incremented if a revision.
- [ ] Header carries exactly one stamp line: `JSON: (not built)` for a new brief, or
      `JSON: pathways/json/<logical_id>.json @ version <v>` (= §1 Version) for a revision of
      a built pathway — the builder and pre-commit hook check it (`check-brief-sync.ts`).
- [ ] REQUIRES pairs acyclic; §17 and §18 present (or "None.").

## Step 5 — Save and deliver

Save to `pathways/briefs/<logical_id>-research-brief.md` (create dirs as needed), then send
the file to the user. In the message: 2–3 sentence pathway summary; counts (stages, steps,
DPs, gates by type, meds, guidance, schedules); whether code_sets / REQUIRES / LLM gates /
time-shape gates were used (so those choices get sanity-checked); every `[GAP]`/
`[FALLBACK SOURCE]`/`[BLOCKED]` flag; and: "Review and edit the brief. When you're
satisfied, ask me to build the JSON (pathway-json-builder)."
