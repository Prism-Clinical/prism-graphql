/**
 * Drug-interaction checking runs after EVERY resolution that changes the plan.
 *
 * It used to run once, at session creation. Every mutation that re-resolves can
 * bring a medication into the plan — a branch chosen at a DecisionPoint, a gate
 * opened by an answer, a node included by an override — and adding medications
 * to the patient context changes the other side of the check. So a care plan
 * could be generated from medication state that never passed DDI.
 *
 * These assert the CALL, which is the thing that was missing. What the pass
 * itself concludes is `ddi-pass`'s own business and is mocked here.
 *
 * Engines are real; only the database seams are mocked.
 */

jest.mock('../resolvers/Query', () => ({
  PATHWAY_COLUMNS: 'id, version, status',
  formatSessionForGraphQL: (s: unknown) => s,
  hydrateSignalDefinition: (row: unknown) => row,
}));

jest.mock('../services/resolution/session-store', () => ({
  createSession: jest.fn().mockResolvedValue('session-1'),
  getSession: jest.fn(),
  updateSession: jest.fn().mockResolvedValue(undefined),
  logEvent: jest.fn().mockResolvedValue(undefined),
  logNodeOverride: jest.fn().mockResolvedValue(undefined),
  logGateAnswer: jest.fn().mockResolvedValue(undefined),
  getMatchedPathways: jest.fn().mockResolvedValue([]),
}));

jest.mock('../services/medications/ddi-pass-single-pathway', () => ({
  applyDdiToResolutionState: jest.fn().mockResolvedValue({ findings: [] }),
}));

const mockBuild = jest.fn();
const scores: Record<string, number> = {};
jest.mock('../resolvers/helpers/resolution-context', () => ({
  ...jest.requireActual('../resolvers/helpers/resolution-context'),
  buildResolutionContext: (...a: unknown[]) => mockBuild(...a),
  makeTraversalAdapter: jest.fn(() => ({
    computeNodeConfidence: jest.fn(async (n: { nodeIdentifier: string }) => ({
      nodeIdentifier: n.nodeIdentifier,
      nodeType: 'Step',
      confidence: scores[n.nodeIdentifier] ?? 0.9,
      breakdown: [],
      propagationInfluences: [],
      resolutionType: 'AUTO_RESOLVED',
    })),
  })),
  makeLlmGateEvaluator: jest.fn(() => null),
}));

import { createSession, getSession } from '../services/resolution/session-store';
import { resolutionMutations } from '../resolvers/mutations/resolution';
import { makeGraphContext } from './fixtures/reference-patient-context';
import { NodeStatus, SessionStatus } from '../services/resolution/types';
import type { NodeResult, PendingQuestion } from '../services/resolution/types';
import type { GraphEdge, GraphNode } from '../services/confidence/types';

const mockedCreateSession = createSession as jest.MockedFunction<typeof createSession>;
const mockedGetSession = getSession as jest.MockedFunction<typeof getSession>;

const PINNED = '2026-08-31T12:00:00.000Z';

function node(id: string, nodeType: string, properties: Record<string, unknown> = {}): GraphNode {
  return { id, nodeIdentifier: id, nodeType, properties: { title: id, ...properties } } as GraphNode;
}
function edge(sourceId: string, targetId: string, edgeType = 'HAS_CHILD'): GraphEdge {
  return { id: `${sourceId}->${targetId}`, edgeType, sourceId, targetId, properties: {} } as GraphEdge;
}

const NODES = [
  node('root', 'Pathway'),
  node('dp-1', 'DecisionPoint', { title: 'Which treatment?', branch_mode: 'one_of' }),
  node('step-a', 'Step', { title: 'Treat A' }),
  node('step-b', 'Step', { title: 'Treat B' }),
];
const EDGES = [
  edge('root', 'dp-1', 'HAS_DECISION_POINT'),
  edge('dp-1', 'step-a', 'BRANCHES_TO'),
  edge('dp-1', 'step-b', 'BRANCHES_TO'),
];

function rctx() {
  return {
    graphContext: makeGraphContext(NODES, EDGES),
    edges: EDGES,
    signals: [],
    thresholds: { autoResolveThreshold: 0.85, suggestThreshold: 0.6 },
    confidenceEngine: {},
    codeMap: new Map(),
    temporalDefaults: {},
  };
}

const poolStub = {
  query: jest.fn().mockResolvedValue({ rows: [{ id: 'pw-1', version: 1, status: 'ACTIVE' }] }),
};
const ctx = () => ({ pool: poolStub, redis: {}, userId: 'u-1', userRole: 'ADMIN' }) as never;

