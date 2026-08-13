/**
 * A retraversal must reuse the clock its session was created with. If it
 * stamped a fresh one, the same session could resolve the same data
 * differently on every override — which is the whole defect this plan closes.
 *
 * The mock set below mirrors resolution-retraversal-context.test.ts exactly.
 * That is not tidiness: `jest.mock` with a factory replaces the WHOLE module,
 * so any export left out is `undefined` at call time. overrideNode calls
 * makeRetraversalAdapter, makeLlmGateEvaluator and logNodeOverride as well as
 * buildResolutionContext and getSession, and omitting any of them kills the
 * positive case before it constructs the engine. The negative case would not
 * reveal that — the clock guard throws before reaching those helpers, so it
 * passes either way.
 */

const mockRetraverse = jest.fn().mockResolvedValue({
  statusChanges: [], newPendingQuestions: [], newRedFlags: [],
  // The reconciliation scope every retraversing resolver now folds findings
  // back against; empty because this stub derives nothing.
  reEvaluatedNodeIds: [], reDerivedRedFlagTypes: ['all_branches_excluded'],
  nodesRecomputed: 0, isIncomplete: false,
});
const retraversalCtor = jest.fn();

// Every session-store export `resolution.ts` imports — see its import block.
jest.mock('../../services/resolution/session-store', () => ({
  createSession: jest.fn().mockResolvedValue('session-1'),
  getSession: jest.fn(),
  updateSession: jest.fn().mockResolvedValue(undefined),
  logEvent: jest.fn().mockResolvedValue(undefined),
  logNodeOverride: jest.fn().mockResolvedValue(undefined),
  logGateAnswer: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../services/resolution/retraversal-engine', () => ({
  RetraversalEngine: class {
    constructor(...args: unknown[]) { retraversalCtor(...args); }
    retraverse = mockRetraverse;
  },
}));

// All four resolution-context helpers, and the full graphContext shape the
// canonical test uses — a thinner stub breaks as soon as the resolver walks
// edges.
jest.mock('../../resolvers/helpers/resolution-context', () => ({
  buildResolutionContext: jest.fn().mockResolvedValue({
    graphContext: {
      allNodes: [],
      allEdges: [],
      incomingEdges: () => [],
      outgoingEdges: () => [],
      getNode: () => undefined,
      linkedNodes: () => [],
    },
    edges: [],
    signals: [],
    thresholds: { autoResolveThreshold: 0.85, suggestThreshold: 0.6 },
    confidenceEngine: {},
    codeMap: new Map(),
  }),
  makeTraversalAdapter: jest.fn(),
  makeRetraversalAdapter: jest.fn(() => ({ computeNodeConfidence: jest.fn() })),
  makeLlmGateEvaluator: jest.fn(() => null),
}));

import { getSession } from '../../services/resolution/session-store';
import { resolutionMutations } from '../../resolvers/mutations/resolution';
import { makeEvaluationTemporalContext } from '../../services/resolution/temporal/evaluation-context';
import { NodeStatus, OverrideAction } from '../../services/resolution/types';

const mockedGetSession = getSession as jest.MockedFunction<typeof getSession>;
const PINNED = '2026-01-15T08:30:00.000Z';

function sessionWith(temporalContext: unknown) {
  const resolutionState = new Map([
    ['node-1', { nodeId: 'node-1', nodeType: 'Step', title: 'n1', status: NodeStatus.INCLUDED, confidence: 1, confidenceBreakdown: [], depth: 1 }],
    ['node-2', { nodeId: 'node-2', nodeType: 'Step', title: 'n2', status: NodeStatus.INCLUDED, confidence: 1, confidenceBreakdown: [], depth: 2 }],
  ]);
  return {
    id: 'session-1', pathwayId: 'pathway-1', pathwayVersion: '1',
    patientId: 'pt', providerId: 'pr', status: 'ACTIVE',
    resolutionState,
    dependencyMap: {
      influencedBy: new Map(), influences: new Map([['node-1', new Set(['node-2'])]]),
      gateContextFields: new Map(), scorerInputs: new Map(),
    },
    initialPatientContext: { patientId: 'pt', conditionCodes: [], medications: [], labResults: [], allergies: [] },
    additionalContext: {}, pendingQuestions: [], redFlags: [], resolutionEvents: [],
    gateAnswers: new Map(), totalNodesEvaluated: 2, traversalDurationMs: 1,
    ddiWarnings: [], temporalContext,
    createdAt: new Date(), updatedAt: new Date(),
  };
}

describe('retraversal reuses the session clock', () => {
  beforeEach(() => { retraversalCtor.mockClear(); });

  it('constructs RetraversalEngine with the clock persisted on the session', async () => {
    mockedGetSession.mockResolvedValue(
      sessionWith(makeEvaluationTemporalContext({ evaluationAsOf: PINNED })) as never,
    );

    await resolutionMutations.overrideNode(
      undefined,
      { sessionId: 'session-1', nodeId: 'node-1', action: OverrideAction.EXCLUDE, reason: 'r' },
      { pool: { query: jest.fn().mockResolvedValue({ rows: [] }) }, userId: 'pr' } as never,
    );

    expect(retraversalCtor).toHaveBeenCalled();
    const thirdArg = retraversalCtor.mock.calls[0][2];
    expect(thirdArg).toMatchObject({ evaluationAsOf: PINNED, timezone: 'UTC' });
  });

  it('refuses to retraverse a pre-migration session with no pinned clock', async () => {
    mockedGetSession.mockResolvedValue(sessionWith(undefined) as never);

    await expect(
      resolutionMutations.overrideNode(
        undefined,
        { sessionId: 'session-1', nodeId: 'node-1', action: OverrideAction.EXCLUDE, reason: 'r' },
        { pool: { query: jest.fn().mockResolvedValue({ rows: [] }) }, userId: 'pr' } as never,
      ),
    ).rejects.toThrow(/SESSION_NOT_RETRAVERSABLE|pinned evaluation clock/i);

    expect(retraversalCtor).not.toHaveBeenCalled();
  });
});
