/**
 * Job Queue Types
 *
 * Type definitions for async job processing.
 */

import { PipelineInput, PipelineOutput } from '../orchestration';

/**
 * Job type identifiers
 */
export enum JobType {
  GENERATE_CARE_PLAN = 'GENERATE_CARE_PLAN',
  IMPORT_PDF = 'IMPORT_PDF',
  GENERATE_EMBEDDINGS = 'GENERATE_EMBEDDINGS',
  REFRESH_RECOMMENDATIONS = 'REFRESH_RECOMMENDATIONS',
}

/**
 * Job status
 */
export enum JobStatus {
  WAITING = 'WAITING',
  ACTIVE = 'ACTIVE',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
  DELAYED = 'DELAYED',
  PAUSED = 'PAUSED',
}

/**
 * Base job data interface
 */
export interface BaseJobData {
  /** Job type */
  type: JobType;
  /** Request ID for tracking */
  requestId: string;
  /** User ID who initiated the job */
  userId: string;
  /** User role */
  userRole: string;
  /** Correlation ID for tracing */
  correlationId: string;
  /** When the job was created */
  createdAt: Date;
}

/**
 * Care plan generation job data
 */
export interface GenerationJobData extends BaseJobData {
  type: JobType.GENERATE_CARE_PLAN;
  /** Encrypted pipeline input (contains PHI) */
  inputEncrypted: Buffer;
  /** Original idempotency key */
  idempotencyKey: string;
}

/**
 * PDF import job data
 */
export interface PdfImportJobData extends BaseJobData {
  type: JobType.IMPORT_PDF;
  /** Patient ID */
  patientId: string;
  /** File storage key */
  fileKey: string;
}

/**
 * Embedding generation job data
 */
export interface EmbeddingJobData extends BaseJobData {
  type: JobType.GENERATE_EMBEDDINGS;
  /** Care plan or template ID */
  entityId: string;
  /** Entity type */
  entityType: 'CARE_PLAN' | 'TEMPLATE' | 'GUIDELINE';
  /** Text to embed */
  text: string;
}

/**
 * Refresh recommendations job data
 */
export interface RefreshRecommendationsJobData extends BaseJobData {
  type: JobType.REFRESH_RECOMMENDATIONS;
  /** Condition codes to refresh */
  conditionCodes: string[];
  /** Whether to invalidate cache */
  invalidateCache: boolean;
}

/**
 * Union of all job data types
 */
export type JobData =
  | GenerationJobData
  | PdfImportJobData
  | EmbeddingJobData
  | RefreshRecommendationsJobData;

/**
 * Job result types
 */
export interface GenerationJobResult {
  type: JobType.GENERATE_CARE_PLAN;
  requestId: string;
  output: PipelineOutput;
}

export interface PdfImportJobResult {
  type: JobType.IMPORT_PDF;
  requestId: string;
  parsedCarePlan: any;
  extractedCodes: any[];
}

export interface EmbeddingJobResult {
  type: JobType.GENERATE_EMBEDDINGS;
  entityId: string;
  embedding: number[];
  dimension: number;
}

export interface RefreshRecommendationsJobResult {
  type: JobType.REFRESH_RECOMMENDATIONS;
  conditionCodes: string[];
  templatesUpdated: number;
}

export type JobResult =
  | GenerationJobResult
  | PdfImportJobResult
  | EmbeddingJobResult
  | RefreshRecommendationsJobResult;

/**
 * Job options
 */
export interface JobOptions {
  /** Maximum number of attempts */
  attempts?: number;
  /** Backoff strategy */
  backoff?: {
    type: 'exponential' | 'fixed';
    delay: number;
  };
  /** Remove job on completion */
  removeOnComplete?: boolean | number;
  /** Remove job on failure */
  removeOnFail?: boolean | number;
  /** Job priority (lower = higher priority) */
  priority?: number;
  /** Delay before processing (ms) */
  delay?: number;
  /** Job timeout (ms) */
  timeout?: number;
}

/**
 * Default job options
 */
export const DEFAULT_JOB_OPTIONS: JobOptions = {
  attempts: 3,
  backoff: {
    type: 'exponential',
    delay: 1000,
  },
  removeOnComplete: 100, // Keep last 100 completed jobs
  removeOnFail: 500, // Keep last 500 failed jobs
  timeout: 300000, // 5 minutes
};

/**
 * Queue names
 */
export const QUEUE_NAMES = {
  CARE_PLAN_GENERATION: 'care-plan-generation',
  PDF_IMPORT: 'pdf-import',
  EMBEDDINGS: 'embeddings',
  RECOMMENDATIONS: 'recommendations',
};

/**
 * Job event types
 */
export enum JobEvent {
  COMPLETED = 'completed',
  FAILED = 'failed',
  PROGRESS = 'progress',
  ACTIVE = 'active',
  WAITING = 'waiting',
  STALLED = 'stalled',
  REMOVED = 'removed',
}

/**
 * Job progress data
 */
export interface JobProgress {
  /** Current stage */
  stage: string;
  /** Progress percentage (0-100) */
  percentage: number;
  /** Status message */
  message?: string;
  /** Timestamp */
  timestamp: Date;
}
