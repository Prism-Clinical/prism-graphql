-- Migration: Create Clinical Pathways for Decision Explorer
-- Purpose: Support clinical decision trees with ML-driven recommendations and patient tracking

-- =============================================================================
-- 1. CLINICAL_PATHWAYS TABLE - Decision tree definitions
-- =============================================================================

CREATE TABLE IF NOT EXISTS clinical_pathways (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Pathway identification
    name VARCHAR(300) NOT NULL,
    slug VARCHAR(300) NOT NULL UNIQUE,
    description TEXT,

    -- Clinical context
    primary_condition_codes TEXT[] NOT NULL DEFAULT '{}',  -- ICD-10/SNOMED codes
    applicable_contexts JSONB DEFAULT '{}',  -- age ranges, demographics, etc.

    -- Versioning
    version VARCHAR(20) NOT NULL DEFAULT '1.0',

    -- Evidence grading
    evidence_source VARCHAR(500),  -- CDC guidelines, UpToDate, etc.
    evidence_grade VARCHAR(10),    -- A, B, C, D, or I-III

    -- Status flags
    is_active BOOLEAN NOT NULL DEFAULT true,
    is_published BOOLEAN NOT NULL DEFAULT false,
    published_at TIMESTAMP WITH TIME ZONE,

    -- Audit
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    created_by UUID,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,

    -- ML embedding for semantic search
    embedding vector(1536)
);

-- Indexes for clinical_pathways
CREATE INDEX IF NOT EXISTS idx_clinical_pathways_slug ON clinical_pathways(slug);
CREATE INDEX IF NOT EXISTS idx_clinical_pathways_conditions ON clinical_pathways USING GIN(primary_condition_codes);
CREATE INDEX IF NOT EXISTS idx_clinical_pathways_active ON clinical_pathways(is_active) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_clinical_pathways_published ON clinical_pathways(is_published) WHERE is_published = true;
CREATE INDEX IF NOT EXISTS idx_clinical_pathways_embedding ON clinical_pathways USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- =============================================================================
-- 2. PATHWAY_NODES TABLE - Individual nodes in decision tree
-- =============================================================================

CREATE TABLE IF NOT EXISTS pathway_nodes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Tree structure
    pathway_id UUID NOT NULL REFERENCES clinical_pathways(id) ON DELETE CASCADE,
    parent_node_id UUID REFERENCES pathway_nodes(id) ON DELETE CASCADE,

    -- Node classification
    node_type VARCHAR(20) NOT NULL,  -- 'root', 'decision', 'branch', 'recommendation'

    -- Display
    title VARCHAR(300) NOT NULL,
    description TEXT,

    -- Action type for branch/recommendation nodes
    action_type VARCHAR(30),  -- 'medication', 'lab', 'referral', 'procedure', 'education', 'monitoring'

    -- Decision factors (what influences this choice)
    decision_factors JSONB DEFAULT '[]',
    -- Example: [
    --   {"type": "LAB", "label": "Rapid strep positive", "impact": "HIGH"},
    --   {"type": "SYMPTOM", "label": "Fever > 101°F", "impact": "MEDIUM"}
    -- ]

    -- Optional link to care plan template for recommendations
    suggested_template_id UUID,  -- Can reference care_plans(id) if needed

    -- Ordering
    sort_order INTEGER NOT NULL DEFAULT 0,

    -- ML scoring
    base_confidence DECIMAL(4,3) DEFAULT 0.700,  -- Base confidence before ML adjustment

    -- Status
    is_active BOOLEAN NOT NULL DEFAULT true,

    -- Audit
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,

    -- ML embedding for semantic matching
    embedding vector(1536),

    -- Constraints
    CONSTRAINT valid_node_type CHECK (
        node_type IN ('root', 'decision', 'branch', 'recommendation')
    ),
    CONSTRAINT valid_action_type CHECK (
        action_type IS NULL OR action_type IN (
            'medication', 'lab', 'referral', 'procedure', 'education',
            'monitoring', 'lifestyle', 'follow_up', 'urgent_care'
        )
    )
);

