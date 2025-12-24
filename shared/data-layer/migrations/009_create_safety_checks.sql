-- Create safety checks table for CISS Safety service
CREATE TABLE IF NOT EXISTS safety_checks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    patient_id UUID NOT NULL,
    encounter_id UUID,

    -- Check details
    check_type VARCHAR(30) NOT NULL,
    trigger_medication_code VARCHAR(50),
    trigger_condition_code VARCHAR(50),

    -- Results
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    severity VARCHAR(20) NOT NULL,

    -- Description
    title VARCHAR(500) NOT NULL,
    description TEXT NOT NULL,
    clinical_rationale TEXT NOT NULL,

    -- Related items
    related_medications TEXT[] DEFAULT '{}',
    related_conditions TEXT[] DEFAULT '{}',
    related_allergies TEXT[] DEFAULT '{}',
    guideline_references TEXT[] DEFAULT '{}',

    -- Override info
    override_reason VARCHAR(50),
    override_justification TEXT,
    overridden_by UUID,
    overridden_at TIMESTAMP WITH TIME ZONE,
    override_expires_at TIMESTAMP WITH TIME ZONE,

    -- Audit
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE,

    CONSTRAINT valid_safety_check_type CHECK (
        check_type IN ('DRUG_INTERACTION', 'ALLERGY_CONFLICT', 'CONTRAINDICATION',
                       'DOSAGE_VALIDATION', 'DUPLICATE_THERAPY', 'AGE_APPROPRIATENESS',
                       'PREGNANCY_SAFETY', 'RENAL_ADJUSTMENT', 'HEPATIC_ADJUSTMENT')
    ),
    CONSTRAINT valid_safety_check_status CHECK (
        status IN ('PENDING', 'PASSED', 'FLAGGED', 'OVERRIDDEN', 'BLOCKED')
    ),
    CONSTRAINT valid_safety_severity CHECK (
        severity IN ('INFO', 'WARNING', 'CRITICAL', 'CONTRAINDICATED')
    ),
    CONSTRAINT valid_override_reason CHECK (
        override_reason IS NULL OR override_reason IN ('CLINICAL_JUDGMENT', 'PATIENT_INFORMED_CONSENT',
                                                        'NO_ALTERNATIVE_AVAILABLE', 'MONITORING_IN_PLACE',
                                                        'DOSAGE_ADJUSTED', 'SPECIALIST_APPROVED')
    )
);

-- Create review queue table
CREATE TABLE IF NOT EXISTS review_queue (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    patient_id UUID NOT NULL,
    safety_check_id UUID NOT NULL,
    recommendation_id UUID,

    -- Queue status
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING_REVIEW',
    priority VARCHAR(15) NOT NULL,

    -- Assignment
    assigned_to UUID,
    assigned_at TIMESTAMP WITH TIME ZONE,

    -- SLA
    sla_deadline TIMESTAMP WITH TIME ZONE NOT NULL,

    -- Resolution
    resolved_by UUID,
    resolved_at TIMESTAMP WITH TIME ZONE,
    resolution_notes TEXT,
    escalation_reason TEXT,

    -- Audit
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE,
    FOREIGN KEY (safety_check_id) REFERENCES safety_checks(id) ON DELETE CASCADE,

    CONSTRAINT valid_review_queue_status CHECK (
        status IN ('PENDING_REVIEW', 'IN_REVIEW', 'APPROVED', 'REJECTED', 'ESCALATED')
    ),
    CONSTRAINT valid_review_priority CHECK (
        priority IN ('P0_CRITICAL', 'P1_HIGH', 'P2_MEDIUM', 'P3_LOW')
    )
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_safety_checks_patient ON safety_checks(patient_id);
CREATE INDEX IF NOT EXISTS idx_safety_checks_encounter ON safety_checks(encounter_id);
CREATE INDEX IF NOT EXISTS idx_safety_checks_status ON safety_checks(status);
CREATE INDEX IF NOT EXISTS idx_safety_checks_severity ON safety_checks(severity);
CREATE INDEX IF NOT EXISTS idx_safety_checks_type ON safety_checks(check_type);
CREATE INDEX IF NOT EXISTS idx_safety_checks_patient_status ON safety_checks(patient_id, status);
CREATE INDEX IF NOT EXISTS idx_safety_checks_active_alerts ON safety_checks(patient_id, status, severity)
    WHERE status IN ('FLAGGED', 'BLOCKED') AND severity IN ('CRITICAL', 'CONTRAINDICATED');

CREATE INDEX IF NOT EXISTS idx_review_queue_patient ON review_queue(patient_id);
CREATE INDEX IF NOT EXISTS idx_review_queue_safety_check ON review_queue(safety_check_id);
CREATE INDEX IF NOT EXISTS idx_review_queue_assigned ON review_queue(assigned_to);
CREATE INDEX IF NOT EXISTS idx_review_queue_status ON review_queue(status);
CREATE INDEX IF NOT EXISTS idx_review_queue_priority ON review_queue(priority);
CREATE INDEX IF NOT EXISTS idx_review_queue_sla ON review_queue(sla_deadline)
    WHERE status IN ('PENDING_REVIEW', 'IN_REVIEW');
CREATE INDEX IF NOT EXISTS idx_review_queue_overdue ON review_queue(sla_deadline)
    WHERE status IN ('PENDING_REVIEW', 'IN_REVIEW') AND sla_deadline < CURRENT_TIMESTAMP;

-- Triggers for updated_at
CREATE OR REPLACE FUNCTION update_safety_check_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_safety_checks_updated_at
    BEFORE UPDATE ON safety_checks
    FOR EACH ROW
    EXECUTE FUNCTION update_safety_check_updated_at();

CREATE OR REPLACE FUNCTION update_review_queue_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_review_queue_updated_at
    BEFORE UPDATE ON review_queue
    FOR EACH ROW
    EXECUTE FUNCTION update_review_queue_updated_at();
