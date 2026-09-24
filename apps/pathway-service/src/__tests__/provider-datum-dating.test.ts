/**
 * An escalated datum answer settles an AMBIGUOUS_LATEST gate, end to end.
 *
 * Two undated haemoglobins on the chart → the gate cannot order them → it asks
 * the provider. The answer used to be injected undated as well, so it became a
 * third unorderable value and the gate asked again. Engines are real; only the
 * database seams are mocked (same harness as escalated-answer-injection).
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
  withTransaction: jest.fn((pool: unknown, fn: (tx: unknown) => unknown) => fn(pool)),
  logNodeOverride: jest.fn().mockResolvedValue(undefined),
  logGateAnswer: jest.fn().mockResolvedValue(undefined),
  getMatchedPathways: jest.fn().mockResolvedValue([]),
}));

jest.mock('../services/medications/ddi-pass-single-pathway', () => ({
  applyDdiToResolutionState: jest.fn().mockResolvedValue({ findings: [] }),
}));

const mockBuild = jest.fn();
jest.mock('../resolvers/helpers/resolution-context', () => ({
  ...jest.requireActual('../resolvers/helpers/resolution-context'),
  buildResolutionContext: (...a: unknown[]) => mockBuild(...a),
  makeTraversalAdapter: jest.fn(() => ({
    computeNodeConfidence: jest.fn().mockResolvedValue({
      nodeIdentifier: 'n', nodeType: 'Step', confidence: 0.95,
      breakdown: [], propagationInfluences: [], resolutionType: 'AUTO_RESOLVED',
    }),
  })),
  makeLlmGateEvaluator: jest.fn(() => null),
}));

import { createSession, getSession, logEvent, updateSession } from '../services/resolution/session-store';
import { resolutionMutations } from '../resolvers/mutations/resolution';
import { mergeAdditionalContext } from '../services/resolution/effective-context';
import { makeGraphContext } from './fixtures/reference-patient-context';
import { DefaultBehavior, GateType, NodeStatus, SessionStatus } from '../services/resolution/types';
import type { NodeResult, PendingQuestion } from '../services/resolution/types';
import type { GraphEdge, GraphNode } from '../services/confidence/types';

const mockedCreateSession = createSession as jest.MockedFunction<typeof createSession>;
const mockedGetSession = getSession as jest.MockedFunction<typeof getSession>;
const mockedUpdateSession = updateSession as jest.MockedFunction<typeof updateSession>;
const mockedLogEvent = logEvent as jest.MockedFunction<typeof logEvent>;

const PINNED = '2026-09-20T12:00:00.000Z';

function node(id: string, nodeType: string, properties: Record<string, unknown> = {}): GraphNode {
  return { id, nodeIdentifier: id, nodeType, properties: { title: id, ...properties } } as GraphNode;
}
function edge(sourceId: string, targetId: string): GraphEdge {
  return { id: `${sourceId}->${targetId}`, edgeType: 'HAS_CHILD', sourceId, targetId, properties: {} } as GraphEdge;
}

const NODES = [
  node('root', 'Pathway'),
  node('gate-anaemic', 'Gate', {
    gate_type: GateType.PATIENT_ATTRIBUTE,
    default_behavior: DefaultBehavior.SKIP,
    condition: { field: 'labs', operator: 'less_than', value: '718-7', system: 'LOINC', threshold: 11 },
  }),
  node('step-oral-iron', 'Step'),
];
const EDGES = [edge('root', 'gate-anaemic'), edge('gate-anaemic', 'step-oral-iron')];
const rctx = () => ({
  graphContext: makeGraphContext(NODES, EDGES), edges: EDGES, signals: [],
  thresholds: { autoResolveThreshold: 0.85, suggestThreshold: 0.6 },
  confidenceEngine: {}, codeMap: new Map(), temporalDefaults: {},
});

const poolStub = { query: jest.fn().mockResolvedValue({ rows: [{ id: 'pw-1', version: 1, status: 'ACTIVE' }] }) };
const ctx = () => ({
  pool: poolStub, redis: {}, userId: 'u-1', userRole: 'ADMIN', temporalPolicyVersion: 'v1',
}) as never;

type Created = {
  resolutionState: Map<string, NodeResult>; dependencyMap: unknown;
  pendingQuestions: PendingQuestion[]; initialPatientContext: unknown; temporalContext: unknown;
};

/** Two UNDATED haemoglobins, 9 and 12: which is latest is unknowable. */
async function startAmbiguous(): Promise<Created> {
  mockBuild.mockResolvedValue(rctx());
  await resolutionMutations.startResolution(
    null as never,
    {
      pathwayId: 'pw-1', patientId: 'pt-1', resolutionMode: 'SYNTHETIC', evaluationAsOf: PINNED,
      patientContext: {
        patientId: 'pt-1', conditionCodes: [], medications: [], allergies: [],
        labResults: [
          { code: '718-7', system: 'LOINC', value: 9 },
          { code: '718-7', system: 'LOINC', value: 12 },
        ],
      },
    } as never,
    ctx(),
  );
  return mockedCreateSession.mock.calls[0][1] as unknown as Created;
}

