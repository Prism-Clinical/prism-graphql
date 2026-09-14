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
