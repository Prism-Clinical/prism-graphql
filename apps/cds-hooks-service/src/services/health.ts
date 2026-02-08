import { getConfig } from '../config';
import { logger } from '../utils/logger';

/**
 * Health check response
 */
export interface HealthCheckResponse {
  status: 'healthy' | 'unhealthy';
  service: string;
  timestamp: string;
  version?: string;
  checks?: Record<string, ComponentHealth>;
}

/**
 * Readiness check response
 */
export interface ReadinessCheckResponse {
  status: 'ready' | 'not_ready';
  service: string;
  timestamp: string;
  checks?: Record<string, ComponentHealth>;
}

/**
 * Individual component health status
 */
export interface ComponentHealth {
  status: 'healthy' | 'unhealthy' | 'degraded';
  message?: string;
  latencyMs?: number;
}

/**
 * Check basic health status
 *
 * This is a liveness check - returns healthy if the service is running.
 */
export async function checkHealth(): Promise<HealthCheckResponse> {
  return {
    status: 'healthy',
    service: 'cds-hooks-service',
    timestamp: new Date().toISOString(),
    version: process.env.npm_package_version,
  };
}

/**
 * Check if FHIR server is reachable
 */
async function checkFHIRServer(): Promise<ComponentHealth> {
  const config = getConfig();
  const startTime = Date.now();

  try {
    // Simple HEAD request to check connectivity
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    const response = await fetch(`${config.fhirServerUrl}/metadata`, {
      method: 'GET',
      headers: { Accept: 'application/fhir+json' },
      signal: controller.signal,
    });

    clearTimeout(timeoutId);
    const latencyMs = Date.now() - startTime;

    if (response.ok) {
      return {
        status: 'healthy',
        message: 'FHIR server is reachable',
        latencyMs,
      };
    }

    return {
      status: 'degraded',
      message: `FHIR server returned ${response.status}`,
      latencyMs,
    };
  } catch (error) {
    const latencyMs = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    logger.warn({ error: errorMessage, url: config.fhirServerUrl }, 'FHIR server health check failed');

    return {
      status: 'unhealthy',
      message: `FHIR server unreachable: ${errorMessage}`,
      latencyMs,
    };
  }
}

/**
 * Check if ML service is reachable
 */
async function checkMLService(): Promise<ComponentHealth> {
  const config = getConfig();
  const startTime = Date.now();

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    const response = await fetch(`${config.mlServiceUrl}/health`, {
      method: 'GET',
      signal: controller.signal,
    });

    clearTimeout(timeoutId);
    const latencyMs = Date.now() - startTime;

    if (response.ok) {
      return {
        status: 'healthy',
        message: 'ML service is reachable',
        latencyMs,
      };
    }

    return {
      status: 'degraded',
      message: `ML service returned ${response.status}`,
      latencyMs,
    };
  } catch (error) {
    const latencyMs = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    // ML service being unavailable is not critical - log as debug
    logger.debug({ error: errorMessage, url: config.mlServiceUrl }, 'ML service health check failed');

    return {
      status: 'degraded',
      message: `ML service unreachable: ${errorMessage}`,
      latencyMs,
    };
  }
}

/**
 * Check if Redis cache is connected (if configured)
 */
async function checkRedis(): Promise<ComponentHealth | null> {
  const config = getConfig();

  // Skip if Redis is not configured
  if (!config.redisUrl) {
    return null;
  }

  // Redis check would go here when cache is implemented
  // For now, return null to indicate not configured
  return null;
}

/**
 * Comprehensive readiness check
 *
 * Checks all dependent services and returns ready only if
 * critical dependencies are available.
 */
export async function checkReadiness(): Promise<ReadinessCheckResponse> {
  const checks: Record<string, ComponentHealth> = {};

  // Run health checks in parallel
  const [fhirHealth, mlHealth, redisHealth] = await Promise.all([
    checkFHIRServer(),
    checkMLService(),
    checkRedis(),
  ]);

  checks.fhirServer = fhirHealth;
  checks.mlService = mlHealth;

  if (redisHealth) {
    checks.redis = redisHealth;
  }

  // Determine overall readiness
  // FHIR server being unhealthy makes us not ready
  // ML service being unhealthy is degraded but still ready
  const isReady = fhirHealth.status !== 'unhealthy';

  return {
    status: isReady ? 'ready' : 'not_ready',
    service: 'cds-hooks-service',
    timestamp: new Date().toISOString(),
    checks,
  };
}
