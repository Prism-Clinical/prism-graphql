"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.transcriptionService = exports.SpeakerRole = exports.EntityType = exports.TranscriptionStatus = void 0;
exports.initializeDatabase = initializeDatabase;
const uuid_1 = require("uuid");
var TranscriptionStatus;
(function (TranscriptionStatus) {
    TranscriptionStatus["PENDING"] = "PENDING";
    TranscriptionStatus["PROCESSING"] = "PROCESSING";
    TranscriptionStatus["COMPLETED"] = "COMPLETED";
    TranscriptionStatus["FAILED"] = "FAILED";
    TranscriptionStatus["CANCELLED"] = "CANCELLED";
})(TranscriptionStatus || (exports.TranscriptionStatus = TranscriptionStatus = {}));
var EntityType;
(function (EntityType) {
    EntityType["MEDICATION"] = "MEDICATION";
    EntityType["SYMPTOM"] = "SYMPTOM";
    EntityType["VITAL_SIGN"] = "VITAL_SIGN";
    EntityType["ALLERGY"] = "ALLERGY";
    EntityType["PROCEDURE"] = "PROCEDURE";
    EntityType["CONDITION"] = "CONDITION";
    EntityType["TEMPORAL"] = "TEMPORAL";
})(EntityType || (exports.EntityType = EntityType = {}));
var SpeakerRole;
(function (SpeakerRole) {
    SpeakerRole["CLINICIAN"] = "CLINICIAN";
    SpeakerRole["PATIENT"] = "PATIENT";
    SpeakerRole["FAMILY_MEMBER"] = "FAMILY_MEMBER";
    SpeakerRole["OTHER"] = "OTHER";
})(SpeakerRole || (exports.SpeakerRole = SpeakerRole = {}));
let pool;
let redis;
function initializeDatabase(dbPool, redisClient) {
    pool = dbPool;
    redis = redisClient;
}
function ensureInitialized() {
    if (!pool || !redis) {
        throw new Error('Database not initialized. Call initializeDatabase() first.');
    }
}
class TranscriptionService {
    async submitTranscription(data) {
        ensureInitialized();
        const id = (0, uuid_1.v4)();
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
        }
        catch (error) {
            if (error.code === '23503') {
                throw new Error('Foreign key constraint: Invalid patient reference');
            }
            throw error;
        }
    }
    async getTranscriptionById(id) {
        ensureInitialized();
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
            let transcript;
            if (transcription.transcriptFullText) {
                const segmentsResult = await pool.query(`SELECT id, speaker, speaker_label as "speakerLabel", text,
                  start_time_ms as "startTimeMs", end_time_ms as "endTimeMs", confidence
           FROM transcript_segments WHERE transcription_id = $1 ORDER BY start_time_ms`, [id]);
                transcript = {
                    fullText: transcription.transcriptFullText,
                    segments: segmentsResult.rows,
                    confidenceScore: transcription.transcriptConfidenceScore || 0,
                    wordErrorRate: transcription.transcriptWordErrorRate
                };
            }
            const entitiesResult = await pool.query(`SELECT id, entity_type as "entityType", text, start_offset as "startOffset",
                end_offset as "endOffset", confidence, normalized_code as "normalizedCode",
                normalized_system as "normalizedSystem", normalized_display as "normalizedDisplay"
         FROM extracted_entities WHERE transcription_id = $1`, [id]);
            const result_obj = {
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
            if (transcription.status === TranscriptionStatus.COMPLETED) {
                await redis.setex(cacheKey, 300, JSON.stringify(result_obj));
            }
            return result_obj;
        }
        catch (error) {
            console.error('Error getting transcription:', error);
            return null;
        }
    }
    async getTranscriptionsForPatient(patientId, options = {}) {
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
        const params = [patientId];
        let paramIndex = 2;
        if (status) {
            query += ` AND status = $${paramIndex}`;
            params.push(status);
            paramIndex++;
        }
        if (after) {
            const decoded = Buffer.from(after, 'base64').toString('utf8');
            const [cursorDate, cursorId] = decoded.split('|');
            query += ` AND (created_at, id) < ($${paramIndex}, $${paramIndex + 1})`;
            params.push(cursorDate, cursorId);
            paramIndex += 2;
        }
        query += ` ORDER BY created_at DESC, id DESC LIMIT $${paramIndex}`;
        params.push(first + 1);
        try {
            const result = await pool.query(query, params);
            const hasNextPage = result.rows.length > first;
            const transcriptions = result.rows.slice(0, first);
            let countQuery = `SELECT COUNT(*) FROM transcriptions WHERE patient_id = $1`;
            const countParams = [patientId];
            if (status) {
                countQuery += ` AND status = $2`;
                countParams.push(status);
            }
            const countResult = await pool.query(countQuery, countParams);
            const totalCount = parseInt(countResult.rows[0].count);
            const transcriptionsWithResults = transcriptions.map(t => ({
                ...t,
                entities: []
            }));
            return { transcriptions: transcriptionsWithResults, hasNextPage, totalCount };
        }
        catch (error) {
            console.error('Error getting transcriptions for patient:', error);
            return { transcriptions: [], hasNextPage: false, totalCount: 0 };
        }
    }
    async getTranscriptionsForEncounter(encounterId) {
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
        }
        catch (error) {
            console.error('Error getting transcriptions for encounter:', error);
            return [];
        }
    }
    async cancelTranscription(id) {
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
        }
        catch (error) {
            console.error('Error cancelling transcription:', error);
            return null;
        }
    }
    async retryTranscription(id) {
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
        }
        catch (error) {
            console.error('Error retrying transcription:', error);
            return null;
        }
    }
    async getTranscriptions(filter, pagination = {}) {
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
        const params = [];
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
        }
        catch (error) {
            console.error('Error getting transcriptions:', error);
            return { transcriptions: [], hasNextPage: false, totalCount: 0 };
        }
    }
}
exports.transcriptionService = new TranscriptionService();
//# sourceMappingURL=database.js.map