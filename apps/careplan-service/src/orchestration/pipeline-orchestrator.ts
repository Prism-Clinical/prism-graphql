/**
 * Pipeline Orchestrator
 *
 * Coordinates ML service calls for care plan generation.
 */

import { v4 as uuidv4 } from 'uuid';
import { Redis } from 'ioredis';
import { Pool } from 'pg';

import {
  PipelineInput,
  PipelineOutput,
  PipelineStage,
  StageStatus,
  StageResult,
  ProcessingMetadata,
  ExtractedEntities,
  CarePlanRecommendation,
  DraftCarePlan,
  RedFlag,
  RedFlagSeverity,
  PipelineError,
  PipelineErrorCategory,
  ErrorSeverity,
  createRequestId,
  validatePipelineInput,
} from './types';

import {
  PipelineErrorAggregator,
  createPipelineError,
  determineRecoveryAction,
  RecoveryAction,
  AlertConfig,
  processAlerts,
} from './error-handler';

import {
  getFallbackExtractionResult,
  getManualReviewRedFlag,
  getDefaultTemplateRecommendations,
  getFallbackDraftCarePlan,
  skipPersonalization,
  combineRedFlags,
  requiresManualReview,
} from './recovery-strategies';

import { DataMinimizer, dataMinimizer, DataSharingAuditEntry } from './data-minimizer';
import { PipelineCache } from './pipeline-cache';
import { IdempotencyManager, IdempotencyStatus } from './idempotency';

// Import ML clients (these would come from @prism/service-clients)
import type {
  MLClientFactory,
  AudioIntelligenceClient,
  CarePlanRecommenderClient,
  RagEmbeddingsClient,
} from '@prism/service-clients';

/**
 * Pipeline orchestrator configuration
 */
export interface PipelineOrchestratorConfig {
  /** ML client factory */
  mlClientFactory: MLClientFactory;
  /** Redis client for caching */
  redis: Redis;
  /** Database pool */
  pool: Pool;
  /** Audit logger callback */
  auditLogger: AuditLogger;
  /** Alert configuration */
  alertConfig?: AlertConfig;
  /** Maximum retries per stage */
  maxRetries?: number;
  /** Stage timeout in milliseconds */
  stageTimeoutMs?: number;
  /** Enable caching */
  enableCaching?: boolean;
  /** Enable idempotency */
  enableIdempotency?: boolean;
  /** Cache encryption key */
  cacheEncryptionKey?: Buffer;
}

/**
 * Audit logger interface
 */
export interface AuditLogger {
  logPHIAccess(entry: PHIAccessEntry): Promise<void>;
  logMLServiceCall(entry: MLServiceCallEntry): Promise<void>;
  logDataSharing(entry: DataSharingAuditEntry): Promise<void>;
}

/**
 * PHI access audit entry
 */
export interface PHIAccessEntry {
  eventType: 'PHI_ACCESS';
  userId: string;
  userRole: string;
  patientId: string;
  resourceType: string;
  action: 'READ' | 'PROCESS';
  phiFields: string[];
  correlationId: string;
  requestId: string;
  outcome: 'SUCCESS' | 'FAILURE';
}

/**
 * ML service call audit entry
 */
export interface MLServiceCallEntry {
  eventType: 'ML_SERVICE_CALL';
  service: string;
  endpoint: string;
  userId: string;
  patientId?: string;
  correlationId: string;
  requestId: string;
  durationMs: number;
  outcome: 'SUCCESS' | 'FAILURE' | 'FALLBACK';
  cacheHit?: boolean;
}

/**
 * Metrics collector interface
 */
export interface MetricsCollector {
  recordStageLatency(stage: PipelineStage, durationMs: number): void;
  recordPipelineRequest(status: 'success' | 'failure' | 'degraded'): void;
  recordMLServiceCall(service: string, status: string, durationMs: number): void;
  recordCacheHit(type: string, hit: boolean): void;
}

/**
 * Default metrics collector (no-op)
 */
const noopMetrics: MetricsCollector = {
  recordStageLatency: () => {},
  recordPipelineRequest: () => {},
  recordMLServiceCall: () => {},
  recordCacheHit: () => {},
};

/**
 * Pipeline Orchestrator
 */
