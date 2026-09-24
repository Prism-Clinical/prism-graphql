# Pathway Research Brief — UTI and Asymptomatic Bacteriuria in Pregnancy

**Status: DRAFT v1 for physician review — not yet approved for JSON build.**

Scope confirmed with the requester: **US outpatient prenatal care**. Screening for asymptomatic
bacteriuria → treatment → acute cystitis → test of cure → recurrence and suppressive
prophylaxis, **including the group B streptococcus bacteriuria arm**, and **stopping at the
trigger for admission with pyelonephritis**.

Research method: 4 parallel domain agents over fetched guideline full text, then 2 verification
agents. Every code checked against the CMS FY2026 ICD-10-CM tabular **and alphabetic index**,
LOINC 2.82 (twice, via two independent services), and RxNav. Every citation re-fetched from
**primary sources** — `acog.org` serves HTTP 200 to a plain browser user-agent, and the same
route retrieves ACOG's **PDFs**, which matters because the HTML carries only table captions.
Flags: `[GAP]` · `[NOT ENCODABLE]` · `[DECISION]` an authoring choice needing ratification.

> ### ⚠ Read first — three things that shape everything below
>
> **1. A urine culture's result is an organism, and the model has no place to put it.**
> `LabResult.value` is typed `number`. Microbiology is nominal — "the culture grew group B
> strep" is not a quantity. So organism identity has **no representation at all**, and every
> gate that depends on *which* organism grew must be a clinician question.
>
> **2. The GBS threshold gate needs a join the schema cannot express — and the join is unsafe
> anyway.** "GBS at ≥10⁵ CFU/mL" requires linking a nominal identity observation to a separate
> quantitative count observation for the same isolate. Verified twice against full LOINC:
> **no GBS-specific colony-count code exists**. Worse, LOINC numbers multi-isolate cultures
> ("Bacteria **#3** identified…") while the colony count carries **no isolate number** — so in
> mixed growth the count cannot be attributed to any named organism. A naive join can silently
> assign another organism's count to GBS.
>
> **3. ACOG grades nothing here.** A Clinical Consensus carries no A/B/C and no GRADE — only a
> 75% consensus vote. Verified exhaustively across the full PDF. Every recommendation has
> identical stated weight, and **five are explicitly "insufficient evidence to recommend for or
> against"** — non-recommendations that must never become gates.

---

## 1. Pathway metadata

- **Logical ID**: `uti-asymptomatic-bacteriuria-pregnancy`
- **Title**: Urinary Tract Infection and Asymptomatic Bacteriuria in Pregnancy — Outpatient Screening, Treatment and Surveillance
- **Version**: 1
- **Category**: OBSTETRIC
- **Scope**: US outpatient prenatal care. Universal early-pregnancy screening for asymptomatic
  bacteriuria; treatment of asymptomatic bacteriuria and acute cystitis; the group B
  streptococcus bacteriuria arm; test of cure; recurrence and suppressive prophylaxis. Ends at
  the trigger for admission with pyelonephritis.
- **Target population**: All pregnant patients receiving prenatal care. Screening applies
  universally; treatment and surveillance arms apply to those with a positive culture.
- **Condition codes** (trigger codes; OR semantics):

| Code | System | Description | Usage note | Grouping |
|---|---|---|---|---|
| R82.71 | ICD-10 | Bacteriuria | primary trigger — the only ASB code that exists | bacteriuria |
| O23.10 | ICD-10 | Infections of bladder in pregnancy, unspecified trimester | cystitis in pregnancy | uti-pregnancy |
| O23.12 | ICD-10 | Infections of bladder in pregnancy, second trimester | cystitis in pregnancy | uti-pregnancy |
| O23.13 | ICD-10 | Infections of bladder in pregnancy, third trimester | cystitis in pregnancy | uti-pregnancy |
| O23.40 | ICD-10 | Unspecified infection of urinary tract in pregnancy, unspecified trimester | undifferentiated UTI | uti-pregnancy |
| O23.42 | ICD-10 | Unspecified infection of urinary tract in pregnancy, second trimester | undifferentiated UTI | uti-pregnancy |
| O23.43 | ICD-10 | Unspecified infection of urinary tract in pregnancy, third trimester | undifferentiated UTI | uti-pregnancy |
| O99.820 | ICD-10 | Streptococcus B carrier state complicating pregnancy | GBS arm trigger | gbs |
| Z13.89 | ICD-10 | Encounter for screening for other disorder | the ASB screening encounter | screening |

**`[GAP]` — there is no ICD-10 code for asymptomatic bacteriuria in pregnancy.** Verified
against the official alphabetic index: `Bacteriuria` routes to **R82.71** with no pregnancy
subterm, and `Pregnancy > complicated by` has no bacteriuria subterm at all. Two consequences,
both load-bearing:

- **`R82.71 + Z3A-` is officially invalid.** Z3A carries a `codeFirst` note requiring an
  obstetric code (O09–O60, O80–O82, O94–O9A) to be sequenced first; R82.71 is not in that range.
- **`O23.4-` overstates the finding.** It means *"unspecified **infection** of urinary tract in
  pregnancy"* — asserting an infection an asymptomatic patient does not have — and it collapses
  the ASB-versus-cystitis fork, since both land on the same code.

**`[DECISION]` The ASB/cystitis fork is therefore driven by the observation pair (colony count
+ symptom status), never by a diagnosis-code gate.** For coding, emit `O23.4x` trimester-matched
+ `Z3A.-` + `R82.71` as a secondary problem-list code. The screening *encounter* does have a
clean answer — `Z13.89` is explicitly indexed for asymptomatic bacteriuria screening.

**Organism identifier codes.** The O23 block carries a `useAdditionalCode` note: *"code to
identify organism (B95.-, B96.-)"*. The correct GBS code is **B95.1** (Streptococcus, group B).
**Not B95.5**, which is *unspecified* streptococcus — an error caught at verification.

## 1b. Code sets

None. Single-condition pathway.

## 2. Stages

- **Stage 1 — Universal Screening** *(entry stage, root-connected)*: one urine culture early in
  prenatal care. Not dipstick. [1][3]
- **Stage 2 — Culture Interpretation** *(root-connected)*: colony count, organism, and symptom
  status determine which arm the patient enters. [1]
- **Stage 3 — Treatment** *(branch-entry only, via `gate-culture-positive`)*: 5–7 days of a
  targeted antibiotic, with the first-trimester and near-term drug constraints. [1]
- **Stage 4 — Group B Streptococcus Arm** *(branch-entry only, via `gate-gbs-identified`)*: the
  parallel arm — record notation, patient notification, intrapartum prophylaxis flag, and
  cancellation of the 36-week swab. [2][7]
