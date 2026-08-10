import {
  FactStore,
  NormalizedFact,
  StatefulFact,
  TemporalEnd,
  ClinicalState,
} from './fact-model';
import { EvaluationTemporalContext, TemporalContextError } from './evaluation-context';
import { ResolutionInput, SyntheticCodeEntry } from './trust-mode';
import { parseClinicalState, parseRecordValidity, parseSyntheticDate } from './synthetic-values';

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

  return facts;
}
