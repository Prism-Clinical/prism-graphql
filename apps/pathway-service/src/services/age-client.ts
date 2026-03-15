import { Pool, QueryResult } from 'pg';

const DEFAULT_GRAPH = 'clinical_pathways';

/**
 * Build a SQL string that wraps a Cypher query for execution via the pg driver.
 * AGE Cypher is called through: SELECT * FROM cypher('graph', $$ ... $$) AS (columns)
 */
export function buildCypherQuery(
  graphName: string | undefined,
  cypher: string,
  returnType: string
): string {
  const graph = graphName ?? DEFAULT_GRAPH;
  return `SELECT * FROM cypher('${graph}', $$ ${cypher} $$) AS ${returnType}`;
}

/**
 * Execute a Cypher query against the AGE graph via the pg pool.
 * Requires that the connection has ag_catalog in search_path (set by database.ts pool.on('connect')).
 */
export async function executeCypher(
  pool: Pool,
  cypher: string,
  returnType: string,
  graphName?: string
): Promise<QueryResult> {
  const sql = buildCypherQuery(graphName, cypher, returnType);
  return pool.query(sql);
}
