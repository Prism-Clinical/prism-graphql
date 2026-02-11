/**
 * Pipeline Orchestration Types
 *
 * Type definitions for the care plan generation pipeline.
 */

import { v4 as uuidv4 } from 'uuid';

/**
 * Pipeline input for care plan generation
 */
export interface PipelineInput {
  /** Unique visit identifier */
  visitId: string;
  /** Patient identifier */
  patientId: string;
  /** Transcript text for entity extraction */
  transcriptText?: string;
  /** URL to audio file for transcription */
  audioUrl?: string;
  /** ICD-10 condition codes */
  conditionCodes: string[];
  /** Idempotency key for deduplication (required) */
  idempotencyKey: string;
  /** Correlation ID for distributed tracing */
  correlationId: string;
  /** Whether to generate a draft care plan */
  generateDraft?: boolean;
  /** Preferred template IDs to consider */
  preferredTemplateIds?: string[];
  /** User ID initiating the request */
  userId: string;
  /** User role for authorization */
  userRole: string;
}

/**
 * Extracted clinical entity
 */
export interface ClinicalEntity {
  /** Entity text */
  text: string;
  /** Entity type (symptom, medication, procedure, etc.) */
  type: string;
  /** Confidence score 0-1 */
  confidence: number;
  /** SNOMED or other code if identified */
  code?: string;
  /** Code system (SNOMED, RxNorm, etc.) */
  codeSystem?: string;
  /** Character offset in source text */
  offset?: number;
  /** Entity length */
  length?: number;
}

/**
 * Extracted entities from transcript
 */
export interface ExtractedEntities {
  /** Symptoms and complaints */
  symptoms: ClinicalEntity[];
  /** Medications mentioned */
  medications: ClinicalEntity[];
  /** Vital signs */
  vitals: ClinicalEntity[];
  /** Procedures mentioned */
  procedures: ClinicalEntity[];
  /** Diagnoses mentioned */
  diagnoses: ClinicalEntity[];
  /** Allergies mentioned */
  allergies: ClinicalEntity[];
  /** Extraction timestamp */
  extractedAt: Date;
  /** Model version used */
  modelVersion: string;
}

/**
 * Red flag severity levels
 */
export enum RedFlagSeverity {
  LOW = 'LOW',
  MEDIUM = 'MEDIUM',
  HIGH = 'HIGH',
  CRITICAL = 'CRITICAL',
}

/**
 * Clinical red flag requiring attention
 */
export interface RedFlag {
  /** Severity level */
  severity: RedFlagSeverity;
  /** Description of the red flag */
  description: string;
  /** Source text that triggered the flag */
  sourceText?: string;
  /** Recommended action */
  recommendedAction?: string;
  /** Category (vital signs, symptoms, medications, etc.) */
  category: string;
  /** Confidence score */
  confidence: number;
}

/**
 * Care plan recommendation from ML service
 */
export interface CarePlanRecommendation {
  /** Template ID */
  templateId: string;
  /** Template title */
  title: string;
  /** Match confidence score 0-1 */
  confidence: number;
  /** Condition codes that matched */
  matchedConditions: string[];
  /** Explanation of why this template was recommended */
  reasoning?: string;
  /** Guideline source */
  guidelineSource?: string;
  /** Evidence grade */
  evidenceGrade?: string;
}

/**
 * Draft goal for care plan
 */
export interface DraftGoal {
  /** Goal description */
  description: string;
  /** Target value if applicable */
  targetValue?: string;
  /** Target date */
  targetDate?: Date;
  /** Priority level */
  priority: 'HIGH' | 'MEDIUM' | 'LOW';
  /** Source guideline reference */
  guidelineReference?: string;
}

/**
 * Draft intervention for care plan
 */
export interface DraftIntervention {
  /** Intervention type */
  type: 'MEDICATION' | 'PROCEDURE' | 'LIFESTYLE' | 'MONITORING' | 'REFERRAL' | 'EDUCATION' | 'FOLLOW_UP';
  /** Description */
  description: string;
  /** Medication code if applicable */
  medicationCode?: string;
  /** Dosage if applicable */
  dosage?: string;
  /** Frequency if applicable */
  frequency?: string;
  /** Procedure code if applicable */
  procedureCode?: string;
  /** Scheduled date */
  scheduledDate?: Date;
  /** Patient instructions */
  patientInstructions?: string;
  /** Source guideline reference */
  guidelineReference?: string;
}

/**
 * Draft care plan generated from recommendations
 */
export interface DraftCarePlan {
  /** Draft ID */
  id: string;
  /** Care plan title */
  title: string;
  /** Condition codes */
  conditionCodes: string[];
  /** Template ID if based on template */
  templateId?: string;
  /** Draft goals */
  goals: DraftGoal[];
  /** Draft interventions */
  interventions: DraftIntervention[];
  /** Generated at timestamp */
  generatedAt: Date;
  /** Confidence score for overall draft */
  confidence: number;
  /** Whether manual review is recommended */
  requiresReview: boolean;
}

/**
 * Pipeline stage identifiers
 */
export enum PipelineStage {
  VALIDATION = 'VALIDATION',
  ENTITY_EXTRACTION = 'ENTITY_EXTRACTION',
  EMBEDDING_GENERATION = 'EMBEDDING_GENERATION',
  TEMPLATE_RECOMMENDATION = 'TEMPLATE_RECOMMENDATION',
  DRAFT_GENERATION = 'DRAFT_GENERATION',
  SAFETY_VALIDATION = 'SAFETY_VALIDATION',
}

