# Decision Semantics 01 — Flip the Evaluator to v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `v1` the default temporal policy version so the kernel's `indeterminate` signal is actually computed in production, and purge the pre-temporal resolution sessions that cannot be retraversed under it.

**Architecture:** The flip is one constant, but it is not a one-line change. `makeEvaluationTemporalContext` defaults `temporalPolicyVersion` from that same constant, and **18 test files construct a temporal context without pinning a version** — so flipping it silently moves all of them onto the kernel evaluator, several with empty fact stores they were written not to need. Task 1 therefore makes each test's policy intent explicit *first*, as a pure refactor with no behaviour change. Only then is the flip a genuine one-liner whose fallout is confined to code that really did depend on the default.

**Tech Stack:** TypeScript 5, Jest + ts-jest, PostgreSQL 15 with Apache AGE.

**Spec:** `docs/superpowers/specs/2026-08-30-decision-semantics-design.md` (W0)

## Global Constraints

- **No compatibility seam for decision semantics.** There are no users. Do not add feature flags, version gates, or deprecation aliases to preserve old behaviour.
- **`legacy-v0` stays in the registry** as a differential-test fixture. Do not delete it, its capability row, or its tests.
- **The suite is not green and must not be made green here.** `npx jest apps/pathway-service` has 9 pre-existing failures, all in `data-completeness-scorer.test.ts` and `patient-match-scorer.test.ts`. They are unrelated. Assert the count; do not fix them.
- **Never chain `cd` with other commands.** Use `git -C <path>` / `npm --prefix <path>`, or run `cd` as its own Bash call.
- Conventional commit prefixes. No `@anthropic.com` / `@claude.com` in commits. No "Generated with Claude Code" links.

---

### Task 1: Make each test's policy intent explicit

**Files:** these 18 test files under `apps/pathway-service/src/__tests__/`, each of which calls `makeEvaluationTemporalContext` without a `temporalPolicyVersion`:

```
anemia-pathway-e2e.test.ts            gate-evaluator-trend.test.ts
clock-pinning.test.ts                 gate-evaluator.test.ts
context-assembler-observations.test.ts  multi-pathway-session-store-preview.test.ts
context-assembler-stateful.test.ts    pathway-defaults-threading.test.ts
ddi-multi-pathway.test.ts             resolution-retraversal-context.test.ts
fact-identity.test.ts                 retraversal-clock-reuse.test.ts
gate-evaluator-attribute.test.ts      retraversal-engine.test.ts
gate-evaluator-codemap-threading.test.ts  session-temporal-context.test.ts
gate-evaluator-count-in-window.test.ts    traversal-engine.test.ts
```

(The other 15 callers already pin a version and need no change.)

**Interfaces:**
- Consumes: `makeEvaluationTemporalContext(input: TemporalContextInput)`, where `TemporalContextInput.temporalPolicyVersion?: string`.
- Produces: nothing consumed by later tasks. This task exists so Task 2's failure signal is meaningful.

**Why this is a refactor, not a behaviour change:** `DEFAULT_TEMPORAL_POLICY_VERSION` is still `legacy-v0` while this task runs, so writing `temporalPolicyVersion: 'legacy-v0'` explicitly changes nothing. Test counts before and after must be identical.

- [ ] **Step 1: Record the baseline**

Run: `npx jest apps/pathway-service 2>&1 | tail -6`

Expected: `9 failed, 1363 passed, 1372 total` (or whatever the current numbers are — record them exactly; Steps 3 and 5 compare against this).

- [ ] **Step 2: Classify each of the 18 files**

For each file, read what it asserts and decide which policy it *means*:

- **Pin `legacy-v0`** when the test asserts pre-kernel behaviour — it passes `factStore: []`, expects no `indeterminate`, or its comments say "legacy". This is the large majority and preserves the differential baseline.
- **Pin `v1`** only when the test is exercising kernel behaviour and merely got the default by luck. If you pin `v1`, the test must also supply a populated fact store (see Task 2 Step 4 for how) — a `v1` gate with `factStore: []` selects from nothing and answers a quiet `false`.

Write the classification down before editing. If a file is genuinely ambiguous, pin `legacy-v0` — it is the behaviour the test was written against.

- [ ] **Step 3: Add the explicit pin, one file at a time**

In each file, at every `makeEvaluationTemporalContext({ ... })` call, add the field:

```typescript
    makeEvaluationTemporalContext({
      evaluationAsOf: '2026-07-30T12:00:00.000Z',
      // Pinned rather than inherited: this suite asserts pre-kernel
      // behaviour and must keep doing so after v1 becomes the default.
      temporalPolicyVersion: 'legacy-v0',
    }),
```

