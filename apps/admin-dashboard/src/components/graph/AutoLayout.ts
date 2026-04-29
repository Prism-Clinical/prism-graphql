import dagre from 'dagre';
import type { Node, Edge } from '@xyflow/react';
import { NODE_CONFIG } from './nodeConfig';
import type { PathwayNodeData } from '@/types';

interface LayoutOptions {
  direction?: 'TB' | 'LR';
  nodeSpacing?: number;
  rankSpacing?: number;
}

/**
 * Applies dagre hierarchical layout to React Flow nodes.
 * Returns new node array with updated positions. Edges are unchanged.
 */
export function applyAutoLayout(
  nodes: Node[],
  edges: Edge[],
  options: LayoutOptions = {}
): Node[] {
  const { direction = 'TB', nodeSpacing = 40, rankSpacing = 80 } = options;

  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({
    rankdir: direction,
    nodesep: nodeSpacing,
    ranksep: rankSpacing,
    marginx: 40,
    marginy: 40,
  });

  // Add nodes with their dimensions
  for (const node of nodes) {
    const nodeData = node.data as unknown as PathwayNodeData;
    const config = NODE_CONFIG[nodeData.pathwayNodeType];
    g.setNode(node.id, {
      width: node.measured?.width ?? config.defaultWidth,
      height: node.measured?.height ?? config.defaultHeight,
    });
  }

  // Add edges
  for (const edge of edges) {
    g.setEdge(edge.source, edge.target);
  }

  // Run layout
  dagre.layout(g);

  // Map positions back to React Flow nodes
  return nodes.map(node => {
    const dagreNode = g.node(node.id);
    if (!dagreNode) return node;

    const nodeData = node.data as unknown as PathwayNodeData;
    const config = NODE_CONFIG[nodeData.pathwayNodeType];
    const width = node.measured?.width ?? config.defaultWidth;
    const height = node.measured?.height ?? config.defaultHeight;

    return {
      ...node,
      position: {
        x: dagreNode.x - width / 2,
        y: dagreNode.y - height / 2,
      },
    };
  });
}
