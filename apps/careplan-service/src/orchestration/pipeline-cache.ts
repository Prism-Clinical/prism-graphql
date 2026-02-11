/**
 * Pipeline Cache Layer
 *
 * Caching for pipeline results with PHI encryption.
 */

import { createHash } from 'crypto';
import { Redis } from 'ioredis';
import { ExtractedEntities, CarePlanRecommendation } from './types';

/**
 * Cache configuration
 */
export interface PipelineCacheConfig {
  /** Redis client */
  redis: Redis;
  /** Default TTL in seconds */
  defaultTTL: number;
  /** Max TTL for PHI-containing data (1 hour max per HIPAA) */
  maxPHITTL: number;
  /** Cache key prefix */
  keyPrefix: string;
  /** Encryption key for PHI */
  encryptionKey?: Buffer;
  /** Audit logger callback */
  onCacheAccess?: (entry: CacheAccessEntry) => Promise<void>;
}

/**
 * Cache access audit entry
 */
export interface CacheAccessEntry {
  /** Cache operation type */
  operation: 'GET' | 'SET' | 'DELETE' | 'INVALIDATE';
  /** Cache key (hashed) */
  keyHash: string;
  /** Whether operation was successful */
  success: boolean;
  /** Whether PHI was involved */
  containsPHI: boolean;
  /** Timestamp */
  timestamp: Date;
  /** Correlation ID */
  correlationId?: string;
}

/**
 * Default cache configuration
 */
const DEFAULT_CONFIG: Partial<PipelineCacheConfig> = {
  defaultTTL: 300, // 5 minutes
  maxPHITTL: 3600, // 1 hour max for PHI
  keyPrefix: 'pipeline:',
};

/**
 * Simple encryption for cache (in production, use proper KMS)
 */
