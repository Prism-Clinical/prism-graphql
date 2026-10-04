import type { PatientContext } from '../confidence/types';
import type { AdditionalContextInput } from '../../resolvers/mutations/resolution';
import { normalizeAttributeValues, normalizePatientAttributes } from './patient-attributes';

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
    // Value normalisers (Rh spellings) run over the MERGED bag, so the chart's
    // value, a typed answer and a remembered answer all reach a gate in the
    // one vocabulary it compares against — whichever entry point stored them,
    // and however long ago. Idempotent, so already-normalised input is a no-op.
    patientAttributes: normalizeAttributeValues(deepMerge(
      initialPc.patientAttributes ?? {},
      normalizePatientAttributes(add.patientAttributes) ?? {},
    )) as PatientContext['patientAttributes'],
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
 * A provider's new answer for a lab code REPLACES their earlier one.
 *
 * Both are dated at the same session instant, so kept together they would tie
 * and the gate would be ambiguous again; and occurrence dedup keys on the date,
 * so the correction would otherwise be the one discarded. Only provider
 * answers are replaced — chart values are never touched.
 */
function supersededProviderAnswersRemoved<
  T extends { code: string; system: string; providerAsserted?: boolean },
>(base: T[] | undefined, next: T[] | undefined): T[] | undefined {
  if (!base || !next) return base;
  const replaced = new Set(
    next.filter((l) => l.providerAsserted === true).map((l) => `${l.code}|${l.system}`),
  );
  if (replaced.size === 0) return base;
  return base.filter((l) => !(l.providerAsserted === true && replaced.has(`${l.code}|${l.system}`)));
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
  out.labResults = concatOccurrences(
    supersededProviderAnswersRemoved(base.labResults, next.labResults),
    next.labResults,
  );
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
