# Pathway Research Brief — Routine Prenatal Care (with universal GDM screening)

JSON: pathways/json/routine-prenatal-care.json @ version 1

**Status: approved for build by Josh's decisions of 2026-10-04; items marked CONFIRM remain.**
Built as `pathways/json/routine-prenatal-care.json`, version 1 (346 nodes, 639 edges). Not
imported into any database.

**What this is.** A new pathway, `routine-prenatal-care`. It replaces the older stored
`routine-prenatal-care-v1` and `-v2` graphs (§0.2), neither of which is active locally any
more (D-27 is moot). Per Josh's D-1 it **owns gestational diabetes screening and diagnosis**;
the GDM brief is management-only (`pathways/briefs/gestational-diabetes-management-research-brief.md`).

**Research method** (per `.claude/skills/pathway-research/SKILL.md`), all on 2026-09-24:
landscape scan, four parallel domain agents over fetched guideline text, and wave-2
verification agents for codes and citations (§0.7). The GDM screening content reuses the GDM
brief v1 research. No new research was done on 2026-10-04; that pass applied Josh's decisions
and the current authoring rules, and verified the added codes (§0.8).

Flags:
- `[GAP]` unsourceable.
- `[OLDER SOURCE]` older, but still the current recommendation.
- `[NOT ENCODABLE]` clinically required but not expressible on the josh-dev engine; the nearest
  supported pattern is built and what would be needed is stated.
- `[DECISION — Josh <date>]` ratified.
- `[JOSH — CONFIRM]` a clinical or coding choice the builder had to make; listed together in §18.
- `[PAYWALL]` the primary text could not be read; the claim rests on the named secondary or
  mirror.
- `[WINDOW — <gate>: …]`, `[ON-UNRESOLVED DEFAULT — <gate>]` the format spec's markers.

