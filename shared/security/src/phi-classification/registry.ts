/**
 * PHI Field Registry
 *
 * Central registry of all PHI fields with their classification levels and handling requirements.
 * This registry is the source of truth for PHI classification across the system.
 */

import { PHILevel } from '../types';
import { PHIFieldDefinition, PHIFieldRegistry } from './types';

/**
 * Default handling requirements by PHI level
 */
const DEFAULT_HANDLING: Record<PHILevel, Omit<PHIFieldDefinition, 'fieldPath' | 'level' | 'description'>> = {
  [PHILevel.NONE]: {
    requiresEncryption: false,
    canCache: true,
    maxCacheTTL: 3600, // 1 hour
    canLog: true,
    canSendToML: true,
    retentionDays: 2555, // 7 years for HIPAA
  },
  [PHILevel.INDIRECT]: {
    requiresEncryption: false,
    canCache: true,
    maxCacheTTL: 1800, // 30 minutes
    canLog: true,
    canSendToML: true,
    retentionDays: 2555,
  },
  [PHILevel.DIRECT]: {
    requiresEncryption: true,
    canCache: true,
    maxCacheTTL: 300, // 5 minutes
    canLog: false,
    canSendToML: false,
    retentionDays: 2555,
  },
  [PHILevel.SENSITIVE]: {
    requiresEncryption: true,
    canCache: true,
    maxCacheTTL: 300, // 5 minutes
    canLog: false,
    canSendToML: true, // ML services need this for processing
    retentionDays: 2555,
  },
};

/**
 * PHI Field Definitions
 *
 * Complete mapping of all GraphQL fields containing PHI.
 * Organized by entity type.
 */
