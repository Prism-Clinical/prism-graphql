-- Migration: Create recommendation engine configuration table
-- Description: Stores configuration settings for the three-layer recommendation engine

-- Engine configuration table
CREATE TABLE IF NOT EXISTS recommendation_engine_config (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    config_key VARCHAR(100) UNIQUE NOT NULL,
    config_value JSONB NOT NULL,
    description TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create index on config_key for fast lookups
CREATE INDEX IF NOT EXISTS idx_engine_config_key ON recommendation_engine_config(config_key);

-- Insert default configuration values
INSERT INTO recommendation_engine_config (config_key, config_value, description) VALUES
(
    'matching',
    '{
        "strategy": "hybrid",
        "codeMatchPriority": "exact_first",
        "enableEmbeddings": true,
        "similarityThreshold": 0.75,
        "maxCandidates": 50,
        "scoreWeights": {
            "exactMatch": 100,
            "prefixMatch": 75,
            "categoryMatch": 50,
            "embeddingMatch": 60
        }
    }'::jsonb,
    'Layer 1: Primary matching configuration'
),
(
    'personalization',
    '{
        "enableRag": true,
        "enableOutcomeLearning": false,
        "enableDecisionPaths": true,
        "knowledgeSources": ["training_data", "clinical_guidelines", "care_plans"],
        "learningRate": "moderate"
    }'::jsonb,
    'Layer 3: Personalization configuration'
)
ON CONFLICT (config_key) DO NOTHING;

-- Function to get configuration by key
CREATE OR REPLACE FUNCTION get_engine_config(p_config_key VARCHAR)
RETURNS JSONB AS $$
DECLARE
    v_config JSONB;
BEGIN
    SELECT config_value INTO v_config
    FROM recommendation_engine_config
    WHERE config_key = p_config_key;

    RETURN v_config;
END;
$$ LANGUAGE plpgsql;

-- Function to update configuration
CREATE OR REPLACE FUNCTION update_engine_config(p_config_key VARCHAR, p_config_value JSONB)
RETURNS JSONB AS $$
DECLARE
    v_result JSONB;
BEGIN
    UPDATE recommendation_engine_config
    SET config_value = p_config_value,
        updated_at = NOW()
    WHERE config_key = p_config_key
    RETURNING config_value INTO v_result;

    IF v_result IS NULL THEN
        INSERT INTO recommendation_engine_config (config_key, config_value)
        VALUES (p_config_key, p_config_value)
        RETURNING config_value INTO v_result;
    END IF;

    RETURN v_result;
END;
$$ LANGUAGE plpgsql;

-- Trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_engine_config_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_engine_config_updated
    BEFORE UPDATE ON recommendation_engine_config
    FOR EACH ROW
    EXECUTE FUNCTION update_engine_config_timestamp();
