import { Pool, PoolClient } from 'pg';
import { PathwayJson, ImportMode, ImportResult, ImportDiffSummary, DiffDetail } from './types';
import { validatePathwayJson } from './validator';
import { buildGraphCommands } from './graph-builder';
import { buildCypherQuery } from '../age-client';
import {
  writePathwayIndex,
  writeConditionCodes,
  writeVersionDiff,
  deleteConditionCodes,
  updatePathwayIndex,
} from './relational-writer';

/**
 * Import a clinical pathway from JSON.
 *
 * Flow:
 * 1. Validate the JSON (returns all errors at once)
 * 2. If valid, acquire a PG client and begin transaction
 * 3. Check import mode prerequisites (existing pathway state)
 * 4. Build and execute Cypher commands for AGE graph
 * 5. Write relational side tables
 * 6. Compute diff (for DRAFT_UPDATE and NEW_VERSION)
 * 7. Commit transaction
 *
 * Any failure after BEGIN triggers ROLLBACK.
 */
export async function importPathway(
  pool: Pool,
  pathwayJson: PathwayJson,
  importMode: ImportMode,
  userId: string
): Promise<ImportResult> {
  // Step 1: Validate
  const validation = validatePathwayJson(pathwayJson);
  if (!validation.valid) {
    return {
      pathwayId: '',
      ageNodeId: null,
      logicalId: pathwayJson.pathway?.logical_id || '',
      version: pathwayJson.pathway?.version || '',
      status: '',
      validation,
      diff: null,
      importType: importMode,
    };
  }

  // Step 2: Acquire client + begin transaction
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Ensure AGE is loaded on this connection
    await client.query("LOAD 'age'");
    await client.query('SET search_path = ag_catalog, "$user", public');

    // Step 3: Check import mode prerequisites
    const existing = await findExistingPathway(client, pathwayJson.pathway.logical_id, pathwayJson.pathway.version);

    if (importMode === 'DRAFT_UPDATE') {
      if (!existing || existing.status !== 'DRAFT') {
        await client.query('ROLLBACK');
        return {
          pathwayId: '',
          ageNodeId: null,
          logicalId: pathwayJson.pathway.logical_id,
          version: pathwayJson.pathway.version,
          status: '',
          validation: {
            valid: false,
            errors: [`DRAFT_UPDATE requires an existing DRAFT pathway with logical_id "${pathwayJson.pathway.logical_id}" version "${pathwayJson.pathway.version}", but none was found`],
            warnings: [],
          },
          diff: null,
          importType: importMode,
        };
      }
    }

    if (importMode === 'NEW_PATHWAY' && existing) {
      await client.query('ROLLBACK');
      return {
        pathwayId: '',
        ageNodeId: null,
        logicalId: pathwayJson.pathway.logical_id,
        version: pathwayJson.pathway.version,
        status: '',
        validation: {
          valid: false,
          errors: [`NEW_PATHWAY but pathway with logical_id "${pathwayJson.pathway.logical_id}" version "${pathwayJson.pathway.version}" already exists`],
          warnings: [],
        },
        diff: null,
        importType: importMode,
      };
    }

    // Cache the latest existing pathway for this logical_id (used for NEW_VERSION prerequisite
    // check AND for previousId in the diff audit — avoids a second query that could return
    // the newly-inserted row after our INSERT).
    const latestExistingByLogicalId = await findExistingPathwayByLogicalId(client, pathwayJson.pathway.logical_id);

    if (importMode === 'NEW_VERSION') {
      // For NEW_VERSION, check that the logical_id exists (any version)
      if (!latestExistingByLogicalId) {
        await client.query('ROLLBACK');
        return {
          pathwayId: '',
          ageNodeId: null,
          logicalId: pathwayJson.pathway.logical_id,
          version: pathwayJson.pathway.version,
          status: '',
          validation: {
            valid: false,
            errors: [`NEW_VERSION requires an existing pathway with logical_id "${pathwayJson.pathway.logical_id}", but none was found`],
            warnings: [],
          },
          diff: null,
          importType: importMode,
        };
      }
      // Check this specific version doesn't already exist
      if (existing) {
        await client.query('ROLLBACK');
        return {
          pathwayId: '',
          ageNodeId: null,
          logicalId: pathwayJson.pathway.logical_id,
          version: pathwayJson.pathway.version,
          status: '',
          validation: {
            valid: false,
            errors: [`Version "${pathwayJson.pathway.version}" already exists for logical_id "${pathwayJson.pathway.logical_id}"`],
            warnings: [],
          },
          diff: null,
          importType: importMode,
        };
      }
    }

    // Step 4: Build and execute graph commands
    const commands = buildGraphCommands(pathwayJson);
    let rootAgeNodeId: string | null = null;

    for (const cmd of commands) {
      const sql = buildCypherQuery(undefined, cmd.cypher, cmd.type === 'edge' ? '(a agtype, b agtype)' : '(v agtype)');
      const result = await client.query(sql);
      // Capture root node's AGE id
      if (cmd.nodeId === 'root' && result.rows[0]) {
        try {
          const parsed = JSON.parse(result.rows[0].v);
          rootAgeNodeId = String(parsed.id);
        } catch {
          // AGE may return different formats — not critical
        }
      }
    }

    // Step 5: Write relational tables
    let pathwayId: string;
    let diffResult: { summary: ImportDiffSummary; details: DiffDetail[] } | null = null;

    if (importMode === 'DRAFT_UPDATE' && existing) {
      // Update existing index row, replace condition codes
      await deleteConditionCodes(client, existing.id);
      const updated = await updatePathwayIndex(client, existing.id, pathwayJson.pathway, rootAgeNodeId);
      pathwayId = updated.id;
      await writeConditionCodes(client, pathwayId, pathwayJson.pathway.condition_codes);

      // TODO: Reconstruct old pathway JSON from AGE graph and call computeDiff()
      // for proper DRAFT_UPDATE auditing. For now, record an empty diff — the import
      // itself is still correct, but the audit trail lacks granular change detail.
      diffResult = {
        summary: { nodesAdded: 0, nodesRemoved: 0, nodesModified: 0, edgesAdded: 0, edgesRemoved: 0, edgesModified: 0 },
        details: [],
      };
    } else {
      // NEW_PATHWAY or NEW_VERSION — insert new rows
      const indexRow = await writePathwayIndex(client, pathwayJson.pathway, rootAgeNodeId, userId);
      pathwayId = indexRow.id;
      await writeConditionCodes(client, pathwayId, pathwayJson.pathway.condition_codes);

      if (importMode === 'NEW_PATHWAY') {
        // No diff for brand new pathways — record the creation summary
        diffResult = {
          summary: {
            nodesAdded: pathwayJson.nodes.length + 1, // +1 for root
            nodesRemoved: 0,
            nodesModified: 0,
            edgesAdded: pathwayJson.edges.length,
            edgesRemoved: 0,
            edgesModified: 0,
          },
          details: [],
        };
      } else {
        // NEW_VERSION — would diff against the previous active version's JSON
        diffResult = {
          summary: {
            nodesAdded: pathwayJson.nodes.length + 1,
            nodesRemoved: 0,
            nodesModified: 0,
            edgesAdded: pathwayJson.edges.length,
            edgesRemoved: 0,
            edgesModified: 0,
          },
          details: [],
        };
      }
    }

    // Step 6: Write version diff audit record
    // Use the cached latestExistingByLogicalId (queried BEFORE our INSERT) to avoid
    // returning the newly-inserted row as the "previous" version.
    const previousId = importMode === 'NEW_VERSION'
      ? latestExistingByLogicalId?.id || null
      : null;

    await writeVersionDiff(
      client,
      pathwayId,
      previousId,
      importMode,
      diffResult.summary,
      diffResult.details,
      userId
    );

    // Step 7: Commit
    await client.query('COMMIT');

    return {
      pathwayId,
      ageNodeId: rootAgeNodeId,
      logicalId: pathwayJson.pathway.logical_id,
      version: pathwayJson.pathway.version,
      status: 'DRAFT',
      validation,
      diff: diffResult,
      importType: importMode,
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────

async function findExistingPathway(
  client: PoolClient,
  logicalId: string,
  version: string
): Promise<{ id: string; status: string } | null> {
  const result = await client.query(
    'SELECT id, status FROM pathway_graph_index WHERE logical_id = $1 AND version = $2',
    [logicalId, version]
  );
  return result.rows[0] || null;
}

async function findExistingPathwayByLogicalId(
  client: PoolClient,
  logicalId: string
): Promise<{ id: string; status: string } | null> {
  const result = await client.query(
    'SELECT id, status FROM pathway_graph_index WHERE logical_id = $1 ORDER BY created_at DESC LIMIT 1',
    [logicalId]
  );
  return result.rows[0] || null;
}
