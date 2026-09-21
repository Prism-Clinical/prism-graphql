# Evaluation Pipeline 04 — Multi-Pathway Composition Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A multi-pathway run is a parent session plus one child per pathway. Every mutation on
a run loads one environment snapshot, re-evaluates every child from its stored inputs, composes
the run, and commits parent and children together under the parent's single revision. The
stored merged plan is never edited in place again.

**Architecture:**
- **Migration 068** gives `multi_pathway_resolution_sessions` its inputs and cache columns:
  `revision`, `additional_context`, `env_fingerprint`, `result_hash` and `readiness`.
- **`loadRunEnv`** reads every child's graph, the pathways' metadata and ONE safety reference in
  one REPEATABLE READ snapshot (C4, D13).
- **`composeRun`** is pure. It projects each contribution, merges them, applies the conflict
  decisions to the base merge, runs patient safety on write-ins and pair safety on the final set,
  and computes root readiness and the run hash (spec §3).
- **`evaluateRun`** evaluates each child at `CONTRIBUTION` scope with the parent's facts spliced
  in (D5), then calls `composeRun`.
- **`commitRun`** is the run's write path: reload, change, evaluate, compare-and-set the parent's
  revision, rewrite every child, all in one transaction. Three attempts, then `CONFLICT` (D6, D9).
- **The resolvers:**
  - An answer, override or fact on a child routes through `commitRun`.
  - `resolveConflict` and `generateMergedCarePlan` run on the pipeline.
  - `reMergeMultiPathwaySession` is removed.
- **The admin dashboard** sends the reviewed hash when generating, no longer re-merges, and shows
  why a suppressed medication was proposed and why it was withheld.

**Tech Stack:** TypeScript, Jest + ts-jest (`diagnostics: false`), `pg`, fast-check 3, Apollo
SDL + graphql-codegen, Next.js 16 / React 19 / Apollo Client 4 (admin dashboard).

**Spec:** `docs/superpowers/specs/2026-09-13-evaluation-pipeline-design.md`. This plan implements:
- §3 in full (multi-pathway as composition);
- §4 for runs (`commitEvaluation` shape, lifecycle-only operations, generation, migration step 3,
  API);
- C3 at the root, D5, D6, D7 and D13;
- §5.1 acceptance A3 and A4;
- §5.2 reproductions #2, #5, #6 and #7;
- §5.3 properties (a) and (b) for runs;
- §5.6 run Postgres tests;
- the admin dashboard changes of §3 and §4.

**Overview:** `docs/superpowers/plans/2026-09-14-evaluation-pipeline-00-overview.md`.
**Predecessor:** plan 03, merged into `feat/evaluation-pipeline` @ `c509273` (PR #58).

## Global Constraints

- **No users; no compatibility seams.** Migration 068 purges every session again. The
  integration branches merge to `main` / `master` once, in plan 05.
- **Suite invariant:** `patient-match-scorer` and `data-completeness-scorer` (9 tests) remain
  the only failures. The pass count changes because this plan retires tests; every retired test
  has a row in *Appendix B*.
- **Test files are not typechecked**, so every invariant needs a runtime throw plus a test that
  fails without it. **Assert the positive, then revert the fix and watch the test fail.**
- **No first-seen choice over `resolutionState` order.** Overrides are pre-seeded, so state
  order follows input order. `composeRun` projects each state in nodeId order before merging
  (P4-4); property (b) for runs checks it.
- **One lock per run.** A child row is written only inside a transaction that has just
  compare-and-set its parent's `revision`. `commitEvaluation` refuses a child of a run (P4-7).
- **Facts belong to the parent (D5).** A child row's `additional_context` is always `{}`
  (067 CHECK). Run evaluation splices the parent's facts in (`sessionInputsOf`).
- **Commands** use absolute paths, never `cd … && …`.
  - `W` is `/home/claude/workspace/features/feat-evaluation-pipeline-04-multi-pathway/prism-graphql`.
  - `AD` is `/home/claude/workspace/features/feat-evaluation-pipeline-04-multi-pathway/prism-admin-dashboard`.
  - Test one file: `npm test --prefix $W/apps/pathway-service -- --runInBand src/__tests__/<file>`
  - Typecheck: `$W/node_modules/.bin/tsc -p $W/apps/pathway-service/tsconfig.json --noEmit`
  - Codegen: `npm run codegen --prefix $W/apps/pathway-service`
- **Commit messages** use conventional prefixes and end with exactly one trailer line:
  `Claude-Session: https://claude.ai/code/session_01XRNkZvQrxmRLNtJHxq71kH`.
  No `@anthropic.com` address and no `Co-Authored-By` line (`CLAUDE.md`).
- **Live database:** untouched. Task 9's Postgres tests run only against a scratch database and
  refuse any other.

## Decisions and deviations (review these first)

| # | Decision | Why |
|---|---|---|
| P4-1 | **A child row keeps `initial_patient_context` as an immutable copy of the parent's**, written at start. Run evaluation never reads it: `sessionInputsOf` splices in the parent's initial context, additional context and clock. | The column is NOT NULL, and `getSession` / the child drill-in read it. Evaluation reading only the parent is what D5 needs. |
| P4-2 | **Root dispositions are written onto the children's cached nodes.** After `composeRun`, a conflict loser carries `disposition.withheldBy: 'conflict'` (`findingIds: [conflictId]`), and a pair suppression carries `withheldBy: 'safety'`, and a drug another pathway marks `contraindicated`/`avoid` (the merge's `PATHWAY`-source suppression) carries `withheldBy: 'conflict'` with `findingIds: []` on every proposing node; the node stating the constraint keeps its status. `WithheldBy` stays `SAFETY | CONFLICT`: a constraint is one pathway overruling another, not a patient finding. The child's `result_hash` stays the hash of its **contribution**. The run hash covers every child hash and the merged plan. | Spec §3 step 3 puts `withheldBy: 'conflict'` on the losing node, and a provider drilling into a child must see the node withheld. The contribution hash is what the child alone decided; the root's decisions are in the run hash. |
| P4-3 | **Recommendation identity inside `composeRun` is pathway-qualified** (`recommendationKey`: `pathwayId|nodeId`). It is used for the pair check, suppressions and withholding. Review #5 therefore **passes** here instead of being pinned. | The pair check is new code in this plan, and qualifying costs one function. F1 (a qualified identity everywhere a recommendation crosses a boundary: conflict candidates, `evidenceGateIds`, the materializer) stays a follow-up. |
| P4-4 | **`composeRun` projects each child's state in nodeId order.** | `projectResolutionToCarePlan` and `mergeResolvedCarePlans` keep first-seen entries, and state order follows override input order. This is the plan 02 defect class; property (b) for runs is the check. |
| P4-5 | **Run events are logged on children** (`pathway_resolution_events` has a foreign key to single sessions). An answer or override logs on its child. A fact logs `context_update` on every child. `resolveConflict` logs no event: the decision records `resolvedBy` and `resolvedAt` in `conflict_resolutions`. | There is no parent events table, and adding one is not in the spec. |
| P4-6 | **The run's readiness reaches the API only through `generateMergedCarePlan`'s blockers.** No new `blockers` field is added to `MultiPathwayResolutionSession`. | The UI already renders generation blockers, and the conflict panel already shows what is unresolved. YAGNI. |
| P4-7 | **`commitEvaluation` throws `CHILD_OF_MULTI_PATHWAY_SESSION` for a child**, besides the resolvers routing children to `commitRun`. | A child committed alone would bypass the run's lock (D6). The routing is the path; the throw is the invariant. |
| P4-8 | **`EMPTY_PLAN` for a run keeps today's definition**: medications, labs and procedures in the merged plan. | Spec §3, *Out of scope*: review #11. |
| P4-9 | **`runPatientContextDdi`, `runCrossRecommendationDdi`, `applyDdiToResolutionState` and `ddi-pass-single-pathway.ts` are deleted.** `ddiSuppressionReason` moves to `pipeline/disposition.ts`. Plan 01's skipped benchmark gets a minimal port of its safety stage so the file still loads. Measuring the real pipeline is plan 05's rewrite. | Nothing in production calls them after Task 6. A skipped suite that cannot import still FAILS in Jest. |
| P4-10 | **`declareRequiredInputs` stays on the scorers.** Plan 03 *Appendix A* suggested deleting it here. | It is a scorer-interface member used by five scorers and tested in three suites, two of them the pre-existing failing ones. Removing it is unrelated churn, and the spec's deletion list does not name it. |
| P4-11 | **`SuppressedRecommendation` gains `sourcePathwayId` and `suppressedByRecommendationName`.** | Spec §5.10: "a suppressed medication shows both its pathway reason and its safety reason". A pair (`OTHER_RECOMMENDATION`) suppression had no field for the other drug, and the admin showed "interacts with patient med" for it. |
| P4-12 | **Admin branches:** the integration branch `feat/evaluation-pipeline` is created from `origin/master` (overview, *Branches*). This plan's branch is `feat/evaluation-pipeline-04-multi-pathway`, and its PR goes into that integration branch. **Pushing the new admin integration branch needs the user's approval** (Task 0), as the prism-graphql one did in plan 02. | Same branch model as prism-graphql. |
| P4-13 | **Admin: the encounter page shows the session query's data first, and the start mutation's data only until the query has loaded.** | Apollo does not update a mutation's `data` from the cache. After an answer and refetch, the page kept showing the start result, and so a stale `resultHash`. Every generation would then return `PLAN_CHANGED_SINCE_REVIEW`. |
| P4-14 | **The run fingerprint is the hash of the sorted `(pathwayId, child envFingerprint)` pairs.** Each child fingerprint already covers the shared configuration, the shared safety reference and that child's graph. | Spec C4 says the fingerprint covers shared configuration plus each graph fingerprint, and this is exactly that without a second hashing scheme. |
| P4-15 | **Patient-medication `SAFETY_DATA_UNAVAILABLE` is reported by each contribution** (tagged with its pathway). The root adds only write-ins it cannot normalise. | Every child checks the patient's medications at CONTRIBUTION scope (C3). A root copy would be a duplicate with no pathway. |

## Baseline

| Point | Passed | Failed | Skipped |
|---|---|---|---|
| Plan 03 end (`c509273`) | 1618 | 9 | 9 |
| Task 0 (base) | … | 9 | … |
| Task 11 (end) | … | 9 | … |

## File map

| File | Responsibility | Task |
|---|---|---|
| `shared/data-layer/migrations/068_run_inputs.sql` (create) | Purge; run input + cache columns; clock NOT NULL | 1 |
| `services/resolution/pipeline/types.ts` (modify) | `RunBlocker`, `RunChildResult`, `RunResult` | 2 |
| `services/resolution/multi-pathway-session-store.ts` (modify) | `insertRun`, `writeRunEvaluation`, `writeRunLifecycle`, `setRunCarePlanId`, `setContributingSessions`, `runColumns`, `insertRunColumns`, `runRowToSession`; loses the old writers (T6) | 2, 6 |
| `services/resolution/session-store.ts` (modify) | `writeChildEvaluation`, `writeChildrenLifecycle`; child-facts guard in `insertSession` | 2 |
| `services/resolution/pipeline/load-env.ts` (modify) | `loadRunEnv`, `runEnvOf`, `PathwayMeta`, `RunEnv` | 3 |
| `services/resolution/pipeline/compose.ts` (create) | `composeRun`, `selectConflicts`, `recommendationKey`, `runHashOf`, `setsOf`, `WRITE_IN` | 4 |
| `services/resolution/care-plan-projection.ts`, `pipeline/disposition.ts` (modify) | export `projectMedication`, `findingId` | 4 |
| `services/resolution/pipeline/run.ts` (create) | `RunInputs`, `ChildInputs`, `Run`, `sessionInputsOf`, `runInputsOf`, `writeInsOf`, `RunRequest`, `evaluateRun` | 5 |
| `services/resolution/pipeline/run-commit.ts` (create) | `commitRun`, `loadRun`, `assertRunMutable`, `writeRun`, `flushRunAudits`, `childChange` | 5 |
| `services/resolution/pipeline/request.ts`, `commit.ts` (modify) | `evaluateAs`; `childOfRunError` + guard | 5 |
| `__tests__/fixtures/resolver-harness.ts` (modify) | runs table, run store mock, `loadRunEnv` mock, matched pathways | 5 |
| `resolvers/mutations/multi-pathway-resolution.ts` (modify) | start / resolveConflict / generate / abandon on the pipeline; dead code out | 6 |
| `resolvers/mutations/resolution.ts` (modify) | child routing; child-level generate/abandon refused; exported `formatBlocker`, `warningsOf`, `PLAN_CHANGED` | 6 |
| `apps/pathway-service/schema.graphql` (modify) | run revision/hash/fingerprint; reviewed hash on merged generation; no re-merge; suppression fields | 6 |
| `services/medications/ddi-pass.ts`, `ddi-pass-single-pathway.ts` (modify / delete) | dead DDI orchestration out | 7 |
| `__tests__/pipeline-run-sequence-vs-fresh.test.ts` (create) | properties (a) and (b) for runs; reproductions #2 #5 #6 #7 end to end | 8 |
| `__tests__/pipeline-postgres.test.ts` (modify) | 068, run revision lock, concurrent merged generation | 9 |
| admin `src/lib/graphql/**`, `src/types/index.ts`, encounter page, preview panel, `PendingGatesPanel`, `ResolutionResults` | reviewed hash, no re-merge, refetch, suppression display | 10 |

Test files are listed in each task. *Appendix B* maps every retired test.

---

### Task 0: Worktrees and baselines

- [ ] **Step 1: The admin integration branch (needs approval)**

Check it does not already exist:

```bash
git -C /home/claude/workspace/prism-admin-dashboard fetch origin
git -C /home/claude/workspace/prism-admin-dashboard ls-remote --heads origin feat/evaluation-pipeline
```

If it is absent, it must be created from `origin/master` (P4-12). **Push it only if the user's
execution instructions approve pushing the admin integration branch. Otherwise stop and ask.**

```bash
git -C /home/claude/workspace/prism-admin-dashboard push origin origin/master:refs/heads/feat/evaluation-pipeline
```

- [ ] **Step 2: Create both worktrees**

Run `/new-feature` for **prism-graphql and prism-admin-dashboard**, branch
`feat/evaluation-pipeline-04-multi-pathway`:
- prism-graphql from **`origin/feat/evaluation-pipeline`**;
- prism-admin-dashboard from **`origin/feat/evaluation-pipeline`** (its own integration branch,
  Step 1).

Neither comes from `origin/main` / `origin/master`. Then unset the upstream `/new-feature` sets,
so a bare push can never target the integration branch:

```bash
git -C $W branch --unset-upstream
git -C $AD branch --unset-upstream
git -C $W log --oneline -1     # expect c509273 or a later merge on the integration branch
```

- [ ] **Step 3: Baselines**

```bash
npm install --prefix $W
git -C $W checkout -- package-lock.json   # npm strips "peer": true flags; not this plan's change
npm test --prefix $W/apps/pathway-service -- --runInBand 2>&1 | grep -E "^(FAIL|Tests:)" | sort | uniq -c
npm install --prefix $AD
git -C $AD checkout -- package-lock.json
npm run lint --prefix $AD 2>&1 | tail -3
$AD/node_modules/.bin/tsc -p $AD/tsconfig.json --noEmit 2>&1 | tail -3
npm run build --prefix $AD 2>&1 | tail -3
```
Expected:
- prism-graphql: the only `FAIL` lines are the two scorer suites, with `9 failed`.
- admin: record the lint, typecheck and build outcomes as they are today. Task 10 must not add
  a new lint or type error or break the build; pre-existing problems are not this plan's.

Record the counts in *Baseline*.

---

### Task 1: Migration 068

**Files:**
- Create: `shared/data-layer/migrations/068_run_inputs.sql`
- Test: `apps/pathway-service/src/__tests__/pipeline-migration-068.test.ts`

**Interfaces:**
- Produces, on `multi_pathway_resolution_sessions`: `revision INT`, `additional_context`,
  `env_fingerprint`, `result_hash`, `readiness`; `temporal_context` NOT NULL.

- [ ] **Step 1: Write the failing test**

Create `apps/pathway-service/src/__tests__/pipeline-migration-068.test.ts`:

```ts
import { readFileSync } from 'fs';
import { join } from 'path';

const SQL = readFileSync(
  join(__dirname, '../../../../shared/data-layer/migrations/068_run_inputs.sql'),
  'utf-8',
);
const body = SQL.replace(/--.*$/gm, ''); // statements only, comments stripped

describe('migration 068 — run inputs', () => {
  it('purges both session tables before reshaping, inside one transaction', () => {
    const begin = body.indexOf('BEGIN;');
    const purgeRuns = body.indexOf('DELETE FROM multi_pathway_resolution_sessions;');
    const purgeSessions = body.indexOf('DELETE FROM pathway_resolution_sessions;');
    const alter = body.indexOf('ALTER TABLE multi_pathway_resolution_sessions');
    expect(begin).toBeGreaterThanOrEqual(0);
    expect(purgeRuns).toBeGreaterThan(begin);
    expect(purgeSessions).toBeGreaterThan(begin);
    expect(alter).toBeGreaterThan(Math.max(purgeRuns, purgeSessions));
    expect(body.trim().endsWith('COMMIT;')).toBe(true);
  });

  it.each([
    'revision INT NOT NULL DEFAULT 0',
    "additional_context JSONB NOT NULL DEFAULT '{}'",
    'env_fingerprint TEXT NOT NULL',
    'result_hash TEXT NOT NULL',
    'readiness JSONB NOT NULL',
  ])('adds %s', (column) => {
    expect(body).toContain(`ADD COLUMN ${column}`);
  });

  it('pins the run clock', () => {
    expect(body).toContain('ALTER COLUMN temporal_context SET NOT NULL');
  });

  it('leaves pathway_resolution_sessions alone (067 reshaped it)', () => {
    expect(body).not.toMatch(/ALTER TABLE pathway_resolution_sessions/);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test --prefix $W/apps/pathway-service -- --runInBand src/__tests__/pipeline-migration-068.test.ts`
Expected: FAIL with `ENOENT … 068_run_inputs.sql`.

- [ ] **Step 3: Write the migration**

Create `shared/data-layer/migrations/068_run_inputs.sql`:

```sql
-- Migration 068: multi-pathway runs on the evaluation pipeline (spec §3, §4; plan 04).
--
-- The parent of a run owns the patient facts added after start, the clock,
-- the conflict decisions and the run's single revision (D5, D6). Its merged
-- plan, readiness and hashes are a cache of the last committed composition,
-- recomputed by every mutation on the run.
--
-- 1. Purge (D8). Runs created on the integration branch since 067 have none
--    of these columns, and their children carry no parent_session_id.
-- 2. multi_pathway_resolution_sessions gains revision, additional_context,
--    env_fingerprint, result_hash and readiness; its clock becomes NOT NULL,
--    as 067 did for single sessions.
--
-- Run once. The purge deletes every session.

BEGIN;

DELETE FROM multi_pathway_resolution_sessions;
DELETE FROM pathway_resolution_sessions;

ALTER TABLE multi_pathway_resolution_sessions
  ADD COLUMN revision INT NOT NULL DEFAULT 0,
  ADD COLUMN additional_context JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN env_fingerprint TEXT NOT NULL,
  ADD COLUMN result_hash TEXT NOT NULL,
  ADD COLUMN readiness JSONB NOT NULL,
  ALTER COLUMN temporal_context SET NOT NULL;

COMMIT;
```

- [ ] **Step 4: Run the test**

Run the Step 2 command. Expected: PASS (8 tests).

**Falsify:** delete `ADD COLUMN result_hash TEXT NOT NULL,` from the SQL. The
`adds result_hash TEXT NOT NULL` case must fail. Restore it.

- [ ] **Step 5: Commit**

```bash
git -C $W add shared/data-layer/migrations/068_run_inputs.sql apps/pathway-service/src/__tests__/pipeline-migration-068.test.ts
git -C $W commit -m "feat(data-layer): migration 068 stores run inputs on multi-pathway sessions

Purges sessions (D8) and adds the run's revision, additional context,
environment fingerprint, result hash and readiness; the run clock
becomes NOT NULL (spec §4 step 3, deferred from plan 03 as P3-1).

Claude-Session: https://claude.ai/code/session_01XRNkZvQrxmRLNtJHxq71kH"
```

---

### Task 2: Run store

**Files:**
- Modify: `apps/pathway-service/src/services/resolution/pipeline/types.ts`
- Modify: `apps/pathway-service/src/services/resolution/multi-pathway-session-store.ts`
- Modify: `apps/pathway-service/src/services/resolution/session-store.ts`
- Test: `apps/pathway-service/src/__tests__/run-store.test.ts`

This task is **additive**: `createMultiPathwaySession`, `markMultiPathwaySessionStatus` and
`updateMergedPlanAndResolutions` stay until Task 6, because the resolvers call them until then.

**Interfaces:**
- Consumes: `evaluationColumns`, `Db`, `SessionInputs`, `EvaluationResult` (plan 03).
- Produces:
  - `interface RunBlocker extends ScopedBlocker { pathwayId?: string }`
  - `interface RunChildResult { pathwayId: string; sessionId: string; result: EvaluationResult }`
  - `interface RunResult { mergedPlan: MergedCarePlan; safetyFindings: ScopedFinding[]; ddiWarnings: ScopedFinding[]; readiness: { ready: boolean; blockers: RunBlocker[] }; children: RunChildResult[]; envFingerprint: string; resultHash: string }`
  - `interface NewRun { patientId: string; providerId: string; isPreview: boolean; initialPatientContext: PatientContext; temporalContext: EvaluationTemporalContext; additionalContext: Partial<AdditionalContextInput>; conflictResolutions: Record<string, ConflictResolution>; result: RunResult }`
  - `runColumns(args: { additionalContext; conflictResolutions; result: RunResult; status: MultiPathwaySessionStatus }): Record<string, unknown>`
  - `insertRunColumns(r: NewRun): Record<string, unknown>`
  - `insertRun(db: Db, r: NewRun): Promise<string>`
  - `setContributingSessions(db: Db, runId: string, sessionIds: string[], pathwayIds: string[]): Promise<void>`
  - `writeRunEvaluation(db: Db, args: { runId: string; expectedRevision: number; additionalContext; conflictResolutions; result: RunResult; status: MultiPathwaySessionStatus }): Promise<boolean>`
  - `writeRunLifecycle(db: Db, args: { runId: string; expectedRevision: number; status: MultiPathwaySessionStatus }): Promise<boolean>`
  - `setRunCarePlanId(db: Db, runId: string, carePlanId: string): Promise<void>`
  - `runRowToSession(row: Record<string, unknown>): MultiPathwayResolutionSession` (the renamed, exported `rowToSession`)
  - New `MultiPathwayResolutionSession` fields: `revision`, `additionalContext`, `envFingerprint`,
    `resultHash`, `readiness`; `temporalContext` becomes required.
  - `writeChildEvaluation(db: Db, args: { sessionId: string; inputs: SessionInputs; result: EvaluationResult; status: SessionStatus; durationMs: number }): Promise<void>`
  - `writeChildrenLifecycle(db: Db, parentId: string, status: SessionStatus, carePlanId?: string): Promise<void>`

- [ ] **Step 1: Write the failing test**

Create `apps/pathway-service/src/__tests__/run-store.test.ts`:

```ts
import {
  insertRun,
  insertRunColumns,
  runRowToSession,
  setContributingSessions,
  writeRunEvaluation,
  writeRunLifecycle,
} from '../services/resolution/multi-pathway-session-store';
import { insertSession, writeChildEvaluation, writeChildrenLifecycle } from '../services/resolution/session-store';
import { evaluate } from '../services/resolution/pipeline/evaluate';
import { replayObservations } from '../services/resolution/pipeline/observations';
import { SessionStatus } from '../services/resolution/types';
import { edge, makeEnv, makeInputs, node } from './fixtures/pipeline-env';

const EMPTY_PLAN = {
  sourcePathwayIds: [], medications: [], labs: [], imaging: [], procedures: [], guidance: [],
  schedules: [], qualityMetrics: [], suppressed: [], conflicts: [], catchUpItems: [], evidenceTrail: [], dataGapHints: [],
};
const RESULT = {
  mergedPlan: EMPTY_PLAN, safetyFindings: [], ddiWarnings: [],
  readiness: { ready: false, blockers: [{ scope: 'OUTPUT', type: 'EMPTY_PLAN', description: 'empty', relatedNodeIds: [] }] },
  children: [], envFingerprint: 'env-run', resultHash: 'hash-run',
};
const ALLERGY = { allergies: [{ code: '91936005', system: 'SNOMED' }] };
const env = makeEnv([node('root', 'Pathway'), node('step', 'Step')], [edge('root', 'step')]);
const inputs = makeInputs(env);
const NEW_RUN = {
  patientId: 'pt', providerId: 'pr', isPreview: true,
  initialPatientContext: inputs.initialPatientContext, temporalContext: inputs.temporalContext,
  additionalContext: ALLERGY,
  conflictResolutions: { beta_blocker: { kind: 'REJECT_BOTH', resolvedBy: 'pr', resolvedAt: 't' } },
  result: RESULT,
};
const contribution = () => evaluate(inputs, env, replayObservations(new Map(), 'test-model'), 'CONTRIBUTION');

function fakeDb(rowCount = 1) {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  return {
    calls,
    query: jest.fn(async (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
      return { rows: [{ id: 'row-1' }], rowCount };
    }),
  };
}

describe('run store (plan 04)', () => {
  it('insertRun writes identity, clock, parent inputs and the composition cache in one row', async () => {
    const db = fakeDb();
    await expect(insertRun(db as never, NEW_RUN as never)).resolves.toBe('row-1');
    const { sql, params } = db.calls[0];
    expect(sql).toMatch(/^INSERT INTO multi_pathway_resolution_sessions \(/);
    for (const col of ['is_preview', 'temporal_context', 'additional_context', 'conflict_resolutions',
      'merged_plan', 'ddi_warnings', 'readiness', 'result_hash', 'env_fingerprint']) {
      expect(sql).toContain(col);
    }
    // Placeholder count must equal the parameter array, or pg throws at runtime.
    expect(sql).toContain(`$${params.length})`);
    expect(sql).not.toContain(`$${params.length + 1}`);
  });

  it('insertRun refuses a run with no clock', async () => {
    await expect(insertRun(fakeDb() as never, { ...NEW_RUN, temporalContext: undefined } as never))
      .rejects.toThrow(/temporalContext/);
  });

  it('writeRunEvaluation is a compare-and-set on the run revision and an ACTIVE run (D6)', async () => {
    const db = fakeDb(1);
    const args = { runId: 'run-1', expectedRevision: 2, additionalContext: {}, conflictResolutions: {}, result: RESULT, status: 'ACTIVE' };
    await expect(writeRunEvaluation(db as never, args as never)).resolves.toBe(true);
    const { sql, params } = db.calls[0];
    expect(sql).toContain('revision = revision + 1');
    expect(sql).toMatch(/WHERE id = \$\d+ AND revision = \$\d+ AND status = 'ACTIVE'/);
    expect(params.slice(-2)).toEqual(['run-1', 2]);

    await expect(writeRunEvaluation(fakeDb(0) as never, args as never)).resolves.toBe(false);
    await expect(writeRunLifecycle(fakeDb(0) as never, { runId: 'run-1', expectedRevision: 2, status: 'ABANDONED' }))
      .resolves.toBe(false);
  });

  it('runRowToSession round-trips the run inputs and cache (the JSONB column shapes)', () => {
    const row = {
      ...JSON.parse(JSON.stringify(insertRunColumns(NEW_RUN as never))),
      id: 'run-1', revision: 4, contributing_session_ids: ['c1'], contributing_pathway_ids: ['p1'],
      care_plan_id: null, created_at: new Date(), updated_at: new Date(),
    };
    const run = runRowToSession(row);
    expect(run).toMatchObject({
      id: 'run-1', revision: 4, status: 'ACTIVE', isPreview: true, resultHash: 'hash-run', envFingerprint: 'env-run',
      additionalContext: ALLERGY, conflictResolutions: NEW_RUN.conflictResolutions, contributingSessionIds: ['c1'],
    });
    expect(run.readiness.blockers[0].type).toBe('EMPTY_PLAN');
    expect(run.temporalContext).toEqual(JSON.parse(JSON.stringify(inputs.temporalContext)));
  });

  it('setContributingSessions writes both arrays as uuid[]', async () => {
    const db = fakeDb();
    await setContributingSessions(db as never, 'run-1', ['c1', 'c2'], ['p1', 'p2']);
    expect(db.calls[0].sql).toMatch(/contributing_session_ids = \$2::uuid\[\], contributing_pathway_ids = \$3::uuid\[\]/);
    expect(db.calls[0].params).toEqual(['run-1', ['c1', 'c2'], ['p1', 'p2']]);
  });

  it('writeChildEvaluation writes a CHILD only, never a fact onto it, and checks no child revision (D5, D6)', async () => {
    const result = await contribution();
    const db = fakeDb(1);
    await writeChildEvaluation(db as never, {
      sessionId: 'c1', inputs: { ...inputs, additionalContext: ALLERGY }, result, status: SessionStatus.ACTIVE, durationMs: 1,
    });
    const { sql, params } = db.calls[0];
    expect(sql).toContain('AND parent_session_id IS NOT NULL');
    expect(sql).not.toMatch(/revision = \$/); // the parent's revision is the lock
    expect(params).not.toContain(JSON.stringify(ALLERGY));

    await expect(writeChildEvaluation(fakeDb(0) as never, {
      sessionId: 'lone', inputs, result, status: SessionStatus.ACTIVE, durationMs: 1,
    })).rejects.toThrow(/not the child of a run/);
  });

  it('writeChildrenLifecycle moves every child of the run', async () => {
    const db = fakeDb();
    await writeChildrenLifecycle(db as never, 'run-1', SessionStatus.COMPLETED, 'cp-1');
    expect(db.calls[0].sql).toContain('WHERE parent_session_id = $1');
    expect(db.calls[0].params).toEqual(['run-1', 'COMPLETED', 'cp-1']);
  });

  it('insertSession refuses a child that carries patient facts (D5)', async () => {
    await expect(insertSession(fakeDb() as never, {
      pathwayVersion: '1', patientId: 'pt', providerId: 'pr', inputs: { ...inputs, additionalContext: ALLERGY },
      result: await contribution(), status: SessionStatus.ACTIVE, durationMs: 1, parentSessionId: 'run-1',
    })).rejects.toThrow(/holds no patient facts/);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test --prefix $W/apps/pathway-service -- --runInBand src/__tests__/run-store.test.ts`
Expected: FAIL with `insertRun is not a function`.

- [ ] **Step 3: The run result types**

In `services/resolution/pipeline/types.ts`, replace
`import type { CatchUpItem } from '../care-plan-merge';` with
`import type { CatchUpItem, MergedCarePlan } from '../care-plan-merge';`, and append:

```ts
/** A blocker at the root of a run. A completeness blocker propagated from a child names its pathway (C3). */
export interface RunBlocker extends ScopedBlocker {
  pathwayId?: string;
}

/** One child of a run after composition. */
export interface RunChildResult {
  pathwayId: string;
  /** '' before the child row exists (start). */
  sessionId: string;
  /**
   * The contribution, with the root's dispositions — conflict losers and pair
   * suppressions — applied to its nodes (P4-2). `resultHash` stays the
   * contribution's own.
   */
  result: EvaluationResult;
}

/** A composed run (spec §3). */
export interface RunResult {
  mergedPlan: MergedCarePlan;
  /** Findings the root raised: write-ins against the patient, and every pair (C3). */
  safetyFindings: ScopedFinding[];
  /** Every WARN finding in the run: the contributions' and the root's. */
  ddiWarnings: ScopedFinding[];
  readiness: { ready: boolean; blockers: RunBlocker[] };
  /** In contributing order. */
  children: RunChildResult[];
  envFingerprint: string;
  resultHash: string;
}
```

- [ ] **Step 4: The run store**

In `services/resolution/multi-pathway-session-store.ts`:

1. Add to the imports:

```ts
import type { PatientContext } from '../confidence/types';
import type { AdditionalContextInput } from '../../resolvers/mutations/resolution';
import type { RunBlocker, RunResult } from './pipeline/types';
import type { Db } from './session-store';
```

2. In `interface MultiPathwayResolutionSession`, directly after `status: MultiPathwaySessionStatus;`,
   add:

```ts
  /** Optimistic-lock counter for the whole run (D6); every committed write increments it. */
  revision: number;
  /** Patient facts supplied after start, on any child of the run (D5). */
  additionalContext: Partial<AdditionalContextInput>;
  /** Cache of the last committed composition. Never an input. */
  envFingerprint: string;
  resultHash: string;
  readiness: { ready: boolean; blockers: RunBlocker[] };
```

   and replace its `temporalContext?: EvaluationTemporalContext;` (with the comment above it) by:

```ts
  /** The run's clock, shared by every child. NOT NULL since migration 068. */
  temporalContext: EvaluationTemporalContext;
```

3. Directly before `// ─── Helpers ───`, add:

```ts
// ─── Runs on the evaluation pipeline (plan 04) ──────────────────────

export interface NewRun {
  patientId: string;
  providerId: string;
  isPreview: boolean;
  initialPatientContext: PatientContext;
  temporalContext: EvaluationTemporalContext;
  additionalContext: Partial<AdditionalContextInput>;
  conflictResolutions: Record<string, ConflictResolution>;
  result: RunResult;
}

/** JSONB parameters are sent as JSON text; scalars pass through. */
const param = (v: unknown): unknown => (v !== null && typeof v === 'object' ? JSON.stringify(v) : v);

/** The columns a composition writes: the parent's mutable inputs and the cache of the run's result. */
export function runColumns(args: {
  additionalContext: Partial<AdditionalContextInput>;
  conflictResolutions: Record<string, ConflictResolution>;
  result: RunResult;
  status: MultiPathwaySessionStatus;
}): Record<string, unknown> {
  return {
    status: args.status,
    additional_context: args.additionalContext,
    conflict_resolutions: args.conflictResolutions,
    merged_plan: args.result.mergedPlan,
    ddi_warnings: args.result.ddiWarnings,
    readiness: args.result.readiness,
    env_fingerprint: args.result.envFingerprint,
    result_hash: args.result.resultHash,
  };
}

/** Every column of a new run: identity, the immutable inputs, then `runColumns`. The contributing arrays are set once the children exist. */
export function insertRunColumns(r: NewRun): Record<string, unknown> {
  return {
    patient_id: r.patientId,
    provider_id: r.providerId,
    is_preview: r.isPreview,
    initial_patient_context: r.initialPatientContext,
    temporal_context: r.temporalContext,
    ...runColumns({ ...r, status: 'ACTIVE' }),
  };
}

export async function insertRun(db: Db, r: NewRun): Promise<string> {
  // Types are erased and tests are not typechecked: a clock-less run could
  // never be evaluated again, so refuse it here rather than at the NOT NULL.
  if (!r.temporalContext) {
    throw new Error('insertRun requires temporalContext — a run with no pinned clock cannot be evaluated');
  }
  const cols = insertRunColumns(r);
  const names = Object.keys(cols);
  const result = await db.query(
    `INSERT INTO multi_pathway_resolution_sessions (${names.join(', ')})
     VALUES (${names.map((_, i) => `$${i + 1}`).join(', ')})
     RETURNING id`,
    names.map((n) => param(cols[n])),
  );
  return result.rows[0].id;
}

/** The children exist only after the run row does; written once, in the start transaction. */
export async function setContributingSessions(db: Db, runId: string, sessionIds: string[], pathwayIds: string[]): Promise<void> {
  await db.query(
    `UPDATE multi_pathway_resolution_sessions
        SET contributing_session_ids = $2::uuid[], contributing_pathway_ids = $3::uuid[]
      WHERE id = $1`,
    [runId, sessionIds, pathwayIds],
  );
}

/**
 * Commit a composition as a compare-and-set on the run's revision (D6).
 * Returns false when another write moved the run or it left ACTIVE; the caller
 * rolls back and retries. `status: COMPLETED` is generation's claim.
 */
export async function writeRunEvaluation(
  db: Db,
  args: {
    runId: string;
    expectedRevision: number;
    additionalContext: Partial<AdditionalContextInput>;
    conflictResolutions: Record<string, ConflictResolution>;
    result: RunResult;
    status: MultiPathwaySessionStatus;
  },
): Promise<boolean> {
  const cols = runColumns(args);
  const names = Object.keys(cols);
  const result = await db.query(
    `UPDATE multi_pathway_resolution_sessions
        SET ${names.map((n, i) => `${n} = $${i + 1}`).join(', ')}, revision = revision + 1, updated_at = NOW()
      WHERE id = $${names.length + 1} AND revision = $${names.length + 2} AND status = 'ACTIVE'`,
    [...names.map((n) => param(cols[n])), args.runId, args.expectedRevision],
  );
  return result.rowCount === 1;
}

/** Lifecycle-only change (abandon): no evaluation, same revision check (spec §4). */
export async function writeRunLifecycle(
  db: Db,
  args: { runId: string; expectedRevision: number; status: MultiPathwaySessionStatus },
): Promise<boolean> {
  const result = await db.query(
    `UPDATE multi_pathway_resolution_sessions
        SET status = $1, revision = revision + 1, updated_at = NOW()
      WHERE id = $2 AND revision = $3 AND status = 'ACTIVE'`,
    [args.status, args.runId, args.expectedRevision],
  );
  return result.rowCount === 1;
}

/** Inside generation's claimed transaction only. */
export async function setRunCarePlanId(db: Db, runId: string, carePlanId: string): Promise<void> {
  await db.query('UPDATE multi_pathway_resolution_sessions SET care_plan_id = $1 WHERE id = $2', [carePlanId, runId]);
}
```

4. Rename `function rowToSession(` to `export function runRowToSession(`, update its single call
   in `getMultiPathwaySession`, and add inside its returned object, directly after
   `status: row.status as MultiPathwaySessionStatus,`:

```ts
    revision: (row.revision as number) ?? 0,
    additionalContext: (row.additional_context as Partial<AdditionalContextInput>) ?? {},
    envFingerprint: (row.env_fingerprint as string) ?? '',
    resultHash: (row.result_hash as string) ?? '',
    readiness: (row.readiness as MultiPathwayResolutionSession['readiness']) ?? { ready: false, blockers: [] },
```

   and leave its `temporalContext:` line as it is (`(row.temporal_context ?? undefined) as …`).
   Migration 068 makes the column NOT NULL, but `session-temporal-context.test.ts` still reads a
   pre-migration fixture row and expects `undefined`. The single-session store did the same in
   plan 03.

- [ ] **Step 5: Children in the session store**

In `services/resolution/session-store.ts`:

1. In `insertSession`, directly after the `temporalContext` guard, add:

```ts
  // D5: the parent of a run owns every patient fact, and 067's CHECK
  // rejects a child with any. Refuse it here, where the cause is readable.
  if (s.parentSessionId && Object.keys(s.inputs.additionalContext ?? {}).length > 0) {
    throw new Error('insertSession: a child of a run holds no patient facts — the parent owns them (D5)');
  }
```

2. Directly after `setCarePlanId`, add:

