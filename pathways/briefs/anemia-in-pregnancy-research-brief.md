# Pathway Research Brief — Anemia in Pregnancy

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

---

## 1. Pathway metadata

- **Logical ID**: `anemia-in-pregnancy`
- **Title**: Anemia in Pregnancy — Classification and Treatment
- **Version**: 3 `[DECISION — Josh 2026-09-24]` (JSON `"3"`; was `"2"`). Bumped for the DP-1
  restoration, gate-microcytic removal and the gestational-age data gate — imports as
  NEW_VERSION.
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
- **Stage 2 — Iron Deficiency Treatment** *(branch-entry only, via gate-ida-confirmed and
  DP-1)*: oral iron first line with counseling, response assessment, IV iron escalation. [1][5][7]
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
  only MCV < 80 fL reaches this choice — see Step 1.7 and §4b)*: indicated for microcytic
  anemia (MCV < 80 fL). Ferritin (±iron/TIBC/
  saturation). Ferritin <30 ng/mL confirms IDA; sat <18% + ↑TIBC + ↓ferritin = IDA;
  all-normal iron studies → suspect thalassemia → Step 1.5. [1][5]
- **Step 1.3 — Normocytic workup** *(gated by gate-normocytic)*: ferritin (early iron
  deficiency), reticulocytes, smear as directed. [1]
- **Step 1.4 — Macrocytic workup & repletion** *(gated by gate-macrocytic)*: serum folate
  + B12 (MCV >115 fL almost exclusively folate/B12); treat per §5. [1]
- **Step 1.5 — Expanded / nonresponse workup** *(gated via DP-2)*: smear, hemoglobin
  analysis + genetic testing per indices/history, malabsorption and blood-loss review. [1][4]
- **Step 1.6 — Hemoglobinopathy testing** *(gated by gate-hgbpathy-needed)*: hemoglobin
  electrophoresis or molecular testing when no prior results are available; carrier →
  partner testing → both carriers → genetic counseling. [4]
- **Step 1.7 — Microcytic anemia: iron strategy** *(gated by gate-microcytic — its only
  way in)* `[DECISION — Josh 2026-09-24]`: hosts DP-1 (empiric oral iron vs confirmatory
  iron studies first). Exists because a gate can only guard a Step or Stage, and DP-1
  must hang from a Step. Numbered 1.7 to keep existing step ids stable, although it
  follows Step 1.1 logically. [1]
- **Step 2.1 — Initiate oral iron + counseling**: therapeutic oral iron in addition to
  the prenatal vitamin (ACOG Level B; the PNV's 27 mg prophylactic iron is not treatment
  dosing); avoid enteric-coated/sustained-release; dietary and adherence Guidance
  attached here. [1][5][12][13][14]
- **Step 2.2 — Oral iron trial period**: expected reticulocytosis 7–10 days; optional
  retic check. [1]
- **Step 2.3 — Response assessment**: Hgb recheck ~4 weeks after initiation (CDC; ACOG
  gives no numeric interval [GAP]); adequate = rise >1 g/dL. [1][3]
- **Step 2.4 — Maintenance & surveillance** *(gated by gate-hgb-response)*: continue iron,
  reduce to prophylactic dosing when normalized for gestational stage (CDC). [3]
- **Step 2.5 — IV iron therapy** *(gated: DP-2 routing + gate-iv-iron-ga)*: for
  intolerance/nonresponse/severe iron deficiency later in pregnancy; after the first
  trimester; single-total-dose formulations preferred. [1][5][7]
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
- **Step 4.2 — Delivery planning route selection**: hosts DP-3. [1][6]
- **Step 4.3 — Postpartum handoff**: postpartum Hgb recheck (6-week evidence timepoint);
  continue iron "at least 3 months or 6 weeks postpartum, whichever is longer" (FIGO
  wording, checker-verified); IV iron option postpartum; risk communication on
  transition. [1][6][9]

