# Evaluation Pipeline 05 — Release Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put the evaluation pipeline into production. First prove it against live data and
rehearse the migration on a copy. Then run the normalisation backfill and re-run the performance
gate with real DDI coverage. Finally merge the integration branches, deploy, and record the
before/after behaviour and the admin smoke test.

**Architecture:** Two phases, split by what they touch.
- **Phase A** is code on a plan branch and writes nothing live except two capture sessions. It
  covers the release tooling, the benchmark on the real pipeline, test residue, wider property
  coverage and a full rehearsal on a copy of `prism_db`.
- **Phase B** is operations on the live host, each step gated by approval. It covers the backfill,
  the gate re-run, the merges to `main`/`master`, the deploy, the after-record and the smoke test.

**Tech Stack:** TypeScript 5, Jest + ts-jest, fast-check 3, PostgreSQL 15 + Apache AGE, pm2,
nginx, Next.js 16 (admin), RxNav REST.

**Spec:** `docs/superpowers/specs/2026-09-13-evaluation-pipeline-design.md`, branch
`docs/evaluation-pipeline-design`. This plan implements §4 *Deployment*, §5.6 (the Postgres tests,
required before merge), §5.7 (the gate re-run after the backfill), §5.8, §5.10 and the overview's
row 05. Read the spec and `2026-09-14-evaluation-pipeline-00-overview.md` first.

## Global Constraints

Everything in the overview's *Global Constraints* applies, with **one deliberate exception**. The
overview says *"Live database: read only"*. This plan writes to the live host in exactly the steps
marked 🔒. Every other live access is read-only.

- **🔒 steps.** A 🔒 step runs only if the execution prompt approves it by name. Otherwise
  **stop and ask**. The locks are:
  - 🔒A — two capture sessions on live (Task 1);
  - 🔒B — the normalisation backfill on live (Task 6);
  - 🔒C — the deploy: backup, migrations, builds, restarts (Task 8);
  - 🔒D — capture sessions and the smoke-test sessions after the deploy (Tasks 9 and 10).
- **Merges into `main` / `master` are the user's.** Opening the PRs is approved only if the
  execution prompt says so, and `gh` has been unauthenticated all along, so expect to hand over
  compare URLs. **Stop at each merge point** (end of Task 5 and end of Task 7). Resume only when
  the user says the merge is done.
- **Scratch databases** are named `prism_*_scratch`. Never run a writing test or a rehearsal
  against `prism_db`.
- **Suite invariant:** the nine `patient-match-scorer` / `data-completeness-scorer` failures
  remain the only failures.
- **Budgets (spec §5.7):** p95 **< 2 s** single-pathway; **< 5 s** for a 5-child run. **If the
  re-run gate fails, stop: do not merge to `main`** (revisit D1/D13).
- **§5.8 rule:** in the before/after record, *anything other than the expected differences is a
  defect*. Stop and report it; never fix it inside the release.
- **Commits:** conventional prefixes. End every message with exactly
  `Claude-Session: https://claude.ai/code/session_01XRNkZvQrxmRLNtJHxq71kH`. No `Co-Authored-By`,
  no `@anthropic.com`.
- **Commands:** never `cd … && …`. Use `git -C`, `npm --prefix`, absolute paths.

**Paths used throughout:**
- `W=/home/claude/workspace/features/feat-evaluation-pipeline-05-release/prism-graphql`: the plan
  branch.
- `L=/home/claude/workspace/prism-graphql` and `LA=/home/claude/workspace/prism-admin-dashboard`:
  the live checkouts (`main` / `master`). These are what pm2 serves.
- `D=/home/claude/workspace/features/docs-evaluation-pipeline-design/prism-graphql`: the docs
  branch.
- `REC=$D/docs/superpowers/records/evaluation-pipeline-05`: the records this plan commits.
- `SP`: the executing session's scratchpad directory. Temporary files go there, never in `/tmp`.
- `PGPASSWORD` for `prism` is read as in `CLAUDE.md`:
  ```bash
  export PGPASSWORD=$(pm2 env 0 | sed 's/\x1b\[[0-9;]*m//g' | awk -F': ' '/^POSTGRES_PASSWORD/{print $2}')
  ```

## Live facts this plan was written against (read-only, 2026-09-22)

- **Deployed code:** `main` @ `2454130` and admin `master` @ `3a32df8`. These are exactly the
  bases of the integration branches. `feat/evaluation-pipeline` is 40 commits ahead of `main` and
  0 behind; admin `feat/evaluation-pipeline` is 4 ahead of `master` and 0 behind. Both merges are
  fast-forwards.
- **Migrations:** `migration_history` ends at `066_backfill_remaining_branch_mode`. Pending:
  **067, 068**. Neither file has `-- UP` / `-- DOWN` markers, so the `CLAUDE.md` checksum applies.
  Both wrap themselves in `BEGIN … COMMIT` and purge both session tables.
- **Sessions:** 0 single-pathway, 0 multi-pathway. The purge loses nothing.
- **`medication_normalization_cache`: 0 rows.** Under D14 every medication blocks generation
  until the backfill runs.
- **Pathways the backfill covers (ACTIVE + DRAFT):** anemia-in-pregnancy-v1 @ 1.4 (ACTIVE),
  @ 1.1–1.3 and @ 1.5–1.7 (DRAFT), chronic-htn-pregnancy-v1 @ 1.0 (DRAFT), and
  gestational-hypertension-preeclampsia @ 1 (DRAFT).
  - Three of the benchmark's five run children are **ARCHIVED**: anemia-pregnancy-v1,
    routine-prenatal-care-v1 and vaginal-discharge-pregnancy-v1. The backfill does not cover
    them (P5-4).
- **Network:** RxNav answers from the host (`GET /REST/rxcui.json?name=aspirin` → 200 in 0.85 s).
- **Live checkouts:** both have a local, uncommitted `package-lock.json` modification, which is
  drift from earlier `npm install`s. It blocks `git pull --ff-only` if the incoming commits touch
  the lockfile. Task 8 inspects it, then discards it.
- **Size and tools:** `prism_db` is 26 MB, and the disk has 193 GB free. The `prism` role is a
  superuser, so `createdb` works even though `rolcreatedb` reads `f`. `pg_dump` is at
  `/usr/bin/pg_dump`.
- **Code facts on `feat/evaluation-pipeline`:**
  - **The merged benchmark cannot run.** `evaluation-benchmark.test.ts` and
    `baseline-capture.test.ts` import `makeTraversalAdapter`, and that function no longer exists
    in `src/`. Test files are not typechecked, so both files load, skipped, and would fail with
    `is not a function` the moment they ran.
  - `resolution-fact-store-wiring.test.ts` still mocks `makeTraversalAdapter` /
    `makeRetraversalAdapter`, and it keeps an unused `mockedCreateMp`.
  - Property (a) for runs applies a conflict decision in only about 8 of 100 generated sequences.
    A conflict exists only once `qa` is answered `true`.

## Decisions

