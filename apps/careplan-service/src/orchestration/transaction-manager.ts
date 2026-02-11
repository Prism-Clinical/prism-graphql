/**
 * Transaction Manager
 *
 * Manages transaction boundaries and saga pattern for multi-step operations.
 */

import { Pool, PoolClient } from 'pg';
import { Redis } from 'ioredis';
import { v4 as uuidv4 } from 'uuid';

/**
 * Transaction context
 */
export interface TransactionContext {
  /** Transaction ID */
  id: string;
  /** Database client for this transaction */
  client: PoolClient;
  /** Whether transaction is committed */
  committed: boolean;
  /** Whether transaction is rolled back */
  rolledBack: boolean;
  /** Start timestamp */
  startedAt: Date;
}

/**
 * Saga step definition
 */
export interface SagaStep<TData = unknown, TResult = unknown> {
  /** Step name */
  name: string;
  /** Execute the step */
  execute: (data: TData, context: SagaContext) => Promise<TResult>;
  /** Compensate (undo) the step */
  compensate: (data: TData, result: TResult, context: SagaContext) => Promise<void>;
}

/**
 * Saga context
 */
export interface SagaContext {
  /** Saga ID */
  sagaId: string;
  /** Correlation ID */
  correlationId: string;
  /** User ID */
  userId: string;
  /** Database pool */
  pool: Pool;
  /** Redis client */
  redis: Redis;
  /** Results from previous steps */
  stepResults: Map<string, unknown>;
}

/**
 * Saga result
 */
export interface SagaResult<T> {
  /** Whether saga completed successfully */
  success: boolean;
  /** Final result if successful */
  result?: T;
  /** Error if failed */
  error?: Error;
  /** Steps completed before failure */
  completedSteps: string[];
  /** Steps compensated during rollback */
  compensatedSteps: string[];
}

/**
 * Saga orchestrator
 */
export class Saga<TInput, TOutput> {
  private steps: SagaStep[] = [];
  private name: string;

  constructor(name: string) {
    this.name = name;
  }

  /**
   * Add a step to the saga
   */
  addStep<TData, TResult>(step: SagaStep<TData, TResult>): Saga<TInput, TOutput> {
    this.steps.push(step as SagaStep);
    return this;
  }

  /**
   * Execute the saga
   */
  async execute(input: TInput, context: SagaContext): Promise<SagaResult<TOutput>> {
    const completedSteps: Array<{ step: SagaStep; result: unknown }> = [];

    try {
      let currentData = input;

      for (const step of this.steps) {
        console.log(`Saga ${context.sagaId}: Executing step ${step.name}`);

        const result = await step.execute(currentData, context);
        completedSteps.push({ step, result });
        context.stepResults.set(step.name, result);

        // Pass result to next step as data
        currentData = result as any;
      }

      // All steps completed successfully
      return {
        success: true,
        result: currentData as unknown as TOutput,
        completedSteps: completedSteps.map((s) => s.step.name),
        compensatedSteps: [],
      };
    } catch (error) {
      console.error(`Saga ${context.sagaId}: Step failed, initiating rollback`, error);

      // Rollback completed steps in reverse order
      const compensatedSteps: string[] = [];

      for (let i = completedSteps.length - 1; i >= 0; i--) {
        const { step, result } = completedSteps[i];

        try {
          console.log(`Saga ${context.sagaId}: Compensating step ${step.name}`);
          await step.compensate(input, result, context);
          compensatedSteps.push(step.name);
        } catch (compensateError) {
          console.error(`Saga ${context.sagaId}: Compensation failed for ${step.name}`, compensateError);
          // Continue compensating other steps
        }
      }

      return {
        success: false,
        error: error as Error,
        completedSteps: completedSteps.map((s) => s.step.name),
        compensatedSteps,
      };
    }
  }
}

/**
 * Distributed lock manager
 */
export class DistributedLockManager {
  private redis: Redis;
  private lockPrefix: string;

  constructor(redis: Redis, lockPrefix: string = 'lock:') {
    this.redis = redis;
    this.lockPrefix = lockPrefix;
  }

