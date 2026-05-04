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
  /**
   * Phase 1b: explicit set-based authoring. Optional — when present, each
   * entry becomes one row in `pathway_code_sets` plus N rows in
   * `pathway_code_set_members`. When absent, the import pipeline synthesizes
   * one set per code in `condition_codes` (legacy disjunction semantic).
   */
  code_sets?: CodeSetDefinition[];
}

export interface ConditionCodeDefinition {
  code: string;
  system: string;
  description?: string;
  usage?: string;
  grouping?: string;
}

// ─── Phase 1b: Code Set authoring types ─────────────────────────────

/** JSON-side: the author's declaration of one code set within a pathway. */
export interface CodeSetDefinition {
  /** Author-facing label, e.g. "T2DM with hypertension". */
  description?: string;
  /** Default scope applied to every member; defaults to EXACT. */
  scope?: CodeSetScope;
  /** AGE node_id where this set's match should route resolution. */
  entry_node_id?: string;
  /**
   * Member codes that must ALL be present in the patient's expanded code
   * set for this set to match. Cross-system conjunctions are supported by
   * letting each member declare its own system.
   */
  required_codes: CodeSetMemberDefinition[];
}

export interface CodeSetMemberDefinition {
  code: string;
  system: string;
  /** Per-code scope override; null/undefined = inherit from CodeSetDefinition.scope. */
  scope_override?: CodeSetScope;
  /** Per-code authoring note. */
  description?: string;
}

export type CodeSetScope = 'EXACT' | 'EXACT_AND_DESCENDANTS' | 'DESCENDANTS_OK';

export const VALID_CODE_SET_SCOPES: CodeSetScope[] = [
  'EXACT',
  'EXACT_AND_DESCENDANTS',
  'DESCENDANTS_OK',
];

// ─── Phase 1b: DB row types (used by writers and readers) ────────────

export interface PathwayCodeSetRow {
  id: string;
  pathway_id: string;
  scope: CodeSetScope;
  semantics: 'ALL_OF';
  entry_node_id: string | null;
  description: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface PathwayCodeSetMemberRow {
  id: string;
  code_set_id: string;
  code: string;
  system: string;
  scope_override: CodeSetScope | null;
  description: string | null;
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
  | 'Schedule'
  | 'Gate';

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
  | 'HAS_CODE'
  | 'HAS_GATE';

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
  Gate:             ['title', 'gate_type', 'default_behavior'],
};

// Valid edge source→target type constraints
export const VALID_EDGE_ENDPOINTS: Record<PathwayEdgeType, { from: ('root' | PathwayNodeType)[]; to: PathwayNodeType[] }> = {
  HAS_STAGE:           { from: ['root'],           to: ['Stage'] },
  HAS_STEP:            { from: ['Stage'],           to: ['Step'] },
  HAS_DECISION_POINT:  { from: ['Step'],            to: ['DecisionPoint'] },
  HAS_CRITERION:       { from: ['DecisionPoint'],   to: ['Criterion'] },
  BRANCHES_TO:         { from: ['DecisionPoint', 'Gate'], to: ['Step', 'Stage'] },
  USES_MEDICATION:     { from: ['Step'],            to: ['Medication'] },
  ESCALATES_TO:        { from: ['Medication'],      to: ['Medication'] },
  CITES_EVIDENCE:      { from: ['Stage', 'Step', 'DecisionPoint', 'Criterion', 'Medication', 'LabTest', 'Procedure'], to: ['EvidenceCitation'] },
  HAS_LAB_TEST:        { from: ['Step'],            to: ['LabTest'] },
  HAS_PROCEDURE:       { from: ['Step'],            to: ['Procedure'] },
  HAS_QUALITY_METRIC:  { from: ['Step'],            to: ['QualityMetric'] },
  HAS_SCHEDULE:        { from: ['Step'],            to: ['Schedule'] },
  HAS_CODE:            { from: ['Step', 'Criterion', 'Medication', 'LabTest', 'Procedure'], to: ['CodeEntry'] },
  HAS_GATE:            { from: ['Step', 'Stage', 'DecisionPoint'], to: ['Gate'] },
};

// Valid code systems for ConditionCodeDefinition and CodeEntry nodes
export const VALID_CODE_SYSTEMS = ['ICD-10', 'SNOMED', 'RXNORM', 'LOINC', 'CPT'] as const;

// Valid medication roles
export const VALID_MEDICATION_ROLES = [
  'first_line', 'second_line', 'alternative',
  'preferred', 'acceptable', 'avoid', 'contraindicated',
] as const;

// Valid evidence levels
export const VALID_EVIDENCE_LEVELS = [
  'A', 'B', 'C',
  'Level A', 'Level B', 'Level C', 'Expert Consensus',
] as const;

// Graph size limits (enforced at import time per spec)
export const MAX_GRAPH_DEPTH = 50;
export const MAX_GRAPH_NODES = 500;
export const MAX_GRAPH_EDGES = 5000;

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