```ts
/**
 * A child of a run, written in the run's transaction. The PARENT's revision is
 * the lock (D6): a child is never compare-and-set on its own. The row must be
 * a child, so this can never bypass a standalone session's lock, and its facts
 * are always written empty (D5).
 */
export async function writeChildEvaluation(
  db: Db,
  args: { sessionId: string; inputs: SessionInputs; result: EvaluationResult; status: SessionStatus; durationMs: number },
): Promise<void> {
  const cols = evaluationColumns({ ...args, inputs: { ...args.inputs, additionalContext: {} } });
  const names = Object.keys(cols);
  const result = await db.query(
    `UPDATE pathway_resolution_sessions
        SET ${names.map((n, i) => `${n} = $${i + 1}`).join(', ')}, revision = revision + 1, updated_at = NOW()
      WHERE id = $${names.length + 1} AND parent_session_id IS NOT NULL`,
    [...names.map((n) => param(cols[n])), args.sessionId],
  );
  if (result.rowCount !== 1) {
    throw new Error(`writeChildEvaluation: session ${args.sessionId} is not the child of a run`);
  }
}

/** Children follow the parent's lifecycle, in the parent's transaction (spec §3). */
export async function writeChildrenLifecycle(db: Db, parentId: string, status: SessionStatus, carePlanId?: string): Promise<void> {
  await db.query(
    `UPDATE pathway_resolution_sessions
        SET status = $2, care_plan_id = COALESCE($3, care_plan_id), revision = revision + 1, updated_at = NOW()
      WHERE parent_session_id = $1`,
    [parentId, status, carePlanId ?? null],
  );
}
```

- [ ] **Step 6: Run the tests and typecheck**

```bash
npm test --prefix $W/apps/pathway-service -- --runInBand src/__tests__/run-store.test.ts src/__tests__/session-store-evaluation.test.ts src/__tests__/multi-pathway-session-store-preview.test.ts src/__tests__/temporal/session-temporal-context.test.ts
$W/node_modules/.bin/tsc -p $W/apps/pathway-service/tsconfig.json --noEmit
```
Expected: PASS (the new file has 8 tests); typecheck clean. `runRowToSession` is the only
production code that builds a `MultiPathwayResolutionSession`, so the new required fields need no
other change.

**Falsify, one at a time, restoring each:**
1. In `writeRunEvaluation`, delete ` AND status = 'ACTIVE'`. The compare-and-set test must fail.
2. In `writeChildEvaluation`, pass `args` straight to `evaluationColumns`. The D5 test must fail
   on the allergy parameter.

- [ ] **Step 7: Commit**

```bash
git -C $W add apps/pathway-service/src/services/resolution/pipeline/types.ts apps/pathway-service/src/services/resolution/multi-pathway-session-store.ts apps/pathway-service/src/services/resolution/session-store.ts apps/pathway-service/src/__tests__/run-store.test.ts
git -C $W commit -m "feat(pathway-service): run store for parent inputs and composed results

insertRun and writeRunEvaluation store a run's inputs with the cache of
its composition; writeRunEvaluation is a compare-and-set on the run's
revision (D6). writeChildEvaluation writes a child only, never a fact
onto it (D5), and never on its own revision. Additive: the old writers
stay until the resolvers move (Task 6).

Claude-Session: https://claude.ai/code/session_01XRNkZvQrxmRLNtJHxq71kH"
```

---

### Task 3: One snapshot for a run — `loadRunEnv`

**Files:**
- Modify: `apps/pathway-service/src/services/resolution/pipeline/load-env.ts` (whole file below)
- Test: `apps/pathway-service/src/__tests__/pipeline-load-run-env.test.ts`

**Interfaces:**
- Consumes: `buildResolutionContext`, `loadScoringConfig`, `loadSafetyReference` (plan 02).
- Produces:
  - `interface PathwayMeta { logicalId: string; title: string; version: string }`
  - `interface RunEnv { children: Map<string, EvaluationEnv>; meta: Map<string, PathwayMeta>; safety: SafetyReference; envFingerprint: string; unnormalized: MedicationInput[] }`
  - `loadRunEnv(pool: Pool, pathwayIds: string[], universe: CandidateUniverse): Promise<RunEnv>`:
    one client, one `BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY`, every graph, one metadata
    query, ONE `loadSafetyReference`, then `COMMIT`. Every child env's `safety` is the same object.
  - `runEnvOf(children: Map<string, EvaluationEnv>, meta: Map<string, PathwayMeta>, safety?: SafetyReference): RunEnv`:
    the pure assembly. Without `safety`, it merges the children's; the harness uses this.
  - `loadEvaluationEnv` is unchanged in behaviour and in the statements it issues.

- [ ] **Step 1: Write the failing test**

Create `apps/pathway-service/src/__tests__/pipeline-load-run-env.test.ts`:

```ts
jest.mock('../resolvers/helpers/resolution-context', () => {
  const actual = jest.requireActual('../resolvers/helpers/resolution-context');
  return { ...actual, buildResolutionContext: jest.fn() };
});
jest.mock('../services/medications/safety-reference', () => {
  const actual = jest.requireActual('../services/medications/safety-reference');
  return { ...actual, loadSafetyReference: jest.fn() };
});
jest.mock('../services/llm/llm-gate-client', () => ({ loadLLMGateConfig: () => ({ model: 'm1' }) }));

import { buildGraphContext, buildResolutionContext } from '../resolvers/helpers/resolution-context';
import { loadSafetyReference } from '../services/medications/safety-reference';
import { loadRunEnv, runEnvOf } from '../services/resolution/pipeline/load-env';
import { edge, makeEnv, node } from './fixtures/pipeline-env';

const SCORING = {
  adminEvidenceEntries: [], weightMatrix: {}, nodeWeightMap: new Map(), propagationOverrides: new Map(),
  thresholds: { autoResolveThreshold: 0.85, suggestThreshold: 0.6, scope: 'SYSTEM_DEFAULT' },
};
const med = (id: string, name: string) => ({ id, nodeIdentifier: id, nodeType: 'Medication', properties: { name } });
const rctx = (meds: unknown[], suggestThreshold = 0.6) => ({
  graphContext: buildGraphContext([{ id: 'r', nodeIdentifier: 'root', nodeType: 'Pathway', properties: {} }, ...meds] as never, []),
  edges: [], signals: [],
  thresholds: { autoResolveThreshold: 0.85, suggestThreshold },
  confidenceEngine: { loadScoringConfig: jest.fn().mockResolvedValue(SCORING) },
  codeMap: new Map(), temporalDefaults: {},
});
const norm = (rxcui: string, name: string) => ({ ingredientRxcui: rxcui, ingredientName: name, atcClasses: [] });
const SAFETY = { normalized: new Map([['labetalol||', norm('6185', 'labetalol')]]), pairs: new Map(), classRules: [], allergyMappings: [] };
const PATIENT = {
  patientId: 'p', conditionCodes: [], labResults: [],
  medications: [{ code: '999', system: 'RxNorm', display: 'Mysterydrug' }],
  allergies: [{ code: '91936005', system: 'SNOMED' }],
} as never;
const META = [
  { id: 'a', logical_id: 'lp-a', title: 'A', version: '1.0' },
  { id: 'b', logical_id: 'lp-b', title: 'B', version: '2.0' },
];

function db() {
  const client = {
    query: jest.fn(async (sql: string) => ({ rows: String(sql).includes('pathway_graph_index') ? META : [] })),
    release: jest.fn(),
  };
  return { client, pool: { connect: jest.fn().mockResolvedValue(client) } };
}
const graphs = (bThreshold = 0.6) => async (_db: unknown, id: string) =>
  (id === 'a' ? rctx([med('m1', 'Labetalol')]) : rctx([med('m2', 'Nifedipine')], bThreshold));

beforeEach(() => {
  (buildResolutionContext as jest.Mock).mockReset().mockImplementation(graphs());
  (loadSafetyReference as jest.Mock).mockReset().mockResolvedValue(SAFETY);
});

describe('loadRunEnv (C4, D13)', () => {
  it('reads every child graph, the pathway metadata and ONE safety reference in one snapshot', async () => {
    const { client, pool } = db();
    const env = await loadRunEnv(pool as never, ['a', 'b'], { patient: PATIENT, writeIns: ['Tinidazole'] });

    expect(pool.connect).toHaveBeenCalledTimes(1);
    const sql = client.query.mock.calls.map((c) => String(c[0]));
    expect(sql[0]).toBe('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    expect(sql.at(-1)).toBe('COMMIT');
    expect(sql.filter((s) => s.includes('FROM pathway_graph_index'))).toHaveLength(1);
    expect(buildResolutionContext).toHaveBeenCalledTimes(2);
    expect(loadSafetyReference).toHaveBeenCalledTimes(1);
    const { medications, allergySnomedCodes } = (loadSafetyReference as jest.Mock).mock.calls[0][1];
    expect(medications.map((m: { text: string }) => m.text)).toEqual(['Labetalol', 'Nifedipine', 'Mysterydrug', 'Tinidazole']);
    expect(allergySnomedCodes).toEqual(['91936005']);

    expect(env.children.get('a')!.safety).toBe(env.safety);
    expect(env.children.get('b')!.safety).toBe(env.safety);
    expect(env.meta.get('b')).toEqual({ logicalId: 'lp-b', title: 'B', version: '2.0' });
    expect(env.unnormalized.map((m) => m.text)).toEqual(['Nifedipine', 'Mysterydrug', 'Tinidazole']);
    expect(client.release).toHaveBeenCalled();
  });

  it('the run fingerprint moves when one child’s configuration moves; the other child’s does not', async () => {
    const first = await loadRunEnv(db().pool as never, ['a', 'b'], { patient: PATIENT });
    (buildResolutionContext as jest.Mock).mockImplementation(graphs(0.7));
    const second = await loadRunEnv(db().pool as never, ['a', 'b'], { patient: PATIENT });

    expect(second.children.get('a')!.envFingerprint).toBe(first.children.get('a')!.envFingerprint);
    expect(second.children.get('b')!.envFingerprint).not.toBe(first.children.get('b')!.envFingerprint);
    expect(second.envFingerprint).not.toBe(first.envFingerprint);
  });

  it('rolls back and releases on failure', async () => {
    (buildResolutionContext as jest.Mock).mockRejectedValue(new Error('age down'));
    const { client, pool } = db();
    await expect(loadRunEnv(pool as never, ['a'], { patient: PATIENT })).rejects.toThrow('age down');
    expect(client.query.mock.calls.map((c) => c[0])).toContain('ROLLBACK');
    expect(client.release).toHaveBeenCalled();
  });

  it('a run with no pathways reads no graph and no metadata, and still loads the patient’s safety data', async () => {
    const { client, pool } = db();
    const env = await loadRunEnv(pool as never, [], { patient: PATIENT });
    expect(buildResolutionContext).not.toHaveBeenCalled();
    expect(client.query.mock.calls.some((c) => String(c[0]).includes('pathway_graph_index'))).toBe(false);
    expect(loadSafetyReference).toHaveBeenCalledTimes(1);
    expect(env.children.size).toBe(0);
  });
});

describe('runEnvOf', () => {
  it('points every child at one merged safety reference and fingerprints independently of order', () => {
    const a = makeEnv([node('root', 'Pathway')], [], { normalized: new Map([['x||', norm('1', 'x')]]) });
    const b = { ...makeEnv([node('root', 'Pathway'), node('s', 'Step')], [edge('root', 's')], { normalized: new Map([['y||', norm('2', 'y')]]) }), envFingerprint: 'env-b' };
    const meta = new Map();
    const ab = runEnvOf(new Map([['a', a], ['b', b]]), meta);
    const ba = runEnvOf(new Map([['b', b], ['a', a]]), meta);

    expect([...ab.safety.normalized.keys()].sort()).toEqual(['x||', 'y||']);
    expect(ab.children.get('a')!.safety).toBe(ab.safety);
    expect(ab.envFingerprint).toBe(ba.envFingerprint);
    expect(runEnvOf(new Map([['a', a]]), meta).envFingerprint).not.toBe(ab.envFingerprint);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test --prefix $W/apps/pathway-service -- --runInBand src/__tests__/pipeline-load-run-env.test.ts`
Expected: FAIL with `loadRunEnv is not a function`.

- [ ] **Step 3: Replace `pipeline/load-env.ts`**

