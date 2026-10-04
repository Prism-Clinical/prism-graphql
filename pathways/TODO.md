# Pathway pipeline — TODO

## Formalize research → decisions → care plan (Josh, 2026-09-24)

Applies to future pathways. The current OB pathways were test cases, built with decisions
gathered informally.

Every pathway should go through these steps, in order:

1. **Research** (`pathway-research`) writes the brief, including a **conflict register**: every
   point where guidelines disagree (source A vs source B, publication/reaffirmation dates,
   evidence strength, exact recommendation), and every open clinical choice the evidence
   leaves to the author.
2. **Conflict review / translation.** Each register entry goes to the reviewing clinician as a
   structured question: multiple choice, the recommended option first, a one-line tradeoff per
   option, and room for a free-text answer. This is the step that translates evidence into care.
3. **Write the answers into the brief** as `[DECISION — <reviewer> <date>]` with the rationale
   and the sources weighed. The brief is the durable, plain-text record; chat is not.
4. **Build only after that.** `pathway-json-builder` should refuse to build while any register
   entry is unresolved. An example marker is `[DECISION PENDING — …]`, and a lint alongside
   `check-brief-sync.ts` would enforce it.

Open design questions:
- Should the conflict register be one table in the brief template, and what are its columns?
- Should the review step be a skill of its own (e.g. `pathway-review`) that reads the register
  and drives the Q&A, or part of `pathway-research`?
- How are re-reviews handled when a guideline changes? Re-open the register entry, bump the
  version, and rebuild.
- Should each decision record the reviewer (e.g. Josh vs Wyeth)?

## Pathway classification — pregnant / adult / pediatric (Josh, 2026-10-03)

**Built so far (2026-10-03):** obstetric pathways (`category: OBSTETRIC`) apply only to a
pregnant patient — a chapter-15 code, `Z33`/`Z34`/`Z3A`, or a recorded gestational age or
trimester (`pathway-applicability.ts`). The rest below is not built and is needed before
pathways exist outside obstetrics.

- Every pathway carries a **class**: pregnant, adult or pediatric.
- **Pregnant wins.** A pregnant patient with iron deficiency anemia gets the pregnancy anemia
  pathway, not a general-medicine one, even though both match the diagnosis.
- **Adult vs pediatric is decided by age.**
- Today the only preference between two matching pathways is code specificity (lattice
  collapse) and `code_sets` combinations; neither knows the patient is pregnant.

Open design questions:
- What marks a patient as pregnant — a pregnancy code family on the chart (`Z34`, `O09`,
  `Z3A`, any `O` code), a recorded gestational age, or either?
- Where the class is authored (pathway metadata) and where it is enforced (the matcher,
  before lattice collapse).
- The age boundary between pediatric and adult, and whether a pathway may span both.

## Constipation in pregnancy — its own pathway (not started)

`[DECISION — Josh 2026-10-04]` Docusate was removed from anemia-in-pregnancy (v17): a stool
softener is a constipation decision, not an anemia one. A separate constipation pathway is
to be written later ("don't write constipation yet"). No connection is built between the two
pathways. Until it exists, a constipation diagnosis in the simulator shows as not supported.
General rule this sets for authors: a pathway does not order treatment for a different
problem; that problem gets its own pathway.

## Rh-negative pregnancy — its own pathway (not started)

`[DECISION — Josh 2026-10-04]` Rh-negative management was taken out of routine-prenatal-care
(v1): RhIG before 12 weeks "that's part of rh neg pathway, not routine prenatal", fetal RhD
cfDNA likewise, and the routine 28-week RhIG moves there too. Routine prenatal care only types
Rh and runs the antibody screen; when the type is negative it recommends adding the diagnosis
(Z67.91 or the ABO-specific Rh-negative code — confirmed by Josh on review of v1: "Z67.91 stands"; "if rh neg found, suggest rh neg pathway as result in prenatal pathway"). The 24–28-week repeat antibody screen belongs here too, with all RhIG. No connection is
built between the two pathways. Until this pathway exists, Prism recommends no Rh immune
globulin for anyone. Inputs already gathered (the removed content, sources [21]–[23], and
Josh's leanings: RhIG at about 28 weeks after the repeat antibody screen; forgo routine RhIG
before 12 weeks per ACOG) are in `pathways/briefs/routine-prenatal-care-research-brief.md` §0.9.

## A "season" scope for remembered answers (not built)

routine-prenatal-care v3 remembers a "yes" for the prenatal vitamin and an undated Tdap (this
pregnancy) and an undated RSV vaccine (the patient) with `remember_answer`. "Influenza /
COVID-19 vaccine given this season" cannot be remembered: the scopes are `PREGNANCY` and
`PATIENT`, and neither ends on the next September 1. Those two questions return at each visit
until the entry on the medication list is dated (brief J36).

## Anchor a treatment-start window on a medication class (`window_from.codes`)

Medication class matching landed on 2026-10-04 (`system: "RXNORM_INGREDIENT"` / `"ATC"` on
`includes_code` / `not_includes_code` / `count_in_window`): routine-prenatal-care v5 matches
vaccines, folic acid and aspirin by ingredient, and anemia-in-pregnancy v18 matches oral and
IV iron by ATC class. One place still takes product codes only: **`window_from.codes`**, the
list of chart orders that can date the start of a treatment (anemia's oral-iron response
window). The spec refuses `window_from` with a class system.

- Effect in anemia v18: a brand outside the code list (Fergon, Slow-Fe, a polysaccharide iron
  product) is recognised as oral iron by the gate, but its dated order cannot anchor the
  start, so "When did oral iron start?" is asked although the chart has the date (brief §18,
  v18; proved in `gate-proof.ts on-iron`).
- Wanted: `window_from.codes` entries of the form `{ "system": "ATC", "code": "B03AA" }`.
- Related: an order charted as a bare ingredient (ferrous sulfate, RxCUI 24947) has no single
  product class in RxNav, so an ATC gate asks about it. Prenatal multivitamins have no clean
  class either; routine prenatal care matches "contains folic acid" and keeps the remembered
  question for the rest.
