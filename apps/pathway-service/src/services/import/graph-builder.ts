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
 * The commands use MATCH on node_id properties for edge creation,
 * so nodes must be created before edges in the transaction.
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

  // 2. Create all other nodes
  for (const node of pw.nodes) {
    const props = serializeProperties({
      node_id: node.id,
      node_type: node.type,
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
      ? `MATCH (a:Pathway {node_id: 'root'})`
      : `MATCH (a {node_id: ${esc(edge.from)}})`;

    const toMatch = `MATCH (b {node_id: ${esc(edge.to)}})`;

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
  /** Batched edge-creation Cyphers (UNWIND per edge-type batch, up to EDGE_BATCH_SIZE each) */
  edgeCyphers: string[];
  /** Individual edge Cyphers for edges that carry properties (rare, can't batch via UNWIND) */
  edgeWithPropsCyphers: string[];
}

const NODE_BATCH_SIZE = 50;
const EDGE_BATCH_SIZE = 200;

/**
 * Build batched Cypher commands for efficient graph creation.
 *
 * - Nodes are batched into comma-separated CREATE patterns (50 per query).
 * - Edges without properties are grouped by type and created via UNWIND (200 per query).
 * - Edges with properties are created individually (these are rare).
 *
 * For a pathway with 500 nodes and 2500 edges across 13 edge types, this
 * produces ~10 node queries + ~15 edge queries instead of ~3000 individual ones.
 */
export function buildBatchedGraphCommands(pw: PathwayJson): BatchedGraphCommands {
  const meta = pw.pathway;

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
        ...node.properties,
      });
      return `(v${idx}:${node.type} {${props}})`;
    });
    nodeCyphers.push(`CREATE ${patterns.join(', ')} RETURN 1`);
  }

  // ── Group edges by type; separate ones with properties ──
  const edgesByType = new Map<string, { from: string; to: string }[]>();
  const edgesWithProps: typeof pw.edges = [];

  for (const edge of pw.edges) {
    if (edge.properties && Object.keys(edge.properties).length > 0) {
      edgesWithProps.push(edge);
    } else {
      const list = edgesByType.get(edge.type);
      if (list) list.push({ from: edge.from, to: edge.to });
      else edgesByType.set(edge.type, [{ from: edge.from, to: edge.to }]);
    }
  }

  // ── Batch edges: UNWIND per (type, batch) ──
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
        `MATCH (a {node_id: e.f}), (b {node_id: e.t}) ` +
        `CREATE (a)-[:${edgeType}]->(b) RETURN 1`,
      );
    }
  }

  // ── Edges with properties: individual (rare) ──
  const edgeWithPropsCyphers: string[] = [];
  for (const edge of edgesWithProps) {
    const fromMatch = edge.from === 'root'
      ? `MATCH (a:Pathway {node_id: 'root'})`
      : `MATCH (a {node_id: ${esc(edge.from)}})`;
    const toMatch = `MATCH (b {node_id: ${esc(edge.to)}})`;
    const props = ` {${serializeProperties(edge.properties!)}}`;
    edgeWithPropsCyphers.push(
      `${fromMatch} ${toMatch} CREATE (a)-[:${edge.type}${props}]->(b) RETURN a, b`,
    );
  }

  return { rootCypher, nodeCyphers, edgeCyphers, edgeWithPropsCyphers };
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

function serializeValue(value: unknown): string {
  if (typeof value === 'string') {
    return esc(value);
  }
  if (typeof value === 'number') {
    return String(value);
  }
  if (typeof value === 'boolean') {
    return value ? 'true' : 'false';
  }
  // Arrays and objects: store as JSON string
  return esc(JSON.stringify(value));
}
