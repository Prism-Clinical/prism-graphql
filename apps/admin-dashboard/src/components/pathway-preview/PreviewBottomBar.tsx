'use client';

import type { PathwayConfidenceResult, ResolutionType } from '@/types';

interface PreviewBottomBarProps {
  mode: 'configure' | 'results';
  nodeCount: number;
  confidenceResult: PathwayConfidenceResult | null;
  onBackToConfigure: () => void;
  onRunSimulation: () => void;
  isLoading: boolean;
}

export default function PreviewBottomBar({
  mode,
  nodeCount,
  confidenceResult,
  onBackToConfigure,
  onRunSimulation,
  isLoading,
}: PreviewBottomBarProps) {
  // Resolution distribution summary
  let autoCount = 0;
  let suggestCount = 0;
  let providerCount = 0;
  let manualCount = 0;

  if (confidenceResult) {
    for (const n of confidenceResult.nodes) {
      switch (n.resolutionType as ResolutionType) {
        case 'AUTO_RESOLVED': autoCount++; break;
        case 'SYSTEM_SUGGESTED': suggestCount++; break;
        case 'PROVIDER_DECIDED': providerCount++; break;
        case 'FORCED_MANUAL': manualCount++; break;
      }
    }
  }

  const overallPct = confidenceResult
    ? Math.round(confidenceResult.overallConfidence * 100)
    : null;

  return (
    <div className="enc-bottom">
      <div className="enc-bottom-left">
        <div className="enc-progress-stat enc-mono" style={{ fontFamily: 'var(--font-jetbrains)' }}>
          Nodes &middot; <strong>{nodeCount} total</strong>
        </div>
        {overallPct !== null && (
          <div className="enc-progress-stat enc-mono" style={{ fontFamily: 'var(--font-jetbrains)' }}>
            Confidence &middot; <strong>{overallPct}%</strong>
          </div>
        )}
        {confidenceResult && (
          <div className="enc-progress-stat enc-mono" style={{ fontFamily: 'var(--font-jetbrains)' }}>
            Resolution &middot;{' '}
            <strong>
              {autoCount}A &middot; {suggestCount}S &middot; {providerCount}P &middot; {manualCount}M
            </strong>
          </div>
        )}
      </div>
      <div className="enc-bottom-actions">
        {mode === 'results' ? (
          <>
            <button
              className="enc-btn"
              style={{ fontFamily: 'var(--font-manrope)' }}
              onClick={onBackToConfigure}
            >
              &larr; Back to Configuration
            </button>
            <button
              className="enc-btn enc-btn-primary"
              style={{ fontFamily: 'var(--font-manrope)' }}
              onClick={onRunSimulation}
              disabled={isLoading}
            >
              {isLoading ? 'Running...' : 'Re-run Simulation'}
            </button>
          </>
        ) : (
          <button
            className="enc-btn enc-btn-primary"
            style={{
              fontFamily: 'var(--font-manrope)',
              padding: '8px 24px',
              fontSize: 13,
              fontWeight: 600,
            }}
            onClick={onRunSimulation}
            disabled={isLoading}
          >
            {isLoading ? 'Running Simulation...' : '\u25B6  Run Simulation'}
          </button>
        )}
      </div>
    </div>
  );
}
