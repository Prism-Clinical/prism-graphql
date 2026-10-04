/**
 * Rh spellings over the REAL pipeline (fixtures/resolver-harness): the gate the
 * prenatal pathway uses — "Rh type is anything but positive" — fed the ways a
 * chart, an added value and an answer actually write it. Unit-level behaviour
 * and the full spelling table are in `rh-factor-normalization.test.ts`.
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

const PATHWAY = makeEnv(
  [
    node('root', 'Pathway'),
    node('gate-not-positive', 'Gate', {
      title: 'Rh not clearly positive', gate_type: GateType.PATIENT_ATTRIBUTE, default_behavior: DefaultBehavior.SKIP,
      on_unresolved: 'ask',
      condition: { attribute: 'patient.rh_factor', operator: 'not_equals', value: 'positive' },
    }),
    node('step-rh', 'Step', { title: 'Rh immune globulin workup' }),
  ],
  [edge('root', 'gate-not-positive', 'HAS_GATE'), edge('gate-not-positive', 'step-rh')],
);

const ctx = () => harness.context({ temporalPolicyVersion: 'v1' });
async function start(patientAttributes?: Record<string, unknown>): Promise<string> {
  const s = await resolutionMutations.startResolution(null as never, {
    pathwayId: 'pw', patientId: 'pt-1', resolutionMode: 'SYNTHETIC', evaluationAsOf: '2026-10-04T12:00:00.000Z',
    patientContext: {
      patientId: 'pt-1', conditionCodes: [], medications: [], allergies: [], labResults: [],
      ...(patientAttributes ? { patientAttributes } : {}),
    },
  } as never, ctx());
  return (s as { id: string }).id;
}
const session = (id: string) => harness.session(id);
const status = (id: string, nodeId: string) => session(id).resolutionState.get(nodeId)?.status;

beforeEach(() => {
  harness.reset();
  harness.addPathway('pw', PATHWAY);
});

describe('the chart\'s spelling', () => {
  it.each(['positive', 'Positive', 'POS', 'Rh+', 'Rh(D) positive', 'D positive'])(
    '%j is positive: the patient is NOT flagged',
    async (written) => {
      const id = await start({ rh_factor: written });
      expect(status(id, 'step-rh')).toBe(NodeStatus.GATED_OUT);
      expect(session(id).pendingQuestions).toEqual([]);
    },
  );

  it.each(['negative', 'NEG', 'Rh-', 'Rh(D) negative', 'weak D', 'Du', 'weakly positive', 'partial D'])(
    '%j is not positive: flagged',
    async (written) => {
      const id = await start({ rh_factor: written });
      expect(status(id, 'step-rh')).toBe(NodeStatus.INCLUDED);
    },
  );

  it.each(['unknown', 'pending', 'O+', 'A POS', 'see report'])(
    '%j is not a recognised spelling: left as written, so it still reads as not-positive and IS flagged',
    async (written) => {
      const id = await start({ rh_factor: written });
      expect(status(id, 'step-rh')).toBe(NodeStatus.INCLUDED);
    },
  );
});

describe('values supplied during the session', () => {
  it('missing → asked; the SELECT answer is stored and decides', async () => {
    const id = await start();
    const [q] = session(id).pendingQuestions;
    expect(q).toMatchObject({ datumKey: 'patient.rh_factor', answerType: AnswerType.SELECT, options: ['positive'] });
    await resolutionMutations.answerPendingDecision(null, { sessionId: id, nodeId: q.gateId, answer: { selectedOption: 'positive' } }, ctx());
    expect(status(id, 'step-rh')).toBe(NodeStatus.GATED_OUT);
  });

  it('a value added mid-session in a chart spelling is read as the canonical one', async () => {
    const id = await start({ rh_factor: 'unknown' });
    expect(status(id, 'step-rh')).toBe(NodeStatus.INCLUDED);
    await resolutionMutations.addPatientContext(
      null, { sessionId: id, additionalContext: { patientAttributes: { rh_factor: 'RH POS' } } } as never, ctx(),
    );
    expect(status(id, 'step-rh')).toBe(NodeStatus.GATED_OUT);
  });
});
