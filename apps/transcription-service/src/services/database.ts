import { Pool } from 'pg';
import { Redis } from 'ioredis';
import { v4 as uuidv4 } from 'uuid';

// Types
export enum TranscriptionStatus {
  PENDING = 'PENDING',
  PROCESSING = 'PROCESSING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
  CANCELLED = 'CANCELLED'
}

export enum EntityType {
  MEDICATION = 'MEDICATION',
  SYMPTOM = 'SYMPTOM',
  VITAL_SIGN = 'VITAL_SIGN',
  ALLERGY = 'ALLERGY',
  PROCEDURE = 'PROCEDURE',
  CONDITION = 'CONDITION',
  TEMPORAL = 'TEMPORAL'
}

export enum SpeakerRole {
  CLINICIAN = 'CLINICIAN',
  PATIENT = 'PATIENT',
  FAMILY_MEMBER = 'FAMILY_MEMBER',
  OTHER = 'OTHER'
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

// Database connection - these will be injected
let pool: Pool;
let redis: Redis;

export function initializeDatabase(dbPool: Pool, redisClient: Redis) {
  pool = dbPool;
  redis = redisClient;
}

// Helper function to ensure database is initialized
function ensureInitialized() {
  if (!pool || !redis) {
    throw new Error('Database not initialized. Call initializeDatabase() first.');
  }
}

// Transcription Service
class TranscriptionService {
  async submitTranscription(data: {
    patientId: string;
    encounterId?: string;
    audioUri: string;
    speakerCount?: number;
    vocabularyHints?: string[];
    createdBy: string;
  }): Promise<Transcription> {
    ensureInitialized();
    const id = uuidv4();

    const query = `
      INSERT INTO transcriptions (id, patient_id, encounter_id, audio_uri, status, created_by)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id, patient_id as "patientId", encounter_id as "encounterId",
                audio_uri as "audioUri", audio_duration_seconds as "audioDurationSeconds",
                status, processing_started_at as "processingStartedAt",
                processing_completed_at as "processingCompletedAt",
                error_message as "errorMessage",
                created_at as "createdAt", created_by as "createdBy", updated_at as "updatedAt"
    `;

    try {
      const result = await pool.query(query, [
        id,
        data.patientId,
        data.encounterId || null,
        data.audioUri,
        TranscriptionStatus.PENDING,
        data.createdBy
      ]);

      return result.rows[0];
    } catch (error: any) {
      if (error.code === '23503') {
        throw new Error('Foreign key constraint: Invalid patient reference');
      }
      throw error;
    }
  }

  async getTranscriptionById(id: string): Promise<TranscriptionWithResults | null> {
    ensureInitialized();
    // Check cache first
    const cacheKey = `transcription:${id}`;
    const cached = await redis.get(cacheKey);
    if (cached) {
      return JSON.parse(cached);
    }

    const query = `
      SELECT id, patient_id as "patientId", encounter_id as "encounterId",
             audio_uri as "audioUri", audio_duration_seconds as "audioDurationSeconds",
             status, processing_started_at as "processingStartedAt",
             processing_completed_at as "processingCompletedAt",
             error_message as "errorMessage",
             transcript_full_text as "transcriptFullText",
             transcript_confidence_score as "transcriptConfidenceScore",
             transcript_word_error_rate as "transcriptWordErrorRate",
             created_at as "createdAt", created_by as "createdBy", updated_at as "updatedAt"
      FROM transcriptions
      WHERE id = $1
    `;

    try {
      const result = await pool.query(query, [id]);
      if (!result.rows[0]) {
        return null;
      }

      const transcription = result.rows[0];

      // Get segments if transcript exists
      let transcript: TranscriptResult | undefined;
      if (transcription.transcriptFullText) {
        const segmentsResult = await pool.query(
          `SELECT id, speaker, speaker_label as "speakerLabel", text,
                  start_time_ms as "startTimeMs", end_time_ms as "endTimeMs", confidence
           FROM transcript_segments WHERE transcription_id = $1 ORDER BY start_time_ms`,
          [id]
        );

        transcript = {
          fullText: transcription.transcriptFullText,
          segments: segmentsResult.rows,
          confidenceScore: transcription.transcriptConfidenceScore || 0,
          wordErrorRate: transcription.transcriptWordErrorRate
        };
      }

      // Get extracted entities
      const entitiesResult = await pool.query(
        `SELECT id, entity_type as "entityType", text, start_offset as "startOffset",
                end_offset as "endOffset", confidence, normalized_code as "normalizedCode",
                normalized_system as "normalizedSystem", normalized_display as "normalizedDisplay"
         FROM extracted_entities WHERE transcription_id = $1`,
        [id]
      );

      const result_obj: TranscriptionWithResults = {
        id: transcription.id,
        patientId: transcription.patientId,
        encounterId: transcription.encounterId,
        audioUri: transcription.audioUri,
        audioDurationSeconds: transcription.audioDurationSeconds,
        status: transcription.status,
        processingStartedAt: transcription.processingStartedAt,
        processingCompletedAt: transcription.processingCompletedAt,
        errorMessage: transcription.errorMessage,
        createdAt: transcription.createdAt,
        createdBy: transcription.createdBy,
        updatedAt: transcription.updatedAt,
        transcript,
        entities: entitiesResult.rows
      };

      // Cache for 5 minutes if completed
      if (transcription.status === TranscriptionStatus.COMPLETED) {
        await redis.setex(cacheKey, 300, JSON.stringify(result_obj));
      }

      return result_obj;
    } catch (error) {
      console.error('Error getting transcription:', error);
      return null;
    }
  }

