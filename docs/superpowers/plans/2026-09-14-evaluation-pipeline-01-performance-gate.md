# Evaluation Pipeline 01 — Performance Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Measure whether full re-evaluation fits the spec's budgets before any pipeline code is
written.

**Architecture:**
- **The pipeline does not exist yet,** so this measures its stand-in: the stages it will run,
  composed from today's code.
  - Environment load: `buildResolutionContext`.
  - Whole-graph scoring: **one** `computePathwayConfidence` over all nodes.
  - Traversal: reading those scores.
  - Patient-context DDI.
- **The test is opt-in** and reads the live database through connections forced read-only.
- **It also times today's per-node scoring, for comparison.**

**Tech Stack:** Jest + ts-jest, `pg`, Apache AGE (live `prism_db`).

**Spec:** `docs/superpowers/specs/2026-09-13-evaluation-pipeline-design.md` §5.7, D1, D13.
**Overview:** `docs/superpowers/plans/2026-09-14-evaluation-pipeline-00-overview.md`.

## Global Constraints

- Budgets, copied from spec §5.7: p95 **< 2 s** single-pathway; **< 5 s** for a 5-child run
  evaluation.
- If the budget fails: **stop and revisit D1/D13 before further work.** Do not start plan 02.
- The live database is read-only. Every connection sets `default_transaction_read_only = on`.
- The test must be skipped in the default suite run.
- No `cd … && …`. Commit messages end with the attribution lines in the overview.

## Measured pathways (live `pathway_graph_index`, verified 2026-09-14)

| Role | id | logical_id@version | Nodes |
|---|---|---|---|
| Single + run child 1 | `8d7fbfc6-06cf-4caa-a4e7-2efe07e9ea6c` | chronic-htn-pregnancy-v1@1.0 | 108 |
| Run child 2 | `9ee949c9-625a-48ac-873b-c121e8fd24e2` | gestational-hypertension-preeclampsia@1 | 105 |
| Run child 3 | `40c06c6b-4699-47e3-bba5-c72ca72e9e7d` | routine-prenatal-care-v1@1.0 | 73 |
| Run child 4 | `ae6b0d51-3e89-4c0e-a062-d0a8eec01b69` | vaginal-discharge-pregnancy-v1@1.0 | 58 |
| Run child 5 | `a9600763-ba44-4481-9d0b-b66d63dd04dc` | anemia-pregnancy-v1@1.0 | 56 |

`buildResolutionContext` does not check pathway status, so ARCHIVED and DRAFT graphs load.

## Known limits of this measurement

- **No LLM evaluator is passed.** LLM gates take their tentative safe default
  (`gate-evaluator.ts:1564`). This is the steady state: with recorded observations (C1),
  re-evaluation makes no LLM calls.
- **The environment is not read in one REPEATABLE READ transaction.**
  `buildResolutionContext` runs its queries in parallel on the pool. Plan 02 adds the snapshot;
  its cost is a single transaction around the same reads.
- **Run children are evaluated sequentially.** Composition (merge, conflict selection, set
  safety) is in-memory and not measured.
- **DDI timing is a lower bound.** The live `medication_normalization_cache` held **0 rows** on
  2026-09-14 (read-only check), and none of the 33 medications across the measured pathways is
  mapped. `lookupNormalizedMedication` is a SELECT that returns null on a miss, and DDI skips
  unnormalized drugs, so the safety stage runs lookups but no interaction queries. The benchmark
  prints coverage so the result carries this qualification. Re-run the gate once coverage exists.

---

### Task 1: Opt-in evaluation benchmark and gate result

**Files:**
- Create: `apps/pathway-service/src/__tests__/evaluation-benchmark.test.ts`
- Modify: `docs/superpowers/plans/2026-09-14-evaluation-pipeline-01-performance-gate.md` (append
  *Gate result*)

