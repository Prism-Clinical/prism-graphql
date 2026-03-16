-- Migration 037: Rename legacy pathway tables from migration 017
-- These tables are empty in all environments (pre-launch). No data migration needed.
-- Renamed rather than dropped to preserve schema for reference.

-- Drop triggers first (they reference the old table names)
DROP TRIGGER IF EXISTS clinical_pathways_updated_at ON clinical_pathways;
DROP TRIGGER IF EXISTS pathway_nodes_updated_at ON pathway_nodes;
DROP TRIGGER IF EXISTS patient_pathway_instances_updated_at ON patient_pathway_instances;

-- Drop trigger functions
DROP FUNCTION IF EXISTS update_clinical_pathway_timestamp();
DROP FUNCTION IF EXISTS update_pathway_node_timestamp();
DROP FUNCTION IF EXISTS update_patient_pathway_instance_timestamp();

-- Drop helper functions
DROP FUNCTION IF EXISTS get_pathway_tree(UUID);
DROP FUNCTION IF EXISTS get_pathway_usage_stats(UUID);
DROP FUNCTION IF EXISTS get_node_selection_stats(UUID);

-- Rename tables to _legacy suffix
ALTER TABLE clinical_pathways RENAME TO clinical_pathways_legacy;
ALTER TABLE pathway_nodes RENAME TO pathway_nodes_legacy;
ALTER TABLE pathway_node_outcomes RENAME TO pathway_node_outcomes_legacy;
ALTER TABLE patient_pathway_instances RENAME TO patient_pathway_instances_legacy;
ALTER TABLE patient_pathway_selections RENAME TO patient_pathway_selections_legacy;

-- Rename indexes to match new table names (prevents name collisions)
ALTER INDEX IF EXISTS idx_clinical_pathways_slug RENAME TO idx_clinical_pathways_legacy_slug;
ALTER INDEX IF EXISTS idx_clinical_pathways_conditions RENAME TO idx_clinical_pathways_legacy_conditions;
ALTER INDEX IF EXISTS idx_clinical_pathways_active RENAME TO idx_clinical_pathways_legacy_active;
ALTER INDEX IF EXISTS idx_clinical_pathways_published RENAME TO idx_clinical_pathways_legacy_published;
ALTER INDEX IF EXISTS idx_clinical_pathways_embedding RENAME TO idx_clinical_pathways_legacy_embedding;
ALTER INDEX IF EXISTS idx_pathway_nodes_pathway RENAME TO idx_pathway_nodes_legacy_pathway;
ALTER INDEX IF EXISTS idx_pathway_nodes_parent RENAME TO idx_pathway_nodes_legacy_parent;
ALTER INDEX IF EXISTS idx_pathway_nodes_type RENAME TO idx_pathway_nodes_legacy_type;
ALTER INDEX IF EXISTS idx_pathway_nodes_pathway_active RENAME TO idx_pathway_nodes_legacy_pathway_active;
ALTER INDEX IF EXISTS idx_pathway_nodes_embedding RENAME TO idx_pathway_nodes_legacy_embedding;
ALTER INDEX IF EXISTS idx_pathway_node_outcomes_node RENAME TO idx_pathway_node_outcomes_legacy_node;
ALTER INDEX IF EXISTS idx_patient_pathway_instances_patient RENAME TO idx_patient_pathway_instances_legacy_patient;
ALTER INDEX IF EXISTS idx_patient_pathway_instances_provider RENAME TO idx_patient_pathway_instances_legacy_provider;
ALTER INDEX IF EXISTS idx_patient_pathway_instances_pathway RENAME TO idx_patient_pathway_instances_legacy_pathway;
ALTER INDEX IF EXISTS idx_patient_pathway_instances_status RENAME TO idx_patient_pathway_instances_legacy_status;
ALTER INDEX IF EXISTS idx_patient_pathway_instances_started RENAME TO idx_patient_pathway_instances_legacy_started;
ALTER INDEX IF EXISTS idx_patient_pathway_selections_instance RENAME TO idx_patient_pathway_selections_legacy_instance;
ALTER INDEX IF EXISTS idx_patient_pathway_selections_node RENAME TO idx_patient_pathway_selections_legacy_node;
ALTER INDEX IF EXISTS idx_patient_pathway_selections_type RENAME TO idx_patient_pathway_selections_legacy_type;
ALTER INDEX IF EXISTS idx_patient_pathway_selections_care_plan RENAME TO idx_patient_pathway_selections_legacy_care_plan;

COMMENT ON TABLE clinical_pathways_legacy IS 'LEGACY (migration 017) — replaced by AGE graph + pathway_graph_index in migration 038';
