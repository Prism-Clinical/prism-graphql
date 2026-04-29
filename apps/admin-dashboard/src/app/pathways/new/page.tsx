'use client';

import { useRef, useCallback, useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import type { Node, Edge } from '@xyflow/react';
import { useJsonGraphSync } from '@/lib/hooks/useJsonGraphSync';
import { useUndoRedo } from '@/lib/hooks/useUndoRedo';
import { useSubtreeFilter } from '@/lib/hooks/useSubtreeFilter';
import { usePathwaySave } from '@/lib/hooks/usePathwaySave';
import { EditorToolbar, type EditorMode } from '@/components/editor/EditorToolbar';
import { JsonEditor } from '@/components/editor/JsonEditor';
import { StatusBar } from '@/components/editor/StatusBar';
import { UploadHandler } from '@/components/editor/UploadHandler';
import { PathwayCanvas } from '@/components/graph/PathwayCanvas';
import { PathwayNavigator } from '@/components/editor/PathwayNavigator';
import { serializePathway } from '@/lib/pathway-json/serializer';
import type { PathwayMetadata } from '@/types';

const SCAFFOLD_METADATA: PathwayMetadata = {
  logical_id: '',
  title: 'Untitled Pathway',
  version: '1.0',
  category: 'CHRONIC_DISEASE',
  scope: '',
  target_population: '',
  condition_codes: [],
};

export default function NewPathwayPage() {
  const router = useRouter();
  const { save, isSaving, validationErrors, clearErrors } = usePathwaySave();

  const sync = useJsonGraphSync({
    initialNodes: [],
    initialEdges: [],
    initialMetadata: SCAFFOLD_METADATA,
  });

  const { undo, redo, canUndo, canRedo } = useUndoRedo(
    sync.nodes,
    sync.edges,
    sync.setNodes as (nodes: Node[]) => void,
    sync.setEdges as (edges: Edge[]) => void,
  );

  // ─── Editor mode toggle + scope ─────────────────────────────────────

  const [editorMode, setEditorMode] = useState<EditorMode>('graph');
  const [scopeNodeId, setScopeNodeId] = useState<string | null>(null);

  const { filteredNodes, filteredEdges } = useSubtreeFilter(
    sync.nodes as Node[],
    sync.edges as Edge[],
    scopeNodeId,
  );

  // Safety: reset scope if the scoped node gets deleted
  useEffect(() => {
    if (scopeNodeId === null) return;
    const exists = sync.nodes.some((n) => n.id === scopeNodeId);
    if (!exists) setScopeNodeId(null);
  }, [sync.nodes, scopeNodeId]);

  // Upload trigger ref — populated by UploadHandler
  const uploadTriggerRef = useRef<(() => void) | null>(null);

  // Canvas controls ref — populated via PathwayCanvas onReady
  const canvasControlsRef = useRef<{ autoLayout: () => void; fitView: () => void } | null>(null);

  const handleCanvasReady = useCallback(
    (controls: { autoLayout: () => void; fitView: () => void }) => {
      canvasControlsRef.current = controls;
    },
    [],
  );

  const handleAutoLayout = useCallback(() => {
    canvasControlsRef.current?.autoLayout();
  }, []);

  const handleFitView = useCallback(() => {
    canvasControlsRef.current?.fitView();
  }, []);

  // Save Draft — serialize, validate, call IMPORT_PATHWAY with NEW_PATHWAY
  const handleSaveDraft = useCallback(async () => {
    clearErrors();
    const result = await save(sync.nodes, sync.edges, sync.metadata, 'NEW_PATHWAY');
    if (result.success && result.result?.pathway) {
      sync.markClean();
      router.push(`/pathways/${result.result.pathway.id}`);
    }
  }, [sync, save, clearErrors, router]);

  // Upload — trigger the file picker exposed by UploadHandler
  const handleUpload = useCallback(() => {
    uploadTriggerRef.current?.();
  }, []);

  // Export — serialize to JSON and download
  const handleExport = useCallback(() => {
    const pathwayJson = serializePathway(sync.nodes, sync.edges, sync.metadata);
    const blob = new Blob([JSON.stringify(pathwayJson, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const logicalId = sync.metadata.logical_id?.trim();
    const version = sync.metadata.version?.trim();
    a.download =
      logicalId && version ? `${logicalId}-v${version}.json` : 'untitled-pathway.json';
    a.href = url;
    a.click();
    URL.revokeObjectURL(url);
  }, [sync]);

  // Flatten validationErrors for canvas display
  const canvasValidationErrors = validationErrors.map((e) => ({ message: e.message }));

  // ─── Render ─────────────────────────────────────────────────────────

  const graphView = (
    <PathwayCanvas
      externalNodes={filteredNodes}
      externalEdges={filteredEdges}
      externalSetNodes={sync.setNodes as React.Dispatch<React.SetStateAction<Node[]>>}
      externalSetEdges={sync.setEdges as React.Dispatch<React.SetStateAction<Edge[]>>}
      hideToolbar
      pathwayTitle={sync.metadata.title}
      pathwayVersion={sync.metadata.version}
      isDraft={true}
      isSaving={isSaving}
      validationErrors={canvasValidationErrors}
      onReady={handleCanvasReady}
    />
  );

  const jsonView = (
    <JsonEditor
      value={sync.jsonText}
      onChange={sync.onJsonChange}
      errors={sync.jsonErrors}
    />
  );

  return (
    <div className="h-screen flex flex-col overflow-hidden">
      <EditorToolbar
        canUndo={canUndo}
        canRedo={canRedo}
        onUndo={undo}
        onRedo={redo}
        onAutoLayout={handleAutoLayout}
        onFitView={handleFitView}
        onSaveDraft={handleSaveDraft}
        onUpload={handleUpload}
        onExport={handleExport}
        pathwayTitle={sync.metadata.title}
        pathwayVersion={sync.metadata.version}
        isDraft={true}
        isNewPathway={true}
        isSaving={isSaving}
        editorMode={editorMode}
        onEditorModeChange={setEditorMode}
      />

      <div className="flex-1 min-h-0 overflow-hidden">
        <UploadHandler onFileLoaded={sync.loadJson} triggerRef={uploadTriggerRef}>
          {editorMode === 'graph' ? graphView : jsonView}
        </UploadHandler>
      </div>

      <StatusBar
        jsonErrors={sync.jsonErrors}
        validationResult={sync.validationResult}
        isDirty={sync.isDirty}
      />
    </div>
  );
}
