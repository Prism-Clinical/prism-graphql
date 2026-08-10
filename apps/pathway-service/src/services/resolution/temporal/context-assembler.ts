import {
  FactStore,
  NormalizedFact,
  ObservationFact,
  StatefulFact,
  TemporalEnd,
  ClinicalState,
} from './fact-model';
import { EvaluationTemporalContext, TemporalContextError } from './evaluation-context';
import { ResolutionInput, SyntheticCodeEntry, SyntheticLabResult } from './trust-mode';
import { parseClinicalState, parseRecordValidity, parseSyntheticDate } from './synthetic-values';

/**
 * Vitals have no terminology code — the gate condition's `value` IS the key
 * within the vitalSigns bag (gate-evaluator.ts:55). They still need a `system`
 * to be facts, so they get a local urn. A gate condition that omits `system`
 * matches any system (select-facts.ts:77), so this never blocks a match.
 */
export const VITALS_SYSTEM = 'urn:prism:vitals';

/**
 * Turn resolution input into the `NormalizedFact[]` the selection kernel reads.
 *
 * Only SYNTHETIC assembles here. LIVE needs Plan 07's snapshot mapper and
 * REPLAY needs persisted normalized facts (Plan 05b); both are *defined* by the
 * `ResolutionInput` union — which is what makes the trust boundary enforceable
 * — and throw until those plans land.
 */

/** One counter per kind, so adding a condition never renumbers the medications. */
function makeIdFactory(): (kind: string) => string {
  const counters: Record<string, number> = {};
  return (kind: string) => {
    const n = counters[kind] ?? 0;
    counters[kind] = n + 1;
    return `${kind}:${n}`;
  };
}

/**
 * The end of a synthetic fact's interval.
 *
 * An undated *active* fact is asserted current at the evaluation clock, which
 * is what preserves today's behavior: modeling it as UNKNOWN instead makes
 * `overlap()` return UNKNOWN even against LIFETIME, and every scalar gate
 * reading it would fail closed.
 *
 * An undated *inactive* fact gets UNKNOWN rather than OPEN. Asserting that a
 * resolved condition is current at the evaluation instant is simply false, and
 * OPEN(asOf) would let it match an arbitrarily narrow horizon.
 */
function endFor(
  entry: SyntheticCodeEntry,
  state: ClinicalState,
  ctx: EvaluationTemporalContext,
  where: string,
): TemporalEnd {
  if (entry.endDate !== undefined) {
    return { kind: 'KNOWN', bound: parseSyntheticDate(entry.endDate, `${where}.endDate`) };
  }
  if (state === 'INACTIVE' || state === 'CONFLICT') return { kind: 'UNKNOWN' };
  return { kind: 'OPEN', assertedCurrentAt: ctx.evaluationAsOf };
}

function assembleStateful(
  entries: readonly SyntheticCodeEntry[],
  kind: StatefulFact['kind'],
  bucket: string,
  ctx: EvaluationTemporalContext,
  nextId: (kind: string) => string,
): StatefulFact[] {
  return entries.map((entry, i) => {
    const where = `${bucket}[${i}]`;

    const state: ClinicalState =
      entry.clinicalState !== undefined
        ? parseClinicalState(entry.clinicalState, where)
        : 'ACTIVE';
    const stateBasis: StatefulFact['stateBasis'] =
      entry.clinicalState !== undefined ? 'SYNTHETIC' : 'MISSING_STATUS_FAIL_OPEN';

    const recordValidity =
      entry.recordValidity !== undefined
        ? parseRecordValidity(entry.recordValidity, where)
        : 'VALID';
    const validityBasis =
      entry.recordValidity !== undefined ? 'SYNTHETIC_ASSERTION' : 'SYNTHETIC_DEFAULT';

    const start =
      entry.date !== undefined ? parseSyntheticDate(entry.date, `${where}.date`) : undefined;

    const fact: StatefulFact = {
      factId: nextId(kind),
      kind,
      code: entry.code,
      system: entry.system,
      interval: { start, end: endFor(entry, state, ctx, where) },
      recordValidity,
      validityBasis,
      provenance: { sourceType: 'SYNTHETIC' },
      clinicalState: state,
      stateAsOf: ctx.evaluationAsOf,
      stateBasis,
    };
    if (entry.display !== undefined) fact.display = entry.display;
    if (entry.sourceId !== undefined) fact.provenance.sourceId = entry.sourceId;
    return fact;
  });
}

/**
 * Validity is asserted the same way for every kind; only the default basis
 * label differs from the stateful path, which also has a clinical state.
 */
function validityOf(
  raw: string | undefined,
  where: string,
): { recordValidity: ObservationFact['recordValidity']; validityBasis: string } {
  return raw !== undefined
    ? { recordValidity: parseRecordValidity(raw, where), validityBasis: 'SYNTHETIC_ASSERTION' }
    : { recordValidity: 'VALID', validityBasis: 'SYNTHETIC_DEFAULT' };
}

