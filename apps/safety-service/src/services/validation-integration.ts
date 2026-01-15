/**
 * Validation Integration Service for Safety Service
 *
 * Integrates the Care Plan Validator ML service with safety checks.
 * Handles anomaly detection, contraindication detection, and validation alerts.
 */

import { v4 as uuidv4 } from "uuid";
import {
  getValidatorClient,
  ValidationInput,
  SafetyValidationResult,
  PatientContext,
  Recommendation,
} from "../clients/validator-client";
import {
  SafetyCheckType,
  SafetySeverity,
  SafetyCheckStatus,
  SafetyCheck,
  ReviewPriority,
} from "./database";

export interface ValidationSafetyInput {
  patientId: string;
  encounterId?: string;
  patientContext: PatientContext;
  recommendations: Array<{
    id?: string;
    type: string;
    code?: string;
    text: string;
    dosage?: string;
    frequency?: string;
  }>;
  checkTypes?: SafetyCheckType[];
}

export interface ValidationSafetyResult {
  checks: SafetyCheck[];
  blockers: SafetyCheck[];
  warnings: SafetyCheck[];
  passed: SafetyCheck[];
  validationDetails: Array<{
    recommendationId?: string;
    recommendationText: string;
    validationResult: SafetyValidationResult;
    generatedCheck?: SafetyCheck;
  }>;
}

// SLA deadlines based on priority (in hours)
const SLA_HOURS: Record<ReviewPriority, number> = {
  P0_CRITICAL: 1,
  P1_HIGH: 4,
  P2_MEDIUM: 24,
  P3_LOW: 72,
};

/**
 * Maps ML validation result to safety check type
 */
function mapToCheckType(
  validationResult: SafetyValidationResult,
  recommendation: Recommendation
): SafetyCheckType {
  // Check deviation factors for specific safety concerns
  const factors = validationResult.deviationFactors.map((f) => f.toLowerCase());

  if (factors.some((f) => f.includes("contraindic"))) {
    return SafetyCheckType.CONTRAINDICATION;
  }
  if (factors.some((f) => f.includes("interaction") || f.includes("drug"))) {
    return SafetyCheckType.DRUG_INTERACTION;
  }
  if (factors.some((f) => f.includes("allergy"))) {
    return SafetyCheckType.ALLERGY_CONFLICT;
  }
  if (factors.some((f) => f.includes("dosage") || f.includes("dose"))) {
    return SafetyCheckType.DOSAGE_VALIDATION;
  }
  if (factors.some((f) => f.includes("duplicate") || f.includes("therapy"))) {
    return SafetyCheckType.DUPLICATE_THERAPY;
  }
  if (factors.some((f) => f.includes("age") || f.includes("pediatric") || f.includes("geriatric"))) {
    return SafetyCheckType.AGE_APPROPRIATENESS;
  }
  if (factors.some((f) => f.includes("pregnan"))) {
    return SafetyCheckType.PREGNANCY_SAFETY;
  }
  if (factors.some((f) => f.includes("renal") || f.includes("kidney"))) {
    return SafetyCheckType.RENAL_ADJUSTMENT;
  }
  if (factors.some((f) => f.includes("hepatic") || f.includes("liver"))) {
    return SafetyCheckType.HEPATIC_ADJUSTMENT;
  }

  // Default based on recommendation type
  if (recommendation.type === "MEDICATION") {
    return SafetyCheckType.DRUG_INTERACTION;
  }

  return SafetyCheckType.CONTRAINDICATION;
}

/**
 * Maps alert level to safety severity
 */
function mapToSeverity(alertLevel: SafetyValidationResult["alertLevel"]): SafetySeverity {
  switch (alertLevel) {
    case "CRITICAL":
      return SafetySeverity.CONTRAINDICATED;
    case "HIGH":
      return SafetySeverity.CRITICAL;
    case "MEDIUM":
      return SafetySeverity.WARNING;
    case "LOW":
      return SafetySeverity.INFO;
    default:
      return SafetySeverity.INFO;
  }
}

/**
 * Maps alert level to safety check status
 */
