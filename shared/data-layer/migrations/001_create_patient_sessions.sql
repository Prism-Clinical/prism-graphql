-- Migration: Create patient sessions table
-- Created at: 2024-12-27T18:30:00.000Z

-- UP
CREATE TABLE patient_sessions (
    session_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    patient_id VARCHAR(255) NOT NULL,
    epic_patient_id VARCHAR(255) NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'active',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP NOT NULL,
    last_accessed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    data_freshness JSONB DEFAULT '{}',
    
    CONSTRAINT valid_status CHECK (status IN ('active', 'expired', 'terminated'))
);

CREATE INDEX idx_patient_sessions_patient_id ON patient_sessions(patient_id);
CREATE INDEX idx_patient_sessions_epic_patient_id ON patient_sessions(epic_patient_id);
CREATE INDEX idx_patient_sessions_status ON patient_sessions(status);
CREATE INDEX idx_patient_sessions_expires_at ON patient_sessions(expires_at);
