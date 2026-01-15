-- Migration 019: Rename care plan tables for clarity
--
-- Current confusing naming:
--   care_plan_templates → care plan definitions (patient-agnostic clinical pathways)
--   template_goals → goals for care plan definitions
--   template_interventions → interventions for care plan definitions
--   care_plans → actually patient-specific instances
--   care_plan_goals → patient-specific goals
--   care_plan_interventions → patient-specific interventions
--
-- New clear naming:
--   care_plans → clinical pathway definitions (patient-agnostic)
--   care_plan_goals → goals for care plan definitions
--   care_plan_interventions → interventions (medications, procedures, etc.)
--   patient_care_plans → patient-specific care plan instances
--   patient_care_plan_goals → patient-specific goals
--   patient_care_plan_interventions → patient-specific interventions

BEGIN;

-- ============================================================================
-- STEP 1: Create patient_care_plans table
-- ============================================================================

CREATE TABLE patient_care_plans (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    care_plan_id UUID, -- Will reference care_plans after rename
    title VARCHAR(500) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'DRAFT',
    condition_codes TEXT[] NOT NULL,
    start_date DATE NOT NULL,
    target_end_date DATE,
    actual_end_date DATE,
    next_review_date DATE,
    last_reviewed_at TIMESTAMP WITH TIME ZONE,
    last_reviewed_by UUID,
    source_transcription_id UUID,
    source_rag_synthesis_id UUID,
    provider_id UUID,
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    created_by UUID,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT valid_patient_care_plan_status CHECK (status IN (
        'DRAFT', 'PENDING_REVIEW', 'ACTIVE', 'ON_HOLD', 'COMPLETED', 'CANCELLED'
    ))
);

CREATE INDEX idx_patient_care_plans_patient ON patient_care_plans(patient_id);
CREATE INDEX idx_patient_care_plans_care_plan ON patient_care_plans(care_plan_id);
CREATE INDEX idx_patient_care_plans_status ON patient_care_plans(status);
CREATE INDEX idx_patient_care_plans_active ON patient_care_plans(patient_id, status) WHERE status = 'ACTIVE';
CREATE INDEX idx_patient_care_plans_conditions ON patient_care_plans USING GIN(condition_codes);

-- ============================================================================
-- STEP 2: Create patient_care_plan_goals table (matching current care_plan_goals schema)
-- ============================================================================

CREATE TABLE patient_care_plan_goals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    patient_care_plan_id UUID NOT NULL REFERENCES patient_care_plans(id) ON DELETE CASCADE,
    care_plan_goal_id UUID, -- Reference to the source goal definition
    description TEXT NOT NULL,
    target_value VARCHAR(200),
    target_date DATE,
    current_value VARCHAR(200),
    status VARCHAR(20) NOT NULL DEFAULT 'NOT_STARTED',
    priority VARCHAR(10) NOT NULL DEFAULT 'MEDIUM',
    percent_complete INTEGER,
    linked_intervention_ids UUID[] DEFAULT '{}',
    guideline_reference VARCHAR(500),
    notes TEXT,
    completed_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT valid_patient_goal_status CHECK (status IN (
        'NOT_STARTED', 'IN_PROGRESS', 'ACHIEVED', 'NOT_ACHIEVED', 'CANCELLED'
    )),
    CONSTRAINT valid_patient_goal_priority CHECK (priority IN ('HIGH', 'MEDIUM', 'LOW'))
);

CREATE INDEX idx_patient_care_plan_goals_plan ON patient_care_plan_goals(patient_care_plan_id);
CREATE INDEX idx_patient_care_plan_goals_status ON patient_care_plan_goals(status);

-- ============================================================================
-- STEP 3: Create patient_care_plan_interventions table (matching current schema)
-- ============================================================================

