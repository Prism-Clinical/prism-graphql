import { FactSelectionCondition, operatorClass, fieldToKind, UncertaintyReason } from './contract';
import { NormalizedFact, FactStore, isObservationFact, isStatefulFact } from './fact-model';
import { overlap, ResolvedHorizon, ThreeValued } from './overlap';
import { boundEpochRange, instantEpoch } from './interval';

export interface EffectivePolicy {
  horizon: ResolvedHorizon;
  status?: 'active' | 'inactive' | 'any';
}
export interface FactDecision {
  fact: NormalizedFact;
  validityDecision: 'ADMIT' | 'DROP_INVALID' | 'UNKNOWN';
  stateMatch: 'MATCH' | 'NO_MATCH' | 'UNKNOWN' | 'NOT_APPLICABLE';
  temporalMatch: ThreeValued;
  operatorDecision: 'INCLUDE' | 'EXCLUDE' | 'INDETERMINATE';
  /**
   * Why this fact was uncertain, retained for evidence even when the
   * operator policy resolved that uncertainty into a definite EXCLUDE
   * (aggregate fail-closed). Empty when the fact was decided definitely.
   */
  uncertainty: UncertaintyReason[];
  /**
   * The clinical state was not established: an UNKNOWN/CONFLICT state, or a
   * status inferred by failing open on a missing FHIR status.
   *
   * Tracked separately from `uncertainty` because `status: any` bypasses state
   * filtering: under `any` the doubt is real evidence but must NOT reach the
   * operator policy, or the aggregate fail-closed rule would exclude exactly
   * the facts the author asked to admit.
   */
  stateUnverified: boolean;
}
export type SelectionOutcome =
  | {
      status: 'READY';
      selected: NormalizedFact[];
      decisions: FactDecision[];
      temporallyUnverified: boolean;
      stateUnverified: boolean;
      validityUnverified: boolean;
    }
  | { status: 'NO_MATCH'; decisions: FactDecision[] }
  | { status: 'INDETERMINATE'; reasons: UncertaintyReason[]; decisions: FactDecision[] };

function codeMatches(factCode: string, pattern: string): boolean {
  if (pattern.endsWith('.*')) return factCode.startsWith(pattern.slice(0, -2));
  return factCode === pattern;
}

function hasFiniteValue(fact: NormalizedFact): boolean {
  return isObservationFact(fact) && typeof fact.value === 'number' && Number.isFinite(fact.value);
}

/**
 * Two independent axes decide whether a fact reaches an operator, and they are
 * cut differently:
 *
 *  - **Candidate rules are per-OPERATOR**, not per-operator-class — the three
 *    aggregate operators do not share one (below).
 *  - **The temporal predicate is per-CLASS** (D8), and there are two of them:
 *      * `membership` and `scalar` → `overlap(fact.interval, horizon)`: "was
 *        this fact true at some point inside the window". A durational fact
 *        counts wherever it was live, and an undated fact — every vital, since
 *        `PatientContext.vitalSigns` carries no dates anywhere — is admitted
 *        via `OPEN(evaluationAsOf)` rather than vanishing.
 *      * `aggregate` → `startsWithin(fact.interval, horizon)`: "did this fact
 *        BEGIN inside the window". `count_in_window` counts recurrence, and
 *        under `overlap` a still-active condition is `OPEN(evaluationAsOf)`, so
 *        it matched every horizon and `window_days` was inert on conditions /
 *        medications / allergies — the operator's own documented use case.
 *    Never collapse these back into one: applying start-bound selection to the
 *    scalar class would make every undated vitals gate select nothing and fail
 *    closed, and applying overlap to aggregates is the bug D8 fixed.
 *
 * Each CANDIDATE rule mirrors what the current evaluator does. **That makes the
 * CANDIDATE SET match, and nothing more — it does NOT make `v1`
 * behavior-preserving, and the original wording here claimed it did (corrected
 * in plan 04 Task 10).** Candidate parity is one of four axes; the other three
 * all differ by design, and every difference is disclosed in the design doc's
 * Compatibility section:
 *  - **record validity** filters facts that match today,
 *  - **ordering** takes the definite latest rather than the first array element,
 *    and refuses to order at all when it cannot (D7),
 *  - **vitals bucketing** produces facts where `getCodeEntries('vitals')`
 *    returned `[]`, so vitals membership becomes satisfiable while a vitals
 *    `count_in_window` becomes permanently zero (D8).
 *
 * What `legacy-v0` preservation actually rests on is the **version seam**: it
 * runs `evaluateConditionLegacy`, today's untouched code, and never reaches this
 * module at all. The proof is that every pre-existing test passes with
 * unmodified assertions, not that these candidate rules line up.
 *
 * The candidate rules themselves:
 *  - `count_in_window` counts occurrences over ANY fact kind (recurrent UTIs,
 *    repeat ED visits — gate-evaluator.ts walks every code bucket, not just
 *    labs), matches the trailing wildcard, and requires no numeric value.
 *  - `trend_*` / `delta_from_baseline` build a numeric series, so they need an
 *    observation with a finite value; they match the wildcard
 *    (collectLabSeries uses matchesCodePattern). **They deliberately do NOT
 *    mirror collectLabSeries's third requirement, a parseable date
 *    (gate-evaluator.ts:145-147):** an undated observation is admitted as a
 *    candidate here and then fails the series-ordering check below, rather than
 *    being dropped silently. That is D7 — admitted but not orderable — and it is
 *    why one undated result makes the whole series AMBIGUOUS_SERIES_ORDER
 *    instead of quietly shrinking it. Disclosed as a `v1` delta, not a slip.
 *  - `greater_than` / `less_than` read one numeric observation by EXACT code
 *    (getNumericValue uses `===`, never a pattern).
 */
