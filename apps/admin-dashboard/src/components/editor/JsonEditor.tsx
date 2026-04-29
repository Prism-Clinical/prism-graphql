// src/components/editor/JsonEditor.tsx
'use client';

import { useRef, useCallback, useEffect } from 'react';
import Editor, { type OnMount, type OnChange } from '@monaco-editor/react';
import type { editor } from 'monaco-editor';

interface JsonEditorProps {
  /** Current JSON string content */
  value: string;
  /** Called on every content change */
  onChange: (value: string) => void;
  /** Validation errors to display as markers */
  errors?: JsonEditorError[];
  /** Whether the editor is read-only */
  readOnly?: boolean;
}

export interface JsonEditorError {
  message: string;
  /** 1-based line number. If omitted, shown at line 1. */
  line?: number;
  /** 1-based column. If omitted, marks the whole line. */
  column?: number;
}

export function JsonEditor({ value, onChange, errors = [], readOnly = false }: JsonEditorProps) {
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<typeof import('monaco-editor') | null>(null);

  const handleMount: OnMount = useCallback((editor, monaco) => {
    editorRef.current = editor;
    monacoRef.current = monaco;

    // Configure JSON defaults
    monaco.languages.json.jsonDefaults.setDiagnosticsOptions({
      validate: true,
      allowComments: false,
      trailingCommas: 'error',
    });
  }, []);

  const handleChange: OnChange = useCallback(
    (newValue) => {
      if (newValue !== undefined) {
        onChange(newValue);
      }
    },
    [onChange],
  );

  // Update error markers when errors change
  useEffect(() => {
    const editor = editorRef.current;
    const monaco = monacoRef.current;
    if (!editor || !monaco) return;

    const model = editor.getModel();
    if (!model) return;

    const markers: editor.IMarkerData[] = errors.map((err) => ({
      severity: monaco.MarkerSeverity.Error,
      message: err.message,
      startLineNumber: err.line ?? 1,
      startColumn: err.column ?? 1,
      endLineNumber: err.line ?? 1,
      endColumn: err.column ?? model.getLineMaxColumn(err.line ?? 1),
    }));

    monaco.editor.setModelMarkers(model, 'pathway-validation', markers);
  }, [errors]);

  return (
    <div className="h-full w-full">
      <Editor
        language="json"
        theme="vs-light"
        value={value}
        onChange={handleChange}
        onMount={handleMount}
        options={{
          readOnly,
          minimap: { enabled: true },
          fontSize: 13,
          lineNumbers: 'on',
          scrollBeyondLastLine: false,
          wordWrap: 'on',
          tabSize: 2,
          formatOnPaste: true,
          folding: true,
          renderLineHighlight: 'all',
          automaticLayout: true,
          domReadOnly: readOnly,
        }}
        loading={
          <div className="flex items-center justify-center h-full text-sm text-gray-400">
            Loading editor...
          </div>
        }
      />
    </div>
  );
}
