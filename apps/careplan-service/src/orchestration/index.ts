/**
 * Pipeline Orchestration Module
 *
 * Coordinates ML service calls for care plan generation.
 */

// Types
export {
  // Input/Output types
  PipelineInput,
  PipelineOutput,
  ExtractedEntities,
  ClinicalEntity,
  CarePlanRecommendation,
  DraftCarePlan,
  DraftGoal,
  DraftIntervention,
  RedFlag,
  RedFlagSeverity,
  ProcessingMetadata,
  // Stage types
  PipelineStage,
  StageStatus,
  StageResult,
  // Error types
  PipelineError,
  PipelineErrorCategory,
  ErrorSeverity,
  // Service types
  ServiceCriticality,
  PipelineServiceHealth,
  // Utilities
  createRequestId,
  validatePipelineInput,
} from './types';

// Error handling
export {
  SERVICE_CRITICALITY,
  ERROR_SEVERITY_MAP,
  sanitizeErrorMessage,
  createPipelineError,
  isRetryableError,
  shouldContinueAfterError,
  getServiceCriticality,
  shouldAbortOnServiceFailure,
  RecoveryAction,
  determineRecoveryAction,
  PipelineErrorAggregator,
  AlertConfig,
  processAlerts,
} from './error-handler';

// Recovery strategies
export {
  getFallbackExtractionResult,
  getManualReviewRedFlag,
  getDefaultTemplateRecommendations,
  getFallbackDraftCarePlan,
  skipPersonalization,
  mergeWithFallback,
  DegradationNotice,
  generateDegradationNotice,
  SafetyValidationResult,
  getConservativeSafetyResult,
  combineRedFlags,
  requiresManualReview,
} from './recovery-strategies';

// Data minimization
export {
  FullPatientContext,
  MLService,
  AudioIntelligenceContext,
  CarePlanRecommenderContext,
  RagEmbeddingsContext,
  PdfParserContext,
  ML_SERVICE_DATA_REQUIREMENTS,
  PHI_FIELDS,
  DataMinimizer,
  dataMinimizer,
  DataSharingAuditEntry,
  SyntheticDataGenerator,
  syntheticDataGenerator,
} from './data-minimizer';

// Pipeline cache
export {
  PipelineCacheConfig,
  CacheAccessEntry,
  PipelineCache,
  CacheStats,
  StampedeProtection,
  stampedeProtection,
} from './pipeline-cache';

// Idempotency
export {
  IdempotencyStatus,
  IdempotencyResult,
  IdempotencyConfig,
  IdempotencyManager,
  withIdempotency,
  IDEMPOTENCY_TABLE_MIGRATION,
} from './idempotency';

// Degradation management
export {
  FeatureFlags,
  ServiceStatus,
  DegradationConfig,
  DegradationManager,
  DegradationSummary,
  SERVICE_CRITICALITY_CONFIG,
  shouldBlockOnFailure,
  degradationManager,
} from './degradation-manager';

// Transaction management
export {
  TransactionContext,
  SagaStep,
  SagaContext,
  SagaResult,
  Saga,
  DistributedLockManager,
  LockHandle,
  TransactionManager,
  OptimisticLockError,
  DeadLetterQueue,
  DLQItem,
  DLQEntry,
  DLQ_TABLE_MIGRATION,
} from './transaction-manager';

// Pipeline orchestrator
export {
  PipelineOrchestratorConfig,
  AuditLogger,
  PHIAccessEntry,
  MLServiceCallEntry,
  MetricsCollector,
  PipelineOrchestrator,
  createPipelineOrchestrator,
} from './pipeline-orchestrator';
