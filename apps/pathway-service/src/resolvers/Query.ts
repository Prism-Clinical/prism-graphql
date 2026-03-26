import { GraphQLError } from 'graphql';
import { DataSourceContext } from '../types';
import { ConfidenceEngine } from '../services/confidence/confidence-engine';
import { SignalDefinition, ResolvedWeight, normalizePropagationMode, PatientContext } from '../services/confidence/types';
import {
  getSession,
  getMatchedPathways,
  getPatientSessions,
} from '../services/resolution/session-store';
import { ResolutionSession, NodeResult, NodeStatus } from '../services/resolution/types';
import { fetchGraphFromAGE, buildGraphContext, sharedScorerRegistry, sharedCascadeResolver } from './helpers/resolution-context';

// ─── GraphQL Formatting ──────────────────────────────────────────────

function formatNodeForGraphQL(node: NodeResult) {
  return {
    nodeId: node.nodeId,
    nodeType: node.nodeType,
    title: node.title,
    status: node.status,
    confidence: node.confidence,
    confidenceBreakdown: node.confidenceBreakdown ?? [],
    providerOverride: node.providerOverride
      ? {
          action: node.providerOverride.action,
          reason: node.providerOverride.reason ?? null,
          originalStatus: node.providerOverride.originalStatus,
          originalConfidence: node.providerOverride.originalConfidence,
        }
      : null,
    excludeReason: node.excludeReason ?? null,
    parentNodeId: node.parentNodeId ?? null,
    depth: node.depth,
  };
}

function formatEventForGraphQL(event: {
  id?: string;
  event_type?: string;
  eventType?: string;
  trigger_data?: unknown;
  triggerData?: unknown;
  nodes_recomputed?: number;
  nodesRecomputed?: number;
  status_changes?: unknown;
  statusChanges?: unknown;
  created_at?: Date | string;
  createdAt?: Date | string;
}) {
  return {
    id: event.id ?? '',
    eventType: event.event_type ?? event.eventType ?? '',
    triggerData: event.trigger_data ?? event.triggerData ?? null,
    nodesRecomputed: event.nodes_recomputed ?? event.nodesRecomputed ?? 0,
    statusChanges: event.status_changes ?? event.statusChanges ?? null,
    createdAt: (event.created_at ?? event.createdAt)?.toString() ?? '',
  };
}

export function formatSessionForGraphQL(session: ResolutionSession) {
  const includedNodes: ReturnType<typeof formatNodeForGraphQL>[] = [];
  const excludedNodes: ReturnType<typeof formatNodeForGraphQL>[] = [];
  const gatedOutNodes: ReturnType<typeof formatNodeForGraphQL>[] = [];

  for (const node of session.resolutionState.values()) {
    const formatted = formatNodeForGraphQL(node);
    switch (node.status) {
      case NodeStatus.INCLUDED:
        includedNodes.push(formatted);
        break;
      case NodeStatus.EXCLUDED:
        excludedNodes.push(formatted);
        break;
      case NodeStatus.GATED_OUT:
        gatedOutNodes.push(formatted);
        break;
      default:
        // PENDING_QUESTION, TIMEOUT, CASCADE_LIMIT, UNKNOWN go into gatedOut
        gatedOutNodes.push(formatted);
        break;
    }
  }

  return {
    id: session.id,
    pathwayId: session.pathwayId,
    pathwayVersion: session.pathwayVersion,
    patientId: session.patientId,
    providerId: session.providerId,
    status: session.status,
    includedNodes,
    excludedNodes,
    gatedOutNodes,
    pendingQuestions: session.pendingQuestions.map(q => ({
      gateId: q.gateId,
      prompt: q.prompt,
      answerType: q.answerType,
      options: q.options ?? null,
      affectedSubtreeSize: q.affectedSubtreeSize,
      estimatedImpact: q.estimatedImpact,
    })),
    redFlags: session.redFlags.map(f => ({
      nodeId: f.nodeId,
      nodeTitle: f.nodeTitle,
      type: f.type,
      description: f.description,
      branches: f.branches?.map(b => ({
        nodeId: b.nodeId,
        title: b.title,
        confidence: b.confidence,
        topExcludeReason: b.topExcludeReason ?? null,
      })) ?? null,
    })),
    resolutionEvents: (session.resolutionEvents ?? []).map(formatEventForGraphQL),
    totalNodesEvaluated: session.totalNodesEvaluated,
    traversalDurationMs: session.traversalDurationMs,
    createdAt: session.createdAt?.toString() ?? '',
    updatedAt: session.updatedAt?.toString() ?? '',
  };
}

export const PATHWAY_COLUMNS = `
  id, age_node_id AS "ageNodeId", logical_id AS "logicalId",
  title, version, category, status,
  condition_codes AS "conditionCodes",
  scope, target_population AS "targetPopulation",
  is_active AS "isActive",
  created_at AS "createdAt", updated_at AS "updatedAt"
`;

