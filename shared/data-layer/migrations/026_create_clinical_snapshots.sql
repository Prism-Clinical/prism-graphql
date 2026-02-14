-- Migration: 026_create_clinical_snapshots.sql
-- Description: Immutable clinical data snapshots for HIPAA audit trail
-- Each snapshot captures the complete clinical picture at a point in time.
-- Snapshots are versioned per patient and INSERT-only (never updated).

-- =======================================================================
-- Main snapshot table
-- =======================================================================
CREATE TABLE IF NOT EXISTS patient_clinical_snapshots (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    epic_patient_id VARCHAR(100) NOT NULL,
    snapshot_version INTEGER NOT NULL,
    trigger_event VARCHAR(50) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT valid_trigger_event CHECK (
        trigger_event IN ('VISIT', 'CARE_PLAN_CREATION', 'MANUAL_REFRESH', 'SCHEDULED')
    ),
    CONSTRAINT unique_patient_version UNIQUE (epic_patient_id, snapshot_version)
);

CREATE INDEX IF NOT EXISTS idx_snapshots_epic_patient
    ON patient_clinical_snapshots(epic_patient_id);
CREATE INDEX IF NOT EXISTS idx_snapshots_patient_version
    ON patient_clinical_snapshots(epic_patient_id, snapshot_version DESC);
CREATE INDEX IF NOT EXISTS idx_snapshots_created_at
    ON patient_clinical_snapshots(created_at);

