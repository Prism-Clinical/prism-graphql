import { StorageService, initializeStorageService, getStorageService } from '../storage';

// Mock @google-cloud/storage
const mockGetSignedUrl = jest.fn();
const mockFile = jest.fn().mockReturnValue({
  getSignedUrl: mockGetSignedUrl,
  exists: jest.fn().mockResolvedValue([true]),
});
const mockBucket = jest.fn().mockReturnValue({
  file: mockFile,
});

jest.mock('@google-cloud/storage', () => ({
  Storage: jest.fn().mockImplementation(() => ({
    bucket: mockBucket,
  })),
}));

describe('StorageService', () => {
  let service: StorageService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new StorageService('test-bucket', 'test-project');
    mockGetSignedUrl.mockResolvedValue(['https://storage.googleapis.com/test-bucket/signed-url']);
  });

  describe('generateSignedUploadUrl', () => {
    it('throws on empty visitId', async () => {
      await expect(service.generateSignedUploadUrl('', 'audio/webm'))
        .rejects.toThrow('visitId is required');
    });

    it('throws on invalid content type', async () => {
      await expect(service.generateSignedUploadUrl('visit-123', 'text/html'))
        .rejects.toThrow('Unsupported content type');
    });

    it('returns correct format for valid request', async () => {
      const result = await service.generateSignedUploadUrl('visit-123', 'audio/webm');

      expect(result).toHaveProperty('uploadUrl');
      expect(result).toHaveProperty('storageUri');
      expect(result).toHaveProperty('expiresAt');
      expect(result.uploadUrl).toContain('https://');
      expect(result.storageUri).toMatch(/^gs:\/\/test-bucket\/visits\/visit-123\/audio\//);
      expect(result.expiresAt).toBeInstanceOf(Date);
      expect(result.expiresAt.getTime()).toBeGreaterThan(Date.now());
    });

    it('generates GCS path with visit ID and timestamp', async () => {
      const result = await service.generateSignedUploadUrl('visit-456', 'audio/webm');

      expect(result.storageUri).toMatch(/^gs:\/\/test-bucket\/visits\/visit-456\/audio\/\d+\.webm$/);
    });

    it('maps content type to correct file extension', async () => {
      const webm = await service.generateSignedUploadUrl('v1', 'audio/webm');
      expect(webm.storageUri).toMatch(/\.webm$/);

      const mp4 = await service.generateSignedUploadUrl('v1', 'audio/mp4');
      expect(mp4.storageUri).toMatch(/\.mp4$/);

      const wav = await service.generateSignedUploadUrl('v1', 'audio/wav');
      expect(wav.storageUri).toMatch(/\.wav$/);
    });

    it('calls GCS with correct signed URL options', async () => {
      await service.generateSignedUploadUrl('visit-123', 'audio/webm', 30);

      expect(mockBucket).toHaveBeenCalledWith('test-bucket');
      expect(mockFile).toHaveBeenCalled();
      expect(mockGetSignedUrl).toHaveBeenCalledWith(
        expect.objectContaining({
          version: 'v4',
          action: 'write',
          contentType: 'audio/webm',
        })
      );

      // Verify expiration is ~30 minutes
      const callArgs = mockGetSignedUrl.mock.calls[0][0];
      expect(callArgs.expires).toBeInstanceOf(Date);
      const diffMinutes = (callArgs.expires.getTime() - Date.now()) / 60000;
      expect(diffMinutes).toBeGreaterThan(28);
      expect(diffMinutes).toBeLessThan(32);
    });

    it('defaults to 30-minute expiration', async () => {
      await service.generateSignedUploadUrl('visit-123', 'audio/webm');

      const callArgs = mockGetSignedUrl.mock.calls[0][0];
      const diffMinutes = (callArgs.expires.getTime() - Date.now()) / 60000;
      expect(diffMinutes).toBeGreaterThan(28);
      expect(diffMinutes).toBeLessThan(32);
    });
  });

  describe('verifyFileExists', () => {
    it('returns true for existing file', async () => {
      mockFile.mockReturnValueOnce({
        exists: jest.fn().mockResolvedValue([true]),
      });

      const result = await service.verifyFileExists('gs://test-bucket/visits/v1/audio/123.webm');
      expect(result).toBe(true);
    });

    it('returns false for non-existing file', async () => {
      mockFile.mockReturnValueOnce({
        exists: jest.fn().mockResolvedValue([false]),
      });

      const result = await service.verifyFileExists('gs://test-bucket/visits/v1/audio/missing.webm');
      expect(result).toBe(false);
    });

    it('throws on invalid URI format', async () => {
      await expect(service.verifyFileExists('https://not-a-gcs-uri'))
        .rejects.toThrow('Invalid GCS URI');
    });
  });

  describe('singleton factory', () => {
    it('initializeStorageService creates and returns instance', () => {
      const instance = initializeStorageService('bucket', 'project');
      expect(instance).toBeInstanceOf(StorageService);
    });

    it('getStorageService returns initialized instance', () => {
      initializeStorageService('bucket', 'project');
      const instance = getStorageService();
      expect(instance).toBeInstanceOf(StorageService);
    });

    it('getStorageService throws when not initialized', () => {
      jest.resetModules();
      const { getStorageService: freshGet } = require('../storage');
      expect(() => freshGet()).toThrow('StorageService not initialized');
    });
  });
});
