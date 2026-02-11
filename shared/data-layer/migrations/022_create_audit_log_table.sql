-- Migration: 022_create_audit_log_table.sql
-- Description: Create immutable HIPAA-compliant audit log table
-- Created: 2024

-- Create audit_log table
CREATE TABLE IF NOT EXISTS audit_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_type VARCHAR(50) NOT NULL,
    event_time TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
    user_id UUID NOT NULL,
    user_role VARCHAR(50) NOT NULL,
    patient_id UUID,
    resource_type VARCHAR(100) NOT NULL,
    resource_id UUID,
    action VARCHAR(20) NOT NULL,
    phi_accessed BOOLEAN NOT NULL DEFAULT false,
    phi_fields TEXT[],
    ip_address INET,
    user_agent TEXT,
    request_id UUID NOT NULL,
    correlation_id UUID,
    outcome VARCHAR(20) NOT NULL,
    failure_reason TEXT,
    metadata JSONB,

    -- Constraints
    CONSTRAINT valid_event_type CHECK (event_type IN (
        'PHI_ACCESS', 'PHI_MODIFICATION', 'PHI_EXPORT',
        'ML_SERVICE_CALL', 'AUTHENTICATION', 'AUTHORIZATION_FAILURE',
        'SYSTEM_EVENT'
    )),
    CONSTRAINT valid_action CHECK (action IN (
        'CREATE', 'READ', 'UPDATE', 'DELETE', 'EXPORT', 'IMPORT'
    )),
    CONSTRAINT valid_outcome CHECK (outcome IN (
        'SUCCESS', 'FAILURE', 'DENIED'
    ))
);

-- Create indexes for compliance queries
CREATE INDEX IF NOT EXISTS idx_audit_log_patient
    ON audit_log(patient_id, event_time)
    WHERE patient_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_audit_log_user
    ON audit_log(user_id, event_time);

CREATE INDEX IF NOT EXISTS idx_audit_log_phi
    ON audit_log(event_time)
    WHERE phi_accessed = true;

CREATE INDEX IF NOT EXISTS idx_audit_log_event_type
    ON audit_log(event_type, event_time);

CREATE INDEX IF NOT EXISTS idx_audit_log_request_id
    ON audit_log(request_id);

CREATE INDEX IF NOT EXISTS idx_audit_log_correlation_id
    ON audit_log(correlation_id)
    WHERE correlation_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_audit_log_outcome_failure
    ON audit_log(event_time)
    WHERE outcome != 'SUCCESS';

-- Immutability rules: prevent UPDATE and DELETE
-- Note: These rules ensure the audit log cannot be tampered with
CREATE OR REPLACE RULE audit_log_no_update AS
    ON UPDATE TO audit_log
    DO INSTEAD NOTHING;

CREATE OR REPLACE RULE audit_log_no_delete AS
    ON DELETE TO audit_log
    DO INSTEAD NOTHING;

-- Create partitioning function for monthly partitions
-- This is optional but recommended for high-volume environments
-- Uncomment the following if partitioning is needed:

-- CREATE TABLE audit_log_partitioned (
--     LIKE audit_log INCLUDING ALL
-- ) PARTITION BY RANGE (event_time);
--
-- -- Create initial partitions (example for 2024)
-- CREATE TABLE audit_log_2024_01 PARTITION OF audit_log_partitioned
--     FOR VALUES FROM ('2024-01-01') TO ('2024-02-01');
-- CREATE TABLE audit_log_2024_02 PARTITION OF audit_log_partitioned
--     FOR VALUES FROM ('2024-02-01') TO ('2024-03-01');
-- -- ... continue for other months

-- Add comment describing the table
COMMENT ON TABLE audit_log IS 'HIPAA-compliant immutable audit log for PHI access tracking. 7 year retention required.';
COMMENT ON COLUMN audit_log.event_type IS 'Type of audit event (PHI_ACCESS, PHI_MODIFICATION, etc.)';
COMMENT ON COLUMN audit_log.phi_accessed IS 'Whether PHI fields were accessed in this event';
COMMENT ON COLUMN audit_log.phi_fields IS 'List of PHI field names accessed (no values)';
COMMENT ON COLUMN audit_log.correlation_id IS 'ID for correlating events across distributed services';