| # | Decision | Why |
|---|---|---|
| P5-1 | **The §5.8 before/after record is taken through the deployed GraphQL API, not by extending `baseline-capture.test.ts`.** *Before* is captured from live `main` before anything changes. *After* is captured from the deployed pipeline, with the same inputs and clock. `baseline-capture.test.ts` is deleted; its 2026-09-10 record stays in git history and is quoted in the record. | The integration branch holds no runnable copy of `main`'s engine: the traversal changed in plans 02–03, and `makeTraversalAdapter` is gone. An in-process "before" would run the new traversal and hide exactly the differences §5.8 exists to catch. The deployed API compares what production did with what it now does. |
| P5-2 | **The benchmark measures the pipeline's own stages:** `loadEvaluationEnv` / `loadRunEnv`, then `evaluate` per pathway, then `composeRun`, with replay observations. It does not call `evaluateRun`. Every Medication node is included through a provider override, so every medication is a safety candidate. | `evaluateRun` starts a non-blocking pre-warm, which would write to live, and builds a live LLM client, which could call the model. Neither is on a mutation's latency path. An INCLUDE override is a real pipeline input, and it reproduces plan 01's worst case (every medication checked) without editing state behind the pipeline's back. |
| P5-3 | **The backfill runs from the plan branch's build, before the merge to `main`.** | Spec §5.7: re-run the gate *after the backfill, before merging to `main`*. The backfill only touches `medication_normalization_cache`, which exists on live today, and 067/068 do not change it. Side effect: until the deploy, live `main`'s old DDI pass also sees the normalised drugs. There are no users. |
| P5-4 | **The backfill covers ACTIVE and DRAFT only,** as the script and the spec say. The gate reports coverage per pathway. | The run figure is partly covered: its three ARCHIVED children stay unnormalised. The single-pathway figure (chronic-htn, DRAFT) has full coverage of whatever RxNav can map. |
| P5-5 | **Rehearse on a full copy.** Before any live write, `prism_db` is copied to `prism_release_scratch`. The exact live sequence runs there: backfill → 067 → 068 → history rows → pipeline smoke on the migrated schema. | Plan 03/04's Postgres tests start from a schema-only dump, so they never met live data or the live AGE graphs. At 26 MB the full copy costs seconds. |
| P5-6 | **Take a `pg_dump -Fc` of `prism_db` immediately before the live migrations.** Rollback runs **only on the user's instruction**. | 067/068 drop columns and purge tables, and nothing reverses them. The dump is the undo. |
| P5-7 | **The generation probe in the after-record runs only when the session has a pending question.** | A session with a pending question cannot generate, so the probe returns its blockers and writes no care plan. On a ready session the probe would create a care plan on live, so it is skipped and the record says so. |
| P5-8 | **Unmapped medications (NULL cache rows) are the user's to triage,** through the admin queue (`unnormalizedMedications` / `manuallyResolveMedicationNormalization`). The executor lists them and never picks a mapping. | A drug mapping is a clinical decision. |
| P5-9 | **Property (a) gets a companion property whose sequences open with `answer qa = true` then a conflict decision.** A runtime check asserts that every generated sequence applied one. | Conflict decisions are the run feature most likely to be path-dependent (review #6). At about 8 in 100 they were barely exercised. |
| P5-10 | **The admin dashboard gets no code change in this plan.** Its lint has been broken since before plan 04 (ESLint 9, no `eslint.config.*`), so admin verification is `tsc` + `next build`. | A lint config is its own change. It is listed under *Out of scope*. |

## Baseline

| Point | Passed | Failed | Skipped |
|---|---|---|---|
| Task 0 (base) | … | 9 | … |
| Task 5 (end of phase A) | … | 9 | … |

Expected at Task 0: **1670 / 9 / 12**, as plan 04 ended.

Expected at Task 5: **1673 / 9 / 11**.
- `baseline-capture` is deleted (−1 skipped).
- `capture-resolution` adds 2 passing.
- The companion property adds 1 passing.
- Residue removal adds and removes nothing.

Account for any difference.

---

# Phase A — code (plan branch), no live writes except 🔒A

### Task 0: Worktree and baseline

**Files:** none

- [ ] **Step 1: Create the worktree with `/new-feature`, from the integration branch**

Run `/new-feature evaluation-pipeline-05-release` and select **prism-graphql only** (the admin
dashboard gets no code change, P5-10). When it asks for a base, use
**`origin/feat/evaluation-pipeline`**, not `origin/main`. Then:

```bash
git -C $W fetch origin
git -C $W log --oneline -1 origin/feat/evaluation-pipeline
git -C $W merge-base --is-ancestor origin/feat/evaluation-pipeline HEAD && echo based-ok
git -C $W branch --unset-upstream 2>/dev/null; git -C $W status -sb | head -1
```
Expected: `e3df682` or later, `based-ok`, and a branch `feat/evaluation-pipeline-05-release` with
no upstream.

- [ ] **Step 2: Install and record the baseline**

```bash
npm install --prefix $W
npm test --prefix $W/apps/pathway-service -- --runInBand 2>&1 | grep -E "^(FAIL|Tests:)" | sort | uniq -c
$W/node_modules/.bin/tsc -p $W/apps/pathway-service/tsconfig.json --noEmit && echo tsc-clean
```
Expected: the only `FAIL` lines are the two scorer suites; `Tests: 12 skipped, 9 failed,
1670 passed`; `tsc-clean`. Fill in the *Baseline* row. **If the counts differ, stop and report.**

---

### Task 1: Before/after capture tool, and the *before* record 🔒A

**Files:**
- Create: `apps/pathway-service/src/scripts/capture-resolution.ts`
- Create: `apps/pathway-service/src/__tests__/capture-resolution.test.ts`
- Delete: `apps/pathway-service/src/__tests__/baseline-capture.test.ts` (P5-1)
- Create (docs branch): `$REC/before.txt`

**Interfaces:**
- Produces:
  - `recordOf(s: StartedSession, probe?: GenerationProbe | 'skipped'): string[]`
  - `PATIENTS: Record<'withHaemoglobin' | 'noHaemoglobin', PatientContextInput>`
  - CLI `node dist/scripts/capture-resolution.js before|after`, which prints the record to stdout.

**What it records.** For anemia-in-pregnancy-v1 @ 1.4 (the ACTIVE pathway, as in the 2026-09-10
baseline), for each of the two patients `baseline-capture` used, one `startResolution` at a pinned
clock:
- one line per node: `node <id> <type> <status> conf=<3dp> reason=<excludeReason>`;
- one line per pending question, red flag and DDI warning.

After the deploy it also records, in a separate `-- after only` section:
- eligibility where it differs from status, and `withheldBy`;
- the generation probe's blockers (P5-7).

Lines are sorted, so `diff -u before.txt after.txt` is the comparison.

- [ ] **Step 1: Write the failing test**

Create `apps/pathway-service/src/__tests__/capture-resolution.test.ts`:

```ts
import { recordOf } from '../scripts/capture-resolution';

const node = (nodeId: string, status: string, confidence: number, extra: Record<string, unknown> = {}) =>
  ({ nodeId, nodeType: 'Step', status, confidence, excludeReason: null, ...extra });

const SESSION = {
  id: 's-1',
  includedNodes: [node('b', 'INCLUDED', 0.78123), node('a', 'INCLUDED', 0.5)],
  excludedNodes: [node('m', 'EXCLUDED', 0.094, { nodeType: 'Medication', excludeReason: 'low confidence', eligibilityStatus: 'EXCLUDED', withheldBy: null })],
  gatedOutNodes: [],
  pendingQuestions: [{ gateId: 'g2', datumKey: null, tentative: null, tentativeBranch: null }, { gateId: 'g1', datumKey: 'lab:718-7', tentative: false, tentativeBranch: null }],
  redFlags: [],
  ddiWarnings: [],
};

describe('capture-resolution record (plan 05, P5-1)', () => {
  it('is one sorted line per node, question, flag and warning, confidences to 3 dp, no ids or timings', () => {
    expect(recordOf(SESSION as never)).toEqual([
      'node a Step INCLUDED conf=0.500 reason=-',
      'node b Step INCLUDED conf=0.781 reason=-',
      'node m Medication EXCLUDED conf=0.094 reason=low confidence',
      'question g1 datum=lab:718-7 tentative=false branch=-',
      'question g2 datum=- tentative=- branch=-',
    ]);
  });

  it('puts the pipeline-only facts after a separator, so the shared part diffs cleanly', () => {
    const withheld = {
      ...SESSION,
      includedNodes: [],
      excludedNodes: [node('m', 'EXCLUDED', 0.9, { nodeType: 'Medication', excludeReason: 'ALLERGY', eligibilityStatus: 'INCLUDED', withheldBy: 'SAFETY' })],
      pendingQuestions: [],
    };
    expect(recordOf(withheld as never, { success: false, carePlanId: null, blockers: [{ scope: 'OUTPUT', type: 'EMPTY_PLAN', relatedNodeIds: [] }] })).toEqual([
      'node m Medication EXCLUDED conf=0.900 reason=ALLERGY',
      '-- after only',
      'eligibility m eligible=INCLUDED withheldBy=SAFETY',
      'probe success=false carePlan=-',
      'blocker OUTPUT EMPTY_PLAN nodes=-',
    ]);
    expect(recordOf(withheld as never, 'skipped')).toContain('probe skipped (no pending question: generating would write a care plan)');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test --prefix $W/apps/pathway-service -- --runInBand src/__tests__/capture-resolution.test.ts`
Expected: FAIL, `Cannot find module '../scripts/capture-resolution'`.

- [ ] **Step 3: Write the script**

Create `apps/pathway-service/src/scripts/capture-resolution.ts`:

```ts
/**
 * Spec §5.8 before/after record, through the deployed API (plan 05, P5-1).
 *
 * Starts anemia-in-pregnancy-v1 @ 1.4 for two sparse synthetic patients at a
 * pinned clock and prints one sorted line per node, question, flag and
 * warning. `before` runs against live main before the deploy; `after` runs
 * against the deployed pipeline and adds what only the pipeline reports.
 *
 *   node apps/pathway-service/dist/scripts/capture-resolution.js before > before.txt
 *   node apps/pathway-service/dist/scripts/capture-resolution.js after  > after.txt
 *   diff -u before.txt after.txt
 *
 * WRITES: each capture starts two sessions on the target (plan 05 🔒A / 🔒D).
 * `after` abandons its sessions; 067 purges the `before` ones.
 */

const ENDPOINT = process.env.GRAPHQL_URL ?? 'http://localhost:4000/graphql';
const PATHWAY_ID = process.env.CAPTURE_PATHWAY_ID ?? 'a1774566-42ce-43cc-b83c-1a5749b240e1'; // anemia-in-pregnancy-v1 @ 1.4
const AS_OF = '2026-09-10T12:00:00.000Z'; // the 2026-09-10 baseline's clock

const WITH_HB = {
  patientId: '00000000-0000-4000-a000-0000000000ff',
  conditionCodes: [{ code: 'D50.9', system: 'ICD-10' }],
  medications: [],
  allergies: [],
  labResults: [{ code: '718-7', system: 'LOINC', value: 9.4, effectiveDateTime: '2026-08-20' }],
  vitalSigns: {},
  patientAttributes: {},
};
/** The two patients `baseline-capture.test.ts` recorded on 2026-09-10. */
export const PATIENTS = { withHaemoglobin: WITH_HB, noHaemoglobin: { ...WITH_HB, labResults: [] } };

interface Node {
  nodeId: string; nodeType: string; status: string; confidence: number; excludeReason: string | null;
  eligibilityStatus?: string; withheldBy?: string | null;
}
export interface StartedSession {
  id: string;
  resultHash?: string;
  includedNodes: Node[]; excludedNodes: Node[]; gatedOutNodes: Node[];
  pendingQuestions: Array<{ gateId: string; datumKey: string | null; tentative: boolean | null; tentativeBranch: string | null }>;
  redFlags: Array<{ nodeId: string; type: string }>;
  ddiWarnings: Array<{ recommendationId: string; drugName: string; category: string; severity: string }>;
}
export interface GenerationProbe {
  success: boolean;
  carePlanId: string | null;
  blockers: Array<{ scope?: string; type: string; relatedNodeIds: string[] }>;
}

const v = (x: unknown): string => (x === null || x === undefined || x === '' ? '-' : String(x));

/** The record: shared lines sorted, then the pipeline-only section when there is one. */
export function recordOf(s: StartedSession, probe?: GenerationProbe | 'skipped'): string[] {
  const nodes = [...s.includedNodes, ...s.excludedNodes, ...s.gatedOutNodes];
  const shared = [
    ...nodes.map((n) => `node ${n.nodeId} ${n.nodeType} ${n.status} conf=${n.confidence.toFixed(3)} reason=${v(n.excludeReason)}`),
    ...s.pendingQuestions.map((q) => `question ${q.gateId} datum=${v(q.datumKey)} tentative=${v(q.tentative)} branch=${v(q.tentativeBranch)}`),
    ...s.redFlags.map((f) => `flag ${f.nodeId} ${f.type}`),
    ...s.ddiWarnings.map((w) => `ddi ${w.recommendationId} ${w.drugName} ${w.category} ${w.severity}`),
  ].sort();
  const eligibility = nodes
    .filter((n) => n.eligibilityStatus !== undefined && (n.eligibilityStatus !== n.status || n.withheldBy))
    .map((n) => `eligibility ${n.nodeId} eligible=${n.eligibilityStatus} withheldBy=${v(n.withheldBy)}`)
    .sort();
  const probed = probe === undefined ? [] : probe === 'skipped'
    ? ['probe skipped (no pending question: generating would write a care plan)']
    : [
      `probe success=${probe.success} carePlan=${v(probe.carePlanId)}`,
      ...probe.blockers.map((b) => `blocker ${v(b.scope)} ${b.type} nodes=${v([...b.relatedNodeIds].sort().join(','))}`).sort(),
    ];
  const afterOnly = [...eligibility, ...probed];
  return afterOnly.length ? [...shared, '-- after only', ...afterOnly] : shared;
}

async function gql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
  const res = await fetch(ENDPOINT, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query, variables }) });
  const body = (await res.json()) as { data?: T; errors?: Array<{ message: string }> };
  if (body.errors?.length || !body.data) throw new Error(`GraphQL: ${JSON.stringify(body.errors ?? body)}`);
  return body.data;
}

const startQuery = (after: boolean): string => `
  fragment N on ResolvedNode { nodeId nodeType status confidence excludeReason ${after ? 'eligibilityStatus withheldBy' : ''} }
  mutation Capture($pathwayId: ID!, $patientId: ID!, $ctx: PatientContextInput, $asOf: String) {
    startResolution(pathwayId: $pathwayId, patientId: $patientId, patientContext: $ctx, evaluationAsOf: $asOf) {
      id ${after ? 'resultHash' : ''}
      includedNodes { ...N } excludedNodes { ...N } gatedOutNodes { ...N }
      pendingQuestions { gateId datumKey tentative tentativeBranch }
      redFlags { nodeId type }
      ddiWarnings { recommendationId drugName category severity }
    }
  }`;

async function capture(side: 'before' | 'after'): Promise<string[]> {
  const out: string[] = [`# ${side} — pathway ${PATHWAY_ID}, evaluationAsOf ${AS_OF}, ${ENDPOINT}`];
  for (const [name, patient] of Object.entries(PATIENTS)) {
    const { startResolution: s } = await gql<{ startResolution: StartedSession }>(startQuery(side === 'after'), {
      pathwayId: PATHWAY_ID, patientId: patient.patientId, ctx: patient, asOf: AS_OF,
    });
    let probe: GenerationProbe | 'skipped' | undefined;
    if (side === 'after') {
      // P5-7: only a session that cannot generate is probed; the probe then writes no care plan.
      probe = s.pendingQuestions.length === 0 ? 'skipped' : (await gql<{ generateCarePlanFromResolution: GenerationProbe }>(
        `mutation Probe($id: ID!, $h: String!) {
          generateCarePlanFromResolution(sessionId: $id, reviewedResultHash: $h) { success carePlanId blockers { scope type relatedNodeIds } }
        }`, { id: s.id, h: s.resultHash })).generateCarePlanFromResolution;
      await gql(`mutation Done($id: ID!) { abandonSession(sessionId: $id, reason: "plan 05 capture") { id } }`, { id: s.id });
    }
    out.push('', `== ${name}`, ...recordOf(s, probe));
  }
  return out;
}

