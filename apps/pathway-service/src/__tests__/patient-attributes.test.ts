import { normalizePatientAttributes } from '../services/resolution/patient-attributes';

describe('normalizePatientAttributes', () => {
  it('returns undefined for nullish/empty input', () => {
    expect(normalizePatientAttributes(undefined)).toBeUndefined();
    expect(normalizePatientAttributes({})).toBeUndefined();
  });
  it('passes primitives through and drops non-primitives', () => {
    expect(normalizePatientAttributes({ trimester: 2, rh_factor: 'negative', flag: true, obj: { a: 1 } }))
      .toEqual({ trimester: 2, rh_factor: 'negative', flag: true });
  });
  it('derives trimester from gestational_age_weeks when trimester is absent', () => {
    expect(normalizePatientAttributes({ gestational_age_weeks: 10 })).toEqual({ gestational_age_weeks: 10, trimester: 1 });
    expect(normalizePatientAttributes({ gestational_age_weeks: 20 })).toEqual({ gestational_age_weeks: 20, trimester: 2 });
    expect(normalizePatientAttributes({ gestational_age_weeks: 30 })).toEqual({ gestational_age_weeks: 30, trimester: 3 });
  });
  it('does not override an explicitly supplied trimester', () => {
    expect(normalizePatientAttributes({ gestational_age_weeks: 30, trimester: 2 }))
      .toEqual({ gestational_age_weeks: 30, trimester: 2 });
  });
});
