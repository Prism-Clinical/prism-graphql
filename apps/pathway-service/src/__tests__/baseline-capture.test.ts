/**
 * BASELINE CAPTURE — not a test of behaviour, a record of it.
 *
 * Resolves the ACTIVE pathway from the live graph against one fixed patient,
 * twice: under `legacy-v0` (what production runs today) and under `v1` (what
 * this branch makes the default). It prints the difference.
 *
 * The point is attribution. After deploying, real sessions will behave
 * differently in several ways at once — the temporal kernel, escalation,
 * `one_of` pending, confidence movement — and without a reference there is no
 * way to tell which surprise came from which change, or which is a bug.
 *
 * SKIPPED by default — it needs the live database. To run it, drop the
 * `.skip` and:
 *
 *   export PGPASSWORD=$(pm2 env 0 | sed 's/\x1b\[[0-9;]*m//g' \
 *     | awk -F': ' '/^POSTGRES_PASSWORD/{print $2}')
 *   POSTGRES_PASSWORD="$PGPASSWORD" npx jest baseline-capture
 *
 * Captured 2026-09-10, anemia-in-pregnancy-v1 @ 1.4, before deploying this
 * branch:
 *
 *   with a haemoglobin      49 nodes, 1 pending, 0 flags — ZERO status changes
 *   no haemoglobin on file  49 nodes, 2 pending, 0 flags — ONE status change:
 *                             gate-severe-anemia GATED_OUT -> PENDING_QUESTION
 *                             asking for LOINC 718-7
 *
 * So on the only ACTIVE pathway the temporal flip is a no-op, and the entire
 * behavioural change is one gate asking for a missing lab instead of silently
 * gating out — which is the point of the workstream. Anything ELSE seen after
 * the deploy is not explained by this, and is worth chasing.
 */

import { Pool } from 'pg';
import { buildResolutionContext, makeTraversalAdapter } from '../resolvers/helpers/resolution-context';
import { TraversalEngine } from '../services/resolution/traversal-engine';
import { makeEvaluationTemporalContext } from '../services/resolution/temporal/evaluation-context';
import { assembleContext } from '../services/resolution/temporal/context-assembler';
import type { PatientContext } from '../services/confidence/types';
import type { NodeResult } from '../services/resolution/types';

const PATHWAY_ID = process.env.BASELINE_PATHWAY_ID
  ?? 'a1774566-42ce-43cc-b83c-1a5749b240e1'; // anemia-in-pregnancy-v1 @ 1.4
const AS_OF = '2026-09-10T12:00:00.000Z';

/**
 * A deliberately SPARSE patient: anaemia coded, one haemoglobin, nothing else.
 *
 * Sparse is the interesting case — it is where escalation, `indeterminate` and
 * the horizon rules diverge from legacy, and where a plan is most likely to
 * change shape.
 */
const PATIENT = {
  patientId: '00000000-0000-4000-a000-0000000000ff',
  conditionCodes: [{ code: 'D50.9', system: 'ICD-10' }],
  medications: [],
  allergies: [],
  labResults: [
    { code: '718-7', system: 'LOINC', value: 9.4, effectiveDateTime: '2026-08-20' },
  ],
  vitalSigns: {},
  patientAttributes: {},
} as unknown as PatientContext;

async function resolveUnder(pool: Pool, version: string) {
  return resolveUnderPatient(pool, version, PATIENT);
}

async function resolveUnderPatient(pool: Pool, version: string, patient: PatientContext) {
  const ctx = await buildResolutionContext(pool, PATHWAY_ID);
  const temporalContext = makeEvaluationTemporalContext({
    evaluationAsOf: AS_OF,
    temporalPolicyVersion: version,
  });
  const factStore = assembleContext(
    { mode: 'SYNTHETIC', patientContext: patient } as never,
    temporalContext,
  );
  const engine = new TraversalEngine(
    makeTraversalAdapter(ctx, pool, PATHWAY_ID, patient),
    ctx.thresholds,
    temporalContext,
    ctx.temporalDefaults,
    factStore,
    ctx.codeMap,
  );
  return engine.traverse(ctx.graphContext, patient, new Map());
}

