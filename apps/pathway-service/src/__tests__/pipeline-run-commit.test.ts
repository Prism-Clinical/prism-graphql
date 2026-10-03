jest.mock('../services/resolution/session-store', () => require('./fixtures/resolver-harness').sessionStoreMock());
jest.mock('../services/resolution/multi-pathway-session-store', () => require('./fixtures/resolver-harness').runStoreMock());
jest.mock('../services/resolution/pipeline/load-env', () => require('./fixtures/resolver-harness').loadEnvMock());
jest.mock('../services/llm/llm-gate-client', () => ({
  ...jest.requireActual('../services/llm/llm-gate-client'),
  loadLLMGateConfig: jest.fn(() => null),
  evaluateGateWithLLM: jest.fn(),
}));

import { GraphQLError } from 'graphql';
import { evaluateGateWithLLM, loadLLMGateConfig } from '../services/llm/llm-gate-client';
import { insertRun, setContributingSessions } from '../services/resolution/multi-pathway-session-store';
import { commitEvaluation } from '../services/resolution/pipeline/commit';
import { loadRunEnv } from '../services/resolution/pipeline/load-env';
import { inTransaction, persistedObservations } from '../services/resolution/pipeline/request';
import { evaluateRun, newRunRequest, requestFor, runInputsOf, sessionInputsOf } from '../services/resolution/pipeline/run';
import type { RunInputs } from '../services/resolution/pipeline/run';
import { commitRun, loadRun } from '../services/resolution/pipeline/run-commit';
import { inputsOf, insertSession, writeLlmAudits } from '../services/resolution/session-store';
import { DefaultBehavior, GateType, NodeStatus, OverrideAction, SessionStatus } from '../services/resolution/types';
import { harness } from './fixtures/resolver-harness';
import { edge, makeEnv, makeInputs, node } from './fixtures/pipeline-env';

const SAFETY = {
  normalized: new Map([['amoxicillin||', { ingredientRxcui: '723', ingredientName: 'amoxicillin', atcClasses: ['J01CA04'] }]]),
  allergyMappings: [{ snomedCode: '91936005', snomedDisplay: 'Allergy to penicillin', atcClass: 'J01C' }],
};
const PENICILLIN = { code: '91936005', system: 'SNOMED', display: 'Allergy to penicillin' };
const med = (id: string) => node(id, 'Medication', { name: 'Amoxicillin', role: 'first_line' });
const simple = (medId: string) =>
  makeEnv([node('root', 'Pathway'), node('step', 'Step'), med(medId)], [edge('root', 'step'), edge('step', medId)], SAFETY);
const PW_A = simple('amox-a');
const PW_B = simple('amox-b');
const PW_LLM = makeEnv(
  [
    node('root', 'Pathway'), node('stage', 'Stage'),
    node('gate-llm', 'Gate', {
      gate_type: GateType.LLM_TEXT_ANALYSIS, default_behavior: DefaultBehavior.SKIP, prompt: 'Urgent?',
      input_attribute: 'freeformData.narrative', confidence_threshold: 0.75,
      branches: [{ name: 'urgent', description: 'same day' }, { name: 'routine', description: 'can wait', is_safe_default: true }],
    }),
    node('step', 'Step'), med('m'),
  ],
  [edge('root', 'stage'), edge('stage', 'gate-llm'), edge('gate-llm', 'step'), edge('step', 'm')],
  SAFETY,
);
const verdict = { chosenBranch: 'urgent', confidence: 0.95, reasoning: 'r', rawResponse: {}, model: 'test-model', latencyMs: 1 };

