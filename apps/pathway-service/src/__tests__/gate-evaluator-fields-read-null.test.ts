/**
 * Regression: a patient_attribute gate whose condition omits `field`
 * (legal at the graph-store level — pathway JSON isn't type-checked at
 * read time) must not leak `undefined` into `contextFieldsRead`.
 *
 * When it did, the undefined propagated into the dependency map's
 * gateContextFields set, then into GateEvidence.fieldsRead ([String!]!),
 * and GraphQL blew up with:
 *   "Cannot return null for non-nullable field GateEvidence.fieldsRead."
 */

import { evaluateGate } from '../services/resolution/gate-evaluator';
import { GateType } from '../services/resolution/types';
import type { PatientContext } from '../services/confidence/types';

const NOW = Date.parse('2026-06-27T00:00:00Z');

function ctx(overrides: Partial<PatientContext> = {}): PatientContext {
  return {
    patientId: 'pt-test',
    conditionCodes: [],
    medications: [],
    labResults: [],
    allergies: [],
    ...overrides,
  };
}

describe('contextFieldsRead never contains null/undefined', () => {
  it('single-condition gate with a missing field yields no null entries', async () => {
    const result = await evaluateGate(
      {
        gate_type: GateType.PATIENT_ATTRIBUTE,
        title: 'Malformed gate (no field)',
        default_behavior: 'skip',
        // `field` deliberately omitted — mimics under-specified pathway JSON.
        condition: { operator: 'exists', value: '' } as never,
      },
      ctx(),
      new Map(),
      new Map(),
      undefined,
      undefined,
      NOW,
    );

    expect(result.contextFieldsRead).not.toContain(undefined);
    expect(result.contextFieldsRead.every((f) => typeof f === 'string')).toBe(true);
  });

  it('compound gate with one field-less sub-condition yields no null entries', async () => {
    const result = await evaluateGate(
      {
        gate_type: GateType.COMPOUND,
        title: 'Compound with a malformed leg',
        default_behavior: 'skip',
        operator: 'OR',
        conditions: [
          { field: 'conditions', operator: 'includes_code', value: 'D50.9', system: 'ICD-10' },
          { operator: 'exists', value: '' } as never,
        ],
      },
      ctx(),
      new Map(),
      new Map(),
      undefined,
      undefined,
      NOW,
    );

    expect(result.contextFieldsRead).not.toContain(undefined);
    expect(result.contextFieldsRead.every((f) => typeof f === 'string')).toBe(true);
  });
});
