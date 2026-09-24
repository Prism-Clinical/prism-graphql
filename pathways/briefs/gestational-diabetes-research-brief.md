# Pathway Research Brief — Gestational Diabetes Mellitus (Screening → Diagnosis → Management → Postpartum)

**Status: DRAFT v1 for physician review — not yet approved for JSON build.**

Research method (per `.claude/skills/pathway-research/SKILL.md`): landscape scan, then four
parallel domain agents over fetched guideline text (diagnosis/screening, pharmacotherapy,
non-pharmacologic care & special populations, monitoring/delivery/quality), then two
verification agents (codes; citations). The live and retired pathway graphs were read from
the local pathway-service (`pathwayGraph`) to design against what is actually deployed.
**Verification outcome:**
- **Codes.** Every ICD-10-CM (FY2026 = FY2027), LOINC 2.82, RxNorm and CPT code in this brief
  was verified live.
- **Corrections found and folded in:**
  - LOINC 1500-4 does not exist, and 1503-2 is a urine test (both used by the retired pathway).
  - Several local seed labels are wrong (§B-18).
- **Citations:** 22 checked, 14 PASS and 8 PARTIAL, with fixes applied. ACOG PB 190 and the
  2024 ACOG CPU are paywalled; see `[GAP]`s.
Flags: `[GAP]` unsourceable · `[OLDER SOURCE]` older but still the current recommendation ·
`[NOT ENCODABLE]` clinically required but not expressible on main · `[DECISION]` an
authoring choice Josh must ratify · `[SIM]` cannot be exercised in the encounter simulator
as seeded today.

> ### Read this first — the four things this brief decides
>
> 1. **Two pathways, not one.** Part A `gestational-diabetes-screening-diagnosis` triggers on
>    *pregnancy* (Z34.x, O09.x, O99.810). Part B `gestational-diabetes-management` triggers on
>    *diagnosed GDM* (O24.41x, O24.43x, Z86.32). Reasons in §0.1. Both parts live in this one
>    file, each with a complete, self-contained §1–§18 so the builder can convert each part
>    on its own. The citation list (§15) is shared: each part's §16 names the references it
>    uses, and the builder emits only those.
> 2. **Pharmacotherapy is reachable only through a numeric SMBG gate** (fasting ≥95,
>    1-h ≥140 or 2-h ≥120 mg/dL; `on_unresolved: ask`). No stage holding insulin has a root
>    or `HAS_STEP` edge. That structural edge is exactly what made the retired
>    `gdm-management-v2` give insulin to a patient at target (§0.2).
> 3. **Gestational age and screening status are asked, not read.** `patient.gestational_age_weeks`
>    exists in the simulator, but a missing `patient.*` value is a silent "no" that can
>    never ask (commit `10fc9c8`; spec §patient_attribute). That breaks Josh's rule that
>    numeric gates ask when a value is missing. So GA-dependent routing is a SELECT question
>    router. It also handles the "already diagnosed" case, which no chart gate can express
>    because chart gates have no NOT.
> 4. **Most `[DECISION]` items are threshold or criteria choices the guidelines leave open.**
>    Examples: the 50-g cutoff (130/135/140), Carpenter–Coustan vs NDDG, and ADA vs ACOG on
>    early abnormal glucose. They are indexed in §0.5.

---

## 0. Cross-cutting analysis (not emitted — read before Parts A and B)

### 0.1 One pathway or two → **two** (recommendation)

| Consideration | One pathway | Two pathways |
|---|---|---|
| Trigger population | Every pregnancy **plus** every GDM code, so one pathway fires for all pregnancies | Each part fires on its own population |
| Keeping insulin away from undiagnosed patients | Needs an `includes_code O24.4.*` chart gate in front of all management content. Workable, but any stray structural edge exposes the whole management tree to every pregnancy | Structural: management content can't match an undiagnosed patient at all |
| Keeping screening away from diagnosed patients | Not chart-expressible either way (a chart gate has no negative arm). Needs a question | Same: Part A's entry router asks for it |
| Diagnosis to treatment hand-off | An in-pathway OGTT gate could open management, but "≥2 of 4 Carpenter–Coustan values" is `[NOT ENCODABLE]` (no N-of-M operator), so a question is needed anyway | Diagnosis is coded (O24.41x) and Part B fires on the code. This matches how real charts move |
| Size / review burden | ~20 gates in one graph; one mis-wire affects both populations | ~8 + ~10 gates; each part reviewable alone |
| Co-matching with `routine-prenatal-care-v2` | Every pregnancy co-matches (Z34) | Only Part A co-matches (Z34). Part B cannot, because ICD-10-CM forbids Z34 with any O-code (§0.3) |

**Why two:** the populations differ, and the diagnosis code is a clean, chart-native hand-off.
One pathway would force every pregnancy through a gate in front of the pharmacotherapy tree. A
single-pathway design would need the same questions anyway, so it saves nothing.

**The cost of two:** a patient carrying **O09.x + O24.41x** (high-risk supervision *with* GDM;
ICD-10-CM allows secondary chapter-15 codes with O09) matches **both** parts. Part A's entry
router has an explicit "diabetes already diagnosed this pregnancy" option, which routes her
to a hand-off step and nothing else. She answers one extra question.

### 0.2 Why the stored GDM pathways failed (post-mortem from the local graph, 2026-09-24)

Four GDM pathways are stored locally, all ARCHIVED: `gestational-diabetes-screening`,
`gestational-diabetes-v2`, `gdm-management-v1`, `gdm-management-v2`.

**(a) Screening that could never match an unscreened patient.** `gestational-diabetes-screening`
triggered on `O24.419, O24.410, O24.414, O24.415`, which are diagnosed-GDM codes. A pregnancy
that has not yet been screened carries Z34/O09, so it never matched. The graph also had these
problems:
- It gated on `field: vitals, value: gestational_age`. That is not a simulator vitals key, so
  the gate evaluates missing and silently answers "no".
- It split one-step OGTT thresholds into separate single-value gates (`gate-75g-1h`,
  `gate-75g-2h`). No gate ever expressed "any one value".
- It used LOINCs **1500-4 and 1503-2** as the 100-g 1-h and 2-h values. Wave-2 verification
  (LOINC 2.82) shows **1500-4 is not a LOINC code** (its check digit fails), and **1503-2 is a
  *urine* glucose**. The correct codes are 1501-6 and 1514-9.
- It had no `on_unresolved` anywhere.

**(b) Insulin given to a diet-controlled patient at target.** In `gdm-management-v2`,
`gate-targets-not-met` (labs `1558-6 > 95`) `BRANCHES_TO stage-3` "Pharmacotherapy", and there
was **also** an edge `root HAS_STAGE stage-3`. The unconditional structural edge reached Stage 3
first, and the gate's verdict was discarded (spec Rule 1). That is the same inertness bug found
in anemia v1.4. Three further defects:
- `1558-6` is a *serum/plasma fasting glucose*, not a self-monitored value.
- `> 95` misses exactly 95, and the target is "<95".
- There was no postprandial condition, so postprandial-only hyperglycemia could never reach
  insulin.

`gate-a2gdm` (O24.414 only) missed oral-agent A2 patients (O24.415). Its meds had no
`clinical_role` and no codes.

**What this brief does differently:**
- Every pharmacotherapy stage is branch-entry only.
- Thresholds use the `X − 0.1` device, so the comparison is effectively `≥ X`.
- Fasting and postprandial are gated separately, from SMBG LOINCs.
- There is a continuation route for patients already treated who are at target (§B-4b, mirror
  failure).
- Every chart gate states `on_unresolved`.

### 0.3 Coding facts that shape the triggers (verified, ICD-10-CM FY2027 Guidelines [17])

- **Z34 is never used with chapter-15 (O) codes** (I.C.15.b.1; I.C.21.c.11). Z34 is excluded
  (Excludes1) whenever there is any complication or O09. Consequences:
  - A patient with GDM **cannot** legitimately carry Z34, so Part B never co-matches
    `routine-prenatal-care-v2`.
  - A **normal** pregnancy carries Z34.x.
  - A **high-risk** supervised pregnancy carries O09.x and may carry other O-codes.
- **After an abnormal glucose challenge the pregnancy is coded O99.810** (abnormal glucose
  complicating pregnancy). O99.81 has an Excludes1 for GDM (O24.4-). **O99.810 is a Part A
  trigger:** it is exactly the patient who needs the diagnostic OGTT, and she no longer
  carries Z34.
- **O24.4 rules (I.C.15.i):** no other O24 code is used with O24.4-. Diet + insulin is coded
  insulin-controlled only (O24.414). Diet + oral agent is coded O24.415 only. **Z79.4 and
  Z79.84 (and Z79.85) are not assigned with O24.4-.** So "on insulin" is visible from ICD as O24.414, and
  the long-term-insulin Z-code is not a usable A2 signal.
- **Z86.32** (personal history of GDM) carries Excludes1 against current-pregnancy GDM. It
  marks the post-pregnancy, long-term follow-up population.

### 0.4 Co-matching with the other live and draft pathways

Local registry on 2026-09-24:
- `routine-prenatal-care-v2` — ACTIVE (Z34.00, Z34.90)
- `anemia-in-pregnancy` v2 — ACTIVE (O99.011–.019, D50.9)
- `gestational-hypertension-preeclampsia` — DRAFT
- `uti-asymptomatic-bacteriuria-pregnancy` — DRAFT

How the merge works (`care-plan-merge.ts`):
- **Medications** are deduped by name. `role: avoid|contraindicated` hard-suppresses that drug
  name across every co-matched pathway.
- **`clinical_role` conflict** fires when ≥2 **distinct** names share a role, **within or
  across** pathways. Both are then withheld pending provider choice (GHTN brief G11).
- **Labs** are keyed by `system|code`, or by the lowercased name when uncoded. Procedures and
  imaging are keyed by `system|code`.
- **Guidance is keyed by `topic` alone**, and the first plan's text wins.

| Other pathway | Co-matches with | `clinical_role` overlap? | Other merge interactions |
|---|---|---|---|
| `routine-prenatal-care-v2` (ACTIVE) | **Part A** on Z34.00 / Z34.90. It triggers on those two only; Part A adds the other Z34 leaves | **None.** Its lanes are `rh_alloimmunization_prophylaxis_in_pregnancy` and `pertussis_immunization_in_pregnancy`; the prenatal vitamin has no role | **Duplicate GDM screening.** Its `step-4-1` "Gestational diabetes screening (50-g GCT, 24–28 weeks)" holds `lab-10` "50-g glucose challenge test (GCT)" **with no code**. The merge keys it by name, so it will **not** dedupe against Part A's coded `LOINC\|1504-0`, and both appear. That step is also **broken twice** in the live graph: (1) `gate-early-gdm-screen` → `step-4-1` is **inert**, because `stage-4 HAS_STEP step-4-1` also exists (Rule 1); (2) it is **mis-targeted**: an *early-screening risk* question points at the *universal 24–28-week* step, so if the gate ever worked, an average-risk patient would lose universal screening. **`[DECISION D-1]`** Remove GDM screening (`step-4-1`, `lab-10`, `sched-2`, `gate-early-gdm-screen`) from the next routine-prenatal version and let Part A own it. Alternatively, keep a pointer step with no lab. |
| `anemia-in-pregnancy` v2 (ACTIVE) | Part A on O09.x + O99.01x; Part B on O24.4x + O99.01x | **None** (its iron, folate, B12 and ESA lanes are unrelated) | Its Guidance topic "When to call us right away" **already collides** with the UTI draft's topic of the same name, and only the first text survives. Part B topics are GDM-prefixed to avoid joining that collision. |
| `gestational-hypertension-preeclampsia` (DRAFT) | Part B on O13/O14 + O24.4x; Part A on O09 + O13/O14 | **None.** Its `preeclampsia-prophylaxis` (aspirin) and `antihypertensive-*` lanes do not overlap. GDM adds no aspirin node: GDM alone is not a USPSTF/ACOG aspirin indication [16]. ADA 2026 says patients with GDM are candidates only with other risk factors [5], which GHTN's `gate-aspirin-indicated` already asks. | **(1) Metformin and hypertension.** ADA 2026 says metformin should not be used with hypertension or preeclampsia, or with risk of IUGR [5]. The merge has no condition-aware suppression, so Part B's metformin (`alternative`) shows alongside GHTN's diagnosis. `[DECISION D-2]` Either (a) GHTN adds `Metformin` as `role: avoid` on its hypertension-diagnosed branch, which hard-suppresses Part B's metformin by name when both match (recommended), or (b) Part B keeps the caution only in text. **(2) Fetal testing dedupes correctly.** Part B uses the same CPT codes as GHTN (59025 NST, 76818 BPP, 76816 growth US), so co-matched plans show one of each. **(3) Delivery timing is not reconciled.** GHTN says ~37 0/7 wk; GDM A1 says 39 0/7–40 6/7. These are different Guidance topics, so both show; the earlier indicated timing governs (CO 831 [9]), and the clinician reconciles. |
| `uti-asymptomatic-bacteriuria-pregnancy` (DRAFT) | Part A on O09/O23 combinations | **None** | Its `gate-no-repeat-screening` reads E10/E11 (pregestational diabetes), not O24.4, so there is no interaction. |

**Net:** there are **no `clinical_role` merge conflicts** with any live or draft pathway. The
real co-matching issues are:
- the duplicated, uncoded GCT in routine-prenatal (D-1);
- metformin shown alongside a hypertension diagnosis (D-2);
- Guidance topic collisions. Part B uses GDM-prefixed topics; the existing anemia/UTI collision
  is flagged for a separate fix.

Within Part B, lanes are split so complementary drugs never conflict:
- `gdm-basal-insulin` (NPH);
- `gdm-prandial-insulin` (lispro/aspart as one node);
- `gdm-oral-agent` (metformin; glyburide is `avoid`).

### 0.5 `[DECISION]` index (all repeated in context below)

