'use client';

import { useState, useCallback, useRef, useMemo } from 'react';
import { useParams } from 'next/navigation';
import { useQuery, useLazyQuery } from '@apollo/client/react';
import { GET_PATHWAY_GRAPH, GET_PATHWAY_CONFIDENCE } from '@/lib/graphql/queries/pathways';
import type {
  PathwayGraph,
  PathwayConfidenceResult,
  PatientContextInput,
  NodeConfidenceResult,
} from '@/types';
import {
  buildHierarchy,
  countNodeTypes,
  PathwayTopBar,
  PathwayMetaStrip,
  PathwayConditionTray,
  ConfigurePhase,
  SimulatePhase,
  TunePhase,
  PreviewSidebar,
  PreviewBottomBar,
} from '@/components/pathway-preview';
import { SAMPLE_PATIENTS } from '@/components/preview/confidence-utils';
import type { SidebarTab } from '@/components/pathway-preview';

type Mode = 'configure' | 'results';

export default function PathwayPreviewPage() {
  const params = useParams();
  const pathwayId = params.id as string;

  /* ── Theme ──────────────────────────────────────────────── */
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const toggleTheme = useCallback(() => {
    setTheme(t => (t === 'light' ? 'dark' : 'light'));
  }, []);

  /* ── Mode: configure vs results ─────────────────────────── */
  const [mode, setMode] = useState<Mode>('configure');
  const workspaceRef = useRef<HTMLDivElement>(null);

  const goToResults = useCallback(() => {
    setMode('results');
    workspaceRef.current?.scrollTo(0, 0);
  }, []);

  const goToConfigure = useCallback(() => {
    setMode('configure');
    workspaceRef.current?.scrollTo(0, 0);
  }, []);

  /* ── Sidebar ────────────────────────────────────────────── */
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>('context');

  /* ── Patient Context ────────────────────────────────────── */
  const [selectedPreset, setSelectedPreset] = useState('reference');
  const [patientContext, setPatientContext] = useState<PatientContextInput>(
    SAMPLE_PATIENTS.reference.context,
  );

  const handleContextChange = useCallback((context: PatientContextInput) => {
    setPatientContext(context);
  }, []);

  /* ── GraphQL: Pathway Graph ─────────────────────────────── */
  const { data: graphData, loading: graphLoading, error: graphError } = useQuery<{
    pathwayGraph: PathwayGraph;
  }>(GET_PATHWAY_GRAPH, {
    variables: { id: pathwayId },
    skip: !pathwayId,
  });

  const pathway = graphData?.pathwayGraph?.pathway;
  const graphNodes = graphData?.pathwayGraph?.nodes ?? [];
  const graphEdges = graphData?.pathwayGraph?.edges ?? [];
  const conditionCodeDetails = graphData?.pathwayGraph?.conditionCodeDetails ?? [];
  const counts = useMemo(() => countNodeTypes(graphNodes), [graphNodes]);

  /* ── GraphQL: Confidence Simulation ─────────────────────── */
  const [confidenceResult, setConfidenceResult] = useState<PathwayConfidenceResult | null>(null);
  const [simError, setSimError] = useState<string | null>(null);
  const [runSimulation, { loading: simLoading }] = useLazyQuery<{
    pathwayConfidence: PathwayConfidenceResult;
  }>(GET_PATHWAY_CONFIDENCE, {
    fetchPolicy: 'network-only',
  });

  const handleRunSimulation = useCallback(
    async (context: PatientContextInput) => {
      setPatientContext(context);
      setSimError(null);
      try {
        const { data, error } = await runSimulation({
          variables: {
            pathwayId,
            patientContext: context,
          },
        });

        if (error) {
          console.error('[Simulation] GraphQL error:', error.message);
          setSimError(error.message);
          setConfidenceResult(null);
          goToResults();
          return;
        }

        const result = data?.pathwayConfidence ?? null;
        console.log('[Simulation] result:', result);
        if (result) {
          console.log('[Simulation] overallConfidence:', result.overallConfidence);
          console.log('[Simulation] node count:', result.nodes?.length);
          console.log('[Simulation] first 3 nodeIdentifiers:', result.nodes.slice(0, 3).map((n: NodeConfidenceResult) => n.nodeIdentifier));
          console.log('[Simulation] graph node IDs (first 5):', graphNodes.slice(0, 5).map(n => n.id));
        }

        if (!result) {
          setSimError('No confidence data returned from server.');
          setConfidenceResult(null);
        } else {
          setSimError(null);
          setConfidenceResult(result);
        }
        goToResults();
        setSidebarTab('confidence');
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        console.error('[Simulation] Network/unexpected error:', message);
        setSimError(message);
        setConfidenceResult(null);
        goToResults();
      }
    },
    [pathwayId, runSimulation, goToResults, graphNodes],
  );

  /* ── Confidence Map for Hierarchy ───────────────────────── */
  const confidenceMap = useMemo(() => {
    if (!confidenceResult) return undefined;
    const map = new Map<string, NodeConfidenceResult>();

    // Step 1: Key by nodeIdentifier from confidence API
    for (const n of confidenceResult.nodes) {
      map.set(n.nodeIdentifier, n);
    }

    // Step 2: Cross-index via common property names
    const ID_PROPS = ['pathwayNodeId', 'node_id', 'nodeId', 'id', 'identifier', 'logicalId'] as const;
    for (const gn of graphNodes) {
      if (map.has(gn.id)) continue; // Already matched directly
      const props = gn.properties as Record<string, unknown>;
      for (const key of ID_PROPS) {
        const propVal = props[key] as string | undefined;
        if (propVal && map.has(propVal)) {
          map.set(gn.id, map.get(propVal)!);
          break;
        }
      }
    }

    // Step 3: Reverse cross-index — add property IDs pointing to confidence data
    for (const gn of graphNodes) {
      if (!map.has(gn.id)) continue;
      const props = gn.properties as Record<string, unknown>;
      for (const key of ID_PROPS) {
        const propVal = props[key] as string | undefined;
        if (propVal && !map.has(propVal)) {
          map.set(propVal, map.get(gn.id)!);
        }
      }
    }

    // Diagnostic: check how many graph nodes got matched
    let matched = 0;
    for (const gn of graphNodes) {
      if (map.has(gn.id)) matched++;
    }
    console.log(`[ConfidenceMap] ${map.size} entries, ${matched}/${graphNodes.length} graph nodes matched`);
    if (matched === 0 && confidenceResult.nodes.length > 0) {
      console.warn('[ConfidenceMap] No matches! Confidence nodeIdentifiers:', confidenceResult.nodes.slice(0, 5).map(n => n.nodeIdentifier));
      console.warn('[ConfidenceMap] Graph node IDs:', graphNodes.slice(0, 5).map(n => n.id));
      console.warn('[ConfidenceMap] Graph node properties (first):', graphNodes[0]?.properties);
    }

    return map;
  }, [confidenceResult, graphNodes]);

  /* ── Build Hierarchy ────────────────────────────────────── */
  const stages = useMemo(
    () => buildHierarchy(graphNodes, graphEdges, confidenceMap),
    [graphNodes, graphEdges, confidenceMap],
  );

  /* ── Loading / Error States ─────────────────────────────── */
  if (graphLoading) {
    return (
      <div className="enc-root" data-theme={theme} style={{ fontFamily: 'var(--font-manrope)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ textAlign: 'center', color: 'var(--ink-3)' }}>
          <div style={{ fontSize: 16, marginBottom: 8 }}>Loading pathway...</div>
          <div style={{ fontSize: 12 }}>Fetching graph data for {pathwayId}</div>
        </div>
      </div>
    );
  }

  if (graphError || !pathway) {
    return (
      <div className="enc-root" data-theme={theme} style={{ fontFamily: 'var(--font-manrope)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ textAlign: 'center', color: 'var(--danger)' }}>
          <div style={{ fontSize: 16, marginBottom: 8 }}>Failed to load pathway</div>
          <div style={{ fontSize: 12, color: 'var(--ink-3)' }}>
            {graphError?.message ?? 'Pathway not found'}
          </div>
        </div>
      </div>
    );
  }

  /* ── Render ─────────────────────────────────────────────── */
  return (
    <div className="enc-root" data-theme={theme} style={{ fontFamily: 'var(--font-manrope)' }}>
      <PathwayTopBar
        title={pathway.title}
        version={pathway.version}
        status={pathway.status}
        onToggleTheme={toggleTheme}
      />

      <PathwayMetaStrip
        category={pathway.category}
        scope={pathway.scope}
        targetPopulation={pathway.targetPopulation}
        nodeCount={counts.total}
        stageCount={counts.stages}
        stepCount={counts.steps}
        conditionCount={counts.conditions}
      />

      <PathwayConditionTray conditions={conditionCodeDetails} />

      <div className="enc-main-grid">
        <div className="enc-workspace" ref={workspaceRef}>
          <div style={{ display: mode === 'configure' ? undefined : 'none' }}>
            <div className="enc-phase-content">
              <ConfigurePhase
                onContextChange={handleContextChange}
                selectedPreset={selectedPreset}
                onPresetChange={setSelectedPreset}
              />
              <div style={{ marginTop: 24 }}>
                <TunePhase
                  pathwayId={pathwayId}
                  nodes={graphNodes}
                  edges={graphEdges}
                />
              </div>
            </div>
          </div>
          <div style={{ display: mode === 'results' ? undefined : 'none' }}>
            <SimulatePhase
              stages={stages}
              overallConfidence={confidenceResult?.overallConfidence ?? null}
              nodeCount={counts.total}
              scoredNodeCount={confidenceResult?.nodes.length ?? 0}
              error={simError}
              confidenceNodes={confidenceResult?.nodes}
            />
          </div>
        </div>

        <PreviewSidebar
          activeTab={sidebarTab}
          onTabChange={setSidebarTab}
          patientContext={patientContext}
          selectedPreset={selectedPreset}
          simulationRunning={simLoading}
          confidenceResult={confidenceResult}
          nodes={graphNodes}
          edges={graphEdges}
          pathwayId={pathwayId}
        />
      </div>

      <PreviewBottomBar
        mode={mode}
        nodeCount={counts.total}
        confidenceResult={confidenceResult}
        onBackToConfigure={goToConfigure}
        onRunSimulation={() => handleRunSimulation(patientContext)}
        isLoading={simLoading}
      />
    </div>
  );
}