After each file, run just that file:

`npx jest apps/pathway-service/src/__tests__/<file>`

Expected: identical pass/fail to before the edit. **If a file's result changes, stop and re-read it** — a changed result means the edit was not the no-op it should be.

- [ ] **Step 4: Verify the whole suite is unmoved**

Run: `npx jest apps/pathway-service 2>&1 | tail -6`

Expected: **exactly** the Step 1 numbers. Any difference means this refactor changed behaviour, which it must not.

- [ ] **Step 5: Commit**

```bash
git add apps/pathway-service/src/__tests__
git commit -m "test(pathway-service): pin temporal policy version explicitly

makeEvaluationTemporalContext defaults temporalPolicyVersion from
DEFAULT_TEMPORAL_POLICY_VERSION, so 18 suites were inheriting legacy-v0
rather than asking for it. Flipping the default would have moved all of
them onto the kernel evaluator at once, several with empty fact stores
they were written not to need.

No behaviour change: the pinned value is the value they already got.
Suite unchanged at <N> failed, <M> passed."
```

---

### Task 2: Flip the default policy version

**Files:**
- Modify: `apps/pathway-service/src/services/resolution/temporal/evaluation-context.ts:214-219`
- Test: `apps/pathway-service/src/__tests__/temporal/policy-default.test.ts` (create)

**Interfaces:**
- Consumes: `resolveTemporalPolicyVersion(ctx: DataSourceContext): string`, `DEFAULT_TEMPORAL_POLICY_VERSION: string`, `policyCapabilities(version: string): { evaluationMode: EvaluationMode; requiresFactStore: boolean }` — all already exported.
- Produces: `DEFAULT_TEMPORAL_POLICY_VERSION === 'v1'`. Plan 02 and plan 03 depend on this; under `legacy-v0` the evaluator never sets `indeterminate` and both are inert.

- [ ] **Step 1: Write the failing test**

Create `apps/pathway-service/src/__tests__/temporal/policy-default.test.ts`:

```typescript
import { DEFAULT_TEMPORAL_POLICY_VERSION } from '../../services/resolution/temporal/evaluation-context';
import { resolveTemporalPolicyVersion } from '../../resolvers/helpers/resolution-context';
import { policyCapabilities } from '../../services/resolution/temporal/policy-registry';
import type { DataSourceContext } from '../../types';

describe('default temporal policy version', () => {
  // Assert the CAPABILITY, not just the string. `legacy-v0` routes to
  // evaluationMode 'legacy', which never computes indeterminate — the signal
  // plans 02 and 03 are built on. A future rename of the version string must
  // not silently put the default back on the legacy evaluator.
  it('resolves to a kernel-mode policy when the deployment injects nothing', () => {
    const version = resolveTemporalPolicyVersion({} as DataSourceContext);
    expect(policyCapabilities(version).evaluationMode).toBe('kernel');
  });

  it('is v1', () => {
    expect(DEFAULT_TEMPORAL_POLICY_VERSION).toBe('v1');
  });

  // Deployment config must still win, so a session can be pinned to
  // legacy-v0 for differential testing.
  it('still lets an injected version override the default', () => {
    const version = resolveTemporalPolicyVersion(
      { temporalPolicyVersion: 'legacy-v0' } as DataSourceContext,
    );
    expect(version).toBe('legacy-v0');
    expect(policyCapabilities(version).evaluationMode).toBe('legacy');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest apps/pathway-service/src/__tests__/temporal/policy-default.test.ts`

Expected: FAIL — first test receives `'legacy'` where `'kernel'` expected; second receives `'legacy-v0'` where `'v1'` expected. Third passes already.

- [ ] **Step 3: Flip the constant**

In `apps/pathway-service/src/services/resolution/temporal/evaluation-context.ts`, replace the comment and constant at lines 214-219:

```typescript
/**
 * Default policy version. `v1` is the kernel path: it is the only mode that
 * computes `indeterminate` / `uncertainty`, which the escalation semantics in
 * plans 02 and 03 are built on. `legacy-v0` remains in the registry as a
 * differential-test fixture and is still pinnable per deployment via
 * TEMPORAL_POLICY_VERSION, or per call via TemporalContextInput.
 */
export const DEFAULT_TEMPORAL_POLICY_VERSION = 'v1';
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx jest apps/pathway-service/src/__tests__/temporal/policy-default.test.ts`

Expected: PASS, 3 tests.

