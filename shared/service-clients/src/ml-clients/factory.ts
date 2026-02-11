/**
 * ML Client Factory
 *
 * Factory for creating and managing ML service clients.
 */

import { Redis } from 'ioredis';
import { HealthStatus, CircuitState } from '../common';
import { AudioIntelligenceClient, createAudioIntelligenceClient } from '../audio-intelligence';
import {
  CarePlanRecommenderClient,
  createCarePlanRecommenderClient,
} from '../careplan-recommender';
import { RagEmbeddingsClient, createRagEmbeddingsClient } from '../rag-embeddings';
import { PdfParserClient, createPdfParserClient } from '../pdf-parser';
import { MLClientConfig, getDefaultMLConfig } from './config';

/**
 * Service health status with additional details
 */
export interface ServiceHealthStatus extends HealthStatus {
  /** Service name */
  service: string;
}

/**
 * Aggregated health status for all services
 */
export interface AggregatedHealthStatus {
  /** Overall status */
  overall: 'HEALTHY' | 'DEGRADED' | 'UNHEALTHY';
  /** Individual service statuses */
  services: ServiceHealthStatus[];
  /** Services that are degraded or unhealthy */
  degradedServices: string[];
  /** Total check duration in ms */
  checkDurationMs: number;
}

/**
 * ML Client Factory
 *
 * Creates singleton instances of ML service clients with shared configuration.
 */
export class MLClientFactory {
  private config: MLClientConfig;
  private audioIntelligenceClient: AudioIntelligenceClient | null = null;
  private recommenderClient: CarePlanRecommenderClient | null = null;
  private ragClient: RagEmbeddingsClient | null = null;
  private pdfClient: PdfParserClient | null = null;

  constructor(config?: Partial<MLClientConfig>) {
    this.config = { ...getDefaultMLConfig(), ...config };
  }

  /**
   * Set Redis client for caching
   */
  setRedisClient(redis: Redis): void {
    this.config.redis = redis;

    // Update existing clients
    if (this.recommenderClient) {
      this.recommenderClient.setRedisClient(redis);
    }
    if (this.ragClient) {
      this.ragClient.setRedisClient(redis);
    }
  }

  /**
   * Get or create Audio Intelligence client
   */
  createAudioIntelligenceClient(): AudioIntelligenceClient {
    if (!this.audioIntelligenceClient) {
      this.audioIntelligenceClient = createAudioIntelligenceClient(
        this.config.urls.audioIntelligence,
        {
          timeout: this.config.timeout,
          retry: this.config.retry,
          circuitBreaker: this.config.circuitBreaker,
          serviceAuthSecret: this.config.serviceAuthSecret,
        }
      );

      this.audioIntelligenceClient.setFallbackEnabled(this.config.enableFallbacks);
    }

    return this.audioIntelligenceClient;
  }

  /**
   * Get or create Care Plan Recommender client
   */
  createRecommenderClient(): CarePlanRecommenderClient {
    if (!this.recommenderClient) {
      this.recommenderClient = createCarePlanRecommenderClient(
        this.config.urls.carePlanRecommender,
        {
          timeout: this.config.timeout,
          retry: this.config.retry,
          circuitBreaker: this.config.circuitBreaker,
          serviceAuthSecret: this.config.serviceAuthSecret,
          redis: this.config.redis,
          allowedICD10Codes: this.config.allowedICD10Codes,
        }
      );

      this.recommenderClient.setFallbackEnabled(this.config.enableFallbacks);
    }

    return this.recommenderClient;
  }

  /**
   * Get or create RAG Embeddings client
   */
  createRagEmbeddingsClient(): RagEmbeddingsClient {
    if (!this.ragClient) {
      this.ragClient = createRagEmbeddingsClient(
        this.config.urls.ragEmbeddings,
        {
          timeout: this.config.timeout,
          retry: this.config.retry,
          circuitBreaker: this.config.circuitBreaker,
          serviceAuthSecret: this.config.serviceAuthSecret,
          redis: this.config.redis,
        }
      );

      this.ragClient.setFallbackEnabled(this.config.enableFallbacks);
    }

    return this.ragClient;
  }

