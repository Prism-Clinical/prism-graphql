import { liveObservations, observationKey, replayObservations } from '../services/resolution/pipeline/observations';
import { DefaultBehavior, GateProperties, GateType } from '../services/resolution/types';
import type { LlmObservation } from '../services/resolution/pipeline/types';

const gate: GateProperties = {
  title: 'Urgency',
  gate_type: GateType.LLM_TEXT_ANALYSIS,
  default_behavior: DefaultBehavior.SKIP,
  prompt: 'Is this urgent?',
  input_attribute: 'freeformData.narrative',
  branches: [
    { name: 'urgent', description: 'same-day care' },
    { name: 'routine', description: 'can wait', is_safe_default: true },
  ],
  confidence_threshold: 0.75,
};
const patient = (narrative: string) =>
  ({ patientId: 'p', conditionCodes: [], medications: [], labResults: [], allergies: [], freeformData: { narrative } }) as never;
const output = { chosenBranch: 'urgent', confidence: 0.95, reasoning: 'chest pain', rawResponse: {}, model: 'm1', latencyMs: 5 };

describe('observationKey', () => {
  const base = observationKey(gate, 'g', 'chest pain', 'm1');

  it('changes with prompt, branches, input attribute, narrative, model and gate id', () => {
    expect(observationKey({ ...gate, prompt: 'Other?' }, 'g', 'chest pain', 'm1')).not.toBe(base);
    expect(observationKey({ ...gate, branches: [gate.branches![0]] }, 'g', 'chest pain', 'm1')).not.toBe(base);
    expect(observationKey({ ...gate, input_attribute: 'freeformData.hpi' }, 'g', 'chest pain', 'm1')).not.toBe(base);
    expect(observationKey(gate, 'g', 'cough', 'm1')).not.toBe(base);
    expect(observationKey(gate, 'g', 'chest pain', 'm2')).not.toBe(base);
    expect(observationKey(gate, 'h', 'chest pain', 'm1')).not.toBe(base);
  });

  it('ignores confidence_threshold, which is applied after acquisition', () => {
    expect(observationKey({ ...gate, confidence_threshold: 0.5 }, 'g', 'chest pain', 'm1')).toBe(base);
  });
});

describe('replayObservations', () => {
  it('returns a recorded verdict and marks it used; otherwise UNAVAILABLE', async () => {
    const key = observationKey(gate, 'g', 'chest pain', 'm1');
    const obs: LlmObservation = { key, gateId: 'g', chosenBranch: 'urgent', confidence: 0.95, reasoning: 'r', model: 'm1', acquiredAt: 't' };
    const provider = replayObservations(new Map([[key, obs]]), 'm1');

    await expect(provider.evaluator(gate, 'g', patient('chest pain'))).resolves.toEqual({ chosenBranch: 'urgent', confidence: 0.95, reasoning: 'r' });
    expect([...provider.used]).toEqual([key]);
    await expect(provider.evaluator(gate, 'g', patient('cough'))).resolves.toMatchObject({ failed: true });
  });
});

describe('liveObservations', () => {
  it('uses a session observation without calling the client', async () => {
    const key = observationKey(gate, 'g', 'chest pain', 'm1');
    const client = jest.fn().mockResolvedValue(output);
    const session = new Map([[key, { key, gateId: 'g', chosenBranch: 'routine', confidence: 0.9, reasoning: 's', model: 'm1', acquiredAt: 't' }]]);
    const verdict = await liveObservations(session, new Map(), client, 'm1').evaluator(gate, 'g', patient('chest pain'));

    expect(verdict.chosenBranch).toBe('routine');
    expect(client).not.toHaveBeenCalled();
  });

  it('reuses a request observation across providers (a retried attempt) and calls once', async () => {
    const client = jest.fn().mockResolvedValue(output);
    const request = new Map();
    await liveObservations(new Map(), request, client, 'm1', () => 't').evaluator(gate, 'g', patient('chest pain'));
    await liveObservations(new Map(), request, client, 'm1', () => 't').evaluator(gate, 'g', patient('chest pain'));

    expect(client).toHaveBeenCalledTimes(1);
    expect(request.size).toBe(1);
  });

  it('returns UNAVAILABLE on failure or no client, and records nothing', async () => {
    const request = new Map();
    const failing = jest.fn().mockRejectedValue(new Error('timeout'));
    await expect(liveObservations(new Map(), request, failing, 'm1').evaluator(gate, 'g', patient('x'))).resolves.toMatchObject({ failed: true });
    await expect(liveObservations(new Map(), request, null, 'm1').evaluator(gate, 'g', patient('x'))).resolves.toMatchObject({ failed: true });
    expect(request.size).toBe(0);
  });
});
