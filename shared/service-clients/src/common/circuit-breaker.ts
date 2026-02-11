/**
 * Circuit Breaker
 *
 * Implements the circuit breaker pattern for resilient service calls.
 * Prevents cascading failures by failing fast when a service is unhealthy.
 *
 * States:
 * - CLOSED: Normal operation, requests pass through
 * - OPEN: Service is unhealthy, requests fail immediately
 * - HALF_OPEN: Testing if service has recovered
 */

import { EventEmitter } from 'events';
import { CircuitState, CircuitBreakerConfig, DEFAULT_CIRCUIT_BREAKER_CONFIG } from './types';

// ============================================================================
// Types
// ============================================================================

/**
 * Circuit breaker event types
 */
export type CircuitBreakerEventType =
  | 'stateChange'
  | 'success'
  | 'failure'
  | 'rejected'
  | 'timeout';

/**
 * State change event payload
 */
export interface StateChangeEvent {
  circuitName: string;
  previousState: CircuitState;
  newState: CircuitState;
  timestamp: Date;
  failureCount: number;
}

/**
 * Execution event payload
 */
export interface ExecutionEvent {
  circuitName: string;
  state: CircuitState;
  durationMs: number;
  timestamp: Date;
  error?: Error;
  usedFallback?: boolean;
}

/**
 * Logger interface for dependency injection
 */
export interface CircuitBreakerLogger {
  debug(message: string, context?: Record<string, unknown>): void;
  info(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
  error(message: string, context?: Record<string, unknown>): void;
}

/**
 * Default no-op logger
 */
const noopLogger: CircuitBreakerLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

/**
 * Console-based logger for development
 */
export const consoleLogger: CircuitBreakerLogger = {
  debug: (msg, ctx) => console.debug(`[CircuitBreaker] ${msg}`, ctx ?? ''),
  info: (msg, ctx) => console.info(`[CircuitBreaker] ${msg}`, ctx ?? ''),
  warn: (msg, ctx) => console.warn(`[CircuitBreaker] ${msg}`, ctx ?? ''),
  error: (msg, ctx) => console.error(`[CircuitBreaker] ${msg}`, ctx ?? ''),
};

/**
 * Extended circuit breaker statistics
 */
export interface CircuitBreakerStats {
  state: CircuitState;
  failures: number;
  successes: number;
  totalRequests: number;
  successRate: number;
  lastFailure: Date | null;
  lastSuccess: Date | null;
  openedAt: Date | null;
  consecutiveSuccesses: number;
}

// ============================================================================
// Circuit Breaker Implementation
// ============================================================================

/**
 * Circuit breaker for a single service endpoint
 *
 * Emits events for monitoring:
 * - 'stateChange': When circuit state changes
 * - 'success': On successful execution
 * - 'failure': On failed execution
 * - 'rejected': When request is rejected due to open circuit
 */
export class CircuitBreaker extends EventEmitter {
  private state: CircuitState = CircuitState.CLOSED;
  private failures: number[] = [];
  private successes = 0;
  private totalRequests = 0;
  private consecutiveSuccesses = 0;
  private lastFailure: Date | null = null;
  private lastSuccess: Date | null = null;
  private halfOpenAttempts = 0;
  private halfOpenSuccesses = 0;
  private openedAt: Date | null = null;
  private readonly logger: CircuitBreakerLogger;

  constructor(
    private readonly name: string,
    private readonly config: CircuitBreakerConfig = DEFAULT_CIRCUIT_BREAKER_CONFIG,
    logger?: CircuitBreakerLogger
  ) {
    super();
    this.logger = logger ?? noopLogger;
    this.setMaxListeners(20); // Allow multiple listeners for monitoring
  }

  /**
   * Get circuit name
   */
  getName(): string {
    return this.name;
  }

  /**
   * Check if the circuit allows requests
   */
  canExecute(): boolean {
    this.updateState();
    return this.state !== CircuitState.OPEN;
  }

  /**
   * Record a successful call
   */
  recordSuccess(): void {
    const now = new Date();
    this.lastSuccess = now;
    this.successes++;
    this.totalRequests++;
    this.consecutiveSuccesses++;

    // Emit success event
    this.emit('success', {
      circuitName: this.name,
      state: this.state,
      timestamp: now,
    } as ExecutionEvent);

    if (this.state === CircuitState.HALF_OPEN) {
      this.halfOpenSuccesses++;
      // Require multiple successes to close the circuit (more conservative)
      const requiredSuccesses = Math.ceil(this.config.halfOpenRequests / 2);
      if (this.halfOpenSuccesses >= requiredSuccesses) {
        this.close();
      }
    }
  }

