import { PathwayJson } from './types';

export interface CypherCommand {
  type: 'node' | 'edge';
  cypher: string;
  nodeId?: string; // For nodes: the JSON id (e.g., "stage-1")
}

/**
 * Build Cypher CREATE commands from a validated pathway JSON.
 * Returns an ordered list: root node first, then all nodes, then all edges.
 *
 * The commands use MATCH on (node_id, pathway_logical_id, pathway_version) for
 * edge creation, scoping per-pathway-version so a node_id like "stage-1" in
 * pathway A doesn't collide with the same node_id in pathway B. Nodes must be
 * created before edges in the transaction.
 */
export function buildGraphCommands(pw: PathwayJson): CypherCommand[] {
  const commands: CypherCommand[] = [];
  const meta = pw.pathway;

  // 1. Create root Pathway node
  commands.push({
    type: 'node',
    nodeId: 'root',
    cypher: `CREATE (v:Pathway {node_id: ${esc('root')}, logical_id: ${esc(meta.logical_id)}, title: ${esc(meta.title)}, version: ${esc(meta.version)}, category: ${esc(meta.category)}, scope: ${esc(meta.scope || '')}, target_population: ${esc(meta.target_population || '')}}) RETURN v`,
  });

  // 2. Create all other nodes — stamped with pathway scope so MATCHes can find
  // them per-pathway-version without colliding with same-named nodes in other
  // pathways.
  for (const node of pw.nodes) {
    const props = serializeProperties({
      node_id: node.id,
      node_type: node.type,
      pathway_logical_id: meta.logical_id,
      pathway_version: meta.version,
      ...node.properties,
    });
    commands.push({
      type: 'node',
      nodeId: node.id,
      cypher: `CREATE (v:${node.type} {${props}}) RETURN v`,
    });
  }

  // 3. Create all edges
  for (const edge of pw.edges) {
    const fromMatch = edge.from === 'root'
      ? `MATCH (a:Pathway {node_id: 'root', logical_id: ${esc(meta.logical_id)}, version: ${esc(meta.version)}})`
      : `MATCH (a {node_id: ${esc(edge.from)}, pathway_logical_id: ${esc(meta.logical_id)}, pathway_version: ${esc(meta.version)}})`;

    const toMatch = `MATCH (b {node_id: ${esc(edge.to)}, pathway_logical_id: ${esc(meta.logical_id)}, pathway_version: ${esc(meta.version)}})`;

    const edgeProps = edge.properties
      ? ` {${serializeProperties(edge.properties)}}`
      : '';

    commands.push({
      type: 'edge',
      cypher: `${fromMatch} ${toMatch} CREATE (a)-[:${edge.type}${edgeProps}]->(b) RETURN a, b`,
    });
  }

  return commands;
}

// ─── Batched graph commands ───────────────────────────────────────────

export interface BatchedGraphCommands {
  /** Single Cypher for creating the root Pathway node (result needed for AGE id) */
  rootCypher: string;
  /** Batched node-creation Cyphers (comma-separated CREATE, up to NODE_BATCH_SIZE each) */
  nodeCyphers: string[];
  /** Batched edge-creation Cyphers (UNWIND per non-root edge-type batch) */
  edgeCyphers: string[];
  /** Edges originating at the root node — built individually so the root MATCH can be label+id+version scoped */
  rootEdgeCyphers: string[];
  /** Individual edge Cyphers for edges that carry properties (rare, can't batch via UNWIND) */
  edgeWithPropsCyphers: string[];
}

const NODE_BATCH_SIZE = 50;
const EDGE_BATCH_SIZE = 200;

/**
 * Build batched Cypher commands for efficient graph creation.
 *
 * - Nodes are batched into comma-separated CREATE patterns (50 per query).
 * - Edges from "root" are emitted individually so the Pathway root MATCH can
 *   filter by label + logical_id + version.
 * - Other edges without properties are grouped by type and created via UNWIND
 *   (200 per query); MATCHes are pathway-scoped via property filters.
 * - Edges with properties are created individually.
 *
 * For a pathway with 500 nodes and 2500 edges across 13 edge types, this
 * produces ~10 node queries + ~15 edge queries instead of ~3000 individual ones.
 */
