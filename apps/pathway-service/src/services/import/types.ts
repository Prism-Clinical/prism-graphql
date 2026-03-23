// apps/pathway-service/src/services/import/types.ts

// ─── Pathway JSON Schema ─────────────────────────────────────────────
// This is the shape of the JSON that gets POSTed to the import endpoint.
// AI systems produce this from doctor-authored pathway content.

export interface PathwayJson {
  schema_version: string;
  pathway: PathwayMetadata;
  nodes: PathwayNodeDefinition[];
  edges: PathwayEdgeDefinition[];
}

export interface PathwayMetadata {
  logical_id: string;
  title: string;
  version: string;
  category: string;
  scope?: string;
  target_population?: string;
  condition_codes: ConditionCodeDefinition[];
}

export interface ConditionCodeDefinition {
  code: string;
  system: string;
  description?: string;
  usage?: string;
  grouping?: string;
}

// All valid node types in the graph
export type PathwayNodeType =
  | 'Stage'
  | 'Step'
  | 'DecisionPoint'
  | 'Criterion'
  | 'CodeEntry'
  | 'Medication'
  | 'LabTest'
  | 'Procedure'
  | 'EvidenceCitation'
  | 'QualityMetric'
  | 'Schedule';

export interface PathwayNodeDefinition {
  id: string;
  type: PathwayNodeType;
  properties: Record<string, unknown>;
}

// All valid edge types in the graph
export type PathwayEdgeType =
  | 'HAS_STAGE'
  | 'HAS_STEP'
  | 'HAS_DECISION_POINT'
  | 'HAS_CRITERION'
  | 'BRANCHES_TO'
  | 'USES_MEDICATION'
  | 'ESCALATES_TO'
  | 'CITES_EVIDENCE'
  | 'HAS_LAB_TEST'
  | 'HAS_PROCEDURE'
  | 'HAS_QUALITY_METRIC'
  | 'HAS_SCHEDULE'
  | 'HAS_CODE';

export interface PathwayEdgeDefinition {
  from: string;          // node id or "root" for the Pathway root node
  to: string;            // node id
  type: PathwayEdgeType;
  properties?: Record<string, unknown>;
}

// ─── Required Properties Per Node Type ───────────────────────────────
// Used by the validator to check that each node has the right properties.

export const REQUIRED_NODE_PROPERTIES: Record<PathwayNodeType, string[]> = {
  Stage:            ['stage_number', 'title'],
  Step:             ['stage_number', 'step_number', 'display_number', 'title'],
  DecisionPoint:    ['title'],
  Criterion:        ['description'],
  CodeEntry:        ['system', 'code'],
  Medication:       ['name', 'role'],
  LabTest:          ['name'],
  Procedure:        ['name'],
  EvidenceCitation: ['reference_number', 'title', 'evidence_level'],
  QualityMetric:    ['name', 'measure'],
  Schedule:         ['interval', 'description'],
};

// Valid edge source→target type constraints
export const VALID_EDGE_ENDPOINTS: Record<PathwayEdgeType, { from: ('root' | PathwayNodeType)[]; to: PathwayNodeType[] }> = {
  HAS_STAGE:           { from: ['root'],           to: ['Stage'] },
  HAS_STEP:            { from: ['Stage'],           to: ['Step'] },
  HAS_DECISION_POINT:  { from: ['Step'],            to: ['DecisionPoint'] },
  HAS_CRITERION:       { from: ['DecisionPoint'],   to: ['Criterion'] },
  BRANCHES_TO:         { from: ['DecisionPoint'],   to: ['Step', 'Stage'] },
  USES_MEDICATION:     { from: ['Step'],            to: ['Medication'] },
  ESCALATES_TO:        { from: ['Medication'],      to: ['Medication'] },
  CITES_EVIDENCE:      { from: ['Stage', 'Step', 'DecisionPoint', 'Criterion', 'Medication', 'LabTest', 'Procedure'], to: ['EvidenceCitation'] },
  HAS_LAB_TEST:        { from: ['Step'],            to: ['LabTest'] },
  HAS_PROCEDURE:       { from: ['Step'],            to: ['Procedure'] },
  HAS_QUALITY_METRIC:  { from: ['Step'],            to: ['QualityMetric'] },
  HAS_SCHEDULE:        { from: ['Step'],            to: ['Schedule'] },
  HAS_CODE:            { from: ['Step', 'Criterion', 'Medication', 'LabTest', 'Procedure'], to: ['CodeEntry'] },
};

// Valid code systems for ConditionCodeDefinition and CodeEntry nodes
export const VALID_CODE_SYSTEMS = ['ICD-10', 'SNOMED', 'RXNORM', 'LOINC', 'CPT'] as const;

// Valid medication roles
export const VALID_MEDICATION_ROLES = ['preferred', 'acceptable', 'avoid', 'contraindicated'] as const;

// Valid evidence levels
export const VALID_EVIDENCE_LEVELS = ['Level A', 'Level B', 'Level C', 'Expert Consensus'] as const;

// Graph size limits (enforced at import time per spec)
export const MAX_GRAPH_DEPTH = 50;
export const MAX_GRAPH_NODES = 500;
export const MAX_GRAPH_EDGES = 2000;

// ─── Import Pipeline Types ───────────────────────────────────────────

// ImportMode is defined as an enum in src/types/index.ts — import from there.
// Do NOT define a duplicate here.
import { ImportMode } from '../../types';
export { ImportMode };

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export interface ImportDiffSummary {
  nodesAdded: number;
  nodesRemoved: number;
  nodesModified: number;
  edgesAdded: number;
  edgesRemoved: number;
  edgesModified: number;
}

export interface DiffDetail {
  entityType: 'node' | 'edge';
  action: 'added' | 'removed' | 'modified';
  entityId: string;
  entityLabel: string;
  changes?: PropertyChange[];
}

export interface PropertyChange {
  property: string;
  oldValue: unknown;
  newValue: unknown;
}

export interface ImportResult {
  pathwayId: string;
  ageNodeId: string | null;
  logicalId: string;
  version: string;
  status: string;
  validation: ValidationResult;
  diff: {
    summary: ImportDiffSummary;
    details: DiffDetail[];
    /** True when the diff is a placeholder (e.g., creation summary or failed reconstruction). */
    synthetic: boolean;
  } | null;
  importType: ImportMode;
}
