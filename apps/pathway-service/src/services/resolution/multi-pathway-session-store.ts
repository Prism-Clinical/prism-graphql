/**
 * Phase 3 commit 4: persistence layer for multi-pathway resolution sessions.
 *
 * One row per run. The parent's inputs (facts added after start, conflict
 * decisions) and the cache of its last composition live in JSONB columns;
 * the contributing child session ids live in a UUID array, written once at
 * start.
 */

import { Pool } from 'pg';
import { MergedCarePlan, ConflictResolution } from './care-plan-merge';
import { EvaluationTemporalContext } from './temporal/evaluation-context';
import type { PatientContext } from '../confidence/types';
import type { AdditionalContextInput } from '../../resolvers/mutations/resolution';
import type { RunBlocker, RunResult } from './pipeline/types';
import type { Db } from './session-store';

// ─── Types ──────────────────────────────────────────────────────────

export type MultiPathwaySessionStatus = 'ACTIVE' | 'COMPLETED' | 'ABANDONED';

export interface MultiPathwayResolutionSession {
  id: string;
  patientId: string;
  providerId: string;
  status: MultiPathwaySessionStatus;
  /** Optimistic-lock counter for the whole run (D6); every committed write increments it. */
  revision: number;
  /** Patient facts supplied after start, on any child of the run (D5). */
  additionalContext: Partial<AdditionalContextInput>;
  /** Cache of the last committed composition. Never an input. */
  envFingerprint: string;
  resultHash: string;
  readiness: { ready: boolean; blockers: RunBlocker[] };
  /**
   * True when this session was created by admin/QA/preview tooling
   * (currently: `startMultiPathwayResolution` called with
   * `syntheticPatient: true`). Preview sessions:
   *   - are filtered out of default list queries;
   *   - can be hard-deleted via `deletePreviewSession`;
   *   - otherwise use the identical resolver code path as real sessions
   *     so preview runs exercise the same behavior we ship to prod.
   */
  isPreview: boolean;
  initialPatientContext: unknown;
  contributingSessionIds: string[];
  contributingPathwayIds: string[];
  mergedPlan: MergedCarePlan;
  conflictResolutions: Record<string, ConflictResolution>;
  carePlanId: string | null;
  /** Phase 4: DDI warnings (MODERATE) — pre-merge + cross-recommendation. */
  ddiWarnings: unknown[];
  /** The run's clock, shared by every child. NOT NULL since migration 068. */
  temporalContext: EvaluationTemporalContext;
  createdAt: Date;
  updatedAt: Date;
}

