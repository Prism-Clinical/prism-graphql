jest.mock('../services/resolution/session-store', () => require('./fixtures/resolver-harness').sessionStoreMock());
jest.mock('../services/resolution/pipeline/load-env', () => require('./fixtures/resolver-harness').loadEnvMock());
jest.mock('../services/llm/llm-gate-client', () => ({
  ...jest.requireActual('../services/llm/llm-gate-client'),
  loadLLMGateConfig: () => ({ baseUrl: 'http://llm', apiKey: 'k', model: 'test-model', timeoutMs: 1000 }),
  evaluateGateWithLLM: jest.fn(),
}));

import { GraphQLError } from 'graphql';
import { evaluateGateWithLLM } from '../services/llm/llm-gate-client';
import { commitEvaluation } from '../services/resolution/pipeline/commit';
import { loadEvaluationEnv } from '../services/resolution/pipeline/load-env';
import { evaluateSession, newRequest } from '../services/resolution/pipeline/request';
import { inputsOf, insertSession } from '../services/resolution/session-store';
import { DefaultBehavior, GateType, SessionStatus } from '../services/resolution/types';
import { harness } from './fixtures/resolver-harness';
import { edge, makeEnv, makeInputs, node } from './fixtures/pipeline-env';

const env = makeEnv(
  [
    node('root', 'Pathway'), node('stage', 'Stage'),
    node('gate-llm', 'Gate', {
      gate_type: GateType.LLM_TEXT_ANALYSIS, default_behavior: DefaultBehavior.SKIP, prompt: 'Urgent?',
      input_attribute: 'freeformData.narrative', confidence_threshold: 0.75,
      branches: [{ name: 'urgent', description: 'same day' }, { name: 'routine', description: 'can wait', is_safe_default: true }],
    }),
    node('step', 'Step'), node('lab', 'LabTest'),
  ],
  [edge('root', 'stage'), edge('stage', 'gate-llm'), edge('gate-llm', 'step'), edge('step', 'lab')],
);
const verdict = { chosenBranch: 'urgent', confidence: 0.95, reasoning: 'r', rawResponse: {}, model: 'test-model', latencyMs: 1 };

/** A session whose narrative is `narrative`, stored as a start would store it. */
async function seed(narrative: string): Promise<string> {
  const pool = harness.pool();
  const { inputs, result, durationMs } = await evaluateSession(
    pool, newRequest(), makeInputs(env, { additionalContext: { freeformData: { narrative } } }), 'ROOT',
  );
  return insertSession(pool, { pathwayVersion: '1', patientId: 'p', providerId: 'pr', inputs, result, status: SessionStatus.ACTIVE, durationMs });
}

/** Change the narrative, which changes the observation key. */
const narrate = (narrative: string) => (s: Parameters<typeof inputsOf>[0]) => {
  const inputs = inputsOf(s);
  inputs.additionalContext = { ...inputs.additionalContext, freeformData: { narrative } };
  return { inputs, event: { eventType: 'context_update', triggerData: { addedContext: ['freeformData'] } } };
};

beforeEach(async () => {
  harness.reset();
  harness.addPathway('pw-test', env);
  (evaluateGateWithLLM as jest.Mock).mockReset().mockResolvedValue(verdict);
});

