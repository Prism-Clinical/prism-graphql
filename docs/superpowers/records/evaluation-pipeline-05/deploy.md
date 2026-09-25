# Evaluation pipeline 05 — deploy record (Task 9, 🔒C)

**Window:** 2026-09-25T11:50:29Z (services stopped) → 11:51:36Z (verified). Public 502 for ~67 s.

| Checkout | Old head (rollback target) | New head |
|---|---|---|
| prism-graphql | `2454130` | `aa0b420` (PR #61) |
| prism-admin-dashboard | `3a32df8` | `bc6ba48` (PR #19, includes the preview refresh fix, PR #18) |

**Pre-flight:** migration head `066_backfill_remaining_branch_mode`; 2 standalone sessions (Task 1's
before-capture), 0 runs; only `package-lock.json` modified in each checkout; all three services online.
**Build-only worktree** (`feat-evaluation-pipeline-release-build`, at `aa0b420` / `bc6ba48`): both builds passed before the window.

**Backup:** `/home/claude/backups/release-evaluation-pipeline-20260925-1150/` — `prism_db.dump` (121 table-data
entries, taken after the Task 7 backfill), `pathway-service-dist`, `admin-next`, both pre-deploy lockfiles.

**Migrations** (checksums equal the rehearsal's):

| Migration | Checksum |
|---|---|
| `067_evaluation_inputs` | `ca185b5c9f291b73f5c327182b4af7606d1327ab8132c15251925c8ec554e290` |
| `068_run_inputs` | `6739f5972c3934abbe2f3801407711d850303dfb46972ad1764fc78958c0cc03` |

**Verification:** all three pm2 processes online, no new restarts after 30 s; pathway-service log clean
(`Subgraph pathway ready`); `https://localhost/` → 200; `/graphql {__typename}` → `{"data":{"__typename":"Query"}}`;
gateway schema exposes `ResolutionSession.resultHash`; nginx reloaded.
