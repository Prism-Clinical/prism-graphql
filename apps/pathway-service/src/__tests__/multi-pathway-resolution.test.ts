/**
 * Phase 3 commit 4 — orchestration + conflict-resolution tests for the
 * persistent multi-pathway mutations.
 *
 * Domain logic (merge, projection, lattice collapse, applyResolution) is
 * covered in unit tests; these tests focus on:
 *   - the orchestrator threads matched → collapse → traverse → merge correctly,
 *   - per-pathway sessions get persisted,
 *   - the multi-pathway session row reflects the merge,
 *   - resolveConflict mutates the merged plan according to the choice kind,
 *   - generateMergedCarePlan blocks while conflicts are pending and succeeds
 *     when they're not.
 */

import {
  ConflictResolution,
  MergedCarePlan,
} from '../services/resolution/care-plan-merge';
import { MultiPathwayResolutionSession } from '../services/resolution/multi-pathway-session-store';

// ── Mocks (must precede import of unit under test) ──────────────────

jest.mock('../services/resolution/session-store', () => ({
  getMatchedPathways: jest.fn(),
  createSession: jest.fn(),
}));

jest.mock('../services/resolution/lattice-collapse', () => ({
  collapseLattice: jest.fn(),
}));

jest.mock('../resolvers/helpers/resolution-context', () => ({
  buildResolutionContext: jest.fn(),
  makeTraversalAdapter: jest.fn(() => ({})),
}));

jest.mock('../services/resolution/traversal-engine', () => ({
  TraversalEngine: jest.fn().mockImplementation(() => ({ traverse: jest.fn() })),
}));

jest.mock('../services/resolution/multi-pathway-session-store', () => ({
  createMultiPathwaySession: jest.fn(),
  getMultiPathwaySession: jest.fn(),
  getPatientMultiPathwaySessions: jest.fn(),
  markMultiPathwaySessionStatus: jest.fn(),
  updateMergedPlanAndResolutions: jest.fn(),
}));

// Phase 4: DDI passes are no-ops by default in these orchestration tests.
// Phase 4 commit 5 has a dedicated test file (ddi-multi-pathway.test.ts) that
// drives findings into the orchestrator.
jest.mock('../services/medications/ddi-pass', () => ({
  runPatientContextDdi: jest.fn().mockResolvedValue({
    findings: [],
    suppressedRecommendationIds: new Set(),
  }),
  runCrossRecommendationDdi: jest.fn().mockResolvedValue({
    findings: [],
    suppressedRecommendationIds: new Set(),
  }),
}));

import {
  multiPathwayResolutionMutations,
  applyResolution,
  formatMergedForGraphQL,
} from '../resolvers/mutations/multi-pathway-resolution';
import {
  getMatchedPathways,
  createSession,
} from '../services/resolution/session-store';
import { collapseLattice } from '../services/resolution/lattice-collapse';
import { buildResolutionContext } from '../resolvers/helpers/resolution-context';
import { TraversalEngine } from '../services/resolution/traversal-engine';
import {
  createMultiPathwaySession,
  getMultiPathwaySession,
  markMultiPathwaySessionStatus,
  updateMergedPlanAndResolutions,
} from '../services/resolution/multi-pathway-session-store';
import { NodeStatus } from '../services/resolution/types';

// ── Helpers ─────────────────────────────────────────────────────────

function fakeContext() {
  return {
    pool: { connect: jest.fn() } as unknown,
    redis: {},
    userId: 'provider-1',
    userRole: 'PROVIDER',
  } as never;
}

function fakeMatched(id: string, title = `P-${id}`) {
  return {
    pathway: {
      id,
      logicalId: `lp-${id}`,
      title,
      version: '1.0',
      category: 'CHRONIC_DISEASE',
      status: 'ACTIVE',
      conditionCodes: ['I10'],
    },
    matched: true,
    matchedSets: [],
    mostSpecificMatchedSet: { setId: `s-${id}`, scope: 'EXACT', members: [], memberCount: 0 } as never,
    specificityDepth: 1,
    patientCodesAddressed: [],
    patientCodesUnaddressed: [],
    matchScore: 1,
    matchedConditionCodes: [],
  };
}

