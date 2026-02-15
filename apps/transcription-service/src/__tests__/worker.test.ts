/**
 * Unit tests for transcription worker
 *
 * Mocks BullMQ Worker to capture the processor function, then
 * tests it with mock Pool, MLClient, and Job objects.
 */

import { TranscribeResponse } from '../workers/ml-client';
import { TranscriptionJobData, TranscriptionJobResult } from '../services/transcription-queue';

// Capture the processor function when Worker is constructed
let capturedProcessor: ((job: any) => Promise<TranscriptionJobResult>) | null = null;

jest.mock('bullmq', () => ({
  Worker: jest.fn().mockImplementation((_name: string, processor: any) => {
    capturedProcessor = processor;
    return { on: jest.fn(), close: jest.fn() };
  }),
}));

// Successful ML response fixture
const successResponse: TranscribeResponse = {
  transcription_id: 'txn-123',
  status: 'completed',
  full_text: 'Patient reports headache.',
  audio_duration_seconds: 60,
  confidence_score: 0.95,
  segments: [
    {
      id: 'seg-1',
      speaker: 'PATIENT',
      text: 'I have a headache.',
      start_time_ms: 0,
      end_time_ms: 3000,
      confidence: 0.97,
    },
  ],
  entities: [
    {
      id: 'ent-1',
      entity_type: 'SYMPTOM',
      text: 'headache',
      start_offset: 18,
      end_offset: 26,
      confidence: 0.92,
      normalized_code: '25064002',
      normalized_system: 'SNOMED-CT',
      normalized_display: 'Headache',
    },
  ],
  processing_time_seconds: 5.2,
  disclaimer: 'AI-generated.',
};

const jobData: TranscriptionJobData = {
  transcriptionId: 'txn-123',
  patientId: 'patient-456',
  encounterId: 'enc-789',
  audioUri: 'gs://bucket/audio.webm',
  speakerCount: 2,
  vocabularyHints: ['aspirin'],
};

function createMockJob(data: TranscriptionJobData): any {
  return {
    id: data.transcriptionId,
    data,
    updateProgress: jest.fn().mockResolvedValue(undefined),
  };
}

function createMockPool(): any {
  const mockClient = {
    query: jest.fn().mockResolvedValue({ rows: [] }),
    release: jest.fn(),
  };
  return {
    query: jest.fn().mockResolvedValue({ rows: [] }),
    connect: jest.fn().mockResolvedValue(mockClient),
    _mockClient: mockClient,
  };
}

