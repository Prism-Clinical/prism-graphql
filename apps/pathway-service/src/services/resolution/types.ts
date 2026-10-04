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
import type { LlmObservation, ScopedBlocker } from './pipeline/types';
import type { CatchUpItem } from './care-plan-merge';

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

/** What the pathway decided about a node (spec C2). Graph dependencies read this. */
export interface NodeEligibility {
  status: NodeStatus;
  reason?: string;
  decidedBy: 'traversal' | 'override';
}

/** Whether the node is in the final plan, after safety and composition (spec C2). */
export interface NodeDisposition {
  status: NodeStatus;
  withheldBy?: 'safety' | 'conflict';
  findingIds?: string[];
  reason?: string;
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
  /**
   * The anchors this gate's `window_from` conditions were evaluated from — the
   * therapy start date each trend window opened on, and where it came from.
   * Surfaced so the date is visible and a clinician can correct it (prescribed
   * is not started). Absent on gates with no anchored condition.
   */
  windowAnchors?: WindowAnchorEvidence[];
  /**
   * The gate closed because an anchored condition is NOT YET DUE
   * (`window_from.min_days_since_anchor`, or the visit that starts the drug) —
   * not because it answered "no". GATED_OUT without a question, so the care
   * plan can be generated; the due date is on `windowAnchors[].dueOn` and the
   * `excludeReason` reads `NOT_YET_DUE: due on/after <date> …`.
   */
  notYetDue?: boolean;
  providerOverride?: ProviderOverride;
  /** Pipeline only (spec C2). Absent on results from the resolver paths plan 03 replaces. */
  eligibility?: NodeEligibility;
  disposition?: NodeDisposition;
  parentNodeId?: string;
  depth: number;
  /** Carried from GraphNode.properties for care plan generation */
  properties?: Record<string, unknown>;
}

// ─── Resolution State ───────────────────────────────────────────────

export type ResolutionState = Map<string, NodeResult>;

export interface DependencyMap {
  gateContextFields: Map<string, Set<string>>;
}

export function createEmptyDependencyMap(): DependencyMap {
  return { gateContextFields: new Map() };
}

// ─── Gate Evaluation ────────────────────────────────────────────────

export type CodedOperator =
  | 'includes_code' | 'not_includes_code' | 'equals' | 'exists'
  | 'greater_than' | 'less_than'
  | 'count_in_window' | 'trend_up' | 'trend_down' | 'delta_from_baseline';

export type AttributeOperator =
  | 'equals' | 'not_equals'
  | 'greater_than' | 'greater_or_equal' | 'less_than' | 'less_or_equal'
  | 'in' | 'exists';

