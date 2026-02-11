/**
 * ML Service Mocks for Testing
 *
 * Mock implementations of ML service responses for unit and integration testing.
 */

import { v4 as uuidv4 } from 'uuid';

/**
 * Mock Audio Intelligence Service responses
 */
export const mockAudioIntelligenceResponses = {
  successfulExtraction: {
    entities: [
      {
        type: 'SYMPTOM',
        text: 'chest pain',
        confidence: 0.95,
        span: { start: 10, end: 20 },
      },
      {
        type: 'MEDICATION',
        text: 'aspirin',
        confidence: 0.92,
        span: { start: 50, end: 57 },
      },
      {
        type: 'VITAL',
        text: 'blood pressure 140/90',
        confidence: 0.98,
        span: { start: 100, end: 121 },
      },
    ],
    redFlags: [
      {
        type: 'CRITICAL_SYMPTOM',
        description: 'Chest pain requires immediate evaluation',
        confidence: 0.89,
      },
    ],
    processingTime: 1200,
  },

  emptyExtraction: {
    entities: [],
    redFlags: [],
    processingTime: 500,
  },

  serviceError: {
    error: 'Service temporarily unavailable',
    code: 'SERVICE_UNAVAILABLE',
  },

  validationError: {
    error: 'Invalid transcript format',
    code: 'VALIDATION_ERROR',
    details: { field: 'transcriptText', message: 'Text cannot be empty' },
  },
};

/**
 * Mock Care Plan Recommender Service responses
 */
export const mockRecommenderResponses = {
  successfulRecommendation: {
    recommendations: [
      {
        templateId: uuidv4(),
        title: 'Cardiac Care Plan',
        confidence: 0.92,
        matchedConditions: ['I25.10', 'I10'],
        reasoning: 'Based on hypertension and coronary artery disease diagnosis',
      },
      {
        templateId: uuidv4(),
        title: 'Hypertension Management Plan',
        confidence: 0.88,
        matchedConditions: ['I10'],
        reasoning: 'Primary hypertension management protocol',
      },
    ],
    processingTime: 800,
  },

  emptyRecommendation: {
    recommendations: [],
    processingTime: 300,
  },

  draftGeneration: {
    draft: {
      id: uuidv4(),
      title: 'Care Plan Draft',
      goals: [
        {
          id: uuidv4(),
          description: 'Reduce blood pressure to <130/80',
          targetDate: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString(),
          priority: 'HIGH',
        },
      ],
      interventions: [
        {
          id: uuidv4(),
          description: 'Daily blood pressure monitoring',
          frequency: 'DAILY',
          responsibleParty: 'PATIENT',
        },
        {
          id: uuidv4(),
          description: 'Medication adherence check',
          frequency: 'WEEKLY',
          responsibleParty: 'CARE_COORDINATOR',
        },
      ],
      medications: [
        {
          name: 'Lisinopril',
          dosage: '10mg',
          frequency: 'Daily',
          instructions: 'Take in the morning with food',
        },
      ],
    },
    processingTime: 1500,
  },
};

/**
 * Mock RAG Embeddings Service responses
 */
export const mockRagEmbeddingsResponses = {
  successfulEmbedding: {
    embeddings: [
      // 768-dimensional vector (truncated for brevity, filled with random values)
      Array.from({ length: 768 }, () => Math.random() - 0.5),
    ],
    processingTime: 200,
  },

  batchEmbedding: {
    embeddings: [
      Array.from({ length: 768 }, () => Math.random() - 0.5),
      Array.from({ length: 768 }, () => Math.random() - 0.5),
      Array.from({ length: 768 }, () => Math.random() - 0.5),
    ],
    processingTime: 400,
  },

  searchResults: {
    results: [
      {
        id: uuidv4(),
        similarity: 0.95,
        metadata: { templateId: uuidv4(), title: 'Cardiac Care Plan' },
      },
      {
        id: uuidv4(),
        similarity: 0.88,
        metadata: { templateId: uuidv4(), title: 'Hypertension Plan' },
      },
    ],
    processingTime: 150,
  },
};

/**
 * Mock PDF Parser Service responses
 */
export const mockPdfParserResponses = {
  successfulParse: {
    title: 'Imported Care Plan',
    goals: [
      {
        description: 'Improve cardiovascular health',
        targetDate: '2024-12-31',
      },
    ],
    interventions: [
      {
        description: 'Regular exercise program',
        frequency: '3x weekly',
      },
    ],
    medications: [
      {
        name: 'Metoprolol',
        dosage: '25mg',
        frequency: 'Twice daily',
      },
    ],
    extractedText: 'This is the extracted text from the PDF...',
    pageCount: 5,
    processingTime: 2000,
  },

  emptyParse: {
    title: 'Empty Document',
    goals: [],
    interventions: [],
    medications: [],
    extractedText: '',
    pageCount: 1,
    processingTime: 500,
  },

  invalidPdf: {
    error: 'Invalid PDF format',
    code: 'INVALID_FORMAT',
  },
};

/**
 * Create a mock HTTP response
 */
