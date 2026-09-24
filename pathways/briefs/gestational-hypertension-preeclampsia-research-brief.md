# Pathway Research Brief — Gestational Hypertension & Preeclampsia

**Status: DRAFT v1 for physician review — not yet approved for JSON build.**

Scope confirmed with the requester: **outpatient prenatal care**, running from risk
assessment and aspirin prophylaxis through diagnosis, severity assessment and outpatient
surveillance, **stopping at the trigger for admission/delivery**. Covers gestational
hypertension, preeclampsia, and preeclampsia with severe features. Includes the low-dose
aspirin prophylaxis arm. Chronic hypertension is a *risk factor* here, not a managed entity;
eclampsia and HELLP appear only as escalation triggers.

Research method: 4 parallel domain agents over fetched guideline full text, then 2
verification agents (codes, citations). Every code below was verified against the CMS 2026
ICD-10-CM Tabular, the NLM LOINC service, or RxNav. Every citation was re-fetched and its
claims confirmed. Flags: `[GAP]` unsourceable · `[FALLBACK SOURCE]` non-US basis ·
`[NOT ENCODABLE]` clinically required but not expressible in the current schema ·
`[DECISION]` an authoring choice the reviewing physician must ratify.

> ### ⚠ Read this first — much of this pathway is not encodable today
>
> Preeclampsia's central diagnostic criterion is **two blood pressures ≥140/90 at least four
> hours apart**. That cannot be expressed, for three independent reasons found in the engine:
>
> 1. **The patient context holds exactly one blood pressure.** `vitalSigns` is a flat bag of
>    path → value with no dates. There is no BP series to test.
> 2. **`count_in_window` counts results, not abnormal results.** It matches on code and date
>    window, then increments — it never compares the value to a threshold. "Two readings
>    ≥140" is not something it can say.
> 3. **No operator constrains the spacing between events.** Even given a dated series, "at
>    least four hours apart" has no encoding.
>
> Four further criteria are also unencodable: transaminases **>2× the upper limit of normal**
> (thresholds are literal numbers; results carry no reference range), creatinine **doubling**
> (delta is an absolute difference, not a fold-change), severe BP **persisting ≥15 minutes**,
> and the aspirin rule's **≥2-of-8** count.
>
> The pathway below is authored honestly against these limits: what can be evaluated from
> data is a data gate, and everything else is an explicit clinician question rather than a
> silent approximation. §18 lists every gap with what it would take to close it.

---

## 1. Pathway metadata

- **Logical ID**: `gestational-hypertension-preeclampsia`
- **Title**: Gestational Hypertension and Preeclampsia — Outpatient Screening, Diagnosis and Surveillance
- **Version**: 1 `[DECISION — Josh 2026-09-24]` stays `"1"`: still a draft, so the stage renumbering
  re-imports as DRAFT_UPDATE (same logical_id and version).
- **Category**: OBSTETRIC
- **Scope**: Outpatient prenatal care. Risk assessment and aspirin prophylaxis from the first
  prenatal visit; BP surveillance; diagnosis and severity classification after 20 weeks;
  outpatient expectant management. Ends at the trigger for admission or delivery.
- **Target population**: Pregnant patients receiving prenatal care. The prophylaxis arm
  applies to all; the diagnostic and surveillance arms apply after 20 0/7 weeks.
- **Condition codes** (trigger codes; OR semantics):

| Code | System | Description | Usage note | Grouping |
|---|---|---|---|---|
| O13.2 | ICD-10 | Gestational [pregnancy-induced] hypertension without significant proteinuria, second trimester | primary trigger | gestational-htn |
| O13.3 | ICD-10 | Gestational hypertension without significant proteinuria, third trimester | primary trigger | gestational-htn |
| O13.9 | ICD-10 | Gestational hypertension without significant proteinuria, unspecified trimester | primary trigger | gestational-htn |
| O14.02 | ICD-10 | Mild to moderate pre-eclampsia, second trimester | primary trigger | preeclampsia |
| O14.03 | ICD-10 | Mild to moderate pre-eclampsia, third trimester | primary trigger | preeclampsia |
| O14.00 | ICD-10 | Mild to moderate pre-eclampsia, unspecified trimester | primary trigger | preeclampsia |
| O14.12 | ICD-10 | Severe pre-eclampsia, second trimester | primary trigger | preeclampsia-severe |
| O14.13 | ICD-10 | Severe pre-eclampsia, third trimester | primary trigger | preeclampsia-severe |
| O14.10 | ICD-10 | Severe pre-eclampsia, unspecified trimester | primary trigger | preeclampsia-severe |
| O16.2 | ICD-10 | Unspecified maternal hypertension, second trimester | undifferentiated presentation | htn-unspecified |
| O16.3 | ICD-10 | Unspecified maternal hypertension, third trimester | undifferentiated presentation | htn-unspecified |
| R03.0 | ICD-10 | Elevated blood-pressure reading, without diagnosis of hypertension | the interim state between a first elevated reading and confirmation | htn-unconfirmed |

**Deliberately excluded from triggers.** `O13.1` (first-trimester gestational hypertension)
exists but contradicts the ≥20-week definition — it should never be emitted by this pathway.
There is **no** first-trimester preeclampsia code: verification confirmed O14.01 and O14.11
do not exist, and neither does a first-trimester eclampsia code. That is deliberate in
ICD-10 — the code system itself enforces the ≥20-week rule. `O11.*` (pre-existing
hypertension with preeclampsia) is the superimposed-preeclampsia boundary and routes out.

**Parser warning for the builder.** O13 encodes trimester in the **4th** character
(O13.1/.2/.3); O14 and O15 encode it in the **5th** (O14.x0/.x2/.x3). Any code manipulation
assuming a uniform offset will mis-slot these.

## 1b. Code sets

None. Single-condition pathway.

## 2. Stages

- **Stage 1 — Risk Assessment & Prophylaxis** *(entry stage, root-connected)*: preeclampsia
  risk-factor screening at the first prenatal visit; low-dose aspirin for those who qualify;
  baseline labs for elevated-risk patients. [1][2][3][4]
- **Stage 2 — Detection & Diagnosis** *(root-connected)*: BP measurement at every prenatal
  visit with correct technique; confirmation of hypertension; proteinuria quantification when
  preeclampsia is suspected; classification as gestational hypertension or preeclampsia. [1][7]
- **Stage 3 — Severity Assessment** *(branch-entry only, via `gate-htn-diagnosed`)*: the
  severe-features determination that decides whether outpatient management remains
  appropriate. [1]
- **Stage 4 — Outpatient Surveillance** *(branch-entry only, via `gate-no-severe-features`)*:
  the weekly maternal and fetal surveillance regimen of expectant management to 37 0/7 weeks. [1]
- **Stage 5 — Escalation & Handoff** *(branch-entry only, via `gate-escalation-required`)*:
  the exit boundary — what triggers admission or delivery, and the postpartum follow-up that
  must be scheduled before discharge. [1][8][12]

- **Stage `stage-1-aspirin` — Low-Dose Aspirin Prophylaxis (if indicated)** *(branch-entry
  only, via `gate-aspirin-indicated`; `stage_number` **1.5**)*: holds Steps 1.2 and 1.3.
- **Stage `stage-2-workup` — Hypertension Work-up (if confirmed)** *(branch-entry only, via
  `gate-htn-confirmed`; `stage_number` **2.5**)*: holds Steps 2.3 and 2.4.

Stages 3, 4 and 5, and the two sub-stages above, are **branch-entry only** and get no root
`HAS_STAGE` edge.

`[BUILD FIX 2026-09-24 — Rule 3]` The two sub-stages exist only so one question gate can
open two steps. Main's import (PR #55) treats a gate with several `BRANCHES_TO` edges as a
router that takes exactly one edge by answer, so "on yes, open 1.2 and 1.3" must target a
single container. Step ids and display numbers are unchanged; each sub-stage carries its
parent stage's citations.

`[DECISION — Josh 2026-09-24]` **Every stage gets a unique number.** The sub-stages had
reused their parents' `stage_number` (1 and 2), so the admin dashboard's drill-down showed
two "Stage 1" and two "Stage 2" cards (it sorts and labels stages by `stage_number`).
Renumbered **`stage-1-aspirin` → 1.5** and **`stage-2-workup` → 2.5**. Decimals, not a
1–7 renumbering, because each sub-stage holds its parent's steps (1.2/1.3, 2.3/2.4): the
order is unchanged (1, 1.5, 2, 2.5, 3, 4, 5), every step id and display number stays, and
"Stage 1.5" reads as part of Stage 1. Renumbering 1–7 would either leave Stage 3 holding
steps "2.1–2.2" or force every later step, id and brief cross-reference to change. The
gate-control check now fails duplicate stage numbers.

