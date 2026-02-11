/**
 * Pipeline Error Handler
 *
 * Error handling and recovery strategies for the pipeline.
 */

import {
  PipelineError,
  PipelineErrorCategory,
  ErrorSeverity,
  PipelineStage,
  ServiceCriticality,
} from './types';

/**
 * Service criticality configuration
 */
export const SERVICE_CRITICALITY: Record<string, ServiceCriticality> = {
  'audio-intelligence': ServiceCriticality.IMPORTANT,
  'careplan-recommender': ServiceCriticality.IMPORTANT,
  'rag-embeddings': ServiceCriticality.NICE_TO_HAVE,
  'pdf-parser': ServiceCriticality.IMPORTANT,
  'safety-validation': ServiceCriticality.CRITICAL,
};

/**
 * Error category to severity mapping
 */
export const ERROR_SEVERITY_MAP: Record<PipelineErrorCategory, ErrorSeverity> = {
  [PipelineErrorCategory.VALIDATION_FAILED]: ErrorSeverity.FATAL,
  [PipelineErrorCategory.EXTRACTION_FAILED]: ErrorSeverity.DEGRADED,
  [PipelineErrorCategory.EMBEDDING_FAILED]: ErrorSeverity.RECOVERABLE,
  [PipelineErrorCategory.RECOMMENDATION_FAILED]: ErrorSeverity.DEGRADED,
  [PipelineErrorCategory.DRAFT_GENERATION_FAILED]: ErrorSeverity.RECOVERABLE,
  [PipelineErrorCategory.SERVICE_UNAVAILABLE]: ErrorSeverity.DEGRADED,
  [PipelineErrorCategory.AUTHENTICATION_FAILED]: ErrorSeverity.FATAL,
  [PipelineErrorCategory.AUTHORIZATION_FAILED]: ErrorSeverity.FATAL,
  [PipelineErrorCategory.RATE_LIMITED]: ErrorSeverity.RECOVERABLE,
  [PipelineErrorCategory.TIMEOUT]: ErrorSeverity.DEGRADED,
  [PipelineErrorCategory.INTERNAL_ERROR]: ErrorSeverity.FATAL,
};

/**
 * Patterns that indicate PHI and should be sanitized from error messages
 */
const PHI_PATTERNS = [
  /\b\d{3}-\d{2}-\d{4}\b/g, // SSN
  /\b\d{9}\b/g, // SSN without dashes
  /\b[A-Z]{2}\d{6,9}\b/g, // MRN patterns
  /\b\d{10}\b/g, // Phone numbers
  /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g, // Email
  /\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/g, // Date formats
  /\b(19|20)\d{2}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])\b/g, // ISO dates
  /\b[A-Z][a-z]+\s+[A-Z][a-z]+\b/g, // Potential names
];

/**
 * Sanitize error message to remove PHI
 */
export function sanitizeErrorMessage(message: string): string {
  let sanitized = message;

  for (const pattern of PHI_PATTERNS) {
    sanitized = sanitized.replace(pattern, '[REDACTED]');
  }

  // Truncate long messages
  if (sanitized.length > 500) {
    sanitized = sanitized.substring(0, 497) + '...';
  }

  return sanitized;
}

/**
 * Create a pipeline error with proper sanitization
 */
export function createPipelineError(
  category: PipelineErrorCategory,
  stage: PipelineStage,
  correlationId: string,
  originalError: Error | string,
  options?: {
    fallbackUsed?: boolean;
    retryCount?: number;
    overrideSeverity?: ErrorSeverity;
  }
): PipelineError {
  const message = typeof originalError === 'string' ? originalError : originalError.message;

  return {
    category,
    severity: options?.overrideSeverity ?? ERROR_SEVERITY_MAP[category],
    message: sanitizeErrorMessage(message),
    stage,
    correlationId,
    timestamp: new Date(),
    fallbackUsed: options?.fallbackUsed,
    retryCount: options?.retryCount,
  };
}

/**
 * Determine if an error is retryable
 */
export function isRetryableError(error: PipelineError): boolean {
  // Never retry fatal errors
  if (error.severity === ErrorSeverity.FATAL) {
    return false;
  }

  // Specific categories that are retryable
  const retryableCategories: PipelineErrorCategory[] = [
    PipelineErrorCategory.SERVICE_UNAVAILABLE,
    PipelineErrorCategory.TIMEOUT,
    PipelineErrorCategory.RATE_LIMITED,
  ];

  return retryableCategories.includes(error.category);
}

/**
 * Determine if pipeline should continue after error
 */
export function shouldContinueAfterError(error: PipelineError): boolean {
  return error.severity !== ErrorSeverity.FATAL;
}

