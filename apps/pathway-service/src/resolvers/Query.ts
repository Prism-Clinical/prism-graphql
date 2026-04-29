import { Pool } from 'pg';
import { DataSourceContext } from '../types';
import { WeightCascadeResolver } from '../services/confidence/weight-cascade-resolver';
import { SignalDefinition, ResolvedWeight, normalizePropagationMode, GraphNode, GraphEdge, PatientContext, AdminEvidenceEntry } from '../services/confidence/types';
import { ConfidenceEngine } from '../services/confidence/confidence-engine';
import { ScorerRegistry } from '../services/confidence/scorer-registry';
import { DataCompletenessScorer } from '../services/confidence/scorers/data-completeness';
import { EvidenceStrengthScorer } from '../services/confidence/scorers/evidence-strength';
import { PatientMatchQualityScorer } from '../services/confidence/scorers/patient-match-quality';
import { RiskMagnitudeScorer } from '../services/confidence/scorers/risk-magnitude';
import { CustomRulesScorer } from '../services/confidence/scorers/custom-rules';
import { buildCypherQuery } from '../services/age-client';

const sharedCascadeResolver = new WeightCascadeResolver();

/** Parse AGE agtype values which may have ::vertex or ::edge suffix */
function parseAgtype(val: unknown): any {
  if (!val) return null;
  const str = typeof val === 'string' ? val : String(val);
  const cleaned = str.replace(/::(?:vertex|edge)$/, '');
  return JSON.parse(cleaned);
}

/**
 * Load nodes and edges from AGE graph for a pathway.
 *
 * Uses iterative BFS (single-hop per round) to collect all reachable AGE node
 * IDs from the root, then fetches nodes and edges by ID list. This avoids
 * variable-length path patterns (`*1..`) which cause combinatorial explosion
 * on dense graphs.
 */
async function loadGraphFromAGE(pool: Pool, pathwayId: string): Promise<{
  nodes: Array<{ id: string; ageId: string; type: string; properties: Record<string, unknown> }>;
  edges: Array<{ ageId: string; from: string; to: string; type: string; properties: Record<string, unknown> }>;
} | null> {
  const indexResult = await pool.query(
    'SELECT age_node_id FROM pathway_graph_index WHERE id = $1',
    [pathwayId]
  );
  const ageNodeId = indexResult.rows[0]?.age_node_id;
  if (!ageNodeId) return null;

  const nodes: Array<{ id: string; ageId: string; type: string; properties: Record<string, unknown> }> = [];
  const edges: Array<{ ageId: string; from: string; to: string; type: string; properties: Record<string, unknown> }> = [];

  const client = await pool.connect();
  try {
    await client.query("LOAD 'age'");
    await client.query('SET search_path = ag_catalog, "$user", public');

    // BFS: collect all reachable AGE node IDs from the root
    const rootId = String(ageNodeId);
    const allAgeIds = new Set<string>([rootId]);
    let frontier = [rootId];

    while (frontier.length > 0) {
      const idList = frontier.join(', ');
      const bfsCypher = `MATCH (a)-[]->(b) WHERE id(a) IN [${idList}] RETURN DISTINCT id(b)`;
      const bfsSql = buildCypherQuery(undefined, bfsCypher, '(bid agtype)');
      const bfsResult = await client.query(bfsSql);

      frontier = [];
      for (const row of bfsResult.rows) {
        const bid = String(parseAgtype(row.bid));
        if (!allAgeIds.has(bid)) {
          allAgeIds.add(bid);
          frontier.push(bid);
        }
      }
    }

    const ageIdList = [...allAgeIds].join(', ');

    // Fetch all nodes by collected IDs
    const nodesCypher = `MATCH (n) WHERE id(n) IN [${ageIdList}] RETURN n`;
    const nodesSql = buildCypherQuery(undefined, nodesCypher, '(v agtype)');
    const nodesResult = await client.query(nodesSql);

    const seenNodeIds = new Set<string>();
    for (const row of nodesResult.rows) {
      if (!row.v) continue;
      try {
        const node = parseAgtype(row.v);
        if (!node || !node.properties) continue;
        const props = node.properties;
        const nodeId = props.node_id;
        if (!nodeId || seenNodeIds.has(nodeId)) continue;
        seenNodeIds.add(nodeId);
        const { node_id: _nid, node_type, ...restProps } = props;
        if (node_type) {
          nodes.push({ id: nodeId, ageId: String(node.id), type: node_type, properties: restProps });
        }
      } catch {
        // Skip unparseable nodes
      }
    }

    // Fetch all edges between collected nodes
    const edgesCypher = `MATCH (a)-[r]->(b) WHERE id(a) IN [${ageIdList}] RETURN a, r, b`;
    const edgesSql = buildCypherQuery(undefined, edgesCypher, '(a agtype, r agtype, b agtype)');
    const edgesResult = await client.query(edgesSql);

    for (const row of edgesResult.rows) {
      if (!row.a || !row.r || !row.b) continue;
      try {
        const a = parseAgtype(row.a);
        const r = parseAgtype(row.r);
        const b = parseAgtype(row.b);
        const fromId = a.label === 'Pathway' ? 'root' : a.properties?.node_id;
        const toId = b.properties?.node_id;
        const edgeType = r.label;
        if (fromId && toId && edgeType) {
          edges.push({
            ageId: String(r.id),
            from: fromId,
            to: toId,
            type: edgeType,
            properties: r.properties && Object.keys(r.properties).length > 0 ? r.properties : {},
          });
        }
      } catch {
        // Skip unparseable edges
      }
    }
  } finally {
    client.release();
  }

  return { nodes, edges };
}

