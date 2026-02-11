/**
 * Rate Limiter
 *
 * Token bucket rate limiting for API endpoints.
 */

import { Redis } from 'ioredis';
import { RateLimitConfig, RateLimitResult } from '../types';

/**
 * Rate limit presets for different operations
 */
export const RATE_LIMIT_PRESETS: Record<string, RateLimitConfig> = {
  generateCarePlan: { max: 10, window: '1m', per: 'user' },
  extractEntities: { max: 20, window: '1m', per: 'user' },
  searchTemplates: { max: 100, window: '1m', per: 'user' },
  importPdf: { max: 5, window: '1m', per: 'user' },
  exportData: { max: 10, window: '1h', per: 'user' },
  authentication: { max: 5, window: '5m', per: 'ip' },
  default: { max: 100, window: '1m', per: 'user' },
};

/**
 * Parse window string to milliseconds
 */
function parseWindow(window: string): number {
  const match = window.match(/^(\d+)(s|m|h|d)$/);
  if (!match) {
    throw new Error(`Invalid window format: ${window}`);
  }

  const value = parseInt(match[1], 10);
  const unit = match[2];

  switch (unit) {
    case 's':
      return value * 1000;
    case 'm':
      return value * 60 * 1000;
    case 'h':
      return value * 60 * 60 * 1000;
    case 'd':
      return value * 24 * 60 * 60 * 1000;
    default:
      throw new Error(`Invalid window unit: ${unit}`);
  }
}

/**
 * Rate Limiter using sliding window algorithm
 */
export class RateLimiter {
  private redis: Redis | null = null;
  private configs = new Map<string, RateLimitConfig>();
  private localCounts = new Map<string, { count: number; resetAt: number }>();

  /**
   * Set Redis client
   */
  setRedisClient(redis: Redis): void {
    this.redis = redis;
  }

  /**
   * Configure rate limit for an operation
   */
  configure(operation: string, config: RateLimitConfig): void {
    this.configs.set(operation, config);
  }

  /**
   * Check and consume a rate limit token
   */
  async check(
    operation: string,
    identifier: string
  ): Promise<RateLimitResult> {
    const config = this.configs.get(operation) || RATE_LIMIT_PRESETS[operation] || RATE_LIMIT_PRESETS.default;
    const key = this.buildKey(operation, identifier, config.per);
    const windowMs = parseWindow(config.window);

    if (this.redis) {
      return this.checkWithRedis(key, config.max, windowMs);
    } else {
      return this.checkLocal(key, config.max, windowMs);
    }
  }

  /**
   * Consume a token (call after successful operation)
   */
  async consume(operation: string, identifier: string): Promise<RateLimitResult> {
    const config = this.configs.get(operation) || RATE_LIMIT_PRESETS[operation] || RATE_LIMIT_PRESETS.default;
    const key = this.buildKey(operation, identifier, config.per);
    const windowMs = parseWindow(config.window);

    if (this.redis) {
      return this.consumeWithRedis(key, config.max, windowMs);
    } else {
      return this.consumeLocal(key, config.max, windowMs);
    }
  }

  /**
   * Reset rate limit for an identifier
   */
  async reset(operation: string, identifier: string): Promise<void> {
    const config = this.configs.get(operation) || RATE_LIMIT_PRESETS[operation] || RATE_LIMIT_PRESETS.default;
    const key = this.buildKey(operation, identifier, config.per);

    if (this.redis) {
      await this.redis.del(key);
    } else {
      this.localCounts.delete(key);
    }
  }

  /**
   * Get current rate limit status
   */
  async getStatus(operation: string, identifier: string): Promise<RateLimitResult> {
    const config = this.configs.get(operation) || RATE_LIMIT_PRESETS[operation] || RATE_LIMIT_PRESETS.default;
    const key = this.buildKey(operation, identifier, config.per);
    const windowMs = parseWindow(config.window);

    if (this.redis) {
      const count = await this.redis.get(key);
      const ttl = await this.redis.pttl(key);
      const current = count ? parseInt(count, 10) : 0;

      return {
        allowed: current < config.max,
        remaining: Math.max(0, config.max - current),
        resetIn: ttl > 0 ? Math.ceil(ttl / 1000) : 0,
        limit: config.max,
      };
    } else {
      const entry = this.localCounts.get(key);
      if (!entry || entry.resetAt <= Date.now()) {
        return {
          allowed: true,
          remaining: config.max,
          resetIn: Math.ceil(windowMs / 1000),
          limit: config.max,
        };
      }

      return {
        allowed: entry.count < config.max,
        remaining: Math.max(0, config.max - entry.count),
        resetIn: Math.ceil((entry.resetAt - Date.now()) / 1000),
        limit: config.max,
      };
    }
  }

