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
  initialPatientContext: unknown;
  contributingSessionIds: string[];
  contributingPathwayIds: string[];
  mergedPlan: MergedCarePlan;
  conflictResolutions: Record<string, ConflictResolution>;
  carePlanId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface MultiPathwayResolutionSessionSummary {
  id: string;
  patientId: string;
  providerId: string;
  status: MultiPathwaySessionStatus;
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
  },
): Promise<string> {
  const result = await pool.query(
    `INSERT INTO multi_pathway_resolution_sessions
       (patient_id, provider_id, status, initial_patient_context,
        contributing_session_ids, contributing_pathway_ids,
        merged_plan, conflict_resolutions)
     VALUES ($1, $2, 'ACTIVE', $3::jsonb, $4::uuid[], $5::uuid[], $6::jsonb, '{}'::jsonb)
     RETURNING id`,
    [
      s.patientId,
      s.providerId,
      JSON.stringify(s.initialPatientContext),
      s.contributingSessionIds,
      s.contributingPathwayIds,
      JSON.stringify(s.mergedPlan),
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
): Promise<MultiPathwayResolutionSessionSummary[]> {
  const params: unknown[] = [patientId];
  let where = 'patient_id = $1';
  if (status) {
    params.push(status);
    where += ` AND status = $${params.length}`;
  }
  const r = await pool.query(
    `SELECT id, patient_id, provider_id, status,
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
): Promise<void> {
  await pool.query(
    `UPDATE multi_pathway_resolution_sessions
       SET merged_plan = $2::jsonb,
           conflict_resolutions = $3::jsonb,
           updated_at = NOW()
     WHERE id = $1`,
    [sessionId, JSON.stringify(mergedPlan), JSON.stringify(conflictResolutions)],
  );
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
    initialPatientContext: row.initial_patient_context,
    contributingSessionIds: (row.contributing_session_ids as string[]) ?? [],
    contributingPathwayIds: (row.contributing_pathway_ids as string[]) ?? [],
    mergedPlan: row.merged_plan as MergedCarePlan,
    conflictResolutions: (row.conflict_resolutions as Record<string, ConflictResolution>) ?? {},
    carePlanId: (row.care_plan_id as string) ?? null,
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
