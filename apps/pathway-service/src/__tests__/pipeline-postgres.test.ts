/**
 * Opt-in Postgres tests (spec §5.6). They WRITE, so never against prism_db.
 *
 * Setup — a fresh scratch database each run (the purge test inserts a
 * pre-067 session before applying 067 and 068):
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
import { insertRun, setContributingSessions, writeRunEvaluation } from '../services/resolution/multi-pathway-session-store';
import { multiPathwayResolutionMutations } from '../resolvers/mutations/multi-pathway-resolution';
import { evaluateRun, newRunRequest, sessionInputsOf } from '../services/resolution/pipeline/run';
import { insertSession, logEvent, writeEvaluation } from '../services/resolution/session-store';
import { SessionStatus } from '../services/resolution/types';
import { harness } from './fixtures/resolver-harness';
import { edge, makeEnv, makeInputs, node } from './fixtures/pipeline-env';

const describePg = process.env.RUN_PIPELINE_PG_TESTS === '1' ? describe : describe.skip;
const PATHWAY_ID = '00000000-0000-4000-a000-00000000e067';
const ENV = makeEnv(
  [node('root', 'Pathway'), node('stage', 'Stage'), node('step', 'Step'), node('med', 'Medication', { name: 'Amoxicillin', role: 'first_line' })],
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
    await pool.query(readFileSync(join(__dirname, '../../../../shared/data-layer/migrations/068_run_inputs.sql'), 'utf-8'));
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
    const { runId } = await newRun();
    await expect(pool.query(
      `UPDATE pathway_resolution_sessions SET parent_session_id = $1, additional_context = '{"allergies": []}' WHERE id = $2`,
      [runId, id],
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
});
