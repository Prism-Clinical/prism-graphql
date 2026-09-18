# Evaluation Pipeline 03 — Single-Pathway Wiring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every single-pathway session stores only its inputs, and every mutation re-evaluates
them from scratch through plan 02's `evaluate()` and one write path, `commitEvaluation`. The
incremental engine is deleted.

**Architecture:**
- **Migration 067** reshapes `pathway_resolution_sessions`: the new input and cache columns go
  in, and `dependency_map` comes out.
- **The session store** gains `insertSession`, `writeEvaluation` (a compare-and-set on
  `revision`) and `rowToSession`, and loses `createSession`, `updateSession` and the
  dependency-map serialisers.
- **`pipeline/request.ts`** owns one evaluation attempt: snapshot, LLM audit capture,
  observation reuse and non-blocking pre-warm.
- **`pipeline/commit.ts`** owns the retry loop.
- **The resolvers** become thin: validate at the boundary, change the inputs, commit.
- **Multi-pathway child sessions** are created through the same pipeline, so a child is
  answerable by the new single-pathway mutations. Run composition stays plan 04's job.

**Tech Stack:** TypeScript, Jest + ts-jest (`diagnostics: false`), `pg`, fast-check 3, Apollo
SDL + graphql-codegen.

**Spec:** `docs/superpowers/specs/2026-09-13-evaluation-pipeline-design.md`. The sections this
plan implements are:
- §1 rules 2, 3, 5, 6 and 8;
- §4 (`commitEvaluation`, lifecycle-only operations, generation, migration, API);
- D7, D8, D9 and D14 (pre-warm wiring and backfill);
- §5.2 (single-pathway reproductions);
- §5.3 property (a);
- §5.5 (the retired-test mapping);
- §5.6 (opt-in Postgres tests).

**Overview:** `docs/superpowers/plans/2026-09-14-evaluation-pipeline-00-overview.md`.
**Predecessor:** plan 02, merged into `feat/evaluation-pipeline` @ `7be4e13` (PR #57), review
fixes included.

## Global Constraints

- **No users; no compatibility seams.** Existing sessions are purged. The admin dashboard
  breaks on the integration branch until plan 04 updates it: generation now requires
  `reviewedResultHash`, and `answerGateQuestion` is removed. The integration branch exists for
  exactly this; it merges to `main` once, in plan 05.
- **Suite invariant:** `patient-match-scorer` and `data-completeness-scorer` (9 tests) remain
  the only failures. The pass count changes, because this plan retires tests. Every retired
  test has a row in *Appendix A*.
- **Test files are not typechecked**, so every invariant needs a runtime throw plus a test that
  fails without it. **Assert the positive, then revert the fix and watch the test fail.**
- **One construction site.** After this plan, the only `new TraversalEngine(...)` in
  production code is in `pipeline/evaluate.ts`. Task 8 checks this with a grep.
- **No first-seen choice over `resolutionState` order.** Overrides are pre-seeded, so state
  order follows input order. Plan 02's review found three defects of this class. Any new code
  that picks "the first" of something must first sort by a stable key. This includes the
  status-change diff and the property generators.
- **Commands** use absolute paths, never `cd … && …`. `W` below is
  `/home/claude/workspace/features/feat-evaluation-pipeline-03-single-pathway/prism-graphql`.
  - Test one file: `npm test --prefix $W/apps/pathway-service -- --runInBand src/__tests__/<file>`
  - Typecheck: `$W/node_modules/.bin/tsc -p $W/apps/pathway-service/tsconfig.json --noEmit`
  - Codegen: `npm run codegen --prefix $W/apps/pathway-service`
- **Commit messages** use conventional prefixes and end with exactly one trailer line:
  `Claude-Session: https://claude.ai/code/session_01XRNkZvQrxmRLNtJHxq71kH`.
  No `@anthropic.com` address and no `Co-Authored-By` line (`CLAUDE.md`).
- **Evaluation never calls RxNav** (D14). The pre-warm runs after the snapshot and is never
  awaited by a mutation.
- **Live database:** untouched by this plan. Task 11's Postgres tests run only against a
  scratch database, and they refuse to run against `prism_db`.

## Decisions and deviations (review these first)

| # | Decision | Why |
|---|---|---|
| P3-1 | **Migration 067 changes only `pathway_resolution_sessions`** (and the events CHECK). The `multi_pathway_resolution_sessions` columns in spec §4 step 3 (`revision`, `additional_context`, `env_fingerprint`, `result_hash`, `readiness`) move to plan 04's migration 068. | Those columns are NOT NULL, and the multi-pathway INSERT does not write them until plan 04. Adding them here would break `startMultiPathwayResolution` on the integration branch for no gain. `parent_session_id` *is* added here: it is nullable and harmless. |
| P3-2 | **Multi-pathway child sessions are created through `evaluateSession` + `insertSession` in this plan** (Task 7). Each is evaluated at `ROOT` scope until plan 04. | Children are answered through `answerPendingDecision`, which now requires the new input columns. Leaving children on the old engine would make every child unanswerable. `ROOT` keeps a child's standalone evaluation identical whichever mutation produced it. Plan 04 introduces `CONTRIBUTION` for children together with `composeRun`. |
| P3-3 | **The review's reproductions are split.** This plan ports the single-pathway ones: #1 nested gates and #3 scoring (must pass); #9 shared downstream and #10 vital round trip (pinned, documented defects). #2, #5, #6 and #7 are multi-pathway and move to plan 04. | They exercise `composeRun`, conflict selection and pathway-qualified identity, none of which exist until plan 04. |
| P3-4 | **Deferred deletions:** `applyDdiToResolutionState` (production-dead after Task 6, but 14 references in `ddi-pass-single-pathway.test.ts`), and multi-pathway dead code (`buildPatientContext`, `emptyMergedCarePlan`, `reMergeMultiPathwaySession`, multi's `validateForGeneration`) all move to plan 04. So does updating `baseline-capture.test.ts` (skipped; it references `makeTraversalAdapter`), which is plan 05's before/after tool. | Plan 04 rewrites the multi-pathway file and owns its tests. Deleting half of it here would split one change across two plans. |
| P3-5 | **The snapshot is not re-proven against Postgres here.** Spec §5.6 asks for "the snapshot read is a single REPEATABLE READ transaction". | Plan 02's `pipeline-load-env.test.ts` pins the exact statements. The scratch database has no AGE graph to load. Plan 05 re-runs the plan 01 benchmark against the live database, which drives `loadEvaluationEnv` end to end. |
| P3-6 | **`nodesRecomputed` is the evaluated node count** (`resolutionState.size`), and `statusChanges` is the diff of the previous cache against the new result, sorted by `nodeId`. A node absent on one side appears as `'ABSENT'`. | Spec §1 rule 2. Every evaluation recomputes every node. |
| P3-7 | **Generation on a COMPLETED session returns `{ success: true, carePlanId: <existing> }`** without evaluating, as spec §4 prescribes. Today it throws `BAD_REQUEST`. | Spec §4. It is also what makes two concurrent generations converge on one plan. |
| P3-8 | **`PENDING_GATE` is raised for Gate and DecisionPoint nodes only** (plan 02, `readinessOf`). Today's `validateForGeneration` raised one per PENDING node of any type. The per-descendant noise is dropped. | Already decided in plan 02 (Task 6); this plan is where it reaches the API. Listed so the review sees it. |
| P3-9 | **Generation warnings are rendered as text** (`"<category>: <drug> — <advice>"`). Today's code mapped a `DdiFinding` object to `"[object Object]"`. | The field is `[String!]!`. The old rendering was a latent defect. |
| P3-10 | **LLM calls made before a session row exists are not audited.** This covers a start that fails after evaluating, or a multi-pathway run that fails partway. Every exit of a mutation on an existing session writes its audit rows (`withAudits`). | `llm_gate_evaluations.session_id` is a NOT NULL foreign key (migration 057, and spec §4 keeps it). A start writes its session and audit rows in one transaction, so a failed start persists neither. Its calls reached no plan. |

## Baseline

| Point | Passed | Failed | Skipped |
|---|---|---|---|
| Task 0 (base) | … | 9 | … |
| Task 12 (end) | … | 9 | … |

## File map

| File | Responsibility | Task |
|---|---|---|
| `shared/data-layer/migrations/067_evaluation_inputs.sql` (create) | Purge; input + cache columns; drop `dependency_map`; events CHECK | 1 |
| `services/resolution/types.ts` (modify) | `ResolutionSession` gains inputs + cache fields (T2), loses `dependencyMap` (T8) | 2, 8 |
| `services/resolution/session-store.ts` (modify) | `insertSession`, `writeEvaluation`, `writeLifecycleStatus`, `setCarePlanId`, `rowToSession`, `inputsOf`, `statusChangesBetween`, `writeLlmAudits`; `Db` type | 2, 8 |
| `services/resolution/pipeline/observations.ts` (modify) | `LlmClient` receives the gate it is called for | 3 |
| `services/resolution/pipeline/llm-audit.ts` (create) | `auditingLlmClient`: one audit row per real LLM call | 3 |
| `services/resolution/pipeline/request.ts` (create) | `newRequest`, `evaluateSession`, `persistedObservations`, `prewarmInBackground`, `inTransaction`, `RevisionConflict` | 3 |
| `services/resolution/pipeline/commit.ts` (create) | `commitEvaluation`, `loadSession`, `assertMutable`, `statusOf`, `flushAudits`, `conflictError` | 4 |
| `__tests__/fixtures/resolver-harness.ts` (create) | In-memory session table + environment registry, so resolver tests run the real pipeline | 4 |
| `__tests__/fixtures/pipeline-env.ts` (modify) | `edge()` takes properties; `makeEnv` takes signals/registry/temporalDefaults | 4 |
| `apps/pathway-service/schema.graphql`, `src/types/index.ts`, `resolvers/Query.ts` (modify) | New blocker types and scope, node layers, session revision/hash/fingerprint | 5 |
| `resolvers/mutations/resolution.ts` (rewrite) | All six single-pathway mutations on the pipeline | 6 |
| `resolvers/mutations/multi-pathway-resolution.ts`, `services/resolution/care-plan-projection.ts` (modify) | Children through the pipeline; re-merge reads `gateContextFields` | 7 |
| Engine, confidence, store, helpers (modify / delete) | Delete the incremental engine and everything only it used | 8 |
| `__tests__/pipeline-sequence-vs-fresh.test.ts` (create) | Property (a); review reproductions #1, #3, #9, #10 | 9 |
| `services/medications/prewarm-pathway.ts`, `resolvers/mutations/import.ts`, `src/scripts/backfill-medication-normalization.ts` | D14 wiring + backfill | 10 |

Test files are listed in each task. *Appendix A* maps every retired test.

---

### Task 0: Worktree and baseline

- [ ] **Step 1: Create the plan worktree**

Run `/new-feature` for prism-graphql, branch `feat/evaluation-pipeline-03-single-pathway`,
**from `origin/feat/evaluation-pipeline`** (not `origin/main`). Then:

```bash
W=/home/claude/workspace/features/feat-evaluation-pipeline-03-single-pathway/prism-graphql
git -C $W log --oneline -1          # expect 7be4e13 or a later merge on the integration branch
npm install --prefix $W
git -C $W checkout -- package-lock.json   # npm strips "peer": true flags; not this plan's change
npm test --prefix $W/apps/pathway-service -- --runInBand 2>&1 | grep -E "^(FAIL|Tests:)" | sort | uniq -c
```
Expected: the only `FAIL` lines are `patient-match-scorer` and `data-completeness-scorer`, and
the output includes `9 failed`. Record the passed and skipped counts in *Baseline*. They include
plan 01's benchmark, which is skipped.

---

### Task 1: Migration 067

**Files:**
- Create: `shared/data-layer/migrations/067_evaluation_inputs.sql`
- Test: `apps/pathway-service/src/__tests__/pipeline-migration-067.test.ts`

**Interfaces:**
- Produces the columns every later task reads and writes, all on `pathway_resolution_sessions`:
  `revision INT`, `provider_overrides`, `observations`, `graph_fingerprint`,
  `env_fingerprint`, `result_hash`, `readiness`, `gate_context_fields`, `catch_up_items`,
  `parent_session_id`. It removes `dependency_map`.

- [ ] **Step 1: Write the failing test**

No test in the repo reads migration SQL, so this one reads the file as text, the way
`pending-question-schema-parity.test.ts` reads the SDL. Task 11 applies the file to a real
database.

Create `apps/pathway-service/src/__tests__/pipeline-migration-067.test.ts`:

```ts
import { readFileSync } from 'fs';
import { join } from 'path';

const SQL = readFileSync(
  join(__dirname, '../../../../shared/data-layer/migrations/067_evaluation_inputs.sql'),
  'utf-8',
);
const body = SQL.replace(/--.*$/gm, ''); // statements only, comments stripped

describe('migration 067 — evaluation inputs', () => {
  it('purges both session tables before reshaping, inside one transaction', () => {
    const begin = body.indexOf('BEGIN;');
    const purgeMulti = body.indexOf('DELETE FROM multi_pathway_resolution_sessions;');
    const purgeSingle = body.indexOf('DELETE FROM pathway_resolution_sessions;');
    const alter = body.indexOf('ALTER TABLE pathway_resolution_sessions');
    expect(begin).toBeGreaterThanOrEqual(0);
    expect(purgeMulti).toBeGreaterThan(begin);
    expect(purgeSingle).toBeGreaterThan(begin);
    expect(alter).toBeGreaterThan(purgeSingle);
    expect(body.trim().endsWith('COMMIT;')).toBe(true);
  });

  it.each([
    'revision INT NOT NULL DEFAULT 0',
    "provider_overrides JSONB NOT NULL DEFAULT '{}'",
    "observations JSONB NOT NULL DEFAULT '{}'",
    'graph_fingerprint TEXT NOT NULL',
    'env_fingerprint TEXT NOT NULL',
    'result_hash TEXT NOT NULL',
    'readiness JSONB NOT NULL',
    "gate_context_fields JSONB NOT NULL DEFAULT '{}'",
    "catch_up_items JSONB NOT NULL DEFAULT '[]'",
    'parent_session_id UUID REFERENCES multi_pathway_resolution_sessions(id) ON DELETE CASCADE',
  ])('adds %s', (column) => {
    expect(body).toContain(`ADD COLUMN ${column}`);
  });

  it('drops dependency_map, pins the clock, and forbids facts on a child session', () => {
    expect(body).toContain('DROP COLUMN dependency_map');
    expect(body).toContain('ALTER COLUMN temporal_context SET NOT NULL');
    expect(body).toMatch(/CHECK \(parent_session_id IS NULL OR additional_context = '\{\}'::jsonb\)/);
  });

  it('admits the two event types the resolvers write', () => {
    const check = body.slice(body.indexOf('ALTER TABLE pathway_resolution_events'));
    for (const t of ['traversal_complete', 'override', 'gate_answer', 'context_update',
      'care_plan_generated', 'abandoned', 'BRANCH_CHOSEN', 'PROVIDER_ASSERTED_DATUM']) {
      expect(check).toContain(`'${t}'`);
    }
  });

  it('leaves multi_pathway_resolution_sessions columns to plan 04 (P3-1)', () => {
    expect(body).not.toMatch(/ALTER TABLE multi_pathway_resolution_sessions/);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test --prefix $W/apps/pathway-service -- --runInBand src/__tests__/pipeline-migration-067.test.ts`
Expected: FAIL with `ENOENT … 067_evaluation_inputs.sql`.

- [ ] **Step 3: Write the migration**

Create `shared/data-layer/migrations/067_evaluation_inputs.sql`:

```sql
-- Migration 067: evaluation inputs (evaluation pipeline, spec 2026-09-13 §4).
--
-- A resolution session now stores only what a person or the outside world
-- told it, plus a revision. Everything else is a cache of the last committed
-- evaluation, recomputed by every mutation.
--
-- 1. Purge (D8). There are no users, and existing sessions carry neither a
--    graph fingerprint nor overrides-as-inputs. Deleting the sessions
--    cascades to events, decisions, node overrides, gate answers and LLM gate
--    evaluations. Generated care plans have no foreign key to sessions and
--    are untouched.
-- 2. pathway_resolution_sessions gains the input and cache columns and loses
--    dependency_map. parent_session_id is added now (nullable); plan 04
--    starts writing it.
-- 3. The event_type CHECK from 042 admits BRANCH_CHOSEN and
--    PROVIDER_ASSERTED_DATUM, which the resolvers already write and 042
--    rejected.
--
-- The multi_pathway_resolution_sessions columns of spec §4 step 3 arrive in
-- plan 04's migration, with the code that writes them (plan 03 decision P3-1).
--
-- Run once. The purge deletes every session.

BEGIN;

DELETE FROM multi_pathway_resolution_sessions;
DELETE FROM pathway_resolution_sessions;

ALTER TABLE pathway_resolution_sessions
  ADD COLUMN revision INT NOT NULL DEFAULT 0,
  ADD COLUMN provider_overrides JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN observations JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN graph_fingerprint TEXT NOT NULL,
  ADD COLUMN env_fingerprint TEXT NOT NULL,
  ADD COLUMN result_hash TEXT NOT NULL,
  ADD COLUMN readiness JSONB NOT NULL,
  ADD COLUMN gate_context_fields JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN catch_up_items JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN parent_session_id UUID REFERENCES multi_pathway_resolution_sessions(id) ON DELETE CASCADE,
  DROP COLUMN dependency_map,
  ALTER COLUMN temporal_context SET NOT NULL,
  ADD CONSTRAINT pathway_resolution_sessions_child_has_no_facts
    CHECK (parent_session_id IS NULL OR additional_context = '{}'::jsonb);

CREATE INDEX idx_pathway_resolution_sessions_parent
  ON pathway_resolution_sessions(parent_session_id);

-- 042 declared the CHECK inline, so Postgres named it <table>_<column>_check.
-- Deliberately no IF EXISTS: a different name must fail this migration loudly
-- rather than leave the old constraint in place.
ALTER TABLE pathway_resolution_events
  DROP CONSTRAINT pathway_resolution_events_event_type_check,
  ADD CONSTRAINT pathway_resolution_events_event_type_check CHECK (event_type IN (
    'traversal_complete', 'override', 'gate_answer', 'context_update',
    'care_plan_generated', 'abandoned', 'BRANCH_CHOSEN', 'PROVIDER_ASSERTED_DATUM'
  ));

COMMIT;
```

- [ ] **Step 4: Run the test**

Run the Step 2 command. Expected: PASS (14 tests).

**Falsify:** delete the line `ADD COLUMN readiness JSONB NOT NULL,` from the SQL. The `adds
readiness JSONB NOT NULL` case must fail. Restore it.

- [ ] **Step 5: Commit**

```bash
git -C $W add shared/data-layer/migrations/067_evaluation_inputs.sql apps/pathway-service/src/__tests__/pipeline-migration-067.test.ts
git -C $W commit -m "feat(data-layer): migration 067 stores evaluation inputs on resolution sessions

Purges sessions (D8), adds revision, overrides, observations, fingerprints,
result hash, readiness and cached findings, drops dependency_map, and
admits BRANCH_CHOSEN and PROVIDER_ASSERTED_DATUM in the event_type CHECK.
Multi-pathway columns follow in plan 04 (P3-1).

Claude-Session: https://claude.ai/code/session_01XRNkZvQrxmRLNtJHxq71kH"
```

---

### Task 2: Session store for inputs and results

**Files:**
- Modify: `apps/pathway-service/src/services/resolution/types.ts` (`ResolutionSession`)
- Modify: `apps/pathway-service/src/services/resolution/session-store.ts`
- Test: `apps/pathway-service/src/__tests__/session-store-evaluation.test.ts`
- Modify (test): `apps/pathway-service/src/__tests__/temporal/session-temporal-context.test.ts`
  (add one test)

This task is **additive**. `createSession`, `updateSession` and the dependency-map serialisers
stay until Task 8, because the resolvers still call them until Task 6.

**Interfaces:**
- Consumes: `SessionInputs`, `EvaluationResult`, `LlmObservation`, `ScopedBlocker`
  (`pipeline/types.ts`); `CatchUpItem` (`care-plan-merge.ts`).
- Produces:
  - `type Db = Pick<Pool, 'query'>`
  - `interface NewSession { pathwayVersion: string; patientId: string; providerId: string; inputs: SessionInputs; result: EvaluationResult; status: SessionStatus; durationMs: number; parentSessionId?: string }`
  - `evaluationColumns(args: { inputs: SessionInputs; result: EvaluationResult; status: SessionStatus; durationMs: number }): Record<string, unknown>`
  - `insertColumns(s: NewSession): Record<string, unknown>`
  - `insertSession(db: Db, s: NewSession): Promise<string>`
  - `writeEvaluation(db: Db, args: { sessionId: string; expectedRevision: number; inputs: SessionInputs; result: EvaluationResult; status: SessionStatus; durationMs: number }): Promise<boolean>`
  - `writeLifecycleStatus(db: Db, args: { sessionId: string; expectedRevision: number; status: SessionStatus }): Promise<boolean>`
  - `setCarePlanId(db: Db, sessionId: string, carePlanId: string): Promise<void>`
  - `rowToSession(row: any, events: unknown[]): ResolutionSession`
  - `inputsOf(session: ResolutionSession): SessionInputs`
  - `statusChangesBetween(prev: ResolutionState, next: ResolutionState): Array<{ nodeId: string; from: string; to: string }>`
  - `writeLlmAudits(db: Db, sessionId: string, rows: LlmAuditRow[]): Promise<void>`
  - `logEvent`, `logNodeOverride` and `logGateAnswer` now take `db: Db`. The change is
    type-compatible with every existing caller.
  - New `ResolutionSession` fields: `revision`, `providerOverrides`, `observations`,
    `graphFingerprint`, `envFingerprint`, `resultHash`, `readiness`, `gateContextFields`,
    `catchUpItems`, `parentSessionId?`.

- [ ] **Step 1: Write the failing test**

Create `apps/pathway-service/src/__tests__/session-store-evaluation.test.ts`:

```ts
import {
  inputsOf,
  insertColumns,
  insertSession,
  rowToSession,
  statusChangesBetween,
  writeEvaluation,
  writeLifecycleStatus,
} from '../services/resolution/session-store';
import { evaluate } from '../services/resolution/pipeline/evaluate';
import { replayObservations } from '../services/resolution/pipeline/observations';
import { NodeResult, NodeStatus, OverrideAction, SessionStatus } from '../services/resolution/types';
import { edge, makeEnv, makeInputs, node } from './fixtures/pipeline-env';

const env = makeEnv(
  [node('root', 'Pathway'), node('step', 'Step'), node('med', 'Medication', { name: 'Amoxicillin', score: 0.1 })],
  [edge('root', 'step'), edge('step', 'med')],
);
const inputs = makeInputs(env, {
  additionalContext: { conditionCodes: [{ code: 'I10', system: 'ICD-10' }] },
  gateAnswers: new Map([['g', { booleanValue: true }]]),
  providerOverrides: new Map([['med', { action: OverrideAction.INCLUDE, originalStatus: NodeStatus.EXCLUDED, originalConfidence: 0.1 }]]),
});

async function result() {
  return evaluate(inputs, env, replayObservations(new Map(), 'test-model'), 'ROOT');
}

function fakeDb(rowCount = 1) {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  return {
    calls,
    query: jest.fn(async (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
      return { rows: [{ id: 'session-9' }], rowCount };
    }),
  };
}

describe('session store for evaluation inputs', () => {
  it('insertSession writes identity, inputs and the evaluation cache in one row', async () => {
    const db = fakeDb();
    const id = await insertSession(db as never, {
      pathwayVersion: '1', patientId: 'pt', providerId: 'pr', inputs, result: await result(),
      status: SessionStatus.ACTIVE, durationMs: 12.6,
    });

    expect(id).toBe('session-9');
    const { sql, params } = db.calls[0];
    expect(sql).toMatch(/^INSERT INTO pathway_resolution_sessions \(/);
    for (const col of ['graph_fingerprint', 'temporal_context', 'provider_overrides', 'observations',
      'readiness', 'result_hash', 'env_fingerprint', 'gate_context_fields', 'catch_up_items']) {
      expect(sql).toContain(col);
    }
    // Placeholder count must equal the parameter array, or pg throws at runtime.
    expect(sql).toContain(`$${params.length})`);
    expect(sql).not.toContain(`$${params.length + 1}`);
  });

  it('insertSession refuses a session with no clock', async () => {
    await expect(insertSession(fakeDb() as never, {
      pathwayVersion: '1', patientId: 'pt', providerId: 'pr',
      inputs: { ...inputs, temporalContext: undefined as never }, result: await result(),
      status: SessionStatus.ACTIVE, durationMs: 1,
    })).rejects.toThrow(/temporalContext/);
  });

  it('writeEvaluation is a compare-and-set on revision and mutable status', async () => {
    const db = fakeDb(1);
    const r = await result();
    await expect(writeEvaluation(db as never, {
      sessionId: 's', expectedRevision: 4, inputs, result: r, status: SessionStatus.ACTIVE, durationMs: 1,
    })).resolves.toBe(true);
    const { sql, params } = db.calls[0];
    expect(sql).toContain('revision = revision + 1');
    expect(sql).toMatch(/WHERE id = \$\d+ AND revision = \$\d+ AND status IN \('ACTIVE', 'DEGRADED'\)/);
    expect(params.slice(-2)).toEqual(['s', 4]);

    await expect(writeEvaluation(fakeDb(0) as never, {
      sessionId: 's', expectedRevision: 4, inputs, result: r, status: SessionStatus.ACTIVE, durationMs: 1,
    })).resolves.toBe(false);
    await expect(writeLifecycleStatus(fakeDb(0) as never, { sessionId: 's', expectedRevision: 4, status: SessionStatus.ABANDONED }))
      .resolves.toBe(false);
  });

  it('rowToSession round-trips the stored inputs (the JSONB column shapes)', async () => {
    const r = await result();
    const cols = insertColumns({
      pathwayVersion: '1', patientId: 'pt', providerId: 'pr', inputs, result: r,
      status: SessionStatus.ACTIVE, durationMs: 1,
    });
    // pg returns JSONB parsed, and Maps do not survive JSON — exactly what a round trip does.
    const row = { ...JSON.parse(JSON.stringify(cols)), id: 's', revision: 3, created_at: new Date(), updated_at: new Date() };
    const session = rowToSession(row, []);

    expect(session.revision).toBe(3);
    expect(session.resultHash).toBe(r.resultHash);
    expect(session.readiness).toEqual(JSON.parse(JSON.stringify(r.readiness)));
    expect(session.resolutionState.get('med')!.status).toBe(NodeStatus.INCLUDED);
    const back = inputsOf(session);
    expect(back.gateAnswers).toEqual(inputs.gateAnswers);
    expect(back.providerOverrides).toEqual(inputs.providerOverrides);
    expect(back.additionalContext).toEqual(inputs.additionalContext);
    expect(back.graphFingerprint).toBe(inputs.graphFingerprint);
    expect(back.revision).toBe(3);
  });

  it('inputsOf returns fresh maps, so a mutation cannot edit the loaded session', async () => {
    const session = rowToSession({
      ...JSON.parse(JSON.stringify(insertColumns({
        pathwayVersion: '1', patientId: 'pt', providerId: 'pr', inputs, result: await result(),
        status: SessionStatus.ACTIVE, durationMs: 1,
      }))), id: 's', revision: 0,
    }, []);
    inputsOf(session).gateAnswers.set('other', { booleanValue: false });
    expect(session.gateAnswers.has('other')).toBe(false);
  });

  it('statusChangesBetween lists changed nodes in nodeId order', () => {
    const n = (status: NodeStatus) => ({ status } as NodeResult);
    const prev = new Map([['b', n(NodeStatus.INCLUDED)], ['a', n(NodeStatus.EXCLUDED)], ['c', n(NodeStatus.INCLUDED)]]);
    const next = new Map([['c', n(NodeStatus.INCLUDED)], ['a', n(NodeStatus.INCLUDED)], ['d', n(NodeStatus.GATED_OUT)]]);
    expect(statusChangesBetween(prev, next)).toEqual([
      { nodeId: 'a', from: 'EXCLUDED', to: 'INCLUDED' },
      { nodeId: 'b', from: 'INCLUDED', to: 'ABSENT' },
      { nodeId: 'd', from: 'ABSENT', to: 'GATED_OUT' },
    ]);
  });
});
```

Append to `temporal/session-temporal-context.test.ts`, inside `describe('session temporal_context persistence', …)`:

```ts
  it('insertSession writes the temporal context as JSON', async () => {
    const { pool, calls } = fakePool([]);
    const env = makeEnv([node('root', 'Pathway')], []);
    const inputs = makeInputs(env, { temporalContext: TCTX });
    const result = await evaluate(inputs, env, replayObservations(new Map(), 'test-model'), 'ROOT');
    await insertSession(pool as never, {
      pathwayVersion: '1', patientId: 'pt', providerId: 'pr', inputs, result,
      status: SessionStatus.ACTIVE, durationMs: 1,
    });

    const insert = calls.find((c) => c.sql.includes('INSERT INTO pathway_resolution_sessions'))!;
    expect(insert.sql).toContain('temporal_context');
    expect(insert.params).toContain(JSON.stringify(TCTX));
  });
```

and extend that file's imports with:

```ts
import { insertSession } from '../../services/resolution/session-store';
import { evaluate } from '../../services/resolution/pipeline/evaluate';
import { replayObservations } from '../../services/resolution/pipeline/observations';
import { SessionStatus } from '../../services/resolution/types';
import { makeEnv, makeInputs, node } from '../fixtures/pipeline-env';
```

(`insertSession` goes into the existing `session-store` import line.)

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test --prefix $W/apps/pathway-service -- --runInBand src/__tests__/session-store-evaluation.test.ts src/__tests__/temporal/session-temporal-context.test.ts`
Expected: FAIL with `insertSession is not a function` (or `insertColumns is not a function`).

- [ ] **Step 3: Extend `ResolutionSession`**

In `services/resolution/types.ts`, add to the imports at the top of the file:

```ts
import type { LlmObservation, ScopedBlocker } from './pipeline/types';
import type { CatchUpItem } from './care-plan-merge';
```

Inside `export interface ResolutionSession {`, directly after `status: SessionStatus;`, add:

```ts
  /** Optimistic-lock counter. Every committed write increments it (spec §4). */
  revision: number;
  // ── Inputs (spec §1): what a person or the outside world told the session.
  providerOverrides: Map<string, ProviderOverride>;
  observations: Map<string, LlmObservation>;
  graphFingerprint: string;
  // ── Cache of the last committed evaluation. Never an input.
  envFingerprint: string;
  resultHash: string;
  readiness: { ready: boolean; blockers: ScopedBlocker[] };
  gateContextFields: Map<string, string[]>;
  catchUpItems: CatchUpItem[];
  /** Set by plan 04 for a child of a multi-pathway run. */
  parentSessionId?: string;
```

- [ ] **Step 4: Add the store functions**

In `services/resolution/session-store.ts`:

1. Extend the imports:

```ts
import { ProviderOverride, SessionStatus } from './types';
import type { AdditionalContextInput } from '../../resolvers/mutations/resolution';
import type { EvaluationResult, LlmObservation, SessionInputs } from './pipeline/types';
```

(`SessionStatus` and `ProviderOverride` join the existing `./types` import list.)

2. Directly after the `// ─── Serialization ───` section (after `deserializeDependencyMap`), add:

```ts
// ─── Inputs + evaluation cache (evaluation pipeline, spec §1/§4) ─────

/** Anything that can run a query: the pool, or a client inside a transaction. */
export type Db = Pick<Pool, 'query'>;

/** An LLM gate call, recorded whether or not it succeeded (spec §4, Audit). */
export interface LlmAuditRow {
  gateId: string;
  pathwayId: string;
  inputAttribute: string | null;
  inputText: string;
  prompt: string;
  branches: unknown;
  model: string;
  chosenBranch: string | null;
  confidence: number | null;
  reasoning: string | null;
  fullResponse: unknown;
  tentative: boolean;
  errorMessage: string | null;
  latencyMs: number | null;
}

export interface NewSession {
  pathwayVersion: string;
  patientId: string;
  providerId: string;
  inputs: SessionInputs;
  result: EvaluationResult;
  status: SessionStatus;
  durationMs: number;
  parentSessionId?: string;
}

const objOf = <V>(m: Map<string, V>): Record<string, V> => Object.fromEntries(m);
const mapOf = <V>(o: Record<string, V> | null | undefined): Map<string, V> => new Map(Object.entries(o ?? {}));
/** JSONB parameters are sent as JSON text; scalars pass through. */
const param = (v: unknown): unknown => (v !== null && typeof v === 'object' ? JSON.stringify(v) : v);

/** The columns an evaluation writes: the session's mutable inputs and the cache of its result. */
export function evaluationColumns(args: {
  inputs: SessionInputs;
  result: EvaluationResult;
  status: SessionStatus;
  durationMs: number;
}): Record<string, unknown> {
  const { inputs, result } = args;
  return {
    status: args.status,
    additional_context: inputs.additionalContext,
    gate_answers: objOf(inputs.gateAnswers),
    provider_overrides: objOf(inputs.providerOverrides),
    observations: objOf(inputs.observations),
    resolution_state: serializeResolutionState(result.resolutionState),
    pending_questions: result.pendingQuestions,
    red_flags: result.redFlags,
    ddi_warnings: result.safetyFindings.filter((f) => f.action === 'WARN'),
    readiness: result.readiness,
    gate_context_fields: objOf(result.gateContextFields),
    catch_up_items: result.catchUpItems,
    env_fingerprint: result.envFingerprint,
    result_hash: result.resultHash,
    total_nodes_evaluated: result.resolutionState.size,
    traversal_duration_ms: Math.round(args.durationMs),
  };
}

/** Every column of a new row: identity, the immutable inputs, then `evaluationColumns`. */
export function insertColumns(s: NewSession): Record<string, unknown> {
  return {
    pathway_id: s.inputs.pathwayId,
    pathway_version: s.pathwayVersion,
    patient_id: s.patientId,
    provider_id: s.providerId,
    initial_patient_context: s.inputs.initialPatientContext,
    temporal_context: s.inputs.temporalContext,
    graph_fingerprint: s.inputs.graphFingerprint,
    parent_session_id: s.parentSessionId ?? null,
    ...evaluationColumns(s),
  };
}

export async function insertSession(db: Db, s: NewSession): Promise<string> {
  // Types are erased and tests are not typechecked: a clock-less row would be
  // unevaluable forever, so refuse it here rather than at the NOT NULL.
  if (!s.inputs.temporalContext) {
    throw new Error('insertSession requires temporalContext — a session with no pinned clock cannot be evaluated');
  }
  const cols = insertColumns(s);
  const names = Object.keys(cols);
  const result = await db.query(
    `INSERT INTO pathway_resolution_sessions (${names.join(', ')})
     VALUES (${names.map((_, i) => `$${i + 1}`).join(', ')})
     RETURNING id`,
    names.map((n) => param(cols[n])),
  );
  return result.rows[0].id;
}

/**
 * Commit an evaluation as a compare-and-set on `revision` (spec §4). Returns
 * false when another write moved the row or it left ACTIVE/DEGRADED; the caller
 * rolls back and retries. `status: COMPLETED` is generation's claim.
 */
export async function writeEvaluation(
  db: Db,
  args: { sessionId: string; expectedRevision: number; inputs: SessionInputs; result: EvaluationResult; status: SessionStatus; durationMs: number },
): Promise<boolean> {
  const cols = evaluationColumns(args);
  const names = Object.keys(cols);
  const result = await db.query(
    `UPDATE pathway_resolution_sessions
        SET ${names.map((n, i) => `${n} = $${i + 1}`).join(', ')}, revision = revision + 1, updated_at = NOW()
      WHERE id = $${names.length + 1} AND revision = $${names.length + 2} AND status IN ('ACTIVE', 'DEGRADED')`,
    [...names.map((n) => param(cols[n])), args.sessionId, args.expectedRevision],
  );
  return result.rowCount === 1;
}

/** Lifecycle-only change (abandon): no evaluation, same revision check (spec §4). */
export async function writeLifecycleStatus(
  db: Db,
  args: { sessionId: string; expectedRevision: number; status: SessionStatus },
): Promise<boolean> {
  const result = await db.query(
    `UPDATE pathway_resolution_sessions
        SET status = $1, revision = revision + 1, updated_at = NOW()
      WHERE id = $2 AND revision = $3 AND status IN ('ACTIVE', 'DEGRADED')`,
    [args.status, args.sessionId, args.expectedRevision],
  );
  return result.rowCount === 1;
}

/** Inside generation's claimed transaction only. */
export async function setCarePlanId(db: Db, sessionId: string, carePlanId: string): Promise<void> {
  await db.query('UPDATE pathway_resolution_sessions SET care_plan_id = $1 WHERE id = $2', [carePlanId, sessionId]);
}

/**
 * A stored row as a session. Missing JSON columns read as empty rather than
 * crashing: every row written after migration 067 has them, and test fixtures
 * that predate them keep working.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function rowToSession(row: any, events: unknown[]): ResolutionSession {
  return {
    id: row.id,
    pathwayId: row.pathway_id,
    pathwayVersion: row.pathway_version,
    patientId: row.patient_id,
    providerId: row.provider_id,
    status: row.status,
    revision: row.revision ?? 0,
    resolutionState: deserializeResolutionState(row.resolution_state ?? {}),
    dependencyMap: deserializeDependencyMap(row.dependency_map ?? {}),
    initialPatientContext: row.initial_patient_context,
    additionalContext: row.additional_context ?? {},
    pendingQuestions: row.pending_questions ?? [],
    redFlags: row.red_flags ?? [],
    resolutionEvents: events as ResolutionSession['resolutionEvents'],
    gateAnswers: mapOf<GateAnswer>(row.gate_answers),
    providerOverrides: mapOf<ProviderOverride>(row.provider_overrides),
    observations: mapOf<LlmObservation>(row.observations),
    graphFingerprint: row.graph_fingerprint ?? '',
    envFingerprint: row.env_fingerprint ?? '',
    resultHash: row.result_hash ?? '',
    readiness: row.readiness ?? { ready: false, blockers: [] },
    gateContextFields: mapOf<string[]>(row.gate_context_fields),
    catchUpItems: row.catch_up_items ?? [],
    totalNodesEvaluated: row.total_nodes_evaluated,
    traversalDurationMs: row.traversal_duration_ms,
    carePlanId: row.care_plan_id,
    ddiWarnings: row.ddi_warnings ?? [],
    // pg parses JSONB; `?? undefined` turns SQL NULL into undefined.
    temporalContext: (row.temporal_context ?? undefined) as EvaluationTemporalContext | undefined,
    parentSessionId: row.parent_session_id ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** The inputs a mutation starts from: fresh copies, so changing them cannot edit the loaded session. */
export function inputsOf(session: ResolutionSession): SessionInputs {
  if (!session.temporalContext) {
    throw new Error(`session ${session.id} has no pinned clock and cannot be evaluated`);
  }
  return {
    pathwayId: session.pathwayId,
    graphFingerprint: session.graphFingerprint,
    temporalContext: session.temporalContext,
    initialPatientContext: session.initialPatientContext,
    additionalContext: { ...(session.additionalContext as Partial<AdditionalContextInput>) },
    gateAnswers: new Map(session.gateAnswers),
    providerOverrides: new Map(session.providerOverrides),
    observations: new Map(session.observations),
    revision: session.revision,
  };
}

/** The event log's statusChanges: the previous cache against the new result, in nodeId order (spec §1 rule 2). */
export function statusChangesBetween(
  prev: ResolutionState,
  next: ResolutionState,
): Array<{ nodeId: string; from: string; to: string }> {
  const ids = [...new Set([...prev.keys(), ...next.keys()])].sort();
  const changes: Array<{ nodeId: string; from: string; to: string }> = [];
  for (const nodeId of ids) {
    const from = prev.get(nodeId)?.status ?? 'ABSENT';
    const to = next.get(nodeId)?.status ?? 'ABSENT';
    if (from !== to) changes.push({ nodeId, from, to });
  }
  return changes;
}

/** Moved from resolution-context's flushAudits; runs inside the caller's transaction. */
export async function writeLlmAudits(db: Db, sessionId: string, rows: LlmAuditRow[]): Promise<void> {
  for (const row of rows) {
    await db.query(
      `INSERT INTO llm_gate_evaluations (
         session_id, gate_id, pathway_id, input_attribute, input_text,
         prompt, branches, model, chosen_branch, confidence, reasoning,
         full_response, tentative, error_message, latency_ms
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
      [
        sessionId, row.gateId, row.pathwayId, row.inputAttribute, row.inputText,
        row.prompt, JSON.stringify(row.branches), row.model, row.chosenBranch, row.confidence,
        row.reasoning, row.fullResponse ? JSON.stringify(row.fullResponse) : null,
        row.tentative, row.errorMessage, row.latencyMs,
      ],
    );
  }
}
```

3. Replace the body of `getSession` after its two queries with a single return statement,
   keeping the two queries exactly as they are:

```ts
  return rowToSession(row, events.rows);
