import { RetraversalEngine } from '../services/resolution/retraversal-engine';
import { NodeStatus, NodeResult, createEmptyDependencyMap } from '../services/resolution/types';

const mockConfidenceEngine = {
  computeNodeConfidence: jest.fn().mockResolvedValue({
    confidence: 0.90,
    breakdown: [],
    resolutionType: 'AUTO_RESOLVED',
  }),
};
const mockThresholds = { autoResolveThreshold: 0.85, suggestThreshold: 0.60 };

function makeNodeResult(overrides: Partial<NodeResult> & { nodeId: string }): NodeResult {
  return {
    nodeType: 'Step',
    title: overrides.nodeId,
    status: NodeStatus.INCLUDED,
    confidence: 0.9,
    confidenceBreakdown: [],
    depth: 1,
    ...overrides,
  };
}

describe('RetraversalEngine', () => {
  let engine: RetraversalEngine;

  beforeEach(() => {
    engine = new RetraversalEngine(mockConfidenceEngine as any, mockThresholds);
    jest.clearAllMocks();
    // Reset default mock
    mockConfidenceEngine.computeNodeConfidence.mockResolvedValue({
      confidence: 0.90,
      breakdown: [],
      resolutionType: 'AUTO_RESOLVED',
    });
  });

  it('should recompute affected nodes', async () => {
    const resolutionState = new Map<string, NodeResult>([
      ['node-a', makeNodeResult({ nodeId: 'node-a', nodeType: 'Medication', depth: 1 })],
      ['gate-b', makeNodeResult({ nodeId: 'gate-b', nodeType: 'Medication', depth: 2 })],
    ]);
    const depMap = createEmptyDependencyMap();
    depMap.influences.set('node-a', new Set(['gate-b']));
    depMap.influencedBy.set('gate-b', new Set(['node-a']));

    const result = await engine.retraverse(
      new Set(['gate-b']),
      resolutionState,
      depMap,
      { getNode: () => undefined, allNodes: [], allEdges: [], incomingEdges: () => [], outgoingEdges: () => [], linkedNodes: () => [] } as any,
      { patientId: 'p1', conditionCodes: [], medications: [], labResults: [], allergies: [] } as any,
      new Map(),
    );
    expect(result.nodesRecomputed).toBeGreaterThan(0);
  });

  it('should respect cascade depth limit', async () => {
    const resolutionState = new Map<string, NodeResult>();
    const depMap = createEmptyDependencyMap();

    // Build a chain of 15 nodes
    for (let i = 0; i < 15; i++) {
      const id = `node-${i}`;
      resolutionState.set(id, makeNodeResult({
        nodeId: id,
        nodeType: 'Medication',
        title: `Node ${i}`,
        depth: i,
      }));
      if (i > 0) {
        depMap.influences.set(`node-${i - 1}`, new Set([id]));
        depMap.influencedBy.set(id, new Set([`node-${i - 1}`]));
      }
    }

    // Force status changes so cascade propagates
    mockConfidenceEngine.computeNodeConfidence.mockResolvedValue({
      confidence: 0.40,
      breakdown: [],
      resolutionType: 'PROVIDER_DECIDED',
    });

    const result = await engine.retraverse(
      new Set(['node-0']),
      resolutionState,
      depMap,
      { getNode: () => undefined, allNodes: [], allEdges: [], incomingEdges: () => [], outgoingEdges: () => [], linkedNodes: () => [] } as any,
      { patientId: 'p1', conditionCodes: [], medications: [], labResults: [], allergies: [] } as any,
      new Map(),
    );
    // MAX_CASCADE_DEPTH is 10, so we process at most 11 nodes (0..10) before hitting the limit
    expect(result.nodesRecomputed).toBeLessThanOrEqual(11);
  });

  it('should track status changes', async () => {
    mockConfidenceEngine.computeNodeConfidence.mockResolvedValue({
      confidence: 0.40,
      breakdown: [],
      resolutionType: 'PROVIDER_DECIDED',
    });

    const resolutionState = new Map<string, NodeResult>([
      ['node-x', makeNodeResult({
        nodeId: 'node-x',
        nodeType: 'Medication',
        title: 'X',
        status: NodeStatus.INCLUDED,
        confidence: 0.9,
        depth: 1,
      })],
    ]);

    const result = await engine.retraverse(
      new Set(['node-x']),
      resolutionState,
      createEmptyDependencyMap(),
      { getNode: () => undefined, allNodes: [], allEdges: [], incomingEdges: () => [], outgoingEdges: () => [], linkedNodes: () => [] } as any,
      { patientId: 'p1', conditionCodes: [], medications: [], labResults: [], allergies: [] } as any,
      new Map(),
    );
    expect(result.statusChanges.length).toBe(1);
    expect(result.statusChanges[0]).toEqual({
      nodeId: 'node-x',
      from: 'INCLUDED',
      to: 'EXCLUDED',
    });
  });

  it('should not change nodes with provider overrides', async () => {
    mockConfidenceEngine.computeNodeConfidence.mockResolvedValue({
      confidence: 0.40,
      breakdown: [],
      resolutionType: 'PROVIDER_DECIDED',
    });

    const resolutionState = new Map<string, NodeResult>([
      ['node-o', makeNodeResult({
        nodeId: 'node-o',
        nodeType: 'Medication',
        title: 'Overridden',
        status: NodeStatus.INCLUDED,
        confidence: 0.9,
        depth: 1,
        providerOverride: {
          action: 'INCLUDE' as any,
          originalStatus: NodeStatus.EXCLUDED,
          originalConfidence: 0.4,
        },
      })],
    ]);

    const result = await engine.retraverse(
      new Set(['node-o']),
      resolutionState,
      createEmptyDependencyMap(),
      { getNode: () => undefined, allNodes: [], allEdges: [], incomingEdges: () => [], outgoingEdges: () => [], linkedNodes: () => [] } as any,
      { patientId: 'p1', conditionCodes: [], medications: [], labResults: [], allergies: [] } as any,
      new Map(),
    );
    expect(result.statusChanges.length).toBe(0);
    expect(resolutionState.get('node-o')!.status).toBe(NodeStatus.INCLUDED);
  });

  it('should return empty result for empty affected set', async () => {
    const result = await engine.retraverse(
      new Set(),
      new Map(),
      createEmptyDependencyMap(),
      { getNode: () => undefined, allNodes: [], allEdges: [], incomingEdges: () => [], outgoingEdges: () => [], linkedNodes: () => [] } as any,
      { patientId: 'p1', conditionCodes: [], medications: [], labResults: [], allergies: [] } as any,
      new Map(),
    );
    expect(result.nodesRecomputed).toBe(0);
    expect(result.statusChanges).toEqual([]);
    expect(result.newPendingQuestions).toEqual([]);
    expect(result.newRedFlags).toEqual([]);
  });
});
