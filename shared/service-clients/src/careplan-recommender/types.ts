/**
 * Care Plan Recommender Service Types
 *
 * TypeScript interfaces matching prism-ml-infra/src/careplan_recommender/api/schemas.py
 */

/**
 * Patient demographics for context
 */
export interface PatientDemographics {
  age?: number;
  sex?: 'M' | 'F';
  race?: string;
  ethnicity?: string;
}

/**
 * Simple recommendation request (codes only)
 */
export interface SimpleRecommendRequest {
  /** ICD-10 diagnosis codes */
  conditionCodes: string[];
  /** Maximum number of results (1-20) */
  maxResults?: number;
  /** Include draft care plans */
  includeDrafts?: boolean;
}

/**
 * Full context recommendation request
 */
export interface FullContextRequest {
  /** ICD-10 diagnosis codes */
  conditionCodes: string[];
  /** Human-readable condition names */
  conditionNames?: string[];
  /** RxNorm medication codes */
  medicationCodes?: string[];
  /** Medication names */
  medicationNames?: string[];
  /** LOINC lab codes */
  labCodes?: string[];
  /** Lab values by code/name */
  labValues?: Record<string, number | string>;
  /** Patient demographics */
  demographics?: PatientDemographics;
  /** Risk factors */
  riskFactors?: string[];
  /** Complications */
  complications?: string[];
  /** Maximum results */
  maxResults?: number;
  /** Include drafts */
  includeDrafts?: boolean;
}

/**
 * Engine recommendation request (three-layer engine)
 */
export interface EngineRecommendRequest extends FullContextRequest {
  /** Query mode */
  queryMode?: 'simple' | 'full' | 'hybrid';
  /** Enable personalization */
  enablePersonalization?: boolean;
  /** Provider preferences */
  providerPreferences?: {
    providerId: string;
    preferredTemplateIds?: string[];
  };
}

/**
 * Match factors explaining why a template matched
 */
export interface MatchFactors {
  conditionMatch: number;
  medicationMatch?: number;
  labMatch?: number;
  demographicMatch?: number;
  historicalPreference?: number;
}

/**
 * Template recommendation result
 */
export interface TemplateRecommendation {
  /** Template ID */
  templateId: string;
  /** Template name */
  name: string;
  /** Template category */
  category: string;
  /** Condition codes addressed */
  conditionCodes: string[];
  /** Similarity score (embedding-based) */
  similarityScore: number;
  /** Ranking score (ML-based) */
  rankingScore: number;
  /** Overall confidence (0-1) */
  confidence: number;
  /** Factors that contributed to match */
  matchFactors: MatchFactors;
}

/**
 * Draft goal suggestion
 */
export interface DraftGoal {
  /** Goal description */
  description: string;
  /** Target value */
  targetValue?: string;
  /** Target days */
  targetDays?: number;
  /** Priority */
  priority: 'HIGH' | 'MEDIUM' | 'LOW';
  /** Confidence score */
  confidence?: number;
}

/**
 * Draft intervention suggestion
 */
export interface DraftIntervention {
  /** Intervention description */
  description: string;
  /** Intervention type */
  type: string;
  /** Medication code */
  medicationCode?: string;
  /** Procedure code */
  procedureCode?: string;
  /** Dosage */
  dosage?: string;
  /** Frequency */
  frequency?: string;
  /** Referral specialty */
  referralSpecialty?: string;
  /** Schedule days */
  scheduleDays?: number;
  /** Patient instructions */
  instructions?: string;
  /** Confidence score */
  confidence?: number;
}

/**
 * Generated draft care plan
 */
export interface DraftCarePlan {
  /** Plan title */
  title: string;
  /** Condition codes addressed */
  conditionCodes: string[];
  /** Suggested goals */
  goals: DraftGoal[];
  /** Suggested interventions */
  interventions: DraftIntervention[];
  /** Overall confidence score */
  confidenceScore: number;
  /** How the draft was generated */
  generationMethod: string;
}

/**
 * Recommendation response
 */
export interface RecommendResponse {
  /** Matched templates */
  templates: TemplateRecommendation[];
  /** Generated draft plans */
  drafts: DraftCarePlan[];
  /** Processing time in ms */
  processingTimeMs: number;
  /** Model version used */
  modelVersion: string;
  /** Query mode used */
  queryMode: string;
}

/**
 * Training job status
 */
export enum TrainingJobStatus {
  PENDING = 'PENDING',
  RUNNING = 'RUNNING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
  CANCELLED = 'CANCELLED',
}

/**
 * Training job response
 */
export interface TrainingJobResponse {
  /** Job ID */
  id: string;
  /** Model type */
  modelType: string;
  /** Job name */
  jobName?: string;
  /** Status */
  status: TrainingJobStatus;
  /** Progress percentage (0-100) */
  progressPercent: number;
  /** Status message */
  statusMessage?: string;
  /** Training metrics */
  metrics?: Record<string, number>;
  /** Model path */
  modelPath?: string;
  /** Model version */
  modelVersion?: string;
  /** Training examples count */
  trainingExamplesCount?: number;
  /** Started at */
  startedAt?: Date;
  /** Completed at */
  completedAt?: Date;
  /** Created at */
  createdAt: Date;
}

/**
 * Health check response
 */
export interface RecommenderHealthResponse {
  status: string;
  version: string;
  modelsLoaded: boolean;
  rankingModelReady: boolean;
  embeddingsServiceHealthy: boolean;
}

/**
 * Fallback recommendation response
 */
export const FALLBACK_RECOMMEND_RESPONSE: RecommendResponse = {
  templates: [],
  drafts: [],
  processingTimeMs: 0,
  modelVersion: 'fallback',
  queryMode: 'fallback',
};
