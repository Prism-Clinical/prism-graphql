/**
 * One-shot AGE cleanup: delete orphan duplicate nodes left behind by an
 * earlier import bug.
 *
 * Background: an earlier version of the import pipeline created nodes
 * without `pathway_logical_id` / `pathway_version` properties. Those
 * orphans are still reachable from current pathway roots (via stranded
 * edges), and they cause `fetchGraphFromAGE` to return a Cartesian
 * product of edges between duplicate endpoints — manifested as Step 1.1
 * rendering 20+ times in the simulate preview.
 *
 * This script walks every pathway in `pathway_graph_index`, BFSes from
 * its `age_node_id` to find every reachable AGE node, groups by the
 * `node_id` property, and for any group with >1 entry:
 *
 *   - Picks the AGE node whose (pathway_logical_id, pathway_version)
 *     match the index row as canonical.
 *   - DETACH-DELETEs every other AGE node in that group. DETACH DELETE
 *     removes incident edges too, which also cleans up the stranded
 *     duplicate edges.
 *
 * The script is idempotent: re-running on a clean graph is a no-op.
 *
 * Run it from the host with:
 *   docker exec -it healthcare-pathway node /app/service/dist/scripts/cleanup-age-orphans.js
 *
 * (Build the service first to populate dist/.)
 */

import { Pool } from 'pg';

const PG_HOST = process.env.PG_HOST ?? 'localhost';
const PG_PORT = Number(process.env.PG_PORT ?? '5432');
const PG_USER = process.env.PG_USER ?? 'postgres';
const PG_PASSWORD = process.env.PG_PASSWORD ?? '';
const PG_DATABASE = process.env.PG_DATABASE ?? 'healthcare_federation';

interface IndexRow {
  id: string;
  logical_id: string;
  version: string;
  age_node_id: string;
}

interface NodeRow {
  aid: string;
  node_id: string | null;
  lid: string | null;
  ver: string | null;
  is_pathway: boolean;
}

async function main() {
  const pool = new Pool({
    host: PG_HOST,
    port: PG_PORT,
    user: PG_USER,
    password: PG_PASSWORD,
    database: PG_DATABASE,
  });

  // Set ag_catalog on every connection so cypher() resolves.
  pool.on('connect', (client) => {
    client.query('SET search_path = ag_catalog, public').catch(() => {
      /* swallow — already set or will be re-set on reconnect */
    });
  });

  const indexRes = await pool.query<IndexRow>(
    `SELECT id, logical_id, version, age_node_id::text AS age_node_id
       FROM pathway_graph_index
       WHERE age_node_id IS NOT NULL
       ORDER BY logical_id, version`,
  );

  console.log(`Scanning ${indexRes.rows.length} pathways for orphan AGE nodes...\n`);

  let totalOrphans = 0;
  let pathwaysAffected = 0;

  for (const row of indexRes.rows) {
    const orphansDeleted = await cleanPathway(pool, row);
    if (orphansDeleted > 0) {
      console.log(
        `  ${row.logical_id} v${row.version}: deleted ${orphansDeleted} orphan AGE node${orphansDeleted === 1 ? '' : 's'}`,
      );
      totalOrphans += orphansDeleted;
      pathwaysAffected += 1;
    }
  }

  console.log(
    `\nDone. ${totalOrphans} orphan${totalOrphans === 1 ? '' : 's'} removed across ${pathwaysAffected} pathway${pathwaysAffected === 1 ? '' : 's'}.`,
  );

  await pool.end();
}

