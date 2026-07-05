'use client';

import { useMemo } from 'react';
import type {
  PatientContextInput,
  PathwayConfidenceResult,
  PathwayGraphNode,
  PathwayGraphEdge,
  ResolutionType,
  MergedCarePlan,
} from '@/types';
import type { SidebarTab } from './types';
import {
  confidenceCssColor,
  confidenceCssBg,
  resolutionCssColor,
  resolutionCssBg,
  resolutionLabel,
} from './confidence-theme';
import { SAMPLE_PATIENTS } from '@/components/preview/confidence-utils';

interface PreviewSidebarProps {
  activeTab: SidebarTab;
  onTabChange: (tab: SidebarTab) => void;
  patientContext: PatientContextInput | null;
  selectedPreset: string;
  simulationRunning: boolean;
  confidenceResult: PathwayConfidenceResult | null;
  nodes: PathwayGraphNode[];
  edges: PathwayGraphEdge[];
  pathwayId: string;
  /**
   * Slice B: merged-plan preview surfaces alongside the confidence sim.
   * `null` before the first run; populated after a successful preview
   * resolution. `previewSessionId` is the server-side session UUID
   * (isPreview=true) whose lifecycle is managed by usePreviewMergedPlan.
   */
  previewSessionId?: string | null;
  previewMergedPlan?: MergedCarePlan | null;
  previewMergedPlanError?: string | null;
}

export default function PreviewSidebar({
  activeTab,
  onTabChange,
  patientContext,
  selectedPreset,
  simulationRunning,
  confidenceResult,
  nodes,
  previewSessionId = null,
  previewMergedPlan = null,
  previewMergedPlanError = null,
}: PreviewSidebarProps) {
  return (
    <div className="enc-copilot">
      {/* Header with tabs */}
      <div className="enc-copilot-head" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 0, padding: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 18px' }}>
          <div className="enc-copilot-icon">P</div>
          <div>
            <div className="enc-copilot-title">Preview Panel</div>
            <div className="enc-copilot-sub">Pathway analysis</div>
          </div>
          {simulationRunning && (
            <div className="enc-copilot-status">
              <div className="enc-copilot-status-dot" />
              Running
            </div>
          )}
        </div>
        <div className="enc-sidebar-tabs">
          <TabButton label="Context" tab="context" activeTab={activeTab} onClick={onTabChange} />
          <TabButton label="Confidence" tab="confidence" activeTab={activeTab} onClick={onTabChange} />
          <TabButton label="Evidence" tab="evidence" activeTab={activeTab} onClick={onTabChange} />
        </div>
      </div>

      {/* Tab body */}
      <div className="enc-copilot-body">
        {activeTab === 'context' && (
          <ContextTab
            patientContext={patientContext}
            selectedPreset={selectedPreset}
            simulationRunning={simulationRunning}
            previewSessionId={previewSessionId}
            previewMergedPlan={previewMergedPlan}
            previewMergedPlanError={previewMergedPlanError}
          />
        )}
        {activeTab === 'confidence' && (
          <ConfidenceTab confidenceResult={confidenceResult} />
        )}
        {activeTab === 'evidence' && (
          <EvidenceTab confidenceResult={confidenceResult} nodes={nodes} />
        )}
      </div>
    </div>
  );
}

// ─── Tab Button ───────────────────────────────────────────────────────

function TabButton({
  label,
  tab,
  activeTab,
  onClick,
}: {
  label: string;
  tab: SidebarTab;
  activeTab: SidebarTab;
  onClick: (tab: SidebarTab) => void;
}) {
  const isActive = tab === activeTab;
  return (
    <button
      className={`enc-sidebar-tab ${isActive ? 'active' : ''}`}
      style={{ fontFamily: 'var(--font-manrope)' }}
      onClick={() => onClick(tab)}
    >
      {label}
    </button>
  );
}

// ─── Context Tab ─────────────────────────────────────────────────────

