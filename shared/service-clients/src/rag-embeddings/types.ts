/**
 * RAG Embeddings Service Types
 *
 * TypeScript interfaces matching prism-ml-infra/src/rag_embeddings/api/schemas.py
 */

/**
 * Embedding type/purpose
 */
export enum EmbeddingType {
  RAW_TEXT = 'raw_text',
  PATIENT_CONTEXT = 'patient_context',
  GUIDELINE = 'guideline',
  TEMPLATE = 'template',
}

/**
 * Evidence grade for guidelines
 */
export type EvidenceGrade = 'A' | 'B' | 'C' | 'D' | 'I';

/**
 * Guideline source
 */
export type GuidelineSource = 'USPSTF' | 'AHA' | 'ADA' | 'AAFP' | 'CDC' | 'NIH' | 'OTHER';

/**
 * Raw text embedding request
 */
export interface RawTextRequest {
  /** Text to embed (1-10K characters) */
  text: string;
}

/**
 * Patient clinical context request
 */
export interface PatientContextRequest {
  /** ICD-10 condition codes */
  conditionCodes: string[];
  /** Condition names */
  conditionNames?: string[];
  /** RxNorm medication codes */
  medicationCodes?: string[];
  /** Medication names */
  medicationNames?: string[];
  /** LOINC lab codes */
  labCodes?: string[];
  /** Lab names */
  labNames?: string[];
  /** Current symptoms */
  symptoms?: string[];
  /** Patient age (0-150) */
  age?: number;
  /** Patient sex */
  sex?: 'M' | 'F';
  /** SNOMED complication codes */
  complications?: string[];
  /** Risk factor identifiers */
  riskFactors?: string[];
}

/**
 * Guideline embedding request
 */
export interface GuidelineEmbedRequest {
  /** Guideline ID */
  id: string;
  /** Guideline title */
  title: string;
  /** Category */
  category?: string;
  /** Summary text */
  summaryText?: string;
  /** Applicable condition codes */
  applicableConditions?: string[];
  /** Applicable medication codes */
  applicableMedications?: string[];
  /** Evidence grade (A-D, I) */
  evidenceGrade?: EvidenceGrade;
  /** Guideline source */
  source?: GuidelineSource;
  /** Full guideline text */
  fullText?: string;
}

/**
 * Batch guideline request
 */
export interface BatchGuidelineRequest {
  /** Guidelines to embed (1-1000) */
  guidelines: GuidelineEmbedRequest[];
}

/**
 * Template embedding request
 */
export interface TemplateEmbedRequest {
  /** Template ID */
  id: string;
  /** Template name */
  name: string;
  /** Category */
  category?: string;
  /** Description */
  description?: string;
  /** Condition codes */
  conditionCodes?: string[];
  /** Goals */
  goals?: string[];
  /** Interventions */
  interventions?: string[];
}

/**
 * Batch template request
 */
export interface BatchTemplateRequest {
  /** Templates to embed (1-500) */
  templates: TemplateEmbedRequest[];
}

/**
 * Similarity search request
 */
export interface SimilaritySearchRequest {
  /** Query embedding vector */
  queryEmbedding: number[];
  /** Table to search */
  table: 'guidelines' | 'care_plan_templates';
  /** Maximum results (1-100) */
  limit?: number;
  /** Minimum similarity threshold (0-1) */
  minSimilarity?: number;
}

/**
 * Single embedding response
 */
export interface EmbeddingResponse {
  /** Embedding vector */
  embedding: number[];
  /** Vector dimension */
  dimension: number;
  /** Model used */
  model: string;
  /** Processing time in ms */
  processingTimeMs: number;
}

/**
 * Batch embedding response
 */
export interface BatchEmbeddingResponse {
  /** Embedding vectors */
  embeddings: number[][];
  /** Count of embeddings */
  count: number;
  /** Vector dimension */
  dimension: number;
  /** Model used */
  model: string;
  /** Processing time in ms */
  processingTimeMs: number;
}

/**
 * Guideline embedding result
 */
export interface GuidelineEmbeddingResult {
  /** Guideline ID */
  id: string;
  /** Embedding vector */
  embedding: number[];
  /** Whether successful */
  success: boolean;
  /** Error message if failed */
  error?: string;
}

/**
 * Batch guideline response
 */
export interface BatchGuidelineResponse {
  /** Results per guideline */
  results: GuidelineEmbeddingResult[];
  /** Success count */
  successCount: number;
  /** Error count */
  errorCount: number;
  /** Processing time in ms */
  processingTimeMs: number;
}

/**
 * Template embedding result
 */
export interface TemplateEmbeddingResult {
  /** Template ID */
  id: string;
  /** Embedding vector */
  embedding: number[];
  /** Whether successful */
  success: boolean;
  /** Error message if failed */
  error?: string;
}

/**
 * Batch template response
 */
export interface BatchTemplateResponse {
  /** Results per template */
  results: TemplateEmbeddingResult[];
  /** Success count */
  successCount: number;
  /** Error count */
  errorCount: number;
  /** Processing time in ms */
  processingTimeMs: number;
}

/**
 * Similarity search result
 */
export interface SimilarityResult {
  /** Item ID */
  id: string;
  /** Similarity score (0-1) */
  similarity: number;
  /** Item title */
  title?: string;
  /** Item category */
  category?: string;
  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Similarity search response
 */
export interface SimilaritySearchResponse {
  /** Search results */
  results: SimilarityResult[];
  /** Result count */
  count: number;
  /** Query time in ms */
  queryTimeMs: number;
}

/**
 * Health check response
 */
export interface RagHealthResponse {
  status: string;
  version: string;
  modelLoaded: boolean;
  embeddingDimension: number;
}

/**
 * Standard embedding dimension
 */
export const EMBEDDING_DIMENSION = 768;
