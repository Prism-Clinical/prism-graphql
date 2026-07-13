import {
  NodeStatus,
  SessionStatus,
  OverrideAction,
  AnswerType,
  BlockerType,
  GateType,
  DefaultBehavior,
} from '../../types';
import {
  GraphNode,
  GraphEdge,
  GraphContext,
  PatientContext,
  SignalBreakdown,
  ResolvedThresholds,
  NodeConfidenceResult,
} from '../confidence/types';

export {
  NodeStatus,
  SessionStatus,
  OverrideAction,
  AnswerType,
  BlockerType,
  GateType,
  DefaultBehavior,
};

// ─── Node Result ────────────────────────────────────────────────────

export interface ProviderOverride {
  action: OverrideAction;
  reason?: string;
  originalStatus: NodeStatus;
  originalConfidence: number;
}

export interface NodeResult {
  nodeId: string;
  nodeType: string;
  title: string;
  status: NodeStatus;
  confidence: number;
  confidenceBreakdown: SignalBreakdown[];
  excludeReason?: string;
  providerOverride?: ProviderOverride;
  parentNodeId?: string;
  depth: number;
  /** Carried from GraphNode.properties for care plan generation */
  properties?: Record<string, unknown>;
}

// ─── Resolution State ───────────────────────────────────────────────

export type ResolutionState = Map<string, NodeResult>;

export interface DependencyMap {
  influencedBy: Map<string, Set<string>>;
  influences: Map<string, Set<string>>;
  gateContextFields: Map<string, Set<string>>;
  scorerInputs: Map<string, Set<string>>;
}

export function createEmptyDependencyMap(): DependencyMap {
  return {
    influencedBy: new Map(),
    influences: new Map(),
    gateContextFields: new Map(),
    scorerInputs: new Map(),
  };
}

// ─── Gate Evaluation ────────────────────────────────────────────────

export type CodedOperator =
  | 'includes_code' | 'equals' | 'exists'
  | 'greater_than' | 'less_than'
  | 'count_in_window' | 'trend_up' | 'trend_down' | 'delta_from_baseline';

export type AttributeOperator =
  | 'equals' | 'not_equals'
  | 'greater_than' | 'greater_or_equal' | 'less_than' | 'less_or_equal'
  | 'in' | 'exists';

export const VALID_CODED_OPERATORS = [
  'includes_code', 'equals', 'exists',
  'greater_than', 'less_than',
  'count_in_window', 'trend_up', 'trend_down', 'delta_from_baseline',
] as const satisfies readonly CodedOperator[];

export const VALID_ATTRIBUTE_OPERATORS = [
  'equals', 'not_equals',
  'greater_than', 'greater_or_equal', 'less_than', 'less_or_equal',
  'in', 'exists',
] as const satisfies readonly AttributeOperator[];

export interface CodedCondition {
  field: 'conditions' | 'medications' | 'allergies' | 'labs' | 'vitals';
  operator: CodedOperator;
  value: string;
  system?: string;
  threshold?: number;
  window_days?: number;
  count_threshold?: number;
  min_points?: number;
  slope_threshold?: number;
  delta_threshold?: number;
  display?: string; // UI decorator — ignored by the evaluator
  note?: string;    // UI decorator — ignored by the evaluator
}

export interface AttributeCondition {
  attribute: string;
  operator: AttributeOperator;
  value: string | number | boolean | Array<string | number>;
  unit?: string;
  display?: string; // UI decorator
  note?: string;    // UI decorator
}

export type GateCondition = CodedCondition | AttributeCondition;

export function isAttributeCondition(c: GateCondition): c is AttributeCondition {
  return typeof (c as AttributeCondition).attribute === 'string';
}

export interface AttributeCodeEntry {
  attributeName: string;
  namespace: string;
  system: string;
  code: string;
  valueType: 'number' | 'boolean' | 'string';
}

export type AttributeCodeMap = Map<string, AttributeCodeEntry>;

