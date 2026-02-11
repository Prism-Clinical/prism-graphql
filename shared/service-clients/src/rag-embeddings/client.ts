/**
 * RAG Embeddings Client
 *
 * HTTP client for the RAG Embeddings ML service.
 */

import * as crypto from 'crypto';
import { Redis } from 'ioredis';
import { BaseHttpClient, ServiceClientConfig, RequestOptions, HealthStatus } from '../common';
import {
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
  EmbeddingResponse,
  BatchEmbeddingResponse,
  EmbeddingType,
  EMBEDDING_DIMENSION,
} from './types';

/**
 * RAG Embeddings client configuration
 */
export interface RagEmbeddingsClientConfig extends Partial<ServiceClientConfig> {
  /** Base URL of the RAG Embeddings service */
  baseUrl: string;
  /** Redis client for caching */
  redis?: Redis;
  /** Cache TTL in seconds (default 1 hour - embeddings are stable) */
  cacheTTL?: number;
}

/**
 * RAG Embeddings Client
 *
 * Provides methods for generating semantic embeddings and searching
 * for similar content in the vector store.
 */
export class RagEmbeddingsClient extends BaseHttpClient {
  private redis: Redis | null = null;
  private cacheTTL: number;
  private fallbackEnabled = true;

  constructor(config: RagEmbeddingsClientConfig) {
    super({
      ...config,
      serviceName: 'rag-embeddings',
      timeout: config.timeout ?? 30000,
    });

    this.redis = config.redis ?? null;
    this.cacheTTL = config.cacheTTL ?? 3600; // 1 hour default
  }

  /**
   * Set Redis client for caching
   */
  setRedisClient(redis: Redis): void {
    this.redis = redis;
  }

  /**
   * Generate embedding for raw text
   */
  async embedText(text: string, options?: RequestOptions): Promise<number[]> {
    // Check cache
    const cacheKey = this.buildCacheKey('text', text);
    const cached = await this.getFromCache<number[]>(cacheKey);
    if (cached) {
      return cached;
    }

    const response = await this.post<EmbeddingResponse>(
      '/api/v1/embed/text',
      { text },
      options
    );

    const embedding = response.data.embedding;

    // Validate dimension
    this.validateEmbedding(embedding);

    // Cache (no PHI in embeddings)
    await this.setInCache(cacheKey, embedding);

    return embedding;
  }

  /**
   * Generate embedding for patient clinical context
   */
  async embedPatientContext(
    context: PatientContextRequest,
    options?: RequestOptions
  ): Promise<number[]> {
    // Check cache (use hash of context for key)
    const cacheKey = this.buildCacheKey('context', context);
    const cached = await this.getFromCache<number[]>(cacheKey);
    if (cached) {
      return cached;
    }

    const response = await this.post<EmbeddingResponse>(
      '/api/v1/embed/patient-context',
      {
        condition_codes: context.conditionCodes,
        condition_names: context.conditionNames,
        medication_codes: context.medicationCodes,
        medication_names: context.medicationNames,
        lab_codes: context.labCodes,
        lab_names: context.labNames,
        symptoms: context.symptoms,
        age: context.age,
        sex: context.sex,
        complications: context.complications,
        risk_factors: context.riskFactors,
      },
      options
    );

    const embedding = response.data.embedding;
    this.validateEmbedding(embedding);

    // Cache
    await this.setInCache(cacheKey, embedding);

    return embedding;
  }

  /**
   * Generate embeddings for multiple texts
   */
  async embedBatch(
    texts: string[],
    type: EmbeddingType = EmbeddingType.RAW_TEXT,
    options?: RequestOptions
  ): Promise<number[][]> {
    if (texts.length === 0) {
      return [];
    }

    // Check cache for each text
    const results: (number[] | null)[] = [];
    const uncachedIndices: number[] = [];
    const uncachedTexts: string[] = [];

    for (let i = 0; i < texts.length; i++) {
      const cacheKey = this.buildCacheKey(type, texts[i]);
      const cached = await this.getFromCache<number[]>(cacheKey);
      if (cached) {
        results[i] = cached;
      } else {
        results[i] = null;
        uncachedIndices.push(i);
        uncachedTexts.push(texts[i]);
      }
    }

    // If all cached, return early
    if (uncachedTexts.length === 0) {
      return results as number[][];
    }

    // Embed uncached texts
    const response = await this.post<BatchEmbeddingResponse>(
      '/api/v1/embed/batch',
      { texts: uncachedTexts, type },
      {
        ...options,
        timeout: options?.timeout ?? 60000, // 1 minute for batch
      }
    );

    // Fill in results and cache
    for (let i = 0; i < uncachedIndices.length; i++) {
      const embedding = response.data.embeddings[i];
      const originalIndex = uncachedIndices[i];
      results[originalIndex] = embedding;

      // Cache
      const cacheKey = this.buildCacheKey(type, uncachedTexts[i]);
      await this.setInCache(cacheKey, embedding);
    }

    return results as number[][];
  }

