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
          <TabButton label="Lineage" tab="lineage" activeTab={activeTab} onClick={onTabChange} />
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
        {activeTab === 'lineage' && (
          <LineageTab
            mergedPlan={previewMergedPlan}
            simulationRunning={simulationRunning}
            error={previewMergedPlanError}
          />
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

// ─── Lineage Tab (slice D) ───────────────────────────────────────────
//
// Renders the merged-plan lineage returned by the resolver:
//   - Evidence Trail — every Gate/DP the resolver evaluated, sorted so
//     satisfied gates come first, pending/unknown next, then gated-out
//     (i.e. "what closed off a branch") last.
//   - Data Gaps — only the gates that gated a branch out AND cascade
//     into at least one Resolved* rec. Each row surfaces "add these
//     patient fields → unlock N recs" so the provider can see exactly
//     what data would broaden the plan.
//
// Evidence Trail and Data Gaps are two views of the same underlying
// state (both come from `MergedCarePlan.evidenceTrail` +
// `dataGapHints`), presented at different levels of aggregation.

type GateStatus =
  | 'SATISFIED'
  | 'PENDING_QUESTION'
  | 'UNKNOWN'
  | 'GATED_OUT'
  | 'EXCLUDED';

// Ordering used to sort the evidence trail rows top → bottom.
const STATUS_ORDER: Record<GateStatus, number> = {
  SATISFIED: 0,
  PENDING_QUESTION: 1,
  UNKNOWN: 2,
  GATED_OUT: 3,
  EXCLUDED: 4,
};

function LineageTab({
  mergedPlan,
  simulationRunning,
  error,
}: {
  mergedPlan: MergedCarePlan | null;
  simulationRunning: boolean;
  error: string | null;
}) {
  const sortedTrail = useMemo(() => {
    if (!mergedPlan) return [];
    const trail = [...mergedPlan.evidenceTrail];
    trail.sort((a, b) => {
      const sa = STATUS_ORDER[a.status as GateStatus] ?? 99;
      const sb = STATUS_ORDER[b.status as GateStatus] ?? 99;
      if (sa !== sb) return sa - sb;
      return a.title.localeCompare(b.title);
    });
    return trail;
  }, [mergedPlan]);

  const dataGaps = mergedPlan?.dataGapHints ?? [];

  if (error) {
    return (
      <div className="enc-copilot-section">
        <div className="enc-cp-h" style={{ color: 'var(--danger)' }}>Lineage</div>
        <div className="enc-cp-msg" style={{ color: 'var(--danger)' }}>{error}</div>
      </div>
    );
  }
  if (!mergedPlan) {
    return (
      <div className="enc-copilot-section govern">
        <div className="enc-cp-h" style={{ color: 'var(--brand)' }}>Lineage</div>
        <div className="enc-cp-msg">
          {simulationRunning
            ? <em>Resolving merged plan…</em>
            : <>Run a simulation to see how gates and data drove the plan.</>}
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="enc-copilot-section">
        <div className="enc-cp-h">Evidence Trail</div>
        <div className="enc-cp-msg">
          <strong>{sortedTrail.length}</strong> gate{sortedTrail.length === 1 ? '' : 's'} evaluated across contributing pathways
        </div>
      </div>

      {sortedTrail.length > 0 && (
        <div className="enc-copilot-section govern" style={{ paddingTop: 8 }}>
          <div className="enc-cp-pref-rows">
            {sortedTrail.slice(0, 40).map((g, i) => (
              <GateEvidenceRow key={`${g.nodeId}-${i}`} gate={g} />
            ))}
            {sortedTrail.length > 40 && (
              <div style={{ fontSize: 10, color: 'var(--ink-3)', textAlign: 'center', padding: '4px 0' }}>
                + {sortedTrail.length - 40} more
              </div>
            )}
          </div>
        </div>
      )}

      <div className="enc-copilot-section">
        <div className="enc-cp-h">Data Gaps</div>
        <div className="enc-cp-msg">
          {dataGaps.length === 0
            ? <>No data gaps — every gate that fired had the inputs it needed.</>
            : <><strong>{dataGaps.length}</strong> gap{dataGaps.length === 1 ? '' : 's'} could unlock more recommendations if resolved.</>}
        </div>
      </div>

      {dataGaps.map((hint, i) => (
        <DataGapCard key={`${hint.gateNodeId}-${i}`} hint={hint} />
      ))}
    </>
  );
}

// One row in the evidence trail table.
function GateEvidenceRow({
  gate,
}: {
  gate: {
    nodeId: string;
    title: string;
    kind: string;
    status: string;
    reason: string | null;
    fieldsRead: string[];
  };
}) {
  const statusColor = gateStatusColor(gate.status as GateStatus);
  const fieldsSummary =
    gate.fieldsRead.length === 0
      ? 'no patient fields'
      : gate.fieldsRead.join(', ');
  const hoverTitle = [
    `${gate.title} — ${gate.status}`,
    gate.reason ? `Reason: ${gate.reason}` : null,
    `Reads: ${fieldsSummary}`,
    `Kind: ${gate.kind}`,
  ]
    .filter(Boolean)
    .join('\n');

  return (
    <div
      className="enc-cp-pref-row"
      title={hoverTitle}
      style={{ cursor: 'help', alignItems: 'flex-start' }}
    >
      <span className="enc-cp-pref-lbl-dot" style={{ background: statusColor, marginTop: 4 }} />
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span
          style={{
            fontSize: 11,
            fontWeight: 600,
            color: 'var(--ink)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {gate.title}
        </span>
        {gate.fieldsRead.length > 0 && (
          <span
            style={{
              fontSize: 9,
              color: 'var(--ink-3)',
              fontFamily: 'var(--font-jetbrains)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {fieldsSummary}
          </span>
        )}
      </div>
      <span
        style={{
          fontSize: 9,
          fontWeight: 700,
          textTransform: 'uppercase',
          letterSpacing: '.06em',
          color: statusColor,
          fontFamily: 'var(--font-manrope)',
        }}
      >
        {gate.status.replace(/_/g, ' ')}
      </span>
    </div>
  );
}

// One "Add X → unlocks N recs" callout.
function DataGapCard({
  hint,
}: {
  hint: {
    gateNodeId: string;
    gateTitle: string;
    kind: string;
    status: string;
    reason: string | null;
    fieldsRead: string[];
    unlockedRecommendations: Array<{ nodeId: string; nodeType: string; title: string }>;
  };
}) {
  const unlocked = hint.unlockedRecommendations;
  return (
    <div className="enc-copilot-section govern">
      <div className="enc-cp-h" style={{ color: 'var(--brand)' }}>
        {hint.gateTitle}
      </div>
      {hint.fieldsRead.length > 0 && (
        <div style={{ fontSize: 10, color: 'var(--ink-3)', fontFamily: 'var(--font-jetbrains)', marginBottom: 6 }}>
          Add: {hint.fieldsRead.join(', ')}
        </div>
      )}
      {hint.reason && (
        <div style={{ fontSize: 10, color: 'var(--ink-3)', marginBottom: 6, fontStyle: 'italic' }}>
          {hint.reason}
        </div>
      )}
      <div className="enc-cp-msg" style={{ marginBottom: 6 }}>
        Would unlock <strong>{unlocked.length}</strong> recommendation{unlocked.length === 1 ? '' : 's'}
      </div>
      {unlocked.length > 0 && (
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {unlocked.slice(0, 8).map((r, i) => (
            <span
              key={`${r.nodeId}-${i}`}
              title={`${r.nodeType} — ${r.title}`}
              style={{
                fontSize: 10,
                padding: '2px 7px',
                borderRadius: 10,
                background: 'var(--ok-soft)',
                color: 'var(--ok)',
                fontWeight: 600,
                fontFamily: 'var(--font-manrope)',
                lineHeight: 1.4,
              }}
            >
              {r.title}
            </span>
          ))}
          {unlocked.length > 8 && (
            <span
              style={{
                fontSize: 10,
                color: 'var(--ink-3)',
                padding: '2px 7px',
              }}
            >
              + {unlocked.length - 8} more
            </span>
          )}
        </div>
      )}
    </div>
  );
}

function gateStatusColor(status: GateStatus): string {
  switch (status) {
    case 'SATISFIED':
      return 'var(--ok)';
    case 'PENDING_QUESTION':
      return 'var(--warn)';
    case 'UNKNOWN':
      return 'var(--ink-3)';
    case 'GATED_OUT':
      return 'var(--danger)';
    case 'EXCLUDED':
      return 'var(--ink-3)';
    default:
      return 'var(--ink-3)';
  }
}
