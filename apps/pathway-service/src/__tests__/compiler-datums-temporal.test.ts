// apps/pathway-service/src/__tests__/compiler-datums-temporal.test.ts
import { buildDatumRegistry, resolveDatums } from '../services/compiler/datums';
import { checkTemporal } from '../services/compiler/temporal';
import type { CompileError, DatumKey, DatumSpec } from '../services/compiler/model';
import { buildCodeMap } from '../services/resolution/attribute-code-map';

const codeMap = buildCodeMap([
  { attributeName: 'lab.hemoglobin', namespace: 'lab', system: 'LOINC', code: '718-7', valueType: 'number' },
  { attributeName: 'lab.rh_factor', namespace: 'lab', system: 'LOINC', code: '10331-7', valueType: 'string' },
  { attributeName: 'allergy.metronidazole', namespace: 'allergy', system: 'RXNORM', code: '6922', valueType: 'boolean' },
]);
type Reader = [string, Record<string, unknown>[]];
const resolve = (readers: Reader[], map = codeMap) => {
  const datums = new Map<DatumKey, DatumSpec>();
  const errors: CompileError[] = [];
  const registry = buildDatumRegistry(map);
  for (const [gate, conditions] of readers) resolveDatums(gate, conditions, map, registry, datums, errors);
  return { datums: [...datums.values()].sort((a, b) => (a.key < b.key ? -1 : 1)), errors };
};

const READERS: Reader[] = [
  ['g2', [{ attribute: 'lab.hemoglobin', operator: 'less_than', value: 7 }]],
  ['g1', [{ field: 'labs', operator: 'less_than', value: '718-7', system: 'LOINC', threshold: 11 }]],
  ['g3', [
    { attribute: 'patient.trimester', operator: 'in', value: [1, 3] },
    { attribute: 'vitals.systolic_bp', operator: 'greater_than', value: 140 },
    { field: 'vitals', operator: 'greater_than', value: 'systolic_bp', threshold: 140 },
    { attribute: 'allergy.metronidazole', operator: 'equals', value: true },
    { field: 'conditions', operator: 'includes_code', value: 'O99.0*', system: 'ICD-10' },
    { field: 'labs', operator: 'equals', value: '10331-7', system: 'LOINC' },
    { attribute: 'lab.rh_factor', operator: 'equals', value: 'negative' },
  ]],
];

