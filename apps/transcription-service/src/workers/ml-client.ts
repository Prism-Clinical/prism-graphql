/**
 * ML Service Client
 *
 * HTTP client for communicating with the Audio Intelligence ML service.
 * Handles transcription requests and response parsing.
 */

// Configuration
const ML_SERVICE_URL = process.env.ML_SERVICE_URL || 'http://localhost:8080';
const ML_SERVICE_TIMEOUT = parseInt(process.env.ML_SERVICE_TIMEOUT || '300000'); // 5 minutes default

// Request interfaces (matching prism-ml-infra API)
export interface TranscribeRequest {
  audio_uri: string;
  transcription_id: string;
  patient_id: string;
  encounter_id?: string;
  enable_diarization?: boolean;
  speaker_count?: number;
  vocabulary_hints?: string[];
  run_ner?: boolean;
}

// Response interfaces (matching prism-ml-infra API)
export interface TranscribeResponse {
  transcription_id: string;
  status: 'processing' | 'completed' | 'failed';
  full_text: string;
  audio_duration_seconds: number;
  confidence_score: number;
  segments: TranscriptSegmentResponse[];
  entities: ExtractedEntityResponse[];
  processing_time_seconds: number;
  error_message?: string;
  disclaimer: string;
}

export interface TranscriptSegmentResponse {
  id: string;
  speaker: 'CLINICIAN' | 'PATIENT' | 'FAMILY_MEMBER' | 'OTHER';
  speaker_label?: string;
  text: string;
  start_time_ms: number;
  end_time_ms: number;
  confidence: number;
}

export interface ExtractedEntityResponse {
  id: string;
  entity_type: 'MEDICATION' | 'SYMPTOM' | 'VITAL_SIGN' | 'ALLERGY' | 'PROCEDURE' | 'CONDITION' | 'TEMPORAL';
  text: string;
  start_offset: number;
  end_offset: number;
  confidence: number;
  normalized_code?: string;
  normalized_system?: string;
  normalized_display?: string;
}

export interface HealthResponse {
  status: string;
  whisper_model: string;
  whisper_device: string;
  diarization_enabled: boolean;
}

/**
 * ML Service Client class
 */
export class MLClient {
  private baseUrl: string;
  private timeout: number;

  constructor(baseUrl: string = ML_SERVICE_URL, timeout: number = ML_SERVICE_TIMEOUT) {
    this.baseUrl = baseUrl;
    this.timeout = timeout;
  }

  /**
   * Check if ML service is healthy
   */
  async healthCheck(): Promise<HealthResponse> {
    const response = await this.fetch('/stt/health', {
      method: 'GET',
    });

    if (!response.ok) {
      throw new Error(`ML service health check failed: ${response.status}`);
    }

    return response.json();
  }

  /**
   * Transcribe audio with STT + NER pipeline
   */
  async transcribe(request: TranscribeRequest): Promise<TranscribeResponse> {
    const response = await this.fetch('/stt/transcribe', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Transcription failed: ${response.status} - ${error}`);
    }

    return response.json();
  }

  /**
   * Internal fetch wrapper with timeout
   */
  private async fetch(path: string, options: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        ...options,
        signal: controller.signal,
      });
      return response;
    } catch (error: any) {
      if (error.name === 'AbortError') {
        throw new Error(`ML service request timed out after ${this.timeout}ms`);
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }
}

// Default client instance
export const mlClient = new MLClient();
