import { DataSourceContext } from '../types';
import { WeightCascadeResolver } from '../services/confidence/weight-cascade-resolver';
import { SignalDefinition } from '../services/confidence/types';

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

    effectiveThresholds: async (
      _: unknown,
      args: { pathwayId: string; nodeIdentifier?: string; institutionId?: string; organizationId?: string },
      context: DataSourceContext
    ) => {
      const cascadeResolver = new WeightCascadeResolver();
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
    propagationConfig: scoringRules.propagation ?? { mode: 'none' },
    scope: row.scope,
    institutionId: row.institution_id,
    defaultWeight: parseFloat(row.default_weight),
    isActive: row.is_active,
  };
}
