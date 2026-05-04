import { Pool, PoolClient } from 'pg';
import { PathwayJson, ImportMode, ImportResult, ImportDiffSummary, DiffDetail } from './types';
import { validatePathwayJson } from './validator';
import { buildGraphCommands, buildBatchedGraphCommands } from './graph-builder';
import { buildCypherQuery } from '../age-client';
import { computeDiff } from './diff-engine';
import {
  writePathwayIndex,
  writeConditionCodes,
  writeCodeSets,
  writeVersionDiff,
  deleteConditionCodes,
  deleteCodeSets,
  updatePathwayIndex,
} from './relational-writer';
import { ensureIcd10Codes } from '../codes/icd10-hierarchy';

/** Parse AGE agtype values which may have ::vertex or ::edge suffix */
function parseAgtype(val: unknown): any {
  if (!val) return null;
  const str = typeof val === 'string' ? val : String(val);
  const cleaned = str.replace(/::(?:vertex|edge)$/, '');
  return JSON.parse(cleaned);
}

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
  // Step 1: Validate (draft mode is lenient on missing properties)
  const validation = validatePathwayJson(pathwayJson, { draftMode: importMode === 'DRAFT_UPDATE' });
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

    // Step 4: For DRAFT_UPDATE, reconstruct old JSON for diffing, then delete old graph
    let oldPathwayJson: PathwayJson | null = null;
    if (importMode === 'DRAFT_UPDATE' && existing) {
      oldPathwayJson = await reconstructPathwayJson(client, existing.id);
      await deleteGraphSubtree(client, existing.id);
    }

    // Step 5: Build and execute graph commands (always creates fresh graph)
    //
    // Uses batched Cypher: nodes are comma-separated CREATEs (50/query),
    // edges are UNWIND per type (200/query). This reduces ~3000 individual
    // round-trips to ~25 for a typical large pathway.
    const batched = buildBatchedGraphCommands(pathwayJson);
    let rootAgeNodeId: string | null = null;

    // 5a. Create root node (need its AGE id for relational linkage)
    const rootSql = buildCypherQuery(undefined, batched.rootCypher, '(v agtype)');
    const rootResult = await client.query(rootSql);
    if (rootResult.rows[0]) {
      try {
        const parsed = parseAgtype(rootResult.rows[0].v);
        rootAgeNodeId = String(parsed.id);
      } catch (err) {
        console.warn('Failed to parse AGE root node ID — graph↔relational linkage will be null:', err);
      }
    }

    // 5b. Batch-create all other nodes
    for (const cypher of batched.nodeCyphers) {
      const sql = buildCypherQuery(undefined, cypher, '(v agtype)');
      await client.query(sql);
    }

    // 5c. Create root-originated edges individually (label+id+version-scoped MATCH).
    for (const cypher of batched.rootEdgeCyphers) {
      const sql = buildCypherQuery(undefined, cypher, '(v agtype)');
      await client.query(sql);
    }

    // 5d. Batch-create non-root edges via UNWIND (grouped by type)
    for (const cypher of batched.edgeCyphers) {
      const sql = buildCypherQuery(undefined, cypher, '(v agtype)');
      await client.query(sql);
    }

    // 5e. Create edges with properties individually (rare)
    for (const cypher of batched.edgeWithPropsCyphers) {
      const sql = buildCypherQuery(undefined, cypher, '(a agtype, b agtype)');
      await client.query(sql);
    }


    // Step 6: Write relational tables + compute diffs
    let pathwayId: string;
    let diffResult: { summary: ImportDiffSummary; details: DiffDetail[]; synthetic: boolean } | null = null;

    if (importMode === 'DRAFT_UPDATE' && existing) {
      // Update existing index row, replace condition codes + code sets
      await deleteConditionCodes(client, existing.id);
      await deleteCodeSets(client, existing.id);
      const updated = await updatePathwayIndex(client, existing.id, pathwayJson.pathway, rootAgeNodeId);
      pathwayId = updated.id;
      await ensureIcd10Codes(client, pathwayJson.pathway.condition_codes);
      // Phase 1b transition: dual-write to old (read-path) + new (write-path) tables.
      // Commit 3 cuts over the read path; commit 4 drops the old table + writer.
      await writeConditionCodes(client, pathwayId, pathwayJson.pathway.condition_codes);
      await writeCodeSets(client, pathwayId, pathwayJson.pathway);

      if (oldPathwayJson) {
        // Real diff from reconstructed old graph
        const diff = computeDiff(oldPathwayJson, pathwayJson);
        diffResult = { ...diff, synthetic: false };
      } else {
        // Reconstruction failed — record synthetic empty diff
        diffResult = {
          summary: { nodesAdded: 0, nodesRemoved: 0, nodesModified: 0, edgesAdded: 0, edgesRemoved: 0, edgesModified: 0 },
          details: [],
          synthetic: true,
        };
      }
    } else {
      // NEW_PATHWAY or NEW_VERSION — insert new rows
      const indexRow = await writePathwayIndex(client, pathwayJson.pathway, rootAgeNodeId, userId);
      pathwayId = indexRow.id;
      await ensureIcd10Codes(client, pathwayJson.pathway.condition_codes);
      // Phase 1b transition: dual-write to old (read-path) + new (write-path) tables.
      // Commit 3 cuts over the read path; commit 4 drops the old table + writer.
      await writeConditionCodes(client, pathwayId, pathwayJson.pathway.condition_codes);
      await writeCodeSets(client, pathwayId, pathwayJson.pathway);

      if (importMode === 'NEW_PATHWAY') {
        // No diff for brand new pathways — record the creation summary (synthetic)
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
          synthetic: true,
        };
      } else {
        // NEW_VERSION — diff against previous version if available
        const previousJson = latestExistingByLogicalId
          ? await reconstructPathwayJson(client, latestExistingByLogicalId.id)
          : null;

        if (previousJson) {
          const diff = computeDiff(previousJson, pathwayJson);
          diffResult = { ...diff, synthetic: false };
        } else {
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
            synthetic: true,
          };
        }
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

