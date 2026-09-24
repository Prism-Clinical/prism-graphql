#!/usr/bin/env python3
"""RETIRED (2026-09-24) — do not run. Kept only as a record of the v2 build.

This generated anemia-in-pregnancy from brief v2, but the committed
pathways/json/anemia-in-pregnancy.json has since been edited directly and has
moved well past it: a "v1"-prefixed version, `traverse` on
gate-ida-confirmed (the defect that let ferritin 50 open iron therapy), a
single delta gate where the JSON layers trends, no on_unresolved, no lab
`display`, and gate-microcytic, which the JSON has dropped.
Running it would silently overwrite the real file with that older pathway.

The JSON is now the source of truth, edited directly and checked with
validate-pathway.ts, check-gate-control.ts and gate-proof.ts.
"""
import sys

sys.exit(
    "build-anemia-json.py is RETIRED: it no longer reproduces "
    "pathways/json/anemia-in-pregnancy.json and would overwrite it with an older "
    "pathway. Edit the JSON directly. See this file's docstring."
)

import json  # noqa: E402 — unreachable; the builder below is historical

nodes, edges = [], []
def N(id, type, **props): nodes.append({"id": id, "type": type, "properties": props})
def E(f, t, ty): edges.append({"from": f, "to": t, "type": ty})

H90 = {"days": 90}

# ── §1 metadata ──────────────────────────────────────────────────────
pathway = {
    "logical_id": "anemia-in-pregnancy",
    "title": "Anemia in Pregnancy — Classification and Treatment",
    "version": "v1",
    "category": "OBSTETRIC",
    "scope": "Outpatient prenatal care, from diagnosed anemia through postpartum handoff. Screening is upstream of this pathway.",
    "target_population": "Adult pregnant patients with diagnosed anemia; hemoglobinopathy disease, thalassemia syndromes, and CKD-associated anemia are detected and routed out",
    "condition_codes": [
        {"code": "O99.011", "system": "ICD-10", "description": "Anemia complicating pregnancy, first trimester", "usage": "primary trigger", "grouping": "anemia-pregnancy"},
        {"code": "O99.012", "system": "ICD-10", "description": "Anemia complicating pregnancy, second trimester", "usage": "primary trigger", "grouping": "anemia-pregnancy"},
        {"code": "O99.013", "system": "ICD-10", "description": "Anemia complicating pregnancy, third trimester", "usage": "primary trigger", "grouping": "anemia-pregnancy"},
        {"code": "O99.019", "system": "ICD-10", "description": "Anemia complicating pregnancy, unspecified trimester", "usage": "primary trigger", "grouping": "anemia-pregnancy"},
        {"code": "D50.9", "system": "ICD-10", "description": "Iron deficiency anemia, unspecified", "usage": "secondary trigger — often coded alongside O99.01x", "grouping": "anemia-etiology"},
    ],
}

# ── §2 stages ────────────────────────────────────────────────────────
N("stage-1", "Stage", stage_number=1, title="Diagnosis Confirmation & Classification",
  description="Confirm the coded anemia diagnosis against trimester criteria, classify by MCV, confirm iron deficiency by ferritin, and work up nonresponders. Entry stage — screening is upstream of this pathway.")
N("stage-2", "Stage", stage_number=2, title="Iron Deficiency Treatment",
  description="Oral iron first line with counseling, response assessment at 4 weeks, IV iron escalation after the first trimester.")
N("stage-3", "Stage", stage_number=3, title="Special Populations & Escalations",
  description="Every step in this stage is gated: route-outs (SCD, thalassemia syndromes, CKD), in-pathway modifications (trait carriers, bariatric, IBD, multifetal, transfusion decliners), and severity escalations (transfusion consideration, specialist referral).")
N("stage-4", "Stage", stage_number=4, title="Late-Pregnancy Optimization & Handoff",
  description="Predelivery optimization tied to the hemorrhage bundle, delivery route planning, postpartum handoff.")
E("root", "stage-1", "HAS_STAGE"); E("root", "stage-3", "HAS_STAGE"); E("root", "stage-4", "HAS_STAGE")
# stage-2 is branch-entry only (gate-ida-confirmed / DP-1)

# ── §3 steps ────────────────────────────────────────────────────────
def step(sid, sn, pn, title, desc, attach=None):
    N(sid, "Step", stage_number=sn, step_number=pn, display_number=f"{sn}.{pn}", title=title, description=desc)
    if attach: E(attach, sid, "HAS_STEP")

step("step-1-1", 1, 1, "Diagnosis confirmation & evaluation",
     "History & physical. Review the triggering CBC against trimester criteria: Hgb <11.0 g/dL / Hct <33% in first and third trimesters, Hgb <10.5 g/dL / Hct <32% in second (CDC trimester definitions: T1 0–13 wk, T2 14–26, T3 27–40). Risk-factor review: parity >2, short interpregnancy interval, low-iron diet, pica. Urgent-symptom safety-netting.", "stage-1")
step("step-1-2", 1, 2, "Microcytic workup",
     "Ferritin (± iron/TIBC/saturation). Ferritin <30 ng/mL confirms iron deficiency anemia; transferrin saturation <18% with high TIBC and low ferritin = IDA; all-normal iron studies suggest thalassemia — proceed to expanded workup.")
step("step-1-3", 1, 3, "Normocytic workup",
     "Ferritin (early iron deficiency), reticulocyte count, peripheral smear as directed.")
