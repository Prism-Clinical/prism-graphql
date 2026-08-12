import {
  adaptCodedCondition,
  toFactSelectionCondition,
  nodeOverrideFor,
  attributeNamespaceToField,
} from '../../services/resolution/temporal/condition-adapter';
import { TemporalContextError } from '../../services/resolution/temporal/evaluation-context';
import { CodedCondition } from '../../services/resolution/types';

const base: CodedCondition = { field: 'labs', operator: 'greater_than', value: '718-7' };

describe('toFactSelectionCondition', () => {
  it('carries field, operator, value and system through unchanged', () => {
    expect(toFactSelectionCondition({ ...base, system: 'http://loinc.org' })).toEqual({
      field: 'labs',
      operator: 'greater_than',
      value: '718-7',
      system: 'http://loinc.org',
    });
  });

  it('omits system entirely when the author did not set one', () => {
    const out = toFactSelectionCondition(base);
    expect(out).toEqual({ field: 'labs', operator: 'greater_than', value: '718-7' });
    expect('system' in out).toBe(false);
  });

  it('rejects an operator the kernel does not model', () => {
    // Runtime throw, not a type error: tsconfig excludes __tests__.
    expect(() => toFactSelectionCondition({ ...base, operator: 'sounds_like' as never })).toThrow(
      TemporalContextError,
    );
  });

  it('rejects a field with no fact kind', () => {
    expect(() => toFactSelectionCondition({ ...base, field: 'horoscopes' as never })).toThrow(
      TemporalContextError,
    );
  });

  it('normalizes exists to bucket semantics, dropping value and system (round 6)', () => {
    // `exists` ignores code and system in the kernel (select-facts.ts:75) and in
    // today's evaluator. The import validator REQUIRES `value` on every coded
    // condition (validator.ts:289), so rejecting a non-empty value here would
    // reject what the authoring contract demands. Both spellings must adapt to
    // the same selection.
    const withCode = toFactSelectionCondition({
      field: 'labs',
      operator: 'exists',
      value: '718-7',
      system: 'http://loinc.org',
    });
    const withEmpty = toFactSelectionCondition({ field: 'labs', operator: 'exists', value: '' });
    expect(withCode).toEqual(withEmpty);
    expect(withCode.value).toBe('');
    expect('system' in withCode).toBe(false);
  });
});

describe('nodeOverrideFor — the NODE tier', () => {
  it('is undefined when the author set neither axis', () => {
    expect(nodeOverrideFor(base)).toBeUndefined();
  });

  it('carries the two axes independently', () => {
    expect(nodeOverrideFor({ ...base, horizon: 'QUARTER' })).toEqual({ horizon: 'QUARTER' });
    expect(nodeOverrideFor({ ...base, field: 'conditions', status: 'inactive' })).toEqual({
      status: 'inactive',
    });
    expect(nodeOverrideFor({ ...base, field: 'conditions', horizon: 'YEAR', status: 'any' })).toEqual(
      { horizon: 'YEAR', status: 'any' },
    );
  });

  it('rejects a malformed horizon rather than passing it through', () => {
    expect(() => nodeOverrideFor({ ...base, horizon: 'FORTNIGHT' as never })).toThrow(
      TemporalContextError,
    );
  });

  it('rejects a malformed status rather than passing it through', () => {
    expect(() =>
      nodeOverrideFor({ ...base, field: 'conditions', status: 'lingering' as never }),
    ).toThrow(TemporalContextError);
  });
});

describe('window_days (D2)', () => {
  it('is translated into a NODE-level custom horizon, never dropped', () => {
    expect(nodeOverrideFor({ ...base, operator: 'count_in_window', window_days: 90 })).toEqual({
      horizon: { days: 90 },
    });
  });

  it('REJECTS a condition supplying both window_days and horizon (design §419)', () => {
    expect(() =>
      nodeOverrideFor({ ...base, operator: 'count_in_window', window_days: 90, horizon: 'QUARTER' }),
    ).toThrow(/window_days.*horizon|horizon.*window_days/i);
  });

  it('rejects a window_days that is not a finite positive integer (§13)', () => {
    for (const bad of [0, -5, 1.5, Number.NaN]) {
      expect(() => nodeOverrideFor({ ...base, window_days: bad })).toThrow(TemporalContextError);
    }
  });
});