Branch-entry-only stage: Stage 2 (entered via gate-ida-confirmed and DP-1). Stage 1 is
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
  - Criterion 1a: No evidence of causes other than iron deficiency → empiric oral iron
    reasonable without iron studies (ACOG) → **Step 2.1** [1]
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
    Stage 2 opens. Choosing **empiric**: Step 2.1 is included and Step 1.2 excluded. Oral
    iron is never automatic unless confidence scoring puts Step 1.2 below the 0.60
    suggest threshold while Step 2.1 stays above it (only a per-node DB weight override
    or admin evidence entry could do that).
  - `[DECISION — Josh 2026-09-24]` [SECOND ROUTE — step-2-1 via dp-1] Step 2.1 sits in
    Stage 2, which `gate-ida-confirmed` gates, but criterion 1a reaches it directly: empiric
    oral iron without iron studies is ACOG-sanctioned, so this second route is deliberate.
  - `[GAP — NEEDS JOSH]` **The empiric arm reaches Step 2.1 only.** Choosing empiric
    EXCLUDES Step 2.2 (trial period), Step 2.3 (response assessment), DP-2 and Step 2.5
    (IV iron): they hang from Stage 2, which only the ferritin gate opens. So an
    empirically treated patient gets no response check and no escalation route. Fixing it
    means routing criterion 1a to a container holding 2.1–2.3 rather than Step 2.1 alone
    — a structural change to the brief's mapping, left for review.
- **DP-2 — Nonresponse management** (after Step 2.3) — branch_mode: one_of
  - Criterion 2a: Intolerance or nonadherence despite coaching → **Step 2.5** (IV iron) [1][5]
  - Criterion 2b: Suspected malabsorption (enteric-coated tabs, antacids, bariatric,
    IBD) → **Step 2.5** (IV iron) [1][8]
  - Criterion 2c: Suspected incorrect diagnosis or blood loss → **Step 1.5** (expanded
    workup) [1]
- **DP-3 — Predelivery route selection** (after Step 4.2) — branch_mode: one_of
  - Criterion 3a: Adequate time for oral repletion and responding → continue oral →
    **Step 2.4** [1]
  - Criterion 3b: Moderate–severe IDA within ~4–6 weeks of anticipated delivery, or oral
    failure near term → **Step 2.5** (IV iron) [6] [FALLBACK SOURCE — FIGO time-math; ACOG
    says only "severe iron deficiency later in pregnancy"] [1]

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
  rewired)*
  - Attached to: step-1-1 · Branches to: **step-1-7** (DP-1's host — was step-1-2 through
    v2) · patient_attribute · Default: **skip** · On unresolved: **ask**
  - Condition (coded): field `labs`, less_than, value `787-2` (MCV, LOINC), threshold 80,
    display "MCV (fL)", horizon {days: 90} (same as gate-normocytic / gate-macrocytic) [1]
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
- **Gate `gate-hgb-response` — Hgb rise ≥1 g/dL on therapy** *(time-shape)*
  - Attached to: step-2-3 · Branches to: step-2-4 · patient_attribute (coded condition) ·
    Default: skip (no response data ⇒ stay in assessment/DP-2 path)
  - Condition: field `labs`, operator `delta_from_baseline`, value `718-7` (Hgb, LOINC),
    system LOINC, delta_threshold 1.0, window_days 42, min_points 2
  - Rationale: ACOG response definition (>1 g/dL rise); 42-day window spans initiation →
    4-week recheck with margin. [1][3]
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
  - Escalates to: Med-5 (ferric derisomaltose) · Notes: avoid enteric-coated/SR forms;
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
- **Med-12 — Epoetin alfa** (on Step 3.10)
  - Role: acceptable · Clinical role: `esa-erythropoiesis`
  - Restricted context: transfusion-decliner optimization with parenteral iron (RCT:
    shortened time-to-target Hgb; not recommended for routine anemia). [1][17]

## 6. Lab tests

- **Lab-1 — CBC with indices** (on Steps 1.1, 2.3): LOINC 58410-2; venous blood;
  diagnosis-confirmation and response-monitoring anchor. [1]
- **Lab-2 — Ferritin, serum** (on Steps 1.2, 1.3): LOINC 2276-4; IDA confirmation (<30
  ng/mL). [1]
- **Lab-3 — Iron + TIBC + saturation** (on Step 1.2): LOINC 2498-4 / 2500-7 / 2502-3;
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
  Instructions: Block 5 — AIM urgent maternal warning signs relevant to anemia (chest
  pain/pressure or radiating pain, racing/irregular heartbeat, trouble breathing or
  orthopnea, fainting or recurrent dizziness, unrelenting exhaustion); always state
  pregnancy; pica disclosure prompt (ice, clay, dirt, starch, paper, paint chips) with
  no-judgment framing. [1][10]

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
- **Sched-2** (on Step 2.3): interval "4 weeks after starting oral iron"; Hgb/Hct recheck;
  rise ≤1 g/dL despite adherence → DP-2 (CDC interval; FIGO 2-week variant noted). [1][3][6]
