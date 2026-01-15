-- Migration: 018_create_recommendation_engine.sql
-- Purpose: Create tables for the three-layer recommendation engine
-- Layers: 1) Primary Matching, 2) Variant Selection, 3) Personalization

-- ============================================================================
-- LAYER 1 & 2: Care Plan Variant Groups and Selection Rules
-- ============================================================================

-- 1. Variant Groups - Groups care plans addressing the same condition
CREATE TABLE IF NOT EXISTS care_plan_variant_groups (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(300) NOT NULL,
    slug VARCHAR(300) NOT NULL UNIQUE,
    description TEXT,
    -- Primary condition codes this group addresses
    condition_codes TEXT[] NOT NULL,
    -- SNOMED/ICD category for broader matching
    condition_category VARCHAR(100),
    -- Whether this group is active for recommendations
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    created_by UUID,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 2. Variant Memberships - Links care plans to variant groups with targeting criteria
CREATE TABLE IF NOT EXISTS care_plan_variants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    variant_group_id UUID NOT NULL REFERENCES care_plan_variant_groups(id) ON DELETE CASCADE,
    care_plan_id UUID NOT NULL REFERENCES care_plans(id) ON DELETE CASCADE,
    -- Variant identification
    variant_name VARCHAR(200) NOT NULL,  -- e.g., "Pediatric", "Elderly", "Immunocompromised"
    variant_description TEXT,
    -- Targeting criteria (evaluated by Layer 2)
    target_age_min INTEGER,
    target_age_max INTEGER,
    target_sex VARCHAR(20),  -- 'male', 'female', 'any'
    target_conditions TEXT[],  -- Comorbidities that make this variant preferred
    target_risk_factors TEXT[],  -- Risk factors (e.g., 'smoking', 'obesity')
    exclusion_conditions TEXT[],  -- Conditions that exclude this variant
    -- Weighting
    priority_score INTEGER NOT NULL DEFAULT 100,  -- Higher = preferred when multiple match
    is_default BOOLEAN NOT NULL DEFAULT false,  -- Default variant if no rules match
    -- Status
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT unique_variant_care_plan UNIQUE (variant_group_id, care_plan_id)
);

-- 3. Selection Rules - Configurable rules for variant selection (Layer 2)
CREATE TABLE IF NOT EXISTS variant_selection_rules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    variant_group_id UUID REFERENCES care_plan_variant_groups(id) ON DELETE CASCADE,
    -- NULL variant_group_id = global rule
    name VARCHAR(200) NOT NULL,
    description TEXT,
    -- Rule definition (JSON-based rule engine)
    -- Format: { "conditions": [...], "action": { "prefer_variant": "..." } }
    rule_definition JSONB NOT NULL,
    -- Evaluation order (lower = evaluated first)
    priority INTEGER NOT NULL DEFAULT 100,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    created_by UUID,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================================
-- RECOMMENDATION AUDIT & EXPLAINABILITY
-- ============================================================================

-- 4. Recommendation Sessions - Tracks each recommendation request
CREATE TABLE IF NOT EXISTS recommendation_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- Request context
    patient_id UUID REFERENCES patients(id) ON DELETE SET NULL,
    provider_id UUID,
    -- Patient context snapshot (for audit)
    patient_context JSONB NOT NULL,
    -- Request parameters
    condition_codes TEXT[] NOT NULL,
    max_results INTEGER NOT NULL DEFAULT 5,
    -- Response summary
    total_candidates INTEGER NOT NULL DEFAULT 0,
    total_returned INTEGER NOT NULL DEFAULT 0,
    processing_time_ms FLOAT,
    -- Layer contributions
    layer1_matched INTEGER NOT NULL DEFAULT 0,  -- Primary matching results
    layer2_selected INTEGER NOT NULL DEFAULT 0,  -- After variant selection
    layer3_personalized INTEGER NOT NULL DEFAULT 0,  -- After personalization
    -- Status
    status VARCHAR(20) NOT NULL DEFAULT 'COMPLETED',
    error_message TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 5. Layer Results - Detailed results from each recommendation layer
