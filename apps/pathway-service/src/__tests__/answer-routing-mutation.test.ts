/**
 * Answering a gate through GraphQL, not just through the engine.
 *
 * The engine routes `{ equals: false }` correctly. The RESOLVER decided
 * whether to call it with `booleanValue === true || selectedOption != null ||
 * numericValue != null`, so a "no" answer never reached it: it took a
 * hand-rolled path that marked the whole subtree GATED_OUT, routed nothing,
 * reconciled no findings and re-ran no DDI.
 *
 * The engine-level tests could not see this, because they call the engine.
 * These go through the mutation.
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
  node('gate-b', 'Gate', {
    title: 'Symptomatic?', gate_type: 'question',
    default_behavior: 'skip', answer_type: 'boolean',
  }),
  node('step-yes', 'Step', { title: 'Treat' }),
  node('step-no', 'Step', { title: 'Reassure' }),
];
const EDGES = [
  edge('root', 'gate-b', 'HAS_GATE'),
  { ...edge('gate-b', 'step-yes', 'BRANCHES_TO'), properties: { when: { equals: true } } },
  { ...edge('gate-b', 'step-no', 'BRANCHES_TO'), properties: { when: { equals: false } } },
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



import { NodeStatus as NS } from '../services/resolution/types';
import { applyDdiToResolutionState } from '../services/medications/ddi-pass-single-pathway';
import { updateSession } from '../services/resolution/session-store';

const mockedDdi = applyDdiToResolutionState as jest.MockedFunction<
  typeof applyDdiToResolutionState
>;
const mockedUpdate = updateSession as jest.MockedFunction<typeof updateSession>;

beforeEach(() => {
  jest.clearAllMocks();
  for (const k of Object.keys(scores)) delete scores[k];
  poolStub.query.mockResolvedValue({ rows: [{ id: 'pw-1', version: 1, status: 'ACTIVE' }] });
  mockedCreateSession.mockResolvedValue('session-1');
  mockedGetSession.mockResolvedValue({ id: 'session-1' } as never);
  mockedDdi.mockResolvedValue({ findings: [], suppressedNodeCount: 0 } as never);
});

async function start() {
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
  return mockedCreateSession.mock.calls[0][1] as never as {
    resolutionState: Map<string, NodeResult>;
    dependencyMap: unknown;
    pendingQuestions: PendingQuestion[];
    initialPatientContext: unknown;
    temporalContext: unknown;
  };
}

async function answer(created: Awaited<ReturnType<typeof start>>, booleanValue: boolean) {
  mockedGetSession.mockResolvedValue(sessionFrom(created));
  await resolutionMutations.answerPendingDecision(
    null as never,
    { sessionId: 'session-1', nodeId: 'gate-b', answer: { booleanValue } } as never,
    ctx(),
  );
  return created.resolutionState;
}

describe('answering a boolean gate through the mutation', () => {
  it('routes true to the true branch', async () => {
    const state = await answer(await start(), true);
    expect(state.get('step-yes')!.status).toBe(NS.INCLUDED);
    expect(state.get('step-no')!.status).not.toBe(NS.INCLUDED);
  });

  /**
   * The P0. Asserting the POSITIVE — step-no INCLUDED — because that is the
   * only thing the old resolver cannot produce: it marked the whole subtree
   * GATED_OUT without ever calling the engine.
   */
  it('routes false to the false branch', async () => {
    const state = await answer(await start(), false);
    expect(state.get('step-no')!.status).toBe(NS.INCLUDED);
    expect(state.get('step-yes')!.status).not.toBe(NS.INCLUDED);
  });

  it('re-runs DDI for a false answer, not only a true one', async () => {
    const created = await start();
    mockedDdi.mockClear();
    await answer(created, false);
    expect(mockedDdi).toHaveBeenCalled();
  });

  it('clears the answered question for a false answer', async () => {
    const created = await start();
    await answer(created, false);
    const saved = mockedUpdate.mock.calls.at(-1)![2] as { pendingQuestions?: PendingQuestion[] };
    expect((saved.pendingQuestions ?? []).map(q => q.gateId)).not.toContain('gate-b');
  });
});
