-- Migration: Create idempotency_keys table
-- Version: 023
-- Description: Table for tracking idempotent pipeline requests

CREATE TABLE IF NOT EXISTS idempotency_keys (
  key VARCHAR(255) PRIMARY KEY,
  request_hash VARCHAR(64) NOT NULL,
  request_id UUID,
  response JSONB,
  status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,

  CONSTRAINT valid_status CHECK (status IN ('PENDING', 'COMPLETED', 'FAILED'))
);

-- Index for cleanup of expired keys
CREATE INDEX IF NOT EXISTS idx_idempotency_expires
  ON idempotency_keys(expires_at);

-- Index for finding pending requests (for monitoring)
CREATE INDEX IF NOT EXISTS idx_idempotency_status
  ON idempotency_keys(status)
  WHERE status = 'PENDING';

-- Comment
COMMENT ON TABLE idempotency_keys IS 'Tracks idempotent pipeline requests to prevent duplicate processing';
COMMENT ON COLUMN idempotency_keys.key IS 'Client-provided idempotency key';
COMMENT ON COLUMN idempotency_keys.request_hash IS 'SHA-256 hash of the request for validation';
COMMENT ON COLUMN idempotency_keys.request_id IS 'Pipeline request ID if processing started';
COMMENT ON COLUMN idempotency_keys.response IS 'Cached response for completed requests';
COMMENT ON COLUMN idempotency_keys.status IS 'PENDING, COMPLETED, or FAILED';
COMMENT ON COLUMN idempotency_keys.expires_at IS 'When this key can be cleaned up (default 24h)';
