-- Add gate_answers column to pathway_resolution_sessions.
-- The session-store code (services/resolution/session-store.ts) writes
-- and reads this column on every session insert/select, but no prior
-- migration ever added it. Discovered when synthetic-patient resolution
-- failed with "column gate_answers does not exist".
--
-- Default is an empty object so existing rows (none currently in production
-- but possible in dev environments) get a sane value.

BEGIN;

ALTER TABLE pathway_resolution_sessions
  ADD COLUMN IF NOT EXISTS gate_answers JSONB NOT NULL DEFAULT '{}'::jsonb;

COMMIT;
