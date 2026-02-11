/**
 * Degradation Manager
 *
 * Manages graceful degradation and feature flags for pipeline stages.
 */

import { Redis } from 'ioredis';
import { ServiceCriticality } from './types';

/**
 * Feature flag configuration
 */
export interface FeatureFlags {
  /** Enable entity extraction stage */
  enableExtraction: boolean;
  /** Enable embedding generation stage */
  enableEmbedding: boolean;
  /** Enable recommendation stage */
  enableRecommendation: boolean;
  /** Enable draft generation stage */
  enableDraftGeneration: boolean;
  /** Enable safety validation stage */
  enableSafetyValidation: boolean;
  /** Force fallback mode for testing */
  forceFallbackMode: boolean;
  /** Enable caching */
  enableCaching: boolean;
}

/**
 * Default feature flags
 */
const DEFAULT_FLAGS: FeatureFlags = {
  enableExtraction: true,
  enableEmbedding: true,
  enableRecommendation: true,
  enableDraftGeneration: true,
  enableSafetyValidation: true,
  forceFallbackMode: false,
  enableCaching: true,
};

/**
 * Service status for degradation decisions
 */
export interface ServiceStatus {
  /** Service name */
  name: string;
  /** Whether service is healthy */
  healthy: boolean;
  /** Circuit breaker state */
  circuitState: 'CLOSED' | 'OPEN' | 'HALF_OPEN';
  /** Consecutive failures */
  failureCount: number;
  /** Last health check timestamp */
  lastCheck: Date;
  /** Error rate in last window */
  errorRate: number;
}

/**
 * Degradation configuration
 */
export interface DegradationConfig {
  /** Redis client for distributed feature flags */
  redis?: Redis;
  /** Key prefix for Redis */
  keyPrefix?: string;
  /** Feature flag refresh interval in ms */
  refreshInterval?: number;
  /** Callback when degradation occurs */
  onDegradation?: (service: string, reason: string) => Promise<void>;
}

/**
 * Degradation manager
 */
export class DegradationManager {
  private flags: FeatureFlags;
  private serviceStatuses: Map<string, ServiceStatus> = new Map();
  private redis?: Redis;
  private keyPrefix: string;
  private refreshInterval?: NodeJS.Timeout;
  private onDegradation?: (service: string, reason: string) => Promise<void>;

  constructor(config: DegradationConfig = {}) {
    this.flags = { ...DEFAULT_FLAGS };
    this.redis = config.redis;
    this.keyPrefix = config.keyPrefix ?? 'pipeline:flags:';
    this.onDegradation = config.onDegradation;

    // Start periodic refresh if Redis configured
    if (this.redis && config.refreshInterval) {
      this.startRefresh(config.refreshInterval);
    }
  }

  /**
   * Start periodic flag refresh
   */
  private startRefresh(intervalMs: number): void {
    this.refreshInterval = setInterval(() => {
      this.loadFlagsFromRedis().catch(console.error);
    }, intervalMs);
  }

