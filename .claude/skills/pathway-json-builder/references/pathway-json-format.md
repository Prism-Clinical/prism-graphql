# Prism Pathway JSON Format — Authoritative Spec (v5)

> **Generated from `origin/main`:** commit `a428da5` (2026-09-10) of
> `apps/pathway-service/src/services/import/`, `src/services/resolution/`, and `src/types/`
> — includes the temporal-horizon evaluator kernel (PR #54), the `v1` temporal policy as the
> deployment default, and PR #55's decision semantics (multi-branch `when` routing,
> `on_unresolved`, required `branch_mode`, gate enum validation).
>
> **Build from a branch based on current `origin/main`.** `scripts/validate-pathway.ts`
> imports the validator from the checkout it runs in and refuses to run when HEAD does not
> contain `origin/main`. A stale checkout is how two pathways once "passed" here and then
> failed main's import.
>
> **Drift check (do this every time you build a JSON):** run
> `git fetch origin && git log -1 --format=%h origin/main -- apps/pathway-service/src/services/import apps/pathway-service/src/services/resolution apps/pathway-service/src/types`
> — compare against **`origin/main`, never local HEAD**. If the hash is not `a428da5`, the
> schema may have moved: `git diff a428da5 origin/main -- <those paths>`, apply any changes to
> your output, and update this document.
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
| `Stage` | `stage_number`, `title` | `description` |
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
> **Rule 1 — a gated node must have its gate as the only way in.** If a Step is behind a
> gate, it gets **no** `stage-N HAS_STEP` edge, and nothing else may `BRANCHES_TO` /
> `SELECTS_BRANCH` into it. This is the same rule stated for Stages under the edge table,
> applied to Steps.
>
> **Rule 2 — exactly one gate may point at a given target.** Two gates on one target is a
> deterministic AND: **any gate that misses excludes the shared target**, in either
> evaluation order, and a satisfied gate cannot rescue it (re-verified on `a428da5`).
> **Gates do not OR.** Mutually exclusive alternatives
> (e.g. trimester-specific thresholds) must be merged into one gate or given separate
> targets. Compound gates cannot express this either — `conditions` is a flat list under a
> single `operator`, so `(A AND B) OR (C AND D)` has no encoding.
>
> **Rule 3 — a chart gate has exactly ONE `BRANCHES_TO` target.** A `patient_attribute`,
> `compound` or `prior_node_result` gate with several targets is an import error on main
> (it has no answer to route on), and a `question`/`llm_text_analysis` gate with several
> targets is a *router* that takes exactly one edge by its `when` — never all of them. So
> "on yes, open A and B" (fan-out) is authored one of two ways:
> - **same-stage fan-out** — ONE target: a branch-entry-only Stage that `HAS_STEP`s the
>   several steps (the steps keep their `stage_number`/`display_number`; the new Stage takes
>   its parent's `stage_number` and `CITES_EVIDENCE`). Required for **question** gates:
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
> - **There is no negative arm.** A gate expresses only its satisfied branch. "If NOT X,
>   do Y" cannot be authored as the negation of an existing gate — author a second gate
>   whose condition *is* the negative case, or leave Y unconditional.
> - **`SELECTS_BRANCH` is a live traversal edge**, not just UI metadata. A Criterion
>   reaches its `SELECTS_BRANCH` target unconditionally, so it counts as a competing route
>   under Rule 1.
> - **Missing data is `on_unresolved`'s job, not `default_behavior`'s.** A scalar lab or
>   vital with no usable value makes the gate *unresolved*; by default it then ASKS for the
>   value and holds its subtree (see **Missing data** below). A membership condition
>   (`includes_code`, `exists`) never is — "no code on file" is a definite no.
>
> Real failure this prevents: anemia-in-pregnancy v1.4 passed the import validator with 0
> errors and 0 warnings, and **not one of its 5 gates could exclude anything** — a patient
> with Hb 12.0 g/dL resolved with PRBC transfusion, oral iron and IV iron all INCLUDED.

`default_behavior` ∈ `skip` (unevaluable ⇒ gated subtree left out) or `traverse` (unevaluable ⇒ subtree included). Choose per clinical safety: `skip` for rare-population add-ons, `traverse` for safety-critical content that should stay unless ruled out.

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

- **Which conditions can be unresolved:** only *scalar* ones — `greater_than`/`less_than`
  on `labs` or `vitals`, and attribute conditions. Membership (`includes_code`, `equals`,
  `exists`) never is: absence is a definite no. Aggregates (`count_in_window`, trends,
  `delta_from_baseline`) never ask — "the count is 3" is not an observation — and fall to
  `default_behavior`.
- **Compounds:** OR is satisfied by any definite true; if nothing is true and some
  condition is unresolved, the gate is unresolved (a definite false does not outweigh an
  unknown). AND is unsatisfied by any definite false. A compound asks for **one datum at a
  time** — the first unresolved askable condition — so a gate with four missing labs can
  ask four times in sequence.
- **Dedup:** the question is keyed on the datum (`LOINC:<code>`, `vitals.<path>`), so two
  gates reading the same missing lab raise ONE question; both stay held until it is
  answered.
- **Prompt text:** generated per datum. For labs it uses the condition's **`display`**:
  `"<display> (LOINC <code>) — most recent value?"` — so put a readable `display` (with the
  unit the threshold assumes, e.g. `"Platelets (x10^9/L)"`) on every lab condition. Vitals
  prompts print the path (`display` is ignored). **Do not set `prompt` on a chart gate:** an
  authored prompt replaces the generated one for every datum the gate asks for.
- **Question gates:** inert — an unanswered question always pends.
- **Choosing:** `ask` when a missing value must not silently decide the branch (safety
  gates, gates whose "no" excludes treatment). `default` when missing data may honestly
  mean "not applicable" (optional add-ons) — then `default_behavior` decides. The choice is
  clinical: the brief states it per gate (§4b "On unresolved"). A gate with no scalar
  condition gets `default`, because that is what the engine does.
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
> "attribute has no value" and the gate silently takes its default; and (c) `patient.*`
> attributes can't be set from the simulator at all (composer never sends
> `patientAttributes` — author provider-derivable facts as question gates instead).
> Proof harness: `scripts/gate-proof.ts`. Revisit when the dashboard renders the
> attributes list and code-map seeding exists.

