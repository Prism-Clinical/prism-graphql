/**
 * Audit Logger Unit Tests
 *
 * Tests for HIPAA-compliant audit logging.
 */

import { AuditLogger, AuditEvent, AuditEventType, AuditOutcome } from '../audit/audit-logger';
import { sampleAuditEvents } from '@test-utils/fixtures/security-fixtures';
import { Pool } from 'pg';

// Mock database pool
const mockPool = {
  query: jest.fn(),
} as unknown as Pool;

describe('AuditLogger', () => {
  let auditLogger: AuditLogger;

  beforeEach(() => {
    jest.clearAllMocks();
    mockPool.query = jest.fn().mockResolvedValue({ rows: [{ id: 'audit-123' }] });

    auditLogger = new AuditLogger({
      pool: mockPool,
      serviceName: 'careplan-service',
      retentionDays: 2555, // 7 years
    });
  });

  describe('logAccess', () => {
    it('should log PHI access event with all required fields', async () => {
      const event = sampleAuditEvents.phiAccessEvent;

      await auditLogger.logAccess(event);

      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO audit_log'),
        expect.arrayContaining([
          event.eventType,
          event.userId,
          event.userRole,
          event.patientId,
          event.resourceType,
          event.resourceId,
          event.action,
          event.phiAccessed,
          event.phiFields,
          event.ipAddress,
          event.userAgent,
          event.requestId,
          event.correlationId,
          event.outcome,
        ])
      );
    });

    it('should include timestamp in log', async () => {
      const event = sampleAuditEvents.phiAccessEvent;

      const beforeLog = new Date();
      await auditLogger.logAccess(event);
      const afterLog = new Date();

      expect(mockPool.query).toHaveBeenCalledWith(
        expect.any(String),
        expect.arrayContaining([
          expect.any(Date),
        ])
      );
    });

    it('should log care plan creation events', async () => {
      const event = sampleAuditEvents.carePlanCreationEvent;

      await auditLogger.logAccess(event);

      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO audit_log'),
        expect.arrayContaining([
          'RESOURCE_CREATED',
          event.resourceType,
          'CREATE',
        ])
      );
    });

    it('should handle optional fields gracefully', async () => {
      const minimalEvent = {
        eventType: 'PHI_ACCESS',
        userId: 'user-123',
        userRole: 'PROVIDER',
        resourceType: 'Patient',
        action: 'READ',
        phiAccessed: true,
        requestId: 'req-123',
        outcome: 'SUCCESS' as AuditOutcome,
      };

      await auditLogger.logAccess(minimalEvent);

      expect(mockPool.query).toHaveBeenCalled();
    });
  });

  describe('logUnauthorizedAccess', () => {
    it('should log unauthorized access attempts', async () => {
      const event = sampleAuditEvents.unauthorizedAccessEvent;

      await auditLogger.logUnauthorizedAccess(event);

      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO audit_log'),
        expect.arrayContaining([
          'UNAUTHORIZED_ACCESS',
          'DENIED',
        ])
      );
    });

    it('should include failure reason', async () => {
      const event = sampleAuditEvents.unauthorizedAccessEvent;

      await auditLogger.logUnauthorizedAccess(event);

      expect(mockPool.query).toHaveBeenCalledWith(
        expect.any(String),
        expect.arrayContaining([
          event.failureReason,
        ])
      );
    });
  });

  describe('logAuthFailure', () => {
    it('should log authentication failures', async () => {
      const event = sampleAuditEvents.authFailureEvent;

      await auditLogger.logAuthFailure(event);

      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO audit_log'),
        expect.arrayContaining([
          'AUTH_FAILURE',
          'FAILURE',
        ])
      );
    });

    it('should include metadata about the failure', async () => {
      const event = sampleAuditEvents.authFailureEvent;

      await auditLogger.logAuthFailure(event);

      expect(mockPool.query).toHaveBeenCalledWith(
        expect.any(String),
        expect.arrayContaining([
          expect.objectContaining({
            attemptedResource: '/graphql',
          }),
        ])
      );
    });
  });

  describe('logMLServiceCall', () => {
    it('should log ML service calls with patient context', async () => {
      const event = {
        userId: 'user-123',
        userRole: 'PROVIDER',
        patientId: 'patient-456',
        service: 'audio-intelligence',
        endpoint: '/extract',
        requestId: 'req-789',
        correlationId: 'corr-abc',
        phiAccessed: true,
        phiFields: ['Transcript.text'],
        outcome: 'SUCCESS' as AuditOutcome,
        responseTimeMs: 1200,
      };

      await auditLogger.logMLServiceCall(event);

      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO audit_log'),
        expect.arrayContaining([
          'ML_SERVICE_CALL',
          event.patientId,
          event.phiAccessed,
        ])
      );
    });

    it('should log data sent to external services', async () => {
      const event = {
        userId: 'user-123',
        userRole: 'PROVIDER',
        patientId: 'patient-456',
        service: 'audio-intelligence',
        endpoint: '/extract',
        requestId: 'req-789',
        correlationId: 'corr-abc',
        phiAccessed: true,
        phiFields: ['Transcript.text'],
        dataSent: { fieldCount: 5, hasTranscript: true },
        outcome: 'SUCCESS' as AuditOutcome,
      };

      await auditLogger.logMLServiceCall(event);

      expect(mockPool.query).toHaveBeenCalledWith(
        expect.any(String),
        expect.arrayContaining([
          expect.objectContaining({
            service: 'audio-intelligence',
            dataSent: expect.any(Object),
          }),
        ])
      );
    });
  });

  describe('logDataExport', () => {
    it('should log PHI export operations', async () => {
      const event = {
        userId: 'user-123',
        userRole: 'PROVIDER',
        patientId: 'patient-456',
        exportType: 'PDF',
        recordCount: 10,
        phiFields: ['Patient.firstName', 'Patient.lastName', 'CarePlan.goals'],
        requestId: 'req-export',
        outcome: 'SUCCESS' as AuditOutcome,
      };

      await auditLogger.logDataExport(event);

      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO audit_log'),
        expect.arrayContaining([
          'DATA_EXPORT',
          true, // phiAccessed
        ])
      );
    });
  });

  describe('Query functions', () => {
    describe('queryByPatient', () => {
      it('should query audit logs by patient ID', async () => {
        mockPool.query = jest.fn().mockResolvedValue({
          rows: [
            { id: 'log-1', event_type: 'PHI_ACCESS', patient_id: 'patient-123' },
            { id: 'log-2', event_type: 'PHI_ACCESS', patient_id: 'patient-123' },
          ],
        });

        const logs = await auditLogger.queryByPatient('patient-123', {
          startDate: new Date(Date.now() - 86400000),
          endDate: new Date(),
        });

        expect(mockPool.query).toHaveBeenCalledWith(
          expect.stringContaining('SELECT'),
          expect.arrayContaining(['patient-123'])
        );
        expect(logs).toHaveLength(2);
      });

      it('should support pagination', async () => {
        mockPool.query = jest.fn().mockResolvedValue({ rows: [] });

        await auditLogger.queryByPatient('patient-123', {
          startDate: new Date(),
          endDate: new Date(),
          limit: 50,
          offset: 100,
        });

        expect(mockPool.query).toHaveBeenCalledWith(
          expect.stringContaining('LIMIT'),
          expect.arrayContaining([50, 100])
        );
      });
    });

    describe('queryByUser', () => {
      it('should query audit logs by user ID', async () => {
        mockPool.query = jest.fn().mockResolvedValue({ rows: [] });

        await auditLogger.queryByUser('user-123', {
          startDate: new Date(),
          endDate: new Date(),
        });

        expect(mockPool.query).toHaveBeenCalledWith(
          expect.stringContaining('user_id'),
          expect.arrayContaining(['user-123'])
        );
      });
    });

    describe('queryPHIAccess', () => {
      it('should query only PHI access events', async () => {
        mockPool.query = jest.fn().mockResolvedValue({ rows: [] });

        await auditLogger.queryPHIAccess({
          startDate: new Date(),
          endDate: new Date(),
        });

        expect(mockPool.query).toHaveBeenCalledWith(
          expect.stringContaining('phi_accessed = true'),
          expect.any(Array)
        );
      });
    });
  });

  describe('Immutability', () => {
    it('should not support update operations', () => {
      expect(auditLogger.update).toBeUndefined();
      expect((auditLogger as any).updateLog).toBeUndefined();
    });

    it('should not support delete operations', () => {
      expect(auditLogger.delete).toBeUndefined();
      expect((auditLogger as any).deleteLog).toBeUndefined();
    });
  });

  describe('Error handling', () => {
    it('should throw on database errors but not expose details', async () => {
      mockPool.query = jest.fn().mockRejectedValue(new Error('Connection failed'));

      await expect(
        auditLogger.logAccess(sampleAuditEvents.phiAccessEvent)
      ).rejects.toThrow('Failed to write audit log');
    });

    it('should include request ID in error for troubleshooting', async () => {
      mockPool.query = jest.fn().mockRejectedValue(new Error('Connection failed'));

      try {
        await auditLogger.logAccess(sampleAuditEvents.phiAccessEvent);
      } catch (error: any) {
        expect(error.requestId).toBeDefined();
      }
    });
  });

  describe('PHI protection in logs', () => {
    it('should not include actual PHI values in metadata', async () => {
      const eventWithPHI = {
        ...sampleAuditEvents.phiAccessEvent,
        metadata: {
          queriedValue: 'John Doe', // This should be filtered
          operation: 'read',
        },
      };

      await auditLogger.logAccess(eventWithPHI);

      const callArgs = (mockPool.query as jest.Mock).mock.calls[0][1];
      const metadataArg = callArgs.find(
        (arg: any) => typeof arg === 'object' && arg.operation
      );

      if (metadataArg) {
        expect(metadataArg.queriedValue).toBeUndefined();
        expect(metadataArg.operation).toBe('read');
      }
    });

    it('should hash any identifiers in metadata', async () => {
      const eventWithId = {
        ...sampleAuditEvents.phiAccessEvent,
        metadata: {
          searchedMRN: 'MRN-12345678',
        },
      };

      await auditLogger.logAccess(eventWithId);

      const callArgs = (mockPool.query as jest.Mock).mock.calls[0][1];
      const metadataArg = callArgs.find(
        (arg: any) => typeof arg === 'object' && arg.searchedMRN
      );

      if (metadataArg) {
        expect(metadataArg.searchedMRN).not.toBe('MRN-12345678');
      }
    });
  });

  describe('Retention policy', () => {
    it('should include retention metadata', async () => {
      await auditLogger.logAccess(sampleAuditEvents.phiAccessEvent);

      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('expires_at'),
        expect.any(Array)
      );
    });

    it('should set retention period based on configuration', async () => {
      await auditLogger.logAccess(sampleAuditEvents.phiAccessEvent);

      const callArgs = (mockPool.query as jest.Mock).mock.calls[0][1];
      const expiresAtArg = callArgs.find(
        (arg: any) => arg instanceof Date && arg.getTime() > Date.now() + 86400000 * 2550
      );

      expect(expiresAtArg).toBeDefined();
    });
  });
});