const PHI_FIELD_DEFINITIONS: PHIFieldDefinition[] = [
  // ============================================
  // Patient Fields - Direct Identifiers
  // ============================================
  {
    fieldPath: 'Patient.firstName',
    level: PHILevel.DIRECT,
    description: 'Patient first name',
    hipaaCategory: 'Names',
    ...DEFAULT_HANDLING[PHILevel.DIRECT],
  },
  {
    fieldPath: 'Patient.lastName',
    level: PHILevel.DIRECT,
    description: 'Patient last name',
    hipaaCategory: 'Names',
    ...DEFAULT_HANDLING[PHILevel.DIRECT],
  },
  {
    fieldPath: 'Patient.mrn',
    level: PHILevel.DIRECT,
    description: 'Medical Record Number',
    hipaaCategory: 'Medical record numbers',
    ...DEFAULT_HANDLING[PHILevel.DIRECT],
  },
  {
    fieldPath: 'Patient.dateOfBirth',
    level: PHILevel.DIRECT,
    description: 'Patient date of birth',
    hipaaCategory: 'Dates related to individual',
    ...DEFAULT_HANDLING[PHILevel.DIRECT],
  },
  {
    fieldPath: 'Patient.email',
    level: PHILevel.DIRECT,
    description: 'Patient email address',
    hipaaCategory: 'Electronic mail addresses',
    ...DEFAULT_HANDLING[PHILevel.DIRECT],
  },
  {
    fieldPath: 'Patient.phone',
    level: PHILevel.DIRECT,
    description: 'Patient phone number',
    hipaaCategory: 'Telephone numbers',
    ...DEFAULT_HANDLING[PHILevel.DIRECT],
  },
  {
    fieldPath: 'Patient.address',
    level: PHILevel.DIRECT,
    description: 'Patient address',
    hipaaCategory: 'Geographic data',
    ...DEFAULT_HANDLING[PHILevel.DIRECT],
  },
  {
    fieldPath: 'Patient.ssn',
    level: PHILevel.DIRECT,
    description: 'Social Security Number',
    hipaaCategory: 'Social security numbers',
    ...DEFAULT_HANDLING[PHILevel.DIRECT],
  },

  // ============================================
  // Patient Fields - Indirect Identifiers
  // ============================================
  {
    fieldPath: 'Patient.age',
    level: PHILevel.INDIRECT,
    description: 'Patient age (derived from DOB)',
    hipaaCategory: 'Age if over 89',
    ...DEFAULT_HANDLING[PHILevel.INDIRECT],
  },
  {
    fieldPath: 'Patient.gender',
    level: PHILevel.INDIRECT,
    description: 'Patient gender',
    ...DEFAULT_HANDLING[PHILevel.INDIRECT],
  },
  {
    fieldPath: 'Patient.zipCode',
    level: PHILevel.INDIRECT,
    description: 'Patient zip code (first 3 digits)',
    hipaaCategory: 'Geographic data',
    ...DEFAULT_HANDLING[PHILevel.INDIRECT],
  },

  // ============================================
  // Patient Fields - Non-PHI Identifiers
  // ============================================
  {
    fieldPath: 'Patient.id',
    level: PHILevel.NONE,
    description: 'Internal patient ID (UUID)',
    ...DEFAULT_HANDLING[PHILevel.NONE],
  },

  // ============================================
  // Care Plan Fields - Sensitive Health Info
  // ============================================
  {
    fieldPath: 'CarePlan.goals',
    level: PHILevel.SENSITIVE,
    description: 'Care plan goals contain health information',
    hipaaCategory: 'Health condition',
    ...DEFAULT_HANDLING[PHILevel.SENSITIVE],
  },
  {
    fieldPath: 'CarePlan.interventions',
    level: PHILevel.SENSITIVE,
    description: 'Care plan interventions contain treatment info',
    hipaaCategory: 'Treatment information',
    ...DEFAULT_HANDLING[PHILevel.SENSITIVE],
  },
  {
    fieldPath: 'CarePlan.conditionCodes',
    level: PHILevel.SENSITIVE,
    description: 'ICD-10 diagnosis codes',
    hipaaCategory: 'Health condition',
    ...DEFAULT_HANDLING[PHILevel.SENSITIVE],
  },
  {
    fieldPath: 'CarePlan.title',
    level: PHILevel.SENSITIVE,
    description: 'Care plan title may contain condition info',
    hipaaCategory: 'Health condition',
    ...DEFAULT_HANDLING[PHILevel.SENSITIVE],
  },

  // ============================================
  // Care Plan Goal Fields
  // ============================================
  {
    fieldPath: 'CarePlanGoal.description',
    level: PHILevel.SENSITIVE,
    description: 'Goal description contains health objectives',
    hipaaCategory: 'Health condition',
    ...DEFAULT_HANDLING[PHILevel.SENSITIVE],
  },
  {
    fieldPath: 'CarePlanGoal.targetValue',
    level: PHILevel.SENSITIVE,
    description: 'Target health metrics',
    hipaaCategory: 'Health condition',
    ...DEFAULT_HANDLING[PHILevel.SENSITIVE],
  },
  {
    fieldPath: 'CarePlanGoal.currentValue',
    level: PHILevel.SENSITIVE,
    description: 'Current health metrics',
    hipaaCategory: 'Health condition',
    ...DEFAULT_HANDLING[PHILevel.SENSITIVE],
  },

  // ============================================
  // Care Plan Intervention Fields
  // ============================================
  {
    fieldPath: 'CarePlanIntervention.description',
    level: PHILevel.SENSITIVE,
    description: 'Intervention description',
    hipaaCategory: 'Treatment information',
    ...DEFAULT_HANDLING[PHILevel.SENSITIVE],
  },
  {
    fieldPath: 'CarePlanIntervention.medicationCode',
    level: PHILevel.SENSITIVE,
    description: 'Medication codes',
    hipaaCategory: 'Prescription information',
    ...DEFAULT_HANDLING[PHILevel.SENSITIVE],
  },
  {
    fieldPath: 'CarePlanIntervention.dosage',
    level: PHILevel.SENSITIVE,
    description: 'Medication dosage',
    hipaaCategory: 'Prescription information',
    ...DEFAULT_HANDLING[PHILevel.SENSITIVE],
  },
  {
    fieldPath: 'CarePlanIntervention.procedureCode',
    level: PHILevel.SENSITIVE,
    description: 'Procedure codes',
    hipaaCategory: 'Treatment information',
    ...DEFAULT_HANDLING[PHILevel.SENSITIVE],
  },
  {
    fieldPath: 'CarePlanIntervention.patientInstructions',
    level: PHILevel.SENSITIVE,
    description: 'Instructions may contain health info',
    hipaaCategory: 'Treatment information',
    ...DEFAULT_HANDLING[PHILevel.SENSITIVE],
  },

  // ============================================
  // Extracted Entities (from transcripts)
  // ============================================
  {
    fieldPath: 'ExtractedEntities.symptoms',
    level: PHILevel.SENSITIVE,
    description: 'Extracted symptoms from transcript',
    hipaaCategory: 'Health condition',
    ...DEFAULT_HANDLING[PHILevel.SENSITIVE],
  },
  {
    fieldPath: 'ExtractedEntities.medications',
    level: PHILevel.SENSITIVE,
    description: 'Extracted medications from transcript',
    hipaaCategory: 'Prescription information',
    ...DEFAULT_HANDLING[PHILevel.SENSITIVE],
  },
  {
    fieldPath: 'ExtractedEntities.diagnoses',
    level: PHILevel.SENSITIVE,
    description: 'Extracted diagnoses from transcript',
    hipaaCategory: 'Health condition',
    ...DEFAULT_HANDLING[PHILevel.SENSITIVE],
  },
  {
    fieldPath: 'ExtractedEntities.procedures',
    level: PHILevel.SENSITIVE,
    description: 'Extracted procedures from transcript',
    hipaaCategory: 'Treatment information',
    ...DEFAULT_HANDLING[PHILevel.SENSITIVE],
  },
  {
    fieldPath: 'ExtractedEntities.vitals',
    level: PHILevel.SENSITIVE,
    description: 'Extracted vital signs',
    hipaaCategory: 'Health condition',
    ...DEFAULT_HANDLING[PHILevel.SENSITIVE],
  },

  // ============================================
  // Transcript Fields
  // ============================================
  {
    fieldPath: 'Transcript.text',
    level: PHILevel.SENSITIVE,
    description: 'Full transcript text contains health discussion',
    hipaaCategory: 'Health condition',
    ...DEFAULT_HANDLING[PHILevel.SENSITIVE],
  },
  {
    fieldPath: 'Transcript.audioUrl',
    level: PHILevel.SENSITIVE,
    description: 'Audio recording URL',
    hipaaCategory: 'Biometric identifiers',
    ...DEFAULT_HANDLING[PHILevel.SENSITIVE],
  },

  // ============================================
  // Red Flag Fields
  // ============================================
  {
    fieldPath: 'RedFlag.description',
    level: PHILevel.SENSITIVE,
    description: 'Red flag description contains health alerts',
    hipaaCategory: 'Health condition',
    ...DEFAULT_HANDLING[PHILevel.SENSITIVE],
  },
  {
    fieldPath: 'RedFlag.sourceText',
    level: PHILevel.SENSITIVE,
    description: 'Source text from transcript',
    hipaaCategory: 'Health condition',
    ...DEFAULT_HANDLING[PHILevel.SENSITIVE],
  },

  // ============================================
  // Visit Fields
  // ============================================
  {
    fieldPath: 'Visit.chiefComplaint',
    level: PHILevel.SENSITIVE,
    description: 'Chief complaint contains health info',
    hipaaCategory: 'Health condition',
    ...DEFAULT_HANDLING[PHILevel.SENSITIVE],
  },
  {
    fieldPath: 'Visit.notes',
    level: PHILevel.SENSITIVE,
    description: 'Visit notes contain clinical information',
    hipaaCategory: 'Health condition',
    ...DEFAULT_HANDLING[PHILevel.SENSITIVE],
  },

  // ============================================
  // Provider Fields (Non-PHI but protected)
  // ============================================
  {
    fieldPath: 'Provider.id',
    level: PHILevel.NONE,
    description: 'Internal provider ID',
    ...DEFAULT_HANDLING[PHILevel.NONE],
  },
  {
    fieldPath: 'Provider.name',
    level: PHILevel.NONE,
    description: 'Provider name (not patient PHI)',
    ...DEFAULT_HANDLING[PHILevel.NONE],
  },
];

