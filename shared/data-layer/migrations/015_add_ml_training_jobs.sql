-- ML Training Jobs table
-- Tracks model training jobs, status, metrics, and artifacts

CREATE TABLE IF NOT EXISTS ml_training_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Job identification
    model_type VARCHAR(50) NOT NULL,  -- 'careplan_recommender', 'care_plan_validator', etc.
    job_name VARCHAR(200),

    -- Status tracking
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    progress_percent INTEGER DEFAULT 0 CHECK (progress_percent >= 0 AND progress_percent <= 100),
    status_message TEXT,

    -- Configuration
    config JSONB DEFAULT '{}',

    -- Results and metrics
    metrics JSONB DEFAULT '{}',
    model_path VARCHAR(500),
    model_version VARCHAR(50),

    -- Data statistics
    training_examples_count INTEGER,
    validation_examples_count INTEGER,
    templates_count INTEGER,

    -- Timing
    started_at TIMESTAMP WITH TIME ZONE,
    completed_at TIMESTAMP WITH TIME ZONE,

    -- Audit
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    created_by UUID,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,

    -- Constraints
    CONSTRAINT valid_training_status CHECK (
        status IN ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED')
    )
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_training_jobs_status
ON ml_training_jobs(status);

CREATE INDEX IF NOT EXISTS idx_training_jobs_model_type
ON ml_training_jobs(model_type);

CREATE INDEX IF NOT EXISTS idx_training_jobs_created
ON ml_training_jobs(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_training_jobs_model_type_status
ON ml_training_jobs(model_type, status);

-- Trigger to update updated_at
CREATE OR REPLACE FUNCTION update_training_job_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS training_jobs_updated_at ON ml_training_jobs;
CREATE TRIGGER training_jobs_updated_at
    BEFORE UPDATE ON ml_training_jobs
    FOR EACH ROW
    EXECUTE FUNCTION update_training_job_timestamp();

-- Model versions table for tracking deployed models
CREATE TABLE IF NOT EXISTS ml_model_versions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Model identification
    model_type VARCHAR(50) NOT NULL,
    version VARCHAR(50) NOT NULL,

    -- Status
    is_active BOOLEAN NOT NULL DEFAULT false,
    is_default BOOLEAN NOT NULL DEFAULT false,

    -- Metadata
    training_job_id UUID REFERENCES ml_training_jobs(id),
    model_path VARCHAR(500) NOT NULL,

    -- Performance metrics
    metrics JSONB DEFAULT '{}',

    -- Audit
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    deployed_at TIMESTAMP WITH TIME ZONE,
    retired_at TIMESTAMP WITH TIME ZONE,

    -- Note: partial unique constraint handled by index below
    CONSTRAINT unique_model_type_version UNIQUE (model_type, version)
);

-- Partial unique index: only one default per model type
CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_default_per_model
ON ml_model_versions(model_type)
WHERE is_default = true;

CREATE INDEX IF NOT EXISTS idx_model_versions_type_active
ON ml_model_versions(model_type, is_active)
WHERE is_active = true;

-- Function to get the active model version for a model type
CREATE OR REPLACE FUNCTION get_active_model_version(p_model_type VARCHAR(50))
RETURNS TABLE (
    version VARCHAR(50),
    model_path VARCHAR(500),
    metrics JSONB,
    deployed_at TIMESTAMP WITH TIME ZONE
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        mv.version,
        mv.model_path,
        mv.metrics,
        mv.deployed_at
    FROM ml_model_versions mv
    WHERE mv.model_type = p_model_type
      AND mv.is_active = true
      AND mv.is_default = true
    LIMIT 1;
END;
$$ LANGUAGE plpgsql;

-- Comments
COMMENT ON TABLE ml_training_jobs IS 'Tracks ML model training jobs including status, metrics, and artifacts';
COMMENT ON TABLE ml_model_versions IS 'Tracks deployed ML model versions for each model type';
