-- Migration: Add accept/reject tracking to pipeline_requests
-- Version: 029
-- Description: Extends pipeline_requests to track draft acceptance/rejection
--   and link accepted drafts to the resulting patient care plan.

-- Add new columns for accept/reject tracking
ALTER TABLE pipeline_requests
  ADD COLUMN IF NOT EXISTS accepted_at TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS accepted_by TEXT,
  ADD COLUMN IF NOT EXISTS rejected_at TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS rejected_by TEXT,
  ADD COLUMN IF NOT EXISTS rejection_reason TEXT,
  ADD COLUMN IF NOT EXISTS patient_care_plan_id UUID REFERENCES care_plans(id);

-- Expand status constraint to include ACCEPTED and REJECTED
ALTER TABLE pipeline_requests DROP CONSTRAINT IF EXISTS valid_status;
ALTER TABLE pipeline_requests ADD CONSTRAINT valid_status CHECK (
  status IN ('PENDING', 'IN_PROGRESS', 'COMPLETED', 'FAILED', 'EXPIRED', 'ACCEPTED', 'REJECTED')
);

-- Index for finding accepted requests linked to care plans
CREATE INDEX IF NOT EXISTS idx_pipeline_requests_care_plan
  ON pipeline_requests(patient_care_plan_id)
  WHERE patient_care_plan_id IS NOT NULL;

COMMENT ON COLUMN pipeline_requests.accepted_at IS 'When the draft was accepted by a provider';
COMMENT ON COLUMN pipeline_requests.accepted_by IS 'User ID of the provider who accepted';
COMMENT ON COLUMN pipeline_requests.rejected_at IS 'When the draft was rejected';
COMMENT ON COLUMN pipeline_requests.rejected_by IS 'User ID of the provider who rejected';
COMMENT ON COLUMN pipeline_requests.rejection_reason IS 'Free-text reason for rejection (for ML training)';
COMMENT ON COLUMN pipeline_requests.patient_care_plan_id IS 'FK to the care plan created from this draft';