  /**
   * Get or create PDF Parser client
   */
  createPdfParserClient(): PdfParserClient {
    if (!this.pdfClient) {
      this.pdfClient = createPdfParserClient(
        this.config.urls.pdfParser,
        {
          timeout: this.config.timeout * 2, // Double timeout for file uploads
          retry: this.config.retry,
          circuitBreaker: this.config.circuitBreaker,
          serviceAuthSecret: this.config.serviceAuthSecret,
        }
      );
    }

    return this.pdfClient;
  }

  /**
   * Check health of all services
   */
  async checkAllServices(): Promise<AggregatedHealthStatus> {
    const startTime = Date.now();
    const services: ServiceHealthStatus[] = [];
    const degradedServices: string[] = [];

    // Check all services in parallel
    const [audioHealth, recommenderHealth, ragHealth, pdfHealth] = await Promise.all([
      this.checkServiceHealth('audio-intelligence', this.createAudioIntelligenceClient()),
      this.checkServiceHealth('careplan-recommender', this.createRecommenderClient()),
      this.checkServiceHealth('rag-embeddings', this.createRagEmbeddingsClient()),
      this.checkServiceHealth('pdf-parser', this.createPdfParserClient()),
    ]);

    services.push(audioHealth, recommenderHealth, ragHealth, pdfHealth);

    // Collect degraded services
    for (const service of services) {
      if (service.status !== 'HEALTHY') {
        degradedServices.push(service.service);
      }
    }

    // Determine overall status
    let overall: 'HEALTHY' | 'DEGRADED' | 'UNHEALTHY';
    const unhealthyCount = services.filter((s) => s.status === 'UNHEALTHY').length;
    const degradedCount = services.filter((s) => s.status === 'DEGRADED').length;

    if (unhealthyCount >= 2) {
      overall = 'UNHEALTHY';
    } else if (unhealthyCount > 0 || degradedCount > 0) {
      overall = 'DEGRADED';
    } else {
      overall = 'HEALTHY';
    }

    return {
      overall,
      services,
      degradedServices,
      checkDurationMs: Date.now() - startTime,
    };
  }

  /**
   * Get circuit breaker states for all services
   */
  getCircuitStates(): Record<string, CircuitState> {
    return {
      'audio-intelligence': this.audioIntelligenceClient?.getCircuitState() ?? CircuitState.CLOSED,
      'careplan-recommender': this.recommenderClient?.getCircuitState() ?? CircuitState.CLOSED,
      'rag-embeddings': this.ragClient?.getCircuitState() ?? CircuitState.CLOSED,
      'pdf-parser': this.pdfClient?.getCircuitState() ?? CircuitState.CLOSED,
    };
  }

  /**
   * Reset all circuit breakers
   */
  resetAllCircuits(): void {
    this.audioIntelligenceClient?.resetCircuit();
    this.recommenderClient?.resetCircuit();
    this.ragClient?.resetCircuit();
    this.pdfClient?.resetCircuit();
  }

  /**
   * Enable or disable fallbacks for all clients
   */
  setFallbacksEnabled(enabled: boolean): void {
    this.config.enableFallbacks = enabled;
    this.audioIntelligenceClient?.setFallbackEnabled(enabled);
    this.recommenderClient?.setFallbackEnabled(enabled);
    this.ragClient?.setFallbackEnabled(enabled);
  }

  /**
   * Check health of a single service
   */
  private async checkServiceHealth(
    serviceName: string,
    client: { healthCheck(): Promise<HealthStatus> }
  ): Promise<ServiceHealthStatus> {
    try {
      const health = await client.healthCheck();
      return {
        ...health,
        service: serviceName,
      };
    } catch (error) {
      return {
        service: serviceName,
        status: 'UNHEALTHY',
        version: 'unknown',
        latency: 0,
        circuitState: CircuitState.OPEN,
        lastError: error instanceof Error ? error.message : String(error),
      };
    }
  }
}

/**
 * Create ML client factory with default configuration
 */
export function createMLClientFactory(config?: Partial<MLClientConfig>): MLClientFactory {
  return new MLClientFactory(config);
}

/**
 * Global ML client factory instance
 */
let globalFactory: MLClientFactory | null = null;

/**
 * Get or create global ML client factory
 */
export function getMLClientFactory(config?: Partial<MLClientConfig>): MLClientFactory {
  if (!globalFactory) {
    globalFactory = new MLClientFactory(config);
  }
  return globalFactory;
}

/**
 * Reset global ML client factory (for testing)
 */
export function resetMLClientFactory(): void {
  globalFactory = null;
}
