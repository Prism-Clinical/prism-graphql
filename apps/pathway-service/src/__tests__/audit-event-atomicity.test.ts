/**
 * Every event type the resolvers write must be one the database accepts, and
 * a refused event must not leave its session change behind.
 *
 * answerPendingDecision wrote `BRANCH_CHOSEN` and `PROVIDER_ASSERTED_DATUM`,
 * neither of which the CHECK on `pathway_resolution_events.event_type`
 * allowed. The branch choice committed its session update FIRST, so the choice
 * took effect while the caller was told it failed; the datum logged first, so
 * the answer failed outright.
 *
 * Two halves, both runnable without a database:
 *  1. Parity: each `eventType: '<literal>'` in the resolvers appears in the
 *     CHECK list of the latest migration that defines it.
 *  2. Atomicity: the session write and its event run on ONE transaction, and a
 *     refused event rolls the write back.
 */

import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

jest.mock('../resolvers/Query', () => ({
  PATHWAY_COLUMNS: 'id, version, status',
  formatSessionForGraphQL: (s: unknown) => s,
  hydrateSignalDefinition: (row: unknown) => row,
}));

jest.mock('../services/resolution/session-store', () => ({
  // The REAL transaction wrapper — the thing under test.
  withTransaction: jest.requireActual('../services/resolution/session-store').withTransaction,
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
jest.mock('../resolvers/helpers/resolution-context', () => ({
  ...jest.requireActual('../resolvers/helpers/resolution-context'),
  buildResolutionContext: (...a: unknown[]) => mockBuild(...a),
  makeTraversalAdapter: jest.fn(() => ({
    computeNodeConfidence: jest.fn(async (n: { nodeIdentifier: string }) => ({
      nodeIdentifier: n.nodeIdentifier, nodeType: 'Step', confidence: 0.9,
      breakdown: [], propagationInfluences: [], resolutionType: 'AUTO_RESOLVED',
    })),
  })),
  makeLlmGateEvaluator: jest.fn(() => null),
}));

import { createSession, getSession, logEvent, logGateAnswer, updateSession } from '../services/resolution/session-store';
import { resolutionMutations } from '../resolvers/mutations/resolution';
import { makeGraphContext } from './fixtures/reference-patient-context';
import { DefaultBehavior, GateType, SessionStatus } from '../services/resolution/types';
import type { NodeResult, PendingQuestion } from '../services/resolution/types';
import type { GraphEdge, GraphNode } from '../services/confidence/types';

// ─── 1. Parity with the migrations ─────────────────────────────────────

const SRC = join(__dirname, '..');
const MIGRATIONS = join(__dirname, '../../../../shared/data-layer/migrations');

function tsFilesUnder(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(d =>
    d.isDirectory()
      ? d.name === '__tests__' || d.name === '__generated__' ? [] : tsFilesUnder(join(dir, d.name))
      : d.name.endsWith('.ts') ? [join(dir, d.name)] : [],
  );
}

/** Event types the CURRENT schema allows: the last migration to define the CHECK wins. */
function allowedEventTypes(): Set<string> {
  let allowed: Set<string> | null = null;
  for (const f of readdirSync(MIGRATIONS).filter(n => n.endsWith('.sql')).sort()) {
    const sql = readFileSync(join(MIGRATIONS, f), 'utf-8').split(/^-- DOWN$/m)[0];
    if (!sql.includes('pathway_resolution_events')) continue;
    const m = sql.match(/CHECK\s*\(\s*event_type\s+IN\s*\(([\s\S]*?)\)\s*\)/i);
    if (!m) continue;
    allowed = new Set([...m[1].matchAll(/'([^']+)'/g)].map(x => x[1]));
  }
  if (!allowed) throw new Error('no migration defines the pathway_resolution_events event_type CHECK');
  return allowed;
}

describe('event types written vs the database CHECK', () => {
  it('every literal eventType the service writes is allowed by the latest migration', () => {
    const written = new Set<string>();
    for (const f of tsFilesUnder(SRC)) {
      for (const m of readFileSync(f, 'utf-8').matchAll(/eventType:\s*'([^']+)'/g)) written.add(m[1]);
    }
    // Guard against the scan silently finding nothing.
    expect(written.has('gate_answer')).toBe(true);
    expect(written.has('branch_chosen')).toBe(true);
    expect(written.has('provider_asserted_datum')).toBe(true);

    const allowed = allowedEventTypes();
    expect([...written].filter(t => !allowed.has(t))).toEqual([]);
  });
});

// ─── 2. Atomicity ──────────────────────────────────────────────────────

const mockedCreateSession = createSession as jest.MockedFunction<typeof createSession>;
const mockedGetSession = getSession as jest.MockedFunction<typeof getSession>;
const mockedLogEvent = logEvent as jest.MockedFunction<typeof logEvent>;
const mockedUpdateSession = updateSession as jest.MockedFunction<typeof updateSession>;
const mockedLogGateAnswer = logGateAnswer as jest.MockedFunction<typeof logGateAnswer>;

const PINNED = '2026-08-31T12:00:00.000Z';

function node(id: string, nodeType: string, properties: Record<string, unknown> = {}): GraphNode {
  return { id, nodeIdentifier: id, nodeType, properties: { title: id, ...properties } } as GraphNode;
}
function edge(sourceId: string, targetId: string, edgeType = 'HAS_CHILD'): GraphEdge {
  return { id: `${sourceId}->${targetId}`, edgeType, sourceId, targetId, properties: {} } as GraphEdge;
}

/** A fork with two qualifying branches (it pends) and a gate that escalates for Hb. */
const NODES = [
  node('root', 'Pathway'),
  node('dp-1', 'DecisionPoint', { title: 'Which treatment?', branch_mode: 'one_of' }),
  node('step-a', 'Step', { title: 'Treat A' }),
  node('step-b', 'Step', { title: 'Treat B' }),
  node('gate-anaemic', 'Gate', {
    gate_type: GateType.PATIENT_ATTRIBUTE,
    default_behavior: DefaultBehavior.SKIP,
    condition: { field: 'labs', operator: 'less_than', value: '718-7', system: 'LOINC', threshold: 11 },
  }),
  node('step-iron', 'Step'),
  node('gate-q', 'Gate', {
    gate_type: GateType.QUESTION, default_behavior: DefaultBehavior.SKIP,
    prompt: 'Symptomatic?', answer_type: 'boolean',
  }),
  node('step-q', 'Step'),
];
const EDGES = [
  edge('root', 'dp-1', 'HAS_DECISION_POINT'),
  edge('dp-1', 'step-a', 'BRANCHES_TO'),
  edge('dp-1', 'step-b', 'BRANCHES_TO'),
  edge('root', 'gate-anaemic', 'HAS_GATE'),
  edge('gate-anaemic', 'step-iron', 'BRANCHES_TO'),
  edge('root', 'gate-q', 'HAS_GATE'),
  edge('gate-q', 'step-q', 'BRANCHES_TO'),
];
const rctx = () => ({
  graphContext: makeGraphContext(NODES, EDGES),
  edges: EDGES, signals: [],
  thresholds: { autoResolveThreshold: 0.85, suggestThreshold: 0.6 },
  confidenceEngine: {}, codeMap: new Map(), temporalDefaults: {},
});

const txQueries: string[] = [];
const txClient = {
  query: jest.fn(async (sql: string) => { txQueries.push(sql); return { rows: [], rowCount: 1 }; }),
  release: jest.fn(),
};
const poolStub = {
  query: jest.fn().mockResolvedValue({ rows: [{ id: 'pw-1', version: 1, status: 'ACTIVE' }] }),
  connect: jest.fn(async () => txClient),
};
const ctx = () => ({
  pool: poolStub, redis: {}, userId: 'u-1', userRole: 'ADMIN', temporalPolicyVersion: 'v1',
}) as never;

async function start() {
  mockBuild.mockResolvedValue(rctx());
  await resolutionMutations.startResolution(
    null as never,
    {
      pathwayId: 'pw-1', patientId: 'pt-1', resolutionMode: 'SYNTHETIC', evaluationAsOf: PINNED,
      patientContext: { patientId: 'pt-1', conditionCodes: [], medications: [], allergies: [], labResults: [] },
    } as never,
    ctx(),
  );
  const created = mockedCreateSession.mock.calls[0][1] as unknown as {
    resolutionState: Map<string, NodeResult>; dependencyMap: unknown;
    pendingQuestions: PendingQuestion[]; initialPatientContext: unknown; temporalContext: unknown;
  };
  mockedGetSession.mockResolvedValue({
    id: 'session-1', pathwayId: 'pw-1', pathwayVersion: '1', patientId: 'pt-1', providerId: 'u-1',
    status: SessionStatus.ACTIVE,
    resolutionState: created.resolutionState, dependencyMap: created.dependencyMap,
    initialPatientContext: created.initialPatientContext, additionalContext: {},
    pendingQuestions: created.pendingQuestions, redFlags: [], resolutionEvents: [],
    gateAnswers: new Map(), totalNodesEvaluated: created.resolutionState.size,
    traversalDurationMs: 1, ddiWarnings: [], temporalContext: created.temporalContext,
    createdAt: new Date(), updatedAt: new Date(),
  } as never);
  mockBuild.mockResolvedValue(rctx());
  return created;
}

const CHECK_VIOLATION = Object.assign(
  new Error('new row for relation "pathway_resolution_events" violates check constraint'),
  { code: '23514' },
);

beforeEach(() => {
  jest.clearAllMocks();
  txQueries.length = 0;
  poolStub.query.mockResolvedValue({ rows: [{ id: 'pw-1', version: 1, status: 'ACTIVE' }] });
  mockedCreateSession.mockResolvedValue('session-1');
  mockedGetSession.mockResolvedValue({ id: 'session-1' } as never);
});

describe('a refused audit event does not half-commit', () => {
  it('branch choice: session update and branch_chosen share one transaction', async () => {
    const created = await start();
    expect(created.pendingQuestions.some(q => q.gateId === 'dp-1')).toBe(true);

    await resolutionMutations.answerPendingDecision(
      undefined as never,
      { sessionId: 'session-1', nodeId: 'dp-1', answer: { selectedOption: 'step-b' } },
      ctx(),
    );

    const ev = mockedLogEvent.mock.calls.find(c => (c[2] as { eventType: string }).eventType === 'branch_chosen');
    expect(ev).toBeDefined();
    expect(ev![0]).toBe(txClient);
    expect(mockedUpdateSession.mock.calls.at(-1)![0]).toBe(txClient);
    expect(txQueries).toEqual(['BEGIN', 'COMMIT']);
    expect(txClient.release).toHaveBeenCalledTimes(1);
  });

  it('branch choice: a refused event rolls the session update back', async () => {
    await start();
    mockedLogEvent.mockRejectedValueOnce(CHECK_VIOLATION);

    await expect(resolutionMutations.answerPendingDecision(
      undefined as never,
      { sessionId: 'session-1', nodeId: 'dp-1', answer: { selectedOption: 'step-b' } },
      ctx(),
    )).rejects.toThrow(/check constraint/);

    expect(mockedUpdateSession).toHaveBeenCalled();
    expect(txQueries).toEqual(['BEGIN', 'ROLLBACK']);
    expect(txClient.release).toHaveBeenCalledTimes(1);
  });

  it('provider datum: the fact, context_update and provider_asserted_datum share one transaction', async () => {
    const created = await start();
    const ask = created.pendingQuestions.find(q => q.datumKey === 'LOINC:718-7')!;
    expect(ask).toBeDefined();

    await resolutionMutations.answerPendingDecision(
      undefined as never,
      { sessionId: 'session-1', nodeId: ask.gateId, answer: { numericValue: 9.1 } },
      ctx(),
    );

    const types = mockedLogEvent.mock.calls.map(c => [c[0], (c[2] as { eventType: string }).eventType]);
    expect(types).toEqual(expect.arrayContaining([
      [txClient, 'provider_asserted_datum'],
      [txClient, 'context_update'],
    ]));
    expect(mockedUpdateSession.mock.calls.at(-1)![0]).toBe(txClient);
    expect(txQueries).toEqual(['BEGIN', 'COMMIT']);
  });

  it('provider datum: a refused event rolls the fact back', async () => {
    const created = await start();
    const ask = created.pendingQuestions.find(q => q.datumKey === 'LOINC:718-7')!;
    mockedLogEvent.mockRejectedValueOnce(CHECK_VIOLATION);

    await expect(resolutionMutations.answerPendingDecision(
      undefined as never,
      { sessionId: 'session-1', nodeId: ask.gateId, answer: { numericValue: 9.1 } },
      ctx(),
    )).rejects.toThrow(/check constraint/);

    expect(txQueries).toEqual(['BEGIN', 'ROLLBACK']);
  });

  it('question gate: session update, gate_answer and the pathway_gate_answers row share one transaction', async () => {
    await start();

    await resolutionMutations.answerPendingDecision(
      undefined as never,
      { sessionId: 'session-1', nodeId: 'gate-q', answer: { booleanValue: true } },
      ctx(),
    );

    expect(mockedUpdateSession.mock.calls.at(-1)![0]).toBe(txClient);
    const ev = mockedLogEvent.mock.calls.find(c => (c[2] as { eventType: string }).eventType === 'gate_answer');
    expect(ev![0]).toBe(txClient);
    expect(mockedLogGateAnswer.mock.calls[0][0]).toBe(txClient);
    expect(txQueries).toEqual(['BEGIN', 'COMMIT']);
  });

  it('question gate: a refused pathway_gate_answers row rolls the answer back', async () => {
    await start();
    mockedLogGateAnswer.mockRejectedValueOnce(new Error('insert refused'));

    await expect(resolutionMutations.answerPendingDecision(
      undefined as never,
      { sessionId: 'session-1', nodeId: 'gate-q', answer: { booleanValue: true } },
      ctx(),
    )).rejects.toThrow('insert refused');

    expect(txQueries).toEqual(['BEGIN', 'ROLLBACK']);
  });
});
