import { WeightCascadeResolver } from '../services/confidence/weight-cascade-resolver';
import {
  SignalDefinition,
  ScoringType,
  WeightSource,
  NodeIdentifier,
  ResolvedThresholds,
  ThresholdScope,
} from '../services/confidence/types';

function makeSignalDefs(): SignalDefinition[] {
  return [
    {
      id: '00000000-0000-4000-a000-000000000001',
      name: 'data_completeness',
      displayName: 'Data Completeness',
      description: '',
      scoringType: ScoringType.DATA_PRESENCE,
      scoringRules: {},
      propagationConfig: { mode: 'transitive_with_decay', decayFactor: 0.8, maxHops: 3 },
      scope: 'SYSTEM',
      defaultWeight: 0.30,
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
      defaultWeight: 0.25,
      isActive: true,
    },
  ];
}

describe('WeightCascadeResolver', () => {
  let resolver: WeightCascadeResolver;
  let mockPool: any;

  beforeEach(() => {
    mockPool = {
      query: jest.fn(),
    };
    resolver = new WeightCascadeResolver();
  });

  describe('resolveAllWeights', () => {
    it('should return system defaults when no overrides exist', async () => {
      mockPool.query.mockResolvedValue({ rows: [] });

      const result = await resolver.resolveAllWeights({
        pool: mockPool,
        pathwayId: 'pathway-1',
        signalDefinitions: makeSignalDefs(),
        nodeIdentifiers: [
          { nodeIdentifier: 'stage-1', nodeType: 'Stage' },
          { nodeIdentifier: 'dp-1', nodeType: 'DecisionPoint' },
        ],
      });

      expect(result['stage-1']['data_completeness'].weight).toBe(0.30);
      expect(result['stage-1']['data_completeness'].source).toBe(WeightSource.SYSTEM_DEFAULT);
      expect(result['dp-1']['evidence_strength'].weight).toBe(0.25);
      expect(result['dp-1']['evidence_strength'].source).toBe(WeightSource.SYSTEM_DEFAULT);
    });

    it('should apply node-level override when present', async () => {
      mockPool.query.mockResolvedValue({
        rows: [
          {
            signal_definition_id: '00000000-0000-4000-a000-000000000001',
            node_identifier: 'dp-1',
            weight: 0.50,
            scope: 'NODE',
          },
        ],
      });

      const result = await resolver.resolveAllWeights({
        pool: mockPool,
        pathwayId: 'pathway-1',
        signalDefinitions: makeSignalDefs(),
        nodeIdentifiers: [
          { nodeIdentifier: 'dp-1', nodeType: 'DecisionPoint' },
        ],
      });

      expect(result['dp-1']['data_completeness'].weight).toBe(0.50);
      expect(result['dp-1']['data_completeness'].source).toBe(WeightSource.NODE_OVERRIDE);
    });

    it('should prefer node override over pathway override', async () => {
      mockPool.query.mockResolvedValue({
        rows: [
          {
            signal_definition_id: '00000000-0000-4000-a000-000000000001',
            node_identifier: 'dp-1',
            weight: 0.50,
            scope: 'NODE',
          },
          {
            signal_definition_id: '00000000-0000-4000-a000-000000000001',
            node_identifier: null,
            weight: 0.40,
            scope: 'PATHWAY',
          },
        ],
      });

      const result = await resolver.resolveAllWeights({
        pool: mockPool,
        pathwayId: 'pathway-1',
        signalDefinitions: makeSignalDefs(),
        nodeIdentifiers: [
          { nodeIdentifier: 'dp-1', nodeType: 'DecisionPoint' },
        ],
      });

      expect(result['dp-1']['data_completeness'].weight).toBe(0.50);
      expect(result['dp-1']['data_completeness'].source).toBe(WeightSource.NODE_OVERRIDE);
    });
  });

  describe('resolveThresholds', () => {
    it('should return system defaults when no overrides exist', async () => {
      mockPool.query.mockResolvedValue({
        rows: [
          {
            auto_resolve_threshold: 0.85,
            suggest_threshold: 0.60,
            scope: 'SYSTEM_DEFAULT',
          },
        ],
      });

      const result = await resolver.resolveThresholds({
        pool: mockPool,
        pathwayId: 'pathway-1',
      });

      expect(result.autoResolveThreshold).toBe(0.85);
      expect(result.suggestThreshold).toBe(0.60);
      expect(result.scope).toBe(ThresholdScope.SYSTEM_DEFAULT);
    });

    it('should prefer more specific scope', async () => {
      mockPool.query.mockResolvedValue({
        rows: [
          {
            auto_resolve_threshold: 0.90,
            suggest_threshold: 0.70,
            scope: 'PATHWAY',
          },
          {
            auto_resolve_threshold: 0.85,
            suggest_threshold: 0.60,
            scope: 'SYSTEM_DEFAULT',
          },
        ],
      });

      const result = await resolver.resolveThresholds({
        pool: mockPool,
        pathwayId: 'pathway-1',
      });

      expect(result.autoResolveThreshold).toBe(0.90);
      expect(result.scope).toBe(ThresholdScope.PATHWAY);
    });
  });
});