- [ ] **Step 5: Run the full suite and triage**

Run: `npx jest apps/pathway-service 2>&1 | tail -6`

Because Task 1 pinned every test that meant `legacy-v0`, failures here are *informative*: each one is production code that relied on the default and now runs the kernel.

For each newly-failing suite, the fix is one of exactly two things, and neither is editing an assertion to match new output:

1. **A construction site passes `factStore: []` in production code.** Under `v1` that gate selects from nothing. Fix by assembling the store — `assembleContext(input, ctx)` from `services/resolution/temporal/context-assembler.ts` builds a `FactStore` from a `SYNTHETIC` patient context.
2. **A test genuinely exercises the default and should now assert kernel behaviour.** Update it deliberately and say so in the commit.

**If a failure fits neither, STOP and escalate.** That is a real behavioural difference between the two evaluators and it needs a human decision.

- [ ] **Step 6: Commit**

```bash
git add apps/pathway-service/src/services/resolution/temporal/evaluation-context.ts \
        apps/pathway-service/src/__tests__/temporal/policy-default.test.ts
git commit -m "feat(pathway-service): default the temporal policy to v1

legacy-v0 routes to evaluationMode 'legacy', which never computes
indeterminate/uncertainty. The escalation semantics in plans 02 and 03
are inert until the kernel path is the default.

legacy-v0 stays in the registry as a differential-test fixture and is
still pinnable via TEMPORAL_POLICY_VERSION.

Suite: <N> failed, <M> passed (baseline 9 failed, 1363 passed)."
```

---

### Task 3: Purge pre-temporal resolution sessions

**Files:**
- Create: `shared/data-layer/migrations/065_purge_pre_temporal_sessions.sql`
- Verification: manual, via `psql` (this repo has no migration test harness)

**Interfaces:**
- Consumes: nothing from Tasks 1-2; independent and can be applied before or after them.
- Produces: empty `pathway_resolution_sessions` and `multi_pathway_resolution_sessions`. No later plan reads these rows.

**Context:** All 41 `pathway_resolution_sessions` have `temporal_context->>'temporalPolicyVersion'` NULL — they predate migration 063 entirely, so they carry neither a pinned clock nor a policy. Under `v1` they cannot be retraversed reproducibly. There are no users, so they are deleted rather than migrated. 14 `multi_pathway_resolution_sessions` rows are their parents.

- [ ] **Step 1: Confirm the child column names**

Do not guess these — the migration's `DELETE` predicates depend on them:

```bash
export PGPASSWORD=$(pm2 env 0 | sed 's/\x1b\[[0-9;]*m//g' | awk -F': ' '/^POSTGRES_PASSWORD/{print $2}')
for t in pathway_resolution_events pathway_resolution_decisions pathway_gate_answers pathway_node_overrides; do
  echo "--- $t"; psql -h localhost -U prism -d prism_db -c "\d $t" | head -14
done
psql -h localhost -U prism -d prism_db -c "\d pathway_resolution_sessions" | grep -i multi
```

Record the actual FK column on each child table and the multi-pathway parent column. If any differs from `session_id` / `multi_pathway_session_id`, adjust the SQL in Step 3 to match.

- [ ] **Step 2: Record the pre-state**

```bash
psql -h localhost -U prism -d prism_db -c "
  SELECT 'resolution_sessions' AS t, count(*) FROM pathway_resolution_sessions
  UNION ALL SELECT 'multi_pathway', count(*) FROM multi_pathway_resolution_sessions
  UNION ALL SELECT 'gate_answers', count(*) FROM pathway_gate_answers
  UNION ALL SELECT 'node_overrides', count(*) FROM pathway_node_overrides
  UNION ALL SELECT 'decisions', count(*) FROM pathway_resolution_decisions
  UNION ALL SELECT 'events', count(*) FROM pathway_resolution_events;"
```

Expected: 41 resolution sessions, 14 multi-pathway. Paste the full output into the Step 6 commit message — it is the only record of what was removed.

- [ ] **Step 3: Write the migration**

Create `shared/data-layer/migrations/065_purge_pre_temporal_sessions.sql`:

