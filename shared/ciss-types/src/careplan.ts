/**
 * Care Plan Service Types
 *
 * Types for the careplan-service domain.
 */

import {
  AuditFields,
  BaseEntity,
  Connection,
  DateOnly,
  DateTime,
  PatientEntity,
  UUID,
} from './common';

/**
 * Status of a care plan
 */
export enum CarePlanStatus {
  DRAFT = 'DRAFT',
  PENDING_REVIEW = 'PENDING_REVIEW',
  ACTIVE = 'ACTIVE',
  ON_HOLD = 'ON_HOLD',
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED',
}

/**
 * Status of a goal
 */
export enum GoalStatus {
  NOT_STARTED = 'NOT_STARTED',
  IN_PROGRESS = 'IN_PROGRESS',
  ACHIEVED = 'ACHIEVED',
  NOT_ACHIEVED = 'NOT_ACHIEVED',
  CANCELLED = 'CANCELLED',
}

/**
 * Priority levels for goals
 */
export enum GoalPriority {
  HIGH = 'HIGH',
  MEDIUM = 'MEDIUM',
  LOW = 'LOW',
}

/**
 * Types of interventions
 */
export enum InterventionType {
  MEDICATION = 'MEDICATION',
  PROCEDURE = 'PROCEDURE',
  LIFESTYLE = 'LIFESTYLE',
  MONITORING = 'MONITORING',
  REFERRAL = 'REFERRAL',
  EDUCATION = 'EDUCATION',
  FOLLOW_UP = 'FOLLOW_UP',
}

/**
 * Status of an intervention
 */
export enum InterventionStatus {
  SCHEDULED = 'SCHEDULED',
  IN_PROGRESS = 'IN_PROGRESS',
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED',
  DEFERRED = 'DEFERRED',
}

/**
 * Categories for care plan templates
 */
export enum TemplateCategory {
  CHRONIC_DISEASE = 'CHRONIC_DISEASE',
  PREVENTIVE_CARE = 'PREVENTIVE_CARE',
  POST_PROCEDURE = 'POST_PROCEDURE',
  MEDICATION_MANAGEMENT = 'MEDICATION_MANAGEMENT',
  LIFESTYLE_MODIFICATION = 'LIFESTYLE_MODIFICATION',
}

/**
 * A care plan
 */
export interface CarePlan extends BaseEntity, PatientEntity, AuditFields {
  title: string;
  status: CarePlanStatus;
  conditionCodes: string[];
  startDate: DateOnly;
  targetEndDate?: DateOnly;
  actualEndDate?: DateOnly;
  nextReviewDate?: DateOnly;
  lastReviewedAt?: DateTime;
  lastReviewedBy?: UUID;
  sourceTranscriptionId?: UUID;
  sourceRAGSynthesisId?: UUID;
  templateId?: UUID;
  createdBy: UUID;
}

/**
 * A goal within a care plan
 */
export interface CarePlanGoal extends BaseEntity, AuditFields {
  carePlanId: UUID;
  description: string;
  targetValue?: string;
  targetDate?: DateOnly;
  status: GoalStatus;
  priority: GoalPriority;
  currentValue?: string;
  percentComplete?: number;
  linkedInterventionIds: UUID[];
  guidelineReference?: string;
}

/**
 * A progress note for a goal
 */
export interface GoalProgressNote extends BaseEntity {
  goalId: UUID;
  note: string;
  value?: string;
  recordedAt: DateTime;
  recordedBy: UUID;
}

/**
 * An intervention within a care plan
 */
export interface CarePlanIntervention extends BaseEntity, AuditFields {
  carePlanId: UUID;
  type: InterventionType;
  description: string;
  medicationCode?: string;
  dosage?: string;
  frequency?: string;
  procedureCode?: string;
  referralSpecialty?: string;
  status: InterventionStatus;
  scheduledDate?: DateOnly;
  completedDate?: DateOnly;
  patientInstructions?: string;
  providerNotes?: string;
  guidelineReference?: string;
}

/**
 * A care plan template
 */
export interface CarePlanTemplate extends BaseEntity, AuditFields {
  name: string;
  category: TemplateCategory;
  conditionCodes: string[];
  guidelineSource?: string;
  evidenceGrade?: string;
  isActive: boolean;
  version: string;
}

