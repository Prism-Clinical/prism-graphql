import { RequiredInput } from './types';

/**
 * Which slice of added patient context can move a node's confidence.
 *
 * `dependencyMap.scorerInputs` exists to answer that — it is read by
 * `addPatientContext` to decide which action nodes need re-scoring — but
 * nothing ever wrote to it, so a context change that moved a score without
 * touching any gate seeded no recomputation at all.
 *
 * The information was already there. Every scorer implements
 * `declareRequiredInputs`, it is covered by tests, and no production code had
 * ever called it. Wiring that declaration to the map is the whole fix; this
 * module is only the vocabulary bridge between the two, because scorers name
 * inputs semantically (`result_value`) and `addPatientContext` names them by
 * the context key that supplies them (`labs`).
 */

/** The keys `addPatientContext` marks as changed. */
export const CONTEXT_KEYS = [
  'conditions',
  'medications',
  'labs',
  'allergies',
  'vitalSigns',
  'freeformData',
  'patientAttributes',
] as const;

/**
 * Declared input name -> the context key that supplies it.
 *
 * `patient_context` is `custom-rules`' catch-all: a custom rule may read
 * anything, so it depends on everything.
 */
const INPUT_TO_CONTEXT_KEYS: Record<string, readonly string[]> = {
  result_value: ['labs'],
  result_date: ['labs'],
  lab_results: ['labs'],
  condition_codes: ['conditions'],
  code_match: ['conditions'],
  medications: ['medications'],
  interactions_checked: ['medications'],
  allergies_checked: ['allergies'],
  patient_context: CONTEXT_KEYS,
};

/** Whether this module knows what supplies a given declared input. */
export function isMappedInput(name: string): boolean {
  return name in INPUT_TO_CONTEXT_KEYS;
}

/**
 * The context keys a node's scorers read.
 *
 * `graph_node` and `linked_node` inputs are skipped: they come from the
 * pathway, which added patient context cannot change.
 *
 * An input this module does not recognise resolves to EVERY key. Failing
 * conservative means a new scorer input causes needless re-scoring rather than
 * a silently missed one — the failure that made this map useless in the first
 * place. `scorer-context-inputs.test.ts` asserts nothing is currently unmapped,
 * so the fallback stays a safety net rather than the normal path.
 */
export function contextKeysForInputs(inputs: readonly RequiredInput[]): Set<string> {
  const keys = new Set<string>();
  for (const input of inputs) {
    if (input.source !== 'patient_context') continue;
    const mapped = INPUT_TO_CONTEXT_KEYS[input.name];
    if (!mapped) {
      for (const k of CONTEXT_KEYS) keys.add(k);
      continue;
    }
    for (const k of mapped) keys.add(k);
  }
  return keys;
}
