/**
 * Job Processor
 *
 * Worker for processing pipeline jobs.
 */

import { Worker, Job } from 'bullmq';
import { Redis } from 'ioredis';
import { Pool } from 'pg';
import {
  JobType,
  JobData,
  JobResult,
  GenerationJobData,
  GenerationJobResult,
  PdfImportJobData,
  PdfImportJobResult,
  QUEUE_NAMES,
} from './types';
import { PipelineOrchestrator, PipelineInput, PipelineOutput } from '../orchestration';
import { ProgressEmitter } from '../resolvers/subscriptions/generation-progress';
import { RequestTracker } from './request-tracker';
import { DeadLetterQueue, DLQItem } from '../orchestration/transaction-manager';

/**
 * Processor configuration
 */
export interface ProcessorConfig {
  /** Redis client */
  redis: Redis;
  /** Database pool */
  pool: Pool;
  /** Pipeline orchestrator */
  pipelineOrchestrator: PipelineOrchestrator;
  /** Request tracker */
  requestTracker: RequestTracker;
  /** DLQ manager */
  dlq: DeadLetterQueue;
  /** Encryption key for job data */
  encryptionKey: Buffer;
  /** Concurrency limit */
  concurrency?: number;
  /** Audit logger */
  auditLogger: {
    logJob: (entry: any) => Promise<void>;
  };
}

/**
 * Decrypt job data
 */
