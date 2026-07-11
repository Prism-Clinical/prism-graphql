/**
 * Phase 3 commit 3: project a single-pathway resolution into a ResolvedCarePlan.
 *
 * The traversal engine produces a `ResolutionState` keyed by node id. For
 * multi-pathway merging we need to flatten that state into the role-typed
 * shapes the merge layer expects (medications, labs, procedures, schedules,
 * quality metrics). This module does that, pulling type-specific properties
 * straight off the carried `node.properties` payload — the same approach the
 * single-pathway care-plan-generator uses.
 *
 * Pure function. No DB. The caller passes in pathway metadata (logical id +
 * title) since the ResolutionState alone doesn't carry it.
 */

import {
  NodeResult,
  NodeStatus,
  ResolutionState,
  DependencyMap,
} from './types';
import {
  ResolvedCarePlan,
  ResolvedMedication,
  ResolvedLab,
  ResolvedImaging,
  ResolvedProcedure,
  ResolvedGuidance,
  ResolvedSchedule,
  ResolvedQualityMetric,
  GateEvidence,
  DataGapHint,
  UnlockedRecommendation,
} from './care-plan-merge';
import { MedicationRole } from '../import/types';

export interface PathwayProjectionMetadata {
  pathwayId: string;
  pathwayLogicalId: string;
  pathwayTitle: string;
}

export function projectResolutionToCarePlan(
  resolutionState: ResolutionState,
  meta: PathwayProjectionMetadata,
  catchUpItems: ResolvedCarePlan['catchUpItems'] = [],
  dependencyMap?: DependencyMap,
): ResolvedCarePlan {
  const medications: ResolvedMedication[] = [];
  const labs: ResolvedLab[] = [];
  const imaging: ResolvedImaging[] = [];
  const procedures: ResolvedProcedure[] = [];
  const guidance: ResolvedGuidance[] = [];
  const schedules: ResolvedSchedule[] = [];
  const qualityMetrics: ResolvedQualityMetric[] = [];

  // Compute per-action-node attribution once — every included action
  // node looks up its own evidenceGateIds from this map below. Walking
  // the parentNodeId chain per node is O(depth) per lookup; pre-computing
  // here keeps the projection loop linear.
  const attributionByActionId = computeAttribution(resolutionState);

  const attach = <T>(rec: T | null, nodeId: string): T | null => {
    if (!rec) return null;
    (rec as unknown as { evidenceGateIds: string[] }).evidenceGateIds =
      attributionByActionId.get(nodeId) ?? [];
    return rec;
  };

  for (const node of resolutionState.values()) {
    if (node.status !== NodeStatus.INCLUDED) continue;

    switch (node.nodeType) {
      case 'Medication': {
        const med = attach(projectMedication(node, meta.pathwayId), node.nodeId);
        if (med) medications.push(med);
        break;
      }
      case 'LabTest': {
        const lab = attach(projectLab(node, meta.pathwayId), node.nodeId);
        if (lab) labs.push(lab);
        break;
      }
      case 'Imaging': {
        const img = attach(projectImaging(node, meta.pathwayId), node.nodeId);
        if (img) imaging.push(img);
        break;
      }
      case 'Procedure': {
        const proc = attach(projectProcedure(node, meta.pathwayId), node.nodeId);
        if (proc) procedures.push(proc);
        break;
      }
      case 'Guidance': {
        const g = attach(projectGuidance(node, meta.pathwayId), node.nodeId);
        if (g) guidance.push(g);
        break;
      }
      case 'Schedule': {
        const sched = attach(projectSchedule(node, meta.pathwayId), node.nodeId);
        if (sched) schedules.push(sched);
        break;
      }
      case 'QualityMetric': {
        const qm = attach(projectQualityMetric(node, meta.pathwayId), node.nodeId);
        if (qm) qualityMetrics.push(qm);
        break;
      }
      default:
        // ignore structural / decision / criterion / evidence / etc.
        break;
    }
  }

  return {
    pathwayId: meta.pathwayId,
    pathwayLogicalId: meta.pathwayLogicalId,
    pathwayTitle: meta.pathwayTitle,
    medications,
    labs,
    imaging,
    procedures,
    guidance,
    schedules,
    qualityMetrics,
    catchUpItems,
    evidenceTrail: collectEvidenceTrail(resolutionState, dependencyMap),
    dataGapHints: collectDataGapHints(resolutionState, dependencyMap),
  };
}

/**
 * Action-node types that represent recommendations the dashboard
 * should surface as "would have been recommended." Same set the action
 * branch of the traversal engine emits.
 */
const ACTION_NODE_TYPES = new Set([
  'Medication',
  'LabTest',
  'Imaging',
  'Procedure',
  'Guidance',
  'Schedule',
  'QualityMetric',
]);

