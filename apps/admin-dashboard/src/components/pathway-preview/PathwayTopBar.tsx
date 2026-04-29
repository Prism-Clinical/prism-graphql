'use client';

import type { PathwayStatus } from '@/types';

interface PathwayTopBarProps {
  title: string;
  version: string;
  status: PathwayStatus;
  onToggleTheme: () => void;
}

const STATUS_STYLES: Record<PathwayStatus, { bg: string; label: string }> = {
  DRAFT: { bg: 'var(--warn)', label: 'Draft' },
  ACTIVE: { bg: 'var(--ok)', label: 'Active' },
  ARCHIVED: { bg: 'var(--ink-3)', label: 'Archived' },
  SUPERSEDED: { bg: 'var(--ink-4)', label: 'Superseded' },
};

export default function PathwayTopBar({ title, version, status, onToggleTheme }: PathwayTopBarProps) {
  const s = STATUS_STYLES[status] ?? STATUS_STYLES.DRAFT;

  return (
    <div className="enc-topbar">
      <div className="enc-brand">
        <div className="enc-brand-mark enc-display" style={{ fontFamily: 'var(--font-newsreader)' }}>
          Prism
        </div>
        <div className="enc-brand-divider" />
        <div className="enc-brand-dir" style={{ fontFamily: 'var(--font-manrope)' }}>
          Pathway Preview
        </div>
      </div>
      <div className="enc-top-right">
        <span
          style={{
            fontFamily: 'var(--font-manrope)',
            fontSize: 13,
            fontWeight: 500,
            color: '#fff',
            maxWidth: 300,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {title}
        </span>
        <span
          className="enc-emr-tag"
          style={{ fontFamily: 'var(--font-jetbrains)' }}
        >
          v{version}
        </span>
        <span
          style={{
            fontFamily: 'var(--font-manrope)',
            fontSize: 10,
            fontWeight: 700,
            textTransform: 'uppercase',
            letterSpacing: '.1em',
            padding: '3px 10px',
            borderRadius: 3,
            color: '#fff',
            background: s.bg,
          }}
        >
          {s.label}
        </span>
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
