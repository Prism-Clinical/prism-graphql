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

// ─── Multi-Pathway Resolution / Preview Session Types ────────────────
//
// Client-side shape matching the PREVIEW_MERGED_CARE_PLAN_FRAGMENT. When
// the time-shape gates PR lands, `evidenceGateIds` (per rec) and
// `evidenceTrail` / `dataGapHints` (on the merged plan) will be added
// here alongside their fragment fields.

export type RecommendationState =
  | 'AUTO_INCLUDED'
  | 'PENDING_PROVIDER_CHOICE'
  | 'PROVIDER_CONFIRMED'
  | 'PROVIDER_OVERRIDE';

export interface ResolvedMedication {
  name: string;
  role: string;
  dose: string | null;
  frequency: string | null;
  duration: string | null;
  route: string | null;
  clinicalRole: string | null;
  sourcePathwayId: string;
  sourceNodeId: string | null;
  /**
   * Gate/DP node ids the resolver evaluated on the way to including
   * this recommendation. Empty when the rec was included without any
   * gating decisions. Resolve into `MergedCarePlan.evidenceTrail` for
   * the gate title + patient fields consulted.
   */
  evidenceGateIds: string[];
}

export interface ResolvedLab {
  name: string;
  code: string | null;
  system: string | null;
  specimen: string | null;
  sourcePathwayId: string;
  sourceNodeId: string | null;
  evidenceGateIds: string[];
}

export interface ResolvedImaging {
  name: string;
  modality: string;
  bodyRegion: string | null;
  contrast: boolean | null;
  code: string | null;
  system: string | null;
  sourcePathwayId: string;
  sourceNodeId: string | null;
  evidenceGateIds: string[];
}

export interface ResolvedProcedure {
  name: string;
  code: string | null;
  system: string | null;
  sourcePathwayId: string;
  sourceNodeId: string | null;
  evidenceGateIds: string[];
}

export interface ResolvedGuidance {
  topic: string;
  instructions: string;
  category: string | null;
  sourcePathwayId: string;
  sourceNodeId: string | null;
  evidenceGateIds: string[];
}

export interface ResolvedSchedule {
  interval: string;
  description: string;
  sourcePathwayId: string;
  sourceNodeId: string | null;
  evidenceGateIds: string[];
}

export interface ResolvedQualityMetric {
  name: string;
  measure: string;
  sourcePathwayId: string;
  sourceNodeId: string | null;
  evidenceGateIds: string[];
}

export interface MergedRecommendation<T> {
  recommendation: T;
  sourcePathwayIds: string[];
  state: RecommendationState;
}

export interface SuppressedRecommendation {
  type: string;
  name: string;
  reason: string;
  suppressedByPathwayId: string | null;
  suppressedByPathwayTitle: string | null;
  suppressedByPatientMedRxcui: string | null;
  suppressedByPatientMedName: string | null;
  suppressedByAllergyCode: string | null;
  suppressedByAllergyDisplay: string | null;
}

export interface MergedConflictCandidate {
  recommendation: ResolvedMedication;
  sourcePathwayId: string;
  sourcePathwayTitle: string;
}

export interface MergedConflictResolution {
  kind: string;
  resolvedBy: string;
  resolvedAt: string;
  reason: string | null;
  chosenPathwayId: string | null;
}

export interface MergedConflict {
  conflictId: string;
  type: string;
  clinicalRole: string | null;
  candidates: MergedConflictCandidate[];
  resolution: MergedConflictResolution | null;
}

export interface CatchUpItem {
  nodeId: string;
  nodeType: string;
  title: string;
  dependentNodeId: string;
  reason: string;
  sourcePathwayId: string;
}

/**
 * One gate/DP the resolver evaluated on the way to this merged plan.
 * The `fieldsRead` list is what the UI shows on hover so providers can
 * see what patient data drove the decision.
 */
export interface GateEvidence {
  nodeId: string;
  title: string;
  kind: string;
  status: string;
  reason: string | null;
  fieldsRead: string[];
}

/**
 * A gated-out branch paired with the recommendations it *would* unlock
 * if the missing patient data were available. Used by the sidebar's
 * data-gap panel (slice D) to surface actionable "add X → unlocks N
 * recs" prompts.
 */
export interface UnlockedRecommendation {
  nodeId: string;
  nodeType: string;
  title: string;
}

export interface DataGapHint {
  gateNodeId: string;
  gateTitle: string;
  kind: string;
  status: string;
  reason: string | null;
  fieldsRead: string[];
  unlockedRecommendations: UnlockedRecommendation[];
}

export interface MergedCarePlan {
  sourcePathwayIds: string[];
  medications: MergedRecommendation<ResolvedMedication>[];
  labs: MergedRecommendation<ResolvedLab>[];
  imaging: MergedRecommendation<ResolvedImaging>[];
  procedures: MergedRecommendation<ResolvedProcedure>[];
  guidance: MergedRecommendation<ResolvedGuidance>[];
  schedules: MergedRecommendation<ResolvedSchedule>[];
  qualityMetrics: MergedRecommendation<ResolvedQualityMetric>[];
  suppressed: SuppressedRecommendation[];
  conflicts: MergedConflict[];
  catchUpItems: CatchUpItem[];
  evidenceTrail: GateEvidence[];
  dataGapHints: DataGapHint[];
}

export interface PreviewSession {
  id: string;
  patientId: string;
  providerId: string;
  status: string;
  isPreview: boolean;
  contributingPathwayIds: string[];
  contributingSessionIds: string[];
  mergedPlan: MergedCarePlan;
}

export interface DeletePreviewSessionResult {
  sessionId: string;
  contributingSessionsDeleted: number;
}