/** Start a session where BOTH branches qualify, so the fork pends. */
async function startAmbiguous() {
  mockBuild.mockResolvedValue(rctx());
  await resolutionMutations.startResolution(
    null as never,
    {
      pathwayId: 'pw-1', patientId: 'pt-1', resolutionMode: 'SYNTHETIC',
      evaluationAsOf: PINNED,
      patientContext: {
        patientId: 'pt-1', conditionCodes: [], medications: [], allergies: [], labResults: [],
      },
    } as never,
    ctx(),
  );
  return mockedCreateSession.mock.calls[0][1] as unknown as {
    resolutionState: Map<string, NodeResult>;
    dependencyMap: unknown;
    pendingQuestions: PendingQuestion[];
    initialPatientContext: unknown;
    temporalContext: unknown;
  };
}

function sessionFrom(created: Awaited<ReturnType<typeof startAmbiguous>>) {
  return {
    id: 'session-1', pathwayId: 'pw-1', pathwayVersion: '1',
    patientId: 'pt-1', providerId: 'u-1', status: SessionStatus.ACTIVE,
    resolutionState: created.resolutionState,
    dependencyMap: created.dependencyMap,
    initialPatientContext: created.initialPatientContext,
    additionalContext: {},
    pendingQuestions: created.pendingQuestions,
    redFlags: [], resolutionEvents: [],
    gateAnswers: new Map(),
    totalNodesEvaluated: created.resolutionState.size,
    traversalDurationMs: 1, ddiWarnings: [],
    temporalContext: created.temporalContext,
    createdAt: new Date(), updatedAt: new Date(),
  } as never;
}


import { applyDdiToResolutionState } from '../services/medications/ddi-pass-single-pathway';
const mockedDdi = applyDdiToResolutionState as jest.MockedFunction<
  typeof applyDdiToResolutionState
>;

beforeEach(() => {
  jest.clearAllMocks();
  for (const k of Object.keys(scores)) delete scores[k];
  mockedDdi.mockResolvedValue({ findings: [], suppressedNodeCount: 0 } as never);
  poolStub.query.mockResolvedValue({ rows: [{ id: 'pw-1', version: 1, status: 'ACTIVE' }] });
  mockedCreateSession.mockResolvedValue('session-1');
  mockedGetSession.mockResolvedValue({ id: 'session-1' } as never);
});

describe('DDI runs after every state-changing resolution', () => {
  it('runs at session creation, as it always did', async () => {
    await startAmbiguous();
    expect(mockedDdi).toHaveBeenCalled();
  });

  it('runs again after a branch choice at a DecisionPoint', async () => {
    const created = await startAmbiguous();
    mockedGetSession.mockResolvedValue(sessionFrom(created));
    mockedDdi.mockClear();

    await resolutionMutations.answerPendingDecision(
      null as never,
      { sessionId: 'session-1', nodeId: 'dp-1', answer: { selectedOption: 'step-a' } } as never,
      ctx(),
    );

    // The chosen branch is exactly where new medications come from.
    expect(mockedDdi).toHaveBeenCalled();
  });

  it('runs again when a node is overridden back into the plan', async () => {
    const created = await startAmbiguous();
    mockedGetSession.mockResolvedValue(sessionFrom(created));
    mockedDdi.mockClear();

    await resolutionMutations.overrideNode(
      null as never,
      { sessionId: 'session-1', nodeId: 'step-a', action: 'INCLUDE', reason: 'clinical judgement' } as never,
      ctx(),
    );

    expect(mockedDdi).toHaveBeenCalled();
  });

  // Both sides of the check move here: the plan may gain a medication AND the
  // patient's own medication list may have just grown.
  it('runs again when medications are added to the patient context', async () => {
    const created = await startAmbiguous();
    mockedGetSession.mockResolvedValue(sessionFrom(created));
    mockedDdi.mockClear();

    await resolutionMutations.addPatientContext(
      null as never,
      { sessionId: 'session-1', additionalContext: { medications: [{ name: 'Warfarin' }] } } as never,
      ctx(),
    );

    expect(mockedDdi).toHaveBeenCalled();
    // Checked against the medication that was just added, not the empty list
    // the session was created with.
    const pc = mockedDdi.mock.calls.at(-1)![2] as { medications?: unknown[] };
    expect(JSON.stringify(pc.medications ?? [])).toContain('Warfarin');
  });
});