CREATE TABLE IF NOT EXISTS recommendation_layer_results (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL REFERENCES recommendation_sessions(id) ON DELETE CASCADE,
    -- Which layer
    layer INTEGER NOT NULL,  -- 1, 2, or 3
    layer_name VARCHAR(50) NOT NULL,  -- 'primary_matching', 'variant_selection', 'personalization'
    -- Results
    care_plan_id UUID REFERENCES care_plans(id) ON DELETE CASCADE,
    variant_group_id UUID REFERENCES care_plan_variant_groups(id) ON DELETE SET NULL,
    -- Scoring
    score FLOAT NOT NULL,
    rank INTEGER NOT NULL,
    -- Explanation
    match_reasons JSONB,  -- Why this was matched/selected
    applied_rules TEXT[],  -- Which rules affected this result
    -- Flags
    was_promoted BOOLEAN DEFAULT false,  -- Promoted by later layer
    was_demoted BOOLEAN DEFAULT false,   -- Demoted by later layer
    was_filtered BOOLEAN DEFAULT false,  -- Filtered out by later layer
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================================
-- LAYER 3: PERSONALIZATION TRACKING
-- ============================================================================

-- 6. Personalization Factors - Tracks which personalization methods were applied
CREATE TABLE IF NOT EXISTS recommendation_personalizations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL REFERENCES recommendation_sessions(id) ON DELETE CASCADE,
    care_plan_id UUID NOT NULL REFERENCES care_plans(id) ON DELETE CASCADE,
    -- Personalization method
    method VARCHAR(50) NOT NULL,  -- 'decision_explorer', 'rag_synthesis', 'ml_ranking'
    -- Results
    original_score FLOAT,
    adjusted_score FLOAT,
    adjustment_reason TEXT,
    -- For Decision Explorer
    pathway_id UUID,
    pathway_node_id UUID,
    -- For RAG
    rag_synthesis_id UUID,
    rag_confidence FLOAT,
    -- For ML (when we have outcome data)
    ml_model_id UUID,
    ml_confidence FLOAT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================================
-- OUTCOME TRACKING (For future ML learning)
-- ============================================================================

-- 7. Recommendation Outcomes - Track what happened after recommendations
CREATE TABLE IF NOT EXISTS recommendation_outcomes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL REFERENCES recommendation_sessions(id) ON DELETE CASCADE,
    care_plan_id UUID NOT NULL REFERENCES care_plans(id) ON DELETE CASCADE,
    -- What happened
    outcome_type VARCHAR(50) NOT NULL,  -- 'accepted', 'modified', 'rejected', 'ignored'
    -- If modified, what changed
    modifications JSONB,
    -- Provider feedback
    provider_id UUID,
    feedback_rating INTEGER,  -- 1-5 star rating
    feedback_text TEXT,
    -- For learning
    was_helpful BOOLEAN,
    rejection_reason VARCHAR(200),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================================
-- INDEXES
-- ============================================================================

-- Variant Groups
CREATE INDEX IF NOT EXISTS idx_variant_groups_conditions ON care_plan_variant_groups USING GIN(condition_codes);
CREATE INDEX IF NOT EXISTS idx_variant_groups_active ON care_plan_variant_groups(is_active) WHERE is_active = true;

-- Variants
CREATE INDEX IF NOT EXISTS idx_variants_group ON care_plan_variants(variant_group_id);
CREATE INDEX IF NOT EXISTS idx_variants_care_plan ON care_plan_variants(care_plan_id);
CREATE INDEX IF NOT EXISTS idx_variants_active ON care_plan_variants(is_active) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_variants_target_conditions ON care_plan_variants USING GIN(target_conditions);

-- Selection Rules
CREATE INDEX IF NOT EXISTS idx_selection_rules_group ON variant_selection_rules(variant_group_id);
CREATE INDEX IF NOT EXISTS idx_selection_rules_priority ON variant_selection_rules(priority);

-- Recommendation Sessions
CREATE INDEX IF NOT EXISTS idx_rec_sessions_patient ON recommendation_sessions(patient_id);
CREATE INDEX IF NOT EXISTS idx_rec_sessions_created ON recommendation_sessions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_rec_sessions_conditions ON recommendation_sessions USING GIN(condition_codes);

-- Layer Results
CREATE INDEX IF NOT EXISTS idx_layer_results_session ON recommendation_layer_results(session_id);
CREATE INDEX IF NOT EXISTS idx_layer_results_layer ON recommendation_layer_results(layer);
CREATE INDEX IF NOT EXISTS idx_layer_results_care_plan ON recommendation_layer_results(care_plan_id);

-- Personalizations
CREATE INDEX IF NOT EXISTS idx_personalizations_session ON recommendation_personalizations(session_id);
CREATE INDEX IF NOT EXISTS idx_personalizations_method ON recommendation_personalizations(method);

-- Outcomes
CREATE INDEX IF NOT EXISTS idx_outcomes_session ON recommendation_outcomes(session_id);
CREATE INDEX IF NOT EXISTS idx_outcomes_type ON recommendation_outcomes(outcome_type);
CREATE INDEX IF NOT EXISTS idx_outcomes_care_plan ON recommendation_outcomes(care_plan_id);

-- ============================================================================
-- HELPER FUNCTIONS
-- ============================================================================

-- Function to find variant groups by condition codes (with prefix matching)
CREATE OR REPLACE FUNCTION find_variant_groups_by_conditions(
    p_condition_codes TEXT[]
) RETURNS TABLE (
    variant_group_id UUID,
    match_type VARCHAR(20),
    matched_codes TEXT[]
) AS $$
BEGIN
    RETURN QUERY
    SELECT DISTINCT
        vg.id as variant_group_id,
        CASE
            WHEN vg.condition_codes && p_condition_codes THEN 'exact'::VARCHAR(20)
            ELSE 'prefix'::VARCHAR(20)
        END as match_type,
        ARRAY(
            SELECT UNNEST(vg.condition_codes)
            INTERSECT
            SELECT UNNEST(p_condition_codes)
        ) as matched_codes
    FROM care_plan_variant_groups vg
    WHERE vg.is_active = true
    AND (
        -- Exact match
        vg.condition_codes && p_condition_codes
        OR
        -- Prefix match (e.g., J02% matches J02.0, J02.9)
        EXISTS (
            SELECT 1
            FROM UNNEST(vg.condition_codes) vc, UNNEST(p_condition_codes) pc
            WHERE pc LIKE vc || '%' OR vc LIKE pc || '%'
        )
    );
END;
$$ LANGUAGE plpgsql;

-- Function to evaluate targeting criteria for a variant
CREATE OR REPLACE FUNCTION evaluate_variant_targeting(
    p_variant_id UUID,
    p_patient_age INTEGER,
    p_patient_sex VARCHAR(20),
    p_patient_conditions TEXT[],
    p_patient_risk_factors TEXT[]
) RETURNS TABLE (
    matches BOOLEAN,
    match_score INTEGER,
    match_reasons TEXT[]
) AS $$
DECLARE
    v_variant RECORD;
    v_score INTEGER := 0;
    v_reasons TEXT[] := '{}';
BEGIN
    SELECT * INTO v_variant FROM care_plan_variants WHERE id = p_variant_id;

    IF NOT FOUND THEN
        RETURN QUERY SELECT false, 0, ARRAY['Variant not found']::TEXT[];
        RETURN;
    END IF;

    -- Check exclusions first
    IF v_variant.exclusion_conditions IS NOT NULL AND
       v_variant.exclusion_conditions && p_patient_conditions THEN
        RETURN QUERY SELECT false, -1000, ARRAY['Excluded by condition']::TEXT[];
        RETURN;
    END IF;

    -- Age matching
    IF v_variant.target_age_min IS NOT NULL AND p_patient_age >= v_variant.target_age_min THEN
        v_score := v_score + 10;
        v_reasons := array_append(v_reasons, 'Age >= ' || v_variant.target_age_min);
    ELSIF v_variant.target_age_min IS NOT NULL AND p_patient_age < v_variant.target_age_min THEN
        v_score := v_score - 50;
    END IF;

    IF v_variant.target_age_max IS NOT NULL AND p_patient_age <= v_variant.target_age_max THEN
        v_score := v_score + 10;
        v_reasons := array_append(v_reasons, 'Age <= ' || v_variant.target_age_max);
    ELSIF v_variant.target_age_max IS NOT NULL AND p_patient_age > v_variant.target_age_max THEN
        v_score := v_score - 50;
    END IF;

    -- Sex matching
    IF v_variant.target_sex IS NOT NULL AND v_variant.target_sex != 'any' THEN
        IF v_variant.target_sex = p_patient_sex THEN
            v_score := v_score + 10;
            v_reasons := array_append(v_reasons, 'Sex matches');
        ELSE
            v_score := v_score - 30;
        END IF;
    END IF;

    -- Target conditions (comorbidities)
    IF v_variant.target_conditions IS NOT NULL AND
       v_variant.target_conditions && p_patient_conditions THEN
        v_score := v_score + 30;
        v_reasons := array_append(v_reasons, 'Has target comorbidity');
    END IF;

    -- Risk factors
    IF v_variant.target_risk_factors IS NOT NULL AND
       v_variant.target_risk_factors && p_patient_risk_factors THEN
        v_score := v_score + 20;
        v_reasons := array_append(v_reasons, 'Has target risk factor');
    END IF;

    -- Add priority score
    v_score := v_score + v_variant.priority_score;

    -- Default variant gets base score if nothing else matched
    IF v_variant.is_default AND array_length(v_reasons, 1) IS NULL THEN
        v_score := v_score + 50;
        v_reasons := array_append(v_reasons, 'Default variant');
    END IF;

    RETURN QUERY SELECT true, v_score, v_reasons;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- VIEWS
-- ============================================================================

-- View: Variant groups with their variants
CREATE OR REPLACE VIEW v_variant_groups_with_variants AS
SELECT
    vg.id as group_id,
    vg.name as group_name,
    vg.slug as group_slug,
    vg.condition_codes as group_conditions,
    vg.is_active as group_active,
    json_agg(
        json_build_object(
            'variant_id', cpv.id,
            'care_plan_id', cpv.care_plan_id,
            'variant_name', cpv.variant_name,
            'is_default', cpv.is_default,
            'priority_score', cpv.priority_score,
            'target_age_min', cpv.target_age_min,
            'target_age_max', cpv.target_age_max,
            'care_plan_title', cp.title
        ) ORDER BY cpv.priority_score DESC
    ) FILTER (WHERE cpv.id IS NOT NULL) as variants
FROM care_plan_variant_groups vg
LEFT JOIN care_plan_variants cpv ON cpv.variant_group_id = vg.id AND cpv.is_active = true
LEFT JOIN care_plans cp ON cp.id = cpv.care_plan_id
GROUP BY vg.id, vg.name, vg.slug, vg.condition_codes, vg.is_active;

-- View: Recommendation session summary
CREATE OR REPLACE VIEW v_recommendation_session_summary AS
SELECT
    rs.id as session_id,
    rs.patient_id,
    rs.condition_codes,
    rs.created_at,
    rs.processing_time_ms,
    rs.layer1_matched,
    rs.layer2_selected,
    rs.layer3_personalized,
    rs.total_returned,
    json_agg(
        json_build_object(
            'care_plan_id', rlr.care_plan_id,
            'layer', rlr.layer,
            'score', rlr.score,
            'rank', rlr.rank,
            'reasons', rlr.match_reasons
        ) ORDER BY rlr.rank
    ) FILTER (WHERE rlr.id IS NOT NULL AND rlr.layer = 3) as final_results
FROM recommendation_sessions rs
LEFT JOIN recommendation_layer_results rlr ON rlr.session_id = rs.id
GROUP BY rs.id;

COMMENT ON TABLE care_plan_variant_groups IS 'Groups of care plans that address the same condition with different patient-specific variants';
COMMENT ON TABLE care_plan_variants IS 'Individual care plans within a variant group with targeting criteria';
COMMENT ON TABLE variant_selection_rules IS 'Configurable rules for selecting between variants';
COMMENT ON TABLE recommendation_sessions IS 'Audit trail of recommendation requests';
COMMENT ON TABLE recommendation_layer_results IS 'Detailed results from each recommendation engine layer';
COMMENT ON TABLE recommendation_personalizations IS 'Personalization methods applied to recommendations';
COMMENT ON TABLE recommendation_outcomes IS 'Outcomes tracking for ML learning and quality improvement';
