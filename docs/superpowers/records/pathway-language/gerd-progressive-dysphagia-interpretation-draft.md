# L00.1.a interpretation draft: GERD progressive-dysphagia alarm

**Status:** Interpretation draft prepared for review. **Not** clinically adjudicated. L00.1.a remains open.

**Date:** 2026-10-02

**Story:** [L00.1.a — Define one pathway’s intended meaning without syntax](../../specs/2026-10-01-pathway-language-level-3-story-spec.md#l00-1-a). **Authority:** [RFC](../../specs/2026-09-28-pathway-language-rfc.md), [Stage A](../../specs/2026-09-30-pathway-language-stage-a-spec.md) sections 4, 8 and 17.

This record covers only the progressive-dysphagia bullet. Other alarms, referral/endoscopy decisions, medication sequencing and the full C-01 scenario are out of scope. It defines no syntax, types, relationships, schemas or code.

## 1. Source

| Item | Value |
|---|---|
| File | [corpus/GERD-Pregnancy-Care-Pathway.txt](corpus/GERD-Pregnancy-Care-Pathway.txt) |
| SHA-256 | `937859b9b22f672e4d212cdd99b188f1e1d12b6cd4217459155d2c34a8f67032` ([manifest](corpus/manifest.json); recomputed 2026-10-02, matches) |
| Section | “CLINICAL DIAGNOSIS” → “ALARM SYMPTOMS REQUIRING IMMEDIATE EVALUATION:” (line 85) |
| Passage | Line 86: `• Progressive dysphagia (particularly solids before liquids)` |
| Manifest status | “Design inputs; not approved clinical guidance” |

## 2. What the source explicitly says

Quoted or closely paraphrased from the pinned file; no interpretation.

- **Line 85–86:** progressive dysphagia, “particularly solids before liquids”, is listed under alarm symptoms “requiring immediate evaluation”. The passage does not name what evaluation, who performs it, or a time limit.
- **Line 72:** “When classic symptoms are present without alarm features, empiric therapy is appropriate without additional diagnostic testing.”
- **Line 288 (referral section):** GI referral indications include “Any alarm symptoms (dysphagia, odynophagia, weight loss, GI bleeding, anemia)”. This says **dysphagia**, unqualified — broader than line 86, and it lists fewer alarms than lines 86–92.
- **Line 298:** endoscopy indications include “Refractory dysphagia” (a third, different qualifier).
- **Line 329:** elective procedures defer postpartum “unless alarm symptoms present”.
- **Lines 375–376:** esophageal stricture “Presents with progressive dysphagia to solids” and “Constitutes urgent indication for endoscopy even during pregnancy”. Note “to solids” here vs. “particularly solids before liquids” on line 86, and “urgent” vs. “immediate”.
- **Line 449:** postpartum, “If alarm symptoms develop postpartum: Urgent GI referral”.
- **Lines 340, 343, 582:** “Screen for alarm symptoms” at the initial visit, “Reassess alarm symptoms” at 2–4 weeks, and “Systematic screening for alarm symptoms at EACH encounter”.
- **Line 487:** the coding table lists SNOMED `40739000` “Dysphagia (disorder)” as “Alarm symptom”; no code for *progressive* dysphagia is given.
- **Line 599:** patient education: “Report alarm symptoms immediately (difficulty swallowing, …)”.

## 3. Proposed applicability and encounter scope (unresolved)

Each item below is a proposal, not a decision.

- **A1 (unresolved):** Population is pregnant patients evaluated under this GERD pathway. Whether it applies to suspected GERD without a diagnosis, or to postpartum patients (line 449 suggests a separate postpartum path), is open.
- **A2 (unresolved):** Assessment occurs at each encounter in the pathway (line 582), not only the initial and 2–4 week visits (lines 340–343). Which encounter types count is open.
- **A3 (unresolved):** The finding concerns the current pregnancy episode. Whether pre-pregnancy or earlier-episode dysphagia history is admissible is open.

## 4. Proposed evidence cases — **for review, not clinically approved**

“Evaluation” below means the unspecified evaluation in line 85. **Proposing** it means surfacing a recommendation for clinician review; it is not ordering, scheduling or performing anything.

| Case | Evidence (what would establish it is itself open — Q1–Q7) | Proposed output | Must **not** be concluded |
|---|---|---|---|
| **Present** | Admissible evidence within scope that progressive dysphagia is present | Alarm finding established and surfaced as urgent, independent of other branches being unresolved. Evaluation **proposed** (nature per Q8, timing per Q11). Proposed reading: line 72’s “without alarm features” no longer holds | That evaluation was ordered or performed; any specific test, referral destination or deadline |
| **Explicitly assessed, absent** | An admissible, in-scope explicit negative for progressive dysphagia (e.g. a documented assessment that it is absent) | This one alarm is not established for the assessed scope and time. No evaluation is proposed **on the basis of this alarm** | That other alarms (lines 87–92) are absent; that the patient is “without alarm features”; that evaluation is unnecessary for any other reason; that the negative persists beyond its assessed time |
| **Unassessed / unavailable** | No admissible assessment, retrieval failure, or only out-of-scope/stale evidence. **An empty chart is in this row**, not the previous one | Unresolved. Proposed: surface a need to assess this symptom where it is material (C-01 Need behaviour); keep any other established findings visible | That the symptom is absent; that line 72’s empiric-therapy path is cleared; that the encounter’s alarm screening is complete |

Not yet covered: conflicting evidence (e.g. present in one note, denied in another) and dysphagia recorded without a progression qualifier. Both are raised as questions below rather than assigned a row.

## 5. Questions requiring clinical adjudication

**What establishes progressive dysphagia**

- **Q1.** Is “progressive” required, or does any new dysphagia count? Line 86 says progressive; line 288 says dysphagia; line 298 says refractory. Which wording governs this alarm, and is dysphagia without a stated progression qualifier present, absent or unresolved for it?
- **Q2.** Is “particularly solids before liquids” a required feature, a supporting feature, or illustrative only? Is line 375’s “to solids” intended to be the same thing?
- **Q3.** Can the coded SNOMED `40739000` “Dysphagia (disorder)” alone establish this alarm, given it carries no progression qualifier?

**Acceptable evidence and timing**

- **Q4.** Which sources are acceptable for present and for explicitly absent: patient report, clinician-documented review of systems, structured questionnaire, problem-list entry, provider attestation at the encounter? Is a patient-reported negative sufficient?
- **Q5.** How recent must the assessment be? Does an explicit negative from an earlier encounter count at a later one, given line 582’s “at EACH encounter”?
- **Q6.** How should conflicting in-scope evidence be handled for this symptom?
- **Q7.** Does pre-pregnancy or earlier-episode dysphagia history count (A3)?

**Intended evaluation**

- **Q8.** What is the “evaluation” in line 85: clinician reassessment, GI referral (line 288), endoscopy consideration (lines 298, 375–376), or something else? The source does not say, and this draft does not choose.
- **Q9.** Does the output stop at proposing evaluation for clinician review, or should it also propose a specific downstream action? (Out of L00.1.a scope either way; the answer bounds later stories.)
- **Q10.** If the evaluation is a GI referral, does that use the line 288 referral wording, which covers broader dysphagia than this alarm?

**Meaning of “immediate”**

- **Q11.** Does “immediate” mean within the current encounter, before the patient leaves, same day, or something else? The source gives no time limit and this draft invents none.
- **Q12.** Are “immediate” (line 85) and “urgent” (lines 376, 449) intended to differ?
- **Q13.** Must the surfaced finding interrupt or block finalization of the current encounter’s plan, or only be shown prominently while other work proceeds?

**Scope**

- **Q14.** Confirm or correct A1–A3.

## 6. Completion record

| Milestone | Status | Identity / evidence |
|---|---|---|
| Interpretation draft prepared | **Done**, 2026-10-02 | Drafted with Claude Code at the project owner’s request; revision = the commit adding this file |
| Source pinned and verified | **Done**, 2026-10-02 | SHA-256 above recomputed and matches the manifest |
| Engineering review of draft | Not started | Reviewer: unresolved |
| Clinical interpretation adjudicated (Q1–Q14, A1–A3, table outcomes) | **Not started** | Clinical reviewer: unresolved (Stage A §17 assignment is unassigned). Approval: none |
| L00.1.a complete | **No** | Blocked on clinical adjudication and recorded reviewer identities |

Until adjudication, every output in section 4 is a proposal. Nothing here is approved for clinical use or executable pathway authoring.
