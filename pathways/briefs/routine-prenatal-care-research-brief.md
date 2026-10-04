# Pathway Research Brief — Routine Prenatal Care (with universal GDM screening)

JSON: pathways/json/routine-prenatal-care.json @ version 6

> **v6 (2026-10-04) — hand-offs are shown as suggested diagnoses.** Josh ran the 20-week
> patient with a hemoglobin of 8.5 and "didn't see anything": the anemia hand-off was one
> line in the guidance list. `[DECISION — Josh 2026-10-04]` (from that report): a hand-off
> must be visible and actionable. The six hand-off guidance nodes now carry
> `suggests_diagnosis_code` / `_system` / `_display` (Guid-12 O99.01, Guid-13 Z67.91,
> Guid-14 R03.0, Guid-15 O24.11, Guid-A4 and Guid-A4b O24.41), which the plan shows as
> "Suggested diagnosis" with an Add control; a family code lets the provider pick the
> billable code under it. No gate, step, order or wording changed.


**Status: version 5 (2026-10-04): medications are matched by ingredient; items marked CONFIRM
remain.** Built as `pathways/json/routine-prenatal-care.json`, version 5 (387 nodes, 746
edges). Versions 1–4 are commits `b251958`, `fbed785`, `45f8e30` and `4d9559e` (version 4 is
loaded as a draft); version 5 is not imported.

**What this is.** The pathway `routine-prenatal-care`. It replaces the older stored
`routine-prenatal-care-v1` and `-v2` graphs (§0.2), neither of which is active locally any
more (D-27 is moot). Per Josh's D-1 it **owns gestational diabetes screening and diagnosis**;
the GDM brief is management-only (`pathways/briefs/gestational-diabetes-management-research-brief.md`).

**Research method** (per `.claude/skills/pathway-research/SKILL.md`), all on 2026-09-24:
landscape scan, four parallel domain agents over fetched guideline text, and wave-2
verification agents for codes and citations (§0.7). The GDM screening content reuses the GDM
brief v1 research. No new clinical research was done on 2026-10-04; those passes applied
Josh's decisions and the current authoring rules, and verified the added codes (§0.8).

Flags:
- `[GAP]` unsourceable.
- `[OLDER SOURCE]` older, but still the current recommendation.
- `[NOT ENCODABLE]` clinically required but not expressible on the josh-dev engine; the nearest
  supported pattern is built and what would be needed is stated.
- `[DECISION — Josh <date>]` ratified.
- `[JOSH — CONFIRM]` a clinical or coding choice the builder had to make; listed together in §18.
- `[PAYWALL]` the primary text could not be read; the claim rests on the named secondary or
  mirror.
- `[WINDOW — <gate>: …]`, `[ON-UNRESOLVED DEFAULT — <gate>]`, `[LEAF CODES — <parent>: …]` the
  format spec's markers.

> ### Read this first (version 5, 2026-10-04)
>
> One change from version 4 `[DECISION — Josh 2026-10-04]`: **"match the vaccine, not the
> brand."** Every gate that reads the medication list now matches by **ingredient**, not by a
> list of product codes:
>
> 1. **Vaccines** — any influenza, COVID-19, Tdap or RSV vaccine product counts, whatever the
>    brand or season. The season, this-pregnancy and once-ever rules, the undated-entry
>    questions, the remembered Tdap / RSV answers and the in-season rule are exactly as
>    version 4.
> 2. **Prenatal vitamin** — any product containing folic acid on the medication list settles
>    it: a folic acid tablet or a prenatal multivitamin of any brand. Otherwise the remembered
>    question, as before.
> 3. **Aspirin** — any product containing aspirin.
> 4. **New behaviour: an entry on the medication list that cannot be identified is asked
>    about by name** — "… could not be identified. Does it count as an influenza vaccine?" —
>    instead of being silently treated as "not one".
>
> The product-code lists and their yearly upkeep are gone from the gates (§0.6 #4, J28 / J31
> closed).
>
> Checked against the real engine: `gate-proof.ts prenatal-ga`, `prenatal-triggers`,
> `prenatal-gdm`, `prenatal-handoffs`, `prenatal-meds`, `prenatal-vaccines`, and
> `coverage-audit.ts`. The proofs take each medication's identity from a fixture of RxNav's
> answers, not from the live normaliser (§18).

---

## 0. Cross-cutting analysis (not emitted)

### 0.1 Architecture `[DECISION — Josh 2026-09-24]` (D-1), extended `[DECISION — Josh 2026-10-04]`

- **Only a diagnosis on the encounter starts a pathway.** `[DECISION — Josh 2026-10-04]` "It
  can read throughout the chart to help a pathway, but chart can't cause a pathway to be
  activated." This pathway starts when the provider puts a supervision-of-pregnancy or
  pregnant-state diagnosis on the visit (§1). Its gates read the whole chart.
- **GDM testing is part of routine prenatal care.** A positive result opens **"Diagnose GDM:
  add O24.410 to the encounter"**, with a CodeEntry for O24.410. When the provider adds it,
  `gestational-diabetes-management` joins the visit and owns glycemic management.
- **Screening for other problems stays in routine care; treatment does not.**
  `[DECISION — Josh 2026-10-04]` Routine care screens for diabetes, hypertension and anemia
  and recommends the diagnosis. Treatment belongs to that problem's own pathway. The provider
  makes the link by adding the diagnosis **to the encounter**; pathways are not linked to one
  another. Five hand-offs, all the same shape — a gate on chart data, one step, one
  CodeEntry, one Guidance node, no orders for the other problem:

  | Finding | Gate | Step | Diagnosis to add to the encounter | Pathway that takes it |
  |---|---|---|---|---|
  | 100-g or 75-g test diagnostic | `gate-100g-diagnostic` / `gate-75g-diagnostic` | 6.11 / 6.13 | O24.410 | `gestational-diabetes-management` (brief only) |
  | BP ≥140/90 (D-25) | `gate-bp-elevated` | 2.2 | R03.0, then O13.x / O14.x | `gestational-hypertension-preeclampsia` |
  | Low hemoglobin drawn this pregnancy | `gate-hgb-low` | 1.23 | O99.011 / .012 / .013 | `anemia-in-pregnancy` |
  | Rh(D) type not clearly positive (negative, weak D, partial D, other) | `gate-rh-not-positive` | 1.24 | Z67.91 (or Z67.11/.21/.31/.41) | Rh-negative pregnancy (**not started**, `pathways/TODO.md`) |
  | Early HbA1c ≥6.5% | `gate-overt-diabetes` | 4.3 | O24.111–.119 | none yet (pregestational diabetes) |

- **Each hand-off closes when its diagnosis is already on the chart**, so a patient whose
  anemia or hypertension is already recorded is not told to add it again.
- **Routine care continues after a hand-off as long as a supervision code is on the
  encounter** (§0.3).

### 0.2 Inventory: what the stored `routine-prenatal-care-v2` held, and where it went (2026-09-24)

Reconstructed from the stored graph (pathway id `0c12db5b`; active on 2026-09-24, no longer active locally). The "This brief" column is the 2026-09-24 draft's answer; where 2026-10-04 changed it, the row says so:
- 5 stages, all root-connected, and 26 steps.
- 3 gates, all inert.
- 1 DecisionPoint with no branches.
- 3 meds, 12 labs, 2 procedures, 2 QMs, 5 schedules and 8 citations.
- Triggers: Z34.00, Z34.90 only.

| v2 element | Problem found | This brief |
|---|---|---|
| Stages 1–5, all `root HAS_STAGE` | Nothing is time-scoped: a 10-week patient sees GBS and Tdap | Stages 1–2 root; Stages 3–12 are GA-gated or router-entered |
| `gate-risk-class` (question, **lowercase `boolean`**, `traverse`) → `stage-2` | Inert twice (`traverse`; `stage-2` also root-connected). Lowercase answer_type crashes resolve | Dropped. Risk tier is assessed in Step 1.2 as text; greater-than-average-risk *content* is out of scope (D-23), so nothing to gate |
| `gate-rh-negative` (question) → `step-4-2` RhIG | Inert: `stage-4 HAS_STEP step-4-2` also exists | `patient.rh_factor` gate → "add the diagnosis" (Step 1.24). **RhIG removed on 2026-10-04** (§0.9) |
| `gate-early-gdm-screen` (question, lowercase) → `step-4-1` "50-g GCT 24–28 wk" | Inert, **and mis-targeted**: an *early-screening* question pointed at *universal* screening | Replaced by Stage 4 (early testing) and Stages 6–8 (universal), from GDM Part A; status chart-read since 2026-10-04 |
| `dp-1` visit modality (`one_of`, no `BRANCHES_TO`, criteria with no targets) | Branchless DP (validator warning); no content behind it | Dropped. Visit modality is CC No. 8 text on Step 2.4 + Sched-1 |
| Step 1.1–1.6 intake | Sound content | Kept and expanded (Steps 1.1–1.9) |
| Steps 2.1–2.3 (aneuploidy, carrier, dating US) | PB 226 is **withdrawn**; windows outdated | Jan 2026 ACOG Practice Advisory (cfDNA routinely available); carrier screening moves to Step 1.5 |
| Steps 3.1–3.3 (anatomy, quad, routine) | Sound | Stage 5 |
| Step 4.1 GDM GCT (uncoded `lab-10` in the merge key) | Duplicate/uncoded | Stages 6–8, coded LOINC 1504-0 |
| Steps 4.2–4.6 (RhIG, Tdap, CBC, GBS, presentation) | Sound; GBS window right (36 0/7–37 6/7) | Stages 6, 9, 11 |
| Steps 5.1–5.5 (per-visit) | Sound | Stage 2, plus a BP hand-off gate (D-25) |
| med-1 prenatal vitamin (RxNorm 310488), med-2 RhIG (RxNorm 5641), med-3 Tdap | **310488 is glipizide 10 mg**, and 5641 is a retired identifier (§0.7). Lane names are snake_case | Re-coded (folic acid 4511), with kebab-case lanes; RhIG removed 2026-10-04 |
| Lab codes (58410-2, 34530-6, 25514-1, 20507-0, 5195-3, 75622-1, 16128-1, 630-4, 43304-5, 1504-0, 11475-1) | **75622-1** (HIV panel grouper), **43304-5** (CT only) and **11475-1** (generic culture) are wrong for their purpose. 5195-3, 16128-1 and 25514-1 are right; the seed table mislabels them (§0.7) | Re-verified |
| ev-1…ev-8 | ev-6 cites withdrawn PB 226; ev-4 is a generic "USPSTF recommendations" entry | Replaced by §15 |

### 0.3 Coding facts, and what the provider puts on the encounter (ICD-10-CM FY2027 Official Guidelines [58])

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
- **What this means for triggers, now that only the encounter is matched (rule B, D-21
  rewritten).** `[DECISION — Josh 2026-10-04]` Triggers are "any code for supervision of
  pregnancy or pregnancy in general. Not pregnancy related problems." The version 1 worry —
  a problem list recoded from Z34 to O24.410 stops matching — was about the chart. It is now
  a statement about what the provider puts on the **visit**:
  - A routine prenatal visit carries Z34.x (or O09.x for a high-risk pregnancy). That starts
    this pathway.
  - When a problem is found, the provider adds that diagnosis to the same encounter and the
    problem's pathway joins. In the simulator both sit on the encounter and both run.
  - Under the ICD-10-CM rule above, a real claim for that visit would not carry Z34 beside a
    chapter-15 code; a complicated pregnancy is supervised under **O09.x**, which may be
    used with chapter-15 codes and is a trigger here. A visit coded with a complication code
    alone — no Z34, no O09, no Z33.1 — does not start routine prenatal care. That is the
    intended reading of "not pregnancy related problems".
  - The gestational diabetes codes (O24.41x, O99.810) are therefore **not** triggers any
    more. They are still read from the chart by the GDM status gates.

### 0.4 Co-matching with the other pathways (re-checked for version 5)

Triggers, from the built JSONs on josh-dev. Each is matched against the **encounter's**
diagnoses:

| Pathway | Triggers (families) |
|---|---|
| `anemia-in-pregnancy` v17 | `O99.01`, `D50` |
| `gestational-hypertension-preeclampsia` v6 | `O13.2`, `O13.3`, `O13.9`, `O14.0`, `O14.1`, `O16`, `R03.0` |
| `uti-asymptomatic-bacteriuria-pregnancy` v4 | `R82.71`, `O23.1`, `O23.4`, `O99.820`, `Z13.89` |
| `gestational-diabetes-management` (brief only) | O24.41x, O24.43x |
| **this pathway** | `Z34`, `O09`, `Z33.1`, `Z33.3` |

No trigger is shared, so co-matching happens only when the encounter carries a supervision
code **and** a problem code — which is exactly what a hand-off step asks the provider to do.
All four are `category: OBSTETRIC`; the supervision code on the encounter is itself the
pregnancy evidence that rule needs.

**How the merge treats it** (josh-dev `care-plan-merge.ts`):
- **Labs** with the same `system|code` fold into ONE line; the other nodes' names are shown as
  "Ordered for: …". So every LabTest name here says why this pathway orders it.
- **Medications** are deduped by name; `clinical_role` conflicts on ≥2 distinct names in one lane.
- **Guidance** is deduped on topic + instructions.
- **Question gates do not dedupe across pathways.** Chart data questions are keyed on the datum.

| Overlap | With | Handling |
|---|---|---|
| **Aspirin 81 mg** (`preeclampsia-prophylaxis`) | GHTN `med-1` | Same name, same lane → one line. The eligibility question is duplicated for a co-matched patient; the prompt is verbatim GHTN's. This pathway asks it only of a patient not on aspirin and before 28 weeks. |
| **BP ≥140/90** | GHTN `gate-bp-elevated` | Same two vitals leaves, same datum keys. This pathway's gate also requires that no hypertension code is on the chart. |
| **CBC** 58410-2 | anemia `lab-1` and its rechecks | Folds to one line. |
| **Hemoglobin 718-7 as a datum** | anemia threshold gates | One datum key, one question. This pathway reads only a value drawn this pregnancy; the anemia pathway reads the most recent value however old, so a pre-pregnancy value is "left for the anemia pathway to use if the provider adds anemia" (Josh). |
| **ABO/Rh type** 882-1 | anemia `lab-9` | Same LOINC → one line. |
| **Hemoglobinopathy evaluation** 43113-0 | anemia `lab-7` | Same LOINC → one line. |
| **Urine culture** 630-4 | UTI `lab-2`/`lab-9` | Same LOINC → one line. UTI owns treatment. |
| **GBS** | UTI (`O99.820`) | `O99.820` on the chart closes this pathway's 36-week culture order. |
| **Urgent maternal warning signs** | GHTN `guid-1` | Byte-identical text and topic (D-28) → one block. |
| **NST 59025 / BPP 76818** | GHTN, GDM | Same CPTs → one line each. |
| **clinical_role lanes** | all | `prenatal-vitamin-supplementation`, `preeclampsia-prophylaxis` (shared with GHTN by design), `influenza-immunization`, `covid-immunization`, `pertussis-immunization`, `rsv-maternal-immunization`. No conflict with anemia, GHTN, UTI or GDM lanes. |

### 0.5 Decision index

