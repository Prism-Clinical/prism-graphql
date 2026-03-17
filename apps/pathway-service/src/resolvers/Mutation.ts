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

      const current = await pool.query(
        `SELECT ${PATHWAY_COLUMNS} FROM pathway_graph_index WHERE id = $1`,
        [args.id]
      );
      if (!current.rows[0]) {
        throw new GraphQLError('Pathway not found', { extensions: { code: 'NOT_FOUND' } });
      }

      const pathway = current.rows[0];
      if (pathway.status !== 'DRAFT') {
        throw new GraphQLError(`Cannot activate pathway with status "${pathway.status}". Only DRAFT pathways can be activated.`, {
          extensions: { code: 'BAD_USER_INPUT' },
        });
      }

      // Atomic: supersede existing ACTIVE + activate this one in a single CTE.
      // Prevents race conditions where two concurrent activations could both succeed.
      const updated = await pool.query(
        `WITH superseded AS (
           UPDATE pathway_graph_index SET status = 'SUPERSEDED', is_active = false
           WHERE logical_id = (SELECT logical_id FROM pathway_graph_index WHERE id = $1)
             AND status = 'ACTIVE' AND id != $1
         )
         UPDATE pathway_graph_index SET status = 'ACTIVE', is_active = true
         WHERE id = $1 AND status = 'DRAFT'
         RETURNING ${PATHWAY_COLUMNS}`,
        [args.id]
      );

      if (!updated.rows[0]) {
        throw new GraphQLError('Failed to activate pathway — it may have been modified concurrently.', {
          extensions: { code: 'INTERNAL_SERVER_ERROR' },
        });
      }

      return {
        pathway: updated.rows[0],
        previousStatus: 'DRAFT',
      };
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

      const current = await pool.query(
        `SELECT ${PATHWAY_COLUMNS} FROM pathway_graph_index WHERE id = $1`,
        [args.id]
      );
      if (!current.rows[0]) {
        throw new GraphQLError('Pathway not found', { extensions: { code: 'NOT_FOUND' } });
      }

      const pathway = current.rows[0];
      if (pathway.status !== 'SUPERSEDED' && pathway.status !== 'ARCHIVED') {
        throw new GraphQLError(`Cannot reactivate pathway with status "${pathway.status}". Only SUPERSEDED or ARCHIVED pathways can be reactivated.`, {
          extensions: { code: 'BAD_USER_INPUT' },
        });
      }

      const previousStatus = pathway.status;

      // Atomic: supersede existing ACTIVE + reactivate this one in a single CTE.
      const updated = await pool.query(
        `WITH superseded AS (
           UPDATE pathway_graph_index SET status = 'SUPERSEDED', is_active = false
           WHERE logical_id = (SELECT logical_id FROM pathway_graph_index WHERE id = $1)
             AND status = 'ACTIVE' AND id != $1
         )
         UPDATE pathway_graph_index SET status = 'ACTIVE', is_active = true
         WHERE id = $1 AND status IN ('SUPERSEDED', 'ARCHIVED')
         RETURNING ${PATHWAY_COLUMNS}`,
        [args.id]
      );

      if (!updated.rows[0]) {
        throw new GraphQLError('Failed to reactivate pathway — it may have been modified concurrently.', {
          extensions: { code: 'INTERNAL_SERVER_ERROR' },
        });
      }

      return {
        pathway: updated.rows[0],
        previousStatus,
      };
    },
  },
};
