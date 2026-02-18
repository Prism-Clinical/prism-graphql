-- Migration: 030_add_snapshot_allergies.sql
-- Description: Add allergy data to clinical snapshots (AllergyIntolerance FHIR resource)

CREATE TABLE IF NOT EXISTS snapshot_allergies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    snapshot_id UUID NOT NULL,
    allergy_intolerance_id VARCHAR(100),
    code JSONB,
    clinical_status JSONB,
    verification_status JSONB,
    type VARCHAR(20),
    categories TEXT[],
    criticality VARCHAR(30),
    onset_date_time VARCHAR(30),
    onset_age NUMERIC,
    onset_string TEXT,
    recorded_date VARCHAR(30),
    last_occurrence VARCHAR(30),
    recorder JSONB,
    asserter JSONB,
    encounter JSONB,
    reactions JSONB DEFAULT '[]',
    notes TEXT[],
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (snapshot_id) REFERENCES patient_clinical_snapshots(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_snapshot_allergies_snapshot
    ON snapshot_allergies(snapshot_id);

CREATE OR REPLACE RULE snapshot_allergies_no_update AS
    ON UPDATE TO snapshot_allergies
    DO INSTEAD NOTHING;

CREATE OR REPLACE RULE snapshot_allergies_no_delete AS
    ON DELETE TO snapshot_allergies
    DO INSTEAD NOTHING;

COMMENT ON TABLE snapshot_allergies IS 'Allergy/intolerance data from FHIR AllergyIntolerance resources, immutable snapshot child table.';
