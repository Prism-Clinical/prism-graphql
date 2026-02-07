export * from './services';

/**
 * Environment configuration for CDS Hooks Service
 */
export interface ServiceConfig {
  port: number;
  allowedOrigins: string[];
  mlServiceUrl: string;
  fhirServerUrl: string;
}

export function getConfig(): ServiceConfig {
  return {
    port: parseInt(process.env.PORT ?? '4010', 10),
    allowedOrigins: (process.env.ALLOWED_ORIGINS ?? '*').split(','),
    mlServiceUrl: process.env.ML_SERVICE_URL ?? 'http://localhost:4011',
    fhirServerUrl: process.env.FHIR_SERVER_URL ?? 'http://localhost:8080',
  };
}
