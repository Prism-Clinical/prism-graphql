/**
 * Pipeline Metrics
 *
 * Prometheus metrics for pipeline monitoring.
 */

import { Registry, Counter, Histogram, Gauge } from 'prom-client';
import { PipelineStage } from '../orchestration';

/**
 * Metrics registry
 */
export const metricsRegistry = new Registry();

// Add default metrics
metricsRegistry.setDefaultLabels({
  service: 'careplan-service',
});

/**
 * Pipeline request counter
 */
export const pipelineRequestsTotal = new Counter({
  name: 'pipeline_requests_total',
  help: 'Total number of pipeline requests',
  labelNames: ['status', 'source'] as const,
  registers: [metricsRegistry],
});

/**
 * Pipeline stage completions counter
 */
export const pipelineStageCompletionsTotal = new Counter({
  name: 'pipeline_stage_completions_total',
  help: 'Total number of pipeline stage completions',
  labelNames: ['stage', 'status'] as const,
  registers: [metricsRegistry],
});

/**
 * ML service calls counter
 */
export const mlServiceCallsTotal = new Counter({
  name: 'ml_service_calls_total',
  help: 'Total number of ML service calls',
  labelNames: ['service', 'endpoint', 'status'] as const,
  registers: [metricsRegistry],
});

/**
 * PHI access counter
 */
export const phiAccessTotal = new Counter({
  name: 'phi_access_total',
  help: 'Total number of PHI access events',
  labelNames: ['resource_type', 'action'] as const,
  registers: [metricsRegistry],
});

/**
 * Auth failures counter
 */
export const authFailuresTotal = new Counter({
  name: 'auth_failures_total',
  help: 'Total number of authentication/authorization failures',
  labelNames: ['reason'] as const,
  registers: [metricsRegistry],
});

/**
 * Pipeline duration histogram
 */
export const pipelineDurationSeconds = new Histogram({
  name: 'pipeline_duration_seconds',
  help: 'Pipeline processing duration in seconds',
  labelNames: ['stage'] as const,
  buckets: [0.1, 0.5, 1, 2, 5, 10, 30, 60, 120],
  registers: [metricsRegistry],
});

/**
 * ML service latency histogram
 */
export const mlServiceLatencySeconds = new Histogram({
  name: 'ml_service_latency_seconds',
  help: 'ML service call latency in seconds',
  labelNames: ['service', 'endpoint'] as const,
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [metricsRegistry],
});

/**
 * Pipeline queue depth gauge
 */
export const pipelineQueueDepth = new Gauge({
  name: 'pipeline_queue_depth',
  help: 'Current pipeline queue depth',
  labelNames: ['queue'] as const,
  registers: [metricsRegistry],
});

/**
 * Pipeline active jobs gauge
 */
export const pipelineActiveJobs = new Gauge({
  name: 'pipeline_active_jobs',
  help: 'Currently active pipeline jobs',
  registers: [metricsRegistry],
});

/**
 * Circuit breaker state gauge
 * 0 = closed, 1 = open, 2 = half-open
 */
export const circuitBreakerState = new Gauge({
  name: 'circuit_breaker_state',
  help: 'Circuit breaker state (0=closed, 1=open, 2=half-open)',
  labelNames: ['service'] as const,
  registers: [metricsRegistry],
});

/**
 * Cache hit rate gauge
 */
export const cacheHitRate = new Gauge({
  name: 'cache_hit_rate',
  help: 'Cache hit rate (0-1)',
  labelNames: ['cache_type'] as const,
  registers: [metricsRegistry],
});

/**
 * DLQ depth gauge
 */
export const dlqDepth = new Gauge({
  name: 'dlq_depth',
  help: 'Dead letter queue depth',
  registers: [metricsRegistry],
});

/**
 * Metrics collector implementation
 */
export class MetricsCollector {
  /**
   * Record pipeline stage latency
   */
  recordStageLatency(stage: PipelineStage, durationMs: number): void {
    pipelineDurationSeconds.observe({ stage }, durationMs / 1000);
  }

  /**
   * Record pipeline request
   */
  recordPipelineRequest(status: 'success' | 'failure' | 'degraded', source: string = 'graphql'): void {
    pipelineRequestsTotal.inc({ status, source });
  }

  /**
   * Record stage completion
   */
  recordStageCompletion(stage: PipelineStage, status: 'completed' | 'failed' | 'skipped'): void {
    pipelineStageCompletionsTotal.inc({ stage, status });
  }

  /**
   * Record ML service call
   */
  recordMLServiceCall(service: string, endpoint: string, status: string, durationMs: number): void {
    mlServiceCallsTotal.inc({ service, endpoint, status });
    mlServiceLatencySeconds.observe({ service, endpoint }, durationMs / 1000);
  }

  /**
   * Record PHI access
   */
  recordPhiAccess(resourceType: string, action: string): void {
    phiAccessTotal.inc({ resource_type: resourceType, action });
  }

  /**
   * Record auth failure
   */
  recordAuthFailure(reason: string): void {
    authFailuresTotal.inc({ reason });
  }

  /**
   * Record cache hit
   */
  recordCacheHit(cacheType: string, hit: boolean): void {
    // Track as a running ratio
    // In production, use a sliding window
  }

  /**
   * Update queue depth
   */
  updateQueueDepth(queue: string, depth: number): void {
    pipelineQueueDepth.set({ queue }, depth);
  }

  /**
   * Update active jobs
   */
  updateActiveJobs(count: number): void {
    pipelineActiveJobs.set(count);
  }

  /**
   * Update circuit breaker state
   */
  updateCircuitState(service: string, state: 'CLOSED' | 'OPEN' | 'HALF_OPEN'): void {
    const stateValue = state === 'CLOSED' ? 0 : state === 'OPEN' ? 1 : 2;
    circuitBreakerState.set({ service }, stateValue);
  }

  /**
   * Update DLQ depth
   */
  updateDlqDepth(depth: number): void {
    dlqDepth.set(depth);
  }
}

/**
 * Get metrics for Prometheus endpoint
 */
export async function getMetrics(): Promise<string> {
  return await metricsRegistry.metrics();
}

/**
 * Get metrics content type
 */
export function getMetricsContentType(): string {
  return metricsRegistry.contentType;
}

// Export singleton instance
export const metricsCollector = new MetricsCollector();
