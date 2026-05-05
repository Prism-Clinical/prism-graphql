-- Migration 052: add ddi_warnings to resolution session tables (Phase 4 commit 4)
--
-- DDI suppressions reuse the existing EXCLUDED node-status flow with a
-- DDI-specific excludeReason — no new column needed for those. Warnings
-- (MODERATE severity) don't suppress, so they need their own JSONB column
-- on both single-pathway and multi-pathway sessions.

BEGIN;

ALTER TABLE pathway_resolution_sessions
  ADD COLUMN ddi_warnings JSONB NOT NULL DEFAULT '[]';

ALTER TABLE multi_pathway_resolution_sessions
  ADD COLUMN ddi_warnings JSONB NOT NULL DEFAULT '[]';

COMMENT ON COLUMN pathway_resolution_sessions.ddi_warnings IS
    'DDI MODERATE-severity findings (drug↔drug or drug↔allergy). Provider sees these inline before signing.';

COMMENT ON COLUMN multi_pathway_resolution_sessions.ddi_warnings IS
    'Same as pathway_resolution_sessions.ddi_warnings, plus cross-recommendation findings detected post-merge.';

COMMIT;
