/**
 * Phase 3 commit 3 — orchestration test for `startMultiPathwayResolution`.
 *
 * The merge layer (care-plan-merge.test.ts), projection (care-plan-projection.test.ts),
 * and lattice collapse (lattice-collapse.test.ts) are already deeply unit-tested.
 * These tests focus on:
 *   - the orchestrator threads the right values into the right helpers,
 *   - empty/edge cases (no matches, empty graph) don't throw,
 *   - the GraphQL formatter flattens correctly (suppressed, sourcePathwayIds, state).
 */

import {
  MergedCarePlan as MergedInternal,
} from '../services/resolution/care-plan-merge';

// ── Mocks (must precede import of the unit under test) ──────────────

jest.mock('../services/resolution/session-store', () => ({
  getMatchedPathways: jest.fn(),
}));

jest.mock('../services/resolution/lattice-collapse', () => ({
  collapseLattice: jest.fn(),
}));

jest.mock('../resolvers/helpers/resolution-context', () => ({
  buildResolutionContext: jest.fn(),
  makeTraversalAdapter: jest.fn(() => ({})),
}));

jest.mock('../services/resolution/traversal-engine', () => {
  return {
    TraversalEngine: jest.fn().mockImplementation(() => ({
      traverse: jest.fn(),
    })),
  };
});

import {
  multiPathwayResolutionMutations,
  formatMergedForGraphQL,
} from '../resolvers/mutations/multi-pathway-resolution';
import { getMatchedPathways } from '../services/resolution/session-store';
import { collapseLattice } from '../services/resolution/lattice-collapse';
import { buildResolutionContext } from '../resolvers/helpers/resolution-context';
import { TraversalEngine } from '../services/resolution/traversal-engine';
import { NodeStatus } from '../services/resolution/types';

// ── Helpers ─────────────────────────────────────────────────────────

function fakeContext() {
  return {
    pool: {} as unknown,
    redis: {},
    userId: 'u1',
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

function setupTraversalReturning(state: Map<string, unknown>) {
  (TraversalEngine as unknown as jest.Mock).mockImplementation(() => ({
    traverse: jest.fn().mockResolvedValue({
      resolutionState: state,
      dependencyMap: { influencedBy: new Map(), influences: new Map(), gateContextFields: new Map(), scorerInputs: new Map() },
      pendingQuestions: [],
      redFlags: [],
      totalNodesEvaluated: state.size,
      traversalDurationMs: 1,
      isDegraded: false,
    }),
  }));
}

// ── Tests ───────────────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks();
});

describe('startMultiPathwayResolution — empty path', () => {
  it('returns an empty MergedCarePlan when no pathways match', async () => {
    (getMatchedPathways as jest.Mock).mockResolvedValue([]);

    const result = await multiPathwayResolutionMutations.startMultiPathwayResolution(
      {},
      { patientId: 'pat-1' },
      fakeContext(),
    );

    expect(result.sourcePathwayIds).toEqual([]);
    expect(result.medications).toEqual([]);
    expect(result.suppressed).toEqual([]);
    expect(collapseLattice).not.toHaveBeenCalled();
  });
});

describe('startMultiPathwayResolution — orchestration order', () => {
  it('calls getMatchedPathways → collapseLattice → buildResolutionContext per survivor', async () => {
    const a = fakeMatched('a');
    const b = fakeMatched('b');
    (getMatchedPathways as jest.Mock).mockResolvedValue([a, b]);
    (collapseLattice as jest.Mock).mockResolvedValue([b]); // a is dominated
    (buildResolutionContext as jest.Mock).mockResolvedValue(fakeRctx());
    setupTraversalReturning(makeResolutionStateWith([
      { nodeId: 'med-1', nodeType: 'Medication', properties: { name: 'X', role: 'first_line' } },
    ]));

    await multiPathwayResolutionMutations.startMultiPathwayResolution(
      {},
      { patientId: 'pat-1' },
      fakeContext(),
    );

    expect(getMatchedPathways).toHaveBeenCalledTimes(1);
    expect(collapseLattice).toHaveBeenCalledTimes(1);
    expect(collapseLattice).toHaveBeenCalledWith(expect.anything(), [a, b]);
    // Only the survivor gets a resolution context built
    expect(buildResolutionContext).toHaveBeenCalledTimes(1);
    expect(buildResolutionContext).toHaveBeenCalledWith(expect.anything(), 'b');
  });

  it('skips pathways whose graph is empty', async () => {
    const a = fakeMatched('a');
    const b = fakeMatched('b');
    (getMatchedPathways as jest.Mock).mockResolvedValue([a, b]);
    (collapseLattice as jest.Mock).mockResolvedValue([a, b]);
    (buildResolutionContext as jest.Mock)
      .mockResolvedValueOnce(fakeRctx(0))   // a empty → skip
      .mockResolvedValueOnce(fakeRctx(3));  // b has nodes
    setupTraversalReturning(makeResolutionStateWith([
      { nodeId: 'med-1', nodeType: 'Medication', properties: { name: 'Lisinopril', role: 'first_line' } },
    ]));

    const result = await multiPathwayResolutionMutations.startMultiPathwayResolution(
      {},
      { patientId: 'pat-1' },
      fakeContext(),
    );

    // Only b ran traversal, so only its pathway id appears
    expect(result.sourcePathwayIds).toEqual(['b']);
    expect(result.medications).toHaveLength(1);
    expect(result.medications[0].sourcePathwayIds).toEqual(['b']);
  });
});

