/**
 * Matching a medication by ingredient or class over the REAL pipeline
 * (fixtures/resolver-harness): the identification comes from the evaluation
 * environment's normalisation cache, is PINNED in the session the first time
 * it is used, and a medication that cannot be identified is asked about by
 * name. Unit-level behaviour is in `medication-classes.test.ts`.
 */
jest.mock('../services/resolution/session-store', () => require('./fixtures/resolver-harness').sessionStoreMock());
jest.mock('../services/resolution/pipeline/load-env', () => require('./fixtures/resolver-harness').loadEnvMock());
jest.mock('../resolvers/helpers/therapy-starts', () => ({
  ...jest.requireActual('../resolvers/helpers/therapy-starts'),
  loadCarePlanTherapyStarts: jest.fn(async () => []),
}));

import { resolutionMutations } from '../resolvers/mutations/resolution';
import { AnswerType, DefaultBehavior, GateType, NodeStatus } from '../services/resolution/types';
import { evaluate } from '../services/resolution/pipeline/evaluate';
import { replayObservations } from '../services/resolution/pipeline/observations';
import { isMedicationObservation } from '../services/resolution/pipeline/types';
import type { NormalizedMedication } from '../services/medications/types';
import { harness } from './fixtures/resolver-harness';
import { edge, makeEnv, node } from './fixtures/pipeline-env';

const PINNED = '2026-10-04T12:00:00.000Z';
const actualStore = () => jest.requireActual('../services/resolution/session-store') as typeof import('../services/resolution/session-store');

const FLU = ['1657128', '1657131', '1657134'];
const normalized = (ingredientRxcuis: string[], productAtcClasses: string[]): NormalizedMedication => ({
  ingredientRxcui: ingredientRxcuis[0], ingredientName: 'first ingredient', atcClasses: [],
  classification: { ingredientRxcuis, ingredientNames: ingredientRxcuis.map((r) => `in-${r}`), productAtcClasses },
});
/** The cache, keyed as the service keys it: lower-cased text | system | code. */
const CACHE = (rows: Record<string, NormalizedMedication>) => ({ normalized: new Map(Object.entries(rows)) });
const FLUBLOK_KEY = 'flublok 2026-2027|RXNORM|2746449';
const FLUBLOK = { code: '2746449', system: 'RXNORM', display: 'Flublok 2026-2027', date: '2026-09-22' };
const FLUCELVAX_LAST = { code: '2718382', system: 'RXNORM', display: 'Flucelvax 2025-2026', date: '2025-10-20' };
const MYSTERY = { code: '9999999', system: 'RXNORM', display: 'Flublok Quadrivalent 2026', date: '2026-09-22' };
const MYSTERY_KEY = 'medclass:RXNORM_INGREDIENT:1657128:flublok quadrivalent 2026|RXNORM|9999999';

const OWED = {
  field: 'medications', operator: 'count_in_window', value: '1657128', system: 'RXNORM_INGREDIENT',
  display: 'an influenza vaccine', status: 'any', count_threshold: 1, count_comparison: 'less_than',
  horizon: { since: '09-01' },
};
const pathway = (safety: Parameters<typeof makeEnv>[2], gateExtra: Record<string, unknown> = {}) => makeEnv(
  [
    node('root', 'Pathway'),
    node('gate-flu-owed', 'Gate', {
      title: 'Influenza vaccine owed', gate_type: GateType.PATIENT_ATTRIBUTE, default_behavior: DefaultBehavior.SKIP,
      on_unresolved: 'ask', condition: OWED, ...gateExtra,
    }),
    node('step-offer', 'Step', { title: 'Offer influenza vaccine' }),
  ],
  [edge('root', 'gate-flu-owed', 'HAS_GATE'), edge('gate-flu-owed', 'step-offer')],
  safety,
);
const IDENTIFIED = CACHE({
  [FLUBLOK_KEY]: normalized(FLU, ['J07BB']),
  'flucelvax 2025-2026|RXNORM|2718382': normalized(FLU, ['J07BB']),
});

const ctx = (version = 'v1') => harness.context({ temporalPolicyVersion: version });
async function start(medications: Array<Record<string, unknown>>, version = 'v1'): Promise<string> {
  const s = await resolutionMutations.startResolution(null as never, {
    pathwayId: 'pw', patientId: 'pt-1', resolutionMode: 'SYNTHETIC', evaluationAsOf: PINNED,
    patientContext: { patientId: 'pt-1', conditionCodes: [], medications, allergies: [], labResults: [] },
  } as never, ctx(version));
  return (s as { id: string }).id;
}
const answer = (sessionId: string, a: Record<string, unknown>, nodeId = 'gate-flu-owed') =>
  resolutionMutations.answerPendingDecision(null, { sessionId, nodeId, answer: a } as never, ctx());
const reevaluate = (sessionId: string) =>
  resolutionMutations.addPatientContext(null, { sessionId, additionalContext: { vitalSigns: { heart_rate: 80 } } } as never, ctx());
