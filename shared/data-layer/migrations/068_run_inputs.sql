-- Migration 068: multi-pathway runs on the evaluation pipeline (spec §3, §4; plan 04).
--
-- The parent of a run owns the patient facts added after start, the clock,
-- the conflict decisions and the run's single revision (D5, D6). Its merged
-- plan, readiness and hashes are a cache of the last committed composition,
-- recomputed by every mutation on the run.
--
-- 1. Purge (D8). Runs created on the integration branch since 067 have none
--    of these columns, and their children carry no parent_session_id.
-- 2. multi_pathway_resolution_sessions gains revision, additional_context,
--    env_fingerprint, result_hash and readiness; its clock becomes NOT NULL,
--    as 067 did for single sessions.
--
-- Run once. The purge deletes every session.

BEGIN;

DELETE FROM multi_pathway_resolution_sessions;
DELETE FROM pathway_resolution_sessions;

ALTER TABLE multi_pathway_resolution_sessions
  ADD COLUMN revision INT NOT NULL DEFAULT 0,
  ADD COLUMN additional_context JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN env_fingerprint TEXT NOT NULL,
  ADD COLUMN result_hash TEXT NOT NULL,
  ADD COLUMN readiness JSONB NOT NULL,
  ALTER COLUMN temporal_context SET NOT NULL;

COMMIT;
