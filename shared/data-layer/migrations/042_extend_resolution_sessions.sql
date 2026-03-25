-- shared/data-layer/migrations/042_extend_resolution_sessions.sql
--
-- Extend pathway_resolution_sessions for the full resolution engine.
-- Migration 038 created the scaffold; this adds resolution state, events.

BEGIN;

-- 1. Rename columns for clarity (scaffold -> production naming)
ALTER TABLE pathway_resolution_sessions
  RENAME COLUMN patient_context TO initial_patient_context;

ALTER TABLE pathway_resolution_sessions
  RENAME COLUMN resulting_care_plan_id TO care_plan_id;

-- 2. Add resolution state columns
ALTER TABLE pathway_resolution_sessions
  ADD COLUMN resolution_state JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN dependency_map JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN additional_context JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN pending_questions JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN red_flags JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN total_nodes_evaluated INT NOT NULL DEFAULT 0,
  ADD COLUMN traversal_duration_ms INT;

-- 3. Snapshot pathway version at resolution time
ALTER TABLE pathway_resolution_sessions
  ADD COLUMN pathway_version VARCHAR(20);

-- 4. Update status enum: IN_PROGRESS -> ACTIVE, add DEGRADED
-- Safe for pre-production: no real sessions exist yet.
ALTER TABLE pathway_resolution_sessions
  DROP CONSTRAINT pathway_resolution_sessions_status_check;
UPDATE pathway_resolution_sessions SET status = 'ACTIVE' WHERE status = 'IN_PROGRESS';
ALTER TABLE pathway_resolution_sessions
  ADD CONSTRAINT pathway_resolution_sessions_status_check
  CHECK (status IN ('ACTIVE', 'COMPLETED', 'ABANDONED', 'DEGRADED'));

-- 5. Composite index for provider's active sessions
CREATE INDEX idx_resolution_sessions_patient_provider
  ON pathway_resolution_sessions(patient_id, provider_id, status);

-- 6. Resolution events: audit trail of every interaction
CREATE TABLE pathway_resolution_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES pathway_resolution_sessions(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL
    CHECK (event_type IN (
      'traversal_complete', 'override', 'gate_answer',
      'context_update', 'care_plan_generated', 'abandoned'
    )),
  trigger_data JSONB NOT NULL,
  nodes_recomputed INT NOT NULL DEFAULT 0,
  status_changes JSONB NOT NULL DEFAULT '[]',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_resolution_events_session
  ON pathway_resolution_events(session_id, created_at);

COMMIT;
