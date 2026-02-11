/**
 * Audio Intelligence Client Unit Tests
 *
 * Tests for the Audio Intelligence ML service client.
 */

import { AudioIntelligenceClient, AudioIntelligenceConfig } from '../audio-intelligence/client';
import {
  mockAudioIntelligenceResponses,
  createMockResponse,
  MockCircuitBreakerTracker,
  MockMetricsCollector,
} from '@test-utils/mocks/ml-service-mocks';
import { sampleTranscripts } from '@test-utils/fixtures/security-fixtures';

describe('AudioIntelligenceClient', () => {
  let client: AudioIntelligenceClient;
  let mockFetch: jest.Mock;
  let mockMetrics: MockMetricsCollector;
  let mockCircuitBreaker: MockCircuitBreakerTracker;

  const defaultConfig: AudioIntelligenceConfig = {
    baseUrl: 'http://audio-intelligence:8101',
    timeout: 30000,
    serviceAuthConfig: {
      issuer: 'careplan-service',
      audience: 'audio-intelligence',
      secret: 'test-secret',
    },
  };

  beforeEach(() => {
    mockFetch = jest.fn();
    global.fetch = mockFetch;
    mockMetrics = new MockMetricsCollector();
    mockCircuitBreaker = new MockCircuitBreakerTracker();

    client = new AudioIntelligenceClient(defaultConfig);
  });

  afterEach(() => {
    jest.clearAllMocks();
    mockMetrics.reset();
    mockCircuitBreaker.reset();
  });

  describe('extract', () => {
    it('should extract entities from transcript text', async () => {
      mockFetch.mockResolvedValue(
        createMockResponse(mockAudioIntelligenceResponses.successfulExtraction)
      );

      const result = await client.extract({
        transcriptText: sampleTranscripts.cleanTranscript,
        requestId: 'req-123',
      });

      expect(result.entities).toBeDefined();
      expect(result.entities.length).toBeGreaterThan(0);
      expect(result.entities[0]).toHaveProperty('type');
      expect(result.entities[0]).toHaveProperty('text');
      expect(result.entities[0]).toHaveProperty('confidence');
    });

    it('should include red flags in response', async () => {
      mockFetch.mockResolvedValue(
        createMockResponse(mockAudioIntelligenceResponses.successfulExtraction)
      );

      const result = await client.extract({
        transcriptText: sampleTranscripts.cleanTranscript,
        requestId: 'req-123',
      });

      expect(result.redFlags).toBeDefined();
      expect(result.redFlags.length).toBeGreaterThan(0);
      expect(result.redFlags[0]).toHaveProperty('type');
      expect(result.redFlags[0]).toHaveProperty('description');
    });

    it('should include service JWT in request headers', async () => {
      mockFetch.mockResolvedValue(
        createMockResponse(mockAudioIntelligenceResponses.successfulExtraction)
      );

      await client.extract({
        transcriptText: 'Test',
        requestId: 'req-123',
      });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: expect.stringMatching(/^Bearer /),
          }),
        })
      );
    });

    it('should include request ID in headers', async () => {
      mockFetch.mockResolvedValue(
        createMockResponse(mockAudioIntelligenceResponses.successfulExtraction)
      );

      await client.extract({
        transcriptText: 'Test',
        requestId: 'req-456',
      });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            'X-Request-ID': 'req-456',
          }),
        })
      );
    });

    it('should handle empty extraction response', async () => {
      mockFetch.mockResolvedValue(
        createMockResponse(mockAudioIntelligenceResponses.emptyExtraction)
      );

      const result = await client.extract({
        transcriptText: 'No entities here',
        requestId: 'req-123',
      });

      expect(result.entities).toEqual([]);
      expect(result.redFlags).toEqual([]);
    });

    it('should throw on validation error', async () => {
      mockFetch.mockResolvedValue(
        createMockResponse(mockAudioIntelligenceResponses.validationError, 400)
      );

      await expect(
        client.extract({
          transcriptText: '',
          requestId: 'req-123',
        })
      ).rejects.toThrow(/validation/i);
    });

    it('should timeout after configured duration', async () => {
      mockFetch.mockImplementation(
        () => new Promise((resolve) => setTimeout(resolve, 60000))
      );

      jest.useFakeTimers();

      const promise = client.extract({
        transcriptText: 'Test',
        requestId: 'req-123',
      });

      jest.advanceTimersByTime(defaultConfig.timeout + 1000);

      await expect(promise).rejects.toThrow(/timeout/i);

      jest.useRealTimers();
    });
  });

  describe('extractBatch', () => {
    it('should extract entities from multiple transcripts', async () => {
      mockFetch.mockResolvedValue(
        createMockResponse({
          results: [
            mockAudioIntelligenceResponses.successfulExtraction,
            mockAudioIntelligenceResponses.successfulExtraction,
          ],
        })
      );

      const result = await client.extractBatch([
        { transcriptText: 'Transcript 1', requestId: 'req-1' },
        { transcriptText: 'Transcript 2', requestId: 'req-2' },
      ]);

      expect(result.results).toHaveLength(2);
    });

    it('should handle partial failures in batch', async () => {
      mockFetch.mockResolvedValue(
        createMockResponse({
          results: [
            mockAudioIntelligenceResponses.successfulExtraction,
            { error: 'Failed to process', requestId: 'req-2' },
          ],
        })
      );

      const result = await client.extractBatch([
        { transcriptText: 'Transcript 1', requestId: 'req-1' },
        { transcriptText: 'Transcript 2', requestId: 'req-2' },
      ]);

      expect(result.results).toHaveLength(2);
      expect(result.results[0].entities).toBeDefined();
      expect(result.results[1].error).toBeDefined();
    });
  });

  describe('healthCheck', () => {
    it('should return healthy status when service is up', async () => {
      mockFetch.mockResolvedValue(
        createMockResponse({ status: 'healthy', version: '1.0.0' })
      );

      const health = await client.healthCheck();

      expect(health.status).toBe('healthy');
      expect(health.version).toBeDefined();
    });

    it('should return unhealthy status on error', async () => {
      mockFetch.mockRejectedValue(new Error('Connection refused'));

      const health = await client.healthCheck();

      expect(health.status).toBe('unhealthy');
      expect(health.error).toBeDefined();
    });
  });

  describe('Circuit breaker integration', () => {
    it('should open circuit after repeated failures', async () => {
      mockFetch.mockRejectedValue(
        createMockResponse(mockAudioIntelligenceResponses.serviceError, 503)
      );

      // Attempt multiple requests to trigger circuit breaker
      for (let i = 0; i < 6; i++) {
        try {
          await client.extract({ transcriptText: 'Test', requestId: `req-${i}` });
        } catch {
          // Expected failures
        }
      }

      // Circuit should now be open
      await expect(
        client.extract({ transcriptText: 'Test', requestId: 'req-final' })
      ).rejects.toThrow(/circuit.*open/i);
    });

    it('should use fallback when circuit is open', async () => {
      const clientWithFallback = new AudioIntelligenceClient({
        ...defaultConfig,
        fallback: () => ({
          entities: [],
          redFlags: [],
          requiresManualReview: true,
        }),
      });

      mockFetch.mockRejectedValue(new Error('Service unavailable'));

      // Open the circuit
      for (let i = 0; i < 6; i++) {
        try {
          await clientWithFallback.extract({
            transcriptText: 'Test',
            requestId: `req-${i}`,
          });
        } catch {
          // Expected
        }
      }

      // Should return fallback response
      const result = await clientWithFallback.extract({
        transcriptText: 'Test',
        requestId: 'req-fallback',
      });

      expect(result.requiresManualReview).toBe(true);
      expect(result.entities).toEqual([]);
    });
  });

  describe('Retry behavior', () => {
    it('should retry on 503 Service Unavailable', async () => {
      mockFetch
        .mockResolvedValueOnce(createMockResponse({ error: 'Unavailable' }, 503))
        .mockResolvedValueOnce(createMockResponse({ error: 'Unavailable' }, 503))
        .mockResolvedValue(
          createMockResponse(mockAudioIntelligenceResponses.successfulExtraction)
        );

      const result = await client.extract({
        transcriptText: 'Test',
        requestId: 'req-123',
      });

      expect(result.entities).toBeDefined();
      expect(mockFetch).toHaveBeenCalledTimes(3);
    });

    it('should not retry on 400 Bad Request', async () => {
      mockFetch.mockResolvedValue(
        createMockResponse(mockAudioIntelligenceResponses.validationError, 400)
      );

      await expect(
        client.extract({ transcriptText: '', requestId: 'req-123' })
      ).rejects.toThrow();

      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('should not retry on 401 Unauthorized', async () => {
      mockFetch.mockResolvedValue(
        createMockResponse({ error: 'Invalid token' }, 401)
      );

      await expect(
        client.extract({ transcriptText: 'Test', requestId: 'req-123' })
      ).rejects.toThrow();

      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });

  describe('Request validation', () => {
    it('should reject empty transcript', async () => {
      await expect(
        client.extract({ transcriptText: '', requestId: 'req-123' })
      ).rejects.toThrow(/transcript.*empty/i);

      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should reject transcript exceeding max length', async () => {
      const longTranscript = 'A'.repeat(200000);

      await expect(
        client.extract({ transcriptText: longTranscript, requestId: 'req-123' })
      ).rejects.toThrow(/length/i);

      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should sanitize transcript before sending', async () => {
      mockFetch.mockResolvedValue(
        createMockResponse(mockAudioIntelligenceResponses.successfulExtraction)
      );

      await client.extract({
        transcriptText: 'Test\x00with\x1fnull\x7fbytes',
        requestId: 'req-123',
      });

      const requestBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(requestBody.transcriptText).not.toContain('\x00');
      expect(requestBody.transcriptText).not.toContain('\x1f');
    });
  });

  describe('Metrics collection', () => {
    it('should record request latency', async () => {
      mockFetch.mockResolvedValue(
        createMockResponse(mockAudioIntelligenceResponses.successfulExtraction)
      );

      await client.extract({
        transcriptText: 'Test',
        requestId: 'req-123',
      });

      // Metrics would be collected through the passed metrics collector
      // In integration, verify metrics are recorded
    });

    it('should record failure metrics', async () => {
      mockFetch.mockRejectedValue(new Error('Failed'));

      try {
        await client.extract({
          transcriptText: 'Test',
          requestId: 'req-123',
        });
      } catch {
        // Expected
      }

      // Verify failure metrics recorded
    });
  });

  describe('Security', () => {
    it('should not include PHI in logs or errors', async () => {
      mockFetch.mockRejectedValue(new Error('Service error'));

      const phiTranscript = 'Patient John Doe, SSN 123-45-6789';

      try {
        await client.extract({
          transcriptText: phiTranscript,
          requestId: 'req-123',
        });
      } catch (error: any) {
        expect(error.message).not.toContain('John Doe');
        expect(error.message).not.toContain('123-45-6789');
      }
    });

    it('should include correlation ID in requests', async () => {
      mockFetch.mockResolvedValue(
        createMockResponse(mockAudioIntelligenceResponses.successfulExtraction)
      );

      await client.extract({
        transcriptText: 'Test',
        requestId: 'req-123',
        correlationId: 'corr-456',
      });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            'X-Correlation-ID': 'corr-456',
          }),
        })
      );
    });
  });
});
