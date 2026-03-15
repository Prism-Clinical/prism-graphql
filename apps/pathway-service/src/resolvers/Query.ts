import { DataSourceContext } from '../types';

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

      let query = `
        SELECT id, age_node_id AS "ageNodeId", logical_id AS "logicalId",
               title, version, category, status,
               condition_codes AS "conditionCodes",
               scope, target_population AS "targetPopulation",
               is_active AS "isActive",
               created_at AS "createdAt", updated_at AS "updatedAt"
        FROM pathway_graph_index
        WHERE 1=1
      `;
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
      const query = `
        SELECT id, age_node_id AS "ageNodeId", logical_id AS "logicalId",
               title, version, category, status,
               condition_codes AS "conditionCodes",
               scope, target_population AS "targetPopulation",
               is_active AS "isActive",
               created_at AS "createdAt", updated_at AS "updatedAt"
        FROM pathway_graph_index
        WHERE id = $1
      `;
      const result = await pool.query(query, [args.id]);
      return result.rows[0] || null;
    },
  },

  // Federation reference resolver
  Pathway: {
    __resolveReference: async (
      ref: { id: string },
      context: DataSourceContext
    ) => {
      const { pool } = context;
      const query = `
        SELECT id, age_node_id AS "ageNodeId", logical_id AS "logicalId",
               title, version, category, status,
               condition_codes AS "conditionCodes",
               scope, target_population AS "targetPopulation",
               is_active AS "isActive",
               created_at AS "createdAt", updated_at AS "updatedAt"
        FROM pathway_graph_index
        WHERE id = $1
      `;
      const result = await pool.query(query, [ref.id]);
      return result.rows[0] || null;
    },
  },
};
