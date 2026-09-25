# Pathway Research Brief — Anemia in Pregnancy

JSON: pathways/json/anemia-in-pregnancy.json @ version 8

**Status: DRAFT v2 for physician review — not yet approved for JSON build.**
Scope assumed from request: outpatient prenatal care, adult pregnant patients, US practice,
single-condition pathway, new v1. **Design decision (reviewer-directed): this pathway
begins at a coded anemia diagnosis (O99.01x) — screening is upstream and is not part of
the pathway.** The ACOG screening schedule (first-trimester CBC + repeat at 24 0/7–28 6/7
weeks, Level C [1]) is context for where the triggering diagnosis comes from, nothing more.
Research method: 4 parallel domain agents over fetched guideline full text + 2 verification
agents (codes, citations); every claim carries a reference number resolving in §15. Flags:
`[GAP]` unsourceable, `[FALLBACK SOURCE]` non-US-guideline basis, `[OLDER SOURCE]` >5y but
still current, `[BLOCKED — prior_node_result]` import-blocked gate design with fallback.

> ### ⚠ For Josh (v8) — hemoglobinopathy disease reaches iron again, and DP-1 is asked again
>
> A ferritin-confirmed hemoglobinopathy-*disease* patient now gets the same Stage 2 iron path
> (DP-3, oral trial and response check, or IV iron) as any confirmed IDA; only the empiric
> arm is closed to her. The cost of doing it without an engine change: **DP-1 ("empiric
> iron vs confirmatory studies first") is asked again for these patients** (v7 hid it), and
> its empiric option opens iron studies only. Why, what the provider sees, and the engine
> change that would hide the option again: §18, "Hemoglobinopathy disease suppresses the
> empiric-iron arm".

---

## 1. Pathway metadata

- **Logical ID**: `anemia-in-pregnancy`
- **Title**: Anemia in Pregnancy — Classification and Treatment
- **Version**: 8 `[DECISION — Josh 2026-09-24]` (JSON `"8"`; was `"7"`). Imports as
  NEW_VERSION; v7 sessions keep v7's graph. Bumped for:
  - **The empiric arm reaches DP-3** (§2 Stage 1.5, §4 DP-3): Stage 1.5 now holds Step 2.8
    (DP-3's host) instead of Steps 2.1–2.3, so a patient on empiric iron can also go to IV
    iron without an oral trial; the oral trial (Stage 2.5, Steps 2.1–2.3) is reached through
    DP-3 on both arms.
  - **IV iron chosen first before 14 weeks starts the oral trial until then** (§2 Stage 2.6,
    §3 Step 2.9, §4b `gate-oral-bridge-ga`): v7 started no iron at all on that choice.
  - **Hemoglobinopathy disease with confirmed iron deficiency gets the normal iron path**
    (§4 DP-1, §4b `gate-microcytic` / `gate-empiric-no-hgbpathy` / `gate-hgbpathy-microcytic`,
    §18): the disease split moves from in front of DP-1 to behind its empiric branch, so the
    confirmatory-studies branch leads a disease patient into Stage 2; gate-microcytic is
    MCV < 80 alone again.
  - **DP-3's malabsorption criterion (3c) is also read from the chart** (§3 Step 2.11, §4
    DP-3, §4b `gate-malabsorption-chart`, §9 Guid-6): a malabsorption code shows a
    recommendation for IV iron first next to the DP-3 question; the provider still chooses.
  (v7 `[DECISION — Josh 2026-09-24]`, was `"6"`; v6 sessions keep v6's graph. Bumped for:)
  - **The oral-iron response check reads chart data** (§4b `gate-hgb-response` /
    `gate-hgb-nonresponse`): an Hgb rise anchored to the oral-iron start (`window_from`, due
    at day 14) OR the trimester target, in nested condition groups. Replaces v5/v6's interim
    3-option question router; Step 2.7 ("Awaiting response recheck") is removed.
  - **Hemoglobinopathy disease keeps a microcytic patient off empiric iron** (§4 DP-1, §4b
    `gate-microcytic` / `gate-hgbpathy-microcytic`, §18): DP-1 is not offered with SCD, a
    thalassemia syndrome or HbC/HbE disease on file (traits still are); new Step 1.8 gives
    those patients their own confirmatory iron studies (Lab-15, Lab-16).
  - **DP-3 — IV iron without an oral trial** (§3 Steps 2.8–2.10, §4 DP-3): ferritin-confirmed
    IDA now chooses the route first — the oral trial (Stage 2.5, Steps 2.1–2.3) or IV iron
    at GA ≥ 14 for oral-iron intolerance, malabsorption or IDA diagnosed at ≥ 34 weeks. The
    brief's former DP-3 (predelivery route selection on Step 4.2, never built) is retired
    into it.
  (v6 `[DECISION — Josh 2026-09-24]`, was `"5"`: bumped because
  Guid-5 ("When to call us right away") now references the CDC Hear Her / AIM urgent maternal
  warning signs instead of reproducing an AIM-derived subset of them (§9). Imports as
  NEW_VERSION; no graph or gate change.)
  (v5 `[DECISION — Josh 2026-09-24]`, was `"4"`: bumped for
  escalation after non-response (gate-hgb-response is a SELECT question router; new Step
  2.6 hosts DP-2, new Step 2.7 holds a not-yet-rechecked patient), the 2–4-week recheck, and dropping the live `med-1 → med-5` ESCALATES_TO
  route — imports as NEW_VERSION. `gate-hgb-response` changes type (chart → question), so
  v4 sessions keep v4's graph. Hemoglobinopathy suppression of the empiric arm is
  decided but blocked on the engine (§18).)
  (v4 was bumped from 3 for
  gate-microcytic in front of DP-1 (Step 1.7), the empiric arm's follow-up through Stage
  1.5, and one host step per lab node — imports as NEW_VERSION. DP-1's empiric answer
  value changes from `step-2-1` to `stage-2-empiric`; v3 sessions keep v3's graph.)
  (v3 was bumped from 2 for the DP-1 restoration, the since-reversed gate-microcytic
  removal and the gestational-age data gate.)
- **Category**: OBSTETRIC
- **Scope**: Outpatient prenatal care, from diagnosed anemia through postpartum handoff.
  Screening is upstream of this pathway.
- **Target population**: Adult pregnant patients with diagnosed anemia; hemoglobinopathy
  *disease*, thalassemia *syndromes*, and CKD-associated anemia are detected and routed
  out (§4b, Stage 3)
- **Condition codes** (trigger codes; OR semantics):

| Code | System | Description | Usage note | Grouping |
|---|---|---|---|---|
| O99.011 | ICD-10 | Anemia complicating pregnancy, first trimester | primary trigger | anemia-pregnancy |
| O99.012 | ICD-10 | Anemia complicating pregnancy, second trimester | primary trigger | anemia-pregnancy |
| O99.013 | ICD-10 | Anemia complicating pregnancy, third trimester | primary trigger | anemia-pregnancy |
| O99.019 | ICD-10 | Anemia complicating pregnancy, unspecified trimester | primary trigger | anemia-pregnancy |
| D50.9 | ICD-10 | Iron deficiency anemia, unspecified | secondary trigger — often coded alongside O99.01x [1] | anemia-etiology |

## 1b. Code sets

None. (Single-condition pathway; O99.01x already encodes the pregnancy+anemia conjunction.)

## 2. Stages

- **Stage 1 — Diagnosis Confirmation & Classification** *(entry stage, root-connected)*:
  confirm the diagnosis against trimester criteria, MCV-based classification, ferritin
  confirmation, hemoglobinopathy testing, expanded workup for nonresponders. [1][4]
- **Stage 1.5 — Empiric Oral Iron Trial (if chosen at DP-1; not with hemoglobinopathy
  disease)** *(branch-entry only, via DP-1 criterion 1a)* `[DECISION — Josh 2026-09-24]`: v8 —
  opens Step 2.8, the iron-route choice (DP-3), through `gate-empiric-no-hgbpathy` (no
  hemoglobinopathy disease on file); with disease on file it opens Step 1.8's iron studies
  instead (`gate-hgbpathy-microcytic`) — §4 DP-1. With Step 2.8, the empiric arm chooses the empiric arm chooses the oral trial or IV iron without an oral trial
  the oral trial or IV iron without an oral trial exactly as ferritin-confirmed IDA does,
  and its oral trial brings the same response assessment and IV-iron escalation route (§4,
  DP-1 and DP-3). (v4–v7: held Steps 2.1–2.3 directly.) Numbered 1.5 so it sorts after Stage 1 with a number of its own; its step
  keeps its 2.x number. [1][5]
- **Stage 2 — Iron Deficiency Treatment** *(branch-entry only, via gate-ida-confirmed)*:
  v7 — holds Step 2.8, the route choice (DP-3): the oral trial (Stage 2.5) or IV iron
  without an oral trial (Steps 2.9–2.10). Oral iron first line with counseling, response
  assessment, IV iron escalation. [1][5][7]
- **Stage 2.5 — Oral Iron Trial (if chosen at DP-3)** *(branch-entry only, via DP-3
  criterion 3a; v7)* `[BUILD NOTE]` (how DP-3's oral branch is built): holds Steps 2.1–2.3 —
  oral iron, the trial period and the response check — on both arms since v8 (DP-3 is
  reached from Stage 2 and from Stage 1.5; through v7 Stage 1.5 held these steps itself).
  Carries Stage 2's citations, so DP-3's two targets score alike and the fork
  pends for the provider (`gate-proof.ts dp-1-scoring`). [1][5]
- **Stage 2.6 — Oral Iron Until 14 Weeks (IV iron chosen before 14 weeks)** *(branch-entry
  only, via gate-oral-bridge-ga on Step 2.9; v8)* `[DECISION — Josh 2026-09-24]` (oral until
  14 weeks, then IV) with a `[BUILD NOTE]` structure: holds the same Steps 2.1–2.3 as Stage
  2.5 — oral iron, the trial period, the response check — for a patient whose provider chose
  IV iron without an oral trial at DP-3 before 14 0/7 weeks, when IV iron is not given.
  Numbered 2.6: unique, just after Stage 2.5; its steps keep their numbers. Carries Stage
  2's citations. [1][5]
- **Stage 3 — Special Populations & Escalations** *(root-connected container; every step
  individually gated)*: hemoglobinopathy/thalassemia/CKD routing-out, trait carriers,
  bariatric, IBD, multifetal, transfusion-decliners, severe anemia, referral. [4][7][8][17]
- **Stage 4 — Late-Pregnancy Optimization & Handoff**: predelivery optimization, delivery
  planning, type & screen verification, postpartum handoff. [1][9][11]

## 3. Steps

- **Step 1.1 — Diagnosis confirmation & evaluation** *(entry step)*: history & physical;
  review the triggering CBC against trimester criteria (Hgb <11.0 g/dL / Hct <33% in T1
  and T3; <10.5 / <32% in T2 — CDC trimester definitions T1 0–13 wk, T2 14–26, T3 27–40);
  risk-factor review (parity >2, short interpregnancy interval, low-iron diet, pica);
  urgent-symptom safety-netting. [1][2][3][10]
- **Step 1.2 — Microcytic workup** *(reached only via DP-1 criterion 1b — the provider's
  choice of confirmatory studies; DP-1 itself sits behind gate-microcytic since v4, so
  only MCV < 80 fL reaches this choice — v7 also required no hemoglobinopathy disease on
  file; v8 drops that, so a disease patient reaches Step 1.2 and, with ferritin < 30, Stage 2;
  see Step 1.7, Step 1.8 and §4b)*: indicated for microcytic
  anemia (MCV < 80 fL). Ferritin (±iron/TIBC/
  saturation). Ferritin <30 ng/mL confirms IDA; sat <18% + ↑TIBC + ↓ferritin = IDA;
  all-normal iron studies → suspect thalassemia → Step 1.5. [1][5]
- **Step 1.3 — Normocytic workup** *(gated by gate-normocytic)*: ferritin (early iron
  deficiency), reticulocytes, smear as directed. [1]
- **Step 1.4 — Macrocytic workup & repletion** *(gated by gate-macrocytic)*: serum folate
  + B12 (MCV >115 fL almost exclusively folate/B12); treat per §5. [1]
- **Step 1.5 — Expanded / nonresponse workup** *(DP-2's branch; DP-2 sits behind the
  "no response" answer at Step 2.3 since v5 — see Step 2.6)*: smear, hemoglobin
  analysis + genetic testing per indices/history, malabsorption and blood-loss review. [1][4]
- **Step 1.6 — Hemoglobinopathy testing** *(gated by gate-hgbpathy-needed)*: hemoglobin
  electrophoresis or molecular testing when no prior results are available; carrier →
  partner testing → both carriers → genetic counseling. [4]
- **Step 1.7 — Microcytic anemia: iron strategy** *(gated by gate-microcytic — its only
  way in)* `[DECISION — Josh 2026-09-24]`: hosts DP-1 (empiric oral iron vs confirmatory
  iron studies first). Exists because a gate can only guard a Step or Stage, and DP-1
  must hang from a Step. Numbered 1.7 to keep existing step ids stable, although it
  follows Step 1.1 logically. v7: gate-microcytic also required no hemoglobinopathy disease
  code, so disease patients never saw DP-1; **v8** `[DECISION — Josh 2026-09-24]`:
  gate-microcytic is MCV < 80 alone again, DP-1 is offered to disease patients too, and the
  disease check sits on the empiric branch (§4 DP-1). [1]
- **Step 1.8 — Hemoglobinopathy disease, empiric iron chosen: iron studies instead**
  *(gated by gate-hgbpathy-microcytic on Stage 1.5 — its only way in; v7, rewired v8)*
  `[BUILD NOTE]`: reached only when the provider chooses empiric iron at DP-1 for a patient
  with sickle cell disease, a thalassemia syndrome or HbC/HbE disease on file. **No empiric
  iron** `[DECISION — Josh 2026-09-24]` — gate-empiric-no-hgbpathy closes the empiric arm
  for her. Confirm iron deficiency before any iron: ferritin (Lab-15; < 30 ng/mL confirms it)
  and iron/TIBC/saturation (Lab-16), the same tests as Step 1.2 (one node per host). Iron
  for confirmed deficiency follows DP-1's confirmatory branch (Step 1.2 → Stage 2), directed
  with hematology/MFM (Steps 3.1/3.2). v7: this step was every disease patient's workup,
  reached through gate-hgbpathy-microcytic on Step 1.1, and could not lead to iron (§18).
  [1][4][7]
- **Step 2.1 — Initiate oral iron + counseling**: therapeutic oral iron in addition to
  the prenatal vitamin (ACOG Level B; the PNV's 27 mg prophylactic iron is not treatment
  dosing); avoid enteric-coated/sustained-release; dietary and adherence Guidance
  attached here. [1][5][12][13][14]
- **Step 2.2 — Oral iron trial period**: expected reticulocytosis 7–10 days; optional
  retic check. [1]
- **Step 2.3 — Response assessment**: Hgb recheck **2–4 weeks** after initiation
  `[DECISION — Josh 2026-09-24]` (was "~4 weeks": FIGO [6] reads the response at 2 weeks,
  CDC [3] at 4; ACOG gives no numeric interval [GAP]). v7: read from the chart by two
  gates (§4b) — **responding** = Hgb risen ≥ 1 g/dL since oral iron started, **or** Hgb
  at target (≥ 11 g/dL; ≥ 10.5 in the second trimester) → Step 2.4; **not responding** =
  the exact complement → Step 2.6. Not judged before day 14 of oral iron (NOT YET DUE:
  neither branch opens, nothing is asked). [1][3][6]
- **Step 2.4 — Maintenance & surveillance** *(gate-hgb-response — its only way in)*:
  continue iron, reduce to prophylactic dosing when normalized for gestational stage
  (CDC). [3]
- **Step 2.5 — IV iron therapy** *(gated: Step 2.6 → DP-2 + gate-iv-iron-ga)*: for
  intolerance/nonresponse/severe iron deficiency later in pregnancy; after the first
  trimester; single-total-dose formulations preferred. v7: this is IV iron **after** a
  failed oral trial; IV iron **instead of** one is Step 2.10. [1][5][7]
- **Step 2.6 — Nonresponse management** *(gate-hgb-nonresponse — its only way in; was
  gate-hgb-response's "not responding" arm in v5/v6)*
  `[DECISION — Josh 2026-09-24]`: reached only when the Step 2.3 recheck shows no
  response to oral iron (Hgb rise < 1 g/dL at ≥ 14 days, and below the trimester target).
  Hosts DP-2, so the expanded
  workup (Step 1.5) and IV iron at GA ≥ 14 (Step 2.5) follow non-response instead of
  starting with oral iron. Exists for the same reason as Step 1.7: a gate can only guard
  a Step or Stage, and a DecisionPoint must hang from a Step. [1][3][6]
- ~~**Step 2.7 — Awaiting response recheck**~~ **Removed in v7** `[DECISION — Josh
  2026-09-24]`. It was v5/v6's "recheck not yet done" arm, there so the start visit could
  finish while the response check was a question. The chart-data gates close NOT YET DUE at
  the start visit and before day 14 without asking anything, which does the same job (§4b).
- **Step 2.8 — Iron treatment route: oral trial or IV iron first** *(in Stage 2 and, since
  v8, Stage 1.5 — so both iron arms; v7)* `[BUILD NOTE]`: hosts DP-3 (DP-3 itself is
  `[DECISION — Josh 2026-09-24]`; v7 placed it in Stage 2 only, and v8 adds Stage 1.5 as a
  second parent per Josh's decision that the empiric arm gets DP-3 too — §4 DP-3). [1][5][6]
- **Step 2.9 — IV iron without an oral trial** *(DP-3 criteria 3b/3c/3d; v7)*
  `[BUILD NOTE]`: hosts gate-iv-iron-ga-direct → Step 2.10, keeping IV iron's GA ≥ 14 rule
  (`[DECISION — Josh 2026-09-24]`: IV iron at GA ≥ 14 on this route too). Exists for the same reason as Steps 1.7/2.6 (a gate guards a Step,
  and a DP branch into a gate's target would override the gate). **v8** `[DECISION — Josh
  2026-09-24]`: before 14 weeks the oral trial starts instead — Step 2.9 also hosts
  gate-oral-bridge-ga (GA < 14) → Stage 2.6 (Steps 2.1–2.3) — and IV iron is offered again
  from 14 weeks (DP-3 is asked at every visit that reaches it; the IV gate opens once GA ≥
  14). v7 opened nothing here before 14 weeks. [1][5][6][8]
- **Step 2.10 — IV iron therapy (no oral trial)** *(gated by gate-iv-iron-ga-direct — its
  only way in; v7)*: Med-13–16 and Sched-6, copies of Step 2.5's Med-4–7 and Sched-3 (one
  node per host step; Step 2.5 stays the post-non-response IV iron). Deliberately **no**
  `REQUIRES Step 2.2`: that is the oral trial this branch skips. [1][5][7][22]
- **Step 2.11 — Malabsorption on the chart: IV iron without an oral trial favoured (DP-3
  criterion 3c)** *(gated by gate-malabsorption-chart on Step 2.8 — its only way in; v8)*
  `[DECISION — Josh 2026-09-24]` (3c readable from the chart) as a `[BUILD NOTE]`
  recommendation step: hosts Guid-6. Opens next to the DP-3 question whenever the chart
  carries a malabsorption code (§4b), on either iron arm; it does not choose the route. [1][8][18][19]
- **Step 3.1 — Sickle cell disease: route out** *(gated)*: MFM + hematology
  multidisciplinary track; PNV **without** iron unless deficiency confirmed + folic acid
  4 mg (SMFM GRADE 1B). This pathway's iron arm is affirmatively wrong for SCD. [7]
- **Step 3.2 — Thalassemia syndrome: route out** *(gated)*: hematology/MFM track. [16] [FALLBACK SOURCE]
- **Step 3.3 — Trait carriers (SCT / thal minor)** *(gated)*: stay in-pathway; iron only
  with ferritin-confirmed deficiency; partner testing; genetics referral if both carriers. [1][4][7]
- **Step 3.4 — Bariatric surgery history** *(gated)*: micronutrient panel at entry,
  per-trimester iron studies, low threshold for direct-to-IV iron (AGA BPA 7; bypass
  procedures disrupt duodenal absorption). [8][18][19]
- **Step 3.5 — IBD** *(gated)*: IV-iron-first when active inflammation (AGA BPA 9); GI
  co-management; quiescent disease may use oral arm. [8]
- **Step 3.6 — Transfusion consideration** *(gated by gate-severe-anemia)*: Hgb <6 g/dL →
  consider transfusion for fetal indications (ACOG Level B); requires type & screen. [1][11]
- **Step 3.7 — Specialist referral** *(gated by gate-referral-threshold)*: Hgb <9.0 or
  Hct <27% → physician familiar with anemia in pregnancy (CDC/IOM; not in ACOG [GAP]). [3]
- **Step 3.8 — Multifetal gestation surveillance** *(gated)*: IDA risk 2.4–4× singleton;
  supplement beyond PNV, earlier ferritin, earlier recheck. [1][20] [GAP: ACOG PB 231 text unverified]
- **Step 3.9 — CKD co-management: route out** *(gated)*: anemia-of-CKD track (ESA logic,
  ferritin target ~100, nephrology). [21] [FALLBACK SOURCE]
- **Step 3.10 — Transfusion-decliner optimization** *(gated)*: document acceptable
  products early; aggressive IV-iron-first repletion; ESA + parenteral iron per PB 233
  evidence; minimize phlebotomy; anesthesia/MFM delivery planning. [1][17]
- **Step 4.1 — Predelivery optimization**: aggressive treatment of severe anemia; verify
  prenatal type & antibody screen documented; Hct <30 + other risk factor ⇒ high
  hemorrhage-risk tier (type & crossmatch 2 u). [9][11]
- **Step 4.2 — Delivery planning route selection**: predelivery route review. [1][6] (Until v7
  this step "hosted DP-3", a predelivery route selection that was never built; its
  late-pregnancy criterion now lives in DP-3 at treatment start — §4.)
- **Step 4.3 — Postpartum handoff**: postpartum Hgb recheck (6-week evidence timepoint);
  continue iron "at least 3 months or 6 weeks postpartum, whichever is longer" (FIGO
  wording, checker-verified); IV iron option postpartum; risk communication on
  transition. [1][6][9]

Branch-entry-only stages: Stage 2 (entered via gate-ida-confirmed), Stage 1.5 (entered
via DP-1 criterion 1a) and Stage 2.5 (entered via DP-3 criterion 3a); since v8 Stages 2 and
1.5 hold the same Step 2.8 (DP-3), and DP-1 being one_of means at most one of them is ever
open; Stage 2.5 holds Steps 2.1–2.3. Stage 1 is
the root entry stage; Stage 3 is a root-connected container whose steps all hang from
gates; Stage 4 is root-connected. Gated steps connect **only** via their gate/DP
BRANCHES_TO (no HAS_STEP edge), per the reference-fixture pattern.

## 4. Decision points

- **DP-1 — Empiric iron vs confirmatory studies first** (on Step 1.7, behind
  gate-microcytic; was on Step 1.1 through v3) — branch_mode: one_of
  - `[DECISION — Josh 2026-09-24]` **Offered only for microcytic anemia (MCV < 80 fL).**
    In v3, DP-1 hung from Step 1.1 and pended for every patient, normocytic and
    macrocytic included. It now hangs from Step 1.7, whose only way in is
    gate-microcytic (§4b). MCV ≥ 80 closes Step 1.7 and DP-1 with it — no iron-strategy
    question, no iron arm — and the patient gets Step 1.3 or 1.4 from their own MCV gate.
    A missing MCV asks for it once (the question is shared with gate-normocytic and
    gate-macrocytic) and holds DP-1 until answered. Proved with `gate-proof.ts mcv`, both
    edge orders: MCV 72 and 79.9 → DP-1 asks; 80 and 90 → no DP-1, Step 1.3 INCLUDED;
    105 → no DP-1, Step 1.4 INCLUDED; missing → one LOINC 787-2 question, DP-1 held.
  - `[DECISION — Josh 2026-09-24]` **Hemoglobinopathy *disease* does not reach the
    empiric arm** (v7) — **and, once iron deficiency is confirmed, gets the normal iron
    path** (v8, `[DECISION — Josh 2026-09-24]`: "iron deficient by tests → normal iron
    supplementation; only the empiric arm is skipped"). v8 structure `[BUILD NOTE]`:
    - **gate-microcytic** is MCV < 80 alone (v4–v6's gate) → Step 1.7 → DP-1, for every
      microcytic patient.
    - DP-1's empiric branch, **Stage 1.5**, hosts two complementary membership gates on the
      12 disease codes (§4b): **gate-empiric-no-hgbpathy** (`not_includes_code` ×12) → Step
      2.8 (DP-3 — the empiric iron arm) and **gate-hgbpathy-microcytic** (`includes_code`
      ×12) → Step 1.8 (iron studies).
    - DP-1's confirmatory branch is unchanged: Step 1.2 → gate-ida-confirmed → Stage 2 →
      Step 2.8 → DP-3, for everyone.
    **Why this shape.** v7 split disease / no disease with two chart gates in front of
    DP-1. A closing gate sweeps its whole containment closure GATED_OUT at once, sparing
    nothing, and it is disposed before any deeper route writes; so whichever of the two
    gates closed swept Stage 2 if its side led there — a second route into Step 1.2 or
    Stage 2 lost Stage 2 in both edge orders (v7's finding, re-proved for v8 with the ferritin
    gate hosted on both Step 1.2 and Step 1.8: D57.1 + MCV 72 + ferritin 12 → Stage 2
    GATED_OUT, both orders). A DecisionPoint's sweep of its unchosen branch *does* spare
    everything the chosen branch contains (`containmentClosure`), so the disease split now
    sits *behind* DP-1, on the empiric branch only, and the confirmatory branch into Stage 2
    is shared by every patient. Step 2.8 is held by Stage 2 and, through
    gate-empiric-no-hgbpathy, by Stage 1.5 — the same sharing as v8's DP-3 on both arms.
    **What the provider sees** for a disease patient with MCV < 80 (proved with
    `gate-proof.ts hgbpathy`, both edge orders, for D57.1, D57.00, D57.40, D56.1 and D58.2):
    DP-1 asks, with both options — the empiric option titled "Empiric Oral Iron Trial (if
    chosen at DP-1; not with hemoglobinopathy disease)". **Confirmatory studies** + ferritin
    12 → Stage 2, DP-3, and on the oral trial Steps 2.1–2.3 with the response check INCLUDED
    (IV iron first also proved, D58.2 at GA 20); the empiric arm and Step 1.8 EXCLUDED; her
    route-out step (3.1 / 3.2) opens alongside. Ferritin 50 → Stage 2 GATED_OUT, no iron.
    **Empiric** chosen anyway → gate-empiric-no-hgbpathy closes Step 2.8 (no DP-3, no oral
    or IV iron), and Step 1.8's iron studies open instead. Traits (D57.3, D56.3) and uncoded
    patients: empiric → Step 2.8 / DP-3 exactly as before (Step 1.8 GATED_OUT; gate-trait /
    Step 3.3 still fire). MCV 90 → no DP-1; MCV missing → one MCV question, as for anyone.
    Checked also against a full traversal with the answers preloaded: every non-reference
    node agrees with the live (incremental) path, both orders.
    `[CLINICAL AMBIGUITY — for Josh]` **DP-1 is asked again for disease patients**, and its
    empiric option does nothing for them but order iron studies — the price of doing this
    in the JSON. v7 hid DP-1 from them. Hiding it again while keeping the confirmed route
    needs an engine change (§18). Acceptable, or prefer v7's behaviour (no DP-1, no iron
    arm)?
  - Criterion 1a: No evidence of causes other than iron deficiency → empiric oral iron
    reasonable without iron studies (ACOG) → **Stage 1.5** (v8: Step 2.8 → DP-3; v4–v7:
    Steps 2.1–2.3; Step 2.1 alone through v3) [1]
  - Criterion 1b: Atypical features, uncertain etiology, or confirmation preferred →
    ferritin/iron studies first → **Step 1.2** [1]
  - Judgment call by ACOG's own wording ("may be reasonable"); not machine-evaluable. [1]
  - `[DECISION — Josh 2026-09-24]` **Criterion 1b → Step 1.2 restored.** The built JSON
    had dropped it (DP-1 branched only to Step 2.1), so DP-1 was not a choice: a one_of
    fork with one branch takes it, and every patient got empiric oral iron automatically —
    ferritin 50 included. DP-1 now branches to both Step 2.1 and Step 1.2.
    **What actually happens** (proved with `gate-proof.ts` on the real traversal engine,
    both edge orders, through the incremental path the branch-choice mutation uses):
    DP-1's branches are scored by confidence, and the two Steps score identically on
    every signal (checked scorer by scorer), so both qualify and the fork **pends** —
    "which branch applies?" — with Step 2.1, Step 1.2, Stage 2 and everything under them
    held until the provider answers. Choosing **workup** with ferritin 50: Stage 2 and
    Step 2.1 are GATED_OUT by `gate-ida-confirmed`. Choosing workup with ferritin 12:
    Stage 2 opens. Choosing **empiric**: Step 2.1 is included and Step 1.2 excluded (since
    v4 the empiric branch is Stage 1.5, which also includes Steps 2.2–2.3 — below). Oral
    iron is never automatic unless confidence scoring puts Step 1.2 below the 0.60
    suggest threshold while Step 2.1 stays above it (only a per-node DB weight override
    or admin evidence entry could do that).
  - `[DECISION — Josh 2026-09-24]` **Second route into Stage 2's contents (v8; v4–v7: into
    Steps 2.1–2.3).**
    [SECOND ROUTE — step-2-8 via gate-empiric-no-hgbpathy]
    [SECOND ROUTE — step-2-8 via stage-2]
    Step 2.8 (DP-3) sits in Stage 2, which `gate-ida-confirmed` gates, and is also reached
    from Stage 1.5, which criterion 1a enters directly, through gate-empiric-no-hgbpathy:
    empiric oral iron without iron studies is ACOG-sanctioned, and Josh's v8 decision gives
    the empiric arm DP-3 too, so this route is deliberate — and so, symmetrically, is Stage
    2's own route into the region gate-empiric-no-hgbpathy guards. DP-1 is one_of, so at
    most one of the two is ever open. (The interim v8 marker SECOND ROUTE step-2-8 via
    stage-2-empiric is retired: Stage 1.5 now reaches Step 2.8 through the gate.) v4–v7's three markers — SECOND ROUTE step-2-1 / step-2-2 /
    step-2-3 via stage-2-empiric — are retired (Stage 1.5 no longer holds those steps;
    they are reached through DP-3's oral branch, Stage 2.5, on both arms); they and v3's
    Step 2.1-via-DP-1 marker are written without brackets here so the gate-control check
    cannot read them as live waivers.
  - ~~`[GAP — NEEDS JOSH]` **The empiric arm reaches Step 2.1 only.**~~ **Resolved:**
    `[DECISION — Josh 2026-09-24]` **The empiric arm gets the same follow-up as confirmed
    IDA.** *(v8: Stage 1.5 now holds Step 2.8, DP-3, and reaches Steps 2.1–2.3 through
    DP-3's oral branch, Stage 2.5 — see DP-3. The v4 design below is kept for the record;
    the sharing argument is unchanged, with Step 2.8 as the shared step.)* Through v3, choosing empiric EXCLUDED Step 2.2 (trial period), Step 2.3
    (response assessment), DP-2 and Step 2.5 (IV iron), because they hung only from
    Stage 2, which only the ferritin gate opens — no response check, no escalation.
    Criterion 1a now routes to **Stage 1.5 — Empiric Oral Iron Trial**, a branch-entry
    Stage that HAS_STEPs the **same** Steps 2.1, 2.2 and 2.3 (not copies). Through Step
    2.3 the empiric arm reaches the same Hgb recheck (Lab-10, Sched-2), the same
    `gate-hgb-response` → Step 2.4, and the same DP-2 → `gate-iv-iron-ga` → Step 2.5 IV
    iron route as the confirmed arm.
    **Why sharing is safe here** (and why DP-1 does not simply branch to Stage 2): the
    steps have two parents, Stage 2 and Stage 1.5, but DP-1 is `one_of`, so at most one
    parent is ever open. When a branch is chosen, the engine spares everything the
    chosen branch contains from the sweep that excludes the other branch
    (`containmentClosure`), so the unchosen parent never writes the shared steps. Proved,
    both edge orders: empiric → Stage 1.5 INCLUDED, Stage 2 EXCLUDED, Steps 2.1–2.3
    INCLUDED; workup + ferritin 50 → Stage 1.5 EXCLUDED, Steps 2.1–2.3 GATED_OUT by
    `gate-ida-confirmed` (the gate decides, not the unchosen branch); workup + ferritin
    12 → Stage 2 INCLUDED. Branching DP-1 straight into Stage 2 behaves the same, but
    puts a DP branch on the gate's own target, which `check-gate-control` rejects as
    Rule 1 because it cannot tell the two routes are exclusive.
    **Consequences for review:** (1) with empiric chosen, `gate-ida-confirmed` is not
    evaluated, so no ferritin is asked for or needed — same as v3. (2) DP-1's answer
    value for the empiric branch is now `stage-2-empiric` (was `step-2-1`). (3) The empiric
    arm inherits DP-2 as it stands: DP-2 has one BRANCHES_TO (Step 1.5), so it is taken
    automatically, and `gate-iv-iron-ga` is the only condition on Step 2.5 — so Step 1.5
    (expanded workup) and Step 2.5 (IV iron, GA ≥ 14) are INCLUDED as soon as Step 2.3 is
    reached, on either arm, before any nonresponse is shown. `gate-hgb-response` opens only
    Step 2.4 (maintenance). See §18 "v4 open item". **Resolved in v5** — DP-2 now waits
    for a "not responding" answer (below, and §4b `gate-hgb-response`).
- **DP-2 — Nonresponse management** (on Step 2.6, reached only via gate-hgb-nonresponse
  — v5/v6: gate-hgb-response's "not responding" arm; was on Step 2.3 through v4) —
  branch_mode: one_of
  - `[DECISION — Josh 2026-09-24]` **Escalation only after non-response.** Through v4 DP-2
    hung from Step 2.3 with a single branch, so the expanded workup and (GA ≥ 14) IV iron
    were INCLUDED the moment oral iron started. DP-2 is unchanged inside — one branch to
    Step 1.5, taken automatically once DP-2 is reached, and `gate-iv-iron-ga` on DP-2 →
    Step 2.5 — but it is now reached only through Step 2.6. (v7: Step 2.6 opens from chart
    data, not an answer — `gate-proof.ts response` now proves the chart gates; §4b. The v5
    proof, for the record:) Proved with
    `gate-proof.ts response`, both edge orders, on both arms (empiric; workup + ferritin
    12): unanswered → maintenance, Steps 2.6/2.7, DP-2, Step 1.5 and Step 2.5 (with
    every IV iron) all held pending the question; "recheck not yet done" → Step 2.7
    INCLUDED, maintenance and all escalation EXCLUDED, no care-plan blocker left in that
    region; "responding" → Step 2.4 INCLUDED, all escalation EXCLUDED; "not responding" +
    GA 20 → Steps 2.6, 1.5, 2.5 and the IV irons INCLUDED, Step 2.4 EXCLUDED; + GA 12 →
    Step 1.5 INCLUDED, Step 2.5 and the IV irons GATED_OUT; + GA missing → asks for
    `patient.gestational_age_weeks`, Step 2.5 held; "not yet" then "not responding" /
    "responding" (re-answer at the recheck) → escalation / maintenance respectively.
  - ~~`[CLINICAL AMBIGUITY — for Josh]`~~ **Resolved in v7 by DP-3** `[DECISION — Josh
    2026-09-24]`: intolerance, malabsorption and IDA diagnosed at ≥ 34 weeks now reach IV
    iron **without** an oral trial through DP-3 (below); DP-2 keeps its criteria for a patient
    who meets them after the trial. The original note: Criteria 2a (intolerance/nonadherence), 2b
    (suspected malabsorption) and **2d (moderate–severe IDA within ~4–6 weeks of
    delivery, or oral failure near term)** name reasons to go to IV iron that are not "no
    rise after a trial". Under v5 they reach IV iron only by the provider answering "not
    responding" at Step 2.3 — for 2d, a patient diagnosed late in pregnancy must go
    through a 2–4-week oral trial first, and DP-3 (predelivery route selection), which
    would be her other route, exists in this brief but not in the JSON. Bariatric/IBD
    patients still get their own IV-first guidance in Steps 3.4/3.5. DP-2's single branch
    (criteria 2a/2b/2d have no branch of their own) is unchanged.
  - Criterion 2a: Intolerance or nonadherence despite coaching → **Step 2.5** (IV iron) [1][5]
  - Criterion 2b: Suspected malabsorption (enteric-coated tabs, antacids, bariatric,
    IBD) → **Step 2.5** (IV iron) [1][8]
  - Criterion 2c: Suspected incorrect diagnosis or blood loss → **Step 1.5** (expanded
    workup) [1]
- **DP-3 — Oral iron trial vs IV iron without an oral trial** (on Step 2.8 — in Stage 2,
  ferritin-confirmed IDA, and since v8 Stage 1.5, the empiric arm; v7) — branch_mode:
  one_of `[DECISION — Josh 2026-09-24]`
  - `[DECISION — Josh 2026-09-24]` **Both iron arms get DP-3 (v8).** v7 put DP-3 in Stage 2
    only, so a patient on empiric iron always had the oral trial. Stage 1.5 now holds Step
    2.8 (the same node Stage 2 holds, not a copy): DP-1 is one_of, so only one of the two
    parents is ever open, and DP-1's sweep of the unchosen branch spares everything the
    chosen branch contains — the same sharing v4–v7 used for Steps 2.1–2.3 (§4 DP-1). A
    DP-3 copy on Stage 1.5 would instead have put two DecisionPoints over the shared oral
    steps. Proved with `gate-proof.ts dp-3` and `empiric`, both edge orders, on both arms:
    route not chosen → DP-3 asks with both options; oral trial → Steps 2.1–2.3 and the
    response check (NOT YET DUE at the start visit), Step 2.8 recorded under Stage 1.5 on
    the empiric arm; IV first at GA 20 / 36 → Step 2.10 IV iron, oral arm EXCLUDED; GA
    missing → asks for GA.
    **Consequences for review:** (1) DP-3 now pends for **every** empiric patient too (the
    two targets score identically — `dp-1-scoring`), so choosing empiric iron at DP-1 no
    longer starts oral iron by itself: the provider answers DP-1 and then DP-3.
    `[CLINICAL AMBIGUITY — for Josh]` (2) **IV iron first on the empiric arm is IV iron with
    no ferritin on file** — the empiric arm never draws iron studies, and ACOG describes IV
    iron for iron deficiency. Should IV-first on the empiric arm require a ferritin (e.g.
    route the provider to the workup), or is the provider's choice enough? Not gated here.
    (3) Criterion 3d reads "anemia diagnosed at ≥ 34 weeks (iron deficiency confirmed, or
    presumed on the empiric arm)". (4) The DP-1 answer value for the empiric branch is
    unchanged (`stage-2-empiric`). Former ambiguity (b) below is resolved by this decision.
  - Criterion 3a: No reason to skip the oral trial → **Stage 2.5** (Steps 2.1–2.3: oral
    iron, 2–4-week recheck, response check) [1]
  - Criterion 3b: Documented intolerance of oral iron (e.g. on a prior course) → **Step
    2.9** (IV iron, no trial) [1][5] — the brief's criterion 2a at treatment start
  - Criterion 3c: Suspected malabsorption (bariatric surgery, IBD, chronic antacid use) →
    **Step 2.9** [1][8] — criterion 2b
  - Criterion 3d: IDA diagnosed at ≥ 34 weeks (v8 wording: anemia diagnosed at ≥ 34 weeks,
    iron deficiency confirmed or presumed on the empiric arm) — too little time for an oral
    trial → **Step 2.9** [6][1] — criterion 2d / the former DP-3's 3b `[FALLBACK SOURCE — FIGO time-math;
    ACOG says only "severe iron deficiency later in pregnancy"]`
  - Step 2.9 → **gate-iv-iron-ga-direct** (GA ≥ 14) → **Step 2.10** (IV iron). IV iron's
    first-trimester rule is kept on this route too.
  - `[DECISION — Josh 2026-09-24]` **IV iron first before 14 weeks → oral iron until 14
    weeks, then IV (v8).** Step 2.9 → **gate-oral-bridge-ga** (GA < 14, the exact
    complement of gate-iv-iron-ga-direct) → **Stage 2.6**, which holds the oral trial's Steps
    2.1–2.3. `[BUILD NOTE]` Shared, not copied, with Stage 2.5: DP-3 is one_of, and its
    sweep of the unchosen oral branch spares everything under the chosen Step 2.9 (the
    oral steps included), so the bridge's GA gate decides them.
    [SECOND ROUTE — step-2-1 via stage-2-oral]
    [SECOND ROUTE — step-2-2 via stage-2-oral]
    [SECOND ROUTE — step-2-3 via stage-2-oral]
    (Steps 2.1–2.3 sit behind gate-oral-bridge-ga and are also Stage 2.5's — DP-3's oral
    branch — so these routes are deliberate; at most one of Stage 2.5 / Step 2.9 is ever
    open.) **What the provider sees**: IV first at GA 12 → Step 2.9 INCLUDED, Step 2.10 (IV
    iron) GATED_OUT, Stage 2.6 with oral iron, the trial period and the response check
    INCLUDED (response check NOT YET DUE at this visit); at the next visit with GA ≥ 14 the
    provider answers DP-3 again and IV first now opens Step 2.10 and closes the bridge. GA
    missing → **one** GA question, asked by both GA gates; IV iron and the bridge both held.
    Proved with `gate-proof.ts dp-3`, both edge orders, **both arms**: GA 12 and 13.9 →
    oral trial via Stage 2.6, IV iron GATED_OUT; GA 14, 20 and 36 → IV iron, bridge and
    oral steps GATED_OUT (and the post-non-response route with them); oral trial chosen →
    Step 2.9, the bridge and its gate EXCLUDED.
    **Consequences for review:** (1) a patient on the bridge who does not respond by the
    recheck while still < 14 weeks gets DP-2's expanded workup, and IV iron stays gated
    until 14 weeks (gate-iv-iron-ga) — as for any first-trimester nonresponder. (2) At the
    first visit ≥ 14 weeks, re-choosing IV first switches her from oral iron to IV; choosing
    the oral trial keeps oral iron and its response check (the provider's call, as at every
    visit).
  - **How each criterion is read** — v8 `[DECISION — Josh 2026-09-24]`: malabsorption (3c)
    is also read from the chart; intolerance (3b) and anemia diagnosed at ≥ 34 weeks (3d)
    stay provider answers.
    - *Intolerance (3b)* is history the chart does not carry as a code the simulator or a
      problem list reliably has; it is elicited, like DP-2's 2a.
    - *Malabsorption (3c)* — **recommended from the chart, not forced** (v8). A
      malabsorption code on file opens **Step 2.11** (gate-malabsorption-chart, §4b) with
      Guid-6, "consider IV iron first", on either arm; DP-3 still asks, and the provider may
      still choose the oral trial. **Why not pre-selected:** DP-3 is one_of and its branch
      choice is confidence-scored on the branch *targets* (Stage 2.5, Step 2.9). Those are
      structural nodes: data completeness, match quality and risk score them without
      reading the patient, and evidence strength reads their own citations — so both score
      0.938 for every patient and the fork always pends (`gate-proof.ts dp-1-scoring`). A
      Criterion's codes score the Criterion itself, never the branch, so coding crit-3c
      would change nothing the provider sees. Only a DB-side signal weight or admin
      evidence entry could move a branch score, and no JSON can author that. **Why not
      forced:** forcing would need a chart fork in front of DP-3 (the DP cannot be skipped
      otherwise), and the clinical reading is a recommendation — Step 3.5: IV first with
      **active** IBD; Step 3.4: a "low threshold" after bariatric surgery. **What the
      provider sees:** with, e.g., Z98.84 on file and confirmed or empiric iron, the DP-3
      question "which branch applies? — Oral Iron Trial / IV iron without an oral trial"
      stands as before, and alongside it Step 2.11 "Malabsorption on the chart: IV iron
      without an oral trial favoured (DP-3 criterion 3c)" is INCLUDED with Guid-6's text;
      Steps 3.4/3.5 still open from gate-bariatric / gate-ibd as well. Choosing IV first then
      proceeds as any 3c choice (IV iron at GA ≥ 14, the oral bridge before). Proved with
      `gate-proof.ts malabsorption`, both edge orders, both arms (every listed family; a
      K51.40 polyp code, K90.41 and no code → nothing opens; ferritin 50 → closed with Stage 2).
    - *Anemia diagnosed at ≥ 34 weeks (3d)* is gestational age **at diagnosis**, which the
      chart cannot give: a gate on current GA would switch a patient responding to oral
      iron to IV at her 34-week recheck (DP-3 is asked again at every visit that reaches
      it). The provider reads it; GA ≥ 14 stays a chart gate.
  - **What happens** (proved with `gate-proof.ts dp-3`, both edge orders): confirmed IDA,
    route not chosen → DP-3 asks (options Stage 2.5 / Step 2.9; with the seeded scorers the
    two targets score identically, 0.938, so the fork pends — `dp-1-scoring`), oral and IV
    both held. **Oral trial** → Steps 2.1–2.3 and the response check (NOT YET DUE at the
    start visit); Step 2.9/2.10 EXCLUDED. **IV first**, GA 20 or 36 → Step 2.10 with
    Med-13–16 and Sched-6 INCLUDED; oral iron, the response check and the post-non-response
    IV route (Steps 2.6, 2.5, DP-2) EXCLUDED; no response question. GA 12 → IV iron
    GATED_OUT (v8: and the oral trial starts via Stage 2.6); GA missing → asks for GA, IV
    iron held. Ferritin 50 and hemoglobinopathy
    disease never see DP-3. (v8: the empiric arm does — same outcomes, proved on both arms.)
  - ~~`[CLINICAL AMBIGUITY — for Josh]` (a) **IV first before 14 weeks gives no iron at
    all**~~ — **resolved in v8** `[DECISION — Josh 2026-09-24]`: oral iron until 14 weeks,
    then IV (above). ~~(b) **The empiric arm has no DP-3**~~ — **resolved in v8**
    `[DECISION — Josh 2026-09-24]`: both arms get DP-3 (above). (c) DP-3 adds one provider
    question at every visit that reaches it (like DP-1) — since v8 on both arms — since each
    visit is a new session.
  - Retired: the brief's former **DP-3 — Predelivery route selection** (after Step 4.2;
    never built): 3a "adequate time for oral repletion and responding → continue oral
    (Step 2.4)" is what the response check now does; 3b "moderate–severe IDA within ~4–6
    weeks of delivery, or oral failure near term → IV iron" is criterion 3d here (at
    diagnosis) plus DP-2 (after a failed trial).

## 4b. Gates

Common note (**v3**): all lab-threshold gates use **coded-form** conditions (field `labs` +
LOINC + explicit threshold) rather than attribute-form (`lab.*`). Rationale, established by
evaluator-harness proof: the simulator's "Fields this pathway reads" panel never renders
attribute-form conditions, and attribute-form evaluation requires `pathway_attribute_code_map`
rows that have no seeding path — coded-form is visible in the panel with quick-fill AND
evaluates with zero DB setup. Revisit when the dashboard renders the attributes list and
code-map seeding exists. Anemia *detection* gates were removed with the screening stage —
the pathway presumes the coded diagnosis.

- **Gate `gate-microcytic` — MCV < 80** `[DECISION — Josh 2026-09-24]` *(restored in v4,
  rewired; v7: compound with the disease codes; v8: MCV alone again)*
  - Attached to: step-1-1 · Branches to: **step-1-7** (DP-1's host — was step-1-2 through
    v2) · **patient_attribute** (v8; v7 compound AND) · Default: **skip** · On unresolved:
    **ask**
  - Condition: coded, field `labs`, less_than, value `787-2` (MCV, LOINC), threshold 80,
    display "MCV (fL)", horizon {days: 90} (same as gate-normocytic / gate-macrocytic) [1].
    v7's 12 `not_includes_code` conditions moved to gate-empiric-no-hgbpathy (below) — see
    §4 DP-1 for why the disease split cannot sit in front of DP-1.
  - Boundaries: < 80 here, > 79.9 in gate-normocytic, so at the 0.1 fL reporting
    resolution 79.9 is microcytic and 80.0 normocytic — no gap, no overlap (proved at 79.9
    and 80).
  - Guards DP-1, not Step 1.2: the gate is the only way into Step 1.7, and Step 1.7 is the
    only way into DP-1, so the old Rule 1 conflict below (a gate and a DP branch on the
    same step) does not arise. The provider's DP-1 choice still decides Step 1.2 — but the
    choice is only offered when MCV < 80. Every numeric gate asks, so a missing MCV asks.
  - ~~`[CONSEQUENCE OF DP-1 DECISION — NEEDS JOSH]`~~ *Superseded by the v4 decision above
    — kept for the record:* Not Josh's decision; a build consequence. Removed because
    restoring DP-1 criterion 1b made its only target, Step 1.2, a DecisionPoint branch.
    The gate could no longer exclude Step 1.2 (Rule 1): on the live path — the branch
    choice re-resolves incrementally from DP-1 — choosing workup includes Step 1.2 at any
    MCV (proved: MCV 90 + workup → Step 1.2 INCLUDED), and choosing empiric excludes it at
    any MCV. Running the proof with and without the gate gave identical outcomes in every
    scenario after the choice; the gate only added an MCV question that could not change
    Step 1.2 (and gate-normocytic/macrocytic still ask for a missing MCV). So Step 1.2 is
    now the provider's call at DP-1. MCV < 80 still frames Step 1.2's indication (§3).
    If MCV should instead **force** the microcytic workup, DP-1 cannot also branch to it —
    that is a different design. **Also note:** DP-1 now pends for *every* patient —
    normocytic and macrocytic too — offering "Microcytic workup" as the confirmatory
    branch; before, MCV ≥ 80 kept those patients out of Step 1.2 (they get Steps 1.3/1.4
    from their own MCV gates either way).
- **Gate `gate-empiric-no-hgbpathy` — No hemoglobinopathy disease: empiric iron may
  proceed** (v8) `[DECISION — Josh 2026-09-24]` (disease: no empiric iron) · `[BUILD NOTE]`
  (wiring)
  - Attached to: **stage-2-empiric** (Stage 1.5, DP-1's empiric branch) · Branches to:
    **step-2-8** · compound **AND** · Default: **skip** · On unresolved: **default**
    (membership only — nothing is asked)
  - Conditions: field `conditions`, **`not_includes_code`**, ICD-10, horizon LIFETIME, status
    **any**, one per code: `D57.0.*`, `D57.1`, `D57.2.*`, `D57.4.*`, `D57.8.*`, `D56.0`,
    `D56.1`, `D56.2`, `D56.5`, `D56.8`, `D56.9`, `D58.2` [4][7][16] — v7's list, unchanged.
    No code on file is a definite true; status `any` makes a matching code a definite false
    whatever its state. Traits D57.3 / D56.3 deliberately absent (disease only); D56.4 HPFH
    absent as in gate-thal-major.
- **Gate `gate-hgbpathy-microcytic` — Hemoglobinopathy disease on file, empiric iron
  chosen: iron studies instead** (v7; rewired v8) `[BUILD NOTE]`
  - Attached to: **stage-2-empiric** (v7: step-1-1) · Branches to: **step-1-8** · compound
    **OR** (v7: AND with the MCV condition — redundant behind DP-1, which only MCV < 80
    reaches) · Default: **skip** · On unresolved: **default** (v7: ask, for the MCV)
  - Conditions: `includes_code` on the same 12 codes (LIFETIME, any) — the exact complement
    of gate-empiric-no-hgbpathy, so on the empiric branch exactly one of the two opens.
  - Keeps its v7 id (same target, same code list). Neither id may be `gate-microcytic-*`
    or `gate-empiric-no-hgbpathy-*`: `check-gate-control` reads a `gate-x-*` id as a fan-out
    copy of `gate-x` and would demand identical conditions.
- **Gate `gate-normocytic` — MCV 80–100**
  - Attached to: step-1-1 · Branches to: step-1-3 · compound (AND) · Default: skip
  - Conditions (coded): labs `787-2` greater_than threshold **79.9**; labs `787-2`
    less_than threshold **100.1** — coded operators lack ≥/≤, so band boundaries use
    strict comparisons at the labs' 0.1 fL reporting resolution (80.0 and 100.0 classify
    normocytic, per convention). Horizon {days: 90} each. [1]
- **Gate `gate-macrocytic` — MCV > 100**
  - Attached to: step-1-1 · Branches to: step-1-4 · patient_attribute · Default: skip
  - Condition (coded): field `labs`, greater_than, value `787-2`, threshold 100,
    horizon {days: 90} [1]
- **Gate `gate-hgbpathy-needed` — Hemoglobinopathy testing needed?**
  - Attached to: step-1-1 · Branches to: step-1-6 · Type: question · Default: skip
  - Prompt: "Is hemoglobinopathy testing needed — i.e., no prior hemoglobinopathy test
    results are available for interpretation?" · answer_type: BOOLEAN
  - Rationale: ACOG 2022 universal-offer recommendation; elicited because "results
    available for interpretation" is a records judgment. [4]
- **Gate `gate-ida-confirmed` — Ferritin confirms iron deficiency**
  - Attached to: step-1-2 · Branches to: stage-2 · patient_attribute · Default: **skip** ·
    On unresolved: **ask** `[BUILD FIX 2026-09-24 — was traverse]`
    (original intent: empiric iron is guideline-sanctioned when ferritin is missing, so
    absent data should not block the treatment stage; DP-1 governs the judgment) [1]
  - `[BUILD FIX]` **`traverse` never excluded anything.** On main `default_behavior` applies
    to a definite "no" as well as to missing data, so ferritin 50 (not iron deficient) still
    opened Stage 2. Now `skip`: ferritin ≥30 excludes iron therapy. Missing ferritin still
    holds Stage 2 and asks for the value — the same as before this change, because
    `on_unresolved` defaults to `ask`. "Include when ferritin is missing, exclude when it is
    normal" is **not expressible** on main. ~~Needs a physician call: keep `ask` (Stage 2
    waits for a ferritin), or `default` (missing ferritin excludes Stage 2 — empiric iron
    then only via the provider).~~
  - `[DECISION — Josh 2026-09-24]` **Resolved: `ask`** — numeric gates ask when the value
    is missing (general rule; see §18 "On unresolved — RESOLVED"). A missing ferritin holds
    Stage 2 and asks for the value; empiric iron without ferritin is DP-1's criterion 1a.
  - Condition (coded): field `labs`, less_than, value `2276-4` (ferritin, LOINC),
    threshold 30, horizon {days: 90}
  - Rationale: ACOG confirmatory cutoff (sens 92%/spec 98% per ASH); WHO uses <15,
    USPSTF notes no consensus — encoded 30 with provenance. [1][2][5]
- **Gates `gate-hgb-response` / `gate-hgb-nonresponse` — Response to oral iron at the
  2–4-week Hgb recheck** `[DECISION — Josh 2026-09-24]` *(v7: chart data; v5/v6 were a
  SELECT question router, v4 and earlier a layered-trend chart gate)*
  - Attached to: step-2-3 · Type: **compound**, nested condition groups · Default: **skip**
    · On unresolved: **ask** · Two single-target gates (a chart gate cannot route):
    `gate-hgb-response` → **step-2-4** (maintenance); `gate-hgb-nonresponse` → **step-2-6**
    (Nonresponse management → DP-2). No `when` edges.
  - **Rule (Josh):** responding = Hgb rise **≥ 1 g/dL since oral iron started** OR Hgb **at
    target** (≥ 11 g/dL in the 1st/3rd trimester, ≥ 10.5 in the 2nd); not responding =
    neither. Exactly 1.0 g/dL counts as a response.
  - **Encoding** (the form that asks for the trimester only when Hgb is 10.5–11):
    - responding = `OR( Δ at_least 1.0 , OR( Hgb > 10.95 , AND( patient.trimester equals 2 ,
      Hgb > 10.45 ) ) )`
    - not responding = `AND( Δ less_than 1.0 , AND( Hgb < 10.95 , OR( patient.trimester
      not_equals 2 , Hgb < 10.45 ) ) )` — the **leaf-wise De Morgan negation** of the first
      (AND ↔ OR, each leaf replaced by its exact complement), never a re-derivation, so the
      two are complements in every state: with all data present exactly one opens; with a
      datum missing both hold together or both decide together.
    - **Δ** = labs `718-7` `delta_from_baseline`, `delta_threshold` 1.0, `delta_comparison`
      `at_least` / `less_than`, `min_points` 2, display "Hemoglobin (g/dL)", **`window_from`**:
      event `medication_start`, clinical_role **`oral-iron-repletion`** (the class tag on
      Med-1/2/3 — and Med-11, the "avoid" enteric-coated entry, which carries no code),
      label "oral iron", codes RXNORM **310325 / 198630 / 284202** (exactly the CodeEntries
      of Med-1/2/3, §13), **`baseline_days` 28** (admits the latest pre-treatment Hgb within
      28 days before the start — the diagnostic value), **`min_days_since_anchor` 14** (the
      rise is judged from day 14: FIGO's 2-week point, the lower end of the 2–4-week recheck).
    - **Hgb** = labs `718-7`, display "Hemoglobin (g/dL)", horizon {days: 28}. "≥ 11" is
      `greater_than 10.95` and "< 11" `less_than 10.95` (the midpoint of two 0.1 g/dL steps,
      so the pair are exact complements at reporting precision); same for 10.5 / 10.45.
    - **Trimester**: `patient.trimester` (no horizon; the resolver derives it from
      `gestational_age_weeks` at 14/28 weeks). `not_equals 2` rather than the reference
      fixture's `in [1, 3]`: `equals 2` / `not_equals 2` complement each other for **every**
      value, while `in [1, 3]` / `equals 2` complement only on {1, 2, 3} — an out-of-domain
      value (4, or the string "2") would make both trimester leaves false, and a rise < 1
      with Hgb 10.5–11 would then open neither gate. With `not_equals 2` any non-2 value
      reads as the 1st/3rd-trimester target (11), the stricter one, so an odd value can only
      escalate, never silently drop the patient. A missing trimester is missing data (asks).
  - **Outcomes** (proved with `gate-proof.ts response`, both edge orders, both arms —
    empiric, and workup + ferritin 12):
    - **Start visit** (oral iron recommended this session; no care plan, order or clinician
      date): the anchor is the session (`SESSION_RECOMMENDATION`), never due that day —
      both gates **GATED_OUT, NOT_YET_DUE, nothing asked**; Steps 2.4/2.6 and all escalation
      closed; the Step 2.3 recheck lab and Sched-2 carry the plan forward; no care-plan
      blocker. With Hgb 10.7 and the trimester unknown, still NOT YET DUE and the trimester
      is **not** asked (NOT YET DUE outranks missing data).
    - **At target at once** — Hgb 11.2 at the start visit opens **maintenance immediately**
      `[DECISION — Josh 2026-09-24]` (accepted: a patient already at target needs no rise);
      the non-response gate is a definite no.
    - **Day 5** (anchored on the start visit's stored care plan, +0.3): NOT YET DUE, nothing
      asked, no escalation.
    - **Day 21**: 9.5 → 10.7 (+1.2) → maintenance, escalation closed; 9.5 → 9.9 (+0.4,
      below target) → Step 2.6, DP-2, expanded workup and (GA 20) IV iron; GA 12 → IV iron
      GATED_OUT; GA missing → non-response still decided (Hgb < 10.5 needs no trimester),
      IV iron asks for GA.
    - **Trimester** asked **only** for Hgb in [10.5, 11) with a rise < 1: 10.0 → 10.6 with
      no trimester → one `patient.trimester` question shared by both gates; GA 20 (T2) →
      maintenance, GA 30 (T3) → non-response. 10.8 → 11.3 with no trimester → maintenance,
      nothing asked.
    - **Recheck missing** (due, one Hgb short of a series): both gates held, **one** Hgb
      question — "Hemoglobin (g/dL) (LOINC 718-7) — newest result, drawn after <date>?"
      when the only value is in the window. `[ENGINE GAP — reported]` When the only value is
      the pre-treatment baseline (> 7 days old), `gate-severe-anemia` (Hgb, 7-day horizon)
      has already asked for a current Hgb on the first pass, and the response gates are
      reached only after the DP-1 answer (an incremental pass): `reconcilePendingQuestions`
      keeps the existing prompt for the shared datum and drops the response gates' claim.
      One Hgb question still stands and both gates stay held on it, but it reads "most
      recent value?" and lists only `gate-severe-anemia` as asker. Not a pathway defect.
    - **Where the start date comes from at a recheck** (first hit wins): a clinician-entered
      date → the earliest stored care plan of this pathway recommending oral iron → the
      earliest dated chart order of 310325/198630/284202 (proved: a dated ferrous sulfate
      order anchors a day-21 nonresponder with no care plan) → this session — **unless the
      chart shows the course already under way** → otherwise the date is asked.
      `[BUILD NOTE]` (engine behaviour, merged from `engine-recheck-anchor`, reflecting
      `[DECISION — Josh 2026-09-24]` "ask for the start date"): oral iron (Step 2.1) is
      recommended at every visit that reaches Step 2.3, so through v7 a recheck with no care
      plan, no dated order and no clinician date **read as a start visit** and closed NOT YET
      DUE — a nonresponder was silently missed (former `[CLINICAL AMBIGUITY]`, now resolved).
      The engine now refuses the session source when the chart holds an Hgb (the delta's own
      lab, LOINC 718-7) dated ≥ 14 days before the visit (`min_days_since_anchor`), or an
      oral-iron order with no or partial start date: both response gates hold and **one**
      DATE question is asked, "When did oral iron start?" (shared by both gates). Proved
      with `gate-proof.ts response`, both arms, both edge orders: day 21, baseline 24 days
      old, +0.4, nothing stored → the date question once, no anchor, Steps 2.4/2.6 held;
      answered 2026-06-01 → anchored CLINICIAN, non-responding, Step 2.6 INCLUDED; answered
      with today's date → NOT YET DUE, nothing else asked. Genuine start visits are
      unchanged (baseline 3 days old → NOT YET DUE, nothing asked).
      **Known cost:** a *start* visit whose chart already holds an older Hgb (e.g. a routine
      early-pregnancy CBC ≥ 14 days old) is also asked the start date; answering today's
      date closes both response gates NOT YET DUE with nothing else asked, and does not
      block the care plan once answered (an unanswered date question does, like any pending
      question).
  - **Why this replaces the interim question.** v5/v6 asked the provider ("responding / not
    responding / recheck not yet done") because the kernel could not anchor a rise to the
    treatment start, had no "rose by less than" encoding, and read a missing recheck as a
    silent "no". `window_from`, `delta_comparison`, INSUFFICIENT_SERIES-asks and NOT YET DUE
    (josh-dev) cover all four; nested groups encode the trimester target in one gate.
  - **Simulator:** the composer sends no dates, so the Δ arm cannot fire there (the start
    date is asked, and an undated series has no points); the at-target arm works from an
    undated Hgb. Exercise the Δ arm through the API with dated labs (§18).
  - `[CLINICAL AMBIGUITY — for Josh]` (a) at a **4-week** recheck FIGO expects ≥ 2 g/dL, so
    "≥ 1 g/dL" is more lenient than FIGO; (c) no Hct-based equivalent is offered. (Former
    (b), a patient at target without a 1 g/dL rise reading as a nonresponder, is resolved by
    the at-target arm.)
  - **Response definition and source** (unchanged). FIGO [6] — a rise of "at least 1 g/dL
    after 2 weeks" is a positive response, and poor response is "<1 g/dL after 2 weeks … or
    <2 g/dL after 4 weeks"; CDC [3] (via the AAFP summary) rechecks at 4 weeks but defines
    the 1 g/dL / 3% Hct response only for infants and children; the "rise >1 g/dL"
    attributed to ACOG [1] in earlier drafts is a secondary restatement — PB 233's own text
    was not re-verified for it. The trimester targets are CDC's (Step 1.1). [1][3][6]
  - Superseded (v5/v6, question): SELECT router "Hemoglobin recheck 2–4 weeks after
    starting oral iron", options `responding` → step-2-4 / `not responding` → step-2-6 /
    `recheck not yet done` → step-2-7. Superseded (v4, chart): compound OR — labs 718-7 >
    10.9 {days: 90}; `trend_up` slope 0.030 over 42 days; 0.015 over 120 and 300 days.
- **Gate `gate-iv-iron-ga` — Beyond first trimester (GA ≥ 14 0/7 weeks)**
  - Attached to: dp-2 · Branches to: step-2-5 · Type: **patient_attribute** · Default: skip
    · On unresolved: **ask**
  - Condition (attribute): `patient.gestational_age_weeks` `greater_or_equal` **14**, unit
    weeks (no horizon — `patient.*` has no temporal policy)
  - `[DECISION — Josh 2026-09-24]` **Read gestational age directly.** Replaces the question
    gate ("Is the patient beyond the first trimester (≥14 0/7 weeks gestation)?",
    BOOLEAN). Same target. GA ≥ 14 opens IV iron, GA < 14 gates it out, and a **missing**
    GA pends and asks for `patient.gestational_age_weeks` (NUMERIC) — since engine fix
    `8f64fc1` a missing `patient.*` value is missing data, not a silent "no". Proved with
    `gate-proof.ts ga` (GA 20 and 14 included, 12 GATED_OUT, missing pends with that
    datum). The encounter simulator sends GA, so it decides there; the pathway-preview flow
    sends no `patientAttributes`, so there it asks. The admin dashboard's "Fields this
    pathway reads" panel does not list attribute conditions.
  - `[BUILD NOTE]` The generated question reads **"patient.gestational_age_weeks — current
    value?"** — the engine prints the raw path for attribute conditions and ignores
    `display` there (`unresolved-prompt.ts`), where the old question gate had readable
    text. A readable label needs an engine change, not a JSON one.
  - ~~Question-gate form (v3): Type question, prompt "Is the patient beyond the first
    trimester (≥14 0/7 weeks gestation)?", answer_type BOOLEAN.~~
  - Rationale: ACOG Level B — parenteral iron "after the first trimester"; ASH: no
    1st-trimester safety data. **v3 conversion** (now reverted): originally a
    `patient_attribute` gate on `patient.gestational_age_weeks`, converted to a question
    gate because the simulator could not set patient.* attributes and a missing one read as
    "no". Both have since been fixed, so it is a data gate again (2026-09-24). [1][5]
  - `[BLOCKED — prior_node_result]` The ideal design adds "IV iron depends on Step 2.2
    (oral trial) having resolved INCLUDED" as a prior_node_result gate — import-blocked
    today. **Fallback the builder must emit:** the REQUIRES edge in §12 (step-2-5
    REQUIRES step-2-2) + DP-2 criteria routing. Upgrade when the validator fix lands.
- **Gate `gate-iv-iron-ga-direct` — Beyond first trimester (GA ≥ 14 0/7 weeks), IV iron
  without an oral trial** (v7) `[BUILD NOTE]` (the GA ≥ 14 rule is `[DECISION — Josh
  2026-09-24]`; this copy is how it is wired)
  - Attached to: step-2-9 · Branches to: step-2-10 · patient_attribute · Default: skip ·
    On unresolved: **ask**
  - Condition: identical to gate-iv-iron-ga (`patient.gestational_age_weeks`
    `greater_or_equal` 14, unit weeks). A separate gate because Rule 2 forbids a second gate
    on Step 2.5, and a DP-3 branch straight into Step 2.5 would override gate-iv-iron-ga;
    the `-direct` suffix makes `check-gate-control` hold the two conditions in sync (a
    Rule 3-style copy). [1][5]
- **Gate `gate-oral-bridge-ga` — Before 14 0/7 weeks: oral iron until IV iron can be
  given** (v8) `[DECISION — Josh 2026-09-24]` (oral until 14 weeks, then IV) ·
  `[BUILD NOTE]` (wiring)
  - Attached to: step-2-9 · Branches to: **stage-2-oral-bridge** (Stage 2.6) ·
    patient_attribute · Default: **skip** · On unresolved: **ask**
  - Condition: `patient.gestational_age_weeks` `less_than` **14**, unit weeks (no horizon —
    `patient.*` has no temporal policy). The exact complement of gate-iv-iron-ga-direct
    (`greater_or_equal` 14) on the same host, so for any known GA exactly one opens (proved
    at 13.9 and 14); a missing GA makes both ask the same `patient.gestational_age_weeks`
    question once. Not named `gate-iv-iron-ga-*`: `check-gate-control` reads that prefix as
    a fan-out copy of gate-iv-iron-ga and would demand identical conditions. [1][5]
- **Gate `gate-malabsorption-chart` — Malabsorption condition on the chart** (v8)
  `[DECISION — Josh 2026-09-24]` (3c from chart codes); code list `[BUILD NOTE]` — for Josh
  - Attached to: step-2-8 · Branches to: **step-2-11** · compound **OR** · Default: **skip** ·
    On unresolved: **default** (membership only — "no code on file" is a definite no; nothing
    is ever asked)
  - Conditions: field `conditions`, `includes_code`, ICD-10, horizon **LIFETIME**, status
    **any**, each with a `display`: `Z98.84` bariatric surgery status; `O99.84.*` bariatric surgery status complicating
    pregnancy / childbirth / the puerperium (O99.840–O99.845); `K50.*` Crohn's disease (all 28
    codes); ulcerative colitis by subfamily — `K51.0.*` pancolitis, `K51.2.*` proctitis,
    `K51.3.*` rectosigmoiditis, `K51.5.*` left-sided colitis, `K51.8.*` other UC, `K51.9.*` UC
    unspecified; `K90.0` celiac disease; `K90.82.*` short bowel syndrome (K90.821/.822/.829);
    `K90.83` intestinal failure; `K90.9` intestinal malabsorption, unspecified; `K91.2`
    postsurgical malabsorption NEC; `Z90.3` acquired absence of stomach [part of].
    Verified 2026-09-25 against the NLM ICD-10-CM table: `https://clinicaltables.nlm.nih.gov/api/icd10cm/v3/search?sf=code&terms=<prefix>`
    for `K90`, `Z98.84`, `O99.84`, `K91.2`, `K50`, `K51`, `Z90.3` — Z98.84, K90.0, K90.83,
    K90.9, K91.2 and Z90.3 are leaf codes (exact match); O99.84, K50, K51.x and K90.82 have
    children, hence `.*`.
  - **Inclusions decided by the builder — for Josh to confirm** `[CLINICAL AMBIGUITY — for
    Josh]`: bariatric status and IBD mirror gate-bariatric / gate-ibd; celiac disease (named
    in the request); short bowel / intestinal failure, unspecified intestinal malabsorption
    and postsurgical malabsorption (malabsorption by definition); partial/total gastrectomy
    (Z90.3 — reduced acid and duodenal transit impair non-heme iron absorption). **Left out:**
    `K51.4.*` inflammatory polyps of colon (gate-ibd's `K51.*` sweeps them in; they are not a
    malabsorption state); `K90.1` tropical sprue, `K90.2` blind loop, `K90.3` pancreatic
    steatorrhea, `K90.41` non-celiac gluten sensitivity, `K90.49` malabsorption due to
    intolerance, `K90.81` Whipple's disease, `K90.89` other intestinal malabsorption;
    atrophic gastritis, *H. pylori*, and chronic antacid / PPI use (a medication class the
    gate does not read — still the provider's 3c judgment).
  - Status `any`: the conditions are chronic or anatomical, as in gate-bariatric / gate-ibd.
    No CodeEntry nodes are added (the codes live in the gate; a Criterion code would not
    move DP-3 — §4 DP-3). [1][8][18][19]
- **Gate `gate-severe-anemia` — Severe anemia (transfusion consideration)**
  - Attached to: stage-3 · Branches to: step-3-6 · patient_attribute · Default: skip
  - Condition (coded): field `labs`, less_than, value `718-7` (Hgb, LOINC), threshold 6,
    horizon {days: 7}
  - Rationale: ACOG Level B fetal-indication threshold. [1]
- **Gate `gate-referral-threshold` — Referral-level anemia**
  - Attached to: stage-3 · Branches to: step-3-7 · compound (OR) · Default: skip
  - Conditions (coded): labs `718-7` less_than threshold 9; labs `4544-3` (Hct, LOINC)
    less_than threshold 27. Horizon {days: 90} each.
  - Rationale: CDC/IOM referral rule; no ACOG numeric equivalent [GAP]. [3]
- **Gate `gate-scd` — Sickle cell disease (route out)**
  - Attached to: stage-3 · Branches to: step-3-1 · compound (OR) · Default: skip
  - Conditions (coded, field `conditions`, ICD-10): includes_code `D57.0.*`; includes_code
    `D57.1`; includes_code `D57.2.*`; includes_code `D57.4.*`; includes_code `D57.8.*`
    (trait D57.3 deliberately excluded — see gate-trait) [7]
- **Gate `gate-thal-major` — Thalassemia syndrome (route out)**
  - Attached to: stage-3 · Branches to: step-3-2 · compound (OR) · Default: skip
  - Conditions (field `conditions`, ICD-10): includes_code `D56.0`; `D56.1`; `D56.2`;
    `D56.5`; `D56.8`; `D56.9` (trait D56.3 excluded; **D56.4 HPFH also deliberately
    excluded** — benign, no route-out indicated; verifier-confirmed the family has no
    other members) [16]
- **Gate `gate-trait` — Trait carrier (in-pathway modifications)**
  - Attached to: stage-3 · Branches to: step-3-3 · compound (OR) · Default: skip
  - Conditions (field `conditions`, ICD-10): includes_code `D57.3`; includes_code `D56.3` [4]
- **Gate `gate-bariatric` — Bariatric surgery history**
  - Attached to: stage-3 · Branches to: step-3-4 · compound (OR) · Default: skip
  - Conditions (field `conditions`, ICD-10): includes_code `Z98.84`; includes_code `O99.84.*` [8][19]
- **Gate `gate-ibd` — Inflammatory bowel disease**
  - Attached to: stage-3 · Branches to: step-3-5 · compound (OR) · Default: skip
  - Conditions (field `conditions`, ICD-10): includes_code `K50.*`; includes_code `K51.*`
    (note: `K51.*` sweeps in K51.4x inflammatory colon polyps — accepted; the branch step
    is surveillance-oriented, over-inclusion is safe here) [8]
- **Gate `gate-multi-gestation` — Multiple gestation**
  - Attached to: stage-3 · Branches to: step-3-8 · patient_attribute (coded) · Default: skip
  - Condition: field `conditions`, includes_code `O30.*`, system ICD-10 [20]
- **Gate `gate-ckd` — Chronic kidney disease (route out)**
  - Attached to: stage-3 · Branches to: step-3-9 · compound (OR) · Default: skip
  - Conditions (field `conditions`, ICD-10): includes_code `N18.3.*`; `N18.4`; `N18.5`;
    `N18.6`; `O26.83.*` [21]
- **Gate `gate-transfusion-refusal` — Transfusion decliner**
  - Attached to: stage-3 · Branches to: step-3-10 · Type: question · Default: skip
  - Prompt: "Does the patient decline blood transfusion or specific blood products (e.g.,
    for religious reasons)?" · answer_type: BOOLEAN
  - Rationale: elicited care preference; identify early, before clinical need. [17]

**Removed with the screening stage (v2):** gate-anemia-t1/t2/t3 (trimester Hgb detection —
redundant once the diagnosis is the trigger) and gate-high-hgb (Hgb >15 evaluation — a
screening-side finding that has no place in a diagnosed-anemia pathway). The trimester
diagnostic criteria survive as confirmation content in Step 1.1.

**Considered and rejected:** an `llm_text_analysis` gate for pica/dietary-history narrative
was considered but rejected — pica is better elicited directly (safety-netting Guidance +
risk-factor review at Step 1.1), and no other decision in this pathway lives only in
narrative. Recorded so reviewers know the omission is deliberate.

## 5. Medications

- **Med-1 — Ferrous sulfate 325 mg (65 mg elemental iron)** (on Step 2.1)
  - Role: first_line · Clinical role: `oral-iron-repletion`
  - Dose: 1 tablet once daily (to BID per clinician); alternate-day dosing is an
    evidence-based tolerability option (Stoffel trials, non-pregnant; ASH: "not yet
    recommended during pregnancy in the US") — **not an ACOG mandate; PB 233 is silent on
    it and gives no numeric therapeutic dose [GAP]** · Route: oral
  - ~~Escalates to: Med-5 (ferric derisomaltose)~~ `[BUILD FIX 2026-09-24]` **No
    ESCALATES_TO edge.** The traversal follows every outgoing edge of an included
    Medication, so `med-1 → med-5` was a second, live route to the IV iron: with oral iron
    included, ferric derisomaltose was INCLUDED even when Step 2.5 was GATED_OUT (GA 12) or
    held (GA missing) — edge-order dependent, the same first-writer-wins leak as v3's
    shared labs. Proved with `gate-proof.ts ga` (med-5 now follows Step 2.5). Escalation
    to IV iron is expressed by Step 2.5's own route (DP-2 → `gate-iv-iron-ga`).
  - Notes: avoid enteric-coated/SR forms;
    empty stomach preferred, small snack if GI upset; separate from calcium/antacids/
    tea/coffee by ≥2 h; vitamin C co-administration optional (RCT equivalence). [1][5][13][14][15]
- **Med-2 — Ferrous gluconate 300–324 mg (34–38 mg elemental)** (on Step 2.1)
  - Role: alternative · Clinical role: `oral-iron-repletion` · Oral; lower elemental dose,
    gentler GI profile. [1]
- **Med-3 — Ferrous fumarate 324–325 mg (106 mg elemental)** (on Step 2.1)
  - Role: alternative · Clinical role: `oral-iron-repletion` · Oral; highest elemental
    content per tablet. [1]
- **Med-4 — Iron sucrose (Venofer)** (on Step 2.5)
  - Role: second_line · Clinical role: `iv-iron-repletion`
  - Dose: 200 mg IV per session × 5 within 14 days (~1,000 mg total; label is CKD —
    pregnancy use off-label) · Notes: multiple visits; historically most-used in
    pregnancy. [5][22]
- **Med-5 — Ferric derisomaltose (Monoferric)** (on Step 2.5)
  - Role: second_line · Clinical role: `iv-iron-repletion`
  - Dose: 1,000 mg IV single dose over ≥20 min (≥50 kg; 20 mg/kg if <50 kg) · Notes:
    single-visit total replacement preferred (ASH); hypophosphatemia 3.5%. [5][22]
- **Med-6 — Ferric carboxymaltose (Injectafer)** (on Step 2.5)
  - Role: second_line · Clinical role: `iv-iron-repletion`
  - Dose: 750 mg × 2 ≥7 days apart (total 1,500 mg) or single 15 mg/kg ≤1,000 mg · Notes:
    symptomatic hypophosphatemia 2.1%, osteomalacia postmarketing — check phosphate on
    repeat courses. [5][22]
- **Med-7 — LMW iron dextran (INFeD)** (on Step 2.5)
  - Role: acceptable · Clinical role: `iv-iron-repletion`
  - Dose: total-dose by formula; **boxed warning** anaphylaxis; mandatory 25 mg test dose;
    single-visit total-dose infusion exceeds the 100 mg/day label — flag for local policy. [5][22]
- **Med-8 — Folic acid 1 mg PO daily** (on Step 1.4)
  - Role: first_line · Clinical role: `folate-repletion` · For folate-deficiency
    macrocytic anemia (dominant macrocytic cause in US pregnancy). [1]
- **Med-9 — Cyanocobalamin (vitamin B12) 1,000 mcg IM monthly** (on Step 1.4)
  - Role: first_line · Clinical role: `b12-repletion` · ACOG's regimen is specified for
    **total** gastrectomy (checker-verified); no general oral high-dose regimen in
    fetched sources [GAP]. [1]
- **Med-10 — Docusate sodium 100 mg PO** (on Step 2.1)
  - Role: acceptable · Clinical role: n/a (non-conflicting adjunct — stool softener for
    iron-induced constipation). [13]
- **Med-11 — Enteric-coated / sustained-release iron preparations** (on Step 2.1)
  - Role: avoid · Clinical role: `oral-iron-repletion` (lane-tagged so the resolver flags
    cross-pathway substitution attempts) · "Dissolve poorly and may be less effective." [1]
- **Med-13 – Med-16 — IV iron, no oral trial** (on Step 2.10; v7): copies of Med-4 (iron
  sucrose), Med-5 (ferric derisomaltose), Med-6 (ferric carboxymaltose) and Med-7 (LMW iron
  dextran) — same dose, role, `clinical_role` `iv-iron-repletion`, codes and citations; one
  node per host step, so a gate closing Step 2.5 or Step 2.10 cannot take the other's
  medication. No ESCALATES_TO edges. [5][22]
- **Med-12 — Epoetin alfa** (on Step 3.10)
  - Role: acceptable · Clinical role: `esa-erythropoiesis`
  - Restricted context: transfusion-decliner optimization with parenteral iron (RCT:
    shortened time-to-target Hgb; not recommended for routine anemia). [1][17]

## 6. Lab tests

- **Lab-1 — CBC with indices** (on Steps 1.1, 2.3): LOINC 58410-2; venous blood;
  diagnosis-confirmation and response-monitoring anchor. [1]
- **Lab-2 — Ferritin, serum** (on Steps 1.2, 1.3, 1.8): LOINC 2276-4; IDA confirmation (<30
  ng/mL). [1]
- **Lab-3 — Iron + TIBC + saturation** (on Steps 1.2, 1.8): LOINC 2498-4 / 2500-7 / 2502-3;
  IDA vs ACD vs thalassemia discrimination (sat <18% = IDA). [1]
- **Lab-4 — Reticulocyte count** (on Steps 1.3, 2.2): LOINC 4679-7 (%); response marker
  7–10 d post-iron. [1]
- **Lab-5 — Vitamin B12, serum** (on Step 1.4): LOINC 2132-9. [1]
- **Lab-6 — Folate, serum** (on Step 1.4): LOINC 2284-8. [1]
- **Lab-7 — Hemoglobin electrophoresis** (on Steps 1.5, 1.6): LOINC 43113-0 (panel);
  solubility testing alone inadequate. [4]
- **Lab-8 — Peripheral blood smear** (on Steps 1.3, 1.5): morphology review; hemolysis/
  parasitic disease. LOINC 34994-4 (Smear morphology panel — verifier-corrected; 18314-5
  is the narrative-interpretation alternative if gating on a resulted read). [1]
- **Lab-9 — Type and antibody screen** (on Step 4.1): ABO/Rh LOINC 882-1 + antibody screen
  890-4; hemorrhage-bundle tie-in for anemic patients approaching delivery. [11]

`[BUILD FIX 2026-09-24]` **One host step per lab node (v4).** Lab-1, 2, 4, 7 and 8 were each
one node ordered by two steps on opposite sides of a gate or DecisionPoint. The engine
marks a node once (first-writer-wins), and a gate that closes sweeps its whole subtree at
once, so the shared lab took the status of whichever host was decided first. The care plan
lists only INCLUDED labs, so the test disappeared from the step that still ordered it. Seen
on the real engine: ferritin 50 + workup marked the Step 1.1 CBC GATED_OUT (via Step 2.3's
recheck), and a normocytic patient's ferritin, reticulocytes and smear were held with
DP-1's subtree — and with v4's gate-microcytic they would have been GATED_OUT outright.
Each crossing lab is now split, same test and codes, one node per host; the original keeps
its other host:

| Original | Stays on | New node | Moves to |
|---|---|---|---|
| Lab-1 CBC | Step 1.1 | **Lab-10** | Step 2.3 (Hgb/Hct recheck) |
| Lab-2 Ferritin | Step 1.2 | **Lab-11** | Step 1.3 |
| Lab-4 Reticulocytes | Step 2.2 | **Lab-12** | Step 1.3 |
| Lab-8 Smear | Step 1.5 | **Lab-13** | Step 1.3 |
| Lab-7 Hgb electrophoresis | Step 1.6 | **Lab-14** | Step 1.5 |
| Lab-2 Ferritin | Step 1.2 | **Lab-15** (v7) | Step 1.8 |
| Lab-3 Iron/TIBC/saturation | Step 1.2 | **Lab-16** (v7) | Step 1.8 |

The new nodes share the originals' CodeEntries (HAS_CODE) and citations; CodeEntries are
not projected into the care plan, so sharing them is harmless. Proof: `gate-proof.ts
shared-leaves` (both edge orders). The step lists above still read "on Steps X, Y" — each
step orders its own copy.

## 7. Imaging

None — no imaging is part of guideline-directed anemia-in-pregnancy workup. (Section
intentionally empty.)

## 8. Procedures

- **Proc-1 — RBC transfusion** (on Step 3.6): CPT 36430; reserved for Hgb <6 with fetal
  indication, hemorrhage, or operative context; requires type & screen/crossmatch. [1][11]

## 9. Guidance

All patient-facing content now attaches to the treatment and evaluation steps (the
prevention step left with the screening stage):

- **Guid-1 — topic "Eating for iron"** (on Step 2.1): category education. Instructions:
  full Block 1 text — 27 mg/day requirement; heme sources (lean beef, turkey, chicken,
  shrimp, clams, oysters; liver occasional); non-heme sources (fortified cereals, white/
  kidney beans, lentils, peas, spinach, nuts, raisins); pair plant iron with vitamin C
  (orange juice, grapefruit, strawberries, tomatoes, peppers, broccoli) or meat in the
  same meal; sample day pattern. [1][12]
- **Guid-2 — topic "What blocks iron"** (on Step 2.1): category education. Instructions:
  Block 2 — coffee/tea, dairy/calcium, soy, antacids reduce absorption; keep them ~2 h
  away from iron-focused meals and the iron pill; calcium supplements at a different time
  of day. [1][12][13]
- **Guid-3 — topic "Plant-based iron plan"** (on Step 2.1): category education.
  Instructions: Block 3 — plant iron absorbed ~5–12% vs 14–18% mixed diet; build meals
  around an iron source + vitamin C pairing; PNV daily; tell the care team about
  plant-based diet for closer lab surveillance. [1][12]
- **Guid-4 — topic "Making your iron pill work"** (on Step 2.1): category adherence.
  Instructions: Block 4 — morning empty-stomach dosing with OJ/vitamin C; snack if GI
  upset; 2-hour separation rules; dark stools normal; constipation plan incl. docusate;
  alternate-day schedule as planned option (hepcidin rationale, patient-level); response
  kinetics expectation-setting; keep the lab recheck. [5][13][14]
- **Guid-5 — topic "When to call us right away"** (on Step 1.1): category safety-netting.
  Instructions (v6, exact JSON text): "Review the urgent maternal warning signs (CDC Hear Her /
  AIM) with the patient and give her the handout; she should seek care immediately for any of
  them, and always say that she is pregnant (source:
  https://www.cdc.gov/hearher/maternal-warning-signs/index.html). Also ask whether she craves
  or eats non-food items (ice, clay, dirt, starch, paper, paint chips); this is common, so ask
  without judgement." [1][10]
  `[DECISION — Josh 2026-09-24]` **Reference the warning signs; do not include the list.** The
  CDC Hear Her list is credited to AIM, and AIM's current card prohibits any use of its content
  with an LLM. Through v5 this block reproduced an anemia-relevant subset of the AIM card's
  warning signs (cited to [10]), so it was derived from that list and falls under the decision:
  v6 names the list and its source and carries no list items. The pica disclosure prompt is not
  a warning sign and stays, reworded into the same clinician-facing voice. The existing
  citations ([1], [10]) are unchanged; the CDC URL is carried in the text.
- **Guid-6 — topic "Malabsorption on the chart: consider IV iron first"** (on Step 2.11; v8):
  category treatment-planning, clinician-facing. Instructions (exact JSON text): "The problem
  list carries a condition that reduces oral iron absorption (bariatric surgery, Crohn's
  disease or ulcerative colitis, celiac disease, short bowel syndrome or intestinal failure,
  postsurgical or unspecified intestinal malabsorption, or gastrectomy). This supports
  choosing IV iron without an oral trial at DP-3 (criterion 3c), most strongly after a
  malabsorptive bariatric procedure (e.g. Roux-en-Y gastric bypass) or with active
  inflammatory bowel disease; with quiescent IBD or a restrictive procedure an oral trial
  remains reasonable. IV iron is given from 14 0/7 weeks; before then, choosing IV first
  starts oral iron until 14 weeks." [8][18]

## 10. Quality metrics

[GAP — no national anemia-in-pregnancy quality measure exists: searched CMS eCQI (EH+EC),
Joint Commission PC set, HEDIS, MIPS/QPP, PQM, AIM DCP. Anemia appears only as a
risk-adjustment variable in ePC-07/CMS1028.] Local process measures encoded instead
(the screening-completion measure left with the screening stage):

- **QM-1 — Timely treatment-response assessment** (on Step 2.3): numerator = patients
  started on iron therapy with an Hgb recheck resulted within 6 weeks of initiation;
  denominator = patients started on iron therapy in this pathway. Steward: local
  (derived from the CDC 4-week recheck [3] with scheduling margin). [1][3]
- **QM-2 — Hemorrhage risk assessment with anemia input** (on Step 4.1): AIM HEM P3 —
  birth admissions with completed hemorrhage risk assessment (anemia is a scored factor);
  steward AIM/ACOG. [9][11]

## 11. Schedules

- **Sched-1** (on Step 2.2): interval "7–10 days after starting iron (optional)";
  reticulocyte check; absent reticulocytosis raises early nonresponse suspicion. [1]
- **Sched-2** (on Step 2.3): interval **"2–4 weeks after starting oral iron"**
  `[DECISION — Josh 2026-09-24]` (was "4 weeks", the CDC interval; 2 weeks is FIGO's
  response timepoint [6] — both ends are now encoded); Hgb/Hct recheck; a rise < 1 g/dL
  with Hgb still below the trimester target is nonresponse → Step 2.6 / DP-2 via
  gate-hgb-nonresponse (v7; §4b). Sched-3
  (post-IV-iron recheck, ~4 weeks) is deliberately unchanged — it is not the oral-iron
  response check. [1][3][6]
- **Sched-3** (on Step 2.5): interval "~4 weeks after IV iron"; Hgb recheck; persistent
  anemia → hematology referral / re-evaluate diagnosis. [1] [GAP: no formal US interval —
  evidence timepoint]
- **Sched-4** (on Step 4.1): interval "from diagnosis through delivery"; predelivery
  optimization checks; oral failure near term → IV iron (DP-2 after the trial; IDA
  diagnosed at ≥ 34 weeks goes straight to IV iron at DP-3, v7). [6][9][11]
- **Sched-6** (on Step 2.10; v7): copy of Sched-3 — "~4 weeks after IV iron"; Hgb recheck
  after IV iron given without an oral trial. [1]
- **Sched-5** (on Step 4.3): interval "once, ~6 weeks postpartum"; Hgb recheck + iron
  continuation; symptomatic/severe postpartum anemia → IV iron or transfusion pathway. [1][6]

## 12. Prerequisites (REQUIRES)

All pairs acyclic; REQUIRES points dependent → prerequisite:

- **Step 2.1 REQUIRES Step 1.1** — treatment requires diagnosis confirmation and
  classification (the empiric path still passes through evaluation). [1]
- **Step 2.3 REQUIRES Step 2.1** — response check requires initiation. [1][3]
- *(v7)* **Step 2.10 has no REQUIRES Step 2.2** — deliberately: it is IV iron without the
  oral trial (DP-3).
- **Step 2.5 REQUIRES Step 2.2** — IV iron requires an oral trial period (this edge is the
  `[BLOCKED — prior_node_result]` fallback from gate-iv-iron-ga; qualifying conditions
  (bariatric/IBD/late severe IDA) route via DP-2/stage-3 branches instead). [1][5]
- **Step 3.6 REQUIRES Step 4.1** — transfusion consideration requires verified type &
  screen (CMQCC admission logic). [11]
- **Step 4.3 REQUIRES Step 4.1** — postpartum handoff requires documented predelivery
  status. [9]

## 13. Code entries

| Code | System | Description | Attached to |
|---|---|---|---|
| 58410-2 | LOINC | CBC panel, automated | Lab-1, Lab-10 |
| 718-7 | LOINC | Hemoglobin [Mass/Vol] blood | Lab-1, Lab-10 |
| 4544-3 | LOINC | Hematocrit, automated | Lab-1, Lab-10 |
| 787-2 | LOINC | MCV, RBC | Lab-1, Lab-10 |
| 2276-4 | LOINC | Ferritin, serum | Lab-2, Lab-11, Lab-15 |
| 2498-4 | LOINC | Iron, serum | Lab-3, Lab-16 |
| 2500-7 | LOINC | TIBC | Lab-3, Lab-16 |
| 2502-3 | LOINC | Iron saturation | Lab-3, Lab-16 |
| 4679-7 | LOINC | Reticulocytes/100 RBC | Lab-4, Lab-12 |
| 2132-9 | LOINC | Vitamin B12, serum | Lab-5 |
| 2284-8 | LOINC | Folate, serum | Lab-6 |
| 43113-0 | LOINC | Hemoglobinopathy electrophoresis panel | Lab-7, Lab-14 |
| 34994-4 | LOINC | Smear morphology panel, blood | Lab-8, Lab-13 |
| 882-1 | LOINC | ABO+Rh type | Lab-9 |
| 890-4 | LOINC | RBC antibody screen | Lab-9 |
| 85025 | CPT | CBC with automated differential | Lab-1, Lab-10 |
| 82728 | CPT | Ferritin | Lab-2, Lab-11, Lab-15 |
| 83540 | CPT | Iron | Lab-3, Lab-16 |
| 83550 | CPT | TIBC | Lab-3, Lab-16 |
| 85045 | CPT | Reticulocytes, automated | Lab-4, Lab-12 |
| 82607 | CPT | B12 | Lab-5 |
| 82746 | CPT | Folate, serum | Lab-6 |
| 83020 | CPT | Hgb electrophoresis (83021 if lab uses HPLC method) | Lab-7, Lab-14 |
| 36430 | CPT | Transfusion, blood or components | Proc-1 |
| 310325 | RXNORM | ferrous sulfate 325 mg tablet | Med-1 |
| 198630 | RXNORM | ferrous gluconate 324 mg tablet | Med-2 |
| 284202 | RXNORM | ferrous fumarate 324 mg tablet | Med-3 |
| 1741261 | RXNORM | iron sucrose 20 mg/mL injection | Med-4, Med-13 |
| 2274409 | RXNORM | ferric derisomaltose 1,000 mg/10 mL [Monoferric] | Med-5, Med-14 |
| 1435169 | RXNORM | ferric carboxymaltose 750 mg/15 mL | Med-6, Med-15 |
| 206216 | RXNORM | iron-dextran 50 mg/mL [INFeD] | Med-7, Med-16 |
| 310410 | RXNORM | folic acid 1 mg tablet | Med-8 |
| 309594 | RXNORM | cyanocobalamin 1 mg/mL injection | Med-9 |
| Z98.84 | ICD-10 | Bariatric surgery status | Step 3.4 (gate-captured — attaches to branch target) |
| D57.3 | ICD-10 | Sickle cell trait | Step 3.3 (gate-captured) |
| D56.3 | ICD-10 | Thalassemia minor | Step 3.3 (gate-captured) |
| O09.40 | ICD-10 | Supervision of pregnancy with grand multiparity, unspecified trimester | Step 1.1 (risk-factor flag) |

All codes wave-2 verified — see §18 item 11.

## 14. Attribute-map registrations

**None needed.** All lab gates use coded-form conditions that match `labResults` by LOINC
directly, bypassing `pathway_attribute_code_map` entirely. The attribute conditions are all
`patient.*` — `patient.gestational_age_weeks` (gate-iv-iron-ga, 2026-09-24; gate-iv-iron-ga-direct, v7;
gate-oral-bridge-ga, v8) and, since v7,
`patient.trimester` (gate-hgb-response / gate-hgb-nonresponse) — which read
`patientAttributes` directly and need no code-map row. No `lab.*`/`allergy.*` attributes
are referenced anywhere in §4b.

## 15. Evidence citations

- **[1]** Anemia in Pregnancy: ACOG Practice Bulletin, Number 233 (Interim Update) — ACOG,
  Obstetrics & Gynecology 138:e55–64, 2021, evidence level **Level B** (contains Level
  A–C graded recommendations; grade cited per claim above),
  https://pubmed.ncbi.nlm.nih.gov/34293770/ (full text read via publisher-PDF mirror)
- **[2]** Screening and Supplementation for Iron Deficiency and Iron Deficiency Anemia
  During Pregnancy: USPSTF Recommendation Statement — USPSTF, JAMA 332(11):906–913, 2024
  (I statement), **Expert Consensus**,
  https://www.uspreventiveservicestaskforce.org/uspstf/recommendation/iron-deficiency-anemia-in-pregnant-women-screening-and-supplementation
- **[3]** Recommendations to Prevent and Control Iron Deficiency in the United States —
  CDC, MMWR 47(RR-3), 1998, **Expert Consensus** [OLDER SOURCE — remains ACOG PB 233's
  reference 1 and the operative follow-up algorithm; primary text 403-blocked, accessed
  via contemporaneous AAFP summary], https://www.aafp.org/pubs/afp/issues/1998/1015/p1475.html
- **[4]** Hemoglobinopathies in Pregnancy — Practice Advisory — ACOG, 2022, **Expert
  Consensus**,
  https://www.acog.org/clinical/clinical-guidance/practice-advisory/articles/2022/08/hemoglobinopathies-in-pregnancy
  — citation checker verified existence, universal-testing, electrophoresis-or-molecular,
  and partner-testing claims via corroborating sources (page itself bot-blocked, HTTP
  402). Two details could NOT be verified behind the paywall and need manual confirmation:
  the "reaffirmed Sept 2024" status and the "ferritin alongside electrophoresis" wording
  (the ferritin-discrimination logic independently stands on [1] Table 3).
- **[5]** Identifying and treating iron deficiency anemia in pregnancy — Lewkowitz &
  Tuuli, Hematology (ASH Education Program) 2023;2023(1):223–228, **Expert Consensus**,
  https://pmc.ncbi.nlm.nih.gov/articles/PMC10727057/
- **[6]** FIGO good practice recommendations on anemia in pregnancy — Ubom et al., Int J
  Gynecol Obstet 171:993–1007, 2025, **Expert Consensus** [FALLBACK SOURCE — international;
  used only where US guidance is silent: 2-week response variant, 4–6-week predelivery
  time-math, severity bands, postpartum durations],
  https://pmc.ncbi.nlm.nih.gov/articles/PMC12640178/
- **[7]** SMFM Consult Series #68: Sickle cell disease in pregnancy — SMFM, Am J Obstet
  Gynecol 2024;230(2):B17–B40 (online-first 2023), **Level B** (GRADE 1B for the
  iron/folate recommendation),
  https://publications.smfm.org/publications/547-society-for-maternal-fetal-medicine-consult-series-68/
- **[8]** AGA Clinical Practice Update on Management of Iron Deficiency Anemia: Expert
  Review — American Gastroenterological Association, 2024, **Expert Consensus**,
  https://pubmed.ncbi.nlm.nih.gov/38864796/
- **[9]** Obstetric Hemorrhage Change Package — IHI/AIM (© ACOG), **2022** (URL year is
  the upload path, accessed 2026), **Expert Consensus**,
  https://saferbirth.org/wp-content/uploads/2025_HEM_Change-Package.pdf
- **[10]** Urgent Maternal Warning Signs — ACOG/AIM, 2024, **Expert Consensus**,
  https://saferbirth.org/wp-content/uploads/UrgentMaternalWarningSigns_expanded.pdf
- **[11]** Obstetric Hemorrhage Care Guidelines: Checklist Format v1.4 — CMQCC, 2009,
  **Expert Consensus** [OLDER SOURCE — toolkit now V3.0 (2022), registration-gated; URL
  is a third-party mirror, quotes checker-verified verbatim — prefer a CMQCC-hosted copy
  if institutional access is available],
  https://tuohytime.com/wp-content/uploads/2024/07/hemorrhageprotocolchecklist_cmqcc.pdf
- **[12]** Iron — Fact Sheet for Health Professionals — NIH Office of Dietary Supplements,
  current, **Expert Consensus**, https://ods.od.nih.gov/factsheets/Iron-HealthProfessional/
- **[13]** Taking iron supplements — MedlinePlus/NLM, current, **Expert Consensus**,
  https://medlineplus.gov/ency/article/007478.htm
- **[14]** Iron absorption from oral iron supplements given on consecutive versus
  alternate days… — Stoffel et al., Lancet Haematology 4(11):e524–e533, 2017, **Level B**
  (RCTs, non-pregnant iron-depleted women), https://pubmed.ncbi.nlm.nih.gov/29032957/
- **[15]** The Efficacy and Safety of Vitamin C for Iron Supplementation in Adult
  Patients With Iron Deficiency Anemia — Li et al., JAMA Network Open, 2020, **Level B**
  (RCT, non-pregnant), https://pubmed.ncbi.nlm.nih.gov/33136134/
- **[16]** Guideline for the management of conception and pregnancy in thalassaemia
  syndromes: A British Society for Haematology Guideline — BSH, Br J Haematol
  204(6):2194–2209, 2024, **Level A** (GRADE 1A elements) [FALLBACK SOURCE — no US
  thalassemia-pregnancy guideline exists],
  https://onlinelibrary.wiley.com/doi/10.1111/bjh.19362 (citation-checker corrected: the
  originally recorded DOI 10.1111/bjh.19697 resolves to an unrelated article)
- **[17]** Management of Anemia and/or Bleeding in Patients Who Will Not Accept Blood
  Products — **Michigan Medicine clinical guideline** hosted on NCBI Bookshelf (checker
  reattributed; not StatPearls), 2024, **Expert Consensus**. Precision: ESAs recommended
  at Hgb <7.0; IV iron framed as adjunct to EPO at Hgb <8, not standalone.
  https://www.ncbi.nlm.nih.gov/books/NBK614548/
- **[18]** Pregnancy after bariatric surgery: Consensus recommendations — 2019, **Expert
  Consensus**, https://pmc.ncbi.nlm.nih.gov/articles/PMC6852078/
- **[19]** Bariatric Surgery and Pregnancy: ACOG Practice Bulletin No. 105 — ACOG, 2009,
  **Level C** [OLDER SOURCE; content verified via secondary restatement (ObG Project 2022)
  — acog.org paywalled], https://www.obgproject.com/2022/06/02/bariatric-surgery-and-pregnancy/
- **[20]** Hepcidin, ferroportin, and hemoglobin as predictors of IDA risk in twin
  pregnancy — 2025, **Level C** (cohort),
  https://pmc.ncbi.nlm.nih.gov/articles/PMC12682790/
- **[21]** Ironing Out the Details: How to Manage Anemia in Pregnancy in Women Living
  With CKD — Kidney International Reports, 2024, **Expert Consensus** [FALLBACK SOURCE —
  scope-out rationale only], https://pmc.ncbi.nlm.nih.gov/articles/PMC11069003/
- **[22]** FDA Prescribing Information via DailyMed: Venofer (iron sucrose), Injectafer
  (ferric carboxymaltose), Monoferric (ferric derisomaltose), INFeD (iron dextran) — FDA/
  NLM, current, **Expert Consensus** (regulatory labeling; setid URLs in research notes),
  https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=55859d2d-0456-4fa9-b41f-f535accc97db

## 16. Citation map

Nodes that can carry CITES_EVIDENCE:

- Stage 1: [1][4] · Stage 1.5: [1][5] · Stage 2: [1][5] · Stage 3: [1][7][8] · Stage 4: [1][9][11]
- Step 1.1: [1][2][3][10] · Step 1.2: [1][5] · Step 1.3: [1] · Step 1.4: [1]
  · Step 1.5: [1][4] · Step 1.6: [4] · Step 1.7: [1] · Step 1.8: [1][4][7]
- Step 2.1: [1][5][13][14] · Step 2.2: [1] · Step 2.3: [1][3] · Step 2.4: [3]
  · Step 2.5: [1][5][7][22] · Step 2.6: [1][3][6] · ~~Step 2.7~~ (removed in v7)
- Step 3.1: [7] · Step 3.2: [16] · Step 3.3: [1][4][7] · Step 3.4: [8][18][19]
  · Step 3.5: [8] · Step 3.6: [1][11] · Step 3.7: [3] · Step 3.8: [1][20] · Step 3.9: [21]
  · Step 3.10: [1][17]
- Step 4.1: [9][11] · Step 4.2: [1][6] · Step 4.3: [1][6][9]
- DP-1: [1] · Criteria 1a/1b: [1] · DP-2: [1] · Criteria 2a: [1][5], 2b: [1][8], 2c: [1]
  · DP-3 (v7): [1][6] · Criteria 3a: [1], 3b: [1][5], 3c: [1][8], 3d: [6][1]
- Stage 2.5 (v7): [1][5] · Stage 2.6 (v8): [1][5] · Step 2.8: [1][5][6] · Step 2.9: [1][5][6][8] · Step 2.10:
  [1][5][7][22]
- Meds: Med-1: [1][5][13][14][15] · Med-2, Med-3: [1] · Med-4–Med-7, Med-13–Med-16: [5][22] · Med-8,
  Med-9: [1] · Med-10: [13] · Med-11: [1] · Med-12: [1][17]
- Labs: Lab-1, Lab-10: [1] · Lab-2, Lab-11, Lab-15: [1][5] · Lab-3, Lab-16: [1] · Lab-4, Lab-12: [1] · Lab-5, Lab-6: [1]
  · Lab-7, Lab-14: [4] · Lab-8, Lab-13: [1] · Lab-9: [11]
- Proc-1: [1][11] · Guid-1: [1][12] · Guid-2: [1][12][13] · Guid-3: [1][12]
  · Guid-4: [5][13][14] · Guid-5: [1][10] · Guid-6 (v8): [8][18]
- Step 2.11 (v8): [1][8][18][19]

Cannot cite (evidence attaches to host step — builder must reattach): all Gates → their
attached Stage/Step per §4b rationale refs; QM-1 → Step 2.3 [1][3]; QM-2 → Step 4.1
[9][11]; Sched-1–5 → their host steps ([1][3][6][9][11] per §11); CodeEntries → none.

## 17. Temporal horizon & status summary (EMITTED — review carefully)

The temporal-horizon kernel is merged; these assignments are emitted directly into the
gate conditions. The named-horizon grammar has no "current pregnancy" concept, so
pregnancy-scoping uses `{days: 90}` (≈ trimester — a stale pre-pregnancy or
prior-trimester lab must not drive classification) and `{days: 300}` (≈ full pregnancy +
margin). **These day-counts are my proposal — review.**

| Gate | Condition on | horizon | status | window_days | Rationale |
|---|---|---|---|---|---|
| gate-microcytic / normocytic / macrocytic (gate-microcytic restored in v4) | labs 787-2 (MCV) | {days: 90} | — | — | Classification must reflect the anemia being worked up, not an old chart value |
| gate-ida-confirmed | labs 2276-4 (ferritin) | {days: 90} | — | — | Confirmatory ferritin from this workup |
| gate-hgb-response / gate-hgb-nonresponse | labs 718-7 Δ (`delta_from_baseline`) | — (`window_from` *is* the window: oral-iron start → clock, + latest Hgb ≤ 28 d before the start) | — | — | v7 — anchored to the treatment start, so the pre-treatment state is out by construction; due at day 14 |
| gate-hgb-response / gate-hgb-nonresponse | labs 718-7 (at-target arm) | {days: 28} | — | — | The current Hgb, not last trimester's |
| gate-hgb-response / gate-hgb-nonresponse | `patient.trimester` | — (`patient.*` has no temporal policy) | — | — | Derived from GA by the resolver |
| gate-severe-anemia | labs 718-7 (Hgb) | {days: 7} | — | — | Hgb <6 is an acute finding; only a current value justifies transfusion routing |
| gate-referral-threshold | labs 718-7, 4544-3 | {days: 90} | — | — | Referral on current-pregnancy values |
| gate-multi-gestation | O30.* | {days: 300} | active | — | A *prior* pregnancy's twin code must not fire this pregnancy's surveillance branch |
| gate-scd / gate-thal-major / gate-trait | D57.* / D56.* | LIFETIME | any | — | Genetic conditions never expire |
| gate-empiric-no-hgbpathy (`not_includes_code`, v8; on gate-microcytic in v7) / gate-hgbpathy-microcytic (`includes_code`) | D57.0.*, D57.1, D57.2.*, D57.4.*, D57.8.*, D56.0/.1/.2/.5/.8/.9, D58.2 | LIFETIME | any | — | Genetic; `any` also makes `not_includes_code` never indeterminate (a code with an undecidable state is a definite match) |
| gate-bariatric | Z98.84, O99.84.* | LIFETIME | any | — | Anatomy is permanent |
| gate-ibd | K50.*, K51.* | LIFETIME | any | — | Chronic relapsing disease stays gate-relevant |
| gate-malabsorption-chart (v8) | Z98.84, O99.84.*, K50.*, K51.0/.2/.3/.5/.8/.9.*, K90.0, K90.82.*, K90.83, K90.9, K91.2, Z90.3 | LIFETIME | any | — | Chronic or anatomical; same reading as gate-bariatric / gate-ibd |
| gate-ckd | N18.*, O26.83.* | LIFETIME | active | — | Route out only on standing CKD; a resolved/erroneous historical code shouldn't exile the patient from the pathway |

Kernel semantics reviewers should know: windows/horizons select on a fact's **start
bound**; undated labs can satisfy membership but never join trend/delta series; unprovable
temporal state propagates as uncertainty → the gate resolves per its default_behavior
(all defaults in §4b were chosen with that in mind — every horizon-scoped gate defaults
`skip`, so stale/missing data omits optional content rather than inventing it; the one
`traverse` default, gate-ida-confirmed, was meant to keep treatment reachable when
ferritin is absent — `[BUILD FIX]` it also kept it reachable when ferritin was normal, so it
is now `skip` + `on_unresolved: ask`; see §4b).

## 18. Gaps & fallbacks

1. `[GAP]` **ACOG PB 233 contains no numeric therapeutic oral-iron dose and no
   alternate-day recommendation** — despite widespread secondary claims. Dosing encoded
   from restatements (ObG Project BID; ASH 60–65 mg 1–3×/day); alternate-day framed as
   tolerability option (Stoffel evidence, non-pregnant; ASH: not yet US-recommended in
   pregnancy). Reviewer decision: confirm preferred default dosing line.
2. `[GAP]` **No predelivery Hgb target** in any fetched US source (CMQCC: "desired
   Hgb/Hct" without a number).
3. `[GAP]` **No formal post-IV-iron recheck interval** (4 weeks = evidence timepoint).
4. `[GAP]` **No national anemia-in-pregnancy quality measure** — QM-1/QM-2 are local
   process measures.
5. `[GAP]` **CDC 1998 primary text unreachable** (403 on every route incl. archives);
   trimester thresholds cross-verified via ACOG + two state-WIC reproductions; the
   4-week recheck, 60–120 mg treatment dose, and 9.0/27 referral rule rest on the
   contemporaneous AAFP summary. Do not publish CDC mg figures without re-fetching MMWR
   47(RR-3).
6. `[GAP]` **Referral threshold (Hgb <9.0/Hct <27) is CDC/IOM, not ACOG** — ACOG names no
   numeric referral or IV-iron threshold; "severe iron deficiency later in pregnancy" is
   undefined in PB 233.
7. **Severity-band conflict**: ACOG's only numeric severe threshold is <6 g/dL
   (transfusion/fetal); FIGO uses <7.0 for "severe." Encoded ACOG.
8. **Ferritin-cutoff conflict**: ACOG <30 vs WHO <15 vs USPSTF "no consensus." Encoded 30.
9. `[FALLBACK SOURCE]` FIGO 2025 (predelivery time-math, 2-week response variant — now
   the lower end of the 2–4-week recheck, `[DECISION — Josh 2026-09-24]` — postpartum
   durations); BSH 2024 thalassemia (no US equivalent); KI Reports 2024 (CKD
   scope-out rationale).
10. `[BLOCKED — prior_node_result]` gate-iv-iron-ga's oral-trial dependency → fallback:
    REQUIRES edge (§12) + DP-2 routing. Upgrade when validator fix lands.
11. **Wave-2 code verification: COMPLETE.** All ICD-10 codes and wildcard family scopes
    verified (NLM ICD-10-CM table; D57/D56/K50-51/N18/O26.83/O30 child lists fetched); all
    14 LOINC codes verified (NLM LOINC table) with **one correction applied** — smear
    58445-8 was wrong ("manual differential comment"), replaced with 34994-4 (smear
    morphology panel); all 9 CPT codes verified against CMS official descriptors
    (secondary — CPT is proprietary); all 9 RXCUIs verified via RxNav allProperties.
    Advisory notes folded into §4b (D56.4 exclusion documented, K51.4x sweep accepted)
    and §13 (83021 HPLC alternative).
12. `[GAP]` ACOG PB 231 (multifetal) direct text paywalled — twins-iron claim rests on
    [20] + secondary restatements.
13. `[GAP]` No US thalassemia-trait-specific "no empiric iron" statement — citable chain
    is ACOG PA 2022 (ferritin alongside electrophoresis) + PB 233 Table 3 + SMFM #68's SCD
    analogue.
14. `[GAP]` Short interpregnancy interval has no ICD-10 code — risk-factor flag only
    (Step 1.1); no dedicated gate.
15. **Wave-2 citation verification: COMPLETE.** 18/22 clean PASS, 3 PASS-with-notes
    (folded in above), 1 FAIL corrected: [16] BSH thalassemia guideline DOI was wrong
    (pointed at unrelated correspondence) — replaced with verified 10.1111/bjh.19362.
    Remaining manual confirmations for the reviewer: [4]'s "reaffirmed Sept 2024" status
    and ferritin-alongside wording (ACOG page bot-blocked); CDC MMWR 47(RR-3) primary
    text (item 5). Every ACOG PB 233 clinical claim in this brief was verified verbatim
    against fetched full text.
16. **v2 restructure (reviewer-directed, 2026-08-16):** screening removed — the pathway
    begins at the coded diagnosis. Dropped: the screening/prevention stage and its two
    steps, gates anemia-t1/t2/t3 and high-hgb, the repeat-screen schedule, the
    screening-completion metric, and the `patient.trimester` attribute dependency.
    Trimester diagnostic criteria survive as confirmation content in Step 1.1; USPSTF [2]
    retained for risk-factor individualization context only; QM-1 replaced with a
    treatment-response measure.
17. **v3 re-authoring (simulator-visibility fix, 2026-08-16):** all six lab-threshold
    gates converted from attribute-form (`lab.*`) to coded-form conditions, and the
    gestational-age gate converted to a question gate. Root causes, proven by running the
    real gate evaluator against simulator-style patient context: (a) the dashboard's
    "Fields this pathway reads" panel harvests attribute-form conditions into a list it
    never renders; (b) the simulator composer never sends `patientAttributes`, so
    `patient.*` gates are unsettable; (c) attribute-form evaluation requires
    `pathway_attribute_code_map` rows with no seeding path — unseeded, gates resolve
    "attribute has no value" and silently fall back to `skip`. Coded-form conditions
    avoid all three. §14 is now empty. Normocytic band uses 79.9/100.1 strict boundaries
    (coded operators lack ≥/≤). Revert candidates when the dashboard/platform catch up.

### ~~`[GAP — NEEDS JOSH]` v4 open item — escalation is not conditioned on nonresponse~~ — RESOLVED (v5)

`[DECISION — Josh 2026-09-24]` **Escalation only after non-response.** `gate-hgb-response`
is now a SELECT question router on Step 2.3 (the 2–4-week recheck: "responding" = Hgb
risen ≥1 g/dL since starting oral iron → Step 2.4 maintenance; "not responding" → Step
2.6 Nonresponse management, the only host of DP-2; "recheck not yet done" → Step 2.7, so
the start visit can finish), so the expanded workup and IV iron (GA ≥ 14) wait for "not
responding". DP-2's
single-branch shape is unchanged. ~~`[INTERIM — switch to window_from]`~~ **Switched in
v7** `[DECISION — Josh 2026-09-24]`: `gate-hgb-response` / `gate-hgb-nonresponse` now read
an Hgb rise anchored to the oral-iron start (`window_from`, `delta_comparison`, due at day
14) or the trimester target, and a missing recheck asks (§4b).
Proved with `gate-proof.ts response`. The original note follows for the record.

Found while proving the empiric arm's follow-up (v4); pre-existing on the confirmed arm,
and now shared by both. DP-2 ("Nonresponse management") has a single BRANCHES_TO, to Step
1.5 (expanded workup) — criteria 2a, 2b and 2d have no branch of their own — so the
one_of fork takes it automatically whenever Step 2.3 is reached. Step 2.5 (IV iron)
hangs from DP-2 through `gate-iv-iron-ga` alone. So at the moment oral iron starts, the
session already INCLUDES the expanded workup and, at GA ≥ 14, IV iron — before any
recheck. `gate-hgb-response` decides only Step 2.4 (maintenance); a responder and a
nonresponder differ only there. The §4 design (criteria 2a/2b → Step 2.5 as DP-2
branches) would make DP-2 a real choice and put IV iron behind it; that is a structural
change for review, not made here. Related: Sched-2 times the recheck at **4 weeks** after
starting oral iron (CDC; ACOG gives no interval); FIGO's 2-week variant (§18 item 9) is
not encoded. Left as-is.

### `[DECISION — Josh 2026-09-24]` Hemoglobinopathy disease suppresses the empiric-iron arm — ENCODED (v7); confirmed deficiency reaches iron (v8)

**Built (v7).** `not_includes_code` landed on josh-dev (3f29f2c). **Code set** (verified
against the NLM ICD-10-CM table 2026-09-24): SCD — `D57.0.*` (Hb-SS with crisis), `D57.1`,
`D57.2.*` (Hb-SC), `D57.4.*` (sickle-cell thalassemia incl. β0/β+), `D57.8.*`; thalassemias —
`D56.0`, `D56.1`, `D56.2`, `D56.5`, `D56.8`, `D56.9`; **`D58.2`** "Other hemoglobinopathies"
(HbC / HbE disease, hemoglobinopathy NOS) `[DECISION — Josh 2026-09-24]` — included.
**Excluded:** traits `D57.3` and `D56.3` `[DECISION — Josh 2026-09-24]` (disease only —
carriers keep the empiric option, and Step 3.3 still applies), and `D56.4` HPFH (benign, as
in gate-thal-major).

~~`[OPEN — NEEDS JOSH]` **A ferritin-confirmed hemoglobinopathy-disease patient does not
reach the Stage 2 iron arm.**~~ **Resolved in v8** `[DECISION — Josh 2026-09-24]`:
"hemoglobinopathy disease + iron deficient by tests → normal iron supplementation (only the
empiric arm is skipped)". v7 split the patients in front of DP-1 with two chart gates
(gate-microcytic: MCV < 80 AND no disease → DP-1; gate-hgbpathy-microcytic: MCV < 80 AND
disease → Step 1.8), and Step 1.8 could not lead into Stage 2: a closing gate's sweep spares
nothing, so a second route into Step 1.2 / Stage 2 lost Stage 2 in both edge orders.
v8 moves the split **behind DP-1's empiric branch** (§4 DP-1, §4b): DP-1's own sweep of the
unchosen branch spares the chosen branch's contents, so the confirmatory branch (Step 1.2
→ ferritin → Stage 2) serves every patient, and only the empiric branch checks the codes.
Proved with `gate-proof.ts hgbpathy` (both edge orders): D57.1 / D57.00 / D57.40 / D56.1 /
D58.2 + MCV 72 + ferritin 12 + confirmatory studies → Stage 2, DP-3 and the oral trial
INCLUDED, the empiric arm EXCLUDED; ferritin 50 → no iron; empiric chosen → no empiric iron,
Step 1.8 iron studies; traits and uncoded patients unchanged.

`[CLINICAL AMBIGUITY — for Josh]` **The cost: DP-1 is asked again for disease patients.** A
patient with SCD, a thalassemia syndrome or HbC/HbE disease and MCV < 80 is asked "Empiric
iron vs confirmatory studies first"; the empiric option (titled "… not with hemoglobinopathy
disease", and criterion 1a says so) opens only iron studies (Step 1.8). A DecisionPoint's
options are the branches that score ≥ 0.60, and branch scores do not read the patient, so no
JSON can drop the empiric option for her.

**Engine change that would hide DP-1 again for disease patients** (not made — `apps/` is out
of scope for this build): give a closing gate's sweep a structural `spare`, as DecisionPoint
and question-router sweeps already have. Precisely: when a gate closes, `markSubtree` must
not write (or descend through) a node that has a containment parent **outside** the gate's
own containment closure — such a node is reachable by another route, which is left to
dispose it; then a post-walk pass marks GATED_OUT any node so spared that no route opened
(with the closing gate's reason), so the session's node set stays complete. The spare must
be structural ("has a containment parent outside this closure"), not "is on another open
route": a sibling gate may be disposed later in the same BFS, so whether the other route
opens is unknowable when the sweep runs. `decidersOf` (incremental re-entry) would then have
to treat such a node as decided by more than one gate, and `incremental-full-agreement`
would need a scenario for it. With that, v7's shape (disease split in front of DP-1) plus a
Step 1.8 → ferritin route into Stage 2 would work, and DP-1 could be hidden again.

History (v5/v6): blocked on the engine — no coded operator could negate a membership test,
DP-1's branch qualification comes from DB-seeded confidence, and a question-gate negative
arm asks instead of reading codes. `gate-proof.ts hgbpathy` then recorded the exposure
(D56.3, D57.3, D56.1, D57.40 + MCV 72 were offered empiric iron; D57.40 choosing empiric
got ferrous sulfate alongside the SCD route-out). The v5/v6 note follows.

~~`[GAP — NEEDS JOSH]`~~ **Hemoglobinopathy patients reach the empiric arm.** Thalassemia
minor and microcytic SCD variants (e.g. HbS-β-thalassemia) have MCV < 80, so
gate-microcytic offers them DP-1, and nothing in Stage 3 closes DP-1 or Stage 1.5 when
gate-scd or gate-trait fires. Step 3.1 calls the iron arm "affirmatively wrong for SCD",
and Step 3.3 allows iron only with ferritin-confirmed deficiency. v3 exposed these
patients to Step 2.1 alone; v4's empiric arm also includes the trial period, recheck and
IV-iron route. Should a hemoglobinopathy code suppress the empiric option (e.g. a gate on
Stage 1.5)? Not changed here.

### `[BUILD FIX 2026-09-24]` On unresolved — RESOLVED

`[DECISION — Josh 2026-09-24]` **Resolved as a general rule: numeric gates ask when the
value is missing.** Every gate listed below keeps `on_unresolved: ask`; no JSON change.
This is no longer a per-gate question for review — the rule is in the format spec, the
brief template and the builder's gate-control lint, and a numeric gate may take `default`
only with an `[ON-UNRESOLVED DEFAULT — <gate-id>]` justification in this brief (there is
none). The original note follows for the record.

Main (PR #55) added a per-gate `on_unresolved` (ask | default) that this brief predates.
It decides what a gate does when its lab/vital value is **missing or ambiguous**: `ask`
holds the gated subtree and asks the provider for the value; `default` treats it like
"no" and applies the default behavior. Absent means `ask`, so the JSON now states `ask`
explicitly on every gate with a threshold — **no behaviour change** — pending review:
gate-microcytic, gate-normocytic, gate-macrocytic (MCV), gate-ida-confirmed (ferritin), gate-hgb-response (Hgb — v5: now a question gate, no `on_unresolved`), gate-severe-anemia (Hgb), gate-referral-threshold (Hgb, Hct). Gates with only code/history conditions carry `default`, which is what the
engine does for them anyway. Lab conditions also carry a `display` (name + unit) so the
missing-value question is readable.

### `[BUILD FIX 2026-09-24]` Simulator-untestable: the response check's rise arm (v7)

**v7 — applies again, in a new form.** The simulator stores no care plans and dates nothing,
and Step 2.1's oral iron is recommended in every session that reaches Step 2.3, so the
oral-iron anchor is always *this session*: both response gates close **NOT YET DUE** in the
simulator, whatever Hgb values are entered. Only the at-target arm (an undated Hgb ≥ 11, or
≥ 10.5 in trimester 2) can decide there, and it opens maintenance; **non-response (Step 2.6,
DP-2, IV iron after non-response) cannot be reached from the simulator.** Exercise it
through the API with a dated Hgb series and a stored care plan or dated oral-iron order —
`gate-proof.ts response` does exactly that. (A clinician-entered start date would also
anchor it, but an undated series still has no points.) Since `engine-recheck-anchor` (v8
branch): a synthetic patient whose medication list already holds an oral iron of the class
(undated — "on it since an unknown date") is asked "When did oral iron start?" instead; an
undated Hgb never counts as ≥ 14 days old, so it does not trigger the question.

*v5/v6:* `gate-hgb-response` was a question gate with no trend arms. The v4 note follows.

The encounter simulator sends no dates. The three `trend_up` arms need at least two
**dated** hemoglobin values, so they never fire from the simulator (one undated value: not
met; two or more: unorderable, and the gate asks for a hemoglobin instead). Only the
absolute-target arm (Hgb > 10.9 within 90 days) is exercisable there. Test the trend arms
with dated labs (API or seeded data), not the composer.
