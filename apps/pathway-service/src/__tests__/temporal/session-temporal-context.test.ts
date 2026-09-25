import { getSession, insertSession } from '../../services/resolution/session-store';
import {
  getMultiPathwaySession,
  insertRun,
} from '../../services/resolution/multi-pathway-session-store';
import { makeEvaluationTemporalContext } from '../../services/resolution/temporal/evaluation-context';
import { evaluate } from '../../services/resolution/pipeline/evaluate';
import { replayObservations } from '../../services/resolution/pipeline/observations';
import { SessionStatus } from '../../services/resolution/types';
import { makeEnv, makeInputs, node } from '../fixtures/pipeline-env';

const TCTX = makeEvaluationTemporalContext({
  evaluationAsOf: '2026-07-30T12:00:00.000Z',
  encounterStart: '2026-07-30T09:00:00.000Z',
  // Pinned rather than inherited from DEFAULT_TEMPORAL_POLICY_VERSION: this
  // suite asserts pre-kernel behaviour and must keep doing so now that the
  // default is `v1`.
  temporalPolicyVersion: 'legacy-v0',
});
const RUN_FIXTURE = {
  patientId: 'pt', providerId: 'pr', isPreview: false, initialPatientContext: {},
  additionalContext: {}, conflictResolutions: {},
  result: { mergedPlan: {}, safetyFindings: [], ddiWarnings: [], readiness: { ready: false, blockers: [] }, children: [], envFingerprint: 'e', resultHash: 'h' },
};

function fakePool(rows: Array<Record<string, unknown>>) {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const pool = {
    query: jest.fn(async (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
      return { rows: rows.shift() ? [rows[0]] : [{ id: 'session-1' }] };
    }),
  };
  return { pool, calls };
}

