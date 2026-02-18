-- Migration: Create clinical data table
-- Created at: 2024-12-27T18:32:00.000Z

-- UP
CREATE TABLE clinical_data (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    patient_id VARCHAR(255) NOT NULL,
    data_type VARCHAR(100) NOT NULL,
    data JSONB NOT NULL,
    source_system VARCHAR(100) NOT NULL DEFAULT 'epic',
    last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    ttl INTEGER NOT NULL DEFAULT 3600, -- TTL in seconds
    expires_at TIMESTAMP GENERATED ALWAYS AS (last_updated + (ttl * INTERVAL '1 second')) STORED,
    
    CONSTRAINT valid_data_type CHECK (data_type IN (
        'demographics', 'vitals', 'medications', 'diagnoses', 
        'lab_results', 'procedures', 'encounters'
    ))
);

CREATE INDEX idx_clinical_data_patient_id ON clinical_data(patient_id);
CREATE INDEX idx_clinical_data_type ON clinical_data(data_type);
CREATE INDEX idx_clinical_data_source ON clinical_data(source_system);
CREATE INDEX idx_clinical_data_expires_at ON clinical_data(expires_at);
CREATE INDEX idx_clinical_data_patient_type ON clinical_data(patient_id, data_type);

-- Composite unique constraint to prevent duplicate data
CREATE UNIQUE INDEX idx_clinical_data_unique ON clinical_data(patient_id, data_type, source_system);
