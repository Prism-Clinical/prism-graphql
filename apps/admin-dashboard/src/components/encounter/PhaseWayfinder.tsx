'use client';

interface PhaseWayfinderProps {
  currentPhase: number;
  onSetPhase: (phase: number) => void;
}

const phases = [
  { label: 'Intake', sub: 'Diagnoses set' },
  { label: 'Assessment & Plan', sub: 'Evidence \u2192 orders' },
  { label: 'Review & Sign', sub: 'Manifest + note' },
];

export default function PhaseWayfinder({ currentPhase, onSetPhase }: PhaseWayfinderProps) {
  return (
    <div className="enc-phase-wayfinder">
      <div className="enc-phase-path">
        {phases.map((phase, i) => {
          const num = i + 1;
          const isDone = num < currentPhase;
          const isActive = num === currentPhase;
          return (
            <div key={num} style={{ display: 'contents' }}>
              <div
                className={`enc-phase-node ${isDone ? 'done' : ''} ${isActive ? 'active' : ''}`}
                onClick={() => onSetPhase(num)}
              >
                <div
                  className="enc-phase-node-num enc-display"
                  style={{ fontFamily: 'var(--font-newsreader)' }}
                >
                  {isDone ? '\u2713' : num}
                </div>
                <div className="enc-phase-node-text">
                  <div className="enc-phase-node-label" style={{ fontFamily: 'var(--font-manrope)' }}>
                    {phase.label}
                  </div>
                  <div className="enc-phase-node-sub" style={{ fontFamily: 'var(--font-manrope)' }}>
                    {phase.sub}
                  </div>
                </div>
              </div>
              {i < phases.length - 1 && (
                <div className={`enc-phase-connector ${num < currentPhase ? 'done' : ''}`} />
              )}
            </div>
          );
        })}
      </div>
      <div className="enc-wayfinder-right">
        <div className="enc-timer-display enc-mono" style={{ fontFamily: 'var(--font-jetbrains)' }}>
          Visit &middot; <strong>04:32</strong> / est 15m
        </div>
      </div>
    </div>
  );
}
