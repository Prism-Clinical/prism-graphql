/**
 * Monitoring Module
 *
 * Exports for monitoring and observability.
 */

// Metrics
export {
  metricsRegistry,
  pipelineRequestsTotal,
  pipelineStageCompletionsTotal,
  mlServiceCallsTotal,
  phiAccessTotal,
  authFailuresTotal,
  pipelineDurationSeconds,
  mlServiceLatencySeconds,
  pipelineQueueDepth,
  pipelineActiveJobs,
  circuitBreakerState,
  cacheHitRate,
  dlqDepth,
  MetricsCollector,
  metricsCollector,
  getMetrics,
  getMetricsContentType,
} from './metrics';

// Tracing
export {
  TracingConfig,
  initializeTracing,
  shutdownTracing,
  getTracer,
  createSpan,
  withSpan,
  getCurrentTraceId,
  getCurrentSpanId,
  addCorrelationId,
  getTraceContextHeaders,
  MLServiceSpanAttributes,
  withMLServiceSpan,
  PipelineSpanAttributes,
  withPipelineSpan,
  withStageSpan,
} from './tracing';

// Security Events
export {
  SecurityEventType,
  SecurityEventSeverity,
  SecurityEvent,
  AlertCallback,
  SecurityLoggerConfig,
  SecurityEventLogger,
  SecurityEventSummary,
  securityEventLogger,
} from './security-events';