if (require.main === module) {
  const side = process.argv[2];
  if (side !== 'before' && side !== 'after') {
    console.error('usage: capture-resolution.js before|after');
    process.exitCode = 2;
  } else {
    capture(side)
      .then((lines) => console.log(lines.join('\n')))
      .catch((err) => {
        console.error(err);
        process.exitCode = 1;
      });
  }
}
```

- [ ] **Step 4: Run the test, typecheck, build**

```bash
npm test --prefix $W/apps/pathway-service -- --runInBand src/__tests__/capture-resolution.test.ts
$W/node_modules/.bin/tsc -p $W/apps/pathway-service/tsconfig.json --noEmit && echo tsc-clean
npm run build --prefix $W/apps/pathway-service
ls $W/apps/pathway-service/dist/scripts/capture-resolution.js
```
Expected: 2 passed, `tsc-clean`, and the built file exists.

**Falsify:** remove the `.sort()` that closes `shared`. The first test must fail on the order of
`a` and `b`. Restore it.

- [ ] **Step 5: Delete `baseline-capture.test.ts` (P5-1) and commit**

```bash
git -C $W rm -q apps/pathway-service/src/__tests__/baseline-capture.test.ts
git -C $W add apps/pathway-service/src/scripts/capture-resolution.ts apps/pathway-service/src/__tests__/capture-resolution.test.ts
git -C $W commit -q -m "feat(pathway-service): before/after capture through the deployed API

The spec §5.8 record, taken from what production runs: anemia-in-pregnancy
v1.4 for the two patients of the 2026-09-10 baseline, one sorted line per
node, question, flag and warning. baseline-capture.test.ts is deleted: it
imported makeTraversalAdapter, which no longer exists, and an in-process
'before' would run the new traversal.

Claude-Session: https://claude.ai/code/session_01XRNkZvQrxmRLNtJHxq71kH"
```

- [ ] **Step 6: 🔒A Capture *before* from live `main`**

Live must still be `main` @ `2454130`, and the cache must still be empty. Capture before the
backfill (Task 6), so *before* is what production ran:

```bash
git -C $L log --oneline -1
export PGPASSWORD=$(pm2 env 0 | sed 's/\x1b\[[0-9;]*m//g' | awk -F': ' '/^POSTGRES_PASSWORD/{print $2}')
psql -h localhost -U prism -d prism_db -Atc "SELECT count(*) FROM medication_normalization_cache"
mkdir -p $REC
node $W/apps/pathway-service/dist/scripts/capture-resolution.js before > $REC/before.txt
head -3 $REC/before.txt; grep -c '^node ' $REC/before.txt
```
Expected: `2454130`, then `0`, and a non-empty node list for each patient.
- The 2026-09-10 in-process capture counted 49 nodes per patient. The API lists only included,
  excluded and gated-out nodes, so a lower count is possible. Note it in the record's header.
- **Stop and report if either patient's section is missing or has no `node` lines.**
- Do not retry with other inputs: the before-record must use the same inputs as the after-record.

Also check the pending-question count against the 2026-09-10 baseline:

```bash
awk '/^== /{p=$2} /^question /{c[p]++} END{for (k in c) print k, c[k]}' $REC/before.txt
```
Expected: `withHaemoglobin 1` and `noHaemoglobin 2`. A difference is not a defect of this plan,
because live changed between 2026-09-10 and now. **Note it in the record's header.**

Commit on the docs branch:
```bash
git -C $D add docs/superpowers/records/evaluation-pipeline-05/before.txt
git -C $D commit -q -m "docs: evaluation pipeline release — before record (live main 2454130)