step("step-1-4", 1, 4, "Macrocytic workup & repletion",
     "Serum folate and vitamin B12 (MCV >115 fL is almost exclusively folate or B12 deficiency). Treat identified deficiency: folic acid 1 mg PO daily; B12 1,000 mcg IM monthly (ACOG regimen specified for total gastrectomy).")
step("step-1-5", 1, 5, "Expanded / nonresponse workup",
     "Peripheral smear; hemoglobin analysis and genetic testing per indices and personal/family history; malabsorption review (enteric-coated tablets, antacids, bariatric anatomy); blood-loss review.")
step("step-1-6", 1, 6, "Hemoglobinopathy testing",
     "Hemoglobin electrophoresis or molecular testing when no prior results are available for interpretation (ACOG universal-offer). Carrier result → offer partner testing; both partners carriers → genetic counseling referral.")

step("step-2-1", 2, 1, "Initiate oral iron + counseling",
     "Therapeutic oral iron in addition to the prenatal vitamin (the PNV's 27 mg prophylactic iron is not treatment dosing). Avoid enteric-coated/sustained-release preparations. Dietary and adherence guidance attached to this step.", "stage-2")
step("step-2-2", 2, 2, "Oral iron trial period",
     "Expected reticulocytosis 7–10 days after initiation; optional reticulocyte check.", "stage-2")
step("step-2-3", 2, 3, "Response assessment",
     "Hgb recheck ~4 weeks after initiation (CDC interval; ACOG gives no numeric interval). Adequate response = Hgb rise >1 g/dL.", "stage-2")
step("step-2-4", 2, 4, "Maintenance & surveillance",
     "Continue iron; reduce to prophylactic dosing when Hgb/Hct normalize for gestational stage (CDC).")
step("step-2-5", 2, 5, "IV iron therapy",
     "For oral intolerance, nonresponse, or severe iron deficiency later in pregnancy; use after the first trimester. Single-total-dose formulations preferred (ferric derisomaltose, ferric carboxymaltose, LMW iron dextran).")

step("step-3-1", 3, 1, "Sickle cell disease: route out",
     "MFM + hematology multidisciplinary track (SMFM). Prenatal vitamins WITHOUT iron unless iron deficiency is confirmed, plus folic acid 4 mg daily (GRADE 1B). This pathway's iron arm is affirmatively wrong for SCD.")
step("step-3-2", 3, 2, "Thalassemia syndrome: route out",
     "Hematology/MFM specialist track (BSH guideline; no US equivalent exists).")
step("step-3-3", 3, 3, "Trait carriers (SCT / thalassemia minor)",
     "Stay in-pathway with modifications: iron only with ferritin-confirmed deficiency (thalassemia trait shows normal iron studies); partner testing; genetics referral if both partners are carriers.")
step("step-3-4", 3, 4, "Bariatric surgery history",
     "Micronutrient panel at entry; iron studies every trimester; low threshold for direct-to-IV iron — bypass procedures disrupt duodenal iron absorption (AGA BPA 7).")
step("step-3-5", 3, 5, "Inflammatory bowel disease",
     "IV-iron-first when active inflammation is present (AGA BPA 9); GI co-management; quiescent disease may use the oral arm at clinician discretion.")
step("step-3-6", 3, 6, "Transfusion consideration",
     "Hgb <6 g/dL: consider transfusion for fetal indications (abnormal fetal oxygenation association). Requires verified type & screen / crossmatch.")
step("step-3-7", 3, 7, "Specialist referral",
     "Hgb <9.0 g/dL or Hct <27%: refer to a physician familiar with anemia in pregnancy (CDC/IOM rule; ACOG names no numeric referral threshold).")
step("step-3-8", 3, 8, "Multifetal gestation surveillance",
     "IDA risk 2.4–4× singleton. Supplement beyond the PNV, earlier ferritin, earlier response recheck.")
step("step-3-9", 3, 9, "CKD co-management: route out",
     "Anemia-of-CKD track: ferritin target ~100 ng/mL, ESA logic, nephrology co-management — this pathway's thresholds and oral-iron default do not apply.")
step("step-3-10", 3, 10, "Transfusion-decliner optimization",
     "Identify early; document exactly which products/fractions are acceptable. Aggressive IV-iron-first repletion; ESA with parenteral iron per PB 233 evidence; minimize phlebotomy; anesthesia/MFM delivery planning.")

step("step-4-1", 4, 1, "Predelivery optimization",
     "Aggressively treat severe anemia before delivery. Verify prenatal type & antibody screen is documented. Hct <30 plus any other hemorrhage risk factor ⇒ high-risk tier: type & crossmatch 2 units PRBCs and notify OB anesthesia (CMQCC).", "stage-4")
step("step-4-2", 4, 2, "Delivery planning route selection",
     "Select the repletion route for the remaining time to delivery (hosts the predelivery decision point).", "stage-4")
step("step-4-3", 4, 3, "Postpartum handoff",
     "Postpartum Hgb recheck (6-week evidence timepoint). Continue iron at least 3 months or 6 weeks postpartum, whichever is longer (FIGO). IV iron is an option postpartum. Communicate anemia status on transition to postpartum care.", "stage-4")

# ── §4 decision points ──────────────────────────────────────────────
N("dp-1", "DecisionPoint", title="Empiric iron vs confirmatory studies first", branch_mode="one_of",
  description="ACOG: in patients without evidence of causes other than iron deficiency, it may be reasonable to empirically initiate iron therapy without first obtaining iron test results. Clinical judgment — not machine-evaluable.")
