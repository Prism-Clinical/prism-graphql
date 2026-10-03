-- Migration 067: evaluation inputs (evaluation pipeline, spec 2026-09-13 §4).
--
-- A resolution session now stores only what a person or the outside world
-- told it, plus a revision. Everything else is a cache of the last committed
-- evaluation, recomputed by every mutation.
--
-- 1. Purge (D8). There are no users, and existing sessions carry neither a
--    graph fingerprint nor overrides-as-inputs. Deleting the sessions
--    cascades to events, decisions, node overrides, gate answers and LLM gate
--    evaluations. Generated care plans have no foreign key to sessions and
--    are untouched.
-- 2. pathway_resolution_sessions gains the input and cache columns and loses
--    dependency_map. parent_session_id is added now (nullable); plan 04
--    starts writing it.
-- 3. The event_type CHECK from 042 admits BRANCH_CHOSEN and
--    PROVIDER_ASSERTED_DATUM, which the resolvers already write and 042
--    rejected.
--
-- The multi_pathway_resolution_sessions columns of spec §4 step 3 arrive in
-- plan 04's migration, with the code that writes them (plan 03 decision P3-1).
--
-- Run once. The purge deletes every session.

BEGIN;

DELETE FROM multi_pathway_resolution_sessions;
DELETE FROM pathway_resolution_sessions;

ALTER TABLE pathway_resolution_sessions
  ADD COLUMN revision INT NOT NULL DEFAULT 0,
  ADD COLUMN provider_overrides JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN observations JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN graph_fingerprint TEXT NOT NULL,
  ADD COLUMN env_fingerprint TEXT NOT NULL,
  ADD COLUMN result_hash TEXT NOT NULL,
  ADD COLUMN readiness JSONB NOT NULL,
  ADD COLUMN gate_context_fields JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN catch_up_items JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN parent_session_id UUID REFERENCES multi_pathway_resolution_sessions(id) ON DELETE CASCADE,
  DROP COLUMN dependency_map,
  ALTER COLUMN temporal_context SET NOT NULL,
  ADD CONSTRAINT pathway_resolution_sessions_child_has_no_facts
    CHECK (parent_session_id IS NULL OR additional_context = '{}'::jsonb);

CREATE INDEX idx_pathway_resolution_sessions_parent
  ON pathway_resolution_sessions(parent_session_id);

-- 042 declared the CHECK inline, so Postgres named it <table>_<column>_check.
-- Deliberately no IF EXISTS: a different name must fail this migration loudly
-- rather than leave the old constraint in place.
ALTER TABLE pathway_resolution_events
  DROP CONSTRAINT pathway_resolution_events_event_type_check,
  ADD CONSTRAINT pathway_resolution_events_event_type_check CHECK (event_type IN (
    'traversal_complete', 'override', 'gate_answer', 'context_update',
    'care_plan_generated', 'abandoned', 'BRANCH_CHOSEN', 'PROVIDER_ASSERTED_DATUM'
  ));

COMMIT;