Claude-Session: https://claude.ai/code/session_01XRNkZvQrxmRLNtJHxq71kH"
```

---

### Task 2: The performance gate on the real pipeline (P5-2)

**Files:**
- Modify (full replacement): `apps/pathway-service/src/__tests__/evaluation-benchmark.test.ts`

**Interfaces:**
- Consumes (plans 02–04):
  - `loadEvaluationEnv(pool, pathwayId, universe): Promise<EvaluationEnv>`
  - `loadRunEnv(pool, pathwayIds, universe): Promise<RunEnv>`
  - `evaluate(inputs, env, observations, scope): Promise<EvaluationResult>`
  - `replayObservations(frozen, model)`
  - `composeRun(contributions, ctx): RunResult`
  - `medicationName(node)`, `normalizedKey(input)`
  - `SessionInputs`, `ProviderOverride`
- Produces: env flags `RUN_EVALUATION_BENCHMARK=1` (run it) and `EXPECT_DDI_COVERAGE=1` (after
  the backfill: fail unless the single pathway has normalised candidates).

- [ ] **Step 1: Confirm the current file cannot run**

```bash
grep -n "makeTraversalAdapter" $W/apps/pathway-service/src/__tests__/evaluation-benchmark.test.ts
grep -rn "export function makeTraversalAdapter\|export const makeTraversalAdapter" $W/apps/pathway-service/src || echo "no such export"
```
Expected: an import line, then `no such export`.

- [ ] **Step 2: Replace the file**

Overwrite `apps/pathway-service/src/__tests__/evaluation-benchmark.test.ts` with:

```ts
/**
 * EVALUATION PERFORMANCE GATE — spec §5.7, on the pipeline itself (plan 05, P5-2).
 *
 * Measures what every mutation evaluates: one environment snapshot
 * (loadEvaluationEnv / loadRunEnv, C4), `evaluate` per pathway, and for a run
 * `composeRun` (D13). Observations are replayed (no LLM call), and every
 * Medication node carries a provider INCLUDE override, so every medication is
 * a safety candidate: the pipeline's worst case, through a real input.
 * Not measured: the commit transaction, the non-blocking pre-warm, the LLM.
 *
 * Opt-in and read-only against the live database:
 *
 *   export POSTGRES_PASSWORD=$(pm2 env 0 | sed 's/\x1b\[[0-9;]*m//g' \
 *     | awk -F': ' '/^POSTGRES_PASSWORD/{print $2}')
 *   RUN_EVALUATION_BENCHMARK=1 npm test --prefix apps/pathway-service -- \
 *     --runInBand src/__tests__/evaluation-benchmark.test.ts
 *
 * After the normalisation backfill add EXPECT_DDI_COVERAGE=1: the single
 * pathway must then have normalised candidates, or the gate measured no
 * interaction data.
 */

import { Pool } from 'pg';
import { performance } from 'perf_hooks';
import type { GraphNode, PatientContext } from '../services/confidence/types';
import { normalizedKey } from '../services/medications/safety-reference';
import { composeRun } from '../services/resolution/pipeline/compose';
import { evaluate } from '../services/resolution/pipeline/evaluate';
import { loadEvaluationEnv, loadRunEnv, medicationName } from '../services/resolution/pipeline/load-env';
import type { EvaluationEnv } from '../services/resolution/pipeline/load-env';
import { replayObservations } from '../services/resolution/pipeline/observations';
import type { EvaluationResult, SessionInputs } from '../services/resolution/pipeline/types';
import { makeEvaluationTemporalContext } from '../services/resolution/temporal/evaluation-context';
import { NodeStatus, OverrideAction } from '../services/resolution/types';

const SINGLE = '8d7fbfc6-06cf-4caa-a4e7-2efe07e9ea6c'; // chronic-htn-pregnancy-v1@1.0 (DRAFT: backfilled)
const RUN = [
  SINGLE,
  '9ee949c9-625a-48ac-873b-c121e8fd24e2', // gestational-hypertension-preeclampsia@1 (DRAFT: backfilled)
  '40c06c6b-4699-47e3-bba5-c72ca72e9e7d', // routine-prenatal-care-v1@1.0 (ARCHIVED)
  'ae6b0d51-3e89-4c0e-a062-d0a8eec01b69', // vaginal-discharge-pregnancy-v1@1.0 (ARCHIVED)
  'a9600763-ba44-4481-9d0b-b66d63dd04dc', // anemia-pregnancy-v1@1.0 (ARCHIVED)
];
const BUDGET_P95_MS = { single: 2000, run: 5000 }; // spec §5.7
// Workload floors (live graphs on 2026-09-14: 109 / 405 nodes, 9 / 29 medications).
// A shrunken workload must fail here, not show up as a speed-up.
const MIN_NODES = { single: 100, run: 400 };
const MIN_CANDIDATES = { single: 9, run: 25 };
const WARMUP = 3;
const SAMPLES = 20;
const TEMPORAL = makeEvaluationTemporalContext({ evaluationAsOf: '2026-09-14T12:00:00.000Z', temporalPolicyVersion: 'v1' });

// Pre-existing HTN in pregnancy, elevated BP, an anaemia lab, and one patient
// medication and allergy so the safety stage has patient-side work to do.
const PATIENT = {
  patientId: '00000000-0000-4000-a000-0000000000fe',
  conditionCodes: [
    { code: 'O10.01', system: 'ICD-10' },
    { code: '8762007', system: 'SNOMED' },
  ],
  medications: [{ code: '6185', system: 'RxNorm', display: 'Labetalol' }],
  allergies: [{ code: '91936005', system: 'SNOMED', display: 'Allergy to penicillin' }],
  labResults: [{ code: '718-7', system: 'LOINC', value: 9.4, effectiveDateTime: '2026-09-01' }],
  vitalSigns: { systolic_bp: 150, diastolic_bp: 95 },
  patientAttributes: {},
} as unknown as PatientContext;

const medicationsOf = (env: EvaluationEnv): GraphNode[] =>
  env.resolution.graphContext.allNodes.filter((n) => n.nodeType === 'Medication');

/** A session's inputs: nothing answered; the provider has included every Medication node. */
function inputsFor(pathwayId: string, env: EvaluationEnv): SessionInputs {
  return {
    pathwayId,
    graphFingerprint: env.graphFingerprint,
    temporalContext: TEMPORAL,
    initialPatientContext: PATIENT,
    additionalContext: {},
    gateAnswers: new Map(),
    providerOverrides: new Map(medicationsOf(env).map((n) => [n.nodeIdentifier, {
      action: OverrideAction.INCLUDE, originalStatus: NodeStatus.EXCLUDED, originalConfidence: 0,
    }])),
    observations: new Map(),
    revision: 0,
  };
}

const evaluateIn = (pathwayId: string, env: EvaluationEnv, scope: 'ROOT' | 'CONTRIBUTION') =>
  evaluate(inputsFor(pathwayId, env), env, replayObservations(new Map(), env.llmModel ?? ''), scope);

interface Workload { nodes: number; resolved: number; candidates: number; normalised: number }

/** What was evaluated: graph size, nodes resolved, eligible medications, and how many of those have a normalised row. */
function workloadOf(env: EvaluationEnv, r: EvaluationResult): Workload {
  const candidates = [...r.resolutionState.values()]
    .filter((n) => n.nodeType === 'Medication' && n.eligibility?.status === NodeStatus.INCLUDED);
  const byId = new Map(medicationsOf(env).map((n) => [n.nodeIdentifier, n]));
  const normalised = candidates.filter((n) => {
    const node = byId.get(n.nodeId);
    return node !== undefined && Boolean(env.safety.normalized.get(normalizedKey({ text: medicationName(node) })));
  }).length;
  return { nodes: env.resolution.graphContext.allNodes.length, resolved: r.resolutionState.size, candidates: candidates.length, normalised };
}

async function single(pool: Pool) {
  const t0 = performance.now();
  const env = await loadEvaluationEnv(pool, SINGLE, { patient: PATIENT });
  const t1 = performance.now();
  const r = await evaluateIn(SINGLE, env, 'ROOT');
  const t2 = performance.now();
  return { env: t1 - t0, evaluate: t2 - t1, total: t2 - t0, workload: workloadOf(env, r), pairs: env.safety.pairs.size };
}

async function run(pool: Pool) {
  const t0 = performance.now();
  const env = await loadRunEnv(pool, RUN, { patient: PATIENT });
  const t1 = performance.now();
  const contributions = [];
  const workloads: Workload[] = [];
  for (const id of RUN) {
    const childEnv = env.children.get(id)!;
    const result = await evaluateIn(id, childEnv, 'CONTRIBUTION');
    contributions.push({ pathwayId: id, sessionId: '', result });
    workloads.push(workloadOf(childEnv, result));
  }
  const t2 = performance.now();
  composeRun(contributions, {
    patient: PATIENT, conflictResolutions: {}, safety: env.safety, meta: env.meta, envFingerprint: env.envFingerprint,
  });
  const t3 = performance.now();
  return { env: t1 - t0, evaluate: t2 - t1, compose: t3 - t2, total: t3 - t0, workloads };
}

async function sample<T>(n: number, fn: () => Promise<T>): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < n; i++) out.push(await fn());
  return out;
}

const pct = (values: number[], q: number): number => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(q * sorted.length) - 1)];
};
const ms = (v: number) => `${v.toFixed(0)}ms`;
const row = (label: string, values: number[]) =>
  `${label.padEnd(40)} p50 ${ms(pct(values, 0.5)).padStart(7)}   p95 ${ms(pct(values, 0.95)).padStart(7)}`;