-- Indexes for pathway_nodes
CREATE INDEX IF NOT EXISTS idx_pathway_nodes_pathway ON pathway_nodes(pathway_id);
CREATE INDEX IF NOT EXISTS idx_pathway_nodes_parent ON pathway_nodes(parent_node_id);
CREATE INDEX IF NOT EXISTS idx_pathway_nodes_type ON pathway_nodes(node_type);
CREATE INDEX IF NOT EXISTS idx_pathway_nodes_pathway_active ON pathway_nodes(pathway_id, is_active) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_pathway_nodes_embedding ON pathway_nodes USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- =============================================================================
-- 3. PATHWAY_NODE_OUTCOMES TABLE - Possible outcomes at each node
-- =============================================================================

CREATE TABLE IF NOT EXISTS pathway_node_outcomes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Parent node
    node_id UUID NOT NULL REFERENCES pathway_nodes(id) ON DELETE CASCADE,

    -- Outcome definition
    label VARCHAR(200) NOT NULL,
    description TEXT,

    -- Clinical codes for structured outcomes
    medication_code VARCHAR(50),   -- RxNorm code
    procedure_code VARCHAR(50),    -- CPT/HCPCS code
    lab_code VARCHAR(50),          -- LOINC code
    diagnosis_code VARCHAR(50),    -- ICD-10 code

    -- Additional factors affecting this outcome
    outcome_factors JSONB DEFAULT '{}',
    -- Example: {"requires_allergy_check": true, "min_age": 18}

    -- Ordering
    sort_order INTEGER NOT NULL DEFAULT 0,

    -- Audit
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for pathway_node_outcomes
CREATE INDEX IF NOT EXISTS idx_pathway_node_outcomes_node ON pathway_node_outcomes(node_id);

-- =============================================================================
-- 4. PATIENT_PATHWAY_INSTANCES TABLE - Track which pathway a patient followed
-- =============================================================================

CREATE TABLE IF NOT EXISTS patient_pathway_instances (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Patient and provider
    patient_id UUID NOT NULL,
    provider_id UUID,

    -- Pathway reference
    pathway_id UUID NOT NULL REFERENCES clinical_pathways(id) ON DELETE RESTRICT,

    -- Patient context at time of pathway execution
    patient_context JSONB NOT NULL DEFAULT '{}',
    -- Example: {
    --   "age": 35,
    --   "conditions": ["J02.0"],
    --   "allergies": ["penicillin"],
    --   "current_medications": [...],
    --   "lab_results": {...}
    -- }

    -- ML model information
    ml_model_id UUID,
    ml_model_version VARCHAR(50),
    ml_recommended_path JSONB,       -- Array of node IDs that ML recommended
    ml_confidence_scores JSONB,      -- Node ID -> confidence mapping

    -- Instance status
    status VARCHAR(20) NOT NULL DEFAULT 'IN_PROGRESS',

    -- Timestamps
    started_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP WITH TIME ZONE,

    -- Audit
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,

    -- Constraints
    CONSTRAINT valid_instance_status CHECK (
        status IN ('IN_PROGRESS', 'COMPLETED', 'ABANDONED', 'OVERRIDDEN')
    )
);

-- Indexes for patient_pathway_instances
CREATE INDEX IF NOT EXISTS idx_patient_pathway_instances_patient ON patient_pathway_instances(patient_id);
CREATE INDEX IF NOT EXISTS idx_patient_pathway_instances_provider ON patient_pathway_instances(provider_id);
CREATE INDEX IF NOT EXISTS idx_patient_pathway_instances_pathway ON patient_pathway_instances(pathway_id);
CREATE INDEX IF NOT EXISTS idx_patient_pathway_instances_status ON patient_pathway_instances(status);
CREATE INDEX IF NOT EXISTS idx_patient_pathway_instances_started ON patient_pathway_instances(started_at DESC);

-- =============================================================================
-- 5. PATIENT_PATHWAY_SELECTIONS TABLE - Individual node selections
-- =============================================================================

CREATE TABLE IF NOT EXISTS patient_pathway_selections (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Instance and node reference
    instance_id UUID NOT NULL REFERENCES patient_pathway_instances(id) ON DELETE CASCADE,
    node_id UUID NOT NULL REFERENCES pathway_nodes(id) ON DELETE RESTRICT,

    -- Selection metadata
    selection_type VARCHAR(20) NOT NULL DEFAULT 'ml_recommended',
    ml_confidence DECIMAL(4,3),
    ml_rank INTEGER,  -- Rank among alternatives (1 = top recommendation)

    -- Override tracking
    override_reason TEXT,  -- If provider chose differently than ML

    -- Link to resulting care plan (if any)
    resulting_care_plan_id UUID,  -- Can reference care_plans(id)

    -- Timestamps
    selected_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    selected_by UUID,  -- Provider who made selection

    -- Constraints
    CONSTRAINT unique_instance_node UNIQUE (instance_id, node_id),
    CONSTRAINT valid_selection_type CHECK (
        selection_type IN ('ml_recommended', 'provider_selected', 'auto_applied')
    )
);

