/**
 * `horizon: "PREGNANCY"` over the REAL pipeline (fixtures/resolver-harness):
 * the gestational age is asked for, answered through `answerPendingDecision`,
 * and the answer — stored as `patientAttributes.gestational_age_weeks` in the
 * session's additional context — dates the window on the next evaluation.
 *
 * This is the proof that the window is derived from the EFFECTIVE patient at
 * evaluation and not pinned at session creation: the session starts with no
 * gestational age at all, and the same session then decides. Unit-level
 * behaviour is in `pregnancy-horizon.test.ts`.
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

// 28 weeks back from the clock is 2026-03-22; 5 weeks back is 2026-08-30.
const PINNED = '2026-10-04T12:00:00.000Z';
const HIV = '75622-1';
const HIV_DRAWN_JUNE = { code: HIV, system: 'LOINC', value: 1, date: '2026-06-10' };

const DRAWN = { field: 'labs', operator: 'includes_code', value: HIV, system: 'LOINC', horizon: 'PREGNANCY' };
const NOT_DRAWN = { ...DRAWN, operator: 'not_includes_code' };

const gate = (id: string, condition: Record<string, unknown>) =>
  node(id, 'Gate', {
    title: id, gate_type: GateType.PATIENT_ATTRIBUTE, default_behavior: DefaultBehavior.SKIP,
    on_unresolved: 'ask', condition,
  });

/** "Already drawn this pregnancy" opens one step; "not yet drawn" opens the order. */
const PATHWAY = makeEnv(
  [
    node('root', 'Pathway'),
    gate('gate-drawn', DRAWN),
    node('step-reviewed', 'Step', { title: 'Result reviewed' }),
    gate('gate-not-drawn', NOT_DRAWN),
    node('step-order', 'Step', { title: 'Order HIV screen' }),
  ],
  [
    edge('root', 'gate-drawn', 'HAS_GATE'), edge('gate-drawn', 'step-reviewed'),
    edge('root', 'gate-not-drawn', 'HAS_GATE'), edge('gate-not-drawn', 'step-order'),
  ],
);

const ctx = (version = 'v1') => harness.context({ temporalPolicyVersion: version });
async function start(patient: Record<string, unknown> = {}, version = 'v1'): Promise<string> {
  const s = await resolutionMutations.startResolution(null as never, {
    pathwayId: 'pw', patientId: 'pt-1', resolutionMode: 'SYNTHETIC', evaluationAsOf: PINNED,
    patientContext: { patientId: 'pt-1', conditionCodes: [], medications: [], allergies: [], labResults: [], ...patient },
  } as never, ctx(version));
  return (s as { id: string }).id;
}
const answer = (sessionId: string, a: Record<string, unknown>, nodeId: string) =>
  resolutionMutations.answerPendingDecision(null, { sessionId, nodeId, answer: a }, ctx());
const session = (id: string) => harness.session(id);
const status = (id: string, nodeId: string) => session(id).resolutionState.get(nodeId)?.status;
const reason = (id: string, nodeId: string) => session(id).resolutionState.get(nodeId)?.excludeReason;

beforeEach(() => {
  harness.reset();
  harness.addPathway('pw', PATHWAY);
});