E("step-1-1", "dp-1", "HAS_DECISION_POINT")
N("crit-1a", "Criterion", description="No evidence of causes of anemia other than iron deficiency — empiric oral iron without iron studies is reasonable (ACOG).")
N("crit-1b", "Criterion", description="Atypical features, uncertain etiology, or confirmation preferred — obtain ferritin/iron studies first.")
E("dp-1", "crit-1a", "HAS_CRITERION"); E("dp-1", "crit-1b", "HAS_CRITERION")
E("crit-1a", "step-2-1", "SELECTS_BRANCH"); E("crit-1b", "step-1-2", "SELECTS_BRANCH")
E("dp-1", "step-2-1", "BRANCHES_TO"); E("dp-1", "step-1-2", "BRANCHES_TO")

N("dp-2", "DecisionPoint", title="Nonresponse management", branch_mode="one_of",
  description="Failure to respond to iron therapy should prompt further investigation: incorrect diagnosis, coexisting disease, malabsorption, nonadherence, or blood loss (ACOG Level C).")
E("step-2-3", "dp-2", "HAS_DECISION_POINT")
N("crit-2a", "Criterion", description="Intolerance or nonadherence despite coaching — escalate to IV iron.")
N("crit-2b", "Criterion", description="Suspected malabsorption (enteric-coated tablets, antacids, bariatric anatomy, IBD) — escalate to IV iron.")
N("crit-2c", "Criterion", description="Suspected incorrect diagnosis or ongoing blood loss — expanded workup.")
E("dp-2", "crit-2a", "HAS_CRITERION"); E("dp-2", "crit-2b", "HAS_CRITERION"); E("dp-2", "crit-2c", "HAS_CRITERION")
E("crit-2a", "step-2-5", "SELECTS_BRANCH"); E("crit-2b", "step-2-5", "SELECTS_BRANCH"); E("crit-2c", "step-1-5", "SELECTS_BRANCH")
E("dp-2", "step-2-5", "BRANCHES_TO"); E("dp-2", "step-1-5", "BRANCHES_TO")

N("dp-3", "DecisionPoint", title="Predelivery route selection", branch_mode="one_of",
  description="Route choice driven by time remaining to delivery. FIGO time-math (IV iron when IDA is within ~4–6 weeks of anticipated childbirth) supplements ACOG's 'severe iron deficiency later in pregnancy'.")
E("step-4-2", "dp-3", "HAS_DECISION_POINT")
N("crit-3a", "Criterion", description="Adequate time for oral repletion and patient is responding — continue oral iron and surveillance.")
N("crit-3b", "Criterion", description="Moderate–severe IDA within ~4–6 weeks of anticipated delivery, or oral failure near term — IV iron.")
E("dp-3", "crit-3a", "HAS_CRITERION"); E("dp-3", "crit-3b", "HAS_CRITERION")
E("crit-3a", "step-2-4", "SELECTS_BRANCH"); E("crit-3b", "step-2-5", "SELECTS_BRANCH")
E("dp-3", "step-2-4", "BRANCHES_TO"); E("dp-3", "step-2-5", "BRANCHES_TO")

# ── §4b gates (17) — temporal keys per §17 ──────────────────────────
def gate(gid, title, gtype, default, attach, targets, **props):
    N(gid, "Gate", title=title, gate_type=gtype, default_behavior=default, **props)
    E(attach, gid, "HAS_GATE")
    for t in targets: E(gid, t, "BRANCHES_TO")

gate("gate-microcytic", "MCV < 80 (microcytic)", "patient_attribute", "skip", "step-1-1", ["step-1-2"],
     condition={"field": "labs", "operator": "less_than", "value": "787-2", "system": "LOINC", "threshold": 80, "horizon": H90})
gate("gate-normocytic", "MCV 80–100 (normocytic)", "compound", "skip", "step-1-1", ["step-1-3"],
     operator="AND", conditions=[
        {"field": "labs", "operator": "greater_than", "value": "787-2", "system": "LOINC", "threshold": 79.9, "horizon": H90,
         "note": "Band boundary: coded operators lack >=, strict comparison at 0.1 fL resolution"},
        {"field": "labs", "operator": "less_than", "value": "787-2", "system": "LOINC", "threshold": 100.1, "horizon": H90}])
gate("gate-macrocytic", "MCV > 100 (macrocytic)", "patient_attribute", "skip", "step-1-1", ["step-1-4"],
     condition={"field": "labs", "operator": "greater_than", "value": "787-2", "system": "LOINC", "threshold": 100, "horizon": H90})
gate("gate-hgbpathy-needed", "Hemoglobinopathy testing needed?", "question", "skip", "step-1-1", ["step-1-6"],
     prompt="Is hemoglobinopathy testing needed — i.e., no prior hemoglobinopathy test results are available for interpretation?",
     answer_type="BOOLEAN")
gate("gate-ida-confirmed", "Ferritin confirms iron deficiency", "patient_attribute", "traverse", "step-1-2", ["stage-2"],
     condition={"field": "labs", "operator": "less_than", "value": "2276-4", "system": "LOINC", "threshold": 30, "horizon": H90,
                "note": "ACOG confirmatory cutoff; WHO uses <15; USPSTF notes no consensus. Default traverse: empiric iron is guideline-sanctioned when ferritin is absent."})
