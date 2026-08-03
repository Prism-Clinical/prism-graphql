import { createSession, getSession } from '../../services/resolution/session-store';
import {
  createMultiPathwaySession,
  getMultiPathwaySession,
} from '../../services/resolution/multi-pathway-session-store';
import { makeEvaluationTemporalContext } from '../../services/resolution/temporal/evaluation-context';
import { createEmptyDependencyMap } from '../../services/resolution/types';

const TCTX = makeEvaluationTemporalContext({
  evaluationAsOf: '2026-07-30T12:00:00.000Z',
  encounterStart: '2026-07-30T09:00:00.000Z',
});

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
  it('createSession writes the temporal context as JSON', async () => {
    const { pool, calls } = fakePool([]);
    await createSession(pool as never, {
      pathwayId: 'p', pathwayVersion: '1', patientId: 'pt', providerId: 'pr',
      status: 'ACTIVE',
      initialPatientContext: {},
      resolutionState: new Map(),
      dependencyMap: createEmptyDependencyMap(),
      pendingQuestions: [], redFlags: [],
      totalNodesEvaluated: 0, traversalDurationMs: 1,
      temporalContext: TCTX,
    } as never);

    const insert = calls.find((c) => c.sql.includes('INSERT INTO pathway_resolution_sessions'))!;
    expect(insert.sql).toContain('temporal_context');
    expect(insert.params).toContain(JSON.stringify(TCTX));
  });

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

  // ── multi-pathway store ────────────────────────────────────────────
  //
  // These are NOT redundant with the createSession cases above: the two
  // stores are separate files with separate SQL. The multi-pathway INSERT
  // currently ends at $8 and gains a 9th placeholder, and its read path goes
  // through `rowToSession` rather than an inline literal. A mis-numbered
  // placeholder or a `rowToSession` that never maps the column would leave
  // every multi-pathway session silently clock-less — and nothing else in
  // this plan would catch it, because Task 6's resolver tests mock this
  // module out entirely.

  it('createMultiPathwaySession writes the temporal context as JSON', async () => {
    const { pool, calls } = fakePool([]);
    await createMultiPathwaySession(pool as never, {
      patientId: 'pt', providerId: 'pr',
      initialPatientContext: {},
      contributingSessionIds: [], contributingPathwayIds: [],
      // `emptyMergedCarePlan()` is private to multi-pathway-resolution.ts —
      // do not try to import it. The plan's contents are irrelevant here;
      // only the SQL and the parameter array are under test.
      mergedPlan: {} as never,
      temporalContext: TCTX,
    } as never);

    const insert = calls.find((c) => c.sql.includes('INSERT INTO multi_pathway_resolution_sessions'))!;
    expect(insert.sql).toContain('temporal_context');
    // Placeholder count must match the parameter array, or pg throws at
    // runtime — the defect a SQL-string-only assertion would miss.
    expect(insert.sql).toContain('$9::jsonb');
    expect(insert.params).toHaveLength(9);
    expect(insert.params[8]).toBe(JSON.stringify(TCTX));
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

  it('createSession refuses to persist a session with no clock', async () => {
    const { pool, calls } = fakePool([]);
    await expect(
      createSession(pool as never, {
        pathwayId: 'p', pathwayVersion: '1', patientId: 'pt', providerId: 'pr',
        status: 'ACTIVE',
        initialPatientContext: {},
        resolutionState: new Map(),
        dependencyMap: createEmptyDependencyMap(),
        pendingQuestions: [], redFlags: [],
        totalNodesEvaluated: 0, traversalDurationMs: 1,
        // temporalContext deliberately omitted
      } as never),
    ).rejects.toThrow(/temporalContext|evaluation clock/i);

    // It must fail BEFORE writing, not roll back after.
    expect(calls).toHaveLength(0);
  });

  it('createMultiPathwaySession refuses to persist a session with no clock', async () => {
    const { pool, calls } = fakePool([]);
    await expect(
      createMultiPathwaySession(pool as never, {
        patientId: 'pt', providerId: 'pr',
        initialPatientContext: {},
        contributingSessionIds: [], contributingPathwayIds: [],
        mergedPlan: {} as never,
        // temporalContext deliberately omitted
      } as never),
    ).rejects.toThrow(/temporalContext|evaluation clock/i);

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
