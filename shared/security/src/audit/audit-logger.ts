/**
 * Audit Logger
 *
 * HIPAA-compliant audit logging for PHI access and modifications.
 * Implements buffered writes with retry logic and dead letter queue.
 */

import { v4 as uuidv4 } from 'uuid';
import { Pool, PoolClient } from 'pg';
import {
  AuditEventType,
  AuditAction,
  AuditOutcome,
  PHIAccessEvent,
  MLServiceCallEvent,
  DataExportEvent,
} from '../types';
import { AuditLogEntry, AuditConfig, AuditLogQuery, AuditLogQueryResult } from './types';

// ============================================================================
// Constants
// ============================================================================

/** Default buffer size before auto-flush */
const DEFAULT_BUFFER_SIZE = 100;

/** Default flush interval in milliseconds */
const DEFAULT_FLUSH_INTERVAL = 5000;

/** Maximum retry attempts for failed flushes */
const MAX_RETRY_ATTEMPTS = 3;

/** Base delay for exponential backoff (ms) */
const RETRY_BASE_DELAY = 1000;

/** Maximum buffer size before forced flush (memory safety) */
const MAX_BUFFER_SIZE = 10000;

/** HIPAA retention period in days (7 years) */
const HIPAA_RETENTION_DAYS = 2555;

// ============================================================================
// Types
// ============================================================================

/**
 * Logger interface for dependency injection
 */
export interface AuditLoggerOutput {
  debug(message: string, context?: Record<string, unknown>): void;
  info(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
  error(message: string, context?: Record<string, unknown>): void;
}

/**
 * Dead letter queue entry for failed audit logs
 */
export interface DeadLetterEntry {
  entries: AuditLogEntry[];
  error: string;
  attempts: number;
  firstFailedAt: Date;
  lastFailedAt: Date;
}

/**
 * Audit logger statistics
 */
export interface AuditLoggerStats {
  totalLogged: number;
  totalFlushed: number;
  totalFailed: number;
  currentBufferSize: number;
  deadLetterQueueSize: number;
  lastFlushAt: Date | null;
  lastErrorAt: Date | null;
  flushCount: number;
  retryCount: number;
}

/**
 * Default console-based logger
 */
const defaultLogger: AuditLoggerOutput = {
  debug: (msg, ctx) => process.env.NODE_ENV === 'development' && console.debug(`[AUDIT] ${msg}`, ctx ?? ''),
  info: (msg, ctx) => console.info(`[AUDIT] ${msg}`, ctx ?? ''),
  warn: (msg, ctx) => console.warn(`[AUDIT] ${msg}`, ctx ?? ''),
  error: (msg, ctx) => console.error(`[AUDIT] ${msg}`, ctx ?? ''),
};

/**
 * Default audit configuration
 */
const DEFAULT_CONFIG: Required<AuditConfig> = {
  enabled: true,
  retentionDays: HIPAA_RETENTION_DAYS,
  archiveAfterDays: 365,
  consoleLog: process.env.NODE_ENV === 'development',
  includeDetails: true,
  bufferSize: DEFAULT_BUFFER_SIZE,
  flushInterval: DEFAULT_FLUSH_INTERVAL,
  maxRetries: MAX_RETRY_ATTEMPTS,
};

// ============================================================================
// Audit Logger Implementation
// ============================================================================

/**
 * Audit Logger
 *
 * Central logging service for HIPAA compliance audit trail.
 * Features:
 * - Buffered writes for performance
 * - Automatic retry with exponential backoff
 * - Dead letter queue for persistent failures
 * - Graceful degradation on database issues
 */
export class AuditLogger {
  private pool: Pool | null = null;
  private readonly config: Required<AuditConfig>;
  private readonly logger: AuditLoggerOutput;
  private buffer: AuditLogEntry[] = [];
  private deadLetterQueue: DeadLetterEntry[] = [];
  private flushTimer: NodeJS.Timeout | null = null;
  private flushing = false;
  private stats: AuditLoggerStats = {
    totalLogged: 0,
    totalFlushed: 0,
    totalFailed: 0,
    currentBufferSize: 0,
    deadLetterQueueSize: 0,
    lastFlushAt: null,
    lastErrorAt: null,
    flushCount: 0,
    retryCount: 0,
  };

