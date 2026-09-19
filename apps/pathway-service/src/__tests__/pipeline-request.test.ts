jest.mock('../services/llm/llm-gate-client', () => ({
  ...jest.requireActual('../services/llm/llm-gate-client'),
  evaluateGateWithLLM: jest.fn(),
  loadLLMGateConfig: jest.fn(() => null),
}));
jest.mock('../services/resolution/pipeline/load-env', () => ({
  ...jest.requireActual('../services/resolution/pipeline/load-env'),
  loadEvaluationEnv: jest.fn(),
}));
jest.mock('../services/medications/normalizer', () => ({
  ...jest.requireActual('../services/medications/normalizer'),
  prewarmMedications: jest.fn(),
}));

import { evaluateGateWithLLM } from '../services/llm/llm-gate-client';
import { prewarmMedications } from '../services/medications/normalizer';
import { normalizedKey } from '../services/medications/safety-reference';
import { loadEvaluationEnv } from '../services/resolution/pipeline/load-env';
import { auditingLlmClient } from '../services/resolution/pipeline/llm-audit';
import { evaluateSession, newRequest, persistedObservations, prewarmInBackground } from '../services/resolution/pipeline/request';
import { DefaultBehavior, GateProperties, GateType } from '../services/resolution/types';
import { edge, makeEnv, makeInputs, node } from './fixtures/pipeline-env';

const CONFIG = { baseUrl: 'http://llm', apiKey: 'k', model: 'm1', timeoutMs: 1000 };
const gate = {
  title: 'Urgency', gate_type: GateType.LLM_TEXT_ANALYSIS, default_behavior: DefaultBehavior.SKIP,
  prompt: 'Urgent?', input_attribute: 'freeformData.narrative', confidence_threshold: 0.75,
  branches: [{ name: 'urgent', description: 'same day' }],
} as GateProperties;
const input = { prompt: 'Urgent?', narrative: 'chest pain', branches: [{ name: 'urgent', description: 'same day' }] };

describe('auditingLlmClient', () => {
  it('records one audit row per real call, success and failure', async () => {
    const sink: unknown[] = [];
    (evaluateGateWithLLM as jest.Mock)
      .mockResolvedValueOnce({ chosenBranch: 'urgent', confidence: 0.6, reasoning: 'r', rawResponse: { x: 1 }, model: 'm1', latencyMs: 7 })
      .mockRejectedValueOnce(new Error('timeout'));
    const client = auditingLlmClient(CONFIG, 'pw', sink as never)!;

    await client(input, { gateId: 'g', gate });
    await expect(client(input, { gateId: 'g', gate })).rejects.toThrow('timeout');

    expect(sink).toEqual([
      expect.objectContaining({ gateId: 'g', pathwayId: 'pw', inputText: 'chest pain', inputAttribute: 'freeformData.narrative',
        chosenBranch: 'urgent', confidence: 0.6, tentative: true, errorMessage: null, latencyMs: 7 }),
      expect.objectContaining({ gateId: 'g', model: 'm1', chosenBranch: null, tentative: true, errorMessage: 'timeout' }),
    ]);
  });

  it('marks a confident verdict as not tentative', async () => {
    const sink: Array<{ tentative: boolean }> = [];
    (evaluateGateWithLLM as jest.Mock).mockResolvedValueOnce({ chosenBranch: 'urgent', confidence: 0.9, reasoning: 'r', rawResponse: {}, model: 'm1', latencyMs: 1 });
    await auditingLlmClient(CONFIG, 'pw', sink as never)!(input, { gateId: 'g', gate });
    expect(sink[0].tentative).toBe(false);
  });

  it('is null when no LLM is configured', () => {
    expect(auditingLlmClient(null, 'pw', [])).toBeNull();
  });
});

