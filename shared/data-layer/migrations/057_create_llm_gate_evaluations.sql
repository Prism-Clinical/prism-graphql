-- Migration 057: per-evaluation audit trail for `llm_text_analysis` Gate
-- nodes. Every LLM call on a resolution session's gate writes a row here so
-- a clinician (or compliance reviewer) can always re-read exactly what the
-- model saw, what it answered, and what the provider ultimately did with it.
--
-- Index on (session_id, gate_id) supports the common "show me the audit
-- trail for this gate in this session" lookup. created_at desc index
-- supports global recency views.

BEGIN;

CREATE TABLE IF NOT EXISTS llm_gate_evaluations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Identity
    session_id UUID NOT NULL REFERENCES pathway_resolution_sessions(id) ON DELETE CASCADE,
    gate_id TEXT NOT NULL,
    pathway_id UUID NOT NULL REFERENCES pathway_graph_index(id) ON DELETE CASCADE,

    -- Input
    input_attribute TEXT,
    input_text TEXT,
    prompt TEXT NOT NULL,
    branches JSONB NOT NULL DEFAULT '[]'::jsonb,

    -- LLM response
    model VARCHAR(100) NOT NULL,
    chosen_branch VARCHAR(200),
    confidence NUMERIC(5, 4),
    reasoning TEXT,
    full_response JSONB,

    -- Tentative-state tracking
    tentative BOOLEAN NOT NULL DEFAULT false,
    provider_confirmed_at TIMESTAMPTZ,
    provider_confirmed_by UUID,
    provider_chosen_branch VARCHAR(200),

    -- Errors / latency
    error_message TEXT,
    latency_ms INTEGER,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT llm_gate_evaluations_confidence_range
        CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1))
);

CREATE INDEX IF NOT EXISTS idx_llm_gate_evaluations_session_gate
    ON llm_gate_evaluations(session_id, gate_id);
CREATE INDEX IF NOT EXISTS idx_llm_gate_evaluations_pathway
    ON llm_gate_evaluations(pathway_id);
CREATE INDEX IF NOT EXISTS idx_llm_gate_evaluations_recent
    ON llm_gate_evaluations(created_at DESC);

COMMENT ON TABLE llm_gate_evaluations IS
    'Audit trail for llm_text_analysis Gate evaluations. One row per LLM call.';

COMMIT;
