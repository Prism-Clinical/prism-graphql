// Pathway types — mirrors pathway-service GraphQL schema

export type PathwayStatus = 'DRAFT' | 'ACTIVE' | 'ARCHIVED' | 'SUPERSEDED';

export type PathwayCategory =
  | 'CHRONIC_DISEASE'
  | 'ACUTE_CARE'
  | 'PREVENTIVE_CARE'
  | 'POST_PROCEDURE'
  | 'MEDICATION_MANAGEMENT'
  | 'LIFESTYLE_MODIFICATION'
  | 'MENTAL_HEALTH'
  | 'PEDIATRIC'
  | 'GERIATRIC'
  | 'OBSTETRIC';

export interface Pathway {
  id: string;
  logicalId: string;
  title: string;
  version: string;
  category: PathwayCategory;
  status: PathwayStatus;
  conditionCodes: string[];
  scope: string | null;
  targetPopulation: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export type ImportMode = 'NEW_PATHWAY' | 'DRAFT_UPDATE' | 'NEW_VERSION';

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
  entityType: string;
  action: string;
  entityId: string;
  entityLabel: string;
}

export interface ImportDiff {
  summary: ImportDiffSummary;
  details: DiffDetail[];
  synthetic: boolean;
}

export interface ImportPathwayResult {
  pathway: Pathway | null;
  validation: ValidationResult;
  diff: ImportDiff | null;
  importType: ImportMode;
}

export interface PathwayStatusResult {
  pathway: Pathway;
  previousStatus: PathwayStatus;
}

// ─── Graph Editor Types ─────────────────────────────────────────────

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

/** Data stored on each React Flow node */
export interface PathwayNodeData extends Record<string, unknown> {
  pathwayNodeType: PathwayNodeType;
  pathwayNodeId: string;
  label: string;
  properties: Record<string, unknown>;
}

/** Data stored on each React Flow edge */
export interface PathwayEdgeData extends Record<string, unknown> {
  pathwayEdgeType: PathwayEdgeType;
  properties?: Record<string, unknown>;
}

/** Valid edge endpoint constraints — mirrors backend VALID_EDGE_ENDPOINTS */
export const VALID_EDGE_ENDPOINTS: Record<PathwayEdgeType, { from: ('root' | PathwayNodeType)[]; to: PathwayNodeType[] }> = {
  HAS_STAGE:          { from: ['root'],          to: ['Stage'] },
  HAS_STEP:           { from: ['Stage'],          to: ['Step'] },
  HAS_DECISION_POINT: { from: ['Step'],           to: ['DecisionPoint'] },
  HAS_CRITERION:      { from: ['DecisionPoint'],  to: ['Criterion'] },
  BRANCHES_TO:        { from: ['DecisionPoint'],  to: ['Step', 'Stage'] },
  USES_MEDICATION:    { from: ['Step'],           to: ['Medication'] },
  ESCALATES_TO:       { from: ['Medication'],     to: ['Medication'] },
  CITES_EVIDENCE:     { from: ['Stage', 'Step', 'DecisionPoint', 'Criterion', 'Medication', 'LabTest', 'Procedure'], to: ['EvidenceCitation'] },
  HAS_LAB_TEST:       { from: ['Step'],           to: ['LabTest'] },
  HAS_PROCEDURE:      { from: ['Step'],           to: ['Procedure'] },
  HAS_QUALITY_METRIC: { from: ['Step'],           to: ['QualityMetric'] },
  HAS_SCHEDULE:       { from: ['Step'],           to: ['Schedule'] },
  HAS_CODE:           { from: ['Step', 'Criterion', 'Medication', 'LabTest', 'Procedure'], to: ['CodeEntry'] },
};

/** Required properties per node type — mirrors backend REQUIRED_NODE_PROPERTIES */
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

// ─── PathwayJson Types (for serializer output) ─────────────────────

