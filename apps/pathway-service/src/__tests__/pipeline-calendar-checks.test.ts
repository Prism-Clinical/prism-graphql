/**
 * The calendar checks over the REAL pipeline (fixtures/resolver-harness): a
 * session pinned to a clock decides `encounter.date in_season` and a
 * `{ since }` horizon from that clock — at creation and on every later
 * evaluation of the same session — and never asks a question for either.
 * Unit-level behaviour is in `calendar-checks.test.ts`.
 */
jest.mock('../services/resolution/session-store', () => require('./fixtures/resolver-harness').sessionStoreMock());
jest.mock('../services/resolution/pipeline/load-env', () => require('./fixtures/resolver-harness').loadEnvMock());
jest.mock('../resolvers/helpers/therapy-starts', () => ({
  ...jest.requireActual('../resolvers/helpers/therapy-starts'),
  loadCarePlanTherapyStarts: jest.fn(async () => []),
}));

import { resolutionMutations } from '../resolvers/mutations/resolution';
import { DefaultBehavior, GateType, NodeStatus } from '../services/resolution/types';
import { harness } from './fixtures/resolver-harness';
import { edge, makeEnv, node } from './fixtures/pipeline-env';

const FLU = 'FLU-VAX';
const gate = (id: string, props: Record<string, unknown>) =>
  node(id, 'Gate', { title: id, default_behavior: DefaultBehavior.SKIP, on_unresolved: 'ask', ...props });

const PATHWAY = makeEnv(
  [
    node('root', 'Pathway'),
    // RSV vaccine: in season AND at 32 weeks or later.
    gate('gate-rsv', {
      gate_type: GateType.COMPOUND, operator: 'AND',
      conditions: [
        { attribute: 'encounter.date', operator: 'in_season', from: '09-01', to: '01-31' },
        { attribute: 'patient.gestational_age_weeks', operator: 'greater_or_equal', value: 32 },
      ],
    }),
    node('step-rsv', 'Step', { title: 'Offer RSV vaccine' }),
    // Influenza vaccine: none given since the most recent July 1.
    gate('gate-flu-owed', {
      gate_type: GateType.PATIENT_ATTRIBUTE,
      condition: {
        field: 'medications', operator: 'count_in_window', value: FLU, system: 'CVX', status: 'any',
        count_threshold: 1, count_comparison: 'less_than', horizon: { since: '07-01' },
      },
    }),
    node('step-flu', 'Step', { title: 'Offer influenza vaccine' }),
  ],
  [
    edge('root', 'gate-rsv', 'HAS_GATE'), edge('gate-rsv', 'step-rsv'),
    edge('root', 'gate-flu-owed', 'HAS_GATE'), edge('gate-flu-owed', 'step-flu'),
  ],
);

const ctx = (version = 'v1') => harness.context({ temporalPolicyVersion: version });
async function start(evaluationAsOf: string, patient: Record<string, unknown> = {}, version = 'v1'): Promise<string> {
  const s = await resolutionMutations.startResolution(null as never, {
    pathwayId: 'pw', patientId: 'pt-1', resolutionMode: 'SYNTHETIC', evaluationAsOf,
    patientContext: { patientId: 'pt-1', conditionCodes: [], medications: [], allergies: [], labResults: [], ...patient },
  } as never, ctx(version));
  return (s as { id: string }).id;
}
const session = (id: string) => harness.session(id);
const status = (id: string, nodeId: string) => session(id).resolutionState.get(nodeId)?.status;
const reason = (id: string, nodeId: string) => session(id).resolutionState.get(nodeId)?.excludeReason;

const AT_34_WEEKS = { patientAttributes: { gestational_age_weeks: 34 } };
const fluGiven = (date: string) => ({ medications: [{ code: FLU, system: 'CVX', date }] });

beforeEach(() => {
  harness.reset();
  harness.addPathway('pw', PATHWAY);
});

