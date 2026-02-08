/**
 * Cache Service
 *
 * Provides Redis-based caching for CDS recommendations.
 * Falls back to no-op when Redis is not configured.
 */

import { createClient, RedisClientType } from 'redis';
import { getConfig } from '../config';
import { logger } from '../utils/logger';
import { CACHE_TTL_SECONDS, CACHE_KEY_PREFIX } from '../constants';

/**
 * Cache interface for storing and retrieving values
 */
export interface CacheService {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T, ttlSeconds?: number): Promise<void>;
  delete(key: string): Promise<void>;
  isConnected(): boolean;
}

/**
 * Redis cache implementation
 */
class RedisCacheService implements CacheService {
  private client: RedisClientType | null = null;
  private connected = false;

  async initialize(): Promise<void> {
    const config = getConfig();

    if (!config.redisUrl) {
      logger.info('Redis URL not configured, cache disabled');
      return;
    }

    try {
      this.client = createClient({ url: config.redisUrl });

      this.client.on('error', (err) => {
        logger.error({ error: err.message }, 'Redis client error');
        this.connected = false;
      });

      this.client.on('connect', () => {
        logger.info('Redis client connected');
        this.connected = true;
      });

      this.client.on('disconnect', () => {
        logger.warn('Redis client disconnected');
        this.connected = false;
      });

      await this.client.connect();
    } catch (error) {
      logger.error(
        { error: error instanceof Error ? error.message : 'Unknown error' },
        'Failed to connect to Redis'
      );
      this.client = null;
      this.connected = false;
    }
  }

  async get<T>(key: string): Promise<T | null> {
    if (!this.client || !this.connected) {
      return null;
    }

    try {
      const fullKey = `${CACHE_KEY_PREFIX}${key}`;
      const value = await this.client.get(fullKey);

      if (!value) {
        return null;
      }

      return JSON.parse(value) as T;
    } catch (error) {
      logger.warn(
        { key, error: error instanceof Error ? error.message : 'Unknown error' },
        'Cache get error'
      );
      return null;
    }
  }

  async set<T>(key: string, value: T, ttlSeconds: number = CACHE_TTL_SECONDS): Promise<void> {
    if (!this.client || !this.connected) {
      return;
    }

    try {
      const fullKey = `${CACHE_KEY_PREFIX}${key}`;
      const serialized = JSON.stringify(value);

      await this.client.setEx(fullKey, ttlSeconds, serialized);
    } catch (error) {
      logger.warn(
        { key, error: error instanceof Error ? error.message : 'Unknown error' },
        'Cache set error'
      );
    }
  }

  async delete(key: string): Promise<void> {
    if (!this.client || !this.connected) {
      return;
    }

    try {
      const fullKey = `${CACHE_KEY_PREFIX}${key}`;
      await this.client.del(fullKey);
    } catch (error) {
      logger.warn(
        { key, error: error instanceof Error ? error.message : 'Unknown error' },
        'Cache delete error'
      );
    }
  }

  isConnected(): boolean {
    return this.connected;
  }

  async close(): Promise<void> {
    if (this.client) {
      await this.client.quit();
      this.client = null;
      this.connected = false;
    }
  }
}

/**
 * No-op cache implementation for when Redis is not available
 */
class NoOpCacheService implements CacheService {
  async get<T>(_key: string): Promise<T | null> {
    return null;
  }

  async set<T>(_key: string, _value: T, _ttlSeconds?: number): Promise<void> {
    // No-op
  }

  async delete(_key: string): Promise<void> {
    // No-op
  }

  isConnected(): boolean {
    return false;
  }
}

// Singleton instance
let cacheInstance: CacheService | null = null;

/**
 * Initialize the cache service
 *
 * Call this during application startup.
 */
export async function initializeCache(): Promise<CacheService> {
  const config = getConfig();

  if (!config.redisUrl) {
    cacheInstance = new NoOpCacheService();
    return cacheInstance;
  }

  const redisCache = new RedisCacheService();
  await redisCache.initialize();
  cacheInstance = redisCache;

  return cacheInstance;
}

/**
 * Get the cache service instance
 *
 * Returns a no-op cache if not initialized.
 */
export function getCache(): CacheService {
  if (!cacheInstance) {
    cacheInstance = new NoOpCacheService();
  }

  return cacheInstance;
}

/**
 * Generate a cache key for patient recommendations
 */
export function getPatientRecommendationKey(patientId: string): string {
  return `patient:${patientId}:recommendations`;
}

/**
 * Generate a cache key for hook response
 */
export function getHookResponseKey(hookType: string, hookInstance: string): string {
  return `hook:${hookType}:${hookInstance}`;
}
