// apps/pathway-service/src/services/confidence/confidence-engine.ts

import { Pool } from 'pg';
import { ScorerRegistry } from './scorer-registry';
import { WeightCascadeResolver } from './weight-cascade-resolver';
import {
  GraphNode,
  GraphEdge,
  GraphContext,
  SignalDefinition,
  PatientContext,
  PathwayConfidenceResult,
  NodeConfidenceResult,
  SignalBreakdown,
  PropagationInfluence,
  PropagationConfig,
  ResolvedThresholds,
  ResolutionType,
  WeightMatrix,
  AdminEvidenceEntry,
} from './types';

export class ConfidenceEngine {
  constructor(
    private registry: ScorerRegistry,
    private cascadeResolver: WeightCascadeResolver,
  ) {}

  async computePathwayConfidence(params: {
    pool: Pool;
    pathwayId: string;
    nodes: GraphNode[];
    edges: GraphEdge[];
    signalDefinitions: SignalDefinition[];
    patientContext: PatientContext;
    institutionId?: string;
    organizationId?: string;
    adminEvidenceEntries?: AdminEvidenceEntry[];
  }): Promise<PathwayConfidenceResult> {
    const { pool, pathwayId, nodes, edges, signalDefinitions, patientContext, institutionId, organizationId } = params;

    // Load admin evidence entries (from params or DB)
    let adminEvidenceEntries = params.adminEvidenceEntries;
    if (!adminEvidenceEntries) {
      const adminEvResult = await pool.query(
        'SELECT * FROM confidence_admin_evidence WHERE pathway_id = $1',
        [pathwayId]
      );
      adminEvidenceEntries = adminEvResult.rows.map((row: any) => ({
        id: row.id,
        pathwayId: row.pathway_id,
        nodeIdentifier: row.node_identifier,
        title: row.title,
        source: row.source,
        year: row.year,
        evidenceLevel: row.evidence_level,
        url: row.url,
        notes: row.notes,
      }));
    }

    // Build graph context with convenience lookups
    const graphContext = this.buildGraphContext(nodes, edges);

    // Resolve weight matrix (all signals × all nodes)
    const weightMatrix = await this.cascadeResolver.resolveAllWeights({
      pool,
      pathwayId,
      signalDefinitions,
      nodeIdentifiers: nodes.map(n => ({ nodeIdentifier: n.nodeIdentifier, nodeType: n.nodeType })),
      institutionId,
      organizationId,
    });

    // Load node weights and propagation overrides in a single query
    const { nodeWeightMap, propagationOverrides } = await this.loadNodeWeightsAndOverrides(pool, pathwayId);

    // Resolve thresholds
    const thresholds = await this.cascadeResolver.resolveThresholds({
      pool,
      pathwayId,
      institutionId,
      organizationId,
    });

    // Score each (node, signal) pair
    const rawScores = new Map<string, Map<string, { score: number; missingInputs: string[] }>>();

    for (const node of nodes) {
      const nodeScores = new Map<string, { score: number; missingInputs: string[] }>();

      for (const signal of signalDefinitions) {
        const scorer = this.registry.get(signal.scoringType);
        if (!scorer) {
          nodeScores.set(signal.name, { score: 0.5, missingInputs: ['scorer_not_found'] });
          continue;
        }

        const result = scorer.score({
          node,
          signalDefinition: signal,
          patientContext,
          graphContext,
          adminEvidenceEntries,
        });

        nodeScores.set(signal.name, { score: result.score, missingInputs: result.missingInputs });
      }

      rawScores.set(node.nodeIdentifier, nodeScores);
    }

    // Propagation: topological sort then walk
    const propagationInfluences = this.applyPropagation(
      nodes, edges, signalDefinitions, rawScores, propagationOverrides
    );

    // Merge propagated scores into rawScores: take min(direct, worst propagated) per (node, signal)
    for (const [nodeId, influences] of propagationInfluences) {
      const nodeScores = rawScores.get(nodeId);
      if (!nodeScores) continue;

      // Group influences by signal, take the worst (lowest) propagated score per signal
      const worstBySignal = new Map<string, number>();
      for (const inf of influences) {
        const current = worstBySignal.get(inf.signalName);
        if (current === undefined || inf.propagatedScore < current) {
          worstBySignal.set(inf.signalName, inf.propagatedScore);
        }
      }

      for (const [signalName, propagatedScore] of worstBySignal) {
        const entry = nodeScores.get(signalName);
        if (entry && propagatedScore < entry.score) {
          entry.score = propagatedScore;
        }
      }
    }

    // Compute per-node confidence (weighted average of signal scores)
    const nodeResults: NodeConfidenceResult[] = [];

    for (const node of nodes) {
      const nodeScores = rawScores.get(node.nodeIdentifier)!;
      const nodeWeights = weightMatrix[node.nodeIdentifier] ?? {};
      const nodePropInfluences = propagationInfluences.get(node.nodeIdentifier) ?? [];

      const breakdown: SignalBreakdown[] = [];
      let weightedSum = 0;
      let totalWeight = 0;

      for (const signal of signalDefinitions) {
        const scoreEntry = nodeScores.get(signal.name);
        const weightEntry = nodeWeights[signal.name];

        if (!scoreEntry || !weightEntry) continue;

        const weight = weightEntry.weight;
        breakdown.push({
          signalName: signal.name,
          score: scoreEntry.score,
          weight,
          weightSource: weightEntry.source,
          missingInputs: scoreEntry.missingInputs,
        });

        weightedSum += scoreEntry.score * weight;
        totalWeight += weight;
      }

      const confidence = totalWeight > 0 ? weightedSum / totalWeight : 0;

      // Classify resolution type
      let resolutionType: ResolutionType;
      if (node.nodeType === 'DecisionPoint') {
        resolutionType = this.classifyResolution(node, confidence, thresholds);
      } else if (confidence >= thresholds.autoResolveThreshold) {
        resolutionType = ResolutionType.AUTO_RESOLVED;
      } else if (confidence >= thresholds.suggestThreshold) {
        resolutionType = ResolutionType.SYSTEM_SUGGESTED;
      } else {
        resolutionType = ResolutionType.PROVIDER_DECIDED;
      }

      nodeResults.push({
        nodeIdentifier: node.nodeIdentifier,
        nodeType: node.nodeType,
        confidence: Math.round(confidence * 1000) / 1000,
        resolutionType,
        breakdown,
        propagationInfluences: nodePropInfluences,
      });
    }

    // Pathway rollup: weighted average of node confidences using node weights
    let rollupWeightedSum = 0;
    let rollupTotalWeight = 0;
    for (const nr of nodeResults) {
      const nw = nodeWeightMap.get(nr.nodeIdentifier) ?? 1.0;
      rollupWeightedSum += nr.confidence * nw;
      rollupTotalWeight += nw;
    }
    const overallConfidence = rollupTotalWeight > 0
      ? rollupWeightedSum / rollupTotalWeight
      : 0;

    return {
      pathwayId,
      overallConfidence: Math.round(overallConfidence * 1000) / 1000,
      nodes: nodeResults,
    };
  }

