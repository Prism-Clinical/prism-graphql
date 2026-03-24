// apps/pathway-service/src/__tests__/confidence-engine.test.ts

import { ConfidenceEngine } from '../services/confidence/confidence-engine';
import { ScorerRegistry } from '../services/confidence/scorer-registry';
import { WeightCascadeResolver } from '../services/confidence/weight-cascade-resolver';
import {
  GraphNode,
  GraphEdge,
  SignalDefinition,
  ScoringType,
  WeightSource,
  PatientContext,
  ThresholdScope,
  ResolutionType,
} from '../services/confidence/types';
import { REFERENCE_PATIENT } from './fixtures/reference-patient-context';

function createMockScorer(type: ScoringType, score: number) {
  return {
    scoringType: type,
    declareRequiredInputs: jest.fn().mockReturnValue([]),
    score: jest.fn().mockReturnValue({ score, missingInputs: [] }),
  };
}

function makeSignalDefs(): SignalDefinition[] {
  return [
    {
      id: '00000000-0000-4000-a000-000000000001',
      name: 'data_completeness',
      displayName: 'Data Completeness',
      description: '',
      scoringType: ScoringType.DATA_PRESENCE,
      scoringRules: {},
      propagationConfig: { mode: 'none' },
      scope: 'SYSTEM',
      defaultWeight: 0.5,
      isActive: true,
    },
    {
      id: '00000000-0000-4000-a000-000000000002',
      name: 'evidence_strength',
      displayName: 'Evidence Strength',
      description: '',
      scoringType: ScoringType.MAPPING_LOOKUP,
      scoringRules: {},
      propagationConfig: { mode: 'none' },
      scope: 'SYSTEM',
      defaultWeight: 0.5,
      isActive: true,
    },
  ];
}

