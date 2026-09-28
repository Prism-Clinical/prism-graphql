import { GraphQLError } from 'graphql';
import { DataSourceContext } from '../../types';
import { PATHWAY_COLUMNS } from '../Query';
import { importPathway } from '../../services/import/import-orchestrator';
import { prewarmPathwayInBackground } from '../../services/medications/prewarm-pathway';
import { PathwayJson, ImportMode } from '../../services/import/types';
import { compilePathway } from '../../services/compiler/compile';
import { loadStoredCompileInput } from '../../services/compiler/stored-input';

/**
 * A status transition that must only put a pathway into service if it can be
 * evaluated (interpreter spec §3.1, §8; Q10). One transaction:
 *   1. lock every version of the logical pathway (id order: two activations of
 *      one pathway serialize and cannot deadlock);
 *   2. read and compile the target as stored NOW, on the locked client;
 *   3. run the status CTE.
 * DRAFT_UPDATE locks its row with the same FOR UPDATE (import-orchestrator
 * `findExistingPathway`), so a draft save and an activation never interleave.
 */
async function transition(
  pool: DataSourceContext['pool'],
  id: string,
  guarded: string[],
  verb: string,
  statusSql: string,
  wrongStatus: (status: string) => string,
): Promise<Record<string, unknown>> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("LOAD 'age'");
    await client.query('SET search_path = ag_catalog, "$user", public');
    const locked = await client.query(
      `SELECT id, status FROM pathway_graph_index
        WHERE logical_id = (SELECT logical_id FROM pathway_graph_index WHERE id = $1)
        ORDER BY id FOR UPDATE`,
      [id],
    );
    const target = locked.rows.find((r: { id: string }) => r.id === id);
    if (target && guarded.includes(target.status)) {
      const input = await loadStoredCompileInput(client, id);
      if (input) {
        const compiled = compilePathway(input);
        if (compiled.ok === false) {
          throw new GraphQLError(
            `Cannot ${verb} pathway: ${compiled.errors.length} problem(s) would stop it from being evaluated. Fix them in the editor and try again.`,
            { extensions: { code: 'BAD_USER_INPUT', compileErrors: compiled.errors } },
          );
        }
      }
    }
    const result = await client.query(statusSql, [id]);
    if (!result.rows[0]) {
      const check = await client.query('SELECT status FROM pathway_graph_index WHERE id = $1', [id]);
      if (!check.rows[0]) throw new GraphQLError('Pathway not found', { extensions: { code: 'NOT_FOUND' } });
      throw new GraphQLError(wrongStatus(check.rows[0].status), { extensions: { code: 'BAD_USER_INPUT' } });
    }
    await client.query('COMMIT');
    return result.rows[0];
  } catch (err) {
    await client.query('ROLLBACK').catch((): void => undefined);
    throw err;
  } finally {
    client.release();
  }
}

const ACTIVATE_SQL = `WITH target AS (
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
       FROM activated, target`;

const REACTIVATE_SQL = `WITH target AS (
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
       FROM reactivated, target`;

export const importMutations = {
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

    // D14: normalise the new graph's medications, without blocking the import.
    prewarmPathwayInBackground(context.pool, result.pathwayId, 'import');

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

  async activatePathway(_parent: unknown, args: { id: string }, context: DataSourceContext) {
    const { pool } = context;
    const row = await transition(pool, args.id, ['DRAFT'], 'activate', ACTIVATE_SQL,
      (s) => `Cannot activate pathway with status "${s}". Only DRAFT pathways can be activated.`);
    // D14: an activated pathway's medications should be normalised before the first session.
    prewarmPathwayInBackground(pool, args.id, 'activate');
    const { previousStatus, ...pathway } = row;
    return { pathway, previousStatus };
  },

  async archivePathway(
    _parent: unknown,
    args: { id: string },
    context: DataSourceContext
  ) {
    const { pool } = context;

    const result = await pool.query(
      `WITH target AS (
         SELECT id, status FROM pathway_graph_index WHERE id = $1
       ),
       archived AS (
         UPDATE pathway_graph_index SET status = 'ARCHIVED', is_active = false
         WHERE id = $1 AND status IN ('ACTIVE', 'DRAFT')
         RETURNING ${PATHWAY_COLUMNS}
       )
       SELECT archived.*, target.status AS "previousStatus"
       FROM archived, target`,
      [args.id]
    );

    if (!result.rows[0]) {
      const check = await pool.query('SELECT status FROM pathway_graph_index WHERE id = $1', [args.id]);
      if (!check.rows[0]) {
        throw new GraphQLError('Pathway not found', { extensions: { code: 'NOT_FOUND' } });
      }
      throw new GraphQLError(`Cannot archive pathway with status "${check.rows[0].status}". Only ACTIVE or DRAFT pathways can be archived.`, {
        extensions: { code: 'BAD_USER_INPUT' },
      });
    }

    const { previousStatus, ...pathway } = result.rows[0];
    return { pathway, previousStatus };
  },

  async reactivatePathway(_parent: unknown, args: { id: string }, context: DataSourceContext) {
    const row = await transition(context.pool, args.id, ['SUPERSEDED', 'ARCHIVED'], 'reactivate', REACTIVATE_SQL,
      (s) => `Cannot reactivate pathway with status "${s}". Only SUPERSEDED or ARCHIVED pathways can be reactivated.`);
    // D14: an archived draft can come straight here without ever having been activated.
    prewarmPathwayInBackground(context.pool, args.id, 'activate');
    const { previousStatus, ...pathway } = row;
    return { pathway, previousStatus };
  },
};
