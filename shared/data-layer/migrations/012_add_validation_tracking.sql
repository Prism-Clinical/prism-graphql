-- Track validation results for audit, compliance, and model improvement
-- This table stores every recommendation validation decision for:
-- 1. Audit trail of ML-assisted decisions
-- 2. Training data for model improvement (clinician overrides)
-- 3. Analytics on validation accuracy

CREATE TABLE IF NOT EXISTS recommendation_validations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Link to the recommendation if it was created
    recommendation_id UUID,
    care_plan_id UUID,
    intervention_id UUID,

    -- Patient context
    patient_id UUID NOT NULL,

    -- Input context (stored for training data)
    condition_codes TEXT[] NOT NULL DEFAULT '{}',
    medication_codes TEXT[] DEFAULT '{}',
    lab_codes TEXT[] DEFAULT '{}',
    lab_values JSONB DEFAULT '{}',
    complications TEXT[] DEFAULT '{}',
    risk_factors TEXT[] DEFAULT '{}',

    -- Recommendation details
    recommendation_type VARCHAR(30) NOT NULL,
    recommendation_code VARCHAR(50),
    recommendation_text TEXT NOT NULL,
    dosage VARCHAR(100),
    frequency VARCHAR(100),

    -- Guideline source
    guideline_id UUID,
    guideline_source VARCHAR(20),
    evidence_grade VARCHAR(5),
    guideline_age_days INTEGER,

    -- Validation results from ML model
    is_valid BOOLEAN NOT NULL,
    confidence_score FLOAT NOT NULL,
    validation_tier VARCHAR(20) NOT NULL,
    is_anomaly BOOLEAN NOT NULL DEFAULT FALSE,
    anomaly_score FLOAT,
    deviation_factors TEXT[] DEFAULT '{}',
    similar_plan_ids UUID[] DEFAULT '{}',

    -- Alternative suggestion if blocked
    alternative_recommendation TEXT,
    alternative_confidence FLOAT,

    -- Outcome tracking (for model improvement)
    clinician_override BOOLEAN,
    override_reason TEXT,
    final_decision VARCHAR(20),

    -- Processing metadata
    model_version VARCHAR(50),
    processing_time_ms INTEGER,

    -- Audit
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    created_by UUID,
    reviewed_at TIMESTAMP WITH TIME ZONE,
    reviewed_by UUID,

    -- Constraints
    FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE,
    FOREIGN KEY (care_plan_id) REFERENCES care_plans(id) ON DELETE SET NULL,
    FOREIGN KEY (guideline_id) REFERENCES guidelines(id) ON DELETE SET NULL,

    CONSTRAINT valid_recommendation_type CHECK (
        recommendation_type IN (
            'MEDICATION', 'PROCEDURE', 'LIFESTYLE', 'MONITORING',
            'REFERRAL', 'EDUCATION', 'FOLLOW_UP', 'LAB_ORDER', 'IMAGING'
        )
    ),
    CONSTRAINT valid_validation_tier CHECK (
        validation_tier IN ('HIGH_CONFIDENCE', 'NEEDS_REVIEW', 'BLOCKED')
    ),
    CONSTRAINT valid_final_decision CHECK (
        final_decision IS NULL OR final_decision IN ('APPROVED', 'MODIFIED', 'REJECTED')
    ),
    CONSTRAINT valid_confidence_score CHECK (
        confidence_score >= 0 AND confidence_score <= 1
    ),
    CONSTRAINT valid_anomaly_score CHECK (
        anomaly_score IS NULL OR (anomaly_score >= 0 AND anomaly_score <= 1)
    )
);

-- Indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_validations_patient
ON recommendation_validations(patient_id);

CREATE INDEX IF NOT EXISTS idx_validations_care_plan
ON recommendation_validations(care_plan_id)
WHERE care_plan_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_validations_outcome
ON recommendation_validations(final_decision)
WHERE final_decision IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_validations_anomaly
ON recommendation_validations(is_anomaly)
WHERE is_anomaly = true;

CREATE INDEX IF NOT EXISTS idx_validations_override
ON recommendation_validations(clinician_override)
WHERE clinician_override = true;

CREATE INDEX IF NOT EXISTS idx_validations_created_at
ON recommendation_validations(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_validations_tier
ON recommendation_validations(validation_tier);

CREATE INDEX IF NOT EXISTS idx_validations_conditions
ON recommendation_validations USING GIN(condition_codes);

-- Create view for training data export
CREATE OR REPLACE VIEW validation_training_data AS
SELECT
    rv.id,
    rv.condition_codes,
    rv.medication_codes,
    rv.lab_codes,
    rv.lab_values,
    rv.complications,
    rv.risk_factors,
    rv.recommendation_type,
    rv.recommendation_code,
    rv.recommendation_text,
    rv.dosage,
    rv.frequency,
    rv.guideline_source,
    rv.evidence_grade,
    rv.is_valid as model_prediction,
    rv.confidence_score as model_confidence,
    rv.is_anomaly as model_anomaly,
    rv.anomaly_score as model_anomaly_score,
    COALESCE(rv.final_decision,
        CASE WHEN rv.is_valid THEN 'APPROVED' ELSE 'REJECTED' END
    ) as actual_outcome,
    rv.clinician_override,
    rv.override_reason,
    rv.created_at
FROM recommendation_validations rv
WHERE rv.final_decision IS NOT NULL
   OR rv.created_at < CURRENT_TIMESTAMP - INTERVAL '7 days';

COMMENT ON VIEW validation_training_data IS
'Training data for Care Plan Validator model improvement. Includes completed validations with outcomes.';

-- Create function to get validation statistics
CREATE OR REPLACE FUNCTION get_validation_statistics(
    start_date TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP - INTERVAL '30 days',
    end_date TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
)
RETURNS TABLE (
    total_validations BIGINT,
    high_confidence_count BIGINT,
    needs_review_count BIGINT,
    blocked_count BIGINT,
    anomaly_count BIGINT,
    override_count BIGINT,
    approval_rate FLOAT,
    override_rate FLOAT,
    avg_confidence FLOAT
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        COUNT(*)::BIGINT as total_validations,
        COUNT(*) FILTER (WHERE validation_tier = 'HIGH_CONFIDENCE')::BIGINT as high_confidence_count,
        COUNT(*) FILTER (WHERE validation_tier = 'NEEDS_REVIEW')::BIGINT as needs_review_count,
        COUNT(*) FILTER (WHERE validation_tier = 'BLOCKED')::BIGINT as blocked_count,
        COUNT(*) FILTER (WHERE is_anomaly = true)::BIGINT as anomaly_count,
        COUNT(*) FILTER (WHERE clinician_override = true)::BIGINT as override_count,
        AVG(CASE WHEN final_decision = 'APPROVED' THEN 1.0 ELSE 0.0 END)::FLOAT as approval_rate,
        AVG(CASE WHEN clinician_override = true THEN 1.0 ELSE 0.0 END)::FLOAT as override_rate,
        AVG(confidence_score)::FLOAT as avg_confidence
    FROM recommendation_validations
    WHERE created_at BETWEEN start_date AND end_date;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION get_validation_statistics IS
'Returns validation statistics for a given time period for monitoring model performance.';
