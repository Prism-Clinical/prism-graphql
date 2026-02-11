/**
 * Distributed Tracing
 *
 * OpenTelemetry configuration for distributed tracing.
 */

import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { Resource } from '@opentelemetry/resources';
import { SemanticResourceAttributes } from '@opentelemetry/semantic-conventions';
import {
  trace,
  context,
  SpanKind,
  SpanStatusCode,
  Span,
  Tracer,
} from '@opentelemetry/api';
import { W3CTraceContextPropagator } from '@opentelemetry/core';

/**
 * Tracing configuration
 */
export interface TracingConfig {
  /** Service name */
  serviceName: string;
  /** Service version */
  serviceVersion: string;
  /** OTLP endpoint */
  otlpEndpoint?: string;
  /** Whether to enable tracing */
  enabled: boolean;
  /** Sample rate (0-1) */
  sampleRate?: number;
}

/**
 * Default configuration
 */
const DEFAULT_CONFIG: TracingConfig = {
  serviceName: 'careplan-service',
  serviceVersion: '1.0.0',
  enabled: false,
  sampleRate: 1.0,
};

/**
 * SDK instance
 */
let sdk: NodeSDK | null = null;

/**
 * Initialize tracing
 */
export function initializeTracing(config: Partial<TracingConfig> = {}): void {
  const fullConfig = { ...DEFAULT_CONFIG, ...config };

  if (!fullConfig.enabled) {
    console.log('Tracing disabled');
    return;
  }

  const exporter = fullConfig.otlpEndpoint
    ? new OTLPTraceExporter({ url: fullConfig.otlpEndpoint })
    : undefined;

  sdk = new NodeSDK({
    resource: new Resource({
      [SemanticResourceAttributes.SERVICE_NAME]: fullConfig.serviceName,
      [SemanticResourceAttributes.SERVICE_VERSION]: fullConfig.serviceVersion,
    }),
    traceExporter: exporter,
    instrumentations: [
      getNodeAutoInstrumentations({
        '@opentelemetry/instrumentation-http': {
          ignoreIncomingPaths: ['/health', '/metrics', '/ready'],
        },
        '@opentelemetry/instrumentation-fs': {
          enabled: false,
        },
      }),
    ],
    textMapPropagator: new W3CTraceContextPropagator(),
  });

  sdk.start();
  console.log(`Tracing initialized for ${fullConfig.serviceName}`);
}

/**
 * Shutdown tracing
 */
export async function shutdownTracing(): Promise<void> {
  if (sdk) {
    await sdk.shutdown();
    sdk = null;
  }
}

/**
 * Get tracer instance
 */
export function getTracer(name: string = 'careplan-service'): Tracer {
  return trace.getTracer(name);
}

/**
 * Create a span for an operation
 */
export function createSpan(
  name: string,
  options?: {
    kind?: SpanKind;
    attributes?: Record<string, string | number | boolean>;
  }
): Span {
  const tracer = getTracer();
  return tracer.startSpan(name, {
    kind: options?.kind ?? SpanKind.INTERNAL,
    attributes: options?.attributes,
  });
}

/**
 * Execute with span
 */
export async function withSpan<T>(
  name: string,
  fn: (span: Span) => Promise<T>,
  options?: {
    kind?: SpanKind;
    attributes?: Record<string, string | number | boolean>;
  }
): Promise<T> {
  const span = createSpan(name, options);

  try {
    const result = await context.with(trace.setSpan(context.active(), span), () =>
      fn(span)
    );
    span.setStatus({ code: SpanStatusCode.OK });
    return result;
  } catch (error) {
    const err = error as Error;
    span.setStatus({
      code: SpanStatusCode.ERROR,
      message: err.message,
    });
    span.recordException(err);
    throw error;
  } finally {
    span.end();
  }
}

/**
 * Get current trace ID
 */
