# Evaluation Pipeline — Plan Suite Overview

**Spec:** `docs/superpowers/specs/2026-09-13-evaluation-pipeline-design.md` (branch
`docs/evaluation-pipeline-design`, `8fae542`). Read the spec first. Every plan argues from it,
and the spec's contracts C1–C4 win any disagreement.

**Suite baseline:** `main` @ `2454130` — pathway-service **1645 passed / 9 failed / 1 skipped**.
The 9 failures are `patient-match-scorer` and `data-completeness-scorer`, and they are
pre-existing. Each plan appends a row to its own baseline table. The invariant is *those 9 remain
the only failures*, not a pass count.

## Sequence

| Plan | Deliverable | Consumes | Produces | Written |
|---|---|---|---|---|
| **01 Performance gate** | Opt-in read-only benchmark of the pipeline's cost on live pathways; pass/fail recorded against §5.7 budgets | Existing engine on `main` | Go / no-go for D1 + D13 | Yes |
| **02 Pure core** | `services/resolution/pipeline/`: observation provider (C1), environment snapshot + fingerprint + candidate universe (C4), whole-graph scores, traversal with overrides and eligibility (C2), findings, scoped safety and readiness (C3), `SAFETY_DATA_UNAVAILABLE` for unnormalised medications (D14), `evaluate()`. Import rule: `depends_on` may not target Medication. Acceptance A1 (replay, keys, UNAVAILABLE, request reuse) and A2. Property tests (b) order independence and (c) determinism. **Not wired to any resolver.** | 01 passed | `evaluate(inputs, env, observations, scope)`, `loadEvaluationEnv`, `ObservationProvider`, `EvaluationResult` | Yes |
| **03 Single-pathway wiring** | Migration 067; `commitEvaluation`; lifecycle-only operations; single-pathway mutations and generation (`reviewedResultHash`) on the pipeline; SDL changes; delete the incremental engine; retired-test mapping table; review reproductions ported; A1 retry-once; property (a) sequence-vs-fresh; opt-in Postgres tests for revision CAS and generation; `prewarmMedications` wired into `importPathway` and `activatePathway` plus non-blocking post-snapshot pre-warm, and a normalisation backfill script (D14) | 02 | Stored inputs; `commitEvaluation`; new session API | After 02 executes |
| **04 Multi-pathway composition** | `composeRun`; parent-owned facts; every run mutation re-evaluates all children; `reMergeMultiPathwaySession` removed; admin dashboard updated (hash on generate, no re-merge, eligibility/withheld display); A3, A4; run Postgres tests | 03 | Complete engine on the new model | After 03 executes |
| **05 Release** | Run the normalisation backfill on live, then re-run the plan 01 gate with real DDI coverage; before/after record (§5.8); manual admin smoke test (§5.10); merge integration branch → `main`; deploy runbook | 04 | Deployed pipeline | After 04 executes |

Plans 02–05 are written **only after the previous plan executes**, because each consumes code
the previous one produced. Writing them early would plan against guessed signatures.

## Branches

- **Integration branch:** `feat/evaluation-pipeline`, from `origin/main`. Each plan gets a branch
  `feat/evaluation-pipeline-NN-<name>` from the integration branch and merges back into it.
- **Why not straight to `main`:** 03 changes the session tables that multi-pathway code still
  writes until 04 lands. `main` would be undeployable in between. The integration branch merges to
  `main` once, in 05.
- **admin-dashboard** (04): `feat/evaluation-pipeline` from `origin/master`.
- **Worktrees:** create them with `/new-feature`, never manually.

## Global Constraints

These apply to every plan.

- **No users.** No compatibility seams, deprecation windows or dual paths (spec, Constraints).
- **Suite invariant:** the nine pre-existing scorer failures remain the only failures.
- **Test files are not typechecked** (ts-jest `diagnostics: false`), so every invariant needs a
  runtime throw plus a test that fails without it.
- **Assert the positive, then revert the fix and watch the test fail.** A negative assertion can
  pass for the wrong reason.
- **Commands:** from the repo root, never `cd … && …`.
  - Tests: `npm test --prefix apps/pathway-service -- --runInBand <path>`
  - Typecheck: `./node_modules/.bin/tsc -p apps/pathway-service/tsconfig.json --noEmit`
- **Commits:** conventional prefixes. End every message with exactly this trailer:
  `Claude-Session: https://claude.ai/code/session_01XRNkZvQrxmRLNtJHxq71kH`.
  No `Co-Authored-By` line and no `@anthropic.com` address (`CLAUDE.md`).
- **Live database:** read only, and only in opt-in tests that force `default_transaction_read_only`.
- **Performance budgets (spec §5.7):** p95 **< 2 s** for a single-pathway evaluation; **< 5 s** for
  a 5-child run evaluation.