/** A run stored exactly as a start stores one. */
async function seedRun(pathwayIds: string[], additionalContext: Record<string, unknown> = {}): Promise<string> {
  const pool = harness.pool();
  const base = makeInputs(PW_A);
  const request = newRunRequest();
  const inputs: RunInputs = {
    initialPatientContext: base.initialPatientContext, additionalContext, temporalContext: base.temporalContext, conflictResolutions: {},
    children: pathwayIds.map((pathwayId) => ({
      sessionId: '', pathwayId,
      inputs: { pathwayId, graphFingerprint: '', gateAnswers: new Map(), providerOverrides: new Map(), observations: new Map(), revision: 0 },
    })),
  };
  const ev = await evaluateRun(pool, request, inputs, { pinGraphs: true });
  return inTransaction(pool, async (db) => {
    const runId = await insertRun(db, {
      patientId: 'pt', providerId: 'pr', isPreview: true, initialPatientContext: inputs.initialPatientContext,
      temporalContext: inputs.temporalContext, additionalContext, conflictResolutions: {}, result: ev.result,
    });
    const ids: string[] = [];
    for (const child of ev.result.children) {
      const own = ev.inputs.children.find((c) => c.pathwayId === child.pathwayId)!;
      const s = sessionInputsOf(ev.inputs, own.inputs);
      const req = requestFor(request, child.pathwayId);
      const id = await insertSession(db, {
        pathwayVersion: '1', patientId: 'pt', providerId: 'pr',
        inputs: { ...s, additionalContext: {}, observations: persistedObservations(s, req, child.result) },
        result: child.result, status: SessionStatus.ACTIVE, durationMs: 1, parentSessionId: runId,
      });
      await writeLlmAudits(db, id, req.audits);
      ids.push(id);
    }
    await setContributingSessions(db, runId, ids, ev.result.children.map((c) => c.pathwayId));
    return runId;
  });
}

/** Change the run's narrative — a parent fact, which changes the LLM observation key. */
const narrate = (narrative: string) => (r: Parameters<typeof runInputsOf>[0]) => {
  const inputs = runInputsOf(r);
  inputs.additionalContext = { ...inputs.additionalContext, freeformData: { narrative } };
  return { inputs, events: [] };
};

beforeEach(() => {
  harness.reset();
  harness.addPathway('pw-a', PW_A);
  harness.addPathway('pw-b', PW_B);
  harness.addPathway('pw-llm', PW_LLM);
  (loadLLMGateConfig as jest.Mock).mockReset().mockReturnValue(null);
  (evaluateGateWithLLM as jest.Mock).mockReset().mockResolvedValue(verdict);
});

describe('evaluateRun', () => {
  it('evaluates every child under ONE snapshot, at CONTRIBUTION scope (D13, C3)', async () => {
    const pool = harness.pool();
    const run = await loadRun(pool, await seedRun(['pw-a', 'pw-b']));
    (loadRunEnv as jest.Mock).mockClear();

    const ev = await evaluateRun(pool, newRunRequest(), runInputsOf(run));

    expect(loadRunEnv).toHaveBeenCalledTimes(1);
    expect((loadRunEnv as jest.Mock).mock.calls[0][1]).toEqual(['pw-a', 'pw-b']);
    expect(ev.result.children.map((c) => c.result.scope)).toEqual(['CONTRIBUTION', 'CONTRIBUTION']);
  });

  it('a fact on the run reaches every child, and is stored on the parent only (D5)', async () => {
    const runId = await seedRun(['pw-a', 'pw-b'], { allergies: [PENICILLIN] });
    const run = await loadRun(harness.pool(), runId);

    expect(run.children[0].resolutionState.get('amox-a')!.disposition).toMatchObject({ withheldBy: 'safety' });
    expect(run.children[1].resolutionState.get('amox-b')!.disposition).toMatchObject({ withheldBy: 'safety' });
    expect(harness.row(run.children[0].id).additional_context).toEqual({});
    expect(harness.runRow(runId).additional_context).toEqual({ allergies: [PENICILLIN] });
  });
});