function candidateMatches(fact: NormalizedFact, cond: FactSelectionCondition): boolean {
  if (fact.kind !== fieldToKind(cond.field)) return false;

  // `exists` is bucket existence and nothing else — it ignores both value and
  // system, matching the current evaluator.
  //
  // Plan 04's adapter NORMALIZES to this rather than rejecting it: it drops
  // `value` and `system` for `exists`, so `value: ''` and `value: '718-7'`
  // produce an identical selection. A runtime rejection was specified once and
  // reverted — the import validator REQUIRES `value` on every coded condition
  // (`validator.ts:289`), so an author following the authoring contract writes
  // exactly what the rejection would refuse. Rejecting an `exists` that carries
  // a code belongs at the AUTHORING boundary, which is plan 06's canonicalizer,
  // and it can warn and migrate rather than throw mid-traversal.
  if (cond.operator === 'exists') return true;

  if (cond.system && fact.system !== cond.system) return false;

  switch (cond.operator) {
    case 'includes_code':
      return codeMatches(fact.code, cond.value);
    case 'equals':
      return fact.code === cond.value;
    case 'count_in_window':
      return codeMatches(fact.code, cond.value);
    case 'trend_up':
    case 'trend_down':
    case 'delta_from_baseline':
      return codeMatches(fact.code, cond.value) && hasFiniteValue(fact);
    case 'greater_than':
    case 'less_than':
      return fact.code === cond.value && hasFiniteValue(fact);
    default:
      return false;
  }
}

function uncertaintyReasons(
  validityDecision: FactDecision['validityDecision'],
  stateMatch: FactDecision['stateMatch'],
  temporalMatch: ThreeValued,
): UncertaintyReason[] {
  const reasons: UncertaintyReason[] = [];
  if (temporalMatch === 'UNKNOWN') reasons.push('TEMPORAL_UNKNOWN');
  if (stateMatch === 'UNKNOWN') reasons.push('STATE_UNKNOWN');
  if (validityDecision === 'UNKNOWN') reasons.push('VALIDITY_UNKNOWN');
  return reasons;
}

function dedupe(reasons: UncertaintyReason[]): UncertaintyReason[] {
  return [...new Set(reasons)];
}

function stateMatchFor(
  fact: NormalizedFact,
  status: EffectivePolicy['status'],
): { result: FactDecision['stateMatch']; unverified: boolean } {
  if (!isStatefulFact(fact)) return { result: 'NOT_APPLICABLE', unverified: false };
  const st = fact.clinicalState;
  const unverified = fact.stateBasis === 'MISSING_STATUS_FAIL_OPEN';
  if (status === undefined || status === 'any') {
    // RFC §3: `any` bypasses state filtering ENTIRELY — it admits every state,
    // including UNKNOWN and CONFLICT. Returning UNKNOWN here instead would feed
    // the bypassed doubt into the operator policy, and the aggregate
    // fail-closed rule would then drop the very facts `any` exists to admit.
    // The doubt is preserved as evidence via `unverified`.
    return { result: 'MATCH', unverified: unverified || st === 'UNKNOWN' || st === 'CONFLICT' };
  }
  if (st === 'CONFLICT') return { result: 'NO_MATCH', unverified };
  if (st === 'UNKNOWN') return { result: 'UNKNOWN', unverified: true };
  if (status === 'active') return { result: st === 'ACTIVE' ? 'MATCH' : 'NO_MATCH', unverified };
  return { result: st === 'INACTIVE' ? 'MATCH' : 'NO_MATCH', unverified };
}

