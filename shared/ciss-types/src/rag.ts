/**
 * RAG (Retrieval-Augmented Generation) Service Types
 *
 * Types for the rag-service domain including guidelines and synthesis.
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
 * Sources of clinical guidelines
 */
export enum GuidelineSource {
  USPSTF = 'USPSTF',
  AHA = 'AHA',
  ADA = 'ADA',
  ACOG = 'ACOG',
  AAP = 'AAP',
  CDC = 'CDC',
  WHO = 'WHO',
  CUSTOM = 'CUSTOM',
}

/**
 * Categories of guidelines
 */
export enum GuidelineCategory {
  SCREENING = 'SCREENING',
  PREVENTION = 'PREVENTION',
  TREATMENT = 'TREATMENT',
  MONITORING = 'MONITORING',
  LIFESTYLE = 'LIFESTYLE',
  IMMUNIZATION = 'IMMUNIZATION',
}

/**
 * Evidence grades (USPSTF style)
 */
export enum EvidenceGrade {
  A = 'A',
  B = 'B',
  C = 'C',
  D = 'D',
  I = 'I',
}

/**
 * Recommendation strength
 */
export enum RecommendationStrength {
  STRONG = 'STRONG',
  MODERATE = 'MODERATE',
  WEAK = 'WEAK',
  CONDITIONAL = 'CONDITIONAL',
}

/**
 * Types of RAG queries (structured, no free-text)
 */
export enum RAGQueryType {
  BY_CONDITION = 'BY_CONDITION',
  BY_MEDICATION = 'BY_MEDICATION',
  BY_DEMOGRAPHICS = 'BY_DEMOGRAPHICS',
  BY_GUIDELINE_ID = 'BY_GUIDELINE_ID',
}

/**
 * Status of a synthesis request
 */
export enum SynthesisStatus {
  PENDING = 'PENDING',
  PROCESSING = 'PROCESSING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
}

/**
 * A clinical guideline
 */
export interface Guideline extends BaseEntity {
  source: GuidelineSource;
  sourceId: string;
  title: string;
  category: GuidelineCategory;
  evidenceGrade?: EvidenceGrade;
  recommendationStrength?: RecommendationStrength;
  applicableConditions: string[];
  applicableMedications: string[];
  ageRangeMin?: number;
  ageRangeMax?: number;
  applicableSex?: string;
  summaryText: string;
  fullText?: string;
  publishedDate?: DateOnly;
  lastReviewedDate?: DateOnly;
  expirationDate?: DateOnly;
  version?: string;
  createdAt: DateTime;
  updatedAt: DateTime;
}

/**
 * A citation for a guideline
 */
export interface Citation extends BaseEntity {
  guidelineId: UUID;
  reference: string;
  url?: string;
  pubmedId?: string;
}

/**
 * A RAG synthesis result
 */
export interface RAGSynthesis extends BaseEntity, PatientEntity {
  queryType: RAGQueryType;
  queryConditionCodes?: string[];
  queryMedicationCodes?: string[];
  status: SynthesisStatus;
  processingTimeMs?: number;
  guidelinesConsulted?: number;
  createdAt: DateTime;
  createdBy: UUID;
}

/**
 * A synthesized recommendation from guidelines
 */
export interface SynthesizedRecommendation extends BaseEntity {
  ragSynthesisId: UUID;
  guidelineId: UUID;
  recommendationText: string;
  rationale: string;
  evidenceGrade?: EvidenceGrade;
  applicabilityScore: number;
}

/**
 * Factor affecting applicability
 */
export interface ApplicabilityFactor {
  factor: string;
  matched: boolean;
  details?: string;
}

/**
 * Input for filtering guidelines
 */
export interface GuidelineFilterInput {
  source?: GuidelineSource;
  category?: GuidelineCategory;
  evidenceGrade?: EvidenceGrade;
  conditionCode?: string;
  medicationCode?: string;
}

/**
 * Input for requesting a RAG synthesis
 */
export interface RAGQueryInput {
  patientId: UUID;
  queryType: RAGQueryType;
  conditionCodes?: string[];
  medicationCodes?: string[];
}

/**
 * Guideline connection type
 */
export type GuidelineConnection = Connection<Guideline>;

/**
 * Database row type for guidelines table
 */
export interface GuidelineRow {
  id: string;
  source: string;
  source_id: string;
  title: string;
  category: string;
  evidence_grade: string | null;
  recommendation_strength: string | null;
  applicable_conditions: string[];
  applicable_medications: string[];
  age_range_min: number | null;
  age_range_max: number | null;
  applicable_sex: string | null;
  summary_text: string;
  full_text: string | null;
  published_date: Date | null;
  last_reviewed_date: Date | null;
  expiration_date: Date | null;
  version: string | null;
  created_at: Date;
  updated_at: Date;
}

/**
 * Database row type for rag_syntheses table
 */
export interface RAGSynthesisRow {
  id: string;
  patient_id: string;
  query_type: string;
  query_condition_codes: string[];
  query_medication_codes: string[];
  status: string;
  processing_time_ms: number | null;
  guidelines_consulted: number | null;
  created_at: Date;
  created_by: string;
}
