import { v4 as uuidv4 } from 'uuid';
import {
  detectMissingPrefetch,
  isPrefetchIncomplete,
  resolvePrefetch,
  buildHookContext,
  createPrefetchWarningCard,
  shouldAddPrefetchWarning,
} from '../services/prefetch';
import type { CDSHookRequest, CDSServiceDefinition } from '../types';

// Mock fetch globally
const mockFetch = jest.fn();
global.fetch = mockFetch;

describe('FHIR Prefetch Handler', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  // Simple mock service with only 2 prefetch keys for unit testing
  const mockService: CDSServiceDefinition = {
    id: 'test-service',
    hook: 'patient-view',
    title: 'Test Service',
    description: 'Test',
    prefetch: {
      patient: 'Patient/{{context.patientId}}',
      conditions: 'Condition?patient={{context.patientId}}&clinical-status=active',
    },
  };

  const baseRequest: CDSHookRequest = {
    hookInstance: uuidv4(),
    hook: 'patient-view',
    context: {
      userId: 'Practitioner/123',
      patientId: 'Patient/456',
    },
  };

  // Helper to create full prefetch for prism-patient-view service (4 keys)
  const createFullPrefetch = () => ({
    patient: { resourceType: 'Patient', id: '456' },
    conditions: { resourceType: 'Bundle', entry: [] },
    medications: { resourceType: 'Bundle', entry: [] },
    observations: { resourceType: 'Bundle', entry: [] },
  });

  describe('detectMissingPrefetch', () => {
    it('should return all keys when no prefetch provided', () => {
      const missing = detectMissingPrefetch(baseRequest, mockService);
      expect(missing).toContain('patient');
      expect(missing).toContain('conditions');
      expect(missing.length).toBe(2);
    });

    it('should return empty when all prefetch provided', () => {
      const requestWithPrefetch: CDSHookRequest = {
        ...baseRequest,
        prefetch: {
          patient: { resourceType: 'Patient', id: '456' },
          conditions: { resourceType: 'Bundle', entry: [] },
        },
      };
      const missing = detectMissingPrefetch(requestWithPrefetch, mockService);
      expect(missing.length).toBe(0);
    });

    it('should return only missing keys when partial prefetch provided', () => {
      const requestWithPartialPrefetch: CDSHookRequest = {
        ...baseRequest,
        prefetch: {
          patient: { resourceType: 'Patient', id: '456' },
        },
      };
      const missing = detectMissingPrefetch(requestWithPartialPrefetch, mockService);
      expect(missing).toContain('conditions');
      expect(missing.length).toBe(1);
    });

    it('should treat null prefetch values as missing', () => {
      const requestWithNullPrefetch: CDSHookRequest = {
        ...baseRequest,
        prefetch: {
          patient: null,
          conditions: { resourceType: 'Bundle', entry: [] },
        },
      };
      const missing = detectMissingPrefetch(requestWithNullPrefetch, mockService);
      expect(missing).toContain('patient');
      expect(missing.length).toBe(1);
    });
  });

  describe('isPrefetchIncomplete', () => {
    it('should return true when prefetch is missing', () => {
      expect(isPrefetchIncomplete(baseRequest, mockService)).toBe(true);
    });

    it('should return false when all prefetch is provided', () => {
      const requestWithPrefetch: CDSHookRequest = {
        ...baseRequest,
        prefetch: {
          patient: { resourceType: 'Patient', id: '456' },
          conditions: { resourceType: 'Bundle', entry: [] },
        },
      };
      expect(isPrefetchIncomplete(requestWithPrefetch, mockService)).toBe(false);
    });
  });

  describe('resolvePrefetch', () => {
    it('should return provided prefetch data without fetching', async () => {
      // Use full prefetch for the real service
      const requestWithPrefetch: CDSHookRequest = {
        ...baseRequest,
        prefetch: createFullPrefetch(),
      };

      const result = await resolvePrefetch(requestWithPrefetch, 'prism-patient-view');

      expect(result.complete).toBe(true);
      expect(result.errors.size).toBe(0);
      expect(result.data.patient).toEqual({ resourceType: 'Patient', id: '456' });
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should fetch missing prefetch data from FHIR server', async () => {
      const requestWithFhirServer: CDSHookRequest = {
        ...baseRequest,
        fhirServer: 'https://fhir.example.com/r4',
        fhirAuthorization: {
          access_token: 'test-token',
          token_type: 'Bearer',
          expires_in: 3600,
          scope: 'patient/*.read',
          subject: 'Patient/456',
        },
      };

      // Mock successful fetch responses for all 4 prefetch keys
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ resourceType: 'Bundle', entry: [] }),
      });

      const result = await resolvePrefetch(requestWithFhirServer, 'prism-patient-view');

      expect(result.complete).toBe(true);
      expect(result.errors.size).toBe(0);
      expect(mockFetch).toHaveBeenCalledTimes(4); // 4 prefetch keys
    });

    it('should substitute context variables in prefetch templates', async () => {
      const requestWithFhirServer: CDSHookRequest = {
        ...baseRequest,
        fhirServer: 'https://fhir.example.com/r4',
        context: {
          userId: 'Practitioner/123',
          patientId: '456',
        },
      };

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ resourceType: 'Patient', id: '456' }),
      });

      await resolvePrefetch(requestWithFhirServer, 'prism-patient-view');

      // Check that patientId was substituted in at least one call
      const calls = mockFetch.mock.calls;
      const hasPatientId = calls.some((call: unknown[]) =>
        String(call[0]).includes('456')
      );
      expect(hasPatientId).toBe(true);
    });

    it('should use authorization header when provided', async () => {
      const requestWithAuth: CDSHookRequest = {
        ...baseRequest,
        fhirServer: 'https://fhir.example.com/r4',
        fhirAuthorization: {
          access_token: 'my-access-token',
          token_type: 'Bearer',
          expires_in: 3600,
          scope: 'patient/*.read',
          subject: 'Patient/456',
        },
      };

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ resourceType: 'Patient', id: '456' }),
      });

      await resolvePrefetch(requestWithAuth, 'prism-patient-view');

      const firstCall = mockFetch.mock.calls[0] as [string, RequestInit];
      const headers = firstCall[1].headers as Record<string, string>;
      expect(headers.Authorization).toBe('Bearer my-access-token');
    });

    it('should handle fetch errors gracefully', async () => {
      const requestWithFhirServer: CDSHookRequest = {
        ...baseRequest,
        fhirServer: 'https://fhir.example.com/r4',
      };

      // First call fails, rest succeed
      mockFetch
        .mockResolvedValueOnce({
          ok: false,
          status: 404,
          statusText: 'Not Found',
        })
        .mockResolvedValue({
          ok: true,
          json: async () => ({ resourceType: 'Bundle', entry: [] }),
        });

      const result = await resolvePrefetch(requestWithFhirServer, 'prism-patient-view');

      expect(result.complete).toBe(false);
      expect(result.errors.size).toBeGreaterThanOrEqual(1);
    });

    it('should return incomplete when no FHIR server provided', async () => {
      const result = await resolvePrefetch(baseRequest, 'prism-patient-view');

      expect(result.complete).toBe(false);
      expect(result.data.patient).toBeNull();
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should return error for unknown service', async () => {
      const result = await resolvePrefetch(baseRequest, 'unknown-service');

      expect(result.complete).toBe(false);
      expect(result.errors.has('service')).toBe(true);
    });

    it('should fetch resources in parallel', async () => {
      const requestWithFhirServer: CDSHookRequest = {
        ...baseRequest,
        fhirServer: 'https://fhir.example.com/r4',
      };

      let callCount = 0;

      mockFetch.mockImplementation(async () => {
        callCount++;
        // Simulate network delay
        await new Promise(resolve => setTimeout(resolve, 10));
        return {
          ok: true,
          json: async () => ({ resourceType: 'Test', index: callCount }),
        };
      });

      await resolvePrefetch(requestWithFhirServer, 'prism-patient-view');

      // All 4 calls should be made
      expect(mockFetch).toHaveBeenCalledTimes(4);
    });
  });

  describe('buildHookContext', () => {
    it('should build context with prefetch data', async () => {
      const requestWithPrefetch: CDSHookRequest = {
        ...baseRequest,
        prefetch: createFullPrefetch(),
      };

      const context = await buildHookContext(requestWithPrefetch, 'prism-patient-view');

      expect(context.request).toBe(requestWithPrefetch);
      expect(context.prefetch.patient).toBeDefined();
      expect(context.warnings.length).toBe(0);
    });

    it('should add warnings for fetch errors', async () => {
      const requestWithFhirServer: CDSHookRequest = {
        ...baseRequest,
        fhirServer: 'https://fhir.example.com/r4',
      };

      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      });

      const context = await buildHookContext(requestWithFhirServer, 'prism-patient-view');

      expect(context.warnings.length).toBeGreaterThan(0);
      expect(context.warnings.some(w => w.includes('Failed to fetch'))).toBe(true);
    });

    it('should add warning for missing prefetch data', async () => {
      const context = await buildHookContext(baseRequest, 'prism-patient-view');

      expect(context.warnings.some(w => w.includes('Missing prefetch data'))).toBe(true);
    });
  });

  describe('createPrefetchWarningCard', () => {
    it('should create warning card with correct indicator', () => {
      const warnings = ['Failed to fetch patient data', 'Missing conditions'];
      const card = createPrefetchWarningCard(warnings);

      expect(card.indicator).toBe('warning');
      expect(card.summary).toBe('Data fetch warning');
      expect(card.detail).toContain('Failed to fetch patient data');
      expect(card.detail).toContain('Missing conditions');
    });

    it('should include source information', () => {
      const card = createPrefetchWarningCard(['Test warning']);

      expect(card.source.label).toBe('Prism CDS');
    });
  });

  describe('shouldAddPrefetchWarning', () => {
    it('should return true when there are warnings', async () => {
      const context = await buildHookContext(baseRequest, 'prism-patient-view');
      expect(shouldAddPrefetchWarning(context)).toBe(true);
    });

    it('should return false when no warnings', async () => {
      const requestWithPrefetch: CDSHookRequest = {
        ...baseRequest,
        prefetch: createFullPrefetch(),
      };

      const context = await buildHookContext(requestWithPrefetch, 'prism-patient-view');
      expect(shouldAddPrefetchWarning(context)).toBe(false);
    });
  });
});