gate("gate-hgb-response", "Hgb rise ≥1 g/dL on therapy", "patient_attribute", "skip", "step-2-3", ["step-2-4"],
     condition={"field": "labs", "operator": "delta_from_baseline", "value": "718-7", "system": "LOINC",
                "delta_threshold": 1.0, "window_days": 42, "min_points": 2,
                "note": "ACOG response definition; 42-day window spans initiation to 4-week recheck with margin."})
gate("gate-iv-iron-ga", "Beyond first trimester?", "question", "skip", "dp-2", ["step-2-5"],
     prompt="Is the patient beyond the first trimester (≥14 0/7 weeks gestation)?",
     answer_type="BOOLEAN")
gate("gate-severe-anemia", "Severe anemia (transfusion consideration)", "patient_attribute", "skip", "stage-3", ["step-3-6"],
     condition={"field": "labs", "operator": "less_than", "value": "718-7", "system": "LOINC", "threshold": 6, "horizon": {"days": 7}})
gate("gate-referral-threshold", "Referral-level anemia", "compound", "skip", "stage-3", ["step-3-7"],
     operator="OR", conditions=[
        {"field": "labs", "operator": "less_than", "value": "718-7", "system": "LOINC", "threshold": 9, "horizon": H90},
        {"field": "labs", "operator": "less_than", "value": "4544-3", "system": "LOINC", "threshold": 27, "horizon": H90}])

def coded(v, horizon="LIFETIME", status="any"):
    return {"field": "conditions", "operator": "includes_code", "value": v, "system": "ICD-10",
            "horizon": horizon, "status": status}

gate("gate-scd", "Sickle cell disease (route out)", "compound", "skip", "stage-3", ["step-3-1"],
     operator="OR", conditions=[coded(v) for v in ["D57.0*", "D57.1", "D57.2*", "D57.4*", "D57.8*"]])
gate("gate-thal-major", "Thalassemia syndrome (route out)", "compound", "skip", "stage-3", ["step-3-2"],
     operator="OR", conditions=[coded(v) for v in ["D56.0", "D56.1", "D56.2", "D56.5", "D56.8", "D56.9"]])
gate("gate-trait", "Trait carrier (in-pathway modifications)", "compound", "skip", "stage-3", ["step-3-3"],
     operator="OR", conditions=[coded("D57.3"), coded("D56.3")])
gate("gate-bariatric", "Bariatric surgery history", "compound", "skip", "stage-3", ["step-3-4"],
     operator="OR", conditions=[coded("Z98.84"), coded("O99.84*")])
gate("gate-ibd", "Inflammatory bowel disease", "compound", "skip", "stage-3", ["step-3-5"],
     operator="OR", conditions=[coded("K50.*"), coded("K51.*")])
gate("gate-multi-gestation", "Multiple gestation", "patient_attribute", "skip", "stage-3", ["step-3-8"],
     condition=coded("O30.*", horizon={"days": 300}, status="active"))
gate("gate-ckd", "Chronic kidney disease (route out)", "compound", "skip", "stage-3", ["step-3-9"],
     operator="OR", conditions=[coded(v, status="active") for v in ["N18.3*", "N18.4", "N18.5", "N18.6", "O26.83*"]])
gate("gate-transfusion-refusal", "Transfusion decliner", "question", "skip", "stage-3", ["step-3-10"],
     prompt="Does the patient decline blood transfusion or specific blood products (e.g., for religious reasons)?",
     answer_type="BOOLEAN")

# ── §5 medications ──────────────────────────────────────────────────
def med(mid, name, role, host, clinical_role=None, **props):
    p = {"name": name, "role": role, **props}
    if clinical_role: p["clinical_role"] = clinical_role
    N(mid, "Medication", **p)
    E(host, mid, "USES_MEDICATION")

med("med-1", "Ferrous sulfate 325 mg (65 mg elemental iron)", "first_line", "step-2-1", "oral-iron-repletion",
    dose="325 mg (65 mg elemental iron)", frequency="once daily (to BID per clinician); alternate-day dosing is an evidence-based tolerability option — not an ACOG mandate", route="oral",
    instructions="Empty stomach preferred, small snack if GI upset; separate from calcium/antacids/tea/coffee by ≥2 h; vitamin C co-administration optional (RCT equivalence).")
med("med-2", "Ferrous gluconate 300–324 mg (34–38 mg elemental)", "alternative", "step-2-1", "oral-iron-repletion",
    route="oral", instructions="Lower elemental dose, gentler GI profile.")
med("med-3", "Ferrous fumarate 324–325 mg (106 mg elemental)", "alternative", "step-2-1", "oral-iron-repletion",
    route="oral", instructions="Highest elemental content per tablet.")
med("med-10", "Docusate sodium 100 mg", "acceptable", "step-2-1",
    route="oral", instructions="Stool softener for iron-induced constipation (non-conflicting adjunct).")
med("med-11", "Enteric-coated / sustained-release iron preparations", "avoid", "step-2-1", "oral-iron-repletion",
    instructions="Dissolve poorly and may be less effective (ACOG).")
med("med-4", "Iron sucrose (Venofer)", "second_line", "step-2-5", "iv-iron-repletion",
    dose="200 mg IV per session × 5 within 14 days (~1,000 mg total)", route="IV",
    instructions="Label indication is CKD — pregnancy use off-label; multiple visits; historically most-used in pregnancy.")
med("med-5", "Ferric derisomaltose (Monoferric)", "second_line", "step-2-5", "iv-iron-repletion",
    dose="1,000 mg IV single dose over ≥20 min (≥50 kg; 20 mg/kg if <50 kg)", route="IV",
    instructions="Single-visit total replacement preferred (ASH); hypophosphatemia 3.5%.")
