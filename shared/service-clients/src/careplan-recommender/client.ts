/**
 * Care Plan Recommender Client
 *
 * HTTP client for the Care Plan Recommender ML service.
 */

import * as crypto from 'crypto';
import { Redis } from 'ioredis';
import { BaseHttpClient, ServiceClientConfig, RequestOptions, HealthStatus } from '../common';
import {
  SimpleRecommendRequest,
  FullContextRequest,
  EngineRecommendRequest,
  RecommendResponse,
  TrainingJobResponse,
  FALLBACK_RECOMMEND_RESPONSE,
} from './types';

/**
 * ICD-10 code validation pattern
 */
const ICD10_PATTERN = /^[A-Z]\d{2}(\.\d{1,4})?$/i;

/**
 * Care Plan Recommender client configuration
 */
export interface RecommenderClientConfig extends Partial<ServiceClientConfig> {
  /** Base URL of the Recommender service */
  baseUrl: string;
  /** Redis client for caching */
  redis?: Redis;
  /** Cache TTL in seconds */
  cacheTTL?: number;
  /** ICD-10 code allowlist (if set, only these codes are allowed) */
  allowedICD10Codes?: Set<string>;
}

/**
 * Care Plan Recommender Client
 *
 * Provides methods for getting care plan template recommendations
 * and generating draft care plans based on patient context.
 */
export class CarePlanRecommenderClient extends BaseHttpClient {
  private redis: Redis | null = null;
  private cacheTTL: number;
  private allowedCodes: Set<string> | null = null;
  private fallbackEnabled = true;

  constructor(config: RecommenderClientConfig) {
    super({
      ...config,
      serviceName: 'careplan-recommender',
      timeout: config.timeout ?? 30000,
    });

    this.redis = config.redis ?? null;
    this.cacheTTL = config.cacheTTL ?? 300; // 5 minutes default
    this.allowedCodes = config.allowedICD10Codes ?? null;
  }

  /**
   * Set Redis client for caching
   */
  setRedisClient(redis: Redis): void {
    this.redis = redis;
  }

  /**
   * Set allowed ICD-10 codes
   */
  setAllowedCodes(codes: string[]): void {
    this.allowedCodes = new Set(codes.map((c) => c.toUpperCase()));
  }

  /**
   * Simple recommendation based on condition codes only
   */
  async recommend(
    request: SimpleRecommendRequest,
    options?: RequestOptions
  ): Promise<RecommendResponse> {
    // Validate ICD-10 codes
    this.validateConditionCodes(request.conditionCodes);

    // Check cache
    const cacheKey = this.buildCacheKey('simple', request);
    const cached = await this.getFromCache<RecommendResponse>(cacheKey);
    if (cached) {
      return cached;
    }

    try {
      const response = await this.post<Record<string, unknown>>(
        '/api/v1/recommend',
        {
          condition_codes: request.conditionCodes,
          max_results: request.maxResults ?? 5,
          include_drafts: request.includeDrafts ?? false,
        },
        options
      );

      const result = this.transformResponse(response.data);

      // Cache successful response
      await this.setInCache(cacheKey, result, true);

      return result;
    } catch (error) {
      if (this.fallbackEnabled) {
        console.warn('[Recommender] Recommendation failed, returning fallback:', error);
        return FALLBACK_RECOMMEND_RESPONSE;
      }
      throw error;
    }
  }

  /**
   * Full context recommendation with patient details
   */
  async recommendWithContext(
    request: FullContextRequest,
    options?: RequestOptions
  ): Promise<RecommendResponse> {
    // Validate ICD-10 codes
    this.validateConditionCodes(request.conditionCodes);

    // Check cache
    const cacheKey = this.buildCacheKey('full', request);
    const cached = await this.getFromCache<RecommendResponse>(cacheKey);
    if (cached) {
      return cached;
    }

    try {
      const response = await this.post<Record<string, unknown>>(
        '/api/v1/recommend/full',
        {
          condition_codes: request.conditionCodes,
          condition_names: request.conditionNames,
          medication_codes: request.medicationCodes,
          medication_names: request.medicationNames,
          lab_codes: request.labCodes,
          lab_values: request.labValues,
          demographics: request.demographics
            ? {
                age: request.demographics.age,
                sex: request.demographics.sex,
                race: request.demographics.race,
                ethnicity: request.demographics.ethnicity,
              }
            : undefined,
          risk_factors: request.riskFactors,
          complications: request.complications,
          max_results: request.maxResults ?? 5,
          include_drafts: request.includeDrafts ?? true,
        },
        options
      );

      const result = this.transformResponse(response.data);

      // Cache successful response (contains PHI context, use encrypted cache)
      await this.setInCache(cacheKey, result, true);

      return result;
    } catch (error) {
      if (this.fallbackEnabled) {
        console.warn('[Recommender] Full context recommendation failed:', error);
        return FALLBACK_RECOMMEND_RESPONSE;
      }
      throw error;
    }
  }

