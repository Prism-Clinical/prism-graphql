// apps/pathway-service/src/services/compiler/kinds.ts
import type { EdgeKind, NodeKind } from './model';

const NODE_KINDS: Record<string, NodeKind> = {
  Stage: 'container', Step: 'container',
  Gate: 'gate', DecisionPoint: 'choice',
  Medication: 'action', LabTest: 'action', Imaging: 'action', Procedure: 'action', Guidance: 'action',
  Schedule: 'item', QualityMetric: 'item',
  Criterion: 'annotation', EvidenceCitation: 'annotation', CodeEntry: 'annotation',
};

/** Spec §3.2. `null` for a type no pathway may contain. */
export function nodeKindOf(type: string, properties: Record<string, unknown>): NodeKind | null {
  if (type === 'Pathway') return 'root';
  const kind = NODE_KINDS[type] ?? null;
  if (type === 'Medication' && (properties.role === 'contraindicated' || properties.role === 'avoid')) return 'constraint';
  return kind;
}

const EDGE_KINDS: Record<string, EdgeKind> = {
  HAS_STAGE: 'contains', HAS_STEP: 'contains', HAS_GATE: 'contains', HAS_DECISION_POINT: 'contains',
  USES_MEDICATION: 'contains', HAS_LAB_TEST: 'contains', HAS_IMAGING: 'contains', HAS_PROCEDURE: 'contains',
  HAS_GUIDANCE: 'contains', HAS_SCHEDULE: 'contains', HAS_QUALITY_METRIC: 'contains',
  BRANCHES_TO: 'guards',
  HAS_CRITERION: 'owns', CITES_EVIDENCE: 'owns', HAS_CODE: 'owns',
  SELECTS_BRANCH: 'references',
  REQUIRES: 'prerequisite',
  ESCALATES_TO: 'alternative',
};

/** Spec §3.3. `null` for an edge type the compiler does not know. */
export function edgeKindOf(type: string): EdgeKind | null {
  return EDGE_KINDS[type] ?? null;
}