export class PipelineOrchestrator {
  private config: Required<PipelineOrchestratorConfig>;
  private cache: PipelineCache;
  private idempotency: IdempotencyManager;
  private metrics: MetricsCollector = noopMetrics;

  // ML clients
  private audioClient: AudioIntelligenceClient;
  private recommenderClient: CarePlanRecommenderClient;
  private ragClient: RagEmbeddingsClient;

  constructor(config: PipelineOrchestratorConfig) {
    this.config = {
      maxRetries: 3,
      stageTimeoutMs: 30000,
      enableCaching: true,
      enableIdempotency: true,
      alertConfig: {},
      ...config,
    } as Required<PipelineOrchestratorConfig>;

    // Initialize cache
    this.cache = new PipelineCache({
      redis: config.redis,
      encryptionKey: config.cacheEncryptionKey,
      onCacheAccess: async (entry) => {
        // Log cache access for audit
        if (entry.containsPHI) {
          await this.config.auditLogger.logPHIAccess({
            eventType: 'PHI_ACCESS',
            userId: 'system',
            userRole: 'system',
            patientId: '',
            resourceType: 'cache',
            action: entry.operation === 'GET' ? 'READ' : 'PROCESS',
            phiFields: ['cached_data'],
            correlationId: entry.correlationId ?? '',
            requestId: '',
            outcome: entry.success ? 'SUCCESS' : 'FAILURE',
          });
        }
      },
    });

    // Initialize idempotency manager
    this.idempotency = new IdempotencyManager({
      pool: config.pool,
      expirationHours: 24,
    });

    // Get ML clients from factory
    this.audioClient = config.mlClientFactory.createAudioIntelligenceClient();
    this.recommenderClient = config.mlClientFactory.createRecommenderClient();
    this.ragClient = config.mlClientFactory.createRagEmbeddingsClient();
  }

  /**
   * Set metrics collector
   */
  setMetricsCollector(metrics: MetricsCollector): void {
    this.metrics = metrics;
  }

