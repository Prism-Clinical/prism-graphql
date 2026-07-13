import { buildEffectivePatientContext } from '../services/resolution/effective-context';
import type { PatientContext } from '../services/confidence/types';

const BASE: PatientContext = {
  patientId: 'p1',
  conditionCodes: [{ code: 'D64.9', system: 'ICD-10' }],
  medications: [],
  labResults: [{ code: '718-7', system: 'LOINC', value: 8.1 }],
  allergies: [],
  vitalSigns: { systolic_bp: 120 },
  freeformData: { note: 'x' },
  patientAttributes: { trimester: 1 },
} as PatientContext;

describe('buildEffectivePatientContext', () => {
  it('returns a value-equal context when additions are empty/undefined', () => {
    expect(buildEffectivePatientContext(BASE, undefined)).toEqual(BASE);
    expect(buildEffectivePatientContext(BASE, {})).toEqual(BASE);
  });

  it('dedups coded arrays by code|system and appends new ones', () => {
    const out = buildEffectivePatientContext(BASE, {
      conditionCodes: [{ code: 'D64.9', system: 'ICD-10' }, { code: 'O99.0', system: 'ICD-10' }],
    } as never);
    expect(out.conditionCodes).toEqual([
      { code: 'D64.9', system: 'ICD-10' },
      { code: 'O99.0', system: 'ICD-10' },
    ]);
  });

  it('spread-merges vitalSigns and freeformData (added overrides base)', () => {
    const out = buildEffectivePatientContext(BASE, {
      vitalSigns: { diastolic_bp: 80, systolic_bp: 130 },
      freeformData: { extra: 'y' },
    } as never);
    expect(out.vitalSigns).toEqual({ systolic_bp: 130, diastolic_bp: 80 });
    expect(out.freeformData).toEqual({ note: 'x', extra: 'y' });
  });

  it('normalizes and merges patientAttributes (GA->trimester derivation applies)', () => {
    const out = buildEffectivePatientContext(BASE, {
      patientAttributes: { gestational_age_weeks: 20 },
    } as never);
    // base trimester 1 is overridden by the normalized additions (GA 20 -> trimester 2)
    expect(out.patientAttributes).toEqual({ trimester: 2, gestational_age_weeks: 20 });
  });

  it('does not mutate the input context', () => {
    const snapshot = JSON.parse(JSON.stringify(BASE));
    buildEffectivePatientContext(BASE, { medications: [{ code: 'M1', system: 'RxNorm' }] } as never);
    expect(BASE).toEqual(snapshot);
  });
});
