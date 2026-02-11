/**
 * ML Client Configuration
 *
 * Centralized configuration for all ML service clients.
 */

import { Redis } from 'ioredis';
import {
  RetryConfig,
  CircuitBreakerConfig,
  DEFAULT_RETRY_CONFIG,
  DEFAULT_CIRCUIT_BREAKER_CONFIG,
  DEFAULT_TIMEOUT,
} from '../common';

/**
 * ML Client URLs configuration
 */
export interface MLServiceUrls {
  /** Audio Intelligence service URL */
  audioIntelligence: string;
  /** Care Plan Recommender service URL */
  carePlanRecommender: string;
  /** RAG Embeddings service URL */
  ragEmbeddings: string;
  /** PDF Parser service URL */
  pdfParser: string;
}

/**
 * ML Client configuration
 */
export interface MLClientConfig {
  /** Service URLs */
  urls: MLServiceUrls;
  /** Request timeout in ms */
  timeout: number;
  /** Retry configuration */
  retry: RetryConfig;
  /** Circuit breaker configuration */
  circuitBreaker: CircuitBreakerConfig;
  /** Redis client for caching */
  redis?: Redis;
  /** Service authentication secret */
  serviceAuthSecret?: string;
  /** Whether to enable fallback responses */
  enableFallbacks: boolean;
  /** ICD-10 code allowlist */
  allowedICD10Codes?: Set<string>;
}

/**
 * Default ML service URLs (from environment or defaults)
 */
export function getDefaultUrls(): MLServiceUrls {
  return {
    audioIntelligence: process.env.AUDIO_INTELLIGENCE_URL || 'http://localhost:8101',
    carePlanRecommender: process.env.CAREPLAN_RECOMMENDER_URL || 'http://localhost:8100',
    ragEmbeddings: process.env.RAG_EMBEDDINGS_URL || 'http://localhost:8103',
    pdfParser: process.env.PDF_PARSER_URL || 'http://localhost:8102',
  };
}

/**
 * Get default ML client configuration
 */
export function getDefaultMLConfig(): MLClientConfig {
  return {
    urls: getDefaultUrls(),
    timeout: DEFAULT_TIMEOUT,
    retry: DEFAULT_RETRY_CONFIG,
    circuitBreaker: DEFAULT_CIRCUIT_BREAKER_CONFIG,
    enableFallbacks: true,
  };
}

/**
 * Create ML client configuration from environment
 */
export function createMLConfigFromEnv(): MLClientConfig {
  const config = getDefaultMLConfig();

  // Override from environment
  if (process.env.ML_SERVICE_TIMEOUT) {
    config.timeout = parseInt(process.env.ML_SERVICE_TIMEOUT, 10);
  }

  if (process.env.ML_SERVICE_MAX_RETRIES) {
    config.retry.maxRetries = parseInt(process.env.ML_SERVICE_MAX_RETRIES, 10);
  }

  if (process.env.ML_CIRCUIT_FAILURE_THRESHOLD) {
    config.circuitBreaker.failureThreshold = parseInt(
      process.env.ML_CIRCUIT_FAILURE_THRESHOLD,
      10
    );
  }

  if (process.env.ML_SERVICE_AUTH_SECRET) {
    config.serviceAuthSecret = process.env.ML_SERVICE_AUTH_SECRET;
  }

  if (process.env.ML_ENABLE_FALLBACKS === 'false') {
    config.enableFallbacks = false;
  }

  return config;
}

/**
 * Environment variable names for ML configuration
 */
export const ML_CONFIG_ENV_VARS = {
  AUDIO_INTELLIGENCE_URL: 'AUDIO_INTELLIGENCE_URL',
  CAREPLAN_RECOMMENDER_URL: 'CAREPLAN_RECOMMENDER_URL',
  RAG_EMBEDDINGS_URL: 'RAG_EMBEDDINGS_URL',
  PDF_PARSER_URL: 'PDF_PARSER_URL',
  ML_SERVICE_TIMEOUT: 'ML_SERVICE_TIMEOUT',
  ML_SERVICE_MAX_RETRIES: 'ML_SERVICE_MAX_RETRIES',
  ML_CIRCUIT_FAILURE_THRESHOLD: 'ML_CIRCUIT_FAILURE_THRESHOLD',
  ML_CIRCUIT_RESET_TIMEOUT: 'ML_CIRCUIT_RESET_TIMEOUT',
  ML_SERVICE_AUTH_SECRET: 'ML_SERVICE_AUTH_SECRET',
  ML_ENABLE_FALLBACKS: 'ML_ENABLE_FALLBACKS',
};
