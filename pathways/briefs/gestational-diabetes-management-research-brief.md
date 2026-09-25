# Pathway Research Brief — Gestational Diabetes Mellitus: Management, Delivery Planning and Postpartum Follow-up

**Status: DRAFT v2 for physician review — not yet approved for JSON build.**

**Revision v2 (2026-09-24), from Josh's decisions on v1:**
- **Management only.** v1 carried two parts: A, screening and diagnosis; B, management. Part A has moved into routine prenatal care (D-1). See `pathways/briefs/routine-prenatal-care-research-brief.md`. What remains here is v1's Part B, revised.
- **Renamed.** This file was `gestational-diabetes-research-brief.md`. It is now named after its logical id, so `check-gate-control.ts` can find brief markers at `pathways/briefs/<logical_id>-research-brief.md`.
- **Decisions ratified here:**
  - D-2: declined.
  - D-9: the pharmacotherapy door is a provider question.
  - D-12: triggers are O24.4x only, and Z86.32 is dropped.
  - D-18: after-meal values are asked of the provider.
- **Moved to the routine brief:** D-1, D-3 and D-4 (decided), and D-5, D-6, D-7 and D-17 (still open).
- **Knock-on changes, each listed as a new open item:**
  - D-19: GDM phase is now read from the chart.
  - D-20: gestational-age gates on antenatal testing.
- **Reframed by other decisions:** D-8 and D-10. Both are still listed as open.

Research method (per `.claude/skills/pathway-research/SKILL.md`). v1 used a landscape scan, then four parallel domain agents over fetched guideline text:
- diagnosis/screening;
- pharmacotherapy;
- non-pharmacologic care and special populations;
- monitoring/delivery/quality.

Two verification agents followed, one for codes and one for citations. The live and retired pathway graphs were read from the local pathway-service (`pathwayGraph`). The v2 edits change structure and encoding only. They add no new clinical claims beyond v1's verified sources.

**Verification outcome (v1, still applies):**
- **Codes.** Every ICD-10-CM (FY2026 = FY2027), LOINC 2.82, RxNorm and CPT code in this brief was verified live.
- **Corrections found and folded in:**
  - LOINC 1500-4 does not exist, and 1503-2 is a urine test. The retired pathway used both.
  - Several local seed labels are wrong (§18).
- **Citations:** 22 checked. 14 PASS and 8 PARTIAL, with fixes applied. ACOG PB 190 and the 2024 ACOG CPU are paywalled; see the `[GAP]`s.

Flags:
- `[GAP]` unsourceable.
- `[OLDER SOURCE]` older, but still the current recommendation.
- `[NOT ENCODABLE]` clinically required but not expressible on main.
- `[DECISION]` an authoring choice Josh must ratify.
- `[DECISION — Josh 2026-09-24]` ratified.
- `[SIM]` cannot be exercised in the encounter simulator as seeded today.

> ### Read this first — what this brief decides
>
> 1. **One pathway, management only.** `gestational-diabetes-management` triggers on
>    *diagnosed* GDM: O24.41x (in pregnancy) and O24.43x (puerperium).
>    - Screening and diagnosis now live in routine prenatal care.
>    - Routine care's positive-result gates open a "Diagnose GDM" step. That step recommends
>      adding **O24.410** to the problem list.
>    - Once the code is on file, this pathway matches on the next resolve (D-1).
> 2. **Pharmacotherapy opens only through a provider question** (D-9): *are more than half of
>    the glucose values since the last visit above target?* The prompt states the targets:
>    fasting <95, 1 h <140, 2 h <120 mg/dL.
>    - "Yes" opens a branch-entry pharmacotherapy stage.
>    - Two pattern questions (fasting; after meals) then choose basal and/or prandial insulin.
>    - No stage holding insulin has a root or `HAS_STEP` edge. That structural edge is what made
>      the retired `gdm-management-v2` give insulin to a patient at target (§0.2).
>    - The literal ">50% of all values" rule has a known blind spot, isolated fasting
>      hyperglycemia (§4b, `gate-majority-above-target`). Per-type wording is offered beside it.
> 3. **Gestational age and phase are read from the chart, not asked.** The engine now treats a
>    missing `patient.*` value as missing data: it pends and asks for the datum.
>    - v1 used GA question routers because a missing value was a silent "no". That reason is
>      gone, so GA is read through `patient.gestational_age_weeks` gates (§4b, D-20).
>    - With Z86.32 dropped (D-12), phase comes from ICD-10 positively: O24.41x means pregnant,
>      O24.43x means puerperium (D-19).
> 4. **Open `[DECISION]`s** are indexed in §0.5.

---

## 0. Cross-cutting analysis (not emitted)

### 0.1 Architecture: GDM management is its own pathway; screening lives in routine care `[DECISION — Josh 2026-09-24]` (D-1)

- **Screening is part of routine prenatal care**, not a separate screening pathway.
  - Early testing when risk factors are present, the universal 24–28-week test, and two-step
    diagnosis all move to `routine-prenatal-care`.
  - The engine starts pathways only from condition codes. So routine care's positive-result
    gates open **"Diagnose GDM: add O24.410 to the problem list"**.
  - The code is the hand-off. This pathway fires on the next resolve.
- **Why this is clean.**
  - Management content cannot match an undiagnosed patient at all, because the trigger is
    the diagnosis code.
  - The hand-off is chart-native, and it matches how real charts move.
- **Known cost: routine care may stop matching.** ICD-10-CM makes Z34 Excludes1 with any
  chapter-15 code (§0.3).
  - A diagnosed patient coded **only** O24.41x stops matching routine prenatal care, which
    triggers on Z34.x/O09.x. She would lose routine items for the rest of the pregnancy: GBS,
    Tdap, RhIG and so on.
  - This is recorded and decided in the routine brief as **D-21**. The trigger set is Josh's
    call there, not here.

### 0.2 Why the stored GDM pathways failed (post-mortem from the local graph, 2026-09-24)

Four GDM pathways are stored locally, all ARCHIVED: `gestational-diabetes-screening`,
`gestational-diabetes-v2`, `gdm-management-v1` and `gdm-management-v2`. The screening failures
are recorded in the routine brief (§0.2 there).

**Insulin given to a diet-controlled patient at target.** In `gdm-management-v2`:
- `gate-targets-not-met` (labs `1558-6 > 95`) `BRANCHES_TO stage-3` "Pharmacotherapy".
- There was **also** an edge `root HAS_STAGE stage-3`. The unconditional structural edge reached
  Stage 3 first, and the gate's verdict was discarded (spec Rule 1). This is the same inertness
  bug found in anemia v1.4.

Three further defects:
- `1558-6` is a *serum/plasma fasting glucose*, not a self-monitored value.
- `> 95` misses exactly 95, and the target is "<95".
- There was no postprandial condition, so postprandial-only hyperglycemia could never reach
  insulin.

`gate-a2gdm` (O24.414 only) missed oral-agent A2 patients (O24.415). Its meds had no
`clinical_role` and no codes.

**What this brief does differently:**
- Every pharmacotherapy stage is branch-entry only.
- The door is a provider question (D-9), not a lab read.
- Basal and prandial therapy each sit behind their own pattern question.
- There is a continuation route for already-treated patients at target (§3, Step 7.3).
- Every chart gate states `on_unresolved`.

### 0.3 Coding facts that shape the triggers (verified, ICD-10-CM FY2027 Guidelines [17])

- **Z34 is never used with chapter-15 (O) codes** (I.C.15.b.1; I.C.21.c.11). A patient with
  GDM cannot legitimately carry Z34. So this pathway co-matches routine prenatal care only
  through **O09.x** (high-risk supervision), which may carry other O-codes.
- **O24.4 rules (I.C.15.i):**
  - No other O24 code is used with O24.4-.
  - Diet + insulin is coded insulin-controlled only (O24.414).
  - Diet + oral agent is coded O24.415 only.
  - **Z79.4 and Z79.84 (and Z79.85) are not assigned with O24.4-.** So "on insulin" is visible
    from ICD as O24.414, and the long-term-insulin Z-code is not a usable A2 signal.
- **O24.41x vs O24.43x.** "In pregnancy" vs "in the puerperium" is a positive, chart-readable
  phase signal (D-19).
- **Z86.32** (personal history of GDM) carries an Excludes1 against current-pregnancy GDM. It
  is **no longer a trigger** (D-12).

### 0.4 Co-matching with the other live and draft pathways

Local registry on 2026-09-24:
- `routine-prenatal-care-v2` — ACTIVE (Z34.00, Z34.90). To be superseded by
  `routine-prenatal-care`.
- `anemia-in-pregnancy` v3 — ACTIVE/draft on josh-dev (O99.011–.019, D50.9).
- `gestational-hypertension-preeclampsia` — DRAFT.
- `uti-asymptomatic-bacteriuria-pregnancy` — DRAFT.

How the merge works on josh-dev (`care-plan-merge.ts`, after `77105ca`):
- **Medications** are deduped by name. `role: avoid|contraindicated` hard-suppresses that drug
  name across every co-matched pathway.
- **`clinical_role` conflict** fires when ≥2 **distinct** names share a role, **within or
  across** pathways.
- **Labs** are keyed by `system|code`. Procedures and imaging are keyed by `system|code`.
- **Guidance** is deduped on **topic + instructions**. Same topic with different text now shows
  **both**; nothing is dropped. So avoid two differently worded blocks under one generic topic.
  This pathway's topics are all GDM-prefixed.