  async getTranscriptionsForPatient(
    patientId: string,
    options: { status?: TranscriptionStatus; first?: number; after?: string } = {}
  ): Promise<{ transcriptions: TranscriptionWithResults[]; hasNextPage: boolean; totalCount: number }> {
    ensureInitialized();
    const { status, first = 50, after } = options;

    let query = `
      SELECT id, patient_id as "patientId", encounter_id as "encounterId",
             audio_uri as "audioUri", audio_duration_seconds as "audioDurationSeconds",
             status, processing_started_at as "processingStartedAt",
             processing_completed_at as "processingCompletedAt",
             error_message as "errorMessage",
             created_at as "createdAt", created_by as "createdBy", updated_at as "updatedAt"
      FROM transcriptions
      WHERE patient_id = $1
    `;

    const params: any[] = [patientId];
    let paramIndex = 2;

    if (status) {
      query += ` AND status = $${paramIndex}`;
      params.push(status);
      paramIndex++;
    }

    if (after) {
      // Decode cursor (base64 encoded createdAt + id)
      const decoded = Buffer.from(after, 'base64').toString('utf8');
      const [cursorDate, cursorId] = decoded.split('|');
      query += ` AND (created_at, id) < ($${paramIndex}, $${paramIndex + 1})`;
      params.push(cursorDate, cursorId);
      paramIndex += 2;
    }

    query += ` ORDER BY created_at DESC, id DESC LIMIT $${paramIndex}`;
    params.push(first + 1); // Fetch one extra to check hasNextPage

    try {
      const result = await pool.query(query, params);
      const hasNextPage = result.rows.length > first;
      const transcriptions = result.rows.slice(0, first);

      // Get total count
      let countQuery = `SELECT COUNT(*) FROM transcriptions WHERE patient_id = $1`;
      const countParams: any[] = [patientId];
      if (status) {
        countQuery += ` AND status = $2`;
        countParams.push(status);
      }
      const countResult = await pool.query(countQuery, countParams);
      const totalCount = parseInt(countResult.rows[0].count);

      // Fetch entities for each transcription (stub - returns empty for now)
      const transcriptionsWithResults: TranscriptionWithResults[] = transcriptions.map(t => ({
        ...t,
        entities: []
      }));

      return { transcriptions: transcriptionsWithResults, hasNextPage, totalCount };
    } catch (error) {
      console.error('Error getting transcriptions for patient:', error);
      return { transcriptions: [], hasNextPage: false, totalCount: 0 };
    }
  }

  async getTranscriptionsForEncounter(encounterId: string): Promise<TranscriptionWithResults[]> {
    ensureInitialized();

    const query = `
      SELECT id, patient_id as "patientId", encounter_id as "encounterId",
             audio_uri as "audioUri", audio_duration_seconds as "audioDurationSeconds",
             status, processing_started_at as "processingStartedAt",
             processing_completed_at as "processingCompletedAt",
             error_message as "errorMessage",
             created_at as "createdAt", created_by as "createdBy", updated_at as "updatedAt"
      FROM transcriptions
      WHERE encounter_id = $1
      ORDER BY created_at DESC
    `;

    try {
      const result = await pool.query(query, [encounterId]);
      return result.rows.map(t => ({ ...t, entities: [] }));
    } catch (error) {
      console.error('Error getting transcriptions for encounter:', error);
      return [];
    }
  }

