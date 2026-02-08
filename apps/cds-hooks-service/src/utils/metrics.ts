/**
 * Basic metrics collection for CDS Hooks Service
 *
 * Provides simple in-memory metrics that can be exposed via /metrics endpoint.
 * For production, consider integrating with Prometheus, StatsD, or similar.
 */

/**
 * Metrics data structure
 */
interface MetricsData {
  requestCounts: Record<string, number>;
  responseTimes: ResponseTimeStats[];
  cardCounts: Record<string, number>;
  errorCounts: Record<string, number>;
  startTime: Date;
}

/**
 * Response time statistics
 */
interface ResponseTimeStats {
  hookType: string;
  timestamp: Date;
  durationMs: number;
}

/**
 * Exported metrics format
 */
export interface ServiceMetrics {
  uptime: number;
  requests: {
    total: number;
    byHook: Record<string, number>;
  };
  responseTimes: {
    average: number;
    p50: number;
    p95: number;
    p99: number;
    byHook: Record<string, { average: number; count: number }>;
  };
  cards: {
    total: number;
    byIndicator: Record<string, number>;
  };
  errors: {
    total: number;
    byType: Record<string, number>;
  };
}

// In-memory metrics storage
const metrics: MetricsData = {
  requestCounts: {},
  responseTimes: [],
  cardCounts: {
    critical: 0,
    warning: 0,
    info: 0,
  },
  errorCounts: {},
  startTime: new Date(),
};

// Maximum response times to keep (rolling window)
const MAX_RESPONSE_TIMES = 1000;

/**
 * Record a request for a specific hook type
 */
export function recordRequest(hookType: string): void {
  metrics.requestCounts[hookType] = (metrics.requestCounts[hookType] ?? 0) + 1;
}

/**
 * Record response time for a hook
 */
export function recordResponseTime(hookType: string, durationMs: number): void {
  metrics.responseTimes.push({
    hookType,
    timestamp: new Date(),
    durationMs,
  });

  // Keep only the most recent entries
  if (metrics.responseTimes.length > MAX_RESPONSE_TIMES) {
    metrics.responseTimes = metrics.responseTimes.slice(-MAX_RESPONSE_TIMES);
  }
}

/**
 * Record card generation counts
 */
export function recordCards(counts: { critical: number; warning: number; info: number }): void {
  metrics.cardCounts.critical = (metrics.cardCounts.critical ?? 0) + counts.critical;
  metrics.cardCounts.warning = (metrics.cardCounts.warning ?? 0) + counts.warning;
  metrics.cardCounts.info = (metrics.cardCounts.info ?? 0) + counts.info;
}

/**
 * Record an error occurrence
 */
export function recordError(errorType: string): void {
  metrics.errorCounts[errorType] = (metrics.errorCounts[errorType] ?? 0) + 1;
}

/**
 * Calculate percentile from sorted array
 */
function percentile(sortedValues: number[], p: number): number {
  if (sortedValues.length === 0) return 0;

  const index = Math.ceil((p / 100) * sortedValues.length) - 1;
  const value = sortedValues[Math.max(0, index)];
  return value !== undefined ? value : 0;
}

/**
 * Get current metrics
 */
export function getMetrics(): ServiceMetrics {
  const now = new Date();
  const uptimeMs = now.getTime() - metrics.startTime.getTime();

  // Calculate total requests
  const totalRequests = Object.values(metrics.requestCounts).reduce((sum, count) => sum + count, 0);

  // Calculate response time statistics
  const responseTimes = metrics.responseTimes.map((rt) => rt.durationMs).sort((a, b) => a - b);
  const avgResponseTime =
    responseTimes.length > 0
      ? responseTimes.reduce((sum, t) => sum + t, 0) / responseTimes.length
      : 0;

  // Calculate per-hook response time stats
  const byHook: Record<string, { average: number; count: number }> = {};
  const hookGroups: Record<string, number[]> = {};

  for (const rt of metrics.responseTimes) {
    if (!hookGroups[rt.hookType]) {
      hookGroups[rt.hookType] = [];
    }
    const group = hookGroups[rt.hookType];
    if (group) {
      group.push(rt.durationMs);
    }
  }

  for (const [hook, times] of Object.entries(hookGroups)) {
    byHook[hook] = {
      average: times.reduce((sum, t) => sum + t, 0) / times.length,
      count: times.length,
    };
  }

  // Calculate total cards and errors
  const totalCards = Object.values(metrics.cardCounts).reduce((sum, count) => sum + count, 0);
  const totalErrors = Object.values(metrics.errorCounts).reduce((sum, count) => sum + count, 0);

  return {
    uptime: Math.floor(uptimeMs / 1000),
    requests: {
      total: totalRequests,
      byHook: { ...metrics.requestCounts },
    },
    responseTimes: {
      average: Math.round(avgResponseTime * 100) / 100,
      p50: percentile(responseTimes, 50),
      p95: percentile(responseTimes, 95),
      p99: percentile(responseTimes, 99),
      byHook,
    },
    cards: {
      total: totalCards,
      byIndicator: { ...metrics.cardCounts },
    },
    errors: {
      total: totalErrors,
      byType: { ...metrics.errorCounts },
    },
  };
}

/**
 * Reset metrics (useful for testing)
 */
export function resetMetrics(): void {
  metrics.requestCounts = {};
  metrics.responseTimes = [];
  metrics.cardCounts = { critical: 0, warning: 0, info: 0 };
  metrics.errorCounts = {};
  metrics.startTime = new Date();
}
