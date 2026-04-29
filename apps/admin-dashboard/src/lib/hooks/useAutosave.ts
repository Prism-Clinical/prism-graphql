'use client';

import { useState, useEffect, useRef, useCallback } from 'react';

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

interface UseAutosaveOptions {
  isDirty: boolean;
  isValid: boolean;
  enabled: boolean;
  onSave: () => Promise<void>;
  debounceMs?: number;
}

interface UseAutosaveResult {
  saveStatus: SaveStatus;
  resetTimer: () => void;
}

export function useAutosave({
  isDirty,
  isValid,
  enabled,
  onSave,
  debounceMs = 2000,
}: UseAutosaveOptions): UseAutosaveResult {
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isSavingRef = useRef(false);

  // After a save error, block retries until isDirty resets (i.e. a successful
  // save followed by a new user change). This prevents infinite retry loops
  // when the server consistently rejects the payload (e.g. validation errors).
  const saveFailedRef = useRef(false);

  // Store onSave in a ref so the effect doesn't re-trigger when the callback
  // identity changes (which happens every render due to closure over sync state).
  const onSaveRef = useRef(onSave);
  onSaveRef.current = onSave;

  const clearDebounce = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const resetTimer = useCallback(() => {
    clearDebounce();
    saveFailedRef.current = false;
  }, [clearDebounce]);

  useEffect(() => {
    // When isDirty resets to false (after a successful save), clear the
    // failure flag so the next dirty→true transition can trigger a save.
    if (!isDirty) {
      saveFailedRef.current = false;
    }

    if (!enabled || !isDirty || !isValid || saveFailedRef.current) {
      clearDebounce();
      return;
    }

    // Clear any prior debounce and restart
    clearDebounce();

    timerRef.current = setTimeout(async () => {
      timerRef.current = null;

      if (isSavingRef.current) return;

      isSavingRef.current = true;
      setSaveStatus('saving');

      try {
        await onSaveRef.current();
        setSaveStatus('saved');
        saveFailedRef.current = false;

        // Clear any prior "saved" fade timer
        if (savedTimerRef.current !== null) {
          clearTimeout(savedTimerRef.current);
        }
        savedTimerRef.current = setTimeout(() => {
          savedTimerRef.current = null;
          setSaveStatus('idle');
        }, 3000);
      } catch {
        setSaveStatus('error');
        saveFailedRef.current = true;
      } finally {
        isSavingRef.current = false;
      }
    }, debounceMs);

    return () => {
      clearDebounce();
    };
  }, [isDirty, isValid, enabled, debounceMs, clearDebounce]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
      if (savedTimerRef.current !== null) clearTimeout(savedTimerRef.current);
    };
  }, []);

  return { saveStatus, resetTimer };
}