function fakeRctx(allNodesLength = 3) {
  return {
    graphContext: { allNodes: new Array(allNodesLength).fill({}) },
    thresholds: { autoResolveThreshold: 0.85, suggestThreshold: 0.5 },
  };
}

function makeResolutionStateWith(nodes: Array<{
  nodeId: string;
  nodeType: string;
  properties: Record<string, unknown>;
}>) {
  const state = new Map();
  for (const n of nodes) {
    state.set(n.nodeId, {
      nodeId: n.nodeId,
      nodeType: n.nodeType,
      title: n.nodeId,
      status: NodeStatus.INCLUDED,
      confidence: 1,
      confidenceBreakdown: [],
      depth: 1,
      properties: n.properties,
    });
  }
  return state;
}

function setupTraverseSeq(states: Array<Map<string, unknown>>) {
  let idx = 0;
  (TraversalEngine as unknown as jest.Mock).mockImplementation(() => ({
    traverse: jest.fn().mockImplementation(() => {
      const s = states[Math.min(idx, states.length - 1)];
      idx++;
      return Promise.resolve({
        resolutionState: s,
        dependencyMap: { influencedBy: new Map(), influences: new Map(), gateContextFields: new Map(), scorerInputs: new Map() },
        pendingQuestions: [],
        redFlags: [],
        totalNodesEvaluated: s.size,
        traversalDurationMs: 1,
        isDegraded: false,
      });
    }),
  }));
}

function emptyMergedPlan(): MergedCarePlan {
  return {
    sourcePathwayIds: [],
    medications: [],
    labs: [],
    procedures: [],
    schedules: [],
    qualityMetrics: [],
    suppressed: [],
    conflicts: [],
  };
}

function fakeStoredSession(overrides: Partial<MultiPathwayResolutionSession> = {}): MultiPathwayResolutionSession {
  return {
    id: 'sess-1',
    patientId: 'pat-1',
    providerId: 'provider-1',
    status: 'ACTIVE',
    initialPatientContext: {},
    contributingSessionIds: [],
    contributingPathwayIds: [],
    mergedPlan: emptyMergedPlan(),
    conflictResolutions: {},
    carePlanId: null,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
});

// ── startMultiPathwayResolution ─────────────────────────────────────

