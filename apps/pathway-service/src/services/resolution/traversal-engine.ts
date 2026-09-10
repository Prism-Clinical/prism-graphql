import { GraphContext, PatientContext, GraphNode } from '../confidence/types';
import { assertEngineCodeMap, evaluateGate, LlmGateEvaluator } from './gate-evaluator';
import type { GateEvaluationDeps } from './gate-evaluator';
import type { PathwayTemporalDefaults } from './temporal/cascade';
import type { FactStore } from './temporal/fact-model';
import { EvaluationTemporalContext } from './temporal/evaluation-context';
import { askFor } from './unresolved-prompt';
import { parseBranchWhen } from '../import/branch-when';
import { decisionValueOf, decisionSelects } from './decision-value';
import {
  reconcilePendingQuestions,
  reconcileRedFlags,
  RECONCILABLE_RED_FLAG_TYPES,
} from './findings-reconciliation';
import type { UnresolvedAsk } from './unresolved-prompt';
import {
  NodeResult,
  NodeStatus,
  GateAnswer,
  GateCondition,
  GateProperties,
  GateType,
  DefaultBehavior,
  AnswerType,
  TraversalResult,
  TraversalConfidenceAdapter,
  DependencyMap,
  PendingQuestion,
  RedFlag,
  ResolutionState,
  createEmptyDependencyMap,
  TRAVERSAL_TIMEOUT_MS,
  STRUCTURAL_NODE_TYPES,
  ACTION_NODE_TYPES,
  AttributeCodeMap,
} from './types';

// ─── Helpers ──────────────────────────────────────────────────────────

interface BfsEntry {
  nodeIdentifier: string;
  parentNodeId?: string;
  depth: number;
}

function isGateNode(node: GraphNode): boolean {
  return node.nodeType === 'Gate';
}

/**
 * The evaluator's uncertainty signal, in the shape `NodeResult` carries it.
 *
 * Two deliberate choices. The fields are omitted rather than set to
 * `undefined` when the evaluator did not report them, so a `legacy-v0` result
 * — which reports neither — produces exactly the NodeResult shape it always
 * did. And `uncertainty` is stringified into `uncertaintyReason` because
 * resolution state is projected to GraphQL, which must not carry an internal
 * union type.
 */
function uncertaintyOf(gateResult: {
  indeterminate?: boolean;
  uncertainty?: unknown;
  dataUnavailable?: boolean;
}): { indeterminate?: boolean; uncertaintyReason?: string; dataUnavailable?: boolean } {
  return {
    ...(gateResult.indeterminate !== undefined
      ? { indeterminate: gateResult.indeterminate }
      : {}),
    ...(gateResult.uncertainty !== undefined
      ? { uncertaintyReason: String(gateResult.uncertainty) }
      : {}),
    ...(gateResult.dataUnavailable !== undefined
      ? { dataUnavailable: gateResult.dataUnavailable }
      : {}),
  };
}

/**
 * The datum an unresolvable gate should ask for, or `null` when it should not
 * ask at all.
 *
 * Three things have to be true. The gate must have failed to DECIDE — a gate
 * that answered "no" has answered, and prompting for more data there sends a
 * clinician after something that would not change the plan. The author must
 * not have opted out via `on_unresolved: 'default'`. And the condition must be
 * one there is an honest question for, which `askFor` decides.
 *
 * For a compound gate the first askable condition wins: a compound that could
 * not decide needs at least that datum, and asking one at a time is honest
 * about what the next answer unlocks.
 */
function unresolvedAsk(
  gateProps: GateProperties,
  gateResult: {
    indeterminate?: boolean;
    dataUnavailable?: boolean;
    unresolvedConditions?: GateCondition[];
  },
  /** The attribute vocabulary, so a lab attribute asks for a LAB. */
  codeMap?: AttributeCodeMap,
): UnresolvedAsk | null {
  const couldNotDecide =
    gateResult.indeterminate === true || gateResult.dataUnavailable === true;
  if (!couldNotDecide) return null;
  if (gateProps.on_unresolved === 'default') return null;

  // Ask for the condition that was actually UNRESOLVED, when the evaluator
  // said which. Falling straight to the gate's condition list asked for the
  // first askable one, which on a compound can be a condition the engine
  // already has a value for: the provider answers, the blocking condition is
  // still blocked, and the gate pends again — for ever.
  //
  // The full list stays the fallback for a single-condition gate, where the
  // only condition is necessarily the unresolved one.
  const conditions =
    gateResult.unresolvedConditions && gateResult.unresolvedConditions.length > 0
      ? gateResult.unresolvedConditions
      : (gateProps.conditions ?? (gateProps.condition ? [gateProps.condition] : []));
  for (const condition of conditions) {
    const ask = askFor(condition, codeMap);
    if (ask) return ask;
  }
  return null;
}


/**
 * Close a branch the answer did not select, and everything under it.
 *
 * EXCLUDED rather than absent: a node missing from the session reads as an
 * oversight, where an excluded one with a reason reads as a decision. The
 * reason names the gate so a reader can see what chose otherwise.
 */
function markBranchNotSelected(
  targetId: string,
  gateId: string,
  gateTitle: string,
  depth: number,
  graphContext: GraphContext,
  resolutionState: ResolutionState,
  rewritten: Set<string>,
  provisional?: Set<string>,
  held?: Set<string>,
): void {
  if (resolutionState.has(targetId) && !provisional?.has(targetId) && !held?.has(targetId)) return;
  const target = graphContext.getNode(targetId);
  if (!target) return;

  // A HELD branch root keeps its override — but the sweep must go on beneath
  // it. Returning here abandoned the descendants, and since the incremental
  // pass had already cleared them, they were not excluded but DELETED: a
  // medication vanished from the session outright when the provider switched
  // away from an overridden branch.
  if (held?.has(targetId)) {
    const heldKids = graphContext.outgoingEdges(targetId).map(e => e.targetId);
    addAll(rewritten, markSubtree(heldKids, graphContext, resolutionState, NodeStatus.EXCLUDED,
      `Excluded with ${nodeTitle(target)}`, targetId, depth + 1, provisional, held));
    return;
  }

  provisional?.delete(targetId);
  rewritten.add(targetId);

  resolutionState.set(targetId, {
    nodeId: targetId,
    nodeType: target.nodeType,
    title: nodeTitle(target),
    status: NodeStatus.EXCLUDED,
    confidence: 0,
    confidenceBreakdown: [],
    excludeReason: `Not selected by the answer at "${gateTitle}"`,
    parentNodeId: gateId,
    depth: depth + 1,
    properties: target.properties,
  });

  const kids = graphContext.outgoingEdges(targetId).map(e => e.targetId);
  addAll(rewritten, markSubtree(kids, graphContext, resolutionState, NodeStatus.EXCLUDED,
    `Excluded with ${nodeTitle(target)}`, targetId, depth + 1, provisional, held));
}

function isDecisionPoint(node: GraphNode): boolean {
  return node.nodeType === 'DecisionPoint';
}

function isStructuralNode(node: GraphNode): boolean {
  return STRUCTURAL_NODE_TYPES.has(node.nodeType);
}

function isActionNode(node: GraphNode): boolean {
  return ACTION_NODE_TYPES.has(node.nodeType);
}

function nodeTitle(node: GraphNode): string {
  return (node.properties.title as string) ?? node.nodeIdentifier;
}

/**
 * Count all reachable descendants from a set of starting node identifiers
 * using the graph context's outgoing edges.
 */
function countSubtree(startIds: string[], graphContext: GraphContext): number {
  const visited = new Set<string>();
  const queue = [...startIds];
  while (queue.length > 0) {
    const id = queue.shift()!;
    if (visited.has(id)) continue;
    visited.add(id);
    for (const edge of graphContext.outgoingEdges(id)) {
      if (!visited.has(edge.targetId)) {
        queue.push(edge.targetId);
      }
    }
  }
  return visited.size;
}

/**
 * Mark an entire subtree (from the children of a node) with the given status.
 * Returns the set of marked node identifiers.
 */
/** Union `from` into `into`, for accumulating what a pass rewrote. */
function addAll(into: Set<string>, from: Iterable<string>): void {
  for (const id of from) into.add(id);
}

