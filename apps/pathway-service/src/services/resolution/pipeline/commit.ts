import { GraphQLError } from 'graphql';
import type { Pool } from 'pg';
import { getSession, logEvent, statusChangesBetween, writeEvaluation, writeLlmAudits } from '../session-store';
import type { Db } from '../session-store';
import { ResolutionSession, SessionStatus } from '../types';
import { EvaluationRequest, evaluateSession, inTransaction, newRequest, persistedObservations, RevisionConflict } from './request';
import type { EvaluationResult, SessionInputs } from './types';

/** Server-side retries on a revision conflict (D9). */
export const MAX_ATTEMPTS = 3;

/** What a mutation contributes to a commit: new inputs, the audit event, analytics rows. */
export interface Change {
  inputs: SessionInputs;
  event: { eventType: string; triggerData: unknown };
  /** Written in the same transaction as the result. */
  record?: (db: Db, result: EvaluationResult) => Promise<void>;
}

export async function loadSession(pool: Pool, sessionId: string): Promise<ResolutionSession> {
  const session = await getSession(pool, sessionId);
  if (!session) throw new GraphQLError('Session not found', { extensions: { code: 'NOT_FOUND' } });
  return session;
}

export function assertMutable(session: ResolutionSession): void {
  if (session.status !== SessionStatus.ACTIVE && session.status !== SessionStatus.DEGRADED) {
    throw new GraphQLError(`Cannot modify session with status "${session.status}"`, {
      extensions: { code: 'BAD_USER_INPUT' },
    });
  }
}

export const statusOf = (result: EvaluationResult): SessionStatus =>
  result.status === 'DEGRADED' ? SessionStatus.DEGRADED : SessionStatus.ACTIVE;

export const conflictError = (): GraphQLError =>
  new GraphQLError(`Session changed concurrently on ${MAX_ATTEMPTS} attempts; reload and retry`, {
    extensions: { code: 'CONFLICT' },
  });

/** A child of a run changes only through its run (D6); alone, it would bypass the run's lock. */
export const childOfRunError = (): GraphQLError =>
  new GraphQLError('This session is part of a multi-pathway run; change, generate or abandon it through the run', {
    extensions: { code: 'CHILD_OF_MULTI_PATHWAY_SESSION' },
  });

/** Audit rows of calls whose attempt did not commit (spec §4, best effort). */
export async function flushAudits(pool: Pool, sessionId: string, request: EvaluationRequest): Promise<void> {
  if (request.audits.length === 0) return;
  await inTransaction(pool, (db) => writeLlmAudits(db, sessionId, request.audits));
  request.audits.length = 0;
}

/**
 * Run a request's attempts. However they end — committed, out of retries, a
 * later attempt rejected at the boundary, the session completed or abandoned
 * underneath, an evaluation or database error — the audit rows of LLM calls
 * no committed transaction wrote are written in their own (spec §4, Audit).
 * After a winning commit there are none left, so this is a no-op. A failure to
 * write them is logged and never masks the request's own outcome.
 */
export async function withAudits<T>(
  pool: Pool,
  sessionId: string,
  request: EvaluationRequest,
  body: () => Promise<T>,
): Promise<T> {
  try {
    return await body();
  } finally {
    await flushAudits(pool, sessionId, request).catch((err) =>
      console.error(`[audit] could not write ${request.audits.length} LLM audit rows for session ${sessionId}:`, err),
    );
  }
}

/**
 * The one write path (spec §4). Each attempt reloads the session, asks the
 * mutation for its change (boundary validation throws here and is never
 * retried), evaluates from scratch, and commits under the revision it read.
 * Observations acquired by an earlier attempt are reused while their keys
 * still match (D9). Audit rows go out with the winning commit; `withAudits`
 * writes them on every other exit.
 */
export async function commitEvaluation(
  pool: Pool,
  sessionId: string,
  applyChange: (session: ResolutionSession) => Change | Promise<Change>,
): Promise<ResolutionSession> {
  const request = newRequest();
  return withAudits(pool, sessionId, request, async () => {
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const session = await loadSession(pool, sessionId);
      if (session.parentSessionId) throw childOfRunError();
      assertMutable(session);
      const change = await applyChange(session);
      const { inputs, result, durationMs } = await evaluateSession(pool, request, change.inputs, 'ROOT');

      try {
        await inTransaction(pool, async (db) => {
          const written = await writeEvaluation(db, {
            sessionId,
            expectedRevision: session.revision,
            inputs: { ...inputs, observations: persistedObservations(inputs, request, result) },
            result,
            status: statusOf(result),
            durationMs,
          });
          if (!written) throw new RevisionConflict();
          await logEvent(db, sessionId, {
            ...change.event,
            nodesRecomputed: result.resolutionState.size,
            statusChanges: statusChangesBetween(session.resolutionState, result.resolutionState),
          });
          await change.record?.(db, result);
          await writeLlmAudits(db, sessionId, request.audits);
        });
      } catch (err) {
        if (err instanceof RevisionConflict) continue;
        throw err;
      }
      request.audits.length = 0;
      return loadSession(pool, sessionId);
    }
    throw conflictError();
  });
}
