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
] as const;

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
