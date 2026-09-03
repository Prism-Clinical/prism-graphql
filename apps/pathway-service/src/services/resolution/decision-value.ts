import { GateAnswer } from './types';
import { BranchWhen, isEqualsWhen } from '../import/branch-when';

/**
 * What a gate DECIDED, as distinct from whether it is SATISFIED.
 *
 * Conflating the two is what broke branch routing. `evaluateQuestion` reports
 * `satisfied: answer.booleanValue === true`, so answering "no" to a
 * multi-branch question was indistinguishable from not answering at all: the
 * `{ equals: false }` branch could never be taken, because routing only ran
 * on the satisfied path. "No" is a decision. It is not the absence of one.
 *
 * Satisfaction still governs a SINGLE-target gate — traversing the one branch
 * is what "the gate opened" means there. It is only when a gate has several
 * branches that satisfaction stops being the right question, because the
 * decision is *which*, not *whether*.
 *
 * Keeping the value separate is also what lets the source vary. A provider's
 * answer, a model's chosen branch and (once implemented) a chart-derived value
 * all reduce to a DecisionValue, and the routing that consumes one never has
 * to know which produced it.
 */
export type DecisionValue =
  | { kind: 'boolean'; value: boolean }
  | { kind: 'numeric'; value: number }
  | { kind: 'select'; value: string };

/**
 * Read the decision out of an answer, or out of the branch an LLM picked.
 *
 * Field precedence is boolean → numeric → select, matching `evaluateQuestion`
 * exactly. The two used to disagree, so a malformed answer carrying several
 * fields could satisfy a gate on one field and route on another.
 *
 * A provider's answer outranks the model's `chosenBranch`: confirming a
 * tentative branch has to be able to override it.
 */
export function decisionValueOf(
  answer: GateAnswer | undefined,
  chosenBranch?: string,
): DecisionValue | null {
  if (answer) {
    if (typeof answer.booleanValue === 'boolean') {
      return { kind: 'boolean', value: answer.booleanValue };
    }
    if (typeof answer.numericValue === 'number' && Number.isFinite(answer.numericValue)) {
      return { kind: 'numeric', value: answer.numericValue };
    }
    if (typeof answer.selectedOption === 'string' && answer.selectedOption !== '') {
      return { kind: 'select', value: answer.selectedOption };
    }
  }
  if (typeof chosenBranch === 'string' && chosenBranch !== '') {
    return { kind: 'select', value: chosenBranch };
  }
  return null;
}

/**
 * Does this decision select the branch carrying `when`?
 *
 * Ranges are half-open `[gte, lt)`, so a value on a boundary belongs to the
 * range that STARTS there — the property that lets adjacent ranges tile the
 * line without a value landing in two of them.
 *
 * The kinds must AGREE. A numeric decision does not select an `equals` branch
 * and a boolean does not select a range: a mismatch means the mapping was
 * authored against a different answer type than the gate now has, and guessing
 * across kinds would route a patient on a coincidence.
 */
export function decisionSelects(when: BranchWhen, decision: DecisionValue): boolean {
  if (isEqualsWhen(when)) {
    if (typeof when.equals === 'boolean') {
      return decision.kind === 'boolean' && decision.value === when.equals;
    }
    return decision.kind === 'select' && decision.value === when.equals;
  }
  if (decision.kind !== 'numeric') return false;
  if (when.gte !== undefined && decision.value < when.gte) return false;
  if (when.lt !== undefined && decision.value >= when.lt) return false;
  return true;
}
