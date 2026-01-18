/**
 * Care Plan Validator Client for Care Plan Service
 *
 * HTTP client for the Care Plan Validator ML service.
 * Used to validate interventions before adding them to care plans.
 */

export interface PatientContext {
  conditionCodes: string[];
  medicationCodes?: string[];
  labCodes?: string[];
  labValues?: Record<string, number>;
  complications?: string[];
  riskFactors?: string[];
  immunocompromised?: boolean;
  age?: number;
  sex?: string;
}

export interface Recommendation {
  type: string;
  code?: string;
  text: string;
  dosage?: string;
  frequency?: string;
}

export interface GuidelineInfo {
  source?: string;
  evidenceGrade?: string;
  ageDays?: number;
}

export interface ValidationInput {
  patientContext: PatientContext;
  recommendation: Recommendation;
  guideline?: GuidelineInfo;
}

export interface ValidationResult {
  isValid: boolean;
  confidenceScore: number;
  validationTier: "HIGH_CONFIDENCE" | "NEEDS_REVIEW" | "BLOCKED";
  isAnomaly: boolean;
  anomalyScore: number;
  predictedClass: string;
  classProbabilities: Record<string, number>;
  similarPlanIds: string[];
  deviationFactors: string[];
  alternativeRecommendation?: string;
  alternativeConfidence?: number;
}

export interface BatchValidationResult {
  results: ValidationResult[];
  totalCount: number;
  validCount: number;
  blockedCount: number;
  anomalyCount: number;
  processingTimeMs: number;
}

export class ValidatorClient {
  private baseUrl: string;
  private timeout: number;

  constructor(options?: { baseUrl?: string; timeout?: number }) {
    this.baseUrl =
      options?.baseUrl ||
      process.env.ML_VALIDATOR_URL ||
      "http://care-plan-validator:8080";
    this.timeout = options?.timeout || 5000;
  }

  /**
   * Validate a single intervention recommendation.
   */
  async validateRecommendation(
    input: ValidationInput
  ): Promise<ValidationResult> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(
        `${this.baseUrl}/validate/recommendation`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            patient_context: {
              condition_codes: input.patientContext.conditionCodes,
              medication_codes: input.patientContext.medicationCodes,
              lab_codes: input.patientContext.labCodes,
              lab_values: input.patientContext.labValues,
              complications: input.patientContext.complications,
              risk_factors: input.patientContext.riskFactors,
              immunocompromised: input.patientContext.immunocompromised,
              age: input.patientContext.age,
              sex: input.patientContext.sex,
            },
            recommendation: {
              type: input.recommendation.type,
              code: input.recommendation.code,
              text: input.recommendation.text,
              dosage: input.recommendation.dosage,
              frequency: input.recommendation.frequency,
            },
            guideline: input.guideline
              ? {
                  source: input.guideline.source,
                  evidence_grade: input.guideline.evidenceGrade,
                  age_days: input.guideline.ageDays,
                }
              : null,
          }),
          signal: controller.signal,
        }
      );

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Validation failed: ${response.status} - ${error}`);
      }

      const data = await response.json();

      return {
        isValid: data.is_valid,
        confidenceScore: data.confidence_score,
        validationTier: data.validation_tier,
        isAnomaly: data.is_anomaly,
        anomalyScore: data.anomaly_score,
        predictedClass: data.predicted_class,
        classProbabilities: data.class_probabilities,
        similarPlanIds: data.similar_plan_ids || [],
        deviationFactors: data.deviation_factors || [],
        alternativeRecommendation: data.alternative_recommendation,
        alternativeConfidence: data.alternative_confidence,
      };
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error("Validation request timed out");
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Validate multiple interventions in batch.
   */
  async validateBatch(
    inputs: ValidationInput[]
  ): Promise<BatchValidationResult> {
    const controller = new AbortController();
    const timeoutId = setTimeout(
      () => controller.abort(),
      this.timeout * inputs.length
    );

    try {
      const response = await fetch(`${this.baseUrl}/validate/batch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          validations: inputs.map((input) => ({
            patient_context: {
              condition_codes: input.patientContext.conditionCodes,
              medication_codes: input.patientContext.medicationCodes,
              lab_codes: input.patientContext.labCodes,
              lab_values: input.patientContext.labValues,
              complications: input.patientContext.complications,
              risk_factors: input.patientContext.riskFactors,
              immunocompromised: input.patientContext.immunocompromised,
              age: input.patientContext.age,
              sex: input.patientContext.sex,
            },
            recommendation: {
              type: input.recommendation.type,
              code: input.recommendation.code,
              text: input.recommendation.text,
              dosage: input.recommendation.dosage,
              frequency: input.recommendation.frequency,
            },
            guideline: input.guideline
              ? {
                  source: input.guideline.source,
                  evidence_grade: input.guideline.evidenceGrade,
                  age_days: input.guideline.ageDays,
                }
              : null,
          })),
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Batch validation failed: ${response.status} - ${error}`);
      }

      const data = await response.json();

      return {
        results: data.results.map((result: any) => ({
          isValid: result.is_valid,
          confidenceScore: result.confidence_score,
          validationTier: result.validation_tier,
          isAnomaly: result.is_anomaly,
          anomalyScore: result.anomaly_score,
          predictedClass: result.predicted_class,
          classProbabilities: result.class_probabilities,
          similarPlanIds: result.similar_plan_ids || [],
          deviationFactors: result.deviation_factors || [],
          alternativeRecommendation: result.alternative_recommendation,
          alternativeConfidence: result.alternative_confidence,
        })),
        totalCount: data.total_count,
        validCount: data.valid_count,
        blockedCount: data.blocked_count,
        anomalyCount: data.anomaly_count,
        processingTimeMs: data.processing_time_ms,
      };
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error("Batch validation request timed out");
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Check if the validator service is healthy.
   */
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
let validatorClient: ValidatorClient | null = null;

export function getValidatorClient(): ValidatorClient {
  if (!validatorClient) {
    validatorClient = new ValidatorClient();
  }
  return validatorClient;
}