| Other pathway | Co-matches when | `clinical_role` overlap? | Other merge interactions |
|---|---|---|---|
| `routine-prenatal-care` (new) | O09.x + O24.41x | **None.** Routine lanes are immunization, Rh prophylaxis, preeclampsia prophylaxis and folic acid | Routine care's ≥24-week screening content is excluded for a diagnosed patient by its screening-status router ("diabetes already diagnosed" → hand-off step; routine brief D-22). Its "Diagnose GDM" steps carry CodeEntry O24.410, and this pathway carries O24.410 on Step 2.1. Code entries are not merged items, so no clash. |
| `anemia-in-pregnancy` (ACTIVE) | O24.4x + O99.01x | **None** | None. Its "When to call us right away" topic collides with UTI's; that is flagged for those pathways. |
| `gestational-hypertension-preeclampsia` (DRAFT) | O24.4x + O13/O14 | **None** | **(1) Metformin with hypertension: no guard** — **D-2 declined** `[DECISION — Josh 2026-09-24]`. ADA 2026 says metformin should not be used with hypertension, preeclampsia or IUGR risk [5]. Josh's ruling is that this is the prescriber's call: GHTN adds no `avoid` node, and nothing suppresses metformin. The ADA caution stays as information in Med-B3's notes. **(2) Fetal testing dedupes.** Same CPTs as GHTN (59025, 76818, 76816). **(3) Delivery timing is not reconciled.** GHTN says ~37 0/7; GDM A1 says 39 0/7–40 6/7. The earlier indicated timing governs (CO 831 [9]), and the clinician reconciles. |
| `uti-asymptomatic-bacteriuria-pregnancy` (DRAFT) | O24.4x + O23.x/R82.71 | **None** | Its `gate-no-repeat-screening` reads E10/E11, not O24.4, so there is no interaction. |

Within this pathway, lanes are split so complementary drugs never conflict:
- `gdm-basal-insulin` (NPH);
- `gdm-prandial-insulin` (lispro/aspart as one node);
- `gdm-oral-agent` (metformin; glyburide is `avoid`).

### 0.5 `[DECISION]` index

**Ratified by Josh (2026-09-24):**

| ID | Decision | Ruling |
|---|---|---|
| D-1 | Architecture | GDM testing lives in routine prenatal care. A positive result opens "Diagnose GDM (add O24.410)", and this pathway matches once coded. Part A moved (§0.1). |
| D-2 | Metformin guard for hypertension (GHTN `avoid` node) | **Declined** — the prescriber's call. No suppression. The ADA caution stays in Med-B3's notes only. |
| D-3, D-4 | 50-g cutoff; 100-g criteria | Decided: 140 mg/dL, and Carpenter–Coustan with ≥2 values. Both now live in the routine brief. |
| D-9 | When pharmacotherapy opens | **When more than half of glucose values since the last visit are above target.** Provider-supplied, so it is a BOOLEAN question gate. An optional `llm_text_analysis` variant is described but not required (§4b). |
| D-12 | Z86.32 trigger | **Dropped.** Triggers are O24.41x and O24.43x only. Long-term post-GDM screening goes to routine care (§1, Step 9.6). |
| D-18 | Post-meal self-monitoring source | **Asked of the provider** (question gates), not read from untimed LOINC 41653-7 or timed post-meal LOINCs. |

**Open — recommended default kept, one-line tradeoff each:**