describe('resolveDatums', () => {
  it('gives coded and attribute spellings one key and one registry type, and records every reader', () => {
    const { datums, errors } = resolve(READERS);
    expect(errors).toEqual([]);
    expect(datums).toEqual([
      { key: 'allergy:RXNORM:6922', domain: 'allergy', valueType: 'boolean', readBy: ['g3'] },
      { key: 'attribute:trimester', domain: 'attribute', valueType: 'number', readBy: ['g3'] },
      { key: 'lab:LOINC:10331-7', domain: 'lab', valueType: 'string', readBy: ['g3'] },   // membership read added nothing
      { key: 'lab:LOINC:718-7', domain: 'lab', valueType: 'number', readBy: ['g1', 'g2'] },
      { key: 'vital:systolic_bp', domain: 'vital', valueType: 'number', readBy: ['g3'] },
    ]);
  });

  it('is independent of reader order', () => {
    expect(resolve([...READERS].reverse())).toEqual(resolve(READERS));
    const g3 = READERS[2];
    expect(resolve([[g3[0], [...g3[1]].reverse()], READERS[0], READERS[1]])).toEqual(resolve(READERS));
  });

  it('rejects a numeric comparison on a non-numeric datum, whichever alias reads it', () => {
    expect(resolve([['g', [{ field: 'labs', operator: 'less_than', value: '10331-7', system: 'LOINC', threshold: 1 }]]]).errors.map((e) => e.code)).toEqual(['DATUM_TYPE']);
    expect(resolve([['g', [{ attribute: 'lab.rh_factor', operator: 'greater_than', value: 1 }]]]).errors.map((e) => e.code)).toEqual(['DATUM_TYPE']);
  });

  it('counting a string lab and bucket existence need no numeric value; trend on a string lab does', () => {
    expect(resolve([['g', [{ field: 'labs', operator: 'count_in_window', value: '10331-7', system: 'LOINC', window_days: 30, count_threshold: 1 }]]])).toEqual({ datums: [], errors: [] });
    expect(resolve([['g', [{ field: 'labs', operator: 'exists', value: '' }]]])).toEqual({ datums: [], errors: [] });
    expect(resolve([['g', [{ field: 'labs', operator: 'trend_up', value: '10331-7', system: 'LOINC' }]]]).errors.map((e) => e.code)).toEqual(['DATUM_TYPE']);
  });

  it('conflicting alias declarations are an error when read, identically in either code-map order', () => {
    const rows = [
      { attributeName: 'lab.rh_factor', namespace: 'lab', system: 'LOINC', code: '10331-7', valueType: 'string' as const },
      { attributeName: 'lab.rh_alias', namespace: 'lab', system: 'LOINC', code: '10331-7', valueType: 'number' as const },
    ];
    const read: Reader[] = [['g', [{ attribute: 'lab.rh_factor', operator: 'equals', value: 'negative' }]]];
    const forward = resolve(read, buildCodeMap(rows));
    expect(forward.errors).toEqual([expect.objectContaining({
      code: 'DATUM_TYPE', message: expect.stringContaining('lab.rh_alias (number), lab.rh_factor (string)'),
    })]);
    expect(resolve(read, buildCodeMap([...rows].reverse()))).toEqual(forward);
    // Agreeing aliases are fine.
    expect(resolve(read, buildCodeMap(rows.map((r) => ({ ...r, valueType: 'string' as const })))).errors).toEqual([]);
    // A conflict nobody reads is not an error.
    expect(resolve([['g', [{ attribute: 'lab.hemoglobin', operator: 'less_than', value: 7 }]]], buildCodeMap([...rows, codeMap.get('lab.hemoglobin')!])).errors).toEqual([]);
  });

  it.each([
    [{ attribute: 'patient.trimester', operator: 'less_than', value: 'oops' }],
    [{ attribute: 'patient.trimester', operator: 'in', value: [{}] }],
    [{ attribute: 'patient.trimester', operator: 'in', value: [1, '2'] }],
    [{ attribute: 'patient.trimester', operator: 'equals', value: true }],
    [{ attribute: 'lab.rh_factor', operator: 'equals', value: 1 }],
    [{ attribute: 'allergy.metronidazole', operator: 'equals', value: 'yes' }],
  ])('rejects an operand that does not match its operator and datum type: %j', (c) => {
    expect(resolve([['g', [c]]]).errors.map((e) => e.code)).toEqual(['PAYLOAD']);
  });

  it.each([
    [{ attribute: 'patient.trimester', operator: 'in', value: [1, 3] }],
    [{ attribute: 'patient.trimester', operator: 'less_or_equal', value: 2 }],
    [{ attribute: 'lab.rh_factor', operator: 'not_equals', value: 'positive' }],
    [{ attribute: 'allergy.metronidazole', operator: 'equals', value: true }],
    [{ attribute: 'allergy.metronidazole', operator: 'exists' }],
  ])('accepts a correctly typed operand: %j', (c) => {
    expect(resolve([['g', [c]]]).errors).toEqual([]);
  });

  it('rejects an unmapped lab attribute and an unknown patient attribute', () => {
    expect(resolve([['g', [
      { attribute: 'lab.MCV', operator: 'less_than', value: 80 },
      { attribute: 'patient.parity', operator: 'equals', value: 2 },
    ]]]).errors.map((e) => e.code)).toEqual(['UNMAPPED_ATTRIBUTE', 'UNKNOWN_PATIENT_ATTRIBUTE']);
  });
});

describe('checkTemporal', () => {
  const gateNode = (condition: Record<string, unknown>) => [{ id: 'g', type: 'Gate', properties: { gate_type: 'patient_attribute', default_behavior: 'skip', condition } }];

  it('reports whether the pathway needs an encounter anchor (vitals default to ENCOUNTER under v1)', () => {
    const errors: CompileError[] = [];
    expect(checkTemporal(gateNode({ field: 'vitals', operator: 'greater_than', value: 'systolic_bp', threshold: 140 }), codeMap, {}, errors)).toBe(true);
    expect(checkTemporal(gateNode({ field: 'labs', operator: 'less_than', value: '718-7', system: 'LOINC', threshold: 7 }), codeMap, {}, errors)).toBe(false);
    expect(errors).toEqual([]);
  });

  it('turns an invalid temporal override into a compile error', () => {
    const errors: CompileError[] = [];
    checkTemporal(gateNode({ field: 'labs', operator: 'less_than', value: '718-7', system: 'LOINC', threshold: 7, horizon: 'QUARTER', window_days: 30 }), codeMap, {}, errors);
    expect(errors).toEqual([expect.objectContaining({ code: 'TEMPORAL' })]);
  });
});
