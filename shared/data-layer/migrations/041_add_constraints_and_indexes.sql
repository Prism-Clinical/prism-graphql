-- Migration 041: Add missing indexes, CHECK constraints, and unique constraints
-- Addresses review items #20-24 from code review.

-- =============================================================================
-- #20. Index on pathway_graph_index.age_node_id (graph bridge column)
-- =============================================================================

CREATE UNIQUE INDEX IF NOT EXISTS idx_pathway_graph_index_age_node_id
  ON pathway_graph_index(age_node_id)
  WHERE age_node_id IS NOT NULL;

-- =============================================================================
-- #21. Index on pathway_resolution_sessions.provider_id
-- =============================================================================

CREATE INDEX IF NOT EXISTS idx_pathway_resolution_sessions_provider
  ON pathway_resolution_sessions(provider_id);

-- =============================================================================
-- #22. CHECK constraints on confidence score columns (must be 0.0–1.0)
-- =============================================================================

ALTER TABLE pathway_resolution_decisions
  ADD CONSTRAINT pathway_resolution_decisions_score_range
  CHECK (confidence_score >= 0 AND confidence_score <= 1);

ALTER TABLE confidence_signal_definitions
  ADD CONSTRAINT confidence_signal_definitions_default_weight_range
  CHECK (default_weight >= 0 AND default_weight <= 1);

ALTER TABLE confidence_signal_weights
  ADD CONSTRAINT confidence_signal_weights_weight_range
  CHECK (weight >= 0 AND weight <= 1);

ALTER TABLE confidence_node_weights
  ADD CONSTRAINT confidence_node_weights_default_weight_range
  CHECK (default_weight >= 0 AND default_weight <= 1);

ALTER TABLE confidence_node_weights
  ADD CONSTRAINT confidence_node_weights_override_range
  CHECK (weight_override IS NULL OR (weight_override >= 0 AND weight_override <= 1));

ALTER TABLE confidence_resolution_thresholds
  ADD CONSTRAINT confidence_resolution_thresholds_auto_range
  CHECK (auto_resolve_threshold >= 0 AND auto_resolve_threshold <= 1);

ALTER TABLE confidence_resolution_thresholds
  ADD CONSTRAINT confidence_resolution_thresholds_suggest_range
  CHECK (suggest_threshold >= 0 AND suggest_threshold <= 1);

-- =============================================================================
-- #23. Ordering constraint: suggest_threshold < auto_resolve_threshold
-- =============================================================================

ALTER TABLE confidence_resolution_thresholds
  ADD CONSTRAINT confidence_resolution_thresholds_ordering
  CHECK (suggest_threshold < auto_resolve_threshold);

-- =============================================================================
-- #24. Unique constraint on (pathway_id, code, system) for condition codes
-- =============================================================================

ALTER TABLE pathway_condition_codes
  ADD CONSTRAINT pathway_condition_codes_pathway_code_system_unique
  UNIQUE (pathway_id, code, system);
