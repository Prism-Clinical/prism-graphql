// apps/pathway-service/src/services/compiler/stored-input.ts
import type { Pool } from 'pg';
import { fetchGraphFromAGE } from '../../resolvers/helpers/resolution-context';
import type { GraphEdge, GraphNode } from '../confidence/types';
import { pathwayJsonFromStoredGraph, StoredPathwayRow } from '../import/stored-graph';
import { loadAttributeCodeMap } from '../resolution/attribute-code-map';
import { parsePathwayTemporalDefaults } from '../resolution/temporal/cascade';
import type { AttributeCodeMap } from '../resolution/types';
import type { CompileInput } from './model';

export interface StoredIndex {
  row: StoredPathwayRow & { id: string; ageNodeId: string | null; temporalDefaults: unknown };
  conditionCodes: { code: string; system: string; description?: string | null }[];
}

export async function readStoredIndex(db: Pick<Pool, 'query'>, pathwayId: string): Promise<StoredIndex | null> {
  const r = await db.query(
    `SELECT id, age_node_id AS "ageNodeId", logical_id AS "logicalId", title, version, category,
            scope, target_population AS "targetPopulation", temporal_defaults AS "temporalDefaults"
       FROM pathway_graph_index WHERE id = $1`,
    [pathwayId],
  );
  if (!r.rows[0]) return null;
  const codes = await db.query(
    `SELECT m.code, m.system, cs.description
       FROM pathway_code_set_members m
       JOIN pathway_code_sets cs ON cs.id = m.code_set_id
      WHERE cs.pathway_id = $1
      ORDER BY cs.id, m.code`,
    [pathwayId],
  );
  return { row: r.rows[0], conditionCodes: codes.rows };
}

/**
 * A stored graph (as the resolution loader reads it) → the compiler's input. Pure.
 * `nodes` must include the loader's `shadowedNodes`: the loader collapses vertices
 * sharing a node_id, and the compiler must see every identity to refuse conflicts.
 */
export function compileInputFrom(index: StoredIndex, nodes: GraphNode[], edges: GraphEdge[], codeMap: AttributeCodeMap): CompileInput {
  return {
    pathway: pathwayJsonFromStoredGraph({
      pathway: index.row,
      conditionCodes: index.conditionCodes,
      nodes: nodes.map((n) => ({ id: n.nodeIdentifier, type: n.nodeType, properties: n.properties ?? {} })),
      edges: edges.map((e) => ({ from: e.sourceId, to: e.targetId, type: e.edgeType, properties: e.properties ?? {} })),
    }),
    codeMap,
    temporalDefaults: parsePathwayTemporalDefaults(index.row.temporalDefaults),
  };
}

/** Activation and the corpus script: read everything the compiler needs. `null` when there is nothing to compile. */
export async function loadStoredCompileInput(db: Pick<Pool, 'query'>, pathwayId: string): Promise<CompileInput | null> {
  const index = await readStoredIndex(db, pathwayId);
  if (!index || !index.row.ageNodeId) return null;
  // Sequential, not Promise.all: a single transaction client runs one query at a time.
  const graph = await fetchGraphFromAGE(db as Pool, String(index.row.ageNodeId));
  const codeMap = await loadAttributeCodeMap(db);
  return compileInputFrom(index, [...graph.nodes, ...graph.shadowedNodes], graph.edges, codeMap);
}