export function buildBatchedGraphCommands(pw: PathwayJson): BatchedGraphCommands {
  const meta = pw.pathway;
  const lidLit = esc(meta.logical_id);
  const verLit = esc(meta.version);

  // ── Root node (individual — we need its AGE id) ──
  const rootCypher = `CREATE (v:Pathway {node_id: ${esc('root')}, logical_id: ${esc(meta.logical_id)}, title: ${esc(meta.title)}, version: ${esc(meta.version)}, category: ${esc(meta.category)}, scope: ${esc(meta.scope || '')}, target_population: ${esc(meta.target_population || '')}}) RETURN v`;

  // ── Batch nodes: comma-separated CREATE ──
  const nodeCyphers: string[] = [];
  for (let i = 0; i < pw.nodes.length; i += NODE_BATCH_SIZE) {
    const batch = pw.nodes.slice(i, i + NODE_BATCH_SIZE);
    const patterns = batch.map((node, idx) => {
      const props = serializeProperties({
        node_id: node.id,
        node_type: node.type,
        pathway_logical_id: meta.logical_id,
        pathway_version: meta.version,
        ...node.properties,
      });
      return `(v${idx}:${node.type} {${props}})`;
    });
    nodeCyphers.push(`CREATE ${patterns.join(', ')} RETURN 1`);
  }

  // ── Group edges: root vs non-root, with vs without properties ──
  const edgesByType = new Map<string, { from: string; to: string }[]>();
  const rootEdgesNoProps: { type: string; to: string }[] = [];
  const edgesWithProps: typeof pw.edges = [];

  for (const edge of pw.edges) {
    const hasProps = edge.properties && Object.keys(edge.properties).length > 0;
    if (hasProps) {
      edgesWithProps.push(edge);
    } else if (edge.from === 'root') {
      rootEdgesNoProps.push({ type: edge.type, to: edge.to });
    } else {
      const list = edgesByType.get(edge.type);
      if (list) list.push({ from: edge.from, to: edge.to });
      else edgesByType.set(edge.type, [{ from: edge.from, to: edge.to }]);
    }
  }

  // ── Root-originated edges: individual Cypher with label+id+version scoping ──
  const rootEdgeCyphers: string[] = [];
  for (const edge of rootEdgesNoProps) {
    rootEdgeCyphers.push(
      `MATCH (a:Pathway {node_id: 'root', logical_id: ${lidLit}, version: ${verLit}}), ` +
      `(b {node_id: ${esc(edge.to)}, pathway_logical_id: ${lidLit}, pathway_version: ${verLit}}) ` +
      `CREATE (a)-[:${edge.type}]->(b) RETURN 1`,
    );
  }

  // ── Non-root edges: UNWIND per (type, batch) with pathway-scoped MATCH ──
  const edgeCyphers: string[] = [];
  for (const [edgeType, edges] of edgesByType) {
    for (let i = 0; i < edges.length; i += EDGE_BATCH_SIZE) {
      const batch = edges.slice(i, i + EDGE_BATCH_SIZE);
      const listItems = batch.map(
        (e) => `{f: ${esc(e.from)}, t: ${esc(e.to)}}`,
      );
      edgeCyphers.push(
        `WITH [${listItems.join(', ')}] AS edges ` +
        `UNWIND edges AS e ` +
        `MATCH (a {node_id: e.f, pathway_logical_id: ${lidLit}, pathway_version: ${verLit}}), ` +
        `(b {node_id: e.t, pathway_logical_id: ${lidLit}, pathway_version: ${verLit}}) ` +
        `CREATE (a)-[:${edgeType}]->(b) RETURN 1`,
      );
    }
  }

  // ── Edges with properties: individual (rare) ──
  const edgeWithPropsCyphers: string[] = [];
  for (const edge of edgesWithProps) {
    const fromMatch = edge.from === 'root'
      ? `MATCH (a:Pathway {node_id: 'root', logical_id: ${lidLit}, version: ${verLit}})`
      : `MATCH (a {node_id: ${esc(edge.from)}, pathway_logical_id: ${lidLit}, pathway_version: ${verLit}})`;
    const toMatch = `MATCH (b {node_id: ${esc(edge.to)}, pathway_logical_id: ${lidLit}, pathway_version: ${verLit}})`;
    const props = ` {${serializeProperties(edge.properties!)}}`;
    edgeWithPropsCyphers.push(
      `${fromMatch} ${toMatch} CREATE (a)-[:${edge.type}${props}]->(b) RETURN a, b`,
    );
  }

  return { rootCypher, nodeCyphers, edgeCyphers, rootEdgeCyphers, edgeWithPropsCyphers };
}


// ─── Helpers ──────────────────────────────────────────────────────────

/**
 * Escape a value for safe inclusion in a Cypher string literal.
 * AGE uses single-quoted strings.
 */
function esc(value: string): string {
  const escaped = value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  return `'${escaped}'`;
}

// Property key allowlist pattern — prevents Cypher injection via property names
const SAFE_KEY_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

/**
 * Serialize a properties object into Cypher property map syntax.
 * Example: {name: 'Oxytocin', dose: '2 milliunits/min'}
 * Returns the contents WITHOUT surrounding braces — caller wraps with {}.
 * Property keys are validated against a safe pattern to prevent injection.
 */
function serializeProperties(props: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null) continue;
    if (!SAFE_KEY_PATTERN.test(key)) {
      throw new Error(`Invalid property key "${key}" — keys must be alphanumeric/underscore identifiers`);
    }
    parts.push(`${key}: ${serializeValue(value)}`);
  }
  return parts.join(', ');
}

/**
 * Serialize a single value as a Cypher literal. Handles primitives, arrays
 * (as Cypher list literals), and nested objects (as Cypher map literals) so
 * structured properties — e.g. a Gate's `condition: { field, operator, ... }` —
 * round-trip as real nested data rather than JSON-encoded strings.
 */
function serializeValue(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'string') return esc(value);
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (Array.isArray(value)) {
    const items = value
      .filter((v) => v !== undefined)
      .map(serializeValue);
    return `[${items.join(', ')}]`;
  }
  if (typeof value === 'object') {
    return `{${serializeProperties(value as Record<string, unknown>)}}`;
  }
  return esc(String(value));
}
