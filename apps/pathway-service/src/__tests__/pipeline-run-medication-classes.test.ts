/**
 * Medication class gates inside a multi-pathway RUN (the encounter screen's
 * path): the identification is pinned on the child session through the run's
 * commit, a re-evaluation of the stored run after the cache row changed decides
 * the gate as before, and the unidentified-medication question is answered on
 * the child. Single-session behaviour is in `pipeline-medication-classes.test.ts`.
 */
jest.mock('../services/resolution/session-store', () => require('./fixtures/resolver-harness').sessionStoreMock());
jest.mock('../services/resolution/multi-pathway-session-store', () => require('./fixtures/resolver-harness').runStoreMock());
jest.mock('../services/resolution/pipeline/load-env', () => require('./fixtures/resolver-harness').loadEnvMock());
jest.mock('../services/resolution/lattice-collapse', () => require('./fixtures/resolver-harness').latticeMock());

import { multiPathwayResolutionMutations } from '../resolvers/mutations/multi-pathway-resolution';
import { resolutionMutations } from '../resolvers/mutations/resolution';
import { DefaultBehavior, GateType, NodeStatus } from '../services/resolution/types';
import { isMedicationObservation } from '../services/resolution/pipeline/types';
import type { NormalizedMedication } from '../services/medications/types';
import { harness } from './fixtures/resolver-harness';
import { edge, makeEnv, node } from './fixtures/pipeline-env';

const PINNED = '2026-10-04T12:00:00.000Z';
const FLU = ['1657128', '1657131', '1657134'];
const normalized = (ingredientRxcuis: string[], productAtcClasses: string[]): NormalizedMedication => ({
  ingredientRxcui: ingredientRxcuis[0], ingredientName: 'first', atcClasses: [],
  classification: { ingredientRxcuis, ingredientNames: ingredientRxcuis, productAtcClasses },
});
const FLUBLOK_KEY = 'flublok 2026-2027|RXNORM|2746449';
const FLUBLOK = { code: '2746449', system: 'RXNORM', display: 'Flublok 2026-2027', date: '2026-09-22' };
const MYSTERY = { code: '9999999', system: 'RXNORM', display: 'Flublok Quadrivalent 2026', date: '2026-09-22' };
const MYSTERY_KEY = 'medclass:RXNORM_INGREDIENT:1657128:flublok quadrivalent 2026|RXNORM|9999999';

const fluPathway = (cache: Record<string, NormalizedMedication>) => makeEnv(
  [
    node('root', 'Pathway'),
    node('gate-flu-owed', 'Gate', {
      title: 'Influenza vaccine owed', gate_type: GateType.PATIENT_ATTRIBUTE, default_behavior: DefaultBehavior.SKIP, on_unresolved: 'ask',
      condition: {
        field: 'medications', operator: 'count_in_window', value: '1657128', system: 'RXNORM_INGREDIENT',
        display: 'an influenza vaccine', status: 'any', count_threshold: 1, count_comparison: 'less_than', horizon: { since: '09-01' },
      },
    }),
    node('step-offer', 'Step', { title: 'Offer influenza vaccine' }),
  ],
  [edge('root', 'gate-flu-owed', 'HAS_GATE'), edge('gate-flu-owed', 'step-offer')],
  { normalized: new Map(Object.entries(cache)) },
);
const otherPathway = () => makeEnv([node('root', 'Pathway'), node('step', 'Step')], [edge('root', 'step')]);

const ctx = () => harness.context({ temporalPolicyVersion: 'v1' });
async function startRun(medications: Array<Record<string, unknown>>): Promise<string> {
  harness.matchPathways('pw-flu', 'pw-other');
  const run = await multiPathwayResolutionMutations.startMultiPathwayResolution(null as never, {
    patientId: 'pt-1', resolutionMode: 'SYNTHETIC', evaluationAsOf: PINNED, syntheticPatient: true,
    patientContext: { patientId: 'pt-1', conditionCodes: [], medications, allergies: [], labResults: [] },
  } as never, ctx()) as unknown as { id: string };
  return run.id;
}
const child = (runId: string) => {
  const r = harness.run(runId);
  return harness.session(r.contributingSessionIds[r.contributingPathwayIds.indexOf('pw-flu')]);
};
const reevaluate = (runId: string) =>
  multiPathwayResolutionMutations.addEncounterContext(
    null as never, { sessionId: runId, additionalContext: { vitalSigns: { heart_rate: 80 } } } as never, ctx(),
  );

beforeEach(() => {
  harness.reset();
  harness.addPathway('pw-flu', fluPathway({ [FLUBLOK_KEY]: normalized(FLU, ['J07BB']) }));
  harness.addPathway('pw-other', otherPathway());
});

it('a run pins the identification on the child that used it, and only there', async () => {
  const runId = await startRun([FLUBLOK]);
  expect(child(runId).resolutionState.get('step-offer')!.status).toBe(NodeStatus.GATED_OUT);
  expect([...child(runId).observations.values()].filter(isMedicationObservation)).toEqual([
    { key: `med:${FLUBLOK_KEY}`, kind: 'medication', ingredientRxcuis: FLU, ingredientNames: FLU, productAtcClasses: ['J07BB'] },
  ]);
  const run = harness.run(runId);
  const other = harness.session(run.contributingSessionIds[run.contributingPathwayIds.indexOf('pw-other')]);
  expect([...other.observations.values()]).toEqual([]);
});

it('re-evaluating the stored run after the cache row changed decides the gate as before', async () => {
  const runId = await startRun([FLUBLOK]);
  const before = child(runId).resolutionState.get('gate-flu-owed')!;

  // The row now says this product is folic acid.
  harness.addPathway('pw-flu', fluPathway({ [FLUBLOK_KEY]: normalized(['4511'], ['B03BB']) }));
  await reevaluate(runId);

  const after = child(runId).resolutionState.get('gate-flu-owed')!;
  expect({ status: after.status, reason: after.excludeReason }).toEqual({ status: before.status, reason: before.excludeReason });
  expect(child(runId).resolutionState.get('step-offer')!.status).toBe(NodeStatus.GATED_OUT);
  expect(child(runId).pendingQuestions).toEqual([]);

  // A NEW run reads the changed row and decides the other way.
  const fresh = await startRun([FLUBLOK]);
  expect(child(fresh).resolutionState.get('step-offer')!.status).toBe(NodeStatus.INCLUDED);
});

it('an unidentified medication is asked about on the child, and the answer decides the run\'s gate', async () => {
  const runId = await startRun([MYSTERY]);
  const c = child(runId);
  expect(c.pendingQuestions).toHaveLength(1);
  expect(c.pendingQuestions[0]).toMatchObject({ gateId: 'gate-flu-owed', datumKey: MYSTERY_KEY, askTarget: { kind: 'medication_class', key: MYSTERY_KEY } });

  await resolutionMutations.answerPendingDecision(null, { sessionId: c.id, nodeId: 'gate-flu-owed', answer: { booleanValue: true } }, ctx());
  expect(child(runId).pendingQuestions).toEqual([]);
  expect(child(runId).resolutionState.get('step-offer')!.status).toBe(NodeStatus.GATED_OUT);
  expect(child(runId).gateAnswers.get(MYSTERY_KEY)).toEqual({ booleanValue: true });
});
