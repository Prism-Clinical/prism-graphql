/**
 * Plan 04 Task 9 — the behavioral proofs that only become possible once the
 * assembler is wired.
 *
 * Everything before this task proved `v1` with unit tests over a hand-built
 * `factStore`, because `deps.factStore` was `[]` in production. Two claims were
 * deferred here explicitly:
 *
 *   1. **The pathway-default cascade, proven behaviorally (moved from Task 3,
 *      P1-16).** At Task 3 the legacy path admitted a 200-day-old lab whatever
 *      the cascade said, so a behavioral test could not fail even with
 *      `pathwayDefaults` dropped entirely — Task 3 proved the plumbing with
 *      constructor spies instead.
 *   2. **The P1-2 flip.** `addPatientContext` must be able to flip a previously
 *      unsatisfied gate. With an empty or stale store it stays unsatisfied.
 *
 * The ENGINES ARE REAL here. Only the database seams are mocked, so the gate
 * decision under test is produced by the same `evaluateGate` a request runs.
 */

jest.mock('../../resolvers/Query', () => ({
  PATHWAY_COLUMNS: 'id, version, status',
  formatSessionForGraphQL: (s: unknown) => s,
  hydrateSignalDefinition: (row: unknown) => row,
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
  makeTraversalAdapter: jest.fn(() => ({
    computeNodeConfidence: jest.fn().mockResolvedValue({
      nodeIdentifier: 'n',
      nodeType: 'Step',
      confidence: 0.95,
      breakdown: [],
      propagationInfluences: [],
      resolutionType: 'AUTO_RESOLVED',
    }),
  })),
  makeRetraversalAdapter: jest.fn(() => ({
    computeNodeConfidence: jest.fn().mockResolvedValue({
      confidence: 0.95,
      breakdown: [],
      resolutionType: 'AUTO_RESOLVED',
    }),
  })),
  makeLlmGateEvaluator: jest.fn(() => null),
}));

import { createSession, getSession } from '../../services/resolution/session-store';
import { resolutionMutations } from '../../resolvers/mutations/resolution';
import { makeGraphContext } from '../fixtures/reference-patient-context';
import {
  DefaultBehavior,
  GateType,
  NodeStatus,
} from '../../services/resolution/types';
import type { NodeResult } from '../../services/resolution/types';
import type { GraphEdge, GraphNode } from '../../services/confidence/types';
import type { PathwayTemporalDefaults } from '../../services/resolution/temporal/cascade';

const mockedCreateSession = createSession as jest.MockedFunction<typeof createSession>;
const mockedGetSession = getSession as jest.MockedFunction<typeof getSession>;

const PINNED = '2026-01-15T08:30:00.000Z';
/** 200 days before PINNED — inside YEAR (365d), outside v1's QUARTER (90d). */
const TWO_HUNDRED_DAYS_AGO = '2025-06-29';
/** 10 days before PINNED — inside every horizon under test. */
const RECENT = '2026-01-05';

function node(id: string, nodeType: string, properties: Record<string, unknown> = {}): GraphNode {
  return { id, nodeIdentifier: id, nodeType, properties: { title: id, ...properties } } as GraphNode;
}
function edge(sourceId: string, targetId: string): GraphEdge {
  return {
    id: `${sourceId}->${targetId}`,
    edgeType: 'HAS_CHILD',
    sourceId,
    targetId,
    properties: {},
  } as GraphEdge;
}

/**
 * A scalar lab gate. `default_behavior: skip` is load-bearing: without it an
 * unsatisfied gate falls through to "Default traverse — include anyway" and the
 * node is INCLUDED whatever the horizon decided, so the test would pass without
 * proving anything.
 */
const NODES = [
  node('root', 'Pathway'),
  node('gate-1', 'Gate', {
    gate_type: GateType.PATIENT_ATTRIBUTE,
    default_behavior: DefaultBehavior.SKIP,
    condition: { field: 'labs', operator: 'greater_than', value: '718-7', threshold: 9 },
  }),
  node('step-1', 'Step'),
];
const EDGES = [edge('root', 'gate-1'), edge('gate-1', 'step-1')];