## 3. Steps

- **Step 1.1 — Preeclampsia risk-factor screening** *(entry step)*: at the first prenatal
  visit, complete a structured risk-factor checklist covering the high- and moderate-risk
  tiers. Roughly half the moderate tier is not available from a problem list and must be
  asked. [2][3][4]
- **Step 1.2 — Baseline laboratory assessment** *(gated by `gate-aspirin-indicated`)*: for
  patients at elevated risk, obtain baseline platelets, AST, ALT, creatinine, and either a
  24-hour urine protein or a protein/creatinine ratio, so later values can be interpreted. [8]
- **Step 1.3 — Initiate low-dose aspirin** *(gated by `gate-aspirin-indicated`)*: aspirin
  81 mg daily, started between 12 0/7 and 28 0/7 weeks — optimally before 16 0/7 — and
  continued until delivery. [1][2][3]
- **Step 2.1 — Blood pressure measurement at every prenatal visit** *(unconditional)*:
  measure with a correctly sized cuff (length 1.5× upper-arm circumference, or a bladder
  encircling ≥80% of the arm), patient upright after ≥10 minutes' rest, no tobacco or
  caffeine for 30 minutes beforehand. [1][7]
- **Step 2.2 — Confirm hypertension** *(gated by `gate-bp-elevated`)*: repeat the measurement
  to establish whether BP ≥140/90 is persistent — two occasions at least four hours apart —
  after 20 weeks in a previously normotensive patient. Severe-range values are confirmed over
  minutes rather than hours. [1]
- **Step 2.3 — Quantify proteinuria** *(gated by `gate-htn-confirmed`)*: 24-hour urine
  protein, or protein/creatinine ratio, or dipstick only where quantitative methods are
  unavailable. Ordered when preeclampsia is suspected, never as routine screening. [1][7]
- **Step 2.4 — Classify: gestational hypertension or preeclampsia** *(gated by
  `gate-htn-confirmed`)*: preeclampsia requires confirmed hypertension plus either
  proteinuria or a qualifying end-organ finding. [1]
- **Step 3.1 — Severe-features assessment** *(gated by `gate-htn-diagnosed`)*: obtain the
  severity panel — platelets, creatinine, AST/ALT — and review symptoms for headache,
  visual disturbance, right upper quadrant or epigastric pain, and shortness of breath. [1]
- **Step 4.1 — Weekly maternal surveillance** *(gated by `gate-no-severe-features`)*: at
  least one in-clinic visit per week with BP and symptom assessment; weekly platelets,
  creatinine and liver enzymes. [1]
- **Step 4.2 — Weekly proteinuria assessment — gestational hypertension only** *(gated by
  `gate-gestational-htn`)*: once-weekly proteinuria, because up to half of these patients
  progress to preeclampsia. Once preeclampsia is diagnosed this stops — repeat quantification
  is explicitly not recommended and does not influence management. [1]
- **Step 4.3 — Fetal surveillance** *(gated by `gate-no-severe-features`)*: growth
  ultrasonography every 3–4 weeks; amniotic fluid volume at least weekly; an antenatal test
  one to two times per week. [1]
- **Step 4.4 — Patient safety-netting and warning signs** *(gated by
  `gate-no-severe-features`)*: deliver the urgent maternal warning signs and confirm the
  patient knows how and when to report them. [1][10][11]
- **Step 5.1 — Escalate to inpatient evaluation** *(gated by `gate-escalation-required`)*:
  any severe feature, any condition precluding expectant management, or severe-range BP not
  responding to therapy. [1]
- **Step 5.2 — Schedule postpartum blood pressure follow-up** *(gated by
  `gate-htn-diagnosed`)*: arrange before discharge — within 3 days of discharge where severe
  hypertension occurred, within 7 days otherwise; ACOG's outer bound is 7–10 days, and 72
  hours for severe hypertension. [8][12]
- **Step 5.3 — Long-term cardiovascular risk counselling** *(gated by `gate-htn-diagnosed`)*:
  a hypertensive disorder of pregnancy roughly doubles later cardiovascular risk, graded by
  severity, and this applies to gestational hypertension as well as preeclampsia. [1]

Gated steps connect **only** via their gate's `BRANCHES_TO` — no `HAS_STEP` edge — per the
gate-wiring rule. Steps 1.1 and 2.1 are unconditional and keep their `HAS_STEP`.

## 4. Decision points

- **DP-1 — Choice of proteinuria quantification method** (after Step 2.3) — branch_mode: one_of
  - Criterion 1a: quantitative method available → 24-hour urine or protein/creatinine ratio → **Step 2.4** [1]
  - Criterion 1b: quantitative methods unavailable → dipstick, 2+ as the discriminant → **Step 2.4** [1]
  - Genuinely a judgment/logistics call, not machine-evaluable: the pathway cannot know which
    assays a site offers. ACOG is explicit that dipstick is a fallback only — 1+ is a false
    positive in 71% of cases against the 300 mg standard. [1]

## 4b. Gates

**Framing note.** Six of the eleven gates below are `question` gates. That is not a modelling
shortcut — it is what the engine's grammar leaves available for these criteria. Each one
states what data gate it *would* have been and why that is not expressible.

- **Gate `gate-aspirin-indicated` — Does this patient qualify for low-dose aspirin prophylaxis?**
  - Attached to: `step-1-1` · Branches to: `stage-1-aspirin` (holds `step-1-2`, `step-1-3`)
    `[BUILD FIX — Rule 3]`
  - Exclusively gated: yes — Steps 1.2 and 1.3 are removed from Stage 1's plain flow.
  - Type: **question** · answer_type: BOOLEAN
  - Default behavior: **skip** `[BUILD FIX 2026-09-24 — was traverse]`. The original note
    (G12) said `default_behavior` is inert on question gates. It is inert only while the
    question is **unanswered** (that always pends). Once answered **"no"**, `traverse`
    INCLUDED the target anyway — a "no" still opened aspirin and baseline labs. `skip` makes
    "no" exclude them; an unanswered question still pends, unchanged.
  - Prompt: "Does this patient qualify for low-dose aspirin prophylaxis? Qualifies with ANY
    ONE high-risk factor (prior preeclampsia, multifetal gestation, chronic hypertension,
    pregestational type 1 or 2 diabetes, kidney disease, autoimmune disease such as SLE or
    antiphospholipid syndrome); OR TWO OR MORE moderate-risk factors (nulliparity, BMI >30,
    family history of preeclampsia in mother or sister, Black race, lower income, age ≥35,
    personal history factors, in vitro conception); OR, on its own, Black race or lower
    income."
  - `[NOT ENCODABLE]` **Why this is not a data gate.** The rule is
    `high_any OR moderate_count ≥ 2 OR (black_race OR lower_income)`. Compound gates have a
    single AND/OR over a flat list and cannot count — there is no N-of-M operator. Separately,
    about half the moderate tier is not codeable at all: family history in a mother or sister,
    lower income, personal history factors, and prepregnancy BMI. And the single
    highest-weighted factor, **prior preeclampsia, has no ICD-10 code** — the coding index
    routes it to "poor obstetric history" (O09.29-), which also captures prior stillbirth and
    neonatal death, so it is sensitive but not specific.
  - `[DECISION]` Race is included in the prompt because the guideline includes it, framed as
    ACOG frames it — a proxy for exposure to racism, not a biological variable. It is
    deliberately **elicited rather than auto-fired from a demographic field**, so that a
    clinician sees and applies the framing. Please ratify this choice explicitly.
  - Rationale & source: [1] Level A; [2] Grade B; [3]; [4]