const sum = (ws: Workload[], k: keyof Workload) => ws.reduce((s, w) => s + w[k], 0);

const describeBenchmark = process.env.RUN_EVALUATION_BENCHMARK === '1' ? describe : describe.skip;

describeBenchmark('evaluation performance gate on the pipeline (live DB, read-only)', () => {
  it('fits the spec §5.7 budgets', async () => {
    const pool = new Pool({
      host: process.env.POSTGRES_HOST ?? 'localhost',
      user: process.env.POSTGRES_USER ?? 'prism',
      password: process.env.POSTGRES_PASSWORD,
      database: process.env.POSTGRES_DB ?? 'prism_db',
    });
    // AGE setup as database.ts does it, plus a read-only guard: any write the
    // measured code attempts fails loudly instead of touching the live DB.
    pool.on('connect', (client) => {
      client
        .query("LOAD 'age'; SET search_path = ag_catalog, \"$user\", public; SET default_transaction_read_only = on;")
        .catch(() => { /* surfaced by the query that needs it */ });
    });

    try {
      // Prove the guard before trusting its silence: a write must be refused.
      await expect(pool.query('CREATE TEMP TABLE bench_write_probe (x int)')).rejects.toThrow(/read-only/);

      await sample(WARMUP, () => single(pool));
      const singles = await sample(SAMPLES, () => single(pool));
      await sample(WARMUP, () => run(pool));
      const runs = await sample(SAMPLES, () => run(pool));

      // Workload: the measured work must be the intended work.
      for (const s of singles) {
        expect(s.workload.nodes).toBeGreaterThanOrEqual(MIN_NODES.single);
        expect(s.workload.resolved).toBe(s.workload.nodes);
        expect(s.workload.candidates).toBeGreaterThanOrEqual(MIN_CANDIDATES.single);
      }
      for (const r of runs) {
        expect(sum(r.workloads, 'nodes')).toBeGreaterThanOrEqual(MIN_NODES.run);
        expect(sum(r.workloads, 'candidates')).toBeGreaterThanOrEqual(MIN_CANDIDATES.run);
        for (const w of r.workloads) expect(w.resolved).toBe(w.nodes);
      }
      if (process.env.EXPECT_DDI_COVERAGE === '1') expect(singles[0].workload.normalised).toBeGreaterThan(0);

      const s0 = singles[0];
      const r0 = runs[0];
      // eslint-disable-next-line no-console
      console.log([
        '',
        `single pathway ${SINGLE}, ROOT scope (${SAMPLES} samples)`,
        `  workload: ${s0.workload.nodes} nodes, ${s0.workload.resolved} resolved, ${s0.workload.candidates} safety candidates, ` +
          `${s0.workload.normalised} normalised, ${s0.pairs} interaction pairs loaded`,
        row('  env snapshot', singles.map((s) => s.env)),
        row('  evaluate', singles.map((s) => s.evaluate)),
        row('  total', singles.map((s) => s.total)),
        `  budget p95 < ${BUDGET_P95_MS.single}ms`,
        '',
        `5-child run: one snapshot, 5 contributions, composeRun (${SAMPLES} samples)`,
        `  workload: ${sum(r0.workloads, 'nodes')} nodes, ${sum(r0.workloads, 'candidates')} safety candidates, ` +
          `${sum(r0.workloads, 'normalised')} normalised`,
        ...RUN.map((id, i) => `    ${id}: ${r0.workloads[i].candidates} candidates, ${r0.workloads[i].normalised} normalised`),
        row('  env snapshot', runs.map((r) => r.env)),
        row('  evaluate (5 children)', runs.map((r) => r.evaluate)),
        row('  composeRun', runs.map((r) => r.compose)),
        row('  total', runs.map((r) => r.total)),
        `  budget p95 < ${BUDGET_P95_MS.run}ms`,
        '',
      ].join('\n'));

      expect(pct(singles.map((s) => s.total), 0.95)).toBeLessThan(BUDGET_P95_MS.single);
      expect(pct(runs.map((r) => r.total), 0.95)).toBeLessThan(BUDGET_P95_MS.run);
    } finally {
      await pool.end();
    }
  }, 900_000);
});
```

- [ ] **Step 3: It stays skipped by default; typecheck**

```bash
npm test --prefix $W/apps/pathway-service -- --runInBand src/__tests__/evaluation-benchmark.test.ts 2>&1 | grep -E "^Tests:"
$W/node_modules/.bin/tsc -p $W/apps/pathway-service/tsconfig.json --noEmit && echo tsc-clean
```
Expected: `Tests: 1 skipped, 1 total`; `tsc-clean`. Test files are not typechecked, so also check
that every import resolves:

```bash
for sym in normalizedKey composeRun evaluate loadEvaluationEnv loadRunEnv medicationName replayObservations makeEvaluationTemporalContext; do
  grep -rqE "export (async )?(function|const) $sym\b" $W/apps/pathway-service/src/services || echo "MISSING $sym"
done; echo imports-checked
```
Expected: only `imports-checked`.

- [ ] **Step 4: Run it against live, read-only (pre-backfill measurement)**

The read-only guard runs first; the overview's constraint (live reads only in opt-in tests that
force read-only) holds.

```bash
export PGPASSWORD=$(pm2 env 0 | sed 's/\x1b\[[0-9;]*m//g' | awk -F': ' '/^POSTGRES_PASSWORD/{print $2}')
RUN_EVALUATION_BENCHMARK=1 POSTGRES_PASSWORD=$PGPASSWORD \
  npm test --prefix $W/apps/pathway-service -- --runInBand src/__tests__/evaluation-benchmark.test.ts 2>&1 | tail -40
```
Expected: PASS. The table prints `0 normalised` everywhere (the cache is empty). Keep the output:
it is the *pre-backfill* row of Task 7's table.

- **If a workload floor fails,** stop and report the count. That would mean INCLUDE overrides on
  unreachable Medication nodes do not make them candidates, which is a finding about the pipeline.
  **Never lower a floor.**
- **If a budget fails,** stop: spec §5.7 says revisit D1/D13 before anything else.

**Falsify:** raise `MIN_CANDIDATES.single` to `candidates + 1`, using the printed count. The run
must fail with `Expected: >= …`. Restore it.

- [ ] **Step 5: Commit**

```bash
git -C $W add apps/pathway-service/src/__tests__/evaluation-benchmark.test.ts
git -C $W commit -q -m "test(pathway-service): performance gate on the pipeline's own stages

The merged benchmark imported makeTraversalAdapter, which no longer exists,
so it could not run. It now measures what a mutation evaluates: one
environment snapshot, evaluate per pathway, composeRun for a run, with
replayed observations and every medication included by provider override.
EXPECT_DDI_COVERAGE=1 fails the gate if nothing was normalised.

Claude-Session: https://claude.ai/code/session_01XRNkZvQrxmRLNtJHxq71kH"
```

---

### Task 3: Test residue

**Files:**
- Modify: `apps/pathway-service/src/__tests__/temporal/resolution-fact-store-wiring.test.ts`

- [ ] **Step 1: Note the file's passed count, then remove the stale mocks and the unused `mockedCreateMp`**

```bash
npm test --prefix $W/apps/pathway-service -- --runInBand src/__tests__/temporal/resolution-fact-store-wiring.test.ts 2>&1 | grep -E "^Tests:"
```

In the `jest.mock('../../resolvers/helpers/resolution-context', …)` factory, delete these two
lines. Neither function exists any more.

```ts
  makeTraversalAdapter: jest.fn(() => ({ computeNodeConfidence: jest.fn() })),
  makeRetraversalAdapter: jest.fn(() => ({ computeNodeConfidence: jest.fn() })),
```

Delete the import:

```ts
import { createMultiPathwaySession } from '../../services/resolution/multi-pathway-session-store';
```

Delete the declaration:

```ts
const mockedCreateMp = createMultiPathwaySession as jest.MockedFunction<
  typeof createMultiPathwaySession
>;
```

Delete the line in `beforeEach`:

```ts
  mockedCreateMp.mockResolvedValue('mp-1');
```

- [ ] **Step 2: Verify nothing else refers to them, and the suite is unchanged**

```bash
F=$W/apps/pathway-service/src/__tests__/temporal/resolution-fact-store-wiring.test.ts
grep -nE "mockedCreateMp|createMultiPathwaySession|makeTraversalAdapter|makeRetraversalAdapter" $F || echo clean
npm test --prefix $W/apps/pathway-service -- --runInBand src/__tests__/temporal/resolution-fact-store-wiring.test.ts 2>&1 | grep -E "^Tests:"
```
Expected: `clean`, and the same passed count as Step 1.

- [ ] **Step 3: Commit**

```bash
git -C $W add apps/pathway-service/src/__tests__/temporal/resolution-fact-store-wiring.test.ts
git -C $W commit -q -m "test(pathway-service): drop mocks of functions that no longer exist