function rctx(temporalDefaults: PathwayTemporalDefaults) {
  const gc = makeGraphContext(NODES, EDGES);
  return {
    graphContext: gc,
    edges: EDGES,
    signals: [],
    thresholds: { autoResolveThreshold: 0.85, suggestThreshold: 0.6 },
    confidenceEngine: {},
    codeMap: new Map(),
    temporalDefaults,
  };
}

const poolStub = {
  query: jest.fn().mockResolvedValue({ rows: [{ id: 'pw-1', version: 1, status: 'ACTIVE' }] }),
};

const adminContext = (temporalPolicyVersion?: string) =>
  ({
    pool: poolStub,
    redis: {},
    userId: 'u-1',
    userRole: 'ADMIN',
    ...(temporalPolicyVersion !== undefined ? { temporalPolicyVersion } : {}),
  }) as never;

/** The resolutionState the resolver actually persisted. */
function persistedState(): Map<string, NodeResult> {
  const arg = mockedCreateSession.mock.calls[0][1] as unknown as {
    resolutionState: Map<string, NodeResult>;
  };
  return arg.resolutionState;
}

function persistedArg() {
  return mockedCreateSession.mock.calls[0][1] as unknown as Record<string, unknown>;
}

async function start(
  labResults: Array<Record<string, unknown>>,
  temporalDefaults: PathwayTemporalDefaults,
  version?: string,
) {
  mockBuildResolutionContext.mockResolvedValue(rctx(temporalDefaults));
  await resolutionMutations.startResolution(
    null as never,
    {
      pathwayId: 'pw-1',
      patientId: 'pt-1',
      resolutionMode: 'SYNTHETIC',
      evaluationAsOf: PINNED,
      patientContext: {
        patientId: 'pt-1',
        conditionCodes: [],
        medications: [],
        allergies: [],
        labResults,
      },
    } as never,
    adminContext(version),
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  poolStub.query.mockResolvedValue({ rows: [{ id: 'pw-1', version: 1, status: 'ACTIVE' }] });
  mockedCreateSession.mockResolvedValue('session-1');
  // startResolution re-reads the session it just created before formatting.
  mockedGetSession.mockResolvedValue({ id: 'session-1' } as never);
});

// ─────────────────────────────────────────────────────────────────────

describe('the pathway-default cascade, proven behaviorally (moved from Task 3, P1-16)', () => {
  const OLD_LAB = [
    { code: '718-7', system: 'LOINC', value: 12, unit: 'g/dL', date: TWO_HUNDRED_DAYS_AGO },
  ];

  it('admits a 200-day-old lab when the pathway default is YEAR and v1 says QUARTER', async () => {
    await start(OLD_LAB, { horizons: { labs: 'YEAR' } }, 'v1');

    const gate = persistedState().get('gate-1')!;
    expect(gate.status).toBe(NodeStatus.INCLUDED);
    // And the subtree the gate guards was traversed, not gated out.
    expect(persistedState().get('step-1')!.status).not.toBe(NodeStatus.GATED_OUT);
  });

  it('excludes the same lab when the pathway sets no default', async () => {
    await start(OLD_LAB, {}, 'v1');

    const gate = persistedState().get('gate-1')!;
    expect(gate.status).toBe(NodeStatus.GATED_OUT);
    // NO_MATCH, not INDETERMINATE: the horizon dropped the only candidate, so
    // the kernel decided rather than refusing to.
    expect(gate.excludeReason).toBe('No numeric value found for labs:718-7');
  });

  it('is a v1-only delta — legacy-v0 admits the old lab with or without the default', async () => {
    // The Task 3 note, pinned: under `legacy-v0` the pathway default is not
    // consulted at all, which is exactly why this test could not live there.
    await start(OLD_LAB, {}, undefined);
    expect(persistedState().get('gate-1')!.status).toBe(NodeStatus.INCLUDED);

    jest.clearAllMocks();
    mockedCreateSession.mockResolvedValue('session-1');
    await start(OLD_LAB, { horizons: { labs: 'YEAR' } }, undefined);
    expect(persistedState().get('gate-1')!.status).toBe(NodeStatus.INCLUDED);
  });

  it('a lab inside v1’s own QUARTER needs no pathway default', async () => {
    await start(
      [{ code: '718-7', system: 'LOINC', value: 12, unit: 'g/dL', date: RECENT }],
      {},
      'v1',
    );
    expect(persistedState().get('gate-1')!.status).toBe(NodeStatus.INCLUDED);
  });
});