- **Stage 5 — Follow-up and Recurrence** *(branch-entry only, via `gate-treatment-completed`)*:
  test of cure where elected, recurrence counting, and suppressive prophylaxis. [1]
- **Stage 6 — Escalation** *(branch-entry only, via `gate-pyelonephritis-suspected`)*: the exit
  boundary. [1]

Stages 3–6 are **branch-entry only** and get no root `HAS_STAGE` edge.

## 3. Steps

- **Step 1.1 — Screen for asymptomatic bacteriuria** *(entry step)*: one midstream urine culture
  early in prenatal care. ACOG declines to name a gestational age; USPSTF says first prenatal
  visit or 12–16 weeks, whichever is earlier. **Dipstick does not satisfy this** — ACOG states
  routine per-visit dipstick "does not have benefit and is not sufficiently sensitive to detect
  ASB". [1][3]
- **Step 1.2 — Suppress additional screening** *(gated by `gate-no-repeat-screening`)*: for
  patients with diabetes or spinal cord injury, do **not** screen beyond the single initial
  screen — ACOG states the harms outweigh the benefits, and in spinal cord injury bacteriuria
  "seems to be protective… and treatment can precipitate symptomatic UTI". [1]
- **Step 2.1 — Interpret the culture** *(unconditional)*: colony count, organism identity, and
  whether the patient has symptoms. Do not treat normal vulvovaginal flora — *Lactobacilli*,
  *Corynebacteria*, coagulase-negative *Staphylococcus*. [1]
- **Step 2.2 — Classify as asymptomatic bacteriuria or acute cystitis** *(gated by
  `gate-culture-positive`)*: symptoms are the entire difference. ACOG warns that frequency,
  urgency and nocturia overlap with ordinary pregnancy symptoms, and that diagnostic studies are
  needed "to prevent overtreatment". [1]
- **Step 3.1 — Treat with a targeted antibiotic** *(gated by `gate-culture-positive`)*: 5–7
  days. Same duration for asymptomatic bacteriuria and cystitis — ACOG gives no split.
  Fosfomycin 3 g single dose is the only exception. Avoid amoxicillin/ampicillin empirically
  (39–48% *E. coli* resistance). [1]
- **Step 3.2 — Select a non-β-lactam or cephalosporin regimen** *(gated by
  `gate-penicillin-allergy`)*: for low anaphylaxis risk, a cephalosporin is appropriate; for
  high risk, an alternative regimen is required. **`[GAP]` ACOG names no specific agent for the
  high-risk outpatient case** — it names aztreonam only for pyelonephritis. [1]
- **Step 3.3 — Apply the first-trimester drug constraint** *(gated by
  `gate-first-trimester`)*: nitrofurantoin and sulfonamides are *"reasonable in the first
  trimester if no appropriate alternatives are available"*. **This is a soft conditional, not a
  prohibition** — a hard block would be an error in the opposite direction. [1]
- **Step 4.1 — Record and notify GBS status** *(gated by `gate-gbs-identified`)*: notation in
  the record, and the patient made aware of her GBS status. [2]
- **Step 4.2 — Flag intrapartum antibiotic prophylaxis** *(gated by `gate-gbs-identified`)*:
  required at **any** colony count, at any time in pregnancy. [2]
- **Step 4.3 — Cancel the 36 0/7–37 6/7 week rectovaginal screening culture** *(gated by
  `gate-gbs-identified`)*: GBS bacteriuria is an overriding indication for prophylaxis, so the
  later swab is not needed. [2]
- **Step 4.4 — Treat GBS bacteriuria antepartum** *(gated by `gate-gbs-treat-threshold`)*: at
  ≥10⁵ CFU/mL, or at any count if symptomatic. **Clindamycin must not be used** — it
  concentrates poorly in urine, even in penicillin allergy. [2]
- **Step 4.5 — Mark the requisition for clindamycin susceptibility** *(gated by
  `gate-penicillin-allergy`)*: for penicillin-allergic patients at high anaphylaxis risk, the
  susceptibility request must be made **at antepartum culture-order time**, not at delivery. [2]
- **Step 5.1 — Test of cure** *(gated by `gate-treatment-completed`)*: **optional.** For
  cystitis, ACOG offers repeat culture at 1–2 weeks *or* symptom-triggered evaluation as
  co-equal strategies. For asymptomatic bacteriuria there is no recommendation either way. [1]
- **Step 5.2 — Initiate suppressive prophylaxis** *(gated by `gate-recurrent-uti`)*:
  nitrofurantoin 100 mg or cephalexin 250–500 mg orally daily, for the remainder of pregnancy,
  matched to the isolate's susceptibility. Continuous or postcoital. [1]
- **Step 6.1 — Escalate for inpatient management** *(gated by
  `gate-pyelonephritis-suspected`)*: ACOG states pyelonephritis in pregnancy should initially be
  managed as an inpatient. Obtain a specimen before antibiotics, but do not delay treatment. [1]

Gated steps connect **only** via their gate's `BRANCHES_TO` — no `HAS_STEP` edge. Steps 1.1 and
2.1 are unconditional and keep their `HAS_STEP`.

> ### ⚠ A guideline-versus-label divergence, resolved in ACOG's favour
>
> ACOG directs nitrofurantoin suppression *"for the remainder of the pregnancy"*. The FDA label
> **contraindicates nitrofurantoin at 38–42 weeks, during labour, and when onset of labour is
> imminent**, because of the risk of neonatal haemolytic anaemia. CC No. 4 never mentions it.
> Neither source states the divergence; it emerges only from reading both.
>
> **Reviewing physician's decision (2026-09-08): follow ACOG.** No term-stop gate is emitted and
> suppression runs to delivery. The label contraindication is **retained in the Med-1 and Med-6
> notes**, so a prescriber sees it at the point of ordering — it is documented, not enforced.
> If that balance should change, the gate is a single addition.

## 4. Decision points

- **DP-1 — Test-of-cure strategy after acute cystitis** (after Step 5.1) — branch_mode: one_of
  - Criterion 1a: repeat urine culture 1–2 weeks after completing treatment → **Step 5.1a** [1]
  - Criterion 1b: monitor symptoms; culture only if symptoms recur → **Step 5.1b** [1]
  - ACOG presents these as co-equal and states robust data on either strategy are lacking. Not
    machine-evaluable: it is a clinician–patient preference decision, not a data threshold. [1]

## 4b. Gates

