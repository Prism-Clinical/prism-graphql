import type { Node, Edge } from '@xyflow/react';
import type {
  PathwayJson,
  PathwayMetadata,
  PathwayNodeDefinition,
  PathwayEdgeDefinition,
  PathwayNodeData,
  PathwayEdgeData,
} from '@/types';

/**
 * Transforms React Flow canvas state into a PathwayJson object
 * suitable for the importPathway mutation.
 */
export function serializePathway(
  nodes: Node[],
  edges: Edge[],
  metadata: PathwayMetadata,
): PathwayJson {
  // Map React Flow nodes to PathwayNodeDefinitions
  const pathwayNodes: PathwayNodeDefinition[] = nodes.map((node) => {
    const data = node.data as unknown as PathwayNodeData;
    return {
      id: data.pathwayNodeId,
      type: data.pathwayNodeType,
      properties: data.properties,
    };
  });

  // Map React Flow edges to PathwayEdgeDefinitions
  const pathwayEdges: PathwayEdgeDefinition[] = edges.map((edge) => {
    const data = edge.data as unknown as PathwayEdgeData;
    const def: PathwayEdgeDefinition = {
      from: edge.source,
      to: edge.target,
      type: data.pathwayEdgeType,
    };
    if (data.properties && Object.keys(data.properties).length > 0) {
      def.properties = data.properties;
    }
    return def;
  });

  // Add synthetic root → stage edges for stage nodes with no incoming edges
  const nodesWithIncoming = new Set(pathwayEdges.map((e) => e.to));
  const stageNodes = pathwayNodes.filter((n) => n.type === 'Stage');
  for (const stage of stageNodes) {
    if (!nodesWithIncoming.has(stage.id)) {
      pathwayEdges.push({
        from: 'root',
        to: stage.id,
        type: 'HAS_STAGE',
      });
    }
  }

  return {
    schema_version: '1.0',
    pathway: metadata,
    nodes: pathwayNodes,
    edges: pathwayEdges,
  };
}
