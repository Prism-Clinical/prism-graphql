/**
 * Idempotency Layer
 *
 * Ensures pipeline requests are processed exactly once.
 */

import { Pool } from 'pg';
import { createHash } from 'crypto';

/**
 * Idempotency result status
 */
export enum IdempotencyStatus {
  /** New request, proceed with processing */
  NEW = 'NEW',
  /** Request is currently being processed */
  PENDING = 'PENDING',
  /** Request completed successfully */
  COMPLETED = 'COMPLETED',
  /** Request failed */
  FAILED = 'FAILED',
}

/**
 * Idempotency check result
 */
export interface IdempotencyResult {
  /** Status of the idempotency check */
  status: IdempotencyStatus;
  /** If completed, the cached response */
  response?: unknown;
  /** If failed, the error information */
  error?: {
    message: string;
    code: string;
  };
  /** Request ID for tracking */
  requestId?: string;
  /** When the original request was created */
  createdAt?: Date;
}

/**
 * Idempotency configuration
 */
export interface IdempotencyConfig {
  /** Database pool */
  pool: Pool;
  /** Key expiration in hours */
  expirationHours: number;
  /** Table name */
  tableName: string;
}

/**
 * Default configuration
 */
const DEFAULT_CONFIG: Partial<IdempotencyConfig> = {
  expirationHours: 24,
  tableName: 'idempotency_keys',
};

/**
 * Idempotency manager
 */
export class IdempotencyManager {
  private config: IdempotencyConfig;

  constructor(config: Partial<IdempotencyConfig> & { pool: Pool }) {
    this.config = { ...DEFAULT_CONFIG, ...config } as IdempotencyConfig;
  }

  /**
   * Hash the request for comparison
   */
  private hashRequest(request: unknown): string {
    const json = JSON.stringify(request);
    return createHash('sha256').update(json).digest('hex');
  }

  /**
   * Check or create idempotency entry
   */
  async checkOrCreate(
    key: string,
    request: unknown
  ): Promise<IdempotencyResult> {
    const requestHash = this.hashRequest(request);
    const expiresAt = new Date(Date.now() + this.config.expirationHours * 60 * 60 * 1000);

    // Try to insert new entry or get existing one
    const query = `
      INSERT INTO ${this.config.tableName} (key, request_hash, status, created_at, expires_at)
      VALUES ($1, $2, 'PENDING', NOW(), $3)
      ON CONFLICT (key) DO UPDATE SET key = ${this.config.tableName}.key
      RETURNING key, request_hash, status, response, created_at, request_id
    `;

    try {
      const result = await this.config.pool.query(query, [key, requestHash, expiresAt]);
      const row = result.rows[0];

      // Check if this is an existing entry
      if (row.request_hash !== requestHash) {
        // Different request with same key - this is an error
        return {
          status: IdempotencyStatus.FAILED,
          error: {
            message: 'Idempotency key already used for a different request',
            code: 'IDEMPOTENCY_KEY_REUSED',
          },
        };
      }

      // Return based on status
      switch (row.status) {
        case 'PENDING':
          // Could be our new entry or an in-progress request
          // Check if it was just created (within last second)
          const age = Date.now() - new Date(row.created_at).getTime();
          if (age < 1000) {
            // This is our new entry
            return { status: IdempotencyStatus.NEW, requestId: row.request_id };
          } else {
            // Another request is processing
            return { status: IdempotencyStatus.PENDING, requestId: row.request_id };
          }

        case 'COMPLETED':
          return {
            status: IdempotencyStatus.COMPLETED,
            response: row.response,
            requestId: row.request_id,
            createdAt: row.created_at,
          };

        case 'FAILED':
          return {
            status: IdempotencyStatus.FAILED,
            error: row.response?.error,
            requestId: row.request_id,
            createdAt: row.created_at,
          };

        default:
          return { status: IdempotencyStatus.NEW };
      }
    } catch (error) {
      console.error('Idempotency check error:', error);
      // On database error, allow processing to continue
      return { status: IdempotencyStatus.NEW };
    }
  }