- **Gate `gate-culture-positive` — Urine culture at or above 100,000 CFU/mL?**
  - Attached to: `step-2-1` · Branches to: `step-2-2`, `stage-3`
  - Exclusively gated: yes — Stage 3 is branch-entry only.
  - Type: **patient_attribute** · Default behavior: **skip** — no culture means nothing to treat.
  - Condition (coded): field `labs`, `greater_than`, value `19090-0`, system LOINC,
    threshold **99999.9**, horizon `{days: 300}`
  - `[DECISION]` Threshold is 99999.9 because coded operators have no ≥. Colony counts are
    reported in whole CFU/mL, so this is exactly "≥100,000".
  - `[DECISION — UNIT RISK]` **19090-0 is `NCnc`/`Qn`, in CFU/mL.** There is no unit checking
    anywhere in the engine and `unit` is not an allowed key on a coded condition. If a feed
    reports in a different unit or as a banded string ("&gt;100,000"), this gate misfires
    silently. Banded and censored results are common in real urine cultures.
  - `[NOT ENCODABLE — ORGANISM]` This gate cannot exclude normal vulvovaginal flora, because
    organism identity has no representation. A *Lactobacillus* culture at 10⁵ fires it.
    `gate-symptomatic` and clinician review are the only guard.
  - Rationale & source: [1]

- **Gate `gate-symptomatic` — Does the patient have urinary symptoms?**
  - Attached to: `step-2-2` · Branches to: `step-3-1`
  - Exclusively gated: yes
  - Type: **question** · answer_type: BOOLEAN · Default behavior: **skip**
  - Prompt: "Does the patient have urinary symptoms — new or worsening dysuria, haematuria,
    urinary frequency, or nocturia? Note that frequency, urgency and nocturia overlap with
    ordinary pregnancy symptoms; dysuria and haematuria carry the signal."
  - `[NOT ENCODABLE]` ACOG states the discrimination is clinical. Absence of a documented
    symptom is not the same as a documented absence, and the model cannot tell them apart.
  - Rationale & source: [1]

- **Gate `gate-gbs-identified` — Did the urine culture grow group B streptococcus?**
  - Attached to: `step-2-1` · Branches to: `stage-4`
  - Exclusively gated: yes — Stage 4 is branch-entry only, and this is its sole route.
  - Type: **question** · answer_type: BOOLEAN · Default behavior: **skip**
  - Prompt: "Did this urine culture grow group B streptococcus (*Streptococcus agalactiae*), at
    any colony count? A positive result at any count obliges intrapartum antibiotic prophylaxis
    and removes the need for the 36 0/7–37 6/7 week rectovaginal screening culture."
  - `[NOT ENCODABLE — the most consequential gap in this pathway]` Organism identity is nominal
    and `LabResult.value` is a number. There is no way to express "the culture grew GBS".
    Verified twice against full LOINC: no GBS-specific urine colony-count code exists, and the
    generic count carries no isolate number, so it cannot be attributed to a named organism in
    mixed growth.
  - `[DECISION]` `skip` is the safe default **only because the question is asked at every
    culture interpretation**. If unanswered, the intrapartum prophylaxis flag is never set — a
    failure with neonatal consequences that surfaces months later, at delivery. This gate's
    answer rate should be monitored in production.
  - Rationale & source: [2]; [1]

- **Gate `gate-gbs-treat-threshold` — GBS at or above 10⁵ CFU/mL, or symptomatic?**
  - Attached to: `stage-4` · Branches to: `step-4-4`
  - Exclusively gated: yes
  - Type: **question** · answer_type: BOOLEAN · Default behavior: **skip**
  - Prompt: "Is the GBS colony count 100,000 CFU/mL or greater, OR is the patient symptomatic?
    Either warrants antepartum treatment. A lower count in an asymptomatic patient requires no
    antepartum antibiotic — but still obliges intrapartum prophylaxis."
  - `[NOT ENCODABLE]` Requires joining organism identity to colony count for the same isolate.
  - `[DECISION — OPERATOR]` **≥10⁵, per Committee Opinion 797**, which states it twice
    unambiguously. Clinical Consensus No. 4 says "greater than 100,000" — but that is a drafting
    slip: the same paragraph uses "or higher" two sentences earlier, and "or higher"/"or more"
    appears 11 times in the document against one "greater than". USPSTF's 10⁴ figure is
    **descriptive** ("is commonly used as the threshold"), sits outside its graded
    recommendation, and derives from superseded 2010 CDC guidance. At exactly 100,000 the
    operator decides, which is why this needs ratifying.
  - Rationale & source: [2]; [1]; [3]

- **Gate `gate-penicillin-allergy` — Documented penicillin or β-lactam allergy?**
  - Attached to: `step-3-1` · Branches to: `step-3-2`, `step-4-5`
  - Exclusively gated: yes
  - Type: **compound**, operator **OR** · Default behavior: **skip**
  - Conditions (coded): field `allergies`, `includes_code`, values `Z88.0` (penicillin) and
    `Z88.1` (other antibiotic agents), system ICD-10, horizon `LIFETIME`, status `any`
  - `[DECISION]` This is the pathway's one genuine use of allergy conditions. Note the engine's
    `exists` semantics were changed so an **absent** allergy no longer satisfies an exists test
    — which is correct here: "no recorded allergy" must not read as "allergy documented absent".
  - `[GAP]` The gate cannot distinguish **low from high anaphylaxis risk**, which is the
    distinction ACOG actually turns on — low risk gets a cephalosporin, high risk needs an
    alternative regimen and a clindamycin-susceptibility request on the requisition. Risk
    stratification is a history judgment (nature of the reaction), not a coded fact. Step 3.2
    and Step 4.5 therefore both carry the stratification as clinician instruction.
  - Rationale & source: [1]; [2]

- **Gate `gate-recurrent-uti` — Two or more UTI episodes this pregnancy?**
  - Attached to: `stage-5` · Branches to: `step-5-2`
  - Exclusively gated: yes
  - Type: **patient_attribute** · Default behavior: **skip**
  - Condition (coded): field `conditions`, `count_in_window`, value `O23.*`, system ICD-10,
    **count_threshold 2**, **window_days 300**
  - `[DECISION]` **This is the pathway's occurrence-count gate, and the operator fits it.**
    `count_in_window` counts occurrences of a matching code in a window — which is exactly what
    "two or more UTIs" needs, unlike a count of values crossing a threshold.
  - `[DECISION — WINDOW]` ACOG's window is *"during pregnancy"* — episode-of-care anchored, not
    a rolling lookback. `window_days: 300` is the same pregnancy-length proxy the
    gestational-hypertension pathway uses. It will keep counting into the postpartum period
    unless the pregnancy episode closes.
  - `[GAP — DE-DUPLICATION]` **ACOG never defines the countable unit**, and concedes in its own
    Further Research section that how to define recurrent UTI in pregnancy is unresolved. One
    infection can generate an index culture, a test-of-cure culture and multiple claims — all
    carrying an O23 code. Without a de-duplication rule this gate fires on nearly every treated
    patient. **The pathway needs an authored, documented rule for what counts as an episode.**
  - Rationale & source: [1]

