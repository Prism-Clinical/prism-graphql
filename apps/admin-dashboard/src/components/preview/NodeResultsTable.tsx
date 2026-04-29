'use client';

import { useState } from 'react';
import type { NodeConfidenceResult } from '@/types';
import {
  confidenceTextColor,
  confidenceBarColor,
  resolutionLabel,
  resolutionBadgeClass,
} from './confidence-utils';

interface NodeResultsTableProps {
  nodes: NodeConfidenceResult[];
}

export function NodeResultsTable({ nodes }: NodeResultsTableProps) {
  const [expandedNode, setExpandedNode] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<'confidence' | 'type' | 'name'>('confidence');
  const [sortAsc, setSortAsc] = useState(false);

  const sorted = [...nodes].sort((a, b) => {
    let cmp = 0;
    if (sortBy === 'confidence') cmp = a.confidence - b.confidence;
    else if (sortBy === 'type') cmp = a.nodeType.localeCompare(b.nodeType);
    else cmp = a.nodeIdentifier.localeCompare(b.nodeIdentifier);
    return sortAsc ? cmp : -cmp;
  });

  const handleSort = (col: typeof sortBy) => {
    if (sortBy === col) setSortAsc(!sortAsc);
    else { setSortBy(col); setSortAsc(false); }
  };

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-gray-50 border-b border-gray-200">
            <th
              className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wider cursor-pointer hover:text-gray-700"
              onClick={() => handleSort('name')}
            >
              Node {sortBy === 'name' ? (sortAsc ? '↑' : '↓') : ''}
            </th>
            <th
              className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wider cursor-pointer hover:text-gray-700"
              onClick={() => handleSort('type')}
            >
              Type {sortBy === 'type' ? (sortAsc ? '↑' : '↓') : ''}
            </th>
            <th
              className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wider cursor-pointer hover:text-gray-700"
              onClick={() => handleSort('confidence')}
            >
              Confidence {sortBy === 'confidence' ? (sortAsc ? '↑' : '↓') : ''}
            </th>
            <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wider">
              Resolution
            </th>
            <th className="w-8" />
          </tr>
        </thead>
        <tbody>
          {sorted.map((node) => {
            const isExpanded = expandedNode === node.nodeIdentifier;
            const pct = Math.round(node.confidence * 100);

            return (
              <RowGroup key={node.nodeIdentifier}>
                <tr
                  className="border-b border-gray-100 hover:bg-gray-50 cursor-pointer transition-colors"
                  onClick={() => setExpandedNode(isExpanded ? null : node.nodeIdentifier)}
                >
                  <td className="px-4 py-2.5 font-mono text-xs text-gray-800 max-w-[200px] truncate">
                    {node.nodeIdentifier}
                  </td>
                  <td className="px-4 py-2.5">
                    <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-700 border border-gray-200 font-medium">
                      {node.nodeType}
                    </span>
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-2">
                      <div className="w-16 bg-gray-200 rounded-full h-1.5">
                        <div
                          className={`h-1.5 rounded-full ${confidenceBarColor(node.confidence)}`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <span className={`text-xs font-semibold ${confidenceTextColor(node.confidence)}`}>
                        {pct}%
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-2.5">
                    <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${resolutionBadgeClass(node.resolutionType)}`}>
                      {resolutionLabel(node.resolutionType)}
                    </span>
                  </td>
                  <td className="px-2 py-2.5 text-gray-400 text-xs">
                    {isExpanded ? '▼' : '▶'}
                  </td>
                </tr>

                {/* Expanded breakdown */}
                {isExpanded && node.breakdown.length > 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-3 bg-gray-50">
                      <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
                        Signal Breakdown
                      </div>
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="text-gray-400">
                            <th className="text-left py-1 pr-4 font-medium">Signal</th>
                            <th className="text-left py-1 pr-4 font-medium">Score</th>
                            <th className="text-left py-1 pr-4 font-medium">Weight</th>
                            <th className="text-left py-1 pr-4 font-medium">Source</th>
                            <th className="text-left py-1 font-medium">Missing Inputs</th>
                          </tr>
                        </thead>
                        <tbody>
                          {node.breakdown.map((b, i) => (
                            <tr key={i} className="border-t border-gray-200">
                              <td className="py-1.5 pr-4 font-medium text-gray-700">{b.signalName}</td>
                              <td className={`py-1.5 pr-4 font-semibold ${confidenceTextColor(b.score)}`}>
                                {Math.round(b.score * 100)}%
                              </td>
                              <td className="py-1.5 pr-4 text-gray-600">{b.weight.toFixed(2)}</td>
                              <td className="py-1.5 pr-4 text-gray-500 font-mono">{b.weightSource}</td>
                              <td className="py-1.5 text-gray-500">
                                {b.missingInputs.length > 0 ? (
                                  <span className="text-red-600">{b.missingInputs.join(', ')}</span>
                                ) : (
                                  <span className="text-green-600">None</span>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </td>
                  </tr>
                )}
              </RowGroup>
            );
          })}
        </tbody>
      </table>

      {sorted.length === 0 && (
        <div className="px-4 py-8 text-center text-gray-400 text-sm">
          No node results. Run simulation to see confidence scores.
        </div>
      )}
    </div>
  );
}

function RowGroup({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