function decryptJobData(encrypted: Buffer, key: Buffer): any {
  const crypto = require('crypto');
  const data = encrypted.toString('utf8');
  const parts = data.split(':');
  const iv = Buffer.from(parts[0], 'hex');
  const encryptedData = parts[1];
  const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
  let decrypted = decipher.update(encryptedData, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return JSON.parse(decrypted);
}

/**
 * Create generation job worker
 */
export function createGenerationWorker(config: ProcessorConfig): Worker<GenerationJobData> {
  const worker = new Worker<GenerationJobData>(
    QUEUE_NAMES.CARE_PLAN_GENERATION,
    async (job: Job<GenerationJobData>) => {
      const { data } = job;
      const progressEmitter = new ProgressEmitter(config.redis, data.requestId);

      try {
        // Update request status
        await config.requestTracker.updateStatus(data.requestId, 'IN_PROGRESS');
        await progressEmitter.stageStarted('PROCESSING');

        // Log job start
        await config.auditLogger.logJob({
          eventType: 'JOB_STARTED',
          jobId: job.id,
          jobType: JobType.GENERATE_CARE_PLAN,
          requestId: data.requestId,
          userId: data.userId,
          correlationId: data.correlationId,
        });

        // Decrypt input
        const pipelineInput: PipelineInput = decryptJobData(
          data.inputEncrypted,
          config.encryptionKey
        );

        // Update job progress
        await job.updateProgress({ stage: 'ORCHESTRATION', percentage: 10 });

        // Process through pipeline
        const result = await config.pipelineOrchestrator.process(pipelineInput);

        // Update progress
        await job.updateProgress({ stage: 'COMPLETE', percentage: 100 });
        await progressEmitter.pipelineCompleted(result);

        // Update request with result
        await config.requestTracker.complete(data.requestId, result);

        // Log job completion
        await config.auditLogger.logJob({
          eventType: 'JOB_COMPLETED',
          jobId: job.id,
          jobType: JobType.GENERATE_CARE_PLAN,
          requestId: data.requestId,
          userId: data.userId,
          correlationId: data.correlationId,
          durationMs: Date.now() - data.createdAt.getTime(),
        });

        return {
          type: JobType.GENERATE_CARE_PLAN,
          requestId: data.requestId,
          output: result,
        } as GenerationJobResult;
      } catch (error) {
        const err = error as Error;

        // Emit failure
        await progressEmitter.pipelineFailed(err.message);

        // Update request status
        await config.requestTracker.fail(data.requestId, {
          message: err.message,
          code: 'PROCESSING_ERROR',
        });

        // Log job failure
        await config.auditLogger.logJob({
          eventType: 'JOB_FAILED',
          jobId: job.id,
          jobType: JobType.GENERATE_CARE_PLAN,
          requestId: data.requestId,
          userId: data.userId,
          correlationId: data.correlationId,
          error: err.message,
          attempt: job.attemptsMade,
        });

        throw error;
      }
    },
    {
      connection: config.redis.duplicate(),
      prefix: 'pipeline:jobs:',
      concurrency: config.concurrency ?? 5,
      limiter: {
        max: 10,
        duration: 1000, // 10 jobs per second max
      },
    }
  );

  // Set up event handlers
  worker.on('completed', (job, result) => {
    console.log(`Job ${job.id} completed successfully`);
  });

  worker.on('failed', async (job, error) => {
    console.error(`Job ${job?.id} failed:`, error.message);

    // Move to DLQ if max attempts reached
    if (job && job.attemptsMade >= (job.opts.attempts ?? 3)) {
      try {
        const dlqItem: DLQItem = {
          jobType: JobType.GENERATE_CARE_PLAN,
          jobId: job.id ?? 'unknown',
          payload: job.data.inputEncrypted,
          errorMessage: error.message,
          errorStack: error.stack,
          attempts: job.attemptsMade,
        };

        await config.dlq.add(dlqItem);
        console.log(`Job ${job.id} moved to DLQ`);
      } catch (dlqError) {
        console.error('Failed to add job to DLQ:', dlqError);
      }
    }
  });

  worker.on('stalled', (jobId) => {
    console.warn(`Job ${jobId} stalled`);
  });

  return worker;
}

/**
 * Create PDF import worker
 */
export function createPdfImportWorker(
  config: ProcessorConfig,
  pdfParserClient: { parse: (fileKey: string) => Promise<any> }
): Worker<PdfImportJobData> {
  const worker = new Worker<PdfImportJobData>(
    QUEUE_NAMES.PDF_IMPORT,
    async (job: Job<PdfImportJobData>) => {
      const { data } = job;

      try {
        // Update request status
        await config.requestTracker.updateStatus(data.requestId, 'IN_PROGRESS');

        // Log job start
        await config.auditLogger.logJob({
          eventType: 'JOB_STARTED',
          jobId: job.id,
          jobType: JobType.IMPORT_PDF,
          requestId: data.requestId,
          userId: data.userId,
          correlationId: data.correlationId,
          patientId: data.patientId,
        });

        // Parse PDF
        await job.updateProgress({ stage: 'PARSING', percentage: 20 });
        const parseResult = await pdfParserClient.parse(data.fileKey);

        // Process result
        await job.updateProgress({ stage: 'PROCESSING', percentage: 80 });

        const result: PdfImportJobResult = {
          type: JobType.IMPORT_PDF,
          requestId: data.requestId,
          parsedCarePlan: parseResult.carePlan,
          extractedCodes: parseResult.codes || [],
        };

        // Update request (cast to any to allow partial pipeline output)
        await config.requestTracker.complete(data.requestId, result as any);

        await job.updateProgress({ stage: 'COMPLETE', percentage: 100 });

        // Log completion
        await config.auditLogger.logJob({
          eventType: 'JOB_COMPLETED',
          jobId: job.id,
          jobType: JobType.IMPORT_PDF,
          requestId: data.requestId,
          userId: data.userId,
          correlationId: data.correlationId,
          durationMs: Date.now() - data.createdAt.getTime(),
        });

        return result;
      } catch (error) {
        const err = error as Error;

        // Update request status
        await config.requestTracker.fail(data.requestId, {
          message: err.message,
          code: 'IMPORT_ERROR',
        });

        // Log failure
        await config.auditLogger.logJob({
          eventType: 'JOB_FAILED',
          jobId: job.id,
          jobType: JobType.IMPORT_PDF,
          requestId: data.requestId,
          userId: data.userId,
          correlationId: data.correlationId,
          error: err.message,
        });

        throw error;
      }
    },
    {
      connection: config.redis.duplicate(),
      prefix: 'pipeline:jobs:',
      concurrency: config.concurrency ?? 3, // Lower concurrency for PDF processing
    }
  );

  worker.on('failed', async (job, error) => {
    console.error(`PDF import job ${job?.id} failed:`, error.message);

    if (job && job.attemptsMade >= (job.opts.attempts ?? 2)) {
      try {
        const dlqItem: DLQItem = {
          jobType: JobType.IMPORT_PDF,
          jobId: job.id ?? 'unknown',
          payload: Buffer.from(JSON.stringify({
            patientId: job.data.patientId,
            fileKey: job.data.fileKey,
          })),
          errorMessage: error.message,
          errorStack: error.stack,
          attempts: job.attemptsMade,
        };

        await config.dlq.add(dlqItem);
      } catch (dlqError) {
        console.error('Failed to add PDF import job to DLQ:', dlqError);
      }
    }
  });

  return worker;
}

/**
 * Worker manager for coordinating all workers
 */
export class WorkerManager {
  private workers: Worker[] = [];
  private isRunning = false;

  /**
   * Add a worker
   */
  addWorker(worker: Worker): void {
    this.workers.push(worker);
  }

  /**
   * Start all workers
   */
  async start(): Promise<void> {
    if (this.isRunning) return;

    this.isRunning = true;
    console.log(`Starting ${this.workers.length} workers`);

    // Workers start automatically, just log
    for (const worker of this.workers) {
      console.log(`Worker for queue ${worker.name} is running`);
    }
  }

  /**
   * Stop all workers
   */
  async stop(): Promise<void> {
    if (!this.isRunning) return;

    console.log('Stopping all workers...');

    await Promise.all(this.workers.map((w) => w.close()));

    this.isRunning = false;
    this.workers = [];
    console.log('All workers stopped');
  }

  /**
   * Pause all workers
   */
  async pause(): Promise<void> {
    await Promise.all(this.workers.map((w) => w.pause()));
  }

  /**
   * Resume all workers
   */
  async resume(): Promise<void> {
    await Promise.all(this.workers.map((w) => w.resume()));
  }

  /**
   * Get worker status
   */
  getStatus(): WorkerStatus[] {
    return this.workers.map((w) => ({
      name: w.name,
      isRunning: w.isRunning(),
      isPaused: w.isPaused(),
    }));
  }
}

/**
 * Worker status
 */
export interface WorkerStatus {
  name: string;
  isRunning: boolean;
  isPaused: boolean;
}