- **Sched-3** (on Step 2.5): interval "~4 weeks after IV iron"; Hgb recheck; persistent
  anemia → hematology referral / re-evaluate diagnosis. [1] [GAP: no formal US interval —
  evidence timepoint]
- **Sched-4** (on Step 4.1): interval "from diagnosis through delivery"; predelivery
  optimization checks; oral failure near term → IV iron (DP-3). [6][9][11]
- **Sched-5** (on Step 4.3): interval "once, ~6 weeks postpartum"; Hgb recheck + iron
  continuation; symptomatic/severe postpartum anemia → IV iron or transfusion pathway. [1][6]

## 12. Prerequisites (REQUIRES)

All pairs acyclic; REQUIRES points dependent → prerequisite:

- **Step 2.1 REQUIRES Step 1.1** — treatment requires diagnosis confirmation and
  classification (the empiric path still passes through evaluation). [1]
- **Step 2.3 REQUIRES Step 2.1** — response check requires initiation. [1][3]
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
| 2276-4 | LOINC | Ferritin, serum | Lab-2, Lab-11 |
| 2498-4 | LOINC | Iron, serum | Lab-3 |
| 2500-7 | LOINC | TIBC | Lab-3 |
| 2502-3 | LOINC | Iron saturation | Lab-3 |
| 4679-7 | LOINC | Reticulocytes/100 RBC | Lab-4, Lab-12 |
| 2132-9 | LOINC | Vitamin B12, serum | Lab-5 |
| 2284-8 | LOINC | Folate, serum | Lab-6 |
| 43113-0 | LOINC | Hemoglobinopathy electrophoresis panel | Lab-7, Lab-14 |
| 34994-4 | LOINC | Smear morphology panel, blood | Lab-8, Lab-13 |
| 882-1 | LOINC | ABO+Rh type | Lab-9 |
| 890-4 | LOINC | RBC antibody screen | Lab-9 |
| 85025 | CPT | CBC with automated differential | Lab-1, Lab-10 |
| 82728 | CPT | Ferritin | Lab-2, Lab-11 |
| 83540 | CPT | Iron | Lab-3 |
| 83550 | CPT | TIBC | Lab-3 |
| 85045 | CPT | Reticulocytes, automated | Lab-4, Lab-12 |
| 82607 | CPT | B12 | Lab-5 |
| 82746 | CPT | Folate, serum | Lab-6 |
| 83020 | CPT | Hgb electrophoresis (83021 if lab uses HPLC method) | Lab-7, Lab-14 |
| 36430 | CPT | Transfusion, blood or components | Proc-1 |
| 310325 | RXNORM | ferrous sulfate 325 mg tablet | Med-1 |
| 198630 | RXNORM | ferrous gluconate 324 mg tablet | Med-2 |
| 284202 | RXNORM | ferrous fumarate 324 mg tablet | Med-3 |
| 1741261 | RXNORM | iron sucrose 20 mg/mL injection | Med-4 |
| 2274409 | RXNORM | ferric derisomaltose 1,000 mg/10 mL [Monoferric] | Med-5 |
| 1435169 | RXNORM | ferric carboxymaltose 750 mg/15 mL | Med-6 |
| 206216 | RXNORM | iron-dextran 50 mg/mL [INFeD] | Med-7 |
| 310410 | RXNORM | folic acid 1 mg tablet | Med-8 |
| 309594 | RXNORM | cyanocobalamin 1 mg/mL injection | Med-9 |
| Z98.84 | ICD-10 | Bariatric surgery status | Step 3.4 (gate-captured — attaches to branch target) |
| D57.3 | ICD-10 | Sickle cell trait | Step 3.3 (gate-captured) |
| D56.3 | ICD-10 | Thalassemia minor | Step 3.3 (gate-captured) |
| O09.40 | ICD-10 | Supervision of pregnancy with grand multiparity, unspecified trimester | Step 1.1 (risk-factor flag) |

All codes wave-2 verified — see §18 item 11.

## 14. Attribute-map registrations

