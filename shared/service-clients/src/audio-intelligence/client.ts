/**
 * Audio Intelligence Client
 *
 * HTTP client for the Audio Intelligence ML service.
 */

import { BaseHttpClient, ServiceClientConfig, RequestOptions, HealthStatus } from '../common';
import {
  ExtractionRequest,
  ExtractionResponse,
  BatchExtractionRequest,
  BatchExtractionResponse,
  TranscriptionRequest,
  TranscriptionResponse,
  FALLBACK_EXTRACTION_RESPONSE,
} from './types';

/**
 * Audio Intelligence client configuration
 */
export interface AudioIntelligenceClientConfig extends Partial<ServiceClientConfig> {
  /** Base URL of the Audio Intelligence service */
  baseUrl: string;
}

/**
 * Audio Intelligence Client
 *
 * Provides methods for entity extraction from clinical transcripts
 * and speech-to-text transcription with NER.
 */
export class AudioIntelligenceClient extends BaseHttpClient {
  private fallbackEnabled = true;

  constructor(config: AudioIntelligenceClientConfig) {
    super({
      ...config,
      serviceName: 'audio-intelligence',
      timeout: config.timeout ?? 30000, // 30 second default
    });
  }

  /**
   * Extract clinical entities from transcript text
   */
  async extract(
    request: ExtractionRequest,
    options?: RequestOptions
  ): Promise<ExtractionResponse> {
    try {
      // Validate input
      this.validateExtractionRequest(request);

      const response = await this.post<ExtractionResponse>(
        '/api/v1/extract',
        {
          transcript_text: request.transcriptText,
          transcript_id: request.transcriptId,
          encounter_id: request.encounterId,
          force_tier: request.forceTier,
          speaker_segments: request.speakerSegments?.map((s) => ({
            speaker: s.speaker,
            text: s.text,
            start_time: s.startTime,
            end_time: s.endTime,
          })),
          run_patterns: request.runPatterns,
        },
        options
      );

      return this.transformExtractionResponse(response.data);
    } catch (error) {
      if (this.fallbackEnabled) {
        console.warn('[AudioIntelligence] Extraction failed, returning fallback:', error);
        return {
          ...FALLBACK_EXTRACTION_RESPONSE,
          redFlags: [{
            severity: 'MEDIUM',
            description: 'Entity extraction service unavailable',
            recommendedAction: 'Manual clinical review required',
          }],
        };
      }
      throw error;
    }
  }

  /**
   * Extract entities from multiple transcripts in batch
   */
  async extractBatch(
    request: BatchExtractionRequest,
    options?: RequestOptions
  ): Promise<BatchExtractionResponse> {
    try {
      // Validate batch size
      if (request.transcripts.length === 0) {
        throw new Error('At least one transcript is required');
      }
      if (request.transcripts.length > 100) {
        throw new Error('Maximum 100 transcripts per batch');
      }

      // Validate each request
      request.transcripts.forEach((r) => this.validateExtractionRequest(r));

      const response = await this.post<BatchExtractionResponse>(
        '/api/v1/extract/batch',
        {
          transcripts: request.transcripts.map((t) => ({
            transcript_text: t.transcriptText,
            transcript_id: t.transcriptId,
            encounter_id: t.encounterId,
            force_tier: t.forceTier,
            run_patterns: t.runPatterns,
          })),
          max_concurrent: request.maxConcurrent,
        },
        {
          ...options,
          timeout: options?.timeout ?? 120000, // 2 minute timeout for batch
        }
      );

      return {
        results: response.data.results.map((r) => this.transformExtractionResponse(r)),
        totalCount: response.data.totalCount,
        successCount: response.data.successCount,
        errorCount: response.data.errorCount,
        totalCostUsd: response.data.totalCostUsd,
        totalProcessingTimeSeconds: response.data.totalProcessingTimeSeconds,
      };
    } catch (error) {
      if (this.fallbackEnabled) {
        console.warn('[AudioIntelligence] Batch extraction failed, returning fallback:', error);
        return {
          results: request.transcripts.map(() => ({
            ...FALLBACK_EXTRACTION_RESPONSE,
            redFlags: [{
              severity: 'MEDIUM',
              description: 'Entity extraction service unavailable',
              recommendedAction: 'Manual clinical review required',
            }],
          })),
          totalCount: request.transcripts.length,
          successCount: 0,
          errorCount: request.transcripts.length,
          totalCostUsd: 0,
          totalProcessingTimeSeconds: 0,
        };
      }
      throw error;
    }
  }

  /**
   * Start a transcription job (async)
   */
  async startTranscription(
    request: TranscriptionRequest,
    options?: RequestOptions
  ): Promise<TranscriptionResponse> {
    const response = await this.post<TranscriptionResponse>(
      '/api/v1/transcribe',
      {
        audio_uri: request.audioUri,
        transcription_id: request.transcriptionId,
        patient_id: request.patientId,
        encounter_id: request.encounterId,
        enable_diarization: request.enableDiarization,
        speaker_count: request.speakerCount,
        vocabulary_hints: request.vocabularyHints,
        run_ner: request.runNer,
        callback_url: request.callbackUrl,
      },
      options
    );

    return this.transformTranscriptionResponse(response.data);
  }

