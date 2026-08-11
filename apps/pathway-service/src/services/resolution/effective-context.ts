import type { PatientContext } from '../confidence/types';
import type { AdditionalContextInput } from '../../resolvers/mutations/resolution';
import { normalizePatientAttributes } from './patient-attributes';

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Deep-merge two bags. Nested objects are merged recursively; scalars and
 * arrays are replaced by the newer value.
 *
 * A shallow spread replaced `vitalSigns` wholesale, so recording a heart rate
 * and then a blood pressure kept only the blood pressure.
 */
function deepMerge(
  base: Record<string, unknown>,
  add: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(add)) {
    const prev = out[k];
    out[k] = isPlainObject(prev) && isPlainObject(v) ? deepMerge(prev, v) : v;
  }
  return out;
}

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
    // Deep, not shallow. Additions merge deeply with each other, but this
    // merge — the one every retraversal runs — was still a spread, so
    // updating `custom.pain` mid-session dropped the sibling `custom.mood`
    // that was in the initial context, and updating
    // `narrative.chief_complaint` dropped `narrative.hpi`.
    vitalSigns: deepMerge(initialPc.vitalSigns ?? {}, add.vitalSigns ?? {}),
    freeformData: deepMerge(initialPc.freeformData ?? {}, add.freeformData ?? {}),
    patientAttributes: deepMerge(
      initialPc.patientAttributes ?? {},
      normalizePatientAttributes(add.patientAttributes) ?? {},
    ) as PatientContext['patientAttributes'],
  };
}

/** Occurrence identity — the same key `buildEffectivePatientContext` dedupes on. */
const occurrenceKey = (e: { code: string; system: string; date?: string; sourceId?: string }) =>
  `${e.code}|${e.system}|${e.date ?? ''}|${e.sourceId ?? ''}`;

function concatOccurrences<T extends { code: string; system: string; date?: string; sourceId?: string }>(
  base: T[] | undefined,
  add: T[] | undefined,
): T[] | undefined {
  if (!base) return add;
  if (!add) return base;
  const seen = new Set(base.map(occurrenceKey));
  const out = [...base];
  for (const item of add) {
    const key = occurrenceKey(item);
    if (!seen.has(key)) {
      seen.add(key);
      out.push(item);
    }
  }
  return out;
}

/**
 * Accumulate one `addPatientContext` call onto everything supplied before it.
 *
 * This bag IS the session's memory of mid-session additions: it is persisted
 * on the session and replayed by every retraversal entry point. A shallow
 * spread therefore did not "merge" anything — adding condition A and then
 * condition B stored only B, and A was gone from every later retraversal,
 * silently removing evidence a gate had already counted. Coded arrays now
 * accumulate occurrence-aware (genuine duplicates still collapse) and the
 * free-form bags merge deeply.
 */
export function mergeAdditionalContext(
  prev: Partial<AdditionalContextInput> | undefined,
  next: Partial<AdditionalContextInput>,
): Partial<AdditionalContextInput> {
  const base = prev ?? {};
  const out: Partial<AdditionalContextInput> = { ...base, ...next };

  out.conditionCodes = concatOccurrences(base.conditionCodes, next.conditionCodes);
  out.medications = concatOccurrences(base.medications, next.medications);
  out.labResults = concatOccurrences(base.labResults, next.labResults);
  out.allergies = concatOccurrences(base.allergies, next.allergies);

  for (const key of ['vitalSigns', 'freeformData', 'patientAttributes'] as const) {
    const prevBag = base[key];
    const nextBag = next[key];
    if (isPlainObject(prevBag) && isPlainObject(nextBag)) {
      out[key] = deepMerge(prevBag, nextBag);
    } else if (nextBag === undefined) {
      out[key] = prevBag;
    }
  }

  // Drop keys that were never supplied by either call, so `changedFields`
  // detection downstream keeps seeing absent as absent.
  for (const k of Object.keys(out) as Array<keyof AdditionalContextInput>) {
    if (out[k] === undefined) delete out[k];
  }
  return out;
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
