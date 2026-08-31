/**
 * An answer to an escalated datum request is a FACT, not a verdict.
 *
 * The engines are real here — only the database seams are mocked — so the gate
 * decision under test is produced by the same `evaluateGate` a request runs.
 * That matters: the point of injecting a fact rather than short-circuiting the
 * gate is that the gate then decides on the VALUE, and only a real evaluation
 * can demonstrate the difference.
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

const mockBuildResolutionContext = jest.fn();
jest.mock('../resolvers/helpers/resolution-context', () => ({
  ...jest.requireActual('../resolvers/helpers/resolution-context'),
  buildResolutionContext: (...a: unknown[]) => mockBuildResolutionContext(...a),
  makeTraversalAdapter: jest.fn(() => ({
    computeNodeConfidence: jest.fn().mockResolvedValue({
      nodeIdentifier: 'n', nodeType: 'Step', confidence: 0.95,
      breakdown: [], propagationInfluences: [], resolutionType: 'AUTO_RESOLVED',
    }),
  })),
  makeLlmGateEvaluator: jest.fn(() => null),
}));

import { createSession, getSession, logEvent } from '../services/resolution/session-store';
import { resolutionMutations } from '../resolvers/mutations/resolution';
import { makeGraphContext } from './fixtures/reference-patient-context';
import {
  DefaultBehavior,
  GateType,
  NodeStatus,
  SessionStatus,
  createEmptyDependencyMap,
} from '../services/resolution/types';
import type { NodeResult, PendingQuestion } from '../services/resolution/types';
import type { GraphEdge, GraphNode } from '../services/confidence/types';
import { makeEvaluationTemporalContext } from '../services/resolution/temporal/evaluation-context';

const mockedCreateSession = createSession as jest.MockedFunction<typeof createSession>;
const mockedGetSession = getSession as jest.MockedFunction<typeof getSession>;
const mockedLogEvent = logEvent as jest.MockedFunction<typeof logEvent>;

const PINNED = '2026-08-30T12:00:00.000Z';

function node(id: string, nodeType: string, properties: Record<string, unknown> = {}): GraphNode {
  return { id, nodeIdentifier: id, nodeType, properties: { title: id, ...properties } } as GraphNode;
}
function edge(sourceId: string, targetId: string): GraphEdge {
  return { id: `${sourceId}->${targetId}`, edgeType: 'HAS_CHILD', sourceId, targetId, properties: {} } as GraphEdge;
}

/** Two gates on ONE haemoglobin, at different thresholds. */
const NODES = [
  node('root', 'Pathway'),
  node('gate-anaemic', 'Gate', {
    gate_type: GateType.PATIENT_ATTRIBUTE,
    default_behavior: DefaultBehavior.SKIP,
    condition: { field: 'labs', operator: 'less_than', value: '718-7', system: 'LOINC', threshold: 11 },
  }),
  node('gate-severe', 'Gate', {
    gate_type: GateType.PATIENT_ATTRIBUTE,
    default_behavior: DefaultBehavior.SKIP,
    condition: { field: 'labs', operator: 'less_than', value: '718-7', system: 'LOINC', threshold: 7 },
  }),
  node('step-oral-iron', 'Step'),
  node('step-transfuse', 'Step'),
];
const EDGES = [
  edge('root', 'gate-anaemic'), edge('root', 'gate-severe'),
  edge('gate-anaemic', 'step-oral-iron'), edge('gate-severe', 'step-transfuse'),
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
const ctx = () => ({
  pool: poolStub, redis: {}, userId: 'u-1', userRole: 'ADMIN',
  temporalPolicyVersion: 'v1',
}) as never;

/** Start a session with NO labs, so both gates escalate. */
async function startWithNoLabs() {
  mockBuildResolutionContext.mockResolvedValue(rctx());
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
    // The REAL dependency map, not an empty one: addPatientContext finds the
    // gates to re-resolve through gateContextFields, so an empty map means
    // nothing is marked affected and the injected fact reaches no gate.
    dependencyMap: ReturnType<typeof createEmptyDependencyMap>;
    pendingQuestions: PendingQuestion[];
    initialPatientContext: unknown;
    temporalContext: unknown;
    gateAnswers: Map<string, unknown>;
  };
}