Replace the whole file with the following. `loadEvaluationEnv` issues the same statements in the
same order as before (plan 02's `pipeline-load-env.test.ts` pins them); only its body moved into
helpers that `loadRunEnv` shares.

```ts
import { Pool } from 'pg';
import { buildResolutionContext } from '../../../resolvers/helpers/resolution-context';
import type { ResolutionContext } from '../../../resolvers/helpers/resolution-context';
import type { ScoringConfig } from '../../confidence/confidence-engine';
import type { PatientContext } from '../../confidence/types';
import { loadLLMGateConfig } from '../../llm/llm-gate-client';
import { SafetyReference, loadSafetyReference, normalizedKey } from '../../medications/safety-reference';
import type { MedicationInput } from '../../medications/types';
import { hashOf } from './canonical';

/** Everything evaluation reads, from one snapshot (spec C4). */
export interface EvaluationEnv {
  resolution: ResolutionContext;
  scoring: ScoringConfig;
  safety: SafetyReference;
  graphFingerprint: string;
  envFingerprint: string;
  llmModel: string | null;
  /**
   * Medications with no normalised row — WHOLE inputs (text, system, code),
   * one per cache key, for the non-blocking pre-warm. The cache is keyed on
   * all three; a text alone would pre-warm a row evaluation never reads.
   */
  unnormalized: MedicationInput[];
}

export interface CandidateUniverse {
  patient: PatientContext;
  /** Provider write-ins (CUSTOM_OVERRIDE) recorded in conflict_resolutions. */
  writeIns?: string[];
}

/** A contributing pathway's identity, for the merged plan's provenance. */
export interface PathwayMeta {
  logicalId: string;
  title: string;
  version: string;
}

/** Everything a run's evaluation reads, from ONE snapshot (C4, D13). */
export interface RunEnv {
  /** By pathway id. Every child's `safety` is `safety` below. */
  children: Map<string, EvaluationEnv>;
  meta: Map<string, PathwayMeta>;
  safety: SafetyReference;
  envFingerprint: string;
  unnormalized: MedicationInput[];
}

/** The drug name DDI reads for a Medication node — identical to applyDdiToResolutionState. */
export function medicationName(node: { nodeIdentifier: string; properties?: Record<string, unknown> }): string {
  return String(node.properties?.name ?? node.properties?.title ?? node.nodeIdentifier);
}

export function graphFingerprintOf(ctx: ResolutionContext): string {
  const byKey = <T>(key: (x: T) => string) => (a: T, b: T) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0);
  const nodes = ctx.graphContext.allNodes
    .map((n) => ({ id: n.nodeIdentifier, type: n.nodeType, properties: n.properties }))
    .sort(byKey((n) => n.id));
  const edges = ctx.edges
    .map((e) => ({ source: e.sourceId, target: e.targetId, type: e.edgeType, properties: e.properties }))
    .sort(byKey((e) => `${e.source}|${e.target}|${e.type}`));
  return hashOf({ nodes, edges });
}

/** One REPEATABLE READ snapshot on one client, closed before evaluation begins (C4). */
async function inSnapshot<T>(pool: Pool, read: (db: Pool) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const out = await read(client as unknown as Pool);
    await client.query('COMMIT');
    return out;
  } catch (err) {
    await client.query('ROLLBACK').catch((): void => undefined);
    throw err;
  } finally {
    client.release();
  }
}

async function readPathway(db: Pool, pathwayId: string): Promise<{ resolution: ResolutionContext; scoring: ScoringConfig }> {
  const resolution = await buildResolutionContext(db, pathwayId);
  const scoring = await resolution.confidenceEngine.loadScoringConfig({
    pool: db,
    pathwayId,
    nodes: resolution.graphContext.allNodes,
    signalDefinitions: resolution.signals,
  });
  return { resolution, scoring };
}

/** The candidate universe (C1): every Medication node, the patient's medications, every write-in. */
function candidateMedications(graphs: ResolutionContext[], universe: CandidateUniverse): MedicationInput[] {
  return [
    ...graphs.flatMap((r) => r.graphContext.allNodes.filter((n) => n.nodeType === 'Medication').map((n) => ({ text: medicationName(n) }))),
    ...universe.patient.medications.map((m) => ({ text: m.display ?? m.code, system: m.system, code: m.code })),
    ...(universe.writeIns ?? []).map((text) => ({ text })),
  ];
}

const allergyCodesOf = (universe: CandidateUniverse): string[] =>
  universe.patient.allergies.filter((a) => a.system === 'SNOMED').map((a) => a.code);

const unnormalizedOf = (medications: MedicationInput[], safety: SafetyReference): MedicationInput[] => [
  ...new Map(
    medications.filter((m) => !safety.normalized.has(normalizedKey(m))).map((m) => [normalizedKey(m), m]),
  ).values(),
];

function envOf(resolution: ResolutionContext, scoring: ScoringConfig, safety: SafetyReference, unnormalized: MedicationInput[]): EvaluationEnv {
  const graphFingerprint = graphFingerprintOf(resolution);
  const llmModel = loadLLMGateConfig()?.model ?? null;
  const envFingerprint = hashOf({
    graphFingerprint,
    signals: resolution.signals,
    thresholds: resolution.thresholds,
    codeMap: resolution.codeMap,
    temporalDefaults: resolution.temporalDefaults,
    scoring,
    safety,
    llmModel,
  });
  return { resolution, scoring, safety, graphFingerprint, envFingerprint, llmModel, unnormalized };
}

export async function loadEvaluationEnv(pool: Pool, pathwayId: string, universe: CandidateUniverse): Promise<EvaluationEnv> {
  const read = await inSnapshot(pool, async (db) => {
    const { resolution, scoring } = await readPathway(db, pathwayId);
    const medications = candidateMedications([resolution], universe);
    const safety = await loadSafetyReference(db, { medications, allergySnomedCodes: allergyCodesOf(universe) });
    return { resolution, scoring, medications, safety };
  });
  return envOf(read.resolution, read.scoring, read.safety, unnormalizedOf(read.medications, read.safety));
}

/**
 * A run's environment: every child's graph, the pathways' metadata and ONE
 * safety reference over the whole candidate universe, in one snapshot. No
 * child is ever composed with a result from a different snapshot (D13).
 */
export async function loadRunEnv(pool: Pool, pathwayIds: string[], universe: CandidateUniverse): Promise<RunEnv> {
  const read = await inSnapshot(pool, async (db) => {
    const graphs = new Map<string, { resolution: ResolutionContext; scoring: ScoringConfig }>();
    for (const id of pathwayIds) graphs.set(id, await readPathway(db, id));
    const metaRows = pathwayIds.length === 0
      ? []
      : (await db.query('SELECT id, logical_id, title, version FROM pathway_graph_index WHERE id = ANY($1::uuid[])', [pathwayIds])).rows;
    const medications = candidateMedications([...graphs.values()].map((g) => g.resolution), universe);
    const safety = await loadSafetyReference(db, { medications, allergySnomedCodes: allergyCodesOf(universe) });
    return { graphs, metaRows, medications, safety };
  });
  const children = new Map([...read.graphs].map(([id, g]) => [id, envOf(g.resolution, g.scoring, read.safety, [])]));
  const meta = new Map<string, PathwayMeta>(
    read.metaRows.map((r: { id: string; logical_id: string; title: string; version: string }) =>
      [r.id, { logicalId: r.logical_id, title: r.title, version: r.version }]),
  );
  return { ...runEnvOf(children, meta, read.safety), unnormalized: unnormalizedOf(read.medications, read.safety) };
}

/**
 * Assemble a run's environment from its children's. Without `safety`, the
 * children's references are merged — test fixtures build one per pathway.
 * The run fingerprint is the sorted (pathway, child fingerprint) pairs; each
 * child's already covers the shared configuration, the shared safety data and
 * its graph (P4-14).
 */
export function runEnvOf(children: Map<string, EvaluationEnv>, meta: Map<string, PathwayMeta>, safety?: SafetyReference): RunEnv {
  const shared = safety ?? mergeSafety([...children.values()].map((e) => e.safety));
  const pointed = new Map([...children].map(([id, e]) => [id, { ...e, safety: shared }] as [string, EvaluationEnv]));
  const envFingerprint = hashOf(
    [...pointed].map(([id, e]) => [id, e.envFingerprint]).sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0)),
  );
  return { children: pointed, meta, safety: shared, envFingerprint, unnormalized: [] };
}

function mergeSafety(parts: SafetyReference[]): SafetyReference {
  return {
    normalized: new Map(parts.flatMap((p) => [...p.normalized])),
    pairs: new Map(parts.flatMap((p) => [...p.pairs])),
    classRules: parts.flatMap((p) => p.classRules),
    allergyMappings: parts.flatMap((p) => p.allergyMappings),
  };
}
```

- [ ] **Step 4: Run the tests and typecheck**

```bash
npm test --prefix $W/apps/pathway-service -- --runInBand src/__tests__/pipeline-load-run-env.test.ts src/__tests__/pipeline-load-env.test.ts src/__tests__/pipeline-request.test.ts src/__tests__/pipeline-acceptance-a1.test.ts
$W/node_modules/.bin/tsc -p $W/apps/pathway-service/tsconfig.json --noEmit
```
Expected: PASS (5 new tests; plan 02's load-env suite unchanged); typecheck clean.

**Falsify, one at a time, restoring each:**
1. In `loadRunEnv`, move the `loadSafetyReference` call into the `for` loop, once per pathway. The
   *ONE safety reference* test must fail.
2. In `runEnvOf`, delete the `.sort(…)`. The order-independence test must fail.

- [ ] **Step 5: Commit**

```bash
git -C $W add apps/pathway-service/src/services/resolution/pipeline/load-env.ts apps/pathway-service/src/__tests__/pipeline-load-run-env.test.ts
git -C $W commit -m "feat(pathway-service): one environment snapshot for a whole run

loadRunEnv reads every child's graph, the pathways' metadata and one
safety reference over the run's whole candidate universe in a single
REPEATABLE READ transaction (C4, D13). The run fingerprint is the sorted
child fingerprints. loadEvaluationEnv is unchanged.

Claude-Session: https://claude.ai/code/session_01XRNkZvQrxmRLNtJHxq71kH"
```

---
### Task 4: `composeRun`

**Files:**
- Create: `apps/pathway-service/src/services/resolution/pipeline/compose.ts`
- Modify: `apps/pathway-service/src/services/resolution/care-plan-projection.ts` (export `projectMedication`)
- Modify: `apps/pathway-service/src/services/resolution/pipeline/disposition.ts` (export `findingId`)
- Test: `apps/pathway-service/src/__tests__/pipeline-compose.test.ts`

**Interfaces:**
- Consumes: `projectResolutionToCarePlan`, `mergeResolvedCarePlans` (existing); `patientSafety`,
  `pairSafety`, `hashOf`, `canonicalJson` (plan 02); `PathwayMeta` (Task 3); `RunResult`,
  `RunBlocker`, `RunChildResult` (Task 2).
- Produces:
  - `interface Contribution { pathwayId: string; sessionId: string; result: EvaluationResult }`
  - `interface ComposeContext { patient: PatientContext; conflictResolutions: Record<string, ConflictResolution>; safety: SafetyReference; meta: Map<string, PathwayMeta>; envFingerprint: string }`
  - `composeRun(contributions: Contribution[], ctx: ComposeContext): RunResult`
  - `selectConflicts(base: MergedCarePlan, decisions: Record<string, ConflictResolution>): Selection`
  - `recommendationKey(r: { sourcePathwayId: string; sourceNodeId?: string; name: string }): string`
  - `runHashOf(r: Omit<RunResult, 'resultHash'>): string`
  - `setsOf(m: Map<string, string[]>): Map<string, Set<string>>`
  - `WRITE_IN = 'provider-override'`

The stages follow spec §3 in order:
1. Project each contribution in nodeId order (P4-4).
2. Merge.
3. Select, applying the decisions to the BASE merge (review #6).
4. Run patient safety on write-ins.
5. Run pair safety on the final set (review #7), with pathway-qualified identity (review #5).
6. Compute root readiness.

Finally, the root's dispositions are written back onto the children's nodes (P4-2).

- [ ] **Step 1: Write the failing test**

Create `apps/pathway-service/src/__tests__/pipeline-compose.test.ts`:

```ts
import { normalizedKey } from '../services/medications/safety-reference';
import { composeRun, runHashOf } from '../services/resolution/pipeline/compose';
import { evaluate } from '../services/resolution/pipeline/evaluate';
import { replayObservations } from '../services/resolution/pipeline/observations';
import type { SessionInputs } from '../services/resolution/pipeline/types';
import { AnswerType, DefaultBehavior, GateType, NodeStatus, OverrideAction } from '../services/resolution/types';
import type { GraphNode } from '../services/confidence/types';
import { edge, makeEnv, makeInputs, node } from './fixtures/pipeline-env';

const norm = (rxcui: string, name: string, atc: string) => ({ ingredientRxcui: rxcui, ingredientName: name, atcClasses: [atc] });
const SAFETY = {
  normalized: new Map([
    ['amoxicillin||', norm('723', 'amoxicillin', 'J01CA04')],
    ['azithromycin||', norm('18631', 'azithromycin', 'J01FA10')],
    ['warfarin||', norm('11289', 'warfarin', 'B01AA03')],
    ['aspirin||', norm('1191', 'aspirin', 'B01AC06')],
    ['metoprolol||', norm('6918', 'metoprolol', 'C07AB02')],
    ['carvedilol||', norm('20352', 'carvedilol', 'C07AG02')],
    [normalizedKey({ text: 'Warfarin', system: 'RxNorm', code: '11289' }), norm('11289', 'warfarin', 'B01AA03')],
  ]),
  pairs: new Map([['11289|1191', { severity: 'SEVERE' as const, mechanism: 'bleeding', clinicalAdvice: null, matchType: 'PAIR' as const, matchedClasses: null }]]),
  classRules: [],
  allergyMappings: [{ snomedCode: '91936005', snomedDisplay: 'Allergy to penicillin', atcClass: 'J01C' }],
};
const PENICILLIN = { code: '91936005', system: 'SNOMED', display: 'Allergy to penicillin' };
const WARFARIN_RX = { code: '11289', system: 'RxNorm', display: 'Warfarin' };
/** The run's reference with the Warfarin–Aspirin pair at another severity, or absent. */
const pairAt = (severity: 'MODERATE' | null) => ({
  ...SAFETY,
  pairs: new Map(severity ? [['11289|1191', { ...SAFETY.pairs.get('11289|1191')!, severity }]] : []),
});
const PATIENT = (extra: Record<string, unknown> = {}) =>
  ({ patientId: 'pt', conditionCodes: [], medications: [], labResults: [], allergies: [], ...extra }) as never;

/** A medication the merge projects: it needs a `role`. */
const med = (id: string, name: string, extra: Record<string, unknown> = {}) => node(id, 'Medication', { name, role: 'first_line', ...extra });
/** root → step → each medication. */
const pathway = (meds: GraphNode[]) =>
  makeEnv([node('root', 'Pathway'), node('step', 'Step'), ...meds], [edge('root', 'step'), ...meds.map((m) => edge('step', m.nodeIdentifier))], SAFETY);
/** An unanswered question in front of a medication. */
const GATED = makeEnv(
  [
    node('root', 'Pathway'),
    node('q', 'Gate', { gate_type: GateType.QUESTION, default_behavior: DefaultBehavior.SKIP, answer_type: AnswerType.BOOLEAN, prompt: 'Symptomatic?' }),
    node('step', 'Step'), med('m', 'Amoxicillin'),
  ],
  [edge('root', 'q', 'HAS_GATE'), edge('q', 'step', 'BRANCHES_TO', { when: { equals: true } }), edge('step', 'm')],
  SAFETY,
);

async function contribution(pathwayId: string, env: ReturnType<typeof makeEnv>, patch: Partial<SessionInputs> = {}, patient = PATIENT()) {
  const inputs = makeInputs(env, { pathwayId, initialPatientContext: patient, ...patch });
  const result = await evaluate(inputs, env, replayObservations(new Map(), 'test-model'), 'CONTRIBUTION');
  return { pathwayId, sessionId: `s-${pathwayId}`, result };
}
type C = Awaited<ReturnType<typeof contribution>>;
const compose = (cs: C[], decisions: Record<string, unknown> = {}, patient = PATIENT(), safety: unknown = SAFETY) =>
  composeRun(cs, {
    patient,
    conflictResolutions: decisions as never,
    safety: safety as never,
    meta: new Map(cs.map((c) => [c.pathwayId, { logicalId: `lp-${c.pathwayId}`, title: `Pathway ${c.pathwayId}`, version: '1' }])),
    envFingerprint: 'env-run',
  });
const decide = (kind: string, extra: Record<string, unknown> = {}) => ({ kind, resolvedBy: 'pr', resolvedAt: '2026-09-19T00:00:00.000Z', ...extra });
const names = (r: ReturnType<typeof compose>) => r.mergedPlan.medications.map((m) => m.recommendation.name).sort();
const node0 = (r: ReturnType<typeof compose>, child: number, id: string) => r.children[child].result.resolutionState.get(id)!;

describe('A3 — composition (C3)', () => {
  it('a child with nothing to recommend does not block a child with a plan', async () => {
    const empty = await contribution('pw-x', pathway([]));
    const useful = await contribution('pw-y', pathway([med('m', 'Amoxicillin')]));
    const r = compose([empty, useful]);
    expect(r.readiness).toEqual({ ready: true, blockers: [] });
    expect(names(r)).toEqual(['Amoxicillin']);
    // Control: the root does check emptiness.
    expect(compose([empty]).readiness.blockers).toEqual([expect.objectContaining({ scope: 'OUTPUT', type: 'EMPTY_PLAN' })]);
  });

  it('a child’s pending gate blocks the run, tagged with its pathway', async () => {
    const r = compose([await contribution('pw-g', GATED), await contribution('pw-y', pathway([med('m', 'Aspirin')]))]);
    expect(r.readiness.ready).toBe(false);
    expect(r.readiness.blockers).toEqual([
      expect.objectContaining({ scope: 'COMPLETENESS', type: 'PENDING_GATE', relatedNodeIds: ['q'], pathwayId: 'pw-g' }),
    ]);
  });

  describe('A and B from different children interact', () => {
    const A = () => contribution('pw-a', pathway([med('a', 'Warfarin', { clinical_role: 'anticoagulant' })]));
    const B = () => contribution('pw-b', pathway([med('b', 'Aspirin', { clinical_role: 'anticoagulant' })]));

    it('undecided, the conflict blocks and neither drug reaches the plan', async () => {
      const r = compose([await A(), await B()]);
      expect(names(r)).toEqual([]);
      expect(r.readiness.blockers).toContainEqual(expect.objectContaining({ scope: 'OUTPUT', type: 'UNRESOLVED_CONFLICT', relatedNodeIds: ['a', 'b'] }));
      expect(r.safetyFindings).toEqual([]);
    });

    it('choosing B withholds A and produces no pair finding', async () => {
      const r = compose([await A(), await B()], { anticoagulant: decide('CONFIRM_PATHWAY', { chosenPathwayId: 'pw-b' }) });
      expect(names(r)).toEqual(['Aspirin']);
      expect(r.mergedPlan.medications[0].state).toBe('provider-confirmed');
      expect(r.safetyFindings.filter((f) => f.scope === 'SET')).toEqual([]);
      expect(node0(r, 0, 'a').eligibility).toMatchObject({ status: NodeStatus.INCLUDED });
      expect(node0(r, 0, 'a').disposition).toMatchObject({ status: NodeStatus.EXCLUDED, withheldBy: 'conflict', findingIds: ['anticoagulant'] });
      expect(r.readiness.ready).toBe(true);
    });

    it('accepting both surfaces the pair at the root and withholds both (control)', async () => {
      const r = compose([await A(), await B()], { anticoagulant: decide('ACCEPT_BOTH') });
      expect(names(r)).toEqual([]);
      expect(r.safetyFindings.filter((f) => f.scope === 'SET').map((f) => f.recommendationId).sort()).toEqual(['pw-a|a', 'pw-b|b']);
      expect(node0(r, 1, 'b').disposition).toMatchObject({ withheldBy: 'safety' });
    });
  });

  it('a patient-allergy suppression of A persists whatever is chosen', async () => {
    const patient = PATIENT({ allergies: [PENICILLIN] });
    const amox = await contribution('pw-a', pathway([med('a', 'Amoxicillin', { clinical_role: 'antibiotic' })]), {}, patient);
    const azith = await contribution('pw-b', pathway([med('b', 'Azithromycin', { clinical_role: 'antibiotic' })]), {}, patient);
    for (const decisions of [{}, { antibiotic: decide('CONFIRM_PATHWAY', { chosenPathwayId: 'pw-a' }) }]) {
      const r = compose([amox, azith], decisions, patient);
      expect(names(r)).toEqual(['Azithromycin']);
      expect(r.mergedPlan.suppressed).toContainEqual(expect.objectContaining({ name: 'Amoxicillin', reason: 'allergy' }));
      expect(node0(r, 0, 'a').disposition).toMatchObject({ withheldBy: 'safety' });
    }
  });
});

it('pathway-local node ids do not alias across children (review #5)', async () => {
  const r = compose([
    await contribution('pw-a', pathway([med('med-1', 'Warfarin')])),
    await contribution('pw-b', pathway([med('med-1', 'Amoxicillin')])),
    await contribution('pw-c', pathway([med('med-2', 'Aspirin')])),
  ]);
  expect(names(r)).toEqual(['Amoxicillin']);
  expect(r.safetyFindings.map((f) => f.recommendationId).sort()).toEqual(['pw-a|med-1', 'pw-c|med-2']);
  expect(node0(r, 1, 'med-1').status).toBe(NodeStatus.INCLUDED);
  expect(node0(r, 0, 'med-1').disposition).toMatchObject({ withheldBy: 'safety' });
});

describe('conflict decisions (review #6)', () => {
  const lane = async (patient = PATIENT()) => [
    await contribution('pw-a', pathway([med('a', 'Metoprolol', { clinical_role: 'beta_blocker' })]), {}, patient),
    await contribution('pw-b', pathway([med('b', 'Carvedilol', { clinical_role: 'beta_blocker' })]), {}, patient),
  ];

  it('A, then B, then both, then neither: each choice replaces the last', async () => {
    const cs = await lane();
    const pick = (d: unknown) => names(compose(cs, { beta_blocker: d }));
    expect(pick(decide('CONFIRM_PATHWAY', { chosenPathwayId: 'pw-a' }))).toEqual(['Metoprolol']);
    expect(pick(decide('CONFIRM_PATHWAY', { chosenPathwayId: 'pw-b' }))).toEqual(['Carvedilol']);
    expect(pick(decide('ACCEPT_BOTH'))).toEqual(['Carvedilol', 'Metoprolol']);
    expect(pick(decide('REJECT_BOTH'))).toEqual([]);
  });

  it('the same decision twice gives the same run', async () => {
    const cs = await lane();
    const d = { beta_blocker: decide('CONFIRM_PATHWAY', { chosenPathwayId: 'pw-a' }) };
    expect(compose(cs, d).resultHash).toBe(compose(cs, d).resultHash);
    expect(compose(cs, d).mergedPlan.medications).toHaveLength(1);
  });

  it('who decided, and when, is not part of the reviewed plan', async () => {
    const cs = await lane();
    const at = (resolvedAt: string) =>
      compose(cs, { beta_blocker: { ...decide('CONFIRM_PATHWAY', { chosenPathwayId: 'pw-a' }), resolvedAt } }).resultHash;
    expect(at('2026-01-01T00:00:00.000Z')).toBe(at('2026-02-02T00:00:00.000Z'));
  });

  it('a decision naming a pathway that no longer proposes a candidate is a blocker, not a crash', async () => {
    const r = compose(await lane(), { beta_blocker: decide('CONFIRM_PATHWAY', { chosenPathwayId: 'pw-gone' }) });
    expect(r.readiness.blockers).toContainEqual(expect.objectContaining({ scope: 'OUTPUT', type: 'STALE_CONFLICT_DECISION' }));
    expect(r.mergedPlan.conflicts[0].resolution).toBeNull();
    expect(names(r)).toEqual([]);
  });

  it('a decision for a conflict that no longer exists is inert', async () => {
    const cs = [await contribution('pw-y', pathway([med('m', 'Aspirin')]))];
    expect(compose(cs, { gone: decide('REJECT_BOTH') }).resultHash).toBe(compose(cs).resultHash);
  });

  describe('safety runs over the final set (review #7)', () => {
    const writeIn = (name: string) => ({ beta_blocker: decide('CUSTOM_OVERRIDE', { customMedication: { name } }) });

    it('a write-in is checked against the patient', async () => {
      const patient = PATIENT({ allergies: [PENICILLIN] });
      const r = compose(await lane(patient), writeIn('Amoxicillin'), patient);
      expect(names(r)).toEqual([]);
      expect(r.safetyFindings).toContainEqual(expect.objectContaining({
        scope: 'PATIENT', category: 'ALLERGY', recommendationId: 'provider-override|Amoxicillin',
      }));
      expect(r.mergedPlan.suppressed).toContainEqual(expect.objectContaining({ name: 'Amoxicillin', reason: 'allergy' }));
    });

    it('a write-in is checked against every other candidate', async () => {
      const r = compose([...(await lane()), await contribution('pw-c', pathway([med('c', 'Aspirin')]))], writeIn('Warfarin'));
      expect(names(r)).toEqual([]);
      expect(r.safetyFindings.filter((f) => f.scope === 'SET').map((f) => f.recommendationId).sort())
        .toEqual(['provider-override|Warfarin', 'pw-c|c']);
    });

    it('a write-in that cannot be normalised stays in the plan and blocks the run (D14)', async () => {
      const r = compose(await lane(), writeIn('Unobtainium'));
      expect(r.mergedPlan.medications).toEqual([expect.objectContaining({
        state: 'provider-override', recommendation: expect.objectContaining({ name: 'Unobtainium', sourcePathwayId: 'provider-override' }),
      })]);
      expect(r.readiness.blockers).toContainEqual(expect.objectContaining({ scope: 'COMPLETENESS', type: 'SAFETY_DATA_UNAVAILABLE' }));
    });
  });
});

describe('the run as a whole', () => {
  it('an empty run is not ready: EMPTY_PLAN at the root', () => {
    expect(compose([]).readiness).toEqual({ ready: false, blockers: [expect.objectContaining({ scope: 'OUTPUT', type: 'EMPTY_PLAN' })] });
  });

  it('the run hash does not depend on the order overrides were recorded in (P4-4)', async () => {
    const env = pathway([med('m1', 'Metoprolol', { score: 0.1 }), med('m2', 'Aspirin', { score: 0.1 })]);
    const o = (id: string) => [id, { action: OverrideAction.INCLUDE, originalStatus: NodeStatus.EXCLUDED, originalConfidence: 0.1 }] as const;
    const one = await contribution('pw-a', env, { providerOverrides: new Map([o('m1'), o('m2')]) });
    const two = await contribution('pw-a', env, { providerOverrides: new Map([o('m2'), o('m1')]) });
    expect(names(compose([one]))).toEqual(['Aspirin', 'Metoprolol']);
    expect(compose([one]).resultHash).toBe(compose([two]).resultHash);
  });

  it('the run hash moves when a child’s own result moves', async () => {
    const before = await contribution('pw-g', GATED);
    const after = await contribution('pw-g', GATED, { gateAnswers: new Map([['q', { booleanValue: true }]]) });
    expect(compose([before]).resultHash).not.toBe(compose([after]).resultHash);
  });

  it('a pair warning only the root sees moves the run hash; the order findings are listed in does not', async () => {
    const cs = [await contribution('pw-a', pathway([med('a', 'Warfarin')])), await contribution('pw-b', pathway([med('b', 'Aspirin')]))];
    const quiet = compose(cs, {}, PATIENT(), pairAt(null));
    const warned = compose(cs, {}, PATIENT(), pairAt('MODERATE'));
    // Nothing else moves: same plan, no suppression, still ready, same child hashes.
    expect(names(warned)).toEqual(['Aspirin', 'Warfarin']);
    expect(names(quiet)).toEqual(names(warned));
    expect(warned.mergedPlan.suppressed).toEqual(quiet.mergedPlan.suppressed);
    expect(warned.readiness).toEqual({ ready: true, blockers: [] });
    expect(warned.children.map((c) => c.result.resultHash)).toEqual(quiet.children.map((c) => c.result.resultHash));
    expect(warned.ddiWarnings.map((f) => f.recommendationId).sort()).toEqual(['pw-a|a', 'pw-b|b']);
    expect(warned.resultHash).not.toBe(quiet.resultHash);
    const { resultHash, ...rest } = warned;
    expect(runHashOf({ ...rest, safetyFindings: [...rest.safetyFindings].reverse() })).toBe(resultHash);
  });

  it('a write-in’s warning against a patient medication moves the run hash', async () => {
    const patient = PATIENT({ medications: [WARFARIN_RX] });
    const cs = [
      await contribution('pw-a', pathway([med('a', 'Metoprolol', { clinical_role: 'beta_blocker' })]), {}, patient),
      await contribution('pw-b', pathway([med('b', 'Carvedilol', { clinical_role: 'beta_blocker' })]), {}, patient),
    ];
    const d = { beta_blocker: decide('CUSTOM_OVERRIDE', { customMedication: { name: 'Aspirin' } }) };
    const quiet = compose(cs, d, patient, pairAt(null));
    const warned = compose(cs, d, patient, pairAt('MODERATE'));
    expect(names(warned)).toEqual(['Aspirin']);
    expect(warned.ddiWarnings).toEqual([expect.objectContaining({ scope: 'PATIENT', recommendationId: 'provider-override|Aspirin' })]);
    expect(warned.readiness.ready).toBe(quiet.readiness.ready);
    expect(warned.resultHash).not.toBe(quiet.resultHash);
  });
});

describe('a pathway’s contraindicated/avoid constraint withholds every proposer (P4-2)', () => {
  it.each(['contraindicated', 'avoid'] as const)('%s', async (role) => {
    const a = await contribution('pw-a', pathway([med('a', 'Amoxicillin')]));
    const b = await contribution('pw-b', pathway([med('b', 'Amoxicillin', { role })]));
    const c = await contribution('pw-c', pathway([med('c', 'Amoxicillin')]));
    const r = compose([a, b, c]);
    expect(names(r)).toEqual([]);
    expect(r.mergedPlan.suppressed).toContainEqual(expect.objectContaining({
      name: 'Amoxicillin', reason: role, source: expect.objectContaining({ kind: 'PATHWAY', pathwayId: 'pw-b' }),
    }));
    // Both proposers: eligible by their own pathway, withheld by the root, with a reason naming the constraint.
    for (const [child, id] of [[0, 'a'], [2, 'c']] as const) {
      expect(node0(r, child, id).eligibility).toMatchObject({ status: NodeStatus.INCLUDED });
      expect(node0(r, child, id).status).toBe(NodeStatus.EXCLUDED);
      expect(node0(r, child, id).disposition).toMatchObject({
        status: NodeStatus.EXCLUDED, withheldBy: 'conflict', reason: expect.stringContaining('"Pathway pw-b"'),
      });
    }
    // The node that states the constraint is not a proposal.
    expect(node0(r, 1, 'b').status).toBe(NodeStatus.INCLUDED);
    // Without the constraint, a fresh composition of the SAME contributions restores the drug:
    // withholding is derived every time, never written into the contribution.
    const again = compose([a, c]);
    expect(names(again)).toEqual(['Amoxicillin']);
    expect(node0(again, 0, 'a').status).toBe(NodeStatus.INCLUDED);
    expect(node0(again, 1, 'c').status).toBe(NodeStatus.INCLUDED);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test --prefix $W/apps/pathway-service -- --runInBand src/__tests__/pipeline-compose.test.ts`
Expected: FAIL with `Cannot find module '../services/resolution/pipeline/compose'`.

- [ ] **Step 3: Two exports**

1. In `services/resolution/care-plan-projection.ts`, change `function projectMedication(` to
   `export function projectMedication(`.
2. In `services/resolution/pipeline/disposition.ts`, change `const findingId = ` to
   `export const findingId = `.

- [ ] **Step 4: Create `pipeline/compose.ts`**

```ts
import type { PatientContext } from '../../confidence/types';
import type { DdiCandidate, DdiFinding } from '../../medications/ddi-pass';
import { ddiSuppressionReason } from '../../medications/ddi-pass-single-pathway';
import type { SafetyReference } from '../../medications/safety-reference';
import {
  ConflictCandidate,
  ConflictResolution,
  CustomMedicationOverride,
  MergedCarePlan,
  MergedConflict,
  MergedRecommendation,
  ResolvedMedication,
  SuppressedRecommendation,
  SuppressionSource,
  mergeResolvedCarePlans,
} from '../care-plan-merge';
import { projectMedication, projectResolutionToCarePlan } from '../care-plan-projection';
import { NodeStatus, ResolutionState } from '../types';
import { canonicalJson, hashOf } from './canonical';
import { findingId } from './disposition';
import type { PathwayMeta } from './load-env';
import { pairSafety, patientSafety } from './safety';
import type { EvaluationResult, RunBlocker, RunChildResult, RunResult } from './types';

/** One child of a run, evaluated at CONTRIBUTION scope. */
export interface Contribution {
  pathwayId: string;
  /** '' before the child row exists (start). */
  sessionId: string;
  result: EvaluationResult;
}

export interface ComposeContext {
  /** The run's effective patient: the parent's initial context plus its additions (D5). */
  patient: PatientContext;
  conflictResolutions: Record<string, ConflictResolution>;
  /** The run's one safety reference (C4). */
  safety: SafetyReference;
  meta: Map<string, PathwayMeta>;
  envFingerprint: string;
}

/** The pathway id the merge has always given a provider's write-in. */
export const WRITE_IN = 'provider-override';

/**
 * A recommendation's identity across a run. Node ids are local to a pathway —
 * two pathways can both have a `med-1` (review #5) — so the pair check, every
 * suppression and every withholding use this qualified form (P4-3).
 */
export const recommendationKey = (r: { sourcePathwayId: string; sourceNodeId?: string; name: string }): string =>
  `${r.sourcePathwayId}|${r.sourceNodeId ?? r.name}`;

/** The projection reads gateContextFields as sets; the pipeline stores sorted arrays. */
export const setsOf = (m: Map<string, string[]>): Map<string, Set<string>> =>
  new Map([...m].map(([k, v]) => [k, new Set(v)] as [string, Set<string>]));

const drugKey = (name: string): string => name.toLowerCase().trim();
const byString = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** A state in nodeId order. Projection and merge keep first-seen entries, and state order follows input order (P4-4). */
const inNodeOrder = (s: ResolutionState): ResolutionState => new Map([...s].sort(([a], [b]) => byString(a, b)));

interface Withholding {
  withheldBy: 'conflict' | 'safety';
  findingIds: string[];
  reason: string;
}

export interface Selection {
  medications: MergedRecommendation<ResolvedMedication>[];
  conflicts: MergedConflict[];
  blockers: RunBlocker[];
  losers: Array<{ candidate: ConflictCandidate; conflict: MergedConflict; reason: string }>;
}

/**
 * Spec §3 — compose a run from its contributions. Pure: every input is an
 * argument, and the result, `resultHash` included, depends on nothing else.
 */
export function composeRun(contributions: Contribution[], ctx: ComposeContext): RunResult {
  // 1. Project each contribution. Its dispositions already reflect patient-scope safety (stage 5).
  const plans = contributions.map((c) => {
    const meta = ctx.meta.get(c.pathwayId);
    return projectResolutionToCarePlan(
      inNodeOrder(c.result.resolutionState),
      { pathwayId: c.pathwayId, pathwayLogicalId: meta?.logicalId ?? c.pathwayId, pathwayTitle: meta?.title ?? c.pathwayId },
      c.result.catchUpItems,
      { gateContextFields: setsOf(c.result.gateContextFields) },
    );
  });

  // Every Medication node that proposes each drug, with its clinical lane, so
  // the root can withhold each node it rules out (P4-2).
  const proposers = new Map<string, Array<{ pathwayId: string; nodeId: string; clinicalRole?: string }>>();
  for (const c of contributions) {
    for (const n of inNodeOrder(c.result.resolutionState).values()) {
      if (n.nodeType !== 'Medication') continue;
      const med = projectMedication(n, c.pathwayId);
      if (!med) continue;
      const k = drugKey(med.name);
      proposers.set(k, [...(proposers.get(k) ?? []), { pathwayId: c.pathwayId, nodeId: n.nodeId, clinicalRole: med.clinicalRole }]);
    }
  }

  // The suppressions each contribution applied, recorded on the plan (a
  // multi-start child used to lose them without a trace).
  const contributionSuppressed: SuppressedRecommendation[] = [];
  for (const c of contributions) {
    for (const f of c.result.safetyFindings) {
      if (f.action !== 'SUPPRESS') continue;
      const n = c.result.resolutionState.get(f.recommendationId);
      const med = n ? projectMedication(n, c.pathwayId) : null;
      if (med) contributionSuppressed.push(suppressionOf(med, f));
    }
  }

  // 2. Merge. 3. Select, from the base merge — never appended (review #6).
  const base = mergeResolvedCarePlans(plans);
  const selection = selectConflicts(base, ctx.conflictResolutions);
  const candidateOf = (m: MergedRecommendation<ResolvedMedication>): DdiCandidate =>
    ({ recommendationId: recommendationKey(m.recommendation), drugName: m.recommendation.name });
  const byKey = new Map(selection.medications.map((m) => [recommendationKey(m.recommendation), m]));

  // 4. Patient safety for the candidates the root introduces: write-ins (C3).
  const writeIns = selection.medications.filter((m) => m.recommendation.sourcePathwayId === WRITE_IN);
  const rootPatient = patientSafety(ctx.safety, writeIns.map(candidateOf), ctx.patient);
  const afterPatient = selection.medications.filter((m) => !rootPatient.suppressed.has(recommendationKey(m.recommendation)));

  // 5. Set safety over the final candidate set — root only (stage 6, review #7).
  const set = pairSafety(ctx.safety, afterPatient.map(candidateOf));
  const medications = afterPatient.filter((m) => !set.suppressed.has(recommendationKey(m.recommendation)));
  const rootFindings = [...rootPatient.findings, ...set.findings];
  const rootSuppressed = rootFindings
    .filter((f) => f.action === 'SUPPRESS')
    .map((f) => suppressionOf(byKey.get(f.recommendationId)!.recommendation, f));

  // 6. Readiness at the root.
  const blockers: RunBlocker[] = [
    ...contributions.flatMap((c) => c.result.readiness.blockers.map((b) => ({ ...b, pathwayId: c.pathwayId }))),
    ...selection.blockers,
    // Patient medications are reported by every contribution (P4-15); the root adds only its write-ins.
    ...rootPatient.unavailable.filter((u) => u.source === 'CANDIDATE').map((u): RunBlocker => ({
      scope: 'COMPLETENESS',
      type: 'SAFETY_DATA_UNAVAILABLE',
      description: `"${u.drugName}" cannot be safety-checked: no normalised medication`,
      relatedNodeIds: [],
    })),
  ];
  const mergedPlan: MergedCarePlan = {
    ...base,
    medications,
    conflicts: selection.conflicts,
    suppressed: [
      ...base.suppressed,
      ...[...contributionSuppressed, ...rootSuppressed].sort((a, b) => byString(canonicalJson(a), canonicalJson(b))),
    ],
  };
  if (mergedPlan.medications.length + mergedPlan.labs.length + mergedPlan.procedures.length === 0) {
    blockers.push({
      scope: 'OUTPUT',
      type: 'EMPTY_PLAN',
      description: 'Merged plan has no medications, labs or procedures — the care plan would be empty',
      relatedNodeIds: [],
    });
  }

  // The root's dispositions, onto the nodes that proposed what it withheld (C2, P4-2).
  const withheld = new Map<string, Withholding>();
  for (const { candidate, conflict, reason } of selection.losers) {
    for (const p of proposers.get(drugKey(candidate.recommendation.name)) ?? []) {
      if (p.clinicalRole !== conflict.clinicalRole) continue;
      withheld.set(`${p.pathwayId}|${p.nodeId}`, { withheldBy: 'conflict', findingIds: [conflict.conflictId], reason });
    }
  }
  const suppressing = set.findings.filter((f) => f.action === 'SUPPRESS');
  for (const key of new Set(suppressing.map((f) => f.recommendationId))) {
    const m = byKey.get(key)!;
    if (m.recommendation.sourcePathwayId === WRITE_IN) continue; // a write-in has no node
    const mine = suppressing.filter((f) => f.recommendationId === key);
    for (const p of proposers.get(drugKey(m.recommendation.name)) ?? []) {
      if (!m.sourcePathwayIds.includes(p.pathwayId)) continue;
      withheld.set(`${p.pathwayId}|${p.nodeId}`, {
        withheldBy: 'safety',
        findingIds: mine.map(findingId).sort(),
        reason: ddiSuppressionReason(mine, key) ?? 'Withheld by a safety check',
      });
    }
  }

  // A pathway's contraindicated/avoid constraint removes the drug every other
  // pathway proposes (the merge). Each proposer carries that withholding too,
  // keyed by its own provenance; the node that states the constraint is not a
  // proposal and keeps its status. 'conflict': one pathway overruling another
  // at the root, not a patient finding — WithheldBy stays SAFETY | CONFLICT.
  for (const sup of base.suppressed) {
    if (sup.type !== 'medication' || sup.source.kind !== 'PATHWAY') continue;
    const m = sup.original as ResolvedMedication;
    if (m.role === 'contraindicated' || m.role === 'avoid' || !m.sourceNodeId) continue;
    withheld.set(`${m.sourcePathwayId}|${m.sourceNodeId}`, {
      withheldBy: 'conflict',
      findingIds: [],
      reason: `${sup.reason === 'avoid' ? 'Avoided' : 'Contraindicated'} by "${sup.source.pathwayTitle}"`,
    });
  }

  const children: RunChildResult[] = contributions.map((c) => ({
    pathwayId: c.pathwayId,
    sessionId: c.sessionId,
    result: { ...c.result, resolutionState: withholdAt(c.pathwayId, c.result.resolutionState, withheld) },
  }));
  const run: Omit<RunResult, 'resultHash'> = {
    mergedPlan,
    safetyFindings: rootFindings,
    ddiWarnings: [
      ...contributions.flatMap((c) => c.result.safetyFindings.filter((f) => f.action === 'WARN')),
      ...rootFindings.filter((f) => f.action === 'WARN'),
    ],
    readiness: { ready: blockers.length === 0, blockers },
    children,
    envFingerprint: ctx.envFingerprint,
  };
  return { ...run, resultHash: runHashOf(run) };
}

/**
 * Stage 3: apply each decision to the base merge's conflict. The medications
 * are rebuilt every time, so a changed choice REPLACES the previous one and a
 * repeated choice changes nothing (review #6). A decision whose chosen pathway
 * is no longer a candidate is a blocker, not a crash; a decision for a
 * conflict that no longer exists is inert.
 */
export function selectConflicts(base: MergedCarePlan, decisions: Record<string, ConflictResolution>): Selection {
  const medications = [...base.medications];
  const conflicts: MergedConflict[] = [];
  const blockers: RunBlocker[] = [];
  const losers: Selection['losers'] = [];

  for (const conflict of base.conflicts) {
    const related = conflict.candidates.map((c) => c.recommendation.sourceNodeId ?? c.sourcePathwayId);
    const decision = decisions[conflict.conflictId];
    if (!decision) {
      conflicts.push(conflict);
      blockers.push({
        scope: 'OUTPUT', type: 'UNRESOLVED_CONFLICT', relatedNodeIds: related,
        description: `Conflict "${conflict.conflictId}" is unresolved — choose before generating the care plan`,
      });
      continue;
    }
    if (decision.kind === 'CONFIRM_PATHWAY' && !conflict.candidates.some((c) => c.sourcePathwayId === decision.chosenPathwayId)) {
      conflicts.push(conflict);
      blockers.push({
        scope: 'OUTPUT', type: 'STALE_CONFLICT_DECISION', relatedNodeIds: related,
        description: `The choice recorded for "${conflict.conflictId}" names a pathway that no longer proposes a candidate — choose again`,
      });
      continue;
    }

    conflicts.push({ ...conflict, resolution: decision });
    const lose = (candidate: ConflictCandidate, reason: string) => losers.push({ candidate, conflict, reason });
    switch (decision.kind) {
      case 'CONFIRM_PATHWAY':
        for (const c of conflict.candidates) {
          if (c.sourcePathwayId === decision.chosenPathwayId) {
            medications.push({ recommendation: c.recommendation, sourcePathwayIds: [c.sourcePathwayId], state: 'provider-confirmed' });
          } else {
            lose(c, `Not chosen for "${conflict.clinicalRole}"`);
          }
        }
        break;
      case 'ACCEPT_BOTH':
        for (const c of conflict.candidates) {
          medications.push({ recommendation: c.recommendation, sourcePathwayIds: [c.sourcePathwayId], state: 'auto-included' });
        }
        break;
      case 'REJECT_BOTH':
        for (const c of conflict.candidates) lose(c, `Rejected for "${conflict.clinicalRole}"`);
        break;
      case 'CUSTOM_OVERRIDE':
        for (const c of conflict.candidates) lose(c, `Replaced by a write-in for "${conflict.clinicalRole}"`);
        medications.push({ recommendation: writeInOf(decision.customMedication), sourcePathwayIds: [WRITE_IN], state: 'provider-override' });
        break;
    }
  }
  return { medications, conflicts, blockers, losers };
}

/**
 * Spec §1 rule 8, for a run: the merged plan with its dispositions, the
 * suppressions, the conflicts with their derived decisions, the root's
 * safety findings, the root's blockers and every child's hash in contributing
 * order. A contribution's own findings are inside its child hash, so every
 * warning a provider sees is covered. Evidence, data-gap hints, the
 * environment fingerprint and who decided when are not part of what a
 * provider reviews.
 */
export function runHashOf(r: Omit<RunResult, 'resultHash'>): string {
  const blockerKey = (b: RunBlocker) => `${b.scope}|${b.type}|${b.pathwayId ?? ''}|${b.relatedNodeIds.join(',')}|${b.description}`;
  return hashOf({
    plan: { ...r.mergedPlan, evidenceTrail: undefined, dataGapHints: undefined, conflicts: undefined },
    conflicts: r.mergedPlan.conflicts.map((c) => ({
      conflictId: c.conflictId,
      candidates: c.candidates.map((x) => recommendationKey(x.recommendation)),
      decision: c.resolution
        ? {
          kind: c.resolution.kind,
          chosenPathwayId: c.resolution.kind === 'CONFIRM_PATHWAY' ? c.resolution.chosenPathwayId : null,
          customMedication: c.resolution.kind === 'CUSTOM_OVERRIDE' ? c.resolution.customMedication : null,
        }
        : null,
    })),
    // A root-only warning (a moderate pair, a write-in against a patient
    // medication) changes no medication, blocker or child hash — only this.
    safetyFindings: r.safetyFindings
      .map((f) => Object.fromEntries(Object.entries(f).filter(([k]) => k !== 'meta')))
      .sort((a, b) => byString(canonicalJson(a), canonicalJson(b))),
    blockers: [...r.readiness.blockers].sort((a, b) => byString(blockerKey(a), blockerKey(b))),
    children: r.children.map((c) => c.result.resultHash),
  });
}

function withholdAt(pathwayId: string, state: ResolutionState, withheld: Map<string, Withholding>): ResolutionState {
  const out: ResolutionState = new Map();
  for (const [id, n] of state) {
    // Only an INCLUDED node can be withheld; its eligibility keeps the pathway's reason (C2).
    const w = n.status === NodeStatus.INCLUDED ? withheld.get(`${pathwayId}|${id}`) : undefined;
    out.set(id, w
      ? { ...n, status: NodeStatus.EXCLUDED, excludeReason: w.reason, disposition: { status: NodeStatus.EXCLUDED, withheldBy: w.withheldBy, findingIds: w.findingIds, reason: w.reason } }
      : n);
  }
  return out;
}

function writeInOf(custom: CustomMedicationOverride): ResolvedMedication {
  return {
    name: custom.name,
    role: 'first_line', // a provider's write-in is treated as first-line, as it always was
    dose: custom.dose,
    frequency: custom.frequency,
    duration: custom.duration,
    route: custom.route,
    sourcePathwayId: WRITE_IN,
    evidenceGateIds: [],
  };
}

function suppressionOf(med: ResolvedMedication, f: DdiFinding): SuppressedRecommendation {
  const reason = f.category === 'ALLERGY' ? 'allergy' : f.category === 'DDI_CONTRAINDICATED' ? 'ddi_contraindicated' : 'ddi_severe';
  const s = f.source;
  const source: SuppressionSource =
    s.kind === 'PATIENT_MEDICATION' ? { kind: s.kind, rxcui: s.rxcui, name: s.name }
      : s.kind === 'PATIENT_ALLERGY' ? { kind: s.kind, snomedCode: s.snomedCode, snomedDisplay: s.snomedDisplay }
        : { kind: s.kind, recommendationId: s.recommendationId, drugName: s.drugName };
  return { type: 'medication', name: med.name, reason, source, original: med };
}
```

- [ ] **Step 5: Run the tests and typecheck**

```bash
npm test --prefix $W/apps/pathway-service -- --runInBand src/__tests__/pipeline-compose.test.ts src/__tests__/care-plan-merge.test.ts src/__tests__/pipeline-safety.test.ts
$W/node_modules/.bin/tsc -p $W/apps/pathway-service/tsconfig.json --noEmit
```
Expected: PASS (22 new tests); typecheck clean.

**Falsify, one at a time, restoring each:**
1. `recommendationKey` returns `` `${r.sourceNodeId ?? r.name}` `` (no pathway). Review #5 must fail:
   Amoxicillin, a different drug that shares `med-1`, is suppressed with Warfarin.
2. `inNodeOrder` returns `s` unchanged. The override-order test must fail on the hash.
3. In `composeRun`, set `afterPatient` to `selection.medications`, skipping the root's patient
   check. The *write-in is checked against the patient* test must fail.
4. Delete the `safetyFindings:` entry from `runHashOf`. Both *…moves the run hash* warning tests
   must fail on `not.toBe`; nothing else may.
5. Delete the `for (const sup of base.suppressed)` loop. Both `contraindicated` and `avoid` cases
   must fail on the proposers' `status`.

- [ ] **Step 6: Commit**

```bash
git -C $W add apps/pathway-service/src/services/resolution/pipeline/compose.ts apps/pathway-service/src/services/resolution/care-plan-projection.ts apps/pathway-service/src/services/resolution/pipeline/disposition.ts apps/pathway-service/src/__tests__/pipeline-compose.test.ts
git -C $W commit -m "feat(pathway-service): composeRun, the pure run composition

Projects each contribution in nodeId order, merges, applies conflict
decisions to the base merge (a changed choice replaces, review #6),
checks write-ins against the patient and every final pair at the root
(review #7) with pathway-qualified identity (review #5), and writes the
root's withholdings back onto the children's nodes (C2). A3 passes.

Claude-Session: https://claude.ai/code/session_01XRNkZvQrxmRLNtJHxq71kH"
```

---
### Task 5: `evaluateRun`, `commitRun` and the run harness

**Files:**
- Create: `apps/pathway-service/src/services/resolution/pipeline/run.ts`
- Create: `apps/pathway-service/src/services/resolution/pipeline/run-commit.ts`
- Modify: `apps/pathway-service/src/services/resolution/pipeline/request.ts` (`evaluateAs`)
- Modify: `apps/pathway-service/src/services/resolution/pipeline/commit.ts` (`childOfRunError` + guard)
- Rewrite: `apps/pathway-service/src/__tests__/fixtures/resolver-harness.ts`
- Test: `apps/pathway-service/src/__tests__/pipeline-run-commit.test.ts`

**Interfaces:**
- Consumes: `loadRunEnv` (Task 3), `composeRun` (Task 4), store functions (Task 2),
  `liveObservations`, `auditingLlmClient`, `newRequest`, `persistedObservations`, `inTransaction`,
  `RevisionConflict`, `Change`, `conflictError`, `MAX_ATTEMPTS`, `statusOf` (plans 02–03).
- Produces:
  - `evaluateAs(inputs: SessionInputs, env: EvaluationEnv, provider: ObservationProvider, scope: EvaluationScope): Promise<EvaluationResult>`:
    `evaluate` with an `EvaluationError` rethrown as a `GraphQLError` carrying its code.
  - `childOfRunError(): GraphQLError` (code `CHILD_OF_MULTI_PATHWAY_SESSION`); `commitEvaluation`
    throws it for a child (P4-7).
  - `type ChildInputs = Omit<SessionInputs, 'initialPatientContext' | 'additionalContext' | 'temporalContext'>`
  - `interface RunInputs { initialPatientContext: PatientContext; additionalContext: Partial<AdditionalContextInput>; temporalContext: EvaluationTemporalContext; conflictResolutions: Record<string, ConflictResolution>; children: Array<{ sessionId: string; pathwayId: string; inputs: ChildInputs }> }`
  - `interface Run { parent: MultiPathwayResolutionSession; children: ResolutionSession[] }`
  - `sessionInputsOf(run: Omit<RunInputs, 'children'>, child: ChildInputs): SessionInputs`
  - `runInputsOf(run: Run): RunInputs`
  - `writeInsOf(decisions: Record<string, ConflictResolution>): string[]`
  - `type RunRequest = Map<string, EvaluationRequest>`; `newRunRequest()`, `requestFor(request, pathwayId)`, `clearAudits(request)`
  - `interface RunEvaluation { env: RunEnv; inputs: RunInputs; result: RunResult; durationMs: number }`
  - `evaluateRun(pool: Pool, request: RunRequest, inputs: RunInputs, opts?: { pinGraphs?: boolean }): Promise<RunEvaluation>`
  - `interface RunEvent { sessionId: string; eventType: string; triggerData: unknown }`
  - `interface RunChange { inputs: RunInputs; events: RunEvent[]; record?: (db: Db, evaluation: RunEvaluation) => Promise<void> }`
  - `loadRun(pool: Pool, runId: string): Promise<Run>` (throws `NOT_FOUND`)
  - `assertRunMutable(run: Run): void`
  - `writeRun(db: Db, run: Run, ev: RunEvaluation, request: RunRequest, status: 'ACTIVE' | 'COMPLETED'): Promise<void>`
  - `flushRunAudits(pool: Pool, run: Run, request: RunRequest): Promise<void>`
  - `withRunAudits<T>(pool: Pool, request: RunRequest, body: (seen: { run: Run | null }) => Promise<T>): Promise<T>`
  - `commitRun(pool: Pool, runId: string, applyChange: (run: Run) => RunChange | Promise<RunChange>): Promise<Run>`
  - `childChange(run: Run, childId: string, build: (view: ResolutionSession) => Change): RunChange`
  - Harness: `runStoreMock()`, `latticeMock()`, `loadEnvMock().loadRunEnv`,
    `harness.matchPathways(...ids)`, `harness.failNext(pattern)`, `harness.run(id)`,
    `harness.runRow(id)`, `harness.runIds()`.
    `loseNextRaces` and `onBeforeWrite` now act on whichever row is compare-and-set first: the
    run row in a run commit, the session row otherwise.

- [ ] **Step 1: Replace the harness**

Replace `apps/pathway-service/src/__tests__/fixtures/resolver-harness.ts` with the following. Every
existing export keeps its behaviour. The additions are the runs table, the run store mock, the
`loadRunEnv` mock and matched pathways.

```ts
/**
 * An in-memory session table, run table and environment registry, so resolver
 * tests run the REAL pipeline — evaluate(), commitEvaluation(), composeRun(),
 * commitRun(), the resolvers — over fixture graphs. Only the database and the
 * snapshot loaders are replaced.
 *
 * Wire it into a test file (paths from src/__tests__/; add one '../' from a
 * subdirectory):
 *
 *   jest.mock('../services/resolution/session-store', () =>
 *     require('./fixtures/resolver-harness').sessionStoreMock());
 *   jest.mock('../services/resolution/pipeline/load-env', () =>
 *     require('./fixtures/resolver-harness').loadEnvMock());
 *
 * For multi-pathway runs, also:
 *
 *   jest.mock('../services/resolution/multi-pathway-session-store', () =>
 *     require('./fixtures/resolver-harness').runStoreMock());
 *   jest.mock('../services/resolution/lattice-collapse', () =>
 *     require('./fixtures/resolver-harness').latticeMock());
 *
 * and call `harness.reset()` in `beforeEach`.
 *
 * Rows are the real column builders' output after a JSON round trip, read back
 * through the real row readers, so the JSONB column shapes are exercised
 * rather than bypassed. `BEGIN` / `ROLLBACK` on a client from `harness.pool()`
 * snapshot and restore every table.
 */
import type { Pool } from 'pg';
import type { EvaluationEnv } from '../../services/resolution/pipeline/load-env';
import type { MultiPathwayResolutionSession } from '../../services/resolution/multi-pathway-session-store';
import type { MatchedPathway, ResolutionSession } from '../../services/resolution/types';

export type Row = Record<string, unknown> & { id: string; revision: number; status: string };
type StatusChange = { nodeId: string; from: string; to: string };
type TableName = 'rows' | 'runs';

interface Tables {
  rows: Map<string, Row>;
  runs: Map<string, Row>;
  events: Array<{ sessionId: string; eventType: string; triggerData: unknown; nodesRecomputed: number; statusChanges: StatusChange[] }>;
  nodeOverrides: Array<Record<string, unknown>>;
  gateAnswers: Array<Record<string, unknown>>;
  audits: Array<{ sessionId: string; gateId: string; errorMessage: string | null }>;
  carePlanInserts: string[];
}

interface State {
  tables: Tables;
  envs: Map<string, EvaluationEnv>;
  pathways: Map<string, { id: string; version: string; status: string; title: string; logical_id: string }>;
  matches: string[];
  /** The next statement matching this throws, once (`harness.failNext`). */
  failing: RegExp | null;
  nextId: number;
  beforeWrite: ((row: Row) => void) | null;
  /** What `beforeWrite` changed during the open transaction: another writer's COMMITTED work. */
  externalPatches: Array<{ table: TableName; id: string; patch: Record<string, unknown> }>;
  engineArgs: unknown[][];
}

const emptyTables = (): Tables => ({
  rows: new Map(), runs: new Map(), events: [], nodeOverrides: [], gateAnswers: [], audits: [], carePlanInserts: [],
});
const freshState = (): State => ({
  tables: emptyTables(), envs: new Map(), pathways: new Map(), matches: [], failing: null, nextId: 1,
  beforeWrite: null, externalPatches: [], engineArgs: [],
});
let state = freshState();

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const actualStore = (): any => jest.requireActual('../../services/resolution/session-store');
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const actualRunStore = (): any => jest.requireActual('../../services/resolution/multi-pathway-session-store');
const jsonCopy = <T>(v: T): T => JSON.parse(JSON.stringify(v));

async function poolQuery(sql: string, params: unknown[] = []) {
  if (state.failing?.test(sql)) {
    state.failing = null;
    throw new Error(`resolver-harness: injected failure on ${sql.trim().split('\n')[0]}`);
  }
  if (/FROM pathway_graph_index WHERE id = \$1/.test(sql)) {
    const p = state.pathways.get(String(params[0]));
    return { rows: p ? [p] : [], rowCount: p ? 1 : 0 };
  }
  if (/INSERT INTO patient_care_plans\b/.test(sql)) {
    state.tables.carePlanInserts.push(sql);
    return { rows: [{ id: `care-plan-${state.nextId++}` }], rowCount: 1 };
  }
  if (/INSERT INTO (patients\b|patient_care_plan_)/.test(sql)) {
    state.tables.carePlanInserts.push(sql);
    return { rows: [], rowCount: 1 };
  }
  return { rows: [], rowCount: 0 };
}

function makeClient() {
  let snapshot: Tables | null = null;
  return {
    query: jest.fn(async (sql: string, params?: unknown[]) => {
      const s = sql.trim();
      if (s.startsWith('BEGIN')) { snapshot = structuredClone(state.tables); return { rows: [], rowCount: 0 }; }
      if (s === 'COMMIT') { snapshot = null; state.externalPatches = []; return { rows: [], rowCount: 0 }; }
      if (s === 'ROLLBACK') {
        if (snapshot) state.tables = snapshot;
        // Our rollback must not undo a concurrent writer's committed change.
        for (const { table, id, patch } of state.externalPatches) Object.assign(state.tables[table].get(id) ?? {}, patch);
        snapshot = null;
        state.externalPatches = [];
        return { rows: [], rowCount: 0 };
      }
      return poolQuery(sql, params);
    }),
    release: jest.fn(),
  };
}

/** A compare-and-set target: runs `beforeWrite` first (a concurrent writer), then checks revision and status. */
function casRow(table: TableName, id: string, expectedRevision: number, statuses: string[]): Row | null {
  const row = state.tables[table].get(id);
  if (row && state.beforeWrite) {
    const before = structuredClone(row);
    state.beforeWrite(row);
    const patch = Object.fromEntries(
      Object.entries(row).filter(([k, v]) => JSON.stringify(v) !== JSON.stringify(before[k])),
    );
    state.externalPatches.push({ table, id, patch });
  }
  if (!row || row.revision !== expectedRevision || !statuses.includes(row.status)) return null;
  return row;
}

function envFor(pathwayId: string): EvaluationEnv {
  const env = state.envs.get(pathwayId);
  if (!env) throw new Error(`resolver-harness: no environment registered for pathway "${pathwayId}"`);
  return env;
}

function matchedPathway(id: string): MatchedPathway {
  const p = state.pathways.get(id);
  if (!p) throw new Error(`resolver-harness: no pathway "${id}"`);
  return {
    pathway: { id, logicalId: p.logical_id, title: p.title, version: p.version, category: 'CHRONIC_DISEASE', status: p.status, conditionCodes: [] },
    matched: true,
    matchedSets: [],
    mostSpecificMatchedSet: { setId: `set-${id}`, scope: 'EXACT', members: [], memberCount: 0 },
    specificityDepth: 1,
    patientCodesAddressed: [],
    patientCodesUnaddressed: [],
    matchScore: 1,
    matchedConditionCodes: [],
  } as never;
}

/** The session-store module, with its database functions backed by the harness. */
export function sessionStoreMock() {
  const actual = actualStore();
  const t = () => state.tables;
  return {
    ...actual,
    insertSession: jest.fn(async (_db: unknown, s: { inputs: { temporalContext?: unknown; additionalContext?: object }; parentSessionId?: string }) => {
      if (!s.inputs.temporalContext) throw new Error('insertSession requires temporalContext');
      if (s.parentSessionId && Object.keys(s.inputs.additionalContext ?? {}).length > 0) {
        throw new Error('insertSession: a child of a run holds no patient facts — the parent owns them (D5)');
      }
      const id = `session-${state.nextId++}`;
      t().rows.set(id, { ...jsonCopy(actual.insertColumns(s)), id, revision: 0, created_at: new Date(), updated_at: new Date() });
      return id;
    }),
    getSession: jest.fn(async (_db: unknown, id: string) => {
      const row = t().rows.get(id);
      return row ? actual.rowToSession(structuredClone(row), t().events.filter((e) => e.sessionId === id)) : null;
    }),
    writeEvaluation: jest.fn(async (_db: unknown, args: { sessionId: string; expectedRevision: number }) => {
      const row = casRow('rows', args.sessionId, args.expectedRevision, ['ACTIVE', 'DEGRADED']);
      if (!row) return false;
      Object.assign(row, jsonCopy(actual.evaluationColumns(args)), { revision: row.revision + 1, updated_at: new Date() });
      return true;
    }),
    writeLifecycleStatus: jest.fn(async (_db: unknown, args: { sessionId: string; expectedRevision: number; status: string }) => {
      const row = casRow('rows', args.sessionId, args.expectedRevision, ['ACTIVE', 'DEGRADED']);
      if (!row) return false;
      Object.assign(row, { status: args.status, revision: row.revision + 1, updated_at: new Date() });
      return true;
    }),
    writeChildEvaluation: jest.fn(async (_db: unknown, args: { sessionId: string; inputs: Record<string, unknown> }) => {
      const row = t().rows.get(args.sessionId);
      if (!row || !row.parent_session_id) throw new Error(`writeChildEvaluation: session ${args.sessionId} is not the child of a run`);
      Object.assign(
        row,
        jsonCopy(actual.evaluationColumns({ ...args, inputs: { ...args.inputs, additionalContext: {} } })),
        { revision: row.revision + 1, updated_at: new Date() },
      );
    }),
    writeChildrenLifecycle: jest.fn(async (_db: unknown, parentId: string, status: string, carePlanId?: string) => {
      for (const row of t().rows.values()) {
        if (row.parent_session_id !== parentId) continue;
        Object.assign(row, { status, revision: row.revision + 1, ...(carePlanId ? { care_plan_id: carePlanId } : {}) });
      }
    }),
    setCarePlanId: jest.fn(async (_db: unknown, sessionId: string, carePlanId: string) => {
      const row = t().rows.get(sessionId);
      if (row) row.care_plan_id = carePlanId;
    }),
    logEvent: jest.fn(async (_db: unknown, sessionId: string, e: Omit<Tables['events'][number], 'sessionId'>) => {
      t().events.push({ sessionId, ...e });
    }),
    logNodeOverride: jest.fn(async (_db: unknown, d: Record<string, unknown>) => { t().nodeOverrides.push(d); }),
    logGateAnswer: jest.fn(async (_db: unknown, d: Record<string, unknown>) => { t().gateAnswers.push(d); }),
    writeLlmAudits: jest.fn(async (_db: unknown, sessionId: string, rows: Array<{ gateId: string; errorMessage: string | null }>) => {
      for (const r of rows) t().audits.push({ sessionId, gateId: r.gateId, errorMessage: r.errorMessage });
    }),
    getMatchedPathways: jest.fn(async () => state.matches.map(matchedPathway)),
  };
}

/** The multi-pathway store, with its database functions backed by the harness's runs table. */
export function runStoreMock() {
  const actual = actualRunStore();
  const runs = () => state.tables.runs;
  return {
    ...actual,
    insertRun: jest.fn(async (_db: unknown, r: { temporalContext?: unknown }) => {
      if (!r.temporalContext) throw new Error('insertRun requires temporalContext');
      const id = `run-${state.nextId++}`;
      runs().set(id, {
        ...jsonCopy(actual.insertRunColumns(r)), id, revision: 0,
        contributing_session_ids: [], contributing_pathway_ids: [], care_plan_id: null,
        created_at: new Date(), updated_at: new Date(),
      });
      return id;
    }),
    getMultiPathwaySession: jest.fn(async (_db: unknown, id: string) => {
      const row = runs().get(id);
      return row ? actual.runRowToSession(structuredClone(row)) : null;
    }),
    setContributingSessions: jest.fn(async (_db: unknown, id: string, sessionIds: string[], pathwayIds: string[]) => {
      Object.assign(runs().get(id)!, { contributing_session_ids: [...sessionIds], contributing_pathway_ids: [...pathwayIds] });
    }),
    writeRunEvaluation: jest.fn(async (_db: unknown, args: { runId: string; expectedRevision: number }) => {
      const row = casRow('runs', args.runId, args.expectedRevision, ['ACTIVE']);
      if (!row) return false;
      Object.assign(row, jsonCopy(actual.runColumns(args)), { revision: row.revision + 1, updated_at: new Date() });
      return true;
    }),
    writeRunLifecycle: jest.fn(async (_db: unknown, args: { runId: string; expectedRevision: number; status: string }) => {
      const row = casRow('runs', args.runId, args.expectedRevision, ['ACTIVE']);
      if (!row) return false;
      Object.assign(row, { status: args.status, revision: row.revision + 1, updated_at: new Date() });
      return true;
    }),
    setRunCarePlanId: jest.fn(async (_db: unknown, id: string, carePlanId: string) => {
      runs().get(id)!.care_plan_id = carePlanId;
    }),
  };
}

/** The load-env module, with the snapshot replaced by the environments registered for the pathways. */
export function loadEnvMock() {
  const actual = jest.requireActual('../../services/resolution/pipeline/load-env');
  return {
    ...actual,
    loadEvaluationEnv: jest.fn(async (_pool: unknown, pathwayId: string) => envFor(pathwayId)),
    loadRunEnv: jest.fn(async (_pool: unknown, pathwayIds: string[]) => actual.runEnvOf(
      new Map(pathwayIds.map((id) => [id, envFor(id)])),
      new Map(pathwayIds.map((id) => {
        const p = state.pathways.get(id)!;
        return [id, { logicalId: p.logical_id, title: p.title, version: p.version }];
      })),
    )),
  };
}

/** Lattice collapse keeps every match (it would read the pathway index). */
export const latticeMock = () => ({ collapseLattice: jest.fn(async (_pool: unknown, matched: unknown[]) => matched) });

export const harness = {
  reset(): void {
    state = freshState();
  },
  /** Register a pathway row (for the resolvers' status check) and its evaluation environment. */
  addPathway(id: string, env: EvaluationEnv, opts: { status?: string } = {}): void {
    state.envs.set(id, env);
    state.pathways.set(id, { id, version: '1', status: opts.status ?? 'ACTIVE', title: `Pathway ${id}`, logical_id: `lp-${id}` });
  },
  /** The pathways `getMatchedPathways` returns next, in order. Each must be registered. */
  matchPathways(...ids: string[]): void {
    state.matches = ids;
  },
  /** The next query matching `pattern` throws, once — a failure inside a transaction. */
  failNext(pattern: RegExp): void {
    state.failing = pattern;
  },
  pool(): Pool {
    return { query: jest.fn(poolQuery), connect: jest.fn(async () => makeClient()) } as unknown as Pool;
  },
  context(opts: { userRole?: string; temporalPolicyVersion?: string } = {}): never {
    return {
      pool: harness.pool(),
      redis: {},
      userId: 'provider-1',
      userRole: opts.userRole ?? 'ADMIN',
      ...(opts.temporalPolicyVersion ? { temporalPolicyVersion: opts.temporalPolicyVersion } : {}),
    } as never;
  },
  session(id: string): ResolutionSession {
    const row = state.tables.rows.get(id);
    if (!row) throw new Error(`resolver-harness: no session "${id}"`);
    return actualStore().rowToSession(structuredClone(row), state.tables.events.filter((e) => e.sessionId === id));
  },
  row(id: string): Row {
    const row = state.tables.rows.get(id);
    if (!row) throw new Error(`resolver-harness: no session "${id}"`);
    return row;
  },
  rowCount(): number {
    return state.tables.rows.size;
  },
  sessionIds(): string[] {
    return [...state.tables.rows.keys()];
  },
  run(id: string): MultiPathwayResolutionSession {
    const row = state.tables.runs.get(id);
    if (!row) throw new Error(`resolver-harness: no run "${id}"`);
    return actualRunStore().runRowToSession(structuredClone(row));
  },
  runRow(id: string): Row {
    const row = state.tables.runs.get(id);
    if (!row) throw new Error(`resolver-harness: no run "${id}"`);
    return row;
  },
  runIds(): string[] {
    return [...state.tables.runs.keys()];
  },
  get tables(): Tables {
    return state.tables;
  },
  /**
   * Runs before every revision check; mutate the row to simulate a concurrent
   * writer. Its changes count as already committed, so a ROLLBACK keeps them.
   */
  onBeforeWrite(fn: ((row: Row) => void) | null): void {
    state.beforeWrite = fn;
  },
  /** The next `n` revision checks find the row already moved by someone else. */
  loseNextRaces(n: number): void {
    let left = n;
    state.beforeWrite = (row) => {
      if (left > 0) { left -= 1; row.revision += 1; }
    };
  },
  /** For a TraversalEngine subclass installed by a test's jest.mock. */
  recordEngine(args: unknown[]): void {
    state.engineArgs.push(args);
  },
  get engineArgs(): unknown[][] {
    return state.engineArgs;
  },
};
```

- [ ] **Step 2: Write the failing test**

Create `apps/pathway-service/src/__tests__/pipeline-run-commit.test.ts`:

```ts
jest.mock('../services/resolution/session-store', () => require('./fixtures/resolver-harness').sessionStoreMock());
jest.mock('../services/resolution/multi-pathway-session-store', () => require('./fixtures/resolver-harness').runStoreMock());
jest.mock('../services/resolution/pipeline/load-env', () => require('./fixtures/resolver-harness').loadEnvMock());
jest.mock('../services/llm/llm-gate-client', () => ({
  ...jest.requireActual('../services/llm/llm-gate-client'),
  loadLLMGateConfig: jest.fn(() => null),
  evaluateGateWithLLM: jest.fn(),
}));

import { GraphQLError } from 'graphql';
import { evaluateGateWithLLM, loadLLMGateConfig } from '../services/llm/llm-gate-client';
import { insertRun, setContributingSessions } from '../services/resolution/multi-pathway-session-store';
import { commitEvaluation } from '../services/resolution/pipeline/commit';
import { loadRunEnv } from '../services/resolution/pipeline/load-env';
import { inTransaction, persistedObservations } from '../services/resolution/pipeline/request';
import { evaluateRun, newRunRequest, requestFor, runInputsOf, sessionInputsOf } from '../services/resolution/pipeline/run';
import type { RunInputs } from '../services/resolution/pipeline/run';
import { commitRun, loadRun } from '../services/resolution/pipeline/run-commit';
import { inputsOf, insertSession, writeLlmAudits } from '../services/resolution/session-store';
import { DefaultBehavior, GateType, NodeStatus, OverrideAction, SessionStatus } from '../services/resolution/types';
import { harness } from './fixtures/resolver-harness';
import { edge, makeEnv, makeInputs, node } from './fixtures/pipeline-env';

const SAFETY = {
  normalized: new Map([['amoxicillin||', { ingredientRxcui: '723', ingredientName: 'amoxicillin', atcClasses: ['J01CA04'] }]]),
  allergyMappings: [{ snomedCode: '91936005', snomedDisplay: 'Allergy to penicillin', atcClass: 'J01C' }],
};
const PENICILLIN = { code: '91936005', system: 'SNOMED', display: 'Allergy to penicillin' };
const med = (id: string) => node(id, 'Medication', { name: 'Amoxicillin', role: 'first_line' });
const simple = (medId: string) =>
  makeEnv([node('root', 'Pathway'), node('step', 'Step'), med(medId)], [edge('root', 'step'), edge('step', medId)], SAFETY);
const PW_A = simple('amox-a');
const PW_B = simple('amox-b');
const PW_LLM = makeEnv(
  [
    node('root', 'Pathway'), node('stage', 'Stage'),
    node('gate-llm', 'Gate', {
      gate_type: GateType.LLM_TEXT_ANALYSIS, default_behavior: DefaultBehavior.SKIP, prompt: 'Urgent?',
      input_attribute: 'freeformData.narrative', confidence_threshold: 0.75,
      branches: [{ name: 'urgent', description: 'same day' }, { name: 'routine', description: 'can wait', is_safe_default: true }],
    }),
    node('step', 'Step'), med('m'),
  ],
  [edge('root', 'stage'), edge('stage', 'gate-llm'), edge('gate-llm', 'step'), edge('step', 'm')],
  SAFETY,
);
const verdict = { chosenBranch: 'urgent', confidence: 0.95, reasoning: 'r', rawResponse: {}, model: 'test-model', latencyMs: 1 };

/** A run stored exactly as a start stores one. */
async function seedRun(pathwayIds: string[], additionalContext: Record<string, unknown> = {}): Promise<string> {
  const pool = harness.pool();
  const base = makeInputs(PW_A);
  const request = newRunRequest();
  const inputs: RunInputs = {
    initialPatientContext: base.initialPatientContext, additionalContext, temporalContext: base.temporalContext, conflictResolutions: {},
    children: pathwayIds.map((pathwayId) => ({
      sessionId: '', pathwayId,
      inputs: { pathwayId, graphFingerprint: '', gateAnswers: new Map(), providerOverrides: new Map(), observations: new Map(), revision: 0 },
    })),
  };
  const ev = await evaluateRun(pool, request, inputs, { pinGraphs: true });
  return inTransaction(pool, async (db) => {
    const runId = await insertRun(db, {
      patientId: 'pt', providerId: 'pr', isPreview: true, initialPatientContext: inputs.initialPatientContext,
      temporalContext: inputs.temporalContext, additionalContext, conflictResolutions: {}, result: ev.result,
    });
    const ids: string[] = [];
    for (const child of ev.result.children) {
      const own = ev.inputs.children.find((c) => c.pathwayId === child.pathwayId)!;
      const s = sessionInputsOf(ev.inputs, own.inputs);
      const req = requestFor(request, child.pathwayId);
      const id = await insertSession(db, {
        pathwayVersion: '1', patientId: 'pt', providerId: 'pr',
        inputs: { ...s, additionalContext: {}, observations: persistedObservations(s, req, child.result) },
        result: child.result, status: SessionStatus.ACTIVE, durationMs: 1, parentSessionId: runId,
      });
      await writeLlmAudits(db, id, req.audits);
      ids.push(id);
    }
    await setContributingSessions(db, runId, ids, ev.result.children.map((c) => c.pathwayId));
    return runId;
  });
}

/** Change the run's narrative — a parent fact, which changes the LLM observation key. */
const narrate = (narrative: string) => (r: Parameters<typeof runInputsOf>[0]) => {
  const inputs = runInputsOf(r);
  inputs.additionalContext = { ...inputs.additionalContext, freeformData: { narrative } };
  return { inputs, events: [] };
};

beforeEach(() => {
  harness.reset();
  harness.addPathway('pw-a', PW_A);
  harness.addPathway('pw-b', PW_B);
  harness.addPathway('pw-llm', PW_LLM);
  (loadLLMGateConfig as jest.Mock).mockReset().mockReturnValue(null);
  (evaluateGateWithLLM as jest.Mock).mockReset().mockResolvedValue(verdict);
});

describe('evaluateRun', () => {
  it('evaluates every child under ONE snapshot, at CONTRIBUTION scope (D13, C3)', async () => {
    const pool = harness.pool();
    const run = await loadRun(pool, await seedRun(['pw-a', 'pw-b']));
    (loadRunEnv as jest.Mock).mockClear();

    const ev = await evaluateRun(pool, newRunRequest(), runInputsOf(run));

    expect(loadRunEnv).toHaveBeenCalledTimes(1);
    expect((loadRunEnv as jest.Mock).mock.calls[0][1]).toEqual(['pw-a', 'pw-b']);
    expect(ev.result.children.map((c) => c.result.scope)).toEqual(['CONTRIBUTION', 'CONTRIBUTION']);
  });

  it('a fact on the run reaches every child, and is stored on the parent only (D5)', async () => {
    const runId = await seedRun(['pw-a', 'pw-b'], { allergies: [PENICILLIN] });
    const run = await loadRun(harness.pool(), runId);

    expect(run.children[0].resolutionState.get('amox-a')!.disposition).toMatchObject({ withheldBy: 'safety' });
    expect(run.children[1].resolutionState.get('amox-b')!.disposition).toMatchObject({ withheldBy: 'safety' });
    expect(harness.row(run.children[0].id).additional_context).toEqual({});
    expect(harness.runRow(runId).additional_context).toEqual({ allergies: [PENICILLIN] });
  });
});

describe('commitRun', () => {
  it('commits the parent, every child and the events under one parent revision', async () => {
    const pool = harness.pool();
    const runId = await seedRun(['pw-a', 'pw-b']);
    const [a, b] = (await loadRun(pool, runId)).children;

    const run = await commitRun(pool, runId, (r) => {
      const inputs = runInputsOf(r);
      inputs.children[0].inputs.providerOverrides.set('amox-a', {
        action: OverrideAction.EXCLUDE, originalStatus: NodeStatus.INCLUDED, originalConfidence: 0.9,
      });
      return { inputs, events: [{ sessionId: a.id, eventType: 'override', triggerData: { nodeId: 'amox-a' } }] };
    });

    expect(run.parent.revision).toBe(1);
    expect(harness.row(a.id).revision).toBe(1);
    expect(harness.row(b.id).revision).toBe(1); // re-evaluated too (D13)
    expect(run.children[0].providerOverrides.get('amox-a')).toMatchObject({ action: 'EXCLUDE' });
    expect(harness.tables.events).toEqual([expect.objectContaining({
      sessionId: a.id, eventType: 'override',
      statusChanges: [expect.objectContaining({ nodeId: 'amox-a', to: 'EXCLUDED' })],
    })]);
  });

  it('retries after losing a race on the parent and calls the LLM once across attempts (A1, D9)', async () => {
    (loadLLMGateConfig as jest.Mock).mockReturnValue({ baseUrl: 'http://llm', apiKey: 'k', model: 'test-model', timeoutMs: 1000 });
    const runId = await seedRun(['pw-llm'], { freeformData: { narrative: 'mild cough' } });
    (evaluateGateWithLLM as jest.Mock).mockClear();
    (loadRunEnv as jest.Mock).mockClear();
    harness.loseNextRaces(1);

    const run = await commitRun(harness.pool(), runId, narrate('crushing chest pain'));

    expect(loadRunEnv).toHaveBeenCalledTimes(2);
    expect(evaluateGateWithLLM).toHaveBeenCalledTimes(1);
    expect(run.parent.revision).toBe(2); // one bump by the "other writer", one by this commit
  });

  it('throws CONFLICT after three lost races and still writes the child’s audit rows', async () => {
    (loadLLMGateConfig as jest.Mock).mockReturnValue({ baseUrl: 'http://llm', apiKey: 'k', model: 'test-model', timeoutMs: 1000 });
    const runId = await seedRun(['pw-llm'], { freeformData: { narrative: 'mild cough' } });
    const [child] = (await loadRun(harness.pool(), runId)).children;
    const before = harness.tables.audits.length;
    harness.onBeforeWrite((row) => { row.revision += 1; });

    await expect(commitRun(harness.pool(), runId, narrate('crushing chest pain')))
      .rejects.toMatchObject({ extensions: { code: 'CONFLICT' } });

    expect(harness.tables.audits.slice(before)).toEqual([{ sessionId: child.id, gateId: 'gate-llm', errorMessage: null }]);
  });

  it('refuses a run that is not ACTIVE, before evaluating', async () => {
    const runId = await seedRun(['pw-a']);
    harness.runRow(runId).status = 'COMPLETED';
    (loadRunEnv as jest.Mock).mockClear();
    await expect(commitRun(harness.pool(), runId, narrate('x'))).rejects.toThrow('Cannot modify session with status "COMPLETED"');
    expect(loadRunEnv).not.toHaveBeenCalled();
  });

  it('a boundary error is not retried and writes nothing', async () => {
    const runId = await seedRun(['pw-a']);
    (loadRunEnv as jest.Mock).mockClear();
    await expect(commitRun(harness.pool(), runId, () => {
      throw new GraphQLError('bad answer', { extensions: { code: 'BAD_USER_INPUT' } });
    })).rejects.toThrow('bad answer');
    expect(loadRunEnv).not.toHaveBeenCalled();
    expect(harness.runRow(runId).revision).toBe(0);
  });

  it('commitEvaluation refuses a child of a run: alone it would bypass the run’s lock (P4-7)', async () => {
    const runId = await seedRun(['pw-a']);
    const [child] = (await loadRun(harness.pool(), runId)).children;
    await expect(commitEvaluation(harness.pool(), child.id, (s) => ({ inputs: inputsOf(s), event: { eventType: 'override', triggerData: {} } })))
      .rejects.toMatchObject({ extensions: { code: 'CHILD_OF_MULTI_PATHWAY_SESSION' } });
    expect(harness.row(child.id).revision).toBe(0);
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `npm test --prefix $W/apps/pathway-service -- --runInBand src/__tests__/pipeline-run-commit.test.ts`
Expected: FAIL with `Cannot find module '../services/resolution/pipeline/run'`.

- [ ] **Step 4: `evaluateAs` and the child guard**

1. In `pipeline/request.ts`, add after `persistedObservations`:

```ts
/** `evaluate`, with an EvaluationError surfaced under its GraphQL code. */
export async function evaluateAs(
  inputs: SessionInputs,
  env: EvaluationEnv,
  provider: ObservationProvider,
  scope: EvaluationScope,
): Promise<EvaluationResult> {
  try {
    return await evaluate(inputs, env, provider, scope);
  } catch (err) {
    if (err instanceof EvaluationError) {
      throw new GraphQLError(err.message, { extensions: { code: err.code } });
    }
    throw err;
  }
}
```

   add `import type { ObservationProvider } from './observations';` to its imports, and in
   `evaluateSession` replace the `try { … } catch (err) { … }` block with:

```ts
  const result = await evaluateAs(pinned, env, provider, scope);
  return { env, inputs: pinned, result, durationMs: Date.now() - started };
```

2. In `pipeline/commit.ts`, add after `conflictError`:

```ts
/** A child of a run changes only through its run (D6); alone, it would bypass the run's lock. */
export const childOfRunError = (): GraphQLError =>
  new GraphQLError('This session is part of a multi-pathway run; change, generate or abandon it through the run', {
    extensions: { code: 'CHILD_OF_MULTI_PATHWAY_SESSION' },
  });
```

   and in `commitEvaluation`, directly after `const session = await loadSession(pool, sessionId);`,
   add `if (session.parentSessionId) throw childOfRunError();`.

- [ ] **Step 5: Create `pipeline/run.ts`**

```ts
import type { Pool } from 'pg';
import type { AdditionalContextInput } from '../../../resolvers/mutations/resolution';
import type { PatientContext } from '../../confidence/types';
import { loadLLMGateConfig } from '../../llm/llm-gate-client';
import type { ConflictResolution } from '../care-plan-merge';
import { buildEffectivePatientContext } from '../effective-context';
import type { MultiPathwayResolutionSession } from '../multi-pathway-session-store';
import type { EvaluationTemporalContext } from '../temporal/evaluation-context';
import type { ResolutionSession } from '../types';
import { composeRun } from './compose';
import type { Contribution } from './compose';
import { auditingLlmClient } from './llm-audit';
import { loadRunEnv } from './load-env';
import type { RunEnv } from './load-env';
import { liveObservations } from './observations';
import { evaluateAs, newRequest, prewarmInBackground } from './request';
import type { EvaluationRequest } from './request';
import type { RunResult, SessionInputs } from './types';

/** A child's node-local inputs. The parent owns every patient fact and the clock (D5). */
export type ChildInputs = Omit<SessionInputs, 'initialPatientContext' | 'additionalContext' | 'temporalContext'>;

/** What a run stores: the parent's inputs and each child's node-local ones (spec §3, Data). */
export interface RunInputs {
  initialPatientContext: PatientContext;
  additionalContext: Partial<AdditionalContextInput>;
  temporalContext: EvaluationTemporalContext;
  conflictResolutions: Record<string, ConflictResolution>;
  /** In contributing order. `sessionId` is '' until the child row exists (start). */
  children: Array<{ sessionId: string; pathwayId: string; inputs: ChildInputs }>;
}

/** A run as loaded: the parent and its children, in contributing order. */
export interface Run {
  parent: MultiPathwayResolutionSession;
  children: ResolutionSession[];
}

/** A child's full inputs: its own, with the parent's facts and clock spliced in (D5). */
export const sessionInputsOf = (run: Omit<RunInputs, 'children'>, child: ChildInputs): SessionInputs => ({
  ...child,
  initialPatientContext: run.initialPatientContext,
  additionalContext: run.additionalContext,
  temporalContext: run.temporalContext,
});

/** The inputs a run mutation starts from: fresh copies, so changing them cannot edit the loaded run. */
export function runInputsOf(run: Run): RunInputs {
  return {
    initialPatientContext: run.parent.initialPatientContext as PatientContext,
    additionalContext: { ...run.parent.additionalContext },
    temporalContext: run.parent.temporalContext,
    conflictResolutions: { ...run.parent.conflictResolutions },
    children: run.children.map((c) => ({
      sessionId: c.id,
      pathwayId: c.pathwayId,
      inputs: {
        pathwayId: c.pathwayId,
        graphFingerprint: c.graphFingerprint,
        gateAnswers: new Map(c.gateAnswers),
        providerOverrides: new Map(c.providerOverrides),
        observations: new Map(c.observations),
        revision: c.revision,
      },
    })),
  };
}

/** The drug names a run's write-ins add to the candidate universe (C1). */
export const writeInsOf = (decisions: Record<string, ConflictResolution>): string[] =>
  Object.values(decisions).flatMap((d) => (d.kind === 'CUSTOM_OVERRIDE' ? [d.customMedication.name] : [])).sort();

/**
 * What survives a run request's retries, per child (D9, C1): its acquired
 * observations and its LLM audit rows. Audit rows are filed under the child's
 * session id, so they are kept apart by pathway.
 */
export type RunRequest = Map<string, EvaluationRequest>;

export const newRunRequest = (): RunRequest => new Map();

export function requestFor(request: RunRequest, pathwayId: string): EvaluationRequest {
  let r = request.get(pathwayId);
  if (!r) {
    r = newRequest();
    request.set(pathwayId, r);
  }
  return r;
}

/** After a transaction that wrote them commits, the audit rows must not be written again. */
export const clearAudits = (request: RunRequest): void => {
  for (const r of request.values()) r.audits.length = 0;
};

export interface RunEvaluation {
  env: RunEnv;
  /** The inputs evaluated — graph fingerprints pinned and empty graphs dropped when starting. */
  inputs: RunInputs;
  result: RunResult;
  durationMs: number;
}

/**
 * One attempt at a whole run: one snapshot for every child (C4, D13), the
 * non-blocking pre-warm (D14), every child evaluated at CONTRIBUTION scope
 * with the parent's facts (D5), then `composeRun`. `pinGraphs` is for a run
 * being started: each child adopts its snapshot graph's fingerprint, and a
 * pathway whose graph is empty contributes no child.
 */
export async function evaluateRun(
  pool: Pool,
  request: RunRequest,
  inputs: RunInputs,
  opts: { pinGraphs?: boolean } = {},
): Promise<RunEvaluation> {
  const patient = buildEffectivePatientContext(inputs.initialPatientContext, inputs.additionalContext);
  const env = await loadRunEnv(pool, inputs.children.map((c) => c.pathwayId), {
    patient,
    writeIns: writeInsOf(inputs.conflictResolutions),
  });
  prewarmInBackground(pool, env.unnormalized);

  const started = Date.now();
  const config = loadLLMGateConfig();
  const children: RunInputs['children'] = [];
  const contributions: Contribution[] = [];
  for (const child of inputs.children) {
    const childEnv = env.children.get(child.pathwayId)!;
    if (opts.pinGraphs && childEnv.resolution.graphContext.allNodes.length === 0) continue;
    const own = opts.pinGraphs ? { ...child.inputs, graphFingerprint: childEnv.graphFingerprint } : child.inputs;
    const req = requestFor(request, child.pathwayId);
    const provider = liveObservations(
      own.observations,
      req.requestObservations,
      auditingLlmClient(config, child.pathwayId, req.audits),
      childEnv.llmModel ?? '',
    );
    const result = await evaluateAs(sessionInputsOf(inputs, own), childEnv, provider, 'CONTRIBUTION');
    children.push({ ...child, inputs: own });
    contributions.push({ pathwayId: child.pathwayId, sessionId: child.sessionId, result });
  }

  const result = composeRun(contributions, {
    patient,
    conflictResolutions: inputs.conflictResolutions,
    safety: env.safety,
    meta: env.meta,
    envFingerprint: env.envFingerprint,
  });
  return { env, inputs: { ...inputs, children }, result, durationMs: Date.now() - started };
}
```

- [ ] **Step 6: Create `pipeline/run-commit.ts`**

```ts
import { GraphQLError } from 'graphql';
import type { Pool } from 'pg';
import { getMultiPathwaySession, writeRunEvaluation } from '../multi-pathway-session-store';
import { getSession, logEvent, statusChangesBetween, writeChildEvaluation, writeLlmAudits } from '../session-store';
import type { Db } from '../session-store';
import { ResolutionSession, SessionStatus } from '../types';
import { canonicalJson } from './canonical';
import { Change, conflictError, MAX_ATTEMPTS, statusOf } from './commit';
import { inTransaction, persistedObservations, RevisionConflict } from './request';
import {
  clearAudits,
  evaluateRun,
  newRunRequest,
  requestFor,
  Run,
  RunEvaluation,
  RunInputs,
  RunRequest,
  runInputsOf,
  sessionInputsOf,
} from './run';

/** An event on one child's log (P4-5). */
export interface RunEvent {
  sessionId: string;
  eventType: string;
  triggerData: unknown;
}

/** What a run mutation contributes to a commit: new inputs, the events, analytics rows. */
export interface RunChange {
  inputs: RunInputs;
  events: RunEvent[];
  /** Written in the same transaction as the run. */
  record?: (db: Db, evaluation: RunEvaluation) => Promise<void>;
}

export async function loadRun(pool: Pool, runId: string): Promise<Run> {
  const parent = await getMultiPathwaySession(pool, runId);
  if (!parent) throw new GraphQLError('Session not found', { extensions: { code: 'NOT_FOUND' } });
  const children: ResolutionSession[] = [];
  for (const id of parent.contributingSessionIds) {
    const child = await getSession(pool, id);
    if (!child) throw new Error(`run ${runId}: contributing session ${id} is missing`);
    children.push(child);
  }
  return { parent, children };
}

export function assertRunMutable(run: Run): void {
  if (run.parent.status !== 'ACTIVE') {
    throw new GraphQLError(`Cannot modify session with status "${run.parent.status}"`, {
      extensions: { code: 'BAD_USER_INPUT' },
    });
  }
}

/**
 * Write a composed run in the caller's transaction: the parent under its
 * revision check (RevisionConflict when it moved), then EVERY child — every
 * child was re-evaluated (D13) — with its observations and audit rows.
 * `COMPLETED` is generation's claim.
 */
export async function writeRun(db: Db, run: Run, ev: RunEvaluation, request: RunRequest, status: 'ACTIVE' | 'COMPLETED'): Promise<void> {
  const written = await writeRunEvaluation(db, {
    runId: run.parent.id,
    expectedRevision: run.parent.revision,
    additionalContext: ev.inputs.additionalContext,
    conflictResolutions: ev.inputs.conflictResolutions,
    result: ev.result,
    status,
  });
  if (!written) throw new RevisionConflict();
  for (const child of ev.result.children) {
    const session = run.children.find((c) => c.pathwayId === child.pathwayId)!;
    const own = ev.inputs.children.find((c) => c.pathwayId === child.pathwayId)!;
    const req = requestFor(request, child.pathwayId);
    const inputs = sessionInputsOf(ev.inputs, own.inputs);
    await writeChildEvaluation(db, {
      sessionId: session.id,
      inputs: { ...inputs, observations: persistedObservations(inputs, req, child.result) },
      result: child.result,
      status: status === 'COMPLETED' ? SessionStatus.COMPLETED : statusOf(child.result),
      durationMs: ev.durationMs,
    });
    await writeLlmAudits(db, session.id, req.audits);
  }
}

/** Audit rows of calls no committed transaction wrote (spec §4, best effort), each under its child. */
export async function flushRunAudits(pool: Pool, run: Run, request: RunRequest): Promise<void> {
  const pending = [...request].filter(([, r]) => r.audits.length > 0);
  if (pending.length === 0) return;
  const sessionOf = new Map(run.children.map((c) => [c.pathwayId, c.id]));
  await inTransaction(pool, async (db) => {
    for (const [pathwayId, r] of pending) {
      const sessionId = sessionOf.get(pathwayId);
      if (sessionId) await writeLlmAudits(db, sessionId, r.audits);
    }
  });
  clearAudits(request);
}

/**
 * Run a run request's attempts. However they end, write the audit rows no
 * committed transaction wrote — the run analogue of `withAudits`. `body`
 * records each run it loads in `seen`, so the rows can be filed under its
 * children. A failure to write them never masks the request's own outcome.
 */
export async function withRunAudits<T>(pool: Pool, request: RunRequest, body: (seen: { run: Run | null }) => Promise<T>): Promise<T> {
  const seen: { run: Run | null } = { run: null };
  try {
    return await body(seen);
  } finally {
    if (seen.run) {
      await flushRunAudits(pool, seen.run, request).catch((err) =>
        console.error('[audit] could not write the LLM audit rows of a run request:', err),
      );
    }
  }
}

/**
 * The run's one write path (spec §3, §4). Each attempt reloads the run, asks
 * the mutation for its change (boundary validation throws here and is never
 * retried), evaluates every child under one snapshot, composes, and commits
 * the parent and every child under the parent's revision. Observations an
 * earlier attempt acquired are reused while their keys still match. Three
 * attempts, then CONFLICT (D6, D9).
 */
export async function commitRun(
  pool: Pool,
  runId: string,
  applyChange: (run: Run) => RunChange | Promise<RunChange>,
): Promise<Run> {
  const request = newRunRequest();
  return withRunAudits(pool, request, async (seen) => {
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const run = await loadRun(pool, runId);
      seen.run = run;
      assertRunMutable(run);
      const change = await applyChange(run);
      const ev = await evaluateRun(pool, request, change.inputs);

      try {
        await inTransaction(pool, async (db) => {
          await writeRun(db, run, ev, request, 'ACTIVE');
          for (const e of change.events) {
            const before = run.children.find((c) => c.id === e.sessionId)!;
            const after = ev.result.children.find((c) => c.pathwayId === before.pathwayId)!;
            await logEvent(db, e.sessionId, {
              eventType: e.eventType,
              triggerData: e.triggerData,
              nodesRecomputed: after.result.resolutionState.size,
              statusChanges: statusChangesBetween(before.resolutionState, after.result.resolutionState),
            });
          }
          await change.record?.(db, ev);
        });
      } catch (err) {
        if (err instanceof RevisionConflict) continue;
        throw err;
      }
      clearAudits(request);
      return loadRun(pool, runId);
    }
    throw conflictError();
  });
}

/**
 * A single-pathway change — an answer, an override, a fact — on a child of a
 * run, as a change to the run. The builder sees a VIEW of the child carrying
 * the parent's facts and clock, so it need not know about runs. Facts go to
 * the parent (D5); answers and overrides stay on the child, because they name
 * pathway-local nodes.
 */
export function childChange(run: Run, childId: string, build: (view: ResolutionSession) => Change): RunChange {
  const child = run.children.find((c) => c.id === childId);
  if (!child) throw new Error(`run ${run.parent.id} has no child ${childId}`);
  const view: ResolutionSession = {
    ...child,
    initialPatientContext: run.parent.initialPatientContext as ResolutionSession['initialPatientContext'],
    additionalContext: run.parent.additionalContext as ResolutionSession['additionalContext'],
    temporalContext: run.parent.temporalContext,
  };
  const change = build(view);

  const inputs = runInputsOf(run);
  inputs.additionalContext = change.inputs.additionalContext;
  const target = inputs.children.find((c) => c.sessionId === childId)!;
  target.inputs = { ...target.inputs, gateAnswers: change.inputs.gateAnswers, providerOverrides: change.inputs.providerOverrides };

  // A fact can move every child; an answer or an override is its own child's event (P4-5).
  const factChanged = canonicalJson(change.inputs.additionalContext) !== canonicalJson(run.parent.additionalContext);
  const on = factChanged ? run.children.map((c) => c.id) : [childId];
  return {
    inputs,
    events: on.map((sessionId) => ({ sessionId, ...change.event })),
    record: change.record && ((db, ev) =>
      change.record!(db, ev.result.children.find((c) => c.pathwayId === child.pathwayId)!.result)),
  };
}
```

- [ ] **Step 7: Run the tests and typecheck**

```bash
npm test --prefix $W/apps/pathway-service -- --runInBand src/__tests__/pipeline-run-commit.test.ts src/__tests__/pipeline-commit.test.ts src/__tests__/pipeline-request.test.ts src/__tests__/pipeline-resolver-mutations.test.ts src/__tests__/pipeline-resolver-generation.test.ts src/__tests__/pipeline-resolver-temporal.test.ts src/__tests__/pipeline-sequence-vs-fresh.test.ts src/__tests__/pipeline-multi-children.test.ts
$W/node_modules/.bin/tsc -p $W/apps/pathway-service/tsconfig.json --noEmit
```
Expected: PASS (8 new tests). Plan 03's harness-driven suites are unchanged by the harness rewrite.
`pipeline-multi-children.test.ts` still passes on the old start path until Task 6 deletes it.
Typecheck clean.

**Falsify, one at a time, restoring each:**
1. In `commitRun`, change `evaluateRun(pool, request, change.inputs)` to
   `evaluateRun(pool, newRunRequest(), change.inputs)`, so no attempt reuses another's
   observations. The A1 test must fail with 2 LLM calls.
2. In `commitEvaluation`, delete the `parentSessionId` guard. The P4-7 test must fail.
3. In `evaluateRun`, pass `'ROOT'` instead of `'CONTRIBUTION'`. The scope test must fail.

- [ ] **Step 8: Commit**

```bash
git -C $W add apps/pathway-service/src/services/resolution/pipeline/run.ts apps/pathway-service/src/services/resolution/pipeline/run-commit.ts apps/pathway-service/src/services/resolution/pipeline/request.ts apps/pathway-service/src/services/resolution/pipeline/commit.ts apps/pathway-service/src/__tests__/fixtures/resolver-harness.ts apps/pathway-service/src/__tests__/pipeline-run-commit.test.ts
git -C $W commit -m "feat(pathway-service): evaluateRun and commitRun, the run's write path

evaluateRun evaluates every child at CONTRIBUTION scope under one
snapshot, with the parent's facts spliced in (D5, D13), and composes.
commitRun commits the parent and every child under the parent's revision,
three attempts then CONFLICT (D6, D9), with request observations and per-
child audit rows surviving retries. commitEvaluation refuses a child of a
run. The resolver harness gains a runs table.

Claude-Session: https://claude.ai/code/session_01XRNkZvQrxmRLNtJHxq71kH"
```

---

### Task 6: Run mutations on the pipeline

**Files:**
- Rewrite: `apps/pathway-service/src/resolvers/mutations/multi-pathway-resolution.ts`
- Modify: `apps/pathway-service/src/resolvers/mutations/resolution.ts`
- Modify: `apps/pathway-service/src/services/resolution/multi-pathway-session-store.ts` (old writers out)
- Modify: `apps/pathway-service/schema.graphql`; regenerate `src/__generated__/resolvers-types.ts`
- Create (tests):
  - `apps/pathway-service/src/__tests__/pipeline-run-mutations.test.ts`
  - `apps/pathway-service/src/__tests__/pipeline-run-generation.test.ts`
- Modify (tests):
  - `pipeline-sdl.test.ts`
  - `preview-session-isolation.test.ts`
  - `multi-pathway-session-store-preview.test.ts`
  - `temporal/session-temporal-context.test.ts`
  - `temporal/resolution-fact-store-wiring.test.ts`
- Delete (tests; see *Appendix B*):
  - `multi-pathway-resolution.test.ts`
  - `ddi-multi-pathway.test.ts`
  - `pipeline-multi-children.test.ts`
  - `patient-attributes-mapping.test.ts`

Like plan 03's Task 6, this task is large because the resolvers and every test that mocks their
old seams must move together. The suite is green only at the end. Do the steps in order.

**Interfaces:**
- Consumes: Tasks 2–5.
- Produces (GraphQL):
  - `MultiPathwayResolutionSession.revision: Int!`, `resultHash: String!`, `envFingerprint: String!`;
  - `generateMergedCarePlan(sessionId: ID!, reviewedResultHash: String!)`;
  - `SuppressedRecommendation.sourcePathwayId: ID` and `suppressedByRecommendationName: String`;
  - `reMergeMultiPathwaySession` is removed.
- Produces (TypeScript): `resolution.ts` exports `formatBlocker`, `warningsOf(findings: DdiFinding[])`
  and `PLAN_CHANGED`. The multi-pathway store loses `createMultiPathwaySession`,
  `markMultiPathwaySessionStatus` and `updateMergedPlanAndResolutions`.
- Removed from `multi-pathway-resolution.ts`: `buildPatientContext`, `runMergePipeline`,
  `buildResolvedPlansFromSessions`, `resolveAndPersistAll`, `loadActiveSession`,
  `applyResolution`, `validateForGeneration`, `buildDdiSuppression`, `emptyMergedCarePlan` and
  `reMergeMultiPathwaySession`.

- [ ] **Step 1: Write the run mutation tests**

Create `apps/pathway-service/src/__tests__/pipeline-run-mutations.test.ts`:

```ts
/**
 * Multi-pathway runs through the REAL pipeline: fixture graphs, the real
 * evaluate(), composeRun(), commitRun() and resolvers; only the tables, the
 * snapshot loaders and lattice collapse are in memory (fixtures/resolver-harness).
 */
jest.mock('../services/resolution/session-store', () => require('./fixtures/resolver-harness').sessionStoreMock());
jest.mock('../services/resolution/multi-pathway-session-store', () => require('./fixtures/resolver-harness').runStoreMock());
jest.mock('../services/resolution/pipeline/load-env', () => require('./fixtures/resolver-harness').loadEnvMock());
jest.mock('../services/resolution/lattice-collapse', () => require('./fixtures/resolver-harness').latticeMock());

import {
  formatMergedForGraphQL,
  multiPathwayResolutionMutations,
  multiPathwayResolutionQueries,
} from '../resolvers/mutations/multi-pathway-resolution';
import { resolutionMutations } from '../resolvers/mutations/resolution';
import type { MergedCarePlan } from '../services/resolution/care-plan-merge';
import { evaluateRun, newRunRequest, runInputsOf } from '../services/resolution/pipeline/run';
import { loadRun } from '../services/resolution/pipeline/run-commit';
import { AnswerType, DefaultBehavior, GateType, NodeStatus, OverrideAction } from '../services/resolution/types';
import type { GraphNode } from '../services/confidence/types';
import { harness } from './fixtures/resolver-harness';
import { edge, makeEnv, node } from './fixtures/pipeline-env';

const PINNED = '2026-08-30T12:00:00.000Z';
const norm = (rxcui: string, name: string, atc: string) => ({ ingredientRxcui: rxcui, ingredientName: name, atcClasses: [atc] });
const SAFETY = {
  normalized: new Map([
    ['amoxicillin||', norm('723', 'amoxicillin', 'J01CA04')],
    ['metoprolol||', norm('6918', 'metoprolol', 'C07AB02')],
    ['carvedilol||', norm('20352', 'carvedilol', 'C07AG02')],
  ]),
  allergyMappings: [{ snomedCode: '91936005', snomedDisplay: 'Allergy to penicillin', atcClass: 'J01C' }],
};
const PENICILLIN = { code: '91936005', system: 'SNOMED', display: 'Allergy to penicillin' };
const med = (id: string, name: string, extra: Record<string, unknown> = {}) => node(id, 'Medication', { name, role: 'first_line', ...extra });
const plain = (meds: GraphNode[]) =>
  makeEnv([node('root', 'Pathway'), node('step', 'Step'), ...meds], [edge('root', 'step'), ...meds.map((m) => edge('step', m.nodeIdentifier))], SAFETY);

/** "Symptomatic?" yes → Metoprolol, in the beta-blocker lane. */
const PW_Q = makeEnv(
  [
    node('root', 'Pathway'),
    node('q', 'Gate', { gate_type: GateType.QUESTION, default_behavior: DefaultBehavior.SKIP, answer_type: AnswerType.BOOLEAN, prompt: 'Symptomatic?' }),
    node('step', 'Step'), med('meto', 'Metoprolol', { clinical_role: 'beta_blocker' }),
  ],
  [edge('root', 'q', 'HAS_GATE'), edge('q', 'step', 'BRANCHES_TO', { when: { equals: true } }), edge('step', 'meto')],
  SAFETY,
);
/** Carvedilol in the same lane: a conflict once Metoprolol is in. */
const carvEnv = () => plain([med('carv', 'Carvedilol', { clinical_role: 'beta_blocker' })]);
/** One gate on ONE haemoglobin (v1 escalates it when absent). */
const hbPathway = (gateId: string) => makeEnv(
  [
    node('root', 'Pathway'),
    node(gateId, 'Gate', { gate_type: GateType.PATIENT_ATTRIBUTE, default_behavior: DefaultBehavior.SKIP,
      condition: { field: 'labs', operator: 'less_than', value: '718-7', system: 'LOINC', threshold: 11 } }),
    node('step', 'Step'),
  ],
  [edge('root', gateId), edge(gateId, 'step')],
);
/** A NODE-level ENCOUNTER horizon: evaluation refuses a run with no encounterStart. */
const PW_ANCHOR = makeEnv(
  [node('root', 'Pathway'), node('g-1', 'Gate', { gate_type: GateType.PATIENT_ATTRIBUTE,
    condition: { field: 'labs', operator: 'exists', value: '718-7', horizon: 'ENCOUNTER' } })],
  [edge('root', 'g-1')],
);

const ctx = (version = 'legacy-v0') => harness.context({ temporalPolicyVersion: version });
async function startRun(
  pathways: string[],
  patient: Record<string, unknown> = {},
  opts: { version?: string; syntheticPatient?: boolean } = {},
): Promise<{ id: string; isPreview: boolean }> {
  harness.matchPathways(...pathways);
  return multiPathwayResolutionMutations.startMultiPathwayResolution(null as never, {
    patientId: 'pt-1', resolutionMode: 'SYNTHETIC', evaluationAsOf: PINNED, syntheticPatient: opts.syntheticPatient ?? true,
    patientContext: { patientId: 'pt-1', conditionCodes: [], medications: [], allergies: [], labResults: [], ...patient },
  } as never, ctx(opts.version)) as never;
}
const childOf = (runId: string, pathwayId: string) => {
  const r = harness.run(runId);
  return r.contributingSessionIds[r.contributingPathwayIds.indexOf(pathwayId)];
};
const medsOf = (runId: string) => harness.run(runId).mergedPlan.medications.map((m) => m.recommendation.name).sort();
const answerQ = (runId: string, value = true) =>
  resolutionMutations.answerPendingDecision(null, { sessionId: childOf(runId, 'pw-q'), nodeId: 'q', answer: { booleanValue: value } }, ctx());

beforeEach(() => {
  harness.reset();
  harness.addPathway('pw-q', PW_Q);
  harness.addPathway('pw-carv', carvEnv());
  harness.addPathway('pw-amox', plain([med('amox', 'Amoxicillin')]));
  harness.addPathway('pw-hb1', hbPathway('hb-1'));
  harness.addPathway('pw-hb2', hbPathway('hb-2'));
  harness.addPathway('pw-empty', makeEnv([], []));
  harness.addPathway('pw-anchor', PW_ANCHOR);
});

describe('startMultiPathwayResolution', () => {
  it('creates the parent and one child per matched pathway, in one transaction', async () => {
    const { id: runId } = await startRun(['pw-q', 'pw-amox']);
    const run = harness.run(runId);
    expect(run).toMatchObject({ revision: 0, status: 'ACTIVE', contributingPathwayIds: ['pw-q', 'pw-amox'] });
    expect(run.resultHash).toMatch(/^[0-9a-f]{64}$/);
    for (const id of run.contributingSessionIds) {
      expect(harness.row(id)).toMatchObject({ parent_session_id: runId, additional_context: {} });
      expect(harness.session(id).initialPatientContext).toEqual(run.initialPatientContext);
      expect(harness.session(id).temporalContext).toEqual(run.temporalContext); // one clock for the run
    }
    expect(harness.tables.events.map((e) => e.eventType)).toEqual(['traversal_complete', 'traversal_complete']);
    expect(medsOf(runId)).toEqual(['Amoxicillin']);
  });

  it('stores isPreview from syntheticPatient, and the formatted run exposes it', async () => {
    const preview = await startRun(['pw-amox']);
    expect(preview.isPreview).toBe(true);
    expect(harness.run(preview.id).isPreview).toBe(true);
    const real = await startRun(['pw-amox'], {}, { syntheticPatient: false });
    expect(real.isPreview).toBe(false);
    expect(harness.run(real.id).isPreview).toBe(false);
  });

  it('a zero-match run is stored with EMPTY_PLAN at its root, stamped with the injected policy version', async () => {
    const run = harness.run((await startRun([], {}, { version: 'legacy-v0' })).id);
    expect(run.contributingSessionIds).toEqual([]);
    expect(run.readiness.blockers).toEqual([expect.objectContaining({ scope: 'OUTPUT', type: 'EMPTY_PLAN' })]);
    // legacy-v0 differs from DEFAULT_TEMPORAL_POLICY_VERSION (v1): injection, not the default.
    expect(run.temporalContext.temporalPolicyVersion).toBe('legacy-v0');
    expect(harness.rowCount()).toBe(0);
  });

  it('a pathway whose graph is empty contributes no child', async () => {
    const run = harness.run((await startRun(['pw-empty', 'pw-amox'])).id);
    expect(run.contributingPathwayIds).toEqual(['pw-amox']);
    expect(harness.rowCount()).toBe(1);
  });

  it('a pathway that fails evaluation writes nothing: no parent, no child, no event', async () => {
    await expect(startRun(['pw-amox', 'pw-anchor'])).rejects.toThrow(/encounterStart/);
    expect(harness.runIds()).toEqual([]);
    expect(harness.rowCount()).toBe(0);
    expect(harness.tables.events).toEqual([]);
  });

  it.each([[[]], [['pw-empty']]])('refuses an unknown policy version before writing anything (matches: %j)', async (pathways) => {
    await expect(startRun(pathways, {}, { version: 'v99' })).rejects.toThrow(/unknown temporalPolicyVersion/);
    expect(harness.runIds()).toEqual([]);
  });
});

describe('a child of a run changes through its run', () => {
  it('answering a child’s gate re-evaluates the whole run — no re-merge (review #2)', async () => {
    const { id: runId } = await startRun(['pw-q', 'pw-carv']);
    expect(medsOf(runId)).toEqual(['Carvedilol']);
    const qChild = childOf(runId, 'pw-q');

    const returned = await answerQ(runId);

    expect((returned as { id: string }).id).toBe(qChild);
    const run = harness.run(runId);
    expect(run.revision).toBe(1);
    // Metoprolol entered Carvedilol's lane; the merged plan shows it with no re-merge call.
    expect(run.mergedPlan.conflicts.map((c) => c.conflictId)).toEqual(['beta_blocker']);
    expect(harness.row(qChild).revision).toBe(1);
    expect(harness.row(childOf(runId, 'pw-carv')).revision).toBe(1); // re-evaluated too (D13)
    expect(harness.session(qChild).gateAnswers.get('q')).toEqual({ booleanValue: true });
    expect(harness.tables.gateAnswers).toEqual([expect.objectContaining({ gateId: 'q', sessionId: qChild })]);
  });

  it('an override on a child is stored on the child and recomposes the run', async () => {
    const { id: runId } = await startRun(['pw-carv']);
    const child = childOf(runId, 'pw-carv');
    await resolutionMutations.overrideNode(null, { sessionId: child, nodeId: 'carv', action: OverrideAction.EXCLUDE }, ctx());
    expect(harness.session(child).providerOverrides.get('carv')).toMatchObject({ action: 'EXCLUDE' });
    expect(medsOf(runId)).toEqual([]);
    expect(harness.tables.nodeOverrides).toEqual([expect.objectContaining({ sessionId: child, nodeId: 'carv' })]);
  });

  it('a fact supplied on child A reaches child B, and is stored on the parent (D5)', async () => {
    const { id: runId } = await startRun(['pw-q', 'pw-amox']);
    await resolutionMutations.addPatientContext(null, { sessionId: childOf(runId, 'pw-q'), additionalContext: { allergies: [PENICILLIN] } }, ctx());

    expect(harness.session(childOf(runId, 'pw-amox')).resolutionState.get('amox')!.disposition).toMatchObject({ withheldBy: 'safety' });
    expect(harness.runRow(runId).additional_context).toEqual({ allergies: [PENICILLIN] });
    expect(harness.row(childOf(runId, 'pw-q')).additional_context).toEqual({});
    const logged = harness.tables.events.filter((e) => e.eventType === 'context_update').map((e) => e.sessionId).sort();
    expect(logged).toEqual([...harness.run(runId).contributingSessionIds].sort());
  });

  it('an escalated datum answered in one pathway resolves another pathway’s gate (D5)', async () => {
    const { id: runId } = await startRun(['pw-hb1', 'pw-hb2'], {}, { version: 'v1' });
    const c1 = childOf(runId, 'pw-hb1');
    const c2 = childOf(runId, 'pw-hb2');
    expect(harness.session(c2).resolutionState.get('hb-2')!.status).toBe(NodeStatus.PENDING_QUESTION);
    const [asked] = harness.session(c1).pendingQuestions;

    await resolutionMutations.answerPendingDecision(null, { sessionId: c1, nodeId: asked.gateId, answer: { numericValue: 9.1 } }, ctx('v1'));

    expect(harness.session(c2).resolutionState.get('hb-2')!.status).toBe(NodeStatus.INCLUDED);
    expect(harness.runRow(runId).additional_context).toMatchObject({ labResults: [expect.objectContaining({ code: '718-7', value: 9.1 })] });
  });

  it('refuses child-level generation and abandonment (CHILD_OF_MULTI_PATHWAY_SESSION)', async () => {
    const child = childOf((await startRun(['pw-amox'])).id, 'pw-amox');
    const code = { extensions: { code: 'CHILD_OF_MULTI_PATHWAY_SESSION' } };
    await expect(resolutionMutations.generateCarePlanFromResolution(null, { sessionId: child, reviewedResultHash: 'x' }, ctx())).rejects.toMatchObject(code);
    await expect(resolutionMutations.abandonSession(null, { sessionId: child }, ctx())).rejects.toMatchObject(code);
  });
});

describe('resolveConflict', () => {
  const choose = (runId: string, choice: Record<string, unknown>, conflictId = 'beta_blocker') =>
    multiPathwayResolutionMutations.resolveConflict(null, { sessionId: runId, conflictId, choice } as never, ctx());

  it('a changed choice replaces the previous one (review #6)', async () => {
    const { id: runId } = await startRun(['pw-q', 'pw-carv']);
    await answerQ(runId);

    await choose(runId, { kind: 'CONFIRM_PATHWAY', chosenPathwayId: 'pw-q' });
    expect(medsOf(runId)).toEqual(['Metoprolol']);
    await choose(runId, { kind: 'CONFIRM_PATHWAY', chosenPathwayId: 'pw-carv' });
    expect(medsOf(runId)).toEqual(['Carvedilol']);

    expect(harness.session(childOf(runId, 'pw-q')).resolutionState.get('meto')!.disposition).toMatchObject({ withheldBy: 'conflict' });
    expect(harness.run(runId).conflictResolutions.beta_blocker).toMatchObject({ kind: 'CONFIRM_PATHWAY', chosenPathwayId: 'pw-carv', resolvedBy: 'provider-1' });
  });

  it('a write-in is safety-checked against the patient (review #7)', async () => {
    const { id: runId } = await startRun(['pw-q', 'pw-carv'], { allergies: [PENICILLIN] });
    await answerQ(runId);
    await choose(runId, { kind: 'CUSTOM_OVERRIDE', customMedication: { name: 'Amoxicillin' } });

    expect(medsOf(runId)).toEqual([]);
    expect(harness.run(runId).mergedPlan.suppressed).toContainEqual(expect.objectContaining({ name: 'Amoxicillin', reason: 'allergy' }));
  });

  it('refuses a conflict the run does not have, and a pathway that is not a candidate', async () => {
    const { id: runId } = await startRun(['pw-q', 'pw-carv']);
    await answerQ(runId);
    await expect(choose(runId, { kind: 'REJECT_BOTH' }, 'nope')).rejects.toMatchObject({ extensions: { code: 'NOT_FOUND' } });
    await expect(choose(runId, { kind: 'CONFIRM_PATHWAY', chosenPathwayId: 'pw-amox' })).rejects.toMatchObject({ extensions: { code: 'BAD_USER_INPUT' } });
    expect(harness.run(runId).revision).toBe(1);
  });
});

describe('abandonMultiPathwaySession (lifecycle only)', () => {
  it('abandons the run and every child, without evaluating', async () => {
    const { id: runId } = await startRun(['pw-amox', 'pw-carv']);
    const hash = harness.runRow(runId).result_hash;
    await multiPathwayResolutionMutations.abandonMultiPathwaySession(null, { sessionId: runId, reason: 'duplicate' }, ctx());

    expect(harness.runRow(runId)).toMatchObject({ status: 'ABANDONED', revision: 1, result_hash: hash });
    for (const id of harness.run(runId).contributingSessionIds) expect(harness.row(id).status).toBe('ABANDONED');
    expect(harness.tables.events.filter((e) => e.eventType === 'abandoned')).toHaveLength(2);
  });

  it('refuses to abandon a COMPLETED run', async () => {
    const { id: runId } = await startRun(['pw-amox']);
    harness.runRow(runId).status = 'COMPLETED';
    await expect(multiPathwayResolutionMutations.abandonMultiPathwaySession(null, { sessionId: runId }, ctx())).rejects.toThrow(/COMPLETED/);
  });
});

describe('A4 — configuration changes between mutations (C4, D13)', () => {
  it('the next answer yields the run a fresh evaluation gives under the new snapshot, with a new envFingerprint', async () => {
    const { id: runId } = await startRun(['pw-q', 'pw-carv']);
    const before = harness.run(runId).envFingerprint;
    // Stricter thresholds on one pathway: Carvedilol (0.9) is no longer auto-included.
    const stricter = carvEnv();
    stricter.resolution.thresholds = { autoResolveThreshold: 0.95, suggestThreshold: 0.95 };
    stricter.envFingerprint = 'env-stricter';
    harness.addPathway('pw-carv', stricter);

    await answerQ(runId);

    const run = harness.run(runId);
    expect(run.envFingerprint).not.toBe(before);
    const fresh = await evaluateRun(harness.pool(), newRunRequest(), runInputsOf(await loadRun(harness.pool(), runId)));
    expect(run.resultHash).toBe(fresh.result.resultHash);
    expect(medsOf(runId)).toEqual(['Metoprolol']);
  });
});

describe('formatting', () => {
  const EMPTY: MergedCarePlan = {
    sourcePathwayIds: [], medications: [], labs: [], imaging: [], procedures: [], guidance: [], schedules: [],
    qualityMetrics: [], suppressed: [], conflicts: [], catchUpItems: [], evidenceTrail: [], dataGapHints: [],
  };

  it('formats a conflict with no resolution as resolution=null', () => {
    const out = formatMergedForGraphQL({
      ...EMPTY,
      conflicts: [{
        conflictId: 'role_x', type: 'medication', clinicalRole: 'role_x', resolution: null,
        candidates: [{ recommendation: { name: 'A', role: 'first_line', sourcePathwayId: 'p1', evidenceGateIds: [] }, sourcePathwayId: 'p1', sourcePathwayTitle: 'P1' }],
      }],
    });
    expect(out.conflicts[0]).toMatchObject({ conflictId: 'role_x', type: 'MEDICATION', resolution: null });
  });

  it('maps state strings to GraphQL enum names', () => {
    const rec = (name: string) => ({ name, role: 'first_line' as const, sourcePathwayId: 'p', evidenceGateIds: [] });
    const out = formatMergedForGraphQL({
      ...EMPTY,
      medications: [
        { recommendation: rec('A'), sourcePathwayIds: ['p'], state: 'auto-included' },
        { recommendation: rec('B'), sourcePathwayIds: ['p'], state: 'provider-confirmed' },
        { recommendation: rec('C'), sourcePathwayIds: ['p'], state: 'provider-override' },
      ],
    });
    expect(out.medications.map((m) => m.state)).toEqual(['AUTO_INCLUDED', 'PROVIDER_CONFIRMED', 'PROVIDER_OVERRIDE']);
  });

  it('a run exposes revision, resultHash and envFingerprint, and a suppression its source pathway', async () => {
    const { id: runId } = await startRun(['pw-amox'], { allergies: [PENICILLIN] });
    const formatted = await multiPathwayResolutionQueries.multiPathwayResolutionSession(null, { sessionId: runId }, ctx());
    const run = harness.run(runId);
    expect(formatted).toMatchObject({ revision: 0, resultHash: run.resultHash, envFingerprint: run.envFingerprint });
    expect(formatted!.mergedPlan.suppressed[0]).toMatchObject({
      name: 'Amoxicillin', reason: 'ALLERGY', sourcePathwayId: 'pw-amox', suppressedByRecommendationName: null,
    });
  });
});
```

- [ ] **Step 2: Write the run generation tests**

Create `apps/pathway-service/src/__tests__/pipeline-run-generation.test.ts`:

```ts
jest.mock('../services/resolution/session-store', () => require('./fixtures/resolver-harness').sessionStoreMock());
jest.mock('../services/resolution/multi-pathway-session-store', () => require('./fixtures/resolver-harness').runStoreMock());
jest.mock('../services/resolution/pipeline/load-env', () => require('./fixtures/resolver-harness').loadEnvMock());
jest.mock('../services/resolution/lattice-collapse', () => require('./fixtures/resolver-harness').latticeMock());

import { multiPathwayResolutionMutations } from '../resolvers/mutations/multi-pathway-resolution';
import { resolutionMutations } from '../resolvers/mutations/resolution';
import { loadRunEnv } from '../services/resolution/pipeline/load-env';
import { AnswerType, DefaultBehavior, GateType } from '../services/resolution/types';
import type { GraphNode } from '../services/confidence/types';
import { harness } from './fixtures/resolver-harness';
import { edge, makeEnv, node } from './fixtures/pipeline-env';

const PINNED = '2026-08-30T12:00:00.000Z';
const norm = (rxcui: string, name: string, atc: string) => ({ ingredientRxcui: rxcui, ingredientName: name, atcClasses: [atc] });
const SAFETY = {
  normalized: new Map([
    ['amoxicillin||', norm('723', 'amoxicillin', 'J01CA04')],
    ['metoprolol||', norm('6918', 'metoprolol', 'C07AB02')],
    ['carvedilol||', norm('20352', 'carvedilol', 'C07AG02')],
    ['warfarin||', norm('11289', 'warfarin', 'B01AA03')],
    ['aspirin||', norm('1191', 'aspirin', 'B01AC06')],
  ]),
  pairs: new Map([['11289|1191', { severity: 'MODERATE' as const, mechanism: 'bleeding', clinicalAdvice: 'monitor INR', matchType: 'PAIR' as const, matchedClasses: null }]]),
};
const med = (id: string, name: string, extra: Record<string, unknown> = {}) => node(id, 'Medication', { name, role: 'first_line', ...extra });
const plain = (meds: GraphNode[]) =>
  makeEnv([node('root', 'Pathway'), node('step', 'Step'), ...meds], [edge('root', 'step'), ...meds.map((m) => edge('step', m.nodeIdentifier))], SAFETY);
const PW_Q = makeEnv(
  [
    node('root', 'Pathway'),
    node('q', 'Gate', { gate_type: GateType.QUESTION, default_behavior: DefaultBehavior.SKIP, answer_type: AnswerType.BOOLEAN, prompt: 'Symptomatic?' }),
    node('step', 'Step'), med('meto', 'Metoprolol', { clinical_role: 'beta_blocker' }),
  ],
  [edge('root', 'q', 'HAS_GATE'), edge('q', 'step', 'BRANCHES_TO', { when: { equals: true } }), edge('step', 'meto')],
  SAFETY,
);

const ctx = () => harness.context({ temporalPolicyVersion: 'legacy-v0' });
async function startRun(pathways: string[]): Promise<string> {
  harness.matchPathways(...pathways);
  const run = await multiPathwayResolutionMutations.startMultiPathwayResolution(null as never, {
    patientId: 'pt-1', resolutionMode: 'SYNTHETIC', evaluationAsOf: PINNED, syntheticPatient: true,
    patientContext: { patientId: 'pt-1', conditionCodes: [], medications: [], allergies: [], labResults: [] },
  } as never, ctx());
  return (run as { id: string }).id;
}
const childOf = (runId: string, pathwayId: string) => {
  const r = harness.run(runId);
  return r.contributingSessionIds[r.contributingPathwayIds.indexOf(pathwayId)];
};
const answerQ = (runId: string) =>
  resolutionMutations.answerPendingDecision(null, { sessionId: childOf(runId, 'pw-q'), nodeId: 'q', answer: { booleanValue: true } }, ctx());
const generate = (runId: string, reviewedResultHash: string) =>
  multiPathwayResolutionMutations.generateMergedCarePlan(null, { sessionId: runId, reviewedResultHash }, ctx());
const reviewed = (runId: string) => harness.run(runId).resultHash;
const carePlanInsertCount = () => harness.tables.carePlanInserts.filter((sql) => /INSERT INTO patient_care_plans\b/.test(sql)).length;

beforeEach(() => {
  harness.reset();
  harness.addPathway('pw-q', PW_Q);
  harness.addPathway('pw-amox', plain([med('amox', 'Amoxicillin')]));
  harness.addPathway('pw-carv', plain([med('carv', 'Carvedilol', { clinical_role: 'beta_blocker' })]));
  harness.addPathway('pw-warf', plain([med('warf', 'Warfarin')]));
  harness.addPathway('pw-asa', plain([med('asa', 'Aspirin')]));
});

describe('generateMergedCarePlan', () => {
  it('generates when the reviewed hash matches and the run is ready: the run and every child complete', async () => {
    const runId = await startRun(['pw-amox', 'pw-carv']);
    const r = await generate(runId, reviewed(runId));

    expect(r).toMatchObject({ success: true, blockers: [] });
    expect(r.carePlanId).toMatch(/^care-plan-/);
    expect(harness.runRow(runId)).toMatchObject({ status: 'COMPLETED', care_plan_id: r.carePlanId });
    for (const id of harness.run(runId).contributingSessionIds) {
      expect(harness.row(id)).toMatchObject({ status: 'COMPLETED', care_plan_id: r.carePlanId });
    }
    expect(carePlanInsertCount()).toBe(1);
    expect(harness.tables.events.filter((e) => e.eventType === 'care_plan_generated')).toHaveLength(2);
  });

  it('returns PLAN_CHANGED_SINCE_REVIEW when a child changed after review (review #2, D7)', async () => {
    const runId = await startRun(['pw-q', 'pw-amox']);
    const hash = reviewed(runId);
    await answerQ(runId); // lands after the review; nothing needs re-merging

    const r = await generate(runId, hash);

    expect(r).toMatchObject({ success: false, carePlanId: null });
    expect(r.blockers).toEqual([expect.objectContaining({ scope: 'OUTPUT', type: 'PLAN_CHANGED_SINCE_REVIEW' })]);
    expect(harness.runRow(runId)).toMatchObject({ status: 'ACTIVE' });
    expect(harness.runRow(runId).result_hash).not.toBe(hash);
    expect(carePlanInsertCount()).toBe(0);
  });

  it('returns PLAN_CHANGED_SINCE_REVIEW when only a root warning appeared after review; generates once it is reviewed', async () => {
    const quiet = (id: string, name: string) =>
      makeEnv([node('root', 'Pathway'), node('step', 'Step'), med(id, name)], [edge('root', 'step'), edge('step', id)], { ...SAFETY, pairs: new Map() });
    harness.addPathway('pw-warf', quiet('warf', 'Warfarin'));
    harness.addPathway('pw-asa', quiet('asa', 'Aspirin'));
    const runId = await startRun(['pw-warf', 'pw-asa']);
    const hash = reviewed(runId);
    // The reference gains the moderate pair: no medication, blocker or child hash moves.
    harness.addPathway('pw-warf', plain([med('warf', 'Warfarin')]));
    harness.addPathway('pw-asa', plain([med('asa', 'Aspirin')]));

    const stale = await generate(runId, hash);
    expect(stale).toMatchObject({ success: false, carePlanId: null });
    expect(stale.blockers).toEqual([expect.objectContaining({ scope: 'OUTPUT', type: 'PLAN_CHANGED_SINCE_REVIEW' })]);
    expect(carePlanInsertCount()).toBe(0);

    const r = await generate(runId, reviewed(runId));
    expect(r.success).toBe(true);
    expect(r.warnings).toEqual(expect.arrayContaining([expect.stringMatching(/^DDI_MODERATE: /)]));
    expect(carePlanInsertCount()).toBe(1);
  });

  it('a child’s unanswered question blocks generation, tagged with its pathway (review #2)', async () => {
    const runId = await startRun(['pw-q', 'pw-amox']);
    const r = await generate(runId, reviewed(runId));

    expect(r.success).toBe(false);
    expect(r.blockers).toContainEqual(expect.objectContaining({ scope: 'COMPLETENESS', type: 'PENDING_GATE', relatedNodeIds: ['q'], pathwayId: 'pw-q' }));
    expect(carePlanInsertCount()).toBe(0);
  });

  it('an unresolved conflict blocks generation at the root', async () => {
    const runId = await startRun(['pw-q', 'pw-carv']);
    await answerQ(runId);
    const r = await generate(runId, reviewed(runId));
    expect(r.blockers).toContainEqual(expect.objectContaining({ scope: 'OUTPUT', type: 'UNRESOLVED_CONFLICT', pathwayId: null }));
  });

  it('returns a moderate interaction across pathways as a text warning (P3-9)', async () => {
    const runId = await startRun(['pw-warf', 'pw-asa']);
    const r = await generate(runId, reviewed(runId));
    expect(r.success).toBe(true);
    expect(r.warnings).toEqual(expect.arrayContaining([expect.stringMatching(/^DDI_MODERATE: (Warfarin|Aspirin) — monitor INR$/)]));
  });

  it('returns the existing care plan for a COMPLETED run without evaluating (P3-7)', async () => {
    const runId = await startRun(['pw-amox']);
    const first = await generate(runId, reviewed(runId));
    (loadRunEnv as jest.Mock).mockClear();

    const again = await generate(runId, 'stale-hash');

    expect(again).toEqual({ success: true, carePlanId: first.carePlanId, warnings: [], blockers: [] });
    expect(loadRunEnv).not.toHaveBeenCalled();
    expect(carePlanInsertCount()).toBe(1);
  });

  it('claims before inserting: a lost race inserts nothing, and the retry succeeds (#8)', async () => {
    const runId = await startRun(['pw-amox']);
    const hash = reviewed(runId);
    harness.loseNextRaces(1);

    const r = await generate(runId, hash);

    expect(r.success).toBe(true);
    expect(carePlanInsertCount()).toBe(1);
  });

  it('a failure after the claim rolls everything back, and a retry generates once', async () => {
    const runId = await startRun(['pw-amox']);
    const hash = reviewed(runId);
    harness.failNext(/INSERT INTO patient_care_plan_interventions/);

    await expect(generate(runId, hash)).rejects.toMatchObject({ extensions: { code: 'INTERNAL_SERVER_ERROR' } });
    expect(harness.runRow(runId)).toMatchObject({ status: 'ACTIVE', revision: 0, care_plan_id: null });
    expect(harness.row(childOf(runId, 'pw-amox')).status).toBe('ACTIVE');
    expect(carePlanInsertCount()).toBe(0);
    expect(harness.tables.events.filter((e) => e.eventType === 'care_plan_generated')).toEqual([]);

    expect((await generate(runId, hash)).success).toBe(true);
    expect(carePlanInsertCount()).toBe(1);
  });

  it('refuses an ABANDONED run', async () => {
    const runId = await startRun(['pw-amox']);
    await multiPathwayResolutionMutations.abandonMultiPathwaySession(null, { sessionId: runId }, ctx());
    await expect(generate(runId, reviewed(runId))).rejects.toThrow(/abandoned/);
  });
});
```

- [ ] **Step 3: Extend the SDL test**

In `pipeline-sdl.test.ts`, add inside the `describe`:

```ts
  it('runs expose revision, resultHash and envFingerprint; merged generation takes the reviewed hash; re-merge is gone', () => {
    expect(fieldType('MultiPathwayResolutionSession', 'revision')).toBe('Int!');
    expect(fieldType('MultiPathwayResolutionSession', 'resultHash')).toBe('String!');
    expect(fieldType('MultiPathwayResolutionSession', 'envFingerprint')).toBe('String!');
    const mutation = objectType('Mutation');
    const gen = mutation.fields!.find((f) => f.name.value === 'generateMergedCarePlan')!;
    expect(gen.arguments!.map((a) => `${a.name.value}: ${print(a.type)}`)).toEqual(['sessionId: ID!', 'reviewedResultHash: String!']);
    expect(mutation.fields!.map((f) => f.name.value)).not.toContain('reMergeMultiPathwaySession');
  });

  it('a suppression names the pathway that proposed it and the recommendation it interacts with', () => {
    expect(fieldType('SuppressedRecommendation', 'sourcePathwayId')).toBe('ID');
    expect(fieldType('SuppressedRecommendation', 'suppressedByRecommendationName')).toBe('String');
  });
```

- [ ] **Step 4: Run the new tests to verify they fail**

Run: `npm test --prefix $W/apps/pathway-service -- --runInBand src/__tests__/pipeline-run-mutations.test.ts src/__tests__/pipeline-run-generation.test.ts src/__tests__/pipeline-sdl.test.ts`
Expected: FAIL.
- The old start calls `createMultiPathwaySession`, which `runStoreMock` still spreads from the
  real module. It reaches the harness pool and fails reading `id` from an empty result.
- The SDL tests find no `revision` field and find `reMergeMultiPathwaySession`.

- [ ] **Step 5: Edit the SDL**

In `apps/pathway-service/schema.graphql`:

1. In `type MultiPathwayResolutionSession`, directly after `status: MultiPathwayResolutionSessionStatus!`,
   add:

```graphql
  """Optimistic-lock counter for the whole run; increments on every committed write to it or any of its pathways."""
  revision: Int!
  """Hash of exactly what a provider reviews (spec §1 rule 8). Pass it to generateMergedCarePlan."""
  resultHash: String!
  """Fingerprint of the configuration snapshot the current run was evaluated under."""
  envFingerprint: String!
```

2. In the docstring above `type MultiPathwayResolutionSession`, replace the paragraph

```text
`mergedPlan.conflicts` is the source of truth for whether the session is
ready to generate; while any conflict has `resolution: null`,
generateMergedCarePlan will return `success: false` with a blocker.
```

   with

```text
Every mutation on a run re-evaluates every contributing pathway under one
configuration snapshot and recomposes the run, so `mergedPlan` is always
current. `generateMergedCarePlan` evaluates again and returns blockers
while anything is incomplete: an unanswered question in any pathway, an
unresolved conflict, a medication that cannot be safety-checked, an empty
plan.
```

3. In the `pendingGateQuestions` docstring, replace the sentence
   `Until a re-merge surface exists, answering a gate updates the per-pathway state but NOT the merged plan — re-run resolution to see merge changes.`
   (it spans two lines) with
   `Answering one re-evaluates the whole run, so the merged plan is current when the answer returns.`

4. In `type SuppressedRecommendation`, after `suppressedByAllergyDisplay: String`, add:

```graphql
  """Set when a drug↔drug interaction with ANOTHER recommendation in the plan caused the suppression."""
  suppressedByRecommendationName: String
  """The pathway that proposed the suppressed recommendation; `provider-override` for a provider's write-in."""
  sourcePathwayId: ID
```

5. Replace the `resolveConflict` docstring (`Record a provider's choice for one conflict. The
   session's mergedPlan is rewritten …`) with:

```graphql
  """
  Record a provider's decision for one conflict. The decision is stored on
  the run and the run is re-evaluated: the merged plan is re-derived from
  every pathway's current result, so a changed decision replaces the
  previous one, and the final medication set is safety-checked again.
  Returns the run.
  """
```

6. Replace the `generateMergedCarePlan` docstring and field line with:

```graphql
  """
  Materialize the run the provider reviewed. `reviewedResultHash` is the
  run's `resultHash` at review time; if re-evaluation now produces a
  different run, nothing is generated and the only blocker is
  PLAN_CHANGED_SINCE_REVIEW (spec D7). Otherwise blockers are returned while
  any pathway or the merge is incomplete. A COMPLETED run returns its
  existing carePlanId. Every contributing session completes with the run.
  """
  generateMergedCarePlan(sessionId: ID!, reviewedResultHash: String!): CarePlanGenerationResult!
```

7. Replace `"""Mark a multi-pathway session ABANDONED."""` with
   `"""Mark an ACTIVE multi-pathway run ABANDONED, and every contributing session with it."""`.
8. Delete the `reMergeMultiPathwaySession` field: its docstring (the paragraph beginning `Re-run
   the merge pipeline against the current state`) and the field line.

Then regenerate: `npm run codegen --prefix $W/apps/pathway-service`.

- [ ] **Step 6: The store loses its old writers**

In `services/resolution/multi-pathway-session-store.ts`, delete `createMultiPathwaySession`,
`updateMergedPlanAndResolutions` and `markMultiPathwaySessionStatus`, each with its JSDoc. Update
the file's header comment. Its second paragraph becomes: "One row per run. The parent's inputs
(facts added after start, conflict decisions) and the cache of its last composition live in JSONB
columns; the contributing child session ids live in a UUID array, written once at start."

- [ ] **Step 7: Replace `resolvers/mutations/multi-pathway-resolution.ts`**

Replace the whole file with the following. The argument types, query resolvers, type resolvers,
`buildResolution`, `validateResolutionAgainstConflict`, `provenance` and the formatters are
today's code unchanged, except for two changes:
- `formatSessionForGraphQL` gains `revision`, `resultHash` and `envFingerprint`;
- `formatSuppressedForGraphQL` gains `suppressedByRecommendationName` and `sourcePathwayId`.

```ts
/**
 * Multi-pathway runs on the evaluation pipeline (spec §3; plan 04).
 *
 * A run is a parent session plus one child session per contributing pathway.
 * The parent owns the patient facts added after start, the clock, the
 * conflict decisions and the run's single revision (D5, D6). Every mutation
 * loads one environment snapshot, re-evaluates every child at CONTRIBUTION
 * scope, composes the run (`composeRun`) and commits the parent and every
 * child in one transaction under the parent's revision (`commitRun`). Reads
 * never recompute.
 *
 * Mutations here: startMultiPathwayResolution, resolveConflict,
 * generateMergedCarePlan, abandonMultiPathwaySession, deletePreviewSession.
 * An answer, override or fact on a child goes through the single-pathway
 * mutations, which route a child to `commitRun` (resolution.ts).
 */

import { GraphQLError } from 'graphql';
import { DataSourceContext } from '../../types';
import { makeEvaluationTemporalContext } from '../../services/resolution/temporal/evaluation-context';
import {
  parseResolutionInput,
  ResolutionModeArgs,
} from '../../services/resolution/temporal/trust-mode';
import { assertAssemblableMode } from '../../services/resolution/temporal/context-assembler';
import {
  formatBlocker,
  PatientContextArgs,
  PLAN_CHANGED,
  TemporalAnchorArgs,
  temporalInputFrom,
  toPatientContext,
  warningsOf,
} from './resolution';
import { SessionStatus } from '../../services/resolution/types';
import {
  getMatchedPathways,
  insertSession,
  logEvent,
  writeChildrenLifecycle,
  writeLlmAudits,
} from '../../services/resolution/session-store';
import type { Db } from '../../services/resolution/session-store';
import { collapseLattice } from '../../services/resolution/lattice-collapse';
import {
  MergedCarePlan,
  MergedConflict,
  ConflictResolution,
  ConflictResolutionKind,
  CustomMedicationOverride,
} from '../../services/resolution/care-plan-merge';
import { resolveTemporalPolicyVersion } from '../helpers/resolution-context';
import { factStoreForInput } from '../../services/resolution/temporal/fact-store';
import { assertKnownPolicyVersion } from '../../services/resolution/temporal/policy-registry';
import {
  deletePreviewSession,
  getMultiPathwaySession,
  getPatientMultiPathwaySessions,
  insertRun,
  MultiPathwayResolutionSession,
  MultiPathwaySessionStatus,
  setContributingSessions,
  setRunCarePlanId,
  writeRunLifecycle,
} from '../../services/resolution/multi-pathway-session-store';
import { conflictError, MAX_ATTEMPTS, statusOf } from '../../services/resolution/pipeline/commit';
import { inTransaction, persistedObservations, RevisionConflict } from '../../services/resolution/pipeline/request';
import {
  clearAudits,
  evaluateRun,
  newRunRequest,
  requestFor,
  runInputsOf,
  sessionInputsOf,
} from '../../services/resolution/pipeline/run';
import {
  assertRunMutable,
  commitRun,
  loadRun,
  withRunAudits,
  writeRun,
} from '../../services/resolution/pipeline/run-commit';

// ─── Argument shapes ────────────────────────────────────────────────

export interface MultiPathwayResolutionArgs extends ResolutionModeArgs, TemporalAnchorArgs {
  patientId: string;
  /**
   * Expressed against the shared `PatientContextArgs` rather than re-declared
   * inline: `CodeInput`/`LabResultInput` are one SDL type each, and a second
   * copy of their TypeScript shape is a field the resolver silently drops the
   * next time the input grows.
   */
  patientContext?: PatientContextArgs;
  /**
   * QA / preview capability. When true, DRAFT pathways are also considered for
   * matching (in addition to ACTIVE). Use for QA tooling against unpublished
   * pathways.
   *
   * NOT ACCESS-CONTROLLED, deliberately, for now. A role check here would be
   * caller-asserted and therefore worthless: this service reads `x-user-role`
   * straight off the request with a PROVIDER default (`index.ts`) and never
   * derives it from the bearer token — `prism-provider-front-end` does send
   * `authorization: Bearer <token>` (its `lib/apollo-client.ts`), but nothing
   * here reads it. Meanwhile `prism-admin-dashboard`, the client that actually
   * calls this mutation, sets no auth header at all, so an ADMIN check would
   * break the encounter simulator (`PatientComposer.tsx`) and pathway preview
   * (`PreviewResolutionPanel.tsx`) — both of which send these flags — while
   * securing nothing.
   *
   * Tracked as authentication debt: `docs/AUTHORIZATION_DEBT.md`. Gate on
   * verified claims when auth lands, not before.
   */
  includeDraftPathways?: boolean;
  /**
   * QA / preview capability. When true, the matcher uses the resolved
   * `conditionCodes` directly instead of looking up the patient row in the
   * EMR-synced snapshot tables. Required for the admin simulator, where there
   * is no real patient. Same non-enforcement note as `includeDraftPathways`.
   *
   * Only coherent on a SYNTHETIC resolution — see the guard in the resolver.
   */
  syntheticPatient?: boolean;
}

export interface ConflictChoiceInput {
  kind: ConflictResolutionKind;
  reason?: string;
  chosenPathwayId?: string;
  customMedication?: CustomMedicationOverride;
}

export interface ResolveConflictArgs {
  sessionId: string;
  conflictId: string;
  choice: ConflictChoiceInput;
}

// ─── Mutations ──────────────────────────────────────────────────────

export const multiPathwayResolutionMutations = {
  async startMultiPathwayResolution(
    _parent: unknown,
    args: MultiPathwayResolutionArgs,
    context: DataSourceContext,
  ) {
    const { pool } = context;

    // Validation FIRST. The matcher options below decide which pathways are
    // even considered, so building them from `args.patientContext` before the
    // trust boundary ran meant raw caller codes drove matching on a request
    // the boundary might reject.
    //
    // Exactly one payload per trust mode, policed over the WHOLE raw request:
    // a LIVE or REPLAY caller cannot smuggle in facts or a clock, and an
    // explicit SYNTHETIC needs ADMIN. An absent mode stays SYNTHETIC so every
    // existing caller works, but admits only what they could already send.
    const resolutionInput = parseResolutionInput(args, args.patientId, context.userRole);
    assertAssemblableMode(resolutionInput);

    // Built once, from the VARIANT — never re-derived from args.patientContext,
    // which would reintroduce the raw payload on a path that already validated.
    const patientContext = toPatientContext(resolutionInput);

    // `syntheticPatient` means "drive matching from the caller's own code set",
    // which has no coherent meaning once the facts come from a snapshot (LIVE)
    // or from a recorded session (REPLAY). Encoded as a guard rather than left
    // to documentation, so the combination cannot quietly become valid when
    // plan 07 makes LIVE reachable.
    if (args.syntheticPatient && resolutionInput.mode !== 'SYNTHETIC') {
      throw new GraphQLError(
        `syntheticPatient is not valid on a ${resolutionInput.mode} resolution`,
        { extensions: { code: 'INVALID_RESOLUTION_INPUT' } },
      );
    }

    const matcherOptions: { directPatientCodes?: Array<{ code: string; system: string }>; includeDraftPathways?: boolean } = {};
    if (args.includeDraftPathways) {
      matcherOptions.includeDraftPathways = true;
    }
    if (args.syntheticPatient) {
      // For synthetic patients, drive matching off the supplied codes only —
      // there is no real patients row to read from. Read from the VALIDATED
      // context, so every code that reaches the matcher has been through the
      // same boundary as the codes that reach the evaluator.
      matcherOptions.directPatientCodes = patientContext.conditionCodes.map((c) => ({
        code: c.code,
        system: c.system,
      }));
    }

    // syntheticPatient signals this is admin/QA/preview traffic; persist that
    // so downstream list views can filter it out and `deletePreviewSession`
    // can clean up. Real provider encounters never set this flag.
    //
    // NOT role-gated, deliberately — see the note on `includeDraftPathways` in
    // MultiPathwayResolutionArgs.
    const isPreview = args.syntheticPatient === true;

    // The SERVER's policy version, read immediately before the clock is stamped
    // and before `getMatchedPathways` — the zero-match branch below returns
    // without ever building a `ResolutionContext`, which is why the selector
    // takes the GraphQL context instead (P1-14). One read per request is also
    // what gives every child session the same version (§1).
    const temporalPolicyVersion = resolveTemporalPolicyVersion(context);

    // One clock for the entire multi-pathway run (§1) — the parent session and
    // every contributing session resolve horizons against the same instant.
    // Created here, before the zero-match branch, so BOTH exits stamp it.
    const temporalContext = makeEvaluationTemporalContext({
      ...temporalInputFrom(args),
      temporalPolicyVersion,
    });

    // Before the zero-match branch: that path creates a parent session and
    // returns without ever entering resolveAndPersistAll, so a version
    // validated only during the sweep would never be checked at all.
    assertKnownPolicyVersion(temporalContext.temporalPolicyVersion);

    // Validates the request — like the version check — before the zero-match
    // branch: whether a malformed context is rejected must not depend on how
    // many pathways happened to match. The store itself is discarded; each
    // child's evaluation assembles its own from the same inputs. Under
    // `legacy-v0` the assembler is never entered (P1-9).
    factStoreForInput(resolutionInput, temporalContext);

    const matched = await getMatchedPathways(pool, args.patientId, matcherOptions);
    // Zero matches takes the same path with no children (spec §3): the run is
    // stored, with EMPTY_PLAN at its root, as a record that nothing matched.
    const surviving = matched.length === 0 ? [] : await collapseLattice(pool, matched);

    const request = newRunRequest();
    const ev = await evaluateRun(pool, request, {
      initialPatientContext: patientContext,
      additionalContext: {},
      temporalContext,
      conflictResolutions: {},
      children: surviving.map((m) => ({
        sessionId: '',
        pathwayId: m.pathway.id,
        inputs: {
          pathwayId: m.pathway.id,
          graphFingerprint: '',
          gateAnswers: new Map(),
          providerOverrides: new Map(),
          observations: new Map(),
          revision: 0,
        },
      })),
    }, { pinGraphs: true });
    const versionOf = new Map(surviving.map((m) => [m.pathway.id, m.pathway.version]));

    // Every pathway was evaluated before anything is written, and everything is
    // written in ONE transaction: a failure leaves no parent, no child and no
    // audit row behind (P3-10).
    const runId = await inTransaction(pool, async (db) => {
      const id = await insertRun(db, {
        patientId: args.patientId,
        providerId: context.userId,
        isPreview,
        initialPatientContext: patientContext,
        temporalContext,
        additionalContext: {},
        conflictResolutions: {},
        result: ev.result,
      });
      const sessionIds: string[] = [];
      for (const child of ev.result.children) {
        const own = ev.inputs.children.find((c) => c.pathwayId === child.pathwayId)!;
        const inputs = sessionInputsOf(ev.inputs, own.inputs);
        const req = requestFor(request, child.pathwayId);
        const sessionId = await insertSession(db, {
          pathwayVersion: versionOf.get(child.pathwayId)!,
          patientId: patientContext.patientId,
          providerId: context.userId,
          // The parent owns the facts (D5); the child keeps a copy of the initial context (P4-1).
          inputs: { ...inputs, additionalContext: {}, observations: persistedObservations(inputs, req, child.result) },
          result: child.result,
          status: statusOf(child.result),
          durationMs: ev.durationMs,
          parentSessionId: id,
        });
        await writeLlmAudits(db, sessionId, req.audits);
        await logEvent(db, sessionId, {
          eventType: 'traversal_complete',
          triggerData: { runId: id, pathwayId: child.pathwayId, patientId: args.patientId },
          nodesRecomputed: child.result.resolutionState.size,
          statusChanges: [],
        });
        sessionIds.push(sessionId);
      }
      await setContributingSessions(db, id, sessionIds, ev.result.children.map((c) => c.pathwayId));
      return id;
    });

    return formatSessionForGraphQL((await getMultiPathwaySession(pool, runId))!);
  },

  /**
   * Record a provider's decision for one conflict (spec §3). The decision is an
   * input on the parent; the merged plan is re-derived from the base merge on
   * every evaluation, so a changed decision REPLACES the previous one (review
   * #6), and the final set is safety-checked again (review #7).
   */
  async resolveConflict(
    _parent: unknown,
    args: ResolveConflictArgs,
    context: DataSourceContext,
  ) {
    // Built once, outside the retries: `resolvedAt` is when the provider decided.
    const decision = buildResolution(args.choice, context.userId);
    const run = await commitRun(context.pool, args.sessionId, (r) => {
      const conflict = r.parent.mergedPlan.conflicts.find((c) => c.conflictId === args.conflictId);
      if (!conflict) {
        throw new GraphQLError(
          `Conflict "${args.conflictId}" not found in session "${args.sessionId}"`,
          { extensions: { code: 'NOT_FOUND' } },
        );
      }
      validateResolutionAgainstConflict(decision, conflict);
      const inputs = runInputsOf(r);
      inputs.conflictResolutions = { ...inputs.conflictResolutions, [args.conflictId]: decision };
      return { inputs, events: [] };
    });
    return formatSessionForGraphQL(run.parent);
  },

  /**
   * Materialize the run the provider reviewed (spec §4, Generation; D7).
   *
   * A COMPLETED run returns its plan without evaluating. Otherwise every child
   * is re-evaluated and the run recomposed: a changed resultHash returns
   * PLAN_CHANGED_SINCE_REVIEW, and unready readiness returns its blockers,
   * after storing the fresh run. If that store loses a revision race, the
   * blockers describe a state that no longer exists, so generation reloads and
   * evaluates again. The claim — the run to COMPLETED under the revision read,
   * every child with it — precedes the inserts in one transaction, so a lost
   * race or a failed insert leaves nothing behind (#4, #8). Every exit writes
   * the audit rows of LLM calls no committed transaction wrote.
   */
  async generateMergedCarePlan(
    _parent: unknown,
    args: { sessionId: string; reviewedResultHash: string },
    context: DataSourceContext,
  ) {
    const { pool } = context;
    const request = newRunRequest();
    type Outcome = { success: boolean; carePlanId: string | null; warnings: string[]; blockers: ReturnType<typeof formatBlocker>[] };

    return withRunAudits(pool, request, async (seen): Promise<Outcome> => {
      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        const run = await loadRun(pool, args.sessionId);
        seen.run = run;
        if (run.parent.status === 'COMPLETED') {
          return { success: true, carePlanId: run.parent.carePlanId, warnings: [], blockers: [] };
        }
        if (run.parent.status === 'ABANDONED') {
          throw new GraphQLError('Session was abandoned and cannot generate a care plan', {
            extensions: { code: 'BAD_REQUEST' },
          });
        }

        const ev = await evaluateRun(pool, request, runInputsOf(run));
        const warnings = warningsOf(ev.result.ddiWarnings);
        const planChanged = ev.result.resultHash !== args.reviewedResultHash;

        try {
          if (planChanged || !ev.result.readiness.ready) {
            // Store what was just evaluated, so the provider re-reviews exactly this.
            await inTransaction(pool, (db) => writeRun(db, run, ev, request, 'ACTIVE'));
            clearAudits(request);
            const blockers = planChanged ? [PLAN_CHANGED] : ev.result.readiness.blockers;
            return { success: false, carePlanId: null, warnings, blockers: blockers.map(formatBlocker) };
          }

          const carePlanId = await inTransaction(pool, async (db) => {
            // Claim first (#8): only the request that moves the run to COMPLETED inserts.
            await writeRun(db, run, ev, request, 'COMPLETED');
            const id = await materializeCarePlan(db, run.parent, ev.result.mergedPlan);
            await setRunCarePlanId(db, run.parent.id, id);
            await writeChildrenLifecycle(db, run.parent.id, SessionStatus.COMPLETED, id);
            for (const child of run.children) {
              await logEvent(db, child.id, {
                eventType: 'care_plan_generated',
                triggerData: { carePlanId: id, runId: run.parent.id },
                nodesRecomputed: 0,
                statusChanges: [{ nodeId: 'session', from: child.status, to: SessionStatus.COMPLETED }],
              });
            }
            return id;
          });
          clearAudits(request);
          return { success: true, carePlanId, warnings, blockers: [] };
        } catch (err) {
          // Either write lost a race: reload, and evaluate the run that won.
          if (err instanceof RevisionConflict) continue;
          if (err instanceof GraphQLError) throw err;
          console.error('Merged care plan generation failed:', err);
          throw new GraphQLError('Failed to generate care plan: transaction rolled back', {
            extensions: { code: 'INTERNAL_SERVER_ERROR' },
          });
        }
      }
      throw conflictError();
    });
  },

  /** Lifecycle only (spec §4): no evaluation; an ACTIVE run only; the revision check applies; every child follows. */
  async abandonMultiPathwaySession(
    _parent: unknown,
    args: { sessionId: string; reason?: string },
    context: DataSourceContext,
  ) {
    const { pool } = context;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const run = await loadRun(pool, args.sessionId);
      assertRunMutable(run);
      try {
        await inTransaction(pool, async (db) => {
          const written = await writeRunLifecycle(db, {
            runId: run.parent.id, expectedRevision: run.parent.revision, status: 'ABANDONED',
          });
          if (!written) throw new RevisionConflict();
          await writeChildrenLifecycle(db, run.parent.id, SessionStatus.ABANDONED);
          for (const child of run.children) {
            await logEvent(db, child.id, {
              eventType: 'abandoned',
              triggerData: { reason: args.reason ?? 'No reason provided', runId: run.parent.id },
              nodesRecomputed: 0,
              statusChanges: [{ nodeId: 'session', from: child.status, to: SessionStatus.ABANDONED }],
            });
          }
        });
      } catch (err) {
        if (err instanceof RevisionConflict) continue;
        throw err;
      }
      return formatSessionForGraphQL((await getMultiPathwaySession(pool, args.sessionId))!);
    }
    throw conflictError();
  },

  /**
   * Hard-delete a preview session (and its contributing per-pathway
   * sessions). Refuses to touch a real session — those must go through
   * `abandonMultiPathwaySession`, which preserves the row for audit.
   * Intended for admin/QA/preview UIs to clean up after themselves so
   * preview traffic doesn't accumulate in the database.
   */
  async deletePreviewSession(
    _parent: unknown,
    args: { sessionId: string },
    context: DataSourceContext,
  ) {
    const result = await deletePreviewSession(context.pool, args.sessionId);
    if (result.kind === 'not-found') {
      throw new GraphQLError('Session not found', {
        extensions: { code: 'NOT_FOUND' },
      });
    }
    if (result.kind === 'not-preview') {
      throw new GraphQLError(
        'Session is not a preview session and cannot be hard-deleted; use abandonMultiPathwaySession instead',
        { extensions: { code: 'FORBIDDEN' } },
      );
    }
    return {
      sessionId: args.sessionId,
      contributingSessionsDeleted: result.contributingSessionsDeleted,
    };
  },
};

// ─── Query resolvers (exported separately for Query.ts) ─────────────

export const multiPathwayResolutionQueries = {
  async multiPathwayResolutionSession(
    _: unknown,
    args: { sessionId: string },
    context: DataSourceContext,
  ) {
    const session = await getMultiPathwaySession(context.pool, args.sessionId);
    return session ? formatSessionForGraphQL(session) : null;
  },

  async patientMultiPathwayResolutionSessions(
    _: unknown,
    args: {
      patientId: string;
      status?: MultiPathwaySessionStatus;
      includePreview?: boolean;
    },
    context: DataSourceContext,
  ) {
    const summaries = await getPatientMultiPathwaySessions(
      context.pool,
      args.patientId,
      args.status,
      args.includePreview ?? false,
    );
    return summaries.map((s) => ({
      id: s.id,
      patientId: s.patientId,
      providerId: s.providerId,
      status: s.status,
      isPreview: s.isPreview,
      contributingPathwayCount: s.contributingPathwayCount,
      unresolvedConflictCount: s.unresolvedConflictCount,
      carePlanId: s.carePlanId,
      createdAt: s.createdAt.toISOString(),
      updatedAt: s.updatedAt.toISOString(),
    }));
  },
};

// ─── Type field resolvers ──────────────────────────────────────────

/**
 * MultiPathwayResolutionSession.contributingPathways — lazily fetches the
 * hydrated Pathway objects for the IDs already on the parent. Single SQL
 * query (`WHERE id = ANY($1)`), one round trip per session. Order is
 * preserved to match `contributingPathwayIds` so the FE can correlate
 * positionally with `sourcePathwayIds` elsewhere on the session.
 */
export const multiPathwayResolutionTypeResolvers = {
  MultiPathwayResolutionSession: {
    contributingPathways: async (
      parent: { contributingPathwayIds: string[] },
      _args: unknown,
      context: DataSourceContext,
    ) => {
      if (!parent.contributingPathwayIds || parent.contributingPathwayIds.length === 0) {
        return [];
      }
      const result = await context.pool.query(
        `SELECT id, age_node_id AS "ageNodeId", logical_id AS "logicalId",
                title, version, category, status,
                condition_codes AS "conditionCodes",
                scope, target_population AS "targetPopulation",
                is_active AS "isActive",
                created_at AS "createdAt", updated_at AS "updatedAt"
           FROM pathway_graph_index
           WHERE id = ANY($1::uuid[])`,
        [parent.contributingPathwayIds],
      );
      const byId = new Map(result.rows.map((row) => [row.id as string, row]));
      return parent.contributingPathwayIds
        .map((id) => byId.get(id))
        .filter((row): row is Record<string, unknown> => row !== undefined);
    },

    /**
     * Aggregate pending Gate questions across all contributing per-pathway
     * sessions. Each entry carries `sessionId` + `pathwayId` so the FE can
     * route the answer to the right per-pathway session and surface which
     * pathway the gate belongs to.
     */
    pendingGateQuestions: async (
      parent: { contributingSessionIds: string[] },
      _args: unknown,
      context: DataSourceContext,
    ) => {
      if (!parent.contributingSessionIds || parent.contributingSessionIds.length === 0) {
        return [];
      }
      const result = await context.pool.query(
        `SELECT s.id AS session_id,
                s.pathway_id AS pathway_id,
                p.title AS pathway_title,
                s.pending_questions AS pending_questions
           FROM pathway_resolution_sessions s
           LEFT JOIN pathway_graph_index p ON p.id = s.pathway_id
          WHERE s.id = ANY($1::uuid[])
            AND jsonb_array_length(s.pending_questions) > 0`,
        [parent.contributingSessionIds],
      );
      const out: Array<{
        sessionId: string;
        pathwayId: string;
        pathwayTitle: string;
        gateId: string;
        prompt: string;
        answerType: string;
        options: string[] | null;
        affectedSubtreeSize: number;
        estimatedImpact: string;
        tentative: boolean | null;
        tentativeBranch: string | null;
        tentativeConfidence: number | null;
        tentativeReasoning: string | null;
        datumKey: string | null;
        optionLabels: string[] | null;
      }> = [];
      for (const row of result.rows) {
        const questions = (row.pending_questions ?? []) as Array<Record<string, unknown>>;
        for (const q of questions) {
          const tentativeConfidenceRaw = q.tentativeConfidence ?? q.tentative_confidence;
          out.push({
            sessionId: String(row.session_id),
            pathwayId: String(row.pathway_id),
            pathwayTitle: String(row.pathway_title ?? '(untitled pathway)'),
            gateId: String(q.gateId ?? q.gate_id ?? ''),
            prompt: String(q.prompt ?? ''),
            answerType: String(q.answerType ?? q.answer_type ?? 'BOOLEAN'),
            options: Array.isArray(q.options) ? (q.options as string[]) : null,
            affectedSubtreeSize: Number(q.affectedSubtreeSize ?? q.affected_subtree_size ?? 0),
            estimatedImpact: String(q.estimatedImpact ?? q.estimated_impact ?? 'unknown'),
            tentative: q.tentative == null ? null : Boolean(q.tentative),
            tentativeBranch: q.tentativeBranch == null && q.tentative_branch == null
              ? null
              : String(q.tentativeBranch ?? q.tentative_branch),
            tentativeConfidence: tentativeConfidenceRaw == null
              ? null
              : Number(tentativeConfidenceRaw),
            tentativeReasoning: q.tentativeReasoning == null && q.tentative_reasoning == null
              ? null
              : String(q.tentativeReasoning ?? q.tentative_reasoning),
            // Both spellings, like the fields above: these rows come off
            // persisted JSON that has been written by more than one shape.
            datumKey: q.datumKey == null && q.datum_key == null
              ? null
              : String(q.datumKey ?? q.datum_key),
            optionLabels: Array.isArray(q.optionLabels ?? q.option_labels)
              ? ((q.optionLabels ?? q.option_labels) as string[])
              : null,
          });
        }
      }
      return out;
    },
  },
};

// ─── Internals ──────────────────────────────────────────────────────

// ─── Conflict resolution logic ──────────────────────────────────────

function buildResolution(
  choice: ConflictChoiceInput,
  resolvedBy: string,
): ConflictResolution {
  const meta = { resolvedBy, resolvedAt: new Date().toISOString(), reason: choice.reason };
  switch (choice.kind) {
    case 'CONFIRM_PATHWAY':
      if (!choice.chosenPathwayId) {
        throw new GraphQLError('chosenPathwayId is required for CONFIRM_PATHWAY', {
          extensions: { code: 'BAD_USER_INPUT' },
        });
      }
      return { kind: 'CONFIRM_PATHWAY', chosenPathwayId: choice.chosenPathwayId, ...meta };
    case 'ACCEPT_BOTH':
      return { kind: 'ACCEPT_BOTH', ...meta };
    case 'REJECT_BOTH':
      return { kind: 'REJECT_BOTH', ...meta };
    case 'CUSTOM_OVERRIDE':
      if (!choice.customMedication) {
        throw new GraphQLError('customMedication is required for CUSTOM_OVERRIDE', {
          extensions: { code: 'BAD_USER_INPUT' },
        });
      }
      return { kind: 'CUSTOM_OVERRIDE', customMedication: choice.customMedication, ...meta };
    default:
      throw new GraphQLError(`Unknown conflict resolution kind: ${choice.kind}`, {
        extensions: { code: 'BAD_USER_INPUT' },
      });
  }
}

function validateResolutionAgainstConflict(
  resolution: ConflictResolution,
  conflict: MergedConflict,
): void {
  if (resolution.kind !== 'CONFIRM_PATHWAY') return;
  const candidatePathwayIds = new Set(
    conflict.candidates.map((c) => c.sourcePathwayId),
  );
  if (!candidatePathwayIds.has(resolution.chosenPathwayId)) {
    throw new GraphQLError(
      `chosenPathwayId "${resolution.chosenPathwayId}" is not among this conflict's candidates`,
      { extensions: { code: 'BAD_USER_INPUT' } },
    );
  }
}

