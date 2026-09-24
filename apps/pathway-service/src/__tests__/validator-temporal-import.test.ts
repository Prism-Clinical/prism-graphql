/**
 * Temporal override rules enforced at IMPORT, not only at session preflight.
 *
 * `window_days` XOR `horizon`, the horizon grammar, the status vocabulary and
 * "labs/vitals have no clinical state" were rejected only by
 * `parseConditionOverride` / `resolveEffectivePolicy` when a session started —
 * so a pathway that could never start was stored and published. The validator
 * now calls those same functions; preflight stays as the backstop.
 */

jest.mock('../resolvers/Query', () => ({
  hydrateSignalDefinition: (row: unknown) => row,
}));

import { validatePathwayJson } from '../services/import/validator';
import { sweepableConditions } from '../resolvers/helpers/resolution-context';
import { clonePathway } from './fixtures/reference-pathway';
import { PathwayJson } from '../services/import/types';
import { GateType, DefaultBehavior, AttributeCodeMap } from '../services/resolution/types';
import type { GraphNode } from '../services/confidence/types';

function withCondition(condition: Record<string, unknown>): PathwayJson {
  const pw = clonePathway();
  pw.nodes.push({
    id: 'gate-t',
    type: 'Gate' as any,
    properties: { title: 'T', gate_type: 'patient_attribute', default_behavior: 'skip', condition },
  });
  pw.edges.push({ from: 'step-1-1', to: 'gate-t', type: 'HAS_GATE' as any });
  pw.edges.push({ from: 'gate-t', to: 'step-1-2', type: 'BRANCHES_TO' as any });
  return pw;
}

const LAB = { field: 'labs', operator: 'greater_than', value: '4548-4', threshold: 7 };
const COUNT = { field: 'conditions', operator: 'count_in_window', value: 'N39.0' };

const REJECTED: Array<[string, Record<string, unknown>, string]> = [
  ['window_days AND horizon', { ...COUNT, window_days: 30, horizon: 'QUARTER' }, 'not both'],
  ['an unknown named horizon', { ...LAB, horizon: 'FORTNIGHT' }, 'not a horizon'],
  ['a zero-day custom horizon', { ...LAB, horizon: { days: 0 } }, 'horizon day count'],
  ['a non-integer window_days', { ...COUNT, window_days: 7.5 }, 'horizon day count'],
  ['a window_days beyond the cap', { ...COUNT, window_days: 100_000 }, 'horizon day count'],
  ['a status outside the vocabulary', { ...COUNT, status: 'ACTIVE' }, 'status must be one of'],
  ['a status on a coded labs condition', { ...LAB, status: 'active' }, 'no clinical state'],
  [
    'a status on a coded vitals condition',
    { field: 'vitals', operator: 'greater_than', value: 'systolic_bp', threshold: 140, status: 'any' },
    'no clinical state',
  ],
  [
    'a status on a lab.* attribute condition',
    { attribute: 'lab.a1c', operator: 'greater_than', value: 7, status: 'active' },
    'no clinical state',
  ],
  [
    'a bad horizon on an allergy.* attribute condition',
    { attribute: 'allergy.penicillin', operator: 'equals', value: true, horizon: 'SOMETIME' },
    'not a horizon',
  ],
];

describe('temporal override rules at import', () => {
  it.each(REJECTED)('rejects %s', (_label, condition, fragment) => {
    const result = validatePathwayJson(withCondition(condition));
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(expect.stringContaining(fragment));
    // Named by gate and condition, so the author can find it.
    expect(result.errors).toContainEqual(expect.stringContaining('Gate "gate-t" condition[0]'));
  });

  it('rejects in draft mode too — a malformed override is schema-invalid, not WIP', () => {
    const result = validatePathwayJson(
      withCondition({ ...COUNT, window_days: 30, horizon: 'QUARTER' }),
      { draftMode: true },
    );
    expect(result.valid).toBe(false);
  });

  it.each<[string, Record<string, unknown>]>([
    ['a named horizon on labs', { ...LAB, horizon: 'QUARTER' }],
    ['a custom horizon on labs', { ...LAB, horizon: { days: 45 } }],
    ['window_days alone', { ...COUNT, window_days: 365 }],
    ['a status on conditions', { ...COUNT, status: 'active' }],
    ['status "any" on medications', { field: 'medications', operator: 'includes_code', value: '860975', status: 'any' }],
    ['an ENCOUNTER horizon (the anchor is a session matter)', { ...LAB, horizon: 'ENCOUNTER' }],
    // patient.* is not governed by temporal policy; the runtime ignores the
    // override on both sides, and so does import.
    ['a patient.* attribute', { attribute: 'patient.age', operator: 'greater_than', value: 18 }],
  ])('accepts %s', (_label, condition) => {
    expect(validatePathwayJson(withCondition(condition)).errors).toEqual([]);
  });
});

describe('session preflight remains the backstop for the same condition', () => {
  const codeMap: AttributeCodeMap = new Map();
  const node = (condition: Record<string, unknown>): GraphNode => ({
    id: 'gate-t',
    nodeIdentifier: 'gate-t',
    nodeType: 'Gate',
    properties: {
      title: 'T',
      gate_type: GateType.PATIENT_ATTRIBUTE,
      default_behavior: DefaultBehavior.SKIP,
      condition,
    },
  });

  it('a window_days+horizon conflict rejected at import is also rejected by the v1 sweep', () => {
    const condition = { ...COUNT, window_days: 30, horizon: 'QUARTER' };
    expect(validatePathwayJson(withCondition(condition)).valid).toBe(false);
    expect(() => sweepableConditions([node(condition)], 'v1', codeMap)).toThrow(/not both/);
  });
});