  /**
   * Acquire a distributed lock
   */
  async acquire(
    key: string,
    ttlMs: number = 300000 // 5 minutes default
  ): Promise<LockHandle | null> {
    const lockKey = `${this.lockPrefix}${key}`;
    const lockValue = uuidv4();
    const ttlSeconds = Math.ceil(ttlMs / 1000);

    // Try to acquire lock with NX (only if not exists) and EX (expiration)
    const result = await this.redis.set(lockKey, lockValue, 'EX', ttlSeconds, 'NX');

    if (result === 'OK') {
      return {
        key: lockKey,
        value: lockValue,
        acquiredAt: new Date(),
        expiresAt: new Date(Date.now() + ttlMs),
      };
    }

    return null;
  }

  /**
   * Release a lock
   */
  async release(handle: LockHandle): Promise<boolean> {
    // Use Lua script to ensure atomic check-and-delete
    const script = `
      if redis.call("get", KEYS[1]) == ARGV[1] then
        return redis.call("del", KEYS[1])
      else
        return 0
      end
    `;

    const result = await this.redis.eval(script, 1, handle.key, handle.value);
    return result === 1;
  }

  /**
   * Extend lock TTL
   */
  async extend(handle: LockHandle, ttlMs: number): Promise<boolean> {
    const script = `
      if redis.call("get", KEYS[1]) == ARGV[1] then
        return redis.call("pexpire", KEYS[1], ARGV[2])
      else
        return 0
      end
    `;

    const result = await this.redis.eval(script, 1, handle.key, handle.value, ttlMs);
    if (result === 1) {
      handle.expiresAt = new Date(Date.now() + ttlMs);
      return true;
    }
    return false;
  }

  /**
   * Check if lock is held
   */
  async isLocked(key: string): Promise<boolean> {
    const lockKey = `${this.lockPrefix}${key}`;
    const value = await this.redis.get(lockKey);
    return value !== null;
  }

  /**
   * Execute with lock
   */
  async withLock<T>(
    key: string,
    fn: () => Promise<T>,
    options: {
      ttlMs?: number;
      waitMs?: number;
      retries?: number;
    } = {}
  ): Promise<T> {
    const { ttlMs = 300000, waitMs = 100, retries = 50 } = options;

    for (let i = 0; i < retries; i++) {
      const handle = await this.acquire(key, ttlMs);

      if (handle) {
        try {
          return await fn();
        } finally {
          await this.release(handle);
        }
      }

      // Wait before retry
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }

    throw new Error(`Failed to acquire lock for ${key} after ${retries} retries`);
  }
}

/**
 * Lock handle
 */
export interface LockHandle {
  key: string;
  value: string;
  acquiredAt: Date;
  expiresAt: Date;
}

/**
 * Transaction manager
 */