| ID | Ruling |
|---|---|
| D-1 | `[DECISION — Josh 2026-09-24]` GDM testing lives in routine prenatal care; a positive result opens "Diagnose GDM (add O24.410)". |
| D-3 | `[DECISION — Josh 2026-09-24]` 50-g cutoff **140 mg/dL** (threshold 139.9). |
| D-4 | `[DECISION — Josh 2026-09-24]` 100-g test: **Carpenter–Coustan, ≥2 abnormal values**. Version 2: read from the four values on the chart, not asked (§4b). |
| D-5 | `[DECISION — Josh 2026-10-04]` Screening strategy: **both one-step and two-step; the provider picks** — asked only when no screening result is on file. |
| D-6 | `[DECISION — Josh 2026-10-04]` Early test: **HbA1c only.** |
| D-7 | `[DECISION — Josh 2026-10-04]` Early abnormal glucose (HbA1c 5.9–6.4%): **include; counselling and fasting-glucose monitoring only**. |
| D-12 | `[DECISION — Josh 2026-09-24]` Post-GDM long-term screening belongs to routine care; in pregnancy it is an early-testing criterion (Step 4.6). |
| D-17 / D-21 / D-23 | `[DECISION — Josh 2026-10-04]` (version 2, replaces version 1's option (b)) Triggers: **"any code for supervision of pregnancy or pregnancy in general. Not pregnancy related problems."** `Z34`, `O09`, `Z33.1`, `Z33.3`. Not the `Z33` parent (Z33.2 is elective termination). No Z3A. `O24.41` and `O99.810` removed. |
| D-22 | `[DECISION — Josh 2026-10-04]` GDM status from 24 weeks: **read the chart, ask only the gaps.** |
| D-24 | `[DECISION — Josh 2026-10-04]` Rh type: **read `patient.rh_factor`; ask only if missing**. |
| D-25 | `[DECISION — Josh 2026-10-04]` BP ≥140/90: **include the hand-off**. |
| D-26 | `[DECISION — Josh 2026-09-24]` COVID-19 vaccine: recommend per ACOG, with shared decision-making documented; CDC's position stated in the node text. |
| D-27 | Moot `[2026-10-04]`: neither stored graph is active locally. |
| D-28 | `[DECISION — Josh 2026-09-24]` Urgent maternal warning signs: reference the list, never include it. |
| D-29 | **Superseded for the GDM tests and the early HbA1c** `[DECISION — Josh 2026-10-04]` (review of version 1): "read the chart, ask nothing" — at the ordering visit the test is ordered and its result is **not** asked for; a result is read once it is on the chart. Version 1's "the result gate asks; Not available keeps the order" is withdrawn for these tests. |
| V2-1 | `[DECISION — Josh 2026-10-04]` Hemoglobin thresholds 11 / 10.5 / 11 g/dL: **"correct"** (closes J1). |
| V2-2 | `[DECISION — Josh 2026-10-04]` A low hemoglobin from **before** this pregnancy does **not** open the anemia suggestion; only a value drawn this pregnancy. An older value is left for the anemia pathway to use if the provider adds anemia. Reverses version 1's "most recent however old" (closes J2). |
| V2-3 | `[DECISION — Josh 2026-10-04]` Rh: type and screen stay in routine care; "if rh neg found, suggest rh neg pathway as result in prenatal pathway"; the 24–28-week repeat antibody screen and all RhIG belong to the Rh-negative pathway. **Z67.91 stands** (closes J3). |
| V2-4 | `[DECISION — Josh 2026-10-04]` "Drawn this pregnancy needs to use the gestational age" → `horizon: "PREGNANCY"` (closes J5). |
| V2-5 | `[DECISION — Josh 2026-10-04]` A GDM code from a prior pregnancy left on the chart: "that's a chart problem". A diabetes code on the chart reads as diagnosed; no work-around (closes J11). |
| V2-6 | `[DECISION — Josh 2026-10-04]` Aspirin eligibility asked only before 28 weeks: agreed (closes J14). |
| V2-7 | `[DECISION — Josh 2026-10-04]` Risk-based tests are shown for everyone with the condition in the name: "risk based for everyone" (closes J19). |
| V2-8 | `[DECISION — Josh 2026-10-04]` **Vaccines must be checked against the chart**, read from the medication list as dated entries (closes J20). |
| V2-9 | `[DECISION — Josh 2026-10-04]` Prenatal vitamins: **"known list, else ask"** (closes J15, J21). |
| V2-11 | `[DECISION — Josh 2026-10-04]` A positive 50-g on the chart, not yet diagnosed: **"read the chart, ask nothing"** — straight to the 100-g test (closes J7, J9, J12). |
| V2-12 | `[DECISION — Josh 2026-10-04]` The 100-g test with chart-only reading: built as the six-pair encoding, so the four values settle it with no question and no recurrence (closes J8). |
| V2-13 | `[DECISION — Josh 2026-10-04]` Hand-offs recommend the diagnosis, which the provider adds to the **encounter**. |
| V3-1 | `[DECISION — Josh 2026-10-04]` **Calendar check.** Influenza and COVID-19 "given this season": a dose on or after the most recent **September 1** counts (`{ "since": "09-01" }`). Replaces the 180-day look-back (closes J23). |
| V3-2 | `[DECISION — Josh 2026-10-04]` **RSV: follow the guideline** — once in a lifetime, and offered only in season, **September 1 to March 1 (ACOG)**, inside 32 0/7–36 6/7 weeks (closes J27). |
| V3-3 | `[DECISION — Josh 2026-10-04]` **Vaccines as RxNorm: confirmed** (closes J24). A chart that records immunizations as CVX is a known limit (§0.8). |
| V3-4 | `[DECISION — Josh 2026-10-04]` **An undated vaccine on the medication list must be asked about, not assumed given** (reverses the version 2 default, J29). |
| V3-5 | `[DECISION — Josh 2026-10-04]` **The prenatal vitamin is a sticky answer**: "effectively is pt on prenatal > yes" — a "yes" remembered for this pregnancy, a "no" not remembered. Built on `patient.on_prenatal_vitamin` (closes J26). The undated Tdap and RSV answers are remembered the same way; influenza and COVID-19 are not (no season scope). |
| V3-6 | `[DECISION — Josh 2026-10-04]` Hemoglobin asked for at the first visit when none was drawn this pregnancy: agreed (closes J25). |
| V3-7 | `[DECISION — Josh 2026-10-04]` **Rh is not just negative/positive**: "there can be weakly pos". Flag anything not clearly positive; only a plain "positive" is left alone (closes J4). |
| V3-8 | `[DECISION — Josh 2026-10-04]` "Already done" per test — blood type, hemoglobinopathy, HBV antibodies once ever; everything else each pregnancy: agreed (closes J6). |
| V3-9 | `[DECISION — Josh 2026-10-04]` The BP hand-off closes once hypertension is on the chart: agreed (closes J17). |
| V4-1 | `[DECISION — Josh 2026-10-04]` **Week windows.** Every remaining look-back banded by gestational age is replaced by a window opening at a gestational week: repeat CBC since 24 0/7; third-trimester rescreens since 28 0/7; and **only a GDM screen drawn at or after 24 0/7 weeks counts as the 24–28-week screen** (closes J10, J22). |
| V4-2 | `[DECISION — Josh 2026-10-04]` **Influenza and COVID-19 only in season: September 1 to March 31, both vaccines**, and no dose since the most recent September 1. Out of season nothing is recommended or asked (closes J35). |
| V4-3 | `[DECISION — Josh 2026-10-04]` **Weak or partial D: always recommend the Rh-negative code** (Z67.91) — no qualifier (closes J32). |
| V4-4 | `[DECISION — Josh 2026-10-04]` Rh wording: "Accept common spellings" — the engine normalises them (closes J34). |
| V4-5 | `[DECISION — Josh 2026-10-04]` **"Not available" on the prenatal vitamin, Tdap or RSV question → recommend it** (unknown is treated like "no"; the question returns next visit). Built with `on_declined: "traverse"` on the "no" gate of each pair (closes J38). |
| V4-6 | `[DECISION — Josh 2026-10-04]` Vaccine products: **"match the vaccine, not the brand."** Needs medication class matching, an engine project (`pathways/TODO.md`). The product lists stay for version 4 (J28 / J31 become one known limit). |
| V4-7 | `[DECISION — Josh 2026-10-04]` **Early HbA1c: only a value drawn this pregnancy** for the overt-diabetes and 5.9–6.4% gates (closes J13). |
| V4-8 | `[DECISION — Josh 2026-10-04]` Guidance wording: Josh reviews it in the simulator. J18 is "review in place", not blocking. |
| V5-1 | `[DECISION — Josh 2026-10-04]` **"Match the vaccine, not the brand"** — medication matching by ingredient is available and used: vaccines, folic acid and aspirin are matched by ingredient RxCUI (`system: "RXNORM_INGREDIENT"`), replacing every product list (closes J28 / J31, V4-6). |
| — | `[DECISION — Josh 2026-10-04]` **Source conflicts ratified** (§18 C1, C2, C3, C7, C9). |

### 0.6 Spec and engine limitations (re-checked against spec v6 + josh-dev, version 5)

**No longer limitations:**
- **"Since week N of this pregnancy"** — `{ "since_gestational_week": N }` (2026-10-04). The
  banded look-backs of versions 1–3 are gone; a GDM screen before 24 0/7 weeks no longer
  counts.
- **Rh spellings** — `patient.rh_factor` is normalised to `positive` / `negative` / `weak D` /
  `partial D`; a gate's comparands must be those words (this pathway's are).
- **The calendar** — `encounter.date` / `in_season` ("is it RSV season?") and the horizon
  `{ "since": "09-01" }` ("this season"), both 2026-10-04. Version 2's 180-day look-back is
  gone.
- **Negation** (`not_includes_code`), **"Not available"**, **nested AND/OR groups** (4 levels),
  **typed `patient.*` answers** — as version 1.
- **"Drawn this pregnancy"** — `horizon: "PREGNANCY"` (2026-10-04). Version 1's #3 is closed
  for every "this pregnancy" read.
- **N-of-M for the 100-g test** — "≥2 of 4" is one gate, `OR` over the six pairs of values,
  and its complement is `AND` over the six pairs (§4b). Version 1's #1 is closed.
- **The D-22 / D-29 conflict** — gone with D-29's withdrawal: with no result question at the
  ordering visit, every result gate sits on the chart-read step and the strategy question sits
  behind "nothing on file". Version 1's #2 is closed.

**Still limitations:**

1. **"Not available" on a `patient.*` question** — resolved on 2026-10-04 by the gate property
   `on_declined: "traverse"`. Before it, a declined datum could only close the gates waiting
   on it: no `patient.*` condition is true on absence, and `default_behavior: "traverse"`
   would also open on a "yes". Anemia's membership-gate pattern works only for coded facts.
   The property is on the "no" gate of the prenatal vitamin, Tdap and RSV pairs (§4b).
2. **A remembered answer needs a registered patient attribute.** The compiler activates only
   the `patient.*` attributes listed in `attribute-vocabulary.ts`. Three provider-answered
   booleans were registered on 2026-10-04 for this pathway — `on_prenatal_vitamin`,
   `tdap_given_this_pregnancy`, `rsv_vaccine_ever_given` — and are used here (§4b). A further
   sticky answer needs a further row.
3. **A vaccine is an event, and the medication list stores intervals.** `includes_code` on
   `medications` means "an entry open at some time in the window": a Tdap dated two years ago
   with no end date reads as given this pregnancy. So "given in the window" is a
   `count_in_window` (it selects on the day the entry **started**), and an entry with no date
   at all — which a count never sees — is detected separately and asked about (§4b
   "Vaccines"). What would simplify it: an immunization list, or an "administered on" fact
   kind.