**None needed.** All lab gates use coded-form conditions that match `labResults` by LOINC
directly, bypassing `pathway_attribute_code_map` entirely. The one attribute condition,
`patient.gestational_age_weeks` (gate-iv-iron-ga, 2026-09-24), is a `patient.*` attribute,
which reads `patientAttributes` directly and needs no code-map row. No `lab.*`/`allergy.*`
attributes are referenced anywhere in §4b.

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

- Stage 1: [1][4] · Stage 2: [1][5] · Stage 3: [1][7][8] · Stage 4: [1][9][11]
- Step 1.1: [1][2][3][10] · Step 1.2: [1][5] · Step 1.3: [1] · Step 1.4: [1]
  · Step 1.5: [1][4] · Step 1.6: [4] · Step 1.7: [1]
- Step 2.1: [1][5][13][14] · Step 2.2: [1] · Step 2.3: [1][3] · Step 2.4: [3]
  · Step 2.5: [1][5][7][22]
- Step 3.1: [7] · Step 3.2: [16] · Step 3.3: [1][4][7] · Step 3.4: [8][18][19]
  · Step 3.5: [8] · Step 3.6: [1][11] · Step 3.7: [3] · Step 3.8: [1][20] · Step 3.9: [21]
  · Step 3.10: [1][17]
- Step 4.1: [9][11] · Step 4.2: [1][6] · Step 4.3: [1][6][9]
- DP-1: [1] · Criteria 1a/1b: [1] · DP-2: [1] · Criteria 2a: [1][5], 2b: [1][8], 2c: [1]
  · DP-3: [1][6] · Criteria 3a: [1], 3b: [6][1]
- Meds: Med-1: [1][5][13][14][15] · Med-2, Med-3: [1] · Med-4–Med-7: [5][22] · Med-8,
  Med-9: [1] · Med-10: [13] · Med-11: [1] · Med-12: [1][17]
- Labs: Lab-1, Lab-10: [1] · Lab-2, Lab-11: [1][5] · Lab-3: [1] · Lab-4, Lab-12: [1] · Lab-5, Lab-6: [1]
  · Lab-7, Lab-14: [4] · Lab-8, Lab-13: [1] · Lab-9: [11]
- Proc-1: [1][11] · Guid-1: [1][12] · Guid-2: [1][12][13] · Guid-3: [1][12]
  · Guid-4: [5][13][14] · Guid-5: [1][10]

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
| gate-hgb-response | labs 718-7 (delta) | — | — | 42 | Operator-windowed (XOR rule); ideal anchor is Step 2.1 med-start — anchor-to-event is not in the kernel grammar yet, note stands |
| gate-severe-anemia | labs 718-7 (Hgb) | {days: 7} | — | — | Hgb <6 is an acute finding; only a current value justifies transfusion routing |
| gate-referral-threshold | labs 718-7, 4544-3 | {days: 90} | — | — | Referral on current-pregnancy values |
| gate-multi-gestation | O30.* | {days: 300} | active | — | A *prior* pregnancy's twin code must not fire this pregnancy's surveillance branch |
| gate-scd / gate-thal-major / gate-trait | D57.* / D56.* | LIFETIME | any | — | Genetic conditions never expire |
| gate-bariatric | Z98.84, O99.84.* | LIFETIME | any | — | Anatomy is permanent |
| gate-ibd | K50.*, K51.* | LIFETIME | any | — | Chronic relapsing disease stays gate-relevant |
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
9. `[FALLBACK SOURCE]` FIGO 2025 (predelivery time-math, 2-week response variant,
   postpartum durations); BSH 2024 thalassemia (no US equivalent); KI Reports 2024 (CKD
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
gate-microcytic, gate-normocytic, gate-macrocytic (MCV), gate-ida-confirmed (ferritin), gate-hgb-response (Hgb), gate-severe-anemia (Hgb), gate-referral-threshold (Hgb, Hct). Gates with only code/history conditions carry `default`, which is what the
engine does for them anyway. Lab conditions also carry a `display` (name + unit) so the
missing-value question is readable.

### `[BUILD FIX 2026-09-24]` Simulator-untestable: `gate-hgb-response` trend arms

The encounter simulator sends no dates. The three `trend_up` arms need at least two
**dated** hemoglobin values, so they never fire from the simulator (one undated value: not
met; two or more: unorderable, and the gate asks for a hemoglobin instead). Only the
absolute-target arm (Hgb > 10.9 within 90 days) is exercisable there. Test the trend arms
with dated labs (API or seeded data), not the composer.
