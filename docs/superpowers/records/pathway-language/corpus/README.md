# Pathway language design corpus

These ten documents were supplied by the project owner and committed at their request for reproducible design review. The original bytes are preserved. Filenames and SHA-256 values identify the versions considered; hashes do not establish clinical approval.

These are reusable care documents and design discussions, not patient-specific clinical records. Their clinical assertions, terminology codes, citations and internal consistency have not been validated by this architecture review. They must not be treated as approved clinical rules or copied into executable pathways without clinical adjudication. Existing source attributions are preserved; inclusion does not grant a new license to underlying referenced publications.

The [Stage A specification](../../../specs/2026-09-30-pathway-language-stage-a-spec.md) owns the capability mapping, scenario requirements and interpretations. Keep those interpretations separate from these source files. The [architecture RFC](../../../specs/2026-09-28-pathway-language-rfc.md) records the accepted design. [manifest.json](manifest.json) supplies machine-readable provenance and hashes.

| Source | Role | SHA-256 |
|---|---|---|
| [GBS-Pregnancy-Care-Plan.docx.txt](GBS-Pregnancy-Care-Plan.docx.txt) | User-supplied pregnancy care document | `b97d8adc4fbcd3ee1ec534feab44999328fa391eb7e9eacd63daf13e5950e93a` |
| [gestational-diabetes-care-plan.txt](gestational-diabetes-care-plan.txt) | User-supplied pregnancy care document | `def603cdb765ccbc777b559e03b4e8d33b2582e23041e45c2613e209e45693bd` |
| [hypertensive-disorders-pregnancy-care-pathway.txt](hypertensive-disorders-pregnancy-care-pathway.txt) | User-supplied pregnancy care document | `43c31b56a4eaddd99e98852d9f7c78a99425ef8e8ad7c405d3ccfff87fdd807e` |
| [pregnancy-prior-uterine-surgery-care-pathway.txt](pregnancy-prior-uterine-surgery-care-pathway.txt) | User-supplied pregnancy care document | `bccd0c26c9a871fb7f00ee6e64bae586bf393f89b8c74d9b58d8065ee3f52b40` |
| [hyperthyroidism-pregnancy-structured.txt](hyperthyroidism-pregnancy-structured.txt) | User-supplied pregnancy care document | `ea4a6cea16d84e8080f08a07af1665d18428c504431690f15ba5b4110f5d5737` |
| [Chronic_Hypertension_Pregnancy_Care_Pathway.txt](Chronic_Hypertension_Pregnancy_Care_Pathway.txt) | User-supplied pregnancy care document | `15382949c3ab4f651c7eb8b68d934b1bd9b4c448cac4869448e293f2ea3f77e4` |
| [GERD-Pregnancy-Care-Pathway.txt](GERD-Pregnancy-Care-Pathway.txt) | User-supplied pregnancy care document | `937859b9b22f672e4d212cdd99b188f1e1d12b6cd4217459155d2c34a8f67032` |
| [UTI_Pregnancy_Care_Pathway.txt](UTI_Pregnancy_Care_Pathway.txt) | User-supplied pregnancy care document | `f8b6ed55c0b5100bf2f69db9ce7264fa8b3ffc3375551d947fe9add7d4173188` |
| [temporal-logic-in-prism-node-pathway.txt](temporal-logic-in-prism-node-pathway.txt) | Temporal Logic in Prism’s Node Pathway — supplied design discussion | `5fb2b9b99db42fc343f62aa2858d15e6f83025138a198a9167b263c01807e92c` |
| [time-acuity-reading-of-data.txt](time-acuity-reading-of-data.txt) | Time, Acuity, and the Reading of Data — supplied problem definition | `420161d246ce198c8b0912daa8165da1e797de4af19d62a55702beb00a2f6908` |

Changing a source requires a new fingerprint and a review of affected capability/scenario decisions. Preserve the prior version in repository history. None of these files is an ingestion or production-migration deliverable.
