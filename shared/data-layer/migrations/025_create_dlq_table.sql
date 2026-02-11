-- Migration: Create dead_letter_queue table
-- Version: 025
-- Description: Dead letter queue for failed pipeline jobs

CREATE TABLE IF NOT EXISTS dead_letter_queue (
  id UUID PRIMARY KEY,
  job_type VARCHAR(50) NOT NULL,
  job_id VARCHAR(255) NOT NULL,
  payload_encrypted BYTEA NOT NULL,
  error_message TEXT NOT NULL,
  error_stack TEXT,
  attempts INT NOT NULL DEFAULT 1,
  first_failed_at TIMESTAMP WITH TIME ZONE NOT NULL,
  last_failed_at TIMESTAMP WITH TIME ZONE NOT NULL,
  resolved_at TIMESTAMP WITH TIME ZONE,
  resolution VARCHAR(20),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

  CONSTRAINT valid_resolution CHECK (
    resolution IS NULL OR resolution IN ('RETRIED', 'DISCARDED', 'MANUAL')
  )
);

-- Index for finding unresolved items
CREATE INDEX IF NOT EXISTS idx_dlq_unresolved
  ON dead_letter_queue(resolved_at)
  WHERE resolved_at IS NULL;

-- Index for filtering by job type
CREATE INDEX IF NOT EXISTS idx_dlq_job_type
  ON dead_letter_queue(job_type);

-- Index for finding recent failures
CREATE INDEX IF NOT EXISTS idx_dlq_last_failed
  ON dead_letter_queue(last_failed_at DESC)
  WHERE resolved_at IS NULL;

-- Comments
COMMENT ON TABLE dead_letter_queue IS 'Dead letter queue for failed pipeline jobs';
COMMENT ON COLUMN dead_letter_queue.job_type IS 'Type of job (e.g., GENERATE_CARE_PLAN)';
COMMENT ON COLUMN dead_letter_queue.job_id IS 'Original job ID';
COMMENT ON COLUMN dead_letter_queue.payload_encrypted IS 'Encrypted job payload (may contain PHI)';
COMMENT ON COLUMN dead_letter_queue.error_message IS 'Error message (sanitized, no PHI)';
COMMENT ON COLUMN dead_letter_queue.attempts IS 'Number of processing attempts before DLQ';
COMMENT ON COLUMN dead_letter_queue.resolution IS 'How the item was resolved';
