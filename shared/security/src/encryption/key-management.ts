/**
 * Key Management
 *
 * Encryption key lifecycle management with support for key rotation.
 */

import * as crypto from 'crypto';

/**
 * Key metadata
 */
export interface KeyMetadata {
  /** Unique key ID */
  keyId: string;
  /** Key version */
  version: number;
  /** Key purpose */
  purpose: KeyPurpose;
  /** Creation timestamp */
  createdAt: Date;
  /** Expiration timestamp */
  expiresAt: Date;
  /** Last rotation timestamp */
  lastRotatedAt?: Date;
  /** Whether key is active */
  isActive: boolean;
  /** Whether key is primary (used for new encryptions) */
  isPrimary: boolean;
}

/**
 * Key purposes
 */
export enum KeyPurpose {
  /** Field-level PHI encryption */
  PHI_ENCRYPTION = 'PHI_ENCRYPTION',
  /** Cache encryption */
  CACHE_ENCRYPTION = 'CACHE_ENCRYPTION',
  /** Service token signing */
  SERVICE_TOKEN = 'SERVICE_TOKEN',
  /** Request signing */
  REQUEST_SIGNING = 'REQUEST_SIGNING',
}

/**
 * Key rotation schedule
 */
export interface KeyRotationSchedule {
  /** Key purpose */
  purpose: KeyPurpose;
  /** Rotation interval in days */
  rotationIntervalDays: number;
  /** Grace period for old keys in days */
  gracePeriodDays: number;
}

/**
 * Default rotation schedules
 */
export const DEFAULT_ROTATION_SCHEDULES: KeyRotationSchedule[] = [
  {
    purpose: KeyPurpose.PHI_ENCRYPTION,
    rotationIntervalDays: 90,
    gracePeriodDays: 30,
  },
  {
    purpose: KeyPurpose.CACHE_ENCRYPTION,
    rotationIntervalDays: 30,
    gracePeriodDays: 7,
  },
  {
    purpose: KeyPurpose.SERVICE_TOKEN,
    rotationIntervalDays: 30,
    gracePeriodDays: 7,
  },
  {
    purpose: KeyPurpose.REQUEST_SIGNING,
    rotationIntervalDays: 90,
    gracePeriodDays: 14,
  },
];

/**
 * Key storage interface for external key stores (KMS, Vault, etc.)
 */
export interface KeyStorage {
  /** Store a key */
  storeKey(keyId: string, keyMaterial: Buffer, metadata: KeyMetadata): Promise<void>;
  /** Retrieve a key */
  getKey(keyId: string): Promise<{ material: Buffer; metadata: KeyMetadata } | null>;
  /** List keys by purpose */
  listKeys(purpose: KeyPurpose): Promise<KeyMetadata[]>;
  /** Update key metadata */
  updateMetadata(keyId: string, updates: Partial<KeyMetadata>): Promise<void>;
  /** Delete a key */
  deleteKey(keyId: string): Promise<void>;
}

/**
 * In-memory key storage (for development/testing only)
 */
export class InMemoryKeyStorage implements KeyStorage {
  private keys = new Map<string, { material: Buffer; metadata: KeyMetadata }>();

  async storeKey(keyId: string, keyMaterial: Buffer, metadata: KeyMetadata): Promise<void> {
    this.keys.set(keyId, { material: keyMaterial, metadata });
  }

  async getKey(keyId: string): Promise<{ material: Buffer; metadata: KeyMetadata } | null> {
    return this.keys.get(keyId) || null;
  }

  async listKeys(purpose: KeyPurpose): Promise<KeyMetadata[]> {
    const result: KeyMetadata[] = [];
    for (const { metadata } of this.keys.values()) {
      if (metadata.purpose === purpose) {
        result.push(metadata);
      }
    }
    return result;
  }

  async updateMetadata(keyId: string, updates: Partial<KeyMetadata>): Promise<void> {
    const entry = this.keys.get(keyId);
    if (entry) {
      entry.metadata = { ...entry.metadata, ...updates };
    }
  }

  async deleteKey(keyId: string): Promise<void> {
    this.keys.delete(keyId);
  }
}

/**
 * Key Manager
 *
 * Manages encryption keys including generation, rotation, and retrieval.
 */
export class KeyManager {
  private storage: KeyStorage;
  private rotationSchedules: Map<KeyPurpose, KeyRotationSchedule>;

  constructor(storage: KeyStorage, schedules?: KeyRotationSchedule[]) {
    this.storage = storage;
    this.rotationSchedules = new Map();

    for (const schedule of schedules || DEFAULT_ROTATION_SCHEDULES) {
      this.rotationSchedules.set(schedule.purpose, schedule);
    }
  }

