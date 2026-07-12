import { VALID_CODED_OPERATORS, VALID_ATTRIBUTE_OPERATORS } from '../services/resolution/types';
import { VALID_ATTRIBUTE_NAMESPACES } from '../services/resolution/attribute-registry';

describe('runtime operator/namespace constants', () => {
  it('coded operators match the union members', () => {
    expect([...VALID_CODED_OPERATORS].sort()).toEqual(
      ['count_in_window','delta_from_baseline','equals','exists','greater_than','includes_code','less_than','trend_down','trend_up'].sort(),
    );
  });
  it('attribute operators match the union members', () => {
    expect([...VALID_ATTRIBUTE_OPERATORS].sort()).toEqual(
      ['equals','exists','greater_or_equal','greater_than','in','less_or_equal','less_than','not_equals'].sort(),
    );
  });
  it('attribute namespaces are the 4 registry namespaces', () => {
    expect([...VALID_ATTRIBUTE_NAMESPACES].sort()).toEqual(['allergy','lab','patient','vitals']);
  });
});
