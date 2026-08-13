/**
 * Red-flag reconciliation — the three bugs recorded as §1 of
 * `docs/superpowers/plans/2026-08-12-resolution-subsystem-gaps.md`.
 *
 * 1. `answerGateQuestion` and `addPatientContext` APPEND `newRedFlags` with no
 *    keyed replace and no dedup, so a still-true flag is re-added on every
 *    retraversal and a flag whose condition has resolved is never removed.
 * 2. `overrideNode` consumes only `statusChanges`, dropping BOTH `newRedFlags`
 *    and `newPendingQuestions`.
 * 3. The gate-CLOSING branch of `answerGateQuestion` runs no retraversal, so
 *    flags on nodes it force-gates-out are never revisited.
 *
 * The harness mirrors `resolution-retraversal-context.test.ts` — mock the
 * session store, the resolution-context helpers and `RetraversalEngine`, then
 * assert on the `updates` argument `updateSession` was called with, which is
 * the value that actually reaches `red_flags` in Postgres.
 */

import { NodeStatus, OverrideAction, SessionStatus, DataSourceContext } from '../types';
import type {
  ResolutionSession,
  NodeResult,
  DependencyMap,
  RedFlag,
  PendingQuestion,
} from '../services/resolution/types';
import { makeEvaluationTemporalContext } from '../services/resolution/temporal/evaluation-context';
import type { PatientContext } from '../services/confidence/types';

// ── Mocks (must precede import of unit under test) ──────────────────

jest.mock('../services/resolution/session-store', () => ({
  getSession: jest.fn(),
  updateSession: jest.fn().mockResolvedValue(undefined),
  logEvent: jest.fn().mockResolvedValue(undefined),
  logNodeOverride: jest.fn().mockResolvedValue(undefined),
  logGateAnswer: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../resolvers/helpers/resolution-context', () => ({
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
    thresholds: { autoResolveThreshold: 0.8, suggestThreshold: 0.5 },
    confidenceEngine: {},
    codeMap: new Map(),
  }),
  makeTraversalAdapter: jest.fn(),
  makeRetraversalAdapter: jest.fn(() => ({ computeNodeConfidence: jest.fn() })),
  makeLlmGateEvaluator: jest.fn(() => null),
}));

const mockRetraverse = jest.fn();

jest.mock('../services/resolution/retraversal-engine', () => ({
  RetraversalEngine: jest.fn().mockImplementation(() => ({ retraverse: mockRetraverse })),
}));

import { resolutionMutations } from '../resolvers/mutations/resolution';
import { getSession, updateSession } from '../services/resolution/session-store';

const mockedGetSession = getSession as jest.MockedFunction<typeof getSession>;
const mockedUpdateSession = updateSession as jest.MockedFunction<typeof updateSession>;

// ── Fixtures ──────────────────────────────────────────────────────────

function makeBasePatientContext(): PatientContext {
  return {
    patientId: 'patient-1',
    conditionCodes: [],
    medications: [],
    labResults: [],
    allergies: [],
    vitalSigns: {},
    freeformData: {},
    patientAttributes: {},
  } as PatientContext;
}

function makeEmptyDependencyMap(): DependencyMap {
  return {
    influencedBy: new Map(),
    influences: new Map(),
    gateContextFields: new Map(),
    scorerInputs: new Map(),
  };
}

