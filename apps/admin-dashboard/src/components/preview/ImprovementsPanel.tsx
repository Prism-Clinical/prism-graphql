'use client';

import { useState, useCallback, useMemo } from 'react';
import { useMutation } from '@apollo/client/react';
import { ADD_ADMIN_EVIDENCE } from '@/lib/graphql/mutations/pathways';
import { confidenceColor, confidenceBarColor } from '@/components/preview/confidence-utils';
import type { PathwayConfidenceResult, PathwayGraphNode, SignalBreakdown } from '@/types';

// ─── Constants (mirrored from EvidencePanel) ──────────────────────────

const EVIDENCE_LEVELS = ['Level A', 'Level B', 'Level C', 'Expert Consensus'] as const;

const EVIDENCE_LEVEL_SCORES: Record<string, number> = {
  'Level A': 0.95,
  'Level B': 0.80,
  'Level C': 0.65,
  'Expert Consensus': 0.60,
};

const EVIDENCE_LEVEL_COLORS: Record<string, string> = {
  'Level A': 'bg-green-100 text-green-800 border-green-200',
  'Level B': 'bg-blue-100 text-blue-800 border-blue-200',
  'Level C': 'bg-yellow-100 text-yellow-800 border-yellow-200',
  'Expert Consensus': 'bg-purple-100 text-purple-800 border-purple-200',
};

// ─── Types ───────────────────────────────────────────────────────────

interface ImprovementsPanelProps {
  pathwayId: string;
  confidenceResult: PathwayConfidenceResult;
  graphNodes: PathwayGraphNode[];
  onEvidenceAdded: () => void;
}

interface Recommendation {
  nodeId: string;
  nodeType: string;
  label: string;
  currentConfidence: number;
  estimatedConfidence: number;
  impactDelta: number;
  currentEvidenceScore: number;
  priority: 'high' | 'medium' | 'low';
}

// ─── Helpers ─────────────────────────────────────────────────────────

function computeWeightedAverage(breakdown: SignalBreakdown[]): number {
  let totalWeight = 0;
  let weightedSum = 0;
  for (const signal of breakdown) {
    weightedSum += signal.score * signal.weight;
    totalWeight += signal.weight;
  }
  return totalWeight > 0 ? weightedSum / totalWeight : 0;
}

function estimateConfidenceWithEvidence(
  breakdown: SignalBreakdown[],
  evidenceLevelScore: number,
): number {
  let totalWeight = 0;
  let weightedSum = 0;
  for (const signal of breakdown) {
    const score = signal.signalName === 'evidence_strength' ? evidenceLevelScore : signal.score;
    weightedSum += score * signal.weight;
    totalWeight += signal.weight;
  }
  return totalWeight > 0 ? weightedSum / totalWeight : 0;
}

function getNodeLabel(node: PathwayGraphNode): string {
  const props = node.properties as Record<string, unknown>;
  return String(props?.title || props?.name || props?.description || node.id);
}

// ─── ImprovementCard ─────────────────────────────────────────────────