export interface MultiPathwayResolutionSessionSummary {
  id: string;
  patientId: string;
  providerId: string;
  status: MultiPathwaySessionStatus;
  isPreview: boolean;
  contributingPathwayCount: number;
  unresolvedConflictCount: number;
  carePlanId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

// ─── CRUD ───────────────────────────────────────────────────────────

export async function getMultiPathwaySession(
  pool: Pool,
  sessionId: string,
): Promise<MultiPathwayResolutionSession | null> {
  const r = await pool.query(
    `SELECT * FROM multi_pathway_resolution_sessions WHERE id = $1`,
    [sessionId],
  );
  if (r.rows.length === 0) return null;
  return runRowToSession(r.rows[0]);
}

export async function getPatientMultiPathwaySessions(
  pool: Pool,
  patientId: string,
  status?: MultiPathwaySessionStatus,
  /**
   * When true, preview sessions (`is_preview = true`) are returned alongside
   * real sessions. Default is false so real provider views never see preview
   * runs by accident. Admin/QA tooling can opt in explicitly.
   */
  includePreview: boolean = false,
): Promise<MultiPathwayResolutionSessionSummary[]> {
  const params: unknown[] = [patientId];
  let where = 'patient_id = $1';
  if (!includePreview) {
    where += ' AND is_preview = false';
  }
  if (status) {
    params.push(status);
    where += ` AND status = $${params.length}`;
  }
  const r = await pool.query(
    `SELECT id, patient_id, provider_id, status, is_preview,
            array_length(contributing_pathway_ids, 1) AS contributing_pathway_count,
            merged_plan, care_plan_id, created_at, updated_at
       FROM multi_pathway_resolution_sessions
       WHERE ${where}
       ORDER BY created_at DESC`,
    params,
  );
  return r.rows.map((row) => ({
    id: row.id,
    patientId: row.patient_id,
    providerId: row.provider_id,
    status: row.status,
    isPreview: row.is_preview ?? false,
    contributingPathwayCount: row.contributing_pathway_count ?? 0,
    unresolvedConflictCount: countUnresolvedConflicts(row.merged_plan),
    carePlanId: row.care_plan_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

/**
 * Hard-delete a preview session and its contributing per-pathway sessions.
 * Real (non-preview) sessions are refused with a `NotPreviewError` — the
 * caller has to use `abandonMultiPathwaySession` for those, which
 * preserves the row for audit.
 *
 * Result kinds:
 *   - 'not-found'     — no row for this id
 *   - 'not-preview'   — row exists but is_preview = false; deletion refused
 *   - 'deleted'       — row (and any contributing per-pathway sessions) gone
 *
 * Wrapped in a transaction so the multi-pathway row and its per-pathway
 * children are removed atomically. Per-pathway sessions ids live in the
 * `contributing_session_ids` UUID array on the multi-pathway row; we drop
 * them with a `WHERE id = ANY($1::uuid[])` fan-out — no FK from
 * pathway_resolution_sessions back up, so the delete has to be explicit.
 */
export async function deletePreviewSession(
  pool: Pool,
  sessionId: string,
): Promise<
  | { kind: 'not-found' }
  | { kind: 'not-preview' }
  | { kind: 'deleted'; contributingSessionsDeleted: number }
> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const lookup = await client.query<{
      is_preview: boolean;
      contributing_session_ids: string[] | null;
    }>(
      `SELECT is_preview, contributing_session_ids
         FROM multi_pathway_resolution_sessions
        WHERE id = $1
        FOR UPDATE`,
      [sessionId],
    );
    if (lookup.rows.length === 0) {
      await client.query('ROLLBACK');
      return { kind: 'not-found' };
    }
    if (!lookup.rows[0].is_preview) {
      await client.query('ROLLBACK');
      return { kind: 'not-preview' };
    }

    const contributingIds = lookup.rows[0].contributing_session_ids ?? [];
    let contributingSessionsDeleted = 0;
    if (contributingIds.length > 0) {
      const del = await client.query(
        `DELETE FROM pathway_resolution_sessions
          WHERE id = ANY($1::uuid[])`,
        [contributingIds],
      );
      contributingSessionsDeleted = del.rowCount ?? 0;
    }

    await client.query(
      `DELETE FROM multi_pathway_resolution_sessions WHERE id = $1`,
      [sessionId],
    );

    await client.query('COMMIT');
    return { kind: 'deleted', contributingSessionsDeleted };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// ─── Runs on the evaluation pipeline (plan 04) ──────────────────────

export interface NewRun {
  patientId: string;
  providerId: string;
  isPreview: boolean;
  initialPatientContext: PatientContext;
  temporalContext: EvaluationTemporalContext;
  additionalContext: Partial<AdditionalContextInput>;
  conflictResolutions: Record<string, ConflictResolution>;
  result: RunResult;
}

/** JSONB parameters are sent as JSON text; scalars pass through. */
const param = (v: unknown): unknown => (v !== null && typeof v === 'object' ? JSON.stringify(v) : v);

/** The columns a composition writes: the parent's mutable inputs and the cache of the run's result. */
export function runColumns(args: {
  additionalContext: Partial<AdditionalContextInput>;
  conflictResolutions: Record<string, ConflictResolution>;
  result: RunResult;
  status: MultiPathwaySessionStatus;
}): Record<string, unknown> {
  return {
    status: args.status,
    additional_context: args.additionalContext,
    conflict_resolutions: args.conflictResolutions,
    merged_plan: args.result.mergedPlan,
    ddi_warnings: args.result.ddiWarnings,
    readiness: args.result.readiness,
    env_fingerprint: args.result.envFingerprint,
    result_hash: args.result.resultHash,
  };
}

/** Every column of a new run: identity, the immutable inputs, then `runColumns`. The contributing arrays are set once the children exist. */
export function insertRunColumns(r: NewRun): Record<string, unknown> {
  return {
    patient_id: r.patientId,
    provider_id: r.providerId,
    is_preview: r.isPreview,
    initial_patient_context: r.initialPatientContext,
    temporal_context: r.temporalContext,
    ...runColumns({ ...r, status: 'ACTIVE' }),
  };
}

export async function insertRun(db: Db, r: NewRun): Promise<string> {
  // Types are erased and tests are not typechecked: a clock-less run could
  // never be evaluated again, so refuse it here rather than at the NOT NULL.
  if (!r.temporalContext) {
    throw new Error('insertRun requires temporalContext — a run with no pinned clock cannot be evaluated');
  }
  const cols = insertRunColumns(r);
  const names = Object.keys(cols);
  const result = await db.query(
    `INSERT INTO multi_pathway_resolution_sessions (${names.join(', ')})
     VALUES (${names.map((_, i) => `$${i + 1}`).join(', ')})
     RETURNING id`,
    names.map((n) => param(cols[n])),
  );
  return result.rows[0].id;
}

/** The children exist only after the run row does; written once, in the start transaction. */
export async function setContributingSessions(db: Db, runId: string, sessionIds: string[], pathwayIds: string[]): Promise<void> {
  await db.query(
    `UPDATE multi_pathway_resolution_sessions
        SET contributing_session_ids = $2::uuid[], contributing_pathway_ids = $3::uuid[]
      WHERE id = $1`,
    [runId, sessionIds, pathwayIds],
  );
}

/**
 * Commit a composition as a compare-and-set on the run's revision (D6).
 * Returns false when another write moved the run or it left ACTIVE; the caller
 * rolls back and retries. `status: COMPLETED` is generation's claim.
 */
export async function writeRunEvaluation(
  db: Db,
  args: {
    runId: string;
    expectedRevision: number;
    additionalContext: Partial<AdditionalContextInput>;
    conflictResolutions: Record<string, ConflictResolution>;
    result: RunResult;
    status: MultiPathwaySessionStatus;
  },
): Promise<boolean> {
  const cols = runColumns(args);
  const names = Object.keys(cols);
  const result = await db.query(
    `UPDATE multi_pathway_resolution_sessions
        SET ${names.map((n, i) => `${n} = $${i + 1}`).join(', ')}, revision = revision + 1, updated_at = NOW()
      WHERE id = $${names.length + 1} AND revision = $${names.length + 2} AND status = 'ACTIVE'`,
    [...names.map((n) => param(cols[n])), args.runId, args.expectedRevision],
  );
  return result.rowCount === 1;
}

/** Lifecycle-only change (abandon): no evaluation, same revision check (spec §4). */
export async function writeRunLifecycle(
  db: Db,
  args: { runId: string; expectedRevision: number; status: MultiPathwaySessionStatus },
): Promise<boolean> {
  const result = await db.query(
    `UPDATE multi_pathway_resolution_sessions
        SET status = $1, revision = revision + 1, updated_at = NOW()
      WHERE id = $2 AND revision = $3 AND status = 'ACTIVE'`,
    [args.status, args.runId, args.expectedRevision],
  );
  return result.rowCount === 1;
}

/** Inside generation's claimed transaction only. */
export async function setRunCarePlanId(db: Db, runId: string, carePlanId: string): Promise<void> {
  await db.query('UPDATE multi_pathway_resolution_sessions SET care_plan_id = $1 WHERE id = $2', [carePlanId, runId]);
}

// ─── Helpers ────────────────────────────────────────────────────────

export function runRowToSession(row: Record<string, unknown>): MultiPathwayResolutionSession {
  return {
    id: row.id as string,
    patientId: row.patient_id as string,
    providerId: row.provider_id as string,
    status: row.status as MultiPathwaySessionStatus,
    revision: (row.revision as number) ?? 0,
    additionalContext: (row.additional_context as Partial<AdditionalContextInput>) ?? {},
    envFingerprint: (row.env_fingerprint as string) ?? '',
    resultHash: (row.result_hash as string) ?? '',
    readiness: (row.readiness as MultiPathwayResolutionSession['readiness']) ?? { ready: false, blockers: [] },
    isPreview: (row.is_preview as boolean) ?? false,
    initialPatientContext: row.initial_patient_context,
    contributingSessionIds: (row.contributing_session_ids as string[]) ?? [],
    contributingPathwayIds: (row.contributing_pathway_ids as string[]) ?? [],
    mergedPlan: row.merged_plan as MergedCarePlan,
    conflictResolutions: (row.conflict_resolutions as Record<string, ConflictResolution>) ?? {},
    carePlanId: (row.care_plan_id as string) ?? null,
    ddiWarnings: (row.ddi_warnings as unknown[]) ?? [],
    // pg parses JSONB already; `?? undefined` maps SQL NULL to undefined.
    temporalContext: (row.temporal_context ?? undefined) as EvaluationTemporalContext | undefined,
    createdAt: row.created_at as Date,
    updatedAt: row.updated_at as Date,
  };
}

function countUnresolvedConflicts(plan: unknown): number {
  if (!plan || typeof plan !== 'object') return 0;
  const conflicts = (plan as { conflicts?: Array<{ resolution: unknown }> }).conflicts;
  if (!Array.isArray(conflicts)) return 0;
  return conflicts.filter((c) => c.resolution == null).length;
}
