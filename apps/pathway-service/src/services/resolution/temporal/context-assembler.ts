import {
  FactStore,
  NormalizedFact,
  ObservationFact,
  StatefulFact,
  TemporalBound,
  TemporalEnd,
  ClinicalState,
} from './fact-model';
import { boundEpochRange } from './interval';
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
 * Reject an interval that ends before it starts, at the boundary.
 *
 * `overlap()` throws a bare `Error` on the same condition (overlap.ts:42) — no
 * error code, and by then it is mid-traversal, one fact at a time, after LLM
 * gates have already run. Caught here it is what it actually is: invalid
 * input. The comparison mirrors overlap's exactly (earliest possible start
 * after latest possible end) so a fact this accepts can never trip that throw.
 */
function assertOrdered(start: TemporalBound, end: TemporalBound, where: string): void {
  if (boundEpochRange(start).loMs > boundEpochRange(end).hiMs) {
    throw new TemporalContextError(
      `${where}: endDate (${end.value}) is before date (${start.value})`,
      'INVALID_RESOLUTION_INPUT',
    );
  }
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
  start: TemporalBound | undefined,
): TemporalEnd {
  if (entry.endDate !== undefined) {
    const bound = parseSyntheticDate(entry.endDate, `${where}.endDate`);
    if (start) assertOrdered(start, bound, where);
    return { kind: 'KNOWN', bound };
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
      interval: { start, end: endFor(entry, state, ctx, where, start) },
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
    // it is asserted current.
    //
    // WHAT THIS BUYS, PRECISELY (corrected round 9 — the previous wording
    // claimed more than it delivers): OPEN(asOf) fixes ADMISSION, not ORDERING.
    // It makes an undated fact overlap any horizon, so it is not dropped. It
    // does NOT make it orderable: `effectiveRange` (select-facts.ts:143) reads
    // `interval.start` only and returns (-Inf, +Inf) when there is none, so an
    // undated fact still has no position in time. A scalar gate over ONE
    // undated fact is READY; over an undated fact PLUS any other candidate it
    // is AMBIGUOUS_LATEST and fails closed.
    //
    // That is deliberate and was re-affirmed in round 9: an undated result
    // genuinely cannot be ordered against a dated one, and consulting
    // `interval.end` would not fix it — (-Inf, asOf] still overlaps a dated
    // point. Failing closed beats legacy's arbitrary first-array-element pick.
    // The v1 delta is disclosed in the plan's compatibility audit, and the
    // authoring UI should require a date on lab input (plan 09).
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
 * Depth cap for the vitals walk. `resolveNumericPath` has no cap because it
 * follows one caller-supplied path; this walks the whole bag, so a cyclic or
 * pathological object needs a bound. Ten levels is far past any real vitals
 * shape — the deepest in use is `custom.<key>`.
 */
const MAX_VITALS_DEPTH = 10;

/**
 * Flatten the vitalSigns bag to every dotted path the evaluator can resolve.
 *
 * This must match `resolveNumericPath` (gate-evaluator.ts:169) exactly, which
 * splits the condition's `value` on '.' and walks arbitrary depth. An earlier
 * version handled only root keys and one `custom.<key>` level, so a gate
 * targeting `custom.nested.deeper` — which resolves today — would find no fact
 * at all once plan 04 routes the evaluator through the kernel, silently
 * turning a working gate into NO_MATCH.
 *
 * Arrays are walked as objects for the same reason: `resolveNumericPath`
 * indexes them by string key, so `readings.0` resolves today.
 */
function flattenVitals(
  bag: Record<string, unknown>,
  prefix = '',
  depth = 0,
  out: Array<{ key: string; value: number }> = [],
): Array<{ key: string; value: number }> {
  if (depth > MAX_VITALS_DEPTH) return out;
  for (const [key, raw] of Object.entries(bag)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof raw === 'number' && Number.isFinite(raw)) {
      out.push({ key: path, value: raw });
    } else if (typeof raw === 'object' && raw !== null) {
      flattenVitals(raw as Record<string, unknown>, path, depth + 1, out);
    }
  }
  return out;
}

function assembleVitals(
  bag: Record<string, unknown> | undefined,
  ctx: EvaluationTemporalContext,
  nextId: (kind: string) => string,
): ObservationFact[] {
  if (!bag) return [];
  // Sorted by path before ids are assigned, because object key order is NOT
  // stable across a session's lifetime: `initial_patient_context` is a JSONB
  // column, and Postgres jsonb reorders keys by (length, bytewise) —
  // '{"z_long_key":1,"a":2}'::jsonb reads back as '{"a":2,"z_long_key":1}'.
  // Assigning ordinals from Object.entries order therefore gave the same
  // semantic bag different factIds at creation and at retraversal, which is
  // exactly the determinism plan 05's decision 5 relies on in place of
  // persisting normalized facts. Coded arrays need no such treatment: JSON
  // arrays preserve order.
  //
  // The bag carries no dates anywhere, so a vital is always asserted current.
  const flattened = flattenVitals(bag).sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return flattened.map(({ key, value }) => ({
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

/**
 * The modes that cannot yet produce a fact store. Called both here and at the
 * mutation boundary, so a caller selecting LIVE is refused up front rather than
 * silently resolving against an empty context.
 */
export function assertAssemblableMode(input: ResolutionInput): void {
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
}

export function assembleContext(
  input: ResolutionInput,
  ctx: EvaluationTemporalContext,
): FactStore {
  assertAssemblableMode(input);
  if (input.mode !== 'SYNTHETIC') {
    // Unreachable — assertAssemblableMode throws for the other two. Present so
    // the narrowing is explicit rather than an assertion.
    throw new TemporalContextError('unsupported resolution mode', 'INVALID_RESOLUTION_INPUT');
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
