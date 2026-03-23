import { Mutation } from '../resolvers/Mutation';

function createMockContext() {
  return {
    pool: { query: jest.fn() },
    redis: {},
    userId: 'test-user',
    userRole: 'ADMIN',
  };
}

describe('Confidence mutation resolvers', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  describe('createSignalDefinition', () => {
    it('should insert a new signal definition and return it', async () => {
      const ctx = createMockContext();
      (ctx.pool.query as jest.Mock).mockResolvedValue({ rows: [{
        id: 'new-signal-id', name: 'custom_signal', display_name: 'Custom Signal',
        description: 'A custom signal', scoring_type: 'CUSTOM_RULES',
        scoring_rules: '{"rules":[],"default_score":0.5}', scope: 'INSTITUTION',
        institution_id: 'inst-1', default_weight: 0.15, is_active: true,
      }] });

      const result = await Mutation.Mutation.createSignalDefinition({}, {
        input: {
          name: 'custom_signal', displayName: 'Custom Signal', description: 'A custom signal',
          scoringType: 'CUSTOM_RULES', scoringRules: { rules: [], default_score: 0.5 },
          scope: 'INSTITUTION', institutionId: 'inst-1', defaultWeight: 0.15,
        },
      }, ctx as any);

      expect(result.name).toBe('custom_signal');
      expect(result.displayName).toBe('Custom Signal');
    });

    it('should reject INSTITUTION scope without institutionId', async () => {
      const ctx = createMockContext();
      await expect(Mutation.Mutation.createSignalDefinition({}, {
        input: { name: 'test', displayName: 'Test', scoringType: 'CUSTOM_RULES',
                 scoringRules: {}, scope: 'INSTITUTION', defaultWeight: 0.1 },
      }, ctx as any)).rejects.toThrow('institutionId is required');
    });
  });

  describe('setSignalWeight', () => {
    it('should upsert a signal weight override', async () => {
      const ctx = createMockContext();
      (ctx.pool.query as jest.Mock).mockResolvedValue({ rows: [{
        id: 'weight-1', signal_definition_id: 'signal-1', weight: 0.40,
        scope: 'PATHWAY', pathway_id: 'pathway-1', node_identifier: null,
        node_type: null, institution_id: null,
      }] });

      const result = await Mutation.Mutation.setSignalWeight({}, {
        input: { signalDefinitionId: 'signal-1', weight: 0.40, scope: 'PATHWAY', pathwayId: 'pathway-1' },
      }, ctx as any);

      expect(result.weight).toBe(0.40);
      expect(result.scope).toBe('PATHWAY');
    });
  });

  describe('setResolutionThresholds', () => {
    it('should upsert resolution thresholds', async () => {
      const ctx = createMockContext();
      (ctx.pool.query as jest.Mock).mockResolvedValue({ rows: [{
        id: 'threshold-1', auto_resolve_threshold: 0.90, suggest_threshold: 0.65,
        scope: 'PATHWAY', pathway_id: 'pathway-1', node_identifier: null, institution_id: null,
      }] });

      const result = await Mutation.Mutation.setResolutionThresholds({}, {
        input: { autoResolveThreshold: 0.90, suggestThreshold: 0.65, scope: 'PATHWAY', pathwayId: 'pathway-1' },
      }, ctx as any);

      expect(result.autoResolveThreshold).toBe(0.90);
    });
  });

  describe('deleteSignalDefinition', () => {
    it('should delete and return true', async () => {
      const ctx = createMockContext();
      (ctx.pool.query as jest.Mock).mockResolvedValue({ rowCount: 1 });
      const result = await Mutation.Mutation.deleteSignalDefinition({}, { id: 'signal-to-delete' }, ctx as any);
      expect(result).toBe(true);
    });

    it('should throw if signal not found', async () => {
      const ctx = createMockContext();
      (ctx.pool.query as jest.Mock).mockResolvedValue({ rowCount: 0 });
      await expect(Mutation.Mutation.deleteSignalDefinition({}, { id: 'nonexistent' }, ctx as any)).rejects.toThrow('not found');
    });
  });
});
