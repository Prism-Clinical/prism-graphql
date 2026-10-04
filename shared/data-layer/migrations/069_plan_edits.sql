-- Migration 069: the provider's own edits and additions to a run's plan.
--
-- A run input like conflict_resolutions: stored on the parent, applied every
-- time the run is composed, so an edit survives re-evaluation and is part of
-- the result hash the provider signs. Keyed by edit id; see
-- apps/pathway-service/src/services/resolution/pipeline/plan-edits.ts.
--
-- Additive: no purge, existing runs read as having no edits.

BEGIN;

ALTER TABLE multi_pathway_resolution_sessions
  ADD COLUMN IF NOT EXISTS plan_edits JSONB NOT NULL DEFAULT '{}';

COMMIT;