  private buildGraphContext(nodes: GraphNode[], edges: GraphEdge[]): GraphContext {
    const nodeMap = new Map(nodes.map(n => [n.nodeIdentifier, n]));
    const inEdgeMap = new Map<string, GraphEdge[]>();
    const outEdgeMap = new Map<string, GraphEdge[]>();

    for (const node of nodes) {
      inEdgeMap.set(node.nodeIdentifier, []);
      outEdgeMap.set(node.nodeIdentifier, []);
    }
    for (const edge of edges) {
      inEdgeMap.get(edge.targetId)?.push(edge);
      outEdgeMap.get(edge.sourceId)?.push(edge);
    }

    return {
      allNodes: nodes,
      allEdges: edges,
      incomingEdges: (nodeId: string) => inEdgeMap.get(nodeId) ?? [],
      outgoingEdges: (nodeId: string) => outEdgeMap.get(nodeId) ?? [],
      getNode: (nodeId: string) => nodeMap.get(nodeId),
      linkedNodes: (nodeId: string, edgeType: string) => {
        const out = outEdgeMap.get(nodeId) ?? [];
        const targetIds = out.filter(e => e.edgeType === edgeType).map(e => e.targetId);
        return targetIds.map(id => nodeMap.get(id)).filter((n): n is GraphNode => n !== undefined);
      },
    };
  }

  private classifyResolution(
    node: GraphNode,
    confidence: number,
    thresholds: ResolvedThresholds
  ): ResolutionType {
    if (node.properties.auto_resolve_eligible === false) {
      return ResolutionType.FORCED_MANUAL;
    }

    if (confidence >= thresholds.autoResolveThreshold) {
      return ResolutionType.AUTO_RESOLVED;
    }

    if (confidence >= thresholds.suggestThreshold) {
      return ResolutionType.SYSTEM_SUGGESTED;
    }

    return ResolutionType.PROVIDER_DECIDED;
  }

