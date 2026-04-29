import { useMemo } from 'react';
import type { Node, Edge } from '@xyflow/react';

/**
 * Given a full set of nodes/edges and a scope node ID, returns only
 * the subtree rooted at that node via BFS traversal.
 * Returns all nodes/edges when scopeNodeId is null.
 */
export function useSubtreeFilter<N extends Node = Node, E extends Edge = Edge>(
  nodes: N[],
  edges: E[],
  scopeNodeId: string | null,
): { filteredNodes: N[]; filteredEdges: E[] } {
  return useMemo(() => {
    if (scopeNodeId === null) {
      return { filteredNodes: nodes, filteredEdges: edges };
    }

    // BFS from the scope node, following outgoing edges
    const visited = new Set<string>();
    const queue: string[] = [scopeNodeId];
    visited.add(scopeNodeId);

    // Build adjacency list (source -> targets) for BFS
    const adjacency = new Map<string, string[]>();
    for (const edge of edges) {
      const targets = adjacency.get(edge.source);
      if (targets) {
        targets.push(edge.target);
      } else {
        adjacency.set(edge.source, [edge.target]);
      }
    }

    while (queue.length > 0) {
      const current = queue.shift()!;
      const children = adjacency.get(current);
      if (children) {
        for (const child of children) {
          if (!visited.has(child)) {
            visited.add(child);
            queue.push(child);
          }
        }
      }
    }

    const filteredNodes = nodes.filter((n) => visited.has(n.id));
    const filteredEdges = edges.filter(
      (e) => visited.has(e.source) && visited.has(e.target),
    );

    return { filteredNodes, filteredEdges };
  }, [nodes, edges, scopeNodeId]);
}
