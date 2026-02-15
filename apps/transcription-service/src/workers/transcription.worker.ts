/**
 * Transcription Worker
 *
 * BullMQ worker that processes transcription jobs by:
 * 1. Updating transcription status to PROCESSING
 * 2. Calling the ML service for STT + NER
 * 3. Saving results to PostgreSQL
 * 4. Updating status to COMPLETED or FAILED
 */

import { Worker, Job } from 'bullmq';
import { Redis } from 'ioredis';
import { Pool } from 'pg';
import {
  TranscriptionJobData,
  TranscriptionJobResult,
  TRANSCRIPTION_QUEUE_NAME,
} from '../services/transcription-queue';
import { MLClient, TranscribeResponse } from './ml-client';

// Worker configuration
const WORKER_CONCURRENCY = parseInt(process.env.WORKER_CONCURRENCY || '2');

/**
 * Create and start the transcription worker
 */
export function createTranscriptionWorker(
  redis: Redis,
  pool: Pool,
  mlClient: MLClient
): Worker<TranscriptionJobData, TranscriptionJobResult> {
  const worker = new Worker<TranscriptionJobData, TranscriptionJobResult>(
    TRANSCRIPTION_QUEUE_NAME,
    async (job: Job<TranscriptionJobData>) => {
      return processTranscriptionJob(job, pool, mlClient);
    },
    {
      connection: redis,
      concurrency: WORKER_CONCURRENCY,
      removeOnComplete: { count: 1000 },
      removeOnFail: { count: 5000 },
    }
  );

  // Event handlers
  worker.on('completed', (job, result) => {
    console.log(
      `Job ${job.id} completed: transcription ${result.transcriptionId} ` +
        `in ${result.processingTimeSeconds?.toFixed(1)}s`
    );
  });

  worker.on('failed', (job, err) => {
    console.error(`Job ${job?.id} failed:`, err.message);
  });

  worker.on('error', (err) => {
    console.error('Worker error:', err);
  });

  console.log(`Transcription worker started with concurrency ${WORKER_CONCURRENCY}`);

  return worker;
}

/**
 * Process a single transcription job
 */
async function processTranscriptionJob(
  job: Job<TranscriptionJobData>,
  pool: Pool,
  mlClient: MLClient
): Promise<TranscriptionJobResult> {
  const { transcriptionId, patientId, encounterId, audioUri, speakerCount, vocabularyHints } =
    job.data;

  const startTime = Date.now();

  try {
    // Step 1: Update status to PROCESSING
    await updateTranscriptionStatus(pool, transcriptionId, 'PROCESSING');
    await job.updateProgress(10);

    // Step 2: Call ML service
    console.log(`Processing transcription ${transcriptionId}: ${audioUri}`);
    await job.updateProgress(20);

    const result = await mlClient.transcribe({
      audio_uri: audioUri,
      transcription_id: transcriptionId,
      patient_id: patientId,
      encounter_id: encounterId,
      enable_diarization: true,
      speaker_count: speakerCount,
      vocabulary_hints: vocabularyHints,
      run_ner: true,
    });

    await job.updateProgress(70);

    // Check for failure from ML service
    if (result.status === 'failed') {
      throw new Error(result.error_message || 'ML service returned failed status');
    }

    // Step 3: Save results to database
    await saveTranscriptionResults(pool, transcriptionId, result);
    await job.updateProgress(90);

    // Step 4: Update status to COMPLETED
    await updateTranscriptionCompleted(pool, transcriptionId, result);
    await job.updateProgress(100);

    const processingTimeSeconds = (Date.now() - startTime) / 1000;

    return {
      success: true,
      transcriptionId,
      processingTimeSeconds,
    };
  } catch (error: any) {
    // Update status to FAILED
    await updateTranscriptionFailed(pool, transcriptionId, error.message);

    const processingTimeSeconds = (Date.now() - startTime) / 1000;

    // Re-throw to trigger BullMQ retry logic
    throw error;
  }
}

/**
 * Update transcription status in database
 */
