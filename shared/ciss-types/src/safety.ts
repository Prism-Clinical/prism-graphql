/**
 * Safety Service Types
 *
 * Types for the safety-service domain including checks and review queue.
 */

import {
  AuditFields,
  BaseEntity,
  Connection,
  DateTime,
  EncounterEntity,
  PatientEntity,
  UUID,
} from './common';

/**
 * Types of safety checks
 */
export enum SafetyCheckType {
  DRUG_INTERACTION = 'DRUG_INTERACTION',
  ALLERGY_CONFLICT = 'ALLERGY_CONFLICT',
  CONTRAINDICATION = 'CONTRAINDICATION',
  DOSAGE_VALIDATION = 'DOSAGE_VALIDATION',
  DUPLICATE_THERAPY = 'DUPLICATE_THERAPY',
  AGE_APPROPRIATENESS = 'AGE_APPROPRIATENESS',
  PREGNANCY_SAFETY = 'PREGNANCY_SAFETY',
  RENAL_ADJUSTMENT = 'RENAL_ADJUSTMENT',
  HEPATIC_ADJUSTMENT = 'HEPATIC_ADJUSTMENT',
}

/**
 * Severity levels for safety issues
 */
export enum SafetySeverity {
  INFO = 'INFO',
  WARNING = 'WARNING',
  CRITICAL = 'CRITICAL',
  CONTRAINDICATED = 'CONTRAINDICATED',
}

/**
 * Status of a safety check
 */
export enum SafetyCheckStatus {
  PENDING = 'PENDING',
  PASSED = 'PASSED',
  FLAGGED = 'FLAGGED',
  OVERRIDDEN = 'OVERRIDDEN',
  BLOCKED = 'BLOCKED',
}

/**
 * Status of a review queue item
 */
export enum ReviewQueueStatus {
  PENDING_REVIEW = 'PENDING_REVIEW',
  IN_REVIEW = 'IN_REVIEW',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
  ESCALATED = 'ESCALATED',
}

/**
 * Priority levels for review items
 */
export enum ReviewPriority {
  P0_CRITICAL = 'P0_CRITICAL',
  P1_HIGH = 'P1_HIGH',
  P2_MEDIUM = 'P2_MEDIUM',
  P3_LOW = 'P3_LOW',
}

/**
 * Reasons for overriding a safety check
 */
export enum OverrideReason {
  CLINICAL_JUDGMENT = 'CLINICAL_JUDGMENT',
  PATIENT_INFORMED_CONSENT = 'PATIENT_INFORMED_CONSENT',
  NO_ALTERNATIVE_AVAILABLE = 'NO_ALTERNATIVE_AVAILABLE',
  MONITORING_IN_PLACE = 'MONITORING_IN_PLACE',
  DOSAGE_ADJUSTED = 'DOSAGE_ADJUSTED',
  SPECIALIST_APPROVED = 'SPECIALIST_APPROVED',
}

/**
 * A safety check result
 */
export interface SafetyCheck
  extends BaseEntity,
    PatientEntity,
    EncounterEntity,
    AuditFields {
  checkType: SafetyCheckType;
  triggerMedicationCode?: string;
  triggerConditionCode?: string;
  status: SafetyCheckStatus;
  severity: SafetySeverity;
  title: string;
  description: string;
  clinicalRationale: string;
  relatedMedications: string[];
  relatedConditions: string[];
  relatedAllergies: string[];
  guidelineReferences: string[];
}

/**
 * Override information for a safety check
 */
export interface SafetyOverride {
  overriddenBy: UUID;
  overriddenAt: DateTime;
  reason: OverrideReason;
  justification: string;
  expiresAt?: DateTime;
}

/**
 * A review queue item
 */
export interface ReviewQueueItem extends BaseEntity, PatientEntity, AuditFields {
  safetyCheckId: UUID;
  recommendationId?: UUID;
  status: ReviewQueueStatus;
  priority: ReviewPriority;
  assignedTo?: UUID;
  assignedAt?: DateTime;
  slaDeadline: DateTime;
}

/**
 * Resolution details for a review
 */
export interface ReviewResolution {
  resolvedBy: UUID;
  resolvedAt: DateTime;
  decision: ReviewQueueStatus;
  notes?: string;
  escalationReason?: string;
}

/**
 * Result of a safety validation request
 */
export interface SafetyValidationResult {
  isValid: boolean;
  checks: SafetyCheck[];
  blockers: SafetyCheck[];
  warnings: SafetyCheck[];
  requiresReview: boolean;
  reviewQueueItem?: ReviewQueueItem;
}

/**
 * Input for safety validation
 */
export interface SafetyValidationInput {
  patientId: UUID;
  encounterId?: UUID;
  medicationCodes?: string[];
  conditionCodes?: string[];
  checkTypes?: SafetyCheckType[];
}

/**
 * Input for filtering safety checks
 */
export interface SafetyCheckFilterInput {
  patientId?: UUID;
  encounterId?: UUID;
  checkType?: SafetyCheckType;
  status?: SafetyCheckStatus;
  severity?: SafetySeverity;
}

/**
 * Input for filtering review queue
 */
export interface ReviewQueueFilterInput {
  patientId?: UUID;
  assignedTo?: UUID;
  status?: ReviewQueueStatus;
  priority?: ReviewPriority;
  isOverdue?: boolean;
}

/**
 * Input for overriding a safety check
 */
export interface OverrideSafetyCheckInput {
  safetyCheckId: UUID;
  reason: OverrideReason;
  justification: string;
  expiresInHours?: number;
}

/**
 * Input for resolving a review
 */
export interface ResolveReviewInput {
  reviewQueueItemId: UUID;
  decision: ReviewQueueStatus;
  notes?: string;
  escalationReason?: string;
}

/**
 * Safety check connection type
 */
export type SafetyCheckConnection = Connection<SafetyCheck>;

/**
 * Review queue connection type
 */
export type ReviewQueueConnection = Connection<ReviewQueueItem>;

/**
 * Database row type for safety_checks table
 */
export interface SafetyCheckRow {
  id: string;
  patient_id: string;
  encounter_id: string | null;
  check_type: string;
  trigger_medication_code: string | null;
  trigger_condition_code: string | null;
  status: string;
  severity: string;
  title: string;
  description: string;
  clinical_rationale: string;
  related_medications: string[];
  related_conditions: string[];
  related_allergies: string[];
  guideline_references: string[];
  override_reason: string | null;
  override_justification: string | null;
  overridden_by: string | null;
  overridden_at: Date | null;
  override_expires_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

/**
 * Database row type for review_queue table
 */
export interface ReviewQueueRow {
  id: string;
  patient_id: string;
  safety_check_id: string;
  recommendation_id: string | null;
  status: string;
  priority: string;
  assigned_to: string | null;
  assigned_at: Date | null;
  sla_deadline: Date;
  resolved_by: string | null;
  resolved_at: Date | null;
  resolution_notes: string | null;
  escalation_reason: string | null;
  created_at: Date;
  updated_at: Date;
}