-- =======================================================================
-- Snapshot demographics (1:1 with snapshot)
-- =======================================================================
CREATE TABLE IF NOT EXISTS snapshot_demographics (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    snapshot_id UUID NOT NULL,
    first_name VARCHAR(200),
    last_name VARCHAR(200),
    gender VARCHAR(20),
    date_of_birth VARCHAR(20),
    mrn VARCHAR(100),
    active BOOLEAN,
    deceased_boolean BOOLEAN,
    deceased_date_time VARCHAR(30),
    marital_status JSONB,
    race_ethnicity JSONB,
    identifiers JSONB DEFAULT '[]',
    names JSONB DEFAULT '[]',
    telecom JSONB DEFAULT '[]',
    addresses JSONB DEFAULT '[]',
    emergency_contacts JSONB DEFAULT '[]',
    communications JSONB DEFAULT '[]',
    general_practitioner JSONB DEFAULT '[]',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (snapshot_id) REFERENCES patient_clinical_snapshots(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_snapshot_demographics_snapshot
    ON snapshot_demographics(snapshot_id);

-- =======================================================================
-- Snapshot vitals (1:N with snapshot)
-- =======================================================================
CREATE TABLE IF NOT EXISTS snapshot_vitals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    snapshot_id UUID NOT NULL,
    observation_type VARCHAR(200) NOT NULL,
    value NUMERIC,
    unit VARCHAR(50),
    recorded_date VARCHAR(30),
    status VARCHAR(30),
    category VARCHAR(50),
    code JSONB,
    interpretation JSONB,
    reference_range JSONB,
    body_site JSONB,
    performer JSONB,
    encounter JSONB,
    issued_date VARCHAR(30),
    components JSONB,
    is_normalized BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (snapshot_id) REFERENCES patient_clinical_snapshots(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_snapshot_vitals_snapshot
    ON snapshot_vitals(snapshot_id);
CREATE INDEX IF NOT EXISTS idx_snapshot_vitals_type
    ON snapshot_vitals(observation_type);

-- =======================================================================
-- Snapshot lab results (1:N with snapshot)
-- =======================================================================
CREATE TABLE IF NOT EXISTS snapshot_lab_results (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    snapshot_id UUID NOT NULL,
    observation_id VARCHAR(100),
    code JSONB NOT NULL,
    status VARCHAR(30) NOT NULL,
    category VARCHAR(50),
    effective_date_time VARCHAR(30),
    issued_date VARCHAR(30),
    value_quantity NUMERIC,
    value_unit VARCHAR(50),
    value_string TEXT,
    value_codeable_concept JSONB,
    interpretation JSONB,
    reference_range JSONB,
    performer JSONB,
    encounter JSONB,
    specimen JSONB,
    body_site JSONB,
    has_member JSONB,
    components JSONB,
    notes TEXT[],
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (snapshot_id) REFERENCES patient_clinical_snapshots(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_snapshot_labs_snapshot
    ON snapshot_lab_results(snapshot_id);
CREATE INDEX IF NOT EXISTS idx_snapshot_labs_status
    ON snapshot_lab_results(status);

-- =======================================================================
-- Snapshot medications (1:N with snapshot)
-- =======================================================================
CREATE TABLE IF NOT EXISTS snapshot_medications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    snapshot_id UUID NOT NULL,
    medication_request_id VARCHAR(100),
    name VARCHAR(500) NOT NULL,
    status VARCHAR(30) NOT NULL,
    intent VARCHAR(30),
    category JSONB,
    priority VARCHAR(20),
    medication_code JSONB,
    medication_reference JSONB,
    authored_on VARCHAR(30),
    requester JSONB,
    encounter JSONB,
    reason_code JSONB,
    reason_reference JSONB,
    dosage_instructions JSONB,
    dispense_request JSONB,
    substitution JSONB,
    course_of_therapy_type JSONB,
    notes TEXT[],
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (snapshot_id) REFERENCES patient_clinical_snapshots(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_snapshot_medications_snapshot
    ON snapshot_medications(snapshot_id);
CREATE INDEX IF NOT EXISTS idx_snapshot_medications_status
    ON snapshot_medications(status);

-- =======================================================================
-- Snapshot conditions (1:N with snapshot)
-- =======================================================================
CREATE TABLE IF NOT EXISTS snapshot_conditions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    snapshot_id UUID NOT NULL,
    condition_id VARCHAR(100),
    code VARCHAR(50),
    display VARCHAR(500),
    code_detail JSONB,
    clinical_status JSONB,
    verification_status JSONB,
    category JSONB,
    severity JSONB,
    body_site JSONB,
    encounter JSONB,
    onset_date_time VARCHAR(30),
    onset_age NUMERIC,
    onset_string TEXT,
    abatement_date_time VARCHAR(30),
    abatement_age NUMERIC,
    abatement_string TEXT,
    recorded_date VARCHAR(30),
    recorder JSONB,
    asserter JSONB,
    stage JSONB,
    evidence JSONB,
    notes TEXT[],
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (snapshot_id) REFERENCES patient_clinical_snapshots(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_snapshot_conditions_snapshot
    ON snapshot_conditions(snapshot_id);
CREATE INDEX IF NOT EXISTS idx_snapshot_conditions_code
    ON snapshot_conditions(code);

-- =======================================================================
-- Immutability rules: prevent UPDATE and DELETE on snapshot data
-- =======================================================================
CREATE OR REPLACE RULE snapshots_no_update AS
    ON UPDATE TO patient_clinical_snapshots
    DO INSTEAD NOTHING;

CREATE OR REPLACE RULE snapshots_no_delete AS
    ON DELETE TO patient_clinical_snapshots
    DO INSTEAD NOTHING;

CREATE OR REPLACE RULE snapshot_demographics_no_update AS
    ON UPDATE TO snapshot_demographics
    DO INSTEAD NOTHING;

CREATE OR REPLACE RULE snapshot_demographics_no_delete AS
    ON DELETE TO snapshot_demographics
    DO INSTEAD NOTHING;

CREATE OR REPLACE RULE snapshot_vitals_no_update AS
    ON UPDATE TO snapshot_vitals
    DO INSTEAD NOTHING;

CREATE OR REPLACE RULE snapshot_vitals_no_delete AS
    ON DELETE TO snapshot_vitals
    DO INSTEAD NOTHING;

CREATE OR REPLACE RULE snapshot_labs_no_update AS
    ON UPDATE TO snapshot_lab_results
    DO INSTEAD NOTHING;

CREATE OR REPLACE RULE snapshot_labs_no_delete AS
    ON DELETE TO snapshot_lab_results
    DO INSTEAD NOTHING;

CREATE OR REPLACE RULE snapshot_medications_no_update AS
    ON UPDATE TO snapshot_medications
    DO INSTEAD NOTHING;

CREATE OR REPLACE RULE snapshot_medications_no_delete AS
    ON DELETE TO snapshot_medications
    DO INSTEAD NOTHING;

CREATE OR REPLACE RULE snapshot_conditions_no_update AS
    ON UPDATE TO snapshot_conditions
    DO INSTEAD NOTHING;

CREATE OR REPLACE RULE snapshot_conditions_no_delete AS
    ON DELETE TO snapshot_conditions
    DO INSTEAD NOTHING;

-- Comments
COMMENT ON TABLE patient_clinical_snapshots IS 'Immutable clinical data snapshots for HIPAA audit trail. Each snapshot captures the complete clinical picture at a point in time.';
COMMENT ON COLUMN patient_clinical_snapshots.trigger_event IS 'What triggered the snapshot creation (VISIT, CARE_PLAN_CREATION, etc.)';
COMMENT ON COLUMN patient_clinical_snapshots.snapshot_version IS 'Auto-incrementing version per patient, computed at insert time';
