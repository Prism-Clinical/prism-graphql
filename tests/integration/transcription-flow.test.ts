/**
 * Integration test for the transcription submission and query flow.
 *
 * Tests the resolver layer with mocked database and queue services,
 * verifying the full submit → query → cancel → retry lifecycle.
 */

import { Mutation } from '@transcription/resolvers/Mutation';
import { Query } from '@transcription/resolvers/Query';
import { GraphQLResolveInfo } from 'graphql';

// Mock transcription service
const mockSubmitTranscription = jest.fn();
const mockGetTranscriptionById = jest.fn();
const mockGetTranscriptionsForPatient = jest.fn();
const mockCancelTranscription = jest.fn();
const mockRetryTranscription = jest.fn();
const mockGetTranscriptions = jest.fn();
const mockGetTranscriptionsForEncounter = jest.fn();

const { ForeignKeyError } = jest.requireActual('@transcription/services/database');

jest.mock('@transcription/services/database', () => {
  const actual = jest.requireActual('@transcription/services/database');
  return {
    ForeignKeyError: actual.ForeignKeyError,
    transcriptionService: {
      submitTranscription: (...args: unknown[]) => mockSubmitTranscription(...args),
      getTranscriptionById: (...args: unknown[]) => mockGetTranscriptionById(...args),
      getTranscriptionsForPatient: (...args: unknown[]) => mockGetTranscriptionsForPatient(...args),
      cancelTranscription: (...args: unknown[]) => mockCancelTranscription(...args),
      retryTranscription: (...args: unknown[]) => mockRetryTranscription(...args),
      getTranscriptions: (...args: unknown[]) => mockGetTranscriptions(...args),
      getTranscriptionsForEncounter: (...args: unknown[]) => mockGetTranscriptionsForEncounter(...args),
    },
  };
});

// Mock queue service
const mockAddTranscriptionJob = jest.fn();
const mockCancelJob = jest.fn();

jest.mock('@transcription/services/transcription-queue', () => ({
  addTranscriptionJob: (...args: unknown[]) => mockAddTranscriptionJob(...args),
  cancelJob: (...args: unknown[]) => mockCancelJob(...args),
}));

const info = {} as GraphQLResolveInfo;
const context = {};

const mutationResolvers = Mutation.Mutation!;
const queryResolvers = Query.Query!;

// Sample transcription record
const sampleTranscription = {
  id: 'txn-001',
  patientId: 'patient-123',
  encounterId: 'enc-456',
  audioUri: 'gs://bucket/audio.webm',
  status: 'PENDING',
  createdAt: new Date('2026-02-15T10:00:00Z'),
  createdBy: 'system',
  updatedAt: new Date('2026-02-15T10:00:00Z'),
  processingStartedAt: null,
  processingCompletedAt: null,
  errorMessage: null,
  transcriptFullText: null,
  transcriptConfidenceScore: null,
  audioDurationSeconds: null,
  transcript: null,
  entities: [],
};

const completedTranscription = {
  ...sampleTranscription,
  status: 'COMPLETED',
  processingStartedAt: new Date('2026-02-15T10:00:05Z'),
  processingCompletedAt: new Date('2026-02-15T10:00:35Z'),
  transcriptFullText: 'Patient reports headache and nausea.',
  transcriptConfidenceScore: 0.95,
  audioDurationSeconds: 120,
  transcript: {
    fullText: 'Patient reports headache and nausea.',
    confidenceScore: 0.95,
    wordErrorRate: null,
    segments: [
      {
        id: 'seg-1',
        speaker: 'PATIENT',
        speakerLabel: null,
        text: 'I have a headache.',
        startTimeMs: 0,
        endTimeMs: 3000,
        confidence: 0.97,
      },
    ],
  },
  entities: [
    {
      id: 'ent-1',
      entityType: 'SYMPTOM',
      text: 'headache',
      startOffset: 18,
      endOffset: 26,
      confidence: 0.92,
      normalizedCode: '25064002',
      normalizedSystem: 'SNOMED-CT',
      normalizedDisplay: 'Headache',
    },
  ],
};

