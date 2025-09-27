import { createClient, RedisClientType } from 'redis';
import { RedisConfig, CacheEntry, CacheStats } from '@shared/data-layer/src/types';

class RedisConnection {
  private client: RedisClientType | null = null;
  private config: RedisConfig | null = null;
  private stats: CacheStats = {
    hits: 0,
    misses: 0,
    hitRate: 0,
    totalKeys: 0,
    memoryUsage: 0
  };

  async initialize(config: RedisConfig): Promise<void> {
    this.config = config;
    
    this.client = createClient({
      socket: {
        host: config.host,
        port: config.port,
      },
      password: config.password,
      database: config.db || 0,
    });

    this.client.on('error', (err) => {
      console.error('Redis Client Error', err);
    });

    this.client.on('connect', () => {
      console.log('Redis Client Connected');
    });

    await this.client.connect();
  }

  async set<T>(key: string, value: T, ttl?: number): Promise<void> {
    if (!this.client) {
      throw new Error('Redis connection not initialized');
    }

    const prefixedKey = this.getPrefixedKey(key);
    const serializedValue = JSON.stringify(value);

    if (ttl) {
      await this.client.setEx(prefixedKey, ttl, serializedValue);
    } else {
      await this.client.set(prefixedKey, serializedValue);
    }
  }

  async get<T>(key: string): Promise<T | null> {
    if (!this.client) {
      throw new Error('Redis connection not initialized');
    }

    const prefixedKey = this.getPrefixedKey(key);
    const value = await this.client.get(prefixedKey);

    if (value === null) {
      this.stats.misses++;
      this.updateHitRate();
      return null;
    }

    this.stats.hits++;
    this.updateHitRate();
    
    try {
      return JSON.parse(value) as T;
    } catch {
      return value as T;
    }
  }

  async del(key: string): Promise<number> {
    if (!this.client) {
      throw new Error('Redis connection not initialized');
    }

    const prefixedKey = this.getPrefixedKey(key);
    return this.client.del(prefixedKey);
  }

  async exists(key: string): Promise<boolean> {
    if (!this.client) {
      throw new Error('Redis connection not initialized');
    }

    const prefixedKey = this.getPrefixedKey(key);
    const result = await this.client.exists(prefixedKey);
    return result === 1;
  }

  async expire(key: string, ttl: number): Promise<boolean> {
    if (!this.client) {
      throw new Error('Redis connection not initialized');
    }

    const prefixedKey = this.getPrefixedKey(key);
    const result = await this.client.expire(prefixedKey, ttl);
    return result;
  }

  async ttl(key: string): Promise<number> {
    if (!this.client) {
      throw new Error('Redis connection not initialized');
    }

    const prefixedKey = this.getPrefixedKey(key);
    return this.client.ttl(prefixedKey);
  }

  async keys(pattern: string): Promise<string[]> {
    if (!this.client) {
      throw new Error('Redis connection not initialized');
    }

    const prefixedPattern = this.getPrefixedKey(pattern);
    const keys = await this.client.keys(prefixedPattern);
    
    // Remove prefix from returned keys
    const prefix = this.config?.keyPrefix || '';
    return keys.map(key => key.startsWith(prefix) ? key.substring(prefix.length) : key);
  }

  async flushPattern(pattern: string): Promise<number> {
    if (!this.client) {
      throw new Error('Redis connection not initialized');
    }

    const keys = await this.keys(pattern);
    if (keys.length === 0) {
      return 0;
    }

    const prefixedKeys = keys.map(key => this.getPrefixedKey(key));
    return this.client.del(prefixedKeys);
  }

  async healthCheck(): Promise<boolean> {
    try {
      if (!this.client) {
        return false;
      }
      const result = await this.client.ping();
      return result === 'PONG';
    } catch {
      return false;
    }
  }

  async getStats(): Promise<CacheStats> {
    if (!this.client) {
      return this.stats;
    }

    try {
      const info = await this.client.info('memory');
      const memoryMatch = info.match(/used_memory:(\d+)/);
      const memoryUsage = memoryMatch ? parseInt(memoryMatch[1]) : 0;

      const dbSize = await this.client.dbSize();

      return {
        ...this.stats,
        totalKeys: dbSize,
        memoryUsage
      };
    } catch {
      return this.stats;
    }
  }

  async close(): Promise<void> {
    if (this.client) {
      await this.client.quit();
      this.client = null;
    }
  }

  private getPrefixedKey(key: string): string {
    const prefix = this.config?.keyPrefix || '';
    return `${prefix}${key}`;
  }

  private updateHitRate(): void {
    const total = this.stats.hits + this.stats.misses;
    this.stats.hitRate = total > 0 ? this.stats.hits / total : 0;
  }

  // Cache invalidation by tags
  async invalidateByTag(tag: string): Promise<number> {
    const pattern = `*:tag:${tag}:*`;
    return this.flushPattern(pattern);
  }

  // Set with tags for complex invalidation
  async setWithTags<T>(key: string, value: T, tags: string[], ttl?: number): Promise<void> {
    await this.set(key, value, ttl);
    
    // Store tag references
    for (const tag of tags) {
      const tagKey = `tag:${tag}:${key}`;
      await this.set(tagKey, true, ttl);
    }
  }
}

// Singleton instance
export const redis = new RedisConnection();

// Utility function to get Redis config from environment
export function getRedisConfig(): RedisConfig {
  return {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379'),
    password: process.env.REDIS_PASSWORD,
    db: parseInt(process.env.REDIS_DB || '0'),
    keyPrefix: process.env.REDIS_KEY_PREFIX || 'healthcare:',
    maxRetriesPerRequest: parseInt(process.env.REDIS_MAX_RETRIES || '3'),
  };
}