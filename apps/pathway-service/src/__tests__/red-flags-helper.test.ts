/**
 * The reconciliation primitive itself, and the scope the RetraversalEngine
 * must report for it to be safe.
 *
 * The load-bearing constraint: a retraversal re-evaluates only a SUBSET of the
 * graph, and re-derives only SOME flag types. Replacing more than that scope
 * destroys valid flags — including `missing_critical_data`, which
 * `RetraversalEngine` never emits at all.
 */

import {
  reconcileRedFlags,
  reconcilePendingQuestions,
  redFlagKey,
  isRedFlagType,
  RETRAVERSAL_RED_FLAG_TYPES,
} from '../services/resolution/red-flags';
import type { RedFlag, PendingQuestion, NodeResult } from '../services/resolution/types';
import { NodeStatus } from '../services/resolution/types';
import { RetraversalEngine } from '../services/resolution/retraversal-engine';
import { makeEvaluationTemporalContext } from '../services/resolution/temporal/evaluation-context';
import { createEmptyDependencyMap } from '../services/resolution/types';

function flag(nodeId: string, type: RedFlag['type'], extra: Partial<RedFlag> = {}): RedFlag {
  return { nodeId, nodeTitle: nodeId, type, description: `${type} on ${nodeId}`, ...extra };
}

const allTypes = RETRAVERSAL_RED_FLAG_TYPES;

describe('redFlagKey', () => {
  it('separates two genuinely different flags on the same node', () => {
    expect(redFlagKey(flag('n1', 'all_branches_excluded'))).not.toBe(
      redFlagKey(flag('n1', 'missing_critical_data')),
    );
  });

  it('is stable across a re-derivation that reworded the description', () => {
    const a = flag('n1', 'all_branches_excluded', { description: 'All 2 branches …' });
    const b = flag('n1', 'all_branches_excluded', { description: 'All 3 branches …' });
    expect(redFlagKey(a)).toBe(redFlagKey(b));
  });
});

describe('isRedFlagType', () => {
  it('accepts the declared members', () => {
    expect(isRedFlagType('all_branches_excluded')).toBe(true);
    expect(isRedFlagType('missing_critical_data')).toBe(true);
    expect(isRedFlagType('contradiction')).toBe(true);
  });

  it('rejects anything else', () => {
    expect(isRedFlagType('ALL_BRANCHES_EXCLUDED')).toBe(false);
    expect(isRedFlagType('')).toBe(false);
  });
});

describe('reconcileRedFlags', () => {
  it('replaces a re-derived flag in place rather than appending it', () => {
    const out = reconcileRedFlags(
      [flag('a', 'all_branches_excluded'), flag('b', 'all_branches_excluded')],
      [flag('a', 'all_branches_excluded', { description: 'fresh' })],
      { nodeIds: ['a'], types: allTypes },
    );
    expect(out.map(f => f.nodeId)).toEqual(['a', 'b']);
    expect(out[0].description).toBe('fresh');
  });

  it('drops an in-scope flag the pass no longer derives', () => {
    const out = reconcileRedFlags([flag('a', 'all_branches_excluded')], [], {
      nodeIds: ['a'],
      types: allTypes,
    });
    expect(out).toEqual([]);
  });

  it('keeps an out-of-scope flag untouched', () => {
    const kept = flag('b', 'all_branches_excluded');
    expect(reconcileRedFlags([kept], [], { nodeIds: ['a'], types: allTypes })).toEqual([kept]);
  });

  it('dedupes flags an earlier append already duplicated', () => {
    const out = reconcileRedFlags(
      [flag('a', 'all_branches_excluded'), flag('a', 'all_branches_excluded')],
      [],
      { nodeIds: [], types: allTypes },
    );
    expect(out).toHaveLength(1);
  });

  /**
   * The scope is (node × type), not node alone. `RetraversalEngine` re-derives
   * ONLY `all_branches_excluded`; a `missing_critical_data` flag on the very
   * same node is outside what this pass can speak to and must survive.
   *
   * The gaps document asserts "RetraversalEngine already re-derives the full
   * flag set for the nodes it touched" — it does not, and a node-only scope
   * would silently delete a critical-data flag on every unrelated retraversal.
   */
  it('does not touch a flag type the pass did not re-derive', () => {
    const critical = flag('a', 'missing_critical_data');
    const out = reconcileRedFlags([critical, flag('a', 'all_branches_excluded')], [], {
      nodeIds: ['a'],
      types: ['all_branches_excluded'],
    });
    expect(out).toEqual([critical]);
  });

  it('throws when a derived flag falls outside the declared scope', () => {
    expect(() =>
      reconcileRedFlags([], [flag('z', 'all_branches_excluded')], {
        nodeIds: ['a'],
        types: allTypes,
      }),
    ).toThrow(/outside the declared reconciliation scope/);
  });

  it('throws when a derived flag has a type outside the declared scope', () => {
    expect(() =>
      reconcileRedFlags([], [flag('a', 'missing_critical_data')], {
        nodeIds: ['a'],
        types: ['all_branches_excluded'],
      }),
    ).toThrow(/outside the declared reconciliation scope/);
  });
});