describe('Transcription Flow', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('submitTranscription', () => {
    it('creates transcription and queues a job', async () => {
      mockSubmitTranscription.mockResolvedValue(sampleTranscription);
      mockAddTranscriptionJob.mockResolvedValue('txn-001');

      const result = await (mutationResolvers as any).submitTranscription(
        {},
        {
          input: {
            patientId: 'patient-123',
            audioUri: 'gs://bucket/audio.webm',
            encounterId: 'enc-456',
            speakerCount: 2,
            vocabularyHints: ['aspirin'],
          },
        },
        context,
        info,
      );

      expect(result.id).toBe('txn-001');
      expect(result.status).toBe('PENDING');
      expect(result.patient).toEqual({ __typename: 'Patient', id: 'patient-123' });

      expect(mockSubmitTranscription).toHaveBeenCalledWith({
        patientId: 'patient-123',
        encounterId: 'enc-456',
        audioUri: 'gs://bucket/audio.webm',
        speakerCount: 2,
        vocabularyHints: ['aspirin'],
        createdBy: 'system',
      });

      expect(mockAddTranscriptionJob).toHaveBeenCalledWith({
        transcriptionId: 'txn-001',
        patientId: 'patient-123',
        encounterId: 'enc-456',
        audioUri: 'gs://bucket/audio.webm',
        speakerCount: 2,
        vocabularyHints: ['aspirin'],
      });
    });

    it('rejects missing patientId', async () => {
      await expect(
        (mutationResolvers as any).submitTranscription(
          {},
          { input: { audioUri: 'gs://bucket/audio.webm' } },
          context,
          info,
        ),
      ).rejects.toThrow('Patient ID is required');
    });

    it('rejects missing audioUri', async () => {
      await expect(
        (mutationResolvers as any).submitTranscription(
          {},
          { input: { patientId: 'patient-123' } },
          context,
          info,
        ),
      ).rejects.toThrow('Audio URI is required');
    });

    it('rejects invalid audioUri format', async () => {
      await expect(
        (mutationResolvers as any).submitTranscription(
          {},
          { input: { patientId: 'patient-123', audioUri: 'not-a-uri' } },
          context,
          info,
        ),
      ).rejects.toThrow('valid URL or cloud storage URI');
    });

    it('accepts gs:// URIs', async () => {
      mockSubmitTranscription.mockResolvedValue(sampleTranscription);
      mockAddTranscriptionJob.mockResolvedValue('txn-001');

      const result = await (mutationResolvers as any).submitTranscription(
        {},
        { input: { patientId: 'patient-123', audioUri: 'gs://bucket/path/audio.webm' } },
        context,
        info,
      );

      expect(result.id).toBe('txn-001');
    });

    it('accepts s3:// URIs', async () => {
      mockSubmitTranscription.mockResolvedValue(sampleTranscription);
      mockAddTranscriptionJob.mockResolvedValue('txn-001');

      const result = await (mutationResolvers as any).submitTranscription(
        {},
        { input: { patientId: 'patient-123', audioUri: 's3://bucket/path/audio.webm' } },
        context,
        info,
      );

      expect(result.id).toBe('txn-001');
    });

    it('wraps FK constraint errors', async () => {
      mockSubmitTranscription.mockRejectedValue(new ForeignKeyError('Invalid patient reference'));

      await expect(
        (mutationResolvers as any).submitTranscription(
          {},
          { input: { patientId: 'bad-id', audioUri: 'gs://bucket/audio.webm' } },
          context,
          info,
        ),
      ).rejects.toThrow('Invalid patient reference');
    });
  });

  describe('query transcription by ID', () => {
    it('returns completed transcription with segments and entities', async () => {
      mockGetTranscriptionById.mockResolvedValue(completedTranscription);

      const result = await (queryResolvers as any).transcription(
        {},
        { id: 'txn-001' },
        context,
        info,
      );

      expect(result.id).toBe('txn-001');
      expect(result.status).toBe('COMPLETED');
      expect(result.transcript.segments).toHaveLength(1);
      expect(result.entities).toHaveLength(1);
      expect(result.entities[0].entityType).toBe('SYMPTOM');
      expect(result.patient).toEqual({ __typename: 'Patient', id: 'patient-123' });
    });

    it('returns null for nonexistent transcription', async () => {
      mockGetTranscriptionById.mockResolvedValue(null);

      const result = await (queryResolvers as any).transcription(
        {},
        { id: 'nonexistent' },
        context,
        info,
      );

      expect(result).toBeNull();
    });
  });

  describe('cancelTranscription', () => {
    it('cancels a pending transcription', async () => {
      mockCancelJob.mockResolvedValue(true);
      mockCancelTranscription.mockResolvedValue({
        ...sampleTranscription,
        status: 'CANCELLED',
      });

      const result = await (mutationResolvers as any).cancelTranscription(
        {},
        { id: 'txn-001' },
        context,
        info,
      );

      expect(result.status).toBe('CANCELLED');
      expect(mockCancelJob).toHaveBeenCalledWith('txn-001');
    });

    it('rejects when transcription cannot be cancelled', async () => {
      mockCancelJob.mockResolvedValue(false);
      mockCancelTranscription.mockResolvedValue(null);

      await expect(
        (mutationResolvers as any).cancelTranscription(
          {},
          { id: 'txn-001' },
          context,
          info,
        ),
      ).rejects.toThrow('Failed to cancel transcription');
    });
  });

  describe('retryTranscription', () => {
    it('retries a failed transcription and requeues it', async () => {
      const failedTranscription = {
        ...sampleTranscription,
        status: 'PENDING', // retryTranscription resets to PENDING
        errorMessage: null,
      };
      mockRetryTranscription.mockResolvedValue(failedTranscription);
      mockAddTranscriptionJob.mockResolvedValue('txn-001');

      const result = await (mutationResolvers as any).retryTranscription(
        {},
        { id: 'txn-001' },
        context,
        info,
      );

      expect(result.status).toBe('PENDING');
      expect(mockAddTranscriptionJob).toHaveBeenCalledWith(
        expect.objectContaining({
          transcriptionId: 'txn-001',
          patientId: 'patient-123',
          audioUri: 'gs://bucket/audio.webm',
        }),
      );
    });

    it('rejects when transcription is not in FAILED state', async () => {
      mockRetryTranscription.mockResolvedValue(null);

      await expect(
        (mutationResolvers as any).retryTranscription(
          {},
          { id: 'txn-001' },
          context,
          info,
        ),
      ).rejects.toThrow('Failed to retry transcription');
    });
  });

  describe('transcriptionsForPatient', () => {
    it('returns paginated transcriptions for a patient', async () => {
      mockGetTranscriptionsForPatient.mockResolvedValue({
        transcriptions: [completedTranscription],
        hasNextPage: false,
        totalCount: 1,
      });

      const result = await (queryResolvers as any).transcriptionsForPatient(
        {},
        { patientId: 'patient-123', pagination: { first: 10 } },
        context,
        info,
      );

      expect(result.edges).toHaveLength(1);
      expect(result.edges[0].node.id).toBe('txn-001');
      expect(result.pageInfo.hasNextPage).toBe(false);
      expect(result.totalCount).toBe(1);
    });
  });
});
