import {
  inputsOf,
  insertColumns,
  insertSession,
  rowToSession,
  statusChangesBetween,
  writeEvaluation,
  writeLifecycleStatus,
} from '../services/resolution/session-store';
import { evaluate } from '../services/resolution/pipeline/evaluate';
import { replayObservations } from '../services/resolution/pipeline/observations';
import { NodeResult, NodeStatus, OverrideAction, SessionStatus } from '../services/resolution/types';
import { edge, makeEnv, makeInputs, node } from './fixtures/pipeline-env';

const env = makeEnv(
  [node('root', 'Pathway'), node('step', 'Step'), node('med', 'Medication', { name: 'Amoxicillin', score: 0.1 })],
  [edge('root', 'step'), edge('step', 'med')],
);
const inputs = makeInputs(env, {
  additionalContext: { conditionCodes: [{ code: 'I10', system: 'ICD-10' }] },
  gateAnswers: new Map([['g', { booleanValue: true }]]),
  providerOverrides: new Map([['med', { action: OverrideAction.INCLUDE, originalStatus: NodeStatus.EXCLUDED, originalConfidence: 0.1 }]]),
});

async function result() {
  return evaluate(inputs, env, replayObservations(new Map(), 'test-model'), 'ROOT');
}

function fakeDb(rowCount = 1) {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  return {
    calls,
    query: jest.fn(async (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
      return { rows: [{ id: 'session-9' }], rowCount };
    }),
  };
}

describe('session store for evaluation inputs', () => {
  it('insertSession writes identity, inputs and the evaluation cache in one row', async () => {
    const db = fakeDb();
    const id = await insertSession(db as never, {
      pathwayVersion: '1', patientId: 'pt', providerId: 'pr', inputs, result: await result(),
      status: SessionStatus.ACTIVE, durationMs: 12.6,
    });

    expect(id).toBe('session-9');
    const { sql, params } = db.calls[0];
    expect(sql).toMatch(/^INSERT INTO pathway_resolution_sessions \(/);
    for (const col of ['graph_fingerprint', 'temporal_context', 'provider_overrides', 'observations',
      'readiness', 'result_hash', 'env_fingerprint', 'gate_context_fields', 'catch_up_items']) {
      expect(sql).toContain(col);
    }
    // Placeholder count must equal the parameter array, or pg throws at runtime.
    expect(sql).toContain(`$${params.length})`);
    expect(sql).not.toContain(`$${params.length + 1}`);
  });

  it('insertSession refuses a session with no clock', async () => {
    await expect(insertSession(fakeDb() as never, {
      pathwayVersion: '1', patientId: 'pt', providerId: 'pr',
      inputs: { ...inputs, temporalContext: undefined as never }, result: await result(),
      status: SessionStatus.ACTIVE, durationMs: 1,
    })).rejects.toThrow(/temporalContext/);
  });

  it('writeEvaluation is a compare-and-set on revision and mutable status', async () => {
    const db = fakeDb(1);
    const r = await result();
    await expect(writeEvaluation(db as never, {
      sessionId: 's', expectedRevision: 4, inputs, result: r, status: SessionStatus.ACTIVE, durationMs: 1,
    })).resolves.toBe(true);
    const { sql, params } = db.calls[0];
    expect(sql).toContain('revision = revision + 1');
    expect(sql).toMatch(/WHERE id = \$\d+ AND revision = \$\d+ AND status IN \('ACTIVE', 'DEGRADED'\)/);
    expect(params.slice(-2)).toEqual(['s', 4]);

    await expect(writeEvaluation(fakeDb(0) as never, {
      sessionId: 's', expectedRevision: 4, inputs, result: r, status: SessionStatus.ACTIVE, durationMs: 1,
    })).resolves.toBe(false);
    await expect(writeLifecycleStatus(fakeDb(0) as never, { sessionId: 's', expectedRevision: 4, status: SessionStatus.ABANDONED }))
      .resolves.toBe(false);
  });

  it('rowToSession round-trips the stored inputs (the JSONB column shapes)', async () => {
    const r = await result();
    const cols = insertColumns({
      pathwayVersion: '1', patientId: 'pt', providerId: 'pr', inputs, result: r,
      status: SessionStatus.ACTIVE, durationMs: 1,
    });
    // pg returns JSONB parsed, and Maps do not survive JSON — exactly what a round trip does.
    const row = { ...JSON.parse(JSON.stringify(cols)), id: 's', revision: 3, created_at: new Date(), updated_at: new Date() };
    const session = rowToSession(row, []);

    expect(session.revision).toBe(3);
    expect(session.resultHash).toBe(r.resultHash);
    expect(session.readiness).toEqual(JSON.parse(JSON.stringify(r.readiness)));
    expect(session.resolutionState.get('med')!.status).toBe(NodeStatus.INCLUDED);
    const back = inputsOf(session);
    expect(back.gateAnswers).toEqual(inputs.gateAnswers);
    expect(back.providerOverrides).toEqual(inputs.providerOverrides);
    expect(back.additionalContext).toEqual(inputs.additionalContext);
    expect(back.graphFingerprint).toBe(inputs.graphFingerprint);
    expect(back.revision).toBe(3);
  });

  it('inputsOf returns fresh maps, so a mutation cannot edit the loaded session', async () => {
    const session = rowToSession({
      ...JSON.parse(JSON.stringify(insertColumns({
        pathwayVersion: '1', patientId: 'pt', providerId: 'pr', inputs, result: await result(),
        status: SessionStatus.ACTIVE, durationMs: 1,
      }))), id: 's', revision: 0,
    }, []);
    inputsOf(session).gateAnswers.set('other', { booleanValue: false });
    expect(session.gateAnswers.has('other')).toBe(false);
  });

  it('statusChangesBetween lists changed nodes in nodeId order', () => {
    const n = (status: NodeStatus) => ({ status } as NodeResult);
    const prev = new Map([['b', n(NodeStatus.INCLUDED)], ['a', n(NodeStatus.EXCLUDED)], ['c', n(NodeStatus.INCLUDED)]]);
    const next = new Map([['c', n(NodeStatus.INCLUDED)], ['a', n(NodeStatus.INCLUDED)], ['d', n(NodeStatus.GATED_OUT)]]);
    expect(statusChangesBetween(prev, next)).toEqual([
      { nodeId: 'a', from: 'EXCLUDED', to: 'INCLUDED' },
      { nodeId: 'b', from: 'INCLUDED', to: 'ABSENT' },
      { nodeId: 'd', from: 'ABSENT', to: 'GATED_OUT' },
    ]);
  });
});