  constructor(config?: Partial<AuditConfig>, logger?: AuditLoggerOutput) {
    this.config = { ...DEFAULT_CONFIG, ...config } as Required<AuditConfig>;
    this.logger = logger ?? defaultLogger;
  }

  /**
   * Set database pool
   */
  setPool(pool: Pool): void {
    this.pool = pool;
    this.startFlushTimer();
  }

  /**
   * Log PHI access event
   */
  async logAccess(event: PHIAccessEvent): Promise<void> {
    if (!this.config.enabled) return;

    const entry = this.createEntry(event);
    await this.log(entry);
  }

  /**
   * Log PHI modification event
   */
  async logModification(event: PHIAccessEvent & { changes?: Record<string, unknown> }): Promise<void> {
    if (!this.config.enabled) return;

    const entry = this.createEntry({
      ...event,
      eventType: AuditEventType.PHI_MODIFICATION,
    });

    // Don't include actual changed values in audit (may contain PHI)
    // Only include field names
    if (event.changes) {
      entry.metadata = {
        ...entry.metadata,
        modifiedFields: Object.keys(event.changes),
      };
    }

    await this.log(entry);
  }

  /**
   * Log data export event
   */
  async logExport(event: DataExportEvent): Promise<void> {
    if (!this.config.enabled) return;

    const entry = this.createEntry({
      ...event,
      eventType: AuditEventType.PHI_EXPORT,
    });

    entry.metadata = {
      ...entry.metadata,
      exportFormat: event.exportFormat,
      recordCount: event.recordCount,
      destination: event.destination,
    };

    await this.log(entry);
  }

  /**
   * Log ML service call event
   */
  async logMLServiceCall(event: MLServiceCallEvent): Promise<void> {
    if (!this.config.enabled) return;

    const entry = this.createEntry({
      ...event,
      eventType: AuditEventType.ML_SERVICE_CALL,
    });

    entry.metadata = {
      ...entry.metadata,
      targetService: event.targetService,
      endpoint: event.endpoint,
      durationMs: event.durationMs,
      dataSent: event.dataSent, // Field names only, no values
    };

    await this.log(entry);
  }

  /**
   * Log authentication event
   */
  async logAuthentication(
    userId: string,
    outcome: AuditOutcome,
    details: {
      ipAddress?: string;
      userAgent?: string;
      requestId: string;
      failureReason?: string;
    }
  ): Promise<void> {
    if (!this.config.enabled) return;

    const entry: AuditLogEntry = {
      id: uuidv4(),
      eventType: AuditEventType.AUTHENTICATION,
      eventTime: new Date(),
      userId,
      userRole: 'unknown',
      resourceType: 'session',
      action: AuditAction.CREATE,
      phiAccessed: false,
      requestId: details.requestId,
      ipAddress: details.ipAddress,
      userAgent: details.userAgent,
      outcome,
      failureReason: details.failureReason,
    };

    await this.log(entry);
  }

  /**
   * Log authorization failure
   */
  async logAuthorizationFailure(
    userId: string,
    userRole: string,
    resource: { type: string; id?: string },
    action: AuditAction,
    details: {
      ipAddress?: string;
      requestId: string;
      reason: string;
    }
  ): Promise<void> {
    if (!this.config.enabled) return;

    const entry: AuditLogEntry = {
      id: uuidv4(),
      eventType: AuditEventType.AUTHORIZATION_FAILURE,
      eventTime: new Date(),
      userId,
      userRole,
      resourceType: resource.type,
      resourceId: resource.id,
      action,
      phiAccessed: false,
      requestId: details.requestId,
      ipAddress: details.ipAddress,
      outcome: AuditOutcome.DENIED,
      failureReason: details.reason,
    };

    await this.log(entry);
  }

