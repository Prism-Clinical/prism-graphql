# Research Standards for Prism Pathway Briefs

## Source hierarchy (US-guideline-first, in strict preference order)

1. **US specialty-society clinical practice guidelines** — ACC/AHA, ADA, ACOG, IDSA, ACP,
   AAP, ACR, AUA, AAN, ASCO, ACG/AGA, ATS, Endocrine Society, KDIGO-US-endorsed, etc.
   Use the society that owns the condition; name the guideline and year.
2. **US federal bodies** — USPSTF, CDC, NIH consensus statements, FDA labeling (for dosing
   and contraindications), CMS/NCQA (for quality metrics).
3. **Peer-reviewed systematic reviews / landmark RCTs** — to fill gaps the guidelines leave,
   or to support a threshold a guideline states without detail.
4. **International guidelines (NICE, ESC, WHO…)** — fallback only, flagged
   `[FALLBACK SOURCE]`, and only where no acceptable US source exists.
5. **Reviews, UpToDate-style summaries, textbooks** — orientation only. Never cited in the
   brief; find the primary guideline they summarize and cite that.

## Recency

- Prefer the current edition of each guideline; check for focused updates that amend it.
- ≤5 years old is the default bar. An older source is acceptable when it is still the
  society's current recommendation — flag `[OLDER SOURCE — still current recommendation]`.
- When two societies conflict, present the option that will drive the pathway, note the
  conflict in the brief section it affects, and cite both.

## Verification (non-negotiable)

- Every citation must be **fetched and read** (guideline page, executive summary, or PDF),
  not inferred from search snippets or model memory.
- A citation entry records: title, authoring org/authors, publication/source, year, evidence
  level, and the URL actually fetched.
- Evidence levels: use the guideline's own grade where it assigns one (A/B/C or Level A/B/C);
  use `Expert Consensus` for consensus statements and ungraded recommendations. Map
  nonstandard grading systems (e.g. GRADE strong/conditional) to the closest of these and
  say so in the citation entry.
- Numbers (doses, thresholds, intervals, durations) are copied from the fetched source, with
  the section/table noted in the research notes. If a number can't be sourced, it does not
  go in the brief — mark `[GAP]` instead.
- Codes (ICD-10, LOINC, CPT, SNOMED, RxNorm) are verified against a code lookup during
  research, not recalled. RxNorm RXCUIs via RxNav; LOINC via loinc.org search; ICD-10 via
  CMS/CDC lookup. A plausible-but-unverified code is a `[GAP]`.
- Never invent a citation, a code, or a threshold. A visible gap is a good outcome; a
  fabricated fact is the failure mode this whole standard exists to prevent.

## Coverage targets for a comprehensive pathway

- Diagnosis criteria and required workup (labs, imaging, procedures)
- Risk stratification and decision logic — separate machine-evaluable (→ Gates) from
  judgment-based (→ DecisionPoints)
- First-line / second-line / alternative / contraindicated medications with dosing, and
  escalation triggers
- Non-pharmacologic management and counseling content (→ Guidance nodes)
- Monitoring and follow-up cadence (→ Schedules), including escalation triggers
- Quality measures tied to the condition (CMS/NCQA/society) with measure definitions
- Special populations touching the scope (pregnancy, renal impairment, geriatric) — either
  covered in-pathway via gates or explicitly scoped out in the metadata
- Codes for every diagnosis, lab, imaging study, procedure, and medication in the pathway
