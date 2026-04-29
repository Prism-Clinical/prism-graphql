import { GraphQLError } from 'graphql';
import {
  PropagationConfig,
  ScoringRules,
  GraphNode,
  GraphEdge,
  GraphContext,
  PatientContext,
  SignalDefinition,
} from '../../services/confidence/types';
import { ConfidenceEngine } from '../../services/confidence/confidence-engine';
import { ScorerRegistry } from '../../services/confidence/scorer-registry';
import { WeightCascadeResolver } from '../../services/confidence/weight-cascade-resolver';
import { hydrateSignalDefinition } from '../Query';
import { executeCypher } from '../../services/age-client';

// ─── Graph Context Builder ──────────────────────────────────────────

export function buildGraphContext(nodes: GraphNode[], edges: GraphEdge[]): GraphContext {
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

// ─── AGE Graph Fetcher ──────────────────────────────────────────────

/**
 * Load nodes and edges from AGE graph for a pathway.
 *
 * Uses iterative BFS (single-hop per round) to collect all reachable AGE node
 * IDs from the root, then fetches nodes and edges by ID list. This avoids
 * variable-length path patterns (`*0..`) which cause combinatorial explosion
 * on dense graphs.
 */
export async function fetchGraphFromAGE(
  pool: import('pg').Pool,
  ageNodeId: string,
): Promise<{ nodes: GraphNode[]; edges: GraphEdge[] }> {
  // Validate ageNodeId is a numeric AGE internal ID to prevent Cypher injection
  if (!/^\d+$/.test(String(ageNodeId))) {
    throw new GraphQLError(`Invalid AGE node ID: "${ageNodeId}"`, {
      extensions: { code: 'INTERNAL_SERVER_ERROR' },
    });
  }

  const rootId = String(ageNodeId);

  // BFS: collect all reachable AGE node IDs from the root
  const allAgeIds = new Set<string>([rootId]);
  let frontier = [rootId];

  while (frontier.length > 0) {
    const idList = frontier.join(', ');
    const bfsCypher = `MATCH (a)-[]->(b) WHERE id(a) IN [${idList}] RETURN DISTINCT id(b)`;
    const bfsResult = await executeCypher(pool, bfsCypher, '(bid agtype)');

    frontier = [];
    for (const row of bfsResult.rows) {
      const bid = String(JSON.parse(row.bid));
      if (!allAgeIds.has(bid)) {
        allAgeIds.add(bid);
        frontier.push(bid);
      }
    }
  }

  const ageIdList = [...allAgeIds].join(', ');

  // Fetch all nodes and edges in parallel
  const nodesCypher = `MATCH (n) WHERE id(n) IN [${ageIdList}] RETURN n`;
  const edgesCypher = `MATCH (a)-[r]->(b) WHERE id(a) IN [${ageIdList}] RETURN a, r, b`;

  const [nodesResult, edgesResult] = await Promise.all([
    executeCypher(pool, nodesCypher, '(v agtype)'),
    executeCypher(pool, edgesCypher, '(a agtype, r agtype, b agtype)'),
  ]);

  const nodes: GraphNode[] = [];
  const seenNodeIds = new Set<string>();

  for (const row of nodesResult.rows) {
    if (!row.v) continue;
    try {
      const parsed = JSON.parse(row.v);
      if (!parsed || !parsed.properties) continue;
      const props = parsed.properties;
      const nodeId = props.node_id ?? `age_${parsed.id}`;
      if (seenNodeIds.has(nodeId)) continue;
      seenNodeIds.add(nodeId);

      const nodeType = parsed.label ?? props.node_type ?? 'Unknown';
      nodes.push({
        id: String(parsed.id),
        nodeIdentifier: nodeId,
        nodeType,
        properties: props,
      });
    } catch {
      // Skip unparseable nodes
    }
  }

  const edges: GraphEdge[] = [];
  for (const row of edgesResult.rows) {
    if (!row.a || !row.r || !row.b) continue;
    try {
      const a = JSON.parse(row.a);
      const r = JSON.parse(row.r);
      const b = JSON.parse(row.b);

      const fromId = a.label === 'Pathway' ? (a.properties?.node_id ?? `age_${a.id}`) : a.properties?.node_id;
      const toId = b.properties?.node_id ?? `age_${b.id}`;
      const edgeType = r.label;

      if (fromId && toId && edgeType) {
        edges.push({
          id: String(r.id),
          edgeType,
          sourceId: fromId,
          targetId: toId,
          properties: r.properties ?? {},
        });
      }
    } catch {
      // Skip unparseable edges
    }
  }

  return { nodes, edges };
}

// ─── Shared Engine Instances ────────────────────────────────────────

export const sharedScorerRegistry = new ScorerRegistry();
export const sharedCascadeResolver = new WeightCascadeResolver();

// ─── Resolution Context Builder ────────────────────────────────────
// Shared setup for resolution mutations: loads graph, signals, thresholds,
// and builds the engines needed for traversal or re-traversal.

export interface ResolutionContext {
  graphContext: GraphContext;
  edges: GraphEdge[];
  signals: SignalDefinition[];
  thresholds: { autoResolveThreshold: number; suggestThreshold: number };
  confidenceEngine: ConfidenceEngine;
}

export async function buildResolutionContext(
  pool: import('pg').Pool,
  pathwayId: string,
): Promise<ResolutionContext> {
  // Fetch AGE node ID
  const pathwayRow = await pool.query(
    'SELECT age_node_id FROM pathway_graph_index WHERE id = $1',
    [pathwayId],
  );
  const ageNodeId = pathwayRow.rows[0]?.age_node_id;
  if (!ageNodeId) {
    throw new GraphQLError('Pathway has no graph data (missing AGE node ID)', {
      extensions: { code: 'INTERNAL_SERVER_ERROR' },
    });
  }

  // These three operations are independent — run in parallel
  const [{ nodes, edges }, signalResult, thresholds] = await Promise.all([
    fetchGraphFromAGE(pool, ageNodeId),
    pool.query(
      `SELECT id, name, display_name, description, scoring_type, scoring_rules,
              scope, institution_id, default_weight, is_active
       FROM confidence_signal_definitions WHERE is_active = true ORDER BY name ASC`,
    ),
    sharedCascadeResolver.resolveThresholds({ pool, pathwayId }),
  ]);
  const graphContext = buildGraphContext(nodes, edges);
  const signals: SignalDefinition[] = signalResult.rows.map(hydrateSignalDefinition);

  const confidenceEngine = new ConfidenceEngine(sharedScorerRegistry, sharedCascadeResolver);

  return { graphContext, edges, signals, thresholds, confidenceEngine };
}

export function makeTraversalAdapter(
  ctx: ResolutionContext,
  pool: import('pg').Pool,
  pathwayId: string,
  patientContext: PatientContext,
) {
  return {
    computeNodeConfidence: async (node: unknown, _gc: unknown, _pctx: unknown) => {
      const result = await ctx.confidenceEngine.computePathwayConfidence({
        pool,
        pathwayId,
        nodes: [node as GraphNode],
        edges: ctx.edges,
        signalDefinitions: ctx.signals,
        patientContext,
      });
      return result.nodes[0] ?? {
        nodeIdentifier: (node as GraphNode).nodeIdentifier,
        nodeType: (node as GraphNode).nodeType,
        confidence: 0.5,
        breakdown: [],
        propagationInfluences: [],
      };
    },
  };
}

export function makeRetraversalAdapter(
  ctx: ResolutionContext,
  pool: import('pg').Pool,
  pathwayId: string,
  patientContext: PatientContext,
) {
  return {
    computeNodeConfidence: async (nodeId: string, _gc: GraphContext, _pctx: PatientContext) => {
      const graphNode = ctx.graphContext.getNode(nodeId);
      if (!graphNode) {
        return { confidence: 0.5, breakdown: [], resolutionType: 'SYSTEM_SUGGESTED' };
      }
      const result = await ctx.confidenceEngine.computePathwayConfidence({
        pool,
        pathwayId,
        nodes: [graphNode],
        edges: ctx.edges,
        signalDefinitions: ctx.signals,
        patientContext,
      });
      const nodeConf = result.nodes[0];
      return nodeConf
        ? { confidence: nodeConf.confidence, breakdown: nodeConf.breakdown, resolutionType: nodeConf.resolutionType ?? 'SYSTEM_SUGGESTED' }
        : { confidence: 0.5, breakdown: [], resolutionType: 'SYSTEM_SUGGESTED' };
    },
  };
}