function assembleLabs(
  entries: readonly SyntheticLabResult[],
  ctx: EvaluationTemporalContext,
  nextId: (kind: string) => string,
): ObservationFact[] {
  return entries.map((entry, i) => {
    const where = `labResults[${i}]`;

    // Observations carry no clinical state. Ignoring a supplied one would hide
    // an authoring error behind a fact the author did not intend.
    if ((entry as { clinicalState?: unknown }).clinicalState !== undefined) {
      throw new TemporalContextError(
        `${where}: clinicalState is not valid on a lab — observations have no clinical state`,
        'INVALID_RESOLUTION_INPUT',
      );
    }

    // A lab is an instantaneous observation: a dated one is a POINT, with the
    // KNOWN end equal to the start bound, which is the branch overlap() takes
    // for point facts. Modeling it as OPEN(asOf) would keep a two-year-old
    // result overlapping QUARTER forever. Undated, it has no anchor at all, so
    // it is asserted current — otherwise every scalar gate reading it would
    // fail closed under legacy-v0.
    const start =
      entry.date !== undefined ? parseSyntheticDate(entry.date, `${where}.date`) : undefined;
    const end: TemporalEnd = start
      ? { kind: 'KNOWN', bound: start }
      : { kind: 'OPEN', assertedCurrentAt: ctx.evaluationAsOf };

    const fact: ObservationFact = {
      factId: nextId('lab'),
      kind: 'lab',
      code: entry.code,
      system: entry.system,
      interval: { start, end },
      ...validityOf(entry.recordValidity, where),
      provenance: { sourceType: 'SYNTHETIC' },
    };
    if (entry.display !== undefined) fact.display = entry.display;
    if (entry.value !== undefined) fact.value = entry.value;
    if (entry.unit !== undefined) fact.unit = entry.unit;
    if (entry.sourceId !== undefined) fact.provenance.sourceId = entry.sourceId;
    return fact;
  });
}

/**
 * Flatten the vitalSigns bag to exactly the keys the evaluator already
 * resolves: numeric root keys, and `custom.<key>` one level down. A different
 * key would mean the gate silently finds nothing.
 */
function flattenVitals(bag: Record<string, unknown>): Array<{ key: string; value: number }> {
  const out: Array<{ key: string; value: number }> = [];
  for (const [key, raw] of Object.entries(bag)) {
    if (key === 'custom' && typeof raw === 'object' && raw !== null) {
      for (const [ck, cv] of Object.entries(raw as Record<string, unknown>)) {
        if (typeof cv === 'number' && Number.isFinite(cv)) out.push({ key: `custom.${ck}`, value: cv });
      }
      continue;
    }
    if (typeof raw === 'number' && Number.isFinite(raw)) out.push({ key, value: raw });
  }
  return out;
}

function assembleVitals(
  bag: Record<string, unknown> | undefined,
  ctx: EvaluationTemporalContext,
  nextId: (kind: string) => string,
): ObservationFact[] {
  if (!bag) return [];
  // The bag carries no dates anywhere, so a vital is always asserted current.
  return flattenVitals(bag).map(({ key, value }) => ({
    factId: nextId('vital'),
    kind: 'vital',
    code: key,
    system: VITALS_SYSTEM,
    interval: { end: { kind: 'OPEN', assertedCurrentAt: ctx.evaluationAsOf } },
    recordValidity: 'VALID',
    validityBasis: 'SYNTHETIC_DEFAULT',
    provenance: { sourceType: 'SYNTHETIC' },
    value,
  }));
}

export function assembleContext(
  input: ResolutionInput,
  ctx: EvaluationTemporalContext,
): FactStore {
  if (input.mode === 'LIVE') {
    throw new TemporalContextError(
      'LIVE resolution requires the snapshot mapper (plan 07)',
      'INVALID_RESOLUTION_INPUT',
    );
  }
  if (input.mode === 'REPLAY') {
    throw new TemporalContextError(
      'REPLAY resolution requires persisted normalized facts (plan 05b)',
      'INVALID_RESOLUTION_INPUT',
    );
  }

  const pc = input.patientContext;
  const nextId = makeIdFactory();
  const facts: NormalizedFact[] = [];

  facts.push(...assembleStateful(pc.conditionCodes ?? [], 'condition', 'conditionCodes', ctx, nextId));
  facts.push(...assembleStateful(pc.medications ?? [], 'medication_order', 'medications', ctx, nextId));
  facts.push(...assembleStateful(pc.allergies ?? [], 'allergy', 'allergies', ctx, nextId));
  facts.push(...assembleLabs(pc.labResults ?? [], ctx, nextId));
  facts.push(...assembleVitals(pc.vitalSigns, ctx, nextId));

  return facts;
}
