/**
 * Plan 04 Task 3, Step 5 — the plumbing proof.
 *
 * `pathwayDefaults` is a REQUIRED cascade input (D6, P1-10): omitted at one of
 * the five engine construction sites, that pathway evaluates against system
 * defaults while its own anchor preflight resolved against pathway defaults,
 * and preflight and evaluation disagree about the same pathway (locked
 * decision #7).
 *
 * This is asserted with CONSTRUCTOR SPIES, not with behavior, and that choice
 * is load-bearing (P1-16). At this task `evaluateConditionKernel` still
 * delegates to the legacy evaluator and `factStore` is always empty, so the
 * legacy path never consults `pathwayDefaults` at all: a behavioral cascade
 * test here could not fail even with the argument dropped entirely. The
 * behavioral proof arrives at Task 9, once the kernel and the assembler are
 * live. Until then the only honest claim is the structural one — every site
 * hands the engine `rctx.temporalDefaults`, by identity.
 *
 * The mock set mirrors resolution-input-contract.test.ts and
 * retraversal-clock-reuse.test.ts. `jest.mock` with a factory replaces the
 * WHOLE module, so any export a resolver imports and the factory omits is
 * `undefined` at call time — session-store below therefore lists every export
 * BOTH resolution.ts and multi-pathway-resolution.ts import.
 */

const traversalCtor = jest.fn();
const retraversalCtor = jest.fn();
const mockTraverse = jest.fn();
const mockRetraverse = jest.fn();

jest.mock('../../resolvers/Query', () => ({
  PATHWAY_COLUMNS: 'id, version, status',
  formatSessionForGraphQL: (s: unknown) => s,
  hydrateSignalDefinition: (row: unknown) => row,
}));

jest.mock('../../services/resolution/traversal-engine', () => ({
  TraversalEngine: class {
    constructor(...args: unknown[]) {
      traversalCtor(...args);
    }
    traverse = mockTraverse;
  },
}));

jest.mock('../../services/resolution/retraversal-engine', () => ({
  RetraversalEngine: class {
    constructor(...args: unknown[]) {
      retraversalCtor(...args);
    }
    retraverse = mockRetraverse;
  },
}));

jest.mock('../../services/resolution/session-store', () => ({
  createSession: jest.fn().mockResolvedValue('session-1'),
  getSession: jest.fn(),
  updateSession: jest.fn().mockResolvedValue(undefined),
  logEvent: jest.fn().mockResolvedValue(undefined),
  logNodeOverride: jest.fn().mockResolvedValue(undefined),
  logGateAnswer: jest.fn().mockResolvedValue(undefined),
  getMatchedPathways: jest.fn().mockResolvedValue([]),
}));

jest.mock('../../services/medications/ddi-pass-single-pathway', () => ({
  applyDdiToResolutionState: jest.fn().mockResolvedValue({ findings: [] }),
}));

const mockBuildResolutionContext = jest.fn();
jest.mock('../../resolvers/helpers/resolution-context', () => ({
  ...jest.requireActual('../../resolvers/helpers/resolution-context'),
  buildResolutionContext: (...a: unknown[]) => mockBuildResolutionContext(...a),
  makeTraversalAdapter: jest.fn(() => ({ computeNodeConfidence: jest.fn() })),
  makeRetraversalAdapter: jest.fn(() => ({ computeNodeConfidence: jest.fn() })),
  makeLlmGateEvaluator: jest.fn(() => null),
}));

import { getSession } from '../../services/resolution/session-store';
import { resolutionMutations } from '../../resolvers/mutations/resolution';
import { resolveAndPersistAll } from '../../resolvers/mutations/multi-pathway-resolution';
import { makeEvaluationTemporalContext } from '../../services/resolution/temporal/evaluation-context';
import {
  NodeStatus,
  OverrideAction,
  createEmptyDependencyMap,
} from '../../services/resolution/types';
import type { PathwayTemporalDefaults } from '../../services/resolution/temporal/cascade';
import type { MatchedPathway } from '../../services/resolution/types';
import type { PatientContext } from '../../services/confidence/types';

const mockedGetSession = getSession as jest.MockedFunction<typeof getSession>;

const PINNED = '2026-01-15T08:30:00.000Z';
const CLOCK = makeEvaluationTemporalContext({ evaluationAsOf: PINNED, temporalPolicyVersion: 'legacy-v0' });

/**
 * A distinctive defaults object. Identity (`toBe`) is what is asserted, not
 * shape: a site that rebuilt an equal-but-separate object — or handed over the
 * system defaults — would satisfy `toEqual` and still be the exact divergence
 * P1-10 describes.
 */
