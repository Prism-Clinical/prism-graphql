/**
 * A gate's decision value is what it DECIDED, not whether it is satisfied.
 *
 * The distinction is the whole point: `false` is a decision, and treating it
 * as "undecided" is what made `{ equals: false }` branches unreachable.
 */

import { decisionValueOf, decisionSelects } from '../services/resolution/decision-value';
import { GateAnswer } from '../services/resolution/types';

const answer = (a: Partial<GateAnswer>) => a as GateAnswer;

describe('decisionValueOf', () => {
  it('reads false as a decision, not as an absence', () => {
    expect(decisionValueOf(answer({ booleanValue: false }))).toEqual({
      kind: 'boolean',
      value: false,
    });
  });

  it('reads true, numbers and selections', () => {
    expect(decisionValueOf(answer({ booleanValue: true }))).toEqual({ kind: 'boolean', value: true });
    expect(decisionValueOf(answer({ numericValue: 0 }))).toEqual({ kind: 'numeric', value: 0 });
    expect(decisionValueOf(answer({ selectedOption: 'BV' }))).toEqual({ kind: 'select', value: 'BV' });
  });

  // Zero is a haemoglobin value, not a missing one.
  it('reads numeric zero rather than discarding it as falsy', () => {
    expect(decisionValueOf(answer({ numericValue: 0 }))).not.toBeNull();
  });

  it('has no decision without an answer', () => {
    expect(decisionValueOf(undefined)).toBeNull();
    expect(decisionValueOf(answer({}))).toBeNull();
  });

  it('takes an LLM chosen branch when there is no answer', () => {
    expect(decisionValueOf(undefined, 'VVC')).toEqual({ kind: 'select', value: 'VVC' });
  });

  // Confirming a tentative branch has to be able to override the model.
  it("prefers the provider's answer to the model's branch", () => {
    expect(decisionValueOf(answer({ selectedOption: 'BV' }), 'VVC')).toEqual({
      kind: 'select',
      value: 'BV',
    });
  });

  // The two used to disagree, so a malformed multi-field answer could satisfy
  // a gate on one field and route on another.
  it('uses the same field precedence as evaluateQuestion: boolean, numeric, select', () => {
    expect(decisionValueOf(answer({ booleanValue: false, numericValue: 9, selectedOption: 'BV' })))
      .toEqual({ kind: 'boolean', value: false });
    expect(decisionValueOf(answer({ numericValue: 9, selectedOption: 'BV' })))
      .toEqual({ kind: 'numeric', value: 9 });
  });

  it('refuses NaN, which would compare false against every range', () => {
    expect(decisionValueOf(answer({ numericValue: NaN }))).toBeNull();
  });
});

describe('decisionSelects', () => {
  it('matches booleans by value, false included', () => {
    expect(decisionSelects({ equals: false }, { kind: 'boolean', value: false })).toBe(true);
    expect(decisionSelects({ equals: false }, { kind: 'boolean', value: true })).toBe(false);
  });

  it('matches a selected option', () => {
    expect(decisionSelects({ equals: 'BV' }, { kind: 'select', value: 'BV' })).toBe(true);
    expect(decisionSelects({ equals: 'BV' }, { kind: 'select', value: 'VVC' })).toBe(false);
  });

  it('treats ranges as half-open, so a boundary belongs to the range it starts', () => {
    expect(decisionSelects({ gte: 7, lt: 11 }, { kind: 'numeric', value: 7 })).toBe(true);
    expect(decisionSelects({ gte: 7, lt: 11 }, { kind: 'numeric', value: 11 })).toBe(false);
    expect(decisionSelects({ lt: 7 }, { kind: 'numeric', value: 6.9 })).toBe(true);
    expect(decisionSelects({ gte: 11 }, { kind: 'numeric', value: 1e6 })).toBe(true);
  });

  // A mapping authored against a different answer type than the gate now has.
  // Guessing across kinds would route a patient on a coincidence.
  it('refuses to match across kinds', () => {
    expect(decisionSelects({ equals: 'true' }, { kind: 'boolean', value: true })).toBe(false);
    expect(decisionSelects({ equals: true }, { kind: 'select', value: 'true' })).toBe(false);
    expect(decisionSelects({ gte: 7 }, { kind: 'select', value: '9' })).toBe(false);
  });
});
