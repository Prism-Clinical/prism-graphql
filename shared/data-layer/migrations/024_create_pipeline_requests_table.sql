-- Migration: Create pipeline_requests table
-- Version: 024
-- Description: Table for tracking pipeline request status and results

CREATE TABLE IF NOT EXISTS pipeline_requests (
  id UUID PRIMARY KEY,
  visit_id UUID,
  patient_id UUID NOT NULL,
  user_id UUID NOT NULL,
  idempotency_key VARCHAR(255) UNIQUE,
  status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
  input_encrypted BYTEA NOT NULL,
  result_encrypted BYTEA,
  error JSONB,
  stages_completed TEXT[],
  degraded_services TEXT[],
  started_at TIMESTAMP WITH TIME ZONE,
  completed_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

  CONSTRAINT valid_status CHECK (
    status IN ('PENDING', 'IN_PROGRESS', 'COMPLETED', 'FAILED', 'EXPIRED')
  )
);

-- Index for querying by visit
CREATE INDEX IF NOT EXISTS idx_pipeline_requests_visit
  ON pipeline_requests(visit_id)
  WHERE visit_id IS NOT NULL;

-- Index for querying by patient
CREATE INDEX IF NOT EXISTS idx_pipeline_requests_patient
  ON pipeline_requests(patient_id);

-- Index for finding pending/in-progress requests
CREATE INDEX IF NOT EXISTS idx_pipeline_requests_status
  ON pipeline_requests(status)
  WHERE status IN ('PENDING', 'IN_PROGRESS');

-- Index for querying by user
CREATE INDEX IF NOT EXISTS idx_pipeline_requests_user
  ON pipeline_requests(user_id);

-- Index for idempotency key lookup
CREATE INDEX IF NOT EXISTS idx_pipeline_requests_idempotency
  ON pipeline_requests(idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- Index for cleanup of old requests
CREATE INDEX IF NOT EXISTS idx_pipeline_requests_created
  ON pipeline_requests(created_at);

-- Comments
COMMENT ON TABLE pipeline_requests IS 'Tracks pipeline request status and encrypted results';
COMMENT ON COLUMN pipeline_requests.input_encrypted IS 'Encrypted pipeline input (contains PHI)';
COMMENT ON COLUMN pipeline_requests.result_encrypted IS 'Encrypted pipeline result (contains PHI)';
COMMENT ON COLUMN pipeline_requests.error IS 'Error information (no PHI)';
COMMENT ON COLUMN pipeline_requests.stages_completed IS 'Array of completed stage names';
COMMENT ON COLUMN pipeline_requests.degraded_services IS 'Services that failed or used fallback';
