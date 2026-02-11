/**
 * Retry Utility
 *
 * Implements retry logic with exponential backoff and jitter.
 */

import { RetryConfig, DEFAULT_RETRY_CONFIG } from './types';

/**
 * Check if an error is retryable
 */
export function isRetryableError(error: unknown): boolean {
  if (error instanceof Error) {
    // Network errors
    if (
      error.message.includes('ECONNREFUSED') ||
      error.message.includes('ECONNRESET') ||
      error.message.includes('ETIMEDOUT') ||
      error.message.includes('ENOTFOUND') ||
      error.message.includes('socket hang up')
    ) {
      return true;
    }
  }

  // HTTP status code errors
  if (isHttpError(error)) {
    const status = getHttpStatus(error);
    // Retry on 5xx errors and 429 (rate limit)
    return status >= 500 || status === 429;
  }

  return false;
}

/**
 * Check if error is an HTTP error
 */
function isHttpError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'statusCode' in error;
}

/**
 * Get HTTP status from error
 */
function getHttpStatus(error: unknown): number {
  if (typeof error === 'object' && error !== null) {
    const obj = error as Record<string, unknown>;
    if (typeof obj.statusCode === 'number') {
      return obj.statusCode;
    }
    if (typeof obj.status === 'number') {
      return obj.status;
    }
  }
  return 0;
}

/**
 * Calculate delay with exponential backoff and optional jitter
 */
export function calculateDelay(
  attempt: number,
  config: RetryConfig = DEFAULT_RETRY_CONFIG
): number {
  // Exponential backoff
  let delay = config.initialDelay * Math.pow(config.backoffMultiplier, attempt);

  // Cap at max delay
  delay = Math.min(delay, config.maxDelay);

  // Add jitter (±25%)
  if (config.jitter) {
    const jitterRange = delay * 0.25;
    delay = delay - jitterRange + Math.random() * jitterRange * 2;
  }

  return Math.floor(delay);
}

/**
 * Sleep for a given duration
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Retry a function with exponential backoff
 */
export async function retry<T>(
  fn: () => Promise<T>,
  config: RetryConfig = DEFAULT_RETRY_CONFIG,
  shouldRetry: (error: unknown) => boolean = isRetryableError
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      // Check if we should retry
      if (!shouldRetry(error)) {
        throw error;
      }

      // Check if we've exhausted retries
      if (attempt === config.maxRetries) {
        throw error;
      }

      // Calculate and wait for delay
      const delay = calculateDelay(attempt, config);
      console.log(
        `[Retry] Attempt ${attempt + 1}/${config.maxRetries} failed, retrying in ${delay}ms`,
        error instanceof Error ? error.message : error
      );
      await sleep(delay);
    }
  }

  throw lastError;
}

/**
 * Create a retry wrapper with custom configuration
 */
export function createRetryWrapper(config: Partial<RetryConfig> = {}) {
  const fullConfig = { ...DEFAULT_RETRY_CONFIG, ...config };

  return <T>(fn: () => Promise<T>, shouldRetry?: (error: unknown) => boolean): Promise<T> => {
    return retry(fn, fullConfig, shouldRetry);
  };
}

/**
 * Retry with abort signal support
 */
export async function retryWithAbort<T>(
  fn: () => Promise<T>,
  signal: AbortSignal | undefined,
  config: RetryConfig = DEFAULT_RETRY_CONFIG,
  shouldRetry: (error: unknown) => boolean = isRetryableError
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
    // Check if aborted
    if (signal?.aborted) {
      throw new AbortError('Operation was aborted');
    }

    try {
      return await fn();
    } catch (error) {
      lastError = error;

      // Check if we should retry
      if (!shouldRetry(error)) {
        throw error;
      }

      // Check if we've exhausted retries
      if (attempt === config.maxRetries) {
        throw error;
      }

      // Calculate delay
      const delay = calculateDelay(attempt, config);

      // Wait with abort support
      await Promise.race([
        sleep(delay),
        new Promise<never>((_, reject) => {
          signal?.addEventListener('abort', () => {
            reject(new AbortError('Operation was aborted'));
          });
        }),
      ]);
    }
  }

  throw lastError;
}

/**
 * Abort error
 */
export class AbortError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AbortError';
  }
}