  /**
   * Record a failed call
   */
  recordFailure(error?: Error): void {
    const now = Date.now();
    this.lastFailure = new Date(now);
    this.totalRequests++;
    this.consecutiveSuccesses = 0;

    // Add failure timestamp
    this.failures.push(now);

    // Remove old failures outside the window (sliding window)
    const windowStart = now - this.config.failureWindow;
    this.failures = this.failures.filter((t) => t >= windowStart);

    // Emit failure event
    this.emit('failure', {
      circuitName: this.name,
      state: this.state,
      timestamp: new Date(now),
      error,
    } as ExecutionEvent);

    // In half-open state, immediately reopen on failure
    if (this.state === CircuitState.HALF_OPEN) {
      this.open('Failure during half-open probe');
      return;
    }

    // Check if we should open the circuit
    if (this.failures.length >= this.config.failureThreshold) {
      this.open(`Failure threshold reached (${this.failures.length}/${this.config.failureThreshold})`);
    }
  }

  /**
   * Get current circuit state
   */
  getState(): CircuitState {
    this.updateState();
    return this.state;
  }

  /**
   * Get circuit breaker statistics
   */
  getStats(): CircuitBreakerStats {
    this.updateState();
    return {
      state: this.state,
      failures: this.failures.length,
      successes: this.successes,
      totalRequests: this.totalRequests,
      successRate: this.totalRequests > 0 ? this.successes / this.totalRequests : 1,
      lastFailure: this.lastFailure,
      lastSuccess: this.lastSuccess,
      openedAt: this.openedAt,
      consecutiveSuccesses: this.consecutiveSuccesses,
    };
  }

  /**
   * Manually reset the circuit to closed state
   */
  reset(): void {
    const previousState = this.state;
    this.state = CircuitState.CLOSED;
    this.failures = [];
    this.halfOpenAttempts = 0;
    this.halfOpenSuccesses = 0;
    this.openedAt = null;
    this.consecutiveSuccesses = 0;

    if (previousState !== CircuitState.CLOSED) {
      this.logger.info('Circuit manually reset', { circuit: this.name, previousState });
      this.emitStateChange(previousState, CircuitState.CLOSED);
    }
  }

  /**
   * Execute a function with circuit breaker protection
   *
   * @param fn - Function to execute
   * @param fallback - Optional fallback function when circuit is open
   * @returns Result of fn or fallback
   * @throws CircuitBreakerError if circuit is open and no fallback
   */
  async execute<T>(fn: () => Promise<T>, fallback?: () => T | Promise<T>): Promise<T> {
    const startTime = Date.now();
    this.updateState();

    if (this.state === CircuitState.OPEN) {
      this.emit('rejected', {
        circuitName: this.name,
        state: this.state,
        timestamp: new Date(),
      } as ExecutionEvent);

      if (fallback) {
        this.logger.debug('Circuit open, using fallback', { circuit: this.name });
        const result = await Promise.resolve(fallback());
        this.emit('success', {
          circuitName: this.name,
          state: this.state,
          durationMs: Date.now() - startTime,
          timestamp: new Date(),
          usedFallback: true,
        } as ExecutionEvent);
        return result;
      }
      throw new CircuitBreakerError(
        `Circuit breaker for ${this.name} is open`,
        this.name,
        CircuitState.OPEN
      );
    }

    if (this.state === CircuitState.HALF_OPEN) {
      this.halfOpenAttempts++;
      if (this.halfOpenAttempts > this.config.halfOpenRequests) {
        this.logger.debug('Half-open max attempts reached, using fallback', {
          circuit: this.name,
          attempts: this.halfOpenAttempts,
        });

        if (fallback) {
          const result = await Promise.resolve(fallback());
          this.emit('success', {
            circuitName: this.name,
            state: this.state,
            durationMs: Date.now() - startTime,
            timestamp: new Date(),
            usedFallback: true,
          } as ExecutionEvent);
          return result;
        }
        throw new CircuitBreakerError(
          `Circuit breaker for ${this.name} is half-open, max probe attempts reached`,
          this.name,
          CircuitState.HALF_OPEN
        );
      }
    }

    try {
      const result = await fn();
      const durationMs = Date.now() - startTime;
      this.recordSuccess();

      this.emit('success', {
        circuitName: this.name,
        state: this.state,
        durationMs,
        timestamp: new Date(),
      } as ExecutionEvent);

      return result;
    } catch (error) {
      this.recordFailure(error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
  }

  /**
   * Open the circuit
   */
  private open(reason?: string): void {
    const previousState = this.state;
    if (previousState === CircuitState.OPEN) {
      return; // Already open
    }

    this.state = CircuitState.OPEN;
    this.openedAt = new Date();
    this.halfOpenAttempts = 0;
    this.halfOpenSuccesses = 0;

    this.logger.warn('Circuit opened', {
      circuit: this.name,
      reason,
      failures: this.failures.length,
    });

    this.emitStateChange(previousState, CircuitState.OPEN);
  }

  /**
   * Close the circuit (return to normal operation)
   */
  private close(): void {
    const previousState = this.state;
    if (previousState === CircuitState.CLOSED) {
      return; // Already closed
    }

    this.state = CircuitState.CLOSED;
    this.failures = [];
    this.halfOpenAttempts = 0;
    this.halfOpenSuccesses = 0;
    this.openedAt = null;

    this.logger.info('Circuit closed', { circuit: this.name });
    this.emitStateChange(previousState, CircuitState.CLOSED);
  }

  /**
   * Transition to half-open state
   */
  private transitionToHalfOpen(): void {
    const previousState = this.state;
    this.state = CircuitState.HALF_OPEN;
    this.halfOpenAttempts = 0;
    this.halfOpenSuccesses = 0;

    this.logger.info('Circuit half-open, probing', { circuit: this.name });
    this.emitStateChange(previousState, CircuitState.HALF_OPEN);
  }

  /**
   * Update state based on time
   */
  private updateState(): void {
    if (this.state === CircuitState.OPEN && this.openedAt) {
      const elapsed = Date.now() - this.openedAt.getTime();
      if (elapsed >= this.config.resetTimeout) {
        this.transitionToHalfOpen();
      }
    }
  }

  /**
   * Emit state change event
   */
  private emitStateChange(previousState: CircuitState, newState: CircuitState): void {
    const event: StateChangeEvent = {
      circuitName: this.name,
      previousState,
      newState,
      timestamp: new Date(),
      failureCount: this.failures.length,
    };
    this.emit('stateChange', event);
  }
}

// ============================================================================
// Circuit Breaker Error
// ============================================================================

/**
 * Error thrown when circuit breaker prevents execution
 */
export class CircuitBreakerError extends Error {
  constructor(
    message: string,
    public readonly circuitName: string,
    public readonly circuitState: CircuitState = CircuitState.OPEN
  ) {
    super(message);
    this.name = 'CircuitBreakerError';
    // Maintains proper stack trace for where error was thrown (V8 only)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, CircuitBreakerError);
    }
  }

  /**
   * Check if this error is retryable
   */
  isRetryable(): boolean {
    return this.circuitState === CircuitState.HALF_OPEN;
  }
}

// ============================================================================
// Circuit Breaker Registry
// ============================================================================

/**
 * Options for creating circuits through the registry
 */
export interface RegistryOptions {
  /** Default config for new circuits */
  defaultConfig?: CircuitBreakerConfig;
  /** Logger for all circuits */
  logger?: CircuitBreakerLogger;
  /** Callback when circuit state changes */
  onStateChange?: (event: StateChangeEvent) => void;
}

/**
 * Circuit breaker registry for managing multiple circuits
 *
 * Provides centralized management and monitoring of circuit breakers.
 */
export class CircuitBreakerRegistry {
  private circuits = new Map<string, CircuitBreaker>();
  private readonly options: RegistryOptions;

