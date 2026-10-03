/**
 * Answering a datum request over the REAL pipeline (fixtures/resolver-harness).
 *
 * A gate that cannot decide asks for the datum it needed. The answer is a
 * FACT added to the session's inputs — never a gate verdict — and it is typed
 * the way the gate compares it:
 *
 *  - a `patient.*` attribute is asked as NUMERIC, BOOLEAN or SELECT, and stored
 *    as that type (compareScalar compares with `===`);
 *  - a lab is a number, DATED at the session clock and marked provider-asserted,
 *    so it settles the ambiguity that made the gate ask;
 *  - a `window_from` start date is stored under the ANCHOR key, never under the
 *    gate's id.
 *
 * Ported from the pre-pipeline `patient-attribute-answers`, `provider-datum-dating`
 * and `audit-event-atomicity` suites, which drove the retired incremental
 * resolver. Atomicity itself is `commitEvaluation`'s, covered by pipeline-commit.
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

const PINNED = '2026-08-30T12:00:00.000Z';

/** One chart gate over `condition`, opening one step, that asks when it cannot decide. */
const oneGate = (condition: Record<string, unknown>) =>
  makeEnv(
    [
      node('root', 'Pathway'),
      node('gate', 'Gate', {
        title: 'Gate', gate_type: GateType.PATIENT_ATTRIBUTE, default_behavior: DefaultBehavior.SKIP,
        on_unresolved: 'ask', condition,
      }),
      node('step', 'Step', { title: 'Step' }),
    ],
    [edge('root', 'gate', 'HAS_GATE'), edge('gate', 'step')],
  );

const ANCHOR_KEY = 'anchor:medication_start:oral-iron-repletion';
/** "Hgb rose ≥ 1 g/dL since oral iron started" — nothing resolves the anchor here, so it asks. */
const ANCHORED = makeEnv(
  [
    node('root', 'Pathway'),
    node('gate', 'Gate', {
      title: 'Responding?', gate_type: GateType.PATIENT_ATTRIBUTE, default_behavior: DefaultBehavior.SKIP,
      on_unresolved: 'ask',
      condition: {
        field: 'labs', operator: 'delta_from_baseline', value: '718-7', system: 'LOINC',
        display: 'Hemoglobin (g/dL)', delta_threshold: 1.0, delta_comparison: 'at_least', min_points: 2,
        window_from: {
          event: 'medication_start', clinical_role: 'oral-iron-repletion', label: 'oral iron',
          codes: [{ system: 'RXNORM', code: 'RX-FE-SULFATE' }], baseline_days: 28,
        },
      },
    }),
    node('step', 'Step', { title: 'Continue iron' }),
  ],
  [edge('root', 'gate', 'HAS_GATE'), edge('gate', 'step')],
);

const ctx = () => harness.context({ temporalPolicyVersion: 'v1' });
async function start(pathwayId: string, patient: Record<string, unknown> = {}): Promise<string> {
  const s = await resolutionMutations.startResolution(null as never, {
    pathwayId, patientId: 'pt-1', resolutionMode: 'SYNTHETIC', evaluationAsOf: PINNED,
    patientContext: { patientId: 'pt-1', conditionCodes: [], medications: [], allergies: [], labResults: [], ...patient },
  } as never, ctx());
  return (s as { id: string }).id;
}
const answer = (sessionId: string, a: Record<string, unknown>, nodeId = 'gate') =>
  resolutionMutations.answerPendingDecision(null, { sessionId, nodeId, answer: a }, ctx());
const session = (id: string) => harness.session(id);
const status = (id: string, nodeId: string) => session(id).resolutionState.get(nodeId)?.status;
const lastEvent = () => harness.tables.events.at(-1)!;

beforeEach(() => {
  harness.reset();
});

