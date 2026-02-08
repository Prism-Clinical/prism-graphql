import patients from './patients.json';
import conditions from './conditions.json';
import allergies from './allergies.json';
import medications from './medications.json';
import observations from './observations.json';
import draftOrders from './draft-orders.json';

export const Patients = patients;
export const Conditions = conditions;
export const Allergies = allergies;
export const Medications = medications;
export const Observations = observations;
export const DraftOrders = draftOrders;

// Helper to create a Bundle from resources
export function createBundle(
  resources: Array<{ resourceType: string; id?: string }>
): { resourceType: 'Bundle'; type: 'searchset'; entry: Array<{ resource: unknown }> } {
  return {
    resourceType: 'Bundle',
    type: 'searchset',
    entry: resources.map((resource) => ({ resource })),
  };
}

// Helper to create valid CDS Hooks request
export function createHookRequest(
  hook: string,
  options: {
    patientId?: string;
    userId?: string;
    encounterId?: string;
    context?: Record<string, unknown>;
    prefetch?: Record<string, unknown>;
    fhirServer?: string;
  } = {}
): {
  hookInstance: string;
  hook: string;
  context: Record<string, unknown>;
  prefetch?: Record<string, unknown>;
  fhirServer?: string;
} {
  const {
    patientId = 'patient-healthy',
    userId = 'Practitioner/dr-smith',
    encounterId = 'encounter-1',
    context = {},
    prefetch,
    fhirServer,
  } = options;

  return {
    hookInstance: '12345678-1234-4123-a123-123456789abc',
    hook,
    context: {
      userId,
      patientId,
      encounterId,
      ...context,
    },
    ...(prefetch && { prefetch }),
    ...(fhirServer && { fhirServer }),
  };
}

// Helper for patient-view hook requests
export function createPatientViewRequest(
  options: {
    patientId?: string;
    prefetch?: Record<string, unknown>;
  } = {}
): ReturnType<typeof createHookRequest> {
  const { patientId = 'patient-healthy', prefetch } = options;

  const defaultPrefetch = {
    patient: Patients[patientId as keyof typeof Patients] || Patients['patient-healthy'],
    conditions: createBundle([]),
    medications: createBundle([]),
    observations: createBundle([]),
  };

  return createHookRequest('patient-view', {
    patientId,
    prefetch: prefetch || defaultPrefetch,
  });
}

// Helper for order-review hook requests
export function createOrderReviewRequest(
  options: {
    patientId?: string;
    draftOrders?: unknown[];
    prefetch?: Record<string, unknown>;
  } = {}
): ReturnType<typeof createHookRequest> {
  const { patientId = 'patient-healthy', draftOrders = [], prefetch } = options;

  const defaultPrefetch = {
    patient: Patients[patientId as keyof typeof Patients] || Patients['patient-healthy'],
    conditions: createBundle([]),
    medications: createBundle([]),
  };

  return createHookRequest('order-review', {
    patientId,
    context: {
      draftOrders: {
        resourceType: 'Bundle',
        type: 'collection',
        entry: draftOrders.map((order) => ({ resource: order })),
      },
    },
    prefetch: prefetch || defaultPrefetch,
  });
}

// Helper for medication-prescribe hook requests
export function createMedicationPrescribeRequest(
  options: {
    patientId?: string;
    medications?: unknown[];
    prefetch?: Record<string, unknown>;
  } = {}
): ReturnType<typeof createHookRequest> {
  const { patientId = 'patient-healthy', medications: meds = [], prefetch } = options;

  const defaultPrefetch = {
    patient: Patients[patientId as keyof typeof Patients] || Patients['patient-healthy'],
    allergies: createBundle([]),
    currentMedications: createBundle([]),
    conditions: createBundle([]),
    recentLabs: createBundle([]),
  };

  return createHookRequest('medication-prescribe', {
    patientId,
    context: {
      medications: {
        resourceType: 'Bundle',
        type: 'collection',
        entry: meds.map((med) => ({ resource: med })),
      },
    },
    prefetch: prefetch || defaultPrefetch,
  });
}

// Predefined test scenarios
export const TestScenarios = {
  // Healthy patient with no issues
  healthyPatient: {
    patient: Patients['patient-healthy'],
    conditions: [],
    allergies: [],
    medications: [],
    observations: [],
  },

  // Diabetic patient with uncontrolled HbA1c
  diabeticPatientUncontrolled: {
    patient: Patients['patient-diabetic'],
    conditions: [Conditions['diabetes-type-2']],
    allergies: [],
    medications: [Medications['metformin'], Medications['atorvastatin']],
    observations: [Observations['hba1c-high']],
  },

  // Patient with multiple allergies
  patientWithAllergies: {
    patient: Patients['patient-allergies'],
    conditions: [],
    allergies: [
      Allergies['penicillin-allergy'],
      Allergies['aspirin-allergy'],
      Allergies['sulfa-allergy'],
    ],
    medications: [],
    observations: [],
  },

  // Complex patient on anticoagulation
  complexPatientOnWarfarin: {
    patient: Patients['patient-complex'],
    conditions: [
      Conditions['hypertension'],
      Conditions['atrial-fibrillation'],
      Conditions['heart-failure'],
    ],
    allergies: [Allergies['ace-inhibitor-cough']],
    medications: [
      Medications['warfarin'],
      Medications['lisinopril'],
      Medications['digoxin'],
    ],
    observations: [Observations['inr-therapeutic'], Observations['bp-high']],
  },

  // Renal patient with low eGFR
  renalPatient: {
    patient: Patients['patient-renal'],
    conditions: [Conditions['chronic-kidney-disease']],
    allergies: [],
    medications: [Medications['furosemide']],
    observations: [Observations['egfr-low'], Observations['potassium-high']],
  },
};
