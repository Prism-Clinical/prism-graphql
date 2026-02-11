/**
 * Field-Level Encryption
 *
 * Encrypt and decrypt individual PHI fields using AES-256-GCM.
 * Implements secure key derivation with HKDF and per-field keys.
 */

import * as crypto from 'crypto';
import { EncryptedValue } from '../types';

// ============================================================================
// Constants
// ============================================================================

/** AES-256 key size in bytes */
const AES_256_KEY_SIZE = 32;

/** GCM IV size in bytes (96 bits recommended by NIST) */
const GCM_IV_SIZE = 12;

/** GCM auth tag size in bytes */
const GCM_TAG_SIZE = 16;

/** Salt size for HKDF */
const HKDF_SALT_SIZE = 16;

/** Maximum cached derived keys (LRU eviction) */
const MAX_CACHED_KEYS = 100;

/** Key derivation info prefix */
const HKDF_INFO_PREFIX = 'prism-phi:';

/** Salt derivation prefix */
const SALT_PREFIX = 'prism-phi-salt:';

// ============================================================================
// Error Types
// ============================================================================

/**
 * Base encryption error class
 */
export class EncryptionError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly fieldName?: string
  ) {
    super(message);
    this.name = 'EncryptionError';
  }
}

/**
 * Thrown when key configuration is invalid
 */
export class KeyConfigurationError extends EncryptionError {
  constructor(message: string) {
    super(message, 'KEY_CONFIGURATION_ERROR');
    this.name = 'KeyConfigurationError';
  }
}

/**
 * Thrown when decryption fails due to tampering or wrong key
 */
export class DecryptionError extends EncryptionError {
  constructor(fieldName: string, cause?: string) {
    super(
      `Decryption failed for field: ${fieldName}${cause ? ` (${cause})` : ''}`,
      'DECRYPTION_FAILED',
      fieldName
    );
    this.name = 'DecryptionError';
  }
}

/**
 * Thrown when key ID doesn't match
 */
export class KeyMismatchError extends EncryptionError {
  constructor(expectedKeyId: string, actualKeyId: string) {
    super(
      `Key version mismatch - data encrypted with different key version`,
      'KEY_MISMATCH',
    );
    this.name = 'KeyMismatchError';
  }
}

// ============================================================================
// Configuration Types
// ============================================================================

/**
 * Field encryption configuration
 */
export interface FieldEncryptionConfig {
  /** Master encryption key (base64 encoded, 32 bytes for AES-256) */
  masterKey: string;
  /** Key ID for tracking key versions */
  keyId: string;
  /** Whether to use deterministic encryption for searchable fields */
  deterministicMode?: boolean;
  /** Maximum number of derived keys to cache (default: 100) */
  maxCachedKeys?: number;
  /** Callback when key is derived (for auditing) */
  onKeyDerivation?: (fieldName: string) => void;
}

/**
 * Key derivation result
 */
interface DerivedKeyInfo {
  key: Buffer;
  salt: Buffer;
  derivedAt: number;
}

// ============================================================================
// LRU Cache Implementation
// ============================================================================

/**
 * Simple LRU cache for derived keys with secure eviction
 */
class DerivedKeyCache {
  private cache = new Map<string, DerivedKeyInfo>();
  private accessOrder: string[] = [];

  constructor(private readonly maxSize: number) {}

  get(fieldName: string): DerivedKeyInfo | undefined {
    const keyInfo = this.cache.get(fieldName);
    if (keyInfo) {
      // Move to end (most recently used)
      this.accessOrder = this.accessOrder.filter(k => k !== fieldName);
      this.accessOrder.push(fieldName);
    }
    return keyInfo;
  }

  set(fieldName: string, keyInfo: DerivedKeyInfo): void {
    // Evict LRU if at capacity
    if (this.cache.size >= this.maxSize && !this.cache.has(fieldName)) {
      const lruKey = this.accessOrder.shift();
      if (lruKey) {
        const evicted = this.cache.get(lruKey);
        if (evicted) {
          // Securely zero the evicted key
          evicted.key.fill(0);
          evicted.salt.fill(0);
        }
        this.cache.delete(lruKey);
      }
    }

    this.cache.set(fieldName, keyInfo);
    this.accessOrder = this.accessOrder.filter(k => k !== fieldName);
    this.accessOrder.push(fieldName);
  }

