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
import { GateProperties, AttributeCodeMap } from '../../services/resolution/types';
import { GateType } from '../../types';
import { loadAttributeCodeMap } from '../../services/resolution/attribute-code-map';
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
import {
  PathwayTemporalDefaults,
  parsePathwayTemporalDefaults,
  collectEncounterAnchorRequirements,
  SweepableCondition,
  ConditionTemporalOverride,
} from '../../services/resolution/temporal/cascade';
import {
  EvaluationTemporalContext,
  TemporalContextError,
  DEFAULT_TEMPORAL_POLICY_VERSION,
} from '../../services/resolution/temporal/evaluation-context';
import { GateField, FIELD_TO_KIND } from '../../services/resolution/temporal/contract';
import {
  attributeNamespaceToField,
  parseConditionOverride,
} from '../../services/resolution/temporal/condition-adapter';
import { getTemporalPolicy } from '../../services/resolution/temporal/policy-registry';

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
 * Scopes by (root id + pathway_logical_id/pathway_version tags) rather than
 * BFS reachability from the root. A node the author dropped on the canvas
 * but hasn't wired into an incoming edge yet (e.g. a Gate with one outgoing
 * BRANCHES_TO and nothing pointing in) is unreachable from root via outgoing
 * BFS — reachability-only loaders silently drop it on every reload, even
 * though the import correctly persisted it. The orphan sweep at import time
 * guarantees no other (lid, ver)-tagged nodes survive, so the tag scope is
 * unambiguous.
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

  // Pull the root's logical_id + version so we can scope the rest of the
  // graph fetch by tag. The root itself carries `logical_id`/`version`
  // directly; every other node carries the `pathway_*`-prefixed copies.
  const rootMetaCypher =
    `MATCH (p:Pathway) WHERE id(p) = ${rootId} RETURN p.logical_id AS lid, p.version AS ver`;
  const rootMetaResult = await executeCypher(pool, rootMetaCypher, '(lid agtype, ver agtype)');
  const rootRow = rootMetaResult.rows[0];
  if (!rootRow) {
    return { nodes: [], edges: [] };
  }
  const logicalId = String(JSON.parse(rootRow.lid));
  const version = String(JSON.parse(rootRow.ver));
  const escape = (v: string) => v.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  const lid = `'${escape(logicalId)}'`;
  const ver = `'${escape(version)}'`;

  // Fetch every node belonging to this pathway version: the root (by id),
  // plus all nodes tagged with the matching (logical_id, version). Edges
  // are fetched the same way — both endpoints must be in scope.
  const nodesCypher =
    `MATCH (n) WHERE id(n) = ${rootId} ` +
    `   OR (n.pathway_logical_id = ${lid} AND n.pathway_version = ${ver}) ` +
    `RETURN n`;
  const edgesCypher =
    `MATCH (a)-[r]->(b) ` +
    `WHERE (id(a) = ${rootId} OR (a.pathway_logical_id = ${lid} AND a.pathway_version = ${ver})) ` +
    `  AND (id(b) = ${rootId} OR (b.pathway_logical_id = ${lid} AND b.pathway_version = ${ver})) ` +
    `RETURN a, r, b`;

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
  codeMap: AttributeCodeMap;
  /**
   * The PATHWAY level of the temporal cascade (§7.5), read from the
   * relational index. `{}` when the pathway states no opinion.
   */
  temporalDefaults: PathwayTemporalDefaults;
}

