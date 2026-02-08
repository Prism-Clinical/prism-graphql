/**
 * Type guards for FHIR resources
 *
 * These functions provide runtime type checking for FHIR resources,
 * replacing unsafe type assertions with proper validation.
 */

import type { FHIRResource, FHIRBundle } from '../clients/fhir';

/**
 * Base FHIR resource interface for type checking
 */
interface FHIRResourceLike {
  resourceType: string;
  id?: string;
  [key: string]: unknown;
}

/**
 * Check if a value is a valid FHIR resource
 */
export function isFHIRResource(value: unknown): value is FHIRResource {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const obj = value as Record<string, unknown>;
  return typeof obj.resourceType === 'string' && obj.resourceType.length > 0;
}

/**
 * Check if a value is a FHIR Bundle
 */
export function isFHIRBundle(value: unknown): value is FHIRBundle {
  if (!isFHIRResource(value)) {
    return false;
  }

  const resource = value as FHIRResourceLike;
  if (resource.resourceType !== 'Bundle') {
    return false;
  }

  // Entry is optional, but if present must be an array
  if ('entry' in resource && resource.entry !== undefined) {
    if (!Array.isArray(resource.entry)) {
      return false;
    }
  }

  return true;
}

/**
 * Check if a value is a FHIR Patient resource
 */
export function isFHIRPatient(value: unknown): value is FHIRResourceLike & { resourceType: 'Patient' } {
  if (!isFHIRResource(value)) {
    return false;
  }

  return (value as FHIRResourceLike).resourceType === 'Patient';
}

/**
 * Check if a value is a FHIR Condition resource
 */
export function isFHIRCondition(value: unknown): value is FHIRResourceLike & { resourceType: 'Condition' } {
  if (!isFHIRResource(value)) {
    return false;
  }

  return (value as FHIRResourceLike).resourceType === 'Condition';
}

/**
 * Check if a value is a FHIR Observation resource
 */
export function isFHIRObservation(value: unknown): value is FHIRResourceLike & { resourceType: 'Observation' } {
  if (!isFHIRResource(value)) {
    return false;
  }

  return (value as FHIRResourceLike).resourceType === 'Observation';
}

/**
 * Check if a value is a FHIR MedicationRequest resource
 */
export function isFHIRMedicationRequest(
  value: unknown
): value is FHIRResourceLike & { resourceType: 'MedicationRequest' } {
  if (!isFHIRResource(value)) {
    return false;
  }

  return (value as FHIRResourceLike).resourceType === 'MedicationRequest';
}

/**
 * Check if a value is a FHIR ServiceRequest resource
 */
export function isFHIRServiceRequest(
  value: unknown
): value is FHIRResourceLike & { resourceType: 'ServiceRequest' } {
  if (!isFHIRResource(value)) {
    return false;
  }

  return (value as FHIRResourceLike).resourceType === 'ServiceRequest';
}

/**
 * Check if a value is a FHIR AllergyIntolerance resource
 */
export function isFHIRAllergyIntolerance(
  value: unknown
): value is FHIRResourceLike & { resourceType: 'AllergyIntolerance' } {
  if (!isFHIRResource(value)) {
    return false;
  }

  return (value as FHIRResourceLike).resourceType === 'AllergyIntolerance';
}

/**
 * Extract resources of a specific type from a bundle
 *
 * Type-safe alternative to casting bundle entries
 */
export function extractResourcesFromBundle<T extends FHIRResourceLike>(
  bundle: unknown,
  typeGuard: (value: unknown) => value is T
): T[] {
  if (!isFHIRBundle(bundle)) {
    return [];
  }

  const resources: T[] = [];

  if (bundle.entry) {
    for (const entry of bundle.entry) {
      if (entry.resource && typeGuard(entry.resource)) {
        resources.push(entry.resource);
      }
    }
  }

  return resources;
}

/**
 * Type guard for checking if a FHIR Condition is active
 */
export function isActiveCondition(condition: FHIRResourceLike): boolean {
  if (condition.resourceType !== 'Condition') {
    return false;
  }

  const clinicalStatus = condition.clinicalStatus as
    | { coding?: Array<{ code?: string }> }
    | undefined;

  if (!clinicalStatus?.coding?.[0]?.code) {
    // If no clinical status, assume active
    return true;
  }

  return clinicalStatus.coding[0].code === 'active';
}

/**
 * Safely extract a coding from a CodeableConcept
 */
export function extractCoding(
  codeableConcept: unknown
): { system?: string; code?: string; display?: string } | undefined {
  if (!codeableConcept || typeof codeableConcept !== 'object') {
    return undefined;
  }

  const cc = codeableConcept as {
    coding?: Array<{ system?: string; code?: string; display?: string }>;
    text?: string;
  };

  if (cc.coding && Array.isArray(cc.coding) && cc.coding.length > 0) {
    return cc.coding[0];
  }

  return undefined;
}

/**
 * Safely extract text from a CodeableConcept
 */
export function extractCodeableConceptText(codeableConcept: unknown): string | undefined {
  if (!codeableConcept || typeof codeableConcept !== 'object') {
    return undefined;
  }

  const cc = codeableConcept as {
    coding?: Array<{ display?: string }>;
    text?: string;
  };

  // Prefer text, fall back to first coding display
  if (cc.text) {
    return cc.text;
  }

  if (cc.coding?.[0]?.display) {
    return cc.coding[0].display;
  }

  return undefined;
}