/**
 * The AGGREGATE class's temporal predicate: OCCURRENCE, not overlap (D8).
 *
 * A fact is in-window iff its `interval.start` falls inside the horizon. This
 * is a faithful translation of legacy's `isWithinWindow`, which reads the ENTRY
 * DATE and nothing else (`gate-evaluator.ts:112-125`):
 *  - **Bounded horizon** ⇒ the start must be inside it, and a fact with no
 *    start is EXCLUDED — `isWithinWindow(undefined, N, now) === false`.
 *  - **LIFETIME (`lowerBound === null`)** ⇒ an undated fact is INCLUDED,
 *    mirroring legacy's `windowDays === undefined` branch, which returns `true`
 *    without ever looking at the date. The upper bound still applies to a fact
 *    that HAS a start, so a future occurrence is excluded either way.
 *
 * **A bound is a RANGE, not an instant** — `precision` may be year, month or
 * day. We require the WHOLE range inside the horizon, which is the same
 * containment test `overlap` already applies to a point fact
 * (`overlap.ts:20-25`); an onset whose precision cannot resolve which side of a
 * boundary it falls on is UNKNOWN, and the aggregate class then fails closed on
 * it with `TEMPORAL_UNKNOWN` recorded. Reusing that rule is what keeps this
 * change confined to its intended blast radius: for a DATED observation — a lab
 * modelled as a POINT (`start === end`) — the two predicates are the identical
 * formula, so every dated-lab aggregate answers exactly as it did before D8.
 * Only stateful facts with open/durational ends and undated facts move.
 *
 * The alternative, keying on the range's lower edge alone, would match legacy's
 * `Date.parse('2026-07-01')` byte-for-byte but would silently pick one side of
 * an imprecise bound instead of admitting the imprecision — the coin-flip this
 * kernel exists to remove.
 */
function startsWithin(interval: NormalizedFact['interval'], horizon: ResolvedHorizon): ThreeValued {
  const Hlo = horizon.lowerBound === null ? -Infinity : instantEpoch(horizon.lowerBound);
  const Hhi = instantEpoch(horizon.upperBound);

  if (!interval.start) return horizon.lowerBound === null ? 'MATCH' : 'NO_MATCH';

  const { loMs, hiMs } = boundEpochRange(interval.start);
  // Carried explicitly: `overlap` rejects an inverted interval (overlap.ts:42)
  // and a start-only predicate would never notice one. The assembler already
  // refuses these with a coded error, so this is the kernel's second line of
  // defence against a hand-built store, not the first.
  if (interval.end.kind === 'KNOWN' && loMs > boundEpochRange(interval.end.bound).hiMs) {
    throw new Error('inverted interval: start after known end');
  }
  if (loMs >= Hlo && hiMs <= Hhi) return 'MATCH';
  if (hiMs < Hlo || loMs > Hhi) return 'NO_MATCH';
  return 'UNKNOWN';
}

function effectiveRange(fact: NormalizedFact): { loMs: number; hiMs: number } {
  if (fact.interval.start) return boundEpochRange(fact.interval.start);
  return { loMs: -Infinity, hiMs: Infinity };
}

/**
 * Definite-latest: a fact whose earliest possible time is STRICTLY after
 * every other candidate's latest possible time.
 *
 * The comparison must be strict. With `>=`, two facts at the same exact
 * instant each satisfy the predicate against the other, so the first array
 * element won — reintroducing the input-order dependence this kernel exists
 * to remove. Equal instants are a genuine ambiguity and resolve to
 * AMBIGUOUS_LATEST; a clinically-justified tie-breaker (ObservationFact
 * carries `issuedAt` for amended/corrected results) is deliberately not
 * invented here.
 */
function definiteLatest(facts: NormalizedFact[]): NormalizedFact | null {
  for (const f of facts) {
    const fr = effectiveRange(f);
    if (facts.every((g) => g === f || fr.loMs > effectiveRange(g).hiMs)) return f;
  }
  return null;
}