-- Indexes for patient_pathway_selections
CREATE INDEX IF NOT EXISTS idx_patient_pathway_selections_instance ON patient_pathway_selections(instance_id);
CREATE INDEX IF NOT EXISTS idx_patient_pathway_selections_node ON patient_pathway_selections(node_id);
CREATE INDEX IF NOT EXISTS idx_patient_pathway_selections_type ON patient_pathway_selections(selection_type);
CREATE INDEX IF NOT EXISTS idx_patient_pathway_selections_care_plan ON patient_pathway_selections(resulting_care_plan_id)
    WHERE resulting_care_plan_id IS NOT NULL;

-- =============================================================================
-- 6. HELPER FUNCTIONS
-- =============================================================================

-- Function to get full pathway tree with nodes
CREATE OR REPLACE FUNCTION get_pathway_tree(p_pathway_id UUID)
RETURNS TABLE (
    node_id UUID,
    parent_node_id UUID,
    node_type VARCHAR(20),
    title VARCHAR(300),
    description TEXT,
    action_type VARCHAR(30),
    decision_factors JSONB,
    base_confidence DECIMAL(4,3),
    sort_order INTEGER,
    depth INTEGER
) AS $$
WITH RECURSIVE node_tree AS (
    -- Start with root nodes
    SELECT
        n.id AS node_id,
        n.parent_node_id,
        n.node_type,
        n.title,
        n.description,
        n.action_type,
        n.decision_factors,
        n.base_confidence,
        n.sort_order,
        0 AS depth
    FROM pathway_nodes n
    WHERE n.pathway_id = p_pathway_id
      AND n.parent_node_id IS NULL
      AND n.is_active = true

    UNION ALL

    -- Recursively get children
    SELECT
        n.id AS node_id,
        n.parent_node_id,
        n.node_type,
        n.title,
        n.description,
        n.action_type,
        n.decision_factors,
        n.base_confidence,
        n.sort_order,
        nt.depth + 1 AS depth
    FROM pathway_nodes n
    JOIN node_tree nt ON n.parent_node_id = nt.node_id
    WHERE n.is_active = true
)
SELECT * FROM node_tree
ORDER BY depth, sort_order;
$$ LANGUAGE SQL;

-- Function to get pathway usage statistics
CREATE OR REPLACE FUNCTION get_pathway_usage_stats(p_pathway_id UUID)
RETURNS TABLE (
    total_instances INTEGER,
    completed_instances INTEGER,
    abandoned_instances INTEGER,
    override_rate DECIMAL(5,2),
    avg_completion_time_minutes INTEGER
) AS $$
SELECT
    COUNT(*)::INTEGER AS total_instances,
    COUNT(*) FILTER (WHERE status = 'COMPLETED')::INTEGER AS completed_instances,
    COUNT(*) FILTER (WHERE status = 'ABANDONED')::INTEGER AS abandoned_instances,
    COALESCE(
        ROUND(
            100.0 * COUNT(*) FILTER (WHERE status = 'OVERRIDDEN') / NULLIF(COUNT(*), 0),
            2
        ),
        0
    ) AS override_rate,
    COALESCE(
        AVG(
            EXTRACT(EPOCH FROM (completed_at - started_at)) / 60
        ) FILTER (WHERE completed_at IS NOT NULL),
        0
    )::INTEGER AS avg_completion_time_minutes
FROM patient_pathway_instances
WHERE pathway_id = p_pathway_id;
$$ LANGUAGE SQL;

-- Function to get node selection statistics
CREATE OR REPLACE FUNCTION get_node_selection_stats(p_node_id UUID)
RETURNS TABLE (
    total_selections INTEGER,
    ml_recommended_count INTEGER,
    provider_selected_count INTEGER,
    avg_ml_confidence DECIMAL(4,3),
    linked_care_plans INTEGER
) AS $$
SELECT
    COUNT(*)::INTEGER AS total_selections,
    COUNT(*) FILTER (WHERE selection_type = 'ml_recommended')::INTEGER AS ml_recommended_count,
    COUNT(*) FILTER (WHERE selection_type = 'provider_selected')::INTEGER AS provider_selected_count,
    COALESCE(AVG(ml_confidence), 0)::DECIMAL(4,3) AS avg_ml_confidence,
    COUNT(*) FILTER (WHERE resulting_care_plan_id IS NOT NULL)::INTEGER AS linked_care_plans