CREATE TABLE patient_care_plan_interventions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    patient_care_plan_id UUID NOT NULL REFERENCES patient_care_plans(id) ON DELETE CASCADE,
    care_plan_intervention_id UUID, -- Reference to the source intervention definition
    type VARCHAR(20) NOT NULL,
    description TEXT NOT NULL,
    medication_code VARCHAR(50),
    dosage VARCHAR(200),
    frequency VARCHAR(100),
    procedure_code VARCHAR(50),
    referral_specialty VARCHAR(100),
    status VARCHAR(20) NOT NULL DEFAULT 'SCHEDULED',
    scheduled_date DATE,
    completed_date DATE,
    patient_instructions TEXT,
    provider_notes TEXT,
    guideline_reference VARCHAR(500),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT valid_patient_intervention_type CHECK (type IN (
        'MEDICATION', 'PROCEDURE', 'LIFESTYLE', 'MONITORING', 'REFERRAL', 'EDUCATION', 'FOLLOW_UP'
    )),
    CONSTRAINT valid_patient_intervention_status CHECK (status IN (
        'SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'DEFERRED'
    ))
);

CREATE INDEX idx_patient_interventions_plan ON patient_care_plan_interventions(patient_care_plan_id);
CREATE INDEX idx_patient_interventions_status ON patient_care_plan_interventions(status);
CREATE INDEX idx_patient_interventions_type ON patient_care_plan_interventions(type);
CREATE INDEX idx_patient_interventions_scheduled ON patient_care_plan_interventions(scheduled_date)
    WHERE status = 'SCHEDULED';

-- ============================================================================
-- STEP 4: Create patient_goal_progress_notes table
-- ============================================================================

CREATE TABLE patient_goal_progress_notes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    patient_goal_id UUID NOT NULL REFERENCES patient_care_plan_goals(id) ON DELETE CASCADE,
    note TEXT NOT NULL,
    value VARCHAR(200),
    recorded_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    recorded_by UUID NOT NULL
);

CREATE INDEX idx_patient_goal_progress_notes_goal ON patient_goal_progress_notes(patient_goal_id);

-- ============================================================================
-- STEP 5: Migrate data from old care_plans to patient_care_plans
-- ============================================================================

-- Migrate care plans (only those with patients - non-training examples)
INSERT INTO patient_care_plans (
    id, patient_id, title, status, condition_codes, start_date, target_end_date,
    actual_end_date, next_review_date, last_reviewed_at, last_reviewed_by,
    source_transcription_id, source_rag_synthesis_id, created_at, created_by, updated_at
)
SELECT
    id, patient_id, title, status, condition_codes, start_date, target_end_date,
    actual_end_date, next_review_date, last_reviewed_at, last_reviewed_by,
    source_transcription_id, source_rag_synthesis_id, created_at, created_by, updated_at
FROM care_plans
WHERE patient_id IS NOT NULL AND is_training_example = false;

-- Migrate care plan goals
INSERT INTO patient_care_plan_goals (
    id, patient_care_plan_id, description, target_value, target_date,
    current_value, status, priority, percent_complete, linked_intervention_ids,
    guideline_reference, created_at, updated_at
)
SELECT
    cpg.id, cpg.care_plan_id, cpg.description, cpg.target_value, cpg.target_date,
    cpg.current_value, cpg.status, cpg.priority, cpg.percent_complete,
    cpg.linked_intervention_ids, cpg.guideline_reference, cpg.created_at, cpg.updated_at
FROM care_plan_goals cpg
JOIN care_plans cp ON cpg.care_plan_id = cp.id
WHERE cp.patient_id IS NOT NULL AND cp.is_training_example = false;

-- Migrate care plan interventions
INSERT INTO patient_care_plan_interventions (
    id, patient_care_plan_id, type, description, medication_code, dosage, frequency,
    procedure_code, referral_specialty, status, scheduled_date, completed_date,
    patient_instructions, provider_notes, guideline_reference, created_at, updated_at
)
SELECT
    cpi.id, cpi.care_plan_id, cpi.type, cpi.description, cpi.medication_code,
    cpi.dosage, cpi.frequency, cpi.procedure_code, cpi.referral_specialty,
    cpi.status, cpi.scheduled_date, cpi.completed_date, cpi.patient_instructions,
    cpi.provider_notes, cpi.guideline_reference, cpi.created_at, cpi.updated_at
