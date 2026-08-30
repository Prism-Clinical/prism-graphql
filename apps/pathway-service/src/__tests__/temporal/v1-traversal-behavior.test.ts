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
 *      The flip test also pins a **known, unfixed defect**: the flip reaches
 *      the gate row and stops there, leaving the guarded subtree GATED_OUT and
 *      the gate's own `excludeReason` stale. See the block comment on it, and
 *      `docs/superpowers/plans/2026-08-12-gate-subtree-retraversal.md`.
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
    //
    // legacy-v0 is passed EXPLICITLY, not left undefined. It used to arrive via
    // DEFAULT_TEMPORAL_POLICY_VERSION; once that default moved to v1, omitting
    // it ran the comparison arm on the kernel too and the "v1-only delta" this
    // test names stopped being a delta at all.
    await start(OLD_LAB, {}, 'legacy-v0');
    expect(persistedState().get('gate-1')!.status).toBe(NodeStatus.INCLUDED);

    jest.clearAllMocks();
    mockedCreateSession.mockResolvedValue('session-1');
    await start(OLD_LAB, { horizons: { labs: 'YEAR' } }, 'legacy-v0');
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
      influences: Map<string, Set<string>>;
    };
    expect([...(dependencyMap.gateContextFields.get('gate-1') ?? [])]).toContain('labs');

    // The subtree the gate guards went out WITH it, carrying a reason derived
    // from the gate's. This is the state the flip below fails to undo.
    expect(resolutionState.get('step-1')!.status).toBe(NodeStatus.GATED_OUT);

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

    // ─── PINNED KNOWN DEFECT — the flip stops at the gate ──────────────
    //
    // *** These four assertions pin a defect that is NOT fixed here. When it
    // is fixed they INVERT — they are written to be flipped, not rewritten.
    // Follow-up: docs/superpowers/plans/2026-08-12-gate-subtree-retraversal.md
    //
    // As written above, this test asserted only that the gate became satisfied
    // and stopped, so it read as proof that a mid-session fact re-resolves the
    // pathway. It does not.
    //
    // `dependencyMap.influences` is the map retraversal walks to reach a
    // changed node's dependents (retraversal-engine.ts:266, and again at
    // resolution.ts:355 for `overrideNode`). It IS populated — but only by
    // `recordInfluence`, from exactly two call sites: a gate's explicit
    // `depends_on` entries (traversal-engine.ts:347) and a DecisionPoint's
    // branch targets (traversal-engine.ts:537). It NEVER records the edge that
    // matters here — a gate to the HAS_CHILD subtree it gates out. That
    // relationship exists only in the graph, never in the dependency map, so
    // retraversal has no way to reach it. The flip updates the gate ROW and
    // nothing else:
    //
    //   - the guarded subtree stays GATED_OUT, still carrying a reason derived
    //     from a gate decision that no longer holds; and
    //   - the gate keeps the `excludeReason` and `confidence` from when it was
    //     out, because `retraverse` assigns `existing.status` without clearing
    //     either (retraversal-engine.ts:258).
    //
    // PRE-EXISTING, not introduced by plan 04: the gate→subtree edge has never
    // been recorded, so `overrideNode`'s cascade has never re-resolved a gated
    // subtree either. Plan 04 only made the flip REACHABLE under `v1`, which is
    // what surfaced it. It does not block merging plan 04 — nothing routes to
    // `v1` — but it does block the `v1` rollout flip, under which
    // `addPatientContext` is the mutation most likely to flip a gate
    // mid-session.
    //
    // This graph is HAS_CHILD-only with no `depends_on` and no DecisionPoint,
    // so neither `recordInfluence` call site fires and the map is empty. That
    // is the pin: the ONE relationship the flip needs is the one never present.
    expect(dependencyMap.influences.size).toBe(0);
    expect(resolutionState.get('step-1')!.status).toBe(NodeStatus.GATED_OUT);
    expect(resolutionState.get('step-1')!.excludeReason).toBe(
      'Gated out by gate-1: No numeric value found for labs:718-7',
    );
    expect(resolutionState.get('gate-1')!.excludeReason).toBe(
      'No numeric value found for labs:718-7',
    );
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
