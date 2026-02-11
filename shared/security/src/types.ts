/**
 * Security Types
 *
 * Core type definitions for HIPAA-compliant security infrastructure.
 */

/**
 * PHI Classification Levels per HIPAA guidelines
 */
export enum PHILevel {
  /** No PHI - Safe to log/cache freely (IDs, timestamps, system metadata) */
  NONE = 'NONE',
  /** Indirectly identifying - Can be combined to identify (age ranges, zip codes) */
  INDIRECT = 'INDIRECT',
  /** Directly identifying - Can identify on its own (name, MRN, DOB, email) */
  DIRECT = 'DIRECT',
  /** Sensitive health information - Protected health data (diagnoses, medications) */
  SENSITIVE = 'SENSITIVE',
}

/**
 * Audit event types for HIPAA compliance
 */
export enum AuditEventType {
  /** PHI data access */
  PHI_ACCESS = 'PHI_ACCESS',
  /** PHI data modification */
  PHI_MODIFICATION = 'PHI_MODIFICATION',
  /** PHI data export */
  PHI_EXPORT = 'PHI_EXPORT',
  /** ML service call with PHI */
  ML_SERVICE_CALL = 'ML_SERVICE_CALL',
  /** Authentication event */
  AUTHENTICATION = 'AUTHENTICATION',
  /** Authorization failure */
  AUTHORIZATION_FAILURE = 'AUTHORIZATION_FAILURE',
  /** System event */
  SYSTEM_EVENT = 'SYSTEM_EVENT',
}

/**
 * Audit action types
 */
export enum AuditAction {
  CREATE = 'CREATE',
  READ = 'READ',
  UPDATE = 'UPDATE',
  DELETE = 'DELETE',
  EXPORT = 'EXPORT',
  IMPORT = 'IMPORT',
}

/**
 * Audit outcome
 */
export enum AuditOutcome {
  SUCCESS = 'SUCCESS',
  FAILURE = 'FAILURE',
  DENIED = 'DENIED',
}

/**
 * Service identity for mTLS authentication
 */
export interface ServiceIdentity {
  /** Service name */
  serviceName: string;
  /** Service instance ID */
  instanceId: string;
  /** Service version */
  version: string;
  /** Environment (dev/staging/prod) */
  environment: string;
}

/**
 * Service JWT token claims
 */
export interface ServiceTokenClaims {
  /** Issuing service */
  iss: string;
  /** Subject (requesting service) */
  sub: string;
  /** Audience (target service) */
  aud: string;
  /** Expiration timestamp */
  exp: number;
  /** Issued at timestamp */
  iat: number;
  /** Unique token ID */
  jti: string;
  /** Allowed operations */
  permissions: string[];
  /** Correlation ID for tracing */
  correlationId?: string;
}

/**
 * Encrypted value wrapper
 */
export interface EncryptedValue {
  /** Encrypted ciphertext (base64) */
  ciphertext: string;
  /** Initialization vector (base64) */
  iv: string;
  /** Authentication tag (base64) */
  tag: string;
  /** Key ID used for encryption */
  keyId: string;
  /** Algorithm used */
  algorithm: string;
  /** Timestamp of encryption */
  encryptedAt: Date;
}

/**
 * PHI access event for audit logging
 */
