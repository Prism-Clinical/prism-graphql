/**
 * Encryption Unit Tests
 *
 * Tests for field-level encryption, cache encryption, and key management.
 */

import {
  FieldEncryptor,
  CacheEncryptor,
  EncryptedValue,
} from '../encryption/field-encryption';
import { encryptionTestData, samplePHIData } from '@test-utils/fixtures/security-fixtures';

describe('Field Encryption', () => {
  let encryptor: FieldEncryptor;

  beforeEach(() => {
    // Initialize with test key (in production, this would come from KMS)
    encryptor = new FieldEncryptor({
      masterKey: encryptionTestData.sampleKey.toString('hex'),
      algorithm: 'aes-256-gcm',
    });
  });

  describe('encrypt', () => {
    it('should encrypt a string value', () => {
      const plaintext = 'John Doe';
      const encrypted = encryptor.encrypt(plaintext, 'Patient.firstName');

      expect(encrypted).toBeDefined();
      expect(encrypted.ciphertext).toBeDefined();
      expect(encrypted.iv).toBeDefined();
      expect(encrypted.authTag).toBeDefined();
      expect(encrypted.fieldName).toBe('Patient.firstName');
    });

    it('should produce different ciphertext for same plaintext (unique IV)', () => {
      const plaintext = 'John Doe';

      const encrypted1 = encryptor.encrypt(plaintext, 'Patient.firstName');
      const encrypted2 = encryptor.encrypt(plaintext, 'Patient.firstName');

      expect(encrypted1.ciphertext).not.toBe(encrypted2.ciphertext);
      expect(encrypted1.iv).not.toBe(encrypted2.iv);
    });

    it('should encrypt different field types consistently', () => {
      encryptionTestData.fieldEncryptionCases.forEach(({ field, value }) => {
        const encrypted = encryptor.encrypt(value, field);

        expect(encrypted).toBeDefined();
        expect(encrypted.fieldName).toBe(field);
      });
    });

    it('should handle empty string', () => {
      const encrypted = encryptor.encrypt('', 'Patient.firstName');

      expect(encrypted).toBeDefined();
      expect(encrypted.ciphertext).toBeDefined();
    });

    it('should handle unicode characters', () => {
      const unicodeText = '患者姓名: 张三 مريض';
      const encrypted = encryptor.encrypt(unicodeText, 'Patient.firstName');

      expect(encrypted).toBeDefined();
    });

    it('should handle special characters', () => {
      const specialText = "O'Brien-Smith <test> & \"quotes\"";
      const encrypted = encryptor.encrypt(specialText, 'Patient.lastName');

      expect(encrypted).toBeDefined();
    });

    it('should handle long strings', () => {
      const longText = 'A'.repeat(100000);
      const encrypted = encryptor.encrypt(longText, 'Transcript.text');

      expect(encrypted).toBeDefined();
      expect(encrypted.ciphertext.length).toBeGreaterThan(0);
    });

    it('should include version in encrypted value', () => {
      const encrypted = encryptor.encrypt('test', 'Patient.firstName');

      expect(encrypted.version).toBeDefined();
      expect(typeof encrypted.version).toBe('number');
    });
  });

  describe('decrypt', () => {
    it('should decrypt an encrypted value correctly', () => {
      const plaintext = 'John Doe';
      const encrypted = encryptor.encrypt(plaintext, 'Patient.firstName');
      const decrypted = encryptor.decrypt(encrypted, 'Patient.firstName');

      expect(decrypted).toBe(plaintext);
    });

    it('should decrypt all PHI field types correctly', () => {
      encryptionTestData.fieldEncryptionCases.forEach(({ field, value }) => {
        const encrypted = encryptor.encrypt(value, field);
        const decrypted = encryptor.decrypt(encrypted, field);

        expect(decrypted).toBe(value);
      });
    });

    it('should fail decryption with wrong field name', () => {
      const encrypted = encryptor.encrypt('John', 'Patient.firstName');

      expect(() => {
        encryptor.decrypt(encrypted, 'Patient.lastName');
      }).toThrow();
    });

    it('should fail decryption with tampered ciphertext', () => {
      const encrypted = encryptor.encrypt('John Doe', 'Patient.firstName');

      // Tamper with ciphertext
      const tamperedEncrypted: EncryptedValue = {
        ...encrypted,
        ciphertext: encrypted.ciphertext.replace(/.$/, 'X'),
      };

      expect(() => {
        encryptor.decrypt(tamperedEncrypted, 'Patient.firstName');
      }).toThrow();
    });

    it('should fail decryption with tampered auth tag', () => {
      const encrypted = encryptor.encrypt('John Doe', 'Patient.firstName');

      const tamperedEncrypted: EncryptedValue = {
        ...encrypted,
        authTag: 'tampered_auth_tag_value_here',
      };

      expect(() => {
        encryptor.decrypt(tamperedEncrypted, 'Patient.firstName');
      }).toThrow();
    });

    it('should fail decryption with invalid IV', () => {
      const encrypted = encryptor.encrypt('John Doe', 'Patient.firstName');

      const tamperedEncrypted: EncryptedValue = {
        ...encrypted,
        iv: 'invalid_iv',
      };

      expect(() => {
        encryptor.decrypt(tamperedEncrypted, 'Patient.firstName');
      }).toThrow();
    });

    it('should decrypt empty string correctly', () => {
      const encrypted = encryptor.encrypt('', 'Patient.firstName');
      const decrypted = encryptor.decrypt(encrypted, 'Patient.firstName');

      expect(decrypted).toBe('');
    });

    it('should decrypt unicode correctly', () => {
      const unicodeText = '患者姓名: 张三';
      const encrypted = encryptor.encrypt(unicodeText, 'Patient.firstName');
      const decrypted = encryptor.decrypt(encrypted, 'Patient.firstName');

      expect(decrypted).toBe(unicodeText);
    });
  });

  describe('encryptObject', () => {
    it('should encrypt all PHI fields in an object', () => {
      const result = encryptor.encryptObject(samplePHIData.directPHI, 'Patient');

      expect(result.firstName).not.toBe(samplePHIData.directPHI.firstName);
      expect(result.lastName).not.toBe(samplePHIData.directPHI.lastName);
      expect(typeof result.firstName).toBe('object'); // EncryptedValue
    });

    it('should preserve non-PHI fields', () => {
      const dataWithNonPHI = {
        firstName: 'John',
        id: 'patient-123',
        createdAt: new Date().toISOString(),
      };

      const result = encryptor.encryptObject(dataWithNonPHI, 'Patient');

      expect(result.id).toBe(dataWithNonPHI.id);
      expect(result.createdAt).toBe(dataWithNonPHI.createdAt);
    });

    it('should handle nested objects', () => {
      const nested = {
        patient: {
          firstName: 'John',
          lastName: 'Doe',
        },
      };

      const result = encryptor.encryptObject(nested, 'Root');

      expect(result.patient).toBeDefined();
    });
  });

  describe('decryptObject', () => {
    it('should decrypt all encrypted fields in an object', () => {
      const encrypted = encryptor.encryptObject(samplePHIData.directPHI, 'Patient');
      const decrypted = encryptor.decryptObject(encrypted, 'Patient');

      expect(decrypted.firstName).toBe(samplePHIData.directPHI.firstName);
      expect(decrypted.lastName).toBe(samplePHIData.directPHI.lastName);
    });

    it('should preserve non-encrypted fields', () => {
      const dataWithNonPHI = {
        firstName: 'John',
        id: 'patient-123',
      };

      const encrypted = encryptor.encryptObject(dataWithNonPHI, 'Patient');
      const decrypted = encryptor.decryptObject(encrypted, 'Patient');

      expect(decrypted.id).toBe(dataWithNonPHI.id);
      expect(decrypted.firstName).toBe('John');
    });
  });

  describe('isEncrypted', () => {
    it('should identify encrypted values', () => {
      const encrypted = encryptor.encrypt('John', 'Patient.firstName');

      expect(encryptor.isEncrypted(encrypted)).toBe(true);
    });

    it('should return false for plain values', () => {
      expect(encryptor.isEncrypted('John')).toBe(false);
      expect(encryptor.isEncrypted(null)).toBe(false);
      expect(encryptor.isEncrypted(undefined)).toBe(false);
      expect(encryptor.isEncrypted(123)).toBe(false);
    });

    it('should return false for malformed encrypted objects', () => {
      expect(encryptor.isEncrypted({ ciphertext: 'test' })).toBe(false);
      expect(encryptor.isEncrypted({ ciphertext: 'test', iv: 'iv' })).toBe(false);
    });
  });
});