  /**
   * Query audit logs
   */
  async query(params: AuditLogQuery): Promise<AuditLogQueryResult> {
    if (!this.pool) {
      throw new Error('Database pool not set');
    }

    // Flush buffer before querying to ensure consistency
    await this.flushBuffer();

    const conditions: string[] = ['1=1'];
    const values: unknown[] = [];
    let paramIndex = 1;

    if (params.patientId) {
      conditions.push(`patient_id = $${paramIndex++}`);
      values.push(params.patientId);
    }

    if (params.userId) {
      conditions.push(`user_id = $${paramIndex++}`);
      values.push(params.userId);
    }

    if (params.eventType) {
      conditions.push(`event_type = $${paramIndex++}`);
      values.push(params.eventType);
    }

    if (params.action) {
      conditions.push(`action = $${paramIndex++}`);
      values.push(params.action);
    }

    if (params.outcome) {
      conditions.push(`outcome = $${paramIndex++}`);
      values.push(params.outcome);
    }

    if (params.phiAccessOnly) {
      conditions.push('phi_accessed = true');
    }

    if (params.startDate) {
      conditions.push(`event_time >= $${paramIndex++}`);
      values.push(params.startDate);
    }

    if (params.endDate) {
      conditions.push(`event_time <= $${paramIndex++}`);
      values.push(params.endDate);
    }

    const whereClause = conditions.join(' AND ');
    const limit = params.limit || 100;
    const offset = params.offset || 0;

    // Get count
    const countQuery = `SELECT COUNT(*) FROM audit_log WHERE ${whereClause}`;
    const countResult = await this.pool.query(countQuery, values);
    const totalCount = parseInt(countResult.rows[0].count, 10);

    // Get entries
    const dataQuery = `
      SELECT id, event_type as "eventType", event_time as "eventTime",
             user_id as "userId", user_role as "userRole",
             patient_id as "patientId", resource_type as "resourceType",
             resource_id as "resourceId", action, phi_accessed as "phiAccessed",
             phi_fields as "phiFields", ip_address as "ipAddress",
             user_agent as "userAgent", request_id as "requestId",
             correlation_id as "correlationId", outcome,
             failure_reason as "failureReason", metadata
      FROM audit_log
      WHERE ${whereClause}
      ORDER BY event_time DESC
      LIMIT $${paramIndex++} OFFSET $${paramIndex++}
    `;

    const result = await this.pool.query(dataQuery, [...values, limit, offset]);

    return {
      entries: result.rows,
      totalCount,
      hasMore: offset + result.rows.length < totalCount,
    };
  }

  /**
   * Get audit logs for a specific patient (for patient access request)
   */
  async getPatientAuditLog(
    patientId: string,
    options?: { startDate?: Date; endDate?: Date }
  ): Promise<AuditLogEntry[]> {
    const result = await this.query({
      patientId,
      startDate: options?.startDate,
      endDate: options?.endDate,
      limit: 10000, // Large limit for compliance reports
    });

    return result.entries;
  }

  /**
   * Get audit logs for a specific user
   */
  async getUserAuditLog(
    userId: string,
    options?: { startDate?: Date; endDate?: Date }
  ): Promise<AuditLogEntry[]> {
    const result = await this.query({
      userId,
      startDate: options?.startDate,
      endDate: options?.endDate,
      limit: 10000,
    });

    return result.entries;
  }

  /**
   * Shutdown and flush remaining buffer
   */
  async shutdown(): Promise<void> {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    await this.flushBuffer();
  }

  /**
   * Create audit log entry from event
   */
  private createEntry(event: PHIAccessEvent): AuditLogEntry {
    return {
      id: uuidv4(),
      eventType: event.eventType,
      eventTime: event.eventTime,
      userId: event.userId,
      userRole: event.userRole,
      patientId: event.patientId,
      resourceType: event.resourceType,
      resourceId: event.resourceId,
      action: event.action,
      phiAccessed: event.phiAccessed,
      phiFields: event.phiFields,
      ipAddress: event.ipAddress,
      userAgent: event.userAgent,
      requestId: event.requestId,
      correlationId: event.correlationId,
      outcome: event.outcome,
      failureReason: event.failureReason,
      metadata: event.metadata,
    };
  }