export const Query = {
  Query: {
    pathwayServiceHealth: (): boolean => true,

    pathways: async (
      _: unknown,
      args: { status?: string; category?: string; first?: number },
      context: DataSourceContext
    ) => {
      const { pool } = context;
      const first = args.first ?? 50;

      let query = `SELECT ${PATHWAY_COLUMNS} FROM pathway_graph_index WHERE 1=1`;
      const params: unknown[] = [];
      let paramIdx = 1;

      if (args.status) {
        query += ` AND status = $${paramIdx}`;
        params.push(args.status);
        paramIdx++;
      }
      if (args.category) {
        query += ` AND category = $${paramIdx}`;
        params.push(args.category);
        paramIdx++;
      }

      query += ` ORDER BY updated_at DESC LIMIT $${paramIdx}`;
      params.push(first);

      const result = await pool.query(query, params);
      return result.rows;
    },

    pathway: async (
      _: unknown,
      args: { id: string },
      context: DataSourceContext
    ) => {
      const { pool } = context;
      const result = await pool.query(
        `SELECT ${PATHWAY_COLUMNS} FROM pathway_graph_index WHERE id = $1`,
        [args.id]
      );
      return result.rows[0] || null;
    },

    signalDefinitions: async (
      _: unknown,
      args: { scope?: string; institutionId?: string },
      context: DataSourceContext
    ) => {
      const { pool } = context;
      let query = `SELECT id, name, display_name, description, scoring_type, scoring_rules,
                          scope, institution_id, default_weight, is_active
                   FROM confidence_signal_definitions WHERE is_active = true`;
      const params: unknown[] = [];
      let paramIdx = 1;

      if (args.scope) {
        query += ` AND scope = $${paramIdx}`;
        params.push(args.scope);
        paramIdx++;
      }
      if (args.institutionId) {
        query += ` AND (institution_id = $${paramIdx} OR institution_id IS NULL)`;
        params.push(args.institutionId);
        paramIdx++;
      }

      query += ` ORDER BY name ASC`;
      const result = await pool.query(query, params);

      return result.rows.map(hydrateSignalDefinition);
    },

    effectiveWeights: async (
      _: unknown,
      args: { pathwayId: string; institutionId?: string; organizationId?: string },
      context: DataSourceContext
    ) => {
      const { pool } = context;

      const signalResult = await pool.query(
        `SELECT id, name, display_name, description, scoring_type, scoring_rules,
                scope, institution_id, default_weight, is_active
         FROM confidence_signal_definitions WHERE is_active = true ORDER BY name ASC`
      );
      const signals = signalResult.rows.map(hydrateSignalDefinition);

      const nodeResult = await pool.query<{ node_identifier: string; node_type: string }>(
        `SELECT node_identifier, node_type
         FROM confidence_node_weights WHERE pathway_id = $1`,
        [args.pathwayId]
      );

      const cascadeResolver = sharedCascadeResolver;
      const matrix = await cascadeResolver.resolveAllWeights({
        pool,
        pathwayId: args.pathwayId,
        signalDefinitions: signals,
        nodeIdentifiers: nodeResult.rows.map(r => ({
          nodeIdentifier: r.node_identifier,
          nodeType: r.node_type,
        })),
        institutionId: args.institutionId,
        organizationId: args.organizationId,
      });

      const entries: Array<{ nodeIdentifier: string; signalName: string; weight: number; source: string }> = [];
      for (const [nodeId, nodeSignals] of Object.entries(matrix)) {
        for (const [signalName, resolved] of Object.entries(nodeSignals) as Array<[string, ResolvedWeight]>) {
          entries.push({
            nodeIdentifier: nodeId,
            signalName,
            weight: resolved.weight,
            source: resolved.source,
          });
        }
      }

      return { entries };
    },

    effectiveThresholds: async (
      _: unknown,
      args: { pathwayId: string; nodeIdentifier?: string; institutionId?: string; organizationId?: string },
      context: DataSourceContext
    ) => {
      const cascadeResolver = sharedCascadeResolver;
      return cascadeResolver.resolveThresholds({
        pool: context.pool,
        pathwayId: args.pathwayId,
        nodeIdentifier: args.nodeIdentifier,
        institutionId: args.institutionId,
        organizationId: args.organizationId,
      });
    },

    pathwayConfidence: async (
      _: unknown,
      args: {
        pathwayId: string;
        patientContext: {
          patientId: string;
          conditionCodes?: Array<{ code: string; system: string; display?: string }>;
          medications?: Array<{ code: string; system: string; display?: string }>;
          labResults?: Array<{ code: string; system: string; value?: number; unit?: string; date?: string; display?: string }>;
          allergies?: Array<{ code: string; system: string; display?: string }>;
          vitalSigns?: Record<string, unknown>;
        };
        institutionId?: string;
        organizationId?: string;
      },
      context: DataSourceContext
    ) => {
      const { pool } = context;

      const pathwayResult = await pool.query(
        'SELECT age_node_id FROM pathway_graph_index WHERE id = $1',
        [args.pathwayId],
      );
      const ageNodeId = pathwayResult.rows[0]?.age_node_id;
      if (!ageNodeId) {
        throw new GraphQLError('Pathway not found or has no graph data', {
          extensions: { code: 'NOT_FOUND' },
        });
      }

      // Fetch graph and signals in parallel
      const [{ nodes, edges }, signalResult] = await Promise.all([
        fetchGraphFromAGE(pool, ageNodeId),
        pool.query(
          `SELECT id, name, display_name, description, scoring_type, scoring_rules,
                  scope, institution_id, default_weight, is_active
           FROM confidence_signal_definitions WHERE is_active = true ORDER BY name ASC`
        ),
      ]);
      const signals = signalResult.rows.map(hydrateSignalDefinition);

      const pc: PatientContext = {
        patientId: args.patientContext.patientId,
        conditionCodes: args.patientContext.conditionCodes ?? [],
        medications: args.patientContext.medications ?? [],
        labResults: args.patientContext.labResults ?? [],
        allergies: args.patientContext.allergies ?? [],
        vitalSigns: args.patientContext.vitalSigns,
      };

      const confidenceEngine = new ConfidenceEngine(sharedScorerRegistry, sharedCascadeResolver);
      const result = await confidenceEngine.computePathwayConfidence({
        pool,
        pathwayId: args.pathwayId,
        nodes,
        edges,
        signalDefinitions: signals,
        patientContext: pc,
      });

      return {
        pathwayId: args.pathwayId,
        overallConfidence: result.overallConfidence,
        nodes: result.nodes,
      };
    },

    // ─── Resolution Query Resolvers ─────────────────────────────────────

    matchedPathways: async (
      _: unknown,
      args: { patientId: string },
      context: DataSourceContext
    ) => {
      return getMatchedPathways(context.pool, args.patientId);
    },

    resolutionSession: async (
      _: unknown,
      args: { sessionId: string },
      context: DataSourceContext
    ) => {
      const session = await getSession(context.pool, args.sessionId);
      if (!session) return null;
      return formatSessionForGraphQL(session);
    },

    pendingQuestions: async (
      _: unknown,
      args: { sessionId: string },
      context: DataSourceContext
    ) => {
      const session = await getSession(context.pool, args.sessionId);
      if (!session) return [];
      return session.pendingQuestions.map(q => ({
        gateId: q.gateId,
        prompt: q.prompt,
        answerType: q.answerType,
        options: q.options ?? null,
        affectedSubtreeSize: q.affectedSubtreeSize,
        estimatedImpact: q.estimatedImpact,
      }));
    },

    redFlags: async (
      _: unknown,
      args: { sessionId: string },
      context: DataSourceContext
    ) => {
      const session = await getSession(context.pool, args.sessionId);
      if (!session) return [];
      return session.redFlags.map(f => ({
        nodeId: f.nodeId,
        nodeTitle: f.nodeTitle,
        type: f.type,
        description: f.description,
        branches: f.branches?.map(b => ({
          nodeId: b.nodeId,
          title: b.title,
          confidence: b.confidence,
          topExcludeReason: b.topExcludeReason ?? null,
        })) ?? null,
      }));
    },

    patientResolutionSessions: async (
      _: unknown,
      args: { patientId: string; status?: string },
      context: DataSourceContext
    ) => {
      return getPatientSessions(context.pool, args.patientId, args.status);
    },
  },

  // Federation reference resolver
  Pathway: {
    __resolveReference: async (
      ref: { id: string },
      context: DataSourceContext
    ) => {
      const { pool } = context;
      const result = await pool.query(
        `SELECT ${PATHWAY_COLUMNS} FROM pathway_graph_index WHERE id = $1`,
        [ref.id]
      );
      return result.rows[0] || null;
    },
  },
};

export function hydrateSignalDefinition(row: any): SignalDefinition {
  const scoringRules = typeof row.scoring_rules === 'string'
    ? JSON.parse(row.scoring_rules)
    : row.scoring_rules;

  return {
    id: row.id,
    name: row.name,
    displayName: row.display_name,
    description: row.description,
    scoringType: row.scoring_type,
    scoringRules,
    propagationConfig: scoringRules.propagation
      ? { ...scoringRules.propagation, mode: normalizePropagationMode(scoringRules.propagation.mode) }
      : { mode: 'none' },
    scope: row.scope,
    institutionId: row.institution_id,
    defaultWeight: parseFloat(row.default_weight),
    isActive: row.is_active,
  };
}