- **Gate `gate-bp-elevated` — Latest blood pressure at or above 140/90?**
  - Attached to: `step-2-1` · Branches to: `step-2-2`
  - Exclusively gated: yes — Step 2.2 leaves Stage 2's plain flow.
  - Type: **compound**, operator **OR** · Default behavior: **skip** — with no BP on record
    there is nothing to confirm; the surveillance step itself is unconditional.
  - Conditions (coded) `[BUILD FIX 2026-09-24 — was labs 8480-6 / 8462-4, horizon {days: 7}]`:
    - field `vitals`, `greater_than`, value `systolic_bp`, threshold **139.9**, horizon `DAY`
    - field `vitals`, `greater_than`, value `diastolic_bp`, threshold **89.9**, horizon `DAY`
  - `[DECISION — Josh 2026-09-24]` **Ratified: blood pressure stays as vitals**
    (`vitalSigns.systolic_bp` / `diastolic_bp`, horizon `DAY`), here and in
    `gate-escalation-required`. The build fix below stands; the lab-form decision under it
    is superseded. No JSON change.
  - `[BUILD FIX — REVERSES THE DECISION BELOW; RATIFIED 2026-09-24]` The simulator (and the
    patient-context contract) delivers BP as `vitalSigns.systolic_bp` / `diastolic_bp`, never
    as LOINC labs. Authored as labs, a BP of 150/95 entered in the simulator made this gate
    ask for LOINC 8480-6 and held every later GHTN gate. OR-ing the lab and vitals forms
    does not work either: with a normal vitals BP and no lab, the OR still asks for the lab.
    The reasons below for labs (dates, repeats) do not hold in the simulator, whose labs
    are undated too. Thresholds unchanged.
  - `[DECISION — superseded]` **Blood pressure is authored as a coded lab, not as a vital.** This
    contradicts the format spec's guidance to use `field: vitals` for vital thresholds, and it
    is deliberate: `vitalSigns` is a flat undated bag holding **one** value per path, so a
    vitals-form BP gate can never see more than a single reading and can never be time-scoped.
    Coded labs carry dates and support multiple entries. ~~Please ratify.~~ Superseded by
    the ratified vitals form above.
  - `[DECISION]` Thresholds are 139.9 and 89.9 because the coded operators have no ≥. At the
    1 mmHg reporting resolution of a BP measurement this is exactly "≥140" and "≥90" — the
    same device the brief for anemia used for MCV bands.
  - Rationale & source: [1] Box 2

- **Gate `gate-htn-confirmed` — Has hypertension been confirmed per ACOG criteria?**
  - Attached to: `step-2-2` · Branches to: `stage-2-workup` (holds `step-2-3`, `step-2-4`)
    `[BUILD FIX — Rule 3]`
  - Exclusively gated: yes
  - Type: **question** · answer_type: BOOLEAN · Default behavior: **skip** — an unconfirmed
    elevated reading must not open the diagnostic arm; R03.0 is the correct interim state.
  - Prompt: "Is hypertension confirmed? Two readings with systolic ≥140 or diastolic ≥90, at
    least 4 hours apart, after 20 0/7 weeks, in a patient previously normotensive. Severe-range
    readings (≥160/≥110) may be confirmed over minutes rather than hours."
  - `[NOT ENCODABLE]` **The single most important gap in this pathway.** The intended data
    gate is "two readings above threshold, ≥4 hours apart." All three of its components fail:
    the context holds only one BP; `count_in_window` counts *results* rather than
    threshold-crossings; and no operator constrains spacing between events. See §18 G1–G3.
  - Rationale & source: [1] Box 2; gestational hypertension definition

- **Gate `gate-htn-diagnosed` — Diagnosis of gestational hypertension or preeclampsia established?**
  - Attached to: `step-2-4` · Branches to: `stage-3`
  - `[BUILD FIX — Rule 3]` Emitted as three identical-condition gates, one per target:
    `gate-htn-diagnosed` → `stage-3`, `gate-htn-diagnosed-pp-followup` → `step-5-2`,
    `gate-htn-diagnosed-cv-counsel` → `step-5-3`. A compound gate may have only one target
    on main; the targets sit in different stages, so a container stage does not fit.
  - Exclusively gated: yes — Stage 3 is branch-entry only.
  - Type: **compound**, operator **OR** · Default behavior: **skip**
  - Conditions (coded), each `includes_code`, field `conditions`, system ICD-10, horizon `{days: 300}`, status `active`:
    `O13.2` · `O13.3` · `O13.9` · `O14.0.*` · `O14.1.*` · `O14.9.*`
  - `[DECISION]` Wildcards use the `.*` suffix form the matcher actually supports — a bare
    `O14.0*` would fall through to exact string equality and never match. This was a real
    defect found in the anemia pathway.
  - Rationale & source: [1]

- **Gate `gate-gestational-htn` — Gestational hypertension rather than preeclampsia?**
  - Attached to: `stage-4` · Branches to: `step-4-2`
  - Exclusively gated: yes — weekly proteinuria applies to gestational hypertension only.
  - Type: **compound**, operator **OR** · Default behavior: **skip** — if the distinction is
    unclear, do not order serial proteinuria that ACOG says not to repeat in preeclampsia.
  - Conditions: `includes_code` field `conditions` system ICD-10 horizon `{days: 300}` status `active`, values `O13.2`, `O13.3`, `O13.9`
  - Rationale & source: [1] — up to 50% of gestational hypertension progresses to preeclampsia,
    and more often when diagnosed before 32 weeks

- **Gate `gate-severe-bp` — Severe-range blood pressure?**
  - Attached to: `step-3-1` · Branches to: `step-5-1`
  - Exclusively gated: **no — see the conflict note below**
  - Type: **compound**, operator **OR** · Default behavior: **skip**
  - Conditions (coded):
    - field `labs`, `greater_than`, value `8480-6`, system LOINC, threshold **159.9**, horizon `{days: 1}`
    - field `labs`, `greater_than`, value `8462-4`, system LOINC, threshold **109.9**, horizon `{days: 1}`
  - `[DECISION — REQUIRES RATIFICATION]` **Three gates want to branch to `step-5-1`**
    (`gate-severe-bp`, `gate-severe-feature-labs`, `gate-severe-feature-symptoms`). Two gates
    may never share a target — the first to miss claims it and a later satisfied gate cannot
    rescue it, so escalation would be silently suppressed. **Resolution adopted:** a single
    escalation gate, `gate-escalation-required` (below), is the only route to `step-5-1`, and
    the three findings become OR-ed conditions inside it. The three gates above are therefore
    **not emitted as separate gates** — they are documented here as the clinical decomposition
    only. Please confirm this is acceptable, since it means the care plan cannot show *which*
    finding triggered escalation.
  - Rationale & source: [1] Box 3

- **Gate `gate-escalation-required` — Does any finding preclude continued outpatient management?**
  - Attached to: `step-3-1` · Branches to: `stage-5`
  - Exclusively gated: yes — Stage 5 is branch-entry only, and this is its sole route.
  - Type: **compound**, operator **OR** · Default behavior: **skip** — but see the safety note.
  - Conditions (coded):
    - field `vitals`, `greater_than`, value `systolic_bp`, threshold 159.9, horizon `DAY` — severe-range systolic `[BUILD FIX — was labs 8480-6, {days: 1}; see gate-bp-elevated]` `[DECISION — Josh 2026-09-24: vitals ratified]`
    - field `vitals`, `greater_than`, value `diastolic_bp`, threshold 109.9, horizon `DAY` — severe-range diastolic `[BUILD FIX — was labs 8462-4, {days: 1}]`
    - field `labs`, `less_than`, value `777-3`, system LOINC, threshold **100** — platelets <100,000/µL. **Unit note: the threshold is in ×10⁹/L, matching how LOINC 777-3 is conventionally reported. If the feed reports raw cells/µL this is off by 1,000.** See §18 G7.
    - field `labs`, `greater_than`, value `2160-0`, system LOINC, threshold **1.1** — creatinine >1.1 mg/dL
    - field `conditions`, `includes_code`, value `O14.1.*`, system ICD-10, horizon `{days: 300}`, status `active` — severe preeclampsia already coded
  - `[GAP]` **This gate covers only 5 of the 15 conditions precluding expectant management.**
    The other ten are clinician-judgment items with no numeric threshold: refractory headache,
    RUQ or epigastric pain unresponsive to analgesia, visual disturbance, motor deficit or
    altered sensorium, stroke, myocardial infarction, pulmonary edema, suspected abruption,
    abnormal fetal testing, and persistent reversed end-diastolic umbilical artery flow. They
    are carried by `gate-severe-feature-symptoms` below.
  - `[DECISION]` **`skip` as the default is uncomfortable and should be reviewed.** With no
    labs on file this gate does not fire and the patient stays in outpatient surveillance.
    `traverse` would escalate every data-poor patient, which is its own harm. The mitigation
    is that surveillance itself is weekly and the symptom gate runs in parallel. Please ratify.
  - Rationale & source: [1] Box 3, Box 4