4. **Medications are matched by ingredient** — resolved on 2026-10-04 (V5-1). What remains:
   - **An entry that cannot be identified is asked about, once per class it could belong
     to.** A chart entry RxNav cannot identify is never "not a vaccine": each gate whose
     answer it could change asks "does it count as …?". One unidentified entry can therefore
     raise up to seven yes/no questions in this pathway (influenza, COVID-19 twice — two
     ingredients, Tdap, RSV, folic acid, aspirin). An identified entry of the class settles
     the matter without the question. `[JOSH — CONFIRM]` (J40).
   - **Ingredients shared with products that are not the intended one** (§0.8): FluMist
     (contraindicated in pregnancy) is an influenza vaccine; Arexvy is an RSV vaccine;
     pediatric DTaP is "a Tdap" (irrelevant inside this pregnancy's window); any aspirin
     product, at any dose or in a combination, is "aspirin" (J41).
   - **"Is a prenatal vitamin" has no class in RxNorm**; "contains folic acid" is what is
     matched. A product with L-methylfolate instead of folic acid is a different ingredient
     and is not recognised — the remembered question covers it.
5. **`patient.rh_factor` SELECT options come from the comparands.** The gate's first leaf is
   `in ["positive", "negative", "weak D", "partial D"]`, which supplies the four options
   (§4b).
6. **REQUIRES has no authorable satisfaction check.** One pair is kept (§12).
7. **Question gates do not dedupe across pathways** (aspirin, §0.4).
8. **GA is completed weeks.** Windows "A 0/7–B 6/7" are `≥ A` and `< B+1`.
9. **Imaging results, age and risk factors are not in the patient context.** The ultrasounds
   and the age- or risk-based tests cannot be checked against the chart; risk-based tests are
   shown for everyone with the condition in the name (V2-7).
10. **Gated regions (Rule 1).** No edge points into a gated step from outside it; no
    `ESCALATES_TO`; a lab on several hosts is one node per host. CodeEntry and
    EvidenceCitation nodes are shared (exempt).
11. **Calendar conditions and `PREGNANCY` in `check-gate-control.ts`** — fixed with version 3:
    `encounter.*` leaves are exempt from the explicit-horizon lint, "ask" on a `PREGNANCY`
    membership gate is no longer reported inert, and an authored `prompt` is warned about
    only on a gate that can ask for more than one datum. Regression cases are in
    `test-pipeline-checks.ts`.
12. **No "season" scope for a remembered answer.** `remember_answer` has `PREGNANCY` and
    `PATIENT`. "Influenza vaccine given this season" would need a scope that ends on the next
    September 1. So the undated influenza and COVID-19 questions stay question gates, asked
    at each visit until the entry is dated (J36).
- **Simulator caveats.** The simulator dates nothing: an undated lab or medication is asserted
  current, so it reads as "drawn this pregnancy" / "given" whatever its real date. The
  `PREGNANCY` bound and the vaccine look-backs are exercised only with dated entries
  (`gate-proof.ts`). The local `clinical_code_reference` table mislabels three hepatitis B
  LOINCs (5196-1 and 5195-3 as surface *antibody*, 16933-4 as surface *antigen*; §0.7).

### 0.7 Wave-2 verification outcome (2026-09-24)

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
| RxNorm **5641** | RhIG | a retired 2005 identifier | 35465 (RhIG itself removed 2026-10-04, §0.9) |
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
- **[41] was FAIL.** The Hear Her text was not verbatim. It was corrected word for word, and is
  now **superseded**: under D-28 the brief no longer carries the list at all (§9 Guid-1).
- **New licensing question:** the CDC page states the list "was developed by the Alliance for
  Innovation on Maternal Health". So the list is AIM-origin even on CDC's site. Resolved by
  D-28 `[DECISION — Josh 2026-09-24]`: reference it, never include it.
- **[25]:** agent B reported a court-order banner on the CDC schedule, but the checker could not
  find it on the cited pages. That claim is dropped and the schedule is cited by its Jul 2 2025
  date only.

**5. HEDIS detail not on the NCQA pages** (PRS-E windows, PND-E cut-points) is marked `[GAP]`
instead of stated.

### 0.8 Codes added on 2026-10-04 (verified)

| Code | System | Verified against | Finding |
|---|---|---|---|
| Z34, O09, Z33.1, Z33.3, Z33.2, Z33 | ICD-10 | local `icd10_codes` (full set) | Z33.1 pregnant state, incidental; Z33.2 encounter for elective termination of pregnancy; Z33.3 pregnant state, gestational carrier. |
| Z67.11, Z67.21, Z67.31, Z67.41, Z67.91 | ICD-10 | local `icd10_codes` | Blood type, Rh negative. |
| O36.01 and leaves; O26.89 and leaves; O99.820; O24.4, O24.41, O99.81, O99.810 | ICD-10 | local `icd10_codes` | As version 1. |
| 91875-5 | LOINC | carried from the 2026-09-24 wave-2 list (GBS NAAT) | Not re-verified. |
| 1549-5, 1501-6, 1514-9, 1530-5 | LOINC | 2026-09-24 wave-2 (100-g test: fasting, 1 h, 2 h, 3 h) | Now read by gates. |

**What the gates match on the medication list (version 5) — ingredients, verified on RxNav on
2026-10-04** (the spec's reference table, "Match a medication by ingredient or class"; the
aspirin ingredient was verified the same way for this brief):

| What | Gate condition | Verified on | Notes |
|---|---|---|---|
| Influenza vaccine | `RXNORM_INGREDIENT` `1657128` (influenza A H1N1 antigen) | Fluzone, Fluad, Flucelvax, Flublok, Afluria, FluMist — 2025–26 and 2026–27 products all carry 1657128, 1657131 and 1657134 | One ingredient is enough: every seasonal product has all three. Chosen over `ATC` `J07BB` because an ingredient-coded entry matches without needing a product class. **FluMist (live, contraindicated in pregnancy) matches too**: a dose given is still a dose given. |
| COVID-19 vaccine | `RXNORM_INGREDIENT` `2468231` **or** `2606074` — two leaves | Comirnaty, Spikevax, mNEXSPIKE → 2468231; Nuvaxovid → 2606074 | `ATC` `J07BN` misses Nuvaxovid (no ATC class in RxNav). |
| Tdap | `RXNORM_INGREDIENT` `798302` (acellular pertussis vaccine) | Boostrix, Adacel match; Tenivac (plain Td) does not | **Pediatric DTaP (Daptacel) shares the ingredient.** It cannot matter here: the window is this pregnancy. |
| RSV vaccine | `RXNORM_INGREDIENT` `2636589` (RSV pre-fusion F protein) | Abrysvo | **Arexvy shares the ingredient** (not approved in pregnancy). A prior Arexvy dose closes the offer, as any RSV vaccine does. |
| Folic acid, alone or in a prenatal vitamin | `RXNORM_INGREDIENT` `4511` | folic acid 0.4 mg and 1 mg tablets; Vitafol-One; the iron-carbonyl prenatal multivitamin 1248142 | "Contains folic acid". |
| Aspirin | `RXNORM_INGREDIENT` `1191` | RxNav: `1191` is aspirin, TTY IN; aspirin 81 mg tablet (243670) and chewable (318272) normalise to it | Any aspirin product, any dose, any combination (J41). |

- **System.** The medication list is RxNorm (the engine fixes the code system per field, and
  the simulator's composer searches medications as `RXNORM`). Vaccines as RxNorm: confirmed
  `[DECISION — Josh 2026-10-04]`. **Known limit:** a chart feed that records immunizations as
  CVX is not recognised.
- **The product codes of versions 2–4** (64 RxNorm codes: aspirin, folic acid, seven prenatal
  multivitamins, and the Tdap, RSV, influenza and COVID-19 products) are no longer read by any
  gate. They remain in `scripts/seed-prenatal-reference-codes.sql` only so that a tester can
  find and enter those products in the simulator; matching does not depend on the file. It
  has not been run.

### 0.9 Moved out to the future Rh-negative pathway `[DECISION — Josh 2026-10-04]`

Josh: RhIG before 12 weeks — "that's part of rh neg pathway, not routine prenatal"; fetal RhD
cfDNA — "rh neg pathway"; and the routine 28-week RhIG moves there too. Routine prenatal care
**only types Rh and runs the antibody screen**, and recommends adding the diagnosis when the
type is negative. Everything below was removed from this pathway and is recorded here so the
Rh-negative pathway can pick it up. **None of it is built content.**

| Removed | What it said (sources [21][22][23]) |
|---|---|
| Old Steps 9.2–9.4, gates `gate-rh-negative` / `gate-rh-positive` at 27 weeks | Review Rh status in the third trimester; RhIG or "no prophylaxis needed" step |
| **Med-6 Rho(D) immune globulin 300 µg**, lane `rh-immune-globulin-prophylaxis`, RxNorm 35465 (IN), SCD 731381, HCPCS J2790 | 300 µg (1500 IU) IM at about 28 weeks, after the repeat antibody screen, only if unsensitized |
| Sched-5 | "~28 weeks, after a repeat antibody screen; postpartum within 72 h if the newborn is Rh-positive" |
| Lab-23 repeat antibody screen at 24–28 weeks (890-4) | USPSTF: repeat antibody testing for unsensitized Rh-negative patients at 24–28 weeks |
| Postpartum dose | Within 72 hours of birth if the newborn is Rh-positive |
| Sensitizing events | Bleeding after 20 weeks, abdominal trauma, external cephalic version, amniocentesis / CVS, ectopic pregnancy, loss at ≥12 weeks |
| Early loss | ACOG Clinical Practice Update 2024: forgo routine RhIG for loss or abortion before 12 0/7 weeks. The RhoGAM label still lists it (conflict C13) |
| Fetal RhD genotyping by cfDNA | CC No. 8 accepts it to skip RhIG; the ACOG shortage advisory reserves routine use for shortages (conflict C6). Not needed when the father or donor is known Rh-negative |
| "Unsensitized" | A positive antibody screen (alloimmunized) → maternal–fetal medicine |
| `step-9-3 REQUIRES step-1-3` | RhIG needs the initial type and screen |
| ECV text "anti-D after ECV if Rh-negative" (old Step 11.2) | A sensitizing event |
| Timing conflict C5 | Label 26–28 weeks; USPSTF after the 24–28-week screen; ACOG 28 weeks |

**Confirmed on review of version 1** `[DECISION — Josh 2026-10-04]`: type and screen stay in
routine care; "if rh neg found, suggest rh neg pathway as result in prenatal pathway"; the
24–28-week repeat antibody screen and all RhIG belong to the Rh-negative pathway; Z67.91
stands as the diagnosis to add.

**Josh's inputs to that pathway** (recorded, not built): about 28 weeks, after the repeat
antibody screen, is the right timing for routine RhIG; his leaning is to forgo routine RhIG
before 12 weeks, per ACOG.

**Until that pathway exists, Prism recommends no Rh immune globulin for anyone.** Step 1.24
says so in its guidance.

**Weak D and partial D** `[DECISION — Josh 2026-10-04]` (version 3): "there can be weakly pos" — a
result that is not clearly positive is flagged the same way as a negative one, and the
Rh-negative pathway is where RHD genotyping and the decision to treat as Rh-negative belong.
The 2026-09-24 draft's line "weak D (Du-positive) patients are not at risk of
alloimmunization" (Guidelines for Perinatal Care [2]) is removed from Step 1.3: it is that
pathway's question, not a reason for routine care to stay silent. ICD-10-CM has no code for
weak D or partial D; the step always recommends Z67.91 for them, as for Rh negative
`[DECISION — Josh 2026-10-04]` (version 4).

**The diagnosis to add** `[DECISION — Josh 2026-10-04]` ("Z67.91 stands"). Built: **Z67.91** (unspecified blood type, Rh
negative), or the ABO-specific Z67.11 / .21 / .31 / .41. Reasons:
- It says exactly what is known — her blood type — and nothing about antibodies.
- It is a Z code, so it sits beside Z34 without breaking the ICD-10-CM rule that Z34 is not
  used with a chapter-15 code (§0.3). O26.89- ("other specified pregnancy related
  conditions", the index entry for Rh-negative state in pregnancy) is a chapter-15 code:
  on a visit coded that way Z34 would not be used beside it (§0.3).
- **O36.01-** means anti-D antibodies are present. It is the code for the alloimmunized
  patient, not for an unsensitized Rh-negative one, and is named in Step 1.24 only for that
  case.
- Cost for the future pathway: Rh-negative is five leaves under five different parents
  (Z67.1, .2, .3, .4, .9), so its trigger is those five codes, not one family. As an
  OBSTETRIC pathway it would still fire only for a pregnant patient.

---

## 1. Pathway metadata

- **Logical ID**: `routine-prenatal-care`
- **Title**: Routine Prenatal Care
- **Version**: 6
- **Category**: OBSTETRIC (behaviour, not a label: the pathway applies only to a patient the
  chart shows is pregnant)
- **Scope**: Outpatient antepartum care for every pregnancy under supervision, from the first
  prenatal contact to birth: intake and dating; the initial laboratory panel; genetic
  screening options; psychosocial screening; preeclampsia risk and aspirin; supplements,
  immunizations and counselling; every-visit monitoring; and gestational-age-windowed care
  (dating ultrasound, aneuploidy windows, anatomy survey, early and universal diabetes
  testing, the 24–28-week CBC, Tdap, third-trimester rescreening, the RSV vaccine, GBS, fetal
  presentation, birth and postpartum planning, late-term surveillance).

  **Screens and hands off** (recommends the diagnosis, which the provider adds to the
  encounter; does not treat): gestational diabetes, overt diabetes, elevated blood pressure,
  anemia, Rh(D)-negative blood type.

  **Out of scope:**
  - treatment of any of those problems;
  - **all Rh-negative management, including the 24–28-week repeat antibody screen and Rh
    immune globulin** (§0.9);
  - condition-specific high-risk management (multiples, prior preterm birth and cervical
    length, TOLAC, OUD treatment, age ≥40 testing, obesity-based testing), listed as text in
    Step 1.2 (D-23);
  - intrapartum and postpartum care, beyond planning;
  - nausea/vomiting treatment.
- **Target population**: Pregnant patients receiving outpatient prenatal care, average risk or
  under high-risk supervision.
- **Condition codes** (trigger codes; OR semantics; matched against the diagnoses on the
  **encounter**, never the chart) `[DECISION — Josh 2026-10-04]`: "any code for supervision of
  pregnancy or pregnancy in general. Not pregnancy related problems."

| Code | System | Description | Usage note | Grouping |
|---|---|---|---|---|
| `Z34` | ICD-10 | Encounter for supervision of normal pregnancy (family, all 12 leaves) | primary trigger | supervision-of-pregnancy |
| `O09` | ICD-10 | Supervision of high risk pregnancy (family, all 64 leaves) | primary trigger — routine elements only (D-23) | supervision-of-pregnancy |
| `Z33.1` | ICD-10 | Pregnant state, incidental | pregnancy in general | pregnant-state |
| `Z33.3` | ICD-10 | Pregnant state, gestational carrier | pregnancy in general | pregnant-state |

- `[LEAF CODES — Z33: the family would admit Z33.2, encounter for elective termination of pregnancy, which is not prenatal care]`
  `Z33.1` and `Z33.3` therefore stay leaves (Josh: "NOT the Z33 parent").
- `Z34` and `O09` are whole families: every code beneath them is supervision of pregnancy.
- **Removed in version 2:** `O24.41` and `O99.810`. They are pregnancy problems, not
  supervision of pregnancy. They are still read from the chart by the GDM gates.
- **Z3A is not used** (weeks of gestation; D-17).
- Proved: `gate-proof.ts prenatal-triggers` — Z34.90, Z34.03, O09.513, O09.90, Z33.1, Z33.3
  start it; Z33.2, Z3A.28, O24.410, O99.810, O99.012, O13.3, D50.9 do not.

## 1b. Code sets

None. Single-condition pathway, legacy OR over `condition_codes`.

## 2. Stages

Stages 1–2 are root-connected. Every other stage is **branch-entry only**, behind a
gestational-age gate. Stage numbers are unique: 1–6 and 9–12. **Stages 7 and 8 no longer
exist**: in version 1 they were the two branches of the strategy question; in version 2 the
results are read from the chart on Stage 6, so their steps are Stage 6 steps (6.7–6.13). The
later stages keep their numbers and ids.

- **Stage 1 — Initial prenatal assessment and whole-pregnancy care** *(root)*: dating; history
  and risk; the initial laboratory panel, each test ordered only if not on file; the anemia
  and Rh hand-offs; psychosocial screening; genetic screening options; preeclampsia risk and
  aspirin; supplements and counselling; influenza and COVID-19 vaccines. Step 1.1 hosts every
  GA gate. [1][2][3]
- **Stage 2 — Every prenatal visit** *(root)*: BP with the elevated-BP hand-off, weight, fetal
  heart and movement, fundal height, symptom review, tailored visit schedule. [1][16][50]
- **Stage 3 — First trimester (before 14 0/7 weeks)** *(via `gate-ga-first-trimester`)*. [3][4]
- **Stage 4 — Early diabetes testing (before 24 0/7 weeks)** *(via `gate-ga-before-24`)*.
  [52][55][56]
- **Stage 5 — Second-trimester screening (14 0/7–23 6/7 weeks)** *(via `gate-ga-14-to-24`)*.
  [1][4]
- **Stage 6 — From 24 0/7 weeks: repeat CBC and gestational diabetes screening** *(via
  `gate-ga-24-plus`)*: the repeat CBC; GDM status, screening and diagnosis, all read from the
  chart. [1][53][54][55][57]
- **Stage 9 — From 27 0/7 weeks: third-trimester care** *(via `gate-ga-27-plus`)*: Tdap;
  third-trimester rescreening; repeat psychosocial screening; birth, breastfeeding and
  contraception planning. No Rh content (§0.9). [1][8][24][44]
- **Stage 10 — Maternal RSV vaccine window (32 0/7–36 6/7 weeks)** *(via `gate-ga-32-to-37`)*.
  [24][25][26]
- **Stage 11 — From 36 0/7 weeks: GBS, presentation and birth planning** *(via
  `gate-ga-36-plus`)*. [1][20][44][48][62]
- **Stage 12 — From 41 0/7 weeks: late-term surveillance and delivery** *(via
  `gate-ga-41-plus`)*. [46][47]

Proved (`gate-proof.ts prenatal-ga`): a 10-week patient gets Stages 1–4; 20 weeks 1, 2, 4, 5;
28 weeks 1, 2, 6, 9; 36 weeks 1, 2, 6, 9, 10, 11; 41 weeks 1, 2, 6, 9, 11, 12; and nothing from
a later window.

## 3. Steps

A step marked *(gated)* has no `HAS_STEP` edge; its gate is the only way in.

### Stage 1 — Initial prenatal assessment and whole-pregnancy care

- **Step 1.1 — Confirm pregnancy and establish gestational age and due date** *(hosts the
  eight GA gates; QM-1; CodeEntry Z34.00)*: dating method (first-trimester ultrasound, CRL,
  ±5–7 days); redating thresholds (>5 days to 8 6/7 weeks; >7 days at 9 0/7–15 6/7; >10 days
  at 16 0/7–21 6/7; >14 days at 22 0/7–27 6/7; >21 days from 28 weeks, with caution);
  suboptimal dating (no confirming ultrasound before 22 0/7 weeks); ART pregnancies use the
  ART-derived EDD. Record GA in completed weeks. [1][3]
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
    - opioid use disorder: agonist therapy (CO 711).

  [1][2][46][49]
- **Step 1.3 — Initial prenatal laboratory panel: what is already on file** *(hosts the
  thirteen "not on file" gates, `gate-hgb-low` and `gate-rh-not-positive`)*: the chart is read
  test by test (§4b). "This pregnancy" is since the LMP, from the gestational age. The step
  itself orders nothing. An Rh(D) type that is not clearly positive is flagged (Step 1.24). TB testing and
  TSH only if at risk; cervical screening on the routine schedule.
  [1][2][6][7][9][10][11][12][13][14][15][21][22]
- **Steps 1.10–1.22 — one order step per panel test** *(each gated by its "not on file"
  gate)*; each carries exactly one LabTest (§6):

  | Step | Orders | Gate | "Already done" means |
  |---|---|---|---|
  | 1.10 | CBC (Lab-1) | `gate-cbc-due` | a hemoglobin (718-7) drawn this pregnancy (`PREGNANCY`) |
  | 1.11 | ABO/Rh(D) type (Lab-2) | `gate-abo-rh-due` | a type (882-1) on file, **ever** |
  | 1.12 | Antibody screen (Lab-3) | `gate-antibody-screen-due` | 890-4 this pregnancy |
  | 1.13 | Rubella IgG (Lab-4) | `gate-rubella-due` | 25514-1 this pregnancy |
  | 1.14 | Syphilis serology (Lab-5) | `gate-syphilis-due` | RPR 20507-0 **or** treponemal 22587-0 this pregnancy |
  | 1.15 | HBsAg (Lab-6) | `gate-hbsag-due` | 5196-1 or 5195-3 this pregnancy (every pregnancy) |
  | 1.16 | HBV triple panel: anti-HBs, total anti-HBc (Lab-7) | `gate-hbv-triple-due` | 16935-9 or 16933-4 on file, **ever** ("if never documented") |
  | 1.17 | HIV Ag/Ab (Lab-8) | `gate-hiv-due` | 56888-1 this pregnancy |
  | 1.18 | HCV antibody (Lab-9) | `gate-hcv-due` | 13955-0 this pregnancy |
  | 1.19 | Urine culture (Lab-10) | `gate-urine-culture-due` | 630-4 this pregnancy |
  | 1.20 | Chlamydia/gonorrhea NAAT, if <25 or at risk (Lab-11) | `gate-ct-gc-due` | 21613-5 or 21416-3 this pregnancy |
  | 1.21 | Hemoglobinopathy evaluation (Lab-12) | `gate-hgbpathy-due` | 43113-0 on file, **ever** (once per lifetime) |
  | 1.22 | Varicella IgG, if no history or vaccination (Lab-13) | `gate-varicella-due` | 19162-7 this pregnancy |

- **Step 1.23 — Low hemoglobin: add the anemia diagnosis** *(gated by `gate-hgb-low`)*
  `[DECISION — Josh 2026-10-04]`: the most recent hemoglobin **drawn this pregnancy** is below
  the trimester threshold (<11.0 g/dL first or third trimester; <10.5 second — "correct",
  Josh). Add O99.011 / .012 / .013 to the encounter. The anemia pathway then joins the visit
  and owns the workup and treatment; this step orders nothing. A hemoglobin from before this
  pregnancy does not open this step: it is left for the anemia pathway to use if the provider
  adds anemia. CodeEntry `O99.01`; Guid-12. [1][2]
- **Step 1.24 — Rh(D) type not clearly positive: add the diagnosis** *(gated by
  `gate-rh-not-positive`)* `[DECISION — Josh 2026-10-04]` ("there can be weakly pos"; "if rh
  neg found, suggest rh neg pathway as result in prenatal pathway"): the type is negative,
  weak D, partial D or otherwise not clearly positive.
  - **Add Z67.91** (or the ABO-specific Rh-negative code) to the encounter — for weak D and
    partial D as well as for Rh(D) negative (`[DECISION — Josh 2026-10-04]`: always recommend
    the Rh-negative code). Note the serologic result.
  - Rh management — RHD genotyping for weak D, the 24–28-week repeat antibody screen and all
    Rh immune globulin — belongs to the Rh-negative pathway.
  - A positive antibody screen (alloimmunization, O36.01-) needs maternal–fetal medicine.

  CodeEntry Z67.91; Guid-13. [21][22]
- **Step 1.4 — Psychosocial and behavioral screening** *(unconditional; QM-3)*:
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
- **Step 1.5 — Genetic screening and diagnostic testing options** *(unconditional; Lab-14 cfDNA)*:
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
  - **Carrier screening.** Offer everyone CF and SMA carrier screening. Universal
    hemoglobinopathy testing if no prior result is ordered from Step 1.21. Ethnic-specific, panethnic or expanded panels are all acceptable (CO 690).
    - Fragile X only with a family history of fragile X or intellectual disability, or
      unexplained ovarian insufficiency / elevated FSH before 40.
    - Screening is done once per lifetime.
    - A carrier → offer partner testing.
  - **Every patient is offered the anatomy survey** regardless of screening method (Stage 5).

  [4][5][6][63]
- **Step 1.6 — Preeclampsia risk assessment** *(hosts `gate-on-aspirin` and
  `gate-aspirin-not-on-list`)*: the medication list is read first.
  - **High-risk factors** (any one): prior preeclampsia, multifetal gestation, chronic
    hypertension, pregestational diabetes, kidney disease, SLE/APS.
  - **Moderate-risk factors** (more than one): nulliparity, BMI >30, family history, Black race
    (a proxy for racism), lower income, age ≥35, personal-history factors, IVF.
  - ACOG/SMFM: may consider with Black race or lower income alone.

  [17][18][19]
- **Step 1.25 — Already on low-dose aspirin: continue** *(gated by `gate-on-aspirin`)*:
  nothing is started; Guid-11. [17][18][19]
- **Step 1.26 — Aspirin eligibility** *(gated by `gate-aspirin-not-on-list`; hosts
  `gate-aspirin-indicated`)*: not on aspirin and before 28 weeks. [17][18][19]
- **Step 1.7 — Start low-dose aspirin** *(gated by `gate-aspirin-indicated`)*: 81 mg daily,
  started at 12–28 weeks (optimally before 16), continued until delivery. Exempt from the FDA
  NSAID advice [64]. Med-2, Sched-2. [17][18][19][64]
- **Step 1.8 — Supplements and healthy-pregnancy counselling** *(hosts
  `gate-on-prenatal-vitamin` and `gate-prenatal-vitamin-not-on-list`; Guid-1 to Guid-6)*: the
  medication list is read first; if nothing recognised is on it the patient is asked once.
  4 mg folic acid after a prior NTD-affected pregnancy, as a separate supplement through the
  first 3 months — CDC: start 1 month before conception [65]; ACOG: at least 3 months before
  [66] (both stated, `[DECISION — Josh 2026-10-04]`). Iron 27 mg/day [66]; iodine 150 mcg/day
  [67]. Avoid NSAIDs from 20 weeks, except aspirin 81 mg [64].
  [28][36]–[41][45][51][64]–[68]
- **Step 1.28 — Prenatal vitamin already on the medication list: continue** *(gated by
  `gate-on-prenatal-vitamin`)*: folic acid or a recognised prenatal multivitamin is listed.
  Nothing is started and nothing is asked. Guid-10. [28][65][66][67]
- **Step 1.29 — No prenatal vitamin on the medication list: is she taking one?** *(gated by
  `gate-prenatal-vitamin-not-on-list`; hosts `gate-taking-prenatal-vitamin` and
  `gate-not-taking-prenatal-vitamin`)* `[DECISION — Josh 2026-10-04]` ("known list, else
  ask"; "effectively is pt on prenatal > yes"): asked once; a "yes" is remembered for this
  pregnancy. [28][65][66][67]
- **Step 1.30 — Taking a prenatal vitamin that is not on the medication list: continue**
  *(gated by `gate-taking-prenatal-vitamin`)*: nothing is started; the answer is remembered; add
  the vitamin to the medication list. Guid-19. [28][65][66][67]
- **Step 1.27 — Start a prenatal vitamin with folic acid** *(gated by
  `gate-not-taking-prenatal-vitamin`)*: she is not taking one, or it is not known ("Not
  available"). Med-1.
  [28][65][66][67]
- **Step 1.9 — Immunizations at any gestational age: what has already been given** *(hosts
  `gate-influenza-vaccine-due`, `gate-influenza-vaccine-undated`, `gate-covid-vaccine-due`,
  `gate-covid-vaccine-undated`)* `[DECISION — Josh 2026-10-04]`: vaccines are read from the
  medication list.
  - **Inactivated or recombinant influenza vaccine** in any trimester during the season
    (third-trimester patients as soon as vaccine is available; LAIV is contraindicated).
  - **COVID-19 vaccine per ACOG**, with shared decision-making and the discussion documented;
    CDC's current position is stated in Med-4 (D-26 `[DECISION — Josh 2026-09-24]`).
  - Both are recommended **only in season, September 1 to March 31**
    (`[DECISION — Josh 2026-10-04]`), and only when no dose is dated on or after the most
    recent September 1; an entry with no date is asked about. Out of season nothing is
    recommended or asked (§4b).
  - **Hepatitis B vaccine** if susceptible on the triple panel (Engerix-B, Heplisav-B,
    Recombivax HB or Twinrix; PreHevbrio is not recommended in pregnancy).
  - **MMR and varicella are contraindicated in pregnancy.** Give postpartum if non-immune.

  [24][25][27]
- **Step 1.31 — Give the influenza vaccine** *(gated by `gate-influenza-vaccine-due`)*: Med-3.
  [24][25][27]
- **Step 1.33 — Influenza vaccine on the medication list with no date: was it this season?**
  *(gated by `gate-influenza-vaccine-undated`; hosts the router
  `gate-influenza-vaccine-given`)*. [24][25][27]
- **Step 1.34 — Influenza vaccine already given this season** *(router: yes)*: not repeated;
  add the date. Guid-20. [24][25][27]
- **Step 1.35 — Give the influenza vaccine** *(router: no)*: Med-3b, the same order as Med-3.
  [24][25][27]
- **Step 1.32 — Offer the COVID-19 vaccine** *(gated by `gate-covid-vaccine-due`)*: Med-4.
  [24][25]
- **Step 1.36 — COVID-19 vaccine on the medication list with no date: was it this season?**
  *(gated by `gate-covid-vaccine-undated`; hosts the router `gate-covid-vaccine-given`)*.
  [24][25]
- **Step 1.37 — COVID-19 vaccine already given this season** *(router: yes)*: Guid-21. [24][25]
- **Step 1.38 — Offer the COVID-19 vaccine** *(router: no)*: Med-4b. [24][25]

### Stage 2 — Every prenatal visit

- **Step 2.1 — Blood pressure at every visit** *(hosts `gate-bp-elevated`)*: positive screen
  ≥140 systolic or ≥90 diastolic; confirm; diagnosis needs two readings ≥4 hours apart;
  severe range ≥160/≥110. [16]
- **Step 2.2 — Elevated blood pressure: confirm and add the diagnosis** *(gated)*
  `[DECISION — Josh 2026-10-04]` (D-25): severe range → same-day evaluation. At ≥20 weeks add
  R03.0 to the encounter until confirmed, then O13.x or O14.x; the hypertension pathway then
  joins the visit. Before 20 weeks evaluate for chronic hypertension. CodeEntry R03.0;
  Guid-14. [16]
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
- **Step 2.4 — Tailored visit schedule** *(unconditional; Sched-1)*:
  - Average risk: intake plus about 8 visits.
    - In person at about 10, 16, 28, 36 and 39 weeks.
    - Any modality at 22, 32 and 38 weeks.
    - Anatomy ultrasound at about 20 weeks.
  - Greater-than-average risk: intake plus about 13 visits.
  - Telehealth where no exam, lab, imaging or vaccine is needed.
  - "Tailored care does not mean less care."
  [1][2]

### Stage 3 — First trimester

- **Step 3.1 — Dating and viability ultrasound, if not already done** *(Img-1)*. Imaging
  reports are not read from the chart. [3]
- **Step 3.2 — First-trimester serum and nuchal translucency screening, for patients choosing
  it** *(Lab-15, Img-2)*: combined screen at **10 0/7–13 6/7** weeks
  (`[DECISION — Josh 2026-10-04]`, conflict C7). Not needed if she chose cfDNA. [4]

### Stage 4 — Early diabetes testing (before 24 0/7 weeks)

- **Step 4.1 — Early diabetes testing: read the HbA1c on file** *(hosts
  `gate-overt-diabetes`, `gate-early-abnormal-glucose`, `gate-a1c-not-on-file`)*: the HbA1c
  **drawn this pregnancy** decides (`[DECISION — Josh 2026-10-04]`) — ≥6.5% is diabetes;
  5.9–6.4% is early abnormal glucose metabolism — whatever the eligibility answer. One from
  before this pregnancy is not read. **Nobody is asked for an HbA1c.** One-step/two-step GDM
  criteria are not applied before 24 weeks. The alternatives (FPG ≥126; 2-h 75-g ≥200; random
  ≥200 with symptoms) are text only (D-6). [52][55][56][58]
- **Step 4.3 — Overt diabetes in pregnancy: confirm and add the diagnosis** *(gated by
  `gate-overt-diabetes`)*: confirm with a second abnormal test unless unequivocal; add
  O24.111–.119 (or O24.911–.919) to the encounter. Not GDM. CodeEntries
  O24.111/.112/.113/.119; Guid-15. [55]
- **Step 4.4 — Early abnormal glucose metabolism: counselling and fasting-glucose
  monitoring** *(gated by `gate-early-abnormal-glucose`)* (D-7): not a GDM diagnosis; do not
  code O24.4-. Nutrition counselling; fasting glucose 3–4 times a week. Universal screening
  at 24–28 weeks still applies. Guid-A5. [52][55][56]
- **Step 4.6 — No HbA1c this pregnancy: is early testing indicated?** *(gated by
  `gate-a1c-not-on-file`; hosts `gate-early-testing-indicated`)*: ADA Table 2.5 criteria
  (D-12 lands here: GDM in a prior pregnancy). [52][55][56][58]
- **Step 4.2 — Order the HbA1c** *(gated by `gate-early-testing-indicated`)*: before 15 weeks
  if possible. The result is not asked for; it is read once it is on the chart. Lab-17;
  Guid-A2. [52][55]
- **Step 4.5 — Plan universal GDM screening at 24–28 weeks** *(Sched-3)*. [53][55][57]

### Stage 5 — Second-trimester screening

- **Step 5.1 — Fetal anatomy ultrasound at 18–22 weeks** *(Img-3)*. [1][3][4]
- **Step 5.2 — Second-trimester serum screening / open NTD assessment** *(Lab-16)*. [4]

### Stage 6 — From 24 0/7 weeks

- **Step 6.1 — Anemia rescreen at 24–28 weeks: what is already on file** *(hosts
  `gate-cbc-repeat-due`)*: a hemoglobin drawn at or after 24 0/7 weeks counts. [1][2]
- **Step 6.5 — Repeat the CBC** *(gated)*: Lab-19. [1][2]
- **Step 6.2 — Gestational diabetes status: read from the chart** *(hosts
  `gate-diabetes-on-file`, `gate-gdm-screen-negative`, `gate-gdm-nothing-on-file`,
  `gate-gct-positive`, `gate-75g-diagnostic`)*. Nothing is asked for that the chart holds.
  **Only a screen drawn at or after 24 0/7 weeks counts as the 24–28-week screen**
  (`[DECISION — Josh 2026-10-04]`). Screen as soon as possible if first seen after 28 weeks.
  After bariatric surgery with dumping consider alternatives (`[GAP]`, PB 105 paywalled).
  [53][55][57]
- **Step 6.4 — Diabetes already diagnosed: no screening** *(gated by
  `gate-diabetes-on-file`)*: Guid-16. [55][56]
- **Step 6.3 — GDM screening complete: negative** *(gated by `gate-gdm-screen-negative`)*: the
  screen drawn at or after 24 0/7 weeks is negative. No repeat unless clinically suspected.
  (Versions 1–3 told the provider to order the screen if the result on file was drawn before
  24 weeks; the gate now reads only results from 24 weeks, so that instruction is removed.)
  Guid-17. [53]
- **Step 6.6 — No GDM screen since 24 weeks: choose the strategy** *(gated by
  `gate-gdm-nothing-on-file`; hosts the router `gate-gdm-strategy`)*: the only question in GDM
  screening. A negative screen from before 24 weeks does not count, so it leads here too.
  Guid-A1. [53][55][57]
- **Step 6.7 — Order the 50-g 1-hour challenge** *(router: two-step)*: nonfasting; positive at
  ≥140 mg/dL (D-3). Lab-20. The result is not asked for. [53][54][55][57]
- **Step 6.8 — Order the 75-g 2-hour test** *(router: one-step)*: thresholds 92 / 180 / 153;
  GDM if any one is met. Lab-22. The result is not asked for. [55][57]
- **Step 6.9 — Positive 50-g challenge: the 100-g 3-hour test** *(gated by
  `gate-gct-positive`; hosts `gate-ogtt100-not-on-file`, `gate-100g-diagnostic`,
  `gate-100g-negative`)* `[DECISION — Josh 2026-10-04]`: a 50-g ≥140 drawn at any gestational
  age this pregnancy is the two-step route; the strategy is not asked (PB 180: a positive
  early screen goes straight to the diagnostic test at 24–28 weeks). Carpenter–Coustan
  95 / 180 / 155 / 140 mg/dL; GDM if ≥2 met (D-4). The four values are read from the chart,
  and only values drawn at or after 24 0/7 weeks. [53][55][57][58]
- **Step 6.10 — Order the 100-g 3-hour test** *(gated by `gate-ogtt100-not-on-file`)*: none
  drawn since 24 0/7 weeks. Add O99.810 to the encounter while it is pending. Lab-21;
  CodeEntry O99.810. The result is not asked for. [53][55][57][58]
- **Step 6.11 — Diagnose GDM (two-step): add O24.410 to the encounter** *(gated by
  `gate-100g-diagnostic`)*: replaces O99.810. CodeEntry O24.410; Guid-A4. [53][55][56]
- **Step 6.12 — Two-step screening complete: the 100-g test does not meet criteria** *(gated
  by `gate-100g-negative`)*: not GDM; no repeat unless suspected. Guid-18. [53][55]
- **Step 6.13 — Diagnose GDM (one-step): add O24.410 to the encounter** *(gated by
  `gate-75g-diagnostic`)*: CodeEntry O24.410; Guid-A4b. [55][56]

Version 1's Stage 7 and Stage 8 steps map as: 7.5 → 6.7; 8.3 → 6.8; 7.2 → 6.9; 7.6 → 6.10;
7.3 → 6.11; 7.4 → 6.12; 8.2 → 6.13. Steps 7.1 and 8.1 (the hosts of the result gates that
asked) are gone.

### Stage 9 — From 27 0/7 weeks

- **Step 9.1 — Tdap vaccine: what has already been given** *(hosts `gate-tdap-due` and
  `gate-tdap-undated`; QM-2)* `[DECISION — Josh 2026-10-04]`: one dose each pregnancy, early
  in the 27–36-week window. The medication list is read: a Tdap dated this pregnancy is not
  repeated; one dated in an earlier pregnancy does not count; one listed with no date is
  asked about. [24][25][26][27][60]
- **Step 9.10 — Give the Tdap vaccine** *(gated by `gate-tdap-due`)*: Med-5, Sched-4. [24][25]
- **Step 9.11 — Tdap on the medication list with no date: was it this pregnancy?** *(gated by
  `gate-tdap-undated`; hosts `gate-tdap-given` and `gate-tdap-not-given`)*: a "yes" is
  remembered for this pregnancy. [24][25]
- **Step 9.12 — Tdap already given this pregnancy** *(gated by `gate-tdap-given`)*: Guid-22.
  [24][25]
- **Step 9.13 — Give the Tdap vaccine** *(gated by `gate-tdap-not-given`)*: not given this
  pregnancy, or not known. Med-5b, Sched-4b.
  [24][25]
- **Step 9.5 — Third-trimester infection rescreening: what is already on file** *(hosts three
  "not since 28 weeks" gates)*: from 28 0/7 weeks. **Syphilis in every patient** in the third
  trimester and at birth (ACOG 2024; `[DECISION — Josh 2026-10-04]`, conflict C1); HIV before
  36 weeks if at risk; chlamydia/gonorrhea if <25 or at risk. A test drawn at or after 28 0/7
  weeks counts as done. [8][10][11][15]
- **Step 9.7 — Order the third-trimester syphilis rescreen** *(gated)*: Lab-24. [7][8]
- **Step 9.8 — Order the HIV rescreen if at risk** *(gated)*: Lab-25. [10][11]
- **Step 9.9 — Order the chlamydia and gonorrhea rescreen if under 25 or at risk** *(gated)*:
  Lab-26. [15]
- **Step 9.6 — Repeat psychosocial screening and birth/postpartum planning** *(unconditional; Guid-7, Guid-8, QM-4)*:
  - **Screening:** depression/anxiety screen "later in pregnancy"; IPV this trimester.
  - **Breastfeeding:** intention, support and referral.
  - **Reproductive life plan and postpartum contraception:** avoid interpregnancy intervals
    <6 months; discuss the risks <18 months.
    - For **Medicaid sterilization**, consent must be signed ≥30 days before the procedure
      (42 CFR 441.253).
  - **Postpartum care plan:** contact within 3 weeks; comprehensive visit by 12 weeks.
  [29][31][42][43][44][59]

Version 1 removed the draft's Steps 9.2–9.4 (Rh review, RhIG, Rh-positive) (§0.9).

### Stage 10 — Maternal RSV vaccine window

- **Step 10.1 — Maternal RSV vaccine: season, and what has already been given** *(hosts
  `gate-rsv-vaccine-due` and `gate-rsv-vaccine-undated`)* `[DECISION — Josh 2026-10-04]`:
  offered at 32 0/7–36 6/7 weeks and **only in season: September 1 to March 1 (ACOG)**; CDC's
  season is September through January (conflict C3). Out of season nothing is offered. One
  dose in a lifetime: an RSV vaccine recorded at any time is not repeated; one listed with no
  date is asked about. Also not offered if delivery is planned within 2 weeks or the family
  plans the infant monoclonal. [24][25][26]
- **Step 10.2 — Offer the maternal RSV vaccine, or plan the infant monoclonal antibody**
  *(gated by `gate-rsv-vaccine-due`)*: Med-7, Sched-6. [24][25][26]
- **Step 10.3 — RSV vaccine on the medication list with no date: has she had it?** *(gated by
  `gate-rsv-vaccine-undated`; hosts `gate-rsv-vaccine-given` and `gate-rsv-vaccine-not-given`)*:
  a "yes" is remembered for the patient. [24][25][26]
- **Step 10.4 — RSV vaccine already given: not repeated** *(gated by
  `gate-rsv-vaccine-given`)*: plan the infant monoclonal. Guid-23. [24][25][26]
- **Step 10.5 — Offer the maternal RSV vaccine, or plan the infant monoclonal antibody**
  *(gated by `gate-rsv-vaccine-not-given`)*: she has not had it, or it is not known. Med-7b,
  Sched-6b. [24][25][26]

### Stage 11 — From 36 0/7 weeks

- **Step 11.1 — Group B streptococcus screening: what is already on file** *(hosts
  `gate-gbs-culture-due`)*: screen at 36 0/7–37 6/7 weeks whatever the planned mode of birth.
  A result drawn at or after 36 0/7 weeks and within the last 5 weeks is valid and is not
  repeated. Not needed with GBS bacteriuria this pregnancy (O99.820) or a prior GBS-infected
  newborn. Prior-pregnancy colonization does not exempt. [20]
- **Step 11.4 — Order the GBS vaginal–rectal culture** *(gated)*: Lab-27, Sched-7. [20]
- **Step 11.2 — Assess fetal presentation; offer ECV for breech** *(Proc-3)*. The "anti-D
  after ECV" line moved out (§0.9). [1][48]
- **Step 11.3 — Birth timing and labor planning** *(Guid-9)*. [47][49][62]

### Stage 12 — From 41 0/7 weeks

- **Step 12.1 — Late-term fetal surveillance; plan delivery** *(Proc-1, Proc-2, Sched-8)*.
  [46][47]

## 4. Decision points

None. Every decision is a gate (§4b).

## 4b. Gates

**63 gates**: 58 chart gates and 5 question gates — `gate-aspirin-indicated` and
`gate-early-testing-indicated` (yes/no), and three routers: `gate-gdm-strategy`,
`gate-influenza-vaccine-given` and `gate-covid-vaccine-given`. Six of the chart gates are
yes/no pairs on a remembered patient attribute (prenatal vitamin, Tdap, RSV). Every gate is
the **sole route** to its target; every chart gate has one target; every router maps every
answer; `default_behavior` is `skip` on all of them. `check-gate-control.ts` reports no
violations and no warnings.

### How each datum is used (the brief template's "use the data the chart gives")

| Datum | Current value | Old value | Undated value | No value |
|---|---|---|---|---|
| `patient.gestational_age_weeks` | Opens the windowed stages; sets where "this pregnancy" begins (the LMP date); picks the hemoglobin threshold | n/a (sent per session) | n/a | **Asked once**; every gate reading it, `PREGNANCY` gates included, is held on the one question |
| `patient.rh_factor` | "positive" → nothing. **Anything else** — "negative", "weak D", "partial D", or any other value — → hand-off. Common spellings ("Rh+", "neg", "Du") are normalised by the engine first | n/a | n/a | **Asked once** (positive / negative / weak D / partial D) unless an Rh-negative Z67 code is on the chart. The answer is remembered for the patient (`remember_answer`, scope `PATIENT`) |
| Blood pressure (vitals) | ≥140 or ≥90 → hand-off, unless hypertension is already on the chart | n/a (`DAY`) | Asserted current | **Asked** (a measurement owed at every visit) |
| Hemoglobin 718-7 | Drawn this pregnancy and below the trimester threshold → anemia hand-off; drawn this pregnancy → no first-panel CBC; drawn at or after 24 0/7 weeks → no repeat CBC | **From before this pregnancy: ignored here** `[DECISION — Josh 2026-10-04]` — no hand-off; the CBC is ordered; the value is left for the anemia pathway | Counts as drawn this pregnancy | The CBC is ordered; this pregnancy's value is **asked** for, and "Not available" leaves the order and blocks nothing (agreed, Josh 2026-10-04) |
| HbA1c 4548-4 (before 24 weeks) | Drawn this pregnancy: ≥6.5 → overt diabetes; 5.9–6.4 → early abnormal glucose; normal → nothing | **From before this pregnancy: not read** `[DECISION — Josh 2026-10-04]`; eligibility is asked as for a patient with none | Counts as drawn this pregnancy | **Not asked.** Eligibility is asked; yes → ordered |
| 50-g challenge 1504-0 (from 24 weeks) | Drawn at or after 24 0/7 weeks: <140 → screening complete. ≥140, drawn at any time this pregnancy → the 100-g test. Nothing asked | **Before 24 0/7 weeks and negative: not the screen** `[DECISION — Josh 2026-10-04]` — screening stays open. Before this pregnancy: ignored | Counts as drawn at or after 24 weeks | **Not asked.** With no 75-g value either, the strategy is asked and the chosen test ordered |
| 75-g values 1552-9 / 1507-3 / 1518-0 | Drawn at or after 24 0/7 weeks: all three below threshold → complete; any at or above → diagnose GDM. Nothing asked | Before 24 0/7 weeks: not read | As the 50-g | **Not asked** when none is on file. A partly entered test asks for the missing values |
| 100-g values 1549-5 / 1501-6 / 1514-9 / 1530-5 (after a 50-g ≥140) | Drawn at or after 24 0/7 weeks: two or more at or above threshold → diagnose GDM; fewer → complete. Nothing asked | Before 24 0/7 weeks: not read; the test is ordered | As the 50-g | **Not asked**; the test is ordered. A partly entered test asks for the missing values |
| Diabetes code O24.- | Diagnosed: no screening, no question | Lifetime, active — a code left from a prior pregnancy reads as diagnosed: "that's a chart problem" `[DECISION — Josh 2026-10-04]` | Active | Not diagnosed |
| Anemia O99.01x / D50, hypertension R03.0 / O10 / O11 / O13 / O14 / O16, Rh-negative Z67.x1 | Closes that hand-off | Lifetime, active | Active | Hand-off can open |
| GBS carrier O99.820 | No 36-week culture | Lifetime, active | Active | Culture ordered unless one was drawn at or after 36 0/7 weeks and within 5 weeks |
| Each panel lab (§3 table) | Drawn this pregnancy → not ordered | From before this pregnancy → ordered again; type, hemoglobinopathy and HBV antibodies count **forever** | Counts as drawn this pregnancy | Ordered |
| Medication list: folic acid, prenatal multivitamins, aspirin — matched by **ingredient** | On it (any brand, any product containing it) → "continue", nothing started, nothing asked | Active only (a stopped one does not count) | Active | Vitamin: **asked once** "Already taking a prenatal vitamin?"; a "yes" is remembered for this pregnancy; "Not available" → recommended. Aspirin: eligibility asked (before 28 weeks). **An entry that cannot be identified → asked whether it counts** |
| Medication list: vaccines — matched by **ingredient** (an unidentifiable entry is asked about) | A dose **dated** in the window → not recommended, nothing asked: Tdap this pregnancy; influenza / COVID-19 since the most recent September 1; RSV ever | Dated outside the window → recommended (Tdap before this pregnancy; influenza / COVID-19 before September 1) | **Asked about** `[DECISION — Josh 2026-10-04]` — one yes/no question per vaccine; yes → not recommended, no → recommended. A "yes" for Tdap is remembered for this pregnancy and for RSV for the patient; "Not available" for either → recommended. A dated dose in the window settles it without the question | Recommended — RSV only in its season (September 1 to March 1), influenza and COVID-19 only in theirs (September 1 to March 31) |

**Not read from the chart, and why** (§0.6 #9): imaging results, age, risk factors. **The
season is read from the calendar** (the session's date), not from the chart.

**"This pregnancy"** `[DECISION — Josh 2026-10-04]`: `horizon: "PREGNANCY"` on the condition.
The window opens on the LMP date — the session clock minus the gestational age — and needs no
banding. A missing gestational age is asked for by the same question as the GA gates. No gate
adds a gestational-age condition to "protect" the window. Proved (`gate-proof.ts
prenatal-meds`): at 10 weeks an HIV test 6 days before the LMP is not this pregnancy's and one
the day after it is; at 30 weeks the same test is this pregnancy's.

### Gestational-age gates (all attached to `step-1-1`)

`patient_attribute` (or `compound` AND for a two-sided window), attribute form,
`patient.gestational_age_weeks`, unit `weeks`. **On unresolved: ask.** One datum, asked once.

| Gate | Condition | Branches to | Source (host Step 1.1) |
|---|---|---|---|
| `gate-ga-first-trimester` | GA `less_than` 14 | `stage-3` | [3][4][58] |
| `gate-ga-before-24` | GA `less_than` 24 | `stage-4` | [52][55] |
| `gate-ga-14-to-24` | AND: GA `greater_or_equal` 14; GA `less_than` 24 | `stage-5` | [4] |
| `gate-ga-24-plus` | GA `greater_or_equal` 24 | `stage-6` | [53][57] |
| `gate-ga-27-plus` | GA `greater_or_equal` 27 | `stage-9` | [24] |
| `gate-ga-32-to-37` | AND: GA `greater_or_equal` 32; GA `less_than` 37 | `stage-10` | [25][26] |
| `gate-ga-36-plus` | GA `greater_or_equal` 36 | `stage-11` | [20][48] |
| `gate-ga-41-plus` | GA `greater_or_equal` 41 | `stage-12` | [46] |

Upper bounds are deliberately omitted on Stages 6, 9, 11 and 12: a late entrant still needs
the content.

### Initial-panel "not on file" gates (all attached to `step-1-3`)

All conditions are `labs` / `not_includes_code` / LOINC with a `display`.

- A **once-ever** test is `not_includes_code` with `LIFETIME` (one code: `patient_attribute`;
  two codes: `compound` AND).
- A **this-pregnancy** test is a `compound` AND with, per code, the group
  `OR( not_includes_code LIFETIME, not_includes_code PREGNANCY )` — "never resulted, or not
  drawn this pregnancy". Logically that is just "not drawn this pregnancy"; the `LIFETIME`
  leaf is there for one reason: **a test that has never been drawn is owed whatever the
  gestational age, so it is ordered even when the gestational age is unknown.** Without it,
  a first visit with no dating (no LMP, no ultrasound yet) held the whole panel on the
  gestational-age question, and "Not available" closed all ten orders. Only a test that *is*
  on file at some date waits for the gestational age to say whether that date is in this
  pregnancy.

| Gate | Absent | Horizon | On unresolved | Branches to |
|---|---|---|---|---|
| `gate-cbc-due` | 718-7 | never, or not this pregnancy | ask | `step-1-10` |
| `gate-abo-rh-due` | 882-1 | `LIFETIME` | default | `step-1-11` |
| `gate-antibody-screen-due` | 890-4 | never, or not this pregnancy | ask | `step-1-12` |
| `gate-rubella-due` | 25514-1 | never, or not this pregnancy | ask | `step-1-13` |
| `gate-syphilis-due` | 20507-0 AND 22587-0 | never, or not this pregnancy | ask | `step-1-14` |
| `gate-hbsag-due` | 5196-1 AND 5195-3 | never, or not this pregnancy | ask | `step-1-15` |
| `gate-hbv-triple-due` | 16935-9 AND 16933-4 | `LIFETIME` | default | `step-1-16` |
| `gate-hiv-due` | 56888-1 | never, or not this pregnancy | ask | `step-1-17` |
| `gate-hcv-due` | 13955-0 | never, or not this pregnancy | ask | `step-1-18` |
| `gate-urine-culture-due` | 630-4 | never, or not this pregnancy | ask | `step-1-19` |
| `gate-ct-gc-due` | 21613-5 AND 21416-3 | never, or not this pregnancy | ask | `step-1-20` |
| `gate-hgbpathy-due` | 43113-0 | `LIFETIME` | default | `step-1-21` |
| `gate-varicella-due` | 19162-7 | never, or not this pregnancy | ask | `step-1-22` |

- "Ask" here asks only for the gestational age, and only when a result is on file whose date
  has to be placed (§0.6 #11 on the lint warning).
- **Gestational age unknown and declined**: every never-drawn test is still ordered. A test
  on file at some earlier date is **not** ordered — it cannot be placed in or out of this
  pregnancy. `[JOSH — CONFIRM]` (J30) whether that residual case should order the test
  instead. Proved: `gate-proof.ts prenatal-meds`.
- **What "already done" means per test** `[DECISION — Josh 2026-10-04]` (agreed): blood type, hemoglobinopathy
  evaluation and the HBV antibodies once ever (`LIFETIME`); everything else, rubella and
  varicella included, this pregnancy (`PREGNANCY`). The hepatitis B triple panel is "never
  documented" (`[DECISION — Josh 2026-10-04]`, conflict C2).
- **Risk-based tests** (chlamydia/gonorrhea, varicella) are ordered for everyone with no
  result this pregnancy, with the condition in the order's name `[DECISION — Josh 2026-10-04]`
  ("risk based for everyone").

### `gate-hgb-low` — Low hemoglobin this pregnancy: anemia hand-off `[DECISION — Josh 2026-10-04]`

- **Attached to:** `step-1-3` · **Branches to:** `step-1-23` (exclusively gated)
- **Type:** compound **AND** · **On unresolved: ask**
- **Conditions:**
  - `conditions` `not_includes_code` `O99.01.*` (ICD-10, `LIFETIME`, active);
  - `conditions` `not_includes_code` `D50.*`;
  - group **OR**:
    - `labs` `718-7` `less_than` **10.45**, horizon **`PREGNANCY`**, display `"Hemoglobin (g/dL)"`;
    - group **AND**: `718-7` `less_than` **10.95**, **`PREGNANCY`**; group **OR**: GA
      `less_than` 14, GA `greater_or_equal` 28.
- `[WINDOW — gate-hgb-low: this pregnancy. A hemoglobin from before it does not open the anemia suggestion (Josh, 2026-10-04); it is left for the anemia pathway to use if the provider adds anemia]`
- **Thresholds** `[DECISION — Josh 2026-10-04]`: <11.0 first and third trimester, <10.5
  second — "correct". (`less_than 10.95` / `10.45` at 0.1 g/dL precision.)
- **States:** drawn this pregnancy and below threshold → hand-off; normal → nothing; a low
  value from before this pregnancy and none since → **no hand-off**, CBC ordered; a low
  pre-pregnancy value and a normal one this pregnancy → no hand-off; anemia already on the
  chart → closed, nothing asked.
- **None drawn this pregnancy:** the CBC is ordered (`gate-cbc-due`) and this pregnancy's
  value is asked for; "Not available" closes the gate, leaves the order and blocks nothing.
  Agreed `[DECISION — Josh 2026-10-04]`: the hemoglobin is asked for at the first visit when
  none was drawn this pregnancy.
- **Rationale & source:** [1][2] → Step 1.3. Proved: `gate-proof.ts prenatal-handoffs`
  (including a value one day into the pregnancy, and one before it).

### `gate-rh-not-positive` — Rh(D) type not clearly positive: hand-off (D-24) `[DECISION — Josh 2026-10-04]`

- **Attached to:** `step-1-3` · **Branches to:** `step-1-24` (exclusively gated)
- **Type:** compound **AND** · **On unresolved: ask** ·
  **`remember_answer`: `{ "scope": "PATIENT" }`** (any answer)
- **Conditions:**
  - group **OR** ("Rh(D) type is known"): `patient.rh_factor` `in` `["positive", "negative",
    "weak D", "partial D"]`; `patient.rh_factor` `not_equals` `"positive"`. True for every
    known type, listed or not. It is first so that the question a missing type raises offers
    all four options;
  - `patient.rh_factor` `not_equals` `"positive"` — the rule: **anything not clearly positive**;
  - `conditions` `not_includes_code` for each of `Z67.11`, `Z67.21`, `Z67.31`, `Z67.41`,
    `Z67.91` (`LIFETIME`, active).
- **States:** "positive" → nothing; "negative", "weak D", "partial D", or any other string
  (for example "indeterminate") → hand-off; missing → ONE question with the four options; an
  Rh-negative Z67 code on the chart → closed without asking; "Not available" → closed, and
  `gate-abo-rh-due` still orders the typing.
- **Asked once, across visits too.** The answer is kept for the patient and supplied at later
  encounters unless the chart carries a type (the chart wins). A blood type does not change,
  hence scope `PATIENT` `[JOSH — CONFIRM]` (J33): remembering the type is the builder's
  addition to "asks once if missing".
- **Vocabulary** `[DECISION — Josh 2026-10-04]` ("accept common spellings"): the engine
  normalises the chart's value — "Rh+", "POS", "Rh(D) positive" → `positive`; "Rh-", "neg" →
  `negative`; "Du", "weakly positive" → `weak D` — before the gate compares it. The gate's
  comparands and the question's options are the four canonical words. A value that is not an
  Rh spelling at all ("O+", "pending") is left as written and so is flagged: nothing is
  guessed toward positive.
- **No Rh-positive step, no repeat antibody screen, no RhIG** (§0.9).
- **Rationale & source:** [21][22] → Step 1.3. Proved: `gate-proof.ts prenatal-handoffs`
  (negative, weak D, partial D and "indeterminate" → hand-off; positive → none; missing →
  asked once with all four options).

### Aspirin: `gate-on-aspirin`, `gate-aspirin-not-on-list`, `gate-aspirin-indicated`

- **`gate-on-aspirin`** — `step-1-6` → `step-1-25`. patient_attribute: `medications`
  `includes_code` `1191`, `system: "RXNORM_INGREDIENT"`, display `"aspirin"` (`LIFETIME`,
  active). **Ask** (an unidentifiable entry).
- **`gate-aspirin-not-on-list`** — `step-1-6` → `step-1-26`. compound **AND**:
  `not_includes_code` the same ingredient; GA `less_than` 28. **Ask** (GA, or an
  unidentifiable entry). The 28-week bound: `[DECISION — Josh 2026-10-04]` agreed.
- `[JOSH — CONFIRM]` (J41) **Any aspirin-containing product counts** — 325 mg, or a
  combination product — where versions 2–4 named the ingredient and the two 81 mg products.
  Step 1.25 and Guid-11 now say to confirm the dose is 81 mg daily.
- **`gate-aspirin-indicated`** — `step-1-26` → `step-1-7`. question, **BOOLEAN**. Prompt
  **verbatim** from GHTN's gate of the same id:
  > "Does this patient qualify for low-dose aspirin prophylaxis? Qualifies with ANY ONE
  > high-risk factor (prior preeclampsia, multifetal gestation, chronic hypertension,
  > pregestational type 1 or 2 diabetes, kidney disease, autoimmune disease such as SLE or
  > antiphospholipid syndrome); OR TWO OR MORE moderate-risk factors (nulliparity, BMI >30,
  > family history of preeclampsia in mother or sister, Black race, lower income, age 35 or
  > older, personal history factors, in vitro conception); OR, on its own, Black race or lower
  > income."
- **Rationale & source:** [17][18][19] → Step 1.6. Proved: `gate-proof.ts prenatal-meds`.

### Prenatal vitamin: on the list by ingredient, else ask `[DECISION — Josh 2026-10-04]`

- **`gate-on-prenatal-vitamin`** — `step-1-8` → `step-1-28`. patient_attribute: `medications`
  `includes_code` `4511`, `system: "RXNORM_INGREDIENT"`, display `"a folic acid supplement or
  prenatal vitamin"` (`LIFETIME`, active). **Ask** (an unidentifiable entry). Any product
  containing folic acid → "continue"; nothing asked.
- **`gate-prenatal-vitamin-not-on-list`** — `step-1-8` → `step-1-29`. patient_attribute: the
  same ingredient, `not_includes_code`. **Ask.** The exact complement of the gate above.
- **Version 5** `[DECISION — Josh 2026-10-04]`: "contains folic acid" replaces the ten-code
  list, so a prenatal multivitamin of any brand settles it. An entry that cannot be
  identified is asked about ("… Does it count as a folic acid supplement or prenatal
  vitamin?"): yes → continue; no → the remembered question below.
- **`gate-taking-prenatal-vitamin`** — `step-1-29` → `step-1-30`. patient_attribute:
  `patient.on_prenatal_vitamin` `equals` `true`. **Ask.**
- **`gate-not-taking-prenatal-vitamin`** — `step-1-29` → `step-1-27` (Med-1).
  patient_attribute: `patient.on_prenatal_vitamin` `equals` `false`. **Ask.**
  **`"on_declined": "traverse"`.**
- Both carry **`"remember_answer": { "scope": "PREGNANCY", "values": [true] }`** and the
  prompt "Already taking a prenatal vitamin? None is on the medication list." They read one
  datum, so a missing value raises **one** yes/no question.
- **Sticky answer** `[DECISION — Josh 2026-10-04]` ("effectively is pt on prenatal > yes"):
  - **yes** → Step 1.30, nothing started; the answer is stored for the patient and supplied
    at later encounters this pregnancy (by gestational age; with none, for 300 days), so she
    is not asked again;
  - **no** → the vitamin is recommended; "no" is not among the remembered values, so nothing
    is stored (and an earlier "yes" is withdrawn) and the question returns next visit;
  - **a recognised product on the medication list** still settles it with no question,
    whatever was remembered: the list is read first;
  - **"Not available"** `[DECISION — Josh 2026-10-04]`: unknown is treated like "no". The
    "no" gate carries **`"on_declined": "traverse"`**, so a decline opens it and the vitamin
    is recommended; the "yes" gate does not carry it and closes. Nothing is remembered, so
    the question returns next visit. The property acts only on a decline: while the question
    is unanswered the step is held, and a "yes" still closes it.
- The attribute is registered in `attribute-vocabulary.ts` (boolean). Storing and supplying
  the answer needs the database; `gate-proof.ts` shows what a session does when the attribute
  is supplied, which is what a later encounter is given.
- **Rationale & source:** [28][65][66] → Step 1.8. Proved: `gate-proof.ts prenatal-meds`
  (folic acid, Vitafol-One and a generic prenatal multivitamin on the list → nothing asked;
  none → asked once; yes, or supplied true as a remembered answer → not asked, not started;
  no → started; "Not available" → started, no blocker; on the list with a remembered "no" → the list wins).

### Vaccines: read from the medication list; the season from the calendar `[DECISION — Josh 2026-10-04]`

There is no immunization list in the patient context; a vaccine is read from `medications`
(by ingredient, §0.8). For each vaccine the list is in one of three states, and each state is its own
gate on the vaccine's host step:

| State of the medication list | Gate | Opens |
|---|---|---|
| A dose **dated** inside the window | neither gate | nothing — not recommended, nothing asked |
| No entry, or only doses dated outside the window | `gate-<vaccine>-due` | the step that recommends it |
| An entry with **no date**, and no dated dose in the window | `gate-<vaccine>-undated` | a step that asks; yes → "already given" step, no → a step that recommends it |

```
no dated dose   =  AND over every ingredient leaf of
                     count_in_window (count_comparison less_than, count_threshold 1, <window>)
no undated entry =  AND over every ingredient leaf of
                     OR( not_includes_code (LIFETIME),  count_in_window (at_least 1, window_days 36525) )
an undated entry =  OR  over every ingredient leaf of
                     AND( includes_code (LIFETIME),     count_in_window (less_than 1, window_days 36525) )

gate-<vaccine>-due      =  AND( [season,]  no dated dose,  no undated entry )
gate-<vaccine>-undated  =  AND( [season,]  no dated dose,  an undated entry )
```

A count selects on the day the entry **started**, so a dose from an earlier pregnancy or
season that is still listed with no end date does not count (§0.6 #3). A count never sees an
entry with no date, which is why "on the list, yet no dated entry" identifies one. All
`status: "any"`. The two gates are mutually exclusive.

| Vaccine | Host → recommend / ask | Ingredient (`RXNORM_INGREDIENT`) | Window ("a dated dose counts if…") | Season leaf | On unresolved |
|---|---|---|---|---|---|
| Influenza | `step-1-9` → `step-1-31` / `step-1-33` | `1657128` | `horizon: { "since": "09-01" }` — on or after the most recent September 1 | `encounter.date` `in_season` `from: "09-01"` `to: "03-31"` | ask |
| COVID-19 | `step-1-9` → `step-1-32` / `step-1-36` | `2468231`, `2606074` | `horizon: { "since": "09-01" }` | `in_season` `09-01` → `03-31` | ask |
| Tdap | `step-9-1` → `step-9-10` / `step-9-11` | `798302` | `horizon: "PREGNANCY"` | — | ask (GA) |
| RSV | `step-10-1` → `step-10-2` / `step-10-3` | `2636589` | `window_days: 36525` — ever | `encounter.date` `in_season` `from: "09-01"` `to: "03-01"` | ask |

**The question** `[DECISION — Josh 2026-10-04]`, on the "ask" step:

| Vaccine | Asked as | Prompt (exact) | yes → | no → | Remembered |
|---|---|---|---|---|---|
| Influenza | router `gate-influenza-vaccine-given` (question, BOOLEAN) | "Influenza vaccine given this season (since September 1)?" | `step-1-34` | `step-1-35` (Med-3b) | no |
| COVID-19 | router `gate-covid-vaccine-given` (question, BOOLEAN) | "COVID-19 vaccine given this season (since September 1)?" | `step-1-37` | `step-1-38` (Med-4b) | no |
| Tdap | `gate-tdap-given` / `gate-tdap-not-given`: `patient.tdap_given_this_pregnancy` `equals` `true` / `false`, ask; the "not given" gate has `on_declined: "traverse"` | "Tdap given this pregnancy?" | `step-9-12` | `step-9-13` (Med-5b) | `{ "scope": "PREGNANCY", "values": [true] }` |
| RSV | `gate-rsv-vaccine-given` / `gate-rsv-vaccine-not-given`: `patient.rsv_vaccine_ever_given` `equals` `true` / `false`, ask; the "not given" gate has `on_declined: "traverse"` | "Has she ever had the RSV vaccine?" | `step-10-4` | `step-10-5` (Med-7b) | `{ "scope": "PATIENT", "values": [true] }` |

- **Nothing is unanswerable**: yes or no, and each has its step. **No repeat within a
  session**: one question per vaccine (the Tdap and RSV pairs each read one datum), and its
  answer holds.
- **Tdap and RSV: a "yes" is remembered** `[DECISION — Josh 2026-10-04]` — Tdap for this
  pregnancy, RSV for the patient — and supplied at later encounters, so the question does not
  return while the entry stays undated. A "no" is not remembered. The remembered "yes" is
  read only on the "undated entry" step: with no entry on the list it changes nothing, and a
  dated dose settles the matter from the chart before it is consulted.
- **Influenza and COVID-19 are not remembered** (J36): there is no scope that ends with the
  season (§0.6 #12), so the question returns at each visit until the entry is dated. Each
  "yes" step says to add the date.
- **"Not available"** (Tdap, RSV) `[DECISION — Josh 2026-10-04]`: unknown is treated like
  "no" — the "not given" gate opens (`on_declined: "traverse"`), the vaccine is recommended,
  the "already given" side closes, nothing is remembered and the question returns next
  visit. The influenza and COVID-19 routers have no such answer; an unanswered router holds
  its steps.
- **Why two "recommend" steps per vaccine.** Two gates may not share a target (Rule 2), so
  the "no" answer leads to its own step with its own Medication node (Med-3b, -4b, -5b,
  -7b). The name, lane and text are identical to the first, so the plan shows one line
  whichever route was taken; the two are never in the plan together.
- **"This season" = since the most recent September 1** `[DECISION — Josh 2026-10-04]`. At a
  visit on 2026-10-15 a dose on 2026-09-05 counts and one on 2026-08-20 does not; at a visit
  on 2026-06-15 the window opened on 2025-09-01, so last October's dose still counts. The
  date is in the session's timezone, UTC today.
- **Influenza and COVID-19 season: September 1 to March 31, both days included, both
  vaccines** `[DECISION — Josh 2026-10-04]`. Out of season neither gate of either vaccine
  opens: nothing is recommended, and an undated entry is not asked about. In season the
  recommendation still needs "no dose dated since the most recent September 1".
- **RSV season: September 1 to March 1, both days included (ACOG)**
  `[DECISION — Josh 2026-10-04]`; CDC's season is September through January (conflict C3).
  Out of season neither RSV gate opens: nothing is offered and an undated entry is not asked
  about. The gestational-age window is Stage 10's gate (32 0/7–36 6/7).
- **RSV once in a lifetime**: a dated dose at any time closes both gates.
- **Simulator:** the composer sends medications undated, so a vaccine added there is asked
  about. Dated entries and other session dates are exercised in `gate-proof.ts
  prenatal-vaccines`.
- **Matched by ingredient** `[DECISION — Josh 2026-10-04]` ("match the vaccine, not the
  brand"): every leaf is `system: "RXNORM_INGREDIENT"` with a `display` naming the class
  ("an influenza vaccine"). No product list, nothing to add each season. "On unresolved" is
  `ask` on all eight gates: with these systems a gate is unresolved when an entry on the
  list cannot be identified, and it then asks about that entry by name.
- **One class-level consequence.** The undated-entry check is now per ingredient, not per
  product: with one **dated** and one **undated** entry of the same vaccine, "is one listed
  without a date" reads as no (a dated one exists), so the undated entry is not asked about
  and the dated one decides. In versions 3–4 the two had different product codes and the
  undated one was asked about.
- **An unidentifiable entry** is asked about for each vaccine whose answer it could change —
  including an old one, because the undated-entry check reads the whole list (J40).
- **Rationale & source:** [24][25][26][27] → Steps 1.9, 9.1, 10.1.

### `gate-bp-elevated` — BP at or above 140/90 today (D-25) `[DECISION — Josh 2026-10-04]`

- **Attached to:** `step-2-1` · **Branches to:** `step-2-2` (exclusively gated)
- **Type:** compound **AND** · **On unresolved: ask**
- **Conditions:** group **OR** (coded, `field: vitals`, no `system`, horizon **DAY**):
  `systolic_bp` `greater_than` **139.9**, display `"Systolic BP (mmHg)"`; `diastolic_bp`
  `greater_than` **89.9**, display `"Diastolic BP (mmHg)"` — the same two leaves as GHTN's
  gate; and `conditions` `not_includes_code` for each of `R03.0`, `O10.*`, `O11.*`, `O13.*`,
  `O14.*`, `O16.*` (`LIFETIME`, active).
- The hypertension-already-on-the-chart guard: agreed `[DECISION — Josh 2026-10-04]`.
- **Rationale & source:** [16] → Step 2.1. Proved: `gate-proof.ts prenatal-handoffs`.

### Early diabetes testing (D-6, D-7; chart-only; this pregnancy only since version 4)

- **`gate-overt-diabetes`** — `step-4-1` → `step-4-3`. patient_attribute: `labs` `4548-4`
  `greater_than` **6.49**, horizon **`PREGNANCY`**, display `"Hemoglobin A1c (%)"`. **On
  unresolved: default.**
  - `[ON-UNRESOLVED DEFAULT — gate-overt-diabetes]` Nobody is asked for an HbA1c (Josh,
    2026-10-04): a missing value means "not tested this pregnancy", and the eligibility
    question decides whether to order it.
  - `[WINDOW — gate-overt-diabetes: this pregnancy. Josh, 2026-10-04: only a value drawn this pregnancy is read for the early-testing gates]`
- **`gate-early-abnormal-glucose`** — `step-4-1` → `step-4-4`. compound **AND**: `4548-4`
  `greater_than` **5.89**; `4548-4` `less_than` **6.5**; both **`PREGNANCY`**. **Default.**
  - `[ON-UNRESOLVED DEFAULT — gate-early-abnormal-glucose]` As above.
  - `[WINDOW — gate-early-abnormal-glucose: this pregnancy, as gate-overt-diabetes]`
- **`gate-a1c-not-on-file`** — `step-4-1` → `step-4-6`. patient_attribute: `labs`
  `not_includes_code` `4548-4`, horizon **`PREGNANCY`**. Ask (GA only).
- **`gate-early-testing-indicated`** — `step-4-6` → `step-4-2`. question, **BOOLEAN**:
  > "Does this patient meet criteria for early testing for undiagnosed diabetes? Criteria: BMI
  > 25 or higher (23 or higher if Asian ancestry) PLUS at least one of: first-degree relative
  > with diabetes; high-risk race, ethnicity or ancestry; history of cardiovascular disease;
  > hypertension; HDL below 35 or triglycerides above 250; polycystic ovary syndrome; physical
  > inactivity; other insulin-resistance conditions (e.g., acanthosis nigricans). OR,
  > regardless of BMI: prediabetes (A1C 5.7% or higher) or gestational diabetes in a prior
  > pregnancy. (ADA also advises considering early testing for all patients.)"
- **States:** an HbA1c drawn this pregnancy → read, no question, no order, whatever the
  eligibility answer would be. None this pregnancy — including one drawn before it, which is
  not read — → eligibility asked; yes → HbA1c ordered, **no result question**, nothing
  blocks, read at the next visit.
- `[GAP]` The ACOG CPU 2024 risk-factor table is paywalled; the prompt uses ADA Table 2.5.
- **Rationale & source:** [52][55][56] → Step 4.1. Proved: `gate-proof.ts prenatal-gdm` (an
  HbA1c of 6.8 before the pregnancy → not read; the same drawn this pregnancy → overt
  diabetes).

### `gate-cbc-repeat-due` — 24–28-week CBC `[DECISION — Josh 2026-10-04]`

- **Attached to:** `step-6-1` · **Branches to:** `step-6-5` · compound **AND**, **ask** (GA):
  GA `greater_or_equal` 24; `labs` `not_includes_code` `718-7`, horizon
  **`{ "since_gestational_week": 24 }`**.
- The window opens at the LMP date plus 24 weeks. The gestational-age leaf is required beside
  it: before week 24 the window is empty, so "none drawn" would be true (the spec's rule for
  a "still owed" leaf). Stage 6 is behind the same bound, so here it is a second guard.
- **Rationale & source:** [1][2] → Step 6.1. Proved: `gate-proof.ts prenatal-handoffs` (26
  weeks: CBC at 10 weeks only → ordered; at 25 weeks → not; the day before 24 0/7 → ordered).

### Gestational diabetes from 24 weeks: read the chart, ask nothing `[DECISION — Josh 2026-10-04]`

Five gates on Step 6.2, each with "no diabetes code on the chart" (`conditions`
`not_includes_code` `O24.*`, `LIFETIME`, active) except the first.

**Which window each leaf reads** `[DECISION — Josh 2026-10-04]`: only a screen drawn at or
after 24 0/7 weeks counts as the 24–28-week screen, so the negative conclusion, "nothing on
file", the 75-g values and the 100-g values all read `{ "since_gestational_week": 24 }`
(written W24 below). The one leaf that reads the whole pregnancy (`PREGNANCY`) is "a 50-g of
140 or higher": a positive early screen goes straight to the diagnostic test (PB 180).

| Chart state | Gate | Opens | Asked |
|---|---|---|---|
| A diabetes code (O24.-) on the chart | `gate-diabetes-on-file` | Step 6.4 — no screening | nothing |
| 50-g <140, or all three 75-g values below threshold — drawn at or after 24 0/7 weeks | `gate-gdm-screen-negative` | Step 6.3 — complete | nothing |
| No 50-g and no 75-g value since 24 0/7 weeks, and no earlier 50-g ≥140 | `gate-gdm-nothing-on-file` | Step 6.6 — the strategy question → Step 6.7 (order the 50-g) or Step 6.8 (order the 75-g) | the strategy, once |
| 50-g ≥140, at any time this pregnancy | `gate-gct-positive` | Step 6.9 — the 100-g test | nothing |
| Any 75-g value at or above threshold, drawn at or after 24 0/7 weeks | `gate-75g-diagnostic` | Step 6.13 — diagnose GDM | nothing |

And on Step 6.9, behind the positive 50-g:

| Chart state | Gate | Opens | Asked |
|---|---|---|---|
| No 100-g value since 24 0/7 weeks | `gate-ogtt100-not-on-file` | Step 6.10 — order the 100-g test; O99.810 | nothing |
| Two or more of the four values at or above threshold | `gate-100g-diagnostic` | Step 6.11 — diagnose GDM | nothing |
| Fewer than two | `gate-100g-negative` | Step 6.12 — complete | nothing |

| Visit | What happens |
|---|---|
| Nothing on file at 28 weeks | Strategy asked once → the chosen test is ordered → **no result question**, no blocker, plan generates |
| Next visit, still nothing on file (the test was not done, or is not on the chart) | The strategy is asked again — the chart cannot say which test was ordered |
| 50-g 118 on file, drawn at or after 24 weeks | Screening complete; nothing asked |
| **50-g 118 on file, drawn at 16 weeks** | **Not the screen: the strategy is asked and the test ordered, as if nothing were on file** |
| 50-g 155 on file, drawn at 16 weeks | The 100-g test is ordered at 24 weeks or later; no strategy question |
| 50-g 152 on file | The 100-g test is ordered; **no strategy question, no result question** |
| 50-g 152 and the four 100-g values on file | Two or more abnormal → diagnose GDM; otherwise complete. Nothing asked, and nothing recurs at later visits |
| O24.410 on the chart | No screening, nothing asked |

All of it is proved in `gate-proof.ts prenatal-gdm`, in both edge orders.

- **`gate-diabetes-on-file`** — `step-6-2` → `step-6-4`. patient_attribute: `conditions`
  `includes_code` `O24.*` (ICD-10, `LIFETIME`, active). Default.
- **`gate-gdm-screen-negative`** — `step-6-2` → `step-6-3`. compound **AND**: no `O24.*`;
  group **OR**: `1504-0` `less_than` **139.9** (W24); group **AND**: `1552-9` `less_than`
  **91.9**, `1507-3` `less_than` **179.9**, `1518-0` `less_than` **152.9** (all W24).
  **Default.**
  - `[ON-UNRESOLVED DEFAULT — gate-gdm-screen-negative]` A missing value means "not
    screened"; a result is never asked for (Josh, 2026-10-04).
  - `[WINDOW — gate-gdm-screen-negative: since 24 0/7 weeks. Only a screen drawn at or after 24 weeks is the 24-28-week screen (Josh, 2026-10-04)]`
- **`gate-gdm-nothing-on-file`** — `step-6-2` → `step-6-6`. compound **AND**, ask (GA only):
  no `O24.*`; GA `greater_or_equal` 24 (the required guard beside a "still owed" week
  window); `not_includes_code` `1504-0`, `1552-9`, `1507-3`, `1518-0` (W24); and group **OR**
  "no 50-g of 140 or higher earlier this pregnancy": `not_includes_code` `1504-0`
  (`PREGNANCY`), `1504-0` `less_than` **139.9** (`PREGNANCY`) — the exact complement of
  `gate-gct-positive`, so an early positive screen goes to the 100-g test and not here.
  - `[WINDOW — gate-gdm-nothing-on-file: this pregnancy, for the "no earlier positive 50-g" leaf; a 50-g from an earlier pregnancy is ignored]`
- **`gate-gdm-strategy`** — attached to `step-6-6`. **Router**, question, **SELECT** (D-5):

  | Option (exact string) | Target |
  |---|---|
  | `"Two-step: 50-g 1-hour challenge, then a 100-g 3-hour test if it is 140 mg/dL or higher"` | `step-6-7` |
  | `"One-step: 75-g 2-hour test"` | `step-6-8` |

  Prompt:
  > "No gestational diabetes screening result is on file. Which test: two-step (50-g 1-hour
  > challenge, then a 100-g 3-hour test if it is 140 mg/dL or higher) or one-step (75-g 2-hour
  > test)?"
- **`gate-gct-positive`** — `step-6-2` → `step-6-9` `[DECISION D-3 — Josh 2026-09-24]`.
  compound **AND**: no `O24.*`; `1504-0` `greater_than` **139.9**, display `"Glucose 1 h post
  50 g glucose (mg/dL)"`. **Default.**
  - `[ON-UNRESOLVED DEFAULT — gate-gct-positive]` As `gate-gdm-screen-negative`.
  - `[WINDOW — gate-gct-positive: this pregnancy — a positive 50-g at any gestational age leads to the diagnostic test]`
  - `[GAP]` A 50-g value ≥200 treated as diagnostic: no accessible US source. Not built.
- **`gate-75g-diagnostic`** — `step-6-2` → `step-6-13`. compound **AND**, **ask**: no
  `O24.*`; group **OR** `includes_code` `1552-9` / `1507-3` / `1518-0` (at least one 75-g
  value on file); group **OR** `1552-9` `greater_than` **91.9**, `1507-3` `greater_than`
  **179.9**, `1518-0` `greater_than` **152.9**.
  - The "at least one on file" group is why this gate never asks at the ordering visit: with
    none on file it is a definite no. With part of the test on file it asks for the missing
    values — a gap in a test the chart shows was done.
  - All leaves read W24: the one-step criteria are not applied to a test before 24 weeks.
  - `[WINDOW — gate-75g-diagnostic: since 24 0/7 weeks]`
- **`gate-ogtt100-not-on-file`** — `step-6-9` → `step-6-10`. compound **AND**: GA
  `greater_or_equal` 24; `not_includes_code` `1549-5`, `1501-6`, `1514-9`, `1530-5` (W24).
  Ask (GA only). A 100-g test done before 24 weeks with an early positive screen does not
  settle it: the diagnostic test is ordered at 24–28 weeks (PB 180).
- **`gate-100g-diagnostic`** — `step-6-9` → `step-6-11` `[DECISION D-4 — Josh 2026-09-24]`,
  built from the chart `[DECISION — Josh 2026-10-04]`. compound **AND**, **ask**:
  - group **OR** `includes_code` over the four LOINCs (at least one 100-g value on file);
  - group **OR** of six groups, one per pair, each an **AND** of two `greater_than` leaves:

    | Pair | Leaves |
    |---|---|
    | fasting and 1-hour | `1549-5` > **94.9** AND `1501-6` > **179.9** |
    | fasting and 2-hour | `1549-5` > 94.9 AND `1514-9` > **154.9** |
    | fasting and 3-hour | `1549-5` > 94.9 AND `1530-5` > **139.9** |
    | 1-hour and 2-hour | `1501-6` > 179.9 AND `1514-9` > 154.9 |
    | 1-hour and 3-hour | `1501-6` > 179.9 AND `1530-5` > 139.9 |
    | 2-hour and 3-hour | `1514-9` > 154.9 AND `1530-5` > 139.9 |

  "Two or more of four at or above threshold" is exactly "some pair is both at or above".
  Each group carries a `display` ("Fasting and 1-hour both at or above threshold").
  - All leaves read W24.
  - `[WINDOW — gate-100g-diagnostic: since 24 0/7 weeks]`
- **`gate-100g-negative`** — `step-6-9` → `step-6-12`. compound **AND**, **ask**: the same
  "at least one on file" group; then six groups, one per pair, each an **OR** of two
  `less_than` leaves on the same numbers ("fasting or 1-hour below threshold", …). It is the
  leaf-by-leaf De Morgan complement of the gate above: "fewer than two abnormal" is "in every
  pair, at least one is normal".
  - `[WINDOW — gate-100g-negative: since 24 0/7 weeks]`
  - **Why build it (V2-12).** With chart-only reading the question could only be answered by
    someone holding the result, and nothing recorded a "does not meet" answer, so it recurred
    at every visit to delivery. The four values on the chart settle it once.
  - **Proved**: all six pairs → diagnose; each single abnormal value → complete; all four
    abnormal → diagnose; exactly one of the two gates is open whenever the four values are on
    file. A partly entered test asks for the missing value and re-orders nothing.
  - 12 leaves per gate; the canvas shows the six pair names, not the leaves.
- **What is still asked, and what recurs across visits:** only the strategy, and only while
  no screening result is on file. Nothing recurs once any result is on the chart.
- **A screen drawn before 24 0/7 weeks** `[DECISION — Josh 2026-10-04]`: negative → not the
  screen, screening stays open; positive → the 100-g test. Step 6.3's old instruction ("if
  the result was drawn before 24 weeks, order the screen") is removed as redundant. Proved
  to the day: a 50-g of 118 the day before week 24 does not count; on its first day it does.
- "≥140" is `greater_than 139.9` and "<140" is `less_than 139.9`: complements for every value
  except exactly 139.9, which a whole-number mg/dL result never takes. Likewise the others.
- **Rationale & source:** [53][54][55][57] → Steps 6.2, 6.6, 6.9.

### Third-trimester rescreen gates (all attached to `step-9-5`) `[DECISION — Josh 2026-10-04]`

compound **AND**, **ask** (GA): GA `greater_or_equal` **28**; `labs` `not_includes_code` for
each code, horizon **`{ "since_gestational_week": 28 }`**.

| Gate | Absent since 28 0/7 weeks | Branches to |
|---|---|---|
| `gate-syphilis-rescreen-due` | 20507-0 AND 22587-0 | `step-9-7` |
| `gate-hiv-rescreen-due` | 56888-1 | `step-9-8` |
| `gate-ct-gc-rescreen-due` | 21613-5 AND 21416-3 | `step-9-9` |

- **Why week 28 and not 27** `[JOSH — CONFIRM]` (J37). Stage 9 opens at 27 weeks because the
  Tdap window does. The rescreens are "third trimester", which begins at 28 0/7 (§0.3), so
  they are due from 28 weeks and a test drawn at 27 weeks does not count. Versions 1–3 said
  "since about 27 weeks". The gestational-age leaf is what keeps them closed at 27 weeks.
- HIV and chlamydia/gonorrhea rescreening are risk-based and shown for everyone
  (`[DECISION — Josh 2026-10-04]`).
- **Source:** [8][10][11][15] → Step 9.5. Proved: `gate-proof.ts prenatal-handoffs` (20 and
  27 weeks: none ordered; 28 weeks: ordered; at 32 weeks a 10-week test does not count, a
  29-week test does).

### `gate-gbs-culture-due`

- **Attached to:** `step-11-1` · **Branches to:** `step-11-4` · compound **AND**, **ask**
  (GA): GA `greater_or_equal` 36; `conditions` `not_includes_code` `O99.820`; group **OR**:
  - group **AND** "none drawn since 36 0/7 weeks": `not_includes_code` `72607-5`, `91875-5`,
    horizon `{ "since_gestational_week": 36 }`;
  - group **AND** "none in the last 5 weeks": the same two codes, horizon `{ "days": 35 }`.
- A result counts only if it was drawn **at or after 36 0/7 weeks and is still valid**. The
  35 days is not a gestational-age approximation: it is the result's stated validity (CO 797:
  valid 5 weeks), so it stays a day count.
- `[JOSH — CONFIRM]` (J39) Version 3 counted any culture from the last 35 days, so one drawn
  at 34–35 weeks closed the order. It no longer does: the guideline's window opens at 36 0/7.
- **Rationale & source:** [20] → Step 11.1. Proved: `gate-proof.ts prenatal-meds`.

## 5. Medications

Ten Medication nodes for six medications (unchanged in version 5; what changed is how the
medication list is read — by ingredient, §4b): each of the four vaccines has a second node with
the same name, lane and text (Med-3b, Med-4b, Med-5b, Med-7b) on the step reached by answering
"no" to its undated-entry question — two gates may not share a target, and the two nodes are
never in the plan together. No `ESCALATES_TO`. **Every one is checked against the medication list
before it is recommended** (§4b), by ingredient: the prenatal vitamin against folic acid,
aspirin against aspirin, and the four vaccines against their vaccine ingredient as dated
entries `[DECISION — Josh 2026-10-04]`.

- **Med-1 — Prenatal vitamin with folic acid 0.4–0.8 mg** (on Step 1.27, reached only when
  none is on the medication list and the patient says she is not taking one)
  - **Role:** first_line · **clinical role:** `prenatal-vitamin-supplementation`
  - **Dose:** one tablet PO daily (folic acid 400–800 mcg, iron, iodine 150 mcg), from at
    least 1 month before conception through pregnancy.
  - **Notes:** do not exceed the labelled dose (vitamin A). 4 mg folic acid as a separate
    supplement after a prior NTD-affected pregnancy.
  - **Code:** RxNorm folic acid IN **4511**. **Source:** [28][65][66][67]
- **Med-2 — Aspirin 81 mg** (on Step 1.7, behind `gate-aspirin-not-on-list` and
  `gate-aspirin-indicated`)
  - **Role:** first_line · **clinical role:** `preeclampsia-prophylaxis` — same name and lane
    as GHTN `med-1`, so the merge shows one.
  - **Dose:** 81 mg PO once daily, from 12–28 weeks until delivery.
  - **Codes:** RxNorm 1191 (IN), 243670 (81 mg tablet). **Source:** [17][18][19][64]
- **Med-3 / Med-3b — Influenza vaccine, inactivated or recombinant** (on Step 1.31, behind
  `gate-influenza-vaccine-due`; and on Step 1.35): first_line, `influenza-immunization`; one dose IM per season;
  CPT 90656, 90673. [24][25][27]
- **Med-4 — COVID-19 vaccine (current-season formulation)** (on Step 1.32, behind `gate-covid-vaccine-due`; Med-4b on Step 1.38) `[DECISION D-26 —
  Josh 2026-09-24]`
  - **Role:** first_line (per ACOG) · **clinical role:** `covid-immunization`
  - **Dose:** one dose IM of the current-season product, any trimester. `[GAP]` The
    product-specific dose was not fetched.
  - **Ruling (D-26):** recommend per ACOG, **with shared decision-making and the discussion
    documented**, and state CDC's current position in the node's text. There is no separate
    vaccine Guidance node; the Med-4 notes below are that text.
  - **Notes (node text):** "Recommended in any trimester per ACOG (Committee Statement No. 26, 2026:
    all pregnant and lactating individuals should receive an updated COVID-19 vaccine). Offer
    it through shared decision-making and document the discussion. CDC's current position
    differs: the CDC adult immunization schedule (Jul 2 2025) gives no guidance for pregnancy,
    and CDC's interim clinical considerations (updated Sep 23 2026) advise a review of the
    risks and benefits."
  - **Sources behind the notes (the conflict):**
    - ACOG CS 26 (Feb 2026): "All pregnant and lactating individuals should receive an updated
      COVID-19 vaccine… any trimester."
    - CDC adult schedule (Jul 2 2025), Table 2: pregnancy cell "No Guidance/Not Applicable".
    - CDC interim considerations (Sep 2026) urge a review of risks and benefits.
  - **Code:** `[GAP]` 2026–27 product CPTs are not in the CDC crosswalk.
  - **Source:** [24][25]
- **Med-5 / Med-5b — Tdap vaccine** (on Step 9.10, behind `gate-tdap-due`; and on Step 9.13): first_line,
  `pertussis-immunization`; one dose IM each pregnancy, early in the 27–36-week window; CPT
  90715. [24][25]
- **Med-7 / Med-7b — RSV vaccine, RSVpreF (Abrysvo)** (on Step 10.2, behind
  `gate-rsv-vaccine-due`; and on Step 10.5): first_line, `rsv-maternal-immunization`; one dose
  IM at 32 0/7–36 6/7 weeks, in season (September 1 to March 1), once in a lifetime; CPT 90678. [25][26]

**Removed in version 1:** Med-6 Rho(D) immune globulin `[DECISION — Josh 2026-10-04]` (§0.9).

**Not given nodes** (text only): folic acid 4 mg; hepatitis B vaccine; MMR and varicella
(postpartum only); doxylamine–pyridoxine (out of scope).

## 6. Lab tests

25 LabTest nodes. A lab on several hosts is one node per host. Each name says why this
pathway orders it, because the merge folds same-code labs from co-matched pathways into one
line and lists the other names as "Ordered for: …" (§0.4).

| Lab | Host step | Name (as emitted) | LOINC | CPT | Source |
|---|---|---|---|---|---|
| Lab-1 | 1.10 | CBC with indices — first prenatal panel (no hemoglobin this pregnancy) | 58410-2 | 85025 | [1][2] |
| Lab-2 | 1.11 | ABO and Rh(D) type — first prenatal panel (no blood type on file) | 882-1 | 86900, 86901 | [2][22] |
| Lab-3 | 1.12 | Red-cell antibody screen — first prenatal panel (none this pregnancy) | 890-4 | 86850 | [2][22] |
| Lab-4 | 1.13 | Rubella IgG — first prenatal panel (none this pregnancy) | 25514-1 | 86762 | [2] |
| Lab-5 | 1.14 | Syphilis serology, treponemal and nontreponemal — first prenatal panel (none this pregnancy) | 20507-0; 22587-0 | 86592, 86780 | [7][8] |
| Lab-6 | 1.15 | Hepatitis B surface antigen — every pregnancy (none this pregnancy) | 5196-1 | 87340 | [9] |
| Lab-7 | 1.16 | Hepatitis B surface antibody and total core antibody — triple panel (never documented) | 16935-9; 16933-4 | 86706, 86704 | [9] |
| Lab-8 | 1.17 | HIV-1/2 antigen and antibody — first prenatal panel (none this pregnancy) | 56888-1 | 87389 | [10][11] |
| Lab-9 | 1.18 | Hepatitis C antibody with reflex RNA — every pregnancy (none this pregnancy) | 13955-0 | 86803 | [12] |
| Lab-10 | 1.19 | Urine culture — screening for asymptomatic bacteriuria (none this pregnancy) | 630-4; 19090-0 | 87086 | [13][14] |
| Lab-11 | 1.20 | Chlamydia and gonorrhea NAAT — if under 25 or at risk (none this pregnancy) | 21613-5; 21416-3 | 87491, 87591 | [15] |
| Lab-12 | 1.21 | Hemoglobinopathy evaluation — once per lifetime (no prior result) | 43113-0 | 83020 | [6] |
| Lab-13 | 1.22 | Varicella IgG — if no history of disease or vaccination (none this pregnancy) | 19162-7 | 86787 | [2] |
| Lab-14 | 1.5 | Cell-free DNA aneuploidy screen — offered to all | — | 81420 | [4] |
| Lab-15 | 3.2 | First-trimester serum screen (PAPP-A, hCG) — if serum screening is chosen | — | 81508 | [4] |
| Lab-16 | 5.2 | Quad screen — if serum screening is chosen and no first-trimester screen was done | — | 81511 | [4] |
| Lab-17 | 4.2 | Hemoglobin A1c — early testing for undiagnosed diabetes (none this pregnancy) | 4548-4 | 83036 | [55] |
| Lab-19 | 6.5 | CBC with indices — 24-28-week anemia rescreen (no hemoglobin since 24 weeks) | 58410-2 | 85025 | [1][2] |
| Lab-20 | 6.7 | 50-g 1-hour glucose challenge — gestational diabetes screen, two-step (no screen since 24 weeks) | 1504-0 | 82950 | [53][55][57] |
| Lab-21 | 6.10 | 100-g 3-hour glucose tolerance test — diagnostic test after a positive 50-g challenge (no result since 24 weeks) | 50608-9; 1549-5, 1501-6, 1514-9, 1530-5 | 82951, 82952 | [53][55][57] |
| Lab-22 | 6.8 | 75-g 2-hour glucose tolerance test — gestational diabetes screen, one-step (no screen since 24 weeks) | 1552-9; 1507-3, 1518-0 | 82951 | [55][57] |
| Lab-24 | 9.7 | Syphilis serology — third-trimester rescreen, every patient (none since 28 weeks) | 20507-0; 22587-0 | 86592, 86780 | [7][8] |
| Lab-25 | 9.8 | HIV-1/2 antigen and antibody — third-trimester rescreen if at risk (none since 28 weeks) | 56888-1 | 87389 | [10][11] |
| Lab-26 | 9.9 | Chlamydia and gonorrhea NAAT — third-trimester rescreen if under 25 or at risk (none since 28 weeks) | 21613-5; 21416-3 | 87491, 87591 | [15] |
| Lab-27 | 11.4 | Group B streptococcus vaginal-rectal culture — 36-37-week screen (no valid result on file) | 72607-5 | 87081 | [20] |

- **Removed in version 1:** Lab-18 fasting plasma glucose (D-6: HbA1c only) and Lab-23, the
  24–28-week repeat antibody screen for Rh-negative patients (§0.9; confirmed by Josh on
  review). Their ids are left unused.
- The 100-g values (1549-5, 1501-6, 1514-9, 1530-5) are now read by gates, not only ordered.
- Lab-14, -15 and -16 have no verified result LOINC, so the chart is not checked for them;
  they are patient-choice tests and say so in their names.

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
| Proc-3 | Step 11.2 | External cephalic version — for breech presentation | 59412 | — | [48] |

## 9. Guidance

28 Guidance nodes. Each was checked against the spec's "guidance says what the order lines
cannot": none names an order its own step carries, none repeats another node, and each topic
is the point in a few words. Two changes for that rule:
- **Guid-3** no longer opens with "take a daily prenatal vitamin" (that is Med-1's line).
- **Guid-A2** no longer names the A1C test (Lab-17 is on the same step); it says why testing
  is early and that it does not replace the 24–28-week test.

Unchanged from the 2026-09-24 draft:

- **Guid-1 — topic `Urgent maternal warning signs`** (on Step 1.8), category safety-netting.
  - **Instructions (exact node text; byte-identical to GHTN v3 `guid-1`):**
    > "Review the urgent maternal warning signs (CDC Hear Her / AIM) with the patient and give
    > her the handout; she should seek care immediately for any of them. The warning signs
    > apply during pregnancy and for a year after birth. Source:
    > https://www.cdc.gov/hearher/maternal-warning-signs/index.html"
  - **`[DECISION D-28 — Josh 2026-09-24]` Reference the wording; do not include the actual
    text.**
    - The CDC page states the list "was developed by the Alliance for Innovation on Maternal
      Health". AIM's own 2026 card is all-rights-reserved and **prohibits use as part of an
      LLM to generate text**.
    - So the node carries **no list items**: not the CDC list, not the AIM card, not a
      paraphrase of either. The patient gets the published handout, whole.
    - This replaces the draft's word-for-word CDC reproduction (the D-28 default), which is
      removed from this brief.
  - **Co-match:** GHTN `guid-1` uses this identical text under the same topic, so the merge
    shows one block (§0.4).
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
- **Guid-A1 — topic `GDM screening: what the glucose test involves`** (on Step 6.6), education.
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
- **Guid-A4 — topic `GDM diagnosis: what happens next`** (on Step 6.11; duplicate node Guid-A4b,
  same topic and text, on Step 6.13), education.
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

Edited or new on 2026-10-04 (exact node text; hand-off wording is "on this encounter" since
version 2):

- **Guid-3 — `Eating well and food safety in pregnancy`** (Step 1.8), lifestyle: "To avoid
  listeria, a germ that can harm your baby: skip raw (unpasteurized) milk and cheeses made
  from it; heat deli meats and hot dogs until steaming hot; avoid refrigerated smoked fish,
  premade deli salads and raw sprouts. Eat 2 to 3 servings a week of low-mercury fish such as
  salmon, shrimp, cod or canned light tuna. Do not eat shark, swordfish, king mackerel,
  marlin, orange roughy, Gulf tilefish or bigeye tuna. Keep caffeine under 200 mg a day."
  [39][40]
- **Guid-A2 — `Why diabetes is checked early for some patients`** (Step 4.2), education: "Some
  patients have type 2 diabetes before pregnancy without knowing it. With risk factors,
  checking at the first visits means diabetes can be treated from the start. A normal early
  result does not replace the standard glucose test at 24-28 weeks." [55][56]
- **Guid-10 — `Already taking a prenatal vitamin: check what it contains`** (Step 1.28),
  education: "A folic acid supplement or prenatal vitamin is already on the medication list,
  so none is started. Confirm it supplies 400-800 mcg of folic acid a day, with iron and
  iodine, and that the labelled dose is not exceeded." [28][65][66][67]
- **Guid-19 — `Prenatal vitamin reported but not listed`** (Step 1.30), education: "She is
  taking a prenatal vitamin that is not on the medication list, so none is started. The
  answer is remembered for this pregnancy. Add the vitamin to the medication list, and
  confirm it supplies 400-800 mcg of folic acid a day, with iron and iodine."
  [28][65][66][67]
- **Guid-11 — `Already on low-dose aspirin: continue it`** (Step 1.25), education: "Aspirin is
  already on the medication list. Continue 81 mg daily until delivery; do not add a second
  prescription. It is exempt from the advice to avoid NSAIDs from 20 weeks." [17][18][19][64]
- **Guid-12 — `Low hemoglobin: what happens next`** (Step 1.23), education: "The hemoglobin
  drawn this pregnancy is below the screening threshold for this trimester (11.0 g/dL in the
  first and third, 10.5 g/dL in the second). Add anemia complicating pregnancy as a diagnosis
  on this encounter so the anemia pathway can guide the workup and treatment. Routine
  prenatal care continues unchanged." [1][2]
- **Guid-13 — `Rh(D) not clearly positive: what routine care does not cover`** (Step 1.24),
  education: "The Rh(D) type is negative, weak D, partial D or otherwise not clearly positive.
  This pathway recommends no Rh immune globulin and no repeat antibody screen. Add Z67.91
  (blood type, Rh negative) to this encounter, for weak D and partial D as well as for Rh
  negative, and manage Rh prophylaxis under the Rh-negative plan of care." [21][22]
- **Guid-14 — `Elevated blood pressure: what happens next`** (Step 2.2), education: "Today's
  blood pressure is 140/90 or higher. Repeat it. If it stays elevated, add the diagnosis to
  this encounter (R03.0 until confirmed; gestational hypertension or preeclampsia once
  confirmed) so the hypertension in pregnancy pathway can guide the evaluation. Urine protein
  is tested only when preeclampsia is suspected, not routinely." [16]
- **Guid-15 — `A1c in the diabetes range: what happens next`** (Step 4.3), education: "The
  hemoglobin A1c is 6.5% or higher, which means diabetes that was present before pregnancy.
  Confirm it with a second test unless the result is unequivocal, then add pre-existing
  diabetes in pregnancy as a diagnosis on this encounter. No gestational diabetes screening
  is needed once it is on the chart." [55]
- **Guid-16 — `Diabetes on the chart: screening is not repeated`** (Step 6.4), education:
  "Diabetes in pregnancy is already on the chart, so no glucose screening test is ordered.
  Glucose management follows the diabetes plan of care; routine prenatal care continues
  unchanged." [55][56]
- **Guid-17 — `What a negative glucose screen settles`** (Step 6.3), education: "The glucose
  screening result on file is negative, so gestational diabetes screening is complete and is
  not repeated. Retest only on clinical suspicion: new glycosuria, a fetus measuring large,
  or excess amniotic fluid." [53][55]
- **Guid-18 — `A positive challenge with a normal 3-hour test`** (Step 6.12), education: "The
  3-hour test did not meet the criteria for gestational diabetes, so no diabetes diagnosis is
  made and screening is not repeated unless there is a new clinical reason." [53][55]

- **Guid-20 — `Influenza vaccine: add the date it was given`** (Step 1.34), education: "The
  influenza vaccine was given this season, so it is not repeated. Add the date to the entry
  on the medication list so the chart shows it and the question is not asked again."
  [24][25][27]
- **Guid-21 — `COVID-19 vaccine: add the date it was given`** (Step 1.37), education: "The
  COVID-19 vaccine was given this season, so it is not offered again. Add the date to the
  entry on the medication list so the chart shows it and the question is not asked again."
  [24][25]
- **Guid-22 — `Tdap: add the date it was given`** (Step 9.12), education: "Tdap was given this
  pregnancy, so it is not repeated. The answer is remembered for this pregnancy. Add the date to the entry on the medication list so the
  chart shows it." [24][25]
- **Guid-23 — `RSV vaccine: already given`** (Step 10.4), education: "She has had the RSV
  vaccine, so it is not repeated in this pregnancy; plan the infant monoclonal antibody. The
  answer is remembered. Add the date to the entry on the medication list so the chart shows
  it." [24][25][26]

Wording of Guid-10 to Guid-23 (J18, **review in place**: Josh reviews it in the simulator;
not blocking): they are the builder's sentences
for the hand-off, "already on it" and "already given" steps, written from the brief's own
step text.

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
| Sched-1 | Step 2.4 | "Tailored: intake plus about 8 visits (average risk) or about 13 (greater than average)" | Traditional reference: every 4 weeks to 28, every 2 weeks to 36, then weekly. The CC No. 8 sample puts in-person visits at 10, 16, 28, 36 and 39 weeks; any modality at 22, 32 and 38; anatomy US at 20. | [1][2] |
| Sched-2 | Step 1.7 | "Start at 12-28 weeks (optimally before 16), then daily until delivery" | Low-dose aspirin | [18][19] |
| Sched-3 | Step 4.5 | "24 0/7-28 6/7 weeks" | Universal GDM screening window | [55][57] |
| Sched-4, Sched-4b | Step 9.10, Step 9.13 | "27-36 weeks, early in the window, every pregnancy" | Tdap | [24][25] |
| Sched-6, Sched-6b | Step 10.2, Step 10.5 | "32 0/7-36 6/7 weeks, in season (September 1 to March 1)" | Maternal RSV vaccine. ACOG September 1 to March 1; CDC September through January | [25][26] |
| Sched-7 | Step 11.4 | "36 0/7-37 6/7 weeks" | GBS culture; valid 5 weeks | [20] |
| Sched-8 | Step 12.1 | "Once or twice weekly from 41 0/7 weeks until delivery" | Late-term surveillance | [46] |

Sched-5 (RhIG) was removed in version 1 (§0.9).

## 12. Prerequisites (REQUIRES)

One pair, because a prerequisite with no `satisfaction_check` always surfaces as catch-up
(§0.6 #6):

- `step-5-1` REQUIRES `step-1-1`: the anatomy survey dates a pregnancy not yet dated [3].

## 13. Code entries

One CodeEntry node per code, shared by its hosts (CodeEntry nodes are exempt from the
one-node-per-host rule). 77 nodes.

**Condition codes on steps:**

| Code | System | Description | Attached to |
|---|---|---|---|
| Z34.00 | ICD-10 | Supervision of normal first pregnancy, unspecified trimester | Step 1.1 |
| O99.01 | ICD-10 | Anemia complicating pregnancy (O99.011 / .012 / .013 by trimester) | Step 1.23 |
| Z67.91 | ICD-10 | Unspecified blood type, Rh negative | Step 1.24 |
| R03.0 | ICD-10 | Elevated blood-pressure reading, without diagnosis of hypertension | Step 2.2 |
| O24.111, O24.112, O24.113, O24.119 | ICD-10 | Pre-existing type 2 diabetes mellitus, in pregnancy | Step 4.3 |
| O99.810 | ICD-10 | Abnormal glucose complicating pregnancy | Step 6.10 |
| O24.410 | ICD-10 | Gestational diabetes mellitus in pregnancy, diet controlled | Step 6.11, Step 6.13 |

**Lab codes:** each LabTest carries the LOINC and CPT codes in its §6 row.
**Imaging:** 76801, 76817 (Img-1); 76813 (Img-2); 76805 (Img-3). **Procedures:** 59025
(Proc-1); 76818 (Proc-2); 59412 (Proc-3).

**Medication codes:** RXNORM 4511 (Med-1); RXNORM 1191, 243670 (Med-2); CPT 90656, 90673
(Med-3, Med-3b); CPT 90715 (Med-5, Med-5b); CPT 90678 (Med-7, Med-7b).

**Codes read by gates but not emitted as CodeEntry nodes:** the six ingredient RxCUIs of
§0.8 (`1657128`, `2468231`, `2606074`, `798302`, `2636589`, `4511`, `1191` — seven with both
COVID-19 ingredients); ICD-10 Z67.11 / .21 / .31 / .41, O24.\*, O99.01.\*, D50.\*, O10–O16,
O99.820; LOINC 718-7, 5195-3, 91875-5. The 64 product codes of versions 2–4 are read by no
gate; they stay in `scripts/seed-prenatal-reference-codes.sql` for the simulator's search.

## 14. Attribute-map registrations

None. The attribute conditions use only `patient.gestational_age_weeks` and
`patient.rh_factor`; `patient.*` needs no code-map row. Both are in
`KNOWN_PATIENT_ATTRIBUTES` (`attribute-vocabulary.ts`). Every lab and vital condition is in
coded form.

## 15. Evidence citations

Every entry below was fetched by a wave-1 or wave-2 agent on 2026-09-24. Wave-2 fixes are
folded in (§0.7). [21]–[23] were gathered for Rh prophylaxis: [21] and [22] still support
Rh typing and the antibody screen here; [23] (the RhoGAM label) is cited by no node now and
is kept for the Rh-negative pathway (§0.9).

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

Gates, CodeEntries, QMs and Schedules cannot cite; their evidence is on the host step. 70 of
the 71 references are cited by a node. [23] (the RhoGAM label) is cited by nothing and is not
emitted; it stays in §15 for the Rh-negative pathway.

**Stages:** 1: [1][2][3] · 2: [1][16][50] · 3: [3][4] · 4: [52][55][56] · 5: [1][4] ·
6: [1][53][54][55][57] · 9: [1][8][24][44] · 10: [24][25][26] · 11: [1][20][44][48][62] ·
12: [46][47]

**Steps:**
- 1.1: [1][3][59][71] · 1.2: [1][2][46][49] · 1.3: [1][2][6][7][9][10][11][12][13][14][15][21][22]
- 1.10: [1][2] · 1.11: [2][22] · 1.12: [2][22] · 1.13: [2] · 1.14: [7][8] · 1.15: [9] ·
  1.16: [9] · 1.17: [10][11] · 1.18: [12] · 1.19: [13][14] · 1.20: [15] · 1.21: [6] · 1.22: [2]
- 1.23: [1][2] · 1.24: [21][22]
- 1.4: [1][29][30][31][32][33][34][35][61] · 1.5: [4][5][6][63] · 1.6, 1.25, 1.26: [17][18][19]
  · 1.7: [17][18][19][64]
- 1.8: [28][36][37][38][39][40][41][45][51][64][65][66][67][68] · 1.27, 1.28, 1.29, 1.30:
  [28][65][66][67] · 1.9, 1.31, 1.33, 1.34, 1.35: [24][25][27] · 1.32, 1.36, 1.37, 1.38:
  [24][25]
- 2.1, 2.2: [16] · 2.3: [1][2][50] · 2.4: [1][2]
- 3.1: [3] · 3.2: [4]
- 4.1, 4.6: [52][55][56][58] · 4.2: [52][55] · 4.3: [55] · 4.4: [52][55][56] · 4.5: [53][55][57]
- 5.1: [1][3][4] · 5.2: [4]
- 6.1, 6.5: [1][2] · 6.2, 6.6: [53][55][57] · 6.3: [53] · 6.4: [55][56] · 6.7: [53][54][55][57]
  · 6.8: [55][57] · 6.9, 6.10: [53][55][57][58] · 6.11: [53][55][56] · 6.12: [53][55] ·
  6.13: [55][56]
- 9.1: [24][25][26][27][60] · 9.10, 9.11, 9.12, 9.13: [24][25] · 9.5: [8][10][11][15] · 9.7: [7][8] ·
  9.8: [10][11] · 9.9: [15] · 9.6: [29][31][42][43][44][59]
- 10.1, 10.2, 10.3, 10.4, 10.5: [24][25][26] · 11.1, 11.4: [20] · 11.2: [1][48] · 11.3: [47][49][62] ·
  12.1: [46][47]

**Medications:** Med-1: [28][65][66][67] · Med-2: [17][18][19][64] · Med-3, Med-3b:
[24][25][27] · Med-4, Med-4b: [24][25] · Med-5, Med-5b: [24][25] · Med-7, Med-7b: [25][26]

**Labs:** as the Source column of §6. **Imaging:** Img-1: [3] · Img-2: [4] · Img-3: [1][4].
**Procedures:** Proc-1, Proc-2: [46] · Proc-3: [48]. **Guidance:** as listed in §9.

**Gate evidence on host steps:** GA gates → 1.1; panel gates, `gate-hgb-low`,
`gate-rh-not-positive` → 1.3; aspirin gates → 1.6 / 1.26; prenatal vitamin gates → 1.8 / 1.29;
influenza and COVID-19 gates → 1.9 / 1.33 / 1.36; `gate-bp-elevated` → 2.1; early-diabetes gates → 4.1 /
4.6; `gate-cbc-repeat-due` → 6.1; GDM gates → 6.2 / 6.6 / 6.9; Tdap gates → 9.1 / 9.11; rescreen
gates → 9.5; RSV gates → 10.1 / 10.3; `gate-gbs-culture-due` → 11.1.
QM-1 → 1.1; QM-2 → 9.1; QM-3 → 1.4; QM-4 → 9.6.

## 17. Temporal horizon & status summary (EMITTED — review carefully)

| Gate(s) | Condition on | horizon | status | Rationale |
|---|---|---|---|---|
| eight `gate-ga-*` | `patient.gestational_age_weeks` | — | — | `patient.*` has no temporal policy |
| `gate-cbc-due`, `-antibody-screen-due`, `-rubella-due`, `-syphilis-due`, `-hbsag-due`, `-hiv-due`, `-hcv-due`, `-urine-culture-due`, `-ct-gc-due`, `-varicella-due` | labs `not_includes_code`, twice per code | **LIFETIME** OR **PREGNANCY** | — | Never resulted (no gestational age needed), or not drawn this pregnancy (Josh: use the gestational age) |
| `gate-a1c-not-on-file` | labs `not_includes_code` | **PREGNANCY** | — | Drawn this pregnancy; Stage 4 is already behind a gestational-age gate |
| `gate-abo-rh-due`, `gate-hbv-triple-due`, `gate-hgbpathy-due` | labs `not_includes_code` | LIFETIME | — | Done once, ever |
| `gate-hgb-low` | labs 718-7 < 10.45 / < 10.95 | **PREGNANCY** | — | Only a value drawn this pregnancy opens the hand-off (Josh) |
| `gate-hgb-low` | conditions O99.01.\*, D50.\* | LIFETIME | active | Already diagnosed |
| `gate-rh-not-positive` | conditions Z67.11 / .21 / .31 / .41 / .91 | LIFETIME | active | Already recorded |
| `gate-rh-not-positive` | `patient.rh_factor` | — | — | No temporal policy |
| `gate-taking-prenatal-vitamin` / `gate-not-taking-prenatal-vitamin`, `gate-tdap-given` / `-not-given`, `gate-rsv-vaccine-given` / `-not-given` | `patient.on_prenatal_vitamin`, `patient.tdap_given_this_pregnancy`, `patient.rsv_vaccine_ever_given` | — | — | No temporal policy; how long a remembered answer holds is `remember_answer.scope` |
| `gate-on-aspirin`, `gate-aspirin-not-on-list`, `gate-on-prenatal-vitamin`, `gate-prenatal-vitamin-not-on-list` | medications, by ingredient (`RXNORM_INGREDIENT`) | LIFETIME | active | Currently on it |
| `gate-influenza-vaccine-due` / `-undated`, `gate-covid-vaccine-due` / `-undated` | medications `count_in_window` | **`{ since: "09-01" }`** | any | A dose this season: on or after the most recent September 1 (Josh) |
| the same four gates | `encounter.date` `in_season` 09-01 → 03-31 | — (the session clock) | — | Influenza and COVID-19 season (Josh) |
| `gate-tdap-due` / `-undated` | medications `count_in_window` | **PREGNANCY** | any | A dose this pregnancy |
| `gate-rsv-vaccine-due` / `-undated` | medications `count_in_window` | `window_days: 36525` | any | A dated dose, ever |
| `gate-rsv-vaccine-due` / `-undated` | `encounter.date` `in_season` 09-01 → 03-01 | — (the session clock) | — | RSV season, ACOG (Josh) |
| all eight vaccine gates (every leaf `RXNORM_INGREDIENT`) | medications `includes_code` / `not_includes_code` | LIFETIME | any | The undated-entry check: on the list at all? |
| all eight vaccine gates | medications `count_in_window` | `window_days: 36525` | any | The undated-entry check: any dated entry? |
| `gate-bp-elevated` | vitals systolic_bp, diastolic_bp | DAY | — | Today's reading (never ENCOUNTER) |
| `gate-bp-elevated` | conditions R03.0, O10.\*, O11.\*, O13.\*, O14.\*, O16.\* | LIFETIME | active | Already diagnosed |
| `gate-overt-diabetes`, `gate-early-abnormal-glucose` | labs 4548-4 | **PREGNANCY** | — | Only a value drawn this pregnancy (Josh) |
| `gate-cbc-repeat-due` | labs 718-7 `not_includes_code` | **`{ since_gestational_week: 24 }`** | — | Drawn at or after 24 0/7 weeks (Josh) |
| `gate-diabetes-on-file` and the `O24.*` leaf of the GDM gates | conditions O24.\* | LIFETIME | active | Diagnosed |
| `gate-gdm-screen-negative`, `gate-gdm-nothing-on-file`, `gate-75g-diagnostic` | labs 1504-0, 1552-9, 1507-3, 1518-0 | **`{ since_gestational_week: 24 }`** | — | Only a screen at or after 24 0/7 weeks is the 24–28-week screen (Josh) |
| `gate-gct-positive`, and the "no earlier positive" group of `gate-gdm-nothing-on-file` | labs 1504-0 | **PREGNANCY** | — | A positive 50-g at any gestational age leads to the diagnostic test |
| `gate-ogtt100-not-on-file`, `gate-100g-diagnostic`, `gate-100g-negative` | labs 1549-5, 1501-6, 1514-9, 1530-5 | **`{ since_gestational_week: 24 }`** | — | The diagnostic test at 24–28 weeks |
| three `gate-*-rescreen-due` | labs `not_includes_code` | **`{ since_gestational_week: 28 }`** | — | Third trimester (J37) |
| `gate-gbs-culture-due` | labs 72607-5, 91875-5 | **`{ since_gestational_week: 36 }`**, and `{days: 35}` | — | Drawn in the screening window, and still valid (5 weeks) |
| `gate-gbs-culture-due` | conditions O99.820 | LIFETIME | active | Carrier state |

- `window_days` only on the vaccine counts; never together with `horizon`. The calendar leaf
  carries neither (a horizon there is an import error). No `status` on labs
  or vitals. No trend or delta operator; no `window_from`.
- Every condition carries an explicit horizon or `window_days` except `patient.*` attributes.
- The only fixed day counts left are the 35-day GBS validity and the 36525-day "ever" of the
  vaccine checks. No look-back is banded by gestational age.
- **Simulator:** an undated lab or medication is asserted current, so it reads as inside
  `PREGNANCY` and every week window, and an undated vaccine is asked about. The bounds are exercised only with dated entries.

## 18. Gaps & fallbacks

### `[JOSH — CONFIRM]` items

**Closed by Josh's reviews** `[DECISION — Josh 2026-10-04]`:
- of version 1: J1, J2, J3, J5, J7, J8, J9, J11, J12, J14, J15 / J21, J16, J19, J20;
- of version 2: J4, J6, J17, J23, J24, J25, J26, J27, J29;
- of version 3: J10 and J22 (week windows; a GDM screen before 24 0/7 weeks does not count),
  J13 (early HbA1c: this pregnancy only), J32 (weak / partial D: always Z67.91), J34 (Rh
  spellings accepted), J35 (influenza and COVID-19 only in season, September 1 to March 31),
  J38 ("Not available" on the prenatal vitamin, Tdap or RSV question recommends it).

**Closed in version 5:** J28 / J31 — medications are matched by ingredient
(`[DECISION — Josh 2026-10-04]`: "match the vaccine, not the brand"); no product lists, no
yearly upkeep.

**Review in place, not blocking:** J18 — the wording of the builder's Guidance nodes Guid-10
to Guid-23; Josh reviews it in the simulator.

**Still open:**

| # | Item | Built as | Where |
|---|---|---|---|
| J30 | Gestational age declined and a panel test on file at an earlier date: that test is not ordered | As stated | §4b panel gates |
| J33 | The Rh type, once answered, is remembered for the patient (`remember_answer`, scope `PATIENT`, any answer) so it is not asked at later encounters — the builder's addition | As stated | `gate-rh-not-positive` |
| J36 | The undated **influenza and COVID-19** answers are not remembered (no season scope): the question returns each in-season visit until the entry is dated. Tdap and RSV are remembered | Question routers | §4b vaccines, §0.6 #12 |
| J37 | Third-trimester rescreens are due from **28 0/7** weeks (the third trimester), not 27; a test at 27 weeks does not count | Week 28 | §4b rescreen gates |
| J40 | An entry on the medication list that cannot be identified is asked about once per class it could belong to — up to seven yes/no questions for one entry (influenza, COVID-19 ×2, Tdap, RSV, folic acid, aspirin) | Engine behaviour; `ask` on every medication gate | §0.6 #4 |
| J41 | Any aspirin-containing product counts as "already on aspirin" (any dose, any combination); the step says to confirm 81 mg daily | Ingredient `1191` | aspirin gates |
| J39 | A GBS culture drawn before 36 0/7 weeks no longer closes the order, even inside its 5 weeks | Since week 36, and within 35 days | `gate-gbs-culture-due` |

### Not encodable on the josh-dev engine

| # | Requirement | Why not | Built instead |
|---|---|---|---|
| G2 | Remembering "influenza / COVID-19 vaccine given this season" | `remember_answer` has no scope that ends with the season | Question routers (J36) |
| G3 | "A vaccine was given on a day in the window" as one condition | Medication entries are intervals; an event count ignores undated entries | A count per product code, and the undated entry asked about (§4b) |
| G4 | Aspirin eligibility; early-testing eligibility | Counting; uncoded factors; BMI not codeable in pregnancy | BOOLEAN questions |
| G5 | Missed-anatomy-survey catch-up after 24 weeks | REQUIRES has no authorable satisfaction check; imaging is not in the chart | Not encoded |
| G6 | Cross-pathway question dedup (aspirin) | Question gates dedupe only within a pathway | Verbatim prompt |
| G7 | Imaging, age and risk checks | Not in the patient context | Step text; risk-based tests shown for everyone |

Resolved in version 2: "≥2 of 4" (six-pair encoding); the strategy question repeating on a
positive screen; "drawn this pregnancy". Resolved in version 3: "this season" and the RSV
season (the calendar). Resolved in version 4: "since N weeks of gestation"; "Not available" leading to a
recommendation (`on_declined`). Resolved in version 5: matching a medication by what it is.

### No pathway yet — what Prism does not recommend

- **Rh-negative pregnancy: no pathway.** `[DECISION — Josh 2026-10-04]` Routine prenatal care
  types Rh, runs the first antibody screen and says "add the diagnosis to the encounter".
  **Until the Rh-negative pathway is written, Prism recommends no Rh immune globulin and no
  24–28-week repeat antibody screen.** Listed in `pathways/TODO.md`; inputs in §0.9.
- `gestational-diabetes-management` exists as a brief only; no JSON.
- No pathway for pregestational / overt diabetes in pregnancy (Step 4.3's destination),
  chronic hypertension before 20 weeks, or adult preventive care after GDM (D-12).

### Source gaps

- **Paywalled `[PAYWALL]`/`[GAP]` primaries:** PB 175 (ultrasound); PB 162 (CVS/amniocentesis
  windows; the FAQ gives them); PB 181 (mirror); PB 233 (anemia thresholds — confirmed by Josh,
  V2-1); CPG 4; CPG 6 (HBV triple panel, via a news release); SMFM Consult #74; PB 190 and the
  2024 CPU (GDM); CPU 2025 (39-week).
- `[GAP]` Doppler FHT audibility; numeric quickening GA; COVID-19 and Tdap dose volumes;
  2026–27 COVID CPT and RxNorm codes; HEDIS MY2026 detail (PRS-E windows, PND-E cut-points); a
  50-g value ≥200 as diagnostic; bariatric-surgery alternative screening (PB 105).
- `[GAP]` No current ACOG documents on adolescent prenatal care, employment, or a late-entry
  protocol. Late entry is handled by the GA gates and the "not on file" gates.

### Source conflicts

| # | Conflict | Resolution |
|---|---|---|
| C1 | Third-trimester syphilis: ACOG universal (2024) vs CDC STI 2021 risk-based | `[DECISION — Josh 2026-10-04]` **Universal** (ACOG 2024) |
| C2 | Hepatitis B: USPSTF HBsAg alone vs ACOG CPG 6 / CDC 2023 triple panel | `[DECISION — Josh 2026-10-04]` **HBsAg every pregnancy + the triple panel if never documented** |
| C3 | RSV season: ACOG Sept 1–Mar 1 (Aug 2026) vs CDC Sept–Jan | `[DECISION — Josh 2026-10-04]` **ACOG's window, with CDC's stated** |
| C4 | COVID-19 in pregnancy: ACOG vs CDC | D-26 `[DECISION — Josh 2026-09-24]` |
| C5 | RhIG timing | Moved to the Rh-negative pathway (§0.9) |
| C6 | Fetal RhD cfDNA to skip RhIG | Moved to the Rh-negative pathway (§0.9) |
| C7 | First-trimester combined window: 10–13 6/7 (2026 Advisory) vs 11–13 6/7 | `[DECISION — Josh 2026-10-04]` **10–13 6/7** |
| C8 | GBS bacteriuria treatment threshold | Owned by the UTI pathway |
| C9 | 4 mg folic acid start: CDC 1 month vs ACOG FAQ ≥3 months before conception | `[DECISION — Josh 2026-10-04]` **Both stated** |
| C10 | Early abnormal glucose: ADA 2.31b vs ACOG | D-7 |
| C11 | Early test: ADA plasma glucose vs A1C | D-6 |
| C12 | Strategy: ADA one-step vs ACOG two-step | D-5 |
| C13 | RhIG before 12 weeks: label vs ACOG CPU 2024 | Moved to the Rh-negative pathway (§0.9) |

### Checks run on 2026-10-04 (version 5)

- `validate-pathway.ts`: valid, compiles, trigger codes are families or justified leaves,
  DATA USE clean, brief in sync.
- `check-gate-control.ts`: no violations, no warnings (the lint now knows that a gate matching
  a medication by ingredient or class can ask).
- `gate-proof.ts prenatal-*`: every expectation held, in both edge orders.
- `coverage-audit.ts`: every gate opens and closes, every node is included in some session,
  no question is a dead end — including the "could not be identified" questions.
- **What the proofs do not exercise.** The proofs and the audit run the real evaluator and
  traversal engine, but take each medication's identity from
  `scripts/fixtures/medication-identities.json` — RxNav's own answers for 45 codes, fetched
  2026-10-04 — in place of the service's normaliser, which needs the database and the
  network. So they do not exercise: the live RxNav call and its cache, the 4-second wait for
  a medication not seen before, the pinning of an identification in the session, or a
  free-text (uncoded) entry. A code missing from the fixture is treated as unidentified.
- `gate-proof.ts prenatal-triggers` does not run the live matcher. Remembered answers need
  the database: no proof exercises the storing.

### Uses josh-dev extensions (will not validate on `origin/main`)

`not_includes_code`, `horizon: "PREGNANCY"`, `horizon: { "since_gestational_week": … }`,
`horizon: { "since": … }`, `on_declined`, `system: "RXNORM_INGREDIENT"` on medications, the calendar condition
`encounter.date` / `in_season`, `remember_answer`, `count_comparison` on `count_in_window`,
nested AND/OR groups, typed `patient.*` answers and "Not available".
