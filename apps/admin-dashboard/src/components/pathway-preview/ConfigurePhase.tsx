'use client';

import { useState, useCallback, useEffect } from 'react';
import type { PatientContextInput, CodeInput, LabResultInput } from '@/types';
import { SAMPLE_PATIENTS } from '@/components/preview/confidence-utils';
import { CodeSearchCombobox } from '@/components/editor/CodeSearchCombobox';

interface ConfigurePhaseProps {
  onContextChange: (context: PatientContextInput) => void;
  selectedPreset: string;
  onPresetChange: (preset: string) => void;
}

const CODE_SYSTEMS = ['ICD-10', 'SNOMED', 'RXNORM', 'LOINC', 'CPT'];

export default function ConfigurePhase({
  onContextChange,
  selectedPreset,
  onPresetChange,
}: ConfigurePhaseProps) {
  const [context, setContext] = useState<PatientContextInput>(
    SAMPLE_PATIENTS.reference.context,
  );

  // Report context changes to parent
  useEffect(() => {
    onContextChange(context);
  }, [context, onContextChange]);

  const handlePresetChange = useCallback((key: string) => {
    onPresetChange(key);
    if (SAMPLE_PATIENTS[key]) {
      setContext({ ...SAMPLE_PATIENTS[key].context });
    }
  }, [onPresetChange]);

  // Code entry helpers
  const addCode = useCallback((field: 'conditionCodes' | 'medications' | 'allergies') => {
    setContext(prev => ({
      ...prev,
      [field]: [...prev[field], { code: '', system: 'ICD-10', display: '' }],
    }));
    onPresetChange('custom');
  }, [onPresetChange]);

  const removeCode = useCallback((field: 'conditionCodes' | 'medications' | 'allergies', index: number) => {
    setContext(prev => ({
      ...prev,
      [field]: prev[field].filter((_, i) => i !== index),
    }));
    onPresetChange('custom');
  }, [onPresetChange]);

  const updateCode = useCallback((field: 'conditionCodes' | 'medications' | 'allergies', index: number, updates: Partial<CodeInput>) => {
    setContext(prev => ({
      ...prev,
      [field]: prev[field].map((c, i) => i === index ? { ...c, ...updates } : c),
    }));
    onPresetChange('custom');
  }, [onPresetChange]);

  const addLabResult = useCallback(() => {
    setContext(prev => ({
      ...prev,
      labResults: [...prev.labResults, { code: '', system: 'LOINC', display: '' }],
    }));
    onPresetChange('custom');
  }, [onPresetChange]);

  const removeLabResult = useCallback((index: number) => {
    setContext(prev => ({
      ...prev,
      labResults: prev.labResults.filter((_, i) => i !== index),
    }));
    onPresetChange('custom');
  }, [onPresetChange]);

  const updateLabResult = useCallback((index: number, updates: Partial<LabResultInput>) => {
    setContext(prev => ({
      ...prev,
      labResults: prev.labResults.map((l, i) => i === index ? { ...l, ...updates } : l),
    }));
    onPresetChange('custom');
  }, [onPresetChange]);

  return (
    <div className="enc-phase-content">
      <div className="enc-phase-heading">
        <div>
          <h1 className="enc-display" style={{ fontFamily: 'var(--font-newsreader)' }}>
            <em>Configure</em> Patient Context
          </h1>
          <p className="enc-subtitle" style={{ fontFamily: 'var(--font-manrope)' }}>
            Set up the patient context, adjust signal weights and evidence below, then run the simulation.
          </p>
        </div>
      </div>

      <div className="enc-intake-grid">
        {/* Door 1: Patient Preset */}
        <div className="enc-door-card">
          <div className="enc-door-head">
            <div className="enc-door-mark" style={{ background: 'var(--brand)' }}>1</div>
            <div className="enc-door-title-wrap">
              <div className="enc-door-title">Patient Preset</div>
              <div className="enc-door-sub">Select a sample patient</div>
            </div>
          </div>
          <div className="enc-door-body">
            <select
              value={selectedPreset}
              onChange={e => handlePresetChange(e.target.value)}
              style={{
                width: '100%',
                padding: '8px 12px',
                borderRadius: 6,
                border: '1px solid var(--rule)',
                background: 'var(--canvas)',
                color: 'var(--ink)',
                fontSize: 13,
                fontFamily: 'var(--font-manrope)',
              }}
            >
              {Object.entries(SAMPLE_PATIENTS).map(([key, { label }]) => (
                <option key={key} value={key}>{label}</option>
              ))}
              {selectedPreset === 'custom' && <option value="custom">Custom</option>}
            </select>

            {/* Condition codes summary */}
            <SectionLabel label="Condition Codes" count={context.conditionCodes.length} onAdd={() => addCode('conditionCodes')} />
            {context.conditionCodes.map((c, i) => (
              <CodeRow
                key={i}
                code={c}
                onUpdate={(u) => updateCode('conditionCodes', i, u)}
                onRemove={() => removeCode('conditionCodes', i)}
              />
            ))}

            {/* Medications */}
            <SectionLabel label="Medications" count={context.medications.length} onAdd={() => addCode('medications')} />
            {context.medications.map((c, i) => (
              <CodeRow
                key={i}
                code={c}
                onUpdate={(u) => updateCode('medications', i, u)}
                onRemove={() => removeCode('medications', i)}
              />
            ))}
          </div>
        </div>

        {/* Door 2: Context Summary */}
        <div className="enc-door-card">
          <div className="enc-door-head">
            <div className="enc-door-mark" style={{ background: 'var(--ai)' }}>2</div>
            <div className="enc-door-title-wrap">
              <div className="enc-door-title">Context Summary</div>
              <div className="enc-door-sub">Lab results & allergies</div>
            </div>
          </div>
          <div className="enc-door-body">
            {/* Lab Results */}
            <SectionLabel label="Lab Results" count={context.labResults.length} onAdd={addLabResult} />
            {context.labResults.map((lab, i) => (
              <LabRow
                key={i}
                lab={lab}
                onUpdate={(u) => updateLabResult(i, u)}
                onRemove={() => removeLabResult(i)}
              />
            ))}

            {/* Allergies */}
            <SectionLabel label="Allergies" count={context.allergies.length} onAdd={() => addCode('allergies')} />
            {context.allergies.map((c, i) => (
              <CodeRow
                key={i}
                code={c}
                onUpdate={(u) => updateCode('allergies', i, u)}
                onRemove={() => removeCode('allergies', i)}
              />
            ))}
          </div>
        </div>

      </div>
    </div>
  );
}

