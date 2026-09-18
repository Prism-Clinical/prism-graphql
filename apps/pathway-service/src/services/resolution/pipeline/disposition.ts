import type { DdiCandidate } from '../../medications/ddi-pass';
import { ddiSuppressionReason } from '../../medications/ddi-pass-single-pathway';
import { NodeStatus, ResolutionState } from '../types';
import { medicationName } from './load-env';
import type { ScopedFinding } from './types';

/**
 * Included medications, named exactly as the environment's candidate universe
 * names them (`medicationName`), so a snapshot row can never miss its
 * candidate.
 */
export function medicationCandidates(state: ResolutionState): DdiCandidate[] {
  return [...state.values()]
    .filter((n) => n.nodeType === 'Medication' && n.status === NodeStatus.INCLUDED)
    .map((n) => ({
      recommendationId: n.nodeId,
      drugName: medicationName({ nodeIdentifier: n.nodeId, properties: n.properties }),
      meta: { nodeType: n.nodeType },
    }));
}

const findingId = (f: ScopedFinding): string =>
  `${f.scope}|${f.category}|${f.source.kind}|${
    f.source.kind === 'PATIENT_MEDICATION' ? f.source.rxcui
      : f.source.kind === 'PATIENT_ALLERGY' ? f.source.snomedCode
        : f.source.recommendationId
  }`;

/**
 * Split each node into eligibility (what traversal decided) and disposition
 * (what the plan keeps). Only an INCLUDED node can be withheld; its original
 * explanation survives in `eligibility`.
 */
export function applyDisposition(state: ResolutionState, findings: ScopedFinding[]): ResolutionState {
  const suppressing = new Map<string, ScopedFinding[]>();
  for (const f of findings) {
    if (f.action !== 'SUPPRESS') continue;
    suppressing.set(f.recommendationId, [...(suppressing.get(f.recommendationId) ?? []), f]);
  }
  // The reason is the top finding by category, ties broken by position — and findings arrive in
  // state order. Sort by id so two same-category partners can't swap with input order.
  for (const list of suppressing.values()) {
    list.sort((a, b) => (findingId(a) < findingId(b) ? -1 : findingId(a) > findingId(b) ? 1 : 0));
  }

  const out: ResolutionState = new Map();
  for (const [id, node] of state) {
    const eligibility = { status: node.status, reason: node.excludeReason, decidedBy: node.providerOverride ? 'override' as const : 'traversal' as const };
    const withheld = node.status === NodeStatus.INCLUDED ? suppressing.get(id) : undefined;
    const disposition = withheld
      ? { status: NodeStatus.EXCLUDED, withheldBy: 'safety' as const, findingIds: withheld.map(findingId).sort(), reason: ddiSuppressionReason(withheld, id) }
      : { status: node.status };
    out.set(id, { ...node, eligibility, disposition, status: disposition.status, excludeReason: disposition.reason ?? eligibility.reason });
  }
  return out;
}
