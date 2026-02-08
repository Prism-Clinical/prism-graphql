/**
 * HTTP Utilities
 *
 * Provides resilient HTTP primitives: retry with exponential backoff,
 * circuit breaker pattern, and timeout handling.
 */

import { Logger, createLogger } from "./logger";

// =============================================================================
// TYPES
// =============================================================================

export interface RetryOptions {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  retryableStatuses: number[];
}

export interface CircuitBreakerOptions {
  failureThreshold: number;
  resetTimeoutMs: number;
}

export interface HttpClientOptions {
  baseUrl: string;
  timeout: number;
  retry: RetryOptions;
  circuitBreaker: CircuitBreakerOptions;
  maxPayloadBytes: number;
  serviceName: string;
}

export interface RequestOptions {
  method: "GET" | "POST" | "PUT" | "DELETE";
  path: string;
  body?: unknown;
  headers?: Record<string, string>;
  requestId?: string;
}

export interface HttpResponse<T> {
  data: T;
  status: number;
  durationMs: number;
}

export class HttpError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly responseBody?: string,
    public readonly requestId?: string
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export class CircuitOpenError extends Error {
  constructor(
    public readonly serviceName: string,
    public readonly resetAt: Date
  ) {
    super(
      `Circuit breaker open for ${serviceName}. Resets at ${resetAt.toISOString()}`
    );
    this.name = "CircuitOpenError";
  }
}

export class PayloadTooLargeError extends Error {
  constructor(
    public readonly actualBytes: number,
    public readonly maxBytes: number
  ) {
    super(
      `Payload too large: ${actualBytes} bytes exceeds limit of ${maxBytes} bytes`
    );
    this.name = "PayloadTooLargeError";
  }
}

// =============================================================================
// CIRCUIT BREAKER
// =============================================================================

enum CircuitState {
  CLOSED = "CLOSED",
  OPEN = "OPEN",
  HALF_OPEN = "HALF_OPEN",
}

class CircuitBreaker {
  private state: CircuitState = CircuitState.CLOSED;
  private failureCount = 0;
  private lastFailureTime: number = 0;
  private readonly logger: Logger;

  constructor(
    private readonly options: CircuitBreakerOptions,
    private readonly serviceName: string
  ) {
    this.logger = createLogger(`circuit-breaker:${serviceName}`);
  }

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === CircuitState.OPEN) {
      const resetAt = new Date(
        this.lastFailureTime + this.options.resetTimeoutMs
      );
      if (Date.now() < resetAt.getTime()) {
        throw new CircuitOpenError(this.serviceName, resetAt);
      }
      // Try half-open
      this.state = CircuitState.HALF_OPEN;
      this.logger.info("Circuit transitioning to HALF_OPEN");
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  private onSuccess(): void {
    if (this.state === CircuitState.HALF_OPEN) {
      this.logger.info("Circuit CLOSED after successful half-open request");
    }
    this.failureCount = 0;
    this.state = CircuitState.CLOSED;
  }

  private onFailure(): void {
    this.failureCount++;
    this.lastFailureTime = Date.now();

    if (this.failureCount >= this.options.failureThreshold) {
      this.state = CircuitState.OPEN;
      this.logger.warn(
        `Circuit OPEN after ${this.failureCount} consecutive failures`
      );
    }
  }

  getState(): CircuitState {
    return this.state;
  }

  reset(): void {
    this.state = CircuitState.CLOSED;
    this.failureCount = 0;
    this.lastFailureTime = 0;
  }
}

// =============================================================================
// RETRY LOGIC
// =============================================================================

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function calculateBackoff(
  attempt: number,
  baseDelayMs: number,
  maxDelayMs: number
): number {
  const exponentialDelay = baseDelayMs * Math.pow(2, attempt);
  const jitter = Math.random() * 0.3 * exponentialDelay;
  return Math.min(exponentialDelay + jitter, maxDelayMs);
}

function isRetryable(status: number, retryableStatuses: number[]): boolean {
  return retryableStatuses.includes(status);
}

// =============================================================================
// HTTP CLIENT
// =============================================================================

