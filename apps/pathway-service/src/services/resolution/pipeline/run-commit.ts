import { GraphQLError } from 'graphql';
import type { Pool } from 'pg';
import { getMultiPathwaySession, setContributingSessions, writeRunEvaluation } from '../multi-pathway-session-store';
import { getSession, insertSession, logEvent, statusChangesBetween, writeChildEvaluation, writeLlmAudits } from '../session-store';
import type { Db } from '../session-store';
import { ResolutionSession, SessionStatus } from '../types';
import { canonicalJson } from './canonical';
import { Change, conflictError, MAX_ATTEMPTS, statusOf } from './commit';
import { inTransaction, persistedObservations, RevisionConflict } from './request';
import {
  clearAudits,
  evaluateRun,
  newRunRequest,
  requestFor,
  Run,
  RunEvaluation,
  RunInputs,
  RunRequest,
  runInputsOf,
  sessionInputsOf,
} from './run';

/** An event on one child's log (P4-5). */
export interface RunEvent {
  sessionId: string;
  eventType: string;
  triggerData: unknown;
}

/** What a run mutation contributes to a commit: new inputs, the events, analytics rows. */
export interface RunChange {
  inputs: RunInputs;
  events: RunEvent[];
  /** Written in the same transaction as the run. */
  record?: (db: Db, evaluation: RunEvaluation) => Promise<void>;
}

export async function loadRun(pool: Pool, runId: string): Promise<Run> {
  const parent = await getMultiPathwaySession(pool, runId);
  if (!parent) throw new GraphQLError('Session not found', { extensions: { code: 'NOT_FOUND' } });
  const children: ResolutionSession[] = [];
  for (const id of parent.contributingSessionIds) {
    const child = await getSession(pool, id);
    if (!child) throw new Error(`run ${runId}: contributing session ${id} is missing`);
    children.push(child);
  }
  return { parent, children };
}

export function assertRunMutable(run: Run): void {
  if (run.parent.status !== 'ACTIVE') {
    throw new GraphQLError(`Cannot modify session with status "${run.parent.status}"`, {
      extensions: { code: 'BAD_USER_INPUT' },
    });
  }
}

/**
 * Write a composed run in the caller's transaction: the parent under its
 * revision check (RevisionConflict when it moved), then EVERY child — every
 * child was re-evaluated (D13) — with its observations and audit rows.
 * `COMPLETED` is generation's claim.
 */
export async function writeRun(db: Db, run: Run, ev: RunEvaluation, request: RunRequest, status: 'ACTIVE' | 'COMPLETED'): Promise<void> {
  const written = await writeRunEvaluation(db, {
    runId: run.parent.id,
    expectedRevision: run.parent.revision,
    additionalContext: ev.inputs.additionalContext,
    conflictResolutions: ev.inputs.conflictResolutions,
    planEdits: ev.inputs.planEdits ?? {},
    result: ev.result,
    status,
  });
  if (!written) throw new RevisionConflict();
  for (const child of ev.result.children) {
    const session = run.children.find((c) => c.pathwayId === child.pathwayId)!;
    const own = ev.inputs.children.find((c) => c.pathwayId === child.pathwayId)!;
    const req = requestFor(request, child.pathwayId);
    const inputs = sessionInputsOf(ev.inputs, own.inputs);
    await writeChildEvaluation(db, {
      sessionId: session.id,
      inputs: { ...inputs, observations: persistedObservations(inputs, req, child.result) },
      result: child.result,
      status: status === 'COMPLETED' ? SessionStatus.COMPLETED : statusOf(child.result),
      durationMs: ev.durationMs,
    });
    await writeLlmAudits(db, session.id, req.audits);
  }
}