Claude-Session: https://claude.ai/code/session_01XRNkZvQrxmRLNtJHxq71kH"
```

---

### Task 4: Property (a) with conflict decisions in every sequence (P5-9)

**Files:**
- Modify: `apps/pathway-service/src/__tests__/pipeline-run-sequence-vs-fresh.test.ts`

**Interfaces:**
- Consumes (same file): `Edit`, `answerArb`, `overrideArb`, `factArb`, `chooseArb`, `applyEdit`,
  `finalInputs`, `freshHash`, `startRun`, `register`, `runInputsOf`, `loadRun`, `harness`

- [ ] **Step 1: Add the companion property**

In the `describe('property (a) for runs: …')` block, after the existing
`it('holds for any sequence of answers, overrides, facts and conflict decisions across children', …)`,
add:

```ts
  it('holds when the conflict exists from the start and a decision is always applied (P5-9)', async () => {
    const openWithConflict = fc.tuple(chooseArb, fc.array(fc.oneof(answerArb, overrideArb, factArb, chooseArb), { maxLength: 7 }))
      .map(([decision, rest]): Edit[] => [{ kind: 'answer', gate: 'qa', value: true }, decision, ...rest]);
    await fc.assert(fc.asyncProperty(openWithConflict, async (edits) => {
      harness.reset();
      register();
      const runId = await startRun();
      const start = runInputsOf(await loadRun(harness.pool(), runId));

      const applied: Edit[] = [];
      for (const e of edits) if (await applyEdit(runId, e)) applied.push(e);
      // Runtime guard: this property exists to exercise decisions (P5-9).
      if (!applied.some((e) => e.kind === 'choose')) throw new Error(`no decision applied: ${JSON.stringify(edits)}`);

      const stored = harness.run(runId).resultHash;
      expect(await freshHash(finalInputs(start, applied))).toBe(stored);
      expect(await freshHash(runInputsOf(await loadRun(harness.pool(), runId)))).toBe(stored);
    }), { numRuns: 30 });
  });
```

- [ ] **Step 2: Run it**

```bash
npm test --prefix $W/apps/pathway-service -- --runInBand src/__tests__/pipeline-run-sequence-vs-fresh.test.ts
```
Expected: PASS. The file's test count goes up by 1.

**If the property fails, stop and report fast-check's shrunk counterexample before changing
anything** (the overview's rule for property (a)).

**Falsify, one at a time, restoring each:**
1. **The guard can fire.** Change the prefix's `value: true` to `value: false`. The test must fail
   with `no decision applied`.
2. **The property sees decisions.** In `finalInputs`, comment out the `if (e.kind === 'choose')`
   branch. The new test must fail on the first `toBe(stored)`. The old property must also fail, if
   one of its 30 runs applied a decision; that it may pass is exactly the gap P5-9 closes.

- [ ] **Step 3: Commit**

```bash
git -C $W add apps/pathway-service/src/__tests__/pipeline-run-sequence-vs-fresh.test.ts
git -C $W commit -q -m "test(pathway-service): property (a) with a conflict decision in every sequence

The existing property applied a decision in about 8 of 100 sequences,
because a conflict exists only once qa is answered true. The companion
property opens every sequence with that answer and a decision, and a
runtime guard fails if none was applied.

Claude-Session: https://claude.ai/code/session_01XRNkZvQrxmRLNtJHxq71kH"
```

---

### Task 5: Pre-merge gate — suite, Postgres tests, full-copy rehearsal (P5-5), PR

**Files:** none in the repo. Rehearsal notes go to `$REC/rehearsal.md` (docs branch).

- [ ] **Step 1: Full suite, typecheck, build**

```bash
npm test --prefix $W/apps/pathway-service -- --runInBand 2>&1 | grep -E "^(FAIL|Tests:)" | sort | uniq -c
$W/node_modules/.bin/tsc -p $W/apps/pathway-service/tsconfig.json --noEmit && echo tsc-clean
npm run build --prefix $W/apps/pathway-service && echo built
```
Expected: only the two scorer `FAIL` lines; `Tests: 11 skipped, 9 failed, 1673 passed`;
`tsc-clean`; `built`. Fill in the *Baseline* row.

- [ ] **Step 2: The opt-in Postgres tests (spec §5.6: required before merge)**

```bash
export PGPASSWORD=$(pm2 env 0 | sed 's/\x1b\[[0-9;]*m//g' | awk -F': ' '/^POSTGRES_PASSWORD/{print $2}')
dropdb -h localhost -U prism --if-exists prism_eval_scratch
createdb -h localhost -U prism prism_eval_scratch
pg_dump -h localhost -U prism --schema-only --no-owner prism_db | psql -q -h localhost -U prism prism_eval_scratch 2>&1 | grep -vi "age\|ag_catalog" | head -5
RUN_PIPELINE_PG_TESTS=1 PIPELINE_PG_DATABASE=prism_eval_scratch POSTGRES_PASSWORD=$PGPASSWORD \
  npm test --prefix $W/apps/pathway-service -- --runInBand src/__tests__/pipeline-postgres.test.ts 2>&1 | grep -E "^Tests:"
dropdb -h localhost -U prism prism_eval_scratch
```
Expected: `Tests: 10 passed`.

- [ ] **Step 3: Rehearse the live sequence on a full copy (P5-5)**

This is the exact order Tasks 6 and 8 use on live: backfill first, at 066, then 067 and 068 with
their history rows.

```bash
export PGPASSWORD=$(pm2 env 0 | sed 's/\x1b\[[0-9;]*m//g' | awk -F': ' '/^POSTGRES_PASSWORD/{print $2}')
dropdb -h localhost -U prism --if-exists prism_release_scratch
createdb -h localhost -U prism prism_release_scratch
pg_dump -h localhost -U prism -Fc prism_db > $SP/release-rehearsal.dump
pg_restore -h localhost -U prism -d prism_release_scratch --no-owner $SP/release-rehearsal.dump 2>&1 | tail -3
psql -h localhost -U prism -d prism_release_scratch -Atc "SELECT max(migration_id), (SELECT count(*) FROM pathway_graph_index) FROM migration_history"
```
Expected: `066_backfill_remaining_branch_mode|14`. `pg_restore` may warn about AGE extension
ownership. **Stop if the graph count is not 14.**

Backfill against the copy, dry run first, then for real. This calls RxNav and writes only the
copy's cache:

```bash
POSTGRES_DB=prism_release_scratch POSTGRES_PASSWORD=$PGPASSWORD node $W/apps/pathway-service/dist/scripts/backfill-medication-normalization.js --dry-run | tee $SP/rehearsal-dry.txt | tail -12
POSTGRES_DB=prism_release_scratch POSTGRES_PASSWORD=$PGPASSWORD node $W/apps/pathway-service/dist/scripts/backfill-medication-normalization.js | tail -12
psql -h localhost -U prism -d prism_release_scratch -Atc "SELECT count(*) FILTER (WHERE ingredient_rxcui IS NOT NULL), count(*) FILTER (WHERE ingredient_rxcui IS NULL) FROM medication_normalization_cache"
```
Expected:
- The dry run lists 9 pathways (1 ACTIVE, 8 DRAFT) with their medication names.
- The real run ends `9 pathways: N normalised, F not`.
- The query prints `mapped|unmapped`, with `mapped + unmapped` equal to the number of distinct
  names the dry run listed.
- A **network** failure (`failed` > 0, no row written) is not a no-match. Re-run the script once;
  if it still fails, report.

Apply 067 and 068 exactly as `CLAUDE.md` prescribes for live:

```bash
MIG=$W/shared/data-layer/migrations
for f in 067_evaluation_inputs.sql 068_run_inputs.sql; do
  id="${f%.sql}"
  checksum=$(node -e "console.log(require('crypto').createHash('sha256').update(require('fs').readFileSync('${MIG}/${f}','utf-8').trim()).digest('hex'))")
  psql -h localhost -U prism -d prism_release_scratch -v ON_ERROR_STOP=1 -f "${MIG}/${f}" || break
  psql -h localhost -U prism -d prism_release_scratch -c \
    "INSERT INTO migration_history (migration_id, name, checksum) VALUES ('$id', '$id', '$checksum');" || break
done
psql -h localhost -U prism -d prism_release_scratch -Atc "SELECT migration_id, checksum FROM migration_history WHERE migration_id >= '067' ORDER BY 1"
```
Expected: both files apply without error, and two history rows. **Record both checksums.** Task 8
must reproduce them exactly on live, which proves the files did not change between rehearsal and
deploy.

Smoke the migrated copy with the pipeline, read-only. The benchmark exercises `loadEvaluationEnv`,
`loadRunEnv`, `evaluate` and `composeRun` on real graphs:

```bash
RUN_EVALUATION_BENCHMARK=1 EXPECT_DDI_COVERAGE=1 POSTGRES_DB=prism_release_scratch POSTGRES_PASSWORD=$PGPASSWORD \
  npm test --prefix $W/apps/pathway-service -- --runInBand src/__tests__/evaluation-benchmark.test.ts 2>&1 | tail -30