  /**
   * Three-layer engine recommendation
   */
  async engineRecommend(
    request: EngineRecommendRequest,
    options?: RequestOptions
  ): Promise<RecommendResponse> {
    // Validate ICD-10 codes
    this.validateConditionCodes(request.conditionCodes);

    try {
      const response = await this.post<Record<string, unknown>>(
        '/api/v1/engine/recommend',
        {
          condition_codes: request.conditionCodes,
          condition_names: request.conditionNames,
          medication_codes: request.medicationCodes,
          medication_names: request.medicationNames,
          lab_codes: request.labCodes,
          lab_values: request.labValues,
          demographics: request.demographics
            ? {
                age: request.demographics.age,
                sex: request.demographics.sex,
                race: request.demographics.race,
                ethnicity: request.demographics.ethnicity,
              }
            : undefined,
          risk_factors: request.riskFactors,
          complications: request.complications,
          max_results: request.maxResults ?? 5,
          include_drafts: request.includeDrafts ?? true,
          query_mode: request.queryMode ?? 'hybrid',
          enable_personalization: request.enablePersonalization ?? true,
          provider_preferences: request.providerPreferences
            ? {
                provider_id: request.providerPreferences.providerId,
                preferred_template_ids: request.providerPreferences.preferredTemplateIds,
              }
            : undefined,
        },
        options
      );

      return this.transformResponse(response.data);
    } catch (error) {
      if (this.fallbackEnabled) {
        console.warn('[Recommender] Engine recommendation failed:', error);
        return FALLBACK_RECOMMEND_RESPONSE;
      }
      throw error;
    }
  }

  /**
   * Generate a draft care plan from template IDs
   */
  async generateDraft(
    templateIds: string[],
    context: FullContextRequest,
    options?: RequestOptions
  ): Promise<RecommendResponse> {
    const response = await this.post<Record<string, unknown>>(
      '/api/v1/draft',
      {
        template_ids: templateIds,
        context: {
          condition_codes: context.conditionCodes,
          condition_names: context.conditionNames,
          demographics: context.demographics,
          risk_factors: context.riskFactors,
          complications: context.complications,
        },
      },
      options
    );

    return this.transformResponse(response.data);
  }

  /**
   * Get training job status
   */
  async getTrainingJob(jobId: string, options?: RequestOptions): Promise<TrainingJobResponse> {
    const response = await this.get<Record<string, unknown>>(
      `/api/v1/training/${jobId}`,
      options
    );

    return this.transformTrainingResponse(response.data);
  }

  /**
   * Health check
   */
  async healthCheck(): Promise<HealthStatus> {
    return super.healthCheck();
  }

  /**
   * Enable or disable fallback mode
   */
  setFallbackEnabled(enabled: boolean): void {
    this.fallbackEnabled = enabled;
  }

  /**
   * Invalidate cache for condition codes
   */
  async invalidateCacheForConditions(conditionCodes: string[]): Promise<void> {
    if (!this.redis) return;

    // Build pattern to match any cache keys containing these codes
    const sortedCodes = [...conditionCodes].sort().join(',');
    const pattern = `recommend:*:${sortedCodes}:*`;

    const keys = await this.redis.keys(pattern);
    if (keys.length > 0) {
      await this.redis.del(...keys);
    }
  }

  /**
   * Validate condition codes against ICD-10 format and allowlist
   */
  private validateConditionCodes(codes: string[]): void {
    if (!codes || codes.length === 0) {
      throw new Error('At least one condition code is required');
    }

    for (const code of codes) {
      // Check format
      const normalized = code.toUpperCase().replace(/[.\-\s]/g, '');
      if (!ICD10_PATTERN.test(code) && normalized.length < 3) {
        throw new Error(`Invalid ICD-10 code format: ${code}`);
      }

      // Check allowlist if configured
      if (this.allowedCodes && !this.allowedCodes.has(normalized)) {
        throw new Error(`ICD-10 code not in allowlist: ${code}`);
      }
    }
  }

  /**
   * Build cache key for request
   */
  private buildCacheKey(type: string, request: SimpleRecommendRequest | FullContextRequest): string {
    const sortedCodes = [...request.conditionCodes].sort().join(',');
    const contextHash = this.hashObject(request);
    return `recommend:${type}:${sortedCodes}:${contextHash}`;
  }