  /**
   * Log an entry (buffered for performance)
   */
  private async log(entry: AuditLogEntry): Promise<void> {
    this.stats.totalLogged++;
    this.stats.currentBufferSize = this.buffer.length + 1;

    // Console log in development
    if (this.config.consoleLog) {
      this.logger.debug('Audit event', {
        eventType: entry.eventType,
        action: entry.action,
        resourceType: entry.resourceType,
        userId: entry.userId,
        phiAccessed: entry.phiAccessed,
        outcome: entry.outcome,
      });
    }

    // Buffer the entry
    this.buffer.push(entry);

    // Flush if buffer is full
    if (this.buffer.length >= this.config.bufferSize) {
      await this.flushBuffer();
    }

    // Safety valve: force flush if buffer gets too large
    if (this.buffer.length >= MAX_BUFFER_SIZE) {
      this.logger.warn('Buffer exceeded safety limit, forcing flush', {
        bufferSize: this.buffer.length,
        maxSize: MAX_BUFFER_SIZE,
      });
      await this.flushBuffer();
    }
  }

  /**
   * Flush buffer to database with retry logic
   */
  private async flushBuffer(retryCount = 0): Promise<void> {
    if (this.buffer.length === 0 || !this.pool) {
      return;
    }

    // Prevent concurrent flushes
    if (this.flushing && retryCount === 0) {
      return;
    }

    this.flushing = true;

    // Take entries from buffer
    const entries = [...this.buffer];
    this.buffer = [];
    this.stats.currentBufferSize = 0;

    let client: PoolClient | null = null;

    try {
      client = await this.pool.connect();
      await this.insertEntries(client, entries);

      // Update stats on success
      this.stats.totalFlushed += entries.length;
      this.stats.lastFlushAt = new Date();
      this.stats.flushCount++;

      this.flushing = false;
    } catch (error) {
      this.stats.lastErrorAt = new Date();

      const errorMessage = error instanceof Error ? error.message : String(error);

      // Should we retry?
      if (retryCount < this.config.maxRetries) {
        this.stats.retryCount++;
        const delay = RETRY_BASE_DELAY * Math.pow(2, retryCount);

        this.logger.warn('Flush failed, retrying', {
          attempt: retryCount + 1,
          maxRetries: this.config.maxRetries,
          delayMs: delay,
          entriesCount: entries.length,
          error: errorMessage,
        });

        // Re-add entries to front of buffer for retry
        this.buffer.unshift(...entries);
        this.stats.currentBufferSize = this.buffer.length;
        this.flushing = false;

        // Schedule retry with exponential backoff
        await this.sleep(delay);
        await this.flushBuffer(retryCount + 1);
      } else {
        // Max retries exceeded, move to dead letter queue
        this.stats.totalFailed += entries.length;
        this.logger.error('Flush failed after max retries, moving to DLQ', {
          entriesCount: entries.length,
          error: errorMessage,
        });

        this.addToDeadLetterQueue(entries, errorMessage);
        this.flushing = false;
      }
    } finally {
      if (client) {
        client.release();
      }
    }
  }

  /**
   * Insert entries into database
   */
  private async insertEntries(client: PoolClient, entries: AuditLogEntry[]): Promise<void> {
    // Build bulk insert
    const values: unknown[] = [];
    const valuePlaceholders: string[] = [];
    let paramIndex = 1;

    for (const entry of entries) {
      const placeholders = [
        `$${paramIndex++}`, // id
        `$${paramIndex++}`, // event_type
        `$${paramIndex++}`, // event_time
        `$${paramIndex++}`, // user_id
        `$${paramIndex++}`, // user_role
        `$${paramIndex++}`, // patient_id
        `$${paramIndex++}`, // resource_type
        `$${paramIndex++}`, // resource_id
        `$${paramIndex++}`, // action
        `$${paramIndex++}`, // phi_accessed
        `$${paramIndex++}`, // phi_fields
        `$${paramIndex++}`, // ip_address
        `$${paramIndex++}`, // user_agent
        `$${paramIndex++}`, // request_id
        `$${paramIndex++}`, // correlation_id
        `$${paramIndex++}`, // outcome
        `$${paramIndex++}`, // failure_reason
        `$${paramIndex++}`, // metadata
      ];
      valuePlaceholders.push(`(${placeholders.join(', ')})`);

      values.push(
        entry.id,
        entry.eventType,
        entry.eventTime,
        entry.userId,
        entry.userRole,
        entry.patientId ?? null,
        entry.resourceType,
        entry.resourceId ?? null,
        entry.action,
        entry.phiAccessed,
        entry.phiFields ?? null,
        entry.ipAddress ?? null,
        entry.userAgent ?? null,
        entry.requestId,
        entry.correlationId ?? null,
        entry.outcome,
        entry.failureReason ?? null,
        entry.metadata ? JSON.stringify(entry.metadata) : null
      );
    }

    const query = `
      INSERT INTO audit_log (
        id, event_type, event_time, user_id, user_role, patient_id,
        resource_type, resource_id, action, phi_accessed, phi_fields,
        ip_address, user_agent, request_id, correlation_id, outcome,
        failure_reason, metadata
      ) VALUES ${valuePlaceholders.join(', ')}
    `;

    await client.query(query, values);
  }

