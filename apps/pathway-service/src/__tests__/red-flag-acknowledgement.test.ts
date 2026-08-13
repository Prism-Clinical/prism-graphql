/**
 * Acknowledging a red flag that is genuinely still true.
 *
 * Reconciliation (previous commit) clears STALE flags. It does nothing for a
 * flag that still holds and that the clinician has considered and accepted —
 * and care-plan generation blocks on every unacknowledged flag, so without an
 * acknowledgment path such a session is still a dead end.
 *
 * The interaction between the two is the thing most likely to go wrong, and it
 * is the first test here: reconciliation REPLACES a re-derived flag, so a
 * blind replace resurrects an acknowledged flag unacknowledged on the next
 * retraversal and the dead end returns by a different route.
 */

import { NodeStatus, SessionStatus, DataSourceContext } from '../types';
import type {
  ResolutionSession,
  NodeResult,
  DependencyMap,
  RedFlag,
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
import { getSession, updateSession, logEvent } from '../services/resolution/session-store';
import { validateForGeneration } from '../services/resolution/care-plan-generator';
import { formatSessionForGraphQL } from '../resolvers/Query';

const mockedGetSession = getSession as jest.MockedFunction<typeof getSession>;
const mockedUpdateSession = updateSession as jest.MockedFunction<typeof updateSession>;
const mockedLogEvent = logEvent as jest.MockedFunction<typeof logEvent>;

// ── Fixtures ──────────────────────────────────────────────────────────

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
    initialPatientContext: {
      patientId: 'patient-1',
      conditionCodes: [],
      medications: [],
      labResults: [],
      allergies: [],
      vitalSigns: {},
      freeformData: {},
      patientAttributes: {},
    } as PatientContext,
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

function flag(nodeId: string, extra: Partial<RedFlag> = {}): RedFlag {
  return {
    nodeId,
    nodeTitle: `Decision ${nodeId}`,
    type: 'all_branches_excluded',
    description: `All 2 branches of decision point "Decision ${nodeId}" are excluded`,
    ...extra,
  };
}

function retraversalResult(over: { newRedFlags?: RedFlag[]; reEvaluatedNodeIds?: string[] } = {}) {
  return {
    statusChanges: [],
    nodesRecomputed: (over.reEvaluatedNodeIds ?? []).length,
    newPendingQuestions: [],
    newRedFlags: over.newRedFlags ?? [],
    reEvaluatedNodeIds: over.reEvaluatedNodeIds ?? [],
    reDerivedRedFlagTypes: ['all_branches_excluded'],
  };
}

function lastUpdate(): { redFlags?: RedFlag[] } {
  const calls = mockedUpdateSession.mock.calls;
  expect(calls.length).toBeGreaterThan(0);
  return calls[calls.length - 1][2] as never;
}

const providerContext = {
  pool: {} as never,
  redis: {} as never,
  userId: 'provider-1',
  userRole: 'PROVIDER',
} as DataSourceContext;

/** Answer a gate so the OPEN branch retraverses. */
async function retraverseVia(session: ResolutionSession) {
  session.resolutionState.set('gate-1', {
    nodeId: 'gate-1',
    nodeType: 'Gate',
    title: 'gate-1',
    status: NodeStatus.PENDING_QUESTION,
    confidence: 0.5,
    confidenceBreakdown: [],
    depth: 0,
  } as NodeResult);
  mockedGetSession.mockResolvedValue(session);
  await resolutionMutations.answerGateQuestion(
    undefined,
    { sessionId: 'session-1', gateId: 'gate-1', answer: { booleanValue: true } },
    providerContext,
  );
}

const ACK_ARGS = {
  sessionId: 'session-1',
  nodeId: 'dp-1',
  flagType: 'all_branches_excluded',
  reason: 'Discussed with attending; managing off-pathway.',
};

describe('red-flag acknowledgment', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRetraverse.mockResolvedValue(retraversalResult());
  });

  // ── The interaction between the two parts ─────────────────────────

  describe('survives reconciliation', () => {
    it('keeps a flag acknowledged when the next retraversal re-emits it', async () => {
      const acked = makeSession();
      acked.redFlags = [flag('dp-1')];
      mockedGetSession.mockResolvedValue(acked);
      await resolutionMutations.acknowledgeRedFlag(undefined, ACK_ARGS, providerContext);

      // The session now carries the acknowledged flag; retraverse over it.
      const session = makeSession({ redFlags: lastUpdate().redFlags as RedFlag[] });
      mockRetraverse.mockResolvedValue(
        retraversalResult({ newRedFlags: [flag('dp-1')], reEvaluatedNodeIds: ['dp-1'] }),
      );

      await retraverseVia(session);

      const after = lastUpdate().redFlags ?? [];
      expect(after).toHaveLength(1);
      expect(after[0].acknowledged).toBe(true);
      expect(after[0].acknowledgedBy).toBe('provider-1');
      expect(after[0].acknowledgementReason).toBe(ACK_ARGS.reason);
      expect(after[0].acknowledgedAt).toEqual(expect.any(String));
    });

    it('leaves care-plan generation unblocked after that retraversal', async () => {
      const acked = makeSession();
      acked.redFlags = [flag('dp-1')];
      mockedGetSession.mockResolvedValue(acked);
      await resolutionMutations.acknowledgeRedFlag(undefined, ACK_ARGS, providerContext);

      const session = makeSession({ redFlags: lastUpdate().redFlags as RedFlag[] });
      session.resolutionState.set('n-1', {
        nodeId: 'n-1',
        nodeType: 'Medication',
        title: 'Something',
        status: NodeStatus.INCLUDED,
        confidence: 0.9,
        confidenceBreakdown: [],
        depth: 0,
      } as NodeResult);
      mockRetraverse.mockResolvedValue(
        retraversalResult({ newRedFlags: [flag('dp-1')], reEvaluatedNodeIds: ['dp-1'] }),
      );

      await retraverseVia(session);

      const blockers = validateForGeneration(
        session.resolutionState,
        lastUpdate().redFlags as RedFlag[],
      );
      expect(blockers.map(b => b.type)).not.toContain('UNRESOLVED_RED_FLAG');
    });

    it('takes the acknowledgment away with the flag when the finding resolves', async () => {
      const acked = makeSession();
      acked.redFlags = [flag('dp-1')];
      mockedGetSession.mockResolvedValue(acked);
      await resolutionMutations.acknowledgeRedFlag(undefined, ACK_ARGS, providerContext);

      const session = makeSession({ redFlags: lastUpdate().redFlags as RedFlag[] });
      mockRetraverse.mockResolvedValue(
        retraversalResult({ newRedFlags: [], reEvaluatedNodeIds: ['dp-1'] }),
      );

      await retraverseVia(session);

      // A finding that resolved and later recurs is a NEW clinical event; the
      // earlier acceptance must not carry over to it.
      expect(lastUpdate().redFlags).toEqual([]);
    });

    it('does not let one acknowledgment silence a different flag on the same node', async () => {
      const session = makeSession();
      session.redFlags = [flag('dp-1'), flag('dp-1', { type: 'missing_critical_data' })];
      mockedGetSession.mockResolvedValue(session);

      await resolutionMutations.acknowledgeRedFlag(undefined, ACK_ARGS, providerContext);

      const after = lastUpdate().redFlags ?? [];
      expect(after).toHaveLength(2);
      expect(after.find(f => f.type === 'all_branches_excluded')?.acknowledged).toBe(true);
      expect(after.find(f => f.type === 'missing_critical_data')?.acknowledged).toBeFalsy();
    });
  });

  // ── The mutation itself ───────────────────────────────────────────

  describe('acknowledgeRedFlag', () => {
    function ackSession() {
      const session = makeSession();
      session.redFlags = [flag('dp-1'), flag('dp-2')];
      mockedGetSession.mockResolvedValue(session);
      return session;
    }

    it('marks the identified flag and leaves the others alone', async () => {
      ackSession();
      await resolutionMutations.acknowledgeRedFlag(undefined, ACK_ARGS, providerContext);

      const after = lastUpdate().redFlags ?? [];
      expect(after.find(f => f.nodeId === 'dp-1')?.acknowledged).toBe(true);
      expect(after.find(f => f.nodeId === 'dp-2')?.acknowledged).toBeFalsy();
    });

    it('records the asserted actor and the clinical reason', async () => {
      ackSession();
      await resolutionMutations.acknowledgeRedFlag(undefined, ACK_ARGS, providerContext);

      const acked = (lastUpdate().redFlags ?? []).find(f => f.nodeId === 'dp-1');
      expect(acked?.acknowledgedBy).toBe('provider-1');
      expect(acked?.acknowledgementReason).toBe(ACK_ARGS.reason);
      expect(Number.isNaN(Date.parse(acked?.acknowledgedAt ?? ''))).toBe(false);
    });

    it('writes an audit row through the resolution-event mechanism', async () => {
      ackSession();
      await resolutionMutations.acknowledgeRedFlag(undefined, ACK_ARGS, providerContext);

      expect(mockedLogEvent).toHaveBeenCalledTimes(1);
      const [, sessionId, event] = mockedLogEvent.mock.calls[0];
      expect(sessionId).toBe('session-1');
      expect(event.eventType).toBe('red_flag_acknowledged');
      expect(event.triggerData).toMatchObject({
        nodeId: 'dp-1',
        flagType: 'all_branches_excluded',
        reason: ACK_ARGS.reason,
        assertedActorId: 'provider-1',
        assertedActorRole: 'PROVIDER',
      });
    });

    /**
     * AD-1: `userRole` is read off an unverified `x-user-role` header that
     * defaults to PROVIDER, so a role check would secure nothing and would
     * break the encounter simulator. The actor is RECORDED, never ENFORCED —
     * this test exists so a later "harden it" change is a deliberate one.
     */
    it('does not gate on role', async () => {
      ackSession();
      await expect(
        resolutionMutations.acknowledgeRedFlag(undefined, ACK_ARGS, {
          ...providerContext,
          userRole: 'ADMIN',
        } as DataSourceContext),
      ).resolves.toBeDefined();

      const [, , event] = mockedLogEvent.mock.calls[0];
      expect(event.triggerData).toMatchObject({ assertedActorRole: 'ADMIN' });
    });

    it('rejects a flag type that is not a RedFlagType', async () => {
      ackSession();
      await expect(
        resolutionMutations.acknowledgeRedFlag(
          undefined,
          { ...ACK_ARGS, flagType: 'ALL_BRANCHES_EXCLUDED' },
          providerContext,
        ),
      ).rejects.toThrow(/not a known red flag type/);
      expect(mockedUpdateSession).not.toHaveBeenCalled();
    });

    it('rejects a blank reason — this is a clinical override, not a UI dismissal', async () => {
      ackSession();
      await expect(
        resolutionMutations.acknowledgeRedFlag(
          undefined,
          { ...ACK_ARGS, reason: '   ' },
          providerContext,
        ),
      ).rejects.toThrow(/reason is required/);
      expect(mockedUpdateSession).not.toHaveBeenCalled();
    });

    it('rejects a flag that is not on the session', async () => {
      ackSession();
      await expect(
        resolutionMutations.acknowledgeRedFlag(
          undefined,
          { ...ACK_ARGS, nodeId: 'nope' },
          providerContext,
        ),
      ).rejects.toThrow(/No red flag/);
    });

    it('rejects a missing session', async () => {
      mockedGetSession.mockResolvedValue(null as never);
      await expect(
        resolutionMutations.acknowledgeRedFlag(undefined, ACK_ARGS, providerContext),
      ).rejects.toThrow(/Session not found/);
    });

    it('rejects a session that is no longer modifiable', async () => {
      const session = makeSession({ status: SessionStatus.COMPLETED });
      session.redFlags = [flag('dp-1')];
      mockedGetSession.mockResolvedValue(session);
      await expect(
        resolutionMutations.acknowledgeRedFlag(undefined, ACK_ARGS, providerContext),
      ).rejects.toThrow(/Cannot modify session/);
    });
  });

  describe('unacknowledgeRedFlag', () => {
    function ackedSession() {
      const session = makeSession();
      session.redFlags = [
        flag('dp-1', {
          acknowledged: true,
          acknowledgedBy: 'provider-1',
          acknowledgedAt: '2026-08-01T00:00:00.000Z',
          acknowledgementReason: 'accepted',
        }),
      ];
      mockedGetSession.mockResolvedValue(session);
      return session;
    }

    it('clears the acknowledgment and its metadata', async () => {
      ackedSession();
      await resolutionMutations.unacknowledgeRedFlag(
        undefined,
        { ...ACK_ARGS, reason: 'Acknowledged in error — wrong patient.' },
        providerContext,
      );

      const after = (lastUpdate().redFlags ?? [])[0];
      expect(after.acknowledged).toBe(false);
      expect(after.acknowledgedBy).toBeUndefined();
      expect(after.acknowledgedAt).toBeUndefined();
      expect(after.acknowledgementReason).toBeUndefined();
    });

    it('audits the reversal the same way', async () => {
      ackedSession();
      await resolutionMutations.unacknowledgeRedFlag(
        undefined,
        { ...ACK_ARGS, reason: 'Acknowledged in error — wrong patient.' },
        providerContext,
      );

      const [, , event] = mockedLogEvent.mock.calls[0];
      expect(event.eventType).toBe('red_flag_unacknowledged');
      expect(event.triggerData).toMatchObject({
        nodeId: 'dp-1',
        flagType: 'all_branches_excluded',
        assertedActorId: 'provider-1',
        previouslyAcknowledgedBy: 'provider-1',
      });
    });

    it('rejects a blank reason', async () => {
      ackedSession();
      await expect(
        resolutionMutations.unacknowledgeRedFlag(
          undefined,
          { ...ACK_ARGS, reason: '' },
          providerContext,
        ),
      ).rejects.toThrow(/reason is required/);
    });

    it('restores the generation blocker', async () => {
      const session = ackedSession();
      await resolutionMutations.unacknowledgeRedFlag(
        undefined,
        { ...ACK_ARGS, reason: 'Acknowledged in error.' },
        providerContext,
      );
      session.resolutionState.set('n-1', {
        nodeId: 'n-1',
        nodeType: 'Medication',
        title: 'Something',
        status: NodeStatus.INCLUDED,
        confidence: 0.9,
        confidenceBreakdown: [],
        depth: 0,
      } as NodeResult);

      const blockers = validateForGeneration(
        session.resolutionState,
        lastUpdate().redFlags as RedFlag[],
      );
      expect(blockers.map(b => b.type)).toContain('UNRESOLVED_RED_FLAG');
    });
  });

  // ── The state has to be readable, or the client cannot act on it ──

  describe('GraphQL projection', () => {
    it('exposes the acknowledgment state on RedFlagType', () => {
      const session = makeSession();
      session.redFlags = [
        flag('dp-1', {
          acknowledged: true,
          acknowledgedBy: 'provider-1',
          acknowledgedAt: '2026-08-01T00:00:00.000Z',
          acknowledgementReason: 'accepted',
        }),
        flag('dp-2'),
      ];

      const projected = formatSessionForGraphQL(session).redFlags;
      expect(projected[0]).toMatchObject({
        acknowledged: true,
        acknowledgedBy: 'provider-1',
        acknowledgedAt: '2026-08-01T00:00:00.000Z',
        acknowledgementReason: 'accepted',
      });
      // Never null: the SDL field is Boolean!, and an absent mark is `false`.
      expect(projected[1]).toMatchObject({
        acknowledged: false,
        acknowledgedBy: null,
        acknowledgedAt: null,
        acknowledgementReason: null,
      });
    });
  });
});