  /**
   * Hash an object for cache key
   */
  private hashObject(obj: unknown): string {
    const str = JSON.stringify(obj);
    return crypto.createHash('sha256').update(str).digest('hex').substring(0, 16);
  }

  /**
   * Get from cache
   */
  private async getFromCache<T>(key: string): Promise<T | null> {
    if (!this.redis) return null;

    try {
      const cached = await this.redis.get(key);
      if (cached) {
        return JSON.parse(cached) as T;
      }
    } catch (error) {
      console.warn('[Recommender] Cache read error:', error);
    }

    return null;
  }

  /**
   * Set in cache
   */
  private async setInCache(key: string, value: unknown, containsPHI: boolean): Promise<void> {
    if (!this.redis) return;

    try {
      // Use shorter TTL for PHI-containing data
      const ttl = containsPHI ? Math.min(this.cacheTTL, 300) : this.cacheTTL;
      await this.redis.setex(key, ttl, JSON.stringify(value));
    } catch (error) {
      console.warn('[Recommender] Cache write error:', error);
    }
  }

  /**
   * Transform snake_case response to camelCase
   */
  private transformResponse(data: Record<string, unknown>): RecommendResponse {
    return {
      templates: ((data.templates as unknown[]) || []).map((item) => {
        const t = item as Record<string, unknown>;
        return {
          templateId: t.template_id as string,
          name: t.name as string,
          category: t.category as string,
          conditionCodes: t.condition_codes as string[],
          similarityScore: t.similarity_score as number,
          rankingScore: t.ranking_score as number,
          confidence: t.confidence as number,
          matchFactors: {
            conditionMatch: (t.match_factors as Record<string, number>)?.condition_match || 0,
            medicationMatch: (t.match_factors as Record<string, number>)?.medication_match,
            labMatch: (t.match_factors as Record<string, number>)?.lab_match,
            demographicMatch: (t.match_factors as Record<string, number>)?.demographic_match,
            historicalPreference: (t.match_factors as Record<string, number>)?.historical_preference,
          },
        };
      }),
      drafts: ((data.drafts as unknown[]) || []).map((item) => {
        const d = item as Record<string, unknown>;
        return {
          title: d.title as string,
          conditionCodes: d.condition_codes as string[],
          goals: ((d.goals as unknown[]) || []).map((gItem) => {
            const g = gItem as Record<string, unknown>;
            return {
              description: g.description as string,
              targetValue: g.target_value as string | undefined,
              targetDays: g.target_days as number | undefined,
              priority: g.priority as 'HIGH' | 'MEDIUM' | 'LOW',
              confidence: g.confidence as number | undefined,
            };
          }),
          interventions: ((d.interventions as unknown[]) || []).map((iItem) => {
            const i = iItem as Record<string, unknown>;
            return {
              description: i.description as string,
              type: i.type as string,
              medicationCode: i.medication_code as string | undefined,
              procedureCode: i.procedure_code as string | undefined,
              dosage: i.dosage as string | undefined,
              frequency: i.frequency as string | undefined,
              referralSpecialty: i.referral_specialty as string | undefined,
              scheduleDays: i.schedule_days as number | undefined,
              instructions: i.instructions as string | undefined,
              confidence: i.confidence as number | undefined,
            };
          }),
          confidenceScore: d.confidence_score as number,
          generationMethod: d.generation_method as string,
        };
      }),
      processingTimeMs: data.processing_time_ms as number,
      modelVersion: data.model_version as string,
      queryMode: data.query_mode as string,
    };
  }

  /**
   * Transform training job response
   */
  private transformTrainingResponse(data: Record<string, unknown>): TrainingJobResponse {
    return {
      id: data.id as string,
      modelType: data.model_type as string,
      jobName: data.job_name as string | undefined,
      status: data.status as TrainingJobResponse['status'],
      progressPercent: data.progress_percent as number,
      statusMessage: data.status_message as string | undefined,
      metrics: data.metrics as Record<string, number> | undefined,
      modelPath: data.model_path as string | undefined,
      modelVersion: data.model_version as string | undefined,
      trainingExamplesCount: data.training_examples_count as number | undefined,
      startedAt: data.started_at ? new Date(data.started_at as string) : undefined,
      completedAt: data.completed_at ? new Date(data.completed_at as string) : undefined,
      createdAt: new Date(data.created_at as string),
    };
  }
}

/**
 * Create Care Plan Recommender client
 */
export function createCarePlanRecommenderClient(
  baseUrl: string,
  options?: Partial<RecommenderClientConfig>
): CarePlanRecommenderClient {
  return new CarePlanRecommenderClient({ baseUrl, ...options });
}
