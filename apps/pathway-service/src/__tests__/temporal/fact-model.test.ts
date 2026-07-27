import { isObservationFact, isStatefulFact, NormalizedFact } from '../../services/resolution/temporal/fact-model';

const lab: NormalizedFact = {
  kind: 'lab', factId: 'f1', code: '718-7', system: 'LOINC', value: 10.2, unit: 'g/dL', observationStatus: 'final',
  interval: { start: { value: '2026-01-01', precision: 'day' }, end: { kind: 'KNOWN', bound: { value: '2026-01-01', precision: 'day' } } },
  recordValidity: 'VALID', validityBasis: 'observation:final', provenance: { sourceType: 'SYNTHETIC' },
};
const vital: NormalizedFact = {
  kind: 'vital', factId: 'v1', code: 'systolic_bp', system: 'vitals', value: 128,
  interval: { start: undefined, end: { kind: 'OPEN', assertedCurrentAt: '2026-07-26T00:00:00.000Z' } },
  recordValidity: 'VALID', validityBasis: 'vital:present', provenance: { sourceType: 'SYNTHETIC' },
};
const cond: NormalizedFact = {
  kind: 'condition', factId: 'c1', code: 'E11.9', system: 'ICD-10',
  interval: { start: { value: '2020', precision: 'year' }, end: { kind: 'OPEN', assertedCurrentAt: '2026-07-01T00:00:00.000Z' } },
  recordValidity: 'VALID', validityBasis: 'verification:confirmed', provenance: { sourceType: 'SYNTHETIC' },
  clinicalState: 'ACTIVE', stateBasis: 'FHIR_STATUS',
};

test('guards discriminate observation (lab+vital) vs stateful', () => {
  expect(isObservationFact(lab)).toBe(true);
  expect(isObservationFact(vital)).toBe(true);
  expect(isObservationFact(cond)).toBe(false);
  expect(isStatefulFact(cond)).toBe(true);
  expect(isStatefulFact(lab)).toBe(false);
});
