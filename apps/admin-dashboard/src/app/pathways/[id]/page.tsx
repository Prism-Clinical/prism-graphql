'use client';

import { use, useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { useQuery, useMutation } from '@apollo/client/react';
import { useRouter } from 'next/navigation';
import type { Node, Edge } from '@xyflow/react';
import { GET_PATHWAY_GRAPH, GET_ADMIN_EVIDENCE } from '@/lib/graphql/queries/pathways';
import { EvidenceStatusProvider } from '@/components/graph/EvidenceStatusContext';
import {
  IMPORT_PATHWAY,
  ACTIVATE_PATHWAY,
  ARCHIVE_PATHWAY,
  REACTIVATE_PATHWAY,
} from '@/lib/graphql/mutations/pathways';
import { deserializePathway } from '@/lib/pathway-json/deserializer';
import { serializePathway } from '@/lib/pathway-json/serializer';
import { validatePathwayJson } from '@/lib/pathway-json/validator';
import { applyAutoLayout } from '@/components/graph/AutoLayout';
import { PathwayCanvas } from '@/components/graph/PathwayCanvas';
import { EditorToolbar, type EditorMode } from '@/components/editor/EditorToolbar';
import { JsonEditor } from '@/components/editor/JsonEditor';
import { StatusBar } from '@/components/editor/StatusBar';
import { UploadHandler } from '@/components/editor/UploadHandler';
import { DiffReviewModal } from '@/components/editor/DiffReviewModal';
import { QuickAddEvidenceModal } from '@/components/editor/QuickAddEvidenceModal';
import { PathwayNavigator } from '@/components/editor/PathwayNavigator';
import { useJsonGraphSync } from '@/lib/hooks/useJsonGraphSync';
import { useSubtreeFilter } from '@/lib/hooks/useSubtreeFilter';
import { useUndoRedo } from '@/lib/hooks/useUndoRedo';
import { useAutosave } from '@/lib/hooks/useAutosave';
import { Spinner } from '@/components/ui/Spinner';
import type { PathwayGraph, PathwayMetadata, ImportPathwayResult, PathwayNodeData, PathwayEdgeData, AdminEvidenceEntry } from '@/types';

// ─── Types ──────────────────────────────────────────────────────────

interface CanvasControls {
  autoLayout: () => void;
  fitView: () => void;
}

// ─── Inner component (receives resolved data) ────────────────────────

interface EditorInnerProps {
  data: { pathwayGraph: PathwayGraph };
  refetch: () => void;
}

function EditorInner({ data, refetch }: EditorInnerProps) {
  const router = useRouter();

  const pathway = data.pathwayGraph.pathway;
  const conditionCodeDetails = data.pathwayGraph.conditionCodeDetails ?? [];

  // Fetch evidence entries for the pathway to show status indicators on nodes
  const { data: evidenceData, refetch: refetchEvidence } = useQuery<{ adminEvidenceEntries: AdminEvidenceEntry[] }>(
    GET_ADMIN_EVIDENCE,
    { variables: { pathwayId: pathway.id } },
  );

  // Quick-add evidence modal state
  const [quickAddTarget, setQuickAddTarget] = useState<{ nodeIdentifier: string; nodeLabel: string } | null>(null);
  const handleOpenQuickAdd = useCallback(
    (nodeIdentifier: string, nodeLabel: string) => setQuickAddTarget({ nodeIdentifier, nodeLabel }),
    [],
  );

  // Deserialize + layout once when data arrives
  const { initialNodes, initialEdges } = useMemo(() => {
    const { nodes, edges } = deserializePathway(data.pathwayGraph);
    const layoutedNodes = applyAutoLayout(nodes, edges) as Node<PathwayNodeData>[];
    return { initialNodes: layoutedNodes, initialEdges: edges as Edge<PathwayEdgeData>[] };
  }, [data]);

  // Build metadata for serializer from the pathway record + full condition code details
  const initialMetadata: PathwayMetadata = useMemo(
    () => ({
      logical_id: pathway.logicalId,
      title: pathway.title,
      version: pathway.version,
      category: pathway.category,
      scope: pathway.scope ?? undefined,
      target_population: pathway.targetPopulation ?? undefined,
      condition_codes: conditionCodeDetails,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const isReadOnly = pathway.status !== 'DRAFT';
  const isDraft = pathway.status === 'DRAFT';
  const isActive = pathway.status === 'ACTIVE';
  const isArchived = pathway.status === 'ARCHIVED';

  // ─── Sync hook ───────────────────────────────────────────────────────

  const sync = useJsonGraphSync({
    initialNodes,
    initialEdges,
    initialMetadata,
    readOnly: isReadOnly,
  });

  // ─── Undo/redo ───────────────────────────────────────────────────────

  const { undo, redo, canUndo, canRedo } = useUndoRedo(
    sync.nodes as Node[],
    sync.edges as Edge[],
    sync.setNodes as (nodes: Node[]) => void,
    sync.setEdges as (edges: Edge[]) => void,
  );

  // ─── Editor mode toggle + scope ─────────────────────────────────────

  const [editorMode, setEditorMode] = useState<EditorMode>('graph');
  const [scopeNodeId, setScopeNodeId] = useState<string | null>(null);
  const [navCollapsed, setNavCollapsed] = useState(false);

  // Filter nodes/edges to the scoped subtree for the graph view
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

  // ─── Upload trigger ref ────────────────────────────────────────────────

  const uploadTriggerRef = useRef<(() => void) | null>(null);

  // ─── Canvas controls (auto layout, fit view) ─────────────────────────

  const canvasControlsRef = useRef<CanvasControls | null>(null);

  const handleCanvasReady = useCallback((controls: CanvasControls) => {
    canvasControlsRef.current = controls;
  }, []);

  const handleAutoLayout = useCallback(() => {
    canvasControlsRef.current?.autoLayout();
  }, []);

  const handleFitView = useCallback(() => {
    canvasControlsRef.current?.fitView();
  }, []);

  // ─── Mutations ────────────────────────────────────────────────────────

  const [importPathway, { loading: isImporting }] = useMutation<{ importPathway: ImportPathwayResult }>(IMPORT_PATHWAY);
  const [activatePathway] = useMutation(ACTIVATE_PATHWAY);
  const [archivePathway, { loading: isArchiving }] = useMutation(ARCHIVE_PATHWAY);
  const [reactivatePathway, { loading: isReactivating }] = useMutation(REACTIVATE_PATHWAY);

  const isSaving = isImporting || isArchiving || isReactivating;

  // ─── Publish result (for DiffReviewModal) ────────────────────────────

  const [publishResult, setPublishResult] = useState<ImportPathwayResult | null>(null);
  const [isActivating, setIsActivating] = useState(false);

  // ─── Save (shared by autosave + manual) ────────────────────────────

  // Use refs so performSave is stable and always reads latest state
  const syncRef = useRef(sync);
  syncRef.current = sync;
  const refetchRef = useRef(refetch);
  refetchRef.current = refetch;

  const performSave = useCallback(async ({ shouldRefetch = false } = {}) => {
    const { nodes: currentNodes, edges: currentEdges, metadata: currentMetadata, markClean } = syncRef.current;
    const serialized = serializePathway(currentNodes as Node[], currentEdges as Edge[], currentMetadata);

    const { data: result } = await importPathway({
      variables: { pathwayJson: JSON.stringify(serialized), importMode: 'DRAFT_UPDATE' },
    });

    // Only mark clean if the server accepted the save
    if (!result?.importPathway?.pathway) {
      const serverErrors = result?.importPathway?.validation?.errors ?? [];
      console.warn('[performSave] Server rejected save:', serverErrors);
      throw new Error(serverErrors[0] || 'Save rejected by server');
    }

    markClean();
    if (shouldRefetch) refetchRef.current();
  }, [importPathway]);

  // ─── Autosave ──────────────────────────────────────────────────────

  const { saveStatus } = useAutosave({
    isDirty: sync.isDirty,
    isValid: sync.jsonErrors.length === 0,
    enabled: isDraft,
    onSave: () => performSave(),
    debounceMs: 2000,
  });

  // ─── Publish (New Version) ────────────────────────────────────────────

  const handlePublish = useCallback(async () => {
    const serialized = serializePathway(sync.nodes as Node[], sync.edges as Edge[], sync.metadata);
    const validationResult = validatePathwayJson(serialized);

    if (!validationResult.valid) {
      return;
    }

    try {
      const { data: mutationData } = await importPathway({
        variables: { pathwayJson: JSON.stringify(serialized), importMode: 'DRAFT_UPDATE' },
      });

      if (mutationData?.importPathway) {
        setPublishResult(mutationData.importPathway as ImportPathwayResult);
      }
    } catch (err) {
      console.error('Publish failed', err);
    }
  }, [sync, importPathway]);

  // ─── DiffReviewModal: Activate ────────────────────────────────────────

  const handleActivate = useCallback(async () => {
    if (!publishResult?.pathway) return;
    setIsActivating(true);
    try {
      await activatePathway({ variables: { id: publishResult.pathway.id } });
      router.push(`/pathways/${publishResult.pathway.id}`);
    } catch (err) {
      console.error('Activate failed', err);
    } finally {
      setIsActivating(false);
    }
  }, [publishResult, activatePathway, router]);

  // ─── DiffReviewModal: Keep as Draft ──────────────────────────────────

  const handleKeepDraft = useCallback(() => {
    if (!publishResult?.pathway) return;
    const newId = publishResult.pathway.id;
    setPublishResult(null);
    router.push(`/pathways/${newId}`);
  }, [publishResult, router]);

  // ─── Export ───────────────────────────────────────────────────────────

  const handleExport = useCallback(() => {
    const serialized = serializePathway(sync.nodes as Node[], sync.edges as Edge[], sync.metadata);
    const json = JSON.stringify(serialized, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const logicalId = sync.metadata.logical_id || 'untitled-pathway';
    const filename = `${logicalId}-v${sync.metadata.version}.json`;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }, [sync]);

  // ─── Upload ───────────────────────────────────────────────────────────

  const handleUpload = useCallback(() => {
    uploadTriggerRef.current?.();
  }, []);

  // ─── Create New Version (ACTIVE only) ────────────────────────────────

  const handleCreateNewVersion = useCallback(async () => {
    const serialized = serializePathway(sync.nodes as Node[], sync.edges as Edge[], sync.metadata);

    try {
      const { data: mutationData } = await importPathway({
        variables: { pathwayJson: JSON.stringify(serialized), importMode: 'NEW_VERSION' },
      });

      const newPathwayId = mutationData?.importPathway?.pathway?.id;
      if (newPathwayId) {
        router.push(`/pathways/${newPathwayId}`);
      }
    } catch (err) {
      console.error('Create new version failed', err);
    }
  }, [sync, importPathway, router]);

  // ─── Archive (ACTIVE only) ────────────────────────────────────────────

  const handleArchive = useCallback(async () => {
    const confirmed = window.confirm(
      `Archive "${pathway.title}"? This pathway will no longer be active.`,
    );
    if (!confirmed) return;

    try {
      await archivePathway({ variables: { id: pathway.id } });
      refetch();
    } catch (err) {
      console.error('Archive failed', err);
    }
  }, [pathway, archivePathway, refetch]);

  // ─── Reactivate (ARCHIVED only) ───────────────────────────────────────

  const handleReactivate = useCallback(async () => {
    const confirmed = window.confirm(
      `Reactivate "${pathway.title}"? This will make it the active pathway version.`,
    );
    if (!confirmed) return;

    try {
      await reactivatePathway({ variables: { id: pathway.id } });
      refetch();
    } catch (err) {
      console.error('Reactivate failed', err);
    }
  }, [pathway, reactivatePathway, refetch]);

  return (
    <EvidenceStatusProvider entries={evidenceData?.adminEvidenceEntries ?? []} onQuickAddEvidence={handleOpenQuickAdd}>
    <div className="h-screen flex flex-col overflow-hidden">
      {/* Read-only banner for ACTIVE pathways */}
      {isActive && (
        <div className="bg-blue-50 border-b border-blue-200 px-4 py-2 flex-shrink-0">
          <p className="text-sm text-blue-700">
            This pathway is active. Create a new version to make changes.
          </p>
        </div>
      )}

      {/* Toolbar */}
      <EditorToolbar
        canUndo={canUndo}
        canRedo={canRedo}
        onUndo={undo}
        onRedo={redo}
        onAutoLayout={handleAutoLayout}
        onFitView={handleFitView}
        onPublish={isDraft ? handlePublish : undefined}
        onUpload={!isReadOnly ? handleUpload : undefined}
        onExport={handleExport}
        onCreateNewVersion={isActive ? handleCreateNewVersion : undefined}
        onArchive={isActive ? handleArchive : undefined}
        onReactivate={isArchived ? handleReactivate : undefined}
        pathwayTitle={pathway.title}
        pathwayVersion={pathway.version}
        isDraft={isDraft}
        pathwayStatus={pathway.status}
        pathwayId={pathway.id}
        isSaving={isSaving}
        editorMode={editorMode}
        onEditorModeChange={setEditorMode}
      />

      {/* Main content: toggle between Graph and JSON views */}
      <div className="flex-1 overflow-hidden">
        <UploadHandler onFileLoaded={sync.loadJson} disabled={isReadOnly} triggerRef={uploadTriggerRef}>
          {editorMode === 'graph' ? (
            <div className="flex h-full">
              <PathwayNavigator
                nodes={sync.nodes as Node[]}
                edges={sync.edges as Edge[]}
                activeScopeId={scopeNodeId}
                onScopeChange={setScopeNodeId}
                readOnly={isReadOnly}
                isCollapsed={navCollapsed}
                onToggleCollapse={() => setNavCollapsed(c => !c)}
              />
              <div className="flex-1 overflow-hidden">
                <PathwayCanvas
                  externalNodes={filteredNodes}
                  externalEdges={filteredEdges}
                  externalSetNodes={sync.setNodes as React.Dispatch<React.SetStateAction<Node[]>>}
                  externalSetEdges={sync.setEdges as React.Dispatch<React.SetStateAction<Edge[]>>}
                  readOnly={isReadOnly}
                  hideToolbar
                  hideNodePalette
                  onReady={handleCanvasReady}
                  scopeKey={scopeNodeId}
                />
              </div>
            </div>
          ) : (
            <JsonEditor
              value={sync.jsonText}
              onChange={sync.onJsonChange}
              errors={sync.jsonErrors}
              readOnly={isReadOnly}
            />
          )}
        </UploadHandler>
      </div>

      {/* Status bar */}
      <StatusBar
        pathwayStatus={pathway.status}
        jsonErrors={sync.jsonErrors}
        validationResult={sync.validationResult}
        isDirty={sync.isDirty}
        saveStatus={saveStatus}
      />

      {/* Diff review modal (publish flow) */}
      {publishResult && (
        <DiffReviewModal
          result={publishResult}
          oldVersion={pathway.version}
          onActivate={handleActivate}
          onKeepDraft={handleKeepDraft}
          isActivating={isActivating}
        />
      )}

      {/* Quick-add evidence modal */}
      {quickAddTarget && (
        <QuickAddEvidenceModal
          pathwayId={pathway.id}
          nodeIdentifier={quickAddTarget.nodeIdentifier}
          nodeLabel={quickAddTarget.nodeLabel}
          nodes={sync.nodes as Node[]}
          edges={sync.edges as Edge[]}
          onClose={() => setQuickAddTarget(null)}
          onSuccess={() => refetchEvidence()}
        />
      )}
    </div>
    </EvidenceStatusProvider>
  );
}

// ─── Page component ──────────────────────────────────────────────────

export default function PathwayEditorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);

  const { data, loading, error, refetch } = useQuery<{ pathwayGraph: PathwayGraph | null }>(
    GET_PATHWAY_GRAPH,
    { variables: { id } },
  );

  // Loading state
  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <Spinner size="lg" />
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="p-8">
        <div className="bg-red-50 border border-red-200 rounded-xl p-4">
          <p className="text-sm text-red-700">Failed to load pathway: {error.message}</p>
          <button
            onClick={() => window.location.reload()}
            className="mt-2 text-sm text-red-600 underline hover:text-red-800"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  // Not found state
  if (!data?.pathwayGraph?.pathway) {
    return (
      <div className="p-8">
        <div className="bg-gray-50 border border-gray-200 rounded-xl p-4">
          <p className="text-sm text-gray-700">Pathway not found.</p>
          <a href="/" className="mt-2 text-sm text-blue-600 underline hover:text-blue-800">
            Back to dashboard
          </a>
        </div>
      </div>
    );
  }

  return (
    <EditorInner
      data={data as { pathwayGraph: PathwayGraph }}
      refetch={refetch}
    />
  );
}