function makeSession(overrides: Partial<ResolutionSession> = {}): ResolutionSession {
  return {
    id: 'session-1',
    pathwayId: 'pathway-1',
    pathwayVersion: '1',
    patientId: 'patient-1',
    providerId: 'provider-1',
    status: SessionStatus.ACTIVE,
    resolutionState: new Map<string, NodeResult>(),
    dependencyMap: makeEmptyDependencyMap(),
    initialPatientContext: makeBasePatientContext(),
    additionalContext: {},
    pendingQuestions: [],
    redFlags: [],
    resolutionEvents: [],
    gateAnswers: new Map(),
    totalNodesEvaluated: 0,
    traversalDurationMs: 0,
    ddiWarnings: [],
    temporalContext: makeEvaluationTemporalContext({ evaluationAsOf: '2026-07-30T12:00:00.000Z' }),
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as ResolutionSession;
}

function makeNode(overrides: Partial<NodeResult> & { nodeId: string }): NodeResult {
  return {
    nodeType: 'Criterion',
    title: overrides.nodeId,
    status: NodeStatus.INCLUDED,
    confidence: 0.9,
    confidenceBreakdown: [],
    depth: 0,
    ...overrides,
  } as NodeResult;
}

function allBranchesExcluded(nodeId: string, extra: Partial<RedFlag> = {}): RedFlag {
  return {
    nodeId,
    nodeTitle: `Decision ${nodeId}`,
    type: 'all_branches_excluded',
    description: `All 2 branches of decision point "Decision ${nodeId}" are now excluded after re-evaluation`,
    ...extra,
  };
}

/** A retraversal result carrying the reconciliation scope the engine reports. */
function retraversalResult(over: {
  newRedFlags?: RedFlag[];
  newPendingQuestions?: PendingQuestion[];
  reEvaluatedNodeIds?: string[];
} = {}) {
  return {
    statusChanges: [],
    nodesRecomputed: (over.reEvaluatedNodeIds ?? []).length,
    newPendingQuestions: over.newPendingQuestions ?? [],
    newRedFlags: over.newRedFlags ?? [],
    reEvaluatedNodeIds: over.reEvaluatedNodeIds ?? [],
    reDerivedRedFlagTypes: ['all_branches_excluded'],
  };
}

/** The `updates` object of the last `updateSession` call. */
function lastUpdate(): {
  redFlags?: RedFlag[];
  pendingQuestions?: PendingQuestion[];
} {
  const calls = mockedUpdateSession.mock.calls;
  expect(calls.length).toBeGreaterThan(0);
  return calls[calls.length - 1][2] as never;
}

const fakeContext = {
  pool: {} as never,
  redis: {} as never,
  userId: 'provider-1',
  userRole: 'PROVIDER',
} as DataSourceContext;

const question = (gateId: string): PendingQuestion => ({
  gateId,
  prompt: `Answer ${gateId}?`,
  answerType: 'BOOLEAN' as PendingQuestion['answerType'],
  affectedSubtreeSize: 0,
  estimatedImpact: 'unknown',
});

describe('red-flag reconciliation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRetraverse.mockResolvedValue(retraversalResult());
  });

  // ── Bug 1: append-only, no reconciliation, no dedup ────────────────

  describe('answerGateQuestion (gate OPENS — retraversal path)', () => {
    function openGateSession() {
      const session = makeSession();
      session.resolutionState.set(
        'gate-1',
        makeNode({ nodeId: 'gate-1', nodeType: 'Gate', status: NodeStatus.PENDING_QUESTION }),
      );
      return session;
    }

    async function answer(session: ResolutionSession) {
      mockedGetSession.mockResolvedValue(session);
      await resolutionMutations.answerGateQuestion(
        undefined,
        { sessionId: 'session-1', gateId: 'gate-1', answer: { booleanValue: true } },
        fakeContext,
      );
    }

    it('does not append a duplicate when the same node re-emits an identical flag', async () => {
      const session = openGateSession();
      session.redFlags = [allBranchesExcluded('dp-1')];
      mockRetraverse.mockResolvedValue(
        retraversalResult({
          newRedFlags: [allBranchesExcluded('dp-1')],
          reEvaluatedNodeIds: ['dp-1'],
        }),
      );

      await answer(session);

      expect(lastUpdate().redFlags).toHaveLength(1);
      expect(lastUpdate().redFlags?.[0].nodeId).toBe('dp-1');
    });

    it('drops a stale flag whose node was re-evaluated and no longer qualifies', async () => {
      const session = openGateSession();
      session.redFlags = [allBranchesExcluded('dp-1')];
      mockRetraverse.mockResolvedValue(
        retraversalResult({ newRedFlags: [], reEvaluatedNodeIds: ['dp-1'] }),
      );

      await answer(session);

      expect(lastUpdate().redFlags).toEqual([]);
    });

    it('keeps a flag whose node was OUTSIDE the retraversal scope', async () => {
      const session = openGateSession();
      session.redFlags = [allBranchesExcluded('dp-1'), allBranchesExcluded('dp-2')];
      mockRetraverse.mockResolvedValue(
        retraversalResult({ newRedFlags: [], reEvaluatedNodeIds: ['dp-1'] }),
      );

      await answer(session);

      expect(lastUpdate().redFlags?.map(f => f.nodeId)).toEqual(['dp-2']);
    });

    it('collapses duplicates a previous append already left on the session', async () => {
      const session = openGateSession();
      // Exactly what today's code produces after three retraversals.
      session.redFlags = [
        allBranchesExcluded('dp-1'),
        allBranchesExcluded('dp-1'),
        allBranchesExcluded('dp-1'),
      ];
      mockRetraverse.mockResolvedValue(
        retraversalResult({
          newRedFlags: [allBranchesExcluded('dp-1')],
          reEvaluatedNodeIds: ['dp-1'],
        }),
      );

      await answer(session);

      expect(lastUpdate().redFlags).toHaveLength(1);
    });
  });

  describe('addPatientContext', () => {
    function contextSession() {
      const session = makeSession();
      session.resolutionState.set('gate-1', makeNode({ nodeId: 'gate-1', nodeType: 'Gate' }));
      // Make `gate-1` depend on lab data so `affectedNodes` is non-empty.
      session.dependencyMap.gateContextFields.set('gate-1', new Set(['labs']));
      return session;
    }

    async function addLab(session: ResolutionSession) {
      mockedGetSession.mockResolvedValue(session);
      await resolutionMutations.addPatientContext(
        undefined,
        {
          sessionId: 'session-1',
          additionalContext: { labResults: [{ code: '718-7', system: 'LOINC', value: 9.2 }] },
        },
        fakeContext,
      );
    }

    it('does not append a duplicate when the same node re-emits an identical flag', async () => {
      const session = contextSession();
      session.redFlags = [allBranchesExcluded('dp-1')];
      mockRetraverse.mockResolvedValue(
        retraversalResult({
          newRedFlags: [allBranchesExcluded('dp-1')],
          reEvaluatedNodeIds: ['dp-1'],
        }),
      );

      await addLab(session);

      expect(lastUpdate().redFlags).toHaveLength(1);
    });

    it('drops a stale flag whose node was re-evaluated and no longer qualifies', async () => {
      const session = contextSession();
      session.redFlags = [allBranchesExcluded('dp-1')];
      mockRetraverse.mockResolvedValue(
        retraversalResult({ newRedFlags: [], reEvaluatedNodeIds: ['dp-1'] }),
      );

      await addLab(session);

      expect(lastUpdate().redFlags).toEqual([]);
    });

    it('does not append a duplicate pending question for a gate that re-emits one', async () => {
      const session = contextSession();
      session.pendingQuestions = [question('gate-1')];
      mockRetraverse.mockResolvedValue(
        retraversalResult({
          newPendingQuestions: [question('gate-1')],
          reEvaluatedNodeIds: ['gate-1'],
        }),
      );

      await addLab(session);

      expect(lastUpdate().pendingQuestions).toHaveLength(1);
    });
  });

  // ── Bug 2: overrideNode discards newRedFlags AND newPendingQuestions ──

  describe('overrideNode', () => {
    function overrideSession() {
      const session = makeSession();
      session.resolutionState.set('node-1', makeNode({ nodeId: 'node-1' }));
      session.resolutionState.set(
        'node-2',
        makeNode({ nodeId: 'node-2', status: NodeStatus.EXCLUDED, depth: 1 }),
      );
      session.dependencyMap.influences.set('node-1', new Set(['node-2']));
      return session;
    }

    async function override(session: ResolutionSession) {
      mockedGetSession.mockResolvedValue(session);
      await resolutionMutations.overrideNode(
        undefined,
        { sessionId: 'session-1', nodeId: 'node-1', action: OverrideAction.EXCLUDE },
        fakeContext,
      );
    }

    it('records a red flag the override raised', async () => {
      const session = overrideSession();
      mockRetraverse.mockResolvedValue(
        retraversalResult({
          newRedFlags: [allBranchesExcluded('dp-1')],
          reEvaluatedNodeIds: ['dp-1'],
        }),
      );

      await override(session);

      expect(lastUpdate().redFlags?.map(f => f.nodeId)).toEqual(['dp-1']);
    });

    it('records a pending question the override opened', async () => {
      const session = overrideSession();
      mockRetraverse.mockResolvedValue(
        retraversalResult({
          newPendingQuestions: [question('gate-9')],
          reEvaluatedNodeIds: ['gate-9'],
        }),
      );

      await override(session);

      expect(lastUpdate().pendingQuestions?.map(q => q.gateId)).toEqual(['gate-9']);
    });

    it('reconciles rather than appends, exactly as the other two mutations do', async () => {
      const session = overrideSession();
      session.redFlags = [allBranchesExcluded('dp-1'), allBranchesExcluded('dp-2')];
      mockRetraverse.mockResolvedValue(
        retraversalResult({
          newRedFlags: [allBranchesExcluded('dp-1')],
          reEvaluatedNodeIds: ['dp-1', 'dp-3'],
        }),
      );

      await override(session);

      expect(lastUpdate().redFlags?.map(f => f.nodeId)).toEqual(['dp-1', 'dp-2']);
    });
  });

  // ── Bug 3: the gate-CLOSING branch ────────────────────────────────

  describe('answerGateQuestion (gate CLOSES)', () => {
    function closingSession() {
      const session = makeSession();
      session.resolutionState.set(
        'gate-1',
        makeNode({ nodeId: 'gate-1', nodeType: 'Gate', status: NodeStatus.PENDING_QUESTION }),
      );
      session.resolutionState.set(
        'dp-1',
        makeNode({ nodeId: 'dp-1', nodeType: 'DecisionPoint', depth: 1 }),
      );
      return session;
    }

    async function closeGate(session: ResolutionSession) {
      mockedGetSession.mockResolvedValue(session);
      const { buildResolutionContext } = jest.requireMock(
        '../resolvers/helpers/resolution-context',
      );
      // `dp-1` is in the gate's subtree, so closing the gate gates it out.
      buildResolutionContext.mockResolvedValue({
        graphContext: {
          allNodes: [],
          allEdges: [],
          incomingEdges: () => [],
          outgoingEdges: (id: string) =>
            id === 'gate-1' ? [{ targetId: 'dp-1', edgeType: 'BRANCHES_TO' }] : [],
          getNode: () => undefined,
          linkedNodes: () => [],
        },
        edges: [],
        signals: [],
        thresholds: { autoResolveThreshold: 0.8, suggestThreshold: 0.5 },
        confidenceEngine: {},
        codeMap: new Map(),
      });
      await resolutionMutations.answerGateQuestion(
        undefined,
        { sessionId: 'session-1', gateId: 'gate-1', answer: { booleanValue: false } },
        fakeContext,
      );
    }

    /**
     * PINNED, not fixed. Retraversing here would re-derive the subtree through
     * `RetraversalEngine`, which knows nothing about the answer that closed the
     * gate and would overwrite the deliberate GATED_OUT stamping with
     * confidence-derived INCLUDED/EXCLUDED. That is a behaviour change well
     * beyond reconciliation; this test exists so a later change to it is loud.
     */
    it('runs no retraversal', async () => {
      await closeGate(closingSession());
      expect(mockRetraverse).not.toHaveBeenCalled();
    });

    it('drops a flag on a node it just gated out', async () => {
      const session = closingSession();
      session.redFlags = [allBranchesExcluded('dp-1')];

      await closeGate(session);

      expect(lastUpdate().redFlags).toEqual([]);
    });

    it('keeps a flag on a node outside the gated-out subtree', async () => {
      const session = closingSession();
      session.redFlags = [allBranchesExcluded('dp-1'), allBranchesExcluded('dp-elsewhere')];

      await closeGate(session);

      expect(lastUpdate().redFlags?.map(f => f.nodeId)).toEqual(['dp-elsewhere']);
    });
  });
});
