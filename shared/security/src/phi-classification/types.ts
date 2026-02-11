/**
 * PHI Classification Types
 *
 * Type definitions for PHI field classification and handling.
 */

import { PHILevel } from '../types';

/**
 * PHI field definition with handling requirements
 */
export interface PHIFieldDefinition {
  /** GraphQL field path (e.g., "Patient.firstName") */
  fieldPath: string;
  /** PHI classification level */
  level: PHILevel;
  /** Human-readable description */
  description: string;
  /** HIPAA category reference */
  hipaaCategory?: string;
  /** Whether field requires encryption at rest */
  requiresEncryption: boolean;
  /** Whether field can be cached */
  canCache: boolean;
  /** Maximum cache TTL in seconds (if cacheable) */
  maxCacheTTL?: number;
  /** Whether field can be logged (even if masked) */
  canLog: boolean;
  /** Whether field can be sent to ML services */
  canSendToML: boolean;
  /** Retention period in days */
  retentionDays: number;
}

/**
 * PHI field registry mapping field paths to definitions
 */
export type PHIFieldRegistry = Map<string, PHIFieldDefinition>;

/**
 * PHI handling context for runtime decisions
 */
export interface PHIHandlingContext {
  /** User's role */
  userRole: string;
  /** Purpose of access */
  purpose: string;
  /** Whether user has signed BAA */
  hasBAAOnFile: boolean;
  /** Whether this is a break-the-glass access */
  isEmergencyAccess: boolean;
  /** Minimum necessary fields for this operation */
  minimumNecessaryFields?: string[];
}

/**
 * Result of PHI field classification check
 */
export interface PHIClassificationResult {
  /** The field path checked */
  fieldPath: string;
  /** Classification level */
  level: PHILevel;
  /** Whether access is allowed in current context */
  accessAllowed: boolean;
  /** Reason for denial if applicable */
  denialReason?: string;
  /** Recommended handling */
  handling: PHIHandlingRecommendation;
}

/**
 * Recommended handling for a PHI field
 */
export interface PHIHandlingRecommendation {
  /** Should encrypt before storage */
  encrypt: boolean;
  /** Should mask in logs */
  maskInLogs: boolean;
  /** Should audit access */
  auditAccess: boolean;
  /** Should apply minimum necessary principle */
  applyMinimumNecessary: boolean;
  /** Can include in ML service calls */
  includeInMLCalls: boolean;
  /** Cache settings */
  caching: {
    allowed: boolean;
    maxTTL?: number;
    requiresEncryption: boolean;
  };
}

/**
 * GraphQL directive input for @phi
 */
export interface PHIDirectiveArgs {
  /** PHI classification level */
  level: PHILevel;
}

/**
 * Runtime PHI access request
 */
export interface PHIAccessRequest {
  /** Fields being accessed */
  fields: string[];
  /** User context */
  userId: string;
  /** User role */
  userRole: string;
  /** Patient ID being accessed */
  patientId?: string;
  /** Purpose of access */
  purpose: string;
  /** Request ID for tracing */
  requestId: string;
}

/**
 * Runtime PHI access decision
 */
export interface PHIAccessDecision {
  /** Whether all requested access is allowed */
  allowed: boolean;
  /** Fields that were allowed */
  allowedFields: string[];
  /** Fields that were denied */
  deniedFields: string[];
  /** Denial reasons by field */
  denialReasons: Map<string, string>;
  /** Required audit entries */
  requiredAuditEntries: PHIAccessAuditEntry[];
}

/**
 * Audit entry for PHI access
 */
export interface PHIAccessAuditEntry {
  /** Field accessed */
  field: string;
  /** PHI level */
  level: PHILevel;
  /** Whether access was granted */
  granted: boolean;
  /** Timestamp */
  timestamp: Date;
}
