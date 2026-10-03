import { canonicalJson } from '../services/resolution/pipeline/canonical';
import { evaluate } from '../services/resolution/pipeline/evaluate';
import { liveObservations, observationKey, replayObservations } from '../services/resolution/pipeline/observations';
import { DefaultBehavior, GateProperties, GateType, NodeStatus } from '../services/resolution/types';
import { edge, makeEnv, makeInputs, node } from './fixtures/pipeline-env';

const llm = node('gate-llm', 'Gate', {
  gate_type: GateType.LLM_TEXT_ANALYSIS, default_behavior: DefaultBehavior.SKIP, prompt: 'Urgent?',
  input_attribute: 'freeformData.narrative', confidence_threshold: 0.75,
  branches: [{ name: 'urgent', description: 'same day' }, { name: 'routine', description: 'can wait', is_safe_default: true }],
});
const env = makeEnv(
  [node('root', 'Pathway'), node('stage', 'Stage'), llm, node('step', 'Step'), node('lab', 'LabTest')],
  [edge('root', 'stage'), edge('stage', 'gate-llm'), edge('gate-llm', 'step'), edge('step', 'lab')],
);
const withNarrative = (narrative: string) =>
  makeInputs(env, { initialPatientContext: { patientId: 'p', conditionCodes: [], medications: [], labResults: [], allergies: [], freeformData: { narrative } } });
const keyFor = (narrative: string) => observationKey(llm.properties as unknown as GateProperties, 'gate-llm', narrative, 'test-model');
const output = { chosenBranch: 'urgent', confidence: 0.95, reasoning: 'r', rawResponse: {}, model: 'test-model', latencyMs: 1 };

describe('A1 — observations (C1)', () => {
  it('replay: frozen inputs, env and observations give identical results', async () => {
    const key = keyFor('crushing chest pain');
    const inputs = { ...withNarrative('crushing chest pain'), observations: new Map([[key, { key, gateId: 'gate-llm', chosenBranch: 'urgent', confidence: 0.95, reasoning: 'r', model: 'test-model', acquiredAt: 't' }]]) };

    const a = await evaluate(inputs, env, replayObservations(inputs.observations, 'test-model'), 'ROOT');
    const b = await evaluate(inputs, env, replayObservations(inputs.observations, 'test-model'), 'ROOT');

    expect(canonicalJson(b)).toBe(canonicalJson(a));
    expect(b.resultHash).toBe(a.resultHash);
    expect(a.observationsUsed).toEqual([key]);
    expect(a.resolutionState.get('gate-llm')!.status).toBe(NodeStatus.INCLUDED);
    expect(a.pendingQuestions).toEqual([]);
  });

  it('UNAVAILABLE is never a clinical false: safe default, tentative, blocks readiness', async () => {
    const r = await evaluate(withNarrative('crushing chest pain'), env, replayObservations(new Map(), 'test-model'), 'ROOT');

    expect(r.resolutionState.get('gate-llm')!.status).toBe(NodeStatus.INCLUDED);
    expect(r.resolutionState.get('gate-llm')!.status).not.toBe(NodeStatus.GATED_OUT);
    expect(r.pendingQuestions[0]).toMatchObject({ gateId: 'gate-llm', tentative: true });
    expect(r.readiness.blockers).toContainEqual(expect.objectContaining({ scope: 'COMPLETENESS', type: 'PENDING_GATE', relatedNodeIds: ['gate-llm'] }));
  });

  it('a retried attempt reuses the request observation; changed context calls again', async () => {
    const client = jest.fn().mockResolvedValue(output);
    const request = new Map();
    await evaluate(withNarrative('crushing chest pain'), env, liveObservations(new Map(), request, client, 'test-model'), 'ROOT');
    await evaluate(withNarrative('crushing chest pain'), env, liveObservations(new Map(), request, client, 'test-model'), 'ROOT');
    expect(client).toHaveBeenCalledTimes(1);

    await evaluate(withNarrative('mild cough'), env, liveObservations(new Map(), request, client, 'test-model'), 'ROOT');
    expect(client).toHaveBeenCalledTimes(2);
  });

  it('refuses a session whose graph changed', async () => {
    await expect(evaluate({ ...withNarrative('x'), graphFingerprint: 'stale' }, env, replayObservations(new Map(), 'test-model'), 'ROOT'))
      .rejects.toMatchObject({ code: 'SESSION_GRAPH_CHANGED' });
  });
});
