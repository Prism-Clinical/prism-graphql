import { Storage } from '@google-cloud/storage';

const ALLOWED_CONTENT_TYPES = ['audio/webm', 'audio/mp4', 'audio/wav', 'audio/mpeg', 'audio/ogg'];

const EXTENSION_MAP: Record<string, string> = {
  'audio/webm': 'webm',
  'audio/mp4': 'mp4',
  'audio/wav': 'wav',
  'audio/mpeg': 'mp3',
  'audio/ogg': 'ogg',
};

export interface SignedUploadUrl {
  uploadUrl: string;
  storageUri: string;
  expiresAt: Date;
}

export class StorageService {
  private storage: Storage;
  private bucketName: string;

  constructor(bucketName: string, projectId: string) {
    this.bucketName = bucketName;
    this.storage = new Storage({ projectId });
  }

  async generateSignedUploadUrl(
    visitId: string,
    contentType: string,
    expiresInMinutes = 30,
  ): Promise<SignedUploadUrl> {
    if (!visitId || visitId.trim() === '') {
      throw new Error('visitId is required');
    }

    if (!ALLOWED_CONTENT_TYPES.includes(contentType)) {
      throw new Error(`Unsupported content type: ${contentType}. Allowed: ${ALLOWED_CONTENT_TYPES.join(', ')}`);
    }

    const extension = EXTENSION_MAP[contentType];
    const timestamp = Date.now();
    const objectPath = `visits/${visitId}/audio/${timestamp}.${extension}`;
    const expiresAt = new Date(Date.now() + expiresInMinutes * 60 * 1000);

    const bucket = this.storage.bucket(this.bucketName);
    const file = bucket.file(objectPath);

    const [uploadUrl] = await file.getSignedUrl({
      version: 'v4',
      action: 'write',
      expires: expiresAt,
      contentType,
    });

    return {
      uploadUrl,
      storageUri: `gs://${this.bucketName}/${objectPath}`,
      expiresAt,
    };
  }

  async verifyFileExists(storageUri: string): Promise<boolean> {
    if (!storageUri.startsWith('gs://')) {
      throw new Error('Invalid GCS URI: must start with gs://');
    }

    const withoutScheme = storageUri.slice(5); // remove 'gs://'
    const slashIndex = withoutScheme.indexOf('/');
    if (slashIndex === -1) {
      throw new Error('Invalid GCS URI: missing object path');
    }

    const bucketName = withoutScheme.slice(0, slashIndex);
    const objectPath = withoutScheme.slice(slashIndex + 1);

    const bucket = this.storage.bucket(bucketName);
    const file = bucket.file(objectPath);
    const [exists] = await file.exists();

    return exists;
  }
}

// Singleton
let storageServiceInstance: StorageService | null = null;

export function initializeStorageService(bucketName: string, projectId: string): StorageService {
  storageServiceInstance = new StorageService(bucketName, projectId);
  return storageServiceInstance;
}

export function getStorageService(): StorageService {
  if (!storageServiceInstance) {
    throw new Error('StorageService not initialized. Call initializeStorageService() first.');
  }
  return storageServiceInstance;
}