describe('startMultiPathwayResolution — end-to-end smoke', () => {
  it('merges medications across two surviving pathways', async () => {
    const a = fakeMatched('a', 'HTN');
    const b = fakeMatched('b', 'CKD');
    (getMatchedPathways as jest.Mock).mockResolvedValue([a, b]);
    (collapseLattice as jest.Mock).mockResolvedValue([a, b]);
    (buildResolutionContext as jest.Mock).mockResolvedValue(fakeRctx());

    const stateA = makeResolutionStateWith([
      { nodeId: 'med-a', nodeType: 'Medication', properties: { name: 'Lisinopril', role: 'first_line' } },
    ]);
    const stateB = makeResolutionStateWith([
      { nodeId: 'med-b', nodeType: 'Medication', properties: { name: 'Lisinopril', role: 'first_line' } }, // same drug
    ]);

    let call = 0;
    (TraversalEngine as unknown as jest.Mock).mockImplementation(() => ({
      traverse: jest.fn().mockImplementation(() => {
        const state = call++ === 0 ? stateA : stateB;
        return Promise.resolve({
          resolutionState: state,
          dependencyMap: { influencedBy: new Map(), influences: new Map(), gateContextFields: new Map(), scorerInputs: new Map() },
          pendingQuestions: [],
          redFlags: [],
          totalNodesEvaluated: state.size,
          traversalDurationMs: 1,
          isDegraded: false,
        });
      }),
    }));

    const result = await multiPathwayResolutionMutations.startMultiPathwayResolution(
      {},
      { patientId: 'pat-1' },
      fakeContext(),
    );

    // Both pathways feed in
    expect(result.sourcePathwayIds).toEqual(['a', 'b']);
    // Same drug → one merged recommendation, sourced by both
    expect(result.medications).toHaveLength(1);
    expect(result.medications[0].sourcePathwayIds.sort()).toEqual(['a', 'b']);
    expect(result.medications[0].state).toBe('AUTO_INCLUDED');
  });

  it('surfaces suppressed contraindicated medications via the formatter', async () => {
    const a = fakeMatched('a', 'CKD');
    const b = fakeMatched('b', 'HTN');
    (getMatchedPathways as jest.Mock).mockResolvedValue([a, b]);
    (collapseLattice as jest.Mock).mockResolvedValue([a, b]);
    (buildResolutionContext as jest.Mock).mockResolvedValue(fakeRctx());

    // a flags NSAIDs as contraindicated; b would prescribe NSAIDs
    const stateA = makeResolutionStateWith([
      { nodeId: 'med-a', nodeType: 'Medication', properties: { name: 'NSAIDs', role: 'contraindicated' } },
    ]);
    const stateB = makeResolutionStateWith([
      { nodeId: 'med-b', nodeType: 'Medication', properties: { name: 'NSAIDs', role: 'first_line' } },
    ]);

    let call = 0;
    (TraversalEngine as unknown as jest.Mock).mockImplementation(() => ({
      traverse: jest.fn().mockImplementation(() => {
        const state = call++ === 0 ? stateA : stateB;
        return Promise.resolve({
          resolutionState: state,
          dependencyMap: { influencedBy: new Map(), influences: new Map(), gateContextFields: new Map(), scorerInputs: new Map() },
          pendingQuestions: [],
          redFlags: [],
          totalNodesEvaluated: state.size,
          traversalDurationMs: 1,
          isDegraded: false,
        });
      }),
    }));

    const result = await multiPathwayResolutionMutations.startMultiPathwayResolution(
      {},
      { patientId: 'pat-1' },
      fakeContext(),
    );

    // No active medication recommendations
    expect(result.medications).toEqual([]);
    // Two suppressed entries: the contraindication itself + the suppressed prescription
    expect(result.suppressed).toHaveLength(2);
    const reasons = result.suppressed.map((s) => s.reason);
    expect(reasons.every((r) => r === 'CONTRAINDICATED')).toBe(true);
    const types = result.suppressed.map((s) => s.type);
    expect(types.every((t) => t === 'MEDICATION')).toBe(true);
    expect(result.suppressed[0].suppressedByPathwayId).toBe('a');
    expect(result.suppressed[0].suppressedByPathwayTitle).toBe('CKD');
  });
});

describe('formatMergedForGraphQL', () => {
  it('maps internal merge to GraphQL shape with AUTO_INCLUDED state on every recommendation', () => {
    const internal: MergedInternal = {
      sourcePathwayIds: ['p1'],
      medications: [{
        recommendation: { name: 'X', role: 'first_line', sourcePathwayId: 'p1' },
        sourcePathwayIds: ['p1'],
        state: 'auto-included',
      }],
      labs: [{
        recommendation: { name: 'L', sourcePathwayId: 'p1' },
        sourcePathwayIds: ['p1'],
        state: 'auto-included',
      }],
      procedures: [],
      schedules: [],
      qualityMetrics: [],
      suppressed: [],
    };
    const result = formatMergedForGraphQL(internal);
    expect(result.medications[0].state).toBe('AUTO_INCLUDED');
    expect(result.labs[0].state).toBe('AUTO_INCLUDED');
  });

  it('flattens SuppressedRecommendation.suppressedBy into top-level fields', () => {
    const internal: MergedInternal = {
      sourcePathwayIds: ['p1', 'p2'],
      medications: [],
      labs: [],
      procedures: [],
      schedules: [],
      qualityMetrics: [],
      suppressed: [{
        type: 'medication',
        name: 'NSAIDs',
        reason: 'avoid',
        suppressedBy: { pathwayId: 'p2', pathwayTitle: 'CKD' },
        original: { name: 'NSAIDs', role: 'avoid', sourcePathwayId: 'p2' } as never,
      }],
    };
    const result = formatMergedForGraphQL(internal);
    expect(result.suppressed[0]).toEqual({
      type: 'MEDICATION',
      name: 'NSAIDs',
      reason: 'AVOID',
      suppressedByPathwayId: 'p2',
      suppressedByPathwayTitle: 'CKD',
    });
  });
});
