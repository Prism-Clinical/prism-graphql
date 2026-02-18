-- Migration: Create patient demographics table
-- Created at: 2024-12-27T18:31:00.000Z

-- UP
CREATE TABLE patient_demographics (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    epic_patient_id VARCHAR(255) UNIQUE NOT NULL,
    first_name VARCHAR(255) NOT NULL,
    last_name VARCHAR(255) NOT NULL,
    date_of_birth DATE NOT NULL,
    gender VARCHAR(50),
    email VARCHAR(255),
    phone VARCHAR(50),
    address JSONB,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_patient_demographics_epic_id ON patient_demographics(epic_patient_id);
CREATE INDEX idx_patient_demographics_name ON patient_demographics(last_name, first_name);
CREATE INDEX idx_patient_demographics_dob ON patient_demographics(date_of_birth);

-- Trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_patient_demographics_updated_at 
    BEFORE UPDATE ON patient_demographics 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
