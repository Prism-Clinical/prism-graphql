import { buildAttributeVocabulary, KNOWN_PATIENT_ATTRIBUTES } from '../services/resolution/attribute-vocabulary';

describe('buildAttributeVocabulary', () => {
  it('merges code-map (lab/allergy) entries with the known patient.* set', () => {
    const vocab = buildAttributeVocabulary([
      { attributeName: 'lab.hemoglobin', namespace: 'lab', system: 'LOINC', code: '718-7', valueType: 'number' },
    ]);
    expect(vocab.find((v) => v.attribute === 'lab.hemoglobin')?.valueType).toBe('number');
    // every known patient.* attribute is present
    for (const p of KNOWN_PATIENT_ATTRIBUTES) {
      expect(vocab.find((v) => v.attribute === `patient.${p.name}`)).toBeTruthy();
    }
  });
});