| ID | Decision | Default in this brief |
|---|---|---|
| D-1 | Remove GDM screening from `routine-prenatal-care-v2` (duplicate, uncoded, inert + mis-targeted gate) | Remove; Part A owns screening |
| D-2 | Metformin with a hypertensive disorder: add `Metformin` `avoid` to GHTN's diagnosed branch | Yes (change lands in the GHTN pathway) |
| D-3 | 50-g GCT cutoff: 130 / 135 / 140 mg/dL (ACOG accepts any [2]; ADA lists all three [4]) | **140** (threshold 139.9): fewer false positives |
| D-4 | 100-g criteria: Carpenter–Coustan vs NDDG; ≥2 abnormal values vs 1 | **Carpenter–Coustan, ≥2 values** (ADA prefers the lower CC thresholds if two-step is used [4]; ≥2 is the ADA/USPSTF standard [4][7]) |
| D-5 | Offer both one-step and two-step via a strategy router, or hard-code one | **Router with both.** Two-step is the ACOG-accepted default; one-step is ADA-preferred |
| D-6 | Early test designated as **HbA1c** (single-test gate) vs a router over HbA1c / FPG / 75-g OGTT | **HbA1c** (drawn with the first prenatal panel, nonfasting). ADA Rec 2.4 prefers plasma glucose in pregnancy, a conflict flagged in Part A §18 |
| D-7 | Early abnormal glucose (ADA Rec 2.31b: A1C 5.9–6.4%) branch, when ACOG no longer recommends early GDM screening | **Include**, as counseling + fasting-glucose monitoring only, with no pharmacotherapy |
| D-8 | Postprandial timing: router (1-h vs 2-h) with two parallel prandial stages vs standardize on one timing | **Router.** Both are guideline-acceptable [5][2]; an OR over both would ask forever for the unused one |
| D-9 | "Consistently above target": numeric gate alone vs numeric gate chained to a confirmation question | **Numeric gate alone** (Josh's rule). The chained question is offered, not built |
| D-10 | SMBG gate horizon | **{days: 14}** (weekly review [3], with slack) |
| D-11 | Glyburide role: `avoid` (hard-suppressed) vs `second_line` | **`avoid`** |
| D-12 | Z86.32 as a Part B trigger (enables postpartum and long-term follow-up; a later pregnancy is routed away by question) | **Include** |
| D-13 | Postpartum OGTT gate `on_unresolved`: `ask` (Josh's rule) vs `default` (avoids a premature question during weeks 0–4) | **ask** |
| D-14 | Postpartum OGTT horizon {days: 60}, which keeps antepartum OGTT values out of the postpartum read | **{days: 60}** |
| D-15 | Basal insulin node: NPH only (glargine in notes) vs NPH + glargine as same-lane alternatives (forces a provider choice every time) | **NPH only** |
| D-16 | Logical IDs: fresh `gestational-diabetes-screening-diagnosis` / `gestational-diabetes-management` vs reusing archived `gestational-diabetes-screening` (would import as NEW_VERSION) | **Fresh IDs** |
| D-17 | Z3A.xx (weeks of gestation) as Part A triggers | **Not used** |
| D-18 | SMBG LOINCs the pharmacotherapy gates read: fasting 41604-0, 1-h 10449-7 (no capillary mg/dL code exists), 2-h 6689-4 | As listed. Home-glucometer feeds usually arrive untimed (41653-7), which is an integration task |

### 0.6 Spec limitations hit (details in each part's §18)

1. **`patient.*` cannot ask.** Gestational age and trimester become question routers (see "Read
   this first", item 3).
2. **Chart gates have no negative arm.** "Not yet diagnosed", "not on medication" and "at
   target" all need either a question or a separate positive-case gate.
3. **No N-of-M operator.** Carpenter–Coustan "≥2 of 4" becomes a question gate.
4. **A compound OR over alternative tests asks forever for the test not drawn.** Examples: 1-h
   vs 2-h postprandial; HbA1c vs FPG early. Each is routed first or a single test is
   designated.
5. **`count_in_window` counts results, not above-threshold results**, so "consistently above
   target" (e.g., ≥X% of values) is `[NOT ENCODABLE]`. The gate reads the latest value.
6. **No pregnancy anchor.** "This pregnancy" and "postpartum weeks 4–12" are day-count
   proxies.
7. **The simulator can only enter seeded codes.** The composer's `CodeSearchCombobox` offers
   `clinical_code_reference` rows only. `ensureClinicalCodeReference` exists but has **no
   callers** on josh-dev, so importing a pathway does not seed its codes.
   - **Seeded today:** Z34.00, Z34.90, O09.40, O09.90, O24.410/.414/.415/.419, LOINC 1504-0,
     1558-6, 4548-4, 41653-7, 2345-7.
   - **Not seeded:** most other triggers and every timed OGTT or SMBG LOINC.
   - Those gates are `[SIM]` until seeded.
   - Verification also found six mislabeled RxNorm seed rows (for example, "insulin lispro"
     847191 is really an aspart 70/30 pen) and two mislabeled LOINC rows. See §B-18.
8. **Load-agnostic OGTT LOINCs.** The official 3-h gestational panel (50608-9) reports 1558-6
   plus the *generic* post-dose codes (20438-8/20436-2/20437-0), not the 100-g-specific ones.
   Thresholds depend on the glucose load, which the code may not carry. Gates are authored on
   the load-specific codes, and real-chart mapping is a site concern.
9. **Delivery-timing and fetal-surveillance rows need glycemic-control class**, which is
   judgment ("well controlled"). They become a SELECT router.
10. **One parent per node (builder rule for this brief).** Node marking is first-writer-wins
    (`traversal-engine.ts` `markSubtree`). A child shared by two differently-gated parents
    takes whichever status reaches it first. If metformin is shared by Stages 3 and 4, and
    Stage 3 is gated out, metformin can be marked GATED_OUT even though Stage 4 is included.
    `spare` protects only the branches of the same fork.
    - **Every node listed "on" several hosts is emitted as one node per host**, with the same
      name, topic or code. The merge dedupes medications by name, labs/procedures by code, and
      guidance by topic, so the care plan shows each once.
    - This applies to CodeEntry rows with several hosts too: one CodeEntry node per host.
11. **Merge dedupes Guidance by topic only.** Colliding topic strings across pathways silently
    drop text. Part B uses GDM-specific topics.

---

# PART A — `gestational-diabetes-screening-diagnosis`

## A-1. Pathway metadata

- **Logical ID**: `gestational-diabetes-screening-diagnosis` (new; see D-16)
- **Title**: Gestational Diabetes — Screening and Diagnosis
- **Version**: 1
- **Category**: OBSTETRIC
- **Scope**: Outpatient prenatal care, from the first prenatal visit to the diagnosis of GDM
  (or the end of screening). Covers:
  - risk-based early testing for undiagnosed pregestational diabetes, before 24 weeks and
    ideally before 15 weeks;
  - universal screening at 24 0/7 weeks or later, as soon as possible if entry to care is late;
  - one-step and two-step diagnosis.
  Management after diagnosis is Part B. Pregestational (type 1/2) diabetes is scoped out: it
  exits to a hand-off step.
- **Target population**: Pregnant patients without diabetes diagnosed in this pregnancy.
- **Condition codes** (trigger codes; OR semantics). Codes are listed as **leaves**, because
  trigger matching expands the *patient's* codes to ICD-10 ancestors only through
  `icd10_codes`. That table holds 666 codes and has **no O09 subtree and no Z34.01–.03 /
  .80–.83 / .91–.93**. A category trigger (`O09`) would therefore silently miss most
  patients (`session-store.ts` `getMatchedPathways`). Leaves match literally.

| Code | System | Description | Usage note | Grouping |
|---|---|---|---|---|
| Z34.00, Z34.01, Z34.02, Z34.03 | ICD-10 | Encounter for supervision of normal first pregnancy — unspecified / first / second / third trimester | primary trigger | normal-pregnancy |
| Z34.80, Z34.81, Z34.82, Z34.83 | ICD-10 | Encounter for supervision of other normal pregnancy — unspecified / first / second / third trimester | primary trigger | normal-pregnancy |
| Z34.90, Z34.91, Z34.92, Z34.93 | ICD-10 | Encounter for supervision of normal pregnancy, unspecified — unspecified / first / second / third trimester | primary trigger | normal-pregnancy |
| O09.00, O09.01, O09.02, O09.03 | ICD-10 | Supervision of pregnancy with history of infertility — unspecified / 1st / 2nd / 3rd trimester | primary trigger | high-risk-pregnancy |
| O09.10, O09.11, O09.12, O09.13 | ICD-10 | Supervision of pregnancy with history of ectopic pregnancy — unsp / 1st / 2nd / 3rd | primary trigger | high-risk-pregnancy |
| O09.A0, O09.A1, O09.A2, O09.A3 | ICD-10 | Supervision of pregnancy with history of molar pregnancy — unsp / 1st / 2nd / 3rd | primary trigger | high-risk-pregnancy |
| O09.211, O09.212, O09.213, O09.219 | ICD-10 | Supervision of pregnancy with history of pre-term labor — 1st / 2nd / 3rd / unsp | primary trigger | high-risk-pregnancy |
| O09.291, O09.292, O09.293, O09.299 | ICD-10 | Supervision of pregnancy with other poor reproductive or obstetric history — 1st / 2nd / 3rd / unsp | primary trigger | high-risk-pregnancy |
| O09.30, O09.31, O09.32, O09.33 | ICD-10 | Supervision of pregnancy with insufficient antenatal care — unsp / 1st / 2nd / 3rd | primary trigger (late entry to care) | high-risk-pregnancy |
| O09.40, O09.41, O09.42, O09.43 | ICD-10 | Supervision of pregnancy with grand multiparity — unsp / 1st / 2nd / 3rd | primary trigger | high-risk-pregnancy |
| O09.511, O09.512, O09.513, O09.519 | ICD-10 | Supervision of elderly primigravida — 1st / 2nd / 3rd / unsp | primary trigger | high-risk-pregnancy |
| O09.521, O09.522, O09.523, O09.529 | ICD-10 | Supervision of elderly multigravida — 1st / 2nd / 3rd / unsp | primary trigger | high-risk-pregnancy |
| O09.611, O09.612, O09.613, O09.619 | ICD-10 | Supervision of young primigravida — 1st / 2nd / 3rd / unsp | primary trigger | high-risk-pregnancy |
| O09.621, O09.622, O09.623, O09.629 | ICD-10 | Supervision of young multigravida — 1st / 2nd / 3rd / unsp | primary trigger | high-risk-pregnancy |
| O09.70, O09.71, O09.72, O09.73 | ICD-10 | Supervision of high risk pregnancy due to social problems — unsp / 1st / 2nd / 3rd | primary trigger | high-risk-pregnancy |
| O09.811, O09.812, O09.813, O09.819 | ICD-10 | Supervision of pregnancy resulting from assisted reproductive technology — 1st / 2nd / 3rd / unsp | primary trigger | high-risk-pregnancy |
| O09.821, O09.822, O09.823, O09.829 | ICD-10 | Supervision of pregnancy with history of in utero procedure during previous pregnancy — 1st / 2nd / 3rd / unsp | primary trigger | high-risk-pregnancy |
| O09.891, O09.892, O09.893, O09.899 | ICD-10 | Supervision of other high risk pregnancies — 1st / 2nd / 3rd / unsp | primary trigger | high-risk-pregnancy |
| O09.90, O09.91, O09.92, O09.93 | ICD-10 | Supervision of high risk pregnancy, unspecified — unsp / 1st / 2nd / 3rd | primary trigger | high-risk-pregnancy |
| O99.810 | ICD-10 | Abnormal glucose complicating pregnancy | positive glucose challenge, awaiting diagnostic OGTT | abnormal-glucose |

`[DECISION D-17]` **Z3A.xx weeks-of-gestation codes are not triggers.** They would
give a gestational-age trigger for free (Z3A.24–Z3A.28), but they are supplementary codes used
with chapter-15 codes. Coding practice for them in outpatient prenatal visits varies.

## A-1b. Code sets

None. Single-condition pathway (legacy OR over condition_codes).

## A-2. Stages

- **Stage 1 — Screening status** *(root-connected; entry)*: establishes where the patient is in
  GDM screening this pregnancy, and routes by gestational age and status. [2][4][7]
- **Stage 2 — Early pregnancy: risk-based testing** *(branch-entry only, via
  `gate-screening-status` = "Before 24 weeks")*: risk assessment for undiagnosed pregestational
  diabetes; early HbA1c when indicated; overt-diabetes exit; early abnormal glucose; plan for
  universal screening. [1][4][5]
- **Stage 3 — Universal screening (24 0/7 weeks or later)** *(branch-entry only, via
  `gate-screening-status` = "24 weeks or later")*: selects the screening strategy. Covers late
  entry to care. [2][4][7]
- **Stage `stage-3-two-step` — Two-step screening** *(branch-entry only, via
  `gate-screening-strategy` = two-step; `stage_number` 3)*: 50-g GCT → 100-g 3-h OGTT → diagnosis. [2][4][7]
- **Stage `stage-3-one-step` — One-step screening** *(branch-entry only, via
  `gate-screening-strategy` = one-step; `stage_number` 3)*: 75-g 2-h OGTT → diagnosis. [4][7]

Only Stage 1 has a root `HAS_STAGE` edge.

## A-3. Steps

- **Step 1.1 — Establish GDM screening status and gestational age** *(Stage 1, unconditional;
  hosts `gate-screening-status`)*: confirm gestational age from dating. Record whether diabetes
  has already been diagnosed this pregnancy, and whether 24–28-week screening has already been
  done. [2][7]
- **Step 1.2 — Screening complete (negative at ≥24 weeks); no further GDM testing this
  pregnancy** *(router target only)*: no repeat screening unless there is clinical suspicion
  (e.g., new glycosuria, suspected macrosomia or polyhydramnios). Clinical judgment; no
  guideline mandates a re-test. [2]
- **Step 1.3 — Diabetes already diagnosed this pregnancy: hand off** *(router target only)*:
  GDM → follow the GDM management pathway (Part B). Pregestational or overt diabetes → manage
  as diabetes complicating pregnancy (out of scope). No screening is ordered. [4][5]
- **Step 2.1 — Assess risk factors for undiagnosed pregestational diabetes** *(Stage 2,
  unconditional; hosts `gate-early-testing-indicated`)*: at the first prenatal visit, apply
  ADA Table 2.5.
  - BMI ≥25 kg/m² (≥23 for Asian ancestry) **plus** ≥1 of: first-degree relative with
    diabetes; high-risk race, ethnicity or ancestry; CVD; hypertension; HDL <35 or TG >250;
    PCOS; physical inactivity; other insulin-resistance conditions.
  - **Or**, with no BMI requirement: prediabetes (A1C ≥5.7%); prior GDM.
  - ADA also says to *consider* testing everyone before 15 weeks (Rec 2.31a, E).
  - Note: BMI must come from measured height/weight. ICD-10-CM forbids Z68 BMI codes during
    pregnancy (I.C.21.c.3). [4][5][17]
- **Step 2.2 — Early testing for overt diabetes: HbA1c** *(gated by
  `gate-early-testing-indicated`; hosts `gate-overt-diabetes` and
  `gate-early-abnormal-glucose`)*: before 15 weeks if possible, test with standard nonpregnant
  diagnostic criteria.
  - Test used by this pathway: HbA1c (≥6.5% = diabetes) — D-6.
  - Acceptable alternatives: FPG ≥126 mg/dL; 2-h 75-g OGTT ≥200; random ≥200 **with** classic
    symptoms.
  - One-step/two-step GDM criteria must **not** be applied before 24 weeks (ADA-2).
  - Without unequivocal hyperglycemia, confirm with a second abnormal result (Rec 2.1b). [1][4]
- **Step 2.3 — Overt diabetes in pregnancy: confirm and manage as pregestational diabetes**
  *(gated by `gate-overt-diabetes`)*: confirm per ADA criteria (a second abnormal test unless
  unequivocal). Classify as diabetes complicating pregnancy, not GDM. Refer and manage per the
  pregestational pathway (out of scope). [4]
- **Step 2.4 — Early abnormal glucose metabolism: counseling and fasting-glucose monitoring**
  *(gated by `gate-early-abnormal-glucose`)*: ADA defines this as A1C 5.9–6.4% (or FPG
  110–125 mg/dL) before 15 weeks. It is a **higher-risk marker, not an early GDM diagnosis**
  (Rec 2.31b, B). Do not code O24.4- on this basis.
  - ADA suggests nutrition counseling and periodic fasting glucose, e.g., 3–4 times a week.
    If fasting values are mostly ≥110 before 15 weeks, testing can go to daily and treatment is
    a shared decision.
  - The benefit of treatment is uncertain.
  - **ACOG no longer recommends screening for early GDM** (per the CPU abstract [1] and HB-2025
    commentary), so this step is `[DECISION D-7]`.
  - Universal screening at 24–28 weeks still applies unless GDM management has begun. [1][4][5]
- **Step 2.5 — Plan universal screening at 24 0/7–28 6/7 weeks** *(Stage 2,
  unconditional)*: every patient not already diagnosed is screened at 24–28 weeks, **including
  those whose early testing was negative**. [2][4][7]
- **Step 3.1 — Select screening strategy** *(Stage 3, unconditional; hosts
  `gate-screening-strategy`)*:
  - Two-step: 50-g nonfasting GCT, then 100-g 3-h OGTT if positive.
  - One-step: 75-g fasting 2-h OGTT.
  - Screen as soon as possible if the patient is past 28 weeks and unscreened (USPSTF).
  - After bariatric surgery with dumping, a glucose load may not be tolerated; consider
    alternatives such as a week of home glucose monitoring (Guid-A3). [2][4][7]
- **Step 3.2 — Two-step, step 1: 50-g 1-hour glucose challenge test** *(Stage
  `stage-3-two-step`, unconditional; hosts `gate-gct-positive`)*: nonfasting 50-g oral glucose
  load; plasma glucose at 1 hour. Positive at ≥140 mg/dL (D-3). [2][4][7]
- **Step 3.3 — Two-step, step 2: 100-g 3-hour OGTT** *(gated by `gate-gct-positive`; hosts
  `gate-100g-diagnostic`)*:
  - After ≥8 h fast, 100-g load; plasma glucose fasting and at 1, 2 and 3 hours.
  - Carpenter–Coustan thresholds: 95 / 180 / 155 / 140 mg/dL. GDM if **≥2** are met or exceeded
    (D-4).
  - NDDG alternative: 105 / 190 / 165 / 145.
  - Code the pregnancy O99.810 while awaiting the result. [2][4][7]
- **Step 3.4 — GDM diagnosed (two-step): code and start management** *(gated by
  `gate-100g-diagnostic`)*: code O24.410 (or O24.419) and begin the GDM management pathway
  (Part B). Counsel (Guid-A4). [2][4][5]
- **Step 3.5 — One-step: 75-g 2-hour OGTT** *(Stage `stage-3-one-step`, unconditional; hosts
  `gate-75g-diagnostic`)*: morning, after ≥8 h fast, 75-g load; plasma glucose fasting and at 1
  and 2 hours. IADPSG thresholds 92 / 180 / 153 mg/dL. GDM if **any one** is met or exceeded. [4][7]
- **Step 3.6 — GDM diagnosed (one-step): code and start management** *(gated by
  `gate-75g-diagnostic`)*: as Step 3.4. [4][5]

## A-4. Decision points

None. Every decision is a gate (§A-4b). The one judgment-shaped decision, the screening
strategy, is a SELECT router. It is institution configuration more than clinical judgment, and
Prism has no per-site configuration.

## A-4b. Gates

**Framing note.** Four of the eight gates are questions. Each says what data gate it would
have been and why it cannot be one on main. The four chart gates are single-test numeric
gates with `on_unresolved: ask`.

- **Gate `gate-screening-status` — Where is this patient in GDM screening this pregnancy?**
  - Attached to: `step-1-1` · **Router** (multi-target question), SELECT. Branches:
    - `"Before 24 weeks — diabetes not diagnosed this pregnancy"` → `stage-2`
    - `"24 weeks or later — not yet screened, or screening in progress"` → `stage-3`
    - `"Screened at 24 weeks or later — negative"` → `step-1-2`
    - `"Diabetes already diagnosed this pregnancy (gestational or pregestational)"` → `step-1-3`
  - Exclusively gated: yes. Stages 2 and 3 have no root edge; Steps 1.2 and 1.3 have no
    `HAS_STEP`.
  - Type: **question** · answer_type: SELECT · options exactly as the four strings above
    (each maps once via `when: {"equals": "<option>"}`).
  - Default behavior: **skip** (only consulted if the router cannot decide).
  - Prompt: "Where is this patient in gestational diabetes screening this pregnancy? Choose
    by current gestational age: before 24 0/7 weeks; 24 0/7 weeks or later and not yet
    screened (or results pending, including an abnormal 1-hour glucose challenge awaiting the
    diagnostic OGTT); screened at 24 weeks or later with a negative result; or diabetes
    (gestational or pregestational) already diagnosed this pregnancy."
  - `[NOT ENCODABLE]` **Why not a data gate:**
    - (a) GA as `patient.gestational_age_weeks` is a silent "no" when missing, and never asks
      (spec; commit 10fc9c8), which breaks the ask-when-missing rule.
    - (b) "Diabetes not diagnosed" is a negative condition. A chart gate has no negative arm.
    - (c) "Screened and negative" is also negative: an OGTT below threshold.
  - A patient carrying O09.x + O24.41x co-matches Part B; this router's last option is how
    she exits.
  - Rationale & source: [2][4][7] → evidence on host Step 1.1.

- **Gate `gate-early-testing-indicated` — Early testing for undiagnosed diabetes indicated?**
  - Attached to: `step-2-1` · Branches to: `step-2-2`
  - Exclusively gated: yes. Step 2.2 is removed from Stage 2's plain flow.
  - Type: **question** · answer_type: BOOLEAN · Default behavior: **skip**. "No" means no early
    test; universal screening (Step 2.5) is unaffected.
  - Prompt: "Does this patient meet criteria for early testing for undiagnosed diabetes?
    Criteria: BMI 25 or higher (23 or higher if Asian ancestry) PLUS at least one of:
    first-degree relative with diabetes; high-risk race, ethnicity or ancestry; history of
    cardiovascular disease; hypertension; HDL below 35 or triglycerides above 250; polycystic
    ovary syndrome; physical inactivity; other insulin-resistance conditions (e.g., acanthosis
    nigricans). OR, regardless of BMI: prediabetes (A1C 5.7% or higher) or gestational
    diabetes in a prior pregnancy. (ADA also advises considering early testing for all
    patients.)"
  - `[NOT ENCODABLE]` **Why not a data gate:**
    - The rule is `BMI_high AND ≥1 of 8` OR `prediabetes` OR `prior GDM`. Compound gates have
      one flat AND/OR, so there is no nesting and no counting.
    - BMI cannot be read from Z68 in pregnancy.
    - Several factors have no code: first-degree relative (Z83.3 does not encode degree),
      ancestry, physical inactivity.
    - Z86.32 and E28.2 would be sensitive partial signals only.
  - `[GAP]` The ACOG CPU 2024 risk-factor table itself is paywalled [1]. The prompt uses ADA
    Table 2.5 [4]. Confirm against the CPU if you have access.
  - Rationale & source: [1][4][5] → Step 2.1.

- **Gate `gate-overt-diabetes` — Early HbA1c in the diabetes range?**
  - Attached to: `step-2-2` · Branches to: `step-2-3`
  - Exclusively gated: yes.
  - Type: **patient_attribute** (coded) · Default behavior: **skip**
  - Condition: field `labs`, operator `greater_than`, value `4548-4`, system `LOINC`, threshold
    **6.49**, display `"Hemoglobin A1c (%)"`, horizon `QUARTER`.
  - On unresolved: **ask**. A missing A1C must not silently rule out overt diabetes. The
    subtree is held with "Awaiting Hemoglobin A1c" until a value is entered.
  - `[DECISION]` 6.49 expresses "≥6.5%" at the 0.1% reporting resolution.
  - Conflict flagged: ADA Rec 2.4 (B) prefers plasma-glucose criteria in pregnancy, while the
    ADA-2 GDM narrative applies Table 2.1, including A1C, to early pregnancy (D-6).
  - Rationale & source: ADA-2 Table 2.1, Rec 2.31a [4] → Step 2.2.

- **Gate `gate-early-abnormal-glucose` — Early HbA1c 5.9–6.4%?**
  - Attached to: `step-2-2` · Branches to: `step-2-4`
  - Exclusively gated: yes. Mutually exclusive with `gate-overt-diabetes` by construction: the
    upper bound is <6.5.
  - Type: **compound**, operator **AND** · Default behavior: **skip**
  - Conditions (coded), both field `labs`, value `4548-4`, system `LOINC`, display
    `"Hemoglobin A1c (%)"`, horizon `QUARTER`:
    - `greater_than`, threshold **5.89** (≥5.9)
    - `less_than`, threshold **6.5**
  - On unresolved: **ask** (same datum as `gate-overt-diabetes`, so it shares ONE question).
  - `[DECISION D-7]` Include or drop. ADA Rec 2.31b (B) defines the band and suggests
    counseling. ACOG no longer recommends early GDM screening.
  - The FPG 110–125 arm is omitted (D-6: single designated test). An OR with FPG would ask
    for the FPG forever in an A1C-tested patient.
  - Rationale & source: [4] Rec 2.31b; [5] narrative → Step 2.2.

- **Gate `gate-screening-strategy` — Which GDM screening strategy?**
  - Attached to: `step-3-1` · **Router**, SELECT. Branches:
    - `"Two-step: 50-g challenge, then 100-g OGTT if positive"` → `stage-3-two-step`
    - `"One-step: 75-g 2-hour OGTT"` → `stage-3-one-step`
  - Exclusively gated: yes. Neither sub-stage has a root edge.
  - Type: **question** · SELECT · Default behavior: **skip**
  - Prompt: "Which gestational diabetes screening strategy is used for this patient? Two-step
    (50-g glucose challenge, then 100-g 3-hour OGTT if positive) or one-step (75-g 2-hour
    OGTT)."
  - Why a router: without it, the two-step GCT gate would **ask for a 1-h 50-g value** in every
    one-step patient, and vice versa. Strategy is site configuration that Prism cannot store
    (D-5).
  - Rationale & source: [2][4][7] → Step 3.1.

- **Gate `gate-gct-positive` — 50-g challenge at or above cutoff?**
  - Attached to: `step-3-2` · Branches to: `step-3-3`
  - Exclusively gated: yes.
  - Type: **patient_attribute** (coded) · Default behavior: **skip**
  - Condition: field `labs`, `greater_than`, value `1504-0`, system `LOINC`, threshold
    **139.9**, display `"Glucose 1 h post 50 g glucose (mg/dL)"`, horizon `QUARTER`.
  - On unresolved: **ask**. The OGTT step stays held ("Awaiting…") until the GCT is resulted.
  - `[DECISION D-3]` Cutoff 140 (139.9). Alternatives are 130 (129.9) and 135 (134.9); ACOG
    accepts any [2], and ADA lists all three [4]. Lower cutoffs raise sensitivity and OGTT
    volume.
  - `[GAP]` A GCT ≥200 mg/dL going straight to a GDM diagnosis: no accessible US source.
    Not built.
  - Rationale & source: [2][4][7] → Step 3.2.

- **Gate `gate-100g-diagnostic` — Does the 100-g OGTT meet diagnostic criteria?**
  - Attached to: `step-3-3` · Branches to: `step-3-4`
  - Exclusively gated: yes.
  - Type: **question** · BOOLEAN · Default behavior: **skip**
  - Prompt: "Does the 100-g 3-hour OGTT meet Carpenter–Coustan criteria — at least TWO values
    at or above: fasting 95, 1-hour 180, 2-hour 155, 3-hour 140 mg/dL?"
  - `[NOT ENCODABLE]` "≥2 of 4" has no operator: compound is a flat AND/OR, with no N-of-M.
  - `[DECISION D-4]` CC vs NDDG (105/190/165/145), and ≥2 vs 1 abnormal value. ACOG notes one
    elevated value may be used (per ADA-2's citation of PB 190); ADA warns this markedly
    raises incidence.
  - Rationale & source: [2][4][7] → Step 3.3.

- **Gate `gate-75g-diagnostic` — Any 75-g OGTT value at or above IADPSG threshold?**
  - Attached to: `step-3-5` · Branches to: `step-3-6`
  - Exclusively gated: yes.
  - Type: **compound**, operator **OR** · Default behavior: **skip**
  - Conditions (coded), each field `labs`, `greater_than`, system `LOINC`, horizon `QUARTER`:
    - `1552-9` threshold **91.9**, display `"Glucose fasting, pre 75 g glucose (mg/dL)"`
    - `1507-3` threshold **179.9**, display `"Glucose 1 h post 75 g glucose (mg/dL)"`
    - `1518-0` threshold **152.9**, display `"Glucose 2 h post 75 g glucose (mg/dL)"`
  - On unresolved: **ask**. All three values come from the same test, so asking for a missing
    one is correct. It is not the alternative-tests OR-trap.
  - `[SIM]` 1552-9, 1507-3 and 1518-0 are not in `clinical_code_reference`.
  - Load-agnostic lab reporting (generic 20436-2 etc.) will not match (§0.6 #8).
  - Rationale & source: [4] Table 2.8; [7] Table 2 → Step 3.5.

## A-5. Medications

None. Screening and diagnosis only; treatment is Part B.

## A-6. Lab tests

- **Lab-A1 — Hemoglobin A1c** (on Step 2.2): LOINC 4548-4, blood. Early test for overt
  diabetes and early abnormal glucose. [4]
- **Lab-A2 — Fasting plasma glucose** (on Step 2.2): LOINC 1558-6, serum/plasma. Acceptable
  alternative early test (≥126 mg/dL). Ordered at clinician discretion; not gated (D-6). [4]
- **Lab-A3 — 50-g 1-hour glucose challenge test** (on Step 3.2): LOINC 1504-0, serum/plasma. [2][4][7]
- **Lab-A4 — 100-g 3-hour oral glucose tolerance test** (on Step 3.3), serum/plasma. LOINC codes:
  - fasting 1549-5;
  - 1 h 1501-6;
  - 2 h 1514-9;
  - 3 h 1530-5;
  - panel 50608-9.
  Sources: [2][4][7]
- **Lab-A5 — 75-g 2-hour oral glucose tolerance test** (on Step 3.5), serum/plasma. LOINC codes:
  - fasting 1552-9;
  - 1 h 1507-3;
  - 2 h 1518-0.
  Sources: [4][7]

## A-7. Imaging

None.

## A-8. Procedures

None.

## A-9. Guidance

- **Guid-A1 — topic `GDM screening: what the glucose test involves`** (on Step 3.1), category
  education. Instructions:
  - "Every pregnant patient is checked for gestational diabetes between 24 and 28 weeks.
  - In the two-step approach you drink a 50-gram glucose drink (no fasting needed) and have
    blood drawn one hour later. If that result is high, a second, longer test follows: after
    an overnight fast you drink 100 grams of glucose and have blood drawn fasting and at 1, 2
    and 3 hours.
  - In the one-step approach you fast overnight, drink 75 grams of glucose, and have blood
    drawn fasting and at 1 and 2 hours.
  - Stay seated and do not eat or smoke during the test."
  Sources: [2][4]
- **Guid-A2 — topic `GDM early testing: why we test early`** (on Step 2.1), category
  education. Instructions: "Some patients have type 2 diabetes before pregnancy without knowing
  it. If you have risk factors, we check an A1C blood test at your first visit so that
  diabetes can be treated from the start. Even if this early test is normal, you will still
  have the standard glucose test at 24–28 weeks." [4][5]
- **Guid-A3 — topic `GDM screening after bariatric surgery`** (on Step 3.1), category
  safety-netting. Instructions: "If you have had weight-loss surgery and get dumping symptoms
  (fast heartbeat, sweating, cramping or diarrhoea after sugary drinks), tell us before the
  glucose drink. We may check your blood sugar at home for about a week instead."
  - `[GAP]` Primary text of ACOG PB 105 (bariatric) is paywalled. Secondary summary only;
    ADA 2026 has no pregnancy-specific statement.
- **Guid-A4 — topic `GDM diagnosis: what happens next`** (on Step 3.4; **duplicate node Guid-A4b, same topic and text, on Step 3.6** — one parent per node, see §0.6 #10), category
  education. Instructions:
  - "Gestational diabetes means your body is not handling sugar as well as it needs to during
    pregnancy. Most patients (about 70–85%) control it with changes in eating and activity
    alone.
  - We will refer you to a dietitian and teach you to check your blood sugar at home.
  - Well-controlled gestational diabetes lowers the chance of a very large baby, birth injury
    and low blood sugar in your newborn."
  Sources: [5][2]
- **Guid-A5 — topic `GDM early abnormal glucose: what it means`** (on Step 2.4), category
  education. Instructions: "Your early A1C was slightly above normal. This means a higher
  chance of developing gestational diabetes later in pregnancy. We will meet with a dietitian
  and may check your fasting blood sugar a few times a week. Whether treating this early
  helps is still being studied; we will decide together." [4][5]

## A-10. Quality metrics

None emitted. `[GAP]` No CMS/NCQA/TJC measure targets antepartum GDM screening. HEDIS PPC
counts prenatal visits, not screening content. The live `routine-prenatal-care-v2` already
carries a generic "Completion of recommended prenatal screening services" metric (qm-2).

## A-11. Schedules

- **Sched-A1** (on Step 2.5): interval "24 0/7–28 6/7 weeks". Description: "Universal GDM
  screening window. Screen as soon as possible if first seen after 28 weeks. Early negative
  testing does not replace it." [4][7]
- **Sched-A2** (on Step 2.4): interval "3–4 times per week". Description: "Fasting glucose
  checks for early abnormal glucose metabolism; move to daily if fasting values are mostly
  ≥110 mg/dL." [5]

## A-12. Prerequisites (REQUIRES)

- `step-3-3` REQUIRES `step-3-2`: the 100-g OGTT follows a positive 50-g GCT (two-step).
- `step-3-4` REQUIRES `step-3-3`: two-step diagnosis requires the diagnostic OGTT.
- `step-3-6` REQUIRES `step-3-5`: one-step diagnosis requires the 75-g OGTT.

Acyclic. `[DECISION]` The PB 180 rule "positive early 50-g screen with a negative diagnostic
test → at 24–28 weeks use the diagnostic test without repeating the 50-g" [3] is **not**
encoded. It would need a "prior early GCT" signal that has no reliable code. It is carried in
Step 3.2's description as clinician text.

## A-13. Code entries

| Code | System | Description | Attached to |
|---|---|---|---|
| 4548-4 | LOINC | Hemoglobin A1c/Hemoglobin.total in Blood | Lab-A1 |
| 1558-6 | LOINC | Fasting glucose [Mass/volume] in Serum or Plasma | Lab-A2 |
| 1504-0 | LOINC | Glucose [Mass/volume] in Serum or Plasma --1 hour post 50 g glucose PO | Lab-A3 |
| 1549-5 | LOINC | Glucose [Mass/volume] in Serum or Plasma --pre 100 g glucose PO | Lab-A4 |
| 1501-6 | LOINC | Glucose [Mass/volume] in Serum or Plasma --1 hour post 100 g glucose PO | Lab-A4 |
| 1514-9 | LOINC | Glucose [Mass/volume] in Serum or Plasma --2 hours post 100 g glucose PO | Lab-A4 |
| 1530-5 | LOINC | Glucose [Mass/volume] in Serum or Plasma --3 hours post 100 g glucose PO | Lab-A4 |
| 50608-9 | LOINC | Glucose tolerance 3 hours gestational panel - Serum or Plasma | Lab-A4 |
| 1552-9 | LOINC | Glucose [Mass/volume] in Serum or Plasma --pre 75 g glucose PO | Lab-A5 |
| 1507-3 | LOINC | Glucose [Mass/volume] in Serum or Plasma --1 hour post 75 g glucose PO | Lab-A5 |
| 1518-0 | LOINC | Glucose [Mass/volume] in Serum or Plasma --2 hours post 75 g glucose PO | Lab-A5 |
| 83036 | CPT | Hemoglobin; glycosylated (A1c) | Lab-A1 |
| 82950 | CPT | Glucose; post glucose dose (includes glucose) | Lab-A3 |
| 82951 | CPT | Glucose; tolerance test (GTT), 3 specimens (includes glucose) | Lab-A4, Lab-A5 |
| 82952 | CPT | Glucose tolerance test, each additional beyond 3 specimens | Lab-A4 |
| O99.810 | ICD-10 | Abnormal glucose complicating pregnancy | Step 3.3 |
| O24.410 | ICD-10 | Gestational diabetes mellitus in pregnancy, diet controlled | Step 3.4, Step 3.6 |
| O24.419 | ICD-10 | Gestational diabetes mellitus in pregnancy, unspecified control | Step 3.4, Step 3.6 |


## A-14. Attribute-map registrations

None. All chart conditions are coded form; no `lab.*` or `allergy.*` attributes.

## A-15. Evidence citations

See **Shared §15** at the end of this file. Part A uses: [1], [2], [3], [4], [5], [7], [17].

## A-16. Citation map

- Stage 1: [2], [4], [7] · Step 1.1: [2], [7] · Step 1.2: [2] · Step 1.3: [4], [5]
- Gate `gate-screening-status` → evidence on host Step 1.1
- Stage 2: [1], [4], [5] · Step 2.1: [4], [5], [17] · Step 2.2: [1], [4] · Step 2.3: [4] ·
  Step 2.4: [1], [4], [5] · Step 2.5: [2], [4], [7]
- Gates `gate-early-testing-indicated` → Step 2.1; `gate-overt-diabetes`,
  `gate-early-abnormal-glucose` → Step 2.2
- Stage 3: [2], [4], [7] · Stage `stage-3-two-step`: [2], [4], [7] · Stage `stage-3-one-step`: [4], [7]
- Step 3.1: [2], [4], [7] · Step 3.2: [2], [3], [4], [7] · Step 3.3: [2], [4], [7] · Step 3.4:
  [2], [4], [5] · Step 3.5: [4], [7] · Step 3.6: [4], [5]
- Gates `gate-screening-strategy` → Step 3.1; `gate-gct-positive` → Step 3.2;
  `gate-100g-diagnostic` → Step 3.3; `gate-75g-diagnostic` → Step 3.5
- Lab-A1: [4] · Lab-A2: [4] · Lab-A3: [2], [4], [7] · Lab-A4: [2], [4], [7] · Lab-A5: [4], [7]
- Guid-A1: [2], [4] · Guid-A2: [4], [5] · Guid-A3: none citable, `[GAP]` · Guid-A4: [2], [5] · Guid-A5: [4], [5]
- Sched-A1 → Step 2.5 · Sched-A2 → Step 2.4 · CodeEntries → their host nodes

## A-17. Temporal horizon & status summary (EMITTED — review carefully)

| Gate | Condition on | horizon | status | window_days | Rationale |
|---|---|---|---|---|---|
| gate-overt-diabetes | labs 4548-4 > 6.49 | QUARTER | — | — | Early-pregnancy test. A preconception A1C within 90 days is acceptable ("if not screened preconception" [4]); older values are not |
| gate-early-abnormal-glucose | labs 4548-4 > 5.89 | QUARTER | — | — | Same datum and window as above, so one shared question |
| gate-early-abnormal-glucose | labs 4548-4 < 6.5 | QUARTER | — | — | As above |
| gate-gct-positive | labs 1504-0 > 139.9 | QUARTER | — | — | This screening episode. An early-pregnancy GCT (~12 wk) falls outside 90 days by 26 wk, so it cannot suppress the universal screen |
| gate-75g-diagnostic | labs 1552-9 > 91.9 | QUARTER | — | — | Diagnostic OGTT this episode |
| gate-75g-diagnostic | labs 1507-3 > 179.9 | QUARTER | — | — | As above |
| gate-75g-diagnostic | labs 1518-0 > 152.9 | QUARTER | — | — | As above |

No condition sets `window_days`; no labs carry `status`; no vitals or `patient.*` conditions.
Question gates carry no conditions.

## A-18. Gaps & fallbacks

### Not encodable on main

| # | Requirement | Why not | Fallback |
|---|---|---|---|
| A-G1 | Route by gestational age (<24 / ≥24 wk; <15 wk for early testing) | `patient.gestational_age_weeks` is a silent "no" when missing and cannot ask; the preview flow sends none | SELECT router `gate-screening-status` |
| A-G2 | "Diabetes not yet diagnosed" / "screening negative" | Chart gates have no negative arm | Router options |
| A-G3 | Early-testing risk rule (BMI AND ≥1 of 8, OR 2 standalone factors) | No nesting or counting; BMI not codeable in pregnancy (Z68 forbidden); several factors uncoded | Question gate |
| A-G4 | Carpenter–Coustan "≥2 of 4 values" | No N-of-M operator | Question gate |
| A-G5 | Early testing by *any* of A1C / FPG / OGTT | An OR over alternative tests asks forever for the test not drawn | Single designated test, HbA1c (D-6) |
| A-G6 | Two-result confirmation of overt diabetes (ADA Rec 2.1b) | Needs two dated results or two tests; the simulator dates nothing, and no "two abnormal" operator exists | Clinician text in Step 2.3 |
| A-G7 | Load-agnostic OGTT result codes | Gestational panels report generic post-dose LOINCs; thresholds depend on load | Gates on load-specific codes; site lab mapping (§0.6 #8) |

### Source gaps

- `[GAP]` **ACOG CPU 2024 [1] full text is paywalled** (abstract only). Unverified:
  - its early-screening risk-factor table;
  - its test preference;
  - its criteria preference and single-abnormal-value position;
  - its postpartum/immediate-postpartum wording.
- `[GAP]` **ACOG PB 190 [2] full text is paywalled** (acog.org shows "Reaffirmed 2026").
  PB 190 claims are verified through PubMed, ADA's and USPSTF's citations of it, and the
  predecessor PB 180 [3] text. Resolve with ACOG member access.
- `[GAP]` A GCT ≥200 mg/dL treated as diagnostic: no accessible source.
- `[GAP]` Primary text of ACOG PB 105 (bariatric surgery and pregnancy).

### Source conflicts

| # | Conflict | Resolution in this brief |
|---|---|---|
| A-C1 | Early abnormal glucose: ADA 2.31b defines and suggests counseling; ACOG no longer recommends early GDM screening; USPSTF I statement | Counseling-only branch, D-7 |
| A-C2 | Early test: ADA Rec 2.4 prefers plasma glucose in pregnancy vs the ADA-2 narrative applying A1C | HbA1c designated, D-6 |
| A-C3 | ADA says patients with early high-risk abnormal glucose may skip 24–28 wk screening (Rec 2.32), without defining the term precisely | Not encoded. Step 2.5 says to screen unless GDM management has begun |
| A-C4 | Strategy: ADA prefers one-step IADPSG; ACOG supports two-step | Router, D-5 |

### Simulator coverage `[SIM]`

Enterable today (seeded in `clinical_code_reference`): Z34.00, Z34.90, O09.40, O09.90, 4548-4,
1504-0, 1558-6. So these gates can be exercised with a Z34.00 patient:
- the router;
- `gate-early-testing-indicated`;
- `gate-overt-diabetes`;
- `gate-early-abnormal-glucose`;
- `gate-gct-positive`;
- `gate-100g-diagnostic`.

`gate-75g-diagnostic` and triggers on the other Z34/O09 leaves or O99.810 need seeding first.
`ensureClinicalCodeReference` exists but has no callers.

---

# PART B — `gestational-diabetes-management`

## B-1. Pathway metadata

- **Logical ID**: `gestational-diabetes-management` (new; distinct from archived
  `gdm-management-v1/-v2`; D-16)
- **Title**: Gestational Diabetes — Management, Delivery Planning and Postpartum Follow-up
- **Version**: 1
- **Category**: OBSTETRIC
- **Scope**: Outpatient care from GDM diagnosis. Covers:
  - antepartum: MNT, activity, weight gain, SMBG, pharmacotherapy (gated on glucose values
    above target), fetal surveillance and delivery-timing planning by control class;
  - postpartum: 4–12-week 75-g OGTT;
  - lifelong screening every 1–3 years.
  Intrapartum glucose management is out of scope. `[GAP]` No GDM intrapartum target was found
  in the sources read. Pregestational diabetes is out of scope.
- **Target population**: Patients with GDM diagnosed in the current pregnancy, postpartum
  patients after a GDM pregnancy, and patients with a history of GDM (long-term follow-up).
- **Condition codes** (trigger codes; OR semantics):

| Code | System | Description | Usage note | Grouping |
|---|---|---|---|---|
| O24.410 | ICD-10 | Gestational diabetes mellitus in pregnancy, diet controlled | primary trigger | gdm-antepartum |
| O24.414 | ICD-10 | Gestational diabetes mellitus in pregnancy, insulin controlled | primary trigger | gdm-antepartum |
| O24.415 | ICD-10 | Gestational diabetes mellitus in pregnancy, controlled by oral hypoglycemic drugs | primary trigger | gdm-antepartum |
| O24.419 | ICD-10 | Gestational diabetes mellitus in pregnancy, unspecified control | primary trigger | gdm-antepartum |
| O24.430 | ICD-10 | Gestational diabetes mellitus in the puerperium, diet controlled | postpartum trigger | gdm-postpartum |
| O24.434 | ICD-10 | Gestational diabetes mellitus in the puerperium, insulin controlled | postpartum trigger | gdm-postpartum |
| O24.435 | ICD-10 | Gestational diabetes mellitus in the puerperium, controlled by oral hypoglycemic drugs | postpartum trigger | gdm-postpartum |
| O24.439 | ICD-10 | Gestational diabetes mellitus in the puerperium, unspecified control | postpartum trigger | gdm-postpartum |
| Z86.32 | ICD-10 | Personal history of gestational diabetes | follow-up trigger — `[DECISION D-12]` | gdm-history |

**Deliberately excluded:** O24.42x (GDM in childbirth). These are delivery-admission codes
used inpatient; this is an outpatient pathway. Z79.4, Z79.84 and Z79.85 are not assigned with O24.4-
(ICD-10-CM I.C.15.i [17]).

## B-1b. Code sets

None.

## B-2. Stages

- **Stage 1 — GDM course status** *(root-connected; entry)*: routes antepartum, postpartum,
  long-term or new-pregnancy patients. [5]
- **Stage 2 — Antepartum management** *(branch-entry only, via `gate-gdm-phase` = pregnant
  with GDM)*: MNT, activity, weight gain, SMBG and glycemic review, fetal growth, and
  control-class planning. Every antepartum gate is hosted here, so none is evaluated for a
  postpartum or long-term patient. [2][5]
- **Stage 3 — Fasting hyperglycemia: basal insulin** *(branch-entry only, via
  `gate-fasting-above-target`)*. [2][3][5]
- **Stage 4 — Postprandial hyperglycemia (1-hour monitoring): prandial insulin** *(branch-entry
  only, via `gate-pp1h-above-target`)*. [2][3][5]
- **Stage 5 — Postprandial hyperglycemia (2-hour monitoring): prandial insulin** *(branch-entry
  only, via `gate-pp2h-above-target`)*. Its content is identical to Stage 4. It exists because
  two gates may not share a target (Rule 2), and the 1-h and 2-h gates cannot be merged into
  one OR without asking forever for the unmonitored timing (D-8). [2][3][5]
- **Stage `stage-6-a1` — A1GDM, well controlled: surveillance and delivery plan** *(branch-entry
  only, via `gate-control-class`; `stage_number` 6)*. [2][8][9]
- **Stage `stage-6-a2` — A2GDM, well controlled on medication: surveillance and delivery plan**
  *(branch-entry only, via `gate-control-class`; `stage_number` 6)*. [2][8][9]
- **Stage `stage-6-poor` — Poorly controlled GDM: surveillance and delivery plan** *(branch-entry
  only, via `gate-control-class`; `stage_number` 6)*. [3][8][9]
- **Stage 7 — Postpartum** *(branch-entry only, via `gate-gdm-phase` = postpartum ≤12 weeks)*:
  medication review, lactation and contraception, 4–12-week OGTT and interpretation, primary-care
  hand-off. [4][5][13][14][15]
- **Stage 8 — Long-term follow-up after GDM** *(branch-entry only, via `gate-gdm-phase` = more
  than 12 weeks postpartum or between pregnancies)*: lifelong screening every 1–3 years,
  prevention, preconception care. [4][5][15]

Only Stage 1 has a root `HAS_STAGE` edge.

## B-3. Steps

**Stage 1**

- **Step 1.1 — Establish GDM course status** *(unconditional; hosts `gate-gdm-phase`)*:
  whether the patient is pregnant with GDM this pregnancy, within 12 weeks postpartum, beyond
  that, or pregnant again. [5]
- **Step 1.2 — New pregnancy after prior GDM: early testing via the screening pathway**
  *(router target only)*: prior GDM is an early-testing criterion. Test before 15 weeks if not
  screened preconception, then screen at 24–28 weeks. Follow Part A. [4][5]

**Stage 2 — Antepartum management**

- **Step 2.1 — Confirm diagnosis and educate** *(unconditional)*:
  - Confirm the diagnostic basis (two-step CC or one-step IADPSG).
  - Explain GDM, its risks and the plan (Guid-B1).
  - Aspirin is not indicated for GDM alone. Assess preeclampsia risk factors per USPSTF
    (Guid-B7). [5][16]
- **Step 2.2 — Medical nutrition therapy with a registered dietitian** *(unconditional)*:
  - Individualized plan (Rec 15.14, C).
  - Minimum 175 g carbohydrate, 71 g protein and 28 g fiber daily.
  - 3 meals + 2–3 snacks (PB 190 Level C).
  - Whole foods, limit processed and sweetened foods, no ketogenic/paleo patterns.
  - 70–85% of patients are managed with lifestyle alone (Rec 15.15, A). [2][5]
- **Step 2.3 — Physical activity** *(unconditional)*: at least 150 min/week of moderate
  aerobic activity (30 min on ≥5 days). A 10–15-minute walk after meals is commonly advised.
  Stop-exercise warning signs apply. [2][3][10]
- **Step 2.4 — Gestational weight gain** *(unconditional)*: IOM 2009 targets by prepregnancy
  BMI (Guid-B4). Weight loss in pregnancy is not recommended. [5][11]
- **Step 2.5 — Self-monitoring of blood glucose and weekly review** *(unconditional; hosts
  `gate-fasting-above-target` and `gate-pp-timing`)*:
  - Test 4 times daily: fasting, plus 1 h **or** 2 h after each meal.
  - Targets: fasting <95; 1-h <140 or 2-h <120 mg/dL (Rec 15.8, B).
  - Logs are generally reviewed weekly, more often when many values are abnormal. Telehealth
    plus in-person care is appropriate (Rec 15.16, A).
  - A1C is secondary only.
  - CGM is individualized: no recommendation for or against it in GDM (Rec 15.10, E).
  - Glyburide and non-insulin agents other than metformin are listed here as `avoid`
    (Med-B5, Med-B6).
  Sources: [2][3][5]
- **Step 2.6 — Review 1-hour postprandial values** *(router target only, `gate-pp-timing` =
  1-hour; hosts `gate-pp1h-above-target`)*. [5]
- **Step 2.7 — Review 2-hour postprandial values** *(router target only, `gate-pp-timing` =
  2-hour; hosts `gate-pp2h-above-target`)*. [5]
- **Step 2.8 — Fetal growth assessment late in the third trimester** *(unconditional)*:
  - Assess fetal growth by ultrasonography or clinical examination late in the third trimester.
  - Counsel on scheduled cesarean if estimated fetal weight is **≥4,500 g**.
  - Ultrasound's LGA prediction is imperfect (22% of fetuses suspected LGA were LGA at birth).
  - `[GAP]` No source specifies ~36 weeks or serial scans. [2][3]
- **Step 2.9 — Classify glycemic control and plan surveillance and delivery** *(unconditional;
  hosts `gate-control-class`)*: A1 (diet-controlled) vs A2 (medication-requiring), and well vs
  poorly controlled. Re-classify as treatment changes. [2][8][9]
- **Step 2.10 — Glycemic control not yet established: reassess** *(router target only)*: newly
  diagnosed, or treatment just changed. Review SMBG weekly and classify at the next review. No
  surveillance or delivery plan yet. [3][5]

**Stage 3 — Basal insulin**

- **Step 3.1 — Start or up-titrate bedtime NPH insulin for fasting hyperglycemia** *(Stage 3,
  unconditional)*:
  - Insulin is preferred (Rec 15.17, A).
  - For isolated fasting hyperglycemia, bedtime intermediate-acting (NPH) insulin may be
    adequate.
  - Typical total starting dose if a multi-injection regimen is needed: 0.7–1.0 units/kg/day
    in divided doses.
  - Adjust to the monitored values at each time of day.
  - Metformin is an alternative if insulin is declined, cannot be given safely, or is unaffordable (not with
    hypertension, preeclampsia or IUGR risk).
  - Glucagon for everyone on insulin.
  - Hypoglycemia education (Guid-B5).
  - `[GAP]` No numeric titration algorithm in any source read.
  Sources: [2][3][5][6]

**Stage 4 / Stage 5 — Prandial insulin**

- **Step 4.1 — Start or up-titrate prandial rapid-acting insulin (1-hour monitoring)** *(Stage
  4, unconditional)*:
  - Rapid-acting insulin analog (lispro or aspart) before the meal(s) whose postprandial value
    is above target. For example, elevated post-breakfast values alone may need only
    pre-breakfast short-acting insulin.
  - Lispro/aspart are preferred over regular insulin.
  - Metformin alternative and glucagon as in Step 3.1. Guid-B5.
  Sources: [2][3][5][6]
- **Step 5.1 — Start or up-titrate prandial rapid-acting insulin (2-hour monitoring)** *(Stage
  5, unconditional)*: identical content to Step 4.1. Separate nodes (Med-B2′, Med-B3c, Med-B4c, Guid-B5c)
  carry the same drug names, so the merge dedupes them. [2][3][5][6]

**Stage 6 — Surveillance and delivery by control class**

- **Step 6.1 — A1GDM well controlled: no routine antenatal testing; delivery 39 0/7–40 6/7
  weeks** *(Stage `stage-6-a1`)*:
  - Before 40 0/7 weeks there is no consensus on antenatal testing for diet-controlled GDM
    without comorbidities.
  - Do not deliver before 39 weeks unless otherwise indicated. Expectant management up to
    40 6/7 weeks is generally appropriate. [2][8][9]
- **Step 6.2 — A2GDM well controlled: antenatal testing from 32 0/7 weeks, once or twice
  weekly** *(Stage `stage-6-a2`)*:
  - NST and/or BPP (test type per local practice).
  - Testing that includes amniotic-fluid assessment is common, because of polyhydramnios
    risk. [3][8]
- **Step 6.3 — A2GDM well controlled: delivery 39 0/7–39 6/7 weeks** *(Stage
  `stage-6-a2`)*. [2][9]
- **Step 6.4 — Continue and titrate current glucose-lowering therapy** *(Stage
  `stage-6-a2`)*:
  - This is the continuation route for a treated patient whose values are **at** target. The
    initiation gates (Stages 3–5) correctly stay closed for her.
  - No medication nodes here. The patient's own regimen is on her chart, and adding nodes
    would create lane conflicts.
  - If on glyburide, stop at least 2 weeks before expected delivery (FDA label [21]). [2][5][21]
- **Step 6.5 — Poorly controlled GDM: antenatal testing from 32 0/7 weeks, twice weekly**
  *(Stage `stage-6-poor`)*. [8]
- **Step 6.6 — Poorly controlled GDM: individualized late-preterm/early-term delivery**
  *(Stage `stage-6-poor`)*:
  - CO 831: late preterm/early term, individualized.
  - PB text: 37 0/7–38 6/7 weeks may be justified. 34 0/7–36 6/7 is reserved for patients who
    fail in-hospital attempts to improve control or have abnormal antepartum testing.
  - Intensify therapy.
  Sources: [3][9]

**Stage 7 — Postpartum**

- **Step 7.1 — Review glucose-lowering medication after delivery** *(unconditional)*:
  - Patients with GDM usually do not need diabetes medication postpartum.
  - Insulin requirements fall dramatically immediately after delivery (Rec 15.26, C).
  - Watch for hypoglycemia in patients who continue insulin while breastfeeding. [5]
- **Step 7.2 — Lactation, contraception and psychosocial check** *(unconditional)*:
  - Breastfeeding is recommended (Rec 15.28, A/B).
  - Contraceptive plan (Rec 15.27, A).
  - Psychosocial assessment (Rec 15.29, E). [5]
- **Step 7.3 — 75-g 2-hour OGTT at 4–12 weeks postpartum** *(unconditional; hosts
  `gate-pp-ogtt-diabetes` and `gate-pp-ogtt-prediabetes`)*:
  - Use nonpregnancy criteria (Rec 15.30 / 2.33, B).
  - OGTT is preferred over A1C, which is falsely lowered after delivery.
  - For patients who cannot tolerate or decline the OGTT, A1C at 6–12 months may be
    considered.
  - `[GAP]` The ACOG CPU 2024 immediate-postpartum OGTT position is unverified (paywall). [4][5][13]
- **Step 7.4 — Postpartum OGTT in the diabetes range: confirm and refer** *(gated by
  `gate-pp-ogtt-diabetes`)*: FPG ≥126 or 2-h ≥200 mg/dL. Confirm per ADA (a second abnormal
  result unless unequivocal). Diagnose type 2 diabetes and refer. [3][4]
- **Step 7.5 — Postpartum prediabetes: intensive lifestyle and/or metformin** *(gated by
  `gate-pp-ogtt-prediabetes`)*:
  - FPG 100–125 or 2-h 140–199 mg/dL.
  - With overweight/obesity: intensive lifestyle intervention and/or metformin (Rec 15.32, A).
  - Test yearly. [3][5]
- **Step 7.6 — Hand off to primary care; lifelong screening** *(unconditional)*:
  - Record GDM in the problem list (Z86.32 after the puerperium).
  - Primary-care follow-up.
  - ASCVD risk assessment.
  - Screen every 1–3 years for life, even after a normal postpartum OGTT (Rec 15.31, B). [4][5][15]

**Stage 8 — Long-term follow-up**

- **Step 8.1 — Diabetes screening every 1–3 years** *(unconditional; hosts
  `gate-longterm-diabetes` and `gate-longterm-prediabetes`)*: A1C, FPG or 75-g OGTT (any
  recommended test). Preconception screening and care before a future pregnancy (Rec 15.4, E).
  Losing ≥5% of body weight before the next pregnancy lowers GDM recurrence. [4][5]
- **Step 8.2 — A1C in the diabetes range: confirm and manage** *(gated by
  `gate-longterm-diabetes`)*. [4]
- **Step 8.3 — A1C in the prediabetes range: intensive lifestyle and/or metformin** *(gated by
  `gate-longterm-prediabetes`)*. [4][5]

## B-4. Decision points

None (all decisions are gates; §B-4b).

## B-4b. Gates

**Framing note.** Three routers (questions) and seven numeric chart gates. Every chart gate
is a single-test gate, or an OR over values from **one** test, with `on_unresolved: ask`.

- **Gate `gate-gdm-phase` — Where is this patient in the GDM course?**
  - Attached to: `step-1-1` · **Router**, SELECT. Branches:
    - `"Pregnant — GDM diagnosed this pregnancy"` → `stage-2`
    - `"Delivered within the last 12 weeks after a GDM pregnancy"` → `stage-7`
    - `"More than 12 weeks after a GDM pregnancy, not currently pregnant"` → `stage-8`
    - `"Pregnant again — GDM not diagnosed in this pregnancy"` → `step-1-2`
  - Exclusively gated: yes.
  - Type: **question** · SELECT · Default behavior: **skip**
  - Prompt: "Where is this patient in the course of gestational diabetes? Pregnant with GDM
    diagnosed this pregnancy; delivered within the last 12 weeks after a GDM pregnancy; more
    than 12 weeks after a GDM pregnancy and not pregnant; or pregnant again without GDM
    diagnosed in this pregnancy."
  - `[NOT ENCODABLE]` **Why not a data gate:**
    - Antepartum needs "not delivered", which is negative.
    - O24.43x vs O24.41x could separate phases **positively**, but Z86.32 patients (D-12)
      have no phase code.
    - Postpartum weeks have no anchor.
  - **This router is what keeps a postpartum patient's session from asking SMBG questions.**
    Every SMBG gate is hosted in Stage 2, which the router excludes.
  - Rationale & source: [5] → Step 1.1.

- **Gate `gate-fasting-above-target` — Fasting SMBG at or above 95 mg/dL?**
  - Attached to: `step-2-5` · Branches to: `stage-3`
  - Exclusively gated: yes. Stage 3 has **no root edge**; this is the fix for the retired
    v2's inert gate (§0.2b).
  - Type: **patient_attribute** (coded) · Default behavior: **skip**
  - Condition: field `labs`, `greater_than`, value `41604-0`, system `LOINC`, threshold
    **94.9**, display `"Fasting glucose, self-monitored (mg/dL)"`, horizon `{days: 14}`.
  - On unresolved: **ask**. With no recent fasting value, basal insulin is **held**, not
    offered and not silently dropped. This is Josh's rule, and it is exactly what prevents
    the retired failure: a patient at target never reaches insulin, and a patient with no
    data is asked.
  - Physiologic drift: insulin resistance rises through the late second and third trimesters,
    so a patient controlled on MNT can cross the threshold later. The gate reads the latest
    value on every visit. Absolute target: <95 mg/dL (insulin-treated: 70–95, ADA Table
    15.2). No trend operator is used, so no response rate applies.
  - `[DECISION D-9]` The numeric gate alone. Guidelines say "consistently" above target [2][3]
    and give no count or %; `count_in_window` cannot count above-threshold values.
    **Offered, not built:** chain this gate to a branch-entry stage holding a BOOLEAN
    question "Values persistently above target over ~1–2 weeks of MNT despite adherence?"
    before Stage 3.
  - `[DECISION D-10]` horizon {days: 14}.
  - `[SIM]` see §B-18.
  - Rationale & source: [5] Rec 15.8, 15.15, 15.17; [3] → Step 2.5.

- **Gate `gate-pp-timing` — Which postprandial timing does the patient monitor?**
  - Attached to: `step-2-5` · **Router**, SELECT. Branches:
    - `"1 hour after meals"` → `step-2-6`
    - `"2 hours after meals"` → `step-2-7`
  - Exclusively gated: yes.
  - Type: **question** · SELECT · Default behavior: **skip**
  - Prompt: "Does this patient check postprandial glucose at 1 hour or at 2 hours after meals?"
  - Why: an OR over the 1-h (>139.9) and 2-h (>119.9) conditions with `ask` would, for a
    patient monitoring at 1 h with a normal value, **ask for a 2-h value forever**. `default`
    would violate the ask-when-missing rule. ADA and ACOG accept either timing [5][3]
    (D-8).
  - Rationale & source: [3][5] → Step 2.5.

- **Gate `gate-pp1h-above-target` — 1-hour postprandial SMBG at or above 140 mg/dL?**
  - Attached to: `step-2-6` · Branches to: `stage-4`
  - Exclusively gated: yes.
  - Type: **patient_attribute** (coded) · Default behavior: **skip**
  - Condition: field `labs`, `greater_than`, value `10449-7`, system `LOINC`, threshold
    **139.9**, display `"Glucose 1 h after meal, self-monitored (mg/dL)"`, horizon `{days: 14}`.
  - On unresolved: **ask**. Drift, target and D-9/D-10 as for the fasting gate.
  - Rationale & source: [5] Rec 15.8; [3] → Step 2.6.

- **Gate `gate-pp2h-above-target` — 2-hour postprandial SMBG at or above 120 mg/dL?**
  - Attached to: `step-2-7` · Branches to: `stage-5`
  - Exclusively gated: yes.
  - Type: **patient_attribute** (coded) · Default behavior: **skip**
  - Condition: field `labs`, `greater_than`, value `6689-4`, system `LOINC`, threshold
    **119.9**, display `"Glucose 2 h after meal, self-monitored (mg/dL)"`, horizon `{days: 14}`.
  - On unresolved: **ask**. As above.
  - Rationale & source: [5] Rec 15.8; [3] → Step 2.7.

- **Gate `gate-control-class` — GDM class and glycemic control**
  - Attached to: `step-2-9` · **Router**, SELECT. Branches:
    - `"Newly diagnosed or treatment just changed — control not yet established"` → `step-2-10`
    - `"A1GDM — well controlled on nutrition and exercise"` → `stage-6-a1`
    - `"A2GDM — well controlled on medication"` → `stage-6-a2`
    - `"Poorly controlled (on nutrition therapy or medication)"` → `stage-6-poor`
  - Exclusively gated: yes.
  - Type: **question** · SELECT · Default behavior: **skip**
  - Prompt: "How would you classify this patient's gestational diabetes today? Newly
    diagnosed or treatment just changed (control not yet established); A1GDM well controlled
    on nutrition and exercise; A2GDM well controlled on medication; or poorly controlled."
  - `[NOT ENCODABLE]` **Why not a data gate:**
    - "Well" vs "poorly controlled" is judgment. It needs a proportion of values at target,
      which cannot be counted (§0.6 #5).
    - A1 would need "no glucose-lowering medication", which is negative.
    - A chart gate on O24.414/O24.415 could open the **A2** row positively, but it cannot
      distinguish well from poorly controlled, and it would share targets with this router
      (Rule 2).
  - The O24.41x control digit is shown to the clinician by the prompt context; it is not used.
  - **Mirror failure handled here:** a patient on insulin at target selects "A2 well
    controlled" and receives Step 6.4 (continue therapy), even though the initiation gates are
    closed.
  - Rationale & source: [2][8][9] → Step 2.9.

- **Gate `gate-pp-ogtt-diabetes` — Postpartum OGTT in the diabetes range?**
  - Attached to: `step-7-3` · Branches to: `step-7-4`
  - Exclusively gated: yes.
  - Type: **compound**, **OR** · Default behavior: **skip**
  - Conditions (coded), field `labs`, `greater_than`, system `LOINC`, horizon `{days: 60}`:
    - `1552-9` threshold **125.9**, display `"Glucose fasting, pre 75 g glucose (mg/dL)"`
    - `1518-0` threshold **199.9**, display `"Glucose 2 h post 75 g glucose (mg/dL)"`
  - On unresolved: **ask** (`[DECISION D-13]`). Both values come from one test. Caveat: at a
    visit in weeks 0–4, before the OGTT is due, this asks for a value that cannot exist yet.
    The subtree is only held; nothing is wrongly shown. `default` would avoid the premature
    question.
  - `[DECISION D-14]` horizon {days: 60} keeps the **antepartum** diagnostic OGTT (24–28 wk,
    typically ≥9 weeks before delivery) out of the postpartum read. Read in, a GDM-range
    antepartum 2-h value of 160 would satisfy the prediabetes gate. Late-diagnosed patients
    delivered within ~8 weeks of their OGTT remain a residual risk.
  - Rationale & source: [4] Rec 2.33, Table 2.1; [5] Rec 15.30 → Step 7.3.

- **Gate `gate-pp-ogtt-prediabetes` — Postpartum OGTT in the prediabetes range (or higher)?**
  - Attached to: `step-7-3` · Branches to: `step-7-5`
  - Exclusively gated: yes.
  - Type: **compound**, **OR** · Default behavior: **skip**
  - Conditions (coded), field `labs`, `greater_than`, system `LOINC`, horizon `{days: 60}`:
    - `1552-9` threshold **99.9**, display as above
    - `1518-0` threshold **139.9**, display as above
  - On unresolved: **ask** (shares datum-keyed questions with `gate-pp-ogtt-diabetes`).
  - **Not exclusive of the diabetes gate.** A diabetes-range result satisfies this gate too,
    so Step 7.5 shows alongside Step 7.4. Excluding it would need "<126 AND <200" under an OR
    of bands, i.e. `(A AND B) OR (C AND D)`, which has no encoding. Step 7.5's text is not
    wrong for a diabetic patient, and Step 7.4 supersedes it.
  - Rationale & source: [4] Table 2.2; [5] Rec 15.32 → Step 7.3.

- **Gate `gate-longterm-diabetes` — Follow-up A1C in the diabetes range?**
  - Attached to: `step-8-1` · Branches to: `step-8-2`
  - Exclusively gated: yes.
  - Type: **patient_attribute** (coded) · Default behavior: **skip**
  - Condition: field `labs`, `greater_than`, value `4548-4`, system `LOINC`, threshold
    **6.49**, display `"Hemoglobin A1c (%)"`, horizon `{days: 1095}`.
  - On unresolved: **ask**. No A1C in 3 years means screening is overdue, and asking is the
    prompt to test.
  - Designated test is A1C (single-test gate, same reasoning as D-6). FPG/OGTT results are
    read by the clinician.
  - Rationale & source: [4] Rec 2.34, Table 2.1 → Step 8.1.

- **Gate `gate-longterm-prediabetes` — Follow-up A1C 5.7–6.4%?**
  - Attached to: `step-8-1` · Branches to: `step-8-3`
  - Exclusively gated: yes.
  - Type: **compound**, **AND** · Default behavior: **skip**
  - Conditions (coded), field `labs`, value `4548-4`, system `LOINC`, display
    `"Hemoglobin A1c (%)"`, horizon `{days: 1095}`:
    - `greater_than` threshold **5.69**
    - `less_than` threshold **6.5**
  - On unresolved: **ask** (same datum; one question).
  - Mutually exclusive with `gate-longterm-diabetes`.
  - Rationale & source: [4] Table 2.2; [5] Rec 15.32 → Step 8.1.

## B-5. Medications

`clinical_role` lanes: `gdm-basal-insulin`, `gdm-prandial-insulin`, `gdm-oral-agent`,
`diabetes-prevention-metformin`. There is no lane overlap with any live or draft pathway
(§0.4). Complementary drugs are in different lanes, so they never conflict. Nodes that repeat
across Stages 3/4/5 carry **identical names**, so the merge dedupes them.

- **Med-B1 — NPH insulin (insulin isophane, human)** (on Step 3.1)
  - Role: first_line · Clinical role: `gdm-basal-insulin`
  - Dose: bedtime NPH for isolated fasting hyperglycemia. If multiple injections are needed,
    typical total starting dose 0.7–1.0 units/kg/day in divided doses. Titrate to monitored
    values. SC.
  - Escalates to: none.
  - Notes:
    - Human insulin does not cross the placenta.
    - Glargine is also widely used in pregnancy (observational data), but it is not a separate
      node (D-15).
    - Detemir has been **withdrawn from the market**; do not use.
    - Degludec's 3–4-day titration interval limits frequent adjustment.
  - Source: [2][3][5]
- **Med-B2 — Rapid-acting insulin analog (insulin lispro or insulin aspart)** (on Step 4.1;
  duplicate node Med-B2′ on Step 5.1)
  - Role: first_line · Clinical role: `gdm-prandial-insulin`
  - Dose: before the meal(s) with above-target postprandial values; individualized. SC.
  - Escalates to: none.
  - Notes: one node for two interchangeable analogs, which avoids a same-lane conflict
    between them. Regular human insulin is acceptable, but lispro/aspart are preferred. Both
    analogs are "widely considered safe and effective" in pregnancy (ADA).
  - Source: [3][5]
- **Med-B3 — Metformin** (one node per host, same name: Med-B3a on Step 3.1, Med-B3b on Step 4.1, Med-B3c on Step 5.1)
  - Role: alternative · Clinical role: `gdm-oral-agent`
  - Dose: 500 mg nightly for 1 week, then 500 mg twice daily with meals. Titrate. FDA label
    maximum 2,550 mg/day. (PB text states 2,500–3,000 mg/day; the label ceiling governs.) Oral.
  - Escalates to: Med-B1 / Med-B2 (supplemental insulin: needed in 26–46% of patients; 46% in
    MiG).
  - Notes:
    - **Not first-line** (ADA Rec 15.21, A/B). It crosses the placenta, with cord levels as
      high as or higher than maternal.
    - Offspring were heavier at 9 years (MiG TOFU).
    - A reasonable alternative when the patient declines insulin or cannot administer it
      safely (ACOG PB 180 Level B wording [3]; PB 190's "reasonable alternative" framing is
      secondary-confirmed only). ADA also names **cost**, comprehension and cultural factors
      [5]. The "cannot afford" clause attributed to PB 190 is unverified, so it is not cited
      to ACOG.
    - SMFM calls metformin a reasonable, safe first-line alternative, noting that about half of
      patients will still need insulin [12]. The conflict is noted.
    - **Do not use with hypertension, preeclampsia or IUGR risk** (ADA; see D-2).
    - Contraindicated at eGFR <30; do not initiate at eGFR 30–45 (label).
    - Counsel on the limited long-term safety data.
  - Source: [2][5][12][19]
- **Med-B4 — Glucagon (emergency)** (one node per host, same name: Med-B4a on Step 3.1, Med-B4b on Step 4.1, Med-B4c on Step 5.1)
  - Role: first_line · Clinical role: n/a (non-conflicting safety adjunct)
  - Dose: per product label, for severe hypoglycemia. Prescribe for everyone taking insulin
    (ADA Rec 6.16, A).
  - Escalates to: none.
  - Source: [6]
- **Med-B5 — Glyburide** (on Step 2.5)
  - Role: **avoid** (`[DECISION D-11]`) · Clinical role: `gdm-oral-agent`
  - Dose: n/a. If used despite this: 2.5–20 mg/day in divided doses. Stop ≥2 weeks before
    expected delivery (label).
  - Escalates to: none.
  - Notes:
    - Not first-choice (PB 190, Level B; ADA 15.21).
    - Crosses the placenta (cord levels 50–70% of maternal).
    - More neonatal hypoglycemia and macrosomia.
    - INDAO failed noninferiority vs insulin, and SUGAR-DIP's metformin→glyburide strategy
      failed noninferiority for LGA.
    - `avoid` hard-suppresses the name "Glyburide" in every co-matched plan. No other
      pathway uses it.
  - Source: [2][5][18][20][21]
- **Med-B6 — Non-insulin glucose-lowering agents other than metformin (GLP-1 RAs, SGLT2
  inhibitors, DPP-4 inhibitors, thiazolidinediones, other sulfonylureas)** (on Step 2.5)
  - Role: avoid · Clinical role: n/a
  - Notes: lack long-term safety data and are not recommended in pregnancy (ADA 15.21, E).
    GLP-1 RAs should be stopped before pregnancy. Name-based suppression will not catch
    specific product names in other pathways; this node is informational.
  - Source: [5]
- **Med-B7 — Metformin (diabetes prevention)** (one node per host, same name: Med-B7a on Step 7.5, Med-B7b on Step 8.3)
  - Role: acceptable · Clinical role: `diabetes-prevention-metformin`
  - Dose: `[GAP]` no dose given in ADA Section 15 for this indication. Titrate per label;
    clinician-directed. Oral.
  - Notes: postpartum prediabetes with overweight/obesity: intensive lifestyle and/or
    metformin (Rec 15.32, A; the DPP data show 40% reduction in progression over 10 years).
    Compatible with breastfeeding per clinician judgment. `[GAP]` Not addressed in the sources
    read.
  - Source: [5]

## B-6. Lab tests

- **Lab-B1 — Fasting glucose, self-monitored** (on Step 2.5): LOINC `41604-0` "Fasting glucose
  [Mass/volume] in Capillary blood by Glucometer". [5]
- **Lab-B2 — 1-hour postprandial glucose, self-monitored** (on Step 2.6): LOINC `10449-7`
  "Glucose [Mass/volume] in Serum or Plasma --1 hour post meal". [5]
- **Lab-B3 — 2-hour postprandial glucose, self-monitored** (on Step 2.7): LOINC `6689-4`
  "Glucose [Mass/volume] in Blood --2 hours post meal". [5]

> **`[DECISION D-18]` SMBG LOINC selection. These three codes are what the three
> pharmacotherapy gates read.** Wave-2 verification (LOINC 2.82) found:
> - **Fasting:** `41604-0` is the glucometer-specific fasting code (alternative: `1556-0`
>   "Fasting glucose in Capillary blood").
> - **1-hour postprandial:** there is **no capillary or whole-blood mg/dL code**. `10449-7`
>   (serum/plasma) is the only mass-unit 1-h post-meal code found. The NLM search was not
>   exhaustive.
> - **2-hour postprandial:** `6689-4` (whole blood) is the closest to a fingerstick.
>   `1521-4` is the serum/plasma alternative. The local seed mislabels 1521-4 as a urine
>   strip. The only capillary code, `14760-3`, is mmol/L only, and would make 120 mg/dL a
>   120 mmol/L threshold.
>
> **Real-world risk:** glucometer and CGM feeds usually arrive as untimed `41653-7`
> ("Glucose in Capillary blood by Glucometer") or `32016-8`, with timing in metadata. A gate
> keyed to timed codes will **ask** rather than read those values. It asks, not silently
> denies, because `on_unresolved: ask`. Mapping home-glucose feeds to timed LOINCs is an
> integration task outside the pathway. There is no unit check on coded conditions (GHTN
> G7), so pin mass-unit codes only.
- **Lab-B4 — Hemoglobin A1c (secondary measure)** (on Step 2.5): LOINC 4548-4. A secondary
  measure only in pregnancy (ADA). [5]
- **Lab-B5 — Postpartum 75-g 2-hour OGTT** (on Step 7.3): LOINC 1552-9 (fasting), 1518-0 (2 h),
  serum/plasma. [4][5]
- **Lab-B6 — Hemoglobin A1c (follow-up screening)** (on Step 8.1): LOINC 4548-4. [4]
- **Lab-B7 — Fasting plasma glucose (follow-up screening alternative)** (on Step 8.1): LOINC
  1558-6. Not gated (single-test gate uses A1C). [4]

## B-7. Imaging

- **Img-B1 — Obstetric ultrasound for fetal growth** (on Step 2.8): modality US, body_region
  pregnant uterus, code **76816** (CPT). Indication: fetal growth assessment late in the
  third trimester; EFW ≥4,500 g prompts cesarean counseling. The code matches GHTN's growth
  scan, so co-matched plans dedupe. [2][3]

## B-8. Procedures

- **Proc-B1 — Fetal non-stress test** (one node per host, same code: Proc-B1a on Step 6.2, Proc-B1b on Step 6.5): CPT **59025**. Antenatal
  surveillance from 32 0/7 weeks. [8]
- **Proc-B2 — Fetal biophysical profile with non-stress testing** (one node per host, same code: Proc-B2a on Step 6.2, Proc-B2b on Step 6.5): CPT
  **76818**. The alternative or complement to NST; includes amniotic fluid. [3][8]

Both codes are identical to GHTN's, so they dedupe.

## B-9. Guidance

All topics are GDM-prefixed. The merge dedupes Guidance by topic across pathways (§0.4).

- **Guid-B1 — topic `GDM: what it means for you and your baby`** (on Step 2.1), education:
  - "Gestational diabetes raises the chance of a large baby, a difficult birth, low blood sugar
    in your newborn, and preeclampsia.
  - Keeping your blood sugar in range lowers these risks.
  - Most patients (about 70–85%) manage it with food and activity changes alone. Some need
    insulin, which is safe for your baby."
  Sources: [3][5]
- **Guid-B2 — topic `GDM eating plan`** (on Step 2.2), lifestyle:
  - "You will meet a dietitian to build a plan that fits you. Eat three meals and two to three
    snacks each day to spread out carbohydrates.
  - Eat at least 175 grams of carbohydrate daily. Do not cut carbohydrates out.
  - Choose whole foods (vegetables, fruit, beans, whole grains, lean protein, nuts, fish) and
    limit sweets, sweetened drinks and processed foods. Avoid keto or very-low-carb diets."
  Sources: [2][5]
- **Guid-B3 — topic `GDM activity`** (on Step 2.3), lifestyle:
  - "Aim for at least 150 minutes a week of moderate activity, such as 30 minutes on 5 days.
    A 10–15-minute walk after each meal helps lower blood sugar.
  - If you use insulin, eat before long or intense exercise; more than 45 minutes can cause
    low blood sugar.
  - Stop and call us for vaginal bleeding, fluid leaking, regular painful contractions, chest
    pain, dizziness, or calf pain or swelling."
  Sources: [3][10]
- **Guid-B4 — topic `GDM pregnancy weight gain`** (on Step 2.4), lifestyle:
  - "Healthy total weight gain for one baby depends on your weight before pregnancy:
    - underweight (BMI under 18.5): 28–40 lb;
    - normal (18.5–24.9): 25–35 lb;
    - overweight (25–29.9): 15–25 lb;
    - obesity (30 or higher): 11–20 lb.
  - Losing weight during pregnancy is not recommended."
  - Note: ADA prints 10–20 lb for obesity; IOM/ACOG CO 548 give 11–20 lb, which is used here.
  Sources: [5][11]
- **Guid-B5 — topic `GDM on insulin: low blood sugar`** (one node per host, same topic and text: Guid-B5a on Step 3.1, Guid-B5b on Step 4.1, Guid-B5c on Step 5.1),
  safety-netting:
  - "A blood sugar below 70 on your meter (below 63 on a sensor) is low. Signs can include shakiness, sweating, a fast heartbeat,
    hunger or confusion.
  - Take 15 grams of fast sugar (4 oz juice or glucose tablets), recheck in 15 minutes, and
    repeat if still low.
  - Keep glucagon at home and teach a family member to use it. Call 911 if you cannot safely
    swallow or are not fully alert. Tell us about any low."
  - `[GAP]` The symptom list is not pregnancy-specific (ADA Section 6 general).
  Sources: [5][6]
- **Guid-B6 — topic `GDM checking your blood sugar`** (on Step 2.5), education:
  - "Check four times a day: when you wake up (before eating), and 1 hour (or 2 hours, as we
    agree) after breakfast, lunch and dinner.
  - Targets: fasting under 95; 1 hour after meals under 140, or 2 hours under 120.
  - Share your log with us every week."
  Sources: [3][5]
- **Guid-B7 — topic `GDM and aspirin`** (on Step 2.1), education: "Gestational diabetes by
  itself is not a reason to take low-dose aspirin. We check your other risk factors for
  preeclampsia and will recommend aspirin if you qualify." [5][16]
- **Guid-B8 — topic `GDM after delivery: your follow-up test`** (on Step 7.3), education:
  - "Gestational diabetes usually goes away after birth, but it raises your lifetime chance of
    type 2 diabetes (about 50–60%).
  - A 2-hour glucose test 4–12 weeks after delivery checks whether your sugar has returned to
    normal. After that, get tested every 1–3 years for life, and before any future pregnancy."
  Sources: [4][5]
- **Guid-B9 — topic `GDM breastfeeding and contraception`** (on Step 7.2), education:
  - "Breastfeeding is recommended and lowers your future diabetes risk.
  - If you are still on insulin, watch for lows while nursing.
  - We will plan birth control that fits you."
  Sources: [5]
- **Guid-B10 — topic `GDM long-term health`** (one node per host, same topic and text: Guid-B10a on Step 7.6, Guid-B10b on Step 8.1), lifestyle:
  - "A history of gestational diabetes raises your risk of type 2 diabetes and heart disease.
  - Stay active, aim for a healthy weight (losing 5% or more before another pregnancy lowers
    the chance of GDM again), and get diabetes testing every 1–3 years and before planning
    another pregnancy."
  Sources: [5][15]

## B-10. Quality metrics

- **QM-B1 — Postpartum diabetes screening after GDM** (on Step 7.3):
  - Steward: SMFM (Special Statement 2023; not CMS/NCQA-adopted).
  - Denominator: patients who gave birth with a GDM diagnosis (O24.419) during the pregnancy,
    plus ≥2 prenatal E&M visits with GDM or global OB care.
  - Numerator: 75-g 2-h GTT at 4–12 weeks (28–84 days) postpartum, identified by CPT
    82947 + 82950 the same day, or 82951.
  - Ideal 100%; typical 15–50%. [13]
- **QM-B2 — Maternity Care: Postpartum Follow-up and Care Coordination (MIPS Quality ID #336),
  GDM glucose-screen component** (on Step 7.6):
  - Steward: CMS.
  - Denominator: deliveries with a postpartum visit ≤12 weeks.
  - Numerator: all 8 components, including "Postpartum Glucose Screening for Gestational
    Diabetes" (any glucose screen ≤12 weeks postpartum). [14]

## B-11. Schedules

- **Sched-B1** (on Step 2.5): "4 times daily". Description: "SMBG fasting + 1 h or 2 h after
  each meal. Once controlled on diet, frequency may be reduced but rarely below 2/day." [3]
- **Sched-B2** (on Step 2.5): "weekly". Description: "Review SMBG log. Review more often if many
  values are abnormal, less often if stable and normal. Values at or above target trigger the
  pharmacotherapy gates." [3]
- **Sched-B3** (on Step 6.2): "once or twice weekly from 32 0/7 weeks". Description: "Antenatal
  testing, A2GDM well controlled." [8]
- **Sched-B4** (on Step 6.5): "twice weekly from 32 0/7 weeks". Description: "Antenatal testing,
  poorly controlled GDM." [8]
- **Sched-B5** (on Step 7.3): "4–12 weeks postpartum". Description: "75-g 2-hour OGTT, nonpregnancy
  criteria. If declined or not tolerated, A1C at 6–12 months." [4][5]
- **Sched-B6** (on Step 7.6): "every 1–3 years, lifelong". Description: "Diabetes/prediabetes
  screening after GDM; yearly if prediabetes." [3][4][5]

## B-12. Prerequisites (REQUIRES)

- `stage-3` REQUIRES `step-2-2`: MNT precedes pharmacotherapy. Medication is used when
  nutrition and exercise fail (PB, Level A). Catch-up surfaces the RDN referral if missing.
- `stage-4` REQUIRES `step-2-2`, and `stage-5` REQUIRES `step-2-2`: same.
- `step-7-4` REQUIRES `step-7-3`; `step-7-5` REQUIRES `step-7-3`: interpretation needs the OGTT.

Acyclic. No prior_node_result gates. `[BLOCKED — prior_node_result]` is not needed, because
the A1 → A2 reclassification is carried by the `gate-control-class` router.

## B-13. Code entries

| Code | System | Description | Attached to |
|---|---|---|---|
| 41604-0 | LOINC | Fasting glucose [Mass/volume] in Capillary blood by Glucometer | Lab-B1 |
| 10449-7 | LOINC | Glucose [Mass/volume] in Serum or Plasma --1 hour post meal | Lab-B2 |
| 6689-4 | LOINC | Glucose [Mass/volume] in Blood --2 hours post meal | Lab-B3 |
| 4548-4 | LOINC | Hemoglobin A1c/Hemoglobin.total in Blood | Lab-B4, Lab-B6 |
| 1552-9 | LOINC | Glucose [Mass/volume] in Serum or Plasma --pre 75 g glucose PO | Lab-B5 |
| 1518-0 | LOINC | Glucose [Mass/volume] in Serum or Plasma --2 hours post 75 g glucose PO | Lab-B5 |
| 1558-6 | LOINC | Fasting glucose [Mass/volume] in Serum or Plasma | Lab-B7 |
| 82947 | CPT | Glucose; quantitative, blood | Lab-B5 |
| 82950 | CPT | Glucose; post glucose dose | Lab-B5 |
| 83036 | CPT | Hemoglobin; glycosylated (A1c) | Lab-B4, Lab-B6 |
| 76816 | CPT | Ultrasound, pregnant uterus, follow-up, per fetus | Img-B1 |
| 59025 | CPT | Fetal non-stress test | Proc-B1a, Proc-B1b |
| 76818 | CPT | Fetal biophysical profile; with non-stress testing | Proc-B2a, Proc-B2b |
| 97802 | CPT | Medical nutrition therapy; initial assessment and intervention, individual, each 15 min | Step 2.2 |
| 97803 | CPT | Medical nutrition therapy; re-assessment and intervention, individual, each 15 min | Step 2.2 |
| 1605101 | RXNORM | insulin isophane (IN; human NPH PIN 253181; vial SCD 311028) | Med-B1 |
| 86009 | RXNORM | insulin lispro | Med-B2, Med-B2′ |
| 51428 | RXNORM | insulin aspart, human | Med-B2, Med-B2′ |
| 6809 | RXNORM | metformin | Med-B3a, Med-B3b, Med-B3c, Med-B7a, Med-B7b |
| 4832 | RXNORM | glucagon | Med-B4a, Med-B4b, Med-B4c |
| 4815 | RXNORM | glyburide | Med-B5 |
| O24.410 | ICD-10 | Gestational diabetes mellitus in pregnancy, diet controlled | Step 2.1 |
| O24.414 | ICD-10 | Gestational diabetes mellitus in pregnancy, insulin controlled | Step 3.1, Step 4.1, Step 5.1 |
| O24.415 | ICD-10 | Gestational diabetes mellitus in pregnancy, controlled by oral hypoglycemic drugs | Step 6.4 |
| R73.03 | ICD-10 | Prediabetes | Step 7.5, Step 8.3 |
| Z86.32 | ICD-10 | Personal history of gestational diabetes | Step 7.6 |

RxNorm entries are **ingredient-level (IN)** for display and documentation. Part B has no
gate on medications. Chart medication lists carry product-level (SCD/SBD) RXCUIs, which an
ingredient code would not match (no hierarchy expansion). This is one reason A2 status is
elicited rather than read from `medications`.

## B-14. Attribute-map registrations

None.

## B-15. Evidence citations

See **Shared §15**. Part B uses: [2], [3], [4], [5], [6], [8], [9], [10], [11], [12], [13],
[14], [15], [16], [17], [18], [19], [20], [21].

## B-16. Citation map

- Stage 1: [5] · Step 1.1: [5] · Step 1.2: [4], [5] · `gate-gdm-phase` → Step 1.1
- Stage 2: [2], [5] · Step 2.1: [5], [16] · Step 2.2: [2], [5] · Step 2.3: [2], [3], [10] ·
  Step 2.4: [5], [11] · Step 2.5: [2], [3], [5] · Step 2.6: [5] · Step 2.7: [5] · Step 2.8:
  [2], [3] · Step 2.9: [2], [8], [9] · Step 2.10: [3], [5]
- Gates `gate-fasting-above-target`, `gate-pp-timing` → Step 2.5; `gate-pp1h-above-target` →
  Step 2.6; `gate-pp2h-above-target` → Step 2.7; `gate-control-class` → Step 2.9
- Stages 3, 4, 5: [2], [3], [5] · Steps 3.1, 4.1, 5.1: [2], [3], [5], [6]
- Stage `stage-6-a1`: [2], [8], [9] · Step 6.1: [2], [8], [9]
- Stage `stage-6-a2`: [2], [8], [9] · Step 6.2: [3], [8] · Step 6.3: [2], [9] · Step 6.4: [2], [5], [21]
- Stage `stage-6-poor`: [3], [8], [9] · Step 6.5: [8] · Step 6.6: [3], [9]
- Stage 7: [4], [5], [13], [14], [15] · Step 7.1: [5] · Step 7.2: [5] · Step 7.3: [4], [5], [13] ·
  Step 7.4: [3], [4] · Step 7.5: [3], [5] · Step 7.6: [4], [5], [15]
- Gates `gate-pp-ogtt-diabetes`, `gate-pp-ogtt-prediabetes` → Step 7.3
- Stage 8: [4], [5], [15] · Step 8.1: [4], [5] · Step 8.2: [4] · Step 8.3: [4], [5]
- Gates `gate-longterm-diabetes`, `gate-longterm-prediabetes` → Step 8.1
- Med-B1: [2], [3], [5] · Med-B2: [3], [5] · Med-B3: [2], [3], [5], [12], [19] · Med-B4: [6] ·
  Med-B5: [2], [5], [18], [20], [21] · Med-B6: [5] · Med-B7: [5]
- Lab-B1–B4: [5] · Lab-B5: [4], [5] · Lab-B6, B7: [4] · Img-B1: [2], [3] · Proc-B1: [8] · Proc-B2: [3], [8]
- Guid-B1: [3], [5] · Guid-B2: [2], [5] · Guid-B3: [3], [10] · Guid-B4: [5], [11] · Guid-B5:
  [5], [6] · Guid-B6: [3], [5] · Guid-B7: [5], [16] · Guid-B8: [4], [5] · Guid-B9: [5] · Guid-B10: [5], [15]
- QM-B1 → Step 7.3 ([13]) · QM-B2 → Step 7.6 ([14]) · Schedules and CodeEntries → host Steps

## B-17. Temporal horizon & status summary (EMITTED — review carefully)

| Gate | Condition on | horizon | status | window_days | Rationale |
|---|---|---|---|---|---|
| gate-fasting-above-target | labs 41604-0 > 94.9 | {days: 14} | — | — | Latest SMBG within ~2 weekly reviews (D-10). Older → unresolved → asks, so stale data never decides insulin |
| gate-pp1h-above-target | labs 10449-7 > 139.9 | {days: 14} | — | — | As above |
| gate-pp2h-above-target | labs 6689-4 > 119.9 | {days: 14} | — | — | As above |
| gate-pp-ogtt-diabetes | labs 1552-9 > 125.9 | {days: 60} | — | — | Postpartum OGTT only. Excludes the antepartum diagnostic OGTT (D-14) |
| gate-pp-ogtt-diabetes | labs 1518-0 > 199.9 | {days: 60} | — | — | As above |
| gate-pp-ogtt-prediabetes | labs 1552-9 > 99.9 | {days: 60} | — | — | As above |
| gate-pp-ogtt-prediabetes | labs 1518-0 > 139.9 | {days: 60} | — | — | As above |
| gate-longterm-diabetes | labs 4548-4 > 6.49 | {days: 1095} | — | — | Screening interval is 1–3 years. No A1C in 3 years → asks (screening due) |
| gate-longterm-prediabetes | labs 4548-4 > 5.69 | {days: 1095} | — | — | As above |
| gate-longterm-prediabetes | labs 4548-4 < 6.5 | {days: 1095} | — | — | As above |

No `window_days`; no `status` on labs; no vitals or `patient.*`. No trend, delta or count
operators, so nothing here is simulator-untestable for lack of dates. Seeding limits do apply
(§B-18).

## B-18. Gaps & fallbacks

### Not encodable on main

| # | Requirement | Why not | Fallback |
|---|---|---|---|
| B-G1 | Start pharmacotherapy when values are **consistently** above target | `count_in_window` counts results, not above-threshold results; no %-of-values operator | Latest value within 14 days (D-9); chained confirmation question offered |
| B-G2 | Antepartum vs postpartum vs history | Negative ("not delivered"); no postpartum anchor; Z86.32 carries no phase | SELECT router `gate-gdm-phase` |
| B-G3 | 1-h **or** 2-h postprandial | An OR over alternative timings asks forever for the unused one | Timing router + duplicate prandial stages (D-8) |
| B-G4 | A1 / A2 / well / poorly controlled | Judgment; negative for A1; would share targets with a chart A2 gate | SELECT router `gate-control-class` |
| B-G5 | Continue therapy when treated and at target (mirror of the retired failure) | "On medication AND at target" needs meds read by product-level RXCUI (no hierarchy), and Z79.4/Z79.84 are not coded with O24.4 | Router option "A2 well controlled" → Step 6.4 |
| B-G6 | Postpartum prediabetes band exclusive of diabetes | `(A AND B) OR (C AND D)` has no encoding | Non-exclusive gates; Step 7.4 supersedes |
| B-G7 | Metformin contraindicated with hypertension/preeclampsia (cross-pathway) | No condition-aware suppression; no interaction edge | Text caution + D-2 (GHTN `avoid` node) |
| B-G8 | "This pregnancy" / "4–12 weeks postpartum" | No pregnancy or delivery anchor in the horizon grammar | Day-count horizons (D-14) |

### Source gaps

- `[GAP]` ACOG PB 190 full text (paywalled; reaffirmed 2026). PB 190 claims are verified
  through PubMed/secondary confirmation; wording is from PB 180 [3]. Needs ACOG access.
- `[GAP]` No numeric insulin titration algorithm or basal:bolus split in ADA 2026 or PB text.
- `[GAP]` No US source gives a number or % of above-target values, or a fixed MNT trial
  duration. Only trial entry criteria exist: SUGAR-DIP 2 weeks, INDAO 10 days.
- `[GAP]` "Every 1–2 weeks" review: the source says weekly. This brief uses weekly (Sched-B2).
- `[GAP]` A1GDM antenatal-testing start GA: no consensus before 40 0/7 weeks (CO 828). Not invented.
- `[GAP]` Growth-ultrasound timing (the only wording is "late in the third trimester").
- `[GAP]` GDM intrapartum glucose target. Out of scope.
- `[GAP]` Antenatal-corticosteroid hyperglycemia management: no US pregnancy guidance found.
- `[GAP]` Metformin dose for postpartum prediabetes; metformin in lactation.
- `[GAP]` No CMS/NCQA-adopted GDM-specific measure. QM-B1 is SMFM's proposed metric.

### Source conflicts

| # | Conflict | Resolution |
|---|---|---|
| B-C1 | Metformin: ADA/ACOG "not first-line / reasonable alternative" vs SMFM "reasonable and safe first-line alternative" | Role `alternative`; SMFM cited |
| B-C2 | Metformin max dose: PB text 2,500–3,000 mg/day vs FDA label 2,550 mg/day | Label ceiling |
| B-C3 | Glyburide max dose: PB "up to 30 mg" vs label 20 mg (nonmicronized) / 12 mg (micronized) | Moot while role is `avoid` (D-11) |
| B-C4 | Obesity weight gain: ADA prints 10–20 lb vs IOM/CO 548 11–20 lb | 11–20 lb |
| B-C5 | Cesarean-counseling evidence level: Level B (PB 180) vs Level C (PB 190 summary) | Cite PB 190 without a level |
| B-C6 | Poorly controlled GDM delivery: CO 831 "individualized" vs PB text "37 0/7–38 6/7 may be justified" | Both stated, CO 831 governs |
| B-C7 | Postpartum test: ADA OGTT at 4–12 wk (A1C only at 6–12 mo as fallback) vs ACOG accepting FPG alone vs WPSI "within first year, then every 3 years ≥10 yr" | ADA 75-g OGTT |

### Simulator coverage `[SIM]`

- **Enterable today:** O24.410/.414/.415/.419 (triggers), 4548-4, 1558-6.
- **Not seeded:** O24.43x, Z86.32, the SMBG LOINCs (41604-0, 10449-7, 6689-4), 1552-9 and
  1518-0.
- **So until seeded:**
  - all three pharmacotherapy gates **ask** in the simulator, with no way to enter the
    value through the composer;
  - the question-answer injection path works: the provider answers the pending datum question;
  - the postpartum gates need seeding.
- The routers and long-term A1C gates work today.
- **Recommendation:** call `ensureClinicalCodeReference` from import (it has no callers on
  josh-dev), or seed these codes by migration before simulator testing.
- **Seed-table defects found during verification.** These are outside this pathway but will
  mislead simulator testing. Six RxNorm rows in `clinical_code_reference` carry the wrong
  label:

  | Seed code | Seed label | What it really is (RxNav) |
  |---|---|---|
  | 860975 | metformin 500 mg | 24-HR **ER** tablet |
  | 310539 | glyburide 5 mg | glyburide **6 mg** |
  | 847191 | lispro | aspart 70/30 **pen** |
  | 847232 | aspart | **Lantus** pen |
  | 847187 | glargine | human 70/30 pen |

  The sixth row, 106892, is a common "NPH" code that is actually Humulin 70/30.

  Two LOINC labels are also wrong: `1521-4` is 2-h post-meal serum glucose, not a urine
  strip, and `10450-5` is a 10-hour fasting glucose, not a gestational panel. Anyone picking
  "insulin lispro" in the composer today enters a premixed aspart pen. No gate here reads
  medications, so this brief is unaffected, but the seeds should be corrected.

---

# Shared §15 — Evidence citations (both parts)

The builder emits, per part, only the references listed in that part's §15/§16. Evidence
levels use the source's own grade where one applies to the cited content. Otherwise they use
`Expert Consensus` (ungraded statements, committee opinions, consensus statements), or `A` for
RCTs and federal labeling as primary evidence. The ADA grading (A/B/C/E) is recorded
per recommendation in the text. ADA "E" (expert consensus) maps to `Expert Consensus`.

- **[1]** Screening for Gestational and Pregestational Diabetes in Pregnancy and Postpartum
  (Clinical Practice Update) — American College of Obstetricians and Gynecologists,
  *Obstetrics & Gynecology* 2024;144(1):e20–e23, doi:10.1097/AOG.0000000000005612, 2024,
  evidence level `Expert Consensus`,
  PMID 42131962, https://pubmed.ncbi.nlm.nih.gov/42131962/ (full text:
  https://journals.lww.com/greenjournal/fulltext/2024/07000/acog_clinical_practice_update__screening_for.34.aspx,
  paywalled). The old acog.org CPU URL is dead; ACOG now attaches the CPU to the PB 190 page.
  `[GAP]` Full text not read. From the abstract plus secondary sources (Heyborne & Barbour,
  Obstet Gynecol 2025;145:31–38, PMID 39481113): it updates PB 190 and PB 201, keeps targeted
  screening for pregestational diabetes before 24 weeks, no longer recommends early GDM
  screening, and adds immediate-postpartum testing guidance. **Unverified:** its risk-factor
  list, its BMI thresholds, HbA1c for early testing, and its exact postpartum wording.
- **[2]** Gestational Diabetes Mellitus (Practice Bulletin No. 190) — ACOG, *Obstetrics &
  Gynecology* 2018;131(2):e49–e64, 2018 (reaffirmed 2026), evidence level `Level A`
  (recommendations cited carry their own A/B/C level in text). Claims attributed to [2] are
  those corroborated by a readable source: PB 180 [3], CO 831 [9], or ADA's and USPSTF's
  citations of PB 190. Operational wording comes from [3].
  https://www.acog.org/clinical/clinical-guidance/practice-bulletin/articles/2018/02/gestational-diabetes-mellitus
  — `[GAP]` member-only. Claims verified via PubMed 29370047, ADA/USPSTF citations of PB 190,
  and the PB 180 text [3].
- **[3]** Gestational Diabetes Mellitus (Practice Bulletin No. 180) — ACOG, *Obstetrics &
  Gynecology* 2017;130(1):e17–e37, 2017, evidence level `Level A`,
  https://ruralprep.org/wp-content/uploads/2018/04/ACOG-Tech-Bullitin.pdf —
  `[OLDER SOURCE — superseded by [2]]`. Cited **only** for operational wording that PB 190
  retained per secondary confirmation: insulin dosing, SMBG cadence, weekly review, the
  antenatal-testing start and the postpartum algorithm. **Replace with PB 190 wording once
  accessed.**
- **[4]** 2. Diagnosis and Classification of Diabetes: Standards of Care in Diabetes—2026 —
  American Diabetes Association Professional Practice Committee, *Diabetes Care*
  2026;49(Suppl 1):S27–S49, doi:10.2337/dc26-S002, 2026, evidence level `A` (Rec 2.32; others
  B/E as stated), https://pmc.ncbi.nlm.nih.gov/articles/PMC12690183/
- **[5]** 15. Management of Diabetes in Pregnancy: Standards of Care in Diabetes—2026 — ADA
  Professional Practice Committee, *Diabetes Care* 2026;49(Suppl 1):S321–S338,
  doi:10.2337/dc26-S015, 2026, evidence level `A` (Recs 15.15, 15.16, 15.17, 15.32; others B/C/E
  as stated), https://pmc.ncbi.nlm.nih.gov/articles/PMC12690181/
- **[6]** 6. Glycemic Goals, Hypoglycemia, and Hyperglycemic Crises: Standards of Care in
  Diabetes—2026 — ADA Professional Practice Committee, *Diabetes Care* 2026;49(Suppl
  1):S132–S149, doi:10.2337/dc26-S006, 2026, evidence level `A` (Rec 6.16 glucagon; Rec 6.15 B;
  the 15-g figure is narrative text), https://pmc.ncbi.nlm.nih.gov/articles/PMC12690178/
- **[7]** Screening for Gestational Diabetes: US Preventive Services Task Force Recommendation
  Statement — USPSTF, *JAMA* 2021;326(6):531–538, 2021, evidence level `B` (≥24 weeks; I
  statement <24 weeks),
  https://www.uspreventiveservicestaskforce.org/uspstf/recommendation/gestational-diabetes-screening
- **[8]** Indications for Outpatient Antenatal Fetal Surveillance (Committee Opinion No. 828)
  — ACOG, *Obstetrics & Gynecology* 2021;137:e177–e197, 2021 (reaffirmed 2024), evidence level
  `Expert Consensus`,
  https://www.acog.org/clinical/clinical-guidance/committee-opinion/articles/2021/06/indications-for-outpatient-antenatal-fetal-surveillance
- **[9]** Medically Indicated Late-Preterm and Early-Term Deliveries (Committee Opinion No.
  831) — ACOG, *Obstetrics & Gynecology* 2021;138:e35–e39, 2021, evidence level `Expert
  Consensus`,
  https://www.acog.org/clinical/clinical-guidance/committee-opinion/articles/2021/07/medically-indicated-late-preterm-and-early-term-deliveries
- **[10]** Physical Activity and Exercise During Pregnancy and the Postpartum Period
  (Committee Opinion No. 804) — ACOG, *Obstetrics & Gynecology* 2020;135:e178–e188, 2020
  (reaffirmed 2023), evidence level `Expert Consensus`,
  https://www.acog.org/clinical/clinical-guidance/committee-opinion/articles/2020/04/physical-activity-and-exercise-during-pregnancy-and-the-postpartum-period
- **[11]** Weight Gain During Pregnancy (Committee Opinion No. 548) — ACOG, *Obstetrics &
  Gynecology* 2013;121:210–212, 2013 (reaffirmed 2026), evidence level `Expert Consensus`,
  https://www.acog.org/clinical/clinical-guidance/committee-opinion/articles/2013/01/weight-gain-during-pregnancy
  — `[OLDER SOURCE — still current recommendation]` (IOM 2009 ranges).
- **[12]** Society for Maternal-Fetal Medicine Statement: Pharmacological treatment of
  gestational diabetes — SMFM Publications Committee, *American Journal of Obstetrics &
  Gynecology* 2018;218(5):B2–B4, PMID 29409848, 2018 (reaffirmed 2024), evidence level `Expert Consensus`,
  https://publications.smfm.org/publications/252-society-for-maternal-fetal-medicine-statement-pharmacological-treatment/
- **[13]** Society for Maternal-Fetal Medicine Special Statement: Quality metric on the rate of
  postpartum diabetes screening after pregnancies with gestational diabetes — SMFM, *American
  Journal of Obstetrics & Gynecology* 2023;228(4):B2–B9, 2023, evidence level `Expert
  Consensus`, https://www.ajog.org/article/S0002-9378(22)02601-1/fulltext
- **[14]** Quality ID #336: Maternity Care: Postpartum Follow-up and Care Coordination (2026
  MIPS CQM specification) — Centers for Medicare & Medicaid Services, 2026, evidence level
  `Expert Consensus`,
  https://qpp.cms.gov/docs/QPP_quality_measure_specifications/CQM-Measures/2026_Measure_336_MIPSCQM.pdf
- **[15]** Optimizing Postpartum Care (Committee Opinion No. 736) — ACOG, *Obstetrics &
  Gynecology* 2018;131:e140–e150, 2018 (reaffirmed 2025), evidence level `Expert Consensus`,
  https://www.acog.org/clinical/clinical-guidance/committee-opinion/articles/2018/05/optimizing-postpartum-care
- **[16]** Aspirin Use to Prevent Preeclampsia and Related Morbidity and Mortality: Preventive
  Medication (US Preventive Services Task Force Recommendation Statement) — USPSTF, *JAMA* 2021;326(12):1186–1191,
  2021, evidence level `B`,
  https://www.uspreventiveservicestaskforce.org/uspstf/recommendation/low-dose-aspirin-use-for-the-prevention-of-morbidity-and-mortality-from-preeclampsia-preventive-medication
- **[17]** ICD-10-CM Official Guidelines for Coding and Reporting FY2027 (effective October 1,
  2026) — CMS and NCHS (CDC), 2026, evidence level `Expert Consensus`,
  https://ftp.cdc.gov/pub/Health_Statistics/NCHS/Publications/ICD10CM/2027/ICD-10-CM-October-1-2026-FY27-Guidelines.pdf
- **[18]** Oral Glucose-Lowering Agents vs Insulin for Gestational Diabetes: A Randomized
  Clinical Trial (SUGAR-DIP) — Rademaker D, et al., *JAMA* 2025;333(6):470–478, 2025, evidence
  level `A`, https://pubmed.ncbi.nlm.nih.gov/39761054/
- **[19]** Metformin versus Insulin for the Treatment of Gestational Diabetes (MiG) — Rowan JA,
  et al., *New England Journal of Medicine* 2008;358:2003–2015 (erratum 2008;359:106), 2008, evidence level `A`,
  https://pubmed.ncbi.nlm.nih.gov/18463376/ — `[OLDER SOURCE — landmark trial cited by ADA 2026]`
- **[20]** Effect of Glyburide vs Subcutaneous Insulin on Perinatal Complications Among Women
  With Gestational Diabetes (INDAO) — Sénat MV, et al., *JAMA* 2018;319(17):1773–1780, 2018,
  evidence level `A`, https://pubmed.ncbi.nlm.nih.gov/29715355/
- **[21]** Glyburide (micronized) tablets — prescribing information (FDA-approved labeling),
  Teva, DailyMed, current label, evidence level `Expert Consensus`,
  published 2026-02-13,
  https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=e84c0dfc-a4e9-4c89-b6ea-45732eb412f5.
  The Pregnancy section says to discontinue at least two weeks before the expected delivery
  date.
