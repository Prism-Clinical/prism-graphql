/**
 * Integration test for the care plan generation flow.
 *
 * Tests the resolver layer with mocked RequestTracker and carePlanService,
 * verifying the full generate → accept/reject lifecycle.
 */

import {
  generateCarePlanFromVisit,
  acceptCarePlanDraft,
  rejectCarePlanDraft,
} from '@careplan/resolvers/mutations/generate-care-plan';

// Mock carePlanService (used by acceptCarePlanDraft)
const mockCreateCarePlan = jest.fn();
const mockAddGoal = jest.fn();
const mockAddIntervention = jest.fn();

jest.mock('@careplan/services/database', () => ({
  carePlanService: {
    createCarePlan: (...args: unknown[]) => mockCreateCarePlan(...args),
    addGoal: (...args: unknown[]) => mockAddGoal(...args),
    addIntervention: (...args: unknown[]) => mockAddIntervention(...args),
  },
}));

// Sample pipeline output for testing
const sampleDraftCarePlan = {
  id: 'draft-001',
  title: 'Diabetes Management Plan',
  conditionCodes: ['E11.9'],
  templateId: 'tmpl-001',
  goals: [
    {
      description: 'Reduce HbA1c to below 7%',
      targetValue: '< 7%',
      targetDate: '2026-06-15',
      priority: 'HIGH',
      guidelineReference: 'ADA 2026',
    },
  ],
  interventions: [
    {
      type: 'MEDICATION',
      description: 'Start metformin 500mg twice daily',
      medicationCode: 'RxNorm:6809',
      dosage: '500mg',
      frequency: 'BID',
      procedureCode: undefined,
      scheduledDate: undefined,
      patientInstructions: 'Take with meals',
      guidelineReference: 'ADA 2026',
    },
  ],
  generatedAt: new Date().toISOString(),
  confidence: 0.92,
  requiresReview: true,
};

const samplePipelineOutput = {
  requestId: 'req-001',
  extractedEntities: undefined,
  recommendations: [
    {
      templateId: 'tmpl-001',
      title: 'Diabetes Type 2 Standard',
      confidence: 0.95,
      matchedConditions: ['E11.9'],
      reasoning: 'High match for type 2 diabetes',
      guidelineSource: 'ADA 2026',
      evidenceGrade: 'A',
    },
  ],
  draftCarePlan: sampleDraftCarePlan,
  redFlags: [],
  processingMetadata: {
    requestId: 'req-001',
    correlationId: 'corr-001',
    totalDurationMs: 1200,
    stageResults: [],
    cacheHit: false,
    modelVersions: [],
    processedAt: new Date(),
  },
  degradedServices: [],
  requiresManualReview: false,
};

