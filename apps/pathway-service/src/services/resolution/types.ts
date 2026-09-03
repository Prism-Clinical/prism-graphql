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
// Acyclic: temporal/evaluation-context.ts imports only ./overlap and
// ./interval, neither of which imports types.ts. Keep it that way — do not
// import types.ts from the temporal module.
import { EvaluationTemporalContext } from './temporal/evaluation-context';
// contract.ts imports nothing at all, so this stays acyclic too.
import type { UncertaintyReason } from './temporal/contract';

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
  /**
   * True when the gate could not reach a definite answer — the datum was
   * absent, undated where a horizon required a date, or otherwise unorderable.
   * Distinct from a condition that evaluated definitely false.
   *
   * A REASON channel, not an outcome channel: `status` still says what the
   * traversal did with the gate. Collapsing the two would make "pending
   * because nobody answered" and "pending because the chart is silent" the
   * same value again, which is the bug this field exists to fix.
   *
   * Only the `kernel` evaluation mode (`v1`) computes this; under `legacy-v0`
   * it is always undefined.
   */
  indeterminate?: boolean;
  /** Human-readable why, when `indeterminate` is true. */
  uncertaintyReason?: string;
  /**
   * A scalar comparison on this gate had no usable value to read. The OTHER
   * half of "the gate did not answer", and in practice the common half:
   * `indeterminate` needs conflicting facts, this needs none at all.
   *
   * Kept separate from `indeterminate` rather than merged into one "unresolved"
   * flag because the two want different prompts — "which of these results
   * applies?" versus "what is this patient's haemoglobin?".
   */
  dataUnavailable?: boolean;
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
  /**
   * NODE tier of the temporal cascade (plan 04, D1). Typed as `unknown` on
   * purpose: these arrive off untyped AGE JSON and are validated at runtime by
   * `parseConditionOverride`, so a declared `Horizon` here would assert a
   * guarantee the boundary does not provide.
   */
  horizon?: unknown;
  status?: unknown;
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
  /**
   * NODE tier of the temporal cascade, exactly as on `CodedCondition`.
   *
   * The import validator has accepted these on attribute conditions since
   * `ATTRIBUTE_KEYS` gained them, `adaptAttributeCondition` reads them through
   * `parseConditionOverride`, and the `v1` anchor sweep parses them — but the
   * type declared neither, so every caller constructing one had to cast, and a
   * cast is exactly what stops the compiler noticing the next omission.
   *
   * Typed `unknown` deliberately, for the same reason `CodedCondition` is:
   * these arrive off untyped AGE JSON and are validated at runtime, so a
   * declared `Horizon` here would assert a guarantee the boundary does not
   * provide.
   */
  horizon?: unknown;
  status?: unknown;
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
  /**
   * What to do when the gate CANNOT ANSWER — `indeterminate` (candidate facts
   * exist but cannot be ordered) or `dataUnavailable` (a scalar comparison had
   * no usable value). Absent means `'ask'`.
   *
   *   `'ask'`     — surface a pending question for the datum and hold the
   *                 subtree, exactly as an unanswered question gate does.
   *   `'default'` — apply `default_behavior`, which is what every gate did
   *                 before this existed.
   *
   * A gate that ANSWERED never consults this, including one that answered
   * "no". Only genuine inability to decide does — that distinction is the
   * whole point, and `default_behavior` is not a substitute for it.
   */
  on_unresolved?: 'ask' | 'default';
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

  // ─── Temporal uncertainty (plan 04, D5) ───────────────────────────
  /**
   * Uncertainty *could have prevented a definitive outcome*. Governed by the
   * compound truth table; false whenever the gate's answer is certain.
   *
   * Independent of `uncertainty` below (D5, P1-11): `selectFacts` deliberately
   * returns an aggregate as READY, not INDETERMINATE, after excluding
   * uncertain facts, so a definite outcome carrying real uncertainty is the
   * normal case rather than an edge case.
   *
   * Recorded from Task 3; populated by the `v1` operators in Tasks 4–8.
   * Nothing is exposed over GraphQL by this plan — that is plan 08.
   */
  indeterminate?: boolean;
  /**
   * Relevant uncertainty that *existed*, including excluded observations and
   * counts that are lower bounds. Retained even when the outcome is definite:
   * a `true`/`false` dominating the logic does not make the doubt untrue.
   */
  uncertainty?: UncertaintyReason[];
  /**
   * A **scalar** comparison had no usable value — no candidate fact, or
   * candidates that all failed selection. Distinct from `indeterminate`, which
   * means candidates exist but cannot be ordered.
   *
   * Scalar only: a membership gate finding no code has ANSWERED (absence of a
   * problem-list code is evidence of absence), and an aggregate over zero facts
   * is a genuine count of zero. Only a scalar comparison with nothing to read
   * has failed to answer rather than answered "no".
   */
  dataUnavailable?: boolean;
}

// ─── Pending Questions ──────────────────────────────────────────────

export interface PendingQuestion {
  gateId: string;
  prompt: string;
  answerType: AnswerType;
  options?: string[];
  /**
   * Display text for `options`, index-aligned, when the option VALUES are not
   * themselves readable. A branch choice answers with a node id — `step-2-1` —
   * and no clinician can pick between those, but the client has no way to
   * resolve a title from an id on its own.
   *
   * Absent for a question gate, whose options are the author's own words.
   */
  optionLabels?: string[];
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

  // ─── Escalated-datum metadata ─────────────────────────────────────
  /**
   * Set when this question was raised because a gate could not DECIDE, rather
   * than because a provider was asked something. It identifies the DATUM
   * requested, so several gates reading it produce one question.
   *
   * Its presence is also what tells the answer path that the reply is a fact
   * to inject, not a verdict to record.
   */
  datumKey?: string;
  /** Where an answer to this question gets injected as a fact. */
  askTarget?:
    | { kind: 'lab'; code: string; system: string }
    | { kind: 'vital'; path: string }
    | { kind: 'attribute'; path: string };
}

// ─── Red Flags ──────────────────────────────────────────────────────

export interface RedFlagBranch {
  nodeId: string;
  title: string;
  confidence: number;
  topExcludeReason: string;
}

export type RedFlagType =
  | 'all_branches_excluded'
  | 'contradiction'
  | 'missing_critical_data'
  /**
   * An `all_of` DecisionPoint mandates every branch, but the patient data does
   * not support one of them. The branch is still traversed — the author said
   * it happens — so this reports the disagreement rather than resolving it by
   * dropping a step the pathway requires.
   */
  | 'all_of_branch_unsupported'
  /**
   * A gate has several branches but the engine could derive no decision value
   * to route on. Import validation refuses this, so it means a graph stored
   * before that rule. Reported rather than resolved: taking every branch would
   * emit mutually exclusive treatments together, and taking none silently
   * would look like the pathway simply had nothing to say.
   */
  | 'unroutable_decision';

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
  /**
   * The pinned evaluation clock this session was created with (§1).
   * Optional only for rows written before migration 063 — those sessions
   * are not retraversable.
   */
  temporalContext?: EvaluationTemporalContext;
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
