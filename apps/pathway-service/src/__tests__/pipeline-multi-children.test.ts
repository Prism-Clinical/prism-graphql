jest.mock('../services/resolution/session-store', () => require('./fixtures/resolver-harness').sessionStoreMock());
jest.mock('../services/resolution/pipeline/load-env', () => require('./fixtures/resolver-harness').loadEnvMock());
jest.mock('../services/resolution/lattice-collapse', () => ({ collapseLattice: jest.fn(async (_pool: unknown, m: unknown) => m) }));
jest.mock('../services/resolution/multi-pathway-session-store', () => ({
  createMultiPathwaySession: jest.fn(async () => 'mp-1'),
  getMultiPathwaySession: jest.fn(async () => ({
    id: 'mp-1', patientId: 'pt-1', providerId: 'provider-1', status: 'ACTIVE', isPreview: false,
    initialPatientContext: {}, contributingSessionIds: [], contributingPathwayIds: [],
    mergedPlan: { sourcePathwayIds: [], medications: [], labs: [], procedures: [], schedules: [], qualityMetrics: [], suppressed: [], conflicts: [] },
    conflictResolutions: {}, carePlanId: null, ddiWarnings: [], createdAt: new Date(), updatedAt: new Date(),
  })),
  getPatientMultiPathwaySessions: jest.fn(),
  markMultiPathwaySessionStatus: jest.fn(),
  updateMergedPlanAndResolutions: jest.fn(),
}));

import { multiPathwayResolutionMutations } from '../resolvers/mutations/multi-pathway-resolution';
import { resolutionMutations } from '../resolvers/mutations/resolution';
import { getMatchedPathways } from '../services/resolution/session-store';
import { AnswerType, DefaultBehavior, GateType, NodeStatus } from '../services/resolution/types';
import { harness } from './fixtures/resolver-harness';
import { edge, makeEnv, node } from './fixtures/pipeline-env';

const ENV = makeEnv(
  [
    node('root', 'Pathway'),
    node('gate-b', 'Gate', { gate_type: GateType.QUESTION, default_behavior: DefaultBehavior.SKIP, answer_type: AnswerType.BOOLEAN, prompt: 'Symptomatic?' }),
    node('step-yes', 'Step'), node('step-no', 'Step'),
  ],
  [
    edge('root', 'gate-b', 'HAS_GATE'),
    edge('gate-b', 'step-yes', 'BRANCHES_TO', { when: { equals: true } }),
    edge('gate-b', 'step-no', 'BRANCHES_TO', { when: { equals: false } }),
  ],
);
const matched = (id: string) => ({
  pathway: { id, logicalId: `lp-${id}`, title: id, version: '1', category: 'CHRONIC_DISEASE', status: 'ACTIVE', conditionCodes: [] },
  matched: true, matchedSets: [], mostSpecificMatchedSet: { setId: 's', scope: 'EXACT', members: [], memberCount: 0 },
  specificityDepth: 1, patientCodesAddressed: [], patientCodesUnaddressed: [], matchScore: 1, matchedConditionCodes: [],
});

beforeEach(() => {
  harness.reset();
  harness.addPathway('pw-a', ENV);
});

it('a child session created by a run is stored with inputs and is answerable through answerPendingDecision', async () => {
  (getMatchedPathways as jest.Mock).mockResolvedValue([matched('pw-a')]);
  await multiPathwayResolutionMutations.startMultiPathwayResolution(
    {}, { patientId: 'pt-1' } as never, harness.context({ temporalPolicyVersion: 'legacy-v0' }),
  );

  const [childId] = harness.sessionIds();
  expect(harness.session(childId).graphFingerprint).toBe(ENV.graphFingerprint);
  expect(harness.session(childId).pendingQuestions.map((q) => q.gateId)).toEqual(['gate-b']);

  await resolutionMutations.answerPendingDecision(
    null, { sessionId: childId, nodeId: 'gate-b', answer: { booleanValue: true } }, harness.context({ temporalPolicyVersion: 'legacy-v0' }),
  );
  expect(harness.session(childId).resolutionState.get('step-yes')!.status).toBe(NodeStatus.INCLUDED);
  expect(harness.session(childId).revision).toBe(1);
});