  /**
   * Add failed entries to dead letter queue
   */
  private addToDeadLetterQueue(entries: AuditLogEntry[], error: string): void {
    const dlqEntry: DeadLetterEntry = {
      entries,
      error,
      attempts: this.config.maxRetries,
      firstFailedAt: new Date(),
      lastFailedAt: new Date(),
    };

    this.deadLetterQueue.push(dlqEntry);
    this.stats.deadLetterQueueSize = this.deadLetterQueue.length;

    // Limit DLQ size to prevent memory issues
    if (this.deadLetterQueue.length > 100) {
      const removed = this.deadLetterQueue.shift();
      if (removed) {
        this.logger.error('DLQ overflow, discarding oldest entries', {
          discardedCount: removed.entries.length,
          discardedAt: removed.firstFailedAt,
        });
      }
    }
  }

  /**
   * Get dead letter queue entries
   */
  getDeadLetterQueue(): DeadLetterEntry[] {
    return [...this.deadLetterQueue];
  }

  /**
   * Retry dead letter queue entries
   */
  async retryDeadLetterQueue(): Promise<number> {
    if (this.deadLetterQueue.length === 0 || !this.pool) {
      return 0;
    }

    let retried = 0;
    const dlqCopy = [...this.deadLetterQueue];
    this.deadLetterQueue = [];

    for (const dlqEntry of dlqCopy) {
      try {
        const client = await this.pool.connect();
        try {
          await this.insertEntries(client, dlqEntry.entries);
          retried += dlqEntry.entries.length;
          this.stats.totalFlushed += dlqEntry.entries.length;
        } finally {
          client.release();
        }
      } catch {
        // Still failed, put back in DLQ
        dlqEntry.lastFailedAt = new Date();
        dlqEntry.attempts++;
        this.deadLetterQueue.push(dlqEntry);
      }
    }

    this.stats.deadLetterQueueSize = this.deadLetterQueue.length;
    return retried;
  }

  /**
   * Clear dead letter queue (use with caution!)
   */
  clearDeadLetterQueue(): number {
    const count = this.deadLetterQueue.reduce((sum, e) => sum + e.entries.length, 0);
    this.deadLetterQueue = [];
    this.stats.deadLetterQueueSize = 0;
    return count;
  }

  /**
   * Get logger statistics
   */
  getStats(): AuditLoggerStats {
    return { ...this.stats };
  }

  /**
   * Sleep utility for retry backoff
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Start periodic flush timer
   */
  private startFlushTimer(): void {
    if (this.flushTimer) {
      return;
    }

    this.flushTimer = setInterval(() => {
      this.flushBuffer().catch((error) => {
        this.logger.error('Periodic flush failed', {
          error: error instanceof Error ? error.message : String(error),
        });
      });
    }, this.config.flushInterval);

    // Ensure timer doesn't prevent process exit
    if (this.flushTimer.unref) {
      this.flushTimer.unref();
    }
  }
}

/**
 * Singleton audit logger instance
 */
export const auditLogger = new AuditLogger();

/**
 * Create audit logger with custom configuration
 */
export function createAuditLogger(config?: Partial<AuditConfig>): AuditLogger {
  return new AuditLogger(config);
}
