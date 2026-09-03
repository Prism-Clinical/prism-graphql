import { GraphContext, PatientContext, GraphNode } from '../confidence/types';
import { assertEngineCodeMap, evaluateGate, LlmGateEvaluator } from './gate-evaluator';
import type { GateEvaluationDeps } from './gate-evaluator';
import type { PathwayTemporalDefaults } from './temporal/cascade';
import type { FactStore } from './temporal/fact-model';
import { EvaluationTemporalContext } from './temporal/evaluation-context';
import { askFor } from './unresolved-prompt';
import { parseBranchWhen } from '../import/branch-when';
import { decisionValueOf, decisionSelects } from './decision-value';
import type { UnresolvedAsk } from './unresolved-prompt';
import {
  NodeResult,
  NodeStatus,
  GateAnswer,
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
  gateResult: { indeterminate?: boolean; dataUnavailable?: boolean },
): UnresolvedAsk | null {
  const couldNotDecide =
    gateResult.indeterminate === true || gateResult.dataUnavailable === true;
  if (!couldNotDecide) return null;
  if (gateProps.on_unresolved === 'default') return null;

  const conditions = gateProps.conditions ?? (gateProps.condition ? [gateProps.condition] : []);
  for (const condition of conditions) {
    const ask = askFor(condition);
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
): void {
  if (resolutionState.has(targetId)) return;
  const target = graphContext.getNode(targetId);
  if (!target) return;

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
  markSubtree(kids, graphContext, resolutionState, NodeStatus.EXCLUDED,
    `Excluded with ${nodeTitle(target)}`, targetId, depth + 1);
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
export function markSubtree(
  startIds: string[],
  graphContext: GraphContext,
  resolutionState: ResolutionState,
  status: NodeStatus,
  excludeReason: string,
  parentNodeId: string,
  baseDepth: number,
): Set<string> {
  const marked = new Set<string>();
  const queue: Array<{ id: string; depth: number }> = startIds.map(id => ({ id, depth: baseDepth + 1 }));

  while (queue.length > 0) {
    const { id, depth } = queue.shift()!;
    // Design: first-writer-wins for diamond-shaped graphs. If a node is
    // reachable via multiple paths, the first path to evaluate it determines
    // its status. BFS ordering is deterministic for a given graph structure.
    if (marked.has(id) || resolutionState.has(id)) continue;
    marked.add(id);

    const node = graphContext.getNode(id);
    if (!node) continue;

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
      if (!marked.has(edge.targetId) && !resolutionState.has(edge.targetId)) {
        queue.push({ id: edge.targetId, depth: depth + 1 });
      }
    }
  }
  return marked;
}

// ─── Record dependency helpers ────────────────────────────────────────

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
        pendingQuestions, redFlags, evaluationStack, startTime,
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
  ): Promise<IncrementalResult> {
    const startTime = Date.now();
    const pendingQuestions: PendingQuestion[] = [];
    const redFlags: RedFlag[] = [];
    const evaluationStack = new Set<string>();
    const queue: BfsEntry[] = [];

    // Captured before anything is cleared — the only moment the previous
    // status of each node in the region is still known.
    const statusBefore = new Map<string, NodeStatus>();
    /** Where each region node sat, so a timed-out rebuild can be put back. */
    const priorPlacement = new Map<string, { depth: number; parentNodeId?: string }>();

    // The region a seed can reach. Bounded by the graph, so it is finite and
    // needs no visited-set of its own beyond `region`.
    const region = new Set<string>();
    const frontier = [...seedNodeIds];
    while (frontier.length > 0) {
      const id = frontier.shift()!;
      if (region.has(id)) continue;
      region.add(id);
      for (const edge of graphContext.outgoingEdges(id)) {
        if (!region.has(edge.targetId)) frontier.push(edge.targetId);
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
        for (const edge of graphContext.outgoingEdges(id)) {
          queue.push({
            nodeIdentifier: edge.targetId,
            parentNodeId: id,
            depth: existing.depth + 1,
          });
        }
        continue;
      }
      resolutionState.delete(id);
    }

    for (const id of seedNodeIds) {
      if (!resolutionState.has(id)) {
        queue.push({ nodeIdentifier: id, parentNodeId: undefined, depth: 0 });
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
      if (resolutionState.has(nodeIdentifier)) continue;

      const node = graphContext.getNode(nodeIdentifier);
      if (!node) continue;

      await this.disposeNode(node, nodeIdentifier, parentNodeId, depth, {
        graphContext, patientContext, gateAnswers,
        resolutionState, dependencyMap, queue,
        pendingQuestions, redFlags, evaluationStack, startTime,
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

    return {
      resolutionState,
      dependencyMap,
      pendingQuestions,
      redFlags,
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
      pendingQuestions, redFlags, evaluationStack, startTime,
    } = w;

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
            await this.evaluateNodeEagerly(
              dep.node_id, graphContext, patientContext, gateAnswers,
              resolutionState, dependencyMap, pendingQuestions, redFlags,
              evaluationStack, startTime, parentNodeId, depth,
            );
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
            markSubtree(childIds, graphContext, resolutionState, NodeStatus.GATED_OUT,
              'Parent gate has cycle — default skip', nodeIdentifier, depth);
          } else {
            // Traverse children
            for (const edge of graphContext.outgoingEdges(nodeIdentifier)) {
              if (!resolutionState.has(edge.targetId)) {
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

        // A multi-target gate the engine cannot derive a decision for — a
        // chart-evaluated patient_attribute gate, say. Import validation
        // refuses these, so reaching here means a graph stored before that
        // rule. Traversing every branch would emit mutually exclusive
        // treatments together, so close them all and SAY SO: silence here
        // would read as "the pathway had nothing to add".
        if (routes && decision === null) {
          redFlags.push({
            nodeId: nodeIdentifier,
            nodeTitle: nodeTitle(node),
            type: 'unroutable_decision',
            description:
              `"${nodeTitle(node)}" has ${branchTargets.length} branches but produced no ` +
              `answer to route on, so none were taken. This gate type cannot be routed yet.`,
          });
        }

        for (const edge of outgoing) {
            if (routes && edge.edgeType === 'BRANCHES_TO') {
              const when = parseBranchWhen(edge.properties?.when);
              if (!when || !decision || !decisionSelects(when, decision)) {
                // Say WHY the other treatments are absent. An unexplained
                // missing branch reads as an oversight rather than a decision.
                markBranchNotSelected(
                  edge.targetId, nodeIdentifier, nodeTitle(node), depth,
                  graphContext, resolutionState,
                );
                continue;
              }
            }
            if (!resolutionState.has(edge.targetId)) {
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
          markSubtree(childIds, graphContext, resolutionState, NodeStatus.PENDING_QUESTION,
            `Awaiting answer to: ${gateProps.prompt ?? gateProps.title}`, nodeIdentifier, depth);

          pendingQuestions.push({
            gateId: nodeIdentifier,
            prompt: gateProps.prompt ?? gateProps.title,
            answerType: gateProps.answer_type ?? AnswerType.BOOLEAN,
            options: gateProps.options,
            affectedSubtreeSize: subtreeSize,
            estimatedImpact: subtreeSize > 3 ? 'high' : subtreeSize > 1 ? 'medium' : 'low',
          });
        } else if (unresolvedAsk(gateProps, gateResult)) {
          // The gate could not DECIDE — as opposed to deciding "no". Ask for
          // the datum it needed rather than silently taking default_behavior,
          // which is what made a missing haemoglobin indistinguishable from a
          // normal one.
          //
          // `unresolvedAsk` returns null for every class with no honest
          // question (membership, aggregate) and whenever the author set
          // on_unresolved: 'default', so this arm cannot fire on them.
          const ask = unresolvedAsk(gateProps, gateResult)!;

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
          markSubtree(childIds, graphContext, resolutionState, NodeStatus.PENDING_QUESTION,
            `Awaiting ${ask.datumKey}`, nodeIdentifier, depth);

          // Dedup on the DATUM, not the gate. Both gates still hold their
          // subtrees; the provider is asked once, and the one injected fact
          // resolves every gate reading it.
          if (!pendingQuestions.some(q => q.datumKey === ask.datumKey)) {
            pendingQuestions.push({
              gateId: nodeIdentifier,
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
        } else if (gateProps.default_behavior === DefaultBehavior.SKIP) {
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
          markSubtree(childIds, graphContext, resolutionState, NodeStatus.GATED_OUT,
            `Gated out by ${nodeTitle(node)}: ${gateResult.reason}`, nodeIdentifier, depth);
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
            if (!resolutionState.has(edge.targetId)) {
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
      if (branchMode === 'one_of' && includedBranches.length > 1) {
        resolutionState.set(nodeIdentifier, {
          nodeId: nodeIdentifier,
          nodeType: node.nodeType,
          title: nodeTitle(node),
          status: NodeStatus.PENDING_QUESTION,
          confidence: 0,
          confidenceBreakdown: [],
          excludeReason:
            `${includedBranches.length} branches qualify on an exclusive decision`,
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
          markSubtree(kids, graphContext, resolutionState, NodeStatus.PENDING_QUESTION,
            `Awaiting branch choice at ${nodeTitle(node)}`, br.targetId, depth + 1);
        }

        pendingQuestions.push({
          gateId: nodeIdentifier,
          prompt: `${nodeTitle(node)} — which branch applies?`,
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
          if (!resolutionState.has(br.targetId)) {
            queue.push({ nodeIdentifier: br.targetId, parentNodeId: nodeIdentifier, depth: depth + 1 });
          }
        } else {
          // Exclude branch
          const targetNode = graphContext.getNode(br.targetId);
          if (targetNode && !resolutionState.has(br.targetId)) {
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
            markSubtree(childIds, graphContext, resolutionState, NodeStatus.EXCLUDED,
              `Excluded by decision point: ${br.excludeReason}`, br.targetId, depth + 1);
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
        if (!resolutionState.has(edge.targetId)) {
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
        if (!resolutionState.has(edge.targetId)) {
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

      const status = confResult.confidence >= this.thresholds.suggestThreshold
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
        if (!resolutionState.has(edge.targetId)) {
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
      if (!resolutionState.has(edge.targetId)) {
        queue.push({ nodeIdentifier: edge.targetId, parentNodeId: nodeIdentifier, depth: depth + 1 });
      }
    }
  }
  /**
   * Eagerly evaluate a single node during lazy gate evaluation.
   * This handles the case where a prior_node_result gate depends on a node
   * that hasn't been evaluated yet.
   */
  private async evaluateNodeEagerly(
    nodeIdentifier: string,
    graphContext: GraphContext,
    patientContext: PatientContext,
    gateAnswers: Map<string, GateAnswer>,
    resolutionState: ResolutionState,
    dependencyMap: DependencyMap,
    pendingQuestions: PendingQuestion[],
    redFlags: RedFlag[],
    evaluationStack: Set<string>,
    startTime: number,
    parentNodeId: string | undefined,
    depth: number,
  ): Promise<void> {
    if (resolutionState.has(nodeIdentifier)) return;
    if (Date.now() - startTime > TRAVERSAL_TIMEOUT_MS) return;

    const node = graphContext.getNode(nodeIdentifier);
    if (!node) return;

    evaluationStack.add(nodeIdentifier);

    if (isActionNode(node) || isStructuralNode(node)) {
      const confResult = await this.confidenceEngine.computeNodeConfidence(
        node, graphContext, patientContext,
      );

      const status = isStructuralNode(node)
        ? NodeStatus.INCLUDED
        : (confResult.confidence >= this.thresholds.suggestThreshold
          ? NodeStatus.INCLUDED
          : NodeStatus.EXCLUDED);

      resolutionState.set(nodeIdentifier, {
        nodeId: nodeIdentifier,
        nodeType: node.nodeType,
        title: nodeTitle(node),
        status,
        confidence: confResult.confidence,
        confidenceBreakdown: confResult.breakdown,
        excludeReason: status === NodeStatus.EXCLUDED
          ? `Confidence ${confResult.confidence} below suggest threshold ${this.thresholds.suggestThreshold}`
          : undefined,
        parentNodeId,
        depth,
        properties: node.properties,
      });
    } else if (node.nodeType === 'Gate') {
      // For gate nodes, evaluate the gate properly
      const gateProps = node.properties as unknown as GateProperties;
      const gateResult = await evaluateGate(
        gateProps,
        this.gateDeps(patientContext, resolutionState, gateAnswers, nodeIdentifier),
      );
      resolutionState.set(nodeIdentifier, {
        nodeId: nodeIdentifier,
        nodeType: node.nodeType,
        title: nodeTitle(node),
        status: gateResult.satisfied ? NodeStatus.INCLUDED : NodeStatus.GATED_OUT,
        confidence: gateResult.satisfied ? 1 : 0,
        confidenceBreakdown: [],
        excludeReason: gateResult.satisfied ? undefined : gateResult.reason,
        parentNodeId,
        depth,
        properties: node.properties,
        // Eager path: a prior_node_result gate can force its dependency to be
        // evaluated here rather than in the main BFS. That gate is just as
        // capable of being indeterminate, and a reason channel that only works
        // on one of two evaluation paths is worse than none — the same gate
        // would report differently depending on the order it was reached.
        ...uncertaintyOf(gateResult),
      });
    } else if (node.nodeType === 'DecisionPoint') {
      // DecisionPoint: include it, branches will be evaluated during main BFS
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
    } else {
      // For other node types (Criterion, Evidence, CodeEntry), just include
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
    }

    evaluationStack.delete(nodeIdentifier);
  }
}
