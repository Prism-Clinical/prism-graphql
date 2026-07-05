/**
 * Phase 3 commit 4: persistence layer for multi-pathway resolution sessions.
 *
 * One row in `multi_pathway_resolution_sessions` per merge run. The merged
 * plan + provider conflict resolutions live in two JSONB columns; the
 * contributing per-pathway session ids live in a UUID array. Pure CRUD —
 * conflict-application logic lives in the resolver layer so this module
 * stays storage-agnostic.
 */

import { Pool } from 'pg';
import { MergedCarePlan, ConflictResolution } from './care-plan-merge';

// ─── Types ──────────────────────────────────────────────────────────

export type MultiPathwaySessionStatus = 'ACTIVE' | 'COMPLETED' | 'ABANDONED';

export interface MultiPathwayResolutionSession {
  id: string;
  patientId: string;
  providerId: string;
  status: MultiPathwaySessionStatus;
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

export async function createMultiPathwaySession(
  pool: Pool,
  s: {
    patientId: string;
    providerId: string;
    initialPatientContext: unknown;
    contributingSessionIds: string[];
    contributingPathwayIds: string[];
    mergedPlan: MergedCarePlan;
    ddiWarnings?: unknown[];
    isPreview?: boolean;
  },
): Promise<string> {
  const result = await pool.query(
    `INSERT INTO multi_pathway_resolution_sessions
       (patient_id, provider_id, status, is_preview, initial_patient_context,
        contributing_session_ids, contributing_pathway_ids,
        merged_plan, conflict_resolutions, ddi_warnings)
     VALUES ($1, $2, 'ACTIVE', $3, $4::jsonb, $5::uuid[], $6::uuid[], $7::jsonb, '{}'::jsonb, $8::jsonb)
     RETURNING id`,
    [
      s.patientId,
      s.providerId,
      s.isPreview ?? false,
      JSON.stringify(s.initialPatientContext),
      s.contributingSessionIds,
      s.contributingPathwayIds,
      JSON.stringify(s.mergedPlan),
      JSON.stringify(s.ddiWarnings ?? []),
    ],
  );
  return result.rows[0].id;
}

export async function getMultiPathwaySession(
  pool: Pool,
  sessionId: string,
): Promise<MultiPathwayResolutionSession | null> {
  const r = await pool.query(
    `SELECT * FROM multi_pathway_resolution_sessions WHERE id = $1`,
    [sessionId],
  );
  if (r.rows.length === 0) return null;
  return rowToSession(r.rows[0]);
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
 * Persist an updated merged plan + conflict resolutions atomically. Used by
 * `resolveConflict`. Optimistic-lock-free for v1 — the conflict-resolution
 * UX is single-provider, single-session, so concurrent edits aren't a real
 * threat. We can add `updated_at`-based optimistic locking later if needed.
 */
export async function updateMergedPlanAndResolutions(
  pool: Pool,
  sessionId: string,
  mergedPlan: MergedCarePlan,
  conflictResolutions: Record<string, ConflictResolution>,
  /** Optional: when re-merging after gate answers, ddi warnings also change. */
  ddiWarnings?: unknown[],
): Promise<void> {
  if (ddiWarnings !== undefined) {
    await pool.query(
      `UPDATE multi_pathway_resolution_sessions
         SET merged_plan = $2::jsonb,
             conflict_resolutions = $3::jsonb,
             ddi_warnings = $4::jsonb,
             updated_at = NOW()
       WHERE id = $1`,
      [
        sessionId,
        JSON.stringify(mergedPlan),
        JSON.stringify(conflictResolutions),
        JSON.stringify(ddiWarnings),
      ],
    );
    return;
  }
  await pool.query(
    `UPDATE multi_pathway_resolution_sessions
       SET merged_plan = $2::jsonb,
           conflict_resolutions = $3::jsonb,
           updated_at = NOW()
     WHERE id = $1`,
    [sessionId, JSON.stringify(mergedPlan), JSON.stringify(conflictResolutions)],
  );
}

/**
 * Hard-delete a preview session and its contributing per-pathway sessions.
 * Real (non-preview) sessions are refused with a `NotPreviewError` — the
 * caller has to use `markMultiPathwaySessionStatus(..., 'ABANDONED')` for
 * those, which preserves the row for audit.
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

export async function markMultiPathwaySessionStatus(
  pool: Pool,
  sessionId: string,
  status: MultiPathwaySessionStatus,
  carePlanId?: string,
): Promise<void> {
  await pool.query(
    `UPDATE multi_pathway_resolution_sessions
       SET status = $2,
           care_plan_id = COALESCE($3, care_plan_id),
           updated_at = NOW()
     WHERE id = $1`,
    [sessionId, status, carePlanId ?? null],
  );
}

// ─── Helpers ────────────────────────────────────────────────────────

function rowToSession(row: Record<string, unknown>): MultiPathwayResolutionSession {
  return {
    id: row.id as string,
    patientId: row.patient_id as string,
    providerId: row.provider_id as string,
    status: row.status as MultiPathwaySessionStatus,
    isPreview: (row.is_preview as boolean) ?? false,
    initialPatientContext: row.initial_patient_context,
    contributingSessionIds: (row.contributing_session_ids as string[]) ?? [],
    contributingPathwayIds: (row.contributing_pathway_ids as string[]) ?? [],
    mergedPlan: row.merged_plan as MergedCarePlan,
    conflictResolutions: (row.conflict_resolutions as Record<string, ConflictResolution>) ?? {},
    carePlanId: (row.care_plan_id as string) ?? null,
    ddiWarnings: (row.ddi_warnings as unknown[]) ?? [],
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