export function getCurrentTraceId(): string | undefined {
  const span = trace.getActiveSpan();
  return span?.spanContext().traceId;
}

/**
 * Get current span ID
 */
export function getCurrentSpanId(): string | undefined {
  const span = trace.getActiveSpan();
  return span?.spanContext().spanId;
}

/**
 * Add correlation ID to current span
 */
export function addCorrelationId(correlationId: string): void {
  const span = trace.getActiveSpan();
  if (span) {
    span.setAttribute('correlation.id', correlationId);
  }
}

/**
 * Create trace context headers for propagation
 */
export function getTraceContextHeaders(): Record<string, string> {
  const headers: Record<string, string> = {};
  const span = trace.getActiveSpan();

  if (span) {
    const spanContext = span.spanContext();
    headers['traceparent'] = `00-${spanContext.traceId}-${spanContext.spanId}-01`;
  }

  return headers;
}

/**
 * ML service span attributes
 * Note: PHI should NOT be included
 */
export interface MLServiceSpanAttributes {
  /** Service name */
  'ml.service': string;
  /** Endpoint called */
  'ml.endpoint': string;
  /** Request ID */
  'ml.request_id'?: string;
  /** Response time in ms */
  'ml.response_time_ms'?: number;
  /** Whether cache was hit */
  'ml.cache_hit'?: boolean;
  /** Model version */
  'ml.model_version'?: string;
  /** Status */
  'ml.status'?: string;
}

/**
 * Create span for ML service call
 */
export async function withMLServiceSpan<T>(
  service: string,
  endpoint: string,
  fn: (span: Span) => Promise<T>,
  additionalAttributes?: Partial<MLServiceSpanAttributes>
): Promise<T> {
  return withSpan(
    `ml.${service}.${endpoint}`,
    async (span) => {
      span.setAttribute('ml.service', service);
      span.setAttribute('ml.endpoint', endpoint);

      if (additionalAttributes) {
        for (const [key, value] of Object.entries(additionalAttributes)) {
          if (value !== undefined) {
            span.setAttribute(key, value);
          }
        }
      }

      const startTime = Date.now();
      try {
        const result = await fn(span);
        span.setAttribute('ml.response_time_ms', Date.now() - startTime);
        span.setAttribute('ml.status', 'success');
        return result;
      } catch (error) {
        span.setAttribute('ml.response_time_ms', Date.now() - startTime);
        span.setAttribute('ml.status', 'error');
        throw error;
      }
    },
    { kind: SpanKind.CLIENT }
  );
}

/**
 * Pipeline span attributes
 * Note: PHI should NOT be included
 */
export interface PipelineSpanAttributes {
  /** Request ID */
  'pipeline.request_id': string;
  /** Correlation ID */
  'pipeline.correlation_id': string;
  /** Current stage */
  'pipeline.stage'?: string;
  /** Number of stages completed */
  'pipeline.stages_completed'?: number;
  /** Whether any cache was hit */
  'pipeline.cache_hit'?: boolean;
  /** Degraded services */
  'pipeline.degraded_services'?: string;
}

/**
 * Create span for pipeline processing
 */
export async function withPipelineSpan<T>(
  requestId: string,
  correlationId: string,
  fn: (span: Span) => Promise<T>
): Promise<T> {
  return withSpan(
    'pipeline.process',
    async (span) => {
      span.setAttribute('pipeline.request_id', requestId);
      span.setAttribute('pipeline.correlation_id', correlationId);
      return fn(span);
    },
    { kind: SpanKind.INTERNAL }
  );
}

/**
 * Create span for pipeline stage
 */
export async function withStageSpan<T>(
  stage: string,
  fn: (span: Span) => Promise<T>
): Promise<T> {
  return withSpan(
    `pipeline.stage.${stage.toLowerCase()}`,
    async (span) => {
      span.setAttribute('pipeline.stage', stage);
      return fn(span);
    },
    { kind: SpanKind.INTERNAL }
  );
}