- **Gate `gate-severe-feature-symptoms` — Any severe feature on clinical assessment?**
  - Attached to: `step-3-1` · Branches to: `step-5-1`
  - Exclusively gated: yes
  - Type: **question** · answer_type: BOOLEAN · Default behavior: **skip** — an unanswered
    symptom review is not a negative finding, but the weekly in-clinic visit is where it is asked.
  - Prompt: "Does the patient have ANY of the following? New-onset headache unresponsive to
    acetaminophen and not otherwise explained; visual disturbance; severe persistent right
    upper quadrant or epigastric pain unresponsive to analgesia; pulmonary oedema;
    transaminases more than twice the upper limit of normal; a doubling of serum creatinine;
    or severe-range blood pressure not responding to antihypertensive therapy."
  - `[NOT ENCODABLE]` Two of these are laboratory criteria that nonetheless cannot be data
    gates. **">2× the upper limit of normal"** is a lab-local threshold, and results carry no
    reference range — `unit` is not even an allowed key on a coded condition. **"Doubling of
    creatinine"** is a fold-change against a baseline, and the delta operator compares an
    absolute difference. See §18 G4–G5.
  - `[DECISION]` Every criterion here carries a "not accounted for by alternative diagnoses"
    qualifier in the source. That is a negative-differential assertion no data element encodes,
    which independently forces elicitation.
  - Rationale & source: [1] Box 3, Box 4

- **Gate `gate-no-severe-features` — Outpatient expectant management appropriate?**
  - Attached to: `step-3-1` · Branches to: `stage-4`
  - Exclusively gated: yes — Stage 4 is branch-entry only.
  - Type: **question** · answer_type: BOOLEAN · Default behavior: **skip** — surveillance must
    not begin on an unconfirmed severity assessment.
  - Prompt: "Is outpatient expectant management appropriate? Requires: no severe features; and
    the patient can adhere to weekly in-clinic visits, weekly laboratory testing and one-to-two
    times weekly fetal testing. Inability to adhere to this monitoring is itself an indication
    for admission."
  - `[DECISION]` This is the negation of `gate-escalation-required`, and the engine has no
    negative arm — a gate expresses only its satisfied branch. Authored as its own question
    rather than derived. The adherence clause is a genuine ACOG criterion, not an addition.
  - `[GAP]` Because this and `gate-escalation-required` are independent, a patient could in
    principle satisfy both or neither. The weekly visit is where that is reconciled by a human.
  - Rationale & source: [1]

- **Gate `gate-gestational-age-delivery` — At or beyond 37 0/7 weeks?**
  - Attached to: `stage-4` · Branches to: `step-5-1`
  - Exclusively gated: **no — collides with `gate-escalation-required`'s target**
  - Type: **question** · answer_type: BOOLEAN · Default behavior: **skip**
  - Prompt: "Is the patient at or beyond 37 0/7 weeks of gestation? At this point delivery
    rather than continued expectant management is recommended for gestational hypertension or
    preeclampsia without severe features."
  - `[DECISION — NOT EMITTED]` Same collision as `gate-severe-bp`: `step-5-1` may have only one
    gate. **Resolution: this gate is not emitted**; the 37-week rule moves into Step 4.1's
    description and the weekly visit, where gestational age is known. Recorded here because the
    rule is Level A and must not be lost. `[NOT ENCODABLE]` Gestational age has no data route
    regardless — `patient.*` attributes are never populated by the simulator, and Z3A codes
    would need a separate condition per week.
  - Rationale & source: [1] Level A

- **Gate `gate-postpartum-severe` — Was there severe hypertension during the birth admission?**
  - Attached to: `step-5-2` · Branches to: none — modifies Step 5.2's scheduling window
  - Exclusively gated: **n/a — this gate has no branch target**
  - `[DECISION — NOT EMITTED]` The clinical need is to choose a 3-day versus 7-day postpartum
    follow-up window. A gate with no `BRANCHES_TO` guards nothing and would be flagged by the
    gate-control checker. **Resolution: both windows are described in Step 5.2 and the
    clinician selects.** Recorded so the distinction is not lost. To make this a real gate,
    Step 5.2 would need to split into two steps, one per window.
  - Rationale & source: [8] SHTN P2A/P2B; [12]

## 5. Medications

- **Med-1 — Aspirin 81 mg** (on Step 1.3)
  - Role: first_line · Clinical role: `preeclampsia-prophylaxis`
  - Dose 81 mg · once daily · oral · from 12 0/7–28 0/7 weeks (optimally before 16 0/7) until delivery
  - Escalates to: none
  - Notes: The 81 mg prophylaxis regimen is guideline-sourced, not label-sourced — the OTC
    Drug Facts panel carries only analgesic directions. **Must be explicitly exempted from any
    generic "no NSAIDs after 20 weeks" rule**: FDA's own advisory names low-dose aspirin as
    the exception, and a naive class rule would fire a false contraindication exactly when
    prophylaxis matters most.
  - Source: [1] Level A; [2] Grade B; [3]
- **Med-2 — Labetalol** (on Step 5.1)
  - Role: **first_line** · Clinical role: `antihypertensive-primary`
  - Maintenance: 200 mg every 12 hours, increasing to 800 mg every 8–12 hours as needed;
    maximum 2,400 mg/day · oral. Acute severe-range: 10–20 mg IV, then 20–80 mg every 10–30
    minutes to a cumulative maximum of 300 mg, or 1–2 mg/min by infusion.
  - Escalates to: none — see the co-equal note below
  - Notes: avoid in asthma, pre-existing myocardial disease, decompensated cardiac function,
    heart block, bradycardia. Neonates exposed near delivery may have hypotension, bradycardia,
    hypoglycaemia or respiratory depression. **Provenance: PB 222 gives the oral maintenance
    regimen in narrative text, not in its graded recommendations; PB 203 and the FDA label
    supply the rest.**
  - Source: [1] narrative and Table 3; [5] PB 203; [6] FDA label
- **Med-3 — Nifedipine, extended release** (on Step 5.1)
  - Role: **first_line — co-equal with labetalol, not second choice** · Clinical role: `antihypertensive-primary`
  - 30–60 mg once daily, titrated over 7–14 days; maximum 120 mg/day · oral
  - Escalates to: none
  - Notes: avoid in tachycardia; **never sublingual**. `[GAP]` PB 222 gives no
    extended-release regimen at all — this dosing is PB 203 and the FDA label.
  - Source: [5]; [6]
- **Med-4 — Nifedipine, immediate release** (on Step 5.1)
  - Role: **first_line for acute severe-range control** · Clinical role: `antihypertensive-acute-severe`
  - 10–20 mg orally, repeat after 20 minutes if needed, then 10–20 mg every 2–6 hours;
    maximum 180 mg/day · oral. Onset 5–10 minutes.
  - Notes: **immediate release only** — this is PB 222 Table 3's urgent-control agent and its
    numbers must never be used for maintenance. The separate lane is deliberate: if an
    implementer substituted extended release here it would share `antihypertensive-primary`
    with labetalol and the pathway would conflict with itself.
  - Source: [1] Table 3
- **Med-5 — Methyldopa** (on Step 5.1)
  - Role: alternative · Clinical role: `antihypertensive-alternative`
  - 250 mg two or three times daily, to a maximum of 3,000 mg/day · oral
  - Notes: contraindicated in active hepatic disease and with MAO inhibitors. `[GAP]`
    **PB 222 contains no mention of methyldopa at all** — sourced entirely from PB 203 and the
    FDA label, and no accessible source gives a rationale for ranking it below labetalol and
    nifedipine. The demotion is stated by the guidelines, not justified by them.
  - Source: [5]; [6]
- **Med-6 — ACE inhibitors, ARBs, renin inhibitors, mineralocorticoid receptor antagonists** (on Step 5.1)
  - Role: contraindicated · Clinical role: `antihypertensive-primary` (lane-tagged so
    cross-pathway substitution attempts are flagged)
  - Notes: FDA boxed warning at class level — these reduce fetal renal function and increase
    fetal and neonatal morbidity and death; resulting oligohydramnios can cause pulmonary
    hypoplasia and skeletal deformation.
  - Source: [6] FDA boxed warning; [5]

