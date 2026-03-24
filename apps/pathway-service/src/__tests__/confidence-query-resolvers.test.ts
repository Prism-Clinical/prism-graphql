import { Query, hydrateSignalDefinition } from '../resolvers/Query';

function createMockContext() {
  return {
    pool: { query: jest.fn() },
    redis: {},
    userId: 'test-user',
    userRole: 'PROVIDER',
  };
}

describe('Confidence query resolvers', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  describe('signalDefinitions', () => {
    it('should query signal definitions with no scope filter', async () => {
      const ctx = createMockContext();
      (ctx.pool.query as jest.Mock).mockResolvedValue({
        rows: [{
          id: '00000000-0000-4000-a000-000000000001',
          name: 'data_completeness',
          display_name: 'Data Completeness',
          description: 'Measures data availability',
          scoring_type: 'DATA_PRESENCE',
          scoring_rules: '{"propagation":{"mode":"transitive_with_decay"}}',
          scope: 'SYSTEM',
          institution_id: null,
          default_weight: 0.30,
          is_active: true,
        }],
      });

      const result = await Query.Query.signalDefinitions({}, {}, ctx as any);

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('data_completeness');
      expect(result[0].displayName).toBe('Data Completeness');
      expect(result[0].scoringType).toBe('DATA_PRESENCE');
    });

    it('should filter by scope when provided', async () => {
      const ctx = createMockContext();
      (ctx.pool.query as jest.Mock).mockResolvedValue({ rows: [] });

      await Query.Query.signalDefinitions({}, { scope: 'INSTITUTION', institutionId: 'inst-1' }, ctx as any);

      const call = (ctx.pool.query as jest.Mock).mock.calls[0];
      expect(call[0]).toContain('scope = $1');
      expect(call[1]).toContain('INSTITUTION');
    });
  });

  describe('hydrateSignalDefinition', () => {
    it('should normalize propagation mode from uppercase DB value', () => {
      const row = {
        id: 'test-id', name: 'test', display_name: 'Test', description: '',
        scoring_type: 'DATA_PRESENCE',
        scoring_rules: JSON.stringify({ propagation: { mode: 'TRANSITIVE_WITH_DECAY', decayFactor: 0.8 } }),
        scope: 'SYSTEM', institution_id: null, default_weight: '0.30', is_active: true,
      };
      const result = hydrateSignalDefinition(row);
      expect(result.propagationConfig.mode).toBe('transitive_with_decay');
      expect(result.propagationConfig.decayFactor).toBe(0.8);
    });

    it('should default to mode none when no propagation config', () => {
      const row = {
        id: 'test-id', name: 'test', display_name: 'Test', description: '',
        scoring_type: 'MAPPING_LOOKUP', scoring_rules: '{}',
        scope: 'SYSTEM', institution_id: null, default_weight: '0.25', is_active: true,
      };
      const result = hydrateSignalDefinition(row);
      expect(result.propagationConfig.mode).toBe('none');
    });

    it('should handle already-lowercase mode values', () => {
      const row = {
        id: 'test-id', name: 'test', display_name: 'Test', description: '',
        scoring_type: 'CRITERIA_MATCH',
        scoring_rules: { propagation: { mode: 'direct' } },
        scope: 'SYSTEM', institution_id: null, default_weight: '0.25', is_active: true,
      };
      const result = hydrateSignalDefinition(row);
      expect(result.propagationConfig.mode).toBe('direct');
    });
  });

  describe('effectiveThresholds', () => {
    it('should return resolved thresholds', async () => {
      const ctx = createMockContext();
      (ctx.pool.query as jest.Mock).mockResolvedValue({
        rows: [{ auto_resolve_threshold: 0.85, suggest_threshold: 0.60, scope: 'SYSTEM_DEFAULT' }],
      });

      const result = await Query.Query.effectiveThresholds({}, { pathwayId: 'pathway-1' }, ctx as any);

      expect(result.autoResolveThreshold).toBe(0.85);
      expect(result.suggestThreshold).toBe(0.60);
    });
  });
});
