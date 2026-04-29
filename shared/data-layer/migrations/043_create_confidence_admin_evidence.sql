-- Migration 043: Create confidence_admin_evidence table
-- Stores admin-curated evidence entries linked to pathway nodes,
-- used by the confidence engine's EvidenceStrengthScorer and the
-- adminEvidenceEntries / addAdminEvidence GraphQL resolvers.

CREATE TABLE IF NOT EXISTS confidence_admin_evidence (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    pathway_id UUID NOT NULL REFERENCES pathway_graph_index(id) ON DELETE CASCADE,
    node_identifier VARCHAR(100) NOT NULL,
    title VARCHAR(500) NOT NULL,
    source TEXT,
    year INTEGER,
    evidence_level VARCHAR(30) NOT NULL,
    url TEXT,
    notes TEXT,
    applicable_criteria TEXT[] DEFAULT '{}',
    population_description TEXT,
    created_by UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT confidence_admin_evidence_level_check CHECK (
        evidence_level IN ('Level A', 'Level B', 'Level C', 'Expert Consensus')
    )
);

CREATE INDEX idx_confidence_admin_evidence_pathway ON confidence_admin_evidence(pathway_id);
CREATE INDEX idx_confidence_admin_evidence_node ON confidence_admin_evidence(node_identifier);

COMMENT ON TABLE confidence_admin_evidence IS 'Admin-curated evidence entries for pathway nodes, used by confidence scoring';
