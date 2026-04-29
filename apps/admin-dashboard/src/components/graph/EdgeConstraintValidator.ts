import type { Node, Edge, Connection } from '@xyflow/react';
import { VALID_EDGE_ENDPOINTS, type PathwayNodeType, type PathwayEdgeType, type PathwayNodeData } from '@/types';

/**
 * Finds all valid edge types that can connect a source node type to a target node type.
 */
export function getValidEdgeTypes(
  sourceType: PathwayNodeType | 'root',
  targetType: PathwayNodeType
): PathwayEdgeType[] {
  const valid: PathwayEdgeType[] = [];
  for (const [edgeType, endpoints] of Object.entries(VALID_EDGE_ENDPOINTS)) {
    if (endpoints.from.includes(sourceType) && endpoints.to.includes(targetType)) {
      valid.push(edgeType as PathwayEdgeType);
    }
  }
  return valid;
}

/**
 * Checks whether a proposed connection is valid.
 * Returns the valid edge types if the connection is allowed, or an empty array if not.
 */
export function validateConnection(
  connection: Connection,
  nodes: Node[]
): PathwayEdgeType[] {
  if (!connection.source || !connection.target) return [];
  if (connection.source === connection.target) return [];

  const sourceNode = nodes.find(n => n.id === connection.source);
  const targetNode = nodes.find(n => n.id === connection.target);
  if (!sourceNode || !targetNode) return [];

  const sourceType = (sourceNode.data as unknown as PathwayNodeData).pathwayNodeType;
  const targetType = (targetNode.data as unknown as PathwayNodeData).pathwayNodeType;

  return getValidEdgeTypes(sourceType, targetType);
}

/**
 * Given a source node type, returns all node types that can be valid targets.
 */
export function getValidTargetTypes(sourceType: PathwayNodeType): PathwayNodeType[] {
  const targets = new Set<PathwayNodeType>();
  for (const endpoints of Object.values(VALID_EDGE_ENDPOINTS)) {
    if (endpoints.from.includes(sourceType)) {
      endpoints.to.forEach(t => targets.add(t));
    }
  }
  return [...targets];
}

/**
 * Checks if connecting source to target would create a cycle.
 * Uses BFS from target to see if it can reach source.
 */
export function wouldCreateCycle(
  sourceId: string,
  targetId: string,
  edges: Edge[]
): boolean {
  const visited = new Set<string>();
  const queue = [targetId];

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current === sourceId) return true;
    if (visited.has(current)) continue;
    visited.add(current);

    for (const edge of edges) {
      if (edge.target === current) {
        queue.push(edge.source);
      }
    }
  }

  return false;
}
