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
  ResolvedCarePlan,
  ResolvedMedication,
  mergeResolvedCarePlans,
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

// Spreads the real module so only the clock factory is controllable — the
// version guard, resolveHorizon and TemporalContextError must stay genuine.
jest.mock('../services/resolution/temporal/evaluation-context', () => {
  const actual = jest.requireActual('../services/resolution/temporal/evaluation-context');
  return {
    ...actual,
    makeEvaluationTemporalContext: jest.fn(actual.makeEvaluationTemporalContext),
  };
});

jest.mock('../resolvers/helpers/resolution-context', () => ({
  buildResolutionContext: jest.fn(),
  makeTraversalAdapter: jest.fn(() => ({})),
  // Was missing: resolveAndPersistAll calls this, and a factory mock replaces
  // the whole module, so its absence made the export undefined and killed two
  // tests with "makeLlmGateEvaluator is not a function".
  makeLlmGateEvaluator: jest.fn(() => null),
  // Same reason: resolveAndPersistAll's preflight calls this on every run.
  assertEncounterAnchor: jest.fn(),
  // Same reason again: both start mutations read the server-owned policy
  // version through this from plan 04 Task 9 on. Kept REAL — a `jest.fn()`
  // returning undefined would hand `makeEvaluationTemporalContext` an undefined
  // version and silently re-enable the legacy default the selector controls.
  resolveTemporalPolicyVersion: jest.requireActual(
    '../resolvers/helpers/resolution-context',
  ).resolveTemporalPolicyVersion,
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
  replayConflictResolutions,
} from '../resolvers/mutations/multi-pathway-resolution';
import {
  getMatchedPathways,
  createSession,
} from '../services/resolution/session-store';
import { collapseLattice } from '../services/resolution/lattice-collapse';
import {
  buildResolutionContext,
  assertEncounterAnchor,
  makeLlmGateEvaluator,
} from '../resolvers/helpers/resolution-context';
import { TraversalEngine } from '../services/resolution/traversal-engine';
import { makeEvaluationTemporalContext } from '../services/resolution/temporal/evaluation-context';
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

  it('stamps one clock instance across the parent, every child, and every engine', async () => {
    const a = fakeMatched('a', 'AF');
    const b = fakeMatched('b', 'HFrEF');
    (getMatchedPathways as jest.Mock).mockResolvedValue([a, b]);
    (collapseLattice as jest.Mock).mockResolvedValue([a, b]);
    (buildResolutionContext as jest.Mock).mockResolvedValue(fakeRctx());
    (createSession as jest.Mock).mockResolvedValueOnce('per-a').mockResolvedValueOnce('per-b');
    (createMultiPathwaySession as jest.Mock).mockResolvedValue('mp-99');
    (getMultiPathwaySession as jest.Mock).mockResolvedValue(fakeStoredSession({ id: 'mp-99' }));
    setupTraverseSeq([
      makeResolutionStateWith([{ nodeId: 'med-a', nodeType: 'Medication', properties: { name: 'M', role: 'first_line' } }]),
      makeResolutionStateWith([{ nodeId: 'med-b', nodeType: 'Medication', properties: { name: 'C', role: 'first_line' } }]),
    ]);

    await multiPathwayResolutionMutations.startMultiPathwayResolution({}, { patientId: 'pat-1' }, fakeContext());

    const parent = (createMultiPathwaySession as jest.Mock).mock.calls[0][1];
    const children = (createSession as jest.Mock).mock.calls.map((c) => c[1]);

    expect(parent.temporalContext).toBeDefined();
    expect(children.length).toBeGreaterThan(0);

    // `toBe`, NOT `toEqual`. This test exists to prove ONE context object was
    // created and passed down. Two separate makeEvaluationTemporalContext()
    // calls in the same millisecond produce structurally equal objects, so
    // toEqual passes against exactly the bug being guarded against — and it
    // would pass non-deterministically, going green on a fast machine and red
    // on a slow one. Reference equality is the only assertion that means
    // "one clock".
    for (const child of children) {
      expect(child.temporalContext).toBe(parent.temporalContext);
    }

    // Persistence is only half of it: the engines that actually resolve the
    // horizons must receive that same object as their 3rd constructor argument.
    // A session could store the right clock while its traversal ran on another.
    const engineCalls = (TraversalEngine as unknown as jest.Mock).mock.calls;
    expect(engineCalls.length).toBe(children.length);
    for (const call of engineCalls) {
      expect(call[2]).toBe(parent.temporalContext);
    }
  });

  it('stamps a clock on the zero-match parent session too', async () => {
    (getMatchedPathways as jest.Mock).mockResolvedValue([]);
    (createMultiPathwaySession as jest.Mock).mockResolvedValue('mp-1');
    (getMultiPathwaySession as jest.Mock).mockResolvedValue(fakeStoredSession({ id: 'mp-1' }));

    await multiPathwayResolutionMutations.startMultiPathwayResolution({}, { patientId: 'pat-1' }, fakeContext());

    // The empty session still records WHEN "no pathways matched" was decided.
    // Without a clock that verdict is not reproducible.
    const parent = (createMultiPathwaySession as jest.Mock).mock.calls[0][1];
    expect(parent.temporalContext).toMatchObject({ timezone: 'UTC' });
    expect(parent.temporalContext.evaluationAsOf).toEqual(expect.any(String));
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

  /**
   * [DECISION — Josh] generation is blocked while any question is unanswered.
   * Single-pathway generation refused on a PENDING_QUESTION node; merged
   * generation looked only at conflicts and emptiness, and materialised a plan
   * with a contributing session's gate question still open.
   */
  describe('a question still open in a contributing pathway session', () => {
    const med = {
      recommendation: {
        name: 'Ferrous sulfate', role: 'first_line', dose: '325 mg', frequency: 'daily',
        sourcePathwayId: 'anemia', evidenceGateIds: [],
      },
      sourcePathwayIds: ['anemia'],
      state: 'auto-included',
    };
    function contextWith(rows: unknown[]) {
      const client = {
        query: jest.fn(async () => ({ rows: [{ id: 'cp-1' }] })),
        release: jest.fn(),
      };
      const pool = {
        query: jest.fn(async () => ({ rows })),
        connect: jest.fn(async () => client),
      };
      return { ctx: { ...(fakeContext() as object), pool } as never, pool, client };
    }
    function sessionWithOneMed() {
      return fakeStoredSession({
        contributingSessionIds: ['ps-anemia'],
        contributingPathwayIds: ['anemia'],
        mergedPlan: { ...emptyMergedPlan(), medications: [med] } as never,
      });
    }

    it('blocks, naming the unanswered question', async () => {
      (getMultiPathwaySession as jest.Mock).mockResolvedValueOnce(sessionWithOneMed());
      const { ctx, client } = contextWith([{
        session_id: 'ps-anemia',
        pathway_title: 'Anemia in Pregnancy',
        pending_questions: [{
          gateId: 'gate-hgb-response', prompt: 'Has Hgb risen ≥1 g/dL since starting iron?',
          answerType: 'SELECT', options: ['responding', 'not responding'],
        }],
        resolution_state: {
          'step-2-3': { status: NodeStatus.INCLUDED },
          'gate-hgb-response': { status: NodeStatus.PENDING_QUESTION },
          'step-2-4': { status: NodeStatus.PENDING_QUESTION },
        },
      }]);

      const result = await multiPathwayResolutionMutations.generateMergedCarePlan(
        {}, { sessionId: 'sess-1' }, ctx,
      );

      expect(result.success).toBe(false);
      expect(result.carePlanId).toBeNull();
      expect(result.blockers).toEqual([expect.objectContaining({
        type: 'PENDING_GATE',
        relatedNodeIds: ['gate-hgb-response'],
        description: expect.stringContaining('Has Hgb risen ≥1 g/dL since starting iron?'),
      })]);
      expect(result.blockers[0].description).toContain('Anemia in Pregnancy');
      expect(client.query).not.toHaveBeenCalled();
      expect(markMultiPathwaySessionStatus).not.toHaveBeenCalled();
    });

    it('blocks on a pending DecisionPoint, and on a datum asked on behalf of several gates', async () => {
      (getMultiPathwaySession as jest.Mock).mockResolvedValueOnce(sessionWithOneMed());
      const { ctx } = contextWith([{
        session_id: 'ps-anemia',
        pathway_title: 'Anemia in Pregnancy',
        pending_questions: [
          { gateId: 'dp-1', prompt: 'DP-1 — which branch applies?', options: ['step-1-2', 'stage-2-empiric'] },
          { gateId: 'gate-a', askedByNodeIds: ['gate-a', 'gate-b'], datumKey: 'patient.gestational_age_weeks', prompt: 'Gestational age?' },
        ],
        resolution_state: {
          'dp-1': { status: NodeStatus.PENDING_QUESTION },
          'gate-a': { status: NodeStatus.GATED_OUT },
          'gate-b': { status: NodeStatus.PENDING_QUESTION },
        },
      }]);

      const result = await multiPathwayResolutionMutations.generateMergedCarePlan(
        {}, { sessionId: 'sess-1' }, ctx,
      );

      expect(result.success).toBe(false);
      expect(result.blockers.map((b) => b.relatedNodeIds)).toEqual([['dp-1'], ['gate-a', 'gate-b']]);
    });

    it('blocks on pending nodes no open question covers, and says only re-resolving clears them', async () => {
      (getMultiPathwaySession as jest.Mock).mockResolvedValueOnce(sessionWithOneMed());
      const { ctx } = contextWith([{
        session_id: 'ps-anemia',
        pathway_title: 'Anemia in Pregnancy',
        pending_questions: [],
        resolution_state: { 'step-2-4': { status: NodeStatus.PENDING_QUESTION } },
      }]);

      const result = await multiPathwayResolutionMutations.generateMergedCarePlan(
        {}, { sessionId: 'sess-1' }, ctx,
      );

      expect(result.success).toBe(false);
      expect(result.blockers).toEqual([expect.objectContaining({
        type: 'PENDING_GATE',
        relatedNodeIds: ['step-2-4'],
        description: expect.stringContaining('re-resolve'),
      })]);
    });

    it('does not block on a NOT_YET_DUE gate — closed, nothing asked', async () => {
      (getMultiPathwaySession as jest.Mock).mockResolvedValueOnce(sessionWithOneMed());
      const { ctx, pool } = contextWith([{
        session_id: 'ps-anemia',
        pathway_title: 'Anemia in Pregnancy',
        pending_questions: [],
        resolution_state: {
          'step-2-3': { status: NodeStatus.INCLUDED },
          'gate-hgb-response': {
            status: NodeStatus.GATED_OUT, notYetDue: true,
            excludeReason: 'NOT_YET_DUE: recheck window opens 2026-10-08',
          },
          'step-2-4': { status: NodeStatus.GATED_OUT },
        },
      }]);

      const result = await multiPathwayResolutionMutations.generateMergedCarePlan(
        {}, { sessionId: 'sess-1' }, ctx,
      );

      expect(pool.query).toHaveBeenCalledWith(expect.any(String), [['ps-anemia']]);
      expect(result.blockers).toEqual([]);
      expect(result.success).toBe(true);
    });

    it('does not block on a tentative LLM gate awaiting confirmation (it is INCLUDED)', async () => {
      (getMultiPathwaySession as jest.Mock).mockResolvedValueOnce(sessionWithOneMed());
      const { ctx } = contextWith([{
        session_id: 'ps-anemia',
        pathway_title: 'Anemia in Pregnancy',
        pending_questions: [{ gateId: 'gate-llm', prompt: 'Confirm?', tentative: true }],
        resolution_state: { 'gate-llm': { status: NodeStatus.INCLUDED } },
      }]);

      const result = await multiPathwayResolutionMutations.generateMergedCarePlan(
        {}, { sessionId: 'sess-1' }, ctx,
      );

      expect(result.blockers).toEqual([]);
      expect(result.success).toBe(true);
    });
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

// ── Temporal preflight (plan 03) ────────────────────────────────────

describe('resolveAndPersistAll — validation is a preflight', () => {
  it('writes nothing when a LATER pathway fails validation', async () => {
    // Two pathways, both with non-empty graphs. The FIRST passes validation,
    // the SECOND throws. If validation still ran inside the traversal loop,
    // pathway one would already have been traversed and persisted by the time
    // pathway two was rejected — exactly the orphaned-session state the
    // two-pass split exists to prevent. This test fails if the passes are
    // merged back together.
    const a = fakeMatched('a', 'AF');
    const b = fakeMatched('b', 'HFrEF');
    const flushAudits = jest.fn();

    (getMatchedPathways as jest.Mock).mockResolvedValue([a, b]);
    (collapseLattice as jest.Mock).mockResolvedValue([a, b]);
    (buildResolutionContext as jest.Mock).mockResolvedValue(fakeRctx());
    (makeLlmGateEvaluator as jest.Mock).mockReturnValue({
      evaluator: jest.fn(),
      flushAudits,
    });
    (assertEncounterAnchor as jest.Mock)
      .mockImplementationOnce(() => undefined)
      .mockImplementationOnce(() => {
        throw new Error('MISSING_ENCOUNTER_ANCHOR');
      });

    await expect(
      multiPathwayResolutionMutations.startMultiPathwayResolution(
        {},
        { patientId: 'pat-1' },
        fakeContext(),
      ),
    ).rejects.toThrow('MISSING_ENCOUNTER_ANCHOR');

    // The three things that must NOT have happened.
    expect(TraversalEngine).not.toHaveBeenCalled();
    expect(createSession).not.toHaveBeenCalled();
    expect(flushAudits).not.toHaveBeenCalled();
  });
});

describe('startMultiPathwayResolution — policy version guard', () => {
  // makeEvaluationTemporalContext takes no arguments today and always yields
  // legacy-v0, so an unknown version is not reachable through the resolver
  // until plan 05 wires the input contract. Injected here so the boundary
  // guard is covered before that door opens.
  const badClock = {
    evaluationAsOf: '2026-08-03T12:00:00.000Z',
    timezone: 'UTC' as const,
    temporalPolicyVersion: 'v99',
  };

  it('rejects an unknown version before creating a zero-match parent session', async () => {
    (makeEvaluationTemporalContext as jest.Mock).mockReturnValueOnce(badClock);
    (getMatchedPathways as jest.Mock).mockResolvedValue([]); // zero-match exit

    await expect(
      multiPathwayResolutionMutations.startMultiPathwayResolution(
        {},
        { patientId: 'pat-1' },
        fakeContext(),
      ),
    ).rejects.toThrow(/unknown temporalPolicyVersion/);

    expect(createMultiPathwaySession).not.toHaveBeenCalled();
  });

  it('rejects an unknown version when every matched pathway has an empty graph', async () => {
    const a = fakeMatched('a', 'AF');
    (makeEvaluationTemporalContext as jest.Mock).mockReturnValueOnce(badClock);
    (getMatchedPathways as jest.Mock).mockResolvedValue([a]);
    (collapseLattice as jest.Mock).mockResolvedValue([a]);
    (buildResolutionContext as jest.Mock).mockResolvedValue(fakeRctx(0)); // sweeps nothing

    await expect(
      multiPathwayResolutionMutations.startMultiPathwayResolution(
        {},
        { patientId: 'pat-1' },
        fakeContext(),
      ),
    ).rejects.toThrow(/unknown temporalPolicyVersion/);

    expect(createMultiPathwaySession).not.toHaveBeenCalled();
  });
});

// ── One pathway's missing encounter anchor (bug report) ─────────────

describe('startMultiPathwayResolution — a pathway that cannot be anchored is dropped, not fatal', () => {
  const { TemporalContextError } = jest.requireActual(
    '../services/resolution/temporal/evaluation-context',
  );

  function twoPathwaysBFailsAnchor() {
    const a = fakeMatched('a', 'Anemia');
    const b = fakeMatched('b', 'Vitals-driven');
    (getMatchedPathways as jest.Mock).mockResolvedValue([a, b]);
    (collapseLattice as jest.Mock).mockResolvedValue([a, b]);
    (buildResolutionContext as jest.Mock).mockResolvedValue(fakeRctx());
    (createSession as jest.Mock).mockReset().mockResolvedValueOnce('per-a').mockResolvedValueOnce('per-b');
    (createMultiPathwaySession as jest.Mock).mockResolvedValue('mp-1');
    (getMultiPathwaySession as jest.Mock).mockResolvedValue(fakeStoredSession({ id: 'mp-1' }));
    (assertEncounterAnchor as jest.Mock).mockImplementation((_rctx: unknown, clock: { encounterStart?: string }) => {
      // Only pathway b (the second context built) resolves an ENCOUNTER horizon.
      if ((buildResolutionContext as jest.Mock).mock.calls.length === 2 && !clock.encounterStart) {
        throw new TemporalContextError(
          'this pathway resolves an ENCOUNTER horizon but the session has no encounterStart: BP (vitals, from system)',
          'MISSING_ENCOUNTER_ANCHOR',
        );
      }
    });
    setupTraverseSeq([
      makeResolutionStateWith([
        { nodeId: 'med-a', nodeType: 'Medication', properties: { name: 'Ferrous sulfate', role: 'first_line' } },
      ]),
    ]);
  }

  afterEach(() => {
    (assertEncounterAnchor as jest.Mock).mockReset();
  });

  it('resolves the other pathways and records why the failing one was left out', async () => {
    twoPathwaysBFailsAnchor();

    await multiPathwayResolutionMutations.startMultiPathwayResolution(
      {}, { patientId: 'pat-1' }, fakeContext(),
    );

    expect(createSession).toHaveBeenCalledTimes(1);
    const persisted = (createMultiPathwaySession as jest.Mock).mock.calls[0][1];
    expect(persisted.contributingPathwayIds).toEqual(['a']);
    expect(persisted.mergedPlan.skippedPathways).toEqual([
      expect.objectContaining({
        pathwayId: 'b',
        pathwayTitle: 'Vitals-driven',
        code: 'MISSING_ENCOUNTER_ANCHOR',
        reason: expect.stringMatching(/no encounterStart/),
      }),
    ]);
  });

  it('surfaces skippedPathways through the GraphQL formatter, [] for rows stored before it existed', () => {
    const skipped = [{ pathwayId: 'b', logicalId: 'lp-b', pathwayTitle: 'B', code: 'MISSING_ENCOUNTER_ANCHOR', reason: 'r' }];
    expect(formatMergedForGraphQL({ ...emptyMergedPlan(), skippedPathways: skipped } as MergedCarePlan).skippedPathways)
      .toEqual(skipped);
    expect(formatMergedForGraphQL(emptyMergedPlan()).skippedPathways).toEqual([]);
  });

  it('a synthetic (preview) session with no encounterStart is anchored at its own evaluation instant', async () => {
    twoPathwaysBFailsAnchor();

    await multiPathwayResolutionMutations.startMultiPathwayResolution(
      {},
      {
        patientId: 'pat-1', syntheticPatient: true,
        patientContext: { patientId: 'pat-1', conditionCodes: [{ code: 'O99.01', system: 'ICD-10' }] },
      } as never,
      fakeContext(),
    );

    const clock = (makeEvaluationTemporalContext as jest.Mock).mock.results[0].value;
    expect(clock.encounterStart).toBeDefined();
    // ONE stamp, not two reads of the wall clock.
    expect(clock.encounterStart).toBe(clock.evaluationAsOf);
    // So nothing is dropped.
    expect(createSession).toHaveBeenCalledTimes(2);
    expect((createMultiPathwaySession as jest.Mock).mock.calls[0][1].mergedPlan.skippedPathways).toEqual([]);
  });

  it('a non-synthetic session is NOT given an anchor it did not supply', async () => {
    twoPathwaysBFailsAnchor();
    await multiPathwayResolutionMutations.startMultiPathwayResolution(
      {}, { patientId: 'pat-1' }, fakeContext(),
    );
    const clock = (makeEvaluationTemporalContext as jest.Mock).mock.results[0].value;
    expect(clock.encounterStart).toBeUndefined();
  });

  it('any OTHER preflight error still rejects the whole run with nothing written', async () => {
    const a = fakeMatched('a');
    (getMatchedPathways as jest.Mock).mockResolvedValue([a]);
    (collapseLattice as jest.Mock).mockResolvedValue([a]);
    (buildResolutionContext as jest.Mock).mockResolvedValue(fakeRctx());
    (assertEncounterAnchor as jest.Mock).mockImplementation(() => {
      throw new TemporalContextError('bad horizon', 'INVALID_HORIZON');
    });

    await expect(multiPathwayResolutionMutations.startMultiPathwayResolution(
      {}, { patientId: 'pat-1' }, fakeContext(),
    )).rejects.toThrow('bad horizon');
    expect(createSession).not.toHaveBeenCalled();
    expect(createMultiPathwaySession).not.toHaveBeenCalled();
  });
});

// ── Same drug, different regimens — resolution end to end ──────────

describe('medication regimen conflicts — resolve, re-merge, materialise', () => {
  const meta = { resolvedBy: 'u', resolvedAt: 't' };

  function plan(pathwayId: string, title: string, meds: Array<Partial<ResolvedMedication>>): ResolvedCarePlan {
    return {
      pathwayId,
      pathwayLogicalId: `lp-${pathwayId}`,
      pathwayTitle: title,
      medications: meds.map((m) => ({
        name: 'Metformin',
        role: 'first_line',
        frequency: 'BID',
        route: 'PO',
        evidenceGateIds: [],
        sourcePathwayId: pathwayId,
        ...m,
      })) as ResolvedMedication[],
      labs: [],
      imaging: [],
      procedures: [],
      guidance: [],
      schedules: [],
      qualityMetrics: [],
      catchUpItems: [],
      evidenceTrail: [],
      dataGapHints: [],
    };
  }

  /** T2DM and PCOS agree on 500 mg; Obesity asks for 1000 mg. */
  function threeWayMerge(obesityDose = '1000 mg'): MergedCarePlan {
    return mergeResolvedCarePlans([
      plan('t2dm', 'T2DM', [{ dose: '500 mg' }]),
      plan('pcos', 'PCOS', [{ dose: '500 mg' }]),
      plan('obesity', 'Obesity', [{ dose: obesityDose }]),
    ]);
  }

  it('CONFIRM_PATHWAY materialises the chosen pathway\'s regimen, not the first one seen', () => {
    const merged = threeWayMerge();
    const conflict = merged.conflicts[0];
    const updated = applyResolution(merged, conflict, {
      kind: 'CONFIRM_PATHWAY', chosenPathwayId: 'obesity', ...meta,
    });

    expect(updated.medications).toHaveLength(1);
    expect(updated.medications[0].recommendation.dose).toBe('1000 mg');
    expect(updated.medications[0].state).toBe('provider-confirmed');
    expect(updated.conflicts[0].resolution?.kind).toBe('CONFIRM_PATHWAY');
  });

  it('CONFIRM_PATHWAY accepts ANY pathway that asked for a candidate, and keeps all their provenance', async () => {
    const merged = threeWayMerge();
    const session = fakeStoredSession({ mergedPlan: merged });
    (getMultiPathwaySession as jest.Mock)
      .mockResolvedValueOnce(session)
      .mockResolvedValueOnce(session);

    // PCOS is the SECOND pathway behind the 500 mg candidate. It used to be
    // refused because only the first contributor's id was on the candidate.
    await multiPathwayResolutionMutations.resolveConflict(
      {},
      {
        sessionId: session.id,
        conflictId: 'regimen:metformin',
        choice: { kind: 'CONFIRM_PATHWAY', chosenPathwayId: 'pcos' },
      },
      fakeContext(),
    );

    const [, , updatedPlan, resolutions] = (updateMergedPlanAndResolutions as jest.Mock).mock.calls[0];
    expect(updatedPlan.medications).toHaveLength(1);
    expect(updatedPlan.medications[0].recommendation.dose).toBe('500 mg');
    expect(updatedPlan.medications[0].sourcePathwayIds).toEqual(['t2dm', 'pcos']);
    expect(resolutions['regimen:metformin'].chosenPathwayId).toBe('pcos');
  });

  it('CONFIRM_PATHWAY takes every regimen the chosen pathway asked for', () => {
    const merged = mergeResolvedCarePlans([
      plan('t2dm', 'T2DM', [{ dose: '500 mg' }, { dose: '1000 mg', route: 'PO ER' }]),
      plan('pcos', 'PCOS', [{ dose: '750 mg' }]),
    ]);
    expect(merged.conflicts).toHaveLength(1);
    expect(merged.conflicts[0].candidates).toHaveLength(3);

    const updated = applyResolution(merged, merged.conflicts[0], {
      kind: 'CONFIRM_PATHWAY', chosenPathwayId: 't2dm', ...meta,
    });
    expect(updated.medications.map((m) => m.recommendation.dose)).toEqual(['500 mg', '1000 mg']);
  });

  it('ACCEPT_BOTH keeps each regimen once with all of its pathways', () => {
    const merged = threeWayMerge();
    const updated = applyResolution(merged, merged.conflicts[0], { kind: 'ACCEPT_BOTH', ...meta });
    expect(updated.medications.map((m) => [m.recommendation.dose, m.sourcePathwayIds])).toEqual([
      ['500 mg', ['t2dm', 'pcos']],
      ['1000 mg', ['obesity']],
    ]);
  });

  it('REJECT_BOTH and CUSTOM_OVERRIDE work on a regimen conflict', () => {
    const merged = threeWayMerge();
    const rejected = applyResolution(merged, merged.conflicts[0], { kind: 'REJECT_BOTH', ...meta });
    expect(rejected.medications).toEqual([]);
    expect(rejected.conflicts[0].resolution?.kind).toBe('REJECT_BOTH');

    const custom = applyResolution(merged, merged.conflicts[0], {
      kind: 'CUSTOM_OVERRIDE',
      customMedication: { name: 'Metformin', dose: '850 mg', frequency: 'BID', route: 'PO' },
      ...meta,
    });
    expect(custom.medications.map((m) => [m.recommendation.dose, m.state])).toEqual([
      ['850 mg', 'provider-override'],
    ]);
  });

  it('formats a regimen conflict as MEDICATION_REGIMEN with every contributing pathway id', () => {
    const out = formatMergedForGraphQL(threeWayMerge());
    const c = out.conflicts[0];
    expect(c.type).toBe('MEDICATION_REGIMEN');
    expect(c.conflictId).toBe('regimen:metformin');
    expect(c.clinicalRole).toBe('Metformin');
    expect(c.candidates.map((x) => x.sourcePathwayIds)).toEqual([['t2dm', 'pcos'], ['obesity']]);
  });

  it('formats rows stored before regimen conflicts existed: type MEDICATION, ids from sourcePathwayId', () => {
    const legacy = {
      ...emptyMergedPlan(),
      conflicts: [{
        conflictId: 'bb',
        clinicalRole: 'bb',
        candidates: [{
          recommendation: { name: 'Metoprolol', role: 'first_line', sourcePathwayId: 'a' },
          sourcePathwayId: 'a',
          sourcePathwayTitle: 'AF',
        }],
        resolution: null,
      }],
    } as unknown as MergedCarePlan;
    const c = formatMergedForGraphQL(legacy).conflicts[0];
    expect(c.type).toBe('MEDICATION');
    expect(c.candidates[0].sourcePathwayIds).toEqual(['a']);
  });

  describe('re-merge replays prior choices only while they still mean the same thing', () => {
    it('replays a choice onto an unchanged conflict', () => {
      const before = threeWayMerge();
      const choice: ConflictResolution = { kind: 'CONFIRM_PATHWAY', chosenPathwayId: 'obesity', ...meta };
      const stored = applyResolution(before, before.conflicts[0], choice);

      const { plan: replayed, resolutions } = replayConflictResolutions(
        stored, threeWayMerge(), { 'regimen:metformin': choice },
      );
      expect(replayed.conflicts[0].resolution).toEqual(choice);
      expect(replayed.medications.map((m) => m.recommendation.dose)).toEqual(['1000 mg']);
      expect(resolutions).toEqual({ 'regimen:metformin': choice });
    });

    it('drops a choice whose candidate regimens changed — the provider picked a dose that is gone', () => {
      const before = threeWayMerge('1000 mg');
      const choice: ConflictResolution = { kind: 'CONFIRM_PATHWAY', chosenPathwayId: 'obesity', ...meta };
      const stored = applyResolution(before, before.conflicts[0], choice);

      // A gate answer moved Obesity's ask from 1000 mg to 2000 mg.
      const { plan: replayed, resolutions } = replayConflictResolutions(
        stored, threeWayMerge('2000 mg'), { 'regimen:metformin': choice },
      );
      expect(replayed.conflicts[0].resolution).toBeNull();
      expect(replayed.medications).toEqual([]);
      expect(resolutions).toEqual({});
    });

    it('drops, rather than throws on, a choice for a pathway no longer among the candidates', () => {
      const before = threeWayMerge();
      const choice: ConflictResolution = { kind: 'CONFIRM_PATHWAY', chosenPathwayId: 'obesity', ...meta };
      const stored = applyResolution(before, before.conflicts[0], choice);

      // Obesity now agrees with 500 mg, but PCOS moved to 850 mg: same drug,
      // still a conflict — but not one Obesity has a distinct ask in.
      const after = mergeResolvedCarePlans([
        plan('t2dm', 'T2DM', [{ dose: '500 mg' }]),
        plan('pcos', 'PCOS', [{ dose: '850 mg' }]),
      ]);
      const { plan: replayed, resolutions } = replayConflictResolutions(
        stored, after, { 'regimen:metformin': choice },
      );
      expect(replayed.conflicts[0].resolution).toBeNull();
      expect(resolutions).toEqual({});
    });

    it('drops a CONFIRM_PATHWAY choice when the same regimens are now asked for by different pathways', () => {
      const before = threeWayMerge(); // 500 mg ← T2DM, PCOS; 1000 mg ← Obesity
      const choice: ConflictResolution = { kind: 'CONFIRM_PATHWAY', chosenPathwayId: 'obesity', ...meta };
      const stored = applyResolution(before, before.conflicts[0], choice);

      // Same two regimens on offer, but Obesity and PCOS swapped asks. Replaying
      // "use Obesity's" would now order 500 mg — not what the provider chose.
      const swapped = mergeResolvedCarePlans([
        plan('t2dm', 'T2DM', [{ dose: '500 mg' }]),
        plan('pcos', 'PCOS', [{ dose: '1000 mg' }]),
        plan('obesity', 'Obesity', [{ dose: '500 mg' }]),
      ]);
      const { plan: replayed, resolutions } = replayConflictResolutions(
        stored, swapped, { 'regimen:metformin': choice },
      );
      expect(replayed.conflicts[0].resolution).toBeNull();
      expect(replayed.medications).toEqual([]);
      expect(resolutions).toEqual({});
    });

    it('forgets a choice for a conflict that is gone, so it cannot resurrect on a later re-merge', () => {
      const before = threeWayMerge();
      const choice: ConflictResolution = { kind: 'ACCEPT_BOTH', ...meta };
      const stored = applyResolution(before, before.conflicts[0], choice);

      const agreed = mergeResolvedCarePlans([
        plan('t2dm', 'T2DM', [{ dose: '500 mg' }]),
        plan('obesity', 'Obesity', [{ dose: '500 mg' }]),
      ]);
      const { plan: replayed, resolutions } = replayConflictResolutions(
        stored, agreed, { 'regimen:metformin': choice },
      );
      expect(replayed.conflicts).toEqual([]);
      expect(replayed.medications).toHaveLength(1);
      expect(resolutions).toEqual({});
    });
  });

  it('materialises route and duration, not just dose and frequency', async () => {
    const queries: Array<{ sql: string; params: unknown[] }> = [];
    const client = {
      query: jest.fn(async (sql: string, params: unknown[] = []) => {
        queries.push({ sql, params });
        return { rows: [{ id: 'cp-1' }] };
      }),
      release: jest.fn(),
    };
    const merged = threeWayMerge();
    const chosen = applyResolution(merged, merged.conflicts[0], {
      kind: 'CONFIRM_PATHWAY', chosenPathwayId: 'obesity', ...meta,
    });
    chosen.medications[0].recommendation.route = 'PO ER';
    chosen.medications[0].recommendation.duration = '90 days';
    (getMultiPathwaySession as jest.Mock).mockResolvedValueOnce(
      fakeStoredSession({ mergedPlan: chosen }),
    );

    const result = await multiPathwayResolutionMutations.generateMergedCarePlan(
      {},
      { sessionId: 'sess-1' },
      { ...(fakeContext() as object), pool: { connect: jest.fn(async () => client) } } as never,
    );

    expect(result.success).toBe(true);
    const medInsert = queries.find((q) => q.sql.includes("'MEDICATION'"));
    expect(medInsert).toBeDefined();
    const params = medInsert!.params.map(String);
    expect(params).toEqual(expect.arrayContaining(['Metformin', '1000 mg', 'BID']));
    expect(params.some((p) => p.includes('PO ER') && p.includes('90 days'))).toBe(true);
  });
});