  /**
   * Generate a new key for the specified purpose
   */
  async generateKey(purpose: KeyPurpose, makeActive = true): Promise<string> {
    const keyId = this.generateKeyId(purpose);
    const keyMaterial = crypto.randomBytes(32);

    const schedule = this.rotationSchedules.get(purpose);
    const rotationDays = schedule?.rotationIntervalDays || 90;

    const now = new Date();
    const expiresAt = new Date(now);
    expiresAt.setDate(expiresAt.getDate() + rotationDays);

    // Get existing keys to determine version
    const existingKeys = await this.storage.listKeys(purpose);
    const maxVersion = existingKeys.reduce((max, k) => Math.max(max, k.version), 0);

    const metadata: KeyMetadata = {
      keyId,
      version: maxVersion + 1,
      purpose,
      createdAt: now,
      expiresAt,
      isActive: makeActive,
      isPrimary: makeActive,
    };

    // If making active, demote other primary keys
    if (makeActive) {
      for (const key of existingKeys) {
        if (key.isPrimary) {
          await this.storage.updateMetadata(key.keyId, { isPrimary: false });
        }
      }
    }

    await this.storage.storeKey(keyId, keyMaterial, metadata);

    return keyId;
  }

  /**
   * Get the primary key for a purpose
   */
  async getPrimaryKey(purpose: KeyPurpose): Promise<{ keyId: string; material: Buffer } | null> {
    const keys = await this.storage.listKeys(purpose);
    const primary = keys.find((k) => k.isPrimary && k.isActive);

    if (!primary) {
      return null;
    }

    const key = await this.storage.getKey(primary.keyId);
    if (!key) {
      return null;
    }

    return { keyId: primary.keyId, material: key.material };
  }

  /**
   * Get a specific key by ID
   */
  async getKey(keyId: string): Promise<{ material: Buffer; metadata: KeyMetadata } | null> {
    return await this.storage.getKey(keyId);
  }

  /**
   * Check if key rotation is needed
   */
  async checkRotationNeeded(purpose: KeyPurpose): Promise<boolean> {
    const keys = await this.storage.listKeys(purpose);
    const primary = keys.find((k) => k.isPrimary && k.isActive);

    if (!primary) {
      return true; // No primary key, need to generate one
    }

    const schedule = this.rotationSchedules.get(purpose);
    if (!schedule) {
      return false;
    }

    const daysUntilExpiration = Math.floor(
      (primary.expiresAt.getTime() - Date.now()) / (1000 * 60 * 60 * 24)
    );

    // Rotate when within grace period
    return daysUntilExpiration <= schedule.gracePeriodDays;
  }

  /**
   * Rotate key for a purpose
   */
  async rotateKey(purpose: KeyPurpose): Promise<string> {
    const newKeyId = await this.generateKey(purpose, true);

    // Get all keys for this purpose
    const keys = await this.storage.listKeys(purpose);

    // Update old primary key
    for (const key of keys) {
      if (key.keyId !== newKeyId && key.isPrimary) {
        await this.storage.updateMetadata(key.keyId, {
          isPrimary: false,
          lastRotatedAt: new Date(),
        });
      }
    }

    return newKeyId;
  }

  /**
   * Deactivate expired keys
   */
  async deactivateExpiredKeys(): Promise<string[]> {
    const deactivated: string[] = [];

    for (const purpose of Object.values(KeyPurpose)) {
      const keys = await this.storage.listKeys(purpose as KeyPurpose);

      for (const key of keys) {
        if (key.isActive && key.expiresAt < new Date()) {
          await this.storage.updateMetadata(key.keyId, { isActive: false });
          deactivated.push(key.keyId);
        }
      }
    }

    return deactivated;
  }

  /**
   * Get all active keys for a purpose (for decryption of old data)
   */
  async getActiveKeys(purpose: KeyPurpose): Promise<Array<{ keyId: string; material: Buffer }>> {
    const keys = await this.storage.listKeys(purpose);
    const activeKeys: Array<{ keyId: string; material: Buffer }> = [];

    for (const metadata of keys) {
      if (metadata.isActive) {
        const key = await this.storage.getKey(metadata.keyId);
        if (key) {
          activeKeys.push({ keyId: metadata.keyId, material: key.material });
        }
      }
    }

    return activeKeys;
  }

  /**
   * Generate unique key ID
   */
  private generateKeyId(purpose: KeyPurpose): string {
    const timestamp = Date.now().toString(36);
    const random = crypto.randomBytes(8).toString('hex');
    return `${purpose.toLowerCase()}-${timestamp}-${random}`;
  }
}

/**
 * Create a key manager with in-memory storage (for development)
 */
export function createKeyManager(storage?: KeyStorage): KeyManager {
  return new KeyManager(storage || new InMemoryKeyStorage());
}

/**
 * Environment variable names for key configuration
 */
export const KEY_ENV_VARS = {
  PHI_ENCRYPTION_KEY: 'PRISM_PHI_ENCRYPTION_KEY',
  PHI_ENCRYPTION_KEY_ID: 'PRISM_PHI_ENCRYPTION_KEY_ID',
  CACHE_ENCRYPTION_KEY: 'PRISM_CACHE_ENCRYPTION_KEY',
  CACHE_ENCRYPTION_KEY_ID: 'PRISM_CACHE_ENCRYPTION_KEY_ID',
  SERVICE_TOKEN_KEY: 'PRISM_SERVICE_TOKEN_KEY',
  SERVICE_TOKEN_KEY_ID: 'PRISM_SERVICE_TOKEN_KEY_ID',
};
