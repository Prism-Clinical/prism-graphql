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
import type { ResolutionState } from '../services/resolution/types';
import type { GraphNode, NodeConfidenceResult, PatientContext } from '../services/confidence/types';

const SINGLE = '8d7fbfc6-06cf-4caa-a4e7-2efe07e9ea6c'; // chronic-htn-pregnancy-v1@1.0
const RUN = [
  SINGLE,
  '9ee949c9-625a-48ac-873b-c121e8fd24e2', // gestational-hypertension-preeclampsia@1
  '40c06c6b-4699-47e3-bba5-c72ca72e9e7d', // routine-prenatal-care-v1@1.0
  'ae6b0d51-3e89-4c0e-a062-d0a8eec01b69', // vaginal-discharge-pregnancy-v1@1.0
  'a9600763-ba44-4481-9d0b-b66d63dd04dc', // anemia-pregnancy-v1@1.0
];
const BUDGET_P95_MS = { single: 2000, run: 5000 }; // spec §5.7
// Workload floors (live graphs on 2026-09-14: 109 / 405 nodes, 9 / 29 medications).
// A shrunken workload must fail here, not show up as a speed-up.
const MIN_NODES = { single: 100, run: 400 };
const MIN_CANDIDATES = { single: 9, run: 25 };
const WARMUP = 3;
const SAMPLES = 20;
const TODAY_SAMPLES = 5;
const AS_OF = '2026-09-14T12:00:00.000Z';

// Pre-existing HTN in pregnancy, elevated BP, an anaemia lab, and one patient
// medication and allergy so the safety stage has patient-side lookups to do.
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

interface Evaluation {
  env: number; scores: number; traverse: number; safety: number; total: number;
  graphNodes: number; resolved: number; candidates: number;
}

const unscored = (node: GraphNode): NodeConfidenceResult =>
  ({ nodeIdentifier: node.nodeIdentifier, nodeType: node.nodeType, confidence: 0, breakdown: [], propagationInfluences: [] }) as NodeConfidenceResult;

/**
 * Every Medication node as a safety candidate. For this patient scoring
 * excludes all of them, which would leave the safety stage with nothing to
 * check; the pipeline's worst case is every one eligible.
 */
const allMedicationsIncluded = (state: ResolutionState): ResolutionState =>
  new Map([...state].map(([id, n]) => [id, n.nodeType === 'Medication' ? { ...n, status: 'INCLUDED' as never } : n]));

/** One pipeline-shaped evaluation: env → scores once → traverse → safety. */
async function evaluateOnce(pool: Pool, pathwayId: string): Promise<Evaluation> {
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

  const safetyState = allMedicationsIncluded(result.resolutionState);
  await applyDdiToResolutionState(pool, safetyState, PATIENT);
  const t4 = performance.now();

  return {
    env: t1 - t0, scores: t2 - t1, traverse: t3 - t2, safety: t4 - t3, total: t4 - t0,
    graphNodes: ctx.graphContext.allNodes.length,
    resolved: result.resolutionState.size,
    candidates: [...safetyState.values()].filter((n) => n.nodeType === 'Medication').length,
  };
}

/** Normalisation coverage of a pathway's Medication nodes. Never timed. */
async function coverage(pool: Pool, pathwayId: string): Promise<{ normalized: number; total: number }> {
  const ctx = await buildResolutionContext(pool, pathwayId);
  const meds = ctx.graphContext.allNodes.filter((n) => n.nodeType === 'Medication');
  let normalized = 0;
  for (const n of meds) {
    const name = String(n.properties?.name ?? n.properties?.title ?? '');
    if (await lookupNormalizedMedication(pool, { text: name })) normalized++;
  }
  return { normalized, total: meds.length };
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
  `${label.padEnd(40)} p50 ${ms(pct(values, 0.5)).padStart(7)}   p95 ${ms(pct(values, 0.95)).padStart(7)}`;

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

      // Each child's own total, summed: identical accounting to the single case.
      const runOnce = async () => {
        const children: Evaluation[] = [];
        for (const id of RUN) children.push(await evaluateOnce(pool, id)); // sequential: conservative
        return children;
      };
      await sample(WARMUP, runOnce);
      const runs = await sample(SAMPLES, runOnce);
      const runTotals = runs.map((children) => children.reduce((s, c) => s + c.total, 0));

      const today = await sample(TODAY_SAMPLES, () => traverseToday(pool, SINGLE));
      const cov = await coverage(pool, SINGLE);

      // Workload: the measured work must be the intended work.
      for (const e of single) {
        expect(e.graphNodes).toBeGreaterThanOrEqual(MIN_NODES.single);
        expect(e.resolved).toBe(e.graphNodes);
        expect(e.candidates).toBeGreaterThanOrEqual(MIN_CANDIDATES.single);
      }
      for (const children of runs) {
        expect(children.reduce((s, c) => s + c.graphNodes, 0)).toBeGreaterThanOrEqual(MIN_NODES.run);
        expect(children.reduce((s, c) => s + c.candidates, 0)).toBeGreaterThanOrEqual(MIN_CANDIDATES.run);
        for (const c of children) expect(c.resolved).toBe(c.graphNodes);
      }

      const pick = (k: keyof Evaluation) => single.map((t) => t[k]);
      const first = runs[0];
      // eslint-disable-next-line no-console
      console.log([
        '',
        `single pathway ${SINGLE} (${SAMPLES} samples)`,
        `  workload: ${single[0].graphNodes} nodes, ${single[0].resolved} resolved, ${single[0].candidates} safety candidates`,
        row('  env load', pick('env')),
        row('  scores (once)', pick('scores')),
        row('  traverse', pick('traverse')),
        row('  safety (DDI lookups, all meds as candidates)', pick('safety')),
        row('  total', pick('total')),
        `  budget p95 < ${BUDGET_P95_MS.single}ms`,
        `  normalisation coverage: ${cov.normalized}/${cov.total} Medication nodes` +
          (cov.normalized === 0 ? ' (no interaction queries ran; safety timing is lookup + orchestration only)' : ''),
        '',
        `5-child run, sequential, summed child totals (${SAMPLES} samples)`,
        `  workload: ${first.reduce((s, c) => s + c.graphNodes, 0)} nodes, ${first.reduce((s, c) => s + c.candidates, 0)} safety candidates`,
        row('  total', runTotals),
        `  budget p95 < ${BUDGET_P95_MS.run}ms`,
        '',
        `today: per-node scoring traverse, no DDI (${TODAY_SAMPLES} samples)`,
        row('  total', today),
        '',
      ].join('\n'));

      expect(pct(pick('total'), 0.95)).toBeLessThan(BUDGET_P95_MS.single);
      expect(pct(runTotals, 0.95)).toBeLessThan(BUDGET_P95_MS.run);
    } finally {
      await pool.end();
    }
  }, 900_000);
});
