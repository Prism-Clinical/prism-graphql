/**
 * Common Types for Service Clients
 *
 * Shared type definitions used across all ML service clients.
 */

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
}

/**
 * Retry configuration
 */
export interface RetryConfig {
  /** Maximum number of retry attempts */
  maxRetries: number;
  /** Initial delay before first retry (ms) */
  initialDelay: number;
  /** Maximum delay between retries (ms) */
  maxDelay: number;
  /** Backoff multiplier */
  backoffMultiplier: number;
  /** Whether to add jitter to delays */
  jitter: boolean;
}

/**
 * Service client configuration
 */
export interface ServiceClientConfig {
  /** Base URL of the service */
  baseUrl: string;
  /** Request timeout in milliseconds */
  timeout: number;
  /** Retry configuration */
  retry: RetryConfig;
  /** Circuit breaker configuration */
  circuitBreaker: CircuitBreakerConfig;
  /** Service JWT secret for signing requests */
  serviceAuthSecret?: string;
  /** Service name for authentication */
  serviceName: string;
}

/**
 * Health status response
 */
export interface HealthStatus {
  /** Service health status */
  status: 'HEALTHY' | 'DEGRADED' | 'UNHEALTHY';
  /** Service version */
  version: string;
  /** Response latency in ms */
  latency: number;
  /** Circuit breaker state */
  circuitState: CircuitState;
  /** Last error if any */
  lastError?: string;
  /** Last successful check timestamp */
  lastSuccess?: Date;
  /** Additional details */
  details?: Record<string, unknown>;
}

/**
 * Error response from ML services
 */
export interface ServiceErrorResponse {
  /** Error code */
  code: string;
  /** Error message */
  message: string;
  /** Error details */
  details?: Record<string, unknown>;
}

/**
 * Request options for client calls
 */
export interface RequestOptions {
  /** Request timeout override */
  timeout?: number;
  /** Request ID for tracing */
  requestId?: string;
  /** Correlation ID for distributed tracing */
  correlationId?: string;
  /** Whether to skip circuit breaker */
  skipCircuitBreaker?: boolean;
  /** Signal for request cancellation */
  signal?: AbortSignal;
}

/**
 * Response wrapper with metadata
 */
export interface ServiceResponse<T> {
  /** Response data */
  data: T;
  /** Response status code */
  statusCode: number;
  /** Response headers */
  headers: Record<string, string>;
  /** Request latency in ms */
  latency: number;
  /** Request ID */
  requestId: string;
  /** Whether response was from cache */
  cached: boolean;
}

/**
 * Default configurations
 */
export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  initialDelay: 1000,
  maxDelay: 10000,
  backoffMultiplier: 2,
  jitter: true,
};

export const DEFAULT_CIRCUIT_BREAKER_CONFIG: CircuitBreakerConfig = {
  failureThreshold: 5,
  failureWindow: 60000,
  resetTimeout: 120000,
  halfOpenRequests: 3,
};

export const DEFAULT_TIMEOUT = 30000;
