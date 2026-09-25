/**
 * `window_from` (anchored trend windows) at IMPORT.
 *
 * The validator reaches the grammar through `parseConditionOverride`, the
 * same call session preflight and evaluation make, so every rejection here is
 * one the runtime would also make — import and runtime cannot disagree.
 */

jest.mock('../resolvers/Query', () => ({
  hydrateSignalDefinition: (row: unknown) => row,
}));

import { validatePathwayJson } from '../services/import/validator';
import { parseConditionOverride } from '../services/resolution/temporal/condition-adapter';
import { TemporalContextError } from '../services/resolution/temporal/evaluation-context';
import { clonePathway } from './fixtures/reference-pathway';
import { PathwayJson } from '../services/import/types';

const ORAL_IRON = {
  event: 'medication_start',
  clinical_role: 'oral-iron-repletion',
  codes: [{ system: 'RXNORM', code: '310325' }],
  label: 'oral iron',
};

const TREND = {
  field: 'labs',
  operator: 'trend_up',
  value: '718-7',
  system: 'LOINC',
  slope_threshold: 0.015,
  min_points: 2,
};

function withCondition(
  condition: Record<string, unknown>,
  medicationRole?: string,
): PathwayJson {
  const pw = clonePathway();
  pw.nodes.push({
    id: 'gate-t',
    type: 'Gate' as any,
    properties: { title: 'T', gate_type: 'patient_attribute', default_behavior: 'skip', condition },
  });
  pw.edges.push({ from: 'step-1-1', to: 'gate-t', type: 'HAS_GATE' as any });
  pw.edges.push({ from: 'gate-t', to: 'step-1-2', type: 'BRANCHES_TO' as any });
  if (medicationRole) {
    pw.nodes.push({
      id: 'med-iron',
      type: 'Medication' as any,
      properties: { name: 'Ferrous sulfate', role: 'first_line', clinical_role: medicationRole },
    });
    pw.edges.push({ from: 'step-1-1', to: 'med-iron', type: 'USES_MEDICATION' as any });
  }
  return pw;
}

describe('window_from at import', () => {
  it('accepts a class selector on a trend condition', () => {
    const result = validatePathwayJson(
      withCondition({ ...TREND, window_from: ORAL_IRON }, 'oral-iron-repletion'),
    );
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
    expect(result.warnings.filter(w => w.includes('window_from'))).toEqual([]);
  });

  it.each(['count_in_window', 'trend_down', 'delta_from_baseline'])(
    'accepts it on %s',
    (operator) => {
      const result = validatePathwayJson(
        withCondition({ ...TREND, operator, window_from: ORAL_IRON }, 'oral-iron-repletion'),
      );
      expect(result.errors).toEqual([]);
    },
  );

  const REJECTED: Array<[string, Record<string, unknown>, string]> = [
    ['window_from AND window_days', { ...TREND, window_from: ORAL_IRON, window_days: 42 }, 'window_from or window_days'],
    ['window_from AND horizon', { ...TREND, window_from: ORAL_IRON, horizon: 'QUARTER' }, 'window_from or horizon'],
    [
      'window_from on a scalar operator',
      { field: 'labs', operator: 'greater_than', value: '718-7', threshold: 11, window_from: ORAL_IRON },
      'window_from applies only to',
    ],
    ['a missing clinical_role', { ...TREND, window_from: { event: 'medication_start' } }, '"clinical_role" must be'],
    [
      'a product in place of a class',
      { ...TREND, window_from: { event: 'medication_start', rxnorm: '310325' } },
      'unknown key "rxnorm"',
    ],
    [
      'an unknown event',
      { ...TREND, window_from: { event: 'encounter_start', clinical_role: 'x' } },
      '"event" must be one of medication_start',
    ],
    ['a non-object selector', { ...TREND, window_from: 'oral-iron-repletion' }, 'must be an object'],
    [
      'an empty codes array',
      { ...TREND, window_from: { ...ORAL_IRON, codes: [] } },
      '"codes" must be a non-empty array',
    ],
    [
      'a code with no system',
      { ...TREND, window_from: { ...ORAL_IRON, codes: [{ code: '310325' }] } },
      'codes[0] must be',
    ],
  ];

  it.each(REJECTED)('rejects %s', (_label, condition, fragment) => {
    const result = validatePathwayJson(withCondition(condition, 'oral-iron-repletion'));
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(expect.stringContaining(fragment));
    expect(result.errors).toContainEqual(expect.stringContaining('Gate "gate-t" condition[0]'));
  });

  it.each(REJECTED)('the runtime parser rejects %s identically', (_label, condition, fragment) => {
    let thrown: unknown;
    try {
      parseConditionOverride(condition, 'condition');
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(TemporalContextError);
    expect((thrown as Error).message).toContain(fragment);
  });

  it('refuses window_from on an attribute condition (an unknown key there)', () => {
    const result = validatePathwayJson(
      withCondition({ attribute: 'lab.hemoglobin', operator: 'greater_than', value: 11, window_from: ORAL_IRON }),
    );
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(expect.stringContaining('unknown key "window_from"'));
  });

  it('warns — does not fail — when no Medication node carries the class', () => {
    const result = validatePathwayJson(withCondition({ ...TREND, window_from: ORAL_IRON }));
    expect(result.errors).toEqual([]);
    expect(result.warnings).toContainEqual(
      expect.stringContaining('no Medication node in this pathway has clinical_role "oral-iron-repletion"'),
    );
  });

  it('warns when the selector has no order codes', () => {
    const { codes: _codes, ...noCodes } = ORAL_IRON;
    const result = validatePathwayJson(
      withCondition({ ...TREND, window_from: noCodes }, 'oral-iron-repletion'),
    );
    expect(result.errors).toEqual([]);
    expect(result.warnings).toContainEqual(expect.stringContaining('no "codes"'));
  });

  it('parses the selector into the NODE tier', () => {
    expect(parseConditionOverride({ ...TREND, window_from: ORAL_IRON }, 'c')).toEqual({
      windowFrom: {
        event: 'medication_start',
        clinicalRole: 'oral-iron-repletion',
        codes: [{ system: 'RXNORM', code: '310325' }],
        label: 'oral iron',
      },
    });
  });
});
