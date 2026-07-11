import { compareScalar } from '../services/resolution/scalar-compare';

describe('compareScalar', () => {
  it('less_than on numbers', () => {
    expect(compareScalar(6, 'less_than', 7).satisfied).toBe(true);
    expect(compareScalar(8, 'less_than', 7).satisfied).toBe(false);
  });
  it('greater_or_equal on numbers', () => {
    expect(compareScalar(7, 'greater_or_equal', 7).satisfied).toBe(true);
  });
  it('equals / not_equals on strings', () => {
    expect(compareScalar('negative', 'equals', 'negative').satisfied).toBe(true);
    expect(compareScalar('negative', 'not_equals', 'positive').satisfied).toBe(true);
  });
  it('in checks set membership', () => {
    expect(compareScalar(2, 'in', [1, 3]).satisfied).toBe(false);
    expect(compareScalar(3, 'in', [1, 3]).satisfied).toBe(true);
  });
  it('exists is true for any non-undefined resolved value', () => {
    expect(compareScalar(false, 'exists', true).satisfied).toBe(true);
    expect(compareScalar(undefined, 'exists', true).satisfied).toBe(false);
  });
  it('numeric comparators are unsatisfied when the value is missing', () => {
    expect(compareScalar(undefined, 'less_than', 7).satisfied).toBe(false);
  });
});