  /**
   * Process pipeline request
   */
  async process(input: PipelineInput): Promise<PipelineOutput> {
    const startTime = Date.now();
    const requestId = createRequestId();
    const stageResults: StageResult[] = [];
    const errorAggregator = new PipelineErrorAggregator();
    const fallbacksUsed: string[] = [];
    const modelVersions: Record<string, string> = {};

    let extractedEntities: ExtractedEntities | undefined;
    let recommendations: CarePlanRecommendation[] = [];
    let draftCarePlan: DraftCarePlan | undefined;
    let redFlags: RedFlag[] = [];
    let overallCacheHit = false;

    try {
      // Stage 1: Validation
      const validationResult = await this.executeStage(
        PipelineStage.VALIDATION,
        async () => {
          if (!validatePipelineInput(input)) {
            throw new Error('Invalid pipeline input');
          }

          // Log PHI access
          await this.config.auditLogger.logPHIAccess({
            eventType: 'PHI_ACCESS',
            userId: input.userId,
            userRole: input.userRole,
            patientId: input.patientId,
            resourceType: 'pipeline_input',
            action: 'PROCESS',
            phiFields: input.transcriptText ? ['transcriptText'] : [],
            correlationId: input.correlationId,
            requestId,
            outcome: 'SUCCESS',
          });

          return { validated: true };
        },
        requestId,
        input.correlationId
      );
      stageResults.push(validationResult);

      if (validationResult.status === StageStatus.FAILED) {
        throw new Error('Validation failed');
      }

      // Check idempotency
      if (this.config.enableIdempotency) {
        const idempotencyCheck = await this.idempotency.checkOrCreate(
          input.idempotencyKey,
          input
        );

        if (idempotencyCheck.status === IdempotencyStatus.COMPLETED) {
          // Return cached response
          return idempotencyCheck.response as PipelineOutput;
        }

        if (idempotencyCheck.status === IdempotencyStatus.PENDING) {
          // Another request is processing
          throw new Error('Request already in progress');
        }

        if (idempotencyCheck.status === IdempotencyStatus.FAILED) {
          throw new Error(idempotencyCheck.error?.message ?? 'Previous request failed');
        }
      }

      // Stage 2: Entity Extraction (if transcript provided)
      if (input.transcriptText) {
        const extractionResult = await this.executeStage(
          PipelineStage.ENTITY_EXTRACTION,
          async () => {
            // Check cache first
            if (this.config.enableCaching) {
              const cached = await this.cache.getCachedExtraction(
                input.transcriptText!,
                input.correlationId
              );
              if (cached) {
                this.metrics.recordCacheHit('extraction', true);
                overallCacheHit = true;
                return { entities: cached, cacheHit: true };
              }
              this.metrics.recordCacheHit('extraction', false);
            }

            // Minimize data before sending
            const minimalContext = dataMinimizer.getAudioIntelligenceContext({
              patientId: input.patientId,
              conditionCodes: input.conditionCodes,
              transcriptText: input.transcriptText,
            });

            if (!minimalContext) {
              throw new Error('No transcript text provided');
            }

            // Log data sharing
            await this.config.auditLogger.logDataSharing(
              dataMinimizer.createDataSharingAuditEntry(
                'audio-intelligence',
                minimalContext as unknown as Record<string, unknown>,
                input.correlationId
              )
            );

            // Call ML service
            const response = await this.audioClient.extract({
              transcriptText: minimalContext.transcriptText,
            });

            // Map response to our types
            const entities: ExtractedEntities = {
              symptoms: response.symptoms ?? [],
              medications: response.medications ?? [],
              vitals: response.vitals ?? [],
              procedures: [],
              diagnoses: [],
              allergies: [],
              extractedAt: new Date(),
              modelVersion: response.nluTier ?? 'unknown',
            };

            // Extract red flags
            if (response.redFlags) {
              redFlags = response.redFlags.map((rf: any) => ({
                severity: rf.severity as RedFlagSeverity,
                description: rf.description,
                sourceText: rf.sourceText,
                recommendedAction: rf.recommendedAction,
                category: rf.category ?? 'clinical',
                confidence: rf.confidence ?? 0.8,
              }));
            }

            // Cache result
            if (this.config.enableCaching) {
              await this.cache.cacheExtraction(
                input.transcriptText!,
                entities,
                input.correlationId
              );
            }

            modelVersions['audio-intelligence'] = entities.modelVersion;
            return { entities, cacheHit: false };
          },
          requestId,
          input.correlationId,
          errorAggregator
        );
        stageResults.push(extractionResult);

        if (extractionResult.status === StageStatus.COMPLETED && extractionResult.result) {
          extractedEntities = extractionResult.result.entities;
          if (extractionResult.result.cacheHit) {
            extractionResult.cacheHit = true;
          }
        } else if (extractionResult.status === StageStatus.FAILED) {
          // Use fallback
          extractedEntities = getFallbackExtractionResult();
          redFlags.push(getManualReviewRedFlag());
          fallbacksUsed.push('audio-intelligence');
        }
      }

      // Stage 3: Embedding Generation (parallel with some other operations)
      let embedding: number[] | null = null;
      let useConditionOnlyMatching = false;

      const embeddingResult = await this.executeStage(
        PipelineStage.EMBEDDING_GENERATION,
        async () => {
          // Minimize data
          const minimalContext = dataMinimizer.getRagEmbeddingsContext({
            patientId: input.patientId,
            conditionCodes: input.conditionCodes,
            chiefComplaint: extractedEntities?.symptoms?.[0]?.text,
          });

          // Log data sharing
          await this.config.auditLogger.logDataSharing(
            dataMinimizer.createDataSharingAuditEntry(
              'rag-embeddings',
              minimalContext as unknown as Record<string, unknown>,
              input.correlationId
            )
          );

          // Generate patient context embedding
          const embeddingVector = await this.ragClient.embedPatientContext({
            conditionCodes: minimalContext.conditionCodes,
            symptoms: minimalContext.chiefComplaint ? [minimalContext.chiefComplaint] : undefined,
          });

          modelVersions['rag-embeddings'] = 'unknown';
          return { embedding: embeddingVector };
        },
        requestId,
        input.correlationId,
        errorAggregator
      );
      stageResults.push(embeddingResult);

      if (embeddingResult.status === StageStatus.COMPLETED && embeddingResult.result) {
        embedding = embeddingResult.result.embedding;
      } else {
        // Skip personalization on failure
        const fallback = skipPersonalization();
        useConditionOnlyMatching = fallback.useConditionOnlyMatching;
        fallbacksUsed.push('rag-embeddings');
      }

      // Stage 4: Template Recommendation
      const recommendationResult = await this.executeStage(
        PipelineStage.TEMPLATE_RECOMMENDATION,
        async () => {
          // Check cache first
          if (this.config.enableCaching) {
            const cached = await this.cache.getCachedRecommendations(
              input.conditionCodes,
              { age: undefined, gender: undefined }, // Minimal context
              input.correlationId
            );
            if (cached) {
              this.metrics.recordCacheHit('recommendation', true);
              overallCacheHit = true;
              return { recommendations: cached, cacheHit: true };
            }
            this.metrics.recordCacheHit('recommendation', false);
          }

          // Minimize data
          const minimalContext = dataMinimizer.getCarePlanRecommenderContext({
            patientId: input.patientId,
            conditionCodes: input.conditionCodes,
          });

          // Log data sharing
          await this.config.auditLogger.logDataSharing(
            dataMinimizer.createDataSharingAuditEntry(
              'careplan-recommender',
              minimalContext as unknown as Record<string, unknown>,
              input.correlationId
            )
          );

          // Call recommender with or without personalization
          let response;
          if (useConditionOnlyMatching || !embedding) {
            response = await this.recommenderClient.recommend({
              conditionCodes: minimalContext.conditionCodes,
            });
          } else {
            response = await this.recommenderClient.recommendWithContext({
              conditionCodes: minimalContext.conditionCodes,
              demographics: {
                age: minimalContext.age,
                sex: minimalContext.gender === 'male' ? 'M' : minimalContext.gender === 'female' ? 'F' : undefined,
              },
            });
          }

          const recs: CarePlanRecommendation[] = (response.templates ?? []).map(
            (r: any): CarePlanRecommendation => ({
              templateId: r.templateId,
              title: r.name,
              confidence: r.confidence,
              matchedConditions: r.conditionCodes ?? [],
              reasoning: r.matchFactors ? `Match factors: ${JSON.stringify(r.matchFactors)}` : undefined,
              guidelineSource: undefined as string | undefined,
              evidenceGrade: undefined as string | undefined,
            })
          );

          // Cache result
          if (this.config.enableCaching) {
            await this.cache.cacheRecommendations(
              input.conditionCodes,
              { age: undefined, gender: undefined },
              recs,
              input.correlationId
            );
          }

          modelVersions['careplan-recommender'] = response.modelVersion ?? 'unknown';
          return { recommendations: recs, cacheHit: false };
        },
        requestId,
        input.correlationId,
        errorAggregator
      );
      stageResults.push(recommendationResult);

      if (recommendationResult.status === StageStatus.COMPLETED && recommendationResult.result) {
        recommendations = recommendationResult.result.recommendations;
        if (recommendationResult.result.cacheHit) {
          recommendationResult.cacheHit = true;
        }
      } else {
        // Use fallback recommendations
        recommendations = getDefaultTemplateRecommendations(input.conditionCodes);
        fallbacksUsed.push('careplan-recommender');
      }

      // Stage 5: Draft Generation (optional)
      if (input.generateDraft !== false && recommendations.length > 0) {
        const draftResult = await this.executeStage(
          PipelineStage.DRAFT_GENERATION,
          async () => {
            // Use the top recommendation for draft
            const topRecommendation = recommendations[0];

            const response = await this.recommenderClient.generateDraft(
              [topRecommendation.templateId],
              {
                conditionCodes: input.conditionCodes,
              }
            );

            // Get the first draft from the response
            const generatedDraft = response.drafts?.[0];

            const draft: DraftCarePlan = {
              id: uuidv4(),
              title: generatedDraft?.title ?? `Care Plan for ${input.conditionCodes.join(', ')}`,
              conditionCodes: input.conditionCodes,
              templateId: topRecommendation.templateId,
              goals: (generatedDraft?.goals ?? []).map((g: any) => ({
                description: g.description,
                targetValue: g.targetValue,
                targetDate: g.targetDate ? new Date(g.targetDate) : undefined,
                priority: g.priority ?? 'MEDIUM',
                guidelineReference: g.guidelineReference,
              })),
              interventions: (generatedDraft?.interventions ?? []).map((i: any) => ({
                type: i.type,
                description: i.description,
                medicationCode: i.medicationCode,
                dosage: i.dosage,
                frequency: i.frequency,
                procedureCode: i.procedureCode,
                scheduledDate: i.scheduledDate ? new Date(i.scheduledDate) : undefined,
                patientInstructions: i.patientInstructions,
                guidelineReference: i.guidelineReference,
              })),
              generatedAt: new Date(),
              confidence: generatedDraft?.confidenceScore ?? topRecommendation.confidence,
              requiresReview: (generatedDraft?.confidenceScore ?? 1) < 0.8,
            };

            return { draft };
          },
          requestId,
          input.correlationId,
          errorAggregator
        );
        stageResults.push(draftResult);

        if (draftResult.status === StageStatus.COMPLETED && draftResult.result) {
          draftCarePlan = draftResult.result.draft;
        } else {
          // Use fallback draft
          draftCarePlan = getFallbackDraftCarePlan(
            input.conditionCodes,
            recommendations[0]?.templateId
          );
          fallbacksUsed.push('draft-generation');
        }
      }

      // Stage 6: Safety Validation
      const safetyResult = await this.executeStage(
        PipelineStage.SAFETY_VALIDATION,
        async () => {
          // Basic safety checks
          const safetyFlags: RedFlag[] = [];

          // Check for critical drug interactions if medications present
          if (extractedEntities?.medications && extractedEntities.medications.length > 1) {
            // In production, this would call a drug interaction service
            safetyFlags.push({
              severity: RedFlagSeverity.LOW,
              description: 'Multiple medications detected. Review for potential interactions.',
              category: 'medications',
              confidence: 0.7,
              recommendedAction: 'Verify medication compatibility',
            });
          }

          // Check for missing required information
          if (!extractedEntities && input.transcriptText) {
            safetyFlags.push({
              severity: RedFlagSeverity.MEDIUM,
              description: 'Entity extraction incomplete. Manual review recommended.',
              category: 'data_quality',
              confidence: 1.0,
              recommendedAction: 'Review transcript manually',
            });
          }

          return { flags: safetyFlags, passed: true };
        },
        requestId,
        input.correlationId,
        errorAggregator
      );
      stageResults.push(safetyResult);

      if (safetyResult.status === StageStatus.COMPLETED && safetyResult.result) {
        redFlags = combineRedFlags(redFlags, safetyResult.result.flags, []);
      }

      // Build final output
      const degradedServices = errorAggregator.getDegradedServices();
      const manualReviewRequired = requiresManualReview(
        redFlags,
        degradedServices,
        draftCarePlan?.confidence
      );

      const processingMetadata: ProcessingMetadata = {
        requestId,
        correlationId: input.correlationId,
        totalDurationMs: Date.now() - startTime,
        stageResults,
        cacheHit: overallCacheHit,
        modelVersions,
        processedAt: new Date(),
      };

      const output: PipelineOutput = {
        requestId,
        extractedEntities,
        recommendations,
        draftCarePlan,
        redFlags,
        processingMetadata,
        degradedServices,
        requiresManualReview: manualReviewRequired,
      };

      // Update idempotency with success
      if (this.config.enableIdempotency) {
        await this.idempotency.complete(input.idempotencyKey, requestId, output);
      }

      // Record metrics
      this.metrics.recordPipelineRequest(
        degradedServices.length > 0 ? 'degraded' : 'success'
      );

      return output;
    } catch (error) {
      // Update idempotency with failure
      if (this.config.enableIdempotency) {
        await this.idempotency.fail(input.idempotencyKey, requestId, {
          message: (error as Error).message,
          code: 'PIPELINE_ERROR',
        });
      }

      // Record failure metric
      this.metrics.recordPipelineRequest('failure');

      throw error;
    }
  }

