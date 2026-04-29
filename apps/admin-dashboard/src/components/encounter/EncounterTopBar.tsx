'use client';

interface EncounterTopBarProps {
  onToggleTheme: () => void;
}

export default function EncounterTopBar({ onToggleTheme }: EncounterTopBarProps) {
  return (
    <div className="enc-topbar">
      <div className="enc-brand">
        <div className="enc-brand-mark enc-display" style={{ fontFamily: 'var(--font-newsreader)' }}>
          Prism
        </div>
        <div className="enc-brand-divider" />
        <div className="enc-brand-dir" style={{ fontFamily: 'var(--font-manrope)' }}>
          Clinical Encounter
        </div>
      </div>
      <div className="enc-top-right">
        <div className="enc-listening" style={{ fontFamily: 'var(--font-manrope)' }}>
          <div className="enc-listen-dot" />
          Listening
        </div>
        <div className="enc-emr-tag" style={{ fontFamily: 'var(--font-jetbrains)' }}>
          EHR &middot; athenahealth
        </div>
        <button
          className="enc-theme-btn"
          style={{ fontFamily: 'var(--font-jetbrains)' }}
          onClick={onToggleTheme}
        >
          Theme
        </button>
      </div>
    </div>
  );
}