describe('startMultiPathwayResolution', () => {
  it('persists an empty session when no pathways match', async () => {
    (getMatchedPathways as jest.Mock).mockResolvedValue([]);
    (createMultiPathwaySession as jest.Mock).mockResolvedValue('mp-1');
    (getMultiPathwaySession as jest.Mock).mockResolvedValue(fakeStoredSession({ id: 'mp-1' }));

    const result = await multiPathwayResolutionMutations.startMultiPathwayResolution(
      {},
      { patientId: 'pat-1' },
      fakeContext(),
    );

    expect(result.id).toBe('mp-1');
    expect(result.contributingPathwayIds).toEqual([]);
    expect(collapseLattice).not.toHaveBeenCalled();
    expect(createMultiPathwaySession).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        contributingPathwayIds: [],
        contributingSessionIds: [],
      }),
    );
  });

  it('persists per-pathway sessions and a merged session when pathways match', async () => {
    const a = fakeMatched('a', 'AF');
    const b = fakeMatched('b', 'HFrEF');
    (getMatchedPathways as jest.Mock).mockResolvedValue([a, b]);
    (collapseLattice as jest.Mock).mockResolvedValue([a, b]);
    (buildResolutionContext as jest.Mock).mockResolvedValue(fakeRctx());
    (createSession as jest.Mock)
      .mockResolvedValueOnce('per-a')
      .mockResolvedValueOnce('per-b');
    (createMultiPathwaySession as jest.Mock).mockResolvedValue('mp-99');
    (getMultiPathwaySession as jest.Mock).mockResolvedValue(
      fakeStoredSession({
        id: 'mp-99',
        contributingSessionIds: ['per-a', 'per-b'],
        contributingPathwayIds: ['a', 'b'],
      }),
    );

    setupTraverseSeq([
      makeResolutionStateWith([
        { nodeId: 'med-a', nodeType: 'Medication', properties: { name: 'Metoprolol', role: 'first_line' } },
      ]),
      makeResolutionStateWith([
        { nodeId: 'med-b', nodeType: 'Medication', properties: { name: 'Carvedilol', role: 'first_line' } },
      ]),
    ]);

    const result = await multiPathwayResolutionMutations.startMultiPathwayResolution(
      {},
      { patientId: 'pat-1' },
      fakeContext(),
    );

    expect(createSession).toHaveBeenCalledTimes(2);
    expect(createMultiPathwaySession).toHaveBeenCalledTimes(1);
    const persisted = (createMultiPathwaySession as jest.Mock).mock.calls[0][1];
    expect(persisted.contributingSessionIds).toEqual(['per-a', 'per-b']);
    expect(persisted.contributingPathwayIds).toEqual(['a', 'b']);
    expect(result.id).toBe('mp-99');
  });

  it('skips a pathway whose graph is empty (no per-pathway session row created)', async () => {
    const a = fakeMatched('a');
    const b = fakeMatched('b');
    (getMatchedPathways as jest.Mock).mockResolvedValue([a, b]);
    (collapseLattice as jest.Mock).mockResolvedValue([a, b]);
    (buildResolutionContext as jest.Mock)
      .mockResolvedValueOnce(fakeRctx(0))   // a empty
      .mockResolvedValueOnce(fakeRctx(3));  // b ok
    (createSession as jest.Mock).mockResolvedValueOnce('per-b');
    (createMultiPathwaySession as jest.Mock).mockResolvedValue('mp-1');
    (getMultiPathwaySession as jest.Mock).mockResolvedValue(fakeStoredSession({ id: 'mp-1' }));

    setupTraverseSeq([
      makeResolutionStateWith([
        { nodeId: 'm', nodeType: 'Medication', properties: { name: 'Lisinopril', role: 'first_line' } },
      ]),
    ]);

    await multiPathwayResolutionMutations.startMultiPathwayResolution(
      {},
      { patientId: 'pat-1' },
      fakeContext(),
    );

    expect(createSession).toHaveBeenCalledTimes(1);
    const persisted = (createMultiPathwaySession as jest.Mock).mock.calls[0][1];
    expect(persisted.contributingPathwayIds).toEqual(['b']);
  });
});

// ── resolveConflict ─────────────────────────────────────────────────