describe('ConfidenceEngine', () => {
  let engine: ConfidenceEngine;
  let registry: ScorerRegistry;
  let cascadeResolver: WeightCascadeResolver;
  let mockPool: any;

  beforeEach(() => {
    registry = new ScorerRegistry();
    registry.register(createMockScorer(ScoringType.DATA_PRESENCE, 0.8));
    registry.register(createMockScorer(ScoringType.MAPPING_LOOKUP, 0.6));

    cascadeResolver = new WeightCascadeResolver();
    mockPool = { query: jest.fn().mockResolvedValue({ rows: [] }) };

    engine = new ConfidenceEngine(registry, cascadeResolver);
  });

  describe('computePathwayConfidence', () => {
    it('should compute per-node confidence as weighted average of signal scores', async () => {
      const nodes: GraphNode[] = [
        { id: 'age-1', nodeIdentifier: 'stage-1', nodeType: 'Stage', properties: { stage_number: 1, title: 'Assessment' } },
      ];
      const edges: GraphEdge[] = [];
      const signals = makeSignalDefs();

      jest.spyOn(cascadeResolver, 'resolveAllWeights').mockResolvedValue({
        'stage-1': {
          data_completeness: { weight: 0.5, source: WeightSource.SYSTEM_DEFAULT },
          evidence_strength: { weight: 0.5, source: WeightSource.SYSTEM_DEFAULT },
        },
      });
      jest.spyOn(cascadeResolver, 'resolveThresholds').mockResolvedValue({
        autoResolveThreshold: 0.85,
        suggestThreshold: 0.60,
        scope: ThresholdScope.SYSTEM_DEFAULT,
      });

      const result = await engine.computePathwayConfidence({
        pool: mockPool,
        pathwayId: 'pathway-1',
        nodes,
        edges,
        signalDefinitions: signals,
        patientContext: REFERENCE_PATIENT,
      });

      expect(result.pathwayId).toBe('pathway-1');
      expect(result.nodes).toHaveLength(1);

      const nodeResult = result.nodes[0];
      expect(nodeResult.nodeIdentifier).toBe('stage-1');
      // Weighted average: (0.8 * 0.5 + 0.6 * 0.5) / (0.5 + 0.5) = 0.7
      expect(nodeResult.confidence).toBeCloseTo(0.7);
      expect(nodeResult.breakdown).toHaveLength(2);
    });

    it('should classify DecisionPoint resolution type based on thresholds', async () => {
      const nodes: GraphNode[] = [
        { id: 'age-1', nodeIdentifier: 'dp-1', nodeType: 'DecisionPoint', properties: { title: 'Decision', auto_resolve_eligible: true } },
      ];
      const signals = makeSignalDefs();

      registry = new ScorerRegistry();
      registry.register(createMockScorer(ScoringType.DATA_PRESENCE, 0.95));
      registry.register(createMockScorer(ScoringType.MAPPING_LOOKUP, 0.90));
      engine = new ConfidenceEngine(registry, cascadeResolver);

      jest.spyOn(cascadeResolver, 'resolveAllWeights').mockResolvedValue({
        'dp-1': {
          data_completeness: { weight: 0.5, source: WeightSource.SYSTEM_DEFAULT },
          evidence_strength: { weight: 0.5, source: WeightSource.SYSTEM_DEFAULT },
        },
      });
      jest.spyOn(cascadeResolver, 'resolveThresholds').mockResolvedValue({
        autoResolveThreshold: 0.85,
        suggestThreshold: 0.60,
        scope: ThresholdScope.SYSTEM_DEFAULT,
      });

      const result = await engine.computePathwayConfidence({
        pool: mockPool,
        pathwayId: 'pathway-1',
        nodes,
        edges: [],
        signalDefinitions: signals,
        patientContext: REFERENCE_PATIENT,
      });

      const dpResult = result.nodes[0];
      // (0.95 * 0.5 + 0.90 * 0.5) / 1.0 = 0.925 >= 0.85 → AUTO_RESOLVED
      expect(dpResult.resolutionType).toBe(ResolutionType.AUTO_RESOLVED);
    });

    it('should classify as SYSTEM_SUGGESTED when between suggest and auto thresholds', async () => {
      const nodes: GraphNode[] = [
        { id: 'age-1', nodeIdentifier: 'dp-1', nodeType: 'DecisionPoint', properties: { title: 'Decision', auto_resolve_eligible: true } },
      ];
      const signals = makeSignalDefs();

      registry = new ScorerRegistry();
      registry.register(createMockScorer(ScoringType.DATA_PRESENCE, 0.7));
      registry.register(createMockScorer(ScoringType.MAPPING_LOOKUP, 0.7));
      engine = new ConfidenceEngine(registry, cascadeResolver);

      jest.spyOn(cascadeResolver, 'resolveAllWeights').mockResolvedValue({
        'dp-1': {
          data_completeness: { weight: 0.5, source: WeightSource.SYSTEM_DEFAULT },
          evidence_strength: { weight: 0.5, source: WeightSource.SYSTEM_DEFAULT },
        },
      });
      jest.spyOn(cascadeResolver, 'resolveThresholds').mockResolvedValue({
        autoResolveThreshold: 0.85,
        suggestThreshold: 0.60,
        scope: ThresholdScope.SYSTEM_DEFAULT,
      });

      const result = await engine.computePathwayConfidence({
        pool: mockPool,
        pathwayId: 'pathway-1',
        nodes,
        edges: [],
        signalDefinitions: signals,
        patientContext: REFERENCE_PATIENT,
      });

      expect(result.nodes[0].resolutionType).toBe(ResolutionType.SYSTEM_SUGGESTED);
    });

    it('should classify as FORCED_MANUAL when auto_resolve_eligible is false', async () => {
      const nodes: GraphNode[] = [
        { id: 'age-1', nodeIdentifier: 'dp-1', nodeType: 'DecisionPoint', properties: { title: 'Decision', auto_resolve_eligible: false } },
      ];
      const signals = makeSignalDefs();

      registry = new ScorerRegistry();
      registry.register(createMockScorer(ScoringType.DATA_PRESENCE, 0.95));
      registry.register(createMockScorer(ScoringType.MAPPING_LOOKUP, 0.95));
      engine = new ConfidenceEngine(registry, cascadeResolver);

      jest.spyOn(cascadeResolver, 'resolveAllWeights').mockResolvedValue({
        'dp-1': {
          data_completeness: { weight: 0.5, source: WeightSource.SYSTEM_DEFAULT },
          evidence_strength: { weight: 0.5, source: WeightSource.SYSTEM_DEFAULT },
        },
      });
      jest.spyOn(cascadeResolver, 'resolveThresholds').mockResolvedValue({
        autoResolveThreshold: 0.85,
        suggestThreshold: 0.60,
        scope: ThresholdScope.SYSTEM_DEFAULT,
      });

      const result = await engine.computePathwayConfidence({
        pool: mockPool,
        pathwayId: 'pathway-1',
        nodes,
        edges: [],
        signalDefinitions: signals,
        patientContext: REFERENCE_PATIENT,
      });

      expect(result.nodes[0].resolutionType).toBe(ResolutionType.FORCED_MANUAL);
    });

    it('should compute pathway overall confidence as weighted average of node confidences', async () => {
      const nodes: GraphNode[] = [
        { id: 'age-1', nodeIdentifier: 'stage-1', nodeType: 'Stage', properties: { stage_number: 1, title: 'A' } },
        { id: 'age-2', nodeIdentifier: 'step-1', nodeType: 'Step', properties: { stage_number: 1, step_number: 1, display_number: '1.1', title: 'B' } },
      ];
      const signals = makeSignalDefs();

      jest.spyOn(cascadeResolver, 'resolveAllWeights').mockResolvedValue({
        'stage-1': {
          data_completeness: { weight: 0.5, source: WeightSource.SYSTEM_DEFAULT },
          evidence_strength: { weight: 0.5, source: WeightSource.SYSTEM_DEFAULT },
        },
        'step-1': {
          data_completeness: { weight: 0.5, source: WeightSource.SYSTEM_DEFAULT },
          evidence_strength: { weight: 0.5, source: WeightSource.SYSTEM_DEFAULT },
        },
      });
      jest.spyOn(cascadeResolver, 'resolveThresholds').mockResolvedValue({
        autoResolveThreshold: 0.85,
        suggestThreshold: 0.60,
        scope: ThresholdScope.SYSTEM_DEFAULT,
      });

      const result = await engine.computePathwayConfidence({
        pool: mockPool,
        pathwayId: 'pathway-1',
        nodes,
        edges: [],
        signalDefinitions: signals,
        patientContext: REFERENCE_PATIENT,
      });

      // Both nodes get same scores (mock scorers return same values)
      // Overall = average of node confidences (equal default weight)
      expect(result.overallConfidence).toBeCloseTo(0.7);
    });

    it('should propagate low scores along edges and reduce downstream confidence', async () => {
      // 2-node chain: lab-1 → step-1, with transitive_with_decay propagation
      const nodes: GraphNode[] = [
        { id: 'age-1', nodeIdentifier: 'lab-1', nodeType: 'LabTest', properties: {} },
        { id: 'age-2', nodeIdentifier: 'step-1', nodeType: 'Step', properties: {} },
      ];
      const edges: GraphEdge[] = [
        { id: 'e1', edgeType: 'HAS_LAB_TEST', sourceId: 'lab-1', targetId: 'step-1', properties: {} },
      ];

      // Use a scorer with propagation support
      const propagatingScorer = {
        scoringType: ScoringType.DATA_PRESENCE,
        declareRequiredInputs: jest.fn().mockReturnValue([]),
        score: jest.fn().mockImplementation(({ node }: any) => {
          // lab-1 has low score (missing data), step-1 has high score
          return node.nodeIdentifier === 'lab-1'
            ? { score: 0.3, missingInputs: ['result_value'] }
            : { score: 0.9, missingInputs: [] };
        }),
        propagate: jest.fn().mockImplementation(({ sourceScore, hopDistance, propagationConfig }: any) => {
          const decay = propagationConfig.decayFactor ?? 0.8;
          return {
            propagatedScore: sourceScore * Math.pow(decay, hopDistance),
            shouldPropagate: true,
          };
        }),
      };

      registry = new ScorerRegistry();
      registry.register(propagatingScorer);
      // Use single signal to simplify
      const signals: SignalDefinition[] = [{
        id: '00000000-0000-4000-a000-000000000001',
        name: 'data_completeness',
        displayName: 'Data Completeness',
        description: '',
        scoringType: ScoringType.DATA_PRESENCE,
        scoringRules: {},
        propagationConfig: { mode: 'transitive_with_decay', decayFactor: 0.8, maxHops: 3 },
        scope: 'SYSTEM',
        defaultWeight: 1.0,
        isActive: true,
      }];

      engine = new ConfidenceEngine(registry, cascadeResolver);

      jest.spyOn(cascadeResolver, 'resolveAllWeights').mockResolvedValue({
        'lab-1': { data_completeness: { weight: 1.0, source: WeightSource.SYSTEM_DEFAULT } },
        'step-1': { data_completeness: { weight: 1.0, source: WeightSource.SYSTEM_DEFAULT } },
      });
      jest.spyOn(cascadeResolver, 'resolveThresholds').mockResolvedValue({
        autoResolveThreshold: 0.85,
        suggestThreshold: 0.60,
        scope: ThresholdScope.SYSTEM_DEFAULT,
      });

      const result = await engine.computePathwayConfidence({
        pool: mockPool,
        pathwayId: 'pathway-1',
        nodes,
        edges,
        signalDefinitions: signals,
        patientContext: REFERENCE_PATIENT,
      });

      const stepResult = result.nodes.find(n => n.nodeIdentifier === 'step-1')!;
      // step-1 raw score is 0.9 but propagated score from lab-1 is 0.3 * 0.8 = 0.24
      // min(0.9, 0.24) = 0.24, so confidence should be 0.24
      expect(stepResult.confidence).toBeCloseTo(0.24, 2);
      expect(stepResult.propagationInfluences).toHaveLength(1);
      expect(stepResult.propagationInfluences[0].sourceNodeIdentifier).toBe('lab-1');
    });

    it('should handle cycles gracefully (skip propagation)', async () => {
      const nodes: GraphNode[] = [
        { id: 'age-1', nodeIdentifier: 'a', nodeType: 'Step', properties: {} },
        { id: 'age-2', nodeIdentifier: 'b', nodeType: 'Step', properties: {} },
      ];
      // Cycle: a → b → a
      const edges: GraphEdge[] = [
        { id: 'e1', edgeType: 'NEXT', sourceId: 'a', targetId: 'b', properties: {} },
        { id: 'e2', edgeType: 'NEXT', sourceId: 'b', targetId: 'a', properties: {} },
      ];
      const signals = makeSignalDefs();

      jest.spyOn(cascadeResolver, 'resolveAllWeights').mockResolvedValue({
        'a': {
          data_completeness: { weight: 0.5, source: WeightSource.SYSTEM_DEFAULT },
          evidence_strength: { weight: 0.5, source: WeightSource.SYSTEM_DEFAULT },
        },
        'b': {
          data_completeness: { weight: 0.5, source: WeightSource.SYSTEM_DEFAULT },
          evidence_strength: { weight: 0.5, source: WeightSource.SYSTEM_DEFAULT },
        },
      });
      jest.spyOn(cascadeResolver, 'resolveThresholds').mockResolvedValue({
        autoResolveThreshold: 0.85,
        suggestThreshold: 0.60,
        scope: ThresholdScope.SYSTEM_DEFAULT,
      });

      const result = await engine.computePathwayConfidence({
        pool: mockPool,
        pathwayId: 'pathway-1',
        nodes,
        edges,
        signalDefinitions: signals,
        patientContext: REFERENCE_PATIENT,
      });

      // Should still produce results (propagation skipped, not crashed)
      expect(result.nodes).toHaveLength(2);
      // No propagation influences since cycle detection skips propagation
      expect(result.nodes[0].propagationInfluences).toHaveLength(0);
      expect(result.nodes[1].propagationInfluences).toHaveLength(0);
    });
  });
});
