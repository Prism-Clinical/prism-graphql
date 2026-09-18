import { ConfidenceEngine } from '../services/confidence/confidence-engine';
import { ScorerRegistry } from '../services/confidence/scorer-registry';
import { WeightCascadeResolver } from '../services/confidence/weight-cascade-resolver';
import { GraphEdge, GraphNode, ScoringType, SignalDefinition } from '../services/confidence/types';
import { REFERENCE_PATIENT } from './fixtures/reference-patient-context';

const signal: SignalDefinition = {
  id: '00000000-0000-4000-a000-000000000001',
  name: 'data_completeness',
  displayName: 'Data Completeness',
  description: '',
  scoringType: ScoringType.DATA_PRESENCE,
  scoringRules: {},
  propagationConfig: { mode: 'transitive_with_decay', decayFactor: 0.8 },
  scope: 'SYSTEM',
  defaultWeight: 1,
  isActive: true,
};
const nodes: GraphNode[] = [
  { id: 'a', nodeIdentifier: 'lab-1', nodeType: 'LabTest', properties: {} },
  { id: 'b', nodeIdentifier: 'step-1', nodeType: 'Step', properties: {} },
];
const edges: GraphEdge[] = [
  { id: 'e', edgeType: 'HAS_LAB_TEST', sourceId: 'lab-1', targetId: 'step-1', properties: {} },
];

function engine(): ConfidenceEngine {
  const registry = new ScorerRegistry();
  registry.register({
    scoringType: ScoringType.DATA_PRESENCE,
    declareRequiredInputs: () => [],
    score: ({ node }: { node: GraphNode }) =>
      node.nodeIdentifier === 'lab-1'
        ? { score: 0.3, missingInputs: ['result_value'] }
        : { score: 0.9, missingInputs: [] },
    propagate: ({ sourceScore, hopDistance, propagationConfig }: any) => ({
      propagatedScore: sourceScore * Math.pow(propagationConfig.decayFactor ?? 0.8, hopDistance),
      shouldPropagate: true,
    }),
  } as never);
  return new ConfidenceEngine(registry, new WeightCascadeResolver());
}

describe('ConfidenceEngine load/score split', () => {
  it('scorePathway makes no queries and equals computePathwayConfidence', async () => {
    const e = engine();
    const pool = { query: jest.fn().mockResolvedValue({ rows: [] }) };
    const params = { pathwayId: 'pw', nodes, edges, signalDefinitions: [signal], patientContext: REFERENCE_PATIENT };

    const viaCompute = await e.computePathwayConfidence({ pool: pool as never, ...params });
    const config = await e.loadScoringConfig({ pool: pool as never, pathwayId: 'pw', nodes, signalDefinitions: [signal] });
    pool.query.mockClear();

    const pure = e.scorePathway(config, params);

    expect(pool.query).not.toHaveBeenCalled();
    expect(pure).toEqual(viaCompute);
    // Positive: whole-graph propagation ran (0.3 × 0.8 onto step-1).
    expect(pure.nodes.find((n) => n.nodeIdentifier === 'step-1')!.confidence).toBeCloseTo(0.24, 2);
  });
});