  /**
   * Mark request as completed with response
   */
  async complete(key: string, requestId: string, response: unknown): Promise<void> {
    const query = `
      UPDATE ${this.config.tableName}
      SET status = 'COMPLETED', response = $3, request_id = $2
      WHERE key = $1
    `;

    try {
      await this.config.pool.query(query, [key, requestId, JSON.stringify(response)]);
    } catch (error) {
      console.error('Idempotency complete error:', error);
    }
  }

  /**
   * Mark request as failed
   */
  async fail(
    key: string,
    requestId: string,
    error: { message: string; code: string }
  ): Promise<void> {
    const query = `
      UPDATE ${this.config.tableName}
      SET status = 'FAILED', response = $3, request_id = $2
      WHERE key = $1
    `;

    try {
      await this.config.pool.query(query, [key, requestId, JSON.stringify({ error })]);
    } catch (err) {
      console.error('Idempotency fail error:', err);
    }
  }

  /**
   * Delete an idempotency entry
   */
  async delete(key: string): Promise<void> {
    const query = `DELETE FROM ${this.config.tableName} WHERE key = $1`;

    try {
      await this.config.pool.query(query, [key]);
    } catch (error) {
      console.error('Idempotency delete error:', error);
    }
  }

  /**
   * Clean up expired entries
   */
  async cleanupExpired(): Promise<number> {
    const query = `
      DELETE FROM ${this.config.tableName}
      WHERE expires_at < NOW()
      RETURNING key
    `;

    try {
      const result = await this.config.pool.query(query);
      return result.rowCount ?? 0;
    } catch (error) {
      console.error('Idempotency cleanup error:', error);
      return 0;
    }
  }

  /**
   * Get pending requests older than specified minutes
   * Used for monitoring and alerting
   */
  async getStalePending(olderThanMinutes: number): Promise<string[]> {
    const query = `
      SELECT key FROM ${this.config.tableName}
      WHERE status = 'PENDING'
        AND created_at < NOW() - INTERVAL '${olderThanMinutes} minutes'
    `;

    try {
      const result = await this.config.pool.query(query);
      return result.rows.map((r) => r.key);
    } catch (error) {
      console.error('Idempotency stale check error:', error);
      return [];
    }
  }
}

/**
 * Decorator for idempotent operations
 */
export function withIdempotency<T extends (...args: any[]) => Promise<any>>(
  manager: IdempotencyManager,
  getKey: (...args: Parameters<T>) => string,
  getRequest: (...args: Parameters<T>) => unknown,
  getRequestId: () => string
): (fn: T) => T {
  return (fn: T): T => {
    return (async (...args: Parameters<T>) => {
      const key = getKey(...args);
      const request = getRequest(...args);
      const requestId = getRequestId();

      const check = await manager.checkOrCreate(key, request);

      switch (check.status) {
        case IdempotencyStatus.COMPLETED:
          return check.response;

        case IdempotencyStatus.PENDING:
          // Wait and retry
          await sleep(1000);
          return (fn as any)(...args);

        case IdempotencyStatus.FAILED:
          throw new Error(check.error?.message ?? 'Previous request failed');

        case IdempotencyStatus.NEW:
        default:
          try {
            const result = await fn(...args);
            await manager.complete(key, requestId, result);
            return result;
          } catch (error) {
            const err = error as Error;
            await manager.fail(key, requestId, {
              message: err.message,
              code: 'PROCESSING_ERROR',
            });
            throw error;
          }
      }
    }) as T;
  };
}

/**
 * Sleep utility
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * SQL migration for idempotency table
 */
export const IDEMPOTENCY_TABLE_MIGRATION = `
CREATE TABLE IF NOT EXISTS idempotency_keys (
  key VARCHAR(255) PRIMARY KEY,
  request_hash VARCHAR(64) NOT NULL,
  request_id UUID,
  response JSONB,
  status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,

  CONSTRAINT valid_status CHECK (status IN ('PENDING', 'COMPLETED', 'FAILED'))
);

CREATE INDEX IF NOT EXISTS idx_idempotency_expires
  ON idempotency_keys(expires_at);

CREATE INDEX IF NOT EXISTS idx_idempotency_status
  ON idempotency_keys(status)
  WHERE status = 'PENDING';
`;
