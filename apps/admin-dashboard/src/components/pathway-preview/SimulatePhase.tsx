'use client';

import { useState } from 'react';
import type { NodeConfidenceResult, ResolutionType, PathwayGraphNode } from '@/types';
import type { StageView, StepView, DecisionPointView, PlanItemView } from './types';
import {
  confidenceCssColor,
  confidenceCssBg,
  confidenceCssBorder,
  resolutionCssColor,
  resolutionCssBg,
  resolutionLabel,
  nodeTypeCssColor,
  nodeTypeCssBg,
  weightSourceLabel,
  SIGNAL_DISPLAY_NAMES,
} from './confidence-theme';

interface SimulatePhaseProps {
  stages: StageView[];
  overallConfidence: number | null;
  nodeCount: number;
  scoredNodeCount: number;
  error: string | null;
  confidenceNodes?: NodeConfidenceResult[];
}

export default function SimulatePhase({
  stages,
  overallConfidence,
  nodeCount,
  scoredNodeCount,
  error,
  confidenceNodes,
}: SimulatePhaseProps) {
  const [expandedNodeId, setExpandedNodeId] = useState<string | null>(null);

  const toggleExpand = (nodeId: string) => {
    setExpandedNodeId(prev => prev === nodeId ? null : nodeId);
  };

  // Count how many stages/steps actually got a confidence score attached
  let matchedCount = 0;
  for (const s of stages) {
    if (s.confidence) matchedCount++;
    for (const st of s.steps) {
      if (st.confidence) matchedCount++;
      for (const dp of st.decisionPoints) if (dp.confidence) matchedCount++;
      for (const m of st.medications) if (m.confidence) matchedCount++;
      for (const l of st.labTests) if (l.confidence) matchedCount++;
      for (const p of st.procedures) if (p.confidence) matchedCount++;
    }
  }

  return (
    <div className="enc-phase-content">
      <div className="enc-phase-heading">
        <div>
          <h1 className="enc-display" style={{ fontFamily: 'var(--font-newsreader)' }}>
            <em>Simulate</em> Confidence Results
          </h1>
          <p className="enc-subtitle" style={{ fontFamily: 'var(--font-manrope)' }}>
            Hierarchical view of pathway nodes with confidence scores and resolution types.
            Click any node to see its confidence breakdown.
          </p>
        </div>
        <div className="enc-phase-heading-right" style={{ fontFamily: 'var(--font-manrope)' }}>
          Overall
          <strong style={{
            fontFamily: 'var(--font-newsreader)',
            color: overallConfidence !== null ? confidenceCssColor(overallConfidence) : undefined,
          }}>
            {overallConfidence !== null ? `${Math.round(overallConfidence * 100)}%` : '\u2014'}
          </strong>
        </div>
      </div>

      {/* Error banner */}
      {error && (
        <div style={{
          padding: '14px 18px',
          marginBottom: 16,
          background: 'var(--danger-soft)',
          border: '1px solid var(--danger)',
          borderRadius: 8,
          color: 'var(--danger)',
          fontSize: 13,
        }}>
          <strong>Simulation failed:</strong> {error}
        </div>
      )}

      {/* Overall confidence summary card */}
      {overallConfidence !== null && (
        <div style={{
          padding: '18px 22px',
          marginBottom: 16,
          background: 'var(--panel)',
          border: '1px solid var(--rule)',
          borderRadius: 8,
          display: 'flex',
          alignItems: 'center',
          gap: 20,
        }}>
          <div style={{
            fontSize: 42,
            fontWeight: 600,
            fontFamily: 'var(--font-newsreader)',
            color: confidenceCssColor(overallConfidence),
            lineHeight: 1,
          }}>
            {Math.round(overallConfidence * 100)}%
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)', marginBottom: 6 }}>
              Overall Pathway Confidence
            </div>
            <div className="enc-confidence-bar" style={{ height: 8, marginBottom: 6 }}>
              <div
                className="enc-confidence-bar-fill"
                style={{
                  width: `${Math.round(overallConfidence * 100)}%`,
                  background: confidenceCssColor(overallConfidence),
                }}
              />
            </div>
            <div style={{ fontSize: 11, color: 'var(--ink-3)' }}>
              {scoredNodeCount} nodes scored
              {scoredNodeCount > 0 && matchedCount === 0 && (
                <span style={{ color: 'var(--warn)', marginLeft: 8 }}>
                  (scores not mapped to hierarchy — node IDs may differ from graph)
                </span>
              )}
              {matchedCount > 0 && (
                <span> &middot; {matchedCount} displayed in hierarchy below</span>
              )}
            </div>
          </div>
        </div>
      )}

      {stages.length === 0 ? (
        <div style={{
          textAlign: 'center',
          padding: '40px 0',
          color: 'var(--ink-3)',
          fontSize: 14,
        }}>
          No simulation results. Go back to Configure and run a simulation.
        </div>
      ) : (
        <div className="enc-assess-cards">
          {stages.map(stage => (
            <StageCard
              key={stage.node.id}
              stage={stage}
              expandedNodeId={expandedNodeId}
              onToggleExpand={toggleExpand}
            />
          ))}
        </div>
      )}

      {/* Fallback: raw confidence table when scores exist but hierarchy has no matches */}
      {confidenceNodes && confidenceNodes.length > 0 && matchedCount === 0 && (
        <div style={{ marginTop: 24 }}>
          <div style={{
            fontSize: 12,
            fontWeight: 700,
            textTransform: 'uppercase',
            letterSpacing: '.1em',
            color: 'var(--ink-3)',
            marginBottom: 8,
            fontFamily: 'var(--font-manrope)',
          }}>
            Raw Confidence Results ({confidenceNodes.length} nodes)
          </div>
          <div style={{
            border: '1px solid var(--rule)',
            borderRadius: 8,
            overflow: 'hidden',
          }}>
            {confidenceNodes.map((n, i) => (
              <div key={n.nodeIdentifier} style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '8px 14px',
                borderBottom: i < confidenceNodes.length - 1 ? '1px solid var(--rule)' : undefined,
                background: i % 2 === 0 ? 'var(--panel)' : 'var(--canvas)',
                fontSize: 12,
                fontFamily: 'var(--font-jetbrains)',
              }}>
                <span style={{ flex: 1, color: 'var(--ink)' }}>{n.nodeIdentifier}</span>
                <span
                  className="enc-node-type-tag"
                  style={{
                    background: nodeTypeCssBg(n.nodeType),
                    color: nodeTypeCssColor(n.nodeType),
                  }}
                >
                  {n.nodeType}
                </span>
                <ConfidenceBadge confidence={n.confidence} />
                <ResolutionBadge type={n.resolutionType} />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Node Detail Panel ────────────────────────────────────────────────

interface NodeDetailPanelProps {
  node: PathwayGraphNode;
  confidence: NodeConfidenceResult;
  nodeType: string;
  nodeLabel: string;
}

function NodeDetailPanel({ node, confidence, nodeType, nodeLabel }: NodeDetailPanelProps) {
  const [showProps, setShowProps] = useState(false);
  const pct = Math.round(confidence.confidence * 100);
  const breakdown = confidence.breakdown ?? [];
  const propagations = confidence.propagationInfluences ?? [];
  const props = node.properties as Record<string, unknown>;

  // Build resolution reasoning text
  const reasoningText = buildResolutionReasoning(confidence.confidence, confidence.resolutionType);

  // Weighted contribution total for stacked bar
  const totalWeighted = breakdown.reduce((sum, s) => sum + s.score * s.weight, 0);

  // Color palette for stacked bar segments
  const segColors = ['var(--brand)', 'var(--accent)', 'var(--ai)', 'var(--inst)', 'var(--ok)', 'var(--danger)'];

  return (
    <div className="enc-node-detail">
      {/* Header */}
      <div className="enc-node-detail-header">
        <span
          className="enc-node-type-tag"
          style={{ background: nodeTypeCssBg(nodeType), color: nodeTypeCssColor(nodeType) }}
        >
          {nodeType}
        </span>
        <span className="enc-detail-label">{nodeLabel}</span>
        <span className="enc-detail-score" style={{ color: confidenceCssColor(confidence.confidence) }}>
          {pct}%
        </span>
        <ResolutionBadge type={confidence.resolutionType} />
      </div>

      {/* Signal Breakdown Table */}
      {breakdown.length > 0 && (
        <>
          <div className="enc-detail-section-label">Signal Breakdown</div>
          <table className="enc-signal-table">
            <thead>
              <tr>
                <th>Signal</th>
                <th>Score</th>
                <th>Weight</th>
                <th>Source</th>
                <th>Missing Inputs</th>
              </tr>
            </thead>
            <tbody>
              {breakdown.map(signal => {
                const scorePct = Math.round(signal.score * 100);
                return (
                  <tr key={signal.signalName}>
                    <td style={{ fontWeight: 500 }}>
                      {SIGNAL_DISPLAY_NAMES[signal.signalName] ?? signal.signalName}
                    </td>
                    <td>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span className="enc-signal-bar">
                          <span
                            className="enc-signal-bar-fill"
                            style={{
                              width: `${scorePct}%`,
                              background: confidenceCssColor(signal.score),
                            }}
                          />
                        </span>
                        <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: 11 }}>
                          {scorePct}%
                        </span>
                      </span>
                    </td>
                    <td style={{ fontFamily: 'var(--font-jetbrains)', fontSize: 11 }}>
                      {signal.weight.toFixed(2)}
                    </td>
                    <td style={{ fontSize: 10, color: 'var(--ink-2)' }}>
                      {weightSourceLabel(signal.weightSource)}
                    </td>
                    <td>
                      {signal.missingInputs.length > 0
                        ? signal.missingInputs.map(m => (
                            <span key={m} className="enc-missing-pill">{m}</span>
                          ))
                        : <span style={{ color: 'var(--ink-4)', fontSize: 11 }}>&mdash;</span>
                      }
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </>
      )}

      {/* Weighted Score Visualization */}
      {breakdown.length > 0 && (
        <>
          <div className="enc-detail-section-label">Weighted Contribution</div>
          <div className="enc-stacked-bar">
            {breakdown.map((signal, i) => {
              const contribution = signal.score * signal.weight;
              const widthPct = totalWeighted > 0 ? (contribution / totalWeighted) * 100 : 0;
              return (
                <div
                  key={signal.signalName}
                  className="enc-stacked-bar-seg"
                  style={{
                    width: `${widthPct}%`,
                    background: segColors[i % segColors.length],
                    opacity: 0.8,
                  }}
                  title={`${SIGNAL_DISPLAY_NAMES[signal.signalName] ?? signal.signalName}: ${Math.round(contribution * 100)}%`}
                />
              );
            })}
          </div>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 10, fontSize: 10, color: 'var(--ink-2)' }}>
            {breakdown.map((signal, i) => (
              <span key={signal.signalName} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <span style={{
                  width: 8, height: 8, borderRadius: 2,
                  background: segColors[i % segColors.length], display: 'inline-block',
                }} />
                {SIGNAL_DISPLAY_NAMES[signal.signalName] ?? signal.signalName}
              </span>
            ))}
          </div>
        </>
      )}

      {/* Resolution Reasoning */}
      <div className="enc-detail-section-label">Resolution Reasoning</div>
      <div className="enc-resolution-text">{reasoningText}</div>

      {/* Node Properties (collapsible) */}
      {Object.keys(props).length > 0 && (
        <>
          <div
            className="enc-detail-section-label"
            style={{ cursor: 'pointer', userSelect: 'none' }}
            onClick={() => setShowProps(p => !p)}
          >
            Node Properties {showProps ? '\u25B4' : '\u25BE'}
          </div>
          {showProps && (
            <dl className="enc-prop-list">
              {Object.entries(props).map(([k, v]) => (
                <React.Fragment key={k}>
                  <dt>{k}</dt>
                  <dd>{String(v ?? '\u2014')}</dd>
                </React.Fragment>
              ))}
            </dl>
          )}
        </>
      )}

      {/* Propagation Influences */}
      {propagations.length > 0 && (
        <>
          <div className="enc-detail-section-label">Propagation Influences</div>
          <table className="enc-signal-table">
            <thead>
              <tr>
                <th>Source Node</th>
                <th>Signal</th>
                <th>Original</th>
                <th>Propagated</th>
                <th>Hops</th>
              </tr>
            </thead>
            <tbody>
              {propagations.map((p, i) => (
                <tr key={`${p.sourceNodeIdentifier}-${p.signalName}-${i}`}>
                  <td style={{ fontFamily: 'var(--font-jetbrains)', fontSize: 11 }}>
                    {p.sourceNodeIdentifier}
                  </td>
                  <td>{SIGNAL_DISPLAY_NAMES[p.signalName] ?? p.signalName}</td>
                  <td style={{ fontFamily: 'var(--font-jetbrains)', fontSize: 11 }}>
                    {Math.round(p.originalScore * 100)}%
                  </td>
                  <td style={{ fontFamily: 'var(--font-jetbrains)', fontSize: 11 }}>
                    {Math.round(p.propagatedScore * 100)}%
                  </td>
                  <td style={{ fontFamily: 'var(--font-jetbrains)', fontSize: 11 }}>
                    {p.hopDistance}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}

function buildResolutionReasoning(confidence: number, resolutionType: ResolutionType): string {
  const pct = Math.round(confidence * 100);
  switch (resolutionType) {
    case 'AUTO_RESOLVED':
      return `Confidence ${pct}% meets auto-resolve threshold (\u226585%) \u2192 Auto-Resolved. No provider action needed.`;
    case 'SYSTEM_SUGGESTED':
      return `Confidence ${pct}% is between suggest threshold (60%) and auto-resolve threshold (85%) \u2192 System Suggested. Provider review recommended.`;
    case 'PROVIDER_DECIDED':
      return `Confidence ${pct}% is below suggest threshold (60%) \u2192 Provider Decision required. Insufficient data for automated resolution.`;
    case 'FORCED_MANUAL':
      return `This node requires manual review regardless of confidence score (${pct}%) \u2192 Forced Manual. Policy or safety constraint enforced.`;
    default:
      return `Confidence: ${pct}%. Resolution type: ${resolutionType}.`;
  }
}

// Needed for React.Fragment with key
import React from 'react';

// ─── Stage Card (enc-dx-card style) ──────────────────────────────────

interface ExpandableProps {
  expandedNodeId: string | null;
  onToggleExpand: (nodeId: string) => void;
}

function StageCard({ stage, expandedNodeId, onToggleExpand }: { stage: StageView } & ExpandableProps) {
  const conf = stage.confidence;
  const pct = conf ? Math.round(conf.confidence * 100) : null;
  const isExpanded = expandedNodeId === stage.node.id;

  return (
    <div className="enc-dx-card">
      <div
        className="enc-dx-card-head enc-clickable-row"
        onClick={() => onToggleExpand(stage.node.id)}
      >
        <div
          className="enc-dx-card-source-tag"
          style={{ background: 'var(--brand)', borderRadius: 5 }}
        >
          S{stage.stageNumber}
        </div>
        <div className="enc-dx-card-title-wrap">
          <div className="enc-dx-card-title">
            {stage.label}
            <span
              className="enc-node-type-tag"
              style={{
                background: nodeTypeCssBg('Stage'),
                color: nodeTypeCssColor('Stage'),
              }}
            >
              Stage
            </span>
          </div>
          <div className="enc-dx-card-source-label">
            Stage {stage.stageNumber}
          </div>
        </div>
        {pct !== null && (
          <div className="enc-dx-card-status">
            <ConfidenceBadge confidence={conf!.confidence} />
            {conf && <ResolutionBadge type={conf.resolutionType} />}
          </div>
        )}
      </div>

      {isExpanded && conf && (
        <NodeDetailPanel
          node={stage.node}
          confidence={conf}
          nodeType="Stage"
          nodeLabel={stage.label}
        />
      )}

      {/* Steps within stage */}
      {stage.steps.map(step => (
        <StepSection
          key={step.node.id}
          step={step}
          expandedNodeId={expandedNodeId}
          onToggleExpand={onToggleExpand}
        />
      ))}
    </div>
  );
}

// ─── Step Section (enc-evidence-section style) ───────────────────────

function StepSection({ step, expandedNodeId, onToggleExpand }: { step: StepView } & ExpandableProps) {
  const conf = step.confidence;
  const pct = conf ? Math.round(conf.confidence * 100) : null;
  const isExpanded = expandedNodeId === step.node.id;

  return (
    <div className="enc-evidence-section">
      <div
        className="enc-ev-h enc-clickable-row"
        onClick={() => onToggleExpand(step.node.id)}
      >
        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span
            className="enc-node-type-tag"
            style={{
              background: nodeTypeCssBg('Step'),
              color: nodeTypeCssColor('Step'),
            }}
          >
            Step {step.displayNumber}
          </span>
          {step.label}
        </span>
        {pct !== null && (
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <ConfidenceBadge confidence={conf!.confidence} />
            {conf && <ResolutionBadge type={conf.resolutionType} />}
          </span>
        )}
      </div>

      {isExpanded && conf && (
        <NodeDetailPanel
          node={step.node}
          confidence={conf}
          nodeType="Step"
          nodeLabel={step.label}
        />
      )}

      {/* Decision Points as attr entries */}
      {step.decisionPoints.length > 0 && (
        <div className="enc-attr-list">
          {step.decisionPoints.map((dp, i) => (
            <DecisionPointRow
              key={`dp-${dp.node.id}-${i}`}
              dp={dp}
              expandedNodeId={expandedNodeId}
              onToggleExpand={onToggleExpand}
            />
          ))}
        </div>
      )}

      {/* Plan items: Medications, Labs, Procedures */}
      {(step.medications.length > 0 || step.labTests.length > 0 || step.procedures.length > 0) && (
        <div className="enc-plan-list" style={{ marginTop: 10 }}>
          {step.medications.map((m, i) => (
            <PlanItemRow
              key={`med-${m.node.id}-${i}`}
              item={m}
              expandedNodeId={expandedNodeId}
              onToggleExpand={onToggleExpand}
            />
          ))}
          {step.labTests.map((l, i) => (
            <PlanItemRow
              key={`lab-${l.node.id}-${i}`}
              item={l}
              expandedNodeId={expandedNodeId}
              onToggleExpand={onToggleExpand}
            />
          ))}
          {step.procedures.map((p, i) => (
            <PlanItemRow
              key={`proc-${p.node.id}-${i}`}
              item={p}
              expandedNodeId={expandedNodeId}
              onToggleExpand={onToggleExpand}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Decision Point Row (enc-attr-entry style) ──────────────────────

function DecisionPointRow({ dp, expandedNodeId, onToggleExpand }: { dp: DecisionPointView } & ExpandableProps) {
  const conf = dp.confidence;
  const pct = conf ? Math.round(conf.confidence * 100) : null;
  const isExpanded = expandedNodeId === dp.node.id;

  return (
    <>
      <div
        className="enc-attr-entry enc-clickable-row"
        style={conf && conf.confidence < 0.60 ? { background: 'var(--warn-soft)', borderLeft: '2px solid var(--warn)', paddingLeft: 8 } : {}}
        onClick={() => onToggleExpand(dp.node.id)}
      >
        <span
          className="enc-attr-src-tag"
          style={{
            background: nodeTypeCssBg('DecisionPoint'),
            color: nodeTypeCssColor('DecisionPoint'),
          }}
        >
          DP
        </span>
        <div className="enc-attr-content">
          <div className="enc-attr-label">{dp.label}</div>
          {dp.criteria.length > 0 && (
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 4 }}>
              {dp.criteria.map((c, i) => {
                const props = c.properties as Record<string, unknown>;
                return (
                  <span
                    key={`${c.id}-${i}`}
                    style={{
                      fontSize: 9,
                      padding: '2px 6px',
                      borderRadius: 3,
                      background: 'var(--inst-soft)',
                      color: 'var(--inst)',
                      fontWeight: 600,
                      fontFamily: 'var(--font-jetbrains)',
                    }}
                  >
                    {String(props.description ?? c.id)}
                  </span>
                );
              })}
            </div>
          )}
        </div>
        {pct !== null && (
          <div className="enc-attr-actions" style={{ gap: 6 }}>
            <ConfidenceBadge confidence={conf!.confidence} />
            {conf && <ResolutionBadge type={conf.resolutionType} />}
          </div>
        )}
      </div>
      {isExpanded && conf && (
        <NodeDetailPanel
          node={dp.node}
          confidence={conf}
          nodeType="DecisionPoint"
          nodeLabel={dp.label}
        />
      )}
    </>
  );
}

// ─── Plan Item Row (enc-plan-item style) ─────────────────────────────

function PlanItemRow({ item, expandedNodeId, onToggleExpand }: { item: PlanItemView } & ExpandableProps) {
  const conf = item.confidence;
  const pct = conf ? Math.round(conf.confidence * 100) : null;
  const isExpanded = expandedNodeId === item.node.id;

  const iconMap: Record<string, { label: string; cssClass: string }> = {
    Medication: { label: 'Rx', cssClass: 'rx' },
    LabTest: { label: 'Lab', cssClass: 'lab' },
    Procedure: { label: 'Proc', cssClass: 'img' },
  };
  const icon = iconMap[item.itemType] ?? { label: '?', cssClass: 'lab' };

  return (
    <>
      <div
        className="enc-plan-item enc-clickable-row"
        onClick={() => onToggleExpand(item.node.id)}
      >
        <div className={`enc-plan-item-icon ${icon.cssClass}`}>
          {icon.label}
        </div>
        <div className="enc-plan-item-body">
          <div className="enc-plan-item-name">
            {item.label}
            <span
              className="enc-node-type-tag"
              style={{
                background: nodeTypeCssBg(item.itemType),
                color: nodeTypeCssColor(item.itemType),
              }}
            >
              {item.itemType}
            </span>
          </div>
        </div>
        {pct !== null && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
            <ConfidenceBadge confidence={conf!.confidence} />
            {conf && <ResolutionBadge type={conf.resolutionType} />}
          </div>
        )}
      </div>
      {isExpanded && conf && (
        <NodeDetailPanel
          node={item.node}
          confidence={conf}
          nodeType={item.itemType}
          nodeLabel={item.label}
        />
      )}
    </>
  );
}

// ─── Shared Badge Components ─────────────────────────────────────────

function ConfidenceBadge({ confidence }: { confidence: number }) {
  const pct = Math.round(confidence * 100);
  return (
    <span
      className="enc-confidence-badge"
      style={{
        color: confidenceCssColor(confidence),
        background: confidenceCssBg(confidence),
        border: `1px solid ${confidenceCssBorder(confidence)}`,
      }}
    >
      {pct}%
    </span>
  );
}

function ResolutionBadge({ type }: { type: ResolutionType }) {
  return (
    <span
      className="enc-status-badge"
      style={{
        color: resolutionCssColor(type),
        background: resolutionCssBg(type),
      }}
    >
      {resolutionLabel(type)}
    </span>
  );
}
