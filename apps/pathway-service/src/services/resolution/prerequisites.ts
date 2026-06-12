/**
 * REQUIRES backtracking pass.
 *
 * Each pathway node may declare a `satisfaction_check` property + REQUIRES
 * outgoing edges to other nodes that must be done first. When a node is
 * about to fire as a recommendation, we walk those REQUIRES edges,
 * evaluate the satisfaction predicate against the patient context, and
 * surface every unmet prerequisite (recursively) so the merged care plan
 * can include catch-up work alongside the actually-requested
 * recommendation.
 *
 * Direction note: REQUIRES edges run from the DEPENDENT (the thing that
 * needs the prereq) to the PREREQUISITE (the thing that must be done
 * first). To find prereqs of a node we follow its OUTGOING REQUIRES
 * edges; the targets are the prerequisites.
 *
 * This module is a pure function — no DB, no AGE, no graphql. Callers
 * pass a hydrated GraphContext + PatientContext. That keeps it easy to
 * test and to call from anywhere in the resolution pipeline.
 */

import type { GraphContext, GraphNode, PatientContext, CodeEntry } from '../confidence/types';

// ─── Satisfaction predicate ──────────────────────────────────────────

/**
 * Code-based check: the prerequisite is satisfied if the patient
 * snapshot contains an entry with the same (code, system) pair in any
 * domain (conditions, medications, labs, allergies). v1 doesn't honour
 * lookback_days yet — included on the type so authors can start setting
 * it without a schema migration when we wire it through.
 */
export interface SatisfactionCheckCode {
  type: 'code';
  code: string;
  system: string;
  lookback_days?: number;
}

/**
 * Attestation: the prerequisite must be confirmed by the provider
 * because there's no objective code to look up (e.g. "initial-visit
 * education was delivered"). Surfaced as a pending provider action.
 */
export interface SatisfactionCheckAttestation {
  type: 'attestation';
  label?: string;
}

export type SatisfactionCheck =
  | SatisfactionCheckCode
  | SatisfactionCheckAttestation;

// ─── Result shape ────────────────────────────────────────────────────

export type UnmetReason =
  | 'no-satisfaction-check'
  | 'code-not-in-snapshot'
  | 'attestation-required';

export interface UnmetPrerequisite {
  /** The prerequisite node that wasn't satisfied. */
  nodeId: string;
  nodeType: string;
  title: string;
  /** The node that REQUIRES this prerequisite (where backtracking began). */
  dependentNodeId: string;
  /** Why this prereq was flagged. */
  reason: UnmetReason;
}

// ─── Public API ──────────────────────────────────────────────────────

/**
 * Returns the set of prerequisites that are NOT satisfied for the given
 * starting node. Walks REQUIRES edges transitively: if a prerequisite is
 * unmet, its own prerequisites are checked too, so the catch-up chain is
 * surfaced in full. Order is reverse-discovery — earliest dependencies
 * first — so consumers can present "do X, then Y, then your real
 * encounter goal" naturally.
 */
export function findUnmetPrerequisites(
  startNodeId: string,
  patientContext: PatientContext,
  graphContext: GraphContext,
): UnmetPrerequisite[] {
  const visited = new Set<string>();
  const stack: { nodeId: string; dependentNodeId: string }[] = [];

  // Seed: every REQUIRES edge leaving the start node.
  for (const edge of graphContext.outgoingEdges(startNodeId)) {
    if (edge.edgeType !== 'REQUIRES') continue;
    stack.push({ nodeId: edge.targetId, dependentNodeId: startNodeId });
  }

  const result: UnmetPrerequisite[] = [];
  while (stack.length > 0) {
    const { nodeId, dependentNodeId } = stack.pop()!;
    if (visited.has(nodeId)) continue;
    visited.add(nodeId);

    const node = graphContext.getNode(nodeId);
    if (!node) continue;

    const check = readSatisfactionCheck(node);
    const satisfaction = evaluateSatisfaction(check, patientContext);

    if (!satisfaction.satisfied) {
      result.push({
        nodeId,
        nodeType: node.nodeType,
        title: getNodeTitle(node),
        dependentNodeId,
        reason: satisfaction.reason,
      });
      // Recurse: an unsatisfied prereq might depend on its own prereqs.
      for (const edge of graphContext.outgoingEdges(nodeId)) {
        if (edge.edgeType !== 'REQUIRES') continue;
        stack.push({ nodeId: edge.targetId, dependentNodeId: nodeId });
      }
    }
  }

  // Reverse so the deepest (earliest-in-chain) unmet prereqs come first.
  return result.reverse();
}

// ─── Internals ───────────────────────────────────────────────────────

function readSatisfactionCheck(node: GraphNode): SatisfactionCheck | null {
  const raw = node.properties?.satisfaction_check;
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  if (obj.type === 'code' && typeof obj.code === 'string' && typeof obj.system === 'string') {
    return {
      type: 'code',
      code: obj.code,
      system: obj.system,
      lookback_days:
        typeof obj.lookback_days === 'number' ? obj.lookback_days : undefined,
    };
  }
  if (obj.type === 'attestation') {
    return {
      type: 'attestation',
      label: typeof obj.label === 'string' ? obj.label : undefined,
    };
  }
  return null;
}

interface SatisfactionResult {
  satisfied: boolean;
  reason: UnmetReason;
}

function evaluateSatisfaction(
  check: SatisfactionCheck | null,
  patientContext: PatientContext,
): SatisfactionResult {
  if (!check) {
    // No explicit check authored — be conservative and flag the prereq.
    // Authors who don't care about a particular prereq satisfying
    // automatically can mark it `{ type: 'attestation' }` to make the
    // intent explicit.
    return { satisfied: false, reason: 'no-satisfaction-check' };
  }
  if (check.type === 'code') {
    const found = patientHasCode(patientContext, check.code, check.system);
    return {
      satisfied: found,
      // reason is ignored when satisfied === true; pick the semantic
      // failure case for the unsatisfied branch.
      reason: 'code-not-in-snapshot',
    };
  }
  if (check.type === 'attestation') {
    return { satisfied: false, reason: 'attestation-required' };
  }
  return { satisfied: false, reason: 'no-satisfaction-check' };
}

function patientHasCode(
  ctx: PatientContext,
  code: string,
  system: string,
): boolean {
  // CodeEntry shape is shared by conditions/meds/allergies; LabResult
  // extends it. Probe every bucket — for v1 we don't restrict the check
  // to a domain because most natural "is X done?" predicates are
  // unambiguous on (code, system) alone.
  const codeBuckets: CodeEntry[][] = [
    ctx.conditionCodes ?? [],
    ctx.medications ?? [],
    ctx.allergies ?? [],
  ];
  for (const bucket of codeBuckets) {
    for (const entry of bucket) {
      if (entry.code === code && entry.system === system) return true;
    }
  }
  for (const lab of ctx.labResults ?? []) {
    if (lab.code === code && lab.system === system) return true;
  }
  return false;
}

function getNodeTitle(node: GraphNode): string {
  const props = node.properties ?? {};
  const title = props.title ?? props.name ?? props.topic;
  return typeof title === 'string' && title.length > 0 ? title : node.nodeIdentifier;
}
