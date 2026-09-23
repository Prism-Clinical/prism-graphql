# Evaluation pipeline 05 — rehearsal record (Task 6, P5-5)

**Date:** 2026-09-23. **Source:** full copy of `prism_db` → `prism_release_scratch` (dropped afterwards).
**Source `migration_history` head:** `066_backfill_remaining_branch_mode`; 14 graphs in `pathway_graph_index`.
**Code:** `feat/evaluation-pipeline-05-release` @ `0bd374e`.

## Backfill (copy only)

- Dry run: **9 pathways** (1 ACTIVE: anemia-in-pregnancy @ 1.4; 8 DRAFT), **16 distinct medication names**.
- Real run: `9 pathways: 17 normalised, 25 not` (per-pathway counts; the anemia names repeat across its 7 versions).
- Cache: **9 mapped | 7 unmapped** = 16 distinct names. No network failures.
- Unmapped (P5-8, the user's triage):
  - `ace inhibitors, arbs, renin inhibitors and mineralocorticoid receptor antagonists`
  - `folic acid (therapeutic dose for deficiency)` — ACTIVE anemia v1.4
  - `intravenous iron (e.g., iron sucrose / ferric carboxymaltose)` — ACTIVE anemia v1.4
  - `oral elemental iron (e.g., ferrous sulfate)` — ACTIVE anemia v1.4
  - `nifedipine xl`
  - `nifedipine, extended release`
  - `nifedipine, immediate release`

## Migrations (copy)

| Migration | Checksum |
|---|---|
| `067_evaluation_inputs` | `ca185b5c9f291b73f5c327182b4af7606d1327ab8132c15251925c8ec554e290` |
| `068_run_inputs` | `6739f5972c3934abbe2f3801407711d850303dfb46972ad1764fc78958c0cc03` |

Both applied without error; the purge removed the copy's 2 before-capture sessions. Task 9 must reproduce these checksums on live.

## Stage benchmark (read-only, `EXPECT_DDI_COVERAGE=1`)

| Measurement | Pre-backfill, live (Task 2) p95 | Migrated + backfilled copy p95 |
|---|---|---|
| Single (chronic-htn, ROOT): env snapshot | 16 ms | 19 ms |
| Single: evaluate | 4 ms | 5 ms |
| Single: total | 19 ms | 23 ms |
| 5-child run: env snapshot | 78 ms | 79 ms |
| 5-child run: evaluate (5 children) | 15 ms | 10 ms |
| 5-child run: composeRun (decided) | 3 ms | 2 ms |
| 5-child run: total | 88 ms | 89 ms |

Workload (both): single 109 nodes, 109 resolved, 9 candidates; run 405 nodes, 29 candidates, 2 conflicts
(ACCEPT_BOTH), root pair set **23 candidates** (frozen as `MIN_ROOT_CANDIDATES`).
Normalised on the copy: single 8/9; children 8, 3, 0, 0, 0 (the three ARCHIVED children, P5-4);
**root pair set 8 normalised, 28 comparisons** → Task 8 passes `MIN_ROOT_NORMALISED=8`.

**Interaction pairs loaded: 0.** `drug_interactions`, `drug_class_interactions` and
`allergy_class_mappings` are empty on live (and so on the copy). Normalisation now succeeds, but
there is no interaction or allergy-class data to check against: the post-backfill figures still
measure an empty lookup, not real DDI work.

One run child's graph (106 nodes, 194 edges) has a true cycle: `ConfidenceEngine` logs
"Cycle detected … propagation skipped" on every evaluation of it.

## Mutation gate (the release decision, spec §5.7)

| Mutation | p50 | p95 | Budget | Pass |
|---|---|---|---|---|
| Single: `overrideNode` (chronic-htn-pregnancy-v1) | 35 ms | 41 ms | < 2000 ms | ✓ |
| 5-child run: answer (`gate-aspirin-indicated`, BOOLEAN, child 1) | 117 ms | 130 ms | < 5000 ms | ✓ |
| 5-child run: fact (`vitalSigns.heart_rate`) | 119 ms | 132 ms | < 5000 ms | ✓ |

**Falsification:** a 5.1 s sleep at the top of `writeEvaluation` and `writeRunEvaluation` →
all three fail on p95 (5148 / 5231 / 5246 ms). Removed; `git diff` clean.

## Deviations from the plan's code (each approved before applying)

1. **Capture input:** `LabResultInput` has `date`, not `effectiveDateTime` (live rejected the
   request at validation). Renamed in the capture script and in the benchmark and gate fixtures.
2. **Pinned clock:** `evaluationAsOf` requires an explicit `resolutionMode: SYNTHETIC`, which
   requires the ADMIN role. The gateway forwards no `x-user-role`, so the capture talks to the
   pathway subgraph (:4016) as ADMIN; the gate starts its session as SYNTHETIC with ADMIN.
3. **DRAFT single pathway:** `startResolution` takes ACTIVE pathways only. The gate activates
   chronic-htn on its scratch copy as untimed setup.
4. **Defect found by the gate, fixed (`0dfa4ee`):** `logNodeOverride` wrote the GraphQL enum
   (`INCLUDE`) into `pathway_node_overrides`, whose 043 CHECK admits only lowercase. Inside the
   pipeline's commit transaction every override rolled back. A new opt-in Postgres test drives
   `overrideNode` and fails without the fix.
5. **Residue:** also removed the `createMultiPathwaySession` mock entry (the function no longer
   exists; the plan's own `clean` check required it).

## Pre-merge checks

- Suite: **1673 passed / 9 failed / 15 skipped** (plan expected 14 skipped; +1 is the new opt-in
  override Postgres test). Only the two scorer suites fail. `tsc` clean; build OK.
- Opt-in Postgres tests: **11 passed** (10 + the override test).