async function cleanPathway(pool: Pool, pathway: IndexRow): Promise<number> {
  const rootId = pathway.age_node_id;
  if (!/^\d+$/.test(rootId)) return 0;

  // BFS from the root following outgoing edges. Single-hop iterations to
  // avoid AGE's variable-length-path explosion.
  const allAgeIds = new Set<string>([rootId]);
  let frontier = [rootId];
  while (frontier.length > 0) {
    const idList = frontier.join(', ');
    const res = await pool.query(
      `SELECT * FROM cypher('clinical_pathways', $$
         MATCH (a)-[]->(b) WHERE id(a) IN [${idList}] RETURN DISTINCT id(b) AS bid
       $$) AS (bid agtype)`,
    );
    frontier = [];
    for (const r of res.rows as Array<{ bid: string }>) {
      const bid = String(JSON.parse(r.bid));
      if (!allAgeIds.has(bid)) {
        allAgeIds.add(bid);
        frontier.push(bid);
      }
    }
  }

  if (allAgeIds.size <= 1) return 0;

  // Fetch every reachable node's identity properties so we can group.
  const idList = [...allAgeIds].join(', ');
  const nodesRes = await pool.query(
    `SELECT * FROM cypher('clinical_pathways', $$
       MATCH (n) WHERE id(n) IN [${idList}]
       RETURN id(n) AS aid,
              n.node_id AS node_id,
              n.pathway_logical_id AS lid,
              n.pathway_version AS ver,
              labels(n)[0] AS lbl
     $$) AS (aid agtype, node_id agtype, lid agtype, ver agtype, lbl agtype)`,
  );

  const byNodeId = new Map<string, NodeRow[]>();
  for (const raw of nodesRes.rows as Array<{
    aid: string;
    node_id: string | null;
    lid: string | null;
    ver: string | null;
    lbl: string | null;
  }>) {
    const aid = String(JSON.parse(raw.aid));
    const nodeId = raw.node_id ? (JSON.parse(raw.node_id) as string | null) : null;
    if (!nodeId || typeof nodeId !== 'string') continue;
    const lid = raw.lid ? (JSON.parse(raw.lid) as string | null) : null;
    const ver = raw.ver ? (JSON.parse(raw.ver) as string | null) : null;
    const lbl = raw.lbl ? (JSON.parse(raw.lbl) as string | null) : null;
    const isPathway = lbl === 'Pathway';

    if (!byNodeId.has(nodeId)) byNodeId.set(nodeId, []);
    byNodeId.get(nodeId)!.push({ aid, node_id: nodeId, lid, ver, is_pathway: isPathway });
  }

  // Identify orphans.
  const orphanAids: string[] = [];
  for (const [nid, entries] of byNodeId) {
    if (entries.length <= 1) continue;

    // Special case: multiple `Pathway` roots reachable. The index row points
    // at one specific AGE id; that's the canonical.
    if (nid === 'root') {
      for (const e of entries) {
        if (e.aid !== rootId) orphanAids.push(e.aid);
      }
      continue;
    }

    // For non-root duplicates, the canonical is the entry whose
    // (pathway_logical_id, pathway_version) match the index row.
    const canonical = entries.find(
      (e) => e.lid === pathway.logical_id && e.ver === pathway.version,
    );
    if (canonical) {
      for (const e of entries) {
        if (e.aid !== canonical.aid) orphanAids.push(e.aid);
      }
      continue;
    }

    // No entry has matching scoping — every duplicate is "stale". Keep the
    // lowest AGE id (oldest) as a coin-flip choice; the rest get deleted.
    // The pathway is in a degraded state regardless and a re-import is the
    // real fix. This branch is just a defensive "don't lose all the data".
    const sorted = [...entries].sort((a, b) => Number(a.aid) - Number(b.aid));
    console.warn(
      `    WARN: no canonical for "${nid}" in ${pathway.logical_id} v${pathway.version}; ` +
        `keeping aid=${sorted[0].aid}, deleting ${sorted.length - 1} others`,
    );
    for (const e of sorted.slice(1)) orphanAids.push(e.aid);
  }

  if (orphanAids.length === 0) return 0;

  const orphanIdList = orphanAids.join(', ');
  await pool.query(
    `SELECT * FROM cypher('clinical_pathways', $$
       MATCH (n) WHERE id(n) IN [${orphanIdList}] DETACH DELETE n RETURN 1
     $$) AS (v agtype)`,
  );

  return orphanAids.length;
}

main().catch((err) => {
  console.error('Cleanup failed:', err);
  process.exit(1);
});
