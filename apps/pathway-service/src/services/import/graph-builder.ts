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