const PATHWAY_COLUMNS = `
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

      const ccResult = await pool.query(
        'SELECT code, system, description, usage, grouping FROM pathway_condition_codes WHERE pathway_id = $1',
        [args.id]
      );

      const graph = await loadGraphFromAGE(pool, args.id);
      const nodes = graph?.nodes.map(n => ({ id: n.id, type: n.type, properties: n.properties })) ?? [];
      const edges = graph?.edges.map(e => ({
        from: e.from, to: e.to, type: e.type,
        properties: Object.keys(e.properties).length > 0 ? e.properties : undefined,
      })) ?? [];

      return {
        pathway,
        nodes,
        edges,
        conditionCodeDetails: ccResult.rows,
      };
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

      // 1. Load signal definitions
      const signalResult = await pool.query(
        `SELECT id, name, display_name, description, scoring_type, scoring_rules,
                scope, institution_id, default_weight, is_active
         FROM confidence_signal_definitions WHERE is_active = true ORDER BY name ASC`
      );
      const signalDefinitions = signalResult.rows.map(hydrateSignalDefinition);

      // 2. Load graph from AGE
      const graph = await loadGraphFromAGE(pool, args.pathwayId);
      if (!graph || graph.nodes.length === 0) {
        return { pathwayId: args.pathwayId, overallConfidence: 0, nodes: [] };
      }

      // 3. Map to ConfidenceEngine types
      const graphNodes: GraphNode[] = graph.nodes.map(n => ({
        id: n.ageId,
        nodeIdentifier: n.id,
        nodeType: n.type,
        properties: n.properties,
      }));

      const graphEdges: GraphEdge[] = graph.edges
        .filter(e => e.from !== 'root') // skip root edges
        .map(e => ({
          id: e.ageId,
          edgeType: e.type,
          sourceId: e.from,
          targetId: e.to,
          properties: e.properties,
        }));

      // 4. Build scorer registry
      const registry = new ScorerRegistry();
      registry.register(new DataCompletenessScorer());
      registry.register(new EvidenceStrengthScorer());
      registry.register(new PatientMatchQualityScorer());
      registry.register(new RiskMagnitudeScorer());
      registry.register(new CustomRulesScorer());

      // 5. Map patient context
      const patientContext: PatientContext = {
        patientId: args.patientContext.patientId,
        conditionCodes: args.patientContext.conditionCodes ?? [],
        medications: args.patientContext.medications ?? [],
        labResults: args.patientContext.labResults ?? [],
        allergies: args.patientContext.allergies ?? [],
        vitalSigns: args.patientContext.vitalSigns,
      };

      // 6. Load admin evidence entries
      const adminEvResult = await pool.query(
        'SELECT * FROM confidence_admin_evidence WHERE pathway_id = $1',
        [args.pathwayId]
      );
      const adminEvidenceEntries: AdminEvidenceEntry[] = adminEvResult.rows.map((row: any) => ({
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
      }));

      // 7. Compute confidence
      const cascadeResolver = new WeightCascadeResolver();
      const engine = new ConfidenceEngine(registry, cascadeResolver);

      return engine.computePathwayConfidence({
        pool,
        pathwayId: args.pathwayId,
        nodes: graphNodes,
        edges: graphEdges,
        signalDefinitions,
        patientContext,
        institutionId: args.institutionId,
        organizationId: args.organizationId,
        adminEvidenceEntries,
      });
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
