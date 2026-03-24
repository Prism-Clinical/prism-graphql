import { Pool, QueryResult } from 'pg';
import { randomBytes } from 'crypto';

const DEFAULT_GRAPH = 'clinical_pathways';

// Allowlist of valid graph names — prevents SQL injection via graphName parameter.
// Add new graph names here if additional AGE graphs are created.
const VALID_GRAPHS = new Set(['clinical_pathways']);

// returnType must match the pattern: (column_name agtype, ...) — reject anything else.
const RETURN_TYPE_PATTERN = /^\([a-zA-Z_][a-zA-Z0-9_]*\s+agtype(?:,\s*[a-zA-Z_][a-zA-Z0-9_]*\s+agtype)*\)$/;

/**
 * Build a SQL string that wraps a Cypher query for execution via the pg driver.
 * AGE Cypher is called through: SELECT * FROM cypher('graph', $tag$ ... $tag$) AS (columns)
 *
 * SECURITY: graphName is validated against an allowlist. returnType is validated
 * against a strict format pattern. The Cypher string is wrapped in a uniquely-tagged
 * dollar-quoted block ($cypher_<random>$) to prevent injection via $$ sequences in
 * property values.
 */
export function buildCypherQuery(
  graphName: string | undefined,
  cypher: string,
  returnType: string
): string {
  const graph = graphName ?? DEFAULT_GRAPH;

  if (!VALID_GRAPHS.has(graph)) {
    throw new Error(`Invalid graph name: "${graph}". Must be one of: ${[...VALID_GRAPHS].join(', ')}`);
  }

  if (!RETURN_TYPE_PATTERN.test(returnType)) {
    throw new Error(`Invalid returnType format: "${returnType}". Must match pattern: (col agtype, ...)`);
  }

  // Use a unique tagged dollar-quote to prevent content from escaping the block.
  // PostgreSQL dollar quoting: $tag$content$tag$ — content cannot break out unless
  // it contains the exact same $tag$ string, which is cryptographically unlikely.
  const tag = `$cypher_${randomBytes(4).toString('hex')}$`;

  return `SELECT * FROM cypher('${graph}', ${tag} ${cypher} ${tag}) AS ${returnType}`;
}

/**
 * Execute a Cypher query against the AGE graph via the pg pool.
 * Requires that the connection has ag_catalog in search_path (set by database.ts pool.on('connect')).
 *
 * IMPORTANT: Never interpolate user input into the cypher string. Use Cypher parameters instead:
 *   executeCypher(pool, "MATCH (p:Pathway {id: 'known-id'}) RETURN p", "(v agtype)")
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