  /**
   * Stop periodic refresh
   */
  stopRefresh(): void {
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
      this.refreshInterval = undefined;
    }
  }

  /**
   * Load feature flags from Redis
   */
  private async loadFlagsFromRedis(): Promise<void> {
    if (!this.redis) return;

    try {
      const flagsJson = await this.redis.get(`${this.keyPrefix}current`);
      if (flagsJson) {
        const loadedFlags = JSON.parse(flagsJson);
        this.flags = { ...DEFAULT_FLAGS, ...loadedFlags };
      }
    } catch (error) {
      console.error('Failed to load feature flags:', error);
    }
  }

  /**
   * Save feature flags to Redis
   */
  async saveFlags(): Promise<void> {
    if (!this.redis) return;

    try {
      await this.redis.set(`${this.keyPrefix}current`, JSON.stringify(this.flags));
    } catch (error) {
      console.error('Failed to save feature flags:', error);
    }
  }

  /**
   * Get current feature flags
   */
  getFlags(): FeatureFlags {
    return { ...this.flags };
  }

  /**
   * Set feature flag
   */
  async setFlag<K extends keyof FeatureFlags>(
    flag: K,
    value: FeatureFlags[K]
  ): Promise<void> {
    this.flags[flag] = value;
    await this.saveFlags();
  }

  /**
   * Set multiple flags
   */
  async setFlags(flags: Partial<FeatureFlags>): Promise<void> {
    this.flags = { ...this.flags, ...flags };
    await this.saveFlags();
  }

  /**
   * Check if a stage should be executed
   */
  shouldExecuteStage(stageName: string): boolean {
    if (this.flags.forceFallbackMode) {
      return false;
    }

    switch (stageName) {
      case 'extraction':
        return this.flags.enableExtraction;
      case 'embedding':
        return this.flags.enableEmbedding;
      case 'recommendation':
        return this.flags.enableRecommendation;
      case 'draft':
        return this.flags.enableDraftGeneration;
      case 'safety':
        return this.flags.enableSafetyValidation;
      default:
        return true;
    }
  }

  /**
   * Update service status
   */
  updateServiceStatus(status: ServiceStatus): void {
    this.serviceStatuses.set(status.name, status);

    // Check if degradation action needed
    if (!status.healthy || status.circuitState === 'OPEN') {
      this.handleServiceDegradation(status);
    }
  }

  /**
   * Handle service degradation
   */
  private async handleServiceDegradation(status: ServiceStatus): Promise<void> {
    const reason = status.circuitState === 'OPEN'
      ? 'Circuit breaker open'
      : `Service unhealthy (error rate: ${(status.errorRate * 100).toFixed(1)}%)`;

    console.warn(`Service ${status.name} degraded: ${reason}`);

    if (this.onDegradation) {
      await this.onDegradation(status.name, reason);
    }
  }

  /**
   * Get service status
   */
  getServiceStatus(name: string): ServiceStatus | undefined {
    return this.serviceStatuses.get(name);
  }

  /**
   * Get all service statuses
   */
  getAllServiceStatuses(): ServiceStatus[] {
    return Array.from(this.serviceStatuses.values());
  }

  /**
   * Check if should use fallback for service
   */
  shouldUseFallback(serviceName: string): boolean {
    if (this.flags.forceFallbackMode) {
      return true;
    }

    const status = this.serviceStatuses.get(serviceName);
    if (!status) return false;

    return !status.healthy || status.circuitState === 'OPEN';
  }

  /**
   * Get degradation summary
   */
  getDegradationSummary(): DegradationSummary {
    const degradedServices = Array.from(this.serviceStatuses.values())
      .filter((s) => !s.healthy || s.circuitState === 'OPEN')
      .map((s) => s.name);

    const disabledFeatures = Object.entries(this.flags)
      .filter(([key, value]) => key.startsWith('enable') && value === false)
      .map(([key]) => key.replace('enable', '').toLowerCase());

    return {
      isDegraded: degradedServices.length > 0 || disabledFeatures.length > 0,
      degradedServices,
      disabledFeatures,
      forceFallbackMode: this.flags.forceFallbackMode,
      timestamp: new Date(),
    };
  }

  /**
   * Enable fallback mode for testing/maintenance
   */
  async enableFallbackMode(): Promise<void> {
    await this.setFlag('forceFallbackMode', true);
    console.log('Fallback mode enabled');
  }

  /**
   * Disable fallback mode
   */
  async disableFallbackMode(): Promise<void> {
    await this.setFlag('forceFallbackMode', false);
    console.log('Fallback mode disabled');
  }

  /**
   * Disable a specific stage
   */
  async disableStage(stageName: string): Promise<void> {
    const flagMap: Record<string, keyof FeatureFlags> = {
      extraction: 'enableExtraction',
      embedding: 'enableEmbedding',
      recommendation: 'enableRecommendation',
      draft: 'enableDraftGeneration',
      safety: 'enableSafetyValidation',
    };

    const flag = flagMap[stageName];
    if (flag) {
      await this.setFlag(flag, false);
      console.log(`Stage ${stageName} disabled`);
    }
  }

  /**
   * Enable a specific stage
   */
  async enableStage(stageName: string): Promise<void> {
    const flagMap: Record<string, keyof FeatureFlags> = {
      extraction: 'enableExtraction',
      embedding: 'enableEmbedding',
      recommendation: 'enableRecommendation',
      draft: 'enableDraftGeneration',
      safety: 'enableSafetyValidation',
    };

    const flag = flagMap[stageName];
    if (flag) {
      await this.setFlag(flag, true);
      console.log(`Stage ${stageName} enabled`);
    }
  }
}

/**
 * Degradation summary
 */
export interface DegradationSummary {
  /** Whether system is in degraded state */
  isDegraded: boolean;
  /** List of degraded services */
  degradedServices: string[];
  /** List of disabled features */
  disabledFeatures: string[];
  /** Whether force fallback mode is active */
  forceFallbackMode: boolean;
  /** Timestamp of summary */
  timestamp: Date;
}

/**
 * Service criticality configuration
 */
export const SERVICE_CRITICALITY_CONFIG: Record<string, ServiceCriticality> = {
  'audio-intelligence': ServiceCriticality.IMPORTANT,
  'careplan-recommender': ServiceCriticality.IMPORTANT,
  'rag-embeddings': ServiceCriticality.NICE_TO_HAVE,
  'pdf-parser': ServiceCriticality.IMPORTANT,
  'safety-validation': ServiceCriticality.CRITICAL,
};

/**
 * Get criticality for a service
 */
export function getServiceCriticality(serviceName: string): ServiceCriticality {
  return SERVICE_CRITICALITY_CONFIG[serviceName] ?? ServiceCriticality.IMPORTANT;
}

/**
 * Check if service failure should block pipeline
 */
export function shouldBlockOnFailure(serviceName: string): boolean {
  return getServiceCriticality(serviceName) === ServiceCriticality.CRITICAL;
}

// Export singleton instance
export const degradationManager = new DegradationManager();
