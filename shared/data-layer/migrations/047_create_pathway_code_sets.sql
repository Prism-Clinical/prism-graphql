-- Migration 047: Create pathway_code_sets + pathway_code_set_members
--
-- Phase 1b storage layer. Pathways express their match conditions as one or
-- more code sets; each set is an ALL_OF conjunction over its members. The
-- normalized two-table model lets each member carry its own (code, system)
-- plus per-code metadata, supports cross-system conjunctions, and gives
-- code-driven discovery a fast indexed path.
--
-- Additive only. The old pathway_condition_codes table is unchanged here;
-- backfill happens in 048, cutover in subsequent migrations.

-- =============================================================================
-- 1. PATHWAY_CODE_SETS — parent: each row is one match scenario for a pathway
-- =============================================================================

CREATE TABLE pathway_code_sets (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    pathway_id      UUID NOT NULL REFERENCES pathway_graph_index(id) ON DELETE CASCADE,
    scope           VARCHAR(30) NOT NULL DEFAULT 'EXACT',
    semantics       VARCHAR(20) NOT NULL DEFAULT 'ALL_OF',
    entry_node_id   VARCHAR(100),
    description     TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT pathway_code_sets_scope_check CHECK (
        scope IN ('EXACT', 'EXACT_AND_DESCENDANTS', 'DESCENDANTS_OK')
    ),
    CONSTRAINT pathway_code_sets_semantics_check CHECK (
        semantics IN ('ALL_OF')
    )
);

CREATE INDEX idx_pcs_pathway ON pathway_code_sets(pathway_id);

-- =============================================================================
-- 2. PATHWAY_CODE_SET_MEMBERS — child: each row is one (code, system) in a set
-- =============================================================================

CREATE TABLE pathway_code_set_members (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code_set_id     UUID NOT NULL REFERENCES pathway_code_sets(id) ON DELETE CASCADE,
    code            VARCHAR(20) NOT NULL,
    system          VARCHAR(10) NOT NULL,
    scope_override  VARCHAR(30),
    description     TEXT,

    CONSTRAINT pathway_code_set_members_system_check CHECK (
        system IN ('ICD-10', 'SNOMED', 'RXNORM', 'LOINC', 'CPT')
    ),
    CONSTRAINT pathway_code_set_members_scope_override_check CHECK (
        scope_override IS NULL
        OR scope_override IN ('EXACT', 'EXACT_AND_DESCENDANTS', 'DESCENDANTS_OK')
    ),
    CONSTRAINT pathway_code_set_members_unique UNIQUE (code_set_id, code, system)
);

CREATE INDEX idx_pcsm_set ON pathway_code_set_members(code_set_id);
CREATE INDEX idx_pcsm_code_system ON pathway_code_set_members(code, system);

-- =============================================================================
-- 3. updated_at trigger on pathway_code_sets
-- =============================================================================

CREATE TRIGGER pathway_code_sets_updated_at
    BEFORE UPDATE ON pathway_code_sets
    FOR EACH ROW EXECUTE FUNCTION update_pathway_graph_timestamp();

-- =============================================================================
-- 4. Comments
-- =============================================================================

COMMENT ON TABLE pathway_code_sets IS 'Phase 1b: a pathway expresses one or more code sets; a set matches when all its members are in the patient''s expanded code set.';
COMMENT ON TABLE pathway_code_set_members IS 'Phase 1b: members of a code set — each carries its own (code, system) plus optional per-code metadata.';
COMMENT ON COLUMN pathway_code_sets.scope IS 'EXACT (default): patient codes match members literally. EXACT_AND_DESCENDANTS / DESCENDANTS_OK reserved for future activation; v1 only honors EXACT.';
COMMENT ON COLUMN pathway_code_sets.semantics IS 'ALL_OF: every member must be in patient''s codes. v1 only supports ALL_OF; column reserved for future variants.';
COMMENT ON COLUMN pathway_code_sets.entry_node_id IS 'AGE node_id where this set''s match should route resolution. NULL for legacy sets that don''t declare an entry node.';
COMMENT ON COLUMN pathway_code_set_members.scope_override IS 'Per-code scope override; NULL means inherit from pathway_code_sets.scope.';