const DEFAULT_OPTIONS: Omit<HttpClientOptions, "baseUrl" | "serviceName"> = {
  timeout: 5000,
  retry: {
    maxAttempts: 3,
    baseDelayMs: 100,
    maxDelayMs: 5000,
    retryableStatuses: [408, 429, 500, 502, 503, 504],
  },
  circuitBreaker: {
    failureThreshold: 5,
    resetTimeoutMs: 30000,
  },
  maxPayloadBytes: 10 * 1024 * 1024, // 10MB
};

export class ResilientHttpClient {
  private readonly options: HttpClientOptions;
  private readonly circuitBreaker: CircuitBreaker;
  private readonly logger: Logger;

  constructor(options: Partial<HttpClientOptions> & Pick<HttpClientOptions, "baseUrl" | "serviceName">) {
    this.options = {
      ...DEFAULT_OPTIONS,
      ...options,
      retry: { ...DEFAULT_OPTIONS.retry, ...options.retry },
      circuitBreaker: {
        ...DEFAULT_OPTIONS.circuitBreaker,
        ...options.circuitBreaker,
      },
    };
    this.circuitBreaker = new CircuitBreaker(
      this.options.circuitBreaker,
      this.options.serviceName
    );
    this.logger = createLogger(`http:${this.options.serviceName}`);
  }

  async request<T>(options: RequestOptions): Promise<HttpResponse<T>> {
    const requestId = options.requestId ?? generateRequestId();
    const startTime = Date.now();

    // Validate payload size
    if (options.body) {
      const payloadSize = JSON.stringify(options.body).length;
      if (payloadSize > this.options.maxPayloadBytes) {
        throw new PayloadTooLargeError(payloadSize, this.options.maxPayloadBytes);
      }
    }

    return this.circuitBreaker.execute(async () => {
      let lastError: Error | null = null;

      for (let attempt = 0; attempt < this.options.retry.maxAttempts; attempt++) {
        try {
          const result = await this.executeRequest<T>(options, requestId);

          if (attempt > 0) {
            this.logger.info(
              `Request succeeded after ${attempt + 1} attempts`,
              { requestId, path: options.path }
            );
          }

          return {
            ...result,
            durationMs: Date.now() - startTime,
          };
        } catch (error) {
          lastError = error as Error;

          if (error instanceof HttpError) {
            if (!isRetryable(error.status, this.options.retry.retryableStatuses)) {
              throw error;
            }
          }

          if (attempt < this.options.retry.maxAttempts - 1) {
            const delay = calculateBackoff(
              attempt,
              this.options.retry.baseDelayMs,
              this.options.retry.maxDelayMs
            );
            this.logger.warn(
              `Request failed, retrying in ${delay}ms (attempt ${attempt + 1}/${this.options.retry.maxAttempts})`,
              { requestId, path: options.path, error: (error as Error).message }
            );
            await sleep(delay);
          }
        }
      }

      throw lastError ?? new Error("Request failed after all retry attempts");
    });
  }

  private async executeRequest<T>(
    options: RequestOptions,
    requestId: string
  ): Promise<Omit<HttpResponse<T>, "durationMs">> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.options.timeout);

    const url = `${this.options.baseUrl}${options.path}`;

    try {
      const response = await fetch(url, {
        method: options.method,
        headers: {
          "Content-Type": "application/json",
          "X-Request-ID": requestId,
          ...options.headers,
        },
        body: options.body ? JSON.stringify(options.body) : undefined,
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorBody = await response.text();
        throw new HttpError(
          `${options.method} ${options.path} failed: ${response.status}`,
          response.status,
          errorBody,
          requestId
        );
      }

      const data = await response.json();
      return { data, status: response.status };
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new HttpError(
          `Request timed out after ${this.options.timeout}ms`,
          408,
          undefined,
          requestId
        );
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  async get<T>(path: string, requestId?: string): Promise<HttpResponse<T>> {
    return this.request<T>({ method: "GET", path, requestId });
  }

  async post<T>(
    path: string,
    body: unknown,
    requestId?: string
  ): Promise<HttpResponse<T>> {
    return this.request<T>({ method: "POST", path, body, requestId });
  }

  async healthCheck(): Promise<boolean> {
    try {
      await this.request({ method: "GET", path: "/health" });
      return true;
    } catch {
      return false;
    }
  }

  resetCircuitBreaker(): void {
    this.circuitBreaker.reset();
  }
}

// =============================================================================
// UTILITIES
// =============================================================================

function generateRequestId(): string {
  return `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
}

export { generateRequestId };