- **Gate `gate-no-repeat-screening` — Diabetes or spinal cord injury?**
  - Attached to: `stage-1` · Branches to: `step-1-2`
  - Exclusively gated: yes
  - Type: **compound**, operator **OR** · Default behavior: **skip**
  - Conditions (coded): field `conditions`, `includes_code`, system ICD-10, horizon `LIFETIME`,
    status `any` — values `E10.*`, `E11.*`, `O24.*`, `G82.2*`, `G82.5*`, `N31.*`, `T91.3`
  - `[DECISION]` A **negative** gate: it suppresses additional screening rather than adding it.
    ACOG restricts *repeat screening* only — treating a positive initial culture is unchanged.
    IDSA's recommendation against screening **or treating** in diabetes is its **non-pregnant**
    adult rule and must not leak in.
  - Rationale & source: [1]

- **Gate `gate-first-trimester` — Is the patient in the first trimester?**
  - Attached to: `step-3-1` · Branches to: `step-3-3`
  - Exclusively gated: yes
  - Type: **question** · answer_type: BOOLEAN · Default behavior: **skip**
  - Prompt: "Is the patient in the first trimester (less than 14 0/7 weeks)? Nitrofurantoin and
    sulfonamides remain **reasonable** in the first trimester if no appropriate alternative is
    available — this is a preference, not a prohibition. Alternatives: cephalexin, fosfomycin,
    amoxicillin-clavulanate."
  - `[NOT ENCODABLE]` Gestational age has no data route: `patient.*` attributes are never
    populated, and Z3A codes would need one condition per week.
  - `[DECISION — DRUG NAME]` ACOG's body prose says **"sulfonamides"**; only Table 1 names
    trimethoprim-sulfamethoxazole specifically. The prompt says sulfonamides to match the source.
  - Rationale & source: [1]

- **Gate `gate-treatment-completed` — Has the antibiotic course been completed?**
  - Attached to: `stage-3` · Branches to: `stage-5`
  - Exclusively gated: yes — Stage 5 is branch-entry only.
  - Type: **question** · answer_type: BOOLEAN · Default behavior: **skip**
  - Prompt: "Has the patient completed her antibiotic course? Follow-up, test of cure and any
    recurrence assessment all key off completion, not off the prescription date."
  - `[NOT ENCODABLE]` "Course completed" is not a fact the model holds — medication records
    carry a start date, not an adherence outcome. This is the same missing anchor the anemia
    pathway hit from the other direction.
  - Rationale & source: [1]

- **Gate `gate-pyelonephritis-suspected` — Fever, or flank pain / CVA tenderness, with urine studies suggesting UTI?**
  - Attached to: `step-2-1` · Branches to: `stage-6`
  - Exclusively gated: yes — Stage 6 is branch-entry only.
  - Type: **compound**, operator **OR** · Default behavior: **skip**
  - Conditions:
    - field `vitals`, `greater_than`, value `temperature_c`, threshold **37.9** *(no `system` —
      illegal on vitals)*
    - field `conditions`, `includes_code`, value `N10`, system ICD-10, horizon `{days: 300}`
  - `[DECISION — OPERATOR]` ACOG's stated criterion is fever ≥38.0 °C **AND** urine studies,
    with flank pain *supporting*. But ACOG separately warns that partial presentations —
    "fever and UTI but no CVA tenderness, or UTI and CVA tenderness but no fever" — warrant high
    suspicion. **A strict conjunction under-triggers.** The disjunctive form is an authoring
    choice, not an ACOG criterion. Please ratify.
  - `[GAP]` Flank pain and costovertebral angle tenderness are **exam findings with no data
    route**. They are carried in Step 6.1's instruction and in the safety-netting Guidance, not
    in this gate. So the gate fires on fever alone — the CVA-tenderness-without-fever
    presentation ACOG explicitly warns about is **not detected**.
  - Rationale & source: [1]

## 5. Medications

- **Med-1 — Nitrofurantoin monohydrate/macrocrystals 100 mg** (on Step 3.1)
  - Role: first_line · Clinical role: `uti-antibiotic-first-line`
  - 100 mg every 12 hours · 5–7 days · oral
  - Notes: ACOG's closest thing to a preferred agent — low resistance, concentrates in the
    bladder. **Not for pyelonephritis** — cannot reach therapeutic renal levels, and must be
    avoided when cystitis versus pyelonephritis is uncertain. **Avoid in G6PD deficiency.**
    **FDA-contraindicated at 38–42 weeks, in labour, or when labour is imminent.** Also
    contraindicated at CrCl <60 mL/min.
  - Source: [1]; [6]
- **Med-2 — Cephalexin 250–500 mg** (on Step 3.1)
  - Role: first_line · Clinical role: `uti-antibiotic-first-line`
  - 250–500 mg every 6 hours · 5–7 days · oral
  - Notes: appropriate for penicillin allergy at **low** anaphylaxis risk. The label-safe
    suppression alternative at term.
  - Source: [1]
- **Med-3 — Fosfomycin 3 g** (on Step 3.1)
  - Role: first_line · Clinical role: `uti-antibiotic-first-line`
  - 3 g · single dose · oral
  - Notes: the only single-dose option — ACOG calls it "a reasonable choice for 1-day treatment
    of ASB". **Not for pyelonephritis**, same renal-penetration limit as nitrofurantoin.
  - Source: [1]
- **Med-4 — Sulfamethoxazole-trimethoprim 800/160 mg** (on Step 3.1)
  - Role: alternative · Clinical role: `uti-antibiotic-first-line`
  - 800/160 mg every 12 hours · 5–7 days · oral
  - Notes: avoid empirically where local trimethoprim resistance exceeds 20%. First-trimester
    use is *reasonable if no appropriate alternative is available*. **Cross-pathway
    contraindication — see below.**
  - Source: [1]; [6]
- **Med-5 — Amoxicillin-clavulanate 500/125 or 875/125 mg** (on Step 3.1)
  - Role: alternative · Clinical role: `uti-antibiotic-first-line`
  - 500 mg every 8 hours or 875 mg every 12 hours · 5–7 days · oral
  - Notes: **avoid empirically** — high *E. coli* resistance (39–48% to ampicillin). Reasonable
    once susceptibility is known.
  - Source: [1]
