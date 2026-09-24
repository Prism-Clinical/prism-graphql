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
const MIN_ROOT_CANDIDATES = 23;
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
  labResults: [{ code: '718-7', system: 'LOINC', value: 9.4, date: '2026-09-01' }],
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
  return {
    env: t1 - t0, evaluate: t2 - t1, total: t2 - t0, workload: workloadOf(env, r), findings: r.safetyFindings.length,
    reference: `${env.safety.pairs.size} pair rules, ${env.safety.classRules.length} class rules, ${env.safety.allergyMappings.length} allergy mappings`,
  };
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
      // Normalisation coverage only: with empty reference tables these comparisons are empty
      // lookups. Exercised safety rules are asserted by the mutation gate's fixture pass.
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
          `${s0.workload.normalised} normalised`,
        `  safety reference: ${s0.reference}; ${s0.findings} findings (0 rules or 0 findings = no DDI rule exercised)`,
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
