BEGIN;

ALTER TABLE confidence_node_weights
  ADD COLUMN IF NOT EXISTS propagation_overrides JSONB DEFAULT '{}';

COMMENT ON COLUMN confidence_node_weights.propagation_overrides IS
  'Per-signal propagation config overrides. Keys are signal names, values are PropagationConfig objects. Overrides the signal-level default.';

ALTER TABLE confidence_resolution_thresholds
  ADD CONSTRAINT confidence_resolution_thresholds_unique
  UNIQUE NULLS NOT DISTINCT (scope, pathway_id, node_identifier, institution_id);

UPDATE confidence_signal_definitions
  SET scoring_rules = scoring_rules || '{"propagation": {"mode": "transitive_with_decay", "decayFactor": 0.8, "maxHops": 3}}'::jsonb
  WHERE name = 'data_completeness' AND scope = 'SYSTEM';

UPDATE confidence_signal_definitions
  SET scoring_rules = scoring_rules || '{"propagation": {"mode": "none"}}'::jsonb
  WHERE name = 'evidence_strength' AND scope = 'SYSTEM';

UPDATE confidence_signal_definitions
  SET scoring_rules = scoring_rules || '{"propagation": {"mode": "direct"}}'::jsonb
  WHERE name = 'match_quality' AND scope = 'SYSTEM';

UPDATE confidence_signal_definitions
  SET scoring_rules = scoring_rules || '{"propagation": {"mode": "direct"}}'::jsonb
  WHERE name = 'risk_magnitude' AND scope = 'SYSTEM';

COMMIT;