/** Present the started session back to the mutations under test. */
function sessionFrom(created: Awaited<ReturnType<typeof startWithNoLabs>>) {
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

beforeEach(() => {
  jest.clearAllMocks();
  poolStub.query.mockResolvedValue({ rows: [{ id: 'pw-1', version: 1, status: 'ACTIVE' }] });
  mockedCreateSession.mockResolvedValue('session-1');
  mockedGetSession.mockResolvedValue({ id: 'session-1' } as never);
});

describe('an escalated answer becomes a fact', () => {
  it('escalates both gates but asks for the haemoglobin once', async () => {
    const created = await startWithNoLabs();

    expect(created.resolutionState.get('gate-anaemic')!.status).toBe(NodeStatus.PENDING_QUESTION);
    expect(created.resolutionState.get('gate-severe')!.status).toBe(NodeStatus.PENDING_QUESTION);
    expect(created.pendingQuestions).toHaveLength(1);
    expect(created.pendingQuestions[0].datumKey).toBe('LOINC:718-7');
  });

  it('resolves BOTH gates on the value — one answer, five gates in principle', async () => {
    const created = await startWithNoLabs();
    const session = sessionFrom(created);
    mockedGetSession.mockResolvedValue(session);
    mockBuildResolutionContext.mockResolvedValue(rctx());

    // Hb 9.1: anaemic (< 11) but not severe (< 7). If the answer were treated
    // as a verdict — "any value opens the gate" — BOTH would open, and the
    // patient would be queued for a transfusion.
    await resolutionMutations.answerGateQuestion(
      undefined as never,
      { sessionId: 'session-1', gateId: created.pendingQuestions[0].gateId, answer: { numericValue: 9.1 } },
      ctx(),
    );

    expect(created.resolutionState.get('gate-anaemic')!.status).toBe(NodeStatus.INCLUDED);
    expect(created.resolutionState.get('gate-severe')!.status).toBe(NodeStatus.GATED_OUT);
  });

  it('does NOT record the answer in gateAnswers', async () => {
    const created = await startWithNoLabs();
    const session = sessionFrom(created) as unknown as { gateAnswers: Map<string, unknown> };
    mockedGetSession.mockResolvedValue(session as never);
    mockBuildResolutionContext.mockResolvedValue(rctx());

    await resolutionMutations.answerGateQuestion(
      undefined as never,
      { sessionId: 'session-1', gateId: created.pendingQuestions[0].gateId, answer: { numericValue: 9.1 } },
      ctx(),
    );

    // gateAnswers is what evaluateQuestion reads. An entry here would make
    // this data gate look like an answered QUESTION gate, and be consulted
    // instead of the fact on every later retraversal.
    expect(session.gateAnswers.size).toBe(0);
  });

  it('records that the datum was provider-asserted, not read off the chart', async () => {
    const created = await startWithNoLabs();
    mockedGetSession.mockResolvedValue(sessionFrom(created));
    mockBuildResolutionContext.mockResolvedValue(rctx());

    await resolutionMutations.answerGateQuestion(
      undefined as never,
      { sessionId: 'session-1', gateId: created.pendingQuestions[0].gateId, answer: { numericValue: 9.1 } },
      ctx(),
    );

    const asserted = mockedLogEvent.mock.calls.find(
      c => (c[2] as { eventType: string }).eventType === 'PROVIDER_ASSERTED_DATUM',
    );
    expect(asserted).toBeDefined();
    expect((asserted![2] as { triggerData: { datumKey: string; value: number } }).triggerData)
      .toMatchObject({ datumKey: 'LOINC:718-7', value: 9.1 });
  });

  it('refuses a non-numeric answer to a datum request', async () => {
    const created = await startWithNoLabs();
    mockedGetSession.mockResolvedValue(sessionFrom(created));
    mockBuildResolutionContext.mockResolvedValue(rctx());

    await expect(
      resolutionMutations.answerGateQuestion(
        undefined as never,
        { sessionId: 'session-1', gateId: created.pendingQuestions[0].gateId, answer: { booleanValue: true } },
        ctx(),
      ),
    ).rejects.toThrow(/numericValue/);
  });
});
