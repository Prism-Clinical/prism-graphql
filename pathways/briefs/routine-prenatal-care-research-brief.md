# Pathway Research Brief — Routine Prenatal Care (with universal GDM screening)

JSON: (not built)

**Status: DRAFT v1 for physician review — not yet approved for JSON build.**

**What this is.** A new pathway, `routine-prenatal-care`. It **supersedes** the stored
`routine-prenatal-care-v2`, which is ACTIVE on the local stack and was given the verdict "fix".
It also supersedes the older `routine-prenatal-care-v1` (ACTIVE; it crashes on resolve).

Both stored versions trigger on Z34.00/Z34.90 and would co-match this pathway, so **archive
both at import** (D-27). Per Josh's D-1, this pathway also **owns gestational diabetes screening
and diagnosis**. That content was folded in from Part A of the GDM brief, which is now
management-only (`pathways/briefs/gestational-diabetes-management-research-brief.md`).

**Research method** (per `.claude/skills/pathway-research/SKILL.md`):
- **Landscape scan**, then four parallel domain agents over fetched guideline text, all on
  2026-09-24:
  - A: diagnosis and screening;
  - B: pharmacotherapy and immunization;
  - C: counseling, safety-netting and special populations;
  - D: monitoring, quality and ordering.
- **Wave-2 verification agents** for codes and citations. Their results are folded into §0.7,
  §13, §15 and §18.
- **Reused research.** The GDM screening content reuses the GDM brief v1 research, including
  its wave-2-verified codes and citations.
- **Inventory of what exists today.** The stored v2 graph was reconstructed from the local
  pathway-service (`recon_0c12db5b.json`) and used as an inventory, not as a source (§0.2).

Flags:
- `[GAP]` unsourceable.
- `[OLDER SOURCE]` older, but still the current recommendation.
- `[NOT ENCODABLE]` clinically required but not expressible on main.
- `[DECISION]` an authoring choice Josh must ratify.
- `[DECISION — Josh 2026-09-24]` ratified.
- `[SIM]` cannot be exercised in the encounter simulator as seeded today.
- `[PAYWALL]` the primary text could not be read; the claim rests on the named secondary or
  mirror.

> ### Read this first
>
> 1. **Gestational age drives the timeline.** The engine now treats a missing
>    `patient.gestational_age_weeks` as missing data. It pends and asks, typed NUMERIC, and the
>    prompt uses the condition's `display`.
>    - Every time-windowed stage is therefore **branch-entry only, behind a GA gate** hosted on
>      Step 1.1. There are eight GA gates, all reading ONE datum, so a missing GA is asked for
>      once.
>    - No GA question routers.
>    - The encounter simulator sends GA, so those sessions decide at once. The preview flow
>      asks.
> 2. **GDM testing lives here (D-1).**
>    - Before 24 weeks: risk-based early testing (Stage 4).
>    - From 24 weeks: universal screening, two-step (Stage 7) or one-step (Stage 8).
>    - A positive result opens **"Diagnose GDM: add O24.410 to the problem list"**. The engine
>      starts pathways only from condition codes, so that code is the hand-off. The
>      `gestational-diabetes-management` pathway matches on the next resolve.
>    - Decided parameters:
>      - 50-g cutoff **140 mg/dL** (D-3).
>      - **Carpenter–Coustan, ≥2 abnormal values** (D-4). This stays a question gate: no
>        compound encoding of "2 of 4" exists (§4b).
> 3. **The hand-off has a coding cost (D-21).** ICD-10-CM forbids Z34 alongside any
>    chapter-15 code. A patient recoded to O24.410 alone stops matching Z34 triggers. So this
>    brief adds O24.41x and O99.810 as triggers by default, and a ≥24-week status router keeps
>    a diagnosed patient out of re-screening (D-22).
> 4. **Every gate is the sole route to its target.** v2 had three inert gates:
>    - `gate-risk-class` was `traverse` and shadowed by a root edge;
>    - `gate-rh-negative` was shadowed by `HAS_STEP`;
>    - `gate-early-gdm-screen` was shadowed and mis-targeted.
>
>    It also had lowercase `answer_type` (crashes resolve), and `dp-1` had no branches. All are
>    fixed here (§0.2).

---

## 0. Cross-cutting analysis (not emitted)

### 0.1 Architecture `[DECISION — Josh 2026-09-24]` (D-1)

- **GDM testing is part of routine prenatal care.** A positive result is a gate leading into
  gestational diabetes care.
- **The hand-off is a code.** Pathways start only from condition codes, so the positive-result
  gates open a **"Diagnose GDM"** step that recommends adding **O24.410** (GDM in pregnancy,
  diet controlled) to the problem list. It carries a CodeEntry for O24.410.
- **Once coded**, `gestational-diabetes-management` matches on the next resolve and owns
  glycemic management.
- **This pathway stays active** for the rest of routine care (Tdap, Rh, GBS, and so on) through
  O09.x, or through O24.41x triggers (D-21). The ≥24-week status router gives the diagnosed
  patient a "diabetes already diagnosed" exit, so she is not re-screened.
- **The same pattern generalizes** (noted, not built beyond BP):
  - elevated BP → "record R03.0 / O13–O14" → GHTN pathway (D-25; built, Step 2.2);
  - low hemoglobin → "record O99.01x" → anemia pathway. Not built: trimester-specific Hb
    thresholds need three GA-banded gates (§18).

### 0.2 Inventory: what `routine-prenatal-care-v2` has today, and where it goes

Reconstructed from the stored graph (pathway id `0c12db5b`, ACTIVE):
- 5 stages, all root-connected, and 26 steps.
- 3 gates, all inert.
- 1 DecisionPoint with no branches.
- 3 meds, 12 labs, 2 procedures, 2 QMs, 5 schedules and 8 citations.
- Triggers: Z34.00, Z34.90 only.

| v2 element | Problem found | This brief |
|---|---|---|
| Stages 1–5, all `root HAS_STAGE` | Nothing is time-scoped: a 10-week patient sees GBS and Tdap | Stages 1–2 root; Stages 3–12 are GA-gated or router-entered |
| `gate-risk-class` (question, **lowercase `boolean`**, `traverse`) → `stage-2` | Inert twice (`traverse`; `stage-2` also root-connected). Lowercase answer_type crashes resolve | Dropped. Risk tier is assessed in Step 1.2 as text; greater-than-average-risk *content* is out of scope (D-23), so nothing to gate |
| `gate-rh-negative` (question) → `step-4-2` RhIG | Inert: `stage-4 HAS_STEP step-4-2` also exists | `patient.rh_factor` paired gates → RhIG / no-RhIG steps, both gate-only (Stage 9, D-24) |
| `gate-early-gdm-screen` (question, lowercase) → `step-4-1` "50-g GCT 24–28 wk" | Inert, **and mis-targeted**: an *early-screening* question pointed at *universal* screening | Replaced by Stage 4 (early testing) and Stages 6–8 (universal), from GDM Part A |
| `dp-1` visit modality (`one_of`, no `BRANCHES_TO`, criteria with no targets) | Branchless DP (validator warning); no content behind it | Dropped. Visit modality is CC No. 8 text on Step 2.4 + Sched-1 |
| Step 1.1–1.6 intake | Sound content | Kept and expanded (Steps 1.1–1.9) |
| Steps 2.1–2.3 (aneuploidy, carrier, dating US) | PB 226 is **withdrawn**; windows outdated | Jan 2026 ACOG Practice Advisory (cfDNA routinely available); carrier screening moves to Step 1.5 |
| Steps 3.1–3.3 (anatomy, quad, routine) | Sound | Stage 5 |
| Step 4.1 GDM GCT (uncoded `lab-10` in the merge key) | Duplicate/uncoded | Stages 6–8, coded LOINC 1504-0 |
| Steps 4.2–4.6 (RhIG, Tdap, CBC, GBS, presentation) | Sound; GBS window right (36 0/7–37 6/7) | Stages 6, 9, 11 |
| Steps 5.1–5.5 (per-visit) | Sound | Stage 2, plus a BP hand-off gate (D-25) |
| med-1 prenatal vitamin (RxNorm 310488), med-2 RhIG (RxNorm 5641), med-3 Tdap | **310488 is glipizide 10 mg**, and 5641 is a retired identifier (§0.7). Lane names are snake_case | Re-coded (folic acid 4511, RhIG 35465), with kebab-case lanes |
| Lab codes (58410-2, 34530-6, 25514-1, 20507-0, 5195-3, 75622-1, 16128-1, 630-4, 43304-5, 1504-0, 11475-1) | **75622-1** (HIV panel grouper), **43304-5** (CT only) and **11475-1** (generic culture) are wrong for their purpose. 5195-3, 16128-1 and 25514-1 are right; the seed table mislabels them (§0.7) | Re-verified |
| ev-1…ev-8 | ev-6 cites withdrawn PB 226; ev-4 is a generic "USPSTF recommendations" entry | Replaced by §15 |

### 0.3 Coding facts that shape the triggers (ICD-10-CM FY2027 Official Guidelines [58])

The FY2026 and FY2027 texts of these sections are identical (agent A compared them word by
word).

- **I.C.15.b.1.**
  - Rule: for routine outpatient prenatal visits with no complications, a Z34 code is the
    first-listed diagnosis.
  - Guideline text: "These codes should not be used in conjunction with chapter 15 codes."
- **I.C.15.b.2.**
  - Rule: for high-risk pregnancies, O09 is first-listed.
  - Guideline text: "Secondary chapter 15 codes may be used in conjunction with these codes if
    appropriate."
  - O09 is prenatal-period only.
- **I.C.21.c.11.**
  - Rule: Z34 is always first-listed and never used with any other OB-chapter code.
  - Z3A "may be assigned to provide additional information about the pregnancy". Z3A is not
    for abortive outcomes, elective termination or postpartum conditions.
  - The tabular "code first" note on Z3A lists O09–O60, O80–O82 and O94–O9A. It does **not**
    list Z34, so pairing Z3A with Z34 rests on "may be assigned".
- **Trimesters** are counted from the LMP:
  - 1st: <14 weeks 0 days;
  - 2nd: 14 weeks 0 days to <28 weeks 0 days;
  - 3rd: ≥28 weeks 0 days.
- **After an abnormal glucose challenge**, the pregnancy is coded **O99.810** (Excludes1 GDM
  O24.4-). Once coded, **GDM is O24.41x**, and no other O24 code is used with it.
- **Consequence (D-21).** A patient whose problem list moves from Z34.x to O24.410 alone no
  longer matches a Z34-only trigger set. v2 has exactly this gap. So does every chapter-15
  complication the co-matching pathways key on (O99.01x anemia, O13/O14 GHTN, O23.x UTI).

### 0.4 Co-matching with the live and draft pathways

Triggers, from the built JSONs on josh-dev:

| Pathway | Triggers |
|---|---|
| `anemia-in-pregnancy` v5 | O99.011–.019, D50.9 |
| `gestational-hypertension-preeclampsia` v1 | O13.x, O14.x, O16.x, R03.0 |
| `uti-asymptomatic-bacteriuria-pregnancy` v1 | R82.71, O23.1x/.4x, O99.820, **Z13.89** |
| `gestational-diabetes-management` | O24.41x, O24.43x |

Co-matching therefore happens:
- through **O09.x + any O-code**;
- through **Z34.x + a non-O code**: D50.9 anemia, R03.0 elevated BP, R82.71 bacteriuria,
  Z13.89 screening;
- through **O24.41x** once D-21 adds it.

**How the merge treats it** (josh-dev `care-plan-merge.ts` after `77105ca`):
- **Medications** are deduped by name. `avoid`/`contraindicated` suppresses a name everywhere.
- **`clinical_role`** conflicts on ≥2 distinct names in one lane.
- **Labs** are keyed by `system|code`; procedures and imaging likewise.
- **Guidance** is deduped on **topic + instructions**. The same topic with different text now
  shows **both**, so two "When to call us right away" blocks would stack.

| Overlap | With | Handling in this brief |
|---|---|---|
| **Aspirin 81 mg** (`preeclampsia-prophylaxis`) | GHTN `med-1` | **Same name, same lane**, so the merge shows one. The eligibility **question is duplicated**: an O09 + O13/O14 patient is asked by both pathways. Question gates do not dedupe across pathways. This pathway's prompt is **verbatim** GHTN's `gate-aspirin-indicated` prompt, so the two answers can't diverge in meaning. |
| **BP ≥140/90** | GHTN `gate-bp-elevated` (same two vitals conditions) | Identical conditions; ONE datum per vital. Whether the multi-pathway session dedupes a vitals question *across* pathways is unverified (§18). This pathway's target is a hand-off step, not management. |
| **Urgent maternal warning signs** (Guidance) | GHTN `guid-1`, same topic | **Licensing problem found (D-28).**<br>• GHTN's text paraphrases the ACOG/AIM Urgent Maternal Warning Signs card. The 2026 card is "© 2026 ACOG Foundation. All rights reserved" and **prohibits any use of the content as part of a generative AI / LLM to generate text** (agent C).<br>• This brief uses the **CDC Hear Her** list word for word, with CDC's attribution and non-endorsement terms, under the same topic.<br>• The CDC page itself says the list "was developed by the Alliance for Innovation on Maternal Health". So even the CDC version is AIM-origin, and licensing review is needed before shipping either text.<br>• Once cleared, **recommend GHTN adopt the identical text**; the merge then shows one block. Until then an O09 + O13 patient sees two blocks under one topic. |
| **"When to call us right away"** | anemia `guid-5` and UTI `guid-1` (same topic, different text) | Pre-existing collision; not this pathway's. Recommend renaming them to "Anemia: when to call us" and "Bladder infection: when to call us". This pathway does **not** use that topic. |
| **CBC** 58410-2 | anemia `lab-1` | Same LOINC, so it dedupes |
| **Type and screen** 882-1 / 890-4 | anemia `lab-9` (882-1) | Same LOINCs, so it dedupes |
| **Hemoglobinopathy panel** 43113-0 | anemia `lab-7` | Same LOINC, so it dedupes |
| **Urine culture** 630-4 (+19090-0 colony count) | UTI `lab-2`/`lab-1` | Same LOINCs, so it dedupes. UTI owns ASB treatment. Its "screening urine culture once, early" schedule duplicates Step 1.3 in intent: two schedules with different wording (§18). |
| **GBS** | UTI `gate-gbs-identified` | GBS bacteriuria at any count makes the 36-week swab unnecessary (CO 797). Step 11.1 says so. A chart gate cannot suppress the swab: there is no negation, and the UTI answer is a question, not a code (§18). |
| **NST 59025 / BPP 76818** | GHTN, GDM | Same CPTs, so they dedupe |
| **clinical_role lanes** | all | This pathway's lanes: `prenatal-vitamin-supplementation`, `preeclampsia-prophylaxis` (shared by design with GHTN, same drug name), `influenza-immunization`, `covid-immunization`, `pertussis-immunization`, `rh-immune-globulin-prophylaxis`, `rsv-maternal-immunization`. **No conflicting lane** with anemia (iron/folate/B12/ESA), GHTN antihypertensives, UTI antibiotics or GDM (insulin/metformin). The prenatal vitamin is not in anemia's `oral-iron-repletion` lane. |

**Guidance topics** are chosen so nothing collides with another pathway's topic except the
deliberate "Urgent maternal warning signs". GDM-specific topics keep the `GDM` prefix. Two
general topics sit next to GDM-management analogues with different names, so both show:
- "Pregnancy weight gain" vs "GDM pregnancy weight gain";
- "Staying active in pregnancy" vs "GDM activity".

The GDM brief notes that Josh may drop its duplicates.

### 0.5 `[DECISION]` index

**Ratified by Josh (2026-09-24), carried here:**

| ID | Ruling |
|---|---|
| D-1 | GDM testing lives in routine prenatal care. A positive result opens "Diagnose GDM (add O24.410)" (§0.1). |
| D-3 | 50-g GCT cutoff **140 mg/dL** (threshold 139.9). |
| D-4 | 100-g OGTT: **Carpenter–Coustan, ≥2 abnormal values**. Encoded as a question gate; no faithful compound encoding exists (§4b `gate-100g-diagnostic`). |
| D-12 | Long-term post-GDM screening belongs to routine care. In pregnancy, "gestational diabetes in a prior pregnancy" is an early-testing criterion (Stage 4). Recurring screening between pregnancies belongs to adult preventive care, which has no pathway yet (§18). |

**Moved here from the GDM brief, still open. Default kept; one-line tradeoff each:**

| ID | Decision | Default | Tradeoff |
|---|---|---|---|
| D-5 | Screening strategy: offer both one-step and two-step via the router, or hard-code one | **Both** (now two options of the combined status router, §4b) | Hard-coding saves one choice per patient, but Prism has no per-site configuration, so a site using the other strategy would be asked for values it never draws |
| D-6 | Early test designated as HbA1c (single-test gate) vs a router over HbA1c / FPG / 75-g OGTT | **HbA1c** | ADA Rec 2.4 prefers plasma glucose in pregnancy. A router adds a question, but an OR over alternative tests would ask forever for the one not drawn |
| D-7 | Include the early abnormal glucose branch (ADA A1C 5.9–6.4%), although ACOG no longer recommends early GDM screening | **Include**, as counseling and fasting-glucose monitoring only | Dropping it follows ACOG. Keeping it follows ADA Rec 2.31b and flags higher risk |
| D-17 | Z3A.xx weeks-of-gestation codes as triggers | **Not used** | Z3A accompanies chapter-15 codes and would catch complication-coded pregnancies (see D-21). Costs: 36 codes, used at delivery admissions too, only Z3A.00 seeded |

**New, raised by this brief (open):**

