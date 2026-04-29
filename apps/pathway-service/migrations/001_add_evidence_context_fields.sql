ALTER TABLE confidence_admin_evidence
  ADD COLUMN IF NOT EXISTS applicable_criteria TEXT[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS population_description TEXT;