function encrypt(data: string, key: Buffer): string {
  // In production, use AES-256-GCM with proper IV management
  // This is a simplified version for demonstration
  const crypto = require('crypto');
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
  let encrypted = cipher.update(data, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return iv.toString('hex') + ':' + encrypted;
}

function decrypt(data: string, key: Buffer): string {
  const crypto = require('crypto');
  const parts = data.split(':');
  const iv = Buffer.from(parts[0], 'hex');
  const encrypted = parts[1];
  const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

/**
 * Pipeline cache manager
 */
export class PipelineCache {
  private config: PipelineCacheConfig;

  constructor(config: Partial<PipelineCacheConfig> & { redis: Redis }) {
    this.config = { ...DEFAULT_CONFIG, ...config } as PipelineCacheConfig;
  }

  /**
   * Generate cache key hash
   */
  private hashKey(...parts: string[]): string {
    const hash = createHash('sha256');
    for (const part of parts) {
      hash.update(part);
    }
    return hash.digest('hex').substring(0, 32);
  }

  /**
   * Get full cache key
   */
  private getCacheKey(type: string, ...parts: string[]): string {
    return `${this.config.keyPrefix}${type}:${this.hashKey(...parts)}`;
  }

  /**
   * Log cache access
   */
  private async logAccess(entry: Omit<CacheAccessEntry, 'timestamp'>): Promise<void> {
    if (this.config.onCacheAccess) {
      await this.config.onCacheAccess({
        ...entry,
        timestamp: new Date(),
      });
    }
  }

  /**
   * Serialize and optionally encrypt value
   */
  private serialize(value: unknown, containsPHI: boolean): string {
    const json = JSON.stringify(value);
    if (containsPHI && this.config.encryptionKey) {
      return encrypt(json, this.config.encryptionKey);
    }
    return json;
  }

  /**
   * Deserialize and optionally decrypt value
   */
  private deserialize<T>(data: string, containsPHI: boolean): T {
    let json = data;
    if (containsPHI && this.config.encryptionKey) {
      json = decrypt(data, this.config.encryptionKey);
    }
    return JSON.parse(json);
  }

  /**
   * Get extraction cache key
   */
  getExtractionCacheKey(transcriptText: string): string {
    return this.getCacheKey('extraction', transcriptText);
  }

  /**
   * Get cached extraction result
   */
  async getCachedExtraction(
    transcriptText: string,
    correlationId?: string
  ): Promise<ExtractedEntities | null> {
    const key = this.getExtractionCacheKey(transcriptText);

    try {
      const cached = await this.config.redis.get(key);

      await this.logAccess({
        operation: 'GET',
        keyHash: this.hashKey(key),
        success: cached !== null,
        containsPHI: true,
        correlationId,
      });

      if (!cached) return null;

      // Deserialize with decryption (extraction results contain PHI)
      return this.deserialize<ExtractedEntities>(cached, true);
    } catch (error) {
      console.error('Cache get error:', error);
      return null;
    }
  }

  /**
   * Cache extraction result
   */
  async cacheExtraction(
    transcriptText: string,
    entities: ExtractedEntities,
    correlationId?: string
  ): Promise<void> {
    const key = this.getExtractionCacheKey(transcriptText);
    const ttl = Math.min(this.config.defaultTTL, this.config.maxPHITTL);

    try {
      // Serialize with encryption (extraction results contain PHI)
      const serialized = this.serialize(entities, true);
      await this.config.redis.setex(key, ttl, serialized);

      await this.logAccess({
        operation: 'SET',
        keyHash: this.hashKey(key),
        success: true,
        containsPHI: true,
        correlationId,
      });
    } catch (error) {
      console.error('Cache set error:', error);
    }
  }

  /**
   * Get recommendation cache key
   */
  getRecommendationCacheKey(
    conditionCodes: string[],
    patientContext?: { age?: number; gender?: string }
  ): string {
    const contextParts = [
      ...conditionCodes.sort(),
      patientContext?.age?.toString() ?? '',
      patientContext?.gender ?? '',
    ];
    return this.getCacheKey('recommendation', ...contextParts);
  }

  /**
   * Get cached recommendations
   */
  async getCachedRecommendations(
    conditionCodes: string[],
    patientContext?: { age?: number; gender?: string },
    correlationId?: string
  ): Promise<CarePlanRecommendation[] | null> {
    const key = this.getRecommendationCacheKey(conditionCodes, patientContext);

    try {
      const cached = await this.config.redis.get(key);

      await this.logAccess({
        operation: 'GET',
        keyHash: this.hashKey(key),
        success: cached !== null,
        containsPHI: false, // Recommendations don't contain PHI
        correlationId,
      });

      if (!cached) return null;

      return this.deserialize<CarePlanRecommendation[]>(cached, false);
    } catch (error) {
      console.error('Cache get error:', error);
      return null;
    }
  }

  /**
   * Cache recommendations
   */
  async cacheRecommendations(
    conditionCodes: string[],
    patientContext: { age?: number; gender?: string } | undefined,
    recommendations: CarePlanRecommendation[],
    correlationId?: string
  ): Promise<void> {
    const key = this.getRecommendationCacheKey(conditionCodes, patientContext);
    const ttl = this.config.defaultTTL;

    try {
      const serialized = this.serialize(recommendations, false);
      await this.config.redis.setex(key, ttl, serialized);

      await this.logAccess({
        operation: 'SET',
        keyHash: this.hashKey(key),
        success: true,
        containsPHI: false,
        correlationId,
      });
    } catch (error) {
      console.error('Cache set error:', error);
    }
  }

  /**
   * Invalidate extraction cache for specific text
   */
  async invalidateExtraction(transcriptText: string, correlationId?: string): Promise<void> {
    const key = this.getExtractionCacheKey(transcriptText);

    try {
      await this.config.redis.del(key);

      await this.logAccess({
        operation: 'DELETE',
        keyHash: this.hashKey(key),
        success: true,
        containsPHI: true,
        correlationId,
      });
    } catch (error) {
      console.error('Cache delete error:', error);
    }
  }

  /**
   * Invalidate all recommendations for condition codes
   */
  async invalidateRecommendations(conditionCodes: string[], correlationId?: string): Promise<void> {
    // Pattern-based invalidation
    const pattern = `${this.config.keyPrefix}recommendation:*`;

    try {
      const keys = await this.config.redis.keys(pattern);
      if (keys.length > 0) {
        await this.config.redis.del(...keys);
      }

      await this.logAccess({
        operation: 'INVALIDATE',
        keyHash: 'recommendation:*',
        success: true,
        containsPHI: false,
        correlationId,
      });
    } catch (error) {
      console.error('Cache invalidate error:', error);
    }
  }

  /**
   * Invalidate all PHI-containing cache entries
   * Used for security events or key rotation
   */
  async invalidateAllPHI(correlationId?: string): Promise<void> {
    const pattern = `${this.config.keyPrefix}extraction:*`;

    try {
      const keys = await this.config.redis.keys(pattern);
      if (keys.length > 0) {
        await this.config.redis.del(...keys);
      }

      await this.logAccess({
        operation: 'INVALIDATE',
        keyHash: 'extraction:*',
        success: true,
        containsPHI: true,
        correlationId,
      });
    } catch (error) {
      console.error('Cache invalidate error:', error);
    }
  }

  /**
   * Get cache statistics
   */
  async getStats(): Promise<CacheStats> {
    const extractionPattern = `${this.config.keyPrefix}extraction:*`;
    const recommendationPattern = `${this.config.keyPrefix}recommendation:*`;

    try {
      const [extractionKeys, recommendationKeys] = await Promise.all([
        this.config.redis.keys(extractionPattern),
        this.config.redis.keys(recommendationPattern),
      ]);

      return {
        extractionCount: extractionKeys.length,
        recommendationCount: recommendationKeys.length,
        totalCount: extractionKeys.length + recommendationKeys.length,
      };
    } catch (error) {
      console.error('Cache stats error:', error);
      return { extractionCount: 0, recommendationCount: 0, totalCount: 0 };
    }
  }
}

/**
 * Cache statistics
 */
export interface CacheStats {
  extractionCount: number;
  recommendationCount: number;
  totalCount: number;
}

/**
 * Cache stampede protection using probabilistic early expiration
 */
export class StampedeProtection {
  private readonly pendingRequests = new Map<string, Promise<unknown>>();

  /**
   * Execute with stampede protection
   * Uses request coalescing for identical concurrent requests
   */
  async execute<T>(
    cacheKey: string,
    factory: () => Promise<T>,
    getTTL: () => number
  ): Promise<{ value: T; fromPending: boolean }> {
    // Check if there's already a pending request for this key
    const pending = this.pendingRequests.get(cacheKey);
    if (pending) {
      return { value: (await pending) as T, fromPending: true };
    }

    // Create new request
    const promise = factory();
    this.pendingRequests.set(cacheKey, promise);

    try {
      const value = await promise;
      return { value, fromPending: false };
    } finally {
      this.pendingRequests.delete(cacheKey);
    }
  }

  /**
   * Check if should refresh early (probabilistic)
   * Returns true with increasing probability as TTL decreases
   */
  shouldRefreshEarly(ttl: number, maxTTL: number, beta: number = 1): boolean {
    if (ttl <= 0) return true;
    if (ttl >= maxTTL) return false;

    // Probabilistic early expiration
    // P(refresh) increases as TTL decreases
    const expirationRatio = ttl / maxTTL;
    const threshold = Math.exp(-beta * (1 - expirationRatio));
    return Math.random() < threshold;
  }
}

// Export singleton stampede protection
export const stampedeProtection = new StampedeProtection();