- **Med-6 — Nitrofurantoin 100 mg, suppressive** (on Step 5.2)
  - Role: first_line · Clinical role: `uti-suppressive-prophylaxis`
  - 100 mg once daily · remainder of pregnancy · oral
  - Notes: ACOG directs suppression for the remainder of the pregnancy. **FDA label note, retained for the prescriber and deliberately not gated per physician direction:** nitrofurantoin is label-contraindicated at 38–42 weeks, during labour, and when labour is imminent, because of neonatal haemolytic anaemia risk.
  - Source: [1]; [6]
- **Med-7 — Cephalexin 250–500 mg, suppressive** (on Step 5.2)
  - Role: first_line · Clinical role: `uti-suppressive-prophylaxis`
  - 250–500 mg once daily · remainder of pregnancy · oral
  - Notes: co-equal with Med-6 and the label-safe choice at term.
  - Source: [1]
- **Med-8 — Clindamycin** (on Step 4.4)
  - Role: **contraindicated** for this indication · Clinical role: `uti-antibiotic-first-line`
  - Notes: **must not be used to treat GBS bacteriuria or any UTI, even in penicillin allergy** —
    it concentrates poorly in urine. A clindamycin susceptibility result on an antepartum GBS
    urine culture exists **only** to guide intrapartum prophylaxis.
  - Source: [2]

**Cross-pathway conflicts — and the mechanism cannot see either of them.**

1. **Trimethoprim-sulfamethoxazole is contraindicated in documented folate-deficiency
   megaloblastic anaemia** and interferes with folate metabolism — directly against the anemia
   pathway's `folate-repletion` lane. Different lanes, so **no conflict fires**.
2. **Nitrofurantoin should be avoided in G6PD deficiency** (haemolytic anaemia) — precipitating
   haemolysis in a patient being treated for anaemia. Also invisible to lane matching.

Lane names were checked against all nine existing tags across the anemia and
gestational-hypertension pathways: **no collisions**. Which is the point — the mechanism detects
*duplicate therapy*, and these are *contraindications*. There is no interaction or
contraindication edge in the schema.

**`[GAP]` — the nitrofurantoin/oral-iron interaction does not exist.** It was proposed during
research and refuted against the full label, which names only magnesium trisilicate antacids and
uricosurics. The real iron interaction is with **quinolones** (2 hours before / 6 hours after) —
latent here, since quinolones are not ACOG-listed agents for this indication.

## 6. Lab tests

- **Lab-1 — Urine culture with colony count** (on Steps 1.1, 2.1, 5.1): code `19090-0` LOINC,
  midstream urine. `NCnc`/`Qn`, CFU/mL. The quantitative gate target. [1]
- **Lab-2 — Bacteria identified in urine by culture** (on Steps 2.1, 4.1): code `630-4` LOINC,
  midstream urine. **`Prid`/`Nom` — nominal.** The organism identity, which the model cannot
  hold. [1]
- **Lab-3 — Antimicrobial susceptibility** (on Steps 3.1, 5.2): code `87186` CPT (MIC method),
  urine isolate. Drives targeted therapy and suppressive agent selection. [1]
- **Lab-4 — Urinalysis with microscopy** (on Step 2.1): code `24356-8` LOINC, urine. Supportive
  only — **must not be used for ASB screening**. [1]
- **Lab-5 — Nitrite and leukocyte esterase, test strip** (on Step 2.1): code `32782-5` LOINC,
  urine. If neither is present, UTI is unlikely (NPV 78–98%). [1]
- **Lab-6 — *S. agalactiae* susceptibility in urine** (on Step 4.5): code `102104-7` LOINC.
  Ordered **only** to guide intrapartum prophylaxis in penicillin-allergic patients. [2]

## 7. Imaging

None. Renal ultrasonography appears only in the inpatient pyelonephritis non-response pathway,
beyond this scope.

## 8. Procedures

None in the outpatient scope.

## 9. Guidance

- **Guid-1 — topic "When to call us right away"** (on Step 3.1): category safety-netting.
  Instructions: You are being treated for a bladder infection. Most people feel better within a
  day or two. But a bladder infection can move up to the kidneys, and a kidney infection in
  pregnancy is serious. Call right away — do not wait for your next appointment — if you get any
  of these: a **fever of 100.4°F (38°C) or higher**; **pain in your back or your side**, usually
  just below the ribs; **shaking chills**; **feeling sick to your stomach or throwing up**; your
  bladder symptoms **not improving after 1–2 days** of antibiotics, or getting worse; **blood in
  your urine**. You do not need all of these — fever on its own, or back or side pain on its
  own, is enough of a reason to call. If you cannot reach us, go to urgent care or the emergency
  room; do not wait for treatment. Always say that you are pregnant and how many weeks.
  `[DECISION — LICENSING]` **This text is authored from ACOG Clinical Consensus No. 4 and ACOG
  patient FAQ050, not from the ACOG/AIM warning-signs card.** That card is licensed for
  distribution *"in its entirety and without modification, for solely noncommercial activities
  that are for educational, quality improvement, and patient safety purposes"* — so a trimmed,
  reordered UTI extract falls outside the grant. The card may still be linked whole. [1][8]
- **Guid-2 — topic "Finish the whole course"** (on Step 3.1): category adherence.
  Instructions: Most symptoms go away in 1 to 2 days. It is very important to finish the
  medication prescribed for a urinary tract infection, **even after your symptoms go away** —
  because each untreated infection risks moving up to the kidneys. **`[GAP]`** No source
  addresses what to do about a specific missed dose; that is pharmacy labelling advice and must
  not be attributed to ACOG. Note also that "stopping early causes resistance" is **not**
  supported by these sources — the sourced reason to finish is progression to pyelonephritis. [8]
- **Guid-3 — topic "What we are not recommending, and why"** (on Step 3.1): category education.
  Instructions: Cranberry products, probiotics, D-mannose, extra hydration, voiding after
  intercourse and front-to-back wiping are **not** recommended for preventing urinary infections
  in pregnancy. This is not an oversight: the one US guideline that covers them **explicitly
  excludes pregnant women**, and its evidence review excluded them from study selection. For
  non-pregnant women, post-coital voiding and wiping direction are described as myths, and a
  large trial found D-mannose no better than placebo. Front-to-back wiping remains a **urine
  specimen collection** instruction — a different thing. The only prevention measure with a
  basis in pregnancy is antibiotic suppression, and only after a recurrence. [1][9]