describe('persistedObservations', () => {
  it('keeps the session observations and adds only the request observations the result used', () => {
    const obs = (key: string) => ({ key, gateId: 'g', chosenBranch: 'b', confidence: 1, reasoning: '', model: 'm', acquiredAt: 't' });
    const request = newRequest();
    request.requestObservations.set('used', obs('used'));
    request.requestObservations.set('unused', obs('unused'));
    const out = persistedObservations(
      { observations: new Map([['old', obs('old')]]) } as never,
      request,
      { observationsUsed: ['old', 'used'] } as never,
    );
    expect([...out.keys()].sort()).toEqual(['old', 'used']);
  });
});

describe('evaluateSession', () => {
  const env = makeEnv([node('root', 'Pathway'), node('step', 'Step')], [edge('root', 'step')]);
  beforeEach(() => (loadEvaluationEnv as jest.Mock).mockReset().mockResolvedValue(env));

  it('pins the graph fingerprint only when starting', async () => {
    const inputs = { ...makeInputs(env), graphFingerprint: '' };
    const started = await evaluateSession({} as never, newRequest(), inputs, 'ROOT', { pinGraph: true });
    expect(started.inputs.graphFingerprint).toBe(env.graphFingerprint);
    expect(started.result.resolutionState.get('step')).toBeDefined();

    await expect(evaluateSession({} as never, newRequest(), inputs, 'ROOT'))
      .rejects.toMatchObject({ extensions: { code: 'SESSION_GRAPH_CHANGED' } });
  });

  it('loads the snapshot for the effective patient: initial context plus additions', async () => {
    const inputs = makeInputs(env, { additionalContext: { medications: [{ code: '1', system: 'RxNorm', display: 'Warfarin' }] } });
    await evaluateSession({} as never, newRequest(), inputs, 'ROOT');
    const universe = (loadEvaluationEnv as jest.Mock).mock.calls.at(-1)![2];
    expect(universe.patient.medications).toEqual([expect.objectContaining({ display: 'Warfarin' })]);
  });
});

describe('prewarmInBackground', () => {
  it('starts a pre-warm without awaiting it and swallows its failure', async () => {
    let settle!: (v: unknown) => void;
    (prewarmMedications as jest.Mock).mockReturnValueOnce(new Promise((r) => { settle = r; }));
    expect(prewarmInBackground({} as never, [{ text: 'Tinidazole' }])).toBeUndefined();
    expect(prewarmMedications).toHaveBeenCalledWith({}, [{ text: 'Tinidazole' }]);
    settle({ succeeded: 1, failed: 0 });

    (prewarmMedications as jest.Mock).mockRejectedValueOnce(new Error('rxnav down'));
    prewarmInBackground({} as never, [{ text: 'X' }]);
    // An unhandled rejection here would fail the run.
    await new Promise((r) => setImmediate(r));
  });

  it('pre-warms a coded patient medication under the key evaluation looks it up by (review P1)', async () => {
    const coded = { text: 'Warfarin', system: 'RxNorm', code: '11289' };
    (prewarmMedications as jest.Mock).mockClear().mockResolvedValue({ succeeded: 1, failed: 0 });
    (loadEvaluationEnv as jest.Mock).mockResolvedValue({
      ...makeEnv([node('root', 'Pathway')], []), unnormalized: [coded],
    });
    const env = makeEnv([node('root', 'Pathway')], []);
    await evaluateSession({} as never, newRequest(), makeInputs(env), 'ROOT');

    const [[, sent]] = (prewarmMedications as jest.Mock).mock.calls;
    expect(sent).toEqual([coded]);
    // The key patientSafety reads for this medication (text = display, plus system and code).
    expect(normalizedKey(sent[0])).toBe(normalizedKey({ text: 'Warfarin', system: 'RxNorm', code: '11289' }));
    expect(normalizedKey(sent[0])).not.toBe(normalizedKey({ text: 'Warfarin' }));
  });

  it('does nothing when every name is normalised', () => {
    (prewarmMedications as jest.Mock).mockClear();
    prewarmInBackground({} as never, []);
    expect(prewarmMedications).not.toHaveBeenCalled();
  });
});
