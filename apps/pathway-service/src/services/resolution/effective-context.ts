import type { PatientContext } from '../confidence/types';
import type { AdditionalContextInput } from '../../resolvers/mutations/resolution';
import { normalizePatientAttributes } from './patient-attributes';

/**
 * Reconstruct the effective PatientContext for a resolution session:
 * initial snapshot merged with accumulated additional context. Mirrors the
 * merge semantics that addPatientContext has always used, extracted so every
 * retraversal entry point reconstructs context identically.
 */
export function buildEffectivePatientContext(
  initialPc: PatientContext,
  additions: Partial<AdditionalContextInput> | undefined,
): PatientContext {
  const add = additions ?? {};

  // Deduplicate by code+system+date+source when merging.
  //
  // The key used to be code+system alone, which discarded recurrence: the same
  // diagnosis noted on two different dates collapsed to one entry before the
  // fact assembler ever saw it, so count_in_window counted 1 no matter how many
  // events occurred. Date and source id are part of what makes an occurrence
  // distinct.
  //
  // Undated entries still collapse — `date ?? ''` gives them a common key —
  // which is what preserves today's behavior for the common case where no
  // caller supplies dates at all.
  const dedup = <T extends { code: string; system: string; date?: string; sourceId?: string }>(
    base: T[],
    added: T[],
  ): T[] => {
    const keyOf = (e: T) => `${e.code}|${e.system}|${e.date ?? ''}|${e.sourceId ?? ''}`;
    const seen = new Set(base.map(keyOf));
    const result = [...base];
    for (const item of added) {
      const key = keyOf(item);
      if (!seen.has(key)) {
        seen.add(key);
        result.push(item);
      }
    }
    return result;
  };

  return {
    patientId: initialPc.patientId,
    conditionCodes: dedup(initialPc.conditionCodes, add.conditionCodes ?? []),
    medications: dedup(initialPc.medications, add.medications ?? []),
    labResults: dedup(initialPc.labResults, add.labResults ?? []),
    allergies: dedup(initialPc.allergies, add.allergies ?? []),
    vitalSigns: {
      ...(initialPc.vitalSigns ?? {}),
      ...(add.vitalSigns ?? {}),
    },
    freeformData: {
      ...(initialPc.freeformData ?? {}),
      ...(add.freeformData ?? {}),
    },
    patientAttributes: {
      ...(initialPc.patientAttributes ?? {}),
      ...(normalizePatientAttributes(add.patientAttributes) ?? {}),
    },
  };
}

const CODED_FIELD_TO_KEY: Record<string, keyof AdditionalContextInput> = {
  conditions: 'conditionCodes',
  medications: 'medications',
  labs: 'labResults',
  allergies: 'allergies',
  vitals: 'vitalSigns',
};

const ATTRIBUTE_NAMESPACE_TO_KEY: Record<string, keyof AdditionalContextInput> = {
  patient: 'patientAttributes',
  lab: 'labResults',
  vitals: 'vitalSigns',
  allergy: 'allergies',
};

/**
 * The AdditionalContextInput key whose presence means "the data this gate
 * dependency reads may have changed". Coded gate deps are bucket names
 * ('labs'); attribute gate deps are dotted paths ('lab.hemoglobin') keyed by
 * namespace. Unknown deps map to undefined (never marked affected).
 */
export function dependencyContextKey(field: string): keyof AdditionalContextInput | undefined {
  const coded = CODED_FIELD_TO_KEY[field];
  if (coded) return coded;
  const dot = field.indexOf('.');
  if (dot > 0) return ATTRIBUTE_NAMESPACE_TO_KEY[field.slice(0, dot)];
  return undefined;
}
