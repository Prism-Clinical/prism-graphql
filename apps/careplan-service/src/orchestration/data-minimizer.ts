/**
 * Data Minimization Layer
 *
 * Ensures only necessary data is sent to ML services.
 */

/**
 * Full patient context that may be available
 */
export interface FullPatientContext {
  patientId: string;
  firstName?: string;
  lastName?: string;
  dateOfBirth?: Date;
  mrn?: string;
  email?: string;
  phone?: string;
  address?: string;
  age?: number;
  gender?: string;
  conditionCodes: string[];
  chiefComplaint?: string;
  transcriptText?: string;
  medications?: string[];
  allergies?: string[];
}

/**
 * ML service identifiers
 */
export type MLService =
  | 'audio-intelligence'
  | 'careplan-recommender'
  | 'rag-embeddings'
  | 'pdf-parser';

/**
 * Minimal context for audio intelligence
 */
export interface AudioIntelligenceContext {
  transcriptText: string;
}

/**
 * Minimal context for care plan recommender
 */
export interface CarePlanRecommenderContext {
  conditionCodes: string[];
  age?: number;
  gender?: string;
}

/**
 * Minimal context for RAG embeddings
 */
export interface RagEmbeddingsContext {
  conditionCodes: string[];
  chiefComplaint?: string;
}

/**
 * Minimal context for PDF parser
 */
export interface PdfParserContext {
  // PDF parser only needs the file, no patient context
}

/**
 * Data requirements per ML service
 */
export const ML_SERVICE_DATA_REQUIREMENTS: Record<MLService, (keyof FullPatientContext)[]> = {
  'audio-intelligence': ['transcriptText'],
  'careplan-recommender': ['conditionCodes', 'age', 'gender'],
  'rag-embeddings': ['conditionCodes', 'chiefComplaint'],
  'pdf-parser': [],
};

/**
 * Fields that are considered PHI and should never be sent to ML services
 */
export const PHI_FIELDS: (keyof FullPatientContext)[] = [
  'firstName',
  'lastName',
  'dateOfBirth',
  'mrn',
  'email',
  'phone',
  'address',
];

/**
 * Data minimizer class
 */
export class DataMinimizer {
  /**
   * Minimize data for a specific ML service
   */
  minimizeForService(
    data: FullPatientContext,
    service: MLService
  ): Record<string, unknown> {
    const requiredFields = ML_SERVICE_DATA_REQUIREMENTS[service];
    const minimized: Record<string, unknown> = {};

    for (const field of requiredFields) {
      if (field in data && !PHI_FIELDS.includes(field)) {
        minimized[field] = data[field];
      }
    }

    return minimized;
  }

  /**
   * Get context for audio intelligence
   */
  getAudioIntelligenceContext(data: FullPatientContext): AudioIntelligenceContext | null {
    if (!data.transcriptText) {
      return null;
    }

    return {
      transcriptText: data.transcriptText,
    };
  }

  /**
   * Get context for care plan recommender
   */
  getCarePlanRecommenderContext(data: FullPatientContext): CarePlanRecommenderContext {
    return {
      conditionCodes: data.conditionCodes,
      age: data.age,
      gender: data.gender,
    };
  }

  /**
   * Get context for RAG embeddings
   */
  getRagEmbeddingsContext(data: FullPatientContext): RagEmbeddingsContext {
    return {
      conditionCodes: data.conditionCodes,
      chiefComplaint: data.chiefComplaint,
    };
  }

  /**
   * Strip all PHI from data
   */
  stripPHI<T extends Record<string, unknown>>(data: T): Partial<T> {
    const result: Partial<T> = {};

    for (const key of Object.keys(data) as (keyof T)[]) {
      if (!PHI_FIELDS.includes(key as keyof FullPatientContext)) {
        result[key] = data[key];
      }
    }

    return result;
  }

  /**
   * Mask PHI for logging purposes
   */
  maskForLogging(data: FullPatientContext): Record<string, unknown> {
    const masked: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(data)) {
      if (PHI_FIELDS.includes(key as keyof FullPatientContext)) {
        if (typeof value === 'string') {
          // Mask string PHI
          masked[key] = `[REDACTED:${value.length} chars]`;
        } else if (value instanceof Date) {
          // Mask dates
          masked[key] = '[REDACTED:date]';
        } else if (value !== undefined && value !== null) {
          masked[key] = '[REDACTED]';
        }
      } else if (key === 'transcriptText' && typeof value === 'string') {
        // Truncate long transcript for logging
        masked[key] =
          value.length > 100
            ? `${value.substring(0, 100)}... [${value.length} chars total]`
            : value;
      } else {
        masked[key] = value;
      }
    }

    return masked;
  }

  /**
   * Validate that no PHI is included in minimal context
   */
  validateNoPhiIncluded(data: Record<string, unknown>): boolean {
    for (const key of Object.keys(data)) {
      if (PHI_FIELDS.includes(key as keyof FullPatientContext)) {
        return false;
      }
    }
    return true;
  }

  /**
   * Create audit trail entry for data sharing
   */
  createDataSharingAuditEntry(
    service: MLService,
    data: Record<string, unknown>,
    correlationId: string
  ): DataSharingAuditEntry {
    return {
      service,
      fieldsShared: Object.keys(data),
      timestamp: new Date(),
      correlationId,
      dataSize: JSON.stringify(data).length,
      validated: this.validateNoPhiIncluded(data),
    };
  }
}

/**
 * Audit entry for data sharing with ML services
 */
export interface DataSharingAuditEntry {
  /** Service data was shared with */
  service: MLService;
  /** Fields that were shared */
  fieldsShared: string[];
  /** Timestamp of sharing */
  timestamp: Date;
  /** Correlation ID for tracing */
  correlationId: string;
  /** Size of shared data in bytes */
  dataSize: number;
  /** Whether data was validated for no PHI */
  validated: boolean;
}

/**
 * Synthetic data generator for dev/staging
 */
export class SyntheticDataGenerator {
  private readonly syntheticFirstNames = [
    'John',
    'Jane',
    'Michael',
    'Sarah',
    'David',
    'Emily',
    'Robert',
    'Lisa',
  ];
  private readonly syntheticLastNames = [
    'Smith',
    'Johnson',
    'Williams',
    'Brown',
    'Jones',
    'Garcia',
    'Miller',
    'Davis',
  ];

  /**
   * Replace PHI with synthetic data
   */
  maskWithSyntheticData(data: FullPatientContext): FullPatientContext & { _synthetic: true } {
    return {
      ...data,
      firstName: this.randomFromArray(this.syntheticFirstNames),
      lastName: this.randomFromArray(this.syntheticLastNames),
      dateOfBirth: this.randomDate(1940, 2005),
      mrn: `SYN${Math.random().toString(36).substring(2, 10).toUpperCase()}`,
      email: `synthetic.patient@example.com`,
      phone: '555-0100',
      address: '123 Synthetic St, Test City, TS 00000',
      _synthetic: true,
    };
  }

  private randomFromArray<T>(arr: T[]): T {
    return arr[Math.floor(Math.random() * arr.length)];
  }

  private randomDate(startYear: number, endYear: number): Date {
    const start = new Date(startYear, 0, 1);
    const end = new Date(endYear, 11, 31);
    return new Date(start.getTime() + Math.random() * (end.getTime() - start.getTime()));
  }
}

// Export singleton instances
export const dataMinimizer = new DataMinimizer();
export const syntheticDataGenerator = new SyntheticDataGenerator();
