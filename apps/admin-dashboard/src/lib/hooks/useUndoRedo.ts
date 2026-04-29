import { useCallback, useRef, useState } from 'react';
import type { Node, Edge } from '@xyflow/react';

interface Snapshot {
  nodes: Node[];
  edges: Edge[];
}

const MAX_HISTORY = 50;

/**
 * Manages undo/redo history for the graph editor.
 * Call `takeSnapshot` before making changes to push the current state onto the stack.
 */
export function useUndoRedo(
  nodes: Node[],
  edges: Edge[],
  setNodes: (nodes: Node[]) => void,
  setEdges: (edges: Edge[]) => void,
) {
  const past = useRef<Snapshot[]>([]);
  const future = useRef<Snapshot[]>([]);
  // Counter to force re-renders when ref-based history changes
  const [, setVersion] = useState(0);
  const bump = () => setVersion(v => v + 1);

  const takeSnapshot = useCallback(() => {
    past.current = [
      ...past.current.slice(-(MAX_HISTORY - 1)),
      { nodes: structuredClone(nodes), edges: structuredClone(edges) },
    ];
    future.current = [];
    bump();
  }, [nodes, edges]);

  const undo = useCallback(() => {
    const previous = past.current.pop();
    if (!previous) return;

    future.current.push({ nodes: structuredClone(nodes), edges: structuredClone(edges) });
    setNodes(previous.nodes);
    setEdges(previous.edges);
    bump();
  }, [nodes, edges, setNodes, setEdges]);

  const redo = useCallback(() => {
    const next = future.current.pop();
    if (!next) return;

    past.current.push({ nodes: structuredClone(nodes), edges: structuredClone(edges) });
    setNodes(next.nodes);
    setEdges(next.edges);
    bump();
  }, [nodes, edges, setNodes, setEdges]);

  const canUndo = past.current.length > 0;
  const canRedo = future.current.length > 0;

  return { takeSnapshot, undo, redo, canUndo, canRedo };
}