export function selectFacts(
  condition: FactSelectionCondition,
  store: FactStore,
  policy: EffectivePolicy,
): SelectionOutcome {
  const klass = operatorClass(condition.operator);
  // Per-CLASS temporal predicate (D8). Locked decision #3 gave each class its
  // own uncertainty policy; until D8 all three shared `overlap` by default,
  // which asks "was this fact true at some point inside the window" — the right
  // question for membership and workable for scalar, but wrong for aggregate.
  const temporalPredicate = klass === 'aggregate' ? startsWithin : overlap;
  const decisions: FactDecision[] = [];

  for (const fact of store) {
    if (!candidateMatches(fact, condition)) continue;
    const validityDecision: FactDecision['validityDecision'] =
      fact.recordValidity === 'INVALID' ? 'DROP_INVALID' : fact.recordValidity === 'UNKNOWN' ? 'UNKNOWN' : 'ADMIT';
    const { result: stateMatch, unverified: stateUnverified } = stateMatchFor(fact, policy.status);
    const temporalMatch = temporalPredicate(fact.interval, policy.horizon);

    let operatorDecision: FactDecision['operatorDecision'];
    let uncertainty: UncertaintyReason[] = [];
    if (validityDecision === 'DROP_INVALID' || stateMatch === 'NO_MATCH' || temporalMatch === 'NO_MATCH') {
      // Definitely out — any residual uncertainty on other axes is moot.
      operatorDecision = 'EXCLUDE';
    } else {
      uncertainty = uncertaintyReasons(validityDecision, stateMatch, temporalMatch);
      if (uncertainty.length === 0) {
        operatorDecision = 'INCLUDE';
      } else if (klass === 'membership') {
        operatorDecision = 'INCLUDE'; // fail-open: "may have had X"
      } else if (klass === 'scalar') {
        operatorDecision = 'INDETERMINATE'; // one uncertain value poisons the comparison
      } else {
        // Aggregate: fail-CLOSED per design §13 (scalar + aggregate exclude on
        // UNKNOWN). The fact does not count, but `uncertainty` is retained so
        // evidence can show the count is a lower bound.
        operatorDecision = 'EXCLUDE';
      }
    }
    decisions.push({
      fact, validityDecision, stateMatch, temporalMatch, operatorDecision, uncertainty, stateUnverified,
    });
  }

  const included = decisions.filter((d) => d.operatorDecision === 'INCLUDE');
  const indeterminate = decisions.filter((d) => d.operatorDecision === 'INDETERMINATE');
  const uncertainExcluded = decisions.filter(
    (d) => d.operatorDecision === 'EXCLUDE' && d.uncertainty.length > 0,
  );

  const flags = (subset: FactDecision[]) => ({
    temporallyUnverified: subset.some((d) => d.temporalMatch === 'UNKNOWN'),
    stateUnverified: subset.some((d) => d.stateUnverified),
    validityUnverified: subset.some((d) => d.validityDecision === 'UNKNOWN'),
  });

  if (klass === 'membership') {
    if (included.length === 0) return { status: 'NO_MATCH', decisions };
    return { status: 'READY', selected: included.map((d) => d.fact), decisions, ...flags(included) };
  }

  if (klass === 'scalar') {
    if (indeterminate.length > 0) {
      return {
        status: 'INDETERMINATE',
        reasons: dedupe(indeterminate.flatMap((d) => d.uncertainty)),
        decisions,
      };
    }
    if (included.length === 0) return { status: 'NO_MATCH', decisions };
    const winner = definiteLatest(included.map((d) => d.fact));
    if (!winner) return { status: 'INDETERMINATE', reasons: ['AMBIGUOUS_LATEST'], decisions };
    return { status: 'READY', selected: [winner], decisions, ...flags(included) };
  }

  // ─── aggregate ──────────────────────────────────────────────────────
  // NO_MATCH means "nothing matched the candidate rule at all". Candidates
  // that matched but did not survive (invalid, out of window, uncertain) are
  // a legitimate answer of zero, reported as READY with an empty selection
  // plus the flags explaining the shortfall.
  if (decisions.length === 0) return { status: 'NO_MATCH', decisions };

  // Aggregate flags cover the uncertain-excluded facts too, so a caller can
  // see the count may understate reality.
  const aggregateFlags = flags([...included, ...uncertainExcluded]);

  if (condition.operator === 'count_in_window') {
    const seen = new Set<string>();
    const selected = included
      .map((d) => d.fact)
      .filter((f) => (seen.has(f.factId) ? false : (seen.add(f.factId), true)));
    return { status: 'READY', selected, decisions, ...aggregateFlags };
  }

  // trend_* / delta_from_baseline need a series whose order is PROVEN, not
  // merely sorted: sorting by lower bound alone leaves facts with equal or
  // overlapping ranges (two month-precision results in the same month) in
  // input order, which can invert baseline vs current in delta_from_baseline.
  const sorted = [...included].sort((a, b) => {
    const ar = effectiveRange(a.fact);
    const br = effectiveRange(b.fact);
    return ar.loMs - br.loMs || ar.hiMs - br.hiMs;
  });
  for (let i = 1; i < sorted.length; i++) {
    const prev = effectiveRange(sorted[i - 1].fact);
    const next = effectiveRange(sorted[i].fact);
    if (!(prev.hiMs < next.loMs)) {
      return { status: 'INDETERMINATE', reasons: ['AMBIGUOUS_SERIES_ORDER'], decisions };
    }
  }
  return { status: 'READY', selected: sorted.map((d) => d.fact), decisions, ...aggregateFlags };
}