// ─────────────────────────────────────────────────────────────────────

describe('addPatientContext changes what a gate decides (the P1-2 flip test)', () => {
  it('re-resolves a previously unsatisfied gate once the new fact arrives', async () => {
    // 1. Start a v1 session with no labs at all — the gate is unsatisfied.
    await start([], {}, 'v1');

    const created = persistedArg();
    const resolutionState = created.resolutionState as Map<string, NodeResult>;
    expect(resolutionState.get('gate-1')!.status).toBe(NodeStatus.GATED_OUT);

    // The traversal must have recorded that this gate reads `labs`, or
    // addPatientContext would never mark it affected and the flip would be
    // vacuous.
    const dependencyMap = created.dependencyMap as {
      gateContextFields: Map<string, Set<string>>;
    };
    expect([...(dependencyMap.gateContextFields.get('gate-1') ?? [])]).toContain('labs');

    mockedGetSession.mockResolvedValue({
      id: 'session-1',
      pathwayId: 'pw-1',
      pathwayVersion: '1',
      patientId: 'pt-1',
      providerId: 'u-1',
      status: 'ACTIVE',
      resolutionState,
      dependencyMap,
      initialPatientContext: created.initialPatientContext,
      additionalContext: {},
      pendingQuestions: [],
      redFlags: [],
      resolutionEvents: [],
      gateAnswers: new Map(),
      totalNodesEvaluated: resolutionState.size,
      traversalDurationMs: 1,
      ddiWarnings: [],
      temporalContext: created.temporalContext,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as never);

    // 2. Supply the matching lab.
    await resolutionMutations.addPatientContext(
      undefined,
      {
        sessionId: 'session-1',
        additionalContext: {
          labResults: [
            { code: '718-7', system: 'LOINC', value: 12, unit: 'g/dL', date: RECENT },
          ],
        },
      },
      adminContext('v1'),
    );

    // 3. The gate is now satisfied. With an empty or stale store it would still
    //    be GATED_OUT — that is the bug this proves absent.
    expect(resolutionState.get('gate-1')!.status).toBe(NodeStatus.INCLUDED);
  });

  it('a lab outside the v1 horizon does NOT flip the gate', async () => {
    // The mirror case: the flip must come from the horizon-governed kernel, not
    // from "any fact at all makes the gate fire".
    await start([], {}, 'v1');

    const created = persistedArg();
    const resolutionState = created.resolutionState as Map<string, NodeResult>;

    mockedGetSession.mockResolvedValue({
      id: 'session-1',
      pathwayId: 'pw-1',
      pathwayVersion: '1',
      patientId: 'pt-1',
      providerId: 'u-1',
      status: 'ACTIVE',
      resolutionState,
      dependencyMap: created.dependencyMap,
      initialPatientContext: created.initialPatientContext,
      additionalContext: {},
      pendingQuestions: [],
      redFlags: [],
      resolutionEvents: [],
      gateAnswers: new Map(),
      totalNodesEvaluated: resolutionState.size,
      traversalDurationMs: 1,
      ddiWarnings: [],
      temporalContext: created.temporalContext,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as never);

    await resolutionMutations.addPatientContext(
      undefined,
      {
        sessionId: 'session-1',
        additionalContext: {
          labResults: [
            { code: '718-7', system: 'LOINC', value: 12, unit: 'g/dL', date: TWO_HUNDRED_DAYS_AGO },
          ],
        },
      },
      adminContext('v1'),
    );

    expect(resolutionState.get('gate-1')!.status).toBe(NodeStatus.GATED_OUT);
  });
});