**Interfaces:**
- Consumes (all existing on `main` @ `2454130`):
  - `buildResolutionContext(pool, pathwayId): Promise<ResolutionContext>`
    (`resolvers/helpers/resolution-context.ts:291`). `ResolutionContext` has `graphContext`,
    `edges`, `signals`, `thresholds`, `confidenceEngine`, `codeMap` and `temporalDefaults`.
  - `makeTraversalAdapter(ctx, pool, pathwayId, patientContext)` (`:337`): today's per-node scoring.
  - `ConfidenceEngine.computePathwayConfidence({ pool, pathwayId, nodes, edges, signalDefinitions, patientContext }): Promise<PathwayConfidenceResult>`,
    whose `nodes` field is `NodeConfidenceResult[]` keyed by `nodeIdentifier`.
  - `new TraversalEngine(adapter, thresholds, temporalContext, temporalDefaults, factStore, codeMap)`
    and `.traverse(graphContext, patientContext, gateAnswers): Promise<TraversalResult>`.
  - `makeEvaluationTemporalContext({ evaluationAsOf, temporalPolicyVersion })`.
  - `assembleContext({ mode: 'SYNTHETIC', patientContext }, temporalContext)`.
  - `applyDdiToResolutionState(pool, state, patientContext)`
    (`services/medications/ddi-pass-single-pathway.ts:27`).
- Produces: a recorded go / no-go. No code consumed by later plans.

- [ ] **Step 1: Create the plan's worktree**

Run `/new-feature` for prism-graphql with branch `feat/evaluation-pipeline-01-performance-gate`.
Branch it from `origin/main`, since `feat/evaluation-pipeline` does not exist yet. Then install
dependencies (absolute path; the worktree has its own `node_modules`):

```bash
npm install --prefix /home/claude/workspace/features/feat-evaluation-pipeline-01-performance-gate/prism-graphql
```

Every path below is relative to that worktree's `prism-graphql/`.

- [ ] **Step 2: Write the benchmark**

Create `apps/pathway-service/src/__tests__/evaluation-benchmark.test.ts`:

```ts
/**
 * EVALUATION PERFORMANCE GATE — spec §5.7
 * (docs/superpowers/specs/2026-09-13-evaluation-pipeline-design.md).
 *
 * Measures the cost of full re-evaluation per mutation (D1) and of re-evaluating
 * every child of a 5-pathway run (D13), using today's code as the stand-in for
 * the pipeline stages: environment load, ONE whole-graph scoring call,
 * traversal reading those scores, patient-context DDI.
 *
 * Opt-in and read-only against the live database:
 *
 *   export POSTGRES_PASSWORD=$(pm2 env 0 | sed 's/\x1b\[[0-9;]*m//g' \
 *     | awk -F': ' '/^POSTGRES_PASSWORD/{print $2}')
 *   RUN_EVALUATION_BENCHMARK=1 npm test --prefix apps/pathway-service -- \
 *     --runInBand src/__tests__/evaluation-benchmark.test.ts
 */

import { Pool } from 'pg';
import { performance } from 'perf_hooks';
import { buildResolutionContext, makeTraversalAdapter } from '../resolvers/helpers/resolution-context';
import { TraversalEngine } from '../services/resolution/traversal-engine';
import { makeEvaluationTemporalContext } from '../services/resolution/temporal/evaluation-context';
import { assembleContext } from '../services/resolution/temporal/context-assembler';
import { applyDdiToResolutionState } from '../services/medications/ddi-pass-single-pathway';
import { lookupNormalizedMedication } from '../services/medications/normalizer';
import type { GraphNode, NodeConfidenceResult, PatientContext } from '../services/confidence/types';

const SINGLE = '8d7fbfc6-06cf-4caa-a4e7-2efe07e9ea6c'; // chronic-htn-pregnancy-v1@1.0, 108 nodes
const RUN = [
  SINGLE,
  '9ee949c9-625a-48ac-873b-c121e8fd24e2', // gestational-hypertension-preeclampsia@1, 105
  '40c06c6b-4699-47e3-bba5-c72ca72e9e7d', // routine-prenatal-care-v1@1.0, 73
  'ae6b0d51-3e89-4c0e-a062-d0a8eec01b69', // vaginal-discharge-pregnancy-v1@1.0, 58
  'a9600763-ba44-4481-9d0b-b66d63dd04dc', // anemia-pregnancy-v1@1.0, 56
];
const BUDGET_P95_MS = { single: 2000, run: 5000 }; // spec §5.7
const WARMUP = 3;
const SAMPLES = 20;
const TODAY_SAMPLES = 5;
const AS_OF = '2026-09-14T12:00:00.000Z';

// Enough clinical content to open the chronic-HTN branches and give DDI real
// candidates: pre-existing HTN in pregnancy, elevated BP, an anaemia lab.
const PATIENT = {
  patientId: '00000000-0000-4000-a000-0000000000fe',
  conditionCodes: [
    { code: 'O10.01', system: 'ICD-10' },
    { code: '8762007', system: 'SNOMED' },
  ],
  medications: [],
  allergies: [],
  labResults: [{ code: '718-7', system: 'LOINC', value: 9.4, effectiveDateTime: '2026-09-01' }],
  vitalSigns: { systolic_bp: 150, diastolic_bp: 95 },
  patientAttributes: {},
} as unknown as PatientContext;

interface Timings {
  env: number; scores: number; traverse: number; safety: number; total: number;
  medications: number; normalized: number; // DDI coverage: unnormalized candidates are skipped by DDI
}

const unscored = (node: GraphNode): NodeConfidenceResult =>
  ({ nodeIdentifier: node.nodeIdentifier, nodeType: node.nodeType, confidence: 0, breakdown: [], propagationInfluences: [] }) as NodeConfidenceResult;

/** One pipeline-shaped evaluation: env → scores once → traverse → safety. */
async function evaluateOnce(pool: Pool, pathwayId: string): Promise<Timings> {
  const t0 = performance.now();
  const ctx = await buildResolutionContext(pool, pathwayId);
  const t1 = performance.now();

  const scored = await ctx.confidenceEngine.computePathwayConfidence({
    pool,
    pathwayId,
    nodes: ctx.graphContext.allNodes,
    edges: ctx.edges,
    signalDefinitions: ctx.signals,
    patientContext: PATIENT,
  });
  const scores = new Map(scored.nodes.map((n) => [n.nodeIdentifier, n]));
  const t2 = performance.now();

  const temporal = makeEvaluationTemporalContext({ evaluationAsOf: AS_OF, temporalPolicyVersion: 'v1' });
  const engine = new TraversalEngine(
    { computeNodeConfidence: async (node: GraphNode) => scores.get(node.nodeIdentifier) ?? unscored(node) },
    ctx.thresholds,
    temporal,
    ctx.temporalDefaults,
    assembleContext({ mode: 'SYNTHETIC', patientContext: PATIENT } as never, temporal),
    ctx.codeMap,
  );
  const result = await engine.traverse(ctx.graphContext, PATIENT, new Map());
  const t3 = performance.now();

  await applyDdiToResolutionState(pool, result.resolutionState, PATIENT);
  const t4 = performance.now();

  // Coverage, outside the timed region. A cache miss makes DDI skip the drug
  // silently (ddi-pass.ts normalizeCandidates), so a fast safety stage may
  // simply mean few drugs were checked.
  const meds = [...result.resolutionState.values()].filter(
    (n) => n.nodeType === 'Medication' && n.status === 'INCLUDED',
  );
  let normalized = 0;
  for (const n of meds) {
    const name = ((n.properties?.name as string) ?? n.title) || '';
    if (await lookupNormalizedMedication(pool, { text: name })) normalized++;
  }

  return {
    env: t1 - t0, scores: t2 - t1, traverse: t3 - t2, safety: t4 - t3, total: t4 - t0,
    medications: meds.length, normalized,
  };
}

/** Today's shape, for comparison only: per-node scoring through the adapter. */
async function traverseToday(pool: Pool, pathwayId: string): Promise<number> {
  const t0 = performance.now();
  const ctx = await buildResolutionContext(pool, pathwayId);
  const temporal = makeEvaluationTemporalContext({ evaluationAsOf: AS_OF, temporalPolicyVersion: 'v1' });
  const engine = new TraversalEngine(
    makeTraversalAdapter(ctx, pool, pathwayId, PATIENT),
    ctx.thresholds,
    temporal,
    ctx.temporalDefaults,
    assembleContext({ mode: 'SYNTHETIC', patientContext: PATIENT } as never, temporal),
    ctx.codeMap,
  );
  await engine.traverse(ctx.graphContext, PATIENT, new Map());
  return performance.now() - t0;
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
  `${label.padEnd(22)} p50 ${ms(pct(values, 0.5)).padStart(7)}   p95 ${ms(pct(values, 0.95)).padStart(7)}`;

const describeBenchmark = process.env.RUN_EVALUATION_BENCHMARK === '1' ? describe : describe.skip;

describeBenchmark('evaluation performance gate (live DB, read-only)', () => {
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

      await sample(WARMUP, () => evaluateOnce(pool, SINGLE));
      const single = await sample(SAMPLES, () => evaluateOnce(pool, SINGLE));

      const runOnce = async () => {
        const t0 = performance.now();
        for (const id of RUN) await evaluateOnce(pool, id); // sequential: conservative
        return performance.now() - t0;
      };
      await sample(WARMUP, runOnce);
      const run = await sample(SAMPLES, runOnce);

      const today = await sample(TODAY_SAMPLES, () => traverseToday(pool, SINGLE));

      const pick = (k: keyof Timings) => single.map((t) => t[k]);
      // eslint-disable-next-line no-console
      console.log([
        '',
        `single pathway ${SINGLE} (${SAMPLES} samples)`,
        row('  env load', pick('env')),
        row('  scores (once)', pick('scores')),
        row('  traverse', pick('traverse')),
        row('  safety (DDI)', pick('safety')),
        row('  total', pick('total')),
        `  budget p95 < ${BUDGET_P95_MS.single}ms`,
        `  DDI coverage: ${single[0].normalized}/${single[0].medications} included medications normalized`,
        '',
        `5-child run, sequential (${SAMPLES} samples)`,
        row('  total', run),
        '',
        `today: per-node scoring traverse, no DDI (${TODAY_SAMPLES} samples)`,
        row('  total', today),
        '',
      ].join('\n'));

      expect(pct(pick('total'), 0.95)).toBeLessThan(BUDGET_P95_MS.single);
      expect(pct(run, 0.95)).toBeLessThan(BUDGET_P95_MS.run);
    } finally {
      await pool.end();
    }
  }, 900_000);
});
```

