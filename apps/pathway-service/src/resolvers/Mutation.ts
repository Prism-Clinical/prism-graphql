import { GraphQLError } from 'graphql';
import { DataSourceContext, NodeStatus, OverrideAction, SessionStatus } from '../types';
import { hydrateSignalDefinition, formatSessionForGraphQL } from './Query';
import {
  PropagationConfig,
  ScoringRules,
  GraphNode,
  GraphEdge,
  GraphContext,
  PatientContext,
  SignalDefinition,
} from '../services/confidence/types';
import { importPathway } from '../services/import/import-orchestrator';
import { PathwayJson, ImportMode } from '../services/import/types';
import { ConfidenceEngine } from '../services/confidence/confidence-engine';
import { ScorerRegistry } from '../services/confidence/scorer-registry';
import { WeightCascadeResolver } from '../services/confidence/weight-cascade-resolver';
import { TraversalEngine } from '../services/resolution/traversal-engine';
import { RetraversalEngine } from '../services/resolution/retraversal-engine';
import {
  createSession,
  getSession,
  updateSession,
  logEvent,
  logNodeOverride,
  logGateAnswer,
} from '../services/resolution/session-store';
import {
  validateForGeneration,
  generateCarePlan,
} from '../services/resolution/care-plan-generator';
import { GateAnswer, ResolutionSession } from '../services/resolution/types';
import { executeCypher } from '../services/age-client';

const PATHWAY_COLUMNS = `
  id, age_node_id AS "ageNodeId", logical_id AS "logicalId",
  title, version, category, status,
  condition_codes AS "conditionCodes",
  scope, target_population AS "targetPopulation",
  is_active AS "isActive",
  created_at AS "createdAt", updated_at AS "updatedAt"
`;

export interface CreateSignalInput {
  name: string;
  displayName: string;
  description?: string;
  scoringType: string;
  scoringRules: ScoringRules;
  propagationConfig?: PropagationConfig;
  scope: string;
  institutionId?: string;
  defaultWeight: number;
}

export interface SetSignalWeightInput {
  signalDefinitionId: string;
  weight: number;
  scope: string;
  pathwayId?: string;
  nodeIdentifier?: string;
  nodeType?: string;
  institutionId?: string;
}

export interface SetThresholdsInput {
  autoResolveThreshold: number;
  suggestThreshold: number;
  scope: string;
  pathwayId?: string;
  nodeIdentifier?: string;
  institutionId?: string;
}

export interface SetNodeWeightInput {
  pathwayId: string;
  nodeIdentifier: string;
  nodeType: string;
  institutionId?: string;
  weightOverride?: number;
  propagationOverrides?: Record<string, PropagationConfig>;
}

export interface UpdateSignalInput {
  displayName?: string;
  description?: string;
  scoringRules?: ScoringRules;
  propagationConfig?: PropagationConfig;
  defaultWeight?: number;
  isActive?: boolean;
}

export interface GateAnswerInput {
  booleanValue?: boolean;
  numericValue?: number;
  selectedOption?: string;
}

export interface AdditionalContextInput {
  conditionCodes?: Array<{ code: string; system: string; display?: string }>;
  medications?: Array<{ code: string; system: string; display?: string }>;
  labResults?: Array<{ code: string; system: string; value?: number; unit?: string; date?: string; display?: string }>;
  allergies?: Array<{ code: string; system: string; display?: string }>;
  vitalSigns?: Record<string, unknown>;
  freeformData?: Record<string, unknown>;
}

// ─── Graph Context Builder ──────────────────────────────────────────