FROM care_plan_interventions cpi
JOIN care_plans cp ON cpi.care_plan_id = cp.id
WHERE cp.patient_id IS NOT NULL AND cp.is_training_example = false;

-- Migrate goal progress notes
INSERT INTO patient_goal_progress_notes (id, patient_goal_id, note, value, recorded_at, recorded_by)
SELECT gpn.id, gpn.goal_id, gpn.note, gpn.value, gpn.recorded_at, gpn.recorded_by
FROM goal_progress_notes gpn
JOIN care_plan_goals cpg ON gpn.goal_id = cpg.id
JOIN care_plans cp ON cpg.care_plan_id = cp.id
WHERE cp.patient_id IS NOT NULL AND cp.is_training_example = false;

-- ============================================================================
-- STEP 6: Drop foreign key constraints on tables referencing care_plans
-- ============================================================================

ALTER TABLE recommendation_layer_results DROP CONSTRAINT IF EXISTS recommendation_layer_results_care_plan_id_fkey;
ALTER TABLE recommendation_outcomes DROP CONSTRAINT IF EXISTS recommendation_outcomes_care_plan_id_fkey;
ALTER TABLE recommendation_personalizations DROP CONSTRAINT IF EXISTS recommendation_personalizations_care_plan_id_fkey;
ALTER TABLE recommendation_validations DROP CONSTRAINT IF EXISTS recommendation_validations_care_plan_id_fkey;
ALTER TABLE ml_model_training_data DROP CONSTRAINT IF EXISTS ml_model_training_data_care_plan_id_fkey;
ALTER TABLE care_plan_variants DROP CONSTRAINT IF EXISTS care_plan_variants_care_plan_id_fkey;

-- ============================================================================
-- STEP 7: Drop old tables (goal_progress_notes first due to FK)
-- ============================================================================

DROP TABLE IF EXISTS goal_progress_notes CASCADE;
DROP TABLE IF EXISTS care_plan_interventions CASCADE;
DROP TABLE IF EXISTS care_plan_goals CASCADE;
DROP TABLE IF EXISTS care_plans CASCADE;

-- ============================================================================
-- STEP 8: Rename template tables to care_plan tables
-- ============================================================================

ALTER TABLE care_plan_templates RENAME TO care_plans;
ALTER TABLE template_goals RENAME TO care_plan_goals;
ALTER TABLE template_interventions RENAME TO care_plan_interventions;

-- Rename columns
ALTER TABLE care_plan_goals RENAME COLUMN template_id TO care_plan_id;
ALTER TABLE care_plan_interventions RENAME COLUMN template_id TO care_plan_id;

-- ============================================================================
-- STEP 9: Update constraints and indexes
-- ============================================================================

-- Update foreign key constraints
ALTER TABLE care_plan_goals DROP CONSTRAINT IF EXISTS template_goals_template_id_fkey;
ALTER TABLE care_plan_goals ADD CONSTRAINT care_plan_goals_care_plan_id_fkey
    FOREIGN KEY (care_plan_id) REFERENCES care_plans(id) ON DELETE CASCADE;

ALTER TABLE care_plan_interventions DROP CONSTRAINT IF EXISTS template_interventions_template_id_fkey;
ALTER TABLE care_plan_interventions ADD CONSTRAINT care_plan_interventions_care_plan_id_fkey
    FOREIGN KEY (care_plan_id) REFERENCES care_plans(id) ON DELETE CASCADE;

-- Update check constraints
ALTER TABLE care_plan_goals DROP CONSTRAINT IF EXISTS valid_template_goal_priority;
ALTER TABLE care_plan_goals ADD CONSTRAINT valid_care_plan_goal_priority
    CHECK (priority IN ('HIGH', 'MEDIUM', 'LOW'));

ALTER TABLE care_plan_interventions DROP CONSTRAINT IF EXISTS valid_template_intervention_type;
ALTER TABLE care_plan_interventions ADD CONSTRAINT valid_care_plan_intervention_type
    CHECK (type IN ('MEDICATION', 'PROCEDURE', 'LAB', 'LIFESTYLE', 'MONITORING', 'REFERRAL', 'EDUCATION', 'FOLLOW_UP'));

