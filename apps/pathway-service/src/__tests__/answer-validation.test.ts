/**
 * An answer must fit the gate it answers.
 *
 * `GateAnswerInput` has three optional fields and nothing checked them, so a
 * caller could send none, or all three, or the wrong one: `selectedOption:
 * "true"` to a boolean gate, an option the gate does not offer, a number to a
 * select. The engine then derives a decision value the routing table has no
 * entry for — no branch is selected, and not even `unroutable_decision` is
 * raised, because the gate DID decide. The session just ends up with a fork
 * nobody took.
 */

import { validateAnswerAgainstGate } from '../services/resolution/answer-validation';
import {
  GateProperties, GateType, AnswerType, DefaultBehavior,
} from '../services/resolution/types';

const boolGate: GateProperties = {
  title: 'Symptomatic?',
  gate_type: GateType.QUESTION,
  default_behavior: DefaultBehavior.SKIP,
  answer_type: AnswerType.BOOLEAN,
};

const selectGate: GateProperties = {
  ...boolGate,
  answer_type: AnswerType.SELECT,
  options: ['BV', 'VVC', 'Trichomoniasis'],
};

const numericGate: GateProperties = { ...boolGate, answer_type: AnswerType.NUMERIC };

const llmGate: GateProperties = {
  title: 'Aetiology from the note?',
  gate_type: GateType.LLM_TEXT_ANALYSIS,
  default_behavior: DefaultBehavior.SKIP,
  branches: [
    { name: 'infectious', description: '', is_safe_default: true },
    { name: 'inflammatory', description: '', is_safe_default: false },
  ],
} as GateProperties;

describe('exactly one value', () => {
  it('rejects an answer carrying nothing', () => {
    expect(validateAnswerAgainstGate({}, boolGate)).toMatch(/no value/i);
  });

  /**
   * The evaluator and the router both pick by precedence, so a multi-field
   * answer silently resolves to one of them. Which one is an implementation
   * detail no caller should depend on.
   */
  it('rejects an answer carrying several values', () => {
    const r = validateAnswerAgainstGate(
      { booleanValue: true, selectedOption: 'BV' }, selectGate,
    );
    expect(r).toMatch(/exactly one/i);
  });

  it('accepts a single well-typed value', () => {
    expect(validateAnswerAgainstGate({ booleanValue: true }, boolGate)).toBeNull();
  });

  // `false` is a value, not an absence — the mistake this whole workstream
  // keeps rediscovering.
  it('treats booleanValue false as present', () => {
    // null means valid — `false` is a value, not an absence.
    expect(validateAnswerAgainstGate({ booleanValue: false }, boolGate)).toBeNull();
  });

  it('treats numericValue zero as present', () => {
    expect(validateAnswerAgainstGate({ numericValue: 0 }, numericGate)).toBeNull();
  });
});

describe('the value must match the gate answer_type', () => {
  it('rejects a quoted "true" sent to a boolean gate', () => {
    const r = validateAnswerAgainstGate({ selectedOption: 'true' }, boolGate);
    expect(r).toMatch(/booleanValue/);
  });

  it('rejects a number sent to a select gate', () => {
    expect(validateAnswerAgainstGate({ numericValue: 3 }, selectGate)).toMatch(/selectedOption/);
  });

  it('rejects a boolean sent to a numeric gate', () => {
    expect(validateAnswerAgainstGate({ booleanValue: true }, numericGate)).toMatch(/numericValue/);
  });

  it('rejects a non-finite number', () => {
    expect(validateAnswerAgainstGate({ numericValue: NaN }, numericGate)).toMatch(/finite/);
  });
});

describe('select membership', () => {
  it('accepts an option the gate offers', () => {
    expect(validateAnswerAgainstGate({ selectedOption: 'VVC' }, selectGate)).toBeNull();
  });

  // An unknown option matches no `when`, so no branch is taken and nothing is
  // reported — the failure this check exists to make visible.
  it('rejects an option the gate does not offer', () => {
    const r = validateAnswerAgainstGate({ selectedOption: 'Cervicitis' }, selectGate);
    expect(r).toMatch(/not one of this gate's options/);
    expect(r).toContain('BV');
  });
});

describe('an LLM gate is answered by naming a branch', () => {
  it('accepts a declared branch name', () => {
    expect(validateAnswerAgainstGate({ selectedOption: 'infectious' }, llmGate)).toBeNull();
  });

  it('rejects a name that is not a declared branch', () => {
    expect(validateAnswerAgainstGate({ selectedOption: 'neoplastic' }, llmGate))
      .toMatch(/not one of this gate's branches/);
  });

  // Its vocabulary is branches[].name, not options — reading `options` for an
  // LLM gate finds nothing and checks nothing.
  it('rejects a boolean sent to an LLM gate', () => {
    expect(validateAnswerAgainstGate({ booleanValue: true }, llmGate)).toMatch(/naming a branch/);
  });
});

/**
 * Import validation is what requires an answer_type where one is needed (a
 * gate that routes). Failing here as well would block answering gates that are
 * legitimately untyped.
 */
describe('a gate with no declared answer_type', () => {
  const untyped: GateProperties = {
    title: 'Anything?', gate_type: GateType.QUESTION, default_behavior: DefaultBehavior.SKIP,
  };

  it('accepts any single value', () => {
    expect(validateAnswerAgainstGate({ booleanValue: true }, untyped)).toBeNull();
    expect(validateAnswerAgainstGate({ selectedOption: 'x' }, untyped)).toBeNull();
  });

  it('still requires exactly one', () => {
    expect(validateAnswerAgainstGate({ booleanValue: true, numericValue: 1 }, untyped))
      .toMatch(/exactly one/i);
  });
});

/**
 * The stored vocabulary is not consistently cased.
 *
 * The enum is uppercase, fixtures store 'BOOLEAN', and the IMPORT validator
 * lowercases before comparing — so it accepts a lowercase `answer_type` that
 * an enum-keyed lookup here would not recognise, and a gate this validator
 * cannot read is one it silently waves through.
 */
describe('answer_type casing', () => {
  it.each(['BOOLEAN', 'boolean'])('reads answer_type %s', (answer_type) => {
    const gate = { ...boolGate, answer_type } as unknown as GateProperties;
    expect(validateAnswerAgainstGate({ selectedOption: 'true' }, gate)).toMatch(/booleanValue/);
    expect(validateAnswerAgainstGate({ booleanValue: true }, gate)).toBeNull();
  });

  it.each(['SELECT', 'select'])('checks option membership for answer_type %s', (answer_type) => {
    const gate = { ...selectGate, answer_type } as unknown as GateProperties;
    expect(validateAnswerAgainstGate({ selectedOption: 'nope' }, gate)).toMatch(/not one of/);
  });
});