```
Expected: PASS, with `normalised` > 0 on the single pathway. This is also a first look at Task 7's
numbers.

Clean up:
```bash
dropdb -h localhost -U prism prism_release_scratch
rm -f $SP/release-rehearsal.dump $SP/rehearsal-dry.txt
```

Write `$REC/rehearsal.md` with:
- the date and the source `migration_history` head;
- the dry-run pathway and medication count;
- the backfill result (`N normalised, F not`);
- the unmapped names;
- the two checksums;
- the benchmark table from the migrated copy.

Commit it on the docs branch (`docs: evaluation pipeline release — rehearsal record`, with the
trailer).

- [ ] **Step 4: Push and hand over the PR into the integration branch**

```bash
git -C $W push -u origin HEAD:refs/heads/feat/evaluation-pipeline-05-release
git -C $D push -q origin docs/evaluation-pipeline-design
gh pr create -R Prism-Clinical/prism-graphql --base feat/evaluation-pipeline --head feat/evaluation-pipeline-05-release \
  --title "Evaluation pipeline 05: release tooling and pre-merge checks" --body-file <(printf '%s\n' \
  "Plan: docs/superpowers/plans/2026-09-22-evaluation-pipeline-05-release.md (branch docs/evaluation-pipeline-design), phase A." \
  "" "Before/after capture through the deployed API (§5.8); the performance gate on the pipeline's own stages (the merged benchmark could not run); test residue; property (a) with a decision in every sequence; Postgres tests and a full-copy rehearsal of the live sequence passed.")
```
If `gh` is unauthenticated, give the compare URL:
`https://github.com/Prism-Clinical/prism-graphql/compare/feat/evaluation-pipeline...feat/evaluation-pipeline-05-release`

- [ ] **Step 5: STOP — merge point 1**

Report:
- the *Baseline* table;
- each falsification outcome;
- the Postgres test result;
- the rehearsal record;
- the pre-backfill benchmark table;
- the list of names RxNav could not map.

**Wait until the user says the PR is merged into `feat/evaluation-pipeline`.** Then continue with
Task 6.

---

# Phase B — live operations

Before starting, confirm that the phase-A PR is merged:

```bash
git -C $W fetch -q origin
git -C $W merge-base --is-ancestor origin/feat/evaluation-pipeline-05-release origin/feat/evaluation-pipeline && echo merged
```

### Task 6: 🔒B Normalisation backfill on live (P5-3, P5-4, P5-8)

**Files:** `$REC/backfill.md` (docs branch)

- [ ] **Step 1: Pre-check, then dry run**

```bash
export PGPASSWORD=$(pm2 env 0 | sed 's/\x1b\[[0-9;]*m//g' | awk -F': ' '/^POSTGRES_PASSWORD/{print $2}')
psql -h localhost -U prism -d prism_db -Atc "SELECT count(*) FROM medication_normalization_cache"
POSTGRES_PASSWORD=$PGPASSWORD node $W/apps/pathway-service/dist/scripts/backfill-medication-normalization.js --dry-run | tail -12
```
Expected: `0` rows, and the same pathway list as the rehearsal's dry run. **If the list differs,
stop.** Live changed since the rehearsal; report what changed.

- [ ] **Step 2: Run the backfill**

```bash
POSTGRES_PASSWORD=$PGPASSWORD node $W/apps/pathway-service/dist/scripts/backfill-medication-normalization.js | tee $SP/backfill.txt | tail -12
psql -h localhost -U prism -d prism_db -Atc "SELECT count(*) FILTER (WHERE ingredient_rxcui IS NOT NULL), count(*) FILTER (WHERE ingredient_rxcui IS NULL) FROM medication_normalization_cache"
psql -h localhost -U prism -d prism_db -Atc "SELECT input_text FROM medication_normalization_cache WHERE ingredient_rxcui IS NULL ORDER BY 1"
```
Expected: the same `mapped|unmapped` split as the rehearsal, give or take RxNav answering
differently between runs. A transient network failure leaves a name without a row. Re-run the
script once for those; rows already cached are skipped.

- [ ] **Step 3: Record, and hand the unmapped names to the user (P5-8)**

Write `$REC/backfill.md` with the timestamp, the result line, the split and the unmapped names.
Commit it on the docs branch.

Tell the user:
- Each unmapped name blocks generation for any plan that includes it (`SAFETY_DATA_UNAVAILABLE`).
- Triage is theirs, in the admin queue (`unnormalizedMedications` →
  `manuallyResolveMedicationNormalization`). It can happen before or after the deploy.

**Do not resolve any mapping.**

---

### Task 7: Gate re-run with real coverage (spec §5.7), and the PRs to `main` / `master`

**Files:** plan 01's *Gate result* section, and this plan's *Gate re-run* section (docs branch).

- [ ] **Step 1: Re-run the gate against live, read-only**

```bash
RUN_EVALUATION_BENCHMARK=1 EXPECT_DDI_COVERAGE=1 POSTGRES_PASSWORD=$PGPASSWORD \
  npm test --prefix $W/apps/pathway-service -- --runInBand src/__tests__/evaluation-benchmark.test.ts 2>&1 | tail -30
```
Expected: PASS, with `normalised` > 0 on the single pathway and on both DRAFT run children. The
ARCHIVED children still show 0 (P5-4).

**If a budget fails, stop. Do not open the PRs to `main`** (spec §5.7: revisit D1/D13).

- [ ] **Step 2: Record the result**

Fill in *Gate re-run* at the end of this plan, with Task 2 Step 4's pre-backfill numbers next to
these. Under plan 01's *Gate result (2026-09-14, revised after review)*, add one line pointing to
it:

```markdown
**Re-run after the backfill (plan 05, YYYY-MM-DD):** see `2026-09-22-evaluation-pipeline-05-release.md`, *Gate re-run*.
```

Commit both on the docs branch and push.

- [ ] **Step 3: Hand over the two merges**

Both are fast-forwards (see *Live facts*):

```bash
G=/home/claude/workspace/prism-graphql; A=/home/claude/workspace/prism-admin-dashboard
git -C $G fetch -q origin; git -C $A fetch -q origin
git -C $G rev-list --count origin/feat/evaluation-pipeline..origin/main
git -C $A rev-list --count origin/feat/evaluation-pipeline..origin/master
```
Expected: `0` and `0` (nothing on `main` / `master` that the integration branches lack). **If
either is not 0, stop.** The merge is no longer a fast-forward, and the user decides how to
integrate.

Open, or hand over as compare URLs:
- `https://github.com/Prism-Clinical/prism-graphql/compare/main...feat/evaluation-pipeline`, titled
  "Evaluation pipeline: recompute from recorded inputs"
- `https://github.com/Prism-Clinical/prism-admin-dashboard/compare/master...feat/evaluation-pipeline`,
  titled "Evaluation pipeline: runs, reviewed-hash generation"

Say in both bodies: *"Breaking API change: backend and admin deploy together (spec §4
Deployment)."*

- [ ] **Step 4: STOP — merge point 2**

Report:
- the gate re-run table;
- the backfill split;
- the unmapped names still open;
- the two compare URLs.

**Wait until the user says both are merged.** Then continue with Task 8.

---

### Task 8: 🔒C Deploy (spec §4 *Deployment*; `CLAUDE.md` *Redeploy Sequence*)

**Files:** `$REC/deploy.md` (docs branch)

Run every step in order. Between the migrations (Step 5) and the restart (Step 6) the old
processes run against the new schema, so do those two steps back to back.

- [ ] **Step 1: Pre-flight (read-only)**

```bash
G=/home/claude/workspace/prism-graphql; A=/home/claude/workspace/prism-admin-dashboard
export PGPASSWORD=$(pm2 env 0 | sed 's/\x1b\[[0-9;]*m//g' | awk -F': ' '/^POSTGRES_PASSWORD/{print $2}')
git -C $G fetch -q origin; git -C $A fetch -q origin
git -C $G merge-base --is-ancestor origin/feat/evaluation-pipeline origin/main && echo graphql-merged
git -C $A merge-base --is-ancestor origin/feat/evaluation-pipeline origin/master && echo admin-merged
psql -h localhost -U prism -d prism_db -Atc "SELECT max(migration_id) FROM migration_history"
psql -h localhost -U prism -d prism_db -Atc "SELECT (SELECT count(*) FROM pathway_resolution_sessions), (SELECT count(*) FROM multi_pathway_resolution_sessions)"
pm2 list
```
Expected:
- `graphql-merged`, `admin-merged`;
- `066_backfill_remaining_branch_mode`;
- session counts, which are **recorded**, not required to be 0. The two before-capture sessions
  from Task 1 are expected. Anything beyond them is someone's session; 067 deletes it. **If there
  are more than 2, stop and ask.**
- all three pm2 processes `online`.

- [ ] **Step 2: Clear the lockfile drift, then fast-forward the live checkouts**

Look before discarding:

```bash
git -C $G status --porcelain; git -C $A status --porcelain
git -C $G diff --stat; git -C $A diff --stat
```
Expected: only ` M package-lock.json` in each. **If anything else is modified, stop and ask.**
Then:

```bash
git -C $G checkout -- package-lock.json && git -C $G pull --ff-only
git -C $A checkout -- package-lock.json && git -C $A pull --ff-only
git -C $G log --oneline -1; git -C $A log --oneline -1
```
Expected: both heads equal their `origin/main` / `origin/master`.

