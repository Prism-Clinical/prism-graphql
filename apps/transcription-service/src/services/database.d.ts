import { Pool } from 'pg';
import { Redis } from 'ioredis';
export declare enum TranscriptionStatus {
    PENDING = "PENDING",
    PROCESSING = "PROCESSING",
    COMPLETED = "COMPLETED",
    FAILED = "FAILED",
    CANCELLED = "CANCELLED"
}
export declare enum EntityType {
    MEDICATION = "MEDICATION",
    SYMPTOM = "SYMPTOM",
    VITAL_SIGN = "VITAL_SIGN",
    ALLERGY = "ALLERGY",
    PROCEDURE = "PROCEDURE",
    CONDITION = "CONDITION",
    TEMPORAL = "TEMPORAL"
}
export declare enum SpeakerRole {
    CLINICIAN = "CLINICIAN",
    PATIENT = "PATIENT",
    FAMILY_MEMBER = "FAMILY_MEMBER",
    OTHER = "OTHER"
}
export interface Transcription {
    id: string;
    patientId: string;
    encounterId?: string;
    audioUri: string;
    audioDurationSeconds?: number;
    status: TranscriptionStatus;
    processingStartedAt?: Date;
    processingCompletedAt?: Date;
    errorMessage?: string;
    createdAt: Date;
    createdBy: string;
    updatedAt: Date;
}
export interface TranscriptResult {
    fullText: string;
    segments: TranscriptSegment[];
    confidenceScore: number;
    wordErrorRate?: number;
}
export interface TranscriptSegment {
    id: string;
    speaker: SpeakerRole;
    speakerLabel?: string;
    text: string;
    startTimeMs: number;
    endTimeMs: number;
    confidence: number;
}
export interface ExtractedEntity {
    id: string;
    entityType: EntityType;
    text: string;
    startOffset: number;
    endOffset: number;
    confidence: number;
    normalizedCode?: string;
    normalizedSystem?: string;
    normalizedDisplay?: string;
}
export interface TranscriptionWithResults extends Transcription {
    transcript?: TranscriptResult;
    entities: ExtractedEntity[];
}
export declare function initializeDatabase(dbPool: Pool, redisClient: Redis): void;
declare class TranscriptionService {
    submitTranscription(data: {
        patientId: string;
        encounterId?: string;
        audioUri: string;
        speakerCount?: number;
        vocabularyHints?: string[];
        createdBy: string;
    }): Promise<Transcription>;
    getTranscriptionById(id: string): Promise<TranscriptionWithResults | null>;
    getTranscriptionsForPatient(patientId: string, options?: {
        status?: TranscriptionStatus;
        first?: number;
        after?: string;
    }): Promise<{
        transcriptions: TranscriptionWithResults[];
        hasNextPage: boolean;
        totalCount: number;
    }>;
    getTranscriptionsForEncounter(encounterId: string): Promise<TranscriptionWithResults[]>;
    cancelTranscription(id: string): Promise<Transcription | null>;
    retryTranscription(id: string): Promise<Transcription | null>;
    getTranscriptions(filter: {
        patientId?: string;
        encounterId?: string;
        status?: TranscriptionStatus;
        createdAfter?: Date;
        createdBefore?: Date;
    }, pagination?: {
        first?: number;
        after?: string;
    }): Promise<{
        transcriptions: TranscriptionWithResults[];
        hasNextPage: boolean;
        totalCount: number;
    }>;
}
export declare const transcriptionService: TranscriptionService;
export {};
//# sourceMappingURL=database.d.ts.map