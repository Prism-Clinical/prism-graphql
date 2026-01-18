-- Migration: Add ML Model Registry for multi-model management
-- Purpose: Support named models, versioning, manual/filter training data assignment

-- =============================================================================
-- 1. ML MODELS TABLE - Model Registry
-- =============================================================================

CREATE TABLE IF NOT EXISTS ml_models (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Model identification
    name VARCHAR(200) NOT NULL,
    slug VARCHAR(200) NOT NULL UNIQUE,
    description TEXT,
    model_type VARCHAR(50) NOT NULL DEFAULT 'careplan_recommender',

    -- Filter criteria for automatic training data selection
    -- Example: {"condition_code_prefixes": ["J02"], "training_tags": ["strep"]}
    filter_criteria JSONB DEFAULT '{}',

    -- Target conditions this model specializes in
    target_conditions TEXT[] DEFAULT '{}',

    -- Status flags
    is_active BOOLEAN NOT NULL DEFAULT true,
    is_default BOOLEAN NOT NULL DEFAULT false,

    -- Audit
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    created_by UUID,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for ml_models
CREATE INDEX IF NOT EXISTS idx_ml_models_slug ON ml_models(slug);
CREATE INDEX IF NOT EXISTS idx_ml_models_model_type ON ml_models(model_type);
CREATE INDEX IF NOT EXISTS idx_ml_models_active ON ml_models(is_active) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_ml_models_target_conditions ON ml_models USING GIN(target_conditions);

-- Partial unique index: only one default per model type
CREATE UNIQUE INDEX IF NOT EXISTS idx_ml_models_unique_default
ON ml_models(model_type)
WHERE is_default = true;

-- =============================================================================
-- 2. MODIFY ML_MODEL_VERSIONS - Link to models
-- =============================================================================

-- Add model_id reference
ALTER TABLE ml_model_versions
    ADD COLUMN IF NOT EXISTS model_id UUID REFERENCES ml_models(id) ON DELETE CASCADE;

-- Add version description
ALTER TABLE ml_model_versions
    ADD COLUMN IF NOT EXISTS description TEXT;

-- Add training data snapshot for reproducibility
ALTER TABLE ml_model_versions
    ADD COLUMN IF NOT EXISTS training_data_snapshot JSONB DEFAULT '{}';

-- Index for model versions by model
CREATE INDEX IF NOT EXISTS idx_ml_model_versions_model_id
ON ml_model_versions(model_id);

CREATE INDEX IF NOT EXISTS idx_ml_model_versions_model_active
ON ml_model_versions(model_id, is_active)
WHERE is_active = true;

-- =============================================================================
-- 3. ML_MODEL_TRAINING_DATA - Manual training data assignments
-- =============================================================================

CREATE TABLE IF NOT EXISTS ml_model_training_data (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Relationships
    model_id UUID NOT NULL REFERENCES ml_models(id) ON DELETE CASCADE,
    care_plan_id UUID NOT NULL REFERENCES care_plans(id) ON DELETE CASCADE,

    -- Assignment metadata
    assignment_type VARCHAR(20) NOT NULL DEFAULT 'manual',
    notes TEXT,

    -- Audit
    assigned_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    assigned_by UUID,

    -- Prevent duplicate assignments
    CONSTRAINT unique_model_care_plan UNIQUE (model_id, care_plan_id),

    -- Valid assignment types
    CONSTRAINT valid_assignment_type CHECK (
        assignment_type IN ('manual', 'filter', 'import')
    )
);

-- Indexes for training data
CREATE INDEX IF NOT EXISTS idx_ml_model_training_data_model
ON ml_model_training_data(model_id);

CREATE INDEX IF NOT EXISTS idx_ml_model_training_data_care_plan
ON ml_model_training_data(care_plan_id);

CREATE INDEX IF NOT EXISTS idx_ml_model_training_data_type
ON ml_model_training_data(model_id, assignment_type);

-- =============================================================================
-- 4. MODIFY ML_TRAINING_JOBS - Link to models and versions
-- =============================================================================

-- Add model reference
ALTER TABLE ml_training_jobs
    ADD COLUMN IF NOT EXISTS model_id UUID REFERENCES ml_models(id) ON DELETE SET NULL;

-- Add version reference (set after training completes)
ALTER TABLE ml_training_jobs
    ADD COLUMN IF NOT EXISTS version_id UUID REFERENCES ml_model_versions(id) ON DELETE SET NULL;

-- Index for jobs by model
CREATE INDEX IF NOT EXISTS idx_ml_training_jobs_model_id
ON ml_training_jobs(model_id);

-- =============================================================================
-- 5. HELPER FUNCTIONS
-- =============================================================================

-- Function to get training examples for a model (combines manual + filter)
CREATE OR REPLACE FUNCTION get_model_training_examples(p_model_id UUID)
RETURNS TABLE (
    care_plan_id UUID,
    assignment_type VARCHAR(20),
    title VARCHAR(500),
    condition_codes TEXT[],
    training_tags TEXT[]
) AS $$
DECLARE
    v_filter_criteria JSONB;
BEGIN
    -- Get model's filter criteria
    SELECT m.filter_criteria INTO v_filter_criteria
    FROM ml_models m
    WHERE m.id = p_model_id;

    -- Return combined manual assignments and filter matches
    RETURN QUERY
    WITH manual_assignments AS (
        -- Manual/import assignments from junction table
        SELECT
            mtd.care_plan_id,
            mtd.assignment_type
        FROM ml_model_training_data mtd
        WHERE mtd.model_id = p_model_id
    ),
    filter_matches AS (
        -- Auto-matched by filter criteria
        SELECT
            cp.id AS care_plan_id,
            'filter'::VARCHAR(20) AS assignment_type
        FROM care_plans cp
        WHERE cp.is_training_example = true
          AND p_model_id IS NOT NULL
          AND v_filter_criteria IS NOT NULL
          AND v_filter_criteria != '{}'::JSONB
          -- Match condition code prefixes
          AND (
              NOT v_filter_criteria ? 'condition_code_prefixes'
              OR EXISTS (
                  SELECT 1
                  FROM unnest(cp.condition_codes) AS cc,
                       jsonb_array_elements_text(v_filter_criteria->'condition_code_prefixes') AS prefix
                  WHERE cc LIKE prefix || '%'
              )
          )
          -- Match exact condition codes
          AND (
              NOT v_filter_criteria ? 'condition_codes'
              OR cp.condition_codes && ARRAY(
                  SELECT jsonb_array_elements_text(v_filter_criteria->'condition_codes')
              )
          )
          -- Match training tags
          AND (
              NOT v_filter_criteria ? 'training_tags'
              OR cp.training_tags && ARRAY(
                  SELECT jsonb_array_elements_text(v_filter_criteria->'training_tags')
              )
          )
          -- Exclude already manually assigned
          AND cp.id NOT IN (
              SELECT ma.care_plan_id FROM manual_assignments ma
          )
    ),
    combined AS (
        SELECT * FROM manual_assignments
        UNION ALL
        SELECT * FROM filter_matches
    )
    SELECT
        c.care_plan_id,
        c.assignment_type,
        cp.title,
        cp.condition_codes,
        cp.training_tags
    FROM combined c
    JOIN care_plans cp ON cp.id = c.care_plan_id
    WHERE cp.is_training_example = true;
END;
$$ LANGUAGE plpgsql;

-- Function to preview filter results without a model
CREATE OR REPLACE FUNCTION preview_filter_results(p_filter_criteria JSONB)
RETURNS TABLE (
    care_plan_id UUID,
    title VARCHAR(500),
    condition_codes TEXT[],
    training_tags TEXT[]
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        cp.id AS care_plan_id,
        cp.title,
        cp.condition_codes,
        cp.training_tags
    FROM care_plans cp
    WHERE cp.is_training_example = true
      AND p_filter_criteria IS NOT NULL
      AND p_filter_criteria != '{}'::JSONB
      -- Match condition code prefixes
      AND (
          NOT p_filter_criteria ? 'condition_code_prefixes'
          OR EXISTS (
              SELECT 1
              FROM unnest(cp.condition_codes) AS cc,
                   jsonb_array_elements_text(p_filter_criteria->'condition_code_prefixes') AS prefix
              WHERE cc LIKE prefix || '%'
          )
      )
      -- Match exact condition codes
      AND (
          NOT p_filter_criteria ? 'condition_codes'
          OR cp.condition_codes && ARRAY(
              SELECT jsonb_array_elements_text(p_filter_criteria->'condition_codes')
          )
      )
      -- Match training tags
      AND (
          NOT p_filter_criteria ? 'training_tags'
          OR cp.training_tags && ARRAY(
              SELECT jsonb_array_elements_text(p_filter_criteria->'training_tags')
          )
      );
END;
$$ LANGUAGE plpgsql;

-- Function to get active version for a specific model
CREATE OR REPLACE FUNCTION get_model_active_version(p_model_id UUID)
RETURNS TABLE (
    version_id UUID,
    version VARCHAR(50),
    model_path VARCHAR(500),
    metrics JSONB,
    deployed_at TIMESTAMP WITH TIME ZONE
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        mv.id AS version_id,
        mv.version,
        mv.model_path,
        mv.metrics,
        mv.deployed_at
    FROM ml_model_versions mv
    WHERE mv.model_id = p_model_id
      AND mv.is_active = true
      AND mv.is_default = true
    LIMIT 1;
END;
$$ LANGUAGE plpgsql;

-- Function to count training examples for a model
CREATE OR REPLACE FUNCTION get_model_training_count(p_model_id UUID)
RETURNS INTEGER AS $$
DECLARE
    v_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO v_count
    FROM get_model_training_examples(p_model_id);
    RETURN v_count;
END;
$$ LANGUAGE plpgsql;

-- =============================================================================
-- 6. TRIGGERS
-- =============================================================================

-- Trigger to update updated_at on ml_models
CREATE OR REPLACE FUNCTION update_ml_model_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS ml_models_updated_at ON ml_models;
CREATE TRIGGER ml_models_updated_at
    BEFORE UPDATE ON ml_models
    FOR EACH ROW
    EXECUTE FUNCTION update_ml_model_timestamp();

-- =============================================================================
-- 7. COMMENTS
-- =============================================================================

COMMENT ON TABLE ml_models IS 'Registry of ML models with configuration and filter criteria';
COMMENT ON TABLE ml_model_training_data IS 'Junction table for manual training data assignments to models';
COMMENT ON COLUMN ml_models.filter_criteria IS 'JSON filter for automatic training data selection: condition_code_prefixes, condition_codes, training_tags, categories';
COMMENT ON COLUMN ml_models.slug IS 'URL-friendly unique identifier for the model';
COMMENT ON COLUMN ml_model_versions.training_data_snapshot IS 'Snapshot of training data IDs used for this version';
COMMENT ON FUNCTION get_model_training_examples IS 'Returns combined manual assignments and filter-matched training examples for a model';
COMMENT ON FUNCTION preview_filter_results IS 'Preview which training examples would match a given filter criteria';
