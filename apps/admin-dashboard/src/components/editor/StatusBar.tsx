// src/components/editor/StatusBar.tsx
'use client';

import clsx from 'clsx';
import type { PathwayStatus } from '@/types';
import type { ClientValidationResult } from '@/lib/pathway-json/validator';
import type { JsonEditorError } from '@/components/editor/JsonEditor';
import type { SaveStatus } from '@/lib/hooks/useAutosave';

interface StatusBarProps {
  pathwayStatus?: PathwayStatus;
  jsonErrors: JsonEditorError[];
  validationResult: ClientValidationResult | null;
  isDirty: boolean;
  saveStatus?: SaveStatus;
}

const STATUS_STYLES: Record<PathwayStatus, string> = {
  DRAFT: 'bg-amber-50 text-amber-700 border-amber-200',
  ACTIVE: 'bg-green-50 text-green-700 border-green-200',
  ARCHIVED: 'bg-gray-50 text-gray-500 border-gray-200',
  SUPERSEDED: 'bg-purple-50 text-purple-700 border-purple-200',
};

export function StatusBar({ pathwayStatus, jsonErrors, validationResult, isDirty, saveStatus = 'idle' }: StatusBarProps) {
  const hasJsonErrors = jsonErrors.length > 0;
  const validationErrors = validationResult?.errors ?? [];
  const hasValidationErrors = validationErrors.length > 0;

  return (
    <div className="h-7 bg-gray-50 border-t border-gray-200 px-4 flex items-center justify-between text-xs flex-shrink-0">
      {/* Left: errors */}
      <div className="flex items-center gap-3">
        {hasJsonErrors && (
          <span className="text-red-600 flex items-center gap-1">
            <span className="inline-block w-2 h-2 rounded-full bg-red-500" />
            {jsonErrors.length} syntax {jsonErrors.length === 1 ? 'error' : 'errors'}
          </span>
        )}
        {!hasJsonErrors && hasValidationErrors && (
          <span className="text-amber-600 flex items-center gap-1">
            <span className="inline-block w-2 h-2 rounded-full bg-amber-500" />
            {validationErrors.length} validation {validationErrors.length === 1 ? 'error' : 'errors'}
          </span>
        )}
        {!hasJsonErrors && !hasValidationErrors && (
          <span className="text-green-600 flex items-center gap-1">
            <span className="inline-block w-2 h-2 rounded-full bg-green-500" />
            Valid
          </span>
        )}
      </div>

      {/* Right: save status + pathway status */}
      <div className="flex items-center gap-3">
        {saveStatus === 'saving' && (
          <span className="text-blue-500 flex items-center gap-1">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
            Saving...
          </span>
        )}
        {saveStatus === 'saved' && (
          <span className="text-green-600 flex items-center gap-1">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-green-500" />
            Saved
          </span>
        )}
        {saveStatus === 'error' && (
          <span className="text-red-500 flex items-center gap-1">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-red-500" />
            Save failed
          </span>
        )}
        {saveStatus === 'idle' && isDirty && (
          <span className="text-gray-500 flex items-center gap-1">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-gray-400" />
            Unsaved changes
          </span>
        )}
        {pathwayStatus && (
          <span
            className={clsx(
              'px-2 py-0.5 rounded border text-[10px] font-medium uppercase tracking-wide',
              STATUS_STYLES[pathwayStatus],
            )}
          >
            {pathwayStatus}
          </span>
        )}
      </div>
    </div>
  );
}
