/**
 * Rh type read tolerantly.
 *
 * [DECISION — Josh 2026-10-04]: "Accept common spellings". The prenatal pathway
 * flags "anything not clearly positive" on `patient.rh_factor`, compared as an
 * exact string — so a chart writing "Rh+", "POS" or "Positive" flagged every
 * patient. The value is normalised to one vocabulary (positive / negative /
 * weak D / partial D) wherever patient attributes enter an evaluation.
 * Anything unrecognised is left as written, so it still reads as not-positive.
 */

jest.mock('../resolvers/Query', () => ({
  hydrateSignalDefinition: (row: unknown) => row,
}));

import {
  PATIENT_ATTRIBUTE_NORMALIZERS,
  RH_FACTOR_SPELLINGS,
  RH_FACTOR_VALUES,
  normalizeAttributeValues,
  normalizePatientAttributes,
  normalizeRhFactor,
  rhFactorComparandError,
  rhFactorKey,
} from '../services/resolution/patient-attributes';
import { buildEffectivePatientContext } from '../services/resolution/effective-context';
import { loadRememberedAttributes } from '../services/resolution/remembered-answers';
import { validatePathwayJson } from '../services/import/validator';
import type { PathwayJson } from '../services/import/types';
import type { PatientContext } from '../services/confidence/types';
import { clonePathway } from './fixtures/reference-pathway';

describe('normalizeRhFactor', () => {
  it.each([
    // positive
    ['positive', 'positive'], ['Positive', 'positive'], ['POSITIVE', 'positive'], [' positive ', 'positive'],
    ['pos', 'positive'], ['POS', 'positive'], ['Pos.', 'positive'], ['+', 'positive'],
    ['Rh+', 'positive'], ['rh +', 'positive'], ['RH+', 'positive'],
    ['Rh positive', 'positive'], ['Rh-positive', 'positive'], ['RH POS', 'positive'], ['rh pos', 'positive'],
    ['Rh(D) positive', 'positive'], ['Rh(D) Positive', 'positive'], ['RhD positive', 'positive'], ['Rh D positive', 'positive'],
    ['Rh(D)+', 'positive'], ['RhD pos', 'positive'], ['D positive', 'positive'], ['D pos', 'positive'], ['D+', 'positive'],
    ['Rhesus positive', 'positive'],
    // negative
    ['negative', 'negative'], ['Negative', 'negative'], ['NEG', 'negative'], ['neg.', 'negative'], ['-', 'negative'],
    ['Rh-', 'negative'], ['rh -', 'negative'], ['Rh−', 'negative'], ['Rh–', 'negative'],
    ['Rh negative', 'negative'], ['Rh-negative', 'negative'], ['RH NEG', 'negative'],
    ['Rh(D) negative', 'negative'], ['RhD negative', 'negative'], ['Rh(D)-', 'negative'],
    ['D negative', 'negative'], ['D neg', 'negative'], ['D-', 'negative'], ['Rhesus negative', 'negative'],
    // weak D — BEFORE positive: "weak positive" is not "positive"
    ['weak D', 'weak D'], ['Weak D', 'weak D'], ['weak d', 'weak D'], ['WEAK-D', 'weak D'],
    ['Du', 'weak D'], ['DU', 'weak D'], ['weak positive', 'weak D'], ['Weakly Positive', 'weak D'], ['weak', 'weak D'],
    ['weak D positive', 'weak D'],
    // partial D
    ['partial D', 'partial D'], ['Partial D', 'partial D'], ['partial d', 'partial D'], ['PARTIAL-D', 'partial D'],
  ])('%j → %j', (written, canonical) => {
    expect(normalizeRhFactor(written)).toBe(canonical);
  });

  it.each([
    'unknown', 'Unknown', 'pending', 'not done', 'see lab report', '',
    // ABO+Rh strings are NOT parsed (not in Josh's list): left as written, so they read as not-positive.
    'O+', 'O pos', 'A POS', 'AB negative', 'O neg', 'B-',
    // Not guessed at.
    'positive?', 'pos/neg', 'Rh', 'D', 'partial', 'indeterminate', 'Rh null',
  ])('%j is not a recognised spelling: left exactly as written', (written) => {
    expect(normalizeRhFactor(written)).toBe(written);
  });

  it('is idempotent, and every canonical value is its own spelling', () => {
    for (const canonical of RH_FACTOR_VALUES) {
      expect(normalizeRhFactor(canonical)).toBe(canonical);
      expect(normalizeRhFactor(normalizeRhFactor(canonical.toUpperCase()))).toBe(canonical);
    }
  });

  it('leaves non-strings alone', () => {
    for (const v of [true, false, 1, 0, null, undefined]) expect(normalizeRhFactor(v)).toBe(v);
  });

  it('the table is exported, keyed in rhFactorKey form, and no spelling means two things', () => {
    const all = Object.values(RH_FACTOR_SPELLINGS).flat();
    expect(new Set(all).size).toBe(all.length);
    for (const s of all) expect(rhFactorKey(s)).toBe(s);
    expect(Object.keys(RH_FACTOR_SPELLINGS)).toEqual([...RH_FACTOR_VALUES]);
    expect(Object.keys(PATIENT_ATTRIBUTE_NORMALIZERS)).toEqual(['rh_factor']);
  });
});