FROM patient_pathway_selections
WHERE node_id = p_node_id;
$$ LANGUAGE SQL;

-- =============================================================================
-- 7. TRIGGERS
-- =============================================================================

-- Trigger to update updated_at on clinical_pathways
CREATE OR REPLACE FUNCTION update_clinical_pathway_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS clinical_pathways_updated_at ON clinical_pathways;
CREATE TRIGGER clinical_pathways_updated_at
    BEFORE UPDATE ON clinical_pathways
    FOR EACH ROW
    EXECUTE FUNCTION update_clinical_pathway_timestamp();

-- Trigger to update updated_at on pathway_nodes
CREATE OR REPLACE FUNCTION update_pathway_node_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS pathway_nodes_updated_at ON pathway_nodes;
CREATE TRIGGER pathway_nodes_updated_at
    BEFORE UPDATE ON pathway_nodes
    FOR EACH ROW
    EXECUTE FUNCTION update_pathway_node_timestamp();

-- Trigger to update updated_at on patient_pathway_instances
CREATE OR REPLACE FUNCTION update_patient_pathway_instance_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS patient_pathway_instances_updated_at ON patient_pathway_instances;
CREATE TRIGGER patient_pathway_instances_updated_at
    BEFORE UPDATE ON patient_pathway_instances
    FOR EACH ROW
    EXECUTE FUNCTION update_patient_pathway_instance_timestamp();

-- =============================================================================
-- 8. COMMENTS
-- =============================================================================

COMMENT ON TABLE clinical_pathways IS 'Clinical decision pathways/trees for guiding care decisions';
COMMENT ON TABLE pathway_nodes IS 'Individual nodes within clinical pathways forming decision tree structure';
COMMENT ON TABLE pathway_node_outcomes IS 'Possible outcomes/options at each pathway node';
COMMENT ON TABLE patient_pathway_instances IS 'Tracks when patients go through a clinical pathway';
COMMENT ON TABLE patient_pathway_selections IS 'Individual node selections made during pathway execution';

COMMENT ON COLUMN clinical_pathways.primary_condition_codes IS 'ICD-10/SNOMED codes that trigger this pathway';
COMMENT ON COLUMN clinical_pathways.applicable_contexts IS 'JSON with constraints: age_range, demographics, exclusion_criteria';
COMMENT ON COLUMN clinical_pathways.evidence_grade IS 'Clinical evidence grading: A/B/C/D or I/II/III';
COMMENT ON COLUMN clinical_pathways.embedding IS 'Vector embedding for semantic pathway matching';

COMMENT ON COLUMN pathway_nodes.node_type IS 'Type: root (entry point), decision (branching), branch (option), recommendation (terminal)';
COMMENT ON COLUMN pathway_nodes.action_type IS 'Clinical action category: medication, lab, referral, procedure, education, monitoring';
COMMENT ON COLUMN pathway_nodes.decision_factors IS 'JSON array of factors that influence this decision';
COMMENT ON COLUMN pathway_nodes.base_confidence IS 'Base confidence score before ML adjustment (0-1)';

COMMENT ON COLUMN patient_pathway_instances.patient_context IS 'Snapshot of patient data at pathway start for reproducibility';
COMMENT ON COLUMN patient_pathway_instances.ml_recommended_path IS 'Array of node IDs recommended by ML model';
COMMENT ON COLUMN patient_pathway_instances.ml_confidence_scores IS 'Map of node ID to ML confidence score';

COMMENT ON COLUMN patient_pathway_selections.selection_type IS 'How selection was made: ml_recommended, provider_selected, auto_applied';
COMMENT ON COLUMN patient_pathway_selections.override_reason IS 'Provider explanation when overriding ML recommendation';
COMMENT ON COLUMN patient_pathway_selections.resulting_care_plan_id IS 'Link to care plan created from this selection';

COMMENT ON FUNCTION get_pathway_tree IS 'Returns full pathway tree with recursive node traversal';
COMMENT ON FUNCTION get_pathway_usage_stats IS 'Returns usage statistics for a pathway';
COMMENT ON FUNCTION get_node_selection_stats IS 'Returns selection statistics for a specific node';
