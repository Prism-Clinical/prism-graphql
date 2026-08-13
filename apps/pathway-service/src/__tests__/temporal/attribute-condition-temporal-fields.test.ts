/**
 * Review finding 5 — `AttributeCondition` omitted the temporal fields it has
 * carried in practice since Task 7.
 *
 * The import validator accepts `horizon` and `status` on attribute conditions
 * (`ATTRIBUTE_KEYS`), `adaptAttributeCondition` reads them through
 * `parseConditionOverride`, and the `v1` anchor sweep parses them — but the
 * interface declared neither, so every caller had to write
 * `{ ... } as AttributeCondition`. A cast is exactly what stops the compiler
 * noticing the NEXT field that goes missing, which is how this one survived a
 * whole task.
 *
 * **The reproduction for this one is a typecheck failure, not a test run.**
 * `tsconfig` excludes `src/__tests__` with `diagnostics: false`, so a probe
 * placed here typechecks vacuously and would go green with or without the fix.
 * It was reproduced with a temporary probe module under `src/services` —
 * `error TS2353: 'horizon' does not exist in type 'AttributeCondition'` — which
 * the declaration then cleared.
 *
 * What this file adds is the runtime half: the fields a cast-free literal now
 * carries must actually reach the adapter and the cascade. Every condition
 * below is declared `AttributeCondition` with NO cast — that is the point.
 */

import { AttributeCondition, AttributeCodeMap } from '../../services/resolution/types';
import { adaptAttributeCondition } from '../../services/resolution/temporal/condition-adapter';

const CODE_MAP: AttributeCodeMap = new Map([
  [
    'lab.a1c',
    {
      attributeName: 'lab.a1c',
      namespace: 'lab',
      system: 'LOINC',
      code: '4548-4',
      valueType: 'number' as const,
    },
  ],
  [
    'allergy.penicillin',
    {
      attributeName: 'allergy.penicillin',
      namespace: 'allergy',
      system: 'RXNORM',
      code: '7980',
      valueType: 'boolean' as const,
    },
  ],
]);

describe('the temporal fields declared on AttributeCondition are the ones read', () => {
  it('carries a horizon through to the NODE override — no cast', () => {
    const condition: AttributeCondition = {
      attribute: 'lab.a1c',
      operator: 'greater_than',
      value: 9,
      horizon: 'YEAR',
    };
    expect(adaptAttributeCondition(condition, CODE_MAP)!.override).toEqual({ horizon: 'YEAR' });
  });

  it('carries a status through to the NODE override — no cast', () => {
    const condition: AttributeCondition = {
      attribute: 'allergy.penicillin',
      operator: 'equals',
      value: true,
      status: 'any',
    };
    expect(adaptAttributeCondition(condition, CODE_MAP)!.override).toEqual({ status: 'any' });
  });

  it('carries both together', () => {
    const condition: AttributeCondition = {
      attribute: 'allergy.penicillin',
      operator: 'equals',
      value: true,
      horizon: 'QUARTER',
      status: 'inactive',
    };
    expect(adaptAttributeCondition(condition, CODE_MAP)!.override).toEqual({
      horizon: 'QUARTER',
      status: 'inactive',
    });
  });

  it('leaves the override absent when neither is set', () => {
    const condition: AttributeCondition = {
      attribute: 'lab.a1c',
      operator: 'greater_than',
      value: 9,
    };
    expect(adaptAttributeCondition(condition, CODE_MAP)!.override).toBeUndefined();
  });

  it('keeps them `unknown`, so a malformed value is still a RUNTIME rejection', () => {
    // The reason the fields are typed `unknown` rather than `Horizon`: they
    // arrive off untyped AGE JSON, and a declared type here would assert a
    // guarantee the boundary does not provide. `parseHorizonValue` remains the
    // only thing that decides validity.
    const condition: AttributeCondition = {
      attribute: 'lab.a1c',
      operator: 'greater_than',
      value: 9,
      horizon: 'FORTNIGHT',
    };
    expect(() => adaptAttributeCondition(condition, CODE_MAP)).toThrow(/FORTNIGHT/);
  });

  it('still rejects window_days together with horizon', () => {
    const condition: AttributeCondition = {
      attribute: 'lab.a1c',
      operator: 'greater_than',
      value: 9,
      horizon: 'QUARTER',
    };
    // `window_days` is NOT declared on AttributeCondition and is not being added
    // — only the two fields the validator and adapter actually read are. The
    // conflict rule is still enforced on whatever the untyped JSON carries.
    const withBoth = { ...condition, window_days: 30 } as AttributeCondition;
    expect(() => adaptAttributeCondition(withBoth, CODE_MAP)).toThrow(/not both/);
  });
});