function defaults(): PathwayTemporalDefaults {
  return { horizons: { labs: 'YEAR' }, statuses: { conditions: 'any' } };
}

function rctxWith(temporalDefaults: PathwayTemporalDefaults) {
  return {
    graphContext: {
      allNodes: [
        {
          id: 's-1',
          nodeIdentifier: 's-1',
          nodeType: 'Step',
          properties: { title: 's-1' },
        },
      ],
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
    temporalDefaults,
  };
}

function traversalResult() {
  return {
    resolutionState: new Map(),
    dependencyMap: createEmptyDependencyMap(),
    pendingQuestions: [],
    redFlags: [],
    totalNodesEvaluated: 1,
    traversalDurationMs: 1,
    isDegraded: false,
  };
}

function sessionWith(overrides: Record<string, unknown> = {}) {
  return {
    id: 'session-1',
    pathwayId: 'pathway-1',
    pathwayVersion: '1',
    patientId: 'pt',
    providerId: 'pr',
    status: 'ACTIVE',
    resolutionState: new Map([
      ['node-1', { nodeId: 'node-1', nodeType: 'Step', title: 'n1', status: NodeStatus.INCLUDED, confidence: 1, confidenceBreakdown: [], depth: 1 }],
      ['node-2', { nodeId: 'node-2', nodeType: 'Step', title: 'n2', status: NodeStatus.INCLUDED, confidence: 1, confidenceBreakdown: [], depth: 2 }],
    ]),
    dependencyMap: {
      influencedBy: new Map(),
      influences: new Map([['node-1', new Set(['node-2'])]]),
      gateContextFields: new Map(),
      scorerInputs: new Map(),
    },
    initialPatientContext: { patientId: 'pt', conditionCodes: [], medications: [], labResults: [], allergies: [] },
    additionalContext: {},
    pendingQuestions: [],
    redFlags: [],
    resolutionEvents: [],
    gateAnswers: new Map(),
    totalNodesEvaluated: 2,
    traversalDurationMs: 1,
    ddiWarnings: [],
    temporalContext: CLOCK,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

const poolStub = {
  query: jest.fn().mockResolvedValue({ rows: [{ id: 'pw-1', version: 1, status: 'ACTIVE' }] }),
};
const gqlContext = () =>
  ({ pool: poolStub, redis: {}, userId: 'u-1', userRole: 'PROVIDER' }) as never;

/**
 * The argument position `pathwayDefaults` occupies on both engines: after the
 * confidence adapter, the thresholds and the clock, and before the optional
 * LLM evaluator (TypeScript forbids a required parameter after an optional
 * one, which is why it is fourth rather than appended).
 */
const PATHWAY_DEFAULTS_ARG = 3;

beforeEach(() => {
  jest.clearAllMocks();
  poolStub.query.mockResolvedValue({ rows: [{ id: 'pw-1', version: 1, status: 'ACTIVE' }] });
  mockTraverse.mockResolvedValue(traversalResult());
  mockRetraverse.mockResolvedValue({
    statusChanges: [],
    newPendingQuestions: [],
    newRedFlags: [],
    nodesRecomputed: 0,
    isIncomplete: false,
  });
});

describe('every engine construction site is handed rctx.temporalDefaults (P1-10)', () => {
  it('startResolution — TraversalEngine', async () => {
    const rctx = rctxWith(defaults());
    mockBuildResolutionContext.mockResolvedValue(rctx);
    mockedGetSession.mockResolvedValue(sessionWith() as never);

    await resolutionMutations.startResolution(
      null as never,
      { pathwayId: 'pw-1', patientId: 'pt-1' } as never,
      gqlContext(),
    );

    expect(traversalCtor).toHaveBeenCalledTimes(1);
    expect(traversalCtor.mock.calls[0][PATHWAY_DEFAULTS_ARG]).toBe(rctx.temporalDefaults);
  });

  it('overrideNode — RetraversalEngine', async () => {
    const rctx = rctxWith(defaults());
    mockBuildResolutionContext.mockResolvedValue(rctx);
    mockedGetSession.mockResolvedValue(sessionWith() as never);

    await resolutionMutations.overrideNode(
      undefined,
      { sessionId: 'session-1', nodeId: 'node-1', action: OverrideAction.EXCLUDE, reason: 'r' },
      gqlContext(),
    );

    expect(retraversalCtor).toHaveBeenCalledTimes(1);
    expect(retraversalCtor.mock.calls[0][PATHWAY_DEFAULTS_ARG]).toBe(rctx.temporalDefaults);
  });

  it('answerGateQuestion — RetraversalEngine', async () => {
    const rctx = rctxWith(defaults());
    mockBuildResolutionContext.mockResolvedValue(rctx);
    mockedGetSession.mockResolvedValue(
      sessionWith({
        resolutionState: new Map([
          ['gate-1', { nodeId: 'gate-1', nodeType: 'Gate', title: 'g1', status: NodeStatus.PENDING_QUESTION, confidence: 0, confidenceBreakdown: [], depth: 1 }],
        ]),
      }) as never,
    );

    await resolutionMutations.answerGateQuestion(
      undefined,
      { sessionId: 'session-1', gateId: 'gate-1', answer: { booleanValue: true } },
      gqlContext(),
    );

    expect(retraversalCtor).toHaveBeenCalledTimes(1);
    expect(retraversalCtor.mock.calls[0][PATHWAY_DEFAULTS_ARG]).toBe(rctx.temporalDefaults);
  });

  it('addPatientContext — RetraversalEngine', async () => {
    const rctx = rctxWith(defaults());
    mockBuildResolutionContext.mockResolvedValue(rctx);
    mockedGetSession.mockResolvedValue(
      sessionWith({
        dependencyMap: {
          influencedBy: new Map(),
          influences: new Map(),
          // A gate that read `labs`, so supplying lab results marks it affected
          // and the resolver actually reaches the engine construction.
          gateContextFields: new Map([['gate-1', new Set(['labs'])]]),
          scorerInputs: new Map(),
        },
      }) as never,
    );

    await resolutionMutations.addPatientContext(
      undefined,
      {
        sessionId: 'session-1',
        additionalContext: {
          labResults: [{ code: '718-7', system: 'LOINC', value: 9.1 }],
        },
      },
      gqlContext(),
    );

    expect(retraversalCtor).toHaveBeenCalledTimes(1);
    expect(retraversalCtor.mock.calls[0][PATHWAY_DEFAULTS_ARG]).toBe(rctx.temporalDefaults);
  });

  it('resolveAndPersistAll (multi-pathway) — TraversalEngine', async () => {
    const rctx = rctxWith(defaults());
    mockBuildResolutionContext.mockResolvedValue(rctx);

    const patientContext = {
      patientId: 'pt',
      conditionCodes: [],
      medications: [],
      labResults: [],
      allergies: [],
    } as unknown as PatientContext;

    const matched = {
      pathway: {
        id: 'pw-1',
        logicalId: 'lp-1',
        title: 'PW 1',
        version: '1',
        category: 'c',
        status: 'ACTIVE',
        conditionCodes: [],
      },
      matched: true,
      matchedSets: [],
      mostSpecificMatchedSet: {},
      specificityDepth: 0,
      patientCodesAddressed: [],
      patientCodesUnaddressed: [],
    } as unknown as MatchedPathway;

    await resolveAndPersistAll(
      poolStub as never,
      [matched],
      patientContext,
      'pr',
      CLOCK,
      // `factStore` — assembled once per run by the caller from plan 04 Task 9
      // on. Empty here: CLOCK is `legacy-v0`.
      [],
    );

    expect(traversalCtor).toHaveBeenCalledTimes(1);
    expect(traversalCtor.mock.calls[0][PATHWAY_DEFAULTS_ARG]).toBe(rctx.temporalDefaults);
  });

  it('every site passes the SAME defaults object the preflight sweep resolved against', async () => {
    // The sweep runs off `rctx.temporalDefaults` inside assertEncounterAnchor
    // (kept real via requireActual above). Handing the engine a different
    // object — even an equal one — is the divergence, so identity is the
    // assertion in every case above and is restated here against the one
    // construction site that also runs the sweep on the same request.
    const rctx = rctxWith(defaults());
    mockBuildResolutionContext.mockResolvedValue(rctx);
    mockedGetSession.mockResolvedValue(sessionWith() as never);

    await resolutionMutations.startResolution(
      null as never,
      { pathwayId: 'pw-1', patientId: 'pt-1' } as never,
      gqlContext(),
    );

    const passed = traversalCtor.mock.calls[0][PATHWAY_DEFAULTS_ARG];
    expect(passed).toBe(rctx.temporalDefaults);
    expect(passed).not.toBe(undefined);
    expect(passed).toEqual({ horizons: { labs: 'YEAR' }, statuses: { conditions: 'any' } });
  });
});
