/**
 * A missing `patient.*` attribute pends as a datum request — and the provider
 * must then be able to ANSWER it, whatever type the attribute is.
 *
 * The answer path used to accept only `numericValue`, and `askFor` asked every
 * attribute as NUMERIC. So `patient.rh_factor equals "negative"` or
 * `patient.prior_cesarean equals true` pended with a question no answer could
 * clear. Each loop here runs the whole round trip: pend → answer → re-traverse
 * → gate decided, question gone. Engines are real; only the database seams
 * are mocked (same harness as provider-datum-dating).
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
import { makeGraphContext } from './fixtures/reference-patient-context';
import { AnswerType, DefaultBehavior, GateType, NodeStatus, SessionStatus } from '../services/resolution/types';
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

/** One attribute gate over one step. */
function oneGate(condition: Record<string, unknown>) {
  const nodes = [
    node('root', 'Pathway'),
    node('gate-1', 'Gate', {
      gate_type: GateType.PATIENT_ATTRIBUTE,
      default_behavior: DefaultBehavior.SKIP,
      condition,
    }),
    node('step-1', 'Step'),
  ];
  const edges = [edge('root', 'gate-1'), edge('gate-1', 'step-1')];
  return { nodes, edges };
}

type Graph = { nodes: GraphNode[]; edges: GraphEdge[] };
const rctx = ({ nodes, edges }: Graph) => ({
  graphContext: makeGraphContext(nodes, edges), edges, signals: [],
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

async function start(graph: Graph, labResults: unknown[] = []): Promise<Created> {
  mockBuild.mockResolvedValue(rctx(graph));
  await resolutionMutations.startResolution(
    null as never,
    {
      pathwayId: 'pw-1', patientId: 'pt-1', resolutionMode: 'SYNTHETIC', evaluationAsOf: PINNED,
      patientContext: {
        patientId: 'pt-1', conditionCodes: [], medications: [], allergies: [], labResults,
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

function answer(gateId: string, answer: Record<string, unknown>) {
  return resolutionMutations.answerPendingDecision(
    undefined as never, { sessionId: 'session-1', nodeId: gateId, answer }, ctx(),
  );
}

function assertedEvent() {
  const ev = mockedLogEvent.mock.calls.find(
    c => (c[2] as { eventType: string }).eventType === 'provider_asserted_datum',
  );
  return (ev![2] as { triggerData: Record<string, unknown> }).triggerData;
}

beforeEach(() => {
  jest.clearAllMocks();
  poolStub.query.mockResolvedValue({ rows: [{ id: 'pw-1', version: 1, status: 'ACTIVE' }] });
  mockedCreateSession.mockResolvedValue('session-1');
  mockedGetSession.mockResolvedValue({ id: 'session-1' } as never);
});

describe('a pending patient.* datum can be answered, whatever its type', () => {
  it('NUMERIC: patient.gestational_age_weeks >= 18 — pend, answer 20, gate included, question gone', async () => {
    const graph = oneGate({ attribute: 'patient.gestational_age_weeks', operator: 'greater_or_equal', value: 18 });
    const created = await start(graph);
    expect(created.resolutionState.get('gate-1')!.status).toBe(NodeStatus.PENDING_QUESTION);
    expect(created.pendingQuestions).toHaveLength(1);
    const q = created.pendingQuestions[0];
    expect(q.datumKey).toBe('patient.gestational_age_weeks');
    expect(q.answerType).toBe(AnswerType.NUMERIC);

    const session = storedFrom(created);
    await answer(q.gateId, { numericValue: 20 });

    expect(session.additionalContext).toMatchObject({ patientAttributes: { gestational_age_weeks: 20 } });
    expect(created.resolutionState.get('gate-1')!.status).toBe(NodeStatus.INCLUDED);
    expect(created.resolutionState.get('step-1')!.status).toBe(NodeStatus.INCLUDED);
    expect(session.pendingQuestions).toEqual([]);
    expect(assertedEvent()).toMatchObject({
      datumKey: 'patient.gestational_age_weeks', value: 20, answerType: AnswerType.NUMERIC,
      assertedAsOf: PINNED, answeredAt: expect.any(String),
    });
  });

  it('BOOLEAN: patient.prior_cesarean equals true — pend, answer false, gate decided "no", question gone', async () => {
    const graph = oneGate({ attribute: 'patient.prior_cesarean', operator: 'equals', value: true });
    const created = await start(graph);
    expect(created.resolutionState.get('gate-1')!.status).toBe(NodeStatus.PENDING_QUESTION);
    const q = created.pendingQuestions[0];
    expect(q.datumKey).toBe('patient.prior_cesarean');
    expect(q.answerType).toBe(AnswerType.BOOLEAN);
    expect(q.options).toBeUndefined();

    const session = storedFrom(created);
    // FALSE, deliberately: a "no" must be stored as the boolean false and
    // DECIDE the gate — not be mistaken for a missing value and ask again.
    await answer(q.gateId, { booleanValue: false });

    expect(session.additionalContext).toMatchObject({ patientAttributes: { prior_cesarean: false } });
    expect(created.resolutionState.get('gate-1')!.status).toBe(NodeStatus.GATED_OUT);
    expect(created.resolutionState.get('step-1')!.status).toBe(NodeStatus.GATED_OUT);
    expect(session.pendingQuestions).toEqual([]);
    expect(assertedEvent()).toMatchObject({
      datumKey: 'patient.prior_cesarean', value: false, answerType: AnswerType.BOOLEAN,
      assertedAsOf: PINNED,
    });
  });

  it('BOOLEAN: answering true includes the subtree', async () => {
    const created = await start(oneGate({ attribute: 'patient.prior_cesarean', operator: 'equals', value: true }));
    const session = storedFrom(created);
    await answer(created.pendingQuestions[0].gateId, { booleanValue: true });
    expect(created.resolutionState.get('step-1')!.status).toBe(NodeStatus.INCLUDED);
    expect(session.pendingQuestions).toEqual([]);
  });

  it('SELECT: patient.rh_factor in ["negative", "unknown"] — options are the comparands; answer "negative", gate included', async () => {
    const graph = oneGate({ attribute: 'patient.rh_factor', operator: 'in', value: ['negative', 'unknown'] });
    const created = await start(graph);
    expect(created.resolutionState.get('gate-1')!.status).toBe(NodeStatus.PENDING_QUESTION);
    const q = created.pendingQuestions[0];
    expect(q.datumKey).toBe('patient.rh_factor');
    expect(q.answerType).toBe(AnswerType.SELECT);
    expect(q.options).toEqual(['negative', 'unknown']);

    const session = storedFrom(created);
    await answer(q.gateId, { selectedOption: 'negative' });

    expect(session.additionalContext).toMatchObject({ patientAttributes: { rh_factor: 'negative' } });
    expect(created.resolutionState.get('gate-1')!.status).toBe(NodeStatus.INCLUDED);
    expect(created.resolutionState.get('step-1')!.status).toBe(NodeStatus.INCLUDED);
    expect(session.pendingQuestions).toEqual([]);
    expect(assertedEvent()).toMatchObject({
      datumKey: 'patient.rh_factor', value: 'negative', answerType: AnswerType.SELECT,
    });
  });

  it('SELECT: two gates on one attribute ask ONCE, offer BOTH comparands, and one answer decides both', async () => {
    const nodes = [
      node('root', 'Pathway'),
      node('gate-neg', 'Gate', {
        gate_type: GateType.PATIENT_ATTRIBUTE, default_behavior: DefaultBehavior.SKIP,
        condition: { attribute: 'patient.rh_factor', operator: 'equals', value: 'negative' },
      }),
      node('gate-pos', 'Gate', {
        gate_type: GateType.PATIENT_ATTRIBUTE, default_behavior: DefaultBehavior.SKIP,
        condition: { attribute: 'patient.rh_factor', operator: 'equals', value: 'positive' },
      }),
      node('step-rhogam', 'Step'),
      node('step-routine', 'Step'),
    ];
    const edges = [
      edge('root', 'gate-neg'), edge('root', 'gate-pos'),
      edge('gate-neg', 'step-rhogam'), edge('gate-pos', 'step-routine'),
    ];
    const created = await start({ nodes, edges });
    expect(created.pendingQuestions).toHaveLength(1);
    const q = created.pendingQuestions[0];
    expect(q.answerType).toBe(AnswerType.SELECT);
    expect([...q.options!].sort()).toEqual(['negative', 'positive']);

    const session = storedFrom(created);
    await answer(q.gateId, { selectedOption: 'positive' });

    expect(created.resolutionState.get('gate-neg')!.status).toBe(NodeStatus.GATED_OUT);
    expect(created.resolutionState.get('gate-pos')!.status).toBe(NodeStatus.INCLUDED);
    expect(created.resolutionState.get('step-routine')!.status).toBe(NodeStatus.INCLUDED);
    expect(session.pendingQuestions).toEqual([]);
  });

  it('a numeric `in` list asks NUMERIC, not SELECT — the value may lie outside the list', async () => {
    const created = await start(oneGate({ attribute: 'patient.parity', operator: 'in', value: [0, 1] }));
    expect(created.pendingQuestions[0].answerType).toBe(AnswerType.NUMERIC);
    expect(created.pendingQuestions[0].options).toBeUndefined();
  });
});

describe('an answer that does not fit the patient.* question is refused, and nothing is stored', () => {
  async function pendingRh() {
    const created = await start(oneGate({ attribute: 'patient.rh_factor', operator: 'in', value: ['negative', 'unknown'] }));
    const session = storedFrom(created);
    return { created, session, gateId: created.pendingQuestions[0].gateId };
  }

  it('an option the question does not offer', async () => {
    const { created, session, gateId } = await pendingRh();
    await expect(answer(gateId, { selectedOption: 'Negative' })).rejects.toThrow(/not one of the options/);
    expect(session.additionalContext).toEqual({});
    expect(created.resolutionState.get('gate-1')!.status).toBe(NodeStatus.PENDING_QUESTION);
  });

  it('the wrong field for the question', async () => {
    const { session, gateId } = await pendingRh();
    await expect(answer(gateId, { booleanValue: true })).rejects.toThrow(/supply selectedOption/);
    expect(session.additionalContext).toEqual({});
  });

  it('a boolean question sent the string "true"', async () => {
    const created = await start(oneGate({ attribute: 'patient.prior_cesarean', operator: 'equals', value: true }));
    const session = storedFrom(created);
    await expect(answer(created.pendingQuestions[0].gateId, { selectedOption: 'true' }))
      .rejects.toThrow(/supply booleanValue/);
    expect(session.additionalContext).toEqual({});
  });

  it('more than one field', async () => {
    const created = await start(oneGate({ attribute: 'patient.prior_cesarean', operator: 'equals', value: true }));
    storedFrom(created);
    await expect(answer(created.pendingQuestions[0].gateId, { booleanValue: true, numericValue: 1 }))
      .rejects.toThrow(/supply only booleanValue/);
  });
});

describe('lab datum answers are unaffected', () => {
  const LAB_GATE = { field: 'labs', operator: 'less_than', value: '718-7', system: 'LOINC', threshold: 11 };

  it('still NUMERIC, still dated and provider-asserted, and still decides the gate', async () => {
    const created = await start(oneGate(LAB_GATE));
    const q = created.pendingQuestions[0];
    expect(q.datumKey).toBe('LOINC:718-7');
    expect(q.answerType).toBe(AnswerType.NUMERIC);
    expect(q.options).toBeUndefined();

    const session = storedFrom(created);
    await answer(q.gateId, { numericValue: 10.2 });

    expect((session.additionalContext as { labResults: unknown[] }).labResults).toEqual([
      expect.objectContaining({ code: '718-7', value: 10.2, date: PINNED, providerAsserted: true }),
    ]);
    expect(session.additionalContext).not.toHaveProperty('patientAttributes');
    expect(created.resolutionState.get('gate-1')!.status).toBe(NodeStatus.INCLUDED);
    expect(session.pendingQuestions).toEqual([]);
    expect(assertedEvent()).toMatchObject({ value: 10.2, answerType: AnswerType.NUMERIC });
  });

  it('a lab.* attribute mapped to a LOINC code is still asked as a NUMERIC lab', async () => {
    const nodes = oneGate({ attribute: 'lab.hemoglobin', operator: 'less_than', value: 11 });
    const codeMap = new Map([[
      'lab.hemoglobin',
      { attributeName: 'lab.hemoglobin', namespace: 'lab', system: 'LOINC', code: '718-7', valueType: 'number' as const },
    ]]);
    mockBuild.mockResolvedValue({ ...rctx(nodes), codeMap });
    await resolutionMutations.startResolution(
      null as never,
      {
        pathwayId: 'pw-1', patientId: 'pt-1', resolutionMode: 'SYNTHETIC', evaluationAsOf: PINNED,
        patientContext: { patientId: 'pt-1', conditionCodes: [], medications: [], allergies: [], labResults: [] },
      } as never,
      ctx(),
    );
    const created = mockedCreateSession.mock.calls[0][1] as unknown as Created;
    const q = created.pendingQuestions[0];
    expect(q.askTarget).toEqual({ kind: 'lab', code: '718-7', system: 'LOINC' });
    expect(q.answerType).toBe(AnswerType.NUMERIC);
  });

  it('a boolean answer to a lab datum is refused with the original message', async () => {
    const created = await start(oneGate(LAB_GATE));
    const session = storedFrom(created);
    await expect(answer(created.pendingQuestions[0].gateId, { booleanValue: true }))
      .rejects.toThrow(/is a request for LOINC:718-7; supply numericValue/);
    expect(session.additionalContext).toEqual({});
  });
});
