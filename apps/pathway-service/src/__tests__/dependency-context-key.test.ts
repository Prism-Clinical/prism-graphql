import { dependencyContextKey } from '../services/resolution/effective-context';

describe('dependencyContextKey', () => {
  it('maps legacy coded bucket names', () => {
    expect(dependencyContextKey('conditions')).toBe('conditionCodes');
    expect(dependencyContextKey('medications')).toBe('medications');
    expect(dependencyContextKey('labs')).toBe('labResults');
    expect(dependencyContextKey('allergies')).toBe('allergies');
    expect(dependencyContextKey('vitals')).toBe('vitalSigns');
  });
  it('maps dotted attribute paths by namespace', () => {
    expect(dependencyContextKey('patient.trimester')).toBe('patientAttributes');
    expect(dependencyContextKey('lab.hemoglobin')).toBe('labResults');
    expect(dependencyContextKey('vitals.systolic_bp')).toBe('vitalSigns');
    expect(dependencyContextKey('allergy.metronidazole')).toBe('allergies');
  });
  it('returns undefined for unknown dependencies', () => {
    expect(dependencyContextKey('bogus')).toBeUndefined();
    expect(dependencyContextKey('unknown.path')).toBeUndefined();
  });
});