  /**
   * Build rate limit key
   */
  private buildKey(operation: string, identifier: string, scope: 'user' | 'ip' | 'global'): string {
    return `ratelimit:${operation}:${scope}:${identifier}`;
  }

  /**
   * Check rate limit using Redis (distributed)
   */
  private async checkWithRedis(
    key: string,
    max: number,
    windowMs: number
  ): Promise<RateLimitResult> {
    const count = await this.redis!.get(key);
    const current = count ? parseInt(count, 10) : 0;
    const ttl = await this.redis!.pttl(key);

    return {
      allowed: current < max,
      remaining: Math.max(0, max - current),
      resetIn: ttl > 0 ? Math.ceil(ttl / 1000) : Math.ceil(windowMs / 1000),
      limit: max,
    };
  }

  /**
   * Consume token using Redis (distributed)
   */
  private async consumeWithRedis(
    key: string,
    max: number,
    windowMs: number
  ): Promise<RateLimitResult> {
    const multi = this.redis!.multi();

    multi.incr(key);
    multi.pttl(key);

    const results = await multi.exec();
    if (!results) {
      throw new Error('Redis transaction failed');
    }

    const [[, count], [, ttl]] = results as [[null, number], [null, number]];

    // Set expiry on first request
    if (count === 1 || ttl < 0) {
      await this.redis!.pexpire(key, windowMs);
    }

    const resetIn = ttl > 0 ? Math.ceil(ttl / 1000) : Math.ceil(windowMs / 1000);

    return {
      allowed: count <= max,
      remaining: Math.max(0, max - count),
      resetIn,
      limit: max,
    };
  }

  /**
   * Check rate limit locally (single instance)
   */
  private checkLocal(key: string, max: number, windowMs: number): RateLimitResult {
    const now = Date.now();
    const entry = this.localCounts.get(key);

    if (!entry || entry.resetAt <= now) {
      return {
        allowed: true,
        remaining: max,
        resetIn: Math.ceil(windowMs / 1000),
        limit: max,
      };
    }

    return {
      allowed: entry.count < max,
      remaining: Math.max(0, max - entry.count),
      resetIn: Math.ceil((entry.resetAt - now) / 1000),
      limit: max,
    };
  }

  /**
   * Consume token locally (single instance)
   */
  private consumeLocal(key: string, max: number, windowMs: number): RateLimitResult {
    const now = Date.now();
    let entry = this.localCounts.get(key);

    if (!entry || entry.resetAt <= now) {
      entry = {
        count: 1,
        resetAt: now + windowMs,
      };
      this.localCounts.set(key, entry);

      return {
        allowed: true,
        remaining: max - 1,
        resetIn: Math.ceil(windowMs / 1000),
        limit: max,
      };
    }

    entry.count++;

    return {
      allowed: entry.count <= max,
      remaining: Math.max(0, max - entry.count),
      resetIn: Math.ceil((entry.resetAt - now) / 1000),
      limit: max,
    };
  }
}

/**
 * Singleton rate limiter instance
 */
export const rateLimiter = new RateLimiter();

/**
 * Create rate limiter with Redis
 */
export function createRateLimiter(redis?: Redis): RateLimiter {
  const limiter = new RateLimiter();
  if (redis) {
    limiter.setRedisClient(redis);
  }
  return limiter;
}

/**
 * Rate limit middleware helper
 */
export async function checkRateLimit(
  operation: string,
  userId: string,
  ipAddress?: string
): Promise<{ allowed: boolean; result: RateLimitResult }> {
  const config = RATE_LIMIT_PRESETS[operation] || RATE_LIMIT_PRESETS.default;
  const identifier = config.per === 'ip' ? (ipAddress || 'unknown') : userId;

  const result = await rateLimiter.consume(operation, identifier);

  return {
    allowed: result.allowed,
    result,
  };
}