export async function buildResolutionContext(
  pool: import('pg').Pool,
  pathwayId: string,
): Promise<ResolutionContext> {
  // Fetch AGE node ID and the pathway-level temporal cascade defaults
  const pathwayRow = await pool.query(
    'SELECT age_node_id, temporal_defaults FROM pathway_graph_index WHERE id = $1',
    [pathwayId],
  );
  const ageNodeId = pathwayRow.rows[0]?.age_node_id;
  if (!ageNodeId) {
    throw new GraphQLError('Pathway has no graph data (missing AGE node ID)', {
      extensions: { code: 'INTERNAL_SERVER_ERROR' },
    });
  }
  // Parsed before any traversal work starts: a corrupt policy must stop the
  // session, not resolve gates against a window the author never chose.
  const temporalDefaults = parsePathwayTemporalDefaults(pathwayRow.rows[0]?.temporal_defaults);

  // These four operations are independent — run in parallel
  const [{ nodes, edges }, signalResult, thresholds, codeMap] = await Promise.all([
    fetchGraphFromAGE(pool, ageNodeId),
    pool.query(
      `SELECT id, name, display_name, description, scoring_type, scoring_rules,
              scope, institution_id, default_weight, is_active
       FROM confidence_signal_definitions WHERE is_active = true ORDER BY name ASC`,
    ),
    sharedCascadeResolver.resolveThresholds({ pool, pathwayId }),
    loadAttributeCodeMap(pool),
  ]);
  const graphContext = buildGraphContext(nodes, edges);
  const signals: SignalDefinition[] = signalResult.rows.map(hydrateSignalDefinition);

  const confidenceEngine = new ConfidenceEngine(sharedScorerRegistry, sharedCascadeResolver);

  return {
    graphContext,
    edges,
    signals,
    thresholds,
    confidenceEngine,
    codeMap,
    temporalDefaults,
  };
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

// ─── ENCOUNTER anchor preflight ─────────────────────────────────────

/**
 * Which gate field a raw condition sweeps under, or `null` to skip it.
 *
 * Under `legacy-v0` only coded conditions are swept — exactly today's scope.
 * Under `v1` the three clinical attribute namespaces join them, because D3
 * gives `vitals.*` an ENCOUNTER horizon and an unswept attribute gate would
 * pass preflight and throw mid-traversal (P1-8).
 */
function sweptFieldFor(cond: Record<string, unknown>, isV1: boolean): GateField | null {
  const field = cond.field;
  if (typeof field === 'string') {
    return Object.prototype.hasOwnProperty.call(FIELD_TO_KIND, field)
      ? (field as GateField)
      : null;
  }
  if (!isV1) return null;

  // Attribute condition. `patient.*` and unrecognized namespaces map to null —
  // they never resolve a horizon, so sweeping them would reject sessions over
  // gates that cannot need an anchor.
  const attribute = cond.attribute;
  if (typeof attribute !== 'string') return null;
  return attributeNamespaceToField(attribute.split('.')[0]);
}

/**
 * Pull the sweepable temporal conditions out of a loaded graph.
 *
 * Reads node properties defensively rather than through `GateProperties`:
 * these come straight from AGE as untyped JSON, and a malformed *node* must not
 * crash the preflight.
 *
 * **A malformed override is a different matter, and the two versions differ
 * (D1, P1-15, P1-18).** Under `legacy-v0` the raw value is copied through and
 * the cascade validates it downstream — which already rejects session creation
 * today, but only when `encounterStart` is absent, because
 * `assertEncounterAnchor` returns early otherwise. That conditional rejection
 * is current behavior and is preserved byte-for-byte. Under `v1` the override
 * goes through `parseConditionOverride`, the same parser the evaluator uses, so
 * preflight and evaluation cannot disagree about the same pathway.
 *
 * **Neither path catches parser errors.** Swallowing them would turn requests
 * that are rejected today into successes.
 *
 * Exported for plan 04 Task 7's preflight/evaluation agreement test, which
 * compares the swept field and override against the adapter's for the same
 * condition. `assertEncounterAnchor` cannot serve that test: it returns `void`
 * and throws only when an anchor is missing, so it exposes neither value. Not
 * intended for production callers outside this module.
 */
export function sweepableConditions(
  nodes: readonly GraphNode[],
  version: string,
): SweepableCondition[] {
  const isV1 = version !== DEFAULT_TEMPORAL_POLICY_VERSION;
  const out: SweepableCondition[] = [];

  for (const node of nodes) {
    // Only Gate nodes carry evaluable conditions: `condition`/`conditions` are
    // read exclusively from GateProperties. Without this check, any imported
    // node that happens to carry a condition-shaped property would trigger a
    // false missing-anchor rejection for a gate that is never evaluated.
    //
    // `satisfaction_check` on Stage/Step prerequisite nodes is a different
    // shape ({type, code, system, lookback_days}) with no `field` key, so it
    // is already excluded below.
    if (node.nodeType !== 'Gate') continue;

    const props = node.properties as Record<string, unknown> | undefined;
    if (!props) continue;

    // Collect exactly what `evaluateGate` would read for THIS gate type
    // (gate-evaluator.ts:753). A question / prior_node_result /
    // llm_text_analysis gate reads neither key, so a leftover `condition`
    // left on one by an earlier edit is dead weight — the validator does not
    // currently forbid the combination, and rejecting a session over a
    // condition that is never evaluated would be a false positive.
    const raw: unknown[] = [];
    switch (props.gate_type) {
      case GateType.PATIENT_ATTRIBUTE:
        // evaluatePatientAttribute reads `condition` only.
        if (props.condition) raw.push(props.condition);
        break;
      case GateType.COMPOUND:
        // evaluateCompound reads `conditions` only.
        if (Array.isArray(props.conditions)) raw.push(...props.conditions);
        break;
      default:
        // question / prior_node_result / llm_text_analysis / unknown — no
        // condition is ever evaluated.
        continue;
    }

    raw.forEach((c, i) => {
      if (!c || typeof c !== 'object') return;
      const cond = c as Record<string, unknown>;
      const label = `${node.nodeIdentifier} / condition ${i}`;

      const field = sweptFieldFor(cond, isV1);
      if (field === null) return;

      const entry: SweepableCondition = { label, field };

      if (isV1) {
        // Strict shared parsing. Errors propagate: under v1 this is the only
        // preflight that catches a malformed override or a
        // window_days/horizon conflict (P1-18).
        const override = parseConditionOverride(cond, label);
        if (override !== undefined) entry.override = override;
      } else {
        // legacy-v0: byte-for-byte today's extraction. The raw value is copied
        // and the cascade validates it downstream, conditionally.
        const override: ConditionTemporalOverride = {};
        if (cond.horizon !== undefined) override.horizon = cond.horizon as never;
        if (cond.status !== undefined) override.status = cond.status as never;
        if (Object.keys(override).length > 0) entry.override = override;
      }

      out.push(entry);
    });
  }

  return out;
}

/**
 * Refuse to start a session whose pathway resolves an ENCOUNTER horizon when
 * the context carries no `encounterStart`.
 *
 * Called at session CREATION only. Retraversal reuses the clock its session
 * was created with, and that session already passed this check — re-running it
 * there would reject a session that is by construction still valid.
 */
export function assertEncounterAnchor(
  rctx: ResolutionContext,
  temporalCtx: EvaluationTemporalContext,
): void {
  // Unconditionally, before any early return: a session must never be created
  // pinned to a policy version nothing can evaluate. Behind the encounterStart
  // check, an unknown version would sail through whenever an anchor happened
  // to be present.
  // Unconditionally, before any early return: a session must never be created
  // pinned to a policy version nothing can evaluate. Behind the encounterStart
  // check, an unknown version would sail through whenever an anchor happened
  // to be present.
  getTemporalPolicy(temporalCtx.temporalPolicyVersion);

  const version = temporalCtx.temporalPolicyVersion;

  if (version === DEFAULT_TEMPORAL_POLICY_VERSION) {
    // EXACTLY today's flow. The early return must stay AHEAD of the sweep: the
    // sweep's raw override copy is validated downstream by the cascade, so
    // moving it earlier would start rejecting malformed overrides on sessions
    // that succeed today (P1-15).
    if (temporalCtx.encounterStart) return;
    throwIfAnchorsRequired(rctx, temporalCtx, sweepableConditions(rctx.graphContext.allNodes, version));
    return;
  }

  // v1: parse and validate every condition regardless of the anchor. This sweep
  // is the only preflight that catches a malformed override or a
  // window_days/horizon conflict, so leaving it behind the early return means a
  // pathway that supplies an anchor is never validated at all and throws
  // mid-traversal instead — after LLM gates have run and audit rows exist
  // (P1-18). Parse errors propagate from here.
  const swept = sweepableConditions(rctx.graphContext.allNodes, version);

  // Validated above; the ANCHOR requirement itself is what an anchor satisfies.
  if (temporalCtx.encounterStart) return;
  throwIfAnchorsRequired(rctx, temporalCtx, swept);
}

function throwIfAnchorsRequired(
  rctx: ResolutionContext,
  temporalCtx: EvaluationTemporalContext,
  swept: SweepableCondition[],
): void {
  const required = collectEncounterAnchorRequirements(
    swept,
    temporalCtx.temporalPolicyVersion,
    rctx.temporalDefaults,
  );
  if (required.length === 0) return;

  const detail = required.map((r) => `${r.label} (${r.field}, from ${r.level})`).join('; ');
  throw new TemporalContextError(
    `this pathway resolves an ENCOUNTER horizon but the session has no encounterStart: ${detail}`,
    'MISSING_ENCOUNTER_ANCHOR',
  );
}