describe('resolveConflict', () => {
  function sessionWithBetaBlockerConflict(): MultiPathwayResolutionSession {
    return fakeStoredSession({
      mergedPlan: {
        ...emptyMergedPlan(),
        conflicts: [{
          conflictId: 'first_line_bb',
          type: 'medication',
          clinicalRole: 'first_line_bb',
          candidates: [
            {
              recommendation: { name: 'Metoprolol', role: 'first_line', clinicalRole: 'first_line_bb', sourcePathwayId: 'a' },
              sourcePathwayId: 'a',
              sourcePathwayTitle: 'AF',
            },
            {
              recommendation: { name: 'Carvedilol', role: 'first_line', clinicalRole: 'first_line_bb', sourcePathwayId: 'b' },
              sourcePathwayId: 'b',
              sourcePathwayTitle: 'HFrEF',
            },
          ],
          resolution: null,
        }],
      },
    });
  }

  it('CONFIRM_PATHWAY adds the chosen drug as PROVIDER_CONFIRMED and marks the conflict', async () => {
    const session = sessionWithBetaBlockerConflict();
    (getMultiPathwaySession as jest.Mock)
      .mockResolvedValueOnce(session)
      .mockResolvedValueOnce({
        ...session,
        mergedPlan: {
          ...session.mergedPlan,
          medications: [{
            recommendation: session.mergedPlan.conflicts[0].candidates[1].recommendation,
            sourcePathwayIds: ['b'],
            state: 'provider-confirmed',
          }],
          conflicts: session.mergedPlan.conflicts.map((c) => ({
            ...c,
            resolution: { kind: 'CONFIRM_PATHWAY', chosenPathwayId: 'b', resolvedBy: 'provider-1', resolvedAt: 'x' },
          })),
        },
      });

    const result = await multiPathwayResolutionMutations.resolveConflict(
      {},
      {
        sessionId: session.id,
        conflictId: 'first_line_bb',
        choice: { kind: 'CONFIRM_PATHWAY', chosenPathwayId: 'b' },
      },
      fakeContext(),
    );

    expect(updateMergedPlanAndResolutions).toHaveBeenCalledTimes(1);
    const [_, __, updatedPlan, updatedResolutions] =
      (updateMergedPlanAndResolutions as jest.Mock).mock.calls[0];
    expect(updatedPlan.medications).toHaveLength(1);
    expect(updatedPlan.medications[0].recommendation.name).toBe('Carvedilol');
    expect(updatedPlan.medications[0].state).toBe('provider-confirmed');
    expect(updatedResolutions['first_line_bb'].kind).toBe('CONFIRM_PATHWAY');
    expect(result.mergedPlan.conflicts[0].resolution).not.toBeNull();
  });

  it('rejects CONFIRM_PATHWAY when chosenPathwayId is not a candidate', async () => {
    (getMultiPathwaySession as jest.Mock).mockResolvedValueOnce(sessionWithBetaBlockerConflict());

    await expect(
      multiPathwayResolutionMutations.resolveConflict(
        {},
        {
          sessionId: 'sess-1',
          conflictId: 'first_line_bb',
          choice: { kind: 'CONFIRM_PATHWAY', chosenPathwayId: 'pathway-not-in-candidates' },
        },
        fakeContext(),
      ),
    ).rejects.toThrow(/not among this conflict/);
    expect(updateMergedPlanAndResolutions).not.toHaveBeenCalled();
  });

  it('ACCEPT_BOTH adds both candidates as auto-included recommendations', async () => {
    (getMultiPathwaySession as jest.Mock)
      .mockResolvedValueOnce(sessionWithBetaBlockerConflict())
      .mockResolvedValueOnce(sessionWithBetaBlockerConflict()); // refresh after update

    await multiPathwayResolutionMutations.resolveConflict(
      {},
      { sessionId: 'sess-1', conflictId: 'first_line_bb', choice: { kind: 'ACCEPT_BOTH' } },
      fakeContext(),
    );

    const [_, __, updatedPlan] = (updateMergedPlanAndResolutions as jest.Mock).mock.calls[0];
    expect(updatedPlan.medications).toHaveLength(2);
    expect(updatedPlan.medications.map((m: { recommendation: { name: string } }) => m.recommendation.name).sort()).toEqual(['Carvedilol', 'Metoprolol']);
  });

  it('REJECT_BOTH leaves medications empty, marks conflict resolved', async () => {
    (getMultiPathwaySession as jest.Mock)
      .mockResolvedValueOnce(sessionWithBetaBlockerConflict())
      .mockResolvedValueOnce(sessionWithBetaBlockerConflict());

    await multiPathwayResolutionMutations.resolveConflict(
      {},
      { sessionId: 'sess-1', conflictId: 'first_line_bb', choice: { kind: 'REJECT_BOTH', reason: 'patient prefers no beta-blocker' } },
      fakeContext(),
    );

    const [_, __, updatedPlan, resolutions] = (updateMergedPlanAndResolutions as jest.Mock).mock.calls[0];
    expect(updatedPlan.medications).toEqual([]);
    expect(resolutions['first_line_bb'].kind).toBe('REJECT_BOTH');
    expect(resolutions['first_line_bb'].reason).toBe('patient prefers no beta-blocker');
  });

  it('CUSTOM_OVERRIDE attaches a write-in medication and marks state PROVIDER_OVERRIDE', async () => {
    (getMultiPathwaySession as jest.Mock)
      .mockResolvedValueOnce(sessionWithBetaBlockerConflict())
      .mockResolvedValueOnce(sessionWithBetaBlockerConflict());

    await multiPathwayResolutionMutations.resolveConflict(
      {},
      {
        sessionId: 'sess-1',
        conflictId: 'first_line_bb',
        choice: {
          kind: 'CUSTOM_OVERRIDE',
          customMedication: { name: 'Bisoprolol', dose: '5 mg', frequency: 'daily' },
        },
      },
      fakeContext(),
    );

    const [_, __, updatedPlan] = (updateMergedPlanAndResolutions as jest.Mock).mock.calls[0];
    expect(updatedPlan.medications).toHaveLength(1);
    expect(updatedPlan.medications[0].recommendation.name).toBe('Bisoprolol');
    expect(updatedPlan.medications[0].state).toBe('provider-override');
  });

  it('rejects when conflictId does not exist in the session', async () => {
    (getMultiPathwaySession as jest.Mock).mockResolvedValueOnce(sessionWithBetaBlockerConflict());

    await expect(
      multiPathwayResolutionMutations.resolveConflict(
        {},
        { sessionId: 'sess-1', conflictId: 'nope', choice: { kind: 'ACCEPT_BOTH' } },
        fakeContext(),
      ),
    ).rejects.toThrow(/Conflict "nope" not found/);
  });

  it('rejects when session is not ACTIVE', async () => {
    (getMultiPathwaySession as jest.Mock).mockResolvedValueOnce(
      fakeStoredSession({ status: 'COMPLETED' }),
    );
    await expect(
      multiPathwayResolutionMutations.resolveConflict(
        {},
        { sessionId: 'sess-1', conflictId: 'whatever', choice: { kind: 'ACCEPT_BOTH' } },
        fakeContext(),
      ),
    ).rejects.toThrow(/status "COMPLETED"/);
  });
});

