/**
 * PDF Parser Service Types
 *
 * TypeScript interfaces matching prism-ml-infra/src/pdf_parser/api/schemas.py
 */

/**
 * Code system types
 */
export enum CodeSystem {
  SNOMED = 'SNOMED',
  ICD10 = 'ICD-10',
  LOINC = 'LOINC',
  RXNORM = 'RxNorm',
  CPT = 'CPT',
}

/**
 * Priority levels
 */
export type Priority = 'HIGH' | 'MEDIUM' | 'LOW';

/**
 * Intervention types
 */
export enum InterventionType {
  MEDICATION = 'MEDICATION',
  PROCEDURE = 'PROCEDURE',
  EDUCATION = 'EDUCATION',
  MONITORING = 'MONITORING',
  LIFESTYLE = 'LIFESTYLE',
  REFERRAL = 'REFERRAL',
  FOLLOW_UP = 'FOLLOW_UP',
  OTHER = 'OTHER',
}

/**
 * Care plan categories
 */
export enum CarePlanCategory {
  CHRONIC_DISEASE = 'CHRONIC_DISEASE',
  ACUTE_CARE = 'ACUTE_CARE',
  PREVENTIVE_CARE = 'PREVENTIVE_CARE',
  POST_PROCEDURE = 'POST_PROCEDURE',
  MEDICATION_MANAGEMENT = 'MEDICATION_MANAGEMENT',
  LIFESTYLE_MODIFICATION = 'LIFESTYLE_MODIFICATION',
  MENTAL_HEALTH = 'MENTAL_HEALTH',
  PEDIATRIC = 'PEDIATRIC',
  GERIATRIC = 'GERIATRIC',
  GENERAL = 'GENERAL',
}

/**
 * Extracted medical code
 */
export interface ExtractedCode {
  /** Code value */
  code: string;
  /** Code system */
  codeSystem: CodeSystem;
  /** Display text */
  displayText?: string;
  /** Extraction confidence (0-1) */
  confidence: number;
}

/**
 * Suggested goal from PDF
 */
export interface SuggestedGoal {
  /** Goal description */
  description: string;
  /** Target value */
  targetValue?: string;
  /** Target days */
  targetDays?: number;
  /** Priority */
  priority: Priority;
}

/**
 * Suggested intervention from PDF
 */
export interface SuggestedIntervention {
  /** Description */
  description: string;
  /** Intervention type */
  type: InterventionType;
  /** Medication code */
  medicationCode?: string;
  /** Procedure code */
  procedureCode?: string;
  /** Dosage */
  dosage?: string;
  /** Frequency */
  frequency?: string;
  /** Referral specialty */
  referralSpecialty?: string;
  /** Schedule days */
  scheduleDays?: number;
  /** Patient instructions */
  instructions?: string;
}

/**
 * Parsed care plan response
 */
export interface ParsedCarePlanResponse {
  /** Document title */
  title: string;
  /** Full extracted raw text */
  rawText: string;
  /** Care plan category */
  category?: CarePlanCategory;
  /** Document version */
  version?: string;
  /** Last updated date */
  lastUpdated?: string;
  /** Author/creator */
  author?: string;
  /** Guideline source */
  guidelineSource?: string;
  /** Evidence grade */
  evidenceGrade?: string;

  /** Extracted sections */
  overviewSection?: string;
  symptomsSection?: string;
  diagnosisSection?: string;
  treatmentSection?: string;
  goalsSection?: string;
  interventionsSection?: string;
  followUpSection?: string;
  patientEducationSection?: string;
  complicationsSection?: string;

  /** Extracted codes */
  conditionCodes: ExtractedCode[];
  medicationCodes: ExtractedCode[];
  labCodes: ExtractedCode[];
  procedureCodes: ExtractedCode[];

  /** Structured elements */
  suggestedGoals: SuggestedGoal[];
  suggestedInterventions: SuggestedIntervention[];

  /** Metadata */
  isStructuredFormat: boolean;
  extractionConfidence: number;
  warnings: string[];
  pageCount: number;
  processingTimeMs: number;
}

/**
 * Parse preview response (quick scan)
 */
export interface ParsePreviewResponse {
  /** Document title */
  title?: string;
  /** Page count */
  pageCount: number;
  /** First 500 chars of text */
  textPreview: string;
  /** Detected section names */
  detectedSections: string[];
  /** Code counts by type */
  codeCounts: Record<string, number>;
  /** Processing time in ms */
  processingTimeMs: number;
}

/**
 * Health check response
 */
export interface PdfParserHealthResponse {
  status: string;
  service: string;
  version: string;
}

/**
 * PDF file validation result
 */
export interface FileValidationResult {
  /** Whether file is valid */
  valid: boolean;
  /** Error message if invalid */
  error?: string;
  /** File size in bytes */
  sizeBytes?: number;
  /** Detected MIME type */
  mimeType?: string;
}

/**
 * Maximum file size (10MB)
 */
export const MAX_FILE_SIZE = 10 * 1024 * 1024;

/**
 * PDF magic bytes
 */
export const PDF_MAGIC_BYTES = [0x25, 0x50, 0x44, 0x46]; // %PDF
