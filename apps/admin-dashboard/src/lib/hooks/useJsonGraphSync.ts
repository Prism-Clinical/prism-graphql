'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import type { Node, Edge } from '@xyflow/react';
import { serializePathway } from '@/lib/pathway-json/serializer';
import { deserializePathway } from '@/lib/pathway-json/deserializer';
import { applyAutoLayout } from '@/components/graph/AutoLayout';
import { validatePathwayJson, type ClientValidationResult } from '@/lib/pathway-json/validator';
import type { PathwayMetadata, PathwayJson, PathwayNodeData, PathwayEdgeData, PathwayGraph } from '@/types';
import type { JsonEditorError } from '@/components/editor/JsonEditor';

// ─── Hook interfaces ─────────────────────────────────────────────────

interface UseJsonGraphSyncOptions {
  initialNodes: Node<PathwayNodeData>[];
  initialEdges: Edge<PathwayEdgeData>[];
  initialMetadata: PathwayMetadata;
  readOnly?: boolean;
}

interface UseJsonGraphSyncResult {
  /** Current JSON text shown in Monaco editor */
  jsonText: string;
  /** Called by the Monaco editor on every keystroke */
  onJsonChange: (value: string) => void;
  /** React Flow nodes (canonical state) */
  nodes: Node<PathwayNodeData>[];
  /** React Flow edges (canonical state) */
  edges: Edge<PathwayEdgeData>[];
  /** Set nodes from graph interactions */
  setNodes: (nodes: Node<PathwayNodeData>[]) => void;
  /** Set edges from graph interactions */
  setEdges: (edges: Edge<PathwayEdgeData>[]) => void;
  /** Current pathway metadata */
  metadata: PathwayMetadata;
  /** Errors to display in Monaco editor as markers */
  jsonErrors: JsonEditorError[];
  /** Structured validation result for UI display */
  validationResult: ClientValidationResult | null;
  /** True if there are unsaved changes */
  isDirty: boolean;
  /** Reset dirty flag (call after save) */
  markClean: () => void;
  /** Immediately replace all content — used by file upload (no debounce) */
  loadJson: (json: string) => void;
}

// ─── Helper: build a PathwayGraph shell from PathwayJson ─────────────

/**
 * The deserializer expects a PathwayGraph (which includes a full Pathway
 * object with database fields like id/status/createdAt). For local editing
 * we only care about the nodes/edges output, so we construct a minimal
 * placeholder Pathway from the PathwayJson metadata.
 */