function buildGraphContext(nodes: GraphNode[], edges: GraphEdge[]): GraphContext {
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

async function fetchGraphFromAGE(
  pool: import('pg').Pool,
  ageNodeId: string,
): Promise<{ nodes: GraphNode[]; edges: GraphEdge[] }> {
  // Fetch all nodes connected to the pathway root
  const nodesCypher =
    `MATCH (p:Pathway) WHERE id(p) = ${ageNodeId} ` +
    `OPTIONAL MATCH (p)-[*0..]->(n) RETURN n`;
  const nodesResult = await executeCypher(pool, nodesCypher, '(v agtype)');

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

  // Fetch all edges
  const edgesCypher =
    `MATCH (p:Pathway) WHERE id(p) = ${ageNodeId} ` +
    `OPTIONAL MATCH (p)-[*0..]->(a)-[r]->(b) RETURN a, r, b`;
  const edgesResult = await executeCypher(pool, edgesCypher, '(a agtype, r agtype, b agtype)');

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

const sharedScorerRegistry = new ScorerRegistry();
const sharedCascadeResolver = new WeightCascadeResolver();

export const Mutation = {
  Mutation: {
    // ─── Import Pipeline Mutations ──────────────────────────────────────

    async importPathway(
      _parent: unknown,
      args: { pathwayJson: string; importMode: ImportMode },
      context: DataSourceContext
    ) {
      // Parse JSON
      let parsed: PathwayJson;
      try {
        parsed = JSON.parse(args.pathwayJson);
      } catch {
        return {
          pathway: null,
          validation: { valid: false, errors: ['Invalid JSON: could not parse pathwayJson string'], warnings: [] },
          diff: null,
          importType: args.importMode,
        };
      }

      // Run import pipeline
      const result = await importPathway(context.pool, parsed, args.importMode, context.userId);

      // If validation failed, return without pathway
      if (!result.validation.valid) {
        return {
          pathway: null,
          validation: result.validation,
          diff: null,
          importType: result.importType,
        };
      }

      // Fetch the created/updated pathway for the response
      const pathway = await context.pool.query(
        `SELECT ${PATHWAY_COLUMNS} FROM pathway_graph_index WHERE id = $1`,
        [result.pathwayId]
      );

      return {
        pathway: pathway.rows[0] || null,
        validation: result.validation,
        diff: result.diff ? {
          summary: result.diff.summary,
          details: result.diff.details,
          synthetic: result.diff.synthetic,
        } : null,
        importType: result.importType,
      };
    },

    async activatePathway(
      _parent: unknown,
      args: { id: string },
      context: DataSourceContext
    ) {
      const { pool } = context;

      // Single atomic query: check existence + validate status + supersede old ACTIVE + activate.
      // The CTE chain ensures no TOCTOU race between reading status and updating.
      const result = await pool.query(
        `WITH target AS (
           SELECT id, status, logical_id FROM pathway_graph_index WHERE id = $1
         ),
         superseded AS (
           UPDATE pathway_graph_index SET status = 'SUPERSEDED', is_active = false
           WHERE logical_id = (SELECT logical_id FROM target)
             AND status = 'ACTIVE' AND id != $1
             AND (SELECT status FROM target) = 'DRAFT'
         ),
         activated AS (
           UPDATE pathway_graph_index SET status = 'ACTIVE', is_active = true
           WHERE id = $1 AND status = 'DRAFT'
           RETURNING ${PATHWAY_COLUMNS}
         )
         SELECT activated.*, target.status AS "previousStatus"
         FROM activated, target`,
        [args.id]
      );

      if (!result.rows[0]) {
        // Distinguish between not-found and wrong-status
        const check = await pool.query('SELECT status FROM pathway_graph_index WHERE id = $1', [args.id]);
        if (!check.rows[0]) {
          throw new GraphQLError('Pathway not found', { extensions: { code: 'NOT_FOUND' } });
        }
        throw new GraphQLError(`Cannot activate pathway with status "${check.rows[0].status}". Only DRAFT pathways can be activated.`, {
          extensions: { code: 'BAD_USER_INPUT' },
        });
      }

      const { previousStatus, ...pathway } = result.rows[0];
      return { pathway, previousStatus };
    },

    async archivePathway(
      _parent: unknown,
      args: { id: string },
      context: DataSourceContext
    ) {
      const { pool } = context;

      const current = await pool.query(
        `SELECT ${PATHWAY_COLUMNS} FROM pathway_graph_index WHERE id = $1`,
        [args.id]
      );
      if (!current.rows[0]) {
        throw new GraphQLError('Pathway not found', { extensions: { code: 'NOT_FOUND' } });
      }

      const pathway = current.rows[0];
      if (pathway.status !== 'ACTIVE') {
        throw new GraphQLError(`Cannot archive pathway with status "${pathway.status}". Only ACTIVE pathways can be archived.`, {
          extensions: { code: 'BAD_USER_INPUT' },
        });
      }

      const updated = await pool.query(
        `UPDATE pathway_graph_index SET status = 'ARCHIVED', is_active = false WHERE id = $1 RETURNING ${PATHWAY_COLUMNS}`,
        [args.id]
      );

      return {
        pathway: updated.rows[0],
        previousStatus: 'ACTIVE',
      };
    },

    async reactivatePathway(
      _parent: unknown,
      args: { id: string },
      context: DataSourceContext
    ) {
      const { pool } = context;

      // Single atomic query: check existence + validate status + supersede old ACTIVE + reactivate.
      const result = await pool.query(
        `WITH target AS (
           SELECT id, status, logical_id FROM pathway_graph_index WHERE id = $1
         ),
         superseded AS (
           UPDATE pathway_graph_index SET status = 'SUPERSEDED', is_active = false
           WHERE logical_id = (SELECT logical_id FROM target)
             AND status = 'ACTIVE' AND id != $1
             AND (SELECT status FROM target) IN ('SUPERSEDED', 'ARCHIVED')
         ),
         reactivated AS (
           UPDATE pathway_graph_index SET status = 'ACTIVE', is_active = true
           WHERE id = $1 AND status IN ('SUPERSEDED', 'ARCHIVED')
           RETURNING ${PATHWAY_COLUMNS}
         )
         SELECT reactivated.*, target.status AS "previousStatus"
         FROM reactivated, target`,
        [args.id]
      );

      if (!result.rows[0]) {
        const check = await pool.query('SELECT status FROM pathway_graph_index WHERE id = $1', [args.id]);
        if (!check.rows[0]) {
          throw new GraphQLError('Pathway not found', { extensions: { code: 'NOT_FOUND' } });
        }
        throw new GraphQLError(`Cannot reactivate pathway with status "${check.rows[0].status}". Only SUPERSEDED or ARCHIVED pathways can be reactivated.`, {
          extensions: { code: 'BAD_USER_INPUT' },
        });
      }

      const { previousStatus, ...pathway } = result.rows[0];
      return { pathway, previousStatus };
    },

    // ─── Confidence Framework Mutations ─────────────────────────────────

    async createSignalDefinition(
      _parent: unknown,
      args: { input: CreateSignalInput },
      context: DataSourceContext
    ) {
      const { pool } = context;
      const { input } = args;

      if (input.scope === 'INSTITUTION' && !input.institutionId) {
        throw new GraphQLError('institutionId is required for INSTITUTION scope', {
          extensions: { code: 'BAD_USER_INPUT' },
        });
      }

      if (input.defaultWeight < 0 || input.defaultWeight > 1) {
        throw new GraphQLError('defaultWeight must be between 0.0 and 1.0', {
          extensions: { code: 'BAD_USER_INPUT' },
        });
      }

      let scoringRules = input.scoringRules;
      if (input.propagationConfig) {
        scoringRules = { ...scoringRules, propagation: input.propagationConfig };
      }

      const result = await pool.query(
        `INSERT INTO confidence_signal_definitions
         (name, display_name, description, scoring_type, scoring_rules, scope, institution_id, default_weight)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING id, name, display_name, description, scoring_type, scoring_rules, scope, institution_id, default_weight, is_active`,
        [input.name, input.displayName, input.description ?? '', input.scoringType,
         JSON.stringify(scoringRules), input.scope, input.institutionId ?? null, input.defaultWeight]
      );

      return hydrateSignalDefinition(result.rows[0]);
    },

    async deleteSignalDefinition(_parent: unknown, args: { id: string }, context: DataSourceContext) {
      // Check for dependent weight rows first to avoid unformatted FK violations
      const depCheck = await context.pool.query(
        `SELECT COUNT(*) as count FROM confidence_signal_weights WHERE signal_definition_id = $1`,
        [args.id]
      );
      if (parseInt(depCheck.rows[0].count, 10) > 0) {
        throw new GraphQLError(
          'Cannot delete signal definition with active weight overrides. Remove weights first.',
          { extensions: { code: 'BAD_USER_INPUT' } }
        );
      }

      const result = await context.pool.query(
        `DELETE FROM confidence_signal_definitions WHERE id = $1`, [args.id]
      );
      if (result.rowCount === 0) {
        throw new GraphQLError('Signal definition not found', { extensions: { code: 'NOT_FOUND' } });
      }
      return true;
    },

    async setSignalWeight(_parent: unknown, args: { input: SetSignalWeightInput }, context: DataSourceContext) {
      const { pool } = context;
      const { input } = args;

      if (input.weight < 0 || input.weight > 1) {
        throw new GraphQLError('Weight must be between 0.0 and 1.0', {
          extensions: { code: 'BAD_USER_INPUT' },
        });
      }

      const result = await pool.query(
        `INSERT INTO confidence_signal_weights
         (signal_definition_id, weight, scope, pathway_id, node_identifier, node_type, institution_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT ON CONSTRAINT confidence_signal_weights_unique
         DO UPDATE SET weight = $2
         RETURNING id, signal_definition_id, weight, scope, pathway_id, node_identifier, node_type, institution_id`,
        [input.signalDefinitionId, input.weight, input.scope, input.pathwayId ?? null,
         input.nodeIdentifier ?? null, input.nodeType ?? null, input.institutionId ?? null]
      );

      const row = result.rows[0];
      return {
        id: row.id, signalDefinitionId: row.signal_definition_id,
        weight: parseFloat(row.weight), scope: row.scope,
        pathwayId: row.pathway_id, nodeIdentifier: row.node_identifier,
        nodeType: row.node_type, institutionId: row.institution_id,
      };
    },

    async removeSignalWeight(_parent: unknown, args: { id: string }, context: DataSourceContext) {
      const result = await context.pool.query(`DELETE FROM confidence_signal_weights WHERE id = $1`, [args.id]);
      if (result.rowCount === 0) throw new GraphQLError('Signal weight not found', { extensions: { code: 'NOT_FOUND' } });
      return true;
    },

    async setResolutionThresholds(_parent: unknown, args: { input: SetThresholdsInput }, context: DataSourceContext) {
      const { pool } = context;
      const { input } = args;

      if (input.suggestThreshold < 0 || input.suggestThreshold > 1 ||
          input.autoResolveThreshold < 0 || input.autoResolveThreshold > 1) {
        throw new GraphQLError('Thresholds must be between 0.0 and 1.0', {
          extensions: { code: 'BAD_USER_INPUT' },
        });
      }
      if (input.suggestThreshold >= input.autoResolveThreshold) {
        throw new GraphQLError('suggestThreshold must be less than autoResolveThreshold', {
          extensions: { code: 'BAD_USER_INPUT' },
        });
      }

      const result = await pool.query(
        `INSERT INTO confidence_resolution_thresholds
         (auto_resolve_threshold, suggest_threshold, scope, pathway_id, node_identifier, institution_id)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT ON CONSTRAINT confidence_resolution_thresholds_unique
         DO UPDATE SET auto_resolve_threshold = $1, suggest_threshold = $2
         RETURNING id, auto_resolve_threshold, suggest_threshold, scope, pathway_id, node_identifier, institution_id`,
        [input.autoResolveThreshold, input.suggestThreshold, input.scope,
         input.pathwayId ?? null, input.nodeIdentifier ?? null, input.institutionId ?? null]
      );

      const row = result.rows[0];
      return {
        id: row.id, autoResolveThreshold: parseFloat(row.auto_resolve_threshold),
        suggestThreshold: parseFloat(row.suggest_threshold), scope: row.scope,
        pathwayId: row.pathway_id, nodeIdentifier: row.node_identifier, institutionId: row.institution_id,
      };
    },

    async removeResolutionThresholds(_parent: unknown, args: { id: string }, context: DataSourceContext) {
      const result = await context.pool.query(`DELETE FROM confidence_resolution_thresholds WHERE id = $1`, [args.id]);
      if (result.rowCount === 0) throw new GraphQLError('Resolution thresholds not found', { extensions: { code: 'NOT_FOUND' } });
      return true;
    },

    async setNodeWeight(_parent: unknown, args: { input: SetNodeWeightInput }, context: DataSourceContext) {
      const { pool } = context;
      const { input } = args;

      const result = await pool.query(
        `INSERT INTO confidence_node_weights
         (pathway_id, node_identifier, node_type, institution_id, weight_override, propagation_overrides)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT ON CONSTRAINT confidence_node_weights_unique
         DO UPDATE SET weight_override = $5, propagation_overrides = $6
         RETURNING id, pathway_id, node_identifier, node_type, default_weight, institution_id, weight_override, propagation_overrides`,
        [input.pathwayId, input.nodeIdentifier, input.nodeType,
         input.institutionId ?? null, input.weightOverride ?? null, JSON.stringify(input.propagationOverrides ?? {})]
      );

      const row = result.rows[0];
      return {
        id: row.id, pathwayId: row.pathway_id, nodeIdentifier: row.node_identifier,
        nodeType: row.node_type, defaultWeight: parseFloat(row.default_weight),
        institutionId: row.institution_id,
        weightOverride: row.weight_override ? parseFloat(row.weight_override) : null,
        propagationOverrides: row.propagation_overrides,
      };
    },

    async removeNodeWeight(_parent: unknown, args: { id: string }, context: DataSourceContext) {
      const result = await context.pool.query(`DELETE FROM confidence_node_weights WHERE id = $1`, [args.id]);
      if (result.rowCount === 0) throw new GraphQLError('Node weight not found', { extensions: { code: 'NOT_FOUND' } });
      return true;
    },

    // ─── Resolution Engine Mutations ────────────────────────────────────

    async startResolution(
      _parent: unknown,
      args: {
        pathwayId: string;
        patientId: string;
        patientContext?: {
          patientId: string;
          conditionCodes?: Array<{ code: string; system: string; display?: string }>;
          medications?: Array<{ code: string; system: string; display?: string }>;
          labResults?: Array<{ code: string; system: string; value?: number; unit?: string; date?: string; display?: string }>;
          allergies?: Array<{ code: string; system: string; display?: string }>;
          vitalSigns?: Record<string, unknown>;
        };
      },
      context: DataSourceContext
    ) {
      const { pool } = context;

      // 1. Fetch pathway from pathway_graph_index
      const pathwayResult = await pool.query(
        `SELECT ${PATHWAY_COLUMNS} FROM pathway_graph_index WHERE id = $1`,
        [args.pathwayId]
      );
      const pathway = pathwayResult.rows[0];
      if (!pathway) {
        throw new GraphQLError('Pathway not found', { extensions: { code: 'NOT_FOUND' } });
      }
      if (pathway.status !== 'ACTIVE') {
        throw new GraphQLError(`Pathway is not ACTIVE (status: ${pathway.status})`, {
          extensions: { code: 'BAD_USER_INPUT' },
        });
      }

      // 2. Fetch graph from AGE
      if (!pathway.ageNodeId) {
        throw new GraphQLError('Pathway has no graph data (missing AGE node ID)', {
          extensions: { code: 'INTERNAL_SERVER_ERROR' },
        });
      }
      const { nodes, edges } = await fetchGraphFromAGE(pool, pathway.ageNodeId);
      if (nodes.length === 0) {
        throw new GraphQLError('Pathway graph is empty', {
          extensions: { code: 'INTERNAL_SERVER_ERROR' },
        });
      }

      // 3. Build GraphContext
      const graphContext = buildGraphContext(nodes, edges);

      // 4. Load signal definitions and resolve weights
      const signalResult = await pool.query(
        `SELECT id, name, display_name, description, scoring_type, scoring_rules,
                scope, institution_id, default_weight, is_active
         FROM confidence_signal_definitions WHERE is_active = true ORDER BY name ASC`
      );
      const signals: SignalDefinition[] = signalResult.rows.map(hydrateSignalDefinition);

      // 5. Resolve thresholds
      const thresholds = await sharedCascadeResolver.resolveThresholds({
        pool,
        pathwayId: args.pathwayId,
      });

      // 6. Build PatientContext
      const pc = args.patientContext;
      const patientContext: PatientContext = {
        patientId: args.patientId,
        conditionCodes: pc?.conditionCodes ?? [],
        medications: pc?.medications ?? [],
        labResults: pc?.labResults ?? [],
        allergies: pc?.allergies ?? [],
        vitalSigns: pc?.vitalSigns,
      };

      // 7. Create confidence engine and traversal engine
      const confidenceEngine = new ConfidenceEngine(sharedScorerRegistry, sharedCascadeResolver);
      const traversalEngine = new TraversalEngine(
        {
          computeNodeConfidence: async (node: unknown, gc: unknown, pctx: unknown) => {
            return confidenceEngine.computePathwayConfidence({
              pool,
              pathwayId: args.pathwayId,
              nodes: [node as GraphNode],
              edges,
              signalDefinitions: signals,
              patientContext: pctx as PatientContext,
            }).then(r => r.nodes[0] ?? {
              nodeIdentifier: (node as GraphNode).nodeIdentifier,
              nodeType: (node as GraphNode).nodeType,
              confidence: 0.5,
              breakdown: [],
              propagationInfluences: [],
            });
          },
        },
        thresholds,
      );

      // 8. Run traversal
      const traversalResult = await traversalEngine.traverse(
        graphContext,
        patientContext,
        new Map<string, GateAnswer>(),
      );

      // 9. Determine session status
      const status = traversalResult.isDegraded
        ? SessionStatus.DEGRADED
        : SessionStatus.ACTIVE;

      // 10. Create session
      const sessionId = await createSession(pool, {
        pathwayId: args.pathwayId,
        pathwayVersion: pathway.version,
        patientId: args.patientId,
        providerId: context.userId,
        status,
        initialPatientContext: patientContext,
        resolutionState: traversalResult.resolutionState,
        dependencyMap: traversalResult.dependencyMap,
        pendingQuestions: traversalResult.pendingQuestions,
        redFlags: traversalResult.redFlags,
        totalNodesEvaluated: traversalResult.totalNodesEvaluated,
        traversalDurationMs: traversalResult.traversalDurationMs,
      });

      // 11. Log event
      await logEvent(pool, sessionId, {
        eventType: 'traversal_complete',
        triggerData: {
          pathwayId: args.pathwayId,
          patientId: args.patientId,
          nodesInGraph: nodes.length,
        },
        nodesRecomputed: traversalResult.totalNodesEvaluated,
        statusChanges: [],
      });

      // 12. Return formatted session
      const session = await getSession(pool, sessionId);
      if (!session) {
        throw new GraphQLError('Failed to retrieve created session', {
          extensions: { code: 'INTERNAL_SERVER_ERROR' },
        });
      }
      return formatSessionForGraphQL(session);
    },

    async overrideNode(
      _parent: unknown,
      args: { sessionId: string; nodeId: string; action: OverrideAction; reason?: string },
      context: DataSourceContext
    ) {
      const { pool } = context;

      // 1. Load session
      const session = await getSession(pool, args.sessionId);
      if (!session) {
        throw new GraphQLError('Session not found', { extensions: { code: 'NOT_FOUND' } });
      }
      if (session.status !== SessionStatus.ACTIVE && session.status !== SessionStatus.DEGRADED) {
        throw new GraphQLError(`Cannot modify session with status "${session.status}"`, {
          extensions: { code: 'BAD_USER_INPUT' },
        });
      }

      // 2. Find the node
      const nodeResult = session.resolutionState.get(args.nodeId);
      if (!nodeResult) {
        throw new GraphQLError(`Node "${args.nodeId}" not found in session`, {
          extensions: { code: 'NOT_FOUND' },
        });
      }

      // 3. Store previous state as provider override
      const originalStatus = nodeResult.status;
      const originalConfidence = nodeResult.confidence;
      nodeResult.providerOverride = {
        action: args.action,
        reason: args.reason,
        originalStatus,
        originalConfidence,
      };

      // 4. Set new status
      nodeResult.status = args.action === OverrideAction.INCLUDE
        ? NodeStatus.INCLUDED
        : NodeStatus.EXCLUDED;

      // 5. Find affected nodes
      const affectedNodes = new Set<string>();
      const influenced = session.dependencyMap.influences.get(args.nodeId);
      if (influenced) {
        for (const depId of influenced) {
          affectedNodes.add(depId);
        }
      }

      // 6. Run re-traversal on affected nodes if any
      const statusChanges: Array<{ nodeId: string; from: string; to: string }> = [
        { nodeId: args.nodeId, from: originalStatus, to: nodeResult.status },
      ];

      if (affectedNodes.size > 0) {
        // Build graph context for retraversal
        const pathwayRow = await pool.query(
          'SELECT age_node_id FROM pathway_graph_index WHERE id = $1',
          [session.pathwayId]
        );
        if (pathwayRow.rows[0]?.age_node_id) {
          const { nodes, edges } = await fetchGraphFromAGE(pool, pathwayRow.rows[0].age_node_id);
          const graphContext = buildGraphContext(nodes, edges);

          const thresholds = await sharedCascadeResolver.resolveThresholds({
            pool,
            pathwayId: session.pathwayId,
          });

          const confidenceEngine = new ConfidenceEngine(sharedScorerRegistry, sharedCascadeResolver);
          const retraversalEngine = new RetraversalEngine(
            {
              computeNodeConfidence: async (nodeId: unknown, gc: unknown, pctx: unknown) => {
                const nodeIdStr = typeof nodeId === 'string' ? nodeId : (nodeId as GraphNode).nodeIdentifier;
                const graphNode = graphContext.getNode(nodeIdStr);
                if (!graphNode) {
                  return { confidence: 0.5, breakdown: [], resolutionType: 'SYSTEM_SUGGESTED' };
                }
                const signalResult = await pool.query(
                  `SELECT id, name, display_name, description, scoring_type, scoring_rules,
                          scope, institution_id, default_weight, is_active
                   FROM confidence_signal_definitions WHERE is_active = true`
                );
                const signals = signalResult.rows.map(hydrateSignalDefinition);
                const result = await confidenceEngine.computePathwayConfidence({
                  pool,
                  pathwayId: session.pathwayId,
                  nodes: [graphNode],
                  edges,
                  signalDefinitions: signals,
                  patientContext: session.initialPatientContext as PatientContext,
                });
                const nodeConf = result.nodes[0];
                return nodeConf
                  ? { confidence: nodeConf.confidence, breakdown: nodeConf.breakdown, resolutionType: nodeConf.resolutionType ?? 'SYSTEM_SUGGESTED' }
                  : { confidence: 0.5, breakdown: [], resolutionType: 'SYSTEM_SUGGESTED' };
              },
            },
            thresholds,
          );

          const reResult = await retraversalEngine.retraverse(
            affectedNodes,
            session.resolutionState,
            session.dependencyMap,
            graphContext,
            session.initialPatientContext as PatientContext,
            new Map<string, GateAnswer>(),
          );

          statusChanges.push(...reResult.statusChanges);
        }
      }

      // 7. Update session
      await updateSession(pool, args.sessionId, {
        resolutionState: session.resolutionState,
        totalNodesEvaluated: session.resolutionState.size,
      });

      // 8. Log event
      await logEvent(pool, args.sessionId, {
        eventType: 'override',
        triggerData: {
          nodeId: args.nodeId,
          action: args.action,
          reason: args.reason,
        },
        nodesRecomputed: affectedNodes.size + 1,
        statusChanges,
      });

      // 9. Log to pathway_node_overrides
      await logNodeOverride(pool, {
        sessionId: args.sessionId,
        nodeId: args.nodeId,
        pathwayId: session.pathwayId,
        action: args.action,
        reason: args.reason,
        originalStatus,
        originalConfidence,
      });

      // 10. Return formatted session
      const updated = await getSession(pool, args.sessionId);
      return formatSessionForGraphQL(updated!);
    },

    async answerGateQuestion(
      _parent: unknown,
      args: { sessionId: string; gateId: string; answer: GateAnswerInput },
      context: DataSourceContext
    ) {
      const { pool } = context;

      // 1. Load session
      const session = await getSession(pool, args.sessionId);
      if (!session) {
        throw new GraphQLError('Session not found', { extensions: { code: 'NOT_FOUND' } });
      }
      if (session.status !== SessionStatus.ACTIVE && session.status !== SessionStatus.DEGRADED) {
        throw new GraphQLError(`Cannot modify session with status "${session.status}"`, {
          extensions: { code: 'BAD_USER_INPUT' },
        });
      }

      // 2. Find gate in resolution state
      const gateResult = session.resolutionState.get(args.gateId);
      if (!gateResult) {
        throw new GraphQLError(`Gate "${args.gateId}" not found in session`, {
          extensions: { code: 'NOT_FOUND' },
        });
      }

      // 3. Build gate answers map
      const gateAnswers = new Map<string, GateAnswer>();
      gateAnswers.set(args.gateId, {
        booleanValue: args.answer.booleanValue,
        numericValue: args.answer.numericValue,
        selectedOption: args.answer.selectedOption,
      });

      // Determine if gate opens based on the answer
      const gateOpened = args.answer.booleanValue === true ||
        args.answer.selectedOption !== undefined ||
        args.answer.numericValue !== undefined;

      // 4-6. Re-evaluate: fetch graph, build context, re-traverse affected subtree
      const pathwayRow = await pool.query(
        'SELECT age_node_id FROM pathway_graph_index WHERE id = $1',
        [session.pathwayId]
      );

      const statusChanges: Array<{ nodeId: string; from: string; to: string }> = [];
      let nodesRecomputed = 0;

      if (pathwayRow.rows[0]?.age_node_id) {
        const { nodes, edges } = await fetchGraphFromAGE(pool, pathwayRow.rows[0].age_node_id);
        const graphContext = buildGraphContext(nodes, edges);

        // Find all nodes in the gate's subtree
        const affectedNodes = new Set<string>();
        affectedNodes.add(args.gateId);
        const subtreeQueue = [args.gateId];
        while (subtreeQueue.length > 0) {
          const id = subtreeQueue.shift()!;
          for (const edge of graphContext.outgoingEdges(id)) {
            if (!affectedNodes.has(edge.targetId)) {
              affectedNodes.add(edge.targetId);
              subtreeQueue.push(edge.targetId);
            }
          }
        }

        if (gateOpened) {
          // Gate opens: mark gate as INCLUDED and re-traverse subtree
          const previousGateStatus = gateResult.status;
          gateResult.status = NodeStatus.INCLUDED;
          gateResult.confidence = 1;
          gateResult.excludeReason = undefined;
          statusChanges.push({ nodeId: args.gateId, from: previousGateStatus, to: NodeStatus.INCLUDED });

          // Remove subtree nodes from resolution state so they can be re-evaluated
          for (const nodeId of affectedNodes) {
            if (nodeId !== args.gateId && session.resolutionState.has(nodeId)) {
              const existing = session.resolutionState.get(nodeId)!;
              if (existing.status === NodeStatus.PENDING_QUESTION || existing.status === NodeStatus.GATED_OUT) {
                session.resolutionState.delete(nodeId);
              }
            }
          }

          // Run re-traversal
          const thresholds = await sharedCascadeResolver.resolveThresholds({
            pool,
            pathwayId: session.pathwayId,
          });

          const confidenceEngine = new ConfidenceEngine(sharedScorerRegistry, sharedCascadeResolver);
          const signalResult = await pool.query(
            `SELECT id, name, display_name, description, scoring_type, scoring_rules,
                    scope, institution_id, default_weight, is_active
             FROM confidence_signal_definitions WHERE is_active = true`
          );
          const signals = signalResult.rows.map(hydrateSignalDefinition);

          const traversalEngine = new TraversalEngine(
            {
              computeNodeConfidence: async (node: unknown, _gc: unknown, pctx: unknown) => {
                const result = await confidenceEngine.computePathwayConfidence({
                  pool,
                  pathwayId: session.pathwayId,
                  nodes: [node as GraphNode],
                  edges,
                  signalDefinitions: signals,
                  patientContext: pctx as PatientContext,
                });
                return result.nodes[0] ?? {
                  nodeIdentifier: (node as GraphNode).nodeIdentifier,
                  nodeType: (node as GraphNode).nodeType,
                  confidence: 0.5,
                  breakdown: [],
                  propagationInfluences: [],
                };
              },
            },
            thresholds,
          );

          // Re-traverse the subtree by running full traversal and merging
          const fullResult = await traversalEngine.traverse(
            graphContext,
            session.initialPatientContext as PatientContext,
            gateAnswers,
          );

          // Merge new results for affected nodes
          for (const [nodeId, result] of fullResult.resolutionState) {
            if (affectedNodes.has(nodeId) && nodeId !== args.gateId) {
              const oldResult = session.resolutionState.get(nodeId);
              session.resolutionState.set(nodeId, result);
              if (oldResult && oldResult.status !== result.status) {
                statusChanges.push({ nodeId, from: oldResult.status, to: result.status });
              }
              nodesRecomputed++;
            }
          }

          // Update pending questions and red flags
          session.pendingQuestions = fullResult.pendingQuestions;
          session.redFlags = fullResult.redFlags;
        } else {
          // Gate closes: mark subtree as GATED_OUT
          const previousGateStatus = gateResult.status;
          gateResult.status = NodeStatus.GATED_OUT;
          gateResult.excludeReason = 'Gate answer: condition not met';
          statusChanges.push({ nodeId: args.gateId, from: previousGateStatus, to: NodeStatus.GATED_OUT });

          for (const nodeId of affectedNodes) {
            if (nodeId === args.gateId) continue;
            const existing = session.resolutionState.get(nodeId);
            if (existing) {
              const oldStatus = existing.status;
              existing.status = NodeStatus.GATED_OUT;
              existing.excludeReason = `Gated out by answer to ${gateResult.title}`;
              if (oldStatus !== NodeStatus.GATED_OUT) {
                statusChanges.push({ nodeId, from: oldStatus, to: NodeStatus.GATED_OUT });
              }
              nodesRecomputed++;
            }
          }

          // Remove the answered question from pending
          session.pendingQuestions = session.pendingQuestions.filter(q => q.gateId !== args.gateId);
        }
      }

      // 7. Update session
      await updateSession(pool, args.sessionId, {
        resolutionState: session.resolutionState,
        pendingQuestions: session.pendingQuestions,
        redFlags: session.redFlags,
        totalNodesEvaluated: session.resolutionState.size,
      });

      // 8. Log event
      await logEvent(pool, args.sessionId, {
        eventType: 'gate_answer',
        triggerData: {
          gateId: args.gateId,
          answer: args.answer,
          gateOpened,
        },
        nodesRecomputed,
        statusChanges,
      });

      // 9. Log to pathway_gate_answers
      await logGateAnswer(pool, {
        sessionId: args.sessionId,
        gateId: args.gateId,
        pathwayId: session.pathwayId,
        answer: args.answer,
        gateOpened,
      });

      // 10. Return formatted session
      const updated = await getSession(pool, args.sessionId);
      return formatSessionForGraphQL(updated!);
    },

    async addPatientContext(
      _parent: unknown,
      args: { sessionId: string; additionalContext: AdditionalContextInput },
      context: DataSourceContext
    ) {
      const { pool } = context;

      // 1. Load session
      const session = await getSession(pool, args.sessionId);
      if (!session) {
        throw new GraphQLError('Session not found', { extensions: { code: 'NOT_FOUND' } });
      }
      if (session.status !== SessionStatus.ACTIVE && session.status !== SessionStatus.DEGRADED) {
        throw new GraphQLError(`Cannot modify session with status "${session.status}"`, {
          extensions: { code: 'BAD_USER_INPUT' },
        });
      }

      // 2. Merge additional context
      const merged = { ...(session.additionalContext ?? {}), ...args.additionalContext };

      // 3. Build updated patient context for re-evaluation
      const basePc = session.initialPatientContext as PatientContext;
      const updatedPc: PatientContext = {
        patientId: basePc.patientId,
        conditionCodes: [
          ...basePc.conditionCodes,
          ...(args.additionalContext.conditionCodes ?? []),
        ],
        medications: [
          ...basePc.medications,
          ...(args.additionalContext.medications ?? []),
        ],
        labResults: [
          ...basePc.labResults,
          ...(args.additionalContext.labResults ?? []),
        ],
        allergies: [
          ...basePc.allergies,
          ...(args.additionalContext.allergies ?? []),
        ],
        vitalSigns: {
          ...(basePc.vitalSigns ?? {}),
          ...(args.additionalContext.vitalSigns ?? {}),
        },
      };

      // 4. Identify affected nodes via dependency maps
      const affectedNodes = new Set<string>();
      for (const [gateId, fields] of session.dependencyMap.gateContextFields) {
        // If any context field was updated that a gate reads, mark the gate as affected
        for (const field of fields) {
          if (args.additionalContext.conditionCodes && field.includes('condition')) affectedNodes.add(gateId);
          if (args.additionalContext.medications && field.includes('medication')) affectedNodes.add(gateId);
          if (args.additionalContext.labResults && field.includes('lab')) affectedNodes.add(gateId);
          if (args.additionalContext.allergies && field.includes('allerg')) affectedNodes.add(gateId);
          if (args.additionalContext.vitalSigns && field.includes('vital')) affectedNodes.add(gateId);
        }
      }

      // Also mark all action nodes for re-scoring (context affects confidence)
      for (const [nodeId, nodeResult] of session.resolutionState) {
        if (nodeResult.nodeType !== 'Gate' && nodeResult.nodeType !== 'Pathway') {
          affectedNodes.add(nodeId);
        }
      }

      // 5. Run re-traversal
      const statusChanges: Array<{ nodeId: string; from: string; to: string }> = [];
      let nodesRecomputed = 0;

      if (affectedNodes.size > 0) {
        const pathwayRow = await pool.query(
          'SELECT age_node_id FROM pathway_graph_index WHERE id = $1',
          [session.pathwayId]
        );

        if (pathwayRow.rows[0]?.age_node_id) {
          const { nodes, edges } = await fetchGraphFromAGE(pool, pathwayRow.rows[0].age_node_id);
          const graphContext = buildGraphContext(nodes, edges);

          const thresholds = await sharedCascadeResolver.resolveThresholds({
            pool,
            pathwayId: session.pathwayId,
          });

          const confidenceEngine = new ConfidenceEngine(sharedScorerRegistry, sharedCascadeResolver);
          const retraversalEngine = new RetraversalEngine(
            {
              computeNodeConfidence: async (nodeId: unknown, _gc: unknown, _pctx: unknown) => {
                const nodeIdStr = typeof nodeId === 'string' ? nodeId : (nodeId as GraphNode).nodeIdentifier;
                const graphNode = graphContext.getNode(nodeIdStr);
                if (!graphNode) {
                  return { confidence: 0.5, breakdown: [], resolutionType: 'SYSTEM_SUGGESTED' };
                }
                const sigResult = await pool.query(
                  `SELECT id, name, display_name, description, scoring_type, scoring_rules,
                          scope, institution_id, default_weight, is_active
                   FROM confidence_signal_definitions WHERE is_active = true`
                );
                const signals = sigResult.rows.map(hydrateSignalDefinition);
                const result = await confidenceEngine.computePathwayConfidence({
                  pool,
                  pathwayId: session.pathwayId,
                  nodes: [graphNode],
                  edges,
                  signalDefinitions: signals,
                  patientContext: updatedPc,
                });
                const nodeConf = result.nodes[0];
                return nodeConf
                  ? { confidence: nodeConf.confidence, breakdown: nodeConf.breakdown, resolutionType: nodeConf.resolutionType ?? 'SYSTEM_SUGGESTED' }
                  : { confidence: 0.5, breakdown: [], resolutionType: 'SYSTEM_SUGGESTED' };
              },
            },
            thresholds,
          );

          const reResult = await retraversalEngine.retraverse(
            affectedNodes,
            session.resolutionState,
            session.dependencyMap,
            graphContext,
            updatedPc,
            new Map<string, GateAnswer>(),
          );

          statusChanges.push(...reResult.statusChanges);
          nodesRecomputed = reResult.nodesRecomputed;

          // Update pending questions and red flags
          if (reResult.newPendingQuestions.length > 0) {
            session.pendingQuestions = [...session.pendingQuestions, ...reResult.newPendingQuestions];
          }
          if (reResult.newRedFlags.length > 0) {
            session.redFlags = [...session.redFlags, ...reResult.newRedFlags];
          }
        }
      }

      // 6. Update session
      await updateSession(pool, args.sessionId, {
        resolutionState: session.resolutionState,
        additionalContext: merged,
        pendingQuestions: session.pendingQuestions,
        redFlags: session.redFlags,
        totalNodesEvaluated: session.resolutionState.size,
      });

      // 7. Log event
      await logEvent(pool, args.sessionId, {
        eventType: 'context_update',
        triggerData: {
          addedContext: Object.keys(args.additionalContext).filter(
            k => (args.additionalContext as Record<string, unknown>)[k] !== undefined
          ),
        },
        nodesRecomputed,
        statusChanges,
      });

      // 8. Return formatted session
      const updated = await getSession(pool, args.sessionId);
      return formatSessionForGraphQL(updated!);
    },

    async generateCarePlanFromResolution(
      _parent: unknown,
      args: { sessionId: string },
      context: DataSourceContext
    ) {
      const { pool } = context;

      // 1. Load session
      const session = await getSession(pool, args.sessionId);
      if (!session) {
        throw new GraphQLError('Session not found', { extensions: { code: 'NOT_FOUND' } });
      }

      // 2. Validate
      const blockers = validateForGeneration(session.resolutionState, session.redFlags);
      if (blockers.length > 0) {
        return {
          success: false as const,
          carePlanId: null as string | null,
          warnings: [] as string[],
          blockers: blockers.map(b => ({
            type: b.type,
            description: b.description,
            relatedNodeIds: b.relatedNodeIds,
          })),
        };
      }

      // 3. Generate care plan data
      const carePlanData = generateCarePlan(
        session.resolutionState,
        session.pathwayId,
        args.sessionId,
      );

      // 4. Insert into care_plans
      const carePlanResult = await pool.query(
        `INSERT INTO care_plans (patient_id, provider_id, status, condition_codes, source, pathway_session_id)
         VALUES ($1, $2, 'DRAFT', $3, 'pathway_resolution', $4)
         RETURNING id`,
        [
          session.patientId,
          session.providerId,
          JSON.stringify(carePlanData.conditionCodes),
          args.sessionId,
        ]
      );
      const carePlanId = carePlanResult.rows[0].id;

      // 5. Insert goals
      for (const goal of carePlanData.goals) {
        await pool.query(
          `INSERT INTO care_plan_goals (care_plan_id, description, priority, guideline_reference, pathway_node_id)
           VALUES ($1, $2, $3, $4, $5)`,
          [carePlanId, goal.description, goal.priority, goal.guidelineReference ?? null, goal.pathwayNodeId]
        );
      }

      // 6. Insert interventions
      for (const intervention of carePlanData.interventions) {
        await pool.query(
          `INSERT INTO care_plan_interventions
           (care_plan_id, type, description, medication_code, dosage, frequency,
            procedure_code, referral_specialty, patient_instructions, guideline_reference,
            recommendation_confidence, source, pathway_node_id, pathway_id, session_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
          [
            carePlanId, intervention.type, intervention.description,
            intervention.medicationCode ?? null, intervention.dosage ?? null,
            intervention.frequency ?? null, intervention.procedureCode ?? null,
            intervention.referralSpecialty ?? null, intervention.patientInstructions ?? null,
            intervention.guidelineReference ?? null, intervention.recommendationConfidence,
            intervention.source, intervention.pathwayNodeId,
            intervention.pathwayId, intervention.sessionId,
          ]
        );
      }

      // 7. Update session with carePlanId and COMPLETED status
      await updateSession(pool, args.sessionId, {
        carePlanId,
        status: SessionStatus.COMPLETED,
      });

      // 8. Log event
      await logEvent(pool, args.sessionId, {
        eventType: 'care_plan_generated',
        triggerData: {
          carePlanId,
          goalsCount: carePlanData.goals.length,
          interventionsCount: carePlanData.interventions.length,
        },
        nodesRecomputed: 0,
        statusChanges: [{ nodeId: 'session', from: session.status, to: SessionStatus.COMPLETED }],
      });

      return {
        success: true as const,
        carePlanId,
        warnings: [] as string[],
        blockers: [] as Array<{ type: string; description: string; relatedNodeIds: string[] }>,
      };
    },

    async abandonSession(
      _parent: unknown,
      args: { sessionId: string; reason?: string },
      context: DataSourceContext
    ) {
      const { pool } = context;

      // 1. Load session
      const session = await getSession(pool, args.sessionId);
      if (!session) {
        throw new GraphQLError('Session not found', { extensions: { code: 'NOT_FOUND' } });
      }

      // 2. Set status to ABANDONED
      await updateSession(pool, args.sessionId, {
        status: SessionStatus.ABANDONED,
      });

      // 3. Log event
      await logEvent(pool, args.sessionId, {
        eventType: 'abandoned',
        triggerData: { reason: args.reason ?? 'No reason provided' },
        nodesRecomputed: 0,
        statusChanges: [{ nodeId: 'session', from: session.status, to: SessionStatus.ABANDONED }],
      });

      // 4. Return formatted session
      const updated = await getSession(pool, args.sessionId);
      return formatSessionForGraphQL(updated!);
    },

    async updateSignalDefinition(_parent: unknown, args: { id: string; input: UpdateSignalInput }, context: DataSourceContext) {
      const { pool } = context;
      const { id, input } = args;

      const setClauses: string[] = [];
      const params: unknown[] = [];
      let paramIdx = 1;

      if (input.displayName !== undefined) { setClauses.push(`display_name = $${paramIdx++}`); params.push(input.displayName); }
      if (input.description !== undefined) { setClauses.push(`description = $${paramIdx++}`); params.push(input.description); }
      if (input.scoringRules !== undefined) {
        let rules = input.scoringRules;
        if (input.propagationConfig) rules = { ...rules, propagation: input.propagationConfig };
        setClauses.push(`scoring_rules = $${paramIdx++}`); params.push(JSON.stringify(rules));
      } else if (input.propagationConfig) {
        setClauses.push(`scoring_rules = scoring_rules || $${paramIdx++}::jsonb`);
        params.push(JSON.stringify({ propagation: input.propagationConfig }));
      }
      if (input.defaultWeight !== undefined) {
        if (input.defaultWeight < 0 || input.defaultWeight > 1) {
          throw new GraphQLError('defaultWeight must be between 0.0 and 1.0', {
            extensions: { code: 'BAD_USER_INPUT' },
          });
        }
        setClauses.push(`default_weight = $${paramIdx++}`); params.push(input.defaultWeight);
      }
      if (input.isActive !== undefined) { setClauses.push(`is_active = $${paramIdx++}`); params.push(input.isActive); }

      if (setClauses.length === 0) throw new GraphQLError('No fields to update', { extensions: { code: 'BAD_USER_INPUT' } });

      params.push(id);
      const result = await pool.query(
        `UPDATE confidence_signal_definitions SET ${setClauses.join(', ')} WHERE id = $${paramIdx}
         RETURNING id, name, display_name, description, scoring_type, scoring_rules, scope, institution_id, default_weight, is_active`,
        params
      );

      if (!result.rows[0]) throw new GraphQLError('Signal definition not found', { extensions: { code: 'NOT_FOUND' } });
      return hydrateSignalDefinition(result.rows[0]);
    },
  },
};
