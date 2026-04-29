import type { PathwayGraphNode, PathwayGraphEdge, NodeConfidenceResult } from '@/types';
import type { StageView, StepView, DecisionPointView, PlanItemView } from './types';

/**
 * Builds a hierarchical tree from flat nodes[] + edges[].
 *
 * Traversal: Root → Stage (HAS_STAGE) → Step (HAS_STEP) →
 *   DecisionPoint (HAS_DECISION_POINT), Medication (USES_MEDICATION),
 *   LabTest (HAS_LAB_TEST), Procedure (HAS_PROCEDURE)
 */
export function buildHierarchy(
  nodes: PathwayGraphNode[],
  edges: PathwayGraphEdge[],
  confidenceMap?: Map<string, NodeConfidenceResult>,
): StageView[] {
  // Build lookup maps
  const nodeMap = new Map<string, PathwayGraphNode>();
  for (const n of nodes) nodeMap.set(n.id, n);

  // Build adjacency: parent → { edgeType → child[] }
  const children = new Map<string, Map<string, string[]>>();
  for (const e of edges) {
    if (!children.has(e.from)) children.set(e.from, new Map());
    const typeMap = children.get(e.from)!;
    if (!typeMap.has(e.type)) typeMap.set(e.type, []);
    typeMap.get(e.type)!.push(e.to);
  }

  // Find root-level stage edges: HAS_STAGE edges whose `from` is not a node in our set
  // (the root is the pathway itself, not in the nodes array)
  const stageIds: string[] = [];
  for (const e of edges) {
    if (e.type === 'HAS_STAGE') {
      stageIds.push(e.to);
    }
  }

  // Deduplicate and sort stages
  const uniqueStageIds = [...new Set(stageIds)];

  const stages: StageView[] = [];
  for (const stageId of uniqueStageIds) {
    const stageNode = nodeMap.get(stageId);
    if (!stageNode) continue;

    const stageProps = stageNode.properties as Record<string, unknown>;
    const stageNumber = Number(stageProps.stage_number ?? 0);

    // Steps under this stage
    const stepIds = children.get(stageId)?.get('HAS_STEP') ?? [];
    const steps: StepView[] = [];

    for (const stepId of stepIds) {
      const stepNode = nodeMap.get(stepId);
      if (!stepNode) continue;

      const stepProps = stepNode.properties as Record<string, unknown>;

      // Decision points
      const dpIds = children.get(stepId)?.get('HAS_DECISION_POINT') ?? [];
      const decisionPoints: DecisionPointView[] = [];
      for (const dpId of dpIds) {
        const dpNode = nodeMap.get(dpId);
        if (!dpNode) continue;
        const dpProps = dpNode.properties as Record<string, unknown>;

        // Criteria under this decision point
        const critIds = children.get(dpId)?.get('HAS_CRITERION') ?? [];
        const criteria: PathwayGraphNode[] = [];
        for (const cId of critIds) {
          const cNode = nodeMap.get(cId);
          if (cNode) criteria.push(cNode);
        }

        decisionPoints.push({
          node: dpNode,
          label: String(dpProps.title ?? dpId),
          confidence: confidenceMap?.get(dpId),
          criteria,
        });
      }

      // Medications
      const medIds = children.get(stepId)?.get('USES_MEDICATION') ?? [];
      const medications: PlanItemView[] = [];
      for (const mId of medIds) {
        const mNode = nodeMap.get(mId);
        if (!mNode) continue;
        const mProps = mNode.properties as Record<string, unknown>;
        medications.push({
          node: mNode,
          label: String(mProps.name ?? mId),
          itemType: 'Medication',
          confidence: confidenceMap?.get(mId),
        });
      }

      // Lab Tests
      const labIds = children.get(stepId)?.get('HAS_LAB_TEST') ?? [];
      const labTests: PlanItemView[] = [];
      for (const lId of labIds) {
        const lNode = nodeMap.get(lId);
        if (!lNode) continue;
        const lProps = lNode.properties as Record<string, unknown>;
        labTests.push({
          node: lNode,
          label: String(lProps.name ?? lId),
          itemType: 'LabTest',
          confidence: confidenceMap?.get(lId),
        });
      }

      // Procedures
      const procIds = children.get(stepId)?.get('HAS_PROCEDURE') ?? [];
      const procedures: PlanItemView[] = [];
      for (const pId of procIds) {
        const pNode = nodeMap.get(pId);
        if (!pNode) continue;
        const pProps = pNode.properties as Record<string, unknown>;
        procedures.push({
          node: pNode,
          label: String(pProps.name ?? pId),
          itemType: 'Procedure',
          confidence: confidenceMap?.get(pId),
        });
      }

      steps.push({
        node: stepNode,
        label: String(stepProps.title ?? stepId),
        displayNumber: String(stepProps.display_number ?? ''),
        confidence: confidenceMap?.get(stepId),
        decisionPoints,
        medications,
        labTests,
        procedures,
      });
    }

    // Sort steps by step_number
    steps.sort((a, b) => {
      const aNum = Number((a.node.properties as Record<string, unknown>).step_number ?? 0);
      const bNum = Number((b.node.properties as Record<string, unknown>).step_number ?? 0);
      return aNum - bNum;
    });

    stages.push({
      node: stageNode,
      label: String(stageProps.title ?? stageId),
      stageNumber,
      confidence: confidenceMap?.get(stageId),
      steps,
    });
  }

  // Sort stages by stage_number
  stages.sort((a, b) => a.stageNumber - b.stageNumber);

  return stages;
}

/** Count summary stats from nodes */
export function countNodeTypes(nodes: PathwayGraphNode[]): {
  total: number;
  stages: number;
  steps: number;
  conditions: number;
} {
  let stages = 0, steps = 0, conditions = 0;
  for (const n of nodes) {
    if (n.type === 'Stage') stages++;
    else if (n.type === 'Step') steps++;
    else if (n.type === 'DecisionPoint' || n.type === 'Criterion') conditions++;
  }
  return { total: nodes.length, stages, steps, conditions };
}