describe('reconcilePendingQuestions', () => {
  const q = (gateId: string, prompt = gateId): PendingQuestion => ({
    gateId,
    prompt,
    answerType: 'BOOLEAN' as PendingQuestion['answerType'],
    affectedSubtreeSize: 0,
    estimatedImpact: 'unknown',
  });

  it('replaces a re-emitted question in place instead of duplicating it', () => {
    const out = reconcilePendingQuestions([q('g1'), q('g2')], [q('g1', 'reworded')], {
      gateIds: ['g1'],
    });
    expect(out.map(x => x.gateId)).toEqual(['g1', 'g2']);
    expect(out[0].prompt).toBe('reworded');
  });

  it('drops an in-scope question the pass no longer emits', () => {
    expect(reconcilePendingQuestions([q('g1')], [], { gateIds: ['g1'] })).toEqual([]);
  });

  it('drops the gates named in alsoDropGateIds even when out of scope', () => {
    expect(
      reconcilePendingQuestions([q('g1')], [], { gateIds: [], alsoDropGateIds: ['g1'] }),
    ).toEqual([]);
  });

  it('throws when a derived question falls outside the declared scope', () => {
    expect(() => reconcilePendingQuestions([], [q('zz')], { gateIds: ['g1'] })).toThrow(
      /outside the declared reconciliation scope/,
    );
  });
});

// ── Engine: it must report the scope it actually re-evaluated ────────

describe('RetraversalEngine reconciliation scope', () => {
  function makeEngine() {
    return new RetraversalEngine(
      {
        computeNodeConfidence: jest.fn().mockResolvedValue({
          confidence: 0.9,
          breakdown: [],
          resolutionType: 'AUTO_RESOLVED',
        }),
      } as never,
      { autoResolveThreshold: 0.85, suggestThreshold: 0.6 },
      makeEvaluationTemporalContext({ evaluationAsOf: '2026-07-30T12:00:00.000Z' }),
      {},
      [],
      new Map(),
    );
  }

  function node(overrides: Partial<NodeResult> & { nodeId: string }): NodeResult {
    return {
      nodeType: 'Medication',
      title: overrides.nodeId,
      status: NodeStatus.INCLUDED,
      confidence: 0.9,
      confidenceBreakdown: [],
      depth: 0,
      ...overrides,
    } as NodeResult;
  }

  const emptyGraph = {
    getNode: () => undefined,
    allNodes: [],
    allEdges: [],
    incomingEdges: () => [],
    outgoingEdges: () => [],
    linkedNodes: () => [],
  };

  const patient = {
    patientId: 'p1',
    conditionCodes: [],
    medications: [],
    labResults: [],
    allergies: [],
  };

  it('reports every node it re-evaluated', async () => {
    const state = new Map<string, NodeResult>([['n1', node({ nodeId: 'n1' })]]);
    const result = await makeEngine().retraverse(
      new Set(['n1']),
      state,
      createEmptyDependencyMap(),
      emptyGraph as never,
      patient as never,
      new Map(),
    );
    expect(result.reEvaluatedNodeIds).toEqual(['n1']);
    expect(result.reDerivedRedFlagTypes).toEqual(['all_branches_excluded']);
  });

  /**
   * A provider-overridden node is skipped, never re-evaluated. If it were
   * reported in scope, reconciliation would delete its flag on a pass that
   * never looked at it.
   */
  it('excludes a provider-overridden node from the reported scope', async () => {
    const state = new Map<string, NodeResult>([
      [
        'n1',
        node({
          nodeId: 'n1',
          providerOverride: {
            action: 'EXCLUDE',
            originalStatus: NodeStatus.INCLUDED,
            originalConfidence: 0.9,
          },
        } as never),
      ],
    ]);
    const result = await makeEngine().retraverse(
      new Set(['n1']),
      state,
      createEmptyDependencyMap(),
      emptyGraph as never,
      patient as never,
      new Map(),
    );
    expect(result.reEvaluatedNodeIds).toEqual([]);
  });

  it('excludes a node that is not in the resolution state at all', async () => {
    const result = await makeEngine().retraverse(
      new Set(['gone']),
      new Map<string, NodeResult>(),
      createEmptyDependencyMap(),
      emptyGraph as never,
      patient as never,
      new Map(),
    );
    expect(result.reEvaluatedNodeIds).toEqual([]);
  });

  /**
   * Reconciliation replaces the stored flag with the re-derived one, so the
   * re-derived one has to carry the same detail the traversal-derived one did
   * — otherwise the fix quietly strips `branches` off every flag it touches.
   */
  it('populates `branches` on a re-derived all_branches_excluded flag', async () => {
    const state = new Map<string, NodeResult>([
      ['dp', node({ nodeId: 'dp', nodeType: 'DecisionPoint', title: 'DP' })],
      [
        'b1',
        node({
          nodeId: 'b1',
          title: 'Branch one',
          status: NodeStatus.EXCLUDED,
          confidence: 0.1,
          excludeReason: 'too low',
        } as never),
      ],
      ['b2', node({ nodeId: 'b2', title: 'Branch two', status: NodeStatus.EXCLUDED, confidence: 0.2 })],
    ]);
    const graph = {
      ...emptyGraph,
      outgoingEdges: (id: string) =>
        id === 'dp'
          ? [
              { targetId: 'b1', edgeType: 'BRANCHES_TO' },
              { targetId: 'b2', edgeType: 'BRANCHES_TO' },
            ]
          : [],
    };

    const result = await makeEngine().retraverse(
      new Set(['dp']),
      state,
      createEmptyDependencyMap(),
      graph as never,
      patient as never,
      new Map(),
    );

    expect(result.newRedFlags).toHaveLength(1);
    expect(result.newRedFlags[0].branches).toEqual([
      { nodeId: 'b1', title: 'Branch one', confidence: 0.1, topExcludeReason: 'too low' },
      { nodeId: 'b2', title: 'Branch two', confidence: 0.2, topExcludeReason: undefined },
    ]);
  });
});