| ID | Decision | Default | Tradeoff |
|---|---|---|---|
| D-8 | Postprandial timing: a 1-h vs 2-h router with duplicate prandial stages, or one question naming both targets | **Reframed by D-18.** The router existed only because an OR over the 1-h and 2-h LOINC conditions would ask forever for the unused timing. The after-meal question states both targets, so the router and the duplicate Stage 5 are dropped. | Keep a router only if you want separate 1-h and 2-h questions: one extra question, and a duplicated prandial stage. |
| D-10 | SMBG chart-gate horizon ({days: 14}) | **Moot.** No chart SMBG gate remains (D-9 and D-18 made them questions). Kept listed so it can be revived. | Only matters if a chart-read SMBG gate returns, e.g. once glucometer feeds are timed. |
| D-11 | Glyburide role | **`avoid`** (hard-suppressed across co-matched plans) | `second_line` would show it as a usable option, which conflicts with ADA/ACOG "not first-choice" and the INDAO/SUGAR-DIP results. |
| D-13 | Postpartum OGTT gate `on_unresolved` | **ask** (Josh's numeric rule) | A visit in weeks 0–4 asks for an OGTT that cannot exist yet. The subtree is only held, but `default` would avoid the premature question. |
| D-14 | Postpartum OGTT horizon | **{days: 60}**, which keeps antepartum OGTT values out | A late-diagnosed patient delivered within about 8 weeks of her diagnostic OGTT can still leak in. A shorter window risks missing a week-10–12 test. |
| D-15 | Basal insulin node | **NPH only** (glargine in the notes) | NPH + glargine as same-lane alternatives forces a provider choice every time (a `clinical_role` conflict). |
| D-16 | Logical ID | **Fresh `gestational-diabetes-management`** | Reusing archived `gdm-management-v2` would import as NEW_VERSION and inherit its lineage. The screening ID question is moot now that Part A has moved. |

**New items raised by this revision (open):**

| ID | Decision | Default | Tradeoff |
|---|---|---|---|
| D-19 | Phase routing: chart gates on O24.41.* vs O24.43.* (replacing v1's `gate-gdm-phase` SELECT router) | **Chart gates.** D-12 removed the only reason for the router, which was that Z86.32 carries no phase. | A patient still carrying O24.41x after delivery opens **both** stages: antepartum SMBG questions would show postpartum, visibly rather than silently. The router avoids that, at one question per visit. |
| D-20 | Antenatal testing from 32 0/7 weeks read from `patient.gestational_age_weeks` (two identical GA gates) | **Add them** | Without them, the NST/BPP steps show from diagnosis onward. With them, a session without GA (the preview flow) asks for GA. |

Moved to the routine brief, still open: D-5 (one-step/two-step router), D-6 (early test = HbA1c),
D-7 (early abnormal glucose branch), D-17 (Z3A triggers).

### 0.6 Spec and engine limitations hit

1. **No %-of-values operator.** `count_in_window` counts results, not above-threshold results.
   So "more than half above target" (D-9) cannot be read from data. It is asked.
2. **Chart gates have no negative arm.** "Not on medication" and "at target" need a question or
   a separate positive-case gate. The D-9 question routes its "no" arm to an explicit
   continue-MNT step.
3. **LLM gates always route.** `evaluateLlmTextAnalysis` returns `satisfied: true` on every
   path. A single-target LLM gate therefore **always includes its target**, so the LLM variant
   must be a two-edge router with `when` on each edge. With no `LLM_GATE_API_KEY` (local), it
   routes the safe default *tentatively* and pends for provider confirmation.
4. **No pregnancy or delivery anchor.** "This pregnancy" and "postpartum weeks 4–12" are
   day-count horizons.
5. **The simulator can only enter seeded codes.**
   - Seeded today: O24.410/.414/.415/.419, LOINC 4548-4, 1558-6, 41653-7.
   - Not seeded: O24.43x and the postpartum OGTT LOINCs (1552-9, 1518-0).
   - `ensureClinicalCodeReference` has no callers on josh-dev.
6. **One parent per node (builder rule for this brief).** Node marking is first-writer-wins
   (`traversal-engine.ts` `markSubtree`). Every node listed "on" several hosts is emitted as
   one node per host, with the same name, topic or code, so the merge dedupes it. CodeEntry
   rows follow the same rule.
7. **Two-of-N and band exclusivity.** `(A AND B) OR (C AND D)` has no encoding, so the
   postpartum prediabetes band is not exclusive of the diabetes band (§4b).

---

## Part A (screening and diagnosis) — MOVED

v1's Part A (`gestational-diabetes-screening-diagnosis`) is **withdrawn as a separate pathway**
(D-1). Its content is now in `pathways/briefs/routine-prenatal-care-research-brief.md`:

| v1 Part A item | Where it lives now |
|---|---|
| Early testing for undiagnosed diabetes (risk-factor question, early HbA1c, overt diabetes, early abnormal glucose) | Routine brief, Stage 2.5 "Early diabetes testing" (behind a GA < 24 gate) |
| Universal 24–28-week screening, strategy router, two-step (50-g → 100-g) and one-step (75-g) | Routine brief, Stage 4 and its sub-stages (behind a GA ≥ 24 gate and the screening-status router) |
| Positive diagnosis | Routine brief, "Diagnose GDM: add O24.410 to the problem list" steps. This pathway fires once coded. |
| `gate-screening-status` (GA-based SELECT router) | Replaced by `patient.gestational_age_weeks` gates. A GA-free status router remains for "already diagnosed / screened negative". |
| D-3, D-4 (decided); D-5, D-6, D-7, D-17 (open) | Routine brief §0.5 |
| Codes, labs, guidance A1–A5, citations [1], [7] | Routine brief |

---

## 1. Pathway metadata

- **Logical ID**: `gestational-diabetes-management` (new; distinct from archived
  `gdm-management-v1/-v2`; D-16)
- **Title**: Gestational Diabetes — Management, Delivery Planning and Postpartum Follow-up
- **Version**: 1
- **Category**: OBSTETRIC
- **Scope**: Outpatient care from GDM diagnosis through the postpartum glucose test. Covers:
  - antepartum: MNT, activity, weight gain, SMBG, pharmacotherapy (opened by the provider's
    report that most values are above target), fetal surveillance and delivery-timing planning
    by control class;
  - postpartum: the 4–12-week 75-g OGTT and its interpretation, then a hand-off to primary care.
  Out of scope:
  - Intrapartum glucose management. `[GAP]` No GDM intrapartum target was found in the sources
    read.
  - Pregestational diabetes.
  - **Lifelong post-GDM screening** (D-12). Where it goes:
    - Step 9.6 hands off to primary care, with the every-1–3-years instruction.
    - A future adult preventive-care pathway triggered by Z86.32 would own recurring screening.
      `[GAP]` That pathway does not exist yet.
    - In a **later pregnancy**, routine prenatal care's early-testing question lists
      "gestational diabetes in a prior pregnancy" as a criterion, so the next pregnancy is
      tested early.
- **Target population**: Patients with GDM diagnosed in the current pregnancy, and puerperal
  patients after a GDM pregnancy.
- **Condition codes** (trigger codes; OR semantics). Leaves are listed, because trigger
  matching does not expand the O24 subtree reliably (`icd10_codes` holds 666 codes).

| Code | System | Description | Usage note | Grouping |
|---|---|---|---|---|
| O24.410 | ICD-10 | Gestational diabetes mellitus in pregnancy, diet controlled | primary trigger; the code routine care's "Diagnose GDM" step recommends | gdm-antepartum |
| O24.414 | ICD-10 | Gestational diabetes mellitus in pregnancy, insulin controlled | primary trigger | gdm-antepartum |
| O24.415 | ICD-10 | Gestational diabetes mellitus in pregnancy, controlled by oral hypoglycemic drugs | primary trigger | gdm-antepartum |
| O24.419 | ICD-10 | Gestational diabetes mellitus in pregnancy, unspecified control | primary trigger | gdm-antepartum |
| O24.430 | ICD-10 | Gestational diabetes mellitus in the puerperium, diet controlled | postpartum trigger | gdm-postpartum |
| O24.434 | ICD-10 | Gestational diabetes mellitus in the puerperium, insulin controlled | postpartum trigger | gdm-postpartum |
| O24.435 | ICD-10 | Gestational diabetes mellitus in the puerperium, controlled by oral hypoglycemic drugs | postpartum trigger | gdm-postpartum |
| O24.439 | ICD-10 | Gestational diabetes mellitus in the puerperium, unspecified control | postpartum trigger | gdm-postpartum |

**Deliberately excluded:**
- **Z86.32**, personal history of GDM (D-12, `[DECISION — Josh 2026-09-24]`). It is a permanent
  history code and would match every future encounter for life.
- **O24.42x**, GDM in childbirth. These are delivery-admission codes used inpatient.
- **Z79.4, Z79.84 and Z79.85.** Not assigned with O24.4- (I.C.15.i [17]).

## 1b. Code sets

None.

## 2. Stages

- **Stage 1 — GDM course status** *(root-connected; entry)*: reads the phase from the chart and
  routes antepartum or postpartum. [5]
- **Stage 2 — Antepartum management** *(branch-entry only, via `gate-gdm-antepartum`)*: MNT,
  activity, weight gain, SMBG and the weekly glycemic review, fetal growth, and control-class
  planning. Every antepartum gate is hosted here, so none is evaluated for a postpartum
  patient. [2][5]
- **Stage 3 — Start or intensify pharmacotherapy** *(branch-entry only, via
  `gate-majority-above-target` = yes)*: holds the regimen-pattern questions and the metformin
  alternative. [2][3][5]
- **Stage 4 — Fasting hyperglycemia: basal insulin** *(branch-entry only, via
  `gate-fasting-pattern`)*. [2][3][5]
- **Stage 5 — After-meal hyperglycemia: prandial insulin** *(branch-entry only, via
  `gate-postmeal-pattern`)*. Covers 1-h and 2-h monitoring alike (D-8 reframed). [2][3][5]
- **Stage 6 — A1GDM, well controlled: surveillance and delivery plan** *(branch-entry only, via
  `gate-control-class`)*. [2][8][9]
- **Stage 7 — A2GDM, well controlled on medication: surveillance and delivery plan**
  *(branch-entry only, via `gate-control-class`)*. [2][8][9]
- **Stage 8 — Poorly controlled GDM: surveillance and delivery plan** *(branch-entry only, via
  `gate-control-class`)*. [3][8][9]
- **Stage 9 — Postpartum** *(branch-entry only, via `gate-gdm-postpartum`)*:
  - medication review;
  - lactation and contraception;
  - the 4–12-week OGTT and its interpretation;
  - hand-off to primary care.
  [4][5][13][14][15]

Stage numbers are unique and ids are `stage-<number>`. v1 gave the three control-class
variants one shared number (6), which `check-gate-control.ts` now fails. They are now
Stages 6/7/8, and postpartum moves from 7 to 9. v1's Stage 8 (long-term follow-up) is
**removed** (D-12). The v1 → v2 mapping:

| v1 | v2 |
|---|---|
| Stages 3/4/5 | Stages 4/5, behind a new door Stage 3 |
| Stage 6 A1 / A2 / poor | Stages 6 / 7 / 8 |
| Stage 7 | Stage 9 |
| Stage 8 | removed |

Only Stage 1 has a root `HAS_STAGE` edge.

## 3. Steps

**Stage 1**

- **Step 1.1 — Establish GDM course status from the problem list** *(unconditional; hosts
  `gate-gdm-antepartum` and `gate-gdm-postpartum`)*:
  - O24.41x means pregnant with GDM. O24.43x means delivered (puerperium).
  - If both are on file, update the problem list: O24.41x should be replaced by O24.43x at
    delivery.
  [5][17]

**Stage 2 — Antepartum management**

- **Step 2.1 — Confirm diagnosis and educate** *(unconditional)*:
  - Confirm the diagnostic basis: two-step Carpenter–Coustan or one-step IADPSG, recorded by
    routine care.
  - Explain GDM, its risks and the plan (Guid-B1).
  - Aspirin is not indicated for GDM alone. Assess preeclampsia risk factors per USPSTF
    (Guid-B7). Routine care's aspirin question already covers this.
  [5][16]
- **Step 2.2 — Medical nutrition therapy with a registered dietitian** *(unconditional)*:
  - Individualized plan (Rec 15.14, C).
  - Minimum 175 g carbohydrate, 71 g protein and 28 g fiber daily.
  - 3 meals + 2–3 snacks (PB 190 Level C).
  - Whole foods; limit processed and sweetened foods; no ketogenic or paleo patterns.
  - 70–85% of patients are managed with lifestyle alone (Rec 15.15, A).
  [2][5]
- **Step 2.3 — Physical activity** *(unconditional)*:
  - At least 150 min/week of moderate aerobic activity (30 min on ≥5 days).
  - A 10–15-minute walk after meals is commonly advised.
  - Stop-exercise warning signs apply.
  [2][3][10]
- **Step 2.4 — Gestational weight gain** *(unconditional)*: IOM 2009 targets by prepregnancy
  BMI (Guid-B4). Weight loss in pregnancy is not recommended. [5][11]
- **Step 2.5 — Self-monitoring of blood glucose and weekly review** *(unconditional; hosts
  `gate-majority-above-target`)*:
  - Test 4 times daily: fasting, plus 1 h **or** 2 h after each meal.
  - Targets: fasting <95; 1-h <140 or 2-h <120 mg/dL (Rec 15.8, B).
  - Logs are generally reviewed weekly, more often when many values are abnormal. Telehealth
    plus in-person care is appropriate (Rec 15.16, A).
  - A1C is secondary only.
  - CGM is individualized: no recommendation for or against it in GDM (Rec 15.10, E).
  - The review answers one question: are most values above target? (D-9)
  - Glyburide and non-insulin agents other than metformin are listed here as `avoid`
    (Med-B5, Med-B6).
  [2][3][5]
- **Step 2.6 — Values mostly at target: continue nutrition therapy and self-monitoring**
  *(router target only: `gate-majority-above-target` = no)*:
  - No pharmacotherapy change.
  - Re-review at the next visit or weekly log review.
  - Insulin resistance rises through the late second and third trimesters, so the answer can
    change later.
  [3][5]
- **Step 2.7 — Fetal growth assessment late in the third trimester** *(unconditional)*:
  - Assess fetal growth by ultrasonography or clinical examination late in the third
    trimester.
  - Counsel on scheduled cesarean if estimated fetal weight is **≥4,500 g**.
  - Ultrasound's LGA prediction is imperfect (22% of fetuses suspected LGA were LGA at birth).
  - `[GAP]` No source specifies ~36 weeks or serial scans, so there is no GA gate.
  [2][3]
- **Step 2.8 — Classify glycemic control and plan surveillance and delivery** *(unconditional;
  hosts `gate-control-class`)*: A1 (diet-controlled) vs A2 (medication-requiring), and well vs
  poorly controlled. Re-classify as treatment changes. [2][8][9]
- **Step 2.9 — Glycemic control not yet established: reassess** *(router target only)*:
  - Newly diagnosed, or treatment just changed.
  - Review SMBG weekly and classify at the next review.
  - No surveillance or delivery plan yet.
  [3][5]

**Stage 3 — Start or intensify pharmacotherapy**

- **Step 3.1 — Choose the regimen by glucose pattern** *(unconditional in Stage 3; hosts
  `gate-fasting-pattern` and `gate-postmeal-pattern`)*:
  - Insulin is preferred (Rec 15.17, A).
  - The pattern of above-target values chooses the regimen:
    - fasting values → basal (Stage 4);
    - after-meal values → prandial (Stage 5);
    - both → both stages.
  - If most values are above target but neither pattern question is answered "yes", recheck
    the log. The two answers should explain the "yes" on the door question.
  [2][3][5]
- **Step 3.2 — If insulin is declined, cannot be given safely or is unaffordable: metformin**
  *(unconditional in Stage 3; hosts Med-B3)*:
  - Metformin is the alternative, not first-line (Rec 15.21).
  - ADA advises against metformin with hypertension, preeclampsia or IUGR risk. That is the
    prescriber's call (D-2 declined), and the pathway does not suppress it.
  [2][5][12][19]

**Stage 4 — Basal insulin**

- **Step 4.1 — Start or up-titrate bedtime NPH insulin for fasting hyperglycemia**
  *(unconditional in Stage 4)*:
  - For isolated fasting hyperglycemia, bedtime intermediate-acting (NPH) insulin may be
    adequate.
  - Typical total starting dose if a multi-injection regimen is needed: 0.7–1.0 units/kg/day in
    divided doses.
  - Adjust to the monitored values at each time of day.
  - Glucagon for everyone on insulin. Hypoglycemia education (Guid-B5).
  - `[GAP]` No numeric titration algorithm in any source read.
  [2][3][5][6]

**Stage 5 — Prandial insulin**

- **Step 5.1 — Start or up-titrate prandial rapid-acting insulin for after-meal hyperglycemia**
  *(unconditional in Stage 5)*:
  - Rapid-acting insulin analog (lispro or aspart) before the meal(s) whose after-meal value is
    above target, whether the patient checks at 1 h or 2 h. For example, elevated
    post-breakfast values alone may need only pre-breakfast short-acting insulin.
  - Lispro/aspart are preferred over regular insulin.
  - Glucagon; Guid-B5.
  [2][3][5][6]

**Stages 6–8 — Surveillance and delivery by control class**

- **Step 6.1 — A1GDM well controlled: no routine antenatal testing; delivery 39 0/7–40 6/7
  weeks** *(Stage `stage-6`)*:
  - Before 40 0/7 weeks there is no consensus on antenatal testing for diet-controlled GDM
    without comorbidities.
  - Do not deliver before 39 weeks unless otherwise indicated. Expectant management up to
    40 6/7 weeks is generally appropriate.
  [2][8][9]
- **Step 7.1 — A2GDM well controlled: antenatal testing from 32 0/7 weeks, once or twice
  weekly** *(gated by `gate-ga-32-a2`, D-20)*:
  - NST and/or BPP, test type per local practice.
  - Testing that includes amniotic-fluid assessment is common, because of polyhydramnios risk.
  [3][8]
- **Step 7.2 — A2GDM well controlled: delivery 39 0/7–39 6/7 weeks** *(Stage `stage-7`,
  unconditional; hosts `gate-ga-32-a2`)*. [2][9]
- **Step 7.3 — Continue and titrate current glucose-lowering therapy** *(Stage `stage-7`,
  unconditional)*:
  - This is the continuation route for a treated patient whose values are **at** target. The
    initiation door (Stage 3) correctly stays closed for her.
  - No medication nodes here. The patient's own regimen is on her chart, and adding nodes would
    create lane conflicts.
  - If on glyburide, stop at least 2 weeks before expected delivery (FDA label [21]).
  [2][5][21]
- **Step 8.1 — Poorly controlled GDM: antenatal testing from 32 0/7 weeks, twice weekly**
  *(gated by `gate-ga-32-poor`, D-20)*. [8]
- **Step 8.2 — Poorly controlled GDM: individualized late-preterm/early-term delivery** *(Stage
  `stage-8`, unconditional; hosts `gate-ga-32-poor`)*:
  - CO 831: late preterm/early term, individualized.
  - PB text: 37 0/7–38 6/7 weeks may be justified. 34 0/7–36 6/7 is reserved for patients who
    fail in-hospital attempts to improve control or have abnormal antepartum testing.
  - Intensify therapy.
  [3][9]

**Stage 9 — Postpartum**

- **Step 9.1 — Review glucose-lowering medication after delivery** *(unconditional)*:
  - Patients with GDM usually do not need diabetes medication postpartum.
  - Insulin requirements fall dramatically immediately after delivery (Rec 15.26, C).
  - Watch for hypoglycemia in patients who continue insulin while breastfeeding.
  [5]
- **Step 9.2 — Lactation, contraception and psychosocial check** *(unconditional)*:
  - Breastfeeding is recommended (Rec 15.28, A/B).
  - Contraceptive plan (Rec 15.27, A).
  - Psychosocial assessment (Rec 15.29, E).
  [5]
- **Step 9.3 — 75-g 2-hour OGTT at 4–12 weeks postpartum** *(unconditional; hosts
  `gate-pp-ogtt-diabetes` and `gate-pp-ogtt-prediabetes`)*:
  - Use nonpregnancy criteria (Rec 15.30 / 2.33, B).
  - OGTT is preferred over A1C, which is falsely lowered after delivery.
  - For patients who cannot tolerate or decline the OGTT, A1C at 6–12 months may be considered.
  - `[GAP]` The ACOG CPU 2024 immediate-postpartum OGTT position is unverified (paywall).
  [4][5][13]
- **Step 9.4 — Postpartum OGTT in the diabetes range: confirm and refer** *(gated by
  `gate-pp-ogtt-diabetes`)*:
  - FPG ≥126 or 2-h ≥200 mg/dL.
  - Confirm per ADA: a second abnormal result, unless unequivocal.
  - Diagnose type 2 diabetes and refer.
  [3][4]
- **Step 9.5 — Postpartum prediabetes: intensive lifestyle and/or metformin** *(gated by
  `gate-pp-ogtt-prediabetes`)*:
  - FPG 100–125 or 2-h 140–199 mg/dL.
  - With overweight/obesity: intensive lifestyle intervention and/or metformin (Rec 15.32, A).
  - Test yearly.
  [3][5]
- **Step 9.6 — Hand off to primary care; lifelong screening** *(unconditional)*:
  - Record the history of GDM on the problem list: **Z86.32** after the puerperium.
  - Primary-care follow-up and ASCVD risk assessment.
  - **Screen for diabetes every 1–3 years for life**, even after a normal postpartum OGTT
    (Rec 15.31, B), and before any future pregnancy.
  - This is where lifelong screening leaves this pathway (D-12). The recurring screening
    belongs to primary/preventive care: a future Z86.32-triggered pathway.
  - In a later pregnancy, routine prenatal care tests early because prior GDM is a risk
    factor.
  [4][5][15]

## 4. Decision points

None. Every decision is a gate (§4b).

## 4b. Gates

**Framing note.**
- **Question gates (5):**
  - the D-9 door;
  - two regimen-pattern questions;
  - the control-class router;
  - (optional) the LLM variant of the door, which replaces the question.
- **Chart gates (6):**
  - two phase gates (membership);
  - two GA gates (`patient.*`, `ask`);
  - two postpartum OGTT gates (numeric, `ask`).

- **Gate `gate-gdm-antepartum` — GDM diagnosed in this pregnancy (O24.41x)?**
  - Attached to: `step-1-1` · Branches to: `stage-2`
  - Exclusively gated: yes. Stage 2 has no root edge.
  - Type: **patient_attribute** (coded) · Default behavior: **skip**
  - Condition: field `conditions`, operator `includes_code`, value `O24.41.*`, system `ICD-10`,
    horizon `{days: 300}`, status `active`.
  - On unresolved: n/a — default. A membership condition is never unresolved.
  - `[DECISION D-19]` Replaces v1's `gate-gdm-phase` SELECT router. The router existed because
    Z86.32 carried no phase, and D-12 removed Z86.32. The `{days: 300}` horizon keeps an O24.41x
    left active from a **prior** pregnancy from opening antepartum content.
  - Rationale & source: [5][17] → Step 1.1.

- **Gate `gate-gdm-postpartum` — GDM pregnancy, now in the puerperium (O24.43x)?**
  - Attached to: `step-1-1` · Branches to: `stage-9`
  - Exclusively gated: yes.
  - Type: **patient_attribute** (coded) · Default behavior: **skip**
  - Condition: field `conditions`, `includes_code`, value `O24.43.*`, system `ICD-10`, horizon
    `{days: 120}`, status `active`.
  - On unresolved: n/a — default.
  - `{days: 120}` covers delivery through the 12-week OGTT window, with slack for when the code
    is entered.
  - Both codes present opens both stages (D-19 tradeoff); Step 1.1 tells the clinician to fix
    the problem list.
  - Rationale & source: [5][17] → Step 1.1.

- **Gate `gate-majority-above-target` — More than half of glucose values above target since the
  last visit?** `[DECISION D-9 — Josh 2026-09-24]`
  - Attached to: `step-2-5` · **Router** (question, BOOLEAN). Branches:
    - `when: {"equals": true}` → `stage-3`
    - `when: {"equals": false}` → `step-2-6`
  - Exclusively gated: yes. Stage 3 has **no root edge**; this is the fix for the retired v2's
    inert gate (§0.2). Step 2.6 has no `HAS_STEP`.
  - Type: **question** · answer_type: **BOOLEAN** · Default behavior: **skip** (consulted only if
    the router cannot decide).
  - Prompt: "Since the last visit, are MORE THAN HALF of this patient's blood glucose values
    above target? Targets: fasting below 95 mg/dL; 1 hour after a meal below 140 mg/dL; 2 hours
    after a meal below 120 mg/dL (use whichever after-meal timing the patient checks). Count
    every value checked, fasting and after meals, from the glucose log or as reported at this
    visit."
  - Why a question, not a chart gate:
    - Josh notes the answer is virtually always provider-supplied or heard in the conversation.
    - No operator counts values above a threshold (§0.6 #1).
    - Home-glucometer feeds usually arrive untimed (41653-7), so fasting and after-meal values
      cannot be told apart (D-18).
  - **Blind spot — flagged for Josh, not changed.** Fasting is 1 of 4 daily values. A patient
    with **every** fasting value high and every after-meal value normal is at 25%, so the
    literal rule never opens basal insulin for **isolated fasting hyperglycemia**. That is
    exactly the patient for whom bedtime NPH is the textbook first step [3][5].
    - **Alternative wording (not the default):** "Since the last visit, are more than half of
      the FASTING values, OR more than half of the AFTER-MEAL values, above target?" This
      applies the >50% rule per measurement type.
    - Say which you want. The encoding is identical; only the prompt changes.
  - Unanswered: pends (question gates always ask). Stage 3 and Step 2.6 are both held until it
    is answered.
  - `[GAP]` No US source gives a number or % of above-target values. ">50%" is Josh's
    operational rule. Guidelines say "consistently" [2][3].
  - Rationale & source: [5] Rec 15.8, 15.15, 15.17; [3] → Step 2.5.
  - **Optional variant — `gate-majority-above-target-llm` (described, not required; LLM gates
    are not enabled locally).** It reads the visit narrative instead of asking.
    - Type `llm_text_analysis`; `input_attribute`
      `freeformData.narrative.history_of_present_illness`. The simulator sends that key. A site
      with a structured glucose-log summary would point at a custom narrative key instead.
    - Branches:
      - `majority-above-target`: "The narrative or glucose-log discussion indicates more than
        half of the glucose values since the last visit were above target (fasting ≥95; 1 h
        ≥140; 2 h ≥120 mg/dL)." → `stage-3` (`when: {"equals": "majority-above-target"}`).
      - `not-majority-above-target`: "The narrative indicates values mostly at target, OR does
        not report enough glucose values to tell." **`is_safe_default: true`** → `step-2-6`
        (`when: {"equals": "not-majority-above-target"}`).
    - `confidence_threshold` 0.8; `default_behavior` skip.
    - **It must be a two-edge router.** An LLM gate always reports satisfied (§0.6 #3), so a
      single-target version would always open pharmacotherapy.
    - **It replaces the question; it cannot sit beside it.** Two gates on `stage-3` would
      violate Rule 2: the first "no" would claim the target.
    - **The question is the fallback.** Low confidence, a failed call, or no
      `LLM_GATE_API_KEY` routes the safe default *tentatively* and raises a pending provider
      confirmation. In effect, the provider answers the same question.
    - Safety: the safe default is "not above target", so uncertainty never opens insulin
      unconfirmed.

- **Gate `gate-fasting-pattern` — Fasting values mostly above target?**
  - Attached to: `step-3-1` · Branches to: `stage-4`
  - Exclusively gated: yes. Stage 4 has no root edge.
  - Type: **question** · BOOLEAN · Default behavior: **skip** ("no" → basal insulin not added)
  - Prompt: "Are this patient's FASTING glucose values mostly at or above 95 mg/dL since the
    last visit?"
  - Asked only after the door opens (it is hosted in Stage 3), so a patient at target is never
    asked.
  - Rationale & source: [3][5] Rec 15.8 → Step 3.1.

- **Gate `gate-postmeal-pattern` — After-meal values mostly above target?** (D-18)
  - Attached to: `step-3-1` · Branches to: `stage-5`
  - Exclusively gated: yes. Stage 5 has no root edge.
  - Type: **question** · BOOLEAN · Default behavior: **skip**
  - Prompt: "Are this patient's AFTER-MEAL glucose values mostly above target since the last
    visit? Target: 1 hour after eating below 140 mg/dL, or 2 hours after eating below
    120 mg/dL, whichever timing the patient checks."
  - `[DECISION D-18 — Josh 2026-09-24]` Asked of the provider, not read from untimed LOINC
    41653-7. v1's timed post-meal LOINC gates (10449-7, 6689-4) and their timing router are
    withdrawn (D-8 reframed).
  - Rationale & source: [3][5] Rec 15.8 → Step 3.1.

- **Gate `gate-control-class` — GDM class and glycemic control**
  - Attached to: `step-2-8` · **Router**, SELECT. Branches:
    - `"Newly diagnosed or treatment just changed — control not yet established"` → `step-2-9`
    - `"A1GDM — well controlled on nutrition and exercise"` → `stage-6`
    - `"A2GDM — well controlled on medication"` → `stage-7`
    - `"Poorly controlled (on nutrition therapy or medication)"` → `stage-8`
  - Exclusively gated: yes.
  - Type: **question** · SELECT · Default behavior: **skip**
  - Prompt: "How would you classify this patient's gestational diabetes today? Newly diagnosed
    or treatment just changed (control not yet established); A1GDM well controlled on
    nutrition and exercise; A2GDM well controlled on medication; or poorly controlled."
  - `[NOT ENCODABLE]` **Why not a data gate:**
    - "Well" vs "poorly controlled" is judgment.
    - A1 would need "no glucose-lowering medication", which is negative.
    - O24.414/.415 could open A2 positively, but it cannot separate well from poorly
      controlled, and it would share targets with this router (Rule 2).
  - **Mirror failure handled here:** a patient on insulin at target selects "A2 well controlled"
    and receives Step 7.3 (continue therapy), even though the initiation door is closed.
  - Rationale & source: [2][8][9] → Step 2.8.

- **Gate `gate-ga-32-a2` — At or beyond 32 0/7 weeks (A2 well controlled)?** (D-20)
  - Attached to: `step-7-2` · Branches to: `step-7-1`
  - Exclusively gated: yes. Step 7.1 has no `HAS_STEP`.
  - Type: **patient_attribute** (attribute form) · Default behavior: **skip**
  - Condition: attribute `patient.gestational_age_weeks`, operator `greater_or_equal`, value
    `32`, unit `weeks`, display `"Gestational age (completed weeks)"`. No horizon, because
    `patient.*` has no temporal policy.
  - On unresolved: **ask**. A missing GA pends and asks for `patient.gestational_age_weeks`,
    typed NUMERIC. The prompt uses the display.
  - Physiologic drift: GA advances about 1 week per week. The gate re-reads it at every visit,
    and testing opens once 32 is reached. No trend operator is used.
  - Rationale & source: [8] → Step 7.2.

- **Gate `gate-ga-32-poor` — At or beyond 32 0/7 weeks (poorly controlled)?** (D-20)
  - Attached to: `step-8-2` · Branches to: `step-8-1`
  - Condition identical to `gate-ga-32-a2`. This is cross-stage fan-out with identical
    conditions; keep the two in sync. Both read one datum, so a missing GA raises ONE question.
  - Type, default, on_unresolved and drift: as `gate-ga-32-a2`.
  - Rationale & source: [8] → Step 8.2.

- **Gate `gate-pp-ogtt-diabetes` — Postpartum OGTT in the diabetes range?**
  - Attached to: `step-9-3` · Branches to: `step-9-4`
  - Exclusively gated: yes.
  - Type: **compound**, **OR** · Default behavior: **skip**
  - Conditions (coded), field `labs`, `greater_than`, system `LOINC`, horizon `{days: 60}`:
    - `1552-9` threshold **125.9**, display `"Glucose fasting, pre 75 g glucose (mg/dL)"`
    - `1518-0` threshold **199.9**, display `"Glucose 2 h post 75 g glucose (mg/dL)"`
  - On unresolved: **ask** (`[DECISION D-13]`, default kept). Both values come from one test,
    so this is not the alternative-tests OR trap. Caveat: at a visit in weeks 0–4 it asks for a
    value that cannot exist yet. The subtree is only held; nothing is wrongly shown.
  - `[DECISION D-14]` horizon {days: 60}. It keeps the **antepartum** diagnostic OGTT
    (24–28 weeks, typically ≥9 weeks before delivery) out of the postpartum read.
  - Rationale & source: [4] Rec 2.33, Table 2.1; [5] Rec 15.30 → Step 9.3.

- **Gate `gate-pp-ogtt-prediabetes` — Postpartum OGTT in the prediabetes range (or higher)?**
  - Attached to: `step-9-3` · Branches to: `step-9-5`
  - Exclusively gated: yes.
  - Type: **compound**, **OR** · Default behavior: **skip**
  - Conditions (coded), field `labs`, `greater_than`, system `LOINC`, horizon `{days: 60}`:
    - `1552-9` threshold **99.9**
    - `1518-0` threshold **139.9**
    Displays as above.
  - On unresolved: **ask**. It shares the datum-keyed questions with `gate-pp-ogtt-diabetes`.
  - **Not exclusive of the diabetes gate.** A diabetes-range result satisfies this gate too, so
    Step 9.5 shows alongside Step 9.4 (§0.6 #7). Step 9.4 supersedes it.
  - Rationale & source: [4] Table 2.2; [5] Rec 15.32 → Step 9.3.

**Removed in v2:**
- `gate-gdm-phase` → D-19 chart gates.
- `gate-fasting-above-target`, `gate-pp-timing`, `gate-pp1h-above-target` and
  `gate-pp2h-above-target` → D-9/D-18 questions.
- `gate-longterm-diabetes` and `gate-longterm-prediabetes` → D-12; Stage 8 removed.

## 5. Medications

`clinical_role` lanes: `gdm-basal-insulin`, `gdm-prandial-insulin`, `gdm-oral-agent` and
`diabetes-prevention-metformin`. There is no lane overlap with any live or draft pathway
(§0.4).

- **Med-B1 — NPH insulin (insulin isophane, human)** (on Step 4.1)
  - Role: first_line · Clinical role: `gdm-basal-insulin`
  - Dose: bedtime NPH for isolated fasting hyperglycemia. If multiple injections are needed,
    typical total starting dose 0.7–1.0 units/kg/day in divided doses. Titrate to monitored
    values. SC.
  - Escalates to: none.
  - Notes:
    - Human insulin does not cross the placenta.
    - Glargine is widely used in pregnancy (observational data), but it is not a separate node
      (D-15).
    - Detemir has been **withdrawn from the market**.
    - Degludec's 3–4-day titration interval limits frequent adjustment.
  - Source: [2][3][5]
- **Med-B2 — Rapid-acting insulin analog (insulin lispro or insulin aspart)** (on Step 5.1)
  - Role: first_line · Clinical role: `gdm-prandial-insulin`
  - Dose: before the meal(s) with above-target after-meal values; individualized. SC.
  - Escalates to: none.
  - Notes: one node for two interchangeable analogs. Regular human insulin is acceptable;
    lispro/aspart are preferred.
  - Source: [3][5]
- **Med-B3 — Metformin** (on Step 3.2; **one node** now, where v1 had three copies)
  - Role: alternative · Clinical role: `gdm-oral-agent`
  - Dose: 500 mg nightly for 1 week, then 500 mg twice daily with meals. Titrate. FDA label
    maximum 2,550 mg/day. Oral.
  - Escalates to: Med-B1 / Med-B2. Supplemental insulin is needed in 26–46% of patients (46% in
    MiG).
    - Two caveats on this edge: an `ESCALATES_TO` to a node in a differently gated stage is
      documentation only.
    - The escalation happens when the door question is answered "yes" again.
  - Notes:
    - **Not first-line** (ADA Rec 15.21, A/B). It crosses the placenta, and offspring were
      heavier at 9 years (MiG TOFU).
    - A reasonable alternative when the patient declines insulin, cannot administer it safely,
      or cannot afford it. ADA also names cost, comprehension and cultural factors [5].
    - SMFM calls it a reasonable, safe first-line alternative [12] (conflict noted, §18).
    - ADA advises against it with hypertension, preeclampsia or IUGR risk [5]. **No pathway
      guard** (D-2 declined, the prescriber's call).
    - Contraindicated at eGFR <30; do not initiate at eGFR 30–45 (label).
  - Source: [2][5][12][19]
- **Med-B4 — Glucagon (emergency)** (one node per host, same name: Med-B4a on Step 4.1,
  Med-B4b on Step 5.1)
  - Role: first_line · Clinical role: n/a (non-conflicting safety adjunct)
  - Dose: per product label, for severe hypoglycemia. Prescribe for everyone taking insulin
    (ADA Rec 6.16, A).
  - Source: [6]
- **Med-B5 — Glyburide** (on Step 2.5)
  - Role: **avoid** (`[DECISION D-11]`) · Clinical role: `gdm-oral-agent`
  - Dose: n/a. If used despite this: 2.5–20 mg/day in divided doses; stop ≥2 weeks before
    expected delivery (label).
  - Notes:
    - Crosses the placenta.
    - More neonatal hypoglycemia and macrosomia.
    - INDAO failed noninferiority vs insulin, and SUGAR-DIP's metformin→glyburide strategy
      failed noninferiority for LGA.
  - Source: [2][5][18][20][21]
- **Med-B6 — Non-insulin glucose-lowering agents other than metformin (GLP-1 RAs, SGLT2
  inhibitors, DPP-4 inhibitors, thiazolidinediones, other sulfonylureas)** (on Step 2.5)
  - Role: avoid · Clinical role: n/a
  - Notes: not recommended in pregnancy (ADA 15.21, E). This node is informational.
  - Source: [5]
- **Med-B7 — Metformin (diabetes prevention)** (on Step 9.5; one node now, where v1 also had a
  copy on the removed Step 8.3)
  - Role: acceptable · Clinical role: `diabetes-prevention-metformin`
  - Dose: `[GAP]` no dose given in ADA Section 15 for this indication. Titrate per label.
  - Notes: postpartum prediabetes with overweight/obesity (Rec 15.32, A). `[GAP]` Lactation is
    not addressed in the sources read.
  - Name collision: Med-B3 and Med-B7 are both named "Metformin…". They sit in different
    stages that are never co-reachable (Stage 3 is antepartum, Stage 9 postpartum), so no
    conflict arises in one session.
  - Source: [5]

## 6. Lab tests

- **Lab-B1 — Self-monitored capillary blood glucose (glucometer log)** (on Step 2.5): LOINC
  `41653-7` "Glucose [Mass/volume] in Capillary blood by Glucometer".
  - **Documentation only.** No gate reads it (D-18).
  - v1's timed LOINCs (41604-0, 10449-7, 6689-4) are withdrawn with their gates. 10449-7 and
    6689-4 were serum/plasma or whole-blood codes chosen only because no capillary mg/dL
    post-meal code exists.
  [5]
- **Lab-B4 — Hemoglobin A1c (secondary measure)** (on Step 2.5): LOINC 4548-4. A secondary
  measure only in pregnancy. [5]
- **Lab-B5 — Postpartum 75-g 2-hour OGTT** (on Step 9.3): LOINC 1552-9 (fasting) and 1518-0
  (2 h), serum/plasma. [4][5]

Removed: Lab-B2 and Lab-B3 (timed post-meal SMBG); Lab-B6 and Lab-B7 (long-term screening,
D-12).

## 7. Imaging

- **Img-B1 — Obstetric ultrasound for fetal growth** (on Step 2.7): modality US, body_region
  pregnant uterus, code **76816** (CPT).
  - Indication: fetal growth late in the third trimester. EFW ≥4,500 g prompts cesarean
    counseling.
  - Same code as GHTN's growth scan, so co-matched plans dedupe.
  [2][3]

## 8. Procedures

- **Proc-B1 — Fetal non-stress test** (one node per host: Proc-B1a on Step 7.1, Proc-B1b on
  Step 8.1): CPT **59025**. [8]
- **Proc-B2 — Fetal biophysical profile with non-stress testing** (Proc-B2a on Step 7.1,
  Proc-B2b on Step 8.1): CPT **76818**. [3][8]

Both codes are identical to GHTN's, so they dedupe.

## 9. Guidance

All topics are GDM-prefixed. The merge keeps distinct text under one topic, so generic topics
would stack.

- **Guid-B1 — topic `GDM: what it means for you and your baby`** (on Step 2.1), education:
  "Gestational diabetes raises the chance of a large baby, a difficult birth, low blood sugar in
  your newborn, and preeclampsia. Keeping your blood sugar in range lowers these risks. Most
  patients (about 70–85%) manage it with food and activity changes alone. Some need insulin,
  which is safe for your baby." [3][5]
- **Guid-B2 — topic `GDM eating plan`** (on Step 2.2), lifestyle: "You will meet a dietitian to
  build a plan that fits you. Eat three meals and two to three snacks each day to spread out
  carbohydrates. Eat at least 175 grams of carbohydrate daily — do not cut carbohydrates out.
  Choose whole foods (vegetables, fruit, beans, whole grains, lean protein, nuts, fish) and
  limit sweets, sweetened drinks and processed foods. Avoid keto or very-low-carb diets."
  [2][5]
- **Guid-B3 — topic `GDM activity`** (on Step 2.3), lifestyle: "Aim for at least 150 minutes a
  week of moderate activity, such as 30 minutes on 5 days. A 10–15-minute walk after each meal
  helps lower blood sugar. If you use insulin, eat before long or intense exercise; more than
  45 minutes can cause low blood sugar. Stop and call us for vaginal bleeding, fluid leaking,
  regular painful contractions, chest pain, dizziness, or calf pain or swelling." [3][10]
- **Guid-B4 — topic `GDM pregnancy weight gain`** (on Step 2.4), lifestyle: "Healthy total weight
  gain for one baby depends on your weight before pregnancy: underweight (BMI under 18.5):
  28–40 lb; normal (18.5–24.9): 25–35 lb; overweight (25–29.9): 15–25 lb; obesity (30 or
  higher): 11–20 lb. Losing weight during pregnancy is not recommended." [5][11]
  - Co-match note: routine prenatal care carries a general weight-gain topic with the IOM
    table. Their topics differ, so both show. Josh may prefer to drop this one and rely on
    routine care's, since the ranges are identical.
- **Guid-B5 — topic `GDM on insulin: low blood sugar`** (one node per host, same topic and
  text: Guid-B5a on Step 4.1, Guid-B5b on Step 5.1), safety-netting: "A blood sugar below 70 on
  your meter (below 63 on a sensor) is low. Signs can include shakiness, sweating, a fast
  heartbeat, hunger or confusion. Take 15 grams of fast sugar (4 oz juice or glucose tablets),
  recheck in 15 minutes, and repeat if still low. Keep glucagon at home and teach a family
  member to use it. Call 911 if you cannot safely swallow or are not fully alert. Tell us about
  any low." `[GAP]` The symptom list is not pregnancy-specific. [5][6]
- **Guid-B6 — topic `GDM checking your blood sugar`** (on Step 2.5), education: "Check four times
  a day: when you wake up (before eating), and 1 hour (or 2 hours, as we agree) after
  breakfast, lunch and dinner. Targets: fasting under 95; 1 hour after meals under 140, or
  2 hours under 120. Share your log with us every week." [3][5]
- **Guid-B7 — topic `GDM and aspirin`** (on Step 2.1), education: "Gestational diabetes by itself
  is not a reason to take low-dose aspirin. We check your other risk factors for preeclampsia
  and will recommend aspirin if you qualify." [5][16]
- **Guid-B8 — topic `GDM after delivery: your follow-up test`** (on Step 9.3), education:
  "Gestational diabetes usually goes away after birth, but it raises your lifetime chance of
  type 2 diabetes. A 2-hour glucose test 4–12 weeks after delivery checks whether your sugar
  has returned to normal. After that, get tested every 1–3 years for life, and before any
  future pregnancy." [4][5]
- **Guid-B9 — topic `GDM breastfeeding and contraception`** (on Step 9.2), education:
  "Breastfeeding is recommended and lowers your future diabetes risk. If you are still on
  insulin, watch for lows while nursing. We will plan birth control that fits you." [5]
- **Guid-B10 — topic `GDM long-term health`** (on Step 9.6; one node now, where v1 also had a
  copy on the removed Step 8.1), lifestyle: "A history of gestational diabetes raises your risk
  of type 2 diabetes and heart disease. Stay active, aim for a healthy weight (losing 5% or
  more before another pregnancy lowers the chance of GDM again), and get diabetes testing every
  1–3 years and before planning another pregnancy." [5][15]

## 10. Quality metrics

- **QM-B1 — Postpartum diabetes screening after GDM** (on Step 9.3):
  - Steward: SMFM (Special Statement 2023; not CMS/NCQA-adopted).
  - Denominator: patients who gave birth with a GDM diagnosis (O24.419) during the pregnancy,
    plus ≥2 prenatal E&M visits with GDM or global OB care.
  - Numerator: 75-g 2-h GTT at 4–12 weeks (28–84 days) postpartum.
  [13]
- **QM-B2 — Maternity Care: Postpartum Follow-up and Care Coordination (MIPS Quality ID #336),
  GDM glucose-screen component** (on Step 9.6):
  - Steward: CMS.
  - Numerator includes "Postpartum Glucose Screening for Gestational Diabetes".
  [14]

## 11. Schedules

- **Sched-B1** (on Step 2.5): "4 times daily". "SMBG: fasting + 1 h or 2 h after each meal. Once
  controlled on diet, frequency may be reduced, but rarely below 2/day." [3]
- **Sched-B2** (on Step 2.5): "weekly". "Review the SMBG log. Review more often if many values
  are abnormal. The review answers the D-9 question: are more than half of the values above
  target?" [3]
- **Sched-B3** (on Step 7.1): "once or twice weekly from 32 0/7 weeks". "Antenatal testing,
  A2GDM well controlled." [8]
- **Sched-B4** (on Step 8.1): "twice weekly from 32 0/7 weeks". "Antenatal testing, poorly
  controlled GDM." [8]
- **Sched-B5** (on Step 9.3): "4–12 weeks postpartum". "75-g 2-hour OGTT, nonpregnancy criteria.
  If declined or not tolerated, A1C at 6–12 months." [4][5]
- **Sched-B6** (on Step 9.6): "every 1–3 years, lifelong". "Diabetes/prediabetes screening after
  GDM, owned by primary care after hand-off; yearly if prediabetes." [3][4][5]

## 12. Prerequisites (REQUIRES)

- `stage-3` REQUIRES `step-2-2`: MNT precedes pharmacotherapy. Medication is used when nutrition
  and exercise fail (PB, Level A). Catch-up surfaces the RDN referral if it is missing.
- `step-9-4` REQUIRES `step-9-3`; `step-9-5` REQUIRES `step-9-3`: interpretation needs the OGTT.

Acyclic. No prior_node_result gates.

## 13. Code entries

| Code | System | Description | Attached to |
|---|---|---|---|
| 41653-7 | LOINC | Glucose [Mass/volume] in Capillary blood by Glucometer | Lab-B1 |
| 4548-4 | LOINC | Hemoglobin A1c/Hemoglobin.total in Blood | Lab-B4 |
| 1552-9 | LOINC | Glucose [Mass/volume] in Serum or Plasma --pre 75 g glucose PO | Lab-B5 |
| 1518-0 | LOINC | Glucose [Mass/volume] in Serum or Plasma --2 hours post 75 g glucose PO | Lab-B5 |
| 82947 | CPT | Glucose; quantitative, blood | Lab-B5 |
| 82950 | CPT | Glucose; post glucose dose | Lab-B5 |
| 83036 | CPT | Hemoglobin; glycosylated (A1c) | Lab-B4 |
| 76816 | CPT | Ultrasound, pregnant uterus, follow-up, per fetus | Img-B1 |
| 59025 | CPT | Fetal non-stress test | Proc-B1a, Proc-B1b |
| 76818 | CPT | Fetal biophysical profile; with non-stress testing | Proc-B2a, Proc-B2b |
| 97802 | CPT | Medical nutrition therapy; initial assessment and intervention, individual, each 15 min | Step 2.2 |
| 97803 | CPT | Medical nutrition therapy; re-assessment and intervention, individual, each 15 min | Step 2.2 |
| 1605101 | RXNORM | insulin isophane (IN) | Med-B1 |
| 86009 | RXNORM | insulin lispro | Med-B2 |
| 51428 | RXNORM | insulin aspart, human | Med-B2 |
| 6809 | RXNORM | metformin | Med-B3, Med-B7 |
| 4832 | RXNORM | glucagon | Med-B4a, Med-B4b |
| 4815 | RXNORM | glyburide | Med-B5 |
| O24.410 | ICD-10 | Gestational diabetes mellitus in pregnancy, diet controlled | Step 2.1 |
| O24.414 | ICD-10 | Gestational diabetes mellitus in pregnancy, insulin controlled | Step 4.1, Step 5.1 |
| O24.415 | ICD-10 | Gestational diabetes mellitus in pregnancy, controlled by oral hypoglycemic drugs | Step 3.2 |
| R73.03 | ICD-10 | Prediabetes | Step 9.5 |
| Z86.32 | ICD-10 | Personal history of gestational diabetes | Step 9.6 (a recommendation to record it, not a trigger) |

RxNorm entries are ingredient-level (IN), for display and documentation. No gate reads
medications.

## 14. Attribute-map registrations

None. The only attribute conditions are `patient.gestational_age_weeks`, and `patient.*` needs
no code-map row.

## 15. Evidence citations

Unchanged from v1 (the shared list below). This pathway emits [2]–[6] and [8]–[21]. [1] and [7]
(the screening sources) are now used only by the routine brief, which carries its own copies.

- **[1]** Screening for Gestational and Pregestational Diabetes in Pregnancy and Postpartum
  (Clinical Practice Update) — ACOG, *Obstet Gynecol* 2024;144(1):e20–e23, 2024, evidence level
  `Expert Consensus`, https://pubmed.ncbi.nlm.nih.gov/42131962/ — `[GAP]` full text paywalled.
  *Not emitted by this pathway.*
- **[2]** Gestational Diabetes Mellitus (Practice Bulletin No. 190) — ACOG, *Obstet Gynecol*
  2018;131(2):e49–e64, 2018 (reaffirmed 2026), evidence level `Level A`,
  https://www.acog.org/clinical/clinical-guidance/practice-bulletin/articles/2018/02/gestational-diabetes-mellitus
  — `[GAP]` member-only. Claims verified via PubMed 29370047, ADA/USPSTF citations of PB 190,
  and the PB 180 text [3].
- **[3]** Gestational Diabetes Mellitus (Practice Bulletin No. 180) — ACOG, *Obstet Gynecol*
  2017;130(1):e17–e37, 2017, evidence level `Level A`,
  https://ruralprep.org/wp-content/uploads/2018/04/ACOG-Tech-Bullitin.pdf —
  `[OLDER SOURCE — superseded by [2]]`. Cited only for operational wording that PB 190 retained
  per secondary confirmation.
- **[4]** 2. Diagnosis and Classification of Diabetes: Standards of Care in Diabetes—2026 — ADA
  Professional Practice Committee, *Diabetes Care* 2026;49(Suppl 1):S27–S49, 2026, evidence
  level `A`, https://pmc.ncbi.nlm.nih.gov/articles/PMC12690183/
- **[5]** 15. Management of Diabetes in Pregnancy: Standards of Care in Diabetes—2026 — ADA
  Professional Practice Committee, *Diabetes Care* 2026;49(Suppl 1):S321–S338, 2026, evidence
  level `A`, https://pmc.ncbi.nlm.nih.gov/articles/PMC12690181/
- **[6]** 6. Glycemic Goals, Hypoglycemia, and Hyperglycemic Crises: Standards of Care in
  Diabetes—2026 — ADA Professional Practice Committee, *Diabetes Care* 2026;49(Suppl
  1):S132–S149, 2026, evidence level `A`, https://pmc.ncbi.nlm.nih.gov/articles/PMC12690178/
- **[7]** Screening for Gestational Diabetes: USPSTF Recommendation Statement — USPSTF, *JAMA*
  2021;326(6):531–538, 2021, evidence level `B`,
  https://www.uspreventiveservicestaskforce.org/uspstf/recommendation/gestational-diabetes-screening
  — *Not emitted by this pathway.*
- **[8]** Indications for Outpatient Antenatal Fetal Surveillance (Committee Opinion No. 828) —
  ACOG, 2021 (reaffirmed 2024), evidence level `Expert Consensus`,
  https://www.acog.org/clinical/clinical-guidance/committee-opinion/articles/2021/06/indications-for-outpatient-antenatal-fetal-surveillance
- **[9]** Medically Indicated Late-Preterm and Early-Term Deliveries (Committee Opinion No.
  831) — ACOG, 2021, evidence level `Expert Consensus`,
  https://www.acog.org/clinical/clinical-guidance/committee-opinion/articles/2021/07/medically-indicated-late-preterm-and-early-term-deliveries
- **[10]** Physical Activity and Exercise During Pregnancy and the Postpartum Period (Committee
  Opinion No. 804) — ACOG, 2020 (reaffirmed 2023), evidence level `Expert Consensus`,
  https://www.acog.org/clinical/clinical-guidance/committee-opinion/articles/2020/04/physical-activity-and-exercise-during-pregnancy-and-the-postpartum-period
- **[11]** Weight Gain During Pregnancy (Committee Opinion No. 548) — ACOG, 2013 (reaffirmed
  2026), evidence level `Expert Consensus`,
  https://www.acog.org/clinical/clinical-guidance/committee-opinion/articles/2013/01/weight-gain-during-pregnancy
  — `[OLDER SOURCE — still current recommendation]`
- **[12]** SMFM Statement: Pharmacological treatment of gestational diabetes — SMFM, *AJOG*
  2018;218(5):B2–B4, 2018 (reaffirmed 2024), evidence level `Expert Consensus`,
  https://publications.smfm.org/publications/252-society-for-maternal-fetal-medicine-statement-pharmacological-treatment/
- **[13]** SMFM Special Statement: Quality metric on the rate of postpartum diabetes screening
  after pregnancies with gestational diabetes — SMFM, *AJOG* 2023;228(4):B2–B9, 2023, evidence
  level `Expert Consensus`, https://www.ajog.org/article/S0002-9378(22)02601-1/fulltext
- **[14]** Quality ID #336: Maternity Care: Postpartum Follow-up and Care Coordination (2026 MIPS
  CQM) — CMS, 2026, evidence level `Expert Consensus`,
  https://qpp.cms.gov/docs/QPP_quality_measure_specifications/CQM-Measures/2026_Measure_336_MIPSCQM.pdf
- **[15]** Optimizing Postpartum Care (Committee Opinion No. 736) — ACOG, 2018 (reaffirmed
  2025), evidence level `Expert Consensus`,
  https://www.acog.org/clinical/clinical-guidance/committee-opinion/articles/2018/05/optimizing-postpartum-care
- **[16]** Aspirin Use to Prevent Preeclampsia and Related Morbidity and Mortality: Preventive
  Medication — USPSTF, *JAMA* 2021;326(12):1186–1191, 2021, evidence level `B`,
  https://www.uspreventiveservicestaskforce.org/uspstf/recommendation/low-dose-aspirin-use-for-the-prevention-of-morbidity-and-mortality-from-preeclampsia-preventive-medication
- **[17]** ICD-10-CM Official Guidelines for Coding and Reporting FY2027 — CMS and NCHS, 2026,
  evidence level `Expert Consensus`,
  https://ftp.cdc.gov/pub/Health_Statistics/NCHS/Publications/ICD10CM/2027/ICD-10-CM-October-1-2026-FY27-Guidelines.pdf
- **[18]** Oral Glucose-Lowering Agents vs Insulin for Gestational Diabetes (SUGAR-DIP) —
  Rademaker D, et al., *JAMA* 2025;333(6):470–478, 2025, evidence level `A`,
  https://pubmed.ncbi.nlm.nih.gov/39761054/
- **[19]** Metformin versus Insulin for the Treatment of Gestational Diabetes (MiG) — Rowan JA,
  et al., *NEJM* 2008;358:2003–2015, 2008, evidence level `A`,
  https://pubmed.ncbi.nlm.nih.gov/18463376/ — `[OLDER SOURCE — landmark trial cited by ADA
  2026]`
- **[20]** Effect of Glyburide vs Subcutaneous Insulin on Perinatal Complications Among Women
  With Gestational Diabetes (INDAO) — Sénat MV, et al., *JAMA* 2018;319(17):1773–1780, 2018,
  evidence level `A`, https://pubmed.ncbi.nlm.nih.gov/29715355/
- **[21]** Glyburide (micronized) tablets — prescribing information, DailyMed, 2026, evidence
  level `Expert Consensus`,
  https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=e84c0dfc-a4e9-4c89-b6ea-45732eb412f5

## 16. Citation map

- Stage 1: [5] · Step 1.1: [5], [17] · Gates `gate-gdm-antepartum`, `gate-gdm-postpartum` → Step 1.1
- Stage 2: [2], [5] · Step 2.1: [5], [16] · Step 2.2: [2], [5] · Step 2.3: [2], [3], [10] ·
  Step 2.4: [5], [11] · Step 2.5: [2], [3], [5] · Step 2.6: [3], [5] · Step 2.7: [2], [3] ·
  Step 2.8: [2], [8], [9] · Step 2.9: [3], [5]
- Gates `gate-majority-above-target` (and its optional LLM variant) → Step 2.5;
  `gate-control-class` → Step 2.8
- Stage 3: [2], [3], [5] · Step 3.1: [2], [3], [5] · Step 3.2: [2], [5], [12], [19] ·
  Gates `gate-fasting-pattern`, `gate-postmeal-pattern` → Step 3.1
- Stages 4, 5: [2], [3], [5] · Steps 4.1, 5.1: [2], [3], [5], [6]
- Stage `stage-6`: [2], [8], [9] · Step 6.1: [2], [8], [9]
- Stage `stage-7`: [2], [8], [9] · Step 7.1: [3], [8] · Step 7.2: [2], [8], [9] · Step 7.3:
  [2], [5], [21] · Gate `gate-ga-32-a2` → Step 7.2
- Stage `stage-8`: [3], [8], [9] · Step 8.1: [8] · Step 8.2: [3], [8], [9] · Gate
  `gate-ga-32-poor` → Step 8.2
- Stage 9: [4], [5], [13], [14], [15] · Step 9.1: [5] · Step 9.2: [5] · Step 9.3: [4], [5], [13] ·
  Step 9.4: [3], [4] · Step 9.5: [3], [5] · Step 9.6: [4], [5], [15] · Gates
  `gate-pp-ogtt-diabetes`, `gate-pp-ogtt-prediabetes` → Step 9.3
- Med-B1: [2], [3], [5] · Med-B2: [3], [5] · Med-B3: [2], [5], [12], [19] · Med-B4: [6] ·
  Med-B5: [2], [5], [18], [20], [21] · Med-B6: [5] · Med-B7: [5]
- Lab-B1, B4: [5] · Lab-B5: [4], [5] · Img-B1: [2], [3] · Proc-B1: [8] · Proc-B2: [3], [8]
- Guid-B1: [3], [5] · Guid-B2: [2], [5] · Guid-B3: [3], [10] · Guid-B4: [5], [11] · Guid-B5:
  [5], [6] · Guid-B6: [3], [5] · Guid-B7: [5], [16] · Guid-B8: [4], [5] · Guid-B9: [5] ·
  Guid-B10: [5], [15]
- QM-B1 → Step 9.3 ([13]) · QM-B2 → Step 9.6 ([14]) · Schedules and CodeEntries → host Steps

## 17. Temporal horizon & status summary (EMITTED — review carefully)

| Gate | Condition on | horizon | status | window_days | Rationale |
|---|---|---|---|---|---|
| gate-gdm-antepartum | conditions O24.41.* | {days: 300} | active | — | This pregnancy only. An O24.41x left active from a prior pregnancy must not open antepartum content (D-19) |
| gate-gdm-postpartum | conditions O24.43.* | {days: 120} | active | — | Delivery through the 12-week OGTT window, plus slack |
| gate-ga-32-a2 | patient.gestational_age_weeks ≥ 32 | — (patient.* has no temporal policy) | — | — | Read at the session; asks when missing |
| gate-ga-32-poor | patient.gestational_age_weeks ≥ 32 | — | — | — | As above |
| gate-pp-ogtt-diabetes | labs 1552-9 > 125.9 | {days: 60} | — | — | Postpartum OGTT only. Excludes the antepartum diagnostic OGTT (D-14) |
| gate-pp-ogtt-diabetes | labs 1518-0 > 199.9 | {days: 60} | — | — | As above |
| gate-pp-ogtt-prediabetes | labs 1552-9 > 99.9 | {days: 60} | — | — | As above |
| gate-pp-ogtt-prediabetes | labs 1518-0 > 139.9 | {days: 60} | — | — | As above |

No `window_days`, and no status on labs or vitals. Question gates carry no conditions. There are
no trend, delta or count operators.

## 18. Gaps & fallbacks

### Not encodable on main

| # | Requirement | Why not | Fallback |
|---|---|---|---|
| G1 | Start pharmacotherapy when >50% of values are above target (D-9) | No %-of-values operator; SMBG feeds are untimed | BOOLEAN question router (optional LLM router variant) |
| G2 | Isolated fasting hyperglycemia under the literal D-9 rule | Fasting is ~25% of values, so it cannot exceed 50% alone | Flagged. Per-type prompt offered as the alternative |
| G3 | A1 / A2 / well / poorly controlled | Judgment; negative for A1; would share targets with a chart A2 gate | SELECT router `gate-control-class` |
| G4 | Continue therapy when treated and at target | "On medication AND at target" needs product-level RXCUIs (no hierarchy), and Z79.4/Z79.84 are not coded with O24.4 | Router option "A2 well controlled" → Step 7.3 |
| G5 | Postpartum prediabetes band exclusive of diabetes | `(A AND B) OR (C AND D)` has no encoding | Non-exclusive gates; Step 9.4 supersedes |
| G6 | "This pregnancy" / "4–12 weeks postpartum" | No pregnancy or delivery anchor | Day-count horizons (D-14, D-19) |
| G7 | Metformin with hypertension (cross-pathway) | No condition-aware suppression | D-2 declined: the prescriber's call; ADA caution in the notes only |
| G8 | Both O24.41x and O24.43x on file | Chart gates have no negation | Both stages open (visible); Step 1.1 asks for a problem-list fix (D-19) |

### Source gaps

- `[GAP]` ACOG PB 190 full text (paywalled; reaffirmed 2026).
- `[GAP]` No numeric insulin titration algorithm or basal:bolus split in ADA 2026 or PB text.
- `[GAP]` No US source gives a number or % of above-target values. ">50%" is Josh's
  operational rule (D-9).
- `[GAP]` A1GDM antenatal-testing start GA: no consensus before 40 0/7 weeks (CO 828).
- `[GAP]` Growth-ultrasound timing ("late in the third trimester" only).
- `[GAP]` GDM intrapartum glucose target (out of scope).
- `[GAP]` Metformin dose for postpartum prediabetes; metformin in lactation.
- `[GAP]` No CMS/NCQA-adopted GDM-specific measure. QM-B1 is SMFM's proposed metric.
- `[GAP]` No Z86.32-triggered adult preventive pathway exists to own lifelong screening (D-12).

### Source conflicts

| # | Conflict | Resolution |
|---|---|---|
| C1 | Metformin: ADA/ACOG "not first-line / reasonable alternative" vs SMFM "reasonable and safe first-line alternative" | Role `alternative`; SMFM cited |
| C2 | Metformin max dose: PB text 2,500–3,000 mg/day vs FDA label 2,550 mg/day | Label ceiling |
| C3 | Glyburide max dose: PB "up to 30 mg" vs label 20 mg | Moot while role is `avoid` |
| C4 | Obesity weight gain: ADA 10–20 lb vs IOM/CO 548 11–20 lb | 11–20 lb |
| C5 | Poorly controlled GDM delivery: CO 831 "individualized" vs PB "37 0/7–38 6/7 may be justified" | Both stated; CO 831 governs |
| C6 | Postpartum test: ADA OGTT at 4–12 weeks vs ACOG accepting FPG alone | ADA 75-g OGTT |

### Simulator coverage `[SIM]`

- **Enterable today:** O24.410/.414/.415/.419, so `gate-gdm-antepartum` fires. GA is sent by the
  encounter page, so the GA-32 gates decide immediately there.
- **All question gates work.**
- **Not seeded:** O24.43x, 1552-9 and 1518-0. The postpartum stage and its gates need seeding.
  `ensureClinicalCodeReference` has no callers.
- **Seed-table defects** (v1 finding, unchanged; outside this pathway):
  - RxNorm 860975 (labelled metformin 500 mg) is an ER tablet.
  - 310539 is glyburide 6 mg.
  - 847191 ("lispro") is an aspart 70/30 pen.
  - 847232 ("aspart") is a Lantus pen.
  - 847187 ("glargine") is a human 70/30 pen.
  - 106892 ("NPH") is Humulin 70/30.
  - LOINC 1521-4 is a 2-h post-meal serum glucose, not a urine strip.
  - LOINC 10450-5 is a 10-hour fasting glucose, not a gestational panel.
