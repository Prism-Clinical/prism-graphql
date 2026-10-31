/**
 * EXPERIMENTAL, NONCLINICAL. Per-record S5 classification (evidence-query contract §3.3).
 *
 * Classifies ONE possibility of a query-bound S4 result from the values `evaluateCriteria`
 * computes for it; it accepts no criterion values, so every ownership check of §3.5 still applies.
 * It never combines possibilities, selects, resolves history or decides materiality.
 */
import { detach } from '../compile/compile';
import { CONTEXT_CAUSES } from '../s3/scope';
import { evaluateCriteria } from './criteria';
import type { ClassificationResult, CriteriaInput, CriterionValue, RecordClass } from './types';

/**
 * INTERNAL. Contract §3.3 for one pair of criterion values. Any Unknown → Unclassified with the
 * causes of every Unknown criterion; True/True is a broken disjointness obligation (an engine
 * invariant, never patient conflict). Only True/False, False/True, False/False and
 * Unknown/Unknown are reachable through the I1 compiler (both criteria read c.assertion and must
 * be disjoint); the other rows are exercised on this function alone.
 */
export function classify(establishes: CriterionValue, refutes: CriterionValue): RecordClass {
  if (establishes.value === 'Unknown' || refutes.value === 'Unknown') {
    const causes = new Set([establishes, refutes].flatMap((v) => (v.value === 'Unknown' ? v.findings.map((f) => f.cause) : [])));
    return { class: 'Unclassified', causes: CONTEXT_CAUSES.filter((c): c is 'Missing' | 'Invalid' => causes.has(c as never)) };
  }
  if (establishes.value === 'True' && refutes.value === 'True') {
    throw new Error('invariant: establishes and refutes both True; the compiled disjointness obligation is violated');
  }
  if (establishes.value === 'True') return { class: 'Supporting' };
  if (refutes.value === 'True') return { class: 'Refuting' };
  return { class: 'NonInformative' };
}

const TAGS = { experimental: 'nonclinical-s5-classification-v0', scope: 'one-possibility-classification' } as const;

export function classifyRecord(input: CriteriaInput): ClassificationResult {
  const r = evaluateCriteria(input);
  if (r.outcome !== 'Evaluated') return detach({ ...r, ...TAGS });
  return detach({ ...r, ...TAGS, classification: classify(r.establishes.result, r.refutes.result) });
}