function ContextTab({
  patientContext,
  selectedPreset,
  simulationRunning,
  previewSessionId,
  previewMergedPlan,
  previewMergedPlanError,
}: {
  patientContext: PatientContextInput | null;
  selectedPreset: string;
  simulationRunning: boolean;
  previewSessionId: string | null;
  previewMergedPlan: MergedCarePlan | null;
  previewMergedPlanError: string | null;
}) {
  const presetLabel = SAMPLE_PATIENTS[selectedPreset]?.label ?? 'Custom';

  return (
    <>
      {/* Simulation status */}
      <div className={`enc-copilot-section ${simulationRunning ? '' : 'govern'}`}>
        <div className="enc-cp-h" style={{ color: simulationRunning ? 'var(--ai)' : 'var(--brand)' }}>
          Simulation Status
        </div>
        <div className="enc-cp-msg">
          {simulationRunning ? (
            <em>Running confidence simulation...</em>
          ) : patientContext ? (
            <>Simulation complete for <strong>{presetLabel}</strong></>
          ) : (
            <>No simulation run yet. Configure a patient context and run simulation.</>
          )}
        </div>
      </div>

      {/* Merged Plan Preview — slice B minimum: a compact readout so the
          full resolver → merge pipeline is verifiably alive alongside the
          confidence sim. Chips + lineage panels ship in slices C / D. */}
      <MergedPlanPreviewSection
        sessionId={previewSessionId}
        mergedPlan={previewMergedPlan}
        error={previewMergedPlanError}
        running={simulationRunning}
      />

      {/* Patient summary */}
      {patientContext && (
        <div className="enc-copilot-section govern">
          <div className="enc-cp-h" style={{ color: 'var(--brand)' }}>
            Patient Summary
          </div>
          <div className="enc-cp-rows">
            <div className="enc-cp-row">
              <span>Patient ID</span>
              <strong style={{ fontFamily: 'var(--font-jetbrains)', fontSize: 10 }}>
                {patientContext.patientId}
              </strong>
            </div>
            <div className="enc-cp-row">
              <span>Conditions</span>
              <strong>{patientContext.conditionCodes.length}</strong>
            </div>
            <div className="enc-cp-row">
              <span>Medications</span>
              <strong>{patientContext.medications.length}</strong>
            </div>
            <div className="enc-cp-row">
              <span>Lab Results</span>
              <strong>{patientContext.labResults.length}</strong>
            </div>
            <div className="enc-cp-row">
              <span>Allergies</span>
              <strong>{patientContext.allergies.length}</strong>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ─── Merged Plan Preview (slice B) ───────────────────────────────────

function MergedPlanPreviewSection({
  sessionId,
  mergedPlan,
  error,
  running,
}: {
  sessionId: string | null;
  mergedPlan: MergedCarePlan | null;
  error: string | null;
  running: boolean;
}) {
  if (error) {
    return (
      <div className="enc-copilot-section">
        <div className="enc-cp-h" style={{ color: 'var(--danger)' }}>
          Merged Plan Preview
        </div>
        <div className="enc-cp-msg" style={{ color: 'var(--danger)' }}>
          {error}
        </div>
      </div>
    );
  }
  if (!mergedPlan) {
    return (
      <div className="enc-copilot-section govern">
        <div className="enc-cp-h" style={{ color: 'var(--brand)' }}>
          Merged Plan Preview
        </div>
        <div className="enc-cp-msg">
          {running
            ? <em>Resolving merged plan…</em>
            : <>Run a simulation to see the merged care plan.</>}
        </div>
      </div>
    );
  }

  const recCount =
    mergedPlan.medications.length +
    mergedPlan.labs.length +
    mergedPlan.imaging.length +
    mergedPlan.procedures.length +
    mergedPlan.guidance.length +
    mergedPlan.schedules.length +
    mergedPlan.qualityMetrics.length;
  const unresolvedConflicts = mergedPlan.conflicts.filter((c) => c.resolution == null).length;

  return (
    <div className="enc-copilot-section govern">
      <div className="enc-cp-h" style={{ color: 'var(--brand)' }}>
        Merged Plan Preview
      </div>
      <div className="enc-cp-rows">
        <div className="enc-cp-row">
          <span>Session ID</span>
          <strong
            style={{ fontFamily: 'var(--font-jetbrains)', fontSize: 10 }}
            title={sessionId ?? undefined}
          >
            {sessionId ? sessionId.slice(0, 8) : '—'}
          </strong>
        </div>
        <div className="enc-cp-row">
          <span>Contributing pathways</span>
          <strong>{mergedPlan.sourcePathwayIds.length}</strong>
        </div>
        <div className="enc-cp-row">
          <span>Recommendations</span>
          <strong>{recCount}</strong>
        </div>
        <div className="enc-cp-row">
          <span>Suppressed</span>
          <strong>{mergedPlan.suppressed.length}</strong>
        </div>
        <div className="enc-cp-row">
          <span>Unresolved conflicts</span>
          <strong style={{ color: unresolvedConflicts > 0 ? 'var(--danger)' : undefined }}>
            {unresolvedConflicts}
          </strong>
        </div>
        <div className="enc-cp-row">
          <span>Catch-up items</span>
          <strong>{mergedPlan.catchUpItems.length}</strong>
        </div>
      </div>
    </div>
  );
}

// ─── Confidence Tab ──────────────────────────────────────────────────

function ConfidenceTab({
  confidenceResult,
}: {
  confidenceResult: PathwayConfidenceResult | null;
}) {
  const distribution = useMemo(() => {
    if (!confidenceResult) return null;
    const counts: Record<ResolutionType, number> = {
      AUTO_RESOLVED: 0,
      SYSTEM_SUGGESTED: 0,
      PROVIDER_DECIDED: 0,
      FORCED_MANUAL: 0,
    };
    for (const n of confidenceResult.nodes) {
      if (n.resolutionType in counts) {
        counts[n.resolutionType as ResolutionType]++;
      }
    }
    return counts;
  }, [confidenceResult]);

  if (!confidenceResult) {
    return (
      <div className="enc-copilot-section govern">
        <div className="enc-cp-h" style={{ color: 'var(--brand)' }}>Confidence</div>
        <div className="enc-cp-msg">Run a simulation first to see confidence results.</div>
      </div>
    );
  }

  const pct = Math.round(confidenceResult.overallConfidence * 100);

  return (
    <>
      {/* Overall confidence */}
      <div className="enc-copilot-section">
        <div className="enc-cp-h">Overall Confidence</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
          <span
            style={{
              fontSize: 28,
              fontWeight: 600,
              color: confidenceCssColor(confidenceResult.overallConfidence),
              fontFamily: 'var(--font-newsreader)',
            }}
          >
            {pct}%
          </span>
          <div style={{ flex: 1 }}>
            <div className="enc-confidence-bar">
              <div
                className="enc-confidence-bar-fill"
                style={{
                  width: `${pct}%`,
                  background: confidenceCssColor(confidenceResult.overallConfidence),
                }}
              />
            </div>
          </div>
        </div>
        <div className="enc-cp-msg">
          {confidenceResult.nodes.length} nodes scored
        </div>
      </div>

      {/* Resolution distribution */}
      {distribution && (
        <div className="enc-copilot-section govern">
          <div className="enc-cp-h" style={{ color: 'var(--brand)' }}>Resolution Distribution</div>
          <div className="enc-cp-rows">
            {(Object.entries(distribution) as [ResolutionType, number][]).map(([type, count]) => (
              <div key={type} className="enc-cp-row">
                <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: '50%',
                      background: resolutionCssColor(type),
                      flexShrink: 0,
                    }}
                  />
                  {resolutionLabel(type)}
                </span>
                <strong>{count}</strong>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Low-confidence nodes */}
      {confidenceResult.nodes.filter(n => n.confidence < 0.60).length > 0 && (
        <div className="enc-copilot-section pref">
          <div className="enc-cp-h" style={{ color: 'var(--accent)' }}>Needs Attention</div>
          <div className="enc-cp-pref-rows">
            {confidenceResult.nodes
              .filter(n => n.confidence < 0.60)
              .sort((a, b) => a.confidence - b.confidence)
              .slice(0, 8)
              .map(n => (
                <div key={n.nodeIdentifier} className="enc-cp-pref-row">
                  <span
                    className="enc-cp-pref-lbl-dot"
                    style={{ background: confidenceCssColor(n.confidence) }}
                  />
                  <span style={{ flex: 1, fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {n.nodeIdentifier}
                  </span>
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 600,
                      color: confidenceCssColor(n.confidence),
                      fontFamily: 'var(--font-jetbrains)',
                    }}
                  >
                    {Math.round(n.confidence * 100)}%
                  </span>
                </div>
              ))
            }
          </div>
        </div>
      )}
    </>
  );
}

// ─── Evidence Tab ────────────────────────────────────────────────────

function EvidenceTab({
  confidenceResult,
  nodes,
}: {
  confidenceResult: PathwayConfidenceResult | null;
  nodes: PathwayGraphNode[];
}) {
  // Build node label lookup
  const labelMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const n of nodes) {
      const props = n.properties as Record<string, unknown>;
      map.set(n.id, String(props.title ?? props.name ?? props.description ?? n.id));
    }
    return map;
  }, [nodes]);

  // Find nodes needing evidence
  const needsEvidence = useMemo(() => {
    if (!confidenceResult) return [];
    return confidenceResult.nodes
      .map(n => {
        const evSignal = n.breakdown.find(s => s.signalName === 'evidence_strength');
        return { ...n, evidenceScore: evSignal?.score ?? 1 };
      })
      .filter(n => n.evidenceScore < 0.60)
      .sort((a, b) => a.evidenceScore - b.evidenceScore);
  }, [confidenceResult]);

  if (!confidenceResult) {
    return (
      <div className="enc-copilot-section govern">
        <div className="enc-cp-h" style={{ color: 'var(--brand)' }}>Evidence</div>
        <div className="enc-cp-msg">Run a simulation first to see evidence needs.</div>
      </div>
    );
  }

  return (
    <>
      <div className="enc-copilot-section">
        <div className="enc-cp-h">Evidence Overview</div>
        <div className="enc-cp-msg">
          <strong>{needsEvidence.length}</strong> nodes need stronger evidence
        </div>
      </div>

      {needsEvidence.length > 0 && (
        <div className="enc-copilot-section govern">
          <div className="enc-cp-h" style={{ color: 'var(--brand)' }}>Per-Node Evidence Gaps</div>
          <div className="enc-cp-pref-rows">
            {needsEvidence.slice(0, 12).map(n => (
              <div key={n.nodeIdentifier} className="enc-cp-pref-row">
                <span
                  className="enc-cp-pref-lbl-dot"
                  style={{ background: confidenceCssColor(n.evidenceScore) }}
                />
                <span style={{ flex: 1, fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {labelMap.get(n.nodeIdentifier) ?? n.nodeIdentifier}
                </span>
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 600,
                    color: confidenceCssColor(n.evidenceScore),
                    fontFamily: 'var(--font-jetbrains)',
                  }}
                >
                  {Math.round(n.evidenceScore * 100)}%
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
