/**
 * PHI Classifier
 *
 * Runtime PHI classification and access control.
 */

import { PHILevel } from '../types';
import {
  PHIFieldDefinition,
  PHIHandlingContext,
  PHIClassificationResult,
  PHIHandlingRecommendation,
  PHIAccessRequest,
  PHIAccessDecision,
  PHIAccessAuditEntry,
} from './types';
import { getPHIFieldDefinition, isPHIField } from './registry';

/**
 * Roles that have access to all PHI
 */
const FULL_PHI_ACCESS_ROLES = ['PHYSICIAN', 'NURSE', 'CARE_COORDINATOR', 'ADMIN'];

/**
 * Roles that have access to indirect PHI only
 */
const LIMITED_PHI_ACCESS_ROLES = ['PHARMACIST'];

/**
 * Roles with no PHI access
 */
const NO_PHI_ACCESS_ROLES = ['PATIENT', 'SYSTEM'];

/**
 * PHI Classifier class
 *
 * Handles runtime classification and access decisions for PHI fields.
 */
export class PHIClassifier {
  /**
   * Classify a field and determine handling requirements
   */
  classifyField(fieldPath: string, context?: PHIHandlingContext): PHIClassificationResult {
    const definition = getPHIFieldDefinition(fieldPath);

    // If not in registry, treat as potentially sensitive
    if (!definition) {
      return this.createUnclassifiedResult(fieldPath, context);
    }

    const accessAllowed = this.checkAccess(definition, context);
    const handling = this.determineHandling(definition, context);

    return {
      fieldPath,
      level: definition.level,
      accessAllowed,
      denialReason: accessAllowed ? undefined : this.getDenialReason(definition, context),
      handling,
    };
  }

  /**
   * Classify multiple fields at once
   */
  classifyFields(fieldPaths: string[], context?: PHIHandlingContext): PHIClassificationResult[] {
    return fieldPaths.map((path) => this.classifyField(path, context));
  }

  /**
   * Make an access decision for a PHI access request
   */
  makeAccessDecision(request: PHIAccessRequest): PHIAccessDecision {
    const allowedFields: string[] = [];
    const deniedFields: string[] = [];
    const denialReasons = new Map<string, string>();
    const requiredAuditEntries: PHIAccessAuditEntry[] = [];

    const context: PHIHandlingContext = {
      userRole: request.userRole,
      purpose: request.purpose,
      hasBAAOnFile: true, // Assume true for internal users
      isEmergencyAccess: false,
    };

    for (const field of request.fields) {
      const classification = this.classifyField(field, context);

      const auditEntry: PHIAccessAuditEntry = {
        field,
        level: classification.level,
        granted: classification.accessAllowed,
        timestamp: new Date(),
      };
      requiredAuditEntries.push(auditEntry);

      if (classification.accessAllowed) {
        allowedFields.push(field);
      } else {
        deniedFields.push(field);
        if (classification.denialReason) {
          denialReasons.set(field, classification.denialReason);
        }
      }
    }

    return {
      allowed: deniedFields.length === 0,
      allowedFields,
      deniedFields,
      denialReasons,
      requiredAuditEntries,
    };
  }

  /**
   * Get the PHI level for a field
   */
  getFieldLevel(fieldPath: string): PHILevel {
    const definition = getPHIFieldDefinition(fieldPath);
    return definition?.level ?? PHILevel.SENSITIVE; // Default to sensitive if unknown
  }

  /**
   * Check if a field contains PHI
   */
  isFieldPHI(fieldPath: string): boolean {
    return isPHIField(fieldPath);
  }

  /**
   * Get all fields that would be accessed by a query
   * (For use with GraphQL introspection)
   */
  getAccessedPHIFields(fieldPaths: string[]): string[] {
    return fieldPaths.filter((path) => this.isFieldPHI(path));
  }