```sql
-- Migration 065: purge resolution sessions created before the temporal kernel.
--
-- Every existing session has temporal_context->>'temporalPolicyVersion' NULL:
-- they predate migration 063, so they carry neither a pinned evaluation clock
-- nor a policy version. Under the v1 default (plan 01 task 2) they cannot be
-- retraversed reproducibly — a retraversal would resolve against a different
-- instant AND a different evaluator than the traversal it repeats.
--
-- The platform has no users; these are stale test rows (newest 2026-07-13).
-- Deleted rather than backfilled because there is no honest value to backfill:
-- we do not know what "now" was for these traversals.
--
-- Deletion order follows the FK graph, children first. Idempotent: re-running
-- matches no rows.

BEGIN;

DELETE FROM pathway_resolution_events
 WHERE session_id IN (
   SELECT id FROM pathway_resolution_sessions
    WHERE temporal_context IS NULL
       OR temporal_context->>'temporalPolicyVersion' IS NULL);

DELETE FROM pathway_resolution_decisions
 WHERE session_id IN (
   SELECT id FROM pathway_resolution_sessions
    WHERE temporal_context IS NULL
       OR temporal_context->>'temporalPolicyVersion' IS NULL);

DELETE FROM pathway_gate_answers
 WHERE session_id IN (
   SELECT id FROM pathway_resolution_sessions
    WHERE temporal_context IS NULL
       OR temporal_context->>'temporalPolicyVersion' IS NULL);

DELETE FROM pathway_node_overrides
 WHERE session_id IN (
   SELECT id FROM pathway_resolution_sessions
    WHERE temporal_context IS NULL
       OR temporal_context->>'temporalPolicyVersion' IS NULL);

DELETE FROM pathway_resolution_sessions
 WHERE temporal_context IS NULL
    OR temporal_context->>'temporalPolicyVersion' IS NULL;

-- Multi-pathway parents are only meaningful with contributing per-pathway
-- sessions; once those are gone the parent describes nothing.
DELETE FROM multi_pathway_resolution_sessions
 WHERE NOT EXISTS (
   SELECT 1 FROM pathway_resolution_sessions s
    WHERE s.multi_pathway_session_id = multi_pathway_resolution_sessions.id);

COMMIT;
```

- [ ] **Step 4: Apply it and record history**

The migrator CLI is broken (CLAUDE.md, "Migration workflow"), so apply directly:

```bash
export PGPASSWORD=$(pm2 env 0 | sed 's/\x1b\[[0-9;]*m//g' | awk -F': ' '/^POSTGRES_PASSWORD/{print $2}')
MIG=/home/claude/workspace/prism-graphql/shared/data-layer/migrations
f=065_purge_pre_temporal_sessions.sql
id="${f%.sql}"
checksum=$(node -e "console.log(require('crypto').createHash('sha256').update(require('fs').readFileSync('${MIG}/${f}','utf-8').trim()).digest('hex'))")
psql -h localhost -U prism -d prism_db -v ON_ERROR_STOP=1 -f "${MIG}/${f}"
psql -h localhost -U prism -d prism_db -c \
  "INSERT INTO migration_history (migration_id, name, checksum) VALUES ('$id', '$id', '$checksum');"
```

- [ ] **Step 5: Verify post-state and idempotency**

Re-run the Step 2 count query. Expected: 0 across all six tables.

Then re-run the migration file only (not the history insert):

```bash
psql -h localhost -U prism -d prism_db -v ON_ERROR_STOP=1 -f "${MIG}/065_purge_pre_temporal_sessions.sql"
```

Expected: succeeds with `DELETE 0` on every statement.

- [ ] **Step 6: Commit**

```bash
git add shared/data-layer/migrations/065_purge_pre_temporal_sessions.sql
git commit -m "chore(data-layer): purge pre-temporal resolution sessions

All 41 sessions predate migration 063 and carry no pinned clock or
policy version, so they cannot be retraversed reproducibly under the v1
default. No users; these are stale test rows (newest 2026-07-13).

Pre-state: <paste the Step 2 counts>"
```

---

## Verification

- [ ] `npx jest apps/pathway-service 2>&1 | tail -6` — failures confined to `data-completeness-scorer.test.ts` and `patient-match-scorer.test.ts`.
- [ ] `npx jest apps/pathway-service/src/__tests__/temporal` — the whole temporal suite passes under the new default.
- [ ] `npm run build --prefix apps/pathway-service` succeeds.
- [ ] Against a running stack, a fresh `startMultiPathwayResolution` on `anemia-in-pregnancy-v1` v1.4 persists `temporalPolicyVersion: "v1"` in `temporal_context`.

## What this plan deliberately does not do

- Remove `legacy-v0`. It stays as a differential-test fixture; its retirement is separate cleanup.
- Change any gate's routing. The flip changes which evaluator computes conditions and makes `indeterminate` available; nothing consumes it until plan 02.
- Touch the 9 known scorer failures.