> ### ⚠ `[DECISION — REQUIRES RATIFICATION]` Labetalol and nifedipine are co-equal, and the engine cannot say so
>
> ACOG names **both** labetalol and nifedipine as first-line; for acute severe-range control
> PB 222 cites Cochrane data across 3,573 women finding no efficacy or safety difference and
> concludes *"any of these agents can be used."* Med-2 and Med-3 are therefore **alternatives,
> and the numbering is presentational only** — it is not a ranking.
>
> **The problem.** Conflict detection groups medications by `clinical_role` alone, with no
> pathway check (`care-plan-merge.ts` → `detectConflicts`). Two distinct drug names sharing a
> lane is a conflict wherever they come from — including from the same pathway. And on
> conflict, **both drugs are removed from the active medication list** and parked in a pending
> conflict rather than surfaced as options.
>
> So authoring these two honestly — same lane, because they genuinely occupy the same
> therapeutic lane — means a patient who needs an antihypertensive is offered **neither**.
> The schema has no way to express "interchangeable alternatives, choose one": equivalence and
> contradiction produce the same signal.
>
> **Three options, none clean:**
> 1. **Same lane, accept the conflict** — clinically truthful, but both drugs are withheld
>    pending resolution. Safe only if a clinician always sees and resolves the conflict.
> 2. **Split the lane** (`antihypertensive-primary-betablocker` / `-ccb`) — no self-conflict,
>    but it silences the genuine cross-pathway signal: a concurrent chronic-hypertension
>    pathway prescribing the other agent would no longer be flagged as duplicate therapy.
> 3. **Emit only one first-line agent** and put the alternative in prose — loses the choice.
>
> **Recommended: option 1** for this pathway, since these meds sit at the escalation boundary
> where a clinician is present by definition, and withholding pending review is defensible
> there. It would be the wrong choice for a routine maintenance pathway. Please ratify.

**Cross-pathway note.** These lanes are disjoint from the anemia pathway's iron and folate
lanes, so no conflict fires between the two — correctly. The one real cross-pathway concern,
low-dose aspirin with oral iron, is **not expressible**: there is no interaction edge in the
schema, and the lane mechanism only detects same-lane different-drug. Evidence for it is in
any case inconclusive, with no demonstrated effect on haemoglobin. Recorded in §18 G8.

## 6. Lab tests

- **Lab-1 — Blood pressure, systolic** (on Steps 2.1, 2.2, 4.1): code `8480-6` LOINC, purpose diagnosis and surveillance. [1]
- **Lab-2 — Blood pressure, diastolic** (on Steps 2.1, 2.2, 4.1): code `8462-4` LOINC. [1]
- **Lab-3 — Platelet count** (on Steps 1.2, 3.1, 4.1): code `777-3` LOINC, whole blood, severe-feature threshold <100,000/µL. [1]
- **Lab-4 — Serum creatinine** (on Steps 1.2, 3.1, 4.1): code `2160-0` LOINC, serum, severe-feature threshold >1.1 mg/dL or doubling. [1]
- **Lab-5 — Aspartate aminotransferase** (on Steps 1.2, 3.1, 4.1): code `1920-8` LOINC, serum. [1]
- **Lab-6 — Alanine aminotransferase** (on Steps 1.2, 3.1, 4.1): code `1742-6` LOINC, serum. [1]
- **Lab-7 — Protein, 24-hour urine** (on Steps 1.2, 2.3): code `2889-4` LOINC, 24-hour urine, threshold ≥300 mg/24 h. **Mass-per-time — see the warning in §13.** [1]
- **Lab-8 — Protein/creatinine ratio, urine** (on Steps 1.2, 2.3): code `34366-5` LOINC, urine, threshold ≥0.30 dimensionless. **See the warning in §13.** [1]
- **Lab-9 — Protein, urine dipstick** (on Step 2.3): code `20454-5` LOINC, urine, 2+ discriminant, fallback only. [1]
- **Lab-10 — Lactate dehydrogenase** (on Step 3.1): code `2532-0` LOINC, serum, HELLP component ≥600 IU/L. [1]
- **Lab-11 — Uric acid** (on Step 3.1): code `3084-1` LOINC, serum. **Conditional only** — "may be considered" for diagnostic dilemmas such as suspected superimposed preeclampsia; not routine. [1]

## 7. Imaging

- **Img-1 — Obstetric ultrasound, fetal growth** (on Step 4.3): modality US, body_region gravid uterus, code `76816` CPT, every 3–4 weeks. [1]
- **Img-2 — Obstetric ultrasound, limited — amniotic fluid volume** (on Step 4.3): modality US, body_region gravid uterus, code `76815` CPT, at least weekly. [1]
- **Img-3 — Umbilical artery Doppler velocimetry** (on Step 4.3): modality US, body_region umbilical artery, code `76820` CPT. `[GAP]` PB 222 gives **no routine indication or interval** — it appears only as an escalation trigger (persistent reversed end-diastolic flow). Included so the escalation criterion is orderable. [1]

## 8. Procedures

- **Proc-1 — Fetal non-stress test** (on Step 4.3): code `59025` CPT, antenatal testing one to two times weekly. `[GAP]` PB 222 does not specify which antenatal test to use, when to start, or a score threshold defining "abnormal" — it states outright that the data do not exist. [1]
- **Proc-2 — Fetal biophysical profile with non-stress testing** (on Step 4.3): code `76818` CPT, alternative antenatal test. [1]

## 9. Guidance

- **Guid-1 — topic "Urgent maternal warning signs"** (on Step 4.4): category safety-netting.
  Instructions: get help right away for a headache that will not go away or worsens; changes
  in vision such as flashing lights, spots, blurring or temporary loss; severe belly pain that
  does not go away, especially high on the right side or in the pit of the stomach; extreme
  swelling of hands or face; trouble breathing, including breathlessness lying flat; chest
  pain or a fast-beating heart; dizziness or fainting; the baby's movements stopping or
  slowing; severe nausea and vomiting unlike morning sickness; overwhelming tiredness. Always
  say you are pregnant, or have been pregnant within the past year. A seizure is an emergency —
  call 911. **These signs continue to apply for a full year after birth.**
  `[DECISION — LICENSING]` The official ACOG/AIM card is licensed for duplication and
  distribution "in its entirety and without modification, for solely non-commercial activities
  that are for educational, quality improvement, and patient safety purposes. All other uses
  require written permission from ACOG." The condition-filtered wording above therefore falls
  **outside** that grant. **The patient-facing artifact must be the official unmodified card**;
  this text is clinician-facing scaffolding only. Two items above are sourced from PB 222
  rather than the card: the right-upper-quadrant framing and the seizure line. "Sudden weight
  gain" is deliberately absent — it appears in none of the sources. [1][10][11]
- **Guid-2 — topic "Measuring your blood pressure at home"** (on Step 4.1): category education.
  Instructions: use an upper-arm cuff, correctly sized — the cuff length should be about one
  and a half times around your upper arm. Sit upright and rest for at least ten minutes first.
  No tobacco or caffeine for thirty minutes beforehand. Home readings supplement your weekly
  in-clinic visit; they do not replace it. `[GAP]` ACOG specifies cuff sizing and technique but
  is **silent on how often to measure at home, which readings to report, and to whom** — those
  are local operational parameters, not guideline recommendations. Validated upper-arm devices
  for pregnancy are listed by STRIDE BP; no wrist or finger device appears on that list. [1][13]
- **Guid-3 — topic "What we are not recommending, and why"** (on Step 4.1): category education.
  Instructions: bed rest is not recommended — the evidence does not support it. Salt
  restriction is not recommended. Routine calcium supplementation is not recommended in the US,
  where baseline dietary calcium is adequate. Vitamins C and E, fish oil, garlic and vitamin D
  have no demonstrated benefit for prevention. After delivery, anti-inflammatory painkillers
  such as ibuprofen are **preferred** over opioids — patients are often incorrectly told to
  avoid them. [1]
