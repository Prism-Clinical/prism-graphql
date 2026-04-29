'use client';

import { Button } from '@/components/ui/Button';
import type { ImportPathwayResult, ImportDiffSummary, DiffDetail } from '@/types';

interface DiffReviewModalProps {
  result: ImportPathwayResult;
  oldVersion: string;
  onActivate: () => void;
  onKeepDraft: () => void;
  isActivating: boolean;
}

function StatBadge({ label, count, color }: { label: string; count: number; color: string }) {
  if (count === 0) return null;
  const colorClasses: Record<string, string> = {
    green: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    red: 'bg-red-50 text-red-700 border-red-200',
    yellow: 'bg-amber-50 text-amber-700 border-amber-200',
  };
  return (
    <span className={`inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-full border ${colorClasses[color]}`}>
      {color === 'green' ? '+' : color === 'red' ? '-' : '~'}{count} {label}
    </span>
  );
}

function SummaryBar({ summary }: { summary: ImportDiffSummary }) {
  return (
    <div className="flex flex-wrap gap-2">
      <StatBadge label="nodes added" count={summary.nodesAdded} color="green" />
      <StatBadge label="nodes removed" count={summary.nodesRemoved} color="red" />
      <StatBadge label="nodes modified" count={summary.nodesModified} color="yellow" />
      <StatBadge label="edges added" count={summary.edgesAdded} color="green" />
      <StatBadge label="edges removed" count={summary.edgesRemoved} color="red" />
      <StatBadge label="edges modified" count={summary.edgesModified} color="yellow" />
    </div>
  );
}

function DetailTable({ details }: { details: DiffDetail[] }) {
  if (details.length === 0) {
    return <p className="text-sm text-gray-500 italic">No detailed changes available.</p>;
  }

  const grouped = {
    added: details.filter((d) => d.action === 'ADDED'),
    removed: details.filter((d) => d.action === 'REMOVED'),
    modified: details.filter((d) => d.action === 'MODIFIED'),
  };

  return (
    <div className="max-h-64 overflow-y-auto border border-gray-200 rounded-lg divide-y divide-gray-100">
      {(['added', 'removed', 'modified'] as const).map((group) => {
        const items = grouped[group];
        if (items.length === 0) return null;
        const headerColors: Record<string, string> = {
          added: 'bg-emerald-50 text-emerald-800',
          removed: 'bg-red-50 text-red-800',
          modified: 'bg-amber-50 text-amber-800',
        };
        return (
          <div key={group}>
            <div className={`px-3 py-1.5 text-xs font-semibold uppercase ${headerColors[group]}`}>
              {group} ({items.length})
            </div>
            {items.map((item, i) => (
              <div key={`${group}-${i}`} className="px-3 py-2 flex items-center gap-3 text-sm">
                <span className="text-gray-500 font-mono text-xs w-24 flex-shrink-0">{item.entityType}</span>
                <span className="text-gray-900">{item.entityLabel || item.entityId}</span>
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}

export function DiffReviewModal({
  result,
  oldVersion,
  onActivate,
  onKeepDraft,
  isActivating,
}: DiffReviewModalProps) {
  const newVersion = result.pathway?.version ?? '?';
  const diff = result.diff;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop — non-dismissable */}
      <div className="absolute inset-0 bg-black/50" />

      {/* Modal */}
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-lg mx-4 overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">
            Review Changes — v{oldVersion} → v{newVersion}
          </h2>
        </div>

        {/* Body */}
        <div className="px-6 py-4 space-y-4">
          {diff ? (
            <>
              <SummaryBar summary={diff.summary} />
              <DetailTable details={diff.details} />
            </>
          ) : (
            <p className="text-sm text-gray-500">No diff information available.</p>
          )}

          {result.validation.warnings.length > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
              <p className="text-xs font-medium text-amber-800 mb-1">Warnings</p>
              <ul className="text-xs text-amber-700 space-y-0.5">
                {result.validation.warnings.map((w, i) => (
                  <li key={i}>• {w}</li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-200 flex items-center justify-end gap-3">
          <Button
            variant="secondary"
            onClick={onKeepDraft}
            disabled={isActivating}
          >
            Keep as Draft
          </Button>
          <Button
            variant="primary"
            onClick={onActivate}
            isLoading={isActivating}
          >
            Activate Now
          </Button>
        </div>
      </div>
    </div>
  );
}
