-- Migration 049: Drop pathway_condition_codes
--
-- Phase 1b commit 4. The flat per-pathway code list has been fully replaced
-- by pathway_code_sets + pathway_code_set_members (created in 047, backfilled
-- in 048). All readers and writers in the application code now use the new
-- tables. This migration removes the old table.
--
-- The table has no incoming foreign keys; the only outgoing FK is to
-- pathway_graph_index (cascade), so DROP TABLE is clean.
--
-- Idempotent via IF EXISTS.

DROP TABLE IF EXISTS pathway_condition_codes;