  /**
   * Get transcription status
   */
  async getTranscriptionStatus(
    transcriptionId: string,
    options?: RequestOptions
  ): Promise<TranscriptionResponse> {
    const response = await this.get<TranscriptionResponse>(
      `/api/v1/transcribe/${transcriptionId}`,
      options
    );

    return this.transformTranscriptionResponse(response.data);
  }

  /**
   * Health check
   */
  async healthCheck(): Promise<HealthStatus> {
    return super.healthCheck();
  }

  /**
   * Enable or disable fallback mode
   */
  setFallbackEnabled(enabled: boolean): void {
    this.fallbackEnabled = enabled;
  }

  /**
   * Validate extraction request
   */
  private validateExtractionRequest(request: ExtractionRequest): void {
    if (!request.transcriptText) {
      throw new Error('Transcript text is required');
    }

    if (request.transcriptText.length > 100 * 1024) {
      throw new Error('Transcript text exceeds maximum length of 100KB');
    }
  }

  /**
   * Transform snake_case response to camelCase
   */
  private transformExtractionResponse(data: Record<string, unknown>): ExtractionResponse {
    return {
      symptoms: this.transformEntities(data.symptoms as unknown[] || []),
      medications: this.transformEntities(data.medications as unknown[] || []),
      vitals: this.transformEntities(data.vitals as unknown[] || []),
      redFlags: this.transformRedFlags(data.red_flags as unknown[] || []),
      patternMatches: this.transformPatternMatches(data.pattern_matches as unknown[] || []),
      nluTier: data.nlu_tier as ExtractionResponse['nluTier'],
      processingTimeSeconds: data.processing_time_seconds as number,
      estimatedCostUsd: data.estimated_cost_usd as number,
      hasRedFlags: data.has_red_flags as boolean,
      disclaimer: data.disclaimer as string || '',
    };
  }

  /**
   * Transform entity array
   */
  private transformEntities(entities: unknown[]): ExtractionResponse['symptoms'] {
    return entities.map((e: Record<string, unknown>) => ({
      text: e.text as string,
      type: e.type as string,
      snomedCode: e.snomed_code as string | undefined,
      snomedDisplay: e.snomed_display as string | undefined,
      confidence: e.confidence as number,
      startOffset: e.start_offset as number | undefined,
      endOffset: e.end_offset as number | undefined,
      negated: e.negated as boolean | undefined,
      attributes: e.attributes as Record<string, unknown> | undefined,
    }));
  }

  /**
   * Transform red flags array
   */
  private transformRedFlags(redFlags: unknown[]): ExtractionResponse['redFlags'] {
    return redFlags.map((r: Record<string, unknown>) => ({
      severity: r.severity as 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL',
      description: r.description as string,
      sourceText: r.source_text as string | undefined,
      recommendedAction: r.recommended_action as string | undefined,
      relatedEntity: r.related_entity
        ? this.transformEntities([r.related_entity])[0]
        : undefined,
    }));
  }

  /**
   * Transform pattern matches array
   */
  private transformPatternMatches(matches: unknown[]): ExtractionResponse['patternMatches'] {
    return matches.map((m: Record<string, unknown>) => ({
      patternName: m.pattern_name as string,
      category: m.category as string,
      matchedText: m.matched_text as string,
      confidence: m.confidence as number,
      data: m.data as Record<string, unknown> | undefined,
    }));
  }

  /**
   * Transform transcription response
   */
  private transformTranscriptionResponse(data: Record<string, unknown>): TranscriptionResponse {
    return {
      transcriptionId: data.transcription_id as string,
      status: data.status as TranscriptionResponse['status'],
      fullText: data.full_text as string | undefined,
      audioDurationSeconds: data.audio_duration_seconds as number | undefined,
      confidenceScore: data.confidence_score as number | undefined,
      segments: (data.segments as unknown[] || []).map((s: Record<string, unknown>) => ({
        text: s.text as string,
        speaker: s.speaker as string | undefined,
        startTime: s.start_time as number,
        endTime: s.end_time as number,
        confidence: s.confidence as number,
      })),
      entities: data.entities
        ? this.transformEntities(data.entities as unknown[])
        : undefined,
      processingTimeSeconds: data.processing_time_seconds as number | undefined,
      errorMessage: data.error_message as string | undefined,
    };
  }
}

/**
 * Create Audio Intelligence client
 */
export function createAudioIntelligenceClient(
  baseUrl: string,
  options?: Partial<AudioIntelligenceClientConfig>
): AudioIntelligenceClient {
  return new AudioIntelligenceClient({ baseUrl, ...options });
}
