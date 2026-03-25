-- shared/data-layer/migrations/043_create_resolution_analytics.sql
--
-- Relational analytics tables for cross-session queries.
-- Complement the JSONB resolution_state (fast reads) with relational
-- tables (fast aggregates: "how often do providers override node X?").
--
-- These are append-only (no updates). Immutable audit trail.

BEGIN;

-- Provider node overrides (queryable across sessions)
CREATE TABLE pathway_node_overrides (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES pathway_resolution_sessions(id) ON DELETE CASCADE,
  node_id TEXT NOT NULL,
  pathway_id UUID NOT NULL REFERENCES pathway_graph_index(id),
  action TEXT NOT NULL CHECK (action IN ('include', 'exclude')),
  reason TEXT,
  original_status TEXT NOT NULL,
  original_confidence FLOAT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- "Override rate per node" queries
CREATE INDEX idx_node_overrides_pattern
  ON pathway_node_overrides(pathway_id, node_id, action);

CREATE INDEX idx_node_overrides_session
  ON pathway_node_overrides(session_id);

-- Gate question answers (queryable across sessions)
CREATE TABLE pathway_gate_answers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES pathway_resolution_sessions(id) ON DELETE CASCADE,
  gate_id TEXT NOT NULL,
  pathway_id UUID NOT NULL REFERENCES pathway_graph_index(id),
  answer JSONB NOT NULL,
  gate_opened BOOLEAN NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- "Answer distribution per gate" queries
CREATE INDEX idx_gate_answers_pattern
  ON pathway_gate_answers(pathway_id, gate_id, gate_opened);

CREATE INDEX idx_gate_answers_session
  ON pathway_gate_answers(session_id);

COMMIT;
