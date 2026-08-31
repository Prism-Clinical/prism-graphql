import { AnswerType, GateCondition, isAttributeCondition } from './types';
import { isTemporalOperator, operatorClass } from './temporal/contract';

/**
 * What to ask a provider for, when a gate could not evaluate its condition.
 *
 * A gate escalates only when it could not DECIDE — `indeterminate` (candidate
 * facts exist but cannot be ordered) or `dataUnavailable` (a scalar comparison
 * had no usable value). This module answers the next question: what, exactly,
 * do we ask for, and where does the answer go?
 *
 * It returns `null` for the two classes there is no honest question for. That
 * restraint is the point — asking about a condition that already answered, or
 * one whose answer cannot be stored as a fact, is worse than staying quiet.
 */

/** What to ask for, when a condition could not be evaluated. */
export interface UnresolvedAsk {
  /**
   * Stable identity of the DATUM, not of the gate. Two gates comparing the
   * same haemoglobin against different thresholds share a key, so the provider
   * is asked once and one injected fact resolves both.
   */
  datumKey: string;
  prompt: string;
  answerType: AnswerType;
  /** Where an answer gets injected as a fact. */
  target:
    | { kind: 'lab'; code: string; system: string }
    | { kind: 'vital'; path: string }
    | { kind: 'attribute'; path: string };
}

/**
 * Derive the ask for a condition, or `null` when this is not a condition we
 * can honestly ask about.
 *
 * `null` for:
 *
 *   - **membership** (`includes_code`, `exists`) — `selectFacts` fails OPEN for
 *     this class, so it never reaches either signal, and correctly: no code on
 *     a problem list is real evidence of absence. The gate ANSWERED.
 *   - **aggregate** (`count_in_window`, `trend_*`) — these need a SERIES, not a
 *     value. "The count is 3" is a derived quantity, not an observation;
 *     injecting it would put a fabricated fact in a patient's record.
 *   - anything whose operator the kernel does not recognise, because a guess
 *     here becomes a clinician-facing question.
 */
export function askFor(condition: GateCondition): UnresolvedAsk | null {
  if (isAttributeCondition(condition)) {
    const path = condition.attribute;
    if (!path) return null;
    return {
      datumKey: path,
      prompt: `${path} — current value?`,
      // The attribute vocabulary declares a valueType per attribute, but the
      // condition alone does not carry it. NUMERIC is the honest default here:
      // only scalar-comparable attributes reach `indeterminate` at all, since
      // membership never does.
      answerType: AnswerType.NUMERIC,
      target: { kind: 'attribute', path },
    };
  }

  const { field, operator, value } = condition;
  if (!operator || !value) return null;

  // Classified by the SAME function the kernel uses, so this cannot drift from
  // what actually produces the signals it responds to.
  if (!isTemporalOperator(operator)) return null;
  if (operatorClass(operator) !== 'scalar') return null;

  if (field === 'vitals') {
    return {
      datumKey: `vitals.${value}`,
      prompt: `${value} — current value?`,
      answerType: AnswerType.NUMERIC,
      target: { kind: 'vital', path: value },
    };
  }

  if (field === 'labs') {
    const system = condition.system ?? 'LOINC';
    // The authored display when there is one — a clinician reads "Haemoglobin"
    // faster than "718-7" — but the KEY is always code+system, so a pathway
    // that labels the same lab differently in two gates still asks once.
    const label = condition.display ?? value;
    return {
      datumKey: `${system}:${value}`,
      prompt: `${label} (${system} ${value}) — most recent value?`,
      answerType: AnswerType.NUMERIC,
      target: { kind: 'lab', code: value, system },
    };
  }

  // A scalar operator on conditions / medications / allergies is not something
  // the fact model can take a value for.
  return null;
}