-- Rename primary key constraints
ALTER INDEX IF EXISTS care_plan_templates_pkey RENAME TO care_plans_pkey;
ALTER INDEX IF EXISTS template_goals_pkey RENAME TO care_plan_goals_pkey;
ALTER INDEX IF EXISTS template_interventions_pkey RENAME TO care_plan_interventions_pkey;

-- Rename other indexes
ALTER INDEX IF EXISTS idx_care_plan_templates_active RENAME TO idx_care_plans_active;
ALTER INDEX IF EXISTS idx_care_plan_templates_category RENAME TO idx_care_plans_category;
ALTER INDEX IF EXISTS idx_care_plan_templates_conditions RENAME TO idx_care_plans_conditions;

-- ============================================================================
-- STEP 10: Re-add foreign keys to referencing tables
-- ============================================================================

-- care_plan_variants -> care_plans (clinical definitions)
ALTER TABLE care_plan_variants ADD CONSTRAINT care_plan_variants_care_plan_id_fkey
    FOREIGN KEY (care_plan_id) REFERENCES care_plans(id) ON DELETE CASCADE;

-- patient_care_plans -> care_plans (clinical definitions)
ALTER TABLE patient_care_plans ADD CONSTRAINT patient_care_plans_care_plan_id_fkey
    FOREIGN KEY (care_plan_id) REFERENCES care_plans(id) ON DELETE SET NULL;

-- patient_care_plan_goals -> care_plan_goals (source definitions)
ALTER TABLE patient_care_plan_goals ADD CONSTRAINT patient_care_plan_goals_source_fkey
    FOREIGN KEY (care_plan_goal_id) REFERENCES care_plan_goals(id) ON DELETE SET NULL;

-- patient_care_plan_interventions -> care_plan_interventions (source definitions)
ALTER TABLE patient_care_plan_interventions ADD CONSTRAINT patient_care_plan_interventions_source_fkey
    FOREIGN KEY (care_plan_intervention_id) REFERENCES care_plan_interventions(id) ON DELETE SET NULL;

-- ============================================================================
-- STEP 11: Update triggers
-- ============================================================================

DROP TRIGGER IF EXISTS trigger_care_plan_templates_updated_at ON care_plans;

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER trigger_care_plans_updated_at
    BEFORE UPDATE ON care_plans
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trigger_care_plan_goals_updated_at
    BEFORE UPDATE ON care_plan_goals
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trigger_care_plan_interventions_updated_at
    BEFORE UPDATE ON care_plan_interventions
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trigger_patient_care_plans_updated_at
    BEFORE UPDATE ON patient_care_plans
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trigger_patient_care_plan_goals_updated_at
    BEFORE UPDATE ON patient_care_plan_goals
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trigger_patient_care_plan_interventions_updated_at
    BEFORE UPDATE ON patient_care_plan_interventions
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- STEP 12: Add documentation comments
-- ============================================================================

COMMENT ON TABLE care_plans IS 'Clinical pathway definitions (patient-agnostic). Standard protocols for specific conditions.';
COMMENT ON TABLE care_plan_goals IS 'Goals defined for care plans. Template goals that can be assigned to patients.';
COMMENT ON TABLE care_plan_interventions IS 'Interventions (medications, procedures, labs, etc.) defined for care plans.';

COMMENT ON TABLE patient_care_plans IS 'Patient-specific care plan instances. Links a patient to a care plan with personalized settings.';
COMMENT ON TABLE patient_care_plan_goals IS 'Patient-specific goals. Tracks progress toward goals for a specific patient.';
COMMENT ON TABLE patient_care_plan_interventions IS 'Patient-specific interventions. Tracks scheduled and completed interventions for a specific patient.';
COMMENT ON TABLE patient_goal_progress_notes IS 'Progress notes for patient-specific goals.';

COMMIT;
