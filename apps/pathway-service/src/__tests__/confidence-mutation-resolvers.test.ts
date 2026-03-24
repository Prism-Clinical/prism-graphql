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

    it('should reject defaultWeight outside 0-1 range', async () => {
      const ctx = createMockContext();
      await expect(Mutation.Mutation.createSignalDefinition({}, {
        input: {
          name: 'test', displayName: 'Test', scoringType: 'CUSTOM_RULES',
          scoringRules: {}, scope: 'SYSTEM', defaultWeight: 1.5,
        },
      }, ctx as any)).rejects.toThrow('defaultWeight must be between');
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

    it('should reject weight outside 0-1 range', async () => {
      const ctx = createMockContext();
      await expect(Mutation.Mutation.setSignalWeight({}, {
        input: { signalDefinitionId: 'signal-1', weight: 2.0, scope: 'PATHWAY', pathwayId: 'pathway-1' },
      }, ctx as any)).rejects.toThrow('Weight must be between');
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

    it('should reject thresholds outside 0-1 range', async () => {
      const ctx = createMockContext();
      await expect(Mutation.Mutation.setResolutionThresholds({}, {
        input: { autoResolveThreshold: 1.5, suggestThreshold: 0.60, scope: 'SYSTEM_DEFAULT' },
      }, ctx as any)).rejects.toThrow('between 0.0 and 1.0');
    });

    it('should reject negative thresholds', async () => {
      const ctx = createMockContext();
      await expect(Mutation.Mutation.setResolutionThresholds({}, {
        input: { autoResolveThreshold: 0.85, suggestThreshold: -0.1, scope: 'SYSTEM_DEFAULT' },
      }, ctx as any)).rejects.toThrow('between 0.0 and 1.0');
    });

    it('should reject when suggestThreshold >= autoResolveThreshold', async () => {
      const ctx = createMockContext();
      await expect(Mutation.Mutation.setResolutionThresholds({}, {
        input: { autoResolveThreshold: 0.60, suggestThreshold: 0.60, scope: 'SYSTEM_DEFAULT' },
      }, ctx as any)).rejects.toThrow('suggestThreshold must be less than');
    });

    it('should reject when suggestThreshold > autoResolveThreshold', async () => {
      const ctx = createMockContext();
      await expect(Mutation.Mutation.setResolutionThresholds({}, {
        input: { autoResolveThreshold: 0.50, suggestThreshold: 0.70, scope: 'SYSTEM_DEFAULT' },
      }, ctx as any)).rejects.toThrow('suggestThreshold must be less than');
    });
  });

  describe('updateSignalDefinition', () => {
    it('should update displayName and return hydrated result', async () => {
      const ctx = createMockContext();
      (ctx.pool.query as jest.Mock).mockResolvedValue({ rows: [{
        id: 'signal-1', name: 'data_completeness', display_name: 'Updated Name',
        description: 'desc', scoring_type: 'DATA_PRESENCE',
        scoring_rules: '{"propagation":{"mode":"transitive_with_decay"}}', scope: 'SYSTEM',
        institution_id: null, default_weight: 0.30, is_active: true,
      }] });

      const result = await Mutation.Mutation.updateSignalDefinition({}, {
        id: 'signal-1',
        input: { displayName: 'Updated Name' },
      }, ctx as any);

      expect(result.displayName).toBe('Updated Name');
      const sql = (ctx.pool.query as jest.Mock).mock.calls[0][0];
      expect(sql).toContain('display_name = $1');
    });

    it('should reject empty input with no fields to update', async () => {
      const ctx = createMockContext();
      await expect(Mutation.Mutation.updateSignalDefinition({}, {
        id: 'signal-1',
        input: {},
      }, ctx as any)).rejects.toThrow('No fields to update');
    });

    it('should throw NOT_FOUND when signal does not exist', async () => {
      const ctx = createMockContext();
      (ctx.pool.query as jest.Mock).mockResolvedValue({ rows: [] });
      await expect(Mutation.Mutation.updateSignalDefinition({}, {
        id: 'nonexistent',
        input: { displayName: 'Test' },
      }, ctx as any)).rejects.toThrow('not found');
    });

    it('should merge propagationConfig into scoringRules', async () => {
      const ctx = createMockContext();
      (ctx.pool.query as jest.Mock).mockResolvedValue({ rows: [{
        id: 'signal-1', name: 'custom', display_name: 'Custom',
        description: '', scoring_type: 'CUSTOM_RULES',
        scoring_rules: '{"rules":[],"propagation":{"mode":"direct"}}', scope: 'SYSTEM',
        institution_id: null, default_weight: 0.20, is_active: true,
      }] });

      await Mutation.Mutation.updateSignalDefinition({}, {
        id: 'signal-1',
        input: { propagationConfig: { mode: 'direct' } },
      }, ctx as any);

      const sql = (ctx.pool.query as jest.Mock).mock.calls[0][0];
      expect(sql).toContain('scoring_rules = scoring_rules ||');
    });
  });

  describe('deleteSignalDefinition', () => {
    it('should delete and return true when no dependent weights', async () => {
      const ctx = createMockContext();
      (ctx.pool.query as jest.Mock)
        .mockResolvedValueOnce({ rows: [{ count: '0' }] }) // dep check
        .mockResolvedValueOnce({ rowCount: 1 }); // delete
      const result = await Mutation.Mutation.deleteSignalDefinition({}, { id: 'signal-to-delete' }, ctx as any);
      expect(result).toBe(true);
    });

    it('should throw if signal not found', async () => {
      const ctx = createMockContext();
      (ctx.pool.query as jest.Mock)
        .mockResolvedValueOnce({ rows: [{ count: '0' }] }) // dep check
        .mockResolvedValueOnce({ rowCount: 0 }); // delete
      await expect(Mutation.Mutation.deleteSignalDefinition({}, { id: 'nonexistent' }, ctx as any)).rejects.toThrow('not found');
    });

    it('should reject deletion when dependent weight overrides exist', async () => {
      const ctx = createMockContext();
      (ctx.pool.query as jest.Mock).mockResolvedValueOnce({ rows: [{ count: '3' }] }); // dep check
      await expect(Mutation.Mutation.deleteSignalDefinition({}, { id: 'signal-with-deps' }, ctx as any))
        .rejects.toThrow('active weight overrides');
    });
  });
});