/** Audit rows of calls no committed transaction wrote (spec §4, best effort), each under its child. */
export async function flushRunAudits(pool: Pool, run: Run, request: RunRequest): Promise<void> {
  const pending = [...request].filter(([, r]) => r.audits.length > 0);
  if (pending.length === 0) return;
  const sessionOf = new Map(run.children.map((c) => [c.pathwayId, c.id]));
  await inTransaction(pool, async (db) => {
    for (const [pathwayId, r] of pending) {
      const sessionId = sessionOf.get(pathwayId);
      if (sessionId) await writeLlmAudits(db, sessionId, r.audits);
    }
  });
  clearAudits(request);
}

/**
 * Run a run request's attempts. However they end, write the audit rows no
 * committed transaction wrote — the run analogue of `withAudits`. `body`
 * records each run it loads in `seen`, so the rows can be filed under its
 * children. A failure to write them never masks the request's own outcome.
 */
export async function withRunAudits<T>(pool: Pool, request: RunRequest, body: (seen: { run: Run | null }) => Promise<T>): Promise<T> {
  const seen: { run: Run | null } = { run: null };
  try {
    return await body(seen);
  } finally {
    if (seen.run) {
      await flushRunAudits(pool, seen.run, request).catch((err) =>
        console.error('[audit] could not write the LLM audit rows of a run request:', err),
      );
    }
  }
}

/**
 * The run's one write path (spec §3, §4). Each attempt reloads the run, asks
 * the mutation for its change (boundary validation throws here and is never
 * retried), evaluates every child under one snapshot, composes, and commits
 * the parent and every child under the parent's revision. Observations an
 * earlier attempt acquired are reused while their keys still match. Three
 * attempts, then CONFLICT (D6, D9).
 */
export async function commitRun(
  pool: Pool,
  runId: string,
  applyChange: (run: Run) => RunChange | Promise<RunChange>,
): Promise<Run> {
  const request = newRunRequest();
  return withRunAudits(pool, request, async (seen) => {
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const run = await loadRun(pool, runId);
      seen.run = run;
      assertRunMutable(run);
      const change = await applyChange(run);
      const ev = await evaluateRun(pool, request, change.inputs);

      try {
        await inTransaction(pool, async (db) => {
          await writeRun(db, run, ev, request, 'ACTIVE');
          for (const e of change.events) {
            const before = run.children.find((c) => c.id === e.sessionId)!;
            const after = ev.result.children.find((c) => c.pathwayId === before.pathwayId)!;
            await logEvent(db, e.sessionId, {
              eventType: e.eventType,
              triggerData: e.triggerData,
              nodesRecomputed: after.result.resolutionState.size,
              statusChanges: statusChangesBetween(before.resolutionState, after.result.resolutionState),
            });
          }
          await change.record?.(db, ev);
        });
      } catch (err) {
        if (err instanceof RevisionConflict) continue;
        throw err;
      }
      clearAudits(request);
      return loadRun(pool, runId);
    }
    throw conflictError();
  });
}

/** A pathway joining a run: what `insertSession` needs that evaluation does not produce. */
export interface JoiningPathway { pathwayId: string; version: string }

/**
 * Add facts to a run and let pathways join it (an encounter in progress: a
 * diagnosis added as the visit goes on). `build` returns the run's new inputs —
 * the existing children untouched, plus a child with `sessionId: ''` and an
 * empty graph fingerprint for every pathway that now matches. Everything is
 * evaluated under one snapshot and committed under the parent's revision, as
 * `commitRun` does; a joining child's row is inserted in the same transaction.
 */