  clear(): void {
    // Securely zero all cached keys
    for (const keyInfo of this.cache.values()) {
      keyInfo.key.fill(0);
      keyInfo.salt.fill(0);
    }
    this.cache.clear();
    this.accessOrder = [];
  }

  size(): number {
    return this.cache.size;
  }
}

// ============================================================================
// Field Encryptor
// ============================================================================

/**
 * Field Encryptor
 *
 * Handles field-level encryption and decryption of PHI data.
 * Uses AES-256-GCM with per-field derived keys via HKDF.
 */
export class FieldEncryptor {
  private readonly config: FieldEncryptionConfig;
  private readonly masterKeyBuffer: Buffer;
  private readonly derivedKeys: DerivedKeyCache;

  constructor(config: FieldEncryptionConfig) {
    // Validate configuration
    if (!config.masterKey) {
      throw new KeyConfigurationError('Master key is required');
    }
    if (!config.keyId || config.keyId.length === 0) {
      throw new KeyConfigurationError('Key ID is required');
    }

    this.config = config;
    this.masterKeyBuffer = Buffer.from(config.masterKey, 'base64');

    if (this.masterKeyBuffer.length !== AES_256_KEY_SIZE) {
      // Zero the buffer before throwing
      this.masterKeyBuffer.fill(0);
      throw new KeyConfigurationError(
        `Master key must be ${AES_256_KEY_SIZE} bytes (256 bits) for AES-256, got ${this.masterKeyBuffer.length} bytes`
      );
    }

    // Initialize LRU cache
    this.derivedKeys = new DerivedKeyCache(config.maxCachedKeys ?? MAX_CACHED_KEYS);
  }

  /**
   * Encrypt a field value
   *
   * @param value - The plaintext value to encrypt
   * @param fieldName - Field name used for key derivation and AAD
   * @returns Encrypted value with all necessary components for decryption
   * @throws EncryptionError if encryption fails
   */
  encrypt(value: string, fieldName: string): EncryptedValue {
    // Validate inputs
    if (typeof value !== 'string') {
      throw new EncryptionError('Value must be a string', 'INVALID_INPUT', fieldName);
    }
    if (!fieldName || typeof fieldName !== 'string') {
      throw new EncryptionError('Field name is required', 'INVALID_FIELD_NAME');
    }

    const derivedKey = this.deriveKeyForField(fieldName);

    // Generate cryptographically secure random IV (96 bits for GCM)
    const iv = crypto.randomBytes(GCM_IV_SIZE);

    try {
      // Create cipher with derived key
      const cipher = crypto.createCipheriv('aes-256-gcm', derivedKey.key, iv);

      // Add field name as AAD for additional protection (binds ciphertext to field)
      cipher.setAAD(Buffer.from(fieldName, 'utf8'));

      // Encrypt the value
      const encrypted = Buffer.concat([
        cipher.update(value, 'utf8'),
        cipher.final(),
      ]);

      // Get auth tag (16 bytes for GCM)
      const tag = cipher.getAuthTag();

      return {
        ciphertext: encrypted.toString('base64'),
        iv: iv.toString('base64'),
        tag: tag.toString('base64'),
        keyId: this.config.keyId,
        algorithm: 'AES-256-GCM',
        encryptedAt: new Date(),
      };
    } finally {
      // Zero IV buffer after use (defense in depth)
      iv.fill(0);
    }
  }