describe('commitRun', () => {
  it('commits the parent, every child and the events under one parent revision', async () => {
    const pool = harness.pool();
    const runId = await seedRun(['pw-a', 'pw-b']);
    const [a, b] = (await loadRun(pool, runId)).children;

    const run = await commitRun(pool, runId, (r) => {
      const inputs = runInputsOf(r);
      inputs.children[0].inputs.providerOverrides.set('amox-a', {
        action: OverrideAction.EXCLUDE, originalStatus: NodeStatus.INCLUDED, originalConfidence: 0.9,
      });
      return { inputs, events: [{ sessionId: a.id, eventType: 'override', triggerData: { nodeId: 'amox-a' } }] };
    });

    expect(run.parent.revision).toBe(1);
    expect(harness.row(a.id).revision).toBe(1);
    expect(harness.row(b.id).revision).toBe(1); // re-evaluated too (D13)
    expect(run.children[0].providerOverrides.get('amox-a')).toMatchObject({ action: 'EXCLUDE' });
    expect(harness.tables.events).toEqual([expect.objectContaining({
      sessionId: a.id, eventType: 'override',
      statusChanges: [expect.objectContaining({ nodeId: 'amox-a', to: 'EXCLUDED' })],
    })]);
  });

  it('retries after losing a race on the parent and calls the LLM once across attempts (A1, D9)', async () => {
    (loadLLMGateConfig as jest.Mock).mockReturnValue({ baseUrl: 'http://llm', apiKey: 'k', model: 'test-model', timeoutMs: 1000 });
    const runId = await seedRun(['pw-llm'], { freeformData: { narrative: 'mild cough' } });
    (evaluateGateWithLLM as jest.Mock).mockClear();
    (loadRunEnv as jest.Mock).mockClear();
    harness.loseNextRaces(1);

    const run = await commitRun(harness.pool(), runId, narrate('crushing chest pain'));

    expect(loadRunEnv).toHaveBeenCalledTimes(2);
    expect(evaluateGateWithLLM).toHaveBeenCalledTimes(1);
    expect(run.parent.revision).toBe(2); // one bump by the "other writer", one by this commit
  });

  it('throws CONFLICT after three lost races and still writes the child’s audit rows', async () => {
    (loadLLMGateConfig as jest.Mock).mockReturnValue({ baseUrl: 'http://llm', apiKey: 'k', model: 'test-model', timeoutMs: 1000 });
    const runId = await seedRun(['pw-llm'], { freeformData: { narrative: 'mild cough' } });
    const [child] = (await loadRun(harness.pool(), runId)).children;
    const before = harness.tables.audits.length;
    harness.onBeforeWrite((row) => { row.revision += 1; });

    await expect(commitRun(harness.pool(), runId, narrate('crushing chest pain')))
      .rejects.toMatchObject({ extensions: { code: 'CONFLICT' } });

    expect(harness.tables.audits.slice(before)).toEqual([{ sessionId: child.id, gateId: 'gate-llm', errorMessage: null }]);
  });

  it('refuses a run that is not ACTIVE, before evaluating', async () => {
    const runId = await seedRun(['pw-a']);
    harness.runRow(runId).status = 'COMPLETED';
    (loadRunEnv as jest.Mock).mockClear();
    await expect(commitRun(harness.pool(), runId, narrate('x'))).rejects.toThrow('Cannot modify session with status "COMPLETED"');
    expect(loadRunEnv).not.toHaveBeenCalled();
  });

  it('a boundary error is not retried and writes nothing', async () => {
    const runId = await seedRun(['pw-a']);
    (loadRunEnv as jest.Mock).mockClear();
    await expect(commitRun(harness.pool(), runId, () => {
      throw new GraphQLError('bad answer', { extensions: { code: 'BAD_USER_INPUT' } });
    })).rejects.toThrow('bad answer');
    expect(loadRunEnv).not.toHaveBeenCalled();
    expect(harness.runRow(runId).revision).toBe(0);
  });

  it('commitEvaluation refuses a child of a run: alone it would bypass the run’s lock (P4-7)', async () => {
    const runId = await seedRun(['pw-a']);
    const [child] = (await loadRun(harness.pool(), runId)).children;
    await expect(commitEvaluation(harness.pool(), child.id, (s) => ({ inputs: inputsOf(s), event: { eventType: 'override', triggerData: {} } })))
      .rejects.toMatchObject({ extensions: { code: 'CHILD_OF_MULTI_PATHWAY_SESSION' } });
    expect(harness.row(child.id).revision).toBe(0);
  });
});
