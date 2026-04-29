'use client';

import { useRef } from 'react';
import { Diagnosis, SOURCE_LABEL, DX_SUGGESTIONS } from './types';

interface DiagnosisTrayProps {
  diagnoses: Diagnosis[];
  dxInputValue: string;
  dxSuggestOpen: boolean;
  onRemoveDx: (id: string) => void;
  onAddManualDx: (icd: string, name: string) => void;
  onInputChange: (value: string) => void;
  onInputFocus: () => void;
  onInputBlur: () => void;
}

export default function DiagnosisTray({
  diagnoses,
  dxInputValue,
  dxSuggestOpen,
  onRemoveDx,
  onAddManualDx,
  onInputChange,
  onInputFocus,
  onInputBlur,
}: DiagnosisTrayProps) {
  const blurTimeout = useRef<NodeJS.Timeout>();

  const handleBlur = () => {
    blurTimeout.current = setTimeout(onInputBlur, 200);
  };

  return (
    <div className="enc-dx-tray">
      <div className="enc-dx-tray-label enc-mono" style={{ fontFamily: 'var(--font-jetbrains)' }}>
        Encounter Dx <strong>{diagnoses.length}</strong>
      </div>
      <div className="enc-dx-tray-list">
        {diagnoses.map((dx) => (
          <div key={dx.id} className="enc-dx-chip" style={{ fontFamily: 'var(--font-manrope)' }}>
            <div className={`enc-dx-chip-src ${dx.source}`} style={{ fontFamily: 'var(--font-jetbrains)' }}>
              {SOURCE_LABEL[dx.source]}
            </div>
            <span className="enc-dx-chip-icd enc-mono" style={{ fontFamily: 'var(--font-jetbrains)' }}>
              {dx.icd}
            </span>
            <span className="enc-dx-chip-name">{dx.name}</span>
            <span
              className="enc-dx-chip-x"
              onClick={(e) => { e.stopPropagation(); onRemoveDx(dx.id); }}
            >
              &times;
            </span>
          </div>
        ))}
        <div className="enc-dx-quickadd">
          <span className="enc-dx-quickadd-icon">+</span>
          <input
            type="text"
            className="enc-dx-quickadd-input"
            style={{ fontFamily: 'var(--font-manrope)' }}
            placeholder="Add diagnosis\u2026"
            value={dxInputValue}
            onChange={(e) => onInputChange(e.target.value)}
            onFocus={onInputFocus}
            onBlur={handleBlur}
          />
          <button className="enc-dx-quickadd-voice" title="Voice add">
            &#127908;
          </button>
        </div>
      </div>

      <div className={`enc-dx-suggest ${dxSuggestOpen && dxInputValue.length > 0 ? 'open' : ''}`}>
        <div className="enc-dx-suggest-h enc-mono" style={{ fontFamily: 'var(--font-jetbrains)' }}>
          &#9671; Manual Add &mdash; ICD-10 Search
        </div>
        {DX_SUGGESTIONS.map((s) => (
          <div
            key={s.icd}
            className="enc-dx-suggest-item"
            style={{ fontFamily: 'var(--font-manrope)' }}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onAddManualDx(s.icd, s.name)}
          >
            <div className="enc-dx-suggest-item-icd enc-mono" style={{ fontFamily: 'var(--font-jetbrains)' }}>
              {s.icd}
            </div>
            <div className="enc-dx-suggest-item-name">{s.name}</div>
            <div className="enc-dx-suggest-item-cat enc-mono" style={{ fontFamily: 'var(--font-jetbrains)' }}>
              {s.category}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
