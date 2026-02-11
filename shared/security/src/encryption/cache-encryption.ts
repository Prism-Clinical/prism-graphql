/**
 * Cache Encryption
 *
 * Encrypt PHI data before storing in Redis cache.
 */

import * as crypto from 'crypto';
import { Redis } from 'ioredis';

/**
 * Cache encryption configuration
 */
export interface CacheEncryptionConfig {
  /** Master key for cache encryption (base64, 32 bytes) */
  masterKey: string;
  /** Key ID for tracking */
  keyId: string;
  /** Default TTL in seconds */
  defaultTTL: number;
  /** Maximum TTL for PHI data in seconds (1 hour max per HIPAA) */
  maxPHITTL: number;
}

/**
 * Encrypted cache entry
 */
interface EncryptedCacheEntry {
  /** Encrypted data (base64) */
  data: string;
  /** IV (base64) */
  iv: string;
  /** Auth tag (base64) */
  tag: string;
  /** Key ID */
  keyId: string;
  /** Whether entry contains PHI */
  containsPHI: boolean;
  /** Timestamp when cached */
  cachedAt: number;
}

/**
 * Cache Encryption Manager
 *
 * Handles encryption/decryption of cached data with support for PHI TTL limits.
 */
export class CacheEncryptionManager {
  private config: CacheEncryptionConfig;
  private masterKeyBuffer: Buffer;
  private redis: Redis | null = null;

  constructor(config: CacheEncryptionConfig) {
    this.config = config;
    this.masterKeyBuffer = Buffer.from(config.masterKey, 'base64');

    if (this.masterKeyBuffer.length !== 32) {
      throw new Error('Master key must be 32 bytes for AES-256');
    }
  }

  /**
   * Set Redis client
   */
  setRedisClient(redis: Redis): void {
    this.redis = redis;
  }

  /**
   * Encrypt and cache a value
   */
  async set<T>(
    key: string,
    value: T,
    options: { ttl?: number; containsPHI?: boolean } = {}
  ): Promise<void> {
    if (!this.redis) {
      throw new Error('Redis client not set');
    }

    const containsPHI = options.containsPHI ?? false;

    // Enforce PHI TTL limit
    let ttl = options.ttl ?? this.config.defaultTTL;
    if (containsPHI && ttl > this.config.maxPHITTL) {
      ttl = this.config.maxPHITTL;
    }

    // Serialize and encrypt
    const plaintext = JSON.stringify(value);
    const encrypted = this.encrypt(plaintext, key);

    const entry: EncryptedCacheEntry = {
      ...encrypted,
      containsPHI,
      cachedAt: Date.now(),
    };

    // Store in Redis
    await this.redis.setex(
      this.prefixKey(key),
      ttl,
      JSON.stringify(entry)
    );
  }

  /**
   * Get and decrypt a cached value
   */
  async get<T>(key: string): Promise<T | null> {
    if (!this.redis) {
      throw new Error('Redis client not set');
    }

    const raw = await this.redis.get(this.prefixKey(key));
    if (!raw) {
      return null;
    }

    try {
      const entry: EncryptedCacheEntry = JSON.parse(raw);

      // Verify key ID
      if (entry.keyId !== this.config.keyId) {
        // Key rotated, invalidate cache
        await this.redis.del(this.prefixKey(key));
        return null;
      }

      // Decrypt
      const plaintext = this.decrypt(entry, key);
      return JSON.parse(plaintext) as T;
    } catch (error) {
      // Corrupted or invalid entry, remove it
      await this.redis.del(this.prefixKey(key));
      return null;
    }
  }

  /**
   * Delete a cached value
   */
  async del(key: string): Promise<void> {
    if (!this.redis) {
      throw new Error('Redis client not set');
    }

    await this.redis.del(this.prefixKey(key));
  }

  /**
   * Delete multiple cached values by pattern
   */
  async delPattern(pattern: string): Promise<number> {
    if (!this.redis) {
      throw new Error('Redis client not set');
    }

    const keys = await this.redis.keys(this.prefixKey(pattern));
    if (keys.length === 0) {
      return 0;
    }

    return await this.redis.del(...keys);
  }

  /**
   * Check if key exists
   */
  async exists(key: string): Promise<boolean> {
    if (!this.redis) {
      throw new Error('Redis client not set');
    }

    const result = await this.redis.exists(this.prefixKey(key));
    return result === 1;
  }

  /**
   * Get TTL for a key
   */
  async ttl(key: string): Promise<number> {
    if (!this.redis) {
      throw new Error('Redis client not set');
    }

    return await this.redis.ttl(this.prefixKey(key));
  }

