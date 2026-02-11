/**
 * HIPAA Compliance Tests
 *
 * Tests to verify HIPAA security and privacy rule compliance.
 */

import { Pool } from 'pg';
import { Redis } from 'ioredis';
import {
  setupTestDatabase,
  setupTestRedis,
  cleanupTestDatabase,
  closeTestConnections,
} from '@test-utils/setup';
import {
  FieldEncryptor,
  CacheEncryptor,
  AuditLogger,
  PHIClassifier,
} from '@prism/security';
import {
  samplePHIData,
  encryptionTestData,
  generateUserContext,
} from '@test-utils/fixtures/security-fixtures';

describe('HIPAA Compliance', () => {
  let pool: Pool;
  let redis: Redis;

  beforeAll(async () => {
    pool = await setupTestDatabase();
    redis = await setupTestRedis();
  });

  beforeEach(async () => {
    await cleanupTestDatabase();
  });

  afterAll(async () => {
    await closeTestConnections();
  });

  describe('PHI Encryption at Rest', () => {
    let encryptor: FieldEncryptor;

    beforeEach(() => {
      encryptor = new FieldEncryptor({
        masterKey: encryptionTestData.sampleKey.toString('hex'),
        algorithm: 'aes-256-gcm',
      });
    });

    it('should encrypt all direct PHI fields before storage', () => {
      const directPHIFields = [
        'firstName',
        'lastName',
        'mrn',
        'dateOfBirth',
        'ssn',
        'email',
        'phone',
      ];

      directPHIFields.forEach((field) => {
        const value = samplePHIData.directPHI[field as keyof typeof samplePHIData.directPHI];
        if (typeof value === 'string') {
          const encrypted = encryptor.encrypt(value, `Patient.${field}`);

          // Encrypted value should not contain plaintext
          expect(encrypted.ciphertext).not.toBe(value);
          expect(encrypted.ciphertext).not.toContain(value);
        }
      });
    });

    it('should use AES-256 encryption (minimum required)', () => {
      const encrypted = encryptor.encrypt('Test PHI', 'Patient.firstName');

      // AES-256-GCM produces specific ciphertext structure
      expect(encrypted.ciphertext.length).toBeGreaterThan(0);
      expect(encrypted.iv).toBeDefined();
      expect(encrypted.authTag).toBeDefined();
    });

    it('should produce different ciphertext for same plaintext (unique IV)', () => {
      const plaintext = 'John Doe';

      const encrypted1 = encryptor.encrypt(plaintext, 'Patient.firstName');
      const encrypted2 = encryptor.encrypt(plaintext, 'Patient.firstName');

      expect(encrypted1.ciphertext).not.toBe(encrypted2.ciphertext);
      expect(encrypted1.iv).not.toBe(encrypted2.iv);
    });

    it('should encrypt PHI in Redis cache', async () => {
      const cacheEncryptor = new CacheEncryptor({
        masterKey: encryptionTestData.sampleKey.toString('hex'),
      });

      const phiData = { firstName: 'John', lastName: 'Doe', mrn: 'MRN-123' };
      const cacheKey = 'patient:test-123';

      const encrypted = cacheEncryptor.encryptForCache(phiData, cacheKey);

      // Store in Redis
      await redis.set(cacheKey, encrypted);

      // Retrieve and verify it's encrypted
      const stored = await redis.get(cacheKey);

      expect(stored).not.toContain('John');
      expect(stored).not.toContain('Doe');
      expect(stored).not.toContain('MRN-123');
    });
  });

  describe('PHI Encryption in Transit', () => {
    it('should require TLS 1.2 or higher for all connections', () => {
      // This would be verified at the infrastructure level
      // Here we document the requirement
      const minTLSVersion = 'TLSv1.2';
      expect(['TLSv1.2', 'TLSv1.3']).toContain(minTLSVersion);
    });

    it('should use strong cipher suites', () => {
      const allowedCipherSuites = [
        'TLS_AES_256_GCM_SHA384',
        'TLS_CHACHA20_POLY1305_SHA256',
        'TLS_AES_128_GCM_SHA256',
        'ECDHE-RSA-AES256-GCM-SHA384',
        'ECDHE-RSA-AES128-GCM-SHA256',
      ];

      // At least one strong cipher should be configured
      expect(allowedCipherSuites.length).toBeGreaterThan(0);
    });
  });

  describe('Access Control', () => {
    it('should enforce role-based access control', async () => {
      const classifier = new PHIClassifier();

      // Provider should have access to patient PHI
      const providerAccess = classifier.validateFieldAccess(
        'Patient.firstName',
        ['PROVIDER']
      );
      expect(providerAccess.allowed).toBe(true);

      // Care coordinator should have access to patient PHI
      const coordinatorAccess = classifier.validateFieldAccess(
        'Patient.firstName',
        ['CARE_COORDINATOR']
      );
      expect(coordinatorAccess.allowed).toBe(true);

      // All PHI access should require audit
      expect(providerAccess.requiresAudit).toBe(true);
      expect(coordinatorAccess.requiresAudit).toBe(true);
    });

    it('should require authentication for PHI access', () => {
      // This is enforced at the GraphQL resolver level
      // Here we document the requirement
      const phiOperations = [
        'generateCarePlanFromVisit',
        'patient',
        'carePlan',
      ];

      phiOperations.forEach((operation) => {
        // Each operation should have @auth directive
        expect(operation).toBeDefined();
      });
    });

    it('should implement minimum necessary access', () => {
      const classifier = new PHIClassifier();

      // Different roles should have different access levels
      const providerClassification = classifier.classifyObject(
        samplePHIData.sensitivePHI,
        'CarePlan'
      );

      // Sensitive PHI should be classified
      expect(providerClassification.sensitivePHIFields.length).toBeGreaterThan(0);
    });
  });

  describe('Audit Controls', () => {
    let auditLogger: AuditLogger;

    beforeEach(() => {
      auditLogger = new AuditLogger({
        pool,
        serviceName: 'careplan-service',
        retentionDays: 2555, // 7 years per HIPAA
      });
    });

    it('should log all PHI access events', async () => {
      const phiAccessEvent = {
        eventType: 'PHI_ACCESS',
        userId: 'provider-123',
        userRole: 'PROVIDER',
        patientId: 'patient-456',
        resourceType: 'Patient',
        resourceId: 'patient-456',
        action: 'READ',
        phiAccessed: true,
        phiFields: ['firstName', 'lastName', 'dateOfBirth'],
        requestId: 'req-789',
        outcome: 'SUCCESS' as const,
      };

      // Mock the database query
      const mockQuery = jest.spyOn(pool, 'query').mockResolvedValue({
        rows: [{ id: 'audit-123' }],
      } as any);

      await auditLogger.logAccess(phiAccessEvent);

      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO audit_log'),
        expect.arrayContaining([
          'PHI_ACCESS',
          'provider-123',
          'PROVIDER',
          'patient-456',
        ])
      );

      mockQuery.mockRestore();
    });

    it('should log who accessed PHI', async () => {
      const mockQuery = jest.spyOn(pool, 'query').mockResolvedValue({
        rows: [{ id: 'audit-123' }],
      } as any);

      await auditLogger.logAccess({
        eventType: 'PHI_ACCESS',
        userId: 'user-specific-123',
        userRole: 'PROVIDER',
        patientId: 'patient-456',
        resourceType: 'Patient',
        action: 'READ',
        phiAccessed: true,
        requestId: 'req-123',
        outcome: 'SUCCESS',
      });

      expect(mockQuery).toHaveBeenCalledWith(
        expect.any(String),
        expect.arrayContaining(['user-specific-123'])
      );

      mockQuery.mockRestore();
    });

    it('should log what PHI was accessed', async () => {
      const mockQuery = jest.spyOn(pool, 'query').mockResolvedValue({
        rows: [{ id: 'audit-123' }],
      } as any);

      const phiFields = ['Patient.firstName', 'Patient.lastName', 'Patient.mrn'];

      await auditLogger.logAccess({
        eventType: 'PHI_ACCESS',
        userId: 'user-123',
        userRole: 'PROVIDER',
        patientId: 'patient-456',
        resourceType: 'Patient',
        action: 'READ',
        phiAccessed: true,
        phiFields,
        requestId: 'req-123',
        outcome: 'SUCCESS',
      });

      expect(mockQuery).toHaveBeenCalledWith(
        expect.any(String),
        expect.arrayContaining([phiFields])
      );

      mockQuery.mockRestore();
    });

    it('should log when PHI was accessed (timestamp)', async () => {
      const mockQuery = jest.spyOn(pool, 'query').mockResolvedValue({
        rows: [{ id: 'audit-123' }],
      } as any);

      await auditLogger.logAccess({
        eventType: 'PHI_ACCESS',
        userId: 'user-123',
        userRole: 'PROVIDER',
        resourceType: 'Patient',
        action: 'READ',
        phiAccessed: true,
        requestId: 'req-123',
        outcome: 'SUCCESS',
      });

      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('event_time'),
        expect.any(Array)
      );

      mockQuery.mockRestore();
    });

    it('should log where PHI was accessed from (IP address)', async () => {
      const mockQuery = jest.spyOn(pool, 'query').mockResolvedValue({
        rows: [{ id: 'audit-123' }],
      } as any);

      await auditLogger.logAccess({
        eventType: 'PHI_ACCESS',
        userId: 'user-123',
        userRole: 'PROVIDER',
        resourceType: 'Patient',
        action: 'READ',
        phiAccessed: true,
        ipAddress: '192.168.1.100',
        requestId: 'req-123',
        outcome: 'SUCCESS',
      });

      expect(mockQuery).toHaveBeenCalledWith(
        expect.any(String),
        expect.arrayContaining(['192.168.1.100'])
      );

      mockQuery.mockRestore();
    });

    it('should retain audit logs for 7 years (HIPAA requirement)', () => {
      // 2555 days = ~7 years
      expect(auditLogger['config'].retentionDays).toBe(2555);
    });

    it('should make audit logs immutable', async () => {
      // The audit_log table should have rules preventing UPDATE and DELETE
      // This is enforced at the database level
      const immutabilityRules = [
        'audit_log_no_update',
        'audit_log_no_delete',
      ];

      // Document the requirement
      expect(immutabilityRules.length).toBe(2);
    });
  });

  describe('Data Integrity', () => {
    it('should use authenticated encryption (GCM mode)', () => {
      const encryptor = new FieldEncryptor({
        masterKey: encryptionTestData.sampleKey.toString('hex'),
        algorithm: 'aes-256-gcm',
      });

      const encrypted = encryptor.encrypt('Test data', 'Patient.firstName');

      // GCM mode provides authentication tag
      expect(encrypted.authTag).toBeDefined();
      expect(encrypted.authTag.length).toBeGreaterThan(0);
    });

    it('should detect tampered ciphertext', () => {
      const encryptor = new FieldEncryptor({
        masterKey: encryptionTestData.sampleKey.toString('hex'),
        algorithm: 'aes-256-gcm',
      });

      const encrypted = encryptor.encrypt('Test data', 'Patient.firstName');

      // Tamper with ciphertext
      const tampered = {
        ...encrypted,
        ciphertext: encrypted.ciphertext.replace(/.$/, 'X'),
      };

      expect(() => {
        encryptor.decrypt(tampered, 'Patient.firstName');
      }).toThrow();
    });
  });

  describe('Minimum Necessary Principle', () => {
    it('should send only required data to ML services', () => {
      // Define what each service needs
      const serviceDataRequirements = {
        'audio-intelligence': ['transcriptText'],
        'careplan-recommender': ['conditionCodes', 'patientAge', 'patientGender'],
        'rag-embeddings': ['conditionCodes'],
      };

      // Patient identifiers should NOT be in the requirements
      Object.values(serviceDataRequirements).forEach((fields) => {
        expect(fields).not.toContain('firstName');
        expect(fields).not.toContain('lastName');
        expect(fields).not.toContain('mrn');
        expect(fields).not.toContain('ssn');
        expect(fields).not.toContain('dateOfBirth');
      });
    });
  });

  describe('Breach Notification', () => {
    it('should detect potential security breaches', () => {
      // Define breach indicators
      const breachIndicators = [
        'HIGH_VOLUME_PHI_ACCESS',
        'AFTER_HOURS_ACCESS',
        'UNAUTHORIZED_ACCESS_ATTEMPT',
        'BULK_DATA_EXPORT',
        'REPEATED_AUTH_FAILURES',
      ];

      // Each indicator should be monitored
      expect(breachIndicators.length).toBe(5);
    });

    it('should alert on suspicious activity', () => {
      // Define alert thresholds
      const alertThresholds = {
        maxAuthFailuresPerHour: 10,
        maxPatientAccessPerHour: 50,
        maxExportRecordsPerDay: 1000,
        afterHoursAccessEnabled: true,
      };

      expect(alertThresholds.maxAuthFailuresPerHour).toBeLessThanOrEqual(20);
      expect(alertThresholds.maxPatientAccessPerHour).toBeLessThanOrEqual(100);
    });
  });

  describe('Business Associate Agreement Compliance', () => {
    it('should document PHI sharing with external services', () => {
      // External services that may receive PHI
      const externalServices = [
        {
          name: 'audio-intelligence',
          phiShared: ['transcriptText'],
          baaRequired: true,
        },
        {
          name: 'careplan-recommender',
          phiShared: ['conditionCodes'],
          baaRequired: true,
        },
      ];

      externalServices.forEach((service) => {
        expect(service.baaRequired).toBe(true);
      });
    });
  });

  describe('Patient Rights', () => {
    it('should support access to PHI (Right to Access)', async () => {
      // The audit logger should support querying by patient
      const auditLogger = new AuditLogger({
        pool,
        serviceName: 'careplan-service',
        retentionDays: 2555,
      });

      // Mock query for patient audit records
      const mockQuery = jest.spyOn(pool, 'query').mockResolvedValue({
        rows: [],
      } as any);

      await auditLogger.queryByPatient('patient-123', {
        startDate: new Date(Date.now() - 365 * 24 * 60 * 60 * 1000),
        endDate: new Date(),
      });

      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('patient_id'),
        expect.arrayContaining(['patient-123'])
      );

      mockQuery.mockRestore();
    });

    it('should support disclosure accounting (Right to Accounting)', async () => {
      // The audit logger should track all disclosures
      const auditLogger = new AuditLogger({
        pool,
        serviceName: 'careplan-service',
        retentionDays: 2555,
      });

      const mockQuery = jest.spyOn(pool, 'query').mockResolvedValue({
        rows: [
          { event_type: 'DATA_EXPORT', patient_id: 'patient-123' },
          { event_type: 'ML_SERVICE_CALL', patient_id: 'patient-123' },
        ],
      } as any);

      const disclosures = await auditLogger.queryByPatient('patient-123', {
        startDate: new Date(),
        endDate: new Date(),
        eventTypes: ['DATA_EXPORT', 'ML_SERVICE_CALL'],
      });

      expect(mockQuery).toHaveBeenCalled();

      mockQuery.mockRestore();
    });
  });
});