// ─── Care plan materialization ──────────────────────────────────────

/**
 * Insert the patient care plan, goals and interventions from the composed
 * merged plan, inside generation's claimed transaction. Goals come from the
 * contributing pathways (one per pathway); interventions from the merged
 * medications, labs and procedures (review #11 is out of scope).
 *
 * Per migration 019: `care_plans` is the patient-agnostic pathway-definition
 * table; per-patient instances live in `patient_care_plans` (with
 * `patient_care_plan_goals` / `patient_care_plan_interventions`). Provenance
 * (source pathway, source node) goes into `guideline_reference`, since the
 * patient tables have no dedicated columns for it.
 */
async function materializeCarePlan(db: Db, session: MultiPathwayResolutionSession, plan: MergedCarePlan): Promise<string> {
  // A no-op for a real patient; a placeholder for the simulator's synthetic ids,
  // so the patient_care_plans foreign key holds.
  await db.query(
    `INSERT INTO patients (id, first_name, last_name, date_of_birth)
     VALUES ($1, 'Synthetic', 'Simulator Patient', CURRENT_DATE)
     ON CONFLICT (id) DO NOTHING`,
    [session.patientId],
  );

  const carePlanResult = await db.query(
    `INSERT INTO patient_care_plans
       (patient_id, title, provider_id, status, condition_codes, start_date, created_by)
     VALUES ($1, $2, $3, 'DRAFT', $4, CURRENT_DATE, $5)
     RETURNING id`,
    [session.patientId, 'Multi-Pathway Care Plan', session.providerId, [], session.providerId],
  );
  const carePlanId: string = carePlanResult.rows[0].id;

  for (const pathwayId of session.contributingPathwayIds) {
    await db.query(
      `INSERT INTO patient_care_plan_goals
         (patient_care_plan_id, description, priority, guideline_reference)
       VALUES ($1, $2, 'HIGH', $3)`,
      [carePlanId, `Goals from pathway ${pathwayId}`, `pathway:${pathwayId}`],
    );
  }

  // Labs map to MONITORING: the interventions type CHECK has no LAB type.
  for (const m of plan.medications) {
    const r = m.recommendation;
    await db.query(
      `INSERT INTO patient_care_plan_interventions
         (patient_care_plan_id, type, description, dosage, frequency, guideline_reference)
       VALUES ($1, 'MEDICATION', $2, $3, $4, $5)`,
      [carePlanId, r.name, r.dose ?? null, r.frequency ?? null, provenance(r.sourcePathwayId, r.sourceNodeId)],
    );
  }
  for (const l of plan.labs) {
    const r = l.recommendation;
    await db.query(
      `INSERT INTO patient_care_plan_interventions
         (patient_care_plan_id, type, description, guideline_reference)
       VALUES ($1, 'MONITORING', $2, $3)`,
      [carePlanId, r.name, provenance(r.sourcePathwayId, r.sourceNodeId)],
    );
  }
  for (const p of plan.procedures) {
    const r = p.recommendation;
    await db.query(
      `INSERT INTO patient_care_plan_interventions
         (patient_care_plan_id, type, description, procedure_code, guideline_reference)
       VALUES ($1, 'PROCEDURE', $2, $3, $4)`,
      [carePlanId, r.name, r.code ?? null, provenance(r.sourcePathwayId, r.sourceNodeId)],
    );
  }
  return carePlanId;
}