  private applyPropagation(
    nodes: GraphNode[],
    edges: GraphEdge[],
    signalDefinitions: SignalDefinition[],
    rawScores: Map<string, Map<string, { score: number; missingInputs: string[] }>>,
    propagationOverrides: Map<string, Record<string, PropagationConfig>>
  ): Map<string, PropagationInfluence[]> {
    const influences = new Map<string, PropagationInfluence[]>();

    const sorted = this.topologicalSort(nodes, edges);
    if (!sorted) {
      console.warn(
        `[ConfidenceEngine] Cycle detected in pathway graph — propagation skipped. ` +
        `${nodes.length} nodes, ${edges.length} edges. Raw scores used without propagation.`
      );
      return influences;
    }

    const propagatedState = new Map<string, { score: number; hopDistance: number; originNodeId: string }>();
    const nodeMap = new Map(nodes.map(n => [n.nodeIdentifier, n]));
    const outEdgeMap = new Map<string, GraphEdge[]>();
    for (const node of nodes) outEdgeMap.set(node.nodeIdentifier, []);
    for (const edge of edges) outEdgeMap.get(edge.sourceId)?.push(edge);

    for (const node of sorted) {
      for (const signal of signalDefinitions) {
        const scorer = this.registry.get(signal.scoringType);
        if (!scorer?.propagate) continue;

        const nodeOverrides = propagationOverrides.get(node.nodeIdentifier);
        const effectiveConfig = nodeOverrides?.[signal.name] ?? signal.propagationConfig;

        if (effectiveConfig.mode === 'none') continue;

        const sourceScores = rawScores.get(node.nodeIdentifier);
        if (!sourceScores) continue;

        const rawScore = sourceScores.get(signal.name)?.score ?? 0.5;

        const stateKey = `${node.nodeIdentifier}:${signal.name}`;
        const incomingState = propagatedState.get(stateKey);

        // #7: For direct-mode, ignore transitive propagated state — use raw score only
        let effectiveScore: number;
        let baseHopDistance: number;
        if (effectiveConfig.mode === 'direct') {
          effectiveScore = rawScore;
          baseHopDistance = 0;
        } else {
          effectiveScore = incomingState ? Math.min(rawScore, incomingState.score) : rawScore;
          baseHopDistance = incomingState?.hopDistance ?? 0;
        }

        const outEdges = outEdgeMap.get(node.nodeIdentifier) ?? [];

        for (const edge of outEdges) {
          if (effectiveConfig.edgeTypes && !effectiveConfig.edgeTypes.includes(edge.edgeType)) {
            continue;
          }

          const hopDistance = baseHopDistance + 1;
          const result = scorer.propagate({
            sourceNode: node,
            sourceScore: effectiveScore,
            targetNode: nodeMap.get(edge.targetId) ?? node,
            edge,
            propagationConfig: effectiveConfig,
            hopDistance,
          });

          if (result.propagatedScore > 0 || result.shouldPropagate) {
            if (!influences.has(edge.targetId)) {
              influences.set(edge.targetId, []);
            }
            influences.get(edge.targetId)!.push({
              sourceNodeIdentifier: incomingState?.originNodeId ?? node.nodeIdentifier,
              signalName: signal.name,
              originalScore: rawScore,
              propagatedScore: result.propagatedScore,
              hopDistance,
            });

            if (result.shouldPropagate) {
              const targetKey = `${edge.targetId}:${signal.name}`;
              const existing = propagatedState.get(targetKey);
              if (!existing || result.propagatedScore < existing.score) {
                propagatedState.set(targetKey, {
                  score: result.propagatedScore,
                  hopDistance,
                  originNodeId: incomingState?.originNodeId ?? node.nodeIdentifier,
                });
              }
            }
          }
        }
      }
    }

    return influences;
  }

  private topologicalSort(nodes: GraphNode[], edges: GraphEdge[]): GraphNode[] | null {
    const inDegree = new Map<string, number>();
    const adjacency = new Map<string, string[]>();

    for (const node of nodes) {
      inDegree.set(node.nodeIdentifier, 0);
      adjacency.set(node.nodeIdentifier, []);
    }

    for (const edge of edges) {
      if (inDegree.has(edge.targetId)) {
        inDegree.set(edge.targetId, (inDegree.get(edge.targetId) ?? 0) + 1);
      }
      adjacency.get(edge.sourceId)?.push(edge.targetId);
    }

    const queue: string[] = [];
    for (const [nodeId, degree] of inDegree) {
      if (degree === 0) queue.push(nodeId);
    }

    const sorted: GraphNode[] = [];
    const nodeMap = new Map(nodes.map(n => [n.nodeIdentifier, n]));

    while (queue.length > 0) {
      const nodeId = queue.shift()!;
      const node = nodeMap.get(nodeId);
      if (node) sorted.push(node);

      for (const neighbor of adjacency.get(nodeId) ?? []) {
        const newDegree = (inDegree.get(neighbor) ?? 1) - 1;
        inDegree.set(neighbor, newDegree);
        if (newDegree === 0) queue.push(neighbor);
      }
    }

    if (sorted.length < nodes.length) {
      return null;
    }

    return sorted;
  }

  private async loadNodeWeightsAndOverrides(
    pool: Pool,
    pathwayId: string
  ): Promise<{
    nodeWeightMap: Map<string, number>;
    propagationOverrides: Map<string, Record<string, PropagationConfig>>;
  }> {
    const result = await pool.query(
      `SELECT node_identifier,
              COALESCE(weight_override, default_weight) as effective_weight,
              propagation_overrides
       FROM confidence_node_weights
       WHERE pathway_id = $1`,
      [pathwayId]
    );

    const nodeWeightMap = new Map<string, number>();
    const propagationOverrides = new Map<string, Record<string, PropagationConfig>>();

    for (const row of result.rows) {
      nodeWeightMap.set(row.node_identifier, parseFloat(row.effective_weight));
      if (row.propagation_overrides && Object.keys(row.propagation_overrides).length > 0) {
        propagationOverrides.set(row.node_identifier, row.propagation_overrides);
      }
    }

    return { nodeWeightMap, propagationOverrides };
  }
}