/** A mutable stored session: each update is folded back in, as the DB would. */
function storedFrom(created: Created) {
  const session = {
    id: 'session-1', pathwayId: 'pw-1', pathwayVersion: '1', patientId: 'pt-1', providerId: 'u-1',
    status: SessionStatus.ACTIVE,
    resolutionState: created.resolutionState, dependencyMap: created.dependencyMap,
    initialPatientContext: created.initialPatientContext, additionalContext: {} as Record<string, unknown>,
    pendingQuestions: created.pendingQuestions, redFlags: [], resolutionEvents: [],
    gateAnswers: new Map(), totalNodesEvaluated: created.resolutionState.size,
    traversalDurationMs: 1, ddiWarnings: [], temporalContext: created.temporalContext,
    createdAt: new Date(), updatedAt: new Date(),
  };
  mockedGetSession.mockImplementation(async () => session as never);
  mockedUpdateSession.mockImplementation(async (_db, _id, updates) => {
    Object.assign(session, updates);
  });
  return session;
}

async function answer(gateId: string, value: number) {
  await resolutionMutations.answerPendingDecision(
    undefined as never, { sessionId: 'session-1', nodeId: gateId, answer: { numericValue: value } }, ctx(),
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  poolStub.query.mockResolvedValue({ rows: [{ id: 'pw-1', version: 1, status: 'ACTIVE' }] });
  mockedCreateSession.mockResolvedValue('session-1');
  mockedGetSession.mockResolvedValue({ id: 'session-1' } as never);
});

describe('a provider-supplied datum settles an ambiguous latest value', () => {
  it('two undated values escalate (the precondition)', async () => {
    const created = await startAmbiguous();
    expect(created.resolutionState.get('gate-anaemic')!.status).toBe(NodeStatus.PENDING_QUESTION);
    expect(created.pendingQuestions.map(q => q.datumKey)).toEqual(['LOINC:718-7']);
  });

  it('the answer is dated at the session clock, marked provider-asserted, and decides the gate', async () => {
    const created = await startAmbiguous();
    const session = storedFrom(created);

    await answer(created.pendingQuestions[0].gateId, 10.2);

    const labs = (session.additionalContext as { labResults: Array<Record<string, unknown>> }).labResults;
    expect(labs).toEqual([
      expect.objectContaining({ code: '718-7', value: 10.2, date: PINNED, providerAsserted: true }),
    ]);
    // 10.2 < 11: decided, and no longer asking.
    expect(created.resolutionState.get('gate-anaemic')!.status).toBe(NodeStatus.INCLUDED);
    expect(session.pendingQuestions).toEqual([]);

    // The audit row carries when the provider actually answered.
    const ev = mockedLogEvent.mock.calls.find(c => (c[2] as { eventType: string }).eventType === 'provider_asserted_datum');
    expect((ev![2] as { triggerData: Record<string, unknown> }).triggerData)
      .toMatchObject({ value: 10.2, assertedAsOf: PINNED, answeredAt: expect.any(String) });
  });

  it('a later provider answer for the same code SUPERSEDES the earlier one', () => {
    // Both are dated at the same session instant: kept together they would
    // tie and re-escalate, and occurrence dedup (keyed on the date) would
    // discard the CORRECTION rather than the original.
    const first = { code: '718-7', system: 'LOINC', value: 10.2, date: PINNED, providerAsserted: true };
    const chart = { code: '718-7', system: 'LOINC', value: 9 };
    const other = { code: '789-8', system: 'LOINC', value: 4, date: PINNED, providerAsserted: true };
    const merged = mergeAdditionalContext(
      { labResults: [chart, first, other] },
      { labResults: [{ ...first, value: 11.5 }] },
    );
    expect(merged.labResults).toEqual([chart, other, { ...first, value: 11.5 }]);
  });
});
