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
 * Two passes. "current references" times the copy as it is: live's safety
 * reference tables are empty, so its pair checks are empty lookups. "fixture
 * references" seeds rules that match the pathway's normalised drugs, times the
 * same three mutations, and asserts each kind of finding was stored — so an
 * empty reference cannot pass as exercised safety coverage (review 2026-09-24).
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

/**
 * Rules that fire on chronic-htn's normalised drugs for PATIENT. Scratch-only
 * test data, not clinical content. Each gives one kind of stored finding.
 */
const FIXTURE_SQL = [
  // The patient's Labetalol, keyed as the pipeline keys it, so patient-scope pairs can fire.
  `INSERT INTO medication_normalization_cache (input_text, input_system, input_code, ingredient_rxcui, ingredient_name, atc_classes)
     VALUES ('labetalol', 'RxNorm', '6185', '6185', 'labetalol', '{C07AG}') ON CONFLICT DO NOTHING`,
  // hydralazine × patient labetalol → PATIENT DDI_SEVERE (suppress)
  `INSERT INTO drug_interactions (rxcui_a, rxcui_b, severity, mechanism, source) VALUES ('5470', '6185', 'SEVERE', 'gate fixture', 'clinician_review')`,
  // aspirin × enalapril → SET DDI_SEVERE (suppress)
  `INSERT INTO drug_interactions (rxcui_a, rxcui_b, severity, mechanism, source) VALUES ('1191', '3827', 'SEVERE', 'gate fixture', 'clinician_review')`,
  // methyldopa (C02AB) × nifedipine (C08CA) → SET DDI_MODERATE (warn), by class rule
  `INSERT INTO drug_class_interactions (atc_class_a, atc_class_b, severity, mechanism, source) VALUES ('C02AB', 'C08CA', 'MODERATE', 'gate fixture', 'clinician_review')`,
  // the patient's penicillin allergy → magnesium sulfate (A12CC) → PATIENT ALLERGY (suppress)
  `INSERT INTO allergy_class_mappings (snomed_code, snomed_display, atc_class, notes) VALUES ('91936005', 'Allergy to penicillin', 'A12CC', 'gate fixture')`,
];
const FIXTURE_CLEANUP = [
  `DELETE FROM drug_interactions WHERE mechanism = 'gate fixture'`,
  `DELETE FROM drug_class_interactions WHERE mechanism = 'gate fixture'`,
  `DELETE FROM allergy_class_mappings WHERE notes = 'gate fixture'`,
];
/** scope|category|source kind — one per rule above. */
const EXPECTED_KINDS = [
  'PATIENT|DDI_SEVERE|PATIENT_MEDICATION',
  'PATIENT|ALLERGY|PATIENT_ALLERGY',
  'SET|DDI_SEVERE|OTHER_RECOMMENDATION',
  'SET|DDI_MODERATE|OTHER_RECOMMENDATION',
];
type StoredRow = { resolution_state: Record<string, { disposition?: { withheldBy?: string; findingIds?: string[] } }> | null; ddi_warnings: Array<{ scope: string; category: string; source: { kind: string } }> | null };
/** The finding kinds a stored row carries: safety withholdings in its state, and its warnings. */
const kindsOf = (rows: StoredRow[]): string[] => {
  const kinds = new Set<string>();
  for (const r of rows) {
    for (const n of Object.values(r.resolution_state ?? {})) {
      if (n.disposition?.withheldBy !== 'safety') continue;
      for (const id of n.disposition.findingIds ?? []) kinds.add(id.split('|').slice(0, 3).join('|'));
    }
    for (const w of r.ddi_warnings ?? []) kinds.add(`${w.scope}|${w.category}|${w.source.kind}`);
  }
  return [...kinds].sort();
};

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

  /**
   * A 5-child run stored exactly as startMultiPathwayResolution stores one. Untimed.
   * `includeMeds`: as the stage benchmark does, the provider includes every
   * Medication node and every conflict is decided ACCEPT_BOTH, so the drugs
   * reach patient and pair safety (fixture pass).
   */
  async function newRun(includeMeds = false) {
    const temporalContext = makeEvaluationTemporalContext({ evaluationAsOf: AS_OF, temporalPolicyVersion: 'v1' });
    const evaluateWith = (overrides: Map<string, unknown>[], conflictResolutions: Record<string, unknown>) =>
      evaluateRun(pool, newRunRequest(), {
        initialPatientContext: PATIENT, additionalContext: {}, temporalContext, conflictResolutions: conflictResolutions as never,
        children: RUN.map((pathwayId, i) => ({
          sessionId: '', pathwayId,
          inputs: { pathwayId, graphFingerprint: '', gateAnswers: new Map(), providerOverrides: (overrides[i] ?? new Map()) as never, observations: new Map(), revision: 0 },
        })),
      }, { pinGraphs: true });
    let ev = await evaluateWith([], {});
    let conflictResolutions: Record<string, unknown> = {};
    if (includeMeds) {
      const overrides = ev.result.children.map((c) => new Map([...c.result.resolutionState.values()]
        .filter((n) => n.nodeType === 'Medication')
        .map((n) => [n.nodeId, { action: OverrideAction.INCLUDE, originalStatus: n.status, originalConfidence: 0 }])));
      ev = await evaluateWith(overrides, {});
      conflictResolutions = Object.fromEntries(ev.result.mergedPlan.conflicts.map((c) =>
        [c.conflictId, { kind: 'ACCEPT_BOTH', resolvedBy: 'mutation-gate', resolvedAt: AS_OF }]));
      ev = await evaluateWith(overrides, conflictResolutions);
    }
    if (ev.inputs.children.length !== RUN.length) throw new Error(`run has ${ev.inputs.children.length} children, expected ${RUN.length}`);
    const providerId = randomUUID();
    return inTransaction(pool, async (db) => {
      const runId = await insertRun(db, {
        patientId: PATIENT.patientId, providerId, isPreview: true, initialPatientContext: PATIENT,
        temporalContext, additionalContext: {}, conflictResolutions: conflictResolutions as never, result: ev.result,
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

  /**
   * The three timed mutations. `stored` runs after each with the rows the mutation
   * last wrote (the fixture pass asserts on them; the current pass has none).
   */
  function mutations(pass: string, stored?: (rows: StoredRow[]) => void, includeMeds = false) {
    it(`${pass}: a single-pathway mutation: p95 < 2 s`, async () => {
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
      if (includeMeds) {
        for (const n of [...started.includedNodes, ...started.excludedNodes].filter((x) => x.nodeType === 'Medication')) {
          await resolutionMutations.overrideNode(null, { sessionId: started.id, nodeId: n.nodeId, action: OverrideAction.INCLUDE }, ctx());
        }
      }

      const times = await timed((i) => resolutionMutations.overrideNode(null, {
        sessionId: started.id, nodeId: med.nodeId, action: i % 2 === 0 ? OverrideAction.INCLUDE : OverrideAction.EXCLUDE,
      }, ctx()));
      // eslint-disable-next-line no-console
      console.log(line(`${pass}: single overrideNode (${SAMPLES} samples)`, times));
      stored?.((await pool.query('SELECT resolution_state, ddi_warnings FROM pathway_resolution_sessions WHERE id = $1', [started.id])).rows);
      expect(pct(times, 0.95)).toBeLessThan(BUDGET_P95_MS.single);
    }, 900_000);

    /** chronic-htn's child row with its run's warnings: where a run stores what the fixture rules produce. */
    const runRows = async (childId: string): Promise<StoredRow[]> => (await pool.query(
      `SELECT s.resolution_state, r.ddi_warnings FROM pathway_resolution_sessions s
         JOIN multi_pathway_resolution_sessions r ON r.id = s.parent_session_id WHERE s.id = $1`, [childId])).rows;

    it(`${pass}: an answer on a 5-child run: p95 < 5 s`, async () => {
      const run = await newRun(includeMeds);
      const at = run.pending.findIndex((qs) => qs.length > 0);
      if (at < 0) throw new Error('no child of the run has a pending question: an answer cannot be timed');
      const q = run.pending[at][0];

      const times = await timed((i) => resolutionMutations.answerPendingDecision(null, {
        sessionId: run.childIds[at], nodeId: q.gateId, answer: answerFor(q, i) as never,
      }, ctx()));
      // eslint-disable-next-line no-console
      console.log(line(`${pass}: run answer ${q.gateId} (${q.answerType}, child ${at})`, times));
      stored?.(await runRows(run.childIds[0]));
      expect(pct(times, 0.95)).toBeLessThan(BUDGET_P95_MS.run);
    }, 900_000);

    it(`${pass}: a fact on a 5-child run: p95 < 5 s`, async () => {
      const run = await newRun(includeMeds);
      const times = await timed((i) => resolutionMutations.addPatientContext(null, {
        sessionId: run.childIds[0], additionalContext: { vitalSigns: { heart_rate: 60 + i } },
      }, ctx()));
      // eslint-disable-next-line no-console
      console.log(line(`${pass}: run fact (vitalSigns.heart_rate)`, times));
      stored?.(await runRows(run.childIds[0]));
      expect(pct(times, 0.95)).toBeLessThan(BUDGET_P95_MS.run);
    }, 900_000);
  }

  // Live's reference tables as they are (empty on 2026-09-23): the current-data baseline.
  describe('current references', () => mutations('current'));

  // Populated references: the safety rules must fire and be stored, or the timing is not DDI coverage.
  describe('fixture references', () => {
    beforeAll(async () => {
      for (const q of FIXTURE_SQL) await pool.query(q);
    });
    afterAll(async () => {
      for (const q of FIXTURE_CLEANUP) await pool.query(q);
    });
    mutations('fixture', (rows) => {
      // eslint-disable-next-line no-console
      console.log(`  stored finding kinds: ${kindsOf(rows).join(', ') || 'none'}`);
      expect(kindsOf(rows)).toEqual(expect.arrayContaining(EXPECTED_KINDS));
    }, true);
  });
});
