/**
 * PRISM Service Clients
 *
 * HTTP clients for PRISM ML services with retry, circuit breaker, and service auth.
 *
 * @example
 * ```typescript
 * import {
 *   getMLClientFactory,
 *   AudioIntelligenceClient,
 *   CarePlanRecommenderClient,
 *   RagEmbeddingsClient,
 *   PdfParserClient,
 * } from '@prism/service-clients';
 *
 * // Get factory with shared configuration
 * const factory = getMLClientFactory({
 *   urls: {
 *     audioIntelligence: 'http://localhost:8101',
 *     carePlanRecommender: 'http://localhost:8100',
 *     ragEmbeddings: 'http://localhost:8103',
 *     pdfParser: 'http://localhost:8102',
 *   },
 *   timeout: 30000,
 *   enableFallbacks: true,
 * });
 *
 * // Get clients (singleton per factory)
 * const audioClient = factory.createAudioIntelligenceClient();
 * const recommenderClient = factory.createRecommenderClient();
 *
 * // Extract entities from transcript
 * const entities = await audioClient.extract({
 *   transcriptText: 'Patient reports chest pain...',
 * });
 *
 * // Get care plan recommendations
 * const recommendations = await recommenderClient.recommend({
 *   conditionCodes: ['E11.9', 'I10'],
 * });
 *
 * // Check all service health
 * const health = await factory.checkAllServices();
 * console.log('Overall status:', health.overall);
 * ```
 */

// Common utilities
export {
  // Types
  CircuitState,
  CircuitBreakerConfig,
  RetryConfig,
  ServiceClientConfig,
  RequestOptions,
  ServiceResponse,
  HealthStatus,
  DEFAULT_RETRY_CONFIG,
  DEFAULT_CIRCUIT_BREAKER_CONFIG,
  DEFAULT_TIMEOUT,
  // Circuit Breaker
  CircuitBreaker,
  CircuitBreakerError,
  CircuitBreakerRegistry,
  circuitBreakerRegistry,
  // Retry
  retry,
  retryWithAbort,
  isRetryableError,
  calculateDelay,
  sleep,
  createRetryWrapper,
  AbortError,
  // HTTP Client
  BaseHttpClient,
  HttpError,
} from './common';

// Audio Intelligence
export {
  // Types
  NLUTier,
  SpeakerSegment,
  ExtractionRequest,
  ExtractionResponse,
  BatchExtractionRequest,
  BatchExtractionResponse,
  TranscriptionRequest,
  TranscriptionResponse,
  TranscriptionStatus,
  EntityResponse,
  PatternMatchResponse,
  RedFlagResponse,
  FALLBACK_EXTRACTION_RESPONSE,
  // Client
  AudioIntelligenceClient,
  AudioIntelligenceClientConfig,
  createAudioIntelligenceClient,
} from './audio-intelligence';

// Care Plan Recommender
export {
  // Types
  PatientDemographics,
  SimpleRecommendRequest,
  FullContextRequest,
  EngineRecommendRequest,
  TemplateRecommendation,
  MatchFactors,
  DraftGoal,
  DraftIntervention,
  DraftCarePlan,
  RecommendResponse,
  TrainingJobStatus,
  TrainingJobResponse,
  FALLBACK_RECOMMEND_RESPONSE,
  // Client
  CarePlanRecommenderClient,
  RecommenderClientConfig,
  createCarePlanRecommenderClient,
} from './careplan-recommender';

// RAG Embeddings
export {
  // Types
  EmbeddingType,
  EvidenceGrade,
  GuidelineSource,
  RawTextRequest,
  PatientContextRequest,
  GuidelineEmbedRequest,
  BatchGuidelineRequest,
  BatchGuidelineResponse,
  TemplateEmbedRequest,
  BatchTemplateRequest,
  BatchTemplateResponse,
  SimilaritySearchRequest,
  SimilaritySearchResponse,
  SimilarityResult,
  EmbeddingResponse,
  BatchEmbeddingResponse,
  GuidelineEmbeddingResult,
  TemplateEmbeddingResult,
  EMBEDDING_DIMENSION,
  // Client
  RagEmbeddingsClient,
  RagEmbeddingsClientConfig,
  createRagEmbeddingsClient,
} from './rag-embeddings';

// PDF Parser
export {
  // Types
  CodeSystem,
  Priority,
  InterventionType,
  CarePlanCategory,
  ExtractedCode,
  SuggestedGoal,
  SuggestedIntervention,
  ParsedCarePlanResponse,
  ParsePreviewResponse,
  FileValidationResult,
  MAX_FILE_SIZE,
  PDF_MAGIC_BYTES,
  // Client
  PdfParserClient,
  PdfParserClientConfig,
  createPdfParserClient,
} from './pdf-parser';

// ML Client Factory
export {
  // Config
  MLServiceUrls,
  MLClientConfig,
  getDefaultUrls,
  getDefaultMLConfig,
  createMLConfigFromEnv,
  ML_CONFIG_ENV_VARS,
  // Factory
  MLClientFactory,
  ServiceHealthStatus,
  AggregatedHealthStatus,
  createMLClientFactory,
  getMLClientFactory,
  resetMLClientFactory,
} from './ml-clients';
