/**
 * Security Event Monitoring
 *
 * Security event logging and anomaly detection.
 */

import { Redis } from 'ioredis';
import { metricsCollector } from './metrics';

/**
 * Security event types
 */
export enum SecurityEventType {
  AUTH_FAILURE = 'AUTH_FAILURE',
  UNAUTHORIZED_ACCESS = 'UNAUTHORIZED_ACCESS',
  RATE_LIMIT_EXCEEDED = 'RATE_LIMIT_EXCEEDED',
  INJECTION_ATTEMPT = 'INJECTION_ATTEMPT',
  UNUSUAL_ACCESS_PATTERN = 'UNUSUAL_ACCESS_PATTERN',
  SERVICE_AUTH_FAILURE = 'SERVICE_AUTH_FAILURE',
  PHI_ACCESS_ANOMALY = 'PHI_ACCESS_ANOMALY',
  DATA_EXPORT = 'DATA_EXPORT',
  BULK_OPERATION = 'BULK_OPERATION',
}

/**
 * Security event severity
 */
export enum SecurityEventSeverity {
  LOW = 'LOW',
  MEDIUM = 'MEDIUM',
  HIGH = 'HIGH',
  CRITICAL = 'CRITICAL',
}

/**
 * Security event
 */
export interface SecurityEvent {
  /** Event type */
  type: SecurityEventType;
  /** Severity level */
  severity: SecurityEventSeverity;
  /** Event timestamp */
  timestamp: Date;
  /** User ID if known */
  userId?: string;
  /** IP address */
  ipAddress?: string;
  /** User agent */
  userAgent?: string;
  /** Correlation ID */
  correlationId?: string;
  /** Resource accessed */
  resource?: string;
  /** Action attempted */
  action?: string;
  /** Additional details (no PHI) */
  details?: Record<string, unknown>;
}

/**
 * Alert callback type
 */
export type AlertCallback = (event: SecurityEvent) => Promise<void>;

/**
 * Security event logger configuration
 */
export interface SecurityLoggerConfig {
  /** Redis client for rate tracking */
  redis?: Redis;
  /** Alert callback for critical events */
  onCriticalAlert?: AlertCallback;
  /** Alert callback for high severity events */
  onHighAlert?: AlertCallback;
  /** SIEM integration callback */
  onSiemEvent?: AlertCallback;
  /** Enable anomaly detection */
  enableAnomalyDetection?: boolean;
}

/**
 * Security event logger
 */
export class SecurityEventLogger {
  private config: SecurityLoggerConfig;
  private accessPatterns: Map<string, number[]> = new Map();

  constructor(config: SecurityLoggerConfig = {}) {
    this.config = config;
  }

  /**
   * Log a security event
   */
  async logEvent(event: SecurityEvent): Promise<void> {
    // Always log to console with structured format
    console.log(JSON.stringify({
      level: 'SECURITY',
      ...event,
      timestamp: event.timestamp.toISOString(),
    }));

    // Update metrics
    metricsCollector.recordAuthFailure(event.type);

    // Alert based on severity
    await this.processAlerts(event);

    // Track for anomaly detection
    if (this.config.enableAnomalyDetection && event.userId) {
      await this.trackAccessPattern(event);
    }

    // Send to SIEM if configured
    if (this.config.onSiemEvent) {
      await this.config.onSiemEvent(event);
    }
  }

  /**
   * Log authentication failure
   */
  async logAuthFailure(details: {
    userId?: string;
    ipAddress?: string;
    userAgent?: string;
    reason: string;
    correlationId?: string;
  }): Promise<void> {
    await this.logEvent({
      type: SecurityEventType.AUTH_FAILURE,
      severity: SecurityEventSeverity.MEDIUM,
      timestamp: new Date(),
      userId: details.userId,
      ipAddress: details.ipAddress,
      userAgent: details.userAgent,
      correlationId: details.correlationId,
      details: { reason: details.reason },
    });

    // Check for brute force
    if (details.ipAddress) {
      await this.checkBruteForce(details.ipAddress);
    }
  }

  /**
   * Log unauthorized access attempt
   */
  async logUnauthorizedAccess(details: {
    userId: string;
    resource: string;
    action: string;
    ipAddress?: string;
    correlationId?: string;
  }): Promise<void> {
    await this.logEvent({
      type: SecurityEventType.UNAUTHORIZED_ACCESS,
      severity: SecurityEventSeverity.HIGH,
      timestamp: new Date(),
      userId: details.userId,
      ipAddress: details.ipAddress,
      resource: details.resource,
      action: details.action,
      correlationId: details.correlationId,
    });
  }

  /**
   * Log injection attempt
   */
  async logInjectionAttempt(details: {
    userId?: string;
    ipAddress?: string;
    injectionType: string;
    targetField: string;
    correlationId?: string;
  }): Promise<void> {
    await this.logEvent({
      type: SecurityEventType.INJECTION_ATTEMPT,
      severity: SecurityEventSeverity.CRITICAL,
      timestamp: new Date(),
      userId: details.userId,
      ipAddress: details.ipAddress,
      correlationId: details.correlationId,
      details: {
        injectionType: details.injectionType,
        targetField: details.targetField,
      },
    });
  }

