'use client';

import { useState } from 'react';
import clsx from 'clsx';
import { Button } from '@/components/ui/Button';
import Link from 'next/link';
import {
  ArrowUturnLeftIcon,
  ArrowUturnRightIcon,
  ArrowsPointingOutIcon,
  ViewColumnsIcon,
  ArrowUpTrayIcon,
  ArrowDownTrayIcon,
  DocumentDuplicateIcon,
  ArchiveBoxIcon,
  ArrowPathIcon,
  BeakerIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  ArrowLeftIcon,
} from '@heroicons/react/24/outline';
import type { PathwayStatus } from '@/types';

export type EditorMode = 'graph' | 'json';

interface EditorToolbarProps {
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onAutoLayout: () => void;
  onFitView: () => void;
  onSaveDraft?: () => void;
  onPublish?: () => void;
  onUpload?: () => void;
  onExport?: () => void;
  onCreateNewVersion?: () => void;
  onArchive?: () => void;
  onReactivate?: () => void;
  pathwayTitle: string;
  pathwayVersion: string;
  isDraft: boolean;
  isNewPathway?: boolean;
  pathwayStatus?: PathwayStatus;
  pathwayId?: string;
  isSaving?: boolean;
  editorMode?: EditorMode;
  onEditorModeChange?: (mode: EditorMode) => void;
}

const STATUS_BADGE: Record<PathwayStatus, { bg: string; text: string; label: string }> = {
  DRAFT: { bg: 'bg-amber-50 border-amber-200', text: 'text-amber-700', label: 'Draft' },
  ACTIVE: { bg: 'bg-green-50 border-green-200', text: 'text-green-700', label: 'Active' },
  ARCHIVED: { bg: 'bg-gray-100 border-gray-300', text: 'text-gray-600', label: 'Archived' },
  SUPERSEDED: { bg: 'bg-purple-50 border-purple-200', text: 'text-purple-700', label: 'Superseded' },
};

