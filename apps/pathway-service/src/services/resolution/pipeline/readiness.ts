import { ACTION_NODE_TYPES, NodeStatus, PendingQuestion, RedFlag, ResolutionState } from '../types';
import type { EvaluationScope, SafetyUnavailable, ScopedBlocker } from './types';

const INCOMPLETE = [NodeStatus.TIMEOUT, NodeStatus.CASCADE_LIMIT, NodeStatus.UNKNOWN];

/** Stage 7: one readiness rule set for every evaluation (spec §2, C3). */
export function readinessOf(input: {
  state: ResolutionState;
  pendingQuestions: PendingQuestion[];
  redFlags: RedFlag[];
  unavailable: SafetyUnavailable[];
  scope: EvaluationScope;
  isDegraded: boolean;
}): { ready: boolean; blockers: ScopedBlocker[]; status: 'ACTIVE' | 'DEGRADED' } {
  const blockers: ScopedBlocker[] = [];
  const pendingGates = new Set<string>();

  for (const node of input.state.values()) {
    if (node.status === NodeStatus.PENDING_QUESTION && (node.nodeType === 'Gate' || node.nodeType === 'DecisionPoint')) {
      pendingGates.add(node.nodeId);
      blockers.push({ scope: 'COMPLETENESS', type: 'PENDING_GATE', description: `"${node.title}" has an unanswered question`, relatedNodeIds: [node.nodeId] });
    }
    if (INCOMPLETE.includes(node.status)) {
      blockers.push({ scope: 'COMPLETENESS', type: 'INCOMPLETE_RESOLUTION', description: `"${node.title}" was never resolved (${node.status})`, relatedNodeIds: [node.nodeId] });
    }
  }
  // Open questions whose node is not PENDING — e.g. a tentative LLM gate, INCLUDED on its safe default (D3).
  for (const q of input.pendingQuestions) {
    if (pendingGates.has(q.gateId)) continue;
    pendingGates.add(q.gateId);
    blockers.push({ scope: 'COMPLETENESS', type: 'PENDING_GATE', description: `Open question: ${q.prompt}`, relatedNodeIds: [q.gateId] });
  }
  for (const flag of input.redFlags) {
    if (flag.acknowledged) continue;
    blockers.push({ scope: 'COMPLETENESS', type: 'UNRESOLVED_RED_FLAG', description: `Unresolved red flag: ${flag.description}`, relatedNodeIds: [flag.nodeId] });
  }
  // One blocker per drug naming EVERY node that carries it, sorted — keeping only the first
  // node made the result depend on state insertion order (property (b)).
  const unavailableByDrug = new Map<string, { drugName: string; nodeIds: Set<string> }>();
  for (const u of input.unavailable) {
    const k = `${u.source}|${u.drugName}`;
    const entry = unavailableByDrug.get(k) ?? { drugName: u.drugName, nodeIds: new Set<string>() };
    if (u.nodeId) entry.nodeIds.add(u.nodeId);
    unavailableByDrug.set(k, entry);
  }
  for (const { drugName, nodeIds } of unavailableByDrug.values()) {
    blockers.push({ scope: 'COMPLETENESS', type: 'SAFETY_DATA_UNAVAILABLE', description: `"${drugName}" cannot be safety-checked: no normalised medication`, relatedNodeIds: [...nodeIds].sort() });
  }

  if (input.scope === 'ROOT') {
    const hasAction = [...input.state.values()].some((n) => ACTION_NODE_TYPES.has(n.nodeType) && n.status === NodeStatus.INCLUDED);
    if (!hasAction) {
      blockers.push({ scope: 'OUTPUT', type: 'EMPTY_PLAN', description: 'No included action nodes — care plan would be empty', relatedNodeIds: [] });
    }
  }

  const degraded = input.isDegraded || [...input.state.values()].some((n) => INCOMPLETE.includes(n.status));
  return { ready: blockers.length === 0, blockers, status: degraded ? 'DEGRADED' : 'ACTIVE' };
}
