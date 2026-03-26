/**
 * Care Plan Generator
 *
 * Transforms a resolved pathway (ResolutionState) into a structured CarePlanData
 * object ready for persistence through careplan-service.
 *
 * Mapping:
 *   Stage       → Care Plan Goal  (HIGH priority)
 *   Medication  → Intervention MEDICATION
 *   LabTest     → Intervention MONITORING
 *   Procedure   → Intervention PROCEDURE
 *   Monitoring  → Intervention MONITORING
 *   Lifestyle   → Intervention LIFESTYLE
 *   Referral    → Intervention REFERRAL
 */

import {
  ResolutionState,
  NodeResult,
  NodeStatus,
  BlockerType,
  ValidationBlocker,
  ACTION_NODE_TYPES,
  RedFlag,
} from './types';

// ─── Output Types ──────────────────────────────────────────────────

export interface CarePlanGoalData {
  description: string;
  priority: string;
  guidelineReference?: string;
  pathwayNodeId: string;
}

export interface CarePlanInterventionData {
  type: string;
  description: string;
  medicationCode?: string;
  dosage?: string;
  frequency?: string;
  procedureCode?: string;
  referralSpecialty?: string;
  patientInstructions?: string;
  guidelineReference?: string;
  recommendationConfidence: number;
  source: 'pathway_recommendation' | 'provider_override';
  pathwayNodeId: string;
  pathwayId: string;
  sessionId: string;
}

export interface CarePlanData {
  conditionCodes: string[];
  goals: CarePlanGoalData[];
  interventions: CarePlanInterventionData[];
}

// ─── Node Type → Intervention Type ─────────────────────────────────

const NODE_TYPE_TO_INTERVENTION: Record<string, string> = {
  Medication: 'MEDICATION',
  LabTest: 'MONITORING',
  Procedure: 'PROCEDURE',
  Monitoring: 'MONITORING',
  Lifestyle: 'LIFESTYLE',
  Referral: 'REFERRAL',
};

// ─── Helpers ───────────────────────────────────────────────────────

function prop(node: NodeResult, key: string): string | undefined {
  const val = node.properties?.[key];
  return typeof val === 'string' ? val : undefined;
}

function isActionNode(nodeType: string): boolean {
  return ACTION_NODE_TYPES.has(nodeType);
}

function isIncluded(node: NodeResult): boolean {
  return node.status === NodeStatus.INCLUDED;
}

/**
 * Determine whether a Stage has at least one included action descendant
 * by walking the resolution state and checking parentNodeId chains.
 */
function stageHasIncludedActions(
  stageId: string,
  state: ResolutionState,
): boolean {
  for (const node of state.values()) {
    if (!isIncluded(node) || !isActionNode(node.nodeType)) continue;
    // Walk up parent chain looking for this stage
    let current: NodeResult | undefined = node;
    while (current) {
      if (current.parentNodeId === stageId) return true;
      current = current.parentNodeId ? state.get(current.parentNodeId) : undefined;
    }
  }
  return false;
}

// ─── Validation ────────────────────────────────────────────────────

export function validateForGeneration(
  state: ResolutionState,
  redFlags: RedFlag[],
): ValidationBlocker[] {
  const blockers: ValidationBlocker[] = [];

  // 1. At least one included action node
  const hasAction = Array.from(state.values()).some(
    n => isIncluded(n) && isActionNode(n.nodeType),
  );
  if (!hasAction) {
    blockers.push({
      type: BlockerType.EMPTY_PLAN,
      description: 'No included action nodes in resolved pathway — care plan would be empty',
      relatedNodeIds: [],
    });
  }

  // 2. Unresolved red flags (only block on unacknowledged ones)
  for (const flag of redFlags) {
    if (!flag.acknowledged) {
      blockers.push({
        type: BlockerType.UNRESOLVED_RED_FLAG,
        description: `Unresolved red flag: ${flag.description}`,
        relatedNodeIds: [flag.nodeId],
      });
    }
  }

  // 3. Pending gates guarding included subtrees
  for (const node of state.values()) {
    if (node.status === NodeStatus.PENDING_QUESTION) {
      blockers.push({
        type: BlockerType.PENDING_GATE,
        description: `Gate "${node.title}" has an unanswered question — subtree may contain relevant actions`,
        relatedNodeIds: [node.nodeId],
      });
    }
  }

  return blockers;
}

// ─── Generation ────────────────────────────────────────────────────

function buildIntervention(
  node: NodeResult,
  pathwayId: string,
  sessionId: string,
): CarePlanInterventionData {
  const interventionType = NODE_TYPE_TO_INTERVENTION[node.nodeType] ?? 'MONITORING';
  const source: 'pathway_recommendation' | 'provider_override' =
    node.providerOverride ? 'provider_override' : 'pathway_recommendation';

  const intervention: CarePlanInterventionData = {
    type: interventionType,
    description: node.title,
    recommendationConfidence: node.confidence,
    source,
    pathwayNodeId: node.nodeId,
    pathwayId,
    sessionId,
  };

  // Extract type-specific properties
  if (node.nodeType === 'Medication') {
    intervention.medicationCode = prop(node, 'medication_code') ?? prop(node, 'code');
    intervention.dosage = prop(node, 'dosage') ?? prop(node, 'dose');
    intervention.frequency = prop(node, 'frequency');
  } else if (node.nodeType === 'Procedure') {
    intervention.procedureCode = prop(node, 'procedure_code') ?? prop(node, 'code');
  } else if (node.nodeType === 'Referral') {
    intervention.referralSpecialty = prop(node, 'specialty') ?? prop(node, 'referral_specialty');
  }

  const instructions = prop(node, 'patient_instructions');
  if (instructions) intervention.patientInstructions = instructions;

  const guideline = prop(node, 'guideline_reference');
  if (guideline) intervention.guidelineReference = guideline;

  return intervention;
}

export function generateCarePlan(
  state: ResolutionState,
  pathwayId: string,
  sessionId: string,
): CarePlanData {
  const goals: CarePlanGoalData[] = [];
  const interventions: CarePlanInterventionData[] = [];
  // Collect condition codes only from INCLUDED nodes
  const conditionCodeSet = new Set<string>();
  for (const node of state.values()) {
    if (!isIncluded(node)) continue;
    const codes = node.properties?.condition_codes;
    if (Array.isArray(codes)) {
      for (const c of codes) {
        if (typeof c === 'string') {
          conditionCodeSet.add(c);
        }
      }
    }
  }
  const conditionCodes = [...conditionCodeSet];

  // Build goals from included Stage nodes that have action descendants
  for (const node of state.values()) {
    if (node.nodeType !== 'Stage' || !isIncluded(node)) continue;
    if (!stageHasIncludedActions(node.nodeId, state)) continue;

    goals.push({
      description: node.title,
      priority: 'HIGH',
      guidelineReference: prop(node, 'guideline_reference'),
      pathwayNodeId: node.nodeId,
    });
  }

  // Build interventions from included action nodes
  for (const node of state.values()) {
    if (!isActionNode(node.nodeType) || !isIncluded(node)) continue;
    interventions.push(buildIntervention(node, pathwayId, sessionId));
  }

  return { conditionCodes, goals, interventions };
}
