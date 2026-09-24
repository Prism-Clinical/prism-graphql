import type { AttributeCodeMap } from './types';
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

/**
 * The answer a `patient.*` datum takes, read off the condition that needed it.
 *
 * Every attribute used to be asked as NUMERIC, and the answer path accepted
 * only `numericValue` — so `patient.rh_factor equals "negative"` or
 * `patient.prior_cesarean equals true` pended with a question no answer could
 * clear. The comparand says what the gate will compare against, and the
 * answer is stored where the gate reads it and compared with `===`
 * (`compareScalar`), so its TYPE has to match the comparand's exactly:
 *
 *   - a numeric operator, or ANY numeric comparand → NUMERIC. Including an
 *     all-numeric `in` list: the true value can lie outside the list, and a
 *     selected "2" would never `===` the authored 2.
 *   - a boolean comparand → BOOLEAN.
 *   - string comparand(s) only → SELECT, the comparands as the options.
 *
 * Only for a `patient.*` path on the `kind: 'attribute'` target. A `lab.*` /
 * `allergy.*` with a code-map row is injected as a LAB, and a vital as a
 * vital, and both of those take a number; they stay NUMERIC. So does an
 * UNMAPPED `lab.*`, which falls back to the attribute target but is a
 * vocabulary gap, not a demographic.
 *
 * Known limitation: the options are drawn from the comparands alone, so
 * `equals "negative"` offers one option and "positive" is not answerable.
 * Deliberately no invented "other" sentinel: stored as the attribute's value
 * it would falsely answer "no" to a sibling `equals "positive"` gate. Two
 * gates asking for the same datum pool their options (see the dedup in the
 * traversal engine), which covers the common authored pair.
 */
function attributeAnswerShape(
  condition: GateCondition & { attribute: string },
  target: UnresolvedAsk['target'],
): Pick<UnresolvedAsk, 'answerType' | 'options'> {
  if (target.kind !== 'attribute' || !condition.attribute.startsWith('patient.')) {
    return { answerType: AnswerType.NUMERIC };
  }

  const comparands: unknown[] = Array.isArray(condition.value) ? condition.value : [condition.value];
  const numericOperator = !['equals', 'not_equals', 'in', 'exists'].includes(condition.operator);
  if (numericOperator || comparands.some(v => typeof v === 'number')) {
    return { answerType: AnswerType.NUMERIC };
  }
  if (comparands.length > 0 && comparands.every(v => typeof v === 'boolean')) {
    return { answerType: AnswerType.BOOLEAN };
  }
  if (comparands.length > 0 && comparands.every(v => typeof v === 'string')) {
    return { answerType: AnswerType.SELECT, options: [...new Set(comparands as string[])] };
  }
  // A mixed or empty comparand the import validator should not have let
  // through. NUMERIC is the pre-existing behaviour, not a new guess.
  return { answerType: AnswerType.NUMERIC };
}

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
  /**
   * For a SELECT: the values the answer may take — the condition's own string
   * comparands, so a chosen option is stored as exactly what the gate compares
   * against. Absent otherwise.
   */
  options?: string[];
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
export function askFor(
  condition: GateCondition,
  /**
   * The attribute vocabulary, so an answer lands where the gate will READ it.
   *
   * Every attribute answer used to be written to `patientAttributes`. But
   * `lab.hemoglobin` is a LAB — the gate resolves it through this map to a
   * LOINC code and reads the lab series — so the injected fact went somewhere
   * the gate never looks and the question stayed pending however many times
   * it was answered. Same lookup the evaluator uses, so the two cannot
   * disagree about where a datum lives.
   */
  codeMap?: AttributeCodeMap,
): UnresolvedAsk | null {
  if (isAttributeCondition(condition)) {
    const path = condition.attribute;
    if (!path) return null;

    const namespace = path.slice(0, path.indexOf('.'));
    const entry = codeMap?.get(path);

    const target: UnresolvedAsk['target'] =
      namespace === 'vitals'
        ? { kind: 'vital', path }
        : entry && (namespace === 'lab' || namespace === 'allergy')
          ? { kind: 'lab', code: entry.code, system: entry.system }
          : { kind: 'attribute', path };

    return {
      datumKey: path,
      prompt: `${path} — current value?`,
      ...attributeAnswerShape(condition, target),
      target,
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

/**
 * Two option lists for ONE shared datum, merged in first-seen order.
 *
 * A SELECT datum's options are the comparands of the gates asking for it, so
 * when two gates share the datum the question must offer both gates' values.
 */
export function unionOptions(
  a: readonly string[] | undefined,
  b: readonly string[] | undefined,
): string[] {
  return [...new Set([...(a ?? []), ...(b ?? [])])];
}
