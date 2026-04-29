import type {
  PathwayGraphNode,
  PathwayGraphEdge,
  NodeConfidenceResult,
  ResolutionType,
} from '@/types';

// ─── Phase Enum ──────────────────────────────────────────────────────

export enum PreviewPhase {
  Configure = 1,
  Simulate = 2,
  Tune = 3,
}

// ─── Hierarchical View Types ─────────────────────────────────────────

export interface DecisionPointView {
  node: PathwayGraphNode;
  label: string;
  confidence?: NodeConfidenceResult;
  criteria: PathwayGraphNode[];
}

export interface PlanItemView {
  node: PathwayGraphNode;
  label: string;
  itemType: 'Medication' | 'LabTest' | 'Procedure';
  confidence?: NodeConfidenceResult;
}

export interface StepView {
  node: PathwayGraphNode;
  label: string;
  displayNumber: string;
  confidence?: NodeConfidenceResult;
  decisionPoints: DecisionPointView[];
  medications: PlanItemView[];
  labTests: PlanItemView[];
  procedures: PlanItemView[];
}

export interface StageView {
  node: PathwayGraphNode;
  label: string;
  stageNumber: number;
  confidence?: NodeConfidenceResult;
  steps: StepView[];
}

// ─── Sidebar Tab ─────────────────────────────────────────────────────

export type SidebarTab = 'context' | 'confidence' | 'evidence';