export interface ConditionCodeDefinition {
  code: string;
  system: string;
  description?: string;
  usage?: string;
  grouping?: string;
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

export interface PathwayNodeDefinition {
  id: string;
  type: PathwayNodeType;
  properties: Record<string, unknown>;
}

export interface PathwayEdgeDefinition {
  from: string;
  to: string;
  type: PathwayEdgeType;
  properties?: Record<string, unknown>;
}

export interface PathwayJson {
  schema_version: string;
  pathway: PathwayMetadata;
  nodes: PathwayNodeDefinition[];
  edges: PathwayEdgeDefinition[];
}

// ─── PathwayGraph Query Response Types ──────────────────────────────

export interface PathwayGraphNode {
  id: string;
  type: string;
  properties: Record<string, unknown>;
}

export interface PathwayGraphEdge {
  from: string;
  to: string;
  type: string;
  properties?: Record<string, unknown>;
}

export interface PathwayGraph {
  pathway: Pathway;
  nodes: PathwayGraphNode[];
  edges: PathwayGraphEdge[];
  conditionCodeDetails: ConditionCodeDefinition[];
}

// ─── Confidence / Preview Types ──────────────────────────────────────

export type ResolutionType = 'AUTO_RESOLVED' | 'SYSTEM_SUGGESTED' | 'PROVIDER_DECIDED' | 'FORCED_MANUAL';

export interface SignalBreakdown {
  signalName: string;
  score: number;
  weight: number;
  weightSource: string;
  missingInputs: string[];
}

export interface PropagationInfluence {
  sourceNodeIdentifier: string;
  signalName: string;
  originalScore: number;
  propagatedScore: number;
  hopDistance: number;
}

export interface NodeConfidenceResult {
  nodeIdentifier: string;
  nodeType: string;
  confidence: number;
  resolutionType: ResolutionType;
  breakdown: SignalBreakdown[];
  propagationInfluences?: PropagationInfluence[];
}

export interface PathwayConfidenceResult {
  pathwayId: string;
  overallConfidence: number;
  nodes: NodeConfidenceResult[];
}

export interface CodeInput {
  code: string;
  system: string;
  display?: string;
}

export interface LabResultInput {
  code: string;
  system: string;
  value?: number;
  unit?: string;
  date?: string;
  display?: string;
}

export interface PatientContextInput {
  patientId: string;
  conditionCodes: CodeInput[];
  medications: CodeInput[];
  labResults: LabResultInput[];
  allergies: CodeInput[];
  vitalSigns?: Record<string, unknown>;
}

// ─── Admin Evidence Types ────────────────────────────────────────────

export interface AdminEvidenceEntry {
  id: string;
  pathwayId: string;
  nodeIdentifier: string;
  title: string;
  source: string | null;
  year: number | null;
  evidenceLevel: string;
  url: string | null;
  notes: string | null;
  applicableCriteria: string[] | null;
  populationDescription: string | null;
  createdBy: string | null;
  createdAt: string;
}

export interface AddAdminEvidenceInput {
  pathwayId: string;
  nodeIdentifier: string;
  title: string;
  source?: string;
  year?: number;
  evidenceLevel: string;
  url?: string;
  notes?: string;
  applicableCriteria?: string[];
  populationDescription?: string;
}

// ─── Admin Configuration Types ──────────────────────────────────────

export type ScoringType = 'DATA_PRESENCE' | 'MAPPING_LOOKUP' | 'CRITERIA_MATCH' | 'RISK_INVERSE' | 'CUSTOM_RULES';
export type SignalScope = 'SYSTEM' | 'ORGANIZATION' | 'INSTITUTION';
export type WeightScope = 'NODE' | 'PATHWAY' | 'INSTITUTION_GLOBAL' | 'ORGANIZATION_GLOBAL';
export type ThresholdScope = 'SYSTEM_DEFAULT' | 'ORGANIZATION' | 'INSTITUTION' | 'PATHWAY' | 'NODE';
export type WeightSource = 'NODE_OVERRIDE' | 'PATHWAY_OVERRIDE' | 'INSTITUTION_GLOBAL' | 'ORGANIZATION_GLOBAL' | 'SYSTEM_DEFAULT';

export interface SignalDefinitionInfo {
  id: string;
  name: string;
  displayName: string;
  description: string | null;
  scoringType: ScoringType;
  defaultWeight: number;
  isActive: boolean;
}

export interface EffectiveWeightEntry {
  nodeIdentifier: string;
  signalName: string;
  weight: number;
  source: WeightSource;
}

export interface SetSignalWeightInput {
  signalDefinitionId: string;
  weight: number;
  scope: WeightScope;
  pathwayId?: string;
  nodeIdentifier?: string;
  nodeType?: string;
  institutionId?: string;
}

export interface SetResolutionThresholdsInput {
  autoResolveThreshold: number;
  suggestThreshold: number;
  scope: ThresholdScope;
  pathwayId?: string;
  nodeIdentifier?: string;
  institutionId?: string;
}

export interface ResolvedThresholds {
  autoResolveThreshold: number;
  suggestThreshold: number;
  scope: ThresholdScope;
}
