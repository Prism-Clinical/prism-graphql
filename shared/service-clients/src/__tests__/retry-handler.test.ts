/**
 * Retry Handler Unit Tests
 *
 * Tests for exponential backoff retry logic with jitter.
 */

import { RetryHandler, RetryConfig, RetryableError } from '../common/retry-handler';

describe('RetryHandler', () => {
  let retryHandler: RetryHandler;

  const defaultConfig: RetryConfig = {
    maxRetries: 3,
    baseDelayMs: 100,
    maxDelayMs: 5000,
    backoffMultiplier: 2,
    jitterFactor: 0.2,
    retryableStatusCodes: [500, 502, 503, 504],
    retryableErrors: ['ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND'],
  };

  beforeEach(() => {
    jest.useFakeTimers();
    retryHandler = new RetryHandler(defaultConfig);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('execute', () => {
    it('should execute action successfully on first try', async () => {
      const action = jest.fn().mockResolvedValue('success');

      const promise = retryHandler.execute(action);
      jest.runAllTimers();
      const result = await promise;

      expect(result).toBe('success');
      expect(action).toHaveBeenCalledTimes(1);
    });

    it('should retry on retryable error', async () => {
      const action = jest.fn()
        .mockRejectedValueOnce(new RetryableError('Temporary error', 503))
        .mockResolvedValue('success');

      const promise = retryHandler.execute(action);

      // Advance through the retry delay
      await jest.runAllTimersAsync();

      const result = await promise;

      expect(result).toBe('success');
      expect(action).toHaveBeenCalledTimes(2);
    });

    it('should retry up to max retries', async () => {
      const action = jest.fn().mockRejectedValue(new RetryableError('Always fails', 503));

      const promise = retryHandler.execute(action);

      // Advance through all retry delays
      await jest.runAllTimersAsync();

      await expect(promise).rejects.toThrow('Always fails');
      expect(action).toHaveBeenCalledTimes(defaultConfig.maxRetries + 1); // Initial + retries
    });

    it('should not retry on non-retryable error', async () => {
      const action = jest.fn().mockRejectedValue(new Error('Non-retryable'));

      await expect(retryHandler.execute(action)).rejects.toThrow('Non-retryable');
      expect(action).toHaveBeenCalledTimes(1);
    });

    it('should not retry on 4xx status codes', async () => {
      const action = jest.fn().mockRejectedValue(new RetryableError('Bad request', 400));

      await expect(retryHandler.execute(action)).rejects.toThrow('Bad request');
      expect(action).toHaveBeenCalledTimes(1);
    });
  });

  describe('Exponential backoff', () => {
    it('should increase delay exponentially', async () => {
      const delays: number[] = [];

      const action = jest.fn().mockImplementation(() => {
        return Promise.reject(new RetryableError('fail', 503));
      });

      const originalSetTimeout = setTimeout;
      jest.spyOn(global, 'setTimeout').mockImplementation((fn, delay) => {
        if (delay && delay > 10) {
          delays.push(delay as number);
        }
        return originalSetTimeout(fn, 0);
      });

      try {
        await retryHandler.execute(action);
      } catch {
        // Expected to fail
      }

      // Verify exponential increase (with jitter, values will vary)
      expect(delays.length).toBe(defaultConfig.maxRetries);
      for (let i = 1; i < delays.length; i++) {
        // Each delay should be roughly 2x the previous (within jitter variance)
        expect(delays[i]).toBeGreaterThan(delays[i - 1]);
      }
    });

    it('should cap delay at maxDelayMs', async () => {
      const handler = new RetryHandler({
        ...defaultConfig,
        maxRetries: 10,
        baseDelayMs: 1000,
        maxDelayMs: 5000,
      });

      const delays: number[] = [];

      jest.spyOn(global, 'setTimeout').mockImplementation((fn, delay) => {
        if (delay && delay > 10) {
          delays.push(delay as number);
        }
        return setTimeout(fn, 0);
      });

      const action = jest.fn().mockRejectedValue(new RetryableError('fail', 503));

      try {
        await handler.execute(action);
      } catch {
        // Expected
      }

      // No delay should exceed maxDelayMs (plus jitter factor)
      const maxWithJitter = 5000 * (1 + defaultConfig.jitterFactor);
      delays.forEach((delay) => {
        expect(delay).toBeLessThanOrEqual(maxWithJitter);
      });
    });
  });

  describe('Jitter', () => {
    it('should apply jitter to delays', async () => {
      const handler = new RetryHandler({
        ...defaultConfig,
        jitterFactor: 0.5, // 50% jitter
      });

      const delays: number[] = [];

      jest.spyOn(global, 'setTimeout').mockImplementation((fn, delay) => {
        if (delay && delay > 10) {
          delays.push(delay as number);
        }
        return setTimeout(fn, 0);
      });

      // Run multiple times to get a distribution
      for (let run = 0; run < 5; run++) {
        const action = jest.fn().mockRejectedValue(new RetryableError('fail', 503));
        try {
          await handler.execute(action);
        } catch {
          // Expected
        }
      }

      // With 50% jitter, delays should vary significantly
      const uniqueDelays = new Set(delays);
      expect(uniqueDelays.size).toBeGreaterThan(1);
    });

    it('should prevent thundering herd with jitter', async () => {
      const handler = new RetryHandler({
        ...defaultConfig,
        jitterFactor: 0.3,
      });

      const allDelays: number[][] = [];

      // Simulate multiple clients
      for (let client = 0; client < 5; client++) {
        const clientDelays: number[] = [];

        jest.spyOn(global, 'setTimeout').mockImplementation((fn, delay) => {
          if (delay && delay > 10) {
            clientDelays.push(delay as number);
          }
          return setTimeout(fn, 0);
        });

        const action = jest.fn().mockRejectedValue(new RetryableError('fail', 503));
        try {
          await handler.execute(action);
        } catch {
          // Expected
        }

        allDelays.push(clientDelays);
      }

      // Delays should differ between clients (preventing simultaneous retries)
      const firstRetryDelays = allDelays.map((d) => d[0]);
      const uniqueFirstDelays = new Set(firstRetryDelays);
      expect(uniqueFirstDelays.size).toBeGreaterThan(1);
    });
  });

  describe('Retryable errors', () => {
    it('should identify retryable status codes', () => {
      expect(retryHandler.isRetryable(new RetryableError('Server error', 500))).toBe(true);
      expect(retryHandler.isRetryable(new RetryableError('Bad gateway', 502))).toBe(true);
      expect(retryHandler.isRetryable(new RetryableError('Unavailable', 503))).toBe(true);
      expect(retryHandler.isRetryable(new RetryableError('Timeout', 504))).toBe(true);
    });

    it('should identify non-retryable status codes', () => {
      expect(retryHandler.isRetryable(new RetryableError('Bad request', 400))).toBe(false);
      expect(retryHandler.isRetryable(new RetryableError('Unauthorized', 401))).toBe(false);
      expect(retryHandler.isRetryable(new RetryableError('Forbidden', 403))).toBe(false);
      expect(retryHandler.isRetryable(new RetryableError('Not found', 404))).toBe(false);
    });

    it('should identify retryable network errors', () => {
      const connReset = new Error('Connection reset');
      (connReset as any).code = 'ECONNRESET';
      expect(retryHandler.isRetryable(connReset)).toBe(true);

      const timeout = new Error('Timeout');
      (timeout as any).code = 'ETIMEDOUT';
      expect(retryHandler.isRetryable(timeout)).toBe(true);

      const notFound = new Error('DNS not found');
      (notFound as any).code = 'ENOTFOUND';
      expect(retryHandler.isRetryable(notFound)).toBe(true);
    });

    it('should not retry generic errors', () => {
      expect(retryHandler.isRetryable(new Error('Generic error'))).toBe(false);
      expect(retryHandler.isRetryable(new TypeError('Type error'))).toBe(false);
    });
  });

  describe('Retry context', () => {
    it('should provide retry context to action', async () => {
      const contexts: any[] = [];

      const action = jest.fn().mockImplementation((context) => {
        contexts.push({ ...context });
        if (context.attempt < 2) {
          return Promise.reject(new RetryableError('fail', 503));
        }
        return Promise.resolve('success');
      });

      const promise = retryHandler.execute(action);
      await jest.runAllTimersAsync();
      await promise;

      expect(contexts).toHaveLength(3);
      expect(contexts[0].attempt).toBe(0);
      expect(contexts[1].attempt).toBe(1);
      expect(contexts[2].attempt).toBe(2);
    });

    it('should include elapsed time in context', async () => {
      const contexts: any[] = [];

      const action = jest.fn().mockImplementation((context) => {
        contexts.push({ ...context });
        if (context.attempt < 1) {
          return Promise.reject(new RetryableError('fail', 503));
        }
        return Promise.resolve('success');
      });

      const startTime = Date.now();
      jest.spyOn(Date, 'now').mockReturnValue(startTime);

      const promise = retryHandler.execute(action);

      // Simulate time passing
      jest.spyOn(Date, 'now').mockReturnValue(startTime + 200);
      await jest.runAllTimersAsync();

      await promise;

      expect(contexts[1].elapsedMs).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Abort handling', () => {
    it('should abort retries when signal is aborted', async () => {
      const controller = new AbortController();

      const action = jest.fn().mockRejectedValue(new RetryableError('fail', 503));

      const promise = retryHandler.execute(action, { signal: controller.signal });

      // Abort after first attempt
      action.mockImplementationOnce(() => {
        controller.abort();
        return Promise.reject(new RetryableError('fail', 503));
      });

      await expect(promise).rejects.toThrow('Aborted');
      expect(action).toHaveBeenCalledTimes(1);
    });

    it('should not start retry if already aborted', async () => {
      const controller = new AbortController();
      controller.abort();

      const action = jest.fn().mockResolvedValue('success');

      await expect(
        retryHandler.execute(action, { signal: controller.signal })
      ).rejects.toThrow('Aborted');

      expect(action).not.toHaveBeenCalled();
    });
  });

  describe('Callbacks', () => {
    it('should call onRetry callback before each retry', async () => {
      const onRetry = jest.fn();

      const action = jest.fn()
        .mockRejectedValueOnce(new RetryableError('fail', 503))
        .mockRejectedValueOnce(new RetryableError('fail', 503))
        .mockResolvedValue('success');

      const promise = retryHandler.execute(action, { onRetry });
      await jest.runAllTimersAsync();
      await promise;

      expect(onRetry).toHaveBeenCalledTimes(2);
      expect(onRetry).toHaveBeenCalledWith(
        expect.objectContaining({
          attempt: expect.any(Number),
          error: expect.any(Error),
          nextDelayMs: expect.any(Number),
        })
      );
    });

    it('should call onGiveUp callback when retries exhausted', async () => {
      const onGiveUp = jest.fn();

      const action = jest.fn().mockRejectedValue(new RetryableError('fail', 503));

      const promise = retryHandler.execute(action, { onGiveUp });
      await jest.runAllTimersAsync();

      try {
        await promise;
      } catch {
        // Expected
      }

      expect(onGiveUp).toHaveBeenCalledWith(
        expect.objectContaining({
          totalAttempts: defaultConfig.maxRetries + 1,
          error: expect.any(Error),
        })
      );
    });
  });

  describe('Custom retry conditions', () => {
    it('should support custom shouldRetry function', async () => {
      const handler = new RetryHandler({
        ...defaultConfig,
        shouldRetry: (error) => error.message.includes('temporary'),
      });

      const tempError = jest.fn()
        .mockRejectedValueOnce(new Error('temporary failure'))
        .mockResolvedValue('success');

      const permError = jest.fn().mockRejectedValue(new Error('permanent failure'));

      const promise1 = handler.execute(tempError);
      await jest.runAllTimersAsync();
      await expect(promise1).resolves.toBe('success');

      await expect(handler.execute(permError)).rejects.toThrow('permanent failure');
      expect(permError).toHaveBeenCalledTimes(1);
    });
  });

  describe('Statistics', () => {
    it('should track retry statistics', async () => {
      const action = jest.fn()
        .mockRejectedValueOnce(new RetryableError('fail', 503))
        .mockResolvedValue('success');

      const promise = retryHandler.execute(action);
      await jest.runAllTimersAsync();
      await promise;

      const stats = retryHandler.getStatistics();

      expect(stats.totalAttempts).toBeGreaterThan(0);
      expect(stats.successfulAttempts).toBe(1);
      expect(stats.failedAttempts).toBeGreaterThan(0);
      expect(stats.totalRetries).toBe(1);
    });
  });
});
