import type { CDSServiceDefinition } from '../types';

/**
 * CDS Services Configuration
 *
 * Defines the CDS Hooks services available from this endpoint.
 * Each service specifies:
 * - id: Unique identifier for the service
 * - hook: The CDS hook type this service responds to
 * - title/description: Human-readable metadata
 * - prefetch: FHIR query templates for pre-fetching required data
 */

/**
 * Patient View Hook Service
 *
 * Triggered when a patient's chart is opened. Used for:
 * - Displaying relevant care plan recommendations
 * - Showing pending clinical alerts
 * - Highlighting missing data that needs capture
 */
export const patientViewService: CDSServiceDefinition = {
  id: 'prism-patient-view',
  hook: 'patient-view',
  title: 'Prism Care Plan Recommendations',
  description: 'Provides care plan recommendations and clinical decision support when viewing a patient chart.',
  prefetch: {
    patient: 'Patient/{{context.patientId}}',
    conditions: 'Condition?patient={{context.patientId}}&clinical-status=active',
    medications: 'MedicationRequest?patient={{context.patientId}}&status=active',
    observations: 'Observation?patient={{context.patientId}}&category=vital-signs&_sort=-date&_count=10',
  },
};

/**
 * Order Review Hook Service
 *
 * Triggered when reviewing pending orders before signing.
 * Used for:
 * - Validating orders against care plans
 * - Detecting potential issues or contraindications
 * - Suggesting alternative treatments
 */
export const orderReviewService: CDSServiceDefinition = {
  id: 'prism-order-review',
  hook: 'order-review',
  title: 'Prism Order Review',
  description: 'Reviews pending orders for alignment with care plans and clinical guidelines.',
  prefetch: {
    patient: 'Patient/{{context.patientId}}',
    conditions: 'Condition?patient={{context.patientId}}&clinical-status=active',
    allergies: 'AllergyIntolerance?patient={{context.patientId}}&clinical-status=active',
    medications: 'MedicationRequest?patient={{context.patientId}}&status=active',
  },
};

/**
 * Medication Prescribe Hook Service
 *
 * Triggered when prescribing a new medication.
 * Used for:
 * - Drug-drug interaction checking
 * - Allergy cross-reactivity alerts
 * - Dosing recommendations based on patient factors
 * - Contraindication warnings
 */
export const medicationPrescribeService: CDSServiceDefinition = {
  id: 'prism-medication-prescribe',
  hook: 'medication-prescribe',
  title: 'Prism Medication Safety Check',
  description: 'Checks prescribed medications for interactions, allergies, and contraindications.',
  prefetch: {
    patient: 'Patient/{{context.patientId}}',
    allergies: 'AllergyIntolerance?patient={{context.patientId}}&clinical-status=active',
    medications: 'MedicationRequest?patient={{context.patientId}}&status=active',
    conditions: 'Condition?patient={{context.patientId}}&clinical-status=active',
    labResults: 'Observation?patient={{context.patientId}}&category=laboratory&_sort=-date&_count=20',
  },
};

/**
 * All registered CDS services
 */
export const cdsServices: CDSServiceDefinition[] = [
  patientViewService,
  orderReviewService,
  medicationPrescribeService,
];

/**
 * Service lookup by ID
 */
export const serviceById: Map<string, CDSServiceDefinition> = new Map(
  cdsServices.map(service => [service.id, service])
);

/**
 * Services grouped by hook type
 */
export const servicesByHook: Map<string, CDSServiceDefinition[]> = cdsServices.reduce(
  (map, service) => {
    const existing = map.get(service.hook) ?? [];
    existing.push(service);
    map.set(service.hook, existing);
    return map;
  },
  new Map<string, CDSServiceDefinition[]>()
);
