// src/components/editor/UploadHandler.tsx
'use client';

import { useRef, useState, useCallback, useEffect } from 'react';
import clsx from 'clsx';

interface UploadHandlerProps {
  /** Called with file contents as a string when a file is loaded */
  onFileLoaded: (content: string) => void;
  /** Whether upload is disabled (read-only mode) */
  disabled?: boolean;
  /** Ref that receives the file picker trigger function */
  triggerRef?: React.MutableRefObject<(() => void) | null>;
  /** Children are the drop zone — the entire editor area */
  children: React.ReactNode;
}

export function UploadHandler({ onFileLoaded, disabled = false, triggerRef, children }: UploadHandlerProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const dragCounterRef = useRef(0);

  const readFile = useCallback(
    (file: File) => {
      if (disabled) return;
      const reader = new FileReader();
      reader.onload = (e) => {
        const text = e.target?.result;
        if (typeof text === 'string') {
          onFileLoaded(text);
        }
      };
      reader.readAsText(file);
    },
    [onFileLoaded, disabled],
  );

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) readFile(file);
      // Reset so the same file can be re-selected
      e.target.value = '';
    },
    [readFile],
  );

  const handleDragEnter = useCallback(
    (e: React.DragEvent) => {
      if (disabled) return;
      e.preventDefault();
      dragCounterRef.current++;
      if (dragCounterRef.current === 1) {
        setIsDragOver(true);
      }
    },
    [disabled],
  );

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    dragCounterRef.current--;
    if (dragCounterRef.current === 0) {
      setIsDragOver(false);
    }
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      dragCounterRef.current = 0;
      setIsDragOver(false);
      if (disabled) return;
      const file = e.dataTransfer.files?.[0];
      if (file && file.name.endsWith('.json')) {
        readFile(file);
      }
    },
    [readFile, disabled],
  );

  /** Call this to open the file picker programmatically */
  const openFilePicker = useCallback(() => {
    if (disabled) return;
    fileInputRef.current?.click();
  }, [disabled]);

  // Expose openFilePicker to parent via ref
  useEffect(() => {
    if (triggerRef) {
      triggerRef.current = openFilePicker;
    }
    return () => {
      if (triggerRef) {
        triggerRef.current = null;
      }
    };
  }, [openFilePicker, triggerRef]);

  return (
    <div
      className="relative h-full w-full"
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      <input
        ref={fileInputRef}
        type="file"
        accept=".json"
        onChange={handleFileChange}
        className="hidden"
      />
      {children}
      {isDragOver && !disabled && (
        <div className="absolute inset-0 z-50 bg-blue-500/10 border-2 border-dashed border-blue-400 rounded-lg flex items-center justify-center pointer-events-none">
          <div className="bg-white/90 rounded-xl px-6 py-4 shadow-lg">
            <p className="text-sm font-medium text-blue-700">Drop .json file to import pathway</p>
          </div>
        </div>
      )}
    </div>
  );
}