const session = (id: string) => harness.session(id);
const status = (id: string, nodeId: string) => session(id).resolutionState.get(nodeId)?.status;
const reason = (id: string, nodeId: string) => session(id).resolutionState.get(nodeId)?.excludeReason;
const medObservations = (id: string) => [...session(id).observations.values()].filter(isMedicationObservation);

beforeEach(() => {
  harness.reset();
  harness.addPathway('pw', pathway(IDENTIFIED));
});

describe('an identified medication decides the gate by what it is', () => {
  it('this season\'s brand product: given — the offer is closed, and the reason names it', async () => {
    const id = await start([FLUBLOK]);
    expect(session(id).pendingQuestions).toEqual([]);
    expect(status(id, 'step-offer')).toBe(NodeStatus.GATED_OUT);
    expect(reason(id, 'gate-flu-owed')).toBe(
      'Found 1 on the medication list matching an influenza vaccine (Flublok 2026-2027) since 2026-09-01 (this season) (≥1)',
    );
  });

  it('last season\'s brand product is an influenza vaccine too — and not one given this season: offered', async () => {
    const id = await start([FLUCELVAX_LAST]);
    expect(session(id).pendingQuestions).toEqual([]);
    expect(status(id, 'step-offer')).toBe(NodeStatus.INCLUDED);
  });

  it('no medications at all: offered, nothing asked', async () => {
    const id = await start([]);
    expect(session(id).pendingQuestions).toEqual([]);
    expect(status(id, 'step-offer')).toBe(NodeStatus.INCLUDED);
  });
});

describe('a medication the cache cannot identify (RxNav had no match, or was down)', () => {
  it('the gate pends on a question that names the entry — never a silent "owed"', async () => {
    const id = await start([MYSTERY]);
    expect(status(id, 'gate-flu-owed')).toBe(NodeStatus.PENDING_QUESTION);
    expect(status(id, 'step-offer')).toBe(NodeStatus.PENDING_QUESTION);
    expect(session(id).pendingQuestions).toHaveLength(1);
    expect(session(id).pendingQuestions[0]).toMatchObject({
      gateId: 'gate-flu-owed', datumKey: MYSTERY_KEY, answerType: AnswerType.BOOLEAN,
      askTarget: { kind: 'medication_class', key: MYSTERY_KEY },
      prompt: '"Flublok Quadrivalent 2026" is on the medication list and could not be identified. Does it count as an influenza vaccine?',
    });
    // Nothing was pinned for it: a later evaluation looks again.
    expect(medObservations(id)).toEqual([]);
  });

  it('"yes": it counts, dated as the chart entry is — the offer closes', async () => {
    const id = await start([MYSTERY]);
    await answer(id, { booleanValue: true });
    expect(session(id).gateAnswers.get(MYSTERY_KEY)).toEqual({ booleanValue: true });
    // Not a fact about the chart: nothing is added to the patient's medications.
    expect(session(id).additionalContext).toEqual({});
    expect(session(id).pendingQuestions).toEqual([]);
    expect(status(id, 'step-offer')).toBe(NodeStatus.GATED_OUT);
    expect(harness.tables.events.at(-1)).toMatchObject({
      eventType: 'PROVIDER_ASSERTED_DATUM',
      triggerData: { datumKey: MYSTERY_KEY, value: true, answerType: AnswerType.BOOLEAN },
    });
  });

  it('"no": it is excluded — the vaccine is owed and offered', async () => {
    const id = await start([MYSTERY]);
    await answer(id, { booleanValue: false });
    expect(session(id).pendingQuestions).toEqual([]);
    expect(status(id, 'step-offer')).toBe(NodeStatus.INCLUDED);
  });

  it('"Not available": nothing more is asked, and the gate takes its default (skip)', async () => {
    const id = await start([MYSTERY]);
    await answer(id, { notAvailable: true });
    expect(session(id).gateAnswers.get(`declined:${MYSTERY_KEY}`)).toEqual({ notAvailable: true });
    expect(session(id).pendingQuestions).toEqual([]);
    expect(status(id, 'gate-flu-owed')).toBe(NodeStatus.GATED_OUT);
    expect(reason(id, 'gate-flu-owed')).toContain('Cannot tell whether Flublok Quadrivalent 2026 on the medication list is an influenza vaccine');
  });

  it('"Not available" with on_declined "traverse": the vaccine is offered', async () => {
    harness.addPathway('pw', pathway(IDENTIFIED, { on_declined: 'traverse' }));
    const id = await start([MYSTERY]);
    await answer(id, { notAvailable: true });
    expect(session(id).pendingQuestions).toEqual([]);
    expect(status(id, 'step-offer')).toBe(NodeStatus.INCLUDED);
  });

  it('the answer must be a yes/no', async () => {
    const id = await start([MYSTERY]);
    await expect(answer(id, { numericValue: 1 })).rejects.toMatchObject({ extensions: { code: 'BAD_USER_INPUT' } });
    await expect(answer(id, { booleanValue: true, observedOn: '2026-09-22' })).rejects.toMatchObject({ extensions: { code: 'BAD_USER_INPUT' } });
    expect(session(id).pendingQuestions).toHaveLength(1);
  });

  it('identified by a later evaluation (the lookup finished): the question goes away by itself', async () => {
    const id = await start([MYSTERY]);
    expect(session(id).pendingQuestions).toHaveLength(1);
    harness.addPathway('pw', pathway(CACHE({ 'flublok quadrivalent 2026|RXNORM|9999999': normalized(FLU, ['J07BB']) })));
    await reevaluate(id);
    expect(session(id).pendingQuestions).toEqual([]);
    expect(status(id, 'step-offer')).toBe(NodeStatus.GATED_OUT);
  });
});

