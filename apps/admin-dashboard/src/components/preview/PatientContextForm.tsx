'use client';

import { useState, useCallback } from 'react';
import type { PatientContextInput, CodeInput, LabResultInput } from '@/types';
import { SAMPLE_PATIENTS } from './confidence-utils';

interface PatientContextFormProps {
  onSubmit: (context: PatientContextInput) => void;
  isLoading: boolean;
}

const CODE_SYSTEMS = ['ICD-10', 'SNOMED', 'RXNORM', 'LOINC', 'CPT'];

export function PatientContextForm({ onSubmit, isLoading }: PatientContextFormProps) {
  const [selectedPreset, setSelectedPreset] = useState<string>('reference');
  const [context, setContext] = useState<PatientContextInput>(
    SAMPLE_PATIENTS.reference.context,
  );

  const handlePresetChange = useCallback((key: string) => {
    setSelectedPreset(key);
    if (SAMPLE_PATIENTS[key]) {
      setContext({ ...SAMPLE_PATIENTS[key].context });
    }
  }, []);

  const handleSubmit = useCallback(() => {
    onSubmit(context);
  }, [context, onSubmit]);

  // ─── Code entry helpers ────────────────────────────────────────────

  const addCode = useCallback((field: 'conditionCodes' | 'medications' | 'allergies') => {
    setContext(prev => ({
      ...prev,
      [field]: [...prev[field], { code: '', system: 'ICD-10', display: '' }],
    }));
    setSelectedPreset('custom');
  }, []);

  const removeCode = useCallback((field: 'conditionCodes' | 'medications' | 'allergies', index: number) => {
    setContext(prev => ({
      ...prev,
      [field]: prev[field].filter((_, i) => i !== index),
    }));
    setSelectedPreset('custom');
  }, []);

  const updateCode = useCallback((field: 'conditionCodes' | 'medications' | 'allergies', index: number, updates: Partial<CodeInput>) => {
    setContext(prev => ({
      ...prev,
      [field]: prev[field].map((c, i) => i === index ? { ...c, ...updates } : c),
    }));
    setSelectedPreset('custom');
  }, []);

  const addLabResult = useCallback(() => {
    setContext(prev => ({
      ...prev,
      labResults: [...prev.labResults, { code: '', system: 'LOINC', display: '' }],
    }));
    setSelectedPreset('custom');
  }, []);

  const removeLabResult = useCallback((index: number) => {
    setContext(prev => ({
      ...prev,
      labResults: prev.labResults.filter((_, i) => i !== index),
    }));
    setSelectedPreset('custom');
  }, []);

  const updateLabResult = useCallback((index: number, updates: Partial<LabResultInput>) => {
    setContext(prev => ({
      ...prev,
      labResults: prev.labResults.map((l, i) => i === index ? { ...l, ...updates } : l),
    }));
    setSelectedPreset('custom');
  }, []);

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto p-4 space-y-5">
        {/* Preset selector */}
        <div>
          <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
            Patient Preset
          </label>
          <select
            value={selectedPreset}
            onChange={e => handlePresetChange(e.target.value)}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          >
            {Object.entries(SAMPLE_PATIENTS).map(([key, { label }]) => (
              <option key={key} value={key}>{label}</option>
            ))}
            {selectedPreset === 'custom' && <option value="custom">Custom</option>}
          </select>
        </div>

        {/* Patient ID */}
        <div>
          <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
            Patient ID
          </label>
          <input
            type="text"
            value={context.patientId}
            onChange={e => { setContext(prev => ({ ...prev, patientId: e.target.value })); setSelectedPreset('custom'); }}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        {/* Condition Codes */}
        <CodeSection
          title="Condition Codes"
          codes={context.conditionCodes}
          defaultSystem="ICD-10"
          onAdd={() => addCode('conditionCodes')}
          onRemove={(i) => removeCode('conditionCodes', i)}
          onUpdate={(i, u) => updateCode('conditionCodes', i, u)}
        />

        {/* Medications */}
        <CodeSection
          title="Medications"
          codes={context.medications}
          defaultSystem="RXNORM"
          onAdd={() => addCode('medications')}
          onRemove={(i) => removeCode('medications', i)}
          onUpdate={(i, u) => updateCode('medications', i, u)}
        />

        {/* Lab Results */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
              Lab Results ({context.labResults.length})
            </label>
            <button
              onClick={addLabResult}
              className="text-xs text-blue-600 hover:text-blue-800 font-medium"
            >
              + Add
            </button>
          </div>
          <div className="space-y-2">
            {context.labResults.map((lab, i) => (
              <div key={i} className="bg-gray-50 rounded-lg p-2.5 border border-gray-200">
                <div className="flex gap-2 mb-1.5">
                  <select
                    value={lab.system}
                    onChange={e => updateLabResult(i, { system: e.target.value })}
                    className="rounded border border-gray-300 px-2 py-1 text-xs w-24 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  >
                    {CODE_SYSTEMS.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                  <input
                    type="text"
                    placeholder="Code"
                    value={lab.code}
                    onChange={e => updateLabResult(i, { code: e.target.value })}
                    className="flex-1 rounded border border-gray-300 px-2 py-1 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                  <button
                    onClick={() => removeLabResult(i)}
                    className="text-gray-400 hover:text-red-500 text-xs px-1"
                  >
                    x
                  </button>
                </div>
                <input
                  type="text"
                  placeholder="Display name"
                  value={lab.display || ''}
                  onChange={e => updateLabResult(i, { display: e.target.value })}
                  className="w-full rounded border border-gray-300 px-2 py-1 text-xs mb-1.5 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
                <div className="flex gap-2">
                  <input
                    type="number"
                    placeholder="Value"
                    value={lab.value ?? ''}
                    onChange={e => updateLabResult(i, { value: e.target.value ? Number(e.target.value) : undefined })}
                    className="w-20 rounded border border-gray-300 px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                  <input
                    type="text"
                    placeholder="Unit"
                    value={lab.unit || ''}
                    onChange={e => updateLabResult(i, { unit: e.target.value })}
                    className="w-20 rounded border border-gray-300 px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                  <input
                    type="date"
                    value={lab.date || ''}
                    onChange={e => updateLabResult(i, { date: e.target.value })}
                    className="flex-1 rounded border border-gray-300 px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Allergies */}
        <CodeSection
          title="Allergies"
          codes={context.allergies}
          defaultSystem="RXNORM"
          onAdd={() => addCode('allergies')}
          onRemove={(i) => removeCode('allergies', i)}
          onUpdate={(i, u) => updateCode('allergies', i, u)}
        />
      </div>

      {/* Run button */}
      <div className="p-4 border-t border-gray-200 bg-white flex-shrink-0">
        <button
          onClick={handleSubmit}
          disabled={isLoading}
          className="w-full bg-gradient-to-b from-blue-500 to-blue-600 text-white rounded-xl px-4 py-2.5 text-sm font-medium shadow-md shadow-blue-500/25 hover:from-blue-600 hover:to-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all active:scale-[0.98]"
        >
          {isLoading ? 'Running Simulation...' : 'Run Simulation'}
        </button>
      </div>
    </div>
  );
}

// ─── Reusable code section ──────────────────────────────────────────

function CodeSection({
  title,
  codes,
  defaultSystem,
  onAdd,
  onRemove,
  onUpdate,
}: {
  title: string;
  codes: CodeInput[];
  defaultSystem: string;
  onAdd: () => void;
  onRemove: (i: number) => void;
  onUpdate: (i: number, updates: Partial<CodeInput>) => void;
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
          {title} ({codes.length})
        </label>
        <button
          onClick={onAdd}
          className="text-xs text-blue-600 hover:text-blue-800 font-medium"
        >
          + Add
        </button>
      </div>
      <div className="space-y-2">
        {codes.map((code, i) => (
          <div key={i} className="flex gap-2 items-center">
            <select
              value={code.system}
              onChange={e => onUpdate(i, { system: e.target.value })}
              className="rounded border border-gray-300 px-2 py-1 text-xs w-24 focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              {CODE_SYSTEMS.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            <input
              type="text"
              placeholder="Code"
              value={code.code}
              onChange={e => onUpdate(i, { code: e.target.value })}
              className="w-24 rounded border border-gray-300 px-2 py-1 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
            <input
              type="text"
              placeholder="Display"
              value={code.display || ''}
              onChange={e => onUpdate(i, { display: e.target.value })}
              className="flex-1 rounded border border-gray-300 px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
            <button
              onClick={() => onRemove(i)}
              className="text-gray-400 hover:text-red-500 text-xs px-1"
            >
              x
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