- **Guid-4 — topic "Your heart health after this pregnancy"** (on Step 5.3): category education.
  Instructions: a hypertensive disorder of pregnancy roughly doubles your later risk of
  cardiovascular disease, and the risk is higher after severe, recurrent or early-onset
  disease. This applies to gestational hypertension as well as preeclampsia. Tell every future
  clinician — especially your primary care provider — that you had this condition; there is no
  reliable diagnosis code that carries it forward for you. Modifiable risk factors are the
  lever: healthy weight, exercise, diet, and stopping smoking. In a future pregnancy this
  history alone qualifies you for aspirin prophylaxis. `[GAP]` PB 222 sets **no follow-up
  interval, screening test or target** — it says only that closer follow-up "may warrant"
  consideration, and this is not in its graded recommendations. [1]

## 10. Quality metrics

- **QM-1 — Postpartum blood pressure follow-up scheduled** (on Step 5.2): measure — of patients
  with a hypertensive disorder of pregnancy, the proportion with a postpartum BP and symptom
  check **scheduled** to occur within 3 days of discharge where persistent severe hypertension
  occurred during the birth admission, or within 7 days otherwise. Steward: AIM/ACOG (SHTN
  P2A/P2B). Note the measure counts **scheduling**, not attendance. [8]
- **QM-2 — Aspirin prophylaxis among eligible patients** (on Step 1.3): measure — of patients
  with a documented qualifying risk profile, the proportion started on low-dose aspirin before
  16 0/7 weeks. Steward: **local**. `[GAP]` A proposed SMFM metric exists but its full
  specification was not retrievable, and it is not in the AIM data collection plan, the 2026
  clinician eCQM set, or the MIPS obstetrics set. [1][2]

`[GAP]` — **the outpatient regimen this pathway describes has no national quality measure of
any kind.** Every national measure touching hypertensive disorders of pregnancy is anchored to
a birth admission or a hospital: the AIM timely-treatment metric is scoped to an inpatient
obstetrical unit; the severe-obstetric-complications eCQM counts eclampsia as a harm and
treats severe preeclampsia as case-mix; HEDIS measures a comprehensive postpartum visit at
7–84 days; and no eligible-clinician eCQM or MIPS measure addresses hypertensive disorders of
pregnancy at all. Searched: 2026 clinician eCQM set, 2026 MIPS obstetrics set, HEDIS MY2026,
Joint Commission Perinatal Care v2026B, AIM core data collection plan.

## 11. Schedules

- **Sched-1** (on Step 1.3): interval "12 0/7 to 28 0/7 weeks, optimally before 16 0/7; then daily until delivery"; aspirin initiation window and duration. [1]
- **Sched-2** (on Step 4.1): interval "at least once weekly, in clinic"; BP and symptom assessment plus weekly platelets, creatinine and liver enzymes; repeat sooner if progression is a concern. [1]
- **Sched-3** (on Step 4.3): interval "growth ultrasound every 3–4 weeks; amniotic fluid at least weekly; antenatal test 1–2 times weekly"; fetal surveillance. [1]
- **Sched-4** (on Step 5.2): interval "within 3 days of discharge if severe hypertension occurred, otherwise within 7 days"; postpartum BP and symptom check, with escalation instructions. ACOG's outer bound is 7–10 days, and 72 hours for severe hypertension. [8][12]

## 12. Prerequisites (REQUIRES)

- **Step 1.3 REQUIRES Step 1.1** — aspirin follows the risk assessment that justifies it. [1]
- **Step 2.2 REQUIRES Step 2.1** — confirmation requires a first measurement. [1]
- **Step 2.4 REQUIRES Step 2.2** — classification requires confirmed hypertension. [1]
- **Step 3.1 REQUIRES Step 2.4** — severity assessment requires an established diagnosis. [1]
- **Step 4.1 REQUIRES Step 3.1** — surveillance follows the severity determination. [1]
- **Step 5.2 REQUIRES Step 2.4** — postpartum follow-up is scheduled on the basis of a documented diagnosis. [8]

**Acyclicity note for the builder.** PB 222 uses the same findings in two roles: platelets,
creatinine and transaminases both **establish** preeclampsia when proteinuria is absent, and
**classify** severity once it is diagnosed. Wiring both roles as "severe feature" produces
`diagnosis → severity → diagnosis`. The chains above avoid this by keeping raw laboratory
results as inputs to both Step 2.4 and Step 3.1, with Step 3.1 consuming the diagnosis and
never feeding it.

## 13. Code entries

