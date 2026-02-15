/**
 * Unit tests for MLClient
 *
 * Mocks global fetch to test HTTP interactions with the
 * Audio Intelligence ML service.
 */

import { MLClient, TranscribeRequest, TranscribeResponse } from '../workers/ml-client';

// Mock global fetch
const mockFetch = jest.fn();
global.fetch = mockFetch;

describe('MLClient', () => {
  let client: MLClient;

  beforeEach(() => {
    client = new MLClient('http://ml-test:8080', 5000);
    mockFetch.mockReset();
  });

  describe('healthCheck', () => {
    it('returns health status on success', async () => {
      const healthResponse = {
        status: 'healthy',
        whisper_model: 'large-v3',
        whisper_device: 'cuda',
        diarization_enabled: true,
      };

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(healthResponse),
      });

      const result = await client.healthCheck();

      expect(mockFetch).toHaveBeenCalledWith(
        'http://ml-test:8080/stt/health',
        expect.objectContaining({ method: 'GET' })
      );
      expect(result).toEqual(healthResponse);
    });

    it('throws on non-200 response', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 503,
      });

      await expect(client.healthCheck()).rejects.toThrow(
        'ML service health check failed: 503'
      );
    });
  });

  describe('transcribe', () => {
    const request: TranscribeRequest = {
      audio_uri: 'gs://bucket/audio.webm',
      transcription_id: 'txn-123',
      patient_id: 'patient-456',
      encounter_id: 'enc-789',
      enable_diarization: true,
      speaker_count: 2,
      vocabulary_hints: ['aspirin', 'metformin'],
      run_ner: true,
    };

    const successResponse: TranscribeResponse = {
      transcription_id: 'txn-123',
      status: 'completed',
      full_text: 'Patient reports headache and nausea.',
      audio_duration_seconds: 120,
      confidence_score: 0.95,
      segments: [
        {
          id: 'seg-1',
          speaker: 'PATIENT',
          text: 'I have a headache.',
          start_time_ms: 0,
          end_time_ms: 3000,
          confidence: 0.97,
        },
        {
          id: 'seg-2',
          speaker: 'CLINICIAN',
          text: 'When did it start?',
          start_time_ms: 3200,
          end_time_ms: 5000,
          confidence: 0.94,
        },
      ],
      entities: [
        {
          id: 'ent-1',
          entity_type: 'SYMPTOM',
          text: 'headache',
          start_offset: 18,
          end_offset: 26,
          confidence: 0.92,
          normalized_code: '25064002',
          normalized_system: 'SNOMED-CT',
          normalized_display: 'Headache',
        },
      ],
      processing_time_seconds: 15.3,
      disclaimer: 'AI-generated transcript. Review before clinical use.',
    };

    it('sends correct request and returns response on success', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(successResponse),
      });

      const result = await client.transcribe(request);

      expect(mockFetch).toHaveBeenCalledWith(
        'http://ml-test:8080/stt/transcribe',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(request),
        })
      );
      expect(result.transcription_id).toBe('txn-123');
      expect(result.status).toBe('completed');
      expect(result.segments).toHaveLength(2);
      expect(result.entities).toHaveLength(1);
      expect(result.confidence_score).toBe(0.95);
    });

    it('throws on non-200 response with error body', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 422,
        text: () => Promise.resolve('Invalid audio format'),
      });

      await expect(client.transcribe(request)).rejects.toThrow(
        'Transcription failed: 422 - Invalid audio format'
      );
    });

    it('throws on 500 server error', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        text: () => Promise.resolve('Internal server error'),
      });

      await expect(client.transcribe(request)).rejects.toThrow(
        'Transcription failed: 500 - Internal server error'
      );
    });
  });

  describe('timeout handling', () => {
    it('throws timeout error when request exceeds timeout', async () => {
      const shortTimeoutClient = new MLClient('http://ml-test:8080', 50);

      // Simulate abort by rejecting with AbortError
      const abortError = new Error('The operation was aborted');
      abortError.name = 'AbortError';
      mockFetch.mockRejectedValue(abortError);

      await expect(shortTimeoutClient.healthCheck()).rejects.toThrow(
        'ML service request timed out after 50ms'
      );
    });

    it('propagates non-abort errors unchanged', async () => {
      const networkError = new Error('ECONNREFUSED');
      mockFetch.mockRejectedValue(networkError);

      await expect(client.healthCheck()).rejects.toThrow('ECONNREFUSED');
    });
  });
});