describe('commitEvaluation', () => {
  it('commits inputs, cache, event, used observations and audit rows under one revision', async () => {
    const id = await seed('mild cough');
    (evaluateGateWithLLM as jest.Mock).mockClear();

    const session = await commitEvaluation(harness.pool(), id, narrate('crushing chest pain'));

    expect(session.revision).toBe(1);
    expect(session.additionalContext).toEqual({ freeformData: { narrative: 'crushing chest pain' } });
    expect(session.resolutionState.get('gate-llm')!.status).toBe('INCLUDED');
    expect(session.observations.size).toBe(1);
    expect([...session.observations.values()][0]).toMatchObject({ gateId: 'gate-llm', chosenBranch: 'urgent' });
    expect(harness.tables.events).toEqual([expect.objectContaining({ sessionId: id, eventType: 'context_update' })]);
    expect(harness.tables.audits).toEqual([{ sessionId: id, gateId: 'gate-llm', errorMessage: null }]);
  });

  it('retries after losing a revision race and calls the LLM once across attempts (A1)', async () => {
    const id = await seed('mild cough');
    (evaluateGateWithLLM as jest.Mock).mockClear();
    (loadEvaluationEnv as jest.Mock).mockClear();
    harness.loseNextRaces(1);

    const session = await commitEvaluation(harness.pool(), id, narrate('crushing chest pain'));

    expect(loadEvaluationEnv).toHaveBeenCalledTimes(2);
    expect(evaluateGateWithLLM).toHaveBeenCalledTimes(1);
    expect(session.revision).toBe(2); // one bump by the "other writer", one by this commit
    expect(harness.tables.audits).toHaveLength(1);
  });

  it('calls the LLM again when the context changed between attempts', async () => {
    const id = await seed('mild cough');
    (evaluateGateWithLLM as jest.Mock).mockClear();
    let raced = false;
    harness.onBeforeWrite((row) => {
      if (raced) return;
      raced = true;
      row.revision += 1;
      row.additional_context = { freeformData: { narrative: 'syncope' } };
    });

    // The change reads the reloaded session, so attempt 2 evaluates the other writer's narrative.
    await commitEvaluation(harness.pool(), id, (s) => ({
      inputs: inputsOf(s), event: { eventType: 'context_update', triggerData: {} },
    }));

    expect(evaluateGateWithLLM).toHaveBeenCalledTimes(2);
    expect((evaluateGateWithLLM as jest.Mock).mock.calls.map((c) => c[0].narrative)).toEqual(['mild cough', 'syncope']);
  });

  it('throws CONFLICT after three lost races and still writes the audit rows', async () => {
    const id = await seed('mild cough');
    const before = structuredClone(harness.row(id));
    harness.onBeforeWrite((row) => { row.revision += 1; });

    await expect(commitEvaluation(harness.pool(), id, narrate('crushing chest pain')))
      .rejects.toMatchObject({ extensions: { code: 'CONFLICT' } });

    expect(harness.row(id).additional_context).toEqual(before.additional_context);
    expect(harness.tables.events).toEqual([]);
    expect(harness.tables.audits).toEqual([{ sessionId: id, gateId: 'gate-llm', errorMessage: null }]);
  });

  it('writes the audit rows of an earlier attempt when a later attempt finds the session completed (review P2)', async () => {
    const id = await seed('mild cough');
    harness.onBeforeWrite((row) => {
      if (row.status !== 'ACTIVE') return;
      row.revision += 1;
      row.status = 'COMPLETED'; // a concurrent generation claimed it
    });

    await expect(commitEvaluation(harness.pool(), id, narrate('crushing chest pain')))
      .rejects.toThrow('Cannot modify session with status "COMPLETED"');

    expect(harness.tables.audits).toEqual([{ sessionId: id, gateId: 'gate-llm', errorMessage: null }]);
  });

  it('writes the audit rows of an earlier attempt when a later attempt is rejected at the boundary (review P2)', async () => {
    const id = await seed('mild cough');
    harness.loseNextRaces(1);
    let attempts = 0;

    await expect(commitEvaluation(harness.pool(), id, (s) => {
      attempts += 1;
      if (attempts === 2) throw new GraphQLError('the node is gone', { extensions: { code: 'NOT_FOUND' } });
      return narrate('crushing chest pain')(s);
    })).rejects.toThrow('the node is gone');

    expect(harness.tables.audits).toEqual([{ sessionId: id, gateId: 'gate-llm', errorMessage: null }]);
  });

  it('a boundary error is not retried and writes nothing', async () => {
    const id = await seed('mild cough');
    (loadEvaluationEnv as jest.Mock).mockClear();

    await expect(commitEvaluation(harness.pool(), id, () => {
      throw new GraphQLError('bad answer', { extensions: { code: 'BAD_USER_INPUT' } });
    })).rejects.toThrow('bad answer');

    expect(loadEvaluationEnv).not.toHaveBeenCalled();
    expect(harness.row(id).revision).toBe(0);
  });

  it('refuses a session that is not ACTIVE or DEGRADED, before evaluating', async () => {
    const id = await seed('mild cough');
    harness.row(id).status = 'COMPLETED';
    await expect(commitEvaluation(harness.pool(), id, narrate('x'))).rejects.toThrow('Cannot modify session with status "COMPLETED"');
  });

  it('refuses an unknown session', async () => {
    await expect(commitEvaluation(harness.pool(), 'nope', narrate('x'))).rejects.toMatchObject({ extensions: { code: 'NOT_FOUND' } });
  });
});
