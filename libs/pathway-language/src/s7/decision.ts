/**
 * EXPERIMENTAL, NONCLINICAL. S7: one query's `Evidence<Boolean>` projected to `Decision`
 * (evidence-query contract §5.2, "Query decision boundary").
 *
 * For ONE query-bound evaluation: computes the final evidence (§5.1) and projects its status, value
 * and, for Unresolved, its causes with the executor's own projection. Nothing else is read: not
 * candidate or supporting references, provenance or attribution. The evidence result, with its S6
 * trace, is kept unchanged beside the decision.
 *
 * No Need, program expression or graph runs here.
 */
import { detach } from '../compile/compile';
import { projectEvidence } from '../execute/project';
import type { DecisionValue } from '../execute/types';
import { queryEvidence, QueryEvidenceConfigurationError, type QueryEvidenceInput, type QueryEvidenceResult } from '../s6/evidence';

/** Invalid API input. Never a decision or patient uncertainty. */
export class QueryDecisionConfigurationError extends Error {}

/** Exactly the query-evidence input: everything else comes from the bound evaluation. */
export type QueryDecisionInput = QueryEvidenceInput;

export interface QueryDecisionResult {
  readonly experimental: 'nonclinical-query-decision-v0';
  readonly stage: 'S7';
  readonly scope: 'query-decision';
  readonly packageId: string;
  readonly query: string;
  readonly snapshot: string;
  /** The executor's `DecisionValue`. References stay in `queryEvidence.evidence`. */
  readonly decision: DecisionValue;
  /** The query-evidence result the decision was projected from, unchanged (its `trace` included). */
  readonly queryEvidence: QueryEvidenceResult;
  readonly notRun: readonly ['Needs', 'ProgramExecution'];
}

const INPUT_FIELDS = ['package', 'query', 's4'];

export function queryDecision(input: QueryDecisionInput): QueryDecisionResult {
  if (input === null || typeof input !== 'object') throw new QueryDecisionConfigurationError('input must be an object');
  const extra = Object.keys(input).filter((k) => !INPUT_FIELDS.includes(k));
  // In particular evidence, a decision, causes, stage results, snapshots or query settings.
  if (extra.length > 0) throw new QueryDecisionConfigurationError(`unexpected input field(s) ${extra.join(', ')}; the decision comes only from the query-bound evaluation`);
  let e: QueryEvidenceResult;
  try {
    e = queryEvidence({ package: input.package, query: input.query, s4: input.s4 });
  } catch (x) {
    if (x instanceof QueryEvidenceConfigurationError) throw new QueryDecisionConfigurationError(x.message);
    throw x;
  }
  return detach({
    experimental: 'nonclinical-query-decision-v0',
    stage: 'S7',
    scope: 'query-decision',
    packageId: e.packageId,
    query: e.query,
    snapshot: e.snapshot,
    decision: projectEvidence(e.evidence),
    queryEvidence: e,
    notRun: ['Needs', 'ProgramExecution'],
  } as QueryDecisionResult);
}
