import type { GraphContext, PatientContext } from '../../confidence/types';
import type { CatchUpItem } from '../care-plan-merge';
import { findUnmetPrerequisites } from '../prerequisites';
import { DependencyMap, NodeStatus, ResolutionState } from '../types';

/** Catch-up items for every included Stage/Step — the multi-start computation, now for every evaluation. */
export function catchUpItemsFor(state: ResolutionState, patient: PatientContext, graph: GraphContext, pathwayId: string): CatchUpItem[] {
  const items: CatchUpItem[] = [];
  const seen = new Set<string>();
  for (const node of state.values()) {
    if (node.status !== NodeStatus.INCLUDED) continue;
    if (node.nodeType !== 'Stage' && node.nodeType !== 'Step') continue;
    for (const u of findUnmetPrerequisites(node.nodeId, patient, graph)) {
      if (seen.has(u.nodeId)) continue;
      seen.add(u.nodeId);
      items.push({ nodeId: u.nodeId, nodeType: u.nodeType, title: u.title, dependentNodeId: u.dependentNodeId, reason: u.reason, sourcePathwayId: pathwayId });
    }
  }
  return items;
}

/** `gateContextFields` as sorted arrays — the only part of the dependency map that survives (spec §1). */
export function gateContextFieldsOf(depMap: DependencyMap): Map<string, string[]> {
  return new Map([...depMap.gateContextFields].map(([gateId, fields]) => [gateId, [...fields].sort()]));
}