/**
 * Per-recommendation attribution: for every action node in the
 * resolution state, collect the Gate / DecisionPoint node ids that
 * gated the path to it. Walks the action node's parentNodeId chain
 * up; at each ancestor, any Gate / DP that shares the ancestor as its
 * own parentNodeId is a "sibling at this level" — those gates govern
 * whether this action node fires.
 *
 * Only INCLUDED / PENDING_QUESTION gates are attributed (EXCLUDED
 * ones didn't participate; GATED_OUT siblings are already surfaced in
 * data-gap hints, not as evidence). EXCLUDED gates are dropped here
 * because they don't represent "what fired this rec" — the rec fired
 * around them.
 *
 * Cycle-safe: parentNodeId chains are walked with a visited set so a
 * pathological self-reference can't loop forever.
 */
function computeAttribution(
  resolutionState: ResolutionState,
): Map<string, string[]> {
  // First pass: bucket Gate / DecisionPoint nodes by their parentNodeId.
  const gatesByParent = new Map<string, string[]>();
  for (const n of resolutionState.values()) {
    if (n.nodeType !== 'Gate' && n.nodeType !== 'DecisionPoint') continue;
    if (n.status === NodeStatus.EXCLUDED) continue;
    if (!n.parentNodeId) continue;
    const arr = gatesByParent.get(n.parentNodeId) ?? [];
    arr.push(n.nodeId);
    gatesByParent.set(n.parentNodeId, arr);
  }

  // Second pass: for each action node, walk up and collect.
  const out = new Map<string, string[]>();
  for (const action of resolutionState.values()) {
    if (!ACTION_NODE_TYPES.has(action.nodeType)) continue;
    if (action.status !== NodeStatus.INCLUDED) continue;

    const collected = new Set<string>();
    const visited = new Set<string>();
    let cur: NodeResult | undefined = action;
    while (cur?.parentNodeId && !visited.has(cur.parentNodeId)) {
      visited.add(cur.parentNodeId);
      const sibs = gatesByParent.get(cur.parentNodeId);
      if (sibs) for (const id of sibs) collected.add(id);
      cur = resolutionState.get(cur.parentNodeId);
    }
    out.set(action.nodeId, Array.from(collected));
  }
  return out;
}

/**
 * For every gate that DIDN'T fire — GATED_OUT, PENDING_QUESTION, or
 * UNKNOWN — collect the action-node recommendations whose subtree
 * markSubtree-stamped them with that gate's id as parentNodeId. The
 * resulting "Add X → unlocks Y, Z" hints feed the dashboard's
 * data-gap surface.
 *
 * Only emits a hint when at least one action node exists downstream —
 * gates with no downstream recs aren't actionable to the provider.
 */
function collectDataGapHints(
  resolutionState: ResolutionState,
  dependencyMap: DependencyMap | undefined,
): DataGapHint[] {
  const fieldsByGate = dependencyMap?.gateContextFields ?? new Map<string, Set<string>>();

  // Pre-build the "gate id → downstream action nodes" index. markSubtree
  // assigns the gate's id to every gated-out descendant's parentNodeId,
  // so this is a single pass.
  const downstreamByGate = new Map<string, UnlockedRecommendation[]>();
  for (const node of resolutionState.values()) {
    if (!ACTION_NODE_TYPES.has(node.nodeType)) continue;
    if (!node.parentNodeId) continue;
    if (node.status !== NodeStatus.GATED_OUT && node.status !== NodeStatus.PENDING_QUESTION) continue;
    const arr = downstreamByGate.get(node.parentNodeId) ?? [];
    arr.push({ nodeId: node.nodeId, nodeType: node.nodeType, title: node.title });
    downstreamByGate.set(node.parentNodeId, arr);
  }

  const hints: DataGapHint[] = [];
  for (const node of resolutionState.values()) {
    const isGate = node.nodeType === 'Gate';
    const isDp = node.nodeType === 'DecisionPoint';
    if (!isGate && !isDp) continue;
    if (
      node.status !== NodeStatus.GATED_OUT &&
      node.status !== NodeStatus.PENDING_QUESTION &&
      node.status !== NodeStatus.UNKNOWN
    ) continue;
    const downstream = downstreamByGate.get(node.nodeId) ?? [];
    if (downstream.length === 0) continue;

    const props = node.properties ?? {};
    const kind = isGate
      ? typeof props.gate_type === 'string'
        ? props.gate_type
        : 'patient_attribute'
      : 'decision_point';

    hints.push({
      gateNodeId: node.nodeId,
      gateTitle: node.title,
      kind,
      status: node.status,
      reason: node.excludeReason ?? undefined,
      fieldsRead: Array.from(fieldsByGate.get(node.nodeId) ?? []),
      unlockedRecommendations: downstream,
    });
  }
  return hints;
}

/**
 * Walk the resolution state for Gate and DecisionPoint nodes and emit a
 * GateEvidence row per one that participated in this pathway's resolve
 * (status INCLUDED, GATED_OUT, or PENDING_QUESTION — i.e. the gate
 * actually evaluated; not just structurally present). Fields-read come
 * from the dependency map's gateContextFields side-table.
 */
