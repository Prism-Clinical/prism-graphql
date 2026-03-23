import { ScorerRegistry } from '../services/confidence/scorer-registry';
import {
  ScoringType,
  SignalScorer,
} from '../services/confidence/types';

// Minimal mock scorer for testing registry behavior
function createMockScorer(type: ScoringType): SignalScorer {
  return {
    scoringType: type,
    declareRequiredInputs: jest.fn().mockReturnValue([]),
    score: jest.fn().mockReturnValue({ score: 0.5, missingInputs: [] }),
  };
}

describe('ScorerRegistry', () => {
  let registry: ScorerRegistry;

  beforeEach(() => {
    registry = new ScorerRegistry();
  });

  describe('register', () => {
    it('should register a scorer and make it retrievable', () => {
      const scorer = createMockScorer(ScoringType.DATA_PRESENCE);
      registry.register(scorer);
      expect(registry.get(ScoringType.DATA_PRESENCE)).toBe(scorer);
    });

    it('should overwrite existing scorer for same type', () => {
      const scorer1 = createMockScorer(ScoringType.DATA_PRESENCE);
      const scorer2 = createMockScorer(ScoringType.DATA_PRESENCE);
      registry.register(scorer1);
      registry.register(scorer2);
      expect(registry.get(ScoringType.DATA_PRESENCE)).toBe(scorer2);
    });
  });

  describe('get', () => {
    it('should return undefined for unregistered type', () => {
      expect(registry.get(ScoringType.RISK_INVERSE)).toBeUndefined();
    });
  });

  describe('has', () => {
    it('should return true for registered type', () => {
      registry.register(createMockScorer(ScoringType.MAPPING_LOOKUP));
      expect(registry.has(ScoringType.MAPPING_LOOKUP)).toBe(true);
    });

    it('should return false for unregistered type', () => {
      expect(registry.has(ScoringType.MAPPING_LOOKUP)).toBe(false);
    });
  });

  describe('loadCustomSignals', () => {
    it('should return count of custom signal definitions', async () => {
      const mockPool = {
        query: jest.fn().mockResolvedValue({
          rows: [{ count: '2' }],
        }),
      };

      const count = await registry.loadCustomSignals(mockPool as any, 'inst-1');
      expect(count).toBe(2);
    });

    it('should return 0 when no custom signals exist', async () => {
      const mockPool = {
        query: jest.fn().mockResolvedValue({
          rows: [{ count: '0' }],
        }),
      };

      const count = await registry.loadCustomSignals(mockPool as any, 'inst-1');
      expect(count).toBe(0);
    });

    it('should filter by SYSTEM scope when no institutionId provided', async () => {
      const mockPool = {
        query: jest.fn().mockResolvedValue({
          rows: [{ count: '5' }],
        }),
      };

      const count = await registry.loadCustomSignals(mockPool as any);
      expect(count).toBe(5);
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining("scope = 'SYSTEM'"),
        []
      );
    });

    it('should pass institutionId as parameter when provided', async () => {
      const mockPool = {
        query: jest.fn().mockResolvedValue({
          rows: [{ count: '2' }],
        }),
      };

      await registry.loadCustomSignals(mockPool as any, 'inst-123');
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('institution_id = $1'),
        ['inst-123']
      );
    });
  });
});
