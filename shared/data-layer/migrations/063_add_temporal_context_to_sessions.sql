-- Migration 063: pin an evaluation clock to every resolution session
--
-- Temporal horizon work (design §1, §11). Each session stores the single
-- EvaluationTemporalContext it was created with — evaluationAsOf, the optional
-- encounterStart anchor, the pinned snapshot, and the temporal policy version —
-- so retraversal and replay resolve horizons against the same instant the
-- initial traversal did instead of re-reading the wall clock.
--
-- Nullable on purpose: a NULL marks a session created before this column
-- existed. Those sessions are not retraversable (design §5) and the service
-- raises SESSION_NOT_RETRAVERSABLE rather than silently re-stamping a clock.

BEGIN;

ALTER TABLE pathway_resolution_sessions
  ADD COLUMN temporal_context JSONB;

ALTER TABLE multi_pathway_resolution_sessions
  ADD COLUMN temporal_context JSONB;

COMMENT ON COLUMN pathway_resolution_sessions.temporal_context IS
    'Pinned EvaluationTemporalContext: evaluationAsOf, encounterStart, snapshotId, snapshotCapturedAt, timezone, temporalPolicyVersion. NULL = pre-temporal session, not retraversable.';

COMMENT ON COLUMN multi_pathway_resolution_sessions.temporal_context IS
    'Same context as pathway_resolution_sessions.temporal_context, stamped once and shared by every per-pathway traversal in the multi-pathway run.';

COMMIT;