  /**
   * Execute a single pipeline stage
   */
  private async executeStage<T>(
    stage: PipelineStage,
    executor: () => Promise<T>,
    requestId: string,
    correlationId: string,
    errorAggregator?: PipelineErrorAggregator
  ): Promise<StageResult & { result?: T }> {
    const startTime = Date.now();
    let retryCount = 0;

    while (retryCount <= this.config.maxRetries) {
      try {
        const result = await Promise.race([
          executor(),
          this.timeout<T>(this.config.stageTimeoutMs, stage),
        ]);

        const durationMs = Date.now() - startTime;
        this.metrics.recordStageLatency(stage, durationMs);

        return {
          stage,
          status: StageStatus.COMPLETED,
          durationMs,
          result,
        };
      } catch (error) {
        const err = error as Error;
        const pipelineError = createPipelineError(
          this.categorizeError(err),
          stage,
          correlationId,
          err,
          { retryCount }
        );

        const action = determineRecoveryAction(pipelineError, retryCount, this.config.maxRetries);

        // Process alerts
        if (this.config.alertConfig) {
          await processAlerts(pipelineError, this.getServiceForStage(stage), this.config.alertConfig);
        }

        switch (action) {
          case RecoveryAction.RETRY:
            retryCount++;
            await this.sleep(Math.pow(2, retryCount) * 100); // Exponential backoff
            continue;

          case RecoveryAction.ABORT:
            errorAggregator?.addError(pipelineError, this.getServiceForStage(stage));
            throw err;

          default:
            errorAggregator?.addError(pipelineError, this.getServiceForStage(stage));
            return {
              stage,
              status: StageStatus.FAILED,
              durationMs: Date.now() - startTime,
              error: pipelineError.message,
            };
        }
      }
    }

    // Max retries exceeded
    return {
      stage,
      status: StageStatus.FAILED,
      durationMs: Date.now() - startTime,
      error: 'Max retries exceeded',
    };
  }

