/**
 * Jobs Module
 *
 * Exports for async job processing.
 */

// Types
export {
  JobType,
  JobStatus,
  BaseJobData,
  GenerationJobData,
  PdfImportJobData,
  EmbeddingJobData,
  RefreshRecommendationsJobData,
  JobData,
  GenerationJobResult,
  PdfImportJobResult,
  EmbeddingJobResult,
  RefreshRecommendationsJobResult,
  JobResult,
  JobOptions,
  JobProgress,
  DEFAULT_JOB_OPTIONS,
  QUEUE_NAMES,
  JobEvent,
} from './types';

// Queue
export {
  QueueConfig,
  JobQueueManager,
  QueueStats,
  createGenerationQueue,
  createPdfImportQueue,
  enqueueGenerationJob,
  enqueuePdfImportJob,
} from './queue';

// Processor
export {
  ProcessorConfig,
  createGenerationWorker,
  createPdfImportWorker,
  WorkerManager,
  WorkerStatus,
} from './processor';

// Request tracker
export {
  RequestStatus,
  PipelineRequest,
  RequestTrackerConfig,
  RequestTracker,
  RequestStats,
} from './request-tracker';