export interface GateDependsOn {
  node_id: string;
  status: string;
}

/**
 * Declared branch for an LLM-evaluated gate. `is_safe_default: true` marks
 * the branch the gate falls back to when the LLM's confidence is below the
 * authored threshold (or when the LLM call itself fails / is misconfigured).
 * Exactly one branch should have is_safe_default=true; if none do, the
 * evaluator uses the first branch.
 */
export interface LlmGateBranchSpec {
  name: string;
  description: string;
  is_safe_default?: boolean;
}

export interface GateProperties {
  title: string;
  gate_type: GateType;
  default_behavior: DefaultBehavior;
  condition?: GateCondition;
  prompt?: string;
  answer_type?: AnswerType;
  options?: string[];
  depends_on?: GateDependsOn[];
  operator?: 'AND' | 'OR';
  conditions?: GateCondition[];

  // ─── llm_text_analysis-specific ───────────────────────────────────
  /**
   * Dotted path into patientContext (typically into `freeformData`) that
   * holds the narrative text the LLM should analyze. Examples:
   *   - 'freeformData.narrative.chief_complaint'
   *   - 'freeformData.history_of_present_illness'
   */
  input_attribute?: string;
  /** Declared branches the LLM must pick from. */
  branches?: LlmGateBranchSpec[];
  /**
   * Below this self-reported confidence the gate is marked `tentative` —
   * routes the safe-default branch but surfaces as a pending question for
   * provider confirmation. Defaults to 0.75 if not declared.
   */
  confidence_threshold?: number;
}

export interface GateAnswer {
  booleanValue?: boolean;
  numericValue?: number;
  selectedOption?: string;
}

export interface GateEvaluationResult {
  satisfied: boolean;
  reason: string;
  contextFieldsRead: string[];
  dependedOnNodes: string[];

  // ─── LLM gate annotations ─────────────────────────────────────────
  /**
   * True when the gate was resolved by an LLM call whose confidence fell
   * below the authored threshold. Traversal proceeds on the safe-default
   * branch (satisfied is set accordingly) but the gate is also surfaced as
   * a pending question for the provider to confirm or change.
   */
  tentative?: boolean;
  /** The branch the LLM (or fallback) actually picked, by name. */
  chosenBranch?: string;
  /** Self-reported confidence in [0, 1] when the LLM evaluated this gate. */
  llmConfidence?: number;
  /** Short rationale string from the LLM for the audit trail / UI popout. */
  llmReasoning?: string;
}

// ─── Pending Questions ──────────────────────────────────────────────

export interface PendingQuestion {
  gateId: string;
  prompt: string;
  answerType: AnswerType;
  options?: string[];
  affectedSubtreeSize: number;
  estimatedImpact: string;

  // ─── LLM-tentative metadata ───────────────────────────────────────
  /** True when the question was surfaced because an LLM gate fell below threshold. */
  tentative?: boolean;
  /** The branch the LLM picked (already routed; provider can confirm or flip). */
  tentativeBranch?: string;
  /** Self-reported confidence in [0, 1] from the LLM. */
  tentativeConfidence?: number;
  /** LLM reasoning shown to the provider so they can decide whether to override. */
  tentativeReasoning?: string;
}

// ─── Red Flags ──────────────────────────────────────────────────────

export interface RedFlagBranch {
  nodeId: string;
  title: string;
  confidence: number;
  topExcludeReason: string;
}

export type RedFlagType = 'all_branches_excluded' | 'contradiction' | 'missing_critical_data';

export interface RedFlag {
  nodeId: string;
  nodeTitle: string;
  type: RedFlagType;
  description: string;
  branches?: RedFlagBranch[];
  acknowledged?: boolean;
}

// ─── Resolution Event ───────────────────────────────────────────────

export interface ResolutionEvent {
  id?: string;
  eventType: string;
  triggerData: Record<string, unknown>;
  nodesRecomputed: number;
  statusChanges: Array<{ nodeId: string; from: string; to: string }>;
  createdAt?: Date;
}