describe('pinning and replay', () => {
  it('the identification a session used is recorded with the session', async () => {
    const id = await start([FLUBLOK]);
    expect(medObservations(id)).toEqual([{
      key: `med:${FLUBLOK_KEY}`, kind: 'medication',
      ingredientRxcuis: FLU, ingredientNames: FLU.map((r) => `in-${r}`), productAtcClasses: ['J07BB'],
    }]);
  });

  it('a medication no class gate was asked about is not recorded', async () => {
    harness.addPathway('pw', makeEnv([node('root', 'Pathway'), node('step', 'Step')], [edge('root', 'step')], IDENTIFIED));
    const id = await start([FLUBLOK]);
    expect(medObservations(id)).toEqual([]);
  });

  it('re-evaluating a stored session after the cache row CHANGED gives the same result', async () => {
    const id = await start([FLUBLOK]);
    const before = { hash: session(id).resultHash, offer: status(id, 'step-offer'), why: reason(id, 'gate-flu-owed') };
    expect(before.offer).toBe(NodeStatus.GATED_OUT);

    // The cache row is rewritten to say this product is NOT an influenza vaccine.
    const changed = CACHE({ [FLUBLOK_KEY]: normalized(['4511'], ['B03BB']) });
    harness.addPathway('pw', pathway(changed));
    await reevaluate(id);

    expect({ hash: session(id).resultHash, offer: status(id, 'step-offer'), why: reason(id, 'gate-flu-owed') }).toEqual(before);

    // The cache really did change: a NEW session reads the new row and decides the other way.
    const fresh = await start([FLUBLOK]);
    expect(status(fresh, 'step-offer')).toBe(NodeStatus.INCLUDED);
  });

  it('when the row is DELETED (or RxNav is down at re-evaluation) the GATE still decides as it did', async () => {
    const id = await start([FLUBLOK]);
    const before = { offer: status(id, 'step-offer'), why: reason(id, 'gate-flu-owed') };
    harness.addPathway('pw', pathway(CACHE({})));
    await reevaluate(id);
    expect({ offer: status(id, 'step-offer'), why: reason(id, 'gate-flu-owed') }).toEqual(before);
    expect(session(id).pendingQuestions).toEqual([]);
    // What is NOT pinned is drug safety: it reads the live cache, as it always
    // has, so a medication that is no longer normalised is reported as one that
    // cannot be safety-checked — and the result hash, which covers that, moves.
    expect(session(id).readiness.blockers.map((b) => b.type)).toContain('SAFETY_DATA_UNAVAILABLE');
  });

  it('replay — the stored inputs and observations alone — reproduces the result, whatever the cache says now', async () => {
    const id = await start([FLUBLOK]);
    const stored = session(id);
    const inputs = actualStore().inputsOf(stored);
    const replay = async (cache: ReturnType<typeof CACHE>) => {
      const env = pathway(cache);
      return evaluate(inputs, env, replayObservations(inputs.observations, env.llmModel ?? ''), 'ROOT');
    };
    // The row unchanged, and the row rewritten to another drug: identical, hash included.
    for (const cache of [IDENTIFIED, CACHE({ [FLUBLOK_KEY]: normalized(['4511'], ['B03BB']) })]) {
      const replayed = await replay(cache);
      expect(replayed.resultHash).toBe(stored.resultHash);
      expect(replayed.observationsUsed).toEqual([`med:${FLUBLOK_KEY}`]);
    }
    // The row gone: every gate and node decides identically (only the safety blocker differs).
    const gone = await replay(CACHE({}));
    expect([...gone.resolutionState.values()].map((n) => [n.nodeId, n.status, n.excludeReason]))
      .toEqual([...stored.resolutionState.values()].map((n) => [n.nodeId, n.status, n.excludeReason]));
    expect(gone.pendingQuestions).toEqual([]);
  });

  it('two sessions from the same inputs agree; a different identification gives a different result', async () => {
    const a = await start([FLUBLOK]);
    const b = await start([FLUBLOK]);
    expect(session(a).resultHash).toBe(session(b).resultHash);
    const c = await start([FLUCELVAX_LAST]);
    expect(session(c).resultHash).not.toBe(session(a).resultHash);
  });
});

describe('legacy-v0 session', () => {
  it('refuses the class condition and says why', async () => {
    const id = await start([FLUBLOK], 'legacy-v0');
    expect(status(id, 'gate-flu-owed')).toBe(NodeStatus.GATED_OUT);
    expect(reason(id, 'gate-flu-owed')).toBe(
      'matching a medication by RXNORM_INGREDIENT requires the v1 temporal kernel; legacy-v0 cannot evaluate it',
    );
  });
});