describe('Cache Encryption', () => {
  let cacheEncryptor: CacheEncryptor;

  beforeEach(() => {
    cacheEncryptor = new CacheEncryptor({
      masterKey: encryptionTestData.sampleKey.toString('hex'),
    });
  });

  describe('encryptForCache', () => {
    it('should encrypt data for Redis storage', () => {
      const data = { firstName: 'John', lastName: 'Doe' };
      const cacheKey = 'patient:123';

      const encrypted = cacheEncryptor.encryptForCache(data, cacheKey);

      expect(typeof encrypted).toBe('string');
      expect(encrypted).not.toContain('John');
      expect(encrypted).not.toContain('Doe');
    });

    it('should produce different results for same data with different keys', () => {
      const data = { firstName: 'John' };

      const encrypted1 = cacheEncryptor.encryptForCache(data, 'key1');
      const encrypted2 = cacheEncryptor.encryptForCache(data, 'key2');

      expect(encrypted1).not.toBe(encrypted2);
    });

    it('should handle complex nested objects', () => {
      const complexData = {
        patient: samplePHIData.directPHI,
        carePlan: {
          goals: ['Goal 1', 'Goal 2'],
          interventions: [{ name: 'Intervention 1' }],
        },
      };

      const encrypted = cacheEncryptor.encryptForCache(complexData, 'complex:123');

      expect(typeof encrypted).toBe('string');
    });

    it('should handle arrays', () => {
      const arrayData = [
        { name: 'John' },
        { name: 'Jane' },
      ];

      const encrypted = cacheEncryptor.encryptForCache(arrayData, 'array:123');

      expect(typeof encrypted).toBe('string');
    });
  });

  describe('decryptFromCache', () => {
    it('should decrypt cached data correctly', () => {
      const original = { firstName: 'John', lastName: 'Doe' };
      const cacheKey = 'patient:123';

      const encrypted = cacheEncryptor.encryptForCache(original, cacheKey);
      const decrypted = cacheEncryptor.decryptFromCache(encrypted, cacheKey);

      expect(decrypted).toEqual(original);
    });

    it('should fail with wrong cache key', () => {
      const original = { firstName: 'John' };

      const encrypted = cacheEncryptor.encryptForCache(original, 'key1');

      expect(() => {
        cacheEncryptor.decryptFromCache(encrypted, 'key2');
      }).toThrow();
    });

    it('should fail with tampered data', () => {
      const original = { firstName: 'John' };
      const cacheKey = 'patient:123';

      const encrypted = cacheEncryptor.encryptForCache(original, cacheKey);
      const tampered = encrypted.slice(0, -10) + 'XXXXXXXXXX';

      expect(() => {
        cacheEncryptor.decryptFromCache(tampered, cacheKey);
      }).toThrow();
    });

    it('should handle null values in objects', () => {
      const original = { firstName: null, lastName: 'Doe' };
      const cacheKey = 'patient:123';

      const encrypted = cacheEncryptor.encryptForCache(original, cacheKey);
      const decrypted = cacheEncryptor.decryptFromCache(encrypted, cacheKey);

      expect(decrypted.firstName).toBeNull();
      expect(decrypted.lastName).toBe('Doe');
    });

    it('should handle empty objects', () => {
      const original = {};
      const cacheKey = 'empty:123';

      const encrypted = cacheEncryptor.encryptForCache(original, cacheKey);
      const decrypted = cacheEncryptor.decryptFromCache(encrypted, cacheKey);

      expect(decrypted).toEqual({});
    });
  });

  describe('Security properties', () => {
    it('should not leak plaintext in any form', () => {
      const sensitive = {
        ssn: '123-45-6789',
        creditCard: '4111-1111-1111-1111',
      };

      const encrypted = cacheEncryptor.encryptForCache(sensitive, 'sensitive:123');

      expect(encrypted).not.toContain('123-45-6789');
      expect(encrypted).not.toContain('4111');
      expect(encrypted).not.toContain('ssn');
      expect(encrypted).not.toContain('creditCard');
    });

    it('should use unique IV for each encryption', () => {
      const data = { name: 'Test' };
      const cacheKey = 'test:123';

      const encrypted1 = cacheEncryptor.encryptForCache(data, cacheKey);
      const encrypted2 = cacheEncryptor.encryptForCache(data, cacheKey);

      expect(encrypted1).not.toBe(encrypted2);
    });
  });
});