```

4. In `logEvent`, `logNodeOverride` and `logGateAnswer`, change the first parameter from
   `pool: Pool` to `db: Db`, and change `pool.query(` to `db.query(` in each body.

- [ ] **Step 5: Run the tests and typecheck**

```bash
npm test --prefix $W/apps/pathway-service -- --runInBand src/__tests__/session-store-evaluation.test.ts src/__tests__/temporal/session-temporal-context.test.ts src/__tests__/session-store.test.ts
$W/node_modules/.bin/tsc -p $W/apps/pathway-service/tsconfig.json --noEmit
```
Expected: PASS; typecheck clean. The existing `getSession hydrates the temporal context` test
still passes: its row fixture has no new columns, and `rowToSession` reads them as empty.

**Falsify:** in `statusChangesBetween`, delete `.sort()`. The order test must fail. Restore it.

- [ ] **Step 6: Commit**

```bash
git -C $W add apps/pathway-service/src/services/resolution/types.ts apps/pathway-service/src/services/resolution/session-store.ts apps/pathway-service/src/__tests__/session-store-evaluation.test.ts apps/pathway-service/src/__tests__/temporal/session-temporal-context.test.ts
git -C $W commit -m "feat(pathway-service): session store for evaluation inputs and results

insertSession and writeEvaluation store a session's inputs with the cache
of its last evaluation; writeEvaluation is a compare-and-set on revision
and mutable status. rowToSession/inputsOf round-trip the inputs, and the
event diff is ordered by nodeId. Additive: the old store stays until the
resolvers move (Task 6).

Claude-Session: https://claude.ai/code/session_01XRNkZvQrxmRLNtJHxq71kH"
```

---

### Task 3: One evaluation attempt — LLM audit capture, observation reuse, pre-warm

**Files:**
- Modify: `apps/pathway-service/src/services/resolution/pipeline/observations.ts` (`LlmClient` signature)
- Create: `apps/pathway-service/src/services/resolution/pipeline/llm-audit.ts`
- Create: `apps/pathway-service/src/services/resolution/pipeline/request.ts`
- Modify: `apps/pathway-service/src/services/resolution/pipeline/load-env.ts` (`unnormalized` keeps the full key)
- Test: `apps/pathway-service/src/__tests__/pipeline-request.test.ts`
- Modify (test): `apps/pathway-service/src/__tests__/pipeline-load-env.test.ts` (one expectation)

**Interfaces:**
- Consumes:
  - `loadEvaluationEnv` and `EvaluationEnv` (plan 02);
  - `evaluate` and `EvaluationError` (plan 02);
  - `liveObservations` (plan 02);
  - `evaluateGateWithLLM`, `loadLLMGateConfig` and `LLMGateClientConfig` (`llm/llm-gate-client.ts`);
  - `prewarmMedications(pool, inputs)` (`medications/normalizer.ts:164`);
  - `LlmAuditRow` (Task 2).
- Produces:
  - `type LlmClient = (input: LLMGateInput, call: { gateId: string; gate: GateProperties }) => Promise<LLMGateOutput>` (changed signature)
  - `auditingLlmClient(config: LLMGateClientConfig | null, pathwayId: string, sink: LlmAuditRow[]): LlmClient | null`
  - `interface EvaluationRequest { requestObservations: Map<ObservationKey, LlmObservation>; audits: LlmAuditRow[] }`
  - `newRequest(): EvaluationRequest`
  - `interface SessionEvaluation { env: EvaluationEnv; inputs: SessionInputs; result: EvaluationResult; durationMs: number }`
  - `evaluateSession(pool: Pool, request: EvaluationRequest, inputs: SessionInputs, scope: EvaluationScope, opts?: { pinGraph?: boolean }): Promise<SessionEvaluation>`
  - `persistedObservations(inputs: SessionInputs, request: EvaluationRequest, result: EvaluationResult): Map<ObservationKey, LlmObservation>`
  - `prewarmInBackground(pool: Pool, inputs: MedicationInput[]): void`
  - `EvaluationEnv.unnormalized` becomes `MedicationInput[]`, not `string[]`: text, system and code,
    deduplicated by `normalizedKey`. The cache is keyed on all three, so pre-warming the text
    alone writes a row that evaluation never reads for a coded medication (review P1).
  - `class RevisionConflict extends Error`
  - `inTransaction<T>(pool: Pool, fn: (db: PoolClient) => Promise<T>): Promise<T>`

- [ ] **Step 1: Write the failing test**

Create `apps/pathway-service/src/__tests__/pipeline-request.test.ts`:

```ts
jest.mock('../services/llm/llm-gate-client', () => ({
  ...jest.requireActual('../services/llm/llm-gate-client'),
  evaluateGateWithLLM: jest.fn(),
  loadLLMGateConfig: jest.fn(() => null),
}));
jest.mock('../services/resolution/pipeline/load-env', () => ({
  ...jest.requireActual('../services/resolution/pipeline/load-env'),
  loadEvaluationEnv: jest.fn(),
}));
jest.mock('../services/medications/normalizer', () => ({
  ...jest.requireActual('../services/medications/normalizer'),
  prewarmMedications: jest.fn(),
}));

import { evaluateGateWithLLM } from '../services/llm/llm-gate-client';
import { prewarmMedications } from '../services/medications/normalizer';
import { normalizedKey } from '../services/medications/safety-reference';
import { loadEvaluationEnv } from '../services/resolution/pipeline/load-env';
import { auditingLlmClient } from '../services/resolution/pipeline/llm-audit';
import { evaluateSession, newRequest, persistedObservations, prewarmInBackground } from '../services/resolution/pipeline/request';
import { DefaultBehavior, GateProperties, GateType } from '../services/resolution/types';
import { edge, makeEnv, makeInputs, node } from './fixtures/pipeline-env';

const CONFIG = { baseUrl: 'http://llm', apiKey: 'k', model: 'm1', timeoutMs: 1000 };
const gate = {
  title: 'Urgency', gate_type: GateType.LLM_TEXT_ANALYSIS, default_behavior: DefaultBehavior.SKIP,
  prompt: 'Urgent?', input_attribute: 'freeformData.narrative', confidence_threshold: 0.75,
  branches: [{ name: 'urgent', description: 'same day' }],
} as GateProperties;
const input = { prompt: 'Urgent?', narrative: 'chest pain', branches: [{ name: 'urgent', description: 'same day' }] };

describe('auditingLlmClient', () => {
  it('records one audit row per real call, success and failure', async () => {
    const sink: unknown[] = [];
    (evaluateGateWithLLM as jest.Mock)
      .mockResolvedValueOnce({ chosenBranch: 'urgent', confidence: 0.6, reasoning: 'r', rawResponse: { x: 1 }, model: 'm1', latencyMs: 7 })
      .mockRejectedValueOnce(new Error('timeout'));
    const client = auditingLlmClient(CONFIG, 'pw', sink as never)!;

    await client(input, { gateId: 'g', gate });
    await expect(client(input, { gateId: 'g', gate })).rejects.toThrow('timeout');

    expect(sink).toEqual([
      expect.objectContaining({ gateId: 'g', pathwayId: 'pw', inputText: 'chest pain', inputAttribute: 'freeformData.narrative',
        chosenBranch: 'urgent', confidence: 0.6, tentative: true, errorMessage: null, latencyMs: 7 }),
      expect.objectContaining({ gateId: 'g', model: 'm1', chosenBranch: null, tentative: true, errorMessage: 'timeout' }),
    ]);
  });

  it('marks a confident verdict as not tentative', async () => {
    const sink: Array<{ tentative: boolean }> = [];
    (evaluateGateWithLLM as jest.Mock).mockResolvedValueOnce({ chosenBranch: 'urgent', confidence: 0.9, reasoning: 'r', rawResponse: {}, model: 'm1', latencyMs: 1 });
    await auditingLlmClient(CONFIG, 'pw', sink as never)!(input, { gateId: 'g', gate });
    expect(sink[0].tentative).toBe(false);
  });

  it('is null when no LLM is configured', () => {
    expect(auditingLlmClient(null, 'pw', [])).toBeNull();
  });
});

describe('persistedObservations', () => {
  it('keeps the session observations and adds only the request observations the result used', () => {
    const obs = (key: string) => ({ key, gateId: 'g', chosenBranch: 'b', confidence: 1, reasoning: '', model: 'm', acquiredAt: 't' });
    const request = newRequest();
    request.requestObservations.set('used', obs('used'));
    request.requestObservations.set('unused', obs('unused'));
    const out = persistedObservations(
      { observations: new Map([['old', obs('old')]]) } as never,
      request,
      { observationsUsed: ['old', 'used'] } as never,
    );
    expect([...out.keys()].sort()).toEqual(['old', 'used']);
  });
});

describe('evaluateSession', () => {
  const env = makeEnv([node('root', 'Pathway'), node('step', 'Step')], [edge('root', 'step')]);
  beforeEach(() => (loadEvaluationEnv as jest.Mock).mockReset().mockResolvedValue(env));

  it('pins the graph fingerprint only when starting', async () => {
    const inputs = { ...makeInputs(env), graphFingerprint: '' };
    const started = await evaluateSession({} as never, newRequest(), inputs, 'ROOT', { pinGraph: true });
    expect(started.inputs.graphFingerprint).toBe(env.graphFingerprint);
    expect(started.result.resolutionState.get('step')).toBeDefined();

    await expect(evaluateSession({} as never, newRequest(), inputs, 'ROOT'))
      .rejects.toMatchObject({ extensions: { code: 'SESSION_GRAPH_CHANGED' } });
  });

  it('loads the snapshot for the effective patient: initial context plus additions', async () => {
    const inputs = makeInputs(env, { additionalContext: { medications: [{ code: '1', system: 'RxNorm', display: 'Warfarin' }] } });
    await evaluateSession({} as never, newRequest(), inputs, 'ROOT');
    const universe = (loadEvaluationEnv as jest.Mock).mock.calls.at(-1)![2];
    expect(universe.patient.medications).toEqual([expect.objectContaining({ display: 'Warfarin' })]);
  });
});

describe('prewarmInBackground', () => {
  it('starts a pre-warm without awaiting it and swallows its failure', async () => {
    let settle!: (v: unknown) => void;
    (prewarmMedications as jest.Mock).mockReturnValueOnce(new Promise((r) => { settle = r; }));
    expect(prewarmInBackground({} as never, [{ text: 'Tinidazole' }])).toBeUndefined();
    expect(prewarmMedications).toHaveBeenCalledWith({}, [{ text: 'Tinidazole' }]);
    settle({ succeeded: 1, failed: 0 });

    (prewarmMedications as jest.Mock).mockRejectedValueOnce(new Error('rxnav down'));
    prewarmInBackground({} as never, [{ text: 'X' }]);
    // An unhandled rejection here would fail the run.
    await new Promise((r) => setImmediate(r));
  });

  it('pre-warms a coded patient medication under the key evaluation looks it up by (review P1)', async () => {
    const coded = { text: 'Warfarin', system: 'RxNorm', code: '11289' };
    (prewarmMedications as jest.Mock).mockClear().mockResolvedValue({ succeeded: 1, failed: 0 });
    (loadEvaluationEnv as jest.Mock).mockResolvedValue({
      ...makeEnv([node('root', 'Pathway')], []), unnormalized: [coded],
    });
    const env = makeEnv([node('root', 'Pathway')], []);
    await evaluateSession({} as never, newRequest(), makeInputs(env), 'ROOT');

    const [[, sent]] = (prewarmMedications as jest.Mock).mock.calls;
    expect(sent).toEqual([coded]);
    // The key patientSafety reads for this medication (text = display, plus system and code).
    expect(normalizedKey(sent[0])).toBe(normalizedKey({ text: 'Warfarin', system: 'RxNorm', code: '11289' }));
    expect(normalizedKey(sent[0])).not.toBe(normalizedKey({ text: 'Warfarin' }));
  });

  it('does nothing when every name is normalised', () => {
    (prewarmMedications as jest.Mock).mockClear();
    prewarmInBackground({} as never, []);
    expect(prewarmMedications).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test --prefix $W/apps/pathway-service -- --runInBand src/__tests__/pipeline-request.test.ts`
Expected: FAIL with `Cannot find module '../services/resolution/pipeline/llm-audit'`.

- [ ] **Step 3: Give the LLM client the gate it is called for**

In `pipeline/observations.ts`:

1. Replace `export type LlmClient = (input: LLMGateInput) => Promise<LLMGateOutput>;` with:

```ts
/** The gate rides along so the auditing client can record it (spec §4, Audit). */
export type LlmClient = (
  input: LLMGateInput,
  call: { gateId: string; gate: GateProperties },
) => Promise<LLMGateOutput>;
```

2. In `liveObservations`, change the call `const out = await client({ … });` to pass the gate
   as the second argument:

```ts
        const out = await client(
          {
            prompt: gate.prompt ?? gate.title,
            narrative,
            branches: (gate.branches ?? []).map((b) => ({ name: b.name, description: b.description })),
          },
          { gateId, gate },
        );
```

Plan 02's observation tests pass unmodified: their mock clients ignore the second argument.

- [ ] **Step 4: Create `pipeline/llm-audit.ts`**

```ts
import { evaluateGateWithLLM } from '../../llm/llm-gate-client';
import type { LLMGateClientConfig } from '../../llm/llm-gate-client';
import type { LlmAuditRow } from '../session-store';
import type { LlmClient } from './observations';

/**
 * An LLM client that records one audit row per REAL call, success or failure
 * (spec §4, Audit). A reused observation makes no call and records nothing.
 * Failures are recorded and rethrown; `liveObservations` turns them into
 * UNAVAILABLE.
 */
export function auditingLlmClient(
  config: LLMGateClientConfig | null,
  pathwayId: string,
  sink: LlmAuditRow[],
): LlmClient | null {
  if (!config) return null;
  return async (input, { gateId, gate }) => {
    const base = {
      gateId,
      pathwayId,
      inputAttribute: gate.input_attribute || null,
      inputText: input.narrative,
      prompt: input.prompt,
      branches: gate.branches ?? [],
    };
    try {
      const out = await evaluateGateWithLLM(input, config);
      sink.push({
        ...base,
        model: out.model,
        chosenBranch: out.chosenBranch,
        confidence: out.confidence,
        reasoning: out.reasoning,
        fullResponse: out.rawResponse,
        tentative: out.confidence < (gate.confidence_threshold ?? 0.75),
        errorMessage: null,
        latencyMs: out.latencyMs,
      });
      return out;
    } catch (err) {
      sink.push({
        ...base,
        model: config.model,
        chosenBranch: null,
        confidence: null,
        reasoning: null,
        fullResponse: null,
        tentative: true,
        errorMessage: err instanceof Error ? err.message : String(err),
        latencyMs: null,
      });
      throw err;
    }
  };
}
```

- [ ] **Step 5: Create `pipeline/request.ts`**

```ts
import { GraphQLError } from 'graphql';
import type { Pool, PoolClient } from 'pg';
import { loadLLMGateConfig } from '../../llm/llm-gate-client';
import { prewarmMedications } from '../../medications/normalizer';
import type { MedicationInput } from '../../medications/types';
import type { LlmAuditRow } from '../session-store';
import { buildEffectivePatientContext } from '../effective-context';
import { EvaluationError, evaluate } from './evaluate';
import { loadEvaluationEnv } from './load-env';
import type { EvaluationEnv } from './load-env';
import { auditingLlmClient } from './llm-audit';
import { liveObservations } from './observations';
import type { EvaluationResult, EvaluationScope, LlmObservation, ObservationKey, SessionInputs } from './types';

/** What survives a request's retries (D9, C1): acquired observations, and every LLM call made. */
export interface EvaluationRequest {
  requestObservations: Map<ObservationKey, LlmObservation>;
  /** Written once, in the transaction that commits — or after the last failed attempt. */
  audits: LlmAuditRow[];
}

export const newRequest = (): EvaluationRequest => ({ requestObservations: new Map(), audits: [] });

export interface SessionEvaluation {
  env: EvaluationEnv;
  /** The inputs evaluated — with the graph fingerprint pinned when starting. */
  inputs: SessionInputs;
  result: EvaluationResult;
  durationMs: number;
}

/**
 * One evaluation attempt: snapshot (C4), non-blocking pre-warm of what the
 * snapshot could not normalise (D14), and `evaluate` with live observations
 * (C1). `pinGraph` is for a session being created: it adopts the snapshot's
 * graph fingerprint instead of checking against one.
 */
export async function evaluateSession(
  pool: Pool,
  request: EvaluationRequest,
  inputs: SessionInputs,
  scope: EvaluationScope,
  opts: { pinGraph?: boolean } = {},
): Promise<SessionEvaluation> {
  const patient = buildEffectivePatientContext(inputs.initialPatientContext, inputs.additionalContext);
  const env = await loadEvaluationEnv(pool, inputs.pathwayId, { patient });
  prewarmInBackground(pool, env.unnormalized);

  const pinned = opts.pinGraph ? { ...inputs, graphFingerprint: env.graphFingerprint } : inputs;
  const client = auditingLlmClient(loadLLMGateConfig(), inputs.pathwayId, request.audits);
  const provider = liveObservations(pinned.observations, request.requestObservations, client, env.llmModel ?? '');

  const started = Date.now();
  try {
    const result = await evaluate(pinned, env, provider, scope);
    return { env, inputs: pinned, result, durationMs: Date.now() - started };
  } catch (err) {
    if (err instanceof EvaluationError) {
      throw new GraphQLError(err.message, { extensions: { code: err.code } });
    }
    throw err;
  }
}

/** The session's observations plus the request observations this result used — nothing else (spec §4). */
export function persistedObservations(
  inputs: SessionInputs,
  request: EvaluationRequest,
  result: EvaluationResult,
): Map<ObservationKey, LlmObservation> {
  const out = new Map(inputs.observations);
  for (const key of result.observationsUsed) {
    const obs = request.requestObservations.get(key);
    if (obs && !out.has(key)) out.set(key, obs);
  }
  return out;
}

/**
 * Pre-warm after the snapshot, never awaited (C4, D14). RxNav can take seconds
 * per drug; a later mutation sees the rows this writes. Failures are logged:
 * `prewarmMedications` already caches no-match as a NULL row for the admin
 * queue and leaves network errors for the next attempt.
 *
 * The inputs pass through WHOLE. The cache key is text + system + code, so a
 * coded patient medication pre-warmed by its text alone would land in a row
 * evaluation never reads, and its SAFETY_DATA_UNAVAILABLE would never clear.
 */
export function prewarmInBackground(pool: Pool, inputs: MedicationInput[]): void {
  if (inputs.length === 0) return;
  void prewarmMedications(pool, inputs)
    .then(({ succeeded, failed }) => console.info(`[prewarm] ${succeeded} normalised, ${failed} not`))
    .catch((err) => console.warn('[prewarm] failed:', err instanceof Error ? err.message : err));
}

/** Thrown inside a transaction when the revision check matched no row; the caller reloads and retries. */
export class RevisionConflict extends Error {
  constructor() {
    super('revision conflict');
    this.name = 'RevisionConflict';
  }
}

/** One transaction on one client. Any throw — RevisionConflict included — rolls back. */
export async function inTransaction<T>(pool: Pool, fn: (db: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (err) {
    await client.query('ROLLBACK').catch((): void => undefined);
    throw err;
  } finally {
    client.release();
  }
}
```

- [ ] **Step 5b: Keep the whole cache key in `env.unnormalized` (review P1)**

In `pipeline/load-env.ts` (plan 02):

1. In `interface EvaluationEnv`, replace `unnormalized: string[];` and its comment with:

```ts
  /**
   * Medications with no normalised row — WHOLE inputs (text, system, code),
   * one per cache key, for the non-blocking pre-warm. The cache is keyed on
   * all three; a text alone would pre-warm a row evaluation never reads.
   */
  unnormalized: MedicationInput[];
```

2. Replace the `const unnormalized = …` line with:

```ts
    const unnormalized = [
      ...new Map(
        medications.filter((m) => !safety.normalized.has(normalizedKey(m))).map((m) => [normalizedKey(m), m]),
      ).values(),
    ];
```

3. In `__tests__/pipeline-load-env.test.ts`, change
   `expect(env.unnormalized).toEqual(['Mysterydrug', 'Tinidazole']);` to:

```ts
    expect(env.unnormalized).toEqual([
      { text: 'Mysterydrug', system: 'RxNorm', code: '999' },
      { text: 'Tinidazole' },
    ]);
```

`EvaluationEnv.unnormalized` has no other reader. The fixture's `unnormalized: []` is
unaffected.

- [ ] **Step 6: Run the tests (new + plan 02's observation, load-env and acceptance suites) and typecheck**

```bash
npm test --prefix $W/apps/pathway-service -- --runInBand src/__tests__/pipeline-request.test.ts src/__tests__/pipeline-load-env.test.ts src/__tests__/pipeline-observations.test.ts src/__tests__/pipeline-acceptance-a1.test.ts
$W/node_modules/.bin/tsc -p $W/apps/pathway-service/tsconfig.json --noEmit
```
Expected: PASS; typecheck clean.

**Falsify, one at a time, restoring each:**
1. In `persistedObservations`, drop the `for` loop. The `'used'` key disappears and the test
   must fail.
2. In `prewarmInBackground`, send `inputs.map((m) => ({ text: m.text }))`. The *coded patient
   medication* test must fail.

- [ ] **Step 7: Commit**

```bash
git -C $W add apps/pathway-service/src/services/resolution/pipeline/observations.ts apps/pathway-service/src/services/resolution/pipeline/llm-audit.ts apps/pathway-service/src/services/resolution/pipeline/request.ts apps/pathway-service/src/services/resolution/pipeline/load-env.ts apps/pathway-service/src/__tests__/pipeline-request.test.ts apps/pathway-service/src/__tests__/pipeline-load-env.test.ts
git -C $W commit -m "feat(pathway-service): one evaluation attempt with audited LLM calls

evaluateSession loads the snapshot for the effective patient, fires the
non-blocking pre-warm (D14), and evaluates with live observations whose
real LLM calls are each audited. persistedObservations keeps only what the
result used (C1). EvaluationError surfaces with its GraphQL code.

Claude-Session: https://claude.ai/code/session_01XRNkZvQrxmRLNtJHxq71kH"
```

---

### Task 4: `commitEvaluation` and the resolver test harness

**Files:**
- Create: `apps/pathway-service/src/services/resolution/pipeline/commit.ts`
- Create: `apps/pathway-service/src/__tests__/fixtures/resolver-harness.ts`
- Modify: `apps/pathway-service/src/__tests__/fixtures/pipeline-env.ts`
- Test: `apps/pathway-service/src/__tests__/pipeline-commit.test.ts`

**Interfaces:**
- Consumes: Task 2 store functions; Task 3 `evaluateSession`, `newRequest`,
  `persistedObservations`, `inTransaction`, `RevisionConflict`.
- Produces:
  - `MAX_ATTEMPTS = 3`
  - `interface Change { inputs: SessionInputs; event: { eventType: string; triggerData: unknown }; record?: (db: Db, result: EvaluationResult) => Promise<void> }`
  - `commitEvaluation(pool: Pool, sessionId: string, applyChange: (session: ResolutionSession) => Change | Promise<Change>): Promise<ResolutionSession>`
  - `loadSession(pool: Pool, sessionId: string): Promise<ResolutionSession>` (throws `NOT_FOUND`)
  - `assertMutable(session: ResolutionSession): void` (throws `BAD_USER_INPUT` unless ACTIVE/DEGRADED)
  - `statusOf(result: EvaluationResult): SessionStatus`
  - `flushAudits(pool: Pool, sessionId: string, request: EvaluationRequest): Promise<void>`
  - `withAudits<T>(pool: Pool, sessionId: string, request: EvaluationRequest, body: () => Promise<T>): Promise<T>`:
    every exit writes unwritten audit rows (review P2)
  - `conflictError(): GraphQLError` (code `CONFLICT`)
  - Harness: `harness`, `sessionStoreMock()`, `loadEnvMock()` (documented in the file header)
  - Fixture: `edge(s, t, type?, properties?)`; `makeEnv(nodes, edges, safety?, opts?: { signals?; registry?; temporalDefaults? })`

- [ ] **Step 1: Extend the fixture**

In `__tests__/fixtures/pipeline-env.ts`:

1. Replace the `edge` export with:

```ts
export const edge = (s: string, t: string, type = 'HAS_CHILD', properties: Record<string, unknown> = {}): GraphEdge =>
  ({ id: `${s}->${t}`, edgeType: type, sourceId: s, targetId: t, properties });
```

2. Add `import type { PathwayTemporalDefaults } from '../../services/resolution/temporal/cascade';`
   to the imports.
3. Replace the `makeEnv` signature and the fields that depend on its options:

```ts
export interface EnvOptions {
  signals?: SignalDefinition[];
  registry?: ScorerRegistry;
  temporalDefaults?: PathwayTemporalDefaults;
}

export function makeEnv(nodes: GraphNode[], edges: GraphEdge[], safety: Partial<SafetyReference> = {}, opts: EnvOptions = {}): EvaluationEnv {
  const signals = opts.signals ?? [SIGNAL];
  const resolution: ResolutionContext = {
    graphContext: buildGraphContext(nodes, edges),
    edges,
    signals,
    thresholds: { autoResolveThreshold: 0.85, suggestThreshold: 0.6 },
    confidenceEngine: new ConfidenceEngine(opts.registry ?? registry(), new WeightCascadeResolver()),
    codeMap: new Map(),
    temporalDefaults: opts.temporalDefaults ?? {},
  };
  return {
    resolution,
    scoring: {
      adminEvidenceEntries: [],
      weightMatrix: Object.fromEntries(nodes.map((n) => [
        n.nodeIdentifier,
        Object.fromEntries(signals.map((s) => [s.name, { weight: 1, source: WeightSource.SYSTEM_DEFAULT }])),
      ])),
      nodeWeightMap: new Map(),
      propagationOverrides: new Map(),
      thresholds: { autoResolveThreshold: 0.85, suggestThreshold: 0.6, scope: ThresholdScope.SYSTEM_DEFAULT },
    },
    safety: { normalized: new Map(), pairs: new Map(), classRules: [], allergyMappings: [], ...safety },
    graphFingerprint: graphFingerprintOf(resolution),
    envFingerprint: 'env-test',
    llmModel: 'test-model',
    unnormalized: [],
  };
}
```

Every existing caller passes at most three arguments and one signal, so its behaviour is
unchanged.

- [ ] **Step 2: Create the harness**

Create `apps/pathway-service/src/__tests__/fixtures/resolver-harness.ts`:

```ts
/**
 * An in-memory session table and environment registry, so resolver tests run
 * the REAL pipeline — evaluate(), commitEvaluation(), the resolvers — over
 * fixture graphs. Only the database and the snapshot loader are replaced.
 *
 * Wire it into a test file (paths from src/__tests__/; add one '../' from a
 * subdirectory):
 *
 *   jest.mock('../services/resolution/session-store', () =>
 *     require('./fixtures/resolver-harness').sessionStoreMock());
 *   jest.mock('../services/resolution/pipeline/load-env', () =>
 *     require('./fixtures/resolver-harness').loadEnvMock());
 *
 * and call `harness.reset()` in `beforeEach`.
 *
 * Rows are the real `insertColumns` / `evaluationColumns` output after a JSON
 * round trip, read back through the real `rowToSession`, so the JSONB column
 * shapes are exercised rather than bypassed. `BEGIN` / `ROLLBACK` on a client
 * from `harness.pool()` snapshot and restore every table.
 */
import type { Pool } from 'pg';
import type { EvaluationEnv } from '../../services/resolution/pipeline/load-env';
import type { ResolutionSession } from '../../services/resolution/types';

export type Row = Record<string, unknown> & { id: string; revision: number; status: string };
type StatusChange = { nodeId: string; from: string; to: string };

interface Tables {
  rows: Map<string, Row>;
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
  nextId: number;
  beforeWrite: ((row: Row) => void) | null;
  /** What `beforeWrite` changed during the open transaction: another writer's COMMITTED work. */
  externalPatches: Array<{ sessionId: string; patch: Record<string, unknown> }>;
  engineArgs: unknown[][];
}

const emptyTables = (): Tables => ({ rows: new Map(), events: [], nodeOverrides: [], gateAnswers: [], audits: [], carePlanInserts: [] });
const freshState = (): State => ({
  tables: emptyTables(), envs: new Map(), pathways: new Map(), nextId: 1, beforeWrite: null, externalPatches: [], engineArgs: [],
});
let state = freshState();

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const actualStore = (): any => jest.requireActual('../../services/resolution/session-store');
const jsonCopy = <T>(v: T): T => JSON.parse(JSON.stringify(v));

async function poolQuery(sql: string, params: unknown[] = []) {
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
        for (const { sessionId, patch } of state.externalPatches) Object.assign(state.tables.rows.get(sessionId) ?? {}, patch);
        snapshot = null;
        state.externalPatches = [];
        return { rows: [], rowCount: 0 };
      }
      return poolQuery(sql, params);
    }),
    release: jest.fn(),
  };
}

function casTarget(sessionId: string, expectedRevision: number): Row | null {
  const row = state.tables.rows.get(sessionId);
  if (row && state.beforeWrite) {
    const before = structuredClone(row);
    state.beforeWrite(row);
    const patch = Object.fromEntries(
      Object.entries(row).filter(([k, v]) => JSON.stringify(v) !== JSON.stringify(before[k])),
    );
    state.externalPatches.push({ sessionId, patch });
  }
  if (!row || row.revision !== expectedRevision || !['ACTIVE', 'DEGRADED'].includes(row.status)) return null;
  return row;
}

/** The session-store module, with its database functions backed by the harness. */
export function sessionStoreMock() {
  const actual = actualStore();
  const t = () => state.tables;
  return {
    ...actual,
    insertSession: jest.fn(async (_db: unknown, s: { inputs: { temporalContext?: unknown } }) => {
      if (!s.inputs.temporalContext) throw new Error('insertSession requires temporalContext');
      const id = `session-${state.nextId++}`;
      t().rows.set(id, { ...jsonCopy(actual.insertColumns(s)), id, revision: 0, created_at: new Date(), updated_at: new Date() });
      return id;
    }),
    getSession: jest.fn(async (_db: unknown, id: string) => {
      const row = t().rows.get(id);
      return row ? actual.rowToSession(structuredClone(row), t().events.filter((e) => e.sessionId === id)) : null;
    }),
    writeEvaluation: jest.fn(async (_db: unknown, args: { sessionId: string; expectedRevision: number }) => {
      const row = casTarget(args.sessionId, args.expectedRevision);
      if (!row) return false;
      Object.assign(row, jsonCopy(actual.evaluationColumns(args)), { revision: row.revision + 1, updated_at: new Date() });
      return true;
    }),
    writeLifecycleStatus: jest.fn(async (_db: unknown, args: { sessionId: string; expectedRevision: number; status: string }) => {
      const row = casTarget(args.sessionId, args.expectedRevision);
      if (!row) return false;
      Object.assign(row, { status: args.status, revision: row.revision + 1, updated_at: new Date() });
      return true;
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
    getMatchedPathways: jest.fn(async () => []),
  };
}

/** The load-env module, with the snapshot replaced by the environment registered for the pathway. */
export function loadEnvMock() {
  return {
    ...jest.requireActual('../../services/resolution/pipeline/load-env'),
    loadEvaluationEnv: jest.fn(async (_pool: unknown, pathwayId: string) => {
      const env = state.envs.get(pathwayId);
      if (!env) throw new Error(`resolver-harness: no environment registered for pathway "${pathwayId}"`);
      return env;
    }),
  };
}

export const harness = {
  reset(): void {
    state = freshState();
  },
  /** Register a pathway row (for the resolvers' status check) and its evaluation environment. */
  addPathway(id: string, env: EvaluationEnv, opts: { status?: string } = {}): void {
    state.envs.set(id, env);
    state.pathways.set(id, { id, version: '1', status: opts.status ?? 'ACTIVE', title: `Pathway ${id}`, logical_id: `lp-${id}` });
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
  /** For a TraversalEngine subclass installed by a test's jest.mock (see Task 6). */
  recordEngine(args: unknown[]): void {
    state.engineArgs.push(args);
  },
  get engineArgs(): unknown[][] {
    return state.engineArgs;
  },
};
```

- [ ] **Step 3: Write the failing test**

Create `apps/pathway-service/src/__tests__/pipeline-commit.test.ts`:

```ts
jest.mock('../services/resolution/session-store', () => require('./fixtures/resolver-harness').sessionStoreMock());
jest.mock('../services/resolution/pipeline/load-env', () => require('./fixtures/resolver-harness').loadEnvMock());
jest.mock('../services/llm/llm-gate-client', () => ({
  ...jest.requireActual('../services/llm/llm-gate-client'),
  loadLLMGateConfig: () => ({ baseUrl: 'http://llm', apiKey: 'k', model: 'test-model', timeoutMs: 1000 }),
  evaluateGateWithLLM: jest.fn(),
}));

import { GraphQLError } from 'graphql';
import { evaluateGateWithLLM } from '../services/llm/llm-gate-client';
import { commitEvaluation } from '../services/resolution/pipeline/commit';
import { loadEvaluationEnv } from '../services/resolution/pipeline/load-env';
import { evaluateSession, newRequest } from '../services/resolution/pipeline/request';
import { inputsOf, insertSession } from '../services/resolution/session-store';
import { DefaultBehavior, GateType, SessionStatus } from '../services/resolution/types';
import { harness } from './fixtures/resolver-harness';
import { edge, makeEnv, makeInputs, node } from './fixtures/pipeline-env';

const env = makeEnv(
  [
    node('root', 'Pathway'), node('stage', 'Stage'),
    node('gate-llm', 'Gate', {
      gate_type: GateType.LLM_TEXT_ANALYSIS, default_behavior: DefaultBehavior.SKIP, prompt: 'Urgent?',
      input_attribute: 'freeformData.narrative', confidence_threshold: 0.75,
      branches: [{ name: 'urgent', description: 'same day' }, { name: 'routine', description: 'can wait', is_safe_default: true }],
    }),
    node('step', 'Step'), node('lab', 'LabTest'),
  ],
  [edge('root', 'stage'), edge('stage', 'gate-llm'), edge('gate-llm', 'step'), edge('step', 'lab')],
);
const verdict = { chosenBranch: 'urgent', confidence: 0.95, reasoning: 'r', rawResponse: {}, model: 'test-model', latencyMs: 1 };

/** A session whose narrative is `narrative`, stored as a start would store it. */
async function seed(narrative: string): Promise<string> {
  const pool = harness.pool();
  const { inputs, result, durationMs } = await evaluateSession(
    pool, newRequest(), makeInputs(env, { additionalContext: { freeformData: { narrative } } }), 'ROOT',
  );
  return insertSession(pool, { pathwayVersion: '1', patientId: 'p', providerId: 'pr', inputs, result, status: SessionStatus.ACTIVE, durationMs });
}

/** Change the narrative, which changes the observation key. */
const narrate = (narrative: string) => (s: Parameters<typeof inputsOf>[0]) => {
  const inputs = inputsOf(s);
  inputs.additionalContext = { ...inputs.additionalContext, freeformData: { narrative } };
  return { inputs, event: { eventType: 'context_update', triggerData: { addedContext: ['freeformData'] } } };
};

beforeEach(async () => {
  harness.reset();
  harness.addPathway('pw-test', env);
  (evaluateGateWithLLM as jest.Mock).mockReset().mockResolvedValue(verdict);
});

describe('commitEvaluation', () => {
  it('commits inputs, cache, event, used observations and audit rows under one revision', async () => {
    const id = await seed('mild cough');
    (evaluateGateWithLLM as jest.Mock).mockClear();

    const session = await commitEvaluation(harness.pool(), id, narrate('crushing chest pain'));

    expect(session.revision).toBe(1);
    expect(session.additionalContext).toEqual({ freeformData: { narrative: 'crushing chest pain' } });
    expect(session.resolutionState.get('gate-llm')!.status).toBe('INCLUDED');
    expect(session.observations.size).toBe(1);
    expect([...session.observations.values()][0]).toMatchObject({ gateId: 'gate-llm', chosenBranch: 'urgent' });
    expect(harness.tables.events).toEqual([expect.objectContaining({ sessionId: id, eventType: 'context_update' })]);
    expect(harness.tables.audits).toEqual([{ sessionId: id, gateId: 'gate-llm', errorMessage: null }]);
  });

  it('retries after losing a revision race and calls the LLM once across attempts (A1)', async () => {
    const id = await seed('mild cough');
    (evaluateGateWithLLM as jest.Mock).mockClear();
    (loadEvaluationEnv as jest.Mock).mockClear();
    harness.loseNextRaces(1);

    const session = await commitEvaluation(harness.pool(), id, narrate('crushing chest pain'));

    expect(loadEvaluationEnv).toHaveBeenCalledTimes(2);
    expect(evaluateGateWithLLM).toHaveBeenCalledTimes(1);
    expect(session.revision).toBe(2); // one bump by the "other writer", one by this commit
    expect(harness.tables.audits).toHaveLength(1);
  });

  it('calls the LLM again when the context changed between attempts', async () => {
    const id = await seed('mild cough');
    (evaluateGateWithLLM as jest.Mock).mockClear();
    let raced = false;
    harness.onBeforeWrite((row) => {
      if (raced) return;
      raced = true;
      row.revision += 1;
      row.additional_context = { freeformData: { narrative: 'syncope' } };
    });

    // The change reads the reloaded session, so attempt 2 evaluates the other writer's narrative.
    await commitEvaluation(harness.pool(), id, (s) => ({
      inputs: inputsOf(s), event: { eventType: 'context_update', triggerData: {} },
    }));

    expect(evaluateGateWithLLM).toHaveBeenCalledTimes(2);
    expect((evaluateGateWithLLM as jest.Mock).mock.calls.map((c) => c[0].narrative)).toEqual(['mild cough', 'syncope']);
  });

  it('throws CONFLICT after three lost races and still writes the audit rows', async () => {
    const id = await seed('mild cough');
    const before = structuredClone(harness.row(id));
    harness.onBeforeWrite((row) => { row.revision += 1; });

    await expect(commitEvaluation(harness.pool(), id, narrate('crushing chest pain')))
      .rejects.toMatchObject({ extensions: { code: 'CONFLICT' } });

    expect(harness.row(id).additional_context).toEqual(before.additional_context);
    expect(harness.tables.events).toEqual([]);
    expect(harness.tables.audits).toEqual([{ sessionId: id, gateId: 'gate-llm', errorMessage: null }]);
  });

  it('writes the audit rows of an earlier attempt when a later attempt finds the session completed (review P2)', async () => {
    const id = await seed('mild cough');
    harness.onBeforeWrite((row) => {
      if (row.status !== 'ACTIVE') return;
      row.revision += 1;
      row.status = 'COMPLETED'; // a concurrent generation claimed it
    });

    await expect(commitEvaluation(harness.pool(), id, narrate('crushing chest pain')))
      .rejects.toThrow('Cannot modify session with status "COMPLETED"');

    expect(harness.tables.audits).toEqual([{ sessionId: id, gateId: 'gate-llm', errorMessage: null }]);
  });

  it('writes the audit rows of an earlier attempt when a later attempt is rejected at the boundary (review P2)', async () => {
    const id = await seed('mild cough');
    harness.loseNextRaces(1);
    let attempts = 0;

    await expect(commitEvaluation(harness.pool(), id, (s) => {
      attempts += 1;
      if (attempts === 2) throw new GraphQLError('the node is gone', { extensions: { code: 'NOT_FOUND' } });
      return narrate('crushing chest pain')(s);
    })).rejects.toThrow('the node is gone');

    expect(harness.tables.audits).toEqual([{ sessionId: id, gateId: 'gate-llm', errorMessage: null }]);
  });

  it('a boundary error is not retried and writes nothing', async () => {
    const id = await seed('mild cough');
    (loadEvaluationEnv as jest.Mock).mockClear();

    await expect(commitEvaluation(harness.pool(), id, () => {
      throw new GraphQLError('bad answer', { extensions: { code: 'BAD_USER_INPUT' } });
    })).rejects.toThrow('bad answer');

    expect(loadEvaluationEnv).not.toHaveBeenCalled();
    expect(harness.row(id).revision).toBe(0);
  });

  it('refuses a session that is not ACTIVE or DEGRADED, before evaluating', async () => {
    const id = await seed('mild cough');
    harness.row(id).status = 'COMPLETED';
    await expect(commitEvaluation(harness.pool(), id, narrate('x'))).rejects.toThrow('Cannot modify session with status "COMPLETED"');
  });

  it('refuses an unknown session', async () => {
    await expect(commitEvaluation(harness.pool(), 'nope', narrate('x'))).rejects.toMatchObject({ extensions: { code: 'NOT_FOUND' } });
  });
});
```

- [ ] **Step 4: Run it to verify it fails**

Run: `npm test --prefix $W/apps/pathway-service -- --runInBand src/__tests__/pipeline-commit.test.ts`
Expected: FAIL with `Cannot find module '../services/resolution/pipeline/commit'`.

- [ ] **Step 5: Create `pipeline/commit.ts`**

```ts
import { GraphQLError } from 'graphql';
import type { Pool } from 'pg';
import { getSession, logEvent, statusChangesBetween, writeEvaluation, writeLlmAudits } from '../session-store';
import type { Db } from '../session-store';
import { ResolutionSession, SessionStatus } from '../types';
import { EvaluationRequest, evaluateSession, inTransaction, newRequest, persistedObservations, RevisionConflict } from './request';
import type { EvaluationResult, SessionInputs } from './types';

/** Server-side retries on a revision conflict (D9). */
export const MAX_ATTEMPTS = 3;

/** What a mutation contributes to a commit: new inputs, the audit event, analytics rows. */
export interface Change {
  inputs: SessionInputs;
  event: { eventType: string; triggerData: unknown };
  /** Written in the same transaction as the result. */
  record?: (db: Db, result: EvaluationResult) => Promise<void>;
}

export async function loadSession(pool: Pool, sessionId: string): Promise<ResolutionSession> {
  const session = await getSession(pool, sessionId);
  if (!session) throw new GraphQLError('Session not found', { extensions: { code: 'NOT_FOUND' } });
  return session;
}

export function assertMutable(session: ResolutionSession): void {
  if (session.status !== SessionStatus.ACTIVE && session.status !== SessionStatus.DEGRADED) {
    throw new GraphQLError(`Cannot modify session with status "${session.status}"`, {
      extensions: { code: 'BAD_USER_INPUT' },
    });
  }
}

export const statusOf = (result: EvaluationResult): SessionStatus =>
  result.status === 'DEGRADED' ? SessionStatus.DEGRADED : SessionStatus.ACTIVE;

export const conflictError = (): GraphQLError =>
  new GraphQLError(`Session changed concurrently on ${MAX_ATTEMPTS} attempts; reload and retry`, {
    extensions: { code: 'CONFLICT' },
  });

/** Audit rows of calls whose attempt did not commit (spec §4, best effort). */
export async function flushAudits(pool: Pool, sessionId: string, request: EvaluationRequest): Promise<void> {
  if (request.audits.length === 0) return;
  await inTransaction(pool, (db) => writeLlmAudits(db, sessionId, request.audits));
  request.audits.length = 0;
}

/**
 * Run a request's attempts. However they end — committed, out of retries, a
 * later attempt rejected at the boundary, the session completed or abandoned
 * underneath, an evaluation or database error — the audit rows of LLM calls
 * no committed transaction wrote are written in their own (spec §4, Audit).
 * After a winning commit there are none left, so this is a no-op. A failure to
 * write them is logged and never masks the request's own outcome.
 */
export async function withAudits<T>(
  pool: Pool,
  sessionId: string,
  request: EvaluationRequest,
  body: () => Promise<T>,
): Promise<T> {
  try {
    return await body();
  } finally {
    await flushAudits(pool, sessionId, request).catch((err) =>
      console.error(`[audit] could not write ${request.audits.length} LLM audit rows for session ${sessionId}:`, err),
    );
  }
}

/**
 * The one write path (spec §4). Each attempt reloads the session, asks the
 * mutation for its change (boundary validation throws here and is never
 * retried), evaluates from scratch, and commits under the revision it read.
 * Observations acquired by an earlier attempt are reused while their keys
 * still match (D9). Audit rows go out with the winning commit; `withAudits`
 * writes them on every other exit.
 */
export async function commitEvaluation(
  pool: Pool,
  sessionId: string,
  applyChange: (session: ResolutionSession) => Change | Promise<Change>,
): Promise<ResolutionSession> {
  const request = newRequest();
  return withAudits(pool, sessionId, request, async () => {
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const session = await loadSession(pool, sessionId);
      assertMutable(session);
      const change = await applyChange(session);
      const { inputs, result, durationMs } = await evaluateSession(pool, request, change.inputs, 'ROOT');

      try {
        await inTransaction(pool, async (db) => {
          const written = await writeEvaluation(db, {
            sessionId,
            expectedRevision: session.revision,
            inputs: { ...inputs, observations: persistedObservations(inputs, request, result) },
            result,
            status: statusOf(result),
            durationMs,
          });
          if (!written) throw new RevisionConflict();
          await logEvent(db, sessionId, {
            ...change.event,
            nodesRecomputed: result.resolutionState.size,
            statusChanges: statusChangesBetween(session.resolutionState, result.resolutionState),
          });
          await change.record?.(db, result);
          await writeLlmAudits(db, sessionId, request.audits);
        });
      } catch (err) {
        if (err instanceof RevisionConflict) continue;
        throw err;
      }
      request.audits.length = 0;
      return loadSession(pool, sessionId);
    }
    throw conflictError();
  });
}
```

- [ ] **Step 6: Run the tests and typecheck**

```bash
npm test --prefix $W/apps/pathway-service -- --runInBand src/__tests__/pipeline-commit.test.ts src/__tests__/pipeline-acceptance-a1.test.ts src/__tests__/pipeline-acceptance-a2.test.ts src/__tests__/pipeline-properties.test.ts
$W/node_modules/.bin/tsc -p $W/apps/pathway-service/tsconfig.json --noEmit
```
Expected: PASS; typecheck clean. The plan 02 suites confirm that the fixture change is
behaviour-preserving.

**Falsify, one at a time, restoring each:**
1. In `commitEvaluation`, move `const request = newRequest();` inside the `for` loop. The A1
   retry test must fail with 2 LLM calls.
2. In `withAudits`, delete the `finally` block's `flushAudits` call. The CONFLICT test and both
   *writes the audit rows … when a later attempt …* tests must fail.

- [ ] **Step 7: Commit**

```bash
git -C $W add apps/pathway-service/src/services/resolution/pipeline/commit.ts apps/pathway-service/src/__tests__/fixtures/resolver-harness.ts apps/pathway-service/src/__tests__/fixtures/pipeline-env.ts apps/pathway-service/src/__tests__/pipeline-commit.test.ts
git -C $W commit -m "feat(pathway-service): commitEvaluation, the single write path

Each attempt reloads, applies the mutation's change, evaluates from
scratch and commits under the revision it read; three attempts, then
CONFLICT (D9). Request observations survive retries, and every LLM call's
audit row is written with the winning commit or on exhaustion. Adds an
in-memory resolver harness that runs the real pipeline over fixtures.

Claude-Session: https://claude.ai/code/session_01XRNkZvQrxmRLNtJHxq71kH"
```

---

### Task 5: API surface — blocker scope, node layers, session revision and hash

**Files:**
- Modify: `apps/pathway-service/schema.graphql`
- Modify: `apps/pathway-service/src/types/index.ts` (`BlockerType`)
- Modify: `apps/pathway-service/src/resolvers/Query.ts` (`formatNodeForGraphQL`, `formatSessionForGraphQL`)
- Regenerate: `apps/pathway-service/src/__generated__/resolvers-types.ts`
- Test: `apps/pathway-service/src/__tests__/pipeline-sdl.test.ts`

This task is additive. The generation argument and the removal of `answerGateQuestion` land
with the resolvers in Task 6.

**Interfaces:**
- Produces:
  - SDL `enum BlockerScope { COMPLETENESS OUTPUT }`.
  - SDL `enum WithheldBy { SAFETY CONFLICT }`.
  - `BlockerType` gains `SAFETY_DATA_UNAVAILABLE`, `UNRESOLVED_CONFLICT`,
    `STALE_CONFLICT_DECISION` and `PLAN_CHANGED_SINCE_REVIEW`.
  - `ValidationBlockerType` gains `scope: BlockerScope!` and `pathwayId: ID`.
  - `ResolvedNode` gains `eligibilityStatus: NodeStatus!` and `withheldBy: WithheldBy`.
  - `ResolutionSession` gains `revision: Int!`, `resultHash: String!` and
    `envFingerprint: String!`.

- [ ] **Step 1: Write the failing test**

Create `apps/pathway-service/src/__tests__/pipeline-sdl.test.ts`:

```ts
import { readFileSync } from 'fs';
import { join } from 'path';
import { EnumTypeDefinitionNode, ObjectTypeDefinitionNode, parse, print } from 'graphql';
import { formatSessionForGraphQL } from '../resolvers/Query';
import { NodeStatus } from '../services/resolution/types';

const SDL = parse(readFileSync(join(__dirname, '../../schema.graphql'), 'utf-8'));
const objectType = (name: string) =>
  SDL.definitions.find((d) => d.kind === 'ObjectTypeDefinition' && d.name.value === name) as ObjectTypeDefinitionNode;
const fieldType = (type: string, field: string) => {
  const f = objectType(type).fields?.find((x) => x.name.value === field);
  return f ? print(f.type) : undefined;
};
const enumValues = (name: string) =>
  (SDL.definitions.find((d) => d.kind === 'EnumTypeDefinition' && d.name.value === name) as EnumTypeDefinitionNode)
    .values!.map((v) => v.name.value);

describe('evaluation pipeline API surface (spec §4)', () => {
  it('exposes revision, resultHash and envFingerprint on ResolutionSession', () => {
    expect(fieldType('ResolutionSession', 'revision')).toBe('Int!');
    expect(fieldType('ResolutionSession', 'resultHash')).toBe('String!');
    expect(fieldType('ResolutionSession', 'envFingerprint')).toBe('String!');
  });

  it('exposes both node layers (C2)', () => {
    expect(fieldType('ResolvedNode', 'eligibilityStatus')).toBe('NodeStatus!');
    expect(fieldType('ResolvedNode', 'withheldBy')).toBe('WithheldBy');
    expect(enumValues('WithheldBy')).toEqual(['SAFETY', 'CONFLICT']);
  });

  it('scopes blockers and names the new blocker types (C3)', () => {
    expect(fieldType('ValidationBlockerType', 'scope')).toBe('BlockerScope!');
    expect(fieldType('ValidationBlockerType', 'pathwayId')).toBe('ID');
    expect(enumValues('BlockerScope')).toEqual(['COMPLETENESS', 'OUTPUT']);
    expect(enumValues('BlockerType')).toEqual(expect.arrayContaining([
      'SAFETY_DATA_UNAVAILABLE', 'UNRESOLVED_CONFLICT', 'STALE_CONFLICT_DECISION', 'PLAN_CHANGED_SINCE_REVIEW',
    ]));
  });

  it('formatSessionForGraphQL maps the layers and the session fields', () => {
    const node = (nodeId: string, extra: Record<string, unknown>) => ({
      nodeId, nodeType: 'Medication', title: nodeId, confidence: 0.9, confidenceBreakdown: [], depth: 1, ...extra,
    });
    const formatted = formatSessionForGraphQL({
      id: 's', pathwayId: 'p', pathwayVersion: '1', patientId: 'pt', providerId: 'pr', status: 'ACTIVE',
      revision: 3, resultHash: 'h', envFingerprint: 'e',
      resolutionState: new Map([
        ['withheld', node('withheld', {
          status: NodeStatus.EXCLUDED,
          eligibility: { status: NodeStatus.INCLUDED, decidedBy: 'traversal' },
          disposition: { status: NodeStatus.EXCLUDED, withheldBy: 'safety' },
        })],
        ['plain', node('plain', { status: NodeStatus.INCLUDED })],
      ]),
      pendingQuestions: [], redFlags: [], resolutionEvents: [], ddiWarnings: [],
      totalNodesEvaluated: 2, traversalDurationMs: 1,
    } as never);

    expect(formatted).toMatchObject({ revision: 3, resultHash: 'h', envFingerprint: 'e' });
    expect(formatted.excludedNodes[0]).toMatchObject({ nodeId: 'withheld', status: 'EXCLUDED', eligibilityStatus: 'INCLUDED', withheldBy: 'SAFETY' });
    expect(formatted.includedNodes[0]).toMatchObject({ nodeId: 'plain', eligibilityStatus: 'INCLUDED', withheldBy: null });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test --prefix $W/apps/pathway-service -- --runInBand src/__tests__/pipeline-sdl.test.ts`
Expected: FAIL. `revision` is `undefined`, and there is no `WithheldBy` enum.

- [ ] **Step 3: Edit the SDL**

In `apps/pathway-service/schema.graphql`:

1. Replace the line
   `enum BlockerType { EMPTY_PLAN UNRESOLVED_RED_FLAG CONTRADICTION PENDING_GATE INCOMPLETE_RESOLUTION }`
   with:

```graphql
enum BlockerType { EMPTY_PLAN UNRESOLVED_RED_FLAG CONTRADICTION PENDING_GATE INCOMPLETE_RESOLUTION SAFETY_DATA_UNAVAILABLE UNRESOLVED_CONFLICT STALE_CONFLICT_DECISION PLAN_CHANGED_SINCE_REVIEW }
"""COMPLETENESS blockers come from every evaluation; OUTPUT blockers only from the root (spec C3)."""
enum BlockerScope { COMPLETENESS OUTPUT }
"""Why an eligible node is not in the plan (spec C2)."""
enum WithheldBy { SAFETY CONFLICT }
```

2. In `type ResolutionSession`, directly after `status: SessionStatus!`, add:

```graphql
  """Optimistic-lock counter; increments on every committed write."""
  revision: Int!
  """Hash of exactly what a provider reviews (spec §1 rule 8). Pass it to generateCarePlanFromResolution."""
  resultHash: String!
  """Fingerprint of the configuration snapshot the current result was evaluated under."""
  envFingerprint: String!
```

3. In `type ResolvedNode`, directly after `status: NodeStatus!`, add:

```graphql
  """What the pathway decided about this node. Differs from status only when the node is withheld."""
  eligibilityStatus: NodeStatus!
  """Set when the node is eligible but withheld from the plan."""
  withheldBy: WithheldBy
```

4. Replace `type ValidationBlockerType { … }` with:

```graphql
type ValidationBlockerType {
  scope: BlockerScope!
  type: BlockerType!
  description: String!
  relatedNodeIds: [ID!]!
  """Set on a blocker a multi-pathway run propagates from one of its pathways."""
  pathwayId: ID
}
```

- [ ] **Step 4: Extend `BlockerType`**

In `src/types/index.ts`, inside `export enum BlockerType {`, after
`INCOMPLETE_RESOLUTION = 'INCOMPLETE_RESOLUTION',`, add:

```ts
  /** An eligible or patient medication could not be normalised, so it was never safety-checked (D14). */
  SAFETY_DATA_UNAVAILABLE = 'SAFETY_DATA_UNAVAILABLE',
  /** Multi-pathway: a clinical-role conflict with no decision (plan 04). */
  UNRESOLVED_CONFLICT = 'UNRESOLVED_CONFLICT',
  /** Multi-pathway: a decision whose chosen pathway is no longer a candidate (plan 04). */
  STALE_CONFLICT_DECISION = 'STALE_CONFLICT_DECISION',
  /** Generation: the plan changed after the provider reviewed it (D7). */
  PLAN_CHANGED_SINCE_REVIEW = 'PLAN_CHANGED_SINCE_REVIEW',
```

- [ ] **Step 5: Format the new fields**

In `resolvers/Query.ts`:

1. In `formatNodeForGraphQL`, directly after `status: node.status,`, add:

```ts
    eligibilityStatus: node.eligibility?.status ?? node.status,
    withheldBy: node.disposition?.withheldBy ? node.disposition.withheldBy.toUpperCase() : null,
```

2. In `formatSessionForGraphQL`, directly after `status: session.status,`, add:

```ts
    revision: session.revision,
    resultHash: session.resultHash,
    envFingerprint: session.envFingerprint,
```

- [ ] **Step 6: Regenerate types, run the tests, typecheck**

```bash
npm run codegen --prefix $W/apps/pathway-service
npm test --prefix $W/apps/pathway-service -- --runInBand src/__tests__/pipeline-sdl.test.ts src/__tests__/pending-question-schema-parity.test.ts
$W/node_modules/.bin/tsc -p $W/apps/pathway-service/tsconfig.json --noEmit
```
Expected: PASS; typecheck clean.

**Falsify:** in `formatNodeForGraphQL`, replace `node.eligibility?.status ?? node.status` with
`node.status`. The `withheld` node's `eligibilityStatus` becomes `EXCLUDED`, and the test must
fail. Restore it.

- [ ] **Step 7: Commit**

```bash
git -C $W add apps/pathway-service/schema.graphql apps/pathway-service/src/types/index.ts apps/pathway-service/src/resolvers/Query.ts apps/pathway-service/src/__generated__/resolvers-types.ts apps/pathway-service/src/__tests__/pipeline-sdl.test.ts
git -C $W commit -m "feat(pathway-service): expose blocker scope, node layers and session revision

Blockers carry COMPLETENESS/OUTPUT scope and the new blocker types; nodes
expose eligibilityStatus and withheldBy beside status (C2); sessions expose
revision, resultHash and envFingerprint (spec §4, API changes).

Claude-Session: https://claude.ai/code/session_01XRNkZvQrxmRLNtJHxq71kH"
```

---

### Task 6: Single-pathway mutations on the pipeline

**Files:**
- Rewrite: `apps/pathway-service/src/resolvers/mutations/resolution.ts`
- Modify: `apps/pathway-service/schema.graphql` (generation argument; remove `answerGateQuestion`)
- Regenerate: `apps/pathway-service/src/__generated__/resolvers-types.ts`
- Create (tests):
  - `apps/pathway-service/src/__tests__/pipeline-resolver-mutations.test.ts`
  - `apps/pathway-service/src/__tests__/pipeline-resolver-generation.test.ts`
  - `apps/pathway-service/src/__tests__/pipeline-resolver-temporal.test.ts`
- Rewrite (test): `apps/pathway-service/src/__tests__/temporal/v1-traversal-behavior.test.ts`
- Modify (tests):
  - `temporal/resolution-input-contract.test.ts`
  - `temporal/resolution-fact-store-wiring.test.ts`
  - `pipeline-sdl.test.ts`
- Delete (tests; see *Appendix A*):
  - `answer-pending-decision.test.ts`
  - `answer-routing-mutation.test.ts`
  - `ddi-refresh.test.ts`
  - `escalated-answer-injection.test.ts`
  - `generation-transaction.test.ts`
  - `resolution-retraversal-context.test.ts`
  - `decision-point-context-dependency.test.ts`
  - `temporal/retraversal-clock-reuse.test.ts`
  - `temporal/pathway-defaults-threading.test.ts`

This task is large because the resolvers and every test that mocks their old seams must move
together: the suite is green only at the end of the task. Do the steps in order.

**Interfaces:**
- Consumes: Task 2 store; Task 3 `evaluateSession`, `newRequest`, `persistedObservations`,
  `inTransaction`, `RevisionConflict`; Task 4 `commitEvaluation`, `loadSession`,
  `assertMutable`, `statusOf`, `withAudits`, `conflictError`, `MAX_ATTEMPTS`, `Change`, and
  the harness.
- Produces (GraphQL):
  - `generateCarePlanFromResolution(sessionId: ID!, reviewedResultHash: String!)`;
  - `answerGateQuestion` is removed;
  - the other signatures are unchanged.
- Keeps exporting, because multi-pathway code imports them: `PatientContextArgs`,
  `TemporalAnchorArgs`, `toPatientContext`, `temporalInputFrom`, `GateAnswerInput` and
  `AdditionalContextInput`.

- [ ] **Step 1: Write the mutation tests**

Create `apps/pathway-service/src/__tests__/pipeline-resolver-mutations.test.ts`:

```ts
/**
 * The single-pathway mutations over the REAL pipeline: fixture graphs, the
 * real evaluate(), commitEvaluation() and resolvers; only the table and the
 * snapshot loader are in memory (fixtures/resolver-harness).
 */
jest.mock('../services/resolution/session-store', () => require('./fixtures/resolver-harness').sessionStoreMock());
jest.mock('../services/resolution/pipeline/load-env', () => require('./fixtures/resolver-harness').loadEnvMock());

import { resolutionMutations } from '../resolvers/mutations/resolution';
import { AnswerType, DefaultBehavior, GateType, NodeStatus, OverrideAction } from '../services/resolution/types';
import { harness } from './fixtures/resolver-harness';
import { edge, makeEnv, node } from './fixtures/pipeline-env';

const PINNED = '2026-08-30T12:00:00.000Z';
const AMOX = { ingredientRxcui: '723', ingredientName: 'amoxicillin', atcClasses: ['J01CA04'] };
const WARFARIN = { ingredientRxcui: '11289', ingredientName: 'warfarin', atcClasses: ['B01AA03'] };
const SAFETY = {
  normalized: new Map([['amoxicillin||', AMOX], ['warfarin||', WARFARIN]]),
  allergyMappings: [{ snomedCode: '91936005', snomedDisplay: 'Allergy to penicillin', atcClass: 'J01C' }],
};
const PENICILLIN = { code: '91936005', system: 'SNOMED', display: 'Allergy to penicillin' };

/** "Symptomatic?" routes yes → Treat (amoxicillin, and a weak warfarin), no → Reassure (a lab). */
const ROUTING = makeEnv(
  [
    node('root', 'Pathway'), node('stage', 'Stage'),
    node('gate-b', 'Gate', { title: 'Symptomatic?', gate_type: GateType.QUESTION, default_behavior: DefaultBehavior.SKIP, answer_type: AnswerType.BOOLEAN, prompt: 'Symptomatic?' }),
    node('step-yes', 'Step', { title: 'Treat' }), node('step-no', 'Step', { title: 'Reassure' }),
    node('med-amox', 'Medication', { name: 'Amoxicillin' }),
    node('med-weak', 'Medication', { name: 'Warfarin', score: 0.1 }),
    node('lab', 'LabTest'),
  ],
  [
    edge('root', 'stage'), edge('stage', 'gate-b', 'HAS_GATE'),
    edge('gate-b', 'step-yes', 'BRANCHES_TO', { when: { equals: true } }),
    edge('gate-b', 'step-no', 'BRANCHES_TO', { when: { equals: false } }),
    edge('step-yes', 'med-amox'), edge('step-yes', 'med-weak'), edge('step-no', 'lab'),
  ],
  SAFETY,
);

/** A one_of fork where step-a and step-b both qualify, so the fork pends. */
const FORK = makeEnv(
  [
    node('root', 'Pathway'),
    node('dp-1', 'DecisionPoint', { title: 'Which treatment?', branch_mode: 'one_of' }),
    node('step-a', 'Step', { title: 'Treat A' }), node('step-b', 'Step', { title: 'Treat B' }),
    node('step-c', 'Step', { title: 'Treat C', score: 0.2 }),
  ],
  [
    edge('root', 'dp-1', 'HAS_DECISION_POINT'),
    edge('dp-1', 'step-a', 'BRANCHES_TO'), edge('dp-1', 'step-b', 'BRANCHES_TO'), edge('dp-1', 'step-c', 'BRANCHES_TO'),
  ],
);

/** Two gates on ONE haemoglobin, at different thresholds; with no lab both escalate (v1). */
const HAEMOGLOBIN = makeEnv(
  [
    node('root', 'Pathway'),
    node('gate-anaemic', 'Gate', { gate_type: GateType.PATIENT_ATTRIBUTE, default_behavior: DefaultBehavior.SKIP,
      condition: { field: 'labs', operator: 'less_than', value: '718-7', system: 'LOINC', threshold: 11 } }),
    node('gate-severe', 'Gate', { gate_type: GateType.PATIENT_ATTRIBUTE, default_behavior: DefaultBehavior.SKIP,
      condition: { field: 'labs', operator: 'less_than', value: '718-7', system: 'LOINC', threshold: 7 } }),
    node('step-oral-iron', 'Step'), node('step-transfuse', 'Step'),
  ],
  [edge('root', 'gate-anaemic'), edge('root', 'gate-severe'), edge('gate-anaemic', 'step-oral-iron'), edge('gate-severe', 'step-transfuse')],
);

async function start(pathwayId: string, patient: Record<string, unknown> = {}, version = 'legacy-v0'): Promise<string> {
  const s = await resolutionMutations.startResolution(null as never, {
    pathwayId, patientId: 'pt-1', resolutionMode: 'SYNTHETIC', evaluationAsOf: PINNED,
    patientContext: { patientId: 'pt-1', conditionCodes: [], medications: [], allergies: [], labResults: [], ...patient },
  } as never, harness.context({ temporalPolicyVersion: version }));
  return (s as { id: string }).id;
}
const ctx = (version = 'legacy-v0') => harness.context({ temporalPolicyVersion: version });
const answer = (sessionId: string, nodeId: string, a: Record<string, unknown>, version?: string) =>
  resolutionMutations.answerPendingDecision(null, { sessionId, nodeId, answer: a }, ctx(version));
const status = (id: string, nodeId: string) => harness.session(id).resolutionState.get(nodeId)?.status;

beforeEach(() => {
  harness.reset();
  harness.addPathway('pw-route', ROUTING);
  harness.addPathway('pw-fork', FORK);
  harness.addPathway('pw-hb', HAEMOGLOBIN);
});

describe('startResolution', () => {
  it('stores the inputs, the graph fingerprint and the evaluated cache', async () => {
    const id = await start('pw-route');
    const s = harness.session(id);
    expect(s.revision).toBe(0);
    expect(s.graphFingerprint).toBe(ROUTING.graphFingerprint);
    expect(s.envFingerprint).toBe('env-test');
    expect(s.resultHash).toMatch(/^[0-9a-f]{64}$/);
    expect(s.pendingQuestions.map((q) => q.gateId)).toEqual(['gate-b']);
    expect(s.readiness.blockers).toContainEqual(expect.objectContaining({ type: 'PENDING_GATE', relatedNodeIds: ['gate-b'] }));
    expect(harness.tables.events).toEqual([expect.objectContaining({ sessionId: id, eventType: 'traversal_complete' })]);
  });

  it('refuses an empty graph without storing a session', async () => {
    harness.addPathway('pw-empty', makeEnv([], []));
    await expect(start('pw-empty')).rejects.toThrow('Pathway graph is empty');
    expect(harness.rowCount()).toBe(0);
  });

  it('refuses a pathway that is not ACTIVE', async () => {
    harness.addPathway('pw-draft', ROUTING, { status: 'DRAFT' });
    await expect(start('pw-draft')).rejects.toThrow(/not ACTIVE/);
  });
});

describe('answerPendingDecision — a question gate', () => {
  it.each([
    [true, 'step-yes', 'step-no'],
    [false, 'step-no', 'step-yes'],
  ])('routes %s to its branch and clears the question', async (value, taken, closed) => {
    const id = await start('pw-route');
    await answer(id, 'gate-b', { booleanValue: value });

    expect(status(id, taken)).toBe(NodeStatus.INCLUDED);
    expect(status(id, closed)).not.toBe(NodeStatus.INCLUDED);
    expect(harness.session(id).pendingQuestions).toEqual([]);
    expect(harness.session(id).gateAnswers.get('gate-b')).toEqual({ booleanValue: value });
    expect(harness.tables.gateAnswers).toEqual([expect.objectContaining({ gateId: 'gate-b' })]);
  });

  it.each([
    [{ selectedOption: 'true' }],
    [{}],
    [{ booleanValue: true, numericValue: 1 }],
  ])('rejects an answer the gate does not accept: %j', async (a) => {
    const id = await start('pw-route');
    await expect(answer(id, 'gate-b', a)).rejects.toThrow(/Gate "gate-b"/);
    expect(harness.row(id).revision).toBe(0);
  });

  it('records statusChanges as the diff against the previous cache, in nodeId order', async () => {
    const id = await start('pw-route');
    await answer(id, 'gate-b', { booleanValue: true });
    const changes = harness.tables.events.find((e) => e.eventType === 'gate_answer')!.statusChanges;
    expect(changes).toContainEqual(expect.objectContaining({ nodeId: 'step-yes', to: 'INCLUDED' }));
    const ids = changes.map((c) => c.nodeId);
    expect(ids).toEqual([...ids].sort());
  });
});

describe('overrideNode', () => {
  it('an INCLUDE override brings a below-threshold medication in, and holds on every later evaluation', async () => {
    const id = await start('pw-route');
    await answer(id, 'gate-b', { booleanValue: true });
    expect(status(id, 'med-weak')).toBe(NodeStatus.EXCLUDED);

    await resolutionMutations.overrideNode(null, { sessionId: id, nodeId: 'med-weak', action: OverrideAction.INCLUDE, reason: 'clinician' }, ctx());
    expect(status(id, 'med-weak')).toBe(NodeStatus.INCLUDED);
    expect(harness.session(id).resolutionState.get('med-weak')!.eligibility).toMatchObject({ decidedBy: 'override' });

    await resolutionMutations.addPatientContext(null, { sessionId: id, additionalContext: { conditionCodes: [{ code: 'I10', system: 'ICD-10' }] } }, ctx());
    expect(status(id, 'med-weak')).toBe(NodeStatus.INCLUDED);
    expect(harness.tables.nodeOverrides).toEqual([expect.objectContaining({ nodeId: 'med-weak', originalStatus: 'EXCLUDED' })]);
  });

  it('keeps the pathway’s original decision across re-overrides', async () => {
    const id = await start('pw-route');
    await answer(id, 'gate-b', { booleanValue: true });
    await resolutionMutations.overrideNode(null, { sessionId: id, nodeId: 'med-weak', action: OverrideAction.INCLUDE }, ctx());
    await resolutionMutations.overrideNode(null, { sessionId: id, nodeId: 'med-weak', action: OverrideAction.EXCLUDE }, ctx());
    expect(harness.session(id).providerOverrides.get('med-weak')).toMatchObject({ action: 'EXCLUDE', originalStatus: 'EXCLUDED' });
  });

  it('an overridden medication is still suppressed by a patient allergy (D4)', async () => {
    const id = await start('pw-route', { allergies: [PENICILLIN] });
    await answer(id, 'gate-b', { booleanValue: true });
    await resolutionMutations.overrideNode(null, { sessionId: id, nodeId: 'med-amox', action: OverrideAction.INCLUDE }, ctx());

    const med = harness.session(id).resolutionState.get('med-amox')!;
    expect(med.eligibility).toMatchObject({ status: NodeStatus.INCLUDED, decidedBy: 'override' });
    expect(med.disposition).toMatchObject({ status: NodeStatus.EXCLUDED, withheldBy: 'safety' });
  });

  it('refuses a node the session does not hold', async () => {
    const id = await start('pw-route');
    await expect(resolutionMutations.overrideNode(null, { sessionId: id, nodeId: 'nope', action: OverrideAction.INCLUDE }, ctx()))
      .rejects.toMatchObject({ extensions: { code: 'NOT_FOUND' } });
  });
});

describe('answerPendingDecision — a branch choice at a DecisionPoint', () => {
  it('takes the chosen branch and excludes the others', async () => {
    const id = await start('pw-fork');
    expect(status(id, 'dp-1')).toBe(NodeStatus.PENDING_QUESTION);
    expect(harness.session(id).pendingQuestions[0].options).toEqual(expect.arrayContaining(['step-a', 'step-b']));

    await answer(id, 'dp-1', { selectedOption: 'step-b' });

    expect(status(id, 'step-b')).toBe(NodeStatus.INCLUDED);
    expect(status(id, 'step-a')).toBe(NodeStatus.EXCLUDED);
    // …and says why the unchosen branch is absent.
    expect(harness.session(id).resolutionState.get('step-a')!.excludeReason ?? '').toMatch(/step-b|Treat B|not selected/i);
    expect(harness.tables.events.at(-1)).toMatchObject({ eventType: 'BRANCH_CHOSEN' });
  });

  it('rejects a choice that is not a candidate', async () => {
    const id = await start('pw-fork');
    await expect(answer(id, 'dp-1', { selectedOption: 'step-zzz' })).rejects.toThrow(/not among the candidate branches/);
  });
});

describe('answerPendingDecision — an escalated datum request', () => {
  it('becomes a FACT every gate reading that datum sees, not a gate answer', async () => {
    const id = await start('pw-hb', {}, 'v1');
    // Both gates escalate, and the haemoglobin is asked for once.
    expect(harness.session(id).resolutionState.get('gate-anaemic')!.status).toBe(NodeStatus.PENDING_QUESTION);
    expect(harness.session(id).resolutionState.get('gate-severe')!.status).toBe(NodeStatus.PENDING_QUESTION);
    expect(harness.session(id).pendingQuestions).toHaveLength(1);
    const [asked] = harness.session(id).pendingQuestions;
    expect(asked.datumKey).toBe('LOINC:718-7');

    await answer(id, asked.gateId, { numericValue: 9.1 }, 'v1');

    const s = harness.session(id);
    expect(s.resolutionState.get('gate-anaemic')!.status).toBe(NodeStatus.INCLUDED);
    expect(s.resolutionState.get('gate-severe')!.status).toBe(NodeStatus.GATED_OUT);
    expect(s.gateAnswers.size).toBe(0);
    expect((s.additionalContext as { labResults: unknown[] }).labResults).toEqual([expect.objectContaining({ code: '718-7', value: 9.1 })]);
    expect(harness.tables.events.at(-1)).toMatchObject({ eventType: 'PROVIDER_ASSERTED_DATUM', triggerData: expect.objectContaining({ datumKey: 'LOINC:718-7', value: 9.1 }) });
  });

  it('refuses a non-numeric answer', async () => {
    const id = await start('pw-hb', {}, 'v1');
    await expect(answer(id, harness.session(id).pendingQuestions[0].gateId, { booleanValue: true }, 'v1')).rejects.toThrow(/numericValue/);
  });
});

describe('addPatientContext', () => {
  it('an added allergy reaches the safety check', async () => {
    const id = await start('pw-route');
    await answer(id, 'gate-b', { booleanValue: true });
    expect(status(id, 'med-amox')).toBe(NodeStatus.INCLUDED);

    await resolutionMutations.addPatientContext(null, { sessionId: id, additionalContext: { allergies: [PENICILLIN] } }, ctx());
    expect(harness.session(id).resolutionState.get('med-amox')!.disposition).toMatchObject({ withheldBy: 'safety' });
  });

  it('an added medication that cannot be normalised blocks readiness (D14)', async () => {
    const id = await start('pw-route');
    await resolutionMutations.addPatientContext(null, { sessionId: id, additionalContext: { medications: [{ code: '999', system: 'RxNorm', display: 'Mysterydrug' }] } }, ctx());
    expect(harness.session(id).readiness.blockers).toContainEqual(expect.objectContaining({ type: 'SAFETY_DATA_UNAVAILABLE' }));
  });

  it('accumulates: adding one fact and then another keeps both', async () => {
    const id = await start('pw-route');
    await resolutionMutations.addPatientContext(null, { sessionId: id, additionalContext: { allergies: [PENICILLIN] } }, ctx());
    await resolutionMutations.addPatientContext(null, { sessionId: id, additionalContext: { conditionCodes: [{ code: 'I10', system: 'ICD-10' }] } }, ctx());
    expect(harness.session(id).additionalContext).toMatchObject({
      allergies: [PENICILLIN], conditionCodes: [{ code: 'I10', system: 'ICD-10' }],
    });
  });

  it('refuses a caller-asserted clinical assertion before loading anything', async () => {
    const id = await start('pw-route');
    await expect(resolutionMutations.addPatientContext(null, {
      sessionId: id,
      additionalContext: { labResults: [{ code: '718-7', system: 'LOINC', value: 9, recordValidity: 'INVALID' }] },
    } as never, ctx())).rejects.toMatchObject({ extensions: { code: 'INVALID_RESOLUTION_INPUT' } });
    expect(harness.row(id).revision).toBe(0);
  });

  it('a DEGRADED session that evaluates cleanly is stored ACTIVE again', async () => {
    const id = await start('pw-route');
    harness.row(id).status = 'DEGRADED';
    await resolutionMutations.addPatientContext(null, { sessionId: id, additionalContext: { conditionCodes: [{ code: 'I10', system: 'ICD-10' }] } }, ctx());
    expect(harness.row(id).status).toBe('ACTIVE');
  });
});

describe('abandonSession (lifecycle only)', () => {
  it('abandons an ACTIVE session without evaluating, and logs it', async () => {
    const id = await start('pw-route');
    const before = harness.row(id).result_hash;
    await resolutionMutations.abandonSession(null, { sessionId: id, reason: 'duplicate' }, ctx());
    expect(harness.row(id)).toMatchObject({ status: 'ABANDONED', revision: 1, result_hash: before });
    expect(harness.tables.events.at(-1)).toMatchObject({ eventType: 'abandoned', triggerData: { reason: 'duplicate' } });
  });

  it('refuses to abandon a COMPLETED session', async () => {
    const id = await start('pw-route');
    harness.row(id).status = 'COMPLETED';
    await expect(resolutionMutations.abandonSession(null, { sessionId: id }, ctx())).rejects.toThrow(/COMPLETED/);
  });
});
```

- [ ] **Step 2: Write the generation tests**

Create `apps/pathway-service/src/__tests__/pipeline-resolver-generation.test.ts`:

```ts
jest.mock('../services/resolution/session-store', () => require('./fixtures/resolver-harness').sessionStoreMock());
jest.mock('../services/resolution/pipeline/load-env', () => require('./fixtures/resolver-harness').loadEnvMock());
jest.mock('../services/llm/llm-gate-client', () => ({
  ...jest.requireActual('../services/llm/llm-gate-client'),
  loadLLMGateConfig: jest.fn(),
  evaluateGateWithLLM: jest.fn(),
}));

import { resolutionMutations } from '../resolvers/mutations/resolution';
import { evaluateGateWithLLM, loadLLMGateConfig } from '../services/llm/llm-gate-client';
import { loadEvaluationEnv } from '../services/resolution/pipeline/load-env';
import { DefaultBehavior, GateType } from '../services/resolution/types';
import { harness } from './fixtures/resolver-harness';
import { edge, makeEnv, node } from './fixtures/pipeline-env';

const PINNED = '2026-08-30T12:00:00.000Z';
const AMOX = { ingredientRxcui: '723', ingredientName: 'amoxicillin', atcClasses: ['J01CA04'] };
const nodes = (medName = 'Amoxicillin') => [
  node('root', 'Pathway'), node('stage', 'Stage'), node('step', 'Step'),
  node('med', 'Medication', { name: medName }),
];
const edges = [edge('root', 'stage'), edge('stage', 'step'), edge('step', 'med')];
const SAFETY = {
  normalized: new Map([['amoxicillin||', AMOX]]),
  allergyMappings: [{ snomedCode: '91936005', snomedDisplay: 'Allergy to penicillin', atcClass: 'J01C' }],
};

async function start(pathwayId = 'pw-gen', allergies: unknown[] = []): Promise<string> {
  const s = await resolutionMutations.startResolution(null as never, {
    pathwayId, patientId: 'pt-1', resolutionMode: 'SYNTHETIC', evaluationAsOf: PINNED,
    patientContext: { patientId: 'pt-1', conditionCodes: [], medications: [], allergies, labResults: [] },
  } as never, harness.context({ temporalPolicyVersion: 'legacy-v0' }));
  return (s as { id: string }).id;
}
const generate = (sessionId: string, reviewedResultHash: string) =>
  resolutionMutations.generateCarePlanFromResolution(null, { sessionId, reviewedResultHash }, harness.context());
const carePlanInsertCount = () => harness.tables.carePlanInserts.filter((sql) => /INSERT INTO patient_care_plans\b/.test(sql)).length;

beforeEach(() => {
  harness.reset();
  harness.addPathway('pw-gen', makeEnv(nodes(), edges, SAFETY));
  (loadLLMGateConfig as jest.Mock).mockReset().mockReturnValue(null);
  (evaluateGateWithLLM as jest.Mock).mockReset();
});

describe('generateCarePlanFromResolution', () => {
  it('generates when the reviewed hash matches and the plan is ready', async () => {
    const id = await start();
    const r = await generate(id, harness.session(id).resultHash);

    expect(r).toMatchObject({ success: true, blockers: [] });
    expect(r.carePlanId).toMatch(/^care-plan-/);
    expect(harness.row(id)).toMatchObject({ status: 'COMPLETED', care_plan_id: r.carePlanId });
    expect(carePlanInsertCount()).toBe(1);
    expect(harness.tables.events.at(-1)).toMatchObject({ eventType: 'care_plan_generated' });
  });

  it('returns PLAN_CHANGED_SINCE_REVIEW and stores the fresh cache when the plan moved (D7)', async () => {
    const id = await start();
    const reviewed = harness.session(id).resultHash;
    // Configuration changes between mutations (spec Constraints): stricter thresholds
    // exclude the medication. The graph, and so its fingerprint, is unchanged.
    const stricter = makeEnv(nodes(), edges, SAFETY);
    stricter.resolution.thresholds = { autoResolveThreshold: 0.95, suggestThreshold: 0.95 };
    harness.addPathway('pw-gen', stricter);

    const r = await generate(id, reviewed);

    expect(r).toMatchObject({ success: false, carePlanId: null });
    expect(r.blockers).toEqual([expect.objectContaining({ scope: 'OUTPUT', type: 'PLAN_CHANGED_SINCE_REVIEW' })]);
    expect(harness.row(id).result_hash).not.toBe(reviewed);
    expect(harness.row(id).status).toBe('ACTIVE');
    expect(carePlanInsertCount()).toBe(0);
  });

  it('returns the readiness blockers, and inserts nothing, when the plan is not ready', async () => {
    harness.addPathway('pw-unmapped', makeEnv(nodes('Unobtainium'), edges, SAFETY));
    const id = await start('pw-unmapped');
    const r = await generate(id, harness.session(id).resultHash);

    expect(r.success).toBe(false);
    expect(r.blockers).toContainEqual(expect.objectContaining({ scope: 'COMPLETENESS', type: 'SAFETY_DATA_UNAVAILABLE', relatedNodeIds: ['med'] }));
    expect(carePlanInsertCount()).toBe(0);
  });

  it('a safety suppression that empties the plan blocks with EMPTY_PLAN', async () => {
    const id = await start('pw-gen', [{ code: '91936005', system: 'SNOMED' }]);
    const r = await generate(id, harness.session(id).resultHash);
    expect(r.blockers).toEqual([expect.objectContaining({ scope: 'OUTPUT', type: 'EMPTY_PLAN' })]);
    // The suppression that caused the blocker is what the session stores.
    expect(harness.session(id).resolutionState.get('med')!.disposition).toMatchObject({ status: 'EXCLUDED', withheldBy: 'safety' });
  });

  it('returns a moderate interaction as a text warning on a successful plan (P3-9)', async () => {
    harness.addPathway('pw-warn', makeEnv(
      [node('root', 'Pathway'), node('step', 'Step'), node('w', 'Medication', { name: 'Warfarin' }), node('a', 'Medication', { name: 'Aspirin' })],
      [edge('root', 'step'), edge('step', 'w'), edge('step', 'a')],
      {
        normalized: new Map([
          ['warfarin||', { ingredientRxcui: '11289', ingredientName: 'warfarin', atcClasses: ['B01AA03'] }],
          ['aspirin||', { ingredientRxcui: '1191', ingredientName: 'aspirin', atcClasses: ['B01AC06'] }],
        ]),
        pairs: new Map([['11289|1191', { severity: 'MODERATE' as const, mechanism: 'bleeding', clinicalAdvice: 'monitor INR', matchType: 'PAIR' as const, matchedClasses: null }]]),
      },
    ));
    const id = await start('pw-warn');
    const r = await generate(id, harness.session(id).resultHash);

    expect(r.success).toBe(true);
    expect(r.warnings).toEqual(expect.arrayContaining([expect.stringMatching(/^DDI_MODERATE: (Warfarin|Aspirin) — monitor INR$/)]));
  });

  it('returns the existing care plan for a COMPLETED session without evaluating (P3-7)', async () => {
    const id = await start();
    const first = await generate(id, harness.session(id).resultHash);
    (loadEvaluationEnv as jest.Mock).mockClear();

    const again = await generate(id, 'stale-hash');

    expect(again).toEqual({ success: true, carePlanId: first.carePlanId, warnings: [], blockers: [] });
    expect(loadEvaluationEnv).not.toHaveBeenCalled();
    expect(carePlanInsertCount()).toBe(1);
  });

  it('claims before inserting: a lost race inserts no care plan rows, and the retry succeeds (#8)', async () => {
    const id = await start();
    harness.loseNextRaces(1);

    const r = await generate(id, harness.session(id).resultHash);

    expect(r.success).toBe(true);
    expect(carePlanInsertCount()).toBe(1);
  });

  it('reloads and re-evaluates when its cache write loses a race, instead of returning stale blockers (review P2)', async () => {
    harness.addPathway('pw-unmapped', makeEnv(nodes('Unobtainium'), edges, SAFETY));
    const id = await start('pw-unmapped');
    const reviewed = harness.session(id).resultHash;
    let raced = false;
    harness.onBeforeWrite((row) => {
      if (raced) return;
      raced = true;
      row.revision += 1; // another writer added a fact first
      row.additional_context = { medications: [{ code: '999', system: 'RxNorm', display: 'Mysterydrug' }] };
    });
    (loadEvaluationEnv as jest.Mock).mockClear();

    const r = await generate(id, reviewed);

    expect(loadEvaluationEnv).toHaveBeenCalledTimes(2);
    // Stale would be attempt 1's SAFETY_DATA_UNAVAILABLE for `med` alone. The state that won
    // has a new fact, so the plan the provider reviewed no longer exists.
    expect(r.blockers).toEqual([expect.objectContaining({ type: 'PLAN_CHANGED_SINCE_REVIEW' })]);
    expect(harness.row(id).result_hash).not.toBe(reviewed);
    expect(harness.row(id).revision).toBe(2);
  });

  it('writes the audit rows of its LLM calls when a concurrent generation completes the session first (review P2)', async () => {
    harness.addPathway('pw-llm', makeEnv(
      [
        node('root', 'Pathway'), node('stage', 'Stage'),
        node('gate-llm', 'Gate', {
          gate_type: GateType.LLM_TEXT_ANALYSIS, default_behavior: DefaultBehavior.SKIP, prompt: 'Urgent?',
          input_attribute: 'freeformData.narrative', confidence_threshold: 0.75,
          branches: [{ name: 'urgent', description: 'same day' }, { name: 'routine', description: 'can wait', is_safe_default: true }],
        }),
        node('step', 'Step'), node('med', 'Medication', { name: 'Amoxicillin' }),
      ],
      [edge('root', 'stage'), edge('stage', 'gate-llm'), edge('gate-llm', 'step'), edge('step', 'med')],
      SAFETY,
    ));
    (loadLLMGateConfig as jest.Mock).mockReturnValue({ baseUrl: 'http://llm', apiKey: 'k', model: 'test-model', timeoutMs: 1000 });
    (evaluateGateWithLLM as jest.Mock)
      .mockRejectedValueOnce(new Error('timeout')) // at start: UNAVAILABLE, so nothing is stored to reuse
      .mockResolvedValue({ chosenBranch: 'urgent', confidence: 0.95, reasoning: 'r', rawResponse: {}, model: 'test-model', latencyMs: 1 });
    const id = await start('pw-llm');
    const reviewed = harness.session(id).resultHash;
    harness.onBeforeWrite((row) => {
      if (row.status !== 'ACTIVE') return;
      Object.assign(row, { status: 'COMPLETED', care_plan_id: 'care-plan-x', revision: row.revision + 1 });
    });

    const r = await generate(id, reviewed);

    expect(r).toEqual({ success: true, carePlanId: 'care-plan-x', warnings: [], blockers: [] });
    expect(harness.tables.audits).toEqual([
      { sessionId: id, gateId: 'gate-llm', errorMessage: 'timeout' }, // written with the session at start
      { sessionId: id, gateId: 'gate-llm', errorMessage: null },      // generation's call, written on the COMPLETED exit
    ]);
  });

  it('refuses an ABANDONED session', async () => {
    const id = await start();
    await resolutionMutations.abandonSession(null, { sessionId: id }, harness.context());
    await expect(generate(id, harness.session(id).resultHash)).rejects.toThrow(/abandoned/);
  });
});
```

- [ ] **Step 3: Write the temporal wiring tests**

Create `apps/pathway-service/src/__tests__/pipeline-resolver-temporal.test.ts`:

```ts
/**
 * Temporal wiring now has ONE engine construction site (evaluate) and ONE
 * input path (inputsOf → evaluateSession). These tests replace the per-entry-
 * point suites (pathway-defaults-threading, retraversal-clock-reuse, the
 * retraversal half of resolution-fact-store-wiring): they prove every mutation
 * reaches that site with the stored clock and the accumulated facts.
 */
jest.mock('../services/resolution/session-store', () => require('./fixtures/resolver-harness').sessionStoreMock());
jest.mock('../services/resolution/pipeline/load-env', () => require('./fixtures/resolver-harness').loadEnvMock());
jest.mock('../services/resolution/traversal-engine', () => {
  const actual = jest.requireActual('../services/resolution/traversal-engine');
  class RecordingEngine extends actual.TraversalEngine {
    constructor(...args: unknown[]) {
      // @ts-expect-error — spread into the real constructor
      super(...args);
      require('./fixtures/resolver-harness').harness.recordEngine(args);
    }
  }
  return { ...actual, TraversalEngine: RecordingEngine };
});
jest.mock('../services/resolution/temporal/context-assembler', () => {
  const actual = jest.requireActual('../services/resolution/temporal/context-assembler');
  return { ...actual, assembleContext: jest.fn(actual.assembleContext) };
});
jest.mock('../services/resolution/temporal/fact-store', () => {
  const actual = jest.requireActual('../services/resolution/temporal/fact-store');
  return { ...actual, factStoreFor: jest.fn(actual.factStoreFor) };
});

import { resolutionMutations } from '../resolvers/mutations/resolution';
import { assembleContext } from '../services/resolution/temporal/context-assembler';
import { DEFAULT_TEMPORAL_POLICY_VERSION } from '../services/resolution/temporal/evaluation-context';
import { factStoreFor } from '../services/resolution/temporal/fact-store';
import { DefaultBehavior, GateType, OverrideAction } from '../services/resolution/types';
import { harness } from './fixtures/resolver-harness';
import { edge, makeEnv, node } from './fixtures/pipeline-env';

const PINNED = '2026-01-15T08:30:00.000Z';
const RECENT = '2026-01-05';
/** A distinct object, so identity can be asserted. */
const DEFAULTS = { horizons: { labs: 'YEAR' } } as never;
const ENV = makeEnv(
  [
    node('root', 'Pathway'),
    node('gate-1', 'Gate', { gate_type: GateType.PATIENT_ATTRIBUTE, default_behavior: DefaultBehavior.SKIP, on_unresolved: 'default',
      condition: { field: 'labs', operator: 'greater_than', value: '718-7', threshold: 9 } }),
    node('step-1', 'Step'),
  ],
  [edge('root', 'gate-1'), edge('gate-1', 'step-1')],
  {},
  { temporalDefaults: DEFAULTS },
);
const HB = (value: number, date = RECENT) => ({ code: '718-7', system: 'LOINC', value, unit: 'g/dL', date });

async function start(patient: Record<string, unknown>, context: Record<string, unknown>, extraArgs: Record<string, unknown> = {}): Promise<string> {
  const s = await resolutionMutations.startResolution(null as never, {
    pathwayId: 'pw-t', patientId: 'pt-1', resolutionMode: 'SYNTHETIC', evaluationAsOf: PINNED,
    patientContext: { patientId: 'pt-1', conditionCodes: [], medications: [], allergies: [], labResults: [], ...patient },
    ...extraArgs,
  } as never, harness.context(context));
  return (s as { id: string }).id;
}
const later = (id: string, version: string) => ({
  addLab: (lab: Record<string, unknown>) =>
    resolutionMutations.addPatientContext(null, { sessionId: id, additionalContext: { labResults: [lab] } } as never, harness.context({ temporalPolicyVersion: version })),
  override: () =>
    resolutionMutations.overrideNode(null, { sessionId: id, nodeId: 'step-1', action: OverrideAction.INCLUDE }, harness.context({ temporalPolicyVersion: version })),
});

beforeEach(() => {
  harness.reset();
  harness.addPathway('pw-t', ENV);
  (assembleContext as jest.Mock).mockClear();
  (factStoreFor as jest.Mock).mockClear();
});

describe('temporal wiring through the pipeline', () => {
  it('legacy-v0 never invokes the assembler — at start or on any later mutation', async () => {
    // A lab date v1's assembler would reject: legacy-v0 must start anyway (P1-9).
    const id = await start({ labResults: [HB(12, 'not-a-date')] }, { temporalPolicyVersion: 'legacy-v0' });
    await later(id, 'legacy-v0').addLab(HB(10));
    await later(id, 'legacy-v0').override();
    expect(assembleContext).not.toHaveBeenCalled();
    expect((factStoreFor as jest.Mock).mock.results.every((r) => r.value.length === 0)).toBe(true);
  });

  it('v1 assembles from the start payload, and again with the new facts, on every later mutation', async () => {
    const id = await start({ labResults: [HB(12)] }, { temporalPolicyVersion: 'v1' });
    await later(id, 'v1').addLab({ code: '2345-7', system: 'LOINC', value: 90, unit: 'mg/dL', date: RECENT });
    await later(id, 'v1').override();

    const calls = (factStoreFor as jest.Mock).mock.calls;
    expect(calls).toHaveLength(3);
    const codes = (i: number) => calls[i][0].labResults.map((l: { code: string }) => l.code);
    expect(codes(0)).toEqual(['718-7']);
    expect(codes(1)).toEqual(['718-7', '2345-7']);
    expect(codes(2)).toEqual(['718-7', '2345-7']);
    expect((factStoreFor as jest.Mock).mock.results[0].value.length).toBeGreaterThan(0);
  });

  it('a v1 session with no encounterStart still starts and hands its vitals to the assembler', async () => {
    await start({ vitalSigns: { systolic_bp: 120 } }, { temporalPolicyVersion: 'v1' });
    expect((factStoreFor as jest.Mock).mock.calls[0][0].vitalSigns).toEqual({ systolic_bp: 120 });
  });

  it('later mutations evaluate under the clock stored at start, not the wall clock', async () => {
    const id = await start({}, { temporalPolicyVersion: 'v1' });
    const stored = harness.session(id).temporalContext;
    await later(id, 'v1').override();

    expect(stored!.evaluationAsOf).toBe(PINNED);
    expect(harness.engineArgs).toHaveLength(2);
    expect(harness.engineArgs[1][2]).toEqual(stored);
    expect((factStoreFor as jest.Mock).mock.calls[1][1]).toEqual(stored);
  });

  it('the engine receives the pathway temporal defaults by identity', async () => {
    await start({}, { temporalPolicyVersion: 'v1' });
    expect(harness.engineArgs[0][3]).toBe(DEFAULTS);
  });

  it('the same inputs assemble the same facts on every evaluation', async () => {
    const id = await start({ labResults: [HB(12)] }, { temporalPolicyVersion: 'v1' });
    await later(id, 'v1').override(); // changes no patient fact
    const results = (factStoreFor as jest.Mock).mock.results;
    expect(results[1].value).toEqual(results[0].value);
  });

  it('the policy version is the server’s: the default, an injected one, never the request’s', async () => {
    const byDefault = await start({}, {});
    expect(harness.session(byDefault).temporalContext!.temporalPolicyVersion).toBe(DEFAULT_TEMPORAL_POLICY_VERSION);

    const injected = await start({}, { temporalPolicyVersion: 'legacy-v0' });
    expect(harness.session(injected).temporalContext!.temporalPolicyVersion).toBe('legacy-v0');

    const ignored = await start({}, { temporalPolicyVersion: 'legacy-v0' }, { temporalPolicyVersion: 'v99' });
    expect(harness.session(ignored).temporalContext!.temporalPolicyVersion).toBe('legacy-v0');
  });

  it('addPatientContext treats an explicit null assertion as omitted, and leaves stored facts alone', async () => {
    const id = await start({ labResults: [{ ...HB(12), recordValidity: 'INVALID' }] }, { temporalPolicyVersion: 'v1' });
    await later(id, 'v1').addLab({ ...HB(10, '2026-01-10'), recordValidity: null });

    const s = harness.session(id);
    expect(s.initialPatientContext.labResults[0]).toMatchObject({ recordValidity: 'INVALID' });
    expect((s.additionalContext as { labResults: Array<Record<string, unknown>> }).labResults[0]).not.toHaveProperty('recordValidity');
  });
});
```

- [ ] **Step 4: Rewrite `temporal/v1-traversal-behavior.test.ts` onto the harness**

Replace the whole file with:

```ts
/**
 * Plan 04 Task 9's behavioural proofs, on the evaluation pipeline.
 *
 * 1. The pathway-default cascade, proven behaviourally (P1-16).
 * 2. The P1-2 flip: `addPatientContext` flips a previously unsatisfied gate,
 *    and its subtree follows — every mutation now re-evaluates from inputs,
 *    so there is no stale subtree to be left behind.
 *
 * The engines are real: fixtures/resolver-harness replaces only the session
 * table and the snapshot loader.
 */
jest.mock('../../services/resolution/session-store', () => require('../fixtures/resolver-harness').sessionStoreMock());
jest.mock('../../services/resolution/pipeline/load-env', () => require('../fixtures/resolver-harness').loadEnvMock());

import { resolutionMutations } from '../../resolvers/mutations/resolution';
import { DefaultBehavior, GateType, NodeStatus } from '../../services/resolution/types';
import type { PathwayTemporalDefaults } from '../../services/resolution/temporal/cascade';
import { harness } from '../fixtures/resolver-harness';
import { edge, makeEnv, node } from '../fixtures/pipeline-env';

const PINNED = '2026-01-15T08:30:00.000Z';
/** 200 days before PINNED — inside YEAR (365d), outside v1's QUARTER (90d). */
const TWO_HUNDRED_DAYS_AGO = '2025-06-29';
/** 10 days before PINNED — inside every horizon under test. */
const RECENT = '2026-01-05';

/**
 * A scalar lab gate. `default_behavior: skip` is load-bearing: without it an
 * unsatisfied gate is included anyway and nothing below would prove anything.
 * `on_unresolved: 'default'` opts out of escalation, so an absent lab gates
 * out rather than pending.
 */
const NODES = [
  node('root', 'Pathway'),
  node('gate-1', 'Gate', {
    gate_type: GateType.PATIENT_ATTRIBUTE,
    default_behavior: DefaultBehavior.SKIP,
    on_unresolved: 'default',
    condition: { field: 'labs', operator: 'greater_than', value: '718-7', threshold: 9 },
  }),
  node('step-1', 'Step'),
];
const EDGES = [edge('root', 'gate-1'), edge('gate-1', 'step-1')];

async function start(labResults: Array<Record<string, unknown>>, temporalDefaults: PathwayTemporalDefaults, version: string): Promise<string> {
  harness.addPathway('pw-1', makeEnv(NODES, EDGES, {}, { temporalDefaults }));
  const s = await resolutionMutations.startResolution(null as never, {
    pathwayId: 'pw-1', patientId: 'pt-1', resolutionMode: 'SYNTHETIC', evaluationAsOf: PINNED,
    patientContext: { patientId: 'pt-1', conditionCodes: [], medications: [], allergies: [], labResults },
  } as never, harness.context({ temporalPolicyVersion: version }));
  return (s as { id: string }).id;
}
const state = (id: string) => harness.session(id).resolutionState;

beforeEach(() => harness.reset());

describe('the pathway-default cascade, proven behaviorally (moved from Task 3, P1-16)', () => {
  const OLD_LAB = [{ code: '718-7', system: 'LOINC', value: 12, unit: 'g/dL', date: TWO_HUNDRED_DAYS_AGO }];

  it('admits a 200-day-old lab when the pathway default is YEAR and v1 says QUARTER', async () => {
    const id = await start(OLD_LAB, { horizons: { labs: 'YEAR' } }, 'v1');
    expect(state(id).get('gate-1')!.status).toBe(NodeStatus.INCLUDED);
    expect(state(id).get('step-1')!.status).not.toBe(NodeStatus.GATED_OUT);
  });

  it('excludes the same lab when the pathway sets no default', async () => {
    const id = await start(OLD_LAB, {}, 'v1');
    const gate = state(id).get('gate-1')!;
    expect(gate.status).toBe(NodeStatus.GATED_OUT);
    // NO_MATCH, not INDETERMINATE: the horizon dropped the only candidate.
    expect(gate.excludeReason).toBe('No numeric value found for labs:718-7');
  });

  it('is a v1-only delta — legacy-v0 admits the old lab with or without the default', async () => {
    const a = await start(OLD_LAB, {}, 'legacy-v0');
    expect(state(a).get('gate-1')!.status).toBe(NodeStatus.INCLUDED);
    const b = await start(OLD_LAB, { horizons: { labs: 'YEAR' } }, 'legacy-v0');
    expect(state(b).get('gate-1')!.status).toBe(NodeStatus.INCLUDED);
  });

  it('a lab inside v1’s own QUARTER needs no pathway default', async () => {
    const id = await start([{ code: '718-7', system: 'LOINC', value: 12, unit: 'g/dL', date: RECENT }], {}, 'v1');
    expect(state(id).get('gate-1')!.status).toBe(NodeStatus.INCLUDED);
  });
});

describe('addPatientContext changes what a gate decides (the P1-2 flip test)', () => {
  it('re-resolves a previously unsatisfied gate once the new fact arrives', async () => {
    const id = await start([], {}, 'v1');
    expect(state(id).get('gate-1')!.status).toBe(NodeStatus.GATED_OUT);
    expect(state(id).get('step-1')!.status).toBe(NodeStatus.GATED_OUT);
    // The gate reads `labs`; the pipeline keeps that as gateContextFields (spec §1).
    expect(harness.session(id).gateContextFields.get('gate-1')).toContain('labs');

    await resolutionMutations.addPatientContext(undefined, {
      sessionId: id,
      additionalContext: { labResults: [{ code: '718-7', system: 'LOINC', value: 12, unit: 'g/dL', date: RECENT }] },
    }, harness.context({ temporalPolicyVersion: 'v1' }));

    expect(state(id).get('gate-1')!.status).toBe(NodeStatus.INCLUDED);
    expect(state(id).get('step-1')!.status).not.toBe(NodeStatus.GATED_OUT);
    expect(state(id).get('step-1')!.excludeReason).toBeUndefined();
    expect(state(id).get('gate-1')!.excludeReason).toBeUndefined();
  });

  it('a lab outside the v1 horizon does NOT flip the gate', async () => {
    const id = await start([], {}, 'v1');
    await resolutionMutations.addPatientContext(undefined, {
      sessionId: id,
      additionalContext: { labResults: [{ code: '718-7', system: 'LOINC', value: 12, unit: 'g/dL', date: TWO_HUNDRED_DAYS_AGO }] },
    }, harness.context({ temporalPolicyVersion: 'v1' }));
    expect(state(id).get('gate-1')!.status).toBe(NodeStatus.GATED_OUT);
  });
});
```

- [ ] **Step 5: Move `temporal/resolution-input-contract.test.ts` onto the harness**

1. Replace everything from the top of the file down to (not including)
   `import * as fs from 'fs';` with:

```ts
jest.mock('../../resolvers/Query', () => ({
  PATHWAY_COLUMNS: 'id, version, status',
  formatSessionForGraphQL: (s: unknown) => s,
  hydrateSignalDefinition: (row: unknown) => row,
}));
jest.mock('../../services/resolution/session-store', () => require('../fixtures/resolver-harness').sessionStoreMock());
jest.mock('../../services/resolution/pipeline/load-env', () => require('../fixtures/resolver-harness').loadEnvMock());
```

   Keep the file's own header comment block if one precedes line 14.

2. Add to the imports:

```ts
import { harness } from '../fixtures/resolver-harness';
import { makeEnv } from '../fixtures/pipeline-env';
```

3. Replace the section from `function rctxWith(nodes: GraphNode[]) {` through the end of
   `describe('startResolution — temporal anchors', …)` with the block below. That removes
   `rctxWith`, `poolStub`, `gqlContext`, `start` and the old describe; keep `ENCOUNTER_GATE` and
   `PLAIN_NODE` above it.

```ts
const useGraph = (nodes: GraphNode[]) => harness.addPathway('pw-1', makeEnv(nodes, []));

const start = (args: Record<string, unknown>, userRole = 'PROVIDER') =>
  resolutionMutations.startResolution(
    null,
    { pathwayId: 'pw-1', patientId: 'pt-1', ...args } as never,
    harness.context({ userRole }),
  );

const storedClock = () => harness.session(harness.sessionIds()[0]).temporalContext!;

describe('startResolution — temporal anchors', () => {
  beforeEach(() => {
    harness.reset();
    useGraph([ENCOUNTER_GATE]);
  });

  it('threads a supplied evaluationAsOf into the session clock', async () => {
    useGraph([PLAIN_NODE]);
    await start(
      {
        resolutionMode: 'SYNTHETIC',
        patientContext: { conditionCodes: [], medications: [], labResults: [], allergies: [] },
        evaluationAsOf: '2026-03-04T05:06:07.000Z',
      },
      'ADMIN',
    );
    expect(storedClock().evaluationAsOf).toBe('2026-03-04T05:06:07.000Z');
  });

  it('rejects an empty evaluationAsOf instead of silently using the wall clock', async () => {
    useGraph([PLAIN_NODE]);
    await expect(
      start(
        {
          resolutionMode: 'SYNTHETIC',
          patientContext: { conditionCodes: [], medications: [], labResults: [], allergies: [] },
          evaluationAsOf: '',
        },
        'ADMIN',
      ),
    ).rejects.toThrow(/evaluationAsOf/);
  });

  it('still reads the wall clock when no evaluationAsOf is given', async () => {
    useGraph([PLAIN_NODE]);
    await start({});
    expect(storedClock().evaluationAsOf).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('fails with MISSING_ENCOUNTER_ANCHOR when the pathway needs an anchor and none is given', async () => {
    await expect(start({})).rejects.toThrow(/encounterStart/);
    expect(harness.rowCount()).toBe(0);
  });

  it('starts once encounterStart is supplied, and pins it on the clock', async () => {
    await start({ encounterStart: '2026-03-04T04:00:00.000Z' });
    expect(storedClock().encounterStart).toBe('2026-03-04T04:00:00.000Z');
  });

  it('rejects an explicit SYNTHETIC mode from a non-admin before doing any work', async () => {
    useGraph([PLAIN_NODE]);
    await expect(start({ resolutionMode: 'SYNTHETIC' }, 'PROVIDER')).rejects.toThrow(/ADMIN/);
    expect(harness.rowCount()).toBe(0);
  });

  it('refuses LIVE, naming the plan that will implement it', async () => {
    useGraph([PLAIN_NODE]);
    await expect(start({ resolutionMode: 'LIVE', snapshotId: 'snap-1' }, 'ADMIN')).rejects.toThrow(/plan 07/);
  });

  it('refuses REPLAY, naming the plan that will implement it', async () => {
    useGraph([PLAIN_NODE]);
    await expect(start({ resolutionMode: 'REPLAY', sessionId: 's-1' }, 'ADMIN')).rejects.toThrow(/plan 05b/);
  });

  it('still serves a caller that sends no mode at all', async () => {
    useGraph([PLAIN_NODE]);
    await expect(start({})).resolves.toBeDefined();
  });
});
```

Every other `describe` in the file (the SDL and `parseResolutionInput` blocks) is unchanged.

- [ ] **Step 6: Retire the tests that watched the old seams**

1. In `temporal/resolution-fact-store-wiring.test.ts`, delete these 19 `it(...)` blocks, each
   whole. The kept 10 throw at the boundary before any engine exists; they must pass
   unmodified.
   - `starts a session whose context would fail assembly validation`
   - `starts a session carrying a lab date the assembler cannot parse`
   - `passes an empty fact store to the engine under legacy-v0 (startResolution)`
   - `passes an empty fact store on every retraversal entry point under legacy-v0`
   - `passes an empty fact store on the multi-pathway path under legacy-v0`
   - `startResolution builds facts from the SYNTHETIC payload`
   - `startMultiPathwayResolution builds facts for each child session`
   - `overrideNode re-assembles rather than passing an empty store`
   - `answerPendingDecision re-assembles rather than passing an empty store`
   - `addPatientContext re-assembles including the newly supplied facts`
   - `a v1 session created with no encounterStart still assembles vitals facts`
   - `admits an explicitly-null assertion field, exactly as omission (both doors)`
   - `leaves a fact already stored on the session untouched`
   - `assembles against the session clock, not the wall clock`
   - `resolves the same factIds on re-run as at creation`
   - `defaults to v1 when the deployment sets nothing`
   - `gives every child session the injected version, not merely equal ones`
   - `ignores a temporalPolicyVersion supplied on the request`
   - `ignores a temporalPolicyVersion supplied on the multi-pathway request`

   If a `describe` is left empty, delete it too.
2. Delete these nine files:

```bash
git -C $W rm -q \
  apps/pathway-service/src/__tests__/answer-pending-decision.test.ts \
  apps/pathway-service/src/__tests__/answer-routing-mutation.test.ts \
  apps/pathway-service/src/__tests__/ddi-refresh.test.ts \
  apps/pathway-service/src/__tests__/escalated-answer-injection.test.ts \
  apps/pathway-service/src/__tests__/generation-transaction.test.ts \
  apps/pathway-service/src/__tests__/resolution-retraversal-context.test.ts \
  apps/pathway-service/src/__tests__/decision-point-context-dependency.test.ts \
  apps/pathway-service/src/__tests__/temporal/retraversal-clock-reuse.test.ts \
  apps/pathway-service/src/__tests__/temporal/pathway-defaults-threading.test.ts
```

Each deleted test has a row in *Appendix A* naming its replacement. **Before deleting a file,
check its tests against Appendix A.** A test there with no replacement row is a gap: stop and
report it.

3. In `pipeline-sdl.test.ts`, add inside the `describe`:

```ts
  it('generation requires the reviewed hash, and the answerGateQuestion alias is gone', () => {
    const mutation = objectType('Mutation');
    const gen = mutation.fields!.find((f) => f.name.value === 'generateCarePlanFromResolution')!;
    expect(gen.arguments!.map((a) => `${a.name.value}: ${print(a.type)}`)).toEqual(['sessionId: ID!', 'reviewedResultHash: String!']);
    expect(mutation.fields!.map((f) => f.name.value)).not.toContain('answerGateQuestion');
  });
```

- [ ] **Step 7: Run the new tests to verify they fail**

Run: `npm test --prefix $W/apps/pathway-service -- --runInBand src/__tests__/pipeline-resolver-mutations.test.ts src/__tests__/pipeline-resolver-generation.test.ts src/__tests__/pipeline-resolver-temporal.test.ts src/__tests__/pipeline-sdl.test.ts`
Expected: FAIL.
- The old resolvers still call `createSession`. The harness spreads the real store module, so
  the call reaches the harness pool, which returns no row. The failure is a TypeError reading
  `id`.
- The SDL test finds `answerGateQuestion`.

- [ ] **Step 8: Edit the SDL**

In `schema.graphql`:
1. Replace `generateCarePlanFromResolution(sessionId: ID!): CarePlanGenerationResult!` with:

```graphql
  """
  Materialize the plan the provider reviewed. `reviewedResultHash` is the
  session's `resultHash` at review time; if re-evaluation now produces a
  different plan, nothing is generated and the only blocker is
  PLAN_CHANGED_SINCE_REVIEW (spec D7). A COMPLETED session returns its
  existing carePlanId.
  """
  generateCarePlanFromResolution(sessionId: ID!, reviewedResultHash: String!): CarePlanGenerationResult!
```

2. Delete the `answerGateQuestion` field: its `"""…"""` docstring (the paragraph beginning
   `The former name, kept so this subgraph can deploy WITHOUT the dashboard.`), the field line,
   and its `@deprecated(…)` line.

- [ ] **Step 9: Rewrite `resolvers/mutations/resolution.ts`**

Replace the whole file with the following. The interfaces and the two helpers at the top
(`GateAnswerInput` through `temporalInputFrom`) are unchanged from today's file, comments
included.

```ts
import { GraphQLError } from 'graphql';
import { DataSourceContext, NodeStatus, OverrideAction, SessionStatus } from '../../types';
import { PatientContext, CodeEntry, LabResult } from '../../services/confidence/types';
import {
  parseResolutionInput,
  firstTrustAssertion,
  normalizeContextEntryNulls,
  ResolutionModeArgs,
  RawPatientContextInput,
} from '../../services/resolution/temporal/trust-mode';
import type { ResolutionInput } from '../../services/resolution/temporal/trust-mode';
import { assertAssemblableMode } from '../../services/resolution/temporal/context-assembler';
import type { TemporalContextInput } from '../../services/resolution/temporal/evaluation-context';
import { makeEvaluationTemporalContext } from '../../services/resolution/temporal/evaluation-context';
import { factStoreForInput } from '../../services/resolution/temporal/fact-store';
import { assertKnownPolicyVersion } from '../../services/resolution/temporal/policy-registry';
import { PATHWAY_COLUMNS, formatSessionForGraphQL } from '../Query';
import {
  inputsOf,
  insertSession,
  logEvent,
  logGateAnswer,
  logNodeOverride,
  setCarePlanId,
  writeEvaluation,
  writeLifecycleStatus,
  writeLlmAudits,
} from '../../services/resolution/session-store';
import type { Db } from '../../services/resolution/session-store';
import { generateCarePlan } from '../../services/resolution/care-plan-generator';
import type { CarePlanData } from '../../services/resolution/care-plan-generator';
import type { GateAnswer, GateProperties, ProviderOverride, ResolutionSession } from '../../services/resolution/types';
import { resolveTemporalPolicyVersion } from '../helpers/resolution-context';
import { validateAnswerAgainstGate } from '../../services/resolution/answer-validation';
import { normalizePatientAttributes } from '../../services/resolution/patient-attributes';
import { mergeAdditionalContext } from '../../services/resolution/effective-context';
import {
  assertMutable,
  Change,
  commitEvaluation,
  conflictError,
  loadSession,
  MAX_ATTEMPTS,
  statusOf,
  withAudits,
} from '../../services/resolution/pipeline/commit';
import {
  evaluateSession,
  inTransaction,
  newRequest,
  persistedObservations,
  RevisionConflict,
} from '../../services/resolution/pipeline/request';
import type { EvaluationResult, ScopedBlocker } from '../../services/resolution/pipeline/types';

export interface GateAnswerInput {
  booleanValue?: boolean;
  numericValue?: number;
  selectedOption?: string;
}

/**
 * `AdditionalContextInput` shares `CodeInput`/`LabResultInput` with
 * `PatientContextInput` in the SDL, so it shares their TypeScript types here
 * too. When these were separate inline copies, a field added to the shared SDL
 * input reached one path and was dropped on the other — and the merge key in
 * effective-context.ts reads `date` and `sourceId` off exactly these entries.
 */
export interface AdditionalContextInput {
  conditionCodes?: CodeEntry[];
  medications?: CodeEntry[];
  labResults?: LabResult[];
  allergies?: CodeEntry[];
  vitalSigns?: Record<string, unknown>;
  freeformData?: Record<string, unknown>;
  patientAttributes?: Record<string, unknown>;
}

/**
 * The GraphQL `PatientContextInput` shape, expressed once against the central
 * `CodeEntry`/`LabResult` types. It used to be re-declared inline at each call
 * site, so widening the coded entries meant finding every copy — and missing
 * one produced a field the resolver silently dropped.
 */
export interface PatientContextArgs extends RawPatientContextInput {
  patientId: string;
}

/** The clock arguments both start mutations accept. */
export interface TemporalAnchorArgs {
  evaluationAsOf?: string | null;
  encounterStart?: string | null;
}

/**
 * Project a parsed SYNTHETIC variant into the `PatientContext` the traversal,
 * DDI pass and session record all consume.
 *
 * Takes the whole `ResolutionInput` rather than a bare context, so the only
 * way to reach the clinical payload is through a variant that has already been
 * validated. Throws on LIVE/REPLAY: callers run `assertAssemblableMode` first,
 * and this is the backstop if one forgets.
 */
export function toPatientContext(input: ResolutionInput): PatientContext {
  if (input.mode !== 'SYNTHETIC') {
    throw new GraphQLError(`cannot build a patient context in ${input.mode} mode`, {
      extensions: { code: 'INVALID_RESOLUTION_INPUT' },
    });
  }
  const pc = input.patientContext;
  return {
    patientId: pc.patientId,
    conditionCodes: pc.conditionCodes,
    medications: pc.medications,
    labResults: pc.labResults,
    allergies: pc.allergies,
    vitalSigns: pc.vitalSigns,
    freeformData: pc.freeformData,
    patientAttributes: normalizePatientAttributes(pc.patientAttributes),
  };
}

/**
 * Only pass through what the caller actually supplied — absent means "read the
 * wall clock".
 *
 * Tested for null/undefined, NOT truthiness. `evaluationAsOf: ""` is a
 * malformed clock, not an absent one: dropping it silently substituted the wall
 * clock and pinned the session to an instant the caller never asked for.
 * Forwarded, it reaches the strict parser and is rejected as INVALID_CLOCK.
 */
export function temporalInputFrom(args: TemporalAnchorArgs): TemporalContextInput {
  const input: TemporalContextInput = {};
  if (args.evaluationAsOf != null) input.evaluationAsOf = args.evaluationAsOf;
  if (args.encounterStart != null) input.encounterStart = args.encounterStart;
  return input;
}

// ─── Evaluation pipeline helpers ──────────────────────────────────────

/** A blocker as the API returns it. `pathwayId` is set only on blockers a run propagates (plan 04). */
function formatBlocker(b: ScopedBlocker) {
  return { scope: b.scope, type: b.type, description: b.description, relatedNodeIds: b.relatedNodeIds, pathwayId: null as string | null };
}

/** Moderate interactions accompany a plan without blocking it (P3-9). */
function warningsOf(result: EvaluationResult): string[] {
  return result.safetyFindings
    .filter((f) => f.action === 'WARN')
    .map((f) => `${f.category}: ${f.drugName}${f.clinicalAdvice ? ` — ${f.clinicalAdvice}` : ''}`);
}

const PLAN_CHANGED: ScopedBlocker = {
  scope: 'OUTPUT',
  type: 'PLAN_CHANGED_SINCE_REVIEW',
  description: 'The plan changed after it was reviewed. Review the current plan and generate again.',
  relatedNodeIds: [],
};

/**
 * Everything a session is waiting on at one node, as a change to its inputs:
 * a question gate's answer, an escalated datum (a FACT), or a DecisionPoint
 * branch choice. Validation throws here, before any evaluation.
 */
function answerChange(session: ResolutionSession, args: { sessionId: string; nodeId: string; answer: GateAnswerInput }): Change {
  const node = session.resolutionState.get(args.nodeId);
  if (!node) {
    throw new GraphQLError(`Gate "${args.nodeId}" not found in session`, { extensions: { code: 'NOT_FOUND' } });
  }
  const inputs = inputsOf(session);
  const pending = session.pendingQuestions.find((q) => q.gateId === args.nodeId);

  // A branch choice is recorded as an ANSWER the engine routes on, so it
  // survives every later evaluation instead of being re-asked.
  if (node.nodeType === 'DecisionPoint') {
    const candidates = pending?.options ?? [];
    const chosen = args.answer.selectedOption;
    if (!chosen || !candidates.includes(chosen)) {
      throw new GraphQLError(
        `"${chosen}" is not among the candidate branches at "${args.nodeId}": ${candidates.join(', ')}`,
        { extensions: { code: 'BAD_USER_INPUT' } },
      );
    }
    inputs.gateAnswers.set(args.nodeId, { selectedOption: chosen });
    return { inputs, event: { eventType: 'BRANCH_CHOSEN', triggerData: { nodeId: args.nodeId, chosen, candidates } } };
  }

  // An escalated datum request: the answer is a FACT, added to the patient
  // context — never to gateAnswers — so every gate reading that datum sees it.
  if (pending?.askTarget) {
    const value = args.answer.numericValue;
    if (value === undefined || value === null) {
      throw new GraphQLError(`Gate "${args.nodeId}" is a request for ${pending.datumKey}; supply numericValue`, {
        extensions: { code: 'BAD_USER_INPUT' },
      });
    }
    const target = pending.askTarget;
    // No `sourceId`: a clinician-supplied value is not a chart observation.
    // Who said what is recorded by the PROVIDER_ASSERTED_DATUM event.
    const fragment: AdditionalContextInput =
      target.kind === 'lab'
        ? { labResults: [{ code: target.code, system: target.system, value }] }
        : target.kind === 'vital'
          ? { vitalSigns: { [target.path]: value } }
          // `patient.trimester` addresses patientAttributes.trimester — a FLAT key.
          : { patientAttributes: { [target.path.split('.').slice(1).join('.')]: value } };
    inputs.additionalContext = mergeAdditionalContext(inputs.additionalContext, fragment);
    return {
      inputs,
      event: { eventType: 'PROVIDER_ASSERTED_DATUM', triggerData: { gateId: args.nodeId, datumKey: pending.datumKey, target, value } },
    };
  }

  // A question gate's answer, checked against the gate's own schema first.
  const problem = node.properties
    ? validateAnswerAgainstGate(args.answer, node.properties as unknown as GateProperties)
    : null;
  if (problem) {
    throw new GraphQLError(`Gate "${args.nodeId}": ${problem}`, { extensions: { code: 'BAD_USER_INPUT' } });
  }
  const answer: GateAnswer = {
    booleanValue: args.answer.booleanValue,
    numericValue: args.answer.numericValue,
    selectedOption: args.answer.selectedOption,
  };
  inputs.gateAnswers.set(args.nodeId, answer);
  return {
    inputs,
    event: { eventType: 'gate_answer', triggerData: { gateId: args.nodeId, answer: args.answer } },
    record: (db, result) => logGateAnswer(db, {
      sessionId: session.id,
      gateId: args.nodeId,
      pathwayId: session.pathwayId,
      answer: args.answer,
      // Reported from what evaluation decided, not predicted from the answer's shape.
      gateOpened: result.resolutionState.get(args.nodeId)?.status === NodeStatus.INCLUDED,
    }),
  };
}

/** Insert the care plan, goals and interventions; returns the plan id. Runs inside generation's claimed transaction. */
async function insertCarePlanRows(db: Db, session: ResolutionSession, carePlanData: CarePlanData): Promise<string> {
  const pathwayTitleResult = await db.query('SELECT title FROM pathway_graph_index WHERE id = $1', [session.pathwayId]);
  const carePlanTitle = pathwayTitleResult.rows[0]?.title
    ? `Care Plan: ${pathwayTitleResult.rows[0].title}`
    : 'Pathway-Generated Care Plan';

  // Ensure the patient row exists so the patient_care_plans FK is satisfied.
  // No-op for real patients; a placeholder for the simulator's synthetic ids.
  await db.query(
    `INSERT INTO patients (id, first_name, last_name, date_of_birth)
     VALUES ($1, 'Synthetic', 'Simulator Patient', CURRENT_DATE)
     ON CONFLICT (id) DO NOTHING`,
    [session.patientId],
  );

  // Per migration 019: the patient-specific instance tables.
  const carePlanResult = await db.query(
    `INSERT INTO patient_care_plans
       (patient_id, title, provider_id, status, condition_codes, start_date, created_by)
     VALUES ($1, $2, $3, 'DRAFT', $4, CURRENT_DATE, $5)
     RETURNING id`,
    [session.patientId, carePlanTitle, session.providerId, carePlanData.conditionCodes, session.providerId],
  );
  const carePlanId: string = carePlanResult.rows[0].id;

  // The patient-specific tables have no pathway_node_id column; provenance
  // goes into guideline_reference.
  for (const goal of carePlanData.goals) {
    const refParts: string[] = [];
    if (goal.guidelineReference) refParts.push(goal.guidelineReference);
    if (goal.pathwayNodeId) refParts.push(`node:${goal.pathwayNodeId}`);
    await db.query(
      `INSERT INTO patient_care_plan_goals
         (patient_care_plan_id, description, priority, guideline_reference)
       VALUES ($1, $2, $3, $4)`,
      [carePlanId, goal.description, goal.priority, refParts.length > 0 ? refParts.join(' ') : null],
    );
  }

  for (const intervention of carePlanData.interventions) {
    const refParts: string[] = [];
    if (intervention.guidelineReference) refParts.push(intervention.guidelineReference);
    if (intervention.pathwayId) refParts.push(`pathway:${intervention.pathwayId}`);
    if (intervention.pathwayNodeId) refParts.push(`node:${intervention.pathwayNodeId}`);
    if (intervention.sessionId) refParts.push(`session:${intervention.sessionId}`);
    await db.query(
      `INSERT INTO patient_care_plan_interventions
         (patient_care_plan_id, type, description, medication_code, dosage, frequency,
          procedure_code, referral_specialty, patient_instructions, guideline_reference)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        carePlanId, intervention.type, intervention.description,
        intervention.medicationCode ?? null, intervention.dosage ?? null,
        intervention.frequency ?? null, intervention.procedureCode ?? null,
        intervention.referralSpecialty ?? null, intervention.patientInstructions ?? null,
        refParts.length > 0 ? refParts.join(' ') : null,
      ],
    );
  }
  return carePlanId;
}

// ─── Mutations ────────────────────────────────────────────────────────

export const resolutionMutations = {
  async startResolution(
    _parent: unknown,
    args: {
      pathwayId: string;
      patientId: string;
      patientContext?: PatientContextArgs;
    } & ResolutionModeArgs &
      TemporalAnchorArgs,
    context: DataSourceContext
  ) {
    const { pool } = context;

    const pathwayResult = await pool.query(
      `SELECT ${PATHWAY_COLUMNS} FROM pathway_graph_index WHERE id = $1`,
      [args.pathwayId]
    );
    const pathway = pathwayResult.rows[0];
    if (!pathway) {
      throw new GraphQLError('Pathway not found', { extensions: { code: 'NOT_FOUND' } });
    }
    if (pathway.status !== 'ACTIVE') {
      throw new GraphQLError(`Pathway is not ACTIVE (status: ${pathway.status})`, {
        extensions: { code: 'BAD_USER_INPUT' },
      });
    }

    // Exactly one payload per trust mode, policed over the WHOLE raw request.
    // Refuse LIVE/REPLAY before any work.
    const resolutionInput = parseResolutionInput(args, args.patientId, context.userRole);
    assertAssemblableMode(resolutionInput);
    const patientContext: PatientContext = toPatientContext(resolutionInput);

    // The policy version comes from the SERVER (AD-1), never from `args`, and
    // the wall clock is read exactly once, here (§1).
    const temporalPolicyVersion = resolveTemporalPolicyVersion(context);
    const temporalContext = makeEvaluationTemporalContext({
      ...temporalInputFrom(args),
      temporalPolicyVersion,
    });
    assertKnownPolicyVersion(temporalContext.temporalPolicyVersion);

    // Validates the REQUEST before the snapshot is loaded (P1-9): under v1 the
    // assembler rejects a malformed context here, exactly as it did before the
    // pipeline. `evaluate` assembles again from the same inputs.
    factStoreForInput(resolutionInput, temporalContext);

    const request = newRequest();
    const { env, inputs, result, durationMs } = await evaluateSession(pool, request, {
      pathwayId: args.pathwayId,
      graphFingerprint: '',
      temporalContext,
      initialPatientContext: patientContext,
      additionalContext: {},
      gateAnswers: new Map(),
      providerOverrides: new Map(),
      observations: new Map(),
      revision: 0,
    }, 'ROOT', { pinGraph: true });
    if (env.resolution.graphContext.allNodes.length === 0) {
      throw new GraphQLError('Pathway graph is empty', { extensions: { code: 'INTERNAL_SERVER_ERROR' } });
    }

    const sessionId = await inTransaction(pool, async (db) => {
      const id = await insertSession(db, {
        pathwayVersion: pathway.version,
        patientId: args.patientId,
        providerId: context.userId,
        inputs: { ...inputs, observations: persistedObservations(inputs, request, result) },
        result,
        status: statusOf(result),
        durationMs,
      });
      await writeLlmAudits(db, id, request.audits);
      await logEvent(db, id, {
        eventType: 'traversal_complete',
        triggerData: {
          pathwayId: args.pathwayId,
          patientId: args.patientId,
          nodesInGraph: env.resolution.graphContext.allNodes.length,
        },
        nodesRecomputed: result.resolutionState.size,
        statusChanges: [],
      });
      return id;
    });

    return formatSessionForGraphQL(await loadSession(pool, sessionId));
  },

  async overrideNode(
    _parent: unknown,
    args: { sessionId: string; nodeId: string; action: OverrideAction; reason?: string },
    context: DataSourceContext
  ) {
    const session = await commitEvaluation(context.pool, args.sessionId, (s) => {
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
    });
    return formatSessionForGraphQL(session);
  },

  /**
   * Answer whatever the session is waiting on at a node: a question gate, an
   * escalated request for a datum, or a branch choice at a DecisionPoint.
   */
  async answerPendingDecision(
    _parent: unknown,
    args: { sessionId: string; nodeId: string; answer: GateAnswerInput },
    context: DataSourceContext
  ) {
    const session = await commitEvaluation(context.pool, args.sessionId, (s) => answerChange(s, args));
    return formatSessionForGraphQL(session);
  },

  async addPatientContext(
    _parent: unknown,
    args: { sessionId: string; additionalContext: AdditionalContextInput },
    context: DataSourceContext
  ) {
    // The SAME trust parsing `startResolution` runs (D10), read from the
    // NEWLY supplied payload: a session whose stored context already carries
    // an assertion must not become permanently un-addable-to.
    const assertion = firstTrustAssertion(args.additionalContext);
    if (assertion) {
      throw new GraphQLError(
        `additionalContext.${assertion} is a SYNTHETIC assertion about clinical truth and cannot be supplied through addPatientContext`,
        { extensions: { code: 'INVALID_RESOLUTION_INPUT' } },
      );
    }
    // Explicit nulls become omissions, as at session start.
    const additionalContext = normalizeContextEntryNulls(args.additionalContext);

    const session = await commitEvaluation(context.pool, args.sessionId, (s) => {
      const inputs = inputsOf(s);
      // Accumulate onto everything supplied before: adding A then B keeps both.
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
    });
    return formatSessionForGraphQL(session);
  },

  /**
   * Materialize the plan the provider reviewed (spec §4, Generation).
   *
   * A COMPLETED session returns its plan without evaluating. Otherwise the
   * session is re-evaluated: a changed resultHash returns
   * PLAN_CHANGED_SINCE_REVIEW (D7), and unready readiness returns its
   * blockers, after storing the fresh cache. If that store loses a revision
   * race, the blockers describe a state that no longer exists, so generation
   * reloads and evaluates again (review P2). The claim — status to COMPLETED
   * under the revision read — happens BEFORE the inserts in one transaction,
   * so a lost race inserts nothing and retries (#4, #8). Every exit writes the
   * audit rows of LLM calls no committed transaction wrote (`withAudits`).
   */
  async generateCarePlanFromResolution(
    _parent: unknown,
    args: { sessionId: string; reviewedResultHash: string },
    context: DataSourceContext
  ) {
    const { pool } = context;
    const request = newRequest();
    type Outcome = { success: boolean; carePlanId: string | null; warnings: string[]; blockers: ReturnType<typeof formatBlocker>[] };

    return withAudits(pool, args.sessionId, request, async (): Promise<Outcome> => {
      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        const session = await loadSession(pool, args.sessionId);
        if (session.status === SessionStatus.COMPLETED) {
          return { success: true, carePlanId: session.carePlanId ?? null, warnings: [], blockers: [] };
        }
        if (session.status === SessionStatus.ABANDONED) {
          throw new GraphQLError('Session was abandoned and cannot generate a care plan', {
            extensions: { code: 'BAD_REQUEST' },
          });
        }
        assertMutable(session);

        const { inputs, result, durationMs } = await evaluateSession(pool, request, inputsOf(session), 'ROOT');
        const toStore = { ...inputs, observations: persistedObservations(inputs, request, result) };
        const warnings = warningsOf(result);
        const planChanged = result.resultHash !== args.reviewedResultHash;

        try {
          if (planChanged || !result.readiness.ready) {
            // Store what was just evaluated, so the provider re-reviews exactly this.
            await inTransaction(pool, async (db) => {
              const written = await writeEvaluation(db, {
                sessionId: args.sessionId, expectedRevision: session.revision, inputs: toStore, result,
                status: statusOf(result), durationMs,
              });
              if (!written) throw new RevisionConflict();
              await writeLlmAudits(db, args.sessionId, request.audits);
            });
            request.audits.length = 0;
            const blockers = planChanged ? [PLAN_CHANGED] : result.readiness.blockers;
            return { success: false, carePlanId: null, warnings, blockers: blockers.map(formatBlocker) };
          }

          const carePlanData = generateCarePlan(result.resolutionState, session.pathwayId, args.sessionId);
          const carePlanId = await inTransaction(pool, async (db) => {
            // Claim first (#8): only the request that moves the session to COMPLETED inserts.
            const claimed = await writeEvaluation(db, {
              sessionId: args.sessionId, expectedRevision: session.revision, inputs: toStore, result,
              status: SessionStatus.COMPLETED, durationMs,
            });
            if (!claimed) throw new RevisionConflict();
            const id = await insertCarePlanRows(db, session, carePlanData);
            await setCarePlanId(db, args.sessionId, id);
            await writeLlmAudits(db, args.sessionId, request.audits);
            await logEvent(db, args.sessionId, {
              eventType: 'care_plan_generated',
              triggerData: { carePlanId: id, goalsCount: carePlanData.goals.length, interventionsCount: carePlanData.interventions.length },
              nodesRecomputed: 0,
              statusChanges: [{ nodeId: 'session', from: session.status, to: SessionStatus.COMPLETED }],
            });
            return id;
          });
          request.audits.length = 0;
          return { success: true, carePlanId, warnings, blockers: [] };
        } catch (err) {
          // Either write lost a race: reload, and evaluate the state that won.
          if (err instanceof RevisionConflict) continue;
          if (err instanceof GraphQLError) throw err;
          console.error('Care plan generation failed:', err);
          throw new GraphQLError('Failed to generate care plan: transaction rolled back', {
            extensions: { code: 'INTERNAL_SERVER_ERROR' },
          });
        }
      }
      throw conflictError();
    });
  },

  /** Lifecycle only (spec §4): no evaluation; ACTIVE or DEGRADED only; the revision check still applies. */
  async abandonSession(
    _parent: unknown,
    args: { sessionId: string; reason?: string },
    context: DataSourceContext
  ) {
    const { pool } = context;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const session = await loadSession(pool, args.sessionId);
      assertMutable(session);
      try {
        await inTransaction(pool, async (db) => {
          const written = await writeLifecycleStatus(db, {
            sessionId: args.sessionId, expectedRevision: session.revision, status: SessionStatus.ABANDONED,
          });
          if (!written) throw new RevisionConflict();
          await logEvent(db, args.sessionId, {
            eventType: 'abandoned',
            triggerData: { reason: args.reason ?? 'No reason provided' },
            nodesRecomputed: 0,
            statusChanges: [{ nodeId: 'session', from: session.status, to: SessionStatus.ABANDONED }],
          });
        });
      } catch (err) {
        if (err instanceof RevisionConflict) continue;
        throw err;
      }
      return formatSessionForGraphQL(await loadSession(pool, args.sessionId));
    }
    throw conflictError();
  },
};
```

- [ ] **Step 10: Regenerate types, run everything this task touches, typecheck**

```bash
npm run codegen --prefix $W/apps/pathway-service
npm test --prefix $W/apps/pathway-service -- --runInBand src/__tests__/pipeline-resolver-mutations.test.ts src/__tests__/pipeline-resolver-generation.test.ts src/__tests__/pipeline-resolver-temporal.test.ts src/__tests__/pipeline-sdl.test.ts src/__tests__/temporal/v1-traversal-behavior.test.ts src/__tests__/temporal/resolution-input-contract.test.ts src/__tests__/temporal/resolution-fact-store-wiring.test.ts src/__tests__/multi-pathway-resolution.test.ts src/__tests__/ddi-multi-pathway.test.ts
$W/node_modules/.bin/tsc -p $W/apps/pathway-service/tsconfig.json --noEmit
npm test --prefix $W/apps/pathway-service -- --runInBand 2>&1 | grep -E "^(FAIL|Tests:)" | sort | uniq -c
```
Expected:
- Every listed suite passes. The two multi-pathway suites are untouched by this task and still
  pass on the old engine path until Task 7.
- The typecheck is clean.
- In the full suite, the only `FAIL` lines are the two scorer suites.

**Falsify, one at a time, restoring each:**
1. In `answerChange`, write the escalated datum into `inputs.gateAnswers` instead of
   `additionalContext`. The escalation test must fail on `gateAnswers.size`.
2. In `overrideNode`, use `originalStatus: node.status` (drop `previous?.originalStatus ??`).
   The re-override test must fail.
3. In `generateCarePlanFromResolution`, move the `insertCarePlanRows` call above the claim. The
   lost-race test must fail with 2 care plan inserts.
4. In `addPatientContext`, replace `mergeAdditionalContext(inputs.additionalContext,
   additionalContext)` with `additionalContext`. The *accumulates* test must fail: the second
   addition replaces the first.
5. In the blocked path, replace `if (!written) throw new RevisionConflict();` with
   `if (!written) return;`. The *reloads and re-evaluates…* test must fail: it returns the stale
   SAFETY_DATA_UNAVAILABLE blocker.

- [ ] **Step 11: Commit**

```bash
git -C $W add -A apps/pathway-service/src apps/pathway-service/schema.graphql
git -C $W status --short   # expect only this task's files
git -C $W commit -m "feat(pathway-service): single-pathway mutations on the evaluation pipeline

Every mutation now changes a session's inputs and commits a from-scratch
evaluation through commitEvaluation. Generation requires the reviewed
resultHash (D7), claims before inserting (#4, #8), and returns an existing
plan for a completed session. abandonSession is lifecycle-only.
answerGateQuestion is removed. Tests that watched the old engine seams
are replaced by harness-driven tests (Appendix A).

Claude-Session: https://claude.ai/code/session_01XRNkZvQrxmRLNtJHxq71kH"
```

---

### Task 7: Multi-pathway child sessions through the pipeline (P3-2)

**Files:**
- Modify: `apps/pathway-service/src/resolvers/mutations/multi-pathway-resolution.ts`
- Modify: `apps/pathway-service/src/services/resolution/care-plan-projection.ts:46`
- Modify (tests):
  - `apps/pathway-service/src/__tests__/multi-pathway-resolution.test.ts`
  - `apps/pathway-service/src/__tests__/ddi-multi-pathway.test.ts`
- Create (test): `apps/pathway-service/src/__tests__/pipeline-multi-children.test.ts`

**Interfaces:**
- Consumes: `evaluateSession`, `newRequest`, `persistedObservations`, `inTransaction`,
  `EvaluationRequest`, `SessionEvaluation` (Task 3); `statusOf` (Task 4); `insertSession`,
  `writeLlmAudits` (Task 2).
- Produces:
  - `resolveAndPersistAll(pool, pathways, patientContext, providerId, temporalContext)`: the
    `factStore` parameter is removed.
  - `projectResolutionToCarePlan(..., dependencyMap?: Pick<DependencyMap, 'gateContextFields'>)`.

- [ ] **Step 1: Write the failing integration test**

The reason for P3-2 is that a child must be answerable through the single-pathway mutations.
Prove that with the real pipeline.

Create `apps/pathway-service/src/__tests__/pipeline-multi-children.test.ts`:

```ts
jest.mock('../services/resolution/session-store', () => require('./fixtures/resolver-harness').sessionStoreMock());
jest.mock('../services/resolution/pipeline/load-env', () => require('./fixtures/resolver-harness').loadEnvMock());
jest.mock('../services/resolution/lattice-collapse', () => ({ collapseLattice: jest.fn(async (_pool: unknown, m: unknown) => m) }));
jest.mock('../services/resolution/multi-pathway-session-store', () => ({
  createMultiPathwaySession: jest.fn(async () => 'mp-1'),
  getMultiPathwaySession: jest.fn(async () => ({
    id: 'mp-1', patientId: 'pt-1', providerId: 'provider-1', status: 'ACTIVE', isPreview: false,
    initialPatientContext: {}, contributingSessionIds: [], contributingPathwayIds: [],
    mergedPlan: { sourcePathwayIds: [], medications: [], labs: [], procedures: [], schedules: [], qualityMetrics: [], suppressed: [], conflicts: [] },
    conflictResolutions: {}, carePlanId: null, ddiWarnings: [], createdAt: new Date(), updatedAt: new Date(),
  })),
  getPatientMultiPathwaySessions: jest.fn(),
  markMultiPathwaySessionStatus: jest.fn(),
  updateMergedPlanAndResolutions: jest.fn(),
}));

import { multiPathwayResolutionMutations } from '../resolvers/mutations/multi-pathway-resolution';
import { resolutionMutations } from '../resolvers/mutations/resolution';
import { getMatchedPathways } from '../services/resolution/session-store';
import { AnswerType, DefaultBehavior, GateType, NodeStatus } from '../services/resolution/types';
import { harness } from './fixtures/resolver-harness';
import { edge, makeEnv, node } from './fixtures/pipeline-env';

const ENV = makeEnv(
  [
    node('root', 'Pathway'),
    node('gate-b', 'Gate', { gate_type: GateType.QUESTION, default_behavior: DefaultBehavior.SKIP, answer_type: AnswerType.BOOLEAN, prompt: 'Symptomatic?' }),
    node('step-yes', 'Step'), node('step-no', 'Step'),
  ],
  [
    edge('root', 'gate-b', 'HAS_GATE'),
    edge('gate-b', 'step-yes', 'BRANCHES_TO', { when: { equals: true } }),
    edge('gate-b', 'step-no', 'BRANCHES_TO', { when: { equals: false } }),
  ],
);
const matched = (id: string) => ({
  pathway: { id, logicalId: `lp-${id}`, title: id, version: '1', category: 'CHRONIC_DISEASE', status: 'ACTIVE', conditionCodes: [] },
  matched: true, matchedSets: [], mostSpecificMatchedSet: { setId: 's', scope: 'EXACT', members: [], memberCount: 0 },
  specificityDepth: 1, patientCodesAddressed: [], patientCodesUnaddressed: [], matchScore: 1, matchedConditionCodes: [],
});

beforeEach(() => {
  harness.reset();
  harness.addPathway('pw-a', ENV);
});

it('a child session created by a run is stored with inputs and is answerable through answerPendingDecision', async () => {
  (getMatchedPathways as jest.Mock).mockResolvedValue([matched('pw-a')]);
  await multiPathwayResolutionMutations.startMultiPathwayResolution(
    {}, { patientId: 'pt-1' } as never, harness.context({ temporalPolicyVersion: 'legacy-v0' }),
  );

  const [childId] = harness.sessionIds();
  expect(harness.session(childId).graphFingerprint).toBe(ENV.graphFingerprint);
  expect(harness.session(childId).pendingQuestions.map((q) => q.gateId)).toEqual(['gate-b']);

  await resolutionMutations.answerPendingDecision(
    null, { sessionId: childId, nodeId: 'gate-b', answer: { booleanValue: true } }, harness.context({ temporalPolicyVersion: 'legacy-v0' }),
  );
  expect(harness.session(childId).resolutionState.get('step-yes')!.status).toBe(NodeStatus.INCLUDED);
  expect(harness.session(childId).revision).toBe(1);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test --prefix $W/apps/pathway-service -- --runInBand src/__tests__/pipeline-multi-children.test.ts`
Expected: FAIL. Multi still calls `createSession`, which reaches the harness pool and fails
reading `id` from an empty result.

- [ ] **Step 3: Move `resolveAndPersistAll` onto the pipeline**

In `multi-pathway-resolution.ts`:

1. Imports:
   - Delete `import { TraversalEngine } from '../../services/resolution/traversal-engine';`.
   - Change the `session-store` import to
     `import { getMatchedPathways, getSession, insertSession, writeLlmAudits } from '../../services/resolution/session-store';`.
   - Remove `makeTraversalAdapter` and `makeLlmGateEvaluator` from the `resolution-context`
     import list.
   - Add:

```ts
import {
  evaluateSession,
  inTransaction,
  newRequest,
  persistedObservations,
} from '../../services/resolution/pipeline/request';
import type { EvaluationRequest, SessionEvaluation } from '../../services/resolution/pipeline/request';
import { statusOf } from '../../services/resolution/pipeline/commit';
```

2. In `startMultiPathwayResolution`, replace
   `const factStore = factStoreForInput(resolutionInput, temporalContext);` with
   `factStoreForInput(resolutionInput, temporalContext);`. It still validates the request
   before the zero-match branch; evaluation assembles its own store. Update the comment above
   it to say so. In the `await resolveAndPersistAll(` call, delete the `factStore,` argument.

3. Add at module level, above `buildResolvedPlansFromSessions`:

```ts
/** The projection reads gateContextFields as sets; the pipeline stores sorted arrays. */
const setsOf = (m: Map<string, string[]>): Map<string, Set<string>> =>
  new Map([...m].map(([k, v]) => [k, new Set(v)] as [string, Set<string>]));
```

4. In `buildResolvedPlansFromSessions`, replace the argument `session.dependencyMap,` with
   `{ gateContextFields: setsOf(session.gateContextFields) },`.

5. Replace the `factStore` parameter of `resolveAndPersistAll`, together with its JSDoc
   paragraph, by nothing, so the signature ends at `temporalContext: EvaluationTemporalContext,`.
   Then replace the function body, from `const resolvedPlans` through the `return`, with:

```ts
  const resolvedPlans: ResolvedCarePlan[] = [];
  const contributingSessionIds: string[] = [];
  const contributingPathwayIds: string[] = [];

  // Evaluate every pathway BEFORE writing anything. A rejection — a missing
  // encounter anchor, say — must leave no child sessions and no audit rows
  // behind; writing inside this loop would persist pathway A before B throws.
  const evaluated: Array<{ m: MatchedPathway; request: EvaluationRequest; evaluation: SessionEvaluation }> = [];
  for (const m of pathways) {
    const request = newRequest();
    const evaluation = await evaluateSession(pool, request, {
      pathwayId: m.pathway.id,
      graphFingerprint: '',
      temporalContext,
      initialPatientContext: patientContext,
      additionalContext: {},
      gateAnswers: new Map(),
      providerOverrides: new Map(),
      observations: new Map(),
      revision: 0,
    }, 'ROOT', { pinGraph: true });
    // An empty graph contributes no session, as before.
    if (evaluation.env.resolution.graphContext.allNodes.length === 0) continue;
    evaluated.push({ m, request, evaluation });
  }

  for (const { m, request, evaluation: { inputs, result, durationMs } } of evaluated) {
    // A child is a standalone session, answerable through the single-pathway
    // mutations, evaluated at ROOT scope until plan 04 composes runs (P3-2).
    const sessionId = await inTransaction(pool, async (db) => {
      const id = await insertSession(db, {
        pathwayVersion: m.pathway.version,
        patientId: patientContext.patientId,
        providerId,
        inputs: { ...inputs, observations: persistedObservations(inputs, request, result) },
        result,
        status: statusOf(result),
        durationMs,
      });
      await writeLlmAudits(db, id, request.audits);
      return id;
    });

    contributingSessionIds.push(sessionId);
    contributingPathwayIds.push(m.pathway.id);
    resolvedPlans.push(
      projectResolutionToCarePlan(
        result.resolutionState,
        { pathwayId: m.pathway.id, pathwayLogicalId: m.pathway.logicalId, pathwayTitle: m.pathway.title },
        result.catchUpItems,
        { gateContextFields: setsOf(result.gateContextFields) },
      ),
    );
  }

  return { resolvedPlans, contributingSessionIds, contributingPathwayIds };
```

   Catch-up items now come from `evaluate` (plan 02 `catchUpItemsFor`, visited in nodeId
   order), so the in-function REQUIRES loop and its `findUnmetPrerequisites` use are gone.

6. In `care-plan-projection.ts`, in `projectResolutionToCarePlan`'s parameter list, change
   `dependencyMap?: DependencyMap,` to `dependencyMap?: Pick<DependencyMap, 'gateContextFields'>,`.
   The function reads only `gateContextFields`.

- [ ] **Step 4: Move the two multi-pathway suites to the new seam**

In **both** `multi-pathway-resolution.test.ts` and `ddi-multi-pathway.test.ts`:

1. Replace the `session-store` mock with:

```ts
jest.mock('../services/resolution/session-store', () => ({
  getMatchedPathways: jest.fn(),
  insertSession: jest.fn().mockResolvedValue('child-1'),
  writeLlmAudits: jest.fn(),
  getSession: jest.fn(),
}));
```

2. Delete the `jest.mock('../services/resolution/traversal-engine', …)` block and the
   `import { TraversalEngine } …` line.
3. Add, beside the other mocks:

```ts
jest.mock('../services/resolution/pipeline/request', () => ({
  newRequest: () => ({ requestObservations: new Map(), audits: [] }),
  evaluateSession: jest.fn(),
  persistedObservations: (inputs: { observations: unknown }) => inputs.observations,
  inTransaction: (_pool: unknown, fn: (db: unknown) => unknown) => fn({}),
}));
```

   and the import `import { evaluateSession } from '../services/resolution/pipeline/request';`.
4. Replace the `setupTraverseSeq` function with:

```ts
/**
 * Each evaluateSession call resolves the next state. `graphSizes[i] === 0`
 * makes call i an empty graph, which contributes no child session.
 */
function setupEvaluateSeq(states: Array<Map<string, unknown>>, graphSizes: number[] = []) {
  let idx = 0;
  (evaluateSession as jest.Mock).mockImplementation(async (_pool: unknown, _request: unknown, inputs: Record<string, unknown>) => {
    const i = idx++;
    const s = states[Math.min(i, states.length - 1)];
    return {
      env: { resolution: { graphContext: { allNodes: new Array(graphSizes[i] ?? 3).fill({}) } } },
      inputs: { ...inputs, graphFingerprint: 'g' },
      result: {
        resolutionState: s, pendingQuestions: [], redFlags: [], safetyFindings: [], catchUpItems: [],
        gateContextFields: new Map(), status: 'ACTIVE', observationsUsed: [],
      },
      durationMs: 1,
    };
  });
}
```

   and rename every call from `setupTraverseSeq(` to `setupEvaluateSeq(`.

Then, in `multi-pathway-resolution.test.ts` only:

5. In the `session-store` and `resolution-context` imports, replace `createSession` with
   `insertSession, writeLlmAudits`, and drop `makeLlmGateEvaluator`. In the
   `resolution-context` mock, delete the `makeTraversalAdapter` and `makeLlmGateEvaluator`
   keys.
6. `persists per-pathway sessions and a merged session when pathways match`: replace
   `(createSession as jest.Mock)` with `(insertSession as jest.Mock)` and
   `expect(createSession)` with `expect(insertSession)`.
7. Replace the test `stamps one clock instance across the parent, every child, and every engine`
   with:

```ts
  it('stamps one clock instance across the parent, every child, and every evaluation', async () => {
    const a = fakeMatched('a', 'AF');
    const b = fakeMatched('b', 'HFrEF');
    (getMatchedPathways as jest.Mock).mockResolvedValue([a, b]);
    (collapseLattice as jest.Mock).mockResolvedValue([a, b]);
    (insertSession as jest.Mock).mockResolvedValueOnce('per-a').mockResolvedValueOnce('per-b');
    (createMultiPathwaySession as jest.Mock).mockResolvedValue('mp-99');
    (getMultiPathwaySession as jest.Mock).mockResolvedValue(fakeStoredSession({ id: 'mp-99' }));
    setupEvaluateSeq([
      makeResolutionStateWith([{ nodeId: 'med-a', nodeType: 'Medication', properties: { name: 'M', role: 'first_line' } }]),
      makeResolutionStateWith([{ nodeId: 'med-b', nodeType: 'Medication', properties: { name: 'C', role: 'first_line' } }]),
    ]);

    await multiPathwayResolutionMutations.startMultiPathwayResolution({}, { patientId: 'pat-1' }, fakeContext());

    const parent = (createMultiPathwaySession as jest.Mock).mock.calls[0][1];
    const children = (insertSession as jest.Mock).mock.calls.map((c) => c[1].inputs);
    expect(parent.temporalContext).toBeDefined();
    expect(children).toHaveLength(2);
    // `toBe`, NOT `toEqual`: this proves ONE clock object was created and handed
    // down. Two clocks stamped in the same millisecond are structurally equal.
    for (const child of children) expect(child.temporalContext).toBe(parent.temporalContext);
    // …and the evaluations that resolve the horizons received that same object.
    const evaluations = (evaluateSession as jest.Mock).mock.calls;
    expect(evaluations).toHaveLength(2);
    for (const call of evaluations) expect(call[2].temporalContext).toBe(parent.temporalContext);
  });
```

8. `skips a pathway whose graph is empty …`: delete the two `buildResolutionContext` mock lines.
   Replace `(createSession as jest.Mock).mockResolvedValueOnce('per-b')` with
   `(insertSession as jest.Mock).mockResolvedValueOnce('per-b')`. Replace the `setupTraverseSeq`
   call with:

```ts
    setupEvaluateSeq(
      [new Map(), makeResolutionStateWith([{ nodeId: 'm', nodeType: 'Medication', properties: { name: 'Lisinopril', role: 'first_line' } }])],
      [0, 3],
    );
```

   Then change `expect(createSession).toHaveBeenCalledTimes(1)` to
   `expect(insertSession).toHaveBeenCalledTimes(1)`.

9. Replace the whole `describe('resolveAndPersistAll — validation is a preflight', …)` with:

```ts
describe('resolveAndPersistAll — evaluation is a preflight', () => {
  it('writes nothing when a LATER pathway fails evaluation', async () => {
    const a = fakeMatched('a', 'AF');
    const b = fakeMatched('b', 'HFrEF');
    (getMatchedPathways as jest.Mock).mockResolvedValue([a, b]);
    (collapseLattice as jest.Mock).mockResolvedValue([a, b]);
    setupEvaluateSeq([makeResolutionStateWith([{ nodeId: 'med-a', nodeType: 'Medication', properties: { name: 'M', role: 'first_line' } }])]);
    const ok = (evaluateSession as jest.Mock).getMockImplementation()!;
    (evaluateSession as jest.Mock)
      .mockImplementationOnce(ok)
      .mockImplementationOnce(async () => { throw new Error('MISSING_ENCOUNTER_ANCHOR'); });

    await expect(
      multiPathwayResolutionMutations.startMultiPathwayResolution({}, { patientId: 'pat-1' }, fakeContext()),
    ).rejects.toThrow('MISSING_ENCOUNTER_ANCHOR');

    expect(insertSession).not.toHaveBeenCalled();
    expect(writeLlmAudits).not.toHaveBeenCalled();
  });
});
```

Every other test in both files is unchanged: the zero-match paths, `resolveConflict`,
`generateMergedCarePlan`, `abandon`, `applyResolution`, the formatting tests and the DDI
assertions.

- [ ] **Step 5: Run the suites and typecheck**

```bash
npm test --prefix $W/apps/pathway-service -- --runInBand src/__tests__/pipeline-multi-children.test.ts src/__tests__/multi-pathway-resolution.test.ts src/__tests__/ddi-multi-pathway.test.ts src/__tests__/preview-session-isolation.test.ts src/__tests__/temporal/resolution-fact-store-wiring.test.ts src/__tests__/contributing-pathways-resolver.test.ts
$W/node_modules/.bin/tsc -p $W/apps/pathway-service/tsconfig.json --noEmit
```
Expected: PASS; typecheck clean.

**Falsify:** in `resolveAndPersistAll`, move the `inTransaction(… insertSession …)` block into
the first loop, directly after `evaluated.push(…)`. The preflight test must fail with
`insertSession` called once. Restore it.

- [ ] **Step 6: Commit**

```bash
git -C $W add apps/pathway-service/src/resolvers/mutations/multi-pathway-resolution.ts apps/pathway-service/src/services/resolution/care-plan-projection.ts apps/pathway-service/src/__tests__/multi-pathway-resolution.test.ts apps/pathway-service/src/__tests__/ddi-multi-pathway.test.ts apps/pathway-service/src/__tests__/pipeline-multi-children.test.ts
git -C $W commit -m "feat(pathway-service): create multi-pathway child sessions through the pipeline

Children are evaluated with evaluateSession and stored with their inputs,
so the single-pathway mutations can answer them (P3-2). Every pathway is
evaluated before any child is written. Catch-up items and gate context
fields now come from evaluate(). Run composition remains plan 04.

Claude-Session: https://claude.ai/code/session_01XRNkZvQrxmRLNtJHxq71kH"
```

---

### Task 8: Delete the incremental engine and everything only it used

**Files:**
- Delete:
  - `apps/pathway-service/src/services/resolution/findings-reconciliation.ts`
  - `apps/pathway-service/src/services/confidence/scorer-context-inputs.ts`
  - `apps/pathway-service/src/services/resolution/safety.ts` (not `pipeline/safety.ts`)
- Modify:
  - `services/resolution/traversal-engine.ts`
  - `services/resolution/types.ts`
  - `services/resolution/gate-evaluator.ts`
  - `services/confidence/confidence-engine.ts`
  - `services/confidence/types.ts`
  - `services/resolution/session-store.ts`
  - `services/resolution/effective-context.ts`
  - `resolvers/helpers/resolution-context.ts`
  - `services/resolution/care-plan-generator.ts`
  - `services/resolution/index.ts`
  - `resolvers/Mutation.ts`
- Tests: see Step 3. Every retired test is listed in *Appendix A*.

This task is pure deletion. No production behaviour changes: after Tasks 6 and 7 nothing calls
this code. The typecheck is the guide. Delete, run `tsc`, and remove whatever it reports as
referring to a deleted name, **but never add behaviour to make it compile**.

- [ ] **Step 1: Prove the code is dead before deleting it**

```bash
S=$W/apps/pathway-service/src
grep -rnE "resolveIncrementally|makeTraversalAdapter|makeRetraversalAdapter|makeLlmGateEvaluator|\bcreateSession\b|\bupdateSession\b|dependencyContextKey|refreshSessionDdi" $S --include=*.ts | grep -v __tests__ | grep -vE "^\S+:(\s*\*|\s*//)"
```
Expected: only definition sites, and `index.ts` / `Mutation.ts` re-exports. **A call site
anywhere else means Task 6 or 7 is incomplete: stop and report it.**

- [ ] **Step 2: Delete**

1. `git -C $W rm -q` the three files listed under *Delete*.
2. `traversal-engine.ts`:
   - Delete the `findings-reconciliation` import.
   - Delete the `IncrementalResult` interface and the whole `resolveIncrementally` method,
     from its JSDoc (the block starting `Re-resolve part of an existing session in place`)
     through its closing brace.
   - Delete the functions `recordScorerInputs` and `recordInfluence`, and every statement that
     calls them: after the confidence computations for structural, action and DecisionPoint
     nodes, and where a gate result's `dependedOnNodes` are recorded.
   - Delete the `rewritten` set: its declaration in `traverse`, its `WalkContext` field, the
     parameter wherever a helper takes it, and every `rewritten.add(…)` statement. Keep
     `overrideHeld`, `provisional` and `mandated`: `traverse` uses them (spec, *Must stay*).
3. `types.ts`:
   - Change `DependencyMap` to `export interface DependencyMap { gateContextFields: Map<string, Set<string>>; }`.
   - Change `createEmptyDependencyMap` to return `{ gateContextFields: new Map() }`.
   - Delete `RETRAVERSAL_TIMEOUT_MS`, `RetraversalResult`, and the `dependedOnNodes` field of the
     gate result type.
   - In `ResolutionSession`, delete `dependencyMap: DependencyMap;` and make
     `temporalContext: EvaluationTemporalContext;` required, with the comment "Every session
     since migration 067 has one (NOT NULL)".
4. `gate-evaluator.ts`: delete every `dependedOnNodes: …` property, the local
   `const dependedOnNodes: string[] = [];` and its `.push(…)`.
5. `confidence-engine.ts`:
   - Delete the `scorer-context-inputs` import.
   - Delete `contextInputsByNode` and the `nodeInputs` array, including its
     `declareRequiredInputs` push.
   - Delete the `contextInputs:` property of each node result.
   - In `confidence/types.ts`, delete `contextInputs` from `NodeConfidenceResult`.
6. `session-store.ts`: delete `mapOfSetsToObj`, `objToMapOfSets`, `serializeDependencyMap`,
   `deserializeDependencyMap`, `createSession`, `updateSession`, and the `dependencyMap:` line
   in `rowToSession`.
7. `effective-context.ts`: delete `dependencyContextKey`, and any constant only it reads.
8. `resolution-context.ts`: delete `makeTraversalAdapter`, `makeRetraversalAdapter`,
   `PendingAuditRow`, `LlmEvaluatorBundle` and `makeLlmGateEvaluator`, plus the imports only they
   used.
9. `care-plan-generator.ts`: delete `validateForGeneration`, plus the imports only it used.
10. `index.ts`: remove the `IncrementalResult` export and the `./safety` export line. From the
    `session-store` export list remove `serializeDependencyMap`, `deserializeDependencyMap`,
    `createSession` and `updateSession`; from the `care-plan-generator` line remove
    `validateForGeneration`.
11. `resolvers/Mutation.ts`: remove `makeTraversalAdapter` and `makeRetraversalAdapter` from the
    re-export list.

- [ ] **Step 3: Retire and adjust the tests of deleted code**

1. Delete these twelve files; Appendix A maps each test:

```bash
T=apps/pathway-service/src/__tests__
git -C $W rm -q $T/incremental-findings.test.ts $T/incremental-region.test.ts $T/incremental-seed-order.test.ts \
  $T/incremental-timeout.test.ts $T/incremental-traversal.test.ts $T/engine-parity.test.ts \
  $T/findings-reconciliation.test.ts $T/reconcilable-red-flag-types.test.ts $T/scorer-context-inputs.test.ts \
  $T/scorer-declaration-truthfulness.test.ts $T/dependency-context-key.test.ts $T/safety.test.ts
```

2. `session-store.test.ts`: delete `should round-trip DependencyMap through JSON` and
   `should handle empty dependency map`.
3. `confidence-engine.test.ts`: delete the `describe('contextInputs', …)` block (2 tests).
4. `traversal-engine.test.ts`, in `should record influences/influencedBy for prior_node_result
   gate`: delete the two `expect(result.dependencyMap.influences…)` /
   `influencedBy…` lines and the comment above them, and rename the test to
   `a prior_node_result gate on an INCLUDED step is satisfied`. Its two status assertions stay.
5. `branch-mode.test.ts`, in `survives re-disposition instead of re-asking`: replace the
   `await engineWith(…).resolveIncrementally(…);` statement with
   `const again = await engineWith({ 'step-c': 0.2 }).traverse(graph, PATIENT, answers);`, and
   change the three `first.resolutionState` in the assertions to `again.resolutionState`.
   Rename the test to `survives re-evaluation instead of re-asking`.
6. `care-plan-generator.test.ts`: delete `describe('validateForGeneration — unresolved state')`
   and `describe('validateForGeneration')` (11 tests). The `generateCarePlan` tests stay.
7. `gate-evaluator.test.ts` and `gate-evaluator-compound-uncertainty.test.ts`: delete every line
   that asserts on `dependedOnNodes`, and the `dependedOnNodes: [],` property inside the three
   `toEqual` result literals. No other line changes.
8. `temporal/session-temporal-context.test.ts`: delete `createSession writes the temporal
   context as JSON` (Task 2 added its `insertSession` counterpart), and drop `createSession` and
   `createEmptyDependencyMap` from its imports.
9. Replace the `validateForGeneration` tests with readiness equivalents. In
   `pipeline-readiness.test.ts`, inside `describe('readinessOf (C3)', …)`, add:

```ts
  it.each([NodeStatus.TIMEOUT, NodeStatus.CASCADE_LIMIT, NodeStatus.UNKNOWN])(
    'blocks on a %s node, naming it', (s) => {
      const r = readinessOf({ ...base, state: state(n('med', 'Medication', NodeStatus.INCLUDED), n('step-9', 'Step', s)) });
      expect(r.blockers).toContainEqual(expect.objectContaining({ scope: 'COMPLETENESS', type: 'INCOMPLETE_RESOLUTION', relatedNodeIds: ['step-9'] }));
    },
  );

  it.each([NodeStatus.EXCLUDED, NodeStatus.GATED_OUT])('does not block on a decided %s node', (s) => {
    const r = readinessOf({ ...base, state: state(n('med', 'Medication', NodeStatus.INCLUDED), n('step-9', 'Step', s)) });
    expect(r).toMatchObject({ ready: true, blockers: [] });
  });
```

- [ ] **Step 4: Verify, then typecheck and run everything**

```bash
S=$W/apps/pathway-service/src
grep -rn "new TraversalEngine(" $S --include=*.ts | grep -v __tests__
grep -rnE "resolveIncrementally|IncrementalResult|recordScorerInputs|recordInfluence|dependedOnNodes|contextInputs|scorer-context-inputs|findings-reconciliation|dependencyContextKey|makeTraversalAdapter|makeRetraversalAdapter|makeLlmGateEvaluator|RETRAVERSAL_TIMEOUT_MS|RetraversalResult|\bcreateSession\b|\bupdateSession\b|serializeDependencyMap|\brewritten\b" $S --include=*.ts | grep -v __tests__ | grep -vE "^\S+:(\s*\*|\s*//)"
$W/node_modules/.bin/tsc -p $W/apps/pathway-service/tsconfig.json --noEmit
npm test --prefix $W/apps/pathway-service -- --runInBand 2>&1 | grep -E "^(FAIL|Tests:)" | sort | uniq -c
```
Expected:
- The first grep prints exactly one line, in `services/resolution/pipeline/evaluate.ts` (the
  one construction site).
- The second grep prints nothing. Comment lines are filtered out, so if an in-code comment
  still names deleted code, reword it.
- The typecheck is clean.
- The only `FAIL` lines are the two scorer suites.

Also check the tests: `grep -rln "resolveIncrementally\|createSession\|updateSession" $S/__tests__`
may list only `baseline-capture.test.ts` (skipped; P3-4).

**Falsify:** in `pipeline-readiness.test.ts`'s new `it.each`, change `NodeStatus.CASCADE_LIMIT`
in `readiness.ts`'s `INCOMPLETE` list to `NodeStatus.GATED_OUT`. Both new `it.each` blocks must
fail. Restore it.

- [ ] **Step 5: Commit**

```bash
git -C $W add -A apps/pathway-service/src
git -C $W commit -m "refactor(pathway-service): delete the incremental engine

resolveIncrementally, findings reconciliation, scorer context inputs,
dependency influences, the retraversal adapters, the per-request LLM
cache, the dead resolution safety module and the old session store
writers go (spec, What this removes). One TraversalEngine construction
site remains: evaluate(). Retired tests are mapped in plan 03 Appendix A.

Claude-Session: https://claude.ai/code/session_01XRNkZvQrxmRLNtJHxq71kH"
```

---

### Task 9: Sequence-versus-fresh property (a) and the review's reproductions

**Files:**
- Test: `apps/pathway-service/src/__tests__/pipeline-sequence-vs-fresh.test.ts`

**Interfaces:**
- Consumes: the resolvers (Task 6), the harness (Task 4), `evaluate`, `replayObservations`,
  `inputsOf`, `normalizedKey`, `mergeAdditionalContext`, fast-check.

No production code changes are expected. **A failure here is a defect in Tasks 2–8, not in the
test.** Report fast-check's shrunk counterexample before changing anything.

- [ ] **Step 1: Write the test**

Create `apps/pathway-service/src/__tests__/pipeline-sequence-vs-fresh.test.ts`:

```ts
/**
 * Spec §5.3 property (a): applying edits one mutation at a time equals
 * evaluate(final inputs). Plus the single-pathway reproductions of the
 * 2026-09-13 engine review (§5.2; P3-3): #1 and #3 must pass, #9 and #10 are
 * pinned as documented defects.
 */
jest.mock('../services/resolution/session-store', () => require('./fixtures/resolver-harness').sessionStoreMock());
jest.mock('../services/resolution/pipeline/load-env', () => require('./fixtures/resolver-harness').loadEnvMock());

import * as fc from 'fast-check';
import { resolutionMutations } from '../resolvers/mutations/resolution';
import { ScorerRegistry } from '../services/confidence/scorer-registry';
import { GraphNode, ScoringType, SignalDefinition } from '../services/confidence/types';
import { normalizedKey } from '../services/medications/safety-reference';
import { mergeAdditionalContext } from '../services/resolution/effective-context';
import { evaluate } from '../services/resolution/pipeline/evaluate';
import { replayObservations } from '../services/resolution/pipeline/observations';
import type { SessionInputs } from '../services/resolution/pipeline/types';
import { inputsOf } from '../services/resolution/session-store';
import { AnswerType, DefaultBehavior, GateType, NodeStatus, OverrideAction } from '../services/resolution/types';
import { harness } from './fixtures/resolver-harness';
import { edge, makeEnv, makeInputs, node } from './fixtures/pipeline-env';

const PINNED = '2026-08-30T12:00:00.000Z';
const replay = () => replayObservations(new Map(), 'test-model');
const ctx = (version = 'legacy-v0') => harness.context({ temporalPolicyVersion: version });

async function start(pathwayId: string, patient: Record<string, unknown> = {}, version = 'legacy-v0', extra: Record<string, unknown> = {}) {
  const s = await resolutionMutations.startResolution(null as never, {
    pathwayId, patientId: 'pt-1', resolutionMode: 'SYNTHETIC', evaluationAsOf: PINNED,
    patientContext: { patientId: 'pt-1', conditionCodes: [], medications: [], allergies: [], labResults: [], ...patient },
    ...extra,
  } as never, ctx(version));
  return (s as { id: string }).id;
}

/** Re-evaluating what the session stores must give what the session cached. */
async function freshHashOfStored(id: string, env: ReturnType<typeof makeEnv>) {
  return (await evaluate(inputsOf(harness.session(id)), env, replay(), 'ROOT')).resultHash;
}

// ─── Property (a) ──────────────────────────────────────────────────────

const PENICILLIN = { code: '91936005', system: 'SNOMED', display: 'Allergy to penicillin' };
const WARFARIN_RX = { code: '11289', system: 'RxNorm', display: 'Warfarin' };
const MYSTERY_RX = { code: '999', system: 'RxNorm', display: 'Mysterydrug' };
const DRUGS = ['Amoxicillin', 'Warfarin', 'Aspirin'];

/** stage → step-i → gate-i (question) → med-i, for three steps. */
const PROPERTY_ENV = makeEnv(
  [
    node('root', 'Pathway'), node('stage', 'Stage'),
    ...DRUGS.flatMap((drug, i) => [
      node(`step-${i}`, 'Step'),
      node(`gate-${i}`, 'Gate', { gate_type: GateType.QUESTION, default_behavior: DefaultBehavior.SKIP, answer_type: AnswerType.BOOLEAN, prompt: `q${i}` }),
      node(`med-${i}`, 'Medication', { name: drug }),
    ]),
  ],
  [
    edge('root', 'stage'),
    ...DRUGS.flatMap((_, i) => [edge('stage', `step-${i}`), edge(`step-${i}`, `gate-${i}`), edge(`gate-${i}`, `med-${i}`)]),
  ],
  {
    normalized: new Map([
      ['amoxicillin||', { ingredientRxcui: '723', ingredientName: 'amoxicillin', atcClasses: ['J01CA04'] }],
      ['warfarin||', { ingredientRxcui: '11289', ingredientName: 'warfarin', atcClasses: ['B01AA03'] }],
      ['aspirin||', { ingredientRxcui: '1191', ingredientName: 'aspirin', atcClasses: ['B01AC06'] }],
      [normalizedKey({ text: 'Warfarin', system: 'RxNorm', code: '11289' }), { ingredientRxcui: '11289', ingredientName: 'warfarin', atcClasses: ['B01AA03'] }],
    ]),
    pairs: new Map([['11289|1191', { severity: 'SEVERE' as const, mechanism: 'bleeding', clinicalAdvice: null, matchType: 'PAIR' as const, matchedClasses: null }]]),
    allergyMappings: [{ snomedCode: '91936005', snomedDisplay: 'Allergy to penicillin', atcClass: 'J01C' }],
  },
);

type Edit =
  | { kind: 'answer'; i: number; value: boolean }
  | { kind: 'override'; i: number; onStep: boolean; include: boolean }
  | { kind: 'allergy' }
  | { kind: 'patientMed'; unmapped: boolean };

const arbEdit: fc.Arbitrary<Edit> = fc.oneof(
  fc.record({ kind: fc.constant('answer' as const), i: fc.nat(2), value: fc.boolean() }),
  fc.record({ kind: fc.constant('override' as const), i: fc.nat(2), onStep: fc.boolean(), include: fc.boolean() }),
  fc.record({ kind: fc.constant('allergy' as const) }),
  fc.record({ kind: fc.constant('patientMed' as const), unmapped: fc.boolean() }),
);

/** Apply one edit through its mutation. Returns false when the target is not in the cached state (skipped on both sides). */
async function applyEdit(id: string, e: Edit): Promise<boolean> {
  switch (e.kind) {
    case 'answer':
      await resolutionMutations.answerPendingDecision(null, { sessionId: id, nodeId: `gate-${e.i}`, answer: { booleanValue: e.value } }, ctx());
      return true;
    case 'override': {
      const target = e.onStep ? `step-${e.i}` : `med-${e.i}`;
      if (!harness.session(id).resolutionState.has(target)) return false;
      await resolutionMutations.overrideNode(null, { sessionId: id, nodeId: target, action: e.include ? OverrideAction.INCLUDE : OverrideAction.EXCLUDE }, ctx());
      return true;
    }
    case 'allergy':
      await resolutionMutations.addPatientContext(null, { sessionId: id, additionalContext: { allergies: [PENICILLIN] } }, ctx());
      return true;
    case 'patientMed':
      await resolutionMutations.addPatientContext(null, { sessionId: id, additionalContext: { medications: [e.unmapped ? MYSTERY_RX : WARFARIN_RX] } }, ctx());
      return true;
  }
}

/** The final inputs, built from the applied edits alone — not from anything a mutation stored. */
function finalInputs(start: SessionInputs, applied: Edit[]): SessionInputs {
  const inputs: SessionInputs = { ...start, gateAnswers: new Map(), providerOverrides: new Map(), additionalContext: {} };
  for (const e of applied) {
    if (e.kind === 'answer') inputs.gateAnswers.set(`gate-${e.i}`, { booleanValue: e.value });
    if (e.kind === 'override') {
      inputs.providerOverrides.set(e.onStep ? `step-${e.i}` : `med-${e.i}`, {
        action: e.include ? OverrideAction.INCLUDE : OverrideAction.EXCLUDE,
        // Not part of resultHash (spec §1 rule 8); any value will do.
        originalStatus: NodeStatus.UNKNOWN, originalConfidence: 0,
      });
    }
    if (e.kind === 'allergy') inputs.additionalContext = mergeAdditionalContext(inputs.additionalContext, { allergies: [PENICILLIN] });
    if (e.kind === 'patientMed') inputs.additionalContext = mergeAdditionalContext(inputs.additionalContext, { medications: [e.unmapped ? MYSTERY_RX : WARFARIN_RX] });
  }
  return inputs;
}

beforeEach(() => harness.reset());

describe('property (a): edits one at a time equal a fresh evaluation of the final inputs (spec §5.3)', () => {
  it('holds for any sequence of answers, re-answers, overrides, facts', async () => {
    await fc.assert(fc.asyncProperty(fc.array(arbEdit, { maxLength: 8 }), async (edits) => {
      harness.reset();
      harness.addPathway('pw-prop', PROPERTY_ENV);
      const id = await start('pw-prop');
      const startInputs = inputsOf(harness.session(id));

      const applied: Edit[] = [];
      for (const e of edits) if (await applyEdit(id, e)) applied.push(e);

      const stored = harness.session(id).resultHash;
      const fresh = await evaluate(finalInputs(startInputs, applied), PROPERTY_ENV, replay(), 'ROOT');
      expect(stored).toBe(fresh.resultHash);
      expect(await freshHashOfStored(id, PROPERTY_ENV)).toBe(stored);
    }), { numRuns: 30 });
  });

  it('positive control: the edits change the plan, so the property is not vacuous', async () => {
    harness.addPathway('pw-prop', PROPERTY_ENV);
    const id = await start('pw-prop');
    const before = harness.session(id).resultHash;
    await applyEdit(id, { kind: 'answer', i: 0, value: true });
    expect(harness.session(id).resultHash).not.toBe(before);
    await applyEdit(id, { kind: 'allergy' });
    expect(harness.session(id).resolutionState.get('med-0')!.disposition).toMatchObject({ withheldBy: 'safety' });
  });
});

// ─── Review reproductions (spec §5.2) ──────────────────────────────────

describe('review #1 — a nested gate cannot reopen under a closed ancestor (must pass)', () => {
  const NESTED = makeEnv(
    [
      node('root', 'Pathway'),
      node('outer', 'Gate', { gate_type: GateType.QUESTION, answer_type: AnswerType.BOOLEAN, default_behavior: DefaultBehavior.SKIP, prompt: 'Outer?' }),
      node('step', 'Step'),
      node('inner', 'Gate', { gate_type: GateType.PATIENT_ATTRIBUTE, default_behavior: DefaultBehavior.SKIP,
        condition: { field: 'labs', operator: 'less_than', value: '718-7', system: 'LOINC', threshold: 7 } }),
      node('med', 'Medication', { name: 'Amoxicillin' }),
    ],
    [edge('root', 'outer'), edge('outer', 'step'), edge('step', 'inner'), edge('inner', 'med')],
    { normalized: new Map([['amoxicillin||', { ingredientRxcui: '723', ingredientName: 'amoxicillin', atcClasses: ['J01CA04'] }]]) },
  );

  it('outer yes, then no, then a context update: the medication stays out, and equals a fresh evaluation', async () => {
    harness.addPathway('pw-nested', NESTED);
    const id = await start('pw-nested', { labResults: [{ code: '718-7', system: 'LOINC', value: 6 }] });

    await resolutionMutations.answerPendingDecision(null, { sessionId: id, nodeId: 'outer', answer: { booleanValue: true } }, ctx());
    expect(harness.session(id).resolutionState.get('med')!.status).toBe(NodeStatus.INCLUDED);

    await resolutionMutations.answerPendingDecision(null, { sessionId: id, nodeId: 'outer', answer: { booleanValue: false } }, ctx());
    // The context update is what re-seeded the inner gate on main and reopened the medication.
    await resolutionMutations.addPatientContext(null, { sessionId: id, additionalContext: { labResults: [{ code: '718-7', system: 'LOINC', value: 6.5, date: '2026-08-29' }] } }, ctx());

    expect(harness.session(id).resolutionState.get('outer')!.status).toBe(NodeStatus.GATED_OUT);
    expect(harness.session(id).resolutionState.get('med')!.status).not.toBe(NodeStatus.INCLUDED);
    expect(await freshHashOfStored(id, NESTED)).toBe(harness.session(id).resultHash);
  });
});

describe('review #3 — traversal uses whole-graph confidence propagation (must pass)', () => {
  it('a Step fed by a weak lab scores 0.3 × 0.8 = 0.24, not its own 0.9', async () => {
    const signal: SignalDefinition = {
      id: '00000000-0000-4000-a000-000000000001', name: 'data_completeness', displayName: 'Data Completeness', description: '',
      scoringType: ScoringType.DATA_PRESENCE, scoringRules: {},
      propagationConfig: { mode: 'transitive_with_decay', decayFactor: 0.8, maxHops: 3 },
      scope: 'SYSTEM', defaultWeight: 1, isActive: true,
    };
    const registry = new ScorerRegistry();
    registry.register({
      scoringType: ScoringType.DATA_PRESENCE,
      declareRequiredInputs: () => [],
      score: ({ node: n }: { node: GraphNode }) =>
        n.nodeIdentifier === 'lab-1' ? { score: 0.3, missingInputs: ['result_value'] } : { score: 0.9, missingInputs: [] },
      propagate: ({ sourceScore, hopDistance, propagationConfig }: { sourceScore: number; hopDistance: number; propagationConfig: { decayFactor?: number } }) => ({
        propagatedScore: sourceScore * Math.pow(propagationConfig.decayFactor ?? 0.8, hopDistance),
        shouldPropagate: true,
      }),
    } as never);
    // lab-1 is not on the walk; it is scored because scoring is whole-graph (spec §2 stage 2).
    const env = makeEnv(
      [node('root', 'Pathway'), node('lab-1', 'LabTest'), node('step-1', 'Step')],
      [edge('root', 'step-1'), edge('lab-1', 'step-1', 'HAS_LAB_TEST')],
      {},
      { signals: [signal], registry },
    );

    const r = await evaluate(makeInputs(env), env, replay(), 'ROOT');
    expect(r.resolutionState.get('step-1')!.confidence).toBeCloseTo(0.24, 2);
  });
});

describe('review #9 — a shared downstream action through the selected arm (PINNED DEFECT)', () => {
  // Out of scope (spec, Out of scope): first-writer-wins across reconverging
  // branches stays, now deterministic. This pins today's behaviour so a change
  // is noticed. If it starts failing because `shared` is INCLUDED, #9 has been
  // fixed: flip the assertion and say so in the commit.
  it('excluding arm b sweeps the shared medication before arm a reaches it', async () => {
    const env = makeEnv(
      [
        node('root', 'Pathway'),
        node('q', 'Gate', { gate_type: GateType.QUESTION, answer_type: AnswerType.SELECT, options: ['a', 'b'], default_behavior: DefaultBehavior.SKIP, prompt: 'Which?' }),
        node('a', 'Step'), node('b', 'Step'), node('shared', 'Medication', { name: 'Amoxicillin' }),
      ],
      [
        edge('root', 'q'),
        edge('q', 'a', 'BRANCHES_TO', { when: { equals: 'a' } }), edge('q', 'b', 'BRANCHES_TO', { when: { equals: 'b' } }),
        edge('a', 'shared'), edge('b', 'shared'),
      ],
    );
    const r = await evaluate(makeInputs(env, { gateAnswers: new Map([['q', { selectedOption: 'a' }]]) }), env, replay(), 'ROOT');
    expect(r.resolutionState.get('a')!.status).toBe(NodeStatus.INCLUDED);
    expect(r.resolutionState.get('shared')!.status).toBe(NodeStatus.EXCLUDED);
  });
});

describe('review #10 — a vital answer does not reach the gate that asked (PINNED DEFECT)', () => {
  // Out of scope (spec, Out of scope #10): the answer is stored under the flat
  // key "vitals.systolic_bp" while evaluation reads "systolic_bp". Pinned so a
  // fix is noticed; flip both assertions when it lands.
  it('stores the answer under the namespaced key and leaves the gate pending', async () => {
    harness.addPathway('pw-bp', makeEnv(
      [
        node('root', 'Pathway'),
        node('bp', 'Gate', { gate_type: GateType.PATIENT_ATTRIBUTE, default_behavior: DefaultBehavior.SKIP,
          condition: { attribute: 'vitals.systolic_bp', operator: 'greater_than', value: 160 } }),
        node('step', 'Step'),
      ],
      [edge('root', 'bp'), edge('bp', 'step')],
    ));
    const id = await start('pw-bp', {}, 'v1', { encounterStart: '2026-08-30T08:00:00.000Z' });
    expect(harness.session(id).pendingQuestions[0].gateId).toBe('bp');

    await resolutionMutations.answerPendingDecision(null, { sessionId: id, nodeId: 'bp', answer: { numericValue: 180 } }, ctx('v1'));

    const s = harness.session(id);
    expect((s.additionalContext as { vitalSigns: Record<string, unknown> }).vitalSigns).toEqual({ 'vitals.systolic_bp': 180 });
    expect(s.resolutionState.get('bp')!.status).toBe(NodeStatus.PENDING_QUESTION);
  });
});
```

- [ ] **Step 2: Run it**

Run: `npm test --prefix $W/apps/pathway-service -- --runInBand src/__tests__/pipeline-sequence-vs-fresh.test.ts`
Expected: PASS. If #9 or #10 fails because the behaviour now differs, record the observed
statuses in the report: the pins document today's behaviour, and a change there needs a
decision.

**Falsify, one at a time, restoring each:**
1. In `resolution.ts`'s `addPatientContext`, replace `mergeAdditionalContext(inputs.additionalContext, additionalContext)`
   with `additionalContext`. Property (a) must fail: two fact edits keep only the last.
2. In `session-store.ts`'s `inputsOf`, return `gateAnswers: new Map()`. Property (a) and #1 must
   fail.

- [ ] **Step 3: Commit**

```bash
git -C $W add apps/pathway-service/src/__tests__/pipeline-sequence-vs-fresh.test.ts
git -C $W commit -m "test(pathway-service): sequence-versus-fresh property and review reproductions

Property (a): any sequence of answers, re-answers, overrides and facts
applied through the mutations equals evaluate() of the final inputs.
Review #1 (nested gates) and #3 (whole-graph scoring) pass; #9 and #10
are pinned as documented defects (spec §5.2).

Claude-Session: https://claude.ai/code/session_01XRNkZvQrxmRLNtJHxq71kH"
```

---

### Task 10: Pre-warm wiring and the normalisation backfill (D14)

**Files:**
- Create: `apps/pathway-service/src/services/medications/prewarm-pathway.ts`
- Modify: `apps/pathway-service/src/resolvers/mutations/import.ts`
- Create: `apps/pathway-service/src/scripts/backfill-medication-normalization.ts`
- Test: `apps/pathway-service/src/__tests__/prewarm-pathway-medications.test.ts`

**Interfaces:**
- Consumes: `buildResolutionContext`; `medicationName` (plan 02 `load-env.ts`: the exact name
  evaluation looks up, so a pre-warmed row is the row evaluation will find);
  `prewarmMedications`.
- Produces:
  - `pathwayMedicationNames(pool: Pool, pathwayId: string): Promise<string[]>`
  - `prewarmPathwayMedications(pool: Pool, pathwayId: string): Promise<{ total: number; succeeded: number; failed: number }>`
  - `prewarmPathwayInBackground(pool: Pool, pathwayId: string, trigger: 'import' | 'activate'): void`
  - `backfill(pool: Pool, opts: { dryRun: boolean; log: (line: string) => void }): Promise<{ pathways: number; succeeded: number; failed: number }>`

- [ ] **Step 1: Write the failing test**

Create `apps/pathway-service/src/__tests__/prewarm-pathway-medications.test.ts`:

```ts
jest.mock('../resolvers/helpers/resolution-context', () => ({
  ...jest.requireActual('../resolvers/helpers/resolution-context'),
  buildResolutionContext: jest.fn(),
}));
jest.mock('../services/medications/normalizer', () => ({
  ...jest.requireActual('../services/medications/normalizer'),
  prewarmMedications: jest.fn(),
}));
jest.mock('../services/import/import-orchestrator', () => ({ importPathway: jest.fn() }));

import { buildGraphContext, buildResolutionContext } from '../resolvers/helpers/resolution-context';
import { importMutations } from '../resolvers/mutations/import';
import { backfill } from '../scripts/backfill-medication-normalization';
import { prewarmMedications } from '../services/medications/normalizer';
import { pathwayMedicationNames, prewarmPathwayInBackground, prewarmPathwayMedications } from '../services/medications/prewarm-pathway';
import { importPathway } from '../services/import/import-orchestrator';

const graphWith = (...meds: Array<Record<string, unknown>>) => ({
  graphContext: buildGraphContext(
    [{ id: 'r', nodeIdentifier: 'root', nodeType: 'Pathway', properties: {} },
      ...meds.map((p, i) => ({ id: `m${i}`, nodeIdentifier: `med-${i}`, nodeType: 'Medication', properties: p }))] as never,
    [],
  ),
});
const flush = () => new Promise((r) => setImmediate(r));

beforeEach(() => {
  jest.clearAllMocks();
  (prewarmMedications as jest.Mock).mockResolvedValue({ succeeded: 2, failed: 0 });
});

describe('pathway medication pre-warm (D14)', () => {
  it('names each medication exactly as evaluation looks it up, once, sorted', async () => {
    (buildResolutionContext as jest.Mock).mockResolvedValue(graphWith({ name: 'Labetalol' }, { title: 'Nifedipine' }, { name: 'Labetalol' }));
    expect(await pathwayMedicationNames({} as never, 'pw')).toEqual(['Labetalol', 'Nifedipine']);

    expect(await prewarmPathwayMedications({} as never, 'pw')).toEqual({ total: 2, succeeded: 2, failed: 0 });
    expect(prewarmMedications).toHaveBeenCalledWith({}, [{ text: 'Labetalol' }, { text: 'Nifedipine' }]);
  });

  it('in the background, never throws and never rejects', async () => {
    (buildResolutionContext as jest.Mock).mockRejectedValue(new Error('age down'));
    expect(() => prewarmPathwayInBackground({} as never, 'pw', 'import')).not.toThrow();
    await flush(); // an unhandled rejection would fail the run
  });

  it('import pre-warms the imported pathway without waiting for it', async () => {
    (importPathway as jest.Mock).mockResolvedValue({ pathwayId: 'pw-new', validation: { valid: true, errors: [], warnings: [] }, diff: null, importType: 'NEW_PATHWAY' });
    (buildResolutionContext as jest.Mock).mockReturnValue(new Promise(() => undefined)); // never settles
    const pool = { query: jest.fn().mockResolvedValue({ rows: [{ id: 'pw-new' }] }) };

    const result = await importMutations.importPathway(null, { pathwayJson: '{}', importMode: 'NEW_PATHWAY' as never }, { pool, userId: 'u' } as never);

    expect(result.pathway).toEqual({ id: 'pw-new' });
    expect(buildResolutionContext).toHaveBeenCalledWith(pool, 'pw-new');
  });

  it('an invalid import pre-warms nothing', async () => {
    (importPathway as jest.Mock).mockResolvedValue({ validation: { valid: false, errors: ['x'], warnings: [] }, importType: 'NEW_PATHWAY' });
    await importMutations.importPathway(null, { pathwayJson: '{}', importMode: 'NEW_PATHWAY' as never }, { pool: { query: jest.fn() }, userId: 'u' } as never);
    expect(buildResolutionContext).not.toHaveBeenCalled();
  });

  it('activation pre-warms the activated pathway without waiting for it', async () => {
    (buildResolutionContext as jest.Mock).mockReturnValue(new Promise(() => undefined));
    const pool = { query: jest.fn().mockResolvedValue({ rows: [{ id: 'pw-1', previousStatus: 'DRAFT' }] }) };
    const r = await importMutations.activatePathway(null, { id: 'pw-1' }, { pool } as never);
    expect(r.previousStatus).toBe('DRAFT');
    expect(buildResolutionContext).toHaveBeenCalledWith(pool, 'pw-1');
  });

  it('the backfill covers ACTIVE and DRAFT pathways; a dry run calls nothing external', async () => {
    (buildResolutionContext as jest.Mock).mockResolvedValue(graphWith({ name: 'Labetalol' }));
    const pool = { query: jest.fn().mockResolvedValue({ rows: [
      { id: 'a', title: 'HTN', version: '1.0', status: 'ACTIVE' },
      { id: 'd', title: 'HTN', version: '1.1', status: 'DRAFT' },
    ] }) };
    const lines: string[] = [];

    const dry = await backfill(pool as never, { dryRun: true, log: (l) => lines.push(l) });
    expect(prewarmMedications).not.toHaveBeenCalled();
    expect(lines).toEqual(['ACTIVE HTN@1.0: Labetalol', 'DRAFT HTN@1.1: Labetalol']);
    expect(dry.pathways).toBe(2);
    expect(pool.query.mock.calls[0][0]).toContain("status IN ('ACTIVE', 'DRAFT')");

    (prewarmMedications as jest.Mock).mockResolvedValue({ succeeded: 1, failed: 0 });
    expect(await backfill(pool as never, { dryRun: false, log: () => undefined })).toEqual({ pathways: 2, succeeded: 2, failed: 0 });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test --prefix $W/apps/pathway-service -- --runInBand src/__tests__/prewarm-pathway-medications.test.ts`
Expected: FAIL with `Cannot find module '../scripts/backfill-medication-normalization'`.

- [ ] **Step 3: Create `services/medications/prewarm-pathway.ts`**

```ts
import type { Pool } from 'pg';
import { buildResolutionContext } from '../../resolvers/helpers/resolution-context';
import { medicationName } from '../resolution/pipeline/load-env';
import { prewarmMedications } from './normalizer';

/** Every Medication node name in a pathway, named exactly as evaluation's candidate universe names them. */
export async function pathwayMedicationNames(pool: Pool, pathwayId: string): Promise<string[]> {
  const { graphContext } = await buildResolutionContext(pool, pathwayId);
  const names = graphContext.allNodes.filter((n) => n.nodeType === 'Medication').map((n) => medicationName(n));
  return [...new Set(names)].sort();
}

/**
 * Normalise a pathway's medications through RxNav (D14). A no-match is cached
 * as a NULL row for the admin queue; a network error is left for the next try.
 */
export async function prewarmPathwayMedications(
  pool: Pool,
  pathwayId: string,
): Promise<{ total: number; succeeded: number; failed: number }> {
  const names = await pathwayMedicationNames(pool, pathwayId);
  const { succeeded, failed } = await prewarmMedications(pool, names.map((text) => ({ text })));
  return { total: names.length, succeeded, failed };
}

/** Best effort: import and activation never fail, or wait, because RxNav is slow or down (spec §4, Deployment). */
export function prewarmPathwayInBackground(pool: Pool, pathwayId: string, trigger: 'import' | 'activate'): void {
  void prewarmPathwayMedications(pool, pathwayId)
    .then((r) => console.info(`[prewarm] ${trigger} ${pathwayId}: ${r.succeeded}/${r.total} normalised, ${r.failed} not`))
    .catch((err) => console.warn(`[prewarm] ${trigger} ${pathwayId} failed:`, err instanceof Error ? err.message : err));
}
```

- [ ] **Step 4: Wire it into import and activation**

In `resolvers/mutations/import.ts`:

1. Add `import { prewarmPathwayInBackground } from '../../services/medications/prewarm-pathway';`.
2. In `importPathway`, directly after the `if (!result.validation.valid) { … }` block and
   before `// Fetch the created/updated pathway for the response`, add:

```ts
    // D14: normalise the new graph's medications, without blocking the import.
    prewarmPathwayInBackground(context.pool, result.pathwayId, 'import');
```

3. In `activatePathway`, directly before `const { previousStatus, ...pathway } = result.rows[0];`, add:

```ts
    // D14: an activated pathway's medications should be normalised before the first session.
    prewarmPathwayInBackground(pool, args.id, 'activate');
```

- [ ] **Step 5: Create the backfill script**

Create `apps/pathway-service/src/scripts/backfill-medication-normalization.ts`:

```ts
/**
 * One-off D14 backfill: normalise every Medication node name in ACTIVE and
 * DRAFT pathways. Run on live after this plan deploys and before generation
 * is used (plan 05). The live cache holds 0 rows, so without this every plan
 * blocks on SAFETY_DATA_UNAVAILABLE.
 *
 *   export POSTGRES_PASSWORD=…   # pm2 env 0, ANSI-stripped (CLAUDE.md)
 *   node apps/pathway-service/dist/scripts/backfill-medication-normalization.js --dry-run
 *   node apps/pathway-service/dist/scripts/backfill-medication-normalization.js
 *
 * Then triage what RxNav could not map through the unnormalizedMedications
 * admin queue and manuallyResolveMedicationNormalization.
 */
import { Pool } from 'pg';
import { pathwayMedicationNames, prewarmPathwayMedications } from '../services/medications/prewarm-pathway';

export async function backfill(
  pool: Pool,
  opts: { dryRun: boolean; log: (line: string) => void },
): Promise<{ pathways: number; succeeded: number; failed: number }> {
  const { rows } = await pool.query<{ id: string; title: string; version: string; status: string }>(
    `SELECT id, title, version, status FROM pathway_graph_index
      WHERE status IN ('ACTIVE', 'DRAFT') ORDER BY title, version`,
  );
  let succeeded = 0;
  let failed = 0;
  for (const p of rows) {
    if (opts.dryRun) {
      const names = await pathwayMedicationNames(pool, p.id);
      opts.log(`${p.status} ${p.title}@${p.version}: ${names.join(', ') || '(no medications)'}`);
      continue;
    }
    const r = await prewarmPathwayMedications(pool, p.id);
    succeeded += r.succeeded;
    failed += r.failed;
    opts.log(`${p.status} ${p.title}@${p.version}: ${r.succeeded}/${r.total} normalised`);
  }
  return { pathways: rows.length, succeeded, failed };
}

if (require.main === module) {
  const pool = new Pool({
    host: process.env.POSTGRES_HOST ?? 'localhost',
    port: Number(process.env.POSTGRES_PORT ?? 5432),
    user: process.env.POSTGRES_USER ?? 'prism',
    password: process.env.POSTGRES_PASSWORD,
    database: process.env.POSTGRES_DB ?? 'prism_db',
  });
  // Graph reads go through Apache AGE, as in the service itself.
  pool.on('connect', (client) => {
    client.query(`LOAD 'age'; SET search_path = ag_catalog, "$user", public;`).catch(() => undefined);
  });
  backfill(pool, { dryRun: process.argv.includes('--dry-run'), log: (line) => console.log(line) })
    .then((s) => console.log(`${s.pathways} pathways: ${s.succeeded} normalised, ${s.failed} not (see the unnormalizedMedications admin queue)`))
    .catch((err) => {
      console.error(err);
      process.exitCode = 1;
    })
    .finally(() => pool.end());
}
```

- [ ] **Step 6: Run the tests, typecheck and build**

```bash
npm test --prefix $W/apps/pathway-service -- --runInBand src/__tests__/prewarm-pathway-medications.test.ts src/__tests__/medication-normalizer.test.ts
$W/node_modules/.bin/tsc -p $W/apps/pathway-service/tsconfig.json --noEmit
npm run build --prefix $W/apps/pathway-service && ls $W/apps/pathway-service/dist/scripts/backfill-medication-normalization.js
```
Expected: PASS; typecheck clean; the compiled script exists. **Do not run the script against
any database here**: plan 05 runs it on live.

**Falsify:** delete the `prewarmPathwayInBackground(pool, args.id, 'activate');` line. The
activation test must fail. Restore it.

- [ ] **Step 7: Commit**

```bash
git -C $W add apps/pathway-service/src/services/medications/prewarm-pathway.ts apps/pathway-service/src/resolvers/mutations/import.ts apps/pathway-service/src/scripts/backfill-medication-normalization.ts apps/pathway-service/src/__tests__/prewarm-pathway-medications.test.ts
git -C $W commit -m "feat(pathway-service): pre-warm medication normalisation at import and activation

Import and activation start a non-blocking RxNav pre-warm of the
pathway's medications, named exactly as evaluation looks them up. A
backfill script (dry-run first) covers existing ACTIVE and DRAFT
pathways before generation is used on live (D14).

Claude-Session: https://claude.ai/code/session_01XRNkZvQrxmRLNtJHxq71kH"
```

---

### Task 11: Opt-in Postgres tests (spec §5.6)

**Files:**
- Test: `apps/pathway-service/src/__tests__/pipeline-postgres.test.ts`

These tests **write**, so they run only against a scratch database that the executor creates
and drops. They are skipped unless `RUN_PIPELINE_PG_TESTS=1`, and they refuse any database whose
name does not contain `scratch`.

**Interfaces:**
- Consumes: migration 067 (Task 1), the real store (Task 2), the resolvers (Task 6), `evaluateSession`, and the
  harness's `loadEnvMock` (the scratch database has no AGE graph).

- [ ] **Step 1: Write the test**

Create `apps/pathway-service/src/__tests__/pipeline-postgres.test.ts`:

```ts
/**
 * Opt-in Postgres tests (spec §5.6). They WRITE, so never against prism_db.
 *
 * Setup — a fresh scratch database each run (the purge test inserts a
 * pre-067 session before applying 067):
 *
 *   export PGPASSWORD=$(pm2 env 0 | sed 's/\x1b\[[0-9;]*m//g' | awk -F': ' '/^POSTGRES_PASSWORD/{print $2}')
 *   dropdb -h localhost -U prism --if-exists prism_eval_scratch
 *   createdb -h localhost -U prism prism_eval_scratch
 *   pg_dump -h localhost -U prism --schema-only --no-owner prism_db | psql -q -h localhost -U prism prism_eval_scratch
 *
 * (AGE statements in the dump may fail without superuser; these tests do not
 * read the graph, so that is fine.) Run:
 *
 *   RUN_PIPELINE_PG_TESTS=1 PIPELINE_PG_DATABASE=prism_eval_scratch POSTGRES_PASSWORD=$PGPASSWORD \
 *     npm test --prefix $W/apps/pathway-service -- --runInBand src/__tests__/pipeline-postgres.test.ts
 *
 * Afterwards: dropdb -h localhost -U prism prism_eval_scratch
 */
jest.mock('../services/resolution/pipeline/load-env', () => require('./fixtures/resolver-harness').loadEnvMock());

import { randomUUID } from 'crypto';
import { readFileSync } from 'fs';
import { join } from 'path';
import { Pool } from 'pg';
import { resolutionMutations } from '../resolvers/mutations/resolution';
import { loadEvaluationEnv } from '../services/resolution/pipeline/load-env';
import { evaluateSession, inTransaction, newRequest } from '../services/resolution/pipeline/request';
import { createMultiPathwaySession } from '../services/resolution/multi-pathway-session-store';
import { insertSession, logEvent, writeEvaluation } from '../services/resolution/session-store';
import { SessionStatus } from '../services/resolution/types';
import { harness } from './fixtures/resolver-harness';
import { edge, makeEnv, makeInputs, node } from './fixtures/pipeline-env';

const describePg = process.env.RUN_PIPELINE_PG_TESTS === '1' ? describe : describe.skip;
const PATHWAY_ID = '00000000-0000-4000-a000-00000000e067';
const ENV = makeEnv(
  [node('root', 'Pathway'), node('stage', 'Stage'), node('step', 'Step'), node('med', 'Medication', { name: 'Amoxicillin' })],
  [edge('root', 'stage'), edge('stage', 'step'), edge('step', 'med')],
  { normalized: new Map([['amoxicillin||', { ingredientRxcui: '723', ingredientName: 'amoxicillin', atcClasses: ['J01CA04'] }]]) },
);

describePg('the evaluation pipeline against Postgres (scratch database)', () => {
  const database = process.env.PIPELINE_PG_DATABASE ?? '';
  let pool: Pool;

  async function newSession(): Promise<{ id: string; patientId: string }> {
    const patientId = randomUUID();
    const { inputs, result, durationMs } = await evaluateSession(pool, newRequest(), makeInputs(ENV, { pathwayId: PATHWAY_ID }), 'ROOT');
    const id = await insertSession(pool, { pathwayVersion: '1.0', patientId, providerId: randomUUID(), inputs, result, status: SessionStatus.ACTIVE, durationMs });
    return { id, patientId };
  }

  beforeAll(async () => {
    if (!database.includes('scratch') || database === 'prism_db') {
      throw new Error(`refusing database "${database}": set PIPELINE_PG_DATABASE to a scratch database`);
    }
    pool = new Pool({
      host: process.env.POSTGRES_HOST ?? 'localhost',
      port: Number(process.env.POSTGRES_PORT ?? 5432),
      user: process.env.POSTGRES_USER ?? 'prism',
      password: process.env.POSTGRES_PASSWORD,
      database,
    });
    harness.reset();
    harness.addPathway(PATHWAY_ID, ENV);

    // A pathway, and a PRE-067 session with an event, so the purge is observable.
    await pool.query(
      `INSERT INTO pathway_graph_index (id, logical_id, title, version, category, status, is_active)
       VALUES ($1, 'lp-e067', 'Pipeline scratch', '1.0', 'CHRONIC_DISEASE', 'ACTIVE', true)`,
      [PATHWAY_ID],
    );
    const old = await pool.query(
      `INSERT INTO pathway_resolution_sessions (patient_id, provider_id, pathway_id, status, temporal_context)
       VALUES (gen_random_uuid(), gen_random_uuid(), $1, 'ACTIVE', $2) RETURNING id`,
      [PATHWAY_ID, JSON.stringify(makeInputs(ENV).temporalContext)],
    );
    await pool.query(`INSERT INTO pathway_resolution_events (session_id, event_type, trigger_data) VALUES ($1, 'override', '{}')`, [old.rows[0].id]);

    await pool.query(readFileSync(join(__dirname, '../../../../shared/data-layer/migrations/067_evaluation_inputs.sql'), 'utf-8'));
  }, 60_000);

  afterAll(async () => {
    await pool?.end();
  });

  it('067 purged every session and, by cascade, its events (D8)', async () => {
    const sessions = await pool.query(`SELECT count(*)::int AS n FROM pathway_resolution_sessions`);
    const events = await pool.query(`SELECT count(*)::int AS n FROM pathway_resolution_events`);
    expect([sessions.rows[0].n, events.rows[0].n]).toEqual([0, 0]);
  });

  it('067 reshaped the table', async () => {
    const { rows } = await pool.query(
      `SELECT column_name, is_nullable FROM information_schema.columns WHERE table_name = 'pathway_resolution_sessions'`,
    );
    const cols = new Map(rows.map((r) => [r.column_name, r.is_nullable]));
    for (const c of ['revision', 'provider_overrides', 'observations', 'graph_fingerprint', 'env_fingerprint',
      'result_hash', 'readiness', 'gate_context_fields', 'catch_up_items', 'parent_session_id']) {
      expect(cols.has(c)).toBe(true);
    }
    expect(cols.has('dependency_map')).toBe(false);
    expect(cols.get('temporal_context')).toBe('NO');
  });

  it('067 admits the event types the resolvers write, and still rejects others', async () => {
    const { id } = await newSession();
    await logEvent(pool, id, { eventType: 'BRANCH_CHOSEN', triggerData: {}, nodesRecomputed: 0, statusChanges: [] });
    await logEvent(pool, id, { eventType: 'PROVIDER_ASSERTED_DATUM', triggerData: {}, nodesRecomputed: 0, statusChanges: [] });
    await expect(logEvent(pool, id, { eventType: 'bogus', triggerData: {}, nodesRecomputed: 0, statusChanges: [] }))
      .rejects.toThrow(/pathway_resolution_events_event_type_check/);
  });

  it('067 forbids patient facts on a child of a run', async () => {
    const { id } = await newSession();
    const parent = await createMultiPathwaySession(pool, {
      patientId: randomUUID(), providerId: randomUUID(), initialPatientContext: {},
      contributingSessionIds: [], contributingPathwayIds: [], mergedPlan: {} as never,
      temporalContext: makeInputs(ENV).temporalContext,
    } as never);
    await expect(pool.query(
      `UPDATE pathway_resolution_sessions SET parent_session_id = $1, additional_context = '{"allergies": []}' WHERE id = $2`,
      [parent, id],
    )).rejects.toThrow(/pathway_resolution_sessions_child_has_no_facts/);
  });

  it('revision lock: of two concurrent writes at one revision, exactly one commits', async () => {
    const { id } = await newSession();
    const { inputs, result, durationMs } = await evaluateSession(pool, newRequest(), makeInputs(ENV, { pathwayId: PATHWAY_ID }), 'ROOT');
    const write = () => inTransaction(pool, (db) => writeEvaluation(db, {
      sessionId: id, expectedRevision: 0, inputs, result, status: SessionStatus.ACTIVE, durationMs,
    }));

    const outcomes = await Promise.all([write(), write()]);

    expect(outcomes.sort()).toEqual([false, true]);
    expect((await pool.query('SELECT revision FROM pathway_resolution_sessions WHERE id = $1', [id])).rows[0].revision).toBe(1);
  });

  it('two concurrent generations yield exactly one care plan, and both return it (#8)', async () => {
    const { id, patientId } = await newSession();
    const reviewed = (await pool.query('SELECT result_hash FROM pathway_resolution_sessions WHERE id = $1', [id])).rows[0].result_hash;
    const generate = () => resolutionMutations.generateCarePlanFromResolution(
      null, { sessionId: id, reviewedResultHash: reviewed }, { pool, userId: randomUUID() } as never,
    );

    const [a, b] = await Promise.all([generate(), generate()]);

    expect(a.success && b.success).toBe(true);
    expect(a.carePlanId).toBe(b.carePlanId);
    const plans = await pool.query('SELECT count(*)::int AS n FROM patient_care_plans WHERE patient_id = $1', [patientId]);
    expect(plans.rows[0].n).toBe(1);
  });

  it('generation on a COMPLETED session returns its plan without evaluating', async () => {
    const { id } = await newSession();
    const reviewed = (await pool.query('SELECT result_hash FROM pathway_resolution_sessions WHERE id = $1', [id])).rows[0].result_hash;
    const ctx = { pool, userId: randomUUID() } as never;
    const first = await resolutionMutations.generateCarePlanFromResolution(null, { sessionId: id, reviewedResultHash: reviewed }, ctx);
    (loadEvaluationEnv as jest.Mock).mockClear();

    const again = await resolutionMutations.generateCarePlanFromResolution(null, { sessionId: id, reviewedResultHash: 'stale' }, ctx);

    expect(again.carePlanId).toBe(first.carePlanId);
    expect(loadEvaluationEnv).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Confirm it is skipped by default**

Run: `npm test --prefix $W/apps/pathway-service -- --runInBand src/__tests__/pipeline-postgres.test.ts`
Expected: `Tests: 7 skipped`.

- [ ] **Step 3: Run it against a scratch database**

Follow the setup in the file header, then run the command it gives.
Expected: 7 passed. Then `dropdb -h localhost -U prism prism_eval_scratch`.
- If `createdb` is not permitted for `prism`, **stop and report**. Do not run these tests
  against any other database.
- If the event-type constraint name differs, migration 067 fails loudly at this step. Report
  the actual name (`\d pathway_resolution_events` in the scratch database) and stop: it means
  067 needs correcting.

**Falsify:** in a fresh scratch database, apply a copy of 067 with the
`pathway_resolution_sessions_child_has_no_facts` constraint removed, and run only the child-facts
test. It must fail. Recreate the scratch database.

- [ ] **Step 4: Commit**

```bash
git -C $W add apps/pathway-service/src/__tests__/pipeline-postgres.test.ts
git -C $W commit -m "test(pathway-service): opt-in Postgres tests for migration 067, revision lock and generation

Against a scratch database only: 067 purges and reshapes, admits the
resolvers' event types, forbids facts on a run child; concurrent writes
at one revision commit once; concurrent generations produce one care
plan (spec §5.6).

Claude-Session: https://claude.ai/code/session_01XRNkZvQrxmRLNtJHxq71kH"
```

---

### Task 12: Full suite, push, PR

- [ ] **Step 1: Full suite and typecheck**

```bash
npm test --prefix $W/apps/pathway-service -- --runInBand 2>&1 | grep -E "^(FAIL|Tests:|Test Suites:)" | sort | uniq -c
$W/node_modules/.bin/tsc -p $W/apps/pathway-service/tsconfig.json --noEmit
npm run build --prefix $W/apps/pathway-service
```
Expected:
- The only `FAIL` lines are `patient-match-scorer` and `data-completeness-scorer`, with
  `9 failed`.
- Skipped equals the baseline plus 7 (Task 11).
- The typecheck is clean, and the build succeeds.

Record the *Baseline* row. The passed count will be **lower** than the baseline: this plan
retires more tests than it adds. The row must account for the difference, using the
`Retired` and `Added` totals from *Appendix A*.

- [ ] **Step 2: Check Appendix A against the tree**

```bash
for f in answer-pending-decision answer-routing-mutation ddi-refresh escalated-answer-injection generation-transaction \
         resolution-retraversal-context decision-point-context-dependency temporal/retraversal-clock-reuse \
         temporal/pathway-defaults-threading incremental-findings incremental-region incremental-seed-order \
         incremental-timeout incremental-traversal engine-parity findings-reconciliation reconcilable-red-flag-types \
         scorer-context-inputs scorer-declaration-truthfulness dependency-context-key safety; do
  test -e $W/apps/pathway-service/src/__tests__/$f.test.ts && echo "STILL PRESENT: $f"
done; echo checked
```
Expected: only `checked`.

- [ ] **Step 3: Push and open the PR into the integration branch**

```bash
git -C $W push -u origin HEAD:refs/heads/feat/evaluation-pipeline-03-single-pathway
gh pr create -R Prism-Clinical/prism-graphql --base feat/evaluation-pipeline --head feat/evaluation-pipeline-03-single-pathway \
  --title "Evaluation pipeline 03: single-pathway wiring" --body-file <(printf '%s\n' \
  "Plan: docs/superpowers/plans/2026-09-18-evaluation-pipeline-03-single-pathway-wiring.md (branch docs/evaluation-pipeline-design)." \
  "" "Migration 067, commitEvaluation, single-pathway mutations and generation on the pipeline, children of runs through the pipeline, incremental engine deleted, property (a), review reproductions, D14 pre-warm and backfill, opt-in Postgres tests." \
  "" "Breaking on the integration branch until plan 04 updates the admin dashboard (reviewedResultHash; answerGateQuestion removed).")
```
**The base is `feat/evaluation-pipeline`, not `main`.** If `gh` is not authenticated, report the
compare URL instead:
`https://github.com/Prism-Clinical/prism-graphql/compare/feat/evaluation-pipeline...feat/evaluation-pipeline-03-single-pathway`.

- [ ] **Step 4: Report and stop**

Report:
- the *Baseline* table;
- each falsification outcome;
- the Task 11 run (or why it could not run);
- the #9 and #10 pins as observed;
- anything property (a) found.

**Do not start plan 04**: it is written after this plan merges.

---

## Out of scope for this plan (by design)

- `composeRun`, parent-owned facts, `CONTRIBUTION` scope for children, conflict selection and
  migration 068's multi-pathway columns: plan 04.
- Review reproductions #2, #5, #6 and #7, and acceptance tests A3 and A4: plan 04 (P3-3).
- The admin dashboard: plan 04. It is broken on the integration branch until then.
- Running the backfill and re-running the plan 01 gate on live: plan 05.
- `applyDdiToResolutionState` and multi-pathway dead code: plan 04 (P3-4).

---

## Appendix A — Retired-test mapping (spec §5.5)

Every test this plan deletes, or edits in place, is listed with its **replacement**, or with a
**written reason** for dropping it. Replacement names are abbreviated as follows:

| Code | Test |
|---|---|
| **M:** | `pipeline-resolver-mutations.test.ts` |
| **G:** | `pipeline-resolver-generation.test.ts` |
| **T:** | `pipeline-resolver-temporal.test.ts` |
| **P(a)** | property (a) in `pipeline-sequence-vs-fresh.test.ts` |
| **P#n** | review reproduction #n in `pipeline-sequence-vs-fresh.test.ts` |
| **R:** | `pipeline-readiness.test.ts` (plan 02, plus Task 8's additions) |
| **O:** | `pipeline-traversal-overrides.test.ts` (plan 02) |
| **C:** | `pipeline-commit.test.ts` |
| **S:** | `session-store-evaluation.test.ts` |
| **MC** | `pipeline-multi-children.test.ts` |
| **A2** | `pipeline-acceptance-a2.test.ts` (plan 02) |
| **PS** | `pipeline-safety.test.ts` (plan 02) |
| **Pb/Pc** | plan 02's `pipeline-properties.test.ts` (b) and (c) |

Why most incremental tests have no one-to-one replacement: every mutation now evaluates from
scratch. The whole defect class they guarded ("the incremental result differs from a full
traversal") cannot occur. **P(a)** checks the invariant they approximated: any sequence of
mutations equals a fresh evaluation of the final inputs.

**Totals** (from the Task 0 inventory; record the actual numbers in *Baseline*):
- **Retired:** 172 tests. That is 47 in the nine files deleted by Task 6, 19 removed from
  `resolution-fact-store-wiring`, 90 in the twelve files deleted by Task 8, and 16 removed from
  files that stay.
- **Added:** 104 passing tests, plus 7 skipped (Task 11).
- **Rewritten in place, same count:** 22, across `resolution-input-contract` (10),
  `v1-traversal-behavior` (6), `multi-pathway-resolution` (3), `ddi-multi-pathway` (setup only),
  `branch-mode` (1), `traversal-engine` (1) and the gate-evaluator suites (assertion lines only).

### Deleted in Task 6

| File › test | Disposition |
|---|---|
| answer-pending-decision › takes the chosen branch and EXCLUDES the others | M: *takes the chosen branch and excludes the others* |
| answer-pending-decision › says why the unchosen branch is absent | M: same test (reason assertion) |
| answer-pending-decision › still exposes the old mutation name, delegating to the new one | Dropped: alias removed (spec §4). `pipeline-sdl` asserts its absence |
| answer-pending-decision › pends the fork when both branches qualify | M: *takes the chosen branch…* (first assertions) |
| answer-pending-decision › rejects a choice that is not one of the candidates | M: *rejects a choice that is not a candidate* |
| answer-routing-mutation › routes true to the true branch | M: *routes %s to its branch…* (`true`) |
| answer-routing-mutation › routes false to the false branch | M: *routes %s to its branch…* (`false`) |
| answer-routing-mutation › re-runs DDI for a false answer, not only a true one | Dropped as a mechanism: safety is stage 5 of every evaluation. Covered by M: *an added allergy reaches the safety check* and M: *(D4)* |
| answer-routing-mutation › clears the answered question for a false answer | M: *routes %s…* (`pendingQuestions` empty) |
| answer-routing-mutation › writes ACTIVE when the resolved state has no unresolved node | M: *a DEGRADED session that evaluates cleanly is stored ACTIVE again* |
| answer-routing-mutation › (alias) routes an answer exactly as answerPendingDecision does | Dropped: alias removed |
| answer-routing-mutation › (alias) enforces the same answer validation | Dropped: alias removed |
| answer-routing-mutation › rejects a quoted "true" sent to a boolean gate | M: *rejects an answer the gate does not accept* (`selectedOption: 'true'`) |
| answer-routing-mutation › rejects an answer carrying no value | M: same (`{}`) |
| answer-routing-mutation › rejects an answer carrying several values | M: same (two values) |
| answer-routing-mutation › still accepts a well-formed answer | M: *routes %s…* |
| ddi-refresh › runs again after a branch choice at a DecisionPoint | Dropped as a mechanism (stage 5 every evaluation). P(a) exercises safety after answers |
| ddi-refresh › runs again when a node is overridden back into the plan | M: *an overridden medication is still suppressed by a patient allergy (D4)* |
| ddi-refresh › runs again when medications are added to the patient context | P(a) (`patientMed` edits against the warfarin–aspirin pair) + PS: *suppresses on patient allergy and patient medication* |
| ddi-refresh › runs at session creation, as it always did | A2 (safety at the first evaluation) + M: *stores the inputs…* |
| escalated-answer-injection › resolves BOTH gates on the value | M: *becomes a FACT every gate reading that datum sees* |
| escalated-answer-injection › escalates both gates but asks for the haemoglobin once | M: same (length-1 assertion) |
| escalated-answer-injection › does NOT record the answer in gateAnswers | M: same (`gateAnswers.size === 0`) |
| escalated-answer-injection › records that the datum was provider-asserted | M: same (`PROVIDER_ASSERTED_DATUM` event) |
| escalated-answer-injection › refuses a non-numeric answer to a datum request | M: *refuses a non-numeric answer* |
| generation-transaction › persists the state the pre-generation DDI pass mutated | G: *a safety suppression that empties the plan…* (stored disposition) |
| generation-transaction › returns the DDI warnings the plan was generated under | G: *returns a moderate interaction as a text warning* |
| generation-transaction › blocks a session that genuinely still has an unresolved node | R: *blocks on a %s node, naming it* + G: *returns the readiness blockers…* |
| generation-transaction › persists the suppression that caused the blockers | G: *a safety suppression that empties the plan…* |
| generation-transaction › guards that write with the session it read | G: *returns PLAN_CHANGED_SINCE_REVIEW and stores the fresh cache* (revision CAS via `writeEvaluation`, S: *compare-and-set*) |
| generation-transaction › returns the warnings that accompany the blockers | G: *…text warning* (the blocked path returns the same `warningsOf`) |
| generation-transaction › guards the completing write with the session it read | G: *claims before inserting…* |
| generation-transaction › rolls back and reports a conflict when the session moved | G: *claims before inserting…* + C: *throws CONFLICT after three lost races* |
| generation-transaction › refuses to generate from a DEGRADED session | R: *a degraded evaluation is never ready* + its reachability test |
| resolution-retraversal-context › (answer) mid-session attribute addition reaches retraversal | T: *v1 assembles … on every later mutation* + P(a) |
| resolution-retraversal-context › (answer) mid-session lab addition reaches retraversal | T: same |
| resolution-retraversal-context › (override) mid-session attribute addition reaches retraversal | T: same (the override after `addLab` carries both labs) |
| resolution-retraversal-context › (override) mid-session lab addition reaches retraversal | T: same |
| decision-point-context-dependency › records the branch scorer inputs against the DecisionPoint | Dropped: scorer inputs selected nodes to re-score; every evaluation re-scores the whole graph (spec §2 stage 2) |
| retraversal-clock-reuse › constructs the incremental engine with the clock persisted on the session | T: *later mutations evaluate under the clock stored at start* |
| retraversal-clock-reuse › refuses to retraverse a pre-migration session with no pinned clock | Dropped: migration 067 makes the clock NOT NULL. S: *insertSession refuses a session with no clock*; `inputsOf` still throws |
| pathway-defaults-threading › startResolution — TraversalEngine | T: *the engine receives the pathway temporal defaults by identity* |
| pathway-defaults-threading › overrideNode — incremental resolve | T: same (one construction site, Task 8 grep) |
| pathway-defaults-threading › answerPendingDecision — incremental resolve | T: same |
| pathway-defaults-threading › addPatientContext — incremental resolve | T: same |
| pathway-defaults-threading › resolveAndPersistAll (multi-pathway) — TraversalEngine | MC + multi *stamps one clock … every evaluation* (children go through `evaluate`) |
| pathway-defaults-threading › every site passes the SAME defaults object the sweep resolved against | T: *…by identity* (`evaluate` passes one `rctx` to both `assertEncounterAnchor` and the engine) |

### Removed from `temporal/resolution-fact-store-wiring.test.ts` (Task 6)

| Test | Disposition |
|---|---|
| starts a session whose context would fail assembly validation | T: *legacy-v0 never invokes the assembler…* (starts on a v1-invalid lab date) |
| starts a session carrying a lab date the assembler cannot parse | T: same |
| passes an empty fact store to the engine under legacy-v0 (startResolution) | T: same (every `factStoreFor` result is empty) |
| passes an empty fact store on every retraversal entry point under legacy-v0 | T: same (start, `addPatientContext`, `overrideNode`) |
| passes an empty fact store on the multi-pathway path under legacy-v0 | T: same + MC (children evaluate through the same `evaluate`) |
| startResolution builds facts from the SYNTHETIC payload | T: *v1 assembles…* (`codes(0)`) |
| startMultiPathwayResolution builds facts for each child session | MC + T: *v1 assembles…* |
| overrideNode re-assembles rather than passing an empty store | T: *v1 assembles…* (`codes(2)`) |
| answerPendingDecision re-assembles rather than passing an empty store | P(a) + T (every mutation goes through `commitEvaluation` → `evaluateSession`) |
| addPatientContext re-assembles including the newly supplied facts | T: *v1 assembles…* (`codes(1)`) |
| a v1 session created with no encounterStart still assembles vitals facts | T: *a v1 session with no encounterStart still starts…* |
| admits an explicitly-null assertion field, exactly as omission (both doors) | T: *addPatientContext treats an explicit null assertion as omitted…* |
| leaves a fact already stored on the session untouched | T: same |
| assembles against the session clock, not the wall clock | T: *later mutations evaluate under the clock stored at start* |
| resolves the same factIds on re-run as at creation | T: *the same inputs assemble the same facts on every evaluation* |
| defaults to v1 when the deployment sets nothing | T: *the policy version is the server's…* |
| gives every child session the injected version, not merely equal ones | multi: *stamps one clock instance … every evaluation* (the clock object carries the version, `toBe`) |
| ignores a temporalPolicyVersion supplied on the request | T: *the policy version is the server's…* |
| ignores a temporalPolicyVersion supplied on the multi-pathway request | multi: *stamps one clock…* (the clock is stamped at the boundary from the server's version; multi's boundary is unchanged) |

### Deleted in Task 8

| File › test | Disposition |
|---|---|
| incremental-findings › drops a stale flag about a node it re-disposed | Dropped: findings are derived afresh by every evaluation, so nothing is stale. P(a) + Pc |
| incremental-findings › keeps a flag about a node outside the region it re-disposed | Dropped: no regions |
| incremental-findings › does not duplicate a question it re-derives | Dropped: questions derived once per evaluation. M: *routes %s…* |
| incremental-findings › drops the question of a gate that has now been answered | M: *routes %s … clears the question* |
| incremental-findings › returns the derived set untouched when nothing is stored | Dropped: nothing is merged |
| incremental-findings › drops a stale flag about a descendant the pass rewrote | Dropped (`rewritten` removed). P(a) |
| incremental-findings › keeps a contradiction flag, which traversal cannot derive | Dropped: no production code raises `contradiction` (reconcilable-red-flag-types established this) |
| incremental-findings › records the context a scored node depends on | Dropped: scorer inputs removed (whole-graph scoring) |
| incremental-findings › survives an incremental resolve | Dropped: same |
| incremental-region › does not re-open the treatment when only the medication is seeded | P#1 + P(a) |
| incremental-region › re-decides when the node it depends on is re-resolved | A2 (`prior_node_result` reads eligibility) + P(a) |
| incremental-region › does not let an overridden node's descendants outrun the gate above it | O: *a closing gate sweeps past a held Step without rewriting it* |
| incremental-region › stays rejected when a context change rescores it | M: *takes the chosen branch…* (the choice is an input re-applied every evaluation) + P(a) |
| incremental-region › keeps the medication in the session, excluded rather than gone | P(a): a fresh evaluation materialises every reachable node, and nothing deletes rows |
| incremental-region › keeps the seed parented where it was, not at the root | O: *an INCLUDE override pins…* (parent and depth of a held node) |
| incremental-region › keeps the mandate when only the target is re-resolved | Dropped: no seeds. The `all_of` mandate stays covered by `branch-mode` over `traverse()` |
| incremental-seed-order › pends the fork and takes NEITHER branch, whichever seed comes first | Dropped: no seeds. Order independence is Pb + P(a) |
| incremental-seed-order › produces the same state either way | Pb |
| incremental-seed-order › still resolves a seed that no other seed reaches | Dropped: no seeds |
| incremental-timeout › leaves every node present — rebuilt or TIMEOUT | R: *reachable: a timeout with only a held override left queued…* |
| incremental-timeout › marks what it could not rebuild as TIMEOUT | R: *blocks on a %s node, naming it* (TIMEOUT) |
| incremental-timeout › reports what it actually disposed | Dropped: `nodesRecomputed` is the evaluated node count (P3-6) |
| incremental-timeout › reports no degradation and a full count when it completes | Dropped: same; R: *ready when an action is included…* |
| incremental-traversal › opens the whole branch, not just the gate row | `v1-traversal-behavior` › *re-resolves a previously unsatisfied gate…* |
| incremental-traversal › clears reasons that named a decision no longer in force | same test (`excludeReason` undefined) |
| incremental-traversal › matches what a full traversal produces | P(a) (every mutation *is* a full traversal) |
| incremental-traversal › never shrinks the session | P(a) (no deletion path exists) |
| incremental-traversal › includes an unsatisfied gate whose default_behavior is TRAVERSE | P(a) (re-evaluation is `traverse()`, whose default_behavior handling is unchanged) |
| incremental-traversal › respects an override on its own node but re-resolves its descendants | O: *an INCLUDE override pins a below-threshold medication and its children still traverse* |
| incremental-traversal › reports the status changes it made | M: *records statusChanges as the diff…* |
| incremental-traversal › reports no status changes when nothing actually moved | S: *statusChangesBetween lists changed nodes…* (unchanged nodes omitted) |
| incremental-traversal › is a no-op for an empty seed set | Dropped: no seeds |
| incremental-traversal › gates out a previously-included subtree when the gate flips shut | P#1 |
| incremental-traversal › matches a full traversal in the closing direction too | P#1 (fresh-hash equality) + P(a) |
| incremental-traversal › a medication under a now-shut gate is no longer projected | P#1 + G (generation materialises disposition only) |
| engine-parity › agrees when the gate is satisfied on both paths | P(a): there is one engine path |
| engine-parity › a gate flipping shut→open re-resolves its subtree, matching a full traversal | `v1-traversal-behavior` flip test + P(a) |
| engine-parity › honours default_behavior TRAVERSE on both paths | P(a) |
| findings-reconciliation (22 tests: redFlagKey ×2, reconcileRedFlags ×7, reconcilePendingQuestions ×6, shared datum prompts ×7) | Dropped: module deleted, since findings are never merged. The one user-visible behaviour, one prompt per shared datum, is M: *becomes a FACT…* (length-1 assertion). Acknowledgement carry-over is moot: `acknowledged` is never set in production (spec, Out of scope) |
| reconcilable-red-flag-types (4 tests) | Dropped: module deleted |
| scorer-context-inputs (7 tests) | Dropped: whole-graph re-scoring every evaluation (spec §2 stage 2). `declareRequiredInputs` is left on scorers, unused; delete it with plan 04's dead code |
| scorer-declaration-truthfulness (5 `it.each` + 2 guards) | Dropped: declared inputs no longer select what is re-scored |
| dependency-context-key (3 tests) | Dropped: function deleted |
| safety.test (9 tests: detectCycle ×2, enforceTimeout ×2, checkMissingCriticalData ×3, isCascadeLimitReached ×2) | Dropped: dead module (spec, *Already dead on main*) |

### Removed from files that stay (Task 8, plus Task 2's replacement)

| File › test | Disposition |
|---|---|
| session-store › should round-trip DependencyMap through JSON | Dropped: dependency map removed. S: *rowToSession round-trips the stored inputs* |
| session-store › should handle empty dependency map | Dropped: same |
| confidence-engine › contextInputs › reports the context a LabTest node depends on | Dropped: scorer inputs removed |
| confidence-engine › contextInputs › reports nothing for a node with no patient-data dependency | Dropped: same |
| care-plan-generator › validateForGeneration — unresolved state › blocks on a %s node (×3) | R: *blocks on a %s node, naming it* (×3) |
| care-plan-generator › … › names the node so it can be found | R: same (`relatedNodeIds: ['step-9']`) |
| care-plan-generator › … › does NOT block on a %s node (×2) | R: *does not block on a decided %s node* (×2) |
| care-plan-generator › … › lets a fully resolved plan through | R: *ready when an action is included and nothing is open* |
| care-plan-generator › validateForGeneration › should block on empty plan | R: *EMPTY_PLAN is an OUTPUT blocker at ROOT only…* |
| care-plan-generator › … › should block on unresolved red flags | R: *completeness blockers…* |
| care-plan-generator › … › should block on pending gate questions | R: *completeness blockers…* (P3-8) |
| care-plan-generator › … › should pass validation with included action nodes and no red flags | R: *ready when an action is included…* |
| session-temporal-context › createSession writes the temporal context as JSON | `session-temporal-context` › *insertSession writes the temporal context as JSON* (Task 2) |

### Rewritten or edited in place (same test, new seam)

- `temporal/resolution-input-contract` › all 10 tests of *startResolution — temporal anchors*
  (Task 6 Step 5).
- `temporal/v1-traversal-behavior` › all 6 tests (Task 6 Step 4).
- `multi-pathway-resolution`:
  - *persists per-pathway sessions…* and *skips a pathway whose graph is empty…* are rewritten
    in place.
  - *stamps one clock … every engine* is replaced by *… every evaluation*.
  - *writes nothing when a LATER pathway fails validation* is replaced by *… fails evaluation*.

  All of these are in Task 7.
- `ddi-multi-pathway`: setup only (Task 7).
- `branch-mode` › *survives re-disposition instead of re-asking* becomes *survives
  re-evaluation instead of re-asking* (Task 8).
- `traversal-engine` › *should record influences/influencedBy…* becomes *a prior_node_result
  gate on an INCLUDED step is satisfied* (Task 8).
- `gate-evaluator` (3) and `gate-evaluator-compound-uncertainty` (3): the `dependedOnNodes`
  assertion lines are removed (Task 8).

### Kept, deliberately untouched

- `patient-attributes-mapping` (`buildPatientContext`) and multi's two `validateForGeneration`
  tests: multi-pathway dead code, plan 04 (P3-4).
- `preview-session-isolation`: zero-match path, unchanged.
- `baseline-capture` (skipped): references `makeTraversalAdapter`. Plan 05 updates it for the
  before/after record (P3-4).
- `ddi-pass-single-pathway`: `applyDdiToResolutionState` stays until plan 04 (P3-4).
