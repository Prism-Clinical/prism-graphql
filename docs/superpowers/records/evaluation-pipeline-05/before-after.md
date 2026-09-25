# Evaluation pipeline 05 — before/after comparison (Task 10, spec §5.8)

**After captured:** 2026-09-25T11:52Z from the deployed pipeline (`aa0b420`), same pathway
(`a1774566…`, anemia-in-pregnancy 1.4), same pinned `evaluationAsOf` 2026-09-10T12:00Z, same two patients.
`diff` exit 1. **Every changed line is in an expected class; no defect.**

| Line(s) | Patients | Class |
|---|---|---|
| Header `# before` → `# after` | — | label only |
| `lab-1` LabTest 0.984 → 0.708, INCLUDED both | withHaemoglobin | confidence propagation (conf only) |
| `lab-2`…`lab-6` LabTest 0.641 → 0.551, **INCLUDED → EXCLUDED** ("below suggest threshold 0.6") | both | confidence propagation: action nodes, confidence fell across the 0.6 suggest threshold in the direction of the status change |
| `proc-1` Procedure 0.984 → 0.708, INCLUDED both | both | confidence propagation (conf only) |
| `stage-1`…`stage-4` 0.984 → 0.909; `step-*` 0.984 → 0.801 (`step-3-3` 0.708), all INCLUDED both | both | confidence propagation (conf only; no Stage/Step status change) |
| after-only `probe success=false carePlan=-` | both | pipeline-only fact (the generation probe) |
| after-only `blocker COMPLETENESS PENDING_GATE nodes=dp-1` | both | new readiness blocker (dp-1 is pending in both records) |
| after-only `blocker COMPLETENESS PENDING_GATE nodes=gate-severe-anemia` | noHaemoglobin | new readiness blocker (the gate is pending in both records) |

- **Same-pathway DDI findings:** none. Live's interaction, class and allergy tables are empty.
- **Eligibility lines:** none. The capture prints one only for a withheld node or one whose
  eligibility differs from its disposition, and nothing is withheld without safety rules.
- The unchanged lines (codes, evidence, gates, medications, quality metrics, schedules, questions)
  are identical in both records. The pending-question note from Task 1 carries over.

**User-visible effect:** for this pathway, the five follow-up labs (`lab-2`…`lab-6`) now drop below
the suggest threshold under whole-graph scoring and are no longer suggested by default.