> ### Read this first (2026-10-04 build)
>
> 1. **The chart is read before anything is asked or ordered.** A test already resulted is not
>    ordered again; a supplement or aspirin already on the medication list is continued, not
>    started; a diagnosis already on the problem list closes its hand-off (§4b "How each datum
>    is used").
> 2. **Gestational age drives the timeline.** Eight gates on Step 1.1 read ONE datum,
>    `patient.gestational_age_weeks`, and open the windowed stages. A missing value is asked
>    for once.
> 3. **Routine care screens; it does not treat other problems.** For diabetes, hypertension,
>    anemia and Rh(D)-negative blood type the pathway reads or orders the screening test and,
>    on a positive result, opens a step that says "add the diagnosis". The provider adding the
>    diagnosis is the only link to that problem's pathway. `[DECISION — Josh 2026-10-04]`
> 4. **Rh-negative management is not here.** This pathway types the blood and runs the
>    antibody screen. It contains **no Rh immune globulin**, at any gestational age. Until the
>    Rh-negative pathway exists, Prism recommends none (§0.9, §18).
> 5. **GDM status from 24 weeks is read from the chart** (D-22): a diabetes code means
>    diagnosed, a screening result means screened. The provider is asked the strategy only
>    while screening is open, and the result of the test just ordered is asked for with "Not
>    available" as an answer that blocks nothing (D-29). One residual question the engine
>    cannot remove is described in §0.6 #2.
> 6. **Checked against the real engine**: `gate-proof.ts prenatal-ga`, `prenatal-gdm`,
>    `prenatal-handoffs`, `prenatal-meds`, and `coverage-audit.ts`.

---

## 0. Cross-cutting analysis (not emitted)

### 0.1 Architecture `[DECISION — Josh 2026-09-24]` (D-1), extended `[DECISION — Josh 2026-10-04]`

- **GDM testing is part of routine prenatal care.** A positive result opens **"Diagnose GDM:
  add O24.410 to the problem list"**, with a CodeEntry for O24.410. Once coded,
  `gestational-diabetes-management` matches on the next resolve and owns glycemic management.
- **Screening for other problems stays in routine care; treatment does not.**
  `[DECISION — Josh 2026-10-04]` Routine care screens for diabetes, hypertension and anemia
  and recommends adding the diagnosis. Treatment belongs to that problem's own pathway. The
  provider makes the link by adding the diagnosis; pathways are not linked to one another
  (the spec's "one problem per pathway"). Four hand-offs are built, all the same shape — a
  gate on chart data, one step, one CodeEntry, one Guidance node, no orders for the other
  problem:

  | Finding | Gate | Step | Code recommended | Pathway that takes it |
  |---|---|---|---|---|
  | GDM diagnostic test positive | `gate-100g-diagnostic` / `gate-75g-diagnostic` | 7.3 / 8.2 | O24.410 | `gestational-diabetes-management` (brief only) |
  | BP ≥140/90 (D-25) | `gate-bp-elevated` | 2.2 | R03.0, then O13.x / O14.x | `gestational-hypertension-preeclampsia` |
  | Low hemoglobin (G8) | `gate-hgb-low` | 1.23 | O99.011 / .012 / .013 | `anemia-in-pregnancy` |
  | Rh(D) negative | `gate-rh-negative` | 1.24 | Z67.91 (or Z67.11/.21/.31/.41) | Rh-negative pregnancy (**not started**, `pathways/TODO.md`) |
  | Early HbA1c ≥6.5% | `gate-overt-diabetes` | 4.3 | O24.111–.119 | none yet (pregestational diabetes) |

- **Each hand-off closes when its diagnosis is already on the problem list**, so a patient
  whose anemia or hypertension pathway is already running is not told to add the code again.
- **This pathway stays active after a hand-off** through Z34 / O09, and through the GDM
  families after a GDM diagnosis (D-21).

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
  longer matches a Z34-only trigger set, hence the GDM families in §1. The same is true of
  every chapter-15 complication the co-matching pathways key on (O99.01x anemia, O13/O14
  GHTN, O23.x UTI); those are not triggers here (§1, J16).

### 0.4 Co-matching with the other pathways (re-checked 2026-10-04 with family triggers)

Triggers, from the built JSONs on josh-dev:

| Pathway | Triggers (families) |
|---|---|
| `anemia-in-pregnancy` v17 | `O99.01`, `D50` |
| `gestational-hypertension-preeclampsia` v6 | `O13.2`, `O13.3`, `O13.9`, `O14.0`, `O14.1`, `O16`, `R03.0` |
| `uti-asymptomatic-bacteriuria-pregnancy` v4 | `R82.71`, `O23.1`, `O23.4`, `O99.820`, `Z13.89` |
| `gestational-diabetes-management` (brief only) | O24.41x, O24.43x |
| **this pathway** | `Z34`, `O09`, `O24.41`, `O99.810` |

The analysis still holds with families, and co-matching is now the designed route: every
hand-off step tells the provider to add a code that is another pathway's trigger, and the
routine pathway keeps matching through Z34 / O09. All four are `category: OBSTETRIC`, so
each applies only to a pregnant patient; Z34 and every O-code are themselves pregnancy
evidence for that rule, so `D50` or `R03.0` beside Z34 fires its pathway.

**How the merge treats it** (josh-dev `care-plan-merge.ts`):
- **Labs** with the same `system|code` fold into ONE line; the other nodes' names are shown as
  "Ordered for: …". So every LabTest name here says why this pathway orders it — "CBC with
  indices — first prenatal panel (no hemoglobin this pregnancy)" next to anemia's "CBC with
  indices" reads as two reasons for one order.
- **Medications** are deduped by name; `clinical_role` conflicts on ≥2 distinct names in one lane.
- **Guidance** is deduped on topic + instructions.
- **Question gates do not dedupe across pathways.** Chart data questions are keyed on the datum.

| Overlap | With | Handling |
|---|---|---|
| **Aspirin 81 mg** (`preeclampsia-prophylaxis`) | GHTN `med-1` | Same name, same lane → one line. The eligibility **question is duplicated** for a co-matched patient; the prompt is verbatim GHTN's, so the answers mean the same. This pathway now asks it only of a patient not on aspirin and before 28 weeks, so the duplicate is rarer. |
| **BP ≥140/90** | GHTN `gate-bp-elevated` | Same two vitals leaves, same datum keys. This pathway's gate also requires that no hypertension code is on file, so once R03.0 / O13 / O14 / O16 is recorded (the moment GHTN matches) the routine hand-off step closes and only GHTN speaks. |
| **CBC** 58410-2 | anemia `lab-1` and its rechecks | Folds to one line. This pathway orders it only when no hemoglobin was drawn this pregnancy (Lab-1) or since 24 weeks (Lab-19). |
| **Hemoglobin 718-7 as a datum** | anemia threshold gates | Both pathways ask for a missing hemoglobin; one datum key, so one question. Once O99.01x is on file this pathway's `gate-hgb-low` is closed and no longer asks. |
| **ABO/Rh type** 882-1 | anemia `lab-9` "Type and antibody screen" | Same LOINC → one line. |
| **Hemoglobinopathy evaluation** 43113-0 | anemia `lab-7` | Same LOINC → one line. Ordered here only if never resulted. |
| **Urine culture** 630-4 | UTI `lab-2`/`lab-9` | Same LOINC → one line. UTI owns treatment. |
| **GBS** | UTI (`O99.820` trigger) | `O99.820` on the problem list now closes this pathway's 36-week culture order (negation exists). |
| **Urgent maternal warning signs** | GHTN `guid-1` | Byte-identical text and topic (D-28) → one block. |
| **NST 59025 / BPP 76818** | GHTN, GDM | Same CPTs → one line each; names say "late-term surveillance". |
| **clinical_role lanes** | all | `prenatal-vitamin-supplementation`, `preeclampsia-prophylaxis` (shared with GHTN by design), `influenza-immunization`, `covid-immunization`, `pertussis-immunization`, `rsv-maternal-immunization`. `rh-immune-globulin-prophylaxis` is gone with the RhIG node. No conflict with anemia (iron lanes), GHTN antihypertensives, UTI antibiotics or GDM. |

Guidance topics do not collide with another pathway's except the deliberate "Urgent maternal
warning signs".

### 0.5 Decision index

| ID | Ruling |
|---|---|
| D-1 | `[DECISION — Josh 2026-09-24]` GDM testing lives in routine prenatal care; a positive result opens "Diagnose GDM (add O24.410)". |
| D-3 | `[DECISION — Josh 2026-09-24]` 50-g cutoff **140 mg/dL** (threshold 139.9). |
| D-4 | `[DECISION — Josh 2026-09-24]` 100-g test: **Carpenter–Coustan, ≥2 abnormal values**, a question gate. Kept as a question on 2026-10-04 (§0.6 #1). |
| D-5 | `[DECISION — Josh 2026-10-04]` Screening strategy: **both one-step and two-step; the provider picks** (`gate-gdm-strategy`). |
| D-6 | `[DECISION — Josh 2026-10-04]` Early test: **HbA1c only.** The fasting-glucose LabTest (old Lab-18) is removed; the alternatives are text in Step 4.1. |
| D-7 | `[DECISION — Josh 2026-10-04]` Early abnormal glucose (HbA1c 5.9–6.4%): **include; counselling and fasting-glucose monitoring only** (Step 4.4). |
| D-12 | `[DECISION — Josh 2026-09-24]` Post-GDM long-term screening belongs to routine care; in pregnancy it is an early-testing criterion (Step 4.6). |
| D-17 / D-21 / D-23 | `[DECISION — Josh 2026-10-04]` Triggers: **Z34 + O09 + the gestational diabetes codes**, authored as families (§1). Z3A is not used. O09 is included for routine elements only. Category OBSTETRIC. |
| D-22 | `[DECISION — Josh 2026-10-04]` GDM status from 24 weeks: **read the chart, ask only the gaps.** The every-visit SELECT router is gone (§4b "GDM status"). |
| D-24 | `[DECISION — Josh 2026-10-04]` Rh type: **read `patient.rh_factor`; ask only if missing** (`gate-rh-negative`). |
| D-25 | `[DECISION — Josh 2026-10-04]` BP ≥140/90: **include the hand-off** — confirm, record the diagnosis; the provider adds it, which brings in the hypertension pathway. No link between pathways. |
| D-26 | `[DECISION — Josh 2026-09-24]` COVID-19 vaccine: recommend per ACOG, with shared decision-making documented; CDC's position stated in the node text. |
| D-27 | Moot `[2026-10-04]`: neither `routine-prenatal-care-v1` nor `-v2` is active locally any more, so there is nothing to archive at import. |
| D-28 | `[DECISION — Josh 2026-09-24]` Urgent maternal warning signs: reference the list, never include it. |
| D-29 | `[DECISION — Josh 2026-10-04]` A test ordered with no result yet (50-g challenge, early HbA1c, 75-g test): **the result gate asks; "Not available" keeps the order in the plan and blocks nothing; the result is read at the next visit.** Anemia's "no hemoglobin on file" pattern (v10–v13): a threshold gate that asks, beside a membership gate on the absence that opens the order step. |
| — | `[DECISION — Josh 2026-10-04]` **Screening for other problems stays in routine care** (diabetes, hypertension, anemia); treatment belongs to that problem's pathway (§0.1). |
| — | `[DECISION — Josh 2026-10-04]` **Low hemoglobin on the routine CBC: built** (`gate-hgb-low` → Step 1.23). The **most recent** hemoglobin is read, however old. |
| — | `[DECISION — Josh 2026-10-04]` **Rh-negative management is its own pathway, not routine prenatal** (§0.9). |
| — | `[DECISION — Josh 2026-10-04]` **Source conflicts ratified** (§18 C1, C2, C3, C7, C9). |

### 0.6 Spec and engine limitations (re-checked against spec v6 + josh-dev, 2026-10-04)

**No longer limitations** (the 2026-09-24 draft listed them):
- **Negation exists** (`not_includes_code`). "Not diagnosed", "no result on file", "no GBS
  carrier state", "not on the medication" are all chart-read now.
- **"Not available" exists.** A declined datum closes the gates waiting on it for the session,
  so a held result gate no longer blocks a plan (D-29).
- **Nested AND/OR groups exist** (4 levels). Used for the trimester hemoglobin thresholds,
  "this pregnancy" look-backs and the GDM status gates.
- **`patient.*` answers are typed.** A missing Rh type is a SELECT, not a number.
- **Simulator code coverage** is no longer the constraint it was: the full ICD-10-CM set is
  loaded, code search matches words, and a code a pathway carries is added to the reference
  table on upload. The draft's `[SIM]` notes are dropped. One caveat remains: the local
  `clinical_code_reference` table mislabels three hepatitis B LOINCs (5196-1 and 5195-3 as
  surface *antibody*, 16933-4 as surface *antigen*; §0.7), so a tester closes the HBsAg order
  by entering what the picker calls an antibody.

**Still limitations:**

1. **No N-of-M operator** `[NOT ENCODABLE]`. Carpenter–Coustan "≥2 of 4" stays a question
   (D-4). With nested groups a faithful chart encoding now exists in principle — one gate,
   `OR` over the six pairs of values — but it would ask for up to four values one at a time,
   and Josh's instruction on 2026-10-04 was to keep D-4 as a question. `[JOSH — CONFIRM]`
   whether to build the six-pair encoding: it is what would let a positive 50-g challenge with
   a normal 100-g test be read from the chart and stop being asked about (#2).
2. **A question cannot be skipped when the chart already answers it, without also losing the
   "ask for the result" behaviour** `[NOT ENCODABLE]`. D-22 and D-29 pull against each other in
   one state. D-29 needs the result gate to sit behind the strategy question (otherwise a
   one-step site is asked for a 50-g value it never draws). The engine closes a region and
   everything in it together, so the strategy question's region must stay open while the
   result it asked for is being read — which means it is open, and the question is asked,
   whenever screening is not finished. **Consequence:** a patient whose 50-g challenge is
   ≥140 and who is not yet diagnosed is asked the strategy at each visit even though the
   50-g result on file shows it is two-step, and then (D-4) whether the 100-g test met
   criteria. A negative screen and a diagnosis are both read from the chart with nothing
   asked. What would remove it: a question gate that can be pre-answered from a chart
   condition, or an OR between a question and a chart condition on one target (two gates on
   one target are an AND, Rule 2). The alternative built on today's engine — chart gates
   only, no result question at the ordering visit — satisfies D-22 fully and D-29's outcome
   (order stays, nothing blocks) but not its "the result gate asks". `[JOSH — CONFIRM]` which
   he prefers.
3. **No look-back anchored on the pregnancy** `[NOT ENCODABLE]`. "Drawn this pregnancy" has no
   operator: `window_from` anchors only on a medication start, and a horizon is a fixed number
   of days. Nearest pattern, built: the look-back is the trimester's length, chosen by
   gestational age in nested groups (first trimester 98 days, second 196, third 300). A result
   drawn up to 14 weeks before conception can therefore count as this pregnancy's. What would
   fix it: a `window_from` event for the pregnancy start (or an EDD attribute a horizon can
   read). The same applies to "since 24 weeks" and "since 27 weeks" (4–5-week bands).
4. **No calendar-month operator.** The RSV and influenza seasons are text.
5. **`patient.rh_factor` SELECT options come from the comparands.** A lone
   `equals "negative"` offers one option. Built: one compound gate whose first leaf is
   `in ["negative", "positive"]` (it supplies both options) and whose second is
   `equals "negative"`. No Rh-positive step is needed.
6. **REQUIRES has no authorable satisfaction check**, so every prerequisite surfaces as
   catch-up even when done. One pair is kept (§12).
7. **Question gates do not dedupe across pathways** (aspirin, §0.4).
8. **GA is completed weeks.** Windows "A 0/7–B 6/7" are `≥ A` and `< B+1`.
9. **Imaging results, immunization records, age and risk factors are not in the patient
   context.** The dating and anatomy ultrasounds, the vaccines, and the age- or risk-based
   tests (chlamydia/gonorrhea, HIV rescreen, varicella) cannot be checked against the chart;
   each says so in its step text.
10. **Gated regions (Rule 1).** No edge points into a gated stage or step from outside it; no
    `ESCALATES_TO`; a lab on several hosts is one node per host. CodeEntry and
    EvidenceCitation nodes are shared (exempt).

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
| Z34, O09, O24.41, O99.810, O99.81, O24.4 | ICD-10 | local `icd10_codes` (98,188 rows — the full set) | All present. `O24.4` also holds O24.42x (childbirth) and O24.43x (puerperium); `O99.81` also holds O99.814 / O99.815. |
| Z67.11, Z67.21, Z67.31, Z67.41, Z67.91 | ICD-10 | local `icd10_codes` | Blood type, Rh negative (A / B / AB / O / unspecified). All present. |
| O36.01 and its leaves | ICD-10 | local `icd10_codes` | "Maternal care for anti-D [Rh] antibodies" — the alloimmunized patient, 7th character per fetus. |
| O26.89, O26.891–.899 | ICD-10 | local `icd10_codes` | "Other specified pregnancy related conditions". |
| O99.820 | ICD-10 | already a UTI-pathway trigger | Streptococcus B carrier state complicating pregnancy. |
| 4511 folic acid (IN), 198640 folic acid 0.4 MG Oral Tablet, 310410 folic acid 1 MG Oral Tablet | RXNORM | RxNav `properties` | Confirmed. |
| 1191 aspirin (IN), 243670 aspirin 81 MG Oral Tablet, 318272 aspirin 81 MG Chewable Tablet | RXNORM | RxNav `properties` | Confirmed. The local seed table mislabels 243670 as "325 MG" and 318272 as "Delayed Release". |
| 91875-5 | LOINC | carried from the 2026-09-24 wave-2 list (GBS NAAT) | Not re-verified today. |

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

**Josh's inputs to that pathway** (recorded, not built): about 28 weeks, after the repeat
antibody screen, is the right timing for routine RhIG; his leaning is to forgo routine RhIG
before 12 weeks, per ACOG.

**Until that pathway exists, Prism recommends no Rh immune globulin for anyone.** Step 1.24
says so in its guidance.

**The diagnosis to add** `[JOSH — CONFIRM]`. Built: **Z67.91** (unspecified blood type, Rh
negative), or the ABO-specific Z67.11 / .21 / .31 / .41. Reasons:
- It says exactly what is known — her blood type — and nothing about antibodies.
- It is a Z code, so it sits beside Z34 without breaking the ICD-10-CM rule that Z34 is not
  used with a chapter-15 code (§0.3). O26.89- ("other specified pregnancy related
  conditions", the index entry for Rh-negative state in pregnancy) is a chapter-15 code:
  adding it would mean dropping Z34, and with the D-21 trigger set the routine pathway would
  then stop matching unless O09 is present.
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
- **Version**: 1
- **Category**: OBSTETRIC (behaviour, not a label: the pathway applies only to a patient the
  chart shows is pregnant)
- **Scope**: Outpatient antepartum care for every pregnancy under supervision, from the first
  prenatal contact to birth: intake and dating; the initial laboratory panel; genetic
  screening options; psychosocial screening; preeclampsia risk and aspirin; supplements,
  immunizations and counselling; every-visit monitoring; and gestational-age-windowed care
  (dating ultrasound, aneuploidy windows, anatomy survey, early and universal diabetes
  testing, the 24–28-week CBC, Tdap, third-trimester rescreening, the RSV vaccine, GBS, fetal
  presentation, birth and postpartum planning, late-term surveillance).

  **Screens and hands off** (adds the diagnosis; does not treat): gestational diabetes, overt
  diabetes, elevated blood pressure, anemia, Rh(D)-negative blood type.

  **Out of scope:**
  - treatment of any of those problems;
  - **all Rh-negative management, including Rh immune globulin** (§0.9);
  - condition-specific high-risk management (multiples, prior preterm birth and cervical
    length, TOLAC, OUD treatment, age ≥40 testing, obesity-based testing), listed as text in
    Step 1.2 (D-23);
  - intrapartum and postpartum care, beyond planning;
  - nausea/vomiting treatment.
- **Target population**: Pregnant patients receiving outpatient prenatal care, average risk or
  under high-risk supervision.
- **Condition codes** (trigger codes; OR semantics) `[DECISION — Josh 2026-10-04]` (D-21
  option (b), D-17, D-23), authored as **families** per the current spec — the matcher expands
  a patient's code to its ancestors, so a parent matches every code beneath it:

| Code | System | Description | Usage note | Grouping |
|---|---|---|---|---|
| `Z34` | ICD-10 | Encounter for supervision of normal pregnancy (all 12 leaves) | primary trigger | normal-pregnancy |
| `O09` | ICD-10 | Supervision of high risk pregnancy (all 64 leaves) | primary trigger — routine elements only (D-23) | high-risk-pregnancy |
| `O24.41` | ICD-10 | Gestational diabetes mellitus in pregnancy (O24.410 / .414 / .415 / .419) | keeps routine care after the GDM diagnosis recodes the pregnancy | pregnancy-complication-coded |
| `O99.810` | ICD-10 | Abnormal glucose complicating pregnancy | abnormal 50-g challenge awaiting the diagnostic test | pregnancy-complication-coded |

- **Why these levels.** `Z34` and `O09` are prenatal-only categories, so the whole family
  belongs. `O24.41` and not `O24.4`: the parent also holds O24.42x (GDM in childbirth) and
  O24.43x (in the puerperium), which an outpatient prenatal pathway must not take. `O99.810`
  and not `O99.81`: the parent also holds O99.814 (childbirth) and O99.815 (puerperium); it is
  a single leaf, so no `[LEAF CODES]` marker is required.
- **The 2026-09-24 draft listed 81 leaves** because the local `icd10_codes` table then held
  666 rows. It now holds the full set (98,188 rows; `Z34`, `O09`, `O24.41`, `O99.810`
  verified present), so the families match.
- **Z3A is not used** (D-17).
- **What option (b) leaves out** `[JOSH — CONFIRM]`. ICD-10-CM forbids Z34 beside a chapter-15
  code (§0.3). A patient recoded from Z34 to **O99.01x** (anemia), **O13 / O14**
  (hypertension) or **O23** (UTI) alone, with no O09, stops matching this pathway and loses
  the rest of routine care (Tdap, GBS, GDM screening). In the simulator the provider adds the
  diagnosis beside Z34, so both pathways run. Option (c) — adding those families as triggers —
  closes the gap in coded practice; it was not chosen.

## 1b. Code sets

None. Single-condition pathway, legacy OR over `condition_codes`.

## 2. Stages

Stages 1–2 are root-connected. Every other stage is **branch-entry only**, with no root
`HAS_STAGE`. Stage numbers are unique (1–12).

- **Stage 1 — Initial prenatal assessment and whole-pregnancy care** *(root)*: dating; history
  and risk; the initial laboratory panel, each test ordered only if not on file; the anemia
  and Rh hand-offs; psychosocial screening; genetic screening options; preeclampsia risk and
  aspirin; supplements and counselling; immunizations at any gestational age. Step 1.1 hosts
  every GA gate. [1][2][3]
- **Stage 2 — Every prenatal visit** *(root)*: BP with the elevated-BP hand-off, weight, fetal
  heart and movement, fundal height, symptom review, tailored visit schedule. [1][16][50]
- **Stage 3 — First trimester (before 14 0/7 weeks)** *(via `gate-ga-first-trimester`)*:
  dating ultrasound, first-trimester aneuploidy screening window. [3][4]
- **Stage 4 — Early diabetes testing (before 24 0/7 weeks)** *(via `gate-ga-before-24`)*: the
  HbA1c on file is read; one is ordered when none was drawn this pregnancy and testing is
  indicated. [52][55][56]
- **Stage 5 — Second-trimester screening (14 0/7–23 6/7 weeks)** *(via `gate-ga-14-to-24`)*:
  anatomy ultrasound; quad screen / open NTD assessment. [1][4]
- **Stage 6 — From 24 0/7 weeks: repeat CBC and GDM screening status** *(via
  `gate-ga-24-plus`)*. [1][53][57]
- **Stage 7 — Two-step GDM screening and diagnosis** *(via `gate-gdm-strategy` = two-step)*.
  [53][54][55][57]
- **Stage 8 — One-step GDM screening and diagnosis** *(via `gate-gdm-strategy` = one-step)*.
  [55][57]
- **Stage 9 — From 27 0/7 weeks: third-trimester care** *(via `gate-ga-27-plus`)*: Tdap;
  third-trimester rescreening; repeat psychosocial screening; birth, breastfeeding and
  contraception planning. **No Rh content** (§0.9). [1][8][24][44]
- **Stage 10 — Maternal RSV vaccine window (32 0/7–36 6/7 weeks)** *(via `gate-ga-32-to-37`)*.
  [24][25][26]
- **Stage 11 — From 36 0/7 weeks: GBS, presentation and birth planning** *(via
  `gate-ga-36-plus`)*. [1][20][44][48][62]
- **Stage 12 — From 41 0/7 weeks: late-term surveillance and delivery** *(via
  `gate-ga-41-plus`)*. [46][47]

GA bands overlap on purpose: Stages 4 and 5 both run to 24 weeks, and Stages 6, 9, 10, 11 and
12 stack. Proved (`gate-proof.ts prenatal-ga`): a 10-week patient gets Stages 1–4; 20 weeks
1, 2, 4, 5; 28 weeks 1, 2, 6, 9; 36 weeks 1, 2, 6, 9, 10, 11; 41 weeks 1, 2, 6, 9, 11, 12; and
nothing from a later window.

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
  thirteen "not on file" gates, `gate-hgb-low` and `gate-rh-negative`)*: the chart is read
  test by test (§4b). The step itself orders nothing. Weak D patients are not at risk of
  alloimmunization. TB testing and TSH only if at risk; cervical screening on the routine
  schedule. [1][2][6][7][9][10][11][12][13][14][15][21][22]
- **Steps 1.10–1.22 — one order step per panel test** *(each gated by its "not on file"
  gate)*; each carries exactly one LabTest (§6):

  | Step | Orders | Gate | "Already done" means |
  |---|---|---|---|
  | 1.10 | CBC (Lab-1) | `gate-cbc-due` | a hemoglobin (718-7) drawn this pregnancy |
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
  `[DECISION — Josh 2026-10-04]`: the most recent hemoglobin is below the trimester threshold
  (<11.0 g/dL first or third trimester; <10.5 second). Record O99.011 / .012 / .013. The
  anemia pathway owns the workup and treatment; this step orders nothing. CodeEntry `O99.01`;
  Guid-12. [1][2]
  - `[PAYWALL]` `[JOSH — CONFIRM]` **The thresholds are secondary-sourced.** ACOG PB 233 is
    paywalled; the 11 / 10.5 / 11 values are the ones the anemia pathway uses for its
    trimester targets, taken there from the PB 233 abstract and secondary summaries. Confirm
    them as the **screening** cut-offs for the hand-off.
- **Step 1.24 — Rh(D)-negative: add the diagnosis** *(gated by `gate-rh-negative`)*
  `[DECISION — Josh 2026-10-04]`: record Z67.91, or the ABO-specific Rh-negative code. Rh
  management, including Rh immune globulin, belongs to its own pathway. A positive antibody
  screen (alloimmunization, O36.01-) needs maternal–fetal medicine. CodeEntry Z67.91; Guid-13.
  [21][22] The code choice is `[JOSH — CONFIRM]` (§0.9).
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
- **Step 1.8 — Supplements and healthy-pregnancy counselling** *(hosts `gate-no-folic-acid`
  and `gate-on-folic-acid`; Guid-1 to Guid-6)*: the medication list is read first. 4 mg folic
  acid after a prior NTD-affected pregnancy, as a separate supplement through the first
  3 months — CDC: start 1 month before conception [65]; ACOG: at least 3 months before [66]
  (both stated, `[DECISION — Josh 2026-10-04]`). Iron 27 mg/day [66]; iodine 150 mcg/day [67].
  Avoid NSAIDs from 20 weeks, except aspirin 81 mg [64]. [28][36]–[41][45][51][64]–[68]
- **Step 1.27 — Start a prenatal vitamin with folic acid** *(gated by `gate-no-folic-acid`)*:
  Med-1. [28][65][66][67]
- **Step 1.28 — Already taking folic acid: continue** *(gated by `gate-on-folic-acid`)*:
  nothing is started; Guid-10. [28][65][66][67]
- **Step 1.9 — Immunizations at any gestational age** *(unconditional; Med-3, Med-4)*:
  - **Inactivated or recombinant influenza vaccine** in any trimester during the season
    (third-trimester patients as soon as vaccine is available; LAIV is contraindicated).
  - **COVID-19 vaccine per ACOG**, with shared decision-making and the discussion documented;
    CDC's current position is stated in Med-4 (D-26 `[DECISION — Josh 2026-09-24]`).
  - **Hepatitis B vaccine** if susceptible on the triple panel (Engerix-B, Heplisav-B,
    Recombivax HB or Twinrix; PreHevbrio is not recommended in pregnancy).
  - **MMR and varicella are contraindicated in pregnancy.** Give postpartum if non-immune.
  - **Not read from the chart.** Immunization records are not in the patient context, so
    the step says to confirm what has already been given this season and this pregnancy
    (§0.6 #9).

  [24][25][27]

### Stage 2 — Every prenatal visit

- **Step 2.1 — Blood pressure at every visit** *(hosts `gate-bp-elevated`)*: positive screen
  ≥140 systolic or ≥90 diastolic; confirm; diagnosis needs two readings ≥4 hours apart;
  severe range ≥160/≥110. [16]
- **Step 2.2 — Elevated blood pressure: confirm and add the diagnosis** *(gated)*
  `[DECISION — Josh 2026-10-04]` (D-25): severe range → same-day evaluation. At ≥20 weeks
  record R03.0 until confirmed, then O13.x or O14.x; the hypertension pathway then applies.
  Before 20 weeks evaluate for chronic hypertension. CodeEntry R03.0; Guid-14. [16]
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
  `gate-overt-diabetes`, `gate-early-abnormal-glucose`, `gate-a1c-not-on-file`)*: the most
  recent HbA1c decides — ≥6.5% is diabetes; 5.9–6.4% is early abnormal glucose metabolism.
  One-step/two-step GDM criteria are not applied before 24 weeks. The alternatives (FPG ≥126;
  2-h 75-g ≥200; random ≥200 with symptoms) are text only (D-6). [52][55][56][58]
- **Step 4.3 — Overt diabetes in pregnancy: confirm and add the diagnosis** *(gated by
  `gate-overt-diabetes`)*: confirm with a second abnormal test unless unequivocal; record
  O24.111–.119 (or O24.911–.919). Not GDM. CodeEntries O24.111/.112/.113/.119; Guid-15. [55]
- **Step 4.4 — Early abnormal glucose metabolism: counselling and fasting-glucose
  monitoring** *(gated by `gate-early-abnormal-glucose`)* (D-7): not a GDM diagnosis; do not
  code O24.4-. Nutrition counselling; fasting glucose 3–4 times a week. Universal screening
  at 24–28 weeks still applies. Guid-A5. [52][55][56]
- **Step 4.6 — No HbA1c this pregnancy: is early testing indicated?** *(gated by
  `gate-a1c-not-on-file`; hosts `gate-early-testing-indicated`)*: ADA Table 2.5 criteria
  (D-12 lands here: GDM in a prior pregnancy). [52][55][56][58]
- **Step 4.2 — Order the HbA1c** *(gated by `gate-early-testing-indicated`)*: before 15 weeks
  if possible. Lab-17; Guid-A2. [52][55]
- **Step 4.5 — Plan universal GDM screening at 24–28 weeks** *(Sched-3)*. [53][55][57]

### Stage 5 — Second-trimester screening

- **Step 5.1 — Fetal anatomy ultrasound at 18–22 weeks** *(Img-3)*. [1][3][4]
- **Step 5.2 — Second-trimester serum screening / open NTD assessment** *(Lab-16)*. [4]

### Stage 6 — From 24 0/7 weeks

- **Step 6.1 — Anemia rescreen at 24–28 weeks: what is already on file** *(hosts
  `gate-cbc-repeat-due`)*. [1][2]
- **Step 6.5 — Repeat the CBC** *(gated)*: Lab-19. [1][2]
- **Step 6.2 — Gestational diabetes status: read from the chart** *(hosts
  `gate-diabetes-on-file`, `gate-gdm-screen-negative`, `gate-gdm-screen-open`)*. Universal
  screening at ≥24 0/7 weeks; as soon as possible if first seen after 28 weeks. After
  bariatric surgery with dumping consider alternatives (`[GAP]`, PB 105 paywalled).
  [53][55][57]
- **Step 6.4 — Diabetes already diagnosed this pregnancy: no screening** *(gated by
  `gate-diabetes-on-file`)*: Guid-16. [55][56]
- **Step 6.3 — GDM screening complete: negative** *(gated by `gate-gdm-screen-negative`)*: no
  repeat unless clinically suspected. A result drawn before 24 weeks is not the screen
  (§4b). Guid-17. [53]
- **Step 6.6 — GDM screening is open: choose the strategy** *(gated by
  `gate-gdm-screen-open`; hosts the router `gate-gdm-strategy`)*: Guid-A1. [53][55][57]

### Stage 7 — Two-step GDM screening and diagnosis

- **Step 7.1 — Two-step screening: the 50-g 1-hour challenge** *(hosts `gate-gct-not-on-file`
  and `gate-gct-positive`)*: nonfasting; positive at ≥140 mg/dL (D-3). [53][54][55][57]
- **Step 7.5 — Order the 50-g challenge** *(gated by `gate-gct-not-on-file`)*: Lab-20.
  [53][55][57]
- **Step 7.2 — Positive 50-g challenge: the 100-g 3-hour test** *(gated by
  `gate-gct-positive`; hosts the router `gate-100g-diagnostic`)*: Carpenter–Coustan
  95 / 180 / 155 / 140 mg/dL; GDM if ≥2 met (D-4). [53][55][57][58]
- **Step 7.6 — Order the 100-g 3-hour test and await the result** *(router: "Not resulted
  yet")*: record O99.810 meanwhile. Lab-21; CodeEntry O99.810. [53][55][57][58]
- **Step 7.3 — Diagnose GDM (two-step): add O24.410** *(router: "Meets criteria")*: replaces
  O99.810. CodeEntry O24.410; Guid-A4. [53][55][56]
- **Step 7.4 — Two-step screening complete: the 100-g test does not meet criteria** *(router:
  "Does not meet criteria")*: not GDM; no repeat unless suspected. Guid-18. [53][55]

### Stage 8 — One-step GDM screening and diagnosis

- **Step 8.1 — One-step screening: the 75-g 2-hour test** *(hosts `gate-ogtt75-not-on-file`
  and `gate-75g-diagnostic`)*: thresholds 92 / 180 / 153; GDM if any one is met. [55][57]
- **Step 8.3 — Order the 75-g 2-hour test** *(gated by `gate-ogtt75-not-on-file`)*: Lab-22.
  [55][57]
- **Step 8.2 — Diagnose GDM (one-step): add O24.410** *(gated by `gate-75g-diagnostic`)*:
  CodeEntry O24.410; Guid-A4b. [55][56]

### Stage 9 — From 27 0/7 weeks

- **Step 9.1 — Tdap vaccine** *(Med-5, Sched-4, QM-2)*: one dose each pregnancy, early in
  the 27–36-week window. [24][25][26][27][60]
- **Step 9.5 — Third-trimester infection rescreening: what is already on file** *(hosts three
  "not since 27 weeks" gates)*: **syphilis in every patient** in the third trimester and at
  birth (ACOG 2024; `[DECISION — Josh 2026-10-04]`, conflict C1); HIV before 36 weeks if at
  risk; chlamydia/gonorrhea if <25 or at risk. [8][10][11][15]
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

Old Steps 9.2–9.4 (Rh review, RhIG, Rh-positive) are removed (§0.9).

### Stage 10 — Maternal RSV vaccine window

- **Step 10.1 — Offer the maternal RSV vaccine, or plan the infant monoclonal antibody**
  *(Med-7, Sched-6)*: one dose at 32 0/7–36 6/7 weeks, in season — **ACOG September 1 to
  March 1; CDC September through January, both stated** (`[DECISION — Josh 2026-10-04]`,
  conflict C3). Not if vaccinated in a prior pregnancy, delivery planned within 2 weeks, or
  the family plans the infant monoclonal. [24][25][26]

### Stage 11 — From 36 0/7 weeks

- **Step 11.1 — Group B streptococcus screening: what is already on file** *(hosts
  `gate-gbs-culture-due`)*: screen at 36 0/7–37 6/7 weeks whatever the planned mode of birth.
  Not needed with GBS bacteriuria this pregnancy (O99.820) or a prior GBS-infected newborn.
  Prior-pregnancy colonization does not exempt. [20]
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

**47 gates**: 43 chart gates and 4 question gates (two BOOLEAN, two SELECT routers). Every
gate is the **sole route** to its target; every chart gate has one target; both routers map
every option; `default_behavior` is `skip` on all of them. `check-gate-control.ts` passes.

### How each datum is used (the brief template's "use the data the chart gives")

| Datum | Current value | Old value | Undated value | No value |
|---|---|---|---|---|
| `patient.gestational_age_weeks` | Opens the windowed stages; picks the look-back band and the hemoglobin threshold | n/a (sent per session) | n/a | **Asked once**; every gate reading it is held |
| `patient.rh_factor` | "negative" → hand-off step; "positive" → nothing | n/a | n/a | **Asked once** (SELECT negative / positive) unless an Rh-negative Z67 code is on file; "Not available" closes the gate and leaves the typing order |
| Blood pressure (vitals) | ≥140 or ≥90 → hand-off, unless hypertension is already coded | n/a (`DAY`) | Asserted current | **Asked** (systolic, then diastolic); not asked when hypertension is already coded |
| Hemoglobin 718-7 | Below the trimester threshold → anemia hand-off; drawn this pregnancy → no first-panel CBC; since 24 weeks → no repeat CBC | **Still decides the hand-off** (most recent, `LIFETIME`) `[DECISION — Josh 2026-10-04]`; does not count as this pregnancy's CBC, so the CBC is ordered | Counts as current | **Asked**, and the CBC is ordered meanwhile; "Not available" leaves the order and blocks nothing |
| HbA1c 4548-4 (before 24 weeks) | ≥6.5 → overt diabetes; 5.9–6.4 → early abnormal glucose; normal → nothing | **Still decides** (most recent, `LIFETIME`): an HbA1c ≥6.5 is diabetes whenever it was drawn. An old one does not count as this pregnancy's test, so the eligibility question is asked as well | Counts as current | **Asked**; the eligibility question is asked beside it; "Not available" + "yes" → ordered (D-29) |
| 50-g challenge 1504-0 (from 24 weeks) | <140 → screening complete; ≥140 → the 100-g test (after the strategy question, §0.6 #2) | Older than 140 days: not this pregnancy's screen, ignored `[WINDOW]` | Counts as current | Screening is open: strategy asked; two-step → ordered, and the result is **asked for**; "Not available" leaves the order (D-29) |
| 75-g values 1552-9 / 1507-3 / 1518-0 | All three below threshold → complete; any at or above → diagnose GDM | As the 50-g | Counts as current | As the 50-g; only the fasting value is asked for at the ordering visit, the 1-h and 2-h once the fasting value is on file |
| 100-g values | **Not read** (D-4: a question) | — | — | The question offers "Not resulted yet", which orders the test |
| Diabetes code O24.- | Diagnosed: no screening, no question | Lifetime, active | Active | Not diagnosed (a definite answer; nothing asked) |
| Anemia O99.01x / D50, hypertension R03.0 / O10 / O11 / O13 / O14 / O16, Rh-negative Z67.x1 | Closes that hand-off | Lifetime, active | Active | Hand-off can open |
| GBS carrier O99.820 | No 36-week culture | Lifetime, active | Active | Culture ordered if none in 5 weeks |
| Each panel lab (§3 table) | On file → not ordered | Outside the look-back → ordered again (this pregnancy's test is required); type, hemoglobinopathy and HBV antibodies count **forever** | Counts as on file | Ordered |
| Medication list: folic acid, aspirin | On it → "continue", nothing started; aspirin eligibility not asked | Lifetime, active only (a stopped one does not count) | Active | Vitamin started; aspirin eligibility asked (before 28 weeks) |

**Not read from the chart, and why** (§0.6 #9): imaging results, immunization records, age,
risk factors, the season. The vaccines therefore carry no medication-list check: an
immunization is not a medication-list entry, and the context has no immunization field. The
medication list *is* read for the two medications that live on it.

**"This pregnancy"** `[NOT ENCODABLE]` (§0.6 #3) `[JOSH — CONFIRM]`. Built as one nested `OR`
of three `AND` bands on one datum:

```
OR( AND(GA < 14,              none in the last  98 days),
    AND(GA >= 14, GA < 28,    none in the last 196 days),
    AND(GA >= 28,             none in the last 300 days) )
```

Because the band is as long as the trimester, a result drawn up to 14 weeks before conception
counts as this pregnancy's. A missing GA is asked for (the same question as the GA gates),
unless the test is on file inside the shortest band, in which case the gate is already closed.

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
the content. The design is unchanged from the 2026-09-24 draft; the current spec offers nothing better
(the simulator sends `gestational_age_weeks` and `trimester`).

### Initial-panel "not on file" gates (all attached to `step-1-3`)

All conditions are `labs` / `not_includes_code` / LOINC with a `display`.

| Gate | Type | Absent | Look-back | On unresolved | Branches to |
|---|---|---|---|---|---|
| `gate-cbc-due` | compound OR (this-pregnancy bands) | 718-7 | this pregnancy | ask (GA) | `step-1-10` |
| `gate-abo-rh-due` | patient_attribute | 882-1 | `LIFETIME` | default | `step-1-11` |
| `gate-antibody-screen-due` | compound OR | 890-4 | this pregnancy | ask | `step-1-12` |
| `gate-rubella-due` | compound OR | 25514-1 | this pregnancy | ask | `step-1-13` |
| `gate-syphilis-due` | compound OR | 20507-0 AND 22587-0 | this pregnancy | ask | `step-1-14` |
| `gate-hbsag-due` | compound OR | 5196-1 AND 5195-3 | this pregnancy | ask | `step-1-15` |
| `gate-hbv-triple-due` | compound AND | 16935-9 AND 16933-4 | `LIFETIME` | default | `step-1-16` |
| `gate-hiv-due` | compound OR | 56888-1 | this pregnancy | ask | `step-1-17` |
| `gate-hcv-due` | compound OR | 13955-0 | this pregnancy | ask | `step-1-18` |
| `gate-urine-culture-due` | compound OR | 630-4 | this pregnancy | ask | `step-1-19` |
| `gate-ct-gc-due` | compound OR | 21613-5 AND 21416-3 | this pregnancy | ask | `step-1-20` |
| `gate-hgbpathy-due` | patient_attribute | 43113-0 | `LIFETIME` | default | `step-1-21` |
| `gate-varicella-due` | compound OR | 19162-7 | this pregnancy | ask | `step-1-22` |

- "Ask" here can only ever ask for the gestational age; a membership condition never asks for
  a lab.
- **What "already done" means per test** `[JOSH — CONFIRM]`: blood type, hemoglobinopathy
  evaluation and the HBV antibodies once ever; everything else this pregnancy. Rubella and
  varicella immunity are re-tested each pregnancy as built (presence of a test is readable;
  "immune" is not — the result is qualitative). The hepatitis B triple panel is "never
  documented" (`[DECISION — Josh 2026-10-04]`, conflict C2); its other two triggers
  (incomplete vaccine series, ongoing risk) are text in Step 1.16.
- An **old** value outside the look-back is not used for the "done" decision: the guideline
  wants the test in this pregnancy. It is never asked about.
- Proved: `gate-proof.ts prenatal-meds` (empty chart → all 13 ordered; all on file → none; an
  HIV test 200 days old at 10 weeks → ordered; a blood type 5 years old → not ordered).

### `gate-hgb-low` — Low hemoglobin: anemia hand-off `[DECISION — Josh 2026-10-04]`

- **Attached to:** `step-1-3` · **Branches to:** `step-1-23` (exclusively gated)
- **Type:** compound **AND** · **On unresolved: ask**
- **Conditions:**
  - `conditions` `not_includes_code` `O99.01.*` (ICD-10, `LIFETIME`, active);
  - `conditions` `not_includes_code` `D50.*`;
  - group **OR**:
    - `labs` `718-7` `less_than` **10.45**, `LIFETIME`, display `"Hemoglobin (g/dL)"`;
    - group **AND**: `718-7` `less_than` **10.95**, `LIFETIME`; group **OR**: GA `less_than`
      14, GA `greater_or_equal` 28.
- **Reads the MOST RECENT hemoglobin, with no freshness window** (Josh's instruction; the
  spec's data-use rule 1). Staleness is handled separately by the CBC gates.
- **States:** below threshold → hand-off; normal → nothing; none on file → asked (and the CBC
  is ordered by `gate-cbc-due`); "Not available" → closed, order stays, nothing blocks;
  hemoglobin 10.5–10.9 with GA missing → GA asked; anemia already coded → closed, nothing
  asked.
- "<11.0" is `less_than 10.95` and "<10.5" is `less_than 10.45` (0.1 g/dL precision), the
  anemia pathway's numbers.
- **Thresholds** `[PAYWALL]` `[JOSH — CONFIRM]` (Step 1.23).
- `[JOSH — CONFIRM]` Because the most recent value decides however old it is, a low
  hemoglobin from before this pregnancy opens the hand-off (with the CBC ordered beside it).
- **Rationale & source:** [1][2] → Step 1.3. Proved: `gate-proof.ts prenatal-handoffs`.

### `gate-rh-negative` — Rh(D) negative: hand-off (D-24) `[DECISION — Josh 2026-10-04]`

- **Attached to:** `step-1-3` · **Branches to:** `step-1-24` (exclusively gated)
- **Type:** compound **AND** · **On unresolved: ask**
- **Conditions:**
  - `patient.rh_factor` `in` `["negative", "positive"]`, display `"Rh(D) type"` — true for
    either known type; present so that the SELECT question offers both answers (§0.6 #5);
  - `patient.rh_factor` `equals` `"negative"`;
  - `conditions` `not_includes_code` for each of `Z67.11`, `Z67.21`, `Z67.31`, `Z67.41`,
    `Z67.91` (`LIFETIME`, active).
- **States:** negative → hand-off; positive → nothing (no step); missing → ONE SELECT question
  with both options; an Rh-negative Z67 code on file → closed without asking; "Not available"
  → closed, and `gate-abo-rh-due` still orders the typing.
- **Vocabulary risk** `[JOSH — CONFIRM]`: the chart feed must populate `rh_factor` with exactly
  `"negative"` / `"positive"`. Any other string evaluates as neither.
- **There is no Rh-positive step and no RhIG** (§0.9).
- **Rationale & source:** [21][22] → Step 1.3. Proved: `gate-proof.ts prenatal-handoffs`.

### Aspirin: `gate-on-aspirin`, `gate-aspirin-not-on-list`, `gate-aspirin-indicated`

- **`gate-on-aspirin`** — attached to `step-1-6` → `step-1-25`. compound **OR**:
  `medications` `includes_code` RXNORM `1191`, `243670`, `318272` (`LIFETIME`, active). On
  unresolved: n/a — default.
- **`gate-aspirin-not-on-list`** — attached to `step-1-6` → `step-1-26`. compound **AND**:
  `not_includes_code` for the same three codes; GA `less_than` 28. **On unresolved: ask**
  (GA).
  - `[JOSH — CONFIRM]` **The 28-week bound is new.** The draft asked eligibility at every
    visit. Prophylaxis is started at 12–28 weeks [18][19], so past 28 weeks the question
    cannot lead to a start and is not asked.
- **`gate-aspirin-indicated`** — attached to `step-1-26` → `step-1-7`. question, **BOOLEAN**.
  Prompt **verbatim** from GHTN's gate of the same id (§0.4):
  > "Does this patient qualify for low-dose aspirin prophylaxis? Qualifies with ANY ONE
  > high-risk factor (prior preeclampsia, multifetal gestation, chronic hypertension,
  > pregestational type 1 or 2 diabetes, kidney disease, autoimmune disease such as SLE or
  > antiphospholipid syndrome); OR TWO OR MORE moderate-risk factors (nulliparity, BMI >30,
  > family history of preeclampsia in mother or sister, Black race, lower income, age 35 or
  > older, personal history factors, in vitro conception); OR, on its own, Black race or lower
  > income."
  - Still a question: several factors are uncoded (family history, income, nulliparity, race)
    and the rule counts.
- **Rationale & source:** [17][18][19] → Step 1.6. Proved: `gate-proof.ts prenatal-meds`.

### Folic acid: `gate-no-folic-acid`, `gate-on-folic-acid`

- **`gate-no-folic-acid`** — attached to `step-1-8` → `step-1-27`. compound **AND**:
  `medications` `not_includes_code` RXNORM `4511`, `198640`, `310410` (`LIFETIME`, active).
  Default.
- **`gate-on-folic-acid`** — attached to `step-1-8` → `step-1-28`. compound **OR**: the same
  three codes, `includes_code`. Default.
- `[JOSH — CONFIRM]` **A prenatal multivitamin coded as a branded product is not recognised.**
  RxNorm has no ingredient for "prenatal vitamins", only product-level codes, and
  `includes_code` does not expand a product to its ingredients. The three codes are folic acid
  itself. A patient on a product-coded prenatal vitamin is offered one again.
- **Rationale & source:** [28][65][66] → Step 1.8. Proved: `gate-proof.ts prenatal-meds`.

### `gate-bp-elevated` — BP at or above 140/90 today (D-25) `[DECISION — Josh 2026-10-04]`

- **Attached to:** `step-2-1` · **Branches to:** `step-2-2` (exclusively gated)
- **Type:** compound **AND** · **On unresolved: ask**
- **Conditions:**
  - group **OR** (coded, `field: vitals`, **no `system`**, horizon **DAY**): `systolic_bp`
    `greater_than` **139.9**, display `"Systolic BP (mmHg)"`; `diastolic_bp` `greater_than`
    **89.9**, display `"Diastolic BP (mmHg)"` — the same two leaves as GHTN's gate;
  - `conditions` `not_includes_code` for each of `R03.0`, `O10.*`, `O11.*`, `O13.*`,
    `O14.*`, `O16.*` (`LIFETIME`, active).
- **New since the draft:** the hypertension-already-coded guard, so the hand-off is not
  repeated once the diagnosis is on file.
- **Rationale & source:** [16] → Step 2.1. Proved: `gate-proof.ts prenatal-handoffs`.

### Early diabetes testing (D-6, D-7, D-29)

Anemia's pattern, exactly: two threshold gates that ask, and a membership gate on the absence
that leads to the order — all three siblings on the unconditional Step 4.1.

- **`gate-overt-diabetes`** — `step-4-1` → `step-4-3`. patient_attribute: `labs` `4548-4`
  `greater_than` **6.49**, `LIFETIME`, display `"Hemoglobin A1c (%)"`. **On unresolved: ask.**
- **`gate-early-abnormal-glucose`** — `step-4-1` → `step-4-4`. compound **AND**: `4548-4`
  `greater_than` **5.89**; `4548-4` `less_than` **6.5**; both `LIFETIME`. **Ask.** Same
  datum, one question. Mutually exclusive with the gate above at 0.1% precision.
- **`gate-a1c-not-on-file`** — `step-4-1` → `step-4-6`. compound **OR** of two bands:
  AND(GA < 14, `not_includes_code` 4548-4 within 98 days); AND(GA ≥ 14, none within
  196 days). **Ask** (GA). Stage 4 is itself behind GA < 24.
- **`gate-early-testing-indicated`** — `step-4-6` → `step-4-2`. question, **BOOLEAN**:
  > "Does this patient meet criteria for early testing for undiagnosed diabetes? Criteria: BMI
  > 25 or higher (23 or higher if Asian ancestry) PLUS at least one of: first-degree relative
  > with diabetes; high-risk race, ethnicity or ancestry; history of cardiovascular disease;
  > hypertension; HDL below 35 or triglycerides above 250; polycystic ovary syndrome; physical
  > inactivity; other insulin-resistance conditions (e.g., acanthosis nigricans). OR,
  > regardless of BMI: prediabetes (A1C 5.7% or higher) or gestational diabetes in a prior
  > pregnancy. (ADA also advises considering early testing for all patients.)"
- **States:** HbA1c on file this pregnancy → read, no question, no order. None → the value is
  asked for AND eligibility is asked; "Not available" + yes → HbA1c ordered, nothing blocks,
  read at the next visit; a value typed in → read at once, and the eligibility question
  closes.
- `[JOSH — CONFIRM]` **Every patient before 24 weeks with no HbA1c on file is asked for one**,
  eligible or not. The value gates must sit outside the eligibility question so that an HbA1c
  on file is never hidden by a "no"; the engine cannot make them ask only after a "yes"
  (§0.6 #2, the same constraint).
- `[JOSH — CONFIRM]` The thresholds read the most recent HbA1c however old (an HbA1c ≥6.5% is
  diabetes whenever drawn). The draft used a 90-day window.
- `[GAP]` The ACOG CPU 2024 risk-factor table is paywalled; the prompt uses ADA Table 2.5.
- **Rationale & source:** [52][55][56] → Step 4.1. Proved: `gate-proof.ts prenatal-gdm`.

### `gate-cbc-repeat-due` — 24–28-week CBC

- **Attached to:** `step-6-1` · **Branches to:** `step-6-5` · compound **OR**, **ask** (GA):
  AND(GA < 28, no 718-7 within 28 days); AND(GA ≥ 28, GA < 32, none within 56 days);
  AND(GA ≥ 32, GA < 36, none within 84 days); AND(GA ≥ 36, none within 126 days).
- "Since about 24 weeks": each band reaches back to 24 weeks from its upper edge, so a
  hemoglobin drawn up to 4 weeks before 24 weeks can count `[NOT ENCODABLE]` (§0.6 #3).
- **Rationale & source:** [1][2] → Step 6.1. Proved: `gate-proof.ts prenatal-handoffs`.

### GDM status from 24 weeks (D-22, D-5, D-29) `[DECISION — Josh 2026-10-04]`

**The new shape.** The draft asked one SELECT at every visit from 24 weeks (not screened
two-step / one-step / screened negative / already diagnosed). Three of those four are now read
from the chart, on Step 6.2:

| Chart state | Gate | Opens | Asked |
|---|---|---|---|
| A diabetes code (O24.-) on the problem list | `gate-diabetes-on-file` | Step 6.4 "already diagnosed: no screening" | nothing |
| No diabetes code, and a negative screen on file (50-g <140, or all three 75-g values below threshold) | `gate-gdm-screen-negative` | Step 6.3 "screening complete" | nothing |
| No diabetes code and no negative screen (nothing on file; or a 50-g ≥140; or a 75-g value at or above threshold; or an incomplete 75-g test) | `gate-gdm-screen-open` | Step 6.6 → the strategy question | the strategy |

The second and third are exact complements (De Morgan, leaf by leaf), so exactly one is open
for every patient without a diabetes code.

Behind the strategy question, each strategy's stage has the anemia pattern: a membership gate
on the absence that opens the **order** step, beside a threshold gate that **asks** for the
result.

| Visit | What happens |
|---|---|
| Nothing on file | Strategy asked → two-step → 50-g ordered (Step 7.5), result asked for → **"Not available"**: order stays, nothing blocks, plan generates |
| Same visit, result typed in: 121 | Read at once: screening complete (Step 6.3); the order and the strategy question close |
| Same visit, result typed in: 155 | Read at once: the 50-g order closes, Step 7.2 opens, the 100-g question is asked |
| Next visit, 50-g 118 on file | Screening complete; nothing asked |
| Next visit, 50-g 152 on file | Strategy asked (§0.6 #2), then the 100-g question: "Not resulted yet" → 100-g ordered, O99.810; "Meets" → diagnose GDM; "Does not meet" → Step 7.4 |
| O24.410 on file | No screening, nothing asked |

All of it is proved in `gate-proof.ts prenatal-gdm`, in both edge orders.

- **`gate-diabetes-on-file`** — `step-6-2` → `step-6-4`. patient_attribute: `conditions`
  `includes_code` `O24.*` (ICD-10, `LIFETIME`, active). Default.
  - `[JOSH — CONFIRM]` `O24.*` is every diabetes-in-pregnancy code, gestational and
    pre-existing. A GDM code left **active** on the problem list from a previous pregnancy
    would read as diagnosed.
- **`gate-gdm-screen-negative`** — `step-6-2` → `step-6-3`. compound **AND**:
  `not_includes_code` `O24.*`; group **OR**: `1504-0` `less_than` **139.9**; group **AND**:
  `1552-9` `less_than` **91.9**, `1507-3` `less_than` **179.9**, `1518-0` `less_than`
  **152.9**. All labs horizon `{days: 140}`.
  - **On unresolved: default.** `[ON-UNRESOLVED DEFAULT — gate-gdm-screen-negative]` A missing
    value here means "not screened", which is `gate-gdm-screen-open`'s case; asking would put
    a 50-g question and a 75-g question to every unscreened patient before the strategy is
    known.
  - `[WINDOW — gate-gdm-screen-negative: a glucose screen from a previous pregnancy is meaningless for this one. 140 days (20 weeks) reaches back to 24 weeks from any gestational age up to 44 weeks and, at 24 weeks, no further than 4 weeks of this pregnancy]`
- **`gate-gdm-screen-open`** — `step-6-2` → `step-6-6`. compound **AND**: `not_includes_code`
  `O24.*`; group **OR**: `not_includes_code` `1504-0`, `1504-0` `greater_than` **139.9**;
  group **OR**: for each of `1552-9` / `1507-3` / `1518-0`, `not_includes_code` and
  `greater_than` **91.9** / **179.9** / **152.9**. Horizon `{days: 140}`. **Ask** (it can
  only be unresolved on two undated results for one code).
  - `[WINDOW — gate-gdm-screen-open: the complement of gate-gdm-screen-negative, on the same window]`
- **`gate-gdm-strategy`** — attached to `step-6-6`. **Router**, question, **SELECT** (D-5):

  | Option (exact string) | Target |
  |---|---|
  | `"Two-step: 50-g 1-hour challenge, then a 100-g 3-hour test if it is 140 mg/dL or higher"` | `stage-7` |
  | `"One-step: 75-g 2-hour test"` | `stage-8` |

  Prompt:
  > "Gestational diabetes screening for this patient: two-step (50-g 1-hour challenge, then a
  > 100-g 3-hour test if it is 140 mg/dL or higher) or one-step (75-g 2-hour test)? If a 50-g
  > result is already on file, the two-step strategy is under way."
- **`gate-gct-not-on-file`** — `step-7-1` → `step-7-5`. patient_attribute: `labs`
  `not_includes_code` `1504-0`, `{days: 140}`. Default.
- **`gate-gct-positive`** — `step-7-1` → `step-7-2` `[DECISION D-3 — Josh 2026-09-24]`.
  patient_attribute: `1504-0` `greater_than` **139.9**, `{days: 140}`, display `"Glucose 1 h
  post 50 g glucose (mg/dL)"`. **On unresolved: ask** (D-29).
  - `[WINDOW — gate-gct-positive: as gate-gdm-screen-negative — this pregnancy's screen only]`
  - `[GAP]` A 50-g value ≥200 treated as diagnostic: no accessible US source. Not built.
- **`gate-100g-diagnostic`** — attached to `step-7-2`. **Router**, question, **SELECT**
  `[DECISION D-4 — Josh 2026-09-24]`:

  | Option (exact string) | Target |
  |---|---|
  | `"Not resulted yet"` | `step-7-6` (orders the 100-g test; O99.810) |
  | `"Meets criteria: two or more values at or above threshold"` | `step-7-3` (diagnose GDM) |
  | `"Does not meet criteria: fewer than two values at or above threshold"` | `step-7-4` |

  Prompt:
  > "100-g 3-hour glucose tolerance test (Carpenter-Coustan thresholds: fasting 95, 1-hour
  > 180, 2-hour 155, 3-hour 140 mg/dL): not resulted yet; meets criteria (two or more values
  > at or above threshold); or does not meet criteria?"
  - **Changed from the draft's BOOLEAN**: a question gate has no "Not available", so at the
    visit that orders the 100-g test a yes/no question could only be answered "no", which
    also meant "not diabetes". "Not resulted yet" is the D-29 answer for this gate, and the
    order sits behind it so it is not re-ordered once resulted.
  - `[JOSH — CONFIRM]` This question recurs at every visit for a patient with a positive
    50-g challenge until O24.4x is coded — including after a normal 100-g test, because
    nothing in the chart records that conclusion (§0.6 #1).
- **`gate-ogtt75-not-on-file`** — `step-8-1` → `step-8-3`. compound **AND**:
  `not_includes_code` `1552-9`, `1507-3`, `1518-0`, `{days: 140}`. Default.
- **`gate-75g-diagnostic`** — `step-8-1` → `step-8-2`. compound **OR**, **ask**: `1552-9`
  `greater_than` **91.9**; group **AND**: `includes_code` `1552-9`; group **OR**: `1507-3`
  `greater_than` **179.9**, `1518-0` `greater_than` **152.9**. Horizon `{days: 140}`.
  - The inner group makes the gate ask for **one** value at the ordering visit (the fasting
    one); one "Not available" then closes it. With the fasting value on file it asks for the
    1-hour and 2-hour values.
  - `[WINDOW — gate-75g-diagnostic: as gate-gdm-screen-negative — this pregnancy's screen only]`
- `[JOSH — CONFIRM]` **A screen drawn before 24 weeks is inside the 140-day window.** A 50-g
  challenge at, say, 14 weeks is read at 24 weeks. Positive: correct (PB 180 — go straight to
  the diagnostic test). Negative: read as "screening complete", which is wrong; Step 6.3 and
  Guid-17 say a result drawn before 24 weeks is not the screen and to order it. This pathway
  never orders an early 50-g (D-6), so it arises only from testing done outside it
  `[NOT ENCODABLE]` (§0.6 #3).
- "≥140" is `greater_than 139.9` and "<140" is `less_than 139.9`: complements for every value
  except exactly 139.9, which a whole-number mg/dL result never takes. Likewise 91.9 / 179.9 /
  152.9.
- **Rationale & source:** [53][55][57] → Steps 6.2, 7.1, 7.2, 8.1.

### Third-trimester rescreen gates (all attached to `step-9-5`)

compound **OR**, **ask** (GA). Bands: AND(GA < 32, none within 35 days); AND(GA ≥ 32, GA < 37,
none within 70 days); AND(GA ≥ 37, none within 105 days). Stage 9 is behind GA ≥ 27.

| Gate | Absent | Branches to |
|---|---|---|
| `gate-syphilis-rescreen-due` | 20507-0 AND 22587-0 | `step-9-7` |
| `gate-hiv-rescreen-due` | 56888-1 | `step-9-8` |
| `gate-ct-gc-rescreen-due` | 21613-5 AND 21416-3 | `step-9-9` |

HIV and chlamydia/gonorrhea rescreening are risk-based; risk is not in the chart, so the order
appears for every patient with "if at risk" in its name. **Source:** [8][10][11][15] → Step 9.5.

### `gate-gbs-culture-due`

- **Attached to:** `step-11-1` · **Branches to:** `step-11-4` · compound **AND**, default:
  `labs` `not_includes_code` `72607-5` within **35 days**; `not_includes_code` `91875-5`
  within 35 days; `conditions` `not_includes_code` `O99.820`.
- 35 days is the result's validity (CO 797: valid 5 weeks), so an expired culture is ordered
  again.
- **Rationale & source:** [20] → Step 11.1. Proved: `gate-proof.ts prenatal-meds`.

## 5. Medications

Six Medication nodes. No `ESCALATES_TO`. The medication list is read before the two
medications that live on it are started (§4b); the four vaccines are not on a medication list
and the context has no immunization field (§0.6 #9).

`[NO MEDICATION CHECK — influenza, COVID-19, Tdap and RSV vaccines: the patient context (PatientContext) has conditions, medications, labs, allergies, vitals and patient attributes, and no immunization field; the pathway's vaccine codes are CPT administration codes, which a medication list does not hold. Each vaccine step says to confirm what has already been given. A prior RSV vaccine, given once in a lifetime, is the case this misses]`
`[JOSH — CONFIRM]` (J20).

- **Med-1 — Prenatal vitamin with folic acid 0.4–0.8 mg** (on Step 1.27, behind
  `gate-no-folic-acid`)
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
- **Med-3 — Influenza vaccine, inactivated or recombinant** (on Step 1.9): first_line,
  `influenza-immunization`; one dose IM per season; CPT 90656, 90673. [24][25][27]
- **Med-4 — COVID-19 vaccine (current-season formulation)** (on Step 1.9) `[DECISION D-26 —
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
- **Med-5 — Tdap vaccine** (on Step 9.1): first_line, `pertussis-immunization`; one dose IM
  each pregnancy, early in the 27–36-week window; CPT 90715. [24][25]
- **Med-7 — RSV vaccine, RSVpreF (Abrysvo)** (on Step 10.1): first_line,
  `rsv-maternal-immunization`; one dose IM at 32 0/7–36 6/7 weeks in season, once in a
  lifetime; CPT 90678. [25][26]

**Removed:** Med-6 Rho(D) immune globulin `[DECISION — Josh 2026-10-04]` (§0.9). The id
`med-6` is left unused.

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
| Lab-20 | 7.5 | 50-g 1-hour glucose challenge — gestational diabetes screen, two-step (no result on file) | 1504-0 | 82950 | [53][55][57] |
| Lab-21 | 7.6 | 100-g 3-hour glucose tolerance test — diagnostic test after a positive 50-g challenge | 50608-9; 1549-5, 1501-6, 1514-9, 1530-5 | 82951, 82952 | [53][55][57] |
| Lab-22 | 8.3 | 75-g 2-hour glucose tolerance test — gestational diabetes screen, one-step (no result on file) | 1552-9; 1507-3, 1518-0 | 82951 | [55][57] |
| Lab-24 | 9.7 | Syphilis serology — third-trimester rescreen, every patient (none since 27 weeks) | 20507-0; 22587-0 | 86592, 86780 | [7][8] |
| Lab-25 | 9.8 | HIV-1/2 antigen and antibody — third-trimester rescreen if at risk (none since 27 weeks) | 56888-1 | 87389 | [10][11] |
| Lab-26 | 9.9 | Chlamydia and gonorrhea NAAT — third-trimester rescreen if under 25 or at risk (none since 27 weeks) | 21613-5; 21416-3 | 87491, 87591 | [15] |
| Lab-27 | 11.4 | Group B streptococcus vaginal-rectal culture — 36-37-week screen (no valid result on file) | 72607-5 | 87081 | [20] |

- **Removed:** Lab-18 fasting plasma glucose (D-6: HbA1c only) and Lab-23 repeat antibody
  screen for Rh-negative patients (§0.9). Their ids are left unused.
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

23 Guidance nodes. Each was checked against the spec's "guidance says what the order lines
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

Edited or new on 2026-10-04 (exact node text):

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
- **Guid-10 — `Already taking folic acid: check what the supplement contains`** (Step 1.28),
  education: "A folic acid supplement is already on the medication list, so none is started.
  Confirm it supplies 400-800 mcg of folic acid a day, with iron and iodine, and that the
  labelled dose is not exceeded." [28][65][66][67]
- **Guid-11 — `Already on low-dose aspirin: continue it`** (Step 1.25), education: "Aspirin is
  already on the medication list. Continue 81 mg daily until delivery; do not add a second
  prescription. It is exempt from the advice to avoid NSAIDs from 20 weeks." [17][18][19][64]
- **Guid-12 — `Low hemoglobin: what happens next`** (Step 1.23), education: "The most recent
  hemoglobin is below the screening threshold for this trimester (11.0 g/dL in the first and
  third, 10.5 g/dL in the second). Add anemia complicating pregnancy to the problem list so
  the anemia pathway can guide the workup and treatment. Routine prenatal care continues
  unchanged." [1][2]
- **Guid-13 — `Rh(D)-negative: what routine care does not cover`** (Step 1.24), education:
  "This pathway recommends no Rh immune globulin. Record the Rh-negative blood type on the
  problem list and manage Rh prophylaxis under the Rh-negative plan of care." [21][22]
- **Guid-14 — `Elevated blood pressure: what happens next`** (Step 2.2), education: "Today's
  blood pressure is 140/90 or higher. Repeat it. If it stays elevated, add the diagnosis to
  the problem list (R03.0 until confirmed; gestational hypertension or preeclampsia once
  confirmed) so the hypertension in pregnancy pathway can guide the evaluation. Urine protein
  is tested only when preeclampsia is suspected, not routinely." [16]
- **Guid-15 — `A1c in the diabetes range: what happens next`** (Step 4.3), education: "The
  hemoglobin A1c is 6.5% or higher, which means diabetes that was present before pregnancy.
  Confirm it with a second test unless the result is unequivocal, then add pre-existing
  diabetes in pregnancy to the problem list. No gestational diabetes screening is needed once
  it is recorded." [55]
- **Guid-16 — `Diabetes on the problem list: screening is not repeated`** (Step 6.4),
  education: "Diabetes in pregnancy is already on the problem list, so no glucose screening
  test is ordered. Glucose management follows the diabetes plan of care; routine prenatal
  care continues unchanged." [55][56]
- **Guid-17 — `What a negative glucose screen settles`** (Step 6.3), education: "The glucose
  screening result on file is negative, so gestational diabetes screening is complete and is
  not repeated. Retest only on clinical suspicion: new glycosuria, a fetus measuring large,
  or excess amniotic fluid. If the result on file was drawn before 24 weeks it is not the
  screen; order the screening test." [53][55]
- **Guid-18 — `A positive challenge with a normal 3-hour test`** (Step 7.4), education: "The
  3-hour test did not meet the criteria for gestational diabetes, so no diabetes diagnosis is
  made and screening is not repeated unless there is a new clinical reason. Remove O99.810
  only if it no longer describes the pregnancy." [53][55]

`[JOSH — CONFIRM]` the wording of Guid-10 to Guid-18: they are the builder's sentences for
the hand-off and "already on it" steps, written from the brief's own step text.

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
| Sched-4 | Step 9.1 | "27-36 weeks, early in the window, every pregnancy" | Tdap | [24][25] |
| Sched-6 | Step 10.1 | "32 0/7-36 6/7 weeks, in season" | Maternal RSV vaccine. ACOG September 1 to March 1; CDC September through January | [25][26] |
| Sched-7 | Step 11.4 | "36 0/7-37 6/7 weeks" | GBS culture; valid 5 weeks | [20] |
| Sched-8 | Step 12.1 | "Once or twice weekly from 41 0/7 weeks until delivery" | Late-term surveillance | [46] |

Sched-5 (RhIG) is removed (§0.9).

## 12. Prerequisites (REQUIRES)

One pair, because a prerequisite with no `satisfaction_check` always surfaces as catch-up
(§0.6 #6):

- `step-5-1` REQUIRES `step-1-1`: the anatomy survey dates a pregnancy not yet dated [3].

Dropped on 2026-10-04: `step-9-3 → step-1-3` (RhIG, §0.9); and the three GDM pairs
(`7-2 → 7-1`, `7-3 → 7-2`, `8-2 → 8-1`), which are now structural — each dependent step sits
behind a gate hosted on its prerequisite.

## 13. Code entries

One CodeEntry node per code, shared by its hosts (CodeEntry nodes are exempt from the
one-node-per-host rule; anemia does the same). 77 nodes.

**Condition codes on steps:**

| Code | System | Description | Attached to |
|---|---|---|---|
| Z34.00 | ICD-10 | Supervision of normal first pregnancy, unspecified trimester | Step 1.1 |
| O99.01 | ICD-10 | Anemia complicating pregnancy (O99.011 / .012 / .013 by trimester) | Step 1.23 |
| Z67.91 | ICD-10 | Unspecified blood type, Rh negative | Step 1.24 |
| R03.0 | ICD-10 | Elevated blood-pressure reading, without diagnosis of hypertension | Step 2.2 |
| O24.111, O24.112, O24.113, O24.119 | ICD-10 | Pre-existing type 2 diabetes mellitus, in pregnancy | Step 4.3 |
| O99.810 | ICD-10 | Abnormal glucose complicating pregnancy | Step 7.6 |
| O24.410 | ICD-10 | Gestational diabetes mellitus in pregnancy, diet controlled | Step 7.3, Step 8.2 |

**Lab codes:** each LabTest carries the LOINC and CPT codes in its §6 row.
**Imaging:** 76801, 76817 (Img-1); 76813 (Img-2); 76805 (Img-3). **Procedures:** 59025
(Proc-1); 76818 (Proc-2); 59412 (Proc-3).

**Medication codes:** RXNORM 4511 (Med-1); RXNORM 1191, 243670 (Med-2); CPT 90656, 90673
(Med-3); CPT 90715 (Med-5); CPT 90678 (Med-7). RXNORM 35465 (RhIG) is removed.

Codes read by gates but not emitted as CodeEntry nodes: RXNORM 198640, 310410, 318272;
ICD-10 Z67.11 / .21 / .31 / .41, O24.\*, O99.01.\*, D50.\*, O10–O16, O99.820; LOINC 718-7,
5195-3, 91875-5 (§0.8).

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
the 71 references are cited by a node. [23] (the RhoGAM label) is cited by nothing now and is
not emitted; it stays in §15 for the Rh-negative pathway.

**Stages:** 1: [1][2][3] · 2: [1][16][50] · 3: [3][4] · 4: [52][55][56] · 5: [1][4] ·
6: [1][53][57] · 7: [53][54][55][57] · 8: [55][57] · 9: [1][8][24][44] · 10: [24][25][26] ·
11: [1][20][44][48][62] · 12: [46][47]

**Steps:**
- 1.1: [1][3][59][71] · 1.2: [1][2][46][49] · 1.3: [1][2][6][7][9][10][11][12][13][14][15][21][22]
- 1.10: [1][2] · 1.11: [2][22] · 1.12: [2][22] · 1.13: [2] · 1.14: [7][8] · 1.15: [9] ·
  1.16: [9] · 1.17: [10][11] · 1.18: [12] · 1.19: [13][14] · 1.20: [15] · 1.21: [6] · 1.22: [2]
- 1.23: [1][2] · 1.24: [21][22]
- 1.4: [1][29][30][31][32][33][34][35][61] · 1.5: [4][5][6][63] · 1.6, 1.25, 1.26: [17][18][19]
  · 1.7: [17][18][19][64]
- 1.8: [28][36][37][38][39][40][41][45][51][64][65][66][67][68] · 1.27, 1.28: [28][65][66][67]
  · 1.9: [24][25][27]
- 2.1, 2.2: [16] · 2.3: [1][2][50] · 2.4: [1][2]
- 3.1: [3] · 3.2: [4]
- 4.1, 4.6: [52][55][56][58] · 4.2: [52][55] · 4.3: [55] · 4.4: [52][55][56] · 4.5: [53][55][57]
- 5.1: [1][3][4] · 5.2: [4]
- 6.1, 6.5: [1][2] · 6.2, 6.6: [53][55][57] · 6.3: [53] · 6.4: [55][56]
- 7.1: [53][54][55][57] · 7.5: [53][55][57] · 7.2, 7.6: [53][55][57][58] · 7.3: [53][55][56] ·
  7.4: [53][55]
- 8.1, 8.3: [55][57] · 8.2: [55][56]
- 9.1: [24][25][26][27][60] · 9.5: [8][10][11][15] · 9.7: [7][8] · 9.8: [10][11] · 9.9: [15] ·
  9.6: [29][31][42][43][44][59]
- 10.1: [24][25][26] · 11.1, 11.4: [20] · 11.2: [1][48] · 11.3: [47][49][62] · 12.1: [46][47]

**Medications:** Med-1: [28][65][66][67] · Med-2: [17][18][19][64] · Med-3: [24][25][27] ·
Med-4: [24][25] · Med-5: [24][25] · Med-7: [25][26]

**Labs:** as the Source column of §6. **Imaging:** Img-1: [3] · Img-2: [4] · Img-3: [1][4].
**Procedures:** Proc-1, Proc-2: [46] · Proc-3: [48]. **Guidance:** as listed in §9.

**Gate evidence on host steps:** GA gates → 1.1; panel gates, `gate-hgb-low`,
`gate-rh-negative` → 1.3; aspirin gates → 1.6 / 1.26; folic acid gates → 1.8;
`gate-bp-elevated` → 2.1; early-diabetes gates → 4.1 / 4.6; `gate-cbc-repeat-due` → 6.1; GDM
status gates → 6.2 / 6.6 / 7.1 / 7.2 / 8.1; rescreen gates → 9.5; `gate-gbs-culture-due` → 11.1.
QM-1 → 1.1; QM-2 → 9.1; QM-3 → 1.4; QM-4 → 9.6.

## 17. Temporal horizon & status summary (EMITTED — review carefully)

| Gate(s) | Condition on | horizon | status | Rationale |
|---|---|---|---|---|
| eight `gate-ga-*` | `patient.gestational_age_weeks` | — | — | `patient.*` has no temporal policy |
| every "this pregnancy" gate (`gate-cbc-due`, `-antibody-screen-due`, `-rubella-due`, `-syphilis-due`, `-hbsag-due`, `-hiv-due`, `-hcv-due`, `-urine-culture-due`, `-ct-gc-due`, `-varicella-due`, `gate-a1c-not-on-file`) | labs `not_includes_code` | `{days: 98}` / `{days: 196}` / `{days: 300}` by GA band (A1c: 98 / 196) | — | The trimester's length (§4b) |
| `gate-abo-rh-due`, `gate-hbv-triple-due`, `gate-hgbpathy-due` | labs `not_includes_code` | LIFETIME | — | Done once, ever |
| `gate-hgb-low` | labs 718-7 < 10.45 / < 10.95 | LIFETIME | — | Most recent value decides (Josh) |
| `gate-hgb-low` | conditions O99.01.\*, D50.\* | LIFETIME | active | Already diagnosed |
| `gate-rh-negative` | conditions Z67.11 / .21 / .31 / .41 / .91 | LIFETIME | active | Already recorded |
| `gate-rh-negative` | `patient.rh_factor` | — | — | No temporal policy |
| `gate-on-aspirin`, `gate-aspirin-not-on-list`, `gate-no-folic-acid`, `gate-on-folic-acid` | medications | LIFETIME | active | Currently on it; a stopped medication does not count |
| `gate-bp-elevated` | vitals systolic_bp, diastolic_bp | DAY | — | Today's reading (never ENCOUNTER) |
| `gate-bp-elevated` | conditions R03.0, O10.\*, O11.\*, O13.\*, O14.\*, O16.\* | LIFETIME | active | Already diagnosed |
| `gate-overt-diabetes`, `gate-early-abnormal-glucose` | labs 4548-4 | LIFETIME | — | Most recent value decides |
| `gate-cbc-repeat-due` | labs 718-7 `not_includes_code` | `{days: 28}` / `56` / `84` / `126` by GA band | — | Since about 24 weeks |
| `gate-diabetes-on-file`, `gate-gdm-screen-negative`, `gate-gdm-screen-open` | conditions O24.\* | LIFETIME | active | Diagnosed |
| `gate-gdm-screen-negative`, `gate-gdm-screen-open`, `gate-gct-not-on-file`, `gate-gct-positive`, `gate-ogtt75-not-on-file`, `gate-75g-diagnostic` | labs 1504-0, 1552-9, 1507-3, 1518-0 | `{days: 140}` | — | This pregnancy's screen (`[WINDOW]` markers, §4b) |
| three `gate-*-rescreen-due` | labs `not_includes_code` | `{days: 35}` / `70` / `105` by GA band | — | Since about 27 weeks |
| `gate-gbs-culture-due` | labs 72607-5, 91875-5 | `{days: 35}` | — | Result validity, 5 weeks |
| `gate-gbs-culture-due` | conditions O99.820 | LIFETIME | active | Carrier state |

- No `window_days`; no `status` on labs or vitals; no trend, delta or count operator; no
  `window_from` (no response-to-treatment check in this pathway).
- Every condition carries an explicit horizon except `patient.*` attributes.
- Dated results are needed to exercise the look-back bands; an undated (simulator) result
  counts as current and so as "on file".

## 18. Gaps & fallbacks

### `[JOSH — CONFIRM]` items raised by the 2026-10-04 build

| # | Item | Built as | Where |
|---|---|---|---|
| J1 | Hemoglobin hand-off thresholds (<11.0 first/third trimester, <10.5 second) are secondary-sourced `[PAYWALL]` (PB 233) | As stated | Step 1.23, `gate-hgb-low` |
| J2 | The most recent hemoglobin decides however old — a low value from before this pregnancy opens the hand-off | LIFETIME, per Josh's instruction | `gate-hgb-low` |
| J3 | Rh-negative diagnosis code | Z67.91 (or the ABO-specific Z67.x1); O36.01- only when antibodies are present; O26.89- not used because it displaces Z34 | §0.9, Step 1.24 |
| J4 | `patient.rh_factor` vocabulary: exactly "negative" / "positive" | As stated | `gate-rh-negative` |
| J5 | "This pregnancy" = the trimester's length (98 / 196 / 300 days), so a test up to 14 weeks before conception counts | Nearest supported pattern `[NOT ENCODABLE]` | §4b, §0.6 #3 |
| J6 | What "already done" means per test: type, hemoglobinopathy, HBV antibodies once ever; all others, rubella and varicella included, this pregnancy | As stated | §4b panel table |
| J7 | Strategy question re-asked while a positive 50-g (or abnormal 75-g) awaits its diagnosis, though the result on file shows the strategy | Consequence of D-29's "result gate asks" `[NOT ENCODABLE]`; the alternative is chart-only gates with no result question | §0.6 #2 |
| J8 | The 100-g question recurs each visit for a positive 50-g, including after a normal 100-g test; a six-pair chart encoding is now possible | Question kept (D-4) | §0.6 #1, `gate-100g-diagnostic` |
| J9 | `gate-100g-diagnostic` changed from yes/no to three answers, with "Not resulted yet" ordering the test | SELECT router | §4b |
| J10 | A screen drawn before 24 weeks is inside the 140-day window; a negative early 50-g reads as "complete" | Text in Step 6.3 / Guid-17 | §4b |
| J11 | `O24.*` active from a previous pregnancy reads as diagnosed | As stated | `gate-diabetes-on-file` |
| J12 | Every patient before 24 weeks with no HbA1c is asked for one, eligible or not | Anemia's pattern, per D-29 | §4b early diabetes |
| J13 | The HbA1c thresholds read the most recent value however old (draft: 90 days) | LIFETIME | §4b early diabetes |
| J14 | Aspirin eligibility is asked only before 28 weeks and only of a patient not on aspirin (draft: every visit) | As stated | `gate-aspirin-not-on-list` |
| J15 | A product-coded prenatal multivitamin is not recognised as folic acid | Three folic acid codes | folic acid gates |
| J16 | Trigger option (b): a pregnancy recoded from Z34 to an anemia, hypertension or UTI O-code alone (no O09) stops matching routine care | (b), per Josh | §1 |
| J17 | BP hand-off closes when a hypertension code is on file (new guard) | As stated | `gate-bp-elevated` |
| J18 | Wording of the new Guidance nodes Guid-10 to Guid-18 | Builder's sentences | §9 |
| J19 | Age- and risk-based tests (chlamydia/gonorrhea, HIV rescreen, varicella) appear for every patient with the condition in the name, because age and risk are not in the chart | As stated | §0.6 #9 |
| J20 | Vaccines are not checked against the chart (no immunization field); a prior RSV vaccine is not detected | Step text says to confirm | §5 marker |
| J21 | "Already on a prenatal vitamin" is recognised only as folic acid (RxNorm 4511, 198640, 310410); RxNav returned no usable prenatal-multivitamin concept on 2026-10-04 | As J15 | folic acid gates |

### Not encodable on the josh-dev engine

| # | Requirement | Why not | Built instead |
|---|---|---|---|
| G1 | Carpenter–Coustan "≥2 of 4" | No N-of-M operator (a six-pair nested encoding is possible; not built, J8) | SELECT question (D-4) |
| G2 | Aspirin eligibility | Counting; uncoded factors | BOOLEAN question (verbatim GHTN prompt) |
| G3 | Early-testing eligibility | Counting; BMI not codeable in pregnancy; uncoded factors | BOOLEAN question |
| G4 | Skip the strategy question when a result on file shows the strategy, while still asking for the result of the test just ordered | A question cannot be pre-answered from the chart, and a question and a chart condition cannot OR onto one target | Strategy asked whenever screening is open (§0.6 #2, J7) |
| G5 | "Drawn this pregnancy", "since 24 weeks", "since 27 weeks" | No look-back anchored on the pregnancy | GA-banded look-backs (§0.6 #3, J5) |
| G6 | RSV and influenza seasons | No calendar-month operator | Text |
| G7 | Missed-anatomy-survey catch-up after 24 weeks | REQUIRES has no authorable satisfaction check; imaging is not in the chart | Not encoded |
| G8 | Cross-pathway question dedup (aspirin) | Question gates dedupe only within a pathway | Verbatim prompt |
| G9 | Immunization, imaging, age and risk checks | Not in the patient context | Step text (§0.6 #9) |

Resolved since the draft: the old G4 (negations) and G5 (GBS swab after GBS bacteriuria) are
chart-read with `not_includes_code`; the old G8 (anemia hand-off) is built; the old G6
("unsensitized" before RhIG) left with the RhIG.

### No pathway yet — what Prism does not recommend

- **Rh-negative pregnancy: no pathway.** `[DECISION — Josh 2026-10-04]` Routine prenatal care
  types Rh, runs the antibody screen and says "add the diagnosis". **Until the Rh-negative
  pathway is written, Prism recommends no Rh immune globulin** — not at 28 weeks, not
  postpartum, not after a sensitizing event. Listed in `pathways/TODO.md`; inputs in §0.9.
- `gestational-diabetes-management` exists as a brief only; no JSON.
- No pathway for pregestational / overt diabetes in pregnancy (Step 4.3's destination),
  chronic hypertension before 20 weeks, or adult preventive care after GDM (D-12).

### Source gaps

- **Paywalled `[PAYWALL]`/`[GAP]` primaries:** PB 175 (ultrasound); PB 162 (CVS/amniocentesis
  windows; the FAQ gives them); PB 181 (mirror); **PB 233 (anemia thresholds, J1)**; CPG 4;
  CPG 6 (HBV triple panel, via a news release); SMFM Consult #74; PB 190 and the 2024 CPU
  (GDM); CPU 2025 (39-week).
- `[GAP]` Doppler FHT audibility; numeric quickening GA; COVID-19 and Tdap dose volumes;
  2026–27 COVID CPT codes; HEDIS MY2026 detail (PRS-E windows, PND-E cut-points); a 50-g value
  ≥200 as diagnostic; bariatric-surgery alternative screening (PB 105).
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

### Checks run on 2026-10-04 (this JSON)

- `validate-pathway.ts`: valid, compiles, trigger codes are families, DATA USE clean, brief in
  sync.
- `check-gate-control.ts`: no violations.
- `gate-proof.ts prenatal-ga`, `prenatal-gdm`, `prenatal-handoffs`, `prenatal-meds`: every
  expectation held, in both edge orders.
- `coverage-audit.ts`: every gate opens and closes, every node is included in some session,
  no question is a dead end (stub and real scoring).
- The look-back bands and the 140-day window need **dated** results; the simulator sends
  undated ones, which count as current.

### Uses josh-dev extensions (will not validate on `origin/main`)

`not_includes_code`, nested AND/OR groups, typed `patient.*` answers and "Not available".
