/**
 * Job Queue Setup
 *
 * BullMQ queue configuration for async job processing.
 */

import { Queue, QueueEvents, Worker, Job } from 'bullmq';
import { Redis } from 'ioredis';
import {
  JobType,
  JobData,
  JobResult,
  JobOptions,
  JobProgress,
  DEFAULT_JOB_OPTIONS,
  QUEUE_NAMES,
  GenerationJobData,
  PdfImportJobData,
} from './types';

/**
 * Queue configuration
 */
export interface QueueConfig {
  /** Redis connection */
  redis: Redis;
  /** Queue name */
  name: string;
  /** Default job options */
  defaultJobOptions?: JobOptions;
  /** Prefix for queue keys */
  prefix?: string;
}

/**
 * Job queue manager
 */
export class JobQueueManager {
  private queues: Map<string, Queue> = new Map();
  private workers: Map<string, Worker> = new Map();
  private events: Map<string, QueueEvents> = new Map();
  private redis: Redis;
  private prefix: string;

  constructor(redis: Redis, prefix: string = 'pipeline:jobs:') {
    this.redis = redis;
    this.prefix = prefix;
  }

  /**
   * Create or get a queue
   */
  getQueue(name: string): Queue {
    if (this.queues.has(name)) {
      return this.queues.get(name)!;
    }

    const queue = new Queue(name, {
      connection: this.redis.duplicate(),
      prefix: this.prefix,
      defaultJobOptions: {
        ...DEFAULT_JOB_OPTIONS,
        removeOnComplete: {
          age: 3600, // Keep for 1 hour
          count: 100,
        },
        removeOnFail: {
          age: 86400, // Keep for 24 hours
          count: 500,
        },
      },
    });

    this.queues.set(name, queue);
    return queue;
  }

  /**
   * Get queue events for listening
   */
  getQueueEvents(name: string): QueueEvents {
    if (this.events.has(name)) {
      return this.events.get(name)!;
    }

    const queueEvents = new QueueEvents(name, {
      connection: this.redis.duplicate(),
      prefix: this.prefix,
    });

    this.events.set(name, queueEvents);
    return queueEvents;
  }

  /**
   * Add a job to the queue
   */
  async addJob<T extends JobData>(
    queueName: string,
    data: T,
    options?: Partial<JobOptions>
  ): Promise<Job<T>> {
    const queue = this.getQueue(queueName);

    const job = await queue.add(data.type, data, {
      ...DEFAULT_JOB_OPTIONS,
      ...options,
      jobId: data.requestId, // Use requestId as job ID
    });

    return job as Job<T>;
  }

  /**
   * Get a job by ID
   */
  async getJob<T extends JobData>(
    queueName: string,
    jobId: string
  ): Promise<Job<T> | undefined> {
    const queue = this.getQueue(queueName);
    return (await queue.getJob(jobId)) as Job<T> | undefined;
  }

  /**
   * Remove a job
   */
  async removeJob(queueName: string, jobId: string): Promise<void> {
    const queue = this.getQueue(queueName);
    const job = await queue.getJob(jobId);
    if (job) {
      await job.remove();
    }
  }

  /**
   * Get queue stats
   */
  async getQueueStats(queueName: string): Promise<QueueStats> {
    const queue = this.getQueue(queueName);

    const [waiting, active, completed, failed, delayed] = await Promise.all([
      queue.getWaitingCount(),
      queue.getActiveCount(),
      queue.getCompletedCount(),
      queue.getFailedCount(),
      queue.getDelayedCount(),
    ]);

    return {
      name: queueName,
      waiting,
      active,
      completed,
      failed,
      delayed,
      total: waiting + active + delayed,
    };
  }

  /**
   * Get all queue stats
   */
  async getAllQueueStats(): Promise<QueueStats[]> {
    const stats: QueueStats[] = [];

    for (const name of Object.values(QUEUE_NAMES)) {
      stats.push(await this.getQueueStats(name));
    }

    return stats;
  }

  /**
   * Pause a queue
   */
  async pauseQueue(queueName: string): Promise<void> {
    const queue = this.getQueue(queueName);
    await queue.pause();
  }

  /**
   * Resume a queue
   */
  async resumeQueue(queueName: string): Promise<void> {
    const queue = this.getQueue(queueName);
    await queue.resume();
  }

  /**
   * Clean old jobs from a queue
   */
  async cleanQueue(
    queueName: string,
    grace: number = 86400000, // 24 hours
    limit: number = 1000,
    status: 'completed' | 'failed' | 'delayed' | 'wait' = 'completed'
  ): Promise<string[]> {
    const queue = this.getQueue(queueName);
    return await queue.clean(grace, limit, status);
  }

  /**
   * Close all queues and workers
   */
  async close(): Promise<void> {
    // Close workers first
    for (const worker of this.workers.values()) {
      await worker.close();
    }

    // Close queue events
    for (const events of this.events.values()) {
      await events.close();
    }

    // Close queues
    for (const queue of this.queues.values()) {
      await queue.close();
    }

    this.workers.clear();
    this.events.clear();
    this.queues.clear();
  }
}

/**
 * Queue statistics
 */
export interface QueueStats {
  name: string;
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
  total: number;
}

/**
 * Create care plan generation queue
 */
export function createGenerationQueue(redis: Redis): Queue<GenerationJobData> {
  return new Queue<GenerationJobData>(QUEUE_NAMES.CARE_PLAN_GENERATION, {
    connection: redis.duplicate(),
    prefix: 'pipeline:jobs:',
    defaultJobOptions: {
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 2000,
      },
      removeOnComplete: {
        age: 3600,
        count: 100,
      },
      removeOnFail: {
        age: 86400,
        count: 500,
      },
    },
  });
}

/**
 * Create PDF import queue
 */
export function createPdfImportQueue(redis: Redis): Queue<PdfImportJobData> {
  return new Queue<PdfImportJobData>(QUEUE_NAMES.PDF_IMPORT, {
    connection: redis.duplicate(),
    prefix: 'pipeline:jobs:',
    defaultJobOptions: {
      attempts: 2,
      backoff: {
        type: 'exponential',
        delay: 5000,
      },
      removeOnComplete: {
        age: 3600,
        count: 50,
      },
      removeOnFail: {
        age: 86400,
        count: 100,
      },
    },
  });
}

/**
 * Enqueue a care plan generation job
 */
export async function enqueueGenerationJob(
  queue: Queue<GenerationJobData>,
  data: Omit<GenerationJobData, 'type' | 'createdAt'>
): Promise<Job<GenerationJobData>> {
  const jobData: GenerationJobData = {
    ...data,
    type: JobType.GENERATE_CARE_PLAN,
    createdAt: new Date(),
  };

  return await queue.add(JobType.GENERATE_CARE_PLAN, jobData, {
    jobId: data.requestId,
  });
}

/**
 * Enqueue a PDF import job
 */
export async function enqueuePdfImportJob(
  queue: Queue<PdfImportJobData>,
  data: Omit<PdfImportJobData, 'type' | 'createdAt'>
): Promise<Job<PdfImportJobData>> {
  const jobData: PdfImportJobData = {
    ...data,
    type: JobType.IMPORT_PDF,
    createdAt: new Date(),
  };

  return await queue.add(JobType.IMPORT_PDF, jobData, {
    jobId: data.requestId,
  });
}
