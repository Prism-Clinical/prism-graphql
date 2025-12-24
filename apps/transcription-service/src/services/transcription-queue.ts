/**
 * Transcription Queue Service
 *
 * BullMQ queue configuration for processing transcription jobs.
 * Jobs are processed by workers that call the ML service for STT + NER.
 */

import { Queue, QueueEvents } from 'bullmq';
import { Redis } from 'ioredis';

// Job data interface
export interface TranscriptionJobData {
  transcriptionId: string;
  patientId: string;
  encounterId?: string;
  audioUri: string;
  speakerCount?: number;
  vocabularyHints?: string[];
}

// Job result interface
export interface TranscriptionJobResult {
  success: boolean;
  transcriptionId: string;
  processingTimeSeconds?: number;
  error?: string;
}

// Queue name
export const TRANSCRIPTION_QUEUE_NAME = 'transcription-jobs';

// Redis connection (will be set from main app)
let redisConnection: Redis | null = null;
let transcriptionQueue: Queue<TranscriptionJobData, TranscriptionJobResult> | null = null;
let queueEvents: QueueEvents | null = null;

/**
 * Initialize the transcription queue with Redis connection
 */
export function initializeQueue(redis: Redis): Queue<TranscriptionJobData, TranscriptionJobResult> {
  redisConnection = redis;

  transcriptionQueue = new Queue<TranscriptionJobData, TranscriptionJobResult>(
    TRANSCRIPTION_QUEUE_NAME,
    {
      connection: redis,
      defaultJobOptions: {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 5000, // Start with 5s, then 10s, then 20s
        },
        removeOnComplete: {
          age: 86400, // Keep completed jobs for 24 hours
          count: 1000, // Keep last 1000 completed jobs
        },
        removeOnFail: {
          age: 604800, // Keep failed jobs for 7 days
        },
      },
    }
  );

  // Initialize queue events for monitoring
  queueEvents = new QueueEvents(TRANSCRIPTION_QUEUE_NAME, {
    connection: redis,
  });

  console.log('Transcription queue initialized');

  return transcriptionQueue;
}

/**
 * Get the transcription queue instance
 */
export function getTranscriptionQueue(): Queue<TranscriptionJobData, TranscriptionJobResult> {
  if (!transcriptionQueue) {
    throw new Error('Transcription queue not initialized. Call initializeQueue() first.');
  }
  return transcriptionQueue;
}

/**
 * Add a transcription job to the queue
 */
export async function addTranscriptionJob(data: TranscriptionJobData): Promise<string> {
  const queue = getTranscriptionQueue();

  const job = await queue.add('process-transcription', data, {
    jobId: data.transcriptionId, // Use transcription ID as job ID for easy lookup
    priority: 1, // Default priority (lower is higher priority)
  });

  console.log(`Added transcription job ${job.id} for transcription ${data.transcriptionId}`);

  return job.id!;
}

/**
 * Get job status by transcription ID
 */
export async function getJobStatus(transcriptionId: string): Promise<{
  state: string;
  progress: number;
  attemptsMade: number;
  failedReason?: string;
} | null> {
  const queue = getTranscriptionQueue();
  const job = await queue.getJob(transcriptionId);

  if (!job) {
    return null;
  }

  const state = await job.getState();

  return {
    state,
    progress: job.progress as number,
    attemptsMade: job.attemptsMade,
    failedReason: job.failedReason,
  };
}

/**
 * Cancel a pending job
 */
export async function cancelJob(transcriptionId: string): Promise<boolean> {
  const queue = getTranscriptionQueue();
  const job = await queue.getJob(transcriptionId);

  if (!job) {
    return false;
  }

  const state = await job.getState();

  // Can only cancel jobs that haven't started processing
  if (state === 'waiting' || state === 'delayed') {
    await job.remove();
    return true;
  }

  return false;
}

/**
 * Get queue statistics
 */
export async function getQueueStats(): Promise<{
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
}> {
  const queue = getTranscriptionQueue();

  const [waiting, active, completed, failed, delayed] = await Promise.all([
    queue.getWaitingCount(),
    queue.getActiveCount(),
    queue.getCompletedCount(),
    queue.getFailedCount(),
    queue.getDelayedCount(),
  ]);

  return { waiting, active, completed, failed, delayed };
}

/**
 * Clean up old jobs
 */
export async function cleanOldJobs(gracePeriodMs: number = 86400000): Promise<void> {
  const queue = getTranscriptionQueue();

  // Clean completed jobs older than grace period
  await queue.clean(gracePeriodMs, 1000, 'completed');

  // Clean failed jobs older than 7 days
  await queue.clean(gracePeriodMs * 7, 1000, 'failed');
}

/**
 * Close queue connections
 */
export async function closeQueue(): Promise<void> {
  if (queueEvents) {
    await queueEvents.close();
  }
  if (transcriptionQueue) {
    await transcriptionQueue.close();
  }
}