/**
 * Stage execution status
 */
export enum StageStatus {
  PENDING = 'PENDING',
  IN_PROGRESS = 'IN_PROGRESS',
  COMPLETED = 'COMPLETED',
  SKIPPED = 'SKIPPED',
  FAILED = 'FAILED',
}

/**
 * Individual stage result
 */
export interface StageResult {
  /** Stage identifier */
  stage: PipelineStage;
  /** Execution status */
  status: StageStatus;
  /** Duration in milliseconds */
  durationMs: number;
  /** Error message if failed */
  error?: string;
  /** Whether cache was used */
  cacheHit?: boolean;
}

/**
 * Processing metadata for the pipeline
 */
export interface ProcessingMetadata {
  /** Unique request ID */
  requestId: string;
  /** Correlation ID for tracing */
  correlationId: string;
  /** Total processing time in ms */
  totalDurationMs: number;
  /** Results per stage */
  stageResults: StageResult[];
  /** Whether any cache was hit */
  cacheHit: boolean;
  /** Model versions used */
  modelVersions: Record<string, string>;
  /** Processing timestamp */
  processedAt: Date;
}

/**
 * Pipeline output result
 */
export interface PipelineOutput {
  /** Unique request ID */
  requestId: string;
  /** Extracted entities (if transcript provided) */
  extractedEntities?: ExtractedEntities;
  /** Care plan recommendations */
  recommendations: CarePlanRecommendation[];
  /** Draft care plan (if requested) */
  draftCarePlan?: DraftCarePlan;
  /** Clinical red flags */
  redFlags: RedFlag[];
  /** Processing metadata */
  processingMetadata: ProcessingMetadata;
  /** Services that degraded or failed */
  degradedServices: string[];
  /** Whether result requires manual review */
  requiresManualReview: boolean;
}

/**
 * Pipeline error categories
 */
export enum PipelineErrorCategory {
  VALIDATION_FAILED = 'VALIDATION_FAILED',
  EXTRACTION_FAILED = 'EXTRACTION_FAILED',
  EMBEDDING_FAILED = 'EMBEDDING_FAILED',
  RECOMMENDATION_FAILED = 'RECOMMENDATION_FAILED',
  DRAFT_GENERATION_FAILED = 'DRAFT_GENERATION_FAILED',
  SERVICE_UNAVAILABLE = 'SERVICE_UNAVAILABLE',
  AUTHENTICATION_FAILED = 'AUTHENTICATION_FAILED',
  AUTHORIZATION_FAILED = 'AUTHORIZATION_FAILED',
  RATE_LIMITED = 'RATE_LIMITED',
  TIMEOUT = 'TIMEOUT',
  INTERNAL_ERROR = 'INTERNAL_ERROR',
}

/**
 * Error severity levels
 */
export enum ErrorSeverity {
  /** Can continue with fallback */
  RECOVERABLE = 'RECOVERABLE',
  /** Can continue with reduced functionality */
  DEGRADED = 'DEGRADED',
  /** Must abort pipeline */
  FATAL = 'FATAL',
}

/**
 * Pipeline error with context
 */
export interface PipelineError {
  /** Error category */
  category: PipelineErrorCategory;
  /** Severity level */
  severity: ErrorSeverity;
  /** Error message (sanitized, no PHI) */
  message: string;
  /** Stage where error occurred */
  stage: PipelineStage;
  /** Correlation ID for tracing */
  correlationId: string;
  /** Timestamp */
  timestamp: Date;
  /** Whether fallback was used */
  fallbackUsed?: boolean;
  /** Retry count if retried */
  retryCount?: number;
}

/**
 * Service criticality levels
 */
export enum ServiceCriticality {
  /** Must succeed, no fallback available */
  CRITICAL = 'CRITICAL',
  /** Should succeed, fallback available */
  IMPORTANT = 'IMPORTANT',
  /** Best effort only */
  NICE_TO_HAVE = 'NICE_TO_HAVE',
}

/**
 * Service health for pipeline
 */
export interface PipelineServiceHealth {
  /** Service name */
  service: string;
  /** Whether service is healthy */
  healthy: boolean;
  /** Circuit breaker state */
  circuitState: 'CLOSED' | 'OPEN' | 'HALF_OPEN';
  /** Last successful call timestamp */
  lastSuccess?: Date;
  /** Last error message */
  lastError?: string;
}

/**
 * Create a new request ID
 */
export function createRequestId(): string {
  return uuidv4();
}

/**
 * Validate pipeline input
 */
export function validatePipelineInput(input: Partial<PipelineInput>): input is PipelineInput {
  if (!input.visitId || typeof input.visitId !== 'string') return false;
  if (!input.patientId || typeof input.patientId !== 'string') return false;
  if (!input.idempotencyKey || typeof input.idempotencyKey !== 'string') return false;
  if (!input.correlationId || typeof input.correlationId !== 'string') return false;
  if (!input.userId || typeof input.userId !== 'string') return false;
  if (!input.userRole || typeof input.userRole !== 'string') return false;
  if (!Array.isArray(input.conditionCodes)) return false;
  return true;
}