export function EditorToolbar({
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onAutoLayout,
  onFitView,
  onSaveDraft,
  onPublish,
  onUpload,
  onExport,
  onCreateNewVersion,
  onArchive,
  onReactivate,
  pathwayTitle,
  pathwayVersion,
  isDraft,
  isNewPathway = false,
  pathwayStatus,
  pathwayId,
  isSaving = false,
  editorMode,
  onEditorModeChange,
}: EditorToolbarProps) {
  const [toolbarOpen, setToolbarOpen] = useState(true);

  // Determine effective status for matrix logic
  const isNew = isNewPathway || !pathwayStatus;
  const isDraftStatus = pathwayStatus === 'DRAFT';
  const isActive = pathwayStatus === 'ACTIVE';
  const isArchived = pathwayStatus === 'ARCHIVED';

  // Toolbar matrix: show/hide per action
  const showUndo = isNew || isDraftStatus;
  const showAutoLayout = isNew || isDraftStatus;
  const showPublish = (isNew || isDraftStatus) && !!onPublish;
  const showUpload = (isNew || isDraftStatus) && !!onUpload;
  const showExport = !!onExport;
  const showCreateNewVersion = isActive && !!onCreateNewVersion;
  const showArchive = isActive && !!onArchive;
  const showReactivate = isArchived && !!onReactivate;

  const badge = pathwayStatus ? STATUS_BADGE[pathwayStatus] : null;

  return (
    <div className="bg-white border-b border-gray-200 flex-shrink-0">
      {/* ─── Row 1: Title bar (always visible) ─── */}
      <div className="h-12 px-4 flex items-center justify-between">
        {/* Left: Back + Title + Meta */}
        <div className="flex items-center gap-3 min-w-0 flex-1 mr-4">
          <Link
            href="/pathways"
            className="flex-shrink-0 inline-flex items-center gap-1.5 text-xs font-medium text-gray-500 hover:text-gray-700 transition-colors"
          >
            <ArrowLeftIcon className="h-3.5 w-3.5" />
            <span>All Pathways</span>
          </Link>
          <h1 className="text-base font-semibold text-gray-900 truncate min-w-0 flex-1 max-w-[600px]">
            {pathwayTitle || 'Untitled Pathway'}
          </h1>
          <span className="flex-shrink-0 text-xs font-mono text-gray-400">v{pathwayVersion}</span>
          {badge && (
            <span
              className={clsx(
                'flex-shrink-0 text-[10px] px-2 py-0.5 rounded-full border font-semibold uppercase tracking-wide',
                badge.bg,
                badge.text,
              )}
            >
              {badge.label}
            </span>
          )}
          {isNew && (
            <span className="flex-shrink-0 text-[10px] px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200 font-semibold uppercase tracking-wide">
              New
            </span>
          )}
        </div>

        {/* Right: Primary actions + toolbar toggle */}
        <div className="flex items-center gap-2">
          {/* Graph / JSON toggle */}
          {editorMode && onEditorModeChange && (
            <div className="inline-flex rounded-lg border border-gray-200 bg-gray-50 p-0.5 mr-1">
              <button
                onClick={() => onEditorModeChange('graph')}
                className={clsx(
                  'px-2.5 py-1 text-xs font-medium rounded-md transition-colors',
                  editorMode === 'graph'
                    ? 'bg-white text-gray-900 shadow-sm'
                    : 'text-gray-500 hover:text-gray-700',
                )}
              >
                Graph
              </button>
              <button
                onClick={() => onEditorModeChange('json')}
                className={clsx(
                  'px-2.5 py-1 text-xs font-medium rounded-md transition-colors',
                  editorMode === 'json'
                    ? 'bg-white text-gray-900 shadow-sm'
                    : 'text-gray-500 hover:text-gray-700',
                )}
              >
                JSON
              </button>
            </div>
          )}

          {/* Publish (primary action — drafts are autosaved) */}
          {showPublish && (
            <Button
              variant="primary"
              size="sm"
              onClick={onPublish}
              disabled={isSaving}
              isLoading={isSaving}
              leftIcon={<ArrowUpTrayIcon className="h-4 w-4" />}
            >
              Publish
            </Button>
          )}

          {/* Toolbar collapse toggle */}
          <button
            onClick={() => setToolbarOpen(!toolbarOpen)}
            className="p-1.5 rounded-md text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
            title={toolbarOpen ? 'Collapse toolbar' : 'Expand toolbar'}
          >
            {toolbarOpen ? (
              <ChevronUpIcon className="h-4 w-4" />
            ) : (
              <ChevronDownIcon className="h-4 w-4" />
            )}
          </button>
        </div>
      </div>

      {/* ─── Row 2: Collapsible action toolbar ─── */}
      {toolbarOpen && (
        <div className="h-10 px-4 flex items-center gap-1 border-t border-gray-100 bg-gray-50/50">
          {/* Undo / Redo */}
          {showUndo && (
            <>
              <Button
                variant="ghost"
                size="sm"
                onClick={onUndo}
                disabled={!canUndo || isSaving}
                leftIcon={<ArrowUturnLeftIcon className="h-4 w-4" />}
              >
                Undo
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={onRedo}
                disabled={!canRedo || isSaving}
                leftIcon={<ArrowUturnRightIcon className="h-4 w-4" />}
              >
                Redo
              </Button>
              <div className="w-px h-5 bg-gray-200 mx-1" />
            </>
          )}

          {/* View actions (hidden in JSON mode) */}
          {editorMode !== 'json' && (
            <>
              {showAutoLayout && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={onAutoLayout}
                  disabled={isSaving}
                  leftIcon={<ViewColumnsIcon className="h-4 w-4" />}
                >
                  Auto Layout
                </Button>
              )}
              <Button
                variant="ghost"
                size="sm"
                onClick={onFitView}
                disabled={isSaving}
                leftIcon={<ArrowsPointingOutIcon className="h-4 w-4" />}
              >
                Fit View
              </Button>
              <div className="w-px h-5 bg-gray-200 mx-1" />
            </>
          )}

          {/* File actions: Upload, Export */}
          {showUpload && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onUpload}
              disabled={isSaving}
              leftIcon={<ArrowUpTrayIcon className="h-4 w-4" />}
            >
              Upload
            </Button>
          )}
          {showExport && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onExport}
              disabled={isSaving}
              leftIcon={<ArrowDownTrayIcon className="h-4 w-4" />}
            >
              Export
            </Button>
          )}

          {/* Preview */}
          {pathwayId && !isNewPathway && (
            <>
              <div className="w-px h-5 bg-gray-200 mx-1" />
              <Link href={`/pathways/${pathwayId}/preview`}>
                <Button
                  variant="ghost"
                  size="sm"
                  leftIcon={<BeakerIcon className="h-4 w-4" />}
                >
                  Preview
                </Button>
              </Link>
            </>
          )}

          {/* Lifecycle actions */}
          {(showCreateNewVersion || showArchive || showReactivate) && (
            <>
              <div className="w-px h-5 bg-gray-200 mx-1" />
              {showCreateNewVersion && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={onCreateNewVersion}
                  disabled={isSaving}
                  leftIcon={<DocumentDuplicateIcon className="h-4 w-4" />}
                >
                  New Version
                </Button>
              )}
              {showArchive && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={onArchive}
                  disabled={isSaving}
                  leftIcon={<ArchiveBoxIcon className="h-4 w-4" />}
                >
                  Archive
                </Button>
              )}
              {showReactivate && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={onReactivate}
                  disabled={isSaving}
                  leftIcon={<ArrowPathIcon className="h-4 w-4" />}
                >
                  Reactivate
                </Button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