// ─── Session ────────────────────────────────────────────────────────

export interface ResolutionSession {
  id: string;
  pathwayId: string;
  pathwayVersion: string;
  patientId: string;
  providerId: string;
  status: SessionStatus;
  resolutionState: ResolutionState;
  dependencyMap: DependencyMap;
  initialPatientContext: PatientContext;
  additionalContext: Record<string, unknown>;
  pendingQuestions: PendingQuestion[];
  redFlags: RedFlag[];
  resolutionEvents: ResolutionEvent[];
  gateAnswers: Map<string, GateAnswer>;
  totalNodesEvaluated: number;
  traversalDurationMs: number;
  carePlanId?: string;
  /** Phase 4: DDI MODERATE-severity findings persisted with the session. */
  ddiWarnings: unknown[];
  createdAt: Date;
  updatedAt: Date;
}

// ─── Traversal Result ───────────────────────────────────────────────

export interface TraversalResult {
  resolutionState: ResolutionState;
  dependencyMap: DependencyMap;
  pendingQuestions: PendingQuestion[];
  redFlags: RedFlag[];
  totalNodesEvaluated: number;
  traversalDurationMs: number;
  isDegraded: boolean;
}

// ─── Re-Traversal Result ────────────────────────────────────────────

export interface RetraversalResult {
  statusChanges: Array<{ nodeId: string; from: string; to: string }>;
  nodesRecomputed: number;
  newPendingQuestions: PendingQuestion[];
  newRedFlags: RedFlag[];
  isIncomplete?: boolean;
}

// ─── Care Plan Generation ───────────────────────────────────────────

export interface ValidationBlocker {
  type: BlockerType;
  description: string;
  relatedNodeIds: string[];
}

export interface CarePlanGenerationResult {
  success: boolean;
  carePlanId?: string;
  warnings: string[];
  blockers: ValidationBlocker[];
}

// ─── Matched Pathway (Phase 1b) ─────────────────────────────────────

export interface MatchedCodeSetMember {
  code: string;
  system: string;
}

export interface MatchedCodeSet {
  setId: string;
  description: string | null;
  scope: string;
  entryNodeId: string | null;
  members: MatchedCodeSetMember[];
  memberCount: number;
}

export interface MatchedPathway {
  pathway: {
    id: string;
    logicalId: string;
    title: string;
    version: string;
    category: string;
    status: string;
    conditionCodes: string[];
  };
  matched: true;
  matchedSets: MatchedCodeSet[];
  mostSpecificMatchedSet: MatchedCodeSet;
  specificityDepth: number;
  patientCodesAddressed: string[];
  patientCodesUnaddressed: string[];
  matchScore: number;
  matchedConditionCodes: string[];
}

// ─── Traversal Confidence Adapter ───────────────────────────────────

export interface TraversalConfidenceAdapter {
  computeNodeConfidence: (
    node: GraphNode,
    graphContext: GraphContext,
    patientContext: PatientContext,
  ) => Promise<NodeConfidenceResult>;
}

// ─── Constants ──────────────────────────────────────────────────────

export const TRAVERSAL_TIMEOUT_MS = 10_000;
export const RETRAVERSAL_TIMEOUT_MS = 5_000;
export const MAX_CASCADE_DEPTH = 10;

/** Node types that are structural (always traversed, confidence is aggregate) */
export const STRUCTURAL_NODE_TYPES = new Set(['Stage', 'Step']);

/** Node types that are action nodes (included/excluded based on confidence).
 *  Monitoring, Lifestyle, Referral are forward-looking — not yet in PathwayNodeType
 *  (import schema). They will be added when pathways use them. The traversal engine
 *  handles them already so no code change is needed when they appear. */
export const ACTION_NODE_TYPES = new Set([
  'Medication', 'LabTest', 'Imaging', 'Procedure', 'Guidance',
  'Monitoring', 'Lifestyle', 'Referral',
]);
