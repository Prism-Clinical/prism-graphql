# Evaluation Pipeline 05 — Release Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put the evaluation pipeline into production. First prove it against live data and
rehearse the migration on a copy. Then run the normalisation backfill and re-run the performance
gate with real DDI coverage. Finally merge the integration branches, deploy, and record the
before/after behaviour and the admin smoke test.

**Architecture:** Two phases, split by what they touch.
- **Phase A** is code on a plan branch and writes nothing live except two capture sessions. It
  covers the release tooling, a per-mutation performance gate and a stage benchmark on the real
  pipeline, test residue, wider property coverage and a full rehearsal on a copy of `prism_db`.
- **Phase B** is operations on the live host, each step gated by approval. It covers the backfill,
  the gate re-run, the merges to `main`/`master`, the deploy in a maintenance window, the after-record and the smoke test.

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
  - 🔒B — the normalisation backfill on live (Task 7);
  - 🔒C — the deploy: maintenance window (services stopped), backup, builds, migrations, start (Task 9);
  - 🔒D — capture sessions and the smoke-test sessions after the deploy (Tasks 10 and 11).
- **Merges into `main` / `master` are the user's.** Opening the PRs is approved only if the
  execution prompt says so, and `gh` has been unauthenticated all along, so expect to hand over
  compare URLs. **Stop at each merge point** (end of Task 6 and end of Task 8). Resume only when
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
  the lockfile. Task 9 inspects it, then discards it.
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
| P5-2 | **Two measurements, with different jobs.** (1) **The mutation gate** decides the release (spec §5.7 budgets *per mutation*). It runs the real resolvers end to end: load, evaluate, commit, reload. It covers a single-pathway mutation, an answer on a 5-child run and a fact on a 5-child run, each with its own p95. It runs on a migrated, backfilled **scratch copy** of live, with no LLM client and the pre-warm stubbed; setup is outside the timed interval (Task 5). (2) **The stage benchmark** is a read-only diagnostic on live: the snapshot, `evaluate` and `composeRun`, timed separately. It uses replay observations and INCLUDE overrides on every Medication node, and every conflict is ACCEPT_BOTH, so every medication reaches the root pair check. Its floors cover the set entering root pair safety, not only child eligibility (Task 2). | A mutation also loads the stored run, commits parent and children in a transaction, records events and reloads. None of that is in the evaluator, and it could push a mutation over budget while the stages pass. Mutations write, so they are timed only on a copy. Undecided conflicts drop their medications before `pairSafety`: a run can satisfy every child floor and still pass **zero** candidates to the root pair check (review, 2026-09-22). |
| P5-3 | **The backfill runs from the plan branch's build, before the merge to `main`.** | Spec §5.7: re-run the gate *after the backfill, before merging to `main`*. The backfill only touches `medication_normalization_cache`, which exists on live today, and 067/068 do not change it. Side effect: until the deploy, live `main`'s old DDI pass also sees the normalised drugs. There are no users. |
| P5-4 | **The backfill covers ACTIVE and DRAFT only,** as the script and the spec say. The gate reports coverage per pathway. | The run figure is partly covered: its three ARCHIVED children stay unnormalised. The single-pathway figure (chronic-htn, DRAFT) has full coverage of whatever RxNav can map. |
| P5-5 | **Rehearse on a full copy.** Before any live write, `prism_db` is copied to `prism_release_scratch`. The exact live sequence runs there: backfill → 067 → 068 → history rows → pipeline smoke on the migrated schema. | Plan 03/04's Postgres tests start from a schema-only dump, so they never met live data or the live AGE graphs. At 26 MB the full copy costs seconds. |
| P5-6 | **Deploy in a maintenance window.** Both builds are first validated in a separate worktree at the exact merged commits. Then all three pm2 processes are **stopped**, and only then come the backup, the copies of the current build artifacts, the pull, the builds, the migrations and the start. Any failure keeps the services stopped. Rollback runs **only on the user's instruction**, with the services stopped: restore the database, the previous commits and the saved artifacts. | `next build` (Next 16.1.6, `cleanDistDir: true`) deletes `.next` before writing, and the running admin server reads from it, so building in the live directory can break a running process even when the build fails. Old backends must never serve the migrated schema, and a restore must not race live writers. There are no users, so a short outage costs nothing. |
| P5-7 | **The generation probe in the after-record runs only when the session has a pending question.** | A session with a pending question cannot generate, so the probe returns its blockers and writes no care plan. On a ready session the probe would create a care plan on live, so it is skipped and the record says so. |
| P5-8 | **Unmapped medications (NULL cache rows) are the user's to triage,** through the admin queue (`unnormalizedMedications` / `manuallyResolveMedicationNormalization`). The executor lists them and never picks a mapping. | A drug mapping is a clinical decision. |
| P5-9 | **Property (a) gets a companion property whose sequences open with `answer qa = true` then a conflict decision.** A runtime check asserts that every generated sequence applied one. | Conflict decisions are the run feature most likely to be path-dependent (review #6). At about 8 in 100 they were barely exercised. |
| P5-10 | **The admin dashboard gets no code change in this plan.** Its lint has been broken since before plan 04 (ESLint 9, no `eslint.config.*`), so admin verification is `tsc` + `next build`. | A lint config is its own change. It is listed under *Out of scope*. |

## Baseline

| Point | Passed | Failed | Skipped |
|---|---|---|---|
| Task 0 (base) | … | 9 | … |
| Task 6 (end of phase A) | … | 9 | … |

Expected at Task 0: **1670 / 9 / 12**, as plan 04 ended.

Expected at Task 6: **1673 / 9 / 14**.
- `baseline-capture` is deleted (−1 skipped).
- `capture-resolution` adds 2 passing.
- The companion property adds 1 passing.
- The mutation gate adds 3 tests, skipped by default (+3 skipped).
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

interface Coded { code: string; system: string; display?: string }
/**
 * The PatientContextInput fields this capture sends. Declared, not inferred:
 * with noImplicitAny an inferred empty list is an implicit any[] (TS7018),
 * and ts-jest's diagnostics are off, so only tsc would notice.
 */
interface CapturePatient {
  patientId: string;
  conditionCodes: Coded[];
  medications: Coded[];
  allergies: Coded[];
  labResults: Array<{ code: string; system: string; value: number; effectiveDateTime: string }>;
  vitalSigns: Record<string, number>;
  patientAttributes: Record<string, unknown>;
}

const WITH_HB: CapturePatient = {
  patientId: '00000000-0000-4000-a000-0000000000ff',
  conditionCodes: [{ code: 'D50.9', system: 'ICD-10' }],
  medications: [],
  allergies: [],
  labResults: [{ code: '718-7', system: 'LOINC', value: 9.4, effectiveDateTime: '2026-08-20' }],
  vitalSigns: {},
  patientAttributes: {},
};
/** The two patients `baseline-capture.test.ts` recorded on 2026-09-10. */
export const PATIENTS: Record<'withHaemoglobin' | 'noHaemoglobin', CapturePatient> = {
  withHaemoglobin: WITH_HB,
  noHaemoglobin: { ...WITH_HB, labResults: [] },
};

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
Expected: 2 passed, `tsc-clean`, and the built file exists. `tsc` is the only check that the
script compiles: ts-jest runs with `diagnostics: false`, so the formatter tests pass even when it
does not.

**Falsify, one at a time, restoring each:**
1. Remove the `.sort()` that closes `shared`. The first test must fail on the order of `a` and
   `b`.
2. Remove `: CapturePatient` from `const WITH_HB`. `tsc` must report `TS7018` for `medications`
   and `allergies`, while the two formatter tests still pass.

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
backfill (Task 7), so *before* is what production ran:

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

### Task 2: The stage benchmark on the real pipeline — diagnostic (P5-2)

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
- Produces: env flags `RUN_EVALUATION_BENCHMARK=1` (run it), `EXPECT_DDI_COVERAGE=1` (after the
  backfill: fail unless the single pathway and the root pair set have normalised candidates) and
  `MIN_ROOT_NORMALISED=<n>` (the root floor under coverage; default 2, i.e. at least one pair).

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
 * EVALUATION STAGE BENCHMARK — a diagnostic for spec §5.7 (plan 05, P5-2).
 * The release decision is the MUTATION gate (evaluation-mutation-gate.test.ts),
 * which adds load, commit and reload; this file times the stages inside it.
 *
 * Measures one environment snapshot (loadEvaluationEnv / loadRunEnv, C4),
 * `evaluate` per pathway, and for a run `composeRun` (D13). Observations are
 * replayed (no LLM call); every Medication node carries a provider INCLUDE
 * override, and every run conflict is ACCEPT_BOTH, so every medication reaches
 * the root pair check: the pipeline's worst case, through real inputs.
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
import type { SafetyReference } from '../services/medications/safety-reference';
import { composeRun } from '../services/resolution/pipeline/compose';
import { evaluate } from '../services/resolution/pipeline/evaluate';
import { loadEvaluationEnv, loadRunEnv, medicationName } from '../services/resolution/pipeline/load-env';
import type { EvaluationEnv } from '../services/resolution/pipeline/load-env';
import { replayObservations } from '../services/resolution/pipeline/observations';
import type { EvaluationResult, RunResult, SessionInputs } from '../services/resolution/pipeline/types';
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
// The set that reaches root pair safety. 2 is the hard minimum (one pair);
// Task 2 Step 4 freezes the measured live value here.
const MIN_ROOT_CANDIDATES = 2;
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

/**
 * The set that reached root pair safety: the final medications plus those the
 * pair check itself withheld. Undecided conflicts never get here, which is why
 * the run is composed with every conflict ACCEPT_BOTH.
 */
function rootWorkloadOf(r: RunResult, safety: SafetyReference) {
  const pairWithheld = r.mergedPlan.suppressed.filter((s) => s.source.kind === 'OTHER_RECOMMENDATION').map((s) => s.name);
  const names = [...new Set([...r.mergedPlan.medications.map((m) => m.recommendation.name), ...pairWithheld])];
  const normalised = names.filter((n) => Boolean(safety.normalized.get(normalizedKey({ text: n })))).length;
  return { candidates: names.length, normalised, comparisons: (normalised * (normalised - 1)) / 2 };
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
  const ctxOf = (conflictResolutions: Record<string, unknown>) => ({
    patient: PATIENT, conflictResolutions: conflictResolutions as never, safety: env.safety, meta: env.meta, envFingerprint: env.envFingerprint,
  });
  // Untimed: discover the conflicts, then decide every one ACCEPT_BOTH.
  const conflicts = composeRun(contributions, ctxOf({})).mergedPlan.conflicts;
  const decisions = Object.fromEntries(conflicts.map((c) =>
    [c.conflictId, { kind: 'ACCEPT_BOTH', resolvedBy: 'benchmark', resolvedAt: '2026-09-14T12:00:00.000Z' }]));
  const t3 = performance.now();
  const composed = composeRun(contributions, ctxOf(decisions));
  const t4 = performance.now();
  return {
    env: t1 - t0, evaluate: t2 - t1, compose: t4 - t3, total: (t2 - t0) + (t4 - t3),
    workloads, conflicts: conflicts.length, root: rootWorkloadOf(composed, env.safety),
  };
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
        // The pair check must have had its intended set (review, 2026-09-22).
        expect(r.root.candidates).toBeGreaterThanOrEqual(MIN_ROOT_CANDIDATES);
      }
      if (process.env.EXPECT_DDI_COVERAGE === '1') {
        expect(singles[0].workload.normalised).toBeGreaterThan(0);
        for (const r of runs) expect(r.root.normalised).toBeGreaterThanOrEqual(Number(process.env.MIN_ROOT_NORMALISED ?? 2));
      }

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
        `  root pair set: ${r0.conflicts} conflicts, all ACCEPT_BOTH; ${r0.root.candidates} candidates, ` +
          `${r0.root.normalised} normalised, ${r0.root.comparisons} pair comparisons`,
        row('  env snapshot', runs.map((r) => r.env)),
        row('  evaluate (5 children)', runs.map((r) => r.evaluate)),
        row('  composeRun (decided)', runs.map((r) => r.compose)),
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
it is the *pre-backfill* row of Task 8's table.

- **If a workload floor fails,** stop and report the count. That would mean INCLUDE overrides on
  unreachable Medication nodes do not make them candidates, which is a finding about the pipeline.
  **Never lower a floor.**
- **If a budget fails,** stop: spec §5.7 says revisit D1/D13 before anything else.

**Freeze the root floor.** Set `MIN_ROOT_CANDIDATES` to the printed `root pair set … candidates`
count, if that is above 2. It is the live graphs' workload, like the other floors. Re-run and
expect PASS.

**Falsify, one at a time, restoring each:**
1. Raise `MIN_CANDIDATES.single` to `candidates + 1`, using the printed count. The run must fail
   with `Expected: >= …`.
2. Replace `ctxOf(decisions)` with `ctxOf({})`.
   - If the printed conflict count is above 0, the run must fail on `r.root.candidates`.
   - If it is 0, the live graphs have no cross-pathway conflict, and decisions cannot change the
     workload. Record that instead.

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

### Task 5: The mutation gate — the release decision (spec §5.7, P5-2)

**Files:**
- Create: `apps/pathway-service/src/__tests__/evaluation-mutation-gate.test.ts`

**Interfaces:**
- Consumes (plans 03–04):
  - `resolutionMutations.startResolution | overrideNode | answerPendingDecision | addPatientContext`
  - `evaluateRun(pool, request, inputs, { pinGraphs })`, `newRunRequest()`, `sessionInputsOf(run, child)`
  - `insertRun(db, NewRun)`, `setContributingSessions(db, runId, sessionIds, pathwayIds)`,
    `insertSession(db, NewSession)`
  - `inTransaction(pool, fn)`
- Produces: env flags `RUN_MUTATION_GATE=1` and `PIPELINE_PG_DATABASE=<*scratch*>`. Tasks 6 and 8
  run it on a migrated, backfilled copy of live.

**What it times.** Each timed interval is one resolver call, from the call to its return.
- **Single:** `overrideNode` on a session started with `startResolution`. The call loads the
  session, evaluates, commits under the revision CAS and reloads.
- **Run answer:** `answerPendingDecision` on a child of a stored 5-child run. That call loads the
  run, re-evaluates all five children, and commits the parent and children with the events.
- **Run fact:** `addPatientContext` on a child of a stored 5-child run.

Setup is untimed: starting the session, and storing the run exactly as
`startMultiPathwayResolution` stores one (the plan 04 Postgres test's `newRun`, with the real
environment). A run is built this way, not through the start mutation, because matching would
need all five pathways to match the patient's conditions and survive lattice collapse, and three
of them are ARCHIVED.

**Controls:**
- **No LLM:** `LLM_GATE_API_KEY` is deleted, so there is no client and LLM gates pend (C1).
- **No normalisation traffic:** `prewarmMedications` is stubbed, so RxNav is never called and the
  cache is never written.
- The answer alternates between values, and each fact is new, so every timed call is a real
  change.

- [ ] **Step 1: Write the gate**

Create `apps/pathway-service/src/__tests__/evaluation-mutation-gate.test.ts`:

```ts
/**
 * MUTATION GATE — spec §5.7 budgets, per mutation (plan 05, P5-2). The release decision.
 *
 * Times the real resolvers end to end — load, evaluate, commit, reload — for a
 * single-pathway mutation, an answer on a 5-child run and a fact on a 5-child
 * run, each with its own p95. Setup (starting the session, storing the run)
 * is outside the timed interval.
 *
 * WRITES: only to a database whose name contains "scratch" — a migrated,
 * backfilled copy of live (plan 05 Tasks 6 and 8). No LLM client (C1: LLM
 * gates pend); the pre-warm is stubbed (no RxNav, no cache writes).
 *
 *   RUN_MUTATION_GATE=1 PIPELINE_PG_DATABASE=prism_release_scratch POSTGRES_PASSWORD=$PGPASSWORD \
 *     npm test --prefix apps/pathway-service -- --runInBand src/__tests__/evaluation-mutation-gate.test.ts
 */
jest.mock('../services/medications/normalizer', () => ({
  ...jest.requireActual('../services/medications/normalizer'),
  prewarmMedications: jest.fn(async () => ({ succeeded: 0, failed: 0 })),
}));

import { randomUUID } from 'crypto';
import { Pool } from 'pg';
import { performance } from 'perf_hooks';
import { resolutionMutations } from '../resolvers/mutations/resolution';
import type { PatientContext } from '../services/confidence/types';
import { insertRun, setContributingSessions } from '../services/resolution/multi-pathway-session-store';
import { inTransaction } from '../services/resolution/pipeline/request';
import { evaluateRun, newRunRequest, sessionInputsOf } from '../services/resolution/pipeline/run';
import { insertSession } from '../services/resolution/session-store';
import { makeEvaluationTemporalContext } from '../services/resolution/temporal/evaluation-context';
import { AnswerType, OverrideAction, SessionStatus } from '../services/resolution/types';
import type { PendingQuestion } from '../services/resolution/types';

const SINGLE = '8d7fbfc6-06cf-4caa-a4e7-2efe07e9ea6c'; // chronic-htn-pregnancy-v1@1.0
const RUN = [
  SINGLE,
  '9ee949c9-625a-48ac-873b-c121e8fd24e2', // gestational-hypertension-preeclampsia@1
  '40c06c6b-4699-47e3-bba5-c72ca72e9e7d', // routine-prenatal-care-v1@1.0
  'ae6b0d51-3e89-4c0e-a062-d0a8eec01b69', // vaginal-discharge-pregnancy-v1@1.0
  'a9600763-ba44-4481-9d0b-b66d63dd04dc', // anemia-pregnancy-v1@1.0
];
const BUDGET_P95_MS = { single: 2000, run: 5000 }; // spec §5.7
const WARMUP = 3;
const SAMPLES = 20;
const AS_OF = '2026-09-14T12:00:00.000Z';
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

const pct = (values: number[], q: number): number => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(q * sorted.length) - 1)];
};
const line = (label: string, v: number[]) => `${label.padEnd(36)} p50 ${pct(v, 0.5).toFixed(0)}ms   p95 ${pct(v, 0.95).toFixed(0)}ms`;

/** A value for the question that differs between consecutive calls. */
const answerFor = (q: PendingQuestion, i: number) => {
  if (q.answerType === AnswerType.BOOLEAN) return { booleanValue: i % 2 === 0 };
  if (q.answerType === AnswerType.NUMERIC) return { numericValue: i };
  if (!q.options?.length) throw new Error(`question ${q.gateId} has no options to answer with`);
  return { selectedOption: q.options[i % q.options.length] };
};

const database = process.env.PIPELINE_PG_DATABASE ?? '';
const describeGate = process.env.RUN_MUTATION_GATE === '1' ? describe : describe.skip;

describeGate('mutation gate on a scratch copy of live (spec §5.7)', () => {
  let pool: Pool;
  const ctx = () => ({
    pool, redis: null, userId: '00000000-0000-4000-a000-000000000002', userRole: 'PROVIDER', temporalPolicyVersion: 'v1',
  }) as never;

  beforeAll(() => {
    if (!database.includes('scratch') || database === 'prism_db') {
      throw new Error(`refusing database "${database}": set PIPELINE_PG_DATABASE to a scratch database`);
    }
    delete process.env.LLM_GATE_API_KEY; // no client: LLM gates pend (C1)
    pool = new Pool({
      host: process.env.POSTGRES_HOST ?? 'localhost',
      user: process.env.POSTGRES_USER ?? 'prism',
      password: process.env.POSTGRES_PASSWORD,
      database,
    });
    pool.on('connect', (client) => {
      client.query("LOAD 'age'; SET search_path = ag_catalog, \"$user\", public;").catch(() => { /* surfaced by the query that needs it */ });
    });
  });
  afterAll(() => pool.end());

  /** Warm up, then time each call alone. */
  async function timed(mutate: (i: number) => Promise<unknown>): Promise<number[]> {
    for (let i = 0; i < WARMUP; i++) await mutate(i);
    const out: number[] = [];
    for (let i = WARMUP; i < WARMUP + SAMPLES; i++) {
      const t = performance.now();
      await mutate(i);
      out.push(performance.now() - t);
    }
    return out;
  }

  /** A 5-child run stored exactly as startMultiPathwayResolution stores one. Untimed. */
  async function newRun() {
    const temporalContext = makeEvaluationTemporalContext({ evaluationAsOf: AS_OF, temporalPolicyVersion: 'v1' });
    const ev = await evaluateRun(pool, newRunRequest(), {
      initialPatientContext: PATIENT, additionalContext: {}, temporalContext, conflictResolutions: {},
      children: RUN.map((pathwayId) => ({
        sessionId: '', pathwayId,
        inputs: { pathwayId, graphFingerprint: '', gateAnswers: new Map(), providerOverrides: new Map(), observations: new Map(), revision: 0 },
      })),
    }, { pinGraphs: true });
    if (ev.inputs.children.length !== RUN.length) throw new Error(`run has ${ev.inputs.children.length} children, expected ${RUN.length}`);
    const providerId = randomUUID();
    return inTransaction(pool, async (db) => {
      const runId = await insertRun(db, {
        patientId: PATIENT.patientId, providerId, isPreview: true, initialPatientContext: PATIENT,
        temporalContext, additionalContext: {}, conflictResolutions: {}, result: ev.result,
      });
      const childIds: string[] = [];
      for (const [i, child] of ev.inputs.children.entries()) {
        childIds.push(await insertSession(db, {
          pathwayVersion: ev.env.meta.get(child.pathwayId)?.version ?? '', patientId: PATIENT.patientId, providerId,
          inputs: { ...sessionInputsOf(ev.inputs, child.inputs), additionalContext: {} },
          result: ev.result.children[i].result, status: SessionStatus.ACTIVE, durationMs: 1, parentSessionId: runId,
        }));
      }
      await setContributingSessions(db, runId, childIds, ev.inputs.children.map((c) => c.pathwayId));
      return { childIds, pending: ev.result.children.map((c) => c.result.pendingQuestions) };
    });
  }

  it('a single-pathway mutation: p95 < 2 s', async () => {
    type Listed = { nodeId: string; nodeType: string };
    const started = (await resolutionMutations.startResolution(null, {
      pathwayId: SINGLE, patientId: PATIENT.patientId, patientContext: PATIENT, evaluationAsOf: AS_OF,
    } as never, ctx())) as unknown as { id: string; includedNodes: Listed[]; excludedNodes: Listed[] };
    const med = [...started.includedNodes, ...started.excludedNodes].find((n) => n.nodeType === 'Medication');
    if (!med) throw new Error('no listed Medication node to override in the single pathway');

    const times = await timed((i) => resolutionMutations.overrideNode(null, {
      sessionId: started.id, nodeId: med.nodeId, action: i % 2 === 0 ? OverrideAction.INCLUDE : OverrideAction.EXCLUDE,
    }, ctx()));
    // eslint-disable-next-line no-console
    console.log(line(`single: overrideNode (${SAMPLES} samples)`, times));
    expect(pct(times, 0.95)).toBeLessThan(BUDGET_P95_MS.single);
  }, 900_000);

  it('an answer on a 5-child run: p95 < 5 s', async () => {
    const run = await newRun();
    const at = run.pending.findIndex((qs) => qs.length > 0);
    if (at < 0) throw new Error('no child of the run has a pending question: an answer cannot be timed');
    const q = run.pending[at][0];

    const times = await timed((i) => resolutionMutations.answerPendingDecision(null, {
      sessionId: run.childIds[at], nodeId: q.gateId, answer: answerFor(q, i) as never,
    }, ctx()));
    // eslint-disable-next-line no-console
    console.log(line(`run: answer ${q.gateId} (${q.answerType}, child ${at})`, times));
    expect(pct(times, 0.95)).toBeLessThan(BUDGET_P95_MS.run);
  }, 900_000);

  it('a fact on a 5-child run: p95 < 5 s', async () => {
    const run = await newRun();
    const times = await timed((i) => resolutionMutations.addPatientContext(null, {
      sessionId: run.childIds[0], additionalContext: { vitalSigns: { heart_rate: 60 + i } },
    }, ctx()));
    // eslint-disable-next-line no-console
    console.log(line('run: fact (vitalSigns.heart_rate)', times));
    expect(pct(times, 0.95)).toBeLessThan(BUDGET_P95_MS.run);
  }, 900_000);
});
```

- [ ] **Step 2: Skipped by default; typecheck; imports resolve**

```bash
npm test --prefix $W/apps/pathway-service -- --runInBand src/__tests__/evaluation-mutation-gate.test.ts 2>&1 | grep -E "^Tests:"
$W/node_modules/.bin/tsc -p $W/apps/pathway-service/tsconfig.json --noEmit && echo tsc-clean
for sym in insertRun setContributingSessions inTransaction evaluateRun newRunRequest sessionInputsOf insertSession makeEvaluationTemporalContext prewarmMedications; do
  grep -rqE "export (async )?(function|const) $sym\b" $W/apps/pathway-service/src/services || echo "MISSING $sym"
done; echo imports-checked
```
Expected: `Tests: 3 skipped, 3 total`; `tsc-clean`; only `imports-checked`. The gate first runs
for real in Task 6, on the rehearsal copy.

- [ ] **Step 3: Commit**

```bash
git -C $W add apps/pathway-service/src/__tests__/evaluation-mutation-gate.test.ts
git -C $W commit -q -m "test(pathway-service): per-mutation performance gate on a scratch copy

Spec §5.7 budgets are per mutation. The gate times the real resolvers end
to end — load, evaluate, commit, reload — for a single-pathway override,
an answer and a fact on a 5-child run, each with its own p95. Scratch
databases only; no LLM client; the pre-warm is stubbed.

Claude-Session: https://claude.ai/code/session_01XRNkZvQrxmRLNtJHxq71kH"
```

---

### Task 6: Pre-merge gate — suite, Postgres tests, full-copy rehearsal (P5-5), PR

**Files:** none in the repo. Rehearsal notes go to `$REC/rehearsal.md` (docs branch).

- [ ] **Step 1: Full suite, typecheck, build**

```bash
npm test --prefix $W/apps/pathway-service -- --runInBand 2>&1 | grep -E "^(FAIL|Tests:)" | sort | uniq -c
$W/node_modules/.bin/tsc -p $W/apps/pathway-service/tsconfig.json --noEmit && echo tsc-clean
npm run build --prefix $W/apps/pathway-service && echo built
```
Expected: only the two scorer `FAIL` lines; `Tests: 14 skipped, 9 failed, 1673 passed`;
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

This is the exact order Tasks 7 and 9 use on live: backfill first, at 066, then 067 and 068 with
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
Expected: both files apply without error, and two history rows. **Record both checksums.** Task 9
must reproduce them exactly on live, which proves the files did not change between rehearsal and
deploy.

Run the stage benchmark on the migrated copy, read-only. It exercises `loadEvaluationEnv`,
`loadRunEnv`, `evaluate` and `composeRun` on real graphs:

```bash
RUN_EVALUATION_BENCHMARK=1 EXPECT_DDI_COVERAGE=1 POSTGRES_DB=prism_release_scratch POSTGRES_PASSWORD=$PGPASSWORD \
  npm test --prefix $W/apps/pathway-service -- --runInBand src/__tests__/evaluation-benchmark.test.ts 2>&1 | tail -30
```
Expected: PASS, with `normalised` > 0 on the single pathway and at least 2 on the root pair set.
**Record the root pair set's `normalised` count.** Task 8 passes it as `MIN_ROOT_NORMALISED`, so
live coverage below the rehearsal's fails the gate instead of shrinking it silently.

Run the **mutation gate** (Task 5) on the migrated, backfilled copy. This is the first real
measurement of the release decision:

```bash
RUN_MUTATION_GATE=1 PIPELINE_PG_DATABASE=prism_release_scratch POSTGRES_PASSWORD=$PGPASSWORD \
  npm test --prefix $W/apps/pathway-service -- --runInBand src/__tests__/evaluation-mutation-gate.test.ts 2>&1 | grep -E "p95|Tests:|Error"
```
Expected: `Tests: 3 passed`, with one p95 line per operation.
- **If a setup guard throws,** stop and report the message: no listed Medication node, no pending
  question in the run, or a child count other than 5. It is a property of the live graphs that the
  plan must answer; do not change the operation being timed.
- **If a budget fails,** stop (spec §5.7).

**Falsify:** make persistence slow. As the first statement of `writeEvaluation`
(`session-store.ts`) and of `writeRunEvaluation` (`multi-pathway-session-store.ts`), add:

```ts
  await new Promise((r) => setTimeout(r, 5_100));
```

Re-run the gate. All three tests must fail on their p95 (about 6 minutes). Remove both lines, and
confirm with `git -C $W diff --stat` that nothing else changed.

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
- the stage benchmark table from the migrated copy, and its root `normalised` count;
- the mutation gate's three p95 lines, and the falsification outcome.

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
- the rehearsal record, with the mutation gate's p95s;
- the pre-backfill stage benchmark table;
- the list of names RxNav could not map.

**Wait until the user says the PR is merged into `feat/evaluation-pipeline`.** Then continue with
Task 7.

---

# Phase B — live operations

Before starting, confirm that the phase-A PR is merged:

```bash
git -C $W fetch -q origin
git -C $W merge-base --is-ancestor origin/feat/evaluation-pipeline-05-release origin/feat/evaluation-pipeline && echo merged
```

### Task 7: 🔒B Normalisation backfill on live (P5-3, P5-4, P5-8)

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

### Task 8: Gate re-run with real coverage (spec §5.7), and the PRs to `main` / `master`

**Files:** plan 01's *Gate result* section, and this plan's *Gate re-run* section (docs branch).

- [ ] **Step 1: The mutation gate on a fresh, migrated copy of post-backfill live (the decision)**

Live now holds the backfilled cache, and is still at 066. Copy it and migrate the copy exactly as
in Task 6:

```bash
export PGPASSWORD=$(pm2 env 0 | sed 's/\x1b\[[0-9;]*m//g' | awk -F': ' '/^POSTGRES_PASSWORD/{print $2}')
dropdb -h localhost -U prism --if-exists prism_release_scratch
createdb -h localhost -U prism prism_release_scratch
pg_dump -h localhost -U prism -Fc prism_db > $SP/gate-copy.dump
pg_restore -h localhost -U prism -d prism_release_scratch --no-owner $SP/gate-copy.dump 2>&1 | tail -3
MIG=$W/shared/data-layer/migrations
for f in 067_evaluation_inputs.sql 068_run_inputs.sql; do
  psql -h localhost -U prism -d prism_release_scratch -v ON_ERROR_STOP=1 -f "${MIG}/${f}" || break
done
RUN_MUTATION_GATE=1 PIPELINE_PG_DATABASE=prism_release_scratch POSTGRES_PASSWORD=$PGPASSWORD \
  npm test --prefix $W/apps/pathway-service -- --runInBand src/__tests__/evaluation-mutation-gate.test.ts 2>&1 | grep -E "p95|Tests:|Error"
dropdb -h localhost -U prism prism_release_scratch; rm -f $SP/gate-copy.dump
```
Expected: `Tests: 6 passed` (current and fixture passes), each pass with the single p95 < 2000 ms, and the run answer and run fact p95s
each < 5000 ms. The copy needs no history rows, because it is dropped.

**If a budget fails, stop. Do not open the PRs to `main`** (spec §5.7: revisit D1/D13).

- [ ] **Step 2: The stage diagnostic on live, read-only**

`MIN_ROOT_NORMALISED` is the root pair set's `normalised` count recorded in the rehearsal
(Task 6):

```bash
RUN_EVALUATION_BENCHMARK=1 EXPECT_DDI_COVERAGE=1 MIN_ROOT_NORMALISED=<rehearsal count> POSTGRES_PASSWORD=$PGPASSWORD \
  npm test --prefix $W/apps/pathway-service -- --runInBand src/__tests__/evaluation-benchmark.test.ts 2>&1 | tail -32
```
Expected: PASS.
- `normalised` > 0 on the single pathway and on both DRAFT run children. The ARCHIVED children
  still show 0 (P5-4).
- The root pair set reaches the rehearsal's normalised count.
- A shortfall means live coverage differs from the rehearsal's, for example because RxNav answered
  differently. **Stop and report both counts.** Do not lower the floor.

- [ ] **Step 3: Record the result**

Fill in *Gate re-run* at the end of this plan: the mutation gate from Step 1, and the stage
diagnostic from Step 2 next to Task 2 Step 4's pre-backfill numbers. Under plan 01's *Gate result (2026-09-14, revised after review)*, add one line pointing to
it:

```markdown
**Re-run after the backfill (plan 05, YYYY-MM-DD):** see `2026-09-22-evaluation-pipeline-05-release.md`, *Gate re-run*.
```

Commit both on the docs branch and push.

- [ ] **Step 4: Hand over the two merges**

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

- [ ] **Step 5: STOP — merge point 2**

Report:
- the gate re-run tables: the mutation gate, and the stages;
- the backfill split;
- the unmapped names still open;
- the two compare URLs.

**Wait until the user says both are merged.** Then continue with Task 9.

---

### Task 9: 🔒C Deploy in a maintenance window (spec §4 *Deployment*; P5-6)

**Files:** `$REC/deploy.md` (docs branch)

**Shape.**
1. Prove both builds outside the active release, at the exact merged commits (Step 2).
2. Then **stop all three services**. Only after that change anything live: back up the database
   and the current build artifacts, pull, build, migrate, start (Steps 3–8).
3. On any failure from Step 3 on, **leave the services stopped** and ask. The public site returns
   502 while they are stopped. There are no users.

The reason: `next build` (Next 16.1.6, `cleanDistDir: true`) deletes `.next` before writing, and a
running `next start` reads from it. And no old backend may serve the migrated schema.

- [ ] **Step 1: Pre-flight (read-only)**

```bash
G=/home/claude/workspace/prism-graphql; A=/home/claude/workspace/prism-admin-dashboard
export PGPASSWORD=$(pm2 env 0 | sed 's/\x1b\[[0-9;]*m//g' | awk -F': ' '/^POSTGRES_PASSWORD/{print $2}')
git -C $G fetch -q origin; git -C $A fetch -q origin
git -C $G merge-base --is-ancestor origin/feat/evaluation-pipeline origin/main && echo graphql-merged
git -C $A merge-base --is-ancestor origin/feat/evaluation-pipeline origin/master && echo admin-merged
git -C $G log --oneline -1; git -C $A log --oneline -1
psql -h localhost -U prism -d prism_db -Atc "SELECT max(migration_id) FROM migration_history"
psql -h localhost -U prism -d prism_db -Atc "SELECT (SELECT count(*) FROM pathway_resolution_sessions), (SELECT count(*) FROM multi_pathway_resolution_sessions)"
git -C $G status --porcelain; git -C $A status --porcelain
pm2 list
```
Expected:
- `graphql-merged`, `admin-merged`.
- Live heads `2454130` and `3a32df8`. **Record them: they are the rollback targets.**
- `066_backfill_remaining_branch_mode`.
- Session counts: the two before-capture sessions from Task 1 are expected. **If there are more
  than 2, stop and ask**, because 067 deletes them.
- Porcelain: only ` M package-lock.json` in each checkout. **If anything else is modified, stop
  and ask.**
- All three pm2 processes `online`.

- [ ] **Step 2: Validate both builds outside the active release**

Run `/new-feature evaluation-pipeline-release-build` with **both** repos: prism-graphql from
**`origin/main`** and prism-admin-dashboard from **`origin/master`**. This is a build-only
worktree; nothing is committed in it. Then:

```bash
RB=/home/claude/workspace/features/feat-evaluation-pipeline-release-build
git -C $RB/prism-graphql log --oneline -1; git -C $G rev-parse --short origin/main
git -C $RB/prism-admin-dashboard log --oneline -1; git -C $A rev-parse --short origin/master
npm install --prefix $RB/prism-graphql
npm install --prefix $RB/prism-admin-dashboard
npm run build --prefix $RB/prism-graphql/apps/pathway-service && echo service-built
npm run build --prefix $RB/prism-admin-dashboard && echo admin-built
```
Expected: each worktree head equals its `origin/main` / `origin/master`, then `service-built` and
`admin-built`.

**If either build fails, stop.** Nothing live has been touched. The admin build here needs no
production environment beyond what `next build` reads at build time. If it fails only for a
missing env var that pm2 supplies, copy that variable's name from `pm2 env 2`, not its value, and
ask.

- [ ] **Step 3: Enter the maintenance window: stop the services**

```bash
pm2 stop admin-dashboard gateway pathway-service
pm2 list
curl -sk -o /dev/null -w "%{http_code}\n" https://localhost/
```
Expected: all three `stopped`; `502`. From here to Step 8, a failure means **stay stopped, report,
ask**.

- [ ] **Step 4: Back up the database and the current build artifacts**

```bash
BK=/home/claude/backups/release-evaluation-pipeline-$(date +%Y%m%d-%H%M)
mkdir -p $BK
pg_dump -h localhost -U prism -Fc prism_db > $BK/prism_db.dump
pg_restore --list $BK/prism_db.dump | grep -c "TABLE DATA"
cp -a $G/apps/pathway-service/dist $BK/pathway-service-dist
cp -a $A/.next $BK/admin-next
cp $G/package-lock.json $BK/graphql-package-lock.json; cp $A/package-lock.json $BK/admin-package-lock.json
du -sh $BK/*
```
Expected: a table-data count greater than 0, and non-empty copies. The lockfile copies preserve
the drift that Step 5 discards.

- [ ] **Step 5: Fast-forward the live checkouts, install, build**

```bash
git -C $G checkout -- package-lock.json && git -C $G pull --ff-only
git -C $A checkout -- package-lock.json && git -C $A pull --ff-only
git -C $G log --oneline -1; git -C $A log --oneline -1
npm install --prefix $G
npm install --prefix $A
npm run build --prefix $G/apps/pathway-service && echo service-built
npm run build --prefix $A && echo admin-built
```
Expected: the heads equal the commits Step 2 built, and both builds succeed, as they did in Step 2.

- [ ] **Step 6: Apply 067 and 068**

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
Expected: both apply, and **both checksums equal the rehearsal's** (Task 6).
- A failing file rolls itself back (`BEGIN … COMMIT`).
- If 067 fails, the database is unchanged.
- If 068 fails, the database is at 067.
- Either way the services stay stopped. **Stop and ask**: fix forward, or roll back.

- [ ] **Step 7: Start in order and verify**

```bash
pm2 start pathway-service && sleep 3
pm2 start gateway && sleep 3
pm2 start admin-dashboard && sleep 5
pm2 list
pm2 logs pathway-service --nostream --lines 30
curl -sk -o /dev/null -w "%{http_code}\n" https://localhost/
curl -sk -X POST -H 'Content-Type: application/json' -d '{"query":"{__typename}"}' https://localhost/graphql
curl -s -X POST -H 'Content-Type: application/json' -d '{"query":"{ __type(name: \"ResolutionSession\") { fields { name } } }"}' http://localhost:4000/graphql | grep -o '"resultHash"'
sudo systemctl reload nginx
```
Expected:
- all three `online`;
- no startup error in the log;
- `200`;
- `{"data":{"__typename":"Query"}}`;
- `"resultHash"`: the gateway composed the new subgraph.

If any check fails: `pm2 stop admin-dashboard gateway pathway-service`, then report and ask.

- [ ] **Step 8: Rollback — only on the user's instruction, with the services stopped**

```bash
pm2 stop admin-dashboard gateway pathway-service
pg_restore --clean --if-exists -h localhost -U prism -d prism_db $BK/prism_db.dump
git -C $G checkout --detach 2454130; git -C $A checkout --detach 3a32df8
npm install --prefix $G; npm install --prefix $A
rm -rf $G/apps/pathway-service/dist && cp -a $BK/pathway-service-dist $G/apps/pathway-service/dist
rm -rf $A/.next && cp -a $BK/admin-next $A/.next
psql -h localhost -U prism -d prism_db -Atc "SELECT max(migration_id) FROM migration_history"
pm2 start pathway-service && sleep 3; pm2 start gateway && sleep 3; pm2 start admin-dashboard
```
Expected: `066_backfill_remaining_branch_mode`, the old artifacts serving, and the Step 7 checks
passing except `"resultHash"`, which the old schema lacks.
- The checkouts are now detached at the old heads. Returning them to `main` / `master` is the
  user's next decision.
- The dump was taken after the backfill (Task 7), so the restore keeps the cache rows.

- [ ] **Step 9: Record**

Write `$REC/deploy.md` with:
- the window's start and end times;
- the old and new heads of both checkouts;
- the backup directory;
- the checksums;
- the verification output.

Commit it on the docs branch. The build-only worktree is left for `/cleanup-feature` (Task 12).

---

### Task 10: 🔒D After-record and the §5.8 comparison

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

### Task 11: 🔒D Admin smoke test (spec §5.10)

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

### Task 12: Close out

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

Suggest `/cleanup-feature` for the merged plan branches 01–05, `fix/preview-refresh-race` and the
build-only `evaluation-pipeline-release-build` worktree, but
**do not run it without the user's say-so**.

---

## Gate re-run (YYYY-MM-DD, after the backfill)

**The decision: the mutation gate** (Task 8 Step 1, a migrated copy of post-backfill live):

| Mutation | p50 | p95 | Budget | Pass |
|---|---|---|---|---|
| Single pathway: `overrideNode` (chronic-htn-pregnancy-v1) | … | … | < 2000 ms | … |
| 5-child run: answer (`answerPendingDecision`, gate …) | … | … | < 5000 ms | … |
| 5-child run: fact (`addPatientContext`) | … | … | < 5000 ms | … |

**Diagnostic: the stages** (Task 8 Step 2, live, read-only):

| Measurement | Workload | Pre-backfill p95 (Task 2) | Post-backfill p95 |
|---|---|---|---|
| Single pathway, ROOT: total | … nodes, … candidates, …/… normalised, … pairs loaded | … | … |
| &nbsp;&nbsp;env snapshot | | … | … |
| &nbsp;&nbsp;evaluate | | … | … |
| 5-child run: total | … nodes, … candidates; root pair set … candidates, … normalised, … comparisons (… conflicts, ACCEPT_BOTH) | … | … |
| &nbsp;&nbsp;composeRun (decided) | | … | … |

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
