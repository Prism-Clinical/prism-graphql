'use client';

import type { ConditionCodeDefinition } from '@/types';

interface PathwayConditionTrayProps {
  conditions: ConditionCodeDefinition[];
}

export default function PathwayConditionTray({ conditions }: PathwayConditionTrayProps) {
  if (conditions.length === 0) return null;

  return (
    <div className="enc-dx-tray">
      <div className="enc-dx-tray-label" style={{ fontFamily: 'var(--font-manrope)' }}>
        Conditions &middot; <strong>{conditions.length}</strong>
      </div>
      <div className="enc-dx-tray-list">
        {conditions.map((c) => (
          <div key={`${c.system}-${c.code}`} className="enc-dx-chip" style={{ cursor: 'default' }}>
            <span
              className="enc-dx-chip-src"
              style={{
                background: 'var(--brand)',
                borderRadius: 3,
                fontSize: 8,
                width: 14,
                height: 14,
              }}
            >
              C
            </span>
            <span className="enc-dx-chip-icd">{c.code}</span>
            <span className="enc-dx-chip-name">
              {c.description || c.code}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