// Mock RequestTracker
function createMockRequestTracker(overrides: Record<string, jest.Mock> = {}) {
  return {
    createRequest: jest.fn().mockResolvedValue('req-001'),
    updateStatus: jest.fn().mockResolvedValue(undefined),
    complete: jest.fn().mockResolvedValue(undefined),
    fail: jest.fn().mockResolvedValue(undefined),
    getById: jest.fn().mockResolvedValue({
      id: 'req-001',
      visitId: 'visit-001',
      patientId: 'patient-001',
      userId: 'provider-001',
      status: 'COMPLETED',
      createdAt: new Date(),
      startedAt: new Date(),
      completedAt: new Date(),
    }),
    getDecryptedResult: jest.fn().mockResolvedValue(samplePipelineOutput),
    markAccepted: jest.fn().mockResolvedValue(undefined),
    markRejected: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function createMockContext(requestTracker: ReturnType<typeof createMockRequestTracker>) {
  return {
    userId: 'provider-001',
    userRole: 'PROVIDER',
    pool: {} as any,
    requestTracker,
  };
}

describe('Care Plan Generation Flow', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ─── generateCarePlanFromVisit ─────────────────────────────────────

  describe('generateCarePlanFromVisit', () => {
    it('creates a pipeline request and returns result', async () => {
      const tracker = createMockRequestTracker();
      const context = createMockContext(tracker);

      const result = await generateCarePlanFromVisit(
        {},
        {
          input: {
            visitId: 'visit-001',
            patientId: 'patient-001',
            conditionCodes: ['E11.9'],
            idempotencyKey: 'idem-001',
          },
        },
        context
      );

      expect(tracker.createRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          visitId: 'visit-001',
          patientId: 'patient-001',
          userId: 'provider-001',
          idempotencyKey: 'idem-001',
        })
      );
      expect(tracker.updateStatus).toHaveBeenCalledWith('req-001', 'IN_PROGRESS');
      expect(tracker.complete).toHaveBeenCalledWith('req-001', expect.any(Object));
      expect(result.requestId).toBe('req-001');
    });

    it('marks request as failed on pipeline error', async () => {
      const tracker = createMockRequestTracker({
        updateStatus: jest.fn().mockRejectedValue(new Error('Pipeline crash')),
      });
      const context = createMockContext(tracker);

      await expect(
        generateCarePlanFromVisit(
          {},
          {
            input: {
              visitId: 'visit-001',
              patientId: 'patient-001',
              conditionCodes: ['E11.9'],
              idempotencyKey: 'idem-001',
            },
          },
          context
        )
      ).rejects.toThrow();

      expect(tracker.fail).toHaveBeenCalledWith('req-001', expect.objectContaining({
        message: expect.any(String),
        code: 'PIPELINE_ERROR',
      }));
    });

    it('rejects missing patientId', async () => {
      const tracker = createMockRequestTracker();
      const context = createMockContext(tracker);

      await expect(
        generateCarePlanFromVisit(
          {},
          {
            input: {
              visitId: 'visit-001',
              patientId: '',
              conditionCodes: ['E11.9'],
              idempotencyKey: 'idem-001',
            },
          },
          context
        )
      ).rejects.toThrow('visitId and patientId are required');
    });

    it('rejects empty conditionCodes', async () => {
      const tracker = createMockRequestTracker();
      const context = createMockContext(tracker);

      await expect(
        generateCarePlanFromVisit(
          {},
          {
            input: {
              visitId: 'visit-001',
              patientId: 'patient-001',
              conditionCodes: [],
              idempotencyKey: 'idem-001',
            },
          },
          context
        )
      ).rejects.toThrow('At least one condition code is required');
    });

    it('rejects invalid ICD-10 code format', async () => {
      const tracker = createMockRequestTracker();
      const context = createMockContext(tracker);

      await expect(
        generateCarePlanFromVisit(
          {},
          {
            input: {
              visitId: 'visit-001',
              patientId: 'patient-001',
              conditionCodes: ['INVALID'],
              idempotencyKey: 'idem-001',
            },
          },
          context
        )
      ).rejects.toThrow('Invalid ICD-10 code format');
    });

    it('rejects unauthenticated user', async () => {
      const tracker = createMockRequestTracker();
      const context = { ...createMockContext(tracker), userId: '' };

      await expect(
        generateCarePlanFromVisit(
          {},
          {
            input: {
              visitId: 'visit-001',
              patientId: 'patient-001',
              conditionCodes: ['E11.9'],
              idempotencyKey: 'idem-001',
            },
          },
          context
        )
      ).rejects.toThrow('Authentication required');
    });
  });

  // ─── acceptCarePlanDraft ───────────────────────────────────────────

  describe('acceptCarePlanDraft', () => {
    it('creates care plan with goals and interventions from draft', async () => {
      const tracker = createMockRequestTracker();
      const context = createMockContext(tracker);

      mockCreateCarePlan.mockResolvedValue({
        id: 'cp-001',
        patientId: 'patient-001',
        title: 'Diabetes Management Plan',
        status: 'DRAFT',
        conditionCodes: ['E11.9'],
        createdAt: new Date(),
      });

      mockAddGoal.mockResolvedValue({
        id: 'goal-001',
        carePlanId: 'cp-001',
        description: 'Reduce HbA1c to below 7%',
        priority: 'HIGH',
      });

      mockAddIntervention.mockResolvedValue({
        id: 'int-001',
        carePlanId: 'cp-001',
        type: 'MEDICATION',
        description: 'Start metformin 500mg twice daily',
      });

      const result = await acceptCarePlanDraft(
        {},
        { requestId: 'req-001' },
        context
      );

      expect(result.id).toBe('cp-001');
      expect(mockCreateCarePlan).toHaveBeenCalledWith(
        expect.objectContaining({
          patientId: 'patient-001',
          title: 'Diabetes Management Plan',
          conditionCodes: ['E11.9'],
          createdBy: 'provider-001',
        })
      );
      expect(mockAddGoal).toHaveBeenCalledTimes(1);
      expect(mockAddIntervention).toHaveBeenCalledTimes(1);
      expect(tracker.markAccepted).toHaveBeenCalledWith('req-001', 'cp-001', 'provider-001');
    });

    it('applies title edits', async () => {
      const tracker = createMockRequestTracker();
      const context = createMockContext(tracker);

      mockCreateCarePlan.mockResolvedValue({
        id: 'cp-001',
        patientId: 'patient-001',
        title: 'Custom Title',
        status: 'DRAFT',
        conditionCodes: ['E11.9'],
        createdAt: new Date(),
      });
      mockAddGoal.mockResolvedValue({ id: 'goal-001' });
      mockAddIntervention.mockResolvedValue({ id: 'int-001' });

      await acceptCarePlanDraft(
        {},
        {
          requestId: 'req-001',
          edits: [{ field: 'title', value: 'Custom Title' }],
        },
        context
      );

      expect(mockCreateCarePlan).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Custom Title' })
      );
    });

    it('rejects when request not found', async () => {
      const tracker = createMockRequestTracker({
        getDecryptedResult: jest.fn().mockResolvedValue(null),
      });
      const context = createMockContext(tracker);

      await expect(
        acceptCarePlanDraft({}, { requestId: 'req-999' }, context)
      ).rejects.toThrow('Pipeline request not found');
    });

    it('rejects when request is not COMPLETED', async () => {
      const tracker = createMockRequestTracker({
        getById: jest.fn().mockResolvedValue({
          id: 'req-001',
          status: 'IN_PROGRESS',
        }),
      });
      const context = createMockContext(tracker);

      await expect(
        acceptCarePlanDraft({}, { requestId: 'req-001' }, context)
      ).rejects.toThrow('not in COMPLETED status');
    });

    it('rejects when no draft in pipeline result', async () => {
      const tracker = createMockRequestTracker({
        getDecryptedResult: jest.fn().mockResolvedValue({
          ...samplePipelineOutput,
          draftCarePlan: undefined,
        }),
      });
      const context = createMockContext(tracker);

      await expect(
        acceptCarePlanDraft({}, { requestId: 'req-001' }, context)
      ).rejects.toThrow('No draft care plan');
    });
  });

  // ─── rejectCarePlanDraft ───────────────────────────────────────────

  describe('rejectCarePlanDraft', () => {
    it('marks request as rejected with reason', async () => {
      const tracker = createMockRequestTracker();
      const context = createMockContext(tracker);

      const result = await rejectCarePlanDraft(
        {},
        { requestId: 'req-001', reason: 'Incorrect medication dosage' },
        context
      );

      expect(result.requestId).toBe('req-001');
      expect(result.status).toBe('REJECTED');
      expect(tracker.markRejected).toHaveBeenCalledWith(
        'req-001',
        'Incorrect medication dosage',
        'provider-001'
      );
    });

    it('rejects when request not found', async () => {
      const tracker = createMockRequestTracker({
        getById: jest.fn().mockResolvedValue(null),
      });
      const context = createMockContext(tracker);

      await expect(
        rejectCarePlanDraft(
          {},
          { requestId: 'req-999', reason: 'Bad plan' },
          context
        )
      ).rejects.toThrow('Pipeline request not found');
    });

    it('rejects when request is not COMPLETED', async () => {
      const tracker = createMockRequestTracker({
        getById: jest.fn().mockResolvedValue({
          id: 'req-001',
          status: 'ACCEPTED',
        }),
      });
      const context = createMockContext(tracker);

      await expect(
        rejectCarePlanDraft(
          {},
          { requestId: 'req-001', reason: 'Bad plan' },
          context
        )
      ).rejects.toThrow('not in COMPLETED status');
    });

    it('rejects empty reason', async () => {
      const tracker = createMockRequestTracker();
      const context = createMockContext(tracker);

      await expect(
        rejectCarePlanDraft(
          {},
          { requestId: 'req-001', reason: '  ' },
          context
        )
      ).rejects.toThrow('Rejection reason is required');
    });

    it('rejects unauthenticated user', async () => {
      const tracker = createMockRequestTracker();
      const context = { ...createMockContext(tracker), userId: '' };

      await expect(
        rejectCarePlanDraft(
          {},
          { requestId: 'req-001', reason: 'Bad plan' },
          context
        )
      ).rejects.toThrow('Authentication required');
    });
  });
});