describe('Key Management', () => {
  describe('Key derivation', () => {
    it('should derive different keys for different field names', () => {
      const encryptor = new FieldEncryptor({
        masterKey: encryptionTestData.sampleKey.toString('hex'),
        algorithm: 'aes-256-gcm',
      });

      // Encrypt same value with different field names
      const encrypted1 = encryptor.encrypt('John', 'Patient.firstName');
      const encrypted2 = encryptor.encrypt('John', 'Patient.lastName');

      // Should use different derived keys, so ciphertext should differ
      expect(encrypted1.ciphertext).not.toBe(encrypted2.ciphertext);
    });
  });

  describe('Key rotation', () => {
    it('should support re-encryption with new key', async () => {
      const oldEncryptor = new FieldEncryptor({
        masterKey: '0'.repeat(64),
        algorithm: 'aes-256-gcm',
      });

      const newEncryptor = new FieldEncryptor({
        masterKey: '1'.repeat(64),
        algorithm: 'aes-256-gcm',
      });

      const plaintext = 'John Doe';
      const oldEncrypted = oldEncryptor.encrypt(plaintext, 'Patient.firstName');

      // Decrypt with old key and re-encrypt with new key
      const decrypted = oldEncryptor.decrypt(oldEncrypted, 'Patient.firstName');
      const newEncrypted = newEncryptor.encrypt(decrypted, 'Patient.firstName');

      // Verify new encryption works
      const finalDecrypted = newEncryptor.decrypt(newEncrypted, 'Patient.firstName');
      expect(finalDecrypted).toBe(plaintext);
    });
  });
});

describe('Error handling', () => {
  it('should throw meaningful error for invalid key length', () => {
    expect(() => {
      new FieldEncryptor({
        masterKey: 'tooshort',
        algorithm: 'aes-256-gcm',
      });
    }).toThrow(/invalid.*key/i);
  });

  it('should throw meaningful error for invalid algorithm', () => {
    expect(() => {
      new FieldEncryptor({
        masterKey: encryptionTestData.sampleKey.toString('hex'),
        algorithm: 'invalid-algo' as any,
      });
    }).toThrow(/algorithm/i);
  });

  it('should throw meaningful error for invalid encrypted value', () => {
    const encryptor = new FieldEncryptor({
      masterKey: encryptionTestData.sampleKey.toString('hex'),
      algorithm: 'aes-256-gcm',
    });

    expect(() => {
      encryptor.decrypt({} as EncryptedValue, 'Patient.firstName');
    }).toThrow();
  });
});
