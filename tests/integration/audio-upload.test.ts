import { audioUploadResolvers } from '@providers/resolvers/mutations/audio-upload';
import { GraphQLResolveInfo, GraphQLError } from 'graphql';

// Mock visitService
const mockGetVisitById = jest.fn();
const mockUpdateVisitAudioUri = jest.fn();
jest.mock('@providers/services/database', () => ({
  visitService: {
    getVisitById: (...args: unknown[]) => mockGetVisitById(...args),
    updateVisitAudioUri: (...args: unknown[]) => mockUpdateVisitAudioUri(...args),
  },
}));

// Mock storage service
const mockGenerateSignedUploadUrl = jest.fn();
const mockVerifyFileExists = jest.fn();
jest.mock('@providers/services/storage', () => ({
  getStorageService: () => ({
    generateSignedUploadUrl: mockGenerateSignedUploadUrl,
    verifyFileExists: mockVerifyFileExists,
  }),
}));

const info = {} as GraphQLResolveInfo;
const authedContext = { auth: 'test-token' };
const unauthContext = {};

describe('Audio Upload Resolvers', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('requestAudioUploadUrl', () => {
    const validVisit = {
      id: 'visit-1',
      status: 'IN_PROGRESS',
      patientId: 'patient-1',
      providerId: 'provider-1',
    };

    it('returns signed upload URL for valid visit', async () => {
      mockGetVisitById.mockResolvedValue(validVisit);
      mockGenerateSignedUploadUrl.mockResolvedValue({
        uploadUrl: 'https://storage.googleapis.com/bucket/signed-url',
        storageUri: 'gs://bucket/visits/visit-1/audio/123.webm',
        expiresAt: new Date('2026-02-15T01:00:00Z'),
      });

      const result = await audioUploadResolvers.requestAudioUploadUrl(
        {},
        { visitId: 'visit-1' },
        authedContext,
        info,
      );

      expect(result.uploadUrl).toContain('https://');
      expect(result.storageUri).toMatch(/^gs:\/\//);
      expect(result.expiresAt).toBeInstanceOf(Date);
      expect(mockGenerateSignedUploadUrl).toHaveBeenCalledWith('visit-1', 'audio/webm');
    });

    it('passes custom contentType to storage', async () => {
      mockGetVisitById.mockResolvedValue(validVisit);
      mockGenerateSignedUploadUrl.mockResolvedValue({
        uploadUrl: 'https://signed-url',
        storageUri: 'gs://bucket/file.mp4',
        expiresAt: new Date(),
      });

      await audioUploadResolvers.requestAudioUploadUrl(
        {},
        { visitId: 'visit-1', contentType: 'audio/mp4' },
        authedContext,
        info,
      );

      expect(mockGenerateSignedUploadUrl).toHaveBeenCalledWith('visit-1', 'audio/mp4');
    });

    it('rejects unauthenticated requests', async () => {
      await expect(
        audioUploadResolvers.requestAudioUploadUrl(
          {},
          { visitId: 'visit-1' },
          unauthContext,
          info,
        ),
      ).rejects.toThrow('Authentication required');
    });

    it('rejects when visit not found', async () => {
      mockGetVisitById.mockResolvedValue(null);

      await expect(
        audioUploadResolvers.requestAudioUploadUrl(
          {},
          { visitId: 'nonexistent' },
          authedContext,
          info,
        ),
      ).rejects.toThrow('Visit not found');
    });

    it('rejects upload for completed visit', async () => {
      mockGetVisitById.mockResolvedValue({ ...validVisit, status: 'COMPLETED' });

      await expect(
        audioUploadResolvers.requestAudioUploadUrl(
          {},
          { visitId: 'visit-1' },
          authedContext,
          info,
        ),
      ).rejects.toThrow('Cannot upload audio for a completed or cancelled visit');
    });

    it('rejects upload for cancelled visit', async () => {
      mockGetVisitById.mockResolvedValue({ ...validVisit, status: 'CANCELLED' });

      await expect(
        audioUploadResolvers.requestAudioUploadUrl(
          {},
          { visitId: 'visit-1' },
          authedContext,
          info,
        ),
      ).rejects.toThrow('Cannot upload audio for a completed or cancelled visit');
    });
  });

  describe('updateVisitAudio', () => {
    const validVisit = {
      id: 'visit-1',
      status: 'IN_PROGRESS',
      patientId: 'patient-1',
      providerId: 'provider-1',
    };

    const audioUri = 'gs://bucket/visits/visit-1/audio/123.webm';

    it('updates visit with verified audio URI', async () => {
      mockGetVisitById.mockResolvedValue(validVisit);
      mockVerifyFileExists.mockResolvedValue(true);
      mockUpdateVisitAudioUri.mockResolvedValue({
        ...validVisit,
        audioUri,
        audioUploadedAt: new Date('2026-02-15T00:30:00Z'),
      });

      const result = await audioUploadResolvers.updateVisitAudio(
        {},
        { visitId: 'visit-1', audioUri },
        authedContext,
        info,
      );

      expect(mockVerifyFileExists).toHaveBeenCalledWith(audioUri);
      expect(mockUpdateVisitAudioUri).toHaveBeenCalledWith('visit-1', audioUri);
      expect(result).toHaveProperty('audioUri', audioUri);
    });

    it('rejects unauthenticated requests', async () => {
      await expect(
        audioUploadResolvers.updateVisitAudio(
          {},
          { visitId: 'visit-1', audioUri },
          unauthContext,
          info,
        ),
      ).rejects.toThrow('Authentication required');
    });

    it('rejects when visit not found', async () => {
      mockGetVisitById.mockResolvedValue(null);

      await expect(
        audioUploadResolvers.updateVisitAudio(
          {},
          { visitId: 'nonexistent', audioUri },
          authedContext,
          info,
        ),
      ).rejects.toThrow('Visit not found');
    });

    it('rejects when file does not exist in GCS', async () => {
      mockGetVisitById.mockResolvedValue(validVisit);
      mockVerifyFileExists.mockResolvedValue(false);

      await expect(
        audioUploadResolvers.updateVisitAudio(
          {},
          { visitId: 'visit-1', audioUri },
          authedContext,
          info,
        ),
      ).rejects.toThrow('Audio file not found at the specified URI');

      expect(mockUpdateVisitAudioUri).not.toHaveBeenCalled();
    });

    it('rejects when DB update fails', async () => {
      mockGetVisitById.mockResolvedValue(validVisit);
      mockVerifyFileExists.mockResolvedValue(true);
      mockUpdateVisitAudioUri.mockResolvedValue(null);

      await expect(
        audioUploadResolvers.updateVisitAudio(
          {},
          { visitId: 'visit-1', audioUri },
          authedContext,
          info,
        ),
      ).rejects.toThrow('Failed to update visit audio URI');
    });
  });
});
