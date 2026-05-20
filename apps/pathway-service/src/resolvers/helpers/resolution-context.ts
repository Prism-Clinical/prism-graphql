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
import { GateProperties } from '../../services/resolution/types';
import {
  LlmGateEvaluator,
  LlmGateVerdict,
} from '../../services/resolution/gate-evaluator';
import {
  loadLLMGateConfig,
  evaluateGateWithLLM,
  LLMGateError,
} from '../../services/llm/llm-gate-client';
import { ConfidenceEngine } from '../../services/confidence/confidence-engine';
import { ScorerRegistry } from '../../services/confidence/scorer-registry';
import { WeightCascadeResolver } from '../../services/confidence/weight-cascade-resolver';
import { CustomRulesScorer } from '../../services/confidence/scorers/custom-rules';
import { DataCompletenessScorer } from '../../services/confidence/scorers/data-completeness';
import { EvidenceStrengthScorer } from '../../services/confidence/scorers/evidence-strength';
import { PatientMatchQualityScorer } from '../../services/confidence/scorers/patient-match-quality';
import { RiskMagnitudeScorer } from '../../services/confidence/scorers/risk-magnitude';
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

  // AGE returns vertex/edge values with a "::vertex" or "::edge" type suffix
  // appended to the JSON. Strip it before parsing.
  const stripAgtypeSuffix = (val: unknown): string =>
    String(val).replace(/::(?:vertex|edge)$/, '');

  const nodes: GraphNode[] = [];
  const seenNodeIds = new Set<string>();

  for (const row of nodesResult.rows) {
    if (!row.v) continue;
    try {
      const parsed = JSON.parse(stripAgtypeSuffix(row.v));
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

  // Dedupe by logical edge identity (sourceId, targetId, edgeType). The
  // node loop above already deduplicates AGE nodes that share a `node_id`
  // property — that means multiple physical AGE nodes can collapse into
  // one logical node here. When that happens, every outgoing edge from
  // each duplicate AGE node still appears in `edgesResult`, producing a
  // Cartesian product on the wire (e.g. 4 stage-1 × 5 step-1-1 = 20
  // HAS_STEP edges for what's logically a single edge).
  //
  // Defense-in-depth: dedupe at the resolver boundary so consumers see
  // a clean logical graph regardless of any data drift in AGE storage.
  // Layer 2 (cleanup migration) and layer 3 (idempotent import) address
  // the underlying data; this layer keeps the API contract honest in the
  // meantime.
  const edges: GraphEdge[] = [];
  const seenEdgeKeys = new Set<string>();
  for (const row of edgesResult.rows) {
    if (!row.a || !row.r || !row.b) continue;
    try {
      const a = JSON.parse(stripAgtypeSuffix(row.a));
      const r = JSON.parse(stripAgtypeSuffix(row.r));
      const b = JSON.parse(stripAgtypeSuffix(row.b));

      const fromId = a.label === 'Pathway' ? (a.properties?.node_id ?? `age_${a.id}`) : a.properties?.node_id;
      const toId = b.properties?.node_id ?? `age_${b.id}`;
      const edgeType = r.label;

      if (!fromId || !toId || !edgeType) continue;

      const key = `${fromId}::${edgeType}::${toId}`;
      if (seenEdgeKeys.has(key)) continue;
      seenEdgeKeys.add(key);

      edges.push({
        id: String(r.id),
        edgeType,
        sourceId: fromId,
        targetId: toId,
        properties: r.properties ?? {},
      });
    } catch {
      // Skip unparseable edges
    }
  }

  return { nodes, edges };
}

// ─── Shared Engine Instances ────────────────────────────────────────

export const sharedScorerRegistry = new ScorerRegistry();
// Register all production scorers. Without this, the confidence engine looks up
// each signal's scoring type, gets undefined, and falls back to 0.5 — so every
// node displays as "50% confidence" regardless of the underlying signals.
sharedScorerRegistry.register(new CustomRulesScorer());
sharedScorerRegistry.register(new DataCompletenessScorer());
sharedScorerRegistry.register(new EvidenceStrengthScorer());
sharedScorerRegistry.register(new PatientMatchQualityScorer());
sharedScorerRegistry.register(new RiskMagnitudeScorer());

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

// ─── LLM Gate Evaluator ─────────────────────────────────────────────

/**
 * Walk a dotted path into a JSON bag. Returns undefined if any segment is
 * missing. Used to resolve a gate's `input_attribute` against the patient
 * narrative (e.g. `freeformData.narrative.chief_complaint`).
 */
function resolveDottedPath(root: unknown, path: string): unknown {
  if (!path) return undefined;
  let cursor: unknown = root;
  for (const segment of path.split('.')) {
    if (cursor == null || typeof cursor !== 'object') return undefined;
    cursor = (cursor as Record<string, unknown>)[segment];
  }
  return cursor;
}

interface PendingAuditRow {
  gateId: string;
  pathwayId: string;
  inputAttribute: string | null;
  inputText: string | null;
  prompt: string;
  branches: unknown;
  model: string;
  chosenBranch: string | null;
  confidence: number | null;
  reasoning: string | null;
  fullResponse: unknown;
  tentative: boolean;
  errorMessage: string | null;
  latencyMs: number | null;
}

export interface LlmEvaluatorBundle {
  evaluator: LlmGateEvaluator;
  flushAudits: (sessionId: string) => Promise<void>;
}

/**
 * Build an LLM gate evaluator bundle for one resolver call. Returns null when
 * no API key is configured — callers pass that through to TraversalEngine,
 * which routes the gate's safe-default branch with tentative=true.
 *
 * The evaluator:
 *   - resolves the gate's `input_attribute` dotted path against patientContext
 *   - looks up the result in a per-bundle cache to dedupe re-evaluations on
 *     the same gate during this resolver call (retraversal can hit the same
 *     gate multiple times)
 *   - calls evaluateGateWithLLM; on failure returns a `failed: true` verdict
 *     so the upstream evaluator falls back to safe-default + tentative
 *   - buffers an audit row; `flushAudits(sessionId)` writes them all at once
 *     once the resolver has a session_id (startResolution creates the session
 *     AFTER the initial traversal, so audit writes must be deferred)
 *
 * @param initialSessionId - When known up-front (overrideNode, addPatientContext,
 *   answerQuestion), audit rows can carry the session_id from the start.
 *   For startResolution this is null and gets filled in at flush time.
 */
export function makeLlmGateEvaluator(
  pool: import('pg').Pool,
  pathwayId: string,
  _initialSessionId: string | null = null,
): LlmEvaluatorBundle | null {
  const config = loadLLMGateConfig();
  if (!config) return null;

  const cache = new Map<string, LlmGateVerdict>();
  const pendingAudits: PendingAuditRow[] = [];

  const evaluator: LlmGateEvaluator = async (
    gate: GateProperties,
    gateId: string,
    patientContext: PatientContext,
  ): Promise<LlmGateVerdict> => {
    const inputAttr = gate.input_attribute ?? '';
    const narrativeRaw = resolveDottedPath(patientContext, inputAttr);
    const narrative = typeof narrativeRaw === 'string' ? narrativeRaw : '';

    const cacheKey = `${gateId}::${narrative}`;
    const cached = cache.get(cacheKey);
    if (cached) return cached;

    const branches = (gate.branches ?? []).map((b) => ({
      name: b.name,
      description: b.description,
    }));
    const promptText = gate.prompt ?? gate.title;

    try {
      const out = await evaluateGateWithLLM(
        { prompt: promptText, narrative, branches },
        config,
      );
      const threshold = gate.confidence_threshold ?? 0.75;
      const tentative = out.confidence < threshold;
      pendingAudits.push({
        gateId,
        pathwayId,
        inputAttribute: inputAttr || null,
        inputText: narrative,
        prompt: promptText,
        branches: gate.branches ?? [],
        model: out.model,
        chosenBranch: out.chosenBranch,
        confidence: out.confidence,
        reasoning: out.reasoning,
        fullResponse: out.rawResponse,
        tentative,
        errorMessage: null,
        latencyMs: out.latencyMs,
      });
      const verdict: LlmGateVerdict = {
        chosenBranch: out.chosenBranch,
        confidence: out.confidence,
        reasoning: out.reasoning,
      };
      cache.set(cacheKey, verdict);
      return verdict;
    } catch (err) {
      const message = err instanceof LLMGateError
        ? err.message
        : err instanceof Error
          ? err.message
          : String(err);
      pendingAudits.push({
        gateId,
        pathwayId,
        inputAttribute: inputAttr || null,
        inputText: narrative,
        prompt: promptText,
        branches: gate.branches ?? [],
        model: config.model,
        chosenBranch: null,
        confidence: null,
        reasoning: null,
        fullResponse: null,
        tentative: true,
        errorMessage: message,
        latencyMs: null,
      });
      const verdict: LlmGateVerdict = {
        chosenBranch: '',
        confidence: 0,
        reasoning: message,
        failed: true,
        errorMessage: message,
      };
      cache.set(cacheKey, verdict);
      return verdict;
    }
  };

  const flushAudits = async (sessionId: string): Promise<void> => {
    if (pendingAudits.length === 0) return;
    const rows = pendingAudits.splice(0);
    for (const row of rows) {
      await pool.query(
        `INSERT INTO llm_gate_evaluations (
           session_id, gate_id, pathway_id, input_attribute, input_text,
           prompt, branches, model, chosen_branch, confidence, reasoning,
           full_response, tentative, error_message, latency_ms
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
        [
          sessionId,
          row.gateId,
          row.pathwayId,
          row.inputAttribute,
          row.inputText,
          row.prompt,
          JSON.stringify(row.branches),
          row.model,
          row.chosenBranch,
          row.confidence,
          row.reasoning,
          row.fullResponse ? JSON.stringify(row.fullResponse) : null,
          row.tentative,
          row.errorMessage,
          row.latencyMs,
        ],
      );
    }
  };

  return { evaluator, flushAudits };
}