describe('gestational age missing at session start', () => {
  it('both gates pend on ONE gestational-age question — neither silently says yes or no', async () => {
    const id = await start({ labResults: [HIV_DRAWN_JUNE] });

    expect(session(id).pendingQuestions).toHaveLength(1);
    expect(session(id).pendingQuestions[0]).toMatchObject({
      datumKey: 'patient.gestational_age_weeks',
      answerType: AnswerType.NUMERIC,
      askTarget: { kind: 'attribute', path: 'patient.gestational_age_weeks' },
      askedByNodeIds: ['gate-drawn', 'gate-not-drawn'],
    });
    for (const n of ['gate-drawn', 'step-reviewed', 'gate-not-drawn', 'step-order']) {
      expect(status(id, n)).toBe(NodeStatus.PENDING_QUESTION);
    }
  });

  it('answering 28 weeks through the normal answer path decides both: the June lab is in this pregnancy', async () => {
    const id = await start({ labResults: [HIV_DRAWN_JUNE] });
    const [q] = session(id).pendingQuestions;

    await answer(id, { numericValue: 28 }, q.gateId);

    // Stored as a patient FACT, where an attribute gate would read it too.
    expect(session(id).additionalContext).toMatchObject({ patientAttributes: { gestational_age_weeks: 28 } });
    expect(session(id).pendingQuestions).toEqual([]);
    expect(status(id, 'gate-drawn')).toBe(NodeStatus.INCLUDED);
    expect(status(id, 'step-reviewed')).toBe(NodeStatus.INCLUDED);
    expect(status(id, 'gate-not-drawn')).toBe(NodeStatus.GATED_OUT);
    expect(status(id, 'step-order')).toBe(NodeStatus.GATED_OUT);
    expect(reason(id, 'gate-not-drawn')).toContain('within this pregnancy (since 2026-03-22, 28 weeks)');
  });

  it('answering 5 weeks decides them the other way: the same lab predates this pregnancy', async () => {
    const id = await start({ labResults: [HIV_DRAWN_JUNE] });
    const [q] = session(id).pendingQuestions;

    await answer(id, { numericValue: 5 }, q.gateId);

    expect(session(id).pendingQuestions).toEqual([]);
    expect(status(id, 'step-reviewed')).toBe(NodeStatus.GATED_OUT);
    expect(status(id, 'step-order')).toBe(NodeStatus.INCLUDED);
    expect(reason(id, 'gate-drawn')).toContain('within this pregnancy (since 2026-08-30, 5 weeks)');
  });

  it('"not available": the gates stop asking and take default_behavior', async () => {
    const id = await start({ labResults: [HIV_DRAWN_JUNE] });
    const [q] = session(id).pendingQuestions;
    await answer(id, { notAvailable: true }, q.gateId);
    expect(session(id).pendingQuestions).toEqual([]);
    expect(status(id, 'gate-drawn')).toBe(NodeStatus.GATED_OUT);
    expect(status(id, 'gate-not-drawn')).toBe(NodeStatus.GATED_OUT);
  });
});

describe('gestational age on the chart', () => {
  it('nothing is asked, and the window is the chart age\'s', async () => {
    const id = await start({ labResults: [HIV_DRAWN_JUNE], patientAttributes: { gestational_age_weeks: 28 } });
    expect(session(id).pendingQuestions).toEqual([]);
    expect(status(id, 'step-reviewed')).toBe(NodeStatus.INCLUDED);
    expect(status(id, 'step-order')).toBe(NodeStatus.GATED_OUT);
  });

  it('a gestational age added mid-session moves the window on the next evaluation', async () => {
    // 5 weeks at the start: the June lab is before this pregnancy.
    const id = await start({ labResults: [HIV_DRAWN_JUNE], patientAttributes: { gestational_age_weeks: 5 } });
    expect(status(id, 'step-order')).toBe(NodeStatus.INCLUDED);

    // Corrected to 28 weeks: the same lab is now inside it.
    await resolutionMutations.addPatientContext(
      null,
      { sessionId: id, additionalContext: { patientAttributes: { gestational_age_weeks: 28 } } } as never,
      ctx(),
    );
    expect(status(id, 'step-order')).toBe(NodeStatus.GATED_OUT);
    expect(status(id, 'step-reviewed')).toBe(NodeStatus.INCLUDED);
  });
});

describe('legacy-v0 session', () => {
  it('refuses the horizon: nothing is included, and the reason says why', async () => {
    const id = await start(
      { labResults: [HIV_DRAWN_JUNE], patientAttributes: { gestational_age_weeks: 28 } },
      'legacy-v0',
    );
    for (const g of ['gate-drawn', 'gate-not-drawn']) {
      expect(status(id, g)).toBe(NodeStatus.GATED_OUT);
      expect(reason(id, g)).toBe('horizon PREGNANCY requires the v1 temporal kernel; legacy-v0 cannot evaluate it');
    }
  });
});