async function updateTranscriptionStatus(
  pool: Pool,
  transcriptionId: string,
  status: string
): Promise<void> {
  const query = `
    UPDATE transcriptions
    SET status = $1,
        processing_started_at = CASE WHEN $1 = 'PROCESSING' THEN NOW() ELSE processing_started_at END,
        updated_at = NOW()
    WHERE id = $2
  `;

  await pool.query(query, [status, transcriptionId]);
}

/**
 * Save transcription results to database
 */
async function saveTranscriptionResults(
  pool: Pool,
  transcriptionId: string,
  result: TranscribeResponse
): Promise<void> {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Update transcription with full text and confidence
    await client.query(
      `
      UPDATE transcriptions
      SET transcript_full_text = $1,
          transcript_confidence_score = $2,
          audio_duration_seconds = $3,
          updated_at = NOW()
      WHERE id = $4
      `,
      [
        result.full_text,
        result.confidence_score,
        result.audio_duration_seconds,
        transcriptionId,
      ]
    );

    // Insert transcript segments
    if (result.segments && result.segments.length > 0) {
      const segmentQuery = `
        INSERT INTO transcript_segments
          (transcription_id, id, speaker, speaker_label, text, start_time_ms, end_time_ms, confidence)
        VALUES ${result.segments
          .map(
            (_, idx) =>
              `($1, $${idx * 7 + 2}, $${idx * 7 + 3}, $${idx * 7 + 4}, $${idx * 7 + 5}, $${
                idx * 7 + 6
              }, $${idx * 7 + 7}, $${idx * 7 + 8})`
          )
          .join(', ')}
        ON CONFLICT (transcription_id, id) DO UPDATE SET
          text = EXCLUDED.text,
          confidence = EXCLUDED.confidence
      `;

      const segmentParams: (string | number | null)[] = [transcriptionId];
      for (const seg of result.segments) {
        segmentParams.push(
          seg.id,
          seg.speaker,
          seg.speaker_label || null,
          seg.text,
          seg.start_time_ms,
          seg.end_time_ms,
          seg.confidence
        );
      }

      await client.query(segmentQuery, segmentParams);
    }

    // Insert extracted entities
    if (result.entities && result.entities.length > 0) {
      const entityQuery = `
        INSERT INTO extracted_entities
          (transcription_id, id, entity_type, text, start_offset, end_offset, confidence,
           normalized_code, normalized_system, normalized_display)
        VALUES ${result.entities
          .map(
            (_, idx) =>
              `($1, $${idx * 9 + 2}, $${idx * 9 + 3}, $${idx * 9 + 4}, $${idx * 9 + 5}, $${
                idx * 9 + 6
              }, $${idx * 9 + 7}, $${idx * 9 + 8}, $${idx * 9 + 9}, $${idx * 9 + 10})`
          )
          .join(', ')}
        ON CONFLICT (transcription_id, id) DO UPDATE SET
          text = EXCLUDED.text,
          confidence = EXCLUDED.confidence
      `;

      const entityParams: (string | number | null)[] = [transcriptionId];
      for (const entity of result.entities) {
        entityParams.push(
          entity.id,
          entity.entity_type,
          entity.text,
          entity.start_offset,
          entity.end_offset,
          entity.confidence,
          entity.normalized_code || null,
          entity.normalized_system || null,
          entity.normalized_display || null
        );
      }

      await client.query(entityQuery, entityParams);
    }

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Update transcription as completed
 */
async function updateTranscriptionCompleted(
  pool: Pool,
  transcriptionId: string,
  result: TranscribeResponse
): Promise<void> {
  const query = `
    UPDATE transcriptions
    SET status = 'COMPLETED',
        processing_completed_at = NOW(),
        updated_at = NOW()
    WHERE id = $1
  `;

  await pool.query(query, [transcriptionId]);
}

/**
 * Update transcription as failed
 */
async function updateTranscriptionFailed(
  pool: Pool,
  transcriptionId: string,
  errorMessage: string
): Promise<void> {
  const query = `
    UPDATE transcriptions
    SET status = 'FAILED',
        error_message = $1,
        processing_completed_at = NOW(),
        updated_at = NOW()
    WHERE id = $2
  `;

  await pool.query(query, [errorMessage.slice(0, 1000), transcriptionId]);
}
