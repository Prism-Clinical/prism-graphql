/**
 * EXPERIMENTAL, NONCLINICAL. The final `Evidence<Boolean>` of one query (evidence-query contract
 * §5.1, "Query evidence boundary").
 *
 * For ONE query-bound evaluation: runs step C (which runs steps A and B) and assembles the result
 * the policy computed. Every field has one owner:
 * - status and value: step C's status (step B's, unchanged);
 * - Known `supportingEvidenceIds`: step A's S (true) or R (false), definitely selected revisions only;
 * - Known `provenance`: the acquisition provenance S1 retained for those revisions, this evaluation's own S1;
 * - Unresolved `causes`: step C's cause set, unchanged (its attribution stays in the trace);
 * - Unresolved `candidateEvidenceIds`: §5.1 membership over the S4 keys, independent of materiality.
 * Nothing is repaired: an inconsistent intermediate result is an invariant failure, never a default.
 *
 * No Needs, predicate projection or program execution run here.
 */
import { selectionEvaluation } from '../bound';
import { detach } from '../compile/compile';
import { canonicalJson } from '../s1/payload';
import type { JsonValue, NodeRef } from '../s1/types';
import { compareNodes } from './base';
import { causeAttribution, CauseAttributionConfigurationError, type Cause, type CauseAttributionInput, type CauseAttributionResult } from './causes';

/** Invalid API input. Never an evidence result or patient uncertainty. */
export class QueryEvidenceConfigurationError extends Error {}

/** Exactly the step A–C input: everything else comes from the bound evaluation. */
export type QueryEvidenceInput = CauseAttributionInput;

/** The acquisition provenance S1 retained for one supporting revision: distinct values, §5.3 order. */
export interface SupportingProvenance {
  readonly ref: NodeRef;
  readonly occurrences: readonly (JsonValue | null)[];
}

/**
 * `Evidence<Boolean>` (contract §5.1; Stage A §4.1). References are structured revision or variant
 * identities (`NodeRef`, digest only for a variant of a conflicted revision), `NodeRef` order.
 */
export type QueryEvidence =
  | { readonly status: 'Known'; readonly value: boolean; readonly supportingEvidenceIds: readonly NodeRef[]; readonly provenance: readonly SupportingProvenance[] }
  | { readonly status: 'Unresolved'; readonly causes: readonly Cause[]; readonly candidateEvidenceIds: readonly NodeRef[] };

export interface QueryEvidenceResult {
  readonly experimental: 'nonclinical-query-evidence-v0';
  readonly stage: 'S6';
  readonly scope: 'query-evidence';
  readonly packageId: string;
  readonly query: string;
  readonly snapshot: string;
  readonly evidence: QueryEvidence;
  /** The S6 trace: step C, with step B, step A and the cause attribution inside it, unchanged. */
  readonly trace: CauseAttributionResult;
  readonly notRun: readonly ['Needs', 'PredicateProjection', 'ProgramExecution'];
}

const INPUT_FIELDS = ['package', 'query', 's4'];
/** §5.1: keys seen in S2–S4 as selected, unresolved or inadmissible. */
const SEEN = new Set(['Selected', 'Unresolved', 'Inadmissible']);

export function queryEvidence(input: QueryEvidenceInput): QueryEvidenceResult {
  if (input === null || typeof input !== 'object') throw new QueryEvidenceConfigurationError('input must be an object');
  const extra = Object.keys(input).filter((k) => !INPUT_FIELDS.includes(k));
  // In particular a status, causes, attribution, evidence IDs, stage results, snapshots or query settings.
  if (extra.length > 0) throw new QueryEvidenceConfigurationError(`unexpected input field(s) ${extra.join(', ')}; the evidence comes only from the query-bound evaluation`);
  let c: CauseAttributionResult;
  try {
    c = causeAttribution({ package: input.package, query: input.query, s4: input.s4 });
  } catch (e) {
    if (e instanceof CauseAttributionConfigurationError) throw new QueryEvidenceConfigurationError(e.message);
    throw e;
  }
  const a = c.stepB.stepA;
  let evidence: QueryEvidence;
  if (c.status.status === 'Known') {
    const value = c.status.value;
    const ids = value ? a.supporting : a.refuting;
    // Rules 2–3: a Known status has exactly one nonempty side. Anything else is an engine defect.
    if (ids.length === 0 || (value ? a.refuting : a.supporting).length > 0) throw new Error(`invariant: Known(${value}) without exactly one nonempty side`);
    const s1 = selectionEvaluation(input.s4)!.s1;
    const provenance = ids.map((ref): SupportingProvenance => {
      const r = s1.keys.find((k) => k.key.source === ref.revision.source && k.key.localId === ref.revision.localId)?.revisions.find((x) => x.ref.revision === ref.revision.revision);
      const variant = r?.variants.find((v) => (ref.digest ? v.digest === ref.digest : r.variants.length === 1));
      if (!variant) throw new Error('invariant: a supporting revision is a variant of this evaluation’s S1 result');
      // Distinct values only: identical duplicate occurrences add no provenance (S1 already orders them, §5.3).
      const seen = new Set<string>();
      const occurrences: (JsonValue | null)[] = [];
      for (const o of variant.occurrences) {
        const bytes = canonicalJson(o.provenance as JsonValue);
        if (!seen.has(bytes)) occurrences.push(o.provenance);
        seen.add(bytes);
      }
      return { ref, occurrences };
    });
    evidence = { status: 'Known', value, supportingEvidenceIds: ids, provenance };
  } else {
    // Step C's cause set, unchanged; an Unresolved result always has at least one cause upstream.
    if (c.causes.length === 0) throw new Error('invariant: an Unresolved result has at least one cause');
    const candidates: NodeRef[] = [];
    for (const k of input.s4.keys) {
      if (!SEEN.has(k.status)) continue;
      for (const p of k.possibilities) if (p.kind === 'node' && (p.candidacy === 'InDomain' || p.candidacy === 'Unresolved')) candidates.push(p.node);
    }
    candidates.sort(compareNodes);
    evidence = { status: 'Unresolved', causes: c.causes, candidateEvidenceIds: candidates.filter((n, i) => i === 0 || compareNodes(candidates[i - 1]!, n) !== 0) };
  }
  return detach({
    experimental: 'nonclinical-query-evidence-v0',
    stage: 'S6',
    scope: 'query-evidence',
    packageId: c.packageId,
    query: c.query,
    snapshot: c.snapshot,
    evidence,
    trace: c,
    notRun: ['Needs', 'PredicateProjection', 'ProgramExecution'],
  } as QueryEvidenceResult);
}