/**
 * A goal template
 */
export interface TemplateGoal {
  description: string;
  defaultTargetValue?: string;
  defaultTargetDays?: number;
  priority: GoalPriority;
}

/**
 * An intervention template
 */
export interface TemplateIntervention {
  type: InterventionType;
  description: string;
  medicationCode?: string;
  procedureCode?: string;
  defaultScheduleDays?: number;
}

/**
 * Input for creating a care plan
 */
export interface CreateCarePlanInput {
  patientId: UUID;
  title: string;
  conditionCodes: string[];
  startDate: DateOnly;
  targetEndDate?: DateOnly;
  templateId?: UUID;
  sourceTranscriptionId?: UUID;
  sourceRAGSynthesisId?: UUID;
}

/**
 * Input for adding a goal
 */
export interface AddGoalInput {
  carePlanId: UUID;
  description: string;
  targetValue?: string;
  targetDate?: DateOnly;
  priority: GoalPriority;
  guidelineReference?: string;
}

/**
 * Input for adding an intervention
 */
export interface AddInterventionInput {
  carePlanId: UUID;
  type: InterventionType;
  description: string;
  medicationCode?: string;
  dosage?: string;
  frequency?: string;
  procedureCode?: string;
  referralSpecialty?: string;
  scheduledDate?: DateOnly;
  patientInstructions?: string;
  guidelineReference?: string;
}

/**
 * Input for updating goal status
 */
export interface UpdateGoalStatusInput {
  goalId: UUID;
  status: GoalStatus;
  progressNote?: string;
  currentValue?: string;
}

/**
 * Input for updating intervention status
 */
export interface UpdateInterventionStatusInput {
  interventionId: UUID;
  status: InterventionStatus;
  completedDate?: DateOnly;
  providerNotes?: string;
}

/**
 * Input for filtering care plans
 */
export interface CarePlanFilterInput {
  patientId?: UUID;
  status?: CarePlanStatus;
  conditionCode?: string;
  createdAfter?: DateTime;
  createdBefore?: DateTime;
}

/**
 * Input for filtering templates
 */
export interface TemplateFilterInput {
  category?: TemplateCategory;
  conditionCode?: string;
  isActive?: boolean;
}

/**
 * Care plan connection type
 */
export type CarePlanConnection = Connection<CarePlan>;

/**
 * Care plan template connection type
 */
export type CarePlanTemplateConnection = Connection<CarePlanTemplate>;

/**
 * Database row type for care_plans table
 */
export interface CarePlanRow {
  id: string;
  patient_id: string;
  title: string;
  status: string;
  condition_codes: string[];
  start_date: Date;
  target_end_date: Date | null;
  actual_end_date: Date | null;
  next_review_date: Date | null;
  last_reviewed_at: Date | null;
  last_reviewed_by: string | null;
  source_transcription_id: string | null;
  source_rag_synthesis_id: string | null;
  template_id: string | null;
  created_at: Date;
  created_by: string;
  updated_at: Date;
}

/**
 * Database row type for care_plan_goals table
 */
export interface CarePlanGoalRow {
  id: string;
  care_plan_id: string;
  description: string;
  target_value: string | null;
  target_date: Date | null;
  status: string;
  priority: string;
  current_value: string | null;
  percent_complete: number | null;
  linked_intervention_ids: string[];
  guideline_reference: string | null;
  created_at: Date;
  updated_at: Date;
}

/**
 * Database row type for care_plan_interventions table
 */
export interface CarePlanInterventionRow {
  id: string;
  care_plan_id: string;
  type: string;
  description: string;
  medication_code: string | null;
  dosage: string | null;
  frequency: string | null;
  procedure_code: string | null;
  referral_specialty: string | null;
  status: string;
  scheduled_date: Date | null;
  completed_date: Date | null;
  patient_instructions: string | null;
  provider_notes: string | null;
  guideline_reference: string | null;
  created_at: Date;
  updated_at: Date;
}

/**
 * Database row type for care_plans table (clinical pathway definitions)
 */
export interface CarePlanTemplateRow {
  id: string;
  name: string;
  category: string;
  condition_codes: string[];
  guideline_source: string | null;
  evidence_grade: string | null;
  is_active: boolean;
  version: string;
  created_at: Date;
  updated_at: Date;
}
