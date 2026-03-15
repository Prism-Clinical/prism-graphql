-- Migration 038: Create pathway graph relational side tables and confidence framework
-- These tables complement the AGE graph (migration 036) with search indexes,
-- resolution tracking, and the confidence configuration framework.

-- =============================================================================
-- 1. PATHWAY_GRAPH_INDEX — Relational index for pathway search and metadata
-- =============================================================================

CREATE TABLE pathway_graph_index (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    age_node_id VARCHAR(100),
    logical_id VARCHAR(100) NOT NULL,
    title VARCHAR(500) NOT NULL,
    version VARCHAR(20) NOT NULL,
    category VARCHAR(50) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'DRAFT',
    condition_codes TEXT[] NOT NULL DEFAULT '{}',
    scope TEXT,
    target_population TEXT,
    is_active BOOLEAN NOT NULL DEFAULT false,
    created_by UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT pathway_graph_index_status_check CHECK (
        status IN ('DRAFT', 'ACTIVE', 'ARCHIVED', 'SUPERSEDED')
    ),
    CONSTRAINT pathway_graph_index_category_check CHECK (
        category IN ('CHRONIC_DISEASE', 'ACUTE_CARE', 'PREVENTIVE_CARE', 'POST_PROCEDURE',
                     'MEDICATION_MANAGEMENT', 'LIFESTYLE_MODIFICATION', 'MENTAL_HEALTH',
                     'PEDIATRIC', 'GERIATRIC', 'OBSTETRIC')
    ),
    CONSTRAINT pathway_graph_index_logical_version_unique UNIQUE (logical_id, version)
);

CREATE INDEX idx_pathway_graph_index_logical_id ON pathway_graph_index(logical_id);
CREATE INDEX idx_pathway_graph_index_status ON pathway_graph_index(status);
CREATE INDEX idx_pathway_graph_index_condition_codes ON pathway_graph_index USING GIN(condition_codes);
CREATE INDEX idx_pathway_graph_index_active ON pathway_graph_index(is_active) WHERE is_active = true;
CREATE INDEX idx_pathway_graph_index_category ON pathway_graph_index(category);

-- =============================================================================
-- 2. PATHWAY_CONDITION_CODES — Flat code-to-pathway mapping for Layer 1 matching
-- =============================================================================

CREATE TABLE pathway_condition_codes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    pathway_id UUID NOT NULL REFERENCES pathway_graph_index(id) ON DELETE CASCADE,
    code VARCHAR(20) NOT NULL,
    system VARCHAR(10) NOT NULL,
    description TEXT,
    usage TEXT,
    grouping VARCHAR(50),

    CONSTRAINT pathway_condition_codes_system_check CHECK (
        system IN ('ICD-10', 'SNOMED', 'RXNORM', 'LOINC', 'CPT')
    )
);

CREATE INDEX idx_pathway_condition_codes_code ON pathway_condition_codes(code);
CREATE INDEX idx_pathway_condition_codes_pathway ON pathway_condition_codes(pathway_id);
CREATE INDEX idx_pathway_condition_codes_system ON pathway_condition_codes(system);

-- =============================================================================
-- 3. PATHWAY_VERSION_DIFFS — Import diff audit trail
-- =============================================================================

CREATE TABLE pathway_version_diffs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    pathway_id UUID NOT NULL REFERENCES pathway_graph_index(id) ON DELETE CASCADE,
    previous_pathway_id UUID REFERENCES pathway_graph_index(id) ON DELETE SET NULL,
    import_type VARCHAR(20) NOT NULL,
    diff_summary JSONB NOT NULL DEFAULT '{}',
    diff_details JSONB NOT NULL DEFAULT '[]',
    imported_by UUID,
    imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT pathway_version_diffs_import_type_check CHECK (
        import_type IN ('NEW_PATHWAY', 'DRAFT_UPDATE', 'NEW_VERSION')
    )
);

CREATE INDEX idx_pathway_version_diffs_pathway ON pathway_version_diffs(pathway_id);

-- =============================================================================
-- 4. PATHWAY_RESOLUTION_SESSIONS — Patient pathway resolution tracking
-- =============================================================================

CREATE TABLE pathway_resolution_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    patient_id UUID NOT NULL,
    provider_id UUID NOT NULL,
    pathway_id UUID NOT NULL REFERENCES pathway_graph_index(id) ON DELETE RESTRICT,
    patient_context JSONB NOT NULL DEFAULT '{}',
    status VARCHAR(20) NOT NULL DEFAULT 'IN_PROGRESS',
    resulting_care_plan_id UUID,
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT pathway_resolution_sessions_status_check CHECK (
        status IN ('IN_PROGRESS', 'COMPLETED', 'ABANDONED')
    )
);