function provenance(pathwayId: string | undefined, nodeId: string | null | undefined): string | null {
  if (!pathwayId && !nodeId) return null;
  const parts: string[] = [];
  if (pathwayId && pathwayId !== 'provider-override') parts.push(`pathway:${pathwayId}`);
  if (nodeId) parts.push(`node:${nodeId}`);
  return parts.length > 0 ? parts.join(' ') : null;
}

export function formatSessionForGraphQL(s: MultiPathwayResolutionSession) {
  return {
    id: s.id,
    patientId: s.patientId,
    providerId: s.providerId,
    status: s.status,
    revision: s.revision,
    resultHash: s.resultHash,
    envFingerprint: s.envFingerprint,
    isPreview: s.isPreview,
    mergedPlan: formatMergedForGraphQL(s.mergedPlan),
    contributingSessionIds: s.contributingSessionIds,
    contributingPathwayIds: s.contributingPathwayIds,
    carePlanId: s.carePlanId,
    ddiWarnings: (s.ddiWarnings ?? []).map(formatDdiWarningForGraphQL),
    createdAt: s.createdAt.toISOString(),
    updatedAt: s.updatedAt.toISOString(),
  };
}

function formatDdiWarningForGraphQL(w: unknown) {
  const wo = (w ?? {}) as Record<string, unknown>;
  const source = (wo.source ?? {}) as Record<string, unknown>;
  return {
    recommendationId: wo.recommendationId ?? '',
    drugName: wo.drugName ?? '',
    category: wo.category ?? 'DDI_MODERATE',
    severity: wo.severity ?? 'MODERATE',
    mechanism: wo.mechanism ?? null,
    clinicalAdvice: wo.clinicalAdvice ?? null,
    source: {
      kind: source.kind ?? '',
      rxcui: source.rxcui ?? null,
      name: source.name ?? null,
      snomedCode: source.snomedCode ?? null,
      snomedDisplay: source.snomedDisplay ?? null,
      recommendationId: source.recommendationId ?? null,
    },
  };
}

