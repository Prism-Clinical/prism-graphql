import { buildPatientContext } from '../resolvers/mutations/multi-pathway-resolution';

describe('buildPatientContext maps patientAttributes', () => {
  it('normalizes and attaches patientAttributes from input', () => {
    const pc = buildPatientContext({
      patientId: 'p',
      patientContext: {
        patientId: 'p',
        conditionCodes: [],
        medications: [],
        labResults: [],
        allergies: [],
        vitalSigns: {},
        freeformData: {},
        patientAttributes: { gestational_age_weeks: 20 },
      },
    } as never);
    expect(pc.patientAttributes).toEqual({ gestational_age_weeks: 20, trimester: 2 });
  });
});
