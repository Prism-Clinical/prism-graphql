# Prism Pathway JSON Format — Authoritative Spec (v6)

> **Describes the `josh-dev` engine: `origin/main` at commit `f0c2ca1` (2026-09-28) plus
> josh-dev's authoring extensions.** Main's side includes the temporal-horizon kernel
> (PR #54), `v1` as the default temporal policy, PR #55's decision semantics, and the
> **evaluation pipeline** (PRs #56–#61): a session stores only its *inputs*, and every
> answer, override or added fact re-evaluates the whole pathway from them. There is no
> incremental re-resolution any more.
>
> **josh-dev extensions — NOT on `origin/main`.** Main's validator rejects a JSON that uses
> any of these (checked 2026-10-03: anemia v9 fails main with 21 errors; GHTN v5 and UTI v3
> pass both):
> - `window_from` anchored trend windows, `delta_comparison`, NOT_YET_DUE
> - `count_comparison` on `count_in_window` (2026-10-04; anemia v14 uses it)
> - `baseline_days` on an anchored `count_in_window` (2026-10-04; anemia v15 uses it)
> - `not_includes_code`
> - `horizon: "PREGNANCY"` — a window that opens at the start of THIS pregnancy, dated from
>   `patient.gestational_age_weeks` (2026-10-04; see **Temporal horizon & status**)
> - `horizon: { "since_gestational_week": N }` — the same window opened N weeks into the
>   pregnancy ("drawn since 24 weeks"); before week N it is definitely empty (2026-10-04)
> - `patient.rh_factor` is read tolerantly: chart spellings ("Rh+", "POS", "Rh(D) negative",
>   "Du") are normalised to `positive` / `negative` / `weak D` / `partial D`, and a
>   non-canonical comparand is an import error (2026-10-04)
> - calendar checks on the session clock (2026-10-04): the condition
>   `encounter.date` / `in_season` ("is today inside Sept 1 – Jan 31?") and the horizon
>   `{ "since": "MM-DD" }` ("since the most recent July 1")
> - nested AND/OR condition groups inside a compound gate
> - `DATE` answers (treatment start dates), typed `patient.*` datum answers, and the
>   "Not available" answer to a data question (`notAvailable`)
> - `on_declined: "traverse"` on a gate (2026-10-04): "Not available" to the datum the gate
>   asked for OPENS it — a declined question leads to the action (see **"Not available"**)
> - `remember_answer` on a gate that reads a `patient.<attribute>` (2026-10-04): the
>   provider's answer is kept for the patient and supplied at later encounters, scoped to
>   this pregnancy or to the patient (see **Remembered answers**)
> - a reached action node (Medication, LabTest, …) is always INCLUDED: confidence is
>   reported with it and never removes it (`[DECISION — Josh 2026-10-03]`: nothing is
>   hidden; conclusions come from the available information). On main a node scoring
>   below the suggest threshold is EXCLUDED — and the seeded scorers rate an order by
>   whether the patient already has it, so new orders drop out. A DecisionPoint still
>   uses scores to choose between its branches
> - import-time checks main lacks: `depends_on` object shape, code wildcard grammar,
>   temporal override rules, SELECT options regardless of `answer_type` case
>
> **Build from a checkout that contains current `origin/main`.** `scripts/validate-pathway.ts`
> imports the validator from the checkout it runs in and refuses to run (exit 3) when HEAD
> does not contain `origin/main`. On josh-dev it then prints a notice that the schema source
> differs from main — expected, because of the extensions above. A stale checkout is how two
> pathways once "passed" here and then failed main's import.
>
> **Drift check (do this every time you build a JSON):** run
> `git fetch origin && git log -1 --format=%h origin/main -- apps/pathway-service/src/services/import apps/pathway-service/src/services/resolution apps/pathway-service/src/types`
> — compare against **`origin/main`, never local HEAD**. If the hash is not `f0c2ca1`, main
> has moved: merge it into josh-dev first (the validator refuses otherwise), then
> `git diff f0c2ca1 origin/main -- <those paths>`, apply any changes to your output, re-run
> `scripts/gate-proof.ts`, and update this document.
>
> Source-of-truth files (verify against these, never against memory):
> - `apps/pathway-service/src/services/import/types.ts` — node/edge types, required props, edge endpoints, limits, enums
> - `apps/pathway-service/src/services/import/validator.ts` — every import-time rule
> - `apps/pathway-service/src/services/import/branch-when.ts` — the `when` grammar on BRANCHES_TO edges
> - `apps/pathway-service/src/services/resolution/types.ts` — gate condition shapes, operators, `on_unresolved`
> - `apps/pathway-service/src/services/resolution/attribute-registry.ts` — attribute namespaces
> - `apps/pathway-service/src/services/resolution/gate-evaluator.ts` — runtime operator semantics
> - `apps/pathway-service/src/services/resolution/traversal-engine.ts` — how a gate verdict disposes its targets
> - `apps/pathway-service/src/services/resolution/unresolved-prompt.ts` — what an unresolvable gate asks for
> - `apps/pathway-service/src/services/resolution/temporal/policy-registry.ts` — system default horizons per field
> - `apps/pathway-service/src/types/index.ts` — GateType, DefaultBehavior, AnswerType, NodeStatus, PathwayCategory, ImportMode

## Top level

```json
{
  "schema_version": "1.0",
  "pathway": { ... },
  "nodes": [ ... ],
  "edges": [ ... ]
}
```

`schema_version` must be exactly `"1.0"`.

## Pathway metadata

| Field | Required | Notes |
|---|---|---|
| `logical_id` | ✅ | Stable slug across versions, e.g. `uncomplicated-uti-adult` |
| `title` | ✅ | Human title |
| `version` | ✅ | `"1.0"`, `"2.0"`, … — plain numerals; the dashboard renders `v` + version, so a `v` prefix displays as "vv1" |
| `category` | ✅ | One of: `CHRONIC_DISEASE`, `ACUTE_CARE`, `PREVENTIVE_CARE`, `POST_PROCEDURE`, `MEDICATION_MANAGEMENT`, `LIFESTYLE_MODIFICATION`, `MENTAL_HEALTH`, `PEDIATRIC`, `GERIATRIC`, `OBSTETRIC` |
| `scope` | optional | Care setting text |
| `target_population` | optional | Population text |
| `condition_codes` | ✅ non-empty | `{code, system, description?, usage?, grouping?}` — the codes that trigger this pathway (OR semantics unless `code_sets` present) |
| `code_sets` | optional | AND-combination matching, below |

### Trigger codes are families (`[DECISION — Josh 2026-10-03]`)

The matcher expands each patient diagnosis to its ICD-10 ancestors and compares those with
`condition_codes`, so **a parent code matches everything beneath it**. Author the family, at
the highest level whose every member belongs in the pathway:

| Instead of | Author |
|---|---|
| `O99.011`, `O99.012`, `O99.013`, `O99.019` | `O99.01` |
| `O23.10`, `O23.12`, `O23.13` | `O23.1` |

- A list of sibling leaves matches only those leaves, silently misses the sibling nobody
  listed, and grows until it is unreadable.
- Go up only as far as the family stays inside the pathway's scope. If a parent admits a
  code the pathway must NOT take (a childbirth or puerperium code in an outpatient prenatal
  pathway), keep the leaves and say why in the brief: `[LEAF CODES — <parent>: <why>]`.
- `validate-pathway.ts` enforces it (exit 6): two or more ICD-10 trigger codes under one
  parent, with no such marker, fail the build.
- The family lookup needs the patient's code AND the parent in the deployment's
  `icd10_codes` table. The local table holds a common-codes subset — check both are present.
- Gate conditions already do this with `includes_code` and a trailing `.*`.
- **Obstetric pathways apply to pregnant patients only** (`[DECISION — Josh 2026-10-03]`,
  josh-dev engine: `pathway-applicability.ts`). A pathway with `category: OBSTETRIC` is
  dropped from matching unless the chart says the patient is pregnant: any chapter-15 code
  (`O…`), `Z33`, `Z34`, `Z3A`, or a recorded gestational age or trimester. So a non-pregnancy
  family on a pregnancy pathway (`D50`, `R82.71`, `R03.0`) fires only for a pregnant
  patient. **Set `category: OBSTETRIC` on every pregnancy pathway — it is now behaviour, not
  a label.**
- **Not built yet — the rest of pathway classification** (adult / pediatric by age, and
  preferring the pregnancy pathway over a general one when both match). See
  `pathways/TODO.md`.

### code_sets (comorbidity-combination matching)

Only for pathways that should fire when **multiple codes are present together** (e.g. "Pregnancy + Chronic HTN" must not fire on either alone). When absent, each `condition_codes` entry independently triggers the pathway (legacy OR).

```json
"code_sets": [
  {
    "description": "T2DM with hypertension",
    "scope": "EXACT",
    "entry_node_id": "stage-2",
    "required_codes": [
      { "code": "E11", "system": "ICD-10", "scope_override": "DESCENDANTS_OK" },
      { "code": "I10", "system": "ICD-10" }
    ]
  }
]
```

- `required_codes` — required, non-empty; ALL must be present in the patient's expanded code set. Cross-system members allowed.
- `scope` / `scope_override` ∈ `EXACT`, `EXACT_AND_DESCENDANTS`, `DESCENDANTS_OK`. Default `EXACT`.
- `entry_node_id` — optional node id where a match routes resolution; must reference a real node.

## Node types

Every node: `{ "id": "...", "type": "...", "properties": { ... } }`. IDs unique, human-readable
(`stage-1`, `step-2-3`, `dp-1`, `crit-1a`, `gate-<slug>`, `med-1`, `lab-1`, `img-1`, `proc-1`,
`guid-1`, `qm-1`, `sched-1`, `ev-1`, `code-icd10-n39-0`).

| Type | Required properties | Recognized optional properties (read by care-plan projection / UI) |
|---|---|---|
| `Stage` | `stage_number` (**unique per pathway**; numeric, fractions allowed — the dashboard sorts stages by `Number(stage_number)` and labels them "Stage <n>"), `title` | `description` |
| `Step` | `stage_number`, `step_number`, `display_number`, `title` | `description` |
| `DecisionPoint` | `title`, **`branch_mode`** | `description`. `branch_mode` is **required** (hard import error when absent, even in draft) ∈ `one_of` (mutually exclusive: exactly one branch is taken — if more than one qualifies the DP pends and the provider picks), `all_of` (every branch is taken by declaration; a weakly-supported branch is still INCLUDED and red-flagged), `any_of` (optional add-ons) |
| `Criterion` | `description` | `code_value` (cross-checked against `condition_codes`, warning if absent) |
| `Gate` | `title`, `gate_type`, `default_behavior` | See Gate section |
| `Medication` | `name`, `role` | `dose` (or `dosage`), `frequency`, `duration`, `route`, `clinical_role`, `instructions` |
| `LabTest` | `name` | `code`, `system`, `specimen` |
| `Imaging` | `name`, `modality` | `body_region`, `code` (or `code_value`), `system` (or `code_system`) |
| `Procedure` | `name` | `code` (or `procedure_code`), `system` |
| `Guidance` | `topic`, `instructions` | `category` — counseling/education/lifestyle content |
| `QualityMetric` | `name`, `measure` | |
| `Schedule` | `interval`, `description` | |
| `EvidenceCitation` | `reference_number`, `title`, `evidence_level` | `authors`, `source`, `year`, `url` |
| `CodeEntry` | `system`, `code` | `description` |

Enums:
- Medication `role` ∈ `first_line`, `second_line`, `alternative`, `preferred`, `acceptable`, `avoid`, `contraindicated`.
- Medication `clinical_role` — free tag naming the drug's clinical lane (e.g. `antihypertensive-primary`). The multi-pathway resolver flags a conflict when ≥2 concurrent pathways tag **different** drugs with the **same** `clinical_role`. Assign to every med in a recognizable lane; omit for pure non-conflicting adjuncts.
- `evidence_level` ∈ `A`, `B`, `C`, `Level A`, `Level B`, `Level C`, `Expert Consensus`.
- Code `system` ∈ `ICD-10`, `SNOMED`, `RXNORM`, `LOINC`, `CPT`.

## Gates

A Gate is a machine-evaluable decision attached to a Stage/Step/DecisionPoint via `HAS_GATE`,
guarding its `BRANCHES_TO` target. Every Gate must have ≥1 outbound edge; a chart gate has
exactly one (Rule 3).

> ### ⚠ Gate wiring — read this before wiring any gate (builder-enforced)
>
> A gate guards its target **only if the gate is the sole route to that target.** The
> traversal engine gates a gate's OWN outgoing edges, and node marking is
> first-writer-wins (`traversal-engine.ts:852`, `:990`). Any other route reaches the target first
> and the gate's verdict is silently discarded. The import validator does **not** catch
> this — run `scripts/check-gate-control.ts` (see below).
>
> **Rule 1 — a gated region must have its gate as the only way in.** If a Step is behind a
> gate, it gets **no** `stage-N HAS_STEP` edge, and nothing else may `BRANCHES_TO` /
> `SELECTS_BRANCH` into it. This is the same rule stated for Stages under the edge table,
> applied to Steps. **And it holds for everything the target contains**, not just the
> target: a closing gate sweeps its target's whole containment subtree (every outgoing
> edge except `REQUIRES` — `graph-containment.ts`), but the constructive walk follows
> **every** outgoing edge of every included node, action nodes included. So none of these
> may point into a gated region from outside it:
> - an **action-to-action** edge such as `ESCALATES_TO` — anemia v5's
>   `med-1 -ESCALATES_TO-> med-5` gave IV iron to a GA-12 patient while `gate-iv-iron-ga`
>   had Step 2.5 GATED_OUT (fixed in d6ab163). Escalation into gated content is the gated
>   step's own route; drop the edge.
> - a **shared action node** — one LabTest/Medication/… hosted both inside and outside the
>   gate. First writer wins: either the gate's sweep drops the lab the outside host
>   ordered, or the outside host includes it past the gate (anemia 2a6b602). Emit one node
>   per host, same codes and citations.
>
> `CodeEntry` and `EvidenceCitation` nodes are exempt — they are read through their host,
> never by their own status. A route that exists only through `REQUIRES` warns (the engine
> follows it, but it leaks only when the dependent resolves before the gate). Nodes shared
> between the branches of one router, or between Rule 3 fan-out copies of one gate, are not
> second routes. A second route the brief intends is recorded with a `[SECOND ROUTE]`
> marker (see **Brief markers**).
>
> **Rule 2 — exactly one gate may point at a given target.** Two gates on one target is a
> deterministic AND: **any gate that misses excludes the shared target**, in either
> evaluation order, and a satisfied gate cannot rescue it (re-verified on `a428da5`).
> **Gates do not OR.** Mutually exclusive alternatives
> (e.g. trimester-specific thresholds) must be merged into one gate or given separate
> targets. Merge them with a **nested condition group** in one compound gate —
> `(A AND B) OR (C AND D)` is `"operator": "OR", "conditions": [{ "operator": "AND",
> "conditions": [A, B] }, { "operator": "AND", "conditions": [C, D] }]` (see **compound**).
>
> **Rule 3 — a chart gate has exactly ONE `BRANCHES_TO` target.** A `patient_attribute`,
> `compound` or `prior_node_result` gate with several targets is an import error on main
> (it has no answer to route on), and a `question`/`llm_text_analysis` gate with several
> targets is a *router* that takes exactly one edge by its `when` — never all of them. So
> "on yes, open A and B" (fan-out) is authored one of two ways:
> - **same-stage fan-out** — ONE target: a branch-entry-only Stage that `HAS_STEP`s the
>   several steps (the steps keep their `stage_number`/`display_number`; the new Stage takes
>   its parent's `CITES_EVIDENCE` and a **unique** `stage_number` just after its parent —
>   parent + 0.5, e.g. `1.5` — never the parent's own number: the dashboard sorts and labels
>   stages by it, and `check-gate-control.ts` fails duplicates). Required for **question** gates:
>   duplicating a question asks the provider twice, and the two answers can disagree.
> - **cross-stage fan-out** — one gate per target, **identical** conditions, ids
>   `gate-x` + `gate-x-<suffix>`, all attached to the same host. Rule 2 forbids two gates on
>   one target, not one condition on several gates. Chart gates only: two gates reading the
>   same missing lab share ONE escalation question (deduped on the datum). Keep the copies
>   in sync — `check-gate-control.ts` warns when a `gate-x-*` copy drifts from `gate-x`.
>
> Use `when` only for genuine routing — "yes → A, no → B" on a question/LLM gate — and then
> map every answer (see **Multi-target gates** below).
>
> Also note when designing:
> - **Only a fork can share contents; a chart gate cannot.** A DecisionPoint or question
>   router that takes one branch excludes the others **sparing everything the taken branch
>   contains** (`containmentClosure`), so two branches may hold the same steps (anemia:
>   Stage 1.5 / Stage 2 share Step 2.8; Stage 2.5 / Stage 2.6 share Steps 2.1–2.3). A
>   closing chart gate sweeps its whole closure GATED_OUT **sparing nothing**, before any
>   deeper route writes — so two complementary chart gates (A → X, not-A → Y) can never
>   both lead into shared content: whichever closes takes it. Put a chart split **behind**
>   the fork, on the branch it concerns, not in front of it (anemia v8:
>   `gate-empiric-no-hgbpathy` / `gate-hgbpathy-microcytic` on DP-1's empiric branch, so
>   the confirmatory branch into Stage 2 serves every patient; `gate-proof.ts hgbpathy`).
> - **Negative arms exist only on question and LLM gates.** A question gate can route
>   "no" to its own target: two `BRANCHES_TO` edges with `when: {"equals": true}` and
>   `when: {"equals": false}` (a router — the answer takes exactly one). A **chart** gate
>   still expresses only its satisfied branch: "if NOT X, do Y" from chart data needs a
>   second gate whose condition *is* the negative case (and note that a missing value then
>   makes both gates unresolved, not one true and one false), or Y stays unconditional.
> - **`SELECTS_BRANCH` is a live traversal edge**, not just UI metadata. A Criterion
>   reaches its `SELECTS_BRANCH` target unconditionally, so it counts as a competing route
>   under Rule 1.
> - **A DecisionPoint branch into a gate's target overrides the gate.** The provider's
>   branch choice is an answer the engine routes on in every evaluation, and the
>   chosen branch is walked whatever the gate said (proved on anemia v3: MCV 90 + "workup"
>   included the microcytic workup). So a step is either a DP branch or gated — not both.
>   To make the *decision itself* conditional, gate the Step that hosts the DP and give
>   the DP no other host (anemia v4: `gate-microcytic` → Step 1.7 → DP-1;
>   `scripts/gate-proof.ts mcv`).
>   A `one_of` DP whose branches all score ≥ the suggest threshold (0.60) **pends** for the
>   provider; if only one qualifies it is taken automatically. Structural targets (Steps,
>   or a Step and a Stage) score identically **when they cite evidence of the same
>   level** — `evidence_strength` reads each target's own `CITES_EVIDENCE`, so give a
>   branch-entry Stage its parent's citations — and in practice such a fork pends
>   (`scripts/gate-proof.ts dp-1-scoring`).
> - **Missing data is `on_unresolved`'s job, not `default_behavior`'s.** A numeric lab,
>   vital or `patient.*` value that is missing makes the gate *unresolved*; it then ASKS for
>   the value and holds its subtree (see **Missing data** below — `ask` is the rule for
>   numeric gates). A membership condition (`includes_code`, `exists`) never is — "no code
>   on file" is a definite no.
>
> Real failure this prevents: anemia-in-pregnancy v1.4 passed the import validator with 0
> errors and 0 warnings, and **not one of its 5 gates could exclude anything** — a patient
> with Hb 12.0 g/dL resolved with PRBC transfusion, oral iron and IV iron all INCLUDED.

`default_behavior` ∈ `skip` | `traverse` decides what happens to the target when the gate is
**not satisfied** — and that includes a definite **"no"**, not only missing data
(`traversal-engine.ts:1263-1310`: every not-satisfied outcome that is not pending or asking
takes `default_behavior`):

| Gate outcome | `skip` | `traverse` |
|---|---|---|
| satisfied | target INCLUDED | target INCLUDED |
| answered **no** (chart value on the wrong side; question answered false) | target GATED_OUT | target **INCLUDED** |
| could not decide, `on_unresolved: default` | target GATED_OUT | target INCLUDED |
| could not decide, `on_unresolved: ask` | held, asks | held, asks |
| question not yet answered | held, asks | held, asks |

So **a single-target gate with `traverse` can never exclude its target** — it is inert,
exactly like a Rule 1 violation. Real failure: anemia `gate-ida-confirmed` was `traverse`
"so missing ferritin keeps iron therapy reachable", and a ferritin of 50 (not iron
deficient) still resolved Stage 2 iron therapy INCLUDED. **Use `skip` on every gate whose
purpose is to exclude**, and control missing data with `on_unresolved` (`ask` = hold and
ask; `default` = exclude). "Include when the value is missing but exclude when it is
normal" is **not expressible** on main — `default_behavior` cannot tell the two apart; pick
`ask` and say so in the brief. `check-gate-control.ts` fails a single-target gate set to
`traverse`. (On a multi-target router the answer picks the edge, so `default_behavior`
only matters if it cannot decide.)

`gate_type` ∈ `patient_attribute`, `question`, `prior_node_result`, `compound`, `llm_text_analysis`.

**Gate enums are import-validated (since PR #55, `validator.ts:400-445`)** — a value outside
the vocabulary is a hard error, even in draft mode:
- `gate_type` — exact match against the list above (an unknown type used to import and then
  silently do nothing).
- `default_behavior` ∈ `skip`, `traverse`; `answer_type` ∈ `BOOLEAN`, `NUMERIC`, `SELECT`;
  compound `operator` ∈ `AND`, `OR` — compared case-insensitively. At runtime anything other
  than an explicit `traverse` fails closed to skip (`traversal-engine.ts:1263`).
- `on_unresolved` ∈ `ask`, `default` (exact) — see **Missing data** below.

**Multi-target gates (since PR #55, `validator.ts:265-398`).** A gate with **one**
`BRANCHES_TO` edge needs nothing more: traversing it is the routing. A gate with **more than
one** is a *router*, and the validator requires:
- only `question` and `llm_text_analysis` gates may have several targets — a
  `patient_attribute`/`compound`/`prior_node_result` gate "is evaluated from the chart and
  yields no answer to route on" (hard error);
- every one of its `BRANCHES_TO` edges carries `properties.when` (grammar under **Edges**);
- the mapping is total and exclusive: BOOLEAN maps both `true` and `false` with real
  booleans; SELECT maps every option exactly once with option strings; NUMERIC uses
  half-open ranges that tile the whole line with no gap or overlap; an LLM gate maps its
  `branches[].name` vocabulary; a multi-target question gate must declare `answer_type`.

At runtime a router takes **exactly one** edge — the one whose `when` matches the answer —
and marks the others EXCLUDED; no answer, or an answer matching zero or several edges, takes
none and raises an `unroutable_decision` red flag (`traversal-engine.ts:1078-1150`). So a
router is "route yes vs no", never "fan out on yes".

### Only an encounter diagnosis activates a pathway (`[DECISION — Josh 2026-10-04]`)

"It can read throughout the chart to help a pathway, but chart can't cause a pathway to be
activated." Trigger codes (`condition_codes`) are matched against the diagnoses **on the
encounter** — the ones the provider adds at the visit — never against the chart's problem
list. So:

- Write triggers as the diagnoses a provider would put on the visit for this problem.
- A hand-off ("add the diagnosis") is the only way one pathway leads to another: the pathway
  recommends the diagnosis, the provider adds it to the encounter, the other pathway joins.
- **Gates still read the whole chart** — conditions, labs, medications, history. A chart
  condition can settle a gate (a comorbidity, "already diagnosed"); it cannot start a pathway.
- A stale code on the chart (a prior pregnancy's diagnosis left active) is a chart problem,
  not something a pathway works around.

### One problem per pathway (`[DECISION — Josh 2026-10-04]`)

A pathway orders treatment only for its own problem. A drug or test for a **different**
problem — even one the pathway's own treatment commonly causes (a stool softener for
constipation on oral iron) — is not ordered here: that problem gets its own pathway, fired
by its own diagnosis. Pathways are not linked to one another. What the pathway may keep is
one counselling sentence that the side effect is common and should be reported, naming no
drug. In the brief, mark a removed or declined cross-problem order with the decision, and
list the other problem under `pathways/TODO.md` if it has no pathway yet.

### Guidance says what the order lines cannot (`[DECISION — Josh 2026-10-04]`)

The plan shows a step's orders and its guidance side by side. A Guidance node that restates
them ("repeat CBC and iron studies" under a CBC, a ferritin and an iron-studies line) reads
as a duplicate recommendation. So, for every Guidance node:

- **Never name an order the same step (or the route into it) already carries** as a LabTest,
  Medication, Procedure, Imaging or Schedule node — not in the `topic`, not in the
  `instructions`. The order line is the instruction to order.
- **Never repeat another Guidance node** that is in the plan at the same time ("continue oral
  iron" belongs to one node).
- **Say what the results or the order mean:** what they decide, the thresholds that decide
  it, and what must not be done before they are back.
- **The `topic` is that point in a few words** ("What the response recheck decides"), not a
  restatement of the step title.
- A step whose guidance would only restate its orders needs no Guidance node.

### Use the data the chart gives (`[DECISION — Josh 2026-10-03]`)

**A pathway never ignores data it has been given. The authoring question is never *whether*
to use a value on the chart, but *how*.** Three failures taught this, each found by Josh in
the simulator:

| What the pathway did | What it should do |
|---|---|
| Read hemoglobin with a 7-day horizon. A value from 33 days ago was treated as no value at all, and the provider was asked for one. | Read the **most recent** value (`horizon: "LIFETIME"`) to decide, and express staleness **separately**: a membership gate (`not_includes_code`, the same LOINC, `horizon: "MONTH"` or the interval the guideline gives) that opens a "repeat the test" step. Anemia v13: `gate-hgb-recheck-due` → Step 1.13. |
| Asked "empiric iron or workup?" and "oral or IV?" of a patient with ferrous sulfate already on her medication list. | Read the medication list before offering to start or choose a treatment: membership gates on `medications` route "already on it" to *continue and assess* (anemia v12). |
| Closed a response check silently when no dated value existed. | Ask for the value (with its date), and let "Not available" route to ordering the test. *(Superseded for the "not yet rechecked" case by the next row.)* |
| With one hemoglobin since oral iron started and no baseline — most simply a value the provider typed in at the visit — asked for a result "drawn after" today (`[DECISION — Josh 2026-10-04]`: "recheck in 2–4 weeks, not nonresponse"). | A third anchored state: `AND(count at_least 1 since the start, count less_than 2 with baseline_days, below target)` opens a "cannot be measured yet" step — repeat test, schedule, "this is not nonresponse" — and the response gates move behind "two points, or at target". Anemia v15: `gate-rise-unmeasurable` → Step 2.24. |
| Asked for a newer hemoglobin when the response to oral iron was due and none had been drawn since it started; "No newer result" closed both response gates and left nothing (`[DECISION — Josh 2026-10-04]`). | **Order the recheck; do not ask for the value.** An anchored count gate — `count_in_window`, `count_comparison: "less_than"`, `count_threshold: 1`, on the response gates' own `window_from` — opens a step that carries the recheck orders and says what they decide. The response gates move behind the `at_least` twin, so they are not evaluated (and cannot ask) until a value since the start exists. Anemia v14: `gate-response-recheck-due` → Step 2.21, `gate-rechecked` → Step 2.22. |

| Approximated "drawn this pregnancy" with fixed look-backs banded by gestational age (98 / 196 / 300 days). A 98-day look-back at 8 weeks reaches six weeks before the LMP — about eight before conception — so a screen from before this pregnancy counted as done in it (`[DECISION — Josh 2026-10-04]`: "drawn this pregnancy needs to use the gestational age"). | **`horizon: "PREGNANCY"`** on the condition. The window opens on the LMP date — the session clock minus `patient.gestational_age_weeks` × 7 days — and needs no banding: one gate serves every gestational age. A missing gestational age asks for it; it never guesses a window. See **Done this pregnancy** below. |

#### Done this pregnancy — `horizon: "PREGNANCY"`

"Was X drawn / diagnosed / started **this pregnancy**" is one condition with
`horizon: "PREGNANCY"` — never a set of gates banded by gestational age, and never a fixed
day count chosen to be "about a pregnancy long":

```json
{ "field": "labs", "operator": "not_includes_code", "value": "75622-1", "system": "LOINC",
  "display": "HIV-1/2 antigen and antibody screen", "horizon": "PREGNANCY" }
```

- **Screen already done** → `includes_code` + `horizon: "PREGNANCY"`; **screen still owed**
  → `not_includes_code` + `horizon: "PREGNANCY"` (the exact mirror, same window).
- **A value from this pregnancy** → the threshold leaf with `horizon: "PREGNANCY"`
  (`less_than` on hemoglobin reads the newest value since the LMP and ignores one from
  before it; with none since the LMP it asks for the lab). This is rule 1's "an older value
  is clinically meaningless" case — say so in the brief: `[WINDOW — <gate-id>: this
  pregnancy]`.
- **Do not also gate on gestational age to "protect" the window.** The engine reads
  `patient.gestational_age_weeks` itself; when it is missing the gate pends on the one
  gestational-age question every other gate shares. A separate `patient.gestational_age_weeks`
  condition belongs in the gate only when the *timing* of the step depends on it ("at or
  after 24 weeks").
- **Leave `prompt` unset** (as on every chart gate). If one is set, it is not used for the
  gestational-age question.
- **Simulator caveat.** The simulator dates nothing, and an undated lab is asserted current:
  it satisfies `includes_code` inside any bounded window, `PREGNANCY` included (see **What
  needs dated facts**). So in the simulator a lab on the chart reads as "drawn this
  pregnancy" whatever its real date; the bound is exercised only with dated labs
  (`labResults[].date`, or a dated answer). State this in the brief (§18).

##### Done since a gestational week — `{ "since_gestational_week": N }`

"Repeat CBC drawn **since 24 weeks**", "third-trimester rescreen drawn **since 27
weeks**", "a GDM screen drawn before 24 0/7 weeks does not count as the 24–28-week screen"
(`[DECISION — Josh 2026-10-04]`) are the same window opened later. **"Since week N"
replaces every gestational-age-banded day count** — `{ "days": 28 }` "at 28 weeks",
`{ "days": 42 }` "at 30 weeks" — which is right at one gestational age and wrong at every
other:

```json
{ "gate_type": "compound", "operator": "AND", "default_behavior": "skip", "on_unresolved": "ask",
  "conditions": [
    { "attribute": "patient.gestational_age_weeks", "operator": "greater_or_equal", "value": 24 },
    { "field": "labs", "operator": "not_includes_code", "value": "1504-0", "system": "LOINC",
      "display": "1-hour glucose challenge", "horizon": { "since_gestational_week": 24 } } ] }
```

- **Done in the window** → `includes_code`; **still owed** → `not_includes_code`; **a value
  from the window** → the threshold leaf — each with the same
  `"horizon": { "since_gestational_week": N }`.
- **Always pair the "still owed" leaf with the timing leaf** (`patient.gestational_age_weeks
  >= N`), as above. Before week N the window has not opened and is definitely empty, so
  `not_includes_code` (and `count_in_window` … `less_than`) is definitely **true** — alone,
  it would open the "order it" step at 12 weeks. The timing leaf is what says "not yet".
  (This is the one place a gestational-age leaf belongs beside a pregnancy-dated window.)
- A window with an upper end ("drawn **between** 24 and 28 weeks") is not expressible as
  one horizon. In practice "since 24 weeks" is the clinical question — a screen drawn at 30
  weeks still answers it — so author that.
- The simulator caveat above applies unchanged.

#### Seasons and "this season" — calendar checks (`[DECISION — Josh 2026-10-04]`)

Josh, on routine prenatal vaccines: "can we add a calendar check?" Two different questions,
two different tools — both read the calendar date of the **session clock**, and neither is
ever approximated with a fixed day count (`{ "days": 150 }` for "about a season" opens on a
different date at every visit, and a look-back cannot say "it is October" at all):

| The clinical sentence | Author it as |
|---|---|
| "Offered only **in season**" — maternal RSV vaccine Sept 1 – Jan 31 (CDC); influenza season | `{ "attribute": "encounter.date", "operator": "in_season", "from": "09-01", "to": "01-31" }` — a leaf of the step's compound gate, ANDed with the chart conditions |
| "Has it been given **this season**?" — influenza / COVID-19 vaccine since the most recent July 1 | `"horizon": { "since": "07-01" }` on the condition that reads the chart for it |

```json
{ "gate_type": "compound", "operator": "AND", "default_behavior": "skip", "on_unresolved": "ask",
  "conditions": [
    { "attribute": "encounter.date", "operator": "in_season", "from": "09-01", "to": "01-31",
      "display": "RSV season (Sept 1 – Jan 31)" },
    { "attribute": "patient.gestational_age_weeks", "operator": "greater_or_equal", "value": 32 },
    { "field": "medications", "operator": "count_in_window", "value": "<RSV vaccine RxNorm code>",
      "system": "RXNORM", "status": "any", "count_threshold": 1, "count_comparison": "less_than",
      "horizon": "PREGNANCY" } ] }
```

- **The season's dates come from the brief**, with their source (CDC and ACOG differ for
  RSV: Jan 31 vs Mar 1). They are authored on the condition, not built into the engine.
- **`in_season` never asks and is never missing.** It is a definite yes or no at every
  visit, so out of season it settles an `AND` by itself and the gate asks for nothing else.
- **"Given this season" for a vaccine is a COUNT, not a membership read.** A medication or
  immunization record is an *interval*: `includes_code` asks "was a record of this open at
  any time in the window", and a 2024 record with no end date is open in every season
  since. `count_in_window` selects on the **start date** — when it was given:
  - given this season → `count_in_window`, `count_threshold: 1`, `status: "any"`,
    `"horizon": { "since": "07-01" }`;
  - still owed → the same with `"count_comparison": "less_than"`.
  For a **lab** (a point in time) `includes_code` / `not_includes_code` with
  `{ "since": … }` is exact and is the simpler pair.
- **Simulator caveat.** The simulator dates nothing. An undated entry satisfies
  `includes_code` inside any bounded window and counts **0** toward any bounded
  `count_in_window` — so in the simulator the "still owed" count gate opens for every
  chart, vaccinated or not. The window is exercised only with dated entries
  (`medications[].date`). State this in the brief (§18).

Authoring rules that follow:

1. **A horizon is not a freshness filter.** On a threshold condition (`less_than`,
   `greater_than` on `labs`) a short horizon *discards* an older value and makes the gate
   ask. Use `"LIFETIME"` and add a recheck gate when the guideline wants a recent value. A
   bounded horizon on a threshold leaf is right only when an older value is clinically
   *meaningless* for the decision (a value from a previous pregnancy; the post-treatment
   window of a response check) — then say why in the brief: `[WINDOW — <gate-id>: <why>]`.
2. **Before the pathway starts, chooses or orders something, check whether the chart already
   has it.** A treatment → gate on `medications`. A lab result the pathway would order →
   gate on `labs` membership. A diagnosis the pathway would work up → gate on `conditions`.
   A pathway that recommends medications and never reads the medication list must say why:
   `[NO MEDICATION CHECK — <why>]`.
3. **Stale, undated, old or partial data routes somewhere; it is never dropped.** Decide what
   each state means — use it, recheck it, ask about it — and author a gate for each.
4. **Ask only for what the chart does not hold**, and when a question is asked about a lab
   or vital the chart has an older value of, the engine offers that value with it
   (`lastOnFile`) — nothing to author.
5. **A response-to-treatment check that is due, with no value since the treatment started,
   ORDERS the recheck — it does not ask for the value** (`[DECISION — Josh 2026-10-04]`:
   "It should be accepting the value I gave … The recommendation should be to repeat testing
   with iron studies to determine need for IV iron"). The provider has just told the pathway
   everything there is; a question for a result that does not exist can only be declined,
   and a declined datum closes every gate waiting on it. There are **three** states before
   the response can be judged, each its own anchored count gate on the step that hosted the
   response gates (the response gates' `window_from` and `min_days_since_anchor`,
   `default_behavior: "skip"`):
   - **Not rechecked** — nothing since the start: `count_threshold: 1`,
     `count_comparison: "less_than"`, `on_unresolved: "ask"` → a **recheck step** with its
     own LabTest nodes (named so the plan line says they are the response recheck) and a
     Guidance node saying what the results decide. Never start the escalation from it.
   - **Rechecked but unmeasurable** (`[DECISION — Josh 2026-10-04]`: "recheck in 2–4 weeks,
     not nonresponse") — a value since the start, but fewer than two points to measure a
     change between, and not at target: compound `AND(count at_least 1 since the start,
     count less_than 2 WITH the delta's baseline_days, <the non-response gate's below-target
     group>)`, `on_unresolved: "ask"` → a **"cannot be measured yet" step**: its own repeat
     test named for the reason, a Schedule, and Guidance saying this is not nonresponse, the
     value on file becomes the baseline, and not to escalate on it. This is the state a value
     *typed in at the visit* lands in.
   - **Measurable, or at target** — compound `OR(count at_least 2 WITH baseline_days, <the
     response gate's at-target group>)`, `on_unresolved: "default"` (+ marker) → the
     **response-assessment step** hosting the response gates. They are then reached only
     with the values they need and never ask for a second value.
   Do it on every route that has a response check (anemia: the pathway-started route and the
   already-on-it route). State in the brief that the recheck's labs duplicate any the host
   step already orders, and add `[WINDOW — <gate-id>: <why>]` for the copied target groups.
   A pathway that judges a response and deliberately has no such route says why:
   `[NO RECHECK ROUTE — <clinical_role>: <why>]`.

6. **An answer the provider should not be asked again at every visit is remembered,
   scoped** (`[DECISION — Josh 2026-10-04]`: "prenatal vitamin needs to be a sticky answer
   for that patient"). When the chart cannot hold a fact and the pathway has to ask for it
   as a `patient.<attribute>`, put `remember_answer` on the gate (see **Remembered
   answers**): `PREGNANCY` for something true of this pregnancy ("taking a prenatal
   vitamin"), `PATIENT` for something that does not change (a blood type). Name the
   `values` worth keeping — usually only the answer that ends the asking; an answer that
   leads to an order should be asked again next visit. A chart value always wins over a
   remembered one.

7. **A declined question leads to the action when the pathway says so**
   (`[DECISION — Josh 2026-10-04]`). "Not available" is an answer, not a dead end: decide,
   for every datum the pathway asks for, what the provider not having it should lead to. If
   the answer is "then do it anyway" — recommend the vitamin, give the vaccine, order the
   test — author that route: a membership gate on the absence for a coded fact, or
   `on_declined: "traverse"` on the gate that leads to the action for a `patient.*` answer
   (see **"Not available"**). A decline that silently closes every gate waiting on it must be
   a choice, stated in the brief.

`validate-pathway.ts` reports rules 1, 2 and 5 as **DATA USE** warnings (not failures):
read each one and either fix the pathway or add the marker. (Rule 5: a `window_from` trend
or delta whose `clinical_role` has no `count_in_window` … `count_comparison: "less_than"`
gate anywhere in the pathway.)

### Missing data — `on_unresolved` (emit on every chart gate)

A chart gate ends in one of three states: **satisfied**, **answered no**, or **could not
decide**. "Could not decide" means `dataUnavailable` (a scalar comparison had no usable
value — no result, or none inside the horizon) or `indeterminate` (candidate values exist
but cannot be ordered, e.g. two undated results for the same LOINC → `AMBIGUOUS_LATEST`).
`on_unresolved` governs only that third state (`resolution/types.ts:217-230`,
`traversal-engine.ts:1206-1265`):

| `on_unresolved` | Could-not-decide outcome |
|---|---|
| `ask` (**the default when absent**) | Gate → PENDING_QUESTION, its whole subtree held ("Awaiting <datum>"), and a pending question asks the provider for the missing value. The answer is injected as a fact and the gate re-evaluates. |
| `default` | `default_behavior` applies, exactly as for "answered no". |

**"Not available" (josh-dev, 2026-10-03).** A provider asked for a datum can answer that
they do not have it (`GateAnswerInput.notAvailable: true`; the simulator's "Not available"
button). The decline is stored against the *datum*, so every `ask` gate waiting on it stops
asking and takes its `default_behavior` — exactly as if it were `on_unresolved: default` for
this session. Author for it: when a missing value should itself lead somewhere ("level
unknown → order the labs"), add a **membership** gate on the absence — coded
`not_includes_code` on the same LOINC, `on_unresolved: default` — branching to the step
that orders it (anemia v10: `gate-no-hgb-on-file` → Step 1.9; `gate-proof.ts unknown-hgb`).
That gate is open from the start of the visit, stays open after a decline, and closes when
a value is on file. Without such a gate a declined datum simply closes its gates.

**`on_declined` — what "Not available" means for a gate (josh-dev, 2026-10-04).**
`[DECISION — Josh 2026-10-04]`: "Not available" on "already taking a prenatal vitamin?"
should recommend the vitamin — unknown is treated like "no".

```json
{ "gate_type": "patient_attribute", "default_behavior": "skip", "on_unresolved": "ask",
  "on_declined": "traverse",
  "condition": { "attribute": "patient.on_prenatal_vitamin", "operator": "equals", "value": false } }
```

- **`"traverse"`**: the gate **opens** when the datum it needed was asked for and the
  provider answered "Not available" — and only then. It does nothing while the question is
  still unanswered (the gate holds and asks, as always), nothing when the condition is
  definitely false (a "yes" here still closes the gate), and nothing when the condition is
  true (it was open anyway).
- **`"default"`, or absent**: today's behaviour — a declined datum makes the gate take
  `default_behavior`.
- **It is not `default_behavior: "traverse"`.** That includes the target on a definite "no"
  as well, which is why it is rejected on a single-target gate. `on_declined` is independent
  of `default_behavior` (keep `skip`) and legal on a single-target gate.
- **Import:** only `"traverse"` and `"default"` are accepted. `check-gate-control.ts` repeats
  that, and warns when `"traverse"` sits on a gate that cannot ask (no askable condition, or
  `on_unresolved` not `"ask"`): nothing can be declined there.
- **When to use which pattern.**
  - The missing datum is a **coded** fact (a lab, a diagnosis, a medication): keep the
    membership gate on the absence (`not_includes_code`, above). It opens the order before
    the question is answered as well as after a decline.
  - The missing datum is a **`patient.*` attribute**: no condition is true on absence (every
    operator is unresolved except `exists`, which is false), so a membership gate cannot be
    written. Put `on_declined: "traverse"` on the gate whose target is what "unknown" should
    lead to — usually the "no → recommend" gate of a yes/no pair. Leave it off the other.
- A decline is not remembered: with `remember_answer` on the pair, nothing is stored, and the
  question returns at the next encounter.
- Source: `opensOnDecline` in `resolution/traversal-engine.ts`; `import/validator.ts`;
  `__tests__/on-declined-traverse.test.ts`. Used by routine prenatal care v4 (prenatal
  vitamin, Tdap, RSV); proved in `gate-proof.ts prenatal-meds` / `prenatal-vaccines`.

**Remembered answers — `remember_answer` (josh-dev, 2026-10-04).** A gate whose condition
reads a `patient.<attribute>` may carry

```json
"remember_answer": { "scope": "PREGNANCY", "values": [true] }
```

- **What it does.** When the provider answers that attribute's question and the answer is
  one of `values` (any answer when `values` is omitted), it is stored for the patient. At
  the start of a later encounter it is supplied as that patient attribute, so the gate
  decides without asking. An answer **not** in `values` withdraws what was remembered: with
  `"values": [true]`, a later "no" forgets the earlier "yes".
- **The chart wins.** A value the chart (or the encounter) already carries for the attribute
  is used and the remembered one is not supplied.
- **`scope`** — required, `"PREGNANCY"` or `"PATIENT"`.
  - `PREGNANCY`: held while the answer was given during this pregnancy — on or after the LMP
    date derived from the gestational age (the whole LMP day counts, as for `horizon:
    "PREGNANCY"`); with no gestational age, within the last 300 days.
  - `PATIENT`: held until the question is answered again.
- **`values`** — optional, a non-empty list of strings, numbers or booleans, compared with
  `===` to the typed answer (so `true`, not `"true"`).
- **Import rules (hard errors):** an object with only `scope` and `values`; `scope` one of
  the two; `values`, when present, non-empty and of those three types; and the gate must
  have a condition on a `patient.<attribute>` (that attribute is what a later encounter is
  given).
- **Which gate carries it.** The answer is recorded against the gate the pending question
  belongs to. When two gates read the same attribute (a yes arm and a no arm) they share one
  question and either may own it, so put the **same** `remember_answer` on both.
- **⚠ The attribute must be registered.** Import accepts any `patient.<name>`, but
  activation compiles the pathway and refuses a `patient.*` attribute that is not in
  `KNOWN_PATIENT_ATTRIBUTES` (`apps/pathway-service/src/services/resolution/attribute-vocabulary.ts`)
  — error `UNKNOWN_PATIENT_ATTRIBUTE`, `validate-pathway.ts` exit 5. Registered today: the
  chart-derived `trimester`, `rh_factor`, `gestational_age_weeks`, and three
  provider-answered booleans added for remembered answers (2026-10-04):
  `on_prenatal_vitamin`, `tdap_given_this_pregnancy`, `rsv_vaccine_ever_given`. A new sticky
  attribute needs a row there (name, display, value type) before a pathway can use it; until
  then, ask with a `question` gate (not remembered) and say so in the brief. Routine prenatal
  care v3 uses `remember_answer` on `patient.rh_factor` (`PATIENT`), `patient.on_prenatal_vitamin`
  and `patient.tdap_given_this_pregnancy` (`PREGNANCY`, `[true]`), and
  `patient.rsv_vaccine_ever_given` (`PATIENT`, `[true]`).
- **Not a chart fact.** A remembered answer is a convenience: the encounter shows the
  attribute as supplied, and answering the question again replaces it. It needs the
  database (`patient_remembered_answers`), so `gate-proof.ts` can only show what a session
  does when the attribute is supplied — which is exactly what a later encounter is given.
- Source: `resolution/remembered-answers.ts`, `resolvers/mutations/resolution.ts`
  (recording), `import/validator.ts` (shape).

**Dated lab answers (josh-dev, 2026-10-03).** A lab answer may carry the day it was drawn
(`GateAnswerInput.observedOn`; the simulator's "drawn" date beside the value). Dated, it is
an ordinary dated result and several stand side by side — a baseline three weeks ago and a
recheck yesterday. Undated, it is "the value now": marked provider-asserted, and a later
one supersedes it. Series conditions (`delta_from_baseline`, trends) count only dated
values, and a series short of them now ASKS, however many it is short by.

- **Which conditions can be unresolved — the *numeric* conditions.** One definition,
  used by this spec, the brief template and `check-gate-control.ts` (which applies it, and
  every other condition lint, to leaves at any nesting depth):
  - coded `labs` or `vitals` with `greater_than` / `less_than`;
  - attribute conditions on `lab.*`, `vitals.*` or `patient.*` with any operator except
    `exists` (absence *is* the answer to `exists`). `patient.*` asks too since engine
    fix `8f64fc1` (josh-dev): a missing demographic reports `dataUnavailable` and asks for
    the `patient.<attr>` datum. (An **unmapped** `lab.*`/`allergy.*` — no code-map row —
    is a vocabulary gap, not a missing datum, and never asks.)

  Membership (`includes_code`, `equals`, `exists` on coded fields) never is unresolved:
  absence is a definite no. (`not_includes_code` is the one membership operator that can
  be: a matching code whose record validity or status cannot be decided makes it
  *indeterminate* — never asked, so the gate takes `default_behavior`.) `count_in_window` never is either — a count of zero is a real
  answer. **Trends and `delta_from_baseline` with fewer than `min_points` dated values in
  their window ARE unresolved** (`INSUFFICIENT_SERIES`, `engine-anchored-window`): "no
  recheck yet" is not "no response". When the series is exactly **one** value short (and
  the condition is on `labs` with an exact code) the gate asks for the newest result —
  *"Hemoglobin (g/dL) (LOINC 718-7) — newest result, drawn after 2026-05-29?"* — injected
  as a lab like any lab datum (same `LOINC:<code>` key). Short by more, no single answer
  can complete it: unresolved, no question, `default_behavior`. An unorderable series
  (`AMBIGUOUS_SERIES_ORDER`) is never asked anything. A `window_from` condition whose start
  date is unknown asks a DATE question (below).
- **Compounds:** OR is satisfied by any definite true; if nothing is true and some
  condition is unresolved, the gate is unresolved (a definite false does not outweigh an
  unknown). AND is unsatisfied by any definite false. A compound asks for **one datum at a
  time** — the first unresolved askable condition — so a gate with four missing labs can
  ask four times in sequence. **Nested groups** follow the same table at every level, and
  the asks come from nested leaves too (depth first) — except a leaf inside a group that
  settled on its own (an AND group with a definite false, an OR group with a definite
  true), which can change nothing and is never asked for.
- **Dedup:** the question is keyed on the datum (`LOINC:<code>`, `vitals.<path>`), so two
  gates reading the same missing lab raise ONE question; both stay held until it is
  answered.
- **Prompt text:** generated per datum. For labs it uses the condition's **`display`**:
  `"<display> (LOINC <code>) — most recent value?"` — so put a readable `display` (with the
  unit the threshold assumes, e.g. `"Platelets (x10^9/L)"`) on every lab condition. Vitals
  and attribute (`patient.*`, `vitals.*`, `lab.*`) prompts read `"<label> — current value?"`,
  the label being the condition's `display`, else the built-in label of a known `patient.*`
  attribute, else the path. **Do not set `prompt` on a chart gate that can ask for more than
  one datum:** an authored prompt replaces the generated one for every datum the gate asks
  for. On a gate that can only ever ask for one datum it is simply that question's wording
  (`check-gate-control.ts` warns only in the several-data case).
- **Question gates:** inert — an unanswered question always pends.
- **Choosing — decided, not per-gate (Josh, 2026-09-24): numeric gates ask when the value
  is missing.** Every gate with a numeric condition emits `on_unresolved: "ask"`. This is
  no longer an open clinical question for each gate: a missing lab, vital or gestational
  age must not silently decide a branch. `default` on a numeric gate is an **exception**,
  allowed only when the brief justifies it with an `[ON-UNRESOLVED DEFAULT — <gate-id>]`
  marker (see **Brief markers**) — e.g. an optional add-on where a missing value honestly
  means "not applicable". `check-gate-control.ts` fails a numeric gate set to `default`
  without that marker. A gate with **no** numeric condition gets `default`, because that
  is what the engine does (an `ask` there is inert and warned).
- **Simulator caveat:** composer labs are undated, so two results for one LOINC are
  `AMBIGUOUS_LATEST` and the gate asks; the injected answer is undated too, so it stays
  ambiguous (engine gap). Enter one value per LOINC when simulating.

### patient_attribute — single condition on recorded data

Carries one `condition` object, which is either an **attribute condition** or a **coded condition**. The two kinds have disjoint, strictly enforced key allowlists — an unknown key is a hard import error.

**Attribute condition** — allowed keys exactly: `attribute`, `operator`, `value`, `unit`, `horizon`, `status`, `display`, `note`.

> ⚠ **Simulator-visibility rule (2026-08-16):** prefer **coded conditions** for lab/vital
> thresholds. Attribute-form conditions (a) never render in the admin dashboard's "Fields
> this pathway reads" panel (harvested into a list no component displays), (b) need
> `pathway_attribute_code_map` rows that have no seeding path — unseeded, they resolve
> "attribute has no value" and the gate silently takes its default. Revisit when the
> dashboard renders the attributes list and code-map seeding exists.
>
> **`patient.*` is the exception — author gestational age and trimester as attribute
> gates** (updated 2026-09-24). `patient.*` needs no code-map row, and since engine fix
> `8f64fc1` (josh-dev) **a missing `patient.*` value is missing data, not a "no"**: under
> `v1` the gate reports `dataUnavailable`, and with `on_unresolved: "ask"` (the rule for
> numeric gates) it pends, holds its subtree and asks for the datum
> `patient.<attr>` (NUMERIC); the answer is injected into `patientAttributes` and the gate
> re-evaluates. `exists` is the one operator that still answers "no" on absence.
> Supply: the encounter simulator page sends `gestational_age_weeks` and `trimester`
> (since dashboard `8681821`; the backend derives trimester from GA), so those sessions
> decide immediately; the pathway-preview flow sends `{}`, so there the gate **asks**
> rather than silently gating out. `legacy-v0` still reads a missing value as "no". The
> "Fields this pathway reads" panel does not list these conditions (caveat (a)). Proof:
> `scripts/gate-proof.ts ga` (anemia `gate-iv-iron-ga`: GA 20 / 14 included, 12
> GATED_OUT, missing pends asking for `patient.gestational_age_weeks`).

```json
{ "attribute": "vitals.temperature_f", "operator": "greater_than", "value": 100.3, "horizon": "DAY" }
```

- `attribute` = `<namespace>.<name>`. Registered namespaces (hard error otherwise): **`lab`**, **`vitals`**, **`allergy`**, **`patient`** — plus the engine-supplied **`encounter`**, which has its own grammar (**Calendar condition** below) and none of the keys or operators listed here.
  - `lab.*` / `allergy.*` resolve through the DB table `pathway_attribute_code_map` (attribute_name → system+code+value_type). **An unregistered attribute name imports fine but silently resolves to undefined at runtime** ⇒ the gate falls back to `default_behavior`. Every `lab.*`/`allergy.*` attribute you emit must be listed in the brief's "Attribute-map registrations" section so it gets seeded.
  - `vitals.*` walks a dotted numeric path in the patient's vitalSigns bag (e.g. `vitals.systolic_bp`, `vitals.temperature_f`) — keys per **What the simulator sends**.
  - `patient.*` reads derived scalars with no terminology code (e.g. `patient.gestational_age_weeks`, `patient.trimester`, `patient.rh_factor`). No code-map row, no temporal policy (emit no `horizon`). A missing value **asks** (`on_unresolved: "ask"`; datum `patient.<attr>`) since `8f64fc1` — see the box above.
  - **`patient.rh_factor` is read tolerantly** (josh-dev, `[DECISION — Josh 2026-10-04]`: "Accept common spellings"). String comparisons are exact, so the engine normalises the *value* — from the chart, from a value added or answered during the session, and from a remembered answer — to one vocabulary before any gate compares it, and **comparands must be the canonical words**:

    | Canonical | Read from (any case, spacing, brackets, dots) |
    |---|---|
    | `positive` | positive, pos, `+`, Rh+, Rh positive, Rh pos, Rh(D) positive, RhD positive, Rh(D)+, D positive, D pos, D+, Rhesus positive |
    | `negative` | negative, neg, `-`, Rh-, Rh negative, Rh neg, Rh(D) negative, RhD negative, Rh(D)-, D negative, D neg, D-, Rhesus negative |
    | `weak D` | weak D, Du, weak positive, weakly positive, weak, weak D positive |
    | `partial D` | partial D |

    - **Anything else is left exactly as written** — "unknown", "pending", and ABO+Rh strings such as "O+", "A POS", "AB negative" (not parsed: not in the decision's list) — so a gate written `not_equals "positive"` still flags it, and the provider sees the chart's own words. Nothing is ever guessed toward positive.
    - `weak D` and `partial D` are their own values, never folded into `positive`: "anything not clearly positive" flags them.
    - A comparand in a recognised non-canonical spelling (`"Positive"`, `"Rh+"`, `"NEG"`, `"weak d"`) is an **import error** — no normalised value could ever equal it; the message names the word to write. Words that are not Rh spellings (`"unknown"`) are accepted as comparands.
    - Only `rh_factor` is normalised; every other `patient.*` value is compared as supplied.
- `operator` ∈ `equals`, `not_equals`, `greater_than`, `greater_or_equal`, `less_than`, `less_or_equal`, `in` (value = array), `exists`. Note: `exists` on an **absent** fact (e.g. an allergy the patient doesn't have) is unsatisfied — it no longer degrades to "attribute resolved" semantics (fixed post-kernel).
- There is **no** `symptom.*`, `medication.*`, or `condition.*` namespace (older docs said otherwise — they now hard-fail import). Symptom presence/severity is elicited ⇒ use a `question` gate. Diagnosis/medication history ⇒ use a coded condition.
- `horizon` / `status` — see **Temporal horizon & status** below; both are legal here exactly as on coded conditions.

**Calendar condition — `encounter.date` / `in_season`** (josh-dev, 2026-10-04) — allowed keys exactly: `attribute`, `operator`, `from`, `to`, `display`, `note`.

```json
{ "attribute": "encounter.date", "operator": "in_season", "from": "09-01", "to": "01-31" }
```

"Is the session's calendar date inside this season?" It is attribute-*shaped* but it is not
patient data: `encounter` is an engine-supplied namespace with one attribute, `date`, and
one operator, `in_season`. Usable as a `patient_attribute` gate's `condition`, as a leaf of a
`compound` gate, and inside nested groups.

- **`from` / `to`** — month-days, `"MM-DD"`, two digits each, **both inclusive**. A real day
  of a real month: `"13-01"`, `"02-30"`, `"04-31"` and `"9-1"` are import errors; `"02-29"`
  is valid.
- **Wrap-around.** `from` after `to` wraps the year end: `09-01` → `01-31` is September
  through January (Dec 31 and Jan 1 are both inside). `from` on or before `to` is a season
  inside one year. `from` equal to `to` is that single day. (There is no "all year" other
  than `01-01` → `12-31`; if a step is offered all year, it needs no season leaf.)
- **Feb 29.** A session on Feb 29 compares as `02-29`. As a bound in a year that has none,
  `to: "02-29"` ends on Feb 28 and `from: "02-29"` starts on Mar 1.
- **Which date.** The calendar date of the session's pinned clock (`evaluationAsOf`) in the
  session's timezone — **UTC for every session today** (the temporal context carries
  `timezone: "UTC"`; the engine honours an IANA zone there if one is ever stored). Never
  the wall clock: a session replayed next year answers what it answered when it was created.
  A visit late in the evening US time is therefore already "tomorrow" (UTC) on the last and
  first day of a season.
- **Never missing, never asks.** No chart entry, no code-map row, no `horizon`, no `status`,
  no `value` (each is an import error: an ignored key is an ignored author). The condition
  is always a definite true or false, so `on_unresolved` never applies to it; inside a
  compound, out of season settles an `AND` and in season settles an `OR`, whatever the
  other leaves could not resolve. The compiler records no datum for it and reachability
  classes a gate of only calendar leaves as always evaluable.
- **Evidence.** `Session date 2026-10-04 is within the season 09-01 to 01-31` /
  `… is outside the season …`; the gate records `encounter.date` among the fields it read.
- **Checked by one parser** at import, at compile, at session preflight and at evaluation.
- **`legacy-v0` sessions refuse it** (`in_season requires the v1 temporal kernel`).
- `in_season` on any other attribute, any other operator on `encounter.date`, and any other
  `encounter.*` attribute are import errors.
- **Build check.** `check-gate-control.ts`'s EXPLICIT HORIZON lint exempts `encounter.*`
  leaves (they read the clock, not chart data, and a `horizon` there is an import error);
  regression cases are in `test-pipeline-checks.ts`.

**Coded condition** — allowed keys exactly: `field`, `operator`, `value`, `system`, `threshold`, `window_days`, `count_threshold`, `min_points`, `slope_threshold`, `delta_threshold`, `delta_comparison`, `count_comparison`, `horizon`, `status`, `window_from`, `display`, `note`. (`window_from` is coded-only — see **Anchored trend windows** below; on an attribute condition it is an unknown key.)

```json
{ "field": "conditions", "operator": "includes_code", "value": "Z94.*", "system": "ICD-10" }
```

- `field` ∈ `conditions`, `medications`, `allergies`, `labs`, `vitals` — now **enforced at
  import** against the kernel's `FIELD_TO_KIND` map (an unknown field is a hard error, not
  a silent runtime skip).
- `operator` ∈ `includes_code`, `not_includes_code`, `equals`, `exists`, `greater_than`, `less_than`, `count_in_window`, `trend_up`, `trend_down`, `delta_from_baseline`. `value` is required.
- **`vitals` conditions may not set `system`** (hard import error, D9) — vitals carry no
  terminology code; `value` is the vitals path (e.g. `systolic_bp`). They **must** set
  `horizon` (temporal rule 0 below).
- **Numeric control domains (hard import errors post-kernel):** `threshold` /
  `delta_threshold` — finite numbers; `count_threshold` / `min_points` — positive
  integers; `slope_threshold` — finite **non-negative** number: it is a *magnitude*, the
  evaluator applies the sign (`trend_down` = slope < −slope_threshold), so a negative
  value would invert the clinical meaning.
- **`delta_comparison`** ∈ `at_least`, `less_than` — **`delta_from_baseline` only** (an
  error on any other operator, where it would be silently ignored). Makes the direction
  explicit: `at_least` ⇒ `current − baseline ≥ delta_threshold`; `less_than` ⇒
  `current − baseline < delta_threshold`. The two are exact complements on one threshold —
  write "responding" and "not responding" from the same number and no patient is both or
  neither. Compared at 1e-9, so an exact decimal rise (7.2 → 8.2) is exactly 1.0. Absent,
  the threshold's **sign** picks the direction (below) and "rose by less than t" has no
  encoding. `legacy-v0` refuses it.
- **`count_comparison`** ∈ `at_least`, `less_than` — **`count_in_window` only** (josh-dev,
  2026-10-04; an import error on any other operator, where it would be silently ignored and
  read as its inverse, and for any other value). `at_least` (the default when absent) ⇒
  count ≥ `count_threshold`; `less_than` ⇒ count < `count_threshold`. The two are exact
  complements on one threshold. `less_than` with `count_threshold: 1` is "none in the
  window" — with `window_from`, "nothing drawn since the treatment started". A count is
  never unresolved for want of a value (zero is an answer), so a `less_than` gate **never
  asks for a lab**; with `window_from` only an unknown start date is asked. `legacy-v0`
  refuses it.
- `display` / `note` are ignored by the evaluator. `display` on a **lab** condition is the
  label in the missing-data prompt — emit it on every lab condition (with unit).

Runtime semantics (from `gate-evaluator.ts`):

| Operator | Works on | Semantics |
|---|---|---|
| `includes_code` | conditions/medications/allergies/labs | Any entry's code matches `value`, `system` optional filter. **Wildcard: only a trailing `.*`** (`Z94.*`, `G82.2.*` = "starts with the part before `.*`"). Any other `*` — `G82.2*`, `D57.0*`, `O99.8*4` — is a literal character and matches nothing (`select-facts.ts` codeMatches). No hierarchy expansion. |
| `not_includes_code` | same | **No** entry's code matches `value` — the exact negation of `includes_code`: same `system` filter, same trailing-`.*` wildcard (import applies the same wildcard error), same `horizon`/`status` selection. **No code on file is a definite TRUE** (absence of a diagnosis is the answer; it never asks). A matching code whose record validity or clinical status can't be decided (e.g. `status: "active"` on a fact with unknown state, or a validity-unknown record) makes it **indeterminate, not true** — nothing is asked (there is no question for a problem-list code), so the gate takes `default_behavior`; with `status: "any"` every state counts and such a match is a definite false. Per condition, so it mixes with labs in one flat `AND`: `MCV < 80 AND not_includes_code D57.0.* AND not_includes_code D56.1 …` (one condition per code or prefix — `value` is a single code). `legacy-v0` negates its own `includes_code`. |
| `equals` | same | Exact code match — no wildcard (a `.*` here is literal) |
| `exists` | same | Field has ≥1 entry of any kind |
| `greater_than` / `less_than` | labs, vitals | For `labs`: `value` = the lab code, compare that lab's numeric result to `threshold` (falls back to `parseFloat(value)` — so always set `threshold` explicitly). For `vitals`: `value` = dotted path into vitalSigns |
| `count_in_window` | labs + code fields | Count entries matching `value` (+`system`; trailing `.*` wildcard allowed) whose **start** falls within `window_days` of the session clock (or since the `window_from` start day); satisfied when count ≥ `count_threshold` (default 2) — or, with `count_comparison: "less_than"`, when count < `count_threshold`. Omit `window_days` ⇒ the field's v1 default horizon (below): LIFETIME for conditions/medications/allergies (undated entries count), but **QUARTER for labs** (90 days; undated entries never count). A bounded window never counts an undated entry. A vitals count is always 0. |
| `trend_up` / `trend_down` | **labs only** | Linear-regression slope over dated values of lab `value` within `window_days`; needs ≥ `min_points` (default 3, floor 2) dated points; satisfied when slope > `slope_threshold` (up) or < −`slope_threshold` (down); default threshold 0 |
| `delta_from_baseline` | **labs only** | newest − oldest in-window value vs `delta_threshold`: with `delta_comparison`, `≥` (`at_least`) or `<` (`less_than`); without it, signed (positive = rose by ≥ that much; negative = fell by ≥ magnitude; 0 = changed at all); needs ≥ `min_points` (default 2) |

Fewer than `min_points` dated values in the window makes a trend/delta condition
**unresolved**, not false (see **Missing data**) — `on_unresolved` decides.

> ### ⚠ Baseline drift — a single long trend window is usually wrong
>
> `trend_up`/`trend_down` fit a regression across **every** dated point in the window. If
> the measured value has a physiologic trajectory of its own, a pre-treatment value from a
> different physiologic state sits in the window and drags the slope — often inverting the
> verdict.
>
> Worked example (real, caught in `anemia-in-pregnancy`): hemoglobin falls through
> pregnancy by hemodilution, so almost every patient has a NORMAL value early on. For
> anyone diagnosed in T2/T3 that value lands inside a pregnancy-length window, and a
> textbook responder — 12.8 early, 8.2 once anemic, 9.9 after iron — fits a **negative**
> slope. She reads as a nonresponder and gets escalated while responding perfectly well.
>
> **Pattern — layer the same trend at several lookbacks under `OR`:**
>
> ```json
> { "operator": "OR", "conditions": [
>   { "field": "labs", "operator": "greater_than", "value": "718-7", "system": "LOINC",
>     "threshold": 10.9, "horizon": { "days": 90 } },
>   { "field": "labs", "operator": "trend_up", "value": "718-7", "system": "LOINC",
>     "slope_threshold": 0.030, "min_points": 2, "window_days": 42 },
>   { "field": "labs", "operator": "trend_up", "value": "718-7", "system": "LOINC",
>     "slope_threshold": 0.015, "min_points": 2, "window_days": 120 },
>   { "field": "labs", "operator": "trend_up", "value": "718-7", "system": "LOINC",
>     "slope_threshold": 0.015, "min_points": 2, "window_days": 300 }
> ]}
> ```
>
> Short windows exclude the pre-treatment state; long windows still catch a slow responder.
>
> **Tier the slope with the window.** `slope_threshold` is in value-units per **DAY**. A
> short window must demand the BRISK early response rate (here 0.030 ≈ 1 g/dL per 4–5
> weeks); otherwise random lab wobble inside a few weeks reads as a response — a severely
> anemic patient bouncing 7.4 → 7.9 would be marked "responding". Longer windows take the
> flatter late-course rate (0.015 ≈ 1 g/dL per 9–10 weeks).
>
> **Pair with an absolute target where one exists.** A patient who has ARRIVED has a flat
> slope and fails every trend condition. The `greater_than` condition above is what catches
> her. It reads the latest value correctly on the `v1` kernel, which is the deployment default
> on main (`evaluation-context.ts:226`); a service still running `legacy-v0` takes whichever
> result is first in the array, not the most recent.
>
> None of these windows is anchored to the day treatment started. Layering approximates
> that by covering several plausible treatment durations at once. For a **response to
> treatment** gate, prefer `window_from` (below): it opens the window on the day the drug
> class was prescribed, so the pre-treatment state is excluded by construction.

### Anchored trend windows — `window_from` (response-to-treatment gates)

`window_from` replaces a condition's fixed lookback with an EVENT: the window opens on the
day a therapeutic **class** was started and closes at the session clock. Use it for "is the
patient responding to treatment?" gates.

```json
{ "field": "labs", "operator": "trend_up", "value": "718-7", "system": "LOINC",
  "display": "Hemoglobin (g/dL)", "slope_threshold": 0.015, "min_points": 2,
  "window_from": {
    "event": "medication_start",
    "clinical_role": "oral-iron-repletion",
    "label": "oral iron",
    "baseline_days": 28,
    "codes": [ { "system": "RXNORM", "code": "310325" }, { "system": "RXNORM", "code": "198630" },
               { "system": "RXNORM", "code": "284202" } ]
  } }
```

Rules (hard import errors unless marked; the validator calls the runtime parser
`parseConditionOverride` → `parseWindowFrom`, so import and runtime agree):

- **Operators:** only `count_in_window`, `trend_up`, `trend_down`, `delta_from_baseline`.
  On any other operator it is an error. On `count_in_window` it counts the entries dated from
  the start of the anchor day to the session clock — "how many since the treatment started" —
  and takes `count_comparison` (`at_least` / `less_than`, above), `count_threshold`,
  `min_days_since_anchor` and (since 2026-10-04) `baseline_days`.
- **Mutually exclusive** with `window_days` and with `horizon`. It *is* the window.
- `event` — required; `"medication_start"` is the only event.
- `clinical_role` — required, the **class** tag the pathway's Medication nodes carry
  (`oral-iron-repletion`), never one product. Anemia offers three interchangeable oral
  irons; anchoring on ferrous sulfate alone would gate every gluconate or fumarate patient
  out. *Warning* when no Medication node in the pathway has that role: the care-plan
  source (below) can then never match.
- `codes` — optional `[{system, code}]`: the chart medication codes that count as an order
  of the class (list every member product you want recognised; system compared
  case-insensitively, code exactly, no wildcard). *Warning* when absent: medication orders
  cannot anchor the window, so a patient with no stored care plan is always asked.
  *Warning* for every code a Medication node of the class carries (HAS_CODE → CodeEntry)
  that `codes` omits — copy the class's CodeEntry codes.
- `label` — optional, the class in words for the prompt: `"When did oral iron start?"`
  (default: the `clinical_role` with dashes as spaces).
- `baseline_days` — optional integer (1..36525), trends, deltas and (since 2026-10-04,
  josh-dev) `count_in_window`. On a count it makes the count run over **exactly the delta's
  point set** — the ONE latest value dated up to `baseline_days` before the start day, plus
  every value since — so `count_threshold: 2` with `less_than` is "the change cannot be
  measured yet" and with `at_least` "measurable". Two pre-treatment values and nothing since
  is still one point; a baseline older than `baseline_days` does not count. Without it a
  count sees only values since the start. Admits ONE pre-treatment baseline: the **latest** value dated within
  that many days *before* the anchor day. Use it for every "rise since treatment" delta:
  the diagnostic value is usually drawn before the prescription, and without it the window
  excludes the very value the rise is measured from — the patient then looks one value
  short, is asked for a result, and a clinician re-entering the value on file makes a
  responder read as "no change".
- `min_days_since_anchor` — optional integer (1..36525), any `window_from` operator. The
  condition is **NOT YET DUE** until that many days after the anchor day (due *on* day N:
  anchor 2026-06-01 + 14 ⇒ due 2026-06-15). Before then it is neither true nor false and
  the gate **closes without asking** — see **NOT YET DUE** below. Use it wherever the
  guideline says when the response is judged ("rise < 1 g/dL after 2–4 weeks" ⇒ `14`);
  without it, a day-5 recheck decides.
- No other keys.

**How the start date is resolved** — first hit wins, and there is **no silent fallback**:

| # | Source | Where it is read |
|---|---|---|
| 1 | **Clinician-entered date** | The session's answer for this anchor (a DATE answer). Outranks every record: prescribed ≠ started, and a patient already on the drug before the pathway has no in-episode order. Editable at any time, not only when asked. |
| 2 | **Earliest care-plan recommendation** | `patient_care_plan_interventions` (type MEDICATION) under the patient's `patient_care_plans`, whose `guideline_reference` names **this** pathway (any version) and a node whose `clinical_role` matches. **Earliest** plan `start_date` wins — each commit writes a new plan, so latest-wins would slide the window forward every visit. Read once at session start and pinned to the session. |
| 3 | **Earliest dated medication order** | Chart medication orders whose code is in `codes`, not INVALID, with a day- or instant-precision start on/before the clock. Earliest wins (so a refill cannot shrink the window; a *prior course* of the same drug would anchor too early — the clinician date fixes that). |
| 4 | **This visit's recommendation** (`SESSION_RECOMMENDATION`) | None of the above, but the **current traversal INCLUDES** a Medication node of this pathway carrying the `clinical_role` — the visit is starting the drug. The anchor is the session clock's day, and such an anchor is **never due at that visit** (NOT YET DUE even without `min_days_since_anchor`). Medications inside the gate's *own* subtree never count (a gate cannot be anchored by what it opens). Deliberately **last**: the pathway goes on recommending the drug at every recheck, so ranked above the care plan it would re-anchor on "today" at every visit and the check would never come due. **Refused when the chart says the course is already under way** — then this may be a recheck, and reading it as the start would close it NOT YET DUE and miss a nonresponder, so the anchor is **unresolved (row 5) and the date is asked**. The evidence: (a) an order of the class (`codes`) whose start is missing or coarser than a day (on the drug, since when unknown); or (b) with `min_days_since_anchor: N`, a result of the condition's **own** series (the delta's lab code) dated **≥ N days** before the session clock — the due rule's own arithmetic: had the drug started that day, the check would be due now. No upper age limit (a cap would re-hide the late recheck). Without `min_days_since_anchor`, (b) does not apply. Cost: a *start* visit whose chart already holds an older result (a routine early-pregnancy CBC) is asked too — the clinician answers today's date, the anchor becomes CLINICIAN, and the gate closes NOT YET DUE without blocking the plan. |
| 5 | **Unresolved** | The condition is *indeterminate*. With `on_unresolved: "ask"` the gate holds and asks one DATE question per anchor — "When did oral iron start?" — shared by every gate anchored on the same class; with `"default"` it takes `default_behavior`. |

The window is `[start of the anchor day (UTC), session clock]` — a lab drawn on the day the
drug was started **is** in the series — plus, with `baseline_days`, the latest value before
it. Everything else (`min_points`, `slope_threshold`, `delta_threshold`,
`delta_comparison`, `count_threshold`, start-bound selection) is unchanged.

**NOT YET DUE** (`min_days_since_anchor`, or a start at this visit). The condition is read
before anything is selected: if the session clock is before the due day, it is NOT YET
DUE — not "no" (a day-5 +0.3 is not a nonresponder) and not missing (no recheck is owed
yet). The gate is **GATED_OUT without a question, whatever `default_behavior` and
`on_unresolved` say**: neither branch opens, nothing blocks care-plan generation, and the
step hosting the gate (the recheck lab / schedule) carries the plan forward. It is
recorded as its own outcome — `excludeReason` `NOT_YET_DUE: due on/after <date> (…)`,
`notYetDue: true` on the node, `dueOn` on the node's `windowAnchors` — never as a definite
no. In a compound it is not a definite value: a definite false still settles an `AND` and
a definite true an `OR`; with nothing settling the gate, NOT YET DUE outranks every other
unresolved condition (so a missing trimester is not asked for on the start visit). A nested
group passes NOT YET DUE up on the same terms, so this holds at every level. Once
due, normal evaluation applies (incl. `INSUFFICIENT_SERIES` → ask for the newest result).

**Pattern — a response check from chart data: five gates, three steps** (the two response
gates since anemia v7; count gates in front of them since v14; the "unmeasurable" state since
v15 — all `[DECISION — Josh 2026-10-04]`). A condition gate cannot route several ways —
chart-derived branch routing does not exist; a multi-target condition gate raises
`unroutable_decision` — so every outcome is its own single-target gate:

1. On the step that carries the scheduled recheck, three gates on the SAME `window_from`:
   - **recheck-due** — `count_in_window`, `count_threshold: 1`, `count_comparison:
     "less_than"`, no `baseline_days`, `on_unresolved: "ask"` → the **recheck step** (orders
     the recheck and says what it decides);
   - **unmeasurable** — compound `AND(count at_least 1 (no baseline_days), count less_than 2
     with baseline_days, <the non-response gate's below-target group>)`, `on_unresolved:
     "ask"` → the **"cannot be measured yet" step** (repeat test, schedule, "not
     nonresponse" guidance). It can ask only the start date and whatever the below-target
     group asks (the trimester); the counts never ask for a value;
   - **rechecked** — compound `OR(count at_least 2 with baseline_days, <the response gate's
     at-target group>)`, `on_unresolved: "default"` with its `[ON-UNRESOLVED DEFAULT —
     <gate-id>]` marker → the **response-assessment step**. `default` because the at-target
     arm has its own horizon: with `ask`, a baseline older than that horizon is asked for
     again — the question this pattern exists to remove. The at-target arm keeps "at target
     → maintenance at once" working, the start visit included.
2. On the response-assessment step, two **response gates** on the SAME anchored delta,
   `at_least` and `less_than` the same threshold, `on_unresolved: "ask"`.

```json
{ "field": "labs", "operator": "count_in_window", "value": "718-7", "system": "LOINC",
  "display": "Hemoglobin (g/dL)", "count_threshold": 2, "count_comparison": "less_than",
  "window_from": { "event": "medication_start", "clinical_role": "oral-iron-repletion",
    "label": "oral iron", "codes": [ { "system": "RXNORM", "code": "310325" } ],
    "baseline_days": 28, "min_days_since_anchor": 14 } }
```

With `min_days_since_anchor: 14` on all of them and `baseline_days: 28` on the deltas and the
two-point counts ("points" = the latest value ≤ 28 days before the start + every value since):

| Visit / chart | Recheck-due (none since the start) → recheck step | Unmeasurable (one since, < 2 points, below target) → "recheck in 2–4 weeks" step | Rechecked (≥ 2 points, OR at target) → assessment step | Response gate → maintenance | Non-response gate → escalation |
|---|---|---|---|---|---|
| **start visit** — drug recommended this session, no care plan / order / clinician date | closed, NOT_YET_DUE — nothing asked | closed, NOT_YET_DUE | closed, NOT_YET_DUE | not evaluated | not evaluated |
| **start date unknown** (nothing stored and an Hgb ≥ 14 days old or an undated order; or the drug not recommended this session) | held — ONE question: "When did oral iron start?" | held (same question) | closed until answered (never asks) | not evaluated | not evaluated |
| **at target** (any visit, the start visit included) | NOT_YET_DUE, or by its count | closed — a definite no | **opens** | opens — maintenance at once | closed — a definite no |
| **before day 14** (any recheck, any rise) | closed, NOT_YET_DUE | closed, NOT_YET_DUE | closed, NOT_YET_DUE | not evaluated | not evaluated |
| day ≥ 14, **baseline only (not rechecked)**, or no dated value at all (the simulator) | **opens — the recheck is ordered; nothing asked** | closed | closed | not evaluated | not evaluated |
| day ≥ 14, **one value since the start and no baseline** (incl. a value typed in at the visit, a start-day value, or a baseline older than `baseline_days`), below target | closed | **opens — recheck scheduled; nothing asked; not nonresponse** (through anemia v14: the response gates asked "newest result, drawn after <date>?") | closed | not evaluated | not evaluated |
| day ≥ 14, two points, rise ≥ 1 | closed | closed | opens | opens | closed |
| day ≥ 14, two points, rise < 1 and below target | closed | closed | opens | closed | opens |

"Since the start" is from the **start of the anchor day**: a value drawn on the day the drug
was started counts as a value since the start, not as a baseline (flag it in the brief). An
at-target baseline at day ≥ 14 with nothing since the start opens **both** maintenance and
the recheck orders. The copied target groups keep the response gates' horizon: a lone value
since the start that is older than that horizon is outside the group, and the unmeasurable
gate then asks for the lab's "most recent value?" (answerable — never "drawn after today").
Say each of these in the brief.

NOT_YET_DUE asks nothing, so **the start visit's care plan is not blocked**
(the pipeline's readiness rules, `pipeline/readiness.ts`, block only on pending questions, unresolved nodes, red flags and unavailable safety data) — this replaces anemia v5's
"recheck not yet done" option. A *held* gate (the "start date unknown" row) is still a
pending question and does block generation until answered; the "not rechecked" and
"unmeasurable" rows ask nothing and block nothing. The day ≥ 14 rows need
the anchor from a record — the care plan the start visit committed, a dated order, or a
clinician date: the session source only ever produces NOT_YET_DUE.

Authoring notes:

- **One anchored trend replaces the layered lookbacks.** The pre-treatment value that the
  layering works around is outside the window by construction. Keep the absolute-target
  `greater_than` arm (a patient who has arrived has a flat slope), and keep its own
  `horizon`.
- **Tier the slope to the expected response rate across the whole course**, not to the
  shortest lookback: the window can be one week or four months long depending on the patient.
- **Emit `on_unresolved: "ask"`** on every gate with a `window_from` condition, or an
  unresolved start date silently takes `default_behavior`.
- **Simulator:** a synthetic patient has no stored care plans, and the simulator dates
  nothing — medications or labs — so the anchor resolves only from the clinician's date or
  this session's recommendation. If the session recommends the drug, the gates close
  NOT_YET_DUE (nothing asked) — unless the synthetic patient's medication list already
  holds a drug of the class (undated, so "on it since an unknown date"), which asks;
  otherwise the gate asks "When did … start?", the tester
  answers. **The series then still has no dated value.** With the count gates in front
  (anemia v14) an undated value is not "since the start", so a start date ≥
  `min_days_since_anchor` days back opens the **recheck step** and nothing more is asked;
  the response gates are not reached. (A response gate with no count gate in front asks for
  "a result, and the date it was drawn?".) A dated trend/delta arm is only
  exercisable through the API with dated labs (`labResults[].date`), not from the
  simulator UI.
- `legacy-v0` sessions refuse `window_from` conditions (they cannot anchor); `v1` is the default.

Time-shape notes: with `window_days` (or any bounded horizon) set, undated and future-dated
entries never count toward an aggregate. The clock is the session's pinned
`evaluationAsOf`, not wall time. Kernel semantics (v1): the
window selects on a fact's **start bound**, not interval overlap (D8); undated observations
are admitted as facts but are **not orderable** — they can satisfy membership operators but
cannot join a trend/delta series (D7); and when a condition's temporal state can't be
proven, the uncertainty propagates through `compound` gates rather than being coerced to
false — the gate is then *unresolved* and follows `on_unresolved` (see **Missing data**).

### System defaults (v1) — what an omitted `horizon` / `status` means

`v1` is the deployment default on main (`evaluation-context.ts:226`). A condition with no
`horizon` and no `window_days` inherits its field's system default
(`policy-registry.ts:70-84`; a pathway-level `temporal_defaults` row can override, but it
is not authorable from the JSON):

| Field | Default horizon | Default `status` |
|---|---|---|
| `conditions`, `medications`, `allergies` | `LIFETIME` | `active` (a fact with no clinical state — every simulator entry — counts as active) |
| `labs` | **`QUARTER`** (90 days) | n/a — `status` on labs is a preflight error |
| `vitals` | **`ENCOUNTER`** — rejects every session without `encounterStart` (rule 0) | n/a — `status` on vitals is a preflight error |

So "no horizon" never means "lifetime" for a lab: a platelet count 120 days old is outside
the default window. **The builder emits an explicit `horizon` (or `window_days`) on every
condition** — the brief's §17 value, or, when the brief gives none, the field's default
above, listed in the delivery message — and never emits `status` on labs or vitals.
`check-gate-control.ts` fails a condition with neither.

### What needs dated facts (and so cannot fire from the simulator)

The simulator dates nothing (see **What the simulator sends**). Undated facts are asserted
current (`OPEN(evaluationAsOf)`): they satisfy membership and scalar reads inside any
horizon, but they have no start, so:

| Operator | With undated facts |
|---|---|
| `includes_code`, `not_includes_code`, `equals`, `exists` | Work. |
| `greater_than`, `less_than` | One value per code works. Two or more undated values for one code cannot be ordered → `AMBIGUOUS_LATEST` → the gate is unresolved and asks; the injected answer is undated too, so it stays ambiguous (engine gap). |
| `count_in_window` | Counts undated entries **only** under `LIFETIME` (conditions/meds/allergies default). Any bounded window (and any `window_from`) → count 0 → a silent **"no"** (aggregates never ask) — which, with `count_comparison: "less_than"`, is a silent **"yes"**: the simulator opens a "nothing since the start" gate for every undated chart. |
| `trend_up`, `trend_down`, `delta_from_baseline` | Need `min_points` **dated** values. Undated values contribute no point: one → zero points, short by ≥ 2 → *unresolved* with nothing to ask → `default_behavior`; two or more → unorderable series (`indeterminate`, never asks → `default_behavior`, or the compound asks for a sibling scalar). |
| any aggregate with `window_from` | The anchor itself needs a date: no care plan and undated orders → the gate **asks** "When did … start?" (DATE) — unless this session recommends the class and nothing in the chart says the course is already under way (an undated order of the class, or with `min_days_since_anchor` a result of the series ≥ that many days old), which closes it NOT_YET_DUE. The series still needs dated lab values. |

Gates built on the last two rows are **untestable in the simulator** — say so in the brief
(§18) and the delivery message. In the current pathways: UTI `gate-recurrent-uti`, and anemia v7's `gate-hgb-response` / `gate-hgb-nonresponse` rise
arm (the simulator anchors oral iron on the session, so both close NOT YET DUE there). Since
anemia v14 the count gates in front of them make the *recheck step* reachable from the
simulator (a start date ≥ 14 days back, answered when asked), but the response assessment
behind `gate-rechecked` still needs a **dated** value since the start.

### Temporal horizon & status (per-condition, NODE tier — merged, emit freely)

Any attribute or coded condition may carry:

- **`horizon`** — how far back facts remain relevant to *this condition*. Either a named
  horizon — `"LIFETIME"`, `"YEAR"` (365 d), `"QUARTER"` (90 d), `"MONTH"` (30 d),
  `"WEEK"` (7 d), `"DAY"` (1 d), `"ENCOUNTER"`, `"PREGNANCY"` (josh-dev) — or a custom
  day-count object `{ "days": N }` with N an integer 1..36525 — or a season-opening date
  `{ "since": "MM-DD" }` (josh-dev). Named horizons are fixed day-widths counted back from
  `evaluationAsOf` (not calendar units), except `ENCOUNTER` (since `encounterStart`),
  `PREGNANCY` (since the LMP date), `{ "since_gestational_week": N }` (since week N of the
  pregnancy) and `{ "since": … }` (since a calendar date) — next three sections.
- **`status`** — which fact states count: `"active"`, `"inactive"`, or `"any"`.

#### `"PREGNANCY"` — since the start of this pregnancy (josh-dev, 2026-10-04)

`[DECISION — Josh 2026-10-04]`: "drawn this pregnancy needs to use the gestational age".

- **The window.** Lower bound = `evaluationAsOf` − `patient.gestational_age_weeks` × 7 days,
  floored to 00:00 UTC of that day. Gestational age is dated from the last menstrual period,
  so this is the **LMP date**, and a fact dated on that day counts. Fractional weeks are
  honoured (28.5 weeks = 199.5 days). Upper bound = `evaluationAsOf`, as for every horizon.
  At a session clock of 2026-10-04 and 28 weeks the window opens 2026-03-22.
- **Where it may be written.** On a condition's `horizon` only — coded conditions on any
  field (`labs`, `conditions`, `medications`, `allergies`, `vitals`) and `lab.*` /
  `vitals.*` / `allergy.*` attribute conditions, with every operator that honours `horizon`
  (`includes_code`, `not_includes_code`, `equals`, `exists`, `greater_than`, `less_than`,
  `count_in_window`, trends and deltas). **Not** as a pathway-level `temporal_defaults`
  default — refused with `PREGNANCY is a per-condition horizon`. Exclusive with
  `window_days` and `window_from`, like any `horizon`. Ignored on `patient.*` (no temporal
  policy), like any `horizon`.
- **Which gestational age.** The session's *effective* patient at each evaluation: the
  chart's `patientAttributes.gestational_age_weeks`, a value added mid-session, or the
  typed answer to the gestational-age question. It is **not** pinned when the session
  starts, so an age answered or corrected during the visit moves the window on the next
  evaluation.
- **Gestational age missing** (absent, not a number, ≤ 0, or more than 36525 days' worth):
  the condition is **unresolved** — `dataUnavailable`, never a "yes" and never a "no", for
  every operator including `not_includes_code` — and follows `on_unresolved`. (So `ask` on a
  membership gate that reads `PREGNANCY` is not inert, and `check-gate-control.ts` does not
  warn about it; `default` there needs no marker.) With `ask`
  the gate pends on **the same question a `patient.gestational_age_weeks` attribute gate
  asks** (`datumKey` `patient.gestational_age_weeks`, NUMERIC, "Gestational age (weeks) —
  current value?"), so every gate that needs the age shares one question and one answer
  decides them all. It never falls back to `LIFETIME` or to an empty window, and it never
  rejects the session.
- **Dated and undated facts** — the kernel's rules for any bounded window, unchanged: a
  dated lab is in when its date is on or after the LMP date; a condition or medication is
  an interval, so one that began earlier and is still open overlaps the pregnancy; an
  undated fact is asserted current and satisfies membership and threshold reads, and never
  counts toward an aggregate.
- **Evidence.** The reason reads `… within this pregnancy (since 2026-03-22, 28 weeks)`,
  and the gate records `patient.gestational_age_weeks` among the fields it read; the
  compiler lists it among the gate's datums.
- **`legacy-v0` sessions refuse it** (`horizon PREGNANCY requires the v1 temporal kernel`),
  as they refuse `window_from`; `v1` is the default.

#### `{ "since_gestational_week": N }` — since week N of this pregnancy (josh-dev, 2026-10-04)

`[DECISION — Josh 2026-10-04]`: "repeat CBC drawn since 24 weeks"; "a GDM screen drawn
before 24 0/7 weeks does not count as the 24–28-week screen".

```json
{ "field": "labs", "operator": "includes_code", "value": "718-7", "system": "LOINC",
  "display": "Hemoglobin (repeat CBC)", "horizon": { "since_gestational_week": 24 } }
```

It is `PREGNANCY` with the opening moved forward, and everything not stated here is as
stated there (which gestational age is read, where it may be written, per-condition only,
exclusive with `window_days` / `window_from`, the dated/undated rules, `legacy-v0`
refusal — message `horizon { since_gestational_week } requires the v1 temporal kernel`).

- **The window.** Lower bound = 00:00 UTC on (the LMP date + N × 7 days), the LMP date being
  exactly the one `PREGNANCY` opens on; upper bound = `evaluationAsOf`. At a session clock
  of 2026-10-04 and 28 weeks, the LMP date is 2026-03-22 and week 24 began 2026-09-06: a
  lab dated 2026-09-06 is in, one dated 2026-09-05 is out.
- **Grammar.** `N` is a number of weeks, above 0 and at most 45; fractions are allowed
  (`24.5`; `24 + 3/7 ≈ 24.43` for 24 3/7 weeks), floored to the day. `0` is refused — that
  window is `"PREGNANCY"`. The object takes no other key. There is no weeks+days form.
- **Gestational age missing** → exactly as `PREGNANCY`: the condition is unresolved and,
  with `on_unresolved: "ask"`, pends on the shared gestational-age question. Never a
  fallback window.
- **Gestational age below N — the window has not opened.** A **definite** outcome, never
  missing data, never a question and never an error: nothing can be inside a window that
  starts in the future, so every operator answers from an empty selection —

  | Operator | Before week N |
  |---|---|
  | `includes_code`, `equals`, `exists` | false |
  | `not_includes_code` | **true** |
  | `count_in_window` | count 0 — `at_least` false, `less_than` **true** |
  | `greater_than`, `less_than` (threshold) | false, and it does **not** ask for the lab |
  | `trend_*`, `delta_from_baseline` | false, and it does not ask |

  An undated chart entry — which an *open* window admits — is not inside it either. Because
  the "owed" forms are true, pair them with a `patient.gestational_age_weeks >= N` leaf
  (see **Done since a gestational week**). The window is open from the day week N begins,
  i.e. at exactly N weeks 0 days.
- **Evidence.** `… since week 24 of this pregnancy (from 2026-09-06; now 28 weeks)`, or,
  before it opens, `… since week 24 of this pregnancy, which has not begun (opens
  2026-11-01; now 20 weeks)`. The gate records `patient.gestational_age_weeks` among the
  fields it read and the compiler lists it among the gate's datums.

#### `{ "since": "MM-DD" }` — since the most recent occurrence of a date (josh-dev, 2026-10-04)

`[DECISION — Josh 2026-10-04]`: "can we add a calendar check?" — "this season".

```json
{ "field": "medications", "operator": "count_in_window", "value": "<influenza vaccine RxNorm code>",
  "system": "RXNORM", "status": "any", "count_threshold": 1, "count_comparison": "less_than",
  "display": "Influenza vaccine this season", "horizon": { "since": "07-01" } }
```

- **The window.** Lower bound = 00:00 on the most recent occurrence of that month-day **on
  or before** the session clock; upper bound = the clock. With `"07-01"`: a session on
  2026-06-30 looks back to 2025-07-01; a session on 2026-07-01 (from 00:00) or 2026-10-04
  looks back to 2026-07-01. So the window is between 0 and 365/366 days wide, and it
  resets on the date — which is the point.
- **Grammar.** `since` is `"MM-DD"`, two digits each, a real day of a real month (the
  same parser as `in_season`: `"13-01"`, `"02-30"`, `"9-1"` are import errors). The object
  takes no other key — `{ "since": …, "days": … }` is an import error. `"02-29"` opens on
  Feb 29 in a leap year and on Mar 1 in a year without one.
- **Timezone.** The date and the 00:00 are in the session's timezone — UTC for every
  session today (see the calendar condition above for what that means at a season's edge).
- **Where it may be written.** A condition's `horizon` only — everywhere `horizon` is
  honoured (coded conditions on any field; `lab.*` / `vitals.*` / `allergy.*` attribute
  conditions; membership, threshold, count, trend and delta operators). **Not** as a
  pathway-level `temporal_defaults` default (`{ since } is a per-condition horizon`).
  Exclusive with `window_days` and `window_from`, like any `horizon`; ignored on
  `patient.*`; not allowed on `encounter.date`.
- **Needs nothing from the patient.** The window is a function of the session clock alone:
  nothing can be missing, nothing is asked, and a replayed session resolves the same window.
- **Dated and undated facts** — the kernel's rules for any bounded window (identical to
  `{ "days": N }`, pinned by test):
  - a **lab** is a point: in when its date is on or after the opening date;
  - a **condition / medication / allergy** is an interval: membership operators
    (`includes_code`, `not_includes_code`, `equals`, `exists`) are satisfied by a record
    that *overlaps* the window, so one that started earlier and has no end date counts.
    `count_in_window` selects on the **start date**, so it counts only what *began* in the
    window — use it for an event such as a vaccine dose;
  - an **undated** fact is asserted current: it satisfies membership and threshold reads,
    and never counts toward an aggregate (`count_in_window` reads 0).
- **Evidence.** The reason reads `… since 2026-07-01 (this season)` — e.g.
  `Found 0 matching <code> in medications since 2026-07-01 (this season) (<1)`.
- **`legacy-v0` sessions refuse it** (`horizon { since } requires the v1 temporal kernel`).

Rules the **builder must enforce** (import accepts the keys but defers value/conflict
validation to session-creation preflight — a violation would import cleanly and then fail
at runtime):

0. **Every `vitals` condition carries an explicit, bounded horizon — `"DAY"` unless the
   brief says otherwise; never `ENCOUNTER`, never omitted.** Applies to coded
   `field: "vitals"` and attribute `vitals.*` conditions alike (attribute vitals reach the
   kernel with no code-map row). An omitted horizon inherits the v1 system default
   `ENCOUNTER` (`policy-registry.ts`), which needs an `encounterStart` on the session; the
   encounter simulator never sends one, so session preflight rejects with
   `MISSING_ENCOUNTER_ANCHOR` — and because preflight asserts **every matched pathway
   before traversing any** (`multi-pathway-resolution.ts`), one such condition kills the
   whole multi-pathway session, not just its own gate. Vitals are undated and asserted
   current at evaluation time (`context-assembler.ts`), so `DAY` admits them.
   `check-gate-control.ts` fails the build on a violation.

1. **`window_days` XOR `horizon`** — never both on one condition ("horizon supersedes
   window_days"; both-set throws `INVALID_TEMPORAL_DEFAULTS` at preflight). Verified: the
   import validator does NOT catch this.
2. `horizon` values must be from the grammar above; `status` from its enum. (`"PREGNANCY"`
   is upper-case like the other named horizons; `"pregnancy"` is `not a horizon`. A
   malformed `{ "since": … }` month-day is an import error.)
3. `window_days` itself must be a positive integer ≤ 36525 (also preflight-owned).

Authoring guidance: use `window_days` when the *operator* is inherently windowed
(`count_in_window`, trends, deltas — "2 UTIs in 180 days"); use `horizon` to scope which
facts are relevant at all ("only conditions active within the last year"); use `status`
to exclude resolved/historical diagnoses (`"active"` — the v1 default when omitted) or
deliberately include them (`"any"`).

### question — elicited from the provider at the encounter

```json
{
  "title": "Prior cesarean?",
  "gate_type": "question",
  "default_behavior": "skip",
  "prompt": "Was the prior uterine surgery a cesarean delivery?",
  "answer_type": "BOOLEAN"
}
```

- `answer_type` ∈ `BOOLEAN`, `NUMERIC`, `SELECT` — **uppercase** (fixture + runtime use uppercase; omitting defaults to BOOLEAN).
- `SELECT` requires a non-empty `options` string array. Import checks it only when
  `answer_type` is the exact lowercase string `"select"` (`validator.ts:448`); the
  spec-compliant uppercase `"SELECT"` skips the check, so import will not catch missing
  options — emit them anyway; a SELECT question without options renders broken. (The
  vocabulary check on `answer_type` itself is case-insensitive.)
- Use for symptom presence (`BOOLEAN`) and severity (`SELECT` with e.g. `["mild","moderate","severe"]`, or `NUMERIC` for validated scales). Never invent an ordinal attribute for severity.

### prior_node_result — ⚠ importable since v6, still not emitted by this pipeline

Runtime contract: `depends_on: [{ "node_id": "step-3-1", "status": "INCLUDED" }]` with `status` from `INCLUDED`, `EXCLUDED`, `GATED_OUT`, `PENDING_QUESTION`, `TIMEOUT`, `CASCADE_LIMIT`, `UNKNOWN` (compared exactly). The import validator now checks that object shape (`validateDependsOn`): a bare node-id string is rejected with the rewrite to use, `status` must be one of the above, and — main's rule (evaluation pipeline, spec C2) — **the target may not be a Medication**, because a medication can be withheld after traversal by safety or conflict selection. A `prior_node_result` gate also needs a non-empty `depends_on`.

So the gate type is no longer import-blocked. **Still do not emit it**: no `gate-proof.ts` proof covers it, and its verdict depends on the depended-on node having been disposed before the gate is reached. Model the dependency structurally (place the dependent node under the node it depends on) until a proof exists.

### compound — AND/OR over multiple conditions

```json
{
  "title": "Uncontrolled T2DM on metformin",
  "gate_type": "compound",
  "default_behavior": "skip",
  "operator": "AND",
  "conditions": [
    { "field": "medications", "operator": "includes_code", "value": "6809", "system": "RXNORM" },
    { "field": "labs", "operator": "greater_than", "value": "4548-4", "system": "LOINC", "threshold": 7.0 }
  ]
}
```

`operator` ∈ `"AND"` / `"OR"`; `conditions` non-empty, each an attribute or coded condition (mixing kinds is fine) **or a nested condition group**.

#### Nested condition groups (branch `engine-nested-groups` off josh-dev — not on main yet)

A `conditions` entry may itself be a **group**: `{ "operator": "AND" | "OR", "conditions": [ … ] }`
— the compound gate's own `(operator, conditions)` pair, so a whole compound body lifts into
a group unchanged. Optional `display` / `note` (UI decorators, ignored by the evaluator); no
other keys. An entry is a group exactly when it has a `conditions` array.

Import rules (hard errors, even in draft — `validator.ts` `validateGateConditions`):
- `operator` is **required** on a group (`AND`/`OR`, case-insensitive). No implicit AND.
- A group must be **non-empty**.
- At most **4 levels of AND/OR, counting the gate's own `operator`** — a group directly in
  the gate's `conditions` is level 2, so groups nest three deep (`MAX_CONDITION_NESTING`).
- A group may not also carry `field`/`attribute`, and may appear only in a **compound**
  gate's `conditions` — never as a `patient_attribute` gate's single `condition`.
- Every leaf, at any depth, is validated by exactly the top-level rules (the same runtime
  parsers: key allowlists, operators, horizon/status, `window_from`, wildcard grammar).
  Errors name the path: `Gate "g" condition[1].conditions[0]: …`.

Semantics — the flat truth table, applied at every level (three-valued):

| Group | Children | Group value |
|---|---|---|
| AND | any definite false | **definite false** — settles it, whatever else is unknown |
| AND | all definite true | definite true |
| OR | any definite true | **definite true** — settles it |
| OR | all definite false | definite false |
| either | otherwise (nothing settles, ≥1 child unresolved) | **unresolved**, keeping its kind(s): missing data (`dataUnavailable`), indeterminate, or NOT YET DUE |

- An unresolved group reads to its parent exactly like an unresolved leaf; a settled one
  exactly like a definite leaf.
- **NOT YET DUE** never settles anything, and when nothing settles a group it outranks the
  group's other unresolved children, at every level. If a not-due leaf reaches the top
  unsettled, the gate closes NOT_YET_DUE without asking.
- **What is asked** (`on_unresolved: "ask"`): the gate's unresolved leaves, depth first, in
  authored order — skipping every leaf under a group that settled on its own. One datum per
  pending question, deduplicated by datum key as always.
- The evidence trail (`contextFieldsRead`, `uncertainty`, `windowAnchors`) includes nested
  leaves; a nested group's reason reads `all of (…)`, `not all of (unsatisfied: …)`,
  `any of (satisfied: …)` or `none of (…)`.
- `legacy-v0` sessions compose groups as plain booleans (and still refuse `window_from`).

**Worked example — anemia's oral-iron response check.** "Responding = Hgb rise ≥ 1 g/dL
since oral iron started, OR Hgb at target (≥ 11 g/dL in trimesters 1/3, ≥ 10.5 in
trimester 2)"; not responding is the exact complement. Two single-target gates:

```json
{
  "title": "Responding to oral iron (Hgb +≥1 g/dL since start, or at trimester target)",
  "gate_type": "compound", "default_behavior": "skip", "on_unresolved": "ask",
  "operator": "OR",
  "conditions": [
    { "field": "labs", "operator": "delta_from_baseline", "value": "718-7", "system": "LOINC",
      "display": "Hemoglobin (g/dL)", "delta_threshold": 1.0, "delta_comparison": "at_least", "min_points": 2,
      "window_from": { "event": "medication_start", "clinical_role": "oral-iron-repletion", "label": "oral iron",
        "codes": [ { "system": "RXNORM", "code": "310325" }, { "system": "RXNORM", "code": "198630" },
                   { "system": "RXNORM", "code": "284202" } ],
        "baseline_days": 28, "min_days_since_anchor": 14 } },
    { "operator": "AND", "display": "At target, trimester 1 or 3 (Hgb ≥ 11)", "conditions": [
      { "attribute": "patient.trimester", "operator": "in", "value": [1, 3] },
      { "field": "labs", "operator": "greater_than", "value": "718-7", "system": "LOINC",
        "display": "Hemoglobin (g/dL)", "threshold": 10.95, "horizon": { "days": 28 } } ] },
    { "operator": "AND", "display": "At target, trimester 2 (Hgb ≥ 10.5)", "conditions": [
      { "attribute": "patient.trimester", "operator": "equals", "value": 2 },
      { "field": "labs", "operator": "greater_than", "value": "718-7", "system": "LOINC",
        "display": "Hemoglobin (g/dL)", "threshold": 10.45, "horizon": { "days": 28 } } ] }
  ]
}
```

The non-response gate is its **leaf-wise De Morgan negation**: swap AND ↔ OR and replace
each leaf with its exact complement (`at_least` ↔ `less_than` on the same
`delta_threshold`, `greater_than` ↔ `less_than` on the same `threshold`, trimester
`in [1, 3]` ↔ `equals 2`):

```json
{
  "title": "Not responding to oral iron (Hgb +<1 g/dL since start, and below trimester target)",
  "gate_type": "compound", "default_behavior": "skip", "on_unresolved": "ask",
  "operator": "AND",
  "conditions": [
    { "field": "labs", "operator": "delta_from_baseline", "value": "718-7", "system": "LOINC",
      "display": "Hemoglobin (g/dL)", "delta_threshold": 1.0, "delta_comparison": "less_than", "min_points": 2,
      "window_from": { "event": "medication_start", "clinical_role": "oral-iron-repletion", "label": "oral iron",
        "codes": [ { "system": "RXNORM", "code": "310325" }, { "system": "RXNORM", "code": "198630" },
                   { "system": "RXNORM", "code": "284202" } ],
        "baseline_days": 28, "min_days_since_anchor": 14 } },
    { "operator": "OR", "display": "Not at target unless trimester 2 (Hgb < 11)", "conditions": [
      { "attribute": "patient.trimester", "operator": "equals", "value": 2 },
      { "field": "labs", "operator": "less_than", "value": "718-7", "system": "LOINC",
        "display": "Hemoglobin (g/dL)", "threshold": 10.95, "horizon": { "days": 28 } } ] },
    { "operator": "OR", "display": "Not at target unless trimester 1/3 (Hgb < 10.5)", "conditions": [
      { "attribute": "patient.trimester", "operator": "in", "value": [1, 3] },
      { "field": "labs", "operator": "less_than", "value": "718-7", "system": "LOINC",
        "display": "Hemoglobin (g/dL)", "threshold": 10.45, "horizon": { "days": 28 } } ] }
  ]
}
```

Authoring rules this example carries:
- **Write the complement by De Morgan, never by re-deriving the rule.** Negation commutes
  with the three-valued connectives, so the pair are complements in every state *whose
  leaves are exact complements*: with all data present exactly one opens; with the
  trimester unknown both decide together or both hold together, never one open and one
  held. The trimester leaves `in [1, 3]` / `equals 2` complement each other only on
  {1, 2, 3} — an out-of-domain value (4, or the string `"2"`) makes both false, and a rise
  < 1 with Hgb ≥ 10.5 then opens neither gate. (`not_equals 2` in place of `in [1, 3]`
  closes that gap, reading any non-2 value as trimester 1/3 — an open choice.) A re-derived complement (e.g.
  `OR(AND(T1/3, < 11), AND(T2, < 10.5))`) is the same rule on complete data but not once a
  value is unknown. (Proven for every Hgb 9.0–13.0 × rise −0.5…+1.5 at 0.1 g/dL, in every
  trimester and with the trimester unknown: `anemia-nested-response-gates.test.ts`.)
- **"≥ x" on a coded lab is `greater_than` the half-step below x; "< x" is `less_than` the
  same number** (`10.95` for 11 at 0.1 g/dL precision). Coded lab operators are strict, and
  one shared threshold makes the two leaves exact complements.
- `patient.trimester` (derived from `gestational_age_weeks` at 14/28 weeks when only GA is
  known) keeps each arm one leaf; a GA range would need a nested group per arm.
- Outcomes: at the **start visit** (oral iron recommended this session) both close
  NOT_YET_DUE unless Hgb is already at target, which opens *responding* at once (accepted);
  with the trimester unknown at the start visit both close NOT_YET_DUE and nothing is asked.
  At a due recheck, an unknown trimester is asked for (one question) whenever the rise is
  < 1 and Hgb ≥ 10.5 — **including Hgb ≥ 11, which is at target in every trimester**, and
  at the start visit an unknown trimester keeps an Hgb ≥ 11 from opening *responding*.
- **Chosen (Josh, 2026-09-24; anemia v7):** the reordered at-target arm `OR(Hgb ≥ 11,
  AND(trimester 2, Hgb ≥ 10.5))`, complement `AND(Hgb < 11, OR(trimester ≠ 2, Hgb <
  10.5))`, is the same rule whenever the trimester is known, and with it unknown asks for
  it only for Hgb in [10.5, 11). Shipped with `not_equals 2` in place of `in [1, 3]`, so the
  trimester leaves are complements for every value. The shape above stays the fixture's
  reference form.

### llm_text_analysis — narrative-driven branching

```json
{
  "title": "Chest pain character triage",
  "gate_type": "llm_text_analysis",
  "default_behavior": "traverse",
  "input_attribute": "freeformData.narrative.chief_complaint",
  "branches": [
    { "name": "typical-angina", "description": "Pain is exertional, substernal, relieved by rest or nitroglycerin" },
    { "name": "atypical", "description": "Pain lacks ≥2 typical features", "is_safe_default": true }
  ],
  "confidence_threshold": 0.8
}
```

- `input_attribute` — dotted path into the patient context's `freeformData` bag holding the narrative to analyze.
- `branches` — declared options the model must pick from; exactly one should have `is_safe_default: true` (fallback when confidence < threshold or the LLM call fails; if none, first branch). Branch `name`s should correspond to the gate's `BRANCHES_TO` targets' intent.
- `confidence_threshold` — below it the gate routes the safe default but surfaces as a *tentative* pending question for provider confirmation. Default 0.75.
- Use only where the decision genuinely lives in narrative (HPI character, mechanism of injury) — if a structured value can answer it, use `patient_attribute`.

### Validator gaps recheck (josh-dev at main `f0c2ca1`)

Closed on josh-dev (each was a gap at `a428da5`): `depends_on` is validated in the shape the
runtime reads (see **prior_node_result**); SELECT `options` are required whatever the case of
`answer_type`; a code wildcard the engine cannot match is rejected at import (only one
trailing `.*`); the temporal override rules — `window_days` XOR `horizon`, horizon grammar,
no `status` on labs/vitals — are enforced at import as well as at session preflight. **None
of these four checks is on `origin/main`**, where they remain builder-enforced only.
New from main: `depends_on` may not target a Medication.
The builder rules and `check-gate-control.ts` still apply in full.

### Brief markers (read by `check-gate-control.ts`)

Some lints allow a documented exception. The exception is written in the research brief,
not the JSON, as a bracketed marker on the line that gives the clinical reason. The check
finds the brief at `pathways/briefs/<logical_id>-research-brief.md` (next to the JSON's
`json/` directory), or wherever `--brief <path>` points, and reads it only when a marker is
needed. An em dash or `-`/`--` separates tag and ids.

| Marker | Allows | Without it |
|---|---|---|
| `[ON-UNRESOLVED DEFAULT — <gate-id>]` | a numeric gate with `on_unresolved: "default"` | error — numeric gates ask |
| `[SECOND ROUTE — <node-id> via <source-id>]` | a node inside a gated region that a route from outside the gate also reaches (the source is the edge's `from`; a Criterion's route is named by its DecisionPoint) — e.g. anemia's empiric-iron Stage 1.5 sharing Stage 2's steps, `[SECOND ROUTE — step-2-3 via stage-2-empiric]` (one marker per node and source) | **error** (Rule 1); with it, an `ℹ` info line so the route stays visible |

### Brief stamp (read by `check-brief-sync.ts`)

The brief is the source of truth and the JSON is derived from it, so every brief names the
JSON it describes in **one** stamp line in its header — after the `# ` title, before the
first `## ` heading:

```
JSON: pathways/json/<logical_id>.json @ version <version>
JSON: (not built)
```

`<version>` is `pathway.version` verbatim, compared as a trimmed string (`"version": "5"`
↔ `@ version 5`); §1's `- **Version**:` must say the same. Nothing else goes on the line.
`scripts/check-brief-sync.ts` fails when a JSON under `pathways/json/` has no brief, the
brief has no stamp (or two, or a malformed one, or `(not built)`), the stamp names another
JSON or version, a stamp names a JSON that does not exist, or a JSON's `logical_id` is not
its filename. It runs inside `validate-pathway.ts` (exit 4) and in the pre-commit hook
(`--staged`, which also fails when a JSON is staged without its brief). **Never change a
pathway JSON without updating its brief in the same commit** — see the builder SKILL.md.

## What the simulator sends (author gates against THIS)

Derived from the admin dashboard's encounter simulator — `PatientComposer.tsx` (payload
built in `handleResolve`) and `app/encounter/page.tsx` (the `patientAttributes` merge), in
`prism-admin-dashboard`. A gate that reads a key, field or code system not in this table
never fires in the simulator: it silently answers "no" (membership) or asks forever
(scalar).

| Payload | Gate field / namespace | What arrives | Code system | Dated? | Notes |
|---|---|---|---|---|---|
| `conditionCodes` | `conditions` | typeahead codes | **ICD-10** | no | No `clinicalState`, so `status: "active"` fails open to active. Z-codes such as `Z88.0` (allergy *status*) arrive here, not in allergies. |
| `medications` | `medications` | typeahead codes | **RXNORM** | no | |
| `allergies` | `allergies` | typeahead codes | **SNOMED** | no | SNOMED *findings* such as `91936005` Allergy to penicillin. **Never ICD-10** — an ICD-10 code under `allergies` can never match a simulator patient. |
| `labResults` | `labs` | `{code, value, unit}` | **LOINC** | **no** | One value per LOINC: two undated results for one code are `AMBIGUOUS_LATEST` and the gate asks. |
| `vitalSigns` | `vitals` (coded `value`, or `vitals.<key>`) | numbers | none (never set `system`) | no — asserted current | Keys exactly: `systolic_bp`, `diastolic_bp` (mmHg), `heart_rate` (bpm), `respiratory_rate` (/min), `spo2` (%), **`temperature_f` (°F)**, `weight_kg`, `height_cm`, `bmi` (auto from height+weight), `custom.<key>`. There is **no `temperature_c`**, and blood pressure is a vital, **not** LOINC `8480-6`/`8462-4` labs. |
| `freeformData.narrative` | `llm_text_analysis` `input_attribute` | text | — | — | `chief_complaint`, `history_of_present_illness`, `social_history`, custom keys flattened alongside. |
| `patientAttributes` | `patient.*` | `gestational_age_weeks`, `trimester` | — | — | Encounter page only (trimester derived from GA when only GA is given). The pathway-preview flow sends `{}`, so a `patient.*` gate asks there (it does not silently answer "no"). |
| `encounterStart` | — | **never sent** | — | — | Any condition resolving to an `ENCOUNTER` horizon rejects the session (temporal rule 0). |

Consequences for authoring:
- **Code system per field is fixed:** conditions ICD-10, medications RXNORM, allergies
  SNOMED, labs LOINC. A clinical fact recorded in two systems (penicillin allergy: SNOMED
  finding in `allergies`, ICD-10 `Z88.0` status code in `conditions`) is one `OR` across
  both fields, never one system placed in the other's field.
- **No hierarchy expansion:** `includes_code` matches the literal code (or a trailing
  `.*` prefix for ICD-10-style codes). A SNOMED parent does not match its children — list
  the common children explicitly.
- **Blood pressure and temperature are vitals.** Author them as `field: "vitals"` with
  `horizon: "DAY"`. Do **not** OR a lab form with the vitals form: with a normal vitals
  BP and no lab, the vitals condition is a definite false and the lab condition is
  unresolved, so the OR asks for the lab forever.
- **Nothing is dated.** Trend, delta and `count_in_window` operators need dated facts and
  cannot fire from the composer (see **What needs dated facts**).

## Edges

`{ "from": "<id|root>", "to": "<id>", "type": "<TYPE>", "properties": { } }` — endpoint types are enforced:

| Edge | From | To | Meaning |
|---|---|---|---|
| `HAS_STAGE` | root | Stage | Top-level stage (≥1 required) |
| `HAS_STEP` | Stage | Step | Step within stage |
| `HAS_DECISION_POINT` | Step | DecisionPoint | Decision after a step |
| `HAS_CRITERION` | DecisionPoint | Criterion | Branch criterion |
| `BRANCHES_TO` | DecisionPoint, Gate | Step, Stage | Routing target. On a multi-target (router) gate every edge carries `properties.when`: `{"equals": true}` / `{"equals": false}` (BOOLEAN), `{"equals": "<option>"}` (SELECT / LLM branch name), or `{"gte": a, "lt": b}` half-open ranges, either bound omissible (NUMERIC) — `import/branch-when.ts` |
| `SELECTS_BRANCH` | Criterion | Step, Stage | "If this criterion, then that branch" — pins each criterion to its BRANCHES_TO target so the engine can compute exclusion lineage and the UI can show the mapping. Emit one per criterion whenever the brief maps criteria to targets |
| `USES_MEDICATION` | Step | Medication | |
| `ESCALATES_TO` | Medication | Medication | Escalation chain |
| `HAS_LAB_TEST` | Step | LabTest | |
| `HAS_IMAGING` | Step | Imaging | |
| `HAS_PROCEDURE` | Step | Procedure | |
| `HAS_GUIDANCE` | Step | Guidance | |
| `HAS_QUALITY_METRIC` | Step | QualityMetric | |
| `HAS_SCHEDULE` | Step | Schedule | |
| `HAS_CODE` | Step, Criterion, Medication, LabTest, Imaging, Procedure | CodeEntry | ⚠ not from Gate, Guidance, Stage, or DecisionPoint |
| `HAS_GATE` | Step, Stage, DecisionPoint | Gate | Gate attachment |
| `CITES_EVIDENCE` | Stage, Step, DecisionPoint, Criterion, Medication, LabTest, Imaging, Procedure, Guidance | EvidenceCitation | ⚠ not from Gate, CodeEntry, QualityMetric, or Schedule — attach their evidence to the parent Step |
| `REQUIRES` | Stage, Step | Stage, Step | Prerequisite: reads "X REQUIRES Y" = Y must be done first. Powers the catch-up/backtracking pass (e.g. first prenatal visit at 28w surfaces the missed 20w anatomy scan). Points backwards by design; excluded from depth calc; its own subgraph must be acyclic |

A Stage **or Step** reached via `BRANCHES_TO` (from a DecisionPoint or Gate) gets **no**
structural parent edge — no root `HAS_STAGE` for a Stage, no `stage-N HAS_STEP` for a Step.
All other stages need their `HAS_STAGE`; all other steps need their `HAS_STEP`. Leaving the
structural edge in place is what makes a gate inert — see the Gate wiring box above.

## Graph rules (import-enforced)

- ≤ **500 nodes**, ≤ **5000 edges**, depth ≤ **50** (warning above 30).
- A cycle in the main graph surfaces as `depth exceeds maximum` — if you see that error on a small graph, hunt for a `BRANCHES_TO`/`HAS_GATE` edge pointing back upstream.
- The `REQUIRES` subgraph gets its own cycle check with named nodes.
- ≥1 Stage node; ≥1 `root → HAS_STAGE` edge.
- Every Gate: ≥1 outbound edge. DecisionPoint without `BRANCHES_TO`: warning. Orphan nodes: warning.
- **Not import-enforced:** gate control (Rules 1 & 2 in the Gate wiring box). The validator
  accepts an inert gate silently — `scripts/check-gate-control.ts` is the only check. Rule 3
  IS import-enforced on main; `check-gate-control.ts` repeats it so a stale checkout cannot
  hide it.
- Duplicate node ids, unknown node/edge types, dangling edge refs: errors.

## Code format patterns (import-enforced)

| System | Pattern | Example |
|---|---|---|
| ICD-10 | `^[A-Z]\d{2}(\.\w{1,4})?$` (case-insensitive) | `N39.0`, `O34.211` |
| LOINC | `^\d{1,5}-\d$` | `4548-4` |
| CPT | `^\d{5}$` | `81001` |
| SNOMED | `^\d{6,18}$` | `68566005` |
| RXNORM | no format check | `6809` |

## Upload

Output file: `pathways/json/<logical_id>.json`. Upload via the Prism Admin Dashboard's pathway import. Import modes: `NEW_PATHWAY`, `DRAFT_UPDATE`, `NEW_VERSION` — new `logical_id` ⇒ NEW_PATHWAY; same `logical_id` + bumped `version` ⇒ NEW_VERSION; same version drafting ⇒ DRAFT_UPDATE. The dashboard's draft mode relaxes required-prop/wiring checks to warnings, but this pipeline always emits publish-grade JSON (strict validation, no draft allowances).

## Validation CLI

From the repo root (needs `npm ci` once):

```bash
npx ts-node --transpile-only .claude/skills/pathway-json-builder/scripts/validate-pathway.ts pathways/json/<logical_id>.json
```

Exit 0 = valid (warnings allowed but review them), 1 = invalid with every error listed, 2 = unreadable file. The CLI imports `validatePathwayJson` straight from pathway-service source — passing here means the import endpoint's own validator passes.

Smoke test (known-valid mini pathway exercising a time-shape coded gate and an attribute gate):

```bash
npx ts-node --transpile-only .claude/skills/pathway-json-builder/scripts/validate-pathway.ts .claude/skills/pathway-json-builder/references/example-pathway.json
```
