import { PatientContext } from '../../services/confidence/types';

export const REFERENCE_PATIENT: PatientContext = {
  patientId: 'patient-test-001',
  conditionCodes: [
    { code: 'O34.211', system: 'ICD-10', display: 'Low transverse cesarean scar' },
    { code: 'Z87.51', system: 'ICD-10', display: 'Personal history of other complications of pregnancy' },
  ],
  medications: [
    { code: '7052', system: 'RXNORM', display: 'Oxytocin' },
    { code: '161', system: 'RXNORM', display: 'Prenatal vitamins' },
  ],
  labResults: [
    {
      code: '58410-2',
      system: 'LOINC',
      display: 'Complete Blood Count',
      date: '2026-03-20',
    },
    {
      code: '718-7',
      system: 'LOINC',
      display: 'Hemoglobin',
      value: 11.5,
      unit: 'g/dL',
      date: '2026-03-20',
    },
  ],
  allergies: [
    { code: '7980', system: 'RXNORM', display: 'Penicillin' },
  ],
};

export const EMPTY_PATIENT: PatientContext = {
  patientId: 'patient-empty-001',
  conditionCodes: [],
  medications: [],
  labResults: [],
  allergies: [],
};

export const FULLY_MATCHED_PATIENT: PatientContext = {
  patientId: 'patient-full-001',
  conditionCodes: [
    { code: 'O34.211', system: 'ICD-10', display: 'Low transverse cesarean scar' },
    { code: 'O34.29', system: 'ICD-10', display: 'Prior classical or T-incision' },
  ],
  medications: [
    { code: '7052', system: 'RXNORM', display: 'Oxytocin' },
    { code: '24689', system: 'RXNORM', display: 'Dinoprostone' },
  ],
  labResults: [
    {
      code: '58410-2',
      system: 'LOINC',
      display: 'Complete Blood Count',
      value: 8.2,
      unit: '10*3/uL',
      date: '2026-03-20',
    },
  ],
  allergies: [],
  vitalSigns: {
    bloodPressure: { systolic: 120, diastolic: 78 },
    heartRate: 72,
  },
};
