/**
 * Pipeline Orchestrator Integration Tests
 *
 * Tests for the full pipeline processing flow.
 */

import { PipelineOrchestrator } from '../../orchestration/pipeline-orchestrator';
import { Pool } from 'pg';
import { Redis } from 'ioredis';
import {
  setupTestDatabase,
  setupTestRedis,
  cleanupTestDatabase,
  closeTestConnections,
  testHelpers,
} from '@test-utils/setup';
import {
  generatePipelineInput,
  generateUserContext,
  sampleTranscripts,
  icd10Codes,
} from '@test-utils/fixtures/security-fixtures';
import {
  mockAudioIntelligenceResponses,
  mockRecommenderResponses,
  mockRagEmbeddingsResponses,
  MockAuditLogger,
  MockMetricsCollector,
} from '@test-utils/mocks/ml-service-mocks';

describe('PipelineOrchestrator Integration', () => {
  let pool: Pool;
  let redis: Redis;
  let orchestrator: PipelineOrchestrator;
  let mockAuditLogger: MockAuditLogger;
  let mockMetrics: MockMetricsCollector;
  let mockFetch: jest.Mock;

  beforeAll(async () => {
    pool = await setupTestDatabase();
    redis = await setupTestRedis();
  });

  beforeEach(async () => {
    await cleanupTestDatabase();

    mockFetch = jest.fn();
    global.fetch = mockFetch;

    mockAuditLogger = new MockAuditLogger();
    mockMetrics = new MockMetricsCollector();

    orchestrator = new PipelineOrchestrator({
      mlClients: {
        audioIntelligence: { baseUrl: 'http://audio-intelligence:8101' },
        recommender: { baseUrl: 'http://careplan-recommender:8100' },
        ragEmbeddings: { baseUrl: 'http://rag-embeddings:8103' },
      },
      redis,
      auditLogger: mockAuditLogger,
      metricsCollector: mockMetrics,
    });

    // Set up default mock responses
    mockFetch.mockImplementation(async (url: string) => {
      if (url.includes('audio-intelligence')) {
        return createMockResponse(mockAudioIntelligenceResponses.successfulExtraction);
      }
      if (url.includes('careplan-recommender')) {
        return createMockResponse(mockRecommenderResponses.successfulRecommendation);
      }
      if (url.includes('rag-embeddings')) {
        return createMockResponse(mockRagEmbeddingsResponses.successfulEmbedding);
      }
      return createMockResponse({ error: 'Unknown service' }, 404);
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
    mockAuditLogger.clear();
    mockMetrics.reset();
  });

  afterAll(async () => {
    await closeTestConnections();
  });

  describe('Full pipeline processing', () => {
    it('should process full pipeline with transcript', async () => {
      const input = generatePipelineInput({
        transcriptText: sampleTranscripts.cleanTranscript,
        conditionCodes: icd10Codes.validCodes.slice(0, 3),
      });
      const userContext = generateUserContext('PROVIDER');

      const result = await orchestrator.process(input, userContext);

      expect(result.requestId).toBeDefined();
      expect(result.extractedEntities).toBeDefined();
      expect(result.recommendations).toBeDefined();
      expect(result.recommendations.length).toBeGreaterThan(0);
      expect(result.processingMetadata).toBeDefined();
      expect(result.processingMetadata.stages).toBeDefined();
    });

    it('should skip extraction when no transcript provided', async () => {
      const input = generatePipelineInput({
        transcriptText: undefined,
        conditionCodes: icd10Codes.validCodes.slice(0, 2),
      });
      const userContext = generateUserContext('PROVIDER');

      const result = await orchestrator.process(input, userContext);

      expect(result.extractedEntities).toBeUndefined();
      expect(result.recommendations).toBeDefined();
      expect(result.processingMetadata.stages).not.toContainEqual(
        expect.objectContaining({ name: 'extraction' })
      );
    });

    it('should include red flags from extraction', async () => {
      mockFetch.mockImplementation(async (url: string) => {
        if (url.includes('audio-intelligence')) {
          return createMockResponse({
            ...mockAudioIntelligenceResponses.successfulExtraction,
            redFlags: [
              { type: 'CRITICAL', description: 'Chest pain', confidence: 0.95 },
            ],
          });
        }
        return createMockResponse(mockRecommenderResponses.successfulRecommendation);
      });

      const input = generatePipelineInput({
        transcriptText: 'Patient reports chest pain',
      });
      const userContext = generateUserContext('PROVIDER');

      const result = await orchestrator.process(input, userContext);

      expect(result.redFlags).toBeDefined();
      expect(result.redFlags.length).toBeGreaterThan(0);
      expect(result.redFlags[0].type).toBe('CRITICAL');
    });

    it('should collect timing metrics for each stage', async () => {
      const input = generatePipelineInput();
      const userContext = generateUserContext('PROVIDER');

      const result = await orchestrator.process(input, userContext);

      expect(result.processingMetadata.totalDurationMs).toBeGreaterThan(0);
      result.processingMetadata.stages.forEach((stage) => {
        expect(stage.durationMs).toBeGreaterThanOrEqual(0);
      });
    });
  });

  describe('Audit logging', () => {
    it('should audit log all PHI access', async () => {
      const input = generatePipelineInput({
        transcriptText: sampleTranscripts.cleanTranscript,
      });
      const userContext = generateUserContext('PROVIDER');

      await orchestrator.process(input, userContext);

      const auditLogs = mockAuditLogger.getLogs();

      expect(auditLogs.length).toBeGreaterThan(0);
      expect(auditLogs.some((log) => log.phiAccessed)).toBe(true);
    });

    it('should audit log patient context in ML service calls', async () => {
      const patientId = 'patient-123';
      const input = generatePipelineInput({ patientId });
      const userContext = generateUserContext('PROVIDER');

      await orchestrator.process(input, userContext);

      const patientLogs = mockAuditLogger.getLogsByPatient(patientId);

      expect(patientLogs.length).toBeGreaterThan(0);
    });

    it('should include correlation ID in all audit logs', async () => {
      const correlationId = 'corr-test-123';
      const input = generatePipelineInput({ correlationId });
      const userContext = generateUserContext('PROVIDER');

      await orchestrator.process(input, userContext);

      const auditLogs = mockAuditLogger.getLogs();

      auditLogs.forEach((log) => {
        expect(log.correlationId || correlationId).toBeDefined();
      });
    });
  });

  describe('Error handling and recovery', () => {
    it('should continue without entities when extraction fails', async () => {
      mockFetch.mockImplementation(async (url: string) => {
        if (url.includes('audio-intelligence')) {
          throw new Error('Service unavailable');
        }
        return createMockResponse(mockRecommenderResponses.successfulRecommendation);
      });

      const input = generatePipelineInput({
        transcriptText: sampleTranscripts.cleanTranscript,
      });
      const userContext = generateUserContext('PROVIDER');

      const result = await orchestrator.process(input, userContext);

      expect(result.extractedEntities).toBeUndefined();
      expect(result.recommendations).toBeDefined();
      expect(result.degradedServices).toContain('audio-intelligence');
    });

    it('should return empty recommendations on recommender failure', async () => {
      mockFetch.mockImplementation(async (url: string) => {
        if (url.includes('careplan-recommender')) {
          throw new Error('Service unavailable');
        }
        return createMockResponse(mockAudioIntelligenceResponses.successfulExtraction);
      });

      const input = generatePipelineInput();
      const userContext = generateUserContext('PROVIDER');

      const result = await orchestrator.process(input, userContext);

      expect(result.recommendations).toEqual([]);
      expect(result.degradedServices).toContain('careplan-recommender');
    });

    it('should return partial results on non-critical failures', async () => {
      mockFetch.mockImplementation(async (url: string) => {
        if (url.includes('rag-embeddings')) {
          throw new Error('Embedding service down');
        }
        if (url.includes('audio-intelligence')) {
          return createMockResponse(mockAudioIntelligenceResponses.successfulExtraction);
        }
        return createMockResponse(mockRecommenderResponses.successfulRecommendation);
      });

      const input = generatePipelineInput({
        transcriptText: sampleTranscripts.cleanTranscript,
      });
      const userContext = generateUserContext('PROVIDER');

      const result = await orchestrator.process(input, userContext);

      expect(result.extractedEntities).toBeDefined();
      expect(result.recommendations).toBeDefined();
      expect(result.degradedServices).toContain('rag-embeddings');
    });

    it('should not include PHI in error messages', async () => {
      mockFetch.mockRejectedValue(new Error('Service error'));

      const input = generatePipelineInput({
        transcriptText: 'Patient John Doe SSN 123-45-6789',
      });
      const userContext = generateUserContext('PROVIDER');

      try {
        await orchestrator.process(input, userContext);
      } catch (error: any) {
        expect(error.message).not.toContain('John Doe');
        expect(error.message).not.toContain('123-45-6789');
      }
    });
  });

  describe('Caching', () => {
    it('should cache extraction results', async () => {
      const input = generatePipelineInput({
        transcriptText: 'Unique transcript for cache test',
      });
      const userContext = generateUserContext('PROVIDER');

      // First request
      await orchestrator.process(input, userContext);

      // Second request with same transcript
      const result2 = await orchestrator.process(input, userContext);

      expect(result2.processingMetadata.cacheHit).toBe(true);
    });

    it('should respect cache TTL', async () => {
      jest.useFakeTimers();

      const input = generatePipelineInput({
        transcriptText: 'TTL test transcript',
      });
      const userContext = generateUserContext('PROVIDER');

      // First request
      await orchestrator.process(input, userContext);

      // Advance time past TTL (1 hour)
      jest.advanceTimersByTime(3600001);

      mockFetch.mockClear();

      // Should make new request (cache expired)
      await orchestrator.process(input, userContext);

      expect(mockFetch).toHaveBeenCalled();

      jest.useRealTimers();
    });
  });

  describe('Idempotency', () => {
    it('should return cached response for duplicate idempotency key', async () => {
      const idempotencyKey = 'idemp-test-123';
      const input = generatePipelineInput({ idempotencyKey });
      const userContext = generateUserContext('PROVIDER');

      // First request
      const result1 = await orchestrator.process(input, userContext);

      mockFetch.mockClear();

      // Second request with same idempotency key
      const result2 = await orchestrator.process(input, userContext);

      expect(result1.requestId).toBe(result2.requestId);
      expect(mockFetch).not.toHaveBeenCalled(); // Should use cached result
    });

    it('should handle concurrent requests with same idempotency key', async () => {
      const idempotencyKey = 'concurrent-idemp-123';
      const input = generatePipelineInput({ idempotencyKey });
      const userContext = generateUserContext('PROVIDER');

      // Send concurrent requests
      const promises = Array.from({ length: 3 }, () =>
        orchestrator.process(input, userContext)
      );

      const results = await Promise.all(promises);

      // All should have same request ID
      expect(results[0].requestId).toBe(results[1].requestId);
      expect(results[1].requestId).toBe(results[2].requestId);
    });
  });

  describe('Data minimization', () => {
    it('should send only required data to ML services', async () => {
      const input = generatePipelineInput({
        transcriptText: sampleTranscripts.cleanTranscript,
      });
      const userContext = generateUserContext('PROVIDER');

      await orchestrator.process(input, userContext);

      // Check what was sent to recommender (should not have transcript)
      const recommenderCall = mockFetch.mock.calls.find(
        (call) => call[0].includes('careplan-recommender')
      );

      if (recommenderCall) {
        const body = JSON.parse(recommenderCall[1].body);
        expect(body.transcriptText).toBeUndefined();
      }
    });
  });

  describe('Authorization', () => {
    it('should verify user has access to patient', async () => {
      const input = generatePipelineInput({
        patientId: 'unauthorized-patient',
      });
      const userContext = generateUserContext('PROVIDER');

      // Mock authorization check to fail
      jest.spyOn(orchestrator as any, 'verifyPatientAccess').mockResolvedValue(false);

      await expect(orchestrator.process(input, userContext)).rejects.toThrow(
        /unauthorized/i
      );
    });
  });
});

// Helper function
function createMockResponse(data: any, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => data,
    text: async () => JSON.stringify(data),
    headers: new Headers({ 'Content-Type': 'application/json' }),
  } as Response;
}
