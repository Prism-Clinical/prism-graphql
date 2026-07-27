import { selectFacts } from '../../services/resolution/temporal/select-facts';
import { NormalizedFact } from '../../services/resolution/temporal/fact-model';
import { ResolvedHorizon } from '../../services/resolution/temporal/overlap';

const Q: ResolvedHorizon = { lowerBound: '2026-04-27T00:00:00.000Z', upperBound: '2026-07-26T00:00:00.000Z' };
const LIFE: ResolvedHorizon = { lowerBound: null, upperBound: '2026-07-26T00:00:00.000Z' };

const lab = (factId: string, d: string, value: number, valid = true): NormalizedFact => ({
  kind: 'lab', factId, code: '718-7', system: 'LOINC', value, unit: 'g/dL',
  observationStatus: valid ? 'final' : 'entered-in-error',
  interval: { start: { value: d, precision: 'day' }, end: { kind: 'KNOWN', bound: { value: d, precision: 'day' } } },
  recordValidity: valid ? 'VALID' : 'INVALID',
  validityBasis: valid ? 'observation:final' : 'observation:entered-in-error',
  provenance: { sourceType: 'SYNTHETIC' },
});
const cond = (factId: string, code: string, state: 'ACTIVE' | 'CONFLICT'): NormalizedFact => ({
  kind: 'condition', factId, code, system: 'ICD-10',
  interval: { start: { value: '2020', precision: 'year' }, end: { kind: 'OPEN', assertedCurrentAt: '2026-06-01T00:00:00.000Z' } },
  recordValidity: 'VALID', validityBasis: 'verification:confirmed', provenance: { sourceType: 'SYNTHETIC' },
  clinicalState: state, stateBasis: 'FHIR_STATUS',
});

test('field/kind isolation: a lab fact never satisfies a conditions gate', () => {
  const out = selectFacts({ field: 'conditions', operator: 'includes_code', value: '718-7' }, [lab('a', '2026-05-01', 10)], { horizon: Q, status: 'active' });
  expect(out.status).toBe('NO_MATCH');
});

test('includes_code supports trailing wildcard', () => {
  const out = selectFacts({ field: 'conditions', operator: 'includes_code', value: 'Z94.*', system: 'ICD-10' }, [cond('c1', 'Z94.0', 'ACTIVE')], { horizon: LIFE, status: 'active' });
  expect(out.status).toBe('READY');
  if (out.status === 'READY') expect(out.selected.map((f) => f.factId)).toEqual(['c1']);
});

test('exists ignores value and matches on field/kind', () => {
  const out = selectFacts({ field: 'conditions', operator: 'exists', value: '' }, [cond('c1', 'E11.9', 'ACTIVE')], { horizon: LIFE, status: 'active' });
  expect(out.status).toBe('READY');
});

test('scalar less_than selects the definite-latest valid lab', () => {
  const out = selectFacts({ field: 'labs', operator: 'less_than', value: '718-7', system: 'LOINC' }, [lab('a', '2026-05-01', 10), lab('b', '2026-07-01', 12)], { horizon: Q });
  expect(out.status).toBe('READY');
  if (out.status === 'READY') {
    expect(out.selected).toHaveLength(1);
    expect(out.selected[0].factId).toBe('b');
  }
});

test('scalar with two labs on the SAME day is INDETERMINATE (no definite latest)', () => {
  const out = selectFacts({ field: 'labs', operator: 'less_than', value: '718-7', system: 'LOINC' }, [lab('a', '2026-05-01', 10), lab('b', '2026-05-01', 12)], { horizon: Q });
  expect(out.status).toBe('INDETERMINATE');
});

test('invalid labs drop; if all candidates invalid → NO_MATCH', () => {
  const out = selectFacts({ field: 'labs', operator: 'less_than', value: '718-7', system: 'LOINC' }, [lab('a', '2026-07-01', 9, false)], { horizon: Q });
  expect(out.status).toBe('NO_MATCH');
});

test('count_in_window counts distinct factIds', () => {
  const out = selectFacts({ field: 'labs', operator: 'count_in_window', value: '718-7', system: 'LOINC' }, [lab('a', '2026-05-01', 10), lab('b', '2026-06-01', 10)], { horizon: Q });
  expect(out.status).toBe('READY');
  if (out.status === 'READY') expect(out.selected.map((f) => f.factId).sort()).toEqual(['a', 'b']);
});

test('membership admits an undated fact via temporal fail-open (temporallyUnverified)', () => {
  const undated: NormalizedFact = {
    kind: 'condition', factId: 'c1', code: 'E11.9', system: 'ICD-10',
    interval: { start: undefined, end: { kind: 'UNKNOWN' } }, recordValidity: 'VALID', validityBasis: 'verification:absent',
    provenance: { sourceType: 'SYNTHETIC' }, clinicalState: 'ACTIVE', stateBasis: 'FHIR_STATUS',
  };
  const out = selectFacts({ field: 'conditions', operator: 'includes_code', value: 'E11.9', system: 'ICD-10' }, [undated], { horizon: Q, status: 'active' });
  expect(out.status).toBe('READY');
  if (out.status === 'READY') {
    expect(out.selected).toHaveLength(1);
    expect(out.temporallyUnverified).toBe(true);
  }
});

test('CONFLICT state under status:active is excluded despite membership fail-open', () => {
  const out = selectFacts({ field: 'conditions', operator: 'includes_code', value: 'E11.9', system: 'ICD-10' }, [cond('c1', 'E11.9', 'CONFLICT')], { horizon: LIFE, status: 'active' });
  expect(out.status).toBe('NO_MATCH');
  expect(out.decisions[0].stateMatch).toBe('NO_MATCH');
});
