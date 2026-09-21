import { ddiSuppressionReason } from '../services/resolution/pipeline/disposition';

const finding = (category: string, source: Record<string, unknown>) => ({
  recommendationId: 'm', drugName: 'Amoxicillin', action: 'SUPPRESS', severity: 'SEVERE',
  category, mechanism: null, clinicalAdvice: null, source,
});
const DDI = finding('DDI_SEVERE', { kind: 'PATIENT_MEDICATION', rxcui: '11289', name: 'warfarin' });
const ALLERGY = finding('ALLERGY', { kind: 'PATIENT_ALLERGY', snomedCode: '91936005', snomedDisplay: 'Allergy to penicillin' });

describe('ddiSuppressionReason (moved from ddi-pass-single-pathway)', () => {
  it('names an allergy before a drug-drug interaction, whatever order the findings arrive in', () => {
    for (const findings of [[DDI, ALLERGY], [ALLERGY, DDI]]) {
      expect(ddiSuppressionReason(findings as never, 'm')).toBe('ALLERGY: patient allergy "Allergy to penicillin"');
    }
  });

  it('names the other recommendation of a pair suppression', () => {
    const pair = finding('DDI_SEVERE', { kind: 'OTHER_RECOMMENDATION', recommendationId: 'pw-c|asa', drugName: 'Aspirin' });
    expect(ddiSuppressionReason([pair] as never, 'm')).toBe('DDI_SEVERE: recommendation "Aspirin"');
  });

  it('is undefined when nothing suppresses the node', () => {
    expect(ddiSuppressionReason([], 'm')).toBeUndefined();
  });
});
