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
  labResults: [{ code: '718-7', system: 'LOINC', value: 9.4, date: '2026-09-01' }],
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
    pool, redis: null, // ADMIN: a pinned clock needs an explicit SYNTHETIC resolution (trust-mode.ts).
    userId: '00000000-0000-4000-a000-000000000002', userRole: 'ADMIN', temporalPolicyVersion: 'v1',
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
    // startResolution takes ACTIVE pathways only, and chronic-htn is DRAFT on
    // live. Activate it on this scratch copy (beforeAll refused anything else)
    // so the gate keeps the spec §5.7 workload. Untimed setup.
    await pool.query(`UPDATE pathway_graph_index SET status = 'ACTIVE' WHERE id = $1`, [SINGLE]);
    const started = (await resolutionMutations.startResolution(null, {
      pathwayId: SINGLE, patientId: PATIENT.patientId, patientContext: PATIENT, resolutionMode: 'SYNTHETIC', evaluationAsOf: AS_OF,
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
