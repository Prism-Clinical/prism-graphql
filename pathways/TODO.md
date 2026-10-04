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
