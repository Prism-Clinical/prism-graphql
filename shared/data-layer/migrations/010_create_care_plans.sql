-- Create care plans table for CISS Care Plan service
CREATE TABLE IF NOT EXISTS care_plans (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    patient_id UUID NOT NULL,

    -- Plan metadata
    title VARCHAR(500) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'DRAFT',
    condition_codes TEXT[] NOT NULL,

    -- Timeline
    start_date DATE NOT NULL,
    target_end_date DATE,
    actual_end_date DATE,

    -- Review schedule
    next_review_date DATE,
    last_reviewed_at TIMESTAMP WITH TIME ZONE,
    last_reviewed_by UUID,

    -- Source tracking
    source_transcription_id UUID,
    source_rag_synthesis_id UUID,
    template_id UUID,

    -- Audit
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    created_by UUID NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE,

    CONSTRAINT valid_care_plan_status CHECK (
        status IN ('DRAFT', 'PENDING_REVIEW', 'ACTIVE', 'ON_HOLD', 'COMPLETED', 'CANCELLED')
    )
);

-- Create care plan goals table
CREATE TABLE IF NOT EXISTS care_plan_goals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    care_plan_id UUID NOT NULL,

    -- Goal details
    description TEXT NOT NULL,
    target_value VARCHAR(200),
    target_date DATE,

    -- Status
    status VARCHAR(20) NOT NULL DEFAULT 'NOT_STARTED',
    priority VARCHAR(10) NOT NULL,

    -- Progress
    current_value VARCHAR(200),
    percent_complete INTEGER,
    linked_intervention_ids UUID[] DEFAULT '{}',

    -- Evidence
    guideline_reference VARCHAR(500),

    -- Audit
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (care_plan_id) REFERENCES care_plans(id) ON DELETE CASCADE,

    CONSTRAINT valid_goal_status CHECK (
        status IN ('NOT_STARTED', 'IN_PROGRESS', 'ACHIEVED', 'NOT_ACHIEVED', 'CANCELLED')
    ),
    CONSTRAINT valid_goal_priority CHECK (
        priority IN ('HIGH', 'MEDIUM', 'LOW')
    )
);

-- Create goal progress notes table
CREATE TABLE IF NOT EXISTS goal_progress_notes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    goal_id UUID NOT NULL,

    note TEXT NOT NULL,
    value VARCHAR(200),
    recorded_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    recorded_by UUID NOT NULL,

    FOREIGN KEY (goal_id) REFERENCES care_plan_goals(id) ON DELETE CASCADE
);

-- Create care plan interventions table
CREATE TABLE IF NOT EXISTS care_plan_interventions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    care_plan_id UUID NOT NULL,

    -- Intervention details
    type VARCHAR(20) NOT NULL,
    description TEXT NOT NULL,

    -- For medication interventions
    medication_code VARCHAR(50),
    dosage VARCHAR(200),
    frequency VARCHAR(100),

    -- For procedure/referral interventions
    procedure_code VARCHAR(50),
    referral_specialty VARCHAR(100),

    -- Scheduling
    status VARCHAR(20) NOT NULL DEFAULT 'SCHEDULED',
    scheduled_date DATE,
    completed_date DATE,

    -- Instructions
    patient_instructions TEXT,
    provider_notes TEXT,

    -- Evidence
    guideline_reference VARCHAR(500),

    -- Audit
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (care_plan_id) REFERENCES care_plans(id) ON DELETE CASCADE,

    CONSTRAINT valid_intervention_type CHECK (
        type IN ('MEDICATION', 'PROCEDURE', 'LIFESTYLE', 'MONITORING', 'REFERRAL', 'EDUCATION', 'FOLLOW_UP')
    ),
    CONSTRAINT valid_intervention_status CHECK (
        status IN ('SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'DEFERRED')
    )
);

