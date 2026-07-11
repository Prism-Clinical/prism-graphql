import { resolveAttribute } from '../services/resolution/attribute-registry';
import { buildCodeMap } from '../services/resolution/attribute-code-map';
import type { PatientContext } from '../services/confidence/types';

const codeMap = buildCodeMap([
  { attributeName: 'lab.hemoglobin', namespace: 'lab', system: 'LOINC', code: '718-7', valueType: 'number' },
  { attributeName: 'allergy.metronidazole', namespace: 'allergy', system: 'RXNORM', code: '6922', valueType: 'boolean' },
]);

function ctx(o: Partial<PatientContext> = {}): PatientContext {
  return { patientId: 'p', conditionCodes: [], medications: [], allergies: [], labResults: [], ...o };
}

describe('resolveAttribute', () => {
  it('lab.* resolves a numeric lab by mapped LOINC code', () => {
    const r = resolveAttribute(
      ctx({ labResults: [{ code: '718-7', system: 'LOINC', value: 8.1 }] }),
      'lab.hemoglobin', codeMap);
    expect(r.value).toBe(8.1);
    expect(r.fieldsRead).toEqual(['lab.hemoglobin']);
  });

  it('vitals.* reads the vitalSigns bag', () => {
    const r = resolveAttribute(ctx({ vitalSigns: { systolic_bp: 150 } }), 'vitals.systolic_bp', codeMap);
    expect(r.value).toBe(150);
  });

  it('allergy.* returns a boolean presence', () => {
    const present = resolveAttribute(ctx({ allergies: [{ code: '6922', system: 'RXNORM' }] }), 'allergy.metronidazole', codeMap);
    expect(present.value).toBe(true);
    const absent = resolveAttribute(ctx(), 'allergy.metronidazole', codeMap);
    expect(absent.value).toBe(false);
  });

  it('patient.* reads patientAttributes', () => {
    const r = resolveAttribute(ctx({ patientAttributes: { trimester: 2 } }), 'patient.trimester', codeMap);
    expect(r.value).toBe(2);
  });

  it('unknown namespace yields undefined value but still a fieldsRead path', () => {
    const r = resolveAttribute(ctx(), 'bogus.thing', codeMap);
    expect(r.value).toBeUndefined();
    expect(r.fieldsRead).toEqual(['bogus.thing']);
  });
});
