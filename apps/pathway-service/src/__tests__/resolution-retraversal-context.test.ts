/**
 * Task 3 — proves `overrideNode` and `answerGateQuestion` reconstruct the
 * retraversal `PatientContext` from BOTH `session.initialPatientContext` AND
 * `session.additionalContext` (via `buildEffectivePatientContext`), instead
 * of discarding everything added mid-session.
 *
 * No resolver-level test harness for `apps/pathway-service/src/resolvers/
 * mutations/resolution.ts` existed prior to this file (grep for
 * "answerGateQuestion|addPatientContext|overrideNode" under __tests__/tests
 * only matched the production source + this new test + the effective-context
 * helper). This test builds one, mirroring the mocking pattern already used
 * by `multi-pathway-resolution.test.ts` (mock session-store, the
 * resolution-context helpers, and the traversal engine) so the resolvers run
 * with no real Postgres/AGE connection. The re-evaluation seam under test is
 * the `patientContext` argument `RetraversalEngine.retraverse(...)` is
 * invoked with — that's the value that determines what retraversal actually
 * sees.
 */

import { NodeStatus, OverrideAction, SessionStatus, DataSourceContext } from '../types';
import type { ResolutionSession, NodeResult, DependencyMap } from '../services/resolution/types';
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
import { getSession } from '../services/resolution/session-store';

const mockedGetSession = getSession as jest.MockedFunction<typeof getSession>;

// ── Fixtures ──────────────────────────────────────────────────────────

function makeBasePatientContext(overrides: Partial<PatientContext> = {}): PatientContext {
  return {
    patientId: 'patient-1',
    conditionCodes: [],
    medications: [],
    labResults: [],
    allergies: [],
    vitalSigns: {},
    freeformData: {},
    patientAttributes: {},
    ...overrides,
  };
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
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

const fakeContext = { pool: {} as never, redis: {} as never, userId: 'provider-1', userRole: 'PROVIDER' } as DataSourceContext;

describe('resolution retraversal context reconstruction (Task 3)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRetraverse.mockResolvedValue({
      statusChanges: [],
      nodesRecomputed: 0,
      newPendingQuestions: [],
      newRedFlags: [],
    });
  });

  describe('answerGateQuestion', () => {
    it('includes a mid-session attribute addition (patientAttributes.trimester) in the retraversal context', async () => {
      const gateNode: NodeResult = {
        nodeId: 'gate-1',
        nodeType: 'Gate',
        title: 'Trimester gate',
        status: NodeStatus.PENDING_QUESTION,
        confidence: 0.5,
        confidenceBreakdown: [],
        depth: 0,
      };
      const session = makeSession({
        additionalContext: { patientAttributes: { trimester: 2 } },
      });
      session.resolutionState.set('gate-1', gateNode);
      mockedGetSession.mockResolvedValue(session);

      await resolutionMutations.answerGateQuestion(
        undefined,
        { sessionId: 'session-1', gateId: 'gate-1', answer: { booleanValue: true } },
        fakeContext,
      );

      expect(mockRetraverse).toHaveBeenCalledTimes(1);
      const patientCtxArg = mockRetraverse.mock.calls[0][4] as PatientContext;
      expect(patientCtxArg.patientAttributes?.trimester).toBe(2);
    });

    it('includes a mid-session legacy labResults addition in the retraversal context', async () => {
      const gateNode: NodeResult = {
        nodeId: 'gate-1',
        nodeType: 'Gate',
        title: 'Lab gate',
        status: NodeStatus.PENDING_QUESTION,
        confidence: 0.5,
        confidenceBreakdown: [],
        depth: 0,
      };
      const addedLab = { code: '718-7', system: 'LOINC', value: 9.2 };
      const session = makeSession({
        additionalContext: { labResults: [addedLab] },
      });
      session.resolutionState.set('gate-1', gateNode);
      mockedGetSession.mockResolvedValue(session);

      await resolutionMutations.answerGateQuestion(
        undefined,
        { sessionId: 'session-1', gateId: 'gate-1', answer: { booleanValue: true } },
        fakeContext,
      );

      expect(mockRetraverse).toHaveBeenCalledTimes(1);
      const patientCtxArg = mockRetraverse.mock.calls[0][4] as PatientContext;
      expect(patientCtxArg.labResults).toContainEqual(addedLab);
    });
  });

  describe('overrideNode', () => {
    it('includes a mid-session attribute addition (patientAttributes.trimester) in the retraversal context', async () => {
      const overriddenNode: NodeResult = {
        nodeId: 'node-1',
        nodeType: 'Criterion',
        title: 'X',
        status: NodeStatus.INCLUDED,
        confidence: 0.9,
        confidenceBreakdown: [],
        depth: 0,
      };
      const dependentNode: NodeResult = {
        nodeId: 'node-2',
        nodeType: 'Criterion',
        title: 'Y',
        status: NodeStatus.EXCLUDED,
        confidence: 0.2,
        confidenceBreakdown: [],
        depth: 1,
      };
      const session = makeSession({
        additionalContext: { patientAttributes: { trimester: 2 } },
      });
      session.resolutionState.set('node-1', overriddenNode);
      session.resolutionState.set('node-2', dependentNode);
      session.dependencyMap.influences.set('node-1', new Set(['node-2']));
      mockedGetSession.mockResolvedValue(session);

      await resolutionMutations.overrideNode(
        undefined,
        { sessionId: 'session-1', nodeId: 'node-1', action: OverrideAction.EXCLUDE },
        fakeContext,
      );

      expect(mockRetraverse).toHaveBeenCalledTimes(1);
      const patientCtxArg = mockRetraverse.mock.calls[0][4] as PatientContext;
      expect(patientCtxArg.patientAttributes?.trimester).toBe(2);
    });

    it('includes a mid-session legacy labResults addition in the retraversal context', async () => {
      const overriddenNode: NodeResult = {
        nodeId: 'node-1',
        nodeType: 'Criterion',
        title: 'X',
        status: NodeStatus.INCLUDED,
        confidence: 0.9,
        confidenceBreakdown: [],
        depth: 0,
      };
      const dependentNode: NodeResult = {
        nodeId: 'node-2',
        nodeType: 'Criterion',
        title: 'Y',
        status: NodeStatus.EXCLUDED,
        confidence: 0.2,
        confidenceBreakdown: [],
        depth: 1,
      };
      const addedLab = { code: '718-7', system: 'LOINC', value: 9.2 };
      const session = makeSession({
        additionalContext: { labResults: [addedLab] },
      });
      session.resolutionState.set('node-1', overriddenNode);
      session.resolutionState.set('node-2', dependentNode);
      session.dependencyMap.influences.set('node-1', new Set(['node-2']));
      mockedGetSession.mockResolvedValue(session);

      await resolutionMutations.overrideNode(
        undefined,
        { sessionId: 'session-1', nodeId: 'node-1', action: OverrideAction.EXCLUDE },
        fakeContext,
      );

      expect(mockRetraverse).toHaveBeenCalledTimes(1);
      const patientCtxArg = mockRetraverse.mock.calls[0][4] as PatientContext;
      expect(patientCtxArg.labResults).toContainEqual(addedLab);
    });
  });
});
