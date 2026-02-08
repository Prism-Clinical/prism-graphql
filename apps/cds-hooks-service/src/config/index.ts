export * from './services';

/**
 * Environment configuration for CDS Hooks Service
 */
export interface ServiceConfig {
  port: number;
  allowedOrigins: string[];
  mlServiceUrl: string;
  fhirServerUrl: string;
  redisUrl: string | undefined;
  nodeEnv: string;
}

/**
 * Validate CORS origins configuration
 *
 * In production, explicit origins must be configured.
 * Wildcard (*) is only allowed in development/test.
 */
function validateAllowedOrigins(origins: string[], nodeEnv: string): string[] {
  // In production, require explicit origins
  if (nodeEnv === 'production') {
    if (origins.length === 0 || (origins.length === 1 && origins[0] === '*')) {
      throw new Error(
        'ALLOWED_ORIGINS must be explicitly configured in production. ' +
          'Set ALLOWED_ORIGINS environment variable to a comma-separated list of allowed origins.'
      );
    }

    // Remove wildcard if present alongside other origins
    const filtered = origins.filter((o) => o !== '*');
    if (filtered.length === 0) {
      throw new Error(
        'ALLOWED_ORIGINS must contain at least one non-wildcard origin in production.'
      );
    }

    return filtered;
  }

  // In development/test, allow wildcard or specific origins
  return origins;
}

export function getConfig(): ServiceConfig {
  const nodeEnv = process.env.NODE_ENV ?? 'development';

  // Parse origins from environment
  const originsEnv = process.env.ALLOWED_ORIGINS;
  let allowedOrigins: string[];

  if (!originsEnv || originsEnv.trim() === '') {
    // No origins configured - use wildcard only in non-production
    if (nodeEnv === 'production') {
      throw new Error(
        'ALLOWED_ORIGINS environment variable is required in production.'
      );
    }
    allowedOrigins = ['*'];
  } else {
    allowedOrigins = originsEnv.split(',').map((o) => o.trim()).filter((o) => o.length > 0);
  }

  // Validate origins based on environment
  const validatedOrigins = validateAllowedOrigins(allowedOrigins, nodeEnv);

  return {
    port: parseInt(process.env.PORT ?? '4010', 10),
    allowedOrigins: validatedOrigins,
    mlServiceUrl: process.env.ML_SERVICE_URL ?? 'http://localhost:4011',
    fhirServerUrl: process.env.FHIR_SERVER_URL ?? 'http://localhost:8080',
    redisUrl: process.env.REDIS_URL,
    nodeEnv,
  };
}
