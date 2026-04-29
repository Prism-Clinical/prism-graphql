'use client';

import { useCallback, useEffect, useRef, useMemo } from 'react';
import {
  ReactFlow,
  Background,
  MiniMap,
  useNodesState,
  useEdgesState,
  useReactFlow,
  ReactFlowProvider,
  applyNodeChanges,
  applyEdgeChanges,
  type Node,
  type Edge,
  type Connection,
  type NodeChange,
  type EdgeChange,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import { nodeTypes } from './nodes';
import { NODE_CONFIG } from './nodeConfig';
import { validateConnection, wouldCreateCycle } from './EdgeConstraintValidator';
import { applyAutoLayout } from './AutoLayout';
import { NodePalette } from './NodePalette';
import { PropertiesPanel } from '@/components/editor/PropertiesPanel';
import { EditorToolbar } from '@/components/editor/EditorToolbar';
import { useUndoRedo } from '@/lib/hooks/useUndoRedo';
import type { PathwayNodeType, PathwayNodeData, PathwayEdgeData, PathwayStatus } from '@/types';

interface PathwayCanvasProps {
  initialNodes?: Node[];
  initialEdges?: Edge[];
  pathwayTitle?: string;
  pathwayVersion?: string;
  isDraft?: boolean;
  readOnly?: boolean;
  pathwayStatus?: PathwayStatus;
  onSaveDraft?: (nodes: Node[], edges: Edge[]) => void;
  onPublish?: (nodes: Node[], edges: Edge[]) => void;
  isSaving?: boolean;
  validationErrors?: { nodeId?: string; message: string }[];
  // Controlled mode props
  externalNodes?: Node[];
  externalEdges?: Edge[];
  externalSetNodes?: React.Dispatch<React.SetStateAction<Node[]>>;
  externalSetEdges?: React.Dispatch<React.SetStateAction<Edge[]>>;
  hideToolbar?: boolean;
  hideNodePalette?: boolean;
  onReady?: (controls: { autoLayout: () => void; fitView: () => void }) => void;
  /** When this key changes, auto-layout the current node subset and fit view */
  scopeKey?: string | null;
}

let nodeIdCounter = 0;
function generateNodeId(nodeType: PathwayNodeType): string {
  nodeIdCounter++;
  const prefix = nodeType.toLowerCase().replace(/([A-Z])/g, '-$1').replace(/^-/, '');
  return `${prefix}-new-${nodeIdCounter}`;
}

function PathwayCanvasInner({
  initialNodes = [],
  initialEdges = [],
  pathwayTitle = 'Untitled Pathway',
  pathwayVersion = '1.0',
  isDraft = true,
  readOnly = false,
  pathwayStatus,
  onSaveDraft,
  onPublish,
  isSaving = false,
  validationErrors = [],
  externalNodes,
  externalEdges,
  externalSetNodes,
  externalSetEdges,
  hideToolbar = false,
  hideNodePalette = false,
  onReady,
  scopeKey,
}: PathwayCanvasProps) {
  const reactFlowWrapper = useRef<HTMLDivElement>(null);
  const { screenToFlowPosition, fitView: rfFitView } = useReactFlow();

  // Internal state — always created (hooks must not be conditional)
  const [internalNodes, setInternalNodes, internalOnNodesChange] = useNodesState(initialNodes);
  const [internalEdges, setInternalEdges, internalOnEdgesChange] = useEdgesState(initialEdges);

  // Determine if we are in controlled mode
  const isControlled = externalSetNodes !== undefined;

  // Resolved state: use external when provided, fall back to internal
  const nodes = isControlled ? (externalNodes ?? []) : internalNodes;
  const edges = isControlled ? (externalEdges ?? []) : internalEdges;
  const setNodes = isControlled ? externalSetNodes! : setInternalNodes;
  const setEdges = isControlled ? externalSetEdges! : setInternalEdges;

  // Undo/redo — only used in uncontrolled mode; in controlled mode the parent manages history
  const { takeSnapshot, undo, redo, canUndo, canRedo } = useUndoRedo(
    isControlled ? [] : nodes,
    isControlled ? [] : edges,
    isControlled ? setInternalNodes : setNodes,
    isControlled ? setInternalEdges : setEdges,
  );

  // Expose controls via onReady once the React Flow instance is available
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;
  const readyFiredRef = useRef(false);

  // Track selected node for properties panel
  const selectedNode = useMemo(() => {
    return nodes.find(n => n.selected) ?? null;
  }, [nodes]);

  // Deselect all nodes (used by PropertiesPanel close button)
  const handleDeselectAll = useCallback(() => {
    setNodes(nds => nds.map(n => ({ ...n, selected: false })));
  }, [setNodes]);

  // Change handlers — external mode applies changes manually; internal mode uses built-in handler
  const onNodesChange = useCallback((changes: NodeChange[]) => {
    if (isControlled) {
      setNodes(nds => applyNodeChanges(changes, nds));
    } else {
      internalOnNodesChange(changes);
    }
  }, [isControlled, setNodes, internalOnNodesChange]);

  const onEdgesChange = useCallback((changes: EdgeChange[]) => {
    if (isControlled) {
      setEdges(eds => applyEdgeChanges(changes, eds));
    } else {
      internalOnEdgesChange(changes);
    }
  }, [isControlled, setEdges, internalOnEdgesChange]);

  // Handle new connections with edge constraint validation
  const onConnect = useCallback((connection: Connection) => {
    const validTypes = validateConnection(connection, nodes);
    if (validTypes.length === 0) return;
    if (connection.source && connection.target && wouldCreateCycle(connection.source, connection.target, edges)) return;

    if (!isControlled) takeSnapshot();

    const edgeType = validTypes[0]; // Use first valid edge type
    const newEdge: Edge = {
      id: `e-${connection.source}-${connection.target}-${edgeType}`,
      source: connection.source!,
      target: connection.target!,
      label: edgeType.replace(/_/g, ' '),
      data: {
        pathwayEdgeType: edgeType,
      } satisfies PathwayEdgeData,
    };
    setEdges(eds => [...eds, newEdge]);
  }, [nodes, edges, setEdges, takeSnapshot, isControlled]);

  // Wrap onNodesChange to capture snapshots on delete (uncontrolled only)
  const handleNodesChange = useCallback((changes: NodeChange[]) => {
    const hasDelete = changes.some(c => c.type === 'remove');
    if (hasDelete && !isControlled) takeSnapshot();
    onNodesChange(changes);
  }, [onNodesChange, takeSnapshot, isControlled]);

  // Wrap onEdgesChange to capture snapshots on delete (uncontrolled only)
  const handleEdgesChange = useCallback((changes: EdgeChange[]) => {
    const hasDelete = changes.some(c => c.type === 'remove');
    if (hasDelete && !isControlled) takeSnapshot();
    onEdgesChange(changes);
  }, [onEdgesChange, takeSnapshot, isControlled]);

  // Handle drop from NodePalette
  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }, []);

  const onDrop = useCallback((event: React.DragEvent) => {
    event.preventDefault();

    const nodeType = event.dataTransfer.getData('application/reactflow-nodetype') as PathwayNodeType;
    if (!nodeType || !NODE_CONFIG[nodeType]) return;

    if (!isControlled) takeSnapshot();

    const position = screenToFlowPosition({
      x: event.clientX,
      y: event.clientY,
    });

    const config = NODE_CONFIG[nodeType];
    const nodeId = generateNodeId(nodeType);

    const newNode: Node = {
      id: nodeId,
      type: nodeType,
      position,
      data: {
        pathwayNodeType: nodeType,
        pathwayNodeId: nodeId,
        label: `New ${config.label}`,
        properties: {},
      } satisfies PathwayNodeData,
    };

    setNodes(nds => [...nds, newNode]);
  }, [screenToFlowPosition, setNodes, takeSnapshot, isControlled]);

  // Update node properties from PropertiesPanel (debounced snapshot)
  const propertySnapshotTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleUpdateNode = useCallback((nodeId: string, properties: Record<string, unknown>, label: string) => {
    // Take a snapshot on the first edit after a 500ms pause (uncontrolled only)
    if (!isControlled) {
      if (!propertySnapshotTimer.current) {
        takeSnapshot();
      } else {
        clearTimeout(propertySnapshotTimer.current);
      }
      propertySnapshotTimer.current = setTimeout(() => {
        propertySnapshotTimer.current = null;
      }, 500);
    }

    setNodes(nds => nds.map(n => {
      if (n.id !== nodeId) return n;
      return {
        ...n,
        data: {
          ...(n.data as unknown as PathwayNodeData),
          properties,
          label,
        },
      };
    }));
  }, [setNodes, takeSnapshot, isControlled]);

  // Auto-layout
  const handleAutoLayout = useCallback(() => {
    if (!isControlled) takeSnapshot();
    const layoutedNodes = applyAutoLayout(nodes, edges);
    setNodes(layoutedNodes);
    window.requestAnimationFrame(() => rfFitView({ padding: 0.2 }));
  }, [nodes, edges, setNodes, rfFitView, takeSnapshot, isControlled]);

  // Fit view
  const handleFitView = useCallback(() => {
    rfFitView({ padding: 0.2 });
  }, [rfFitView]);

  // Notify parent of controls once the React Flow instance is ready
  useEffect(() => {
    if (readyFiredRef.current) return;
    if (!onReadyRef.current) return;
    readyFiredRef.current = true;
    onReadyRef.current({ autoLayout: handleAutoLayout, fitView: handleFitView });
  }, [handleAutoLayout, handleFitView]);

  // Auto-layout + fit view when scope changes (controlled mode).
  // Uses refs for nodes/edges to avoid re-firing on every node/edge change.
  const nodesRef = useRef(nodes);
  const edgesRef = useRef(edges);
  nodesRef.current = nodes;
  edgesRef.current = edges;

  const scopeKeyMountedRef = useRef(true);
  useEffect(() => {
    // Skip initial mount — no re-layout needed
    if (scopeKeyMountedRef.current) {
      scopeKeyMountedRef.current = false;
      return;
    }
    if (!isControlled) return;

    // Layout the current visible subset and fit view
    const currentNodes = nodesRef.current;
    const currentEdges = edgesRef.current;
    const layoutedNodes = applyAutoLayout(currentNodes, currentEdges);

    // Merge layouted positions back via functional update so we don't lose
    // nodes outside the current scope
    const positionMap = new Map(layoutedNodes.map(n => [n.id, n.position]));
    setNodes(allNodes =>
      allNodes.map(n => {
        const newPos = positionMap.get(n.id);
        return newPos ? { ...n, position: newPos } : n;
      }),
    );
    window.requestAnimationFrame(() => rfFitView({ padding: 0.2 }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopeKey]);

  // Keyboard shortcuts (undo/redo only in uncontrolled mode)
  const onKeyDown = useCallback((event: React.KeyboardEvent) => {
    if (!isControlled && (event.metaKey || event.ctrlKey) && event.key === 'z') {
      event.preventDefault();
      if (event.shiftKey) {
        redo();
      } else {
        undo();
      }
    }
  }, [undo, redo, isControlled]);

  return (
    <div className="flex flex-col h-full" onKeyDown={onKeyDown} tabIndex={-1}>
      {!hideToolbar && (
        <EditorToolbar
          canUndo={canUndo}
          canRedo={canRedo}
          onUndo={undo}
          onRedo={redo}
          onAutoLayout={handleAutoLayout}
          onFitView={handleFitView}
          onSaveDraft={onSaveDraft ? () => onSaveDraft(nodes, edges) : undefined}
          onPublish={onPublish ? () => onPublish(nodes, edges) : undefined}
          pathwayTitle={pathwayTitle}
          pathwayVersion={pathwayVersion}
          isDraft={isDraft}
          pathwayStatus={pathwayStatus}
          isSaving={isSaving}
        />
      )}

      {validationErrors.length > 0 && (
        <div className="bg-red-50 border-b border-red-200 px-4 py-2">
          <div className="flex items-start gap-2">
            <span className="text-red-500 text-sm font-medium flex-shrink-0">Validation errors:</span>
            <ul className="text-sm text-red-700 space-y-0.5">
              {validationErrors.slice(0, 5).map((err, i) => (
                <li key={i}>• {err.message}</li>
              ))}
              {validationErrors.length > 5 && (
                <li className="text-red-500">...and {validationErrors.length - 5} more</li>
              )}
            </ul>
          </div>
        </div>
      )}

      <div className="flex flex-1 overflow-hidden">
        {!hideNodePalette && !readOnly && <NodePalette />}

        <div ref={reactFlowWrapper} className="flex-1">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={readOnly ? undefined : handleNodesChange}
            onEdgesChange={readOnly ? undefined : handleEdgesChange}
            onConnect={readOnly ? undefined : onConnect}
            onDragOver={readOnly ? undefined : onDragOver}
            onDrop={readOnly ? undefined : onDrop}
            nodeTypes={nodeTypes}
            fitView
            snapToGrid
            snapGrid={[16, 16]}
            deleteKeyCode={readOnly ? null : 'Delete'}
            multiSelectionKeyCode="Shift"
            panOnScroll
            zoomOnScroll
          >
            <Background gap={16} size={1} />
            <MiniMap
              nodeColor={(node) => {
                const data = node.data as unknown as PathwayNodeData;
                const config = NODE_CONFIG[data.pathwayNodeType];
                // Extract the color name from the Tailwind class for the minimap
                const colorMap: Record<string, string> = {
                  'bg-blue-500': '#3b82f6',
                  'bg-emerald-500': '#10b981',
                  'bg-amber-500': '#f59e0b',
                  'bg-gray-500': '#6b7280',
                  'bg-purple-500': '#a855f7',
                  'bg-teal-500': '#14b8a6',
                  'bg-orange-500': '#f97316',
                  'bg-slate-500': '#64748b',
                  'bg-indigo-500': '#6366f1',
                  'bg-emerald-600': '#059669',
                  'bg-cyan-500': '#06b6d4',
                };
                return colorMap[config.color] ?? '#6b7280';
              }}
              zoomable
              pannable
            />
          </ReactFlow>
        </div>

        {!readOnly && selectedNode && (
          <PropertiesPanel
            selectedNode={selectedNode}
            onUpdateNode={handleUpdateNode}
            onClose={handleDeselectAll}
          />
        )}
      </div>
    </div>
  );
}

/**
 * PathwayCanvas wraps the inner component with ReactFlowProvider.
 * This is required so that useReactFlow() works inside the component.
 */
export function PathwayCanvas(props: PathwayCanvasProps) {
  return (
    <ReactFlowProvider>
      <PathwayCanvasInner {...props} />
    </ReactFlowProvider>
  );
}