describe('Audit Event Types', () => {
  it('should define all required event types', () => {
    expect(AuditEventType.PHI_ACCESS).toBe('PHI_ACCESS');
    expect(AuditEventType.RESOURCE_CREATED).toBe('RESOURCE_CREATED');
    expect(AuditEventType.RESOURCE_UPDATED).toBe('RESOURCE_UPDATED');
    expect(AuditEventType.RESOURCE_DELETED).toBe('RESOURCE_DELETED');
    expect(AuditEventType.AUTH_FAILURE).toBe('AUTH_FAILURE');
    expect(AuditEventType.UNAUTHORIZED_ACCESS).toBe('UNAUTHORIZED_ACCESS');
    expect(AuditEventType.DATA_EXPORT).toBe('DATA_EXPORT');
    expect(AuditEventType.ML_SERVICE_CALL).toBe('ML_SERVICE_CALL');
  });
});

describe('Audit Outcomes', () => {
  it('should define all required outcomes', () => {
    expect(AuditOutcome.SUCCESS).toBe('SUCCESS');
    expect(AuditOutcome.FAILURE).toBe('FAILURE');
    expect(AuditOutcome.DENIED).toBe('DENIED');
  });
});

describe('Compliance reporting', () => {
  let auditLogger: AuditLogger;

  beforeEach(() => {
    mockPool.query = jest.fn().mockResolvedValue({ rows: [] });
    auditLogger = new AuditLogger({
      pool: mockPool,
      serviceName: 'careplan-service',
      retentionDays: 2555,
    });
  });

  describe('generateAccessReport', () => {
    it('should generate patient access report for compliance', async () => {
      mockPool.query = jest.fn().mockResolvedValue({
        rows: [
          { user_id: 'user-1', access_count: 50, phi_access_count: 30 },
          { user_id: 'user-2', access_count: 100, phi_access_count: 75 },
        ],
      });

      const report = await auditLogger.generateAccessReport({
        patientId: 'patient-123',
        startDate: new Date(Date.now() - 30 * 86400000),
        endDate: new Date(),
      });

      expect(report.totalAccesses).toBeGreaterThan(0);
      expect(report.uniqueUsers).toBeGreaterThan(0);
      expect(report.accessByUser).toHaveLength(2);
    });
  });

  describe('detectAnomalies', () => {
    it('should detect unusual access patterns', async () => {
      mockPool.query = jest.fn().mockResolvedValue({
        rows: [
          { user_id: 'user-suspicious', access_count: 500, normal_baseline: 50 },
        ],
      });

      const anomalies = await auditLogger.detectAnomalies({
        timeWindow: 24 * 60 * 60 * 1000, // 24 hours
        threshold: 3, // 3x normal
      });

      expect(anomalies).toHaveLength(1);
      expect(anomalies[0].userId).toBe('user-suspicious');
    });
  });
});
