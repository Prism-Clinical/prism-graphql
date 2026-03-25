import { GraphContext, PatientContext, GraphNode, GraphEdge, NodeConfidenceResult } from '../confidence/types';
import { evaluateGate } from './gate-evaluator';
import {
  NodeResult,
  NodeStatus,
  GateAnswer,
  GateProperties,
  GateType,
  DefaultBehavior,
  AnswerType,
  TraversalResult,
  DependencyMap,
  PendingQuestion,
  RedFlag,
  ResolutionState,
  createEmptyDependencyMap,
  TRAVERSAL_TIMEOUT_MS,
  STRUCTURAL_NODE_TYPES,
  ACTION_NODE_TYPES,
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
function markSubtree(
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

// ─── Traversal Engine ─────────────────────────────────────────────────

export class TraversalEngine {
  constructor(
    private confidenceEngine: { computeNodeConfidence: (...args: unknown[]) => Promise<NodeConfidenceResult> },
    private thresholds: { autoResolveThreshold: number; suggestThreshold: number },
  ) {}

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
          });
        }
        break;
      }

      // Skip if already resolved (memoized)
      if (resolutionState.has(nodeIdentifier)) continue;

      const node = graphContext.getNode(nodeIdentifier);
      if (!node) continue;

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
            continue;
          }
        }

        const gateResult = evaluateGate(
          gateProps, patientContext, resolutionState, gateAnswers, nodeIdentifier,
        );

        // Record dependencies
        recordGateContextFields(dependencyMap, nodeIdentifier, gateResult.contextFieldsRead);
        for (const depNodeId of gateResult.dependedOnNodes) {
          recordInfluence(dependencyMap, depNodeId, nodeIdentifier);
        }

        if (gateResult.satisfied) {
          // Gate satisfied — include gate and traverse children
          resolutionState.set(nodeIdentifier, {
            nodeId: nodeIdentifier,
            nodeType: node.nodeType,
            title: nodeTitle(node),
            status: NodeStatus.INCLUDED,
            confidence: 1,
            confidenceBreakdown: [],
            parentNodeId,
            depth,
          });
          for (const edge of graphContext.outgoingEdges(nodeIdentifier)) {
            if (!resolutionState.has(edge.targetId)) {
              queue.push({ nodeIdentifier: edge.targetId, parentNodeId: nodeIdentifier, depth: depth + 1 });
            }
          }
        } else {
          // Gate not satisfied
          const isQuestion = gateProps.gate_type === GateType.QUESTION;
          const answer = gateAnswers.get(nodeIdentifier);
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
            });
            for (const edge of graphContext.outgoingEdges(nodeIdentifier)) {
              if (!resolutionState.has(edge.targetId)) {
                queue.push({ nodeIdentifier: edge.targetId, parentNodeId: nodeIdentifier, depth: depth + 1 });
              }
            }
          }
        }
        continue;
      }

      // ── DecisionPoint ──────────────────────────────────────────────
      if (isDecisionPoint(node)) {
        const branches = graphContext.outgoingEdges(nodeIdentifier)
          .filter(e => e.edgeType === 'BRANCHES_TO');

        const branchResults: Array<{ targetId: string; confidence: number; title: string; excludeReason: string }> = [];
        const includedBranches: string[] = [];

        for (const branch of branches) {
          const targetNode = graphContext.getNode(branch.targetId);
          if (!targetNode) continue;

          const confResult = await this.confidenceEngine.computeNodeConfidence(
            targetNode, graphContext, patientContext,
          );

          const conf = confResult.confidence;
          const reason = conf < this.thresholds.suggestThreshold
            ? `Confidence ${conf} below suggest threshold ${this.thresholds.suggestThreshold}`
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
              });
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
        continue;
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
        });

        for (const edge of graphContext.outgoingEdges(nodeIdentifier)) {
          if (!resolutionState.has(edge.targetId)) {
            queue.push({ nodeIdentifier: edge.targetId, parentNodeId: nodeIdentifier, depth: depth + 1 });
          }
        }
        continue;
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
        continue;
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
      });

      for (const edge of graphContext.outgoingEdges(nodeIdentifier)) {
        if (!resolutionState.has(edge.targetId)) {
          queue.push({ nodeIdentifier: edge.targetId, parentNodeId: nodeIdentifier, depth: depth + 1 });
        }
      }
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
      });
    } else {
      // For other node types, just include
      resolutionState.set(nodeIdentifier, {
        nodeId: nodeIdentifier,
        nodeType: node.nodeType,
        title: nodeTitle(node),
        status: NodeStatus.INCLUDED,
        confidence: 1,
        confidenceBreakdown: [],
        parentNodeId,
        depth,
      });
    }

    evaluationStack.delete(nodeIdentifier);
  }
}
