'use client';

import { PreviewPhase } from './types';

interface PreviewWayfinderProps {
  currentPhase: PreviewPhase;
  onSetPhase: (phase: PreviewPhase) => void;
  overallConfidence: number | null;
}

const phases = [
  { phase: PreviewPhase.Configure, label: 'Configure', sub: 'Patient context' },
  { phase: PreviewPhase.Simulate, label: 'Simulate', sub: 'Confidence results' },
  { phase: PreviewPhase.Tune, label: 'Tune', sub: 'Weights & evidence' },
];

export default function PreviewWayfinder({
  currentPhase,
  onSetPhase,
  overallConfidence,
}: PreviewWayfinderProps) {
  return (
    <div className="enc-phase-wayfinder">
      <div className="enc-phase-path">
        {phases.map((p, i) => {
          const isDone = p.phase < currentPhase;
          const isActive = p.phase === currentPhase;
          return (
            <div key={p.phase} style={{ display: 'contents' }}>
              <div
                className={`enc-phase-node ${isDone ? 'done' : ''} ${isActive ? 'active' : ''}`}
                onClick={() => onSetPhase(p.phase)}
              >
                <div
                  className="enc-phase-node-num enc-display"
                  style={{ fontFamily: 'var(--font-newsreader)' }}
                >
                  {isDone ? '\u2713' : p.phase}
                </div>
                <div className="enc-phase-node-text">
                  <div className="enc-phase-node-label" style={{ fontFamily: 'var(--font-manrope)' }}>
                    {p.label}
                  </div>
                  <div className="enc-phase-node-sub" style={{ fontFamily: 'var(--font-manrope)' }}>
                    {p.sub}
                  </div>
                </div>
              </div>
              {i < phases.length - 1 && (
                <div className={`enc-phase-connector ${p.phase < currentPhase ? 'done' : ''}`} />
              )}
            </div>
          );
        })}
      </div>
      <div className="enc-wayfinder-right">
        {overallConfidence !== null && (
          <div
            className="enc-timer-display enc-mono"
            style={{ fontFamily: 'var(--font-jetbrains)' }}
          >
            Confidence &middot; <strong>{Math.round(overallConfidence * 100)}%</strong>
          </div>
        )}
      </div>
    </div>
  );
}
