/**
 * Hemoglobin / hematocrit over the REAL pipeline (fixtures/resolver-harness):
 * one question with both measures, answered in either, stored as the measure
 * entered, resolving every gate on either code — and never stored as anything
 * the provider did not enter. Unit-level behaviour is in `lab-equivalents.test.ts`.
 */
jest.mock('../services/resolution/session-store', () => require('./fixtures/resolver-harness').sessionStoreMock());
jest.mock('../services/resolution/pipeline/load-env', () => require('./fixtures/resolver-harness').loadEnvMock());
jest.mock('../resolvers/helpers/therapy-starts', () => ({
  ...jest.requireActual('../resolvers/helpers/therapy-starts'),
  loadCarePlanTherapyStarts: jest.fn(async () => []),
}));

import { resolutionMutations } from '../resolvers/mutations/resolution';
import { AnswerType, DefaultBehavior, GateType, NodeStatus } from '../services/resolution/types';
import { harness } from './fixtures/resolver-harness';
import { edge, makeEnv, node } from './fixtures/pipeline-env';

const PINNED = '2026-10-04T12:00:00.000Z';
const HGB = '718-7';
const HCT = '4544-3';
const HGB_MEASURE = { code: HGB, system: 'LOINC', display: 'Hemoglobin', unit: 'g/dL' };
const HCT_MEASURE = { code: HCT, system: 'LOINC', display: 'Hematocrit', unit: '%' };

const gate = (id: string, condition: Record<string, unknown>) =>
  node(id, 'Gate', {
    title: id, gate_type: GateType.PATIENT_ATTRIBUTE, default_behavior: DefaultBehavior.SKIP, on_unresolved: 'ask', condition,
  });
const leaf = (code: string, threshold: number) =>
  ({ field: 'labs', operator: 'less_than', value: code, system: 'LOINC', threshold, horizon: 'LIFETIME' });

/** Anemic (Hgb < 11) opens the workup; a hematocrit under 27 opens the referral. */
const PATHWAY = makeEnv(
  [
    node('root', 'Pathway'),
    gate('gate-anemic', leaf(HGB, 11)),
    node('step-workup', 'Step', { title: 'Anemia workup' }),
    gate('gate-referral', leaf(HCT, 27)),
    node('step-referral', 'Step', { title: 'Hematology referral' }),
  ],
  [
    edge('root', 'gate-anemic', 'HAS_GATE'), edge('gate-anemic', 'step-workup'),
    edge('root', 'gate-referral', 'HAS_GATE'), edge('gate-referral', 'step-referral'),
  ],
);

const ctx = () => harness.context({ temporalPolicyVersion: 'v1' });
async function start(labResults: Array<Record<string, unknown>> = []): Promise<string> {
  const s = await resolutionMutations.startResolution(null as never, {
    pathwayId: 'pw', patientId: 'pt-1', resolutionMode: 'SYNTHETIC', evaluationAsOf: PINNED,
    patientContext: { patientId: 'pt-1', conditionCodes: [], medications: [], allergies: [], labResults },
  } as never, ctx());
  return (s as { id: string }).id;
}
const answer = (sessionId: string, a: Record<string, unknown>, nodeId = 'gate-anemic') =>
  resolutionMutations.answerPendingDecision(null, { sessionId, nodeId, answer: a } as never, ctx());
const session = (id: string) => harness.session(id);
const status = (id: string, nodeId: string) => session(id).resolutionState.get(nodeId)?.status;
const reason = (id: string, nodeId: string) => session(id).resolutionState.get(nodeId)?.excludeReason;
const storedLabs = (id: string) => [
  ...((session(id) as unknown as { initialPatientContext: { labResults: unknown[] } }).initialPatientContext.labResults ?? []),
  ...(((session(id).additionalContext ?? {}) as { labResults?: unknown[] }).labResults ?? []),
];

beforeEach(() => {
  harness.reset();
  harness.addPathway('pw', PATHWAY);
});

