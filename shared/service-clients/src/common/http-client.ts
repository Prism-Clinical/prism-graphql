/**
 * HTTP Client
 *
 * Base HTTP client with retry, circuit breaker, and service authentication.
 */

import * as http from 'http';
import * as https from 'https';
import { URL } from 'url';
import { v4 as uuidv4 } from 'uuid';
import {
  ServiceClientConfig,
  RequestOptions,
  ServiceResponse,
  HealthStatus,
  CircuitState,
  DEFAULT_RETRY_CONFIG,
  DEFAULT_CIRCUIT_BREAKER_CONFIG,
  DEFAULT_TIMEOUT,
} from './types';
import { CircuitBreaker, CircuitBreakerError } from './circuit-breaker';
import { retry, isRetryableError } from './retry';

/**
 * HTTP Error with status code
 */
export class HttpError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly body?: unknown
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

/**
 * Base HTTP client for ML services
 */
export abstract class BaseHttpClient {
  protected readonly config: ServiceClientConfig;
  protected readonly circuitBreaker: CircuitBreaker;
  private lastError: string | undefined;
  private lastSuccess: Date | undefined;

  constructor(config: Partial<ServiceClientConfig> & { baseUrl: string; serviceName: string }) {
    this.config = {
      timeout: config.timeout ?? DEFAULT_TIMEOUT,
      retry: { ...DEFAULT_RETRY_CONFIG, ...config.retry },
      circuitBreaker: { ...DEFAULT_CIRCUIT_BREAKER_CONFIG, ...config.circuitBreaker },
      ...config,
    };

    this.circuitBreaker = new CircuitBreaker(
      `${config.serviceName}`,
      this.config.circuitBreaker
    );
  }

  /**
   * Make HTTP request with retry and circuit breaker
   */
  protected async request<T>(
    method: string,
    path: string,
    body?: unknown,
    options: RequestOptions = {}
  ): Promise<ServiceResponse<T>> {
    const requestId = options.requestId || uuidv4();
    const correlationId = options.correlationId || uuidv4();
    const timeout = options.timeout ?? this.config.timeout;

    // Check circuit breaker
    if (!options.skipCircuitBreaker && !this.circuitBreaker.canExecute()) {
      throw new CircuitBreakerError(
        `Circuit breaker for ${this.config.serviceName} is open`,
        this.config.serviceName
      );
    }

    const startTime = Date.now();

    const makeRequest = async (): Promise<ServiceResponse<T>> => {
      const url = new URL(path, this.config.baseUrl);
      const isHttps = url.protocol === 'https:';
      const httpModule = isHttps ? https : http;

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'X-Request-ID': requestId,
        'X-Correlation-ID': correlationId,
      };

      // Add service authentication if configured
      if (this.config.serviceAuthSecret) {
        const token = this.createServiceToken();
        headers['Authorization'] = `Bearer ${token}`;
      }

      const requestOptions: http.RequestOptions = {
        method,
        hostname: url.hostname,
        port: url.port || (isHttps ? 443 : 80),
        path: url.pathname + url.search,
        headers,
        timeout,
      };

      return new Promise<ServiceResponse<T>>((resolve, reject) => {
        const req = httpModule.request(requestOptions, (res) => {
          let data = '';

          res.on('data', (chunk) => {
            data += chunk;
          });

          res.on('end', () => {
            const latency = Date.now() - startTime;
            const responseHeaders: Record<string, string> = {};

            for (const [key, value] of Object.entries(res.headers)) {
              if (value) {
                responseHeaders[key] = Array.isArray(value) ? value.join(', ') : value;
              }
            }

            if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
              try {
                const parsedData = data ? JSON.parse(data) : null;
                this.lastSuccess = new Date();
                this.circuitBreaker.recordSuccess();

                resolve({
                  data: parsedData as T,
                  statusCode: res.statusCode,
                  headers: responseHeaders,
                  latency,
                  requestId,
                  cached: false,
                });
              } catch {
                reject(new HttpError('Invalid JSON response', res.statusCode, data));
              }
            } else {
              const statusCode = res.statusCode || 500;
              let errorBody: unknown;
              try {
                errorBody = JSON.parse(data);
              } catch {
                errorBody = data;
              }

              const error = new HttpError(
                `HTTP ${statusCode}: ${res.statusMessage}`,
                statusCode,
                errorBody
              );

              this.lastError = error.message;
              this.circuitBreaker.recordFailure(error);

              reject(error);
            }
          });
        });

        req.on('error', (error) => {
          this.lastError = error.message;
          this.circuitBreaker.recordFailure(error);
          reject(error);
        });

        req.on('timeout', () => {
          req.destroy();
          const error = new HttpError('Request timeout', 408);
          this.lastError = error.message;
          this.circuitBreaker.recordFailure(error);
          reject(error);
        });

        // Handle abort signal
        if (options.signal) {
          options.signal.addEventListener('abort', () => {
            req.destroy();
            reject(new Error('Request aborted'));
          });
        }

        if (body) {
          req.write(JSON.stringify(body));
        }

        req.end();
      });
    };

    // Execute with retry
    return retry(makeRequest, this.config.retry, (error) => {
      return isRetryableError(error);
    });
  }

  /**
   * GET request
   */
  protected async get<T>(path: string, options?: RequestOptions): Promise<ServiceResponse<T>> {
    return this.request<T>('GET', path, undefined, options);
  }

  /**
   * POST request
   */
  protected async post<T>(
    path: string,
    body: unknown,
    options?: RequestOptions
  ): Promise<ServiceResponse<T>> {
    return this.request<T>('POST', path, body, options);
  }

  /**
   * Health check
   */
  async healthCheck(): Promise<HealthStatus> {
    const startTime = Date.now();

    try {
      const response = await this.get<{ status: string; version?: string }>('/health', {
        timeout: 5000,
        skipCircuitBreaker: true,
      });

      return {
        status: response.data.status === 'healthy' ? 'HEALTHY' : 'DEGRADED',
        version: response.data.version || 'unknown',
        latency: Date.now() - startTime,
        circuitState: this.circuitBreaker.getState(),
        lastSuccess: this.lastSuccess,
      };
    } catch (error) {
      return {
        status: 'UNHEALTHY',
        version: 'unknown',
        latency: Date.now() - startTime,
        circuitState: this.circuitBreaker.getState(),
        lastError: error instanceof Error ? error.message : String(error),
        lastSuccess: this.lastSuccess,
      };
    }
  }

  /**
   * Get circuit breaker state
   */
  getCircuitState(): CircuitState {
    return this.circuitBreaker.getState();
  }

  /**
   * Reset circuit breaker
   */
  resetCircuit(): void {
    this.circuitBreaker.reset();
  }

  /**
   * Create service authentication token
   */
  private createServiceToken(): string {
    // Simple JWT-like token for service auth
    // In production, use proper JWT signing
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({
      iss: this.config.serviceName,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 300, // 5 minutes
    })).toString('base64url');

    // In production, properly sign with HMAC
    const signature = 'signature';

    return `${header}.${payload}.${signature}`;
  }
}