| ID | Decision | Default | Tradeoff |
|---|---|---|---|
| D-21 | Trigger set once complications replace Z34: (a) Z34/O09 only; (b) + O24.41x leaves + O99.810; (c) + every co-matched pathway's O-codes; (d) + Z3A leaves (D-17) | **(b)**: the minimum that D-1 itself requires | (a) drops routine care (GBS, Tdap, Rh) the moment GDM is coded without O09. (c)/(d) cover anemia/GHTN/UTI-coded pregnancies too, but widen co-matching. Every O-coded patient then answers the ≥24-week status router |
| D-22 | ≥24-week **GDM status router**: one SELECT per visit from 24 weeks (not yet screened two-step / one-step / screened negative / already diagnosed) | **Router** (it also carries D-5) | Without it, a diagnosed or screened-negative patient is re-offered screening and asked for a 50-g value. The cost is one question per ≥24-week visit. Until it is answered it pends, which blocks single-pathway plan generation (§0.6 #10) |
| D-23 | Scope: include O09.x (high-risk supervision) for **routine elements only**; condition-specific high-risk care is out of scope | **Include O09.x** | v2 excluded greater-than-average risk entirely. O09 patients still need every routine element. Risk-specific add-ons (age ≥40 testing, obesity testing, prior-preterm cervical length, TOLAC) are listed as text, not gated (§3 Step 1.2, §18) |
| D-24 | Rh encoding: `patient.rh_factor` paired gates (`equals "negative"` → RhIG; `equals "positive"` → no RhIG) vs one BOOLEAN question router | **`patient.rh_factor` pair** | Chart-native, and asks only when absent. The SELECT offers both comparands (the two gates pool options). The attribute's string vocabulary ("negative"/"positive") must match the chart feed; the simulator does not send it, so it asks. A question is simpler but always asks |
| D-25 | BP ≥140/90 hand-off gate (every visit) → "confirm; record R03.0, or O13/O14 once confirmed" → GHTN pathway | **Include** | It mirrors the D-1 GDM hand-off for USPSTF 2023's every-visit BP screen. It duplicates GHTN's gate for co-matched patients, which share one datum per vital |
| D-26 | COVID-19 vaccine in pregnancy: ACOG CS 26 (2026) "all pregnant individuals should receive" vs the CDC adult schedule (Jul 2 2025): pregnancy cell "no guidance", with CDC interim considerations (Sep 2026) urging a risk review | **Include per ACOG** (owning society, source hierarchy #1). Role `first_line`, with the conflict stated in the node | Federal and society guidance conflict. Alternatively role `acceptable` with shared-decision text, or omit |
| D-27 | Import housekeeping: archive `routine-prenatal-care-v1` and `-v2` when this imports | **Archive both** | Leaving them ACTIVE co-matches every Z34.00/Z34.90 patient with two broken graphs (v1 crashes; both duplicate every item) |
| D-29 | Result gates at the **ordering visit** (GCT, early A1C, 75-g OGTT): a missing value asks, and single-pathway care-plan generation is refused until it is answered (§0.6 #10). Options: (a) split D-22's router into "not yet screened: order the test" vs "resulted: interpret", so the result gate is reached only once a value exists (anemia v5's "recheck not yet done" pattern); (b) `on_unresolved: default` with an `[ON-UNRESOLVED DEFAULT — gate-x]` marker, where a missing value means "not drawn yet" and the next step stays closed; (c) accept it | **(c) keep `ask`** (Josh's numeric rule). Multi-pathway generation, the usual path for pregnancy co-matching, does not block on pending questions | (c) stalls single-pathway plans at ordering visits. (a) costs one more router option but is the cleanest. (b) departs from the rule and would silently close the next step if a result is simply missing from the chart |
| D-28 | Warning-signs Guidance text: CDC Hear Her list verbatim (the CDC page credits AIM as its developer) vs topic + link only vs a clinician-written list | **CDC text verbatim, pending licensing review** | Word-for-word CDC reuse is the lowest-risk text. If AIM's rights reach the CDC reproduction, fall back to the topic plus a link to cdc.gov/hearher. GHTN's AIM paraphrase has the same question |

### 0.6 Spec and engine limitations hit

1. **No N-of-M operator.** Carpenter–Coustan "≥2 of 4" is a question (D-4). Six pairwise-AND
   gates are possible, but they need six duplicate "Diagnose GDM" targets (Rule 2) and would
   show 2–6 copies when 3–4 values are abnormal. Rejected.
2. **Chart gates have no negation.** Several things cannot be read as a negative from the
   chart:
   - "Not yet screened", "not diagnosed" and "screened negative" (router D-22);
   - "no GBS bacteriuria" (text);
   - "unsensitized", i.e. antibody screen negative (text in Step 9.3; `includes_code` on 890-4
     reads presence, not result).
3. **No calendar-month operator.** The RSV vaccine season (Sept–Jan CDC; Sept 1–Mar 1 ACOG)
   and the influenza season are text.
4. **A compound OR over alternative tests asks forever for the one not drawn.** HbA1c is
   designated for early testing (D-6). One-step vs two-step is routed first.
5. **`patient.rh_factor` SELECT options come from the comparands.** A lone
   `equals "negative"` gate offers one option, and an Rh-positive patient could never answer.
   The paired gate is required (D-24).
6. **REQUIRES catch-up has no satisfaction check in the import spec.**
   - `prerequisites.ts` supports a `satisfaction_check` (code or attestation) node property,
     but the spec does not list it as authorable.
   - Without it, every REQUIRES prerequisite surfaces as "no-satisfaction-check" catch-up, even
     when it was done.
   - REQUIRES pairs are therefore kept to the few that matter (§12).
7. **Question gates do not dedupe across pathways** (aspirin, §0.4). Chart data dedupes on the
   datum key within a session. Whether that holds across co-matched pathways is unverified.
8. **The simulator enters only seeded codes.**
   - Seeded: Z34.00, Z34.90, O09.40, O09.90, O24.41x, 4548-4, 1504-0, 1558-6, 882-1, 890-4,
     630-4, 19090-0 and others (§18).
   - Not seeded: most Z34/O09 leaves, O99.810, the timed OGTT LOINCs.
9. **GA is "completed weeks".** Windows "A 0/7–B 6/7" become `≥ A` and `< B+1` (half-open).
   This is correct whether the attribute is an integer or fractional.
10. **A held gate blocks single-pathway care-plan generation (D-29).**
    - **Single-pathway generation** refuses a session with **any** `PENDING_QUESTION` node:
      `care-plan-generator.ts` `validateForGeneration`, blocker `PENDING_GATE`. That covers
      unanswered question gates and chart gates asking for a missing value.
    - **Multi-pathway generation** blocks only on unresolved `clinical_role` conflicts and an
      empty plan: `multi-pathway-resolution.ts` `validateForGeneration`.
    - The consequence is on the single-pathway path. At the visit that **orders** a test, the
      result gate asks for a value that cannot exist yet, and the plan cannot be generated
      until the value is entered. Affected gates:
      - `gate-gct-positive` (24-week visit);
      - `gate-overt-diabetes` and `gate-early-abnormal-glucose` (A1C ordering visit);
      - `gate-75g-diagnostic` (one-step ordering visit).
    - The question gates behave the same way until they are answered: D-22's router at every
      visit from 24 weeks, aspirin, early testing and Carpenter–Coustan.
11. **Gated regions (josh-dev spec, Rule 1).** No edge points into a gated stage or step from
    outside it:
    - no `ESCALATES_TO` anywhere;
    - every node on several hosts is one node per host (for example, CBC Lab-1/Lab-19,
      antibody screen Lab-3/Lab-23, Guid-A4/A4b).
12. **Negation (`not_includes_code`) is being built on josh-dev, not yet available.** When it
    lands, part of D-22's router could become chart-read:
    - "already diagnosed" = O24.4* present;
    - "not yet diagnosed" = NOT O24.4* AND NOT O24.1*.

    "Screened negative" would still need a question or a lab-value gate. The anchored trend
    windows and DATE answers now on josh-dev are not needed by this pathway (no response-to-
    treatment gate).

### 0.7 Wave-2 verification outcome

Three wave-2 agents ran on 2026-09-24.

- **Codes.** Sources: LOINC 2.82 via tx.fhir.org, cross-checked against NLM Clinical Tables;
  ICD-10-CM from NLM; CPT 2023 descriptors via tx.fhir.org, spot-checked on AAPC; RxNorm from
  RxNav; HCPCS from NLM.
- **Citations [1]–[62].** Part 1 found 17 PASS, 3 PARTIAL and 11 fixes. Part 2 found mostly
  PASS, 1 FAIL ([41]) and several claim-sourcing fixes.

All corrections are applied below. Five of them matter clinically.

**1. Five of v2's codes were wrong, and would have matched nothing or the wrong thing.**

| v2 code | v2 purpose | What it really is | Now |
|---|---|---|---|
| RxNorm **310488** | prenatal vitamin | **glipizide 10 MG Oral Tablet** | folic acid IN 4511 |
| RxNorm **5641** | RhIG | a retired 2005 identifier | 35465 |
| LOINC **75622-1** | HIV | a Meaningful Use *panel grouper*, not a result code | 56888-1 |
| LOINC **11475-1** | GBS culture | generic "Microorganism identified by culture" | 72607-5 |
| LOINC **43304-5** | CT + GC | CT rRNA **only** | 21613-5 + 21416-3 |

v2's **5195-3** (HBsAg), **16128-1** (HCV Ab) and **25514-1** (rubella IgG) are **correct**.
The local seed table mislabels them: it calls 5195-3 an HBs antibody and 16128-1 an HBc
antibody. The "suspect" notes in §0.2 were raised by those seed labels and are withdrawn.

**2. Candidate codes that did not exist:**
- 25514-4 (rubella) → 25514-1.
- 47236-8 (treponemal) → **22587-0**.
- 19162-0 (varicella) → **19162-7**.

**3. Other code results:**
- The O24.111–.119 leaves exist.
- The O09 leaf list is confirmed exactly: 64 leaves, and there is no O09.290.
- All 39 CPT codes and HCPCS **J2790** (RhIG 300 mcg) exist and fit.

**4. Citation fixes.**
- **Claims pulled from references that did not contain them.** Each claim is now re-sourced to
  a new reference ([63]–[71]), or reworded or dropped:
  - diagnostic-testing windows ([4] → [63]);
  - the FDA aspirin carve-out ([64]);
  - the 4 mg folic acid, iron and iodine figures ([28] → [65][66][67]);
  - alcohol wording ([68]);
  - calorie figures ([69]);
  - car-belt guidance ([70]);
  - the Core Set status ([71]);
  - the trimester definitions (now attributed to the Tabular List).
- **[41] was FAIL.** The Hear Her text was not verbatim. It is now corrected word for word.
- **New licensing question:** the CDC page states the list "was developed by the Alliance for
  Innovation on Maternal Health". So the list is AIM-origin even on CDC's site (D-28).
- **[25]:** agent B reported a court-order banner on the CDC schedule, but the checker could not
  find it on the cited pages. That claim is dropped and the schedule is cited by its Jul 2 2025
  date only.

**5. HEDIS detail not on the NCQA pages** (PRS-E windows, PND-E cut-points) is marked `[GAP]`
instead of stated.

---

## 1. Pathway metadata

- **Logical ID**: `routine-prenatal-care` (new; supersedes `routine-prenatal-care-v1` and `-v2`,
  which are archived at import, D-27)
- **Title**: Routine Prenatal Care
- **Version**: 1
- **Category**: OBSTETRIC
- **Scope**: Outpatient antepartum care for every pregnancy under supervision (Z34.x normal,
  O09.x high-risk), from the first prenatal contact to birth. Covers:
  - intake and dating;
  - the initial laboratory panel;
  - genetic screening options;
  - psychosocial screening;
  - preeclampsia risk and aspirin;
  - supplements, immunizations and counseling;
  - every-visit monitoring, with a hand-off for elevated BP;
  - GA-windowed care: dating ultrasound, aneuploidy windows, anatomy survey, early and
    universal GDM testing, 24–28-week labs, Tdap, Rh prophylaxis, third-trimester rescreening,
    the RSV vaccine, GBS, fetal presentation, birth and postpartum planning, and late-term
    surveillance.

  **GDM diagnosis hands off** to `gestational-diabetes-management` via O24.410.
  **Out of scope:**
  - condition-specific high-risk management (multiples, prior preterm birth and cervical
    length, TOLAC, OUD treatment, age ≥40 testing, obesity-based testing), listed as text in
    Step 1.2 (D-23);
  - intrapartum and postpartum care, beyond planning;
  - nausea/vomiting treatment.
- **Target population**: Pregnant patients receiving outpatient prenatal care, average risk or
  high-risk supervision, singleton or otherwise (multiples are noted but not managed).
- **Condition codes** (trigger codes; OR semantics). Codes are listed as **leaves**, because
  trigger matching expands the *patient's* codes to ancestors only through `icd10_codes`
  (666 rows; no O09 subtree, no Z34.01–.03/.80–.83/.91–.93). A category trigger would silently
  miss most patients.

| Code | System | Description | Usage note | Grouping |
|---|---|---|---|---|
| Z34.00, Z34.01, Z34.02, Z34.03 | ICD-10 | Encounter for supervision of normal first pregnancy — unspecified / first / second / third trimester | primary trigger | normal-pregnancy |
| Z34.80, Z34.81, Z34.82, Z34.83 | ICD-10 | Encounter for supervision of other normal pregnancy — unspecified / first / second / third trimester | primary trigger | normal-pregnancy |
| Z34.90, Z34.91, Z34.92, Z34.93 | ICD-10 | Encounter for supervision of normal pregnancy, unspecified — unspecified / first / second / third trimester | primary trigger | normal-pregnancy |
| O09.00, O09.01, O09.02, O09.03 | ICD-10 | Supervision of pregnancy with history of infertility — unsp / 1st / 2nd / 3rd trimester | primary trigger | high-risk-pregnancy |
| O09.10, O09.11, O09.12, O09.13 | ICD-10 | Supervision of pregnancy with history of ectopic pregnancy | primary trigger | high-risk-pregnancy |
| O09.A0, O09.A1, O09.A2, O09.A3 | ICD-10 | Supervision of pregnancy with history of molar pregnancy | primary trigger | high-risk-pregnancy |
| O09.211, O09.212, O09.213, O09.219 | ICD-10 | Supervision of pregnancy with history of pre-term labor — 1st / 2nd / 3rd / unsp | primary trigger | high-risk-pregnancy |
| O09.291, O09.292, O09.293, O09.299 | ICD-10 | Supervision of pregnancy with other poor reproductive or obstetric history | primary trigger | high-risk-pregnancy |
| O09.30, O09.31, O09.32, O09.33 | ICD-10 | Supervision of pregnancy with insufficient antenatal care | primary trigger (late entry) | high-risk-pregnancy |
| O09.40, O09.41, O09.42, O09.43 | ICD-10 | Supervision of pregnancy with grand multiparity | primary trigger | high-risk-pregnancy |
| O09.511, O09.512, O09.513, O09.519 | ICD-10 | Supervision of elderly primigravida | primary trigger | high-risk-pregnancy |
| O09.521, O09.522, O09.523, O09.529 | ICD-10 | Supervision of elderly multigravida | primary trigger | high-risk-pregnancy |
| O09.611, O09.612, O09.613, O09.619 | ICD-10 | Supervision of young primigravida | primary trigger | high-risk-pregnancy |
| O09.621, O09.622, O09.623, O09.629 | ICD-10 | Supervision of young multigravida | primary trigger | high-risk-pregnancy |
| O09.70, O09.71, O09.72, O09.73 | ICD-10 | Supervision of high risk pregnancy due to social problems | primary trigger | high-risk-pregnancy |
| O09.811, O09.812, O09.813, O09.819 | ICD-10 | Supervision of pregnancy resulting from assisted reproductive technology | primary trigger | high-risk-pregnancy |
| O09.821, O09.822, O09.823, O09.829 | ICD-10 | Supervision of pregnancy with history of in utero procedure during previous pregnancy | primary trigger | high-risk-pregnancy |
| O09.891, O09.892, O09.893, O09.899 | ICD-10 | Supervision of other high risk pregnancies | primary trigger | high-risk-pregnancy |
| O09.90, O09.91, O09.92, O09.93 | ICD-10 | Supervision of high risk pregnancy, unspecified | primary trigger | high-risk-pregnancy |
| O99.810 | ICD-10 | Abnormal glucose complicating pregnancy | abnormal GCT awaiting the diagnostic OGTT (Z34 no longer applies) — D-21 | pregnancy-complication-coded |
| O24.410, O24.414, O24.415, O24.419 | ICD-10 | Gestational diabetes mellitus in pregnancy — diet / insulin / oral agent / unspecified control | keeps routine care after the D-1 hand-off recodes the pregnancy — D-21 | pregnancy-complication-coded |

## 1b. Code sets

None. Single-condition pathway, legacy OR over `condition_codes`.

## 2. Stages

Stages 1–2 are root-connected. Every other stage is **branch-entry only**, with no root
`HAS_STAGE`. Stage numbers are unique.

- **Stage 1 — Initial prenatal assessment and whole-pregnancy care** *(root)*:
  - dating;
  - history and risk;
  - the initial laboratory panel;
  - psychosocial screening;
  - genetic screening options;
  - preeclampsia risk and aspirin;
  - supplements and counseling;
  - immunizations given at any gestational age.

  Step 1.1 hosts every GA gate. [1][2][3]
- **Stage 2 — Every prenatal visit** *(root)*: BP with an elevated-BP hand-off, weight, fetal
  heart and movement, fundal height, symptom review, tailored visit schedule. [1][16][50]
- **Stage 3 — First trimester (before 14 0/7 weeks)** *(branch-entry only, via
  `gate-ga-first-trimester`)*: dating ultrasound, first-trimester aneuploidy screening window.
  [3][4]
- **Stage 4 — Early diabetes testing (before 24 0/7 weeks)** *(branch-entry only, via
  `gate-ga-before-24`)*: risk-based testing for undiagnosed pregestational diabetes. Overt
  diabetes and early abnormal glucose branches. [52][55][56]
- **Stage 5 — Second-trimester screening (14 0/7–23 6/7 weeks)** *(branch-entry only, via
  `gate-ga-14-to-24`)*: anatomy ultrasound; quad screen / open NTD assessment. [1][4]
- **Stage 6 — From 24 0/7 weeks: 24–28-week labs and GDM screening status** *(branch-entry
  only, via `gate-ga-24-plus`)*: repeat CBC; the GDM status router. [1][53][57]
- **Stage 7 — Two-step GDM screening and diagnosis** *(branch-entry only, via
  `gate-gdm-screening-status` = two-step)*: 50-g GCT → 100-g OGTT → Diagnose GDM. [53][54][55][57]
- **Stage 8 — One-step GDM screening and diagnosis** *(branch-entry only, via
  `gate-gdm-screening-status` = one-step)*: 75-g OGTT → Diagnose GDM. [55][57]
- **Stage 9 — From 27 0/7 weeks: third-trimester care** *(branch-entry only, via
  `gate-ga-27-plus`)*:
  - Tdap;
  - Rh status, antibody screen and RhIG;
  - third-trimester rescreening;
  - repeat psychosocial screening;
  - birth, breastfeeding and contraception planning.

  [1][8][21][24][44]
- **Stage 10 — Maternal RSV vaccine window (32 0/7–36 6/7 weeks)** *(branch-entry only, via
  `gate-ga-32-to-37`)*. [24][25][26]
- **Stage 11 — From 36 0/7 weeks: GBS, presentation and birth planning** *(branch-entry only, via
  `gate-ga-36-plus`)*. [1][20][44][48][62]
- **Stage 12 — From 41 0/7 weeks: late-term surveillance and delivery** *(branch-entry only, via
  `gate-ga-41-plus`)*. [46][47]

GA bands overlap on purpose: Stages 4 and 5 both run to 24 weeks, and Stages 9, 10, 11 and 12
stack. Each stage holds only what is due from its start. A 30-week patient sees Stages 1, 2, 6
and 9. Stage 5 is gated out, so a missed anatomy survey surfaces only through REQUIRES catch-up
(§12).

## 3. Steps

### Stage 1 — Initial prenatal assessment and whole-pregnancy care

- **Step 1.1 — Confirm pregnancy and establish gestational age and due date** *(unconditional;
  hosts the eight GA gates)*:
  - **Dating method.** Assign the EDD as soon as LMP and/or first ultrasound are available.
    First-trimester ultrasound (up to and including 13 6/7 weeks) is the most accurate method:
    crown–rump length, accurate to ±5–7 days.
  - **Redating thresholds.** Redate to ultrasound when the difference from LMP dating exceeds:

    | GA by LMP | Redate if difference exceeds |
    |---|---|
    | ≤8 6/7 weeks | 5 days |
    | 9 0/7–13 6/7 weeks | 7 days |
    | 14 0/7–15 6/7 weeks | 7 days |
    | 16 0/7–21 6/7 weeks | 10 days |
    | 22 0/7–27 6/7 weeks | 14 days |
    | ≥28 weeks | 21 days (with caution) |

  - **Suboptimal dating.** A pregnancy without an ultrasound that confirms or revises the EDD
    before 22 0/7 weeks is suboptimally dated.
  - **ART pregnancies** use the ART-derived EDD.
  - **Intake timing.** Complete the comprehensive intake ideally before 10 weeks, or at first
    presentation.
  - **Everything time-windowed reads GA.** Record GA in completed weeks.

  [1][3]
- **Step 1.2 — Comprehensive history, risk assessment and physical examination**
  *(unconditional)*:
  - **History:**
    - obstetric/gynecologic: prior pregnancies and outcomes, menstrual history, infertility or
      ART, Pap history, sexual and STI history, teratogen exposures;
    - medical: chronic conditions, mental health, substance use, eating disorders, surgeries,
      medications and supplements, immunizations, oral health;
    - family and genetic history;
    - social drivers of health.
  - **Exam:** BP, height, weight and BMI (BMI from measured height and weight; Z68 codes are
    not used in pregnancy).
  - **Risk tier.** Classify as average or greater-than-average risk to tailor the visit
    schedule (CC No. 8).
  - **High-risk findings are noted here and managed elsewhere** (D-23, out of scope):
    - multifetal gestation (MFM care);
    - prior spontaneous preterm birth: serial transvaginal cervical length 16–24 weeks.
      17-OHPC is withdrawn (FDA 2023). Vaginal progesterone only with a short cervix;
    - prior cesarean: TOLAC counseling (PB 205);
    - age ≥35: aspirin factor count, detailed anatomy scan. At ≥40: growth ultrasound,
      antenatal testing, delivery at 39 0/7–39 6/7 (OCC 11);
    - BMI ≥30: early diabetes testing (Stage 4). Weekly testing from 37 0/7 (BMI 35–39.9) or
      34 0/7 (≥40) may be considered (CO 828). Anesthesia consult (PB 230);
    - opioid use disorder: agonist therapy (CO 711);
    - sensitized Rh-negative: MFM.

  [1][2][46][49]
- **Step 1.3 — Initial prenatal laboratory panel** *(unconditional; the panel is drawn once,
  early. Catch-up for a late entrant)*:
  - **Universal:**
    - CBC;
    - ABO/Rh(D) type and antibody screen;
    - rubella immunity;
    - syphilis (treponemal and nontreponemal);
    - hepatitis B: **HBsAg every pregnancy**, plus the **triple panel** (HBsAg, anti-HBs, total
      anti-HBc) if any of:
      - no documented negative triple panel after age 18;
      - an incomplete vaccine series;
      - ongoing known risk, whatever the vaccination or testing history;
    - HIV (opt-out, Ag/Ab combination);
    - hepatitis C antibody (reflex RNA) every pregnancy, except where HCV prevalence is below
      0.1%;
    - urine culture for asymptomatic bacteriuria at the first visit or 12–16 weeks, whichever
      is earlier. Treatment belongs to the UTI pathway;
    - hemoglobinopathy testing if no prior result (universal since 2022).
  - **Age- or risk-based:**
    - chlamydia and gonorrhea NAAT (age <25, or at risk);
    - varicella immunity (history or titer);
    - TB testing (IGRA/TST) only if at risk;
    - TSH only if at risk (not universal);
    - cervical cancer screening on the routine schedule.
  - **Weak D (Du-positive)** patients are not at risk of alloimmunization.

  [1][2][6][7][9][10][11][12][13][14][15]
- **Step 1.4 — Psychosocial and behavioral screening** *(unconditional)*:
  - **Depression and anxiety:** validated instrument (EPDS or PHQ-9; GAD-7) at the initial
    visit, later in pregnancy (Step 9.6) and postpartum. If a self-harm item is positive, assess
    suicide risk the same day.
  - **Perinatal depression prevention:** refer patients at increased risk to counseling (CBT or
    IPT). Increased risk means: history of depression, subthreshold symptoms, low income,
    adolescent or single parenthood, recent IPV, elevated anxiety or negative life events.
  - **Intimate partner violence:** screen privately at the first visit and each trimester.
  - **Substance use:** screen everyone with a validated interview tool (4Ps, NIDA Quick Screen,
    CRAFFT if ≤26; TAPS for cannabis). Biologic testing is not a screening tool and needs
    consent.
  - **Tobacco/nicotine and alcohol:** ask, advise, intervene.
  - **Social drivers of health:** standardized tool at intake; refer or coordinate.

  [1][29][30][31][32][33][34][35]
- **Step 1.5 — Genetic screening and diagnostic testing options** *(unconditional)*:
  - **Aneuploidy screening.** Make **cfDNA screening for trisomies 21, 18 and 13 routinely
    available to all** (any GA from 9–10 weeks). Every patient may pursue or decline.
  - **Serum screening** is for patient preference or when cfDNA cannot be used. The
    first-trimester combined screen (Stage 3) and quad screen (Stage 5) have fixed windows.
  - **Diagnostic testing** is available: CVS at 10–13 weeks; amniocentesis usually at
    15–20 weeks [63].
    - A positive or nonreportable cfDNA → genetic counseling, detailed ultrasound and
      diagnostic testing [4].
    - `[PAYWALL]` PB 162's clinician-level windows, and its offer-to-all wording, are not
      readable. The windows come from ACOG's patient FAQ.
  - **Carrier screening.** Offer everyone CF and SMA carrier screening, and universal
    hemoglobinopathy testing (hemoglobin electrophoresis or molecular testing) if no prior
    result. Ethnic-specific, panethnic or expanded panels are all acceptable (CO 690).
    - Fragile X only with a family history of fragile X or intellectual disability, or
      unexplained ovarian insufficiency / elevated FSH before 40.
    - Screening is done once per lifetime.
    - A carrier → offer partner testing.
  - **Every patient is offered the anatomy survey** regardless of screening method (Stage 5).

  [4][5][6][63]
- **Step 1.6 — Preeclampsia risk assessment** *(unconditional; hosts
  `gate-aspirin-indicated`)*:
  - **High-risk factors** (any one): prior preeclampsia, multifetal gestation, chronic
    hypertension, pregestational diabetes, kidney disease, SLE/APS.
  - **Moderate-risk factors** (more than one): nulliparity, BMI >30, family history, Black race
    (a proxy for racism), lower income, age ≥35, personal-history factors, IVF.
  - ACOG/SMFM: may consider with Black race or lower income alone.

  [17][18][19]
- **Step 1.7 — Start low-dose aspirin** *(gated by `gate-aspirin-indicated`)*:
  - 81 mg daily, started between 12 and 28 weeks (optimally before 16 weeks), continued daily
    until delivery.
  - Exempt from the FDA "avoid NSAIDs ≥20 weeks" advice [64].

  [17][18][19][64]
- **Step 1.8 — Supplements and healthy-pregnancy counseling** *(unconditional)*:
  - **Prenatal vitamin:**
    - folic acid 0.4–0.8 mg daily [28];
    - iron (27 mg/day requirement) [66];
    - iodine: choose a vitamin containing it (ATA: 150 mcg/day as potassium iodide, via NIH
      ODS) [67].
    - **After a prior NTD-affected pregnancy: folic acid 4 mg daily** as a separate supplement
      through the first 3 months. CDC says start 1 month before conception [65]; ACOG FAQ says
      ≥3 months before [66].
    - Do not exceed the recommended dose (vitamin A) [66].
  - **Nutrition and food safety:** avoid listeria sources; 2–3 servings a week of low-mercury
    fish; caffeine <200 mg/day.
  - **No alcohol; stop tobacco and cannabis.**
  - **Weight gain** per IOM by pre-pregnancy BMI.
  - **Activity:** ≥150 min/week moderate.
  - **Oral health:** dental care is safe; refer if the last exam was >6 months ago.
  - **Travel and seat belts.**
  - **Medications:** avoid NSAIDs from 20 weeks, except aspirin 81 mg [64].
  - **Urgent maternal warning signs**, from the first visit onward.

  [28][36][37][38][39][40][41][45][51][64][65][66][67][68]
- **Step 1.9 — Immunizations at any gestational age** *(unconditional)*:
  - **Inactivated or recombinant influenza vaccine** in any trimester during the season
    (third-trimester patients as soon as vaccine is available; LAIV is contraindicated).
  - **COVID-19 vaccine per ACOG** (D-26; conflict stated in Med-4).
  - **Hepatitis B vaccine** if susceptible on the triple panel (Engerix-B, Heplisav-B,
    Recombivax HB or Twinrix; PreHevbrio is not recommended in pregnancy).
  - **MMR and varicella are contraindicated in pregnancy.** Give postpartum if non-immune.

  [24][25][27]

### Stage 2 — Every prenatal visit

- **Step 2.1 — Blood pressure at every visit** *(unconditional; hosts `gate-bp-elevated`)*: a
  positive screen is systolic ≥140 or diastolic ≥90 mm Hg. Confirm with repeat measurement;
  the diagnosis needs two readings ≥4 hours apart. Severe range is ≥160/≥110. [16]
- **Step 2.2 — Elevated blood pressure: confirm and hand off** *(gated by `gate-bp-elevated`)*:
  - **Severe range (≥160/110):** same-day evaluation.
  - **At ≥20 weeks**, record **R03.0** (elevated BP reading without a diagnosis of hypertension)
    until confirmed. Once confirmed, record O13.x (gestational hypertension) or O14.x
    (preeclampsia). The GHTN pathway matches on those codes on the next resolve.
  - **Before 20 weeks**, evaluate for chronic hypertension (out of scope).
  - Urine protein testing only when preeclampsia is suspected; routine dipstick is not
    recommended.

  [16]
- **Step 2.3 — Routine per-visit assessment** *(unconditional)*:
  - weight;
  - fetal heart activity at appropriate GA. It adds nothing when the patient confirms fetal
    movement, but may reassure;
  - fundal height at in-person visits from 24 weeks [1]. If it differs from GA by more than
    3 cm, order a growth ultrasound. PB 227 calls this a "proposed" threshold [50]
    (`[PAYWALL]`, read via a mirror);
  - fetal movement after quickening;
  - symptoms: contractions, fluid leakage, bleeding.
  Home BP and weight self-monitoring is acceptable when the patient is trained and equipped.
  [1][2][50]
- **Step 2.4 — Tailored visit schedule** *(unconditional)*:
  - Average risk: intake plus about 8 visits.
    - In person at about 10, 16, 28, 36 and 39 weeks.
    - Any modality at 22, 32 and 38 weeks.
    - Anatomy ultrasound at about 20 weeks.
  - Greater-than-average risk: intake plus about 13 visits.
  - Telehealth where no exam, lab, imaging or vaccine is needed.
  - "Tailored care does not mean less care."
  [1][2]

### Stage 3 — First trimester (before 14 0/7 weeks)

- **Step 3.1 — Dating and viability ultrasound, if not already done** *(unconditional)*:
  first-trimester ultrasound, CRL-based. [3]
- **Step 3.2 — First-trimester aneuploidy screening window (serum/NT), for patients choosing
  serum screening** *(unconditional)*: the first-trimester combined screen (NT ± nasal bone,
  PAPP-A, free β-hCG) at **10 0/7–13 6/7** weeks, or NT alone. Not needed if the patient chose
  cfDNA. [4]

### Stage 4 — Early diabetes testing (before 24 0/7 weeks)

- **Step 4.1 — Assess risk factors for undiagnosed pregestational diabetes** *(unconditional;
  hosts `gate-early-testing-indicated`)*: apply ADA Table 2.5 at the first visit.
  - BMI ≥25 (≥23 if Asian ancestry) **plus** ≥1 of: first-degree relative with diabetes;
    high-risk race, ethnicity or ancestry; CVD; hypertension; HDL <35 or TG >250; PCOS;
    physical inactivity; other insulin-resistance conditions.
  - **Or**, regardless of BMI: prediabetes (A1C ≥5.7%); **GDM in a prior pregnancy** (D-12
    lands here).
  - ADA also advises considering testing everyone before 15 weeks.
  [52][55][56][58]
- **Step 4.2 — Early testing for overt diabetes: HbA1c** *(gated by
  `gate-early-testing-indicated`; hosts `gate-overt-diabetes` and
  `gate-early-abnormal-glucose`)*:
  - Before 15 weeks if possible, with nonpregnant criteria. Pathway test: HbA1c (≥6.5% =
    diabetes; D-6).
  - Alternatives: FPG ≥126; 2-h 75-g ≥200; random ≥200 with classic symptoms.
  - One-step/two-step GDM criteria are **not** applied before 24 weeks.
  - Confirm without unequivocal hyperglycemia.
  [52][55]
- **Step 4.3 — Overt diabetes in pregnancy: confirm and hand off** *(gated by
  `gate-overt-diabetes`)*:
  - Confirm with a second abnormal test unless unequivocal.
  - Classify as diabetes complicating pregnancy, not GDM.
  - Record the pre-existing diabetes code: **O24.111/.112/.113/.119** (pre-existing type 2
    diabetes in pregnancy, 1st/2nd/3rd/unspecified trimester), or O24.911–.919 if the type is
    unspecified. Both verified.
  - Manage as pregestational diabetes (no Prism pathway yet, §18).
  [55]
- **Step 4.4 — Early abnormal glucose metabolism: counseling and fasting-glucose monitoring**
  *(gated by `gate-early-abnormal-glucose`)*:
  - **Definition:** A1C 5.9–6.4% before 15 weeks. A higher-risk marker, **not** a GDM
    diagnosis; do not code O24.4-.
  - **Management:** nutrition counseling; fasting glucose 3–4 times a week.
  - ACOG no longer recommends early GDM screening (D-7).
  - Universal screening at 24–28 weeks still applies.
  [52][55][56]
- **Step 4.5 — Plan universal GDM screening at 24–28 weeks** *(unconditional)*: every patient
  not already diagnosed is screened, **including those whose early testing was negative**.
  [53][55][57]

### Stage 5 — Second-trimester screening (14 0/7–23 6/7 weeks)

- **Step 5.1 — Fetal anatomy ultrasound at 18–22 weeks** *(unconditional)*:
  - Offered to all regardless of aneuploidy screening method.
  - It also dates a pregnancy not yet dated before 22 0/7 weeks.
  [1][3][4]
- **Step 5.2 — Second-trimester serum screening / open neural tube defect assessment**
  *(unconditional)*:
  - **Quad screen** 15–22 weeks for patients choosing serum screening without a
    first-trimester screen.
  - **Open neural tube defects:** assess by second-trimester ultrasound ± maternal serum AFP.
    First-trimester AFP does not replace second-trimester AFP.
  [4]

### Stage 6 — From 24 0/7 weeks: 24–28-week labs and GDM screening status

- **Step 6.1 — Repeat CBC at 24–28 weeks** *(unconditional)*: anemia rescreen. [1][2]
- **Step 6.2 — GDM screening status and strategy** *(unconditional; hosts
  `gate-gdm-screening-status`)*:
  - Universal screening at 24 0/7 weeks or later.
  - Screen as soon as possible if first seen after 28 weeks.
  - After bariatric surgery with dumping, a glucose load may not be tolerated. Consider
    alternatives. `[GAP]` The primary PB 105 text is paywalled.
  [53][55][57]
- **Step 6.3 — GDM screening complete (negative at ≥24 weeks)** *(router target only)*:
  - No repeat screening unless clinically suspected (new glycosuria, suspected macrosomia or
    polyhydramnios).
  - Judgment; no guideline mandates a retest.
  [53]
- **Step 6.4 — Diabetes already diagnosed this pregnancy: follow the diabetes pathway**
  *(router target only)*:
  - GDM → `gestational-diabetes-management`, which matches on O24.41x. Confirm O24.410 is on
    the problem list.
  - Pregestational/overt → out of scope.
  - No screening is ordered.
  [55][56]

### Stage 7 — Two-step GDM screening and diagnosis

- **Step 7.1 — 50-g 1-hour glucose challenge test** *(unconditional; hosts `gate-gct-positive`)*:
  - Nonfasting 50-g load; plasma glucose at 1 hour.
  - Positive at **≥140 mg/dL** (D-3).
  - A patient with a positive early 50-g screen and a negative diagnostic test goes straight to
    the diagnostic test at 24–28 weeks without repeating the 50-g (PB 180). Clinician text; not
    encoded.
  [53][54][55][57]
- **Step 7.2 — 100-g 3-hour OGTT** *(gated by `gate-gct-positive`; hosts
  `gate-100g-diagnostic`)*:
  - After a ≥8-hour fast, give the 100-g load; draw plasma glucose fasting and at 1, 2 and
    3 hours.
  - Carpenter–Coustan thresholds: **95 / 180 / 155 / 140 mg/dL**.
  - GDM if **≥2** values are met or exceeded (D-4).
  - **Record O99.810** (abnormal glucose complicating pregnancy) while awaiting the result.
  [53][55][57][58]
- **Step 7.3 — Diagnose GDM (two-step): add O24.410 to the problem list** *(gated by
  `gate-100g-diagnostic`)*:
  - Record **O24.410** (GDM in pregnancy, diet controlled), replacing O99.810.
  - The gestational diabetes management pathway starts on the next resolve (D-1).
  - Counsel (Guid-A4).
  [53][55][56]

### Stage 8 — One-step GDM screening and diagnosis

- **Step 8.1 — 75-g 2-hour OGTT** *(unconditional; hosts `gate-75g-diagnostic`)*:
  - Morning, after a ≥8-hour fast; plasma glucose fasting and at 1 and 2 hours.
  - IADPSG thresholds: **92 / 180 / 153 mg/dL**.
  - GDM if **any one** value is met or exceeded.
  [55][57]
- **Step 8.2 — Diagnose GDM (one-step): add O24.410 to the problem list** *(gated by
  `gate-75g-diagnostic`)*: as Step 7.3. [55][56]

### Stage 9 — From 27 0/7 weeks: third-trimester care

- **Step 9.1 — Tdap vaccine** *(unconditional)*:
  - One dose each pregnancy, as early in the **27–36-week** window as possible, whatever the
    prior Tdap history.
  - May be co-administered with influenza, COVID-19 and RSV vaccines [26][27].
  [24][25][26][27]
- **Step 9.2 — Review Rh(D) status** *(unconditional; hosts `gate-rh-negative` and
  `gate-rh-positive`)*: from the initial type (Step 1.3). [21][22]
- **Step 9.3 — Rh(D)-negative: repeat antibody screen, then Rh(D) immune globulin 300 µg at
  about 28 weeks** *(gated by `gate-rh-negative`)*:
  - **Only if unsensitized** (antibody screen negative). A sensitized patient goes to MFM.
  - **Not needed** if the father or sperm donor is known Rh(D)-negative, or the fetus is
    Rh(D)-negative by cfDNA. Routine cfDNA RhD genotyping is reserved for shortages.
  - **Postpartum dose** within 72 hours if the newborn is Rh-positive.
  - **Give also after sensitizing events:** bleeding after 20 weeks, abdominal trauma, ECV,
    amniocentesis/CVS, ectopic pregnancy, loss at ≥12 weeks. Routine RhIG is forgone for loss
    or abortion before 12 0/7 weeks (ACOG CPU 2024).
  [21][22][23]
- **Step 9.4 — Rh(D)-positive: no antenatal anti-D prophylaxis** *(gated by `gate-rh-positive`)*:
  - Document it.
  - Weak D (Du) is treated as not at risk.
  [21][2]
- **Step 9.5 — Third-trimester infection rescreening** *(unconditional)*:
  - **Syphilis:** universal third-trimester and birth rescreening (ACOG 2024). CDC is
    risk-based; conflict in §18.
  - **HIV:** before 36 weeks if at risk or in a high-incidence setting.
  - **Chlamydia/gonorrhea:** if age <25 or at continued risk.
  [8][10][11][15]
- **Step 9.6 — Repeat psychosocial screening and birth/postpartum planning** *(unconditional)*:
  - **Screening:** depression/anxiety screen "later in pregnancy"; IPV this trimester.
  - **Fetal movement:** know the baby's pattern.
  - **Breastfeeding:** intention, support and referral.
  - **Reproductive life plan and postpartum contraception:** avoid interpregnancy intervals
    <6 months; discuss the risks <18 months.
    - For **Medicaid sterilization**, consent must be signed ≥30 days before the procedure
      (42 CFR 441.253).
  - **Postpartum care plan:** contact within 3 weeks; comprehensive visit by 12 weeks.
  [29][31][42][43][44]

### Stage 10 — Maternal RSV vaccine window (32 0/7–36 6/7 weeks)

- **Step 10.1 — Offer maternal RSV vaccine (RSVpreF, Abrysvo) or plan infant nirsevimab/
  clesrovimab** *(unconditional)*:
  - **Dose:** one dose at 32 0/7–36 6/7 weeks, in season.
  - **Season conflict:** ACOG Sept 1–Mar 1 (updated Aug 2026) vs CDC Sept–Jan (§18).
  - **Not if:**
    - vaccinated in a prior pregnancy (the infant gets the monoclonal instead);
    - delivery is planned within 2 weeks (ACOG);
    - the family plans the infant monoclonal instead.
  - Only Abrysvo is approved in pregnancy.
  [24][25][26]

### Stage 11 — From 36 0/7 weeks: GBS, presentation and birth planning

- **Step 11.1 — Group B streptococcus vaginal–rectal culture at 36 0/7–37 6/7 weeks**
  *(unconditional)*:
  - **Regardless of planned mode of birth.**
  - **Not needed** if there was GBS bacteriuria at any colony count this pregnancy (the UTI
    pathway identifies it), or a prior GBS-infected newborn. Both get intrapartum prophylaxis.
  - **Prior-pregnancy colonization does not exempt.**
  - Note a penicillin allergy on the requisition.
  [20]
- **Step 11.2 — Assess fetal presentation; offer ECV for breech** *(unconditional)*:
  - Check and document presentation from 36 0/7 weeks.
  - Offer ECV near term to patients with a breech presentation and no contraindications.
  - Anti-D after ECV if Rh-negative.
  [1][48]
- **Step 11.3 — Birth timing and labor planning** *(unconditional)*:
  - **39-week induction:** for a low-risk nulliparous patient, elective induction at 39 0/7
    weeks may be discussed (ACOG CPU 2025, updating PB 146). No nonmedical delivery before
    39 weeks.
  - **Prior cesarean:** TOLAC vs repeat-cesarean counseling (PB 205).
  - **Labor:** signs of labor; when to come in.
  [47][49][62]

### Stage 12 — From 41 0/7 weeks: late-term surveillance and delivery

- **Step 12.1 — Antenatal fetal surveillance once or twice weekly from 41 0/7 weeks; plan
  delivery** *(unconditional)*:
  - Surveillance is recommended from 41 0/7 weeks until 42 0/7, when delivery is indicated.
  - Induction may be considered at 41 0/7–41 6/7.
  - Induction is recommended after 42 0/7 and by 42 6/7 weeks (PB 146).
  - Membrane sweeping reduces late-term pregnancy.
  [46][47]

## 4. Decision points

None. v2's branchless `dp-1` (visit modality) is dropped. Its content is the tailored-schedule
text on Step 2.4. Every machine-evaluable decision is a gate (§4b). No remaining decision is
descriptive judgment with distinct branch content.

## 4b. Gates

**Framing:**
- **Chart gates (14):**
  - eight `patient.gestational_age_weeks` gates, one datum, all `ask`;
  - one BP gate;
  - two Rh gates;
  - three GDM lab gates.
- **Question gates (4):**
  - aspirin eligibility;
  - early-testing eligibility;
  - the GDM status router;
  - Carpenter–Coustan.

Every gate is the **sole route** to its target. Every chart gate has one target. The two routers
map every option.

### Gestational-age gates (all attached to `step-1-1`)

Common to all eight:
- **Type:** `patient_attribute` (or `compound` AND for a two-sided window), attribute form.
- **Attribute:** `patient.gestational_age_weeks`, unit `weeks`, **display `"Gestational age
  (completed weeks)"`**. No horizon or status, because `patient.*` has no temporal policy.
- **Default behavior:** `skip`.
- **On unresolved: ask.** A missing GA pends the stage and asks one NUMERIC question for
  `patient.gestational_age_weeks`, labelled by the display. All eight gates share the datum, so
  it is asked once.
- **Physiologic drift:** GA advances 1 week per week, so the gates re-read it every resolve and
  stages open and close with the pregnancy. There is no trend operator.

| Gate | Condition | Branches to (exclusively) | Rationale & source (host Step 1.1) |
|---|---|---|---|
| `gate-ga-first-trimester` | GA `less_than` 14 | `stage-3` | First trimester is <14 0/7 [58]; dating US ≤13 6/7 [3]; first-trimester screen 10–13 6/7 [4] |
| `gate-ga-before-24` | GA `less_than` 24 | `stage-4` | Early diabetes testing applies before universal screening at 24 weeks [52][55] |
| `gate-ga-14-to-24` | **compound AND**: GA `greater_or_equal` 14; GA `less_than` 24 | `stage-5` | Quad 15–22; anatomy 18–22; both conditions share one datum [4] |
| `gate-ga-24-plus` | GA `greater_or_equal` 24 | `stage-6` | CBC and GDM screening at 24–28; late entrants screen as soon as possible, so no upper bound [53][57] |
| `gate-ga-27-plus` | GA `greater_or_equal` 27 | `stage-9` | Tdap window opens at 27; RhIG ~28 after the antibody screen [21][24] |
| `gate-ga-32-to-37` | **compound AND**: GA `greater_or_equal` 32; GA `less_than` 37 | `stage-10` | RSVpreF 32 0/7–36 6/7 only [25][26] |
| `gate-ga-36-plus` | GA `greater_or_equal` 36 | `stage-11` | GBS 36 0/7–37 6/7; presentation from 36 0/7 [20][48] |
| `gate-ga-41-plus` | GA `greater_or_equal` 41 | `stage-12` | Surveillance from 41 0/7 [46] |

- **Upper bounds deliberately omitted** on Stages 6, 9, 11 and 12. A late entrant still needs
  the content (GDM screening "as soon as possible", Tdap by 36, GBS by 37 6/7). Stage 11's GBS
  step says the culture window is 36–37 6/7. A patient at 38 weeks without a culture is
  catch-up, not excluded.
- **Why GA gates and not a trimester router:** Josh's rule, now that `patient.*` asks. The
  simulator sends GA, and the preview flow asks.

### `gate-aspirin-indicated` — Does this patient qualify for low-dose aspirin prophylaxis?

- **Attached to:** `step-1-6` · **Branches to:** `step-1-7` (no `HAS_STEP`; exclusively gated)
- **Type:** question · answer_type **BOOLEAN** · **default behavior:** skip ("no" means aspirin
  is not added).
- **Prompt:** **verbatim** from GHTN `gate-aspirin-indicated`, so a co-matched patient answers
  the same question twice and the answers mean the same thing:
  > "Does this patient qualify for low-dose aspirin prophylaxis? Qualifies with ANY ONE
  > high-risk factor (prior preeclampsia, multifetal gestation, chronic hypertension,
  > pregestational type 1 or 2 diabetes, kidney disease, autoimmune disease such as SLE or
  > antiphospholipid syndrome); OR TWO OR MORE moderate-risk factors (nulliparity, BMI >30,
  > family history of preeclampsia in mother or sister, Black race, lower income, age 35 or
  > older, personal history factors, in vitro conception); OR, on its own, Black race or lower
  > income."
- **`[NOT ENCODABLE]` as a chart gate:**
  - The rule is `any(high) OR count(moderate) ≥2 OR single(Black race | lower income)`. There
    is no nesting and no counting.
  - Several factors are uncoded: family history, income, nulliparity, race.
- **Rationale & source:** [17][18][19] → Step 1.6.

### `gate-bp-elevated` — BP at or above 140/90 today? (D-25)

- **Attached to:** `step-2-1` · **Branches to:** `step-2-2` (exclusively gated)
- **Type:** compound **OR** · **default behavior:** skip
- **Conditions** (coded, `field: vitals`, **no `system`**, horizon **DAY**):
  - `systolic_bp` `greater_than` threshold **139.9**, display `"Systolic BP (mmHg)"`;
  - `diastolic_bp` `greater_than` threshold **89.9**, display `"Diastolic BP (mmHg)"`.
- **On unresolved: ask.** BP is measured every visit, so a missing value is a missing
  measurement.
- **Identical to GHTN's `gate-bp-elevated`,** so the datum keys match.
- Vitals only. There is no LOINC 8480-6 OR arm (the spec's asks-forever trap).
- **Rationale & source:** [16] → Step 2.1.

### `gate-early-testing-indicated` — Early testing for undiagnosed diabetes indicated?

- **Attached to:** `step-4-1` · **Branches to:** `step-4-2` (exclusively gated)
- **Type:** question · **BOOLEAN** · **default behavior:** skip. "No" means no early test;
  universal screening (Step 4.5) is unaffected.
- **Prompt:**
  > "Does this patient meet criteria for early testing for undiagnosed diabetes, AND is
  > diabetes not already diagnosed this pregnancy? Criteria: BMI 25 or higher (23 or higher
  > if Asian ancestry) PLUS at least one of: first-degree relative with diabetes; high-risk
  > race, ethnicity or ancestry; history of cardiovascular disease; hypertension; HDL below 35
  > or triglycerides above 250; polycystic ovary syndrome; physical inactivity; other
  > insulin-resistance conditions (e.g., acanthosis nigricans). OR, regardless of BMI:
  > prediabetes (A1C 5.7% or higher) or gestational diabetes in a prior pregnancy. (ADA also
  > advises considering early testing for all patients.)"
- **`[NOT ENCODABLE]` as a chart gate:** nested AND/OR with a count. BMI is not codeable in
  pregnancy (Z68 is forbidden). Several factors are uncoded.
- **`[GAP]`** The ACOG CPU 2024 risk-factor table is paywalled. The prompt uses ADA Table 2.5.
- **Rationale & source:** [52][55][56] → Step 4.1.

### `gate-overt-diabetes` — Early HbA1c in the diabetes range?

- **Attached to:** `step-4-2` · **Branches to:** `step-4-3` (exclusively gated)
- **Type:** patient_attribute (coded) · **default behavior:** skip
- **Condition:** field `labs`, `greater_than`, value `4548-4`, system `LOINC`, threshold
  **6.49** (≥6.5%), display `"Hemoglobin A1c (%)"`, horizon `QUARTER`.
- **On unresolved: ask.** The subtree is held until an A1C is entered.
- **Rationale & source:** ADA Table 2.1, Rec 2.31a [55] → Step 4.2.

### `gate-early-abnormal-glucose` — Early HbA1c 5.9–6.4%? (D-7)

- **Attached to:** `step-4-2` · **Branches to:** `step-4-4` (exclusively gated; mutually
  exclusive with `gate-overt-diabetes` by construction)
- **Type:** compound **AND** · **default behavior:** skip
- **Conditions:** both labs `4548-4`, LOINC, display `"Hemoglobin A1c (%)"`, horizon `QUARTER`:
  - `greater_than` 5.89;
  - `less_than` 6.5.
- **On unresolved: ask.** Same datum as `gate-overt-diabetes`, so ONE question.
- **Rationale & source:** ADA Rec 2.31b [55][56] → Step 4.2.

### `gate-gdm-screening-status` — GDM screening status and strategy (D-22, D-5)

- **Attached to:** `step-6-2` · **Router** (multi-target question), **SELECT**, every option
  mapped once with `when: {"equals": "<option>"}`:

  | Option (exact string) | Target |
  |---|---|
  | `"Not yet screened or in progress — two-step (50-g challenge, then 100-g OGTT if positive)"` | `stage-7` |
  | `"Not yet screened or in progress — one-step (75-g 2-hour OGTT)"` | `stage-8` |
  | `"Screened at 24 weeks or later — negative"` | `step-6-3` |
  | `"Diabetes already diagnosed this pregnancy (gestational or pregestational)"` | `step-6-4` |

- **Exclusively gated:** yes. Stages 7 and 8 have no root edge; Steps 6.3 and 6.4 have no
  `HAS_STEP`.
- **Type:** question · SELECT · **default behavior:** skip (consulted only if it cannot route).
- **Prompt:**
  > "Gestational diabetes screening this pregnancy: not yet screened or in progress (including
  > an abnormal 1-hour challenge awaiting the diagnostic OGTT) — two-step or one-step; screened
  > at 24 weeks or later with a negative result; or diabetes (gestational or pregestational)
  > already diagnosed this pregnancy?"
- **Why a question:**
  - Three of the four states are negations: not screened, negative, not diagnosed.
  - The strategy is site configuration Prism cannot store (D-5).
  - Without it, a diagnosed patient (O09 + O24.41x, or an O24.41x trigger under D-21) would be
    re-screened, and the 50-g gate would ask her for a GCT.
- **GA is not in this question.** GA is read by `gate-ga-24-plus` in front of it.
- **Rationale & source:** [53][55][57] → Step 6.2.

### `gate-gct-positive` — 50-g challenge at or above 140 mg/dL? `[DECISION D-3 — Josh 2026-09-24]`

- **Attached to:** `step-7-1` · **Branches to:** `step-7-2` (exclusively gated)
- **Type:** patient_attribute (coded) · **default behavior:** skip
- **Condition:** field `labs`, `greater_than`, value `1504-0`, system `LOINC`, threshold
  **139.9**, display `"Glucose 1 h post 50 g glucose (mg/dL)"`, horizon `QUARTER`.
- **On unresolved: ask.** The OGTT step is held ("Awaiting LOINC:1504-0") until the GCT is
  resulted.
  - At the visit that orders the GCT, a single-pathway session cannot generate its plan until
    the value is entered (D-29).
  - The GCT order itself (Step 7.1) is unconditional in Stage 7.
- **Horizon note:** a GCT drawn early (~12 weeks) for risk factors is still inside QUARTER at
  24 weeks.
  - If it was **positive**, the gate opens the 100-g OGTT. That matches PB 180: go straight to
    the diagnostic test.
  - If it was **negative**, it is read as negative. Step 4.5 and Step 7.1 still direct a
    24–28-week screen, and the new result becomes the latest value.
- **`[GAP]`** GCT ≥200 treated as diagnostic: no accessible US source. Not built.
- **Rationale & source:** [53][55][57] → Step 7.1.

### `gate-100g-diagnostic` — 100-g OGTT meets Carpenter–Coustan criteria? `[DECISION D-4 — Josh 2026-09-24]`

- **Attached to:** `step-7-2` · **Branches to:** `step-7-3` (exclusively gated)
- **Type:** question · **BOOLEAN** · **default behavior:** skip
- **Prompt:**
  > "Does the 100-g 3-hour OGTT meet Carpenter–Coustan criteria — at least TWO values at or
  > above: fasting 95, 1-hour 180, 2-hour 155, 3-hour 140 mg/dL?"
- **Why still a question (D-4 asked: is a compound encoding now possible?) No.** The engine
  has no N-of-M operator. A compound is one flat AND or OR, with no nesting. Candidates
  examined:
  - **OR over the four values** encodes "≥1 abnormal", the single-value criterion. D-4
    rejected it; ADA warns it markedly raises incidence.
  - **AND over the four values** encodes "all 4 abnormal", which misses most GDM.
  - **Six pairwise AND gates** (each pair of the 4 values), one per target:
    - Rule 2 forbids two gates on one target, so it needs six **duplicate** "Diagnose GDM"
      steps, each with its own O24.410 CodeEntry.
    - A patient with three abnormal values would see three identical diagnosis steps.
    - Each AND asks for its missing values one at a time, up to 4 asks, though all come from
      one test.
    - Faithful in logic but not in the care plan. **Rejected.**
  - **`count_in_window` over the four LOINCs** counts *results*, not above-threshold results.
    It also needs dated facts (the simulator dates nothing). **Not faithful.**
- The question keeps the decision exact, and the four values sit on the Step 7.2 lab node.
- **Rationale & source:** [53][55][57] → Step 7.2.

### `gate-75g-diagnostic` — Any 75-g OGTT value at or above IADPSG threshold?

- **Attached to:** `step-8-1` · **Branches to:** `step-8-2` (exclusively gated)
- **Type:** compound **OR** · **default behavior:** skip
- **Conditions** (coded; each `labs`, `greater_than`, `LOINC`, horizon `QUARTER`):

  | LOINC | Threshold | Display |
  |---|---|---|
  | `1552-9` | **91.9** | `"Glucose fasting, pre 75 g glucose (mg/dL)"` |
  | `1507-3` | **179.9** | `"Glucose 1 h post 75 g glucose (mg/dL)"` |
  | `1518-0` | **152.9** | `"Glucose 2 h post 75 g glucose (mg/dL)"` |

- **On unresolved: ask.** All three values come from one test, so this is not the
  alternative-tests OR trap.
- **`[SIM]`** 1552-9, 1507-3 and 1518-0 are not seeded.
- **Load-agnostic reporting:** the generic post-dose LOINCs (20436-2 etc.) would not match.
- **Rationale & source:** ADA Table 2.8 [55]; USPSTF [57] → Step 8.1.

### `gate-rh-negative` / `gate-rh-positive` — Rh(D) type (D-24)

- **Attached to:** `step-9-2`, both.
- **Branches to:**
  - `gate-rh-negative` → `step-9-3`;
  - `gate-rh-positive` → `step-9-4`.
  Each target is exclusively gated, with no `HAS_STEP`.
- **Type:** patient_attribute (attribute form) · **default behavior:** skip
- **Conditions:**
  - `patient.rh_factor` `equals` `"negative"`, display `"Rh(D) type"`;
  - `patient.rh_factor` `equals` `"positive"`, display `"Rh(D) type"`.
- **On unresolved: ask** (`patient.*` asks since `8f64fc1`).
  - A missing Rh raises ONE SELECT question, datum `patient.rh_factor`.
  - Its options are **pooled from both gates**: `["negative", "positive"]`.
  - The pair is what makes an Rh-positive patient answerable (§0.6 #5).
- **Vocabulary risk:** the chart feed must populate `rh_factor` with exactly
  `"negative"`/`"positive"`. Any other string ("Rh-", "neg") evaluates as neither, and both
  gates answer no. Confirm against the patient-context builder.
- **"Unsensitized"** (a negative antibody screen) is not encoded. It cannot be read as a
  negative, and it is in the step text.
- **Rationale & source:** [21][22] → Step 9.2.

## 5. Medications

No `ESCALATES_TO` chains; none apply.

- **Med-1 — Prenatal vitamin with folic acid 0.4–0.8 mg** (on Step 1.8)
  - **Role:** first_line · **clinical role:** `prenatal-vitamin-supplementation`
  - **Dose:** one tablet PO daily, containing folic acid 400–800 mcg, iron (to meet 27 mg/day)
    and iodine (150 mcg as potassium iodide, per ATA via NIH ODS).
  - **Duration:** start ≥1 month before conception if possible; continue through pregnancy.
  - **Notes:**
    - 4 mg folic acid as a separate supplement after a prior NTD-affected pregnancy (text in
      Step 1.8; no second node, because it would conflict in the lane for every patient).
    - Do not exceed the labelled dose (vitamin A).
    - Iron supplementation is ACOG-universal low-dose; USPSTF gives an I statement.
  - **Code:** RxNorm folic acid IN **4511** (verified). No RxNorm ingredient exists for
    "prenatal vitamins" (product-level only). An SCD is 198640 (folic acid 0.4 MG Oral Tablet).
    v2's 310488 is **glipizide** (§0.7).
  - **Source:** [28][65][66][67]
- **Med-2 — Aspirin 81 mg** (on Step 1.7)
  - **Role:** first_line · **clinical role:** `preeclampsia-prophylaxis`, the **same name and
    lane as GHTN `med-1`**, so the merge shows one.
  - **Dose:** 81 mg PO once daily. Start at 12–28 weeks, optimally before 16. Continue daily
    until delivery.
  - **Notes:** exempt from FDA's NSAID ≥20-week advice. Not for GDM alone, unexplained
    stillbirth, FGR or preterm-birth prevention without preeclampsia risk.
  - **Code:** RxNorm aspirin IN 1191; SCD 243670 (81 mg oral tablet).
  - **Source:** [17][18][19][64]
- **Med-3 — Influenza vaccine, inactivated or recombinant** (on Step 1.9)
  - **Role:** first_line · **clinical role:** `influenza-immunization`
  - **Dose:** one dose IM per season, any trimester.
  - **Notes:** LAIV is contraindicated in pregnancy (usable postpartum). Can be co-administered
    with Tdap, RSV and COVID-19 vaccines.
  - **Code:** CPT 90656 (IIV3 PF 0.5 mL), 90673 (RIV3).
  - **Source:** [24][25][27]
- **Med-4 — COVID-19 vaccine (current-season formulation)** (on Step 1.9) `[DECISION D-26]`
  - **Role:** first_line (per ACOG) · **clinical role:** `covid-immunization`
  - **Dose:** one dose IM of the current-season product, any trimester. `[GAP]` The
    product-specific dose was not fetched.
  - **Notes:** **conflict.**
    - ACOG CS 26 (Feb 2026): "All pregnant and lactating individuals should receive an updated
      COVID-19 vaccine… any trimester."
    - CDC adult schedule (Jul 2 2025), Table 2: pregnancy cell "No Guidance/Not Applicable".
    - CDC interim considerations (Sep 2026) urge a review of risks and benefits.
    - State both to the patient; shared decision.
  - **Code:** `[GAP]` 2026–27 product CPTs are not in the CDC crosswalk.
  - **Source:** [24][25]
- **Med-5 — Tdap vaccine** (on Step 9.1)
  - **Role:** first_line · **clinical role:** `pertussis-immunization`
  - **Dose:** one dose IM each pregnancy, early in the 27–36-week window.
  - **Notes:** any Tdap product. `[GAP]` The 0.5 mL volume was not confirmed from a fetched
    label.
  - **Code:** CPT 90715.
  - **Source:** [24][25]
- **Med-6 — Rho(D) immune globulin 300 mcg** (on Step 9.3)
  - **Role:** first_line (Rh-negative, unsensitized) · **clinical role:**
    `rh-immune-globulin-prophylaxis`
  - **Dose:** 300 µg (1500 IU) IM at about 28 weeks, after the repeat antibody screen. Repeat
    postpartum within 72 h if the newborn is Rh-positive, and within 72 h of a sensitizing
    event.
  - **Timing discrepancy:** the label says 26–28 weeks; USPSTF says after the 24–28-week
    antibody screen; ACOG says 28 weeks.
  - **Notes:**
    - Contraindicated if Rh-positive.
    - Give where anaphylaxis can be managed.
    - Protects only the pregnancy in which it is given.
  - **Label conflict:** the RhoGAM label still lists termination and loss up to and including
    12 weeks. The ACOG CPU (Dec 2024) forgoes routine RhIG before 12 0/7 weeks.
  - **Codes:**
    - RxNorm Rho(D) immune globulin IN **35465** (verified). v2's 5641 is a retired
      identifier.
    - The 300 mcg product SCD is 731381.
    - HCPCS **J2790** (verified). It is not a CodeEntry system, so it is noted only.
  - **Source:** [21][22][23]
- **Med-7 — RSV vaccine, RSVpreF (Abrysvo)** (on Step 10.1)
  - **Role:** first_line (one of two alternatives; the other is the infant's monoclonal, a
    neonatal order) · **clinical role:** `rsv-maternal-immunization`
  - **Dose:** one dose IM at 32 0/7–36 6/7 weeks in season; once for life (not repeated in
    later pregnancies).
  - **Notes:** Arexvy and mResvia are not approved in pregnancy.
  - **Code:** CPT 90678.
  - **Source:** [25][26]

**Not given nodes** (text only, deliberately):
- **Folic acid 4 mg:** a second node in the vitamin lane would raise a lane conflict for every
  patient.
- **Hepatitis B vaccine:** susceptibility-dependent.
- **MMR and varicella:** contraindicated antepartum and postpartum-only. Name-based suppression
  would be harmless, but they are not antepartum orders.
- **Doxylamine–pyridoxine:** symptom management is out of scope.

## 6. Lab tests

"One parent per node": a lab on several hosts is one node per host with the same code, and the
merge dedupes it.

**Step 1.3 — initial panel:**

| Lab | Name | LOINC | CPT | Specimen / note | Source |
|---|---|---|---|---|---|
| Lab-1 | CBC with indices | 58410-2 | 85025 | blood | [1][2] |
| Lab-2 | ABO/Rh(D) type | 882-1 | 86900, 86901 | blood | [2][22] |
| Lab-3 | RBC antibody screen | 890-4 | 86850 | blood | [2][22] |
| Lab-4 | Rubella IgG | 25514-1 | 86762 | serum | [2] |
| Lab-5 | Syphilis, treponemal and nontreponemal | RPR 20507-0; treponemal Ab 22587-0 | 86592, 86780 | serum | [7][8] |
| Lab-6 | Hepatitis B surface antigen | 5196-1 (5195-3 is also HBsAg presence) | 87340 | serum | [9] |
| Lab-7 | Hepatitis B triple panel (anti-HBs, total anti-HBc) | anti-HBs 16935-9; anti-HBc total 16933-4 | 86706, 86704 | serum; if no documented negative triple panel after age 18, incomplete vaccination, or ongoing risk | [9] |
| Lab-8 | HIV-1/2 Ag/Ab | 56888-1 | 87389 | serum/plasma | [10][11] |
| Lab-9 | Hepatitis C antibody (reflex RNA) | 13955-0 | 86803 | serum | [12] |
| Lab-10 | Urine culture (asymptomatic bacteriuria) | 630-4; colony count 19090-0 | 87086 | clean-catch; aligned with the UTI pathway | [13][14] |
| Lab-11 | Chlamydia and gonorrhea NAAT | CT 21613-5; GC 21416-3 (both seeded). rRNA assays: 43304-5 (CT), 43305-2 (GC) | 87491, 87591 | urine or vaginal; age <25 or at risk | [15] |
| Lab-12 | Hemoglobinopathy evaluation | 43113-0 | 83020 | if no prior result; aligned with anemia | [6] |
| Lab-13 | Varicella IgG | 19162-7 | 86787 | if no history or vaccination | [2] |

**Other steps:**

| Lab | Host step | Name | Code(s) | Note | Source |
|---|---|---|---|---|---|
| Lab-14 | Step 1.5 | cfDNA aneuploidy screen | CPT 81420 | — | [4] |
| Lab-15 | Step 3.2 | First-trimester serum screen (PAPP-A, hCG) | CPT 81508 | — | [4] |
| Lab-16 | Step 5.2 | Quad screen | CPT 81511 | — | [4] |
| Lab-17 | Step 4.2 | HbA1c | LOINC 4548-4, CPT 83036 | — | [55] |
| Lab-18 | Step 4.2 | Fasting plasma glucose | LOINC 1558-6 | alternative, not gated (D-6) | [55] |
| Lab-19 | Step 6.1 | CBC (repeat) | LOINC 58410-2 | — | [1] |
| Lab-20 | Step 7.1 | 50-g 1-hour glucose challenge | LOINC 1504-0, CPT 82950 | — | [53][55][57] |
| Lab-21 | Step 7.2 | 100-g 3-hour OGTT | fasting 1549-5; 1 h 1501-6; 2 h 1514-9; 3 h 1530-5; panel 50608-9; CPT 82951, 82952 | 1500-4 is not a LOINC and 1503-2 is urine (GDM v1 finding) | [53][55][57] |
| Lab-22 | Step 8.1 | 75-g 2-hour OGTT | fasting 1552-9; 1 h 1507-3; 2 h 1518-0; CPT 82951 | — | [55][57] |
| Lab-23 | Step 9.3 | RBC antibody screen (repeat, Rh-negative) | LOINC 890-4 | — | [21][22] |
| Lab-24 | Step 9.5 | Syphilis rescreen | as Lab-5 | — | [8] |
| Lab-25 | Step 9.5 | HIV rescreen | as Lab-8 | if at risk | [10][11] |
| Lab-26 | Step 9.5 | Chlamydia/gonorrhea rescreen | as Lab-11 | if <25 or at risk | [15] |
| Lab-27 | Step 11.1 | GBS vaginal–rectal culture | LOINC 72607-5 (NAAT: 91875-5); CPT 87081 (NAAT: 87653). v2's 11475-1 is a generic culture code | — | [20] |

## 7. Imaging

All three are modality US, body_region pregnant uterus.

| Img | Host step | Name | CPT | Indication | Source |
|---|---|---|---|---|---|
| Img-1 | Step 3.1 | Obstetric ultrasound, first trimester (dating/viability) | 76801 (transabdominal) or 76817 (transvaginal) | dating; CRL | [3] |
| Img-2 | Step 3.2 | Nuchal translucency ultrasound | 76813 | NT for serum screening | [4] |
| Img-3 | Step 5.1 | Fetal anatomy ultrasound | 76805; 76811 is detailed/high-risk only | anatomy survey 18–22 weeks | [1][4] |

v2 carried these as `Procedure` nodes, which is the wrong node type.

## 8. Procedures

| Proc | Host step | Name | CPT | Note | Source |
|---|---|---|---|---|---|
| Proc-1 | Step 12.1 | Fetal non-stress test | 59025 | same as GDM/GHTN, so it dedupes | [46] |
| Proc-2 | Step 12.1 | Fetal biophysical profile with non-stress testing | 76818 | same as GDM/GHTN, so it dedupes | [46] |
| Proc-3 | Step 11.2 | External cephalic version | 59412 | — | [48] |

## 9. Guidance

The text is plain-language paraphrase of the cited source, except Guid-1, which is verbatim
CDC. Topics are chosen against §0.4.

- **Guid-1 — topic `Urgent maternal warning signs`** (on Step 1.8), category safety-netting.
  - **Instructions, word for word from the CDC Hear Her page** (wave-2 checked; the list items
    keep the page's order):
    > "Be aware of urgent maternal warning signs and symptoms during pregnancy and in the year
    > after delivery. Seek medical care immediately if you experience any signs or symptoms
    > that are listed below. Headache that won't go away or gets worse over time; Dizziness or
    > fainting; Changes in your vision; Fever of 100.4°F or higher; Extreme swelling of your
    > hands or face; Thoughts about harming yourself or your baby; Trouble breathing; Chest
    > pain or fast-beating heart; Severe nausea and throwing up; Severe belly pain that doesn't
    > go away; Baby's movement stopping or slowing during pregnancy; Vaginal bleeding or fluid
    > leaking during pregnancy; Vaginal bleeding or discharge after pregnancy; Severe swelling,
    > redness, or pain of your leg or arm; Overwhelming tiredness. If you feel like something
    > just isn't right, or you aren't sure if it's serious, talk to your health care provider.
    > Be sure to tell them if you are pregnant or were pregnant within the last year.
    > (Source: CDC Hear Her campaign, available free at cdc.gov/hearher. Use does not imply
    > endorsement by CDC, ATSDR, HHS or the US Government.)"
  - **Licensing `[DECISION D-28]`:**
    - Reused with CDC's attribution, its non-endorsement disclaimer, and no change to the
      substance.
    - The CDC page states the list "was developed by the Alliance for Innovation on Maternal
      Health". AIM's own 2026 card is all-rights-reserved and **prohibits use as part of an
      LLM to generate text**.
    - Needs licensing review before shipping. Fallback: the topic plus a link to
      cdc.gov/hearher.
    - Do **not** substitute or paraphrase the AIM card text.
  - **Co-match:** recommend GHTN `guid-1` adopt this identical text, so the merge shows one
    block (§0.4).
  - **Source:** [41]
- **Guid-2 — topic `Pregnancy weight gain`** (on Step 1.8), lifestyle.
  - "How much weight is healthy to gain depends on your weight before pregnancy.
    - Underweight (BMI under 18.5): 28–40 pounds.
    - Normal weight (18.5–24.9): 25–35 pounds.
    - Overweight (25–29.9): 15–25 pounds.
    - Obesity (30 or higher): 11–20 pounds.
  - You don't need extra calories in the first trimester. Later you need only about 340 extra
    calories a day in the second trimester and about 450 in the third.
  - We will check your weight at visits and can connect you with a nutrition or activity
    program."
  - **Source:** [36][37][69]. The calorie figures are from [69].
- **Guid-3 — topic `Eating well and food safety in pregnancy`** (on Step 1.8), lifestyle.
  - "Take a daily prenatal vitamin with folic acid and iodine, and don't take more than the
    label says.
  - To avoid listeria, a germ that can harm your baby:
    - skip raw (unpasteurized) milk and cheeses made from it;
    - heat deli meats and hot dogs until steaming hot;
    - avoid refrigerated smoked fish, premade deli salads and raw sprouts.
  - Eat 2 to 3 servings a week of low-mercury fish such as salmon, shrimp, cod or canned light
    tuna. Do not eat shark, swordfish, king mackerel, marlin, orange roughy, Gulf tilefish or
    bigeye tuna.
  - Keep caffeine under 200 mg a day."
  - **Source:** [28][39][40]
- **Guid-4 — topic `Alcohol, tobacco and cannabis in pregnancy`** (on Step 1.8), education.
  - "No amount or type of alcohol is known to be safe at any time in pregnancy. If you drank
    before you knew you were pregnant, the most important thing is to stop now.
  - Quitting smoking and other tobacco at any point helps you and your baby, and we can help
    you quit.
  - There is no medical reason to use cannabis in pregnancy, and we advise stopping."
  - **Source:** [33][34][35][68]. The alcohol wording follows CDC [68]. USPSTF rates
    e-cigarettes for cessation as insufficient evidence, hence "other tobacco", not "vaping".
- **Guid-5 — topic `Staying active in pregnancy`** (on Step 1.8), lifestyle.
  - "Aim for at least 150 minutes a week of moderate activity, such as brisk walking, swimming
    or stationary cycling. You should be able to talk while exercising.
  - Avoid contact sports, activities where you might fall, scuba diving, and lying flat on your
    back for long periods later in pregnancy.
  - Stop and call us if you have vaginal bleeding, belly pain, fluid leaking, painful regular
    contractions, chest pain, dizziness, headache, shortness of breath before exercising, calf
    pain or swelling, or weakness that affects your balance."
  - **Source:** [38]
- **Guid-6 — topic `Dental care and travel in pregnancy`** (on Step 1.8), education.
  - "Dental checkups, cleanings, X-rays with a shield and numbing medicine are all safe in
    pregnancy, and needed fillings or root canals can be done at any time.
  - Always wear your seat belt, with the lap belt below your belly and the shoulder belt
    between your breasts.
  - Occasional flights are usually fine in a healthy pregnancy. On long flights, get up and
    walk around from time to time, drink fluids, and consider support stockings."
  - **Source:** [45][51][70]. The car-belt guidance is from [70].
- **Guid-7 — topic `Your baby's movements`** (on Step 9.6), safety-netting.
  - "Get to know your baby's usual pattern of movement. If your baby is moving less than usual
    or has stopped moving, call us the same day. Don't wait until the next day."
  - The "same day" instruction is a safety-netting choice consistent with CDC's warning signs,
    not a quoted threshold.
  - CC No. 8 [1] says no routine antenatal measure of fetal well-being (e.g., formal kick
    counts) has shown benefit, so none is prescribed.
  - **Source:** [1][41][46]
- **Guid-8 — topic `Breastfeeding and planning birth control`** (on Step 9.6), education.
  - "Breastfeeding has health benefits for you and your baby. The choice is yours, and if you
    would like to breastfeed we can connect you with lactation support before and after birth.
  - Let's also plan birth control for after delivery. Waiting 18 months or more before your
    next pregnancy lowers risks, and some methods can be started before you leave the
    hospital."
  - **Source:** [42][43][44]
- **Guid-9 — topic `Signs of labor and timing of birth`** (on Step 11.3), education.
  - "True labor contractions come regularly, get closer together, and don't go away with rest.
    Call us if you think you're in labor or your water breaks, and go to the hospital for heavy
    bleeding.
  - If this is your first full-term pregnancy and you and your baby are healthy, we can talk
    about an induction at 39 weeks.
  - If you haven't delivered by 41 weeks, we will check on your baby once or twice a week and
    plan delivery."
  - **Source:** [46][47][62]
- **Guid-A1 — topic `GDM screening: what the glucose test involves`** (on Step 6.2), education.
  From GDM Part A, unchanged.
  - "Every pregnant patient is checked for gestational diabetes between 24 and 28 weeks.
  - In the two-step approach you drink a 50-gram glucose drink (no fasting needed) and have
    blood drawn one hour later. If that result is high, a second, longer test follows: after an
    overnight fast you drink 100 grams of glucose and have blood drawn fasting and at 1, 2 and
    3 hours.
  - In the one-step approach you fast overnight, drink 75 grams of glucose, and have blood drawn
    fasting and at 1 and 2 hours.
  - Stay seated and do not eat or smoke during the test."
  - **Source:** [53][55]
- **Guid-A2 — topic `GDM early testing: why we test early`** (on Step 4.1), education.
  - "Some patients have type 2 diabetes before pregnancy without knowing it. If you have risk
    factors, we check an A1C blood test at your first visit so that diabetes can be treated
    from the start.
  - Even if this early test is normal, you will still have the standard glucose test at 24–28
    weeks."
  - **Source:** [55][56]
- **Guid-A4 — topic `GDM diagnosis: what happens next`** (on Step 7.3; duplicate node Guid-A4b,
  same topic and text, on Step 8.2), education.
  - "Gestational diabetes means your body is not handling sugar as well as it needs to during
    pregnancy. Most patients (about 70–85%) control it with changes in eating and activity
    alone.
  - We will refer you to a dietitian and teach you to check your blood sugar at home.
  - Well-controlled gestational diabetes lowers the chance of a very large baby, birth injury
    and low blood sugar in your newborn."
  - **Source:** [53][56]
- **Guid-A5 — topic `GDM early abnormal glucose: what it means`** (on Step 4.4), education.
  - "Your early A1C was slightly above normal. This means a higher chance of developing
    gestational diabetes later in pregnancy.
  - We will meet with a dietitian and may check your fasting blood sugar a few times a week.
  - Whether treating this early helps is still being studied; we will decide together."
  - **Source:** [55][56]

## 10. Quality metrics

- **QM-1 — HEDIS Prenatal and Postpartum Care (PPC): Timeliness of Prenatal Care** (on Step
  1.1). NCQA; also CMS Maternity Core Set PPC2-CH (mandatory) / PPC2-AD (voluntary) [71].
  - Denominator: deliveries of live births between Oct 8 of the prior year and Oct 7 of the
    measurement year.
  - Numerator: a prenatal visit in the first trimester, on or before the enrollment start date,
    or within 42 days of enrollment.
  - Source: [59]
- **QM-2 — HEDIS Prenatal Immunization Status (PRS-E)** (on Step 9.1). NCQA, ECDS.
  - Denominator: deliveries in the measurement year.
  - Numerator: influenza **and** Tdap vaccination for the pregnancy.
  - `[GAP]` The exact influenza lookback, the combination-rate details and the 2026 Core Set
    status come from secondary sources. They were not read on NCQA or CMS pages; confirm them
    against the HEDIS MY2026 Vol 2 specification.
  - Source: [60]
- **QM-3 — HEDIS Prenatal Depression Screening and Follow-up (PND-E)** (on Step 1.4). NCQA,
  ECDS.
  - Screening: a standardized instrument between pregnancy start and delivery.
  - Follow-up: within 30 days of a positive screen.
  - `[GAP]` The positive-screen cut-points are in the HEDIS specification, which was not read.
  - Source: [61]
- **QM-4 — HEDIS PPC: Postpartum Care** (on Step 9.6). NCQA.
  - Numerator: a postpartum visit on or between 7 and 84 days after delivery.
  - It is a planning metric here: the visit is scheduled during prenatal care.
  - Source: [59][44]

## 11. Schedules

| Sched | Host step | Interval | Description | Source |
|---|---|---|---|---|
| Sched-1 | Step 2.4 | "Tailored: intake + ~8 visits (average risk) / ~13 (greater than average)" | Traditional reference: every 4 weeks to 28, every 2 weeks to 36, then weekly. The CC No. 8 sample puts in-person visits at 10, 16, 28, 36 and 39 weeks; any modality at 22, 32 and 38; anatomy US at 20. | [1][2] |
| Sched-2 | Step 1.7 | "Start 12–28 weeks (optimally before 16), then daily until delivery" | Low-dose aspirin | [18][19] |
| Sched-3 | Step 4.5 | "24 0/7–28 6/7 weeks" | Universal GDM screening window. Screen as soon as possible if first seen after 28 weeks. Early negative testing does not replace it. | [55][57] |
| Sched-4 | Step 9.1 | "27–36 weeks, early in the window, every pregnancy" | Tdap | [24][25] |
| Sched-5 | Step 9.3 | "~28 weeks, after a repeat antibody screen; postpartum within 72 h if newborn Rh-positive" | Rho(D) immune globulin | [21][22][23] |
| Sched-6 | Step 10.1 | "32 0/7–36 6/7 weeks, in season" | Maternal RSV vaccine. ACOG Sept 1–Mar 1; CDC Sept–Jan. | [25][26] |
| Sched-7 | Step 11.1 | "36 0/7–37 6/7 weeks" | GBS culture. The valid result window covers births to at least 41 0/7. | [20] |
| Sched-8 | Step 12.1 | "Once or twice weekly from 41 0/7 weeks until delivery" | Late-term antenatal surveillance; delivery indicated at 42 0/7. | [46] |

## 12. Prerequisites (REQUIRES)

Kept few, because a REQUIRES prerequisite with no `satisfaction_check` always surfaces as
catch-up (§0.6 #6).

- `step-9-3` REQUIRES `step-1-3`: RhIG needs the initial Rh type and antibody screen [21][22].
- `step-5-1` REQUIRES `step-1-1`: the anatomy survey dates a pregnancy not yet dated; dating
  precedes GA windows [3].
- `step-7-2` REQUIRES `step-7-1`: the 100-g OGTT follows a positive 50-g GCT.
- `step-7-3` REQUIRES `step-7-2`: two-step diagnosis needs the diagnostic OGTT.
- `step-8-2` REQUIRES `step-8-1`: one-step diagnosis needs the 75-g OGTT.

Acyclic. No `prior_node_result` gates.

**Not encoded:** a "missed anatomy survey" catch-up for a patient past 24 weeks. It would be
`stage-6 REQUIRES step-5-1`, but it would surface for every ≥24-week patient, done or not, until
`satisfaction_check` becomes authorable.

## 13. Code entries

Every code was verified by the wave-2 code agent (§0.7).

**Condition codes on steps:**

| Code | System | Description | Attached to |
|---|---|---|---|
| Z34.00 | ICD-10 | Supervision of normal first pregnancy, unspecified trimester | Step 1.1 |
| R03.0 | ICD-10 | Elevated blood-pressure reading, without diagnosis of hypertension | Step 2.2 |
| O24.111, O24.112, O24.113, O24.119 | ICD-10 | Pre-existing type 2 diabetes mellitus, in pregnancy, 1st/2nd/3rd/unspecified trimester | Step 4.3 |
| O99.810 | ICD-10 | Abnormal glucose complicating pregnancy | Step 7.2 |
| O24.410 | ICD-10 | Gestational diabetes mellitus in pregnancy, diet controlled | Step 7.3, Step 8.2 (one CodeEntry node per host) |

**Lab, imaging and procedure codes:**

| Code | System | Description | Attached to |
|---|---|---|---|
| 58410-2 | LOINC | CBC panel – Blood by Automated count | Lab-1, Lab-19 |
| 85025 | CPT | Blood count; complete (CBC), automated, with differential | Lab-1, Lab-19 |
| 882-1 | LOINC | ABO and Rh group [Type] in Blood | Lab-2 |
| 86900 / 86901 | CPT | Blood typing; ABO / Rh (D) | Lab-2 |
| 890-4 | LOINC | Blood group antibody screen [Presence] in Serum or Plasma | Lab-3, Lab-23 |
| 86850 | CPT | Antibody screen, RBC, each serum technique | Lab-3, Lab-23 |
| 20507-0 | LOINC | Reagin Ab [Presence] in Serum by RPR | Lab-5, Lab-24 |
| 630-4 | LOINC | Bacteria identified in Urine by Culture | Lab-10 |
| 19090-0 | LOINC | Colony count [#/volume] in Urine | Lab-10 |
| 87086 | CPT | Culture, bacterial; quantitative colony count, urine | Lab-10 |
| 43113-0 | LOINC | Hemoglobinopathy evaluation panel | Lab-12 |
| 81420 | CPT | Fetal chromosomal aneuploidy genomic sequence analysis (cfDNA) | Lab-14 |
| 81508 | CPT | Fetal congenital abnormalities, PAPP-A and hCG | Lab-15 |
| 81511 | CPT | Fetal congenital abnormalities, AFP, uE3, hCG, DIA (quad) | Lab-16 |
| 4548-4 | LOINC | Hemoglobin A1c/Hemoglobin.total in Blood | Lab-17 |
| 83036 | CPT | Hemoglobin; glycosylated (A1c) | Lab-17 |
| 1558-6 | LOINC | Fasting glucose [Mass/volume] in Serum or Plasma | Lab-18 |
| 1504-0 | LOINC | Glucose [Mass/volume] in Serum or Plasma --1 hour post 50 g glucose PO | Lab-20 |
| 82950 | CPT | Glucose; post glucose dose | Lab-20 |
| 1549-5, 1501-6, 1514-9, 1530-5, 50608-9 | LOINC | 100-g OGTT fasting/1 h/2 h/3 h; gestational panel | Lab-21 |
| 82951, 82952 | CPT | GTT, 3 specimens; each additional | Lab-21 (82951 also Lab-22) |
| 1552-9, 1507-3, 1518-0 | LOINC | 75-g OGTT fasting/1 h/2 h | Lab-22 |
| 87081 | CPT | Culture, presumptive pathogenic organisms, screening only | Lab-27 |
| 76801, 76817, 76813, 76805 | CPT | OB ultrasound: <14 wk transabdominal; transvaginal; nuchal translucency; ≥14 wk | Img-1, Img-1, Img-2, Img-3 |
| 59025 / 76818 | CPT | NST / BPP with NST | Proc-1 / Proc-2 |
| 59412 | CPT | External cephalic version | Proc-3 |

**Medication codes:**

| Code | System | Description | Attached to |
|---|---|---|---|
| 4511 | RXNORM | folic acid (IN) | Med-1 |
| 1191 | RXNORM | aspirin (IN) | Med-2 |
| 243670 | RXNORM | aspirin 81 MG Oral Tablet (SCD) | Med-2 |
| 90656, 90673 | CPT | Influenza virus vaccine IIV3 PF / RIV3 | Med-3 |
| 90715 | CPT | Tdap vaccine, ≥7 years, IM | Med-5 |
| 35465 | RXNORM | Rho(D) immune globulin (IN) | Med-6 |
| 90678 | CPT | RSV vaccine, preF, subunit, bivalent, IM (Abrysvo) | Med-7 |

**Initial-panel and GBS codes (verified in wave 2):**

| Code | System | Description | Attached to |
|---|---|---|---|
| 25514-1 | LOINC | Rubella virus IgG Ab [Presence] in Serum | Lab-4 |
| 86762 | CPT | Antibody; rubella | Lab-4 |
| 22587-0 | LOINC | Treponema pallidum Ab [Presence] in Serum | Lab-5, Lab-24 |
| 86592, 86780 | CPT | Syphilis test, non-treponemal; Treponema pallidum antibody | Lab-5, Lab-24 |
| 5196-1 | LOINC | Hepatitis B virus surface Ag [Presence] in Serum or Plasma by Immunoassay | Lab-6 |
| 87340 | CPT | Hepatitis B surface antigen (HBsAg) | Lab-6 |
| 16935-9 | LOINC | Hepatitis B virus surface Ab [Units/volume] in Serum | Lab-7 |
| 16933-4 | LOINC | Hepatitis B virus core Ab [Presence] in Serum | Lab-7 |
| 86706, 86704 | CPT | HBsAb; HBcAb total | Lab-7 |
| 56888-1 | LOINC | HIV 1+2 Ab+HIV1 p24 Ag [Presence] in Serum or Plasma by Immunoassay | Lab-8, Lab-25 |
| 87389 | CPT | HIV-1 Ag with HIV-1 and HIV-2 antibodies, single result | Lab-8, Lab-25 |
| 13955-0 | LOINC | Hepatitis C virus Ab [Presence] in Serum or Plasma by Immunoassay | Lab-9 |
| 86803 | CPT | Hepatitis C antibody | Lab-9 |
| 21613-5 | LOINC | Chlamydia trachomatis DNA [Presence] in Specimen by NAA with probe detection | Lab-11, Lab-26 |
| 21416-3 | LOINC | Neisseria gonorrhoeae DNA [Presence] in Urine by NAA with probe detection | Lab-11, Lab-26 |
| 87491, 87591 | CPT | Infectious agent detection by NAAT; C. trachomatis / N. gonorrhoeae, amplified | Lab-11, Lab-26 |
| 83020 | CPT | Hemoglobin fractionation and quantitation; electrophoresis | Lab-12 |
| 19162-7 | LOINC | Varicella zoster virus IgG Ab [Presence] in Serum | Lab-13 |
| 86787 | CPT | Antibody; varicella-zoster | Lab-13 |
| 72607-5 | LOINC | Streptococcus agalactiae [Presence] in Vaginal fluid+Rectum by Organism specific culture | Lab-27 |

One CodeEntry node is emitted per host (spec: one parent per node).

## 14. Attribute-map registrations

None. The attribute conditions use only `patient.gestational_age_weeks` and `patient.rh_factor`,
and `patient.*` needs no code-map row. Both are in `KNOWN_PATIENT_ATTRIBUTES`
(`attribute-vocabulary.ts`).

## 15. Evidence citations

Every entry below was fetched by a wave-1 or wave-2 agent on 2026-09-24. Wave-2 fixes are
folded in (§0.7).

- **[1]** Tailored Prenatal Care Delivery for Pregnant Individuals (Clinical Consensus No. 8) —
  ACOG, *Obstet Gynecol* 2025;145(5):565–577, 2025, `Expert Consensus`,
  https://www.acog.org/clinical/clinical-guidance/clinical-consensus/articles/2025/04/tailored-prenatal-care-delivery-for-pregnant-individuals
  (Appendix 1: http://links.lww.com/AOG/E48)
- **[2]** Guidelines for Perinatal Care, 8th edition — AAP & ACOG, 2017, `Expert Consensus`,
  https://www.aap.org/Guidelines-for-Perinatal-Care-8th-edition-Paperback
  - `[OLDER SOURCE — current edition]` No 9th edition was found; CC No. 8 cites the 8th.
  - Out of date on: GBS 35–37 weeks, ethnicity-based hemoglobinopathy testing, risk-based
    syphilis rescreening, HCV. The newer sources govern those.
- **[3]** Methods for Estimating the Due Date (Committee Opinion No. 700) — ACOG/AIUM/SMFM, 2017
  (reaffirmed 2025), `Expert Consensus`,
  https://www.acog.org/clinical/clinical-guidance/committee-opinion/articles/2017/05/methods-for-estimating-the-due-date
- **[4]** Screening for Fetal Chromosomal Abnormalities (Practice Advisory, endorsing SMFM
  Consult Series #74; replaces PB 226) — ACOG, Jan 2026, `Level B` (GRADE 1B mapped to B),
  https://www.acog.org/clinical/clinical-guidance/practice-advisory/articles/2026/01/screening-for-fetal-chromosomal-abnormalities
- **[5]** Carrier Screening in the Age of Genomic Medicine (CO 690) and Carrier Screening for
  Genetic Conditions (CO 691) — ACOG, 2017 (both reaffirmed 2025), `Expert Consensus`:
  - CO 691: https://www.acog.org/clinical/clinical-guidance/committee-opinion/articles/2017/03/carrier-screening-for-genetic-conditions
  - CO 690: https://www.acog.org/clinical/clinical-guidance/committee-opinion/articles/2017/03/carrier-screening-in-the-age-of-genomic-medicine
- **[6]** Hemoglobinopathies in Pregnancy (Practice Advisory) — ACOG, Aug 2022 (reaffirmed Sep 2025),
  `Expert Consensus`,
  https://www.acog.org/clinical/clinical-guidance/practice-advisory/articles/2022/08/hemoglobinopathies-in-pregnancy
- **[7]** Syphilis Infection During Pregnancy: Screening — USPSTF, *JAMA* 2025, `A`,
  https://www.uspreventiveservicestaskforce.org/uspstf/recommendation/syphilis-infection-in-pregnancy-screening
- **[8]** Screening for Syphilis in Pregnancy (Practice Advisory) — ACOG, Apr 2024 (reaffirmed Oct
  2025), `Expert Consensus`,
  https://www.acog.org/clinical/clinical-guidance/practice-advisory/articles/2024/04/screening-for-syphilis-in-pregnancy
- **[9]** Hepatitis B Virus Infection in Pregnant Women: Screening — USPSTF, 2019, `A`,
  https://www.uspreventiveservicestaskforce.org/uspstf/recommendation/hepatitis-b-virus-infection-in-pregnant-women-screening
  - Triple panel: ACOG Clinical Practice Guideline No. 6, Viral Hepatitis in Pregnancy,
    *Obstet Gynecol* 2023;142:745–59 `[PAYWALL]`, via ACOG news release
    https://www.acog.org/news/news-releases/2023/08/acog-releases-new-guidance-on-viral-hepatitis-in-pregnancy
- **[10]** Human Immunodeficiency Virus (HIV) Infection: Screening — USPSTF, 2019, `A`,
  https://www.uspreventiveservicestaskforce.org/uspstf/recommendation/human-immunodeficiency-virus-hiv-infection-screening
- **[11]** Prenatal and Perinatal Human Immunodeficiency Virus Testing (CO 752) — ACOG, 2018
  (reaffirmed 2024), `Expert Consensus`,
  https://www.acog.org/clinical/clinical-guidance/committee-opinion/articles/2018/09/prenatal-and-perinatal-human-immunodeficiency-virus-testing
- **[12]** CDC Recommendations for Hepatitis C Screening Among Adults — United States, 2020 —
  Schillie S, et al., *MMWR Recomm Rep* 2020;69(RR-2):1–17, `Expert Consensus`,
  https://www.cdc.gov/mmwr/volumes/69/rr/rr6902a1.htm
- **[13]** Asymptomatic Bacteriuria in Adults: Screening — USPSTF, *JAMA* 2019, `B`,
  https://www.uspreventiveservicestaskforce.org/uspstf/recommendation/asymptomatic-bacteriuria-in-adults-screening
- **[14]** Urinary Tract Infections in Pregnant Individuals (Clinical Consensus No. 4) — ACOG, 2023
  (reaffirmed 2026), `Expert Consensus`,
  https://www.acog.org/clinical/clinical-guidance/clinical-consensus/articles/2023/08/urinary-tract-infections-in-pregnant-individuals
- **[15]** Chlamydia and Gonorrhea: Screening — USPSTF, 2021, `B`,
  https://www.uspreventiveservicestaskforce.org/uspstf/recommendation/chlamydia-and-gonorrhea-screening
- **[16]** Hypertensive Disorders of Pregnancy: Screening — USPSTF, *JAMA* 2023, `B`,
  https://www.uspreventiveservicestaskforce.org/uspstf/recommendation/hypertensive-disorders-pregnancy-screening
- **[17]** Aspirin Use to Prevent Preeclampsia and Related Morbidity and Mortality: Preventive
  Medication — USPSTF, *JAMA* 2021;326(12):1186–1191, `B`,
  https://www.uspreventiveservicestaskforce.org/uspstf/recommendation/low-dose-aspirin-use-for-the-prevention-of-morbidity-and-mortality-from-preeclampsia-preventive-medication
- **[18]** Low-Dose Aspirin Use During Pregnancy (CO 743) — ACOG/SMFM, 2018 (reaffirmed 2023),
  `Expert Consensus`,
  https://www.acog.org/clinical/clinical-guidance/committee-opinion/articles/2018/07/low-dose-aspirin-use-during-pregnancy
- **[19]** Low-Dose Aspirin Use for the Prevention of Preeclampsia and Related Morbidity and
  Mortality (Practice Advisory) — ACOG/SMFM, Dec 2021 (reaffirmed Oct 2022), `Expert Consensus`,
  https://www.acog.org/clinical/clinical-guidance/practice-advisory/articles/2021/12/low-dose-aspirin-use-for-the-prevention-of-preeclampsia-and-related-morbidity-and-mortality
- **[20]** Prevention of Group B Streptococcal Early-Onset Disease in Newborns (CO 797) — ACOG,
  2020 (reaffirmed 2025), `Expert Consensus`,
  https://www.acog.org/clinical/clinical-guidance/committee-opinion/articles/2020/02/prevention-of-group-b-streptococcal-early-onset-disease-in-newborns
- **[21]** Prevention of Rh D Alloimmunization (Practice Bulletin No. 181) — ACOG, 2017
  (reaffirmed 2026), `Level A`,
  https://www.acog.org/clinical/clinical-guidance/practice-bulletin/articles/2017/08/prevention-of-rh-d-alloimmunization
  - `[PAYWALL]` Text read from a manufacturer-hosted mirror.
  - Also: ACOG Clinical Practice Update, Rh D Immune Globulin Administration After Abortion
    or Pregnancy Loss at Less Than 12 Weeks of Gestation, *Obstet Gynecol*
    2024;144(6):e140–e143, PMID 39255498 (abstract).
  - Also: ACOG Practice Advisory, Rho(D) Immune Globulin Shortages, Mar 2024 (reaffirmed Mar
    2025),
    https://www.acog.org/clinical/clinical-guidance/practice-advisory/articles/2024/03/rhod-immune-globulin-shortages
- **[22]** Rh(D) Incompatibility: Screening — USPSTF, 2004, `A` (initial typing) / `B` (repeat
  antibody at 24–28 weeks),
  https://www.uspreventiveservicestaskforce.org/uspstf/recommendation/rh-d-incompatibility-screening
  — `[OLDER SOURCE — still the USPSTF statement]`
- **[23]** RhoGAM Ultra-Filtered PLUS [Rho(D) Immune Globulin (Human)] prescribing information —
  Kedrion, DailyMed, 2025, `Expert Consensus`,
  https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=d87e4d0b-2442-4135-b3f9-5c4f74845b87
- **[24]** Maternal Immunizations (Committee Statement No. 26; replaces CO 741 and the Oct 2022
  Maternal Immunization Practice Advisory) — ACOG, *Obstet Gynecol* 2026;147:e123–e128, Feb 2026,
  `Expert Consensus`,
  https://www.acog.org/clinical/clinical-guidance/committee-statement/articles/2026/02/maternal-immunizations
  - Also: ACOG 2026 Maternal Immunization Schedule (Jun 2026, addendum Sep 2026).
- **[25]** Adult Immunization Schedule, Notes and Table 2 (by medical condition) — CDC, Jul 2
  2025, `Expert Consensus`:
  - Notes: https://www.cdc.gov/vaccines/hcp/imz-schedules/adult-notes.html
  - Table 2: https://www.cdc.gov/vaccines/hcp/imz-schedules/adult-medical-condition.html
  - Agent B reported a court-order banner, which the citation check could not find on these
    pages; it is not relied on.
  - Also: CDC Interim Clinical Considerations for Use of COVID-19 Vaccines (updated Sep 23
    2026), https://www.cdc.gov/covid/hcp/vaccine-considerations/index.html
- **[26]** Maternal Respiratory Syncytial Virus Vaccination (Practice Advisory) — ACOG, updated
  Aug 2026, `Expert Consensus`,
  https://www.acog.org/clinical/clinical-guidance/practice-advisory/articles/2023/09/maternal-respiratory-syncytial-virus-vaccination
- **[27]** Influenza in Pregnancy: Prevention and Treatment (Practice Advisory) — ACOG, Aug 2025
  (updated Sep 2026), `Expert Consensus`,
  https://www.acog.org/clinical/clinical-guidance/practice-advisory/articles/2025/08/influenza-in-pregnancy-prevention-and-treatment
- **[28]** Folic Acid Supplementation to Prevent Neural Tube Defects: Preventive Medication —
  USPSTF, 2023, `A`,
  https://www.uspreventiveservicestaskforce.org/uspstf/recommendation/folic-acid-for-the-prevention-of-neural-tube-defects-preventive-medication
- **[29]** Screening and Diagnosis of Mental Health Conditions During Pregnancy and Postpartum
  (Clinical Practice Guideline No. 4) — ACOG, 2023, `Expert Consensus`
  - https://www.acog.org/clinical/clinical-guidance/clinical-practice-guideline/articles/2023/06/screening-and-diagnosis-of-mental-health-conditions-during-pregnancy-and-postpartum
  - `[PAYWALL]` Content via the ACOG program page:
    https://www.acog.org/programs/perinatal-mental-health/patient-screening
- **[30]** Perinatal Depression: Preventive Interventions — USPSTF, 2019, `B`,
  https://www.uspreventiveservicestaskforce.org/uspstf/recommendation/perinatal-depression-preventive-interventions
- **[31]** Intimate Partner Violence and Caregiver Abuse of Older or Vulnerable Adults:
  Screening — USPSTF, 2025, `B`,
  https://www.uspreventiveservicestaskforce.org/uspstf/recommendation/intimate-partner-violence-and-abuse-of-elderly-and-vulnerable-adults-screening
- **[32]** Opioid Use and Opioid Use Disorder in Pregnancy (CO 711) — ACOG, 2017 (reaffirmed
  2026), `Expert Consensus`,
  https://www.acog.org/clinical/clinical-guidance/committee-opinion/articles/2017/08/opioid-use-and-opioid-use-disorder-in-pregnancy
- **[33]** Cannabis Use During Pregnancy and Lactation (Clinical Consensus No. 10; supersedes the
  withdrawn CO 722) — ACOG, Oct 2025, `Expert Consensus`,
  https://www.acog.org/clinical/clinical-guidance/clinical-consensus/articles/2025/10/cannabis-use-during-pregnancy-and-lactation
- **[34]** Tobacco Smoking Cessation in Adults, Including Pregnant Persons — USPSTF, 2021, `A`,
  https://www.uspreventiveservicestaskforce.org/uspstf/recommendation/tobacco-use-in-adults-and-pregnant-women-counseling-and-interventions
- **[35]** Unhealthy Alcohol Use in Adolescents and Adults: Screening and Behavioral Counseling —
  USPSTF, 2018, `B`,
  https://www.uspreventiveservicestaskforce.org/uspstf/recommendation/unhealthy-alcohol-use-in-adolescents-and-adults-screening-and-behavioral-counseling-interventions
- **[36]** Weight Gain During Pregnancy (CO 548) — ACOG, 2013 (reaffirmed 2026), `Expert
  Consensus`,
  https://www.acog.org/clinical/clinical-guidance/committee-opinion/articles/2013/01/weight-gain-during-pregnancy
  - `[OLDER SOURCE — still current]` IOM 2009 targets per the IOM Report Brief:
    https://nap.nationalacademies.org/resource/12584/Report-Brief---Weight-Gain-During-Pregnancy.pdf
- **[37]** Healthy Weight and Weight Gain in Pregnancy: Behavioral Counseling Interventions —
  USPSTF, 2021, `B`,
  https://www.uspreventiveservicestaskforce.org/uspstf/recommendation/healthy-weight-and-weight-gain-during-pregnancy-behavioral-counseling-interventions
- **[38]** Physical Activity and Exercise During Pregnancy and the Postpartum Period (CO 804) —
  ACOG, 2020 (reaffirmed 2023), `Expert Consensus`,
  https://www.acog.org/clinical/clinical-guidance/committee-opinion/articles/2020/04/physical-activity-and-exercise-during-pregnancy-and-the-postpartum-period
- **[39]** Moderate Caffeine Consumption During Pregnancy (CO 462) — ACOG, 2010 (reaffirmed 2026),
  `Expert Consensus`,
  https://www.acog.org/clinical/clinical-guidance/committee-opinion/articles/2010/08/moderate-caffeine-consumption-during-pregnancy
- **[40]** Advice about Eating Fish — FDA/EPA, 2021, `Expert Consensus`,
  https://www.fda.gov/food/consumers/advice-about-eating-fish
  - Also: CDC Listeria prevention (2025), https://www.cdc.gov/listeria/prevention/index.html
- **[41]** Urgent Maternal Warning Signs (Hear Her campaign) — CDC, 2024, `Expert Consensus`,
  https://www.cdc.gov/hearher/maternal-warning-signs/index.html
- **[42]** Barriers to Breastfeeding: Supporting Initiation and Continuation of Breastfeeding (CO
  821) — ACOG, 2021 (reaffirmed 2026), `Expert Consensus`,
  https://www.acog.org/clinical/clinical-guidance/committee-opinion/articles/2021/02/barriers-to-breastfeeding-supporting-initiation-and-continuation-of-breastfeeding
- **[43]** Breastfeeding: Primary Care Behavioral Counseling Interventions — USPSTF, 2025, `B`,
  https://www.uspreventiveservicestaskforce.org/uspstf/recommendation/breastfeeding-primary-care-interventions
- **[44]** Optimizing Postpartum Care (CO 736) — ACOG, 2018 (reaffirmed 2025), `Expert Consensus`,
  https://www.acog.org/clinical/clinical-guidance/committee-opinion/articles/2018/05/optimizing-postpartum-care
- **[45]** Oral Health Care During Pregnancy and Through the Lifespan (CO 569) — ACOG, 2013
  (reaffirmed 2025), `Expert Consensus`,
  https://www.acog.org/clinical/clinical-guidance/committee-opinion/articles/2013/08/oral-health-care-during-pregnancy-and-through-the-lifespan
- **[46]** Indications for Outpatient Antenatal Fetal Surveillance (CO 828) — ACOG/SMFM, 2021
  (reaffirmed 2024), `Expert Consensus`,
  https://www.acog.org/clinical/clinical-guidance/committee-opinion/articles/2021/06/indications-for-outpatient-antenatal-fetal-surveillance
- **[47]** Management of Late-Term and Postterm Pregnancies (Practice Bulletin No. 146) — ACOG,
  2014 (reaffirmed 2024), `Level A` (induction after 42 0/7) / `Level B`,
  https://www.acog.org/clinical/clinical-guidance/practice-bulletin/articles/2014/08/management-of-late-term-and-postterm-pregnancies
  - `[PAYWALL]` Text read from a university-hosted full-text copy.
- **[48]** External Cephalic Version (Practice Bulletin No. 221) — ACOG, 2020 (reaffirmed 2026),
  `Level A`,
  https://www.acog.org/clinical/clinical-guidance/practice-bulletin/articles/2020/05/external-cephalic-version
  - `[PAYWALL]` Recommendations via the Guideline Central summary.
- **[49]** Vaginal Birth After Cesarean Delivery (Practice Bulletin No. 205) — ACOG, 2019
  (reaffirmed 2024), `Level A`,
  https://www.acog.org/clinical/clinical-guidance/practice-bulletin/articles/2019/02/vaginal-birth-after-cesarean-delivery
- **[50]** Fetal Growth Restriction (Practice Bulletin No. 227) — ACOG/SMFM, 2021, `Level B`,
  https://www.acog.org/clinical/clinical-guidance/practice-bulletin/articles/2021/02/fetal-growth-restriction
  - `[PAYWALL]` Text via a mirror.
- **[51]** Air Travel During Pregnancy (CO 746) — ACOG, 2018 (reaffirmed 2026), `Expert
  Consensus`,
  https://www.acog.org/clinical/clinical-guidance/committee-opinion/articles/2018/08/air-travel-during-pregnancy
- **[52]** Screening for Gestational and Pregestational Diabetes in Pregnancy and Postpartum
  (Clinical Practice Update) — ACOG, *Obstet Gynecol* 2024;144(1):e20–e23, `Expert Consensus`,
  https://pubmed.ncbi.nlm.nih.gov/42131962/
  - `[GAP]` Full text is paywalled (GDM brief [1]).
- **[53]** Gestational Diabetes Mellitus (Practice Bulletin No. 190) — ACOG, 2018 (reaffirmed
  2026), `Level A`,
  https://www.acog.org/clinical/clinical-guidance/practice-bulletin/articles/2018/02/gestational-diabetes-mellitus
  - `[GAP]` Member-only (GDM brief [2]).
- **[54]** Gestational Diabetes Mellitus (Practice Bulletin No. 180) — ACOG, 2017, `Level A`,
  https://ruralprep.org/wp-content/uploads/2018/04/ACOG-Tech-Bullitin.pdf
  - `[OLDER SOURCE — superseded by [53]; operational wording only]` (GDM brief [3]).
- **[55]** 2. Diagnosis and Classification of Diabetes: Standards of Care in Diabetes—2026 — ADA,
  *Diabetes Care* 2026;49(Suppl 1):S27–S49, `A`,
  https://pmc.ncbi.nlm.nih.gov/articles/PMC12690183/ (GDM brief [4])
- **[56]** 15. Management of Diabetes in Pregnancy: Standards of Care in Diabetes—2026 — ADA,
  *Diabetes Care* 2026;49(Suppl 1):S321–S338, `A`,
  https://pmc.ncbi.nlm.nih.gov/articles/PMC12690181/ (GDM brief [5])
- **[57]** Screening for Gestational Diabetes — USPSTF, *JAMA* 2021;326(6):531–538, `B`,
  https://www.uspreventiveservicestaskforce.org/uspstf/recommendation/gestational-diabetes-screening
  (GDM brief [7])
- **[58]** ICD-10-CM Official Guidelines for Coding and Reporting FY2027, and the ICD-10-CM
  Tabular List FY2027 — CMS/NCHS, 2026, `Expert Consensus`:
  - Guidelines: https://www.cms.gov/files/document/fy-2027-icd-10-cm-coding-guidelines.pdf
  - Code files: https://www.cms.gov/files/zip/2027-code-descriptions-tabular-order.zip
  - The trimester definitions come from the Tabular List's chapter 15 note, not the
    Guidelines PDF.
- **[59]** Prenatal and Postpartum Care (PPC) — NCQA HEDIS, 2026, `Expert Consensus`,
  https://www.ncqa.org/report-cards/health-plans/state-of-health-care-quality-report/prenatal-and-postpartum-care-ppc/
- **[60]** Prenatal Immunization Status (PRS-E) — NCQA HEDIS, 2026, `Expert Consensus`,
  https://www.ncqa.org/report-cards/health-plans/state-of-health-care-quality-report/prenatal-immunization-status-prs-e/
- **[61]** Prenatal Depression Screening and Follow-Up (PND-E) — NCQA HEDIS, 2026, `Expert
  Consensus`,
  https://www.ncqa.org/report-cards/health-plans/state-of-health-care-quality-report/prenatal-depression-screening-and-follow-up-pnd-e/
- **[62]** Management of Full-Term Nulliparous Individuals Without a Medical Indication for
  Delivery (Clinical Practice Update; updates PB 146) — ACOG, *Obstet Gynecol* 2025;145(1):e45–e50,
  `Expert Consensus`, https://doi.org/10.1097/AOG.0000000000005783
  - PMID 39513607. It also replaces the 2018 ARRIVE Practice Advisory.
  - `[PAYWALL]` Abstract only.
- **[63]** Prenatal Diagnostic Testing for Genetic Disorders (Practice Bulletin No. 162) — ACOG,
  2016 (reaffirmed 2024), `Level A`,
  https://www.acog.org/clinical/clinical-guidance/practice-bulletin/articles/2016/05/prenatal-diagnostic-testing-for-genetic-disorders
  - `[PAYWALL]` The windows are from the ACOG patient FAQ "Prenatal Genetic Diagnostic Tests"
    (reviewed Apr 2026): https://www.acog.org/womens-health/faqs/prenatal-genetic-diagnostic-tests
- **[64]** FDA recommends avoiding use of NSAIDs in pregnancy at 20 weeks or later (Drug Safety
  Communication) — US FDA, Oct 15 2020, `Expert Consensus`,
  https://www.fda.gov/drugs/drug-safety-and-availability/fda-recommends-avoiding-use-nsaids-pregnancy-20-weeks-or-later-because-they-can-result-low-amniotic
- **[65]** Folic Acid: Facts for Clinicians — CDC, updated May 2025, `Expert Consensus`,
  https://www.cdc.gov/folic-acid/hcp/clinical-overview/index.html
- **[66]** Healthy Eating During Pregnancy (FAQ001; patient education) — ACOG, updated Mar 2026,
  `Expert Consensus`, https://www.acog.org/womens-health/faqs/healthy-eating-during-pregnancy
- **[67]** Iodine: Fact Sheet for Health Professionals — NIH Office of Dietary Supplements,
  updated Nov 2024 (cites the ATA 2017 guideline), `Expert Consensus`,
  https://ods.od.nih.gov/factsheets/Iodine-HealthProfessional/
- **[68]** About Alcohol Use During Pregnancy — CDC, reviewed Aug 2026, `Expert Consensus`,
  https://www.cdc.gov/alcohol-pregnancy/about/index.html
- **[69]** Weight Gain During Pregnancy — CDC, updated May 2024, `Expert Consensus`,
  https://www.cdc.gov/maternal-infant-health/pregnancy-weight/index.html
- **[70]** Car Safety for Pregnant Women, Babies, and Children (FAQ018; patient education) — ACOG,
  reviewed Feb 2026, `Expert Consensus`,
  https://www.acog.org/womens-health/faqs/car-safety-for-pregnant-women-babies-and-children
- **[71]** 2026 Core Set of Maternal and Perinatal Health Measures for Medicaid and CHIP — CMS,
  Dec 2025, `Expert Consensus`,
  https://www.medicaid.gov/medicaid/quality-of-care/downloads/2026-maternity-core-set.pdf

## 16. Citation map

Gates, CodeEntries, QMs and Schedules cannot cite. Their evidence is on the host step, as
listed.

**Stage 1**
- Stage 1: [1], [2], [3]
- Steps:
  - 1.1: [1], [3]
  - 1.2: [1], [2], [46], [49]
  - 1.3: [1], [2], [6], [7], [9], [10], [11], [12], [13], [14], [15]
  - 1.4: [1], [29], [30], [31], [32], [33], [34], [35]
  - 1.5: [4], [5], [6], [63]
  - 1.6: [17], [18], [19]
  - 1.7: [17], [18], [19], [64]
  - 1.8: [28], [36], [37], [38], [39], [40], [41], [45], [51], [64], [65], [66], [67], [68]
  - 1.9: [24], [25], [27]
- Evidence for gates on host steps: all eight GA gates → Step 1.1; `gate-aspirin-indicated` →
  Step 1.6.

**Stage 2**
- Stage 2: [1], [16], [50]
- Steps: 2.1: [16] · 2.2: [16] · 2.3: [1], [2], [50] · 2.4: [1], [2]
- `gate-bp-elevated` → Step 2.1

**Stages 3–5**
- Stage 3: [3], [4] · Steps 3.1: [3] · 3.2: [4]
- Stage 4: [52], [55], [56] · Steps:
  - 4.1: [52], [55], [56], [58]
  - 4.2: [52], [55]
  - 4.3: [55]
  - 4.4: [52], [55], [56]
  - 4.5: [53], [55], [57]
- Gates: `gate-early-testing-indicated` → Step 4.1; `gate-overt-diabetes` and
  `gate-early-abnormal-glucose` → Step 4.2
- Stage 5: [1], [4] · Steps 5.1: [1], [3], [4] · 5.2: [4]

**Stages 6–8**
- Stage 6: [1], [53], [57] · Steps:
  - 6.1: [1], [2]
  - 6.2: [53], [55], [57]
  - 6.3: [53]
  - 6.4: [55], [56]
- `gate-gdm-screening-status` → Step 6.2
- Stage 7: [53], [54], [55], [57] · Steps:
  - 7.1: [53], [54], [55], [57]
  - 7.2: [53], [55], [57], [58]
  - 7.3: [53], [55], [56]
- Stage 8: [55], [57] · Steps 8.1: [55], [57] · 8.2: [55], [56]
- Gates: `gate-gct-positive` → Step 7.1; `gate-100g-diagnostic` → Step 7.2;
  `gate-75g-diagnostic` → Step 8.1

**Stages 9–12**
- Stage 9: [1], [8], [21], [24], [44] · Steps:
  - 9.1: [24], [25], [26], [27]
  - 9.2: [21], [22]
  - 9.3: [21], [22], [23]
  - 9.4: [2], [21]
  - 9.5: [8], [10], [11], [15]
  - 9.6: [29], [31], [42], [43], [44]
- `gate-rh-negative` and `gate-rh-positive` → Step 9.2
- Stage 10: [24], [25], [26] · Step 10.1: [24], [25], [26]
- Stage 11: [1], [20], [44], [48], [62] · Steps 11.1: [20] · 11.2: [1], [48] · 11.3: [47],
  [49], [62]
- Stage 12: [46], [47] · Step 12.1: [46], [47]

**Medications**
- Med-1: [28], [65], [66], [67] · Med-2: [17], [18], [19], [64] · Med-3: [24], [25], [27] · Med-4: [24], [25] · Med-5:
  [24], [25] · Med-6: [21], [22], [23] · Med-7: [25], [26]

**Labs**
- Lab-1, Lab-19: [1], [2] · Lab-2, Lab-3: [2], [22] · Lab-4, Lab-13: [2] · Lab-5, Lab-24: [7],
  [8] · Lab-6, Lab-7: [9] · Lab-8, Lab-25: [10], [11] · Lab-9: [12] · Lab-10: [13], [14] ·
  Lab-11, Lab-26: [15] · Lab-12: [6] · Lab-14–16: [4] · Lab-17, Lab-18: [55] · Lab-20, Lab-21:
  [53], [55], [57] · Lab-22: [55], [57] · Lab-23: [21], [22] · Lab-27: [20]

**Imaging and procedures**
- Img-1: [3] · Img-2: [4] · Img-3: [1], [4]
- Proc-1, Proc-2: [46] · Proc-3: [48]

**Guidance**
- Guid-1: [41] · Guid-2: [36], [37], [69] · Guid-3: [28], [39], [40] · Guid-4: [33], [34], [35], [68] ·
  Guid-5: [38] · Guid-6: [45], [51], [70] · Guid-7: [1], [41], [46] · Guid-8: [42], [43], [44] ·
  Guid-9: [46], [47], [62]
- Guid-A1: [53], [55] · Guid-A2: [55], [56] · Guid-A4: [53], [56] · Guid-A5: [55], [56]

**Host steps for non-citing nodes**
- QM-1 → Step 1.1 ([59], [71]) · QM-2 → Step 9.1 ([60]) · QM-3 → Step 1.4 ([61]) · QM-4 → Step 9.6
  ([59], [44])
- Schedules and CodeEntries → their host steps (§11, §13)

## 17. Temporal horizon & status summary (EMITTED — review carefully)

| Gate | Condition on | horizon | status | window_days | Rationale |
|---|---|---|---|---|---|
| gate-ga-first-trimester | patient.gestational_age_weeks < 14 | — (`patient.*` has no temporal policy) | — | — | Read at the session; asks when missing |
| gate-ga-before-24 | patient.gestational_age_weeks < 24 | — | — | — | As above |
| gate-ga-14-to-24 | GA ≥ 14 AND GA < 24 | — | — | — | As above; one datum |
| gate-ga-24-plus | GA ≥ 24 | — | — | — | As above |
| gate-ga-27-plus | GA ≥ 27 | — | — | — | As above |
| gate-ga-32-to-37 | GA ≥ 32 AND GA < 37 | — | — | — | As above |
| gate-ga-36-plus | GA ≥ 36 | — | — | — | As above |
| gate-ga-41-plus | GA ≥ 41 | — | — | — | As above |
| gate-rh-negative | patient.rh_factor = "negative" | — | — | — | Demographic; no temporal policy |
| gate-rh-positive | patient.rh_factor = "positive" | — | — | — | As above |
| gate-bp-elevated | vitals systolic_bp > 139.9 | DAY | — | — | Today's reading (rule 0: never ENCOUNTER) |
| gate-bp-elevated | vitals diastolic_bp > 89.9 | DAY | — | — | As above |
| gate-overt-diabetes | labs 4548-4 > 6.49 | QUARTER | — | — | Early-pregnancy test; a preconception A1C within 90 days is acceptable |
| gate-early-abnormal-glucose | labs 4548-4 > 5.89 | QUARTER | — | — | Same datum and window; one shared question |
| gate-early-abnormal-glucose | labs 4548-4 < 6.5 | QUARTER | — | — | As above |
| gate-gct-positive | labs 1504-0 > 139.9 | QUARTER | — | — | This screening episode (see the §4b horizon note on early GCTs) |
| gate-75g-diagnostic | labs 1552-9 > 91.9 | QUARTER | — | — | Diagnostic OGTT this episode |
| gate-75g-diagnostic | labs 1507-3 > 179.9 | QUARTER | — | — | As above |
| gate-75g-diagnostic | labs 1518-0 > 152.9 | QUARTER | — | — | As above |

- No `window_days`.
- No `status` on labs or vitals.
- No trend, delta or count operators, so nothing is simulator-untestable for lack of dates.
- Question gates carry no conditions.

## 18. Gaps & fallbacks

### Not encodable on main

| # | Requirement | Why not | Fallback |
|---|---|---|---|
| G1 | Carpenter–Coustan "≥2 of 4" | No N-of-M operator; pairwise gates need six duplicate targets | BOOLEAN question (D-4) |
| G2 | Aspirin eligibility (any high, ≥2 moderate, or a single social factor) | Nested logic and counting; uncoded factors | BOOLEAN question (verbatim GHTN prompt) |
| G3 | Early-testing eligibility | Nested logic; BMI not codeable in pregnancy (Z68); uncoded factors | BOOLEAN question |
| G4 | "Not screened / screened negative / not diagnosed" | Negations | SELECT router (D-22) |
| G5 | Skip the GBS swab after GBS bacteriuria | No negation; UTI records GBS via a question, not a code | Text in Step 11.1 |
| G6 | "Unsensitized" before RhIG | Antibody-screen *result* is not a threshold (890-4 is presence/absence); no negation | Text in Step 9.3; sensitized → MFM |
| G7 | RSV and influenza seasons | No calendar-month operator | Text |
| G8 | Anemia hand-off (Hb <11 T1/T3, <10.5 T2 → record O99.01x) | Would need three GA-banded compound gates, and the thresholds are secondary-sourced (PB 233 paywalled) | Not built; the CBC is ordered, and the anemia pathway fires once O99.01x is coded |
| G9 | Missed-anatomy-survey catch-up after 24 weeks | REQUIRES has no authorable `satisfaction_check`, so it would always surface | Not encoded (§12) |
| G10 | Cross-pathway question dedup (aspirin; BP datum) | Question gates dedupe only within a pathway; the cross-pathway datum dedup is unverified | Verbatim prompt; identical vitals conditions |

### Source gaps

- **Paywalled `[PAYWALL]`/`[GAP]` primaries:**
  - PB 175 (ultrasound);
  - PB 162 (exact CVS/amniocentesis windows; the FAQ says CVS 10–13 and amnio usually 15–20);
  - PB 181 (read via a mirror);
  - PB 233 (anemia thresholds);
  - CPG 4 (screening cutoffs);
  - CPG 6 (the HBV triple panel, via a news release);
  - SMFM Consult #74 (via the ACOG Advisory);
  - PB 190 and the 2024 CPU (GDM);
  - CPU 2025 (39-week).
- `[GAP]` Doppler FHT audibility (~10–12 weeks); numeric quickening GA.
- `[GAP]` COVID-19 and Tdap product dose volumes; 2026–27 COVID CPT codes.
- `[GAP]` HEDIS MY2026 specification detail: PRS-E windows, PND-E cut-points (§10).
- `[GAP]` Licensing of the urgent-maternal-warning-signs text (D-28): it is AIM-origin even on
  CDC's page.
- `[GAP]` No current ACOG documents on adolescent prenatal care, employment, or a late-entry
  protocol. Late entry is handled by the GA gates plus REQUIRES.
- `[GAP]` GCT ≥200 as diagnostic; bariatric-surgery alternative screening (PB 105).
- `[GAP]` No Prism pathway yet for pregestational/overt diabetes in pregnancy, chronic
  hypertension before 20 weeks, or adult preventive care after GDM (D-12 destination).

### Source conflicts

| # | Conflict | Resolution in this brief |
|---|---|---|
| C1 | Third-trimester syphilis: ACOG universal (2024) vs CDC STI 2021 risk-based | ACOG (owning society), universal |
| C2 | Hepatitis B: USPSTF HBsAg alone vs ACOG CPG 6 / CDC 2023 triple panel | HBsAg every pregnancy, plus the triple panel if not previously documented |
| C3 | RSV season: ACOG Sept 1–Mar 1 (Aug 2026) vs CDC Sept–Jan | Both stated; ACOG window in the schedule |
| C4 | COVID-19 in pregnancy: ACOG "all should receive" vs CDC "no guidance" | D-26 (include per ACOG) |
| C5 | RhIG timing: label 26–28 weeks vs USPSTF after the 24–28-week screen vs ACOG 28 weeks | "~28 weeks after repeat antibody screen" |
| C6 | Fetal RhD cfDNA to skip RhIG: CC No. 8 accepts it vs the ACOG shortage advisory (routine use not recommended) | Text: acceptable; routine use reserved for shortages |
| C7 | First-trimester combined window: 10–13 6/7 (2026 Advisory) vs 11–13 6/7 (older texts) | 10–13 6/7 |
| C8 | GBS bacteriuria treatment threshold: USPSTF >10⁴ vs ACOG ≥10⁵ | Owned by the UTI pathway; both agree that any count means intrapartum prophylaxis and no swab |
| C9 | 4 mg folic acid start: CDC 1 month vs ACOG FAQ ≥3 months before conception | Both stated |
| C10 | Early abnormal glucose: ADA 2.31b vs ACOG (no early GDM screening) | D-7 |
| C11 | Early test: ADA Rec 2.4 plasma glucose vs A1C | D-6 |
| C12 | Strategy: ADA prefers one-step vs ACOG two-step | D-5 (both) |
| C13 | RhIG before 12 weeks: RhoGAM label lists loss or termination up to and including 12 weeks vs ACOG CPU 2024 (forgo routine RhIG before 12 0/7) | ACOG CPU (Step 9.3 text); label conflict noted on Med-6 |

### Simulator coverage `[SIM]`

- **Enterable today** (`clinical_code_reference`):
  - triggers Z34.00, Z34.90, O09.40, O09.90, O24.410/.414/.415/.419;
  - labs 4548-4, 1504-0, 1558-6, 58410-2, 882-1, 890-4, 630-4, 19090-0, 43113-0, 718-7.
- **The encounter page sends GA and trimester**, so every GA gate decides. The preview flow
  asks once.
- **Rh is not sent.** The Rh pair asks one SELECT.
- **BP comes from vitals.**
- **Not seeded:**
  - most Z34/O09 leaves;
  - O99.810;
  - 1552-9, 1507-3, 1518-0 (the one-step gate asks, and cannot be entered via the composer);
  - the 100-g LOINCs (informational only).
- `ensureClinicalCodeReference` has no callers on josh-dev.