function collectEvidenceTrail(
  resolutionState: ResolutionState,
  dependencyMap: DependencyMap | undefined,
): GateEvidence[] {
  const out: GateEvidence[] = [];
  const fieldsByGate = dependencyMap?.gateContextFields ?? new Map<string, Set<string>>();

  for (const node of resolutionState.values()) {
    const isGate = node.nodeType === 'Gate';
    const isDp = node.nodeType === 'DecisionPoint';
    if (!isGate && !isDp) continue;

    // Skip unevaluated gates — they didn't contribute. UNKNOWN ones,
    // however, indicate "we couldn't decide" which IS evidence-shaped
    // ("here's a gate that wanted data we don't have").
    if (node.status === NodeStatus.EXCLUDED) continue;

    const props = node.properties ?? {};
    const kind = isGate
      ? typeof props.gate_type === 'string'
        ? props.gate_type
        : 'patient_attribute'
      : 'decision_point';

    out.push({
      nodeId: node.nodeId,
      title: node.title,
      kind,
      status: node.status,
      reason: node.excludeReason ?? undefined,
      fieldsRead: Array.from(fieldsByGate.get(node.nodeId) ?? []),
    });
  }
  return out;
}

// ─── Per-type projection helpers ─────────────────────────────────────

function strProp(node: NodeResult, key: string): string | undefined {
  const v = node.properties?.[key];
  return typeof v === 'string' ? v : undefined;
}

function projectMedication(
  node: NodeResult,
  pathwayId: string,
): ResolvedMedication | null {
  const name = strProp(node, 'name') ?? node.title;
  const rawRole = strProp(node, 'role');
  if (!rawRole) return null;
  // Trust import-time validation: role was checked against VALID_MEDICATION_ROLES
  // when the pathway was imported, so any string in `role` is a MedicationRole.
  const role = rawRole as MedicationRole;
  return {
    name,
    role,
    dose: strProp(node, 'dose') ?? strProp(node, 'dosage'),
    frequency: strProp(node, 'frequency'),
    duration: strProp(node, 'duration'),
    route: strProp(node, 'route'),
    clinicalRole: strProp(node, 'clinical_role'),
    sourcePathwayId: pathwayId,
    sourceNodeId: node.nodeId,
    evidenceGateIds: [], // overwritten by attach() in projectResolutionToCarePlan
  };
}

function projectLab(
  node: NodeResult,
  pathwayId: string,
): ResolvedLab | null {
  const name = strProp(node, 'name') ?? node.title;
  return {
    name,
    code: strProp(node, 'code'),
    system: strProp(node, 'system'),
    specimen: strProp(node, 'specimen'),
    sourcePathwayId: pathwayId,
    sourceNodeId: node.nodeId,
    evidenceGateIds: [],
  };
}

function projectProcedure(
  node: NodeResult,
  pathwayId: string,
): ResolvedProcedure | null {
  const name = strProp(node, 'name') ?? node.title;
  return {
    name,
    code: strProp(node, 'code') ?? strProp(node, 'procedure_code'),
    system: strProp(node, 'system'),
    sourcePathwayId: pathwayId,
    sourceNodeId: node.nodeId,
    evidenceGateIds: [],
  };
}

function projectImaging(
  node: NodeResult,
  pathwayId: string,
): ResolvedImaging | null {
  const name = strProp(node, 'name') ?? node.title;
  const modality = strProp(node, 'modality');
  if (!modality) return null; // imaging without a modality isn't actionable
  const contrastRaw = node.properties?.['contrast'];
  return {
    name,
    modality,
    bodyRegion: strProp(node, 'body_region'),
    contrast: typeof contrastRaw === 'boolean' ? contrastRaw : undefined,
    code: strProp(node, 'code') ?? strProp(node, 'code_value'),
    system: strProp(node, 'system') ?? strProp(node, 'code_system'),
    sourcePathwayId: pathwayId,
    sourceNodeId: node.nodeId,
    evidenceGateIds: [],
  };
}

function projectGuidance(
  node: NodeResult,
  pathwayId: string,
): ResolvedGuidance | null {
  const topic = strProp(node, 'topic') ?? node.title;
  const instructions = strProp(node, 'instructions');
  if (!instructions) return null;
  return {
    topic,
    instructions,
    category: strProp(node, 'category'),
    sourcePathwayId: pathwayId,
    sourceNodeId: node.nodeId,
    evidenceGateIds: [],
  };
}

function projectSchedule(
  node: NodeResult,
  pathwayId: string,
): ResolvedSchedule | null {
  const interval = strProp(node, 'interval');
  const description = strProp(node, 'description');
  if (!interval || !description) return null;
  return {
    interval,
    description,
    sourcePathwayId: pathwayId,
    sourceNodeId: node.nodeId,
    evidenceGateIds: [],
  };
}

function projectQualityMetric(
  node: NodeResult,
  pathwayId: string,
): ResolvedQualityMetric | null {
  const name = strProp(node, 'name') ?? node.title;
  const measure = strProp(node, 'measure');
  if (!measure) return null;
  return {
    name,
    measure,
    sourcePathwayId: pathwayId,
    sourceNodeId: node.nodeId,
    evidenceGateIds: [],
  };
}