export function markSubtree(
  startIds: string[],
  graphContext: GraphContext,
  resolutionState: ResolutionState,
  status: NodeStatus,
  excludeReason: string,
  parentNodeId: string,
  baseDepth: number,
  /**
   * Nodes eager evaluation wrote. A sweeping gate MAY overwrite one: it was
   * resolved so a gate could read it, not because the walk reached it, and a
   * closing branch is precisely the walk saying it cannot be reached.
   */
  provisional?: Set<string>,
  /**
   * Overridden nodes. A sweep does NOT rewrite one — the provider's decision
   * about that node stands — but it must still descend PAST it. The override
   * was never a decision about the subtree, and skipping both left a
   * medication included under a gate that had just closed.
   */
  held?: Set<string>,
): Set<string> {
  const marked = new Set<string>();
  const queue: Array<{ id: string; depth: number }> = startIds.map(id => ({ id, depth: baseDepth + 1 }));

  while (queue.length > 0) {
    const { id, depth } = queue.shift()!;
    // Design: first-writer-wins for diamond-shaped graphs. If a node is
    // reachable via multiple paths, the first path to evaluate it determines
    // its status. BFS ordering is deterministic for a given graph structure.
    if (marked.has(id)) continue;
    const isHeld = held?.has(id) === true;
    if (resolutionState.has(id) && !provisional?.has(id) && !isHeld) continue;

    const node = graphContext.getNode(id);
    if (!node) continue;

    // A held node keeps its status and is NOT counted as rewritten — but the
    // loop below still descends through it.
    if (isHeld) {
      for (const edge of graphContext.outgoingEdges(id)) {
        if (!marked.has(edge.targetId)) queue.push({ id: edge.targetId, depth: depth + 1 });
      }
      continue;
    }

    provisional?.delete(id);
    marked.add(id);

    resolutionState.set(id, {
      nodeId: id,
      nodeType: node.nodeType,
      title: nodeTitle(node),
      status,
      confidence: 0,
      confidenceBreakdown: [],
      excludeReason,
      parentNodeId,
      depth,
      properties: node.properties,
    });

    for (const edge of graphContext.outgoingEdges(id)) {
      if (!marked.has(edge.targetId)
          && (!resolutionState.has(edge.targetId)
              || provisional?.has(edge.targetId)
              || held?.has(edge.targetId))) {
        queue.push({ id: edge.targetId, depth: depth + 1 });
      }
    }
  }
  return marked;
}

// ─── Record dependency helpers ────────────────────────────────────────

/**
 * Which slices of added patient context can move this node's confidence.
 *
 * `addPatientContext` reads `scorerInputs` to decide which action nodes need
 * re-scoring. Nothing ever wrote it, so a context change that moved a score
 * without touching a gate seeded no recomputation — the node kept a
 * confidence derived from data the session no longer held.
 */
function recordScorerInputs(depMap: DependencyMap, nodeId: string, inputs?: string[]): void {
  if (!inputs || inputs.length === 0) return;
  if (!depMap.scorerInputs.has(nodeId)) depMap.scorerInputs.set(nodeId, new Set());
  const set = depMap.scorerInputs.get(nodeId)!;
  for (const i of inputs) set.add(i);
}

function recordInfluence(depMap: DependencyMap, from: string, to: string): void {
  if (!depMap.influences.has(from)) depMap.influences.set(from, new Set());
  depMap.influences.get(from)!.add(to);

  if (!depMap.influencedBy.has(to)) depMap.influencedBy.set(to, new Set());
  depMap.influencedBy.get(to)!.add(from);
}

function recordGateContextFields(depMap: DependencyMap, gateId: string, fields: string[]): void {
  if (fields.length === 0) return;
  if (!depMap.gateContextFields.has(gateId)) depMap.gateContextFields.set(gateId, new Set());
  for (const f of fields) depMap.gateContextFields.get(gateId)!.add(f);
}

/**
 * Everything resolving one node reads or appends to during a walk.
 *
 * Bundled rather than passed as eleven parameters so `disposeNode`'s body could
 * move out of the BFS loop verbatim: the fields destructure under exactly the
 * names the loop used.
 *
 * `queue` is the walk's own queue, which is what lets one disposition unit
 * serve both entry points — a full traversal seeds it from the Pathway root, an
 * incremental resolve seeds it from an affected set, and neither needs to know
 * how a node decides.
 */
interface WalkContext {
  graphContext: GraphContext;
  patientContext: PatientContext;
  gateAnswers: Map<string, GateAnswer>;
  resolutionState: ResolutionState;
  dependencyMap: DependencyMap;
  queue: BfsEntry[];
  pendingQuestions: PendingQuestion[];
  redFlags: RedFlag[];
  evaluationStack: Set<string>;
  startTime: number;
  /**
   * Every node this pass REWROTE, not just the ones it disposed directly.
   *
   * `disposeNode` also rewrites descendants wholesale through `markSubtree` —
   * a gate closing takes its whole subtree GATED_OUT, an unchosen branch takes
   * its subtree EXCLUDED. Those nodes were outside the reconciliation scope,
   * so their old questions and red flags survived a pass that had just
   * overwritten the nodes they were about, and went on blocking generation.
   */
  rewritten: Set<string>;
  /**
   * Nodes written by EAGER evaluation — resolved so a `prior_node_result` gate
   * could read them, not because the walk reached them.
   *
   * Eager evaluation writes into the same state the walk uses for
   * reachability, so without this a dependency inside a DIFFERENT, gated
   * branch got committed: when its real guard closed a moment later,
   * `markSubtree` skipped it as already-present and a treatment nobody could
   * reach stayed INCLUDED. A provisional node is re-disposed if the walk
   * legitimately arrives, and overwritable if a closing gate sweeps it.
   */
  provisional: Set<string>;
  /**
   * Nodes kept as-is because a provider overrode them.
   *
   * The override is a decision about THAT node, never about its descendants,
   * so the walk must still arrive and open the subtree below it. A plain
   * `resolutionState.has` guard skips a held node — it IS in the state — and
   * the branch beneath it silently froze.
   */
  overrideHeld: Set<string>;
  /**
   * Branch targets an `all_of` DecisionPoint MANDATED.
   *
   * "After assessment, start workup AND prophylaxis" — the author said these
   * all happen, so the fork includes every branch and red-flags any the data
   * does not support. But a target that is itself an ACTION node was then
   * re-scored on its own account and EXCLUDED below the suggest threshold,
   * quietly undoing the mandate. A structural Step target survived, so the
   * meaning of `all_of` depended on what kind of node the branch pointed at.
   *
   * The mandate wins, and the disagreement is reported rather than resolved:
   * that is what `all_of_branch_unsupported` is for.
   */
  mandated: Set<string>;
}

/**
 * What an incremental resolve produced, on top of a traversal's result.
 *
 * `statusChanges` is the incremental path's alone: only a walk that starts
 * from an existing state knows what a node's status USED to be, and callers
 * record it as the session's audit trail.
 */
export interface IncrementalResult extends TraversalResult {
  statusChanges: Array<{ nodeId: string; from: string; to: string }>;
  nodesRecomputed: number;
}

// ─── Traversal Engine ─────────────────────────────────────────────────

export class TraversalEngine {
  constructor(
    private confidenceEngine: TraversalConfidenceAdapter,
    private thresholds: { autoResolveThreshold: number; suggestThreshold: number },
    /**
     * The session's pinned clock. Required: every gate evaluation in this
     * traversal reads `evaluationAsOf` from here instead of the wall clock,
     * so a retraversal or replay reproduces this traversal exactly.
     *
     * Third, not appended, because TypeScript forbids a required parameter
     * after an optional one.
     */
    private temporalContext: EvaluationTemporalContext,
    /**
     * The PATHWAY tier of the horizon/status cascade (`rctx.temporalDefaults`).
     * Required, and fourth for the same reason `temporalContext` is third.
     *
     * Threaded rather than defaulted because the anchor sweep already resolves
     * against these defaults at preflight: if the traversal fell back to system
     * defaults, preflight and evaluation would disagree about the very same
     * pathway (P1-10, locked decision #7).
     */
    private pathwayDefaults: PathwayTemporalDefaults,
    /**
     * The normalized facts the `v1` kernel selects from, assembled by the
     * resolver (plan 04 Task 9, locked decision #5). `[]` under `legacy-v0`,
     * which never reads it.
     *
     * REQUIRED and positioned before the optionals, for the reason P1-10
     * promoted `pathwayDefaults` and R11-4 flags for `codeMap`: omitted at one
     * construction site, every `v1` gate selects from nothing and answers a
     * quiet `false` — while that pathway's anchor preflight resolved policies
     * for the very conditions the gate could no longer see.
     */
    private factStore: FactStore,
    /**
     * The attribute namespace/system/code registry (`rctx.codeMap`).
     *
     * REQUIRED (R11-4), and positioned before the optional LLM evaluator for
     * the same reason `factStore` is: defaulted to an empty `Map`, omitting it
     * at one construction site makes every mapped `lab.*` / `allergy.*`
     * attribute gate adapt to `null`, fall back to `resolveAttribute` with
     * nothing to look up, and answer a quiet `false` — while that pathway's
     * anchor preflight, which now shares this same map, resolved a policy for
     * the very conditions the gate could no longer see.
     */
    private codeMap: AttributeCodeMap,
    private llmGateEvaluator?: LlmGateEvaluator,
  ) {
    assertEngineCodeMap(codeMap, 'TraversalEngine');
  }