describe('a pending patient.* datum is asked and answered in the type its gate compares', () => {
  it('NUMERIC: patient.gestational_age_weeks >= 18 — pend, answer 20, gate included, question gone', async () => {
    harness.addPathway('pw', oneGate({ attribute: 'patient.gestational_age_weeks', operator: 'greater_or_equal', value: 18 }));
    const id = await start('pw');
    const [q] = session(id).pendingQuestions;
    expect(q).toMatchObject({ gateId: 'gate', datumKey: 'patient.gestational_age_weeks', answerType: AnswerType.NUMERIC });

    await answer(id, { numericValue: 20 });
    expect(session(id).additionalContext).toMatchObject({ patientAttributes: { gestational_age_weeks: 20 } });
    expect(session(id).gateAnswers.has('gate')).toBe(false);
    expect(session(id).pendingQuestions).toEqual([]);
    expect(status(id, 'step')).toBe(NodeStatus.INCLUDED);
    expect(lastEvent()).toMatchObject({
      eventType: 'PROVIDER_ASSERTED_DATUM',
      triggerData: { datumKey: 'patient.gestational_age_weeks', value: 20, answerType: AnswerType.NUMERIC },
    });
  });

  it('BOOLEAN: patient.prior_cesarean equals true — answering false decides "no" and stops asking', async () => {
    harness.addPathway('pw', oneGate({ attribute: 'patient.prior_cesarean', operator: 'equals', value: true }));
    const id = await start('pw');
    expect(session(id).pendingQuestions[0]).toMatchObject({ datumKey: 'patient.prior_cesarean', answerType: AnswerType.BOOLEAN });

    await answer(id, { booleanValue: false });
    expect(session(id).additionalContext).toMatchObject({ patientAttributes: { prior_cesarean: false } });
    expect(session(id).pendingQuestions).toEqual([]);
    expect(status(id, 'gate')).toBe(NodeStatus.GATED_OUT);
  });

  it('SELECT: patient.rh_factor in [negative, unknown] — the options are the comparands; "negative" opens the gate', async () => {
    harness.addPathway('pw', oneGate({ attribute: 'patient.rh_factor', operator: 'in', value: ['negative', 'unknown'] }));
    const id = await start('pw');
    expect(session(id).pendingQuestions[0]).toMatchObject({
      datumKey: 'patient.rh_factor', answerType: AnswerType.SELECT, options: ['negative', 'unknown'],
    });

    await answer(id, { selectedOption: 'negative' });
    expect(session(id).additionalContext).toMatchObject({ patientAttributes: { rh_factor: 'negative' } });
    expect(status(id, 'step')).toBe(NodeStatus.INCLUDED);
  });
});

describe('an answer that does not fit the patient.* question is refused, and nothing is stored', () => {
  const refused = async (condition: Record<string, unknown>, a: Record<string, unknown>, message: RegExp) => {
    harness.addPathway('pw', oneGate(condition));
    const id = await start('pw');
    await expect(answer(id, a)).rejects.toThrow(message);
    expect(session(id).revision).toBe(0);
    expect(session(id).additionalContext).toEqual({});
  };
  const RH = { attribute: 'patient.rh_factor', operator: 'in', value: ['negative', 'unknown'] };
  const CS = { attribute: 'patient.prior_cesarean', operator: 'equals', value: true };

  it('an option the question does not offer', () => refused(RH, { selectedOption: 'positive' }, /patient\.rh_factor/));
  it('the wrong field for the question', () => refused(RH, { numericValue: 1 }, /supply selectedOption/));
  it('a boolean question sent the string "true"', () => refused(CS, { selectedOption: 'true' }, /supply booleanValue/));
  it('more than one field', () => refused(CS, { booleanValue: true, numericValue: 1 }, /patient\.prior_cesarean/));
});