// ── generateMergedCarePlan ──────────────────────────────────────────

describe('generateMergedCarePlan', () => {
  it('blocks when there are unresolved conflicts', async () => {
    (getMultiPathwaySession as jest.Mock).mockResolvedValueOnce(
      fakeStoredSession({
        mergedPlan: {
          ...emptyMergedPlan(),
          conflicts: [{
            conflictId: 'first_line_bb',
            type: 'medication',
            clinicalRole: 'first_line_bb',
            candidates: [],
            resolution: null,
          }],
        },
      }),
    );

    const result = await multiPathwayResolutionMutations.generateMergedCarePlan(
      {},
      { sessionId: 'sess-1' },
      fakeContext(),
    );

    expect(result.success).toBe(false);
    expect(result.blockers.length).toBeGreaterThan(0);
    expect(markMultiPathwaySessionStatus).not.toHaveBeenCalled();
  });

  it('blocks when the merged plan has no recommendations', async () => {
    (getMultiPathwaySession as jest.Mock).mockResolvedValueOnce(fakeStoredSession());
    const result = await multiPathwayResolutionMutations.generateMergedCarePlan(
      {},
      { sessionId: 'sess-1' },
      fakeContext(),
    );
    expect(result.success).toBe(false);
    expect(result.blockers.some((b) => b.description.includes('empty'))).toBe(true);
  });
});

// ── abandonMultiPathwaySession ──────────────────────────────────────

describe('abandonMultiPathwaySession', () => {
  it('marks the session ABANDONED', async () => {
    (getMultiPathwaySession as jest.Mock)
      .mockResolvedValueOnce(fakeStoredSession())
      .mockResolvedValueOnce(fakeStoredSession({ status: 'ABANDONED' }));

    const result = await multiPathwayResolutionMutations.abandonMultiPathwaySession(
      {},
      { sessionId: 'sess-1' },
      fakeContext(),
    );

    expect(markMultiPathwaySessionStatus).toHaveBeenCalledWith(expect.anything(), 'sess-1', 'ABANDONED');
    expect(result.status).toBe('ABANDONED');
  });
});

