import { detectCycle, enforceTimeout, checkMissingCriticalData, isCascadeLimitReached, TraversalTimeoutError } from '../services/resolution/safety';

describe('Safety', () => {
  describe('detectCycle', () => {
    it('should detect a cycle in the evaluation stack', () => {
      const stack = new Set(['node-a', 'node-b']);
      expect(detectCycle('node-a', stack)).toBe(true);
    });

    it('should not flag non-cycle', () => {
      const stack = new Set(['node-a', 'node-b']);
      expect(detectCycle('node-c', stack)).toBe(false);
    });
  });

  describe('enforceTimeout', () => {
    it('should not throw before timeout', () => {
      const startTime = Date.now();
      expect(() => enforceTimeout(startTime, 10_000)).not.toThrow();
    });

    it('should throw after timeout', () => {
      const startTime = Date.now() - 11_000;
      expect(() => enforceTimeout(startTime, 10_000)).toThrow(TraversalTimeoutError);
    });
  });

  describe('checkMissingCriticalData', () => {
    it('should return red flag for critical node with 0 data presence score', () => {
      const node = {
        id: '1',
        nodeIdentifier: 'med-critical',
        nodeType: 'Medication',
        properties: { title: 'Critical med', critical: true },
      };
      const breakdown = [{ signalName: 'data_completeness', score: 0, weight: 1, weightSource: 'SYSTEM_DEFAULT' as const, missingInputs: ['lab_results'] }];
      const flags = checkMissingCriticalData(node, breakdown);
      expect(flags.length).toBe(1);
      expect(flags[0].type).toBe('missing_critical_data');
    });

    it('should not flag non-critical nodes', () => {
      const node = {
        id: '2',
        nodeIdentifier: 'med-normal',
        nodeType: 'Medication',
        properties: { title: 'Normal med' },
      };
      const breakdown = [{ signalName: 'data_completeness', score: 0, weight: 1, weightSource: 'SYSTEM_DEFAULT' as const, missingInputs: ['lab_results'] }];
      const flags = checkMissingCriticalData(node, breakdown);
      expect(flags.length).toBe(0);
    });

    it('should not flag critical node with non-zero data score', () => {
      const node = {
        id: '3',
        nodeIdentifier: 'med-ok',
        nodeType: 'Medication',
        properties: { title: 'OK med', critical: true },
      };
      const breakdown = [{ signalName: 'data_completeness', score: 0.5, weight: 1, weightSource: 'SYSTEM_DEFAULT' as const, missingInputs: [] }];
      const flags = checkMissingCriticalData(node, breakdown);
      expect(flags.length).toBe(0);
    });
  });

  describe('isCascadeLimitReached', () => {
    it('should return true at max depth', () => {
      expect(isCascadeLimitReached(10)).toBe(true);
    });

    it('should return false below max depth', () => {
      expect(isCascadeLimitReached(5)).toBe(false);
    });
  });
});