  /** The dependencies every gate in this traversal is evaluated with. */
  private gateDeps(
    patientContext: PatientContext,
    resolutionState: ResolutionState,
    gateAnswers: Map<string, GateAnswer>,
    gateId: string,
  ): GateEvaluationDeps {
    return {
      temporalContext: this.temporalContext,
      pathwayDefaults: this.pathwayDefaults,
      factStore: this.factStore,
      patientContext,
      resolutionState,
      gateAnswers,
      gateId,
      llmEvaluator: this.llmGateEvaluator,
      codeMap: this.codeMap,
    };
  }

  async traverse(
    graphContext: GraphContext,
    patientContext: PatientContext,
    gateAnswers: Map<string, GateAnswer>,
  ): Promise<TraversalResult> {
    const startTime = Date.now();
    const resolutionState: ResolutionState = new Map();
    const dependencyMap = createEmptyDependencyMap();
    const pendingQuestions: PendingQuestion[] = [];
    const redFlags: RedFlag[] = [];
    const evaluationStack = new Set<string>();
    /** Every node this pass rewrote — its reconciliation authority. */
    const rewritten = new Set<string>();
    /** Nodes written out of order by eager evaluation. See WalkContext. */
    const provisional = new Set<string>();
    /** Overridden nodes kept as-is; the walk opens their children on arrival. */
    const overrideHeld = new Set<string>();
    /** Branch targets an `all_of` DecisionPoint mandated. See WalkContext. */
    const mandated = new Set<string>();
    let isDegraded = false;

    // 1. Find root node (type 'Pathway')
    const rootNode = graphContext.allNodes.find(n => n.nodeType === 'Pathway');
    if (!rootNode) {
      return {
        resolutionState,
        dependencyMap,
        pendingQuestions,
        redFlags,
        totalNodesEvaluated: 0,
        traversalDurationMs: Date.now() - startTime,
        isDegraded: true,
      };
    }

    // 2. Init BFS queue
    const queue: BfsEntry[] = [{ nodeIdentifier: rootNode.nodeIdentifier, depth: 0 }];

    // 3-4. BFS loop
    while (queue.length > 0) {
      const entry = queue.shift()!;
      const { nodeIdentifier, parentNodeId, depth } = entry;

      // A node written by eager evaluation was resolved so a gate could read
      // it, not because the walk reached it. Now the walk HAS reached it, so
      // dispose it properly — which also enqueues the subtree eager
      // deliberately did not claim.
      if (provisional.has(nodeIdentifier)) {
        provisional.delete(nodeIdentifier);
        resolutionState.delete(nodeIdentifier);
      }

      // Timeout check
      if (Date.now() - startTime > TRAVERSAL_TIMEOUT_MS) {
        isDegraded = true;
        // Mark this and all remaining queued nodes as TIMEOUT
        const remaining = [nodeIdentifier, ...queue.map(e => e.nodeIdentifier)];
        for (const id of remaining) {
          if (resolutionState.has(id)) continue;
          const n = graphContext.getNode(id);
          if (!n) continue;
          resolutionState.set(id, {
            nodeId: id,
            nodeType: n.nodeType,
            title: nodeTitle(n),
            status: NodeStatus.TIMEOUT,
            confidence: 0,
            confidenceBreakdown: [],
            excludeReason: 'Traversal timeout exceeded',
            parentNodeId,
            depth,
            properties: n.properties,
          });
        }
        break;
      }

      // Memoization: skip already-resolved nodes (first-writer-wins for diamond graphs)
      if (resolutionState.has(nodeIdentifier)) continue;

      const node = graphContext.getNode(nodeIdentifier);
      if (!node) continue;

      await this.disposeNode(node, nodeIdentifier, parentNodeId, depth, {
        graphContext, patientContext, gateAnswers,
        resolutionState, dependencyMap, queue,
        pendingQuestions, redFlags, evaluationStack, startTime, rewritten,
        provisional, overrideHeld, mandated,
      });
    }

    return {
      resolutionState,
      dependencyMap,
      pendingQuestions,
      redFlags,
      totalNodesEvaluated: resolutionState.size,
      traversalDurationMs: Date.now() - startTime,
      isDegraded,
    };
  }

