import { GraphQLError } from 'graphql';
import { DataSourceContext } from '../types';
import { ConfidenceEngine } from '../services/confidence/confidence-engine';
import { SignalDefinition, ResolvedWeight, normalizePropagationMode, PatientContext, AdminEvidenceEntry } from '../services/confidence/types';
import {
  getSession,
  getMatchedPathways,
  getPatientSessions,
} from '../services/resolution/session-store';
import { ResolutionSession, NodeResult, NodeStatus, MatchedPathway } from '../services/resolution/types';
import { fetchGraphFromAGE, buildGraphContext, sharedScorerRegistry, sharedCascadeResolver } from './helpers/resolution-context';
import { createPatientContextLoader } from '../services/resolution/snapshot-context';
import { computePathwayReachability } from '../services/resolution/reachability-loader';
import { multiPathwayResolutionQueries } from './mutations/multi-pathway-resolution';

// Internal parent type for MatchedPathway field resolvers. Carries a per-request
// memoized patient-context loader so MatchedPathway.reachability can compute
// against snapshot data without reloading per-row.
type MatchedPathwayParent = MatchedPathway & {
  __ctx: {
    patientId: string;
    loadPatientContext: () => Promise<import('../services/confidence/types').PatientContext>;
  };
};

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

    pathwayGraph: async (
      _: unknown,
      args: { id: string },
      context: DataSourceContext
    ) => {
      const { pool } = context;

      const indexResult = await pool.query(
        `SELECT ${PATHWAY_COLUMNS} FROM pathway_graph_index WHERE id = $1`,
        [args.id]
      );
      const pathway = indexResult.rows[0];
      if (!pathway) return null;

      // Phase 1b: condition codes are stored as code-set members. Flatten
      // member rows into the legacy ConditionCodeDetail shape (one row per
      // (set, member) pair). description = set-level; usage = per-member;
      // grouping is no longer captured (always null).
      const ccResult = await pool.query(
        `SELECT m.code, m.system, cs.description, m.description AS usage, NULL AS grouping
           FROM pathway_code_set_members m
           JOIN pathway_code_sets cs ON cs.id = m.code_set_id
          WHERE cs.pathway_id = $1
          ORDER BY cs.id, m.code`,
        [args.id]
      );

      let nodes: Array<{ id: string; type: string; properties: Record<string, unknown> }> = [];
      let edges: Array<{ from: string; to: string; type: string; properties?: Record<string, unknown> }> = [];

      if (pathway.ageNodeId) {
        const graph = await fetchGraphFromAGE(pool, String(pathway.ageNodeId));
        nodes = graph.nodes.map(n => ({ id: n.nodeIdentifier, type: n.nodeType, properties: n.properties }));
        edges = graph.edges.map(e => ({
          from: e.sourceId, to: e.targetId, type: e.edgeType,
          properties: Object.keys(e.properties ?? {}).length > 0 ? e.properties : undefined,
        }));
      }

      return {
        pathway,
        nodes,
        edges,
        conditionCodeDetails: ccResult.rows,
      };
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

      // Also return pathway-level signal weight overrides directly.
      // The cascade resolver only iterates over nodes from confidence_node_weights,
      // so pathway-level overrides (node_identifier IS NULL) are never surfaced
      // when that table is empty. Query them directly here.
      const pathwayOverrides = await pool.query(
        `SELECT csw.signal_definition_id, csd.name AS signal_name, csw.weight
         FROM confidence_signal_weights csw
         JOIN confidence_signal_definitions csd ON csd.id = csw.signal_definition_id
         WHERE csw.pathway_id = $1 AND csw.scope = 'PATHWAY' AND csw.node_identifier IS NULL`,
        [args.pathwayId]
      );
      for (const row of pathwayOverrides.rows) {
        entries.push({
          nodeIdentifier: '__pathway__',
          signalName: row.signal_name,
          weight: parseFloat(row.weight),
          source: 'PATHWAY_OVERRIDE',
        });
      }

      return { entries };
    },

    adminEvidenceEntries: async (
      _: unknown,
      args: { pathwayId: string; nodeIdentifier?: string },
      context: DataSourceContext
    ) => {
      const { pool } = context;
      let query = 'SELECT * FROM confidence_admin_evidence WHERE pathway_id = $1';
      const params: unknown[] = [args.pathwayId];

      if (args.nodeIdentifier) {
        query += ' AND node_identifier = $2';
        params.push(args.nodeIdentifier);
      }

      query += ' ORDER BY created_at DESC';
      const result = await pool.query(query, params);

      return result.rows.map((row: any) => ({
        id: row.id,
        pathwayId: row.pathway_id,
        nodeIdentifier: row.node_identifier,
        title: row.title,
        source: row.source,
        year: row.year,
        evidenceLevel: row.evidence_level,
        url: row.url,
        notes: row.notes,
        applicableCriteria: row.applicable_criteria ?? [],
        populationDescription: row.population_description,
        createdBy: row.created_by,
        createdAt: row.created_at?.toISOString?.() ?? row.created_at,
      }));
    },

    searchCodes: async (
      _: unknown,
      args: { query: string; system?: string; limit?: number },
      context: DataSourceContext
    ) => {
      const { pool } = context;
      const limit = Math.min(args.limit ?? 20, 100);
      const searchPattern = `%${args.query}%`;

      let query: string;
      const params: unknown[] = [searchPattern, searchPattern];
      let paramIdx = 3;

      if (args.system) {
        query = `
          SELECT code, system, description, category, is_common AS "isCommon"
          FROM clinical_code_reference
          WHERE (code ILIKE $1 OR description ILIKE $2)
            AND system = $${paramIdx}
          ORDER BY
            (code ILIKE $${paramIdx + 1}) DESC,
            is_common DESC,
            length(code) ASC,
            code ASC
          LIMIT $${paramIdx + 2}
        `;
        const prefixPattern = `${args.query}%`;
        params.push(args.system, prefixPattern, limit);
      } else {
        query = `
          SELECT code, system, description, category, is_common AS "isCommon"
          FROM clinical_code_reference
          WHERE (code ILIKE $1 OR description ILIKE $2)
          ORDER BY
            (code ILIKE $3) DESC,
            is_common DESC,
            length(code) ASC,
            code ASC
          LIMIT $4
        `;
        const prefixPattern = `${args.query}%`;
        params.push(prefixPattern, limit);
      }

      const result = await pool.query(query, params);
      return result.rows;
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
    ): Promise<MatchedPathwayParent[]> => {
      const rows = await getMatchedPathways(context.pool, args.patientId);
      const loadPatientContext = createPatientContextLoader(context.pool, args.patientId);
      return rows.map((row) => ({
        ...row,
        __ctx: { patientId: args.patientId, loadPatientContext },
      }));
    },

    relatedPathways: async (
      _: unknown,
      args: { pathwayId: string },
      context: DataSourceContext,
    ) => {
      const { pool } = context;

      const inputResult = await pool.query(
        `SELECT condition_codes FROM pathway_graph_index WHERE id = $1`,
        [args.pathwayId],
      );
      if (inputResult.rows.length === 0) {
        throw new GraphQLError('Pathway not found', { extensions: { code: 'NOT_FOUND' } });
      }
      const inputCodes: string[] = inputResult.rows[0].condition_codes ?? [];
      if (inputCodes.length === 0) {
        return [];
      }

      // Ontology-aware classification: a candidate code is "in input's territory"
      // if it equals an input code OR (both have ICD-10 paths AND candidate's path
      // is a descendant of an input's path). Subset = every candidate code in
      // input's territory; superset = every input code in candidate's territory.
      // Non-ICD-10 codes participate via flat equality only — they pass through
      // the OR branch and are correctly classified relative to other flat matches.
      //
      // The WHERE clause filters to candidates that have ANY relationship at all
      // (flat overlap OR any ltree path relationship in either direction). The
      // outer subquery wrap lets us reference relationship_type in ORDER BY.
      const result = await pool.query(
        `SELECT * FROM (
           SELECT
             pgi.id, pgi.age_node_id AS "ageNodeId", pgi.logical_id AS "logicalId",
             pgi.title, pgi.version, pgi.category, pgi.status,
             pgi.condition_codes AS "conditionCodes",
             pgi.scope, pgi.target_population AS "targetPopulation",
             pgi.is_active AS "isActive",
             pgi.created_at AS "createdAt", pgi.updated_at AS "updatedAt",
             CASE
               WHEN pgi.condition_codes = $2::text[] THEN 'IDENTICAL'
               WHEN NOT EXISTS (
                 SELECT 1 FROM unnest(pgi.condition_codes) AS uc(code)
                 WHERE NOT (
                   uc.code = ANY($2::text[])
                   OR EXISTS (
                     SELECT 1 FROM unnest($2::text[]) AS ui(code)
                     JOIN icd10_codes ucn ON ucn.code = uc.code
                     JOIN icd10_codes uin ON uin.code = ui.code
                     WHERE ucn.path <@ uin.path
                   )
                 )
               ) THEN 'SUBSET'
               WHEN NOT EXISTS (
                 SELECT 1 FROM unnest($2::text[]) AS ui(code)
                 WHERE NOT (
                   ui.code = ANY(pgi.condition_codes)
                   OR EXISTS (
                     SELECT 1 FROM unnest(pgi.condition_codes) AS uc(code)
                     JOIN icd10_codes ucn ON ucn.code = uc.code
                     JOIN icd10_codes uin ON uin.code = ui.code
                     WHERE uin.path <@ ucn.path
                   )
                 )
               ) THEN 'SUPERSET'
               ELSE 'PARTIAL_OVERLAP'
             END AS relationship_type,
             ARRAY(
               SELECT UNNEST(pgi.condition_codes)
               INTERSECT
               SELECT UNNEST($2::text[])
             ) AS shared_codes,
             ARRAY(
               SELECT UNNEST(pgi.condition_codes)
               EXCEPT
               SELECT UNNEST($2::text[])
             ) AS unique_to_candidate,
             ARRAY(
               SELECT UNNEST($2::text[])
               EXCEPT
               SELECT UNNEST(pgi.condition_codes)
             ) AS unique_to_input
           FROM pathway_graph_index pgi
           WHERE pgi.id != $1
             AND pgi.status = 'ACTIVE'
             AND pgi.is_active = true
             AND (
               pgi.condition_codes && $2::text[]
               OR EXISTS (
                 SELECT 1
                 FROM unnest(pgi.condition_codes) AS uc(code)
                 JOIN unnest($2::text[]) AS ui(code) ON true
                 JOIN icd10_codes ucn ON ucn.code = uc.code
                 JOIN icd10_codes uin ON uin.code = ui.code
                 WHERE ucn.path <@ uin.path OR uin.path <@ ucn.path
               )
             )
         ) results
         ORDER BY
           CASE relationship_type
             WHEN 'IDENTICAL' THEN 0
             WHEN 'SUBSET' THEN 1
             WHEN 'SUPERSET' THEN 2
             ELSE 3
           END,
           title`,
        [args.pathwayId, inputCodes],
      );

      return result.rows.map((row) => ({
        pathway: {
          id: row.id,
          ageNodeId: row.ageNodeId,
          logicalId: row.logicalId,
          title: row.title,
          version: row.version,
          category: row.category,
          status: row.status,
          conditionCodes: row.conditionCodes,
          scope: row.scope,
          targetPopulation: row.targetPopulation,
          isActive: row.isActive,
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
        },
        relationshipType: row.relationship_type,
        sharedCodes: row.shared_codes ?? [],
        uniqueToCandidate: row.unique_to_candidate ?? [],
        uniqueToInput: row.unique_to_input ?? [],
      }));
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

    ...multiPathwayResolutionQueries,
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

  MatchedPathway: {
    reachability: async (
      parent: MatchedPathway,
      _args: unknown,
      context: DataSourceContext,
    ) => {
      const ctx = (parent as MatchedPathwayParent).__ctx;
      if (!ctx) {
        return {
          totalGates: 0,
          alwaysEvaluableGates: 0,
          dataDependentGates: 0,
          dataAvailableGates: 0,
          questionGates: 0,
          indeterminateGates: 0,
          autoResolvableScore: null,
          gateExplanations: [],
        };
      }
      const patient = await ctx.loadPatientContext();
      return computePathwayReachability(context.pool, parent.pathway.id, patient);
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
