/**
 * Property-Based Security Tests
 *
 * Tests that verify security properties hold for all valid inputs.
 */

import * as fc from 'fast-check';
import {
  FieldEncryptor,
  CacheEncryptor,
  TranscriptSanitizer,
  InjectionDetector,
  PHIClassifier,
} from '@prism/security';
import { encryptionTestData } from '@test-utils/fixtures/security-fixtures';

describe('Property-Based Security Tests', () => {
  describe('Encryption Properties', () => {
    let encryptor: FieldEncryptor;

    beforeAll(() => {
      encryptor = new FieldEncryptor({
        masterKey: encryptionTestData.sampleKey.toString('hex'),
        algorithm: 'aes-256-gcm',
      });
    });

    it('should satisfy encrypt-decrypt identity', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 0, maxLength: 10000 }),
          fc.constantFrom(
            'Patient.firstName',
            'Patient.lastName',
            'Patient.mrn',
            'CarePlan.goals'
          ),
          (plaintext, fieldName) => {
            const encrypted = encryptor.encrypt(plaintext, fieldName);
            const decrypted = encryptor.decrypt(encrypted, fieldName);
            return decrypted === plaintext;
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should produce different ciphertext for same plaintext (non-deterministic)', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 1, maxLength: 1000 }),
          (plaintext) => {
            const encrypted1 = encryptor.encrypt(plaintext, 'Patient.firstName');
            const encrypted2 = encryptor.encrypt(plaintext, 'Patient.firstName');
            return encrypted1.ciphertext !== encrypted2.ciphertext;
          }
        ),
        { numRuns: 50 }
      );
    });

    it('should never include plaintext in ciphertext', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 5, maxLength: 1000 }),
          (plaintext) => {
            const encrypted = encryptor.encrypt(plaintext, 'Patient.firstName');
            // Ciphertext should not contain plaintext substring (for strings > 4 chars)
            if (plaintext.length > 4) {
              return !encrypted.ciphertext.includes(plaintext);
            }
            return true;
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should handle all unicode characters', () => {
      fc.assert(
        fc.property(
          fc.unicodeString({ minLength: 0, maxLength: 1000 }),
          (plaintext) => {
            try {
              const encrypted = encryptor.encrypt(plaintext, 'Patient.firstName');
              const decrypted = encryptor.decrypt(encrypted, 'Patient.firstName');
              return decrypted === plaintext;
            } catch {
              return false;
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should fail decryption when field name differs', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 1, maxLength: 100 }),
          fc.constantFrom('Patient.firstName', 'Patient.lastName'),
          fc.constantFrom('Patient.mrn', 'CarePlan.goals'),
          (plaintext, encryptField, decryptField) => {
            if (encryptField === decryptField) return true;

            const encrypted = encryptor.encrypt(plaintext, encryptField);
            try {
              encryptor.decrypt(encrypted, decryptField);
              return false; // Should have thrown
            } catch {
              return true; // Expected behavior
            }
          }
        ),
        { numRuns: 50 }
      );
    });
  });

  describe('Cache Encryption Properties', () => {
    let cacheEncryptor: CacheEncryptor;

    beforeAll(() => {
      cacheEncryptor = new CacheEncryptor({
        masterKey: encryptionTestData.sampleKey.toString('hex'),
      });
    });

    it('should satisfy encrypt-decrypt identity for objects', () => {
      fc.assert(
        fc.property(
          fc.record({
            firstName: fc.string(),
            lastName: fc.string(),
            age: fc.integer(),
            active: fc.boolean(),
          }),
          fc.string({ minLength: 1, maxLength: 100 }),
          (data, cacheKey) => {
            const encrypted = cacheEncryptor.encryptForCache(data, cacheKey);
            const decrypted = cacheEncryptor.decryptFromCache(encrypted, cacheKey);
            return JSON.stringify(decrypted) === JSON.stringify(data);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should fail decryption with wrong cache key', () => {
      fc.assert(
        fc.property(
          fc.record({ data: fc.string() }),
          fc.string({ minLength: 1, maxLength: 50 }),
          fc.string({ minLength: 1, maxLength: 50 }),
          (data, key1, key2) => {
            if (key1 === key2) return true;

            const encrypted = cacheEncryptor.encryptForCache(data, key1);
            try {
              cacheEncryptor.decryptFromCache(encrypted, key2);
              return false; // Should have thrown
            } catch {
              return true; // Expected
            }
          }
        ),
        { numRuns: 50 }
      );
    });
  });

  describe('Sanitization Properties', () => {
    let sanitizer: TranscriptSanitizer;

    beforeAll(() => {
      sanitizer = new TranscriptSanitizer({
        maxLength: 100000,
        removeControlChars: true,
        normalizeUnicode: true,
        detectInjection: true,
      });
    });

    it('should never increase text length beyond limit', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 0, maxLength: 200000 }),
          (text) => {
            const result = sanitizer.sanitize(text);
            return result.sanitizedText.length <= 100000;
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should remove all control characters', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 0, maxLength: 1000 }),
          (text) => {
            const result = sanitizer.sanitize(text);
            // Check no control characters (0x00-0x1F except whitespace)
            const controlCharRegex = /[\x00-\x08\x0B\x0C\x0E-\x1F]/;
            return !controlCharRegex.test(result.sanitizedText);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should preserve alphanumeric content', () => {
      fc.assert(
        fc.property(
          fc.stringOf(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789 ')),
          (text) => {
            const result = sanitizer.sanitize(text);
            // Pure alphanumeric + space should be unchanged
            return result.sanitizedText === text || result.wasModified === false;
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should be idempotent (sanitizing twice yields same result)', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 0, maxLength: 1000 }),
          (text) => {
            const result1 = sanitizer.sanitize(text);
            const result2 = sanitizer.sanitize(result1.sanitizedText);
            return result1.sanitizedText === result2.sanitizedText;
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe('Injection Detection Properties', () => {
    let detector: InjectionDetector;

    beforeAll(() => {
      detector = new InjectionDetector({
        detectSQL: true,
        detectXSS: true,
        detectCommandInjection: true,
        detectPromptInjection: true,
        detectJSONInjection: true,
      });
    });

    it('should always detect known SQL injection patterns', () => {
      const sqlPatterns = [
        "' OR '1'='1",
        "'; DROP TABLE",
        "1; DELETE FROM",
        "UNION SELECT",
        "-- comment",
      ];

      fc.assert(
        fc.property(
          fc.constantFrom(...sqlPatterns),
          (pattern) => {
            const result = detector.detect(pattern);
            return result.detected && result.types.includes('SQL_INJECTION');
          }
        ),
        { numRuns: sqlPatterns.length }
      );
    });

    it('should always detect known XSS patterns', () => {
      const xssPatterns = [
        '<script>alert(1)</script>',
        '<img onerror="alert(1)">',
        'javascript:alert(1)',
        '<svg onload="alert(1)">',
      ];

      fc.assert(
        fc.property(
          fc.constantFrom(...xssPatterns),
          (pattern) => {
            const result = detector.detect(pattern);
            return result.detected && result.types.includes('XSS');
          }
        ),
        { numRuns: xssPatterns.length }
      );
    });

    it('should not flag simple alphanumeric text', () => {
      fc.assert(
        fc.property(
          fc.stringOf(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 .')),
          (text) => {
            if (text.length < 3) return true; // Too short to analyze
            const result = detector.detect(text);
            // Simple text should have low confidence
            return result.confidence < 0.5;
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should have confidence between 0 and 1', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 0, maxLength: 1000 }),
          (text) => {
            const result = detector.detect(text);
            return result.confidence >= 0 && result.confidence <= 1;
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe('PHI Classification Properties', () => {
    let classifier: PHIClassifier;

    beforeAll(() => {
      classifier = new PHIClassifier();
    });

    it('should always identify direct PHI fields', () => {
      const directPHIFields = [
        'Patient.firstName',
        'Patient.lastName',
        'Patient.mrn',
        'Patient.dateOfBirth',
        'Patient.email',
        'Patient.phone',
      ];

      fc.assert(
        fc.property(
          fc.constantFrom(...directPHIFields),
          (field) => {
            const level = classifier.getFieldLevel(field);
            return level === 'DIRECT';
          }
        ),
        { numRuns: directPHIFields.length }
      );
    });

    it('should always identify sensitive PHI fields', () => {
      const sensitivePHIFields = [
        'CarePlan.goals',
        'CarePlan.interventions',
        'ExtractedEntities.symptoms',
        'ExtractedEntities.medications',
        'Transcript.text',
      ];

      fc.assert(
        fc.property(
          fc.constantFrom(...sensitivePHIFields),
          (field) => {
            const level = classifier.getFieldLevel(field);
            return level === 'SENSITIVE';
          }
        ),
        { numRuns: sensitivePHIFields.length }
      );
    });

    it('should detect SSN patterns in text', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 100, max: 999 }),
          fc.integer({ min: 10, max: 99 }),
          fc.integer({ min: 1000, max: 9999 }),
          (a, b, c) => {
            const ssn = `${a}-${b}-${c}`;
            const text = `Patient SSN is ${ssn}`;
            const result = classifier.detectPHIPatterns(text);
            return result.ssnPatterns.length > 0;
          }
        ),
        { numRuns: 50 }
      );
    });

    it('should detect email patterns in text', () => {
      fc.assert(
        fc.property(
          fc.stringOf(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz'), { minLength: 3, maxLength: 10 }),
          fc.constantFrom('gmail.com', 'email.com', 'test.org'),
          (local, domain) => {
            const email = `${local}@${domain}`;
            const text = `Contact: ${email}`;
            const result = classifier.detectPHIPatterns(text);
            return result.emailPatterns.length > 0;
          }
        ),
        { numRuns: 50 }
      );
    });
  });

  describe('Defense in Depth Properties', () => {
    let encryptor: FieldEncryptor;
    let sanitizer: TranscriptSanitizer;
    let detector: InjectionDetector;

    beforeAll(() => {
      encryptor = new FieldEncryptor({
        masterKey: encryptionTestData.sampleKey.toString('hex'),
        algorithm: 'aes-256-gcm',
      });

      sanitizer = new TranscriptSanitizer({
        maxLength: 100000,
        removeControlChars: true,
        normalizeUnicode: true,
        detectInjection: true,
      });

      detector = new InjectionDetector({
        detectSQL: true,
        detectXSS: true,
        detectCommandInjection: true,
        detectPromptInjection: true,
        detectJSONInjection: true,
      });
    });

    it('should sanitize before encryption maintains data integrity', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 1, maxLength: 1000 }),
          (input) => {
            // Sanitize first
            const sanitized = sanitizer.sanitize(input);

            // Encrypt the sanitized text
            const encrypted = encryptor.encrypt(
              sanitized.sanitizedText,
              'Transcript.text'
            );

            // Decrypt
            const decrypted = encryptor.decrypt(encrypted, 'Transcript.text');

            // Should equal sanitized text
            return decrypted === sanitized.sanitizedText;
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should detect injection even after partial obfuscation', () => {
      fc.assert(
        fc.property(
          fc.constantFrom(
            '<script>alert(1)</script>',
            "'; DROP TABLE--",
            '; rm -rf /'
          ),
          fc.constantFrom('', ' ', '  ', '\t'),
          (injection, padding) => {
            // Add some padding/obfuscation
            const obfuscated = padding + injection + padding;
            const result = detector.detect(obfuscated);
            return result.detected;
          }
        ),
        { numRuns: 30 }
      );
    });
  });
});