export async function commitRunWithJoiners(
  pool: Pool,
  runId: string,
  providerId: string,
  build: (run: Run) => Promise<{ inputs: RunInputs; joining: JoiningPathway[]; triggerData: Record<string, unknown> }>,
): Promise<Run> {
  const request = newRunRequest();
  return withRunAudits(pool, request, async (seen) => {
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const run = await loadRun(pool, runId);
      seen.run = run;
      assertRunMutable(run);
      const change = await build(run);
      const ev = await evaluateRun(pool, request, change.inputs);
      const versionOf = new Map(change.joining.map((j) => [j.pathwayId, j.version]));
      const existing = new Map(run.children.map((c) => [c.pathwayId, c]));

      try {
        await inTransaction(pool, async (db) => {
          // writeRun writes the parent and every EXISTING child; the joiners follow.
          const known = { ...ev, result: { ...ev.result, children: ev.result.children.filter((c) => existing.has(c.pathwayId)) } };
          await writeRun(db, run, known, request, 'ACTIVE');
          const sessionIds: string[] = [];
          for (const child of ev.result.children) {
            const before = existing.get(child.pathwayId);
            if (before) {
              sessionIds.push(before.id);
              await logEvent(db, before.id, {
                eventType: 'context_update',
                triggerData: change.triggerData,
                nodesRecomputed: child.result.resolutionState.size,
                statusChanges: statusChangesBetween(before.resolutionState, child.result.resolutionState),
              });
              continue;
            }
            const own = ev.inputs.children.find((c) => c.pathwayId === child.pathwayId)!;
            const inputs = sessionInputsOf(ev.inputs, own.inputs);
            const req = requestFor(request, child.pathwayId);
            const sessionId = await insertSession(db, {
              pathwayVersion: versionOf.get(child.pathwayId)!,
              patientId: run.parent.patientId,
              providerId,
              inputs: { ...inputs, additionalContext: {}, observations: persistedObservations(inputs, req, child.result) },
              result: child.result,
              status: statusOf(child.result),
              durationMs: ev.durationMs,
              parentSessionId: run.parent.id,
            });
            await writeLlmAudits(db, sessionId, req.audits);
            await logEvent(db, sessionId, {
              eventType: 'traversal_complete',
              triggerData: { runId: run.parent.id, pathwayId: child.pathwayId, patientId: run.parent.patientId, joined: true },
              nodesRecomputed: child.result.resolutionState.size,
              statusChanges: [],
            });
            sessionIds.push(sessionId);
          }
          await setContributingSessions(db, run.parent.id, sessionIds, ev.result.children.map((c) => c.pathwayId));
        });
      } catch (err) {
        if (err instanceof RevisionConflict) continue;
        throw err;
      }
      clearAudits(request);
      return loadRun(pool, runId);
    }
    throw conflictError();
  });
}

/**
 * A single-pathway change — an answer, an override, a fact — on a child of a
 * run, as a change to the run. The builder sees a VIEW of the child carrying
 * the parent's facts and clock, so it need not know about runs. Facts go to
 * the parent (D5); answers and overrides stay on the child, because they name
 * pathway-local nodes.
 */
export function childChange(run: Run, childId: string, build: (view: ResolutionSession) => Change): RunChange {
  const child = run.children.find((c) => c.id === childId);
  if (!child) throw new Error(`run ${run.parent.id} has no child ${childId}`);
  const view: ResolutionSession = {
    ...child,
    initialPatientContext: run.parent.initialPatientContext as ResolutionSession['initialPatientContext'],
    additionalContext: run.parent.additionalContext as ResolutionSession['additionalContext'],
    temporalContext: run.parent.temporalContext,
  };
  const change = build(view);

  const inputs = runInputsOf(run);
  inputs.additionalContext = change.inputs.additionalContext;
  const target = inputs.children.find((c) => c.sessionId === childId)!;
  target.inputs = { ...target.inputs, gateAnswers: change.inputs.gateAnswers, providerOverrides: change.inputs.providerOverrides };

  // A fact can move every child; an answer or an override is its own child's event (P4-5).
  const factChanged = canonicalJson(change.inputs.additionalContext) !== canonicalJson(run.parent.additionalContext);
  const on = factChanged ? run.children.map((c) => c.id) : [childId];
  return {
    inputs,
    events: on.map((sessionId) => ({ sessionId, ...change.event })),
    record: change.record && ((db, ev) =>
      change.record!(db, ev.result.children.find((c) => c.pathwayId === child.pathwayId)!.result)),
  };
}