// ─── Shared Sub-Components ──────────────────────────────────────────

function SectionLabel({ label, count, onAdd }: { label: string; count: number; onAdd: () => void }) {
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginTop: 12,
      marginBottom: 4,
    }}>
      <span style={{
        fontSize: 10,
        fontWeight: 700,
        textTransform: 'uppercase',
        letterSpacing: '.12em',
        color: 'var(--ink-3)',
        fontFamily: 'var(--font-manrope)',
      }}>
        {label} ({count})
      </span>
      <button
        onClick={onAdd}
        style={{
          fontSize: 10,
          color: 'var(--brand)',
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          fontWeight: 600,
          fontFamily: 'var(--font-manrope)',
        }}
      >
        + Add
      </button>
    </div>
  );
}

function CodeRow({
  code,
  onUpdate,
  onRemove,
}: {
  code: CodeInput;
  onUpdate: (u: Partial<CodeInput>) => void;
  onRemove: () => void;
}) {
  const inputStyle: React.CSSProperties = {
    padding: '5px 8px',
    borderRadius: 4,
    border: '1px solid var(--rule)',
    background: 'var(--canvas)',
    color: 'var(--ink)',
    fontSize: 11,
    fontFamily: 'var(--font-jetbrains)',
  };

  return (
    <div style={{ display: 'flex', gap: 4, alignItems: 'center', marginBottom: 4 }}>
      <select
        value={code.system}
        onChange={e => onUpdate({ system: e.target.value })}
        style={{ ...inputStyle, width: 80 }}
      >
        {CODE_SYSTEMS.map(s => <option key={s} value={s}>{s}</option>)}
      </select>
      <div style={{ flex: 1 }}>
        <CodeSearchCombobox
          system={code.system}
          value={{ code: code.code, system: code.system, display: code.display }}
          onChange={(selected) => onUpdate({ code: selected.code, system: selected.system, display: selected.display })}
          placeholder="Search codes..."
        />
      </div>
      <button
        onClick={onRemove}
        style={{
          background: 'none',
          border: 'none',
          color: 'var(--ink-3)',
          cursor: 'pointer',
          fontSize: 14,
          padding: '0 4px',
        }}
      >
        &times;
      </button>
    </div>
  );
}

function LabRow({
  lab,
  onUpdate,
  onRemove,
}: {
  lab: LabResultInput;
  onUpdate: (u: Partial<LabResultInput>) => void;
  onRemove: () => void;
}) {
  const inputStyle: React.CSSProperties = {
    padding: '5px 8px',
    borderRadius: 4,
    border: '1px solid var(--rule)',
    background: 'var(--canvas)',
    color: 'var(--ink)',
    fontSize: 11,
    fontFamily: 'var(--font-jetbrains)',
  };

  return (
    <div style={{ background: 'var(--canvas)', border: '1px solid var(--rule)', borderRadius: 6, padding: 8, marginBottom: 4 }}>
      <div style={{ display: 'flex', gap: 4, marginBottom: 4, alignItems: 'center' }}>
        <div style={{ flex: 1 }}>
          <CodeSearchCombobox
            system="LOINC"
            value={{ code: lab.code, system: lab.system || 'LOINC', display: lab.display }}
            onChange={(selected) => onUpdate({ code: selected.code, system: selected.system, display: selected.display })}
            placeholder="Search lab codes..."
          />
        </div>
        <button
          onClick={onRemove}
          style={{ background: 'none', border: 'none', color: 'var(--ink-3)', cursor: 'pointer', fontSize: 14 }}
        >
          &times;
        </button>
      </div>
      <div style={{ display: 'flex', gap: 4 }}>
        <input
          type="number"
          placeholder="Value"
          value={lab.value ?? ''}
          onChange={e => onUpdate({ value: e.target.value ? Number(e.target.value) : undefined })}
          style={{ ...inputStyle, width: 60 }}
        />
        <input
          type="text"
          placeholder="Unit"
          value={lab.unit || ''}
          onChange={e => onUpdate({ unit: e.target.value })}
          style={{ ...inputStyle, width: 60 }}
        />
        <input
          type="date"
          value={lab.date || ''}
          onChange={e => onUpdate({ date: e.target.value })}
          style={{ ...inputStyle, flex: 1 }}
        />
      </div>
    </div>
  );
}