describe('a provider-supplied lab settles an ambiguous latest value', () => {
  const HGB_LOW = { field: 'labs', operator: 'less_than', value: '718-7', system: 'LOINC', threshold: 11 };
  const TWO_UNDATED = { labResults: [
    { code: '718-7', system: 'LOINC', value: 9 },
    { code: '718-7', system: 'LOINC', value: 12 },
  ] };

  it('two undated values cannot be ordered, so the gate asks', async () => {
    harness.addPathway('pw', oneGate(HGB_LOW));
    const id = await start('pw', TWO_UNDATED);
    expect(status(id, 'gate')).toBe(NodeStatus.PENDING_QUESTION);
    expect(session(id).pendingQuestions[0]).toMatchObject({ answerType: AnswerType.NUMERIC });
  });

  it('the answer is dated at the session clock, marked provider-asserted, and decides the gate', async () => {
    harness.addPathway('pw', oneGate(HGB_LOW));
    const id = await start('pw', TWO_UNDATED);
    await answer(id, { numericValue: 8.4 });

    expect(session(id).additionalContext.labResults).toEqual([
      expect.objectContaining({ code: '718-7', value: 8.4, date: PINNED, providerAsserted: true }),
    ]);
    expect(session(id).pendingQuestions).toEqual([]);
    expect(status(id, 'step')).toBe(NodeStatus.INCLUDED);
    expect(lastEvent()).toMatchObject({ eventType: 'PROVIDER_ASSERTED_DATUM', triggerData: { value: 8.4, assertedAsOf: PINNED } });
  });

  it('a boolean answer to a lab datum is refused', async () => {
    harness.addPathway('pw', oneGate(HGB_LOW));
    const id = await start('pw', TWO_UNDATED);
    await expect(answer(id, { booleanValue: true })).rejects.toThrow(/supply numericValue/);
    expect(session(id).revision).toBe(0);
  });
});

describe('a window_from start date', () => {
  const RECHECK = { labResults: [
    { code: '718-7', system: 'LOINC', value: 8.2, date: '2026-08-01' },
    { code: '718-7', system: 'LOINC', value: 9.6, date: '2026-08-29' },
  ] };

  it('is asked as a DATE when no source resolves the anchor', async () => {
    harness.addPathway('pw', ANCHORED);
    const id = await start('pw', RECHECK);
    expect(session(id).pendingQuestions[0]).toMatchObject({
      answerType: AnswerType.DATE, askTarget: { kind: 'anchor', key: ANCHOR_KEY },
    });
  });

  it('is stored under the ANCHOR key — never the gate id — and re-anchors the gate', async () => {
    harness.addPathway('pw', ANCHORED);
    const id = await start('pw', RECHECK);
    await answer(id, { dateValue: '2026-08-01' });

    expect(session(id).gateAnswers.get(ANCHOR_KEY)).toEqual({ dateValue: '2026-08-01' });
    expect(session(id).gateAnswers.has('gate')).toBe(false);
    expect(session(id).pendingQuestions).toEqual([]);
    expect(status(id, 'step')).toBe(NodeStatus.INCLUDED);
    expect(session(id).resolutionState.get('gate')!.windowAnchors?.[0]).toMatchObject({ source: 'CLINICIAN', date: '2026-08-01' });
  });

  it('can be corrected on a gate whose anchor already resolved', async () => {
    harness.addPathway('pw', ANCHORED);
    const id = await start('pw', RECHECK);
    await answer(id, { dateValue: '2026-08-01' });
    await answer(id, { dateValue: '2026-08-10' });
    expect(session(id).gateAnswers.get(ANCHOR_KEY)).toEqual({ dateValue: '2026-08-10' });
  });

  it('refuses a date after the session clock, and a dateValue sent with another field', async () => {
    harness.addPathway('pw', ANCHORED);
    const id = await start('pw', RECHECK);
    await expect(answer(id, { dateValue: '2026-09-15' })).rejects.toThrow(/after this session's evaluation date/);
    await expect(answer(id, { dateValue: '2026-08-01', numericValue: 1 })).rejects.toThrow(/dateValue alone/);
    expect(session(id).revision).toBe(0);
  });
});