export const VALID_CODED_OPERATORS = [
  'includes_code', 'not_includes_code', 'equals', 'exists',
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
  /**
   * Anchored trend window (`anchored-window.ts`): the window opens on the date
   * a therapeutic class was started instead of a fixed lookback. `unknown` for
   * the reason `horizon` is — validated at runtime by `parseConditionOverride`.
   */
  window_from?: unknown;
  count_threshold?: number;
  min_points?: number;
  slope_threshold?: number;
  delta_threshold?: number;
  /**
   * `delta_from_baseline` only: compare `current − baseline` to
   * `delta_threshold` as `>=` (`at_least`) or `<` (`less_than`). Absent, the
   * threshold's SIGN picks the direction (legacy semantics). Validated by
   * `conditionControlDomainError`.
   */
  delta_comparison?: 'at_least' | 'less_than';
  /**
   * `count_in_window` only. `at_least` (the default) is satisfied by
   * count >= `count_threshold`; `less_than` by count < `count_threshold` —
   * "nothing drawn since treatment started" (`less_than 1`).
   */
  count_comparison?: 'at_least' | 'less_than';
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

/**
 * A nested AND/OR over conditions, legal only inside a compound gate's
 * `conditions` list. The shape is the compound gate's OWN `(operator,
 * conditions)` pair, so a whole compound body lifts into a group unchanged —
 * `{ "operator": "OR", "conditions": [ … ] }`.
 *
 * Told apart from a leaf by `conditions` being an array: a leaf never carries
 * that key (the import validator's key allowlists reject it), and a group never
 * carries `field` / `attribute` (rejected too). `operator` is required on a
 * group — compared case-insensitively, like the gate's; an implicit AND three
 * levels down is not something a reviewer can see.
 */
export interface ConditionGroup {
  operator: 'AND' | 'OR';
  conditions: ConditionEntry[];
  display?: string; // UI decorator — ignored by the evaluator
  note?: string;    // UI decorator — ignored by the evaluator
}

/** One entry of a compound gate's `conditions`: a leaf condition or a group. */
export type ConditionEntry = GateCondition | ConditionGroup;

/**
 * Levels of AND/OR a compound gate may carry, COUNTING THE GATE'S OWN
 * `operator` as level 1 — so a group directly in `conditions` is level 2, and
 * groups may nest to level 4. Validator-enforced; the evaluator itself recurses
 * over whatever it is given.
 */
export const MAX_CONDITION_NESTING = 4;

export function isConditionGroup(entry: unknown): entry is ConditionGroup {
  return (
    entry !== null &&
    typeof entry === 'object' &&
    !Array.isArray(entry) &&
    Array.isArray((entry as { conditions?: unknown }).conditions)
  );
}

/**
 * Every LEAF of a condition list, depth first, in authored order, BY REFERENCE
 * — never cloned. The gate evaluator reports unresolved leaves by identity and
 * the traversal matches them back (`unresolvedAnchorConditions.includes(c)`),
 * so a copy here would silently stop a nested anchor being asked for.
 *
 * Takes `unknown` because most callers read straight off untyped AGE JSON.
 * Non-array input yields nothing; non-object entries are passed through as
 * leaves so a caller's own malformed-entry handling still sees them.
 */
export function conditionLeaves(entries: unknown): unknown[] {
  return conditionLeavesWithPath(entries).map((l) => l.condition);
}

/**
 * `conditionLeaves`, with each leaf's position: `"1"` for a top-level entry
 * (so a flat list labels exactly as it always did) and `"1.0"` for the first
 * entry of the group at index 1.
 */
export function conditionLeavesWithPath(
  entries: unknown,
  prefix = '',
): Array<{ condition: unknown; path: string }> {
  if (!Array.isArray(entries)) return [];
  const out: Array<{ condition: unknown; path: string }> = [];
  entries.forEach((entry, i) => {
    const path = prefix === '' ? String(i) : `${prefix}.${i}`;
    if (isConditionGroup(entry)) out.push(...conditionLeavesWithPath(entry.conditions, path));
    else out.push({ condition: entry, path });
  });
  return out;
}

/**
 * The leaf conditions a gate evaluates, whatever its shape: its `condition`,
 * then every leaf of its `conditions` (groups flattened). Untyped on purpose —
 * see `conditionLeaves`.
 */
export function gateConditionLeaves(props: unknown): unknown[] {
  if (!props || typeof props !== 'object') return [];
  const p = props as { condition?: unknown; conditions?: unknown };
  return [...(p.condition ? [p.condition] : []), ...conditionLeaves(p.conditions)];
}

/** A group's or gate's operator: `OR` in any case is OR; anything else is AND, the stricter reading. */
export function normalizeGroupOperator(raw: unknown): 'AND' | 'OR' {
  return String(raw ?? 'AND').toUpperCase() === 'OR' ? 'OR' : 'AND';
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
  /** Leaves and nested groups (`ConditionGroup`) — see `MAX_CONDITION_NESTING`. */
  conditions?: ConditionEntry[];

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
  /**
   * `YYYY-MM-DD`. Only a `window_from` anchor takes one: stored under the
   * anchor's key (`anchor:<event>:<clinical_role>`), never a gate id, as the
   * clinician's start date for the class. Persists inside the session's
   * `gate_answers` JSONB and the `pathway_gate_answers.answer` JSONB, so it
   * needed no migration.
   */
  dateValue?: string;
  /**
   * The provider has no value for a datum the pathway asked for. Stored under
   * `declinedKeyFor(datumKey)`, never a gate id: every gate that would ask for
   * that datum stops asking and takes its `default_behavior`, as if authored
   * `on_unresolved: 'default'`. It asserts nothing about the patient — a value
   * that later reaches the chart decides the gates as usual.
   */
  notAvailable?: boolean;
}

/** Where "the provider has no value for this datum" lives in a session's gate answers. */
export const declinedKeyFor = (datumKey: string): string => `declined:${datumKey}`;

/** Where a `window_from` window opened, recorded on the gate (see NodeResult). */
export interface WindowAnchorEvidence {
  /** `anchor:<event>:<clinical_role>` — also the override's gateAnswers key. */
  key: string;
  clinicalRole: string;
  /** The class in words, as the prompt names it. */
  label: string;
  /** `YYYY-MM-DD`. */
  date: string;
  source: 'CLINICIAN' | 'CARE_PLAN' | 'MEDICATION_ORDER' | 'SESSION_RECOMMENDATION';
  detail: string;
  /**
   * `YYYY-MM-DD` — the first day the condition may be read
   * (`min_days_since_anchor` after `date`; a session-recommended start is
   * never due at that visit). Absent when it is due as soon as it anchors.
   */
  dueOn?: string;
}

export interface GateEvaluationResult {
  satisfied: boolean;
  reason: string;
  contextFieldsRead: string[];

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
  /**
   * On a compound gate, the conditions that could not be answered — the ones
   * that made `indeterminate` or `dataUnavailable` true.
   *
   * Without this the escalation prompt asked for the FIRST askable condition,
   * which can be one the engine already has a value for. The provider answers,
   * the genuinely unresolved condition is still unresolved, and the gate pends
   * again — indefinitely.
   */
  unresolvedConditions?: GateCondition[];
  /**
   * The unresolved conditions whose trouble is an unresolved `window_from`
   * anchor — asked for as a start DATE rather than as a datum. A subset of the
   * conditions that could not be answered; on a single-condition gate, that
   * condition.
   */
  unresolvedAnchorConditions?: GateCondition[];
  /**
   * The unresolved conditions whose trouble is a trend/delta series ONE dated
   * value short — askable as "the newest result", injected as a lab. With the
   * date of the latest value on file, so the question can ask for a NEWER draw
   * rather than re-collecting the one the series already has.
   */
  unresolvedSeries?: Array<{ condition: GateCondition; latestDate: string }>;
  /**
   * The unresolved conditions whose trouble is a `horizon: "PREGNANCY"` window
   * that could not be dated — asked for as the patient's GESTATIONAL AGE, not
   * as the condition's own datum. A subset of the conditions that could not be
   * answered; on a single-condition gate, that condition.
   */
  unresolvedPregnancyConditions?: GateCondition[];
  /** The resolved anchors, deduplicated by key, in condition order. */
  windowAnchors?: WindowAnchorEvidence[];
  /**
   * An anchored condition is NOT YET DUE and nothing else decided the gate.
   * The gate closes WITHOUT asking — whatever `default_behavior` and
   * `on_unresolved` say — with `reason` beginning `NOT_YET_DUE:`. `dueOn` is
   * the latest due date among the conditions that were not due.
   */
  notYetDue?: { dueOn: string };
  /**
   * A `window_from` anchor needs to know whether THIS traversal recommends the
   * class, and the Medication nodes that say so have not been disposed yet.
   * The traversal defers the gate and evaluates it again once the walk has
   * settled; a gate evaluated in that final position never reports this.
   */
  awaitingSessionRecommendation?: boolean;
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
  /**
   * The newest value the chart holds for a requested LAB or VITAL, when there
   * is one the gate could not use — outside its horizon, or not orderable
   * against the others. Shown with the question and offered as its starting
   * answer, so the provider confirms or replaces it instead of retyping a
   * value Prism already has. Absent when nothing is on file.
   */
  lastOnFile?: { value: number; date?: string };
  /**
   * Every gate this pass saw asking for this datum.
   *
   * A shared datum prompt is deduped — two gates needing one haemoglobin ask
   * ONCE — and the dedup used to discard the second gate's claim on it
   * entirely. So when the first gate resolved, the prompt was dropped while
   * the second still needed it, and the session pended with no question able
   * to clear it. Reconciliation keeps the prompt while any owner is still
   * PENDING_QUESTION, which it reads from the resolution state rather than
   * from this list — the list says who MIGHT need it, the state says who
   * still does.
   */
  askedByNodeIds?: string[];
  /** Where an answer to this question gets injected as a fact. */
  askTarget?:
    | { kind: 'lab'; code: string; system: string }
    | { kind: 'vital'; path: string }
    | { kind: 'attribute'; path: string }
    /**
     * A `window_from` start date. NOT a fact: the answer is the clinician's
     * date for the anchor, stored in `gateAnswers` under `key`.
     */
    | { kind: 'anchor'; key: string };
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
  /** Optimistic-lock counter. Every committed write increments it (spec §4). */
  revision: number;
  // ── Inputs (spec §1): what a person or the outside world told the session.
  providerOverrides: Map<string, ProviderOverride>;
  observations: Map<string, LlmObservation>;
  graphFingerprint: string;
  // ── Cache of the last committed evaluation. Never an input.
  envFingerprint: string;
  resultHash: string;
  readiness: { ready: boolean; blockers: ScopedBlocker[] };
  gateContextFields: Map<string, string[]>;
  catchUpItems: CatchUpItem[];
  /** Set by plan 04 for a child of a multi-pathway run. */
  parentSessionId?: string;
  resolutionState: ResolutionState;
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
  /** The pinned evaluation clock. Every session since migration 067 has one (NOT NULL). */
  temporalContext: EvaluationTemporalContext;
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