  /**
   * Re-resolve part of an existing session in place, seeded from the nodes
   * whose inputs changed.
   *
   * This is the entry point that replaces `RetraversalEngine`. It shares
   * `disposeNode` with `traverse`, which is the whole point: the retraversal
   * defect family existed because a second implementation decided nodes
   * differently from the first. There is no second implementation to drift.
   *
   * The mechanism is deliberately simple. Clear the region the seeds can
   * reach, then walk it exactly as a full traversal walks the graph from the
   * root. Every defect falls out of that rather than being handled:
   *
   *   - a gate that now opens re-resolves its subtree, because the walk
   *     follows GRAPH edges and never consulted `dependencyMap.influences`,
   *     which is the map that never recorded gate -> subtree;
   *   - nothing is lost, because clearing is immediately followed by
   *     re-resolution through the unit that MATERIALISES nodes — the old
   *     engine could only skip ids that were missing, so deletions were
   *     permanent;
   *   - `default_behavior` applies, because `disposeNode` consults it and
   *     there is no second rule left to forget.
   */
  async resolveIncrementally(
    seedNodeIds: Set<string>,
    resolutionState: ResolutionState,
    dependencyMap: DependencyMap,
    graphContext: GraphContext,
    patientContext: PatientContext,
    gateAnswers: Map<string, GateAnswer>,
    /**
     * The session's stored findings. Given, the returned lists are the
     * RECONCILED whole — assign them, do not concat. Omitted, the derived set
     * comes back as-is, which is what a fresh session wants.
     */
    existing?: {
      pendingQuestions?: readonly PendingQuestion[];
      redFlags?: readonly RedFlag[];
      /** Gates settled by this very mutation, dropped whether re-derived or not. */
      alsoDropGateIds?: Iterable<string>;
    },
  ): Promise<IncrementalResult> {
    const startTime = Date.now();
    const pendingQuestions: PendingQuestion[] = [];
    const redFlags: RedFlag[] = [];
    const evaluationStack = new Set<string>();
    /** Every node this pass rewrote — its reconciliation authority. */
    const rewritten = new Set<string>();
    /** Nodes written out of order by eager evaluation. See WalkContext. */
    const provisional = new Set<string>();
    /** Overridden nodes kept as-is; the walk opens their children on arrival. */
    const overrideHeld = new Set<string>();
    /** Branch targets an `all_of` DecisionPoint mandated. See WalkContext. */
    const mandated = new Set<string>();
    const queue: BfsEntry[] = [];

    // Captured before anything is cleared — the only moment the previous
    // status of each node in the region is still known.
    const statusBefore = new Map<string, NodeStatus>();
    /** Where each region node sat, so a timed-out rebuild can be put back. */
    const priorPlacement = new Map<string, { depth: number; parentNodeId?: string }>();

    // PROMOTE each seed past any ancestor that currently closes it.
    //
    // A seed is otherwise walked as a ROOT — disposed on its own account, with
    // nothing above it consulted. So a lab change touching a medication deep
    // under a gate the provider had already shut re-opened that medication:
    // the gate was never re-disposed, stayed GATED_OUT, and the treatment
    // beneath it came back INCLUDED.
    //
    // Promoting to the closing ancestor makes its disposition part of this
    // pass, so it either opens the branch honestly or sweeps the subtree. The
    // walk is bounded by the graph and stops at the first ancestor that is
    // still open, so this is not a full traversal in disguise.
    // ── Where an incremental pass may re-enter ────────────────────────
    //
    // THE INVARIANT: a node's status is written either by disposing that node,
    // or by an ancestor that DECIDED it. So a pass must re-enter at the
    // decider of every seed — disposing a node whose status was somebody
    // else's decision makes that decision up again from nothing.
    //
    // The deciders are exactly two, and the list is derived rather than
    // assumed: every write of a node OTHER than the one being disposed comes
    // from `markBranchNotSelected`, `markSubtree`, or the DecisionPoint branch
    // arms — and all three are a Gate or a DecisionPoint ruling on its
    // BRANCHES_TO targets and their subtrees. (The timeout sweep also writes
    // foreign nodes, but that is the PASS deciding, not a graph node, and it
    // has no ancestor to re-enter at.)
    //
    // This replaced four accumulated special cases — closed ancestors,
    // rejected branches, held overrides, `all_of` mandates — each added after
    // a separate bug report. They were four faces of this one rule, and the
    // rule catches a fifth the reports had not reached: a mandated branch
    // target seeded alone lost its mandate, because `mandated` is filled by
    // the fork and the pass never re-entered there.
    const CLOSED_FROM_ABOVE = [
      NodeStatus.GATED_OUT, NodeStatus.EXCLUDED, NodeStatus.PENDING_QUESTION,
    ];
    const isDecider = (id: string): boolean => {
      const n = graphContext.getNode(id);
      return n !== undefined && (isGateNode(n) || isDecisionPoint(n));
    };
    const promote = (id: string): string => {
      const seen = new Set<string>([id]);
      const parentsOf = (x: string) =>
        graphContext.incomingEdges(x).map(e => e.sourceId).filter(p => !seen.has(p));

      let current = id;
      // 1. A closed node was closed FROM ABOVE, so its own status is not its
      //    own to restate — climb past it. A decider is the exception: a gate
      //    that shut because its condition failed, or pended because nobody
      //    answered, decided that itself.
      while (CLOSED_FROM_ABOVE.includes(resolutionState.get(current)?.status as NodeStatus)
             && !isDecider(current)) {
        const up = parentsOf(current)[0];
        if (up === undefined) break;
        seen.add(up);
        current = up;
      }
      // 2. Re-enter at whatever decides this node. One level: re-disposing the
      //    decider re-decides everything below it, so climbing further would
      //    only widen the region without changing an outcome.
      return parentsOf(current).find(isDecider) ?? current;
    };

    const effectiveSeeds = new Set([...seedNodeIds].map(promote));

    // The region a seed can reach. Bounded by the graph, so it is finite and
    // needs no visited-set of its own beyond `region`.
    //
    // Structural descendants AND logical consumers. Following outgoing edges
    // alone left a sibling `prior_node_result` gate holding its previous
    // decision after the node it depends on changed — `dependencyMap.influences`
    // is exactly the record of who reads whom, and it was not consulted.
    const region = new Set<string>();
    const frontier = [...effectiveSeeds];
    while (frontier.length > 0) {
      const id = frontier.shift()!;
      if (region.has(id)) continue;
      region.add(id);
      for (const edge of graphContext.outgoingEdges(id)) {
        if (!region.has(edge.targetId)) frontier.push(edge.targetId);
      }
      for (const consumer of dependencyMap.influences.get(id) ?? []) {
        if (region.has(consumer)) continue;
        // A consumer is not BELOW us — a `prior_node_result` gate that reads
        // this node is typically a sibling. So it needs its own seed: adding
        // it to the region alone would clear it and then leave it unreachable,
        // deleting it and its subtree from the session outright.
        const consumerSeed = promote(consumer);
        effectiveSeeds.add(consumerSeed);
        frontier.push(consumerSeed);
      }
    }

    // Clear the region so `disposeNode` sees it as unresolved and rebuilds it.
    // A node the provider overrode is KEPT: that decision was made about that
    // node and stands. It is not, however, a decision about the node's
    // descendants, so the walk continues past it — the old engine's `continue`
    // skipped the override AND everything below it, freezing a whole branch
    // behind one manual inclusion.
    for (const id of region) {
      const existing = resolutionState.get(id);
      if (!existing) continue;
      statusBefore.set(id, existing.status);
      priorPlacement.set(id, { depth: existing.depth, parentNodeId: existing.parentNodeId });
      if (existing.providerOverride) {
        // HELD, not queued-through. Pushing its children here put them ahead
        // of the ancestor seeds, so they disposed before the gate governing
        // them — and a later sweep skipped them as already-written, leaving a
        // medication included beneath a gate that had closed.
        //
        // The walk enqueues them when it ARRIVES at this node, by which point
        // everything above it has been disposed and reachability is settled.
        overrideHeld.add(id);
        continue;
      }
      resolutionState.delete(id);
    }

    // Seed only the HIGHEST affected ancestors.
    //
    // A seed that another seed can reach is redundant — the walk gets there
    // anyway — and seeding it is actively wrong, because disposition is
    // first-writer-wins. A branch target seeded before its DecisionPoint
    // resolves first, and when the fork is disposed a moment later and decides
    // to pend, the loop marking its branches PENDING_QUESTION skips anything
    // already written. The branch stays INCLUDED while the fork governing it is
    // unanswered: one arm of a mutually exclusive decision taken by nobody.
    //
    // `addPatientContext` produces exactly that order — branch confidences are
    // recorded against the target and then the DecisionPoint, and a Map keeps
    // insertion order — so this was reachable, not theoretical.
    const reachableFromASeed = new Set<string>();
    for (const seed of effectiveSeeds) {
      const frontier = graphContext.outgoingEdges(seed).map(e => e.targetId);
      const seen = new Set<string>();
      while (frontier.length > 0) {
        const id = frontier.shift()!;
        if (seen.has(id)) continue;
        seen.add(id);
        reachableFromASeed.add(id);
        for (const e of graphContext.outgoingEdges(id)) {
          if (!seen.has(e.targetId)) frontier.push(e.targetId);
        }
      }
    }
    let rootSeeds = [...effectiveSeeds].filter(id => !reachableFromASeed.has(id));
    // Every seed inside one cycle reaches every other, so the filter can empty
    // the list. Falling back to the full set keeps a cyclic region resolvable;
    // ordering within a cycle has no correct answer anyway.
    if (rootSeeds.length === 0) rootSeeds = [...effectiveSeeds];

    for (const id of rootSeeds) {
      // A HELD override is still in the state, so the plain has-check skipped
      // it — and the walk then never arrived to open its descendants. It has
      // to be enqueued precisely because it is held.
      if (!resolutionState.has(id) || overrideHeld.has(id) || provisional.has(id)) {
        // Its PREVIOUS placement, not root-level. Every incremental root used
        // to be re-parented to `undefined` at depth 0, which broke the
        // ancestry chain care-plan generation walks — re-answering a gate
        // beneath a Stage silently dropped that Stage's goals from the plan.
        const was = priorPlacement.get(id);
        queue.push({
          nodeIdentifier: id,
          parentNodeId: was?.parentNodeId,
          depth: was?.depth ?? 0,
        });
      }
    }

    let isDegraded = false;
    let disposed = 0;

    while (queue.length > 0) {
      if (Date.now() - startTime > TRAVERSAL_TIMEOUT_MS) {
        isDegraded = true;
        break;
      }

      const { nodeIdentifier, parentNodeId, depth } = queue.shift()!;
      if (overrideHeld.has(nodeIdentifier)) {
        // The provider's decision about THIS node stands; it was never a
        // decision about its descendants, so they are re-disposed now that the
        // walk has established this node is reachable.
        overrideHeld.delete(nodeIdentifier);
        const held = resolutionState.get(nodeIdentifier);
        for (const edge of graphContext.outgoingEdges(nodeIdentifier)) {
          if (!resolutionState.has(edge.targetId) || provisional.has(edge.targetId)) {
            queue.push({
              nodeIdentifier: edge.targetId,
              parentNodeId: nodeIdentifier,
              depth: (held?.depth ?? depth) + 1,
            });
          }
        }
        continue;
      }
      if (provisional.has(nodeIdentifier)) {
        provisional.delete(nodeIdentifier);
        resolutionState.delete(nodeIdentifier);
      }
      if (resolutionState.has(nodeIdentifier)) continue;

      const node = graphContext.getNode(nodeIdentifier);
      if (!node) continue;

      await this.disposeNode(node, nodeIdentifier, parentNodeId, depth, {
        graphContext, patientContext, gateAnswers,
        resolutionState, dependencyMap, queue,
        pendingQuestions, redFlags, evaluationStack, startTime, rewritten,
        provisional, overrideHeld, mandated,
      });
      disposed++;
    }

    // A timeout here is worse than in a full traversal, which has simply not
    // reached a node yet. This walk DELETED the region up front, so anything
    // not rebuilt has been erased from a session that had it — and the caller
    // then persists that map. Materialise every region member still missing,
    // so the node set stays complete (plan 03's invariant) and the gap reads
    // as TIMEOUT rather than as absence.
    //
    // Every region member, not just what is left in the queue: a node whose
    // parent timed out before enqueuing it is missing from both.
    if (isDegraded) {
      for (const id of region) {
        if (resolutionState.has(id)) continue;
        const n = graphContext.getNode(id);
        if (!n) continue;
        const placement = priorPlacement.get(id);
        resolutionState.set(id, {
          nodeId: id,
          nodeType: n.nodeType,
          title: nodeTitle(n),
          status: NodeStatus.TIMEOUT,
          confidence: 0,
          confidenceBreakdown: [],
          excludeReason: 'Traversal timeout exceeded before this node was re-resolved',
          parentNodeId: placement?.parentNodeId,
          depth: placement?.depth ?? 0,
          properties: n.properties,
        });
      }
    }

    const statusChanges: Array<{ nodeId: string; from: string; to: string }> = [];
    for (const [id, from] of statusBefore) {
      const to = resolutionState.get(id)?.status;
      if (to !== undefined && to !== from) statusChanges.push({ nodeId: id, from, to });
    }

    // Scope is `rewritten` — every node this pass CHANGED, not only the ones
    // it disposed directly. `disposeNode` also rewrites descendants wholesale
    // through `markSubtree`, and those nodes' old findings survived a pass that
    // had just overwritten the nodes they were about.
    //
    // Still not the whole `region`: a node the walk timed out before reaching
    // was never rewritten at all, and reading its absence from the derived set
    // as "settled" would silently drop a live question.
    //
    // Reconcile against what the session already holds, rather than handing
    // back a raw derived set for the caller to CONCAT. Appending re-emitted an
    // identical finding on every pass and never removed one whose condition had
    // resolved — and since generation blocks on unacknowledged red flags, a
    // flag true for one instant blocked that session for ever.
    //
    // Findings about nodes this pass never disposed are outside its authority
    // and pass through untouched.
    const reconciledQuestions = reconcilePendingQuestions(
      existing?.pendingQuestions ?? [],
      pendingQuestions,
      {
        gateIds: rewritten,
        alsoDropGateIds: existing?.alsoDropGateIds,
        // Read from the state this pass just produced, so a shared datum
        // prompt outlives the gate that raised it exactly as long as some
        // other gate still waits on the value.
        stillPending: (id) => resolutionState.get(id)?.status === NodeStatus.PENDING_QUESTION,
      },
    );
    const reconciledFlags = reconcileRedFlags(
      existing?.redFlags ?? [],
      redFlags,
      { nodeIds: rewritten, types: RECONCILABLE_RED_FLAG_TYPES },
    );

    return {
      resolutionState,
      dependencyMap,
      pendingQuestions: reconciledQuestions,
      redFlags: reconciledFlags,
      totalNodesEvaluated: region.size,
      traversalDurationMs: Date.now() - startTime,
      isDegraded,
      statusChanges,
      // What was actually disposed, not the size of the region we intended to
      // dispose. On a timeout those differ, and reporting the intent made a
      // partial rebuild indistinguishable from a complete one.
      nodesRecomputed: disposed,
    };
  }