med("med-6", "Ferric carboxymaltose (Injectafer)", "second_line", "step-2-5", "iv-iron-repletion",
    dose="750 mg × 2 doses ≥7 days apart (total 1,500 mg), or single 15 mg/kg up to 1,000 mg", route="IV",
    instructions="Symptomatic hypophosphatemia 2.1%, osteomalacia postmarketing — check phosphate on repeat courses.")
med("med-7", "Low-molecular-weight iron dextran (INFeD)", "acceptable", "step-2-5", "iv-iron-repletion",
    dose="Total-dose by label formula", route="IV",
    instructions="BOXED WARNING anaphylaxis; mandatory 25 mg test dose; single-visit total-dose infusion exceeds the 100 mg/day label — flag for local policy.")
med("med-8", "Folic acid 1 mg daily", "first_line", "step-1-4", "folate-repletion",
    dose="1 mg", frequency="daily", route="oral",
    instructions="For folate-deficiency macrocytic anemia (dominant macrocytic cause in US pregnancy).")
med("med-9", "Cyanocobalamin (vitamin B12) 1,000 mcg IM monthly", "first_line", "step-1-4", "b12-repletion",
    dose="1,000 mcg", frequency="monthly", route="IM",
    instructions="ACOG regimen specified for total gastrectomy; no general oral high-dose regimen in fetched sources.")
med("med-12", "Epoetin alfa", "acceptable", "step-3-10", "esa-erythropoiesis",
    instructions="Restricted context: transfusion-decliner optimization with parenteral iron (RCT: shortened time-to-target Hgb; not recommended for routine anemia).")
E("med-1", "med-5", "ESCALATES_TO")

# ── §6 labs ─────────────────────────────────────────────────────────
def lab(lid, name, hosts, **props):
    N(lid, "LabTest", name=name, **props)
    for h in hosts: E(h, lid, "HAS_LAB_TEST")

lab("lab-1", "CBC with indices", ["step-1-1", "step-2-3"], code="58410-2", system="LOINC", specimen="venous blood")
lab("lab-2", "Ferritin, serum", ["step-1-2", "step-1-3"], code="2276-4", system="LOINC", specimen="serum")
lab("lab-3", "Iron + TIBC + transferrin saturation", ["step-1-2"], code="2498-4", system="LOINC", specimen="serum")
lab("lab-4", "Reticulocyte count", ["step-1-3", "step-2-2"], code="4679-7", system="LOINC", specimen="venous blood")
lab("lab-5", "Vitamin B12, serum", ["step-1-4"], code="2132-9", system="LOINC", specimen="serum")
lab("lab-6", "Folate, serum", ["step-1-4"], code="2284-8", system="LOINC", specimen="serum")
lab("lab-7", "Hemoglobin electrophoresis", ["step-1-5", "step-1-6"], code="43113-0", system="LOINC", specimen="venous blood")
lab("lab-8", "Peripheral blood smear (morphology review)", ["step-1-3", "step-1-5"], code="34994-4", system="LOINC", specimen="venous blood")
lab("lab-9", "Type and antibody screen", ["step-4-1"], code="882-1", system="LOINC", specimen="venous blood")

# ── §8 procedures ───────────────────────────────────────────────────
N("proc-1", "Procedure", name="RBC transfusion", code="36430", system="CPT")
E("step-3-6", "proc-1", "HAS_PROCEDURE")

# ── §9 guidance ─────────────────────────────────────────────────────
def guid(gid, topic, category, host, instructions):
    N(gid, "Guidance", topic=topic, instructions=instructions, category=category)
    E(host, gid, "HAS_GUIDANCE")

guid("guid-1", "Eating for iron", "education", "step-2-1",
     "During pregnancy your body needs 27 mg of iron a day. Iron from animal foods (heme iron) is absorbed best: lean beef, turkey, chicken, shrimp, and cooked clams or oysters (liver is very rich but keep portions occasional in pregnancy). Plant sources count too: iron-fortified cereals, white and kidney beans, lentils, peas, spinach, nuts, and raisins. Your body absorbs plant iron better when you eat it with meat, poultry, seafood, or a vitamin C food — orange juice, grapefruit, strawberries, tomatoes, sweet peppers, or broccoli — in the same meal.")
guid("guid-2", "What blocks iron", "education", "step-2-1",
     "Coffee and tea, milk and other dairy, calcium supplements, soy products, and antacids all reduce iron absorption. You don't need to give them up — keep them about 2 hours away from your iron-focused meals and your iron pill. If you take a calcium supplement or calcium-containing antacid, take it at a different time of day than your iron.")
guid("guid-3", "Plant-based iron plan", "education", "step-2-1",
     "You can meet pregnancy iron needs without meat, but plant iron is absorbed at roughly half the rate of a mixed diet (about 5–12% vs 14–18%). Build each meal around an iron source — fortified cereal, lentils, beans, tofu, spinach, nuts — and pair it with a vitamin C food in the same sitting. Keep tea, coffee, and dairy between meals. Take your prenatal vitamin daily, and tell your care team you eat plant-based so they can watch your labs more closely.")