```json
{ "attribute": "vitals.temperature_c", "operator": "greater_than", "value": 38 }
```

- `attribute` = `<namespace>.<name>`. Registered namespaces (hard error otherwise): **`lab`**, **`vitals`**, **`allergy`**, **`patient`**.
  - `lab.*` / `allergy.*` resolve through the DB table `pathway_attribute_code_map` (attribute_name → system+code+value_type). **An unregistered attribute name imports fine but silently resolves to undefined at runtime** ⇒ the gate falls back to `default_behavior`. Every `lab.*`/`allergy.*` attribute you emit must be listed in the brief's "Attribute-map registrations" section so it gets seeded.
  - `vitals.*` walks a dotted numeric path in the patient's vitalSigns bag (e.g. `vitals.systolic_bp`, `vitals.temperature_c`).
  - `patient.*` reads derived scalars with no terminology code (e.g. `patient.gestational_age_weeks`, `patient.trimester`, `patient.rh_factor`).
- `operator` ∈ `equals`, `not_equals`, `greater_than`, `greater_or_equal`, `less_than`, `less_or_equal`, `in` (value = array), `exists`. Note: `exists` on an **absent** fact (e.g. an allergy the patient doesn't have) is unsatisfied — it no longer degrades to "attribute resolved" semantics (fixed post-kernel).
- There is **no** `symptom.*`, `medication.*`, or `condition.*` namespace (older docs said otherwise — they now hard-fail import). Symptom presence/severity is elicited ⇒ use a `question` gate. Diagnosis/medication history ⇒ use a coded condition.
- `horizon` / `status` — see **Temporal horizon & status** below; both are legal here exactly as on coded conditions.

**Coded condition** — allowed keys exactly: `field`, `operator`, `value`, `system`, `threshold`, `window_days`, `count_threshold`, `min_points`, `slope_threshold`, `delta_threshold`, `horizon`, `status`, `display`, `note`.

```json
{ "field": "conditions", "operator": "includes_code", "value": "Z94.*", "system": "ICD-10" }
```

- `field` ∈ `conditions`, `medications`, `allergies`, `labs`, `vitals` — now **enforced at
  import** against the kernel's `FIELD_TO_KIND` map (an unknown field is a hard error, not
  a silent runtime skip).
- `operator` ∈ `includes_code`, `equals`, `exists`, `greater_than`, `less_than`, `count_in_window`, `trend_up`, `trend_down`, `delta_from_baseline`. `value` is required.
- **`vitals` conditions may not set `system`** (hard import error, D9) — vitals carry no
  terminology code; `value` is the vitals path (e.g. `systolic_bp`). They **must** set
  `horizon` (temporal rule 0 below).
- **Numeric control domains (hard import errors post-kernel):** `threshold` /
  `delta_threshold` — finite numbers; `count_threshold` / `min_points` — positive
  integers; `slope_threshold` — finite **non-negative** number: it is a *magnitude*, the
  evaluator applies the sign (`trend_down` = slope < −slope_threshold), so a negative
  value would invert the clinical meaning.
- `display` / `note` are ignored by the evaluator. `display` on a **lab** condition is the
  label in the missing-data prompt — emit it on every lab condition (with unit).

Runtime semantics (from `gate-evaluator.ts`):

