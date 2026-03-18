import { GraphQLError } from 'graphql';
import { DataSourceContext } from '../types';
import { importPathway } from '../services/import/import-orchestrator';
import { PathwayJson, ImportMode } from '../services/import/types';

const PATHWAY_COLUMNS = `
  id, age_node_id AS "ageNodeId", logical_id AS "logicalId",
  title, version, category, status,
  condition_codes AS "conditionCodes",
  scope, target_population AS "targetPopulation",
  is_active AS "isActive",
  created_at AS "createdAt", updated_at AS "updatedAt"
`;

export const Mutation = {
  Mutation: {
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
  },
};