/**
 * Build the PHI field registry
 */
function buildRegistry(): PHIFieldRegistry {
  const registry = new Map<string, PHIFieldDefinition>();

  for (const definition of PHI_FIELD_DEFINITIONS) {
    registry.set(definition.fieldPath, definition);
  }

  return registry;
}

/**
 * Global PHI field registry instance
 */
export const PHI_REGISTRY: PHIFieldRegistry = buildRegistry();

/**
 * Get PHI field definition by path
 */
export function getPHIFieldDefinition(fieldPath: string): PHIFieldDefinition | undefined {
  return PHI_REGISTRY.get(fieldPath);
}

/**
 * Check if a field is classified as PHI
 */
export function isPHIField(fieldPath: string): boolean {
  const definition = PHI_REGISTRY.get(fieldPath);
  return definition !== undefined && definition.level !== PHILevel.NONE;
}

/**
 * Get all fields at a specific PHI level
 */
export function getFieldsByLevel(level: PHILevel): PHIFieldDefinition[] {
  const fields: PHIFieldDefinition[] = [];

  for (const definition of PHI_REGISTRY.values()) {
    if (definition.level === level) {
      fields.push(definition);
    }
  }

  return fields;
}

/**
 * Get all fields for a specific entity type
 */
export function getFieldsForEntity(entityType: string): PHIFieldDefinition[] {
  const fields: PHIFieldDefinition[] = [];

  for (const definition of PHI_REGISTRY.values()) {
    if (definition.fieldPath.startsWith(`${entityType}.`)) {
      fields.push(definition);
    }
  }

  return fields;
}

/**
 * Register a new PHI field (for dynamic schema extensions)
 */
export function registerPHIField(definition: PHIFieldDefinition): void {
  PHI_REGISTRY.set(definition.fieldPath, definition);
}

/**
 * Get all registered PHI fields
 */
export function getAllPHIFields(): PHIFieldDefinition[] {
  return Array.from(PHI_REGISTRY.values());
}

/**
 * Get fields that require encryption
 */
export function getEncryptionRequiredFields(): PHIFieldDefinition[] {
  return getAllPHIFields().filter((f) => f.requiresEncryption);
}

/**
 * Get fields that cannot be logged
 */
export function getNoLogFields(): PHIFieldDefinition[] {
  return getAllPHIFields().filter((f) => !f.canLog);
}

/**
 * Get fields that cannot be sent to ML services
 */
export function getNoMLFields(): PHIFieldDefinition[] {
  return getAllPHIFields().filter((f) => !f.canSendToML);
}
