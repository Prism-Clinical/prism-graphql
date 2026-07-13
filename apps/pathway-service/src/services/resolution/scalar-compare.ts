import { AttributeOperator } from './types';

type Resolved = number | string | boolean | undefined;
type Operand = string | number | boolean | Array<string | number>;

export function compareScalar(
  resolved: Resolved,
  operator: AttributeOperator,
  operand: Operand,
): { satisfied: boolean; reason: string } {
  if (operator === 'exists') {
    const ok = resolved !== undefined;
    return { satisfied: ok, reason: ok ? 'attribute is present' : 'attribute is absent' };
  }
  if (resolved === undefined) {
    return { satisfied: false, reason: 'attribute has no value' };
  }
  if (operator === 'in') {
    const list = Array.isArray(operand) ? operand : [operand as string | number];
    const ok = list.some((x) => x === resolved);
    return { satisfied: ok, reason: `${String(resolved)} ${ok ? 'in' : 'not in'} [${list.join(', ')}]` };
  }
  if (operator === 'equals') {
    const ok = resolved === operand;
    return { satisfied: ok, reason: `${String(resolved)} ${ok ? '==' : '!='} ${String(operand)}` };
  }
  if (operator === 'not_equals') {
    const ok = resolved !== operand;
    return { satisfied: ok, reason: `${String(resolved)} ${ok ? '!=' : '=='} ${String(operand)}` };
  }
  // Numeric comparators
  if (typeof resolved !== 'number' || typeof operand !== 'number') {
    return { satisfied: false, reason: `numeric ${operator} needs numeric operands` };
  }
  const ops: Record<string, (a: number, b: number) => boolean> = {
    greater_than: (a, b) => a > b,
    greater_or_equal: (a, b) => a >= b,
    less_than: (a, b) => a < b,
    less_or_equal: (a, b) => a <= b,
  };
  const cmp = ops[operator];
  const ok = cmp ? cmp(resolved, operand) : false;
  return { satisfied: ok, reason: `${resolved} ${operator} ${operand} → ${ok}` };
}