  /**
   * Resolve ONE node: decide its status, write it into `w.resolutionState`,
   * and enqueue whatever its decision opens up.
   *
   * Extracted verbatim from `traverse`'s BFS body so the incremental entry
   * point resolves a node the same way a full traversal does. The retraversal
   * defect family came from a second implementation drifting from this one;
   * there is now only this one.
   *
   * `w` is destructured immediately so the body below is byte-identical to
   * what ran inside the loop. The only edits are five outer-loop `continue`
   * statements becoming `return`, which mean the same thing here: this node is
   * done, move on. The `continue` and `break` that remain are inner-loop
   * control flow and were deliberately left alone.
   */
  private async disposeNode(
    node: GraphNode,
    nodeIdentifier: string,
    parentNodeId: string | undefined,
    depth: number,
    w: WalkContext,
  ): Promise<void> {
    const {
      graphContext, patientContext, gateAnswers,
      resolutionState, dependencyMap, queue,
      pendingQuestions, redFlags, evaluationStack, startTime, rewritten,
      provisional, overrideHeld, mandated,
    } = w;

    /**
     * May this child be enqueued?
     *
     * Not simply "absent from the state": a PROVISIONAL node was written by
     * eager evaluation rather than reached, and a HELD node is a provider
     * override whose descendants still need disposing. Both are present and
     * both must still be walked.
     */
    const enqueueable = (id: string): boolean =>
      !resolutionState.has(id) || provisional.has(id) || overrideHeld.has(id);

    // Everything below rewrites this node; the subtree helpers add theirs.
    rewritten.add(nodeIdentifier);

    // ── Gate node ──────────────────────────────────────────────────
    if (isGateNode(node)) {
      const gateProps = node.properties as unknown as GateProperties;

      // Lazy evaluation: if prior_node_result gate depends on un-evaluated nodes,
      // evaluate them first (with cycle detection)
      if (gateProps.gate_type === GateType.PRIOR_NODE_RESULT && gateProps.depends_on) {
        let hasCycle = false;
        for (const dep of gateProps.depends_on) {
          if (!resolutionState.has(dep.node_id)) {
            if (evaluationStack.has(dep.node_id)) {
              // Cycle detected
              hasCycle = true;
              break;
            }
            // Evaluate the referenced node first
            evaluationStack.add(nodeIdentifier);
            await this.evaluateNodeEagerly(dep.node_id, parentNodeId, depth, w);
            evaluationStack.delete(nodeIdentifier);
          }
        }

        if (hasCycle) {
          // Mark gate as UNKNOWN with default_behavior
          const defaultStatus = gateProps.default_behavior === DefaultBehavior.TRAVERSE
            ? NodeStatus.INCLUDED : NodeStatus.GATED_OUT;
          resolutionState.set(nodeIdentifier, {
            nodeId: nodeIdentifier,
            nodeType: node.nodeType,
            title: nodeTitle(node),
            status: defaultStatus === NodeStatus.INCLUDED ? NodeStatus.UNKNOWN : NodeStatus.GATED_OUT,
            confidence: 0,
            confidenceBreakdown: [],
            excludeReason: 'Cycle detected in gate dependencies',
            parentNodeId,
            depth,
            properties: node.properties,
          });
          if (defaultStatus === NodeStatus.GATED_OUT) {
            const childIds = graphContext.outgoingEdges(nodeIdentifier).map(e => e.targetId);
            addAll(rewritten, markSubtree(childIds, graphContext, resolutionState, NodeStatus.GATED_OUT,
              'Parent gate has cycle — default skip', nodeIdentifier, depth, provisional, overrideHeld));
          } else {
            // Traverse children
            for (const edge of graphContext.outgoingEdges(nodeIdentifier)) {
              if (enqueueable(edge.targetId)) {
                queue.push({ nodeIdentifier: edge.targetId, parentNodeId: nodeIdentifier, depth: depth + 1 });
              }
            }
          }
          return;
        }
      }

      const gateResult = await evaluateGate(
        gateProps,
        this.gateDeps(patientContext, resolutionState, gateAnswers, nodeIdentifier),
      );

      // Reason channel — carried onto EVERY outcome the gate can take, so
      // "couldn't tell" survives regardless of what default_behavior did with
      // it. Spread rather than assigned so `legacy-v0` results, which report
      // neither field, leave the NodeResult shape untouched.
      const uncertaintyFields = uncertaintyOf(gateResult);

      // Record dependencies
      recordGateContextFields(dependencyMap, nodeIdentifier, gateResult.contextFieldsRead);
      for (const depNodeId of gateResult.dependedOnNodes) {
        recordInfluence(dependencyMap, depNodeId, nodeIdentifier);
      }

      // What the gate DECIDED, separate from whether it is SATISFIED. A
      // multi-branch gate answered "no" is decided, not undecided: routing has
      // to run for it, and `satisfied` is false. See decision-value.ts.
      const answer = gateAnswers.get(nodeIdentifier);
      const decision = decisionValueOf(answer, gateResult.chosenBranch);
      const branchTargets = graphContext
        .outgoingEdges(nodeIdentifier)
        .filter((e) => e.edgeType === 'BRANCHES_TO');
      // Only a MULTI-target gate routes. One target means traversing it IS the
      // routing, and demanding a mapping there would break every single-branch
      // gate in every existing pathway.
      const routes = branchTargets.length > 1;
      const decided = routes && decision !== null;

      if (gateResult.satisfied || decided) {
        // Gate satisfied, or decided by an answer that routes.
        resolutionState.set(nodeIdentifier, {
          nodeId: nodeIdentifier,
          nodeType: node.nodeType,
          title: nodeTitle(node),
          status: NodeStatus.INCLUDED,
          confidence: 1,
          confidenceBreakdown: [],
          parentNodeId,
          depth,
          properties: node.properties,
          ...uncertaintyFields,
        });
        // Tentative LLM-resolved gate: include + traverse, but ALSO surface
        // as a pending question so the provider can confirm the safe-default
        // branch the LLM picked or flip to a different branch.
        if (gateResult.tentative && !gateAnswers.has(nodeIdentifier)) {
          const childIds = graphContext.outgoingEdges(nodeIdentifier).map(e => e.targetId);
          const subtreeSize = countSubtree(childIds, graphContext);
          pendingQuestions.push({
            gateId: nodeIdentifier,
            prompt: gateProps.prompt ?? gateProps.title,
            answerType: AnswerType.SELECT,
            options: (gateProps.branches ?? []).map((b) => b.name),
            affectedSubtreeSize: subtreeSize,
            estimatedImpact: subtreeSize > 3 ? 'high' : subtreeSize > 1 ? 'medium' : 'low',
            tentative: true,
            tentativeBranch: gateResult.chosenBranch,
            tentativeConfidence: gateResult.llmConfidence,
            tentativeReasoning: gateResult.llmReasoning,
          });
        }
        const outgoing = graphContext.outgoingEdges(nodeIdentifier);

        // Which branches this decision selects — computed FIRST, so the
        // cardinality can be checked rather than discovered one edge at a time.
        //
        // Exactly one is the only safe answer. ZERO means the decision matches
        // no mapping and no branch is taken, which reads as "the pathway had
        // nothing to add". SEVERAL means mutually exclusive treatments open
        // together, which is the multi-arm defect this whole workstream exists
        // to remove. Import validation refuses both for new graphs, but it
        // cannot vouch for graphs stored before that rule, for corrupted data,
        // or for any future producer — and the engine is the last thing
        // standing between a bad mapping and a care plan.
        const matched = routes && decision !== null
          ? branchTargets.filter((e) => {
              const w = parseBranchWhen(e.properties?.when);
              return w !== null && decisionSelects(w, decision);
            })
          : [];
        const routable = !routes || matched.length === 1;

        if (routes && !routable) {
          redFlags.push({
            nodeId: nodeIdentifier,
            nodeTitle: nodeTitle(node),
            type: 'unroutable_decision',
            description:
              decision === null
                ? `"${nodeTitle(node)}" has ${branchTargets.length} branches but produced no ` +
                  `answer to route on, so none were taken.`
                : matched.length === 0
                  ? `"${nodeTitle(node)}" has ${branchTargets.length} branches and the answer ` +
                    `given matches none of them, so none were taken.`
                  : `"${nodeTitle(node)}" has ${matched.length} branches all claiming the same ` +
                    `answer. None were taken: opening them together could combine treatments ` +
                    `meant to be alternatives.`,
          });
        }

        const selected = routable ? new Set(matched.map(e => e.targetId)) : new Set<string>();

        for (const edge of outgoing) {
            if (routes && edge.edgeType === 'BRANCHES_TO') {
              if (!selected.has(edge.targetId)) {
                // Say WHY the other treatments are absent. An unexplained
                // missing branch reads as an oversight rather than a decision.
                markBranchNotSelected(
                  edge.targetId, nodeIdentifier, nodeTitle(node), depth,
                  graphContext, resolutionState, rewritten, provisional, overrideHeld,
                );
                continue;
              }
            }
            if (enqueueable(edge.targetId)) {
              queue.push({ nodeIdentifier: edge.targetId, parentNodeId: nodeIdentifier, depth: depth + 1 });
            }
          }
      } else {
        // Gate not satisfied
        const isQuestion = gateProps.gate_type === GateType.QUESTION;
        const isUnansweredQuestion = isQuestion && !answer;

        if (isUnansweredQuestion) {
          // Pending question
          resolutionState.set(nodeIdentifier, {
            nodeId: nodeIdentifier,
            nodeType: node.nodeType,
            title: nodeTitle(node),
            status: NodeStatus.PENDING_QUESTION,
            confidence: 0,
            confidenceBreakdown: [],
            excludeReason: 'Question has not been answered',
            parentNodeId,
            depth,
            properties: node.properties,
          ...uncertaintyFields,
          });

          // Mark subtree as PENDING_QUESTION
          const childIds = graphContext.outgoingEdges(nodeIdentifier).map(e => e.targetId);
          const subtreeSize = countSubtree(childIds, graphContext);
          addAll(rewritten, markSubtree(childIds, graphContext, resolutionState, NodeStatus.PENDING_QUESTION,
            `Awaiting answer to: ${gateProps.prompt ?? gateProps.title}`, nodeIdentifier, depth, provisional, overrideHeld));

          pendingQuestions.push({
            gateId: nodeIdentifier,
            prompt: gateProps.prompt ?? gateProps.title,
            answerType: gateProps.answer_type ?? AnswerType.BOOLEAN,
            options: gateProps.options,
            affectedSubtreeSize: subtreeSize,
            estimatedImpact: subtreeSize > 3 ? 'high' : subtreeSize > 1 ? 'medium' : 'low',
          });
        } else if (unresolvedAsk(gateProps, gateResult, this.codeMap)) {
          // The gate could not DECIDE — as opposed to deciding "no". Ask for
          // the datum it needed rather than silently taking default_behavior,
          // which is what made a missing haemoglobin indistinguishable from a
          // normal one.
          //
          // `unresolvedAsk` returns null for every class with no honest
          // question (membership, aggregate) and whenever the author set
          // on_unresolved: 'default', so this arm cannot fire on them.
          const ask = unresolvedAsk(gateProps, gateResult, this.codeMap)!;

          resolutionState.set(nodeIdentifier, {
            nodeId: nodeIdentifier,
            nodeType: node.nodeType,
            title: nodeTitle(node),
            status: NodeStatus.PENDING_QUESTION,
            confidence: 0,
            confidenceBreakdown: [],
            excludeReason: gateResult.reason,
            parentNodeId,
            depth,
            properties: node.properties,
            ...uncertaintyFields,
          });

          // HELD, not gated out: the pathway has not decided against this
          // subtree, it cannot decide yet.
          const childIds = graphContext.outgoingEdges(nodeIdentifier).map(e => e.targetId);
          const subtreeSize = countSubtree(childIds, graphContext);
          addAll(rewritten, markSubtree(childIds, graphContext, resolutionState, NodeStatus.PENDING_QUESTION,
            `Awaiting ${ask.datumKey}`, nodeIdentifier, depth, provisional, overrideHeld));

          // Dedup on the DATUM, not the gate. Both gates still hold their
          // subtrees; the provider is asked once, and the one injected fact
          // resolves every gate reading it.
          // Deduped, but the second gate's claim is RECORDED rather than
          // discarded. Dropping it meant that when the first gate resolved,
          // the shared prompt went with it while the second still needed the
          // value — a session pending on a question nobody could answer.
          const already = pendingQuestions.find(q => q.datumKey === ask.datumKey);
          if (already) {
            already.askedByNodeIds = [...(already.askedByNodeIds ?? []), nodeIdentifier];
          } else {
            pendingQuestions.push({
              gateId: nodeIdentifier,
              askedByNodeIds: [nodeIdentifier],
              // An authored prompt beats the generated one. The generated text
              // is a fallback so every escalatable gate CAN ask without extra
              // authoring — not a preference for machine wording.
              prompt: gateProps.prompt ?? ask.prompt,
              answerType: ask.answerType,
              affectedSubtreeSize: subtreeSize,
              estimatedImpact: subtreeSize > 3 ? 'high' : subtreeSize > 1 ? 'medium' : 'low',
              datumKey: ask.datumKey,
              askTarget: ask.target,
            });
          }
          // Fail CLOSED on anything that is not an explicit traverse.
          //
          // This compared against SKIP, so any other value — a typo, a casing
          // difference, an absent field — fell to the else and TRAVERSED the
          // subtree. An unreadable instruction opening a treatment arm is the
          // wrong direction to be wrong in; skipping is recoverable, and the
          // import validator now refuses the value outright.
        } else if (
          String(gateProps.default_behavior).toLowerCase() !== DefaultBehavior.TRAVERSE
        ) {
          // Default skip — gate out entire subtree
          resolutionState.set(nodeIdentifier, {
            nodeId: nodeIdentifier,
            nodeType: node.nodeType,
            title: nodeTitle(node),
            status: NodeStatus.GATED_OUT,
            confidence: 0,
            confidenceBreakdown: [],
            excludeReason: gateResult.reason,
            parentNodeId,
            depth,
            properties: node.properties,
          ...uncertaintyFields,
          });
          const childIds = graphContext.outgoingEdges(nodeIdentifier).map(e => e.targetId);
          addAll(rewritten, markSubtree(childIds, graphContext, resolutionState, NodeStatus.GATED_OUT,
            `Gated out by ${nodeTitle(node)}: ${gateResult.reason}`, nodeIdentifier, depth, provisional, overrideHeld));
        } else {
          // Default traverse — include anyway
          resolutionState.set(nodeIdentifier, {
            nodeId: nodeIdentifier,
            nodeType: node.nodeType,
            title: nodeTitle(node),
            status: NodeStatus.INCLUDED,
            confidence: 0,
            confidenceBreakdown: [],
            parentNodeId,
            depth,
            properties: node.properties,
          ...uncertaintyFields,
          });
          for (const edge of graphContext.outgoingEdges(nodeIdentifier)) {
            if (enqueueable(edge.targetId)) {
              queue.push({ nodeIdentifier: edge.targetId, parentNodeId: nodeIdentifier, depth: depth + 1 });
            }
          }
        }
      }
      return;
    }

    // ── DecisionPoint ──────────────────────────────────────────────
    if (isDecisionPoint(node)) {
      const branches = graphContext.outgoingEdges(nodeIdentifier)
        .filter(e => e.edgeType === 'BRANCHES_TO');

      const branchResults: Array<{ targetId: string; confidence: number; title: string; excludeReason: string }> = [];
      const includedBranches: string[] = [];

      // branch target id -> the criteria an author mapped onto it via
      // SELECTS_BRANCH. Empty for every pathway today; this is a capability,
      // not a migration. The mapping does NOT decide anything — which branch
      // is taken still comes from confidence or a provider's answer. It only
      // supplies wording for a decision already made, so an excluded arm can
      // name the criterion that did not apply instead of citing a number.
      const criteriaByBranch = new Map<string, string[]>();
      for (const critEdge of graphContext.outgoingEdges(nodeIdentifier)) {
        if (critEdge.edgeType !== 'HAS_CRITERION') continue;
        const crit = graphContext.getNode(critEdge.targetId);
        const description = crit?.properties.description as string | undefined;
        if (!description) continue;
        for (const sel of graphContext.outgoingEdges(critEdge.targetId)) {
          if (sel.edgeType !== 'SELECTS_BRANCH') continue;
          const list = criteriaByBranch.get(sel.targetId) ?? [];
          list.push(description);
          criteriaByBranch.set(sel.targetId, list);
        }
      }

      for (const branch of branches) {
        const targetNode = graphContext.getNode(branch.targetId);
        if (!targetNode) continue;

        const confResult = await this.confidenceEngine.computeNodeConfidence(
          targetNode, graphContext, patientContext,
        );
        recordScorerInputs(dependencyMap, targetNode.nodeIdentifier, confResult.contextInputs);
        // AND onto the DecisionPoint itself. The branch scores are computed
        // here, but the DECISION they feed — which branches qualify, and
        // whether an exclusive fork must pend — belongs to this node.
        //
        // Recording only against the targets left that decision unreachable:
        // `addPatientContext` seeds the affected targets, and an incremental
        // resolve walks DOWNSTREAM, so it never revisits the parent that
        // decides. New context could move a branch above or below the
        // threshold and the fork would keep its old answer.
        recordScorerInputs(dependencyMap, nodeIdentifier, confResult.contextInputs);

        const conf = confResult.confidence;
        // The author's own words beat a confidence number. Both criteria are
        // named when two map to one branch — picking one would be arbitrary,
        // and the reader needs to know what else did not apply.
        const mappedCriteria = criteriaByBranch.get(branch.targetId);
        const reason = conf < this.thresholds.suggestThreshold
          ? mappedCriteria?.length
            ? `Criterion did not apply: ${mappedCriteria.join('; ')}`
            : `Confidence ${conf} below suggest threshold ${this.thresholds.suggestThreshold}`
          : '';

        branchResults.push({
          targetId: branch.targetId,
          confidence: conf,
          title: nodeTitle(targetNode),
          excludeReason: reason,
        });

        if (conf >= this.thresholds.suggestThreshold) {
          includedBranches.push(branch.targetId);
        }
      }

      const branchMode = (node.properties.branch_mode as string | undefined) ?? 'one_of';

      // all_of takes every branch by declaration — migration 060's example is
      // "after assessment, start workup AND prophylaxis". A branch the data
      // does not support is INCLUDED and red-flagged rather than dropped: the
      // author said these all happen, and silently excluding one contradicts
      // the pathway instead of reporting a disagreement with it.
      if (branchMode === 'all_of') {
        const weak = branchResults.filter(
          b => b.confidence < this.thresholds.suggestThreshold,
        );
        includedBranches.length = 0;
        includedBranches.push(...branchResults.map(b => b.targetId));
        // Recorded so an ACTION target is not silently re-excluded when it is
        // disposed on its own account a moment later.
        for (const br of branchResults) mandated.add(br.targetId);

        if (weak.length > 0) {
          redFlags.push({
            nodeId: nodeIdentifier,
            nodeTitle: nodeTitle(node),
            type: 'all_of_branch_unsupported',
            description:
              `${weak.length} of ${branchResults.length} mandated branches at ` +
              `"${nodeTitle(node)}" are not supported by the patient data`,
            branches: weak.map(b => ({
              nodeId: b.targetId,
              title: b.title,
              confidence: b.confidence,
              topExcludeReason: b.excludeReason,
            })),
          });
        }
      }

      // A choice already made must SURVIVE re-disposition. Without this, an
      // ancestor retraversal re-disposes the DecisionPoint, finds several
      // qualifying branches again and re-pends — silently discarding the
      // provider's decision and re-asking a question they already answered.
      //
      // Narrowing `includedBranches` rather than routing here on purpose: the
      // normal path below already excludes the other branches AND their
      // subtrees. Re-implementing that closing logic for this case is exactly
      // the duplication plan 03 removed.
      const storedChoice = gateAnswers.get(nodeIdentifier)?.selectedOption;

      // A stored choice that no longer QUALIFIES is a decision the data has
      // overtaken, and it must be re-decided rather than quietly replaced.
      //
      // Falling through here used to let the fork auto-select whenever exactly
      // one OTHER branch qualified: the provider chose A, new data made A
      // unsupportable and B supportable, and the session silently moved to B
      // while still storing the answer "A". A branch switch nobody was told
      // about is the multi-arm defect's quieter cousin — one arm, just not the
      // one anyone picked.
      const staleChoice =
        branchMode === 'one_of' &&
        storedChoice !== undefined &&
        !includedBranches.includes(storedChoice);

      if (
        branchMode === 'one_of' &&
        storedChoice !== undefined &&
        includedBranches.includes(storedChoice)
      ) {
        const chosenTitle =
          branchResults.find(b => b.targetId === storedChoice)?.title ?? storedChoice;
        for (const br of branchResults) {
          if (br.targetId !== storedChoice) {
            br.excludeReason = `Not selected at "${nodeTitle(node)}" — chose "${chosenTitle}"`;
          }
        }
        includedBranches.length = 0;
        includedBranches.push(storedChoice);
      }

      // An exclusive fork with more than one qualifying branch has NOT been
      // decided by the data. Ranking the candidates and taking the top one
      // would be the same silent routing this work exists to remove, with
      // better arithmetic — and on a one_of fork the branches are typically
      // mutually exclusive treatments.
      // A stale choice with nothing left to choose is not a question — it is a
      // fork the data has closed. Pending it produced `options: []`, and
      // answerPendingDecision rejects every answer because nothing is a
      // candidate: a session that cannot be finished or abandoned.
      const staleWithNoAlternative = staleChoice && includedBranches.length === 0;

      if (
        branchMode === 'one_of' &&
        !staleWithNoAlternative &&
        (includedBranches.length > 1 || staleChoice)
      ) {
        resolutionState.set(nodeIdentifier, {
          nodeId: nodeIdentifier,
          nodeType: node.nodeType,
          title: nodeTitle(node),
          status: NodeStatus.PENDING_QUESTION,
          confidence: 0,
          confidenceBreakdown: [],
          excludeReason: staleChoice
            ? `The chosen branch no longer qualifies on the current data — re-decide`
            : `${includedBranches.length} branches qualify on an exclusive decision`,
          parentNodeId,
          depth,
          properties: node.properties,
        });

        // NOTHING is traversed. Marking the candidates and their subtrees
        // PENDING_QUESTION rather than leaving them absent keeps the session's
        // node set complete, which plan 03 made an invariant.
        for (const br of branchResults) {
          if (resolutionState.has(br.targetId)) continue;
          const targetNode = graphContext.getNode(br.targetId);
          if (!targetNode) continue;
          resolutionState.set(br.targetId, {
            nodeId: br.targetId,
            nodeType: targetNode.nodeType,
            title: br.title,
            status: NodeStatus.PENDING_QUESTION,
            confidence: br.confidence,
            confidenceBreakdown: [],
            excludeReason: `Awaiting branch choice at ${nodeTitle(node)}`,
            parentNodeId: nodeIdentifier,
            depth: depth + 1,
            properties: targetNode.properties,
          });
          const kids = graphContext.outgoingEdges(br.targetId).map(e => e.targetId);
          addAll(rewritten, markSubtree(kids, graphContext, resolutionState, NodeStatus.PENDING_QUESTION,
            `Awaiting branch choice at ${nodeTitle(node)}`, br.targetId, depth + 1, provisional, overrideHeld));
        }

        pendingQuestions.push({
          gateId: nodeIdentifier,
          prompt: staleChoice
            ? `${nodeTitle(node)} — the branch chosen earlier no longer applies; which now?`
            : `${nodeTitle(node)} — which branch applies?`,
          answerType: AnswerType.SELECT,
          options: includedBranches,
          optionLabels: includedBranches.map(
            id => branchResults.find(b => b.targetId === id)?.title ?? id,
          ),
          affectedSubtreeSize: countSubtree(includedBranches, graphContext),
          estimatedImpact: 'high',
        });
        return;
      }

      // Decision point itself is always included
      resolutionState.set(nodeIdentifier, {
        nodeId: nodeIdentifier,
        nodeType: node.nodeType,
        title: nodeTitle(node),
        status: NodeStatus.INCLUDED,
        confidence: 1,
        confidenceBreakdown: [],
        parentNodeId,
        depth,
        properties: node.properties,
      });

      // Record branch results
      for (const br of branchResults) {
        if (includedBranches.includes(br.targetId)) {
          // Enqueue included branches for further traversal
          if (enqueueable(br.targetId)) {
            queue.push({ nodeIdentifier: br.targetId, parentNodeId: nodeIdentifier, depth: depth + 1 });
          }
        } else {
          // Exclude branch
          const targetNode = graphContext.getNode(br.targetId);
          if (targetNode && enqueueable(br.targetId)) {
            resolutionState.set(br.targetId, {
              nodeId: br.targetId,
              nodeType: targetNode.nodeType,
              title: br.title,
              status: NodeStatus.EXCLUDED,
              confidence: br.confidence,
              confidenceBreakdown: [],
              excludeReason: br.excludeReason,
              parentNodeId: nodeIdentifier,
              depth: depth + 1,
              properties: targetNode.properties,
            });
            // Mark the excluded branch's subtree too
            const childIds = graphContext.outgoingEdges(br.targetId).map(e => e.targetId);
            addAll(rewritten, markSubtree(childIds, graphContext, resolutionState, NodeStatus.EXCLUDED,
              `Excluded by decision point: ${br.excludeReason}`, br.targetId, depth + 1, provisional, overrideHeld));
          }
        }
        recordInfluence(dependencyMap, nodeIdentifier, br.targetId);
      }

      // Red flag: all branches excluded
      if (branches.length > 0 && includedBranches.length === 0) {
        redFlags.push({
          nodeId: nodeIdentifier,
          nodeTitle: nodeTitle(node),
          type: 'all_branches_excluded',
          description: `All ${branches.length} branches of decision point "${nodeTitle(node)}" scored below suggest threshold`,
          branches: branchResults.map(br => ({
            nodeId: br.targetId,
            title: br.title,
            confidence: br.confidence,
            topExcludeReason: br.excludeReason,
          })),
        });
      }

      // Also traverse non-BRANCHES_TO children (structural edges)
      const nonBranchEdges = graphContext.outgoingEdges(nodeIdentifier)
        .filter(e => e.edgeType !== 'BRANCHES_TO');
      for (const edge of nonBranchEdges) {
        if (enqueueable(edge.targetId)) {
          queue.push({ nodeIdentifier: edge.targetId, parentNodeId: nodeIdentifier, depth: depth + 1 });
        }
      }
      return;
    }

    // ── Structural nodes (Stage, Step) ─────────────────────────────
    if (isStructuralNode(node) || node.nodeType === 'Pathway') {
      // Always traverse children, compute aggregate confidence later if needed
      const confResult = await this.confidenceEngine.computeNodeConfidence(
        node, graphContext, patientContext,
      );
      recordScorerInputs(dependencyMap, nodeIdentifier, confResult.contextInputs);

      resolutionState.set(nodeIdentifier, {
        nodeId: nodeIdentifier,
        nodeType: node.nodeType,
        title: nodeTitle(node),
        status: NodeStatus.INCLUDED,
        confidence: confResult.confidence,
        confidenceBreakdown: confResult.breakdown,
        parentNodeId,
        depth,
        properties: node.properties,
      });

      for (const edge of graphContext.outgoingEdges(nodeIdentifier)) {
        if (enqueueable(edge.targetId)) {
          queue.push({ nodeIdentifier: edge.targetId, parentNodeId: nodeIdentifier, depth: depth + 1 });
        }
      }
      return;
    }

    // ── Action nodes (Medication, LabTest, etc.) ───────────────────
    if (isActionNode(node)) {
      const confResult = await this.confidenceEngine.computeNodeConfidence(
        node, graphContext, patientContext,
      );
      recordScorerInputs(dependencyMap, nodeIdentifier, confResult.contextInputs);

      // An `all_of` mandate outranks the threshold. The fork already
      // red-flagged this branch as unsupported, which reports the
      // disagreement; excluding it here would resolve the disagreement by
      // dropping a step the pathway says always happens.
      const isMandated = mandated.has(nodeIdentifier);
      const status = isMandated || confResult.confidence >= this.thresholds.suggestThreshold
        ? NodeStatus.INCLUDED
        : NodeStatus.EXCLUDED;

      const excludeReason = status === NodeStatus.EXCLUDED
        ? `Confidence ${confResult.confidence} below suggest threshold ${this.thresholds.suggestThreshold}`
        : undefined;

      resolutionState.set(nodeIdentifier, {
        nodeId: nodeIdentifier,
        nodeType: node.nodeType,
        title: nodeTitle(node),
        status,
        confidence: confResult.confidence,
        confidenceBreakdown: confResult.breakdown,
        excludeReason,
        parentNodeId,
        depth,
        properties: node.properties,
      });

      // Check for missing critical data
      const isCritical = node.properties.critical === true;
      if (isCritical) {
        const dataCompleteness = confResult.breakdown.find(
          (b: { signalName: string; score: number }) => b.signalName === 'data_completeness',
        );
        if (dataCompleteness && dataCompleteness.score === 0) {
          redFlags.push({
            nodeId: nodeIdentifier,
            nodeTitle: nodeTitle(node),
            type: 'missing_critical_data',
            description: `Critical node "${nodeTitle(node)}" has data_completeness score of 0`,
          });
        }
      }

      // Action nodes can still have children (e.g., CodeEntry)
      for (const edge of graphContext.outgoingEdges(nodeIdentifier)) {
        if (enqueueable(edge.targetId)) {
          queue.push({ nodeIdentifier: edge.targetId, parentNodeId: nodeIdentifier, depth: depth + 1 });
        }
      }
      return;
    }

    // ── Other nodes (Criterion, CodeEntry, Evidence, etc.) ─────────
    resolutionState.set(nodeIdentifier, {
      nodeId: nodeIdentifier,
      nodeType: node.nodeType,
      title: nodeTitle(node),
      status: NodeStatus.INCLUDED,
      confidence: 1,
      confidenceBreakdown: [],
      parentNodeId,
      depth,
      properties: node.properties,
    });

    for (const edge of graphContext.outgoingEdges(nodeIdentifier)) {
      if (enqueueable(edge.targetId)) {
        queue.push({ nodeIdentifier: edge.targetId, parentNodeId: nodeIdentifier, depth: depth + 1 });
      }
    }
  }
  /**
   * Resolve a node OUT OF BFS ORDER, because a `prior_node_result` gate
   * depends on it and cannot decide until it has a status.
   *
   * This used to be a SECOND disposition implementation, and it disagreed with
   * the first on nearly everything that matters: an unsatisfied gate became
   * GATED_OUT regardless of `default_behavior`, an unanswered question never
   * pended, an unresolved gate never escalated, a decided gate never routed,
   * and a DecisionPoint was blindly INCLUDED whatever its `branch_mode` said.
   * So a gate could observe a different dependency status for no reason but
   * the order traversal happened to reach it — the exact defect family plan 03
   * unified the engines to remove, surviving in the one path that had not been
   * looked at.
   *
   * It now calls `disposeNode`, so a node means the same thing however it was
   * reached. The cycle guard and timeout check stay: they are about eager
   * ENTRY, not about how a node is disposed.
   *
   * Passing the real `w.queue` also fixes a quieter bug. Eager evaluation
   * writes the node into `resolutionState`, and the main BFS skips anything
   * already there — so whatever this node opened up was never enqueued by
   * anyone, and its subtree silently vanished from the session. Disposing it
   * through the shared walk context enqueues its children like any other node.
   */
  private async evaluateNodeEagerly(
    nodeIdentifier: string,
    parentNodeId: string | undefined,
    depth: number,
    w: WalkContext,
  ): Promise<void> {
    if (w.resolutionState.has(nodeIdentifier)) return;
    if (Date.now() - w.startTime > TRAVERSAL_TIMEOUT_MS) return;

    const node = w.graphContext.getNode(nodeIdentifier);
    if (!node) return;

    w.evaluationStack.add(nodeIdentifier);
    // A THROWAWAY queue: this node is being resolved so a gate can read its
    // status, not because the walk reached it. Enqueuing its children here
    // would claim reachability the graph has not granted — that is how a
    // treatment under a branch that shuts ended up in the plan. If the walk
    // legitimately arrives, it re-disposes the node with the real queue and
    // the subtree opens then.
    await this.disposeNode(node, nodeIdentifier, parentNodeId, depth, { ...w, queue: [] });
    w.provisional.add(nodeIdentifier);
    w.evaluationStack.delete(nodeIdentifier);
  }
}
