-- Migration 054: simulator_scenarios
--
-- Persists named synthetic-patient scenarios composed in the admin simulator.
-- Each row captures the inputs that drive a multi-pathway resolution run so
-- pathway authors can re-execute the same scenario against later pathway
-- edits (regression testing).
--
-- Scope: org-wide / shared for now (no owner_user_id column). When auth
-- arrives we can add a created_by + visibility column.

BEGIN;

CREATE TABLE IF NOT EXISTS simulator_scenarios (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(200) NOT NULL,
    description TEXT,
    condition_codes JSONB NOT NULL DEFAULT '[]'::jsonb,
    medications JSONB NOT NULL DEFAULT '[]'::jsonb,
    allergies JSONB NOT NULL DEFAULT '[]'::jsonb,
    lab_results JSONB NOT NULL DEFAULT '[]'::jsonb,
    include_draft_pathways BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS simulator_scenarios_name_unique ON simulator_scenarios(name);
CREATE INDEX IF NOT EXISTS idx_simulator_scenarios_updated_at ON simulator_scenarios(updated_at DESC);

COMMENT ON TABLE simulator_scenarios IS
  'Named synthetic-patient scenarios for the admin simulator. Re-runnable against later pathway changes for regression testing.';

COMMIT;