function mapToStatus(validationResult: SafetyValidationResult): SafetyCheckStatus {
  if (validationResult.alertLevel === "CRITICAL" || validationResult.validationTier === "BLOCKED") {
    return SafetyCheckStatus.BLOCKED;
  }
  if (validationResult.alertLevel === "HIGH" || validationResult.alertLevel === "MEDIUM") {
    return SafetyCheckStatus.FLAGGED;
  }
  if (validationResult.validationTier === "NEEDS_REVIEW") {
    return SafetyCheckStatus.PENDING;
  }
  return SafetyCheckStatus.PASSED;
}

/**
 * Generate a safety check from a validation result
 */
function createSafetyCheckFromValidation(
  patientId: string,
  encounterId: string | undefined,
  recommendation: Recommendation,
  validationResult: SafetyValidationResult,
  patientContext: PatientContext
): SafetyCheck {
  const checkType = mapToCheckType(validationResult, recommendation);
  const severity = mapToSeverity(validationResult.alertLevel);
  const status = mapToStatus(validationResult);

  // Generate descriptive title
  let title = "Recommendation Validation";
  if (validationResult.isAnomaly) {
    title = `Anomaly Detected: ${recommendation.type}`;
  } else if (!validationResult.isValid) {
    title = `Validation Failed: ${recommendation.type}`;
  } else if (validationResult.requiresReview) {
    title = `Review Required: ${recommendation.type}`;
  }

  // Generate description
  let description = validationResult.alertMessage || "Recommendation validation result";
  if (validationResult.deviationFactors.length > 0) {
    description += `. Deviation factors: ${validationResult.deviationFactors.join(", ")}`;
  }

  // Generate clinical rationale
  let clinicalRationale = `ML Validator Confidence: ${(validationResult.confidenceScore * 100).toFixed(1)}%`;
  if (validationResult.isAnomaly) {
    clinicalRationale += `. Anomaly Score: ${(validationResult.anomalyScore * 100).toFixed(1)}%`;
  }
  if (validationResult.alternativeRecommendation) {
    clinicalRationale += `. Suggested alternative: ${validationResult.alternativeRecommendation}`;
  }
  if (validationResult.similarPlanIds.length > 0) {
    clinicalRationale += `. Similar approved plans: ${validationResult.similarPlanIds.slice(0, 3).join(", ")}`;
  }

  return {
    id: uuidv4(),
    patientId,
    encounterId,
    checkType,
    triggerMedicationCode: recommendation.code,
    triggerConditionCode: patientContext.conditionCodes[0],
    status,
    severity,
    title,
    description,
    clinicalRationale,
    relatedMedications: patientContext.medicationCodes || [],
    relatedConditions: patientContext.conditionCodes,
    relatedAllergies: [],
    guidelineReferences: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

/**
 * Validation Integration Service
 */
class ValidationIntegrationService {
  private validatorClient = getValidatorClient();

  /**
   * Validate recommendations and generate safety checks.
   */
  async validateAndGenerateChecks(
    input: ValidationSafetyInput
  ): Promise<ValidationSafetyResult> {
    const result: ValidationSafetyResult = {
      checks: [],
      blockers: [],
      warnings: [],
      passed: [],
      validationDetails: [],
    };

    // Check if validator is healthy
    const isHealthy = await this.validatorClient.healthCheck();
    if (!isHealthy) {
      console.warn("ML Validator service is not available, skipping ML validation");
      return result;
    }

    // Validate each recommendation
    for (const recommendation of input.recommendations) {
      try {
        const validationInput: ValidationInput = {
          patientContext: input.patientContext,
          recommendation: {
            type: recommendation.type,
            code: recommendation.code,
            text: recommendation.text,
            dosage: recommendation.dosage,
            frequency: recommendation.frequency,
          },
        };

        const validationResult = await this.validatorClient.validateForSafety(validationInput);

        // Only generate safety checks for non-passing validations
        if (
          validationResult.alertLevel !== "NONE" ||
          validationResult.validationTier !== "HIGH_CONFIDENCE"
        ) {
          const safetyCheck = createSafetyCheckFromValidation(
            input.patientId,
            input.encounterId,
            recommendation,
            validationResult,
            input.patientContext
          );

          result.checks.push(safetyCheck);

          // Categorize the check
          if (safetyCheck.status === SafetyCheckStatus.BLOCKED) {
            result.blockers.push(safetyCheck);
          } else if (
            safetyCheck.status === SafetyCheckStatus.FLAGGED ||
            safetyCheck.status === SafetyCheckStatus.PENDING
          ) {
            result.warnings.push(safetyCheck);
          } else {
            result.passed.push(safetyCheck);
          }

          result.validationDetails.push({
            recommendationId: recommendation.id,
            recommendationText: recommendation.text,
            validationResult,
            generatedCheck: safetyCheck,
          });
        } else {
          // Record validation result even for passing checks
          result.validationDetails.push({
            recommendationId: recommendation.id,
            recommendationText: recommendation.text,
            validationResult,
          });
        }
      } catch (error) {
        console.error(`Error validating recommendation "${recommendation.text}":`, error);
        // Continue with other recommendations even if one fails
      }
    }

    return result;
  }

  /**
   * Check for anomalies in a set of recommendations.
   * Returns only anomalous recommendations.
   */
  async detectAnomalies(
    input: ValidationSafetyInput
  ): Promise<{
    anomalies: SafetyCheck[];
    details: Array<{
      recommendationText: string;
      anomalyScore: number;
      deviationFactors: string[];
    }>;
  }> {
    const anomalies: SafetyCheck[] = [];
    const details: Array<{
      recommendationText: string;
      anomalyScore: number;
      deviationFactors: string[];
    }> = [];

    const isHealthy = await this.validatorClient.healthCheck();
    if (!isHealthy) {
      console.warn("ML Validator service is not available for anomaly detection");
      return { anomalies, details };
    }

    // Use batch validation for efficiency
    const validationInputs: ValidationInput[] = input.recommendations.map((rec) => ({
      patientContext: input.patientContext,
      recommendation: {
        type: rec.type,
        code: rec.code,
        text: rec.text,
        dosage: rec.dosage,
        frequency: rec.frequency,
      },
    }));

    try {
      const batchResults = await this.validatorClient.validateBatchForSafety(validationInputs);

      for (let i = 0; i < batchResults.length; i++) {
        const result = batchResults[i];
        const recommendation = input.recommendations[i];

        if (result.isAnomaly) {
          const safetyCheck = createSafetyCheckFromValidation(
            input.patientId,
            input.encounterId,
            recommendation,
            result,
            input.patientContext
          );

          anomalies.push(safetyCheck);
          details.push({
            recommendationText: recommendation.text,
            anomalyScore: result.anomalyScore,
            deviationFactors: result.deviationFactors,
          });
        }
      }
    } catch (error) {
      console.error("Error in batch anomaly detection:", error);
    }

    return { anomalies, details };
  }

  /**
   * Validate a single intervention for contraindications.
   */
  async checkContraindications(
    patientId: string,
    patientContext: PatientContext,
    recommendation: Recommendation
  ): Promise<{
    hasContraindication: boolean;
    severity: SafetySeverity;
    details?: string;
    alternativeRecommendation?: string;
  }> {
    const isHealthy = await this.validatorClient.healthCheck();
    if (!isHealthy) {
      return {
        hasContraindication: false,
        severity: SafetySeverity.INFO,
        details: "Validator unavailable - contraindication check skipped",
      };
    }

    try {
      const result = await this.validatorClient.validateForSafety({
        patientContext,
        recommendation,
      });

      const isContraindication =
        !result.isValid &&
        (result.validationTier === "BLOCKED" ||
          result.deviationFactors.some((f) =>
            f.toLowerCase().includes("contraindic")
          ));

      return {
        hasContraindication: isContraindication,
        severity: mapToSeverity(result.alertLevel),
        details: result.alertMessage,
        alternativeRecommendation: result.alternativeRecommendation,
      };
    } catch (error) {
      console.error("Error checking contraindications:", error);
      return {
        hasContraindication: false,
        severity: SafetySeverity.INFO,
        details: "Error during contraindication check",
      };
    }
  }

  /**
   * Get review priority based on validation result.
   */
  getReviewPriority(validationResult: SafetyValidationResult): ReviewPriority {
    if (validationResult.reviewPriority) {
      return validationResult.reviewPriority as ReviewPriority;
    }
    return ReviewPriority.P3_LOW;
  }

  /**
   * Calculate SLA deadline based on priority.
   */
  getSlaDeadline(priority: ReviewPriority): Date {
    const hours = SLA_HOURS[priority];
    return new Date(Date.now() + hours * 60 * 60 * 1000);
  }
}

// Export singleton instance
export const validationIntegrationService = new ValidationIntegrationService();
