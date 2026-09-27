import { PathwayJson, PathwayNodeType, PathwayEdgeType } from './types';

/**
 * Rebuild the authored PathwayJson from what is actually stored — the
 * `pathway_graph_index` row, its code-set members, and the AGE graph.
 *
 * Import validates the JSON on the way IN, but `activatePathway` was a bare
 * SQL status flip: a DRAFT that accumulated soft issues under
 * `draftMode: true` (half-created nodes, gates with no outbound edge) could be
 * promoted to ACTIVE with those issues intact. That is how the orphaned
 * `gate-new-1` / `guidance-new-1` nodes reached a published version of
 * vaginitis-in-pregnancy-v1. Reconstructing the JSON lets activation re-run
 * the same validator in strict mode against the graph as it stands now.
 *
 * Pure — no pool, no Cypher. The caller fetches; this only reshapes.
 */

/**
 * Stamps the graph writer puts on every node (see graph-builder.ts). They are
 * not authored properties, and leaving them in means a validator round-trip
 * compares against fields the author never wrote.
 */
const SYSTEM_INTERNAL_NODE_PROPS = new Set([
  'node_id',
  'node_type',
  'pathway_logical_id',
  'pathway_version',
]);

export interface StoredPathwayRow {
  logicalId: string;
  title: string;
  version: string;
  category: string;
  scope?: string | null;
  targetPopulation?: string | null;
}

export interface StoredGraphInput {
  pathway: StoredPathwayRow;
  conditionCodes: Array<{ code: string; system: string; description?: string | null }>;
  nodes: Array<{ id: string; type: string; properties: Record<string, unknown> }>;
  edges: Array<{ from: string; to: string; type: string; properties?: Record<string, unknown> }>;
}

export function pathwayJsonFromStoredGraph(input: StoredGraphInput): PathwayJson {
  const { pathway, conditionCodes, nodes, edges } = input;

  return {
    schema_version: '1.0',
    pathway: {
      logical_id: pathway.logicalId,
      title: pathway.title,
      version: pathway.version,
      category: pathway.category,
      scope: pathway.scope ?? undefined,
      target_population: pathway.targetPopulation ?? undefined,
      condition_codes: conditionCodes.map((cc) => ({
        code: cc.code,
        system: cc.system,
        ...(cc.description ? { description: cc.description } : {}),
      })),
    },
    // The Pathway root is synthetic: authored JSON addresses it as the literal
    // id "root" in edges and never lists it as a node. Edges are kept exactly
    // as stored, so root-anchored edges still read `from: "root"`.
    nodes: nodes
      .filter((n) => n.type !== 'Pathway' && n.id !== 'root')
      .map((n) => ({
        id: n.id,
        type: n.type as PathwayNodeType,
        properties: stripSystemInternalProps(n.properties),
      })),
    edges: edges.map((e) => ({
      from: e.from,
      to: e.to,
      type: e.type as PathwayEdgeType,
      ...(e.properties && Object.keys(e.properties).length > 0 ? { properties: e.properties } : {}),
    })),
  } as PathwayJson;
}

function stripSystemInternalProps(properties: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(properties ?? {})) {
    if (SYSTEM_INTERNAL_NODE_PROPS.has(key)) continue;
    out[key] = value;
  }
  return out;
}
