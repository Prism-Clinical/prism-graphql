import type { Node, Edge } from '@xyflow/react';
import type {
  PathwayGraph,
  PathwayGraphNode,
  PathwayGraphEdge,
  PathwayNodeType,
  PathwayNodeData,
  PathwayEdgeData,
} from '@/types';

/**
 * Derive a human-readable label from node type and properties.
 */
function deriveLabel(type: string, properties: Record<string, unknown>): string {
  switch (type) {
    case 'Stage':
    case 'Step':
    case 'DecisionPoint':
    case 'EvidenceCitation':
      return (properties.title as string) || `Untitled ${type}`;
    case 'Medication':
    case 'LabTest':
    case 'Procedure':
    case 'QualityMetric':
      return (properties.name as string) || `Untitled ${type}`;
    case 'Criterion':
    case 'Schedule':
      return (properties.description as string) || `Untitled ${type}`;
    case 'CodeEntry':
      return `${properties.system || '?'}: ${properties.code || '?'}`;
    default:
      return `Unknown ${type}`;
  }
}

/**
 * Humanize an edge type string: "HAS_STAGE" → "Has Stage"
 */
function humanizeEdgeType(edgeType: string): string {
  return edgeType
    .split('_')
    .map((word, i) => (i === 0 ? word.charAt(0) + word.slice(1).toLowerCase() : word.toLowerCase()))
    .join(' ');
}

/** Normalize short-form evidence levels ("A") to long-form ("Level A") */
const EVIDENCE_LEVEL_MAP: Record<string, string> = { A: 'Level A', B: 'Level B', C: 'Level C' };

function normalizeProperties(type: string, properties: Record<string, unknown>): Record<string, unknown> {
  if (type === 'EvidenceCitation' && typeof properties.evidence_level === 'string') {
    const mapped = EVIDENCE_LEVEL_MAP[properties.evidence_level];
    if (mapped) return { ...properties, evidence_level: mapped };
  }
  return properties;
}

/**
 * Transforms a PathwayGraph response into React Flow nodes and edges.
 * Positions are set to (0,0) — call applyAutoLayout() after this.
 */
export function deserializePathway(graph: PathwayGraph): {
  nodes: Node<PathwayNodeData>[];
  edges: Edge<PathwayEdgeData>[];
} {
  const nodes: Node<PathwayNodeData>[] = graph.nodes.map((gn: PathwayGraphNode) => {
    const properties = normalizeProperties(gn.type, gn.properties);
    return {
      id: gn.id,
      type: gn.type as PathwayNodeType,
      position: { x: 0, y: 0 },
      data: {
        pathwayNodeType: gn.type as PathwayNodeType,
        pathwayNodeId: gn.id,
        label: deriveLabel(gn.type, properties),
        properties,
      },
    };
  });

  // Filter out root edges — root is implicit in the canvas
  const edgeIdCounts = new Map<string, number>();
  const edges: Edge<PathwayEdgeData>[] = graph.edges
    .filter((ge: PathwayGraphEdge) => ge.from !== 'root')
    .map((ge: PathwayGraphEdge) => {
      const baseId = `e-${ge.from}-${ge.to}-${ge.type}`;
      const count = edgeIdCounts.get(baseId) ?? 0;
      edgeIdCounts.set(baseId, count + 1);
      const id = count === 0 ? baseId : `${baseId}-${count}`;
      return {
        id,
        source: ge.from,
        target: ge.to,
        label: humanizeEdgeType(ge.type),
        data: {
          pathwayEdgeType: ge.type as PathwayEdgeData['pathwayEdgeType'],
          ...(ge.properties && Object.keys(ge.properties).length > 0
            ? { properties: ge.properties }
            : {}),
        },
      };
    });

  return { nodes, edges };
}
