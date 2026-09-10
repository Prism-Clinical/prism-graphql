import { GateAnswer, GateProperties, GateType } from './types';

/**
 * Check an answer against the schema of the gate it answers.
 *
 * Nothing checked this. `GateAnswerInput` has three optional fields, so a
 * caller could send none of them, or all three, or the wrong one for the gate:
 * `selectedOption: "true"` to a boolean gate, an option the gate does not
 * offer, a number to a select. The engine then derives a decision value the
 * routing table has no entry for, no branch is selected, and — because the
 * gate DID produce a decision — not even `unroutable_decision` is raised. The
 * session simply ends up with a fork nobody took.
 *
 * Rejecting at the boundary is right rather than tolerating it downstream: an
 * answer that does not fit its gate is a caller mistake, and guessing which
 * field was meant is how a patient ends up on a treatment arm nobody chose.
 *
 * Returns a human-readable reason, or null when the answer is well-formed.
 */
export function validateAnswerAgainstGate(
  answer: Pick<GateAnswer, 'booleanValue' | 'numericValue' | 'selectedOption'>,
  gate: GateProperties,
): string | null {
  const present: string[] = [];
  if (answer.booleanValue !== undefined && answer.booleanValue !== null) present.push('booleanValue');
  if (answer.numericValue !== undefined && answer.numericValue !== null) present.push('numericValue');
  if (answer.selectedOption !== undefined && answer.selectedOption !== null) present.push('selectedOption');

  if (present.length === 0) {
    return 'Answer carries no value — supply exactly one of booleanValue, numericValue or selectedOption';
  }
  if (present.length > 1) {
    // The evaluator and the router both pick by precedence, so a multi-field
    // answer resolves to ONE of them silently. Which one is an implementation
    // detail no caller should be relying on.
    return `Answer carries ${present.join(' and ')} — supply exactly one`;
  }

  // An LLM gate's answer is a provider CONFIRMING or overriding the model's
  // branch, so its vocabulary is `branches[].name`, not `options`.
  if (String(gate.gate_type).toLowerCase() === GateType.LLM_TEXT_ANALYSIS) {
    if (present[0] !== 'selectedOption') {
      return `This gate is answered by naming a branch; got ${present[0]}`;
    }
    const names = (gate.branches ?? []).map(b => b.name);
    if (names.length > 0 && !names.includes(answer.selectedOption as string)) {
      return `"${answer.selectedOption}" is not one of this gate's branches: ${names.join(', ')}`;
    }
    return null;
  }

  const expected: Record<string, string> = {
    boolean: 'booleanValue',
    numeric: 'numericValue',
    select: 'selectedOption',
  };

  // Case-INSENSITIVE, because the stored vocabulary is not consistent: the
  // enum is uppercase, fixtures store 'BOOLEAN', and the import validator
  // lowercases before comparing — so it happily accepts a lowercase
  // `answer_type` that an enum-keyed lookup here would not recognise. A gate
  // this validator cannot read is a gate it silently waves through, which is
  // worse than one it rejects.
  const declared = gate.answer_type ? String(gate.answer_type).toLowerCase() : '';

  // A gate with no declared answer_type cannot say what it expects. Accepting
  // the single value given is the honest reading: import validation is what
  // requires an answer_type where one is needed (a routing gate), and failing
  // here too would block answering gates that are legitimately untyped.
  const want = expected[declared];
  if (!want) return null;

  if (present[0] !== want) {
    return `This gate expects ${want} (answer_type ${gate.answer_type}); got ${present[0]}`;
  }

  if (declared === 'select') {
    const options = (gate.options ?? []).map(String);
    if (options.length > 0 && !options.includes(answer.selectedOption as string)) {
      return `"${answer.selectedOption}" is not one of this gate's options: ${options.join(', ')}`;
    }
  }

  if (declared === 'numeric' && !Number.isFinite(answer.numericValue)) {
    return 'numericValue must be a finite number';
  }

  return null;
}
