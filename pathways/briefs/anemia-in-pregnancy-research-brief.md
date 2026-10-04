# Pathway Research Brief — Anemia in Pregnancy

JSON: pathways/json/anemia-in-pregnancy.json @ version 15

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

> ### ⚠ For Josh (v15) — one hemoglobin since iron started, no baseline: "recheck in 2–4 weeks, not nonresponse"
>
> v14's remaining dead end is closed. A patient 14 or more days into oral iron with a single
> hemoglobin below target and no pre-iron value to measure a rise from — including a value you
> type in at the visit — now gets a step that says: continue oral iron, this is not
> nonresponse, today's value is the baseline, repeat the CBC in 2–4 weeks. Nothing is asked.
> The response gates are reached only when the rise can be measured (two values) or she is at
> target, so they no longer ask for a second hemoglobin. Your own patient's result is
> unchanged ("came out correctly"). Two new points are marked `[JOSH — CONFIRM]` in §18:
> whether the at-target / below-target checks should read the **most recent** hemoglobin
> rather than only one from the last 28 days (as built, a lone value since the start that is
> itself over 28 days old is asked for again), and what this step orders (a CBC only).
>
> ### ⚠ For Josh (v14) — response check due, no hemoglobin since oral iron started → the recheck is ordered, not asked for
>
> Your patient of 2026-10-04 (28 weeks, Hgb 8 and MCV 70 dated 2026-09-01, ferrous gluconate on
> the list, oral iron started 2026-09-03) reached Step 2.14 and was then asked for a newer
> hemoglobin; "No newer result" left nothing. Now, from day 14 of oral iron, the pathway counts
> the hemoglobins drawn since it started. **None** → a new step orders the response recheck —
> CBC with indices, ferritin, iron/TIBC/transferrin saturation — and says these results decide
> whether she needs IV iron; no value is asked for. **One or more** → the response is assessed
> as before (rise ≥ 1 g/dL or at target → maintenance; otherwise nonresponse management). The
> same on the route where the pathway itself started the iron (§18 "Response due, not yet
> rechecked"). "At target at once" (2026-09-24) is kept: a patient already at target still gets
> maintenance immediately, the start visit included. Five points are marked `[JOSH — CONFIRM]`
> in §18: a hemoglobin drawn on the very day iron started counts as "since the start"; whether
> the recheck should include a reticulocyte count; the 14-day minimum reused for "recheck
> due"; your patient's plan lists the CBC four times (and
> ferritin and iron studies twice if "confirmatory studies" is answered yes); and nothing in
> the pathway reads the ferritin or iron-study results — the next visit decides on the
> hemoglobin rise.
> The dead end v14 left (a value typed in at the visit) is closed in v15, above.
>
> ### ⚠ For Josh (v13) — the most recent hemoglobin decides, however old; over 30 days old → repeat CBC
>
> "it should be most recent but > 30 days should trigger recheck" (§18). The transfusion gate
> (Hgb < 6) and the referral gate (Hgb < 9 or Hct < 27%) now read the newest value on file
> whatever its age, instead of 7 and 90 days — so a hemoglobin of 8 dated 33 days ago decides
> them and nothing is asked. When the newest hemoglobin is more than 30 days old (or there is
> none), Step 1.13 orders a repeat CBC. With no hemoglobin at all the level is still asked for,
> as in v10. Four points are marked `[JOSH — CONFIRM]` in §18: whether "severity unknown"
> (Step 1.9's ferritin) should now mean no hemoglobin ever rather than none in 90 days; the
> plan listing two CBC lines when the recheck is due; no upper limit on how old a deciding
> value may be; and the recheck line's wording.
>
> ### ⚠ For Josh (v12) — a patient already on iron skips the iron choices; points to confirm
>
> With MCV < 80, the pathway now reads the medication list before it asks anything about iron
> (§18 "Already on iron: skip the iron choices"). **Oral iron on the list** → DP-1 and DP-3 are
> not asked; she continues the oral iron she is on, its response is assessed as in Step 2.3,
> and one yes/no question offers the confirmatory iron studies. **IV iron on the list** → no
> DP-1, no DP-3, no iron recommended; a follow-up CBC. **No iron** → exactly v11. Seven points
> are marked `[JOSH — CONFIRM]` in §18: the IV-iron follow-up content; a stopped or old iron
> order still counts as "on iron"; nothing reads the confirmatory results on the on-iron
> route; a hemoglobinopathy-disease patient on oral iron is told to continue it; no
> confirmatory-studies question after IV iron; the oral-iron counseling blocks are not shown
> to a patient already on iron; and the medication list is read only for MCV < 80.
>
> ### ⚠ For Josh (v9) — IV iron first now waits for a ferritin; four new open points
>
> IV iron first (DP-3) gives IV iron only with a ferritin < 30 ng/mL on file, still from 14
> weeks. On the empiric arm, which has no ferritin, choosing IV iron first orders one, starts
> oral iron meanwhile and asks for the ferritin value; the confirmed arm is unchanged (§4
> DP-3, "IV iron first needs a confirmed ferritin"). Four consequences are yours to accept
> or change (§4 DP-3, `[CLINICAL AMBIGUITY — for Josh]` (a)–(d)): the ferritin question
> **holds that visit's care plan** until a value is entered; a ferritin ≥ 30 stops **all**
> iron on the IV-first route, while the empiric oral trial still gives oral iron; oral iron
> stops once IV iron opens; and a late diagnosis (criterion 3d) on the empiric arm now waits
> for the ferritin.
>
> v8's open point — DP-1 is asked again for hemoglobinopathy-disease patients — is accepted
> as is (§4 DP-1, §18).

---

## 1. Pathway metadata

- **Logical ID**: `anemia-in-pregnancy`
- **Title**: Anemia in Pregnancy — Classification and Treatment
- **Version**: 15 `[DECISION — Josh 2026-10-04]` (JSON `"15"`; was `"14"`). Imports as
  NEW_VERSION; v14 sessions keep v14's graph. Bumped for:
  - **A single hemoglobin since oral iron started, below target, with no baseline, is "recheck
    in 2–4 weeks, not nonresponse"** (§3 Steps 2.23, 2.24; §4b `gate-rise-unmeasurable` and its
    `-on-iron` copy, `gate-rechecked` / `gate-rechecked-on-iron` changed; §6 Lab-32, Lab-33;
    §9 Guid-11, Guid-12; §11 Sched-10, Sched-11; §13; §16; §17; §18). v14 left one dead end:
    with one hemoglobin since the start and nothing before it — most simply a value typed in
    at the visit — the response gates asked for a result "drawn after" today. Josh,
    2026-10-04: that state is "recheck in 2–4 weeks, not nonresponse". A new gate per route
    opens a step that says so and orders the repeat CBC; the rechecked gates now require the
    rise to be *measurable* (two points) or the hemoglobin at target, so the response gates
    never ask for a second value. Uses the engine's new `baseline_days` on an anchored
    `count_in_window` (josh-dev). Proofs: `gate-proof.ts response-recheck`, `response`.
  v14 `[DECISION — Josh 2026-10-04]` (was `"13"`; v13 sessions keep v13's graph) was bumped for:
  - **A response check that is due with no hemoglobin since oral iron started orders the
    recheck instead of asking for a value** (§3 Steps 2.3, 2.14, 2.19–2.22; §4b
    `gate-response-recheck-due` / `gate-rechecked` and their `-on-iron` copies, and the four
    response gates' new hosts; §6 Lab-26–31; §9 Guid-9, Guid-10; §13; §16; §17; §18). A patient
    on oral iron for a month, with a hemoglobin of 8 g/dL drawn two days before it started,
    was asked for a newer hemoglobin; "No newer result" closed both response gates and nothing
    followed. Josh, 2026-10-04: "It should be accepting the value I gave along with MCV and
    that oral iron supplementation was started 1 month ago. The recommendation should be to
    repeat testing with iron studies to determine need for IV iron." Now two anchored count
    gates stand in front of the response gates on each route: fewer than one hemoglobin since
    the start (from day 14) → a step that orders CBC with indices, ferritin and
    iron/TIBC/transferrin saturation and states what they decide; at least one → a step that
    hosts the response gates, which are otherwise unchanged. Uses the engine's new
    `count_comparison: "less_than"` on `count_in_window` (josh-dev). Proofs: `gate-proof.ts
    response-recheck`, and `response` / `on-iron` updated.
  v13 `[DECISION — Josh 2026-10-03]` (was `"12"`; v12 sessions keep v12's graph) was bumped for:
  - **The most recent hemoglobin decides, however old; over 30 days old triggers a recheck**
    (§3 Step 1.13, §4b `gate-severe-anemia` / `gate-referral-threshold` /
    `gate-hgb-recheck-due`, §6 Lab-25, §17, §18). A chart held a hemoglobin of 8 g/dL dated
    33 days before the visit; `gate-severe-anemia` read a 7-day horizon, treated the chart as
    having none and asked "most recent value?". Josh, 2026-10-03: "it should be most recent
    but > 30 days should trigger recheck". Now `gate-severe-anemia` (Hgb) and
    `gate-referral-threshold` (Hgb, Hct) read horizon `LIFETIME` — the newest value on file,
    whatever its date — and a new membership gate on Step 1.1, `gate-hgb-recheck-due` (no
    hemoglobin in the last 30 days), opens Step 1.13, which orders a repeat CBC with indices
    (Lab-25). With no hemoglobin on file at all the threshold gates still ask (v10's rule).
    The response gates and `gate-no-hgb-on-file` are unchanged. Proof: `gate-proof.ts
    hgb-recheck`.
  v12 `[DECISION — Josh 2026-10-03]` (was `"11"`; v11 sessions keep v11's graph) was bumped for:
  - **Already on iron: the iron choices are skipped** (§3 Steps 1.10, 2.14–2.18, 1.11, 1.12;
    §4 DP-1, DP-4; §4b `gate-no-iron-on-list` / `gate-on-oral-iron` / `gate-iv-iron-on-list` /
    `gate-confirm-studies-on-iron` and the `-on-iron` gate copies; §5 Med-17–20; §6 Lab-19–24;
    §9 Guid-7, Guid-8; §11 Sched-7–9; §17; §18). Through v11 the pathway never read the
    medication list, so a patient with ferrous sulfate on it was still asked DP-1 ("Empiric
    iron vs confirmatory studies first") and DP-3 ("Oral iron trial vs IV iron without an oral
    trial"). Josh, 2026-10-03, to three questions (does being on iron also skip the
    confirmatory workup; which medications count as oral iron; does IV iron on the list skip
    the oral-versus-IV choice too): "1. not necessarily. 2. all oral iron supplements based on
    what's written. 3. yes, skip". Now, behind gate-microcytic, oral iron on the list → no
    DP-1, no DP-3, continue the oral iron she is on, the response check, and a yes/no question
    for the confirmatory studies; IV iron on the list → no DP-1, no DP-3, no iron recommended,
    a follow-up CBC; no iron on the list → v11 unchanged. Proof: `gate-proof.ts on-iron`.
  v11 `[DECISION — Josh 2026-10-03]` (was `"10"`; v10 sessions keep v10's graph) was bumped for:
  - **Trigger codes are authored as families** (§1 Condition codes). Josh, 2026-10-03: "fix
    it in authoring and make sure various parent levels are included." The matcher expands a
    patient's diagnosis to its ICD-10 ancestors, so a parent code matches everything beneath
    it: `O99.011`/`O99.012`/`O99.013`/`O99.019` become `O99.01`, and `D50.9` becomes `D50`.
    Only `pathway.condition_codes` changed — no node, edge, gate or `CodeEntry` change. What
    each family newly admits is listed under the table, each item `[JOSH — CONFIRM]`.
  v10 `[DECISION — Josh 2026-10-03]` (was `"9"`; v9 sessions keep v9's graph) was bumped for:
  - **No hemoglobin level: ask, and if there is none, order the anemia labs** (§3 Step 1.9,
    §4b `gate-no-hgb-on-file`, §6 Lab-18, §18). Josh, 2026-10-03: "we ask the provider for a
    level if we don't have it. If none is entered, then we treat it as unknown level of
    anemia and recommend ordering anemia labs." The hemoglobin gates keep
    `on_unresolved: ask`. What is new: the provider can answer the question **"Not
    available"** (engine: `GateAnswerInput.notAvailable`), which stops every gate asking for
    that datum and lets them take their defaults; and with no hemoglobin on file in 90 days
    Step 1.9 orders a ferritin alongside Step 1.1's CBC with indices, so one draw returns
    the level, the indices and the iron status.
  v9 was bumped for:
  - **IV iron first needs a ferritin-confirmed iron deficiency** (§3 Steps 2.9, 2.12, 2.13,
    §2 Stage 2.6, §4 DP-3, §4b `gate-oral-bridge-ga` / `gate-ida-confirmed-iv` /
    `gate-no-ferritin-on-file`, §6 Lab-17): v8 gave IV iron first on the empiric arm with no
    ferritin on file. v9 orders a ferritin when none is on file, starts oral iron meanwhile,
    and gives IV iron (still at GA ≥ 14 only) once a ferritin < 30 ng/mL is on file. The
    confirmed arm's IV iron first is unchanged.
  - **DP-1 asked again for hemoglobinopathy-disease patients — accepted as is** `[DECISION —
    Josh 2026-09-25]` (§4 DP-1, §18): no JSON change; recorded.
  (v8 `[DECISION — Josh 2026-09-24]`, was `"7"`; v7 sessions keep v7's graph. Bumped for:)
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
| O99.01 | ICD-10 | Anemia complicating pregnancy (family: all trimesters) | primary trigger | anemia-pregnancy |
| D50 | ICD-10 | Iron deficiency anemia (family: all types) | secondary trigger — often coded alongside O99.01x [1] | anemia-etiology |

**Trigger codes are families** `[DECISION — Josh 2026-10-03]` (v11). Each row is a parent
code; a patient's diagnosis matches when it is that code or any code beneath it. Until v10
the list was the leaves `O99.011`, `O99.012`, `O99.013`, `O99.019` and `D50.9`. What each
family admits that the leaf list did not:

- **`O99.01`** — nothing new. Its members are the four codes v10 listed (`O99.011`,
  `O99.012`, `O99.013`, `O99.019`). `[JOSH — CONFIRM]` The family stops at `O99.01` on
  purpose: one level up, `O99.0`, would also admit `O99.02` (anemia complicating childbirth)
  and `O99.03` (anemia complicating the puerperium), which v10 did not trigger on. Say so if
  the postpartum handoff (Step 4.3) should make `O99.03` a trigger.
- **`D50`** — newly admits `D50.0` (iron deficiency anemia secondary to chronic blood loss),
  `D50.1` (sideropenic dysphagia) and `D50.8` (other iron deficiency anemias); `D50.9` was
  already a trigger. `[JOSH — CONFIRM]` each belongs on this pathway.
- **`D50` is not a pregnancy code** `[JOSH — CONFIRM]` — true of `D50.9` in v10 as well, now
  true of the whole family: until pathway classification is built (`pathways/TODO.md`), any
  patient with a `D50` code, pregnant or not, triggers this pathway.
- `[BUILD NOTE]` The family match needs the patient's code and the parent in the deployment's
  `icd10_codes` table. The repo's common-codes seed
  (`shared/data-layer/seed/icd10-common-codes.sql`) holds `D50` and its four children but
  **no `O99.01x` row**, so on a database seeded only from it a patient's `O99.012` has no
  ancestors to expand to and will not match `O99.01`.

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
  instead (`gate-hgbpathy-microcytic`) — §4 DP-1. With Step 2.8, the empiric arm chooses
  the oral trial or IV iron without an oral trial as ferritin-confirmed IDA does — except
  that since v9 IV iron first, with no ferritin on file, orders a ferritin, starts oral iron
  meanwhile and gives IV iron only once ferritin < 30 confirms iron deficiency `[DECISION —
  Josh 2026-09-25]` (§4 DP-3) — and its oral trial brings the same response assessment and IV-iron escalation route (§4,
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
- **Stage 2.6 — Oral Iron While IV Iron Waits (before 14 weeks, or until ferritin confirms
  iron deficiency)** *(branch-entry only, via gate-oral-bridge-ga on Step 2.9; v8, widened
  v9)* `[DECISION — Josh 2026-09-24]` (oral until 14 weeks, then IV) and `[DECISION — Josh
  2026-09-25]` (oral iron meanwhile while the empiric arm's ferritin is outstanding) with a
  `[BUILD NOTE]` structure: holds the same Steps 2.1–2.3 as Stage 2.5 — oral iron, the trial
  period, the response check — for a patient whose provider chose IV iron without an oral
  trial at DP-3 when IV iron cannot be given yet: **no ferritin on file** (v9 — the empiric
  arm; any GA), or **before 14 0/7 weeks with iron deficiency confirmed** (v8). (v8 title:
  "Oral Iron Until 14 Weeks (IV iron chosen before 14 weeks)".) Numbered 2.6: unique, just
  after Stage 2.5; its steps keep their numbers. Carries Stage 2's citations. [1][5]
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
- **Step 1.7 — Microcytic anemia: iron strategy** *(v12: gated by gate-no-iron-on-list on
  Step 1.10 — its only way in; v4–v11: gated by gate-microcytic)* `[DECISION — Josh
  2026-09-24]`: hosts DP-1 (empiric oral iron vs confirmatory
  iron studies first). Exists because a gate can only guard a Step or Stage, and DP-1
  must hang from a Step. Numbered 1.7 to keep existing step ids stable, although it
  follows Step 1.1 logically. v7: gate-microcytic also required no hemoglobinopathy disease
  code, so disease patients never saw DP-1; **v8** `[DECISION — Josh 2026-09-24]`:
  gate-microcytic is MCV < 80 alone again, DP-1 is offered to disease patients too, and the
  disease check sits on the empiric branch (§4 DP-1). **v12** `[DECISION — Josh 2026-10-03]`:
  reached only with **no iron product on the medication list** — gate-microcytic now opens
  Step 1.10, and Step 1.10's gate-no-iron-on-list opens this step — so DP-1 is not asked of
  a patient already on iron. Everything from DP-1 down is unchanged. [1]
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
  neither branch opens, nothing is asked). **v14** `[DECISION — Josh 2026-10-04]`: Step 2.3
  no longer hosts the two response gates. It hosts two count gates (§4b): from day 14, **no
  hemoglobin drawn since oral iron started** → Step 2.21 (the recheck is ordered; nothing is
  asked); **one on file — or hemoglobin already at target, at any time** → Step 2.22, which hosts `gate-hgb-response` / `gate-hgb-nonresponse`.
  Lab-10, Sched-2 and QM-1 stay on Step 2.3. [1][3][6]
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
  14). v7 opened nothing here before 14 weeks. **v9** `[DECISION — Josh 2026-09-25]`: IV
  iron also needs a ferritin < 30 ng/mL on file. Step 2.9 now hosts three gates, each with
  its own target: gate-iv-iron-ga-direct (GA ≥ 14) → **Step 2.13** (ferritin check) →
  Step 2.10; gate-oral-bridge-ga (no ferritin on file, or GA < 14 with iron deficiency
  confirmed) → Stage 2.6; gate-no-ferritin-on-file → **Step 2.12** (orders a ferritin). The
  gates read the chart, not the arm: on the confirmed arm the ferritin that opened Stage 2 is
  on file, so they behave exactly as v8's; on the empiric arm there is none (§4 DP-3).
  [1][5][6][8]
- **Step 2.10 — IV iron therapy (no oral trial)** *(gated by gate-ida-confirmed-iv on Step
  2.13 — its only way in since v9; v7–v8: gate-iv-iron-ga-direct on Step 2.9)*: Med-13–16 and
  Sched-6, copies of Step 2.5's Med-4–7 and Sched-3 (one node per host step; Step 2.5 stays
  the post-non-response IV iron). Deliberately **no** `REQUIRES Step 2.2`: that is the oral
  trial this branch skips. [1][5][7][22]
- **Step 2.11 — Malabsorption on the chart: IV iron without an oral trial favoured (DP-3
  criterion 3c)** *(gated by gate-malabsorption-chart on Step 2.8 — its only way in; v8)*
  `[DECISION — Josh 2026-09-24]` (3c readable from the chart) as a `[BUILD NOTE]`
  recommendation step: hosts Guid-6. Opens next to the DP-3 question whenever the chart
  carries a malabsorption code (§4b), on either iron arm; it does not choose the route. [1][8][18][19]
- **Step 1.9 — Hemoglobin level unknown: order anemia labs** *(gated by
  gate-no-hgb-on-file on Step 1.1 — its only way in; v10)* `[DECISION — Josh 2026-10-03]`
  (no level on file and none entered → unknown severity → order the anemia labs): no
  hemoglobin in the last 90 days. Orders Lab-18 (ferritin, its own node); Step 1.1's Lab-1
  (CBC with indices) is unconditional, so together they are the anemia labs. Open from the
  start of the visit, while the hemoglobin question is still being asked; closed as soon
  as a hemoglobin is on file — entered by the provider or resulted. `[JOSH — CONFIRM]` the
  order set: CBC with indices + ferritin. Iron/TIBC, reticulocytes and B12/folate stay
  behind the MCV classification, which the CBC answers. [1][5]
- **Step 1.13 — Hemoglobin older than 30 days: repeat the CBC** *(gated by
  gate-hgb-recheck-due on Step 1.1 — its only way in; v13)* `[DECISION — Josh 2026-10-03]`
  ("> 30 days should trigger recheck"): no hemoglobin in the last 30 days. The threshold
  gates (§4b `gate-severe-anemia`, `gate-referral-threshold`) decide on the most recent
  value however old it is; when that value is more than 30 days old this step orders Lab-25,
  a repeat CBC with indices (its own node — a copy of Lab-1). It is also open when there is
  no hemoglobin on file at all — then Step 1.9 is open too and the level is asked for.
  Closed as soon as a hemoglobin from the last 30 days is on file — resulted, or entered by
  the provider. Hematocrit has no recheck step of its own; the CBC returns it. [1]
- **Step 1.10 — Microcytic anemia: is iron already on the medication list?** *(gated by
  gate-microcytic — its only way in; v12)* `[DECISION — Josh 2026-10-03]` (already on iron →
  skip the iron choices) as a `[BUILD NOTE]` step: hosts the three medication-list gates
  (§4b) and nothing else. It reads the list and asks nothing: **no iron** →
  gate-no-iron-on-list → Step 1.7 (DP-1, as v11); **oral iron and no IV iron** →
  gate-on-oral-iron → Step 2.14; **IV iron**, with or without oral iron →
  gate-iv-iron-on-list → Step 2.18. Exactly one of the three opens. Exists for the same
  reason as Step 1.7: a gate can only guard a Step, and the MCV condition stays in one gate
  (a missing MCV is asked once and holds all three routes). [1]
- **Step 2.14 — Already on oral iron: continue it and assess the response** *(gated by
  gate-on-oral-iron on Step 1.10 — its only way in; v12)* `[DECISION — Josh 2026-10-03]`:
  the medication list holds an oral iron product (§4b for the codes) and no IV iron. DP-1
  and DP-3 are not asked; **no oral iron is initiated or chosen** — Med-1/2/3 (and Med-11)
  are not on this route, so there is no choice of drug; Guid-7 says to continue the oral
  iron she is on. Hosts Guid-7, Lab-19 (the CBC recheck, a copy of Lab-10), Sched-7 (a copy
  of Sched-2) and three gates. **v14** `[DECISION — Josh 2026-10-04]`: the two count gates
  `gate-response-recheck-due-on-iron` → Step 2.19 (on oral iron ≥ 14 days, no hemoglobin since
  it started: the recheck is ordered, nothing is asked) and `gate-rechecked-on-iron` → Step
  2.20, which now hosts `gate-hgb-response-on-iron` → Step 2.15 and
  `gate-hgb-nonresponse-on-iron` → Step 2.16 (the response check — identical copies of Step
  2.22's two gates; through v13 they hung from Step 2.14 itself and asked for a newer
  hemoglobin when none had been drawn). And the question gate `gate-confirm-studies-on-iron`
  → Step 1.12 (answer 1, "not necessarily": the confirmatory workup is offered, neither
  skipped nor forced).
  `[BUILD NOTE]` **Why this is a copy of Step 2.3's response check and not Step 2.3 itself:**
  Step 2.3 lies under DP-1, which gate-no-iron-on-list closes for this patient, and a closing
  chart gate sweeps everything it contains, sparing nothing (the v7 finding, §4 DP-1) — so
  two complementary chart gates can never both lead into Step 2.3. The copies carry the same
  conditions (the `-on-iron` suffix makes `check-gate-control` fail the build if they drift),
  so the response rule is the same rule. **Where the start date comes from here:** no
  oral-iron Medication node is recommended on this route, so the visit can never be read as
  the start; the anchor is a clinician-entered date, else the earliest stored care plan, else
  the earliest **dated** order of 310325 / 198630 / 284202 / 311975, else it is **asked**
  ("When did oral iron start?") — which is what the simulator's undated medication list
  gives. No `REQUIRES Step 2.1` (there is no initiation on this route). [1][3]
- **Step 2.15 — Maintenance & surveillance (already on oral iron)** *(gate-hgb-response-on-iron
  — its only way in; v12; the gate sits on Step 2.20 since v14)* `[BUILD NOTE]`: a copy of Step 2.4. [3]
- **Step 2.16 — Nonresponse management (already on oral iron)** *(gate-hgb-nonresponse-on-iron
  — its only way in; v12; the gate sits on Step 2.20 since v14)* `[BUILD NOTE]`: a copy of Step 2.6; hosts **DP-4**, a copy of
  DP-2. [1][3][6]
- **Step 2.19 — Response to oral iron not yet checked: repeat CBC and iron studies (already
  on oral iron)** *(gated by gate-response-recheck-due-on-iron on Step 2.14 — its only way
  in; v14)* `[DECISION — Josh 2026-10-04]`: oral iron started 14 or more days ago and no
  hemoglobin has been drawn since it started. The hemoglobin on file from before the start is
  kept as the baseline; **no newer value is asked for**. Orders the response recheck on its
  own lab nodes — Lab-26 (CBC with indices), Lab-27 (ferritin), Lab-28 (iron/TIBC/transferrin
  saturation) — whatever the answer to "Order confirmatory iron studies now?" on Step 2.14,
  and carries Guid-9: continue oral iron; these results decide whether she is responding or
  needs IV iron. **IV iron is not started from this step.** Closes once a hemoglobin dated on
  or after the start day is on file; Step 2.20 then assesses the response. [1][3]
- **Step 2.20 — Response assessment (already on oral iron)** *(gated by gate-rechecked-on-iron
  on Step 2.14 — its only way in; v14)* `[BUILD NOTE]`: oral iron started 14 or more days ago
  and a hemoglobin dated on or after the start day is on file — or hemoglobin is already at
  target, at any time (§4b). Hosts
  `gate-hgb-response-on-iron` → Step 2.15 and `gate-hgb-nonresponse-on-iron` → Step 2.16,
  moved here from Step 2.14 unchanged. A step with gates only, like Step 1.10: a gate can
  only guard a Step or Stage, so "evaluate the response gates only once a recheck exists"
  needs a step between the count gate and the response gates. [1][3]
- **Step 2.21 — Response to oral iron not yet checked: repeat CBC and iron studies** *(gated
  by gate-response-recheck-due on Step 2.3 — its only way in; v14)* `[DECISION — Josh
  2026-10-04]`: Step 2.19's twin on the route where the pathway started the oral iron — a
  patient started at an earlier visit, back 14 or more days later with no hemoglobin since.
  Lab-29 (CBC with indices), Lab-30 (ferritin), Lab-31 (iron/TIBC/transferrin saturation),
  Guid-10 (Guid-9's text). IV iron is not started from this step. [1][3]
- **Step 2.22 — Response assessment: hemoglobin on file since oral iron started** *(gated by
  gate-rechecked on Step 2.3 — its only way in; v14)* `[BUILD NOTE]`: Step 2.20's twin (a
  hemoglobin since the start, or already at target); hosts
  `gate-hgb-response` → Step 2.4 and `gate-hgb-nonresponse` → Step 2.6, moved here from Step
  2.3 unchanged. [1][3]
- **Step 2.23 — Rise cannot be measured yet: recheck hemoglobin in 2–4 weeks (already on oral
  iron)** *(gated by gate-rise-unmeasurable-on-iron on Step 2.14 — its only way in; v15)*
  `[DECISION — Josh 2026-10-04]`: oral iron started 14 or more days ago; a hemoglobin has been
  drawn since and is below target; there is no second value to measure a rise from (none from
  the 28 days before the start, and only one since). **Not nonresponse.** Carries Guid-11
  (continue oral iron; today's value becomes the baseline; the rise is judged at the recheck;
  do not escalate to IV iron on this alone), Lab-32 (the repeat CBC, named for the reason)
  and Sched-10 (2–4 weeks). No hemoglobin is asked for. Closes once a second hemoglobin is on
  file; Step 2.20 then assesses the response. [1][3]
- **Step 2.24 — Rise cannot be measured yet: recheck hemoglobin in 2–4 weeks** *(gated by
  gate-rise-unmeasurable on Step 2.3 — its only way in; v15)* `[DECISION — Josh 2026-10-04]`:
  Step 2.23's twin on the route where the pathway started the oral iron. Guid-12, Lab-33,
  Sched-11. [1][3]
- **v15 note on Steps 2.20 / 2.22:** their gates (`gate-rechecked-on-iron` / `gate-rechecked`)
  now open when the rise is *measurable* — two hemoglobins: one from the 28 days before the
  start or an earlier one since, and one since — or the hemoglobin is at target. So the
  response gates they host are reached only with the values they need.
- **Step 1.11 — Expanded / nonresponse workup (already on oral iron)** *(DP-4's branch; v12)*
  `[BUILD NOTE]`: a copy of Step 1.5 with its own Lab-20 (smear) and Lab-21 (hemoglobin
  electrophoresis). [1][4]
- **Step 2.17 — IV iron therapy (after nonresponse, already on oral iron)** *(gated: Step 2.16
  → DP-4 + gate-iv-iron-ga-on-iron; v12)* `[BUILD NOTE]`: a copy of Step 2.5 with Med-17–20
  (copies of Med-4–7) and Sched-8 (a copy of Sched-3). IV iron after a failed oral course,
  from 14 0/7 weeks, exactly as Step 2.5. No `REQUIRES Step 2.2` (the trial-period step is
  not on this route; the non-response gate is what puts IV iron after the oral course).
  [1][5][7][22]
- **Step 1.12 — Confirmatory iron studies (already on oral iron)** *(gated by the question
  gate-confirm-studies-on-iron on Step 2.14 — its only way in; v12)* `[DECISION — Josh
  2026-10-03]` (answer 1): opened by a **yes** to "Order confirmatory iron studies now?".
  Orders Lab-22 (ferritin) and Lab-23 (iron/TIBC/saturation) — Step 1.2's tests, own nodes.
  **Nothing on this route reads the results** `[JOSH — CONFIRM]`: oral iron continues
  whatever the ferritin (Step 1.2's gate-ida-confirmed is not copied here). [1][5]
- **Step 2.18 — IV iron on the medication list: follow-up** *(gated by gate-iv-iron-on-list on
  Step 1.10 — its only way in; v12)* `[DECISION — Josh 2026-10-03]` (answer 3, "yes, skip")
  with `[JOSH — CONFIRM]` content: the medication list holds an IV iron product, with or
  without oral iron. DP-1 and DP-3 are not asked; **no IV iron and no oral iron trial is
  recommended** (no Medication node on this route). Hosts Guid-8, Lab-24 (CBC, a copy of
  Lab-10) and Sched-9 (a copy of Sched-3, "~4 weeks after IV iron"). The pathway had no
  place for follow-up after IV iron that does not also recommend IV iron (Sched-3 / Sched-6
  hang from Steps 2.5 / 2.10 beside their Medication nodes), so this small step was added;
  its timing and wording are Sched-3's, nothing new. [1][5]
- **Step 2.12 — No ferritin on file: order ferritin before IV iron** *(gated by
  gate-no-ferritin-on-file on Step 2.9 — its only way in; v9)* `[DECISION — Josh 2026-09-25]`
  (IV iron first on the empiric arm orders a ferritin) as a `[BUILD NOTE]` step: IV iron
  without an oral trial was chosen with no ferritin in the last 90 days — in practice the
  empiric arm, which skips iron studies. Orders Lab-17 (ferritin, its own node). Closed
  whenever a ferritin is on file, so the confirmed arm never orders a second one. [1][5]
- **Step 2.13 — IV iron first: ferritin must confirm iron deficiency** *(gated by
  gate-iv-iron-ga-direct on Step 2.9 — its only way in; v9)* `[BUILD NOTE]`: hosts
  gate-ida-confirmed-iv → Step 2.10. Exists because a gate guards a Step, and the ferritin
  check must sit **behind** the GA gate: GA < 14 closes IV iron before the ferritin gate is
  reached, so a first-trimester patient is never asked for a ferritin value she cannot yet
  use for IV iron. On the confirmed arm the ferritin that opened Stage 2 satisfies the gate.
  [1][5]
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
gates; Stage 4 is root-connected. v12's Steps 1.10, 1.11, 1.12 and 2.14–2.18 are all gated
(or DP-4's branch) and belong to no Stage by HAS_STEP; their `stage_number` (1 or 2) places
them for display. v13's Step 1.13 is the same: gated by gate-hgb-recheck-due on Step 1.1, no
HAS_STEP, `stage_number` 1. v14's Steps 2.19–2.22 and v15's Steps 2.23–2.24 likewise: each gated by a count gate on
Step 2.14 or Step 2.3, no HAS_STEP, `stage_number` 2. Gated steps connect **only** via their gate/DP
BRANCHES_TO (no HAS_STEP edge), per the reference-fixture pattern.

## 4. Decision points

- **DP-1 — Empiric iron vs confirmatory studies first** (on Step 1.7, behind
  gate-microcytic and, since v12, gate-no-iron-on-list; was on Step 1.1 through v3) —
  branch_mode: one_of
  - `[DECISION — Josh 2026-10-03]` **Not asked of a patient already on iron (v12).** DP-1
    and DP-3 are choices about *starting* iron. Step 1.7, DP-1's only host, now sits behind
    gate-no-iron-on-list (§4b): with any oral or IV iron product on the medication list the
    gate closes Step 1.7 and everything under it — DP-1, Stage 1.5, Step 1.2, Stage 2, DP-3,
    the oral trial, both IV-iron steps — and the patient goes to Step 2.14 (oral iron) or
    Step 2.18 (IV iron) instead. With no iron on the list DP-1 is asked exactly as in v11:
    nothing under Step 1.7 changed. Proved with `gate-proof.ts on-iron`, both edge orders.
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
    ~~`[CLINICAL AMBIGUITY — for Josh]`~~ **DP-1 is asked again for disease patients**, and
    its empiric option does nothing for them but order iron studies — the price of doing
    this in the JSON. v7 hid DP-1 from them. Hiding it again while keeping the confirmed
    route needs an engine change (§18). **Resolved — accepted as is** `[DECISION — Josh
    2026-09-25]`: DP-1 stays offered to hemoglobinopathy-disease patients, and
    **"confirmatory studies" is the right pick for them** (it leads, with ferritin < 30, to
    the normal Stage 2 iron path). No JSON change; the engine change in §18 is not needed.
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
- **DP-4 — Nonresponse management (already on oral iron)** (on Step 2.16, reached only via
  gate-hgb-nonresponse-on-iron; v12) — branch_mode: one_of `[BUILD NOTE]`: an exact copy of
  DP-2 for the on-iron route (Step 2.14), needed because DP-2 lies under DP-1 (§3 Step 2.14).
  One BRANCHES_TO, to **Step 1.11** (taken automatically, as DP-2's is), and
  `gate-iv-iron-ga-on-iron` on DP-4 → **Step 2.17**.
  - Criterion 4a: = 2a (intolerance or nonadherence despite coaching — consider IV iron) [1][5]
  - Criterion 4b: = 2b (suspected malabsorption — consider IV iron) [1][8]
  - Criterion 4c: = 2c (suspected incorrect diagnosis or blood loss) → **Step 1.11** [1]
  - Criterion 4d: = 2d (moderate–severe IDA within ~4–6 weeks of delivery, or oral failure
    near term — IV iron) [6][1]
  - Same descriptions and citations as 2a–2d; only 4c has a SELECTS_BRANCH, as only 2c does.
- **DP-3 — Oral iron trial vs IV iron without an oral trial** (on Step 2.8 — in Stage 2,
  ferritin-confirmed IDA, and since v8 Stage 1.5, the empiric arm; v7) — branch_mode:
  one_of `[DECISION — Josh 2026-09-24]`
  - `[DECISION — Josh 2026-10-03]` **Not asked of a patient already on iron (v12)** — oral
    (answer 2) or IV (answer 3: "yes, skip"). DP-3 is reached only through DP-1, and DP-1's
    host is closed for her (DP-1, above). DP-3 itself is unchanged.
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
    ~~`[CLINICAL AMBIGUITY — for Josh]`~~ (2) **IV iron first on the empiric arm is IV iron
    with no ferritin on file** — **resolved in v9** `[DECISION — Josh 2026-09-25]`: IV iron
    first requires a confirmed ferritin (below, "IV iron first needs a confirmed
    ferritin"). (3) Criterion 3d reads "anemia diagnosed at ≥ 34 weeks (iron deficiency confirmed, or
    presumed on the empiric arm)" — v9 adds "IV iron (on the empiric arm, once a ferritin <
    30 ng/mL confirms iron deficiency; oral iron meanwhile)". (4) The DP-1 answer value for the empiric branch is
    unchanged (`stage-2-empiric`). Former ambiguity (b) below is resolved by this decision.
  - Criterion 3a: No reason to skip the oral trial → **Stage 2.5** (Steps 2.1–2.3: oral
    iron, 2–4-week recheck, response check) [1]
  - Criterion 3b: Documented intolerance of oral iron (e.g. on a prior course) → **Step
    2.9** (IV iron, no trial) [1][5] — the brief's criterion 2a at treatment start
  - Criterion 3c: Suspected malabsorption (bariatric surgery, IBD, chronic antacid use) →
    **Step 2.9** [1][8] — criterion 2b
  - Criterion 3d: IDA diagnosed at ≥ 34 weeks (v8 wording: anemia diagnosed at ≥ 34 weeks,
    iron deficiency confirmed or presumed on the empiric arm; v9 adds that on the empiric arm
    IV iron waits for a ferritin < 30, with oral iron meanwhile) — too little time for an oral
    trial → **Step 2.9** [6][1] — criterion 2d / the former DP-3's 3b `[FALLBACK SOURCE — FIGO time-math;
    ACOG says only "severe iron deficiency later in pregnancy"]`
  - Step 2.9 → **gate-iv-iron-ga-direct** (GA ≥ 14) → **Step 2.10** (IV iron). IV iron's
    first-trimester rule is kept on this route too. (v9: → Step 2.13 → gate-ida-confirmed-iv
    (ferritin < 30) → Step 2.10 — below.)
  - `[DECISION — Josh 2026-09-24]` **IV iron first before 14 weeks → oral iron until 14
    weeks, then IV (v8).** Step 2.9 → **gate-oral-bridge-ga** (v8: GA < 14, the exact
    complement of gate-iv-iron-ga-direct; v9: widened to "no ferritin on file, or GA < 14
    with ferritin < 30" — below, and no longer that complement) → **Stage 2.6**, which holds the oral trial's Steps
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
    visit). (v9: the switch also needs a ferritin < 30 on file — below.)
  - `[DECISION — Josh 2026-09-25]` **IV iron first needs a confirmed ferritin (v9).** In v8,
    IV iron first chosen on the empiric arm gave IV iron with no ferritin on file (the
    empiric arm skips confirmatory studies). Now, on the empiric arm, IV iron first **orders
    a ferritin and gives IV iron only once iron deficiency is confirmed** — ferritin < 30
    ng/mL, gate-ida-confirmed's own threshold and semantics — with **oral iron started
    meanwhile** (Stage 2.6, the oral-bridge content). IV iron keeps its GA ≥ 14 rule and the
    GA < 14 oral bridge stays. The confirmed arm's IV iron first is unchanged (its ferritin is
    already confirmed).
    `[BUILD NOTE]` **How it is built — DP-3 and Step 2.9 stay shared; Step 2.9's gates read
    the chart, not the arm.** The engine cannot tell the arms apart at Step 2.9 (the DP-1
    answer is not chart data), and copying DP-3 for the empiric arm would have meant copying
    Step 2.8, DP-3's four criteria, gate-malabsorption-chart, Step 2.11 and Guid-6, and
    changing DP-3's answer id on that arm. Instead every IV-first rule is written on the
    ferritin itself — "a ferritin < 30 is on file" / "no ferritin is on file" — which on the
    confirmed arm is always the first (gate-ida-confirmed passed on the identical condition
    and horizon), so there the new gates reduce to v8's:
    - **IV iron**: gate-iv-iron-ga-direct (GA ≥ 14, unchanged) → Step 2.13 →
      **gate-ida-confirmed-iv** (an identical copy of gate-ida-confirmed: ferritin < 30,
      `{days: 90}`, skip, ask) → Step 2.10. GA first, so GA < 14 closes IV iron without
      asking for a ferritin; with GA ≥ 14 and no ferritin the gate asks for it and holds
      IV iron. The `-iv` suffix makes `check-gate-control` hold the copy in sync with
      gate-ida-confirmed. (Rule 2: a second gate on Step 2.10 would be an AND, so the ferritin
      check gets its own host step.)
    - **Oral iron meanwhile**: gate-oral-bridge-ga is widened, not joined by a second gate —
      `OR( no ferritin on file , AND( GA < 14 , ferritin < 30 ) )` → Stage 2.6. It is the
      **only** gate into Stage 2.6, so Steps 2.1–2.3 never have two differently-gated parents
      (two chart gates leading into them would be decided by whichever wrote first — the
      first-writer-wins sweep in the spec's Gate wiring box). No ferritin on file settles
      the OR at once (membership never asks), so oral iron starts at any GA without waiting.
    - **Ferritin order**: gate-no-ferritin-on-file (membership: labs `not_includes_code`
      2276-4, `{days: 90}`, on_unresolved default) → Step 2.12 → Lab-17, its own node (one
      node per host). Closed when any ferritin is on file.
    **What the provider sees** (proved with `gate-proof.ts iv-ferritin` and `dp-3`, both edge
    orders; `incremental-full-agreement.test.ts` v9 scenarios):
    | Empiric arm, IV iron first | GA ≥ 14 | GA < 14 |
    |---|---|---|
    | **no ferritin** | ferritin ordered (Step 2.12); oral iron + response check (Stage 2.6); IV iron **held** — one question, "Ferritin (ng/mL) (LOINC 2276-4) — most recent value?" | ferritin ordered; oral iron; IV iron GATED_OUT; **no** ferritin question |
    | **ferritin 12** (on the chart) | IV iron (Step 2.10); oral iron and the ferritin order closed — as on the confirmed arm | oral iron until 14 weeks; IV iron GATED_OUT |
    | **ferritin 50** (on the chart) | **no iron at all** on this route: IV iron, oral iron and the ferritin order closed | **no iron at all** |
    Ferritin answered **in the same visit** (the held question): the value enters the chart as
    a dated fact and every gate reading labs is re-resolved (`addPatientContext`), so the
    bridge and the ferritin order re-decide with it — 12 → IV iron, oral iron closed; 50 → no
    iron; each identical, node for node, to a session that had the value on the chart from
    the start (`gate-proof.ts iv-ferritin`, simulating the mutation's re-seeding; not run
    against the live service). GA missing, no ferritin: oral iron and the ferritin order open,
    IV iron held on one GA question. **Confirmed arm**: IV iron first at GA 20 / 36 → IV iron,
    no oral iron, no ferritin order; GA 12 / 13.9 → the oral bridge; GA missing → one GA
    question asked by both GA gates — every v8 node's status identical to v8 in 29 sessions ×
    both edge orders (confirmed IV first / oral trial / route pending at GA missing, 12, 13.9,
    14, 20, 36; malabsorption and D58.2 IV first; ferritin 50; empiric oral trial; empiric
    D57.1), the only differences being shared CodeEntry leaves. (That v8-vs-v9 comparison was
    a one-off diff of the two JSONs on the real engine at build time, not a committed proof;
    the committed ones are `gate-proof.ts dp-3` / `iv-ferritin` and the agreement test.) New nodes there: Step 2.13 and
    gate-ida-confirmed-iv INCLUDED at GA ≥ 14; Step 2.12 / Lab-17 GATED_OUT.
    `[DECISION — Josh 2026-09-25]` All three open points below are **kept as built**, with no
    JSON change: (a) keep asking. The ferritin question holds the empiric IV-first visit's
    care plan until a value is entered, consistent with "numeric gates ask" and "keep
    blocking". (b) The oral trial continues. A ferritin ≥ 30 stops only the IV-first route;
    the empiric oral trial is a trial whatever the ferritin. (d) Always wait for ferritin, the
    late diagnosis (3d) included; the mitigations below (confirmatory studies at DP-1, or
    entering the ferritin at the same visit) are the intended path. The original ambiguity
    text follows for the record.
    ~~`[CLINICAL AMBIGUITY — for Josh]`~~ (a) **The ferritin question holds the visit's care
    plan.** Care-plan generation refuses a pending question, so the visit that orders the
    ferritin (empiric arm, IV iron first, GA ≥ 14) cannot generate its plan until a ferritin
    value is entered — which is the same "numeric gates ask" rule as gate-ida-confirmed, and
    what "same semantics as the confirmed arm" gives. Alternative: IV iron GATED_OUT with no
    question while no ferritin is on file (an `[ON-UNRESOLVED DEFAULT]` exception on a
    separately named gate), decided at the next visit from the chart. (b) **A ferritin ≥ 30
    is read two ways on the empiric arm.** IV iron first with ferritin 50 now stops all iron
    (as the confirmed arm does), while the empiric **oral trial** (3a), which never reads
    ferritin, keeps giving oral iron with the same ferritin 50 on the chart (unchanged since
    v8). Should the oral trial also close on a ferritin ≥ 30? (c) **Oral iron stops once IV
    iron opens** (ferritin < 30 on file, GA ≥ 14), as on the confirmed arm — oral iron is not
    continued alongside IV iron. (d) **Late diagnosis (criterion 3d) now waits for a
    ferritin on the empiric arm.** 3d exists because at ≥ 34 weeks there is too little time
    for an oral trial, and on the empiric arm IV iron first now waits at least one ferritin
    round-trip — the most time-critical case is the one slowed down. Mitigations within the
    current build: choose **confirmatory studies** at DP-1 for a late diagnosis (ferritin
    first, then IV iron first on the confirmed arm), or enter the resulted ferritin into the
    held question at the same visit (the in-session path re-decides IV iron at once). Also by
    construction: an empiric-arm patient who already has a ferritin on file is treated
    exactly like the confirmed arm (no second ferritin order).
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
    iron held. Ferritin 50 never sees DP-3. (v8: the empiric arm does — same outcomes,
    proved on both arms, except IV iron first since v9, which on the empiric arm waits for a
    ferritin — above — and so does a hemoglobinopathy-disease patient with ferritin < 30
    on the confirmatory branch; on the empiric branch she does not, §4 DP-1.)
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
  - Attached to: step-1-1 · Branches to: **step-1-10** (v12 — the medication-list split;
    v4–v11: step-1-7, DP-1's host; step-1-2 through v2) · **patient_attribute** (v8; v7
    compound AND) · Default: **skip** · On unresolved: **ask**. v12 changes only this edge's
    target: the condition is untouched, and Step 1.7 is now reached through
    gate-no-iron-on-list (below).
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
- **Gates `gate-no-iron-on-list` / `gate-on-oral-iron` / `gate-iv-iron-on-list` — is iron
  already on the medication list?** (v12) `[DECISION — Josh 2026-10-03]` (already on iron:
  skip the iron choices) · `[BUILD NOTE]` (wiring)
  - All three attached to: **step-1-10** · compound · Default: **skip** · On unresolved:
    **default** (membership only — nothing is ever asked). Every leaf: field `medications`,
    system `RXNORM`, horizon **LIFETIME**, status **any**, with a `display` naming the product.
  - **Oral iron codes** (answer 2, "all oral iron supplements based on what's written" — every
    oral iron entry the simulator's medication reference holds): `310325` ferrous sulfate
    325 mg tablet · `198630` ferrous gluconate 324 mg tablet · `284202` ferrous fumarate 324 mg
    tablet · `311975` ferrous sulfate (ingredient).
  - **IV iron codes**: `1741261` iron sucrose · `2274409` ferric derisomaltose · `1435169`
    ferric carboxymaltose 750 mg/15 mL · `1311224` ferric carboxymaltose (ingredient) ·
    `206216` iron dextran.
  - **`gate-no-iron-on-list`** → **step-1-7** (DP-1): **AND** of `not_includes_code` on all
    nine codes, in the order above (four oral, then five IV).
  - **`gate-on-oral-iron`** → **step-2-14**: **AND(** nested **OR(** `includes_code` on the four
    oral codes **)** — display "Oral iron on the medication list" — **,** `not_includes_code`
    on each of the five IV codes **)**.
  - **`gate-iv-iron-on-list`** → **step-2-18**: **OR** of `includes_code` on the five IV codes.
  - **Exact complements.** For any medication list exactly one of the three is satisfied: no
    listed code → the first; an oral code and no IV code → the second; any IV code → the
    third. **Oral and IV iron both on the list is treated as IV iron given** (the third):
    IV iron is the later step of the same treatment, and the oral-versus-IV choice is behind
    her. Same horizon and status on every leaf, and status `any`, so no leaf is ever
    indeterminate and no patient falls between the gates (§17).
  - **Why three chart gates in front of DP-1, when v8 moved the disease split behind it:**
    that split had to let the confirmatory branch into Stage 2 for everyone; this one wants
    the opposite — DP-1 itself gone — and the three targets share **nothing** (Step 2.14's
    response check is built from copies for exactly this reason, §3), so each closing gate
    sweeps only its own route.
  - ⚠ **Code matching is exact.** The engine matches a medication by its exact RxNorm code;
    there is no ingredient or product-family expansion. **An oral or IV iron product recorded
    under any other code is not recognised** — that patient is asked DP-1 and DP-3 as before —
    until medication family matching exists. (`311975` and `1311224` are ingredient-level
    concepts; they match only an entry recorded with that very code.)
  - No id here may begin `gate-microcytic-`, `gate-iv-iron-ga-` or another gate's id plus `-`
    unless it is a true copy: `check-gate-control` reads `gate-x-*` as a fan-out copy of
    `gate-x`.
  - Proof: `gate-proof.ts on-iron` — each of the nine codes, both together, none, an
    unrelated medication, and MCV 90 with oral iron on the list (the list is not read).
- **Gate `gate-confirm-studies-on-iron` — Order confirmatory iron studies now?** (v12)
  `[DECISION — Josh 2026-10-03]` (answer 1: "not necessarily")
  - Attached to: **step-2-14** · Branches to: **step-1-12** · Type: **question** · Default:
    **skip** · answer_type: **BOOLEAN** (one target, no `when`: yes opens Step 1.12, no
    closes it)
  - Prompt (exact JSON text): "She is already on oral iron. Order confirmatory iron studies
    (ferritin, iron/TIBC/saturation) now?"
  - Being on iron neither skips the confirmatory workup nor forces it: the provider is asked.
    Like every question gate it pends until answered, so **it holds that visit's care plan
    until answered** (as DP-1 and DP-3 did for this patient before; one question now instead
    of two). Asked at every visit that reaches Step 2.14 — each visit is a new session.
- **Gates `gate-response-recheck-due` / `gate-rechecked` and their copies
  `gate-response-recheck-due-on-iron` / `gate-rechecked-on-iron` — has a hemoglobin been
  drawn since oral iron started?** (v14) `[DECISION — Josh 2026-10-04]`
  - Attached to: **step-2-3** (originals) / **step-2-14** (`-on-iron` copies) · Type:
    `…recheck-due`: patient_attribute, one coded condition; `…rechecked`: **compound OR** of
    that count (`at_least`) and the response gates' "at target" group · Default: **skip** ·
    On unresolved: `…recheck-due` **ask** (the only thing it can lack is the start date; a
    count never asks for a lab value); `…rechecked` **default** (it never asks — markers
    below) · Branch to: `gate-response-recheck-due` → **step-2-21**,
    `gate-rechecked` → **step-2-22**, `gate-response-recheck-due-on-iron` → **step-2-19**,
    `gate-rechecked-on-iron` → **step-2-20**. One target each; no `when` edges.
  - Titles: "Response recheck due: on oral iron 14 days or more, no hemoglobin since it
    started" / (v15) "Rise measurable (two hemoglobins: a baseline or an earlier value, and
    one since oral iron started), or hemoglobin at target: assess the response" (the same on
    the copies).
  - **v15 `[DECISION — Josh 2026-10-04]` — `gate-rechecked` / `gate-rechecked-on-iron`
    changed:** the count arm is now `count_threshold` **2**, `at_least`, with
    **`baseline_days` 28** — the count over exactly the response gates' point set (the one
    latest hemoglobin from the 28 days before the start, plus every one since). "Two points"
    is "the rise can be measured". So the gate is `OR(` measurable `,` At target `)`; the
    v14 text below describing a count of `at_least` 1 is superseded on this point only.
    Still `on_unresolved: default` (markers below): the at-target arm reads 28 days, and your
    patient's 33-day-old baseline would otherwise be asked for again.
  - `[WINDOW — gate-rechecked: the at-target arm is the response gates' own group, 28 days,
    copied so that this gate and gate-hgb-response read the same value; whether both should
    read the most recent value instead is open, §18]`
    `[WINDOW — gate-rechecked-on-iron: as gate-rechecked]`
  - **Condition:** labs `718-7` (LOINC, display "Hemoglobin (g/dL)") `count_in_window`,
    `count_threshold` 1, **`count_comparison`** `less_than` (recheck due) / `at_least`
    (rechecked), **`window_from`**: event `medication_start`, clinical_role
    `oral-iron-repletion`, label "oral iron", codes RXNORM 310325 / 198630 / 284202 / 311975
    (the response gates' four), **`min_days_since_anchor` 14**. No `baseline_days` (not
    allowed on a count; the window is start day → visit, so a pre-treatment value is never
    counted). The two counts are exact complements, so once due exactly one count is true.
    **`gate-rechecked` = `OR(` that count `at_least` 1 `,` At target `)`**, where "At target"
    is the group `gate-hgb-response` carries, copied leaf for leaf: `OR( Hgb > 10.95 ,
    AND( patient.trimester equals 2 , Hgb > 10.45 ) )`, hemoglobin horizon {days: 28}. This
    keeps `[DECISION — Josh 2026-09-24]` "At target at once": a definite "at target" settles
    the OR even while the count is NOT YET DUE, so Step 2.22 / 2.20 opens and
    `gate-hgb-response` opens maintenance at once, the start visit included; the nonresponse
    gate's below-target arm is then a definite no and it closes without asking. Change the
    group here and in the response gates together.
    `count_comparison` is a josh-dev engine extension (2026-10-04); main's validator rejects it.
  - **How each state of the data is used:**

    | Oral iron start | Hemoglobin on file | Result | Asked? |
    |---|---|---|---|
    | not known (undated order, no stored care plan, no clinician date) | any | both gates held | **once**: "When did oral iron start?" |
    | this visit (Step 2.3 route: oral iron recommended this session) | any | NOT YET DUE — neither opens | no |
    | fewer than 14 days ago | any, including one drawn since the start | NOT YET DUE — neither opens | no |
    | 14 or more days ago | none dated on or after the start day — only earlier values, only undated values, or none | `…recheck-due` opens → Step 2.21 / 2.19: CBC, ferritin, iron/TIBC/saturation ordered | **no** |
    | any, or not known | **at target** (≥ 11, or ≥ 10.5 in trimester 2) within the last 28 days | `…rechecked` opens → the response gate opens **maintenance at once** (Step 2.4 / 2.15). At day ≥ 14 with none drawn since the start, the recheck is ordered **as well** | no |
    | 14 or more days ago | *(v15: this row holds only when the rise is measurable — two points; with one point and below target see `gate-rise-unmeasurable` above)* one or more dated on or after the start day | `…rechecked` opens → Step 2.22 / 2.20: the response gates decide (below) | only what the response gates ask: the trimester for Hgb 10.5–11 with a rise < 1; a dated hemoglobin when there is no baseline to measure from |

    A hemoglobin dated **before** the start is the baseline and nothing else: it is used (the
    threshold gates decide on it; the response gates measure the rise from it) and never
    counts as a recheck. One dated **on the start day** counts as "since the start"
    `[JOSH — CONFIRM]` (§18). An **undated** one has no draw date and is not counted, so the
    recheck is ordered (this is what the simulator gives). **None at all** is a count of zero:
    the recheck is ordered here, and the level is still asked for by the Stage 3 threshold
    gates (v10).
  - `[ON-UNRESOLVED DEFAULT — gate-rechecked]` `[ON-UNRESOLVED DEFAULT — gate-rechecked-on-iron]`
    These two gates must never ask: the "at target" arm reads hemoglobin inside 28 days, so
    with `ask` a baseline older than that (Josh's patient: 33 days) would be asked for again —
    the very question v14 removes. With `default`, "cannot decide" closes the gate; the
    recheck-due twin (which is `ask`) still raises the start-date question when the start is
    unknown, and the response gates behind ask only for the trimester (v15: they are reached
    only with two points or at target, so never for a hemoglobin).
  - **Why two gates and a step in between.** A chart gate has one target and cannot route. The
    response gates must not be *evaluated* until a recheck exists — evaluated without one they
    are one value short and ask for it, which is the dead end this version removes — and the
    only way to keep a gate from being evaluated is to put its host step behind another gate.
  - **What `gate-rechecked` does when it cannot decide** (start date unknown and not at
    target; or, with no hemoglobin since the start, a baseline older than 28 days or a
    hemoglobin of 10.5–11 with the trimester unknown): it closes and asks nothing. The
    start-date question still comes from `gate-response-recheck-due`; once answered both
    re-evaluate.
  - **Start date:** resolved exactly as for the response gates (below): clinician date →
    stored care plan → dated order → this session (Step 2.3 route only; never on Step 2.14,
    where no oral-iron Medication node is recommended) → asked. The session source is still
    refused when the chart holds a hemoglobin 14 or more days old, so that visit asks the date.
  - Outcomes (`gate-proof.ts response-recheck`, both edge orders, clock 2026-10-04): Josh's
    patient → one start-date question, then Step 2.19 / Lab-26–28 / Guid-9 INCLUDED, no
    hemoglobin question, Steps 2.20 / 2.15 / 2.16 / 2.17 GATED_OUT; with a dated order nothing
    at all is asked; 8.0 → 9.4 since the start → Step 2.20 → Step 2.15; 8.0 → 8.5 → Step 2.16
    and (GA 28) IV iron; day 7 → both gates NOT_YET_DUE, nothing asked. Step 2.3 route (start
    from the stored care plan): the same four, on Steps 2.21 / 2.22 / 2.4 / 2.6; the start
    visit → both gates NOT_YET_DUE on `SESSION_RECOMMENDATION`, nothing asked, no care-plan
    blocker.
- **Gates `gate-rise-unmeasurable` / `gate-rise-unmeasurable-on-iron` — a hemoglobin since
  oral iron started, below target, and nothing to measure the rise from** (v15)
  `[DECISION — Josh 2026-10-04]`
  - Attached to: **step-2-3** / **step-2-14** · Type: **compound AND** · Default: **skip** ·
    On unresolved: **ask** · Branch to: `gate-rise-unmeasurable` → **step-2-24**,
    `gate-rise-unmeasurable-on-iron` → **step-2-23**. One target each.
  - Title: "Hemoglobin since oral iron started, below target, and no baseline to measure the
    rise from: recheck in 2–4 weeks".
  - **Conditions** (all on labs `718-7`, the oral-iron `window_from` with the four codes,
    `min_days_since_anchor` 14):
    1. `count_in_window`, `count_threshold` 1, `at_least`, no `baseline_days` — a hemoglobin
       since the start;
    2. `count_in_window`, `count_threshold` 2, `less_than`, **`baseline_days` 28** — fewer than
       two points in the response gates' own point set: the rise cannot be measured;
    3. the group "Below target (Hgb < 11, and < 10.5 unless trimester 2)" exactly as
       `gate-hgb-nonresponse` carries it: `AND( Hgb < 10.95 , OR( patient.trimester not_equals
       2 , Hgb < 10.45 ) )`, hemoglobin horizon {days: 28}.
  - `[WINDOW — gate-rise-unmeasurable: the below-target group is the nonresponse gate's own,
    28 days, copied so the two read the same value; whether it should read the most recent
    value instead is open, §18]` `[WINDOW — gate-rise-unmeasurable-on-iron: as
    gate-rise-unmeasurable]`
  - **What it can ask, and why `ask`.** The counts never ask for a value. The start date, when
    unknown (shared with `gate-response-recheck-due`). The **trimester**, only for a
    hemoglobin of 10.5–11 — as the nonresponse gate asks it; T2 → at target → maintenance,
    otherwise this step. And one case `[JOSH — CONFIRM]` (§18): a lone hemoglobin since the
    start that is itself more than 28 days old is outside the 28-day group, so the gate asks
    "Hemoglobin … most recent value?" — answerable (today's value is the second point), never
    "drawn after today". With `default` the trimester case would close silently with no step.
  - **How each state is used** (day ≥ 14; "points" = the latest value from the 28 days before
    the start, plus every value since):

    | Since the start | Points | Level | Result | Asked |
    |---|---|---|---|---|
    | none | 0 or 1 | any | response recheck ordered (Step 2.21 / 2.19); at target → maintenance too | nothing |
    | one | 1 (no baseline, or baseline older than 28 days before the start) | below target | **Step 2.24 / 2.23: recheck in 2–4 weeks — not nonresponse** | nothing (trimester for 10.5–11) |
    | one | 1 | at target | maintenance at once (via `gate-rechecked`) | nothing |
    | one or more | 2 or more | any | response assessed (Step 2.22 / 2.20): maintenance or nonresponse | trimester for 10.5–11 with a rise < 1 |

  - Outcomes (`gate-proof.ts response-recheck` and `response`, both edge orders): no
    hemoglobin on the chart → the provider enters 8 at the visit → Step 2.23 / 2.24 with its
    lab, guidance and schedule INCLUDED, no hemoglobin question, no care-plan blocker on the
    route, response gates and escalation GATED_OUT; enters 11.4 → maintenance. A baseline
    older than 28 days before the start + one value since → the same step. One value since
    the start (day 15), no baseline → the same step (v14: "newest result?" asked). Two since
    the start → assessed. The start-day-only value → the same step.
- **Gates `gate-hgb-response-on-iron` / `gate-hgb-nonresponse-on-iron` — the response check,
  for a patient already on oral iron** (v12) `[BUILD NOTE]`
  - Attached to: **step-2-20** (v14; step-2-14 through v13) · Branch to: **step-2-15** (maintenance) / **step-2-16**
    (nonresponse → DP-4) · **Every evaluable property identical to `gate-hgb-response` /
    `gate-hgb-nonresponse`** below (titles, compound, nested groups, skip, ask, every
    condition and `window_from`). The `-on-iron` suffix makes them fan-out copies, so
    `check-gate-control` fails the build if a copy and its original ever differ — change the
    pair of pairs together.
  - Outcomes (`gate-proof.ts on-iron`, both edge orders; **v14:** NOT YET DUE and the
    start-date question are now the count gates', and these two are closed with Step 2.20
    until a hemoglobin since the start is on file): undated oral iron on the list (the
    simulator) → **one** DATE question, "When did oral iron start?"; ferrous
    sulfate ordered 2026-06-01 → anchored on the order (`MEDICATION_ORDER`): day 5 → NOT YET
    DUE, nothing asked; day 21, 9.5 → 10.7 → Step 2.15, no escalation; day 21, 9.5 → 9.9 →
    Step 2.16, DP-4, Step 1.11 and (GA 20) Step 2.17 with Med-17–20; GA 12 → Step 2.17
    GATED_OUT. A dated `311975` order anchors the same way. Step 2.3 and the original gates
    stay GATED_OUT throughout.
- **Gate `gate-iv-iron-ga-on-iron` — Beyond first trimester (GA ≥ 14 0/7 weeks), IV iron after
  nonresponse, already on oral iron** (v12) `[BUILD NOTE]`
  - Attached to: **dp-4** · Branches to: **step-2-17** · patient_attribute · Default: skip ·
    On unresolved: **ask** · Condition and title identical to gate-iv-iron-ga (a fan-out
    copy, held in sync by `check-gate-control`, as gate-iv-iron-ga-direct is). [1][5]
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
  - v9: **copied** as gate-ida-confirmed-iv (Step 2.13 → Step 2.10, IV iron first) and
    hand-copied as a leaf of gate-oral-bridge-ga — change all three together (§4b
    gate-oral-bridge-ga).
- **Gates `gate-hgb-response` / `gate-hgb-nonresponse` — Response to oral iron at the
  2–4-week Hgb recheck** `[DECISION — Josh 2026-09-24]` *(v7: chart data; v5/v6 were a
  SELECT question router, v4 and earlier a layered-trend chart gate)*
  - Attached to: **step-2-22** (v14 `[DECISION — Josh 2026-10-04]`; step-2-3 through v13 —
    Step 2.22 sits behind `gate-rechecked`, so these gates are evaluated only from day 14 and
    only once a hemoglobin drawn since oral iron started is on file) · Type: **compound**, nested condition groups · Default: **skip**
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
      of Med-1/2/3, §13) **and, since v12, 311975** (ferrous sulfate, ingredient — the fourth
      code that counts as "on oral iron", §4b gate-on-oral-iron; without it a dated 311975
      order would route to Step 2.14 and then be asked for a start date its own order
      already gives. It cannot change a patient with no iron on the list, and it is the same
      on the `-on-iron` copies), **`baseline_days` 28** (admits the latest pre-treatment Hgb within
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
    empiric, and workup + ferritin 12). **v14:** wherever this list says "both gates … NOT
    YET DUE" or "both gates hold on the date question", that verdict now belongs to
    `gate-response-recheck-due` / `gate-rechecked` on Step 2.3; the two response gates are
    closed with Step 2.22 and are not evaluated. What the visit shows is the same.
    - **Start visit** (oral iron recommended this session; no care plan, order or clinician
      date): the anchor is the session (`SESSION_RECOMMENDATION`), never due that day —
      both gates **GATED_OUT, NOT_YET_DUE, nothing asked**; Steps 2.4/2.6 and all escalation
      closed; the Step 2.3 recheck lab and Sched-2 carry the plan forward; no care-plan
      blocker. With Hgb 10.7 and the trimester unknown, still NOT YET DUE and the trimester
      is **not** asked (NOT YET DUE outranks missing data).
    - **At target at once** — Hgb 11.2 at the start visit opens **maintenance immediately**
      `[DECISION — Josh 2026-09-24]` (accepted: a patient already at target needs no rise);
      the non-response gate is a definite no. **v14: kept.** `gate-rechecked` carries the
      same at-target group under OR, so Step 2.22 opens for her and `gate-hgb-response`
      opens maintenance; `gate-response-recheck-due` is NOT YET DUE and nothing is asked. At
      day 14 or later with an at-target baseline and nothing drawn since the start she gets
      **maintenance and the recheck orders** (Step 2.21) together.
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
      when the only value is in the window (a hemoglobin since the start, no baseline to
      measure from — unchanged in v14). ~~When the only value is
      the pre-treatment baseline, it is the same: **one** Hgb question, "newest result,
      drawn after <the baseline's date>?", asked by the two response gates, both held on it.~~
      **v14** `[DECISION — Josh 2026-10-04]`: when the only value is the pre-treatment
      baseline **nothing is asked** — `gate-response-recheck-due` opens Step 2.21, which
      orders the recheck, and the response gates are not evaluated.
      **v13:** `gate-severe-anemia` no longer joins that question — it reads the most recent
      hemoglobin however old (LIFETIME), so it decides on the baseline and asks nothing.
      Through v12 it read a 7-day horizon, found no current value and asked too, so the one
      question was worded "most recent value?" and named three gates (`gate-proof.ts
      response`, changed in v13 for exactly this).
    - **Where the start date comes from at a recheck** (first hit wins): a clinician-entered
      date → the earliest stored care plan of this pathway recommending oral iron → the
      earliest dated chart order of 310325/198630/284202 (proved: a dated ferrous sulfate
      order anchors a day-21 nonresponder with no care plan — **v12: on Step 2.14's gate
      copies only.** Any of those orders on the chart now routes the patient to Step 2.14, so
      on Step 2.3's own gates the order source can no longer fire and their `codes` are inert;
      Step 2.3 anchors on a clinician date, a stored care plan or this session) → this session — **unless the
      chart shows the course already under way** → otherwise the date is asked.
      `[BUILD NOTE]` (engine behaviour, merged from `engine-recheck-anchor`, reflecting
      `[DECISION — Josh 2026-09-24]` "ask for the start date"): oral iron (Step 2.1) is
      recommended at every visit that reaches Step 2.3, so through v7 a recheck with no care
      plan, no dated order and no clinician date **read as a start visit** and closed NOT YET
      DUE — a nonresponder was silently missed (former `[CLINICAL AMBIGUITY]`, now resolved).
      The engine now refuses the session source when the chart holds an Hgb (the delta's own
      lab, LOINC 718-7) dated ≥ 14 days before the visit (`min_days_since_anchor`), or an
      oral-iron order with no or partial start date (v12: that second case now arises only on
      Step 2.14, where no session anchor exists anyway): both response gates hold and **one**
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
  - **Simulator:** the composer sends no dates, so the Δ arm cannot fire there (v12: on Step
    2.3 oral iron is recommended in the session, so both gates close NOT YET DUE; on Step
    2.14, with oral iron on the medication list, the start date is asked, and an undated
    series has no points); the at-target arm works from an
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
  - Attached to: step-2-9 · Branches to: **step-2-13** (v9; v7–v8: step-2-10) ·
    patient_attribute · Default: skip · On unresolved: **ask**
  - Condition: identical to gate-iv-iron-ga (`patient.gestational_age_weeks`
    `greater_or_equal` 14, unit weeks). A separate gate because Rule 2 forbids a second gate
    on Step 2.5, and a DP-3 branch straight into Step 2.5 would override gate-iv-iron-ga;
    the `-direct` suffix makes `check-gate-control` hold the two conditions in sync (a
    Rule 3-style copy). Unchanged in v9 except its target: IV iron now also passes the
    ferritin check on Step 2.13 (gate-ida-confirmed-iv, below). [1][5]
- **Gate `gate-ida-confirmed-iv` — Ferritin confirms iron deficiency (< 30 ng/mL) — before
  IV iron first** (v9) `[DECISION — Josh 2026-09-25]` (IV iron first needs a confirmed
  ferritin, same threshold and semantics as the confirmed arm) · `[BUILD NOTE]` (wiring)
  - Attached to: **step-2-13** · Branches to: **step-2-10** · patient_attribute · Default:
    **skip** · On unresolved: **ask**
  - Condition: **identical to gate-ida-confirmed** — coded, field `labs`, less_than, value
    `2276-4`, threshold 30, display "Ferritin (ng/mL)", horizon {days: 90}. The `-iv` suffix
    makes it a fan-out copy, so `check-gate-control` fails the build if the two ever differ.
    Ferritin 12 → IV iron; ferritin 50 → IV iron GATED_OUT; missing → asks "Ferritin (ng/mL)
    (LOINC 2276-4) — most recent value?" and holds IV iron (reached only at GA ≥ 14, since it
    sits behind gate-iv-iron-ga-direct). On the confirmed arm the ferritin that opened Stage 2
    satisfies it. [1][2][5]
- **Gate `gate-no-hgb-on-file` — No hemoglobin on file (90 days) — severity unknown, order
  anemia labs** (v10) `[DECISION — Josh 2026-10-03]` (unknown level → order anemia labs) ·
  `[BUILD NOTE]` (wiring)
  - Attached to: step-1-1 · Branches to: **step-1-9** · patient_attribute · Default:
    **skip** · On unresolved: **default** (membership only — nothing is ever asked)
  - Condition: coded, field `labs`, **`not_includes_code`**, value `718-7`, system LOINC,
    display "Hemoglobin (g/dL)", horizon **{days: 90}**. No hemoglobin → true (Step 1.9
    orders the ferritin); any hemoglobin in 90 days → false.
  - How it sits with the asking gates: `gate-severe-anemia`, `gate-referral-threshold` and
    the two response gates still **ask** for a hemoglobin they cannot find. The provider
    either enters one (the fact decides those gates, and this gate closes) or answers "Not
    available" (those gates stop asking and close on their defaults; this gate stays open,
    so the plan is the anemia labs). **v13:** `gate-severe-anemia` and
    `gate-referral-threshold` now read the most recent hemoglobin however old, so a
    hemoglobin of any age is no longer asked about. One 31–90 days old keeps this gate
    closed and opens `gate-hgb-recheck-due` (repeat CBC). One **more than 90 days old**
    decides the threshold gates, opens the recheck, **and** opens this gate (no hemoglobin
    in 90 days → Step 1.9's ferritin) — `[JOSH — CONFIRM]` whether "severity unknown" should
    now mean no hemoglobin **ever** (horizon LIFETIME here) rather than none in 90 days
    (§18). This gate is unchanged in v13.
  - Proof: `gate-proof.ts unknown-hgb`.
- **Gate `gate-hgb-recheck-due` — No hemoglobin in the last 30 days — recheck due, repeat
  the CBC** (v13) `[DECISION — Josh 2026-10-03]` ("it should be most recent but > 30 days
  should trigger recheck") · `[BUILD NOTE]` (wiring)
  - Attached to: step-1-1 · Branches to: **step-1-13** · patient_attribute · Default:
    **skip** · On unresolved: **default** (membership only — nothing is ever asked)
  - Condition: coded, field `labs`, **`not_includes_code`**, value `718-7`, system LOINC,
    display "Hemoglobin (g/dL)", horizon **`"MONTH"`** (30 days). No hemoglobin dated within
    the last 30 days → true (Step 1.13 orders the repeat CBC, Lab-25); any hemoglobin in the
    last 30 days → false.
  - It is the "recheck" half of the decision; the "most recent" half is the LIFETIME horizon
    on `gate-severe-anemia` and `gate-referral-threshold`. Together: an older hemoglobin
    still decides transfusion consideration and referral, nothing is asked, and a fresh CBC
    is ordered.
  - **Also open with no hemoglobin at all** — "none in 30 days" includes "none". Then
    `gate-no-hgb-on-file` → Step 1.9 (ferritin) is open too and the threshold gates ask for
    the level (v10). A level the provider enters in answer is a current value, so it closes
    this gate; "Not available" leaves it open.
  - An **undated** hemoglobin counts as current (the engine asserts undated facts at the
    session clock), so it closes this gate: the recheck needs a dated result to fire.
  - Hematocrit gets no gate of its own: the CBC recheck returns it.
  - Proof: `gate-proof.ts hgb-recheck`.
- **Gate `gate-no-ferritin-on-file` — No ferritin on file (90 days) — order one before IV
  iron** (v9) `[DECISION — Josh 2026-09-25]` (IV iron first on the empiric arm orders a
  ferritin) · `[BUILD NOTE]` (wiring)
  - Attached to: step-2-9 · Branches to: **step-2-12** · patient_attribute · Default:
    **skip** · On unresolved: **default** (membership only — nothing is ever asked)
  - Condition: coded, field `labs`, **`not_includes_code`**, value `2276-4`, system LOINC,
    display "Ferritin (ng/mL)", horizon **{days: 90}** — the same window as every ferritin
    condition, so "no ferritin on file" and "ferritin < 30 on file" never read different
    results. No ferritin → true (Step 2.12 orders one); any ferritin → false.
- **Gate `gate-oral-bridge-ga` — Oral iron while IV iron waits: no ferritin on file yet, or
  before 14 0/7 weeks with iron deficiency confirmed** (v8; widened v9) `[DECISION — Josh
  2026-09-24]` (oral until 14 weeks, then IV) · `[DECISION — Josh 2026-09-25]` (oral iron
  meanwhile while the ferritin is outstanding) · `[BUILD NOTE]` (wiring)
  - Attached to: step-2-9 · Branches to: **stage-2-oral-bridge** (Stage 2.6) · **compound
    OR** (v9; v8: patient_attribute) · Default: **skip** · On unresolved: **ask**
  - Conditions (v9): `OR(` labs `not_includes_code` `2276-4` (LOINC, display "Ferritin
    (ng/mL)", horizon {days: 90}) `,` nested `AND(` `patient.gestational_age_weeks`
    `less_than` **14**, unit weeks `,` labs `2276-4` `less_than` 30 (display "Ferritin
    (ng/mL)", horizon {days: 90}) `) )`. Kept one gate on purpose: it is the only gate into
    Stage 2.6 and its Steps 2.1–2.3, and a second chart gate into those steps would decide
    them by whichever wrote first (§4 DP-3, v9). Keeps its v8 id (tests and proofs name it);
    still not `gate-iv-iron-ga-*` (a fan-out-copy prefix).
  - ⚠ **The ferritin leaf here is a hand copy of gate-ida-confirmed's condition** (and the
    `not_includes_code` leaf shares its window). `check-gate-control` checks copies only
    between whole gates (`gate-x` / `gate-x-*`), not leaves inside a compound: **any change to
    gate-ida-confirmed's threshold or horizon must be made here, in gate-ida-confirmed-iv, and
    in gate-no-ferritin-on-file's horizon too.**
  - Outcomes: no ferritin → satisfied at any GA (nothing asked); ferritin < 30 → GA < 14 opens
    it, GA ≥ 14 closes it, GA missing asks the same `patient.gestational_age_weeks` question
    as gate-iv-iron-ga-direct (one question, both askers — so on the confirmed arm it is
    exactly v8's gate, proved at 13.9 and 14); ferritin ≥ 30 → closed at any GA. v8's
    condition was GA < 14 alone, the exact complement of gate-iv-iron-ga-direct; with a
    ferritin < 30 on file it still is. [1][5]
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
    horizon **`"LIFETIME"`** — the most recent hemoglobin on file, however old (v13)
    `[DECISION — Josh 2026-10-03]`. With none on file at all it asks (`on_unresolved: ask`).
    A value more than 30 days old also opens `gate-hgb-recheck-due` (repeat CBC).
  - Rationale: ACOG Level B fetal-indication threshold. [1]
- **Gate `gate-referral-threshold` — Referral-level anemia**
  - Attached to: stage-3 · Branches to: step-3-7 · compound (OR) · Default: skip
  - Conditions (coded): labs `718-7` less_than threshold 9; labs `4544-3` (Hct, LOINC)
    less_than threshold 27. Horizon **`"LIFETIME"`** each — the most recent value on file,
    however old (v13) `[DECISION — Josh 2026-10-03]`; a hemoglobin more than 30 days old also
    opens `gate-hgb-recheck-due` (repeat CBC). On unresolved: ask.
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
- **Med-17 – Med-20 — IV iron after nonresponse, already on oral iron** (on Step 2.17; v12):
  copies of Med-4 (iron sucrose), Med-5 (ferric derisomaltose), Med-6 (ferric carboxymaltose)
  and Med-7 (LMW iron dextran), in that order — same dose, role, `clinical_role`
  `iv-iron-repletion`, codes and citations; one node per host step. No ESCALATES_TO edges.
  [5][22]
- **No Medication node for the oral iron a patient is already on** (v12) `[DECISION — Josh
  2026-10-03]` `[BUILD NOTE]`: Step 2.14 carries Guid-7, not a medication. Several drugs
  sharing one `clinical_role` in a pathway are a choice of drug (the `first_line` one is used
  by default), and she is not choosing; and an INCLUDED `oral-iron-repletion` Medication would
  let the response gates read every visit as the visit that starts oral iron (NOT YET DUE for
  ever). Med-1/2/3 and Med-11 are not on this route.
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
- **Lab-18 — Ferritin, serum** (on Step 1.9; v10): LOINC 2276-4 / CPT 82728; ordered with
  the CBC when no hemoglobin is on file. A copy of Lab-2 — one node per host step. [1][5]
- **Lab-17 — Ferritin, serum** (on Step 2.12; v9): LOINC 2276-4 / CPT 82728; ordered when IV
  iron first is chosen with no ferritin on file (the empiric arm). A copy of Lab-2 — one node
  per host step. [1][5]

- **Lab-19 — CBC with indices** (on Step 2.14; v12): the hemoglobin recheck for a patient
  already on oral iron. A copy of Lab-10 (LOINC 58410-2 with 718-7 / 4544-3 / 787-2, CPT
  85025). [1]
- **Lab-20 — Peripheral blood smear** (on Step 1.11; v12): a copy of Lab-8. [1]
- **Lab-21 — Hemoglobin electrophoresis** (on Step 1.11; v12): a copy of Lab-14. [4]
- **Lab-22 — Ferritin, serum** (on Step 1.12; v12): a copy of Lab-2; ordered when the
  provider answers yes to "Order confirmatory iron studies now?". [1][5]
- **Lab-23 — Iron, TIBC and transferrin saturation** (on Step 1.12; v12): a copy of Lab-3. [1]
- **Lab-24 — CBC with indices** (on Step 2.18; v12): the follow-up CBC after IV iron
  `[JOSH — CONFIRM]`. A copy of Lab-10. [1]
- **Lab-25 — CBC with indices — recheck (no hemoglobin in the last 30 days)** (on Step
  1.13; v13) `[DECISION — Josh 2026-10-03]`: the repeat CBC when the most recent hemoglobin
  is more than 30 days old, or there is none. A copy of Lab-1 (LOINC 58410-2 with 718-7 /
  4544-3 / 787-2, CPT 85025) — one node per host step — named so its plan line is distinct
  from Step 1.1's "CBC with indices". `[JOSH — CONFIRM]` the wording, and that the plan then
  lists both CBC lines (§18). [1]

- **Lab-26 — CBC with indices — response to oral iron (no hemoglobin since it started)** (on
  Step 2.19; v14) `[DECISION — Josh 2026-10-04]`: the response recheck. A copy of Lab-19
  (LOINC 58410-2 with 718-7 / 4544-3 / 787-2, CPT 85025), named so the plan line says why it
  is ordered. [1]
- **Lab-27 — Ferritin, serum — response recheck on oral iron** (on Step 2.19; v14): a copy
  of Lab-22 (LOINC 2276-4, CPT 82728). "repeat testing with iron studies to determine need
  for IV iron". [1][5]
- **Lab-28 — Iron, TIBC and transferrin saturation — response recheck on oral iron** (on Step
  2.19; v14): a copy of Lab-23 (LOINC 2498-4 / 2500-7 / 2502-3, CPT 83540 / 83550). [1]
- **Lab-29 / Lab-30 / Lab-31** (on Step 2.21; v14): the same three for the route where the
  pathway started the oral iron — copies of Lab-26 / Lab-27 / Lab-28, same names and codes,
  one node per host step. [1] / [1][5] / [1]
- `[JOSH — CONFIRM]` (§18) whether the recheck should also carry a reticulocyte count (it
  does not), and that the plan then lists the CBC more than once.
- **Lab-32 — CBC with indices — recheck in 2–4 weeks (no pre-iron baseline to measure the rise
  from)** (on Step 2.23; v15) `[DECISION — Josh 2026-10-04]`: a copy of Lab-26's codes (LOINC
  58410-2 with 718-7 / 4544-3 / 787-2, CPT 85025). [1]
- **Lab-33** (on Step 2.24; v15): the same on the route where the pathway started the iron. [1]

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
| Lab-2 Ferritin | Step 1.2 | **Lab-17** (v9) | Step 2.12 |
| Lab-2 Ferritin | Step 1.2 | **Lab-18** (v10) | Step 1.9 |
| Lab-10 CBC (recheck) | Step 2.3 | **Lab-19** (v12) | Step 2.14 |
| Lab-8 Smear | Step 1.5 | **Lab-20** (v12) | Step 1.11 |
| Lab-14 Hgb electrophoresis | Step 1.5 | **Lab-21** (v12) | Step 1.11 |
| Lab-2 Ferritin | Step 1.2 | **Lab-22** (v12) | Step 1.12 |
| Lab-3 Iron/TIBC/saturation | Step 1.2 | **Lab-23** (v12) | Step 1.12 |
| Lab-10 CBC (recheck) | Step 2.3 | **Lab-24** (v12) | Step 2.18 |
| Lab-1 CBC | Step 1.1 | **Lab-25** (v13) | Step 1.13 (recheck, last Hgb > 30 days old) |
| Lab-19 CBC (recheck) | Step 2.14 | **Lab-26** (v14) | Step 2.19 (response recheck, none since the start) |
| Lab-22 Ferritin | Step 1.12 | **Lab-27** (v14) | Step 2.19 |
| Lab-23 Iron/TIBC/saturation | Step 1.12 | **Lab-28** (v14) | Step 2.19 |
| Lab-10 CBC (recheck) | Step 2.3 | **Lab-29** (v14) | Step 2.21 (response recheck, none since the start) |
| Lab-2 Ferritin | Step 1.2 | **Lab-30** (v14) | Step 2.21 |
| Lab-3 Iron/TIBC/saturation | Step 1.2 | **Lab-31** (v14) | Step 2.21 |
| Lab-19 CBC (recheck) | Step 2.14 | **Lab-32** (v15) | Step 2.23 (recheck in 2–4 weeks, no baseline) |
| Lab-10 CBC (recheck) | Step 2.3 | **Lab-33** (v15) | Step 2.24 |

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
  remains reasonable. IV iron is given from 14 0/7 weeks, and only once a ferritin < 30 ng/mL
  confirms iron deficiency; until then (before 14 weeks, or on the empiric arm while its
  ferritin is outstanding), choosing IV first starts oral iron." [8][18] (v9 `[DECISION — Josh
  2026-09-25]`: the last sentence adds the ferritin wait; v8 read "IV iron is given from 14 0/7
  weeks; before then, choosing IV first starts oral iron until 14 weeks.")

- **Guid-7 — topic "Already on oral iron: continue it"** (on Step 2.14; v12): category
  treatment-planning, clinician-facing `[DECISION — Josh 2026-10-03]`. Instructions (exact
  JSON text): "The medication list holds an oral iron product. Continue the oral iron she is taking: do not start a second oral iron product, and there is no choice to make between ferrous sulfate, ferrous gluconate and ferrous fumarate. Her response is read from the hemoglobin recheck 2–4 weeks after oral iron started: a rise of at least 1 g/dL, or hemoglobin at target, is a response; otherwise nonresponse management follows. Confirmatory iron studies (ferritin, iron/TIBC/saturation) are optional on this route and are ordered only if chosen — except when the response recheck is due (oral iron for 14 days or more with no hemoglobin drawn since it started), which orders them with the repeat CBC." The last clause is v14 `[BUILD NOTE]`: without it Guid-7 ("optional") and Guid-9 ("order them now") contradict each other in the same plan. [1][3]
- **Guid-8 — topic "IV iron already given: follow up, do not restart"** (on Step 2.18; v12):
  category treatment-planning, clinician-facing `[DECISION — Josh 2026-10-03]` (skip the
  choices) with `[JOSH — CONFIRM]` wording — he gave no detail beyond "skip". Instructions
  (exact JSON text): "The medication list holds an IV iron product, so IV iron has been given. Do not start IV iron again or an oral iron trial on the strength of this pathway. Recheck hemoglobin about 4 weeks after the IV iron; persistent anemia prompts hematology referral or re-evaluation of the diagnosis." The recheck interval and what persistent
  anemia prompts are Sched-3's existing text; no dose and no new timing. [1][5]
- **Guid-9 — topic "Response to oral iron not yet checked: repeat CBC and iron studies"** (on
  Step 2.19; v14): category treatment-planning, clinician-facing `[DECISION — Josh
  2026-10-04]`. Instructions (exact JSON text): "No hemoglobin has been drawn since oral iron started, and it started at least 14 days ago, so the response can be judged now but has not been checked. Continue oral iron. Order a repeat CBC with indices, ferritin, and iron/TIBC/transferrin saturation now. These results decide whether she is responding or needs IV iron: a hemoglobin rise of at least 1 g/dL since oral iron started, or hemoglobin at target (≥ 11 g/dL; ≥ 10.5 in the second trimester), is a response and oral iron continues; a rise of less than 1 g/dL with hemoglobin still below target is nonresponse and leads to nonresponse management — expanded workup, and IV iron from 14 0/7 weeks. Do not start IV iron from this step; wait for the results." The rise and target figures are the response gates' own (§4b); "IV iron
  from 14 0/7 weeks" is gate-iv-iron-ga's rule. [1][3]
- **Guid-10** (on Step 2.21; v14): Guid-9's topic, category and text on its own node, for the
  route where the pathway started the oral iron. [1][3]
- **Guid-11 — topic "Rise cannot be measured yet: recheck hemoglobin in 2–4 weeks"** (on Step
  2.23; v15): category treatment-planning, clinician-facing `[DECISION — Josh 2026-10-04]`.
  Instructions (exact JSON text): "A hemoglobin has been drawn since oral iron started, but there is no hemoglobin from before it started to measure the rise from, so the response cannot be judged yet. This is not nonresponse. Continue oral iron. Today's hemoglobin becomes the baseline: repeat the CBC in 2–4 weeks, and the rise is judged at that recheck (a rise of at least 1 g/dL, or hemoglobin at target, is a response). Do not escalate to IV iron on this result alone." [1][3]
- **Guid-12** (on Step 2.24; v15): Guid-11's topic, category and text on its own node. [1][3]

## 10. Quality metrics

[GAP — no national anemia-in-pregnancy quality measure exists: searched CMS eCQI (EH+EC),
Joint Commission PC set, HEDIS, MIPS/QPP, PQM, AIM DCP. Anemia appears only as a
risk-adjustment variable in ePC-07/CMS1028.] Local process measures encoded instead
(the screening-completion measure left with the screening stage):

- *(v12)* QM-1 is not copied onto Step 2.14: its denominator is "patients started on iron
  therapy in this pathway", and a patient already on iron was not.
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
- **Sched-7** (on Step 2.14; v12): copy of Sched-2 — interval "2–4 weeks after starting oral iron";
  description as Sched-2's with the reference reading "(Step 2.14 response check, already on
  oral iron)". [1][3][6]
- **Sched-8** (on Step 2.17; v12): copy of Sched-3 — "~4 weeks after IV iron"; Hgb recheck. [1]
- **Sched-9** (on Step 2.18; v12): copy of Sched-3 — "~4 weeks after IV iron"; hemoglobin
  recheck; persistent anemia prompts hematology referral or re-evaluation of the diagnosis.
  `[JOSH — CONFIRM]` — the pathway cannot tell when the listed IV iron was given. [1]
- **Sched-10** (on Step 2.23; v15) / **Sched-11** (on Step 2.24; v15) `[DECISION — Josh
  2026-10-04]`: interval **"2–4 weeks"** (from this visit — Josh's figure, the same span as
  Sched-2); description (exact JSON text): "Repeat hemoglobin/hematocrit. The hemoglobin on file is the baseline; the rise since it is judged at this recheck (a rise < 1 g/dL with Hgb still below target is then nonresponse)." [1][3]
- **Sched-5** (on Step 4.3): interval "once, ~6 weeks postpartum"; Hgb recheck + iron
  continuation; symptomatic/severe postpartum anemia → IV iron or transfusion pathway. [1][6]

## 12. Prerequisites (REQUIRES)

All pairs acyclic; REQUIRES points dependent → prerequisite:

- **Step 2.1 REQUIRES Step 1.1** — treatment requires diagnosis confirmation and
  classification (the empiric path still passes through evaluation). [1]
- **Step 2.3 REQUIRES Step 2.1** — response check requires initiation. [1][3]
- *(v7)* **Step 2.10 has no REQUIRES Step 2.2** — deliberately: it is IV iron without the
  oral trial (DP-3).
- *(v12)* **No REQUIRES edge on any on-iron step** — deliberately: Step 2.14 has no REQUIRES
  Step 2.1 and Step 2.17 no REQUIRES Step 2.2, because Steps 2.1 / 2.2 are the initiation and
  trial period this route does not have (and lie under DP-1, which is closed for it).
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
| 58410-2 | LOINC | CBC panel, automated | Lab-1, Lab-10, Lab-19, Lab-24, Lab-25, Lab-26, Lab-29, Lab-32, Lab-33 |
| 718-7 | LOINC | Hemoglobin [Mass/Vol] blood | Lab-1, Lab-10, Lab-19, Lab-24, Lab-25, Lab-26, Lab-29, Lab-32, Lab-33 |
| 4544-3 | LOINC | Hematocrit, automated | Lab-1, Lab-10, Lab-19, Lab-24, Lab-25, Lab-26, Lab-29, Lab-32, Lab-33 |
| 787-2 | LOINC | MCV, RBC | Lab-1, Lab-10, Lab-19, Lab-24, Lab-25, Lab-26, Lab-29, Lab-32, Lab-33 |
| 2276-4 | LOINC | Ferritin, serum | Lab-2, Lab-11, Lab-15, Lab-17, Lab-18, Lab-22, Lab-27, Lab-30 |
| 2498-4 | LOINC | Iron, serum | Lab-3, Lab-16, Lab-23, Lab-28, Lab-31 |
| 2500-7 | LOINC | TIBC | Lab-3, Lab-16, Lab-23, Lab-28, Lab-31 |
| 2502-3 | LOINC | Iron saturation | Lab-3, Lab-16, Lab-23, Lab-28, Lab-31 |
| 4679-7 | LOINC | Reticulocytes/100 RBC | Lab-4, Lab-12 |
| 2132-9 | LOINC | Vitamin B12, serum | Lab-5 |
| 2284-8 | LOINC | Folate, serum | Lab-6 |
| 43113-0 | LOINC | Hemoglobinopathy electrophoresis panel | Lab-7, Lab-14, Lab-21 |
| 34994-4 | LOINC | Smear morphology panel, blood | Lab-8, Lab-13, Lab-20 |
| 882-1 | LOINC | ABO+Rh type | Lab-9 |
| 890-4 | LOINC | RBC antibody screen | Lab-9 |
| 85025 | CPT | CBC with automated differential | Lab-1, Lab-10, Lab-19, Lab-24, Lab-25, Lab-26, Lab-29, Lab-32, Lab-33 |
| 82728 | CPT | Ferritin | Lab-2, Lab-11, Lab-15, Lab-17, Lab-18, Lab-22, Lab-27, Lab-30 |
| 83540 | CPT | Iron | Lab-3, Lab-16, Lab-23, Lab-28, Lab-31 |
| 83550 | CPT | TIBC | Lab-3, Lab-16, Lab-23, Lab-28, Lab-31 |
| 85045 | CPT | Reticulocytes, automated | Lab-4, Lab-12 |
| 82607 | CPT | B12 | Lab-5 |
| 82746 | CPT | Folate, serum | Lab-6 |
| 83020 | CPT | Hgb electrophoresis (83021 if lab uses HPLC method) | Lab-7, Lab-14, Lab-21 |
| 36430 | CPT | Transfusion, blood or components | Proc-1 |
| 310325 | RXNORM | ferrous sulfate 325 mg tablet | Med-1 |
| 198630 | RXNORM | ferrous gluconate 324 mg tablet | Med-2 |
| 284202 | RXNORM | ferrous fumarate 324 mg tablet | Med-3 |
| 1741261 | RXNORM | iron sucrose 20 mg/mL injection | Med-4, Med-13, Med-17 |
| 2274409 | RXNORM | ferric derisomaltose 1,000 mg/10 mL [Monoferric] | Med-5, Med-14, Med-18 |
| 1435169 | RXNORM | ferric carboxymaltose 750 mg/15 mL | Med-6, Med-15, Med-19 |
| 206216 | RXNORM | iron-dextran 50 mg/mL [INFeD] | Med-7, Med-16, Med-20 |
| 310410 | RXNORM | folic acid 1 mg tablet | Med-8 |
| 309594 | RXNORM | cyanocobalamin 1 mg/mL injection | Med-9 |
| Z98.84 | ICD-10 | Bariatric surgery status | Step 3.4 (gate-captured — attaches to branch target) |
| D57.3 | ICD-10 | Sickle cell trait | Step 3.3 (gate-captured) |
| D56.3 | ICD-10 | Thalassemia minor | Step 3.3 (gate-captured) |
| O09.40 | ICD-10 | Supervision of pregnancy with grand multiparity, unspecified trimester | Step 1.1 (risk-factor flag) |

All codes wave-2 verified — see §18 item 11. **v12 adds no CodeEntry.** `311975` (ferrous
sulfate, ingredient) and `1311224` (ferric carboxymaltose, ingredient) appear only inside gate
conditions (§4b) and, for `311975`, the response gates' `window_from.codes`; they were given
with Josh's decision as entries of the simulator's medication reference and were not
re-verified against RxNav here.

## 14. Attribute-map registrations

**None needed.** All lab gates use coded-form conditions that match `labResults` by LOINC
directly, bypassing `pathway_attribute_code_map` entirely. The attribute conditions are all
`patient.*` — `patient.gestational_age_weeks` (gate-iv-iron-ga, 2026-09-24; gate-iv-iron-ga-direct, v7;
gate-oral-bridge-ga, v8, a nested leaf since v9) and, since v7,
`patient.trimester` (gate-hgb-response / gate-hgb-nonresponse) — which read
`patientAttributes` directly and need no code-map row (v12's `-on-iron` copies of those gates
read the same two attributes; the medication-list gates are coded conditions). No `lab.*`/`allergy.*` attributes
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
- Labs: Lab-1, Lab-10: [1] · Lab-2, Lab-11, Lab-15, Lab-17, Lab-18: [1][5] · Lab-3, Lab-16: [1] · Lab-4, Lab-12: [1] · Lab-5, Lab-6: [1]
  · Lab-7, Lab-14: [4] · Lab-8, Lab-13: [1] · Lab-9: [11]
- Proc-1: [1][11] · Guid-1: [1][12] · Guid-2: [1][12][13] · Guid-3: [1][12]
  · Guid-4: [5][13][14] · Guid-5: [1][10] · Guid-6 (v8): [8][18]
- Step 2.11 (v8): [1][8][18][19]
- Step 2.12, Step 2.13 (v9): [1][5] (Step 1.2's — the ferritin workup)
- Step 1.9 (v10): [1][5]
- v12 — Step 1.10: [1] (Step 1.7's) · Step 2.14: [1][3] (Step 2.3's) · Step 2.15: [3] · Step
  2.16: [1][3][6] · DP-4: [1][6] · Criteria 4a: [1][5], 4b: [1][8], 4c: [1], 4d: [6][1] · Step
  1.11: [1][4] · Step 2.17: [1][5][7][22] · Step 1.12: [1][5] (Step 1.2's) · Step 2.18: [1][5]
  · Med-17–Med-20: [5][22] · Lab-19, Lab-24: [1] · Lab-20: [1] · Lab-21: [4] · Lab-22: [1][5]
  · Lab-23: [1] · Guid-7: [1][3] · Guid-8: [1][5]. Every copy carries its original's citations
  as built in the JSON; no new evidence node (§15 unchanged).
- v13 — Step 1.13: [1] · Lab-25: [1] (Lab-1's). No new evidence node.
- v14 — Steps 2.19, 2.20, 2.21, 2.22: [1][3] (Step 2.14's / Step 2.3's) · Lab-26, Lab-29: [1]
  · Lab-27, Lab-30: [1][5] · Lab-28, Lab-31: [1] · Guid-9, Guid-10: [1][3] (Guid-7's). No new
  evidence node. `[GAP]` no source gives "ferritin and iron studies at the response recheck"
  as such — the order set is Josh's decision; the tests carry their originals' citations.
- v15 — Steps 2.23, 2.24: [1][3] · Lab-32, Lab-33: [1] · Guid-11, Guid-12: [1][3]. Sched-10 /
  Sched-11 cannot cite (host steps' [1][3]). No new evidence node. `[GAP]` "recheck in 2–4
  weeks when there is no baseline" is Josh's decision; no guideline states it.

Cannot cite (evidence attaches to host step — builder must reattach): all Gates → their
attached Stage/Step per §4b rationale refs; QM-1 → Step 2.3 [1][3]; QM-2 → Step 4.1
[9][11]; Sched-1–5 → their host steps ([1][3][6][9][11] per §11); CodeEntries → none.

## 17. Temporal horizon & status summary (EMITTED — review carefully)

The temporal-horizon kernel is merged; these assignments are emitted directly into the
gate conditions. The named-horizon grammar has no "current pregnancy" concept, so
pregnancy-scoping uses `{days: 90}` (≈ trimester — a stale pre-pregnancy or
prior-trimester lab must not drive classification) and `{days: 300}` (≈ full pregnancy +
margin). **These day-counts are my proposal — review.** **v13 exception** `[DECISION — Josh
2026-10-03]`: the hemoglobin / hematocrit **threshold** gates (gate-severe-anemia,
gate-referral-threshold) are not pregnancy-scoped any more — they read `LIFETIME`, the most
recent value however old, and a hemoglobin more than 30 days old orders a recheck instead of
being ignored.

| Gate | Condition on | horizon | status | window_days | Rationale |
|---|---|---|---|---|---|
| gate-microcytic / normocytic / macrocytic (gate-microcytic restored in v4) | labs 787-2 (MCV) | {days: 90} | — | — | Classification must reflect the anemia being worked up, not an old chart value |
| gate-ida-confirmed | labs 2276-4 (ferritin) | {days: 90} | — | — | Confirmatory ferritin from this workup |
| gate-ida-confirmed-iv (v9) / gate-oral-bridge-ga's ferritin leaf (v9) | labs 2276-4 (ferritin) `less_than` 30 | {days: 90} | — | — | Identical to gate-ida-confirmed, so both arms read the same ferritin |
| gate-no-ferritin-on-file (v9) / gate-oral-bridge-ga's "no ferritin" leaf (v9) | labs 2276-4 `not_includes_code` | {days: 90} | — | — | Same window as the threshold leaves: "no ferritin on file" and "ferritin < 30 on file" never read different results |
| gate-no-hgb-on-file (v10) | labs 718-7 `not_includes_code` | {days: 90} | — | — | "No level on file": the lab default window. Unchanged in v13, though the threshold gates it sits beside now read LIFETIME — `[JOSH — CONFIRM]` whether this should be LIFETIME too (§18) |
| gate-hgb-recheck-due (v13) | labs 718-7 `not_includes_code` | MONTH (30 days) | — | — | "> 30 days should trigger recheck": true when no hemoglobin is dated within the last 30 days — the most recent one is older, or there is none |
| gate-oral-bridge-ga's GA leaf / gate-iv-iron-ga-direct | `patient.gestational_age_weeks` | — (`patient.*` has no temporal policy) | — | — | Current GA |
| gate-response-recheck-due / gate-rechecked and their `-on-iron` copies (v14) | labs 718-7 `count_in_window`, `count_threshold` 1, `count_comparison` `less_than` / `at_least` | — (`window_from` *is* the window: start of the oral-iron start day → clock; no baseline admitted) | — | — | `[DECISION — Josh 2026-10-04]` "Has a hemoglobin been drawn since oral iron started?" Due at day 14 (`min_days_since_anchor` 14, the response gates' own figure — `[JOSH — CONFIRM]`). Only dated values count; one drawn on the start day counts (`[JOSH — CONFIRM]`) |
| gate-rise-unmeasurable / gate-rise-unmeasurable-on-iron (v15) | labs 718-7: count `at_least` 1 (since the start); count `less_than` 2 with `baseline_days` 28; below-target group `less_than` 10.95 / 10.45 + `patient.trimester` | counts: `window_from` (the second also admits the latest value ≤ 28 d before the start); below-target leaves {days: 28} | — | — | `[DECISION — Josh 2026-10-04]` one value since the start, no baseline, below target → recheck in 2–4 weeks. `[WINDOW]` markers in §4b; `[JOSH — CONFIRM]` most-recent vs 28 days |
| gate-rechecked / gate-rechecked-on-iron — count arm (v15) | labs 718-7 `count_in_window` `at_least` 2, `baseline_days` 28 | `window_from` + the latest value ≤ 28 d before the start | — | — | "The rise is measurable": the response gates' own point set has two values |
| gate-rechecked / gate-rechecked-on-iron (v14) — at-target arm | labs 718-7 `greater_than` 10.95 / 10.45; `patient.trimester` | {days: 28} on the hemoglobin leaves; none on the trimester | — | — | Copied from gate-hgb-response's at-target group so "At target at once" survives the move. `on_unresolved: default`: a baseline older than 28 days must not be asked for again |
| gate-hgb-response / gate-hgb-nonresponse | labs 718-7 Δ (`delta_from_baseline`) | — (`window_from` *is* the window: oral-iron start → clock, + latest Hgb ≤ 28 d before the start) | — | — | v7 — anchored to the treatment start, so the pre-treatment state is out by construction; due at day 14 |
| gate-hgb-response / gate-hgb-nonresponse | labs 718-7 (at-target arm) | {days: 28} | — | — | The current Hgb, not last trimester's |
| gate-hgb-response / gate-hgb-nonresponse | `patient.trimester` | — (`patient.*` has no temporal policy) | — | — | Derived from GA by the resolver |
| gate-severe-anemia | labs 718-7 (Hgb) | LIFETIME (v13; was {days: 7}) | — | — | `[DECISION — Josh 2026-10-03]` "it should be most recent": the newest hemoglobin on file decides, whatever its date — no upper limit on its age. Staleness is handled by ordering a recheck (gate-hgb-recheck-due), not by ignoring the value |
| gate-referral-threshold | labs 718-7, 4544-3 | LIFETIME each (v13; was {days: 90}) | — | — | Same decision: the newest hemoglobin / hematocrit on file, whatever its date |
| gate-multi-gestation | O30.* | {days: 300} | active | — | A *prior* pregnancy's twin code must not fire this pregnancy's surveillance branch |
| gate-scd / gate-thal-major / gate-trait | D57.* / D56.* | LIFETIME | any | — | Genetic conditions never expire |
| gate-empiric-no-hgbpathy (`not_includes_code`, v8; on gate-microcytic in v7) / gate-hgbpathy-microcytic (`includes_code`) | D57.0.*, D57.1, D57.2.*, D57.4.*, D57.8.*, D56.0/.1/.2/.5/.8/.9, D58.2 | LIFETIME | any | — | Genetic; `any` also makes `not_includes_code` never indeterminate (a code with an undecidable state is a definite match) |
| gate-bariatric | Z98.84, O99.84.* | LIFETIME | any | — | Anatomy is permanent |
| gate-ibd | K50.*, K51.* | LIFETIME | any | — | Chronic relapsing disease stays gate-relevant |
| gate-malabsorption-chart (v8) | Z98.84, O99.84.*, K50.*, K51.0/.2/.3/.5/.8/.9.*, K90.0, K90.82.*, K90.83, K90.9, K91.2, Z90.3 | LIFETIME | any | — | Chronic or anatomical; same reading as gate-bariatric / gate-ibd |
| gate-ckd | N18.*, O26.83.* | LIFETIME | active | — | Route out only on standing CKD; a resolved/erroneous historical code shouldn't exile the patient from the pathway |
| gate-no-iron-on-list (`not_includes_code` ×9) / gate-on-oral-iron (`includes_code` ×4 oral, `not_includes_code` ×5 IV) / gate-iv-iron-on-list (`includes_code` ×5 IV) (v12) | medications, RXNORM 310325, 198630, 284202, 311975 (oral); 1741261, 2274409, 1435169, 1311224, 206216 (IV) | LIFETIME | any | — | "On the medication list". One horizon and status on all 18 leaves so the three gates are exact complements; `any` keeps `not_includes_code` from ever being indeterminate (an entry whose state cannot be decided is a definite match), as for the hemoglobinopathy pair. LIFETIME because a bounded horizon selects on the start date: it would drop an iron started long ago and still taken. `[JOSH — CONFIRM]` cost: a stopped or old iron order still on the list counts as "on iron" (§18) |
| gate-hgb-response-on-iron / gate-hgb-nonresponse-on-iron / gate-iv-iron-ga-on-iron (v12) | as gate-hgb-response / gate-hgb-nonresponse / gate-iv-iron-ga | identical to the originals' rows above | — | — | Fan-out copies; `check-gate-control` holds them in sync |

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

### `[DECISION — Josh 2026-09-24]` Hemoglobinopathy disease suppresses the empiric-iron arm — ENCODED (v7); confirmed deficiency reaches iron (v8); DP-1 shown again — ACCEPTED (v9)

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

~~`[CLINICAL AMBIGUITY — for Josh]`~~ **The cost: DP-1 is asked again for disease patients.** A
patient with SCD, a thalassemia syndrome or HbC/HbE disease and MCV < 80 is asked "Empiric
iron vs confirmatory studies first"; the empiric option (titled "… not with hemoglobinopathy
disease", and criterion 1a says so) opens only iron studies (Step 1.8). A DecisionPoint's
options are the branches that score ≥ 0.60, and branch scores do not read the patient, so no
JSON can drop the empiric option for her.

**Accepted as is** `[DECISION — Josh 2026-09-25]`: DP-1 being shown again to
hemoglobinopathy-disease patients is fine, and **"confirmatory studies" is the right pick
for them** — it orders ferritin (Step 1.2) and, with ferritin < 30, leads to the normal Stage 2
iron path. No JSON change (v9 records the decision only); the engine change below is not
needed and is kept for the record.

**Engine change that would hide DP-1 again for disease patients** (not made, and since v9 not
wanted — see the decision above): give a closing gate's sweep a structural `spare`, as DecisionPoint
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

### `[DECISION — Josh 2026-10-04]` One hemoglobin, no baseline: recheck in 2–4 weeks, not nonresponse — ENCODED (v15)

**What was left open in v14.** With one hemoglobin since oral iron started and nothing before
it — most simply: no hemoglobin on the chart, the level asked for, and the provider typing in
today's value — the response gates had one value and no baseline, and asked "Hemoglobin …
newest result, drawn after <today>?". That cannot be answered; "Not available" closed both.

**Josh, 2026-10-04:** a single hemoglobin below target, at least 14 days into oral iron, with
no pre-iron baseline is **"recheck in 2–4 weeks, not nonresponse"**. He also confirmed that
v14's result for his own patient "came out correctly" (it is unchanged here).

**How it is encoded** (both routes).

1. **A third state, between "not rechecked" and "assessed".** `gate-rise-unmeasurable` (Step
   2.3) / `gate-rise-unmeasurable-on-iron` (Step 2.14): `AND(` a hemoglobin since the start
   `,` fewer than two points in the response gates' point set `,` below target `)` → **Step
   2.24 / Step 2.23**: Guid-12 / Guid-11 (continue oral iron; not nonresponse; today's value
   becomes the baseline; the rise is judged at the recheck; no IV iron on this alone), Lab-33
   / Lab-32 ("CBC with indices — recheck in 2–4 weeks (no pre-iron baseline to measure the
   rise from)"), Sched-11 / Sched-10 ("2–4 weeks").
2. **The response gates wait for a measurable rise.** `gate-rechecked` /
   `gate-rechecked-on-iron` change from `OR(` one since the start `,` at target `)` to `OR(`
   **two points** (`count_in_window` `at_least` 2 with `baseline_days` 28) `,` at target `)`.
   Behind them the response gates always have what they need, so they never ask for a second
   hemoglobin. "At target at once" is unchanged.
3. **"Points"** is the engine's new `baseline_days` on an anchored count: the one latest
   hemoglobin from the 28 days before the start, plus every one since — exactly what the
   delta is computed over. A baseline older than 28 days before the start does not count, so
   that patient is "unmeasurable" too, rather than being asked for a value.

**Behaviour changes beyond the dead end** (all follow from the rule; proved):
- One hemoglobin since the start with **no baseline** on the chart (not typed in): v14 asked
  "newest result, drawn after <its date>?" and held maintenance / nonresponse. v15: the
  recheck-in-2–4-weeks step, nothing asked.
- A hemoglobin drawn **on the start day** and nothing else (v14 point (a)): same — the step,
  nothing asked. It still counts as "since the start" and not as a baseline.
- The start-date question, when the start is unknown, is now raised by
  `gate-response-recheck-due` and `gate-rise-unmeasurable` together (one question).

**Open points.**

- `[JOSH — CONFIRM]` **Most recent hemoglobin, or only one from the last 28 days?** The
  "at target" and "below target" checks — in the response gates since v7, and copied into
  `gate-rechecked` and `gate-rise-unmeasurable` so all read the same value — read hemoglobin
  only inside 28 days. Your v13 rule for the threshold gates was "most recent, however old".
  Not changed here (it would change the response gates' clinical behaviour: an at-target value
  from two months ago would open maintenance). Costs as built: (1) a lone hemoglobin since
  the start that is itself more than 28 days old is neither "below target" nor "at target",
  so `gate-rise-unmeasurable` **asks "Hemoglobin … most recent value?"** — a value the chart
  holds an older copy of (proved; answerable, and the 30-day recheck of Step 1.13 is ordered
  beside it); (2) an at-target baseline older than 28 days does not open maintenance. Reading
  the most recent value (`LIFETIME`) in all four gates plus the four response gates would
  remove both. The four `[WINDOW — …]` markers in §4b record this.
- `[JOSH — CONFIRM]` **What the step orders.** Built: a repeat CBC with indices only, in 2–4
  weeks. No ferritin or iron studies here (the v14 "response not yet checked" step orders
  those, when nothing at all has been drawn since the start). Say if this step should too.

**Proof.** `gate-proof.ts response-recheck`, both edge orders, clock 2026-10-04. Step 2.14
route: no hemoglobin on the chart, gluconate ordered 31 days ago → the response recheck is
ordered and the level asked for (v10); the provider enters 8 → `gate-rise-unmeasurable-on-iron`
/ Step 2.23 / Lab-32 / Guid-11 / Sched-10 INCLUDED, the response recheck, `gate-rechecked-on-iron`,
Step 2.20, both response gates and Steps 2.15 / 2.16 / 2.17 GATED_OUT, no hemoglobin question,
no response-check question, no care-plan blocker on the route; enters 11.4 → Step 2.20 and
maintenance, the new step closed. A baseline of 2026-07-20 (older than 28 days before the
start) + 8.5 on 2026-10-01 → Step 2.23, nothing asked. A lone value since the start that is
45 days old → the gate asks "most recent value?" (the first open point). Step 2.3 route
(care plan of 2026-09-03): the typed value and the old-baseline case → Step 2.24, nothing
asked, no blocker. `response` (clock June 2026): one value on day 15 and no baseline → Step
2.24 (was: one "newest result" question); the same at 11.3 → maintenance; at 10.7 with the
trimester unknown → one trimester question and no hemoglobin question, GA 20 → maintenance,
GA 30 → Step 2.24; two values since the start → assessed (nonresponse at +0.6); the
start-day-only value → Step 2.24. Josh's patient, "at target at once", the start visit and
day 7 are unchanged.

### `[DECISION — Josh 2026-10-04]` Response due, not yet rechecked: order the recheck, do not ask for a value — ENCODED (v14)

**What Josh saw.** Patient: pregnant, 28 weeks, anemia. Chart: hemoglobin 8 g/dL dated
2026-09-01, MCV 70 the same day, ferrous gluconate on the medication list. He answered that
oral iron started 2026-09-03. Visit 2026-10-04. v13 routed her correctly to Step 2.14
("Already on oral iron") and then **asked for a newer hemoglobin**: the two response gates
need two dated values, one of them after the start, and with `on_unresolved: ask` a series one
value short asks for it. Answering "No newer result" closed both gates and nothing followed.

**Josh:** "It should be accepting the value I gave along with MCV and that oral iron
supplementation was started 1 month ago. The recommendation should be to repeat testing with
iron studies to determine need for IV iron."

**The rule.** On oral iron long enough for the response to be judged (14 or more days) with
no hemoglobin drawn since it started → **do not ask for a hemoglobin**. Recommend the response
recheck — repeat CBC with indices, ferritin, iron/TIBC/transferrin saturation — and say that
the results decide whether IV iron is needed. The value on file is kept and used: it decides
the threshold gates (referral at Hgb 8) and it is the baseline the rise will be measured from.

**How it is encoded.**

1. **A count, not a question.** `gate-response-recheck-due-on-iron` on Step 2.14: labs 718-7
   `count_in_window`, `count_threshold` 1, `count_comparison: "less_than"`, `window_from` the
   oral-iron start (the response gates' anchor and four codes), `min_days_since_anchor` 14,
   `on_unresolved: ask`, `default_behavior: skip` → **Step 2.19**. A count of zero is a real
   answer, so nothing is asked for; only an unknown start date is ("When did oral iron
   start?", once).
2. **Step 2.19 orders the recheck on its own nodes** — Lab-26 (CBC with indices — response to
   oral iron (no hemoglobin since it started)), Lab-27 (ferritin), Lab-28 (iron/TIBC/
   transferrin saturation) — whatever the answer to "Order confirmatory iron studies now?",
   with Guid-9: continue oral iron; these results decide whether she is responding or needs IV
   iron; do not start IV iron from this step.
3. **The response gates sit behind the complement.** `gate-rechecked-on-iron` (the same count,
   `at_least` 1 — **OR hemoglobin already at target**, so "At target at once" of 2026-09-24
   still holds; this gate never asks) → **Step 2.20**, which now hosts `gate-hgb-response-on-iron` → Step 2.15 and
   `gate-hgb-nonresponse-on-iron` → Step 2.16, moved off Step 2.14 and otherwise unchanged.
   They are not evaluated — so they cannot ask — until a hemoglobin since the start exists
   (or she is at target, where they decide without asking).
   They keep `on_unresolved: ask`. ~~With a value since the start but no baseline to measure
   from, asking for a dated hemoglobin is still right.~~ **v15:** that state is "recheck in
   2–4 weeks" (section above); the response gates are no longer reached in it.
4. **The same on the route where the pathway started the iron.** A patient started on oral
   iron at an earlier visit, back 14 or more days later with no recheck, fell into the same
   hole on Step 2.3. `gate-response-recheck-due` → **Step 2.21** (Lab-29 / Lab-30 / Lab-31,
   Guid-10) and `gate-rechecked` → **Step 2.22**, which hosts `gate-hgb-response` /
   `gate-hgb-nonresponse`. The start visit is unchanged: the anchor is this session, both
   count gates are NOT YET DUE, nothing is asked and nothing blocks the plan.

**What a visit now does** (both routes; "since the start" = dated on or after the start day):

| Oral iron | Hemoglobin since the start | Result | Asked |
|---|---|---|---|
| start date unknown | — | count gates held | "When did oral iron start?" once |
| starts this visit / day < 14 | any, below target | NOT YET DUE — nothing opens | nothing |
| any day | at target (within 28 days) | **maintenance at once** (Step 2.15 / 2.4) | nothing |
| day ≥ 14 | none | **recheck ordered** (Step 2.19 / 2.21); with an at-target baseline, maintenance as well | nothing |
| day ≥ 14 | one or more, baseline on file, rise ≥ 1 or at target | maintenance (Step 2.15 / 2.4) | nothing |
| day ≥ 14 | one or more, baseline on file, rise < 1 and below target | nonresponse management (Step 2.16 / 2.6) | the trimester, only for Hgb 10.5–11 |
| day ≥ 14 | one, no baseline, below target | **v15:** recheck in 2–4 weeks (Step 2.23 / 2.24) — not nonresponse *(v14: response gates held on one hemoglobin question)* | nothing (trimester for Hgb 10.5–11) |

**Open points.**

- `[JOSH — CONFIRM]` **(a) A hemoglobin drawn on the day iron started counts as "since the
  start".** The window opens at the start of the start day. Such a value is really a
  pre-treatment value, yet it closes the recheck step — and, with it as the only value, **v15** opens
  "recheck in 2–4 weeks" (Step 2.23 / 2.24) with nothing asked (v14: the response gates asked
  for a newer one). Proved in `gate-proof.ts response`. Counting only from the
  day after would need an engine change.
- `[JOSH — CONFIRM]` **(b) What the recheck orders.** Built: CBC with indices + ferritin +
  iron/TIBC/transferrin saturation ("repeat testing with iron studies"). No reticulocyte
  count — the pathway's only reticulocyte check is the optional day 7–10 one on Step 2.2.
  Say if the recheck should carry one.
- `[JOSH — CONFIRM]` **(c) The 14-day minimum is reused for "recheck due".** The response
  gates judge the rise from day 14 (FIGO's 2-week point), and the recheck comes due the same
  day. Sched-2 / Sched-7 say "2–4 weeks": at day 14–27 with no hemoglobin since the start the
  plan already says the response "has not been checked" and orders the recheck. A later due
  day (21 or 28) is one number.
- **At target at once is kept** (`[DECISION — Josh 2026-09-24]`; not an open point).
  `gate-rechecked` / `gate-rechecked-on-iron` are `OR(` a hemoglobin since the start `,` at
  target `)`, so a patient already at target reaches the response assessment and maintenance
  opens at once, the start visit included. One consequence to know: at day 14 or later with
  an at-target baseline and nothing drawn since the start, the plan carries **maintenance and
  the recheck orders together** — she is at target, and the response has still not been
  rechecked. These two gates never ask (`on_unresolved: default`, markers in §4b): with `ask`,
  a baseline more than 28 days old — your patient's — would have been asked for again.
- `[JOSH — CONFIRM]` **(d) The same test on several plan lines.** Each step orders on its own
  node (one host per lab, §6). For your patient the plan lists **four** CBC lines — Step 1.1
  (Lab-1), the 30-day recheck (Lab-25: her hemoglobin is 33 days old), Step 2.14's scheduled
  recheck (Lab-19) and the response recheck (Lab-26) — and, if "Order confirmatory iron
  studies now?" is answered yes, ferritin and iron/TIBC twice (Lab-22 / Lab-23 and Lab-27 /
  Lab-28). One draw answers all of them. On the Step 2.3 route it is Lab-1, Lab-10, Lab-25
  and Lab-29. The confirmatory-studies question is also still asked at a visit where the
  recheck is ordering those very tests.
- `[JOSH — CONFIRM]` **(e) Nothing reads the ferritin or iron-study results.** Guid-9 says the
  results decide whether she needs IV iron. In the pathway that decision is made at the next
  visit on the **hemoglobin** alone (rise < 1 g/dL and below target → nonresponse management →
  IV iron from 14 0/7 weeks); the ferritin and saturation are for the clinician. The same was
  flagged in v12 for the confirmatory studies on this route.

**Limits.** An undated hemoglobin has no draw date and is not counted as drawn since the
start, so with only undated values the recheck is ordered — this is what the simulator shows.
A level the provider enters in answer to a hemoglobin question with its draw date is a dated
result like any other and counts when that date is on or after the start. With no hemoglobin on file at all the recheck step opens as well (a count of zero),
beside v10's question for the level.

**Closed in v15.** v14 left one dead end of the same kind — no hemoglobin on the chart, the
provider types today's value, and the response gates ask for a result "drawn after" today.
Josh decided it the same day (section above: "recheck in 2–4 weeks, not nonresponse").

**Proof.** `gate-proof.ts response-recheck` (new), both edge orders, real engine, clock
2026-10-04. Step 2.14 route: Josh's patient (ferrous gluconate 198630 undated) → one
start-date question and no hemoglobin question; answered 2026-09-03 → anchored CLINICIAN,
`gate-response-recheck-due-on-iron` / Step 2.19 / Lab-26–28 / Guid-9 INCLUDED,
`gate-rechecked-on-iron` / Step 2.20 / both response gates / Steps 2.15, 2.16, 2.17 GATED_OUT,
no question from any response-check gate, no care-plan blocker on the route, no iron
Medication INCLUDED, CBC lines Lab-1 / 19 / 25 / 26; confirmatory studies yes → ferritin
Lab-22 + Lab-27, iron Lab-23 + Lab-28. With a dated order (31 days) → the same with nothing
asked. 8.0 → 9.4 since the start → Step 2.20, Step 2.15; 8.0 → 8.5 → Step 2.16, DP-4, Step
2.17. Day 7 → both count gates NOT_YET_DUE (due 2026-10-11), nothing asked, also with a
day-5 hemoglobin. Step 2.3 route (care plan of 2026-09-03): the same four on Steps 2.21 /
2.22 / 2.4 / 2.6; the start visit → both count gates NOT_YET_DUE on `SESSION_RECOMMENDATION`,
nothing asked, no blocker, Step 2.1 / Med-1 / Lab-10 INCLUDED. **Expectations changed in the
older proofs, on purpose:** `response` — NOT YET DUE and the start-date question are asserted
on the count gates, and the start-date question is raised by `gate-response-recheck-due`
alone (`gate-rechecked` never asks and is closed until it is answered); "start visit, Hgb
11.2 → maintenance at once" is unchanged in outcome (now also asserting Step 2.22 INCLUDED
and the recheck step closed); "day 21, baseline only" asserted one hemoglobin question and
now asserts none, Step 2.21 and its labs INCLUDED; added: at-target baseline with no recheck
→ maintenance **and** the recheck, and a hemoglobin on the start day (point (a)). `on-iron` — "start date answered, only an
undated hemoglobin → the copies ask for a dated hemoglobin / Not available closes both" now
asserts no hemoglobin question and Step 2.19 INCLUDED. `empiric`, `dp-3`, `iv-ferritin`,
`hgbpathy` — their start-visit NOT YET DUE lines name the count gates.

### `[DECISION — Josh 2026-10-03]` The most recent hemoglobin decides; over 30 days old → recheck — ENCODED (v13)

**What prompted it.** A patient's chart held a hemoglobin of 8 g/dL dated 33 days before the
visit. `gate-severe-anemia` read hemoglobin with a 7-day horizon, so it treated the chart as
having none and asked "Hemoglobin (g/dL) (LOINC 718-7) — most recent value?" — for a value
the chart already had.

**Josh:** "it should be most recent but > 30 days should trigger recheck".

**How each part is encoded.**

1. **"it should be most recent"** — the threshold gates read the newest value on file,
   however old. `gate-severe-anemia`: hemoglobin horizon `{days: 7}` → `"LIFETIME"`.
   `gate-referral-threshold`: both leaves (hemoglobin 718-7, hematocrit 4544-3) `{days: 90}`
   → `"LIFETIME"`. `LIFETIME` is in the horizon grammar for any coded condition and the
   import validator accepts it on a `labs` scalar; no fallback was needed.
2. **"> 30 days should trigger recheck"** — new membership gate `gate-hgb-recheck-due` on
   Step 1.1: `labs` `not_includes_code` 718-7, horizon `"MONTH"` (30 days),
   `on_unresolved: default` (never asks) → **Step 1.13** → **Lab-25**, a repeat CBC with
   indices (a copy of Lab-1 on its own node, one node per host step).
3. **No hemoglobin at all — unchanged.** The threshold gates still ask (v10: "we ask the
   provider for a level if we don't have it. If none is entered, then we treat it as unknown
   level of anemia and recommend ordering anemia labs"). `gate-hgb-recheck-due` is open in
   that case too ("none in 30 days" includes "none"), beside `gate-no-hgb-on-file` → Step
   1.9, so the plan holds the CBC, the CBC recheck line and the ferritin.
4. **Not touched.** The response gates (`gate-hgb-response`, `gate-hgb-nonresponse` and
   their `-on-iron` copies): their `{days: 28}` at-target leaves and `window_from` windows
   are the treatment-response mechanism, not a threshold on the level. `gate-no-hgb-on-file`
   (90 days). Hematocrit gets no recheck gate; the CBC returns it.

**What a visit now does** (hemoglobin on file, by the age of the newest one):

| Newest hemoglobin | Threshold gates | Asked? | Step 1.13 repeat CBC | Step 1.9 ferritin |
|---|---|---|---|---|
| ≤ 30 days old | decide on it | no | closed | closed |
| 31–90 days old | decide on it | no | **open** | closed |
| > 90 days old | decide on it | no | **open** | **open** (see below) |
| none | ask; "Not available" closes them | **yes** | **open** | **open** |

**Open points.**

- `[JOSH — CONFIRM]` **Should "severity unknown" now mean no hemoglobin ever?**
  `gate-no-hgb-on-file` still reads 90 days. Before v13 a hemoglobin older than 90 days was
  invisible to every gate, so "none in 90 days" and "level unknown" were the same thing. Now
  a 4-month-old hemoglobin decides transfusion and referral — the level is *known*, only old
  — yet Step 1.9 ("Hemoglobin level unknown: order anemia labs") still opens and orders a
  ferritin beside the CBC recheck. Changing this gate's horizon to `LIFETIME` would make
  Step 1.9 open only when there is no hemoglobin at all. Not changed: you did not ask for it.
- `[JOSH — CONFIRM]` **Two CBC lines in the plan.** Step 1.1's CBC with indices (Lab-1) is
  unconditional, so whenever the recheck is due the plan lists "CBC with indices" and "CBC
  with indices — recheck (no hemoglobin in the last 30 days)". One draw answers both. The
  alternative — no Lab-25, Step 1.13 carrying only the reason — would leave the recheck
  with no order line of its own.
- `[JOSH — CONFIRM]` **No upper limit on age.** "Most recent" is encoded literally: a
  hemoglobin from before this pregnancy, or years old, decides transfusion consideration
  (Step 3.6) and referral (Step 3.7) when nothing newer is on file, with the recheck ordered
  beside it. The same holds for the hematocrit leaf — and an old hematocrit < 27% with a
  recent hemoglobin ≥ 9 opens referral with no recheck, since the recheck gate reads
  hemoglobin only. A cap (e.g. `YEAR`, or `{days: 300}` as gate-multi-gestation uses) is one
  horizon value if you want one.
- `[JOSH — CONFIRM]` **The recheck line's wording.** Lab-25 is named "CBC with indices —
  recheck (no hemoglobin in the last 30 days)" rather than "(last hemoglobin over 30 days
  old)", because the gate is also open with no hemoglobin on file at all, where the second
  wording would be false. Step 1.13's title is "Hemoglobin older than 30 days: repeat the
  CBC"; its description says it is also open with none on file.

**Limits.** An undated hemoglobin counts as current (undated facts are asserted at the
session clock), so it never opens the recheck; the > 30-day arm needs a dated result. A
level the provider types in answer to the hemoglobin question is likewise current and closes
the recheck.

**Proof.** `gate-proof.ts hgb-recheck`, both edge orders, real engine, clock 2026-09-24:
Hgb 8 dated 33 days earlier (MCV 72) → no hemoglobin question, `gate-severe-anemia`
GATED_OUT, `gate-referral-threshold` INCLUDED, `gate-hgb-recheck-due` / Step 1.13 / Lab-25
INCLUDED, `gate-no-hgb-on-file` / Step 1.9 / Lab-18 GATED_OUT. Hgb 5.5 at 33 days →
`gate-severe-anemia` and Step 3.6 INCLUDED, recheck INCLUDED. Hgb 8 at 10 days → nothing
asked, recheck GATED_OUT. Hgb 8 at 120 days → nothing asked, referral INCLUDED, recheck and
Step 1.9 / Lab-18 both INCLUDED (the first open point above). Undated Hgb 8 → recheck
GATED_OUT. No hemoglobin → one question (`LOINC:718-7`), recheck and Step 1.9 both INCLUDED;
answered with Hgb 8 → both close and referral opens. **One v12 expectation changed:**
`response`'s "day 21, baseline only (24 days old, not rechecked)" expected the one hemoglobin
question to be asked by three gates, `gate-severe-anemia` among them (7-day horizon, so the
24-day-old baseline was invisible to it). In v13 that gate decides on the baseline (9.5 is
not < 6): the question is still exactly one, asked by the two response gates, and the
scenario now also asserts `gate-severe-anemia` GATED_OUT. Every other expectation is
untouched.

### `[DECISION — Josh 2026-10-03]` Already on iron: skip the iron choices — ENCODED (v12)

**What Josh saw.** In the simulator, a patient with ferrous sulfate on her medication list was
asked DP-1 ("Empiric iron vs confirmatory studies first") and then DP-3 ("Oral iron trial vs
IV iron without an oral trial"). Through v11 no gate read the medication list.

**The three questions, and his answers verbatim** — "1. not necessarily. 2. all oral iron
supplements based on what's written. 3. yes, skip":

1. *Does being on iron also skip the confirmatory workup?* — **"not necessarily."** Encoded as
   a provider question on the on-iron route: `gate-confirm-studies-on-iron`, "Order
   confirmatory iron studies now?" (BOOLEAN). Yes → Step 1.12 orders ferritin (Lab-22) and
   iron/TIBC/saturation (Lab-23); no → they are not ordered. Neither skipped nor forced.
2. *Which medications count as "on oral iron"?* — **"all oral iron supplements based on what's
   written."** Encoded as the four oral iron entries the simulator's medication reference
   holds: RxNorm `310325` (ferrous sulfate 325 mg tablet), `198630` (ferrous gluconate 324 mg
   tablet), `284202` (ferrous fumarate 324 mg tablet), `311975` (ferrous sulfate, ingredient).
   Any one of them, with no IV iron on the list → `gate-on-oral-iron` → Step 2.14: DP-1 and
   DP-3 are not asked; she continues the oral iron she is on (Guid-7; no Medication node, so
   nothing is "initiated" and there is no choice between sulfate, gluconate and fumarate); the
   response check applies (below).
3. *Should a patient with IV iron on her medication list skip the oral-versus-IV choice too?*
   — **"yes, skip."** Encoded as `gate-iv-iron-on-list` on `1741261` (iron sucrose), `2274409`
   (ferric derisomaltose), `1435169` (ferric carboxymaltose 750 mg/15 mL), `1311224` (ferric
   carboxymaltose, ingredient), `206216` (iron dextran) → Step 2.18: neither DP is asked, no
   IV iron and no oral trial is recommended, and the follow-up CBC is ordered.

**Both oral and IV iron on the list → treated as IV iron given** (Step 2.18).
**Neither on the list → exactly v11**: nothing under Step 1.7 changed, and the v11 proofs hold
unchanged but for one scenario (below).

**How it is wired** (§3 Step 1.10, §4b). `gate-microcytic` (MCV < 80, unchanged) now opens
**Step 1.10**, which hosts three membership gates on `medications` — exact complements, never
asking anything: no iron → Step 1.7 (DP-1); oral, no IV → Step 2.14; IV → Step 2.18.
Classification by MCV, the hemoglobinopathy-testing question, the severe / referral gates,
Stage 3, predelivery, postpartum and the v10 "no hemoglobin on file" step are untouched and
apply to every patient as before.

**The response check on the on-iron route is a copy, not Step 2.3 itself** `[BUILD NOTE]`.
The decision was that "the existing response assessment applies". It does, as the same rule:
Step 2.14 hosts `gate-hgb-response-on-iron` / `gate-hgb-nonresponse-on-iron`, byte-identical
copies of Step 2.3's gates that the build check holds in sync, leading to copies of
maintenance (Step 2.15), nonresponse management (Step 2.16, DP-4), the expanded workup (Step
1.11) and IV iron after nonresponse at GA ≥ 14 (Step 2.17, Med-17–20). It cannot be the same
nodes: Step 2.3 lies under DP-1, the gate that hides DP-1 from this patient sweeps everything
under it, and a closing chart gate spares nothing — only a fork can share contents (§4 DP-1,
v7/v8). The cost is 35 more nodes to keep aligned by hand where no lint reaches (step titles,
DP-4's criteria, Med-17–20, the lab and schedule copies).

**Limitation — exact code matching.** The engine matches a medication by exact RxNorm code
only. An oral or IV iron product recorded under a code outside the nine above (another
strength or brand, a polysaccharide-iron complex, a combination product, a prenatal vitamin
with iron) is **not recognised**: that patient is asked DP-1 and DP-3 as in v11. This stands
until medication family matching exists.

**What the simulator shows.** The composer's medication list is undated. Oral iron on it →
Step 2.14 with **two questions**: "Order confirmatory iron studies now?" and "When did oral
iron start?" (the response gates need the start date and an undated order cannot give it).
With the date answered the response check still has no dated hemoglobin series there (§18
"Simulator-untestable"); ~~it asks for a dated result or is declined~~ **v14:** an undated
hemoglobin is not "drawn since the start", so with a start date 14 or more days back Step
2.19 orders the recheck and nothing more is asked (with a date fewer than 14 days back:
NOT YET DUE, nothing). IV iron on the list →
Step 2.18, nothing asked about iron.

**Open — for Josh:**

- `[JOSH — CONFIRM]` **Step 2.18's content.** He said "skip" and no more. Built: Guid-8 ("IV
  iron has been given; do not start IV iron again or an oral iron trial…"), a follow-up CBC
  (Lab-24) and Sched-3's existing interval and wording (Sched-9: hemoglobin recheck ~4 weeks
  after IV iron; persistent anemia → hematology referral or re-evaluation). No dose, no new
  timing, no new citation. Not built: any route back to iron for a patient whose IV course
  was incomplete or long ago, and no response gate after IV iron.
- `[JOSH — CONFIRM]` **A stopped or old order still counts.** The gates read LIFETIME /
  status `any` (§17): any listed entry, active or not, from this pregnancy or before, is
  "on iron" (and an IV iron entry from a previous pregnancy is "IV iron given"). The
  alternative, status `active`, would leave a patient whose entry has an undecidable state
  with **none** of the three gates open and so no iron plan at all, which is why it was not
  chosen. The simulator sends no state or date, so there every entry counts either way.
- `[JOSH — CONFIRM]` **Nothing reads the confirmatory results on the on-iron route.** A yes
  orders the studies; a ferritin ≥ 30 does not stop or question the oral iron (v9 decision (b)
  made the same call for the empiric oral trial).
- `[JOSH — CONFIRM]` **Hemoglobinopathy disease + already on oral iron → "continue".** With
  no iron on the list such a patient cannot get empiric iron (v7/v8). On Step 2.14 nothing
  reads the disease codes, so she is told to continue; Steps 3.1 / 3.2 (route out; "without
  iron unless deficiency confirmed") still open beside it and say otherwise.
- `[JOSH — CONFIRM]` **No confirmatory-studies question after IV iron** (Step 2.18). Answer 1
  was read as being about the oral-iron patient.
- `[JOSH — CONFIRM]` **Counseling blocks.** Guid-1–4 (diet, what blocks iron, plant-based
  plan, "making your iron pill work") and docusate (Med-10) hang from Step 2.1, the
  initiation step, and are not shown to a patient already on oral iron. The reticulocyte
  check (Step 2.2) and DP-3's malabsorption recommendation (Step 2.11) are not on this route
  either; gate-bariatric / gate-ibd (Steps 3.4 / 3.5) still fire.
- `[JOSH — CONFIRM]` **Only microcytic patients.** The medication list is read behind
  gate-microcytic, because DP-1 and DP-3 exist only there. A normocytic or macrocytic patient
  on iron is unchanged from v11: no iron arm of any kind, so no "continue" step and no
  response check (proved at MCV 90).

**Proof.** `gate-proof.ts on-iron`, both edge orders: oral iron (each of the four codes) →
DP-1 and DP-3 never asked, every node under Step 1.7 GATED_OUT, Med-1/2/3/11 and every IV
Medication not INCLUDED, Step 2.14 / Guid-7 / Lab-19 / Sched-7 INCLUDED, the confirmatory
question asked once and holding the plan, yes → Step 1.12 / Lab-22 / Lab-23 INCLUDED, no →
GATED_OUT; undated order → one start-date question from both gate copies; dated order → day
5 NOT YET DUE, day 21 +1.2 → Step 2.15, +0.4 → Steps 2.16 / 1.11 and (GA 20) 2.17 with
Med-17–20, GA 12 → Step 2.17 GATED_OUT. IV iron (each of the five codes; and with oral iron
too) → no DP asked, no iron Medication INCLUDED, Step 2.18 / Guid-8 / Lab-24 / Sched-9
INCLUDED, Step 2.14 closed. No medication, and folic acid only → DP-1 pending with both
options, and empiric + oral trial initiates Med-1/2/3 as before. **One v11 scenario changed:**
`response`'s "dated ferrous sulfate order anchors a day-21 nonresponder with no care plan"
put an oral iron order on a patient who then answered DP-1 and DP-3; in v12 that patient is
on Step 2.14, so the scenario now asserts the same outcome there (anchored on the order,
nonresponse → Step 2.16, DP-1 / DP-3 not asked). The old form is not merely moved: an oral
iron order on a patient who answers DP-1 cannot occur in v12. Every other v11 expectation is
untouched.

**Coverage audit.** `coverage-audit.ts` generated each medication code independently at 30%,
so "none of nine iron codes" — the v11 route — was 4% of its patients and DP-1's own subtree
went unexercised (25 branch choices in 1,500 patients). Its medication lists are now drawn
sparse and dense, as its condition lists already were (none / 3% / 30% per code); pathways
with no medication gate generate the same patients as before. With that, 1,500 patients
exercise every gate and node under stub and real scoring (real scoring also at 800 and
1,000). At 400 patients with real scoring the audit **fails** (24 findings): the three-way
split leaves unsampled the IV iron after non-response on the no-iron route (Step 2.5,
gate-iv-iron-ga, Med-4–7, Sched-3) and the whole non-response chain of the on-iron route
(gate-hgb-nonresponse-on-iron, Step 2.16, DP-4 and criteria 4a–4d, Step 1.11 with Lab-20/21,
gate-iv-iron-ga-on-iron, Step 2.17, Med-17–20, Sched-8). Sample size, not reachability: the
same audit includes every one of them at 800, 1,000 and 1,500 patients, and `gate-proof.ts
response` / `on-iron` assert them INCLUDED.

### `[DECISION — Josh 2026-10-03]` No hemoglobin level: ask; if none, unknown severity → order anemia labs — ENCODED (v10)

Asked whether an anemia diagnosis with no level should simply order the labs, Josh chose to
keep asking: "we ask the provider for a level if we don't have it. If none is entered, then
we treat it as unknown level of anemia and recommend ordering anemia labs."

- **Pathway:** `gate-no-hgb-on-file` → Step 1.9 → Lab-18 (ferritin), beside Step 1.1's
  unconditional CBC with indices.
- **Engine (josh-dev, not on main):** a data question can be answered "Not available"
  (`GateAnswerInput.notAvailable`). The decline is stored against the datum, so every gate
  asking for it stops and takes its `default_behavior`. It also closes the dead end the
  coverage audit found, where a response gate asked for a "newest result drawn after" the
  provider's own answer.
- **Open:** `[JOSH — CONFIRM]` the order set (CBC with indices + ferritin).
- **Recheck due with no dated hemoglobin (engine, 2026-10-03):** the response gates used to
  close without asking when the window held no dated hemoglobin at all, so an encounter
  with iron started 45 days earlier and only an undated hemoglobin on the chart showed no
  prompt for the recheck. They now ask — "Hemoglobin (g/dL) (LOINC 718-7) — a result, and
  the date it was drawn?" — and a lab answer can carry its draw date, so a baseline and a
  recheck can both be entered. "Not available" closes them. No JSON change.

### `[DECISION — Josh 2026-09-25]` IV iron first needs a confirmed ferritin — ENCODED (v9)

IV iron without an oral trial (DP-3) is given only with a ferritin < 30 ng/mL on file, at GA ≥
14; with no ferritin on file (the empiric arm) choosing it orders a ferritin and starts oral
iron meanwhile. Design, proofs and the four open consequences — the ferritin question holding
the visit's care plan, a ferritin ≥ 30 read two ways on the empiric arm, oral iron stopping
once IV iron opens, a late diagnosis (3d) waiting for the ferritin — are in §4 DP-3 ("IV iron first needs a confirmed ferritin"). The
ferritin leaf inside gate-oral-bridge-ga is a hand copy of gate-ida-confirmed's condition that
no lint checks (§4b).

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
undated Hgb never counts as ≥ 14 days old, so it does not trigger the question. **v12:** that
patient (MCV < 80) is no longer on Step 2.3 at all — she is on Step 2.14, whose gate copies
ask the same start-date question, then for a dated hemoglobin (`gate-proof.ts on-iron`).
**v14:** on both routes the simulator can now reach the **recheck step** (Step 2.19: answer a
start date 14 or more days back; Step 2.21 needs a stored care plan or a clinician date, so
only through the API), but still not the response assessment: Steps 2.20 / 2.22 need a
*dated* hemoglobin since the start, which the composer cannot give. Maintenance and
nonresponse remain API-only (`gate-proof.ts response`, `response-recheck`).

*v5/v6:* `gate-hgb-response` was a question gate with no trend arms. The v4 note follows.

The encounter simulator sends no dates. The three `trend_up` arms need at least two
**dated** hemoglobin values, so they never fire from the simulator (one undated value: not
met; two or more: unorderable, and the gate asks for a hemoglobin instead). Only the
absolute-target arm (Hgb > 10.9 within 90 days) is exercisable there. Test the trend arms
with dated labs (API or seeded data), not the composer.
