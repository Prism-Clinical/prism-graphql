import { applicablePathways, isPregnant } from '../services/resolution/pathway-applicability';
import type { PatientContext } from '../services/confidence/types';
import type { MatchedPathway } from '../services/resolution/types';

const patient = (codes: string[], attrs: Record<string, unknown> = {}): PatientContext =>
  ({
    patientId: 'p', medications: [], allergies: [], labResults: [],
    conditionCodes: codes.map((code) => ({ code, system: 'ICD-10' })),
    patientAttributes: attrs,
  }) as unknown as PatientContext;
const matched = (id: string, category: string) => ({ pathway: { id, category } }) as unknown as MatchedPathway;

describe('isPregnant', () => {
  it.each([
    [['Z34.82'], {}], [['O99.012'], {}], [['Z3A.20'], {}], [['Z33.1'], {}],
    [['D50.9'], { gestational_age_weeks: 20 }], [['D50.9'], { trimester: 2 }],
  ])('%j %j is pregnant', (codes, attrs) => expect(isPregnant(patient(codes, attrs))).toBe(true));

  it.each([
    [['D50.9'], {}], [['R82.71', 'I10'], {}], [[], {}], [['Z30.011'], {}],
  ])('%j %j is not', (codes, attrs) => expect(isPregnant(patient(codes, attrs))).toBe(false));
});

describe('applicablePathways', () => {
  const both = [matched('ob', 'OBSTETRIC'), matched('general', 'CHRONIC_DISEASE')];

  it('drops an obstetric pathway for a patient who is not pregnant', () => {
    expect(applicablePathways(both, patient(['D50.9'])).map((m) => m.pathway.id)).toEqual(['general']);
  });

  it('keeps it once the chart says she is pregnant', () => {
    expect(applicablePathways(both, patient(['D50.9', 'Z34.82'])).map((m) => m.pathway.id)).toEqual(['ob', 'general']);
  });
});
