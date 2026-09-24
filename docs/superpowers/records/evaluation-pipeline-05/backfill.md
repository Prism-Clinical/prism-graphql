# Evaluation pipeline 05 — live backfill record (Task 7, 🔒B)

**Started:** 2026-09-24T17:01:26Z on `prism_db` (migration head 066). **Code:** `feat/evaluation-pipeline` @ `7b8b1fe`.

- Pre-check: `medication_normalization_cache` had 0 rows. The dry run listed the rehearsal's 9 pathways (1 ACTIVE: anemia 1.4; 8 DRAFT).
- Result: `9 pathways: 17 normalised, 25 not`. The same as the rehearsal.
- Cache: **9 mapped | 7 unmapped** = 16 distinct names. No network failures.

## Unmapped (P5-8, not resolved: the user's triage)

- `ace inhibitors, arbs, renin inhibitors and mineralocorticoid receptor antagonists`
- `folic acid (therapeutic dose for deficiency)` (ACTIVE anemia v1.4)
- `intravenous iron (e.g., iron sucrose / ferric carboxymaltose)` (ACTIVE anemia v1.4)
- `nifedipine, extended release`
- `nifedipine, immediate release`
- `nifedipine xl`
- `oral elemental iron (e.g., ferrous sulfate)` (ACTIVE anemia v1.4)