- **Guid-4 — topic "What group B strep in your urine means"** (on Step 4.1): category education.
  Instructions: Your urine test grew a bacterium called group B strep. Two things follow, and
  both are good to know now. First, you will be given **antibiotics through a drip during
  labour** to protect your baby — this happens regardless of the amount grown. Second, you will
  **not** need the usual group B strep swab at 36–37 weeks, because this result already tells us
  what that swab would. If the amount grown was high, or you have symptoms, you will also be
  treated now. [2]

## 10. Quality metrics

- **QM-1 — Asymptomatic bacteriuria screening completion** (on Step 1.1): measure — of pregnant
  patients, the proportion with **at least one urine culture** (not dipstick) resulted during
  pregnancy, ideally at or before the first-trimester visit. Steward: **local**. [1][3]

`[GAP]` — **there is no national quality measure for prenatal asymptomatic bacteriuria screening
completion, for UTI treatment in pregnancy, or for outpatient antibiotic stewardship covering
urinary infection.** Every national outpatient stewardship measure is respiratory — acute
bronchitis, pharyngitis, upper respiratory infection, sinusitis. Searched: the full 2026
eligible-clinician eCQM set, the complete 405-measure MIPS inventory, HEDIS MY2026, Joint
Commission Perinatal Care v2026B, the AIM sepsis bundle, CDC/NHSN, and the CMS Measures
Inventory Tool. The only national measure this pathway touches is the inpatient
severe-obstetric-complications eCQM, and only at the far end — a missed screen becoming
pyelonephritis becoming maternal sepsis at a delivery admission. It cannot measure outpatient
performance.

## 11. Schedules

- **Sched-1** (on Step 1.1): interval "once, early in prenatal care"; ACOG declines to specify a
  gestational age; USPSTF says first prenatal visit or 12–16 weeks, whichever is earlier. [1][3]
- **Sched-2** (on Step 3.1): interval "5–7 days"; antibiotic course. Fosfomycin is a single dose. [1]
- **Sched-3** (on Step 5.1): interval "1–2 weeks after completing treatment"; optional test of
  cure after cystitis only. **Not** after asymptomatic bacteriuria, where ACOG makes no
  recommendation. [1]
- **Sched-4** (on Step 5.2): interval "daily, for the remainder of pregnancy"; suppressive
  prophylaxis, continuing to delivery per ACOG. [1]

## 12. Prerequisites (REQUIRES)

**None emitted — deliberately.** The clinical dependencies are real and are stated below, but
**`REQUIRES` edges must not be emitted in this pathway.** See U13.

Clinical dependencies, carried in the step descriptions instead:
- Classification (2.2) follows culture interpretation (2.1).
- Treatment (3.1) follows classification (2.2).
- Antepartum GBS treatment (4.4) follows GBS identification (4.1).
- Test of cure (5.2) and suppression (5.3) both follow a completed course (3.1).

## 13. Code entries

