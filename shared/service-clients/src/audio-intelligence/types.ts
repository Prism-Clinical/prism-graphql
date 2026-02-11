/**
 * Audio Intelligence Service Types
 *
 * TypeScript interfaces matching prism-ml-infra/src/audio_intelligence/api/schemas.py
 */

/**
 * NLU processing tiers
 */
export enum NLUTier {
  AUTO = 'AUTO',
  TIER1 = 'TIER1',
  TIER2 = 'TIER2',
  TIER3 = 'TIER3',
}

/**
 * Transcript speaker segment
 */
export interface SpeakerSegment {
  speaker: string;
  text: string;
  startTime?: number;
  endTime?: number;
}

/**
 * Request for entity extraction from transcript
 */
export interface ExtractionRequest {
  /** Full transcript text (max 100KB) */
  transcriptText: string;
  /** Optional transcript ID */
  transcriptId?: string;
  /** Optional encounter/visit ID */
  encounterId?: string;
  /** Force specific NLU tier */
  forceTier?: NLUTier;
  /** Speaker-segmented transcript */
  speakerSegments?: SpeakerSegment[];
  /** Enable pattern detection modules */
  runPatterns?: boolean;
}

/**
 * Request for batch transcript processing
 */
export interface BatchExtractionRequest {
  /** List of extraction requests (1-100) */
  transcripts: ExtractionRequest[];
  /** Maximum concurrent processing (1-20) */
  maxConcurrent?: number;
}

/**
 * Request for speech-to-text transcription
 */
export interface TranscriptionRequest {
  /** Audio file URI (gs://, s3://, https://) */
  audioUri: string;
  /** Unique transcription ID */
  transcriptionId: string;
  /** Patient identifier */
  patientId: string;
  /** Optional encounter/visit ID */
  encounterId?: string;
  /** Enable speaker diarization */
  enableDiarization?: boolean;
  /** Expected number of speakers */
  speakerCount?: number;
  /** Medical vocabulary hints for boost */
  vocabularyHints?: string[];
  /** Run NER after transcription */
  runNer?: boolean;
  /** Webhook URL for async completion */
  callbackUrl?: string;
}

/**
 * Extracted entity response
 */
export interface EntityResponse {
  /** Entity text as extracted */
  text: string;
  /** Entity type (symptom, medication, vital, etc.) */
  type: string;
  /** SNOMED normalized code */
  snomedCode?: string;
  /** SNOMED display text */
  snomedDisplay?: string;
  /** Confidence score (0-1) */
  confidence: number;
  /** Character offset start */
  startOffset?: number;
  /** Character offset end */
  endOffset?: number;
  /** Negation status */
  negated?: boolean;
  /** Additional attributes */
  attributes?: Record<string, unknown>;
}

/**
 * Pattern match response
 */
export interface PatternMatchResponse {
  /** Pattern name */
  patternName: string;
  /** Pattern category */
  category: string;
  /** Matched text */
  matchedText: string;
  /** Confidence score (0-1) */
  confidence: number;
  /** Pattern-specific data */
  data?: Record<string, unknown>;
}

/**
 * Red flag alert
 */
export interface RedFlagResponse {
  /** Severity level */
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  /** Red flag description */
  description: string;
  /** Source text from transcript */
  sourceText?: string;
  /** Recommended action */
  recommendedAction?: string;
  /** Related entity */
  relatedEntity?: EntityResponse;
}

/**
 * Full extraction response
 */
export interface ExtractionResponse {
  /** Extracted symptoms */
  symptoms: EntityResponse[];
  /** Extracted medications */
  medications: EntityResponse[];
  /** Extracted vitals */
  vitals: EntityResponse[];
  /** Red flag alerts */
  redFlags: RedFlagResponse[];
  /** Pattern matches */
  patternMatches: PatternMatchResponse[];
  /** NLU tier used */
  nluTier: NLUTier;
  /** Processing time in seconds */
  processingTimeSeconds: number;
  /** Estimated cost in USD */
  estimatedCostUsd: number;
  /** Whether red flags were detected */
  hasRedFlags: boolean;
  /** Clinical disclaimer */
  disclaimer: string;
}

/**
 * Batch extraction response
 */
export interface BatchExtractionResponse {
  /** Individual results */
  results: ExtractionResponse[];
  /** Total count */
  totalCount: number;
  /** Successful extractions */
  successCount: number;
  /** Failed extractions */
  errorCount: number;
  /** Total cost in USD */
  totalCostUsd: number;
  /** Total processing time in seconds */
  totalProcessingTimeSeconds: number;
}

/**
 * Transcript segment from STT
 */
export interface TranscriptSegment {
  /** Segment text */
  text: string;
  /** Speaker ID */
  speaker?: string;
  /** Start time in seconds */
  startTime: number;
  /** End time in seconds */
  endTime: number;
  /** Confidence score (0-1) */
  confidence: number;
}

/**
 * Transcription status
 */
export enum TranscriptionStatus {
  PROCESSING = 'PROCESSING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
}

/**
 * STT + NER transcription response
 */
export interface TranscriptionResponse {
  /** Transcription ID */
  transcriptionId: string;
  /** Processing status */
  status: TranscriptionStatus;
  /** Full transcript text */
  fullText?: string;
  /** Audio duration in seconds */
  audioDurationSeconds?: number;
  /** Overall confidence score (0-1) */
  confidenceScore?: number;
  /** Transcript segments */
  segments?: TranscriptSegment[];
  /** Extracted entities (if NER enabled) */
  entities?: EntityResponse[];
  /** Processing time in seconds */
  processingTimeSeconds?: number;
  /** Error message if failed */
  errorMessage?: string;
}

/**
 * Health check response
 */
export interface AudioIntelligenceHealthResponse {
  status: string;
  version: string;
  modelsLoaded?: boolean;
}

/**
 * Fallback extraction response for degraded mode
 */
export const FALLBACK_EXTRACTION_RESPONSE: ExtractionResponse = {
  symptoms: [],
  medications: [],
  vitals: [],
  redFlags: [],
  patternMatches: [],
  nluTier: NLUTier.AUTO,
  processingTimeSeconds: 0,
  estimatedCostUsd: 0,
  hasRedFlags: false,
  disclaimer: 'Service unavailable - requires manual clinical review',
};
