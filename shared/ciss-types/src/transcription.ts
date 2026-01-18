/**
 * Transcription Service Types
 *
 * Types for the transcription-service domain.
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
 * Transcription processing status
 */
export enum TranscriptionStatus {
  PENDING = 'PENDING',
  PROCESSING = 'PROCESSING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
  CANCELLED = 'CANCELLED',
}

/**
 * Entity types that can be extracted from transcripts
 */
export enum EntityType {
  MEDICATION = 'MEDICATION',
  SYMPTOM = 'SYMPTOM',
  VITAL_SIGN = 'VITAL_SIGN',
  ALLERGY = 'ALLERGY',
  PROCEDURE = 'PROCEDURE',
  CONDITION = 'CONDITION',
  TEMPORAL = 'TEMPORAL',
}

/**
 * Speaker roles in a clinical conversation
 */
export enum SpeakerRole {
  CLINICIAN = 'CLINICIAN',
  PATIENT = 'PATIENT',
  FAMILY_MEMBER = 'FAMILY_MEMBER',
  OTHER = 'OTHER',
}

/**
 * A transcription record
 */
export interface Transcription
  extends BaseEntity,
    PatientEntity,
    EncounterEntity,
    AuditFields {
  audioUri: string;
  audioDurationSeconds?: number;
  status: TranscriptionStatus;
  processingStartedAt?: DateTime;
  processingCompletedAt?: DateTime;
  errorMessage?: string;
  createdBy: UUID;
}

/**
 * Full transcript result
 */
export interface TranscriptResult {
  fullText: string;
  segments: TranscriptSegment[];
  confidenceScore: number;
  wordErrorRate?: number;
}

/**
 * A segment of the transcript (speaker diarization)
 */
export interface TranscriptSegment extends BaseEntity {
  transcriptionId: UUID;
  speaker: SpeakerRole;
  speakerLabel?: string;
  text: string;
  startTimeMs: number;
  endTimeMs: number;
  confidence: number;
}

/**
 * An entity extracted from the transcript (NER result)
 */
export interface ExtractedEntity extends BaseEntity {
  transcriptionId: UUID;
  entityType: EntityType;
  text: string;
  startOffset: number;
  endOffset: number;
  confidence: number;
  normalizedCode?: string;
  normalizedSystem?: string;
  normalizedDisplay?: string;
}

/**
 * Input for submitting audio for transcription
 */
export interface TranscribeAudioInput {
  patientId: UUID;
  encounterId?: UUID;
  audioUri: string;
  speakerCount?: number;
  vocabularyHints?: string[];
}

/**
 * Filter input for querying transcriptions
 */
export interface TranscriptionFilterInput {
  patientId?: UUID;
  encounterId?: UUID;
  status?: TranscriptionStatus;
  createdAfter?: DateTime;
  createdBefore?: DateTime;
}

/**
 * Transcription connection type
 */
export type TranscriptionConnection = Connection<Transcription>;

/**
 * Database row type for transcriptions table
 */
export interface TranscriptionRow {
  id: string;
  patient_id: string;
  encounter_id: string | null;
  audio_uri: string;
  audio_duration_seconds: number | null;
  status: string;
  processing_started_at: Date | null;
  processing_completed_at: Date | null;
  error_message: string | null;
  transcript_full_text: string | null;
  transcript_confidence_score: number | null;
  transcript_word_error_rate: number | null;
  created_at: Date;
  created_by: string;
  updated_at: Date;
}

/**
 * Database row type for transcript_segments table
 */
export interface TranscriptSegmentRow {
  id: string;
  transcription_id: string;
  speaker: string;
  speaker_label: string | null;
  text: string;
  start_time_ms: number;
  end_time_ms: number;
  confidence: number;
  created_at: Date;
}

/**
 * Database row type for extracted_entities table
 */
export interface ExtractedEntityRow {
  id: string;
  transcription_id: string;
  entity_type: string;
  text: string;
  start_offset: number;
  end_offset: number;
  confidence: number;
  normalized_code: string | null;
  normalized_system: string | null;
  normalized_display: string | null;
  created_at: Date;
}