- [ ] **Step 3: Verify it is skipped by default**

Run:
```bash
npm test --prefix /home/claude/workspace/features/feat-evaluation-pipeline-01-performance-gate/prism-graphql/apps/pathway-service -- --runInBand src/__tests__/evaluation-benchmark.test.ts
```
Expected: `Tests: 1 skipped, 1 total`, with no database connection attempted.

- [ ] **Step 4: Run the benchmark**

```bash
export POSTGRES_PASSWORD=$(pm2 env 0 | sed 's/\x1b\[[0-9;]*m//g' | awk -F': ' '/^POSTGRES_PASSWORD/{print $2}')
RUN_EVALUATION_BENCHMARK=1 npm test --prefix /home/claude/workspace/features/feat-evaluation-pipeline-01-performance-gate/prism-graphql/apps/pathway-service -- --runInBand src/__tests__/evaluation-benchmark.test.ts
unset POSTGRES_PASSWORD
```

Expected:
- The write probe is refused. If it is not, the assertion fails before anything is measured;
  stop, because the guard does not work.
- A timing table is printed, including a DDI coverage line.
- PASS or FAIL on the two budget assertions.

**Any failure containing `read-only transaction`** means measured code attempted a write. Nothing
on this path should write: `lookupNormalizedMedication` is SELECT-only and never calls RxNav. Do
**not** remove the guard. Record the stack trace in *Gate result* and stop.

**Low DDI coverage** does not fail the gate, but it qualifies the safety timing: unnormalized
drugs are skipped without a query. Record it.

- [ ] **Step 5: Record the gate result**

Append to this plan file:

```markdown
## Gate result (YYYY-MM-DD)

| Measurement | p50 | p95 | Budget | Pass |
|---|---|---|---|---|
| Single pathway total (108 nodes) | … | … | < 2000 ms | yes/no |
|   env load / scores / traverse / safety | … | … | — | — |
| 5-child run, sequential | … | … | < 5000 ms | yes/no |
| Today: per-node scoring traverse | … | … | — | — |

**DDI coverage:** …/… included medications normalized (chronic-htn-pregnancy-v1).
**Decision:** GO to plan 02 / STOP — revisit D1/D13.
```

Fill each cell from the printed table. Do not round a failing p95 under its budget.

- [ ] **Step 6: Confirm the suite is unchanged**

Run:
```bash
npm test --prefix /home/claude/workspace/features/feat-evaluation-pipeline-01-performance-gate/prism-graphql/apps/pathway-service -- --runInBand
```
Expected: 1645 passed, 9 failed (`patient-match-scorer`, `data-completeness-scorer` only),
2 skipped (`baseline-capture` + this benchmark).

- [ ] **Step 7: Commit and push**