const STATE_TO_GQL: Record<string, string> = {
  'auto-included': 'AUTO_INCLUDED',
  'pending-provider-choice': 'PENDING_PROVIDER_CHOICE',
  'provider-confirmed': 'PROVIDER_CONFIRMED',
  'provider-override': 'PROVIDER_OVERRIDE',
};

function gqlState(state: string): string {
  return STATE_TO_GQL[state] ?? 'AUTO_INCLUDED';
}

export function formatMergedForGraphQL(merged: MergedCarePlan) {
  // Defensive defaults on read: sessions stored under prior schema versions
  // may not carry the newer fields (imaging / guidance / catchUpItems /
  // evidenceTrail / dataGapHints). Coalescing to [] here keeps old rows
  // renderable through the current non-nullable schema.
  return {
    sourcePathwayIds: merged.sourcePathwayIds,
    medications: merged.medications.map((m) => ({
      recommendation: m.recommendation,
      sourcePathwayIds: m.sourcePathwayIds,
      state: gqlState(m.state),
    })),
    labs: merged.labs.map((m) => ({
      recommendation: m.recommendation,
      sourcePathwayIds: m.sourcePathwayIds,
      state: gqlState(m.state),
    })),
    imaging: (merged.imaging ?? []).map((m) => ({
      recommendation: m.recommendation,
      sourcePathwayIds: m.sourcePathwayIds,
      state: gqlState(m.state),
    })),
    procedures: merged.procedures.map((m) => ({
      recommendation: m.recommendation,
      sourcePathwayIds: m.sourcePathwayIds,
      state: gqlState(m.state),
    })),
    guidance: (merged.guidance ?? []).map((m) => ({
      recommendation: m.recommendation,
      sourcePathwayIds: m.sourcePathwayIds,
      state: gqlState(m.state),
    })),
    schedules: merged.schedules.map((m) => ({
      recommendation: m.recommendation,
      sourcePathwayIds: m.sourcePathwayIds,
      state: gqlState(m.state),
    })),
    qualityMetrics: merged.qualityMetrics.map((m) => ({
      recommendation: m.recommendation,
      sourcePathwayIds: m.sourcePathwayIds,
      state: gqlState(m.state),
    })),
    suppressed: merged.suppressed.map(formatSuppressedForGraphQL),
    conflicts: merged.conflicts.map(formatConflictForGraphQL),
    catchUpItems: merged.catchUpItems ?? [],
    evidenceTrail: merged.evidenceTrail ?? [],
    dataGapHints: merged.dataGapHints ?? [],
  };
}

function formatSuppressedForGraphQL(s: MergedCarePlan['suppressed'][number]) {
  const typeMap = {
    medication: 'MEDICATION',
    lab: 'LAB',
    imaging: 'IMAGING',
    procedure: 'PROCEDURE',
    guidance: 'GUIDANCE',
    schedule: 'SCHEDULE',
    qualityMetric: 'QUALITY_METRIC',
  } as const;
  const reasonMap: Record<string, string> = {
    contraindicated: 'CONTRAINDICATED',
    avoid: 'AVOID',
    ddi_contraindicated: 'DDI_CONTRAINDICATED',
    ddi_severe: 'DDI_SEVERE',
    allergy: 'ALLERGY',
  };
  // Pathway-source: legacy fields stay populated; DDI-source: legacy fields null.
  const src = s.source;
  return {
    type: typeMap[s.type],
    name: s.name,
    reason: reasonMap[s.reason] ?? 'CONTRAINDICATED',
    suppressedByPathwayId: src.kind === 'PATHWAY' ? src.pathwayId : null,
    suppressedByPathwayTitle: src.kind === 'PATHWAY' ? src.pathwayTitle : null,
    suppressedByPatientMedRxcui:
      src.kind === 'PATIENT_MEDICATION' ? src.rxcui : null,
    suppressedByPatientMedName:
      src.kind === 'PATIENT_MEDICATION' ? src.name : null,
    suppressedByAllergyCode:
      src.kind === 'PATIENT_ALLERGY' ? src.snomedCode : null,
    suppressedByAllergyDisplay:
      src.kind === 'PATIENT_ALLERGY' ? src.snomedDisplay : null,
    suppressedByRecommendationName:
      src.kind === 'OTHER_RECOMMENDATION' ? src.drugName : null,
    // Which pathway proposed it: the "pathway reason" beside the safety reason (spec §5.10).
    sourcePathwayId: s.original.sourcePathwayId ?? null,
  };
}

function formatConflictForGraphQL(c: MergedConflict) {
  return {
    conflictId: c.conflictId,
    type: 'MEDICATION',
    clinicalRole: c.clinicalRole,
    candidates: c.candidates.map((cand) => ({
      recommendation: cand.recommendation,
      sourcePathwayId: cand.sourcePathwayId,
      sourcePathwayTitle: cand.sourcePathwayTitle,
    })),
    resolution: c.resolution ? formatResolutionForGraphQL(c.resolution) : null,
  };
}

function formatResolutionForGraphQL(r: ConflictResolution) {
  const base = {
    kind: r.kind,
    resolvedBy: r.resolvedBy,
    resolvedAt: r.resolvedAt,
    reason: r.reason ?? null,
    chosenPathwayId: null as string | null,
    customMedication: null as CustomMedicationOverride | null,
  };
  if (r.kind === 'CONFIRM_PATHWAY') base.chosenPathwayId = r.chosenPathwayId;
  if (r.kind === 'CUSTOM_OVERRIDE') base.customMedication = r.customMedication;
  return base;
}
```

- [ ] **Step 8: Route children in `resolvers/mutations/resolution.ts`**

1. Imports:
   - add `import type { Pool } from 'pg';`
   - add `import type { DdiFinding } from '../../services/medications/ddi-pass';`
   - add `import { childChange, commitRun } from '../../services/resolution/pipeline/run-commit';`
   - add `childOfRunError` to the `pipeline/commit` import list;
   - change `import type { EvaluationResult, ScopedBlocker } from '../../services/resolution/pipeline/types';`
     to `import type { ScopedBlocker } from '../../services/resolution/pipeline/types';`.

2. Replace `formatBlocker`, `warningsOf` and the `PLAN_CHANGED` declaration with:

```ts
/** A blocker as the API returns it. `pathwayId` is set on a blocker a run propagates from one of its pathways. */
export function formatBlocker(b: ScopedBlocker & { pathwayId?: string }) {
  return { scope: b.scope, type: b.type, description: b.description, relatedNodeIds: b.relatedNodeIds, pathwayId: b.pathwayId ?? null };
}

/** Moderate interactions accompany a plan without blocking it (P3-9). */
export function warningsOf(findings: DdiFinding[]): string[] {
  return findings
    .filter((f) => f.action === 'WARN')
    .map((f) => `${f.category}: ${f.drugName}${f.clinicalAdvice ? ` — ${f.clinicalAdvice}` : ''}`);
}

export const PLAN_CHANGED: ScopedBlocker = {
  scope: 'OUTPUT',
  type: 'PLAN_CHANGED_SINCE_REVIEW',
  description: 'The plan changed after it was reviewed. Review the current plan and generate again.',
  relatedNodeIds: [],
};
```

   In `generateCarePlanFromResolution`, change `const warnings = warningsOf(result);` to
   `const warnings = warningsOf(result.safetyFindings);`.

3. Directly after `answerChange`, add:

```ts
/** An override, as a change to a session's inputs. The pathway's own decision survives re-overrides. */
function overrideChange(
  s: ResolutionSession,
  args: { sessionId: string; nodeId: string; action: OverrideAction; reason?: string },
): Change {
  const node = s.resolutionState.get(args.nodeId);
  if (!node) {
    throw new GraphQLError(`Node "${args.nodeId}" not found in session`, { extensions: { code: 'NOT_FOUND' } });
  }
  // The pathway's own decision, kept across re-overrides: an override of an
  // override still records what the pathway originally concluded.
  const previous = s.providerOverrides.get(args.nodeId);
  const override: ProviderOverride = {
    action: args.action,
    reason: args.reason,
    originalStatus: previous?.originalStatus ?? node.status,
    originalConfidence: previous?.originalConfidence ?? node.confidence,
  };
  const inputs = inputsOf(s);
  inputs.providerOverrides.set(args.nodeId, override);
  return {
    inputs,
    event: { eventType: 'override', triggerData: { nodeId: args.nodeId, action: args.action, reason: args.reason } },
    record: (db) => logNodeOverride(db, {
      sessionId: args.sessionId,
      nodeId: args.nodeId,
      pathwayId: s.pathwayId,
      action: args.action,
      reason: args.reason,
      originalStatus: override.originalStatus,
      originalConfidence: override.originalConfidence,
    }),
  };
}

/** New facts accumulate onto everything supplied before: adding A then B keeps both. */
function contextChange(s: ResolutionSession, additionalContext: AdditionalContextInput): Change {
  const inputs = inputsOf(s);
  inputs.additionalContext = mergeAdditionalContext(inputs.additionalContext, additionalContext);
  return {
    inputs,
    event: {
      eventType: 'context_update',
      triggerData: {
        addedContext: Object.keys(additionalContext).filter(
          (k) => (additionalContext as Record<string, unknown>)[k] !== undefined,
        ),
      },
    },
  };
}

/**
 * Commit a change to one session. A child of a run changes through its run —
 * facts to the parent, answers and overrides to the child, every child
 * re-evaluated (D5, D6, D13); a standalone session through commitEvaluation.
 * Returns the session as committed.
 */
async function commitSession(pool: Pool, sessionId: string, build: (s: ResolutionSession) => Change): Promise<ResolutionSession> {
  const session = await loadSession(pool, sessionId);
  if (!session.parentSessionId) return commitEvaluation(pool, sessionId, build);
  const run = await commitRun(pool, session.parentSessionId, (r) => childChange(r, sessionId, build));
  return run.children.find((c) => c.id === sessionId)!;
}
```

4. In `overrideNode`, replace the whole body with:

```ts
    return formatSessionForGraphQL(await commitSession(context.pool, args.sessionId, (s) => overrideChange(s, args)));
```

5. In `answerPendingDecision`, replace
   `const session = await commitEvaluation(context.pool, args.sessionId, (s) => answerChange(s, args));`
   with
   `const session = await commitSession(context.pool, args.sessionId, (s) => answerChange(s, args));`.
6. In `addPatientContext`, replace the `const session = await commitEvaluation(context.pool,
   args.sessionId, (s) => { … });` statement with
   `const session = await commitSession(context.pool, args.sessionId, (s) => contextChange(s, additionalContext));`.
   The boundary checks above it are unchanged and still run before anything is loaded.
7. In `generateCarePlanFromResolution` and in `abandonSession`, directly after
   `const session = await loadSession(pool, args.sessionId);`, add
   `if (session.parentSessionId) throw childOfRunError();`. A run is generated or abandoned
   as a whole (spec §3).

- [ ] **Step 9: Retire and move the tests of the old run code**

1. Delete four files. Check each test against *Appendix B* first; a test with no row there is a
   gap, so stop and report it.

```bash
git -C $W rm -q \
  apps/pathway-service/src/__tests__/multi-pathway-resolution.test.ts \
  apps/pathway-service/src/__tests__/ddi-multi-pathway.test.ts \
  apps/pathway-service/src/__tests__/pipeline-multi-children.test.ts \
  apps/pathway-service/src/__tests__/patient-attributes-mapping.test.ts
