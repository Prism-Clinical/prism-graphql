/**
 * Audit Types
 *
 * Type definitions for HIPAA-compliant audit logging.
 */

import { AuditEventType, AuditAction, AuditOutcome } from '../types';

/**
 * Audit log entry structure
 */
export interface AuditLogEntry {
  /** Unique entry ID */
  id: string;
  /** Event type */
  eventType: AuditEventType;
  /** Event timestamp */
  eventTime: Date;
  /** User ID */
  userId: string;
  /** User role */
  userRole: string;
  /** Patient ID (if applicable) */
  patientId?: string;
  /** Resource type */
  resourceType: string;
  /** Resource ID */
  resourceId?: string;
  /** Action performed */
  action: AuditAction;
  /** Whether PHI was accessed */
  phiAccessed: boolean;
  /** PHI fields accessed (if any) */
  phiFields?: string[];
  /** Client IP address */
  ipAddress?: string;
  /** User agent */
  userAgent?: string;
  /** Request ID */
  requestId: string;
  /** Correlation ID for tracing */
  correlationId?: string;
  /** Outcome */
  outcome: AuditOutcome;
  /** Failure reason */
  failureReason?: string;
  /** Additional metadata (no PHI) */
  metadata?: Record<string, unknown>;
}

/**
 * Audit log query parameters
 */
export interface AuditLogQuery {
  /** Filter by patient ID */
  patientId?: string;
  /** Filter by user ID */
  userId?: string;
  /** Filter by event type */
  eventType?: AuditEventType;
  /** Filter by action */
  action?: AuditAction;
  /** Filter by outcome */
  outcome?: AuditOutcome;
  /** Filter PHI access only */
  phiAccessOnly?: boolean;
  /** Start date */
  startDate?: Date;
  /** End date */
  endDate?: Date;
  /** Pagination: limit */
  limit?: number;
  /** Pagination: offset */
  offset?: number;
}

/**
 * Audit log query result
 */
export interface AuditLogQueryResult {
  /** Matching entries */
  entries: AuditLogEntry[];
  /** Total count (for pagination) */
  totalCount: number;
  /** Whether more results exist */
  hasMore: boolean;
}

/**
 * Audit configuration
 */
export interface AuditConfig {
  /** Whether audit logging is enabled */
  enabled: boolean;
  /** Retention period in days (default: 2555 for HIPAA 7-year requirement) */
  retentionDays: number;
  /** Archive after days (default: 365) */
  archiveAfterDays: number;
  /** Whether to log to console (for development) */
  consoleLog: boolean;
  /** Whether to include sensitive event details */
  includeDetails: boolean;
  /** Buffer size before auto-flush (default: 100) */
  bufferSize?: number;
  /** Flush interval in milliseconds (default: 5000) */
  flushInterval?: number;
  /** Maximum retry attempts for failed flushes (default: 3) */
  maxRetries?: number;
}

/**
 * Audit export format
 */
export enum AuditExportFormat {
  JSON = 'JSON',
  CSV = 'CSV',
  PDF = 'PDF',
}

/**
 * Audit export request
 */
export interface AuditExportRequest {
  /** Query parameters */
  query: AuditLogQuery;
  /** Export format */
  format: AuditExportFormat;
  /** Requesting user ID */
  requestedBy: string;
  /** Reason for export */
  reason: string;
}

/**
 * Audit statistics
 */
export interface AuditStatistics {
  /** Time period */
  period: {
    start: Date;
    end: Date;
  };
  /** Total events */
  totalEvents: number;
  /** Events by type */
  byEventType: Record<AuditEventType, number>;
  /** Events by outcome */
  byOutcome: Record<AuditOutcome, number>;
  /** PHI access count */
  phiAccessCount: number;
  /** Unique users */
  uniqueUsers: number;
  /** Unique patients accessed */
  uniquePatients: number;
}
