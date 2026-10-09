# Clinical review packet: GERD progressive-dysphagia alarm, Q1–Q3

**Status:** Prepared for clinical review. **No question is answered, no clinical approval is claimed, and L00.1.a remains open.**

**Date:** 2026-10-03

**Parent record:** [Interpretation draft](gerd-progressive-dysphagia-interpretation-draft.md), section 5, Q1–Q3. **Story:** [L00.1.a](../../specs/2026-10-01-pathway-language-level-3-story-spec.md#l00-1-a).

**Problem:** Given the source’s differing descriptions of dysphagia, establish what symptom evidence satisfies this one alarm: line 86, “Progressive dysphagia (particularly solids before liquids)”.

This packet covers Q1–Q3 only. Q4–Q14, numerical urgency, tests, treatment and the rest of the GERD pathway are out of scope.

## 1. Pinned source

| Item | Value |
|---|---|
| File | [corpus/GERD-Pregnancy-Care-Pathway.txt](corpus/GERD-Pregnancy-Care-Pathway.txt) |
| SHA-256 | `937859b9b22f672e4d212cdd99b188f1e1d12b6cd4217459155d2c34a8f67032` ([manifest](corpus/manifest.json); recomputed 2026-10-03, matches) |
| Manifest status | “Design inputs; not approved clinical guidance” |

| Wording | Section → subsection | Line | Exact text |
|---|---|---|---|
| Progressive dysphagia (the alarm under review) | CLINICAL DIAGNOSIS → “ALARM SYMPTOMS REQUIRING IMMEDIATE EVALUATION:” (line 85) | 86 | `• Progressive dysphagia (particularly solids before liquids)` |
| Solids before liquids | same bullet | 86 | `(particularly solids before liquids)` |
| Unqualified dysphagia | REFERRAL AND ENDOSCOPY GUIDELINES → “Gastroenterology Referral Indications:” | 288 | `• Any alarm symptoms (dysphagia, odynophagia, weight loss, GI bleeding, anemia)` |
| Refractory dysphagia | REFERRAL AND ENDOSCOPY GUIDELINES → “Endoscopy in Pregnancy (ASGE Guidelines):” → “Indications:” | 298 | `• Refractory dysphagia` |
| Progressive dysphagia to solids | COMPLICATIONS AND SPECIAL CONSIDERATIONS → “Esophageal Stricture:” | 375 | `• Presents with progressive dysphagia to solids` |
| Dysphagia coding entry | CLINICAL CODING REFERENCE → “SNOMED CT CODES:” | 487 | `40739000    \| Dysphagia (disorder)                           \| Alarm symptom` |

The coding entry is a claim made by the supplied document. Its code, description and “Alarm symptom” use have not been checked against any terminology release.

## 2. Reading constraints

- These sections may govern different actions: line 86 sits under an alarm list, line 288 under GI referral, line 298 under endoscopy, line 375 under a complication description. Their wording is not assumed interchangeable, and answering Q1–Q3 for line 86 does not settle what lines 288, 298 or 375 mean.
- Evidence that does not establish this alarm does not establish that dysphagia is absent, that the patient is safe, or that no other indication for evaluation exists (including lines 288 and 298).

## 3. Decisions for the reviewer

Record each decision separately and identify dependencies between answers. Q3 may depend on the answers to Q1 and Q2.

- **Q1. Is progression required to establish this specific alarm?** If not, what dysphagia evidence suffices? If so, is dysphagia documented without a progression qualifier treated as not establishing this alarm, as unresolved for it, or otherwise?
- **Q2. What role does the solids/liquids description play?** For example: required, supporting but not required, or illustrative only. Is line 375’s “to solids” the same feature as line 86’s “particularly solids before liquids”?
- **Q3. Can the unqualified dysphagia code alone (line 487, `40739000` “Dysphagia (disorder)”, as claimed by the source) establish this alarm?**

## 4. Constructed evidence examples

These are invented for discrimination only. They are not patient records. Outcomes are deliberately left blank.

| # | Constructed in-scope evidence | Mainly tests | Outcome for this alarm |
|---|---|---|---|
| E1 | Patient reports swallowing difficulty with meat and bread that has worsened over two months; liquids pass normally | Q1, Q2: worsening difficulty with solids; liquids unaffected. Whether this satisfies the source’s wording remains unresolved | Unresolved |
| E2 | Patient reports swallowing difficulty that has worsened over three weeks; no solids/liquids description recorded | Q2 | Unresolved |
| E3 | Patient reports difficulty swallowing solids; nothing recorded about change over time | Q1 | Unresolved |
| E4 | Patient reports worsening difficulty swallowing solids and liquids equally | Q2 | Unresolved |
| E5 | Patient reports difficulty swallowing; no progression or food-type description recorded | Q1, Q2 | Unresolved |
| E6 | Problem list contains SNOMED `40739000` “Dysphagia (disorder)”; no narrative in scope | Q3 | Unresolved |
| E7 | E6, plus a narrative note matching E1 | Q3 (whether the code adds anything once narrative exists) | Unresolved |

For any example the reviewer finds does not establish this alarm, section 2 still applies: that outcome says nothing about lines 288 or 298, other alarms or overall safety.

## 5. Scope assumptions needed for Q1–Q3 (all unresolved)

- **S1 (unresolved):** The examples assume a pregnant patient evaluated under this GERD pathway (draft A1). Postpartum and pre-diagnosis applicability is open.
- **S2 (unresolved):** Q1 assumes progression is stated within in-scope evidence. Whether progression may also be established by comparing evidence across encounters depends on Q5 and Q7, which this packet does not answer.
- **S3 (unresolved):** E6–E7 assume the code entry falls within the episode and encounter scope. Whether a coded entry is in scope (dates, episode) depends on draft A3, Q5 and Q7.

## 6. Decision record (complete one per question)

| Field | Q1 | Q2 | Q3 |
|---|---|---|---|
| Reviewer identity (name, role) | | | |
| Date | | | |
| Decision | | | |
| Outcome for each of E1–E7 | | | |
| Rationale | | | |
| Supporting source (file, line) | | | |
| Unresolved dependencies (e.g. S1–S3, Q4–Q14) | | | |
| Reviewed revision (commit and source SHA-256) | | | |

Until this table is completed by a named clinical reviewer, Q1–Q3 remain unresolved and the [interpretation draft](gerd-progressive-dysphagia-interpretation-draft.md) remains a proposal.
