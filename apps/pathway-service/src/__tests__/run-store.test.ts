import {
  insertRun,
  insertRunColumns,
  runRowToSession,
  setContributingSessions,
  writeRunEvaluation,
  writeRunLifecycle,
} from '../services/resolution/multi-pathway-session-store';
import { insertSession, writeChildEvaluation, writeChildrenLifecycle } from '../services/resolution/session-store';
import { evaluate } from '../services/resolution/pipeline/evaluate';
import { replayObservations } from '../services/resolution/pipeline/observations';
import { SessionStatus } from '../services/resolution/types';
import { edge, makeEnv, makeInputs, node } from './fixtures/pipeline-env';

const EMPTY_PLAN = {
  sourcePathwayIds: [], medications: [], labs: [], imaging: [], procedures: [], guidance: [],
  schedules: [], qualityMetrics: [], suppressed: [], conflicts: [], catchUpItems: [], evidenceTrail: [], dataGapHints: [],
};
const RESULT = {
  mergedPlan: EMPTY_PLAN, safetyFindings: [], ddiWarnings: [],
  readiness: { ready: false, blockers: [{ scope: 'OUTPUT', type: 'EMPTY_PLAN', description: 'empty', relatedNodeIds: [] }] },
  children: [], envFingerprint: 'env-run', resultHash: 'hash-run',
};
const ALLERGY = { allergies: [{ code: '91936005', system: 'SNOMED' }] };
const env = makeEnv([node('root', 'Pathway'), node('step', 'Step')], [edge('root', 'step')]);
const inputs = makeInputs(env);
const NEW_RUN = {
  patientId: 'pt', providerId: 'pr', isPreview: true,
  initialPatientContext: inputs.initialPatientContext, temporalContext: inputs.temporalContext,
  additionalContext: ALLERGY,
  conflictResolutions: { beta_blocker: { kind: 'REJECT_BOTH', resolvedBy: 'pr', resolvedAt: 't' } },
  result: RESULT,
};
const contribution = () => evaluate(inputs, env, replayObservations(new Map(), 'test-model'), 'CONTRIBUTION');

function fakeDb(rowCount = 1) {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  return {
    calls,
    query: jest.fn(async (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
      return { rows: [{ id: 'row-1' }], rowCount };
    }),
  };
}

describe('run store (plan 04)', () => {
  it('insertRun writes identity, clock, parent inputs and the composition cache in one row', async () => {
    const db = fakeDb();
    await expect(insertRun(db as never, NEW_RUN as never)).resolves.toBe('row-1');
    const { sql, params } = db.calls[0];
    expect(sql).toMatch(/^INSERT INTO multi_pathway_resolution_sessions \(/);
    for (const col of ['is_preview', 'temporal_context', 'additional_context', 'conflict_resolutions',
      'merged_plan', 'ddi_warnings', 'readiness', 'result_hash', 'env_fingerprint']) {
      expect(sql).toContain(col);
    }
    // Placeholder count must equal the parameter array, or pg throws at runtime.
    expect(sql).toContain(`$${params.length})`);
    expect(sql).not.toContain(`$${params.length + 1}`);
  });

  it('insertRun refuses a run with no clock', async () => {
    await expect(insertRun(fakeDb() as never, { ...NEW_RUN, temporalContext: undefined } as never))
      .rejects.toThrow(/temporalContext/);
  });

  it('writeRunEvaluation is a compare-and-set on the run revision and an ACTIVE run (D6)', async () => {
    const db = fakeDb(1);
    const args = { runId: 'run-1', expectedRevision: 2, additionalContext: {}, conflictResolutions: {}, result: RESULT, status: 'ACTIVE' };
    await expect(writeRunEvaluation(db as never, args as never)).resolves.toBe(true);
    const { sql, params } = db.calls[0];
    expect(sql).toContain('revision = revision + 1');
    expect(sql).toMatch(/WHERE id = \$\d+ AND revision = \$\d+ AND status = 'ACTIVE'/);
    expect(params.slice(-2)).toEqual(['run-1', 2]);

    await expect(writeRunEvaluation(fakeDb(0) as never, args as never)).resolves.toBe(false);
    await expect(writeRunLifecycle(fakeDb(0) as never, { runId: 'run-1', expectedRevision: 2, status: 'ABANDONED' }))
      .resolves.toBe(false);
  });

  it('runRowToSession round-trips the run inputs and cache (the JSONB column shapes)', () => {
    const row = {
      ...JSON.parse(JSON.stringify(insertRunColumns(NEW_RUN as never))),
      id: 'run-1', revision: 4, contributing_session_ids: ['c1'], contributing_pathway_ids: ['p1'],
      care_plan_id: null, created_at: new Date(), updated_at: new Date(),
    };
    const run = runRowToSession(row);
    expect(run).toMatchObject({
      id: 'run-1', revision: 4, status: 'ACTIVE', isPreview: true, resultHash: 'hash-run', envFingerprint: 'env-run',
      additionalContext: ALLERGY, conflictResolutions: NEW_RUN.conflictResolutions, contributingSessionIds: ['c1'],
    });
    expect(run.readiness.blockers[0].type).toBe('EMPTY_PLAN');
    expect(run.temporalContext).toEqual(JSON.parse(JSON.stringify(inputs.temporalContext)));
  });

  it('setContributingSessions writes both arrays as uuid[]', async () => {
    const db = fakeDb();
    await setContributingSessions(db as never, 'run-1', ['c1', 'c2'], ['p1', 'p2']);
    expect(db.calls[0].sql).toMatch(/contributing_session_ids = \$2::uuid\[\], contributing_pathway_ids = \$3::uuid\[\]/);
    expect(db.calls[0].params).toEqual(['run-1', ['c1', 'c2'], ['p1', 'p2']]);
  });

  it('writeChildEvaluation writes a CHILD only, never a fact onto it, and checks no child revision (D5, D6)', async () => {
    const result = await contribution();
    const db = fakeDb(1);
    await writeChildEvaluation(db as never, {
      sessionId: 'c1', inputs: { ...inputs, additionalContext: ALLERGY }, result, status: SessionStatus.ACTIVE, durationMs: 1,
    });
    const { sql, params } = db.calls[0];
    expect(sql).toContain('AND parent_session_id IS NOT NULL');
    expect(sql).not.toMatch(/revision = \$/); // the parent's revision is the lock
    expect(params).not.toContain(JSON.stringify(ALLERGY));

    await expect(writeChildEvaluation(fakeDb(0) as never, {
      sessionId: 'lone', inputs, result, status: SessionStatus.ACTIVE, durationMs: 1,
    })).rejects.toThrow(/not the child of a run/);
  });

  it('writeChildrenLifecycle moves every child of the run', async () => {
    const db = fakeDb();
    await writeChildrenLifecycle(db as never, 'run-1', SessionStatus.COMPLETED, 'cp-1');
    expect(db.calls[0].sql).toContain('WHERE parent_session_id = $1');
    expect(db.calls[0].params).toEqual(['run-1', 'COMPLETED', 'cp-1']);
  });

  it('insertSession refuses a child that carries patient facts (D5)', async () => {
    await expect(insertSession(fakeDb() as never, {
      pathwayVersion: '1', patientId: 'pt', providerId: 'pr', inputs: { ...inputs, additionalContext: ALLERGY },
      result: await contribution(), status: SessionStatus.ACTIVE, durationMs: 1, parentSessionId: 'run-1',
    })).rejects.toThrow(/holds no patient facts/);
  });
});
