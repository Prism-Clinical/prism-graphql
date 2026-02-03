/**
 * Feature Extraction Client
 *
 * HTTP client for the feature-extraction service in prism-ml-infra.
 * Follows the same patterns as ValidatorClient in careplan-service.
 */

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

export class FeatureExtractionClient {
  private baseUrl: string;
  private timeout: number;

  constructor(options?: { baseUrl?: string; timeout?: number }) {
    this.baseUrl =
      options?.baseUrl ||
      process.env.FEATURE_EXTRACTION_URL ||
      "http://feature-extraction:8081";
    this.timeout = options?.timeout || 5000;
  }

  async extractVitals(
    observations: FHIRObservation[]
  ): Promise<VitalSignsExtractionResult> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(`${this.baseUrl}/extract/vitals`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ observations }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(
          `Vital signs extraction failed: ${response.status} - ${error}`
        );
      }

      return await response.json();
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error("Vital signs extraction request timed out");
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  async healthCheck(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/health`, {
        method: "GET",
        signal: AbortSignal.timeout(2000),
      });
      return response.ok;
    } catch {
      return false;
    }
  }
}

// Singleton instance
let extractionClient: FeatureExtractionClient | null = null;

export function getExtractionClient(): FeatureExtractionClient {
  if (!extractionClient) {
    extractionClient = new FeatureExtractionClient();
  }
  return extractionClient;
}