describe('where it is applied', () => {
  it('normalizePatientAttributes — the chart at session start, and every addition', () => {
    expect(normalizePatientAttributes({ rh_factor: 'Rh+', gestational_age_weeks: 20 }))
      .toEqual({ rh_factor: 'positive', gestational_age_weeks: 20, trimester: 2 });
    expect(normalizePatientAttributes({ rh_factor: 'O neg' })).toEqual({ rh_factor: 'O neg' });
  });

  it('touches only rh_factor: another attribute holding "POS" is not rewritten', () => {
    const bag = { rh_factor: 'POS', gbs_status: 'POS', note: 'Rh+' };
    expect(normalizeAttributeValues(bag)).toEqual({ rh_factor: 'positive', gbs_status: 'POS', note: 'Rh+' });
    // No rh_factor, or an already-canonical one: the same object back.
    const clean = { rh_factor: 'negative', trimester: 2 };
    expect(normalizeAttributeValues(clean)).toBe(clean);
  });

  const pc = (patientAttributes?: Record<string, unknown>): PatientContext =>
    ({ patientId: 'p', conditionCodes: [], medications: [], labResults: [], allergies: [], ...(patientAttributes ? { patientAttributes } : {}) }) as unknown as PatientContext;

  it('buildEffectivePatientContext — a stored session whose chart value was never normalised', () => {
    expect(buildEffectivePatientContext(pc({ rh_factor: 'RH POS' }), undefined).patientAttributes).toEqual({ rh_factor: 'positive' });
  });

  it('buildEffectivePatientContext — an answer or added value, over the chart', () => {
    const effective = buildEffectivePatientContext(pc({ rh_factor: 'unknown' }), { patientAttributes: { rh_factor: 'Rh(D) Negative' } });
    expect(effective.patientAttributes).toEqual({ rh_factor: 'negative' });
  });

  it('loadRememberedAttributes — a remembered answer stored in an old spelling', async () => {
    const db = { query: jest.fn().mockResolvedValue({ rows: [{ attribute: 'rh_factor', value: 'Rh+', scope: 'PATIENT', answered_on: '2026-01-05' }] }) } as never;
    expect(await loadRememberedAttributes(db, { patientId: 'p', asOf: '2026-10-04T12:00:00.000Z', suppliedAttributes: {} }))
      .toEqual({ rh_factor: 'positive' });
  });
});

describe('authoring: comparands must be canonical', () => {
  function withCondition(condition: Record<string, unknown>): PathwayJson {
    const pw = clonePathway();
    pw.nodes.push({ id: 'gate-t', type: 'Gate' as never, properties: { title: 'T', gate_type: 'patient_attribute', default_behavior: 'skip', condition } });
    pw.edges.push({ from: 'step-1-1', to: 'gate-t', type: 'HAS_GATE' as never });
    pw.edges.push({ from: 'gate-t', to: 'step-1-2', type: 'BRANCHES_TO' as never });
    return pw;
  }
  const rh = (operator: string, value: unknown) => ({ attribute: 'patient.rh_factor', operator, value });

  it('accepts the canonical words, and words that are not Rh spellings at all', () => {
    for (const c of [rh('not_equals', 'positive'), rh('in', ['positive', 'negative', 'weak D', 'partial D']), rh('equals', 'unknown')]) {
      expect(validatePathwayJson(withCondition(c)).errors).toEqual([]);
    }
  });

  it.each([['Positive', 'positive'], ['Rh+', 'positive'], ['NEG', 'negative'], ['weak d', 'weak D']])(
    'rejects %j, which no normalised value can equal — and says to write %j',
    (written, canonical) => {
      expect(rhFactorComparandError(written)).toContain(`write ${JSON.stringify(canonical)}`);
      const result = validatePathwayJson(withCondition(rh('not_equals', written)));
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(expect.stringContaining('can never match'));
      const inList = validatePathwayJson(withCondition(rh('in', ['unknown', written])));
      expect(inList.valid).toBe(false);
    },
  );
});
