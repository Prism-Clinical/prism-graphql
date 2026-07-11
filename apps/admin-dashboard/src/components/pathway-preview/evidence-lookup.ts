import type {
  MergedCarePlan,
  GateEvidence,
  RecommendationState,
} from '@/types';

/**
 * Pre-computed lookup so per-recommendation UI (chips in PlanItemRow,
 * lineage rows in the sidebar) can find its evidence without walking
 * the full MergedCarePlan on every render.
 *
 * Key mapping:
 *   - `evidenceByNodeId` — `sourceNodeId → { gateIds, state }` for the
 *     one Merged*Recommendation that came from that graph node. Empty
 *     when the node isn't in the merged plan (e.g. gated out).
 *   - `gatesById` — `gateNodeId → GateEvidence` so chips can resolve
 *     an id to its title / fieldsRead for hover tooltips.
 *
 * A single graph node may show up in at most one Merged*Recommendation
 * because the projection layer stamps sourceNodeId at emit time. When
 * the source graph is malformed and two recs share a sourceNodeId (rare
 * but possible for provider overrides), we keep the last-seen entry —
 * chips are a display concern and the failure mode is "shows the second
 * rec's chips" which is better than throwing.
 */
export interface EvidenceLookup {
  evidenceByNodeId: Map<
    string,
    { gateIds: string[]; state: RecommendationState }
  >;
  gatesById: Map<string, GateEvidence>;
}

export const EMPTY_EVIDENCE_LOOKUP: EvidenceLookup = {
  evidenceByNodeId: new Map(),
  gatesById: new Map(),
};

export function buildEvidenceLookup(
  mergedPlan: MergedCarePlan | null,
): EvidenceLookup {
  if (!mergedPlan) return EMPTY_EVIDENCE_LOOKUP;

  const evidenceByNodeId = new Map<
    string,
    { gateIds: string[]; state: RecommendationState }
  >();
  const gatesById = new Map<string, GateEvidence>();

  const buckets = [
    mergedPlan.medications,
    mergedPlan.labs,
    mergedPlan.imaging,
    mergedPlan.procedures,
    mergedPlan.guidance,
    mergedPlan.schedules,
    mergedPlan.qualityMetrics,
  ];
  for (const bucket of buckets) {
    for (const rec of bucket) {
      const nodeId = rec.recommendation.sourceNodeId;
      if (!nodeId) continue;
      evidenceByNodeId.set(nodeId, {
        gateIds: rec.recommendation.evidenceGateIds ?? [],
        state: rec.state,
      });
    }
  }

  for (const gate of mergedPlan.evidenceTrail) {
    gatesById.set(gate.nodeId, gate);
  }

  return { evidenceByNodeId, gatesById };
}