const statuses = (s: Map<string, NodeResult>) =>
  Object.fromEntries([...s].map(([id, r]) => [id, r.status]));

describe.skip('baseline capture (live DB)', () => {
  it('records legacy-v0 vs v1 on the ACTIVE pathway', async () => {
    const pool = new Pool({
      host: process.env.POSTGRES_HOST ?? 'localhost',
      user: process.env.POSTGRES_USER ?? 'prism',
      password: process.env.POSTGRES_PASSWORD,
      database: process.env.POSTGRES_DB ?? 'prism_db',
    });
    // Every new connection needs AGE loaded, as database.ts does for the service.
    pool.on('connect', (client) => {
      client.query("LOAD 'age'; SET search_path = ag_catalog, \"$user\", public;")
        .catch(() => { /* surfaced by the query that needs it */ });
    });

    try {
      const legacy = await resolveUnder(pool, 'legacy-v0');
      const v1 = await resolveUnder(pool, 'v1');

      const a = statuses(legacy.resolutionState);
      const b = statuses(v1.resolutionState);
      const moved = Object.keys({ ...a, ...b })
        .filter(id => a[id] !== b[id])
        .map(id => `  ${id}: ${a[id] ?? '(absent)'} -> ${b[id] ?? '(absent)'}`);

      const report = [
        `pathway            ${PATHWAY_ID}`,
        `nodes              legacy ${Object.keys(a).length} / v1 ${Object.keys(b).length}`,
        `pending questions  legacy ${legacy.pendingQuestions.length} / v1 ${v1.pendingQuestions.length}`,
        `red flags          legacy ${legacy.redFlags.length} / v1 ${v1.redFlags.length}`,
        `degraded           legacy ${legacy.isDegraded} / v1 ${v1.isDegraded}`,
        `status changes     ${moved.length}`,
        ...moved,
        '',
        'v1 pending questions:',
        ...v1.pendingQuestions.map(q => `  ${q.gateId}${q.datumKey ? ` [datum ${q.datumKey}]` : ''}: ${q.prompt}`),
        '',
        'v1 red flags:',
        ...v1.redFlags.map(f => `  ${f.type} on ${f.nodeId}: ${f.description}`),
      ].join('\n');

      // A patient with NO haemoglobin: the case escalation exists for.
      const bare = { ...PATIENT, labResults: [] } as unknown as PatientContext;
      const bareLegacy = await resolveUnderPatient(pool, 'legacy-v0', bare);
      const bareV1 = await resolveUnderPatient(pool, 'v1', bare);
      const c = statuses(bareLegacy.resolutionState);
      const d = statuses(bareV1.resolutionState);
      const bareMoved = Object.keys({ ...c, ...d }).filter(id => c[id] !== d[id]);

      const report2 = [
        '',
        '── no haemoglobin on file ──',
        `nodes              legacy ${Object.keys(c).length} / v1 ${Object.keys(d).length}`,
        `pending questions  legacy ${bareLegacy.pendingQuestions.length} / v1 ${bareV1.pendingQuestions.length}`,
        `red flags          legacy ${bareLegacy.redFlags.length} / v1 ${bareV1.redFlags.length}`,
        `status changes     ${bareMoved.length}`,
        ...bareMoved.map(id => `  ${id}: ${c[id] ?? '(absent)'} -> ${d[id] ?? '(absent)'}`),
        '',
        'v1 asks:',
        ...bareV1.pendingQuestions.map(q => `  ${q.gateId}${q.datumKey ? ` [datum ${q.datumKey}]` : ''}: ${q.prompt}`),
      ].join('\n');

      // eslint-disable-next-line no-console
      console.log('\n' + report + '\n' + report2 + '\n');
      expect(report.length).toBeGreaterThan(0);
    } finally {
      await pool.end();
    }
  }, 120_000);
});
