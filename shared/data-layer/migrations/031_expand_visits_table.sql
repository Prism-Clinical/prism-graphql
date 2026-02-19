-- Expand visits table to match the VisitService schema.
-- Migration 003 created the table with minimal columns (visit_date, visit_type,
-- diagnosis_codes). The service code expects a richer schema with scheduling,
-- workflow, and clinical fields. This migration adds the missing columns and
-- renames the mismatched ones.

-- Step 1: Rename mismatched columns
ALTER TABLE visits RENAME COLUMN visit_date TO scheduled_at;
ALTER TABLE visits RENAME COLUMN visit_type TO type;
ALTER TABLE visits RENAME COLUMN diagnosis_codes TO condition_codes;

-- Step 2: Add missing columns
ALTER TABLE visits ADD COLUMN IF NOT EXISTS hospital_id UUID;
ALTER TABLE visits ADD COLUMN IF NOT EXISTS case_ids JSONB DEFAULT '[]';
ALTER TABLE visits ADD COLUMN IF NOT EXISTS started_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE visits ADD COLUMN IF NOT EXISTS completed_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE visits ADD COLUMN IF NOT EXISTS duration INTEGER;
ALTER TABLE visits ADD COLUMN IF NOT EXISTS chief_complaint TEXT;
ALTER TABLE visits ADD COLUMN IF NOT EXISTS recording_key VARCHAR(1000);
ALTER TABLE visits ADD COLUMN IF NOT EXISTS recording_ended_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE visits ADD COLUMN IF NOT EXISTS care_plan_request_id UUID;
ALTER TABLE visits ADD COLUMN IF NOT EXISTS care_plan_requested_at TIMESTAMP WITH TIME ZONE;

-- Step 3: Update the index that referenced the old column name
DROP INDEX IF EXISTS idx_visits_date;
CREATE INDEX IF NOT EXISTS idx_visits_scheduled_at ON visits(scheduled_at);

-- Step 4: Add indexes for new query patterns
CREATE INDEX IF NOT EXISTS idx_visits_status ON visits(status);
CREATE INDEX IF NOT EXISTS idx_visits_provider_scheduled ON visits(provider_id, scheduled_at);
