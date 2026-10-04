import { AttributeCodeEntry } from './types';

export interface AttributeVocabularyEntry {
  attribute: string;       // 'lab.hemoglobin' | 'patient.trimester'
  namespace: string;       // 'lab' | 'allergy' | 'patient' | 'vitals'
  display: string;         // human label
  valueType: 'number' | 'string' | 'boolean';
  unit?: string;
}

// The single source of truth for the derived patient.* attributes (no code).
// Note: Plan 3's substrate normalizer does NOT import this list (it's generic) —
// this is the canonical authoring set defined fresh here, not a reused import.
export const KNOWN_PATIENT_ATTRIBUTES = [
  { name: 'trimester', display: 'Trimester', valueType: 'number' as const },
  { name: 'rh_factor', display: 'Rh factor', valueType: 'string' as const },
  { name: 'gestational_age_weeks', display: 'Gestational age (weeks)', valueType: 'number' as const, unit: 'weeks' },
  // Provider-answered facts the chart has no reliable field for. Asked as
  // yes/no, and remembered for the patient by the asking gate's `remember_answer`.
  { name: 'on_prenatal_vitamin', display: 'Taking a prenatal vitamin', valueType: 'boolean' as const },
  { name: 'tdap_given_this_pregnancy', display: 'Tdap vaccine given this pregnancy', valueType: 'boolean' as const },
  { name: 'rsv_vaccine_ever_given', display: 'RSV vaccine ever given', valueType: 'boolean' as const },
] as const;

/**
 * The human label for a `patient.*` attribute path, or `undefined` when the
 * path is not one of `KNOWN_PATIENT_ATTRIBUTES`.
 *
 * Read by the pending-datum prompt so a clinician is asked for "Gestational
 * age (weeks)" rather than the machine key `patient.gestational_age_weeks`.
 * Deliberately `patient.*` only: the other namespaces have no label source
 * here (the code map has no display column), and a guessed label on a lab is
 * worse than its key.
 */
export function patientAttributeLabel(path: string): string | undefined {
  if (!path.startsWith('patient.')) return undefined;
  const name = path.slice('patient.'.length);
  return KNOWN_PATIENT_ATTRIBUTES.find((p) => p.name === name)?.display;
}

export function buildAttributeVocabulary(codeMapRows: AttributeCodeEntry[]): AttributeVocabularyEntry[] {
  const fromCodeMap: AttributeVocabularyEntry[] = codeMapRows.map((r) => ({
    attribute: r.attributeName,
    namespace: r.namespace,
    display: r.attributeName,          // code-map has no display column in v1; use the name
    valueType: r.valueType,
  }));
  const fromPatient: AttributeVocabularyEntry[] = KNOWN_PATIENT_ATTRIBUTES.map((p) => ({
    attribute: `patient.${p.name}`,
    namespace: 'patient',
    display: p.display,
    valueType: p.valueType,
    unit: 'unit' in p ? (p as { unit?: string }).unit : undefined,
  }));
  return [...fromCodeMap, ...fromPatient];
}
