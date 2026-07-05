'use client';

/**
 * Preview-only lifecycle around the multi-pathway resolver.
 *
 * The pathway preview page fires two independent GraphQL calls off the
 * same "Run Simulation" click:
 *   1. GET_PATHWAY_CONFIDENCE — node-level confidence sim (existing).
 *   2. START_PREVIEW_MULTI_PATHWAY_RESOLUTION — full resolver + merge,
 *      returning a MergedCarePlan (this hook).
 *
 * Preview sessions are tagged `is_preview = true` server-side (migration
 * 061). This hook owns their cleanup so the sessions table doesn't
 * accumulate throwaway rows:
 *
 *   - On every new `run()` call, the *prior* session (if any) is
 *     hard-deleted BEFORE starting the new one. Cleanup errors are
 *     swallowed — a leaked row is annoying but shouldn't block the
 *     provider's next run.
 *   - On unmount, the current session is hard-deleted via the same path.
 *   - `reset()` clears local state + deletes the current session
 *     synchronously so the caller can await it if needed.
 *
 * Each run generates a fresh synthetic patientId so preview sessions
 * don't cross-contaminate each other's contributing per-pathway sessions
 * (those are keyed by patient_id + pathway_id).
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useMutation } from '@apollo/client/react';
import {
  START_PREVIEW_MULTI_PATHWAY_RESOLUTION,
  DELETE_PREVIEW_SESSION,
} from '@/lib/graphql/mutations/resolution';
import type {
  PatientContextInput,
  PreviewSession,
  MergedCarePlan,
} from '@/types';

export interface UsePreviewMergedPlanResult {
  sessionId: string | null;
  mergedPlan: MergedCarePlan | null;
  loading: boolean;
  error: string | null;
  /** Fire a preview resolution. Deletes any prior session first. */
  run: (
    pathwayId: string,
    patientContext: PatientContextInput,
    opts?: { includeDraftPathways?: boolean },
  ) => Promise<void>;
  /** Clear state + delete the current preview session. */
  reset: () => Promise<void>;
}

function newSyntheticPatientId(): string {
  // crypto.randomUUID is available in every browser we support (Next 15+
  // runtime) and in the Jest jsdom environment when polyfilled by
  // @next/jest. Fall back to a Date-based id if not present so unit tests
  // that don't polyfill still work.
  const cryptoAny = (globalThis as { crypto?: { randomUUID?: () => string } })
    .crypto;
  if (cryptoAny?.randomUUID) return cryptoAny.randomUUID();
  return `preview-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function usePreviewMergedPlan(): UsePreviewMergedPlanResult {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [mergedPlan, setMergedPlan] = useState<MergedCarePlan | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [startResolution, { loading }] = useMutation<{
    startMultiPathwayResolution: PreviewSession;
  }>(START_PREVIEW_MULTI_PATHWAY_RESOLUTION);
  const [deleteSession] = useMutation<{
    deletePreviewSession: { sessionId: string; contributingSessionsDeleted: number };
  }>(DELETE_PREVIEW_SESSION);

  // Keep the latest sessionId in a ref so the unmount cleanup effect,
  // which captures only its initial closure, can read the current value.
  const sessionIdRef = useRef<string | null>(null);
  useEffect(() => {
    sessionIdRef.current = sessionId;
  }, [sessionId]);

  const deleteIfAny = useCallback(
    async (idToDelete: string | null) => {
      if (!idToDelete) return;
      try {
        await deleteSession({ variables: { sessionId: idToDelete } });
      } catch (err) {
        // Cleanup best-effort: log and move on so a stale row can't block
        // the user's next action. Server-side is idempotent modulo NOT_FOUND
        // — the row either got cleaned or was already gone.
        // eslint-disable-next-line no-console
        console.warn('[usePreviewMergedPlan] delete failed:', err);
      }
    },
    [deleteSession],
  );

  const run = useCallback(
    async (
      pathwayId: string,
      patientContext: PatientContextInput,
      opts?: { includeDraftPathways?: boolean },
    ) => {
      setError(null);

      // Reap the previous session before starting a new one so preview
      // rows don't accumulate. Snapshot the id from state (not ref) so
      // React's batching guarantees we're deleting the one the user saw.
      const priorId = sessionIdRef.current;
      if (priorId) {
        await deleteIfAny(priorId);
        setSessionId(null);
      }

      const patientId = newSyntheticPatientId();
      try {
        const { data, errors } = await startResolution({
          variables: {
            patientId,
            patientContext: { ...patientContext, patientId },
            includeDraftPathways: opts?.includeDraftPathways ?? false,
          },
        });
        if (errors && errors.length > 0) {
          setError(errors.map((e) => e.message).join('; '));
          setMergedPlan(null);
          setSessionId(null);
          return;
        }
        const session = data?.startMultiPathwayResolution;
        if (!session) {
          setError('No preview session returned from server.');
          setMergedPlan(null);
          setSessionId(null);
          return;
        }
        setSessionId(session.id);
        setMergedPlan(session.mergedPlan);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        setError(message);
        setMergedPlan(null);
        setSessionId(null);
      }
    },
    [startResolution, deleteIfAny],
  );

  const reset = useCallback(async () => {
    const priorId = sessionIdRef.current;
    setSessionId(null);
    setMergedPlan(null);
    setError(null);
    await deleteIfAny(priorId);
  }, [deleteIfAny]);

  // Unmount cleanup — best-effort delete of whatever session was live
  // when the component tore down. Doesn't await because unmount is
  // sync from React's perspective; the fire-and-forget delete will land
  // before the next preview run in practice.
  useEffect(() => {
    return () => {
      const id = sessionIdRef.current;
      if (id) {
        void deleteIfAny(id);
      }
    };
  }, [deleteIfAny]);

  return { sessionId, mergedPlan, loading, error, run, reset };
}