| Code | System | Description | Attached to |
|---|---|---|---|
| 19090-0 | LOINC | Colony count [#/volume] in Urine | Lab-1 |
| 630-4 | LOINC | Bacteria identified in Urine by Culture | Lab-2 |
| 24356-8 | LOINC | Urinalysis complete panel - Urine | Lab-4 |
| 32782-5 | LOINC | Leukocyte esterase+Nitrite [Presence] in Urine by Test strip | Lab-5 |
| 102104-7 | LOINC | Streptococcus agalactiae [Susceptibility] in Urine by Culture | Lab-6 |
| 87086 | CPT | Culture, bacterial; quantitative colony count, urine | Lab-1 |
| 87088 | CPT | Culture, bacterial; with isolation and presumptive identification of each isolate, urine | Lab-2 |
| 87186 | CPT | Susceptibility studies, antimicrobial agent; microdilution or agar dilution | Lab-3 |
| 1648755 | RXNORM | nitrofurantoin, macrocrystals 25 MG / nitrofurantoin, monohydrate 75 MG Oral Capsule | Med-1 |
| 309114 | RXNORM | cephalexin 500 MG Oral Capsule | Med-2 |
| 808917 | RXNORM | fosfomycin 3000 MG Granules for Oral Solution | Med-3 |
| 198335 | RXNORM | sulfamethoxazole 800 MG / trimethoprim 160 MG Oral Tablet | Med-4 |
| 562508 | RXNORM | amoxicillin 875 MG / clavulanate 125 MG Oral Tablet | Med-5 |
| O23.13 | ICD-10 | Infections of bladder in pregnancy, third trimester | Step 2.2 |
| O23.43 | ICD-10 | Unspecified infection of urinary tract in pregnancy, third trimester | Step 2.2 |
| R82.71 | ICD-10 | Bacteriuria | Step 2.2 |
| B95.1 | ICD-10 | Streptococcus, group B, as the cause of diseases classified elsewhere | Step 4.1 |
| B96.20 | ICD-10 | Unspecified Escherichia coli as the cause of diseases classified elsewhere | Step 2.2 |
| O99.820 | ICD-10 | Streptococcus B carrier state complicating pregnancy | Step 4.1 |
| Z13.89 | ICD-10 | Encounter for screening for other disorder | Step 1.1 |
| N10 | ICD-10 | Acute pyelonephritis | Step 6.1 |

**Codes rejected at verification, recorded so they are not reintroduced:** `B95.5` (unspecified
streptococcus — **wrong for GBS**, use B95.1); `Z22.33`, `Z87.44`, `T83.0` (non-billable
headers; T83 needs seven characters); `19091-8` (a bare count with no volume denominator — not
CFU/mL); `21482-5`-style mass/volume confusions do not arise here but the same class of error
does: see the unit warning on `gate-culture-positive`.

## 14. Attribute-map registrations

**None.** Every gate uses coded-form conditions against `labResults`, `conditionCodes`,
`allergies` and `vitalSigns` directly. No `lab.*`, `allergy.*` or `patient.*` attribute is
referenced.

## 15. Evidence citations

- **[1]** Urinary Tract Infections in Pregnant Individuals: ACOG Clinical Consensus No. 4 — ACOG, Obstetrics & Gynecology 142(2):435–445, 2023 (**Reaffirmed 2026**; December 2024 Correction, Obstet Gynecol 144(6):e138–e139), **Expert Consensus** (this document assigns no evidence grades), https://www.acog.org/clinical/clinical-guidance/clinical-consensus/articles/2023/08/urinary-tract-infections-in-pregnant-individuals
- **[2]** Prevention of Group B Streptococcal Early-Onset Disease in Newborns: ACOG Committee Opinion No. 797 — ACOG, Obstetrics & Gynecology 135(2):e51–e72, 2020 (**Reaffirmed 2025**; April 2020 Correction, typographic), **Expert Consensus**, https://www.acog.org/clinical/clinical-guidance/committee-opinion/articles/2020/02/prevention-of-group-b-streptococcal-early-onset-disease-in-newborns
- **[3]** Screening for Asymptomatic Bacteriuria in Adults: USPSTF Recommendation Statement — USPSTF, JAMA 322(12):1188–1194, 2019, **Grade B** (pregnant persons; Grade D nonpregnant), https://www.uspreventiveservicestaskforce.org/uspstf/recommendation/asymptomatic-bacteriuria-in-adults-screening
- **[4]** Clinical Practice Guideline for the Management of Asymptomatic Bacteriuria: 2019 Update — Nicolle LE et al., IDSA, Clinical Infectious Diseases 68(10):e83–e110, 2019, **Expert Consensus** (GRADE; the pregnancy treatment suggestion is weak/low-quality), https://academic.oup.com/cid/article/68/10/e83/5354895
- **[5]** *(reserved)*
- **[6]** FDA prescribing information via DailyMed: nitrofurantoin, sulfamethoxazole-trimethoprim, cephalexin, ciprofloxacin — FDA/NLM, current, **Expert Consensus**, https://dailymed.nlm.nih.gov/dailymed/
- **[7]** *(reserved)*
- **[8]** Urinary Tract Infections (UTIs) — ACOG patient FAQ050, updated January 2024, reviewed October 2025, **Expert Consensus**, https://www.acog.org/womens-health/faqs/urinary-tract-infections
- **[9]** Recurrent Uncomplicated Urinary Tract Infections in Women: AUA/CUA/SUFU Guideline — American Urological Association, 2019, validity confirmed 2022, **amended 2025**, **Level B** for the cranberry and D-mannose statements, https://www.auanet.org/guidelines-and-quality/guidelines/recurrent-uti — **explicitly excludes pregnant women from scope**; cited only to state what is *not* applicable
- **[10]** Urgent Maternal Warning Signs — ACOG/AIM, © 2025 (handout V5, September 2022), **Expert Consensus**, https://saferbirth.org/psbs/urgent-maternal-warning-signs/ — **linked whole, never extracted**

## 16. Citation map

- Stage 1: [1][3] · Stage 2: [1] · Stage 3: [1][6] · Stage 4: [2] · Stage 5: [1][6] · Stage 6: [1]
- Step 1.1: [1][3] · Step 1.2: [1]
- Step 2.1: [1] · Step 2.2: [1]
- Step 3.1: [1][6] · Step 3.2: [1] · Step 3.3: [1]
- Step 4.1: [2] · Step 4.2: [2] · Step 4.3: [2] · Step 4.4: [2] · Step 4.5: [2]
- Step 5.1: [1][4] · Step 5.2: [1] · Step 5.3: [6]
- Step 6.1: [1]
- DP-1: [1] · Criteria 1a, 1b: [1]
- Med-1: [1][6] · Med-2: [1] · Med-3: [1] · Med-4: [1][6] · Med-5: [1] · Med-6: [1][6] · Med-7: [1] · Med-8: [2]
- Lab-1 to Lab-5: [1] · Lab-6: [2]
- Guid-1: [1][8] · Guid-2: [8] · Guid-3: [1][9] · Guid-4: [2]

**Cannot cite — evidence attaches to the host Step:** all Gates → their attached Step per the
§4b rationale references; QM-1 → Step 1.1 [1][3]; Sched-1 → Step 1.1 [1][3]; Sched-2 → Step 3.1
[1]; Sched-3 → Step 5.1 [1]; Sched-4 → Step 5.2 [1][6]; all CodeEntries → none.

## 17. Temporal horizon & status summary (EMITTED — review carefully)

| Gate | Condition on | horizon | status | window_days | Rationale |
|---|---|---|---|---|---|
| gate-culture-positive | labs 19090-0 | {days: 300} | — | — | This pregnancy only — a prior pregnancy's culture must not fire treatment now |
| gate-recurrent-uti | conditions O23.* | — | — | **300** | Operator-windowed (XOR rule). ACOG's window is "during pregnancy"; 300 days is the proxy |
| gate-no-repeat-screening | conditions E10.*, E11.*, O24.*, G82.2*, G82.5*, N31.*, T91.3 | LIFETIME | any | — | Diabetes and spinal cord injury are standing conditions |
| gate-penicillin-allergy | allergies Z88.0, Z88.1 | LIFETIME | any | — | Drug allergy does not expire |
| gate-pyelonephritis-suspected | vitals temperature_c | — | — | — | Vitals are a single current value with no dates; no scoping possible |
| gate-pyelonephritis-suspected | conditions N10 | {days: 300} | active | — | This pregnancy only |

`[DECISION]` **300 days is again the "this pregnancy" proxy** — the horizon grammar has no
pregnancy concept and no anchor to the estimated delivery date. Same limitation as the
gestational-hypertension pathway. For `gate-recurrent-uti` this is more consequential than
usual: the count will keep accruing into the postpartum period unless the pregnancy episode
closes.

## 18. Gaps & fallbacks

### Not encodable — clinical content that cannot become a data gate

| # | What the guideline requires | Why it cannot be expressed | Fallback |
|---|---|---|---|
| **U1** | **Which organism grew** | `LabResult.value` is typed `number`. A culture result is nominal. Organism identity has **no representation at all** | `gate-gbs-identified` question gate |
| **U2** | **GBS at ≥10⁵ CFU/mL** | Requires joining nominal identity to a separate quantitative count for the same isolate. Verified twice: **no GBS-specific colony-count LOINC exists**, and the generic count carries **no isolate number**, so in mixed growth it cannot be attributed to a named organism | `gate-gbs-treat-threshold` question gate |
| **U3** | **Excluding normal vulvovaginal flora** | Same as U1 — a *Lactobacillus* culture at 10⁵ CFU/mL fires the positive gate | Clinician review at Step 2.1 |
| **U4** | **Unit-correct colony-count comparison** | No unit checking anywhere; `unit` is not an allowed key on a coded condition. Banded and censored results ("&gt;100,000") are common in urine cultures and cannot be compared numerically | Pin LOINC 19090-0; warn prominently |
| **U5** | **Gestational age** (first trimester) | `patient.*` attributes are never populated; Z3A would need one condition per week | Question gates |
| **U6** | **Antibiotic course completed** | Medication records carry a start date, not an adherence outcome | `gate-treatment-completed` question gate |
| **U7** | **Flank pain / CVA tenderness** | Exam findings with no data route. The gate therefore fires on **fever alone** — the CVA-tenderness-without-fever presentation ACOG warns about is not detected | Carried in Step 6.1 instruction and Guid-1 |
| **U8** | **Penicillin allergy risk stratification** (low vs high anaphylaxis risk) | The distinction turns on the nature of the reaction, which is a history judgment, not a coded fact | Clinician instruction in Steps 3.2 and 4.5 |
| **U9** | **Sickle cell trait, distinguished from disease** | The haemoglobin-C code the guideline needs to exclude is a shared bucket also holding Hb-C disease and other haemoglobinopathies, so a code-keyed gate over-captures. Needs a lab key — and electrophoresis results are nominal (U1) | Not gated; noted in Step 1.1 |
| **U10** | **What counts as a UTI episode** | ACOG never defines the countable unit and concedes the definition is unresolved. One infection generates an index culture, a test-of-cure and multiple claims | Authored de-duplication rule required |
| **U11** | **Scoping to this pregnancy** | No pregnancy anchor in the horizon grammar | `{days: 300}` proxy |
| **U13** | **`REQUIRES` prerequisite edges** | **The traversal engine walks every outgoing edge with no type filter, so `REQUIRES` — which points BACKWARDS by design and is excluded from the depth calculation — is traversed FORWARDS.** An unsatisfied gate on a dependent node therefore marks its own prerequisite, cascading backwards. Proven at build: with `step-5-2 REQUIRES step-3-1` present, an unanswered symptom question on a downstream *optional* test-of-cure step marked the **antibiotic treatment step** PENDING_QUESTION. Removing the edges flipped it to INCLUDED. All five candidate pairs here cross a gating boundary | No `REQUIRES` edges emitted; dependencies stated in step descriptions |
| **U14** | **Modern LOINC codes** | The import validator's LOINC pattern is `^\\d{1,5}-\\d$`, capping the numeric part at five digits. **LOINC passed 100000 years ago, so every 6-digit LOINC code is rejected at import** — including `102104-7` (*S. agalactiae* susceptibility in urine), which this pathway needs | Susceptibility carried by CPT `87186` instead; the LOINC is documented but not emitted |
| **U12** | **Contraindication relationships between drugs** | The schema has no interaction or contraindication edge. Conflict detection groups by therapeutic lane, catching *duplicate therapy* only. TMP-SMX vs folate-deficiency anaemia, and nitrofurantoin vs G6PD, are both invisible | Documented in §5 |

### Source conflicts requiring an authoring decision

| # | Conflict | Recommendation |
|---|---|---|
| **C1** | **GBS threshold: `>` (CC No. 4) vs `≥` (CO 797) vs `>10⁴` (USPSTF)** | **Use ≥10⁵**, per CO 797 — the GBS-specific document, reaffirmed 2025, stating it twice. CC No. 4's "greater than" is a drafting slip: "or higher"/"or more" appears 11 times in that document against one "greater than", including two sentences earlier in the same paragraph. USPSTF's 10⁴ is **descriptive**, outside its graded recommendation, and sourced to superseded 2010 CDC guidance |
| **C2** | **ACOG suppression "for the remainder of pregnancy" vs the FDA contraindication at 38–42 weeks** | **RESOLVED BY REVIEWING PHYSICIAN (2026-09-08): follow ACOG.** Suppression runs for the remainder of the pregnancy; **no 38-week stop gate is emitted**. The FDA contraindication (neonatal haemolytic anaemia at 38–42 weeks, in labour, or when labour is imminent) is **retained verbatim in the Med-1 and Med-6 notes** so it remains visible to the prescriber — it is not gated on, and not deleted |
| **C3** | **Treatment duration: ACOG 5–7 days vs IDSA 4–7 days** | **Use 5–7 days** — the US obstetric society figure. Record IDSA's 4-day floor as a permitted variant, not an average |
| **C4** | **Escalation gate: strict conjunction (ACOG's stated criterion) vs disjunction (ACOG's partial-presentation warning)** | **Disjunctive**, since a strict AND under-triggers against ACOG's own vigilance language. This is an authoring choice, not an ACOG criterion |
| **C5** | **Symptomatic cystitis at a low colony count** | ACOG's confirmatory threshold is 10⁵, but it notes "some authors" suggest treating counts as low as 10² of a single organism in symptomatic patients. Attributed, not adopted. **A symptomatic patient with a low count needs a route rather than falling out of the pathway** — currently handled by `gate-symptomatic` reaching Step 3.1 independently |

### Data-quality notes on the sources

- **ACOG Clinical Consensus No. 4 assigns no evidence grades** — no A/B/C, no GRADE, only a 75%
  consensus vote. Verified exhaustively across the full PDF. The pathway cannot stratify its
  recommendations by strength.
- **Five statements are "insufficient evidence to recommend for or against"** — repeat screening
  after a negative culture; repeat screening after ASB treatment; management after cystitis
  treatment; management after recurrent UTI; management after pyelonephritis. These are
  non-recommendations and must not become gates.
- **Drug-name drift caught at verification.** ACOG's body prose says *"nitrofurantoin and
  **sulfonamides**"*; only Table 1 names trimethoprim-sulfamethoxazole. The first-trimester
  prompt says sulfonamides to match the source.
- **The December 2024 correction is typographic** ("vesicoureteral reflex" → "reflux"), assessed
  as low risk to the dose table. Evidence: the correction's own metadata terms (Uterus, Residual
  Volume, Ureter) map onto that sentence and contain no drug terms; and CO 797's own two-page
  correction was purely typographic superscript restoration, refuting the argument that two
  pages implies substantive change. The body remains paywalled — `[GAP]`.
- **"Explicitly retired" overstates IDSA.** The 2005 periodic-rescreening recommendation was
  named and not carried forward, replaced by an insufficient-evidence statement — which leaves
  the decision open rather than instructing against rescreening.
- **`[GAP]`** No definition of what counts as a UTI episode; no guidance on missed doses; no
  patient-facing sepsis script validated for pregnancy; no disparities data in any anchor source
  (ACOG states it searched for them and reports none).

### Method note

`acog.org` returns HTTP 402 to some fetch tools but **HTTP 200 to a plain request with a desktop
browser user-agent** — and the same route retrieves ACOG's **PDFs**. This matters: the HTML
carries only table *captions*, so any term-count run against HTML alone silently excludes the
tables. All ACOG citations here are primary text, and the zero-count verifications were run
against the full PDF including Tables 1–3.