// ── applyResolution (pure function tested without DB) ───────────────

describe('applyResolution — pure conflict application', () => {
  function planWithConflict(): MergedCarePlan {
    return {
      ...emptyMergedPlan(),
      conflicts: [{
        conflictId: 'role_x',
        type: 'medication',
        clinicalRole: 'role_x',
        candidates: [
          {
            recommendation: { name: 'A', role: 'first_line', clinicalRole: 'role_x', sourcePathwayId: 'p1' },
            sourcePathwayId: 'p1',
            sourcePathwayTitle: 'P1',
          },
          {
            recommendation: { name: 'B', role: 'first_line', clinicalRole: 'role_x', sourcePathwayId: 'p2' },
            sourcePathwayId: 'p2',
            sourcePathwayTitle: 'P2',
          },
        ],
        resolution: null,
      }],
    };
  }

  const meta = { resolvedBy: 'u', resolvedAt: 't' };

  it('idempotent shape — only the targeted conflict is mutated', () => {
    const plan = planWithConflict();
    plan.conflicts.push({
      conflictId: 'role_y',
      type: 'medication',
      clinicalRole: 'role_y',
      candidates: [],
      resolution: null,
    });
    const r: ConflictResolution = { kind: 'REJECT_BOTH', ...meta };
    const updated = applyResolution(plan, plan.conflicts[0], r);
    expect(updated.conflicts[0].resolution).not.toBeNull();
    expect(updated.conflicts[1].resolution).toBeNull();
  });

  it('CONFIRM_PATHWAY surfaces only the chosen candidate', () => {
    const plan = planWithConflict();
    const r: ConflictResolution = { kind: 'CONFIRM_PATHWAY', chosenPathwayId: 'p1', ...meta };
    const updated = applyResolution(plan, plan.conflicts[0], r);
    expect(updated.medications.map((m) => m.recommendation.name)).toEqual(['A']);
  });
});

// ── Formatter ───────────────────────────────────────────────────────

describe('formatMergedForGraphQL — conflict formatting', () => {
  it('formats a conflict with no resolution as resolution=null', () => {
    const internal: MergedCarePlan = {
      ...emptyMergedPlan(),
      conflicts: [{
        conflictId: 'role_x',
        type: 'medication',
        clinicalRole: 'role_x',
        candidates: [
          {
            recommendation: { name: 'A', role: 'first_line', sourcePathwayId: 'p1' },
            sourcePathwayId: 'p1',
            sourcePathwayTitle: 'P1',
          },
        ],
        resolution: null,
      }],
    };
    const out = formatMergedForGraphQL(internal);
    expect(out.conflicts[0].conflictId).toBe('role_x');
    expect(out.conflicts[0].type).toBe('MEDICATION');
    expect(out.conflicts[0].resolution).toBeNull();
  });

  it('maps state strings to GraphQL enum names', () => {
    const internal: MergedCarePlan = {
      ...emptyMergedPlan(),
      medications: [
        { recommendation: { name: 'A', role: 'first_line', sourcePathwayId: 'p1' }, sourcePathwayIds: ['p1'], state: 'auto-included' },
        { recommendation: { name: 'B', role: 'first_line', sourcePathwayId: 'p2' }, sourcePathwayIds: ['p2'], state: 'provider-confirmed' },
        { recommendation: { name: 'C', role: 'first_line', sourcePathwayId: 'p3' }, sourcePathwayIds: ['p3'], state: 'provider-override' },
      ],
    };
    const out = formatMergedForGraphQL(internal);
    expect(out.medications.map((m) => m.state)).toEqual(['AUTO_INCLUDED', 'PROVIDER_CONFIRMED', 'PROVIDER_OVERRIDE']);
  });
});