  /**
   * Apply minimum necessary principle to filter fields
   */
  applyMinimumNecessary(
    requestedFields: string[],
    requiredFields: string[],
    context: PHIHandlingContext
  ): string[] {
    // If minimum necessary fields specified, filter to only those
    if (context.minimumNecessaryFields && context.minimumNecessaryFields.length > 0) {
      return requestedFields.filter(
        (f) =>
          context.minimumNecessaryFields!.includes(f) ||
          requiredFields.includes(f) ||
          !this.isFieldPHI(f)
      );
    }

    // Otherwise, allow required fields plus non-PHI fields
    return requestedFields.filter((f) => requiredFields.includes(f) || !this.isFieldPHI(f));
  }

  /**
   * Check if access is allowed for a specific field and context
   */
  private checkAccess(definition: PHIFieldDefinition, context?: PHIHandlingContext): boolean {
    // No context means internal system access - allow
    if (!context) {
      return true;
    }

    // Emergency access overrides normal rules
    if (context.isEmergencyAccess) {
      return true;
    }

    // Check role-based access
    if (FULL_PHI_ACCESS_ROLES.includes(context.userRole)) {
      return true;
    }

    if (LIMITED_PHI_ACCESS_ROLES.includes(context.userRole)) {
      // Limited roles can only access NONE and INDIRECT
      return definition.level === PHILevel.NONE || definition.level === PHILevel.INDIRECT;
    }

    if (NO_PHI_ACCESS_ROLES.includes(context.userRole)) {
      // No PHI access roles can only access NONE
      return definition.level === PHILevel.NONE;
    }

    // Unknown role - deny by default
    return false;
  }

  /**
   * Determine handling recommendations for a field
   */
  private determineHandling(
    definition: PHIFieldDefinition,
    context?: PHIHandlingContext
  ): PHIHandlingRecommendation {
    return {
      encrypt: definition.requiresEncryption,
      maskInLogs: !definition.canLog,
      auditAccess: definition.level !== PHILevel.NONE,
      applyMinimumNecessary: definition.level === PHILevel.DIRECT || definition.level === PHILevel.SENSITIVE,
      includeInMLCalls: definition.canSendToML,
      caching: {
        allowed: definition.canCache,
        maxTTL: definition.maxCacheTTL,
        requiresEncryption: definition.requiresEncryption,
      },
    };
  }

  /**
   * Get denial reason for access denial
   */
  private getDenialReason(definition: PHIFieldDefinition, context?: PHIHandlingContext): string {
    if (!context) {
      return 'No context provided';
    }

    if (NO_PHI_ACCESS_ROLES.includes(context.userRole)) {
      return `Role '${context.userRole}' does not have access to PHI`;
    }

    if (LIMITED_PHI_ACCESS_ROLES.includes(context.userRole)) {
      return `Role '${context.userRole}' does not have access to ${definition.level} PHI`;
    }

    return 'Access denied by policy';
  }

  /**
   * Create result for unclassified fields
   */
  private createUnclassifiedResult(
    fieldPath: string,
    context?: PHIHandlingContext
  ): PHIClassificationResult {
    // Unclassified fields are treated as potentially sensitive
    // Log a warning for compliance tracking
    console.warn(`Unclassified field accessed: ${fieldPath}. Treating as SENSITIVE.`);

    return {
      fieldPath,
      level: PHILevel.SENSITIVE,
      accessAllowed: context ? FULL_PHI_ACCESS_ROLES.includes(context.userRole) : true,
      denialReason: context && !FULL_PHI_ACCESS_ROLES.includes(context.userRole)
        ? 'Unclassified fields require full PHI access'
        : undefined,
      handling: {
        encrypt: true,
        maskInLogs: true,
        auditAccess: true,
        applyMinimumNecessary: true,
        includeInMLCalls: false,
        caching: {
          allowed: false,
          requiresEncryption: true,
        },
      },
    };
  }
}

/**
 * Singleton instance of PHI classifier
 */
export const phiClassifier = new PHIClassifier();

/**
 * Convenience function to classify a field
 */
export function classifyPHIField(fieldPath: string, context?: PHIHandlingContext): PHIClassificationResult {
  return phiClassifier.classifyField(fieldPath, context);
}

/**
 * Convenience function to make access decision
 */
export function makePHIAccessDecision(request: PHIAccessRequest): PHIAccessDecision {
  return phiClassifier.makeAccessDecision(request);
}