export class TransactionManager {
  private pool: Pool;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  /**
   * Execute within a transaction
   */
  async withTransaction<T>(
    fn: (context: TransactionContext) => Promise<T>
  ): Promise<T> {
    const client = await this.pool.connect();
    const context: TransactionContext = {
      id: uuidv4(),
      client,
      committed: false,
      rolledBack: false,
      startedAt: new Date(),
    };

    try {
      await client.query('BEGIN');

      const result = await fn(context);

      await client.query('COMMIT');
      context.committed = true;

      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      context.rolledBack = true;
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Execute with optimistic locking
   */
  async withOptimisticLock<T>(
    tableName: string,
    id: string,
    expectedVersion: number,
    fn: (client: PoolClient) => Promise<T>
  ): Promise<T> {
    const client = await this.pool.connect();

    try {
      await client.query('BEGIN');

      // Check version
      const checkQuery = `
        SELECT version FROM ${tableName} WHERE id = $1 FOR UPDATE
      `;
      const checkResult = await client.query(checkQuery, [id]);

      if (checkResult.rows.length === 0) {
        throw new Error(`Record not found: ${tableName}/${id}`);
      }

      const currentVersion = checkResult.rows[0].version;
      if (currentVersion !== expectedVersion) {
        throw new OptimisticLockError(
          `Version mismatch for ${tableName}/${id}: expected ${expectedVersion}, got ${currentVersion}`
        );
      }

      // Execute the operation
      const result = await fn(client);

      // Increment version
      const updateQuery = `
        UPDATE ${tableName} SET version = version + 1, updated_at = NOW()
        WHERE id = $1
      `;
      await client.query(updateQuery, [id]);

      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}

/**
 * Optimistic lock error
 */
export class OptimisticLockError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OptimisticLockError';
  }
}

/**
 * Dead letter queue manager
 */
export class DeadLetterQueue {
  private pool: Pool;
  private tableName: string;

  constructor(pool: Pool, tableName: string = 'dead_letter_queue') {
    this.tableName = tableName;
  }

  /**
   * Add failed item to DLQ
   */
  async add(item: DLQItem): Promise<string> {
    const id = uuidv4();

    const query = `
      INSERT INTO ${this.tableName} (
        id, job_type, job_id, payload_encrypted, error_message, error_stack,
        attempts, first_failed_at, last_failed_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8)
      RETURNING id
    `;

    await this.pool.query(query, [
      id,
      item.jobType,
      item.jobId,
      item.payload,
      item.errorMessage,
      item.errorStack,
      item.attempts,
      new Date(),
    ]);

    return id;
  }

  /**
   * Get unresolved items
   */
  async getUnresolved(limit: number = 100): Promise<DLQEntry[]> {
    const query = `
      SELECT id, job_type, job_id, error_message, attempts,
             first_failed_at, last_failed_at
      FROM ${this.tableName}
      WHERE resolved_at IS NULL
      ORDER BY last_failed_at DESC
      LIMIT $1
    `;

    const result = await this.pool.query(query, [limit]);
    return result.rows.map((row) => ({
      id: row.id,
      jobType: row.job_type,
      jobId: row.job_id,
      errorMessage: row.error_message,
      attempts: row.attempts,
      firstFailedAt: row.first_failed_at,
      lastFailedAt: row.last_failed_at,
    }));
  }

  /**
   * Mark item as resolved
   */
  async resolve(id: string, resolution: 'RETRIED' | 'DISCARDED' | 'MANUAL'): Promise<void> {
    const query = `
      UPDATE ${this.tableName}
      SET resolved_at = NOW(), resolution = $2
      WHERE id = $1
    `;

    await this.pool.query(query, [id, resolution]);
  }

  /**
   * Get DLQ depth
   */
  async getDepth(): Promise<number> {
    const query = `
      SELECT COUNT(*) as count FROM ${this.tableName}
      WHERE resolved_at IS NULL
    `;

    const result = await this.pool.query(query);
    return parseInt(result.rows[0].count, 10);
  }

  /**
   * Get item for retry
   */
  async getForRetry(id: string): Promise<Buffer | null> {
    const query = `
      SELECT payload_encrypted FROM ${this.tableName}
      WHERE id = $1 AND resolved_at IS NULL
    `;

    const result = await this.pool.query(query, [id]);
    return result.rows[0]?.payload_encrypted ?? null;
  }
}

/**
 * DLQ item to add
 */
export interface DLQItem {
  jobType: string;
  jobId: string;
  payload: Buffer;
  errorMessage: string;
  errorStack?: string;
  attempts: number;
}

/**
 * DLQ entry
 */
export interface DLQEntry {
  id: string;
  jobType: string;
  jobId: string;
  errorMessage: string;
  attempts: number;
  firstFailedAt: Date;
  lastFailedAt: Date;
}

/**
 * SQL migration for DLQ table
 */
export const DLQ_TABLE_MIGRATION = `
CREATE TABLE IF NOT EXISTS dead_letter_queue (
  id UUID PRIMARY KEY,
  job_type VARCHAR(50) NOT NULL,
  job_id VARCHAR(255) NOT NULL,
  payload_encrypted BYTEA NOT NULL,
  error_message TEXT NOT NULL,
  error_stack TEXT,
  attempts INT NOT NULL DEFAULT 1,
  first_failed_at TIMESTAMP WITH TIME ZONE NOT NULL,
  last_failed_at TIMESTAMP WITH TIME ZONE NOT NULL,
  resolved_at TIMESTAMP WITH TIME ZONE,
  resolution VARCHAR(20),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

  CONSTRAINT valid_resolution CHECK (
    resolution IS NULL OR resolution IN ('RETRIED', 'DISCARDED', 'MANUAL')
  )
);

CREATE INDEX IF NOT EXISTS idx_dlq_unresolved
  ON dead_letter_queue(resolved_at)
  WHERE resolved_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_dlq_job_type
  ON dead_letter_queue(job_type);
`;