guid("guid-4", "Making your iron pill work", "adherence", "step-2-1",
     "Take your iron in the morning, ideally on an empty stomach with orange juice or vitamin C. If it upsets your stomach, take it with a small snack — much better than skipping. Keep it 2 hours from milk, calcium, antacids, coffee, and tea. Dark green or black stools are normal. For constipation: more water, fiber at meals (not at pill time), stay active, and a stool softener like docusate is safe to ask about. If daily iron is making you miserable, don't quietly stop — tell us; a planned every-other-morning schedule can be absorbed as well as daily with fewer side effects (your gut makes a gatekeeper hormone, hepcidin, after each dose that blocks absorption for about a day). Blood counts respond slowly: new red cells in 1–2 weeks, hemoglobin over the following weeks — keep going and keep your lab recheck.")
guid("guid-5", "When to call us right away", "safety-netting", "step-1-1",
     "Mild tiredness is common with anemia, but call immediately — or go to the emergency room if you can't reach us — for: chest pain, tightness, or pressure, or pain spreading to your back, neck, or arm; a racing, pounding, or irregular heartbeat; trouble catching your breath or needing to prop up on pillows to breathe; fainting, or dizziness that keeps coming back; or exhaustion so severe no sleep refreshes you. Always say that you are pregnant. Also tell us at any visit — no judgment — if you crave and chew ice, or crave nonfood things like clay, dirt, laundry starch, paper, or paint chips: these cravings (pica) are a classic sign of low iron, and treating the iron deficiency usually makes them fade.")

# ── §10 quality metrics ─────────────────────────────────────────────
N("qm-1", "QualityMetric", name="Timely treatment-response assessment",
  measure="Numerator: patients started on iron therapy in this pathway with an Hgb recheck resulted within 6 weeks of initiation. Denominator: patients started on iron therapy in this pathway. Steward: local (derived from the CDC 4-week recheck with scheduling margin).")
E("step-2-3", "qm-1", "HAS_QUALITY_METRIC")
N("qm-2", "QualityMetric", name="Hemorrhage risk assessment with anemia input",
  measure="AIM HEM P3: birth admissions with a hemorrhage risk assessment completed and risk level assigned at least once between admission and birth (anemia is a scored factor in the underlying CMQCC tool). Steward: AIM/ACOG.")
E("step-4-1", "qm-2", "HAS_QUALITY_METRIC")

# ── §11 schedules ───────────────────────────────────────────────────
def sched(sid, host, interval, description):
    N(sid, "Schedule", interval=interval, description=description)
    E(host, sid, "HAS_SCHEDULE")

sched("sched-1", "step-2-2", "7–10 days after starting iron (optional)",
      "Reticulocyte check; absent reticulocytosis raises early nonresponse suspicion.")
sched("sched-2", "step-2-3", "4 weeks after starting oral iron",
      "Hgb/Hct recheck; rise ≤1 g/dL despite adherence routes to nonresponse management (CDC interval; FIGO 2-week variant noted).")
sched("sched-3", "step-2-5", "~4 weeks after IV iron",
      "Hgb recheck; persistent anemia → hematology referral / re-evaluate diagnosis. No formal US interval — evidence timepoint.")
sched("sched-4", "step-4-1", "From diagnosis through delivery",
      "Predelivery optimization checks; oral failure near term → IV iron per the delivery-planning decision point.")
sched("sched-5", "step-4-3", "Once, ~6 weeks postpartum",
      "Hgb recheck + iron continuation; symptomatic or severe postpartum anemia → IV iron or transfusion pathway.")

# ── §12 REQUIRES ────────────────────────────────────────────────────
E("step-2-1", "step-1-1", "REQUIRES")
E("step-2-3", "step-2-1", "REQUIRES")
E("step-2-5", "step-2-2", "REQUIRES")
E("step-3-6", "step-4-1", "REQUIRES")
E("step-4-3", "step-4-1", "REQUIRES")

# ── §13 code entries ────────────────────────────────────────────────
def code(system, c, desc, host):
    cid = f"code-{system.lower().replace('-','')}-{c.lower().replace('.','-')}"
    N(cid, "CodeEntry", system=system, code=c, description=desc)
    E(host, cid, "HAS_CODE")

code("LOINC", "58410-2", "CBC panel, automated", "lab-1")
code("LOINC", "718-7", "Hemoglobin [Mass/Vol] blood", "lab-1")
code("LOINC", "4544-3", "Hematocrit, automated", "lab-1")
code("LOINC", "787-2", "MCV, RBC", "lab-1")
code("LOINC", "2276-4", "Ferritin, serum", "lab-2")
code("LOINC", "2498-4", "Iron, serum", "lab-3")
code("LOINC", "2500-7", "TIBC", "lab-3")
code("LOINC", "2502-3", "Iron saturation", "lab-3")
code("LOINC", "4679-7", "Reticulocytes/100 RBC", "lab-4")
code("LOINC", "2132-9", "Vitamin B12, serum", "lab-5")
code("LOINC", "2284-8", "Folate, serum", "lab-6")
code("LOINC", "43113-0", "Hemoglobinopathy electrophoresis panel", "lab-7")
code("LOINC", "34994-4", "Smear morphology panel, blood", "lab-8")
code("LOINC", "882-1", "ABO+Rh type", "lab-9")
code("LOINC", "890-4", "RBC antibody screen", "lab-9")
code("CPT", "85025", "CBC with automated differential", "lab-1")
code("CPT", "82728", "Ferritin", "lab-2")
code("CPT", "83540", "Iron", "lab-3")
code("CPT", "83550", "TIBC", "lab-3")
code("CPT", "85045", "Reticulocytes, automated", "lab-4")
code("CPT", "82607", "Vitamin B12", "lab-5")
code("CPT", "82746", "Folate, serum", "lab-6")
code("CPT", "83020", "Hemoglobin electrophoresis (83021 if HPLC method)", "lab-7")
code("CPT", "36430", "Transfusion, blood or components", "proc-1")
code("RXNORM", "310325", "ferrous sulfate 325 mg tablet", "med-1")
code("RXNORM", "198630", "ferrous gluconate 324 mg tablet", "med-2")
code("RXNORM", "284202", "ferrous fumarate 324 mg tablet", "med-3")
code("RXNORM", "1741261", "iron sucrose 20 mg/mL injection", "med-4")
code("RXNORM", "2274409", "ferric derisomaltose 1,000 mg/10 mL [Monoferric]", "med-5")
code("RXNORM", "1435169", "ferric carboxymaltose 750 mg/15 mL", "med-6")
code("RXNORM", "206216", "iron-dextran 50 mg/mL [INFeD]", "med-7")
code("RXNORM", "310410", "folic acid 1 mg tablet", "med-8")
code("RXNORM", "309594", "cyanocobalamin 1 mg/mL injection", "med-9")
code("ICD-10", "Z98.84", "Bariatric surgery status (gate-captured; attached to branch-target step)", "step-3-4")
code("ICD-10", "D57.3", "Sickle cell trait (gate-captured)", "step-3-3")
code("ICD-10", "D56.3", "Thalassemia minor (gate-captured)", "step-3-3")
code("ICD-10", "O09.40", "Supervision of pregnancy with grand multiparity, unspecified trimester (risk-factor flag)", "step-1-1")