-- Create care plan templates table
CREATE TABLE IF NOT EXISTS care_plan_templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Template metadata
    name VARCHAR(200) NOT NULL,
    category VARCHAR(30) NOT NULL,
    condition_codes TEXT[] NOT NULL,

    -- Source
    guideline_source VARCHAR(100),
    evidence_grade VARCHAR(5),

    -- Status
    is_active BOOLEAN NOT NULL DEFAULT true,
    version VARCHAR(20) NOT NULL DEFAULT '1.0',

    -- Audit
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT valid_template_category CHECK (
        category IN ('CHRONIC_DISEASE', 'PREVENTIVE_CARE', 'POST_PROCEDURE',
                     'MEDICATION_MANAGEMENT', 'LIFESTYLE_MODIFICATION')
    )
);

-- Create template goals table
CREATE TABLE IF NOT EXISTS template_goals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    template_id UUID NOT NULL,

    description TEXT NOT NULL,
    default_target_value VARCHAR(200),
    default_target_days INTEGER,
    priority VARCHAR(10) NOT NULL,

    FOREIGN KEY (template_id) REFERENCES care_plan_templates(id) ON DELETE CASCADE,

    CONSTRAINT valid_template_goal_priority CHECK (
        priority IN ('HIGH', 'MEDIUM', 'LOW')
    )
);

-- Create template interventions table
CREATE TABLE IF NOT EXISTS template_interventions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    template_id UUID NOT NULL,

    type VARCHAR(20) NOT NULL,
    description TEXT NOT NULL,
    medication_code VARCHAR(50),
    procedure_code VARCHAR(50),
    default_schedule_days INTEGER,

    FOREIGN KEY (template_id) REFERENCES care_plan_templates(id) ON DELETE CASCADE,

    CONSTRAINT valid_template_intervention_type CHECK (
        type IN ('MEDICATION', 'PROCEDURE', 'LIFESTYLE', 'MONITORING', 'REFERRAL', 'EDUCATION', 'FOLLOW_UP')
    )
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_care_plans_patient ON care_plans(patient_id);
CREATE INDEX IF NOT EXISTS idx_care_plans_status ON care_plans(status);
CREATE INDEX IF NOT EXISTS idx_care_plans_conditions ON care_plans USING GIN(condition_codes);
CREATE INDEX IF NOT EXISTS idx_care_plans_active ON care_plans(patient_id, status)
    WHERE status = 'ACTIVE';

CREATE INDEX IF NOT EXISTS idx_care_plan_goals_plan ON care_plan_goals(care_plan_id);
CREATE INDEX IF NOT EXISTS idx_care_plan_goals_status ON care_plan_goals(status);

CREATE INDEX IF NOT EXISTS idx_goal_progress_notes_goal ON goal_progress_notes(goal_id);

CREATE INDEX IF NOT EXISTS idx_care_plan_interventions_plan ON care_plan_interventions(care_plan_id);
CREATE INDEX IF NOT EXISTS idx_care_plan_interventions_status ON care_plan_interventions(status);
CREATE INDEX IF NOT EXISTS idx_care_plan_interventions_scheduled ON care_plan_interventions(scheduled_date)
    WHERE status = 'SCHEDULED';

CREATE INDEX IF NOT EXISTS idx_care_plan_templates_category ON care_plan_templates(category);
CREATE INDEX IF NOT EXISTS idx_care_plan_templates_conditions ON care_plan_templates USING GIN(condition_codes);
CREATE INDEX IF NOT EXISTS idx_care_plan_templates_active ON care_plan_templates(is_active)
    WHERE is_active = true;

-- Triggers for updated_at
CREATE OR REPLACE FUNCTION update_care_plan_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_care_plans_updated_at
    BEFORE UPDATE ON care_plans
    FOR EACH ROW
    EXECUTE FUNCTION update_care_plan_updated_at();

CREATE TRIGGER trigger_care_plan_goals_updated_at
    BEFORE UPDATE ON care_plan_goals
    FOR EACH ROW
    EXECUTE FUNCTION update_care_plan_updated_at();

CREATE TRIGGER trigger_care_plan_interventions_updated_at
    BEFORE UPDATE ON care_plan_interventions
    FOR EACH ROW
    EXECUTE FUNCTION update_care_plan_updated_at();

CREATE TRIGGER trigger_care_plan_templates_updated_at
    BEFORE UPDATE ON care_plan_templates
    FOR EACH ROW
    EXECUTE FUNCTION update_care_plan_updated_at();