  /**
   * Embed guidelines in batch
   */
  async embedGuidelines(
    guidelines: GuidelineEmbedRequest[],
    options?: RequestOptions
  ): Promise<BatchGuidelineResponse> {
    const response = await this.post<BatchGuidelineResponse>(
      '/api/v1/embed/guidelines',
      {
        guidelines: guidelines.map((g) => ({
          id: g.id,
          title: g.title,
          category: g.category,
          summary_text: g.summaryText,
          applicable_conditions: g.applicableConditions,
          applicable_medications: g.applicableMedications,
          evidence_grade: g.evidenceGrade,
          source: g.source,
          full_text: g.fullText,
        })),
      },
      {
        ...options,
        timeout: options?.timeout ?? 120000, // 2 minutes for batch
      }
    );

    return {
      results: response.data.results.map((r: Record<string, unknown>) => ({
        id: r.id as string,
        embedding: r.embedding as number[],
        success: r.success as boolean,
        error: r.error as string | undefined,
      })),
      successCount: response.data.successCount,
      errorCount: response.data.errorCount,
      processingTimeMs: response.data.processingTimeMs,
    };
  }

  /**
   * Embed templates in batch
   */
  async embedTemplates(
    templates: TemplateEmbedRequest[],
    options?: RequestOptions
  ): Promise<BatchTemplateResponse> {
    const response = await this.post<BatchTemplateResponse>(
      '/api/v1/embed/templates',
      {
        templates: templates.map((t) => ({
          id: t.id,
          name: t.name,
          category: t.category,
          description: t.description,
          condition_codes: t.conditionCodes,
          goals: t.goals,
          interventions: t.interventions,
        })),
      },
      {
        ...options,
        timeout: options?.timeout ?? 120000, // 2 minutes for batch
      }
    );

    return {
      results: response.data.results.map((r: Record<string, unknown>) => ({
        id: r.id as string,
        embedding: r.embedding as number[],
        success: r.success as boolean,
        error: r.error as string | undefined,
      })),
      successCount: response.data.successCount,
      errorCount: response.data.errorCount,
      processingTimeMs: response.data.processingTimeMs,
    };
  }

  /**
   * Search for similar content using embedding
   */
  async search(
    request: SimilaritySearchRequest,
    options?: RequestOptions
  ): Promise<SimilaritySearchResponse> {
    // Validate embedding dimension
    this.validateEmbedding(request.queryEmbedding);

    const response = await this.post<SimilaritySearchResponse>(
      '/api/v1/search',
      {
        query_embedding: request.queryEmbedding,
        table: request.table,
        limit: request.limit ?? 20,
        min_similarity: request.minSimilarity ?? 0.7,
      },
      options
    );

    return {
      results: response.data.results.map((r: Record<string, unknown>) => ({
        id: r.id as string,
        similarity: r.similarity as number,
        title: r.title as string | undefined,
        category: r.category as string | undefined,
        metadata: r.metadata as Record<string, unknown> | undefined,
      })),
      count: response.data.count,
      queryTimeMs: response.data.queryTimeMs,
    };
  }

  /**
   * Search similar templates for patient context
   */
  async searchSimilarTemplates(
    context: PatientContextRequest,
    limit = 10,
    options?: RequestOptions
  ): Promise<SimilaritySearchResponse> {
    try {
      // Generate embedding for context
      const embedding = await this.embedPatientContext(context, options);

      // Search for similar templates
      return await this.search(
        {
          queryEmbedding: embedding,
          table: 'care_plan_templates',
          limit,
          minSimilarity: 0.6,
        },
        options
      );
    } catch (error) {
      if (this.fallbackEnabled) {
        console.warn('[RAG] Template search failed, returning empty results:', error);
        return {
          results: [],
          count: 0,
          queryTimeMs: 0,
        };
      }
      throw error;
    }
  }

  /**
   * Search similar guidelines for patient context
   */
  async searchSimilarGuidelines(
    context: PatientContextRequest,
    limit = 10,
    options?: RequestOptions
  ): Promise<SimilaritySearchResponse> {
    try {
      // Generate embedding for context
      const embedding = await this.embedPatientContext(context, options);

      // Search for similar guidelines
      return await this.search(
        {
          queryEmbedding: embedding,
          table: 'guidelines',
          limit,
          minSimilarity: 0.6,
        },
        options
      );
    } catch (error) {
      if (this.fallbackEnabled) {
        console.warn('[RAG] Guideline search failed, returning empty results:', error);
        return {
          results: [],
          count: 0,
          queryTimeMs: 0,
        };
      }
      throw error;
    }
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
   * Validate embedding dimension
   */
  private validateEmbedding(embedding: number[]): void {
    if (!Array.isArray(embedding)) {
      throw new Error('Embedding must be an array');
    }
    if (embedding.length !== EMBEDDING_DIMENSION) {
      throw new Error(
        `Invalid embedding dimension: expected ${EMBEDDING_DIMENSION}, got ${embedding.length}`
      );
    }
  }

  /**
   * Build cache key
   */
  private buildCacheKey(type: string, data: unknown): string {
    const hash = crypto
      .createHash('sha256')
      .update(typeof data === 'string' ? data : JSON.stringify(data))
      .digest('hex')
      .substring(0, 32);

    return `rag:${type}:${hash}`;
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
      console.warn('[RAG] Cache read error:', error);
    }

    return null;
  }

  /**
   * Set in cache
   */
  private async setInCache(key: string, value: unknown): Promise<void> {
    if (!this.redis) return;

    try {
      // Embeddings don't contain PHI, safe to cache with longer TTL
      await this.redis.setex(key, this.cacheTTL, JSON.stringify(value));
    } catch (error) {
      console.warn('[RAG] Cache write error:', error);
    }
  }
}

/**
 * Create RAG Embeddings client
 */
export function createRagEmbeddingsClient(
  baseUrl: string,
  options?: Partial<RagEmbeddingsClientConfig>
): RagEmbeddingsClient {
  return new RagEmbeddingsClient({ baseUrl, ...options });
}