describe('a coded vitals condition may not carry a system (D9, R11-1)', () => {
  // Legacy's `getNumericValue` honours `system` on its labs branch and ignores
  // it entirely on its vitals branch; the uniform kernel applies it to both, so
  // the same condition is satisfiable under `legacy-v0` and unsatisfiable under
  // `v1`. `assembleVitals` stamps every vital with `urn:prism:vitals`, which no
  // real terminology system equals — so ANY author-supplied system makes the
  // gate permanently unsatisfiable. Rejected where the author can fix it.
  const vitals: CodedCondition = { field: 'vitals', operator: 'greater_than', value: 'systolic_bp' };

  it('rejects it, naming what the assembler stamps and what to do', () => {
    expect(() => toFactSelectionCondition({ ...vitals, system: 'LOINC' })).toThrow(
      TemporalContextError,
    );
    expect(() => toFactSelectionCondition({ ...vitals, system: 'LOINC' })).toThrow(
      /vitals.*system/is,
    );
  });

  it('rejects the assembler urn itself — this is not "spell it right"', () => {
    // Passing `urn:prism:vitals` would in fact select, which makes it the most
    // dangerous spelling: it teaches an author that a vitals `system` is
    // meaningful and couples their pathway to the SYNTHETIC assembler (R11-6).
    expect(() => toFactSelectionCondition({ ...vitals, system: 'urn:prism:vitals' })).toThrow(
      TemporalContextError,
    );
  });

  it('fires for exists too, which drops system rather than selecting on it', () => {
    // `exists` returns early with system dropped, so the unsatisfiability
    // argument does NOT apply to it — but the rule is FIELD-specific, not
    // operator-specific. Silently discarding what the author wrote is the
    // round-6 `exists` failure mode D9 cites, and an operator-qualified rule
    // would force the import validator to re-derive the kernel's operator
    // classification: two validators, two chances to disagree (decision #7).
    expect(() =>
      toFactSelectionCondition({ field: 'vitals', operator: 'exists', value: '', system: 'LOINC' }),
    ).toThrow(TemporalContextError);
  });

  it('rejects through adaptCodedCondition, which is what the sweep calls', () => {
    // The `v1` anchor sweep runs `adaptCodedCondition`, so preflight rejects
    // exactly what evaluation would (locked decision #7).
    expect(() => adaptCodedCondition({ ...vitals, system: 'LOINC' }, 'gate g-bp / condition 0'))
      .toThrow(/g-bp/);
  });

  it('leaves a vitals condition with no system alone', () => {
    expect(toFactSelectionCondition(vitals)).toEqual({
      field: 'vitals',
      operator: 'greater_than',
      value: 'systolic_bp',
    });
  });

  it('is field-specific: system stays valid on every other coded field', () => {
    for (const field of ['labs', 'conditions', 'medications', 'allergies'] as const) {
      expect(
        toFactSelectionCondition({ field, operator: 'includes_code', value: 'X', system: 'LOINC' })
          .system,
      ).toBe('LOINC');
    }
  });
});

describe('adaptCodedCondition — the shape both adapters return (P1-20)', () => {
  it('pairs the selection with the NODE override', () => {
    expect(adaptCodedCondition({ ...base, horizon: 'QUARTER' })).toEqual({
      selection: { field: 'labs', operator: 'greater_than', value: '718-7' },
      override: { horizon: 'QUARTER' },
    });
  });

  it('omits override entirely when the author set neither axis', () => {
    const out = adaptCodedCondition(base);
    expect(out.selection).toEqual({ field: 'labs', operator: 'greater_than', value: '718-7' });
    expect('override' in out).toBe(false);
  });
});

describe('attributeNamespaceToField — one mapping, two consumers (P1-8)', () => {
  it('maps the three clinical namespaces to their gate fields', () => {
    expect(attributeNamespaceToField('lab')).toBe('labs');
    expect(attributeNamespaceToField('vitals')).toBe('vitals');
    expect(attributeNamespaceToField('allergy')).toBe('allergies');
  });

  it('returns null for patient demographics', () => {
    expect(attributeNamespaceToField('patient')).toBeNull();
  });

  it('returns null for an unknown namespace rather than throwing', () => {
    // The sweep must not reject a session over a namespace the evaluator will
    // simply fail to resolve.
    expect(attributeNamespaceToField('astrology')).toBeNull();
  });
});
