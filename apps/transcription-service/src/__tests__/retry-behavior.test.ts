/**
 * Tests for retry and failure handling behavior
 *
 * Validates queue configuration for retry semantics and the
 * retryTranscription mutation recovery path.
 */

import { TranscriptionJobData, TranscriptionJobResult } from '../services/transcription-queue';
import { TranscribeResponse } from '../workers/ml-client';

// Track Worker constructor args to verify retry config
let capturedWorkerOptions: any = null;
let capturedProcessor: ((job: any) => Promise<TranscriptionJobResult>) | null = null;

jest.mock('bullmq', () => ({
  Worker: jest.fn().mockImplementation((_name: string, processor: any, options: any) => {
    capturedProcessor = processor;
    capturedWorkerOptions = options;
    return { on: jest.fn(), close: jest.fn() };
  }),
  Queue: jest.fn().mockImplementation((_name: string, options: any) => {
    return {
      add: jest.fn().mockResolvedValue({ id: 'job-1' }),
      getJob: jest.fn(),
      close: jest.fn(),
      getWaitingCount: jest.fn().mockResolvedValue(0),
      getActiveCount: jest.fn().mockResolvedValue(0),
      getCompletedCount: jest.fn().mockResolvedValue(0),
      getFailedCount: jest.fn().mockResolvedValue(0),
      getDelayedCount: jest.fn().mockResolvedValue(0),
      clean: jest.fn(),
      _options: options,
    };
  }),
  QueueEvents: jest.fn().mockImplementation(() => ({
    close: jest.fn(),
  })),
}));

// Successful ML response fixture
const successResponse: TranscribeResponse = {
  transcription_id: 'txn-123',
  status: 'completed',
  full_text: 'Test text.',
  audio_duration_seconds: 30,
  confidence_score: 0.95,
  segments: [],
  entities: [],
  processing_time_seconds: 2,
  disclaimer: 'AI-generated.',
};

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

function createMockJob(data: Partial<TranscriptionJobData> = {}, overrides: any = {}): any {
  return {
    id: data.transcriptionId || 'txn-123',
    data: {
      transcriptionId: 'txn-123',
      patientId: 'patient-456',
      audioUri: 'gs://bucket/audio.webm',
      ...data,
    },
    updateProgress: jest.fn().mockResolvedValue(undefined),
    attemptsMade: 0,
    opts: { attempts: 3 },
    ...overrides,
  };
}

describe('Retry Behavior', () => {
  let mockPool: any;
  let mockMLClient: any;
  let processor: (job: any) => Promise<TranscriptionJobResult>;

  beforeAll(() => {
    mockPool = createMockPool();
    mockMLClient = {
      transcribe: jest.fn(),
      healthCheck: jest.fn(),
    };

    const { createTranscriptionWorker } = require('../workers/transcription.worker');
    createTranscriptionWorker({} as any, mockPool, mockMLClient);
    processor = capturedProcessor!;
  });

  beforeEach(() => {
    mockPool.query.mockReset().mockResolvedValue({ rows: [] });
    mockPool.connect.mockReset();
    mockMLClient.transcribe.mockReset();

    const mockClient = {
      query: jest.fn().mockResolvedValue({ rows: [] }),
      release: jest.fn(),
    };
    mockPool._mockClient = mockClient;
    mockPool.connect.mockResolvedValue(mockClient);
  });

  describe('queue retry configuration', () => {
    it('configures 3 retry attempts with exponential backoff', () => {
      const { initializeQueue } = require('../services/transcription-queue');
      const mockRedis = {} as any;
      initializeQueue(mockRedis);

      // Check the Queue constructor was called with correct default job options
      const { Queue } = require('bullmq');
      const queueCallArgs = Queue.mock.calls[Queue.mock.calls.length - 1];
      const defaultJobOptions = queueCallArgs[1].defaultJobOptions;

      expect(defaultJobOptions.attempts).toBe(3);
      expect(defaultJobOptions.backoff.type).toBe('exponential');
      expect(defaultJobOptions.backoff.delay).toBe(5000);
    });
  });

  describe('worker failure and re-throw', () => {
    it('re-throws on first attempt so BullMQ can retry', async () => {
      mockMLClient.transcribe.mockRejectedValue(new Error('ML service unavailable'));

      const job = createMockJob({}, { attemptsMade: 0 });
      await expect(processor(job)).rejects.toThrow('ML service unavailable');

      // Status should be set to FAILED for this attempt
      const failCall = mockPool.query.mock.calls.find(
        (c: any[]) => typeof c[0] === 'string' && c[0].includes("'FAILED'")
      );
      expect(failCall).toBeDefined();
    });

    it('re-throws on second attempt so BullMQ can retry again', async () => {
      mockMLClient.transcribe.mockRejectedValue(new Error('ML service unavailable'));

      const job = createMockJob({}, { attemptsMade: 1 });
      await expect(processor(job)).rejects.toThrow('ML service unavailable');
    });

    it('re-throws on final attempt — BullMQ marks job as permanently failed', async () => {
      mockMLClient.transcribe.mockRejectedValue(new Error('ML service unavailable'));

      const job = createMockJob({}, { attemptsMade: 2 });
      await expect(processor(job)).rejects.toThrow('ML service unavailable');
    });

    it('succeeds on retry after previous failure', async () => {
      // Simulate: first call fails, second succeeds
      mockMLClient.transcribe
        .mockRejectedValueOnce(new Error('Temporary failure'))
        .mockResolvedValueOnce(successResponse);

      const job1 = createMockJob({}, { attemptsMade: 0 });
      await expect(processor(job1)).rejects.toThrow('Temporary failure');

      // Reset pool mocks for the retry
      mockPool.query.mockReset().mockResolvedValue({ rows: [] });
      const mockClient = {
        query: jest.fn().mockResolvedValue({ rows: [] }),
        release: jest.fn(),
      };
      mockPool._mockClient = mockClient;
      mockPool.connect.mockResolvedValue(mockClient);

      const job2 = createMockJob({}, { attemptsMade: 1 });
      const result = await processor(job2);

      expect(result.success).toBe(true);
    });

    it('logs attempt number and max attempts on failure', async () => {
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
      mockMLClient.transcribe.mockRejectedValue(new Error('Timeout'));

      const job = createMockJob({}, { attemptsMade: 1, opts: { attempts: 3 } });
      await expect(processor(job)).rejects.toThrow('Timeout');

      const logCalls = consoleSpy.mock.calls.map(c => c[0]);
      const failLog = logCalls.find(
        (l: string) => typeof l === 'string' && l.includes('Processing failed')
      );
      expect(failLog).toBeDefined();
      const parsed = JSON.parse(failLog);
      expect(parsed.attempt).toBe(2); // attemptsMade + 1
      expect(parsed.maxAttempts).toBe(3);

      consoleSpy.mockRestore();
    });
  });

});