function buildPathwayGraphFromJson(parsed: PathwayJson): PathwayGraph {
  return {
    pathway: {
      id: parsed.pathway.logical_id,
      logicalId: parsed.pathway.logical_id,
      title: parsed.pathway.title,
      version: parsed.pathway.version,
      category: parsed.pathway.category as import('@/types').PathwayCategory,
      status: 'DRAFT',
      conditionCodes: parsed.pathway.condition_codes.map((c) => c.code),
      scope: parsed.pathway.scope ?? null,
      targetPopulation: parsed.pathway.target_population ?? null,
      isActive: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    nodes: parsed.nodes.map((n) => ({
      id: n.id,
      type: n.type,
      properties: n.properties,
    })),
    edges: parsed.edges.map((e) => ({
      from: e.from,
      to: e.to,
      type: e.type,
      properties: e.properties,
    })),
    conditionCodeDetails: parsed.pathway.condition_codes,
  };
}

// ─── Hook ────────────────────────────────────────────────────────────

export function useJsonGraphSync({
  initialNodes,
  initialEdges,
  initialMetadata,
  readOnly = false,
}: UseJsonGraphSyncOptions): UseJsonGraphSyncResult {
  // Graph state is canonical — JSON is derived from it
  const [nodes, setNodesState] = useState<Node<PathwayNodeData>[]>(initialNodes);
  const [edges, setEdgesState] = useState<Edge<PathwayEdgeData>[]>(initialEdges);
  const [metadata, setMetadata] = useState<PathwayMetadata>(initialMetadata);

  // JSON editor state
  const [jsonText, setJsonText] = useState<string>(() =>
    JSON.stringify(serializePathway(initialNodes, initialEdges, initialMetadata), null, 2),
  );
  const [jsonErrors, setJsonErrors] = useState<JsonEditorError[]>([]);
  const [validationResult, setValidationResult] = useState<ClientValidationResult | null>(null);

  // Dirty tracking — compare serialized data against the last "clean" snapshot
  // so visual-only changes (selection, drag) don't trigger autosave.
  const [isDirty, setIsDirty] = useState(false);
  const cleanJsonRef = useRef<string>(
    JSON.stringify(serializePathway(initialNodes, initialEdges, initialMetadata)),
  );
  // Track the current compact JSON so markClean can snapshot without re-serializing
  const currentCompactJsonRef = useRef<string>(cleanJsonRef.current);

  // Sync-loop prevention:
  // 'graph' = graph just changed, skip JSON→graph re-sync
  // 'json'  = JSON just changed, skip graph→JSON re-sync
  // null    = no update in flight
  const syncSourceRef = useRef<'graph' | 'json' | null>(null);

  // Debounce timer for JSON→graph sync
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ─── Graph → JSON (immediate) ───────────────────────────────────────

  useEffect(() => {
    // If the JSON side just triggered this, don't re-serialize back
    if (syncSourceRef.current === 'json') {
      syncSourceRef.current = null;
      return;
    }

    syncSourceRef.current = 'graph';
    const serialized = serializePathway(nodes, edges, metadata);
    const newJsonText = JSON.stringify(serialized, null, 2);
    setJsonText(newJsonText);

    // Compare compact serialization against clean snapshot to detect real data changes.
    // Visual-only changes (selection, drag position) don't affect serialization,
    // so they won't flip isDirty.
    const compactJson = JSON.stringify(serialized);
    currentCompactJsonRef.current = compactJson;
    setIsDirty(compactJson !== cleanJsonRef.current);

    // Re-validate and clear any prior JSON errors now that graph is canonical
    const result = validatePathwayJson(serialized);
    setValidationResult(result);
    setJsonErrors([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, edges, metadata]);

  // ─── JSON → Graph (debounced 300ms) ────────────────────────────────

  const onJsonChange = useCallback(
    (value: string) => {
      if (readOnly) return;

      setJsonText(value);
      setIsDirty(true);

      // Cancel prior debounce
      if (debounceTimerRef.current !== null) {
        clearTimeout(debounceTimerRef.current);
      }

      debounceTimerRef.current = setTimeout(() => {
        debounceTimerRef.current = null;

        // Try to parse JSON
        let parsed: unknown;
        try {
          parsed = JSON.parse(value);
        } catch {
          // Invalid JSON — freeze graph, show parse error at line 1
          setJsonErrors([{ message: 'Invalid JSON: unable to parse' }]);
          setValidationResult(null);
          return;
        }

        // Validate structure and semantics
        const result = validatePathwayJson(parsed);
        setValidationResult(result);

        if (!result.valid) {
          // Invalid pathway JSON — freeze graph, surface errors in Monaco
          const monacoErrors: JsonEditorError[] = result.errors.map((err) => ({
            message: err.message,
          }));
          setJsonErrors(monacoErrors);
          return;
        }

        // Clear errors — JSON is valid
        setJsonErrors([]);

        // Deserialize into React Flow nodes/edges
        const pathwayJson = parsed as PathwayJson;
        const graph = buildPathwayGraphFromJson(pathwayJson);
        const { nodes: newNodes, edges: newEdges } = deserializePathway(graph);

        // Apply auto-layout (nodes start at 0,0 from deserializer)
        const laidOutNodes = applyAutoLayout(newNodes, newEdges);

        // Signal that JSON is the source BEFORE any state updates to prevent
        // the graph→JSON effect from firing with stale state (race condition)
        syncSourceRef.current = 'json';

        // Update metadata from the JSON
        setMetadata(pathwayJson.pathway);
        setNodesState(laidOutNodes as Node<PathwayNodeData>[]);
        setEdgesState(newEdges as Edge<PathwayEdgeData>[]);
      }, 300);
    },
    [readOnly],
  );

  // ─── Graph setters (propagate dirty flag) ──────────────────────────

  const setNodes = useCallback((newNodes: Node<PathwayNodeData>[]) => {
    setNodesState(newNodes);
  }, []);

  const setEdges = useCallback((newEdges: Edge<PathwayEdgeData>[]) => {
    setEdgesState(newEdges);
  }, []);

  // ─── loadJson: immediate replacement (no debounce) ─────────────────

  const loadJson = useCallback(
    (json: string) => {
      // Cancel any pending debounce
      if (debounceTimerRef.current !== null) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(json);
      } catch {
        setJsonText(json);
        setJsonErrors([{ message: 'Invalid JSON: unable to parse' }]);
        setValidationResult(null);
        setIsDirty(true);
        return;
      }

      const result = validatePathwayJson(parsed);
      setValidationResult(result);

      if (!result.valid) {
        setJsonText(json);
        const monacoErrors: JsonEditorError[] = result.errors.map((err) => ({
          message: err.message,
        }));
        setJsonErrors(monacoErrors);
        setIsDirty(true);
        return;
      }

      const pathwayJson = parsed as PathwayJson;
      const graph = buildPathwayGraphFromJson(pathwayJson);
      const { nodes: newNodes, edges: newEdges } = deserializePathway(graph);
      const laidOutNodes = applyAutoLayout(newNodes, newEdges);

      // Format the JSON consistently
      const formattedJson = JSON.stringify(pathwayJson, null, 2);

      setJsonText(formattedJson);
      setJsonErrors([]);

      // Signal that JSON is the source BEFORE any state updates to prevent
      // the graph→JSON effect from firing with stale state (race condition)
      syncSourceRef.current = 'json';

      setMetadata(pathwayJson.pathway);
      setNodesState(laidOutNodes as Node<PathwayNodeData>[]);
      setEdgesState(newEdges as Edge<PathwayEdgeData>[]);
      setIsDirty(true);
    },
    [],
  );

  // ─── markClean ─────────────────────────────────────────────────────

  const markClean = useCallback(() => {
    cleanJsonRef.current = currentCompactJsonRef.current;
    setIsDirty(false);
  }, []);

  // ─── Cleanup debounce on unmount ────────────────────────────────────

  useEffect(() => {
    return () => {
      if (debounceTimerRef.current !== null) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, []);

  return {
    jsonText,
    onJsonChange,
    nodes,
    edges,
    setNodes,
    setEdges,
    metadata,
    jsonErrors,
    validationResult,
    isDirty,
    markClean,
    loadJson,
  };
}