describe('a session pinned to a clock inside the season', () => {
  it('offers both: in season at 34 weeks, and no influenza vaccine since July 1', async () => {
    const id = await start('2026-10-04T12:00:00.000Z', { ...AT_34_WEEKS, ...fluGiven('2025-10-20') });
    expect(session(id).pendingQuestions).toEqual([]);
    expect(status(id, 'step-rsv')).toBe(NodeStatus.INCLUDED);
    expect(status(id, 'step-flu')).toBe(NodeStatus.INCLUDED);
  });

  it('an influenza vaccine given this season closes the "owed" gate, with the window in the reason', async () => {
    const id = await start('2026-10-04T12:00:00.000Z', { ...AT_34_WEEKS, ...fluGiven('2026-09-15') });
    expect(status(id, 'step-flu')).toBe(NodeStatus.GATED_OUT);
    expect(reason(id, 'gate-flu-owed')).toBe(`Found 1 matching ${FLU} in medications since 2026-07-01 (this season) (≥1)`);
  });

  it('with the gestational age missing, THAT is asked — never the date', async () => {
    const id = await start('2026-10-04T12:00:00.000Z');
    expect(session(id).pendingQuestions.map((q) => q.datumKey)).toEqual(['patient.gestational_age_weeks']);
    expect(status(id, 'gate-rsv')).toBe(NodeStatus.PENDING_QUESTION);
  });
});

describe('a session pinned to a clock outside the season', () => {
  it('closes the RSV gate without a question, even with the gestational age missing', async () => {
    const id = await start('2026-06-30T12:00:00.000Z');
    expect(session(id).pendingQuestions).toEqual([]);
    expect(status(id, 'gate-rsv')).toBe(NodeStatus.GATED_OUT);
    expect(reason(id, 'gate-rsv')).toContain('Session date 2026-06-30 is outside the season 09-01 to 01-31');
  });

  it('on Jun 30 "this season" is still the one that opened the previous Jul 1', async () => {
    const given = await start('2026-06-30T12:00:00.000Z', fluGiven('2025-10-20'));
    expect(status(given, 'step-flu')).toBe(NodeStatus.GATED_OUT);
    expect(reason(given, 'gate-flu-owed')).toContain('since 2025-07-01 (this season)');
    // One day later the same vaccine belongs to last season.
    const nextDay = await start('2026-07-01T12:00:00.000Z', fluGiven('2025-10-20'));
    expect(status(nextDay, 'step-flu')).toBe(NodeStatus.INCLUDED);
  });
});

describe('replay', () => {
  it('a later evaluation of the same session answers from the PINNED clock, whatever the wall clock says', async () => {
    const id = await start('2026-10-04T12:00:00.000Z', { ...AT_34_WEEKS, ...fluGiven('2025-10-20') });
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
    try {
      // The wall clock moves to mid-summer two years on; the session does not.
      jest.setSystemTime(new Date('2028-06-15T12:00:00.000Z'));
      await resolutionMutations.addPatientContext(
        null,
        { sessionId: id, additionalContext: { patientAttributes: { gestational_age_weeks: 35 } } } as never,
        ctx(),
      );
    } finally {
      jest.useRealTimers();
    }
    expect(status(id, 'step-rsv')).toBe(NodeStatus.INCLUDED);
    expect(status(id, 'step-flu')).toBe(NodeStatus.INCLUDED);
  });
});

describe('legacy-v0 session', () => {
  it('refuses both, and says why', async () => {
    const id = await start('2026-10-04T12:00:00.000Z', { ...AT_34_WEEKS, ...fluGiven('2025-10-20') }, 'legacy-v0');
    expect(status(id, 'gate-rsv')).toBe(NodeStatus.GATED_OUT);
    expect(reason(id, 'gate-rsv')).toContain('in_season requires the v1 temporal kernel; legacy-v0 cannot evaluate it');
    expect(status(id, 'gate-flu-owed')).toBe(NodeStatus.GATED_OUT);
    expect(reason(id, 'gate-flu-owed')).toBe('horizon { since } requires the v1 temporal kernel; legacy-v0 cannot evaluate it');
  });
});