export interface PHIAccessEvent {
  /** Event type */
  eventType: AuditEventType;
  /** Event timestamp */
  eventTime: Date;
  /** User ID accessing PHI */
  userId: string;
  /** User role */
  userRole: string;
  /** Patient ID (if applicable) */
  patientId?: string;
  /** Resource type being accessed */
  resourceType: string;
  /** Resource ID */
  resourceId?: string;
  /** Action performed */
  action: AuditAction;
  /** Whether PHI was accessed */
  phiAccessed: boolean;
  /** PHI fields accessed */
  phiFields?: string[];
  /** Client IP address */
  ipAddress?: string;
  /** User agent */
  userAgent?: string;
  /** Request ID */
  requestId: string;
  /** Correlation ID for distributed tracing */
  correlationId?: string;
  /** Outcome */
  outcome: AuditOutcome;
  /** Failure reason if applicable */
  failureReason?: string;
  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

/**
 * ML service call event for audit logging
 */
export interface MLServiceCallEvent extends PHIAccessEvent {
  /** Target ML service */
  targetService: string;
  /** API endpoint called */
  endpoint: string;
  /** Request duration in ms */
  durationMs?: number;
  /** Data fields sent to ML service */
  dataSent?: string[];
}

/**
 * Data export event for audit logging
 */
export interface DataExportEvent extends PHIAccessEvent {
  /** Export format */
  exportFormat: string;
  /** Number of records exported */
  recordCount: number;
  /** Export destination */
  destination?: string;
}

/**
 * Validation result for input sanitization
 */
export interface ValidationResult {
  /** Whether validation passed */
  isValid: boolean;
  /** Validation errors */
  errors: ValidationError[];
  /** Warnings (non-blocking) */
  warnings: ValidationWarning[];
  /** Sanitized value if applicable */
  sanitizedValue?: unknown;
}

/**
 * Validation error
 */
export interface ValidationError {
  /** Field that failed validation */
  field: string;
  /** Error code */
  code: string;
  /** Human-readable message */
  message: string;
  /** Rejected value (sanitized for logging) */
  rejectedValue?: string;
}

/**
 * Validation warning
 */
export interface ValidationWarning {
  /** Field with warning */
  field: string;
  /** Warning code */
  code: string;
  /** Human-readable message */
  message: string;
}

/**
 * Rate limit configuration
 */
export interface RateLimitConfig {
  /** Maximum requests */
  max: number;
  /** Time window (e.g., '1m', '1h') */
  window: string;
  /** Rate limit scope */
  per: 'user' | 'ip' | 'global';
}

/**
 * Rate limit result
 */
export interface RateLimitResult {
  /** Whether request is allowed */
  allowed: boolean;
  /** Remaining requests in window */
  remaining: number;
  /** Time until reset (seconds) */
  resetIn: number;
  /** Total limit */
  limit: number;
}

/**
 * Circuit breaker state
 */
export enum CircuitState {
  CLOSED = 'CLOSED',
  OPEN = 'OPEN',
  HALF_OPEN = 'HALF_OPEN',
}

/**
 * Circuit breaker configuration
 */
export interface CircuitBreakerConfig {
  /** Number of failures to open circuit */
  failureThreshold: number;
  /** Time window for failure count (ms) */
  failureWindow: number;
  /** Time before transitioning to half-open (ms) */
  resetTimeout: number;
  /** Requests to allow in half-open state */
  halfOpenRequests: number;
  /** Fallback function */
  fallback?: () => unknown;
}

/**
 * Health status for service checks
 */
export interface HealthStatus {
  /** Service name */
  service: string;
  /** Health status */
  status: 'HEALTHY' | 'DEGRADED' | 'UNHEALTHY';
  /** Response latency in ms */
  latency: number;
  /** Circuit breaker state */
  circuitState?: CircuitState;
  /** Last error message */
  lastError?: string;
  /** Last successful check */
  lastSuccess?: Date;
  /** Additional details */
  details?: Record<string, unknown>;
}

/**
 * Security event types for monitoring
 */
export enum SecurityEventType {
  AUTH_FAILURE = 'AUTH_FAILURE',
  UNAUTHORIZED_ACCESS = 'UNAUTHORIZED_ACCESS',
  RATE_LIMIT_EXCEEDED = 'RATE_LIMIT_EXCEEDED',
  INJECTION_ATTEMPT = 'INJECTION_ATTEMPT',
  UNUSUAL_ACCESS_PATTERN = 'UNUSUAL_ACCESS_PATTERN',
  SERVICE_AUTH_FAILURE = 'SERVICE_AUTH_FAILURE',
  CERTIFICATE_ERROR = 'CERTIFICATE_ERROR',
  ENCRYPTION_ERROR = 'ENCRYPTION_ERROR',
}

/**
 * Security event for monitoring and alerting
 */
export interface SecurityEvent {
  /** Event type */
  type: SecurityEventType;
  /** Event timestamp */
  timestamp: Date;
  /** Severity level */
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  /** User ID if applicable */
  userId?: string;
  /** IP address */
  ipAddress?: string;
  /** Request ID */
  requestId?: string;
  /** Correlation ID */
  correlationId?: string;
  /** Event description */
  description: string;
  /** Additional context (no PHI) */
  context?: Record<string, unknown>;
}
