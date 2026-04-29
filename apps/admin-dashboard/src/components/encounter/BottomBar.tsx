'use client';

interface BottomBarProps {
  onBack: () => void;
  onContinue: () => void;
}

export default function BottomBar({ onBack, onContinue }: BottomBarProps) {
  return (
    <div className="enc-bottom">
      <div className="enc-bottom-left">
        <div className="enc-progress-stat enc-mono" style={{ fontFamily: 'var(--font-jetbrains)' }}>
          Diagnoses &middot; <strong>3 in encounter</strong>
        </div>
        <div className="enc-progress-stat enc-mono" style={{ fontFamily: 'var(--font-jetbrains)' }}>
          Evidence &middot; <strong>2 confirmed &middot; 1 pending</strong>
        </div>
        <div className="enc-progress-stat enc-mono" style={{ fontFamily: 'var(--font-jetbrains)' }}>
          Plan &middot; <strong>1 of 3 dx generated</strong>
        </div>
      </div>
      <div className="enc-bottom-actions">
        <button
          className="enc-btn"
          style={{ fontFamily: 'var(--font-manrope)' }}
          onClick={onBack}
        >
          &larr; Back
        </button>
        <button
          className="enc-btn enc-btn-primary"
          style={{ fontFamily: 'var(--font-manrope)' }}
          onClick={onContinue}
        >
          Continue &rarr;
        </button>
      </div>
    </div>
  );
}