CREATE INDEX idx_pathway_resolution_sessions_patient ON pathway_resolution_sessions(patient_id);
CREATE INDEX idx_pathway_resolution_sessions_pathway ON pathway_resolution_sessions(pathway_id);
CREATE INDEX idx_pathway_resolution_sessions_status ON pathway_resolution_sessions(status);

-- =============================================================================
-- 5. PATHWAY_RESOLUTION_DECISIONS — Individual decision point resolutions
-- =============================================================================

CREATE TABLE pathway_resolution_decisions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL REFERENCES pathway_resolution_sessions(id) ON DELETE CASCADE,
    decision_point_graph_id VARCHAR(100) NOT NULL,
    resolution_type VARCHAR(30) NOT NULL,
    chosen_branch VARCHAR(200) NOT NULL,
    confidence_score DECIMAL(4,3),
    confidence_breakdown JSONB,
    provider_override BOOLEAN NOT NULL DEFAULT false,
    override_reason TEXT,
    resolved_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    resolved_by UUID,

    CONSTRAINT pathway_resolution_decisions_type_check CHECK (
        resolution_type IN ('AUTO_RESOLVED', 'SYSTEM_SUGGESTED', 'PROVIDER_DECIDED', 'FORCED_MANUAL')
    )
);

CREATE INDEX idx_pathway_resolution_decisions_session ON pathway_resolution_decisions(session_id);
CREATE INDEX idx_pathway_resolution_decisions_graph_id ON pathway_resolution_decisions(decision_point_graph_id);

-- =============================================================================
-- 6. CONFIDENCE_SIGNAL_DEFINITIONS — Signal categories for confidence scoring
-- =============================================================================

CREATE TABLE confidence_signal_definitions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(100) NOT NULL,
    display_name VARCHAR(200) NOT NULL,
    description TEXT,
    scoring_type VARCHAR(30) NOT NULL,
    scoring_rules JSONB NOT NULL DEFAULT '{}',
    scope VARCHAR(20) NOT NULL DEFAULT 'SYSTEM',
    institution_id UUID,
    default_weight DECIMAL(5,4) NOT NULL DEFAULT 0.2500,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_by UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT confidence_signal_definitions_scoring_type_check CHECK (
        scoring_type IN ('DATA_PRESENCE', 'MAPPING_LOOKUP', 'CRITERIA_MATCH', 'RISK_INVERSE', 'CUSTOM_RULES')
    ),
    CONSTRAINT confidence_signal_definitions_scope_check CHECK (
        scope IN ('SYSTEM', 'ORGANIZATION', 'INSTITUTION')
    ),
    CONSTRAINT confidence_signal_definitions_name_scope_unique UNIQUE NULLS NOT DISTINCT (name, institution_id)
);

CREATE INDEX idx_confidence_signal_definitions_scope ON confidence_signal_definitions(scope);
CREATE INDEX idx_confidence_signal_definitions_institution ON confidence_signal_definitions(institution_id);

-- =============================================================================
-- 7. CONFIDENCE_SIGNAL_WEIGHTS — Multi-level signal weight overrides
-- =============================================================================

CREATE TABLE confidence_signal_weights (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    signal_definition_id UUID NOT NULL REFERENCES confidence_signal_definitions(id) ON DELETE CASCADE,
    weight DECIMAL(5,4) NOT NULL,
    scope VARCHAR(20) NOT NULL,
    pathway_id UUID REFERENCES pathway_graph_index(id) ON DELETE CASCADE,
    node_identifier VARCHAR(100),
    node_type VARCHAR(30),
    institution_id UUID,
    created_by UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT confidence_signal_weights_scope_check CHECK (
        scope IN ('NODE', 'PATHWAY', 'INSTITUTION_GLOBAL', 'ORGANIZATION_GLOBAL')
    ),
    CONSTRAINT confidence_signal_weights_unique UNIQUE NULLS NOT DISTINCT (signal_definition_id, scope, pathway_id, node_identifier, institution_id)
);

CREATE INDEX idx_confidence_signal_weights_signal ON confidence_signal_weights(signal_definition_id);
CREATE INDEX idx_confidence_signal_weights_pathway ON confidence_signal_weights(pathway_id);
CREATE INDEX idx_confidence_signal_weights_institution ON confidence_signal_weights(institution_id);

-- =============================================================================
-- 8. CONFIDENCE_NODE_WEIGHTS — Per-node importance weights for pathway rollup
-- =============================================================================