/**
 * Get service criticality
 */
export function getServiceCriticality(serviceName: string): ServiceCriticality {
  return SERVICE_CRITICALITY[serviceName] ?? ServiceCriticality.IMPORTANT;
}

/**
 * Determine if service failure should abort pipeline
 */
export function shouldAbortOnServiceFailure(serviceName: string): boolean {
  const criticality = getServiceCriticality(serviceName);
  return criticality === ServiceCriticality.CRITICAL;
}

/**
 * Recovery action types
 */
export enum RecoveryAction {
  /** Retry the operation */
  RETRY = 'RETRY',
  /** Use fallback response */
  USE_FALLBACK = 'USE_FALLBACK',
  /** Skip this stage */
  SKIP = 'SKIP',
  /** Abort the pipeline */
  ABORT = 'ABORT',
  /** Continue with degraded results */
  DEGRADE = 'DEGRADE',
}

/**
 * Determine recovery action for an error
 */
export function determineRecoveryAction(
  error: PipelineError,
  currentRetryCount: number,
  maxRetries: number = 3
): RecoveryAction {
  // Fatal errors always abort
  if (error.severity === ErrorSeverity.FATAL) {
    return RecoveryAction.ABORT;
  }

  // Check if we can retry
  if (isRetryableError(error) && currentRetryCount < maxRetries) {
    return RecoveryAction.RETRY;
  }

  // Determine based on error category
  switch (error.category) {
    case PipelineErrorCategory.EXTRACTION_FAILED:
      return RecoveryAction.DEGRADE; // Continue without extraction

    case PipelineErrorCategory.EMBEDDING_FAILED:
      return RecoveryAction.SKIP; // Skip personalization

    case PipelineErrorCategory.RECOMMENDATION_FAILED:
      return RecoveryAction.USE_FALLBACK; // Use basic templates

    case PipelineErrorCategory.DRAFT_GENERATION_FAILED:
      return RecoveryAction.SKIP; // Return recommendations only

    default:
      return RecoveryAction.DEGRADE;
  }
}

/**
 * Error aggregator for collecting multiple errors
 */
export class PipelineErrorAggregator {
  private errors: PipelineError[] = [];
  private degradedServices: Set<string> = new Set();

  /**
   * Add an error
   */
  addError(error: PipelineError, serviceName?: string): void {
    this.errors.push(error);
    if (serviceName) {
      this.degradedServices.add(serviceName);
    }
  }

  /**
   * Check if any fatal errors occurred
   */
  hasFatalError(): boolean {
    return this.errors.some((e) => e.severity === ErrorSeverity.FATAL);
  }

  /**
   * Get all errors
   */
  getErrors(): PipelineError[] {
    return [...this.errors];
  }

  /**
   * Get degraded services
   */
  getDegradedServices(): string[] {
    return [...this.degradedServices];
  }

  /**
   * Get the most severe error
   */
  getMostSevereError(): PipelineError | undefined {
    const severityOrder = [ErrorSeverity.FATAL, ErrorSeverity.DEGRADED, ErrorSeverity.RECOVERABLE];

    for (const severity of severityOrder) {
      const error = this.errors.find((e) => e.severity === severity);
      if (error) return error;
    }

    return undefined;
  }

  /**
   * Check if pipeline should continue
   */
  shouldContinue(): boolean {
    return !this.hasFatalError();
  }

  /**
   * Clear all errors
   */
  clear(): void {
    this.errors = [];
    this.degradedServices.clear();
  }
}

/**
 * Alert manager for critical errors
 */
export interface AlertConfig {
  /** Callback for security alerts */
  onSecurityAlert?: (error: PipelineError) => Promise<void>;
  /** Callback for critical service failures */
  onCriticalFailure?: (error: PipelineError, serviceName: string) => Promise<void>;
  /** Callback for rate limit exceeded */
  onRateLimitExceeded?: (error: PipelineError) => Promise<void>;
}

/**
 * Process alerts for errors
 */
export async function processAlerts(
  error: PipelineError,
  serviceName: string | undefined,
  config: AlertConfig
): Promise<void> {
  // Security alerts
  if (
    error.category === PipelineErrorCategory.AUTHENTICATION_FAILED ||
    error.category === PipelineErrorCategory.AUTHORIZATION_FAILED
  ) {
    await config.onSecurityAlert?.(error);
  }

  // Critical service failures
  if (serviceName && shouldAbortOnServiceFailure(serviceName)) {
    await config.onCriticalFailure?.(error, serviceName);
  }

  // Rate limiting
  if (error.category === PipelineErrorCategory.RATE_LIMITED) {
    await config.onRateLimitExceeded?.(error);
  }
}
