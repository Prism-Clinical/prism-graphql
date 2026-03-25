import { GraphContext, PatientContext, SignalBreakdown } from '../confidence/types';
import {
  NodeResult,
  NodeStatus,
  DependencyMap,
  RetraversalResult,
  PendingQuestion,
  RedFlag,
  GateAnswer,
  GateProperties,
  RETRAVERSAL_TIMEOUT_MS,
  MAX_CASCADE_DEPTH,
  STRUCTURAL_NODE_TYPES,
  ACTION_NODE_TYPES,
  AnswerType,
} from './types';
import { evaluateGate } from './gate-evaluator';

// ─── Helpers ──────────────────────────────────────────────────────────

function determineStatusFromConfidence(
  confidence: number,
  autoResolveThreshold: number,
  suggestThreshold: number,
): NodeStatus {
  if (confidence >= autoResolveThreshold) return NodeStatus.INCLUDED;
  if (confidence < suggestThreshold) return NodeStatus.EXCLUDED;
  return NodeStatus.INCLUDED; // between suggest and auto-resolve: include but may need review
}

function topologicalOrder(
  nodeIds: Set<string>,
  dependencyMap: DependencyMap,
): string[] {
  const sorted: string[] = [];
  const visited = new Set<string>();
  const visiting = new Set<string>();

  function visit(id: string): void {
    if (visited.has(id)) return;
    if (visiting.has(id)) return; // cycle — break it
    if (!nodeIds.has(id)) return;
    visiting.add(id);
    const deps = dependencyMap.influencedBy.get(id);
    if (deps) {
      for (const dep of deps) {
        visit(dep);
      }
    }
    visiting.delete(id);
    visited.add(id);
    sorted.push(id);
  }

  for (const id of nodeIds) {
    visit(id);
  }
  return sorted;
}

// ─── RetraversalEngine ───────────────────────────────────────────────

export class RetraversalEngine {
  constructor(
    private confidenceEngine: { computeNodeConfidence: (...args: unknown[]) => Promise<{
      confidence: number;
      breakdown: SignalBreakdown[];
      resolutionType: string;
    }> },
    private thresholds: { autoResolveThreshold: number; suggestThreshold: number },
  ) {}

  async retraverse(
    affectedNodeIds: Set<string>,
    resolutionState: Map<string, NodeResult>,
    dependencyMap: DependencyMap,
    graphContext: GraphContext,
    patientContext: PatientContext,
    gateAnswers: Map<string, GateAnswer>,
  ): Promise<RetraversalResult> {
    const startTime = Date.now();
    const statusChanges: Array<{ nodeId: string; from: string; to: string }> = [];
    const newPendingQuestions: PendingQuestion[] = [];
    const newRedFlags: RedFlag[] = [];
    let nodesRecomputed = 0;

    // Queue with cascade depth tracking
    const queue: Array<{ nodeId: string; cascadeDepth: number }> = [];
    const enqueued = new Set<string>();

    // Seed the queue from affected nodes
    const ordered = topologicalOrder(affectedNodeIds, dependencyMap);
    for (const nodeId of ordered) {
      queue.push({ nodeId, cascadeDepth: 0 });
      enqueued.add(nodeId);
    }

    while (queue.length > 0) {
      // Timeout check
      if (Date.now() - startTime > RETRAVERSAL_TIMEOUT_MS) {
        break;
      }

      const { nodeId, cascadeDepth } = queue.shift()!;
      enqueued.delete(nodeId);

      // Cascade depth limit
      if (cascadeDepth >= MAX_CASCADE_DEPTH) {
        const existing = resolutionState.get(nodeId);
        if (existing && existing.status !== NodeStatus.CASCADE_LIMIT) {
          statusChanges.push({ nodeId, from: existing.status, to: NodeStatus.CASCADE_LIMIT });
          existing.status = NodeStatus.CASCADE_LIMIT;
        }
        continue;
      }

      const existing = resolutionState.get(nodeId);
      if (!existing) continue;

      const previousStatus = existing.status;
      nodesRecomputed++;

      // Re-evaluate the node
      let newStatus: NodeStatus;

      if (existing.nodeType === 'Gate') {
        // Gate nodes: re-evaluate the gate
        const graphNode = graphContext.getNode(nodeId);
        const gateProps = graphNode?.properties as unknown as GateProperties | undefined;
        if (gateProps) {
          const gateResult = evaluateGate(
            gateProps,
            patientContext,
            resolutionState,
            gateAnswers,
            nodeId,
          );
          if (!gateResult.satisfied && gateProps.prompt && gateProps.answer_type && !gateAnswers.has(nodeId)) {
            newStatus = NodeStatus.PENDING_QUESTION;
            newPendingQuestions.push({
              gateId: nodeId,
              prompt: gateProps.prompt,
              answerType: gateProps.answer_type as AnswerType,
              options: gateProps.options,
              affectedSubtreeSize: 0,
              estimatedImpact: 'unknown',
            });
          } else {
            newStatus = gateResult.satisfied ? NodeStatus.INCLUDED : NodeStatus.GATED_OUT;
          }
        } else {
          newStatus = previousStatus;
        }
      } else if (STRUCTURAL_NODE_TYPES.has(existing.nodeType)) {
        // Structural nodes: keep included (they are always traversed)
        newStatus = NodeStatus.INCLUDED;
      } else {
        // Action nodes and others: re-compute confidence
        const result = await this.confidenceEngine.computeNodeConfidence(
          nodeId, graphContext, patientContext,
        );
        existing.confidence = result.confidence;
        existing.confidenceBreakdown = result.breakdown;
        newStatus = determineStatusFromConfidence(
          result.confidence,
          this.thresholds.autoResolveThreshold,
          this.thresholds.suggestThreshold,
        );
      }

      // Check for provider override — don't change overridden nodes
      if (existing.providerOverride) {
        continue;
      }

      existing.status = newStatus;

      // If status changed, propagate to dependents
      if (newStatus !== previousStatus) {
        statusChanges.push({ nodeId, from: previousStatus, to: newStatus });

        // Add influenced nodes to queue
        const influenced = dependencyMap.influences.get(nodeId);
        if (influenced) {
          for (const depId of influenced) {
            if (!enqueued.has(depId)) {
              queue.push({ nodeId: depId, cascadeDepth: cascadeDepth + 1 });
              enqueued.add(depId);
            }
          }
        }
      }
    }

    return {
      statusChanges,
      nodesRecomputed,
      newPendingQuestions,
      newRedFlags,
    };
  }
}