CREATE TABLE confidence_node_weights (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    pathway_id UUID NOT NULL REFERENCES pathway_graph_index(id) ON DELETE CASCADE,
    node_identifier VARCHAR(100) NOT NULL,
    node_type VARCHAR(30) NOT NULL,
    default_weight DECIMAL(5,4) NOT NULL DEFAULT 1.0000,
    institution_id UUID,
    weight_override DECIMAL(5,4),
    created_by UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT confidence_node_weights_unique UNIQUE NULLS NOT DISTINCT (pathway_id, node_identifier, institution_id)
);

CREATE INDEX idx_confidence_node_weights_pathway ON confidence_node_weights(pathway_id);
CREATE INDEX idx_confidence_node_weights_institution ON confidence_node_weights(institution_id);

-- =============================================================================
-- 9. CONFIDENCE_RESOLUTION_THRESHOLDS — Auto-resolve and suggest thresholds
-- =============================================================================

CREATE TABLE confidence_resolution_thresholds (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    auto_resolve_threshold DECIMAL(5,4) NOT NULL DEFAULT 0.8500,
    suggest_threshold DECIMAL(5,4) NOT NULL DEFAULT 0.6000,
    scope VARCHAR(20) NOT NULL,
    pathway_id UUID REFERENCES pathway_graph_index(id) ON DELETE CASCADE,
    node_identifier VARCHAR(100),
    institution_id UUID,
    created_by UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT confidence_resolution_thresholds_scope_check CHECK (
        scope IN ('SYSTEM_DEFAULT', 'ORGANIZATION', 'INSTITUTION', 'PATHWAY', 'NODE')
    )
);

CREATE INDEX idx_confidence_resolution_thresholds_scope ON confidence_resolution_thresholds(scope);
CREATE INDEX idx_confidence_resolution_thresholds_pathway ON confidence_resolution_thresholds(pathway_id);
CREATE INDEX idx_confidence_resolution_thresholds_institution ON confidence_resolution_thresholds(institution_id);

-- =============================================================================
-- 10. UPDATED_AT TRIGGERS
-- =============================================================================

CREATE OR REPLACE FUNCTION update_pathway_graph_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER pathway_graph_index_updated_at
    BEFORE UPDATE ON pathway_graph_index
    FOR EACH ROW EXECUTE FUNCTION update_pathway_graph_timestamp();

CREATE TRIGGER pathway_resolution_sessions_updated_at
    BEFORE UPDATE ON pathway_resolution_sessions
    FOR EACH ROW EXECUTE FUNCTION update_pathway_graph_timestamp();

CREATE TRIGGER confidence_signal_definitions_updated_at
    BEFORE UPDATE ON confidence_signal_definitions
    FOR EACH ROW EXECUTE FUNCTION update_pathway_graph_timestamp();

CREATE TRIGGER confidence_signal_weights_updated_at
    BEFORE UPDATE ON confidence_signal_weights
    FOR EACH ROW EXECUTE FUNCTION update_pathway_graph_timestamp();

CREATE TRIGGER confidence_node_weights_updated_at
    BEFORE UPDATE ON confidence_node_weights
    FOR EACH ROW EXECUTE FUNCTION update_pathway_graph_timestamp();

CREATE TRIGGER confidence_resolution_thresholds_updated_at
    BEFORE UPDATE ON confidence_resolution_thresholds
    FOR EACH ROW EXECUTE FUNCTION update_pathway_graph_timestamp();

-- =============================================================================
-- 11. TABLE COMMENTS
-- =============================================================================

COMMENT ON TABLE pathway_graph_index IS 'Relational index for pathway search. Graph data lives in AGE clinical_pathways namespace.';
COMMENT ON TABLE pathway_condition_codes IS 'Flat code-to-pathway mapping for Layer 1 recommendation matching';
COMMENT ON TABLE pathway_version_diffs IS 'Stores diff results from import pipeline for audit and review';
COMMENT ON TABLE pathway_resolution_sessions IS 'Tracks provider pathway resolution sessions for a patient';
COMMENT ON TABLE pathway_resolution_decisions IS 'Individual decision point resolutions within a session';
COMMENT ON TABLE confidence_signal_definitions IS 'Signal categories for computing per-node confidence scores';
COMMENT ON TABLE confidence_signal_weights IS 'Multi-level signal weight overrides (node -> pathway -> institution -> system)';
COMMENT ON TABLE confidence_node_weights IS 'Per-node importance weights for pathway confidence rollup';
COMMENT ON TABLE confidence_resolution_thresholds IS 'Auto-resolve and suggest thresholds at multiple levels';