describe('session temporal_context persistence', () => {
  it('getSession hydrates the temporal context from the row', async () => {
    const pool = {
      query: jest.fn()
        .mockResolvedValueOnce({
          rows: [{
            id: 'session-1', pathway_id: 'p', pathway_version: '1',
            patient_id: 'pt', provider_id: 'pr', status: 'ACTIVE',
            resolution_state: {}, dependency_map: {},
            initial_patient_context: {}, additional_context: {},
            pending_questions: [], red_flags: [], gate_answers: {},
            total_nodes_evaluated: 0, traversal_duration_ms: 1,
            ddi_warnings: [], temporal_context: TCTX,
            created_at: new Date(), updated_at: new Date(),
          }],
        })
        .mockResolvedValueOnce({ rows: [] }),
    };

    const session = await getSession(pool as never, 'session-1');
    expect(session!.temporalContext).toEqual(TCTX);
    expect(session!.temporalContext!.evaluationAsOf).toBe('2026-07-30T12:00:00.000Z');
  });

  it('insertSession writes the temporal context as JSON', async () => {
    const { pool, calls } = fakePool([]);
    const env = makeEnv([node('root', 'Pathway')], []);
    const inputs = makeInputs(env, { temporalContext: TCTX });
    const result = await evaluate(inputs, env, replayObservations(new Map(), 'test-model'), 'ROOT');
    await insertSession(pool as never, {
      pathwayVersion: '1', patientId: 'pt', providerId: 'pr', inputs, result,
      status: SessionStatus.ACTIVE, durationMs: 1,
    });

    const insert = calls.find((c) => c.sql.includes('INSERT INTO pathway_resolution_sessions'))!;
    expect(insert.sql).toContain('temporal_context');
    expect(insert.params).toContain(JSON.stringify(TCTX));
  });

  // ── multi-pathway store ────────────────────────────────────────────
  //
  // These are NOT redundant with the insertSession cases above: the two
  // stores are separate files with separate SQL. The run INSERT is built
  // from a column map, and its read path goes through `runRowToSession`
  // rather than an inline literal. A mis-numbered placeholder or a
  // `runRowToSession` that never maps the column would leave
  // every multi-pathway session silently clock-less — and nothing else in
  // this plan would catch it, because Task 6's resolver tests mock this
  // module out entirely.

  it('insertRun writes the temporal context as JSON', async () => {
    const { pool, calls } = fakePool([]);
    await insertRun(pool as never, { ...RUN_FIXTURE, temporalContext: TCTX } as never);

    const insert = calls.find((c) => c.sql.includes('INSERT INTO multi_pathway_resolution_sessions'))!;
    expect(insert.sql).toContain('temporal_context');
    // Placeholder count must match the parameter array, or pg throws at runtime.
    expect(insert.sql).toContain(`$${insert.params.length})`);
    expect(insert.params).toContain(JSON.stringify(TCTX));
  });

  it('getMultiPathwaySession hydrates the temporal context via rowToSession', async () => {
    const pool = {
      query: jest.fn().mockResolvedValue({
        rows: [{
          id: 'mp-1', patient_id: 'pt', provider_id: 'pr', status: 'ACTIVE',
          is_preview: false, initial_patient_context: {},
          contributing_session_ids: [], contributing_pathway_ids: [],
          merged_plan: {}, conflict_resolutions: {}, ddi_warnings: [],
          temporal_context: TCTX,
          created_at: new Date(), updated_at: new Date(),
        }],
      }),
    };

    const session = await getMultiPathwaySession(pool as never, 'mp-1');
    expect(session!.temporalContext).toEqual(TCTX);
  });

  it('getMultiPathwaySession leaves temporalContext undefined for a pre-migration row', async () => {
    const pool = {
      query: jest.fn().mockResolvedValue({
        rows: [{
          id: 'mp-1', patient_id: 'pt', provider_id: 'pr', status: 'ACTIVE',
          is_preview: false, initial_patient_context: {},
          contributing_session_ids: [], contributing_pathway_ids: [],
          merged_plan: {}, conflict_resolutions: {}, ddi_warnings: [],
          temporal_context: null,
          created_at: new Date(), updated_at: new Date(),
        }],
      }),
    };

    const session = await getMultiPathwaySession(pool as never, 'mp-1');
    expect(session!.temporalContext).toBeUndefined();
  });

  // ── the type is not the guard ──────────────────────────────────────
  //
  // Both creation parameters are declared required, but tsconfig excludes
  // src/__tests__ and types are erased at runtime, so nothing stops an
  // untyped caller from omitting the clock — and the old `? ... : null`
  // serialization turned that omission into a NULL column, i.e. a brand new
  // session that is already non-retraversable. Persisting must fail loudly
  // instead: a clock-less NEW session is always a bug, and the only rows
  // legitimately holding NULL predate migration 063.

  it('insertSession refuses to persist a session with no clock', async () => {
    const { pool, calls } = fakePool([]);
    const env = makeEnv([node('root', 'Pathway')], []);
    const inputs = makeInputs(env);
    const result = await evaluate(inputs, env, replayObservations(new Map(), 'test-model'), 'ROOT');
    await expect(
      insertSession(pool as never, {
        pathwayVersion: '1', patientId: 'pt', providerId: 'pr', result,
        inputs: { ...inputs, temporalContext: undefined as never }, // deliberately clock-less
        status: SessionStatus.ACTIVE, durationMs: 1,
      }),
    ).rejects.toThrow(/temporalContext|evaluation clock/i);

    // It must fail BEFORE writing, not roll back after.
    expect(calls).toHaveLength(0);
  });

  it('insertRun refuses to persist a run with no clock', async () => {
    const { pool, calls } = fakePool([]);
    await expect(insertRun(pool as never, { ...RUN_FIXTURE } as never)).rejects.toThrow(/temporalContext/);
    // It must fail BEFORE writing, not roll back after.
    expect(calls).toHaveLength(0);
  });

  it('getSession leaves temporalContext undefined for a pre-migration row', async () => {
    const pool = {
      query: jest.fn()
        .mockResolvedValueOnce({
          rows: [{
            id: 'session-1', pathway_id: 'p', pathway_version: '1',
            patient_id: 'pt', provider_id: 'pr', status: 'ACTIVE',
            resolution_state: {}, dependency_map: {},
            initial_patient_context: {}, additional_context: {},
            pending_questions: [], red_flags: [], gate_answers: {},
            total_nodes_evaluated: 0, traversal_duration_ms: 1,
            ddi_warnings: [], temporal_context: null,
            created_at: new Date(), updated_at: new Date(),
          }],
        })
        .mockResolvedValueOnce({ rows: [] }),
    };

    const session = await getSession(pool as never, 'session-1');
    expect(session!.temporalContext).toBeUndefined();
  });
});
