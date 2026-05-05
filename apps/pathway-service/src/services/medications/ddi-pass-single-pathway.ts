/**
 * Single-pathway DDI integration. Sits at the seam between TraversalEngine
 * completion and session persistence — pulls Medication nodes out of the
 * resolution state, runs them through the DDI orchestrator, mutates the
 * state to reflect suppressions, and returns the warnings list to persist.
 */

import { Pool } from 'pg';
import { PatientContext } from '../confidence/types';
import { NodeStatus } from '../../types';
import { ResolutionState } from '../resolution/types';
import { runPatientContextDdi, DdiCandidate, DdiFinding } from './ddi-pass';

export interface SinglePathwayDdiResult {
  /** All findings produced (suppressions + warnings, both go to UX). */
  findings: DdiFinding[];
  /** Number of nodes whose status mutated to EXCLUDED due to DDI. */
  suppressedNodeCount: number;
}

/**
 * Apply DDI to a single-pathway resolution state. Mutates the state in place:
 * any Medication node whose recommendation is suppressed becomes EXCLUDED
 * with a DDI-prefixed excludeReason. Warnings (MODERATE) are returned as
 * findings — caller persists them on the session for the UI.
 */
export async function applyDdiToResolutionState(
  pool: Pool,
  state: ResolutionState,
  patientContext: PatientContext,
): Promise<SinglePathwayDdiResult> {
  const candidates: DdiCandidate[] = [];
  for (const node of state.values()) {
    if (node.nodeType !== 'Medication') continue;
    if (node.status !== NodeStatus.INCLUDED) continue;
    const name = (node.properties?.name as string) ?? node.title;
    if (!name) continue;
    candidates.push({
      recommendationId: node.nodeId,
      drugName: name,
      meta: { nodeType: node.nodeType },
    });
  }

  const result = await runPatientContextDdi(pool, candidates, patientContext);

  let suppressedNodeCount = 0;
  for (const id of result.suppressedRecommendationIds) {
    const node = state.get(id);
    if (!node) continue;
    // Only flip + retitle nodes the traversal had INCLUDED. If the node was
    // already EXCLUDED for another reason (low confidence, gate, etc.), the
    // original excludeReason stays — overwriting it with a DDI prefix would
    // misattribute the original cause.
    if (node.status !== NodeStatus.INCLUDED) continue;
    node.status = NodeStatus.EXCLUDED;
    const reason = ddiSuppressionReason(result.findings, id);
    if (reason) node.excludeReason = reason;
    suppressedNodeCount++;
  }

  return { findings: result.findings, suppressedNodeCount };
}

/**
 * Pick the most informative DDI suppression reason for a given node. If
 * multiple findings suppress the same node, prefer ALLERGY > CONTRAINDICATED
 * > SEVERE since that's the order a clinician wants surfaced.
 */
function ddiSuppressionReason(
  findings: DdiFinding[],
  recommendationId: string,
): string | undefined {
  const relevant = findings.filter(
    (f) => f.recommendationId === recommendationId && f.action === 'SUPPRESS',
  );
  if (relevant.length === 0) return undefined;
  const order = ['ALLERGY', 'DDI_CONTRAINDICATED', 'DDI_SEVERE'] as const;
  relevant.sort(
    (a, b) => order.indexOf(a.category as never) - order.indexOf(b.category as never),
  );
  const top = relevant[0];
  const sourceLabel =
    top.source.kind === 'PATIENT_MEDICATION' ? `patient med "${top.source.name}"`
    : top.source.kind === 'PATIENT_ALLERGY' ? `patient allergy "${top.source.snomedDisplay}"`
    : `recommendation "${top.source.drugName}"`;
  return `${top.category}: ${sourceLabel}${top.mechanism ? ` — ${top.mechanism}` : ''}`;
}