  /**
   * Create timeout promise
   */
  private timeout<T>(ms: number, stage: PipelineStage): Promise<T> {
    return new Promise((_, reject) => {
      setTimeout(() => {
        reject(new Error(`Stage ${stage} timed out after ${ms}ms`));
      }, ms);
    });
  }

  /**
   * Sleep utility
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Categorize error into pipeline error category
   */
  private categorizeError(error: Error): PipelineErrorCategory {
    const message = error.message.toLowerCase();

    if (message.includes('timeout')) return PipelineErrorCategory.TIMEOUT;
    if (message.includes('rate limit')) return PipelineErrorCategory.RATE_LIMITED;
    if (message.includes('unauthorized') || message.includes('authentication'))
      return PipelineErrorCategory.AUTHENTICATION_FAILED;
    if (message.includes('forbidden') || message.includes('permission'))
      return PipelineErrorCategory.AUTHORIZATION_FAILED;
    if (message.includes('service unavailable') || message.includes('503'))
      return PipelineErrorCategory.SERVICE_UNAVAILABLE;
    if (message.includes('validation')) return PipelineErrorCategory.VALIDATION_FAILED;

    return PipelineErrorCategory.INTERNAL_ERROR;
  }

  /**
   * Get service name for stage
   */
  private getServiceForStage(stage: PipelineStage): string | undefined {
    switch (stage) {
      case PipelineStage.ENTITY_EXTRACTION:
        return 'audio-intelligence';
      case PipelineStage.EMBEDDING_GENERATION:
        return 'rag-embeddings';
      case PipelineStage.TEMPLATE_RECOMMENDATION:
      case PipelineStage.DRAFT_GENERATION:
        return 'careplan-recommender';
      default:
        return undefined;
    }
  }

  /**
   * Get circuit breaker states
   */
  getCircuitStates(): Record<string, string> {
    return this.config.mlClientFactory.getCircuitStates();
  }

  /**
   * Reset all circuit breakers
   */
  resetCircuits(): void {
    this.config.mlClientFactory.resetAllCircuits();
  }

  /**
   * Get cache statistics
   */
  async getCacheStats(): Promise<{
    extractionCount: number;
    recommendationCount: number;
    totalCount: number;
  }> {
    return this.cache.getStats();
  }

  /**
   * Invalidate caches
   */
  async invalidateCache(type: 'extraction' | 'recommendation' | 'all'): Promise<void> {
    if (type === 'extraction' || type === 'all') {
      await this.cache.invalidateAllPHI();
    }
    if (type === 'recommendation' || type === 'all') {
      await this.cache.invalidateRecommendations([]);
    }
  }
}

/**
 * Create pipeline orchestrator with default configuration
 */
export function createPipelineOrchestrator(
  config: PipelineOrchestratorConfig
): PipelineOrchestrator {
  return new PipelineOrchestrator(config);
}