describe('Transcription Worker', () => {
  let mockPool: any;
  let mockMLClient: any;
  let processor: (job: any) => Promise<TranscriptionJobResult>;

  beforeAll(() => {
    // Import module once — this triggers the mock Worker constructor
    // and captures the processor function
    mockPool = createMockPool();
    mockMLClient = {
      transcribe: jest.fn(),
      healthCheck: jest.fn(),
    };

    const { createTranscriptionWorker } = require('../workers/transcription.worker');
    createTranscriptionWorker({} as any, mockPool, mockMLClient);

    if (!capturedProcessor) {
      throw new Error('Worker processor was not captured — mock may be broken');
    }
    processor = capturedProcessor;
  });

  beforeEach(() => {
    // Reset mocks between tests but keep processor reference
    mockPool.query.mockReset().mockResolvedValue({ rows: [] });
    mockPool.connect.mockReset();
    mockMLClient.transcribe.mockReset();

    // Re-create mock client for each test
    const mockClient = {
      query: jest.fn().mockResolvedValue({ rows: [] }),
      release: jest.fn(),
    };
    mockPool._mockClient = mockClient;
    mockPool.connect.mockResolvedValue(mockClient);
  });

  describe('successful processing', () => {
    it('processes a job through the full pipeline', async () => {
      mockMLClient.transcribe.mockResolvedValue(successResponse);

      const job = createMockJob(jobData);
      const result = await processor(job);

      expect(result.success).toBe(true);
      expect(result.transcriptionId).toBe('txn-123');
      expect(result.processingTimeSeconds).toBeGreaterThanOrEqual(0);
    });

    it('updates status to PROCESSING first', async () => {
      mockMLClient.transcribe.mockResolvedValue(successResponse);

      const job = createMockJob(jobData);
      await processor(job);

      // First pool.query call should set status to PROCESSING
      const firstCall = mockPool.query.mock.calls[0];
      expect(firstCall[0]).toContain('status = $1');
      expect(firstCall[1][0]).toBe('PROCESSING');
      expect(firstCall[1][1]).toBe('txn-123');
    });

    it('calls ML service with correct parameters', async () => {
      mockMLClient.transcribe.mockResolvedValue(successResponse);

      const job = createMockJob(jobData);
      await processor(job);

      expect(mockMLClient.transcribe).toHaveBeenCalledWith({
        audio_uri: 'gs://bucket/audio.webm',
        transcription_id: 'txn-123',
        patient_id: 'patient-456',
        encounter_id: 'enc-789',
        enable_diarization: true,
        speaker_count: 2,
        vocabulary_hints: ['aspirin'],
        run_ner: true,
      });
    });

    it('saves segments and entities in a transaction', async () => {
      mockMLClient.transcribe.mockResolvedValue(successResponse);

      const job = createMockJob(jobData);
      await processor(job);

      const client = mockPool._mockClient;
      const queries = client.query.mock.calls.map((c: any[]) => c[0]);

      expect(queries[0]).toBe('BEGIN');
      expect(queries[1]).toContain('transcript_full_text');
      expect(queries[2]).toContain('INSERT INTO transcript_segments');
      expect(queries[3]).toContain('INSERT INTO extracted_entities');
      expect(queries[4]).toBe('COMMIT');
      expect(client.release).toHaveBeenCalled();
    });

    it('updates status to COMPLETED after saving results', async () => {
      mockMLClient.transcribe.mockResolvedValue(successResponse);

      const job = createMockJob(jobData);
      await processor(job);

      // Last pool.query call (not client.query) should set COMPLETED
      const lastPoolCall = mockPool.query.mock.calls[mockPool.query.mock.calls.length - 1];
      expect(lastPoolCall[0]).toContain("'COMPLETED'");
    });

    it('reports progress at each stage', async () => {
      mockMLClient.transcribe.mockResolvedValue(successResponse);

      const job = createMockJob(jobData);
      await processor(job);

      const progressCalls = job.updateProgress.mock.calls.map((c: any[]) => c[0]);
      expect(progressCalls).toEqual([10, 20, 70, 90, 100]);
    });

    it('handles response with no segments or entities', async () => {
      const emptyResponse: TranscribeResponse = {
        ...successResponse,
        segments: [],
        entities: [],
      };
      mockMLClient.transcribe.mockResolvedValue(emptyResponse);

      const job = createMockJob(jobData);
      const result = await processor(job);

      expect(result.success).toBe(true);

      // Transaction should only have BEGIN, UPDATE transcription, COMMIT
      const client = mockPool._mockClient;
      const queries = client.query.mock.calls.map((c: any[]) => c[0]);
      expect(queries).toEqual(['BEGIN', expect.stringContaining('transcript_full_text'), 'COMMIT']);
    });
  });

  describe('failure handling', () => {
    it('marks transcription as FAILED when ML service throws', async () => {
      mockMLClient.transcribe.mockRejectedValue(new Error('Connection refused'));

      const job = createMockJob(jobData);
      await expect(processor(job)).rejects.toThrow('Connection refused');

      // Should have called updateTranscriptionFailed via pool.query
      const failCall = mockPool.query.mock.calls.find(
        (c: any[]) => typeof c[0] === 'string' && c[0].includes("'FAILED'")
      );
      expect(failCall).toBeDefined();
      expect(failCall[1][0]).toBe('Connection refused');
    });

    it('marks transcription as FAILED when ML returns failed status', async () => {
      const failedResponse: TranscribeResponse = {
        ...successResponse,
        status: 'failed',
        error_message: 'Audio file not found',
      };
      mockMLClient.transcribe.mockResolvedValue(failedResponse);

      const job = createMockJob(jobData);
      await expect(processor(job)).rejects.toThrow('Audio file not found');
    });

    it('uses default error message when ML returns failed with no message', async () => {
      const failedResponse: TranscribeResponse = {
        ...successResponse,
        status: 'failed',
        error_message: undefined,
      };
      mockMLClient.transcribe.mockResolvedValue(failedResponse);

      const job = createMockJob(jobData);
      await expect(processor(job)).rejects.toThrow('ML service returned failed status');
    });

    it('truncates error messages longer than 1000 characters', async () => {
      const longError = 'x'.repeat(2000);
      mockMLClient.transcribe.mockRejectedValue(new Error(longError));

      const job = createMockJob(jobData);
      await expect(processor(job)).rejects.toThrow();

      const failCall = mockPool.query.mock.calls.find(
        (c: any[]) => typeof c[0] === 'string' && c[0].includes("'FAILED'")
      );
      expect(failCall[1][0]).toHaveLength(1000);
    });

    it('rolls back transaction on save error', async () => {
      mockMLClient.transcribe.mockResolvedValue(successResponse);

      const client = mockPool._mockClient;
      let callCount = 0;
      client.query.mockImplementation(() => {
        callCount++;
        if (callCount === 3) {
          return Promise.reject(new Error('Unique constraint violation'));
        }
        return Promise.resolve({ rows: [] });
      });

      const job = createMockJob(jobData);
      await expect(processor(job)).rejects.toThrow('Unique constraint violation');

      const queries = client.query.mock.calls.map((c: any[]) => c[0]);
      expect(queries).toContain('ROLLBACK');
      expect(client.release).toHaveBeenCalled();
    });

    it('re-throws errors to trigger BullMQ retry', async () => {
      const error = new Error('Timeout');
      mockMLClient.transcribe.mockRejectedValue(error);

      const job = createMockJob(jobData);
      await expect(processor(job)).rejects.toThrow(error);
    });
  });
});
