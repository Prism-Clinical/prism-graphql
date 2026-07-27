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

function candidateMatches(fact: NormalizedFact, cond: FactSelectionCondition): boolean {
  if (fact.kind !== fieldToKind(cond.field)) return false;
  if (cond.system && fact.system !== cond.system) return false;
  const klass = operatorClass(cond.operator);
  if (cond.operator === 'exists') return true;
  if (klass === 'membership') {
    return cond.operator === 'includes_code' ? codeMatches(fact.code, cond.value) : fact.code === cond.value;
  }
  // scalar / aggregate: observation with a finite numeric value on the requested code
  return isObservationFact(fact) && fact.code === cond.value && typeof fact.value === 'number' && Number.isFinite(fact.value);
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

// definite-latest: a fact whose earliest possible time is >= every other's latest possible time.
function definiteLatest(facts: NormalizedFact[]): NormalizedFact | null {
  for (const f of facts) {
    const fr = effectiveRange(f);
    if (facts.every((g) => g === f || fr.loMs >= effectiveRange(g).hiMs)) return f;
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
    if (validityDecision === 'DROP_INVALID' || stateMatch === 'NO_MATCH' || temporalMatch === 'NO_MATCH') {
      operatorDecision = 'EXCLUDE';
    } else {
      const anyUnknown = validityDecision === 'UNKNOWN' || stateMatch === 'UNKNOWN' || temporalMatch === 'UNKNOWN';
      operatorDecision = !anyUnknown ? 'INCLUDE' : klass === 'membership' ? 'INCLUDE' : 'INDETERMINATE';
    }
    decisions.push({ fact, validityDecision, stateMatch, temporalMatch, operatorDecision });
  }

  const included = decisions.filter((d) => d.operatorDecision === 'INCLUDE');
  const indeterminate = decisions.filter((d) => d.operatorDecision === 'INDETERMINATE');

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
    if (indeterminate.length > 0) return { status: 'INDETERMINATE', reasons: ['TEMPORAL_UNKNOWN'], decisions };
    if (included.length === 0) return { status: 'NO_MATCH', decisions };
    const winner = definiteLatest(included.map((d) => d.fact));
    if (!winner) return { status: 'INDETERMINATE', reasons: ['AMBIGUOUS_LATEST'], decisions };
    return { status: 'READY', selected: [winner], decisions, ...flags(included) };
  }

  // aggregate
  if (included.length === 0 && indeterminate.length === 0) return { status: 'NO_MATCH', decisions };
  let selected: NormalizedFact[];
  if (condition.operator === 'count_in_window') {
    const seen = new Set<string>();
    selected = included
      .map((d) => d.fact)
      .filter((f) => (seen.has(f.factId) ? false : (seen.add(f.factId), true)));
  } else {
    selected = [...included]
      .sort((a, b) => effectiveRange(a.fact).loMs - effectiveRange(b.fact).loMs)
      .map((d) => d.fact);
  }
  return { status: 'READY', selected, decisions, ...flags(included) };
}
