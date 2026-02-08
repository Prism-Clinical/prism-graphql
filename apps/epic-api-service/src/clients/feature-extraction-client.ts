/**
 * Feature Extraction Client
 *
 * HTTP client for the feature-extraction service in prism-ml-infra.
 * Features:
 * - Retry with exponential backoff for transient failures
 * - Circuit breaker to fail fast when service is down
 * - Structured logging with request correlation
 * - Graceful degradation support
 * - Dependency injection support for testing
 */

import {
  ResilientHttpClient,
  HttpError,
  CircuitOpenError,
  PayloadTooLargeError,
} from "./http-utils";
import { Logger, createLogger } from "./logger";

// =============================================================================
// TYPES
// =============================================================================

export interface FHIRObservation {
  resourceType: "Observation";
  id?: string;
  status: string;
  code: {
    coding: Array<{
      system: string;
      code: string;
      display?: string;
    }>;
  };
  valueQuantity?: {
    value: number;
    unit: string;
    system?: string;
    code?: string;
  };
  component?: Array<{
    code: {
      coding: Array<{
        system: string;
        code: string;
        display?: string;
      }>;
    };
    valueQuantity?: {
      value: number;
      unit: string;
    };
  }>;
  effectiveDateTime?: string;
}

export interface ExtractedVitalSign {
  type: string;
  value: number;
  unit: string;
  normalizedValue: number;
  normalizedUnit: string;
  isInRange: boolean;
  rangeMin?: number;
  rangeMax?: number;
  timestamp?: string;
}

export interface VitalSignsExtractionResult {
  vitals: ExtractedVitalSign[];
  warnings: string[];
  observationsProcessed: number;
  observationsSkipped: number;
}

export interface ExtractionClientOptions {
  baseUrl?: string;
  timeout?: number;
  maxPayloadBytes?: number;
}

/**
 * Result type that includes service availability status
 */
export interface ExtractionResultWithStatus {
  result: VitalSignsExtractionResult;
  fromService: boolean;
  serviceError?: string;
}

// =============================================================================
// CLIENT IMPLEMENTATION
// =============================================================================

export class FeatureExtractionClient {
  private readonly httpClient: ResilientHttpClient;
  private readonly logger: Logger;

  constructor(options?: ExtractionClientOptions) {
    const baseUrl =
      options?.baseUrl ||
      process.env.FEATURE_EXTRACTION_URL ||
      "http://feature-extraction:8081";

    this.httpClient = new ResilientHttpClient({
      baseUrl,
      serviceName: "feature-extraction",
      timeout: options?.timeout ?? 5000,
      maxPayloadBytes: options?.maxPayloadBytes ?? 10 * 1024 * 1024, // 10MB for FHIR bundles
    });

    this.logger = createLogger("feature-extraction-client");
  }

  /**
   * Extract vital signs from FHIR Observations.
   */
  async extractVitals(
    observations: FHIRObservation[],
    requestId?: string
  ): Promise<VitalSignsExtractionResult> {
    this.logger.debug("Extracting vitals from observations", {
      requestId,
      observationCount: observations.length,
    });

    const response = await this.httpClient.post<VitalSignsExtractionResult>(
      "/extract/vitals",
      { observations },
      requestId
    );

    this.logger.info("Vitals extraction completed", {
      requestId,
      vitalsExtracted: response.data.vitals.length,
      observationsProcessed: response.data.observationsProcessed,
      observationsSkipped: response.data.observationsSkipped,
      durationMs: response.durationMs,
    });

    return response.data;
  }

  /**
   * Extract vitals with graceful fallback to raw observations.
   * Returns both the result and whether it came from the service.
   */
  async extractVitalsWithFallback(
    observations: FHIRObservation[],
    requestId?: string
  ): Promise<ExtractionResultWithStatus> {
    try {
      const result = await this.extractVitals(observations, requestId);
      return { result, fromService: true };
    } catch (error) {
      this.logger.warn(
        "Feature extraction service unavailable, using fallback",
        {
          requestId,
          error: error instanceof Error ? error.message : "Unknown error",
        }
      );

      // Fallback: convert raw observations to minimal vital signs format
      const fallbackResult = this.convertRawObservations(observations);
      return {
        result: fallbackResult,
        fromService: false,
        serviceError: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /**
   * Convert raw FHIR observations to ExtractedVitalSign format.
   * Used as fallback when the extraction service is unavailable.
   */
  private convertRawObservations(
    observations: FHIRObservation[]
  ): VitalSignsExtractionResult {
    const vitals: ExtractedVitalSign[] = [];
    let skipped = 0;

    for (const obs of observations) {
      const display = obs.code?.coding?.[0]?.display || "Unknown";
      const value = obs.valueQuantity?.value;
      const unit = obs.valueQuantity?.unit || "";

      if (value !== undefined) {
        vitals.push({
          type: display,
          value,
          unit,
          normalizedValue: value, // No normalization in fallback
          normalizedUnit: unit,
          isInRange: true, // Can't determine range without service
          timestamp: obs.effectiveDateTime,
        });
      } else if (obs.component) {
        // Handle multi-component observations (e.g., blood pressure)
        for (const comp of obs.component) {
          const compDisplay = comp.code?.coding?.[0]?.display || "Unknown";
          const compValue = comp.valueQuantity?.value;
          const compUnit = comp.valueQuantity?.unit || "";

          if (compValue !== undefined) {
            vitals.push({
              type: compDisplay,
              value: compValue,
              unit: compUnit,
              normalizedValue: compValue,
              normalizedUnit: compUnit,
              isInRange: true,
              timestamp: obs.effectiveDateTime,
            });
          } else {
            skipped++;
          }
        }
      } else {
        skipped++;
      }
    }

    return {
      vitals,
      warnings: [
        "Using fallback extraction - normalization and range checking unavailable",
      ],
      observationsProcessed: vitals.length,
      observationsSkipped: skipped,
    };
  }

  /**
   * Check if the extraction service is healthy.
   */
  async healthCheck(): Promise<boolean> {
    return this.httpClient.healthCheck();
  }

  /**
   * Reset the circuit breaker (for testing or manual recovery).
   */
  resetCircuitBreaker(): void {
    this.httpClient.resetCircuitBreaker();
  }
}

// =============================================================================
// SINGLETON WITH RESET FOR TESTING
// =============================================================================

let extractionClient: FeatureExtractionClient | null = null;

export function getExtractionClient(): FeatureExtractionClient {
  if (!extractionClient) {
    extractionClient = new FeatureExtractionClient();
  }
  return extractionClient;
}

/**
 * Reset the singleton instance (for testing).
 */
export function resetExtractionClient(): void {
  extractionClient = null;
}

/**
 * Set a custom extraction client instance (for testing/DI).
 */
export function setExtractionClient(client: FeatureExtractionClient): void {
  extractionClient = client;
}

// Re-export error types for consumers
export { HttpError, CircuitOpenError, PayloadTooLargeError };
