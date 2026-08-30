import { GraphQLError } from 'graphql';
import { DataSourceContext } from '../../types';
import { PATHWAY_COLUMNS } from '../Query';
import { importPathway } from '../../services/import/import-orchestrator';
import { PathwayJson, ImportMode } from '../../services/import/types';
import { validatePathwayJson } from '../../services/import/validator';
import { normalizeGateDependsOn } from '../../services/import/normalize-gates';
import { pathwayJsonFromStoredGraph } from '../../services/import/stored-graph';
import { fetchGraphFromAGE } from '../helpers/resolution-context';

/**
 * Re-validate a stored pathway graph in STRICT mode.
 *
 * Import is lenient for `DRAFT_UPDATE` on purpose — autosave must not block an
 * author mid-edit — so a draft legitimately accumulates half-finished nodes.
 * Nothing re-checked them on the way out: `activatePathway` was a bare SQL
 * status flip, which is how two edge-less, property-less nodes
 * (`gate-new-1`, `guidance-new-1`) ended up in a published version of
 * vaginitis-in-pregnancy-v1. The admin dashboard does validate before
 * publishing, but that is a client the server cannot assume.
 *
 * Returns the strict validation errors; empty means safe to activate.
 */
async function validateStoredGraph(
  pool: DataSourceContext['pool'],
  pathwayRow: {
    id: string;
    ageNodeId: string | null;
    logicalId: string;
    title: string;
    version: string;
    category: string;
    scope?: string | null;
    targetPopulation?: string | null;
  },
): Promise<string[]> {
  // No graph to check — the pathway is metadata-only. Import already refuses
  // that shape; nothing to add here.
  if (!pathwayRow.ageNodeId) return [];

  const [graph, codes] = await Promise.all([
    fetchGraphFromAGE(pool, String(pathwayRow.ageNodeId)),
    pool.query(
      `SELECT m.code, m.system, cs.description
         FROM pathway_code_set_members m
         JOIN pathway_code_sets cs ON cs.id = m.code_set_id
        WHERE cs.pathway_id = $1
        ORDER BY cs.id, m.code`,
      [pathwayRow.id],
    ),
  ]);

  const pathwayJson = pathwayJsonFromStoredGraph({
    pathway: pathwayRow,
    conditionCodes: codes.rows,
    nodes: graph.nodes.map((n) => ({
      id: n.nodeIdentifier,
      type: n.nodeType,
      properties: n.properties,
    })),
    edges: graph.edges.map((e) => ({
      from: e.sourceId,
      to: e.targetId,
      type: e.edgeType,
      properties: e.properties,
    })),
  });

  // Normalize first for the same reason import does: a legacy `depends_on`
  // string is a storage artifact, not an authoring error, and re-importing
  // would fix it silently. Flagging it here would block activation on
  // something the author never typed.
  return validatePathwayJson(normalizeGateDependsOn(pathwayJson)).errors;
}

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

    // Gate activation on a strict re-validation of the stored graph. Done
    // before the CTE below so a pathway that fails never changes status.
    // Reading here and writing there is not a TOCTOU risk worth locking for:
    // the only writer is the same author's editor, and the failure mode is a
    // stale PASS on a graph edited mid-activation, which the next activation
    // catches.
    const target = await pool.query(
      `SELECT ${PATHWAY_COLUMNS} FROM pathway_graph_index WHERE id = $1`,
      [args.id],
    );
    if (target.rows[0] && target.rows[0].status === 'DRAFT') {
      const errors = await validateStoredGraph(pool, target.rows[0]);
      if (errors.length > 0) {
        throw new GraphQLError(
          `Cannot activate pathway: ${errors.length} validation error(s). ` +
            'Fix them in the editor and try again.',
          { extensions: { code: 'BAD_USER_INPUT', validationErrors: errors } },
        );
      }
    }

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

    const result = await pool.query(
      `WITH target AS (
         SELECT id, status FROM pathway_graph_index WHERE id = $1
       ),
       archived AS (
         UPDATE pathway_graph_index SET status = 'ARCHIVED', is_active = false
         WHERE id = $1 AND status = 'ACTIVE'
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
      throw new GraphQLError(`Cannot archive pathway with status "${check.rows[0].status}". Only ACTIVE pathways can be archived.`, {
        extensions: { code: 'BAD_USER_INPUT' },
      });
    }

    const { previousStatus, ...pathway } = result.rows[0];
    return { pathway, previousStatus };
  },

  async reactivatePathway(
    _parent: unknown,
    args: { id: string },
    context: DataSourceContext
  ) {
    const { pool } = context;

    // Same strict gate as activatePathway — reactivation is the other door
    // into ACTIVE, and an ARCHIVED pathway is exactly the kind that has been
    // sitting around long enough to have drifted from what the engine accepts.
    const target = await pool.query(
      `SELECT ${PATHWAY_COLUMNS} FROM pathway_graph_index WHERE id = $1`,
      [args.id],
    );
    if (target.rows[0] && ['SUPERSEDED', 'ARCHIVED'].includes(target.rows[0].status)) {
      const errors = await validateStoredGraph(pool, target.rows[0]);
      if (errors.length > 0) {
        throw new GraphQLError(
          `Cannot reactivate pathway: ${errors.length} validation error(s). ` +
            'Fix them in the editor and try again.',
          { extensions: { code: 'BAD_USER_INPUT', validationErrors: errors } },
        );
      }
    }

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
};