export function createMockResponse<T>(data: T, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    json: async () => data,
    text: async () => JSON.stringify(data),
    headers: new Headers({ 'Content-Type': 'application/json' }),
  } as Response;
}

/**
 * Create a mock fetch function for testing
 */
export function createMockFetch(responses: Map<string, Response>): typeof fetch {
  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input.toString();

    for (const [pattern, response] of responses) {
      if (url.includes(pattern)) {
        return response;
      }
    }

    // Default to 404
    return createMockResponse({ error: 'Not found' }, 404);
  };
}

/**
 * Mock circuit breaker state tracker
 */
export class MockCircuitBreakerTracker {
  private failures: Map<string, number> = new Map();
  private lastFailure: Map<string, number> = new Map();
  private state: Map<string, 'CLOSED' | 'OPEN' | 'HALF_OPEN'> = new Map();

  recordFailure(service: string): void {
    const count = (this.failures.get(service) || 0) + 1;
    this.failures.set(service, count);
    this.lastFailure.set(service, Date.now());

    if (count >= 5) {
      this.state.set(service, 'OPEN');
    }
  }

  recordSuccess(service: string): void {
    this.failures.set(service, 0);
    this.state.set(service, 'CLOSED');
  }

  getState(service: string): 'CLOSED' | 'OPEN' | 'HALF_OPEN' {
    return this.state.get(service) || 'CLOSED';
  }

  getFailureCount(service: string): number {
    return this.failures.get(service) || 0;
  }

  reset(): void {
    this.failures.clear();
    this.lastFailure.clear();
    this.state.clear();
  }
}

/**
 * Mock metrics collector
 */
export class MockMetricsCollector {
  private counters: Map<string, number> = new Map();
  private histograms: Map<string, number[]> = new Map();
  private gauges: Map<string, number> = new Map();

  incrementCounter(name: string, labels?: Record<string, string>): void {
    const key = this.formatKey(name, labels);
    this.counters.set(key, (this.counters.get(key) || 0) + 1);
  }

  recordHistogram(name: string, value: number, labels?: Record<string, string>): void {
    const key = this.formatKey(name, labels);
    const values = this.histograms.get(key) || [];
    values.push(value);
    this.histograms.set(key, values);
  }

  setGauge(name: string, value: number, labels?: Record<string, string>): void {
    const key = this.formatKey(name, labels);
    this.gauges.set(key, value);
  }

  getCounter(name: string, labels?: Record<string, string>): number {
    return this.counters.get(this.formatKey(name, labels)) || 0;
  }

  getHistogramValues(name: string, labels?: Record<string, string>): number[] {
    return this.histograms.get(this.formatKey(name, labels)) || [];
  }

  getGauge(name: string, labels?: Record<string, string>): number {
    return this.gauges.get(this.formatKey(name, labels)) || 0;
  }

  private formatKey(name: string, labels?: Record<string, string>): string {
    if (!labels) return name;
    const labelStr = Object.entries(labels)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}="${v}"`)
      .join(',');
    return `${name}{${labelStr}}`;
  }

  reset(): void {
    this.counters.clear();
    this.histograms.clear();
    this.gauges.clear();
  }
}

/**
 * Mock audit logger for testing
 */
export class MockAuditLogger {
  private logs: Array<{
    eventType: string;
    userId?: string;
    patientId?: string;
    resource: string;
    action: string;
    phiAccessed: boolean;
    timestamp: Date;
    metadata?: Record<string, unknown>;
  }> = [];

  async log(event: {
    eventType: string;
    userId?: string;
    patientId?: string;
    resource: string;
    action: string;
    phiAccessed: boolean;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    this.logs.push({
      ...event,
      timestamp: new Date(),
    });
  }

  getLogs(): typeof this.logs {
    return [...this.logs];
  }

  getLogsByPatient(patientId: string): typeof this.logs {
    return this.logs.filter((log) => log.patientId === patientId);
  }

  getLogsByUser(userId: string): typeof this.logs {
    return this.logs.filter((log) => log.userId === userId);
  }

  getPhiAccessLogs(): typeof this.logs {
    return this.logs.filter((log) => log.phiAccessed);
  }

  clear(): void {
    this.logs.length = 0;
  }
}

/**
 * Mock encryption service
 */
export class MockEncryptionService {
  private encryptedValues: Map<string, { original: string; encrypted: string }> = new Map();

  encrypt(value: string, fieldName: string): string {
    const encrypted = Buffer.from(value).toString('base64');
    this.encryptedValues.set(encrypted, { original: value, encrypted });
    return `encrypted:${fieldName}:${encrypted}`;
  }

  decrypt(encrypted: string, fieldName: string): string {
    const match = encrypted.match(/^encrypted:([^:]+):(.+)$/);
    if (!match) {
      throw new Error('Invalid encrypted value format');
    }
    const [, field, data] = match;
    if (field !== fieldName) {
      throw new Error('Field name mismatch');
    }
    return Buffer.from(data, 'base64').toString('utf-8');
  }

  isEncrypted(value: string): boolean {
    return value.startsWith('encrypted:');
  }
}