# ── §15 evidence citations ──────────────────────────────────────────
EVS = [
    (1, "Anemia in Pregnancy: ACOG Practice Bulletin, Number 233 (Interim Update)", "Level B", "ACOG — Obstetrics & Gynecology 138:e55–64", 2021, "https://pubmed.ncbi.nlm.nih.gov/34293770/"),
    (2, "Screening and Supplementation for Iron Deficiency and Iron Deficiency Anemia During Pregnancy: USPSTF Recommendation Statement", "Expert Consensus", "USPSTF — JAMA 332(11):906–913", 2024, "https://www.uspreventiveservicestaskforce.org/uspstf/recommendation/iron-deficiency-anemia-in-pregnant-women-screening-and-supplementation"),
    (3, "Recommendations to Prevent and Control Iron Deficiency in the United States (via contemporaneous AAFP summary)", "Expert Consensus", "CDC — MMWR 47(RR-3)", 1998, "https://www.aafp.org/pubs/afp/issues/1998/1015/p1475.html"),
    (4, "Hemoglobinopathies in Pregnancy — Practice Advisory", "Expert Consensus", "ACOG", 2022, "https://www.acog.org/clinical/clinical-guidance/practice-advisory/articles/2022/08/hemoglobinopathies-in-pregnancy"),
    (5, "Identifying and treating iron deficiency anemia in pregnancy", "Expert Consensus", "Lewkowitz & Tuuli — Hematology (ASH Education Program) 2023(1):223–228", 2023, "https://pmc.ncbi.nlm.nih.gov/articles/PMC10727057/"),
    (6, "FIGO good practice recommendations on anemia in pregnancy", "Expert Consensus", "Ubom et al. — Int J Gynecol Obstet 171:993–1007 [international fallback]", 2025, "https://pmc.ncbi.nlm.nih.gov/articles/PMC12640178/"),
    (7, "SMFM Consult Series #68: Sickle cell disease in pregnancy", "Level B", "SMFM — Am J Obstet Gynecol 230(2):B17–B40", 2024, "https://publications.smfm.org/publications/547-society-for-maternal-fetal-medicine-consult-series-68/"),
    (8, "AGA Clinical Practice Update on Management of Iron Deficiency Anemia: Expert Review", "Expert Consensus", "American Gastroenterological Association — Clin Gastroenterol Hepatol", 2024, "https://pubmed.ncbi.nlm.nih.gov/38864796/"),
    (9, "Obstetric Hemorrhage Change Package", "Expert Consensus", "IHI/AIM (© ACOG)", 2022, "https://saferbirth.org/wp-content/uploads/2025_HEM_Change-Package.pdf"),
    (10, "Urgent Maternal Warning Signs", "Expert Consensus", "ACOG/AIM", 2024, "https://saferbirth.org/wp-content/uploads/UrgentMaternalWarningSigns_expanded.pdf"),
    (11, "Obstetric Hemorrhage Care Guidelines: Checklist Format v1.4", "Expert Consensus", "CMQCC (third-party mirror; toolkit now V3.0)", 2009, "https://tuohytime.com/wp-content/uploads/2024/07/hemorrhageprotocolchecklist_cmqcc.pdf"),
    (12, "Iron — Fact Sheet for Health Professionals", "Expert Consensus", "NIH Office of Dietary Supplements", 2026, "https://ods.od.nih.gov/factsheets/Iron-HealthProfessional/"),
    (13, "Taking iron supplements (MedlinePlus Medical Encyclopedia)", "Expert Consensus", "MedlinePlus/NLM", 2026, "https://medlineplus.gov/ency/article/007478.htm"),
    (14, "Iron absorption from oral iron supplements given on consecutive versus alternate days", "Level B", "Stoffel et al. — Lancet Haematology 4(11):e524–e533 (non-pregnant women)", 2017, "https://pubmed.ncbi.nlm.nih.gov/29032957/"),
    (15, "The Efficacy and Safety of Vitamin C for Iron Supplementation in Adult Patients With Iron Deficiency Anemia", "Level B", "Li et al. — JAMA Network Open (RCT, non-pregnant)", 2020, "https://pubmed.ncbi.nlm.nih.gov/33136134/"),
    (16, "Guideline for the management of conception and pregnancy in thalassaemia syndromes: A British Society for Haematology Guideline", "Level A", "BSH — Br J Haematol 204(6):2194–2209 [international fallback]", 2024, "https://onlinelibrary.wiley.com/doi/10.1111/bjh.19362"),
    (17, "Management of Anemia and/or Bleeding in Patients Who Will Not Accept Blood Products", "Expert Consensus", "Michigan Medicine clinical guideline (NCBI Bookshelf NBK614548)", 2024, "https://www.ncbi.nlm.nih.gov/books/NBK614548/"),
    (18, "Pregnancy after bariatric surgery: Consensus recommendations for periconception, antenatal and postnatal care", "Expert Consensus", "Shawe et al. — Obesity Reviews", 2019, "https://pmc.ncbi.nlm.nih.gov/articles/PMC6852078/"),
    (19, "Bariatric Surgery and Pregnancy: ACOG Practice Bulletin No. 105 (verified via ObG Project restatement)", "Level C", "ACOG", 2009, "https://www.obgproject.com/2022/06/02/bariatric-surgery-and-pregnancy/"),
    (20, "Hepcidin, ferroportin, and hemoglobin as predictors of iron deficiency anemia risk and perinatal outcomes in twin pregnancy", "Level C", "Frontiers in Medicine (cohort)", 2025, "https://pmc.ncbi.nlm.nih.gov/articles/PMC12682790/"),
    (21, "Ironing Out the Details: How to Manage Anemia in Pregnancy in Women Living With CKD", "Expert Consensus", "Kidney International Reports [scope-out rationale]", 2024, "https://pmc.ncbi.nlm.nih.gov/articles/PMC11069003/"),
    (22, "FDA Prescribing Information via DailyMed: Venofer, Injectafer, Monoferric, INFeD", "Expert Consensus", "FDA/NLM DailyMed", 2026, "https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=55859d2d-0456-4fa9-b41f-f535accc97db"),
]
for n, title, lvl, src, yr, url in EVS:
    N(f"ev-{n}", "EvidenceCitation", reference_number=n, title=title, evidence_level=lvl, source=src, year=yr, url=url)