  constructor(options: RegistryOptions = {}) {
    this.options = options;
  }

  /**
   * Get or create a circuit breaker
   */
  get(name: string, config?: CircuitBreakerConfig): CircuitBreaker {
    let circuit = this.circuits.get(name);
    if (!circuit) {
      const finalConfig = config ?? this.options.defaultConfig ?? DEFAULT_CIRCUIT_BREAKER_CONFIG;
      circuit = new CircuitBreaker(name, finalConfig, this.options.logger);

      // Subscribe to state changes if callback configured
      if (this.options.onStateChange) {
        circuit.on('stateChange', this.options.onStateChange);
      }

      this.circuits.set(name, circuit);
    }
    return circuit;
  }

  /**
   * Check if a circuit exists
   */
  has(name: string): boolean {
    return this.circuits.has(name);
  }

  /**
   * Remove a circuit from the registry
   */
  remove(name: string): boolean {
    const circuit = this.circuits.get(name);
    if (circuit) {
      circuit.removeAllListeners();
      return this.circuits.delete(name);
    }
    return false;
  }

  /**
   * Get all circuit breakers
   */
  getAll(): Map<string, CircuitBreaker> {
    return new Map(this.circuits);
  }

  /**
   * Get statistics for all circuits
   */
  getAllStats(): Record<string, CircuitBreakerStats> {
    const stats: Record<string, CircuitBreakerStats> = {};
    for (const [name, circuit] of this.circuits) {
      stats[name] = circuit.getStats();
    }
    return stats;
  }

  /**
   * Get circuits by state
   */
  getByState(state: CircuitState): CircuitBreaker[] {
    return Array.from(this.circuits.values()).filter(
      circuit => circuit.getState() === state
    );
  }

  /**
   * Check if any circuits are open
   */
  hasOpenCircuits(): boolean {
    for (const circuit of this.circuits.values()) {
      if (circuit.getState() === CircuitState.OPEN) {
        return true;
      }
    }
    return false;
  }

  /**
   * Reset all circuits
   */
  resetAll(): void {
    for (const circuit of this.circuits.values()) {
      circuit.reset();
    }
  }

  /**
   * Clear all circuits from registry
   */
  clear(): void {
    for (const circuit of this.circuits.values()) {
      circuit.removeAllListeners();
    }
    this.circuits.clear();
  }

  /**
   * Get count of circuits
   */
  size(): number {
    return this.circuits.size;
  }
}

/**
 * Global circuit breaker registry (use sparingly, prefer DI)
 */
export const circuitBreakerRegistry = new CircuitBreakerRegistry();
