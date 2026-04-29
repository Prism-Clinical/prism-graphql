'use client';

import type { PathwayConfidenceResult, ResolutionType } from '@/types';
import { confidenceBarColor, confidenceTextColor, confidenceBg } from './confidence-utils';

interface ConfidenceOverviewProps {
  result: PathwayConfidenceResult;
}

export function ConfidenceOverview({ result }: ConfidenceOverviewProps) {
  const pct = Math.round(result.overallConfidence * 100);

  // Resolution type distribution
  const counts: Record<ResolutionType, number> = {
    AUTO_RESOLVED: 0,
    SYSTEM_SUGGESTED: 0,
    PROVIDER_DECIDED: 0,
    FORCED_MANUAL: 0,
  };
  for (const node of result.nodes) {
    if (node.resolutionType in counts) {
      counts[node.resolutionType as ResolutionType]++;
    }
  }

  return (
    <div className={`rounded-xl border p-5 ${confidenceBg(result.overallConfidence)}`}>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-gray-900">Overall Confidence</h3>
        <span className={`text-2xl font-bold ${confidenceTextColor(result.overallConfidence)}`}>
          {pct}%
        </span>
      </div>

      {/* Progress bar */}
      <div className="w-full bg-gray-200 rounded-full h-2.5 mb-4">
        <div
          className={`h-2.5 rounded-full transition-all duration-500 ${confidenceBarColor(result.overallConfidence)}`}
          style={{ width: `${pct}%` }}
        />
      </div>

      {/* Resolution distribution */}
      <div className="grid grid-cols-2 gap-2">
        <StatBox label="Auto-Resolved" count={counts.AUTO_RESOLVED} color="text-green-700 bg-green-50" />
        <StatBox label="System Suggested" count={counts.SYSTEM_SUGGESTED} color="text-blue-700 bg-blue-50" />
        <StatBox label="Provider Decision" count={counts.PROVIDER_DECIDED} color="text-yellow-700 bg-yellow-50" />
        <StatBox label="Manual Only" count={counts.FORCED_MANUAL} color="text-red-700 bg-red-50" />
      </div>

      <p className="text-xs text-gray-500 mt-3">
        {result.nodes.length} nodes scored
      </p>
    </div>
  );
}

function StatBox({ label, count, color }: { label: string; count: number; color: string }) {
  return (
    <div className={`rounded-lg px-3 py-2 ${color}`}>
      <div className="text-lg font-bold">{count}</div>
      <div className="text-xs font-medium">{label}</div>
    </div>
  );
}