describe('one measure on the chart', () => {
  it('hematocrit only (27%, dated): both gates decide, nothing is asked, and the reason says "estimated"', async () => {
    const id = await start([{ code: HCT, system: 'LOINC', value: 26, date: '2026-09-20' }]);
    expect(session(id).pendingQuestions).toEqual([]);
    expect(status(id, 'step-workup')).toBe(NodeStatus.INCLUDED);     // estimated Hgb 8.7 < 11
    expect(status(id, 'step-referral')).toBe(NodeStatus.INCLUDED);   // measured Hct 26 < 27
  });

  it('hemoglobin only: the hematocrit gate decides from it, nothing is asked', async () => {
    const id = await start([{ code: HGB, system: 'LOINC', value: 10.2, date: '2026-09-20' }]);
    expect(session(id).pendingQuestions).toEqual([]);
    expect(status(id, 'step-workup')).toBe(NodeStatus.INCLUDED);
    expect(status(id, 'gate-referral')).toBe(NodeStatus.GATED_OUT);
    expect(reason(id, 'gate-referral')).toBe('labs value 30.6 (estimated from hemoglobin 10.2 g/dL) >= 27');
  });
});

describe('neither on the chart: ONE question, two measures', () => {
  it('asks once, offering hemoglobin and hematocrit, the asked lab first', async () => {
    const id = await start();
    expect(session(id).pendingQuestions).toHaveLength(1);
    expect(session(id).pendingQuestions[0]).toMatchObject({
      gateId: 'gate-anemic', datumKey: 'LOINC:718-7', answerType: AnswerType.NUMERIC,
      askedByNodeIds: ['gate-anemic', 'gate-referral'],
      alternatives: [HGB_MEASURE, HCT_MEASURE],
    });
    expect(status(id, 'gate-anemic')).toBe(NodeStatus.PENDING_QUESTION);
    expect(status(id, 'gate-referral')).toBe(NodeStatus.PENDING_QUESTION);
  });

  it('answered AS A HEMATOCRIT: stored as a hematocrit, dated at the session clock, and both gates resolve', async () => {
    const id = await start();
    await answer(id, { numericValue: 26, enteredAs: { code: HCT, system: 'LOINC' } });

    expect(session(id).additionalContext).toMatchObject({
      labResults: [{ code: HCT, system: 'LOINC', value: 26, date: PINNED, providerAsserted: true }],
    });
    expect(session(id).pendingQuestions).toEqual([]);
    expect(status(id, 'step-workup')).toBe(NodeStatus.INCLUDED);
    expect(status(id, 'step-referral')).toBe(NodeStatus.INCLUDED);
    expect(harness.tables.events.at(-1)).toMatchObject({
      eventType: 'PROVIDER_ASSERTED_DATUM',
      triggerData: { datumKey: 'LOINC:718-7', value: 26, enteredAs: { code: HCT, system: 'LOINC' } },
    });
  });

  it('answered as a hematocrit WITH the day it was drawn: an ordinary dated hematocrit', async () => {
    const id = await start();
    await answer(id, { numericValue: 36, observedOn: '2026-09-28', enteredAs: { code: HCT } });

    expect(session(id).additionalContext).toMatchObject({ labResults: [{ code: HCT, system: 'LOINC', value: 36, date: '2026-09-28' }] });
    expect((session(id).additionalContext as { labResults: Array<{ providerAsserted?: boolean }> }).labResults[0].providerAsserted).toBeUndefined();
    expect(session(id).pendingQuestions).toEqual([]);
    expect(status(id, 'gate-anemic')).toBe(NodeStatus.GATED_OUT);
    expect(reason(id, 'gate-anemic')).toBe('labs value 12 (estimated from hematocrit 36%) >= 11');
    expect(status(id, 'gate-referral')).toBe(NodeStatus.GATED_OUT);
  });

  it('answered as a hemoglobin — with enteredAs, or without it as before — resolves the hematocrit gate too', async () => {
    for (const enteredAs of [{ code: HGB, system: 'LOINC' }, undefined]) {
      harness.reset();
      harness.addPathway('pw', PATHWAY);
      const id = await start();
      await answer(id, { numericValue: 8.5, ...(enteredAs ? { enteredAs } : {}) });
      expect(session(id).additionalContext).toMatchObject({
        labResults: [{ code: HGB, system: 'LOINC', value: 8.5, date: PINNED, providerAsserted: true }],
      });
      expect(session(id).pendingQuestions).toEqual([]);
      expect(status(id, 'step-workup')).toBe(NodeStatus.INCLUDED);
      expect(status(id, 'step-referral')).toBe(NodeStatus.INCLUDED); // estimated Hct 25.5 < 27
      expect((harness.tables.events.at(-1) as { triggerData: Record<string, unknown> }).triggerData.enteredAs).toBeUndefined();
    }
  });

  it('enteredAs an unrelated lab → BAD_USER_INPUT, and nothing is stored', async () => {
    const id = await start();
    await expect(answer(id, { numericValue: 12, enteredAs: { code: '2276-4', system: 'LOINC' } })).rejects.toMatchObject({
      extensions: { code: 'BAD_USER_INPUT' },
      message: expect.stringContaining('is not a measure this question accepts (LOINC 718-7, LOINC 4544-3)'),
    });
    // The right code under the wrong system is not it either.
    await expect(answer(id, { numericValue: 12, enteredAs: { code: HCT, system: 'SNOMED' } })).rejects.toMatchObject({
      extensions: { code: 'BAD_USER_INPUT' },
    });
    expect(session(id).additionalContext?.labResults ?? []).toEqual([]);
    expect(session(id).pendingQuestions).toHaveLength(1);
  });

  it('"Not available": the datum is declined for the GROUP — the hematocrit gate does not ask next', async () => {
    const id = await start();
    await answer(id, { notAvailable: true });
    expect(session(id).gateAnswers.get('declined:LOINC:718-7')).toEqual({ notAvailable: true });
    expect(session(id).pendingQuestions).toEqual([]);
    expect(status(id, 'gate-anemic')).toBe(NodeStatus.GATED_OUT);
    expect(status(id, 'gate-referral')).toBe(NodeStatus.GATED_OUT);
  });

  it('an unorderable hemoglobin on the chart, answered as a hematocrit, is settled by the answer', async () => {
    const id = await start([{ code: HGB, system: 'LOINC', value: 12 }, { code: HGB, system: 'LOINC', value: 9.5 }]); // unorderable → asked
    const [q] = session(id).pendingQuestions;
    expect(q.datumKey).toBe('LOINC:718-7');
    await answer(id, { numericValue: 26, enteredAs: { code: HCT } }, q.gateId);
    expect(session(id).pendingQuestions).toEqual([]);
    expect(status(id, 'step-workup')).toBe(NodeStatus.INCLUDED);
    expect(reason(id, 'gate-anemic')).toBeUndefined();
  });
});

describe('what is stored, and determinism', () => {
  it('an estimate is never written back: the stored context holds only what the chart and the provider supplied', async () => {
    const id = await start([{ code: HCT, system: 'LOINC', value: 26, date: '2026-09-20' }]);
    expect(storedLabs(id)).toEqual([{ code: HCT, system: 'LOINC', value: 26, date: '2026-09-20' }]);
    const asked = await start();
    await answer(asked, { numericValue: 26, enteredAs: { code: HCT } });
    expect(storedLabs(asked)).toEqual([{ code: HCT, system: 'LOINC', value: 26, date: PINNED, providerAsserted: true }]);
  });

  it('the same inputs give the same result hash; a different hematocrit a different one', async () => {
    const hashOf = async (value: number) => {
      const id = await start([{ code: HCT, system: 'LOINC', value, date: '2026-09-20' }]);
      return (session(id) as unknown as { resultHash: string }).resultHash;
    };
    const a = await hashOf(26);
    const b = await hashOf(26);
    const c = await hashOf(36);
    expect(typeof a).toBe('string');
    expect(a.length).toBeGreaterThan(0);
    expect(b).toBe(a);
    expect(c).not.toBe(a);
  });
});