| Operator | Works on | Semantics |
|---|---|---|
| `includes_code` | conditions/medications/allergies/labs | Any entry's code matches `value` (wildcards like `Z94.*` supported), `system` optional filter |
| `equals` | same | Exact code match |
| `exists` | same | Field has ≥1 entry of any kind |
| `greater_than` / `less_than` | labs, vitals | For `labs`: `value` = the lab code, compare that lab's numeric result to `threshold` (falls back to `parseFloat(value)` — so always set `threshold` explicitly). For `vitals`: `value` = dotted path into vitalSigns |
| `count_in_window` | labs + code fields | Count entries matching `value` (+`system`) dated within `window_days` of the session clock; satisfied when count ≥ `count_threshold` (default 2). Omit `window_days` ⇒ lifetime count, undated entries count |
| `trend_up` / `trend_down` | **labs only** | Linear-regression slope over dated values of lab `value` within `window_days`; needs ≥ `min_points` (default 3, floor 2) dated points; satisfied when slope > `slope_threshold` (up) or < −`slope_threshold` (down); default threshold 0 |
| `delta_from_baseline` | **labs only** | newest − oldest in-window value vs signed `delta_threshold` (positive = rose by ≥ that much; negative = fell by ≥ magnitude); needs ≥ `min_points` (default 2) |

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
> None of these windows is anchored to the day treatment started — the kernel has no
> anchor-to-medication-event. Layering approximates it by covering several plausible
> treatment durations at once.

Time-shape notes: with `window_days` set, undated and future-dated entries never count. The
clock is the session's pinned `evaluationAsOf`, not wall time. Kernel semantics (v1): the
window selects on a fact's **start bound**, not interval overlap (D8); undated observations
are admitted as facts but are **not orderable** — they can satisfy membership operators but
cannot join a trend/delta series (D7); and when a condition's temporal state can't be
proven, the uncertainty propagates through `compound` gates rather than being coerced to
false — the gate is then *unresolved* and follows `on_unresolved` (see **Missing data**).

### Temporal horizon & status (per-condition, NODE tier — merged, emit freely)

Any attribute or coded condition may carry:

- **`horizon`** — how far back facts remain relevant to *this condition*. Either a named
  horizon — `"LIFETIME"`, `"YEAR"` (365 d), `"QUARTER"` (90 d), `"MONTH"` (30 d),
  `"WEEK"` (7 d), `"DAY"` (1 d), `"ENCOUNTER"` — or a custom day-count object
  `{ "days": N }` with N an integer 1..36525. Named horizons are fixed day-widths counted
  back from `evaluationAsOf` (not calendar units).
- **`status`** — which fact states count: `"active"`, `"inactive"`, or `"any"`.

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
2. `horizon` values must be from the grammar above; `status` from its enum.
3. `window_days` itself must be a positive integer ≤ 36525 (also preflight-owned).

Authoring guidance: use `window_days` when the *operator* is inherently windowed
(`count_in_window`, trends, deltas — "2 UTIs in 180 days"); use `horizon` to scope which
facts are relevant at all ("only conditions active within the last year"); use `status`
to exclude resolved/historical diagnoses (`"active"`) or deliberately include them
(`"any"` — the default behavior when omitted).

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
- `SELECT` requires a non-empty `options` string array. (Import currently fails to enforce this due to a dead check on the nonexistent gate_type `'select'` — emit options anyway; a SELECT question without options renders broken.)
- Use for symptom presence (`BOOLEAN`) and severity (`SELECT` with e.g. `["mild","moderate","severe"]`, or `NUMERIC` for validated scales). Never invent an ordinal attribute for severity.

### prior_node_result — ⛔ do not emit (import-blocked; re-verified at 9880729)

Runtime contract: `depends_on: [{ "node_id": "step-3-1", "status": "INCLUDED" }]` with `status` from `INCLUDED`, `EXCLUDED`, `GATED_OUT`, `PENDING_QUESTION`, `TIMEOUT`, `CASCADE_LIMIT`, `UNKNOWN`. But the import validator (`validator.ts:222`) checks entries as plain strings, so the runtime-correct object form fails import with `references nonexistent node "[object Object]"`, and string form imports but breaks evaluation. **Until the validator fix lands, do not emit this gate type.** Model the dependency as a `REQUIRES` edge (prerequisite semantics), a `compound`/`patient_attribute` gate on the underlying data, or keep it as a DecisionPoint. Record the intent in the brief so it can be upgraded when unblocked.

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

`operator` ∈ `"AND"` / `"OR"`; `conditions` non-empty, each an attribute or coded condition (mixing kinds is fine). No nesting.

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

### Post-kernel bug recheck (2026-08-13)

Re-verified at `9880729`: the evaluator-kernel merge did **not** fix the `depends_on`
validator/runtime shape mismatch (prior_node_result still unauthorable — see its section
above) or the dead `gate_type === 'select'` options check. Both restrictions stand.

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
