// src/components/editor/SplitView.tsx
'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import clsx from 'clsx';

interface SplitViewProps {
  left: React.ReactNode;
  right: React.ReactNode;
  /** Initial width of left panel as percentage (0-100). Default: 40 */
  initialLeftPercent?: number;
  /** Minimum panel width in pixels. Default: 200 */
  minPanelWidth?: number;
}

export function SplitView({
  left,
  right,
  initialLeftPercent = 40,
  minPanelWidth = 200,
}: SplitViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [leftPercent, setLeftPercent] = useState(initialLeftPercent);
  const [isDragging, setIsDragging] = useState(false);
  const [collapsed, setCollapsed] = useState<'left' | 'right' | null>(null);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      const container = containerRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const percent = (x / rect.width) * 100;

      // Enforce minimum widths
      const minPercent = (minPanelWidth / rect.width) * 100;
      const maxPercent = 100 - minPercent;
      setLeftPercent(Math.min(maxPercent, Math.max(minPercent, percent)));
      setCollapsed(null);
    };

    const handleMouseUp = () => setIsDragging(false);

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, minPanelWidth]);

  const toggleCollapse = useCallback((side: 'left' | 'right') => {
    setCollapsed((prev) => (prev === side ? null : side));
  }, []);

  const leftWidth = collapsed === 'left' ? '0%' : collapsed === 'right' ? '100%' : `${leftPercent}%`;
  const rightWidth = collapsed === 'right' ? '0%' : collapsed === 'left' ? '100%' : `${100 - leftPercent}%`;

  return (
    <div ref={containerRef} className="flex h-full w-full overflow-hidden relative">
      {/* Left panel */}
      <div
        className={clsx('overflow-hidden transition-none', collapsed === 'left' && 'hidden')}
        style={{ width: leftWidth, flexShrink: 0 }}
      >
        {left}
      </div>

      {/* Divider */}
      <div
        className={clsx(
          'w-1 flex-shrink-0 bg-gray-200 hover:bg-blue-400 relative group',
          isDragging ? 'bg-blue-500 cursor-col-resize' : 'cursor-col-resize',
        )}
        onMouseDown={handleMouseDown}
      >
        {/* Collapse buttons */}
        <div className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 left-1/2 flex flex-col gap-1 opacity-0 group-hover:opacity-100 transition-opacity z-10">
          <button
            onClick={() => toggleCollapse('left')}
            className="w-5 h-5 rounded bg-gray-100 border border-gray-300 text-gray-500 hover:bg-blue-50 hover:text-blue-600 text-xs flex items-center justify-center"
            title={collapsed === 'left' ? 'Show JSON editor' : 'Hide JSON editor'}
          >
            {collapsed === 'left' ? '→' : '←'}
          </button>
          <button
            onClick={() => toggleCollapse('right')}
            className="w-5 h-5 rounded bg-gray-100 border border-gray-300 text-gray-500 hover:bg-blue-50 hover:text-blue-600 text-xs flex items-center justify-center"
            title={collapsed === 'right' ? 'Show graph editor' : 'Hide graph editor'}
          >
            {collapsed === 'right' ? '←' : '→'}
          </button>
        </div>
      </div>

      {/* Right panel */}
      <div
        className={clsx('overflow-hidden flex-1', collapsed === 'right' && 'hidden')}
        style={{ width: rightWidth }}
      >
        {right}
      </div>

      {/* Drag overlay to prevent iframe/canvas stealing mouse events */}
      {isDragging && <div className="absolute inset-0 z-50 cursor-col-resize" />}
    </div>
  );
}