/**
 * Delete all graph nodes and edges belonging to a pathway.
 *
 * Uses an iterative BFS (single-hop per round) to collect all reachable AGE
 * node IDs from the root, then bulk-deletes them with DETACH DELETE.
 *
 * This avoids variable-length path patterns (`*1..`) which cause combinatorial
 * path expansion on dense graphs — e.g. 2500 edges can produce millions of
 * paths and hang for minutes, while BFS with ~5 rounds completes in seconds.
 */
async function deleteGraphSubtree(
  client: PoolClient,
  pathwayId: string
): Promise<void> {
  // Get the AGE node ID for this pathway's root
  const indexRow = await client.query(
    'SELECT age_node_id FROM pathway_graph_index WHERE id = $1',
    [pathwayId]
  );
  const ageNodeId = indexRow.rows[0]?.age_node_id;
  if (!ageNodeId) return; // No graph to delete

  // Step 1: BFS — collect all reachable node IDs via single-hop traversals.
  const allNodeIds = new Set<string>();
  let frontier = [ageNodeId];

  while (frontier.length > 0) {
    const idList = frontier.join(', ');
    const cypher =
      `MATCH (a)-[]->(b) WHERE id(a) IN [${idList}] RETURN DISTINCT id(b)`;
    const sql = buildCypherQuery(undefined, cypher, '(bid agtype)');
    const result = await client.query(sql);

    frontier = [];
    for (const row of result.rows) {
      const bid = String(parseAgtype(row.bid));
      if (!allNodeIds.has(bid)) {
        allNodeIds.add(bid);
        frontier.push(bid);
      }
    }
  }

  // Step 2: Bulk-delete all descendant nodes (DETACH DELETE removes their edges too).
  if (allNodeIds.size > 0) {
    const idList = [...allNodeIds].join(', ');
    const cypher = `MATCH (n) WHERE id(n) IN [${idList}] DETACH DELETE n RETURN 1`;
    const sql = buildCypherQuery(undefined, cypher, '(v agtype)');
    await client.query(sql);
  }

  // Step 3: Delete the root Pathway node itself.
  const deleteRootCypher = `MATCH (p:Pathway) WHERE id(p) = ${ageNodeId} DETACH DELETE p RETURN 1`;
  const rootSql = buildCypherQuery(undefined, deleteRootCypher, '(v agtype)');
  await client.query(rootSql);
}

/**
 * Reconstruct a PathwayJson from the AGE graph and relational tables for a given pathway.
 * Used for computing diffs during DRAFT_UPDATE and NEW_VERSION imports.
 * Returns null if reconstruction fails (e.g., no graph data found).
 */
async function reconstructPathwayJson(
  client: PoolClient,
  pathwayId: string
): Promise<PathwayJson | null> {
  try {
    // Get relational metadata
    const indexRow = await client.query(
      'SELECT * FROM pathway_graph_index WHERE id = $1',
      [pathwayId]
    );
    if (!indexRow.rows[0]) return null;
    const meta = indexRow.rows[0];

    // Get condition codes
    const ccRows = await client.query(
      'SELECT code, system, description, usage, grouping FROM pathway_condition_codes WHERE pathway_id = $1',
      [pathwayId]
    );

    if (!meta.age_node_id) return null;

    // BFS to collect all reachable AGE node IDs from the root
    const allAgeIds = new Set<string>([String(meta.age_node_id)]);
    let frontier = [String(meta.age_node_id)];

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

    // Get all nodes by their collected IDs
    const nodesCypher = `MATCH (n) WHERE id(n) IN [${ageIdList}] RETURN n`;
    const nodesSql = buildCypherQuery(undefined, nodesCypher, '(v agtype)');
    const nodesResult = await client.query(nodesSql);

    // Get all edges between collected nodes
    const edgesCypher = `MATCH (a)-[r]->(b) WHERE id(a) IN [${ageIdList}] RETURN a, r, b`;
    const edgesSql = buildCypherQuery(undefined, edgesCypher, '(a agtype, r agtype, b agtype)');
    const edgesResult = await client.query(edgesSql);

    // Parse AGE results into PathwayJson structure
    const nodes: PathwayJson['nodes'] = [];
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

        // Extract node_type and node_id from properties, keep the rest
        const { node_id: _nid, node_type, ...restProps } = props;
        if (node_type) {
          nodes.push({ id: nodeId, type: node_type, properties: restProps });
        }
      } catch {
        // Skip unparseable nodes
      }
    }

    const edges: PathwayJson['edges'] = [];
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
          const edgeProps = r.properties && Object.keys(r.properties).length > 0
            ? r.properties : undefined;
          edges.push({ from: fromId, to: toId, type: edgeType, properties: edgeProps });
        }
      } catch {
        // Skip unparseable edges
      }
    }

    return {
      schema_version: '1.0',
      pathway: {
        logical_id: meta.logical_id,
        title: meta.title,
        version: meta.version,
        category: meta.category,
        scope: meta.scope || undefined,
        target_population: meta.target_population || undefined,
        condition_codes: ccRows.rows.map((r: any) => ({
          code: r.code,
          system: r.system,
          description: r.description || undefined,
          usage: r.usage || undefined,
          grouping: r.grouping || undefined,
        })),
      },
      nodes,
      edges,
    };
  } catch {
    // Reconstruction is best-effort — return null on any failure
    return null;
  }
}
