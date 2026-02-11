/**
 * Circuit Breaker Unit Tests
 *
 * Tests for circuit breaker pattern implementation.
 */

import { CircuitBreaker, CircuitBreakerState, CircuitBreakerConfig } from '../common/circuit-breaker';

describe('CircuitBreaker', () => {
  let circuitBreaker: CircuitBreaker;

  const defaultConfig: CircuitBreakerConfig = {
    failureThreshold: 5,
    failureWindow: 60000, // 60 seconds
    resetTimeout: 30000, // 30 seconds
    halfOpenRequests: 3,
    serviceName: 'test-service',
  };

  beforeEach(() => {
    jest.useFakeTimers();
    circuitBreaker = new CircuitBreaker(defaultConfig);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('Initial state', () => {
    it('should start in CLOSED state', () => {
      expect(circuitBreaker.getState()).toBe(CircuitBreakerState.CLOSED);
    });

    it('should allow requests initially', () => {
      expect(circuitBreaker.isRequestAllowed()).toBe(true);
    });

    it('should have zero failure count initially', () => {
      expect(circuitBreaker.getFailureCount()).toBe(0);
    });
  });

  describe('Failure tracking', () => {
    it('should track failures', () => {
      circuitBreaker.recordFailure();

      expect(circuitBreaker.getFailureCount()).toBe(1);
    });

    it('should increment failure count on each failure', () => {
      circuitBreaker.recordFailure();
      circuitBreaker.recordFailure();
      circuitBreaker.recordFailure();

      expect(circuitBreaker.getFailureCount()).toBe(3);
    });

    it('should reset failure count on success', () => {
      circuitBreaker.recordFailure();
      circuitBreaker.recordFailure();
      circuitBreaker.recordSuccess();

      expect(circuitBreaker.getFailureCount()).toBe(0);
    });

    it('should expire old failures outside the window', () => {
      circuitBreaker.recordFailure();
      circuitBreaker.recordFailure();

      // Advance time past the failure window
      jest.advanceTimersByTime(defaultConfig.failureWindow + 1000);

      // Record another failure to trigger cleanup
      circuitBreaker.recordFailure();

      // Old failures should be expired, only new one counted
      expect(circuitBreaker.getFailureCount()).toBe(1);
    });
  });

  describe('State transitions', () => {
    describe('CLOSED -> OPEN', () => {
      it('should open circuit after reaching failure threshold', () => {
        for (let i = 0; i < defaultConfig.failureThreshold; i++) {
          circuitBreaker.recordFailure();
        }

        expect(circuitBreaker.getState()).toBe(CircuitBreakerState.OPEN);
      });

      it('should block requests when OPEN', () => {
        // Open the circuit
        for (let i = 0; i < defaultConfig.failureThreshold; i++) {
          circuitBreaker.recordFailure();
        }

        expect(circuitBreaker.isRequestAllowed()).toBe(false);
      });
    });

    describe('OPEN -> HALF_OPEN', () => {
      it('should transition to HALF_OPEN after reset timeout', () => {
        // Open the circuit
        for (let i = 0; i < defaultConfig.failureThreshold; i++) {
          circuitBreaker.recordFailure();
        }

        expect(circuitBreaker.getState()).toBe(CircuitBreakerState.OPEN);

        // Advance time past reset timeout
        jest.advanceTimersByTime(defaultConfig.resetTimeout + 1000);

        // Check if request is allowed (triggers state check)
        circuitBreaker.isRequestAllowed();

        expect(circuitBreaker.getState()).toBe(CircuitBreakerState.HALF_OPEN);
      });

      it('should allow limited requests in HALF_OPEN state', () => {
        // Open the circuit
        for (let i = 0; i < defaultConfig.failureThreshold; i++) {
          circuitBreaker.recordFailure();
        }

        // Transition to HALF_OPEN
        jest.advanceTimersByTime(defaultConfig.resetTimeout + 1000);
        circuitBreaker.isRequestAllowed();

        // Should allow up to halfOpenRequests
        let allowedCount = 0;
        for (let i = 0; i < defaultConfig.halfOpenRequests + 2; i++) {
          if (circuitBreaker.isRequestAllowed()) {
            allowedCount++;
          }
        }

        expect(allowedCount).toBe(defaultConfig.halfOpenRequests);
      });
    });

    describe('HALF_OPEN -> CLOSED', () => {
      it('should close circuit after successful request in HALF_OPEN', () => {
        // Open the circuit
        for (let i = 0; i < defaultConfig.failureThreshold; i++) {
          circuitBreaker.recordFailure();
        }

        // Transition to HALF_OPEN
        jest.advanceTimersByTime(defaultConfig.resetTimeout + 1000);
        circuitBreaker.isRequestAllowed();

        // Record successful request
        circuitBreaker.recordSuccess();

        expect(circuitBreaker.getState()).toBe(CircuitBreakerState.CLOSED);
      });

      it('should reset failure count when closing', () => {
        // Open the circuit
        for (let i = 0; i < defaultConfig.failureThreshold; i++) {
          circuitBreaker.recordFailure();
        }

        // Transition to HALF_OPEN and close
        jest.advanceTimersByTime(defaultConfig.resetTimeout + 1000);
        circuitBreaker.isRequestAllowed();
        circuitBreaker.recordSuccess();

        expect(circuitBreaker.getFailureCount()).toBe(0);
      });
    });

    describe('HALF_OPEN -> OPEN', () => {
      it('should re-open circuit on failure in HALF_OPEN', () => {
        // Open the circuit
        for (let i = 0; i < defaultConfig.failureThreshold; i++) {
          circuitBreaker.recordFailure();
        }

        // Transition to HALF_OPEN
        jest.advanceTimersByTime(defaultConfig.resetTimeout + 1000);
        circuitBreaker.isRequestAllowed();

        // Record failure in HALF_OPEN
        circuitBreaker.recordFailure();

        expect(circuitBreaker.getState()).toBe(CircuitBreakerState.OPEN);
      });

      it('should reset the timeout when re-opening', () => {
        // Open the circuit
        for (let i = 0; i < defaultConfig.failureThreshold; i++) {
          circuitBreaker.recordFailure();
        }

        // Transition to HALF_OPEN
        jest.advanceTimersByTime(defaultConfig.resetTimeout + 1000);
        circuitBreaker.isRequestAllowed();

        // Record failure to re-open
        circuitBreaker.recordFailure();

        // Should need to wait full reset timeout again
        jest.advanceTimersByTime(defaultConfig.resetTimeout - 1000);
        circuitBreaker.isRequestAllowed();

        expect(circuitBreaker.getState()).toBe(CircuitBreakerState.OPEN);
      });
    });
  });

  describe('execute', () => {
    it('should execute action when circuit is CLOSED', async () => {
      const action = jest.fn().mockResolvedValue('success');

      const result = await circuitBreaker.execute(action);

      expect(action).toHaveBeenCalled();
      expect(result).toBe('success');
    });

    it('should record success on successful execution', async () => {
      const action = jest.fn().mockResolvedValue('success');

      await circuitBreaker.execute(action);

      expect(circuitBreaker.getFailureCount()).toBe(0);
    });

    it('should record failure on failed execution', async () => {
      const action = jest.fn().mockRejectedValue(new Error('failed'));

      await expect(circuitBreaker.execute(action)).rejects.toThrow('failed');

      expect(circuitBreaker.getFailureCount()).toBe(1);
    });

    it('should throw CircuitOpenError when circuit is OPEN', async () => {
      // Open the circuit
      for (let i = 0; i < defaultConfig.failureThreshold; i++) {
        circuitBreaker.recordFailure();
      }

      const action = jest.fn();

      await expect(circuitBreaker.execute(action)).rejects.toThrow('Circuit breaker is OPEN');
      expect(action).not.toHaveBeenCalled();
    });

    it('should use fallback when circuit is OPEN', async () => {
      const fallback = jest.fn().mockResolvedValue('fallback');

      // Open the circuit
      for (let i = 0; i < defaultConfig.failureThreshold; i++) {
        circuitBreaker.recordFailure();
      }

      const action = jest.fn();

      const result = await circuitBreaker.execute(action, { fallback });

      expect(action).not.toHaveBeenCalled();
      expect(fallback).toHaveBeenCalled();
      expect(result).toBe('fallback');
    });
  });

  describe('Events', () => {
    it('should emit event when circuit opens', () => {
      const onOpen = jest.fn();
      circuitBreaker.on('open', onOpen);

      for (let i = 0; i < defaultConfig.failureThreshold; i++) {
        circuitBreaker.recordFailure();
      }

      expect(onOpen).toHaveBeenCalledWith({ serviceName: 'test-service' });
    });

    it('should emit event when circuit closes', () => {
      const onClose = jest.fn();
      circuitBreaker.on('close', onClose);

      // Open the circuit
      for (let i = 0; i < defaultConfig.failureThreshold; i++) {
        circuitBreaker.recordFailure();
      }

      // Transition to HALF_OPEN and close
      jest.advanceTimersByTime(defaultConfig.resetTimeout + 1000);
      circuitBreaker.isRequestAllowed();
      circuitBreaker.recordSuccess();

      expect(onClose).toHaveBeenCalledWith({ serviceName: 'test-service' });
    });

    it('should emit event when transitioning to half-open', () => {
      const onHalfOpen = jest.fn();
      circuitBreaker.on('halfOpen', onHalfOpen);

      // Open the circuit
      for (let i = 0; i < defaultConfig.failureThreshold; i++) {
        circuitBreaker.recordFailure();
      }

      // Transition to HALF_OPEN
      jest.advanceTimersByTime(defaultConfig.resetTimeout + 1000);
      circuitBreaker.isRequestAllowed();

      expect(onHalfOpen).toHaveBeenCalledWith({ serviceName: 'test-service' });
    });
  });

  describe('Statistics', () => {
    it('should track total requests', async () => {
      const action = jest.fn().mockResolvedValue('success');

      await circuitBreaker.execute(action);
      await circuitBreaker.execute(action);
      await circuitBreaker.execute(action);

      const stats = circuitBreaker.getStatistics();

      expect(stats.totalRequests).toBe(3);
    });

    it('should track successful requests', async () => {
      const successAction = jest.fn().mockResolvedValue('success');
      const failAction = jest.fn().mockRejectedValue(new Error('fail'));

      await circuitBreaker.execute(successAction);
      await circuitBreaker.execute(successAction);
      await expect(circuitBreaker.execute(failAction)).rejects.toThrow();

      const stats = circuitBreaker.getStatistics();

      expect(stats.successfulRequests).toBe(2);
      expect(stats.failedRequests).toBe(1);
    });

    it('should track circuit open events', () => {
      // Open the circuit multiple times
      for (let i = 0; i < defaultConfig.failureThreshold; i++) {
        circuitBreaker.recordFailure();
      }

      // Close it
      jest.advanceTimersByTime(defaultConfig.resetTimeout + 1000);
      circuitBreaker.isRequestAllowed();
      circuitBreaker.recordSuccess();

      // Open again
      for (let i = 0; i < defaultConfig.failureThreshold; i++) {
        circuitBreaker.recordFailure();
      }

      const stats = circuitBreaker.getStatistics();

      expect(stats.circuitOpenCount).toBe(2);
    });
  });

  describe('Edge cases', () => {
    it('should handle rapid successive failures', () => {
      for (let i = 0; i < 100; i++) {
        circuitBreaker.recordFailure();
      }

      expect(circuitBreaker.getState()).toBe(CircuitBreakerState.OPEN);
    });

    it('should handle mixed success/failure rapidly', async () => {
      const success = jest.fn().mockResolvedValue('ok');
      const fail = jest.fn().mockRejectedValue(new Error('fail'));

      // Alternate success and failure
      await circuitBreaker.execute(success);
      await expect(circuitBreaker.execute(fail)).rejects.toThrow();
      await circuitBreaker.execute(success);
      await expect(circuitBreaker.execute(fail)).rejects.toThrow();

      // Should still be closed (failures reset on success)
      expect(circuitBreaker.getState()).toBe(CircuitBreakerState.CLOSED);
    });

    it('should handle concurrent requests', async () => {
      const slowAction = jest.fn().mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve('ok'), 100))
      );

      // Start multiple concurrent requests
      const promises = Array.from({ length: 10 }, () =>
        circuitBreaker.execute(slowAction)
      );

      jest.advanceTimersByTime(100);

      const results = await Promise.all(promises);

      expect(results).toHaveLength(10);
      expect(slowAction).toHaveBeenCalledTimes(10);
    });
  });

  describe('Configuration validation', () => {
    it('should reject invalid failure threshold', () => {
      expect(() => {
        new CircuitBreaker({ ...defaultConfig, failureThreshold: 0 });
      }).toThrow();
    });

    it('should reject invalid reset timeout', () => {
      expect(() => {
        new CircuitBreaker({ ...defaultConfig, resetTimeout: -1 });
      }).toThrow();
    });

    it('should reject invalid half open requests', () => {
      expect(() => {
        new CircuitBreaker({ ...defaultConfig, halfOpenRequests: 0 });
      }).toThrow();
    });
  });
});