  /**
   * Invalidate all PHI-containing cache entries
   * (For use during security incidents)
   */
  async invalidateAllPHI(): Promise<number> {
    if (!this.redis) {
      throw new Error('Redis client not set');
    }

    const keys = await this.redis.keys(this.prefixKey('*'));
    let invalidated = 0;

    for (const key of keys) {
      const raw = await this.redis.get(key);
      if (raw) {
        try {
          const entry: EncryptedCacheEntry = JSON.parse(raw);
          if (entry.containsPHI) {
            await this.redis.del(key);
            invalidated++;
          }
        } catch {
          // Invalid entry, delete it
          await this.redis.del(key);
          invalidated++;
        }
      }
    }

    return invalidated;
  }

  /**
   * Re-encrypt all cached entries with new key
   */
  async reencryptAll(newManager: CacheEncryptionManager): Promise<number> {
    if (!this.redis) {
      throw new Error('Redis client not set');
    }

    const keys = await this.redis.keys(this.prefixKey('*'));
    let reencrypted = 0;

    for (const fullKey of keys) {
      const key = fullKey.replace(this.prefixKey(''), '');
      const raw = await this.redis.get(fullKey);

      if (raw) {
        try {
          const entry: EncryptedCacheEntry = JSON.parse(raw);
          const plaintext = this.decrypt(entry, key);
          const value = JSON.parse(plaintext);

          // Get remaining TTL
          const ttl = await this.redis.ttl(fullKey);

          // Re-encrypt with new key
          await newManager.set(key, value, {
            ttl: ttl > 0 ? ttl : this.config.defaultTTL,
            containsPHI: entry.containsPHI,
          });

          // Delete old entry
          await this.redis.del(fullKey);
          reencrypted++;
        } catch {
          // Corrupted entry, just delete it
          await this.redis.del(fullKey);
        }
      }
    }

    return reencrypted;
  }

  /**
   * Encrypt data for caching
   */
  private encrypt(plaintext: string, cacheKey: string): Omit<EncryptedCacheEntry, 'containsPHI' | 'cachedAt'> {
    // Derive key specific to this cache entry
    const derivedKey = this.deriveKey(cacheKey);

    // Generate random IV
    const iv = crypto.randomBytes(12);

    // Create cipher
    const cipher = crypto.createCipheriv('aes-256-gcm', derivedKey, iv);

    // Add cache key as AAD
    cipher.setAAD(Buffer.from(cacheKey, 'utf8'));

    // Encrypt
    const encrypted = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ]);

    return {
      data: encrypted.toString('base64'),
      iv: iv.toString('base64'),
      tag: cipher.getAuthTag().toString('base64'),
      keyId: this.config.keyId,
    };
  }

  /**
   * Decrypt cached data
   */
  private decrypt(entry: Omit<EncryptedCacheEntry, 'containsPHI' | 'cachedAt'>, cacheKey: string): string {
    const derivedKey = this.deriveKey(cacheKey);

    const iv = Buffer.from(entry.iv, 'base64');
    const tag = Buffer.from(entry.tag, 'base64');
    const data = Buffer.from(entry.data, 'base64');

    const decipher = crypto.createDecipheriv('aes-256-gcm', derivedKey, iv);
    decipher.setAuthTag(tag);
    decipher.setAAD(Buffer.from(cacheKey, 'utf8'));

    const decrypted = Buffer.concat([
      decipher.update(data),
      decipher.final(),
    ]);

    return decrypted.toString('utf8');
  }

  /**
   * Derive key for specific cache entry
   */
  private deriveKey(cacheKey: string): Buffer {
    return Buffer.from(
      crypto.hkdfSync(
        'sha256',
        this.masterKeyBuffer,
        Buffer.from('prism-cache-salt'),
        Buffer.from(`cache:${cacheKey}`, 'utf8'),
        32
      )
    );
  }

  /**
   * Prefix cache key for namespacing
   */
  private prefixKey(key: string): string {
    return `prism:enc:${key}`;
  }
}

/**
 * Create a cache encryption manager
 */
export function createCacheEncryptionManager(
  masterKey: string,
  keyId: string,
  redis?: Redis
): CacheEncryptionManager {
  const manager = new CacheEncryptionManager({
    masterKey,
    keyId,
    defaultTTL: 300, // 5 minutes
    maxPHITTL: 3600, // 1 hour max for PHI
  });

  if (redis) {
    manager.setRedisClient(redis);
  }

  return manager;
}