  /**
   * Log rate limit exceeded
   */
  async logRateLimitExceeded(details: {
    userId: string;
    ipAddress?: string;
    endpoint: string;
    limit: number;
    correlationId?: string;
  }): Promise<void> {
    await this.logEvent({
      type: SecurityEventType.RATE_LIMIT_EXCEEDED,
      severity: SecurityEventSeverity.MEDIUM,
      timestamp: new Date(),
      userId: details.userId,
      ipAddress: details.ipAddress,
      resource: details.endpoint,
      correlationId: details.correlationId,
      details: { limit: details.limit },
    });
  }

  /**
   * Log unusual access pattern
   */
  async logUnusualAccessPattern(details: {
    userId: string;
    pattern: string;
    severity: SecurityEventSeverity;
    correlationId?: string;
  }): Promise<void> {
    await this.logEvent({
      type: SecurityEventType.UNUSUAL_ACCESS_PATTERN,
      severity: details.severity,
      timestamp: new Date(),
      userId: details.userId,
      correlationId: details.correlationId,
      details: { pattern: details.pattern },
    });
  }

  /**
   * Log PHI access anomaly
   */
  async logPhiAccessAnomaly(details: {
    userId: string;
    patientCount: number;
    timeWindowMinutes: number;
    threshold: number;
    correlationId?: string;
  }): Promise<void> {
    await this.logEvent({
      type: SecurityEventType.PHI_ACCESS_ANOMALY,
      severity: SecurityEventSeverity.HIGH,
      timestamp: new Date(),
      userId: details.userId,
      correlationId: details.correlationId,
      details: {
        patientCount: details.patientCount,
        timeWindowMinutes: details.timeWindowMinutes,
        threshold: details.threshold,
      },
    });
  }

  /**
   * Process alerts based on severity
   */
  private async processAlerts(event: SecurityEvent): Promise<void> {
    if (event.severity === SecurityEventSeverity.CRITICAL) {
      if (this.config.onCriticalAlert) {
        await this.config.onCriticalAlert(event);
      }
    } else if (event.severity === SecurityEventSeverity.HIGH) {
      if (this.config.onHighAlert) {
        await this.config.onHighAlert(event);
      }
    }
  }

  /**
   * Track access patterns for anomaly detection
   */
  private async trackAccessPattern(event: SecurityEvent): Promise<void> {
    if (!event.userId) return;

    const key = event.userId;
    const now = Date.now();

    let timestamps = this.accessPatterns.get(key) || [];

    // Keep only last hour
    timestamps = timestamps.filter((t) => now - t < 3600000);
    timestamps.push(now);

    this.accessPatterns.set(key, timestamps);

    // Check for anomalies
    if (timestamps.length > 100) {
      // More than 100 accesses in an hour
      await this.logUnusualAccessPattern({
        userId: event.userId,
        pattern: 'HIGH_FREQUENCY_ACCESS',
        severity: SecurityEventSeverity.MEDIUM,
        correlationId: event.correlationId,
      });
    }
  }

  /**
   * Check for brute force attacks
   */
  private async checkBruteForce(ipAddress: string): Promise<void> {
    if (!this.config.redis) return;

    const key = `security:bruteforce:${ipAddress}`;
    const count = await this.config.redis.incr(key);

    if (count === 1) {
      // Set expiry on first increment
      await this.config.redis.expire(key, 900); // 15 minutes
    }

    if (count >= 10) {
      // 10 failures in 15 minutes
      await this.logEvent({
        type: SecurityEventType.AUTH_FAILURE,
        severity: SecurityEventSeverity.CRITICAL,
        timestamp: new Date(),
        ipAddress,
        details: {
          pattern: 'BRUTE_FORCE_DETECTED',
          failureCount: count,
        },
      });
    }
  }

  /**
   * Get security event summary for dashboard
   */
  async getEventSummary(hours: number = 24): Promise<SecurityEventSummary> {
    // In production, this would query from a security event store
    return {
      totalEvents: 0,
      criticalEvents: 0,
      highEvents: 0,
      mediumEvents: 0,
      lowEvents: 0,
      topEventTypes: [],
      topSourceIps: [],
      timeRange: {
        start: new Date(Date.now() - hours * 3600000),
        end: new Date(),
      },
    };
  }
}

/**
 * Security event summary
 */
export interface SecurityEventSummary {
  totalEvents: number;
  criticalEvents: number;
  highEvents: number;
  mediumEvents: number;
  lowEvents: number;
  topEventTypes: Array<{ type: SecurityEventType; count: number }>;
  topSourceIps: Array<{ ip: string; count: number }>;
  timeRange: {
    start: Date;
    end: Date;
  };
}

// Export singleton instance
export const securityEventLogger = new SecurityEventLogger();