  async cancelTranscription(id: string): Promise<Transcription | null> {
    ensureInitialized();

    const query = `
      UPDATE transcriptions
      SET status = $1, updated_at = NOW()
      WHERE id = $2 AND status IN ('PENDING', 'PROCESSING')
      RETURNING id, patient_id as "patientId", encounter_id as "encounterId",
                audio_uri as "audioUri", audio_duration_seconds as "audioDurationSeconds",
                status, processing_started_at as "processingStartedAt",
                processing_completed_at as "processingCompletedAt",
                error_message as "errorMessage",
                created_at as "createdAt", created_by as "createdBy", updated_at as "updatedAt"
    `;

    try {
      const result = await pool.query(query, [TranscriptionStatus.CANCELLED, id]);
      if (result.rows[0]) {
        await redis.del(`transcription:${id}`);
      }
      return result.rows[0] || null;
    } catch (error) {
      console.error('Error cancelling transcription:', error);
      return null;
    }
  }

  async retryTranscription(id: string): Promise<Transcription | null> {
    ensureInitialized();

    const query = `
      UPDATE transcriptions
      SET status = $1, error_message = NULL, updated_at = NOW()
      WHERE id = $2 AND status = 'FAILED'
      RETURNING id, patient_id as "patientId", encounter_id as "encounterId",
                audio_uri as "audioUri", audio_duration_seconds as "audioDurationSeconds",
                status, processing_started_at as "processingStartedAt",
                processing_completed_at as "processingCompletedAt",
                error_message as "errorMessage",
                created_at as "createdAt", created_by as "createdBy", updated_at as "updatedAt"
    `;

    try {
      const result = await pool.query(query, [TranscriptionStatus.PENDING, id]);
      if (result.rows[0]) {
        await redis.del(`transcription:${id}`);
      }
      return result.rows[0] || null;
    } catch (error) {
      console.error('Error retrying transcription:', error);
      return null;
    }
  }

  async getTranscriptions(
    filter: {
      patientId?: string;
      encounterId?: string;
      status?: TranscriptionStatus;
      createdAfter?: Date;
      createdBefore?: Date;
    },
    pagination: { first?: number; after?: string } = {}
  ): Promise<{ transcriptions: TranscriptionWithResults[]; hasNextPage: boolean; totalCount: number }> {
    ensureInitialized();
    const { first = 50, after } = pagination;

    let query = `
      SELECT id, patient_id as "patientId", encounter_id as "encounterId",
             audio_uri as "audioUri", audio_duration_seconds as "audioDurationSeconds",
             status, processing_started_at as "processingStartedAt",
             processing_completed_at as "processingCompletedAt",
             error_message as "errorMessage",
             created_at as "createdAt", created_by as "createdBy", updated_at as "updatedAt"
      FROM transcriptions
      WHERE 1=1
    `;

    const params: any[] = [];
    let paramIndex = 1;

    if (filter.patientId) {
      query += ` AND patient_id = $${paramIndex}`;
      params.push(filter.patientId);
      paramIndex++;
    }

    if (filter.encounterId) {
      query += ` AND encounter_id = $${paramIndex}`;
      params.push(filter.encounterId);
      paramIndex++;
    }

    if (filter.status) {
      query += ` AND status = $${paramIndex}`;
      params.push(filter.status);
      paramIndex++;
    }

    if (filter.createdAfter) {
      query += ` AND created_at >= $${paramIndex}`;
      params.push(filter.createdAfter);
      paramIndex++;
    }

    if (filter.createdBefore) {
      query += ` AND created_at <= $${paramIndex}`;
      params.push(filter.createdBefore);
      paramIndex++;
    }

    if (after) {
      const decoded = Buffer.from(after, 'base64').toString('utf8');
      const [cursorDate, cursorId] = decoded.split('|');
      query += ` AND (created_at, id) < ($${paramIndex}, $${paramIndex + 1})`;
      params.push(cursorDate, cursorId);
      paramIndex += 2;
    }

    // Count query
    const countQuery = query.replace(/SELECT .* FROM/, 'SELECT COUNT(*) FROM').split('ORDER BY')[0];

    query += ` ORDER BY created_at DESC, id DESC LIMIT $${paramIndex}`;
    params.push(first + 1);

    try {
      const result = await pool.query(query, params);
      const countResult = await pool.query(countQuery, params.slice(0, -1));

      const hasNextPage = result.rows.length > first;
      const transcriptions = result.rows.slice(0, first).map(t => ({ ...t, entities: [] }));
      const totalCount = parseInt(countResult.rows[0].count);

      return { transcriptions, hasNextPage, totalCount };
    } catch (error) {
      console.error('Error getting transcriptions:', error);
      return { transcriptions: [], hasNextPage: false, totalCount: 0 };
    }
  }
}

// Export service instance
export const transcriptionService = new TranscriptionService();
