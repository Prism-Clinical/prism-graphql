import { isAttributeCondition, GateCondition } from '../services/resolution/types';

describe('condition discriminant', () => {
  it('identifies an attribute condition by the attribute key', () => {
    const c: GateCondition = { attribute: 'lab.hemoglobin', operator: 'less_than', value: 7 };
    expect(isAttributeCondition(c)).toBe(true);
  });

  it('identifies a coded condition (no attribute key)', () => {
    const c: GateCondition = { field: 'labs', operator: 'less_than', value: '718-7', threshold: 7 };
    expect(isAttributeCondition(c)).toBe(false);
  });
});