  /**
   * Decrypt a field value
   *
   * @param encrypted - The encrypted value object
   * @param fieldName - Field name used for key derivation and AAD verification
   * @returns Decrypted plaintext string
   * @throws KeyMismatchError if key ID doesn't match
   * @throws DecryptionError if decryption fails (wrong key, tampering, etc.)
   */
  decrypt(encrypted: EncryptedValue, fieldName: string): string {
    // Validate inputs
    if (!encrypted || typeof encrypted !== 'object') {
      throw new DecryptionError(fieldName, 'invalid encrypted value');
    }
    if (!fieldName || typeof fieldName !== 'string') {
      throw new EncryptionError('Field name is required', 'INVALID_FIELD_NAME');
    }

    // Verify key ID using timing-safe comparison to prevent timing attacks
    const expectedKeyId = Buffer.from(this.config.keyId, 'utf8');
    const actualKeyId = Buffer.from(encrypted.keyId || '', 'utf8');

    // Pad to same length for timing-safe comparison
    const maxLen = Math.max(expectedKeyId.length, actualKeyId.length);
    const paddedExpected = Buffer.alloc(maxLen);
    const paddedActual = Buffer.alloc(maxLen);
    expectedKeyId.copy(paddedExpected);
    actualKeyId.copy(paddedActual);

    if (!crypto.timingSafeEqual(paddedExpected, paddedActual)) {
      throw new KeyMismatchError(this.config.keyId, encrypted.keyId);
    }

    // Validate algorithm
    if (encrypted.algorithm !== 'AES-256-GCM') {
      throw new DecryptionError(fieldName, 'unsupported algorithm');
    }

    const derivedKey = this.deriveKeyForField(fieldName);

    // Decode components with validation
    let iv: Buffer;
    let tag: Buffer;
    let ciphertext: Buffer;

    try {
      iv = Buffer.from(encrypted.iv, 'base64');
      tag = Buffer.from(encrypted.tag, 'base64');
      ciphertext = Buffer.from(encrypted.ciphertext, 'base64');
    } catch {
      throw new DecryptionError(fieldName, 'invalid base64 encoding');
    }

    // Validate component sizes
    if (iv.length !== GCM_IV_SIZE) {
      throw new DecryptionError(fieldName, 'invalid IV size');
    }
    if (tag.length !== GCM_TAG_SIZE) {
      throw new DecryptionError(fieldName, 'invalid auth tag size');
    }

    try {
      // Create decipher with derived key
      const decipher = crypto.createDecipheriv('aes-256-gcm', derivedKey.key, iv);
      decipher.setAuthTag(tag);

      // Add field name as AAD (must match what was used during encryption)
      decipher.setAAD(Buffer.from(fieldName, 'utf8'));

      // Decrypt the value
      const decrypted = Buffer.concat([
        decipher.update(ciphertext),
        decipher.final(),
      ]);

      const result = decrypted.toString('utf8');

      // Zero the decrypted buffer
      decrypted.fill(0);

      return result;
    } catch (error) {
      // Don't leak error details - could indicate tampering
      throw new DecryptionError(fieldName, 'authentication failed');
    } finally {
      // Zero temporary buffers
      iv.fill(0);
      tag.fill(0);
      ciphertext.fill(0);
    }
  }

  /**
   * Encrypt multiple fields at once
   */
  encryptFields(fields: Record<string, string>): Record<string, EncryptedValue> {
    const result: Record<string, EncryptedValue> = {};

    for (const [fieldName, value] of Object.entries(fields)) {
      result[fieldName] = this.encrypt(value, fieldName);
    }

    return result;
  }

  /**
   * Decrypt multiple fields at once
   */
  decryptFields(fields: Record<string, EncryptedValue>): Record<string, string> {
    const result: Record<string, string> = {};

    for (const [fieldName, encrypted] of Object.entries(fields)) {
      result[fieldName] = this.decrypt(encrypted, fieldName);
    }

    return result;
  }

  /**
   * Re-encrypt a value with a new key (for key rotation)
   */
  reencrypt(
    encrypted: EncryptedValue,
    fieldName: string,
    newEncryptor: FieldEncryptor
  ): EncryptedValue {
    // Decrypt with current key
    const plaintext = this.decrypt(encrypted, fieldName);

    // Encrypt with new key
    return newEncryptor.encrypt(plaintext, fieldName);
  }

  /**
   * Generate a searchable hash for deterministic queries
   * (Use only when absolutely necessary for searches)
   */
  generateSearchHash(value: string, fieldName: string): string {
    if (!this.config.deterministicMode) {
      throw new Error('Deterministic mode not enabled');
    }

    const derivedKey = this.deriveKeyForField(fieldName);

    // Use HMAC for deterministic but secure hashing
    const hmac = crypto.createHmac('sha256', derivedKey.key);
    hmac.update(value);

    return hmac.digest('base64');
  }

  /**
   * Derive a field-specific key from master key using HKDF
   *
   * Each field gets a unique derived key, preventing cross-field attacks
   * and enabling field-level key rotation in the future.
   */
  private deriveKeyForField(fieldName: string): DerivedKeyInfo {
    // Check cache first
    const cached = this.derivedKeys.get(fieldName);
    if (cached) {
      return cached;
    }

    // Generate deterministic salt from field name
    // This ensures same field always gets same derived key with same master key
    const salt = crypto.createHash('sha256')
      .update(`${SALT_PREFIX}${fieldName}`)
      .digest()
      .subarray(0, HKDF_SALT_SIZE);

    // Derive key using HKDF (RFC 5869)
    // - Extract phase: HMAC-SHA256(salt, masterKey) -> PRK
    // - Expand phase: HMAC-SHA256(PRK, info || 0x01) -> key
    const key = crypto.hkdfSync(
      'sha256',
      this.masterKeyBuffer,
      salt,
      Buffer.from(`${HKDF_INFO_PREFIX}${fieldName}`, 'utf8'),
      AES_256_KEY_SIZE
    );

    const keyInfo: DerivedKeyInfo = {
      key: Buffer.from(key),
      salt,
      derivedAt: Date.now(),
    };

    // Cache for performance (LRU eviction)
    this.derivedKeys.set(fieldName, keyInfo);

    // Notify if callback configured (for auditing)
    if (this.config.onKeyDerivation) {
      this.config.onKeyDerivation(fieldName);
    }

    return keyInfo;
  }