```bash
W=/home/claude/workspace/features/feat-evaluation-pipeline-01-performance-gate/prism-graphql
git -C $W add apps/pathway-service/src/__tests__/evaluation-benchmark.test.ts
git -C $W commit -m "test(pathway-service): opt-in evaluation performance gate

Measures full re-evaluation (env load, one whole-graph scoring call,
traversal, patient DDI) against the evaluation pipeline spec's §5.7
budgets on five live pathways, through read-only connections.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XRNkZvQrxmRLNtJHxq71kH"
git -C $W push -u origin HEAD:refs/heads/feat/evaluation-pipeline-01-performance-gate
```

Commit the *Gate result* section on `docs/evaluation-pipeline-design`, where this plan lives:

```bash
D=/home/claude/workspace/features/docs-evaluation-pipeline-design/prism-graphql
git -C $D add docs/superpowers/plans/2026-09-14-evaluation-pipeline-01-performance-gate.md
git -C $D commit -m "docs: record evaluation pipeline performance gate result

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XRNkZvQrxmRLNtJHxq71kH"
git -C $D push origin HEAD:refs/heads/docs/evaluation-pipeline-design
```

- [ ] **Step 8: Report and stop**

Report the table and the decision to the user. **Do not start plan 02.** Plan 02 is written only
after this gate passes and the user agrees.

---

## Gate result (2026-09-14, revised after review)

**Re-run after the backfill (plan 05, 2026-09-24):** see `2026-09-22-evaluation-pipeline-05-release.md`, *Gate re-run*.

Run on the live host against `prism_db`, read-only; the write probe was refused before measuring.
Benchmark: `apps/pathway-service/src/__tests__/evaluation-benchmark.test.ts` on
`feat/evaluation-pipeline-01-performance-gate`. **That file is authoritative.** It supersedes the
Step 2 listing above, which predates the review fixes.

**Review feedback addressed:**
1. **Timing accounting.** Coverage lookups are no longer inside `evaluateOnce`. The run total is
   the sum of each child's own timed total, the same accounting as the single case.
2. **Safety label.** The patient now has one medication and one allergy. The safety stage treats
   every Medication node as a candidate, because scoring excludes all of them for this patient
   (see the confidence finding below). The label states what is measured: lookups and
   orchestration, with no interaction queries while the normalisation cache is empty.
3. **Workload validation.** Every sample asserts a minimum graph size (single ≥ 100 nodes,
   run ≥ 400), that every node resolved, and a minimum number of safety candidates (single ≥ 9,
   run ≥ 25).
   - The assertion was falsified: a temporary copy with the candidate floor raised to 10 failed
     with `Expected: >= 10, Received: 9`. The copy was deleted.

| Measurement | Workload | p50 | p95 | Budget | Pass |
|---|---|---|---|---|---|
| Single pathway total (chronic-htn-pregnancy-v1) | 109 nodes, 109 resolved, 9 candidates | 13 ms | 19 ms | < 2000 ms | yes |
| &nbsp;&nbsp;env load | | 7 ms | 10 ms | — | — |
| &nbsp;&nbsp;scores (one whole-graph call) | | 2 ms | 4 ms | — | — |
| &nbsp;&nbsp;traverse | | 0 ms | 0 ms | — | — |
| &nbsp;&nbsp;safety (DDI lookups, all meds as candidates) | | 3 ms | 4 ms | — | — |
| 5-child run, summed child totals | 405 nodes, 29 candidates | 53 ms | 60 ms | < 5000 ms | yes |
| Today: per-node scoring traverse, no DDI | 109 nodes | 76 ms | 87 ms | — | — |

**Normalisation coverage:** 0/9 Medication nodes. No interaction queries ran, so the safety figure
remains a lower bound, to re-measure after the backfill (plan 05).

**Confidence finding** (throwaway read-only diagnostic, chronic-htn-pregnancy-v1, same patient):
- **No medication is INCLUDED under either scoring shape.** Scores are identical per-node and
  whole-graph (0.094 and 0.25). `data_completeness` and `match_quality` score 0.00 for Medication
  nodes, so the exclusion is today's behaviour, not a consequence of propagation.
- **Propagation is genuinely off today and on in the new shape.** Per-node scoring logged 30 false
  "Cycle detected" warnings; whole-graph scoring logged none.
- **Watch item for plan 02's before/after record (§5.8):** propagation lowers Stage confidence
  0.781 → 0.706 and **Step confidence 0.781 → 0.598, just under the 0.6 suggest threshold**.
  Whether Steps are threshold-gated determines whether this changes plan contents.

**Decision:** GO to plan 02. Both p95s are more than 80× under budget with the workload
asserted.