```

2. `preview-session-isolation.test.ts`: replace everything above
   `describe('deletePreviewSession mutation', () => {` with the block below. The `deletePreviewSession`
   tests stay unchanged; the four start tests moved to `pipeline-run-mutations` (*Appendix B*).

```ts
/**
 * Preview session cleanup — resolver-level tests.
 *
 * deletePreviewSession delegates to the store and translates its result kinds
 * into GraphQL errors (NOT_FOUND / FORBIDDEN). That a preview run is stored
 * with isPreview=true is tested against the real pipeline in
 * pipeline-run-mutations.test.ts; store-level SQL in
 * multi-pathway-session-store-preview.test.ts.
 */

jest.mock('../services/resolution/multi-pathway-session-store', () => ({
  deletePreviewSession: jest.fn(),
}));

import { multiPathwayResolutionMutations } from '../resolvers/mutations/multi-pathway-resolution';
import { deletePreviewSession as mockedStoreDelete } from '../services/resolution/multi-pathway-session-store';

function fakeCtx() {
  return {
    pool: { connect: jest.fn() } as unknown,
    redis: {},
    userId: 'provider-1',
    userRole: 'PROVIDER',
  } as never;
}

```

3. `multi-pathway-session-store-preview.test.ts`: in the import list replace `createMultiPathwaySession,`
   with `insertRun,`. Then replace the whole `describe('createMultiPathwaySession: is_preview persistence', …)`
   with:

```ts
describe('insertRun: is_preview persistence', () => {
  const run = (isPreview: boolean) => ({
    patientId: 'pt-1', providerId: 'prov-1', isPreview, initialPatientContext: {}, temporalContext: TEST_TCTX,
    additionalContext: {}, conflictResolutions: {},
    result: {
      mergedPlan: EMPTY_MERGED_PLAN, safetyFindings: [], ddiWarnings: [], readiness: { ready: false, blockers: [] },
      children: [], envFingerprint: 'e', resultHash: 'h',
    },
  });
  const isPreviewParam = (call: { sql: string; params: unknown[] }) => {
    const columns = call.sql.slice(call.sql.indexOf('(') + 1, call.sql.indexOf(')')).split(',').map((c) => c.trim());
    return call.params[columns.indexOf('is_preview')];
  };

  it('writes is_preview=false for a real run', async () => {
    const { pool, calls } = makeSpyPool([{ rows: [{ id: 'sess-1' }] }]);
    await insertRun(pool, run(false) as never);
    expect(calls).toHaveLength(1);
    expect(isPreviewParam(calls[0])).toBe(false);
  });

  it('threads isPreview=true when supplied', async () => {
    const { pool, calls } = makeSpyPool([{ rows: [{ id: 'sess-2' }] }]);
    await insertRun(pool, run(true) as never);
    expect(isPreviewParam(calls[0])).toBe(true);
  });
});
```

   Also update the header comment's `createMultiPathwaySession` mention to `insertRun`.

4. `temporal/session-temporal-context.test.ts`: in the multi-pathway import list replace
   `createMultiPathwaySession,` with `insertRun,`. Add, after the `TCTX` constant:

```ts
const RUN_FIXTURE = {
  patientId: 'pt', providerId: 'pr', isPreview: false, initialPatientContext: {},
  additionalContext: {}, conflictResolutions: {},
  result: { mergedPlan: {}, safetyFindings: [], ddiWarnings: [], readiness: { ready: false, blockers: [] }, children: [], envFingerprint: 'e', resultHash: 'h' },
};
```

   Then replace the test `createMultiPathwaySession writes the temporal context as JSON` with:

```ts
  it('insertRun writes the temporal context as JSON', async () => {
    const { pool, calls } = fakePool([]);
    await insertRun(pool as never, { ...RUN_FIXTURE, temporalContext: TCTX } as never);

    const insert = calls.find((c) => c.sql.includes('INSERT INTO multi_pathway_resolution_sessions'))!;
    expect(insert.sql).toContain('temporal_context');
    // Placeholder count must match the parameter array, or pg throws at runtime.
    expect(insert.sql).toContain(`$${insert.params.length})`);
    expect(insert.params).toContain(JSON.stringify(TCTX));
  });
```

   and the test `createMultiPathwaySession refuses to persist a session with no clock` with:

```ts
  it('insertRun refuses to persist a run with no clock', async () => {
    const { pool, calls } = fakePool([]);
    await expect(insertRun(pool as never, { ...RUN_FIXTURE } as never)).rejects.toThrow(/temporalContext/);
    // It must fail BEFORE writing, not roll back after.
    expect(calls).toHaveLength(0);
  });
```

   In the multi-pathway block comment above them ("These are NOT redundant …"), replace
   "The multi-pathway INSERT currently ends at $8 and gains a 9th placeholder, and its read path
   goes through `rowToSession`" with "The run INSERT is built from a column map, and its read path
   goes through `runRowToSession`".
5. `temporal/resolution-fact-store-wiring.test.ts`: delete the test
   `stamps the INJECTED version on the zero-match path` (moved to `pipeline-run-mutations`, *a
   zero-match run is stored …*). If `persistedVersionOf` is then unused, delete it too. The file's
   `jest.mock` factories still name functions that no longer exist; the kept tests throw at the
   boundary before reaching them, so leave the factories alone.

- [ ] **Step 10: Run everything this task touches, typecheck, full suite**

```bash
npm test --prefix $W/apps/pathway-service -- --runInBand src/__tests__/pipeline-run-mutations.test.ts src/__tests__/pipeline-run-generation.test.ts src/__tests__/pipeline-sdl.test.ts src/__tests__/preview-session-isolation.test.ts src/__tests__/multi-pathway-session-store-preview.test.ts src/__tests__/temporal/session-temporal-context.test.ts src/__tests__/temporal/resolution-fact-store-wiring.test.ts src/__tests__/contributing-pathways-resolver.test.ts src/__tests__/pipeline-resolver-mutations.test.ts src/__tests__/pipeline-resolver-generation.test.ts
$W/node_modules/.bin/tsc -p $W/apps/pathway-service/tsconfig.json --noEmit
npm test --prefix $W/apps/pathway-service -- --runInBand 2>&1 | grep -E "^(FAIL|Tests:)" | sort | uniq -c
```
Expected:
- Every listed suite passes (21 + 10 new tests, 2 added to the SDL suite).
- The typecheck is clean.
- In the full suite, the only `FAIL` lines are the two scorer suites.

**Falsify, one at a time, restoring each:**
1. In `commitSession`, delete the `parentSessionId` branch so every session goes to
   `commitEvaluation`. The *answering a child's gate* test must fail with
   `CHILD_OF_MULTI_PATHWAY_SESSION`.
2. In `generateMergedCarePlan`, compare `ev.result.resultHash` with `run.parent.resultHash`
   instead of `args.reviewedResultHash`. The `PLAN_CHANGED_SINCE_REVIEW` test must fail: the
   answer updated the stored hash, so a stale review looks current.
3. In `generateMergedCarePlan`, move `materializeCarePlan` into its own
   `inTransaction(pool, (db) => materializeCarePlan(db, run.parent, ev.result.mergedPlan))` before
   the claiming transaction. The lost-race test must fail with 2 care plan inserts.
4. In the claiming transaction, delete `await writeChildrenLifecycle(…)`. The *every child
   completes* test must fail.

- [ ] **Step 11: Commit**

```bash
git -C $W add -A apps/pathway-service/src apps/pathway-service/schema.graphql
git -C $W status --short   # expect only this task's files
git -C $W commit -m "feat(pathway-service): multi-pathway runs on the evaluation pipeline

Start creates the parent and every child in one transaction; answers,
overrides and facts on a child route through commitRun (facts to the
parent, D5); resolveConflict records a decision the composition applies
to the base merge; generateMergedCarePlan requires the reviewed hash (D7),
claims the run and its children before inserting, and returns an existing
plan for a completed run; abandon is lifecycle-only and cascades.
reMergeMultiPathwaySession is removed (spec §3). Old run tests are mapped
in plan 04 Appendix B.

Claude-Session: https://claude.ai/code/session_01XRNkZvQrxmRLNtJHxq71kH"
```

---

### Task 7: Delete the dead DDI orchestration

**Files:**
- Rewrite: `apps/pathway-service/src/services/medications/ddi-pass.ts`
- Delete: `apps/pathway-service/src/services/medications/ddi-pass-single-pathway.ts`
- Modify: `apps/pathway-service/src/services/resolution/pipeline/disposition.ts` (gains `ddiSuppressionReason`)
- Modify: `apps/pathway-service/src/services/resolution/pipeline/compose.ts` (import path)
- Modify (tests):
  - `evaluation-benchmark.test.ts` (minimal port, P4-9)
  - `temporal/resolution-fact-store-wiring.test.ts` (one `jest.mock` block)
- Delete (test): `ddi-pass-single-pathway.test.ts` (*Appendix B*)
- Test: `apps/pathway-service/src/__tests__/pipeline-disposition-reason.test.ts`

This task is pure deletion plus one move. After Task 6 nothing in production calls
`runPatientContextDdi`, `runCrossRecommendationDdi` or `applyDdiToResolutionState`.

**Interfaces:**
- Produces: `ddiSuppressionReason(findings: DdiFinding[], recommendationId: string): string | undefined`,
  now exported from `pipeline/disposition.ts` with an unchanged body.
- `ddi-pass.ts` keeps `DdiCandidate`, `DdiAction`, `DdiSource`, `DdiFinding`,
  `buildDrugDrugFinding` and `toEngineDrug`.

- [ ] **Step 1: Prove the code is dead**

```bash
S=$W/apps/pathway-service/src
grep -rnE "runPatientContextDdi|runCrossRecommendationDdi|applyDdiToResolutionState|DdiPassResult|normalizeCandidates|normalizePatientMeds" $S --include=*.ts | grep -v __tests__ | grep -vE "^\S+:(\s*\*|\s*//)"
```
Expected: definition sites in `ddi-pass.ts` and `ddi-pass-single-pathway.ts` only. **A call site
anywhere else means Task 6 is incomplete: stop and report it.**

- [ ] **Step 2: Write the test for the moved function**

Create `apps/pathway-service/src/__tests__/pipeline-disposition-reason.test.ts`:

```ts
import { ddiSuppressionReason } from '../services/resolution/pipeline/disposition';

const finding = (category: string, source: Record<string, unknown>) => ({
  recommendationId: 'm', drugName: 'Amoxicillin', action: 'SUPPRESS', severity: 'SEVERE',
  category, mechanism: null, clinicalAdvice: null, source,
});
const DDI = finding('DDI_SEVERE', { kind: 'PATIENT_MEDICATION', rxcui: '11289', name: 'warfarin' });
const ALLERGY = finding('ALLERGY', { kind: 'PATIENT_ALLERGY', snomedCode: '91936005', snomedDisplay: 'Allergy to penicillin' });

describe('ddiSuppressionReason (moved from ddi-pass-single-pathway)', () => {
  it('names an allergy before a drug-drug interaction, whatever order the findings arrive in', () => {
    for (const findings of [[DDI, ALLERGY], [ALLERGY, DDI]]) {
      expect(ddiSuppressionReason(findings as never, 'm')).toBe('ALLERGY: patient allergy "Allergy to penicillin"');
    }
  });

  it('names the other recommendation of a pair suppression', () => {
    const pair = finding('DDI_SEVERE', { kind: 'OTHER_RECOMMENDATION', recommendationId: 'pw-c|asa', drugName: 'Aspirin' });
    expect(ddiSuppressionReason([pair] as never, 'm')).toBe('DDI_SEVERE: recommendation "Aspirin"');
  });

  it('is undefined when nothing suppresses the node', () => {
    expect(ddiSuppressionReason([], 'm')).toBeUndefined();
  });
});
```

Run: `npm test --prefix $W/apps/pathway-service -- --runInBand src/__tests__/pipeline-disposition-reason.test.ts`
Expected: FAIL — `disposition` does not export `ddiSuppressionReason` yet.

- [ ] **Step 3: Move `ddiSuppressionReason`**

1. In `pipeline/disposition.ts`, replace
   `import { ddiSuppressionReason } from '../../medications/ddi-pass-single-pathway';` and
   `import type { DdiCandidate } from '../../medications/ddi-pass';` with
   `import type { DdiCandidate, DdiFinding } from '../../medications/ddi-pass';`, and append:

```ts
/**
 * The most informative suppression reason for a node. When several findings
 * suppress it, an allergy is named before a contraindication before a severe
 * interaction — the order a clinician wants.
 */
export function ddiSuppressionReason(findings: DdiFinding[], recommendationId: string): string | undefined {
  const relevant = findings.filter((f) => f.recommendationId === recommendationId && f.action === 'SUPPRESS');
  if (relevant.length === 0) return undefined;
  const order = ['ALLERGY', 'DDI_CONTRAINDICATED', 'DDI_SEVERE'] as const;
  relevant.sort((a, b) => order.indexOf(a.category as never) - order.indexOf(b.category as never));
  const top = relevant[0];
  const sourceLabel =
    top.source.kind === 'PATIENT_MEDICATION' ? `patient med "${top.source.name}"`
      : top.source.kind === 'PATIENT_ALLERGY' ? `patient allergy "${top.source.snomedDisplay}"`
        : `recommendation "${top.source.drugName}"`;
  return `${top.category}: ${sourceLabel}${top.mechanism ? ` — ${top.mechanism}` : ''}`;
}
```

2. In `pipeline/compose.ts`, delete `import { ddiSuppressionReason } from '../../medications/ddi-pass-single-pathway';`
   and change `import { findingId } from './disposition';` to
   `import { ddiSuppressionReason, findingId } from './disposition';`.

- [ ] **Step 4: Delete**

```bash
git -C $W rm -q apps/pathway-service/src/services/medications/ddi-pass-single-pathway.ts apps/pathway-service/src/__tests__/ddi-pass-single-pathway.test.ts
```

Replace `services/medications/ddi-pass.ts` with:

```ts
/**
 * DDI finding shapes, and the one piece of DDI logic the evaluation pipeline
 * shares: turning an interaction result into a finding.
 *
 * The orchestration that used to live here (runPatientContextDdi,
 * runCrossRecommendationDdi) queried the database per pass and silently
 * skipped a drug it could not normalise. The pipeline reads one safety
 * reference per snapshot instead (C4) and reports an unnormalised drug
 * (D14): see services/resolution/pipeline/safety.ts.
 *
 * Findings sort into suppress vs warn per Decision 5:
 *   CONTRAINDICATED + SEVERE → SUPPRESS
 *   MODERATE                 → WARN
 *   MINOR                    → dropped (not surfaced)
 */

import type { DdiSeverity, InteractionResult } from './ddi-engine';
import type { NormalizedMedication } from './types';

// ─── Inputs ───────────────────────────────────────────────────────────

export interface DdiCandidate {
  /** Stable identifier for the recommendation in the caller's domain. */
  recommendationId: string;
  /** Display name (used in findings even when normalization fails). */
  drugName: string;
  /** Optional code system / code, like MedicationInput. */
  system?: string;
  code?: string;
  /** Caller-attached metadata, threaded through unchanged. */
  meta?: Record<string, unknown>;
}

// ─── Findings ─────────────────────────────────────────────────────────

export type DdiAction = 'SUPPRESS' | 'WARN';

export type DdiSource =
  | { kind: 'PATIENT_MEDICATION'; rxcui: string; name: string }
  | { kind: 'PATIENT_ALLERGY'; snomedCode: string; snomedDisplay: string }
  | { kind: 'OTHER_RECOMMENDATION'; recommendationId: string; drugName: string };

export interface DdiFinding {
  recommendationId: string;
  drugName: string;
  action: DdiAction;
  severity: DdiSeverity;
  /** Reason category — directly maps to GraphQL SuppressionReason / warning kind. */
  category: 'DDI_CONTRAINDICATED' | 'DDI_SEVERE' | 'DDI_MODERATE' | 'ALLERGY';
  mechanism: string | null;
  clinicalAdvice: string | null;
  source: DdiSource;
  meta?: Record<string, unknown>;
}

// ─── Finding construction ─────────────────────────────────────────────

export function buildDrugDrugFinding(
  candidate: DdiCandidate,
  candidateNorm: NormalizedMedication,
  result: InteractionResult | null,
  source: DdiSource,
): DdiFinding | null {
  if (!result) return null;
  const action = severityToAction(result.severity);
  if (!action) return null; // MINOR: ignored
  return {
    recommendationId: candidate.recommendationId,
    drugName: candidate.drugName,
    action,
    severity: result.severity,
    category:
      result.severity === 'CONTRAINDICATED' ? 'DDI_CONTRAINDICATED'
        : result.severity === 'SEVERE'      ? 'DDI_SEVERE'
        : 'DDI_MODERATE',
    mechanism: result.mechanism,
    clinicalAdvice: result.clinicalAdvice,
    source,
    meta: candidate.meta,
  };
}

export function toEngineDrug(norm: NormalizedMedication): { rxcui: string; atcClasses: string[] } {
  return { rxcui: norm.ingredientRxcui, atcClasses: norm.atcClasses };
}

function severityToAction(severity: DdiSeverity): DdiAction | null {
  switch (severity) {
    case 'CONTRAINDICATED':
    case 'SEVERE':
      return 'SUPPRESS';
    case 'MODERATE':
      return 'WARN';
    case 'MINOR':
      return null;
  }
}
```

`buildDrugDrugFinding` still takes `candidateNorm`, which it never read. Its signature is
unchanged here, because `pipeline/safety.ts` passes it.

- [ ] **Step 5: The two tests that referenced the deleted module**

1. `temporal/resolution-fact-store-wiring.test.ts`: delete the whole
   `jest.mock('../../services/medications/ddi-pass-single-pathway', () => ({ … }));` block. Jest
   cannot mock a module file that no longer exists, so the suite would fail to load.
2. `evaluation-benchmark.test.ts` (skipped unless `RUN_EVALUATION_BENCHMARK=1`; a suite that
   cannot import still FAILS):
   - replace `import { applyDdiToResolutionState } from '../services/medications/ddi-pass-single-pathway';` with:

```ts
import { loadSafetyReference } from '../services/medications/safety-reference';
import { medicationCandidates } from '../services/resolution/pipeline/disposition';
import { patientSafety } from '../services/resolution/pipeline/safety';
```

   - replace `await applyDdiToResolutionState(pool, safetyState, PATIENT);` with:

```ts
  // Minimal port (plan 04, P4-9): the pipeline's patient-scope safety stage.
  // Plan 05 rewrites this benchmark onto loadRunEnv + evaluateRun before
  // re-running the gate against live data.
  const candidates = medicationCandidates(safetyState);
  const reference = await loadSafetyReference(pool, {
    medications: [
      ...candidates.map((c) => ({ text: c.drugName })),
      ...(PATIENT.medications ?? []).map((m) => ({ text: m.display ?? m.code, system: m.system, code: m.code })),
    ],
    allergySnomedCodes: (PATIENT.allergies ?? []).filter((a) => a.system === 'SNOMED').map((a) => a.code),
  });
  patientSafety(reference, candidates, PATIENT);
```

- [ ] **Step 6: Verify, typecheck, run everything**

```bash
S=$W/apps/pathway-service/src
grep -rnE "runPatientContextDdi|runCrossRecommendationDdi|applyDdiToResolutionState|ddi-pass-single-pathway" $S --include=*.ts | grep -vE "^\S+:(\s*\*|\s*//)"
$W/node_modules/.bin/tsc -p $W/apps/pathway-service/tsconfig.json --noEmit
npm test --prefix $W/apps/pathway-service -- --runInBand 2>&1 | grep -E "^(FAIL|Tests:)" | sort | uniq -c
```
Expected:
- The grep prints only the stale `jest.mock` factory keys in `resolution-fact-store-wiring`
  (`runPatientContextDdi` / `runCrossRecommendationDdi` under its `ddi-pass` mock). They are
  harmless and left alone, as in plan 03.
- The typecheck is clean.
- The only `FAIL` lines are the two scorer suites.

**Falsify:** in `ddiSuppressionReason`, delete the `relevant.sort(…)` line. The allergy-first
test must fail for the `[DDI, ALLERGY]` order. Restore it.

- [ ] **Step 7: Commit**

```bash
git -C $W add -A apps/pathway-service/src
git -C $W commit -m "refactor(pathway-service): delete the pre-pipeline DDI orchestration

runPatientContextDdi, runCrossRecommendationDdi and
applyDdiToResolutionState go: every evaluation runs safety from the
snapshot's reference (C4) and reports unnormalised drugs (D14). ddiSuppression-
Reason moves to pipeline/disposition. Plan 01's skipped benchmark gets a
minimal port of its safety stage (P4-9).

Claude-Session: https://claude.ai/code/session_01XRNkZvQrxmRLNtJHxq71kH"
```

---

### Task 8: Runs — sequence versus fresh, order independence, and the review's reproductions

**Files:**
- Test: `apps/pathway-service/src/__tests__/pipeline-run-sequence-vs-fresh.test.ts`

**Interfaces:**
- Consumes: the resolvers (Task 6), `evaluateRun`, `runInputsOf`, `loadRun` (Task 5), the
  harness, `mergeAdditionalContext`, `normalizedKey`, fast-check.

No production code changes are expected. **A failure here is a defect in Tasks 2–7, not in the
test.** Report fast-check's shrunk counterexample before changing anything.

- [ ] **Step 1: Write the test**

Create `apps/pathway-service/src/__tests__/pipeline-run-sequence-vs-fresh.test.ts`:

```ts
/**
 * Spec §5.3 for runs:
 *   (a) edits applied one mutation at a time equal evaluateRun(final inputs);
 *   (b) independent edits in any order give the same run.
 * Plus the multi-pathway reproductions of the 2026-09-13 engine review
 * (§5.2; P3-3): #2, #5, #6 and #7, through the resolvers.
 */
jest.mock('../services/resolution/session-store', () => require('./fixtures/resolver-harness').sessionStoreMock());
jest.mock('../services/resolution/multi-pathway-session-store', () => require('./fixtures/resolver-harness').runStoreMock());
jest.mock('../services/resolution/pipeline/load-env', () => require('./fixtures/resolver-harness').loadEnvMock());
jest.mock('../services/resolution/lattice-collapse', () => require('./fixtures/resolver-harness').latticeMock());

import * as fc from 'fast-check';
import { multiPathwayResolutionMutations } from '../resolvers/mutations/multi-pathway-resolution';
import { resolutionMutations } from '../resolvers/mutations/resolution';
import type { GraphNode } from '../services/confidence/types';
import { normalizedKey } from '../services/medications/safety-reference';
import { mergeAdditionalContext } from '../services/resolution/effective-context';
import { evaluateRun, newRunRequest, runInputsOf } from '../services/resolution/pipeline/run';
import type { RunInputs } from '../services/resolution/pipeline/run';
import { loadRun } from '../services/resolution/pipeline/run-commit';
import { AnswerType, DefaultBehavior, GateType, NodeStatus, OverrideAction } from '../services/resolution/types';
import { harness } from './fixtures/resolver-harness';
import { edge, makeEnv, node } from './fixtures/pipeline-env';

const PINNED = '2026-08-30T12:00:00.000Z';
const norm = (rxcui: string, name: string, atc: string) => ({ ingredientRxcui: rxcui, ingredientName: name, atcClasses: [atc] });
const WARFARIN_RX = { code: '11289', system: 'RxNorm', display: 'Warfarin' };
const PENICILLIN = { code: '91936005', system: 'SNOMED', display: 'Allergy to penicillin' };
const SAFETY = {
  normalized: new Map([
    ['warfarin||', norm('11289', 'warfarin', 'B01AA03')],
    ['aspirin||', norm('1191', 'aspirin', 'B01AC06')],
    ['amoxicillin||', norm('723', 'amoxicillin', 'J01CA04')],
    ['metoprolol||', norm('6918', 'metoprolol', 'C07AB02')],
    [normalizedKey({ text: 'Warfarin', system: 'RxNorm', code: '11289' }), norm('11289', 'warfarin', 'B01AA03')],
  ]),
  pairs: new Map([['11289|1191', { severity: 'SEVERE' as const, mechanism: 'bleeding', clinicalAdvice: null, matchType: 'PAIR' as const, matchedClasses: null }]]),
  allergyMappings: [{ snomedCode: '91936005', snomedDisplay: 'Allergy to penicillin', atcClass: 'J01C' }],
};
const med = (id: string, name: string, extra: Record<string, unknown> = {}) => node(id, 'Medication', { name, role: 'first_line', ...extra });
const question = (id: string) =>
  node(id, 'Gate', { gate_type: GateType.QUESTION, default_behavior: DefaultBehavior.SKIP, answer_type: AnswerType.BOOLEAN, prompt: `${id}?` });
/** root → gate → step → medications. */
const gated = (gateId: string, meds: GraphNode[]) => makeEnv(
  [node('root', 'Pathway'), question(gateId), node('step', 'Step'), ...meds],
  [edge('root', gateId, 'HAS_GATE'), edge(gateId, 'step', 'BRANCHES_TO', { when: { equals: true } }), ...meds.map((m) => edge('step', m.nodeIdentifier))],
  SAFETY,
);
const plain = (meds: GraphNode[]) =>
  makeEnv([node('root', 'Pathway'), node('step', 'Step'), ...meds], [edge('root', 'step'), ...meds.map((m) => edge('step', m.nodeIdentifier))], SAFETY);

/** Warfarin (behind qa) and Aspirin share a lane and interact; pw-c holds two unrelated drugs behind qc. */
function register(): void {
  harness.addPathway('pw-a', gated('qa', [med('warf', 'Warfarin', { clinical_role: 'anticoag' })]));
  harness.addPathway('pw-b', plain([med('asa', 'Aspirin', { clinical_role: 'anticoag' })]));
  harness.addPathway('pw-c', gated('qc', [med('amox', 'Amoxicillin'), med('meto', 'Metoprolol')]));
}
const PATHWAYS = ['pw-a', 'pw-b', 'pw-c'];
const GATE = { qa: 'pw-a', qc: 'pw-c' } as const;
const TARGET = { warf: 'pw-a', asa: 'pw-b', amox: 'pw-c', meto: 'pw-c' } as const;
const FACT = { allergy: { allergies: [PENICILLIN] }, patientMed: { medications: [WARFARIN_RX] } } as const;
const CHOICE = {
  CONFIRM_A: { kind: 'CONFIRM_PATHWAY', chosenPathwayId: 'pw-a' },
  CONFIRM_B: { kind: 'CONFIRM_PATHWAY', chosenPathwayId: 'pw-b' },
  ACCEPT_BOTH: { kind: 'ACCEPT_BOTH' },
  REJECT_BOTH: { kind: 'REJECT_BOTH' },
  WRITE_IN: { kind: 'CUSTOM_OVERRIDE', customMedication: { name: 'Amoxicillin' } },
} as const;

const ctx = () => harness.context({ temporalPolicyVersion: 'legacy-v0' });
async function startRun(pathways = PATHWAYS): Promise<string> {
  harness.matchPathways(...pathways);
  const run = await multiPathwayResolutionMutations.startMultiPathwayResolution(null as never, {
    patientId: 'pt-1', resolutionMode: 'SYNTHETIC', evaluationAsOf: PINNED, syntheticPatient: true,
    patientContext: { patientId: 'pt-1', conditionCodes: [], medications: [], allergies: [], labResults: [] },
  } as never, ctx());
  return (run as { id: string }).id;
}
const childOf = (runId: string, pathwayId: string) => {
  const r = harness.run(runId);
  return r.contributingSessionIds[r.contributingPathwayIds.indexOf(pathwayId)];
};
const medsOf = (runId: string) => harness.run(runId).mergedPlan.medications.map((m) => m.recommendation.name).sort();

type Edit =
  | { kind: 'answer'; gate: keyof typeof GATE; value: boolean }
  | { kind: 'override'; node: keyof typeof TARGET; include: boolean }
  | { kind: 'fact'; fact: keyof typeof FACT }
  | { kind: 'choose'; decision: keyof typeof CHOICE };

const answerArb = fc.record({ kind: fc.constant('answer' as const), gate: fc.constantFrom('qa' as const, 'qc' as const), value: fc.boolean() });
const overrideArb = fc.record({ kind: fc.constant('override' as const), node: fc.constantFrom('warf' as const, 'asa' as const, 'amox' as const, 'meto' as const), include: fc.boolean() });
const factArb = fc.record({ kind: fc.constant('fact' as const), fact: fc.constantFrom('allergy' as const, 'patientMed' as const) });
const chooseArb = fc.record({ kind: fc.constant('choose' as const), decision: fc.constantFrom(...(Object.keys(CHOICE) as Array<keyof typeof CHOICE>)) });

/** Apply one edit through its mutation. False when it does not apply (no conflict to decide); skipped on both sides. */
async function applyEdit(runId: string, e: Edit): Promise<boolean> {
  switch (e.kind) {
    case 'answer':
      await resolutionMutations.answerPendingDecision(null, { sessionId: childOf(runId, GATE[e.gate]), nodeId: e.gate, answer: { booleanValue: e.value } }, ctx());
      return true;
    case 'override':
      await resolutionMutations.overrideNode(null, {
        sessionId: childOf(runId, TARGET[e.node]), nodeId: e.node, action: e.include ? OverrideAction.INCLUDE : OverrideAction.EXCLUDE,
      }, ctx());
      return true;
    case 'fact':
      // A fact given on ANY child is the run's (D5); give it on pw-b.
      await resolutionMutations.addPatientContext(null, { sessionId: childOf(runId, 'pw-b'), additionalContext: FACT[e.fact] as never }, ctx());
      return true;
    case 'choose':
      if (!harness.run(runId).mergedPlan.conflicts.some((c) => c.conflictId === 'anticoag')) return false;
      await multiPathwayResolutionMutations.resolveConflict(null, { sessionId: runId, conflictId: 'anticoag', choice: CHOICE[e.decision] } as never, ctx());
      return true;
  }
}

/** The final run inputs, built from the applied edits alone — not from anything a mutation stored. */
function finalInputs(start: RunInputs, applied: Edit[]): RunInputs {
  const inputs: RunInputs = {
    ...start,
    additionalContext: {},
    conflictResolutions: {},
    children: start.children.map((c) => ({ ...c, inputs: { ...c.inputs, gateAnswers: new Map(), providerOverrides: new Map() } })),
  };
  const child = (pathwayId: string) => inputs.children.find((c) => c.pathwayId === pathwayId)!.inputs;
  for (const e of applied) {
    if (e.kind === 'answer') child(GATE[e.gate]).gateAnswers.set(e.gate, { booleanValue: e.value });
    if (e.kind === 'override') {
      child(TARGET[e.node]).providerOverrides.set(e.node, {
        action: e.include ? OverrideAction.INCLUDE : OverrideAction.EXCLUDE,
        // Not part of any hash (spec §1 rule 8); any value will do.
        originalStatus: NodeStatus.UNKNOWN, originalConfidence: 0,
      });
    }
    if (e.kind === 'fact') inputs.additionalContext = mergeAdditionalContext(inputs.additionalContext, FACT[e.fact] as never);
    if (e.kind === 'choose') {
      // Who decided and when are not part of the run (spec §1 rule 8).
      inputs.conflictResolutions = { ...inputs.conflictResolutions, anticoag: { ...CHOICE[e.decision], resolvedBy: 'x', resolvedAt: 'y' } as never };
    }
  }
  return inputs;
}

const freshHash = async (inputs: RunInputs) => (await evaluateRun(harness.pool(), newRunRequest(), inputs)).result.resultHash;

beforeEach(() => {
  harness.reset();
  register();
});

describe('property (a) for runs: edits one at a time equal a fresh evaluation of the final inputs (spec §5.3)', () => {
  it('holds for any sequence of answers, overrides, facts and conflict decisions across children', async () => {
    await fc.assert(fc.asyncProperty(fc.array(fc.oneof(answerArb, overrideArb, factArb, chooseArb), { maxLength: 8 }), async (edits) => {
      harness.reset();
      register();
      const runId = await startRun();
      const start = runInputsOf(await loadRun(harness.pool(), runId));

      const applied: Edit[] = [];
      for (const e of edits) if (await applyEdit(runId, e)) applied.push(e);

      const stored = harness.run(runId).resultHash;
      expect(await freshHash(finalInputs(start, applied))).toBe(stored);
      expect(await freshHash(runInputsOf(await loadRun(harness.pool(), runId)))).toBe(stored);
    }), { numRuns: 30 });
  });

  it('positive control: the edits change the run, so the property is not vacuous', async () => {
    const runId = await startRun();
    const before = harness.run(runId).resultHash;
    await applyEdit(runId, { kind: 'answer', gate: 'qa', value: true });
    expect(harness.run(runId).resultHash).not.toBe(before);
    expect(harness.run(runId).mergedPlan.conflicts.map((c) => c.conflictId)).toEqual(['anticoag']);
    await applyEdit(runId, { kind: 'choose', decision: 'CONFIRM_B' });
    expect(medsOf(runId)).toEqual(['Aspirin']);
  });
});

describe('property (b) for runs: independent edits in any order give the same run (spec §5.3)', () => {
  const keyOf = (e: Edit) => (e.kind === 'answer' ? `a:${e.gate}` : e.kind === 'override' ? `o:${e.node}` : e.kind === 'fact' ? `f:${e.fact}` : 'c');
  const independent = fc.uniqueArray(fc.oneof(answerArb, overrideArb, factArb), { selector: keyOf, maxLength: 6 });
  const twoOrders = independent.chain((edits) =>
    fc.tuple(fc.constant(edits as Edit[]), fc.shuffledSubarray(edits as Edit[], { minLength: edits.length, maxLength: edits.length })));
  const overrideAmox: Edit = { kind: 'override', node: 'amox', include: true };
  const overrideMeto: Edit = { kind: 'override', node: 'meto', include: true };

  it('holds, including two overrides in one pathway recorded in either order (P4-4)', async () => {
    await fc.assert(fc.asyncProperty(twoOrders, async ([one, two]) => {
      harness.reset();
      register();
      const a = await startRun();
      for (const e of one) await applyEdit(a, e);
      const b = await startRun();
      for (const e of two) await applyEdit(b, e);
      expect(harness.run(b).resultHash).toBe(harness.run(a).resultHash);
    }), { numRuns: 25, examples: [[[[overrideAmox, overrideMeto], [overrideMeto, overrideAmox]]]] });
  });
});

describe('review reproductions, end to end (spec §5.2)', () => {
  it('#2 — generation refuses a pending child, and needs no re-merge once it is answered', async () => {
    const runId = await startRun(['pw-c']);
    const blocked = await multiPathwayResolutionMutations.generateMergedCarePlan(null, { sessionId: runId, reviewedResultHash: harness.run(runId).resultHash }, ctx());
    expect(blocked.blockers).toContainEqual(expect.objectContaining({ type: 'PENDING_GATE', pathwayId: 'pw-c' }));

    await applyEdit(runId, { kind: 'answer', gate: 'qc', value: true });
    expect(medsOf(runId)).toEqual(['Amoxicillin', 'Metoprolol']);
    const generated = await multiPathwayResolutionMutations.generateMergedCarePlan(null, { sessionId: runId, reviewedResultHash: harness.run(runId).resultHash }, ctx());
    expect(generated.success).toBe(true);
  });

  it('#5 — two pathways’ `med-1` are different drugs, and only the interacting one is withheld', async () => {
    harness.addPathway('pw-x', plain([med('med-1', 'Warfarin')]));
    harness.addPathway('pw-y', plain([med('med-1', 'Amoxicillin')]));
    harness.addPathway('pw-z', plain([med('med-2', 'Aspirin')]));
    const runId = await startRun(['pw-x', 'pw-y', 'pw-z']);
    expect(medsOf(runId)).toEqual(['Amoxicillin']);
  });

  it('#6 — choosing A, then B, leaves only B', async () => {
    const runId = await startRun();
    await applyEdit(runId, { kind: 'answer', gate: 'qa', value: true });
    await applyEdit(runId, { kind: 'choose', decision: 'CONFIRM_A' });
    await applyEdit(runId, { kind: 'choose', decision: 'CONFIRM_B' });
    expect(medsOf(runId)).toEqual(['Aspirin']);
  });

  it('#7 — accepting both conflict candidates checks them together; a write-in is checked too', async () => {
    const runId = await startRun();
    await applyEdit(runId, { kind: 'answer', gate: 'qa', value: true });
    await applyEdit(runId, { kind: 'choose', decision: 'ACCEPT_BOTH' });
    expect(medsOf(runId)).toEqual([]);
    expect(harness.run(runId).mergedPlan.suppressed.map((s) => s.name).sort()).toEqual(['Aspirin', 'Warfarin']);

    await applyEdit(runId, { kind: 'fact', fact: 'allergy' });
    await applyEdit(runId, { kind: 'choose', decision: 'WRITE_IN' });
    expect(harness.run(runId).mergedPlan.suppressed).toContainEqual(expect.objectContaining({ name: 'Amoxicillin', reason: 'allergy' }));
  });
});
```

- [ ] **Step 2: Run it**

Run: `npm test --prefix $W/apps/pathway-service -- --runInBand src/__tests__/pipeline-run-sequence-vs-fresh.test.ts`
Expected: PASS (7 tests).

**Falsify, one at a time, restoring each:**
1. In `childChange` (`run-commit.ts`), delete `inputs.additionalContext = change.inputs.additionalContext;`,
   so facts given on a child are dropped. Property (a) must fail on a `fact` edit.
2. In `compose.ts`, make `inNodeOrder` return `s` unchanged. Property (b) must fail on the pinned
   example (two overrides in `pw-c` recorded in opposite orders).
3. In `selectConflicts`' `CONFIRM_PATHWAY` case, push every candidate as `provider-confirmed`
   (drop the `if` and its `lose(…)` branch), so a choice no longer excludes the other candidate.
   The `#6` test must fail: both drugs reach the final set, where they interact and are both
   withheld, so the plan no longer holds only Aspirin.

- [ ] **Step 3: Commit**

```bash
git -C $W add apps/pathway-service/src/__tests__/pipeline-run-sequence-vs-fresh.test.ts
git -C $W commit -m "test(pathway-service): run properties (a) and (b) and the multi-pathway reproductions

Any sequence of answers, overrides, facts and conflict decisions across a
run's children equals evaluateRun of the final inputs; independent edits in
any order give the same run. Review #2, #5, #6 and #7 pass end to end
(spec §5.2, §5.3).

Claude-Session: https://claude.ai/code/session_01XRNkZvQrxmRLNtJHxq71kH"
```

---

### Task 9: Opt-in Postgres tests for runs (spec §5.6)

**Files:**
- Modify: `apps/pathway-service/src/__tests__/pipeline-postgres.test.ts`

Plan 03's suite, extended to migration 068, the run revision lock and concurrent merged
generation. It is still skipped unless `RUN_PIPELINE_PG_TESTS=1`, and it still refuses any
database whose name does not contain `scratch`.

- [ ] **Step 1: Extend the suite**

In `pipeline-postgres.test.ts`:

1. In the header comment, change "migration 067" / "the purge test inserts a pre-067 session
   before applying 067" to name both 067 and 068 ("…before applying 067 and 068").
2. Imports:
   - replace `import { createMultiPathwaySession } from '../services/resolution/multi-pathway-session-store';` with
     `import { insertRun, setContributingSessions, writeRunEvaluation } from '../services/resolution/multi-pathway-session-store';`
   - add `import { multiPathwayResolutionMutations } from '../resolvers/mutations/multi-pathway-resolution';`
   - add `import { evaluateRun, newRunRequest, sessionInputsOf } from '../services/resolution/pipeline/run';`
3. In the `ENV` fixture, give the medication a role, so a run's merged plan projects it:
   `node('med', 'Medication', { name: 'Amoxicillin', role: 'first_line' })`.
4. In `beforeAll`, directly after the line that applies `067_evaluation_inputs.sql`, add:

```ts
    await pool.query(readFileSync(join(__dirname, '../../../../shared/data-layer/migrations/068_run_inputs.sql'), 'utf-8'));
```

5. Directly after the `newSession` helper, add:

```ts
  /** A run with one child, stored exactly as a start stores one. */
  async function newRun(): Promise<{ runId: string; patientId: string; childId: string }> {
    const patientId = randomUUID();
    const base = makeInputs(ENV, { pathwayId: PATHWAY_ID });
    const ev = await evaluateRun(pool, newRunRequest(), {
      initialPatientContext: base.initialPatientContext, additionalContext: {}, temporalContext: base.temporalContext, conflictResolutions: {},
      children: [{
        sessionId: '', pathwayId: PATHWAY_ID,
        inputs: { pathwayId: PATHWAY_ID, graphFingerprint: '', gateAnswers: new Map(), providerOverrides: new Map(), observations: new Map(), revision: 0 },
      }],
    }, { pinGraphs: true });
    return inTransaction(pool, async (db) => {
      const runId = await insertRun(db, {
        patientId, providerId: randomUUID(), isPreview: true, initialPatientContext: base.initialPatientContext,
        temporalContext: base.temporalContext, additionalContext: {}, conflictResolutions: {}, result: ev.result,
      });
      const childId = await insertSession(db, {
        pathwayVersion: '1.0', patientId, providerId: randomUUID(),
        inputs: { ...sessionInputsOf(ev.inputs, ev.inputs.children[0].inputs), additionalContext: {} },
        result: ev.result.children[0].result, status: SessionStatus.ACTIVE, durationMs: 1, parentSessionId: runId,
      });
      await setContributingSessions(db, runId, [childId], [PATHWAY_ID]);
      return { runId, patientId, childId };
    });
  }
```

6. Replace the test `067 forbids patient facts on a child of a run` with:

```ts
  it('067 forbids patient facts on a child of a run', async () => {
    const { id } = await newSession();
    const { runId } = await newRun();
    await expect(pool.query(
      `UPDATE pathway_resolution_sessions SET parent_session_id = $1, additional_context = '{"allergies": []}' WHERE id = $2`,
      [runId, id],
    )).rejects.toThrow(/pathway_resolution_sessions_child_has_no_facts/);
  });
```

7. Append inside the `describePg` block:

```ts
  it('068 reshaped the run table', async () => {
    const { rows } = await pool.query(
      `SELECT column_name, is_nullable FROM information_schema.columns WHERE table_name = 'multi_pathway_resolution_sessions'`,
    );
    const cols = new Map(rows.map((r) => [r.column_name, r.is_nullable]));
    for (const c of ['revision', 'additional_context', 'env_fingerprint', 'result_hash', 'readiness', 'temporal_context']) {
      expect(cols.get(c)).toBe('NO');
    }
  });

  it('run revision lock: of two concurrent run writes at one revision, exactly one commits (D6)', async () => {
    const { runId } = await newRun();
    const row = (await pool.query(
      'SELECT merged_plan, readiness, result_hash, env_fingerprint FROM multi_pathway_resolution_sessions WHERE id = $1', [runId],
    )).rows[0];
    const result = {
      mergedPlan: row.merged_plan, safetyFindings: [], ddiWarnings: [], readiness: row.readiness,
      children: [], envFingerprint: row.env_fingerprint, resultHash: row.result_hash,
    };
    const write = () => inTransaction(pool, (db) => writeRunEvaluation(db, {
      runId, expectedRevision: 0, additionalContext: {}, conflictResolutions: {}, result: result as never, status: 'ACTIVE',
    }));

    const outcomes = await Promise.all([write(), write()]);

    expect(outcomes.sort()).toEqual([false, true]);
    expect((await pool.query('SELECT revision FROM multi_pathway_resolution_sessions WHERE id = $1', [runId])).rows[0].revision).toBe(1);
  });

  it('two concurrent merged generations yield exactly one care plan, both return it, and the child completes with it (#8)', async () => {
    const { runId, patientId, childId } = await newRun();
    const reviewed = (await pool.query('SELECT result_hash FROM multi_pathway_resolution_sessions WHERE id = $1', [runId])).rows[0].result_hash;
    const generate = () => multiPathwayResolutionMutations.generateMergedCarePlan(
      null, { sessionId: runId, reviewedResultHash: reviewed }, { pool, userId: randomUUID() } as never,
    );

    const [a, b] = await Promise.all([generate(), generate()]);

    expect(a.success && b.success).toBe(true);
    expect(a.carePlanId).toBe(b.carePlanId);
    expect((await pool.query('SELECT count(*)::int AS n FROM patient_care_plans WHERE patient_id = $1', [patientId])).rows[0].n).toBe(1);
    expect((await pool.query('SELECT status, care_plan_id FROM pathway_resolution_sessions WHERE id = $1', [childId])).rows[0])
      .toEqual({ status: 'COMPLETED', care_plan_id: a.carePlanId });
  });
```

- [ ] **Step 2: Confirm it is skipped by default**

Run: `npm test --prefix $W/apps/pathway-service -- --runInBand src/__tests__/pipeline-postgres.test.ts`
Expected: `Tests: 10 skipped`.

- [ ] **Step 3: Run it against a scratch database**

First confirm the live database has neither migration yet (read-only):

```bash
export PGPASSWORD=$(pm2 env 0 | sed 's/\x1b\[[0-9;]*m//g' | awk -F': ' '/^POSTGRES_PASSWORD/{print $2}')
psql -h localhost -U prism -d prism_db -tAc "SELECT migration_id FROM migration_history WHERE migration_id >= '067' ORDER BY 1"
```
Expected: no rows. If 067 or 068 is listed, the schema dump already has it and `beforeAll` would
fail applying it again. **Stop and report.**

Then follow the setup in the file header (dropdb / createdb / schema-only dump into
`prism_eval_scratch`) and run:

```bash
RUN_PIPELINE_PG_TESTS=1 PIPELINE_PG_DATABASE=prism_eval_scratch POSTGRES_PASSWORD=$PGPASSWORD \
  npm test --prefix $W/apps/pathway-service -- --runInBand src/__tests__/pipeline-postgres.test.ts
```
Expected: 10 passed. Then `dropdb -h localhost -U prism prism_eval_scratch`.
- If `createdb` is not permitted for `prism`, **stop and report**. Never run these tests against
  any other database.

**Falsify:** in a fresh scratch database, temporarily change `writeRunEvaluation`'s
`AND revision = $…` to `AND revision >= $…`. The parameter stays in use, so pg still binds it.
Run only the *run revision lock* test (`-t 'run revision lock'`); it must fail with
`[true, true]`. Restore the store, recreate the scratch database, run the full suite once more to
10 passed, then drop it.

- [ ] **Step 4: Commit**

```bash
git -C $W add apps/pathway-service/src/__tests__/pipeline-postgres.test.ts
git -C $W commit -m "test(pathway-service): opt-in Postgres tests for migration 068 and runs

Against a scratch database only: 068 reshapes the run table; concurrent
run writes at one revision commit once (D6); concurrent merged
generations produce one care plan and complete the child with it (#8).

Claude-Session: https://claude.ai/code/session_01XRNkZvQrxmRLNtJHxq71kH"
```

---

### Task 10: Admin dashboard

**Files** (all under `$AD/src`):
- Modify: `lib/graphql/mutations/resolution.ts`
- Modify: `lib/graphql/queries/resolution.ts`
- Modify: `types/index.ts`
- Modify: `app/encounter/page.tsx`
- Modify: `components/pathway-preview/PreviewResolutionPanel.tsx`
- Modify: `components/encounter-simulator/PendingGatesPanel.tsx`
- Modify: `components/encounter-simulator/ResolutionResults.tsx`
- Modify (comments): `components/pathway-preview/ConfigurePhase.tsx`, `app/pathways/[id]/preview/page.tsx`

The dashboard has no test suite. The checks are typecheck, lint and build (compared with Task 0's
baseline), plus a grep for the removed seams. The manual smoke test of spec §5.10 is plan 05's.

**Interfaces:**
- Consumes (GraphQL, Task 6):
  - `MultiPathwayResolutionSession.revision` / `resultHash` / `envFingerprint`;
  - `generateMergedCarePlan(sessionId, reviewedResultHash)`;
  - blockers with `scope` and `pathwayId`;
  - `SuppressedRecommendation.sourcePathwayId` / `suppressedByRecommendationName`.
- Removes: `RE_MERGE_MULTI_PATHWAY_SESSION`, every `reMerge` call, the `isReMerging` props, and
  the client-side optimistic-lock retries (the server retries, D9).

- [ ] **Step 1: GraphQL documents**

1. `lib/graphql/mutations/resolution.ts`:
   - In `SESSION_FIELDS`, replace `  status\n  isPreview\n` with
     `  status\n  revision\n  resultHash\n  envFingerprint\n  isPreview\n`.
   - In `MERGED_PLAN_FIELDS`' `suppressed { … }`, after `    suppressedByAllergyDisplay` add
     the lines `    suppressedByRecommendationName` and `    sourcePathwayId`.
   - Delete the `RE_MERGE_MULTI_PATHWAY_SESSION` export.
   - Replace `GENERATE_MERGED_CARE_PLAN` with:

```ts
export const GENERATE_MERGED_CARE_PLAN = gql`
  mutation GenerateMergedCarePlan($sessionId: ID!, $reviewedResultHash: String!) {
    generateMergedCarePlan(sessionId: $sessionId, reviewedResultHash: $reviewedResultHash) {
      success
      carePlanId
      warnings
      blockers {
        scope
        type
        description
        relatedNodeIds
        pathwayId
      }
    }
  }
`;
```

2. `lib/graphql/queries/resolution.ts`, in `GET_MULTI_PATHWAY_RESOLUTION_SESSION`:
   - after the `      status` line directly above `      isPreview`, add `      revision`,
     `      resultHash` and `      envFingerprint`;
   - in its `suppressed { … }`, after `          suppressedByAllergyDisplay` add
     `          suppressedByRecommendationName` and `          sourcePathwayId`.

- [ ] **Step 2: Types**

In `types/index.ts`:
1. In `interface MultiPathwayResolutionSession`, after `isPreview: boolean;`, add:

```ts
  /** Optimistic-lock counter for the whole run; increments on every committed write. */
  revision: number;
  /** Hash of exactly what a provider reviews; sent back as `reviewedResultHash` when committing (spec D7). */
  resultHash: string;
  /** Fingerprint of the configuration snapshot the run was evaluated under. */
  envFingerprint: string;
```

2. In `interface SuppressedRecommendation`, after `suppressedByAllergyDisplay: string | null;`, add:

```ts
  /** Set when an interaction with ANOTHER recommendation in the plan caused the suppression. */
  suppressedByRecommendationName: string | null;
  /** The pathway that proposed the recommendation; `provider-override` for a write-in. */
  sourcePathwayId: string | null;
```

- [ ] **Step 3: The encounter page**

In `app/encounter/page.tsx`:
1. Remove `RE_MERGE_MULTI_PATHWAY_SESSION,` from the mutations import.
2. In the `generateMergedCarePlanMutation` type arguments, change the blockers element type to
   `{ scope: string; type: string; description: string; relatedNodeIds: string[]; pathwayId: string | null }`
   and the variables type to `{ sessionId: string; reviewedResultHash: string }`.
3. Delete the `const [reMergeMutation, { loading: isReMerging }] = useMutation<…>(RE_MERGE_MULTI_PATHWAY_SESSION);`
   statement.
4. Replace

```ts
  const session =
    freshData?.startMultiPathwayResolution ??
    existingData?.multiPathwayResolutionSession ??
    null;
```

   with

```ts
  // The session query first: it is refetched after every answer and updated by
  // every mutation that returns the session, while a mutation's own `data` is
  // never updated from the cache. Preferring the start result kept showing the
  // start-time plan and resultHash, so every commit came back as
  // PLAN_CHANGED_SINCE_REVIEW (plan 04, P4-13).
  const session =
    existingData?.multiPathwayResolutionSession ??
    freshData?.startMultiPathwayResolution ??
    null;
```

5. In `handleCommitPlan`, replace the `generateMergedCarePlanMutation({ … })` call and the
   code after it, up to the closing of the `try`, with:

```ts
      const { data } = await generateMergedCarePlanMutation({
        // The plan the provider is looking at (spec D7).
        variables: { sessionId: session.id, reviewedResultHash: session.resultHash },
      });
      const result = data?.generateMergedCarePlan;
      if (!result) {
        setError('No response from commit mutation');
        return;
      }
      // Whatever the outcome, the server stored the run it just evaluated.
      // After PLAN_CHANGED_SINCE_REVIEW, that is the plan to review next.
      await refetchSession();
      setCommitResult({
        success: result.success,
        carePlanId: result.carePlanId,
        blockers: result.blockers.map((b) => `${b.type}: ${b.description}`),
      });
```

6. Replace the `onGateAnswered={async () => { … }}` prop (the block that calls `reMergeMutation`)
   with:

```tsx
              onGateAnswered={async () => {
                // The answer re-evaluated the whole run on the server; show it.
                await refetchSession();
              }}
```

   and delete the `isReMerging={isReMerging}` prop below it.

- [ ] **Step 4: The preview panel**

In `components/pathway-preview/PreviewResolutionPanel.tsx`:
1. Imports:
   - change `import { useMutation } from '@apollo/client/react';` to
     `import { useApolloClient, useMutation } from '@apollo/client/react';`;
   - remove `RE_MERGE_MULTI_PATHWAY_SESSION,` from the mutations import;
   - add `import { GET_MULTI_PATHWAY_RESOLUTION_SESSION } from '@/lib/graphql/queries/resolution';`.
2. Replace everything from `  const [answerGate] = useMutation(ANSWER_PENDING_DECISION);` up to,
   but not including, `  const pendingForThisPathway: PendingGate[] = useMemo(() => {`, with:

```tsx
  const [answerGate] = useMutation(ANSWER_PENDING_DECISION);

  // Every answer re-evaluates the whole run on the server, so there is nothing
  // to re-merge: read the run back as the server now holds it.
  const client = useApolloClient();
  const fetchRun = useCallback(
    async (id: string) => {
      const { data } = await client.query<{ multiPathwayResolutionSession: MultiPathwayResolutionSession | null }>({
        query: GET_MULTI_PATHWAY_RESOLUTION_SESSION,
        variables: { sessionId: id },
        fetchPolicy: 'network-only',
      });
      return data?.multiPathwayResolutionSession ?? null;
    },
    [client],
  );

  const [deletePreview] = useMutation<
    { deletePreviewSession: DeletePreviewSessionResult },
    { sessionId: string }
  >(DELETE_PREVIEW_SESSION);

  // Best-effort delete — swallows errors so a stale row can't block the
  // user's next click. Server-side returns FORBIDDEN for non-preview
  // rows (won't happen — we only ever start with syntheticPatient: true)
  // and NOT_FOUND if already gone.
  const deleteIfAny = useCallback(
    async (idToDelete: string | null) => {
      if (!idToDelete) return;
      try {
        await deletePreview({ variables: { sessionId: idToDelete } });
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn('[PreviewResolutionPanel] delete failed:', err);
      }
    },
    [deletePreview],
  );

  // Unmount cleanup — if the user leaves the preview page with a live
  // preview session, hard-delete it so the sessions table doesn't grow.
  useEffect(() => {
    return () => {
      const id = sessionIdRef.current;
      if (id) void deleteIfAny(id);
    };
  }, [deleteIfAny]);

  const runResolution = useCallback(
    async (context: PatientContextInput) => {
      setError(null);
      setContextCache(context);
      setStagedObservations([]);
      setAppliedAnswers(0);

      // Reap the previous preview session before starting a new one so
      // preview rows don't accumulate on every re-run.
      const priorId = sessionIdRef.current;
      if (priorId) {
        await deleteIfAny(priorId);
        updateSession(null);
      }

      try {
        const { data } = await startResolution({
          variables: {
            patientId: context.patientId,
            patientContext: context,
            includeDraftPathways: true,
            syntheticPatient: true,
          },
        });
        const fresh = data?.startMultiPathwayResolution ?? null;
        // Deliberately DO NOT publish `fresh` to component state yet —
        // publishing here would let the PendingGatesPanel render with the
        // pre-answer-target gate still marked pending, and a provider click
        // during the loop below would answer the same gate a second time.
        // We publish after the loop, so the panel only ever renders the
        // post-pre-answer state.
        if (!fresh) {
          updateSession(null);
          return;
        }

        // Apply each composer pre-answer by matching its gateId against
        // the pending questions returned by the server. Anything not
        // pending is just unused — the gate didn't fire for this patient.
        const pending = (fresh.pendingGateQuestions ?? []) as PendingGate[];
        const pendingById = new Map(pending.map((g) => [g.gateId, g]));
        let applied = 0;
        for (const [gateId, ans] of Object.entries(questionAnswers ?? {})) {
          const match = pendingById.get(gateId);
          if (!match) continue;
          const answerInput: Record<string, unknown> = {};
          if (ans.booleanValue !== undefined) answerInput.booleanValue = ans.booleanValue;
          if (ans.numericValue !== undefined) answerInput.numericValue = ans.numericValue;
          if (ans.selectedOption) answerInput.selectedOption = ans.selectedOption;
          if (Object.keys(answerInput).length === 0) continue;
          try {
            // answerPendingDecision is a per-pathway mutation — the sessionId
            // it wants is the per-pathway session that surfaced the gate,
            // not the multi-pathway parent (`fresh.id`). Each PendingGate
            // returned by the resolver carries the correct one. The server
            // retries its own revision conflicts, so there is no retry here.
            //
            // Apollo is set to `errorPolicy: 'all'` for mutations, so GraphQL
            // errors come back on `result.error` instead of throwing.
            const result = await answerGate({
              variables: { sessionId: match.sessionId, nodeId: gateId, answer: answerInput },
            });
            const e = result.error as { message?: string; errors?: Array<{ message?: string }> } | undefined;
            if (e) {
              const inner = (e.errors ?? []).map((x) => x?.message).filter(Boolean);
              throw new Error(inner.length > 0 ? inner.join('; ') : e.message ?? 'GraphQL error');
            }
            applied += 1;
          } catch (innerErr) {
            console.error('answerPendingDecision failed for', gateId, innerErr);
          }
        }
        setAppliedAnswers(applied);

        // Now (and only now) publish session state — after the pre-answer
        // loop has fully drained. If we applied any answers, read the run
        // back; otherwise the freshly-started session is already current.
        updateSession(applied > 0 ? (await fetchRun(fresh.id)) ?? fresh : fresh);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Resolution failed');
      }
    },
    [startResolution, answerGate, fetchRun, questionAnswers, deleteIfAny, updateSession],
  );

  const handleRerunWithObservations = useCallback(async () => {
    if (!contextCache || stagedObservations.length === 0) return;
    const priorNarrative =
      (contextCache.freeformData as { narrative?: Record<string, unknown> } | undefined)
        ?.narrative ?? {};
    const priorObservations = Array.isArray(
      (priorNarrative as Record<string, unknown>).provider_observations,
    )
      ? ((priorNarrative as Record<string, unknown>).provider_observations as string[])
      : [];
    const mergedNarrative = {
      ...priorNarrative,
      provider_observations: [...priorObservations, ...stagedObservations],
    };
    const mergedFreeform = {
      ...(contextCache.freeformData as Record<string, unknown> | undefined),
      narrative: mergedNarrative,
    };
    const newPatientId =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `00000000-0000-4000-8000-${Date.now().toString().padStart(12, '0').slice(-12)}`;
    await runResolution({
      ...contextCache,
      patientId: newPatientId,
      freeformData: mergedFreeform,
    });
  }, [contextCache, stagedObservations, runResolution]);

  const onGateAnswered = useCallback(async () => {
    if (!session) return;
    try {
      const next = await fetchRun(session.id);
      if (next) updateSession(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Refresh failed');
    }
  }, [session, fetchRun, updateSession]);
```

3. In the JSX:
   - change `disabled={starting || merging}` to `disabled={starting}`;
   - change `` className={`h-3.5 w-3.5 ${starting || merging ? 'animate-spin' : ''}`} `` to
     `` className={`h-3.5 w-3.5 ${starting ? 'animate-spin' : ''}`} ``;
   - delete `isReMerging={merging}` from `<PendingGatesPanel …/>`.
4. In the file header comment, change `Composer pre-answers applied via answerPendingDecision + reMerge so`
   to `Composer pre-answers applied via answerPendingDecision (each re-evaluates the whole run) so`.
   In the `onSessionChange` doc, change `after re-merges from gate answers` to `after gate answers`.

- [ ] **Step 5: Pending gates, results, comments**

1. `components/encounter-simulator/PendingGatesPanel.tsx`:
   - In `PendingGatesPanelProps`, replace the `onAnswered` doc with
     `/** Called after an answer is stored. The server re-evaluates the whole run on every answer; refetch it. */`,
     and delete `isReMerging?: boolean;` with its doc line.
   - Change `export function PendingGatesPanel({ gates, onAnswered, isReMerging }: PendingGatesPanelProps)`
     to `export function PendingGatesPanel({ gates, onAnswered }: PendingGatesPanelProps)`, and delete
     both `disabled={isReMerging}` lines. `GateAnswerCard`'s own optional `disabled` prop stays.
   - Delete `messageMatches`, `mutationHitOptimisticLock` and the comment above them
     (`// Optimistic-lock conflict detector …`). Keep `collectResultErrorMessage`.
   - In `submit()`, replace the comment block starting `// Retry once on optimistic-lock conflicts.`
     and the three statements after it (`let result = …`, the `if (mutationHitOptimisticLock(result))`
     block) with:

```ts
      // The server retries its own revision conflicts (spec D9); there is no
      // client retry. Mutations use `errorPolicy: 'all'`, so GraphQL errors
      // arrive on the result's `error` rather than as a throw.
      const result = await answerGate({ variables });
```

2. `components/encounter-simulator/ResolutionResults.tsx`:
   - Delete `isReMerging?: boolean;` from `ResolutionResultsProps`, `isReMerging,` from the
     component's destructuring, and `isReMerging={isReMerging}` from `<PendingGatesPanel …/>`.
   - Change `<SuppressionsPanel suppressed={session.mergedPlan.suppressed} />` to
     `<SuppressionsPanel suppressed={session.mergedPlan.suppressed} pathways={session.contributingPathways} />`.
   - Replace the `SuppressionsPanel` function with:

```tsx
function SuppressionsPanel({ suppressed, pathways }: { suppressed: SuppressedRecommendation[]; pathways: Pathway[] }) {
  if (suppressed.length === 0) return null;
  const lookup = pathwayLookup(pathways);
  // Both halves of the story (spec §5.10): which pathway proposed it, and why safety withheld it.
  const proposedBy = (id: string) =>
    id === 'provider-override' ? 'a provider write-in' : lookup.get(id)?.title ?? id;
  return (
    <div className="bg-red-50 rounded-xl border border-red-200 p-4">
      <div className="flex items-center gap-2 mb-3">
        <ShieldExclamationIcon className="h-4 w-4 text-red-600" />
        <h3 className="text-sm font-semibold text-red-900">
          Suppressed ({suppressed.length})
        </h3>
      </div>
      <div className="space-y-1.5">
        {suppressed.map((s, idx) => (
          <div
            key={`${s.type}-${s.name}-${idx}`}
            className="p-2 rounded bg-white border border-red-200 flex items-baseline justify-between gap-2"
          >
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium text-gray-900 truncate">{s.name}</div>
              <div className="text-[11px] text-gray-500">
                {s.reason === 'CONTRAINDICATED' || s.reason === 'AVOID'
                  ? `by ${s.suppressedByPathwayTitle ?? 'pathway'}`
                  : s.reason === 'DDI_CONTRAINDICATED' || s.reason === 'DDI_SEVERE'
                    ? `interacts with ${s.suppressedByRecommendationName ?? s.suppressedByPatientMedName ?? 'another medication'}`
                    : s.reason === 'ALLERGY'
                      ? `allergy: ${s.suppressedByAllergyDisplay ?? s.suppressedByAllergyCode}`
                      : s.reason}
              </div>
              {s.sourcePathwayId && (
                <div className="text-[11px] text-gray-400">proposed by {proposedBy(s.sourcePathwayId)}</div>
              )}
            </div>
            <span className="text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded bg-red-200 text-red-900">
              {s.reason.replace('_', ' ')}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
```

3. Comments that name the removed mutation:
   - `components/pathway-preview/ConfigurePhase.tsx`: `(via answerPendingDecision + reMergeMultiPathwaySession)`
     becomes `(via answerPendingDecision, which re-evaluates the whole run)`;
   - `app/pathways/[id]/preview/page.tsx`: `PreviewResolutionPanel via answerPendingDecision + reMergeMultiPathwaySession.`
     becomes `PreviewResolutionPanel via answerPendingDecision.`

- [ ] **Step 6: Verify**

```bash
grep -rnE "reMerge|RE_MERGE|isReMerging|optimistic lock|mutationHitOptimisticLock" $AD/src
$AD/node_modules/.bin/tsc -p $AD/tsconfig.json --noEmit
npm run lint --prefix $AD
npm run build --prefix $AD
```
Expected:
- The grep prints nothing.
- Typecheck and lint show nothing beyond Task 0's baseline.
- The build succeeds, as it does on `master` (Task 0).

**Falsify:** delete `resultHash` from the `MultiPathwayResolutionSession` type. The typecheck
must fail at `session.resultHash` in `handleCommitPlan`. Restore it. (Whether the hash sent is
the *current* one is behaviour a type check cannot see; plan 05's manual smoke test covers
"commit after an answer succeeds".)

- [ ] **Step 7: Commit (admin repo)**

```bash
git -C $AD add -A src
git -C $AD status --short   # expect only this task's files
git -C $AD commit -m "feat: evaluation pipeline runs in the encounter simulator and preview

Generation sends the reviewed resultHash and refreshes on
PLAN_CHANGED_SINCE_REVIEW (D7); gate answers refetch the run instead of
re-merging (reMergeMultiPathwaySession is gone); the client-side
optimistic-lock retries go (the server retries, D9). Suppressions show
the proposing pathway and the interacting recommendation. The encounter
page prefers the refetched session over the start result.

Claude-Session: https://claude.ai/code/session_01XRNkZvQrxmRLNtJHxq71kH"
```

---

### Task 11: Full suite, push, PRs

- [ ] **Step 1: Full suite, typecheck, builds**

```bash
npm test --prefix $W/apps/pathway-service -- --runInBand 2>&1 | grep -E "^(FAIL|Tests:|Test Suites:)" | sort | uniq -c
$W/node_modules/.bin/tsc -p $W/apps/pathway-service/tsconfig.json --noEmit
npm run build --prefix $W/apps/pathway-service
$AD/node_modules/.bin/tsc -p $AD/tsconfig.json --noEmit
npm run lint --prefix $AD
npm run build --prefix $AD
```
Expected:
- pathway-service: the only `FAIL` lines are `patient-match-scorer` and `data-completeness-scorer`,
  with `9 failed`. Skipped is Task 0's count plus 3 (Task 9's new Postgres tests).
- Typecheck clean; both builds succeed; admin lint shows nothing beyond Task 0's baseline.

Record the *Baseline* row. Passed changes by *Appendix B*'s `Added − Retired`; account for any
difference.

- [ ] **Step 2: Check Appendix B against the tree**

```bash
for f in multi-pathway-resolution ddi-multi-pathway pipeline-multi-children patient-attributes-mapping ddi-pass-single-pathway; do
  test -e $W/apps/pathway-service/src/__tests__/$f.test.ts && echo "STILL PRESENT: $f"
done
test -e $W/apps/pathway-service/src/services/medications/ddi-pass-single-pathway.ts && echo "STILL PRESENT: ddi-pass-single-pathway.ts"
grep -rnE "reMergeMultiPathwaySession|buildResolvedPlansFromSessions|runMergePipeline|applyResolution\b|createMultiPathwaySession|markMultiPathwaySessionStatus|updateMergedPlanAndResolutions" $W/apps/pathway-service/src $W/apps/pathway-service/schema.graphql --include=*.ts --include=*.graphql | grep -v __generated__ | grep -vE "^\S+:(\s*\*|\s*//)"
echo checked
```
Expected: only `checked`. `resolution-fact-store-wiring`'s stale `jest.mock` keys are the known
exception (P4-9, Task 7). If the grep lists them, confirm they are inside a `jest.mock` factory.

- [ ] **Step 3: Push and open both PRs**

```bash
git -C $W push -u origin HEAD:refs/heads/feat/evaluation-pipeline-04-multi-pathway
gh pr create -R Prism-Clinical/prism-graphql --base feat/evaluation-pipeline --head feat/evaluation-pipeline-04-multi-pathway \
  --title "Evaluation pipeline 04: multi-pathway composition" --body-file <(printf '%s\n' \
  "Plan: docs/superpowers/plans/2026-09-19-evaluation-pipeline-04-multi-pathway-composition.md (branch docs/evaluation-pipeline-design)." \
  "" "Migration 068; loadRunEnv (one snapshot per run); composeRun; evaluateRun and commitRun under the parent's revision; children answered through the run; resolveConflict and generateMergedCarePlan (reviewedResultHash) on the pipeline; reMergeMultiPathwaySession removed; dead DDI orchestration deleted; A3, A4, review #2 #5 #6 #7; run properties (a) and (b); run Postgres tests." \
  "" "Merge together with the admin dashboard PR into its feat/evaluation-pipeline.")

git -C $AD push -u origin HEAD:refs/heads/feat/evaluation-pipeline-04-multi-pathway
gh pr create -R Prism-Clinical/prism-admin-dashboard --base feat/evaluation-pipeline --head feat/evaluation-pipeline-04-multi-pathway \
  --title "Evaluation pipeline 04: runs in the simulator and preview" --body-file <(printf '%s\n' \
  "Plan: prism-graphql docs/superpowers/plans/2026-09-19-evaluation-pipeline-04-multi-pathway-composition.md, Task 10." \
  "" "Generation sends reviewedResultHash and refreshes on PLAN_CHANGED_SINCE_REVIEW; answers refetch the run (no re-merge); client optimistic-lock retries removed; suppressions show the proposing pathway and the interacting recommendation." \
  "" "Pairs with Prism-Clinical/prism-graphql feat/evaluation-pipeline-04-multi-pathway.")
```
**Both bases are `feat/evaluation-pipeline`**, the admin one being the branch Task 0 created. They
are not `main` / `master`. If `gh` is not authenticated, report the compare URLs instead:
- `https://github.com/Prism-Clinical/prism-graphql/compare/feat/evaluation-pipeline...feat/evaluation-pipeline-04-multi-pathway`
- `https://github.com/Prism-Clinical/prism-admin-dashboard/compare/feat/evaluation-pipeline...feat/evaluation-pipeline-04-multi-pathway`

- [ ] **Step 4: Report and stop**

Report:
- the *Baseline* table;
- each falsification outcome;
- the Task 9 run (or why it could not run);
- anything properties (a) and (b) found;
- admin lint/typecheck/build against Task 0.

**Do not start plan 05**: it is written after this plan merges.

---

## Out of scope for this plan (by design)

- **F1, beyond `composeRun`:** a pathway-qualified identity for conflict candidates,
  `evidenceGateIds` and the materializer. P4-3 qualifies only the identity inside `composeRun`.
- **#9 reconverging branches, #10 the vital answer round trip, #11 exhaustive persistence:** spec,
  *Out of scope*. #9 and #10 stay pinned in `pipeline-sequence-vs-fresh.test.ts`.
- **F5 fingerprint-based child reuse:** every mutation on a run re-evaluates every child (D13).
- **`declareRequiredInputs` on the scorers:** P4-10.
- **Rewriting plan 01's benchmark onto `evaluateRun`, the normalisation backfill on live, the
  before/after record and the manual admin smoke test:** plan 05.

---

## Appendix B — Retired-test mapping (spec §5.5)

Every test this plan deletes, removes or rewrites in place is listed with its **replacement** or
a **written reason**. Abbreviations:

| Code | Test |
|---|---|
| **MUT:** | `pipeline-run-mutations.test.ts` |
| **GEN:** | `pipeline-run-generation.test.ts` |
| **CMP:** | `pipeline-compose.test.ts` |
| **RC:** | `pipeline-run-commit.test.ts` |
| **SEQ:** | `pipeline-run-sequence-vs-fresh.test.ts` |
| **DR:** | `pipeline-disposition-reason.test.ts` |
| **PS** | `pipeline-safety.test.ts` (plan 02) |
| **A2** | `pipeline-acceptance-a2.test.ts` (plan 02) |

**Totals (from the files as they are at `c509273`):**
- **Retired:** 42 tests: 22 + 4 + 1 + 1 deleted in Task 6, 4 moved out of
  `preview-session-isolation`, 1 moved out of `resolution-fact-store-wiring`, and 9 deleted in
  Task 7.
- **Added:** 94 passing tests (T1 8, T2 8, T3 5, T4 22, T5 8, T6 33, T7 3, T8 7), plus 3 skipped
  (T9). Expected end: **1618 − 42 + 94 = 1670 passed**, 9 failed, 12 skipped.
- **Rewritten in place, same count:** 4 (`multi-pathway-session-store-preview` ×2,
  `session-temporal-context` ×2).

### Deleted in Task 6

| File › test | Disposition |
|---|---|
| multi-pathway-resolution › persists an empty session when no pathways match | MUT: *a zero-match run is stored with EMPTY_PLAN at its root…* |
| multi-pathway-resolution › persists per-pathway sessions and a merged session when pathways match | MUT: *creates the parent and one child per matched pathway…* |
| multi-pathway-resolution › stamps one clock instance across the parent, every child, and every evaluation | MUT: *creates the parent…* (every child's `temporalContext` equals the run's). Identity is by construction now: `sessionInputsOf` splices the parent's one clock into every child evaluation |
| multi-pathway-resolution › stamps a clock on the zero-match parent session too | MUT: *a zero-match run is stored…* (`temporalContext.temporalPolicyVersion`) |
| multi-pathway-resolution › skips a pathway whose graph is empty | MUT: *a pathway whose graph is empty contributes no child* |
| multi-pathway-resolution › CONFIRM_PATHWAY adds the chosen drug as PROVIDER_CONFIRMED and marks the conflict | CMP: *choosing B withholds A…* (`state: provider-confirmed`) + MUT: *a changed choice replaces…* (stored decision) |
| multi-pathway-resolution › rejects CONFIRM_PATHWAY when chosenPathwayId is not a candidate | MUT: *refuses a conflict the run does not have, and a pathway that is not a candidate* |
| multi-pathway-resolution › ACCEPT_BOTH adds both candidates as auto-included recommendations | CMP: *A, then B, then both, then neither…* |
| multi-pathway-resolution › REJECT_BOTH leaves medications empty, marks conflict resolved | CMP: same |
| multi-pathway-resolution › CUSTOM_OVERRIDE attaches a write-in medication and marks state PROVIDER_OVERRIDE | CMP: *a write-in that cannot be normalised stays in the plan…* (`state: provider-override`) + the two write-in safety tests |
| multi-pathway-resolution › rejects when conflictId does not exist in the session | MUT: *refuses a conflict the run does not have…* |
| multi-pathway-resolution › rejects when session is not ACTIVE | RC: *refuses a run that is not ACTIVE, before evaluating* |
| multi-pathway-resolution › generateMergedCarePlan blocks when there are unresolved conflicts | GEN: *an unresolved conflict blocks generation at the root* |
| multi-pathway-resolution › generateMergedCarePlan blocks when the merged plan has no recommendations | CMP: *an empty run is not ready…* + A3 control |
| multi-pathway-resolution › abandonMultiPathwaySession marks the session ABANDONED | MUT: *abandons the run and every child, without evaluating* |
| multi-pathway-resolution › applyResolution idempotent shape — only the targeted conflict is mutated | CMP: *the same decision twice gives the same run* + *a decision for a conflict that no longer exists is inert*. `applyResolution` is deleted; decisions are re-applied to the base merge every time |
| multi-pathway-resolution › applyResolution CONFIRM_PATHWAY surfaces only the chosen candidate | CMP: *A, then B, then both, then neither…* |
| multi-pathway-resolution › formatMergedForGraphQL formats a conflict with no resolution as resolution=null | MUT: same test, moved |
| multi-pathway-resolution › formatMergedForGraphQL maps state strings to GraphQL enum names | MUT: same test, moved |
| multi-pathway-resolution › writes nothing when a LATER pathway fails evaluation | MUT: *a pathway that fails evaluation writes nothing…* |
| multi-pathway-resolution › rejects an unknown version before creating a zero-match parent session | MUT: *refuses an unknown policy version… (matches: [])* |
| multi-pathway-resolution › rejects an unknown version when every matched pathway has an empty graph | MUT: same (`matches: ["pw-empty"]`) |
| ddi-multi-pathway › drops a medication suppressed by patient med and adds it to merged.suppressed | CMP: *a patient-allergy suppression of A persists…* (suppressed entry) + SEQ property (a) (`patientMed` edits: a patient warfarin against Aspirin) |
| ddi-multi-pathway › accumulates MODERATE pre-merge findings as ddiWarnings on the session | GEN: *returns a moderate interaction across pathways as a text warning*. `composeRun` gathers every WARN finding, the contributions' and the root's, into `ddiWarnings` |
| ddi-multi-pathway › preserves allergy-source SuppressionSource on suppression entry | CMP: *a patient-allergy suppression…* + MUT: *a run exposes … a suppression its source pathway* (`reason: ALLERGY`) |
| ddi-multi-pathway › drops cross-recommendation suppressed meds and adds OTHER_RECOMMENDATION suppression | CMP: *accepting both surfaces the pair…* + review #5 + SEQ #7 |
| pipeline-multi-children › a child session created by a run is stored with inputs and is answerable through answerPendingDecision | MUT: *answering a child’s gate re-evaluates the whole run* |
| patient-attributes-mapping › buildPatientContext normalizes and attaches patientAttributes | Dropped: `buildPatientContext` is deleted (dead since plan 03). The live mapping is `toPatientContext` → `normalizePatientAttributes`, covered by `patient-attributes.test.ts` |

### Moved out of files that stay (Task 6)

| File › test | Disposition |
|---|---|
| preview-session-isolation › persists isPreview=true when syntheticPatient is true | MUT: *stores isPreview from syntheticPatient…* |
| preview-session-isolation › persists isPreview=false when syntheticPatient is omitted | MUT: same (explicit `false`). The rule is `args.syntheticPatient === true`, unchanged, so omitted and `false` take one branch |
| preview-session-isolation › persists isPreview=false when syntheticPatient=false is explicit | MUT: same |
| preview-session-isolation › surfaces isPreview on the formatted session so the FE can read it | MUT: same (the formatted result's `isPreview`) |
| resolution-fact-store-wiring › stamps the INJECTED version on the zero-match path | MUT: *a zero-match run is stored … stamped with the injected policy version* |

### Deleted in Task 7

| File › test | Disposition |
|---|---|
| ddi-pass-single-pathway › does nothing when state has no Medication nodes | Dropped as a mechanism: patient safety is stage 5 of every evaluation. PS covers an empty candidate set |
| ddi-pass-single-pathway › skips Medication nodes that are not INCLUDED | `medicationCandidates` takes INCLUDED nodes only; PS / A2 |
| ddi-pass-single-pathway › skips drugs that fail to normalize (admin queue handles them) | Replaced by the opposite rule (D14): an unnormalised drug is reported and blocks. PS `SAFETY_DATA_UNAVAILABLE` tests + CMP *a write-in that cannot be normalised…* |
| ddi-pass-single-pathway › SEVERE drug↔drug → suppress + EXCLUDED + DDI excludeReason | A2 (suppressed with both reasons) + CMP review #5 |
| ddi-pass-single-pathway › MODERATE drug↔drug → warning, NOT a suppression | GEN: *returns a moderate interaction … as a text warning* (success, nothing suppressed) |
| ddi-pass-single-pathway › MINOR severity is dropped (not surfaced) | `buildDrugDrugFinding` / `severityToAction` are kept unchanged (Task 7); PS |
| ddi-pass-single-pathway › allergy match → suppress + ALLERGY excludeReason | A2 + CMP *a patient-allergy suppression…* |
| ddi-pass-single-pathway › allergy takes precedence over drug-drug findings in excludeReason ranking | DR: *names an allergy before a drug-drug interaction, whatever order…* |
| ddi-pass-single-pathway › processes multiple Medication nodes independently | CMP review #5 (three medications across children, one untouched) |

### Rewritten in place (same test, new seam)

- `multi-pathway-session-store-preview` › the two `createMultiPathwaySession: is_preview` tests
  become `insertRun: is_preview` tests (Task 6).
- `session-temporal-context` › `createMultiPathwaySession writes the temporal context as JSON`
  and `… refuses to persist a session with no clock` become their `insertRun` equivalents (Task 6).

### Kept, deliberately untouched

- `preview-session-isolation` › the three `deletePreviewSession` tests.
- `contributing-pathways-resolver`: the type resolver is unchanged.
- `care-plan-merge`: `mergeResolvedCarePlans` is unchanged; `composeRun` calls it.
- `baseline-capture` and `evaluation-benchmark` (both skipped): plan 05 rewrites them onto the
  pipeline (P4-9). Task 7 ports the benchmark just enough to load.