  /**
   * Clear derived key cache securely
   *
   * Call after key rotation or when disposing the encryptor.
   */
  clearKeyCache(): void {
    this.derivedKeys.clear();
  }

  /**
   * Dispose the encryptor and securely zero all sensitive data
   *
   * Call this when done with the encryptor to prevent key material
   * from remaining in memory.
   */
  dispose(): void {
    this.clearKeyCache();
    this.masterKeyBuffer.fill(0);
  }

  /**
   * Get current key ID
   */
  getKeyId(): string {
    return this.config.keyId;
  }

  /**
   * Get cache statistics for monitoring
   */
  getCacheStats(): { size: number; maxSize: number } {
    return {
      size: this.derivedKeys.size(),
      maxSize: this.config.maxCachedKeys ?? MAX_CACHED_KEYS,
    };
  }
}

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Generate a new master encryption key
 *
 * Uses cryptographically secure random bytes.
 * The key should be stored securely (e.g., in a KMS or HSM).
 *
 * @returns Base64-encoded 256-bit key
 */
export function generateMasterKey(): string {
  const key = crypto.randomBytes(AES_256_KEY_SIZE);
  const encoded = key.toString('base64');
  // Zero the key buffer after encoding
  key.fill(0);
  return encoded;
}

/**
 * Create a field encryptor with the given configuration
 *
 * @param masterKey - Base64-encoded 256-bit master key
 * @param keyId - Unique identifier for this key version
 * @param options - Additional configuration options
 * @returns Configured FieldEncryptor instance
 */
export function createFieldEncryptor(
  masterKey: string,
  keyId: string,
  options?: Partial<Omit<FieldEncryptionConfig, 'masterKey' | 'keyId'>>
): FieldEncryptor {
  return new FieldEncryptor({
    masterKey,
    keyId,
    ...options,
  });
}

// ============================================================================
// Type Guards
// ============================================================================

/**
 * Check if a value is a valid encrypted value object
 *
 * @param value - Value to check
 * @returns True if value has the structure of an EncryptedValue
 */
export function isEncryptedValue(value: unknown): value is EncryptedValue {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const obj = value as Record<string, unknown>;
  return (
    typeof obj.ciphertext === 'string' &&
    obj.ciphertext.length > 0 &&
    typeof obj.iv === 'string' &&
    obj.iv.length > 0 &&
    typeof obj.tag === 'string' &&
    obj.tag.length > 0 &&
    typeof obj.keyId === 'string' &&
    obj.keyId.length > 0 &&
    typeof obj.algorithm === 'string' &&
    obj.algorithm === 'AES-256-GCM'
  );
}

/**
 * Validate encrypted value structure and sizes
 *
 * @param value - Encrypted value to validate
 * @returns Validation result with any errors
 */
export function validateEncryptedValue(value: EncryptedValue): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  try {
    const iv = Buffer.from(value.iv, 'base64');
    if (iv.length !== GCM_IV_SIZE) {
      errors.push(`Invalid IV size: expected ${GCM_IV_SIZE}, got ${iv.length}`);
    }
  } catch {
    errors.push('Invalid IV encoding');
  }

  try {
    const tag = Buffer.from(value.tag, 'base64');
    if (tag.length !== GCM_TAG_SIZE) {
      errors.push(`Invalid tag size: expected ${GCM_TAG_SIZE}, got ${tag.length}`);
    }
  } catch {
    errors.push('Invalid tag encoding');
  }

  try {
    Buffer.from(value.ciphertext, 'base64');
  } catch {
    errors.push('Invalid ciphertext encoding');
  }

  if (value.algorithm !== 'AES-256-GCM') {
    errors.push(`Unsupported algorithm: ${value.algorithm}`);
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
