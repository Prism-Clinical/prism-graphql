-- Migration 039: Seed built-in confidence signal definitions and system default thresholds
-- These are the 4 SYSTEM-scope signals used by the confidence framework.

-- =============================================================================
-- 1. BUILT-IN SIGNALS
-- =============================================================================

INSERT INTO confidence_signal_definitions (id, name, display_name, description, scoring_type, scoring_rules, scope, default_weight, is_active)
VALUES
  (
    gen_random_uuid(),
    'data_completeness',
    'Data Completeness',
    'Fraction of required inputs available in patient clinical context. Missing data is the most common source of incorrect auto-resolution.',
    'DATA_PRESENCE',
    '{"check": "inputs_array", "scoring": {"present": 1.0, "partial": 0.5, "absent": 0.0}, "aggregation": "ratio"}'::jsonb,
    'SYSTEM',
    0.30,
    true
  ),
  (
    gen_random_uuid(),
    'evidence_strength',
    'Evidence Strength',
    'Maps the evidence level backing this node to a confidence score. Stronger evidence increases trustworthiness of the recommendation.',
    'MAPPING_LOOKUP',
    '{"field": "evidence_level", "mappings": {"Level A": 0.95, "Level B": 0.80, "Level C": 0.65, "Expert Consensus": 0.60}, "default": 0.30}'::jsonb,
    'SYSTEM',
    0.25,
    true
  ),
  (
    gen_random_uuid(),
    'match_quality',
    'Patient Match Quality',
    'How precisely patient data matches pathway criteria. Compares patient codes and values against each criterion.',
    'CRITERIA_MATCH',
    '{"match_scores": {"exact_code_match": 1.0, "parent_prefix_match": 0.7, "inferred_from_context": 0.5, "absent": 0.0}, "aggregation": "weighted_average", "critical_criteria_cap": 0.5}'::jsonb,
    'SYSTEM',
    0.25,
    true
  ),
  (
    gen_random_uuid(),
    'risk_magnitude',
    'Risk Magnitude',
    'Inverse of clinical risk — higher risk lowers confidence for auto-resolution, forcing provider involvement for high-stakes decisions.',
    'RISK_INVERSE',
    '{"formula": "max(0.10, 1.0 - (log10(risk_value * 1000 + 1) / 3.0))", "no_data_default": 0.50, "aggregation": "min"}'::jsonb,
    'SYSTEM',
    0.20,
    true
  );

-- =============================================================================
-- 2. SYSTEM DEFAULT THRESHOLDS
-- =============================================================================

INSERT INTO confidence_resolution_thresholds (id, auto_resolve_threshold, suggest_threshold, scope)
VALUES (
  gen_random_uuid(),
  0.85,
  0.60,
  'SYSTEM_DEFAULT'
);
