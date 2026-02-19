-- UP

-- Epic sync identifiers
ALTER TABLE visits ADD COLUMN IF NOT EXISTS epic_encounter_id VARCHAR(100);
ALTER TABLE visits ADD COLUMN IF NOT EXISTS epic_appointment_id VARCHAR(100);
ALTER TABLE visits ADD COLUMN IF NOT EXISTS epic_identifier VARCHAR(200);

-- Clinical context from FHIR
ALTER TABLE visits ADD COLUMN IF NOT EXISTS encounter_class VARCHAR(50);
ALTER TABLE visits ADD COLUMN IF NOT EXISTS reason_codes JSONB;
ALTER TABLE visits ADD COLUMN IF NOT EXISTS priority VARCHAR(20);
ALTER TABLE visits ADD COLUMN IF NOT EXISTS location_display VARCHAR(500);
ALTER TABLE visits ADD COLUMN IF NOT EXISTS participant_details JSONB;

-- Appointment-specific
ALTER TABLE visits ADD COLUMN IF NOT EXISTS cancellation_reason TEXT;
ALTER TABLE visits ADD COLUMN IF NOT EXISTS patient_instructions TEXT;

-- Sync tracking
ALTER TABLE visits ADD COLUMN IF NOT EXISTS epic_last_synced_at TIMESTAMP WITH TIME ZONE;

-- Unique partial indexes for deduplication (upsert ON CONFLICT targets)
CREATE UNIQUE INDEX IF NOT EXISTS idx_visits_epic_encounter_id
  ON visits (epic_encounter_id) WHERE epic_encounter_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_visits_epic_appointment_id
  ON visits (epic_appointment_id) WHERE epic_appointment_id IS NOT NULL;

-- DOWN
ALTER TABLE visits DROP COLUMN IF EXISTS epic_encounter_id;
ALTER TABLE visits DROP COLUMN IF EXISTS epic_appointment_id;
ALTER TABLE visits DROP COLUMN IF EXISTS epic_identifier;
ALTER TABLE visits DROP COLUMN IF EXISTS encounter_class;
ALTER TABLE visits DROP COLUMN IF EXISTS reason_codes;
ALTER TABLE visits DROP COLUMN IF EXISTS priority;
ALTER TABLE visits DROP COLUMN IF EXISTS location_display;
ALTER TABLE visits DROP COLUMN IF EXISTS participant_details;
ALTER TABLE visits DROP COLUMN IF EXISTS cancellation_reason;
ALTER TABLE visits DROP COLUMN IF EXISTS patient_instructions;
ALTER TABLE visits DROP COLUMN IF EXISTS epic_last_synced_at;

DROP INDEX IF EXISTS idx_visits_epic_encounter_id;
DROP INDEX IF EXISTS idx_visits_epic_appointment_id;
