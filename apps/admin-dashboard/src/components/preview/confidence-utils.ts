import type { PatientContextInput, ResolutionType } from '@/types';

// ─── Sample Patient Presets ──────────────────────────────────────────

export const SAMPLE_PATIENTS: Record<string, { label: string; context: PatientContextInput }> = {
  reference: {
    label: 'Reference Patient (Chronic HTN)',
    context: {
      patientId: 'patient-preview-001',
      conditionCodes: [
        { code: 'O13.1', system: 'ICD-10', display: 'Gestational hypertension, second trimester' },
        { code: 'O10.011', system: 'ICD-10', display: 'Pre-existing essential hypertension' },
        { code: 'Z87.51', system: 'ICD-10', display: 'History of complications of pregnancy' },
      ],
      medications: [
        { code: '6918', system: 'RXNORM', display: 'Labetalol' },
        { code: '29046', system: 'RXNORM', display: 'Nifedipine' },
        { code: '161', system: 'RXNORM', display: 'Prenatal vitamins' },
      ],
      labResults: [
        { code: '58410-2', system: 'LOINC', display: 'Complete Blood Count', date: '2026-03-20' },
        { code: '718-7', system: 'LOINC', display: 'Hemoglobin', value: 11.5, unit: 'g/dL', date: '2026-03-20' },
        { code: '2160-0', system: 'LOINC', display: 'Creatinine', value: 0.8, unit: 'mg/dL', date: '2026-03-20' },
        { code: '2823-3', system: 'LOINC', display: 'Potassium', value: 4.2, unit: 'mmol/L', date: '2026-03-20' },
      ],
      allergies: [
        { code: '7980', system: 'RXNORM', display: 'Penicillin' },
      ],
      vitalSigns: {
        bloodPressure: { systolic: 148, diastolic: 94 },
        heartRate: 82,
      },
    },
  },
  empty: {
    label: 'Empty Patient (No Data)',
    context: {
      patientId: 'patient-preview-empty',
      conditionCodes: [],
      medications: [],
      labResults: [],
      allergies: [],
    },
  },
  fullyMatched: {
    label: 'Fully Matched Patient',
    context: {
      patientId: 'patient-preview-full',
      conditionCodes: [
        { code: 'O13.1', system: 'ICD-10', display: 'Gestational hypertension, second trimester' },
        { code: 'O10.011', system: 'ICD-10', display: 'Pre-existing essential hypertension' },
        { code: 'O14.1', system: 'ICD-10', display: 'Severe preeclampsia' },
        { code: 'Z87.51', system: 'ICD-10', display: 'History of complications of pregnancy' },
      ],
      medications: [
        { code: '6918', system: 'RXNORM', display: 'Labetalol' },
        { code: '29046', system: 'RXNORM', display: 'Nifedipine' },
        { code: '4603', system: 'RXNORM', display: 'Hydralazine' },
        { code: '6313', system: 'RXNORM', display: 'Magnesium sulfate' },
      ],
      labResults: [
        { code: '58410-2', system: 'LOINC', display: 'Complete Blood Count', value: 8.2, unit: '10*3/uL', date: '2026-03-20' },
        { code: '718-7', system: 'LOINC', display: 'Hemoglobin', value: 12.1, unit: 'g/dL', date: '2026-03-20' },
        { code: '2160-0', system: 'LOINC', display: 'Creatinine', value: 0.7, unit: 'mg/dL', date: '2026-03-20' },
        { code: '2823-3', system: 'LOINC', display: 'Potassium', value: 4.0, unit: 'mmol/L', date: '2026-03-20' },
        { code: '1742-6', system: 'LOINC', display: 'ALT', value: 22, unit: 'U/L', date: '2026-03-20' },
        { code: '1920-8', system: 'LOINC', display: 'AST', value: 18, unit: 'U/L', date: '2026-03-20' },
        { code: '2085-9', system: 'LOINC', display: 'Urine protein', value: 150, unit: 'mg/24hr', date: '2026-03-20' },
      ],
      allergies: [],
      vitalSigns: {
        bloodPressure: { systolic: 155, diastolic: 98 },
        heartRate: 78,
      },
    },
  },
};

// ─── Color Helpers ───────────────────────────────────────────────────

export function confidenceColor(score: number): string {
  if (score >= 0.85) return '#16a34a'; // green-600
  if (score >= 0.60) return '#ca8a04'; // yellow-600
  return '#dc2626'; // red-600
}

export function confidenceBg(score: number): string {
  if (score >= 0.85) return 'bg-green-50 border-green-200';
  if (score >= 0.60) return 'bg-yellow-50 border-yellow-200';
  return 'bg-red-50 border-red-200';
}

export function confidenceTextColor(score: number): string {
  if (score >= 0.85) return 'text-green-700';
  if (score >= 0.60) return 'text-yellow-700';
  return 'text-red-700';
}

export function confidenceBarColor(score: number): string {
  if (score >= 0.85) return 'bg-green-500';
  if (score >= 0.60) return 'bg-yellow-500';
  return 'bg-red-500';
}

export function resolutionLabel(type: ResolutionType): string {
  switch (type) {
    case 'AUTO_RESOLVED': return 'Auto-Resolved';
    case 'SYSTEM_SUGGESTED': return 'System Suggested';
    case 'PROVIDER_DECIDED': return 'Provider Decision';
    case 'FORCED_MANUAL': return 'Manual Only';
    default: return type;
  }
}

export function resolutionBadgeClass(type: ResolutionType): string {
  switch (type) {
    case 'AUTO_RESOLVED': return 'bg-green-100 text-green-800 border-green-200';
    case 'SYSTEM_SUGGESTED': return 'bg-blue-100 text-blue-800 border-blue-200';
    case 'PROVIDER_DECIDED': return 'bg-yellow-100 text-yellow-800 border-yellow-200';
    case 'FORCED_MANUAL': return 'bg-red-100 text-red-800 border-red-200';
    default: return 'bg-gray-100 text-gray-800 border-gray-200';
  }
}
