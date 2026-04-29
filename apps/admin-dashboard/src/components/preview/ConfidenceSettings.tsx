'use client';

import { useState, useCallback, useEffect } from 'react';
import { useQuery, useMutation } from '@apollo/client/react';
import { GET_SIGNAL_DEFINITIONS, GET_EFFECTIVE_THRESHOLDS } from '@/lib/graphql/queries/pathways';
import { SET_SIGNAL_WEIGHT, SET_RESOLUTION_THRESHOLDS } from '@/lib/graphql/mutations/pathways';
import type { SignalDefinitionInfo, ResolvedThresholds } from '@/types';

interface ConfidenceSettingsProps {
  pathwayId: string;
}

const SIGNAL_DISPLAY_NAMES: Record<string, string> = {
  data_completeness: 'Data Completeness',
  evidence_strength: 'Evidence Strength',
  match_quality: 'Match Quality',
  risk_magnitude: 'Risk Magnitude',
};

export function ConfidenceSettings({ pathwayId }: ConfidenceSettingsProps) {
  const { data: signalData, loading: signalsLoading } = useQuery<{
    signalDefinitions: SignalDefinitionInfo[];
  }>(GET_SIGNAL_DEFINITIONS, {
    variables: { scope: 'SYSTEM' },
  });

  const { data: thresholdData, loading: thresholdsLoading } = useQuery<{
    effectiveThresholds: ResolvedThresholds;
  }>(GET_EFFECTIVE_THRESHOLDS, {
    variables: { pathwayId },
  });

  const [setSignalWeight, { loading: savingWeight }] = useMutation(SET_SIGNAL_WEIGHT);
  const [setThresholds, { loading: savingThresholds }] = useMutation(SET_RESOLUTION_THRESHOLDS);

  // Local state for weight sliders
  const [weights, setWeights] = useState<Record<string, number>>({});
  const [autoResolve, setAutoResolve] = useState(0.85);
  const [suggest, setSuggest] = useState(0.60);
  const [savedSignals, setSavedSignals] = useState<Set<string>>(new Set());
  const [savedThresholds, setSavedThresholds] = useState(false);

  // Sync from query data
  useEffect(() => {
    if (signalData?.signalDefinitions) {
      const w: Record<string, number> = {};
      for (const s of signalData.signalDefinitions) {
        w[s.id] = s.defaultWeight;
      }
      setWeights(w);
    }
  }, [signalData]);

  useEffect(() => {
    if (thresholdData?.effectiveThresholds) {
      setAutoResolve(thresholdData.effectiveThresholds.autoResolveThreshold);
      setSuggest(thresholdData.effectiveThresholds.suggestThreshold);
    }
  }, [thresholdData]);

  const handleSaveWeight = useCallback(async (signalId: string) => {
    try {
      await setSignalWeight({
        variables: {
          input: {
            signalDefinitionId: signalId,
            weight: weights[signalId],
            scope: 'PATHWAY',
            pathwayId,
          },
        },
      });
      setSavedSignals(prev => new Set(prev).add(signalId));
      setTimeout(() => setSavedSignals(prev => {
        const next = new Set(prev);
        next.delete(signalId);
        return next;
      }), 2000);
    } catch (err) {
      console.error('Failed to save signal weight:', err);
    }
  }, [weights, pathwayId, setSignalWeight]);

  const handleSaveThresholds = useCallback(async () => {
    if (suggest >= autoResolve) return;
    try {
      await setThresholds({
        variables: {
          input: {
            autoResolveThreshold: autoResolve,
            suggestThreshold: suggest,
            scope: 'PATHWAY',
            pathwayId,
          },
        },
      });
      setSavedThresholds(true);
      setTimeout(() => setSavedThresholds(false), 2000);
    } catch (err) {
      console.error('Failed to save thresholds:', err);
    }
  }, [autoResolve, suggest, pathwayId, setThresholds]);

  const signals = signalData?.signalDefinitions ?? [];
  const isLoading = signalsLoading || thresholdsLoading;

  if (isLoading) {
    return (
      <div className="p-4 text-center text-sm text-gray-500">
        Loading settings...
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto px-4 py-3 space-y-6">
      {/* Signal Weights Section */}
      <div>
        <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">
          Signal Weights
        </h3>
        <div className="space-y-4">
          {signals.filter(s => s.isActive).map((signal) => (
            <div key={signal.id} className="bg-gray-50 rounded-lg p-3">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-medium text-gray-700">
                  {SIGNAL_DISPLAY_NAMES[signal.name] || signal.displayName}
                </span>
                <span className="text-xs font-mono text-gray-500">
                  {(weights[signal.id] ?? signal.defaultWeight).toFixed(2)}
                </span>
              </div>
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={weights[signal.id] ?? signal.defaultWeight}
                onChange={(e) => setWeights(prev => ({
                  ...prev,
                  [signal.id]: parseFloat(e.target.value),
                }))}
                className="w-full h-1.5 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-blue-600"
              />
              <div className="flex items-center justify-between mt-1.5">
                <span className="text-[10px] text-gray-400">
                  Default: {signal.defaultWeight.toFixed(2)}
                </span>
                <button
                  onClick={() => handleSaveWeight(signal.id)}
                  disabled={savingWeight}
                  className="text-[10px] font-medium px-2 py-0.5 rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 transition-colors"
                >
                  {savedSignals.has(signal.id) ? 'Saved' : 'Save'}
                </button>
              </div>
            </div>
          ))}
          {signals.length === 0 && (
            <p className="text-xs text-gray-400">No signal definitions found.</p>
          )}
        </div>
      </div>

      {/* Resolution Thresholds Section */}
      <div>
        <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">
          Resolution Thresholds
        </h3>
        <div className="bg-gray-50 rounded-lg p-3 space-y-3">
          {/* Visual scale */}
          <div className="relative h-6 rounded-full overflow-hidden bg-gray-200">
            <div
              className="absolute inset-y-0 left-0 bg-red-200"
              style={{ width: `${suggest * 100}%` }}
            />
            <div
              className="absolute inset-y-0 bg-yellow-200"
              style={{ left: `${suggest * 100}%`, width: `${(autoResolve - suggest) * 100}%` }}
            />
            <div
              className="absolute inset-y-0 right-0 bg-green-200"
              style={{ left: `${autoResolve * 100}%` }}
            />
            {/* Threshold markers */}
            <div
              className="absolute top-0 bottom-0 w-0.5 bg-yellow-600"
              style={{ left: `${suggest * 100}%` }}
            />
            <div
              className="absolute top-0 bottom-0 w-0.5 bg-green-600"
              style={{ left: `${autoResolve * 100}%` }}
            />
          </div>
          <div className="flex justify-between text-[9px] text-gray-500">
            <span>PROVIDER_DECIDED</span>
            <span>SYSTEM_SUGGESTED</span>
            <span>AUTO_RESOLVED</span>
          </div>

          {/* Suggest threshold */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs text-gray-700">Suggest Threshold</label>
              <span className="text-xs font-mono text-gray-500">{suggest.toFixed(2)}</span>
            </div>
            <input
              type="range"
              min="0"
              max="0.95"
              step="0.05"
              value={suggest}
              onChange={(e) => {
                const val = parseFloat(e.target.value);
                setSuggest(val);
                if (val >= autoResolve) setAutoResolve(Math.min(1.0, val + 0.05));
              }}
              className="w-full h-1.5 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-yellow-600"
            />
          </div>

          {/* Auto-resolve threshold */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs text-gray-700">Auto-Resolve Threshold</label>
              <span className="text-xs font-mono text-gray-500">{autoResolve.toFixed(2)}</span>
            </div>
            <input
              type="range"
              min="0.05"
              max="1"
              step="0.05"
              value={autoResolve}
              onChange={(e) => {
                const val = parseFloat(e.target.value);
                setAutoResolve(val);
                if (val <= suggest) setSuggest(Math.max(0, val - 0.05));
              }}
              className="w-full h-1.5 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-green-600"
            />
          </div>

          {suggest >= autoResolve && (
            <p className="text-[10px] text-red-500">Suggest threshold must be less than auto-resolve threshold.</p>
          )}

          <div className="flex justify-end">
            <button
              onClick={handleSaveThresholds}
              disabled={savingThresholds || suggest >= autoResolve}
              className="text-[10px] font-medium px-2 py-0.5 rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 transition-colors"
            >
              {savedThresholds ? 'Saved' : 'Save Thresholds'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
