import {
  immunizationMedicationEntry, immunizationOfEntry, occurrencePhrase, parseOccurrence, parseVaccineRef, toFhirImmunization,
} from '../services/resolution/immunizations';
import { classMembership } from '../services/resolution/medication-classes';
import { validatePathwayJson } from '../services/import/validator';

const FLU = { cvx: '88', rxnormIngredient: '1657128', display: 'Influenza vaccine' };
const AS_OF = '2026-10-05T14:00:00.000Z';

describe('parseOccurrence', () => {
  it('takes a day', () => {
    expect(parseOccurrence('2026-10-01', null, AS_OF)).toEqual({ date: '2026-10-01', precision: 'DAY' });
  });
  it('stores a month as its first day, so only a whole month inside a window counts', () => {
    expect(parseOccurrence('2026-09', null, AS_OF)).toEqual({ date: '2026-09-01', precision: 'MONTH' });
  });
  it('takes no date as unknown', () => {
    expect(parseOccurrence(undefined, null, AS_OF)).toEqual({ precision: 'UNKNOWN' });
    expect(parseOccurrence('  ', null, AS_OF)).toEqual({ precision: 'UNKNOWN' });
  });
  it('refuses a date after the visit, a non-date and a malformed one', () => {
    expect(() => parseOccurrence('2026-10-06', null, AS_OF)).toThrow(/after this visit/);
    expect(() => parseOccurrence('2026-02-30', null, AS_OF)).toThrow(/not a date/);
    expect(() => parseOccurrence('last fall', null, AS_OF)).toThrow(/YYYY-MM-DD/);
  });
});

describe('a dose as a medication entry', () => {
  const dose = { id: 'abc', origin: 'PRISM' as const, ...FLU, date: '2026-10-01', precision: 'DAY' as const, reported: true };
  const entry = immunizationMedicationEntry(dose);

  it('is coded as the ingredient, so a class gate counts it with no identity lookup', () => {
    expect(entry).toMatchObject({ code: '1657128', system: 'RXNORM', date: '2026-10-01' });
    expect(classMembership(null, entry, 'RXNORM_INGREDIENT', '1657128')).toBe('MEMBER');
  });
  it('reads back as the same dose', () => {
    expect(immunizationOfEntry(entry)).toEqual(dose);
  });
  it('carries no date when the date is not known', () => {
    const undated = immunizationMedicationEntry({ ...dose, date: undefined, precision: 'UNKNOWN' });
    expect(undated.date).toBeUndefined();
    expect(immunizationOfEntry(undated)?.precision).toBe('UNKNOWN');
  });
  it('leaves an ordinary medication alone', () => {
    expect(immunizationOfEntry({ code: '1657128', system: 'RXNORM' })).toBeNull();
    expect(immunizationOfEntry({ code: '1657128', system: 'RXNORM', sourceId: 'ehr:42' })).toBeNull();
  });
});

describe('for transfer', () => {
  it('is a FHIR Immunization: CVX first, reported, month precision kept', () => {
    const fhir = toFhirImmunization(
      { id: 'abc', origin: 'PRISM', ...FLU, date: '2025-10-01', precision: 'MONTH', reported: true, recordedAt: '2026-10-05T14:00:00.000Z' },
      'p1',
    ) as Record<string, any>;
    expect(fhir.resourceType).toBe('Immunization');
    expect(fhir.status).toBe('completed');
    expect(fhir.vaccineCode.coding[0]).toEqual({ system: 'http://hl7.org/fhir/sid/cvx', code: '88', display: 'Influenza vaccine' });
    expect(fhir.occurrenceDateTime).toBe('2025-10');
    expect(fhir.primarySource).toBe(false);
    expect(fhir.patient.reference).toBe('Patient/p1');
  });
  it('says so when the date is not known', () => {
    const fhir = toFhirImmunization({ id: 'abc', origin: 'PRISM', ...FLU, precision: 'UNKNOWN', reported: true }, 'p1');
    expect(fhir.occurrenceString).toBe('unknown');
    expect(fhir.occurrenceDateTime).toBeUndefined();
  });
});

describe('wording', () => {
  it('names the day, the month, or neither', () => {
    expect(occurrencePhrase({ date: '2026-10-01', precision: 'DAY' })).toBe('on 2026-10-01');
    expect(occurrencePhrase({ date: '2025-10-01', precision: 'MONTH' })).toBe('in October 2025');
    expect(occurrencePhrase({ precision: 'UNKNOWN' })).toBe('on a date not known');
  });
});

describe('authored immunization', () => {
  it('parses the authored shape', () => {
    expect(parseVaccineRef({ cvx: '88', rxnorm_ingredient: '1657128', display: 'Influenza vaccine' })).toEqual(FLU);
  });
  it('names what is wrong', () => {
    expect(parseVaccineRef({ cvx: 88, rxnorm_ingredient: '1', display: 'x' })).toHaveProperty('problem');
    expect(parseVaccineRef({ cvx: '88', display: 'x' })).toHaveProperty('problem');
    expect(parseVaccineRef({ cvx: '88', rxnorm_ingredient: '1', display: 'x', brand: 'y' })).toHaveProperty('problem');
  });
  it('the routine prenatal pathway imports with it', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const pathway = require('../../../../pathways/json/routine-prenatal-care.json');
    const result = validatePathwayJson(pathway);
    expect(result.errors).toEqual([]);
    const marked = pathway.nodes.filter((n: any) => n.properties.immunization);
    expect(marked.length).toBe(14);
  });
});