function ImprovementCard({
  rec,
  pathwayId,
  onEvidenceAdded,
}: {
  rec: Recommendation;
  pathwayId: string;
  onEvidenceAdded: () => void;
}) {
  const [selectedLevel, setSelectedLevel] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [justAdded, setJustAdded] = useState(false);
  const [formData, setFormData] = useState({
    title: '',
    source: '',
    year: '',
    url: '',
    notes: '',
  });

  const [addEvidence, { loading: adding }] = useMutation(ADD_ADMIN_EVIDENCE, {
    onCompleted: () => {
      setJustAdded(true);
      setShowForm(false);
      setSelectedLevel(null);
      setFormData({ title: '', source: '', year: '', url: '', notes: '' });
      onEvidenceAdded();
    },
  });

  const handleQuickSelect = (level: string) => {
    setSelectedLevel(level);
    setShowForm(true);
  };

  const handleSubmit = useCallback(() => {
    if (!selectedLevel || !formData.title.trim()) return;
    addEvidence({
      variables: {
        input: {
          pathwayId,
          nodeIdentifier: rec.nodeId,
          title: formData.title.trim(),
          source: formData.source.trim() || undefined,
          year: formData.year ? parseInt(formData.year, 10) : undefined,
          evidenceLevel: selectedLevel,
          url: formData.url.trim() || undefined,
          notes: formData.notes.trim() || undefined,
        },
      },
    });
  }, [selectedLevel, formData, pathwayId, rec.nodeId, addEvidence]);

  const handleCancel = () => {
    setShowForm(false);
    setSelectedLevel(null);
  };

  const currentPct = Math.round(rec.currentConfidence * 100);
  const estimatedPct = Math.round(rec.estimatedConfidence * 100);
  const deltaPct = Math.round(rec.impactDelta * 100);

  return (
    <div className="border border-gray-200 rounded-lg bg-white p-4">
      {/* Header row */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-[10px] font-medium px-1.5 py-0.5 rounded border bg-gray-50 text-gray-600 border-gray-200 whitespace-nowrap">
            {rec.nodeType}
          </span>
          <span className="text-sm font-medium text-gray-900 truncate">{rec.label}</span>
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {justAdded ? (
            <span className="text-xs font-medium text-green-600 flex items-center gap-1">
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
              </svg>
              Added
            </span>
          ) : (
            <>
              <span className="text-sm font-semibold" style={{ color: confidenceColor(rec.currentConfidence) }}>
                {currentPct}%
              </span>
              <span className="text-gray-400 text-xs">&rarr;</span>
              <span className="text-sm font-semibold" style={{ color: confidenceColor(rec.estimatedConfidence) }}>
                {estimatedPct}%
              </span>
              <span className="text-xs font-medium text-green-600 ml-1">(+{deltaPct}%)</span>
            </>
          )}
        </div>
      </div>

      {/* Confidence bar */}
      {!justAdded && (
        <div className="mt-2 flex items-center gap-2">
          <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden relative">
            <div
              className={`absolute inset-y-0 left-0 rounded-full ${confidenceBarColor(rec.currentConfidence)}`}
              style={{ width: `${currentPct}%` }}
            />
            <div
              className="absolute inset-y-0 rounded-full bg-green-300 opacity-50"
              style={{ left: `${currentPct}%`, width: `${deltaPct}%` }}
            />
          </div>
        </div>
      )}

      {/* Evidence status */}
      {!justAdded && (
        <p className="text-xs text-gray-500 mt-2">
          Evidence Strength: {Math.round(rec.currentEvidenceScore * 100)}%
          {rec.currentEvidenceScore <= 0.30 && (
            <span className="text-red-500 ml-1">(no evidence)</span>
          )}
        </p>
      )}

      {/* Quick-add buttons */}
      {!justAdded && !showForm && (
        <div className="mt-3 flex items-center gap-2 flex-wrap">
          <span className="text-xs text-gray-500">Quick add:</span>
          {EVIDENCE_LEVELS.map((level) => (
            <button
              key={level}
              onClick={() => handleQuickSelect(level)}
              className={`text-[11px] font-medium px-2 py-1 rounded border transition-colors hover:opacity-80 ${EVIDENCE_LEVEL_COLORS[level]}`}
            >
              {level}
            </button>
          ))}
        </div>
      )}

      {/* Inline form */}
      {showForm && selectedLevel && (
        <div className="mt-3 border border-gray-200 rounded-lg p-3 space-y-2.5 bg-gray-50">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs text-gray-500">Adding:</span>
            <span className={`text-[11px] font-medium px-1.5 py-0.5 rounded border ${EVIDENCE_LEVEL_COLORS[selectedLevel]}`}>
              {selectedLevel} ({Math.round(EVIDENCE_LEVEL_SCORES[selectedLevel] * 100)}%)
            </span>
          </div>
          <div>
            <label className="block text-[10px] font-medium text-gray-600 mb-0.5">Title *</label>
            <input
              type="text"
              value={formData.title}
              onChange={(e) => setFormData((prev) => ({ ...prev, title: e.target.value }))}
              placeholder="e.g. AHA Guidelines 2024"
              className="w-full text-xs border border-gray-300 rounded px-2 py-1.5 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              autoFocus
            />
          </div>
          <div className="flex gap-2">
            <div className="flex-1">
              <label className="block text-[10px] font-medium text-gray-600 mb-0.5">Source</label>
              <input
                type="text"
                value={formData.source}
                onChange={(e) => setFormData((prev) => ({ ...prev, source: e.target.value }))}
                placeholder="e.g. JAMA 2024"
                className="w-full text-xs border border-gray-300 rounded px-2 py-1.5 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>
            <div className="w-20">
              <label className="block text-[10px] font-medium text-gray-600 mb-0.5">Year</label>
              <input
                type="number"
                value={formData.year}
                onChange={(e) => setFormData((prev) => ({ ...prev, year: e.target.value }))}
                placeholder="2024"
                className="w-full text-xs border border-gray-300 rounded px-2 py-1.5 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>
          </div>
          <div>
            <label className="block text-[10px] font-medium text-gray-600 mb-0.5">URL</label>
            <input
              type="url"
              value={formData.url}
              onChange={(e) => setFormData((prev) => ({ ...prev, url: e.target.value }))}
              placeholder="https://doi.org/..."
              className="w-full text-xs border border-gray-300 rounded px-2 py-1.5 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>
          <div>
            <label className="block text-[10px] font-medium text-gray-600 mb-0.5">Notes</label>
            <textarea
              value={formData.notes}
              onChange={(e) => setFormData((prev) => ({ ...prev, notes: e.target.value }))}
              placeholder="Additional context..."
              rows={2}
              className="w-full text-xs border border-gray-300 rounded px-2 py-1.5 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 resize-none"
            />
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleSubmit}
              disabled={adding || !formData.title.trim()}
              className="flex-1 py-1.5 px-3 text-xs font-medium text-white bg-blue-600 rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {adding ? 'Adding...' : 'Add Evidence'}
            </button>
            <button
              onClick={handleCancel}
              className="py-1.5 px-3 text-xs font-medium text-gray-600 border border-gray-300 rounded hover:bg-gray-100 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── ImprovementsPanel ───────────────────────────────────────────────

export function ImprovementsPanel({
  pathwayId,
  confidenceResult,
  graphNodes,
  onEvidenceAdded,
}: ImprovementsPanelProps) {
  const [showAll, setShowAll] = useState(false);

  // Build label lookup from graph nodes
  const labelMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const node of graphNodes) {
      map.set(node.id, getNodeLabel(node));
    }
    return map;
  }, [graphNodes]);

  // Analyze nodes and build recommendations
  const recommendations = useMemo(() => {
    const recs: Recommendation[] = [];

    for (const node of confidenceResult.nodes) {
      const evidenceSignal = node.breakdown.find((s) => s.signalName === 'evidence_strength');
      if (!evidenceSignal || evidenceSignal.score >= 0.95) continue;

      const estimated = estimateConfidenceWithEvidence(node.breakdown, 0.95);
      const delta = estimated - node.confidence;

      if (delta < 0.005) continue; // Skip negligible improvements

      recs.push({
        nodeId: node.nodeIdentifier,
        nodeType: node.nodeType,
        label: labelMap.get(node.nodeIdentifier) || node.nodeIdentifier,
        currentConfidence: node.confidence,
        estimatedConfidence: estimated,
        impactDelta: delta,
        currentEvidenceScore: evidenceSignal.score,
        priority: delta > 0.10 ? 'high' : delta > 0.05 ? 'medium' : 'low',
      });
    }

    recs.sort((a, b) => b.impactDelta - a.impactDelta);
    return recs;
  }, [confidenceResult, labelMap]);

  // Compute estimated overall improvement
  const estimatedOverall = useMemo(() => {
    if (confidenceResult.nodes.length === 0) return confidenceResult.overallConfidence;

    let sum = 0;
    for (const node of confidenceResult.nodes) {
      const evidenceSignal = node.breakdown.find((s) => s.signalName === 'evidence_strength');
      if (evidenceSignal && evidenceSignal.score < 0.95) {
        sum += estimateConfidenceWithEvidence(node.breakdown, 0.95);
      } else {
        sum += node.confidence;
      }
    }
    return sum / confidenceResult.nodes.length;
  }, [confidenceResult]);

  if (recommendations.length === 0) return null;

  const displayedRecs = showAll ? recommendations : recommendations.slice(0, 10);
  const overallCurrentPct = Math.round(confidenceResult.overallConfidence * 100);
  const overallEstimatedPct = Math.round(estimatedOverall * 100);

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      {/* Summary header */}
      <div className="px-5 py-4 border-b border-gray-200 flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <svg className="h-4 w-4 text-amber-500" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z" />
            </svg>
            <h3 className="text-sm font-semibold text-gray-900">
              {recommendations.length} {recommendations.length === 1 ? 'node' : 'nodes'} can be improved
            </h3>
          </div>
          <p className="text-xs text-gray-500 mt-1">
            Adding Level A evidence could raise overall confidence from{' '}
            <span className="font-semibold" style={{ color: confidenceColor(confidenceResult.overallConfidence) }}>
              {overallCurrentPct}%
            </span>{' '}
            &rarr;{' '}
            <span className="font-semibold" style={{ color: confidenceColor(estimatedOverall) }}>
              {overallEstimatedPct}%
            </span>
          </p>
        </div>
        {recommendations.length > 10 && (
          <button
            onClick={() => setShowAll(!showAll)}
            className="text-xs font-medium text-blue-600 hover:text-blue-700 whitespace-nowrap flex-shrink-0"
          >
            {showAll ? 'Show top 10' : `Show all ${recommendations.length}`} &#x25BE;
          </button>
        )}
      </div>

      {/* Card list */}
      <div className="p-4 space-y-3">
        {displayedRecs.map((rec) => (
          <ImprovementCard
            key={rec.nodeId}
            rec={rec}
            pathwayId={pathwayId}
            onEvidenceAdded={onEvidenceAdded}
          />
        ))}

        {!showAll && recommendations.length > 10 && (
          <button
            onClick={() => setShowAll(true)}
            className="w-full py-2 text-xs font-medium text-gray-500 hover:text-gray-700 transition-colors"
          >
            +{recommendations.length - 10} more nodes &mdash; click to show all
          </button>
        )}
      </div>
    </div>
  );
}