# ── §16 citation map (gate/QM/sched evidence reattached to hosts) ───
CITES = {
    "stage-1": [1, 4], "stage-2": [1, 5],
    "stage-3": [1, 3, 4, 7, 8, 16, 17, 19, 20, 21],  # own [1,7,8] + attached-gate refs
    "stage-4": [1, 9, 11],
    "step-1-1": [1, 2, 3, 10, 4],   # own + gate-hgbpathy [4]; MCV gates [1] already present
    "step-1-2": [1, 5, 2],          # own + gate-ida [2]
    "step-1-3": [1], "step-1-4": [1], "step-1-5": [1, 4], "step-1-6": [4],
    "step-2-1": [1, 5, 13, 14],
    "step-2-2": [1],
    "step-2-3": [1, 3],             # own + gate-hgb-response [1,3] + QM-1 [1,3] + sched-2 (dedup)
    "step-2-4": [3],
    "step-2-5": [1, 5, 7, 22],
    "step-3-1": [7], "step-3-2": [16], "step-3-3": [1, 4, 7], "step-3-4": [8, 18, 19],
    "step-3-5": [8], "step-3-6": [1, 11], "step-3-7": [3], "step-3-8": [1, 20],
    "step-3-9": [21], "step-3-10": [1, 17],
    "step-4-1": [9, 11], "step-4-2": [1, 6], "step-4-3": [1, 6, 9],
    "dp-1": [1], "crit-1a": [1], "crit-1b": [1],
    "dp-2": [1, 5],                 # own + gate-iv-iron-ga [1,5]
    "crit-2a": [1, 5], "crit-2b": [1, 8], "crit-2c": [1],
    "dp-3": [1, 6], "crit-3a": [1], "crit-3b": [6, 1],
    "med-1": [1, 5, 13, 14, 15], "med-2": [1], "med-3": [1],
    "med-4": [5, 22], "med-5": [5, 22], "med-6": [5, 22], "med-7": [5, 22],
    "med-8": [1], "med-9": [1], "med-10": [13], "med-11": [1], "med-12": [1, 17],
    "lab-1": [1], "lab-2": [1, 5], "lab-3": [1], "lab-4": [1], "lab-5": [1],
    "lab-6": [1], "lab-7": [4], "lab-8": [1], "lab-9": [11],
    "proc-1": [1, 11],
    "guid-1": [1, 12], "guid-2": [1, 12, 13], "guid-3": [1, 12],
    "guid-4": [5, 13, 14], "guid-5": [1, 10],
}
for src, refs in CITES.items():
    for r in sorted(set(refs)):
        E(src, f"ev-{r}", "CITES_EVIDENCE")

out = {"schema_version": "1.0", "pathway": pathway, "nodes": nodes, "edges": edges}
path = "pathways/json/anemia-in-pregnancy.json"
with open(path, "w") as f:
    json.dump(out, f, indent=2, ensure_ascii=False)
print(f"wrote {path}: {len(nodes)} nodes, {len(edges)} edges")
from collections import Counter
print(Counter(n["type"] for n in nodes))
print(Counter(e["type"] for e in edges))
