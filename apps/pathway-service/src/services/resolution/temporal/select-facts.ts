import { FactSelectionCondition, operatorClass, fieldToKind, UncertaintyReason } from './contract';
import { NormalizedFact, FactStore, isObservationFact, isStatefulFact } from './fact-model';
import { overlap, ResolvedHorizon, ThreeValued } from './overlap';
import { boundEpochRange } from './interval';

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
 * Candidate rules are per-OPERATOR, not per-operator-class: the three
 * aggregate operators do not share a candidate rule.
 *
 * Each rule mirrors what the current evaluator does, so `legacy-v0` is
 * genuinely behavior-preserving:
 *  - `count_in_window` counts occurrences over ANY fact kind (recurrent UTIs,
 *    repeat ED visits — gate-evaluator.ts walks every code bucket, not just
 *    labs), matches the trailing wildcard, and requires no numeric value.
 *  - `trend_*` / `delta_from_baseline` build a numeric series, so they need an
 *    observation with a finite value; they match the wildcard
 *    (collectLabSeries uses matchesCodePattern).
 *  - `greater_than` / `less_than` read one numeric observation by EXACT code
 *    (getNumericValue uses `===`, never a pattern).
 */
function candidateMatches(fact: NormalizedFact, cond: FactSelectionCondition): boolean {
  if (fact.kind !== fieldToKind(cond.field)) return false;

  // `exists` is bucket existence and nothing else — it ignores both value and
  // system, matching the current evaluator. (Plan 04's adapter rejects a
  // system/value supplied alongside `exists` at the authoring boundary.)
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
    return { result: st === 'UNKNOWN' || st === 'CONFLICT' ? 'UNKNOWN' : 'MATCH', unverified };
  }
  if (st === 'CONFLICT') return { result: 'NO_MATCH', unverified };
  if (st === 'UNKNOWN') return { result: 'UNKNOWN', unverified };
  if (status === 'active') return { result: st === 'ACTIVE' ? 'MATCH' : 'NO_MATCH', unverified };
  return { result: st === 'INACTIVE' ? 'MATCH' : 'NO_MATCH', unverified };
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
  const decisions: FactDecision[] = [];

  for (const fact of store) {
    if (!candidateMatches(fact, condition)) continue;
    const validityDecision: FactDecision['validityDecision'] =
      fact.recordValidity === 'INVALID' ? 'DROP_INVALID' : fact.recordValidity === 'UNKNOWN' ? 'UNKNOWN' : 'ADMIT';
    const { result: stateMatch } = stateMatchFor(fact, policy.status);
    const temporalMatch = overlap(fact.interval, policy.horizon);

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
    decisions.push({ fact, validityDecision, stateMatch, temporalMatch, operatorDecision, uncertainty });
  }

  const included = decisions.filter((d) => d.operatorDecision === 'INCLUDE');
  const indeterminate = decisions.filter((d) => d.operatorDecision === 'INDETERMINATE');
  const uncertainExcluded = decisions.filter(
    (d) => d.operatorDecision === 'EXCLUDE' && d.uncertainty.length > 0,
  );

  const flags = (subset: FactDecision[]) => ({
    temporallyUnverified: subset.some((d) => d.temporalMatch === 'UNKNOWN'),
    stateUnverified: subset.some(
      (d) => d.stateMatch === 'UNKNOWN' || (isStatefulFact(d.fact) && d.fact.stateBasis === 'MISSING_STATUS_FAIL_OPEN'),
    ),
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