- [ ] **Step 3: Install and build**

Neither step touches the running processes.

```bash
npm install --prefix $G
npm install --prefix $A
npm run build --prefix $G/apps/pathway-service
npm run build --prefix $A
```
Expected: both builds succeed. **If either fails, stop.** Nothing live has changed yet, and the
old processes still serve the old build: `dist/` was overwritten, but pm2 holds the old code in
memory until restart.

- [ ] **Step 4: Backup (P5-6)**

```bash
mkdir -p /home/claude/backups
pg_dump -h localhost -U prism -Fc prism_db > /home/claude/backups/prism_db-pre-evaluation-pipeline-$(date +%Y%m%d-%H%M).dump
ls -la /home/claude/backups/ | tail -2
pg_restore --list /home/claude/backups/prism_db-pre-evaluation-pipeline-*.dump | grep -c "TABLE DATA"
```
Expected: a non-empty dump, whose table-data count is greater than 0.

- [ ] **Step 5: Apply 067 and 068**

```bash
MIG=$G/shared/data-layer/migrations
for f in 067_evaluation_inputs.sql 068_run_inputs.sql; do
  id="${f%.sql}"
  checksum=$(node -e "console.log(require('crypto').createHash('sha256').update(require('fs').readFileSync('${MIG}/${f}','utf-8').trim()).digest('hex'))")
  psql -h localhost -U prism -d prism_db -v ON_ERROR_STOP=1 -f "${MIG}/${f}" || break
  psql -h localhost -U prism -d prism_db -c \
    "INSERT INTO migration_history (migration_id, name, checksum) VALUES ('$id', '$id', '$checksum');" || break
done
psql -h localhost -U prism -d prism_db -Atc "SELECT migration_id, checksum FROM migration_history WHERE migration_id >= '067' ORDER BY 1"
```
Expected: both apply, and **both checksums equal the rehearsal's**.
- If 067 fails, it rolled itself back (`BEGIN … COMMIT`), so live is unchanged. **Stop and
  report.**
- If 068 fails after 067 succeeded, live is at 067 with the old code running. **Stop and ask**:
  roll forward, or restore the backup.

- [ ] **Step 6: Restart in order and verify**

```bash
pm2 restart pathway-service && sleep 2
pm2 restart gateway && sleep 2
pm2 restart admin-dashboard && sleep 3
pm2 list
pm2 logs pathway-service --nostream --lines 30
curl -sk -o /dev/null -w "%{http_code}\n" https://localhost/
curl -sk -X POST -H 'Content-Type: application/json' -d '{"query":"{__typename}"}' https://localhost/graphql
curl -s -X POST -H 'Content-Type: application/json' -d '{"query":"{ __type(name: \"ResolutionSession\") { fields { name } } }"}' http://localhost:4000/graphql | grep -o '"resultHash"'
sudo systemctl reload nginx
```
Expected:
- all three `online`, with fresh uptime;
- no startup error in the log;
- `200`;
- `{"data":{"__typename":"Query"}}`;
- `"resultHash"`: the gateway composed the new subgraph.

**Rollback, only if the user instructs it:**
1. `pg_restore --clean --if-exists -h localhost -U prism -d prism_db <the dump>`.
2. In both live checkouts, `git -C … checkout <2454130 | 3a32df8>`, which is detached.
3. Rebuild both, restart all three.
4. Report.

- [ ] **Step 7: Record**

Write `$REC/deploy.md` with:
- the time;
- the before and after heads of both checkouts;
- the backup path;
- the checksums;
- the verification output.

Commit it on the docs branch.

---

### Task 9: 🔒D After-record and the §5.8 comparison

**Files:** `$REC/after.txt`, `$REC/before-after.md` (docs branch)

- [ ] **Step 1: Capture *after* from the deployed pipeline**

```bash
node $G/apps/pathway-service/dist/scripts/capture-resolution.js after > $REC/after.txt
diff -u $REC/before.txt $REC/after.txt > $REC/before-after.diff; echo "diff exit $?"
sed -n '/^== /p;/^-- after only/,/^$/p' $REC/after.txt
```
Expected: `diff exit 1` (they differ). The after-only sections show each patient's eligibility
lines and either a probe with blockers or `probe skipped`.

- [ ] **Step 2: Attribute every difference**

Write `$REC/before-after.md` with one row per changed line in `before-after.diff`:

| Line | Class |
|---|---|

The only expected classes (spec §5.8) are:
- **confidence propagation**: `conf=` moved.
  - A `status` change is propagation only if the node is an action node or a DecisionPoint branch
    target, and its confidence crossed a threshold in the direction of the status change. Stage
    and Step nodes are always INCLUDED (`traversal-engine.ts:1604-1628`), so a Stage/Step status
    change is **not** expected.
- **new readiness blockers**: after-only `blocker` lines.
- **same-pathway DDI findings**: `ddi` lines.

Also:
- **Pipeline-only facts** (the `eligibility` and `probe` lines) are additions by construction. List
  them.
- The header's pending-question note from Task 1 carries over.

**Any line that fits none of these is a defect.** Stop and report it with the two records. Do not
change code in this plan.

Commit `after.txt`, `before-after.diff` and `before-after.md` on the docs branch.

---

### Task 10: 🔒D Admin smoke test (spec §5.10)

**Files:** `$REC/smoke-test.md` (docs branch)

This test is manual, in `https://goprism.net`, in the encounter simulator and the pathway preview.
The user runs it, unless the execution prompt gives the executor a browser tool (for example
`claude-in-chrome`) and approves its use. Record each check as pass or fail, with what was seen.

| # | Check | Setup | Pass when |
|---|---|---|---|
| 1 | **Answering refreshes without re-merge** | Encounter simulator: a patient that matches two pathways (anemia-in-pregnancy-v1 plus one DRAFT via preview), with a pending question | After answering, the merged plan updates on its own; there is no re-merge button, and the network tab shows no `reMergeMultiPathwaySession` |
| 2 | **`PLAN_CHANGED_SINCE_REVIEW`** | Two tabs on the same run; answer in tab B; click generate in tab A | Tab A shows the plan changed since review and refreshes; generating again from the refreshed view either succeeds or shows real blockers |
| 3 | **Changing a conflict choice** | A run with a medication conflict (two pathways proposing the same clinical role) | Choose A, then B: only B's drug remains, and A's node shows withheld (conflict) |
| 4 | **A fact on one pathway resolves another's gate** | Two pathways gating on the same datum | Supplying the fact in pathway 1's panel resolves pathway 2's gate |
| 5 | **Suppression shows both reasons** | A patient allergy against a proposed drug (e.g. penicillin allergy, a pathway proposing amoxicillin) | The suppressions panel names the proposing pathway and the safety reason; the node shows eligible, but withheld (safety) |

If no live pathway pair produces a conflict (#3) or a shared datum (#4), say so in the record: the
check was not reachable on live data. Those cases are covered by plan 04's MUT/SEQ tests.
**Do not author a pathway to create one.**

Commit `smoke-test.md` on the docs branch.

---

### Task 11: Close out

- [ ] **Step 1: Docs**

1. In the overview, set row 05's *Written* cell to `Yes (2026-09-22-…-05-release.md)`, and add
   under *Branches*: `Released YYYY-MM-DD: main @ <sha>, master @ <sha>.`
2. Fill in this plan's *Baseline* and *Gate re-run*.
3. Commit and push the docs branch.

- [ ] **Step 2: Report and stop**

Report:
- the deploy record;
- the gate re-run;
- the before/after attribution;
- the smoke test;
- the unmapped medications still open.

Suggest `/cleanup-feature` for the merged plan branches 01–05 and `fix/preview-refresh-race`, but
**do not run it without the user's say-so**.

---

## Gate re-run (YYYY-MM-DD, after the backfill)

| Measurement | Workload | Pre-backfill p95 (Task 2) | Post-backfill p95 | Budget | Pass |
|---|---|---|---|---|---|
| Single pathway, ROOT (chronic-htn-pregnancy-v1) | … nodes, … candidates, …/… normalised, … pairs loaded | … | … | < 2000 ms | … |
| &nbsp;&nbsp;env snapshot | | … | … | — | — |
| &nbsp;&nbsp;evaluate | | … | … | — | — |
| 5-child run (one snapshot, 5 contributions, composeRun) | … nodes, … candidates, …/… normalised | … | … | < 5000 ms | … |
| &nbsp;&nbsp;composeRun | | … | … | — | — |

**Decision:** merge to `main` / STOP, and revisit D1/D13.

---

## Out of scope (by design)

- **The admin lint configuration** (ESLint 9 needs `eslint.config.*`; lint is broken at baseline,
  P5-10).
- **Normalising ARCHIVED pathways' medications** (P5-4). They are not evaluated in production.
- **Resolving unmapped medications** (P5-8). That is the user's clinical triage.
- **Follow-ups F1 (remainder), F3, F4, F5**, and the spec's *Out of scope* list.
- **Binding gateway / admin to `127.0.0.1`** (`CLAUDE.md`, *Known Operational Gaps*).
- **Fixing the migrator CLI** (`CLAUDE.md`). This plan uses the documented manual workflow.
