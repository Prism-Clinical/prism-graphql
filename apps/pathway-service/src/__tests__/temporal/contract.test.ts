import { operatorClass, fieldToKind, isTemporalOperator } from '../../services/resolution/temporal/contract';

test('operatorClass: equals is membership, not scalar', () => {
  expect(operatorClass('equals')).toBe('membership');
  expect(operatorClass('includes_code')).toBe('membership');
  expect(operatorClass('exists')).toBe('membership');
  expect(operatorClass('greater_than')).toBe('scalar');
  expect(operatorClass('less_than')).toBe('scalar');
  expect(operatorClass('count_in_window')).toBe('aggregate');
  expect(operatorClass('trend_up')).toBe('aggregate');
});

test('unknown operators are rejected, not silently classified', () => {
  expect(isTemporalOperator('frobnicate')).toBe(false);
  expect(() => operatorClass('frobnicate' as never)).toThrow(/unknown temporal operator/i);
});

test('fieldToKind maps every gate field, vitals included', () => {
  expect(fieldToKind('conditions')).toBe('condition');
  expect(fieldToKind('medications')).toBe('medication_order');
  expect(fieldToKind('allergies')).toBe('allergy');
  expect(fieldToKind('labs')).toBe('lab');
  expect(fieldToKind('vitals')).toBe('vital');
  expect(() => fieldToKind('nonsense' as never)).toThrow(/unknown gate field/i);
});