| Code | System | Description | Attached to |
|---|---|---|---|
| 8480-6 | LOINC | Systolic blood pressure | Lab-1 |
| 8462-4 | LOINC | Diastolic blood pressure | Lab-2 |
| 777-3 | LOINC | Platelets [#/volume] in Blood by Automated count | Lab-3 |
| 2160-0 | LOINC | Creatinine [Mass/volume] in Serum or Plasma | Lab-4 |
| 1920-8 | LOINC | Aspartate aminotransferase [Enzymatic activity/volume] in Serum or Plasma | Lab-5 |
| 1742-6 | LOINC | Alanine aminotransferase [Enzymatic activity/volume] in Serum or Plasma | Lab-6 |
| 2889-4 | LOINC | Protein [Mass/time] in 24 hour Urine | Lab-7 |
| 34366-5 | LOINC | Protein/Creatinine [Ratio] in Urine | Lab-8 |
| 20454-5 | LOINC | Protein [Presence] in Urine by Test strip | Lab-9 |
| 2532-0 | LOINC | Lactate dehydrogenase [Enzymatic activity/volume] in Serum or Plasma | Lab-10 |
| 3084-1 | LOINC | Urate [Mass/volume] in Serum or Plasma | Lab-11 |
| 76816 | CPT | Ultrasound, pregnant uterus, follow-up, per fetus | Img-1 |
| 76815 | CPT | Ultrasound, pregnant uterus, limited | Img-2 |
| 76820 | CPT | Doppler velocimetry, fetal; umbilical artery | Img-3 |
| 59025 | CPT | Fetal non-stress test | Proc-1 |
| 76818 | CPT | Fetal biophysical profile; with non-stress testing | Proc-2 |
| 243670 | RXNORM | aspirin 81 MG Oral Tablet | Med-1 |
| 896762 | RXNORM | labetalol hydrochloride 200 MG Oral Tablet | Med-2 |
| 198034 | RXNORM | 24 HR nifedipine 30 MG Extended Release Oral Tablet | Med-3 |
| 198032 | RXNORM | nifedipine 10 MG Oral Capsule | Med-4 |
| 197956 | RXNORM | methyldopa 250 MG Oral Tablet | Med-5 |
| O13.3 | ICD-10 | Gestational hypertension without significant proteinuria, third trimester | Step 2.4 |
| O14.03 | ICD-10 | Mild to moderate pre-eclampsia, third trimester | Step 2.4 |
| O14.13 | ICD-10 | Severe pre-eclampsia, third trimester | Step 3.1 |
| R03.0 | ICD-10 | Elevated blood-pressure reading, without diagnosis of hypertension | Step 2.2 |
| Z79.82 | ICD-10 | Long term (current) use of aspirin | Step 1.3 |

> ### ⚠ Two LOINC selections that fail silently if changed
>
> **Protein/creatinine ratio must be `34366-5`, never `2890-2`.** 34366-5 is dimensionless and
> the threshold is 0.30. 2890-2 is a *mass ratio*, conventionally reported in mg/g, where the
> identical clinical threshold is **300**. A gate written for 0.30 that receives a 2890-2
> result fires for **every patient** — a 1000-fold error with no error, no warning and nothing
> indeterminate. Every pregnant patient tested would be diagnosed with preeclampsia.
>
> **24-hour protein must be `2889-4`, never `21482-5`.** The criterion is ≥300 mg per 24 hours
> — a mass per unit time. 2889-4 is mass/time. 21482-5 is mass/volume: not a worse choice, an
> incomparable physical quantity that depends on total collection volume.
>
> The engine cannot protect against either. `unit` is not an allowed key on a coded condition,
> and no evaluation path compares units at any point. See §18 G7.

## 14. Attribute-map registrations

**None.** Every gate uses coded-form conditions matching `labResults` and `conditionCodes`
directly. No `lab.*`, `allergy.*` or `patient.*` attribute is referenced anywhere in §4b.

## 15. Evidence citations

- **[1]** Gestational Hypertension and Preeclampsia: ACOG Practice Bulletin No. 222 (Interim Update) — ACOG, Obstetrics & Gynecology 135(6):e237–e260, 2020, evidence level **Level B** (contains Level A–C graded recommendations; grade cited per claim), https://www.preeclampsia.org/frontend/assets/img/advocacy_resource/Gestational_Hypertension_and_Preeclampsia_ACOG_Practice_Bulletin,_Number_222_1605448006.pdf — complete 24-page mirror, verified faithful; still current per ACOG's September 2026 title list
- **[2]** Aspirin Use to Prevent Preeclampsia and Related Morbidity and Mortality: USPSTF Recommendation Statement — USPSTF, JAMA 326(12):1186–1191, 2021, **Grade B**, https://www.uspreventiveservicestaskforce.org/uspstf/recommendation/low-dose-aspirin-use-for-the-prevention-of-morbidity-and-mortality-from-preeclampsia-preventive-medication
- **[3]** Low-Dose Aspirin Use for the Prevention of Preeclampsia and Related Morbidity and Mortality — ACOG/SMFM Practice Advisory, 2021 (reaffirmed October 2022), **Expert Consensus**, https://www.acog.org/clinical/clinical-guidance/practice-advisory/articles/2021/12/low-dose-aspirin-use-for-the-prevention-of-preeclampsia-and-related-morbidity-and-mortality
- **[4]** SMFM Special Statement: Updated checklists for preeclampsia risk-factor screening to guide recommendations for prophylactic low-dose aspirin — SMFM, Pregnancy (Hoboken) 2(2):e70212, 2026, **Expert Consensus**, https://pmc.ncbi.nlm.nih.gov/articles/PMC13344198/
- **[5]** Chronic Hypertension in Pregnancy: ACOG Practice Bulletin No. 203 — ACOG, 2019, **Expert Consensus**, dosing table via AAFP, American Family Physician 100(12):782, https://www.aafp.org/pubs/afp/issues/2019/1215/p782.html — used only for maintenance antihypertensive dosing, which PB 222 does not provide
- **[6]** FDA prescribing information via DailyMed: labetalol, nifedipine extended release, methyldopa, lisinopril, aspirin 81 mg — FDA/NLM, current, **Expert Consensus**, https://dailymed.nlm.nih.gov/dailymed/
- **[7]** Hypertensive Disorders of Pregnancy: Screening — USPSTF, 2023, **Grade B**, https://www.uspreventiveservicestaskforce.org/uspstf/recommendation/hypertensive-disorders-pregnancy-screening
- **[8]** Severe Hypertension in Pregnancy Patient Safety Bundle (2022) and Core Data Collection Plan v2.0 (January 2024) — AIM/ACOG, **Expert Consensus**, https://saferbirth.org/wp-content/uploads/U1-FINAL_AIM_Bundle_SHP2022.pdf and http://saferbirth.org/wp-content/uploads/2024_psb_shp_cdcp.pdf
- **[9]** SMFM Special Statement: A quality metric for evaluating timely treatment of severe hypertension — SMFM, American Journal of Obstetrics & Gynecology 226(2):B2–B8, 2022, **Expert Consensus**, https://pnqinma.org/wp-content/uploads/2025/07/SMFM-Special-Statement_HTN-Timely-Treatment-2021.pdf
- **[10]** Urgent Maternal Warning Signs (expanded) — ACOG/AIM, 2024, **Expert Consensus**, https://saferbirth.org/wp-content/uploads/UrgentMaternalWarningSigns_expanded.pdf
- **[11]** Urgent Maternal Warning Signs and Symptoms, HEAR HER Campaign — CDC, current, **Expert Consensus**, https://www.cdc.gov/hearher/maternal-warning-signs/index.html
- **[12]** Optimizing Postpartum Care: ACOG Committee Opinion No. 736 — ACOG, Obstetrics & Gynecology 131(5):e140–e150, 2018 (reaffirmed 2025), **Expert Consensus**, https://www.acog.org/clinical/clinical-guidance/committee-opinion/articles/2018/05/optimizing-postpartum-care
- **[13]** Validated Devices for Blood Pressure Measurement in Pregnancy / Preeclampsia — STRIDE BP, list generated 07 September 2026, **Expert Consensus**, https://www.stridebp.org/pregnancy-pdf/
- **[14]** ACOG Clinical Practice Update: Biomarker Prediction of Preeclampsia With Severe Features — ACOG, Obstetrics & Gynecology 143(6):e153–e154, 2024, **Expert Consensus**, doi:10.1097/AOG.0000000000005576 — scope is hospitalised patients; **out of scope for this pathway**, recorded so it is not mistakenly added

## 16. Citation map

- Stage 1: [1][2][3] · Stage 2: [1][7] · Stage 3: [1] · Stage 4: [1] · Stage 5: [1][8][12]
- Step 1.1: [1][2][3][4] · Step 1.2: [8] · Step 1.3: [1][2][3]
- Step 2.1: [1][7] · Step 2.2: [1] · Step 2.3: [1][7] · Step 2.4: [1]
- Step 3.1: [1]
- Step 4.1: [1] · Step 4.2: [1] · Step 4.3: [1] · Step 4.4: [1][10][11]
- Step 5.1: [1] · Step 5.2: [8][12] · Step 5.3: [1]
- DP-1: [1] · Criteria 1a, 1b: [1]
- Med-1: [1][2][3] · Med-2: [1][5][6] · Med-3: [5][6] · Med-4: [1] · Med-5: [5][6] · Med-6: [5][6]
- Lab-1 to Lab-6: [1] · Lab-7 to Lab-11: [1]
- Img-1, Img-2, Img-3: [1] · Proc-1, Proc-2: [1]
- Guid-1: [1][10][11] · Guid-2: [1][13] · Guid-3: [1] · Guid-4: [1]

**Cannot cite — evidence attaches to the host Step:** all Gates → their attached Step per the
§4b rationale references; QM-1 → Step 5.2 [8]; QM-2 → Step 1.3 [1][2]; Sched-1 → Step 1.3 [1];
Sched-2 → Step 4.1 [1]; Sched-3 → Step 4.3 [1]; Sched-4 → Step 5.2 [8][12]; all CodeEntries → none.

## 17. Temporal horizon & status summary (EMITTED — review carefully)

| Gate | Condition on | horizon | status | window_days | Rationale |
|---|---|---|---|---|---|
| gate-bp-elevated | vitals systolic_bp, diastolic_bp | DAY | — | — | `[BUILD FIX]` Was labs 8480-6/8462-4 at {days: 7}. Vitals are one current value; DAY is the required bounded horizon. `[DECISION — Josh 2026-09-24]` vitals ratified |
| gate-severe-bp *(folded into escalation)* | labs 8480-6, 8462-4 | {days: 1} | — | — | Severe-range BP is an acute finding; only a current value justifies escalation |
| gate-escalation-required | vitals systolic_bp, diastolic_bp | DAY | — | — | `[BUILD FIX]` Was labs 8480-6/8462-4 at {days: 1}. `[DECISION — Josh 2026-09-24]` vitals ratified |
| gate-escalation-required | labs 777-3, 2160-0 | QUARTER | — | — | Surveillance labs are weekly; the latest value is the operative one. Original intent: "**No horizon set deliberately** — a stale platelet count should still escalate rather than silently vanish." `[BUILD FIX 2026-09-24 — NEEDS A PHYSICIAN CALL]` On main an omitted lab horizon is **not** lifetime: it is v1's QUARTER (90 days), so a platelet count older than 90 days was already ignored (and the gate then asks for a current one). QUARTER is now explicit — no behaviour change. `LIFETIME` would honour the original intent; choose. |
| gate-escalation-required | conditions O14.1.* | {days: 300} | active | — | This pregnancy only; a prior pregnancy's severe preeclampsia must not fire escalation now |
| gate-htn-diagnosed | conditions O13.*, O14.* | {days: 300} | active | — | This pregnancy only — the single most important scoping decision in the pathway |
| gate-gestational-htn | conditions O13.2, O13.3, O13.9 | {days: 300} | active | — | As above |

`[DECISION]` **300 days is a proxy for "this pregnancy".** The horizon grammar has no
pregnancy concept, and there is no anchor to the estimated delivery date or last menstrual
period. 300 days covers a full pregnancy with margin. A patient with a hypertensive disorder
in a pregnancy that ended within the past 300 days could have those codes fire in a subsequent
pregnancy. Please ratify, and see §18 G9.

## 18. Gaps & fallbacks

### Not encodable in the current schema — clinical content that cannot become a data gate

| # | What the guideline requires | Why it cannot be expressed | Fallback used |
|---|---|---|---|
| **G1** | Two BPs ≥140/90 **at least 4 hours apart** | `vitalSigns` is a flat undated bag holding one value per path — there is no BP series at all | `gate-htn-confirmed` as a question gate |
| **G2** | Count of readings **above a threshold** | `count_in_window` matches on code, system and date window then increments — it never compares the value. It counts how many BPs were taken, not how many were abnormal | As above |
| **G3** | Minimum **separation between events** (4 hours), and **persistence ≥15 minutes** | No operator constrains spacing or duration between qualifying events | As above |
| **G4** | Transaminases **>2× the upper limit of normal** | The threshold is lab-local. Results carry code, value, unit and date but **no reference range**, and `threshold` is a literal number | `gate-severe-feature-symptoms` question gate |
| **G5** | **Doubling** of serum creatinine | `delta_from_baseline` compares an absolute difference, not a fold-change | Absolute >1.1 mg/dL limb as a data gate; doubling folded into the question gate |
| **G6** | Aspirin rule: **≥2 of 8** moderate-risk factors | Compound gates have one AND/OR over a flat list; there is no N-of-M or counting operator. Compounded by half the tier not being codeable, and prior preeclampsia having no specific code | `gate-aspirin-indicated` question gate, backed by the published SMFM checklist |
| **G7** | Unit-correct threshold comparison | **`unit` is not an allowed key on a coded condition, and no evaluation path compares units.** See the §13 warning — the protein/creatinine ratio has two codes in circulation whose thresholds differ 1000-fold | Pin the exact LOINC in §13 and warn prominently. No engine protection exists |
| **G8** | Advisory drug interaction (low-dose aspirin with oral iron) | There is **no interaction edge in the pathway schema**. The lane mechanism only detects same-lane different-drug; the interaction engine is database-backed and not authorable from a pathway | Documented in §5 only |
| **G9** | Scoping facts to **this pregnancy** | No pregnancy anchor exists in the horizon grammar | `{days: 300}` proxy |
| **G12** | A question gate's `default_behavior` | `[CORRECTED 2026-09-24]` An **unanswered** question gate always resolves to PENDING_QUESTION and marks its subtree PENDING_QUESTION — but a question answered **"no"** takes `default_behavior`, so `traverse` included the target on "no". `gate-aspirin-indicated` is now `skip`. (Original text: "`default_behavior` is never consulted, and unanswered is the only case where it could matter.") Confirmed at build against the real engine | Documented; the declared default expresses intent only |
| **G11** | **Co-equal therapeutic alternatives** ("labetalol OR nifedipine, either is correct") | Conflict detection groups by `clinical_role` with no pathway check; two distinct names in one lane conflict even within a single pathway, and **both are then withheld** from the active medication list. Equivalence and contradiction are the same signal | Same lane, conflict accepted — see the §5 decision box |
| **G10** | Gestational-age gates (20 weeks; 12–28 weeks; 34 0/7; 37 0/7) | `patient.*` attributes are never populated by the simulator; Z3A codes would need one condition per week | Carried in step descriptions and question prompts |

### Source conflicts requiring an authoring decision

| # | Conflict | Recommendation |
|---|---|---|
| **C1** | Severe-range BP confirmation is stated three ways: "within minutes" (Box 2), "two occasions ≥4 hours apart" (Box 3), "persistent ≥15 minutes" (Level B) | Use the **15-minute** rule for treat/escalate — it is the highest-graded and most operationally specific — and 4 hours for diagnosing non-severe hypertension. Box 3's own parenthetical waives its 4-hour rule once therapy starts |
| **C2** | Preeclampsia-without-proteinuria criteria: Box 2 lists 5, the Level C recommendation lists 6 (adding RUQ/epigastric pain) | Use the **Level C list of 6** — it is the graded statement |
| **C3** | Headache qualifier: "unresponsive to medication" (Boxes) vs "unresponsive to acetaminophen" (narrative and Level C) | Use **acetaminophen** — more specific and it is the graded wording |
| **C4** | Liver enzymes: "to twice normal" (Box 2) vs "more than twice the upper limit of normal" (Box 3) | Use **>2× ULN** — better specified |
| **C5** | Antenatal testing: "weekly" (narrative) vs "one-to-two times per week" (Clinical Considerations and Level C) | Use **1–2× weekly**; weekly is the floor |
| **C6** | Postpartum follow-up: ACOG 7–10 days (72 hours if severe) vs AIM 3 days (severe) / 7 days (other) | Use the **AIM 2024 split** — most recent and most operationally precise; ACOG's 7–10 days is the outer bound |
| **C7** | Aspirin moderate tier: "2 or more" vs "more than one" across four documents | Same number. Encode as **≥2**, never as a `>1` on something a reader might mistake for a boolean |
| **C8** | Treatment threshold: 140/90 (post-CHAP) vs 160/110 (PB 222) | **160/110.** CHAP enrolled before 23 weeks and required hypertension documented before 20 weeks, so its population is chronic hypertension by construction. Applying 140/90 here would be a clinical error. Whether mild-range disease should be treated is genuinely unresolved — a trial is recruiting to answer it |

### Data-quality gaps in the source itself

- **PB 222 contains no discussion of racial disparities**, and lists "African American race" in Table 1 with no framing. The marker-not-cause framing comes from USPSTF 2021 and ACOG's own December 2021 advisory — cited here as [2] and [3] rather than [1].
- **Gestational diabetes is in PB 222's Box 1 but not its Table 1.** Box 1 is a risk-factor list; Table 1 is the aspirin rule. Building the aspirin gate from Box 1 produces wrong prophylaxis logic.
- **PB 222 Table 1 is derived from the 2014 USPSTF statement** and is superseded on the aspirin lists by [3].
- **No ICD-10 code for personal history of preeclampsia.** The coding index routes it to O09.29- (in pregnancy) or Z87.59 (outside), both of which also capture prior stillbirth, neonatal death and trophoblastic disease. Usable to prompt a question, not to fire a gate.
- **Unit errors in the source**: Box 2 gives the protein/creatinine ratio a unit it cannot have ("0.3 mg/dL"; the body text correctly gives 0.30 dimensionless), and the narrative states the 24-hour threshold as "300 mg/dL" where Box 2 correctly gives "300 mg per 24 hour". Platelets are rendered "less than 100,000 × 10⁹/L", which is arithmetically impossible; the operative value is <100,000/µL.
- **`[GAP]`** No definition of "abnormal fetal testing" exists anywhere in PB 222 — it is a Box 4 escalation trigger with no criteria.
- **`[GAP]`** No guidance on which antenatal test to use or when to start; PB 222 states the data do not exist.
- **`[GAP]`** No routine umbilical artery Doppler indication or interval.
- **`[GAP]`** No home BP measurement frequency, reporting threshold, or device guidance.
- **`[GAP]`** No long-term cardiovascular follow-up interval, screening test or target.
- **`[GAP]`** No national quality measure for any part of the outpatient regimen.

### Method note

`acog.org` returns HTTP 402 to the standard fetch tool but **HTTP 200 to a plain request with a
browser user agent**. Three citations initially recovered from mirrors — [3], [7] and [12] —
were re-verified against ACOG primary sources this way. Future research rounds should fetch
ACOG directly rather than depending on mirrors.

### `[BUILD FIX 2026-09-24]` On unresolved — RESOLVED

`[DECISION — Josh 2026-09-24]` **Resolved as a general rule: numeric gates ask when the
value is missing.** Both gates listed below keep `on_unresolved: ask`; no JSON change.
This is no longer a per-gate question for review — the rule is in the format spec, the
brief template and the builder's gate-control lint, and a numeric gate may take `default`
only with an `[ON-UNRESOLVED DEFAULT — <gate-id>]` justification in this brief (there is
none). The original note follows for the record.

Main (PR #55) added a per-gate `on_unresolved` (ask | default) that this brief predates.
It decides what a gate does when its lab/vital value is **missing or ambiguous**: `ask`
holds the gated subtree and asks the provider for the value; `default` treats it like
"no" and applies the default behavior. Absent means `ask`, so the JSON now states `ask`
explicitly on every gate with a threshold — **no behaviour change** — pending review:
gate-bp-elevated (BP), gate-escalation-required (severe-range BP, platelets, creatinine). Gates with only code/history conditions carry `default`, which is what the
engine does for them anyway. Lab conditions also carry a `display` (name + unit) so the
missing-value question is readable.
